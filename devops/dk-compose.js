/* sudo learn — DevOps track: docker compose (v2). Reads compose.yaml with the DevYaml reader, interpolates
   ${VARS} from the shell and the project's .env, validates it with Compose's own error wording, and drives
   the same engine as `docker run`: a project network with DNS by service name, named volumes, secrets
   mounted at /run/secrets, healthchecks, depends_on conditions (compose really waits for service_healthy),
   restart policies, builds tagged <project>-<service>, and up/down/ps/logs/exec/run/config/build. */
(function (root) {
  "use strict";
  var S = root.ShEngine, M2 = S.M2, U = S.util, Dk = root.Dk, Y = root.DevYaml;
  var out = U.out, errl = U.errl, note = U.note;

  var FILES = ["compose.yaml", "compose.yml", "docker-compose.yaml", "docker-compose.yml"];
  var TOP = ["version", "name", "services", "volumes", "networks", "secrets", "configs", "include"];
  var SVC = ["image", "build", "command", "entrypoint", "environment", "env_file", "ports", "expose", "volumes", "depends_on", "healthcheck", "restart", "user", "working_dir", "container_name", "hostname", "networks", "labels", "read_only", "cap_drop", "cap_add", "security_opt", "mem_limit", "cpus", "deploy", "secrets", "tmpfs", "init", "stop_signal", "stop_grace_period", "profiles", "privileged", "pid", "logging", "extra_hosts", "platform", "pull_policy", "tty", "stdin_open", "configs", "ulimits", "pids_limit"];

  function words(s) { var m = String(s).match(/"[^"]*"|'[^']*'|\S+/g) || []; return m.map(function (w) { return w.replace(/^"(.*)"$|^'(.*)'$/, "$1$2"); }); }
  function readEnvFile(sys, path) {
    var t = M2.rd(sys, path); if (t == null) return null;
    var env = {};
    t.split("\n").forEach(function (l) { l = l.replace(/\r$/, ""); if (!l.trim() || /^\s*#/.test(l)) return; var i = l.indexOf("="); if (i < 0) return; var v = l.slice(i + 1).trim(); if (/^"(.*)"$|^'(.*)'$/.test(v)) v = v.slice(1, -1); env[l.slice(0, i).trim().replace(/^export\s+/, "")] = v; });
    return env;
  }
  // ${VAR}, ${VAR:-x}, ${VAR-x}, ${VAR:?msg}, $$ -> $
  function interp(v, env, warn, errs) {
    if (typeof v === "string") return v.replace(/\$\$|\$\{(\w+)(?:(:?[-?+])([^}]*))?\}|\$(\w+)/g, function (m0, a, op, arg, b) {
      if (m0 === "$$") return "$";
      var k = a || b, has = Object.prototype.hasOwnProperty.call(env, k), val = env[k];
      if (op === ":-") return has && val !== "" ? val : arg;
      if (op === "-") return has ? val : arg;
      if (op === ":?" || op === "?") { if (!has || (op === ":?" && val === "")) { errs.push("required variable " + k + " is missing a value: " + arg); return ""; } return val; }
      if (op === ":+" || op === "+") return has && (op === "+" || val !== "") ? arg : "";
      if (!has) { if (warn.indexOf(k) < 0) warn.push(k); return ""; }
      return val;
    });
    if (Array.isArray(v)) return v.map(function (x) { return interp(x, env, warn, errs); });
    if (v && typeof v === "object") { var o = {}; Object.keys(v).forEach(function (k) { o[k] = interp(v[k], env, warn, errs); }); return o; }
    return v;
  }
  function slug(s) { return String(s).toLowerCase().replace(/[^a-z0-9_-]/g, ""); }

  /* ---------------- load + validate a project */
  function load(sess, o, io) {
    var sys = sess.sys, files = o.files && o.files.length ? o.files.map(function (f) { return Dk.absHost(sess, f); }) : null;
    var dir = sess.cwd;
    if (!files) {
      // search up from the current folder
      var d = dir;
      for (;;) { var hit = FILES.filter(function (f) { return Dk.fsNode(sys, d + "/" + f); })[0]; if (hit) { files = [d + "/" + hit]; break; } if (d === "/" || !d) break; d = d.slice(0, d.lastIndexOf("/")) || "/"; if (d === "/") { var h2 = FILES.filter(function (f) { return Dk.fsNode(sys, "/" + f); })[0]; if (h2) files = ["/" + h2]; break; } }
      if (!files) { errl(io, "no configuration file provided: not found"); return null; }
    }
    var docs = [];
    for (var i = 0; i < files.length; i++) {
      var r = S.readFile(sess, files[i]);
      if (r.error) { errl(io, "open " + files[i] + ": no such file or directory"); return null; }
      var y = Y.tryParse(r.content);
      if (y.error) { errl(io, y.error.replace(/^yaml:/, "yaml:") ); return null; }
      if (!y.value || typeof y.value !== "object") { errl(io, "empty compose file"); return null; }
      docs.push(y.value);
    }
    var raw = docs.reduce(function (acc, d2) { return merge(acc, d2); }, {});
    var pdir = files[0].slice(0, files[0].lastIndexOf("/")) || "/";
    var env = readEnvFile(sys, pdir + "/.env") || {};
    var shellEnv = S.exportedEnv(sess);
    Object.keys(shellEnv).forEach(function (k) { env[k] = shellEnv[k]; });
    var warn = [], errs = [];
    var doc = interp(raw, env, warn, errs);
    warn.forEach(function (k) { errl(io, "WARN[0000] The \"" + k + "\" variable is not set. Defaulting to a blank string."); });
    if (errs.length) { errl(io, errs[0]); return null; }
    if (doc.version != null) errl(io, "WARN[0000] " + files[0] + ": the attribute `version` is obsolete, it will be ignored, please remove it to avoid potential confusion");
    var bad = Object.keys(doc).filter(function (k) { return TOP.indexOf(k) < 0 && !/^x-/.test(k); });
    if (bad.length) { errl(io, "validating " + files[0] + ": additional properties '" + bad[0] + "' not allowed"); return null; }
    if (!doc.services || typeof doc.services !== "object") { errl(io, "no service selected"); return null; }
    var name = slug(o.project || doc.name || shellEnv.COMPOSE_PROJECT_NAME || pdir.split("/").pop());
    var P = { name: name, dir: pdir, file: files[0], services: {}, volumes: doc.volumes || {}, networks: doc.networks || {}, secrets: doc.secrets || {}, raw: doc, env: env };
    var names = Object.keys(doc.services);
    for (var k = 0; k < names.length; k++) {
      var sn = names[k], s = doc.services[sn] || {};
      var badk = Object.keys(s).filter(function (x) { return SVC.indexOf(x) < 0 && !/^x-/.test(x); });
      if (badk.length) { errl(io, "validating " + files[0] + ": services." + sn + " additional properties '" + badk[0] + "' not allowed"); return null; }
      if (!s.image && !s.build) { errl(io, "service \"" + sn + "\" has neither an image nor a build context specified: invalid compose project"); return null; }
      var svc = normalize(sess, P, sn, s, io);
      if (!svc) return null;
      P.services[sn] = svc;
    }
    for (var k2 = 0; k2 < names.length; k2++) {
      var sv = P.services[names[k2]];
      var dbad = Object.keys(sv.depends).filter(function (d3) { return !P.services[d3]; });
      if (dbad.length) { errl(io, "service \"" + sv.name + "\" depends on undefined service \"" + dbad[0] + "\": invalid compose project"); return null; }
      var vbad = sv.volumes.filter(function (v) { return v.type === "volume" && !v.anon && !(v.name in (P.volumes || {})); });
      if (vbad.length) { errl(io, "service \"" + sv.name + "\" refers to undefined volume " + vbad[0].name + ": invalid compose project"); return null; }
      var sbad = sv.secrets.filter(function (x) { return !P.secrets[x.source]; });
      if (sbad.length) { errl(io, "service \"" + sv.name + "\" refers to undefined secret " + sbad[0].source + ": invalid compose project"); return null; }
    }
    return P;
  }
  function merge(a, b) {
    if (Array.isArray(a) && Array.isArray(b)) return a.concat(b);
    if (a && b && typeof a === "object" && typeof b === "object") { var o = Object.assign({}, a); Object.keys(b).forEach(function (k) { o[k] = k in a ? merge(a[k], b[k]) : b[k]; }); return o; }
    return b;
  }
  function normalize(sess, P, sn, s, io) {
    var sys = sess.sys, rel = function (p) { return Dk.absHost({ home: sess.home, cwd: P.dir }, p); };
    var env = {};
    var efs = s.env_file == null ? [] : Array.isArray(s.env_file) ? s.env_file : [s.env_file];
    for (var i = 0; i < efs.length; i++) { var ep = rel(typeof efs[i] === "object" ? efs[i].path : efs[i]), e = readEnvFile(sys, ep); if (!e) { errl(io, "env file " + ep + " not found: stat " + ep + ": no such file or directory"); return null; } Object.assign(env, e); }
    if (Array.isArray(s.environment)) s.environment.forEach(function (kv) { kv = String(kv); var k = kv.indexOf("="); if (k < 0) { if (P.env[kv] != null) env[kv] = P.env[kv]; } else env[kv.slice(0, k)] = kv.slice(k + 1); });
    else if (s.environment) Object.keys(s.environment).forEach(function (k) { var v = s.environment[k]; if (v == null) { if (P.env[k] != null) env[k] = P.env[k]; } else env[k] = String(v); });
    var vols = (s.volumes || []).map(function (v) {
      if (typeof v === "object") return v.type === "bind" ? { type: "bind", src: rel(v.source), dst: v.target, ro: !!v.read_only } : v.type === "tmpfs" ? { type: "tmpfs", dst: v.target } : v.source ? { type: "volume", name: v.source, dst: v.target, ro: !!v.read_only } : { type: "volume", anon: true, dst: v.target };
      var p = String(v).split(":");
      if (p.length === 1) return { type: "volume", anon: true, dst: p[0] };
      if (/^[.\/~]/.test(p[0])) return { type: "bind", src: rel(p[0]), dst: p[1], ro: /\bro\b/.test(p[2] || "") };
      return { type: "volume", name: p[0], dst: p[1], ro: /\bro\b/.test(p[2] || "") };
    });
    var dep = {};
    if (Array.isArray(s.depends_on)) s.depends_on.forEach(function (d) { dep[d] = "service_started"; });
    else if (s.depends_on) Object.keys(s.depends_on).forEach(function (d) { dep[d] = (s.depends_on[d] || {}).condition || "service_started"; });
    var hc = null;
    if (s.healthcheck) {
      if (s.healthcheck.disable) hc = false;
      else { var t = s.healthcheck.test; hc = { Test: Array.isArray(t) ? t : ["CMD-SHELL", String(t)], Interval: Dk.parseDuration(s.healthcheck.interval || "30s"), Timeout: Dk.parseDuration(s.healthcheck.timeout || "30s"), Retries: s.healthcheck.retries != null ? +s.healthcheck.retries : 3, StartPeriod: Dk.parseDuration(s.healthcheck.start_period || "0s") }; }
    }
    var build = null;
    if (s.build) { build = typeof s.build === "string" ? { context: rel(s.build) } : { context: rel(s.build.context || "."), dockerfile: s.build.dockerfile, target: s.build.target, args: s.build.args || {} }; if (Array.isArray(build.args)) { var ba = {}; build.args.forEach(function (kv) { var q = String(kv).split("="); ba[q[0]] = q.slice(1).join("="); }); build.args = ba; } }
    var secrets = (s.secrets || []).map(function (x) { return typeof x === "string" ? { source: x, target: x } : { source: x.source, target: x.target || x.source }; });
    var mem = s.mem_limit || (s.deploy && s.deploy.resources && s.deploy.resources.limits && s.deploy.resources.limits.memory);
    return {
      name: sn, image: s.image ? String(s.image) : null, build: build, command: s.command == null ? null : Array.isArray(s.command) ? s.command.map(String) : words(s.command), entrypoint: s.entrypoint == null ? null : Array.isArray(s.entrypoint) ? s.entrypoint.map(String) : words(s.entrypoint),
      env: env, ports: (s.ports || []).map(function (p) { return typeof p === "object" ? (p.host_ip ? p.host_ip + ":" : "") + (p.published || "") + ":" + p.target : String(p); }), volumes: vols, depends: dep, healthcheck: hc, restart: s.restart || "no", user: s.user != null ? String(s.user) : null, workdir: s.working_dir || null,
      containerName: s.container_name || null, readOnly: !!s.read_only, capDrop: s.cap_drop || [], capAdd: s.cap_add || [], secOpt: s.security_opt || [], mem: mem ? Dk.parseBytes(String(mem).replace(/([kmg])$/i, "$1b")) : 0, secrets: secrets, tmpfs: s.tmpfs ? (Array.isArray(s.tmpfs) ? s.tmpfs : [s.tmpfs]) : [], init: !!s.init, labels: s.labels || {}, privileged: !!s.privileged, networks: Array.isArray(s.networks) ? s.networks : s.networks ? Object.keys(s.networks) : null, raw: s
    };
  }
  function order(P, only) {
    var seen = {}, res = [];
    function visit(n) { if (seen[n]) return; seen[n] = true; Object.keys(P.services[n].depends).forEach(visit); res.push(n); }
    (only && only.length ? only : Object.keys(P.services)).forEach(visit);
    return res;
  }
  function projCtrs(sys, P, svc) { return Dk.state(sys).ctrs.filter(function (c) { return c.compose && c.compose.project === P.name && (!svc || c.compose.service === svc) && !c.compose.oneoff; }); }
  function imageFor(P, s) { return s.image || P.name + "-" + s.name; }
  function volName(P, v) { var def = P.volumes[v] || {}; return def && def.name ? def.name : def && def.external ? v : P.name + "_" + v; }
  function netName(P, n) { var def = P.networks[n] || {}; return def && def.name ? def.name : P.name + "_" + n; }
  function hashOf(P, s, img) { return Dk.hex(JSON.stringify([s.image, s.command, s.entrypoint, s.env, s.ports, s.volumes, s.user, s.workdir, s.readOnly, s.secrets, s.healthcheck, s.restart, s.mem, img ? img.id : null]), 64); }

  /* ---------------- progress block like compose v2 */
  function progress(io, title, rows) {
    if (!rows.length) return;
    var w = rows.reduce(function (m, r) { return Math.max(m, r[0].length); }, 0);
    out(io, "[+] " + title + " " + rows.length + "/" + rows.length + "\n" + rows.map(function (r) { return " " + (r[2] === "err" ? "✘" : "✔") + " " + r[0] + new Array(w - r[0].length + 3).join(" ") + r[1] + new Array(Math.max(2, 26 - r[1].length)).join(" ") + (r[3] || 0.1).toFixed(1) + "s\n"; }).join(""));
  }

  function buildService(sess, P, s, io, o) {
    var tag = imageFor(P, s);
    var res = Dk.build(sess, { ctxDir: s.build.context, ctxArg: s.build.context, file: s.build.dockerfile ? s.build.context + "/" + s.build.dockerfile : null, tags: [tag], args: s.build.args || {}, noCache: o.noCache, target: s.build.target, secrets: {} }, io);
    return res.error ? null : res.img;
  }
  function ensureNet(sys, P, io, rows) {
    var nn = P.name + "_default";
    if (!Dk.state(sys).nets[nn]) { Dk.createNet(sys, nn, { labels: { "com.docker.compose.project": P.name } }); rows.push(["Network " + nn, "Created", "ok", 0.1]); }
    Object.keys(P.networks || {}).forEach(function (n) { var full = netName(P, n); if (!Dk.state(sys).nets[full]) { Dk.createNet(sys, full, { labels: { "com.docker.compose.project": P.name }, internal: !!(P.networks[n] || {}).internal }); rows.push(["Network " + full, "Created", "ok", 0.1]); } });
  }
  function createFor(sess, P, s, img, io, num, oneoff) {
    var sys = sess.sys;
    var mounts = s.volumes.map(function (v) {
      if (v.type === "volume" && !v.anon) return { type: "volume", name: volName(P, v.name), dst: v.dst, ro: v.ro };
      if (v.type === "volume") return { type: "volume", name: Dk.hex("anon:" + P.name + s.name + v.dst + num, 64), dst: v.dst, anon: true };
      if (v.type === "bind") { if (!Dk.fsNode(sys, v.src)) S.mkdirs(sys, v.src, 493, 0, 0); return { type: "bind", src: v.src, dst: v.dst, ro: v.ro }; }
      return { type: "tmpfs", dst: v.dst };
    }).concat(s.tmpfs.map(function (t) { return { type: "tmpfs", dst: String(t).split(":")[0] }; }));
    var secrets = s.secrets.map(function (x) { var def = P.secrets[x.source]; return { src: def.file ? Dk.absHost({ home: sess.home, cwd: P.dir }, def.file) : null, env: def.environment, dst: x.target.charAt(0) === "/" ? x.target : "/run/secrets/" + x.target }; });
    secrets.forEach(function (x) { if (x.env != null) { x.src = "/var/lib/docker/compose-secrets/" + P.name + "/" + x.dst.split("/").pop(); S.put(sys, x.src, (P.env[x.env] || "") + "", 384, 0, 0); } });
    var rp = /^(no|always|unless-stopped|on-failure)(?::(\d+))?$/.exec(String(s.restart)) || ["", "no"];
    var nets = s.networks && s.networks.length ? s.networks.map(function (n) { return netName(P, n); }) : [P.name + "_default"];
    var cname = s.containerName || (oneoff ? P.name + "-" + s.name + "-run-" + Dk.hex(P.name + s.name + Dk.state(sys).seq, 12) : P.name + "-" + s.name + "-" + num);
    var portsParsed = [];
    for (var i = 0; i < s.ports.length; i++) { var pp = s.ports[i].split(":"); var hip = pp.length === 3 ? pp[0] : "0.0.0.0", hp = pp.length >= 2 ? pp[pp.length - 2] : "", cp = pp[pp.length - 1].split("/")[0]; portsParsed.push({ hostIp: hip, hostPort: hp ? +hp : 32768 + i + Dk.state(sys).seq, ctrPort: +cp, proto: /\/udp$/.test(s.ports[i]) ? "udp" : "tcp" }); }
    var c = Dk.createCtr(sys, img, {
      name: cname, imageRef: imageFor(P, s), cmd: s.command, entrypoint: s.entrypoint, env: Object.assign({}, s.env), ports: oneoff ? [] : portsParsed, mounts: mounts, secrets: secrets,
      restart: { name: rp[1], max: rp[2] ? +rp[2] : 0 }, user: s.user, workdir: s.workdir, network: nets[0], extraNets: nets.slice(1).map(function (n) { return { net: n, aliases: [s.name] }; }), aliases: [s.name, cname],
      labels: Object.assign({ "com.docker.compose.project": P.name, "com.docker.compose.service": s.name, "com.docker.compose.container-number": String(num), "com.docker.compose.project.working_dir": P.dir, "com.docker.compose.config-hash": hashOf(P, s, img) }, s.labels),
      readOnly: s.readOnly, capDrop: s.capDrop, capAdd: s.capAdd, secOpt: s.secOpt, mem: s.mem, healthcheck: s.healthcheck, init: s.init, privileged: s.privileged,
      compose: { project: P.name, service: s.name, num: num, hash: hashOf(P, s, img), oneoff: !!oneoff, depends: s.depends }
    });
    return c;
  }
  // Wait until dep satisfies condition. Returns null or an error string.
  function waitFor(sys, P, dep, cond, rows) {
    var c = projCtrs(sys, P, dep)[0];
    if (!c) return null;
    if (cond === "service_started") return null;
    var t0 = Dk.clock(sys);
    for (var i = 0; i < 180; i++) {
      Dk.settle(sys);
      if (cond === "service_healthy") {
        if (!Dk.healthCfg(sys, c)) return "dependency failed to start: container " + c.name + " has no healthcheck configured";
        if (c.health && c.health.status === "healthy") { rows.push(["Container " + c.name, "Healthy", "ok", Dk.clock(sys) - t0 + 0.5]); return null; }
        if (c.state !== "running" && c.state !== "restarting") return "dependency failed to start: container " + c.name + " exited (" + c.exitCode + ")";
        if (c.health && c.health.status === "unhealthy") { rows.push(["Container " + c.name, "Error", "err", Dk.clock(sys) - t0]); return "dependency failed to start: container " + c.name + " is unhealthy"; }
      } else if (cond === "service_completed_successfully") {
        if (c.state === "exited") return c.exitCode === 0 ? null : "service \"" + dep + "\" didn't complete successfully: exit " + c.exitCode;
      }
      Dk.tick(sys, 1);
    }
    return "dependency failed to start: container " + c.name + " is unhealthy";
  }

  /* ================================================================== commands */
  var C = {};
  C.up = function (sess, P, a, io) {
    var o = Dk.parseArgs(a, { "d|detach": false, "build": false, "force-recreate": false, "no-deps": false, "wait": false, "remove-orphans": false, "no-build": false, "pull": true, "quiet-pull": false, "no-recreate": false, "no-start": false, "abort-on-container-exit": false, "timeout|t": true, "y": false }, "compose up", io);
    if (!o) return 1;
    var sys = sess.sys, names = o["no-deps"] ? o._ : order(P, o._);
    if (o._.some(function (n) { return !P.services[n]; })) { errl(io, "no such service: " + o._.filter(function (n) { return !P.services[n]; })[0]); return 1; }
    // build and pull first
    var imgs = {}, pulls = [];
    for (var i = 0; i < names.length; i++) {
      var s = P.services[names[i]], ref = imageFor(P, s), img = Dk.findImage(sys, ref);
      if (s.build && (o.build || !img) && !o["no-build"]) { img = buildService(sess, P, s, io, {}); if (!img) { errl(io, "failed to solve: process did not complete successfully"); return 1; } out(io, "\n"); }
      if (!img) {
        var cap = Dk.capture(); img = Dk.pull(sess, ref, cap.io, { quiet: true });
        if (!img) { progress(io, "Pulling", [[s.name, "Error", "err", 0.4]]); errl(io, "Error response from daemon: " + cap.text("err").replace(/^Error response from daemon: /, "").replace(/\n$/, "")); return 1; }
        pulls.push([s.name, "Pulled", "ok", 3.2]);
      }
      imgs[names[i]] = img;
    }
    if (pulls.length) progress(io, "Pulling", pulls);
    var rows = [];
    ensureNet(sys, P, io, rows);
    names.forEach(function (n) { P.services[n].volumes.forEach(function (v) { if (v.type === "volume" && !v.anon) { var vn = volName(P, v.name); if (!Dk.state(sys).vols[vn]) { Dk.makeVolume(sys, vn, { labels: { "com.docker.compose.project": P.name, "com.docker.compose.volume": v.name } }); rows.push(["Volume \"" + vn + "\"", "Created", "ok", 0.0]); } } }); });
    var started = [], err = null;
    for (var k = 0; k < names.length && !err; k++) {
      var sv = P.services[names[k]], im = imgs[names[k]], existing = projCtrs(sys, P, sv.name)[0];
      var h = hashOf(P, sv, im), c;
      if (existing && existing.compose.hash === h && !o["force-recreate"]) {
        c = existing;
        if (c.state === "running") { rows.push(["Container " + c.name, "Running", "ok", 0.0]); started.push(c); continue; }
      } else if (existing) {
        Dk.stopCtr(sys, existing); Dk.removeCtr(sys, existing, false);
        c = createFor(sess, P, sv, im, io, 1);
        rows.push(["Container " + c.name, "Recreated", "ok", 0.3]);
      } else { c = createFor(sess, P, sv, im, io, 1); rows.push(["Container " + c.name, "Created", "ok", 0.1]); }
      if (o["no-start"]) continue;
      // depends_on conditions
      var deps = Object.keys(sv.depends);
      for (var di = 0; di < deps.length && !err; di++) err = waitFor(sys, P, deps[di], sv.depends[deps[di]], rows);
      if (err) break;
      var clash = Dk.portClash(sys, c.ports, c);
      if (clash) { err = "Error response from daemon: driver failed programming external connectivity on endpoint " + c.name + " (" + Dk.hex("ep" + c.id, 64) + "): " + clash; rows.push(["Container " + c.name, "Error", "err", 0.1]); break; }
      c.stoppedByUser = false;
      var r = Dk.startCtr(sys, c, {});
      if (r.error) { err = "Error response from daemon: failed to create task for container: failed to create shim task: OCI runtime create failed: runc create failed: unable to start container process: " + r.error + ": unknown"; rows.push(["Container " + c.name, "Error", "err", 0.1]); break; }
      rows.push(["Container " + c.name, "Started", "ok", 0.4]);
      started.push(c);
      Dk.tick(sys, 1); Dk.settle(sys);
    }
    // de-duplicate rows: keep the last state per object
    var pos = {}, fin = [];
    rows.forEach(function (r) { if (pos[r[0]] == null) { pos[r[0]] = fin.length; fin.push(r); } else fin[pos[r[0]]] = r; });
    progress(io, "Running", fin);
    if (err) { errl(io, err); return 1; }
    if (o.wait) {
      for (var w = 0; w < 120; w++) { Dk.settle(sys); var pending = started.filter(function (c2) { return c2.state === "running" && c2.health && c2.health.status === "starting"; }); if (!pending.length) break; Dk.tick(sys, 1); }
      var bad = started.filter(function (c2) { return c2.state !== "running" || (c2.health && c2.health.status === "unhealthy"); })[0];
      if (bad) { errl(io, "container " + bad.name + " " + (bad.state !== "running" ? "exited (" + bad.exitCode + ")" : "is unhealthy")); return 1; }
    }
    if (!o.detach) {
      out(io, "Attaching to " + started.map(function (c2) { return c2.compose.service + "-" + c2.compose.num; }).sort().join(", ") + "\n");
      printLogs(sys, started, io, {});
      note(io, "(compose up without -d stays attached to the logs. The lab pressed Ctrl+C for you, which stops the containers. Use docker compose up -d to keep them running.)");
      out(io, "Gracefully stopping... (press Ctrl+C again to force)\n");
      started.slice().reverse().forEach(function (c2) { Dk.stopCtr(sys, c2); });
      progress(io, "Stopping", started.slice().reverse().map(function (c2) { return ["Container " + c2.name, "Stopped", "ok", 0.3]; }));
      return 130;
    }
    return 0;
  };
  function printLogs(sys, ctrs, io, o) {
    var w = ctrs.reduce(function (m, c) { return Math.max(m, (c.compose.service + "-" + c.compose.num).length); }, 0);
    var all = [];
    ctrs.forEach(function (c) { var ls = c.logs; if (o.tail != null && o.tail !== "all") ls = ls.slice(Math.max(0, ls.length - +o.tail)); ls.forEach(function (l, i) { all.push({ t: l.t, i: i, c: c, l: l }); }); });
    all.sort(function (x, y) { return x.t - y.t || (x.c.name < y.c.name ? -1 : x.c.name > y.c.name ? 1 : x.i - y.i); });
    all.forEach(function (x) { var pre = o.noPrefix ? "" : (x.c.compose.service + "-" + x.c.compose.num + new Array(w + 2).join(" ")).slice(0, w + 1) + " | "; (x.l.s === "err" ? io.err : io.out)(pre + x.l.text + "\n"); });
  }
  C.down = function (sess, P, a, io) {
    var o = Dk.parseArgs(a, { "v|volumes": false, "rmi": true, "remove-orphans": false, "t|timeout": true }, "compose down", io); if (!o) return 1;
    var sys = sess.sys, ctrs = Dk.state(sys).ctrs.filter(function (c) { return c.compose && c.compose.project === P.name; });
    var rows = [];
    ctrs.slice().reverse().forEach(function (c) { if (c.state === "running") Dk.stopCtr(sys, c); Dk.removeCtr(sys, c, o.volumes); rows.push(["Container " + c.name, "Removed", "ok", 0.3]); });
    if (o.volumes) Object.keys(P.volumes || {}).forEach(function (v) { var vn = volName(P, v); if (Dk.state(sys).vols[vn] && !(P.volumes[v] || {}).external) { Dk.removeVolume(sys, vn); rows.push(["Volume " + vn, "Removed", "ok", 0.0]); } });
    var nets = [P.name + "_default"].concat(Object.keys(P.networks || {}).map(function (n) { return netName(P, n); }));
    nets.forEach(function (n) { if (Dk.state(sys).nets[n]) { delete Dk.state(sys).nets[n]; rows.push(["Network " + n, "Removed", "ok", 0.1]); } });
    if (o.rmi) Object.keys(P.services).forEach(function (n) { var s = P.services[n]; if (o.rmi === "all" || (o.rmi === "local" && !s.image)) { var im = Dk.findImage(sys, imageFor(P, s)); if (im) { Dk.state(sys).images.splice(Dk.state(sys).images.indexOf(im), 1); rows.push(["Image " + imageFor(P, s), "Removed", "ok", 0.0]); } } });
    if (!rows.length) { errl(io, "Warning: No resource found to remove for project \"" + P.name + "\"."); return 0; }
    progress(io, "Running", rows);
    return 0;
  };
  C.ps = function (sess, P, a, io) {
    var o = Dk.parseArgs(a, { "a|all": false, "q|quiet": false, "format": true, "services": false, "status": "list" }, "compose ps", io); if (!o) return 1;
    var sys = sess.sys, list = projCtrs(sys, P).concat(Dk.state(sys).ctrs.filter(function (c) { return c.compose && c.compose.project === P.name && c.compose.oneoff; }));
    if (!o.all) list = list.filter(function (c) { return c.state === "running" || c.state === "restarting"; });
    if (o._.length) list = list.filter(function (c) { return o._.indexOf(c.compose.service) >= 0; });
    list.sort(function (x, y) { return x.name < y.name ? -1 : 1; });
    if (o.quiet) { out(io, list.map(function (c) { return c.id + "\n"; }).join("")); return 0; }
    if (o.services) { out(io, list.map(function (c) { return c.compose.service + "\n"; }).join("")); return 0; }
    var rows = list.map(function (c) { var r = Dk.ctrRow(sys, c); r.Service = c.compose.service; r.Name = c.name; r.Health = c.health ? c.health.status : ""; return r; });
    if (o.format) { if (o.format === "json") out(io, rows.map(function (r) { return JSON.stringify({ Name: r.Name, Service: r.Service, State: r.State, Health: r.Health, Status: r.Status, Image: r.Image }); }).join("\n") + "\n"); else out(io, Dk.formatRows(o.format, rows, { Name: "NAME", Service: "SERVICE", Status: "STATUS", State: "STATE", Image: "IMAGE", Ports: "PORTS", Health: "HEALTH" })); return 0; }
    out(io, Dk.table([["NAME", "IMAGE", "COMMAND", "SERVICE", "CREATED", "STATUS", "PORTS"]].concat(rows.map(function (r) { return [r.Name, r.Image, r.Command, r.Service, r.RunningFor, r.Status, r.Ports]; }))));
    return 0;
  };
  C.logs = function (sess, P, a, io) {
    var o = Dk.parseArgs(a, { "f|follow": false, "n|tail": true, "t|timestamps": false, "no-log-prefix": false, "no-color": false, "since": true }, "compose logs", io); if (!o) return 1;
    var list = projCtrs(sess.sys, P).filter(function (c) { return !o._.length || o._.indexOf(c.compose.service) >= 0; });
    if (o._.some(function (n) { return !P.services[n]; })) { errl(io, "no such service: " + o._.filter(function (n) { return !P.services[n]; })[0]); return 1; }
    printLogs(sess.sys, list, io, { tail: o.tail, noPrefix: o["no-log-prefix"] });
    if (o.follow) note(io, "(-f keeps following until Ctrl+C. The lab printed what's there and stopped.)");
    return 0;
  };
  C.exec = function (sess, P, a, io) {
    var o = Dk.parseArgs(a, { "T|no-TTY": false, "u|user": true, "w|workdir": true, "e|env": "list", "d|detach": false, "index": true, "privileged": false, "i|interactive": false, "t|tty": false }, "compose exec", io, true); if (!o) return 1;
    var sn = o._[0], cmd = o._.slice(1);
    if (!sn) { errl(io, "\"docker compose exec\" requires at least 2 arguments."); return 1; }
    if (!P.services[sn]) { errl(io, "service \"" + sn + "\" is not running"); return 1; }
    var c = projCtrs(sess.sys, P, sn).filter(function (x) { return x.state === "running"; })[0];
    if (!c) { errl(io, "service \"" + sn + "\" is not running"); return 1; }
    if (!cmd.length) { errl(io, "\"docker compose exec\" requires at least 2 arguments.\nSee 'docker compose exec --help'."); return 1; }
    return Dk.execIn(sess, c, cmd, { user: o.user, workdir: o.workdir, env: o.env, interactive: !o["no-TTY"], tty: !o["no-TTY"] }, io);
  };
  C.run = function (sess, P, a, io) {
    var o = Dk.parseArgs(a, { "rm": false, "d|detach": false, "no-deps": false, "e|env": "list", "u|user": true, "T|no-TTY": false, "entrypoint": true, "build": false, "name": true, "p|publish": "list", "w|workdir": true, "i|interactive": false }, "compose run", io, true); if (!o) return 1;
    var sys = sess.sys, sn = o._[0], s = P.services[sn];
    if (!s) { errl(io, "no such service: " + sn); return 1; }
    if (!o["no-deps"] && Object.keys(s.depends).length) { var cap = Dk.capture(); C.up(sess, P, ["-d"].concat(order(P, Object.keys(s.depends))), cap.io); }
    var img = Dk.findImage(sys, imageFor(P, s));
    if (!img && s.build) img = buildService(sess, P, s, io, {});
    if (!img) img = Dk.pull(sess, imageFor(P, s), Dk.capture().io, { quiet: true });
    if (!img) { errl(io, "pull access denied for " + imageFor(P, s)); return 1; }
    var rows = []; ensureNet(sys, P, io, rows);
    var s2 = Object.assign({}, s);
    if (o._.length > 1) s2.command = o._.slice(1);
    if (o.entrypoint != null) s2.entrypoint = words(o.entrypoint);
    if (o.user) s2.user = o.user;
    (o.env || []).forEach(function (kv) { var k = kv.indexOf("="); s2.env = Object.assign({}, s2.env); s2.env[kv.slice(0, k)] = kv.slice(k + 1); });
    var c = createFor(sess, P, s2, img, io, 1, true);
    c.autoRm = !!o.rm;
    return Dk.runCtr(sess, c, io, { detach: o.detach, interactive: !o["no-TTY"], attachOut: true });
  };
  C.build = function (sess, P, a, io) {
    var o = Dk.parseArgs(a, { "no-cache": false, "pull": false, "q|quiet": false, "progress": true }, "compose build", io); if (!o) return 1;
    var names = (o._.length ? o._ : Object.keys(P.services)).filter(function (n) { return P.services[n] && P.services[n].build; });
    for (var i = 0; i < names.length; i++) { if (!buildService(sess, P, P.services[names[i]], io, { noCache: o["no-cache"] })) return 1; }
    if (!names.length) out(io, "(no service has a build section)\n");
    return 0;
  };
  C.config = function (sess, P, a, io) {
    var o = Dk.parseArgs(a, { "services": false, "volumes": false, "q|quiet": false, "format": true, "images": false, "no-interpolate": false }, "compose config", io); if (!o) return 1;
    if (o.quiet) return 0;
    if (o.services) { out(io, Object.keys(P.services).map(function (n) { return n + "\n"; }).join("")); return 0; }
    if (o.volumes) { out(io, Object.keys(P.volumes || {}).map(function (n) { return n + "\n"; }).join("")); return 0; }
    if (o.images) { out(io, Object.keys(P.services).map(function (n) { return imageFor(P, P.services[n]) + "\n"; }).join("")); return 0; }
    var doc = { name: P.name, services: {} };
    Object.keys(P.services).sort().forEach(function (n) {
      var s = P.services[n], d = {};
      if (s.build) d.build = { context: s.build.context, dockerfile: s.build.dockerfile || "Dockerfile" };
      if (s.command) d.command = s.command;
      if (Object.keys(s.depends).length) { d.depends_on = {}; Object.keys(s.depends).forEach(function (k) { d.depends_on[k] = { condition: s.depends[k], required: true }; }); }
      if (Object.keys(s.env).length) { d.environment = {}; Object.keys(s.env).sort().forEach(function (k) { d.environment[k] = s.env[k]; }); }
      if (s.healthcheck) d.healthcheck = { test: s.healthcheck.Test, interval: s.healthcheck.Interval + "s", retries: s.healthcheck.Retries };
      if (s.image) d.image = s.image;
      d.networks = { "default": null };
      if (s.ports.length) d.ports = s.ports.map(function (p) { var q = p.split(":"); return { mode: "ingress", host_ip: q.length === 3 ? q[0] : undefined, target: +q[q.length - 1], published: q.length > 1 ? q[q.length - 2] : undefined, protocol: "tcp" }; }).map(function (x) { Object.keys(x).forEach(function (k) { if (x[k] === undefined) delete x[k]; }); return x; });
      if (s.restart !== "no") d.restart = s.restart;
      if (s.secrets.length) d.secrets = s.secrets.map(function (x) { return { source: x.source, target: x.target }; });
      if (s.user) d.user = s.user;
      if (s.volumes.length) d.volumes = s.volumes.map(function (v) { return v.type === "bind" ? { type: "bind", source: v.src, target: v.dst, read_only: v.ro || undefined } : v.type === "volume" ? { type: "volume", source: v.anon ? undefined : v.name, target: v.dst } : { type: "tmpfs", target: v.dst }; }).map(function (x) { Object.keys(x).forEach(function (k) { if (x[k] === undefined) delete x[k]; }); return x; });
      doc.services[n] = d;
    });
    doc.networks = { "default": { name: P.name + "_default" } };
    if (Object.keys(P.volumes || {}).length) { doc.volumes = {}; Object.keys(P.volumes).forEach(function (v) { doc.volumes[v] = { name: volName(P, v) }; }); }
    if (Object.keys(P.secrets || {}).length) { doc.secrets = {}; Object.keys(P.secrets).forEach(function (k) { doc.secrets[k] = P.secrets[k].file ? { name: P.name + "_" + k, file: Dk.absHost({ home: sess.home, cwd: P.dir }, P.secrets[k].file) } : { name: P.name + "_" + k, environment: P.secrets[k].environment }; }); }
    out(io, Y.dump(doc));
    return 0;
  };
  function simple(verb, fn, label) {
    return function (sess, P, a, io) {
      var names = a.filter(function (x) { return !/^-/.test(x); });
      var list = projCtrs(sess.sys, P).filter(function (c) { return !names.length || names.indexOf(c.compose.service) >= 0; });
      var rows = [];
      list.forEach(function (c) { fn(sess.sys, c); rows.push(["Container " + c.name, label, "ok", 0.3]); });
      progress(io, "Running", rows);
      return 0;
    };
  }
  C.stop = simple("stop", function (sys, c) { Dk.stopCtr(sys, c); }, "Stopped");
  C.start = simple("start", function (sys, c) { c.stoppedByUser = false; Dk.startCtr(sys, c, {}); }, "Started");
  C.restart = simple("restart", function (sys, c) { Dk.stopCtr(sys, c); c.stoppedByUser = false; Dk.tick(sys, 1); Dk.startCtr(sys, c, {}); }, "Started");
  C.kill = simple("kill", function (sys, c) { Dk.stopCtr(sys, c, "KILL"); }, "Killed");
  C.rm = function (sess, P, a, io) {
    var list = projCtrs(sess.sys, P).filter(function (c) { return c.state !== "running"; });
    if (!list.length) { out(io, "No stopped containers\n"); return 0; }
    if (a.indexOf("-f") < 0 && a.indexOf("--force") < 0) { out(io, "Going to remove " + list.map(function (c) { return c.name; }).join(", ") + "\n? Are you sure? (y/N) "); note(io, "(No answer, so nothing was removed. Add -f.)"); return 1; }
    list.forEach(function (c) { Dk.removeCtr(sess.sys, c, a.indexOf("-v") >= 0); });
    progress(io, "Removing", list.map(function (c) { return ["Container " + c.name, "Removed", "ok", 0.1]; }));
    return 0;
  };
  C.pull = function (sess, P, a, io) {
    var rows = [];
    Object.keys(P.services).forEach(function (n) { var s = P.services[n]; if (!s.image) { rows.push([n, "Skipped - No image to be pulled", "ok", 0.0]); return; } var img = Dk.pull(sess, s.image, Dk.capture().io, { quiet: true }); rows.push([n, img ? "Pulled" : "Error", img ? "ok" : "err", 2.1]); });
    progress(io, "Pulling", rows); return 0;
  };
  C.images = function (sess, P, a, io) {
    var rows = projCtrs(sess.sys, P).map(function (c) { var img = Dk.imageById(sess.sys, c.image), t = (img.tags[0] || "<none>:<none>"); return [c.name, t.slice(0, t.lastIndexOf(":")), t.slice(t.lastIndexOf(":") + 1), img.id.slice(7, 19), Dk.human(img.size)]; });
    out(io, Dk.table([["CONTAINER", "REPOSITORY", "TAG", "IMAGE ID", "SIZE"]].concat(rows))); return 0;
  };
  C.port = function (sess, P, a, io) { var c = projCtrs(sess.sys, P, a[0])[0]; if (!c) { errl(io, "no container found for " + a[0] + "_1"); return 1; } var p = c.ports.filter(function (x) { return String(x.ctrPort) === String(a[1]); })[0]; if (!p) { errl(io, "no port " + a[1] + "/tcp for container " + c.name); return 1; } out(io, p.hostIp + ":" + p.hostPort + "\n"); return 0; };
  C.top = function (sess, P, a, io) { projCtrs(sess.sys, P).filter(function (c) { return c.state === "running"; }).forEach(function (c) { out(io, c.name + "\n"); Dk.SUB.top([c.name], io, sess); }); return 0; };

  Dk.SUB.compose = function (a, io, sess) {
    var g = Dk.parseArgs(a, { "f|file": "list", "p|project-name": true, "project-directory": true, "env-file": true, "profile": "list", "progress": true, "ansi": true, "version|v": false, "help": false }, "compose", io, true);
    if (!g) return 1;
    var sub = g._.shift();
    if (g.version || sub === "version") { out(io, "Docker Compose version v2.29.7\n"); return 0; }
    if (!sub || g.help || sub === "--help") { out(io, "\nUsage:  docker compose [OPTIONS] COMMAND\n\nDefine and run multi-container applications with Docker\n\nCommands:\n  build       Build or rebuild services\n  config      Parse, resolve and render compose file in canonical format\n  down        Stop and remove containers, networks\n  exec        Execute a command in a running container\n  images      List images used by the created containers\n  kill        Force stop service containers\n  logs        View output from containers\n  ls          List running compose projects\n  port        Print the public port for a port binding\n  ps          List containers\n  pull        Pull service images\n  restart     Restart service containers\n  rm          Removes stopped service containers\n  run         Run a one-off command on a service\n  start       Start services\n  stop        Stop services\n  top         Display the running processes\n  up          Create and start containers\n  version     Show the Docker Compose version information\n"); return 0; }
    if (sub === "ls") {
      var projs = {};
      Dk.state(sess.sys).ctrs.forEach(function (c) { if (!c.compose) return; var p = projs[c.compose.project] = projs[c.compose.project] || { run: 0, all: 0, dir: c.labels["com.docker.compose.project.working_dir"] }; p.all++; if (c.state === "running") p.run++; });
      out(io, Dk.table([["NAME", "STATUS", "CONFIG FILES"]].concat(Object.keys(projs).sort().map(function (n) { var p = projs[n]; return [n, (p.run ? "running(" + p.run + ")" : "exited(" + p.all + ")"), p.dir + "/compose.yaml"]; })))); return 0;
    }
    if (!C[sub]) { errl(io, "unknown docker command: \"compose " + sub + "\""); return 1; }
    var P = load(sess, { files: g.file, project: g["project-name"] }, io);
    if (!P) return 1;
    var code = C[sub](sess, P, g._, io);
    Dk.ev(sess.sys, { kind: "compose", project: P.name, sub: sub });
    return code;
  };
  // the old standalone binary
  S.CMDS["docker-compose"] = function (args, io, sess) { errl(io, "Command 'docker-compose' not found, but there is the Compose plugin: use `docker compose` (with a space)."); return 127; };
  Dk.composeLoad = load;
})(typeof window !== "undefined" ? window : globalThis);
