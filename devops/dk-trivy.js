/* sudo learn — DevOps track: Trivy 0.57 on the laptop. `trivy image` reads what's really in the image's
   layers: the dpkg/apk databases for OS packages, *.dist-info folders for Python packages, and every file of
   every layer for secrets (so a key that a later layer deleted is still found, with the step that added it).
   `trivy fs` scans a folder (requirements.txt, secrets), `trivy config` checks a Dockerfile (AVD-DS rules).
   The vulnerability database is a small sample of real advisories, so totals are smaller than in real life. */
(function (root) {
  "use strict";
  var S = root.ShEngine, M2 = S.M2, U = S.util, Dk = root.Dk;
  var out = U.out, errl = U.errl;

  // Debian-ish version compare: numbers numerically, everything else as text, epoch first
  function vcmp(a, b) {
    function parts(v) { var m = /^(\d+):(.*)$/.exec(v); var ep = m ? +m[1] : 0; return [ep].concat((m ? m[2] : v).split(/(\d+)/).filter(function (x) { return x !== ""; })); }
    var x = parts(String(a)), y = parts(String(b));
    for (var i = 0; i < Math.max(x.length, y.length); i++) {
      var p = x[i], q = y[i];
      if (p === undefined) return -1; if (q === undefined) return 1;
      var pn = /^\d+$/.test(p), qn = /^\d+$/.test(q);
      if (pn && qn) { if (+p !== +q) return +p < +q ? -1 : 1; continue; }
      if (p !== q) { if (p === "~") return -1; if (q === "~") return 1; return p < q ? -1 : 1; }
    }
    return 0;
  }
  Dk.vcmp = vcmp;
  // [type, package, id, severity, fixed ("" = no fix), status, title]
  var DB = [
    ["debian", "zlib1g", "CVE-2023-45853", "CRITICAL", "", "will_not_fix", "zlib: integer overflow and resultant heap-based buffer overflow in zipOpenNewFileInZip4_6"],
    ["debian", "libc6", "CVE-2023-4911", "HIGH", "2.36-9+deb12u3", "fixed", "glibc: buffer overflow in ld.so leading to privilege escalation"],
    ["debian", "libc6", "CVE-2010-4756", "LOW", "", "will_not_fix", "glibc: glob implementation can cause excessive CPU and memory consumption due to crafted glob expressions"],
    ["debian", "perl-base", "CVE-2023-31484", "HIGH", "5.36.0-7+deb12u1", "fixed", "perl: CPAN.pm does not verify TLS certificates when downloading distributions over HTTPS"],
    ["debian", "perl-base", "CVE-2011-4116", "LOW", "", "affected", "perl: File:: Temp insecure temporary file handling"],
    ["debian", "curl", "CVE-2023-38545", "HIGH", "7.88.1-10+deb12u4", "fixed", "curl: heap based buffer overflow in the SOCKS5 proxy handshake"],
    ["debian", "libcurl4", "CVE-2023-38545", "HIGH", "7.88.1-10+deb12u4", "fixed", "curl: heap based buffer overflow in the SOCKS5 proxy handshake"],
    ["debian", "git", "CVE-2024-32002", "CRITICAL", "1:2.39.5-0+deb12u1", "fixed", "git: Recursive clones on case-insensitive filesystems that support symlinks are susceptible to Remote Code Execution"],
    ["debian", "openssh-client", "CVE-2024-6387", "HIGH", "1:9.2p1-2+deb12u3", "fixed", "openssh: regreSSHion - race condition in SSH allows RCE/DoS"],
    ["debian", "libexpat1", "CVE-2024-45491", "CRITICAL", "2.5.0-1+deb12u1", "fixed", "libexpat: Integer Overflow or Wraparound"],
    ["debian", "libaom3", "CVE-2023-6879", "CRITICAL", "3.6.0-1+deb12u1", "fixed", "aom: heap-buffer-overflow on frame size change"],
    ["debian", "libssl3", "CVE-2023-5678", "MEDIUM", "3.0.13-1~deb12u1", "fixed", "openssl: Generating excessively long X9.42 DH keys or checking excessively long X9.42 DH keys or parameters may be very slow"],
    ["python-pkg", "flask", "CVE-2023-30861", "HIGH", "2.3.2, 2.2.5", "fixed", "flask: Possible disclosure of permanent session cookie due to missing Vary: Cookie header"],
    ["python-pkg", "werkzeug", "CVE-2023-25577", "HIGH", "2.2.3", "fixed", "python-werkzeug: high resource usage when parsing multipart form data with many fields"],
    ["python-pkg", "werkzeug", "CVE-2024-34069", "HIGH", "3.0.3", "fixed", "python-werkzeug: user may execute code on a developer's machine"],
    ["python-pkg", "jinja2", "CVE-2024-22195", "MEDIUM", "3.1.3", "fixed", "jinja2: HTML attribute injection when passing user input as keys to xmlattr filter"],
    ["python-pkg", "requests", "CVE-2023-32681", "MEDIUM", "2.31.0", "fixed", "python-requests: Unintended leak of Proxy-Authorization header"],
    ["python-pkg", "requests", "CVE-2024-35195", "MEDIUM", "2.32.0", "fixed", "requests: subsequent requests to the same host ignore cert verification"],
    ["python-pkg", "urllib3", "CVE-2023-43804", "MEDIUM", "2.0.6, 1.26.17", "fixed", "python-urllib3: Cookie request header isn't stripped during cross-origin redirects"],
    ["python-pkg", "pyyaml", "CVE-2020-14343", "CRITICAL", "5.4", "fixed", "PyYAML: incomplete fix for CVE-2020-1747"],
    ["python-pkg", "gunicorn", "CVE-2024-1135", "HIGH", "22.0.0", "fixed", "python-gunicorn: HTTP Request Smuggling due to improper validation of Transfer-Encoding headers"],
    ["python-pkg", "setuptools", "CVE-2024-6345", "HIGH", "70.0.0", "fixed", "pypa/setuptools: Remote code execution via download functions in the package_index module in pypa/setuptools"],
    ["python-pkg", "setuptools", "CVE-2022-40897", "MEDIUM", "65.5.1", "fixed", "pypa-setuptools: Regular Expression Denial of Service (ReDoS) in package_index.py"],
    ["python-pkg", "pip", "CVE-2023-5752", "MEDIUM", "23.3", "fixed", "pip: Mercurial configuration injectable in repo revision when installing via pip"]
  ];
  Dk.TRIVY_DB = DB;
  var SEV = ["UNKNOWN", "LOW", "MEDIUM", "HIGH", "CRITICAL"];
  function affected(row, installed) {
    if (!row[4]) return true;
    var fixes = row[4].split(/,\s*/);
    var lowest = fixes.slice().sort(vcmp)[0];
    return vcmp(installed, lowest) < 0;
  }
  // Secret rules (Trivy's built-in IDs)
  var RULES = [
    { id: "aws-access-key-id", cat: "AWS", title: "AWS Access Key ID", sev: "CRITICAL", re: /\b((?:AKIA|ASIA)[A-Z0-9]{16})\b/ },
    { id: "github-pat", cat: "GitHub", title: "GitHub Personal Access Token", sev: "CRITICAL", re: /\b(ghp_[0-9A-Za-z]{36})\b/ },
    { id: "stripe-secret-token", cat: "Stripe", title: "Stripe Secret Key", sev: "CRITICAL", re: /\b(sk_(?:test|live)_[0-9a-zA-Z]{10,99})\b/ },
    { id: "private-key", cat: "AsymmetricPrivateKey", title: "Asymmetric Private Key", sev: "HIGH", re: /(-----BEGIN[ A-Z0-9_-]{0,100}PRIVATE KEY(?: BLOCK)?-----)/ },
    { id: "slack-web-hook", cat: "Slack", title: "Slack Webhook", sev: "MEDIUM", re: /(https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9+\/]{44,46})/ }
  ];
  Dk.SECRET_RULES = RULES;
  function scanText(path, text, addedBy) {
    var finds = [];
    if (!text || text.length > 200000 || /\x7fELF/.test(text)) return finds;
    var lines = String(text).split("\n");
    lines.forEach(function (l, i) {
      RULES.forEach(function (r) {
        var m = r.re.exec(l); if (!m) return;
        finds.push({ rule: r, path: path, line: i + 1, match: m[1], addedBy: addedBy, context: lines.slice(Math.max(0, i - 1), i + 2).map(function (x, k) { return { n: Math.max(0, i - 1) + k + 1, text: x.split(m[1]).join(m[1].slice(0, Math.min(8, m[1].length)) + new Array(Math.max(4, m[1].length - 8) + 1).join("*")), hit: Math.max(0, i - 1) + k === i }; }) });
      });
    });
    return finds;
  }

  /* ---------------- what's installed in a merged file map */
  function packages(map) {
    var os = null, osPkgs = [], py = [];
    var osr = map["/etc/os-release"] ? map["/etc/os-release"].c : "";
    var id = (/^ID=(\S+)/m.exec(osr) || [])[1], ver = (/^VERSION_ID="?([^"\n]+)/m.exec(osr) || [])[1];
    if (map["/etc/debian_version"] && id === "debian") ver = map["/etc/debian_version"].c.trim();
    if (id) os = { family: id.replace(/"/g, ""), version: ver };
    if (map["/var/lib/dpkg/status"]) osPkgs = Dk.parseDpkg(map["/var/lib/dpkg/status"].c);
    if (map["/lib/apk/db/installed"]) osPkgs = Dk.parseApk(map["/lib/apk/db/installed"].c);
    Object.keys(map).forEach(function (p) { var m = /\/([^/]+)-([^/-]+)\.dist-info\/METADATA$/.exec(p); if (m && /site-packages/.test(p)) py.push({ name: m[1], ver: m[2], path: p }); });
    return { os: os, osPkgs: osPkgs, py: py };
  }
  Dk.trivyPackages = packages;
  function vulnsFor(pk, o) {
    var res = [];
    var dist = pk.os && pk.os.family === "debian" ? "debian" : pk.os && pk.os.family === "alpine" ? "alpine" : null;
    pk.osPkgs.forEach(function (p) { DB.forEach(function (r) { if (r[0] === dist && r[1] === p[0] && affected(r, p[1])) res.push({ cls: "os", lib: p[0], id: r[2], sev: r[3], status: r[5], installed: p[1], fixed: r[4], title: r[6] }); }); });
    var pyv = [];
    pk.py.forEach(function (p) { var n = Dk.pipNorm(p.name); DB.forEach(function (r) { if (r[0] === "python-pkg" && r[1] === n && affected(r, p.ver)) pyv.push({ cls: "py", lib: p.name + " (METADATA)", id: r[2], sev: r[3], status: r[5], installed: p.ver, fixed: r[4], title: r[6] }); }); });
    return { os: filt(res, o), py: filt(pyv, o) };
  }
  function filt(list, o) {
    return list.filter(function (v) { return (!o.severity || o.severity.indexOf(v.sev) >= 0) && (!o.ignoreUnfixed || v.fixed) && !(o.ignore || {})[v.id]; })
      .sort(function (a, b) { return a.lib < b.lib ? -1 : a.lib > b.lib ? 1 : SEV.indexOf(b.sev) - SEV.indexOf(a.sev); });
  }
  function totals(list) {
    var c = { UNKNOWN: 0, LOW: 0, MEDIUM: 0, HIGH: 0, CRITICAL: 0 };
    list.forEach(function (v) { c[v.sev]++; });
    return "Total: " + list.length + " (UNKNOWN: " + c.UNKNOWN + ", LOW: " + c.LOW + ", MEDIUM: " + c.MEDIUM + ", HIGH: " + c.HIGH + ", CRITICAL: " + c.CRITICAL + ")";
  }
  // Box-drawing table with wrapped cells, like Trivy's
  function wrap(s, w) { var outL = [], cur = ""; String(s).split(" ").forEach(function (word) { if ((cur + " " + word).trim().length > w && cur) { outL.push(cur); cur = word; } else cur = (cur + " " + word).trim(); }); if (cur) outL.push(cur); return outL.length ? outL : [""]; }
  function box(head, rows, widths) {
    var w = head.map(function (h, i) { return Math.max(h.length, widths && widths[i] ? 0 : rows.reduce(function (m, r) { return Math.max(m, String(r[i]).length); }, 0), widths && widths[i] ? widths[i] : 0); });
    function sep(l, m, r) { return l + w.map(function (n) { return new Array(n + 3).join("─"); }).join(m) + r + "\n"; }
    function center(s, n) { var p = n - s.length; return new Array(Math.floor(p / 2) + 1).join(" ") + s + new Array(Math.ceil(p / 2) + 1).join(" "); }
    var s = sep("┌", "┬", "┐") + "│" + head.map(function (h, i) { return " " + center(h, w[i]) + " "; }).join("│") + "│\n" + sep("├", "┼", "┤");
    rows.forEach(function (r, ri) {
      var cells = r.map(function (c, i) { return wrap(c, w[i]); }), h = cells.reduce(function (m, c) { return Math.max(m, c.length); }, 1);
      for (var k = 0; k < h; k++) s += "│" + cells.map(function (c, i) { var t = c[k] || ""; return " " + t + new Array(w[i] - t.length + 1).join(" ") + " "; }).join("│") + "│\n";
      if (ri < rows.length - 1 && r[0] && rows[ri + 1][0]) s += sep("├", "┼", "┤");
      else if (ri < rows.length - 1) s += "│" + new Array(w[0] + 3).join(" ") + "├" + w.slice(1).map(function (n) { return new Array(n + 3).join("─"); }).join("┼") + "┤\n";
    });
    return s + sep("└", "┴", "┘");
  }
  function vulnTable(list) {
    var rows = [], last = null;
    list.forEach(function (v) { rows.push([v.lib === last ? "" : v.lib, v.id, v.sev, v.status, v.installed, v.fixed, v.title + " https://avd.aquasec.com/nvd/" + v.id.toLowerCase()]); last = v.lib; });
    return box(["Library", "Vulnerability", "Severity", "Status", "Installed Version", "Fixed Version", "Title"], rows, [0, 0, 0, 0, 0, 0, 44]);
  }
  function secretBlock(f) {
    var bar = "════════════════════════════════════════", thin = "────────────────────────────────────────";
    return f.rule.sev + ": " + f.rule.cat + " (" + f.rule.id + ")\n" + bar + "\n" + f.rule.title + "\n" + thin + "\n " + f.path + ":" + f.line + (f.addedBy ? " (added by '" + f.addedBy + "')" : "") + "\n" + thin + "\n" + f.context.map(function (c) { return ("    " + c.n).slice(-4) + (c.hit ? " [ " : "   ") + c.text; }).join("\n") + "\n" + thin + "\n\n";
  }
  function logLine(sys, lvl, msg) { var d = new Date(Dk.stamp(sys)); return d.toISOString().replace(/\.\d+Z$/, "Z") + "\t" + lvl + "\t" + msg + "\n"; }

  /* ---------------- Dockerfile checks (trivy config) */
  var DS = {
    DS001: { sev: "MEDIUM", title: "':latest' tag used", desc: "When using a 'FROM' statement you should use a specific tag to avoid uncontrolled behavior when the image is updated." },
    DS002: { sev: "HIGH", title: "Image user should not be 'root'", msg: "Specify at least 1 USER command in Dockerfile with non-root user as argument", desc: "Running containers with 'root' user can lead to a container escape situation. It is a best practice to run containers as non-root users, which can be done by adding a 'USER' statement to the Dockerfile." },
    DS005: { sev: "LOW", title: "ADD instead of COPY", desc: "You should use COPY instead of ADD unless you want to extract a tar file. Note that an ADD command will extract a tar file, which adds the risk of Zip-based vulnerabilities. Accordingly, it is advised to use a COPY command, which does not extract tar files." },
    DS013: { sev: "MEDIUM", title: "'RUN cd ...' to change directory", desc: "Use WORKDIR instead of proliferating instructions like 'RUN cd … && do-something', which are hard to read, troubleshoot, and maintain." },
    DS017: { sev: "HIGH", title: "'RUN <package-manager> update' instruction alone", desc: "The instruction 'RUN <package-manager> update' should always be followed by '<package-manager> install' in the same RUN statement." },
    DS026: { sev: "LOW", title: "No HEALTHCHECK defined", msg: "Add HEALTHCHECK instruction in your Dockerfile", desc: "You should add HEALTHCHECK instruction in your docker container images to perform the health check on running containers." },
    DS029: { sev: "HIGH", title: "'apt-get' missing '--no-install-recommends'", desc: "'apt-get' install should use '--no-install-recommends' to minimize image size." }
  };
  function dockerfileChecks(text) {
    var p = Dk.parseDockerfile(text);
    if (p.error) return { error: p.error };
    var fails = [], ins = p.instrs, stages = [];
    ins.forEach(function (x, i) { if (x.kw === "FROM") stages.push(i); });
    var lastStart = stages[stages.length - 1] || 0, finalIns = ins.slice(lastStart);
    ins.forEach(function (x) {
      if (x.kw === "FROM") { var ref = x.args.split(/\s+/)[0]; if (ref !== "scratch" && !/@sha256:/.test(ref) && (/:latest$/.test(ref) || !/:[^/]+$/.test(ref)) && !ins.some(function (y) { return y.kw === "FROM" && new RegExp("\\s+as\\s+" + ref + "$", "i").test(y.args); })) fails.push({ id: "DS001", line: x.line, msg: "Specify a tag in the 'FROM' statement for image '" + ref.split(":")[0] + "'" }); }
      if (x.kw === "ADD" && !/https?:\/\//.test(x.args) && !/\.(tar|tgz|tar\.gz|tar\.xz)\b/.test(x.args)) fails.push({ id: "DS005", line: x.line, msg: "Consider using 'COPY " + x.args + "' command instead of 'ADD " + x.args + "'" });
      if (x.kw === "RUN" && /(^|&&|;)\s*cd\s+\//.test(x.args)) fails.push({ id: "DS013", line: x.line, msg: "RUN should not be used to change directory: '" + x.args + "'. Use 'WORKDIR' statement instead." });
      if (x.kw === "RUN" && /\b(apt-get|apt|apk|yum)\s+update\b/.test(x.args) && !/\binstall\b|\badd\b/.test(x.args)) fails.push({ id: "DS017", line: x.line, msg: "The instruction 'RUN <package-manager> update' should always be followed by '<package-manager> install' in the same RUN statement." });
      if (x.kw === "RUN" && /apt-get\s+(?:-\S+\s+)*install/.test(x.args) && !/--no-install-recommends/.test(x.args)) fails.push({ id: "DS029", line: x.line, msg: "'--no-install-recommends' flag is missed: '" + x.args + "'" });
    });
    var users = finalIns.filter(function (x) { return x.kw === "USER"; });
    var lastUser = users.length ? users[users.length - 1].args.trim().split(":")[0] : null;
    if (!lastUser || lastUser === "root" || lastUser === "0") fails.push({ id: "DS002", line: users.length ? users[users.length - 1].line : 0, msg: users.length ? "Last USER command in Dockerfile should not be 'root'" : DS.DS002.msg });
    if (!ins.some(function (x) { return x.kw === "HEALTHCHECK"; })) fails.push({ id: "DS026", line: 0, msg: DS.DS026.msg });
    return { fails: fails, lines: p.lines };
  }
  Dk.dockerfileChecks = dockerfileChecks;
  function misconfBlock(f, lines, file) {
    var d = DS[f.id], bar = "════════════════════════════════════════", thin = "────────────────────────────────────────";
    var s = "AVD-" + f.id.replace("DS", "DS-0") + " (" + d.sev + "): " + f.msg + "\n" + bar + "\n" + d.desc + "\n\nSee https://avd.aquasec.com/misconfig/" + f.id.toLowerCase() + "\n" + thin + "\n";
    if (f.line) s += " " + file + ":" + f.line + "\n" + thin + "\n " + ("   " + f.line).slice(-3) + " [ " + (lines[f.line - 1] || "") + "\n" + thin + "\n";
    return s + "\n\n";
  }

  /* ---------------- the CLI */
  S.CMDS.trivy = function (args, io, sess) {
    var sys = sess.sys, a = args.slice(1);
    if (sys.dkCtr) { errl(io, "sh: trivy: not found"); return 127; }
    var sub = a.shift();
    if (sub === "--version" || sub === "-v" || sub === "version") { out(io, "Version: 0.57.0\nVulnerability DB:\n  Version: 2\n  UpdatedAt: 2026-11-15 06:12:41.231 +0000 UTC\n  NextUpdate: 2026-11-16 06:12:41.231 +0000 UTC\n"); return 0; }
    if (!sub || sub === "--help" || sub === "-h") { out(io, "Scanner for vulnerabilities in container images, file systems, and Git repositories, as well as for configuration issues and hard-coded secrets\n\nUsage:\n  trivy [global flags] command [flags] target\n\nScanning Commands:\n  config      Scan config files for misconfigurations\n  filesystem  Scan local filesystem (alias: fs)\n  image       Scan a container image (alias: i)\n\nExamples:\n  trivy image python:3.12-slim\n  trivy image --severity HIGH,CRITICAL --exit-code 1 myapp:1.0\n  trivy fs --scanners vuln,secret .\n  trivy config Dockerfile\n"); return 0; }
    var o = { severity: null, exitCode: 0, ignoreUnfixed: false, scanners: null, quiet: false, format: "table", target: null };
    for (var i = 0; i < a.length; i++) {
      var x = a[i], m;
      if ((m = /^--severity(?:=(.*))?$/.exec(x)) || x === "-s") { var v = m && m[1] != null ? m[1] : a[++i]; o.severity = String(v || "").toUpperCase().split(","); var badSev = o.severity.filter(function (s) { return SEV.indexOf(s) < 0; })[0]; if (badSev) { errl(io, logLine(sys, "FATAL", "Fatal error\tflag error: severity error: unknown severity option: unknown severity: " + badSev).trim()); return 1; } }
      else if ((m = /^--exit-code(?:=(.*))?$/.exec(x))) o.exitCode = +(m[1] != null ? m[1] : a[++i]);
      else if (x === "--ignore-unfixed") o.ignoreUnfixed = true;
      else if ((m = /^--scanners(?:=(.*))?$/.exec(x)) || (m = /^--security-checks(?:=(.*))?$/.exec(x))) o.scanners = String(m[1] != null ? m[1] : a[++i]).split(",").map(function (s) { return s === "config" ? "misconfig" : s; });
      else if (x === "-q" || x === "--quiet") o.quiet = true;
      else if ((m = /^(?:-f|--format)(?:=(.*))?$/.exec(x))) o.format = m[1] != null ? m[1] : a[++i];
      else if ((m = /^--ignorefile(?:=(.*))?$/.exec(x))) o.ignorefile = m[1] != null ? m[1] : a[++i];
      else if (x === "--skip-db-update" || x === "--no-progress" || x === "--offline-scan" || x === "--debug") continue;
      else if (/^--(timeout|cache-dir|pkg-types|output|o)(=|$)/.test(x)) { if (!/=/.test(x)) i++; }
      else if (/^-/.test(x)) { errl(io, "Error: unknown flag: " + x); return 1; }
      else o.target = x;
    }
    if (sub === "i") sub = "image"; if (sub === "filesystem") sub = "fs"; if (sub === "rootfs") sub = "fs";
    if (["image", "fs", "config"].indexOf(sub) < 0) { errl(io, "Error: unknown command \"" + sub + "\" for \"trivy\"\nRun 'trivy --help' for usage."); return 1; }
    if (!o.target) { errl(io, logLine(sys, "FATAL", "Fatal error\t" + (sub === "image" ? "image name or path is required" : "the target path is required")).trim()); return 1; }
    // .trivyignore in the current folder
    o.ignore = {};
    var ign = M2.rd(sys, Dk.absHost(sess, o.ignorefile || ".trivyignore"));
    if (ign) ign.split("\n").forEach(function (l) { l = l.replace(/#.*$/, "").trim(); if (l) o.ignore[l] = true; });
    var head = "", report = "", found = 0, json = { SchemaVersion: 2, ArtifactName: o.target, ArtifactType: sub === "image" ? "container_image" : "filesystem", Results: [] };
    var firstRun = !sys.trivyDb; sys.trivyDb = true;
    if (!o.quiet && firstRun && sub !== "config") head += logLine(sys, "INFO", "[vulndb] Need to update DB") + logLine(sys, "INFO", "[vulndb] Downloading vulnerability DB...") + logLine(sys, "INFO", "[vulndb] Downloading artifact...\trepo=\"mirror.gcr.io/aquasec/trivy-db:2\"") + logLine(sys, "INFO", "[vulndb] Artifact successfully downloaded\trepo=\"mirror.gcr.io/aquasec/trivy-db:2\"");

    if (sub === "config") {
      var p = Dk.absHost(sess, o.target), n = Dk.fsNode(sys, p);
      if (!n) { errl(io, logLine(sys, "FATAL", "Fatal error\tlstat " + p + ": no such file or directory").trim()); return 1; }
      var files = n.type === "d" ? Object.keys(n.children).filter(function (k) { return /^Dockerfile|\.dockerfile$|^Containerfile$/i.test(k); }).map(function (k) { return { name: k, text: n.children[k].content }; }) : [{ name: p.split("/").pop(), text: n.content }];
      if (!o.quiet) head += logLine(sys, "INFO", "[misconfig] Misconfiguration scanning is enabled") + logLine(sys, "INFO", "Detected config files\tnum=" + files.length);
      files.forEach(function (f) {
        var r = dockerfileChecks(f.text);
        if (r.error) { report += f.name + " (dockerfile)\n\n" + r.error + "\n"; return; }
        var fails = r.fails.filter(function (x) { return (!o.severity || o.severity.indexOf(DS[x.id].sev) >= 0) && !o.ignore["AVD-" + x.id.replace("DS", "DS-0")] && !o.ignore[x.id]; });
        var c = { UNKNOWN: 0, LOW: 0, MEDIUM: 0, HIGH: 0, CRITICAL: 0 }; fails.forEach(function (x) { c[DS[x.id].sev]++; });
        found += fails.length;
        report += "\n" + f.name + " (dockerfile)\n\nTests: 27 (SUCCESSES: " + (27 - fails.length) + ", FAILURES: " + fails.length + ")\nFailures: " + fails.length + " (UNKNOWN: 0, LOW: " + c.LOW + ", MEDIUM: " + c.MEDIUM + ", HIGH: " + c.HIGH + ", CRITICAL: " + c.CRITICAL + ")\n\n" + fails.map(function (x) { return misconfBlock(x, r.lines, f.name); }).join("");
        json.Results.push({ Target: f.name, Class: "config", Type: "dockerfile", Misconfigurations: fails.map(function (x) { return { ID: x.id, AVDID: "AVD-" + x.id.replace("DS", "DS-0"), Title: DS[x.id].title, Message: x.msg, Severity: DS[x.id].sev, Status: "FAIL" }; }) });
      });
      return finish();
    }

    var scanners = o.scanners || (sub === "image" ? ["vuln", "secret"] : ["vuln", "secret"]);
    var layers, label, map;
    if (sub === "image") {
      var img = Dk.findImage(sys, o.target);
      if (!img) {
        // trivy pulls from the registry itself when the image isn't local
        var pr = Dk.parseRef(o.target), hit = !Dk.regAccess(sess, pr, false) && Dk.regLookup(sys, pr);
        if (!hit) { errl(io, logLine(sys, "FATAL", "Fatal error\trun error: image scan error: scan error: unable to initialize a scan service: unable to initialize an image scan service: unable to find the specified image \"" + o.target + "\" in [\"docker\" \"containerd\" \"podman\" \"remote\"]: 4 errors occurred:\n\t* docker error: unable to inspect the image (" + o.target + "): Error response from daemon: No such image: " + Dk.shortName(pr) + "\n\t* remote error: GET https://" + (pr.registry === "docker.io" ? "index.docker.io" : pr.registry) + "/v2/" + pr.repo + "/manifests/" + pr.tag + ": " + (pr.registry === "docker.io" ? "MANIFEST_UNKNOWN: manifest unknown" : "UNAUTHORIZED: authentication required")).trim()); return 1; }
        img = hit.img;
      }
      layers = img.layers; map = Dk.merge(layers); label = Dk.shortName(Dk.parseRef(o.target));
    } else {
      var root2 = Dk.absHost(sess, o.target), dn = Dk.fsNode(sys, root2);
      if (!dn) { errl(io, logLine(sys, "FATAL", "Fatal error\trun error: fs scan error: scan error: scan failed: failed analysis: lstat " + root2 + ": no such file or directory").trim()); return 1; }
      map = dn.type === "d" ? Dk.mapFrom(dn, "/") : { ["/" + root2.split("/").pop()]: { t: "f", c: dn.content } };
      label = o.target;
      layers = null;
    }
    if (!o.quiet) {
      if (scanners.indexOf("vuln") >= 0) head += logLine(sys, "INFO", "[vuln] Vulnerability scanning is enabled");
      if (scanners.indexOf("secret") >= 0) head += logLine(sys, "INFO", "[secret] Secret scanning is enabled") + logLine(sys, "INFO", "[secret] If your scanning is slow, please try '--scanners vuln' to disable secret scanning");
    }
    if (scanners.indexOf("vuln") >= 0) {
      if (sub === "image") {
        var pk = packages(map), vs = vulnsFor(pk, o);
        if (!o.quiet) { if (pk.os) head += logLine(sys, "INFO", "Detected OS\tfamily=\"" + pk.os.family + "\" version=\"" + pk.os.version + "\"") + logLine(sys, "INFO", "[" + pk.os.family + "] Detecting vulnerabilities...\tos_version=\"" + String(pk.os.version).split(".")[0] + "\" pkg_num=" + pk.osPkgs.length); else head += logLine(sys, "WARN", "OS is not detected."); head += logLine(sys, "INFO", "Number of language-specific files\tnum=" + (pk.py.length ? 1 : 0)); if (pk.py.length) head += logLine(sys, "INFO", "[python-pkg] Detecting vulnerabilities..."); }
        if (pk.os) { report += "\n" + label + " (" + pk.os.family + " " + pk.os.version + ")\n\n" + totals(vs.os) + "\n\n" + (vs.os.length ? vulnTable(vs.os) + "\n" : ""); json.Results.push({ Target: label + " (" + pk.os.family + " " + pk.os.version + ")", Class: "os-pkgs", Type: pk.os.family, Vulnerabilities: vs.os.map(jsonV) }); }
        if (pk.py.length) { report += "\nPython (python-pkg)\n\n" + totals(vs.py) + "\n\n" + (vs.py.length ? vulnTable(vs.py) + "\n" : ""); json.Results.push({ Target: "Python", Class: "lang-pkgs", Type: "python-pkg", Vulnerabilities: vs.py.map(jsonV) }); }
        found += vs.os.length + vs.py.length;
      } else {
        // requirements.txt files in the folder
        Object.keys(map).filter(function (p) { return /(^|\/)requirements[^/]*\.txt$/.test(p); }).sort().forEach(function (p) {
          var py = [];
          map[p].c.split("\n").forEach(function (l) { var m = /^\s*([A-Za-z0-9_.-]+)(?:\[[^\]]*\])?\s*==\s*([\w.]+)/.exec(l); if (m) py.push({ name: m[1], ver: m[2] }); });
          var vs2 = vulnsFor({ os: null, osPkgs: [], py: py }, o).py.map(function (v) { v.lib = v.lib.replace(" (METADATA)", ""); return v; });
          if (!o.quiet) head += logLine(sys, "INFO", "[pip] Detecting vulnerabilities...");
          report += "\n" + p.slice(1) + " (pip)\n\n" + totals(vs2) + "\n\n" + (vs2.length ? vulnTable(vs2) + "\n" : "");
          json.Results.push({ Target: p.slice(1), Class: "lang-pkgs", Type: "pip", Vulnerabilities: vs2.map(jsonV) });
          found += vs2.length;
        });
      }
    }
    if (scanners.indexOf("secret") >= 0) {
      var finds = [];
      if (layers) layers.forEach(function (L) { Object.keys(L.files).forEach(function (p) { var e = L.files[p]; if (e.t !== "f" || /site-packages|node_modules|\/usr\/(lib|share)\//.test(p)) return; finds = finds.concat(scanText(p, e.c, /\bbuildkit\b|^RUN |^COPY |^ADD /.test(L.by) ? L.by : null)); }); });
      else Object.keys(map).forEach(function (p) { var e = map[p]; if (e.t !== "f" || /node_modules|\.git\//.test(p)) return; finds = finds.concat(scanText(p.slice(1), e.c, null)); });
      finds = finds.filter(function (f) { return (!o.severity || o.severity.indexOf(f.rule.sev) >= 0) && !o.ignore[f.rule.id]; });
      var byFile = {};
      finds.forEach(function (f) { (byFile[f.path] = byFile[f.path] || []).push(f); });
      Object.keys(byFile).sort().forEach(function (p) {
        var c = { UNKNOWN: 0, LOW: 0, MEDIUM: 0, HIGH: 0, CRITICAL: 0 }; byFile[p].forEach(function (f) { c[f.rule.sev]++; });
        report += "\n" + p + " (secrets)\n\nTotal: " + byFile[p].length + " (UNKNOWN: 0, LOW: " + c.LOW + ", MEDIUM: " + c.MEDIUM + ", HIGH: " + c.HIGH + ", CRITICAL: " + c.CRITICAL + ")\n\n" + byFile[p].map(secretBlock).join("");
        json.Results.push({ Target: p, Class: "secret", Secrets: byFile[p].map(function (f) { return { RuleID: f.rule.id, Category: f.rule.cat, Severity: f.rule.sev, Title: f.rule.title, StartLine: f.line, Layer: f.addedBy ? { CreatedBy: f.addedBy } : undefined }; }) });
      });
      found += finds.length;
    }
    if (scanners.indexOf("misconfig") >= 0 && sub === "fs") {
      Object.keys(map).filter(function (p) { return /(^|\/)Dockerfile$/.test(p); }).forEach(function (p) {
        var r = dockerfileChecks(map[p].c); if (r.error) return;
        var fails = r.fails.filter(function (x) { return (!o.severity || o.severity.indexOf(DS[x.id].sev) >= 0) && !o.ignore["AVD-" + x.id.replace("DS", "DS-0")]; });
        found += fails.length;
        report += "\n" + p.slice(1) + " (dockerfile)\n\nTests: 27 (SUCCESSES: " + (27 - fails.length) + ", FAILURES: " + fails.length + ")\n\n" + fails.map(function (x) { return misconfBlock(x, r.lines, p.slice(1)); }).join("");
      });
    }
    return finish();
    function finish() {
      Dk.tick(sys, firstRun ? 4 : 1);
      if (o.format === "json") { out(io, JSON.stringify(json, null, 2) + "\n"); }
      else { if (head) errl(io, head.replace(/\n$/, "")); out(io, report.replace(/^\n/, "")); }
      sys.trivyRuns = (sys.trivyRuns || []).concat([{ sub: sub, target: o.target, found: found, opts: { severity: o.severity, exitCode: o.exitCode, ignoreUnfixed: o.ignoreUnfixed, scanners: o.scanners }, cmd: sys.cmdIndex }]);
      return found && o.exitCode ? o.exitCode : 0;
    }
  };
  function jsonV(v) { return { VulnerabilityID: v.id, PkgName: v.lib.replace(" (METADATA)", ""), InstalledVersion: v.installed, FixedVersion: v.fixed, Status: v.status, Severity: v.sev, Title: v.title }; }
})(typeof window !== "undefined" ? window : globalThis);
