/* sudo learn — DevOps track: what a container's main process does. Dk.launch looks at the command the
   container starts (after the image's entrypoint) and the files inside it, and returns the running app:
   nginx serving files and proxying, the Kestrel Python services (a Flask dev server or gunicorn, which really
   check that their modules were pip-installed in the image and that the database is reachable), PostgreSQL
   (which only initialises an empty data directory, so its password is fixed by the first start), Redis, the
   Kestrel worker binary, sleep/tail placeholders, and one-shot commands run by the course's Bash. */
(function (root) {
  "use strict";
  var S = root.ShEngine, M2 = S.M2, Dk = root.Dk;
  var MB = Dk.MB;

  function clock(sys) { return Dk.clock(sys); }
  function dt(sys, t, fmt) {
    var d = new Date(Dk.stamp(sys, t)), p = function (n, w) { return ("000" + n).slice(-(w || 2)); };
    var MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    if (fmt === "nginx") return p(d.getUTCDate()) + "/" + MON[d.getUTCMonth()] + "/" + d.getUTCFullYear() + ":" + p(d.getUTCHours()) + ":" + p(d.getUTCMinutes()) + ":" + p(d.getUTCSeconds()) + " +0000";
    if (fmt === "ngerr") return d.getUTCFullYear() + "/" + p(d.getUTCMonth() + 1) + "/" + p(d.getUTCDate()) + " " + p(d.getUTCHours()) + ":" + p(d.getUTCMinutes()) + ":" + p(d.getUTCSeconds());
    if (fmt === "flask") return p(d.getUTCDate()) + "/" + MON[d.getUTCMonth()] + "/" + d.getUTCFullYear() + " " + p(d.getUTCHours()) + ":" + p(d.getUTCMinutes()) + ":" + p(d.getUTCSeconds());
    if (fmt === "gunicorn") return d.getUTCFullYear() + "-" + p(d.getUTCMonth() + 1) + "-" + p(d.getUTCDate()) + " " + p(d.getUTCHours()) + ":" + p(d.getUTCMinutes()) + ":" + p(d.getUTCSeconds()) + " +0000";
    if (fmt === "pg") return d.getUTCFullYear() + "-" + p(d.getUTCMonth() + 1) + "-" + p(d.getUTCDate()) + " " + p(d.getUTCHours()) + ":" + p(d.getUTCMinutes()) + ":" + p(d.getUTCSeconds()) + "." + p(d.getUTCMilliseconds(), 3) + " UTC";
    if (fmt === "redis") return p(d.getUTCDate()) + " " + MON[d.getUTCMonth()] + " " + d.getUTCFullYear() + " " + p(d.getUTCHours()) + ":" + p(d.getUTCMinutes()) + ":" + p(d.getUTCSeconds()) + ".101";
    return d.toISOString();
  }
  Dk.dt = dt;
  function rd(fs, p) { return M2.rd(fs, p); }
  function node(fs, p) { var r = S.lookup({ sys: fs, uid: 0, gid: 0, groups: [], cwd: "/", umask: 18, vars: {} }, p); return r.node || null; }
  Dk.fsNode = node;
  function envOf(sys, c) { var cs = Dk.ctrSession(sys, c, {}); return cs.sess ? S.exportedEnv(cs.sess) : {}; }
  Dk.envOf = envOf;
  function json(status, obj, extra) { return { status: status, headers: Object.assign({ "Content-Type": "application/json" }, extra || {}), body: JSON.stringify(obj) + "\n" }; }
  Dk.json = json;

  /* ================================================================== launch */
  Dk.launch = function (sys, c, argv, o) {
    var fs = Dk.ctrFs(sys, c);
    var cs = Dk.ctrSession(sys, c, {});
    if (cs.error) return { startError: cs.error, code: 126 };
    var sess = cs.sess;
    // tini / docker-init / entrypoint scripts that just exec "$@"
    var guard = 0;
    while (guard++ < 4) {
      if (/(^|\/)(tini|docker-init)$/.test(argv[0])) { argv = argv.slice(1); if (argv[0] === "--") argv = argv.slice(1); continue; }
      if (/(^|\/)docker-entrypoint\.sh$/.test(argv[0]) && argv.length > 1) {
        // official images: if the first argument is an option, it goes to the main program
        if (/^-/.test(argv[1])) { var img = Dk.imageById(sys, c.image); var main = ((img && img.cfg.Cmd) || [])[0] || "sh"; argv = [main].concat(argv.slice(1)); } else argv = argv.slice(1);
        continue;
      }
      break;
    }
    if (!argv.length) return { startError: "exec: \"\": executable file not found in $PATH", code: 127 };
    var found = S.BUILTINS[argv[0]] && !/\//.test(argv[0]) ? null : S.resolveCommand(sess, argv[0]);
    if (found && found.error) {
      if (/\//.test(argv[0])) return { startError: "exec: \"" + argv[0] + "\": stat " + argv[0] + ": no such file or directory", code: 127 };
      return { startError: "exec: \"" + argv[0] + "\": executable file not found in $PATH", code: 127 };
    }
    if (found && found.script) {
      var body = rd(fs, found.path) || "";
      if (/exec\s+"\$@"/.test(body) && argv.length > 1) return Dk.launch(sys, c, argv.slice(1), o);
      return oneShot(sys, c, argv);
    }
    var impl = found ? found.impl : argv[0];
    // shell form (CMD python app.py): /bin/sh -c runs the command as its child, and as PID 1 the shell
    // ignores SIGTERM, so docker stop has to wait and kill it
    if ((impl === "sh" || impl === "bash") && argv[1] === "-c" && argv[2] && !/[;&|<>`$(){}]/.test(argv[2].replace(/\$\{?\w+\}?/g, "")) && !/^\s*(echo|cat|ls|printf|env|id|whoami|uname|test|\[)\b/.test(argv[2])) {
      var env0 = S.exportedEnv(sess);
      var inner = argv[2].replace(/\$\{(\w+)\}|\$(\w+)/g, function (m0, a, b) { var v = env0[a || b]; return v == null ? "" : v; }).trim().replace(/^exec\s+/, function () { return "\u0000"; });
      var execd = inner.charAt(0) === "\u0000"; inner = inner.replace(/^\u0000/, "");
      var w = inner.match(/"[^"]*"|'[^']*'|\S+/g) || [];
      w = w.map(function (x) { return x.replace(/^"(.*)"$|^'(.*)'$/, "$1$2"); });
      if (w.length) {
        var sub = Dk.launch(sys, c, w, o);
        if (sub.kind === "service" || sub.kind === "idle") { if (!execd) { sub.viaShell = true; sub.ignoresTerm = true; sub.stopCode = 137; } }
        return sub;
      }
    }
    var A = APPS[impl];
    if (A) return A(sys, c, argv, sess, o || {});
    if (impl === "sleep") {
      var secs = /^inf/.test(argv[1] || "") ? Infinity : parseFloat(argv[1] || "0");
      if (secs >= 3) return { kind: "idle", listen: [], mem: 0.4 * MB, crashAt: isFinite(secs) ? clock(sys) + secs : null, crash: function () { return { code: 0 }; }, stopCode: 137, ignoresTerm: true };
    }
    if (impl === "tail" && argv.indexOf("-f") > 0) return { kind: "idle", listen: [], mem: 0.4 * MB, stopCode: 137, ignoresTerm: true };
    if ((impl === "sh" || impl === "bash") && argv.length === 1) return { kind: "shell", code: 0, listen: [], mem: 1 * MB, logs: [], stopCode: 0, done: true, finish: true, interactiveNote: null, crashAt: o && o.interactive ? null : clock(sys), crash: function () { return { code: 0 }; } };
    if ((impl === "sh" || impl === "bash") && argv[1] === "-c" && /while\s+(true|:)|sleep\s+(inf|\d{3,})/.test(argv[2] || "")) {
      var first = Dk.runIn(sys, c, ["/bin/sh", "-c", (argv[2] || "").replace(/while\s+(true|:);?\s*do([\s\S]*?)done/, "$2").replace(/sleep\s+\S+/g, "true")], { main: true });
      if (first.code) return { kind: "done", code: first.code, logs: first.lines.map(function (l) { return [l.s, l.text]; }) };
      return { kind: "idle", listen: [], mem: 1 * MB, logs: first.lines.map(function (l) { return [l.s, l.text]; }), stopCode: 137, ignoresTerm: true };
    }
    return oneShot(sys, c, argv);
  };
  function oneShot(sys, c, argv) {
    var r = Dk.runIn(sys, c, argv, { main: true });
    if (r.error) return { startError: r.error, code: r.notFound ? 127 : 126 };
    return { kind: "done", code: r.code, logs: r.lines.map(function (l) { return [l.s, l.text]; }) };
  }
  var APPS = {};
  Dk.APPS = APPS;

  /* ================================================================== hello-world */
  APPS.dkhello = function () {
    return { kind: "done", code: 0, logs: [["out", "\nHello from Docker!\nThis message shows that your installation appears to be working correctly.\n\nTo generate this message, Docker took the following steps:\n 1. The Docker client contacted the Docker daemon.\n 2. The Docker daemon pulled the \"hello-world\" image from the Docker Hub.\n 3. The Docker daemon created a new container from that image which runs the\n    executable that produced the output you are currently reading.\n 4. The Docker daemon streamed that output to the Docker client, which sent it\n    to your terminal.\n\nTo try something more ambitious, you can run an Ubuntu container with:\n $ docker run -it ubuntu bash\n"]] };
  };

  /* ================================================================== nginx */
  function ngxConf(fs) {
    var dir = node(fs, "/etc/nginx/conf.d"), text = "";
    if (dir && dir.children) Object.keys(dir.children).sort().forEach(function (k) { if (/\.conf$/.test(k) && dir.children[k].type === "f") text += "\n# file: " + k + "\n" + dir.children[k].content; });
    var servers = [], cur = null, loc = null, depth = 0, file = "", lineNo = 0;
    text.split("\n").forEach(function (raw) {
      var fm = /^# file: (.*)$/.exec(raw); if (fm) { file = fm[1]; lineNo = 0; return; }
      lineNo++;
      var l = raw.replace(/#.*$/, "").trim(); if (!l) return;
      if (/^server\s*\{/.test(l)) { cur = { listen: [], root: null, index: ["index.html"], locs: [], file: file }; servers.push(cur); depth = 1; return; }
      if (!cur) return;
      var m;
      if ((m = /^location\s+(=\s*)?(\S+)\s*\{/.exec(l))) { loc = { path: m[2], exact: !!m[1], root: null, proxy: null, tryFiles: null, ret: null, line: lineNo, file: file }; cur.locs.push(loc); depth = 2; return; }
      if (l === "}") { if (depth === 2) { loc = null; depth = 1; } else { cur = null; depth = 0; } return; }
      var tgt = loc || cur;
      if ((m = /^listen\s+(?:\[::\]:)?(\d+)/.exec(l)) && !loc) { if (!/\[::\]/.test(l)) cur.listen.push(+m[1]); return; }
      if ((m = /^root\s+([^;]+);/.exec(l))) { tgt.root = m[1].trim(); return; }
      if ((m = /^index\s+([^;]+);/.exec(l))) { tgt.index = m[1].trim().split(/\s+/); return; }
      if ((m = /^proxy_pass\s+(https?):\/\/([^:/;]+)(?::(\d+))?([^;]*);/.exec(l))) { tgt.proxy = { host: m[2], port: m[3] ? +m[3] : 80, uri: m[4] || "", line: lineNo, file: file }; return; }
      if ((m = /^try_files\s+([^;]+);/.exec(l))) { tgt.tryFiles = m[1].trim().split(/\s+/); return; }
      if ((m = /^return\s+(\d+)(?:\s+([^;]*))?;/.exec(l))) { tgt.ret = { code: +m[1], text: (m[2] || "").replace(/^"|"$/g, "") }; return; }
    });
    return servers;
  }
  Dk.ngxConf = ngxConf;
  APPS.dknginx = function (sys, c, argv, sess) {
    var fs = Dk.ctrFs(sys, c), servers = ngxConf(fs);
    var logs = [["out", "/docker-entrypoint.sh: No files found in /docker-entrypoint.d/, skipping configuration"]];
    if (argv.indexOf("-v") > 0 || argv.indexOf("-t") > 0) return { kind: "done", code: 0, logs: [["err", argv.indexOf("-v") > 0 ? "nginx version: nginx/1.27.2" : "nginx: the configuration file /etc/nginx/nginx.conf syntax is ok\nnginx: configuration file /etc/nginx/nginx.conf test is successful"]] };
    // proxy_pass hosts must resolve when nginx starts
    for (var i = 0; i < servers.length; i++) for (var k = 0; k < servers[i].locs.length; k++) {
      var px = servers[i].locs[k].proxy;
      if (px && !/^\d+\.\d+\.\d+\.\d+$/.test(px.host) && !Dk.resolveFrom(sys, c, px.host)) {
        logs.push(["err", dt(sys, null, "ngerr") + " [emerg] 1#1: host not found in upstream \"" + px.host + (px.port !== 80 ? ":" + px.port : "") + "\" in /etc/nginx/conf.d/" + px.file + ":" + px.line]);
        logs.push(["err", "nginx: [emerg] host not found in upstream \"" + px.host + (px.port !== 80 ? ":" + px.port : "") + "\" in /etc/nginx/conf.d/" + px.file + ":" + px.line]);
        return { kind: "done", code: 1, logs: logs };
      }
    }
    if (sess.uid !== 0) {
      var cache = node(fs, "/var/cache/nginx");
      if (cache && !S.can(sess, cache, "w")) { logs.push(["err", "nginx: [emerg] mkdir() \"/var/cache/nginx/client_temp\" failed (13: Permission denied)"]); return { kind: "done", code: 1, logs: logs }; }
    }
    logs.push(["err", dt(sys, null, "ngerr") + " [notice] 1#1: using the \"epoll\" event method"], ["err", dt(sys, null, "ngerr") + " [notice] 1#1: nginx/1.27.2"], ["err", dt(sys, null, "ngerr") + " [notice] 1#1: start worker processes"]);
    var ports = {};
    servers.forEach(function (s) { s.listen.forEach(function (p) { ports[p] = true; }); });
    if (!servers.length) ports[80] = true;
    return {
      kind: "service", mem: 9.6 * MB, pids: 5, stopCode: 0, logs: logs, listen: Object.keys(ports).map(function (p) { return { port: +p, addr: "0.0.0.0" }; }),
      http: function (sys2, c2, req, from) {
        var r = ngxServe(sys2, c2, Dk.ctrFs(sys2, c2), ngxConf(Dk.ctrFs(sys2, c2)), req, from);
        Dk.logLine(sys2, c2, "out", from + " - - [" + dt(sys2, null, "nginx") + "] \"" + req.method + " " + req.path + " HTTP/1.1\" " + r.status + " " + (r.body || "").length + " \"-\" \"" + (req.headers["user-agent"] || "-") + "\" \"-\"");
        if (r.errLog) Dk.logLine(sys2, c2, "err", dt(sys2, null, "ngerr") + " [error] 29#29: *1 " + r.errLog + ", client: " + from + ", server: localhost, request: \"" + req.method + " " + req.path + " HTTP/1.1\"");
        return r;
      }
    };
  };
  var PAGE502 = "<html>\r\n<head><title>502 Bad Gateway</title></head>\r\n<body>\r\n<center><h1>502 Bad Gateway</h1></center>\r\n<hr><center>nginx/1.27.2</center>\r\n</body>\r\n</html>\r\n";
  var PAGE404 = "<html>\r\n<head><title>404 Not Found</title></head>\r\n<body>\r\n<center><h1>404 Not Found</h1></center>\r\n<hr><center>nginx/1.27.2</center>\r\n</body>\r\n</html>\r\n";
  var PAGE403 = "<html>\r\n<head><title>403 Forbidden</title></head>\r\n<body>\r\n<center><h1>403 Forbidden</h1></center>\r\n<hr><center>nginx/1.27.2</center>\r\n</body>\r\n</html>\r\n";
  function ngxServe(sys, c, fs, servers, req, from) {
    var H = { Server: "nginx/1.27.2" };
    var srv = servers[0] || { root: "/usr/share/nginx/html", index: ["index.html"], locs: [{ path: "/", root: "/usr/share/nginx/html" }] };
    var path = req.path.split("?")[0], best = null;
    srv.locs.forEach(function (l) { if (l.exact ? path === l.path : path.indexOf(l.path) === 0) { if (!best || l.exact || l.path.length > best.path.length) best = l; } });
    if (best && best.ret) return { status: best.ret.code, headers: Object.assign({ "Content-Type": "text/plain" }, H), body: best.ret.text ? best.ret.text + "\n" : "" };
    if (best && best.proxy) {
      var px = best.proxy, cn = Dk.connect(sys, c, px.host, px.port);
      if (!cn.ok) return { status: 502, headers: Object.assign({ "Content-Type": "text/html" }, H), body: PAGE502, errLog: cn.why === "dns" ? "no resolver defined to resolve " + px.host : "connect() failed (111: Connection refused) while connecting to upstream, upstream: \"http://" + px.host + ":" + px.port + path + "\"" };
      var subPath = px.uri ? px.uri.replace(/\/$/, "") + "/" + path.slice(best.path.length) : req.path;
      var r = cn.app.http ? cn.app.http(sys, cn.ctr, Object.assign({}, req, { path: subPath.replace(/\/+/g, "/"), headers: Object.assign({}, req.headers, { "x-forwarded-for": from }) }), (c.nets[0] || {}).ip || from) : null;
      if (!r) return { status: 502, headers: Object.assign({ "Content-Type": "text/html" }, H), body: PAGE502, errLog: "upstream prematurely closed connection while reading response header from upstream" };
      return { status: r.status, headers: Object.assign({}, r.headers, H), body: r.body };
    }
    var rootDir = (best && best.root) || srv.root || "/usr/share/nginx/html", idx = (best && best.index) || srv.index || ["index.html"];
    var tries = (best && best.tryFiles) || ["$uri", "$uri/", "=404"];
    for (var i = 0; i < tries.length; i++) {
      var t = tries[i];
      if (/^=\d+$/.test(t)) break;
      var p = t.replace(/\$uri/g, path), n = node(fs, rootDir + p);
      if (n && n.type === "d") { for (var k = 0; k < idx.length; k++) { var nn = node(fs, rootDir + p.replace(/\/?$/, "/") + idx[k]); if (nn && nn.type === "f") return okFile(nn, idx[k]); } continue; }
      if (n && n.type === "f") {
        var who = { sys: fs, uid: 101, gid: 101, groups: [], cwd: "/", umask: 18, vars: {} };
        if (!S.can(who, n, "r")) return { status: 403, headers: Object.assign({ "Content-Type": "text/html" }, H), body: PAGE403, errLog: "open() \"" + rootDir + p + "\" failed (13: Permission denied)" };
        return okFile(n, p);
      }
    }
    return { status: 404, headers: Object.assign({ "Content-Type": "text/html" }, H), body: PAGE404, errLog: "open() \"" + rootDir + path + "\" failed (2: No such file or directory)" };
    function okFile(n, name) {
      var type = /\.css$/.test(name) ? "text/css" : /\.js$/.test(name) ? "application/javascript" : /\.json$/.test(name) ? "application/json" : /\.html?$/.test(name) ? "text/html" : "application/octet-stream";
      return { status: 200, headers: Object.assign({ "Content-Type": type, "Last-Modified": "Wed, 11 Nov 2026 08:00:00 GMT", ETag: "\"" + M2.hexOf(n.content, 8) + "\"" }, H), body: n.content };
    }
  }

  /* ================================================================== Python apps */
  var STDLIB = ["os", "sys", "json", "time", "logging", "pathlib", "urllib", "socket", "signal", "datetime", "threading", "uuid", "random", "re", "typing", "dataclasses", "functools", "itertools", "collections", "hashlib", "hmac", "secrets", "base64", "subprocess", "http", "math", "string", "argparse", "contextlib", "shutil", "tempfile", "traceback", "io", "queue", "decimal", "sqlite3"];
  // Where python looks for modules, for this interpreter path
  function sitePaths(fs, pyPath, env) {
    var dirs = [];
    var m = /^(.*)\/bin\/python[\d.]*$/.exec(pyPath);
    var prefix = m ? m[1] : "/usr/local";
    var venv = node(fs, prefix + "/pyvenv.cfg");
    var lib = node(fs, prefix + "/lib");
    var pyDir = lib && Object.keys(lib.children || {}).filter(function (k) { return /^python3/.test(k); })[0];
    if (pyDir) dirs.push(prefix + "/lib/" + pyDir + "/site-packages");
    if (venv) { var b = node(fs, "/usr/local/lib"); var g = b && Object.keys(b.children || {}).filter(function (k) { return /^python3/.test(k); })[0]; if (g) dirs.push("/usr/local/lib/" + g); }
    else if (pyDir) dirs.push(prefix + "/lib/" + pyDir);
    if (env.HOME && pyDir) dirs.push(env.HOME + "/.local/lib/" + pyDir + "/site-packages");
    (env.PYTHONPATH || "").split(":").filter(Boolean).forEach(function (p) { dirs.push(p); });
    return { dirs: dirs, version: pyDir ? pyDir.replace("python", "") : "3.12", venv: !!venv, prefix: prefix };
  }
  Dk.sitePaths = sitePaths;
  function hasModule(fs, dirs, mod, scriptDir) {
    if (STDLIB.indexOf(mod) >= 0) return true;
    var all = (scriptDir ? [scriptDir] : []).concat(dirs);
    return all.some(function (d) { var n = node(fs, d + "/" + mod); if (n && n.type === "d") return true; var f = node(fs, d + "/" + mod + ".py"); return !!f; });
  }
  function importsOf(src) {
    var mods = [];
    String(src).split("\n").forEach(function (l, i) {
      var m = /^\s*import\s+([\w.]+)/.exec(l) || /^\s*from\s+([\w.]+)\s+import\b/.exec(l);
      if (m && !/^\s*#/.test(l)) mods.push({ mod: m[1].split(".")[0], line: i + 1, text: l.trim() });
    });
    return mods;
  }
  function traceback(file, line, text, err) { return "Traceback (most recent call last):\n  File \"" + file + "\", line " + line + ", in <module>\n    " + text + "\n" + err; }
  Dk.traceback = traceback;
  function pyVersionOf(fs, pyPath) { var sp = sitePaths(fs, pyPath, {}); return sp.version === "3.9" ? "3.9.18" : "3.12.7"; }

  // Common start: find the script, check imports. Returns {fail} or {src, file}
  function pyPrepare(sys, c, sess, pyPath, script, extraMods) {
    var fs = Dk.ctrFs(sys, c), env = S.exportedEnv(sess);
    var abs = script.charAt(0) === "/" ? script : S.normAbs(sess.cwd + "/" + script);
    var f = node(fs, abs);
    if (!f || f.type !== "f") return { fail: { kind: "done", code: 2, logs: [["err", "python: can't open file '" + abs + "': [Errno 2] No such file or directory"]] } };
    var sp = sitePaths(fs, pyPath, env), dir = abs.slice(0, abs.lastIndexOf("/")) || "/";
    var mods = importsOf(f.content);
    (extraMods || []).forEach(function (m) { mods.unshift({ mod: m, line: 1, text: "import " + m }); });
    for (var i = 0; i < mods.length; i++) {
      if (!hasModule(fs, sp.dirs, mods[i].mod, dir)) return { fail: { kind: "done", code: 1, logs: [["err", traceback(abs, mods[i].line, mods[i].text, "ModuleNotFoundError: No module named '" + mods[i].mod + "'")]] } };
    }
    return { src: f.content, file: abs, dir: dir, env: env };
  }
  function pyRun(sys, c, sess, pyPath, args) {
    // python -m flask run / python -m gunicorn / python app.py / python -c
    if (args[0] === "-c") return { kind: "done", code: 0, logs: miniPrint(args[1] || "") };
    if (args[0] === "--version" || args[0] === "-V") return { kind: "done", code: 0, logs: [["out", "Python " + pyVersionOf(Dk.ctrFs(sys, c), pyPath)]] };
    if (args[0] === "-m" && args[1] === "flask") return flaskCli(sys, c, sess, pyPath, args.slice(2));
    if (args[0] === "-m" && args[1] === "gunicorn") return gunicorn(sys, c, sess, pyPath, args.slice(2));
    if (args[0] === "-m" && args[1] === "http.server") return { kind: "service", listen: [{ port: +(args[2] || 8000), addr: "0.0.0.0" }], mem: 14 * MB, logs: [["err", "Serving HTTP on 0.0.0.0 port " + (args[2] || 8000) + " (http://0.0.0.0:" + (args[2] || 8000) + "/) ..."]], http: function () { return { status: 200, headers: { "Content-Type": "text/html" }, body: "<!DOCTYPE HTML>\n<html><body><h1>Directory listing for /</h1></body></html>\n" }; } };
    var unbuf = false;
    while (/^-[uBO]$/.test(args[0] || "")) { if (args[0] === "-u") unbuf = true; args = args.slice(1); }
    if (!args.length) return { kind: "repl", code: 0, listen: [], logs: [], crashAt: clock(sys), crash: function () { return { code: 0 }; }, interactiveNote: "(Python's interactive prompt would open here. This lab doesn't run an interactive Python: the container exited.)" };
    var prep = pyPrepare(sys, c, sess, pyPath, args[0]);
    if (prep.fail) return prep.fail;
    var kind = appKind(prep.src);
    if (kind && KESTREL[kind]) return KESTREL[kind](sys, c, sess, prep, { server: "flask-dev", unbuffered: unbuf });
    return { kind: "done", code: 0, logs: miniPrint(prep.src) };
  }
  function appKind(src) { var m = /^#\s*Kestrel\s+([\w-]+)\s+(API|worker|service)\b/im.exec(src || ""); return m ? (m[1] + " " + m[2]).toLowerCase() : null; }
  Dk.appKind = appKind;
  function miniPrint(src) {
    var outL = [];
    String(src).split(/\n|;/).forEach(function (l) { var m = /^\s*print\(\s*(?:f?["'])(.*?)["']\s*\)\s*$/.exec(l); if (m) outL.push(["out", m[1]]); });
    return outL;
  }
  APPS.dkpython = function (sys, c, argv, sess) {
    var found = S.resolveCommand(sess, argv[0]);
    return pyRun(sys, c, sess, found.path || "/usr/local/bin/python", argv.slice(1));
  };
  function flaskCli(sys, c, sess, pyPath, args) {
    var host = "127.0.0.1", port = 5000, appArg = null;
    for (var i = 0; i < args.length; i++) { if (args[i] === "--host" || args[i] === "-h") host = args[++i]; else if (/^--host=/.test(args[i])) host = args[i].slice(7); else if (args[i] === "--port" || args[i] === "-p") port = +args[++i]; else if (/^--port=/.test(args[i])) port = +args[i].slice(7); else if (args[i] === "--app") appArg = args[++i]; }
    var file = (appArg || S.exportedEnv(sess).FLASK_APP || "app").split(":")[0].replace(/\.py$/, "") + ".py";
    var prep = pyPrepare(sys, c, sess, pyPath, file, ["flask"]);
    if (prep.fail) return prep.fail;
    var kind = appKind(prep.src);
    return KESTREL[kind] ? KESTREL[kind](sys, c, sess, prep, { server: "flask-dev", host: host, port: port }) : { kind: "done", code: 0, logs: [] };
  }
  function gunicorn(sys, c, sess, pyPath, args) {
    var bind = "127.0.0.1:8000", target = null, workers = 1;
    for (var i = 0; i < args.length; i++) { var a = args[i]; if (a === "-b" || a === "--bind") bind = args[++i]; else if (/^--bind=/.test(a)) bind = a.slice(7); else if (a === "-w" || a === "--workers") workers = +args[++i]; else if (/^-/.test(a)) { if (/^--(access-logfile|error-logfile|log-level|timeout|threads|worker-class|chdir)$/.test(a) || a === "-k" || a === "-t") i++; } else target = a; }
    var env = S.exportedEnv(sess);
    if (env.PORT && !args.some(function (a) { return /^(-b|--bind)/.test(a); })) bind = "0.0.0.0:" + env.PORT;
    if (!target) return { kind: "done", code: 2, logs: [["err", "usage: gunicorn [OPTIONS] [APP_MODULE]\ngunicorn: error: No application module specified."]] };
    var fs = Dk.ctrFs(sys, c), sp = sitePaths(fs, pyPath, env);
    if (!hasModule(fs, sp.dirs, "gunicorn")) return { kind: "done", code: 1, logs: [["err", traceback(pyPath, 5, "from gunicorn.app.wsgiapp import run", "ModuleNotFoundError: No module named 'gunicorn'")]] };
    var file = target.split(":")[0].replace(/\./g, "/") + ".py";
    var prep = pyPrepare(sys, c, sess, pyPath, file);
    var head = [["err", "[" + dt(sys, null, "gunicorn") + "] [1] [INFO] Starting gunicorn 23.0.0"], ["err", "[" + dt(sys, null, "gunicorn") + "] [1] [INFO] Listening at: http://" + bind + " (1)"], ["err", "[" + dt(sys, null, "gunicorn") + "] [1] [INFO] Using worker: sync"], ["err", "[" + dt(sys, null, "gunicorn") + "] [7] [INFO] Booting worker with pid: 7"]];
    if (prep.fail) { var f = prep.fail; f.logs = head.concat(f.logs).concat([["err", "[" + dt(sys, null, "gunicorn") + "] [7] [ERROR] Exception in worker process"], ["err", "[" + dt(sys, null, "gunicorn") + "] [1] [ERROR] Worker (pid:7) exited with code 3"], ["err", "[" + dt(sys, null, "gunicorn") + "] [1] [ERROR] Shutting down: Master"], ["err", "[" + dt(sys, null, "gunicorn") + "] [1] [ERROR] Reason: Worker failed to boot."]]); f.code = 3; return f; }
    var kind = appKind(prep.src);
    var hp = bind.replace(/^\[.*\]/, "0.0.0.0").split(":");
    var app = KESTREL[kind] ? KESTREL[kind](sys, c, sess, prep, { server: "gunicorn", host: hp[0], port: +hp[1], workers: workers }) : { kind: "service", listen: [{ port: +hp[1], addr: hp[0] }], mem: 40 * MB };
    if (app.kind === "service" || app.kind === "idle") app.logs = head.concat((app.logs || []).filter(function (l) { return !/^ \* |^WARNING: This is a development|^Press CTRL/.test(l[1]); }));
    else app.logs = head.concat(app.logs || []);
    return app;
  }
  APPS.dkgunicorn = function (sys, c, argv, sess) { var py = (S.resolveCommand(sess, argv[0]).path || "/usr/local/bin/gunicorn").replace(/gunicorn$/, "python"); return gunicorn(sys, c, sess, py, argv.slice(1)); };
  APPS.dkflask = function (sys, c, argv, sess) { var py = (S.resolveCommand(sess, argv[0]).path || "/usr/local/bin/flask").replace(/flask$/, "python"); var a = argv.slice(1); if (a[0] === "run") a = a.slice(1); return flaskCli(sys, c, sess, py, a); };

  /* ---------------- the Kestrel services */
  // A Flask app's own host/port from app.run(...) in the source
  function runArgs(src, env) {
    var m = /app\.run\((.*)\)\s*$/m.exec(src || ""); if (!m) return null;
    var h = /host\s*=\s*["']([^"']+)["']/.exec(m[1]), p = /port\s*=\s*(\d+)/.exec(m[1]), pe = /port\s*=\s*int\(os\.environ\.get\(["'](\w+)["']\s*,\s*["']?(\d+)["']?\)\)/.exec(m[1]);
    var port = pe ? +(env[pe[1]] || pe[2]) : p ? +p[1] : 5000;
    return { host: h ? h[1] : "127.0.0.1", port: port };
  }
  function versionOf(src, env) { var m = /^VERSION\s*=\s*["']([^"']+)["']/m.exec(src || ""); return env.APP_VERSION || (m ? m[1] : "1.0.0"); }
  // Wrap a request handler with the server's behaviour: bind address, request logging, timing.
  function webApp(sys, c, prep, o, name, handler, extra) {
    var env = prep.env, ra = runArgs(prep.src, env) || { host: "127.0.0.1", port: 5000 };
    var host = o.server === "gunicorn" || o.host ? (o.host || "127.0.0.1") : ra.host, port = o.server === "gunicorn" || o.port ? (o.port || 8000) : ra.port;
    if (o.server === "flask-dev" && o.host) { host = o.host; port = o.port || 5000; }
    var ip = (c.nets[0] || {}).ip || "172.17.0.2";
    var logs = o.server === "gunicorn" ? [] : [["err", " * Serving Flask app '" + prep.file.split("/").pop().replace(/\.py$/, "") + "'"], ["err", " * Debug mode: off"], ["err", "WARNING: This is a development server. Do not use it in a production deployment. Use a production WSGI server instead."]].concat(host === "0.0.0.0" ? [["err", " * Running on all addresses (0.0.0.0)"], ["err", " * Running on http://127.0.0.1:" + port], ["err", " * Running on http://" + ip + ":" + port]] : [["err", " * Running on http://" + host + ":" + port]]).concat([["err", "Press CTRL+C to quit"]]);
    var app = Object.assign({
      kind: "service", name: name, mem: 46 * MB, pids: o.server === "gunicorn" ? 1 + (o.workers || 1) : 1, cpu: 0.05, stopCode: 0,
      listen: [{ port: port, addr: host }], logs: (extra && extra.logs ? extra.logs : []).concat(logs), server: o.server,
      http: function (sys2, c2, req, from) {
        var r;
        try { r = handler(sys2, c2, req, from); }
        catch (e) { if (e && e.pyError) { Dk.logLine(sys2, c2, "err", "[" + dt(sys2, null, "gunicorn") + "] ERROR in app: Exception on " + req.path + " [" + req.method + "]\n" + e.pyError); r = { status: 500, headers: { "Content-Type": "text/html; charset=utf-8" }, body: "<!doctype html>\n<html lang=en>\n<title>500 Internal Server Error</title>\n<h1>Internal Server Error</h1>\n<p>The server encountered an internal error and was unable to complete your request. Either the server is overloaded or there is an error in the application.</p>\n" }; } else throw e; }
        r.headers = Object.assign({ Server: o.server === "gunicorn" ? "gunicorn" : "Werkzeug/3.1.3 Python/3.12.7" }, r.headers || {});
        if (o.server !== "gunicorn") Dk.logLine(sys2, c2, "err", from + " - - [" + dt(sys2, null, "flask") + "] \"" + req.method + " " + req.path + " HTTP/1.1\" " + r.status + " -");
        return r;
      }
    }, extra || {});
    app.logs = (extra && extra.logs ? extra.logs : []).concat(logs);
    return app;
  }
  function notFound() { return { status: 404, headers: { "Content-Type": "text/html; charset=utf-8" }, body: "<!doctype html>\n<html lang=en>\n<title>404 Not Found</title>\n<h1>Not Found</h1>\n<p>The requested URL was not found on the server. If you entered the URL manually please check your spelling and try again.</p>\n" }; }
  function bodyText(req) { var b = req.body || ""; try { var j = JSON.parse(b); return j && typeof j === "object" ? j : { text: b }; } catch (e) { return { text: b.replace(/^text=/, "") }; } }
  function pyErr(msg) { var e = new Error(msg); e.pyError = msg; return e; }
  var KESTREL = {};
  Dk.KESTREL = KESTREL;

  // notes API: a tiny note store in NOTES_DIR (default /data). Lab DEV-104..106.
  KESTREL["notes api"] = function (sys, c, sess, prep, o) {
    var env = prep.env, dir = env.NOTES_DIR || "/data", ver = versionOf(prep.src, env);
    function list(fs) { var n = node(fs, dir); if (!n || n.type !== "d") return []; return Object.keys(n.children).filter(function (k) { return /^\d+\.txt$/.test(k); }).sort(function (a, b) { return parseInt(a, 10) - parseInt(b, 10); }).map(function (k) { return { id: parseInt(k, 10), text: n.children[k].content.replace(/\n$/, "") }; }); }
    return webApp(sys, c, prep, o, "notes", function (sys2, c2, req) {
      var p = req.path.split("?")[0], fs = Dk.ctrFs(sys2, c2);
      Dk.syncIn(sys2, c2);
      if (p === "/" && req.method === "GET") return json(200, { service: "notes", version: ver, host: c2.hostname });
      if (p === "/health") return json(200, { status: "ok" });
      if (p === "/notes" && req.method === "GET") return json(200, list(fs));
      if (p === "/notes" && req.method === "POST") {
        var b = bodyText(req), items = list(fs), id = items.length ? items[items.length - 1].id + 1 : 1;
        var cs = Dk.ctrSession(sys2, c2, {});
        if (!node(fs, dir)) { var mk = S.lookup(cs.sess, dir.slice(0, dir.lastIndexOf("/")) || "/"); if (!mk.node || !S.can(cs.sess, mk.node, "w") || c2.readOnly && !Dk.isMounted(c2, dir)) throw pyErr(traceback(prep.file, 31, "os.makedirs(NOTES_DIR, exist_ok=True)", (c2.readOnly ? "OSError: [Errno 30] Read-only file system: '" : "PermissionError: [Errno 13] Permission denied: '") + dir + "'")); S.mkdirs(fs, dir, 493, cs.sess.uid, cs.sess.gid); }
        if (c2.readOnly && !Dk.isMounted(c2, dir)) throw pyErr(traceback(prep.file, 33, "with open(path, \"w\") as f:", "OSError: [Errno 30] Read-only file system: '" + dir + "/" + id + ".txt'"));
        var err = S.writeFile(cs.sess, dir + "/" + id + ".txt", String(b.text || "") + "\n", false);
        if (err) throw pyErr(traceback(prep.file, 33, "with open(path, \"w\") as f:", "PermissionError: [Errno 13] Permission denied: '" + dir + "/" + id + ".txt'"));
        Dk.syncOut(sys2, c2);
        return json(201, { id: id, text: b.text || "" });
      }
      return notFound();
    }, {});
  };

  // payments API: needs PAYMENTS_API_KEY (or a file named by PAYMENTS_API_KEY_FILE). Lab DEV-107.
  KESTREL["payments api"] = function (sys, c, sess, prep, o) {
    var env = prep.env, key = env.PAYMENTS_API_KEY, from = "env";
    if (env.PAYMENTS_API_KEY_FILE) { var kf = node(Dk.ctrFs(sys, c), env.PAYMENTS_API_KEY_FILE); if (!kf) return { kind: "done", code: 1, logs: [["err", traceback(prep.file, 14, "with open(os.environ[\"PAYMENTS_API_KEY_FILE\"]) as f:", "FileNotFoundError: [Errno 2] No such file or directory: '" + env.PAYMENTS_API_KEY_FILE + "'")]] }; key = kf.content.trim(); from = "file"; }
    if (!key) return { kind: "done", code: 1, logs: [["err", traceback(prep.file, 16, "raise RuntimeError(\"PAYMENTS_API_KEY is not set\")", "RuntimeError: PAYMENTS_API_KEY is not set")]] };
    var valid = (sys.dk.validKeys || []).indexOf(key) >= 0, revoked = (sys.dk.revokedKeys || []).indexOf(key) >= 0;
    var lvl = (env.LOG_LEVEL || "info").toUpperCase();
    var startLogs = [["err", "[" + lvl + "] payments: starting, key from " + from + ", provider " + (env.PAYMENTS_URL || "https://pay.kestrel.example")]];
    if (lvl === "DEBUG") startLogs.push(["err", "[DEBUG] config: LOG_LEVEL=debug PAYMENTS_URL=" + (env.PAYMENTS_URL || "https://pay.kestrel.example")]);
    return webApp(sys, c, prep, o, "payments", function (sys2, c2, req) {
      var p = req.path.split("?")[0];
      if (p === "/health") return valid ? json(200, { status: "ok", payments: "connected" }) : json(503, { status: "degraded", payments: revoked ? "API key revoked" : "invalid API key" });
      if (p === "/config") return json(200, { log_level: (env.LOG_LEVEL || "info"), payments_url: env.PAYMENTS_URL || "https://pay.kestrel.example", api_key: key.slice(0, 8) + "****", key_source: from });
      if (p === "/") return json(200, { service: "payments", version: versionOf(prep.src, env) });
      return notFound();
    }, { logs: startLogs, keySource: from });
  };

  // Database settings from DATABASE_URL or DB_* variables (+ DB_PASSWORD_FILE)
  function dbSettings(fs, env) {
    var s = { user: env.DB_USER || "postgres", password: env.DB_PASSWORD || "", host: env.DB_HOST || "localhost", port: +(env.DB_PORT || 5432), name: env.DB_NAME || "postgres" };
    if (env.DATABASE_URL) {
      var m = /^postgres(?:ql)?:\/\/(?:([^:@/]+)(?::([^@/]*))?@)?([^:/?]+)(?::(\d+))?(?:\/([\w-]+))?/.exec(env.DATABASE_URL);
      if (!m) return { error: "psycopg.ProgrammingError: invalid connection option" };
      s = { user: m[1] || "postgres", password: m[2] ? decodeURIComponent(m[2]) : "", host: m[3], port: m[4] ? +m[4] : 5432, name: m[5] || m[1] || "postgres" };
    }
    if (env.DB_PASSWORD_FILE) { var n = node(fs, env.DB_PASSWORD_FILE); if (!n) return { error: "FileNotFoundError: [Errno 2] No such file or directory: '" + env.DB_PASSWORD_FILE + "'" }; s.password = n.content.replace(/\n$/, ""); }
    return s;
  }
  function redisSettings(env) {
    if (!env.REDIS_URL) return null;
    var m = /^redis:\/\/(?::([^@]*)@)?([^:/]+)(?::(\d+))?/.exec(env.REDIS_URL);
    return m ? { password: m[1] ? decodeURIComponent(m[1]) : null, host: m[2], port: m[3] ? +m[3] : 6379 } : null;
  }
  // Talk to PostgreSQL from container c. Returns {db, pg} or {error}
  function pgConnect(sys, c, s) {
    if (s.error) return { error: s.error };
    var cn = Dk.connect(sys, c, s.host, s.port);
    var ip = cn.ctr ? (cn.ctr.nets[0] || {}).ip : null;
    if (cn.why === "dns") return { error: "psycopg.OperationalError: failed to resolve host '" + s.host + "': [Errno -2] Name or service not known" };
    if (cn.why === "timeout") return { error: "psycopg.OperationalError: connection timeout expired" };
    if (!cn.ok) return { error: "psycopg.OperationalError: connection failed: connection to server at \"" + (s.host === "localhost" ? "127.0.0.1" : ip || s.host) + "\", port " + s.port + " failed: Connection refused\n\tIs the server running on that host and accepting TCP/IP connections?" };
    if (!cn.app.pg) return { error: "psycopg.OperationalError: connection failed: connection to server at \"" + ip + "\", port " + s.port + " failed: received invalid response to SSL negotiation" };
    var auth = cn.app.pg.auth(sys, cn.ctr, s.user, s.password, s.name);
    if (auth) return { error: "psycopg.OperationalError: connection failed: connection to server at \"" + ip + "\", port " + s.port + " failed: FATAL:  " + auth };
    return { pg: cn.app.pg, ctr: cn.ctr, db: s.name };
  }
  function redisConnect(sys, c, r) {
    if (!r) return { error: "REDIS_URL is not set" };
    var cn = Dk.connect(sys, c, r.host, r.port);
    if (cn.why === "dns") return { error: "Error -2 connecting to " + r.host + ":" + r.port + ". Name or service not known." };
    if (cn.why === "timeout") return { error: "Timeout connecting to server" };
    if (!cn.ok) return { error: "Error 111 connecting to " + r.host + ":" + r.port + ". Connection refused." };
    if (!cn.app.redis) return { error: "Protocol error, got \"H\" as reply type byte" };
    if (cn.app.redis.pass && cn.app.redis.pass !== r.password) return { error: r.password ? "invalid username-password pair or user is disabled." : "Authentication required." };
    return { redis: cn.app.redis, ctr: cn.ctr };
  }
  Dk.pgConnect = pgConnect; Dk.redisConnect = redisConnect;

  // shop API (DEV-108): products in PostgreSQL, a visit counter in Redis
  var PRODUCTS = [{ id: 1, name: "Kestrel mug", price: 12.5 }, { id: 2, name: "Falcon hoodie", price: 39 }, { id: 3, name: "Sticker pack", price: 4 }];
  KESTREL["shop api"] = function (sys, c, sess, prep, o) {
    var fs = Dk.ctrFs(sys, c), env = prep.env, s = dbSettings(fs, env), rs = redisSettings(env);
    var pc = pgConnect(sys, c, s);
    if (pc.error) return { kind: "done", code: 1, logs: [["err", traceback(prep.file, 22, "db = psycopg.connect(DATABASE_URL)", pc.error)]] };
    pc.pg.ensureTable(sys, pc.ctr, s.name, "products", PRODUCTS);
    return webApp(sys, c, prep, o, "shop", function (sys2, c2, req) {
      var p = req.path.split("?")[0], db = pgConnect(sys2, c2, s), rc = redisConnect(sys2, c2, rs);
      if (p === "/health") {
        var body = { status: db.error || rc.error ? "degraded" : "ok", db: db.error ? db.error.replace(/^psycopg\.OperationalError: /, "").split("\n")[0] : "ok", cache: rc.error ? rc.error : "ok" };
        return json(db.error || rc.error ? 503 : 200, body);
      }
      if (db.error) throw pyErr(traceback(prep.file, 40, "rows = db.execute(\"SELECT * FROM products\").fetchall()", db.error));
      if (p === "/products") return json(200, db.pg.rows(sys2, db.ctr, s.name, "products"));
      if (p === "/visits") { if (rc.error) throw pyErr(traceback(prep.file, 48, "n = cache.incr(\"visits\")", "redis.exceptions.ConnectionError: " + rc.error)); return json(200, { visits: rc.redis.cmd(["INCR", "visits"]) }); }
      if (p === "/") return json(200, { service: "shop", version: versionOf(prep.src, env) });
      return notFound();
    }, {});
  };

  // orders API + worker (capstone): orders in PostgreSQL, a queue in Redis, the worker marks them processed
  KESTREL["orders api"] = function (sys, c, sess, prep, o) {
    var fs = Dk.ctrFs(sys, c), env = prep.env, s = dbSettings(fs, env), rs = redisSettings(env);
    var pc = pgConnect(sys, c, s);
    if (pc.error) return { kind: "done", code: 1, logs: [["err", traceback(prep.file, 25, "db = connect_db()", pc.error)]] };
    pc.pg.ensureTable(sys, pc.ctr, s.name, "orders", []);
    var startLogs = [["err", "INFO orders-api: connected to database " + s.name + " on " + s.host]];
    return webApp(sys, c, prep, o, "orders", function (sys2, c2, req) {
      var p = req.path.split("?")[0], db = pgConnect(sys2, c2, s), rc = redisConnect(sys2, c2, rs), m;
      if (p === "/health") return json(db.error || rc.error ? 503 : 200, { status: db.error || rc.error ? "degraded" : "ok", db: db.error ? "down" : "ok", queue: rc.error ? "down" : "ok", version: versionOf(prep.src, env) });
      if (db.error) throw pyErr(traceback(prep.file, 41, "cur = db.execute(sql, params)", db.error));
      if (p === "/orders" && req.method === "POST") {
        if (rc.error) throw pyErr(traceback(prep.file, 52, "queue.lpush(\"orders\", order_id)", "redis.exceptions.ConnectionError: " + rc.error));
        var b = bodyText(req), rows = db.pg.rows(sys2, db.ctr, s.name, "orders"), id = rows.length + 1;
        db.pg.insert(sys2, db.ctr, s.name, "orders", { id: id, item: b.item || b.text || "item", status: "pending" });
        rc.redis.cmd(["LPUSH", "orders", String(id)]);
        return json(201, { id: id, status: "pending" });
      }
      if (p === "/orders" && req.method === "GET") return json(200, db.pg.rows(sys2, db.ctr, s.name, "orders"));
      if ((m = /^\/orders\/(\d+)$/.exec(p))) { var row = db.pg.rows(sys2, db.ctr, s.name, "orders").filter(function (r) { return r.id === +m[1]; })[0]; return row ? json(200, row) : json(404, { error: "order not found" }); }
      if (p === "/") return json(200, { service: "orders", version: versionOf(prep.src, env) });
      return notFound();
    }, { logs: startLogs });
  };
  KESTREL["orders worker"] = function (sys, c, sess, prep) {
    var fs = Dk.ctrFs(sys, c), env = prep.env, s = dbSettings(fs, env), rs = redisSettings(env);
    var pc = pgConnect(sys, c, s);
    if (pc.error) return { kind: "done", code: 1, logs: [["err", traceback(prep.file, 18, "db = connect_db()", pc.error)]] };
    var rc = redisConnect(sys, c, rs);
    if (rc.error) return { kind: "done", code: 1, logs: [["err", traceback(prep.file, 20, "queue = redis.Redis.from_url(REDIS_URL)", "redis.exceptions.ConnectionError: " + rc.error)]] };
    return {
      kind: "idle", name: "orders-worker", mem: 31 * MB, listen: [], stopCode: 0, logs: [["err", "INFO orders-worker: waiting for orders on " + rs.host]],
      tickFn: function (sys2, c2) {
        var r = redisConnect(sys2, c2, rs), d = pgConnect(sys2, c2, s);
        if (r.error || d.error) return;
        var id;
        while ((id = r.redis.cmd(["RPOP", "orders"])) != null) { d.pg.update(sys2, d.ctr, s.name, "orders", +id, { status: "processed" }); Dk.logLine(sys2, c2, "err", "INFO orders-worker: order " + id + " processed"); }
      }
    };
  };

  /* ================================================================== PostgreSQL */
  function pgData(fs, env) { return env.PGDATA || "/var/lib/postgresql/data"; }
  function pgStore(sys, c) {
    var fs = Dk.ctrFs(sys, c), env = envOf(sys, c), dir = pgData(fs, env), f = node(fs, dir + "/global/kc_catalog.json");
    try { return f ? JSON.parse(f.content) : null; } catch (e) { return null; }
  }
  function pgSave(sys, c, st) {
    var fs = Dk.ctrFs(sys, c), dir = pgData(fs, envOf(sys, c));
    S.mkdirs(fs, dir + "/global", 448, 70, 70);
    S.put(fs, dir + "/global/kc_catalog.json", JSON.stringify(st), 384, 70, 70);
    Dk.syncOut(sys, c);
  }
  APPS.dkpostgres = function (sys, c, argv, sess) {
    if (argv.indexOf("--version") > 0 || argv.indexOf("-V") > 0) return { kind: "done", code: 0, logs: [["out", "postgres (PostgreSQL) 16.4"]] };
    var fs = Dk.ctrFs(sys, c), env = S.exportedEnv(sess), dir = pgData(fs, env);
    var dn = node(fs, dir), empty = !dn || !Object.keys(dn.children || {}).length;
    var logs = [], T = function (s) { return dt(sys, null, "pg") + " [1] " + s; };
    if (sess.uid === 0) { /* the official entrypoint drops to the postgres user */ }
    if (empty) {
      var pw = env.POSTGRES_PASSWORD, pwf = env.POSTGRES_PASSWORD_FILE;
      if (pwf) { var pn = node(fs, pwf); if (!pn) return { kind: "done", code: 1, logs: [["err", "/usr/local/bin/docker-entrypoint.sh: line 22: " + pwf + ": No such file or directory"]] }; pw = pn.content.replace(/\n$/, ""); }
      if (!pw && env.POSTGRES_HOST_AUTH_METHOD !== "trust") return { kind: "done", code: 1, logs: [["err", "Error: Database is uninitialized and superuser password is not specified.\n       You must specify POSTGRES_PASSWORD to a non-empty value for the\n       superuser. For example, \"-e POSTGRES_PASSWORD=password\" on \"docker run\".\n\n       You may also use \"POSTGRES_HOST_AUTH_METHOD=trust\" to allow all\n       connections without a password. This is *not* recommended.\n\n       See PostgreSQL documentation about \"trust\":\n       https://www.postgresql.org/docs/current/auth-trust.html"]] };
      var user = env.POSTGRES_USER || "postgres", db = env.POSTGRES_DB || user;
      var st = { users: {}, dbs: {} }; st.users[user] = pw || ""; st.dbs[db] = { owner: user, tables: {} }; if (db !== "postgres") st.dbs.postgres = { owner: user, tables: {} };
      S.mkdirs(fs, dir, 448, 70, 70); S.put(fs, dir + "/PG_VERSION", "16\n", 384, 70, 70); S.mkdirs(fs, dir + "/base", 448, 70, 70);
      pgSave(sys, c, st);
      logs.push(["out", "The files belonging to this database system will be owned by user \"postgres\".\nThis user must also own the server process.\n\nThe database cluster will be initialized with locale \"en_US.utf8\".\n\nfixing permissions on existing directory " + dir + " ... ok\ncreating subdirectories ... ok\nperforming post-bootstrap initialization ... ok\nsyncing data to disk ... ok\n\n\nSuccess. You can now start the database server using:\n\n    pg_ctl -D " + dir + " -l logfile start\n"]);
      if (env.POSTGRES_HOST_AUTH_METHOD === "trust") logs.push(["err", "initdb: warning: enabling \"trust\" authentication for local connections"]);
      logs.push(["out", "waiting for server to start.... done\nserver started\nCREATE DATABASE\n\n/usr/local/bin/docker-entrypoint.sh: ignoring /docker-entrypoint-initdb.d/*\n\nwaiting for server to shut down.... done\nserver stopped\n\nPostgreSQL init process complete; ready for start up.\n"]);
    } else logs.push(["out", "\nPostgreSQL Database directory appears to contain a database; Skipping initialization\n"]);
    logs.push(["err", T("LOG:  starting PostgreSQL 16.4 on x86_64-pc-linux-musl, compiled by gcc (Alpine 13.2.1_git20240309) 13.2.1 20240309, 64-bit")], ["err", T("LOG:  listening on IPv4 address \"0.0.0.0\", port 5432")], ["err", T("LOG:  listening on IPv6 address \"::\", port 5432")], ["err", T("LOG:  database system is ready to accept connections")]);
    var trust = env.POSTGRES_HOST_AUTH_METHOD === "trust" && empty;
    return {
      kind: "service", name: "postgres", mem: 38 * MB, pids: 6, stopCode: 0, readyAt: clock(sys) + (empty ? 4 : 2),
      listen: [{ port: 5432, addr: "0.0.0.0" }],
      pg: {
        auth: function (sys2, c2, user, pass, dbName) {
          var st2 = pgStore(sys2, c2); if (!st2) return "the database system is starting up";
          if (!(user in st2.users)) return "password authentication failed for user \"" + user + "\"";
          if (!trust && st2.users[user] !== pass) return "password authentication failed for user \"" + user + "\"";
          if (!st2.dbs[dbName]) return "database \"" + dbName + "\" does not exist";
          return null;
        },
        ensureTable: function (sys2, c2, dbName, t, seed) { var st2 = pgStore(sys2, c2); if (!st2.dbs[dbName].tables[t]) { st2.dbs[dbName].tables[t] = seed.slice(); pgSave(sys2, c2, st2); } },
        rows: function (sys2, c2, dbName, t) { var st2 = pgStore(sys2, c2); return ((st2.dbs[dbName] || { tables: {} }).tables[t] || []).slice(); },
        insert: function (sys2, c2, dbName, t, row) { var st2 = pgStore(sys2, c2); (st2.dbs[dbName].tables[t] = st2.dbs[dbName].tables[t] || []).push(row); pgSave(sys2, c2, st2); },
        update: function (sys2, c2, dbName, t, id, patch) { var st2 = pgStore(sys2, c2); (st2.dbs[dbName].tables[t] || []).forEach(function (r) { if (r.id === id) Object.assign(r, patch); }); pgSave(sys2, c2, st2); },
        store: function (sys2, c2) { return pgStore(sys2, c2); }
      },
      logs: logs
    };
  };

  /* ================================================================== Redis */
  APPS.dkredis = function (sys, c, argv) {
    var pass = null, port = 6379;
    for (var i = 1; i < argv.length; i++) { if (argv[i] === "--requirepass") pass = argv[++i]; else if (argv[i] === "--port") port = +argv[++i]; else if (argv[i] === "--version" || argv[i] === "-v") return { kind: "done", code: 0, logs: [["out", "Redis server v=7.4.1 sha=00000000:0 malloc=jemalloc-5.3.0 bits=64 build=1f1fa4e1b8e8c1f2"]] }; }
    var data = {}, T = function (k, s) { return "1:" + k + " " + dt(sys, null, "redis") + " * " + s; };
    function cmd(a) {
      var op = String(a[0]).toUpperCase(), k = a[1];
      if (op === "PING") return "PONG";
      if (op === "SET") { data[k] = String(a[2]); return "OK"; }
      if (op === "GET") return data[k] == null ? null : data[k];
      if (op === "INCR") { data[k] = String((+data[k] || 0) + 1); return +data[k]; }
      if (op === "DEL") { var had = k in data; delete data[k]; return had ? 1 : 0; }
      if (op === "KEYS") return Object.keys(data).filter(function (x) { return S.globMatch(k || "*", x); });
      if (op === "DBSIZE") return Object.keys(data).length;
      if (op === "LPUSH") { var l = data[k] = Array.isArray(data[k]) ? data[k] : []; a.slice(2).forEach(function (v) { l.unshift(String(v)); }); return l.length; }
      if (op === "RPOP") { var l2 = data[k]; return Array.isArray(l2) && l2.length ? l2.pop() : null; }
      if (op === "LLEN") return Array.isArray(data[k]) ? data[k].length : 0;
      if (op === "LRANGE") return Array.isArray(data[k]) ? data[k].slice() : [];
      if (op === "FLUSHALL") { data = {}; return "OK"; }
      if (op === "INFO") return "# Server\r\nredis_version:7.4.1\r\nredis_mode:standalone\r\nos:Linux 6.8.0-48-generic x86_64\r\ntcp_port:" + port + "\r\n";
      return { error: "ERR unknown command '" + a[0] + "', with args beginning with: " + a.slice(1).map(function (x) { return "'" + x + "' "; }).join("") };
    }
    return {
      kind: "service", name: "redis", mem: 3.9 * MB, pids: 6, stopCode: 0, readyAt: clock(sys) + 1, listen: [{ port: port, addr: "0.0.0.0" }],
      redis: { cmd: cmd, pass: pass },
      logs: [["out", T("C", "oO0OoO0OoO0Oo Redis is starting oO0OoO0OoO0Oo")], ["out", T("C", "Redis version=7.4.1, bits=64, commit=00000000, modified=0, pid=1, just started")], ["out", pass ? T("C", "Configuration loaded") : "1:C " + dt(sys, null, "redis") + " # Warning: no config file specified, using the default config. In order to specify a config file use redis-server /path/to/redis.conf"], ["out", T("M", "monotonic clock: POSIX clock_gettime")], ["out", T("M", "Running mode=standalone, port=" + port + ".")], ["out", T("M", "Server initialized")], ["out", T("M", "Ready to accept connections tcp")]]
    };
  };

  /* ================================================================== the Kestrel worker binary (registry images) */
  APPS.dkworker = function (sys, c, argv) {
    var fs = Dk.ctrFs(sys, c), ver = (rd(fs, "/etc/kestrel-version") || "0.0.0").trim();
    if (argv.indexOf("--version") > 0 || argv.indexOf("-v") > 0) return { kind: "done", code: 0, logs: [["out", "kestrel-worker " + ver]] };
    return { kind: "idle", name: "worker", mem: 12 * MB, listen: [], stopCode: 0, logs: [["out", "kestrel-worker " + ver + " started, polling the jobs queue every 5s"]] };
  };

  /* ================================================================== Node.js */
  APPS.dknode = function (sys, c, argv, sess) {
    if (argv[1] === "--version" || argv[1] === "-v") return { kind: "done", code: 0, logs: [["out", "v20.18.0"]] };
    if (argv.length < 2) return { kind: "repl", code: 0, listen: [], logs: [], crashAt: clock(sys), crash: function () { return { code: 0 }; }, interactiveNote: "(Node's interactive prompt would open here. The container exited.)" };
    var fs = Dk.ctrFs(sys, c), abs = argv[1].charAt(0) === "/" ? argv[1] : S.normAbs(sess.cwd + "/" + argv[1]), f = node(fs, abs);
    if (!f) return { kind: "done", code: 1, logs: [["err", "node:internal/modules/cjs/loader:1228\n  throw err;\n  ^\n\nError: Cannot find module '" + abs + "'\n    at Module._resolveFilename (node:internal/modules/cjs/loader:1225:15)\n    at node:internal/main/run_main_module:28:49 {\n  code: 'MODULE_NOT_FOUND',\n  requireStack: []\n}\n\nNode.js v20.18.0"]] };
    var req = /require\(['"]([\w@/.-]+)['"]\)/g, m;
    while ((m = req.exec(f.content))) { if (/^(http|fs|path|os|url|crypto|node:)/.test(m[1])) continue; if (!node(fs, abs.slice(0, abs.lastIndexOf("/")) + "/node_modules/" + m[1]) && !node(fs, "/usr/local/lib/node_modules/" + m[1])) return { kind: "done", code: 1, logs: [["err", "node:internal/modules/cjs/loader:1228\n  throw err;\n  ^\n\nError: Cannot find module '" + m[1] + "'\nRequire stack:\n- " + abs + "\n\nNode.js v20.18.0"]] }; }
    var lp = /listen\(\s*(?:process\.env\.PORT\s*\|\|\s*)?(\d+)/.exec(f.content);
    if (!lp) return { kind: "done", code: 0, logs: [] };
    var port = +(S.exportedEnv(sess).PORT || lp[1]);
    return { kind: "service", name: "node", mem: 52 * MB, listen: [{ port: port, addr: "0.0.0.0" }], logs: [["out", "listening on :" + port]], http: function (s2, c2, rq) { return rq.path === "/health" ? json(200, { status: "ok" }) : { status: 200, headers: { "Content-Type": "text/html" }, body: "<h1>Kestrel status</h1>\n" }; } };
  };
  APPS.trivy = function (sys, c, argv) { return { kind: "done", code: 0, logs: [["out", argv.length > 1 ? "(Run trivy on the laptop instead: it's installed there.)" : "Usage:\n  trivy [global flags] command [flags] target"]] }; };

  // Is path inside one of the container's mounts (or tmpfs)?
  Dk.isMounted = function (c, p) { return (c.mounts || []).some(function (m) { return p === m.dst || p.indexOf(m.dst + "/") === 0; }); };
})(typeof window !== "undefined" ? window : globalThis);
