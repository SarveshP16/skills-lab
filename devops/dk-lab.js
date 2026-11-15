/* sudo learn — DevOps track lab runner. The labs run on the Git track's laptop (kc-dev-01) with Docker
   Engine 27 installed: dockerd as a systemd service, dev in the docker group, Trivy, and a token for
   Kestrel's private registry in ~/.kestrel. Lab `system` functions add files, pre-pulled images, registry
   content or already-running containers through the helpers in DevLab.setup. Checks get DevLab.H. */
(function (root) {
  "use strict";
  var S = root.ShEngine, M2 = S.M2, Dk = root.Dk, GL = root.GitLab, SL = root.ShLab;
  var HOME = "/home/dev";

  function dockerBase(sys) {
    S.put(sys, "/usr/bin/docker", "\x7fELF:docker (simulated binary)\n", 493);
    S.put(sys, "/usr/bin/dockerd", "\x7fELF:dockerd (simulated binary)\n", 493);
    S.put(sys, "/usr/bin/containerd", "\x7fELF:containerd (simulated binary)\n", 493);
    S.put(sys, "/usr/local/bin/trivy", "\x7fELF:trivy (simulated binary)\n", 493);
    S.put(sys, "/usr/lib/systemd/system/docker.service", "[Unit]\nDescription=Docker Application Container Engine\nDocumentation=https://docs.docker.com\nAfter=network-online.target containerd.service\nWants=network-online.target containerd.service\nRequires=docker.socket\n\n[Service]\nType=notify\nExecStart=/usr/bin/dockerd -H fd:// --containerd=/run/containerd/containerd.sock\nExecReload=/bin/kill -s HUP $MAINPID\nRestart=always\n\n[Install]\nWantedBy=multi-user.target\n", 420);
    S.put(sys, "/usr/lib/systemd/system/containerd.service", "[Unit]\nDescription=containerd container runtime\nAfter=network.target\n\n[Service]\nExecStart=/usr/bin/containerd\nRestart=always\n\n[Install]\nWantedBy=multi-user.target\n", 420);
    S.put(sys, "/etc/docker/daemon.json", "{\n  \"log-driver\": \"json-file\",\n  \"log-opts\": { \"max-size\": \"10m\", \"max-file\": \"3\" }\n}\n", 420);
    var dl = S.mkdirs(sys, "/var/lib/docker", 456, 0, 0); dl.mode = 456;
    S.mkdirs(sys, "/var/lib/docker/volumes", 456, 0, 0).mode = 456;
    // the docker group, with dev in it (it's as powerful as root: Module 1 lab 9 shows why)
    var grp = M2.rd(sys, "/etc/group") || "";
    if (!/^docker:/m.test(grp)) S.put(sys, "/etc/group", grp.replace(/\n?$/, "\n") + "docker:x:988:dev\n", 420);
    var wants = S.mkdirs(sys, "/etc/systemd/system/multi-user.target.wants");
    wants.children["docker.service"] = S.linkNode("/usr/lib/systemd/system/docker.service");
    wants.children["containerd.service"] = S.linkNode("/usr/lib/systemd/system/containerd.service");
    // the laptop doesn't run kc-web-01's web stack
    ["nginx.service", "kestrel-app.service"].forEach(function (n) { var u = sys.units && M2.loadUnit(sys, n); if (u) { try { M2.stopUnit(sys, u, true); } catch (e) { /* not running */ } } if (wants.children[n]) delete wants.children[n]; });
    ["containerd.service", "docker.service"].forEach(function (n) { var u = M2.loadUnit(sys, n); if (u) M2.startUnit(sys, u); });
    S.mkdirs(sys, HOME + "/.kestrel", 448, 1000, 1000);
    S.put(sys, HOME + "/.kestrel/registry-token", Dk.registryToken() + "\n", 384, 1000, 1000);
    Dk.state(sys);
  }
  function compose(labSystem) {
    return GL.compose(function (sys) { dockerBase(sys); if (labSystem) labSystem(sys); });
  }
  function wrap(msg) { return Object.assign({}, msg, { system: compose(msg.system) }); }
  function handle(msg) {
    if (msg.type === "complete") { var c = complete(wrap(msg)); if (c) return c; return SL.handle(wrap(msg)); }
    return SL.handle(wrap(msg));
  }

  /* ---------------- Tab completion for docker */
  var SUBS = ["build", "compose", "container", "cp", "create", "exec", "history", "image", "images", "info", "inspect", "kill", "login", "logout", "logs", "network", "port", "ps", "pull", "push", "restart", "rm", "rmi", "run", "start", "stats", "stop", "system", "tag", "top", "version", "volume"];
  var CSUBS = ["build", "config", "down", "exec", "logs", "ps", "pull", "restart", "run", "start", "stop", "up"];
  function common(list, word) {
    var c = list.filter(function (x) { return x.indexOf(word) === 0; });
    if (!c.length) return null;
    var pre = c.reduce(function (a, b) { var k = 0; while (k < a.length && a.charAt(k) === b.charAt(k)) k++; return a.slice(0, k); });
    return { cands: c, pre: pre };
  }
  function finish(prefix, r) { return { line: prefix + (r.cands.length === 1 ? r.cands[0] + " " : r.pre), options: r.cands.length > 1 ? r.cands : [] }; }
  function complete(msg) {
    var line = msg.line || "", m;
    if ((m = /^(\s*docker\s+)([\w-]*)$/.exec(line))) { var r = common(SUBS, m[2]); return r ? finish(m[1], r) : { line: line, options: [] }; }
    if ((m = /^(\s*docker\s+compose\s+)([\w-]*)$/.exec(line))) { var r2 = common(CSUBS, m[2]); return r2 ? finish(m[1], r2) : { line: line, options: [] }; }
    if ((m = /^(\s*docker\s+(?:exec|logs|stop|start|restart|rm|kill|inspect|port|top|cp|container\s+\w+)(?:\s+-\S+)*\s+)([\w.-]*)$/.exec(line))) {
      var run = SL.replay(msg.code, { files: msg.files || {}, prelude: msg.prelude || "", system: msg.system });
      var d = run.sess.sys.dk; if (!d) return null;
      var r3 = common(d.ctrs.map(function (c) { return c.name; }), m[2]); return r3 ? finish(m[1], r3) : null;
    }
    if ((m = /^(\s*(?:docker\s+(?:run|rmi|history|tag|push|image\s+\w+)(?:\s+-\S+(?:\s+\S+)?)*|trivy\s+image(?:\s+-\S+(?:\s+\S+)?)*)\s+)([\w.:\/-]*)$/.exec(line))) {
      var run2 = SL.replay(msg.code, { files: msg.files || {}, prelude: msg.prelude || "", system: msg.system });
      var d2 = run2.sess.sys.dk; if (!d2) return null;
      var tags = []; d2.images.forEach(function (i) { tags = tags.concat(i.tags); });
      var r4 = common(tags, m[2]); return r4 ? finish(m[1], r4) : null;
    }
    return null;
  }

  /* ---------------- explanations under docker errors (checked before the Linux ones) */
  [
    [/port is already allocated|address already in use/, "Something already uses that port on the laptop. docker ps shows which container has it (PORTS column): stop it, or publish on another host port, e.g. -p 8081:80."],
    [/Conflict\. The container name/, "Container names must be unique, even for stopped containers. Remove the old one (docker rm NAME; docker rm -f NAME also stops it) or choose another --name."],
    [/No such container/, "No container has that name or ID. docker ps -a lists all of them, stopped ones included."],
    [/No such image|An image does not exist locally/, "There's no image with that name and tag on this laptop. docker images lists them; check the tag (name:tag) and the spelling."],
    [/manifest unknown|pull access denied|repository does not exist/, "The registry has no image with that name and tag. Check the spelling and the tag. A private registry also needs docker login first."],
    [/unauthorized: (authentication required|incorrect username)/, "That registry wants you to log in: docker login REGISTRY -u USER --password-stdin < TOKENFILE"],
    [/denied: requested access to the resource is denied/, "You're logged in, but not allowed to push there. Push to a repository in your own namespace (here: registry.kestrel.io/dev/...)."],
    [/failed to read dockerfile/, "docker build looks for a file called Dockerfile in the folder you give it (the . at the end). Is it there, spelled Dockerfile? Or point at it with -f."],
    [/failed to compute cache key.*not found/, "COPY couldn't find that file in the build context. Is it inside the folder you passed to docker build, and spelled the same? Check .dockerignore isn't excluding it."],
    [/did not complete successfully: exit code/, "A RUN step failed. The lines between the ------ markers are that command's own output: fix the command in the Dockerfile and build again (the steps before it come from the cache)."],
    [/unknown instruction/, "That isn't a Dockerfile instruction (FROM, RUN, COPY, CMD, ...). Check the spelling on the line it names."],
    [/executable file not found in \$PATH|no such file or directory: unknown/, "The command the container starts doesn't exist in the image. Check CMD/ENTRYPOINT or the command you passed: slim images leave out many tools."],
    [/is not running/, "That container has stopped. docker ps -a shows how it exited and docker logs NAME shows what it printed before it died."],
    [/permission denied while trying to connect to the Docker daemon/, "Your user isn't allowed to talk to Docker. Members of the docker group can, which makes that group as powerful as root."],
    [/Cannot connect to the Docker daemon/, "The Docker service isn't running: sudo systemctl start docker"],
    [/Could not install packages due to an OSError: \[Errno 13\]/, "The container runs as a non-root user, who can't write to the image's site-packages. Install packages in the Dockerfile (before USER), not in a running container."],
    [/ModuleNotFoundError/, "Python can't find that package in the image. Is it in requirements.txt, and does the Dockerfile pip install them before the app runs?"],
    [/Empty reply from server|Connection reset by peer|Recv failure/, "Docker took the connection, but nothing answered inside the container. Is the app listening on 0.0.0.0 (not 127.0.0.1), on the container port you published? docker logs shows where it's listening."],
    [/^yaml: line/, "compose.yaml isn't valid YAML at that line. Check the indentation (spaces, not tabs, two per level) and that each key ends with a colon."],
    [/additional properties .* not allowed/, "Compose doesn't know that key. Check the spelling (environment, depends_on, healthcheck...) and that it's indented under the right service."],
    [/has neither an image nor a build context/, "Every service needs image: (to pull) or build: (to build from a Dockerfile)."],
    [/dependency failed to start/, "Compose waited for a dependency that never became healthy. docker compose logs SERVICE shows why, and docker inspect NAME shows the healthcheck output."],
    [/refers to undefined (volume|secret)/, "Named volumes and secrets must also be declared at the top level of compose.yaml (volumes: / secrets:)."],
    [/no configuration file provided/, "There's no compose.yaml in this folder or above it. cd into the project folder first."],
    [/variable is not set/, "Compose found no value for that variable in your shell or the project's .env file, so it used an empty string."],
    [/Read-only file system/, "This container's file system is read-only (--read-only / read_only: true). Write to a volume or a tmpfs instead."]
  ].reverse().forEach(function (e) { SL.EXPLAIN.unshift(e); });

  /* ---------------- lab setup helpers (call these from a lab's system function) */
  var setup = {
    // put an image from the public registry on the laptop, as if pulled earlier
    pulled: function (sys, ref) { var p = Dk.parseRef(ref), hit = Dk.regLookup(sys, p); if (!hit) throw new Error("no image " + ref); var img = Dk.addImage(sys, hit.img, ref); img.digests[Dk.repoName(p)] = hit.digest; img.loadedAt = -3600; return img; },
    // an image made from a base plus extra layers: layers = [{by, files, size?}], cfg overrides
    image: function (sys, o) {
      var base = o.from ? Dk.imageFromBase(o.from) || Dk.regLookup(sys, Dk.parseRef(o.from)).img : null;
      var layers = (base ? base.layers.slice() : []).concat((o.layers || []).map(function (L, i) { return { id: Dk.sha("lab-layer:" + (o.key || o.tag) + i + JSON.stringify(Object.keys(L.files || {}))), by: L.by, size: L.size != null ? L.size : Dk.mapSize(L.files || {}), files: L.files || {}, created: o.created || -86400 * 3 }; }));
      var cfg = Object.assign(base ? JSON.parse(JSON.stringify(base.cfg)) : Dk.cfgOf({}), o.cfg || {});
      var hist = (base ? base.history.slice() : []).concat((o.layers || []).map(function (L) { return { by: L.by, size: L.size != null ? L.size : Dk.mapSize(L.files || {}), created: o.created || -86400 * 3, buildkit: true }; })).concat(o.hist || []);
      var img = Dk.makeImage({ id: Dk.sha("lab-image:" + (o.key || o.tag)), layers: layers, cfg: cfg, history: hist, created: o.created || -86400 * 3, os: base ? base.os : "", built: true });
      return img;
    },
    local: function (sys, img, tag) { var x = Dk.addImage(sys, img, tag); return x; },
    publish: function (sys, ref, img) { return Dk.publish(Dk.state(sys).regs, ref, img); },
    files: function (sys, base, files, mode) { Object.keys(files).forEach(function (k) { var p = base + "/" + k; var dir = p.slice(0, p.lastIndexOf("/")); var segs = dir.split("/").filter(Boolean), cur = ""; segs.forEach(function (s) { cur += "/" + s; if (!Dk.fsNode(sys, cur)) S.mkdirs(sys, cur, 509, 1000, 1000); }); var v = files[k]; var n = S.put(sys, p, typeof v === "object" ? v.content : v, typeof v === "object" && v.mode != null ? v.mode : mode || 436, 1000, 1000); if (typeof v === "object" && v.size != null) n.size = v.size; }); },
    // run a container during setup (no output); o like docker run options in object form
    run: function (sys, ref, o) {
      o = o || {};
      var img = Dk.findImage(sys, ref) || setup.pulled(sys, ref);
      var c = Dk.createCtr(sys, img, { name: o.name, imageRef: ref, cmd: o.cmd, env: o.env || {}, ports: (o.ports || []).map(function (p) { var q = String(p).split(":"); return { hostIp: "0.0.0.0", hostPort: +q[0], ctrPort: +q[1], proto: "tcp" }; }), mounts: o.mounts || [], restart: o.restart ? { name: o.restart, max: 0 } : undefined, user: o.user, network: o.network, aliases: o.aliases, labels: o.labels, healthcheck: o.healthcheck, readOnly: o.readOnly });
      if (o.created != null) c.created = o.created;
      if (o.state !== "created") Dk.startCtr(sys, c, {});
      if (o.started != null) c.started = o.started;
      if (o.exit != null) { c.stoppedByUser = true; Dk.exitCtr(sys, c, o.exit, false); c.finished = o.finished != null ? o.finished : c.finished; }
      return c;
    }
  };

  /* ---------------- check helpers */
  function dk(r) { return r.sys.dk || { ctrs: [], images: [], vols: {}, nets: {}, builds: [], events: [] }; }
  var H = {
    dk: dk,
    ctr: function (r, name) { return dk(r).ctrs.filter(function (c) { return c.name === name; })[0] || null; },
    ctrs: function (r, fn) { return dk(r).ctrs.filter(fn || function () { return true; }); },
    // every container ever created in this lab, removed ones included (newest last)
    ever: function (r, fn) { return (dk(r).ever || []).filter(fn || function () { return true; }); },
    everNamed: function (r, name) { var l = H.ever(r, function (c) { return c.name === name; }); return l[l.length - 1] || null; },
    running: function (r, name) { var c = H.ctr(r, name); return !!c && c.state === "running"; },
    image: function (r, ref) { return Dk.findImage(r.sys, ref); },
    imageOf: function (r, c) { return Dk.imageById(r.sys, c.image); },
    ran: function (r, re, fn) { return r.history.some(function (e) { return re.test(e.cmd) && (!fn || fn(e)); }); },
    idx: function (r, re, fn) { var k = -1; r.history.forEach(function (e, i) { if (re.test(e.cmd) && (!fn || fn(e))) k = i; }); return k; },
    out: function (e) { return e.out.join("\n"); },
    all: function (e) { return e.lines.map(function (l) { return l.text; }).join("\n"); },
    printed: function (r, re, filter) { return r.history.some(function (e) { if (filter && !filter(e)) return false; return re.test(e.lines.map(function (l) { return l.text; }).join("\n")); }); },
    // GET a URL from the laptop on the final machine: {status, body, err}
    http: function (r, url, o) {
      Dk.settle(r.sys);
      var u = M2.parseUrl(url);
      var res = M2.httpRequest(r.sys, { scheme: u.scheme, host: u.host, port: u.port, path: u.path, method: (o && o.method) || "GET", headers: { host: u.host, "user-agent": "curl/8.5.0", accept: "*/*" }, body: o && o.body });
      return res.err ? { err: res.err.msg, status: 0, body: "" } : { status: res.status, body: res.body || "", headers: res.headers };
    },
    json: function (r, url, o) { var x = H.http(r, url, o); try { x.data = JSON.parse(x.body); } catch (e) { x.data = null; } return x; },
    // run a command inside a running container on the final machine
    exec: function (r, name, argv, o) { var c = H.ctr(r, name); if (!c || c.state !== "running") return null; var res = Dk.runIn(r.sys, c, argv, o || {}); return { code: res.code, out: res.lines ? res.lines.filter(function (l) { return l.s === "out"; }).map(function (l) { return l.text; }).join("") : "", err: res.error || (res.lines || []).filter(function (l) { return l.s === "err"; }).map(function (l) { return l.text; }).join("") }; },
    fileIn: function (r, name, path) { var c = H.ctr(r, name); if (!c) return null; Dk.ctrFs(r.sys, c); Dk.syncIn(r.sys, c); var n = Dk.fsNode(c.fs, path); return n ? (n.type === "f" ? n.content : n) : null; },
    imgFile: function (img, path) { var m = Dk.merge(img.layers); return m[path] || null; },
    imgMap: function (img) { return Dk.merge(img.layers); },
    userOf: function (r, img) { return (img.cfg.User || "").split(":")[0]; },
    logs: function (c) { return c ? c.logs.map(function (l) { return l.text; }).join("\n") : ""; },
    builds: function (r) { return dk(r).builds || []; },
    lastBuild: function (r, tag) { var b = (dk(r).builds || []).filter(function (x) { return x.ok && (!tag || (x.tags || []).some(function (t) { return Dk.shortName(Dk.parseRef(t)) === Dk.shortName(Dk.parseRef(tag)); })); }); return b[b.length - 1] || null; },
    vol: function (r, name) { return dk(r).vols[name] || null; },
    volFile: function (r, name, rel) { var n = Dk.fsNode(r.sys, "/var/lib/docker/volumes/" + name + "/_data/" + rel); return n && n.type === "f" ? n.content : null; },
    trivyRuns: function (r) { return r.sys.trivyRuns || []; },
    composeProject: function (r, name) { return dk(r).ctrs.filter(function (c) { return c.compose && c.compose.project === name; }); },
    svc: function (r, project, svc) { return dk(r).ctrs.filter(function (c) { return c.compose && c.compose.project === project && c.compose.service === svc && !c.compose.oneoff; })[0] || null; },
    loadCompose: function (r, dir) { var sess = S.newSession(r.sys); sess.cwd = dir; var cap = Dk.capture(); return Dk.composeLoad(sess, {}, cap.io); },
    run: function (r, alt) { return GL.H.run(r, alt && alt.system ? Object.assign({}, alt, { system: function (sys) { dockerBase(sys); alt.system(sys); } }) : alt); },
    sizeMB: function (img) { return img ? img.size / 1e6 : 0; }
  };

  var runner = {
    ready: false,
    start: function (hooks) { this.ready = true; hooks.setStatus("ok", "kc-dev-01 · Ubuntu 24.04 · Docker 27.3 (simulated)"); hooks.enableRun(); },
    call: function (msg) { return new Promise(function (res) { setTimeout(function () { res(handle(msg)); }, 0); }); }
  };
  var api = { handle: handle, runner: runner, base: dockerBase, compose: compose, H: H, setup: setup, HOME: HOME };
  root.DevLab = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
