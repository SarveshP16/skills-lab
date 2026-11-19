/* sudo learn — DevOps track: the Docker daemon and CLI. State lives on the laptop's machine object (sys.dk):
   images, containers, volumes, networks, the build cache and a clock in seconds (each docker command takes a
   moment, so "Up 5 seconds" and health checks move forward as you work). A container's file system is a real
   ShEngine machine built from its image layers, so `docker exec web ls /usr/share/nginx/html` or an interactive
   `docker exec -it web sh` runs the same Bash as the rest of the course; volumes and bind mounts are kept in
   sync with the laptop's own files. What a container's main process does (nginx, a Python API, PostgreSQL...)
   comes from dk-apps.js. Builds are in dk-build.js, Compose in dk-compose.js, Trivy in dk-trivy.js. */
(function (root) {
  "use strict";
  var S = root.ShEngine, M2 = S.M2, CMDS = S.CMDS, U = S.util, Dk = root.Dk;
  var out = U.out, errl = U.errl, note = U.note;
  var NOW = S.NOW;

  /* ================================================================== state */
  function state(sys) {
    if (sys.dk) return sys.dk;
    var d = sys.dk = { t: 0, seq: 0, images: [], ctrs: [], vols: {}, nets: {}, cache: {}, builds: [], events: [], lastBuild: null, ipSeq: {} };
    // Registries are the outside world: the laptop, CI runners and build agents all see the same ones (kept on the
    // simulated GitHub's hub when there is one, so a runner pushing to ghcr.io and the laptop pulling agree).
    var own = Dk.newRegistries();
    Object.defineProperty(d, "regs", { enumerable: true, configurable: true, get: function () {
      var h = sys.github || (sys.hubSys && sys.hubSys.github) || (sys.dkHost && (sys.dkHost.github || (sys.dkHost.hubSys && sys.dkHost.hubSys.github)));
      if (!h) return own;
      if (!h.dkRegs) h.dkRegs = own;
      return h.dkRegs;
    } });
    d.nets.bridge = { name: "bridge", id: Dk.hex("net-bridge", 64), driver: "bridge", subnet: "172.17.0.0/16", gw: "172.17.0.1", dflt: true, dns: false, created: -86400 * 20 };
    d.nets.host = { name: "host", id: Dk.hex("net-host", 64), driver: "host", dflt: true, created: -86400 * 20 };
    d.nets.none = { name: "none", id: Dk.hex("net-none", 64), driver: "null", dflt: true, created: -86400 * 20 };
    return d;
  }
  function clock(sys) { return state(sys).t; }
  function tick(sys, secs) { state(sys).t += secs == null ? 1 : secs; }
  function stamp(sys, t) { return NOW + (t == null ? clock(sys) : t) * 1000; }
  function iso(sys, t) { return new Date(stamp(sys, t)).toISOString().replace(/\.\d+Z$/, function (m) { return m.replace("Z", "") + "123456Z"; }); }
  Dk.state = state; Dk.clock = clock; Dk.tick = tick; Dk.stamp = stamp;
  function ev(sys, e) { var d = state(sys); e.t = d.t; e.cmd = sys.cmdIndex; d.events.push(e); if (d.events.length > 200) d.events.shift(); }
  Dk.ev = ev;

  /* ================================================================== images */
  function tagName(ref) { return Dk.shortName(Dk.parseRef(ref)); }
  function findImage(sys, ref) {
    var d = state(sys); if (!ref) return null;
    var r = String(ref).replace(/^sha256:/, "");
    if (/^[0-9a-f]{4,64}$/.test(r)) { var byId = d.images.filter(function (i) { return i.id.slice(7).indexOf(r) === 0; }); if (byId.length === 1) return byId[0]; }
    var p = Dk.parseRef(ref);
    if (p.digest) { var rn = Dk.repoName(p); return d.images.filter(function (i) { return i.digests[rn] === p.digest; })[0] || null; }
    var t = Dk.shortName(p);
    return d.images.filter(function (i) { return i.tags.indexOf(t) >= 0; })[0] || null;
  }
  function addImage(sys, img, tag) {
    var d = state(sys), have = d.images.filter(function (i) { return i.id === img.id; })[0];
    if (!have) { have = Object.assign({}, img, { tags: [], digests: Object.assign({}, img.digests || {}), loadedAt: clock(sys) }); d.images.unshift(have); }
    if (tag) setTag(sys, have, tag);
    return have;
  }
  function setTag(sys, img, tag) {
    var d = state(sys), t = tagName(tag);
    d.images.forEach(function (i) { if (i !== img) { var k = i.tags.indexOf(t); if (k >= 0) i.tags.splice(k, 1); } });
    if (img.tags.indexOf(t) < 0) img.tags.push(t);
  }
  function imgLabel(img) { return img.tags[0] || img.id.slice(7, 19); }
  function shortId(img) { return img.id.slice(7, 19); }
  Dk.findImage = findImage; Dk.addImage = addImage; Dk.setTag = setTag; Dk.imgLabel = imgLabel;

  /* ---------------- registry access and docker login */
  function homeOf(sess) { return sess.uid === 0 ? "/root" : sess.home; }
  function dockerConfig(sess) {
    var t = M2.rd(sess.sys, homeOf(sess) + "/.docker/config.json");
    try { return t ? JSON.parse(t) : {}; } catch (e) { return {}; }
  }
  function b64(s) { return (typeof btoa === "function" ? btoa(s) : Buffer.from(s).toString("base64")); }
  function unb64(s) { try { return typeof atob === "function" ? atob(s) : Buffer.from(s, "base64").toString(); } catch (e) { return ""; } }
  function credsFor(sess, registry) {
    var a = (dockerConfig(sess).auths || {})[registry];
    if (!a || !a.auth) return null;
    var up = unb64(a.auth).split(":");
    return { user: up[0], pass: up.slice(1).join(":") };
  }
  Dk.credsFor = credsFor;
  // Registries with their own idea of who you are (ghcr.io takes GitHub tokens) plug in here.
  Dk.registryAuth = Dk.registryAuth || {};
  function loggedInAs(sess, registry) {
    var cr = credsFor(sess, registry); if (!cr) return null;
    var reg = state(sess.sys).regs[registry];
    var u = reg && reg.users && reg.users[cr.user];
    return u && u.token === cr.pass ? cr.user : null;
  }
  // Can this session read/push repo in that registry? Returns null or the daemon's error text.
  function regAccess(sess, p, push) {
    var reg = state(sess.sys).regs[p.registry];
    if (!reg) return "Error response from daemon: Get \"https://" + p.registry + "/v2/\": dial tcp: lookup " + p.registry + " on 127.0.0.53:53: no such host";
    if (reg.custom && Dk.registryAuth[reg.name]) return Dk.registryAuth[reg.name].access(sess, p, push, credsFor(sess, p.registry));
    if (reg.public && !push) return null;
    if (reg.public && push) return p.registry === "docker.io" ? "denied: requested access to the resource is denied" : null;
    var user = loggedInAs(sess, p.registry);
    if (!user) return push ? "unauthorized: authentication required" : "Error response from daemon: Head \"https://" + p.registry + "/v2/" + p.repo + "/manifests/" + (p.tag || p.digest) + "\": unauthorized: authentication required";
    var u = reg.users[user], ns = p.repo.split("/")[0];
    if (push && u.push.indexOf(ns) < 0) return "denied: requested access to the resource is denied";
    if (!push && u.namespaces.indexOf(ns) < 0) return "Error response from daemon: pull access denied for " + Dk.repoName(p) + ", repository does not exist or may require 'docker login': denied: requested access to the resource is denied";
    return null;
  }
  function regLookup(sys, p) {
    var reg = state(sys).regs[p.registry]; if (!reg) return null;
    var r = reg.repos[p.repo]; if (!r && !p.digest) return null;
    var dg = p.digest || r.tags[p.tag];
    if (!dg || !reg.manifests[dg]) return null;
    if (p.digest && r && !Object.keys(r.tags).some(function (t) { return r.tags[t] === dg; }) && !(r.old || []).some(function (x) { return x === dg; })) return null;
    return { img: reg.manifests[dg], digest: dg };
  }
  Dk.regLookup = regLookup; Dk.regAccess = regAccess; Dk.loggedInAs = loggedInAs;
  // docker pull (also used by run and build). Returns the local image or null after printing the error.
  function pull(sess, ref, io, o) {
    o = o || {};
    var sys = sess.sys, p = Dk.parseRef(ref);
    if (!p.valid) { errl(io, "invalid reference format: repository name (" + p.repo + ") must be lowercase"); return null; }
    var deny = regAccess(sess, p, false);
    if (deny) { errl(io, deny); return null; }
    var hit = regLookup(sys, p);
    if (!hit) {
      if (p.registry === "docker.io") errl(io, "Error response from daemon: " + (state(sys).regs["docker.io"].repos[p.repo] ? "manifest for " + Dk.shortName(p) + " not found: manifest unknown: manifest unknown" : "pull access denied for " + Dk.repoName(p) + ", repository does not exist or may require 'docker login': denied: requested access to the resource is denied"));
      else errl(io, "Error response from daemon: manifest for " + Dk.shortName(p) + (p.digest ? "@" + p.digest : "") + " not found: manifest unknown: manifest unknown");
      return null;
    }
    var d = state(sys), have = d.images.filter(function (i) { return i.id === hit.img.id; })[0];
    var tag = p.tag ? Dk.shortName(p) : null, rn = Dk.repoName(p);
    var fresh = !have || (tag && have.tags.indexOf(tag) < 0);
    if (!o.quiet) {
      out(io, (p.tag || p.digest) + ": Pulling from " + (p.registry === "docker.io" ? p.repo : p.repo) + "\n");
      if (!have) {
        var localLayers = {}; d.images.forEach(function (i) { i.layers.forEach(function (L) { localLayers[L.id] = true; }); });
        hit.img.layers.filter(function (L) { return L.size > 0; }).forEach(function (L) { out(io, L.id.slice(7, 19) + ": " + (localLayers[L.id] ? "Already exists" : "Pull complete") + "\n"); });
      }
      out(io, "Digest: " + hit.digest + "\n");
      out(io, "Status: " + (fresh ? "Downloaded newer image for " : "Image is up to date for ") + (tag || rn + "@" + hit.digest) + "\n");
      out(io, (p.registry === "docker.io" ? "docker.io/" : p.registry + "/") + p.repo.replace(/^library\//, p.registry === "docker.io" ? "library/" : "") + (p.tag ? ":" + p.tag : "@" + hit.digest) + "\n");
    }
    var img = addImage(sys, hit.img, tag);
    img.digests[rn] = hit.digest;
    tick(sys, have ? 1 : 3);
    ev(sys, { kind: "pull", image: img.id, ref: tag || rn });
    return img;
  }
  Dk.pull = pull;

  /* ================================================================== networks and addresses */
  function netFor(sys, name) { return state(sys).nets[name] || null; }
  function allocIp(sys, net) {
    var d = state(sys), k = net.name;
    d.ipSeq[k] = (d.ipSeq[k] || 1) + 1;
    return net.subnet.replace(/\.0\.0\/16$/, ".0." + d.ipSeq[k]);
  }
  function createNet(sys, name, o) {
    var d = state(sys), n = Object.keys(d.nets).filter(function (k) { return d.nets[k].subnet; }).length;
    var net = { name: name, id: Dk.hex("net:" + name + ":" + d.seq++, 64), driver: "bridge", subnet: "172." + (17 + n) + ".0.0/16", gw: "172." + (17 + n) + ".0.1", dns: true, created: clock(sys), labels: (o && o.labels) || {}, internal: !!(o && o.internal) };
    d.nets[name] = net;
    return net;
  }
  Dk.createNet = createNet;
  // Which container answers to `host` from container c (DNS on user-defined networks, IPs everywhere)?
  function resolveFrom(sys, c, host) {
    var d = state(sys);
    if (host === "localhost" || host === "127.0.0.1" || host === c.id.slice(0, 12) || host === c.hostname) return { ctr: c, self: true };
    if (host === "host.docker.internal") return null;
    var mine = c.nets.map(function (n) { return n.net; });
    for (var i = 0; i < d.ctrs.length; i++) {
      var o = d.ctrs[i];
      if (o.state !== "running" && o.state !== "restarting") continue;
      for (var k = 0; k < o.nets.length; k++) {
        var on = o.nets[k];
        if (on.ip === host) return mine.indexOf(on.net) >= 0 || true ? { ctr: o } : null;
        var net = d.nets[on.net];
        if (!net || !net.dns || mine.indexOf(on.net) < 0) continue;
        if (o.name === host || o.id.indexOf(host) === 0 || (on.aliases || []).indexOf(host) >= 0) return { ctr: o };
      }
    }
    return null;
  }
  // Open a TCP connection from container c to host:port. {ok, ctr, app} or {why: dns|refused|timeout}
  function connect(sys, c, host, port) {
    settle(sys);
    var r = resolveFrom(sys, c, host);
    if (!r) return { why: "dns" };
    var t = r.ctr;
    if (t.state !== "running") return { why: "refused", ctr: t };
    var L = (t.app && t.app.listen || []).filter(function (l) { return l.port === port; })[0];
    if (!L) return { why: "refused", ctr: t };
    if (!r.self && /^127\./.test(L.addr)) return { why: "refused", ctr: t };
    if (t.app.readyAt != null && clock(sys) < t.app.readyAt) return { why: "refused", ctr: t, starting: true };
    return { ok: true, ctr: t, app: t.app };
  }
  Dk.resolveFrom = resolveFrom; Dk.connect = connect;

  /* ================================================================== container file systems */
  var DISTRO = function (fsMap) { var os = fsMap["/etc/os-release"]; var t = os ? os.c : ""; return /alpine/i.test(t) ? "alpine" : /ubuntu/i.test(t) ? "ubuntu" : /debian/i.test(t) ? "debian" : /BusyBox/.test(t) ? "busybox" : "scratch"; };
  function newCtrSys(host, rootNode, o) {
    return { host: o.hostname, now: host.now, root: rootNode, pidSeq: 0, actions: [], seed: 7, procs: [], nextPid: 2, jobs: [], units: {}, journal: [], mounts: [], pkgs: {}, dkHost: host, dkCtr: o.id, ip: o.ip, distro: o.distro, inBuild: !!o.build, topSession: null };
  }
  Dk.newCtrSys = newCtrSys; Dk.DISTRO = DISTRO;
  function ctrFs(sys, c) {
    if (c.fs) return c.fs;
    var img = imageById(sys, c.image);
    var map = Dk.merge(img ? img.layers : []);
    Object.keys(c.rw || {}).forEach(function (p) { map[p] = c.rw[p]; });
    var rootN = Dk.treeFrom(map, stamp(sys, c.created));
    if (!map["/etc/passwd"]) { var et = rootN.children.etc || (rootN.children.etc = S.dirNode(493, 0, 0)); et.children.passwd = S.fileNode("root:x:0:0:root:/root:/bin/sh\n", 420, 0, 0); et.children.group = S.fileNode("root:x:0:\n", 420, 0, 0); }
    c.fs = newCtrSys(sys, rootN, { hostname: c.hostname, id: c.id, ip: (c.nets[0] || {}).ip, distro: DISTRO(map) });
    S.put(c.fs, "/etc/hostname", c.hostname + "\n", 420);
    S.put(c.fs, "/etc/hosts", "127.0.0.1\tlocalhost\n::1\tlocalhost ip6-localhost ip6-loopback\n" + c.nets.map(function (n) { return n.ip + "\t" + c.hostname; }).join("\n") + "\n", 420);
    var dns = c.nets.some(function (n) { var nn = netFor(sys, n.net); return nn && nn.dns; });
    S.put(c.fs, "/etc/resolv.conf", dns ? "# Generated by Docker Engine.\nnameserver 127.0.0.11\noptions ndots:0\n" : "# Generated by Docker Engine.\nnameserver 10.20.0.2\nsearch kestrel.internal\n", 420);
    c.fs.imgMap = map;
    return c.fs;
  }
  function imageById(sys, id) { return state(sys).images.filter(function (i) { return i.id === id; })[0] || c_imgCache[id] || null; }
  var c_imgCache = {};
  Dk.ctrFs = ctrFs; Dk.imageById = imageById;
  // Volumes and bind mounts: copy the source tree into the container, and changes back out.
  function hostNode(sys, path) { var r = S.lookup({ sys: sys, uid: 0, gid: 0, groups: [], cwd: "/", umask: 18, vars: {} }, path); return r.node || null; }
  function clone(n) {
    var c = {}; Object.keys(n).forEach(function (k) { if (k !== "children") c[k] = n[k]; });
    if (n.children) { c.children = {}; Object.keys(n.children).forEach(function (k) { c.children[k] = clone(n.children[k]); }); }
    return c;
  }
  Dk.cloneNode = clone;
  function placeNode(rootSys, path, node) {
    var segs = path.split("/").filter(Boolean), d = rootSys.root;
    for (var i = 0; i < segs.length - 1; i++) { if (!d.children[segs[i]] || d.children[segs[i]].type !== "d") d.children[segs[i]] = S.dirNode(493, 0, 0); d = d.children[segs[i]]; }
    d.children[segs[segs.length - 1]] = node;
  }
  function mountSrc(m) { return m.type === "volume" ? "/var/lib/docker/volumes/" + m.name + "/_data" : m.src; }
  function syncIn(sys, c) {
    var fs = ctrFs(sys, c);
    (c.mounts || []).forEach(function (m) {
      if (m.type === "tmpfs") { if (!m.made) { placeNode(fs, m.dst, S.dirNode(1023, 0, 0)); m.made = true; } return; }
      var src = hostNode(sys, mountSrc(m));
      if (!src) return;
      placeNode(fs, m.dst, clone(src));
    });
    (c.secrets || []).forEach(function (s) { var n = hostNode(sys, s.src); if (n) { var k = clone(n); k.mode = 292; placeNode(fs, s.dst, k); } });
  }
  function syncOut(sys, c) {
    if (!c.fs) return [];
    var problems = [];
    (c.mounts || []).forEach(function (m) {
      if (m.type === "tmpfs") return;
      var inC = hostNode(c.fs, m.dst), path = mountSrc(m);
      if (!inC) return;
      if (m.ro) {
        var src = hostNode(sys, path);
        if (src) { var a1 = Dk.mapFrom(src, "/"), b1 = Dk.mapFrom(inC, "/"), bad1 = Object.keys(b1).filter(function (k) { return !a1[k] || !Dk.sameEntry(a1[k], b1[k]); })[0] || Object.keys(a1).filter(function (k) { return !b1[k]; })[0]; if (bad1) { problems.push(m.dst + bad1); placeNode(c.fs, m.dst, clone(src)); } }
        return;
      }
      placeNode(sys, path, clone(inC));
    });
    return problems;
  }
  Dk.syncIn = syncIn; Dk.syncOut = syncOut; Dk.mountSrc = mountSrc;
  // Snapshot of the container's own (non-mounted) files, for --read-only checks.
  function ownMap(c) {
    var m = Dk.mapFrom(c.fs.root, "/"), skip = (c.mounts || []).map(function (x) { return x.dst; }).concat(["/tmp", "/run", "/proc", "/dev", "/etc/hosts", "/etc/hostname", "/etc/resolv.conf"]).concat((c.secrets || []).map(function (s) { return s.dst; }));
    Object.keys(m).forEach(function (p) { if (skip.some(function (s) { return p === s || p.indexOf(s + "/") === 0; })) delete m[p]; });
    return m;
  }

  /* ================================================================== running things inside a container */
  function ctrEnv(sys, c) {
    var img = imageById(sys, c.image), env = {};
    ((img && img.cfg.Env) || []).forEach(function (kv) { var i = kv.indexOf("="); env[kv.slice(0, i)] = kv.slice(i + 1); });
    Object.keys(c.env || {}).forEach(function (k) { env[k] = c.env[k]; });
    env.HOSTNAME = c.hostname;
    return env;
  }
  function userEntry(fs, spec) {
    var u = String(spec || "").split(":")[0], g = String(spec || "").split(":")[1];
    var rows = (M2.rd(fs, "/etc/passwd") || "").split("\n").filter(Boolean).map(function (l) { return l.split(":"); });
    var hit = rows.filter(function (r) { return r[0] === u || (/^\d+$/.test(u) && r[2] === u); })[0];
    if (!u || u === "root" || u === "0") hit = rows.filter(function (r) { return r[2] === "0"; })[0] || ["root", "x", "0", "0", "root", "/root", "/bin/sh"];
    if (!hit && /^\d+$/.test(u)) return { name: null, uid: +u, gid: g && /^\d+$/.test(g) ? +g : +u, home: "/" };
    if (!hit) return null;
    return { name: hit[0], uid: +hit[2], gid: g && /^\d+$/.test(g) ? +g : +hit[3], home: hit[5] || "/" };
  }
  Dk.userEntry = userEntry;
  // A shell session inside the container, as the container's (or exec's) user.
  function ctrSession(sys, c, o) {
    o = o || {};
    var fs = ctrFs(sys, c), img = imageById(sys, c.image);
    var ue = userEntry(fs, o.user != null ? o.user : c.user != null ? c.user : (img && img.cfg.User) || "");
    if (!ue) return { error: "unable to find user " + String(o.user || c.user || img.cfg.User).split(":")[0] + ": no matching entries in passwd file" };
    var sess = S.newSession(fs, { user: ue.name || "root" });
    sess.vars = {};
    var env = ctrEnv(sys, c);
    Object.keys(o.env || {}).forEach(function (k) { env[k] = o.env[k]; });
    if (!env.PATH) env.PATH = Dk.PATHV;
    env.HOME = env.HOME || ue.home;
    Object.keys(env).forEach(function (k) { sess.vars[k] = { v: env[k], x: true }; });
    sess.vars.IFS = { v: " \t\n", x: false };
    sess.vars.PS1 = { v: "\\u@\\h:\\w\\$ ", x: false };
    sess.uid = ue.uid; sess.gid = ue.gid; sess.user = ue.name || "I have no name!"; sess.home = ue.home; sess.groups = ue.name ? S.supplementary(fs, ue.name) : [];
    sess.umask = 18;
    var wd = o.workdir || c.workdir || (img && img.cfg.WorkingDir) || "/";
    if (!hostNode(fs, wd)) S.mkdirs(fs, wd);
    sess.cwd = wd; sess.vars.PWD = { v: wd, x: true };
    sess.dkCtr = c.id;
    return { sess: sess };
  }
  Dk.ctrSession = ctrSession;
  function capture() {
    var lines = [];
    var io = { stdin: "", tty: false, out: function (t) { push(t, "out"); }, err: function (t) { push(t, "err"); }, note: function () {}, color: function (t) { push(t, "out"); } };
    function push(t, s) { String(t).split(/(?<=\n)/).forEach(function (piece) { if (!piece) return; var last = lines[lines.length - 1]; if (last && last.s === s && !/\n$/.test(last.text)) last.text += piece; else lines.push({ s: s, text: piece }); }); }
    return { io: io, lines: lines, text: function (s) { return lines.filter(function (l) { return !s || l.s === s; }).map(function (l) { return l.text; }).join(""); } };
  }
  Dk.capture = capture;
  // Run argv inside the container to completion. Returns {code, lines, error}
  function runIn(sys, c, argv, o) {
    o = o || {};
    var cs = ctrSession(sys, c, o);
    if (cs.error) return { code: 126, error: cs.error, lines: [] };
    var sess = cs.sess, cap = capture();
    sess.dkMain = !!o.main;
    if (o.stdin != null) cap.io.stdin = o.stdin;
    var before = c.readOnly ? ownMap(c) : null;
    var found = S.resolveCommand(sess, argv[0]);
    if (found.error && !S.BUILTINS[argv[0]]) return { code: 127, error: "exec: \"" + argv[0] + "\": executable file not found in $PATH", lines: [], notFound: true };
    var code;
    try { code = S.runCommand(sess, argv, cap.io); }
    catch (e) {
      if (e instanceof S.ExitSignal) code = e.code;
      else if (e instanceof S.ShError) { cap.io.err(e.message + "\n"); code = e.code; }
      else if (e instanceof S.StepLimit) { cap.io.err("(stopped: the command ran too long)\n"); code = 137; }
      else if (e && e.name === "BlockSignal" || (M2.BlockSignal && e instanceof M2.BlockSignal)) { code = 0; }
      else throw e;
    }
    if (before) roCheck(c, before, cap.io, argv);
    var bad = syncOut(sys, c);
    bad.forEach(function (p) { cap.io.err((/^(sh|bash|ash)$/.test(String(argv[0]).split("/").pop()) ? "sh: can't create " : String(argv[0]).split("/").pop() + ": ") + p + ": Read-only file system\n"); });
    return { code: code || 0, lines: cap.lines, cap: cap };
  }
  Dk.runIn = runIn;
  function roCheck(c, before, io, argv) {
    var after = ownMap(c), changed = Object.keys(after).filter(function (p) { return !before[p] || !Dk.sameEntry(before[p], after[p]); });
    if (!changed.length) return;
    var prog = String((argv || ["sh"])[0]).split("/").pop();
    io.err((/^(sh|bash|ash)$/.test(prog) ? "sh: can't create " : prog + ": ") + changed[0] + ": Read-only file system\n");
    var fresh = Dk.treeFrom(Object.assign(before, mountedParts(c)), stamp(c.fs.dkHost));
    c.fs.root = fresh;
  }
  function mountedParts(c) {
    var m = Dk.mapFrom(c.fs.root, "/"), keep = {};
    var skip = (c.mounts || []).map(function (x) { return x.dst; }).concat(["/tmp", "/run", "/proc", "/dev", "/etc/hosts", "/etc/hostname", "/etc/resolv.conf"]).concat((c.secrets || []).map(function (s) { return s.dst; }));
    Object.keys(m).forEach(function (p) { if (skip.some(function (s) { return p === s || p.indexOf(s + "/") === 0; })) keep[p] = m[p]; });
    return keep;
  }

  /* ================================================================== containers */
  var ADJ = ["admiring", "brave", "clever", "dazzling", "eager", "festive", "gifted", "happy", "jolly", "keen", "lucid", "modest", "nifty", "optimistic", "quirky", "relaxed", "serene", "tender", "upbeat", "vibrant", "wizardly", "zealous"];
  var NAMES = ["allen", "bardeen", "curie", "darwin", "euler", "feynman", "goldberg", "hopper", "hamilton", "johnson", "kalam", "lovelace", "mayer", "noether", "pike", "ritchie", "shannon", "thompson", "turing", "wozniak", "yalow", "zhukovsky"];
  function genName(sys) { var d = state(sys), k = d.seq; return ADJ[(k * 7 + 3) % ADJ.length] + "_" + NAMES[(k * 11 + 5) % NAMES.length]; }
  function ctrBy(sys, ref) {
    var d = state(sys); if (!ref) return null;
    var byName = d.ctrs.filter(function (c) { return c.name === ref || c.name === ref.replace(/^\//, ""); })[0];
    if (byName) return byName;
    if (/^[0-9a-f]{2,64}$/.test(ref)) { var hits = d.ctrs.filter(function (c) { return c.id.indexOf(ref) === 0; }); if (hits.length === 1) return hits[0]; }
    return null;
  }
  Dk.ctrBy = ctrBy;
  function createCtr(sys, img, o) {
    var d = state(sys);
    d.seq++;
    var id = Dk.hex("ctr:" + (o.name || "") + ":" + d.seq + ":" + img.id, 64);
    var c = {
      id: id, name: o.name || genName(sys), image: img.id, imageRef: o.imageRef || imgLabel(img), created: clock(sys), state: "created", exitCode: 0, started: null, finished: null,
      cmd: o.cmd && o.cmd.length ? o.cmd : null, entrypoint: o.entrypoint != null ? o.entrypoint : null, env: o.env || {}, ports: o.ports || [], mounts: o.mounts || [], secrets: o.secrets || [],
      restart: o.restart || { name: "no", max: 0 }, user: o.user != null ? o.user : null, workdir: o.workdir || null, labels: o.labels || {}, hostname: o.hostname || id.slice(0, 12),
      nets: [], logs: [], restarts: 0, autoRm: !!o.rm, readOnly: !!o.readOnly, capDrop: o.capDrop || [], capAdd: o.capAdd || [], secOpt: o.secOpt || [], privileged: !!o.privileged,
      mem: o.mem || 0, cpus: o.cpus || 0, health: null, healthcheck: o.healthcheck !== undefined ? o.healthcheck : null, compose: o.compose || null, tty: !!o.tty, rw: null, oom: false, stoppedByUser: false, init: !!o.init, pidHost: !!o.pidHost
    };
    var netName = o.network || "bridge";
    if (netName !== "host" && netName !== "none") {
      var net = netFor(sys, netName);
      c.nets.push({ net: net.name, ip: allocIp(sys, net), aliases: o.aliases || [] });
    }
    (o.extraNets || []).forEach(function (n) { var net = netFor(sys, n.net || n); c.nets.push({ net: net.name, ip: allocIp(sys, net), aliases: n.aliases || [] }); });
    c.networkMode = netName;
    // image VOLUME entries become anonymous volumes
    Object.keys(img.cfg.Volumes || {}).forEach(function (p) {
      if (c.mounts.some(function (m) { return m.dst === p; })) return;
      var vn = Dk.hex("anon:" + id + p, 64);
      makeVolume(sys, vn, { anonymous: true });
      c.mounts.push({ type: "volume", name: vn, dst: p, anon: true });
    });
    c.mounts.forEach(function (m) { if (m.type === "volume") makeVolume(sys, m.name, {}); });
    d.ctrs.unshift(c);
    (d.ever = d.ever || []).push(c);
    ev(sys, { kind: "create", ctr: c.id });
    return c;
  }
  Dk.createCtr = createCtr;
  function argvOf(sys, c) {
    var img = imageById(sys, c.image);
    var ep = c.entrypoint != null ? c.entrypoint : (img.cfg.Entrypoint || []);
    var cmd = c.cmd || (c.entrypoint != null && c.entrypoint.length ? [] : img.cfg.Cmd || []);
    return ep.concat(cmd);
  }
  Dk.argvOf = argvOf;
  // Start the main process. Returns {ok} or {error, code} (the daemon's start errors).
  function startCtr(sys, c, o) {
    o = o || {};
    if (c.state === "running") return { ok: true };
    c.fs = c.autoRm ? c.fs : c.fs;
    ctrFs(sys, c);
    syncIn(sys, c);
    var argv = argvOf(sys, c);
    if (!argv.length) return fail(c, sys, 127, "no command specified");
    c.started = clock(sys); c.finished = null; c.oom = false;
    var launched = Dk.launch(sys, c, argv, o);
    if (launched.startError) { c.state = "created"; c.exitCode = launched.code; return { error: launched.startError, code: launched.code }; }
    c.app = launched;
    (launched.logs || []).forEach(function (l) { logLine(sys, c, l[0], l[1], l[2]); });
    if (launched.kind === "done") { exitCtr(sys, c, launched.code, true); return { ok: true, done: true }; }
    c.state = "running";
    c.health = c.healthCfg ? null : null;
    var hc = healthCfg(sys, c);
    c.health = hc ? { status: "starting", failing: 0, log: [], checked: 0 } : null;
    hostProcs(sys, c, true);
    ev(sys, { kind: "start", ctr: c.id });
    if (launched.crashAt != null) c.crashAt = launched.crashAt;
    return { ok: true };
  }
  function fail(c, sys, code, msg) { c.state = "created"; c.exitCode = code; return { error: msg, code: code }; }
  Dk.startCtr = startCtr;
  function logLine(sys, c, stream, text, at) {
    String(text).replace(/\n$/, "").split("\n").forEach(function (l) { c.logs.push({ t: at != null ? at : clock(sys), s: stream, text: l }); });
  }
  Dk.logLine = logLine;
  function exitCtr(sys, c, code, natural) {
    if (c.state !== "running" && c.state !== "created" && c.state !== "restarting") { c.exitCode = code; return; }
    c.state = "exited"; c.exitCode = code; c.finished = clock(sys);
    hostProcs(sys, c, false);
    if (c.app && c.app.onStop) c.app.onStop(sys, c);
    if (c.fs) syncOut(sys, c);
    if (c.health) c.health.status = "unhealthy";
    ev(sys, { kind: natural ? "die" : "stop", ctr: c.id, code: code });
    if (natural && wantsRestart(c)) { c.state = "restarting"; c.restartAt = clock(sys) + Math.min(60, Math.pow(2, Math.min(c.restarts, 6)) * 0.5); }
    else if (c.autoRm) removeCtr(sys, c, false);
  }
  Dk.exitCtr = exitCtr;
  function wantsRestart(c) {
    var p = c.restart.name;
    if (c.stoppedByUser) return false;
    if (p === "always" || p === "unless-stopped") return true;
    if (p === "on-failure") return c.exitCode !== 0 && (!c.restart.max || c.restarts < c.restart.max);
    return false;
  }
  function stopCtr(sys, c, sig) {
    if (c.state === "restarting") { c.state = "exited"; c.stoppedByUser = true; return; }
    if (c.state !== "running") return;
    c.stoppedByUser = true;
    var code = sig === "KILL" ? 137 : c.app && c.app.stopCode != null ? c.app.stopCode : 0;
    if (c.app && c.app.ignoresTerm && sig !== "KILL") { code = 137; }
    exitCtr(sys, c, code, false);
  }
  function removeCtr(sys, c, vols) {
    var d = state(sys), i = d.ctrs.indexOf(c);
    if (i >= 0) d.ctrs.splice(i, 1);
    hostProcs(sys, c, false);
    c.mounts.forEach(function (m) { if (m.type === "volume" && (m.anon && (vols || c.autoRm))) removeVolume(sys, m.name); });
    ev(sys, { kind: "destroy", ctr: c.id, name: c.name });
  }
  Dk.stopCtr = stopCtr; Dk.removeCtr = removeCtr;
  // The container's processes, as the laptop sees them (ps aux shows them, as their real UID).
  function hostProcs(sys, c, on) {
    if (!sys.procs) return;
    sys.procs.filter(function (p) { return p.dkCtr === c.id; }).forEach(function (p) { M2.removeProc(sys, p); });
    if (!on) return;
    var shim = M2.spawn(sys, { cmd: "/usr/bin/containerd-shim-runc-v2 -namespace moby -id " + c.id + " -address /run/containerd/containerd.sock", comm: "containerd-shim", uid: 0, dkCtr: c.id });
    var argv = argvOf(sys, c), ue = userEntry(ctrFs(sys, c), c.user != null ? c.user : imageById(sys, c.image).cfg.User);
    var main = argv.join(" ").replace(/^\/docker-entrypoint\.sh |^docker-entrypoint\.sh /, "");
    if (/^nginx\b/.test(main)) main = "nginx: master process nginx -g daemon off;";
    M2.spawn(sys, { cmd: main, uid: ue ? ue.uid : 0, ppid: shim.pid, dkCtr: c.id, rss: (c.app && c.app.mem || 20e6) / 1024 });
    c.ports.forEach(function (p) {
      [p.hostIp].forEach(function (hip) {
        M2.spawn(sys, { cmd: "/usr/bin/docker-proxy -proto " + p.proto + " -host-ip " + hip + " -host-port " + p.hostPort + " -container-ip " + (c.nets[0] || {}).ip + " -container-port " + p.ctrPort, comm: "docker-proxy", uid: 0, dkCtr: c.id, dkPort: p, listen: [{ proto: p.proto, addr: hip, port: p.hostPort }] });
      });
    });
  }

  /* ================================================================== volumes */
  function makeVolume(sys, name, o) {
    var d = state(sys);
    if (d.vols[name]) return d.vols[name];
    var v = d.vols[name] = { name: name, created: clock(sys), labels: (o && o.labels) || {}, anonymous: !!(o && o.anonymous), driver: "local" };
    S.mkdirs(sys, "/var/lib/docker/volumes/" + name + "/_data", 493, 0, 0);
    return v;
  }
  function removeVolume(sys, name) {
    var d = state(sys); delete d.vols[name];
    var vd = hostNode(sys, "/var/lib/docker/volumes");
    if (vd && vd.children) delete vd.children[name];
  }
  function volumeInUse(sys, name) { return state(sys).ctrs.filter(function (c) { return c.mounts.some(function (m) { return m.type === "volume" && m.name === name; }); }); }
  Dk.makeVolume = makeVolume; Dk.removeVolume = removeVolume; Dk.volumeInUse = volumeInUse;

  /* ================================================================== time passes: restarts, health checks, crashes */
  function healthCfg(sys, c) {
    if (c.healthcheck === false) return null;
    var h = c.healthcheck || (imageById(sys, c.image) || { cfg: {} }).cfg.Healthcheck;
    if (!h || !h.Test || h.Test[0] === "NONE") return null;
    return { test: h.Test, interval: h.Interval || 30, timeout: h.Timeout || 30, retries: h.Retries || 3, start: h.StartPeriod || 0 };
  }
  Dk.healthCfg = healthCfg;
  function runHealth(sys, c, hc) {
    var t = hc.test, argv;
    if (t[0] === "CMD-SHELL") argv = ["/bin/sh", "-c", t.slice(1).join(" ")];
    else if (t[0] === "CMD") argv = t.slice(1);
    else argv = ["/bin/sh", "-c", t.join(" ")];
    var r = runIn(sys, c, argv, {});
    var outText = r.error ? "OCI runtime exec failed: " + r.error + ": unknown" : r.lines.map(function (l) { return l.text; }).join("");
    return { ok: !r.error && r.code === 0, code: r.error ? -1 : r.code, out: outText };
  }
  var settling = false;
  function settle(sys) {
    if (settling || !sys.dk) return;
    settling = true;
    try {
      var d = state(sys), t = d.t;
      for (var round = 0; round < 3; round++) {
        d.ctrs.slice().forEach(function (c) {
          if (c.state === "running" && c.crashAt != null && t >= c.crashAt) { var cr = c.app.crash(sys, c); c.crashAt = null; if (cr) { (cr.logs || []).forEach(function (l) { logLine(sys, c, l[0], l[1]); }); if (cr.oom) c.oom = true; exitCtr(sys, c, cr.code, true); } }
          if (c.state === "running" && c.app && c.app.tickFn) c.app.tickFn(sys, c, t);
          if (c.state === "restarting" && t >= c.restartAt) {
            c.restarts++; c.state = "exited";
            var r = startCtr(sys, c, { restart: true });
            if (r.error) { c.state = "exited"; }
          }
          var hc = c.state === "running" && c.health ? healthCfg(sys, c) : null;
          if (hc) {
            var due = Math.floor((t - c.started) / hc.interval);
            if (due > c.health.checked) {
              var from = Math.max(c.health.checked + 1, due - hc.retries);
              for (var k = from; k <= due; k++) {
                var at = c.started + k * hc.interval, res = runHealth(sys, c, hc);
                c.health.log.push({ start: at, exit: res.code, out: res.out });
                if (c.health.log.length > 5) c.health.log.shift();
                if (res.ok) { c.health.failing = 0; c.health.status = "healthy"; }
                else if (at - c.started >= hc.start) { c.health.failing++; if (c.health.failing >= hc.retries) c.health.status = "unhealthy"; }
              }
              c.health.checked = due;
            }
          }
        });
      }
    } finally { settling = false; }
  }
  Dk.settle = settle;
  // Let time pass (sleep on the laptop, compose waiting for health checks).
  function advance(sys, secs) { if (!sys.dk) return; var d = state(sys), end = d.t + secs; while (d.t < end) { d.t = Math.min(end, d.t + 1); settle(sys); } }
  Dk.advance = advance;

  /* ================================================================== HTTP: the laptop's curl reaches containers through docker-proxy */
  M2.appHandlers = M2.appHandlers || [];
  M2.appHandlers.push(function (sys, proc, req) {
    if (proc.comm !== "docker-proxy" || !proc.dkCtr || !sys.dk) return null;
    settle(sys);
    var c = state(sys).ctrs.filter(function (x) { return x.id === proc.dkCtr; })[0];
    if (!c || c.state !== "running") return { closed: true };
    return ctrHttp(sys, c, proc.dkPort.ctrPort, req, "172.17.0.1");
  });
  function ctrHttp(sys, c, port, req, from) {
    var app = c.app;
    var L = (app && app.listen || []).filter(function (l) { return l.port === port; })[0];
    if (!L || /^127\./.test(L.addr)) return { closed: true };
    if (app.readyAt != null && clock(sys) < app.readyAt) return { closed: true };
    if (!app.http) return { proto: true };
    syncIn(sys, c);
    var r = app.http(sys, c, req, from || "172.17.0.1");
    if (!r) return { closed: true };
    r.headers = Object.assign({ Date: new Date(stamp(sys)).toUTCString() }, r.headers || {});
    if (r.body != null && !r.headers["Content-Length"]) r.headers["Content-Length"] = String(U.bytes ? U.bytes(r.body) : r.body.length);
    return r;
  }
  Dk.ctrHttp = ctrHttp;

  /* ================================================================== output helpers */
  // Like Go's tabwriter with padding 3: every column but the last is padded to its widest cell.
  function table(rows) {
    var w = [];
    rows.forEach(function (r) { r.forEach(function (cell, i) { if (i < r.length - 1) w[i] = Math.max(w[i] || 0, String(cell).length); }); });
    return rows.map(function (r) { return r.map(function (cell, i) { return i < r.length - 1 ? String(cell) + new Array(w[i] - String(cell).length + 4).join(" ") : String(cell); }).join("").replace(/\s+$/, ""); }).join("\n") + "\n";
  }
  Dk.table = table;
  function statusText(sys, c) {
    var t = clock(sys);
    if (c.state === "running") {
      var h = c.health ? (c.health.status === "starting" ? " (health: starting)" : " (" + c.health.status + ")") : "";
      return "Up " + Dk.ago(t - c.started) + h;
    }
    if (c.state === "restarting") return "Restarting (" + c.exitCode + ") " + Dk.ago(t - c.finished) + " ago";
    if (c.state === "exited") return "Exited (" + c.exitCode + ") " + Dk.ago(t - c.finished) + " ago";
    if (c.state === "paused") return "Up " + Dk.ago(t - c.started) + " (Paused)";
    return "Created";
  }
  function portsText(c) {
    var rows = [];
    c.ports.forEach(function (p) { rows.push(p.hostIp + ":" + p.hostPort + "->" + p.ctrPort + "/" + p.proto); if (p.hostIp === "0.0.0.0") rows.push("[::]:" + p.hostPort + "->" + p.ctrPort + "/" + p.proto); });
    return rows.join(", ");
  }
  function exposedText(sys, c) {
    if (c.state !== "running") return "";
    var pub = portsText(c);
    var exp = Object.keys((imageById(sys, c.image) || { cfg: {} }).cfg.ExposedPorts || {}).filter(function (p) { return !c.ports.some(function (x) { return x.ctrPort + "/" + x.proto === p; }); });
    return [pub].concat(exp).filter(Boolean).join(", ");
  }
  function cmdText(sys, c) { var a = argvOf(sys, c).join(" "); return "\"" + (a.length > 20 ? a.slice(0, 20) + "…" : a) + "\""; }
  Dk.statusText = statusText; Dk.portsText = portsText; Dk.cmdText = cmdText;

  /* ---------------- Go templates for --format (the subset people actually use) */
  function tmplGet(obj, path) {
    if (path === "." || path === "") return obj;
    var segs = path.replace(/^\./, "").split(".");
    var v = obj;
    for (var i = 0; i < segs.length; i++) { if (v == null) return undefined; v = v[segs[i]]; }
    return v;
  }
  function goStr(v) {
    if (v === undefined) return "<no value>";
    if (v === null) return "<nil>";
    if (Array.isArray(v)) return "[" + v.map(goStr).join(" ") + "]";
    if (typeof v === "object") return "map[" + Object.keys(v).sort().map(function (k) { return k + ":" + goStr(v[k]); }).join(" ") + "]";
    return String(v);
  }
  function template(fmt, data) {
    var toks = [], re = /\{\{-?\s*(.*?)\s*-?\}\}/g, last = 0, m;
    while ((m = re.exec(fmt))) { if (m.index > last) toks.push({ text: fmt.slice(last, m.index) }); toks.push({ act: m[1] }); last = re.lastIndex; }
    if (last < fmt.length) toks.push({ text: fmt.slice(last) });
    var pos = 0;
    function evalExpr(e, dot) {
      e = e.trim();
      var parts = e.match(/"[^"]*"|\S+/g) || [];
      if (parts[0] === "json") { var v = evalExpr(parts.slice(1).join(" "), dot); return JSON.stringify(v === undefined ? null : v); }
      if (parts[0] === "index") { var base = evalExpr(parts[1], dot), key = parts[2]; key = /^"/.test(key) ? key.slice(1, -1) : /^\d+$/.test(key) ? +key : evalExpr(key, dot); return base == null ? undefined : base[key]; }
      if (parts[0] === "len") { var lv = evalExpr(parts[1], dot); return lv == null ? 0 : (Array.isArray(lv) || typeof lv === "string") ? lv.length : Object.keys(lv).length; }
      if (parts[0] === "lower") return String(evalExpr(parts[1], dot)).toLowerCase();
      if (parts[0] === "upper") return String(evalExpr(parts[1], dot)).toUpperCase();
      if (parts[0] === "join") { var jv = evalExpr(parts[1], dot); return (jv || []).join(parts[2] ? parts[2].replace(/^"|"$/g, "") : ""); }
      if (parts[0] === "println") return parts.slice(1).map(function (p) { return goStr(evalExpr(p, dot)); }).join(" ") + "\n";
      if (/^"/.test(parts[0])) return parts[0].slice(1, -1);
      if (parts[0] === "$") return data;
      return tmplGet(dot, parts[0]);
    }
    function block(dot, stopAt) {
      var s = "";
      while (pos < toks.length) {
        var tk = toks[pos];
        if (tk.text != null) { s += tk.text; pos++; continue; }
        var a = tk.act;
        if (stopAt.indexOf(a.split(/\s+/)[0]) >= 0) return s;
        pos++;
        if (/^range\s/.test(a)) {
          var coll = evalExpr(a.slice(6), dot), startPos = pos, body = "";
          var items = coll == null ? [] : Array.isArray(coll) ? coll : Object.keys(coll).sort().map(function (k) { return coll[k]; });
          if (!items.length) { block(dot, ["end"]); pos++; continue; }
          items.forEach(function (it) { pos = startPos; body += block(it, ["end"]); });
          pos++; s += body; continue;
        }
        if (/^if\s/.test(a)) {
          var cond = evalExpr(a.slice(3), dot), truthy = !!cond && !(Array.isArray(cond) && !cond.length) && cond !== "false";
          var yes = block(dot, ["else", "end"]), no = "";
          if (toks[pos] && /^else/.test(toks[pos].act)) { pos++; no = block(dot, ["end"]); }
          pos++;
          s += truthy ? yes : no; continue;
        }
        var v = evalExpr(a, dot);
        s += typeof v === "string" ? v : goStr(v);
      }
      return s;
    }
    return block(data, []);
  }
  Dk.template = template;
  function unesc(f) { return String(f).replace(/\\t/g, "\t").replace(/\\n/g, "\n"); }
  // --format "table {{.Names}}\t{{.Status}}"
  function formatRows(fmt, items, headers) {
    fmt = unesc(fmt);
    var tableMode = /^table\s?/.test(fmt);
    if (tableMode) fmt = fmt.replace(/^table\s?/, "");
    var rows = items.map(function (it) { return template(fmt, it); });
    if (!tableMode) return rows.map(function (r) { return r + "\n"; }).join("");
    var head = template(fmt.replace(/\{\{\s*\.(\w+)\s*\}\}/g, function (m0, k) { return headers[k] || k.toUpperCase(); }), {});
    return table([head].concat(rows).map(function (r) { return r.split("\t"); }));
  }
  Dk.formatRows = formatRows;

  /* ================================================================== inspect documents */
  function ctrDoc(sys, c) {
    var img = imageById(sys, c.image) || { cfg: {} };
    var env = ctrEnv(sys, c); delete env.HOSTNAME;
    var running = c.state === "running";
    return {
      Id: c.id, Created: iso(sys, c.created), Path: argvOf(sys, c)[0], Args: argvOf(sys, c).slice(1),
      State: { Status: c.state, Running: running, Paused: false, Restarting: c.state === "restarting", OOMKilled: !!c.oom, Dead: false, Pid: running ? 4000 + (M2.hash(c.id) % 3000) : 0, ExitCode: c.exitCode, Error: "", StartedAt: c.started != null ? iso(sys, c.started) : "0001-01-01T00:00:00Z", FinishedAt: c.finished != null ? iso(sys, c.finished) : "0001-01-01T00:00:00Z", Health: c.health ? { Status: c.health.status, FailingStreak: c.health.failing, Log: c.health.log.map(function (l) { return { Start: iso(sys, l.start), End: iso(sys, l.start), ExitCode: l.exit, Output: l.out }; }) } : undefined },
      Image: img.id, ResolvConfPath: "/var/lib/docker/containers/" + c.id + "/resolv.conf", HostnamePath: "/var/lib/docker/containers/" + c.id + "/hostname", LogPath: "/var/lib/docker/containers/" + c.id + "/" + c.id + "-json.log",
      Name: "/" + c.name, RestartCount: c.restarts, Driver: "overlay2", Platform: "linux",
      HostConfig: { Binds: c.mounts.filter(function (m) { return m.type === "bind" || (m.type === "volume" && !m.anon && !m.viaMount); }).map(function (m) { return (m.type === "bind" ? m.src : m.name) + ":" + m.dst + (m.ro ? ":ro" : ""); }), NetworkMode: c.networkMode, PortBindings: c.ports.reduce(function (o, p) { (o[p.ctrPort + "/" + p.proto] = o[p.ctrPort + "/" + p.proto] || []).push({ HostIp: p.hostIp === "0.0.0.0" ? "" : p.hostIp, HostPort: String(p.hostPort) }); return o; }, {}), RestartPolicy: { Name: c.restart.name, MaximumRetryCount: c.restart.max || 0 }, AutoRemove: c.autoRm, CapAdd: c.capAdd.length ? c.capAdd : null, CapDrop: c.capDrop.length ? c.capDrop : null, Privileged: c.privileged, ReadonlyRootfs: c.readOnly, SecurityOpt: c.secOpt.length ? c.secOpt : null, Memory: c.mem, NanoCpus: Math.round(c.cpus * 1e9), PidMode: c.pidHost ? "host" : "", Init: c.init || null },
      Mounts: c.mounts.map(function (m) { return m.type === "volume" ? { Type: "volume", Name: m.name, Source: "/var/lib/docker/volumes/" + m.name + "/_data", Destination: m.dst, Driver: "local", Mode: m.ro ? "ro" : "z", RW: !m.ro, Propagation: "" } : m.type === "tmpfs" ? { Type: "tmpfs", Source: "", Destination: m.dst, Mode: "", RW: true, Propagation: "" } : { Type: "bind", Source: m.src, Destination: m.dst, Mode: m.ro ? "ro" : "", RW: !m.ro, Propagation: "rprivate" }; }),
      Config: { Hostname: c.hostname, User: c.user != null ? c.user : img.cfg.User || "", Tty: c.tty, Env: Object.keys(env).map(function (k) { return k + "=" + env[k]; }), Cmd: c.cmd || img.cfg.Cmd, Image: c.imageRef, WorkingDir: c.workdir || img.cfg.WorkingDir || "", Entrypoint: c.entrypoint != null ? c.entrypoint : img.cfg.Entrypoint, Labels: Object.assign({}, img.cfg.Labels || {}, c.labels), ExposedPorts: img.cfg.ExposedPorts, Healthcheck: healthCfg(sys, c) ? (c.healthcheck || img.cfg.Healthcheck) : undefined },
      NetworkSettings: { IPAddress: (c.nets.filter(function (n) { return n.net === "bridge"; })[0] || {}).ip || "", Gateway: c.nets[0] && c.nets[0].net === "bridge" ? "172.17.0.1" : "", Ports: c.ports.reduce(function (o, p) { (o[p.ctrPort + "/" + p.proto] = o[p.ctrPort + "/" + p.proto] || []).push({ HostIp: p.hostIp, HostPort: String(p.hostPort) }); return o; }, {}), Networks: c.nets.reduce(function (o, n) { var nn = netFor(sys, n.net) || {}; o[n.net] = { Aliases: n.aliases && n.aliases.length ? n.aliases : null, NetworkID: nn.id, Gateway: nn.gw, IPAddress: running ? n.ip : "", IPPrefixLen: 16, MacAddress: running ? "02:42:" + n.ip.split(".").slice(0, 4).map(function (x) { return ("0" + (+x).toString(16)).slice(-2); }).join(":") : "", DNSNames: nn.dns ? [c.name].concat(n.aliases || []).concat([c.id.slice(0, 12)]) : null }; return o; }, {}) }
    };
  }
  function imgDoc(sys, img) {
    var repoDigests = Object.keys(img.digests || {}).map(function (r) { return r + "@" + img.digests[r]; });
    return { Id: img.id, RepoTags: img.tags.slice(), RepoDigests: repoDigests, Created: iso(sys, null).replace(/^.*$/, new Date(img.created > 1e11 ? img.created : stamp(sys, img.created)).toISOString()), Config: { User: img.cfg.User || "", Env: img.cfg.Env, Cmd: img.cfg.Cmd, Entrypoint: img.cfg.Entrypoint, WorkingDir: img.cfg.WorkingDir || "", ExposedPorts: Object.keys(img.cfg.ExposedPorts || {}).length ? img.cfg.ExposedPorts : null, Volumes: Object.keys(img.cfg.Volumes || {}).length ? img.cfg.Volumes : null, Labels: Object.keys(img.cfg.Labels || {}).length ? img.cfg.Labels : null, Healthcheck: img.cfg.Healthcheck || undefined, StopSignal: img.cfg.StopSignal || undefined }, Architecture: "amd64", Os: "linux", Size: Math.round(img.size), RootFS: { Type: "layers", Layers: img.layers.filter(function (L) { return L.size > 0 || Object.keys(L.files).length; }).map(function (L) { return L.id; }) } };
  }
  function volDoc(sys, v) { return { CreatedAt: iso(sys, v.created), Driver: "local", Labels: Object.keys(v.labels).length ? v.labels : null, Mountpoint: "/var/lib/docker/volumes/" + v.name + "/_data", Name: v.name, Options: null, Scope: "local" }; }
  function netDoc(sys, n) {
    var cs = {};
    state(sys).ctrs.forEach(function (c) { if (c.state !== "running") return; c.nets.forEach(function (x) { if (x.net === n.name) cs[c.id] = { Name: c.name, IPv4Address: x.ip + "/16", MacAddress: "02:42:ac:11:00:02" }; }); });
    return { Name: n.name, Id: n.id, Created: iso(sys, n.created), Scope: "local", Driver: n.driver, EnableIPv6: false, IPAM: { Driver: "default", Config: n.subnet ? [{ Subnet: n.subnet, Gateway: n.gw }] : [] }, Internal: !!n.internal, Containers: cs, Labels: n.labels || {} };
  }
  Dk.ctrDoc = ctrDoc; Dk.imgDoc = imgDoc;

  /* ================================================================== the docker CLI */
  var SUB = {};
  Dk.SUB = SUB;
  function usageErr(io, sub, msg) { errl(io, msg + "\nSee 'docker " + sub + " --help'."); return 1; }
  // Parse options. spec: {"d|detach": false (flag), "name": true (takes value), "e|env": "list"}
  function parse(args, spec, sub, io, stopAtFirst) {
    var o = {}, rest = [], map = {};
    Object.keys(spec).forEach(function (k) { k.split("|").forEach(function (n) { map[n] = { key: k.split("|").pop(), kind: spec[k] }; }); });
    for (var i = 0; i < args.length; i++) {
      var a = args[i];
      if (rest.length && stopAtFirst) { rest = rest.concat(args.slice(i)); break; }
      if (a === "--") { rest = rest.concat(args.slice(i + 1)); break; }
      var m = /^--([\w-]+)(?:=(.*))?$/.exec(a);
      if (m) {
        var sp = map[m[1]];
        if (!sp) { errl(io, "unknown flag: --" + m[1] + "\nSee 'docker " + sub + " --help'."); return null; }
        var val = m[2] !== undefined ? m[2] : sp.kind === false ? true : args[++i];
        if (sp.kind !== false && val === undefined) { errl(io, "flag needs an argument: --" + m[1] + "\nSee 'docker " + sub + " --help'."); return null; }
        if (sp.kind === false && m[2] !== undefined) val = m[2] !== "false";
        if (sp.kind === "list") (o[sp.key] = o[sp.key] || []).push(val); else o[sp.key] = val;
        continue;
      }
      if (/^-[A-Za-z]/.test(a) && !/^-\d/.test(a)) {
        for (var j = 1; j < a.length; j++) {
          var sp2 = map[a.charAt(j)];
          if (!sp2) { errl(io, "unknown shorthand flag: '" + a.charAt(j) + "' in " + a + "\nSee 'docker " + sub + " --help'."); return null; }
          if (sp2.kind === false) { o[sp2.key] = true; continue; }
          var v2 = a.slice(j + 1) || args[++i];
          if (v2 === undefined) { errl(io, "flag needs an argument: '" + a.charAt(j) + "' in " + a + "\nSee 'docker " + sub + " --help'."); return null; }
          if (sp2.kind === "list") (o[sp2.key] = o[sp2.key] || []).push(v2); else o[sp2.key] = v2;
          break;
        }
        continue;
      }
      rest.push(a);
    }
    o._ = rest;
    return o;
  }
  Dk.parseArgs = parse;
  function daemonCheck(io, sess) {
    var sys = sess.sys, u = sys.units && sys.units["docker.service"];
    var grp = (M2.rd(sys, "/etc/group") || "").split("\n").filter(function (l) { return /^docker:/.test(l); })[0];
    var gid = grp ? +grp.split(":")[2] : -1;
    if (sess.uid !== 0 && (sess.groups || []).indexOf(gid) < 0 && sess.gid !== gid) { errl(io, "permission denied while trying to connect to the Docker daemon socket at unix:///var/run/docker.sock: Head \"http://%2Fvar%2Frun%2Fdocker.sock/_ping\": dial unix /var/run/docker.sock: connect: permission denied"); return false; }
    if (u && u.rt && u.rt.active !== "active") { errl(io, "Cannot connect to the Docker daemon at unix:///var/run/docker.sock. Is the docker daemon running?"); return false; }
    return true;
  }
  CMDS.docker = function (args, io, sess) {
    var sys = sess.sys, a = args.slice(1);
    if (sys.dkCtr) { errl(io, "sh: docker: not found"); return 127; }
    while (a.length && /^-/.test(a[0]) && a[0] !== "--help" && a[0] !== "-v" && a[0] !== "--version") { var g = a.shift(); if (g === "-H" || g === "--host" || g === "--context" || g === "-c" || g === "--config" || g === "-l" || g === "--log-level") a.shift(); }
    if (a[0] === "--version" || a[0] === "-v") { out(io, "Docker version 27.3.1, build ce12230\n"); return 0; }
    if (!a.length || a[0] === "--help" || a[0] === "help") { out(io, HELP); return 0; }
    // "docker container ls", "docker image rm" ... map management commands onto the short forms
    var sub = a.shift();
    var MGMT = { container: { ls: "ps", list: "ps", run: "run", create: "create", start: "start", stop: "stop", restart: "restart", kill: "kill", rm: "rm", remove: "rm", logs: "logs", exec: "exec", inspect: "inspect", prune: "container-prune", port: "port", stats: "stats", top: "top", cp: "cp", rename: "rename", diff: "diff", pause: "pause", unpause: "unpause", update: "update" }, image: { ls: "images", list: "images", rm: "rmi", remove: "rmi", pull: "pull", push: "push", tag: "tag", history: "history", inspect: "image-inspect", prune: "image-prune", build: "build", save: "save" }, builder: { build: "build", prune: "builder-prune" }, buildx: { build: "build", prune: "builder-prune", version: "buildx-version", ls: "buildx-ls" }, system: { df: "system-df", prune: "system-prune", info: "info" } };
    if (MGMT[sub]) {
      var op = a.shift();
      if (!op || op === "--help") { out(io, "\nUsage:  docker " + sub + " COMMAND\n\nManage " + sub + "s\n\nCommands:\n" + Object.keys(MGMT[sub]).map(function (k) { return "  " + k; }).join("\n") + "\n"); return 0; }
      var to = MGMT[sub][op];
      if (!to) { errl(io, "docker: '" + sub + " " + op + "' is not a docker command.\nSee 'docker --help'"); return 1; }
      sub = to;
    }
    if (!SUB[sub]) { errl(io, "docker: '" + sub + "' is not a docker command.\nSee 'docker --help'"); return 1; }
    if (sub !== "login" && sub !== "logout" && !daemonCheck(io, sess)) return 1;
    state(sys); settle(sys);
    var code = SUB[sub](a, io, sess, sub);
    tick(sys, 1); settle(sys);
    return code;
  };
  var HELP = "\nUsage:  docker [OPTIONS] COMMAND\n\nA self-sufficient runtime for containers\n\nCommon Commands:\n  run         Create and run a new container from an image\n  exec        Execute a command in a running container\n  ps          List containers\n  build       Build an image from a Dockerfile\n  pull        Download an image from a registry\n  push        Upload an image to a registry\n  images      List images\n  login       Log in to a registry\n  logout      Log out from a registry\n  version     Show the Docker version information\n  info        Display system-wide information\n\nManagement Commands:\n  compose*    Docker Compose\n  container   Manage containers\n  image       Manage images\n  network     Manage networks\n  system      Manage Docker\n  volume      Manage volumes\n\nCommands:\n  cp          Copy files/folders between a container and the local filesystem\n  create      Create a new container\n  history     Show the history of an image\n  inspect     Return low-level information on Docker objects\n  kill        Kill one or more running containers\n  logs        Fetch the logs of a container\n  port        List port mappings or a specific mapping for the container\n  restart     Restart one or more containers\n  rm          Remove one or more containers\n  rmi         Remove one or more images\n  start       Start one or more stopped containers\n  stats       Display a live stream of container(s) resource usage statistics\n  stop        Stop one or more running containers\n  tag         Create a tag TARGET_IMAGE that refers to SOURCE_IMAGE\n  top         Display the running processes of a container\n\nRun 'docker COMMAND --help' for more information on a command.\n";

  SUB.version = function (a, io) {
    out(io, "Client: Docker Engine - Community\n Version:           27.3.1\n API version:       1.47\n Go version:        go1.22.7\n Git commit:        ce12230\n Built:             Fri Sep 20 11:41:00 2024\n OS/Arch:           linux/amd64\n Context:           default\n\nServer: Docker Engine - Community\n Engine:\n  Version:          27.3.1\n  API version:      1.47 (minimum version 1.24)\n  Go version:       go1.22.7\n  Git commit:       41ca978\n  OS/Arch:          linux/amd64\n containerd:\n  Version:          1.7.22\n runc:\n  Version:          1.1.14\n docker-init:\n  Version:          0.19.0\n");
    return 0;
  };
  SUB.info = function (a, io, sess) {
    var d = state(sess.sys), run = d.ctrs.filter(function (c) { return c.state === "running"; }).length, stopped = d.ctrs.filter(function (c) { return c.state !== "running"; }).length;
    out(io, "Client: Docker Engine - Community\n Version:    27.3.1\n Context:    default\n Plugins:\n  buildx: Docker Buildx (Docker Inc.)\n    Version:  v0.17.1\n  compose: Docker Compose (Docker Inc.)\n    Version:  v2.29.7\n\nServer:\n Containers: " + d.ctrs.length + "\n  Running: " + run + "\n  Paused: 0\n  Stopped: " + stopped + "\n Images: " + d.images.length + "\n Server Version: 27.3.1\n Storage Driver: overlay2\n Logging Driver: json-file\n Cgroup Driver: systemd\n Cgroup Version: 2\n Security Options:\n  apparmor\n  seccomp\n   Profile: builtin\n  cgroupns\n Kernel Version: 6.8.0-48-generic\n Operating System: Ubuntu 24.04.1 LTS\n OSType: linux\n Architecture: x86_64\n CPUs: 4\n Total Memory: 7.751GiB\n Name: " + sess.sys.host + "\n Docker Root Dir: /var/lib/docker\n Registry: https://index.docker.io/v1/\n");
    return 0;
  };

  /* ---------------- docker run / create */
  var RUNSPEC = { "d|detach": false, "i|interactive": false, "t|tty": false, "rm": false, "name": true, "p|publish": "list", "P|publish-all": false, "e|env": "list", "env-file": "list", "v|volume": "list", "mount": "list", "tmpfs": "list", "u|user": true, "w|workdir": true, "entrypoint": true, "restart": true, "m|memory": true, "cpus": true, "read-only": false, "cap-drop": "list", "cap-add": "list", "security-opt": "list", "network|net": true, "network-alias": "list", "health-cmd": true, "health-interval": true, "health-retries": true, "health-timeout": true, "health-start-period": true, "no-healthcheck": false, "hostname|h": true, "l|label": "list", "privileged": false, "pid": true, "init": false, "platform": true, "pull": true, "q|quiet": false, "memory-swap": true, "pids-limit": true, "ulimit": "list", "add-host": "list", "stop-signal": true, "a|attach": "list", "log-driver": true, "log-opt": "list", "expose": "list", "help": false };
  function parseDuration(s) { var m = /^(\d+(?:\.\d+)?)(ms|s|m|h)?$/.exec(String(s)); if (!m) return null; var n = +m[1]; return m[2] === "ms" ? n / 1000 : m[2] === "m" ? n * 60 : m[2] === "h" ? n * 3600 : n; }
  function parseBytes(s) { var m = /^(\d+(?:\.\d+)?)\s*([bkmg])?b?$/i.exec(String(s)); if (!m) return null; return Math.round(+m[1] * { b: 1, k: 1024, m: 1048576, g: 1073741824 }[(m[2] || "b").toLowerCase()]); }
  Dk.parseDuration = parseDuration; Dk.parseBytes = parseBytes;
  function absHost(sess, p) { p = p.replace(/^~(?=\/|$)/, sess.home); if (p.charAt(0) !== "/") p = sess.cwd + "/" + p; return S.normAbs(p); }
  Dk.absHost = absHost;
  // -v and --mount specs to mount objects; returns {mounts} or {error}
  function parseMounts(sess, o) {
    var mounts = [];
    for (var i = 0; i < (o.volume || []).length; i++) {
      var spec = o.volume[i], parts = spec.split(":");
      if (parts.length === 1) { mounts.push({ type: "volume", name: Dk.hex("anonv:" + spec + i + state(sess.sys).seq, 64), dst: parts[0], anon: true }); continue; }
      var src = parts[0], dst = parts[1], mode = parts[2] || "";
      if (dst.charAt(0) !== "/") return { error: "docker: Error response from daemon: invalid volume specification: '" + spec + "': invalid mount config for type \"" + (/[\/.~]/.test(src.charAt(0)) ? "bind" : "volume") + "\": invalid mount path: '" + dst + "' mount path must be absolute." };
      if (/^[\/.~]/.test(src)) {
        var abs = absHost(sess, src);
        if (!hostNode(sess.sys, abs)) S.mkdirs(sess.sys, abs, 493, 0, 0);
        mounts.push({ type: "bind", src: abs, dst: dst, ro: /\bro\b/.test(mode) });
      } else {
        if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]+$/.test(src)) return { error: "docker: Error response from daemon: create " + src + ": \"" + src + "\" includes invalid characters for a local volume name, only \"[a-zA-Z0-9][a-zA-Z0-9_.-]\" are allowed. If you intended to pass a host directory, use absolute path." };
        mounts.push({ type: "volume", name: src, dst: dst, ro: /\bro\b/.test(mode) });
      }
    }
    for (var k = 0; k < (o.mount || []).length; k++) {
      var kv = {}; o.mount[k].split(",").forEach(function (x) { var p = x.split("="); kv[p[0]] = p.length > 1 ? p.slice(1).join("=") : true; });
      var type = kv.type || "volume", s2 = kv.source || kv.src, d2 = kv.target || kv.destination || kv.dst;
      if (!d2) return { error: "invalid argument \"" + o.mount[k] + "\" for \"--mount\" flag: target is required" };
      if (type === "bind") { var ab = absHost(sess, s2 || ""); if (!hostNode(sess.sys, ab)) return { error: "docker: Error response from daemon: invalid mount config for type \"bind\": bind source path does not exist: " + ab + "." }; mounts.push({ type: "bind", src: ab, dst: d2, ro: !!(kv.readonly || kv.ro), viaMount: true }); }
      else if (type === "tmpfs") mounts.push({ type: "tmpfs", dst: d2 });
      else mounts.push({ type: "volume", name: s2 || Dk.hex("anonm:" + d2 + k, 64), dst: d2, ro: !!(kv.readonly || kv.ro), anon: !s2, viaMount: true });
    }
    (o.tmpfs || []).forEach(function (t) { mounts.push({ type: "tmpfs", dst: t.split(":")[0] }); });
    return { mounts: mounts };
  }
  function parseEnvFile(sess, path) {
    var r = S.readFile(sess, path);
    if (r.error) return { error: "docker: open " + path + ": no such file or directory." };
    var env = {};
    r.content.split("\n").forEach(function (l) { l = l.replace(/\r$/, ""); if (!l.trim() || /^\s*#/.test(l)) return; var i = l.indexOf("="); if (i < 0) { var hv = S.getVar(sess, l.trim()); if (hv !== undefined) env[l.trim()] = hv; return; } env[l.slice(0, i).trim()] = l.slice(i + 1); });
    return { env: env };
  }
  Dk.parseEnvFile = parseEnvFile;
  function parsePorts(sess, specs, all, img) {
    var ports = [];
    for (var i = 0; i < specs.length; i++) {
      var s = specs[i], proto = "tcp", m = /^(.*)\/(tcp|udp)$/.exec(s);
      if (m) { s = m[1]; proto = m[2]; }
      var parts = s.split(":"), hip = "0.0.0.0", hp, cp;
      if (parts.length === 3) { hip = parts[0] || "0.0.0.0"; hp = parts[1]; cp = parts[2]; } else if (parts.length === 2) { hp = parts[0]; cp = parts[1]; } else { cp = parts[0]; hp = ""; }
      if (!/^\d+$/.test(cp) || (hp && !/^\d+$/.test(hp))) return { error: "docker: invalid containerPort: " + cp + "." };
      ports.push({ hostIp: hip, hostPort: hp ? +hp : 32768 + ports.length + state(sess.sys).seq, ctrPort: +cp, proto: proto });
    }
    if (all) Object.keys(img.cfg.ExposedPorts || {}).forEach(function (p, k) { var pp = p.split("/"); if (!ports.some(function (x) { return x.ctrPort === +pp[0]; })) ports.push({ hostIp: "0.0.0.0", hostPort: 32768 + k + state(sess.sys).seq, ctrPort: +pp[0], proto: pp[1] || "tcp" }); });
    return { ports: ports };
  }
  function portClash(sys, ports, self) {
    var d = state(sys);
    for (var i = 0; i < ports.length; i++) {
      var p = ports[i];
      var other = d.ctrs.filter(function (c) { return c !== self && c.state === "running" && c.ports.some(function (q) { return q.hostPort === p.hostPort && q.proto === p.proto && (q.hostIp === p.hostIp || q.hostIp === "0.0.0.0" || p.hostIp === "0.0.0.0"); }); })[0];
      if (other) return "Bind for " + p.hostIp + ":" + p.hostPort + " failed: port is already allocated";
      var busy = (M2.listeners(sys) || []).filter(function (l) { return l.sock.port === p.hostPort && l.sock.proto === p.proto && l.proc.comm !== "docker-proxy"; })[0];
      if (busy) return "failed to bind port " + p.hostIp + ":" + p.hostPort + "/" + p.proto + ": Error starting userland proxy: listen " + p.proto + "4 " + p.hostIp + ":" + p.hostPort + ": bind: address already in use";
    }
    return null;
  }
  Dk.portClash = portClash;
  // Shared by run, create and compose: options -> container (or an error string).
  function containerFromOpts(sess, img, o, io, ref) {
    var sys = sess.sys;
    if (o.name && !/^[a-zA-Z0-9][a-zA-Z0-9_.-]+$/.test(o.name)) return { error: "docker: Error response from daemon: Invalid container name (" + o.name + "), only [a-zA-Z0-9][a-zA-Z0-9_.-] are allowed.", code: 125 };
    if (o.name && ctrBy(sys, o.name) && ctrBy(sys, o.name).name === o.name) { var ex = ctrBy(sys, o.name); return { error: "docker: Error response from daemon: Conflict. The container name \"/" + o.name + "\" is already in use by container \"" + ex.id + "\". You have to remove (or rename) that container to be able to reuse that name.", code: 125 }; }
    var env = {};
    for (var i = 0; i < (o.envFile || []).length; i++) { var ef = parseEnvFile(sess, absHost(sess, o.envFile[i])); if (ef.error) return { error: ef.error, code: 125 }; Object.assign(env, ef.env); }
    (o.env || []).forEach(function (kv) { var k = kv.indexOf("="); if (k < 0) { var hv = S.getVar(sess, kv); if (hv !== undefined) env[kv] = hv; } else env[kv.slice(0, k)] = kv.slice(k + 1); });
    var pm = parseMounts(sess, o); if (pm.error) return { error: pm.error, code: 125 };
    var pp = parsePorts(sess, o.publish || [], o["publish-all"], img); if (pp.error) return { error: pp.error, code: 125 };
    var rp = { name: "no", max: 0 };
    if (o.restart) { var rm = /^(no|always|unless-stopped|on-failure)(?::(\d+))?$/.exec(o.restart); if (!rm) return { error: "docker: invalid restart policy format: " + o.restart + ".", code: 125 }; rp = { name: rm[1], max: rm[2] ? +rm[2] : 0 }; if (o.rm && rp.name !== "no") return { error: "docker: conflicting options: cannot specify both --restart and --rm.", code: 125 }; }
    var net = o.network || "bridge";
    if (!netFor(sys, net)) return { error: "docker: Error response from daemon: network " + net + " not found.", code: 125 };
    if (o["network-alias"] && netFor(sys, net).dflt) return { error: "docker: Error response from daemon: network-scoped alias is supported only for containers in user defined networks.", code: 125 };
    var hc = null;
    if (o["no-healthcheck"]) hc = false;
    else if (o["health-cmd"]) hc = { Test: ["CMD-SHELL", o["health-cmd"]], Interval: parseDuration(o["health-interval"] || "30s"), Timeout: parseDuration(o["health-timeout"] || "30s"), Retries: +(o["health-retries"] || 3), StartPeriod: parseDuration(o["health-start-period"] || "0s") };
    var mem = o.memory ? parseBytes(o.memory) : 0;
    if (o.memory && (!mem || mem < 6 * 1048576)) return { error: "docker: Error response from daemon: Minimum memory limit allowed is 6MB.", code: 125 };
    var ep = o.entrypoint != null ? (o.entrypoint === "" ? [] : [o.entrypoint]) : null;
    var c = createCtr(sys, img, {
      name: o.name, imageRef: ref, cmd: o._.slice(1), entrypoint: ep, env: env, ports: pp.ports, mounts: pm.mounts, restart: rp, user: o.user, workdir: o.workdir, rm: o.rm,
      labels: (o.label || []).reduce(function (m, kv) { var k = kv.indexOf("="); m[k < 0 ? kv : kv.slice(0, k)] = k < 0 ? "" : kv.slice(k + 1); return m; }, {}), network: net, aliases: o["network-alias"] || [], hostname: o.hostname,
      readOnly: o["read-only"], capDrop: o["cap-drop"], capAdd: o["cap-add"], secOpt: o["security-opt"], privileged: o.privileged, mem: mem, cpus: o.cpus ? +o.cpus : 0, healthcheck: hc, tty: !!o.tty, init: o.init, pidHost: o.pid === "host"
    });
    c.interactive = !!(o.interactive && o.tty);
    return { ctr: c };
  }
  Dk.containerFromOpts = containerFromOpts;
  function ensureImage(sess, ref, io, pullPolicy) {
    var img = findImage(sess.sys, ref);
    if (img && pullPolicy !== "always") return img;
    if (!img) errl(io, "Unable to find image '" + tagName(ref).replace(/@.*$/, "") + (Dk.parseRef(ref).digest ? "@" + Dk.parseRef(ref).digest : "") + "' locally");
    if (pullPolicy === "never") { errl(io, "docker: Error response from daemon: No such image: " + ref + "."); return null; }
    var cap = capture();
    var got = pull(sess, ref, cap.io);
    cap.lines.forEach(function (l) { if (l.s === "err") errl(io, "docker: " + l.text.replace(/\n$/, "") + "."); else if (!/^(docker\.io|[\w.-]+\.[\w.-]+)\//.test(l.text)) io.out(l.text); });
    return got;
  }
  Dk.ensureImage = ensureImage;
  function runOrCreate(a, io, sess, sub) {
    var sys = sess.sys;
    var o = parse(a, RUNSPEC, sub, io, true);
    if (!o) return 125;
    if (o.help) { out(io, "\nUsage:  docker " + sub + " [OPTIONS] IMAGE [COMMAND] [ARG...]\n\nCreate and run a new container from an image\n\nOptions:\n  -d, --detach            Run container in background and print container ID\n  -e, --env list          Set environment variables\n      --env-file list     Read in a file of environment variables\n  -i, --interactive       Keep STDIN open even if not attached\n      --name string       Assign a name to the container\n  -p, --publish list      Publish a container's port(s) to the host\n      --restart string    Restart policy to apply when a container exits\n      --rm                Automatically remove the container when it exits\n  -t, --tty               Allocate a pseudo-TTY\n  -u, --user string       Username or UID (format: <name|uid>[:<group|gid>])\n  -v, --volume list       Bind mount a volume\n  -w, --workdir string    Working directory inside the container\n"); return 0; }
    o.envFile = o["env-file"];
    if (!o._.length) { errl(io, "\"docker " + sub + "\" requires at least 1 argument.\nSee 'docker " + sub + " --help'.\n\nUsage:  docker " + sub + " [OPTIONS] IMAGE [COMMAND] [ARG...]\n\nCreate and run a new container from an image"); return 1; }
    var ref = o._[0];
    var img = ensureImage(sess, ref, io, o.pull);
    if (!img) return 125;
    var made = containerFromOpts(sess, img, o, io, tagName(ref).replace(/:latest$/, Dk.parseRef(ref).tag === "latest" && !/:latest$/.test(ref) ? "" : ":latest"));
    if (made.error) { errl(io, made.error + "\nSee 'docker " + sub + " --help'."); return made.code; }
    var c = made.ctr;
    c.imageRef = ref;
    if (sub === "create") { out(io, c.id + "\n"); return 0; }
    return runCtr(sess, c, io, { detach: o.detach, interactive: o.interactive && o.tty, attachOut: !o.detach });
  }
  // Start a container and handle the terminal: -d prints the ID, a service in the foreground prints its logs,
  // an interactive shell opens a prompt inside the container.
  function runCtr(sess, c, io, o) {
    var sys = sess.sys;
    var clash = portClash(sys, c.ports, c);
    if (clash) { errl(io, "docker: Error response from daemon: driver failed programming external connectivity on endpoint " + c.name + " (" + Dk.hex("ep" + c.id, 64) + "): " + clash + "."); c.state = "created"; return 125; }
    var logFrom = c.logs.length;
    var r = startCtr(sys, c, { interactive: o.interactive, sess: sess, io: io });
    if (r.error) {
      errl(io, "docker: Error response from daemon: failed to create task for container: failed to create shim task: OCI runtime create failed: runc create failed: unable to start container process: " + r.error + ": unknown.");
      if (c.autoRm) removeCtr(sys, c, true);
      return r.code === 127 ? 127 : 126;
    }
    if (o.detach) { out(io, c.id + "\n"); return 0; }
    if (c.app && c.app.kind === "shell" && o.interactive) {
      var cs = ctrSession(sys, c, {});
      if (cs.error) { errl(io, "docker: Error response from daemon: " + cs.error + "."); return 126; }
      enterShell(sess, c, cs.sess, true);
      return 0;
    }
    var printed = c.logs.slice(logFrom);
    printed.forEach(function (l) { (l.s === "err" ? function (t) { io.err(t + "\n"); } : function (t) { io.out(t + "\n"); })(l.text); });
    if (c.state === "running" && c.app && (c.app.kind === "service" || c.app.kind === "idle")) {
      note(io, "(The container is running in the foreground: your terminal now shows its logs until it stops. The lab pressed Ctrl+C for you, which stopped it. Add -d to run it in the background.)");
      c.stoppedByUser = true;
      exitCtr(sys, c, c.app.stopCode != null ? c.app.stopCode : 0, false);
      if (c.autoRm && state(sys).ctrs.indexOf(c) >= 0) removeCtr(sys, c, true);
      return c.app.stopCode != null ? c.app.stopCode : 130;
    }
    if (c.app && c.app.interactiveNote && o.interactive) note(io, c.app.interactiveNote);
    return c.exitCode;
  }
  Dk.runCtr = runCtr;
  // Push a shell inside the container onto the terminal (like ssh). main: the container stops when it exits.
  function enterShell(sess, c, csess, main) {
    var top = sess.sys.topSession || sess;
    csess.sys.topSession = top;
    top.userStack.push({ shell: csess, exitMsg: main ? "exit\n" : "exit\n", dkCtr: c.id, dkMain: main });
    c.shellOpen = (c.shellOpen || 0) + 1;
    if (main) c.mainShell = csess;
  }
  Dk.enterShell = enterShell;
  SUB.run = runOrCreate; SUB.create = runOrCreate;

  // After each line typed: sync volumes of containers you're inside, and stop a container whose main shell exited.
  var afterPrev = S.afterLine;
  S.afterLine = function (sess, io) {
    if (afterPrev) afterPrev(sess, io);
    var sys = sess.sys; if (!sys.dk) return;
    var stackShells = sess.userStack.map(function (e) { return e.shell; });
    state(sys).ctrs.slice().forEach(function (c) {
      if (!c.fs) return;
      if (c.shellOpen) {
        var bad = syncOut(sys, c);
        bad.forEach(function (p) { io.err("sh: can't create " + p + ": Read-only file system\n"); });
        if (c.readOnly && c.roBefore) { /* checked per exec */ }
      }
      if (c.mainShell && stackShells.indexOf(c.mainShell) < 0 && c.state === "running") { c.mainShell = null; c.shellOpen = 0; exitCtr(sys, c, 0, true); }
    });
  };

  /* ---------------- start, stop, restart, kill, rm */
  function eachCtr(a, io, sess, sub, fn) {
    if (!a.length) { errl(io, "\"docker " + sub + "\" requires at least 1 argument.\nSee 'docker " + sub + " --help'.\n\nUsage:  docker " + sub + " [OPTIONS] CONTAINER [CONTAINER...]"); return 1; }
    var code = 0;
    a.forEach(function (ref) { var c = ctrBy(sess.sys, ref); if (!c) { errl(io, "Error response from daemon: No such container: " + ref); code = 1; return; } var r = fn(c, ref); if (r) code = r; });
    return code;
  }
  SUB.start = function (a, io, sess, sub) {
    var o = parse(a, { "a|attach": false, "i|interactive": false }, sub, io); if (!o) return 1;
    return eachCtr(o._, io, sess, sub, function (c, ref) {
      if (c.state === "running") { out(io, ref + "\n"); return 0; }
      var clash = portClash(sess.sys, c.ports, c);
      if (clash) { errl(io, "Error response from daemon: driver failed programming external connectivity on endpoint " + c.name + ": " + clash + "\nError: failed to start containers: " + ref); return 1; }
      c.stoppedByUser = false;
      var from = c.logs.length;
      var r = startCtr(sess.sys, c, {});
      if (r.error) { errl(io, "Error response from daemon: failed to create task for container: failed to create shim task: OCI runtime create failed: runc create failed: unable to start container process: " + r.error + ": unknown\nError: failed to start containers: " + ref); return 1; }
      if (o.attach) c.logs.slice(from).forEach(function (l) { (l.s === "err" ? io.err : io.out)(l.text + "\n"); });
      else out(io, ref + "\n");
      return 0;
    });
  };
  SUB.stop = function (a, io, sess, sub) {
    var o = parse(a, { "t|time|timeout": true, "s|signal": true }, sub, io); if (!o) return 1;
    return eachCtr(o._, io, sess, sub, function (c, ref) { if (c.app && c.app.ignoresTerm) tick(sess.sys, 10); stopCtr(sess.sys, c); out(io, ref + "\n"); return 0; });
  };
  SUB.kill = function (a, io, sess, sub) {
    var o = parse(a, { "s|signal": true }, sub, io); if (!o) return 1;
    return eachCtr(o._, io, sess, sub, function (c, ref) { if (c.state !== "running") { errl(io, "Error response from daemon: cannot kill container: " + ref + ": container " + c.id + " is not running"); return 1; } stopCtr(sess.sys, c, "KILL"); out(io, ref + "\n"); return 0; });
  };
  SUB.restart = function (a, io, sess, sub) {
    var o = parse(a, { "t|time|timeout": true, "s|signal": true }, sub, io); if (!o) return 1;
    return eachCtr(o._, io, sess, sub, function (c, ref) { stopCtr(sess.sys, c); c.stoppedByUser = false; tick(sess.sys, 1); var r = startCtr(sess.sys, c, {}); if (r.error) { errl(io, "Error response from daemon: Cannot restart container " + ref + ": " + r.error); return 1; } out(io, ref + "\n"); return 0; });
  };
  SUB.pause = function (a, io, sess, sub) { return eachCtr(a, io, sess, sub, function (c, ref) { if (c.state !== "running") { errl(io, "Error response from daemon: container " + c.id + " is not running"); return 1; } c.state = "paused"; out(io, ref + "\n"); return 0; }); };
  SUB.unpause = function (a, io, sess, sub) { return eachCtr(a, io, sess, sub, function (c, ref) { if (c.state === "paused") c.state = "running"; out(io, ref + "\n"); return 0; }); };
  SUB.rm = function (a, io, sess, sub) {
    var o = parse(a, { "f|force": false, "v|volumes": false, "l|link": false }, sub, io); if (!o) return 1;
    return eachCtr(o._, io, sess, sub, function (c, ref) {
      if ((c.state === "running" || c.state === "restarting") && !o.force) { errl(io, "Error response from daemon: cannot remove container \"/" + c.name + "\": container is " + c.state + ": stop the container before removing or force remove"); return 1; }
      if (c.state === "running") stopCtr(sess.sys, c, "KILL");
      removeCtr(sess.sys, c, o.volumes); out(io, ref + "\n"); return 0;
    });
  };
  SUB.rename = function (a, io, sess) { var c = ctrBy(sess.sys, a[0]); if (!c) { errl(io, "Error response from daemon: No such container: " + a[0]); return 1; } if (ctrBy(sess.sys, a[1])) { errl(io, "Error response from daemon: Conflict. The container name \"/" + a[1] + "\" is already in use."); return 1; } c.name = a[1]; return 0; };
  SUB["container-prune"] = function (a, io, sess) {
    var d = state(sess.sys), gone = d.ctrs.filter(function (c) { return c.state === "exited" || c.state === "created"; });
    if (a.indexOf("-f") < 0 && a.indexOf("--force") < 0) { out(io, "WARNING! This will remove all stopped containers.\nAre you sure you want to continue? [y/N] "); note(io, "(No answer, so nothing was removed. Add -f to skip the question.)"); return 1; }
    out(io, "Deleted Containers:\n" + gone.map(function (c) { removeCtr(sess.sys, c, false); return c.id + "\n"; }).join("") + "\nTotal reclaimed space: " + Dk.human(gone.length * 4096) + "\n"); return 0;
  };

  /* ---------------- ps */
  function ctrRow(sys, c) {
    var img = imageById(sys, c.image);
    return { ID: c.id.slice(0, 12), Image: c.imageRef, Command: cmdText(sys, c), CreatedAt: new Date(stamp(sys, c.created)).toISOString().replace("T", " ").replace(/\.\d+Z/, " +0000 UTC"), RunningFor: Dk.ago(clock(sys) - c.created) + " ago", Ports: exposedText(sys, c), State: c.state, Status: statusText(sys, c), Size: "0B", Names: c.name, Labels: Object.keys(c.labels).map(function (k) { return k + "=" + c.labels[k]; }).join(","), Mounts: c.mounts.map(function (m) { return m.type === "volume" ? (m.anon ? m.name.slice(0, 15) + "…" : m.name) : m.src; }).join(","), Networks: c.nets.map(function (n) { return n.net; }).join(","), _img: img };
  }
  Dk.ctrRow = ctrRow;
  function matchFilter(sys, c, f) {
    var i = f.indexOf("="), k = f.slice(0, i), v = f.slice(i + 1);
    if (k === "name") return c.name.indexOf(v) >= 0;
    if (k === "status") return (c.state === "created" ? "created" : c.state) === v;
    if (k === "ancestor") { var im = findImage(sys, v); return !!im && im.id === c.image; }
    if (k === "label") { var p = v.split("="); return c.labels[p[0]] !== undefined && (p.length < 2 || c.labels[p[0]] === p[1]); }
    if (k === "id") return c.id.indexOf(v) === 0;
    if (k === "health") return c.health && c.health.status === v;
    if (k === "exited") return c.state === "exited" && c.exitCode === +v;
    if (k === "volume") return c.mounts.some(function (m) { return m.name === v || m.dst === v; });
    if (k === "network") return c.nets.some(function (n) { return n.net === v; });
    return true;
  }
  SUB.ps = function (a, io, sess, sub) {
    var o = parse(a, { "a|all": false, "q|quiet": false, "f|filter": "list", "format": true, "n|last": true, "l|latest": false, "s|size": false, "no-trunc": false }, sub, io); if (!o) return 1;
    var sys = sess.sys, list = state(sys).ctrs.filter(function (c) { return o.all || c.state === "running" || c.state === "restarting" || c.state === "paused"; });
    (o.filter || []).forEach(function (f) { list = list.filter(function (c) { return matchFilter(sys, c, f); }); });
    if (o.latest) list = list.slice(0, 1);
    if (o.quiet) { out(io, list.map(function (c) { return (o["no-trunc"] ? c.id : c.id.slice(0, 12)) + "\n"; }).join("")); return 0; }
    var rows = list.map(function (c) { return ctrRow(sys, c); });
    if (o.format) { out(io, formatRows(o.format, rows, { ID: "CONTAINER ID", Image: "IMAGE", Command: "COMMAND", RunningFor: "CREATED", Status: "STATUS", Ports: "PORTS", Names: "NAMES", State: "STATE", Networks: "NETWORKS", Mounts: "MOUNTS", Labels: "LABELS", CreatedAt: "CREATED AT" })); return 0; }
    out(io, table([["CONTAINER ID", "IMAGE", "COMMAND", "CREATED", "STATUS", "PORTS", "NAMES"]].concat(rows.map(function (r) { return [r.ID, r.Image, r.Command, r.RunningFor, r.Status, r.Ports, r.Names]; }))));
    return 0;
  };

  /* ---------------- logs */
  SUB.logs = function (a, io, sess, sub) {
    var o = parse(a, { "f|follow": false, "t|timestamps": false, "n|tail": true, "since": true, "until": true, "details": false }, sub, io); if (!o) return 1;
    if (o._.length !== 1) { errl(io, "\"docker logs\" requires exactly 1 argument.\nSee 'docker logs --help'.\n\nUsage:  docker logs [OPTIONS] CONTAINER\n\nFetch the logs of a container"); return 1; }
    var c = ctrBy(sess.sys, o._[0]); if (!c) { errl(io, "Error response from daemon: No such container: " + o._[0]); return 1; }
    var lines = c.logs;
    if (o.since) { var sd = parseDuration(o.since); if (sd != null) lines = lines.filter(function (l) { return l.t >= clock(sess.sys) - sd; }); }
    if (o.tail != null && o.tail !== "all") lines = lines.slice(Math.max(0, lines.length - +o.tail));
    lines.forEach(function (l) { var t = (o.timestamps ? new Date(stamp(sess.sys, l.t)).toISOString().replace("Z", "000000Z") + " " : "") + l.text + "\n"; if (l.s === "err") io.err(t); else io.out(t); });
    if (o.follow) note(io, "(-f keeps following new lines until you press Ctrl+C. The lab printed what's there and stopped following.)");
    return 0;
  };

  /* ---------------- exec */
  SUB.exec = function (a, io, sess, sub) {
    var o = parse(a, { "i|interactive": false, "t|tty": false, "d|detach": false, "u|user": true, "w|workdir": true, "e|env": "list", "env-file": "list", "privileged": false }, sub, io, true); if (!o) return 1;
    if (o._.length < 2) { errl(io, "\"docker exec\" requires at least 2 arguments.\nSee 'docker exec --help'.\n\nUsage:  docker exec [OPTIONS] CONTAINER COMMAND [ARG...]\n\nExecute a command in a running container"); return 1; }
    var sys = sess.sys, c = ctrBy(sys, o._[0]);
    if (!c) { errl(io, "Error response from daemon: No such container: " + o._[0]); return 1; }
    return execIn(sess, c, o._.slice(1), o, io);
  };
  function execIn(sess, c, argv, o, io) {
    var sys = sess.sys;
    if (c.state === "paused") { errl(io, "Error response from daemon: container " + c.id + " is paused, unpause the container before exec"); return 1; }
    if (c.state !== "running") { errl(io, "Error response from daemon: container " + c.id + " is not running"); return 1; }
    var env = {};
    (o.env || []).forEach(function (kv) { var k = kv.indexOf("="); if (k > 0) env[kv.slice(0, k)] = kv.slice(k + 1); });
    syncIn(sys, c);
    var shellNames = /^(\/bin\/|\/usr\/bin\/)?(sh|bash|ash|dash|zsh)$/;
    if (shellNames.test(argv[0]) && argv.length === 1) {
      if (!(o.interactive && o.tty)) { if (o.interactive) note(io, "(The shell is waiting for input, but there's no terminal attached. Use -it to get a prompt inside the container.)"); return 0; }
      var cs = ctrSession(sys, c, { user: o.user, workdir: o.workdir, env: env });
      if (cs.error) { errl(io, "Error response from daemon: " + cs.error); return 126; }
      if (S.resolveCommand(cs.sess, argv[0]).error) { errl(io, "OCI runtime exec failed: exec failed: unable to start container process: exec: \"" + argv[0] + "\": executable file not found in $PATH: unknown"); return 126; }
      enterShell(sess, c, cs.sess, false);
      return 0;
    }
    var r = runIn(sys, c, argv, { user: o.user, workdir: o.workdir, env: env, stdin: io.stdin });
    if (r.error) { errl(io, "OCI runtime exec failed: exec failed: unable to start container process: " + r.error + ": unknown"); return r.notFound ? 127 : 126; }
    r.lines.forEach(function (l) { (l.s === "err" ? io.err : io.out)(l.text); });
    ev(sys, { kind: "exec", ctr: c.id, cmd: argv.join(" ") });
    return r.code;
  }
  Dk.execIn = execIn;

  /* ---------------- inspect, port, top, stats, cp */
  SUB.inspect = function (a, io, sess, sub) {
    var o = parse(a, { "f|format": true, "type": true, "s|size": false }, sub, io); if (!o) return 1;
    if (!o._.length) { errl(io, "\"docker inspect\" requires at least 1 argument."); return 1; }
    var sys = sess.sys, docs = [], code = 0;
    o._.forEach(function (ref) {
      var c = (!o.type || o.type === "container") && ctrBy(sys, ref);
      if (c) { docs.push(ctrDoc(sys, c)); return; }
      var img = (!o.type || o.type === "image") && findImage(sys, ref);
      if (img) { docs.push(imgDoc(sys, img)); return; }
      var v = (!o.type || o.type === "volume") && state(sys).vols[ref];
      if (v) { docs.push(volDoc(sys, v)); return; }
      var n = (!o.type || o.type === "network") && netFor(sys, ref);
      if (n) { docs.push(netDoc(sys, n)); return; }
      code = 1; errl(io, "Error: No such object: " + ref);
    });
    printDocs(io, docs, o.format);
    return code;
  };
  function printDocs(io, docs, fmt) {
    if (fmt) { docs.forEach(function (d) { out(io, template(unesc(fmt), d).replace(/\n?$/, "\n")); }); return; }
    if (docs.length || true) out(io, JSON.stringify(docs, null, 4).replace(/"([^"]+)": undefined,?\n/g, "") + "\n");
  }
  SUB["image-inspect"] = function (a, io, sess, sub) {
    var o = parse(a, { "f|format": true }, sub, io); if (!o) return 1;
    var docs = [], code = 0;
    o._.forEach(function (ref) { var img = findImage(sess.sys, ref); if (!img) { errl(io, "Error response from daemon: No such image: " + ref); code = 1; return; } docs.push(imgDoc(sess.sys, img)); });
    printDocs(io, docs, o.format); return code;
  };
  SUB.port = function (a, io, sess) {
    var c = ctrBy(sess.sys, a[0]); if (!c) { errl(io, "Error response from daemon: No such container: " + a[0]); return 1; }
    var ps = c.ports.filter(function (p) { return !a[1] || a[1] === String(p.ctrPort) || a[1] === p.ctrPort + "/" + p.proto; });
    if (a[1] && !ps.length) { errl(io, "Error: No public port '" + a[1] + (/\//.test(a[1]) ? "" : "/tcp") + "' published for " + a[0]); return 1; }
    ps.forEach(function (p) { out(io, (a[1] ? "" : p.ctrPort + "/" + p.proto + " -> ") + p.hostIp + ":" + p.hostPort + "\n" + (p.hostIp === "0.0.0.0" ? (a[1] ? "" : p.ctrPort + "/" + p.proto + " -> ") + "[::]:" + p.hostPort + "\n" : "")); });
    return 0;
  };
  SUB.top = function (a, io, sess) {
    var c = ctrBy(sess.sys, a[0]); if (!c) { errl(io, "Error response from daemon: No such container: " + a[0]); return 1; }
    if (c.state !== "running") { errl(io, "Error response from daemon: container " + c.id + " is not running"); return 1; }
    var procs = (sess.sys.procs || []).filter(function (p) { return p.dkCtr === c.id && p.comm !== "containerd-shim" && p.comm !== "docker-proxy"; });
    out(io, table([["UID", "PID", "PPID", "C", "STIME", "TTY", "TIME", "CMD"]].concat(procs.map(function (p) { return [S.uname(sess.sys, p.uid) || String(p.uid), p.pid, p.ppid, 0, "09:00", "?", "00:00:00", p.cmd]; }))));
    return 0;
  };
  SUB.stats = function (a, io, sess, sub) {
    var o = parse(a, { "no-stream": false, "a|all": false, "format": true, "no-trunc": false }, sub, io); if (!o) return 1;
    var sys = sess.sys, list = state(sys).ctrs.filter(function (c) { return (o.all || c.state === "running") && (!o._.length || o._.some(function (r) { return ctrBy(sys, r) === c; })); });
    var rows = list.map(function (c) {
      var used = c.state === "running" ? (c.app && c.app.mem || 8e6) : 0, lim = c.mem || 8.32e9;
      var mib = function (b) { return b >= 1073741824 ? (b / 1073741824).toFixed(2) + "GiB" : (b / 1048576).toFixed(2) + "MiB"; };
      return { ID: c.id.slice(0, 12), Name: c.name, CPUPerc: c.state === "running" ? ((c.app && c.app.cpu) || 0.02).toFixed(2) + "%" : "0.00%", MemUsage: mib(used) + " / " + mib(lim), MemPerc: (used / lim * 100).toFixed(2) + "%", NetIO: c.state === "running" ? "1.2kB / 0B" : "0B / 0B", BlockIO: "0B / 0B", PIDs: c.state === "running" ? String((c.app && c.app.pids) || 1) : "0" };
    });
    if (o.format) { out(io, formatRows(o.format, rows, { Name: "NAME", CPUPerc: "CPU %", MemUsage: "MEM USAGE / LIMIT", MemPerc: "MEM %", NetIO: "NET I/O", BlockIO: "BLOCK I/O", PIDs: "PIDS", ID: "CONTAINER ID" })); }
    else out(io, table([["CONTAINER ID", "NAME", "CPU %", "MEM USAGE / LIMIT", "MEM %", "NET I/O", "BLOCK I/O", "PIDS"]].concat(rows.map(function (r) { return [r.ID, r.Name, r.CPUPerc, r.MemUsage, r.MemPerc, r.NetIO, r.BlockIO, r.PIDs]; }))));
    if (!o["no-stream"]) note(io, "(docker stats refreshes every second until you press Ctrl+C. The lab showed one sample; add --no-stream to get exactly that.)");
    return 0;
  };
  SUB.cp = function (a, io, sess) {
    if (a.length !== 2) { errl(io, "\"docker cp\" requires exactly 2 arguments.\nSee 'docker cp --help'."); return 1; }
    var sys = sess.sys, src = a[0], dst = a[1], m1 = /^([\w.-]+):(.*)$/.exec(src), m2 = /^([\w.-]+):(.*)$/.exec(dst);
    if (m1 && !m2) {
      var c = ctrBy(sys, m1[1]); if (!c) { errl(io, "Error response from daemon: No such container: " + m1[1]); return 1; }
      ctrFs(sys, c); syncIn(sys, c);
      var n = hostNode(c.fs, m1[2]); if (!n) { errl(io, "Error response from daemon: Could not find the file " + m1[2] + " in container " + m1[1]); return 1; }
      var dabs = absHost(sess, dst), dn = hostNode(sys, dabs), name = m1[2].split("/").filter(Boolean).pop();
      var k = clone(n); setOwner(k, sess.uid, sess.gid);
      if (dn && dn.type === "d") { if (!S.can(sess, dn, "w")) { errl(io, "open " + dabs + "/" + name + ": permission denied"); return 1; } dn.children[name] = k; }
      else placeNode(sys, dabs, k);
      out(io, "Successfully copied " + Dk.human(Dk.mapSize(n.type === "d" ? Dk.mapFrom(n, "/") : { x: Dk.mapFrom({ children: { x: n } }, "/")["/x"] })) + " to " + dst + "\n");
      return 0;
    }
    if (m2 && !m1) {
      var c2 = ctrBy(sys, m2[1]); if (!c2) { errl(io, "Error response from daemon: No such container: " + m2[1]); return 1; }
      var sn = hostNode(sys, absHost(sess, src)); if (!sn) { errl(io, "lstat " + absHost(sess, src) + ": no such file or directory"); return 1; }
      ctrFs(sys, c2);
      var tn = hostNode(c2.fs, m2[2]), nm = absHost(sess, src).split("/").pop(), k2 = clone(sn); setOwner(k2, 0, 0);
      if (tn && tn.type === "d") tn.children[nm] = k2; else placeNode(c2.fs, m2[2], k2);
      syncOut(sys, c2);
      out(io, "Successfully copied " + Dk.human((sn.content || "").length) + " to " + dst + "\n");
      return 0;
    }
    errl(io, "copying between containers is not supported"); return 1;
  };
  function setOwner(n, uid, gid) { n.uid = uid; n.gid = gid; Object.keys(n.children || {}).forEach(function (k) { setOwner(n.children[k], uid, gid); }); }
  SUB.diff = function (a, io, sess) {
    var c = ctrBy(sess.sys, a[0]); if (!c) { errl(io, "Error response from daemon: No such container: " + a[0]); return 1; }
    ctrFs(sess.sys, c);
    var now = ownMap(c), base = Object.assign({}, c.fs.imgMap); Object.keys(base).forEach(function (p) { if (!now[p] && ownMapSkip(c, p)) delete base[p]; });
    var ch = Dk.diff(base, now);
    Object.keys(ch).sort().forEach(function (p) { out(io, (ch[p].t === "wh" ? "D " : base[p] ? "C " : "A ") + p + "\n"); });
    return 0;
  };
  function ownMapSkip(c, p) { return ["/tmp", "/run", "/proc", "/dev", "/etc/hosts", "/etc/hostname", "/etc/resolv.conf"].concat((c.mounts || []).map(function (x) { return x.dst; })).some(function (s) { return p === s || p.indexOf(s + "/") === 0; }); }
  SUB.update = function (a, io, sess, sub) {
    var o = parse(a, { "restart": true, "m|memory": true, "cpus": true, "memory-swap": true }, sub, io); if (!o) return 1;
    return eachCtr(o._, io, sess, sub, function (c, ref) { if (o.restart) { var m = /^(no|always|unless-stopped|on-failure)(?::(\d+))?$/.exec(o.restart); c.restart = { name: m ? m[1] : "no", max: m && m[2] ? +m[2] : 0 }; } if (o.memory) c.mem = parseBytes(o.memory); if (o.cpus) c.cpus = +o.cpus; out(io, ref + "\n"); return 0; });
  };

  /* ---------------- images, tag, rmi, history, prune */
  function imgRows(sys, list, o) {
    var rows = [];
    list.forEach(function (img) {
      var tags = img.tags.length ? img.tags : ["<none>:<none>"];
      tags.forEach(function (t) {
        var i = t.lastIndexOf(":"), repo = t.slice(0, i), tag = t.slice(i + 1);
        var dg = img.digests[repo] || "<none>";
        rows.push({ Repository: repo, Tag: tag, Digest: dg, ID: shortId(img), CreatedSince: Dk.ago(createdSecs(sys, img)) + " ago", CreatedAt: new Date(createdMs(sys, img)).toISOString(), Size: Dk.human(img.size), _img: img });
      });
    });
    return rows;
  }
  function createdMs(sys, img) { return img.created > 1e11 ? img.created : stamp(sys, img.created); }
  function createdSecs(sys, img) { return (stamp(sys) - createdMs(sys, img)) / 1000; }
  Dk.imgRows = imgRows;
  SUB.images = function (a, io, sess, sub) {
    var o = parse(a, { "a|all": false, "q|quiet": false, "digests": false, "f|filter": "list", "format": true, "no-trunc": false, "tree": false }, sub, io); if (!o) return 1;
    var sys = sess.sys, list = state(sys).images.slice();
    if (o._.length) { var want = o._[0]; list = list.filter(function (i) { return i.tags.some(function (t) { var r = t.slice(0, t.lastIndexOf(":")); return r === want || t === tagName(want) || (/[*]/.test(want) && S.globMatch(want, r)); }); }); }
    (o.filter || []).forEach(function (f) {
      if (f === "dangling=true") list = list.filter(function (i) { return !i.tags.length; });
      else if (f === "dangling=false") list = list.filter(function (i) { return i.tags.length; });
      else if (/^reference=/.test(f)) { var g = f.slice(10); list = list.filter(function (i) { return i.tags.some(function (t) { return S.globMatch(g, t) || S.globMatch(g, t.slice(0, t.lastIndexOf(":"))); }); }); }
      else if (/^before=|^since=/.test(f)) { var ref = findImage(sys, f.split("=")[1]); if (ref) list = list.filter(function (i) { return /^before/.test(f) ? createdMs(sys, i) < createdMs(sys, ref) : createdMs(sys, i) > createdMs(sys, ref); }); }
    });
    if (!o.all) list = list.filter(function (i) { return i.tags.length || !i.intermediate; });
    list.sort(function (x, y) { return createdMs(sys, y) - createdMs(sys, x); });
    var rows = imgRows(sys, list, o);
    if (o.quiet) { var seen = {}; out(io, rows.filter(function (r) { if (seen[r.ID]) return false; seen[r.ID] = 1; return true; }).map(function (r) { return r.ID + "\n"; }).join("")); return 0; }
    if (o.format) { out(io, formatRows(o.format, rows, { Repository: "REPOSITORY", Tag: "TAG", ID: "IMAGE ID", CreatedSince: "CREATED", Size: "SIZE", Digest: "DIGEST", CreatedAt: "CREATED AT" })); return 0; }
    var head = o.digests ? ["REPOSITORY", "TAG", "DIGEST", "IMAGE ID", "CREATED", "SIZE"] : ["REPOSITORY", "TAG", "IMAGE ID", "CREATED", "SIZE"];
    out(io, table([head].concat(rows.map(function (r) { return o.digests ? [r.Repository, r.Tag, r.Digest, r.ID, r.CreatedSince, r.Size] : [r.Repository, r.Tag, r.ID, r.CreatedSince, r.Size]; }))));
    return 0;
  };
  SUB.tag = function (a, io, sess) {
    if (a.length !== 2) { errl(io, "\"docker tag\" requires exactly 2 arguments.\nSee 'docker tag --help'.\n\nUsage:  docker tag SOURCE_IMAGE[:TAG] TARGET_IMAGE[:TAG]\n\nCreate a tag TARGET_IMAGE that refers to SOURCE_IMAGE"); return 1; }
    var img = findImage(sess.sys, a[0]);
    if (!img) { errl(io, "Error response from daemon: No such image: " + tagName(a[0])); return 1; }
    var p = Dk.parseRef(a[1]);
    if (!p.valid || p.digest) { errl(io, "Error parsing reference: \"" + a[1] + "\" is not a valid repository/tag: invalid reference format"); return 1; }
    setTag(sess.sys, img, a[1]);
    ev(sess.sys, { kind: "tag", image: img.id, ref: tagName(a[1]) });
    return 0;
  };
  SUB.rmi = function (a, io, sess, sub) {
    var o = parse(a, { "f|force": false, "no-prune": false }, sub, io); if (!o) return 1;
    if (!o._.length) { errl(io, "\"docker rmi\" requires at least 1 argument."); return 1; }
    var sys = sess.sys, d = state(sys), code = 0;
    o._.forEach(function (ref) {
      var img = findImage(sys, ref);
      if (!img) { errl(io, "Error response from daemon: No such image: " + tagName(ref)); code = 1; return; }
      var t = tagName(ref), byTag = img.tags.indexOf(t) >= 0;
      var users = d.ctrs.filter(function (c) { return c.image === img.id; });
      if (byTag && img.tags.length > 1) { img.tags.splice(img.tags.indexOf(t), 1); out(io, "Untagged: " + t + "\n"); return; }
      if (users.length && !o.force) { var running = users.filter(function (c) { return c.state === "running"; })[0]; errl(io, "Error response from daemon: conflict: unable to " + (byTag ? "remove repository reference \"" + t + "\" (must force) - container " + users[0].id.slice(0, 12) + " is using its referenced image " + shortId(img) : "delete " + shortId(img) + " (" + (running ? "cannot be forced) - image is being used by running container " + running.id.slice(0, 12) : "must be forced) - image is being used by stopped container " + users[0].id.slice(0, 12)) + ")")); code = 1; return; }
      img.tags.forEach(function (x) { out(io, "Untagged: " + x + "\n"); var r = x.slice(0, x.lastIndexOf(":")); if (img.digests[r]) out(io, "Untagged: " + r + "@" + img.digests[r] + "\n"); });
      if (users.length) { img.tags = []; return; }
      d.images.splice(d.images.indexOf(img), 1);
      out(io, "Deleted: " + img.id + "\n");
      ev(sys, { kind: "rmi", image: img.id });
    });
    return code;
  };
  SUB["image-prune"] = function (a, io, sess, sub) {
    var o = parse(a, { "a|all": false, "f|force": false, "filter": "list" }, sub, io); if (!o) return 1;
    var sys = sess.sys, d = state(sys);
    var used = {}; d.ctrs.forEach(function (c) { used[c.image] = true; });
    var gone = d.images.filter(function (i) { return !used[i.id] && (o.all || !i.tags.length); });
    if (!o.force) { out(io, "WARNING! This will remove all " + (o.all ? "images without at least one container associated to them" : "dangling images") + ".\nAre you sure you want to continue? [y/N] "); note(io, "(No answer, so nothing was removed. Add -f to skip the question.)"); return 1; }
    var space = 0;
    if (gone.length) out(io, "Deleted Images:\n");
    gone.forEach(function (i) { i.tags.forEach(function (t) { out(io, "untagged: " + t + "\n"); }); out(io, "deleted: " + i.id + "\n"); space += i.size; d.images.splice(d.images.indexOf(i), 1); });
    out(io, "\nTotal reclaimed space: " + Dk.human(space) + "\n");
    return 0;
  };
  SUB.history = function (a, io, sess, sub) {
    var o = parse(a, { "H|human": false, "no-trunc": false, "q|quiet": false, "format": true }, sub, io); if (!o) return 1;
    if (o._.length !== 1) { errl(io, "\"docker history\" requires exactly 1 argument.\nSee 'docker history --help'.\n\nUsage:  docker history [OPTIONS] IMAGE\n\nShow the history of an image"); return 1; }
    var sys = sess.sys, img = findImage(sys, o._[0]);
    if (!img) { errl(io, "Error response from daemon: No such image: " + tagName(o._[0])); return 1; }
    var hist = img.history.slice().reverse();
    var rows = hist.map(function (h, i) {
      var by = h.by, created = h.created > 1e11 ? (stamp(sys) - h.created) / 1000 : clock(sys) - (h.created || 0);
      return { ID: i === 0 ? shortId(img) : (h.imgId ? h.imgId.slice(7, 19) : "<missing>"), CreatedSince: Dk.ago(created) + " ago", CreatedBy: o["no-trunc"] ? by : (by.length > 45 ? by.slice(0, 44) + "…" : by), Size: Dk.human(h.size || 0), Comment: h.buildkit ? "buildkit.dockerfile.v0" : "" };
    });
    if (o.quiet) { out(io, rows.map(function (r) { return r.ID + "\n"; }).join("")); return 0; }
    if (o.format) { out(io, formatRows(o.format, rows, { ID: "IMAGE", CreatedSince: "CREATED", CreatedBy: "CREATED BY", Size: "SIZE", Comment: "COMMENT" })); return 0; }
    out(io, table([["IMAGE", "CREATED", "CREATED BY", "SIZE", "COMMENT"]].concat(rows.map(function (r) { return [r.ID, r.CreatedSince, r.CreatedBy, r.Size, r.Comment]; }))));
    return 0;
  };
  SUB.save = function (a, io, sess, sub) {
    var o = parse(a, { "o|output": true }, sub, io); if (!o) return 1;
    var img = findImage(sess.sys, o._[0]); if (!img) { errl(io, "Error response from daemon: No such image: " + tagName(o._[0] || "")); return 1; }
    if (!o.output) { errl(io, "cowardly refusing to save to a terminal. Use the -o flag or redirect"); return 1; }
    var list = [{ path: "manifest.json", content: JSON.stringify([{ Config: img.id.slice(7) + ".json", RepoTags: img.tags, Layers: img.layers.map(function (L) { return "blobs/sha256/" + L.id.slice(7); }) }]) + "\n" }];
    img.layers.forEach(function (L) {
      var inner = Object.keys(L.files).filter(function (p) { return L.files[p].t === "f"; }).map(function (p) { return { path: p.slice(1), content: L.files[p].c }; });
      list.push({ path: "blobs/sha256/" + L.id.slice(7), archive: inner });
    });
    var err = Dk.writeTar ? Dk.writeTar(sess, absHost(sess, o.output), list) : null;
    if (err) { errl(io, err); return 1; }
    return 0;
  };

  /* ---------------- pull, push, login, logout */
  SUB.pull = function (a, io, sess, sub) {
    var o = parse(a, { "q|quiet": false, "a|all-tags": false, "platform": true }, sub, io); if (!o) return 1;
    if (o._.length !== 1) { errl(io, "\"docker pull\" requires exactly 1 argument.\nSee 'docker pull --help'.\n\nUsage:  docker pull [OPTIONS] NAME[:TAG|@DIGEST]\n\nDownload an image from a registry"); return 1; }
    if (!/:|@/.test(o._[0].replace(/^[^/]*\.[^/]*\//, ""))) out(io, "Using default tag: latest\n");
    var img = pull(sess, o._[0], io, { quiet: o.quiet });
    if (img && o.quiet) out(io, Dk.fullName(Dk.parseRef(o._[0])) + "\n");
    return img ? 0 : 1;
  };
  SUB.push = function (a, io, sess, sub) {
    var o = parse(a, { "q|quiet": false, "a|all-tags": false }, sub, io); if (!o) return 1;
    var sys = sess.sys, ref = o._[0];
    if (!ref) { errl(io, "\"docker push\" requires exactly 1 argument."); return 1; }
    var p = Dk.parseRef(ref), img = findImage(sys, ref);
    if (!img) { errl(io, "An image does not exist locally with the tag: " + Dk.repoName(p) + (p.tag !== "latest" || /:latest$/.test(ref) ? "" : "")); return 1; }
    out(io, "The push refers to repository [" + (p.registry === "docker.io" ? "docker.io/" + p.repo : p.registry + "/" + p.repo) + "]\n");
    var deny = regAccess(sess, p, true);
    var layers = img.layers.filter(function (L) { return L.size > 0 || Object.keys(L.files).length; }).slice().reverse();
    if (deny) { layers.slice(0, 2).forEach(function (L) { out(io, L.id.slice(7, 19) + ": Preparing\n"); }); errl(io, deny); return 1; }
    var reg = state(sys).regs[p.registry], known = {};
    Object.keys(reg.manifests).forEach(function (dg) { reg.manifests[dg].layers.forEach(function (L) { known[L.id] = true; }); });
    layers.forEach(function (L) { out(io, L.id.slice(7, 19) + ": " + (known[L.id] ? "Layer already exists" : L.from ? "Mounted from " + L.from : "Pushed") + "\n"); });
    var dg = Dk.publish(state(sys).regs, ref, img);
    img.digests[Dk.repoName(p)] = dg;
    out(io, p.tag + ": digest: " + dg + " size: " + (900 + layers.length * 207) + "\n");
    tick(sys, 2);
    ev(sys, { kind: "push", image: img.id, ref: tagName(ref) });
    return 0;
  };
  SUB.login = function (a, io, sess, sub) {
    var o = parse(a, { "u|username": true, "p|password": true, "password-stdin": false }, sub, io); if (!o) return 1;
    var registry = o._[0] || "docker.io", sys = sess.sys;
    var reg = state(sys).regs[registry === "docker.io" ? "docker.io" : registry];
    var pw = o.password;
    if (o["password-stdin"]) { pw = String(io.stdin || "").replace(/\r?\n$/, ""); if (!o.username) { errl(io, "Error: Cannot perform an interactive login from a non TTY device"); return 1; } }
    if (o.password) errl(io, "WARNING! Using --password via the CLI is insecure. Use --password-stdin.");
    if (!o.username || pw == null) { note(io, "(docker login would ask for a username and password here. In the lab, pass them: docker login " + registry + " -u USER --password-stdin < TOKENFILE)"); return 1; }
    if (!reg) { errl(io, "Error response from daemon: Get \"https://" + registry + "/v2/\": dial tcp: lookup " + registry + ": no such host"); return 1; }
    var u = reg.users && reg.users[o.username];
    var good = reg.custom && Dk.registryAuth[reg.name] ? Dk.registryAuth[reg.name].login(sess, o.username, pw) : !!u && u.token === pw;
    if (!good) { errl(io, "Error response from daemon: Get \"https://" + registry + "/v2/\": " + (reg.custom ? "denied: denied" : "unauthorized: incorrect username or password")); return 1; }
    var home = homeOf(sess), cfg = dockerConfig(sess);
    cfg.auths = cfg.auths || {}; cfg.auths[registry] = { auth: b64(o.username + ":" + pw) };
    var dsess = { sys: sys, uid: sess.uid, gid: sess.gid, groups: [], cwd: "/", umask: 18, vars: {} };
    if (!hostNode(sys, home + "/.docker")) S.mkdirs(sys, home + "/.docker", 448, sess.uid, sess.gid);
    S.put(sys, home + "/.docker/config.json", JSON.stringify(cfg, null, "\t") + "\n", 384, sess.uid, sess.gid);
    void dsess;
    errl(io, "WARNING! Your password will be stored unencrypted in " + home + "/.docker/config.json.\nConfigure a credential helper to remove this warning. See\nhttps://docs.docker.com/engine/reference/commandline/login/#credential-stores\n");
    out(io, "Login Succeeded\n");
    return 0;
  };
  SUB.logout = function (a, io, sess) {
    var registry = a[0] || "docker.io", cfg = dockerConfig(sess);
    if (!cfg.auths || !cfg.auths[registry]) { out(io, "Not logged in to " + registry + "\n"); return 0; }
    delete cfg.auths[registry];
    S.put(sess.sys, homeOf(sess) + "/.docker/config.json", JSON.stringify(cfg, null, "\t") + "\n", 384, sess.uid, sess.gid);
    out(io, "Removing login credentials for " + registry + "\n"); return 0;
  };

  /* ---------------- volumes */
  SUB.volume = function (a, io, sess) {
    var sys = sess.sys, d = state(sys), op = a.shift();
    if (op === "create") {
      var o = parse(a, { "d|driver": true, "label": "list", "name": true, "o|opt": "list" }, "volume create", io); if (!o) return 1;
      var name = o._[0] || o.name || Dk.hex("vol" + d.seq++, 64);
      if (d.vols[name]) { out(io, name + "\n"); return 0; }
      makeVolume(sys, name, { labels: (o.label || []).reduce(function (m, kv) { var k = kv.split("="); m[k[0]] = k[1] || ""; return m; }, {}) });
      out(io, name + "\n"); ev(sys, { kind: "volume", name: name }); return 0;
    }
    if (op === "ls" || op === "list") {
      var o2 = parse(a, { "q|quiet": false, "f|filter": "list", "format": true }, "volume ls", io); if (!o2) return 1;
      var vols = Object.keys(d.vols).map(function (k) { return d.vols[k]; });
      (o2.filter || []).forEach(function (f) { if (f === "dangling=true") vols = vols.filter(function (v) { return !volumeInUse(sys, v.name).length; }); if (/^name=/.test(f)) vols = vols.filter(function (v) { return v.name.indexOf(f.slice(5)) >= 0; }); });
      vols.sort(function (x, y) { return x.name < y.name ? -1 : 1; });
      if (o2.quiet) { out(io, vols.map(function (v) { return v.name + "\n"; }).join("")); return 0; }
      if (o2.format) { out(io, formatRows(o2.format, vols.map(function (v) { return { Name: v.name, Driver: "local", Mountpoint: "/var/lib/docker/volumes/" + v.name + "/_data", Scope: "local" }; }), { Name: "VOLUME NAME", Driver: "DRIVER" })); return 0; }
      out(io, table([["DRIVER", "VOLUME NAME"]].concat(vols.map(function (v) { return ["local", v.name]; })))); return 0;
    }
    if (op === "inspect") {
      var o3 = parse(a, { "f|format": true }, "volume inspect", io); if (!o3) return 1;
      var docs = [], code = 0;
      o3._.forEach(function (n) { if (!d.vols[n]) { errl(io, "Error response from daemon: get " + n + ": no such volume"); code = 1; return; } docs.push(volDoc(sys, d.vols[n])); });
      printDocs(io, docs, o3.format); return code;
    }
    if (op === "rm" || op === "remove") {
      var o4 = parse(a, { "f|force": false }, "volume rm", io); if (!o4) return 1;
      var code2 = 0;
      o4._.forEach(function (n) {
        if (!d.vols[n]) { errl(io, "Error response from daemon: get " + n + ": no such volume"); code2 = 1; return; }
        var users = volumeInUse(sys, n);
        if (users.length) { errl(io, "Error response from daemon: remove " + n + ": volume is in use - [" + users.map(function (c) { return c.id; }).join(", ") + "]"); code2 = 1; return; }
        removeVolume(sys, n); out(io, n + "\n");
      });
      return code2;
    }
    if (op === "prune") {
      var o5 = parse(a, { "a|all": false, "f|force": false, "filter": "list" }, "volume prune", io); if (!o5) return 1;
      if (!o5.force) { out(io, "WARNING! This will remove anonymous local volumes not used by at least one container.\nAre you sure you want to continue? [y/N] "); note(io, "(No answer, so nothing was removed. Add -f to skip the question.)"); return 1; }
      var gone = Object.keys(d.vols).filter(function (n) { return !volumeInUse(sys, n).length && (o5.all || d.vols[n].anonymous); });
      if (gone.length) out(io, "Deleted Volumes:\n" + gone.map(function (n) { removeVolume(sys, n); return n + "\n"; }).join(""));
      out(io, "\nTotal reclaimed space: 0B\n"); return 0;
    }
    out(io, "\nUsage:  docker volume COMMAND\n\nManage volumes\n\nCommands:\n  create      Create a volume\n  inspect     Display detailed information on one or more volumes\n  ls          List volumes\n  prune       Remove unused local volumes\n  rm          Remove one or more volumes\n");
    return op ? 1 : 0;
  };

  /* ---------------- networks */
  SUB.network = function (a, io, sess) {
    var sys = sess.sys, d = state(sys), op = a.shift();
    if (op === "ls" || op === "list") {
      var o = parse(a, { "q|quiet": false, "f|filter": "list", "format": true, "no-trunc": false }, "network ls", io); if (!o) return 1;
      var nets = Object.keys(d.nets).map(function (k) { return d.nets[k]; }).sort(function (x, y) { return x.name < y.name ? -1 : 1; });
      if (o.quiet) { out(io, nets.map(function (n) { return n.id.slice(0, 12) + "\n"; }).join("")); return 0; }
      out(io, table([["NETWORK ID", "NAME", "DRIVER", "SCOPE"]].concat(nets.map(function (n) { return [n.id.slice(0, 12), n.name, n.driver, "local"]; })))); return 0;
    }
    if (op === "create") {
      var o2 = parse(a, { "d|driver": true, "internal": false, "subnet": true, "label": "list", "attachable": false }, "network create", io); if (!o2) return 1;
      var nm = o2._[0]; if (!nm) { errl(io, "\"docker network create\" requires exactly 1 argument."); return 1; }
      if (d.nets[nm]) { errl(io, "Error response from daemon: network with name " + nm + " already exists"); return 1; }
      var n = createNet(sys, nm, { internal: o2.internal }); out(io, n.id + "\n"); ev(sys, { kind: "network", name: nm }); return 0;
    }
    if (op === "rm" || op === "remove") {
      var code = 0;
      a.forEach(function (nm2) {
        var n2 = d.nets[nm2]; if (!n2) { errl(io, "Error response from daemon: network " + nm2 + " not found"); code = 1; return; }
        if (n2.dflt) { errl(io, "Error response from daemon: " + nm2 + " is a pre-defined network and cannot be removed"); code = 1; return; }
        if (d.ctrs.some(function (c) { return c.state === "running" && c.nets.some(function (x) { return x.net === nm2; }); })) { errl(io, "Error response from daemon: error while removing network: network " + nm2 + " id " + n2.id + " has active endpoints"); code = 1; return; }
        delete d.nets[nm2]; out(io, nm2 + "\n");
      });
      return code;
    }
    if (op === "inspect") {
      var o3 = parse(a, { "f|format": true }, "network inspect", io); if (!o3) return 1;
      var docs = [], c2 = 0;
      o3._.forEach(function (nm3) { var n3 = d.nets[nm3]; if (!n3) { errl(io, "Error response from daemon: network " + nm3 + " not found"); c2 = 1; return; } docs.push(netDoc(sys, n3)); });
      printDocs(io, docs, o3.format); return c2;
    }
    if (op === "connect" || op === "disconnect") {
      var o4 = parse(a, { "alias": "list", "ip": true, "f|force": false }, "network " + op, io); if (!o4) return 1;
      var n4 = d.nets[o4._[0]], c4 = ctrBy(sys, o4._[1]);
      if (!n4) { errl(io, "Error response from daemon: network " + o4._[0] + " not found"); return 1; }
      if (!c4) { errl(io, "Error response from daemon: No such container: " + o4._[1]); return 1; }
      var on = c4.nets.filter(function (x) { return x.net === n4.name; })[0];
      if (op === "connect") { if (on) { errl(io, "Error response from daemon: endpoint with name " + c4.name + " already exists in network " + n4.name); return 1; } c4.nets.push({ net: n4.name, ip: allocIp(sys, n4), aliases: o4.alias || [] }); }
      else { if (!on) { errl(io, "Error response from daemon: container " + c4.id + " is not connected to network " + n4.name); return 1; } c4.nets.splice(c4.nets.indexOf(on), 1); }
      return 0;
    }
    if (op === "prune") { Object.keys(d.nets).forEach(function (k) { if (!d.nets[k].dflt && !d.ctrs.some(function (c) { return c.nets.some(function (x) { return x.net === k; }); })) { out(io, "Deleted Networks:\n" + k + "\n"); delete d.nets[k]; } }); return 0; }
    out(io, "\nUsage:  docker network COMMAND\n\nManage networks\n\nCommands:\n  connect     Connect a container to a network\n  create      Create a network\n  disconnect  Disconnect a container from a network\n  inspect     Display detailed information on one or more networks\n  ls          List networks\n  prune       Remove all unused networks\n  rm          Remove one or more networks\n");
    return op ? 1 : 0;
  };

  /* ---------------- system df / prune */
  SUB["system-df"] = function (a, io, sess) {
    var d = state(sess.sys), used = {};
    d.ctrs.forEach(function (c) { used[c.image] = true; });
    var layerSeen = {}, imgSize = 0;
    d.images.forEach(function (i) { i.layers.forEach(function (L) { if (!layerSeen[L.id]) { layerSeen[L.id] = 1; imgSize += L.size; } }); });
    var reclaim = d.images.filter(function (i) { return !used[i.id]; }).reduce(function (s, i) { return s + i.size; }, 0);
    var cache = Object.keys(d.cache).length;
    out(io, table([["TYPE", "TOTAL", "ACTIVE", "SIZE", "RECLAIMABLE"], ["Images", d.images.length, Object.keys(used).length, Dk.human(imgSize), Dk.human(Math.min(reclaim, imgSize)) + " (" + (imgSize ? Math.round(Math.min(reclaim, imgSize) / imgSize * 100) : 0) + "%)"], ["Containers", d.ctrs.length, d.ctrs.filter(function (c) { return c.state === "running"; }).length, "0B", "0B"], ["Local Volumes", Object.keys(d.vols).length, Object.keys(d.vols).filter(function (n) { return volumeInUse(sess.sys, n).length; }).length, "0B", "0B"], ["Build Cache", cache, 0, Dk.human(cache * 1.2e6), Dk.human(cache * 1.2e6)]]));
    return 0;
  };
  SUB["system-prune"] = function (a, io, sess) {
    if (a.indexOf("-f") < 0 && a.indexOf("--force") < 0) { out(io, "WARNING! This will remove:\n  - all stopped containers\n  - all networks not used by at least one container\n  - all dangling images\n  - unused build cache\n\nAre you sure you want to continue? [y/N] "); note(io, "(No answer, so nothing was removed. Add -f to skip the question.)"); return 1; }
    SUB["container-prune"](["-f"], io, sess); SUB["image-prune"](["-f"].concat(a.indexOf("-a") >= 0 || a.indexOf("--all") >= 0 ? ["-a"] : []), io, sess);
    state(sess.sys).cache = {};
    return 0;
  };
  SUB["builder-prune"] = function (a, io, sess) { var n = Object.keys(state(sess.sys).cache).length; state(sess.sys).cache = {}; out(io, "Total:\t" + Dk.human(n * 1.2e6) + "\n"); return 0; };
  SUB["buildx-version"] = function (a, io) { out(io, "github.com/docker/buildx v0.17.1 257815a\n"); return 0; };
  SUB["buildx-ls"] = function (a, io) { out(io, "NAME/NODE     DRIVER/ENDPOINT   STATUS    BUILDKIT   PLATFORMS\ndefault*      docker\n \\_ default    \\_ default       running   v0.16.0    linux/amd64, linux/amd64/v2, linux/amd64/v3, linux/386\n"); return 0; };

  // sleep on the laptop lets the containers' clock run too (health checks, restarts)
  var sleepPrev = CMDS.sleep;
  CMDS.sleep = function (args, io, sess) {
    var r = sleepPrev(args, io, sess);
    if (sess.sys.dk && !sess.sys.dkCtr) { var secs = args.slice(1).reduce(function (s, x) { var m = /^(\d+(?:\.\d+)?)([smhd]?)$/.exec(x); return m ? s + +m[1] * ({ "": 1, s: 1, m: 60, h: 3600, d: 86400 }[m[2]]) : s; }, 0); advance(sess.sys, Math.min(secs, 600)); }
    return r;
  };
})(typeof window !== "undefined" ? window : globalThis);
