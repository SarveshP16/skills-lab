/* sudo learn — DevOps track: commands that exist only inside containers (and image builds). Images carry
   their own binaries: pip in Python images, apt-get in Debian ones, apk in Alpine, npm in Node, psql in
   PostgreSQL... so `docker exec api ps` fails on python:3.12-slim (no procps) exactly as it does for real.
   Installers write real files (site-packages dist-info folders, dpkg status entries, node_modules) with
   realistic sizes, so a build's layers have the sizes you'd expect and the scanner finds what you installed. */
(function (root) {
  "use strict";
  var S = root.ShEngine, M2 = S.M2, CMDS = S.CMDS, U = S.util, Dk = root.Dk;
  var out = U.out, errl = U.errl, MB = Dk.MB, KB = Dk.KB;
  function node(fs, p) { return Dk.fsNode(fs, p); }
  function ctx(sess) {
    var fs = sess.sys, host = fs.dkHost;
    var c = host && host.dk ? host.dk.ctrs.filter(function (x) { return x.id === fs.dkCtr; })[0] : null;
    return { fs: fs, host: host, c: c || null, build: !!fs.inBuild };
  }
  function abs(sess, p) { if (!p) return sess.cwd; p = p.replace(/^~(?=\/|$)/, sess.home); return S.normAbs(p.charAt(0) === "/" ? p : sess.cwd + "/" + p); }
  function addTime(sess, secs) { sess.sys.buildSecs = (sess.sys.buildSecs || 0) + secs; }
  function fmtKB(b) { return b >= 1e6 ? (b / 1e6).toFixed(1) + " MB" : Math.max(1, Math.round(b / 1e3)) + " kB"; }
  function writeAs(sess, p, content, mode, sz) {
    var d = p.slice(0, p.lastIndexOf("/")) || "/";
    S.mkdirs(sess.sys, d, 493, sess.uid, sess.gid);
    var n = S.put(sess.sys, p, content, mode == null ? 420 : mode, sess.uid, sess.gid);
    if (sz != null) n.size = sz;
    return n;
  }
  function binFile(sess, p, impl) { return writeAs(sess, p, "\x7fELF:" + impl + " (simulated binary)\n", 493, 40 * KB); }
  function canWrite(sess, dir) {
    var segs = dir.split("/").filter(Boolean), cur = "";
    for (var i = 0; i <= segs.length; i++) {
      var p = "/" + segs.slice(0, segs.length - i).join("/"), n = node(sess.sys, p);
      if (n) return n.type === "d" && S.can(sess, n, "w") && S.can(sess, n, "x");
    }
    void cur;
    return false;
  }

  /* ================================================================== pip */
  function pyLibDir(fs, prefix) { var lib = node(fs, prefix + "/lib"); var d = lib && Object.keys(lib.children || {}).filter(function (k) { return /^python3/.test(k); })[0]; return d ? prefix + "/lib/" + d : prefix + "/lib/python3.12"; }
  function pipTarget(sess, pipPath, o) {
    var fs = sess.sys;
    if (o.target) return { site: abs(sess, o.target), bin: null };
    var m = /^(.*)\/bin\/pip[\d.]*$/.exec(pipPath || ""), prefix = m ? m[1] : "/usr/local";
    if (o.prefix) { var lib = pyLibDir(fs, prefix).split("/").pop(); return { site: abs(sess, o.prefix) + "/lib/" + lib + "/site-packages", bin: abs(sess, o.prefix) + "/bin" }; }
    if (o.user) { var lib2 = pyLibDir(fs, prefix).split("/").pop(); return { site: sess.home + "/.local/lib/" + lib2 + "/site-packages", bin: sess.home + "/.local/bin" }; }
    return { site: pyLibDir(fs, prefix) + "/site-packages", bin: prefix + "/bin", venv: !!node(fs, prefix + "/pyvenv.cfg") };
  }
  function installedIn(fs, site) {
    var d = node(fs, site), out2 = {};
    if (!d) return out2;
    Object.keys(d.children).forEach(function (k) { var m = /^(.+)-([^-]+)\.dist-info$/.exec(k); if (m) out2[Dk.pipNorm(m[1])] = { name: m[1], ver: m[2], dir: k }; });
    return out2;
  }
  Dk.installedIn = installedIn;
  function readReqs(sess, file, seen) {
    var p = abs(sess, file), r = S.readFile(sess, p);
    if (r.error) return { error: "ERROR: Could not open requirements file: [Errno 2] No such file or directory: '" + file + "'" };
    var reqs = [];
    seen = seen || {};
    var lines = r.content.split("\n");
    for (var i = 0; i < lines.length; i++) {
      var l = lines[i].replace(/#.*$/, "").trim(); if (!l) continue;
      var inc = /^-r\s+(\S+)/.exec(l);
      if (inc) { if (seen[inc[1]]) continue; seen[inc[1]] = true; var sub = readReqs(sess, inc[1], seen); if (sub.error) return sub; reqs = reqs.concat(sub.reqs); continue; }
      if (/^--?\w/.test(l)) continue;
      var q = parseReq(l); q.from = "-r " + file + " (line " + (i + 1) + ")"; reqs.push(q);
    }
    return { reqs: reqs };
  }
  function parseReq(s) {
    var m = /^([A-Za-z0-9_.-]+)(\[[^\]]*\])?\s*(==|>=|<=|~=|>|<)?\s*([\w.*]+)?/.exec(s.trim());
    if (!m) return { bad: s };
    var extras = m[2] ? m[2].slice(1, -1).split(",").map(function (x) { return x.trim(); }) : [];
    return { name: m[1], norm: Dk.pipNorm(m[1]), op: m[3] || null, ver: m[4] || null, extras: extras, text: s.trim() };
  }
  function cmpVer(a, b) { var x = String(a).split(/[.-]/), y = String(b).split(/[.-]/); for (var i = 0; i < Math.max(x.length, y.length); i++) { var p = +x[i] || 0, q = +y[i] || 0; if (p !== q) return p < q ? -1 : 1; } return 0; }
  Dk.cmpVer = cmpVer;
  function pickVersion(pk, q) {
    var vs = Object.keys(pk.versions).sort(cmpVer);
    if (!q.op) return pk.latest;
    if (q.op === "==") return vs.indexOf(q.ver) >= 0 ? q.ver : null;
    var ok = vs.filter(function (v) { var c = cmpVer(v, q.ver); return q.op === ">=" ? c >= 0 : q.op === ">" ? c > 0 : q.op === "<=" ? c <= 0 : q.op === "<" ? c < 0 : q.op === "~=" ? c >= 0 && v.split(".")[0] === q.ver.split(".")[0] : true; });
    return ok.length ? ok[ok.length - 1] : null;
  }
  CMDS.dkpip = function (args, io, sess) {
    var a = args.slice(1), sub = a.shift();
    var pipPath = (S.resolveCommand(sess, args[0]) || {}).path || "/usr/local/bin/pip";
    if (sub === "--version" || sub === "-V") { var t0 = pipTarget(sess, pipPath, {}); out(io, "pip 24.3.1 from " + t0.site + "/pip (python " + (/3\.9/.test(t0.site) ? "3.9" : "3.12") + ")\n"); return 0; }
    if (sub === "list" || sub === "freeze") {
      var t1 = pipTarget(sess, pipPath, {}), inst = installedIn(sess.sys, t1.site);
      var names = Object.keys(inst).sort();
      if (sub === "freeze") { out(io, names.filter(function (n) { return n !== "pip" && n !== "setuptools"; }).map(function (n) { return inst[n].name + "==" + inst[n].ver + "\n"; }).join("")); return 0; }
      out(io, Dk.table([["Package", "Version"], ["------------------", "-------"]].concat(names.map(function (n) { return [inst[n].name, inst[n].ver]; }))));
      return 0;
    }
    if (sub === "show") { var t2 = pipTarget(sess, pipPath, {}), i2 = installedIn(sess.sys, t2.site)[Dk.pipNorm(a[0] || "")]; if (!i2) { errl(io, "WARNING: Package(s) not found: " + a[0]); return 1; } out(io, "Name: " + i2.name + "\nVersion: " + i2.ver + "\nLocation: " + t2.site + "\n"); return 0; }
    if (sub === "uninstall") {
      var t3 = pipTarget(sess, pipPath, {}), inst3 = installedIn(sess.sys, t3.site), code = 0;
      a.filter(function (x) { return !/^-/.test(x); }).forEach(function (n) {
        var hit = inst3[Dk.pipNorm(n)]; if (!hit) { errl(io, "WARNING: Skipping " + n + " as it is not installed."); return; }
        var d = node(sess.sys, t3.site); delete d.children[hit.dir]; var pk = Dk.PIP[Dk.pipNorm(n)]; if (pk) delete d.children[pk.mod];
        out(io, "Found existing installation: " + hit.name + " " + hit.ver + "\nUninstalling " + hit.name + "-" + hit.ver + ":\n  Successfully uninstalled " + hit.name + "-" + hit.ver + "\n");
      });
      return code;
    }
    if (sub !== "install") { errl(io, sub ? "ERROR: unknown command \"" + sub + "\"" : "\nUsage:   \n  pip <command> [options]\n\nCommands:\n  install                     Install packages.\n  uninstall                   Uninstall packages.\n  freeze                      Output installed packages in requirements format.\n  list                        List installed packages.\n  show                        Show information about installed packages."); return sub ? 1 : 0; }
    var o = { reqFiles: [], pkgs: [] };
    for (var i = 0; i < a.length; i++) {
      var x = a[i];
      if (x === "-r" || x === "--requirement") o.reqFiles.push(a[++i]); else if (/^-r./.test(x)) o.reqFiles.push(x.slice(2));
      else if (x === "--no-cache-dir") o.noCache = true; else if (x === "--prefix") o.prefix = a[++i]; else if (/^--prefix=/.test(x)) o.prefix = x.slice(9);
      else if (x === "--target" || x === "-t") o.target = a[++i]; else if (x === "--user") o.user = true; else if (x === "-U" || x === "--upgrade") o.upgrade = true;
      else if (x === "-q" || x === "--quiet") o.quiet = true; else if (/^--root-user-action/.test(x)) { o.rootOk = true; if (!/=/.test(x)) i++; } else if (x === "--no-deps") o.noDeps = true;
      else if (/^--(disable-pip-version-check|no-warn-script-location|require-hashes|no-compile|break-system-packages)$/.test(x)) { if (x === "--disable-pip-version-check") o.noNotice = true; }
      else if (x === "-i" || x === "--index-url" || x === "--extra-index-url" || x === "--trusted-host") { o.index = a[++i]; }
      else if (/^--(index-url|extra-index-url|trusted-host)=/.test(x)) { o.index = x.split("=").slice(1).join("="); }
      else if (/^-/.test(x)) { errl(io, "\nUsage:   \n  pip install [options] <requirement specifier> [package-index-options] ...\n\nno such option: " + x); return 2; }
      else o.pkgs.push(x);
    }
    var reqs = [];
    for (var k = 0; k < o.reqFiles.length; k++) { var rr = readReqs(sess, o.reqFiles[k]); if (rr.error) { errl(io, rr.error); return 1; } reqs = reqs.concat(rr.reqs); }
    o.pkgs.forEach(function (p) { var q = parseReq(p); q.from = null; reqs.push(q); });
    if (!reqs.length) { errl(io, "ERROR: You must give at least one requirement to install (see \"pip help install\")"); return 1; }
    var tgt = pipTarget(sess, pipPath, o), have = installedIn(sess.sys, tgt.site);
    if (!canWrite(sess, tgt.site)) { errl(io, "Defaulting to user installation because normal site-packages is not writeable\nERROR: Could not install packages due to an OSError: [Errno 13] Permission denied: '" + tgt.site + "'\nConsider using the `--user` option or check the permissions.\n"); return 1; }
    // resolve
    var plan = {}, order = [], lines = [];
    function add(q, parent) {
      var pk = Dk.PIP[q.norm];
      if (!pk) { lines.push(["err", "ERROR: Could not find a version that satisfies the requirement " + q.text + " (from versions: none)"]); lines.push(["err", "ERROR: No matching distribution found for " + q.text]); return false; }
      if (plan[q.norm]) return true;
      var v = pickVersion(pk, q);
      if (!v) { lines.push(["err", "ERROR: Could not find a version that satisfies the requirement " + q.text + " (from versions: " + Object.keys(pk.versions).sort(cmpVer).join(", ") + ")"]); lines.push(["err", "ERROR: No matching distribution found for " + q.text]); return false; }
      var cur = have[q.norm];
      if (cur && (cur.ver === v || (!q.op && !o.upgrade))) { lines.push(["out", "Requirement already satisfied: " + q.text + " in " + tgt.site + (q.from ? " (from " + q.from + ")" : "") + " (" + cur.ver + ")"]); plan[q.norm] = { have: true }; return true; }
      lines.push(["out", "Collecting " + q.text + (q.from ? " (from " + q.from + ")" : parent ? " (from " + parent + ")" : "")]);
      lines.push(["out", "  Downloading " + pk.name + "-" + v + "-py3-none-any.whl.metadata (" + (2 + (M2.hash(pk.name) % 30) / 10).toFixed(1) + " kB)"]);
      plan[q.norm] = { pk: pk, ver: v, replaces: cur };
      if (!o.noDeps) (pk.versions[v].deps || []).forEach(function (dep) { var dq = { name: dep[0], norm: Dk.pipNorm(dep[0]), op: ">=", ver: dep[1], text: dep[0] + ">=" + dep[1] }; var pinned = reqs.filter(function (r) { return r.norm === dq.norm; })[0]; add(pinned || dq, pk.name + "==" + v); });
      if (q.extras && q.extras.indexOf("binary") >= 0 && q.norm === "psycopg") add({ name: "psycopg-binary", norm: "psycopg-binary", op: "==", ver: v, text: "psycopg-binary==" + v }, pk.name + "[binary]==" + v);
      order.push(q.norm);
      return true;
    }
    var ok = reqs.every(function (q) { return q.bad ? (lines.push(["err", "ERROR: Invalid requirement: '" + q.bad + "'"]), false) : add(q, null); });
    lines.forEach(function (l) { if (!o.quiet || l[0] === "err") (l[0] === "err" ? errl : out)(io, l[1] + (l[0] === "err" ? "" : "\n")); });
    if (!ok) { addTime(sess, 1.1); return 1; }
    var news = order.filter(function (n) { return plan[n].pk; });
    var total = 0;
    news.forEach(function (n) { var p = plan[n], sz = p.pk.versions[p.ver].size; total += sz; if (!o.quiet) out(io, "Downloading " + p.pk.name + "-" + p.ver + "-py3-none-any.whl (" + fmtKB(sz / 2.4) + ")\n"); });
    if (news.length && !o.quiet) out(io, "Installing collected packages: " + news.map(function (n) { return plan[n].pk.name; }).join(", ") + "\n");
    news.forEach(function (n) {
      var p = plan[n], site = tgt.site, d = node(sess.sys, site);
      if (p.replaces && d) { delete d.children[p.replaces.dir]; if (!o.quiet) out(io, "  Attempting uninstall: " + p.pk.name + "\n    Found existing installation: " + p.pk.name + " " + p.replaces.ver + "\n    Uninstalling " + p.pk.name + "-" + p.replaces.ver + ":\n      Successfully uninstalled " + p.pk.name + "-" + p.replaces.ver + "\n"); }
      writeAs(sess, site + "/" + p.pk.mod + "/__init__.py", "# " + p.pk.name + " " + p.ver + "\n", 420, p.pk.versions[p.ver].size);
      writeAs(sess, site + "/" + p.pk.name + "-" + p.ver + ".dist-info/METADATA", "Metadata-Version: 2.1\nName: " + p.pk.name + "\nVersion: " + p.ver + "\n");
      if (tgt.bin && (n === "gunicorn" || n === "flask" || n === "pytest")) binFile(sess, tgt.bin + "/" + n, "dk" + n);
    });
    if (!o.noCache && news.length) writeAs(sess, sess.home + "/.cache/pip/http-v2/" + M2.hexOf(news.join(","), 2) + "/" + M2.hexOf(news.join(",") + "b", 40) + ".body", "", 420, Math.round(total * 0.9));
    if (news.length) out(io, "Successfully installed " + news.map(function (n) { return plan[n].pk.name + "-" + plan[n].ver; }).sort().join(" ") + "\n");
    if (sess.uid === 0 && !tgt.venv && !o.rootOk && !o.target && !o.prefix) errl(io, "WARNING: Running pip as the 'root' user can result in broken permissions and conflicting behaviour with the system package manager, possibly rendering your system unusable. It is recommended to use a virtual environment instead: https://pip.pypa.io/warnings/venv. Use the --root-user-action option if you know what you are doing and want to suppress this warning.");
    if (!o.noNotice && news.length && !o.quiet) errl(io, "\n[notice] A new release of pip is available: 24.3.1 -> 25.3\n[notice] To update, run: pip install --upgrade pip");
    addTime(sess, 1.5 + news.length * 0.9 + total / 8e6);
    return 0;
  };

  /* ================================================================== python (inside containers and builds) */
  CMDS.dkpython = function (args, io, sess) {
    var a = args.slice(1), pyPath = (S.resolveCommand(sess, args[0]) || {}).path || "/usr/local/bin/python";
    var m = /^(.*)\/bin\/python[\d.]*$/.exec(pyPath), prefix = m ? m[1] : "/usr/local";
    var cfg = node(sess.sys, prefix + "/pyvenv.cfg");
    if (cfg && !node(sess.sys, "/usr/local/bin/python3") && !node(sess.sys, "/usr/bin/python3")) { errl(io, "/bin/sh: " + pyPath + ": not found"); return 127; }
    var ver = /3\.9/.test(pyLibDir(sess.sys, cfg ? "/usr/local" : prefix)) ? "3.9.18" : "3.12.7";
    while (a[0] === "-u" || a[0] === "-B" || a[0] === "-O") a.shift();
    if (a[0] === "--version" || a[0] === "-V") { out(io, "Python " + ver + "\n"); return 0; }
    if (a[0] === "-m" && a[1] === "pip") return CMDS.dkpip([prefix + "/bin/pip"].concat(a.slice(2)), io, sess);
    if (a[0] === "-m" && a[1] === "venv") {
      var dir = abs(sess, a.filter(function (x, i) { return i > 1 && !/^-/.test(x); })[0] || ".venv");
      if (!canWrite(sess, dir)) { errl(io, "Error: [Errno 13] Permission denied: '" + dir + "'"); return 1; }
      ["python", "python3", "python3.12"].forEach(function (b) { binFile(sess, dir + "/bin/" + b, "dkpython"); });
      ["pip", "pip3"].forEach(function (b) { binFile(sess, dir + "/bin/" + b, "dkpip"); });
      writeAs(sess, dir + "/bin/activate", "# This file must be used with \"source bin/activate\"\nVIRTUAL_ENV=\"" + dir + "\"\nexport VIRTUAL_ENV\nPATH=\"$VIRTUAL_ENV/bin:$PATH\"\nexport PATH\n");
      S.mkdirs(sess.sys, dir + "/lib/python3.12/site-packages", 493, sess.uid, sess.gid);
      writeAs(sess, dir + "/lib/python3.12/site-packages/pip-24.3.1.dist-info/METADATA", "Metadata-Version: 2.1\nName: pip\nVersion: 24.3.1\n");
      writeAs(sess, dir + "/lib/python3.12/site-packages/pip/__init__.py", "", 420, 12 * MB);
      writeAs(sess, dir + "/pyvenv.cfg", "home = /usr/local/bin\ninclude-system-site-packages = false\nversion = " + ver + "\nexecutable = /usr/local/bin/python3.12\ncommand = /usr/local/bin/python3 -m venv " + dir + "\n");
      addTime(sess, 2.4);
      return 0;
    }
    if (a[0] === "-m" && a[1] === "compileall") { addTime(sess, 0.4); return 0; }
    if (a[0] === "-m" && a[1] === "pytest") { out(io, "============================= test session starts ==============================\ncollected 4 items\n\ntests/test_app.py ....                                                   [100%]\n\n============================== 4 passed in 0.21s ===============================\n"); return 0; }
    if (a[0] === "-c") {
      var code = a[1] || "";
      var imp = /import\s+([\w.]+)/.exec(code);
      if (imp) { var sp = Dk.sitePaths(sess.sys, pyPath, S.exportedEnv(sess)), mod = imp[1].split(".")[0]; var found = ["os", "sys", "json", "urllib", "socket", "time"].indexOf(mod) >= 0 || sp.dirs.some(function (d) { return !!node(sess.sys, d + "/" + mod); }); if (!found) { errl(io, "Traceback (most recent call last):\n  File \"<string>\", line 1, in <module>\nModuleNotFoundError: No module named '" + mod + "'"); return 1; } }
      // health checks written in Python: urllib.request.urlopen('http://localhost:8000/health')
      var um = /urlopen\(\s*['"]([^'"]+)['"]/.exec(code);
      if (um) { var r = fetch(sess, um[1], {}); if (r.err || r.status >= 400) { errl(io, "Traceback (most recent call last):\n  File \"<string>\", line 1, in <module>\n" + (r.err ? "urllib.error.URLError: <urlopen error [Errno 111] Connection refused>" : "urllib.error.HTTPError: HTTP Error " + r.status + ": " + (r.status === 503 ? "SERVICE UNAVAILABLE" : "ERROR"))); return 1; } }
      code.split(/;|\n/).forEach(function (l) { var pm = /^\s*print\(\s*f?["'](.*?)["']\s*\)\s*$/.exec(l); if (pm) out(io, pm[1] + "\n"); if (/print\(sys\.version\)/.test(l)) out(io, ver + " (main, Oct 19 2024, 04:15:56) [GCC 12.2.0]\n"); });
      return 0;
    }
    if (!a.length) { Dk.noteOnce && Dk.noteOnce(io, "(Python's interactive prompt isn't available in the lab.)"); return 0; }
    var file = abs(sess, a[0]), f = node(sess.sys, file);
    if (!f) { errl(io, "python: can't open file '" + file + "': [Errno 2] No such file or directory"); return 2; }
    if (Dk.appKind(f.content)) { U.note(io, "(" + a[0] + " is a server: started from a shell inside a running container it would block this terminal. It's meant to be the container's main process: put it in CMD.)"); return 0; }
    String(f.content).split("\n").forEach(function (l) { var pm = /^\s*print\(\s*f?["'](.*?)["']\s*\)\s*$/.exec(l); if (pm) out(io, pm[1] + "\n"); });
    return 0;
  };
  ["dkgunicorn", "dkflask", "dkpytest"].forEach(function (n) {
    CMDS[n] = function (args, io) {
      if (args[1] === "--version" || args[1] === "-v") { out(io, { dkgunicorn: "gunicorn (version 23.0.0)", dkflask: "Python 3.12.7\nFlask 3.1.1\nWerkzeug 3.1.3", dkpytest: "pytest 8.3.3" }[n] + "\n"); return 0; }
      if (n === "dkpytest") { out(io, "============================= test session starts ==============================\ncollected 4 items\n\ntests/test_app.py ....                                                   [100%]\n\n============================== 4 passed in 0.21s ===============================\n"); return 0; }
      U.note(io, "(" + args[0] + " starts a web server: run it as the container's main process (CMD), not from a shell.)"); return 0;
    };
  });

  /* ================================================================== HTTP from inside a container */
  function fetch(sess, url, o) {
    var c = ctx(sess), u = M2.parseUrl(url);
    if (!u) return { err: "malformed", code: 3 };
    var host = u.host;
    if (!c.c) {
      // during a build only the internet is reachable
      if (/\./.test(host) && !/^(localhost|127\.)/.test(host)) return { status: 200, headers: { "Content-Type": "text/html" }, body: "<!doctype html>\n<title>OK</title>\n" };
      return { err: "dns", host: host };
    }
    var cn = Dk.connect(c.host, c.c, host, u.port);
    if (cn.why === "dns") {
      if (/\./.test(host) && !/\.internal$/.test(host)) return { status: 200, headers: { "Content-Type": "text/html" }, body: "<!doctype html>\n<title>Example</title>\n" };
      return { err: "dns", host: host };
    }
    if (!cn.ok) return { err: "refused", host: host, ip: cn.ctr ? (cn.ctr.nets[0] || {}).ip : host };
    if (!cn.app.http) return { err: "proto", host: host };
    var req = { scheme: u.scheme, host: host, port: u.port, path: u.path, method: o.method || (o.data != null ? "POST" : "GET"), headers: Object.assign({ host: host, "user-agent": o.ua || "curl/8.11.0", accept: "*/*" }, o.headers || {}), body: o.data };
    var r = cn.app.http(c.host, cn.ctr, req, (c.c.nets[0] || {}).ip || "172.17.0.2");
    if (!r) return { err: "empty", host: host };
    return r;
  }
  Dk.ctrFetch = fetch;
  var REASON = { 200: "OK", 201: "CREATED", 204: "NO CONTENT", 301: "Moved Permanently", 302: "Found", 400: "BAD REQUEST", 401: "UNAUTHORIZED", 403: "Forbidden", 404: "NOT FOUND", 500: "INTERNAL SERVER ERROR", 502: "Bad Gateway", 503: "SERVICE UNAVAILABLE" };
  CMDS.dkcurl = function (args, io, sess) {
    var a = args.slice(1), o = { headers: {} }, url = null;
    for (var i = 0; i < a.length; i++) {
      var x = a[i];
      if (x === "-s" || x === "--silent") o.s = true; else if (x === "-S") o.S = true; else if (x === "-f" || x === "--fail") o.f = true; else if (x === "-i") o.i = true; else if (x === "-I") o.I = true; else if (x === "-L") continue;
      else if (/^-[sSfiL]+$/.test(x)) { if (/s/.test(x)) o.s = true; if (/S/.test(x)) o.S = true; if (/f/.test(x)) o.f = true; if (/i/.test(x)) o.i = true; }
      else if (x === "-o") o.o = a[++i]; else if (x === "-X") o.method = a[++i]; else if (x === "-d" || x === "--data") o.data = a[++i]; else if (x === "-H") { var hm = /^([^:]+):\s*(.*)$/.exec(a[++i] || ""); if (hm) o.headers[hm[1].toLowerCase()] = hm[2]; }
      else if (x === "-w") o.w = a[++i]; else if (x === "--max-time" || x === "-m" || x === "--retry") i++;
      else if (x === "--version") { out(io, "curl 8.11.0 (x86_64-pc-linux-gnu)\n"); return 0; }
      else url = x;
    }
    if (!url) { errl(io, "curl: try 'curl --help' or 'curl --manual' for more information"); return 2; }
    var r = fetch(sess, url, o), show = !o.s || o.S;
    if (r.err) {
      var code = r.err === "dns" ? 6 : r.err === "refused" ? 7 : 52;
      if (show) errl(io, "curl: (" + code + ") " + (r.err === "dns" ? "Could not resolve host: " + r.host : r.err === "refused" ? "Failed to connect to " + r.host + " port " + M2.parseUrl(url).port + " after 0 ms: Couldn't connect to server" : "Empty reply from server"));
      if (o.w) out(io, o.w.replace(/%\{http_code\}/g, "000").replace(/\\n/g, "\n"));
      return code;
    }
    if (o.f && r.status >= 400) { if (show) errl(io, "curl: (22) The requested URL returned error: " + r.status); if (o.w) out(io, o.w.replace(/%\{http_code\}/g, String(r.status)).replace(/\\n/g, "\n")); return 22; }
    var head = "HTTP/1.1 " + r.status + " " + (REASON[r.status] || "") + "\n" + Object.keys(r.headers || {}).map(function (k) { return k + ": " + r.headers[k]; }).join("\n") + "\n\n";
    var body = o.I ? "" : r.body || "";
    if (o.o) { S.writeFile(sess, abs(sess, o.o), body, false); } else out(io, (o.i || o.I ? head : "") + body);
    if (o.w) out(io, o.w.replace(/%\{http_code\}/g, String(r.status)).replace(/\\n/g, "\n"));
    return 0;
  };
  CMDS.dkwget = function (args, io, sess) {
    var a = args.slice(1), o = {}, url = null;
    for (var i = 0; i < a.length; i++) {
      var x = a[i];
      if (x === "-q") o.q = true; else if (x === "-O") o.O = a[++i]; else if (x === "-qO-" || x === "-qO" && a[i + 1] === "-") { o.q = true; o.O = "-"; if (x === "-qO") i++; } else if (/^-O./.test(x)) o.O = x.slice(2);
      else if (x === "--spider") o.spider = true; else if (x === "-T" || x === "--timeout" || x === "-t" || x === "--tries") i++; else if (/^--(timeout|tries)=/.test(x)) continue; else if (x === "--no-verbose" || x === "-nv") o.q = true;
      else url = x;
    }
    if (!url) { errl(io, "BusyBox v1.36.1 (2024-06-10 07:11:47 UTC) multi-call binary.\n\nUsage: wget [-cqS] [--spider] [-O FILE] [-o LOGFILE] [--header STR]\n\t[--post-data STR | --post-file FILE] [-Y on/off]\n\t[-P DIR] [-U AGENT] [-T SEC] URL..."); return 1; }
    var r = fetch(sess, url, { ua: "Wget" });
    if (!o.q) errl(io, "Connecting to " + M2.parseUrl(url).host + ":" + M2.parseUrl(url).port);
    if (r.err) { errl(io, r.err === "dns" ? "wget: bad address '" + r.host + ":" + M2.parseUrl(url).port + "'" : r.err === "refused" ? "wget: can't connect to remote host (" + r.ip + "): Connection refused" : "wget: error getting response"); return 1; }
    if (r.status >= 400) { errl(io, "wget: server returned error: HTTP/1.1 " + r.status + " " + (REASON[r.status] || "")); return 1; }
    if (o.spider) { if (!o.q) errl(io, "remote file exists"); return 0; }
    if (o.O === "-") { out(io, r.body || ""); return 0; }
    var name = o.O || (M2.parseUrl(url).path.split("/").pop() || "index.html");
    S.writeFile(sess, abs(sess, name), r.body || "", false);
    if (!o.q) errl(io, "saving to '" + name + "'\n" + name + "             100% |********************************|   " + (r.body || "").length + "  0:00:00 ETA\n'" + name + "' saved");
    return 0;
  };
  CMDS.dknc = function (args, io, sess) {
    var a = args.slice(1), z = false, v = false, rest = [];
    a.forEach(function (x) { if (/^-[zvw0-9]+$/.test(x)) { if (/z/.test(x)) z = true; if (/v/.test(x)) v = true; } else rest.push(x); });
    var c = ctx(sess); if (!c.c || rest.length < 2) return 1;
    var cn = Dk.connect(c.host, c.c, rest[0], +rest[1]);
    if (v) errl(io, cn.ok ? rest[0] + " (" + ((cn.ctr.nets[0] || {}).ip) + ":" + rest[1] + ") open" : cn.why === "dns" ? "nc: bad address '" + rest[0] + "'" : "nc: " + rest[0] + " (" + ((cn.ctr && cn.ctr.nets[0] || {}).ip || rest[0]) + ":" + rest[1] + "): Connection refused");
    return cn.ok ? 0 : 1;
  };

  /* ================================================================== ps inside a container */
  CMDS.dkps = function (args, io, sess) {
    var c = ctx(sess), fs = sess.sys, rows = [];
    function uname(uid) { var l = (M2.rd(fs, "/etc/passwd") || "").split("\n").filter(function (x) { return x.split(":")[2] === String(uid); })[0]; return l ? l.split(":")[0] : String(uid); }
    var me = args.join(" ").replace(/^\S*\//, "");
    if (sess.dkMain || !c.c) rows.push({ pid: 1, user: uname(sess.uid), cmd: me, me: true });
    else {
      var argv = Dk.argvOf(c.host, c.c).join(" ").replace(/^\/docker-entrypoint\.sh |^docker-entrypoint\.sh /, "");
      var ue = Dk.userEntry(fs, c.c.user != null ? c.c.user : (Dk.imageById(c.host, c.c.image) || { cfg: {} }).cfg.User);
      rows.push({ pid: 1, user: uname(ue ? ue.uid : 0), cmd: /^nginx/.test(argv) ? "nginx: master process nginx -g daemon off;" : argv });
      if (/^nginx/.test(argv)) { rows.push({ pid: 29, user: "nginx", cmd: "nginx: worker process" }); rows.push({ pid: 30, user: "nginx", cmd: "nginx: worker process" }); }
      if (/gunicorn/.test(argv)) rows.push({ pid: 7, user: uname(ue ? ue.uid : 0), cmd: argv });
      if (c.c.shellOpen) rows.push({ pid: 41, user: uname(sess.uid), cmd: "sh" });
      rows.push({ pid: 48 + (fs.psSeq = (fs.psSeq || 0) + 1), user: uname(sess.uid), cmd: me, me: true });
    }
    var bb = fs.distro === "alpine" || fs.distro === "busybox";
    if (bb) { out(io, "PID   USER     TIME  COMMAND\n" + rows.map(function (r) { return ("     " + r.pid).slice(-5) + " " + (r.user + "        ").slice(0, 8) + "  0:00 " + r.cmd + "\n"; }).join("")); return 0; }
    var full = args.slice(1).join(" ");
    if (/aux|-ef|-e|ax/.test(full)) {
      if (/-ef/.test(full)) { out(io, "UID          PID    PPID  C STIME TTY          TIME CMD\n" + rows.map(function (r) { return (r.user + "         ").slice(0, 8) + ("        " + r.pid).slice(-8) + ("        " + (r.pid === 1 ? 0 : 1)).slice(-8) + "  0 09:00 " + (r.me ? "pts/0   " : "?       ") + " 00:00:00 " + r.cmd + "\n"; }).join("")); return 0; }
      out(io, "USER         PID %CPU %MEM    VSZ   RSS TTY      STAT START   TIME COMMAND\n" + rows.map(function (r) { return (r.user + "        ").slice(0, 8) + ("        " + r.pid).slice(-7) + "  0.0  0.1   " + (r.me ? "8092  4096 pts/0    Rs+ " : "2576   920 ?        Ss  ") + " 09:00   0:00 " + r.cmd + "\n"; }).join(""));
      return 0;
    }
    out(io, "    PID TTY          TIME CMD\n" + rows.filter(function (r) { return r.me || r.pid > 40; }).map(function (r) { return ("       " + r.pid).slice(-7) + " pts/0    00:00:00 " + r.cmd.split(" ")[0] + "\n"; }).join(""));
    return 0;
  };

  /* ================================================================== apt / dpkg (Debian, Ubuntu) */
  function dpkgRows(fs) { return Dk.parseDpkg(M2.rd(fs, "/var/lib/dpkg/status")); }
  function saveDpkg(sess, rows) { S.put(sess.sys, "/var/lib/dpkg/status", Dk.dpkgStatus(rows), 420, 0, 0); }
  CMDS.dkapt = function (args, io, sess) {
    var a = args.slice(1), op = null, pkgs = [], yes = false, noRec = false, quiet = false;
    a.forEach(function (x) { if (x === "-y" || x === "--yes" || x === "-yq" || x === "-qy" || x === "--assume-yes") { yes = true; if (/q/.test(x)) quiet = true; } else if (x === "--no-install-recommends") noRec = true; else if (/^-q+$/.test(x)) quiet = true; else if (/^-/.test(x)) return; else if (!op) op = x; else pkgs.push(x); });
    var ubuntu = sess.sys.distro === "ubuntu", mirror = ubuntu ? "http://archive.ubuntu.com/ubuntu noble" : "http://deb.debian.org/debian bookworm";
    if (!op) { out(io, "apt 2.6.1 (amd64)\nUsage: apt-get [options] command\n"); return 0; }
    if (sess.uid !== 0 && op !== "list" && op !== "show") { errl(io, op === "update" ? "Reading package lists...\nE: List directory /var/lib/apt/lists/partial is missing. - Acquire (13: Permission denied)" : "E: Could not open lock file /var/lib/dpkg/lock-frontend - open (13: Permission denied)\nE: Unable to acquire the dpkg frontend lock (/var/lib/dpkg/lock-frontend), are you root?"); return 100; }
    if (op === "update") {
      out(io, "Get:1 " + mirror + " InRelease [151 kB]\nGet:2 " + mirror + "-updates InRelease [55.4 kB]\nGet:3 " + (ubuntu ? "http://security.ubuntu.com/ubuntu noble-security" : "http://deb.debian.org/debian-security bookworm-security") + " InRelease [48.0 kB]\nGet:4 " + mirror + "/main amd64 Packages [8789 kB]\nFetched 9235 kB in 1s (8105 kB/s)\nReading package lists...\n");
      var base = ubuntu ? "archive.ubuntu.com_ubuntu_dists_noble" : "deb.debian.org_debian_dists_bookworm";
      S.mkdirs(sess.sys, "/var/lib/apt/lists", 493, 0, 0);
      [["_main_binary-amd64_Packages.lz4", 17.8 * MB], ["_InRelease", 151 * KB], ["-updates_InRelease", 55 * KB]].forEach(function (f) { var n = S.put(sess.sys, "/var/lib/apt/lists/" + base + f[0], "", 420, 0, 0); n.size = f[1]; });
      addTime(sess, 2.1);
      return 0;
    }
    if (op === "clean" || op === "autoclean") { var cdir = node(sess.sys, "/var/cache/apt/archives"); if (cdir) cdir.children = {}; return 0; }
    if (op === "install") {
      var lists = node(sess.sys, "/var/lib/apt/lists"), have = lists && Object.keys(lists.children).some(function (k) { return /Packages/.test(k); });
      out(io, "Reading package lists...\n");
      if (!have) { out(io, "Building dependency tree...\nReading state information...\n"); errl(io, "E: Unable to locate package " + pkgs[0]); return 100; }
      var rows = dpkgRows(sess.sys), installed = {}; rows.forEach(function (r) { installed[r[0]] = r[1]; });
      var want = [], miss = null;
      (function walk(list, rec) { list.forEach(function (p) { var name = p.split("=")[0], P = Dk.APT[name]; if (!P) { miss = miss || name; return; } if (installed[name] || want.indexOf(name) >= 0) return; want.push(name); walk(P.deps || []); if (!noRec) walk(P.rec || [], true); }); })(pkgs);
      out(io, "Building dependency tree...\nReading state information...\n");
      if (miss) { errl(io, "E: Unable to locate package " + miss); return 100; }
      if (!want.length) { out(io, pkgs.map(function (p) { return p + " is already the newest version (" + installed[p] + ").\n"; }).join("") + "0 upgraded, 0 newly installed, 0 to remove and 0 not upgraded.\n"); return 0; }
      var size = want.reduce(function (s, n) { return s + Dk.APT[n].size; }, 0);
      out(io, "The following NEW packages will be installed:\n  " + want.join(" ") + "\n0 upgraded, " + want.length + " newly installed, 0 to remove and 0 not upgraded.\nNeed to get " + Math.round(size / 2600).toLocaleString("en-US") + " kB of archives.\nAfter this operation, " + Math.round(size / 1000).toLocaleString("en-US") + " kB of additional disk space will be used.\n");
      if (!yes) { out(io, "Do you want to continue? [Y/n] Abort.\n"); return 1; }
      want.forEach(function (n, i) { out(io, "Get:" + (i + 1) + " " + mirror + "/main amd64 " + n + " amd64 " + Dk.APT[n].ver + "\n"); });
      if (!quiet) errl(io, "debconf: delaying package configuration, since apt-utils is not installed");
      want.forEach(function (n) {
        var P = Dk.APT[n];
        out(io, "Selecting previously unselected package " + n + ".\nUnpacking " + n + " (" + P.ver + ") ...\n");
        (P.bins || []).forEach(function (b) { binFile(sess, b[0], b[1]); });
        var doc = S.put(sess.sys, "/usr/share/doc/" + n + "/copyright", "Files: *\n", 420, 0, 0); doc.size = P.size;
        rows.push([n, P.ver]);
        S.put(sess.sys, "/var/cache/apt/archives/" + n + "_" + P.ver.replace(/:/g, "%3a") + "_amd64.deb", "", 420, 0, 0).size = P.size / 2.6;
      });
      want.forEach(function (n) { out(io, "Setting up " + n + " (" + Dk.APT[n].ver + ") ...\n"); });
      saveDpkg(sess, rows);
      addTime(sess, 3 + size / 25e6);
      return 0;
    }
    if (op === "remove" || op === "purge") {
      var rows2 = dpkgRows(sess.sys);
      pkgs.forEach(function (p) { var P = Dk.APT[p]; rows2 = rows2.filter(function (r) { return r[0] !== p; }); (P && P.bins || []).forEach(function (b) { var d = node(sess.sys, b[0].slice(0, b[0].lastIndexOf("/"))); if (d) delete d.children[b[0].split("/").pop()]; }); out(io, "Removing " + p + " ...\n"); });
      saveDpkg(sess, rows2); return 0;
    }
    if (op === "list") { out(io, "Listing...\n" + dpkgRows(sess.sys).map(function (r) { return r[0] + "/now " + r[1] + " amd64 [installed]\n"; }).join("")); return 0; }
    errl(io, "E: Invalid operation " + op); return 100;
  };
  CMDS.dkdpkg = function (args, io, sess) {
    if (args[1] === "-l" || args[1] === "--list") { out(io, "Desired=Unknown/Install/Remove/Purge/Hold\n| Status=Not/Inst/Conf-files/Unpacked/halF-conf/Half-inst/trig-aWait/Trig-pend\n||/ Name           Version          Architecture Description\n+++-==============-================-============-=================================\n" + dpkgRows(sess.sys).map(function (r) { return "ii  " + (r[0] + "              ").slice(0, 15) + (r[1] + "                 ").slice(0, 17) + "amd64        " + r[0] + "\n"; }).join("")); return 0; }
    if (args[1] === "-s" || args[1] === "--status") { var r = dpkgRows(sess.sys).filter(function (x) { return x[0] === args[2]; })[0]; if (!r) { errl(io, "dpkg-query: package '" + args[2] + "' is not installed and no information is available"); return 1; } out(io, "Package: " + r[0] + "\nStatus: install ok installed\nVersion: " + r[1] + "\n"); return 0; }
    out(io, "Type dpkg --help for help about installing and deinstalling packages [*];\n"); return 0;
  };

  /* ================================================================== apk (Alpine) */
  CMDS.dkapk = function (args, io, sess) {
    var a = args.slice(1), op = null, pkgs = [], noCache = false, virt = null;
    for (var i = 0; i < a.length; i++) { var x = a[i]; if (x === "--no-cache") noCache = true; else if (x === "--virtual" || x === "-t") virt = a[++i]; else if (x === "-U" || x === "--update-cache") noCache = noCache || false; else if (/^-/.test(x)) continue; else if (!op) op = x; else pkgs.push(x); }
    if (!op) { out(io, "apk-tools 2.14.4, compiled for x86_64.\n\nusage: apk [<OPTIONS>...] COMMAND [<ARGUMENTS>...]\n"); return 0; }
    if (sess.uid !== 0 && op !== "info") { errl(io, "ERROR: Unable to lock database: Permission denied\nERROR: Failed to open apk database: Permission denied"); return 99; }
    var fs = sess.sys, idx = node(fs, "/var/cache/apk") && Object.keys(node(fs, "/var/cache/apk").children).length;
    var fetchL = "fetch https://dl-cdn.alpinelinux.org/alpine/v3.20/main/x86_64/APKINDEX.tar.gz\nfetch https://dl-cdn.alpinelinux.org/alpine/v3.20/community/x86_64/APKINDEX.tar.gz\n";
    if (op === "update") { out(io, fetchL + "v3.20.3-216-g1d1f9e6dca0 [https://dl-cdn.alpinelinux.org/alpine/v3.20/main]\nOK: 24165 distinct packages available\n"); S.mkdirs(fs, "/var/cache/apk"); S.put(fs, "/var/cache/apk/APKINDEX.4e7a3a1e.tar.gz", "", 420).size = 2.4 * MB; addTime(sess, 1.2); return 0; }
    var rows = Dk.parseApk(M2.rd(fs, "/lib/apk/db/installed"));
    if (op === "add") {
      if (!noCache && !idx) { errl(io, "WARNING: opening from cache https://dl-cdn.alpinelinux.org/alpine/v3.20/main: No such file or directory\nWARNING: opening from cache https://dl-cdn.alpinelinux.org/alpine/v3.20/community: No such file or directory\nERROR: unable to select packages:\n" + pkgs.map(function (p) { return "  " + p + " (no such package):\n    required by: world[" + p + "]\n"; }).join("").replace(/\n$/, "")); return pkgs.length; }
      var miss = pkgs.filter(function (p) { return !Dk.APK[p]; });
      if (noCache) out(io, fetchL);
      if (miss.length) { errl(io, "ERROR: unable to select packages:\n" + miss.map(function (p) { return "  " + p + " (no such package):\n    required by: world[" + p + "]"; }).join("\n")); return miss.length; }
      var news = pkgs.filter(function (p) { return !rows.some(function (r) { return r[0] === p; }); });
      news.forEach(function (p, k) { var P = Dk.APK[p]; out(io, "(" + (k + 1) + "/" + news.length + ") Installing " + p + " (" + P.ver + ")\n"); P.bins.forEach(function (b) { binFile(sess, b[0], b[1]); }); S.put(fs, "/usr/share/apk-sizes/" + p, "", 420).size = P.size; rows.push([p, P.ver]); });
      if (virt) out(io, "(" + (news.length + 1) + "/" + (news.length + 1) + ") Installing " + virt + " (20241115.090000)\n");
      out(io, "Executing busybox-1.36.1-r29.trigger\nOK: " + Math.round(8 + news.reduce(function (s, p) { return s + Dk.APK[p].size; }, 0) / 1048576) + " MiB in " + (rows.length + 8) + " packages\n");
      S.put(fs, "/lib/apk/db/installed", Dk.apkInstalled(rows), 420);
      if (!noCache) S.put(fs, "/var/cache/apk/" + news.join("-") + ".apk", "", 420).size = 1.1 * MB;
      addTime(sess, 1.5 + news.length * 0.4);
      return 0;
    }
    if (op === "del") { pkgs.forEach(function (p) { rows = rows.filter(function (r) { return r[0] !== p; }); var P = Dk.APK[p]; (P && P.bins || []).forEach(function (b) { var d = node(fs, b[0].slice(0, b[0].lastIndexOf("/"))); if (d) delete d.children[b[0].split("/").pop()]; }); var sz = node(fs, "/usr/share/apk-sizes"); if (sz) delete sz.children[p]; }); S.put(fs, "/lib/apk/db/installed", Dk.apkInstalled(rows), 420); out(io, "OK: 8 MiB in " + (rows.length + 8) + " packages\n"); return 0; }
    if (op === "info") { out(io, rows.map(function (r) { return r[0] + "\n"; }).join("")); return 0; }
    errl(io, "apk: unknown command '" + op + "'"); return 1;
  };

  /* ================================================================== users and groups */
  function pwRows(fs, f) { return (M2.rd(fs, f) || "").split("\n").filter(Boolean).map(function (l) { return l.split(":"); }); }
  function savePw(fs, f, rows, mode) { S.put(fs, f, rows.map(function (r) { return r.join(":"); }).join("\n") + "\n", mode || 420, 0, f === "/etc/shadow" ? 42 : 0); }
  function addGroup(fs, name, gid, system) {
    var g = pwRows(fs, "/etc/group");
    if (g.some(function (r) { return r[0] === name; })) return { exists: true };
    if (gid == null) { gid = system ? 999 : 1000; while (g.some(function (r) { return +r[2] === gid; })) gid += system ? -1 : 1; }
    else if (g.some(function (r) { return +r[2] === +gid; })) return { gidTaken: true };
    g.push([name, "x", String(gid), ""]); savePw(fs, "/etc/group", g);
    return { gid: +gid };
  }
  function addUser(fs, o) {
    var p = pwRows(fs, "/etc/passwd");
    if (p.some(function (r) { return r[0] === o.name; })) return { exists: true };
    var uid = o.uid; if (uid == null) { uid = o.system ? 999 : 1000; while (p.some(function (r) { return +r[2] === uid; })) uid += o.system ? -1 : 1; }
    var g = pwRows(fs, "/etc/group"), grp = o.group ? g.filter(function (r) { return r[0] === o.group || r[2] === String(o.group); })[0] : null;
    if (o.group && !grp) return { noGroup: true };
    var gid = grp ? +grp[2] : null;
    if (gid == null) { var made = addGroup(fs, o.name, o.system ? null : uid, o.system); gid = made.gid != null ? made.gid : +g.filter(function (r) { return r[0] === o.name; })[0][2]; }
    var home = o.home || "/home/" + o.name;
    p.push([o.name, "x", String(uid), String(gid), o.gecos || "", home, o.shell || (fs.distro === "alpine" ? "/bin/sh" : "/bin/bash")]); savePw(fs, "/etc/passwd", p);
    var sh = pwRows(fs, "/etc/shadow"); sh.push([o.name, "!", "20000", "0", "99999", "7", "", "", ""]); savePw(fs, "/etc/shadow", sh, 416);
    if (o.createHome) { S.mkdirs(fs, home, 493, uid, gid); var hn = node(fs, home); hn.uid = uid; hn.gid = gid; }
    return { uid: uid, gid: gid };
  }
  Dk.addUser = addUser; Dk.addGroup = addGroup;
  CMDS.dkadduser = function (args, io, sess) {
    var fs = sess.sys, a = args.slice(1), bb = fs.distro === "alpine" || fs.distro === "busybox";
    if (sess.uid !== 0) { errl(io, bb ? "adduser: permission denied (are you root?)" : "fatal: Only root may add a user or group to the system."); return 1; }
    var o = {}, name = null, extra = null;
    for (var i = 0; i < a.length; i++) {
      var x = a[i];
      if (bb) { if (x === "-D") o.noPass = true; else if (x === "-S") { o.system = true; o.noPass = true; } else if (x === "-H") o.noHome = true; else if (x === "-u") o.uid = +a[++i]; else if (x === "-G") o.group = a[++i]; else if (x === "-s") o.shell = a[++i]; else if (x === "-h") o.home = a[++i]; else if (x === "-g") o.gecos = a[++i]; else if (/^-[DSH]+$/.test(x)) { if (/D/.test(x)) o.noPass = true; if (/S/.test(x)) { o.system = true; o.noPass = true; } if (/H/.test(x)) o.noHome = true; } else if (!name) name = x; else extra = x; }
      else { if (x === "--system") o.system = true; else if (x === "--disabled-password" || x === "--disabled-login") o.noPass = true; else if (x === "--no-create-home") o.noHome = true; else if (x === "--uid") o.uid = +a[++i]; else if (x === "--gid") o.gid = a[++i]; else if (x === "--ingroup") o.group = a[++i]; else if (x === "--group") o.ownGroup = true; else if (x === "--shell") o.shell = a[++i]; else if (x === "--home") o.home = a[++i]; else if (x === "--gecos" || x === "--comment") o.gecos = a[++i]; else if (x === "--quiet" || x === "-q") o.quiet = true; else if (!name) name = x; else extra = x; }
    }
    if (!name) { errl(io, bb ? "BusyBox v1.36.1 multi-call binary.\n\nUsage: adduser [OPTIONS] USER [GROUP]" : "fatal: Only one or two names allowed."); return 1; }
    if (extra) { var gg = pwRows(fs, "/etc/group").map(function (r) { if (r[0] === extra) { var m = r[3] ? r[3].split(",") : []; if (m.indexOf(name) < 0) m.push(name); r[3] = m.join(","); } return r; }); savePw(fs, "/etc/group", gg); return 0; }
    if (o.gid != null) { var gr = pwRows(fs, "/etc/group").filter(function (r) { return r[2] === String(o.gid) || r[0] === o.gid; })[0]; o.group = gr ? gr[0] : null; if (!gr) { errl(io, "fatal: The group `" + o.gid + "' does not exist."); return 1; } }
    if (!bb && o.ownGroup) { var mg = addGroup(fs, name, o.uid != null && o.system ? o.uid : null, o.system); if (mg.gid != null) o.group = name; }
    if (!bb && !o.noPass && !o.system) {
      var r0 = addUser(fs, { name: name, uid: o.uid, group: o.group, home: o.home, shell: o.shell, gecos: o.gecos, createHome: true });
      if (r0.exists) { errl(io, "fatal: The user `" + name + "' already exists."); return 1; }
      out(io, "info: Adding user `" + name + "' ...\ninfo: Selecting UID/GID from range 1000 to 59999 ...\ninfo: Adding new group `" + name + "' (" + r0.gid + ") ...\ninfo: Adding new user `" + name + "' (" + r0.uid + ") with group `" + name + " (" + r0.gid + ")' ...\ninfo: Creating home directory `/home/" + name + "' ...\ninfo: Copying files from `/etc/skel' ...\nNew password: ");
      errl(io, "passwd: Authentication token manipulation error\npasswd: password unchanged\nTry again? [y/N] fatal: `/usr/bin/passwd " + name + "' returned error code 10. Exiting.");
      return 1;
    }
    var r = addUser(fs, { name: name, uid: o.uid, group: o.group, home: o.home || (o.system && !bb ? "/nonexistent" : null), shell: o.shell || (o.system ? (bb ? "/sbin/nologin" : "/usr/sbin/nologin") : null), gecos: o.gecos, system: o.system, createHome: !o.noHome && !(o.system && !bb) });
    if (r.exists) { errl(io, bb ? "adduser: user '" + name + "' in use" : "fatal: The user `" + name + "' already exists."); return 1; }
    if (r.noGroup) { errl(io, bb ? "adduser: unknown group " + o.group : "fatal: The group `" + o.group + "' does not exist."); return 1; }
    if (!bb && !o.quiet) out(io, "info: Adding " + (o.system ? "system " : "") + "user `" + name + "' (UID " + r.uid + ") ...\ninfo: Adding new user `" + name + "' (UID " + r.uid + ") with group `" + (o.group || name) + "' ...\n" + (o.noHome || o.system ? "info: Not creating `" + (o.home || "/nonexistent") + "'.\n" : "info: Creating home directory `/home/" + name + "' ...\n"));
    return 0;
  };
  CMDS.dkaddgroup = function (args, io, sess) {
    var fs = sess.sys, a = args.slice(1), gid = null, sys = false, name = null, bb = fs.distro === "alpine" || fs.distro === "busybox";
    if (sess.uid !== 0) { errl(io, "addgroup: permission denied (are you root?)"); return 1; }
    for (var i = 0; i < a.length; i++) { var x = a[i]; if (x === "-g" || x === "--gid") gid = +a[++i]; else if (x === "-S" || x === "--system") sys = true; else if (/^-/.test(x)) continue; else if (!name) name = x; else { var g = pwRows(fs, "/etc/group").map(function (r) { if (r[0] === x) { var m = r[3] ? r[3].split(",") : []; m.push(name); r[3] = m.join(","); } return r; }); savePw(fs, "/etc/group", g); return 0; } }
    var r = addGroup(fs, name, gid, sys);
    if (r.exists) { errl(io, bb ? "addgroup: group '" + name + "' in use" : "fatal: The group `" + name + "' already exists."); return 1; }
    if (r.gidTaken) { errl(io, bb ? "addgroup: gid '" + gid + "' in use" : "fatal: The GID `" + gid + "' is already in use."); return 1; }
    if (!bb) out(io, "info: Adding group `" + name + "' (GID " + r.gid + ") ...\n");
    return 0;
  };
  // Debian's useradd (shadow-utils): no home folder unless -m, a group named after the user
  CMDS.dkuseradd = function (args, io, sess) {
    var a = args.slice(1), o = {}, name = null;
    for (var i = 0; i < a.length; i++) {
      var x = a[i], m = /^--(\w[\w-]*)=(.*)$/.exec(x); if (m) { a.splice(i + 1, 0, m[2]); x = "--" + m[1]; }
      if (x === "-u" || x === "--uid") o.uid = +a[++i]; else if (x === "-g" || x === "--gid") o.group = a[++i]; else if (x === "-G" || x === "--groups") o.groups = a[++i];
      else if (x === "-m" || x === "--create-home") o.createHome = true; else if (x === "-M" || x === "--no-create-home") o.createHome = false; else if (x === "-r" || x === "--system") o.system = true;
      else if (x === "-s" || x === "--shell") o.shell = a[++i]; else if (x === "-d" || x === "--home-dir") o.home = a[++i]; else if (x === "-c" || x === "--comment") o.gecos = a[++i]; else if (x === "-N" || x === "--no-user-group" || x === "-U" || x === "--user-group" || x === "-l" || x === "--no-log-init") continue;
      else if (/^-/.test(x)) { errl(io, "useradd: unrecognized option '" + x + "'\nUsage: useradd [options] LOGIN"); return 2; }
      else name = x;
    }
    if (sess.uid !== 0) { errl(io, "useradd: Permission denied.\nuseradd: cannot lock /etc/passwd; try again later."); return 1; }
    if (!name) { errl(io, "Usage: useradd [options] LOGIN"); return 2; }
    if (o.uid != null && pwRows(sess.sys, "/etc/passwd").some(function (r) { return +r[2] === o.uid; })) { errl(io, "useradd: UID " + o.uid + " is not unique"); return 4; }
    var r = addUser(sess.sys, { name: name, uid: o.uid, group: o.group, home: o.home, shell: o.shell, gecos: o.gecos, system: o.system, createHome: !!o.createHome });
    if (r.exists) { errl(io, "useradd: user '" + name + "' already exists"); return 9; }
    if (r.noGroup) { errl(io, "useradd: group '" + o.group + "' does not exist"); return 6; }
    return 0;
  };
  CMDS.dkgroupadd = function (args, io, sess) {
    var a = args.slice(1), gid = null, sys = false, name = null;
    if (sess.uid !== 0) { errl(io, "groupadd: Permission denied.\ngroupadd: cannot lock /etc/group; try again later."); return 10; }
    for (var i = 0; i < a.length; i++) { var x = a[i]; if (x === "-g" || x === "--gid") gid = +a[++i]; else if (x === "-r" || x === "--system") sys = true; else if (/^-/.test(x)) continue; else name = x; }
    var r = addGroup(sess.sys, name, gid, sys);
    if (r.exists) { errl(io, "groupadd: group '" + name + "' already exists"); return 9; }
    if (r.gidTaken) { errl(io, "groupadd: GID '" + gid + "' already exists"); return 4; }
    return 0;
  };

  /* ================================================================== npm and node */
  function readPkg(sess, dir) { var r = S.readFile(sess, dir + "/package.json"); if (r.error) return null; try { return JSON.parse(r.content); } catch (e) { return { bad: true }; } }
  CMDS.dknpm = function (args, io, sess) {
    var a = args.slice(1), op = a.shift(), dir = sess.cwd;
    if (op === "--version" || op === "-v") { out(io, "10.8.2\n"); return 0; }
    var pkg = readPkg(sess, dir);
    if (!pkg && op !== "init") { errl(io, "npm error code ENOENT\nnpm error syscall open\nnpm error path " + dir + "/package.json\nnpm error errno -2\nnpm error enoent Could not read package.json: Error: ENOENT: no such file or directory, open '" + dir + "/package.json'\nnpm error enoent This is related to npm not being able to find a file.\nnpm error enoent\nnpm error A complete log of this run can be found in: /root/.npm/_logs/2026-11-15T09_00_00_000Z-debug-0.log"); return 254; }
    if (pkg && pkg.bad) { errl(io, "npm error code EJSONPARSE\nnpm error JSON.parse Invalid package.json: JSONParseError: Unexpected token in JSON"); return 1; }
    if (op === "ci" || op === "install" || op === "i") {
      if (op === "ci" && !node(sess.sys, dir + "/package-lock.json")) { errl(io, "npm error code EUSAGE\nnpm error\nnpm error The `npm ci` command can only install with an existing package-lock.json or\nnpm error npm-shrinkwrap.json with lockfileVersion >= 1. Run an install with npm@5 or\nnpm error later to generate a package-lock.json file, then try again."); return 1; }
      if (!canWrite(sess, dir)) { errl(io, "npm error code EACCES\nnpm error syscall mkdir\nnpm error path " + dir + "/node_modules\nnpm error errno -13\nnpm error Error: EACCES: permission denied, mkdir '" + dir + "/node_modules'"); return 243; }
      var omitDev = a.indexOf("--omit=dev") >= 0 || a.indexOf("--production") >= 0 || S.getVar(sess, "NODE_ENV") === "production";
      var deps = Object.keys(pkg.dependencies || {}).concat(omitDev ? [] : Object.keys(pkg.devDependencies || {}));
      if (op === "ci") { var nm = node(sess.sys, dir + "/node_modules"); if (nm) { var par = node(sess.sys, dir); delete par.children.node_modules; } }
      var total = 0, count = 0;
      deps.forEach(function (d) { var P = Dk.NPM[d] || { ver: "1.0.0", size: 1 * MB }; total += P.size; count += 1 + Math.round(P.size / (2 * MB)); writeAs(sess, dir + "/node_modules/" + d + "/package.json", JSON.stringify({ name: d, version: P.ver }) + "\n", 420, P.size); if (P.bin) binFile(sess, dir + "/node_modules/.bin/" + P.bin, "dk" + P.bin); });
      if (op !== "ci" && !node(sess.sys, dir + "/package-lock.json")) writeAs(sess, dir + "/package-lock.json", JSON.stringify({ name: pkg.name, lockfileVersion: 3, packages: {} }, null, 2) + "\n");
      out(io, "\nadded " + count + " packages, and audited " + (count + 1) + " packages in " + Math.max(2, Math.round(total / 30e6)) + "s\n\n" + Math.round(count / 4) + " packages are looking for funding\n  run `npm fund` for details\n\nfound 0 vulnerabilities\n");
      if (sess.uid === 0 && op === "install" && !sess.sys.inBuild) { /* fine */ }
      addTime(sess, 3 + total / 20e6);
      return 0;
    }
    if (op === "run" || op === "run-script" || op === "test" || op === "start") {
      var name = op === "test" || op === "start" ? op : a[0];
      var script = (pkg.scripts || {})[name];
      if (!name) { out(io, "Lifecycle scripts included in " + pkg.name + "@" + pkg.version + ":\n" + Object.keys(pkg.scripts || {}).map(function (k) { return "  " + k + "\n    " + pkg.scripts[k] + "\n"; }).join("")); return 0; }
      if (!script) { errl(io, "npm error Missing script: \"" + name + "\"\nnpm error\nnpm error To see a list of scripts, run:\nnpm error   npm run"); return 1; }
      out(io, "\n> " + pkg.name + "@" + pkg.version + " " + name + "\n> " + script + "\n\n");
      if (/^vite build/.test(script)) {
        if (!node(sess.sys, dir + "/node_modules/vite")) { errl(io, "sh: vite: not found"); return 127; }
        var src = M2.rd(sess.sys, dir + "/index.html") || "<!doctype html>\n<title>app</title>\n";
        var js = "", srcDir = node(sess.sys, dir + "/src");
        if (srcDir) Object.keys(srcDir.children).forEach(function (k) { if (srcDir.children[k].type === "f") js += srcDir.children[k].content; });
        var h = M2.hexOf(js, 8);
        writeAs(sess, dir + "/dist/index.html", src.replace(/<script[^>]*src="[^"]*"[^>]*><\/script>/, "<script type=\"module\" crossorigin src=\"/assets/index-" + h + ".js\"></script>"));
        writeAs(sess, dir + "/dist/assets/index-" + h + ".js", "/* built by vite */\n" + js.slice(0, 200), 420, 143 * KB);
        writeAs(sess, dir + "/dist/assets/index-" + h.slice(0, 6) + "Xa.css", "body{margin:0}\n", 420, 1.4 * KB);
        out(io, "vite v5.4.10 building for production...\ntransforming...\n✓ 34 modules transformed.\nrendering chunks...\ncomputing gzip size...\ndist/index.html                   0.46 kB │ gzip:  0.30 kB\ndist/assets/index-" + h.slice(0, 6) + "Xa.css    1.39 kB │ gzip:  0.72 kB\ndist/assets/index-" + h + ".js   143.36 kB │ gzip: 46.11 kB\n✓ built in 812ms\n");
        addTime(sess, 4.2);
        return 0;
      }
      if (/vitest|node --test|jest/.test(script)) { out(io, " ✓ src/status.test.js (4 tests) 6ms\n\n Test Files  1 passed (1)\n      Tests  4 passed (4)\n"); return 0; }
      return S.runCommand(sess, ["/bin/sh", "-c", script], io);
    }
    errl(io, "npm error Unknown command: \"" + op + "\""); return 1;
  };
  CMDS.dknode = function (args, io) { if (args[1] === "--version" || args[1] === "-v") { out(io, "v20.18.0\n"); return 0; } if (args[1] === "-e") return 0; U.note(io, "(node scripts that start servers belong in the container's CMD.)"); return 0; };
  CMDS.dkvite = function (args, io) { errl(io, "(use npm run build)"); return 1; };

  /* ================================================================== PostgreSQL client tools */
  function pgTarget(sess, a) {
    var o = { host: null, port: 5432, user: S.getVar(sess, "PGUSER") || "postgres", db: null, cmd: null, tuples: false };
    for (var i = 0; i < a.length; i++) { var x = a[i]; if (x === "-h" || x === "--host") o.host = a[++i]; else if (x === "-p" || x === "--port") o.port = +a[++i]; else if (x === "-U" || x === "--username") o.user = a[++i]; else if (x === "-d" || x === "--dbname") o.db = a[++i]; else if (x === "-c" || x === "--command") o.cmd = a[++i]; else if (x === "-t" || x === "-tA" || x === "-At") o.tuples = true; else if (x === "-q") o.quiet = true; else if (!/^-/.test(x) && !o.db) o.db = x; }
    o.db = o.db || o.user;
    return o;
  }
  CMDS.dkpgisready = function (args, io, sess) {
    var c = ctx(sess), o = pgTarget(sess, args.slice(1)), label = (o.host || "/var/run/postgresql") + ":" + o.port, q = args.indexOf("-q") > 0;
    if (!c.c) { if (!q) out(io, label + " - no response\n"); return 2; }
    var cn = Dk.connect(c.host, c.c, o.host || "localhost", o.port);
    if (cn.ok && cn.app.pg) { if (!q) out(io, label + " - accepting connections\n"); return 0; }
    if (cn.starting) { if (!q) out(io, label + " - rejecting connections\n"); return 1; }
    if (!q) out(io, label + " - no response\n"); return 2;
  };
  function pgTable(cols, rows) {
    var w = cols.map(function (c, i) { return Math.max(c.length, rows.reduce(function (m, r) { return Math.max(m, String(r[i]).length); }, 0)); });
    return " " + cols.map(function (c, i) { var p = w[i] - c.length; return new Array(Math.floor(p / 2) + 1).join(" ") + c + new Array(Math.ceil(p / 2) + 1).join(" "); }).join(" | ") + "\n" + w.map(function (n) { return new Array(n + 3).join("-"); }).join("+") + "\n" + rows.map(function (r) { return " " + r.map(function (v, i) { return typeof v === "number" ? (new Array(w[i] + 1).join(" ") + v).slice(-w[i]) : (v + new Array(w[i] + 1).join(" ")).slice(0, w[i]); }).join(" | "); }).join("\n") + (rows.length ? "\n" : "") + "(" + rows.length + " row" + (rows.length === 1 ? "" : "s") + ")\n\n";
  }
  CMDS.dkpsql = function (args, io, sess) {
    var c = ctx(sess), o = pgTarget(sess, args.slice(1));
    if (!c.c) { errl(io, "psql: error: connection to server on socket \"/var/run/postgresql/.s.PGSQL.5432\" failed: No such file or directory"); return 2; }
    var local = !o.host, cn = Dk.connect(c.host, c.c, o.host || "localhost", o.port);
    if (!cn.ok) { errl(io, local ? "psql: error: connection to server on socket \"/var/run/postgresql/.s.PGSQL.5432\" failed: " + (cn.starting ? "FATAL:  the database system is starting up" : "No such file or directory\n\tIs the server running locally and accepting connections on that socket?") : cn.why === "dns" ? "psql: error: could not translate host name \"" + o.host + "\" to address: Name or service not known" : "psql: error: connection to server at \"" + o.host + "\", port " + o.port + " failed: Connection refused\n\tIs the server running on that host and accepting TCP/IP connections?"); return 2; }
    var pg = cn.app.pg, st = pg.store(c.host, cn.ctr);
    if (!(o.user in st.users)) { errl(io, "psql: error: connection to server " + (local ? "on socket \"/var/run/postgresql/.s.PGSQL.5432\"" : "at \"" + o.host + "\", port " + o.port) + " failed: FATAL:  role \"" + o.user + "\" does not exist"); return 2; }
    if (!local && st.users[o.user] !== (S.getVar(sess, "PGPASSWORD") || "")) { errl(io, "psql: error: connection to server at \"" + o.host + "\", port " + o.port + " failed: " + (S.getVar(sess, "PGPASSWORD") ? "FATAL:  password authentication failed for user \"" + o.user + "\"" : "fe_sendauth: no password supplied")); return 2; }
    if (!st.dbs[o.db]) { errl(io, "psql: error: connection to server failed: FATAL:  database \"" + o.db + "\" does not exist"); return 2; }
    if (!o.cmd) { U.note(io, "(psql's interactive prompt isn't available here: run a query with -c \"SELECT ...\")"); return 0; }
    var sql = o.cmd.trim().replace(/;$/, ""), m, tables = st.dbs[o.db].tables;
    if (sql === "\\l") { out(io, pgTable(["Name", "Owner", "Encoding"], Object.keys(st.dbs).sort().map(function (d) { return [d, st.dbs[d].owner, "UTF8"]; }))); return 0; }
    if (sql === "\\dt") { var ts = Object.keys(tables).sort(); if (!ts.length) { errl(io, "Did not find any relations."); return 0; } out(io, "          List of relations\n" + pgTable(["Schema", "Name", "Type", "Owner"], ts.map(function (t) { return ["public", t, "table", st.dbs[o.db].owner]; }))); return 0; }
    if (/^select\s+1$/i.test(sql)) { out(io, o.tuples ? "1\n" : pgTable(["?column?"], [[1]])); return 0; }
    if ((m = /^select\s+count\(\*\)\s+from\s+(\w+)$/i.exec(sql))) { if (!tables[m[1]]) { errl(io, "ERROR:  relation \"" + m[1] + "\" does not exist\nLINE 1: " + o.cmd); return 1; } out(io, o.tuples ? tables[m[1]].length + "\n" : pgTable(["count"], [[tables[m[1]].length]])); return 0; }
    if ((m = /^select\s+(.+?)\s+from\s+(\w+)(?:\s+where\s+(\w+)\s*=\s*'?([^']*)'?)?(?:\s+order by\s+\w+)?$/i.exec(sql))) {
      var t = tables[m[2]]; if (!t) { errl(io, "ERROR:  relation \"" + m[2] + "\" does not exist\nLINE 1: " + o.cmd); return 1; }
      var rows = t.filter(function (r) { return !m[3] || String(r[m[3]]) === m[4]; });
      var cols = m[1] === "*" ? Object.keys(t[0] || { id: 0 }) : m[1].split(",").map(function (s) { return s.trim(); });
      out(io, o.tuples ? rows.map(function (r) { return cols.map(function (k) { return r[k]; }).join("|") + "\n"; }).join("") : pgTable(cols, rows.map(function (r) { return cols.map(function (k) { return r[k] == null ? "" : r[k]; }); })));
      return 0;
    }
    errl(io, "(This lab's psql understands \\l, \\dt, SELECT 1, SELECT count(*) FROM t and SELECT cols FROM t [WHERE col = value].)"); return 1;
  };
  CMDS.dkpgdump = function (args, io) { out(io, "--\n-- PostgreSQL database dump\n--\n\nSET statement_timeout = 0;\n"); return 0; };

  /* ================================================================== redis-cli */
  CMDS.dkrediscli = function (args, io, sess) {
    var c = ctx(sess), a = args.slice(1), host = "127.0.0.1", port = 6379, pass = null, rest = [];
    for (var i = 0; i < a.length; i++) { var x = a[i]; if (x === "-h") host = a[++i]; else if (x === "-p") port = +a[++i]; else if (x === "-a") pass = a[++i]; else if (x === "--no-auth-warning" || x === "--raw") continue; else rest.push(x); }
    if (pass) errl(io, "Warning: Using a password with '-a' or '-u' option on the command line interface may not be safe.");
    if (!c.c) { errl(io, "Could not connect to Redis at " + host + ":" + port + ": Connection refused"); return 1; }
    var cn = Dk.connect(c.host, c.c, host === "127.0.0.1" ? "localhost" : host, port);
    if (!cn.ok) { errl(io, "Could not connect to Redis at " + host + ":" + port + ": " + (cn.why === "dns" ? "Name or service not known" : "Connection refused")); return 1; }
    if (!cn.app.redis) { errl(io, "Error: Protocol error, got \"H\" as reply type byte"); return 1; }
    if (!rest.length) { U.note(io, "(redis-cli's prompt isn't available here: give the command, e.g. redis-cli ping)"); return 0; }
    if (cn.app.redis.pass && cn.app.redis.pass !== pass && String(rest[0]).toUpperCase() !== "AUTH") { out(io, "(error) NOAUTH Authentication required.\n"); return 0; }
    var r = cn.app.redis.cmd(rest);
    if (r && r.error) out(io, "(error) " + r.error + "\n");
    else if (r === null) out(io, "(nil)\n");
    else if (typeof r === "number") out(io, "(integer) " + r + "\n");
    else if (Array.isArray(r)) out(io, r.length ? r.map(function (v, k) { return (k + 1) + ") \"" + v + "\"\n"; }).join("") : "(empty array)\n");
    else out(io, (r === "PONG" || r === "OK" || /^#/.test(r) ? r : "\"" + r + "\"") + "\n");
    return 0;
  };

  /* ================================================================== odds and ends */
  CMDS.dknginx = function (args, io, sess) {
    var a = args.slice(1);
    if (a[0] === "-v" || a[0] === "-V") { errl(io, "nginx version: nginx/1.27.2"); return 0; }
    if (a[0] === "-t" || a[0] === "-T") {
      var servers = Dk.ngxConf(sess.sys), c = ctx(sess);
      for (var i = 0; c.c && i < servers.length; i++) for (var k = 0; k < servers[i].locs.length; k++) { var px = servers[i].locs[k].proxy; if (px && !/^\d/.test(px.host) && !Dk.resolveFrom(c.host, c.c, px.host)) { errl(io, "nginx: [emerg] host not found in upstream \"" + px.host + "\" in /etc/nginx/conf.d/" + px.file + ":" + px.line + "\nnginx: configuration file /etc/nginx/nginx.conf test failed"); return 1; } }
      errl(io, "nginx: the configuration file /etc/nginx/nginx.conf syntax is ok\nnginx: configuration file /etc/nginx/nginx.conf test is successful"); return 0;
    }
    if (a[0] === "-s") { var c2 = ctx(sess); if (c2.c) Dk.logLine(c2.host, c2.c, "err", Dk.dt(c2.host, null, "ngerr") + " [notice] 1#1: signal 1 (SIGHUP) received from 51, reconfiguring"); return 0; }
    U.note(io, "(nginx is already running as this container's main process.)"); return 0;
  };
  CMDS.dkhello = function (args, io) { out(io, "\nHello from Docker!\nThis message shows that your installation appears to be working correctly.\n"); return 0; };
  CMDS.dkworker = function (args, io, sess) { var v = (M2.rd(sess.sys, "/etc/kestrel-version") || "0.0.0").trim(); if (args[1] === "--version" || args[1] === "-v") { out(io, "kestrel-worker " + v + "\n"); return 0; } U.note(io, "(the worker is this container's main process.)"); return 0; };
  CMDS.dkpostgres = function (args, io) { if (args[1] === "--version" || args[1] === "-V") { out(io, "postgres (PostgreSQL) 16.4\n"); return 0; } errl(io, "\"root\" execution of the PostgreSQL server is not permitted.\nThe server must be started under an unprivileged user ID to prevent\npossible system security compromise."); return 1; };
  CMDS.dkredis = function (args, io) { out(io, "Redis server v=7.4.1 sha=00000000:0 malloc=jemalloc-5.3.0 bits=64\n"); return 0; };
  CMDS.busybox = function (args, io) { out(io, "BusyBox v1.36.1 (2024-06-10 07:11:47 UTC) multi-call binary.\nBusyBox is copyrighted by many authors between 1998-2015.\n\nUsage: busybox [function [arguments]...]\n"); return 0; };
  CMDS.dkgcc = function (args, io) { if (args[1] === "--version") { out(io, "gcc (Debian 12.2.0-14) 12.2.0\n"); return 0; } return 0; };
  CMDS.dkmake = function (args, io) { out(io, "make: *** No targets specified and no makefile found.  Stop.\n"); return 2; };
  CMDS.dkgit = function (args, io) { if (args[1] === "--version") { out(io, "git version 2.39.5\n"); return 0; } if (args[1] === "clone") { out(io, "Cloning into '" + (args[3] || String(args[2] || "repo").split("/").pop().replace(/\.git$/, "")) + "'...\n"); return 0; } return 0; };
  CMDS.dkssh = function (args, io) { errl(io, "ssh: Could not resolve hostname " + (args[1] || "") + ": Name or service not known"); return 255; };
  CMDS.dkperl = function (args, io) { if (args[1] === "-v") out(io, "\nThis is perl 5, version 36, subversion 0 (v5.36.0) built for x86_64-linux-gnu-thread-multi\n"); return 0; };
  CMDS.dkpgconfig = function (args, io) { out(io, "/usr/lib/postgresql/15/bin\n"); return 0; };
  CMDS.dktini = function (args, io, sess) { var a = args.slice(1); if (a[0] === "--") a.shift(); if (a[0] === "--version") { out(io, "tini version 0.19.0\n"); return 0; } return a.length ? S.runCommand(sess, a, io) : 0; };
  CMDS.dkping = function (args, io, sess) {
    var c = ctx(sess), h = args.filter(function (x, i) { return i > 0 && !/^-/.test(x) && !/^\d+$/.test(args[i - 1] === "-c" ? "" : "x"); }).pop();
    var r = c.c && Dk.resolveFrom(c.host, c.c, h);
    if (!r) { errl(io, "ping: bad address '" + h + "'"); return 1; }
    var ip = r.self ? "127.0.0.1" : (r.ctr.nets[0] || {}).ip;
    out(io, "PING " + h + " (" + ip + "): 56 data bytes\n64 bytes from " + ip + ": seq=0 ttl=64 time=0.081 ms\n\n--- " + h + " ping statistics ---\n1 packets transmitted, 1 packets received, 0% packet loss\nround-trip min/avg/max = 0.081/0.081/0.081 ms\n");
    return 0;
  };
})(typeof window !== "undefined" ? window : globalThis);
