/* sudo learn — DevOps track, Module 2: the CI toolchain. It sits on top of the Git track's simulated GitHub and
   Actions runners (github.js, actions.js, gitsec.js) and Module 1's Docker engine (dk-*.js):
   - ghcr.io: GitHub's container registry, authenticated with GitHub tokens (a job's GITHUB_TOKEN needs
     `packages: write` to push), shared by the laptop, every runner and every build agent;
   - runners get Docker, a real Python toolchain (actions/setup-python with `cache: pip`), and a Python QA kit:
     pytest (+ pytest-cov) that really evaluates simple Flask tests against the app's routes, ruff and semgrep;
   - the actions people use to ship images: docker/login, setup-buildx, metadata, build-push (with the GitHub
     Actions layer cache), aquasecurity/trivy-action, gitleaks, sigstore/cosign-installer, anchore/sbom-action,
     actions/attest-build-provenance; and the cosign, syft and `gh attestation` CLIs. */
(function (root) {
  "use strict";
  var S = root.ShEngine, M2 = S.M2, CMDS = S.CMDS, U = S.util, Dk = root.Dk, GH = root.GitHub, A = root.GitActions, G = root.GitCore;
  var out = U.out, errl = U.errl, note = U.note;
  var CI = root.CI = root.CI || {};
  function keys(o) { return o ? Object.keys(o) : []; }
  function hubOf(sys) { return sys.github || (sys.hubSys && sys.hubSys.github) || (sys.dkHost && (sys.dkHost.github || (sys.dkHost.hubSys && sys.dkHost.hubSys.github))) || GH.hub(sys); }
  function homeSys(sys) { return sys.hubSys || (sys.dkHost && sys.dkHost.hubSys) || sys.dkHost || sys; }
  CI.hubOf = hubOf; CI.homeSys = homeSys;
  function now(sys) { return G.clock(homeSys(sys)); }
  function node(sys, p) { return Dk.fsNode(sys, p); }
  function rd(sys, p) { var n = node(sys, p); return n && n.type === "f" ? n.content : null; }
  function abs(sess, p) { return Dk.absHost(sess, p); }

  /* ================================================================== ghcr.io: GitHub tokens as registry passwords */
  Dk.registryAuth["ghcr.io"] = {
    login: function (sess, user, pass) { var t = hubOf(sess.sys).tokens[pass]; return !!t && !t.revoked && (!t.expires || t.expires > now(sess.sys)); },
    access: function (sess, p, push, cred) {
      var tag = p.tag || p.digest, h = hubOf(sess.sys), owner = p.repo.split("/")[0];
      if (!cred) return push ? "unauthorized: unauthenticated: User cannot be authenticated with the token provided." : "Error response from daemon: Head \"https://ghcr.io/v2/" + p.repo + "/manifests/" + tag + "\": unauthorized";
      var t = h.tokens[cred.pass];
      if (!t || t.revoked || (t.expires && t.expires <= now(sess.sys))) return push ? "unauthorized: unauthenticated: User cannot be authenticated with the token provided." : "Error response from daemon: Head \"https://ghcr.io/v2/" + p.repo + "/manifests/" + tag + "\": unauthorized";
      if (t.bot) {
        var perm = (t.bot.perms || {}).packages;
        if (t.bot.repo.split("/")[0].toLowerCase() !== owner.toLowerCase()) return push ? "denied: installation not allowed to Write organization package" : "Error response from daemon: Head \"https://ghcr.io/v2/" + p.repo + "/manifests/" + tag + "\": denied";
        if (push && perm !== "write") return "denied: installation not allowed to Write organization package";
        if (!push && !perm) return "Error response from daemon: Head \"https://ghcr.io/v2/" + p.repo + "/manifests/" + tag + "\": denied";
        return null;
      }
      var org = h.orgs[owner], member = owner === t.login || (org && org.members[t.login]);
      var sc = t.scopes || [];
      if (!member) return push ? "denied: permission_denied: The requested installation does not exist." : "Error response from daemon: Head \"https://ghcr.io/v2/" + p.repo + "/manifests/" + tag + "\": denied";
      if (push && sc.indexOf("write:packages") < 0) return "denied: permission_denied: The token provided does not match expected scopes.";
      if (!push && sc.indexOf("read:packages") < 0 && sc.indexOf("write:packages") < 0) return "Error response from daemon: Head \"https://ghcr.io/v2/" + p.repo + "/manifests/" + tag + "\": denied: denied";
      return null;
    }
  };
  function regOf(sys, name) { return Dk.state(sys).regs[name]; }
  CI.regOf = regOf;
  // Resolve an image reference in its registry (no auth): {img, digest, p}
  function resolveRemote(sys, ref) { var p = Dk.parseRef(ref), hit = Dk.regLookup(sys, p); return hit ? { img: hit.img, digest: hit.digest, p: p } : null; }
  CI.resolveRemote = resolveRemote;

  /* ================================================================== runners: Docker, Python, timing */
  function putBin(sys, p, impl, mode) { S.put(sys, p, "\x7fELF:" + impl + " (simulated binary)\n", mode || 493, 0, 0).size = 30e6; }
  CI.putBin = putBin;
  A.envHooks.push(function (J) {
    var rs = J.rs;
    if (rs.ciInit) return;
    rs.ciInit = true;
    putBin(rs, "/usr/bin/docker", "docker");
    putBin(rs, "/usr/bin/python3", "dkpython");
    S.put(rs, "/usr/lib/python3.12/os.py", "# python 3.12 stdlib\n", 420, 0, 0);
    S.mkdirs(rs, "/usr/lib/python3/dist-packages");
    S.mkdirs(rs, "/var/lib/docker/volumes", 456, 0, 0);
  });
  // How long a run: step took also counts builds, installs and tests it ran (actions.js adds J.lastExecSecs)
  var execOrig = A.Job.prototype.exec;
  A.Job.prototype.exec = function () {
    var rs = this.rs, b0 = rs.buildSecs || 0, t0 = rs.dk ? rs.dk.t : 0;
    var code = execOrig.apply(this, arguments);
    this.lastExecSecs = Math.max(0, (rs.buildSecs || 0) - b0) + Math.max(0, (rs.dk ? rs.dk.t : 0) - t0);
    return code;
  };

  // actions/setup-python with a real interpreter (Module 1's dkpython/dkpip) and `cache: pip`
  var PY = { "3.9": "3.9.20", "3.10": "3.10.15", "3.11": "3.11.10", "3.12": "3.12.7", "3.13": "3.13.0" };
  function hashFilesIn(J, re) {
    var files = [];
    (function walk(dir, rel) { var n = node(J.rs, dir); if (!n || n.type !== "d") return; keys(n.children).sort().forEach(function (k) { var c = n.children[k], p = rel ? rel + "/" + k : k; if (c.type === "d") { if (!/^(\.git|node_modules|venv|\.venv)$/.test(k)) walk(dir + "/" + k, p); } else if (re.test(p)) files.push(c.content); }); })(J.ws, "");
    return files.length ? M2.sha256(files.join("\0")) : null;
  }
  A.action("actions/setup-python", {
    run: function (J, s, w) {
      var spec = String(w["python-version"] || "3.12").trim(), m = /^(\d+\.\d+)(?:\.(\d+|x))?$/.exec(spec), ver = m && PY[m[1]] ? (m[2] && /^\d+$/.test(m[2]) ? spec : PY[m[1]]) : null;
      if (!ver) { J.log(s, "##[group]Installed versions\nVersion " + spec + " was not found in the local cache\n##[endgroup]\n##[error]The version '" + spec + "' with architecture 'x64' was not found for Ubuntu 24.04.\nThe list of all available versions can be found here: https://raw.githubusercontent.com/actions/python-versions/main/versions-manifest.json"); J.annotate("error", "The version '" + spec + "' with architecture 'x64' was not found for Ubuntu 24.04."); return { code: 1, secs: 2 }; }
      var mm = ver.split(".").slice(0, 2).join("."), pre = "/opt/hostedtoolcache/Python/" + ver + "/x64", rs = J.rs;
      ["python", "python3", "python" + mm].forEach(function (b) { S.put(rs, pre + "/bin/" + b, "\x7fELF:dkpython (simulated binary)\n", 493, 1001, 1001); });
      ["pip", "pip3", "pip" + mm].forEach(function (b) { S.put(rs, pre + "/bin/" + b, "\x7fELF:dkpip (simulated binary)\n", 493, 1001, 1001); });
      S.put(rs, pre + "/lib/python" + mm + "/os.py", "# stdlib\n", 420, 1001, 1001);
      S.put(rs, pre + "/lib/python" + mm + "/site-packages/pip-24.3.1.dist-info/METADATA", "Metadata-Version: 2.1\nName: pip\nVersion: 24.3.1\n", 420, 1001, 1001);
      S.put(rs, pre + "/lib/python" + mm + "/site-packages/pip/__init__.py", "", 420, 1001, 1001);
      (function own(n) { if (!n) return; n.uid = 1001; n.gid = 1001; keys(n.children || {}).forEach(function (k) { own(n.children[k]); }); })(node(rs, "/opt/hostedtoolcache/Python"));
      J.pathAdd.push(pre + "/bin");
      J.log(s, "##[group]Installed versions\nSuccessfully set up CPython (" + ver + ")\n##[endgroup]");
      var res = { code: 0, secs: 2, outputs: { "python-version": ver, "python-path": pre + "/bin/python" } };
      if (String(w.cache || "") === "pip") {
        var h = hashFilesIn(J, new RegExp(String(w["cache-dependency-path"] || "").trim() ? String(w["cache-dependency-path"]).replace(/[.]/g, "\\.").replace(/\*\*\//g, "(.*/)?").replace(/\*/g, "[^/]*") + "$" : "(^|/)requirements[^/]*\\.txt$"));
        if (!h) { J.log(s, "##[error]No file in " + J.ws + " matched to [**/requirements.txt or **/pyproject.toml], make sure you have checked out the target repository"); J.annotate("error", "No file in " + J.ws + " matched to [**/requirements.txt or **/pyproject.toml], make sure you have checked out the target repository"); return { code: 1, secs: 2 }; }
        var key = "setup-python-Linux-x64-24.04-Ubuntu-python-" + ver + "-pip-" + h, c = J.r.caches[key];
        J.log(s, "##[group]Restore cache\n[command]/opt/hostedtoolcache/Python/" + ver + "/x64/bin/pip cache dir\n/home/runner/.cache/pip");
        if (c) {
          S.put(rs, "/home/runner/.cache/pip/kc-wheels.json", JSON.stringify(c.wheels || []), 420, 1001, 1001);
          J.log(s, "Received " + Math.round(c.size / 1024) + " of " + Math.round(c.size / 1024) + " (100.0%), " + (c.size / 1048576).toFixed(1) + " MBs/sec\nCache Size: ~" + Math.max(1, Math.round(c.size / 1048576)) + " MB (" + c.size + " B)\nCache restored successfully\nCache restored from key: " + key + "\n##[endgroup]");
          c.lastUsed = now(J.sys);
          J.pipCacheHit = true;
        } else {
          J.log(s, "pip cache is not found\n##[endgroup]");
          res.post = function (J2, s2) {
            var wl = rd(J2.rs, "/home/runner/.cache/pip/kc-wheels.json"); var wheels = []; try { wheels = JSON.parse(wl || "[]"); } catch (e) { wheels = []; }
            if (!wheels.length) { J2.log(s2, "##[warning]Cache folder path is retrieved for pip but doesn't exist on disk: /home/runner/.cache/pip. This likely indicates that there are no dependencies to cache. Consider removing the cache step if it is not needed."); return { code: 0 }; }
            var size = wheels.reduce(function (t, x) { return t + (x.size || 0); }, 0);
            J2.r.caches[key] = { files: {}, wheels: wheels, size: Math.max(1, Math.round(size)), created: now(J2.sys) + J2.secs + J2.run.id % 7, ref: J2.run.ref };
            J2.log(s2, "Cache Size: ~" + Math.max(1, Math.round(size / 1048576)) + " MB (" + Math.round(size) + " B)\nCache saved with the key: " + key);
            return { code: 0, secs: 1 };
          };
        }
      }
      return res;
    }
  });
  // pip remembers what it downloaded (for actions/setup-python's cache) and uses the cache when it's there
  var pipOrig = CMDS.dkpip;
  CMDS.dkpip = function (args, io, sess) {
    var fs = sess.sys, idxp = sess.home + "/.cache/pip/kc-wheels.json", before = [];
    try { before = JSON.parse(rd(fs, idxp) || "[]"); } catch (e) { before = []; }
    var capLines = [], io2 = Object.assign({}, io, { out: function (t) { capLines.push(["o", t]); }, err: function (t) { capLines.push(["e", t]); } });
    var code = pipOrig(args, io2, sess);
    var text = capLines.map(function (x) { return x[0] === "o" ? x[1] : "\u0000E" + x[1] + "\u0000"; }).join(""), have = {}; before.forEach(function (w) { have[w.name + "-" + w.ver] = true; });
    var noCache = args.indexOf("--no-cache-dir") >= 0, got = [];
    text = text.replace(/^Downloading ([\w.-]+)-([\w.]+)-py3-none-any\.whl \(([^)]*)\)\n/gm, function (m0, n, v, sz) {
      if (have[n + "-" + v]) return "Using cached " + n + "-" + v + "-py3-none-any.whl (" + sz + ")\n";
      got.push({ name: n, ver: v, size: ((Dk.PIP[Dk.pipNorm(n)] || { versions: {} }).versions[v] || { size: 1e5 }).size / 2.4 });
      return m0;
    });
    if (got.length && !noCache) { S.mkdirs(fs, sess.home + "/.cache/pip", 493, sess.uid, sess.gid); S.put(fs, idxp, JSON.stringify(before.concat(got)), 420, sess.uid, sess.gid); }
    if (before.length && fs.buildSecs) fs.buildSecs = Math.max(0, fs.buildSecs - before.length * 0.7);
    text.split(/(\u0000E[\s\S]*?\u0000)/).forEach(function (part) { if (!part) return; if (part.charAt(0) === "\u0000") errl(io, part.slice(2, -1).replace(/\n$/, "")); else out(io, part); });
    return code;
  };

  /* ================================================================== Python QA tools */
  var MB = Dk.MB;
  function pkg(name, mod, latest, versions, bin) { Dk.PIP[name] = { name: name, mod: mod, latest: latest, versions: versions, bin: bin }; }
  pkg("pytest", "pytest", "8.3.3", { "8.3.3": { deps: [["packaging", "24.2"], ["pluggy", "1.5.0"], ["iniconfig", "2.0.0"]], size: 1.4 * MB } }, "dkpytest");
  pkg("pluggy", "pluggy", "1.5.0", { "1.5.0": { deps: [], size: 0.1 * MB } });
  pkg("iniconfig", "iniconfig", "2.0.0", { "2.0.0": { deps: [], size: 0.02 * MB } });
  pkg("pytest-cov", "pytest_cov", "6.0.0", { "6.0.0": { deps: [["pytest", "8.3.3"], ["coverage", "7.6.4"]], size: 0.1 * MB } });
  pkg("coverage", "coverage", "7.6.4", { "7.6.4": { deps: [], size: 0.9 * MB } }, "dkcoverage");
  pkg("ruff", "ruff", "0.7.4", { "0.7.4": { deps: [], size: 25 * MB } }, "dkruff");
  pkg("semgrep", "semgrep", "1.95.0", { "1.95.0": { deps: [["click", "8.1.8"], ["requests", "2.32.4"]], size: 54 * MB } }, "dksemgrep");
  Dk.PIP.gunicorn.bin = "dkgunicorn"; Dk.PIP.flask.bin = "dkflask";
  // console scripts for every package that has one
  var pipCore = CMDS.dkpip;
  CMDS.dkpip = function (args, io, sess) {
    var code = pipCore(args, io, sess);
    if (code === 0 && args[1] === "install") {
      var pipPath = (S.resolveCommand(sess, args[0]) || {}).path || "/usr/local/bin/pip";
      var m = /^(.*)\/bin\/pip[\d.]*$/.exec(pipPath), prefix = m ? m[1] : "/usr/local";
      if (args.indexOf("--user") >= 0) prefix = sess.home + "/.local";
      var pi = args.indexOf("--prefix"); if (pi > 0) prefix = abs(sess, args[pi + 1]);
      var lib = node(sess.sys, prefix + "/lib"), py = lib && keys(lib.children).filter(function (k) { return /^python3/.test(k); })[0];
      var site = py ? prefix + "/lib/" + py + "/site-packages" : null;
      var inst = site ? Dk.installedIn(sess.sys, site) : {};
      keys(inst).forEach(function (n) { var P = Dk.PIP[n]; if (P && P.bin && !node(sess.sys, prefix + "/bin/" + n)) { S.mkdirs(sess.sys, prefix + "/bin", 493, sess.uid, sess.gid); S.put(sess.sys, prefix + "/bin/" + n, "\x7fELF:" + P.bin + " (simulated binary)\n", 493, sess.uid, sess.gid); } });
    }
    return code;
  };

  /* ---------------- a Python reader just big enough for small Flask apps and their tests */
  var PyL = CI.Py = {};
  // split source into logical statements (joining bracketed continuation lines)
  function statements(src) {
    var L = String(src).replace(/\r/g, "").split("\n"), outS = [], cur = null, depth = 0, inStr = null;
    L.forEach(function (raw, i) {
      var t = raw.replace(/\s+$/, "");
      if (cur === null) {
        if (!t.trim() || /^\s*#/.test(t)) return;
        cur = { line: i + 1, end: i + 1, indent: /^ */.exec(t)[0].length, text: t.trim() };
      } else { cur.text += " " + t.trim(); cur.end = i + 1; }
      for (var k = 0; k < t.length; k++) {
        var ch = t.charAt(k);
        if (inStr) { if (ch === "\\") { k++; continue; } if (t.substr(k, inStr.length) === inStr) { k += inStr.length - 1; inStr = null; } continue; }
        if (ch === "#") break;
        if (t.substr(k, 3) === "\"\"\"" || t.substr(k, 3) === "'''") { inStr = t.substr(k, 3); k += 2; continue; }
        if (ch === "\"" || ch === "'") { inStr = ch; continue; }
        if ("([{".indexOf(ch) >= 0) depth++; else if (")]}".indexOf(ch) >= 0) depth--;
      }
      if (inStr && inStr.length === 1) inStr = null;
      if (depth <= 0 && !inStr && !/\\$/.test(t)) { outS.push(cur); cur = null; depth = 0; }
    });
    if (cur) outS.push(cur);
    return outS;
  }
  PyL.statements = statements;
  function stripComment(t) { var q = null; for (var i = 0; i < t.length; i++) { var c = t.charAt(i); if (q) { if (c === "\\") { i++; continue; } if (c === q) q = null; continue; } if (c === "\"" || c === "'") { q = c; continue; } if (c === "#") return t.slice(0, i).replace(/\s+$/, ""); } return t; }
  var DYN = { dynamic: true };
  // Parse a Python literal (or a name from consts). Returns a value or DYN.
  function literal(src, consts) {
    var s = String(src).trim(), i = 0;
    function ws() { while (i < s.length && /\s/.test(s.charAt(i))) i++; }
    function val() {
      ws();
      var c = s.charAt(i), m;
      if (c === "{") { i++; var o = {}; ws(); if (s.charAt(i) === "}") { i++; return o; } for (;;) { var k = val(); ws(); if (s.charAt(i) !== ":") throw 0; i++; o[String(k)] = val(); ws(); if (s.charAt(i) === ",") { i++; ws(); if (s.charAt(i) === "}") { i++; return o; } continue; } if (s.charAt(i) === "}") { i++; return o; } throw 0; } }
      if (c === "[" || c === "(") { var close = c === "[" ? "]" : ")"; i++; var a = []; ws(); if (s.charAt(i) === close) { i++; return a; } for (;;) { a.push(val()); ws(); if (s.charAt(i) === ",") { i++; ws(); if (s.charAt(i) === close) { i++; return a; } continue; } if (s.charAt(i) === close) { i++; return a; } throw 0; } }
      if ((m = /^([rbuf]?)("""|'''|"|')/i.exec(s.slice(i)))) {
        var pre = m[1].toLowerCase(), q = m[2]; i += m[0].length; var st = i;
        while (i < s.length && s.substr(i, q.length) !== q) { if (s.charAt(i) === "\\" && pre !== "r") i++; i++; }
        var raw = s.slice(st, i); i += q.length;
        if (pre === "f" && /\{[^}]+\}/.test(raw)) throw 1;
        return raw.replace(/\\n/g, "\n").replace(/\\(["'\\])/g, "$1");
      }
      if ((m = /^-?\d+(\.\d+)?/.exec(s.slice(i)))) { i += m[0].length; return +m[0]; }
      if ((m = /^(True|False|None)\b/.exec(s.slice(i)))) { i += m[0].length; return m[0] === "True" ? true : m[0] === "False" ? false : null; }
      if ((m = /^os\.environ\.get\(\s*(["'])(\w+)\1\s*,\s*(["'])([^"']*)\3\s*\)/.exec(s.slice(i)))) { i += m[0].length; return m[4]; }
      if ((m = /^[A-Za-z_]\w*/.exec(s.slice(i)))) { i += m[0].length; if (consts && Object.prototype.hasOwnProperty.call(consts, m[0])) return consts[m[0]]; throw 1; }
      throw 1;
    }
    try { var v = val(); ws(); if (i < s.length) return DYN; return v; } catch (e) { return DYN; }
  }
  PyL.literal = literal; PyL.DYN = DYN;
  function splitTop(s, sep) { var parts = [], depth = 0, q = null, st = 0; for (var i = 0; i < s.length; i++) { var c = s.charAt(i); if (q) { if (c === "\\") { i++; continue; } if (c === q) q = null; continue; } if (c === "\"" || c === "'") { q = c; continue; } if ("([{".indexOf(c) >= 0) depth++; else if (")]}".indexOf(c) >= 0) depth--; else if (c === sep && depth === 0) { parts.push(s.slice(st, i)); st = i + 1; } } parts.push(s.slice(st)); return parts.map(function (x) { return x.trim(); }).filter(function (x) { return x !== ""; }); }
  PyL.splitTop = splitTop;
  // A Flask app: constants, routes with what they return, and statement lines (for coverage)
  function parseApp(src) {
    var st = statements(src), consts = {}, routes = [], pending = [], main = null, fn = null;
    st.forEach(function (x) {
      var t = stripComment(x.text), m;
      if (x.indent === 0) {
        fn = null;
        if ((m = /^([A-Z_][A-Z0-9_]*)\s*=\s*(.+)$/.exec(t))) { var v = literal(m[2], consts); if (v !== DYN) consts[m[1]] = v; }
        if ((m = /^@(?:app|bp)\.(get|post|put|delete|patch|route)\(\s*(["'])([^"']+)\2(?:\s*,\s*methods\s*=\s*\[([^\]]*)\])?/.exec(t))) { pending.push({ method: m[1] === "route" ? (m[4] ? m[4].replace(/["'\s]/g, "").toUpperCase().split(",") : ["GET"]) : [m[1].toUpperCase()], path: m[3], line: x.line }); return; }
        if ((m = /^def\s+(\w+)\s*\(/.exec(t))) { if (pending.length) { fn = { name: m[1], line: x.line, decos: pending, body: [], rets: [], src: [] }; routes.push(fn); } pending = []; return; }
        if (/^if\s+__name__\s*==\s*["']__main__["']\s*:/.test(t)) { main = { line: x.line, body: [], nocover: /pragma:\s*no cover/.test(x.text) }; fn = main; return; }
        return;
      }
      if (fn) { fn.body.push(x.line); if (fn.src) fn.src.push(x); }
    });
    routes.forEach(function (r) {
      r.methods = []; r.decos.forEach(function (d) { r.methods = r.methods.concat(d.method); r.path = d.path; });
      var body = r.src.map(function (x) { return stripComment(x.text); }).join("\n");
      r.badArgs = []; var mm, re = /request\.args\[\s*["'](\w+)["']\s*\]/g; while ((mm = re.exec(body))) r.badArgs.push(mm[1]);
      r.listNotes = /os\.listdir\(/.test(body); r.addNote = /request\.get_data\(|request\.get_json\(/.test(body) && /\.write\(|\.insert|append\(/.test(body);
      var ret = r.src.map(function (x) { return stripComment(x.text); }).filter(function (t) { return /^return\b/.test(t); })[0];
      r.ret = ret ? parseReturn(ret.replace(/^return\s*/, ""), consts) : { dynamic: true };
    });
    return { consts: consts, routes: routes, main: main, statements: st };
  }
  function parseReturn(e, consts) {
    var parts = splitTop(e, ","), status = 200, m;
    if (parts.length === 2 && /^\d{3}$/.test(parts[1])) { status = +parts[1]; e = parts[0]; }
    if ((m = /^jsonify\(([\s\S]*)\)$/.exec(e))) {
      var inner = m[1].trim(), body;
      if (/^\{/.test(inner) || /^\[/.test(inner)) body = literal(inner, consts);
      else { body = {}; splitTop(inner, ",").some(function (kv) { var k = /^(\w+)\s*=\s*([\s\S]+)$/.exec(kv); if (!k) { body = DYN; return true; } var v = literal(k[2], consts); if (v === DYN) { body = DYN; return true; } body[k[1]] = v; return false; }); }
      return body === DYN ? { dynamic: true, status: status } : { json: body, status: status };
    }
    var lit = literal(e, consts);
    if (lit === DYN) return { dynamic: true, status: status };
    if (typeof lit === "string") return { text: lit, status: status };
    return { json: lit, status: status };
  }
  PyL.parseApp = parseApp;
  // A test client over the parsed app (keeps notes between requests in one test session)
  function client(app) {
    var notes = [];
    function resp(status, body, isJson) { return { status_code: status, json: isJson ? body : null, text: isJson ? JSON.stringify(body) + "\n" : String(body), __resp: true }; }
    return function (method, url, data) {
      var path = url.split("?")[0], q = {}; (url.split("?")[1] || "").split("&").forEach(function (kv) { if (kv) q[kv.split("=")[0]] = decodeURIComponent(kv.split("=")[1] || ""); });
      var hits = app.routes.filter(function (r) { return r.path === path; });
      if (!hits.length) return resp(404, "<!doctype html>\n<html lang=en>\n<title>404 Not Found</title>\n<h1>Not Found</h1>\n", false);
      var r = hits.filter(function (x) { return x.methods.indexOf(method) >= 0; })[0];
      if (!r) return resp(405, "<!doctype html>\n<html lang=en>\n<title>405 Method Not Allowed</title>\n", false);
      r.hit = true;
      var miss = r.badArgs.filter(function (a) { return !(a in q); });
      if (miss.length) return resp(400, "<!doctype html>\n<html lang=en>\n<title>400 Bad Request</title>\n<h1>Bad Request</h1>\n<p>The browser (or proxy) sent a request that this server could not understand.</p>\n", false);
      if (r.listNotes && !r.addNote) return resp(200, notes.slice(), true);
      if (r.addNote) { var nn = { id: notes.length + 1, text: typeof data === "string" ? data : data && data.text || "" }; notes.push(nn); return resp(r.ret.status && r.ret.status !== 200 ? r.ret.status : 201, r.ret.json && !r.ret.dynamic ? r.ret.json : { id: nn.id }, true); }
      if (r.ret.dynamic) return resp(r.ret.status || 200, {}, true);
      if (r.ret.json !== undefined) return resp(r.ret.status, r.ret.json, true);
      return resp(r.ret.status, r.ret.text, false);
    };
  }
  PyL.client = client;
  function pyRepr(v) {
    if (v === null || v === undefined) return "None";
    if (v === true) return "True"; if (v === false) return "False";
    if (typeof v === "string") return "'" + v.replace(/\\/g, "\\\\").replace(/'/g, "\\'") + "'";
    if (typeof v === "number") return String(v);
    if (Array.isArray(v)) return "[" + v.map(pyRepr).join(", ") + "]";
    if (v.__resp) return "<WrapperTestResponse " + v.text.length + " bytes [" + v.status_code + " " + ({ 200: "OK", 201: "CREATED", 400: "BAD REQUEST", 404: "NOT FOUND", 405: "METHOD NOT ALLOWED", 500: "INTERNAL SERVER ERROR" }[v.status_code] || "") + "]>";
    return "{" + keys(v).map(function (k) { return pyRepr(k) + ": " + pyRepr(v[k]); }).join(", ") + "}";
  }
  PyL.repr = pyRepr;
  function deepEq(a, b) { return JSON.stringify(a) === JSON.stringify(b) || (typeof a === "object" && typeof b === "object" && a && b && !Array.isArray(a) && !Array.isArray(b) && keys(a).length === keys(b).length && keys(a).every(function (k) { return deepEq(a[k], b[k]); })); }
  // Evaluate a test-side expression: literals, response attributes, subscripts, len(), inline client calls
  function evalT(e, env, call) {
    e = e.trim();
    var m, lit = literal(e, env.__consts || {});
    if (lit !== DYN) return lit;
    if ((m = /^len\((.*)\)$/.exec(e))) { var lv = evalT(m[1], env, call); return lv == null ? 0 : typeof lv === "string" || Array.isArray(lv) ? lv.length : keys(lv).length; }
    if ((m = /^(.*?)(\[[^\[\]]+\])$/.exec(e)) && !/^[\[{]/.test(e)) { var base = evalT(m[1], env, call), key = literal(m[2].slice(1, -1), env.__consts); if (base == null) throw { py: "TypeError: 'NoneType' object is not subscriptable" }; if (key === DYN) throw { skip: true }; if (Array.isArray(base) && typeof key === "number" && key >= base.length) throw { py: "IndexError: list index out of range" }; if (!Array.isArray(base) && typeof base === "object" && !(key in base)) throw { py: "KeyError: " + pyRepr(key) }; return base[key]; }
    if ((m = /^(.*)\.(status_code|json|text|data)$/.exec(e))) { var r = evalT(m[1], env, call); if (!r || !r.__resp) throw { skip: true }; return m[2] === "data" ? r.text : r[m[2]]; }
    if ((m = /^(.*)\.(get_json|get_data)\((.*)\)$/.exec(e))) { var r2 = evalT(m[1], env, call); if (!r2 || !r2.__resp) throw { skip: true }; return m[2] === "get_json" ? r2.json : r2.text; }
    if ((m = /^client\.(get|post|put|delete|patch)\((.*)\)$/.exec(e))) {
      var args = splitTop(m[2], ","), url = literal(args[0], env.__consts), data = null;
      args.slice(1).forEach(function (a) { var kv = /^(data|json)\s*=\s*([\s\S]+)$/.exec(a); if (kv) { data = literal(kv[2], env.__consts); if (data === DYN) data = ""; } });
      if (url === DYN) throw { skip: true };
      return call(m[1].toUpperCase(), url, data);
    }
    if (/^[A-Za-z_]\w*$/.test(e) && Object.prototype.hasOwnProperty.call(env, e)) return env[e];
    throw { skip: true };
  }
  function runTest(t, env, call) {
    for (var i = 0; i < t.body.length; i++) {
      var x = t.body[i], s = stripComment(x.text), m;
      try {
        if ((m = /^assert\s+([\s\S]+?)(?:\s*,\s*(["'][^"']*["']))?$/.exec(s))) {
          var expr = m[1], ops = [" == ", " != ", " not in ", " in ", " >= ", " <= ", " > ", " < ", " is not ", " is "], op = null, at = -1;
          for (var k = 0; k < ops.length && op === null; k++) { var parts = splitTopStr(expr, ops[k]); if (parts) { op = ops[k].trim(); at = parts; } }
          if (op === null) { var v = evalT(expr, env, call); if (!v) return { fail: x, msg: "assert " + pyRepr(v), short: "assert " + pyRepr(v) }; continue; }
          var L = evalT(at[0], env, call), Rv = evalT(at[1], env, call), ok;
          if (op === "==") ok = deepEq(L, Rv); else if (op === "!=") ok = !deepEq(L, Rv);
          else if (op === "in") ok = typeof Rv === "string" ? Rv.indexOf(L) >= 0 : Array.isArray(Rv) ? Rv.some(function (y) { return deepEq(y, L); }) : Rv && typeof Rv === "object" ? L in Rv : false;
          else if (op === "not in") ok = !(typeof Rv === "string" ? Rv.indexOf(L) >= 0 : Array.isArray(Rv) ? Rv.some(function (y) { return deepEq(y, L); }) : Rv && typeof Rv === "object" ? L in Rv : false);
          else if (op === ">=") ok = L >= Rv; else if (op === "<=") ok = L <= Rv; else if (op === ">") ok = L > Rv; else if (op === "<") ok = L < Rv;
          else if (op === "is") ok = L === Rv; else ok = L !== Rv;
          if (!ok) {
            var where = /\.status_code$/.test(at[0].trim()) ? "\nE        +  where " + pyRepr(L) + " = " + pyRepr(evalT(at[0].trim().replace(/\.status_code$/, ""), env, call)) + ".status_code" : "";
            var extra = typeof L === "object" && L && typeof Rv === "object" && Rv && !Array.isArray(L) ? "\nE         \nE         Differing items:\nE         " + keys(Rv).filter(function (kk) { return !deepEq(L[kk], Rv[kk]); }).map(function (kk) { return "{" + pyRepr(kk) + ": " + pyRepr(L[kk]) + "} != {" + pyRepr(kk) + ": " + pyRepr(Rv[kk]) + "}"; }).join("\nE         ") : "";
            return { fail: x, msg: "AssertionError: assert " + pyRepr(L) + " " + op + " " + pyRepr(Rv) + where + extra, short: "AssertionError: assert " + pyRepr(L) + " " + op + " " + pyRepr(Rv) };
          }
          continue;
        }
        if ((m = /^([A-Za-z_]\w*)\s*=\s*([\s\S]+)$/.exec(s)) && !/^[A-Z_]+$/.test(m[1])) { try { env[m[1]] = evalT(m[2], env, call); } catch (e2) { if (e2 && e2.py) throw e2; } continue; }
        if ((m = /^client\.\w+\(/.exec(s))) { try { evalT(s, env, call); } catch (e3) { if (e3 && e3.py) throw e3; } continue; }
      } catch (e) {
        if (e && e.skip) continue;
        if (e && e.py) return { fail: x, msg: e.py, short: e.py, error: true };
        throw e;
      }
    }
    return { ok: true };
  }
  function splitTopStr(s, sep) { var depth = 0, q = null; for (var i = 0; i < s.length; i++) { var c = s.charAt(i); if (q) { if (c === "\\") { i++; continue; } if (c === q) q = null; continue; } if (c === "\"" || c === "'") { q = c; continue; } if ("([{".indexOf(c) >= 0) depth++; else if (")]}".indexOf(c) >= 0) depth--; else if (depth === 0 && s.substr(i, sep.length) === sep) { if (sep === " in " && s.substr(i - 4, 4) === " not") continue; return [s.slice(0, i), s.slice(i + sep.length)]; } } return null; }
  function parseTests(src) {
    var st = statements(src), tests = [], cur = null, imports = [];
    st.forEach(function (x) {
      var t = stripComment(x.text), m;
      if (x.indent === 0) {
        cur = null;
        if ((m = /^def\s+(test\w*)\s*\(([^)]*)\)/.exec(t))) { cur = { name: m[1], line: x.line, body: [], params: m[2] }; tests.push(cur); return; }
        if ((m = /^from\s+([\w.]+)\s+import\s+(.+)$/.exec(t)) || (m = /^import\s+([\w.]+)/.exec(t))) imports.push({ mod: m[1].split(".")[0], line: x.line, text: t });
        return;
      }
      if (cur) cur.body.push(x);
    });
    return { tests: tests, imports: imports };
  }
  PyL.parseTests = parseTests;

  /* ---------------- pytest (+ pytest-cov) */
  function walkPy(fs, dir, rel, outF) {
    var n = node(fs, dir); if (!n || n.type !== "d") return outF;
    keys(n.children).sort().forEach(function (k) { var c = n.children[k], p = rel ? rel + "/" + k : k; if (c.type === "d") { if (!/^(\.git|venv|\.venv|node_modules|__pycache__|\.pytest_cache)$/.test(k)) walkPy(fs, dir + "/" + k, p, outF); } else if (/\.py$/.test(k)) outF.push({ rel: p, abs: dir + "/" + k, src: c.content }); });
    return outF;
  }
  CI.walkPy = walkPy;
  function pad(s, n) { s = String(s); return s.length >= n ? s : s + new Array(n - s.length + 1).join(" "); }
  function center(title, ch, w) { w = w || 80; var t = " " + title + " ", l = Math.max(0, Math.floor((w - t.length) / 2)); return new Array(l + 1).join(ch) + t + new Array(Math.max(0, w - t.length - l) + 1).join(ch); }
  CMDS.dkpytest = function (args, io, sess) {
    var a = args.slice(1), o = { cov: [], reports: [], paths: [] };
    for (var i = 0; i < a.length; i++) {
      var x = a[i], m;
      if ((m = /^--cov(?:=(.*))?$/.exec(x))) o.cov.push(m[1] || "."); else if ((m = /^--cov-report(?:=(.*))?$/.exec(x))) o.reports.push(m[1] || a[++i]); else if ((m = /^--cov-fail-under(?:=(.*))?$/.exec(x))) o.failUnder = +(m[1] != null ? m[1] : a[++i]);
      else if ((m = /^--junit-?xml(?:=(.*))?$/.exec(x))) o.junit = m[1] || a[++i]; else if (x === "-q" || x === "--quiet") o.q = true; else if (x === "-v" || x === "--verbose") o.v = true; else if (x === "-x" || x === "--exitfirst") o.x = true;
      else if (x === "--version") { out(io, "pytest 8.3.3\n"); return 0; } else if (x === "-k") o.k = a[++i]; else if (/^-/.test(x)) continue; else o.paths.push(x);
    }
    var fs = sess.sys, root2 = sess.cwd, pyPath = ((S.resolveCommand(sess, args[0]) || {}).path || "/usr/local/bin/pytest").replace(/[^/]*$/, "python");
    var env = S.exportedEnv(sess), sp = Dk.sitePaths(fs, pyPath, env);
    var cfg = rd(fs, root2 + "/pytest.ini") || rd(fs, root2 + "/pyproject.toml") || rd(fs, root2 + "/setup.cfg") || "";
    var addRoot = /pythonpath\s*=\s*[\["']*\.?/.test(cfg) || sess.viaPythonM || !!node(fs, root2 + "/conftest.py");
    var files = [];
    (o.paths.length ? o.paths : ["."]).forEach(function (p) { var ap = abs(sess, p), n = node(fs, ap); if (!n) return; if (n.type === "f") files.push({ rel: ap.replace(root2 + "/", ""), abs: ap, src: n.content }); else walkPy(fs, ap, ap === root2 ? "" : ap.replace(root2 + "/", ""), files); });
    files = files.filter(function (f) { return /(^|\/)(test_[^/]*|[^/]*_test)\.py$/.test(f.rel); });
    if (o.paths.length && !files.length && o.paths.some(function (p) { return !node(fs, abs(sess, p)); })) { errl(io, "ERROR: file or directory not found: " + o.paths[0] + "\n"); return 4; }
    var t0 = 0.31;
    out(io, center("test session starts", "=") + "\nplatform linux -- Python " + (sp.version === "3.9" ? "3.9.20" : "3.12.7") + ", pytest-8.3.3, pluggy-1.5.0\nrootdir: " + root2 + "\n" + (/\[pytest\]|\[tool\.pytest/.test(cfg) ? "configfile: " + (rd(fs, root2 + "/pytest.ini") ? "pytest.ini" : "pyproject.toml") + "\n" : "") + (o.cov.length ? "plugins: cov-6.0.0\n" : ""));
    if (o.cov.length && !Dk.installedIn(fs, sp.dirs[0])["pytest-cov"]) { errl(io, "ERROR: usage: pytest [options] [file_or_dir] [file_or_dir] [...]\npytest: error: unrecognized arguments: " + a.filter(function (x) { return /^--cov/.test(x); }).join(" ") + "\n  inifile: None\n  rootdir: " + root2 + "\n"); return 4; }
    var apps = {}, collected = [], errors = [];
    files.forEach(function (f) {
      var pt = parseTests(f.src), bad = null;
      pt.imports.forEach(function (im) {
        if (bad) return;
        var local = node(fs, root2 + "/" + im.mod + ".py") || node(fs, root2 + "/" + im.mod);
        if (local && addRoot) { if (local.type === "f" && !apps[im.mod]) apps[im.mod] = { rel: im.mod + ".py", model: parseApp(local.content), src: local.content }; return; }
        var dirs = sp.dirs.concat([f.abs.replace(/\/[^/]*$/, "")]);
        var found = ["os", "sys", "json", "re", "pathlib", "unittest", "pytest"].indexOf(im.mod) >= 0 && (im.mod !== "pytest" || Dk.installedIn(fs, sp.dirs[0]).pytest) || dirs.some(function (d) { return !!node(fs, d + "/" + im.mod) || !!node(fs, d + "/" + im.mod + ".py"); });
        if (!found) bad = { im: im, msg: "ModuleNotFoundError: No module named '" + im.mod + "'" };
      });
      if (bad) { errors.push({ f: f, bad: bad }); return; }
      // the app's own imports (flask...) must be installed too
      keys(apps).forEach(function (k) {
        if (bad) return;
        String(apps[k].src).split("\n").forEach(function (l) { var mm = /^\s*(?:from\s+([\w.]+)\s+import|import\s+([\w.]+))/.exec(l); if (!mm || bad) return; var mod = (mm[1] || mm[2]).split(".")[0]; if (["os", "sys", "json", "re", "logging", "pathlib", "datetime", "time", "uuid", "subprocess", "sqlite3", "hashlib", "secrets", "typing"].indexOf(mod) >= 0) return; if (!sp.dirs.some(function (d) { return !!node(fs, d + "/" + mod); }) && !node(fs, root2 + "/" + mod + ".py")) bad = { im: { line: 1, text: "from app import app" }, msg: "ModuleNotFoundError: No module named '" + mod + "'", via: k }; });
      });
      if (bad) { errors.push({ f: f, bad: bad }); return; }
      pt.tests.forEach(function (t) { if (!o.k || t.name.indexOf(o.k) >= 0) collected.push({ f: f, t: t }); });
    });
    var n = collected.length;
    out(io, "collected " + n + " item" + (n === 1 ? "" : "s") + (errors.length ? " / " + errors.length + " error" + (errors.length > 1 ? "s" : "") : "") + "\n\n");
    if (errors.length) {
      out(io, center("ERRORS", "=") + "\n" + errors.map(function (er) { return center("ERROR collecting " + er.f.rel, "_") + "\nImportError while importing test module '" + er.f.abs + "'.\nHint: make sure your test modules/packages have valid Python names.\nTraceback:\n" + er.f.rel + ":" + er.bad.im.line + ": in <module>\n    " + er.bad.im.text + "\nE   " + er.bad.msg; }).join("\n") + "\n" + center("short test summary info", "=") + "\n" + errors.map(function (er) { return "ERROR " + er.f.rel; }).join("\n") + "\n!!!!!!!!!!!!!!!!!!!! Interrupted: " + errors.length + " error during collection !!!!!!!!!!!!!!!!!!!!\n" + center(errors.length + " error in 0.21s", "=") + "\n");
      fs.buildSecs = (fs.buildSecs || 0) + 1;
      return 2;
    }
    if (!n) { out(io, center("no tests ran in 0.01s", "=") + "\n"); return 5; }
    var app = apps[keys(apps)[0]] || { model: parseApp("") }, call = client(app.model), results = [];
    var byFile = {};
    collected.forEach(function (c) {
      if (o.x && results.some(function (r) { return !r.ok; })) return;
      var env = { __consts: app.model.consts }, res = runTest(c.t, env, call);
      results.push({ c: c, ok: !!res.ok, res: res });
      (byFile[c.f.rel] = byFile[c.f.rel] || []).push(res.ok ? "." : res.error ? "E" : "F");
    });
    var done = 0;
    keys(byFile).forEach(function (f) { done += byFile[f].length; if (o.v) results.filter(function (r) { return r.c.f.rel === f; }).forEach(function (r) { out(io, pad(f + "::" + r.c.t.name + " " + (r.ok ? "PASSED" : "FAILED"), 72) + " [" + pad(Math.round(done / n * 100) + "%", 4).replace(/^(\d+%)\s*$/, function (x) { return ("   " + x.trim()).slice(-4); }) + "]\n"); }); else out(io, pad(f + " " + byFile[f].join(""), 73) + "[" + ("   " + Math.round(done / n * 100)).slice(-3) + "%]\n"); });
    var failed = results.filter(function (r) { return !r.ok; }), passed = results.length - failed.length;
    if (failed.length) {
      out(io, "\n" + center("FAILURES", "=") + "\n" + failed.map(function (r) {
        var t = r.c.t, lines = t.body.map(function (x) { return (x === r.res.fail ? ">       " : "        ") + x.text; });
        var cut = lines.indexOf(lines.filter(function (l) { return /^>/.test(l); })[0]);
        return center(t.name, "_") + "\n\n    def " + t.name + "(" + t.params + "):\n" + lines.slice(0, cut + 1).join("\n") + "\nE       " + r.res.msg.split("\n").join("\n").replace(/^AssertionError: assert/, "AssertionError: assert") + "\n\n" + r.c.f.rel + ":" + r.res.fail.line + ": " + (r.res.error ? r.res.msg.split(":")[0] : "AssertionError");
      }).join("\n") + "\n");
    }
    // coverage
    var covFail = false, covPct = null;
    if (o.cov.length) {
      var rows = [];
      keys(apps).forEach(function (k) {
        var mdl = apps[k].model, stmts = mdl.statements, miss = [];
        var bodyHit = {};
        mdl.routes.forEach(function (r) { if (!r.hit) r.body.forEach(function (ln) { bodyHit[ln] = false; }); });
        if (mdl.main && !mdl.main.nocover) mdl.main.body.forEach(function (ln) { bodyHit[ln] = false; });
        if (mdl.main && mdl.main.nocover) stmts = stmts.filter(function (x) { return x.line !== mdl.main.line && mdl.main.body.indexOf(x.line) < 0; });
        stmts.forEach(function (x) { if (bodyHit[x.line] === false) miss.push(x.line); });
        rows.push({ name: apps[k].rel, stmts: stmts.length, miss: miss.length, lines: miss });
      });
      var tot = rows.reduce(function (s2, r) { return s2 + r.stmts; }, 0), tm = rows.reduce(function (s2, r) { return s2 + r.miss; }, 0);
      covPct = tot ? (tot - tm) / tot * 100 : 100;
      var ranges = function (ls) { var outR = [], st = null, pv = null; ls.forEach(function (l) { if (st === null) { st = l; pv = l; return; } if (l === pv + 1) { pv = l; return; } outR.push(st === pv ? String(st) : st + "-" + pv); st = l; pv = l; }); if (st !== null) outR.push(st === pv ? String(st) : st + "-" + pv); return outR.join(", "); };
      var miss2 = o.reports.some(function (r) { return /term-missing/.test(r); });
      var w = Math.max(5, rows.reduce(function (m2, r) { return Math.max(m2, r.name.length); }, 0));
      var head = pad("Name", w) + "    Stmts   Miss  Cover" + (miss2 ? "   Missing" : "");
      out(io, "\n---------- coverage: platform linux, python 3.12.7-final-0 -----------\n" + head + "\n" + new Array(head.length + 1).join("-") + "\n" + rows.map(function (r) { return pad(r.name, w) + ("        " + r.stmts).slice(-9) + ("       " + r.miss).slice(-7) + ("      " + Math.floor(r.stmts ? (r.stmts - r.miss) / r.stmts * 100 : 100) + "%").slice(-7) + (miss2 ? "   " + ranges(r.lines) : ""); }).join("\n") + "\n" + new Array(head.length + 1).join("-") + "\n" + pad("TOTAL", w) + ("        " + tot).slice(-9) + ("       " + tm).slice(-7) + ("      " + Math.floor(covPct) + "%").slice(-7) + "\n");
      if (o.reports.some(function (r) { return /^xml/.test(r); })) { S.writeFile(sess, root2 + "/coverage.xml", "<?xml version=\"1.0\" ?>\n<coverage line-rate=\"" + (covPct / 100).toFixed(4) + "\" version=\"7.6.4\">\n</coverage>\n", false); out(io, "Coverage XML written to file coverage.xml\n"); }
      if (o.failUnder != null) {
        if (covPct + 1e-9 < o.failUnder) { covFail = true; out(io, "\nFAIL Required test coverage of " + o.failUnder + "% not reached. Total coverage: " + covPct.toFixed(2) + "%\n"); }
        else out(io, "\nRequired test coverage of " + o.failUnder + "% reached. Total coverage: " + covPct.toFixed(2) + "%\n");
      }
    }
    if (o.junit) {
      var xml = "<?xml version=\"1.0\" encoding=\"utf-8\"?><testsuites><testsuite name=\"pytest\" errors=\"0\" failures=\"" + failed.length + "\" skipped=\"0\" tests=\"" + results.length + "\" time=\"" + t0.toFixed(3) + "\" hostname=\"" + fs.host + "\">" + results.map(function (r) { return "<testcase classname=\"" + r.c.f.rel.replace(/\.py$/, "").replace(/\//g, ".") + "\" name=\"" + r.c.t.name + "\" time=\"0.002\">" + (r.ok ? "" : "<failure message=\"" + r.res.short.replace(/"/g, "&quot;").replace(/</g, "&lt;") + "\"/>") + "</testcase>"; }).join("") + "</testsuite></testsuites>\n";
      var jp = abs(sess, o.junit); S.mkdirs(fs, jp.replace(/\/[^/]*$/, ""), 493, sess.uid, sess.gid); S.writeFile(sess, jp, xml, false);
      out(io, "- generated xml file: " + jp + " -\n");
    }
    var summ = (failed.length ? failed.length + " failed, " : "") + passed + " passed in " + (t0 + n * 0.02).toFixed(2) + "s";
    if (failed.length) out(io, center("short test summary info", "=") + "\n" + failed.map(function (r) { return "FAILED " + r.c.f.rel + "::" + r.c.t.name + " - " + r.res.short; }).join("\n") + "\n");
    out(io, center(summ, "=") + "\n");
    fs.buildSecs = (fs.buildSecs || 0) + 1.5 + n * 0.05;
    fs.pytestRuns = (fs.pytestRuns || []).concat([{ passed: passed, failed: failed.length, cov: covPct }]);
    return failed.length || covFail ? 1 : 0;
  };
  // python -m pytest adds the current folder to sys.path
  var pyOrig = CMDS.dkpython;
  CMDS.dkpython = function (args, io, sess) {
    if (args[1] === "-m" && args[2] === "pytest") { var sp2 = Dk.sitePaths(sess.sys, (S.resolveCommand(sess, args[0]) || {}).path || "/usr/local/bin/python", S.exportedEnv(sess)); if (!sp2.dirs.some(function (d) { return node(sess.sys, d + "/pytest"); })) { errl(io, "/usr/bin/python: No module named pytest"); return 1; } sess.viaPythonM = true; try { return CMDS.dkpytest([((S.resolveCommand(sess, args[0]) || {}).path || "python").replace(/python[\d.]*$/, "pytest")].concat(args.slice(3)), io, sess); } finally { sess.viaPythonM = false; } }
    if (args[1] === "-m" && args[2] === "ruff") return CMDS.dkruff(["ruff"].concat(args.slice(3)), io, sess);
    return pyOrig(args, io, sess);
  };

  /* ---------------- ruff (a few of its default rules) */
  function ruffCheck(rel, src) {
    var finds = [], L = String(src).split("\n");
    var code = L.map(function (l) { return stripComment(l); }).join("\n");
    L.forEach(function (l, i) {
      var m, t = stripComment(l);
      if ((m = /^(\s*)import\s+([\w.]+)(?:\s+as\s+(\w+))?\s*$/.exec(t))) { var nm = m[3] || m[2].split(".")[0]; var rest = code.split("\n").filter(function (x, k) { return k !== i; }).join("\n"); if (!new RegExp("\\b" + nm.replace(/\./g, "\\.") + "\\b").test(rest)) finds.push({ line: i + 1, col: m[1].length + 8, code: "F401", msg: "`" + m[2] + "` imported but unused", fix: true }); }
      if ((m = /^(\s*)from\s+([\w.]+)\s+import\s+(.+)$/.exec(t)) && !/\(/.test(m[3])) { m[3].split(",").forEach(function (part) { var pp = part.trim().split(/\s+as\s+/), nm2 = pp[1] || pp[0]; var rest = code.split("\n").filter(function (x, k) { return k !== i; }).join("\n"); if (nm2 && !new RegExp("\\b" + nm2 + "\\b").test(rest)) finds.push({ line: i + 1, col: l.indexOf(pp[0]) + 1, code: "F401", msg: "`" + m[2] + "." + pp[0] + "` imported but unused", fix: true }); }); }
      if ((m = /\bf(["'])([^"'{}]*)\1/.exec(t))) finds.push({ line: i + 1, col: t.indexOf(m[0]) + 1, code: "F541", msg: "f-string without any placeholders", fix: true });
      if ((m = /(==|!=)\s*None\b/.exec(t))) finds.push({ line: i + 1, col: t.indexOf(m[0]) + 1 + m[1].length + 1, code: "E711", msg: "Comparison to `None` should be `cond is " + (m[1] === "!=" ? "not " : "") + "None`", fix: false });
      if (/^\s*except\s*:/.test(t)) finds.push({ line: i + 1, col: t.indexOf("except") + 1, code: "E722", msg: "Do not use bare `except`", fix: false });
    });
    return finds;
  }
  CI.ruffCheck = ruffCheck;
  CMDS.dkruff = function (args, io, sess) {
    var a = args.slice(1), sub = a.shift();
    if (sub === "--version" || sub === "version") { out(io, "ruff 0.7.4\n"); return 0; }
    if (sub === "format") { var chk = a.indexOf("--check") >= 0; out(io, chk ? "2 files already formatted\n" : "2 files left unchanged\n"); return 0; }
    if (sub !== "check") { if (sub && /\.py$|^\.$/.test(sub)) { a.unshift(sub); } else { errl(io, "error: unrecognized subcommand '" + (sub || "") + "'\n\nUsage: ruff [OPTIONS] <COMMAND>\n\nFor more information, try '--help'."); return 2; } }
    var fix = a.indexOf("--fix") >= 0, gh = a.some(function (x) { return /^--output-format(=github)?$/.test(x) && (x === "--output-format=github" || a[a.indexOf(x) + 1] === "github"); });
    var targets = a.filter(function (x, i) { return !/^-/.test(x) && a[i - 1] !== "--output-format"; });
    if (!targets.length) targets = ["."];
    var files = [];
    targets.forEach(function (t) { var ap = abs(sess, t), n = node(sess.sys, ap); if (!n) return; if (n.type === "f") files.push({ rel: t, abs: ap, src: n.content }); else walkPy(sess.sys, ap, ap === sess.cwd ? "" : t.replace(/\/$/, ""), files); });
    var all = [], fixed = 0;
    files.forEach(function (f) {
      var finds = ruffCheck(f.rel, f.src);
      if (fix) {
        var L = f.src.split("\n"), drop = {};
        finds.filter(function (x) { return x.fix; }).forEach(function (x) { if (x.code === "F401") { if (/,/.test(L[x.line - 1]) && /from/.test(L[x.line - 1])) return; drop[x.line - 1] = true; fixed++; } else if (x.code === "F541") { L[x.line - 1] = L[x.line - 1].replace(/\bf(["'])([^"'{}]*)\1/, "$1$2$1"); fixed++; } });
        var nsrc = L.filter(function (l, k) { return !drop[k]; }).join("\n");
        if (nsrc !== f.src) S.writeFile(sess, f.abs, nsrc, false);
        finds = ruffCheck(f.rel, nsrc);
      }
      finds.forEach(function (x) { x.file = f.rel; all.push(x); });
    });
    all.forEach(function (x) {
      if (gh) out(io, "::error title=Ruff (" + x.code + "),file=" + sess.cwd + "/" + x.file + ",line=" + x.line + ",col=" + x.col + ",endLine=" + x.line + ",endColumn=" + (x.col + 4) + "::" + x.file + ":" + x.line + ":" + x.col + ": " + x.code + " " + x.msg + "\n");
      else out(io, x.file + ":" + x.line + ":" + x.col + ": " + x.code + (x.fix ? " [*]" : "") + " " + x.msg + "\n");
    });
    sess.sys.buildSecs = (sess.sys.buildSecs || 0) + 0.3;
    if (!all.length) { if (!gh) out(io, (fixed ? "Found " + fixed + " error" + (fixed > 1 ? "s" : "") + " (" + fixed + " fixed, 0 remaining).\n" : "All checks passed!\n")); return 0; }
    if (!gh) { var nf = all.filter(function (x) { return x.fix; }).length; out(io, "Found " + all.length + " error" + (all.length > 1 ? "s" : "") + (fixed ? " (" + fixed + " fixed, " + all.length + " remaining)" : "") + ".\n" + (nf ? "[*] " + nf + " fixable with the `--fix` option.\n" : "")); }
    return 1;
  };

  /* ---------------- semgrep (a handful of real rules from the p/python pack) */
  var SG = [
    { id: "python.flask.security.audit.debug-enabled.debug-enabled", sev: "WARNING", re: /\bapp\.run\(.*\bdebug\s*=\s*True/, msg: "Detected Flask app with debug=True. Do not deploy to production with this flag enabled as it will leak sensitive information. Instead, consider using Flask configuration variables or setting 'debug' using system environment variables.", url: "https://sg.run/dKrd" },
    { id: "python.lang.security.audit.subprocess-shell-true.subprocess-shell-true", sev: "ERROR", re: /subprocess\.\w+\([^)]*shell\s*=\s*True/, msg: "Found 'subprocess' function with 'shell=True'. This is dangerous because this call will spawn the command using a shell process. Doing so propagates current shell settings and variables, which makes it much easier for a malicious actor to execute commands. Use 'shell=False' instead.", url: "https://sg.run/J92w" },
    { id: "python.lang.security.audit.formatted-sql-query.formatted-sql-query", sev: "WARNING", re: /\.execute\(\s*(f["']|["'][^"']*["']\s*(%|\+|\.format))/, msg: "Detected possible formatted SQL query. Use parameterized queries instead.", url: "https://sg.run/EkWw" },
    { id: "python.lang.security.deserialization.avoid-pyyaml-load.avoid-pyyaml-load", sev: "ERROR", re: /\byaml\.load\((?![^)]*SafeLoader)/, msg: "Detected a possible YAML deserialization vulnerability. `yaml.unsafe_load`, `yaml.Loader`, `yaml.CLoader`, and `yaml.UnsafeLoader` are all known to be unsafe methods of deserializing YAML. An attacker with control over the YAML input could create special YAML input that allows the attacker to run arbitrary Python code. Use `yaml.safe_load` instead.", url: "https://sg.run/9oxx" },
    { id: "python.requests.security.disabled-cert-validation.disabled-cert-validation", sev: "ERROR", re: /requests\.\w+\([^)]*verify\s*=\s*False/, msg: "Certificate verification has been explicitly disabled. This permits insecure connections to insecure servers. Re-enable certification validation.", url: "https://sg.run/AlYp" }
  ];
  CI.SEMGREP = SG;
  function semgrepScan(files) { var finds = []; files.forEach(function (f) { f.src.split("\n").forEach(function (l, i) { if (/nosemgrep/.test(l)) return; SG.forEach(function (r) { if (r.re.test(l)) finds.push({ rule: r, file: f.rel, line: i + 1, text: l.trim() }); }); }); }); return finds; }
  CI.semgrepScan = semgrepScan;
  CMDS.dksemgrep = function (args, io, sess) {
    var a = args.slice(1); if (a[0] === "scan" || a[0] === "ci") a.shift();
    if (a[0] === "--version") { out(io, "1.95.0\n"); return 0; }
    var cfg = null, err = false, json = false, outFile = null, targets = [];
    for (var i = 0; i < a.length; i++) { var x = a[i]; if (x === "--config" || x === "-c" || x === "-f") cfg = a[++i]; else if (/^--config=/.test(x)) cfg = x.slice(9); else if (x === "--error") err = true; else if (x === "--json") json = true; else if (x === "--sarif") json = "sarif"; else if (x === "-o" || x === "--output") outFile = a[++i]; else if (/^-/.test(x)) continue; else targets.push(x); }
    if (!cfg) { errl(io, "[ERROR] No config given. If you want to see some examples, try running with --config auto"); return 2; }
    var files = [];
    (targets.length ? targets : ["."]).forEach(function (t) { var ap = abs(sess, t), n = node(sess.sys, ap); if (!n) return; if (n.type === "f") files.push({ rel: t, abs: ap, src: n.content }); else walkPy(sess.sys, ap, ap === sess.cwd ? "" : t, files); });
    var finds = semgrepScan(files);
    sess.sys.buildSecs = (sess.sys.buildSecs || 0) + 6;
    if (json) {
      var doc = json === "sarif" ? { version: "2.1.0", runs: [{ tool: { driver: { name: "Semgrep OSS" } }, results: finds.map(function (f) { return { ruleId: f.rule.id, level: f.rule.sev === "ERROR" ? "error" : "warning", message: { text: f.rule.msg }, locations: [{ physicalLocation: { artifactLocation: { uri: f.file }, region: { startLine: f.line } } }] }; }) }] } : { results: finds.map(function (f) { return { check_id: f.rule.id, path: f.file, start: { line: f.line }, extra: { severity: f.rule.sev, message: f.rule.msg, lines: f.text } }; }), errors: [] };
      var txt = JSON.stringify(doc, null, json === "sarif" ? 2 : 0) + "\n";
      if (outFile) S.writeFile(sess, abs(sess, outFile), txt, false); else out(io, txt);
    } else {
      out(io, "\n┌─────────────┐\n│ Scan Status │\n└─────────────┘\n  Scanning " + files.length + " file" + (files.length === 1 ? "" : "s") + " tracked by git with 216 Code rules:\n\n");
      if (finds.length) {
        out(io, "\n┌─────────────────┐\n│ " + finds.length + " Code Finding" + (finds.length > 1 ? "s" : " ") + " │\n└─────────────────┘\n");
        var byF = {}; finds.forEach(function (f) { (byF[f.file] = byF[f.file] || []).push(f); });
        keys(byF).forEach(function (f) { out(io, "\n    " + f + "\n" + byF[f].map(function (x) { return "    ❯❯❱ " + x.rule.id + "\n          " + x.rule.msg.replace(/(.{1,72})(\s|$)/g, "$1\n          ").replace(/\s+$/, "") + "\n          Details: " + x.rule.url + "\n\n" + ("           " + x.line).slice(-11) + "┆ " + x.text + "\n"; }).join("\n")); });
      }
      out(io, "\n┌──────────────┐\n│ Scan Summary │\n└──────────────┘\n\nRan 216 rules on " + files.length + " files: " + finds.length + " finding" + (finds.length === 1 ? "" : "s") + ".\n");
      if (outFile) S.writeFile(sess, abs(sess, outFile), "", false);
    }
    return finds.length && err ? 1 : 0;
  };

  /* ================================================================== GitHub Actions for images */
  var EXTRA = {
    "docker/login-action": { v: ["v3.0.0", "v3.3.0"], desc: "GitHub Action to login against a Docker registry" },
    "docker/setup-buildx-action": { v: ["v3.0.0", "v3.7.1"], desc: "Set up Docker Buildx" },
    "docker/metadata-action": { v: ["v5.0.0", "v5.5.1"], desc: "Extract metadata (tags, labels) from Git reference and GitHub events for Docker" },
    "docker/build-push-action": { v: ["v5.0.0", "v6.9.0"], desc: "Build and push Docker images with Buildx" },
    "aquasecurity/trivy-action": { v: ["0.24.0", "0.28.0"], desc: "Runs Trivy as GitHub action to scan your Docker container image for vulnerabilities" },
    "gitleaks/gitleaks-action": { v: ["v2.3.6", "v2.3.7"], desc: "Protect your secrets using Gitleaks" },
    "sigstore/cosign-installer": { v: ["v3.6.0", "v3.7.0"], desc: "Installs cosign and includes it in your path" },
    "anchore/sbom-action": { v: ["v0.17.2", "v0.17.7"], desc: "GitHub Action for creating software bill of materials using Syft." },
    "actions/attest-build-provenance": { v: ["v1.4.4", "v2.0.1"], desc: "Action for generating build provenance attestations for workflow artifacts" }
  };
  GH.GLOBAL.push(function (sys) { keys(EXTRA).forEach(function (full) { A.actionRepo(sys, full, EXTRA[full]); }); });
  CI.addActionRepos = function (map) { Object.assign(EXTRA, map); };
  // a shell on the runner as the runner user, in the workspace, with the job's environment
  function jobShell(J, env) { return J.shell(Object.assign({}, J.env(), env || {}), J.ws); }
  function capRun(J, s, fn) {
    var buf = [], io = { stdin: "", tty: false, out: function (t) { buf.push(t); }, err: function (t) { buf.push(t); }, note: function (t) { buf.push(t); }, color: function (t) { buf.push(t); } };
    var code = fn(io);
    J.emitOutput(s, buf.join(""));
    return code;
  }
  CI.capRun = capRun; CI.jobShell = jobShell;
  function listIn(v) { return String(v || "").split(/[\n,]/).map(function (x) { return x.trim(); }).filter(Boolean); }
  CI.listIn = listIn;
  A.action("docker/setup-buildx-action", { run: function (J, s) { J.rs.buildx = true; J.log(s, "##[group]Docker info\n[command]/usr/bin/docker version\n Version:           27.3.1\n##[endgroup]\n##[group]Creating a new builder instance\n[command]/usr/bin/docker buildx create --name builder-" + Dk.hex("bx" + J.job.id, 8) + " --driver docker-container --buildkitd-flags --allow-insecure-entitlement security.insecure --allow-insecure-entitlement network.host --use\nbuilder-" + Dk.hex("bx" + J.job.id, 8) + "\n##[endgroup]\n##[group]Booting builder\n#1 [internal] booting buildkit\n#1 pulling image moby/buildkit:buildx-stable-1 2.4s done\n#1 creating container buildx_buildkit_builder0 0.6s done\n#1 DONE 3.0s\n##[endgroup]"); return { code: 0, secs: 4, outputs: { name: "builder-" + Dk.hex("bx" + J.job.id, 8), driver: "docker-container" } }; } });
  A.action("docker/login-action", {
    defaults: function () { return { logout: "true" }; },
    run: function (J, s, w) {
      var reg = String(w.registry || "docker.io").trim(), user = String(w.username || ""), pw = String(w.password || "");
      if (!user || !pw) { J.log(s, "##[error]Username and password required"); J.annotate("error", "Username and password required"); return { code: 1, secs: 1 }; }
      J.addMask(pw);
      var sess = jobShell(J), code = capRun(J, s, function (io) { io.stdin = pw; J.log(s, "Logging into " + reg + "..."); var c = Dk.SUB.login([reg, "-u", user, "--password-stdin"], Object.assign(io, { stdin: pw }), sess); return c; });
      if (code) { J.log(s, "##[error]Error response from daemon: Get \"https://" + reg + "/v2/\": denied: denied"); J.annotate("error", "Error response from daemon: Get \"https://" + reg + "/v2/\": denied: denied"); return { code: 1, secs: 1 }; }
      return { code: 0, secs: 1, post: String(w.logout) === "false" ? null : function (J2, s2) { var se = jobShell(J2); capRun(J2, s2, function (io) { return Dk.SUB.logout([reg], io, se); }); return { code: 0 }; } };
    }
  });
  // docker/metadata-action: turn the git ref into image tags and OCI labels
  function semverOf(ref) { var m = /^refs\/tags\/v?(\d+)\.(\d+)\.(\d+)(-[\w.]+)?$/.exec(ref); return m ? { major: m[1], minor: m[2], patch: m[3], pre: m[4] || "", version: m[1] + "." + m[2] + "." + m[3] + (m[4] || "") } : null; }
  CI.semverOf = semverOf;
  A.action("docker/metadata-action", {
    run: function (J, s, w) {
      var images = listIn(w.images), rules = String(w.tags || "").split("\n").map(function (x) { return x.trim(); }).filter(Boolean), run = J.run, ref = run.ref;
      if (!images.length) { J.log(s, "##[error]images input required"); return { code: 1, secs: 1 }; }
      if (!rules.length) rules = ["type=schedule", "type=ref,event=branch", "type=ref,event=tag", "type=ref,event=pr"];
      var isDefault = ref === "refs/heads/" + J.r.default, tags = [], sv = semverOf(ref), version = null, branch = (/^refs\/heads\/(.+)$/.exec(ref) || [])[1], pr = (/^refs\/pull\/(\d+)\//.exec(ref) || [])[1];
      rules.forEach(function (rule) {
        var kv = {}; rule.split(",").forEach(function (p) { var i = p.indexOf("="); if (i > 0) kv[p.slice(0, i).trim()] = p.slice(i + 1).trim(); });
        if (kv.enable === "{{is_default_branch}}" && !isDefault) return; if (kv.enable === "false") return;
        var pre = kv.prefix || "", suf = kv.suffix || "", t = null;
        if (kv.type === "sha") t = (kv.prefix != null ? pre : "sha-") + (kv.format === "long" ? run.sha : run.sha.slice(0, 7)) + suf;
        else if (kv.type === "ref" && kv.event === "branch" && branch) t = pre + branch.replace(/[^\w.-]/g, "-") + suf;
        else if (kv.type === "ref" && kv.event === "tag" && /^refs\/tags\//.test(ref)) t = pre + ref.slice(10) + suf;
        else if (kv.type === "ref" && kv.event === "pr" && pr) t = pre + "pr-" + pr + suf;
        else if (kv.type === "semver" && sv) { var pat = kv.pattern || "{{version}}"; if (sv.pre && /\{\{major\}\}/.test(pat) && !/\{\{patch\}\}|\{\{version\}\}/.test(pat)) return; t = pre + pat.replace("{{version}}", sv.version).replace("{{major}}", sv.major).replace("{{minor}}", sv.minor).replace("{{patch}}", sv.patch) + suf; }
        else if (kv.type === "raw" && kv.value) t = pre + kv.value.replace("{{branch}}", branch || "").replace("{{sha}}", run.sha.slice(0, 7)) + suf;
        if (t && tags.indexOf(t) < 0) { tags.push(t); if (!version) version = t; }
      });
      var flavorLatest = /latest\s*=\s*(true|false|auto)/.exec(String(w.flavor || "")); var latest = flavorLatest ? flavorLatest[1] : "auto";
      if ((latest === "true" || (latest === "auto" && sv && !sv.pre && rules.some(function (r) { return /type=semver/.test(r); }))) && tags.indexOf("latest") < 0) tags.push("latest");
      var full = []; images.forEach(function (im) { tags.forEach(function (t) { full.push(im.toLowerCase() + ":" + t); }); });
      var created = new Date((now(J.sys)) * 1000).toISOString().replace(/\.\d+Z$/, ".000Z");
      var labels = ["org.opencontainers.image.created=" + created, "org.opencontainers.image.description=" + (J.r.description || ""), "org.opencontainers.image.licenses=", "org.opencontainers.image.revision=" + run.sha, "org.opencontainers.image.source=https://github.com/" + J.r.full, "org.opencontainers.image.title=" + J.r.name, "org.opencontainers.image.url=https://github.com/" + J.r.full, "org.opencontainers.image.version=" + (version || "")];
      J.log(s, "##[group]Context info\neventName: " + run.event + "\nsha: " + run.sha + "\nref: " + ref + "\nworkflow: " + run.wfName + "\naction: __docker_metadata-action\nrunNumber: " + run.number + "\nrunId: " + run.id + "\n##[endgroup]\n##[group]Docker image version\n" + (version || "") + "\n##[endgroup]\n##[group]Docker tags\n" + full.join("\n") + "\n##[endgroup]\n##[group]Docker labels\n" + labels.join("\n") + "\n##[endgroup]");
      if (!full.length) J.log(s, "##[warning]No Docker tag has been generated. Check tags input.");
      return { code: 0, secs: 1, outputs: { tags: full.join("\n"), labels: labels.join("\n"), version: version || "", json: JSON.stringify({ tags: full, labels: labels }) } };
    }
  });
  // docker/build-push-action: BuildKit build on the runner, the GitHub Actions cache, push to the registry
  A.action("docker/build-push-action", {
    defaults: function () { return { context: "." }; },
    run: function (J, s, w) {
      var rs = J.rs, sess = jobShell(J), d = Dk.state(rs);
      var tags = listIn(w.tags), push = String(w.push) === "true", ctx = S.normAbs(J.ws + "/" + String(w.context || ".").replace(/^\.\/?$/, "")), file = w.file ? S.normAbs(J.ws + "/" + w.file) : null;
      var cacheFrom = String(w["cache-from"] || ""), cacheTo = String(w["cache-to"] || "");
      if (/type=gha/.test(cacheTo) && !rs.buildx) { J.log(s, "##[group]Buildx version\n[command]/usr/bin/docker buildx version\ngithub.com/docker/buildx v0.17.1\n##[endgroup]\nERROR: failed to solve: Cache export is not supported for the docker driver.\nSwitch to a different driver, or turn on the containerd image store, and try again.\nLearn more at https://docs.docker.com/go/build-cache-backends/\n##[error]buildx failed with: ERROR: failed to solve: Cache export is not supported for the docker driver."); J.annotate("error", "buildx failed with: ERROR: failed to solve: Cache export is not supported for the docker driver."); return { code: 1, secs: 2 }; }
      if (/type=gha/.test(cacheFrom) && J.r.caches["buildkit-gha"]) { var cc = J.r.caches["buildkit-gha"].entries || {}; keys(cc).forEach(function (k) { d.cache[k] = cc[k]; }); }
      var args = {}; String(w["build-args"] || "").split("\n").forEach(function (l) { var i = l.indexOf("="); if (i > 0) args[l.slice(0, i).trim()] = l.slice(i + 1).trim(); });
      var labels = listIn(w.labels);
      var buf = [], io = { stdin: "", tty: false, out: function (t) { buf.push(t); }, err: function (t) { buf.push(t); }, note: function (t) { buf.push(t); } };
      var res = Dk.build(sess, { ctxDir: ctx, ctxArg: w.context || ".", file: file, tags: tags.length ? tags : [], args: args, target: w.target || null, secrets: {}, plain: true }, io);
      J.log(s, buf.join("").replace(/\n$/, ""));
      if (res.error) { J.log(s, "##[error]buildx failed with: ERROR: failed to solve: process did not complete successfully"); J.annotate("error", "buildx failed with: ERROR: failed to solve: process did not complete successfully"); return { code: 1, secs: 3 + (rs.dk.t || 0) % 5 }; }
      var img = res.img;
      if (labels.length) labels.forEach(function (l) { var i = l.indexOf("="); if (i > 0) img.cfg.Labels[l.slice(0, i)] = l.slice(i + 1); });
      var digest = null;
      if (push) {
        for (var k = 0; k < tags.length; k++) {
          var pb = [], pio = { out: function (t) { pb.push(t); }, err: function (t) { pb.push(t); }, note: function () {} };
          var pc = Dk.SUB.push([tags[k]], pio, sess);
          J.log(s, pb.join("").replace(/\n$/, ""));
          if (pc) { J.log(s, "##[error]buildx failed with: ERROR: failed to push " + tags[k] + ": " + (pb.join("").split("\n").filter(Boolean).pop() || "")); J.annotate("error", "buildx failed with: ERROR: failed to push " + tags[k]); return { code: 1, secs: 5 }; }
          var pr = Dk.parseRef(tags[k]); digest = img.digests[Dk.repoName(pr)] || digest;
        }
        CI.pushed = (CI.pushed || 0) + 1;
      }
      if (/type=gha/.test(cacheTo)) {
        var keep = {}; keys(d.cache).forEach(function (k2) { keep[k2] = d.cache[k2]; });
        J.r.caches["buildkit-gha"] = { files: {}, entries: keep, size: 52428800, created: now(J.sys), ref: J.run.ref };
        J.log(s, "#" + (buf.length % 20 + 14) + " exporting cache to GitHub Actions Cache\n#" + (buf.length % 20 + 14) + " preparing build cache for export done\n#" + (buf.length % 20 + 14) + " DONE 1.4s");
      }
      var b = d.lastBuild;
      return { code: 0, secs: Math.max(3, Math.round(b && b.secs || 3)) + (push ? 4 : 0), outputs: { imageid: img.id, digest: digest || "", metadata: JSON.stringify({ "containerimage.digest": digest || img.id, "image.name": tags.join(",") }) } };
    }
  });
  A.action("aquasecurity/trivy-action", {
    defaults: function () { return { "scan-type": "image", format: "table", "exit-code": "0", "ignore-unfixed": "false", severity: "UNKNOWN,LOW,MEDIUM,HIGH,CRITICAL" }; },
    run: function (J, s, w) {
      var sess = jobShell(J), type = String(w["scan-type"] || "image"), target = type === "image" ? String(w["image-ref"] || "") : String(w["scan-ref"] || ".");
      if (!target) { J.log(s, "##[error]image-ref is required for scan-type image"); return { code: 1, secs: 1 }; }
      var a = ["trivy", type === "fs" ? "fs" : type === "config" ? "config" : "image"];
      if (w.severity) a.push("--severity", String(w.severity));
      if (String(w["exit-code"]) !== "0") a.push("--exit-code", String(w["exit-code"]));
      if (String(w["ignore-unfixed"]) === "true") a.push("--ignore-unfixed");
      if (w.scanners) a.push("--scanners", String(w.scanners));
      if (w.format && w.format !== "table") a.push("--format", String(w.format));
      a.push(target);
      J.log(s, "Running Trivy with options: trivy " + a.slice(1).join(" "));
      var code = capRun(J, s, function (io) { return CMDS.trivy(a, io, sess); });
      if (code) { J.log(s, "##[error]Process completed with exit code " + code + "."); J.annotate("error", "Process completed with exit code " + code + "."); }
      return { code: code, secs: 9 };
    }
  });
  A.action("gitleaks/gitleaks-action", {
    run: function (J, s, w, env) {
      var sess = jobShell(J), shallow = !node(J.rs, J.ws + "/.git/refs/remotes/origin") || keys((node(J.rs, J.ws + "/.git/refs/remotes/origin") || { children: {} }).children).length <= 1 && !J.fullHistory;
      var repo = G.repoAt ? G.findRepo(J.rs, J.ws) : null, args = ["gitleaks", "detect", "--redact", "-v", "--exit-code=2", "--report-format=sarif", "--report-path=results.sarif", "--log-level=debug"];
      if (repo && J.run.event === "push") { var depth = Object.keys(G.ancestors(J.rs, J.run.sha) || {}).length; if (depth <= 1) args.push("--log-opts=-1"); }
      J.log(s, "gitleaks version: 8.18.4\n[" + J.r.full + "] event type: " + J.run.event + "\ngitleaks cmd: " + args.join(" "));
      var code = capRun(J, s, function (io) { return CMDS.gitleaks(args.slice(), io, sess); });
      void shallow; void env;
      if (code === 2 || code === 1) { J.log(s, "##[warning]🛑 Leaks detected, see job summary for details"); J.annotate("error", "🛑 Leaks detected, see job summary for details"); J.summary += "## 🛑 Gitleaks detected secrets 🛑\n"; return { code: 1, secs: 3 }; }
      J.log(s, "✅ No leaks detected"); J.summary += "## No leaks detected ✅\n";
      return { code: 0, secs: 3 };
    }
  });

  /* ================================================================== cosign, syft, provenance */
  A.action("sigstore/cosign-installer", { run: function (J, s, w) { var v = String(w["cosign-release"] || "v2.4.1"); putBin(J.rs, "/home/runner/.cosign/cosign", "cosign"); J.pathAdd.push("/home/runner/.cosign"); J.log(s, "INFO: Downloading bootstrap version 'v2.4.1' of cosign to verify version to be installed...\n      https://github.com/sigstore/cosign/releases/download/v2.4.1/cosign-linux-amd64\nINFO: bootstrap version successfully verified and matches requested version so nothing else to do\nINFO: cosign " + v + " installed to /home/runner/.cosign"); return { code: 0, secs: 2 }; } });
  function digestOf(sess, ref, io, verb) {
    var p = Dk.parseRef(ref), hit = Dk.regLookup(sess.sys, p);
    var deny = Dk.regAccess(sess, p, false);
    if (deny || !hit) { errl(io, "Error: " + verb + " [" + ref + "]: accessing entity: " + (deny ? "GET https://" + p.registry + "/token?scope=repository%3A" + encodeURIComponent(p.repo) + "%3Apull&service=" + p.registry + ": UNAUTHORIZED: authentication required" : "entity not found in registry")); return null; }
    return { p: p, digest: hit.digest, img: hit.img, reg: regOf(sess.sys, p.registry), name: Dk.repoName(p) };
  }
  function oidcIdentity(sess) {
    var tok = S.getVar(sess, "ACTIONS_ID_TOKEN_REQUEST_TOKEN"), st = A.svc(sess.sys), c = tok && st.oidcReq ? st.oidcReq[tok] : null;
    return c ? { identity: "https://github.com/" + c.job_workflow_ref, issuer: c.iss, repo: c.repository, ref: c.ref, sha: c.sha, workflow: c.job_workflow_ref } : null;
  }
  CI.oidcIdentity = oidcIdentity;
  function cosignKeyId(text) { return M2.hexOf("cosignkey:" + text, 16); }
  CMDS.cosign = function (args, io, sess) {
    var a = args.slice(1), sub = a.shift(), o = { flags: {}, rest: [] };
    for (var i = 0; i < a.length; i++) { var m = /^--?([\w-]+)(?:=(.*))?$/.exec(a[i]); if (m) { var bool = /^(y|yes|recursive|insecure-ignore-tlog|offline)$/.test(m[1]); o.flags[m[1]] = m[2] != null ? m[2] : bool ? "true" : a[++i]; } else o.rest.push(a[i]); }
    var f = o.flags, yes = f.y || f.yes;
    if (sub === "version" || sub === "--version") { out(io, "  ______   ______        _______. __    _______ .__   __.\n /      | /  __  \\      /       ||  |  /  _____||  \\ |  |\n|  ,----'|  |  |  |    |   (----`|  | |  |  __  |   \\|  |\n|  |     |  |  |  |     \\   \\    |  | |  | |_ | |  . `  |\n|  `----.|  `--'  | .----)   |   |  | |  |__| | |  |\\   |\n \\______| \\______/  |_______/    |__|  \\______| |__| \\__|\ncosign: A tool for Container Signing, Verification and Storage in an OCI registry.\n\nGitVersion:    v2.4.1\nGitCommit:     9a4cfe1aae777984c07ce373d97a65428bbff734\nGitTreeState:  clean\nBuildDate:     2024-10-03T17:13:17Z\nGoVersion:     go1.23.2\nCompiler:      gc\nPlatform:      linux/amd64\n"); return 0; }
    if (sub === "generate-key-pair") {
      var pw = S.getVar(sess, "COSIGN_PASSWORD");
      if (pw == null) { errl(io, "Error: generate-key-pair: reading password: no terminal: set COSIGN_PASSWORD to choose a password non-interactively"); return 1; }
      var kid = Dk.hex("cosign-" + sess.cwd + (sess.sys.host || "") + now(sess.sys), 32);
      S.writeFile(sess, sess.cwd + "/cosign.key", "-----BEGIN ENCRYPTED SIGSTORE PRIVATE KEY-----\neyJrZGYiOnsibmFtZSI6InNjcnlwdCJ9LCJraWQiOiI" + kid + "IifQ==\n-----END ENCRYPTED SIGSTORE PRIVATE KEY-----\n", false);
      S.writeFile(sess, sess.cwd + "/cosign.pub", "-----BEGIN PUBLIC KEY-----\nMFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE" + kid + "==\n-----END PUBLIC KEY-----\n", false);
      var kn = node(sess.sys, sess.cwd + "/cosign.key"); if (kn) kn.mode = 384;
      errl(io, "Private key written to cosign.key\nPublic key written to cosign.pub");
      return 0;
    }
    if (sub === "sign" || sub === "attest") {
      var ref = o.rest[0]; if (!ref) { errl(io, "Error: accepts at least 1 arg(s), received 0"); return 1; }
      if (!/@sha256:/.test(ref)) errl(io, "WARNING: Image reference " + ref + " uses a tag, not a digest, to identify the image to sign.\n    This can lead you to sign a different image than the intended one. Please use a\n    digest (example.com/ubuntu@sha256:abc123...) rather than tag\n    (example.com/ubuntu:latest) for the input to cosign. The ability to refer to\n    images by tag will be removed in a future release.\n");
      var dg = digestOf(sess, ref, io, sub === "sign" ? "signing" : "attesting"); if (!dg) return 1;
      var who;
      if (f.key) {
        var kt = rd(sess.sys, abs(sess, f.key)); if (kt == null) { errl(io, "Error: " + sub + ": reading key: open " + f.key + ": no such file or directory"); return 1; }
        if (S.getVar(sess, "COSIGN_PASSWORD") == null) { errl(io, "Error: " + sub + ": getting signer: reading key: no terminal: set COSIGN_PASSWORD"); return 1; }
        who = { keyId: (/kid":"?([0-9a-f]+)|aWQiOiI([0-9a-f]+)/.exec(kt) || [])[2] || cosignKeyId(kt), keyless: false };
        errl(io, "Enter password for private key: ");
      } else {
        var id = oidcIdentity(sess);
        if (!id) { errl(io, "Error: " + (sub === "sign" ? "signing" : "attesting") + " [" + ref + "]: getting signer: getting key from Fulcio: getting key from Fulcio: retrieving cert: error obtaining token: no OIDC token available"); return 1; }
        if (!yes) { errl(io, "Error: signing [" + ref + "]: no terminal to confirm uploading to the public transparency log: pass --yes to agree"); return 1; }
        errl(io, "Generating ephemeral keys...\nRetrieving signed certificate...\n\n        The sigstore service, hosted by sigstore a Series of LF Projects, LLC, is provided pursuant to the Hosted Project Tools Terms of Use, available at https://lfprojects.org/policies/hosted-project-tools-terms-of-use/.\n        Note that if your submission includes personal data associated with this signed artifact, it will be part of an immutable record.\n        This may include the email address associated with the account with which you authenticate your contractual Agreement.\n        This information will be used for signing this artifact and will be stored in public transparency logs and cannot be removed later, and is subject to the Immutable Record notice at https://lfprojects.org/policies/hosted-project-tools-immutable-records-sigstore-notice/.\n\nBy typing 'y', you attest that (1) you are not submitting the personal data of any other person; and (2) you understand and agree to the statement and the Agreement terms at the URLs listed above.\nSuccessfully verified SCT...");
        who = { keyless: true, identity: id.identity, issuer: id.issuer, repo: id.repo, sha: id.sha };
      }
      var regE = dg.reg;
      if (sub === "sign") {
        regE.sigs = regE.sigs || {}; (regE.sigs[dg.digest] = regE.sigs[dg.digest] || []).push(Object.assign({ t: now(sess.sys), ref: dg.name }, who));
        if (who.keyless) errl(io, "tlog entry created with index: " + (151000000 + M2.hash(dg.digest) % 900000));
        errl(io, "Pushing signature to: " + dg.name);
      } else {
        var pred = f.predicate ? rd(sess.sys, abs(sess, f.predicate)) : null;
        if (pred == null) { errl(io, "Error: attesting: reading predicate: open " + (f.predicate || "") + ": no such file or directory"); return 1; }
        var type = f.type || "custom";
        regE.atts = regE.atts || {}; (regE.atts[dg.digest] = regE.atts[dg.digest] || []).push(Object.assign({ t: now(sess.sys), type: type === "spdxjson" ? "https://spdx.dev/Document" : type === "cyclonedx" ? "https://cyclonedx.org/bom" : type === "slsaprovenance" ? "https://slsa.dev/provenance/v0.2" : type, predicate: pred, ref: dg.name }, who));
        if (who.keyless) errl(io, "tlog entry created with index: " + (152000000 + M2.hash(dg.digest + pred.length) % 900000));
      }
      sess.sys.buildSecs = (sess.sys.buildSecs || 0) + 3;
      return 0;
    }
    if (sub === "verify" || sub === "verify-attestation") {
      var ref2 = o.rest[0]; if (!ref2) { errl(io, "Error: accepts at least 1 arg(s), received 0"); return 1; }
      var dg2 = digestOf(sess, ref2, io, "verifying"); if (!dg2) return 1;
      var list = sub === "verify" ? ((dg2.reg.sigs || {})[dg2.digest] || []) : ((dg2.reg.atts || {})[dg2.digest] || []).filter(function (x) { var want = f.type === "spdxjson" ? "https://spdx.dev/Document" : f.type === "slsaprovenance" ? "https://slsa.dev/provenance/v0.2" : f.type; return !f.type || x.type === want; });
      var keyMode = !!f.key, idRe = null;
      if (!keyMode) {
        if (!f["certificate-identity"] && !f["certificate-identity-regexp"]) { errl(io, "Error: --certificate-identity or --certificate-identity-regexp is required for verification in keyless mode"); return 1; }
        if (!f["certificate-oidc-issuer"] && !f["certificate-oidc-issuer-regexp"]) { errl(io, "Error: --certificate-oidc-issuer or --certificate-oidc-issuer-regexp is required for verification in keyless mode"); return 1; }
        try { idRe = f["certificate-identity"] ? null : new RegExp(f["certificate-identity-regexp"]); } catch (e) { errl(io, "Error: invalid regexp"); return 1; }
      }
      if (!list.length) { errl(io, "Error: no " + (sub === "verify" ? "signatures" : "matching attestations") + " found\nmain.go:69: error during command execution: no " + (sub === "verify" ? "signatures" : "matching attestations") + " found"); return 10; }
      var kt2 = keyMode ? rd(sess.sys, abs(sess, f.key)) : null;
      if (keyMode && kt2 == null) { errl(io, "Error: loading public key: open " + f.key + ": no such file or directory"); return 1; }
      var kid2 = keyMode ? ((/QcDQgAE([0-9a-f]+)/.exec(kt2) || [])[1] || cosignKeyId(kt2)) : null;
      var good = list.filter(function (x) {
        if (keyMode) return !x.keyless && x.keyId === kid2;
        if (!x.keyless) return false;
        var issOk = f["certificate-oidc-issuer"] ? x.issuer === f["certificate-oidc-issuer"] : new RegExp(f["certificate-oidc-issuer-regexp"]).test(x.issuer);
        var idOk = idRe ? idRe.test(x.identity) : x.identity === f["certificate-identity"];
        return issOk && idOk;
      });
      if (!good.length) {
        if (keyMode) errl(io, "Error: no matching " + (sub === "verify" ? "signatures" : "attestations") + ": invalid signature when validating ASN.1 encoded signature\nmain.go:69: error during command execution: no matching signatures");
        else errl(io, "Error: no matching " + (sub === "verify" ? "signatures" : "attestations") + ": none of the expected identities matched what was in the certificate, got subjects [" + list.filter(function (x) { return x.keyless; }).map(function (x) { return x.identity; }).join(" ") + "] with issuer " + (list[0].issuer || "") + "\nmain.go:74: error during command execution: no matching signatures: none of the expected identities matched what was in the certificate");
        return 10;
      }
      errl(io, "\nVerification for " + dg2.name + "@" + dg2.digest + " --\nThe following checks were performed on each of these signatures:\n  - The cosign claims were validated\n" + (keyMode ? "  - The signatures were verified against the specified public key\n" : "  - Existence of the claims in the transparency log was verified offline\n  - The code-signing certificate was verified using trusted certificate authority certificates\n"));
      if (sub === "verify") out(io, JSON.stringify(good.map(function (x) { return { critical: { identity: { "docker-reference": dg2.name }, image: { "docker-manifest-digest": dg2.digest }, type: "cosign container image signature" }, optional: x.keyless ? { "1.3.6.1.4.1.57264.1.1": x.issuer, Bundle: { SignedEntryTimestamp: Dk.hex("set" + x.t, 40) }, Issuer: x.issuer, Subject: x.identity, githubWorkflowRepository: x.repo, githubWorkflowSha: x.sha } : null }; })) + "\n");
      else good.forEach(function (x) { var stmt = { _type: "https://in-toto.io/Statement/v0.1", predicateType: x.type, subject: [{ name: dg2.name, digest: { sha256: dg2.digest.slice(7) } }], predicate: JSON.parse(x.predicate || "{}") }; out(io, JSON.stringify({ payloadType: "application/vnd.in-toto+json", payload: GH.b64encode(JSON.stringify(stmt)), signatures: [{ keyid: "", sig: Dk.hex("dsse" + x.t, 64) }] }) + "\n"); });
      return 0;
    }
    if (sub === "tree") {
      var dg3 = digestOf(sess, o.rest[0] || "", io, "tree"); if (!dg3) return 1;
      var sg = (dg3.reg.sigs || {})[dg3.digest] || [], at = (dg3.reg.atts || {})[dg3.digest] || [];
      out(io, "📦 Supply Chain Security Related artifacts for an image: " + o.rest[0] + "\n" + (at.length ? "└── 💾 Attestations for an image tag: " + dg3.name + ":" + dg3.digest.replace(":", "-") + ".att\n" + at.map(function (x) { return "   └── 🍒 sha256:" + Dk.hex("att" + x.t + x.type, 64) + "\n"; }).join("") : "") + (sg.length ? "└── 🔐 Signatures for an image tag: " + dg3.name + ":" + dg3.digest.replace(":", "-") + ".sig\n" + sg.map(function (x) { return "   └── 🍒 sha256:" + Dk.hex("sig" + x.t, 64) + "\n"; }).join("") : "") + (!sg.length && !at.length ? "No Supply Chain Security Related Artifacts artifacts found for image " + o.rest[0] + ",\n start creating one with simply running$ cosign sign <img>\n" : ""));
      return 0;
    }
    errl(io, "Error: unknown command \"" + (sub || "") + "\" for \"cosign\"\nRun 'cosign --help' for usage."); return 1;
  };
  // syft: SBOMs from an image (local daemon or registry) or a folder
  function sbomPackages(sys, sess, src, io) {
    var m, map;
    if ((m = /^dir:(.+)$/.exec(src)) || node(sys, abs(sess, src)) && node(sys, abs(sess, src)).type === "d") { var dn = node(sys, abs(sess, m ? m[1] : src)); map = {}; Dk.mapFrom(dn, "/"); var pyreq = rd(sys, abs(sess, (m ? m[1] : src) + "/requirements.txt")) || ""; return { os: null, osPkgs: [], py: pyreq.split("\n").map(function (l) { var x = /^\s*([\w.-]+)(?:\[[^\]]*\])?\s*==\s*([\w.]+)/.exec(l); return x ? { name: x[1], ver: x[2] } : null; }).filter(Boolean), name: src }; }
    var ref = src.replace(/^(docker|registry):/, ""), img = Dk.findImage(sys, ref);
    if (!img) { var hit = digestOf(sess, ref, io, "syft"); if (!hit) return null; img = hit.img; }
    map = Dk.merge(img.layers);
    var pk = Dk.trivyPackages(map); pk.name = ref; return pk;
  }
  CI.sbomPackages = sbomPackages;
  function sbomDoc(pk, fmt) {
    var pkgs = pk.osPkgs.map(function (p) { return { name: p[0], version: p[1], type: pk.os && pk.os.family === "alpine" ? "apk" : "deb" }; }).concat(pk.py.map(function (p) { return { name: p.name, version: p.ver, type: "python" }; }));
    if (fmt === "table") return pkgs.length ? Dk.table([["NAME", "VERSION", "TYPE"]].concat(pkgs.map(function (p) { return [p.name, p.version, p.type]; }))) : "No packages discovered\n";
    if (fmt === "cyclonedx-json") return JSON.stringify({ bomFormat: "CycloneDX", specVersion: "1.6", components: pkgs.map(function (p) { return { type: "library", name: p.name, version: p.version, purl: "pkg:" + (p.type === "python" ? "pypi" : p.type) + "/" + p.name + "@" + p.version }; }) }, null, 2) + "\n";
    return JSON.stringify({ spdxVersion: "SPDX-2.3", dataLicense: "CC0-1.0", SPDXID: "SPDXRef-DOCUMENT", name: pk.name, creationInfo: { creators: ["Tool: syft-1.16.0"] }, packages: pkgs.map(function (p, i) { return { name: p.name, SPDXID: "SPDXRef-Package-" + p.type + "-" + p.name + "-" + i, versionInfo: p.version, externalRefs: [{ referenceCategory: "PACKAGE-MANAGER", referenceType: "purl", referenceLocator: "pkg:" + (p.type === "python" ? "pypi" : p.type) + "/" + p.name + "@" + p.version }] }; }) }, null, 2) + "\n";
  }
  CI.sbomDoc = sbomDoc;
  CMDS.syft = function (args, io, sess) {
    var a = args.slice(1); if (a[0] === "scan") a.shift();
    if (a[0] === "version" || a[0] === "--version") { out(io, "syft 1.16.0\n"); return 0; }
    var fmt = "table", file = null, src = null;
    for (var i = 0; i < a.length; i++) { var x = a[i]; if (x === "-o" || x === "--output") { var v = a[++i]; fmt = v.split("=")[0]; file = v.split("=")[1] || null; } else if (/^(-o|--output)=/.test(x)) { var v2 = x.replace(/^(-o|--output)=/, ""); fmt = v2.split("=")[0]; file = v2.split("=")[1] || null; } else if (x === "--file") file = a[++i]; else if (/^-/.test(x)) continue; else src = x; }
    if (!src) { errl(io, "an image/directory argument is required"); return 1; }
    var pk = sbomPackages(sess.sys, sess, src, io); if (!pk) return 1;
    var doc = sbomDoc(pk, fmt);
    errl(io, " ✔ Parsed image " + (pk.name || src) + "\n ✔ Cataloged contents\n   ├── ✔ Packages                        [" + (pk.osPkgs.length + pk.py.length) + " packages]\n   └── ✔ Executables                     [" + (12 + pk.osPkgs.length) + " executables]");
    if (file) S.writeFile(sess, abs(sess, file), doc, false); else out(io, doc);
    sess.sys.buildSecs = (sess.sys.buildSecs || 0) + 4;
    return 0;
  };
  A.action("anchore/sbom-action", {
    defaults: function () { return { format: "spdx-json", "upload-artifact": "true" }; },
    run: function (J, s, w) {
      var sess = jobShell(J), fmt = String(w.format || "spdx-json"), file = w["output-file"] ? String(w["output-file"]) : J.r.name + "-sbom." + (fmt === "cyclonedx-json" ? "cyclonedx" : "spdx") + ".json";
      var src = w.image ? String(w.image) : w.path ? "dir:" + w.path : "dir:.";
      putBin(J.rs, "/opt/hostedtoolcache/syft/1.16.0/x64/syft", "syft");
      J.log(s, "[command]/opt/hostedtoolcache/syft/1.16.0/x64/syft scan " + src + " -o " + fmt + "=" + file);
      var code = capRun(J, s, function (io) { return CMDS.syft(["syft", "scan", src, "-o", fmt + "=" + file], io, sess); });
      if (code) return { code: 1, secs: 6 };
      if (String(w["upload-artifact"]) !== "false") { var txt = rd(J.rs, abs(sess, file)) || ""; J.r.artifacts.push({ id: 7000000 + J.r.artifacts.length, name: w["artifact-name"] || file, run: J.run.id, files: [{ path: file, content: txt }], size: txt.length, created: now(J.sys), expired: false }); J.log(s, "Uploading artifact: " + (w["artifact-name"] || file)); }
      return { code: 0, secs: 7 };
    }
  });
  A.action("actions/attest-build-provenance", {
    defaults: function () { return { "push-to-registry": "false", "show-summary": "true" }; },
    run: function (J, s, w) {
      var name = String(w["subject-name"] || ""), digest = String(w["subject-digest"] || "");
      if (J.perms["id-token"] !== "write" || J.perms.attestations !== "write") { J.log(s, "##[error]Failed to get ID token: Error message: Unable to get ACTIONS_ID_TOKEN_REQUEST_URL env variable"); J.annotate("error", "Failed to get ID token: Error message: Unable to get ACTIONS_ID_TOKEN_REQUEST_URL env variable"); return { code: 1, secs: 1 }; }
      if (!name || !/^sha256:[0-9a-f]{64}$/.test(digest)) { J.log(s, "##[error]One of subject-path or subject-digest must be provided"); J.annotate("error", "One of subject-path or subject-digest must be provided"); return { code: 1, secs: 1 }; }
      var h = hubOf(J.sys), wfRef = J.r.full + "/" + J.run.wfPath + "@" + J.run.ref;
      h.attestations = h.attestations || [];
      var att = { digest: digest, name: name, repo: J.r.full, owner: J.r.owner, workflow: wfRef, sha: J.run.sha, ref: J.run.ref, run: J.run.id, predicateType: "https://slsa.dev/provenance/v1", t: now(J.sys) };
      h.attestations.push(att);
      if (String(w["push-to-registry"]) === "true") { var p = Dk.parseRef(name), reg = regOf(J.rs, p.registry); if (reg) { reg.atts = reg.atts || {}; (reg.atts[digest] = reg.atts[digest] || []).push({ t: att.t, type: att.predicateType, keyless: true, identity: "https://github.com/" + wfRef, issuer: "https://token.actions.githubusercontent.com", predicate: JSON.stringify({ buildDefinition: { buildType: "https://actions.github.io/buildtypes/workflow/v1", externalParameters: { workflow: { ref: J.run.ref, repository: "https://github.com/" + J.r.full, path: J.run.wfPath } } }, runDetails: { builder: { id: "https://github.com/actions/runner/github-hosted" } } }), ref: Dk.repoName(p) }); } }
      J.log(s, "Attestation created for " + name + "@" + digest + "\nhttps://github.com/" + J.r.full + "/attestations/" + (4000000 + h.attestations.length));
      J.summary += "## Attestation created\n" + name + "@" + digest + "\n";
      return { code: 0, secs: 3, outputs: { "attestation-id": String(4000000 + h.attestations.length), "attestation-url": "https://github.com/" + J.r.full + "/attestations/" + (4000000 + h.attestations.length) } };
    }
  });
  // gh attestation verify oci://IMAGE --owner ORG | --repo OWNER/REPO
  if (GH.ghCommands) GH.ghCommands.attestation = function (c, a) {
    var sub = a.shift();
    if (sub !== "verify") { c.o.err("unknown command \"" + (sub || "") + "\" for \"gh attestation\""); return 1; }
    var target = null, owner = null, repo = null, wf = null;
    for (var i = 0; i < a.length; i++) { if (a[i] === "--owner" || a[i] === "-o") owner = a[++i]; else if (a[i] === "--repo" || a[i] === "-R") repo = a[++i]; else if (a[i] === "--signer-workflow") wf = a[++i]; else if (!/^-/.test(a[i])) target = a[i]; }
    if (!target) { c.o.err("accepts 1 arg(s), received 0"); return 1; }
    if (!owner && !repo) { c.o.err("at least one of the --owner or --repo flags must be provided"); return 1; }
    var sess = c.sess, ref = target.replace(/^oci:\/\//, ""), dg;
    if (/^oci:\/\//.test(target)) { var bufE = [], io2 = { out: function () {}, err: function (t) { bufE.push(t); } }; dg = digestOf(sess, ref, io2, "verify"); if (!dg) { c.o.err("✗ Loading digest for " + target + " failed\n" + bufE.join("")); return 1; } }
    else { c.o.err("✗ Loading digest for " + target + " failed (only oci:// images are simulated here)"); return 1; }
    c.o.line("Loaded digest " + dg.digest + " for " + target);
    var list = (hubOf(sess.sys).attestations || []).filter(function (x) { return x.digest === dg.digest; });
    if (!list.length) { c.o.err("✗ Loading attestations from GitHub API failed\n\nError: failed to fetch attestations from " + (repo || owner) + ": HTTP 404: Not Found"); return 1; }
    c.o.line("Loaded " + list.length + " attestation" + (list.length > 1 ? "s" : "") + " from GitHub API");
    var good = list.filter(function (x) { return (!repo || x.repo.toLowerCase() === repo.toLowerCase()) && (!owner || x.owner.toLowerCase() === owner.toLowerCase()) && (!wf || x.workflow.indexOf(wf) >= 0); });
    if (!good.length) { c.o.err("\nError: verifying with issuer \"sigstore.dev\"\n✗ Verification failed\n\nError: none of the attestations matched the provided --owner/--repo"); return 1; }
    c.o.line("\nThe following policy criteria will be enforced:\n- Predicate type must match:................ https://slsa.dev/provenance/v1\n- Source Repository Owner URI must match:... https://github.com/" + (owner || repo.split("/")[0]) + "\n" + (repo ? "- Source Repository URI must match:......... https://github.com/" + repo + "\n" : "") + "- Subject Alternative Name must match regex: (?i)^https://github.com/" + (repo || owner) + "/\n- OIDC Issuer must match:................... https://token.actions.githubusercontent.com\n\n✓ Verification succeeded!\n\nThe following " + good.length + " attestation" + (good.length > 1 ? "s" : "") + " matched the policy criteria\n");
    good.forEach(function (x) { c.o.line("- Attestation #" + (good.indexOf(x) + 1) + "\n  - Build repo:..... " + x.repo + "\n  - Build workflow:. " + x.workflow.replace(x.repo + "/", "") + "\n  - Signer repo:.... " + x.repo + "\n  - Signer workflow: " + x.workflow.replace(x.repo + "/", "") + "\n"); });
    return 0;
  };
  if (!CMDS.base64) CMDS.base64 = function (args, io, sess) {
    var dec = args.indexOf("-d") > 0 || args.indexOf("--decode") > 0, file = args.slice(1).filter(function (x) { return !/^-/.test(x); })[0];
    var input = file ? (S.readFile(sess, file).content || "") : io.stdin || "";
    out(io, dec ? GH.b64decode(input.replace(/\s+/g, "")) : GH.b64encode(input).replace(/(.{76})/g, "$1\n") + "\n");
    return 0;
  };

  /* ================================================================== Ubuntu 24.04's pip rule (PEP 668) */
  // System Python on Ubuntu 24.04 (runners, Jenkins and Bamboo agents) refuses pip installs: use a venv.
  var pipPep = CMDS.dkpip;
  CMDS.dkpip = function (args, io, sess) {
    if (args[1] === "install" && args.indexOf("--break-system-packages") < 0 && args.indexOf("--target") < 0 && args.indexOf("--prefix") < 0) {
      var pipPath = (S.resolveCommand(sess, args[0]) || {}).path || "";
      if (/^\/usr\/bin\/pip/.test(pipPath) && node(sess.sys, "/usr/lib/python3.12/EXTERNALLY-MANAGED")) {
        errl(io, "error: externally-managed-environment\n\n× This environment is externally managed\n╰─> To install Python packages system-wide, try apt install\n    python3-xyz, where xyz is the package you are trying to\n    install.\n    \n    If you wish to install a non-Debian-packaged Python package,\n    create a virtual environment using python3 -m venv path/to/venv.\n    Then use path/to/venv/bin/python and path/to/venv/bin/pip. Make\n    sure you have python3-full installed.\n    \n    See /usr/share/doc/python3.12/README.venv for more information.\n\nnote: If you believe this is a mistake, please contact your Python installation or OS distribution provider. You can override this, at the risk of breaking your Python installation or OS, by passing --break-system-packages.\nhint: See PEP 668 for the detailed specification.");
        return 1;
      }
    }
    return pipPep(args, io, sess);
  };
  function systemPython(sys, uid) {
    putBin(sys, "/usr/bin/python3", "dkpython"); putBin(sys, "/usr/bin/pip3", "dkpip"); putBin(sys, "/usr/bin/pip", "dkpip");
    S.put(sys, "/usr/lib/python3.12/os.py", "# python 3.12 stdlib\n", 420, 0, 0);
    S.put(sys, "/usr/lib/python3.12/EXTERNALLY-MANAGED", "[externally-managed]\nError=To install Python packages system-wide, try apt install python3-xyz.\n", 420, 0, 0);
    S.mkdirs(sys, "/usr/lib/python3.12/site-packages", 493, 0, 0);
    void uid;
  }
  CI.systemPython = systemPython;
  A.envHooks.push(function (J) { if (!J.rs.pyInit) { J.rs.pyInit = true; systemPython(J.rs); } });

  /* ================================================================== build agents (Jenkins and Bamboo) */
  // A fresh Ubuntu machine with a build user, sharing the laptop's Git objects and the simulated GitHub.
  CI.makeAgent = function (sys, name, o) {
    o = o || {};
    var home = CI.homeSys(sys), rs = S.makeSystem({ host: name });
    rs.gitObjects = home.gitObjects || (home.gitObjects = {});
    rs.github = CI.hubOf(home); rs.hubSys = home; rs.now = home.now; rs.gitTick = home.gitTick || 0;
    var user = o.user || "jenkins", uhome = o.home || "/home/" + user;
    var pw = S.readSys(rs, "/etc/passwd").split("\n").filter(function (l) { var f = l.split(":"); return l && !(+f[2] >= 1000 && +f[2] < 65534); });
    pw.push(user + ":x:1001:1001::" + uhome + ":/bin/bash"); S.put(rs, "/etc/passwd", pw.join("\n") + "\n", 420);
    var gr = S.readSys(rs, "/etc/group").split("\n").filter(function (l) { var f = l.split(":"); return l && !(+f[2] >= 1000 && +f[2] < 65534); });
    gr.push(user + ":x:1001:"); if (o.docker) gr.push("docker:x:118:" + user); S.put(rs, "/etc/group", gr.join("\n") + "\n", 420);
    delete S.mkdirs(rs, "/home").children.dev;
    var hn = S.mkdirs(rs, uhome); hn.uid = 1001; hn.gid = 1001; hn.mode = 493;
    S.put(rs, "/etc/hostname", name + "\n", 420);
    putBin(rs, "/usr/bin/git", "git");
    if (o.docker) { putBin(rs, "/usr/bin/docker", "docker"); S.mkdirs(rs, "/var/lib/docker/volumes", 456, 0, 0); }
    systemPython(rs);
    ["trivy", "cosign", "syft", "kdeploy"].forEach(function (b) { if (o[b] !== false) putBin(rs, "/usr/local/bin/" + b, b); });
    rs[o.kind || "jenkinsAgent"] = name;
    return rs;
  };
  // Put a commit's files in a folder on an agent, as a real Git checkout.
  CI.checkout = function (rs, full, sha, branch, dest, uid) {
    var kids = node(rs, dest); if (kids && kids.type === "d") kids.children = {};
    S.mkdirs(rs, dest, 493, uid || 1001, uid || 1001);
    var repo = G.initRepo(rs, dest, uid || 1001, uid || 1001, branch || "main");
    GH.addFetchSpec(rs, repo, "origin", "https://github.com/" + full);
    if (branch) { G.gwrite(repo, "refs/heads/" + branch, sha + "\n"); G.gwrite(repo, "refs/remotes/origin/" + branch, sha + "\n"); G.gwrite(repo, "HEAD", "ref: refs/heads/" + branch + "\n"); }
    else G.gwrite(repo, "HEAD", sha + "\n");
    var flat = G.commitFlat(CI.homeSys(rs), sha), idx = { entries: {}, conflicts: {} };
    keys(flat).forEach(function (p) { G.writeWork(repo, p, flat[p].sha, flat[p].mode, 18); idx.entries[p] = flat[p]; });
    G.writeIndex(repo, idx);
    (function own(n) { if (!n) return; n.uid = uid || 1001; n.gid = uid || 1001; keys(n.children || {}).forEach(function (k) { own(n.children[k]); }); })(node(rs, dest));
    return repo;
  };
  // Run a shell script on an agent like `sh -xe`: returns {code, text} (text has both streams, in order)
  CI.runScript = function (rs, user, cwd, env, script, o) {
    o = o || {};
    var sess = S.newSession(rs, { user: user });
    sess.vars = {};
    var base = { PATH: "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin", HOME: sess.home, USER: user, SHELL: "/bin/bash", LANG: "C.UTF-8" };
    Object.keys(Object.assign(base, env || {})).forEach(function (k) { sess.vars[k] = { v: String(base[k]), x: true }; });
    sess.vars.IFS = { v: " \t\n", x: false };
    sess.cwd = cwd; sess.vars.PWD = { v: cwd, x: true };
    sess.opts.errexit = o.errexit !== false; sess.opts.xtrace = o.xtrace !== false;
    rs.topSession = sess;
    var buf = [], io = { stdin: "", tty: false, out: function (t) { buf.push(t); }, err: function (t) { buf.push(t); }, note: function (t) { buf.push(t); }, color: function (t) { buf.push(t); } };
    var b0 = rs.buildSecs || 0, t0 = rs.dk ? rs.dk.t : 0, code;
    sess.scriptName = "script.sh";
    try { code = S.runSource(sess, script, io); }
    catch (e) {
      if (e instanceof S.ExitSignal) code = e.code;
      else if (e instanceof S.ShError) { buf.push(e.message + "\n"); code = e.code || 1; }
      else if (e instanceof S.StepLimit) { buf.push("Sending interrupt signal to process\n"); code = 143; }
      else throw e;
    }
    return { code: code || 0, text: buf.join(""), secs: Math.max(1, Math.round((rs.buildSecs || 0) - b0 + (rs.dk ? rs.dk.t - t0 : 0) + 1)), sess: sess };
  };
})(typeof window !== "undefined" ? window : globalThis);
