/* sudo learn — Git security for the Git track (Module 4): secret detection rules shared by a simulated gitleaks,
   GitHub secret scanning and push protection; git filter-repo; SSH commit signing (git commit -S, verify-commit,
   log --show-signature) and GitHub's Verified badge; Dependabot alerts and security updates, the dependency graph
   and SBOM export, npm audit; CodeQL code scanning; dependency review; OIDC tokens for workflows; deploy keys,
   team access and the organisation audit log; and Kestrel Cloud's kc CLI for the incident lab. */
(function (root) {
  "use strict";
  var S = root.ShEngine, G = root.GitCore, GC = root.GitCmds, X = GC.X, GH = root.GitHub, A = root.GitActions, M2 = S.M2;
  var SEC = {};
  function keys(o) { return o && typeof o === "object" ? Object.keys(o) : []; }
  function has(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function now(sys) { return G.clock(sys); }
  function lines(t) { var a = String(t == null ? "" : t).split("\n"); if (a.length && a[a.length - 1] === "") a.pop(); return a; }
  function rd(sys, p) { var n = G.nodeAt(sys, p); return n && n.type === "f" ? n.content : null; }
  function outl(io, t) { io.out(t + "\n"); }
  function errl(io, t) { io.err(t + "\n"); }
  function hash(s) { var h = 2166136261; s = String(s); for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h; }

  /* ================================================================== secret rules (gitleaks' defaults, simplified) */
  // gh: the name GitHub secret scanning uses (GitHub only alerts on these, plus custom patterns)
  var RULES = [
    { id: "github-pat", desc: "Uncovered a GitHub Personal Access Token, potentially leading to unauthorized repository access and sensitive content exposure.", re: /\bghp_[0-9a-zA-Z]{36}\b/g, gh: "GitHub Personal Access Token", type: "github_personal_access_token" },
    { id: "github-fine-grained-pat", desc: "Found a GitHub Fine-Grained Personal Access Token, risking unauthorized repository access and code manipulation.", re: /\bgithub_pat_[0-9a-zA-Z_]{82}\b/g, gh: "GitHub Personal Access Token (fine-grained)", type: "github_personal_access_token" },
    { id: "github-oauth", desc: "Discovered a GitHub OAuth Access Token, posing a risk of compromised GitHub account integrations and data leaks.", re: /\bgho_[0-9a-zA-Z]{36}\b/g, gh: "GitHub OAuth Access Token", type: "github_oauth_access_token" },
    { id: "github-app-token", desc: "Identified a GitHub App Token, which may compromise GitHub application integrations and source code security.", re: /\b(?:ghu|ghs)_[0-9a-zA-Z]{36}\b/g, gh: "GitHub App Installation Access Token", type: "github_app_installation_access_token" },
    { id: "aws-access-token", desc: "Identified a pattern that may indicate AWS credentials, risking unauthorized cloud resource access and data breaches on AWS platforms.", re: /\b(?:A3T[A-Z0-9]|AKIA|ASIA|ABIA|ACCA)[A-Z0-9]{16}\b/g, gh: "Amazon AWS Access Key ID", type: "aws_access_key_id" },
    { id: "private-key", desc: "Identified a Private Key, which may compromise cryptographic security and sensitive data encryption.", re: /-----BEGIN[ A-Z0-9_-]{0,100}PRIVATE KEY(?: BLOCK)?-----/g, gh: null, type: "private_key" },
    { id: "slack-webhook-url", desc: "Discovered a Slack Webhook, which could lead to unauthorized message posting and data leakage in Slack channels.", re: /https:\/\/hooks\.slack\.com\/(?:services|workflows|triggers)\/[A-Za-z0-9+\/]{43,56}/g, gh: "Slack Incoming Webhook URL", type: "slack_incoming_webhook_url" },
    { id: "stripe-access-token", desc: "Found a Stripe Access Token, posing a risk to payment processing services and sensitive financial data.", re: /\b(?:sk|rk)_(?:test|live|prod)_[a-zA-Z0-9]{10,99}\b/g, gh: "Stripe API Key", type: "stripe_api_key" }
  ];
  var GENERIC = { id: "generic-api-key", desc: "Detected a Generic API Key, potentially exposing access to various services and sensitive operations.", re: /[\w.-]{0,50}?(?:access|auth|api|credential|creds|key|passwd|password|secret|token)(?:[0-9a-z\-_\t .]{0,20})(?:[\s'"]){0,3}(?:=|>|:{1,3}=|\|\|:|<=|=>|:|\?=)(?:'|"|\s|=|`){0,5}([0-9a-z\-_.=+\/]{10,150})(?:['"\s;`]|$)/gi, entropy: 3.5 };
  SEC.RULES = RULES;
  function entropy(s) { var f = {}, n = s.length, e = 0; for (var i = 0; i < n; i++) f[s.charAt(i)] = (f[s.charAt(i)] || 0) + 1; keys(f).forEach(function (k) { var p = f[k] / n; e -= p * Math.log(p) / Math.log(2); }); return e; }
  SEC.entropy = entropy;
  // Find secrets in a line: [{rule, secret, match}]. rules: [{id, re, gh, entropy, group}]
  function scanLine(line, rules, opts) {
    var out = [], seen = {};
    rules.forEach(function (r) {
      var re = new RegExp(r.re.source, r.re.flags.indexOf("g") >= 0 ? r.re.flags : r.re.flags + "g"), m;
      while ((m = re.exec(line))) {
        var sec = r.group !== undefined ? m[r.group] : m[1] !== undefined && r === GENERIC ? m[1] : m[0];
        if (!sec || seen[sec]) continue;
        if (r.entropy && entropy(sec) < r.entropy) continue;
        if (r === GENERIC && out.some(function (x) { return x.secret.indexOf(sec) >= 0 || sec.indexOf(x.secret) >= 0; })) continue;
        if (r === GENERIC && /^[a-z_]+$/i.test(sec)) continue;
        seen[sec] = 1;
        out.push({ rule: r, secret: sec, match: m[0].replace(/[\s;]+$/, "") });
        if (m[0] === "") re.lastIndex++;
      }
    });
    if (opts && opts.allow) out = out.filter(function (x) { return !opts.allow.some(function (re) { return re.test(x.secret); }); });
    return out;
  }
  SEC.scanLine = scanLine;
  // Lines a commit added, per file: {path: [{n, text}]}
  function addedLines(sys, oldSha, newSha) {
    var a = oldSha ? G.commitFlat(sys, oldSha) : {}, b = G.commitFlat(sys, newSha), out = {};
    keys(b).forEach(function (p) {
      if (a[p] && a[p].sha === b[p].sha) return;
      var nl = String(G.blobText(sys, b[p].sha)).split("\n"), ol = a[p] ? String(G.blobText(sys, a[p].sha)).split("\n") : [], have = {};
      ol.forEach(function (l) { have[l] = (have[l] || 0) + 1; });
      var adds = [];
      nl.forEach(function (l, i) { if (have[l]) { have[l]--; return; } if (l !== "") adds.push({ n: i + 1, text: l }); });
      if (adds.length) out[p] = adds;
    });
    return out;
  }
  SEC.addedLines = addedLines;
  // Secrets GitHub knows (partner patterns + the repository's / organisation's custom patterns)
  function ghRules(sys, r) {
    var out = RULES.filter(function (x) { return x.gh; });
    var org = GH.hub(sys).orgs[r.owner], custom = (r.customPatterns || []).concat(org && org.customPatterns || []);
    custom.forEach(function (cp) { out.push({ id: "custom-" + cp.name.toLowerCase().replace(/\W+/g, "-"), gh: cp.name, re: new RegExp(cp.regex, "g"), type: "custom_pattern", custom: true, pushProtection: cp.pushProtection !== false }); });
    return out;
  }
  SEC.ghRules = ghRules;

  /* ================================================================== a little TOML (for .gitleaks.toml) */
  function parseToml(text) {
    var outObj = {}, cur = outObj, ls = String(text).replace(/\r/g, "").split("\n"), i = 0;
    function val(s) {
      s = s.trim();
      if (/^'''/.test(s)) return s.replace(/^'''|'''$/g, "");
      if (/^'/.test(s)) return s.replace(/^'|'\s*(#.*)?$/g, "");
      if (/^"/.test(s)) { var m = /^"((?:[^"\\]|\\.)*)"/.exec(s); return m ? m[1].replace(/\\\\/g, "\\").replace(/\\"/g, '"') : s; }
      if (/^\[/.test(s)) { var inner = s.replace(/^\[|\]\s*(#.*)?$/g, ""), items = [], q = null, buf = ""; for (var k = 0; k < inner.length; k++) { var ch = inner.charAt(k); if (q) { buf += ch; if (ch === q && (q === "'" || inner.charAt(k - 1) !== "\\")) q = null; continue; } if (ch === "'" || ch === '"') { q = ch; buf += ch; continue; } if (ch === ",") { if (buf.trim()) items.push(val(buf)); buf = ""; continue; } buf += ch; } if (buf.trim()) items.push(val(buf)); return items; }
      if (/^(true|false)\b/.test(s)) return /^true/.test(s);
      if (/^-?\d+(\.\d+)?\b/.test(s)) return +/^-?\d+(\.\d+)?/.exec(s)[0];
      return s.replace(/\s*#.*$/, "");
    }
    for (; i < ls.length; i++) {
      var l = ls[i].trim();
      if (!l || l.charAt(0) === "#") continue;
      var m;
      if ((m = /^\[\[\s*([\w.]+)\s*\]\]$/.exec(l))) { var path = m[1].split("."), o = outObj; path.slice(0, -1).forEach(function (p) { o = o[p] = o[p] || {}; }); var last = path[path.length - 1]; o[last] = o[last] || []; cur = {}; o[last].push(cur); continue; }
      if ((m = /^\[\s*([\w.]+)\s*\]$/.exec(l))) { var p2 = m[1].split("."), o2 = outObj; p2.forEach(function (p) { if (Array.isArray(o2[p])) o2 = o2[p][o2[p].length - 1]; else o2 = o2[p] = o2[p] || {}; }); cur = o2; continue; }
      if ((m = /^([\w.-]+)\s*=\s*(.*)$/.exec(l))) {
        var v = m[2];
        if (/^'''/.test(v) && !/^'''[\s\S]*'''\s*$/.test(v.length > 3 ? v : "")) { var acc = v; while (i + 1 < ls.length && !/'''\s*$/.test(acc.slice(3))) acc += "\n" + ls[++i]; v = acc; }
        if (/^\[/.test(v) && !/\]\s*(#.*)?$/.test(v)) { var acc2 = v; while (i + 1 < ls.length && !/\]\s*(#.*)?$/.test(acc2)) acc2 += " " + ls[++i].trim(); v = acc2; }
        cur[m[1]] = val(v);
        continue;
      }
      throw new Error("toml: line " + (i + 1) + ": expected key = value");
    }
    return outObj;
  }
  SEC.parseToml = parseToml;

  /* ================================================================== gitleaks 8.18 */
  M2.CATALOG.push({ name: "gitleaks", ver: "8.18.2-1", arch: "amd64", section: "universe/devel", size: 20140, desc: "Scan git repos (or files) for secrets", deps: [], bins: ["gitleaks"], sbins: [], installed: false, auto: false, archive: "noble" });
  M2.CATALOG.push({ name: "git-filter-repo", ver: "2.38.0-2", arch: "all", section: "universe/vcs", size: 432, desc: "Quickly rewrite git repository history", deps: ["git", "python3"], bins: ["git-filter-repo"], sbins: [], installed: false, auto: false, archive: "noble" });
  var BANNER = "\n    ○\n    │╲\n    │ ○\n    ○ ░\n    ░    gitleaks\n";
  function clockStr(sys) { var d = new Date(now(sys) * 1000), h = d.getUTCHours(), m = d.getUTCMinutes(); return ((h % 12) || 12) + ":" + (m < 10 ? "0" : "") + m + (h < 12 ? "AM" : "PM"); }
  // the rules gitleaks uses in a directory: defaults, or .gitleaks.toml / -c (extend.useDefault keeps the defaults)
  function leakRules(sess, top, cfgPath) {
    var p = cfgPath ? (cfgPath.charAt(0) === "/" ? cfgPath : S.normAbs(sess.cwd + "/" + cfgPath)) : top + "/.gitleaks.toml", t = rd(sess.sys, p);
    if (t === null) { if (cfgPath) return { error: "unable to load gitleaks config, err: open " + cfgPath + ": no such file or directory" }; return { rules: RULES.concat([GENERIC]), allow: { paths: [], regexes: [] } }; }
    var cfg;
    try { cfg = parseToml(t); } catch (e) { return { error: "unable to load gitleaks config, err: " + e.message }; }
    var rules = cfg.extend && cfg.extend.useDefault ? RULES.concat([GENERIC]) : [];
    (cfg.rules || []).forEach(function (r) {
      if (!r.id || !r.regex) return;
      var re; try { re = new RegExp(String(r.regex).replace(/^\(\?i\)/, ""), /^\(\?i\)/.test(String(r.regex)) ? "gi" : "g"); } catch (e) { return; }
      rules.push({ id: r.id, desc: r.description || r.id, re: re, group: r.secretGroup, entropy: r.entropy });
    });
    var al = cfg.allowlist || {};
    return { rules: rules, allow: { paths: (al.paths || []).map(function (x) { try { return new RegExp(x); } catch (e) { return /^$/; } }), regexes: (al.regexes || []).map(function (x) { try { return new RegExp(x); } catch (e) { return /^$/; } }), commits: al.commits || [] } };
  }
  function ignoreList(sys, top, base) { var t = rd(sys, top + "/.gitleaksignore") || ""; if (base) { var b = rd(sys, base); if (b) { try { JSON.parse(b).forEach(function (f) { t += "\n" + f.Fingerprint; }); } catch (e) { /* ignore a bad baseline */ } } } return lines(t).map(function (l) { return l.trim(); }).filter(function (l) { return l && l.charAt(0) !== "#"; }); }
  function iso(t) { return new Date(t * 1000).toISOString().replace(/\.\d{3}Z$/, "Z"); }
  CMDS_init();
  function CMDS_init() {
    S.CMDS.gitleaks = function (args, io, sess) {
      var a = args.slice(1), sub = a[0], o = { v: false, redact: false, staged: false, noGit: false, exit: 1, banner: true, source: ".", report: null, fmt: "json", cfg: null, logOpts: null, baseline: null };
      if (!sub || sub === "help" || sub === "--help" || sub === "-h") { outl(io, "Gitleaks scans code, past or present, for secrets\n\nUsage:\n  gitleaks [command]\n\nAvailable Commands:\n  detect      detect secrets in code\n  help        Help about any command\n  protect     protect secrets in code\n  version     display gitleaks version\n\nFlags:\n  -c, --config string          config file path\n      --exit-code int          exit code when leaks have been encountered (default 1)\n  -h, --help                   help for gitleaks\n      --no-banner              suppress banner\n      --redact uint[=100]      redact secrets from logs and stdout\n  -f, --report-format string   output format (json, csv, junit, sarif) (default \"json\")\n  -r, --report-path string     report file\n  -v, --verbose                show verbose output from scan\n\nUse \"gitleaks [command] --help\" for more information about a command."); return 0; }
      if (sub === "version" || sub === "--version") { outl(io, "8.18.2"); return 0; }
      if (sub !== "detect" && sub !== "protect") { errl(io, "Error: unknown command \"" + sub + "\" for \"gitleaks\"\nRun 'gitleaks --help' for usage." + (sub === "git" || sub === "dir" ? "\n(gitleaks git and gitleaks dir arrived in 8.19; Ubuntu's 8.18 has detect and protect.)" : "")); return 1; }
      for (var i = 1; i < a.length; i++) {
        var x = a[i], mm = /^(--[\w-]+)=(.*)$/.exec(x), name = mm ? mm[1] : x, v2 = mm ? mm[2] : null;
        function next() { return v2 !== null ? v2 : a[++i]; }
        if (name === "-v" || name === "--verbose") o.v = true;
        else if (name === "--redact") o.redact = true;
        else if (name === "--staged") o.staged = true;
        else if (name === "--no-git") o.noGit = true;
        else if (name === "--no-banner") o.banner = false;
        else if (name === "--exit-code") o.exit = +next();
        else if (name === "-s" || name === "--source") o.source = next();
        else if (name === "-r" || name === "--report-path") o.report = next();
        else if (name === "-f" || name === "--report-format") o.fmt = next();
        else if (name === "-c" || name === "--config") o.cfg = next();
        else if (name === "--log-opts") o.logOpts = next();
        else if (name === "-b" || name === "--baseline-path") o.baseline = next();
        else if (name === "--log-level" || name === "--max-target-megabytes" || name === "--gitleaks-ignore-path") next();
        else if (name === "--pre-commit") continue;
        else { errl(io, "Error: unknown flag: " + x); return 126; }
      }
      var srcAbs = S.normAbs(o.source.charAt(0) === "/" ? o.source : sess.cwd + "/" + o.source), sys = sess.sys, repo = G.findRepo(sys, srcAbs), findings = [], t0 = "";
      if (o.banner) io.err(BANNER + "\n");
      var lr = leakRules(sess, repo ? repo.top : srcAbs, o.cfg);
      if (lr.error) { errl(io, clockStr(sys) + " FTL " + lr.error); return 1; }
      var ign = ignoreList(sys, repo ? repo.top : srcAbs, o.baseline ? S.normAbs(sess.cwd + "/" + o.baseline) : null);
      function pathOk(p) { return !lr.allow.paths.some(function (re) { return re.test(p); }); }
      function add(file, ln, text, commit) {
        scanLine(text, lr.rules, { allow: lr.allow.regexes }).forEach(function (f) {
          if (!pathOk(file)) return;
          var fp = (commit ? commit.sha + ":" : "") + file + ":" + f.rule.id + ":" + ln;
          if (ign.indexOf(fp) >= 0) return;
          findings.push({ file: file, line: ln, rule: f.rule, secret: f.secret, match: f.match, commit: commit, fp: fp });
        });
      }
      var scanned = 0, what;
      if (sub === "detect" && (o.noGit || !repo)) {
        if (!o.noGit && !repo) { errl(io, clockStr(sys) + " ERR [git] fatal: not a git repository (or any of the parent directories): .git\n" + clockStr(sys) + " ERR git error encountered, see logs\n" + clockStr(sys) + " WRN partial scan completed in 6.12ms\n" + clockStr(sys) + " WRN no leaks found in partial scan"); return 1; }
        (function walk(dir, rel) { var n = G.nodeAt(sys, dir); if (!n || n.type !== "d") return; keys(n.children).sort().forEach(function (k) { if (k === ".git") return; var ch = n.children[k], p = rel ? rel + "/" + k : k; if (ch.type === "d") walk(dir + "/" + k, p); else if (ch.type === "f") { scanned += ch.content.length; String(ch.content).split("\n").forEach(function (l, ix) { add(p, ix + 1, l, null); }); } }); })(srcAbs, "");
        what = kbScanned(scanned);
      } else if (sub === "detect") {
        var tips = [];
        if (o.logOpts && /\.\./.test(o.logOpts)) { var rg = /(\S*)\.\.(\S*)/.exec(o.logOpts); try { tips = [G.peel(sys, G.resolve(repo, rg[2] || "HEAD"))]; var stop = rg[1] ? G.ancestors(sys, G.peel(sys, G.resolve(repo, rg[1]))) : {}; } catch (e) { errl(io, clockStr(sys) + " ERR [git] fatal: bad revision '" + o.logOpts + "'"); return 1; } }
        else { G.listRefs(repo, "refs/").forEach(function (r) { if (!/^refs\/stash/.test(r.name)) tips.push(G.peel(sys, r.sha)); }); var hh = G.head(repo); if (hh.sha) tips.push(hh.sha); }
        var commits = {};
        tips.forEach(function (t) { if (t && G.commitOf(sys, t)) G.ancestors(sys, t, commits); });
        keys(commits).forEach(function (s) {
          if (stop && stop[s]) return;
          if (lr.allow.commits && lr.allow.commits.indexOf(s) >= 0) return;
          scanned++;
          var co = G.commitOf(sys, s), al = addedLines(sys, co.parents[0] || null, s);
          keys(al).forEach(function (p) { al[p].forEach(function (x) { add(p, x.n, x.text, { sha: s, co: co }); }); });
        });
        what = scanned + " commits scanned.";
        findings.sort(function (x, y) { return (y.commit.co.committer.time - x.commit.co.committer.time) || (x.file < y.file ? -1 : 1); });
      } else {
        if (!repo) { errl(io, clockStr(sys) + " ERR [git] fatal: not a git repository (or any of the parent directories): .git"); return 1; }
        var st = X.computeStatus({ sys: sys, repo: repo, cwd: sess.cwd, uid: sess.uid, sess: sess, cfgExtra: [] }), idx = st.idx.entries, hf = st.headFlat || {};
        keys(o.staged ? idx : st.work).forEach(function (p) {
          if (!o.staged && !idx[p]) return;
          var newSha = o.staged ? idx[p].sha : null, newText = o.staged ? G.blobText(sys, newSha) : (st.work[p] && st.work[p].content !== undefined ? st.work[p].content : rd(sys, repo.top + "/" + p));
          var oldText = o.staged ? (hf[p] ? G.blobText(sys, hf[p].sha) : "") : (idx[p] ? G.blobText(sys, idx[p].sha) : "");
          if (newText === null || newText === undefined || newText === oldText) return;
          var have = {}; String(oldText).split("\n").forEach(function (l) { have[l] = (have[l] || 0) + 1; });
          String(newText).split("\n").forEach(function (l, ix) { if (have[l]) { have[l]--; return; } if (l) { scanned += l.length; add(p, ix + 1, l, null); } });
        });
        what = kbScanned(scanned);
      }
      if (o.v) findings.forEach(function (f) {
        var sec = o.redact ? "REDACTED" : f.secret, fl = o.redact ? f.match.split(f.secret).join("REDACTED") : f.match;
        var t = "Finding:     " + fl + "\nSecret:      " + sec + "\nRuleID:      " + f.rule.id + "\nEntropy:     " + entropy(f.secret).toFixed(6) + "\nFile:        " + f.file + "\nLine:        " + f.line;
        if (f.commit) t += "\nCommit:      " + f.commit.sha + "\nAuthor:      " + f.commit.co.author.name + "\nEmail:       " + f.commit.co.author.email + "\nDate:        " + iso(f.commit.co.author.time);
        t += "\nFingerprint: " + f.fp + "\n";
        outl(io, t);
      });
      if (o.report) {
        var rep = findings.map(function (f) { return { Description: f.rule.desc, StartLine: f.line, EndLine: f.line, Match: o.redact ? "REDACTED" : f.match, Secret: o.redact ? "REDACTED" : f.secret, File: f.file, Commit: f.commit ? f.commit.sha : "", Author: f.commit ? f.commit.co.author.name : "", Email: f.commit ? f.commit.co.author.email : "", Date: f.commit ? iso(f.commit.co.author.time) : "", RuleID: f.rule.id, Fingerprint: f.fp }; });
        var rp = o.report.charAt(0) === "/" ? o.report : S.normAbs(sess.cwd + "/" + o.report);
        G.putFile(sys, rp, JSON.stringify(rep, null, " ") + "\n", 420, sess.uid, sess.gid);
      }
      errl(io, clockStr(sys) + " INF " + what + "\n" + clockStr(sys) + " INF scan completed in " + (40 + scanned % 60) + "." + (scanned % 9) + "ms");
      if (findings.length) { errl(io, clockStr(sys) + " WRN leaks found: " + findings.length); return o.exit; }
      errl(io, clockStr(sys) + " INF no leaks found");
      return 0;
    };
    S.MAN.gitleaks = { syn: "gitleaks detect|protect [flags]", desc: "Find secrets (tokens, keys, passwords) in Git history or in staged changes.", opts: [["detect -v", "scan every commit in the repository"], ["detect --no-git", "scan the files in a folder"], ["protect --staged -v", "scan what you're about to commit (pre-commit hooks)"], ["--redact", "don't print the secrets themselves"], ["-c FILE", "rules from a config file (default .gitleaks.toml)"]] };
  }
  function kbScanned(n) { return "~" + (n < 1024 ? n + " B" : (n / 1024).toFixed(2) + " KB") + " scanned in " + (30 + n % 50) + "ms"; }

  /* ================================================================== git filter-repo */
  function filterRepo(c, args) {
    var inv = false, paths = [], globs = [], replace = null, force = false, analyze = false, i;
    for (i = 0; i < args.length; i++) {
      var x = args[i];
      if (x === "--invert-paths") inv = true;
      else if (x === "--path") paths.push(args[++i]);
      else if (/^--path=/.test(x)) paths.push(x.slice(7));
      else if (x === "--path-glob") globs.push(args[++i]);
      else if (x === "--replace-text") replace = args[++i];
      else if (/^--replace-text=/.test(x)) replace = x.slice(15);
      else if (x === "--force" || x === "-f") force = true;
      else if (x === "--analyze") analyze = true;
      else if (x === "--help" || x === "-h") { c.o.line("usage: git-filter-repo [--analyze] [--path PATH] [--path-glob GLOB] [--invert-paths]\n                       [--replace-text EXPRESSIONS_FILE] [--force] ...\n\nRewrite (or analyze) repository history\n\n  --path DIR_OR_FILE     Exactly a file or directory to keep (or, with --invert-paths, remove)\n  --path-glob GLOB       Glob of paths to keep (or remove)\n  --invert-paths         Invert the selection: remove the given paths instead\n  --replace-text FILE    Replace text in all files: each line 'literal' or 'literal==>replacement'\n                         (also regex:... and glob:...)\n  --analyze              Write reports about the repository to .git/filter-repo/analysis\n  --force, -f            Rewrite even if this doesn't look like a fresh clone"); return 0; }
      else { c.o.err("git-filter-repo: error: unrecognized arguments: " + x); return 2; }
    }
    var repo = c.repo, sys = c.sys;
    if (analyze) {
      var d = ".git/filter-repo/analysis", all = {}, cnt = 0;
      G.listRefs(repo, "refs/").forEach(function (r) { G.ancestors(sys, G.peel(sys, r.sha), all); });
      var sizes = {}; keys(all).forEach(function (s) { cnt++; var f = G.commitFlat(sys, s); keys(f).forEach(function (p) { sizes[p] = Math.max(sizes[p] || 0, String(G.blobText(sys, f[p].sha)).length); }); });
      var head = G.commitFlat(sys, G.head(repo).sha), deleted = keys(sizes).filter(function (p) { return !head[p]; });
      G.putFile(sys, repo.top + "/" + d + "/path-all-sizes.txt", "=== All paths by reverse accumulated size ===\nFormat: unpacked size, packed size, date deleted, path name\n" + keys(sizes).sort().map(function (p) { return "  " + X.lpad(String(sizes[p]), 10) + " " + X.lpad(String(Math.ceil(sizes[p] * 0.6)), 10) + " " + (head[p] ? "          " : "<present> ".replace("<present>", "deleted  ")) + " " + p; }).join("\n") + "\n", 420, c.uid, c.uid);
      G.putFile(sys, repo.top + "/" + d + "/path-deleted-sizes.txt", "=== Deleted paths by reverse accumulated size ===\nFormat: unpacked size, packed size, date deleted, path name\n" + deleted.map(function (p) { return "  " + X.lpad(String(sizes[p]), 10) + " " + X.lpad(String(Math.ceil(sizes[p] * 0.6)), 10) + " " + p; }).join("\n") + "\n", 420, c.uid, c.uid);
      c.o.line("Processed " + keys(sizes).length + " blob sizes\nProcessed " + cnt + " commits\nWriting reports to " + d + "...done.");
      return 0;
    }
    if (!force) {
      var why = null, logs = G.gread(repo, "logs/HEAD"), remotes = GH.remoteNames(c);
      if (G.gexists(repo, "refs/stash")) why = "has stashed changes";
      else if (remotes.length > 1 || (remotes.length === 1 && remotes[0] !== "origin")) why = "expected one remote, origin";
      else if (logs && lines(logs).length > 1) why = "expected at most one entry in the reflog for HEAD";
      else { var st = X.computeStatus(c); if (st.staged.length || st.unstaged.length) why = "you have unstaged changes"; else if (st.untracked.length) why = "you have untracked changes"; }
      if (why) { c.o.err("Aborting: Refusing to destructively overwrite repo history since\nthis does not look like a fresh clone.\n  (" + why + ")\nPlease operate on a fresh clone instead.  If you want to proceed\nanyway, use --force."); return 1; }
    }
    // the replacements
    var reps = [];
    if (replace) {
      var rt = S.readFile(c.sess, replace);
      if (rt.error) { c.o.err("Traceback (most recent call last):\nFileNotFoundError: [Errno 2] No such file or directory: '" + replace + "'"); return 1; }
      lines(rt.content).forEach(function (l) {
        if (!l) return;
        var parts = l.split("==>"), from = parts[0], to = parts.length > 1 ? parts.slice(1).join("==>") : "***REMOVED***";
        if (/^regex:/.test(from)) reps.push({ re: new RegExp(from.slice(6), "g"), to: to });
        else if (/^glob:/.test(from)) reps.push({ re: new RegExp(from.slice(5).replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, "."), "g"), to: to });
        else reps.push({ lit: from.replace(/^literal:/, ""), to: to });
      });
    }
    function hit(p) {
      return paths.some(function (q) { q = q.replace(/\/$/, ""); return p === q || p.indexOf(q + "/") === 0; }) || globs.some(function (g) { return S.globMatch(g, p) || new RegExp("^" + g.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".") + "$").test(p); });
    }
    var filtering = paths.length || globs.length;
    var noticeOrigin = GH.remoteNames(c).indexOf("origin") >= 0;
    if (noticeOrigin) c.o.line("NOTICE: Removing 'origin' remote; see 'Why is my origin removed?'\n        in the manual if you want to push back there.\n        (was " + G.configGet(sys, repo, c.uid, "remote.origin.url") + ")");
    // a fresh clone's remote branches become local branches
    G.listRefs(repo, "refs/remotes/origin/").forEach(function (r) { var b = r.name.slice(20); if (b !== "HEAD" && !G.resolveRefName(repo, "refs/heads/" + b).sha) G.gwrite(repo, "refs/heads/" + b, r.sha + "\n"); });
    var refs = G.listRefs(repo, "refs/heads/").concat(G.listRefs(repo, "refs/tags/"));
    var tips = refs.map(function (r) { return G.peel(sys, r.sha); }).filter(function (s, k, arr) { return arr.indexOf(s) === k; });
    var order = X.walk({ sys: sys, repo: repo }, tips, [], { topo: true }).reverse(), map = {}, blobMap = {};
    function newBlob(sha) {
      if (!reps.length) return sha;
      if (blobMap[sha]) return blobMap[sha];
      var t = String(G.blobText(sys, sha)), t2 = t;
      reps.forEach(function (rp) { t2 = rp.lit !== undefined ? t2.split(rp.lit).join(rp.to) : t2.replace(rp.re, rp.to); });
      blobMap[sha] = t2 === t ? sha : G.putObject(sys, { type: "blob", content: t2 });
      return blobMap[sha];
    }
    order.forEach(function (old) {
      var co = G.commitOf(sys, old), flat = G.commitFlat(sys, old), nf = {};
      keys(flat).forEach(function (p) { if (filtering && (inv ? hit(p) : !hit(p))) return; nf[p] = { sha: newBlob(flat[p].sha), mode: flat[p].mode }; });
      var parents = [];
      co.parents.forEach(function (p) { var m = map[p]; if (m && parents.indexOf(m) < 0) parents.push(m); });
      var tree = G.writeTree(sys, nf);
      var wasEmpty = co.parents.length ? G.commitOf(sys, co.parents[0]).tree === co.tree : !keys(flat).length;
      if (!wasEmpty && co.parents.length <= 1 && (parents.length ? G.commitOf(sys, parents[0]).tree === tree : !keys(nf).length)) { map[old] = parents[0] || null; return; }
      if (co.parents.length > 1 && parents.length === 1 && G.commitOf(sys, parents[0]).tree === tree) { map[old] = parents[0]; return; }
      map[old] = G.putObject(sys, { type: "commit", tree: tree, parents: parents, author: co.author, committer: co.committer, message: co.message });
    });
    var parsed = order.length;
    refs.forEach(function (r) {
      var obj = G.getObject(sys, r.sha), target = map[G.peel(sys, r.sha)];
      if (!target) { G.updateRef(repo, r.name, null); return; }
      if (obj.type === "tag") G.gwrite(repo, r.name, G.putObject(sys, { type: "tag", object: target, objtype: "commit", tag: obj.tag, tagger: obj.tagger, message: obj.message.replace(/\n-----BEGIN [\s\S]*$/, "\n") }) + "\n");
      else G.gwrite(repo, r.name, target + "\n");
    });
    // forget the old remote and the reflogs, then check out the new HEAD
    if (noticeOrigin) { var cfgT = G.gread(repo, "config") || ""; ["remote.origin.url", "remote.origin.fetch", "remote.origin.pushurl"].forEach(function (k) { cfgT = G.setInConfig(cfgT, k, null, true); }); G.listRefs(repo, "refs/heads/").forEach(function (r) { var b = r.name.slice(11); if ((G.configGet(sys, repo, c.uid, "branch." + b + ".remote") || "") === "origin") { cfgT = G.setInConfig(cfgT, "branch." + b + ".remote", null, true); cfgT = G.setInConfig(cfgT, "branch." + b + ".merge", null, true); } }); G.gwrite(repo, "config", cfgT); }
    G.listRefs(repo, "refs/remotes/").forEach(function (r) { G.updateRef(repo, r.name, null); });
    G.removePath(sys, G.gpath(repo, "logs"));
    G.removePath(sys, G.gpath(repo, "packed-refs"));
    var h = G.head(repo), newHead = h.sha;
    if (newHead) {
      var flatH = G.commitFlat(sys, newHead), idx = G.readIndex(repo);
      keys(idx.entries).forEach(function (p) { if (!flatH[p]) { var ab = repo.top + "/" + p; G.removePath(sys, ab); G.pruneEmptyDirs(sys, ab.slice(0, ab.lastIndexOf("/")), repo.top); } });
      keys(flatH).forEach(function (p) { G.writeWork(repo, p, flatH[p].sha, flatH[p].mode, 2); });
      G.writeIndex(repo, { entries: flatH, conflicts: {} });
    }
    G.removePath(sys, G.gpath(repo, "logs"));
    var nObj = keys(G.ancestors(sys, newHead || tips[0] || "")).length * 3;
    c.o.line("Parsed " + parsed + " commits\nNew history written in 0.0" + (2 + parsed % 7) + " seconds; now repacking/cleaning...\nRepacking your repo and cleaning out old unneeded objects" + (newHead ? "\nHEAD is now at " + G.abbrev(newHead, 7) + " " + G.commitOf(sys, newHead).message.split("\n")[0] : "") + "\nEnumerating objects: " + nObj + ", done.\nCounting objects: 100% (" + nObj + "/" + nObj + "), done.\nDelta compression using up to 8 threads\nCompressing objects: 100% (" + Math.ceil(nObj / 2) + "/" + Math.ceil(nObj / 2) + "), done.\nWriting objects: 100% (" + nObj + "/" + nObj + "), done.\nTotal " + nObj + " (delta 0), reused 0 (delta 0), pack-reused 0\nCompletely finished after 0.1" + (parsed % 9) + " seconds.");
    return 0;
  }
  var gitOrig = S.CMDS.git;
  GC.CMDS["filter-repo"] = { fn: function (c, args) {
    if (!G.nodeAt(c.sys, "/usr/bin/git-filter-repo")) { c.o.err("git: 'filter-repo' is not a git command. See 'git --help'.\n(It's a separate tool: sudo apt install git-filter-repo)"); return 1; }
    return filterRepo(c, args);
  } };
  S.CMDS["git-filter-repo"] = function (args, io, sess) { return gitOrig(["git", "filter-repo"].concat(args.slice(1)), io, sess); };
  SEC.filterRepo = filterRepo;

  /* ================================================================== SSH signing: git commit -S, verify-commit, log --show-signature */
  var SIG = root.GitSign = {};
  function cfgv(c, k) { return G.configGet(c.sys, c.repo, c.uid, k, c.cfgExtra); }
  function homeAbs(c, p) { p = String(p).trim(); if (/^~/.test(p)) p = c.sess.home + p.slice(1); return p.charAt(0) === "/" ? p : S.normAbs(c.cwd + "/" + p); }
  function armor(body) { var t = GH.b64encode("SSHSIG" + JSON.stringify(body)), out = []; for (var i = 0; i < t.length; i += 70) out.push(t.slice(i, i + 70)); return "-----BEGIN SSH SIGNATURE-----\n" + out.join("\n") + "\n-----END SSH SIGNATURE-----\n"; }
  function dearmor(sig) {
    var m = /-----BEGIN SSH SIGNATURE-----\s*([\s\S]*?)\s*-----END SSH SIGNATURE-----/.exec(sig || "");
    if (!m) return null;
    var d = GH.b64decode(m[1].replace(/\s+/g, ""));
    if (d.indexOf("SSHSIG") !== 0) return null;
    try { return JSON.parse(d.slice(6)); } catch (e) { return null; }
  }
  SIG.dearmor = dearmor;
  function keyType(t) { return { "ssh-ed25519": "ED25519", "ssh-rsa": "RSA", "ecdsa-sha2-nistp256": "ECDSA" }[t] || "ED25519"; }
  // the key git signs with: {type, blob} or {error}
  function signingKey(c) {
    var fmt = (cfgv(c, "gpg.format") || "openpgp").toLowerCase();
    if (fmt !== "ssh") return { error: "error: gpg failed to sign the data:\ngpg: skipped \"" + X.ident(c, "committer").name + " <" + X.ident(c, "committer").email + ">\": No secret key\n[GNUPG:] INV_SGNR 9 " + X.ident(c, "committer").email + "\n[GNUPG:] FAILURE sign 17\ngpg: signing failed: No secret key\n", gpg: true };
    var k = cfgv(c, "user.signingkey");
    if (!k) return { error: "fatal: either user.signingkey or gpg.ssh.defaultKeyCommand needs to be configured" };
    var lit = /^key::(\S+)\s+(\S+)/.exec(k) || /^(ssh-\S+|ecdsa-\S+)\s+(\S+)/.exec(k), pub = null, priv = null, path = null;
    if (lit) pub = { type: lit[1], blob: lit[2] };
    else {
      path = homeAbs(c, k);
      var t = rd(c.sys, path);
      if (t === null) return { error: "error: Couldn't load public key " + k + ": No such file or directory?\n\nfatal: failed to write commit object" };
      if (/PRIVATE KEY/.test(t)) { priv = t; var pp = M2.ssh.pubOfPriv(t); pub = pp ? { type: "ssh-" + pp.type.replace("ssh-", ""), blob: pp.blob } : null; }
      else { var m = /^(ssh-\S+|ecdsa-\S+)\s+(\S+)/.exec(t.trim()); pub = m ? { type: m[1], blob: m[2] } : null; }
      if (!pub) return { error: "error: Couldn't load public key " + k + ": invalid format?\n\nfatal: failed to write commit object" };
    }
    if (!priv) {
      // ssh-keygen -Y sign needs the private half: next to the .pub file, or in the agent (not simulated)
      var cand = path ? [path.replace(/\.pub$/, "")] : [c.sess.home + "/.ssh/id_ed25519", c.sess.home + "/.ssh/id_rsa", c.sess.home + "/.ssh/id_ecdsa"];
      priv = cand.map(function (p) { return rd(c.sys, p); }).filter(function (t) { if (!t || !/PRIVATE KEY/.test(t)) return false; var pp = M2.ssh.pubOfPriv(t); return pp && pp.blob === pub.blob; })[0] || null;
      if (!priv) return { error: "error: No private key found for public key \"" + (path || k) + "\"?\n\nfatal: failed to write commit object" };
    }
    return { type: pub.type, blob: pub.blob };
  }
  SIG.sign = function (c, co) {
    var k = signingKey(c);
    if (k.error) X.die(c, k.error.replace(/\n$/, "") + (k.gpg ? "\nfatal: failed to write commit object" : ""), 128);
    co.gpgsig = null;
    co.gpgsig = armor({ k: k.blob, t: k.type, h: M2.sha256(G.commitPayload(co)), n: "git" });
    return co;
  };
  SIG.maybe = function (c, co) { if (G.configBool(cfgv(c, "commit.gpgsign"), false)) SIG.sign(c, co); return co; };
  SIG.signTag = function (c, tag) {
    var k = signingKey(c);
    if (k.error) X.die(c, k.error.replace(/\n$/, "") + (k.gpg ? "\nerror: unable to sign the tag" : ""), 128);
    tag.message = tag.message.replace(/\n?$/, "\n") + armor({ k: k.blob, t: k.type, h: M2.sha256(G.tagText(Object.assign({}, tag, { message: tag.message.replace(/\n?$/, "\n") }))), n: "git" });
    return tag;
  };
  // allowed_signers: "principals [options] keytype key"
  function principalFor(c, blob) {
    var f = cfgv(c, "gpg.ssh.allowedSignersFile");
    if (!f) return { noFile: true };
    var t = rd(c.sys, homeAbs(c, f));
    if (t === null) return { noFile: true };
    var hit = null;
    lines(t).forEach(function (l) {
      l = l.trim(); if (!l || l.charAt(0) === "#" || hit) return;
      var m = /^(\S+)\s+(?:((?:[\w-]+(?:="[^"]*")?,?)+)\s+)?(ssh-\S+|ecdsa-\S+)\s+(\S+)/.exec(l);
      if (!m || m[4] !== blob) return;
      if (m[2] && /namespaces="/.test(m[2]) && !/namespaces="[^"]*\bgit\b/.test(m[2])) return;
      hit = m[1].split(",")[0];
    });
    return { who: hit };
  }
  // What git says about one signed commit (or tag): {lines, ok}
  function check(c, payload, sig) {
    if (/-----BEGIN PGP SIGNATURE-----/.test(sig || "")) return { lines: ["gpg: Signature made " + new Date(now(c.sys) * 1000).toUTCString().replace(" GMT", " UTC"), "gpg:                using RSA key B5690EEEBB952194", "gpg: Can't check signature: No public key"], ok: false, pgp: true };
    var d = dearmor(sig);
    if (!d) return { lines: ["error: invalid signature"], ok: false };
    var fp = M2.ssh.fingerprint(d.k), kt = keyType(d.t);
    if (M2.sha256(payload) !== d.h) return { lines: ["Could not verify signature.", "error: Bad \"git\" signature with " + kt + " key " + fp], ok: false };
    var p = principalFor(c, d.k);
    if (p.noFile) return { lines: ["error: gpg.ssh.allowedSignersFile needs to be configured and exist for ssh signature verification"], ok: false };
    if (!p.who) return { lines: ["Good \"git\" signature with " + kt + " key " + fp, "No principal matched."], ok: false };
    return { lines: ["Good \"git\" signature for " + p.who + " with " + kt + " key " + fp], ok: true };
  }
  SIG.logLines = function (c, sha, co) { if (!co.gpgsig) return []; return check(c, G.commitPayload(co), co.gpgsig).lines; };
  function tagParts(tag) { var m = /\n?(-----BEGIN (?:SSH|PGP) SIGNATURE-----[\s\S]*)$/.exec(tag.message); if (!m) return null; return { payload: G.tagText(Object.assign({}, tag, { message: tag.message.slice(0, m.index).replace(/\n?$/, "\n") })), sig: m[1] }; }
  SIG.verifyTag = function (c, names) {
    var code = 0;
    names.forEach(function (n) {
      var sha = G.resolveRefName(c.repo, "refs/tags/" + n).sha; if (!sha) X.die(c, "error: tag '" + n + "' not found.", 1);
      var o = G.getObject(c.sys, sha);
      if (o.type !== "tag") { c.o.err("error: " + n + ": cannot verify a non-tag object of type commit."); code = 1; return; }
      var tp = tagParts(o);
      if (!tp) { c.o.err("error: no signature found"); code = 1; return; }
      var r = check(c, tp.payload, tp.sig);
      r.lines.forEach(function (l) { c.o.err(l); });
      if (!r.ok) code = 1;
    });
    return code;
  };
  GC.CMDS["verify-commit"] = { fn: function (c, args) {
    var p = X.parseOpts(c, args, ["v|verbose", "raw"], "git verify-commit [-v | --verbose] [--raw] <commit>...");
    var revs = p.rest.length ? p.rest : [];
    if (!revs.length) { c.o.err("usage: git verify-commit [-v | --verbose] [--raw] <commit>..."); return 129; }
    var code = 0;
    revs.forEach(function (rv) {
      var sha = X.commitRev(c, rv), co = G.commitOf(c.sys, sha);
      if (p.o.verbose) c.o.line(G.commitPayload(co).replace(/\n$/, ""));
      if (!co.gpgsig) { code = 1; return; }
      var r = check(c, G.commitPayload(co), co.gpgsig);
      r.lines.forEach(function (l) { c.o.err(l); });
      if (!r.ok) code = 1;
    });
    return code;
  } };
  // GitHub's view: is a commit "Verified"?
  GH.signWeb = function (co) { co.gpgsig = null; co.gpgsig = "-----BEGIN PGP SIGNATURE-----\n\nwsFcBAABCAAQBQJn" + M2.sha256(G.commitPayload(co)).slice(0, 40) + "\n=GH4B\n-----END PGP SIGNATURE-----\n"; return co; };
  GH.verify = function (sys, sha) {
    var co = G.commitOf(sys, sha);
    if (!co || !co.gpgsig) return { verified: false, reason: "unsigned" };
    if (/-----BEGIN PGP SIGNATURE-----/.test(co.gpgsig)) return co.committer.email === "noreply@github.com" ? { verified: true, reason: "valid", signer: "web-flow" } : { verified: false, reason: "unknown_key" };
    var d = dearmor(co.gpgsig);
    if (!d) return { verified: false, reason: "malformed_signature" };
    if (M2.sha256(G.commitPayload(co)) !== d.h) return { verified: false, reason: "invalid" };
    var h = GH.hub(sys), owner = keys(h.users).filter(function (u) { return (h.users[u].signing || []).some(function (k) { return k.blob === d.k; }); })[0];
    if (!owner) return { verified: false, reason: "unknown_key" };
    var u = h.users[owner], emails = [u.email].concat(u.emails || [], [owner + "@users.noreply.github.com"]).map(function (e) { return String(e).toLowerCase(); });
    if (emails.indexOf(String(co.committer.email).toLowerCase()) < 0) return { verified: false, reason: "bad_email", signer: owner };
    return { verified: true, reason: "valid", signer: owner };
  };

  /* ================================================================== secret scanning and push protection */
  function newCommitList(sys, old, nw) { return GH.newCommits(sys, old, nw); }
  function scanCommits(sys, r, shas) {
    var rules = ghRules(sys, r), found = [];
    shas.forEach(function (s) {
      var co = G.commitOf(sys, s), al = addedLines(sys, co.parents[0] || null, s);
      keys(al).forEach(function (p) { al[p].forEach(function (x) { scanLine(x.text, rules).forEach(function (f) { found.push({ rule: f.rule, secret: f.secret, path: p, line: x.n, commit: s }); }); }); });
    });
    return found;
  }
  SEC.scanCommits = scanCommits;
  function addAlerts(sys, r, found) {
    var al = r.alerts.secret;
    found.forEach(function (f) {
      var a = al.filter(function (x) { return x.secret === f.secret; })[0];
      if (!a) { a = { number: al.length + 1, state: "open", secret_type: f.rule.type === "custom_pattern" ? f.rule.id : f.rule.type, secret_type_display_name: f.rule.gh, secret: f.secret, resolution: null, created: now(sys), locations: [], custom: !!f.rule.custom }; al.push(a); }
      if (!a.locations.some(function (l) { return l.commit === f.commit && l.path === f.path; })) a.locations.push({ path: f.path, line: f.line, commit: f.commit });
    });
  }
  function fullScan(sys, r) {
    if (r._ssDone || !r.settings.secretScanning) return;
    r._ssDone = true;
    var all = {}; keys(r.refs).forEach(function (k) { var s = G.peel(sys, r.refs[k]); if (G.commitOf(sys, s)) G.ancestors(sys, s, all); });
    addAlerts(sys, r, scanCommits(sys, r, keys(all)));
  }
  SEC.fullScan = fullScan;
  GH.pushChecks.push(function (c, r, ref, old, nw, conn) {
    if (!r.settings.pushProtection || nw === null || !/^refs\/(heads|tags)\//.test(ref)) return null;
    var hits = scanCommits(c.sys, r, newCommitList(c.sys, old, G.peel(c.sys, nw))).filter(function (f) { return !(r.ppAllowed || []).some(function (x) { return x.secret === f.secret; }) && f.rule.pushProtection !== false; });
    if (!hits.length) return null;
    var byType = {};
    hits.forEach(function (f) { (byType[f.rule.gh] = byType[f.rule.gh] || []).push(f); });
    var L = ["remote: error: GH013: Repository rule violations found for " + ref + ".", "remote: ", "remote: - GITHUB PUSH PROTECTION", "remote:   —————————————————————————————————————————", "remote:     Resolve the following violations before pushing again", "remote: ", "remote:     - Push cannot contain secrets", "remote: ", "remote:     ", "remote:      (?) Learn how to resolve a blocked push", "remote:      https://docs.github.com/code-security/secret-scanning/working-with-secret-scanning-and-push-protection/working-with-push-protection-from-the-command-line#resolving-a-blocked-push", "remote: "];
    r.ppBlocked = r.ppBlocked || [];
    keys(byType).forEach(function (t) {
      var f0 = byType[t][0], pid = M2.hashChars("pp" + f0.secret, 27, "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789");
      if (!r.ppBlocked.some(function (x) { return x.id === pid; })) r.ppBlocked.push({ id: pid, secret: f0.secret, type: t, at: now(c.sys), by: conn.login });
      L.push("remote:     ", "remote:       —— " + t + " ——————————————————————————", "remote:        locations:");
      byType[t].forEach(function (f) { L.push("remote:          - commit: " + G.abbrev(f.commit, 9), "remote:            path: " + f.path + ":" + f.line); });
      L.push("remote: ", "remote:        (?) To push, remove secret from commit(s) or follow this URL to allow the secret.", "remote:        https://github.com/" + r.full + "/security/secret-scanning/unblock-secret/" + pid, "remote: ");
    });
    GH.audit(c.sys, conn.login || "?", "secret_scanning_push_protection.block", { repo: r.full });
    return { reason: "push declined due to repository rule violations", lines: L.concat(["remote: "]) };
  });
  GH.GLOBAL.push(function (sys, h) {
    h.hooks.push({ event: "push", fn: function (s2, d) {
      var r = d.repo;
      if (d.after && r.settings.secretScanning) { fullScan(s2, r); addAlerts(s2, r, scanCommits(s2, r, d.before ? newCommitList(s2, d.before, G.peel(s2, d.after)) : keys(G.ancestors(s2, G.peel(s2, d.after))))); }
      if (d.ref === "refs/heads/" + r.default) { depScan(s2, r); rebaseDepPRs(s2, r); }
    } });
    h.hooks.push({ event: "pr.merged", fn: function (s2, d) { depScan(s2, d.repo); } });
  });
  function ghIso(t) { return new Date(t * 1000).toISOString().replace(/\.\d{3}Z$/, "Z"); }
  function tokenValidity(sys, a) { if (/^github_/.test(a.secret_type)) { var ti = GH.tokenInfo(sys, a.secret); return ti ? "active" : "inactive"; } if (/kdt_/.test(a.secret) && A.svc(sys).tokens[a.secret]) return A.svc(sys).tokens[a.secret].revoked ? "inactive" : "active"; return "unknown"; }
  function ssApi(sys, r, a) { return { number: a.number, state: a.state, secret_type: a.secret_type, secret_type_display_name: a.secret_type_display_name, secret: a.secret, validity: tokenValidity(sys, a), resolution: a.resolution, resolution_comment: a.resolution_comment || null, resolved_by: a.resolvedBy ? { login: a.resolvedBy } : null, created_at: ghIso(a.created), html_url: "https://github.com/" + r.full + "/security/secret-scanning/" + a.number, push_protection_bypassed: !!a.bypassed }; }
  function nf() { return { status: 404, body: { message: "Not Found", status: "404" } }; }
  function secOff(what) { return { status: 404, body: { message: what + " is disabled on this repository.", documentation_url: "https://docs.github.com/rest", status: "404" } }; }
  GH.api("GET", /^repos\/([^/]+\/[^/]+)\/secret-scanning\/alerts$/, function (c, m, b, login, q) { var r = GH.find(c.sys, m[1]); if (!r.settings.secretScanning) return secOff("Secret scanning"); fullScan(c.sys, r); return r.alerts.secret.filter(function (a) { return !q.state || a.state === q.state; }).slice().reverse().map(function (a) { return ssApi(c.sys, r, a); }); });
  GH.api("GET", /^repos\/([^/]+\/[^/]+)\/secret-scanning\/alerts\/(\d+)$/, function (c, m) { var r = GH.find(c.sys, m[1]); if (!r.settings.secretScanning) return secOff("Secret scanning"); fullScan(c.sys, r); var a = r.alerts.secret[+m[2] - 1]; return a ? ssApi(c.sys, r, a) : nf(); });
  GH.api("GET", /^repos\/([^/]+\/[^/]+)\/secret-scanning\/alerts\/(\d+)\/locations$/, function (c, m) { var r = GH.find(c.sys, m[1]); fullScan(c.sys, r); var a = r.alerts.secret[+m[2] - 1]; return a ? a.locations.map(function (l) { return { type: "commit", details: { path: l.path, start_line: l.line, end_line: l.line, commit_sha: l.commit, commit_url: "https://api.github.com/repos/" + r.full + "/git/commits/" + l.commit } }; }) : nf(); });
  GH.api("PATCH", /^repos\/([^/]+\/[^/]+)\/secret-scanning\/alerts\/(\d+)$/, function (c, m, b, login) {
    var r = GH.find(c.sys, m[1]); fullScan(c.sys, r); var a = r.alerts.secret[+m[2] - 1]; if (!a) return nf();
    if (!GH.can(c.sys, r, login, "write")) return { status: 403, body: { message: "Must have write access to the repository.", status: "403" } };
    if (["open", "resolved"].indexOf(b.state) < 0) return { status: 422, body: { message: "state must be open or resolved", status: "422" } };
    if (b.state === "resolved" && ["false_positive", "wont_fix", "revoked", "used_in_tests"].indexOf(b.resolution) < 0) return { status: 422, body: { message: "resolution must be one of false_positive, wont_fix, revoked, used_in_tests", status: "422" } };
    a.state = b.state; a.resolution = b.state === "resolved" ? b.resolution : null; a.resolution_comment = b.resolution_comment || null; a.resolvedBy = login; a.resolvedAt = now(c.sys);
    GH.audit(c.sys, login, "secret_scanning_alert." + (b.state === "resolved" ? "resolve" : "reopen"), { repo: r.full, alert: a.number, resolution: a.resolution });
    return ssApi(c.sys, r, a);
  });
  GH.api("POST", /^repos\/([^/]+\/[^/]+)\/secret-scanning\/push-protection-bypasses$/, function (c, m, b, login) {
    var r = GH.find(c.sys, m[1]), blk = (r.ppBlocked || []).filter(function (x) { return x.id === b.placeholder_id; })[0];
    if (!blk) return { status: 404, body: { message: "Placeholder ID not found", status: "404" } };
    if (["false_positive", "used_in_tests", "will_fix_later"].indexOf(b.reason) < 0) return { status: 422, body: { message: "reason must be false_positive, used_in_tests or will_fix_later", status: "422" } };
    r.ppAllowed = (r.ppAllowed || []).concat([{ secret: blk.secret, reason: b.reason, by: login, at: now(c.sys) }]);
    GH.audit(c.sys, login, "secret_scanning_push_protection.bypass", { repo: r.full, reason: b.reason });
    return { status: 200, body: { reason: b.reason, expire_at: ghIso(now(c.sys) + 3 * 3600), token_type: blk.type } };
  });

  /* ================================================================== Dependabot, the dependency graph, npm audit */
  var ADVISORIES = [
    { eco: "npm", pkg: "lodash", below: "4.17.21", ghsa: "GHSA-35jh-r3h4-6jhm", cve: "CVE-2021-23337", sev: "high", score: 7.2, summary: "Command Injection in lodash" },
    { eco: "npm", pkg: "minimist", below: "1.2.6", ghsa: "GHSA-xvch-5gv4-984h", cve: "CVE-2021-44906", sev: "critical", score: 9.8, summary: "Prototype Pollution in minimist" },
    { eco: "npm", pkg: "express", below: "4.19.2", ghsa: "GHSA-rv95-896h-c2vc", cve: "CVE-2024-29041", sev: "moderate", score: 6.1, summary: "Express.js Open Redirect in malformed URLs" },
    { eco: "pip", pkg: "requests", below: "2.31.0", ghsa: "GHSA-j8r2-6x86-q33q", cve: "CVE-2023-32681", sev: "moderate", score: 6.1, summary: "Unintended leak of Proxy-Authorization header in requests" }
  ];
  SEC.ADVISORIES = ADVISORIES;
  var SEVRANK = { low: 1, moderate: 2, medium: 2, high: 3, critical: 4 };
  function vcmp(a, b) { var x = String(a).split(/[.-]/).map(Number), y = String(b).split(/[.-]/).map(Number); for (var i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0); } return 0; }
  SEC.vcmp = vcmp;
  // the dependencies a commit declares: [{eco, name, version, manifest, scope, direct}]
  function depsAt(sys, sha) {
    var flat = sha ? G.commitFlat(sys, sha) : {}, out = [];
    keys(flat).forEach(function (p) {
      if (/(^|\/)package-lock\.json$/.test(p)) {
        var lock; try { lock = JSON.parse(G.blobText(sys, flat[p].sha)); } catch (e) { return; }
        var rootPkg = (lock.packages || {})[""] || {}, direct = Object.assign({}, rootPkg.dependencies || {}, rootPkg.devDependencies || {});
        keys(lock.packages || {}).forEach(function (k) { var mm = /^node_modules\/(.+)$/.exec(k); if (!mm || /node_modules\/.*node_modules/.test(k)) return; out.push({ eco: "npm", name: mm[1], version: lock.packages[k].version, manifest: p, scope: lock.packages[k].dev ? "development" : "runtime", direct: has(direct, mm[1]) }); });
      }
      if (/(^|\/)requirements\.txt$/.test(p)) lines(G.blobText(sys, flat[p].sha)).forEach(function (l) { var mm = /^\s*([A-Za-z0-9_.-]+)\s*==\s*([\w.]+)/.exec(l); if (mm) out.push({ eco: "pip", name: mm[1].toLowerCase(), version: mm[2], manifest: p, scope: "runtime", direct: true }); });
    });
    return out;
  }
  SEC.depsAt = depsAt;
  function vulnsOf(deps) { var out = []; deps.forEach(function (d) { ADVISORIES.forEach(function (a) { if (a.eco === d.eco && a.pkg === d.name && vcmp(d.version, a.below) < 0) out.push({ dep: d, adv: a }); }); }); return out; }
  SEC.vulnsOf = vulnsOf;
  function depScan(sys, r) {
    if (!r.settings.dependabotAlerts) return;
    var tip = r.refs["refs/heads/" + r.default], found = vulnsOf(depsAt(sys, tip)), al = r.alerts.dependabot;
    al.forEach(function (a) { if (a.state !== "open") return; if (!found.some(function (f) { return f.adv.ghsa === a.ghsa && f.dep.manifest === a.manifest; })) { a.state = "fixed"; a.fixedAt = now(sys); } });
    found.forEach(function (f) {
      if (al.some(function (a) { return a.ghsa === f.adv.ghsa && a.manifest === f.dep.manifest && a.state !== "fixed"; })) return;
      al.push({ number: al.length + 1, state: "open", ghsa: f.adv.ghsa, adv: f.adv, pkg: f.dep.name, eco: f.dep.eco, version: f.dep.version, manifest: f.dep.manifest, scope: f.dep.scope, direct: f.dep.direct, created: now(sys) });
    });
    if (r.settings.dependabotUpdates) securityUpdates(sys, r);
  }
  SEC.depScan = depScan;
  var DEPBOT = { name: "dependabot[bot]", email: "49699333+dependabot[bot]@users.noreply.github.com" };
  // the files a version bump changes, computed on top of a given commit (null when nothing to change)
  function bumpFiles(sys, a, base) {
    var flat = G.commitFlat(sys, base), lockF = flat[a.manifest], pkgPath = a.manifest.replace(/package-lock\.json$/, "package.json");
    if (!lockF) return null;
    var lock = JSON.parse(G.blobText(sys, lockF.sha)), entry = lock.packages["node_modules/" + a.pkg], to = a.adv.below;
    if (!entry || vcmp(entry.version, to) >= 0) return null;
    entry.version = to; entry.resolved = "https://registry.npmjs.org/" + a.pkg + "/-/" + a.pkg + "-" + to + ".tgz"; entry.integrity = "sha512-" + M2.hashChars(a.pkg + to, 86, "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/") + "==";
    var files = {};
    if (a.direct && flat[pkgPath]) {
      var pkg = JSON.parse(G.blobText(sys, flat[pkgPath].sha));
      ["dependencies", "devDependencies"].forEach(function (k) { if (pkg[k] && pkg[k][a.pkg]) pkg[k][a.pkg] = "^" + to; });
      var rp = lock.packages[""] || {}; ["dependencies", "devDependencies"].forEach(function (k) { if (rp[k] && rp[k][a.pkg]) rp[k][a.pkg] = "^" + to; });
      files[pkgPath] = JSON.stringify(pkg, null, 2) + "\n";
    }
    files[a.manifest] = JSON.stringify(lock, null, 2) + "\n";
    return files;
  }
  function bumpMsg(a) { var to = a.adv.below; return "Bump " + a.pkg + " from " + a.version + " to " + to + "\n\nBumps [" + a.pkg + "](https://github.com/" + a.pkg + "/" + a.pkg + ") from " + a.version + " to " + to + ".\n\n---\nupdated-dependencies:\n- dependency-name: " + a.pkg + "\n  dependency-type: " + (a.direct ? "direct:production" : "indirect") + "\n...\n\nSigned-off-by: dependabot[bot] <support@github.com>"; }
  function securityUpdates(sys, r) {
    var h = GH.hub(sys);
    if (!h.users["dependabot[bot]"]) GH.user(sys, "dependabot[bot]", { name: "dependabot[bot]", email: DEPBOT.email });
    r.alerts.dependabot.forEach(function (a) {
      if (a.state !== "open" || a.prOpened || a.eco !== "npm") return;
      var tip = r.refs["refs/heads/" + r.default], files = bumpFiles(sys, a, tip), to = a.adv.below;
      if (!files) return;
      var br = "dependabot/npm_and_yarn/" + a.pkg + "-" + to;
      if (r.refs["refs/heads/" + br]) return;
      a.prOpened = true;
      r.refs["refs/heads/" + br] = tip;
      GH.commit(sys, r.full, br, Object.assign({}, DEPBOT), bumpMsg(a), files, now(sys) - 30);
      var pr = GH.openPR(sys, r.full, { title: "Bump " + a.pkg + " from " + a.version + " to " + to, body: "Bumps [" + a.pkg + "](https://github.com/" + a.pkg + "/" + a.pkg + ") from " + a.version + " to " + to + ".\n\nFixes " + a.adv.ghsa + " (" + a.adv.sev + "): " + a.adv.summary + ".\n\nDependabot will resolve any conflicts with this PR as long as you don't alter it yourself.", author: "dependabot[bot]", head: br, labels: ["dependencies", "javascript"] });
      a.pr = pr.n;
    });
  }
  // When main moves on and a Dependabot pull request conflicts, Dependabot rebases it (or closes it if it's no longer needed).
  function rebaseDepPRs(sys, r) {
    r.items.forEach(function (pr) {
      if (pr.type !== "pr" || pr.state !== "open" || pr.author !== "dependabot[bot]" || pr._rebasing) return;
      var a = r.alerts.dependabot.filter(function (x) { return x.pr === pr.n; })[0]; if (!a) return;
      var tip = r.refs["refs/heads/" + r.default], files = bumpFiles(sys, a, tip);
      if (!files) { pr.state = "closed"; pr.comments.push({ by: "dependabot[bot]", body: "Looks like " + a.pkg + " is up-to-date now, so this is no longer needed.", at: now(sys) }); delete r.refs["refs/heads/" + pr.head]; return; }
      var head = r.refs["refs/heads/" + pr.head];
      if (head && G.isAncestor(sys, tip, head)) return;
      var mb = G.mergeBases(sys, tip, head)[0], mr = G.mergeTrees(sys, G.commitFlat(sys, mb), G.commitFlat(sys, tip), G.commitFlat(sys, head), ["base", "head"]);
      if (!keys(mr.conflicts).length) return;
      pr._rebasing = true;
      try { r.refs["refs/heads/" + pr.head] = tip; GH.commit(sys, r.full, pr.head, Object.assign({}, DEPBOT), bumpMsg(a), files, now(sys) - 5); }
      finally { pr._rebasing = false; }
    });
  }
  SEC.rebaseDepPRs = rebaseDepPRs;
  function depApi(r, a) { return { number: a.number, state: a.state, dependency: { package: { ecosystem: a.eco, name: a.pkg }, manifest_path: a.manifest, scope: a.scope }, security_advisory: { ghsa_id: a.ghsa, cve_id: a.adv.cve, summary: a.adv.summary, severity: a.adv.sev, cvss: { score: a.adv.score } }, security_vulnerability: { package: { ecosystem: a.eco, name: a.pkg }, severity: a.adv.sev, vulnerable_version_range: "< " + a.adv.below, first_patched_version: { identifier: a.adv.below } }, created_at: ghIso(a.created), fixed_at: a.fixedAt ? ghIso(a.fixedAt) : null, dismissed_reason: a.dismissedReason || null, dismissed_comment: a.dismissedComment || null, html_url: "https://github.com/" + r.full + "/security/dependabot/" + a.number }; }
  function setting(re, key, after) {
    GH.api("PUT", re, function (c, m, b, login) { var r = GH.find(c.sys, m[1]); if (GH.role(c.sys, r, login) !== "admin") return { status: 403, body: { message: "Must have admin rights to Repository.", status: "403" } }; r.settings[key] = true; GH.audit(c.sys, login, "repo." + key + ".enable", { repo: r.full }); if (after) after(c.sys, r); return { status: 204 }; });
    GH.api("DELETE", re, function (c, m, b, login) { var r = GH.find(c.sys, m[1]); if (GH.role(c.sys, r, login) !== "admin") return { status: 403, body: { message: "Must have admin rights to Repository.", status: "403" } }; r.settings[key] = false; GH.audit(c.sys, login, "repo." + key + ".disable", { repo: r.full }); return { status: 204 }; });
    GH.api("GET", re, function (c, m) { var r = GH.find(c.sys, m[1]); return r.settings[key] ? { status: 204 } : { status: 404, body: { message: "Not Found", status: "404" } }; });
  }
  setting(/^repos\/([^/]+\/[^/]+)\/vulnerability-alerts$/, "dependabotAlerts", depScan);
  setting(/^repos\/([^/]+\/[^/]+)\/automated-security-fixes$/, "dependabotUpdates", function (sys, r) { r.settings.dependabotAlerts = true; depScan(sys, r); });
  GH.api("GET", /^repos\/([^/]+\/[^/]+)\/dependabot\/alerts$/, function (c, m, b, login, q) { var r = GH.find(c.sys, m[1]); if (!r.settings.dependabotAlerts) return { status: 403, body: { message: "Dependabot alerts are disabled for this repository.", status: "403" } }; depScan(c.sys, r); return r.alerts.dependabot.filter(function (a) { return (!q.state || q.state.split(",").indexOf(a.state) >= 0) && (!q.severity || q.severity.split(",").indexOf(a.adv.sev) >= 0); }).slice().reverse().map(function (a) { return depApi(r, a); }); });
  GH.api("GET", /^repos\/([^/]+\/[^/]+)\/dependabot\/alerts\/(\d+)$/, function (c, m) { var r = GH.find(c.sys, m[1]), a = r.alerts.dependabot[+m[2] - 1]; return a ? depApi(r, a) : nf(); });
  GH.api("PATCH", /^repos\/([^/]+\/[^/]+)\/dependabot\/alerts\/(\d+)$/, function (c, m, b, login) {
    var r = GH.find(c.sys, m[1]), a = r.alerts.dependabot[+m[2] - 1]; if (!a) return nf();
    if (b.state === "dismissed") { if (["fix_started", "inaccurate", "no_bandwidth", "not_used", "tolerable_risk"].indexOf(b.dismissed_reason) < 0) return { status: 422, body: { message: "dismissed_reason must be fix_started, inaccurate, no_bandwidth, not_used or tolerable_risk", status: "422" } }; a.state = "dismissed"; a.dismissedReason = b.dismissed_reason; a.dismissedComment = b.dismissed_comment || ""; }
    else if (b.state === "open") { a.state = "open"; a.dismissedReason = null; }
    else return { status: 422, body: { message: "state must be dismissed or open", status: "422" } };
    GH.audit(c.sys, login, "repository_vulnerability_alert." + (a.state === "dismissed" ? "dismiss" : "reopen"), { repo: r.full, alert: a.number });
    return depApi(r, a);
  });
  GH.api("GET", /^repos\/([^/]+\/[^/]+)\/dependency-graph\/sbom$/, function (c, m) {
    var r = GH.find(c.sys, m[1]), deps = depsAt(c.sys, r.refs["refs/heads/" + r.default]), seen = {};
    var pk = [{ name: "com.github." + r.full, SPDXID: "SPDXRef-com.github." + r.full.replace("/", "-"), versionInfo: "main", downloadLocation: "git+https://github.com/" + r.full, filesAnalyzed: false, licenseConcluded: "NOASSERTION" }];
    deps.forEach(function (d) { var id = d.eco + ":" + d.name + "@" + d.version; if (seen[id]) return; seen[id] = 1; pk.push({ name: d.eco + ":" + d.name, SPDXID: "SPDXRef-" + d.eco + "-" + d.name.replace(/[^\w.-]/g, "-") + "-" + d.version, versionInfo: d.version, downloadLocation: "NOASSERTION", filesAnalyzed: false, licenseConcluded: "MIT", externalRefs: [{ referenceCategory: "PACKAGE-MANAGER", referenceType: "purl", referenceLocator: "pkg:" + (d.eco === "pip" ? "pypi" : d.eco) + "/" + d.name + "@" + d.version }] }); });
    return { sbom: { spdxVersion: "SPDX-2.3", dataLicense: "CC0-1.0", SPDXID: "SPDXRef-DOCUMENT", name: "com.github." + r.full, documentNamespace: "https://spdx.org/spdxdocs/protobom/" + M2.hashChars(r.full, 36, "0123456789abcdef"), creationInfo: { creators: ["Tool: protobom-v0.0.0", "Tool: GitHub.com-Dependency-Graph"], created: ghIso(now(c.sys)) }, packages: pk, relationships: pk.slice(1).map(function (p) { return { relationshipType: "DEPENDS_ON", spdxElementId: pk[0].SPDXID, relatedSpdxElement: p.SPDXID }; }) } };
  });
  // npm audit / npm audit fix, from the same advisories
  A.npmAudit = function (sess, dir, pkg, lock, args) {
    var deps = []; keys(lock.packages || {}).forEach(function (k) { var mm = /^node_modules\/(.+)$/.exec(k); if (mm) deps.push({ eco: "npm", name: mm[1], version: lock.packages[k].version, manifest: "package-lock.json" }); });
    var v = vulnsOf(deps), counts = {};
    v.forEach(function (x) { counts[x.adv.sev] = (counts[x.adv.sev] || 0) + 1; });
    function sumLine() { var parts = ["critical", "high", "moderate", "low"].filter(function (s) { return counts[s]; }).map(function (s) { return counts[s] + " " + s; }); return v.length ? v.length + " vulnerabilit" + (v.length > 1 ? "ies" : "y") + " (" + parts.join(", ") + ")" : "found 0 vulnerabilities"; }
    var summary = v.length ? sumLine() + "\n\nTo address all issues, run:\n  npm audit fix\n\nRun `npm audit` for details." : "found 0 vulnerabilities";
    args = args || [];
    if (args[0] === "fix") {
      var want = Object.assign({}, pkg.dependencies || {}, pkg.devDependencies || {}), fixed = 0, stuck = [];
      v.forEach(function (x) { var spec = want[x.dep.name]; if (spec && !A.satisfies(x.adv.below, spec)) { stuck.push(x); return; } var e = lock.packages["node_modules/" + x.dep.name]; e.version = x.adv.below; e.resolved = "https://registry.npmjs.org/" + x.dep.name + "/-/" + x.dep.name + "-" + x.adv.below + ".tgz"; fixed++; });
      G.putFile(sess.sys, dir + "/package-lock.json", JSON.stringify(lock, null, 2) + "\n", 436, sess.uid, sess.gid);
      keys(lock.packages).forEach(function (k) { if (k) G.putFile(sess.sys, dir + "/" + k + "/package.json", JSON.stringify({ name: k.replace(/^node_modules\//, ""), version: lock.packages[k].version }) + "\n", 436, sess.uid, sess.gid); });
      return { code: stuck.length ? 1 : 0, text: "\nchanged " + fixed + " package" + (fixed === 1 ? "" : "s") + ", and audited " + (keys(lock.packages).length) + " packages in 2s\n\n" + (stuck.length ? "# npm audit report\n\n" + stuck.map(function (x) { return x.dep.name + "  <" + x.adv.below + "\nSeverity: " + x.adv.sev + "\n" + x.adv.summary + " - https://github.com/advisories/" + x.adv.ghsa + "\nfix available via `npm audit fix --force`\nWill install " + x.dep.name + "@" + x.adv.below + ", which is outside the stated dependency range\nnode_modules/" + x.dep.name; }).join("\n\n") + "\n\n" + stuck.length + " vulnerabilit" + (stuck.length > 1 ? "ies" : "y") + " remain. Edit package.json to allow the fixed version." : "found 0 vulnerabilities") };
    }
    if (!v.length) return { code: 0, text: "found 0 vulnerabilities", summary: summary };
    var txt = "# npm audit report\n\n" + v.map(function (x) { return x.dep.name + "  <" + x.adv.below + "\nSeverity: " + x.adv.sev + "\n" + x.adv.summary + " - https://github.com/advisories/" + x.adv.ghsa + "\nfix available via `npm audit fix`\nnode_modules/" + x.dep.name; }).join("\n\n") + "\n\n" + sumLine() + "\n\nTo address all issues, run:\n  npm audit fix";
    return { code: 1, text: txt, summary: summary };
  };

  /* ================================================================== CodeQL and code scanning */
  var CQ = [
    { id: "py/sql-injection", lang: "python", ext: /\.py$/, re: /\.execute\(\s*(?:f["']|["'][^"'\n]*["']\s*(?:%|\+|\.format))/, sev: "error", level: "high", score: 8.8, desc: "SQL query built from user-controlled sources", msg: "This SQL query depends on a user-provided value." },
    { id: "py/command-line-injection", lang: "python", ext: /\.py$/, re: /(?:os\.system|os\.popen)\(\s*(?:f["']|["'][^"'\n]*["']\s*\+)|subprocess\.\w+\([^)\n]*shell\s*=\s*True/, sev: "error", level: "critical", score: 9.8, desc: "Uncontrolled command line", msg: "This command line depends on a user-provided value." },
    { id: "py/flask-debug", lang: "python", ext: /\.py$/, re: /\.run\([^)\n]*debug\s*=\s*True/, sev: "error", level: "high", score: 7.5, desc: "Flask app is run in debug mode", msg: "A Flask app appears to be run in debug mode. This may allow an attacker to run arbitrary code through the debugger." },
    { id: "js/code-injection", lang: "javascript-typescript", ext: /\.(js|ts|mjs)$/, re: /\beval\s*\(/, sev: "error", level: "critical", score: 9.3, desc: "Code injection", msg: "This code execution depends on a user-provided value." },
    { id: "js/sql-injection", lang: "javascript-typescript", ext: /\.(js|ts|mjs)$/, re: /\.query\(\s*`[^`\n]*\$\{/, sev: "error", level: "high", score: 8.8, desc: "Database query built from user-controlled sources", msg: "This query string depends on a user-provided value." },
    { id: "actions/code-injection/critical", lang: "actions", ext: /^\.github\/workflows\/[^/]+\.ya?ml$/, re: /\$\{\{\s*github\.event\.(?:issue\.(?:title|body)|pull_request\.(?:title|body|head\.ref|head\.label)|comment\.body|review\.body|head_commit\.(?:message|author\.name)|commits\[\d*\]\.message)\s*\}\}/, runOnly: true, sev: "error", level: "critical", score: 9.3, desc: "Code injection", msg: "Potential code injection in an expression, which may be controlled by an external user." },
    { id: "actions/untrusted-checkout/critical", lang: "actions", ext: /^\.github\/workflows\/[^/]+\.ya?ml$/, re: /ref:\s*\$\{\{\s*github\.event\.pull_request\.head\.(?:sha|ref)\s*\}\}/, needs: /pull_request_target/, sev: "error", level: "critical", score: 9.3, desc: "Checkout of untrusted code in a privileged context", msg: "Potential execution of untrusted code on a privileged workflow (pull_request_target)." },
    { id: "actions/unpinned-tag", lang: "actions", ext: /^\.github\/workflows\/[^/]+\.ya?ml$/, re: /uses:\s*(?!actions\/|github\/|\.\/|docker:)[\w.-]+\/[\w./-]+@(?![0-9a-f]{40}\b)\S+/, sev: "warning", level: "medium", score: 5.0, desc: "Unpinned tag for a non-immutable Action in workflow", msg: "Unpinned 3rd party Action uses a tag instead of a full commit SHA." },
    { id: "actions/missing-workflow-permissions", lang: "actions", ext: /^\.github\/workflows\/[^/]+\.ya?ml$/, whole: function (t) { return !/^permissions:/m.test(t) && !/^\s+permissions:/m.test(t) ? 1 : 0; }, sev: "warning", level: "medium", score: 5.0, desc: "Workflow does not contain permissions", msg: "Actions job or workflow does not limit the permissions of the GITHUB_TOKEN. Consider setting an explicit permissions block." }
  ];
  SEC.CQ = CQ;
  function cqAnalyze(sys, flat, langs) {
    var out = [];
    keys(flat).sort().forEach(function (p) {
      var t = null;
      CQ.forEach(function (rule) {
        if (langs.indexOf(rule.lang) < 0 || !rule.ext.test(p)) return;
        if (t === null) t = String(G.blobText(sys, flat[p].sha));
        if (rule.needs && !rule.needs.test(t)) return;
        if (rule.whole) { if (rule.whole(t)) out.push({ rule: rule, path: p, line: 1 }); return; }
        t.split("\n").forEach(function (l, i) { if (rule.runOnly && !/^\s*(-\s*)?run:|^\s{6,}\S/.test(l)) return; if (rule.re.test(l)) out.push({ rule: rule, path: p, line: i + 1 }); });
      });
    });
    return out;
  }
  SEC.cqAnalyze = cqAnalyze;
  function cqApply(sys, r, results, ref) {
    var al = r.alerts.code;
    al.forEach(function (a) { if (a.state !== "open") return; if (!results.some(function (x) { return x.rule.id === a.rule.id && x.path === a.path; })) { a.state = "fixed"; a.fixedAt = now(sys); } });
    results.forEach(function (x) {
      if (al.some(function (a) { return a.rule.id === x.rule.id && a.path === x.path && a.state !== "fixed"; })) return;
      al.push({ number: al.length + 1, state: "open", rule: x.rule, path: x.path, line: x.line, ref: ref, created: now(sys) });
    });
  }
  function codeApi(r, a) { return { number: a.number, state: a.state, rule: { id: a.rule.id, severity: a.rule.sev, security_severity_level: a.rule.level, description: a.rule.desc, tags: ["security"] }, tool: { name: "CodeQL", version: "2.19.3" }, most_recent_instance: { ref: a.ref, state: a.state, location: { path: a.path, start_line: a.line, end_line: a.line }, message: { text: a.rule.msg } }, created_at: ghIso(a.created), fixed_at: a.fixedAt ? ghIso(a.fixedAt) : null, dismissed_reason: a.dismissedReason || null, html_url: "https://github.com/" + r.full + "/security/code-scanning/" + a.number }; }
  GH.api("GET", /^repos\/([^/]+\/[^/]+)\/code-scanning\/alerts$/, function (c, m, b, login, q) { var r = GH.find(c.sys, m[1]); if (!r.codeScanningSetup) return { status: 404, body: { message: "no analysis found", documentation_url: "https://docs.github.com/rest/code-scanning/code-scanning#list-code-scanning-alerts-for-a-repository", status: "404" } }; return r.alerts.code.filter(function (a) { return !q.state || a.state === q.state; }).slice().reverse().map(function (a) { return codeApi(r, a); }); });
  GH.api("GET", /^repos\/([^/]+\/[^/]+)\/code-scanning\/alerts\/(\d+)$/, function (c, m) { var r = GH.find(c.sys, m[1]), a = r.alerts.code[+m[2] - 1]; return a ? codeApi(r, a) : nf(); });
  GH.api("PATCH", /^repos\/([^/]+\/[^/]+)\/code-scanning\/alerts\/(\d+)$/, function (c, m, b, login) {
    var r = GH.find(c.sys, m[1]), a = r.alerts.code[+m[2] - 1]; if (!a) return nf();
    if (b.state === "dismissed") { if (["false positive", "won't fix", "used in tests"].indexOf(b.dismissed_reason) < 0) return { status: 422, body: { message: "dismissed_reason must be 'false positive', 'won't fix' or 'used in tests'", status: "422" } }; a.state = "dismissed"; a.dismissedReason = b.dismissed_reason; }
    else if (b.state === "open") { a.state = "open"; a.dismissedReason = null; }
    else return { status: 422, body: { message: "state must be open or dismissed", status: "422" } };
    return codeApi(r, a);
  });
  A.actionRepo; // (repositories registered below)
  var EXTRA_ACTIONS = {
    "github/codeql-action": { desc: "Actions for running CodeQL analysis", v: ["v2.22.12", "v3.26.13", "v3.27.0"] },
    "actions/dependency-review-action": { desc: "A GitHub Action for detecting vulnerable dependencies and invalid licenses in your PRs", v: ["v3.1.5", "v4.3.4", "v4.4.0"] },
    "notify-hub/slack-notify": { desc: "Post a message to Slack from a workflow", v: ["v2.2.0", "v2.3.0", "v2.3.1"] }
  };
  GH.GLOBAL.push(function (sys) { keys(EXTRA_ACTIONS).forEach(function (full) { A.actionRepo(sys, full, EXTRA_ACTIONS[full]); }); });
  function langsFor(J, w) {
    if (w.languages) return String(w.languages).split(/[\s,]+/).filter(Boolean).map(function (l) { return { javascript: "javascript-typescript", typescript: "javascript-typescript", js: "javascript-typescript", py: "python" }[l] || l; });
    var flat = {}; (function walk(dir, rel) { var n = G.nodeAt(J.rs, dir); if (!n || n.type !== "d") return; keys(n.children).forEach(function (k) { if (k === ".git" || k === "node_modules") return; var ch = n.children[k], p = rel ? rel + "/" + k : k; if (ch.type === "d") walk(dir + "/" + k, p); else flat[p] = 1; }); })(J.ws, "");
    var out = []; if (keys(flat).some(function (p) { return /\.py$/.test(p); })) out.push("python"); if (keys(flat).some(function (p) { return /\.(js|ts)$/.test(p); })) out.push("javascript-typescript"); if (keys(flat).some(function (p) { return /^\.github\/workflows\//.test(p); })) out.push("actions");
    return out;
  }
  A.action("github/codeql-action/init", { run: function (J, s, w) {
    var langs = langsFor(J, w), bad = langs.filter(function (l) { return ["python", "javascript-typescript", "actions", "go", "java-kotlin", "ruby", "csharp", "cpp", "swift"].indexOf(l) < 0; });
    if (bad.length) { J.log(s, "##[error]Did not recognize the following languages: " + bad.join(", ")); J.annotate("error", "Did not recognize the following languages: " + bad.join(", ")); return { code: 1 }; }
    J.codeql = { langs: langs };
    J.log(s, "##[group]Setup CodeQL tools\nUsing CodeQL CLI version 2.19.3 sourced from the toolcache.\n##[endgroup]\n##[group]Initializing CodeQL databases\n" + langs.map(function (l) { return "Created database for " + l + " in " + J.ws + "/../../_temp/codeql_databases/" + l; }).join("\n") + "\n##[endgroup]");
    return { code: 0, secs: 9 };
  } });
  A.action("github/codeql-action/autobuild", { run: function (J, s) { J.log(s, "Attempting to automatically build " + ((J.codeql && J.codeql.langs) || []).join(", ") + " code\nNothing to build for interpreted languages."); return { code: 0, secs: 2 }; } });
  A.action("github/codeql-action/analyze", { run: function (J, s, w) {
    if (!J.codeql) { J.log(s, "##[error]Config file could not be found at expected location. Has the 'init' action been called?"); J.annotate("error", "Config file could not be found at expected location. Has the 'init' action been called?"); return { code: 1 }; }
    var flat = {}; (function walk(dir, rel) { var n = G.nodeAt(J.rs, dir); if (!n || n.type !== "d") return; keys(n.children).forEach(function (k) { if (k === ".git" || k === "node_modules") return; var ch = n.children[k], p = rel ? rel + "/" + k : k; if (ch.type === "d") walk(dir + "/" + k, p); else if (ch.type === "f") flat[p] = { sha: G.putObject(J.sys, { type: "blob", content: ch.content }), mode: "100644" }; }); })(J.ws, "");
    var res = cqAnalyze(J.sys, flat, J.codeql.langs);
    J.log(s, J.codeql.langs.map(function (l) { return "##[group]Interpreting results for " + l + "\nAnalysis produced the following metric data:\n|      Metric      | Value |\n| Total lines of " + l + " code in the database | " + (120 + l.length * 7) + " |\n##[endgroup]"; }).join("\n"));
    res.forEach(function (x) { J.log(s, x.rule.id + " at " + x.path + ":" + x.line + ": " + x.rule.msg); });
    if (J.perms["security-events"] !== "write") { J.log(s, "##[error]Resource not accessible by integration - https://docs.github.com/rest"); J.annotate("error", "Resource not accessible by integration - https://docs.github.com/rest"); return { code: 1, secs: 30 }; }
    J.r.codeScanningSetup = true;
    var isDefault = J.run.ref === "refs/heads/" + J.r.default;
    if (isDefault) cqApply(J.sys, J.r, res, J.run.ref);
    J.run.codeql = res;
    J.log(s, "Uploading results\nSuccessfully uploaded results\nWaiting for processing to finish...\nAnalysis upload status is complete.\n" + (res.length ? res.length + " result" + (res.length > 1 ? "s" : "") + " uploaded to code scanning" + (isDefault ? "." : " for " + J.run.ref + ".") : "No results found."));
    return { code: 0, secs: 40 };
  } });
  A.action("github/codeql-action/upload-sarif", { run: function (J, s) { J.log(s, "(upload-sarif isn't simulated: use the analyze action)"); return { code: 0 }; } });
  A.action("actions/dependency-review-action", { run: function (J, s, w) {
    if (J.run.event !== "pull_request" && J.run.event !== "pull_request_target") { J.log(s, "##[error]This run was triggered by the \"" + J.run.event + "\" event, which is unsupported. Please ensure you are using the \"pull_request\" event, or provide base-ref and head-ref inputs."); J.annotate("error", "Dependency review only runs on pull requests."); return { code: 1 }; }
    var base = J.run.payload.pull_request.base.sha, head = J.run.headSha, before = depsAt(J.sys, base), after = depsAt(J.sys, head), min = SEVRANK[(w["fail-on-severity"] || "low").toLowerCase()] || 1;
    var added = after.filter(function (d) { return !before.some(function (b) { return b.name === d.name && b.version === d.version && b.manifest === d.manifest; }); });
    var bad = vulnsOf(added).filter(function (x) { return SEVRANK[x.adv.sev] >= min; });
    J.log(s, "Dependency review\nThe following changes were found:\n" + (added.length ? added.map(function (d) { return "  + " + d.name + "@" + d.version + " (" + d.eco + ", " + d.manifest + ")"; }).join("\n") : "  (no dependency changes)"));
    if (!bad.length) { J.log(s, "✅ No vulnerabilities or license issues found."); return { code: 0, secs: 3 }; }
    J.log(s, "We found " + bad.length + " vulnerable package" + (bad.length > 1 ? "s" : "") + ".\n##[group]Vulnerabilities\n" + bad.map(function (x) { return x.dep.manifest + " » " + x.dep.name + "@" + x.dep.version + " – " + x.adv.summary + " (" + x.adv.sev + " severity)\n  ↪ https://github.com/advisories/" + x.adv.ghsa; }).join("\n") + "\n##[endgroup]\n##[error]Dependency review detected vulnerable packages.");
    J.annotate("error", "Dependency review detected vulnerable packages.");
    return { code: 1, secs: 3 };
  } });
  A.action("notify-hub/slack-notify", { run: function (J, s, w, env, ra) {
    var url = w["webhook-url"] || env.SLACK_WEBHOOK || "";
    if (!url) { J.log(s, "##[error]Input required and not supplied: webhook-url"); J.annotate("error", "Input required and not supplied: webhook-url"); return { code: 1 }; }
    J.log(s, "notify-hub/slack-notify " + ra.tag + "\nPosting to Slack: " + (w.message || "Workflow " + J.run.wfName + " finished") + "\nok");
    return { code: 0, secs: 1 };
  } });

  /* ================================================================== OIDC: short-lived credentials for workflows */
  function b64url(s) { return GH.b64encode(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); }
  function unb64url(s) { s = String(s).replace(/-/g, "+").replace(/_/g, "/"); while (s.length % 4) s += "="; return GH.b64decode(s); }
  A.envHooks.push(function (J, env) {
    if (J.perms["id-token"] !== "write") return;
    var st = A.svc(J.sys), req = "oidcreq_" + M2.hashChars("oidc" + J.run.id + ":" + J.job.id, 24, "abcdefghijklmnopqrstuvwxyz0123456789");
    st.oidcReq = st.oidcReq || {};
    var ref = J.run.ref, sub = "repo:" + J.r.full + ":" + (J.job.envName ? "environment:" + J.job.envName : J.run.event.indexOf("pull_request") === 0 ? "pull_request" : "ref:" + ref);
    st.oidcReq[req] = { iss: "https://token.actions.githubusercontent.com", sub: sub, repository: J.r.full, repository_owner: J.r.owner, ref: ref, sha: J.run.sha, workflow: J.run.wfName, job_workflow_ref: J.r.full + "/" + J.run.wfPath + "@" + ref, environment: J.job.envName || undefined, event_name: J.run.event, actor: J.run.actor, run_id: String(J.run.id), runner_environment: "github-hosted" };
    env.ACTIONS_ID_TOKEN_REQUEST_URL = "https://pipelines.actions.githubusercontent.com/oidc/" + J.run.id + "/token?api-version=2.0";
    env.ACTIONS_ID_TOKEN_REQUEST_TOKEN = req;
    J.addMask(req);
  });
  if (M2.net && M2.net.SITES) {
    M2.net.DNS["pipelines.actions.githubusercontent.com"] = { A: ["13.107.42.16"] };
    M2.net.HOSTS["13.107.42.16"] = { ping: 8.1, ports: [443], site: "gh-oidc" };
    M2.net.SITES["gh-oidc"] = function (req, sys) {
      var st = A.svc(sys), tok = (req.headers.authorization || "").replace(/^bearer\s+/i, ""), c = (st.oidcReq || {})[tok];
      if (!c) return { status: 401, headers: { "Content-Type": "application/json" }, body: "{\"message\":\"Unauthorized\"}\n" };
      var aud = (/[?&]audience=([^&]+)/.exec(req.path) || [])[1], claims = Object.assign({}, c, { aud: aud ? decodeURIComponent(aud) : "https://github.com/" + c.repository_owner, iat: now(sys), nbf: now(sys) - 5, exp: now(sys) + 300, jti: M2.hashChars("jti" + tok + aud, 36, "0123456789abcdef") });
      var jwt = b64url(JSON.stringify({ typ: "JWT", alg: "RS256", kid: "38826b17-6a30-5f9b-b169-8beb8202f723" })) + "." + b64url(JSON.stringify(claims)) + "." + b64url("sig:" + M2.sha256(JSON.stringify(claims)));
      return { status: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ count: 1, value: jwt }) + "\n" };
    };
    // deploy.kestrel.io: swap a GitHub OIDC token for a 15-minute deploy token
    var deploySite = M2.net.SITES["kestrel-deploy"];
    M2.net.SITES["kestrel-deploy"] = function (req, sys) {
      if (req.path.split("?")[0] === "/api/tokens/self") {
        // revoke the token you authenticate with (what to do first when one leaks)
        var stv = A.svc(sys), tk = (req.headers.authorization || "").replace(/^Bearer\s+/i, ""), te = stv.tokens[tk];
        if (req.method !== "DELETE") return { status: 405, headers: { "Content-Type": "application/json" }, body: "{\"error\":\"use DELETE to revoke the token you send\"}\n" };
        if (!te) return { status: 401, headers: { "Content-Type": "application/json" }, body: "{\"error\":\"invalid token\"}\n" };
        if (te.revoked) return { status: 410, headers: { "Content-Type": "application/json" }, body: "{\"error\":\"token already revoked\"}\n" };
        te.revoked = true; te.revokedAt = now(sys);
        return { status: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ revoked: true, site: te.site, environment: te.env }) + "\n" };
      }
      if (req.path.split("?")[0] !== "/api/oidc/token") return deploySite(req, sys);
      var st = A.svc(sys), body = String(req.body || ""), idt = (/(?:^|&)id_token=([^&]+)/.exec(body) || [])[1];
      if (!idt && /^\s*\{/.test(body)) { try { idt = JSON.parse(body).id_token; } catch (e) { idt = null; } }
      function j(code, o) { return { status: code, headers: { "Content-Type": "application/json", Server: "kestrel-deploy/2.1" }, body: JSON.stringify(o) + "\n" }; }
      if (req.method !== "POST") return j(405, { error: "use POST" });
      if (!idt) return j(400, { error: "id_token is required" });
      var parts = decodeURIComponent(idt).split("."), claims;
      try { claims = JSON.parse(unb64url(parts[1])); } catch (e) { return j(401, { error: "malformed id_token" }); }
      if (claims.iss !== "https://token.actions.githubusercontent.com" || parts[2] !== b64url("sig:" + M2.sha256(JSON.stringify(claims)))) return j(401, { error: "id_token signature is not from GitHub Actions" });
      if (claims.exp < now(sys)) return j(401, { error: "id_token expired" });
      if (claims.aud !== "deploy.kestrel.io") return j(401, { error: "audience must be deploy.kestrel.io, got " + claims.aud });
      var trust = (st.trust || []).filter(function (t) { return t.sub === claims.sub; })[0];
      if (!trust) return j(403, { error: "no trust policy matches subject " + claims.sub, trusted: (st.trust || []).map(function (t) { return t.sub; }) });
      var t2 = A.deployToken(sys, trust.site, trust.env);
      st.tokens[t2].oidc = true; st.tokens[t2].expires = now(sys) + 900; st.tokens[t2].sub = claims.sub;
      return j(201, { token: t2, site: trust.site, environment: trust.env, expires_in: 900 });
    };
  }
  A.trust = function (sys, sub, site, env) { var st = A.svc(sys); st.trust = (st.trust || []).concat([{ sub: sub, site: site, env: env }]); };

  /* ================================================================== access control: deploy keys, teams, audit log */
  var repoOrig = GH.ghCommands.repo;
  GH.ghCommands.repo = function (c, a) {
    if (a[0] !== "deploy-key") return repoOrig(c, a);
    var sub = a[1], f = GH.flags(a.slice(2), { vals: ["title", "t", "R", "repo"], short: { t: "title", R: "repo", w: "allow-write" } });
    var login = GH.needAuth(c); if (!login) return 4;
    var r = GH.ghRepo(c, f.repo); if (!r) return 1;
    if (GH.role(c.sys, r, login) !== "admin") { c.o.err("HTTP 404: Not Found (https://api.github.com/repos/" + r.full + "/keys)"); return 1; }
    if (sub === "add") {
      var rf = S.readFile(c.sess, f._[0] || ""); if (rf.error) { c.o.err("open " + (f._[0] || "") + ": no such file or directory"); return 1; }
      var m = /^(ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp256)\s+(\S+)/.exec(rf.content.trim());
      if (!m || /PRIVATE KEY/.test(rf.content)) { c.o.err("HTTP 422: Validation Failed (https://api.github.com/repos/" + r.full + "/keys)\nkey is invalid. You must supply a key in OpenSSH public key format"); return 1; }
      var hubR = GH.hub(c.sys), used = keys(hubR.repos).some(function (k) { return hubR.repos[k].deployKeys.some(function (x) { return x.blob === m[2]; }); }) || keys(hubR.users).some(function (u) { return hubR.users[u].keys.some(function (x) { return x.blob === m[2]; }); });
      if (used) { c.o.err("HTTP 422: Validation Failed (https://api.github.com/repos/" + r.full + "/keys)\nkey is already in use"); return 1; }
      var id = 90000000 + hash(m[2]) % 9000000;
      r.deployKeys.push({ id: id, title: f.title || "", blob: m[2], type: m[1], readOnly: !f["allow-write"], added: now(c.sys), by: login });
      GH.audit(c.sys, login, "public_key.create", { repo: r.full, deploy_key: true, read_only: !f["allow-write"], title: f.title || "" });
      c.o.line("✓ Deploy key added to " + r.full);
      return 0;
    }
    if (sub === "list") { if (!r.deployKeys.length) { c.o.err("no deploy keys found in " + r.full); return 0; } r.deployKeys.forEach(function (k) { c.o.line(k.id + "\t" + k.title + "\t" + (k.readOnly ? "read-only" : "read-write") + "\t" + k.type + " " + k.blob.slice(0, 20) + "...\t" + GH.ago(c.sys, k.added)); }); return 0; }
    if (sub === "delete") { var before = r.deployKeys.length; r.deployKeys = r.deployKeys.filter(function (k) { return String(k.id) !== String(f._[0]); }); if (r.deployKeys.length === before) { c.o.err("HTTP 404: Not Found (https://api.github.com/repos/" + r.full + "/keys/" + f._[0] + ")"); return 1; } GH.audit(c.sys, login, "public_key.delete", { repo: r.full, deploy_key: true }); c.o.line("✓ Deploy key deleted from " + r.full); return 0; }
    c.o.err("Usage:  gh repo deploy-key <command> [flags]\n\nAvailable commands:\n  add\n  delete\n  list"); return 1;
  };
  GH.api("GET", /^repos\/([^/]+\/[^/]+)\/keys$/, function (c, m) { var r = GH.find(c.sys, m[1]); return r.deployKeys.map(function (k) { return { id: k.id, title: k.title, key: k.type + " " + k.blob, read_only: k.readOnly, created_at: ghIso(k.added || 0) }; }); });
  GH.api("GET", /^repos\/([^/]+\/[^/]+)\/teams$/, function (c, m) { var r = GH.find(c.sys, m[1]), org = GH.hub(c.sys).orgs[r.owner], rr = (org && org.repoRoles[r.full]) || {}; return keys(rr).filter(function (k) { return k.charAt(0) === "@"; }).map(function (k) { return { slug: k.slice(1), name: k.slice(1), permission: { read: "pull", write: "push", triage: "triage", maintain: "maintain", admin: "admin" }[rr[k]] || rr[k], role_name: rr[k] }; }); });
  function teamRepo(method) {
    GH.api(method, /^orgs\/([^/]+)\/teams\/([^/]+)\/repos\/([^/]+\/[^/]+)$/, function (c, m, b, login) {
      var org = GH.hub(c.sys).orgs[m[1]], r = GH.find(c.sys, m[3]);
      if (!org || !org.teams[m[2]] || !r) return nf();
      if (GH.role(c.sys, r, login) !== "admin") return { status: 403, body: { message: "Must have admin rights to Repository.", status: "403" } };
      org.repoRoles[r.full] = org.repoRoles[r.full] || {};
      if (method === "DELETE") { delete org.repoRoles[r.full]["@" + m[2]]; GH.audit(c.sys, login, "team.remove_repository", { team: m[1] + "/" + m[2], repo: r.full }); return { status: 204 }; }
      var map = { pull: "read", push: "write", read: "read", write: "write", triage: "triage", maintain: "maintain", admin: "admin" }, perm = map[b.permission || "push"];
      if (!perm) return { status: 422, body: { message: "permission must be pull, triage, push, maintain or admin", status: "422" } };
      org.repoRoles[r.full]["@" + m[2]] = perm;
      GH.audit(c.sys, login, "team.add_repository", { team: m[1] + "/" + m[2], repo: r.full, permission: perm });
      return { status: 204 };
    });
  }
  teamRepo("PUT"); teamRepo("DELETE");
  GH.api("GET", /^orgs\/([^/]+)\/teams\/([^/]+)\/members$/, function (c, m) { var org = GH.hub(c.sys).orgs[m[1]]; if (!org || !org.teams[m[2]]) return nf(); return org.teams[m[2]].map(function (x) { return { login: x }; }); });
  GH.api("GET", /^orgs\/([^/]+)\/members$/, function (c, m, b, login, q) { var org = GH.hub(c.sys).orgs[m[1]]; if (!org) return nf(); return keys(org.members).filter(function (x) { return !q.role || q.role === "all" || (q.role === "admin") === (org.members[x] === "owner"); }).map(function (x) { return { login: x }; }); });
  GH.api("GET", /^orgs\/([^/]+)\/audit-log$/, function (c, m, b, login, q) {
    var h = GH.hub(c.sys), org = h.orgs[m[1]];
    if (!org) return nf();
    if (org.members[login] !== "owner" && !(org.auditReaders || []).some(function (x) { return x === login; })) return { status: 403, body: { message: "Must be an organization owner (or have the audit log role) to read the audit log.", status: "403" } };
    var ph = String(q.phrase || "").split(/\s+/).filter(Boolean).map(function (t) { var i = t.indexOf(":"); return i > 0 ? [t.slice(0, i), t.slice(i + 1)] : ["", t]; });
    var list = h.audit.filter(function (e) { return !e.repo || e.repo.split("/")[0] === m[1] || e.org === m[1]; }).filter(function (e) { return ph.every(function (p) { var k = p[0], v = p[1]; if (k === "action") return v.indexOf("*") >= 0 ? new RegExp("^" + v.replace(/\./g, "\\.").replace(/\*/g, ".*") + "$").test(e.action) : e.action === v || e.action.indexOf(v + ".") === 0; if (k === "actor") return e.actor === v; if (k === "repo") return e.repo === v; return JSON.stringify(e).indexOf(v) >= 0; }); });
    list = list.slice().sort(function (x, y) { return y["@timestamp"] - x["@timestamp"]; }).slice(0, +(q.per_page || 30));
    return list.map(function (e) { var o = Object.assign({}, e); o.created_at = e["@timestamp"]; return o; });
  });

  /* ================================================================== kc: the Kestrel Cloud CLI (API keys and their audit trail) */
  function cloud(sys) { var st = A.svc(sys); if (!st.cloud) st.cloud = { keys: {}, events: [], user: "dev@kestrel.io" }; return st.cloud; }
  SEC.cloud = cloud;
  SEC.cloudKey = function (sys, o) { var cl = cloud(sys), id = "ak_" + M2.hashChars("akid" + o.name + keys(cl.keys).length, 6, "abcdef0123456789"), secret = "kcak_" + M2.hashChars("aks" + id + o.name, 40, "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"); cl.keys[id] = { id: id, name: o.name, secret: secret, scopes: o.scopes || ["projects:read", "deploy:write"], created: o.created || now(sys) - 86400 * 30, revoked: false, owner: o.owner || "dev@kestrel.io", lastUsed: null }; return cl.keys[id]; };
  SEC.cloudEvent = function (sys, keyId, at, ip, what, status) { cloud(sys).events.push({ key: keyId, at: at, ip: ip, what: what, status: status || 200 }); var k = cloud(sys).keys[keyId]; if (k && (!k.lastUsed || at > k.lastUsed)) k.lastUsed = at; };
  function kcTable(rows) { var w = rows[0].map(function (h, i) { return Math.max.apply(null, rows.map(function (r) { return String(r[i]).length; })); }); return rows.map(function (r) { return r.map(function (x, i) { return i === r.length - 1 ? String(x) : X.pad(String(x), w[i]); }).join("  "); }).join("\n"); }
  S.CMDS.kc = function (args, io, sess) {
    var a = args.slice(1), sys = sess.sys, cl = cloud(sys);
    var cred = rd(sys, sess.home + "/.config/kc/credentials");
    if (!a.length || a[0] === "--help" || a[0] === "help") { outl(io, "kc: the Kestrel Cloud CLI\n\nUsage:\n  kc whoami\n  kc keys list\n  kc keys create --name NAME [--scopes a,b]\n  kc keys revoke KEY_ID\n  kc audit [--key KEY_ID] [--since YYYY-MM-DD]\n  kc version"); return 0; }
    if (a[0] === "version" || a[0] === "--version") { outl(io, "kc 1.5.0"); return 0; }
    if (!cred) { errl(io, "kc: not logged in (run kc login)"); return 1; }
    if (a[0] === "whoami") { outl(io, cl.user + " (Kestrel Cloud, org kestrel)"); return 0; }
    if (a[0] === "keys" && (a[1] === "list" || a[1] === "ls")) {
      var ks = keys(cl.keys).map(function (k) { return cl.keys[k]; });
      outl(io, kcTable([["ID", "NAME", "PREFIX", "SCOPES", "CREATED", "LAST USED", "STATUS"]].concat(ks.map(function (k) { return [k.id, k.name, k.secret.slice(0, 9) + "…", k.scopes.join(","), ghIso(k.created).slice(0, 10), k.lastUsed ? ghIso(k.lastUsed).replace("T", " ").replace("Z", "") : "never", k.revoked ? "revoked" : "active"]; }))));
      return 0;
    }
    if (a[0] === "keys" && a[1] === "revoke") {
      var k = cl.keys[a[2]];
      if (!k) { errl(io, "kc: no API key with id " + (a[2] || "(none)") + " (kc keys list shows the ids)"); return 1; }
      if (k.revoked) { errl(io, "kc: " + k.id + " is already revoked"); return 0; }
      k.revoked = true; k.revokedAt = now(sys);
      outl(io, "✓ Revoked API key " + k.id + " (" + k.name + "). Requests using it now get 401.");
      return 0;
    }
    if (a[0] === "keys" && a[1] === "create") {
      var ni = a.indexOf("--name"), si = a.indexOf("--scopes"), name = ni >= 0 ? a[ni + 1] : null;
      if (!name) { errl(io, "kc: --name is required"); return 1; }
      var nk = SEC.cloudKey(sys, { name: name, scopes: si >= 0 ? a[si + 1].split(",") : null, created: now(sys) });
      outl(io, "✓ Created API key " + nk.id + " (" + nk.name + ")\n\n  " + nk.secret + "\n\nThis is the only time the key is shown. Store it somewhere safe (for CI: gh secret set).");
      return 0;
    }
    if (a[0] === "audit") {
      var ki = a.indexOf("--key"), sn = a.indexOf("--since"), keyF = ki >= 0 ? a[ki + 1] : null, since = sn >= 0 ? Date.parse(a[sn + 1] + "T00:00:00Z") / 1000 : 0;
      var ev = cl.events.filter(function (e) { return (!keyF || e.key === keyF) && e.at >= since; }).sort(function (x, y) { return x.at - y.at; });
      if (!ev.length) { outl(io, "(no events)"); return 0; }
      outl(io, kcTable([["TIME (UTC)", "KEY", "IP", "REQUEST", "STATUS"]].concat(ev.map(function (e) { return [ghIso(e.at).replace("T", " ").replace("Z", ""), e.key, e.ip, e.what, e.status]; }))));
      return 0;
    }
    errl(io, "kc: unknown command \"" + a.join(" ") + "\" (kc --help)");
    return 1;
  };
  if (M2.net && M2.net.SITES) {
    M2.net.DNS["api.kestrel.io"] = { A: ["203.0.113.82"] };
    M2.net.HOSTS["203.0.113.82"] = { ping: 6.0, ports: [443], site: "kestrel-cloud-api" };
    M2.net.SITES["kestrel-cloud-api"] = function (req, sys) {
      var cl = cloud(sys), auth = (req.headers.authorization || "").replace(/^Bearer\s+/i, ""), k = keys(cl.keys).map(function (x) { return cl.keys[x]; }).filter(function (x) { return x.secret === auth; })[0];
      var ip = sys.isRunner ? "20.42." + (hash(sys.host) % 200) + "." + (hash(sys.host + "x") % 250) : "198.51.100.23", p = req.path.split("?")[0];
      function j(code, o) { return { status: code, headers: { "Content-Type": "application/json", Server: "kestrel-api" }, body: JSON.stringify(o) + "\n" }; }
      if (!k || k.revoked) { if (k) SEC.cloudEvent(sys, k.id, now(sys), ip, req.method + " " + p, 401); return j(401, { error: k ? "API key revoked" : "invalid API key" }); }
      SEC.cloudEvent(sys, k.id, now(sys), ip, req.method + " " + p, 200);
      if (p === "/v1/whoami") return j(200, { key: k.id, name: k.name, owner: k.owner, scopes: k.scopes });
      if (p === "/v1/projects") return j(200, [{ id: "kestrel-web", region: "eu-west-1" }, { id: "kestrel-status", region: "eu-west-1" }]);
      return j(404, { error: "not found" });
    };
  }

  /* ================================================================== explanations, man pages */
  var EX = root.ShLab && root.ShLab.EXPLAIN;
  if (EX) [
    [/GH013: Repository rule violations found/, "GitHub's push protection found a secret in the commits you're pushing. Remove it from those commits (amend, or rebase -i and edit), then push again. If it's really a test value, GitHub can record a bypass, but think twice."],
    [/this does not look like a fresh clone/, "filter-repo rewrites every commit, so it wants a fresh clone it can't hurt. Clone again into a new folder (or add --force if you're sure this copy is disposable)."],
    [/^gitleaks: command not found|Command 'gitleaks' not found/, "gitleaks isn't installed: sudo apt install gitleaks"],
    [/WRN leaks found: \d+/, "gitleaks found secrets. If a finding is real: remove it, rotate the secret, and keep it out of history. If it's a false positive (a test fixture), add its Fingerprint line to .gitleaksignore."],
    [/gpg failed to sign the data/, "Git tried to sign with GPG, which isn't set up. For SSH signing: git config --global gpg.format ssh and git config --global user.signingkey ~/.ssh/id_ed25519.pub"],
    [/allowedSignersFile needs to be configured/, "To check SSH signatures locally, Git needs a list of trusted keys: create ~/.ssh/allowed_signers (EMAIL namespaces=\"git\" KEY) and git config --global gpg.ssh.allowedSignersFile ~/.ssh/allowed_signers"],
    [/^No principal matched\./, "The signature is fine, but its key isn't in your allowed_signers file under any name. Add a line: EMAIL namespaces=\"git\" ssh-ed25519 AAAA..."],
    [/Commits must have verified signatures/, "This branch only accepts commits GitHub shows as Verified: signed with a key added to your account as a signing key (gh ssh-key add KEY.pub --type signing), with your account's email as committer."],
    [/Dependency review detected vulnerable packages/, "This pull request adds a dependency version with a known vulnerability. Upgrade it to the patched version (the log names it), update the lock file, and push."],
    [/no trust policy matches subject/, "Kestrel's deploy service only trusts specific GitHub OIDC subjects. Run the job in the environment the policy names (environment: production), so the token's subject matches."],
    [/no OIDC token available|ACTIONS_ID_TOKEN_REQUEST_URL: /, "The job can't ask GitHub for an OIDC token: give it permissions: id-token: write."]
  ].reverse().forEach(function (x) { EX.unshift(x); });
  if (S.MAN) {
    S.MAN["git-filter-repo"] = { syn: "git filter-repo [--path P] [--invert-paths] [--replace-text FILE] [--force]", desc: "Rewrite a repository's whole history: remove files or replace text in every commit.", opts: [["--invert-paths --path FILE", "remove FILE from every commit"], ["--replace-text FILE", "replace secrets listed in FILE (one per line) with ***REMOVED***"], ["--analyze", "report sizes of every path ever committed"], ["--force", "run even if this isn't a fresh clone"]] };
    S.MAN.kc = { syn: "kc <command>", desc: "Kestrel Cloud's command-line tool (simulated): API keys and their audit trail.", opts: [["keys list", "your API keys"], ["keys revoke ID", "revoke a key immediately"], ["keys create --name N", "make a new key (shown once)"], ["audit [--key ID]", "who used which key, from where"]] };
  }
  root.GitSec = SEC;
  if (typeof module !== "undefined" && module.exports) module.exports = SEC;
})(typeof window !== "undefined" ? window : globalThis);
