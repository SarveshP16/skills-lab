/* sudo learn — a simulated GitHub for the Git track (Modules 2-4), plus the git commands that talk to it (clone,
   remote, fetch, pull, push, ls-remote), git rebase (also interactive), and the gh CLI (auth, repo, pr, issue,
   label, ssh-key, api). GitHub's repositories live in sys.github and share the machine's Git object store, so
   transferring commits is just copying refs. Teammates are simulated by hooks (GH.on) that labs register. */
(function (root) {
  "use strict";
  var S = root.ShEngine, G = root.GitCore, GC = root.GitCmds, X = GC.X, CMDS = GC.CMDS, M2 = S.M2;
  var GH = {};
  var GH_HOSTKEY = "AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl";
  var GH_FP = "SHA256:+DiY3wvvV6TuJJhbpZisF/zLDA0zPMSvHdkr4UvCOqU";
  var RANK = { read: 1, triage: 2, write: 3, maintain: 4, admin: 5 };
  var LABELS = [["bug", "d73a4a", "Something isn't working"], ["documentation", "0075ca", "Improvements or additions to documentation"], ["duplicate", "cfd3d7", "This issue or pull request already exists"], ["enhancement", "a2eeef", "New feature or request"], ["good first issue", "7057ff", "Good for newcomers"], ["help wanted", "008672", "Extra attention is needed"], ["invalid", "e4e669", "This doesn't seem right"], ["question", "d876e3", "Further information is requested"], ["wontfix", "ffffff", "This will not be worked on"]];
  function keys(o) { return Object.keys(o); }
  function short(s) { return G.abbrev(s, 7); }
  function subject(m) { return String(m || "").split("\n")[0]; }
  function die(c, msg, code) { return X.die(c, msg, code); }
  function now(sys) { return G.clock(sys); }

  /* ================================================================== state */
  function hub(sys) {
    if (!sys.github) sys.github = { users: {}, orgs: {}, repos: {}, me: "kc-dev", audit: [], hooks: [], tokens: {}, seq: 0 };
    return sys.github;
  }
  GH.hub = hub;
  GH.user = function (sys, login, o) { var h = hub(sys); h.users[login] = Object.assign({ login: login, name: login, email: login + "@users.noreply.github.com", keys: [], signing: [], created: now(sys) }, o || {}); return h.users[login]; };
  GH.org = function (sys, name, members, teams) { var h = hub(sys); h.orgs[name] = { name: name, members: members || {}, teams: teams || {}, base: "read", repoRoles: {} }; return h.orgs[name]; };
  GH.team = function (sys, org, slug) { var o = hub(sys).orgs[org]; return o && o.teams[slug] ? o.teams[slug] : []; };
  GH.find = function (sys, full) { var h = hub(sys), k = keys(h.repos).filter(function (x) { return x.toLowerCase() === String(full).toLowerCase(); })[0]; return k ? h.repos[k] : null; };
  GH.createRepo = function (sys, full, o) {
    o = o || {};
    var p = full.split("/"), h = hub(sys);
    var r = { full: full, owner: p[0], name: p[1], private: o.private !== false, default: o.default || "main", refs: {}, description: o.description || "", forkOf: o.forkOf || null,
      collab: o.collab || {}, protect: {}, items: [], labels: LABELS.map(function (l) { return { name: l[0], color: l[1], description: l[2] }; }),
      settings: Object.assign({ mergeCommit: true, squash: true, rebase: true, deleteBranchOnMerge: false, issues: true, secretScanning: false, pushProtection: false, dependabotAlerts: false, dependabotUpdates: false, actions: true, actionsPermissions: "read" }, o.settings || {}),
      secrets: {}, vars: {}, envs: {}, deployKeys: [], runs: [], releases: [], alerts: { secret: [], dependabot: [], code: [] }, caches: {}, artifacts: [], rulesets: [], created: now(sys) - 86400 * 40 };
    h.repos[full] = r;
    return r;
  };
  // Build a history with GitCore.build in a scratch folder, publish its branches and tags as a GitHub repository.
  GH.seed = function (sys, full, spec, o) {
    var tmp = "/var/tmp/.gh-seed-" + full.replace(/\W/g, "-");
    var lr = G.build(sys, tmp, Object.assign({ uid: 0, gid: 0 }, spec));
    var r = GH.find(sys, full) || GH.createRepo(sys, full, o);
    G.listRefs(lr, "refs/heads/").concat(G.listRefs(lr, "refs/tags/")).forEach(function (x) { r.refs[x.name] = x.sha; });
    if (o && o.default) r.default = o.default; else if (!r.refs["refs/heads/" + r.default]) r.default = (spec.branch || "main");
    G.removePath(sys, tmp);
    return r;
  };
  // A teammate commits straight to a GitHub branch (files: {path: content|null}).
  GH.commit = function (sys, full, branch, by, msg, files, at) {
    var r = GH.find(sys, full), ref = "refs/heads/" + branch, parent = r.refs[ref];
    var flat = parent ? G.commitFlat(sys, parent) : {};
    keys(files || {}).forEach(function (p) { if (files[p] === null) delete flat[p]; else flat[p] = { sha: G.putObject(sys, { type: "blob", content: files[p] }), mode: (flat[p] && flat[p].mode) || "100644" }; });
    var who = Object.assign({}, G.person(by), { time: at || now(sys) - 120, tz: "+0000" });
    var sha = G.putObject(sys, { type: "commit", tree: G.writeTree(sys, flat), parents: parent ? [parent] : [], author: who, committer: who, message: msg.replace(/\s*$/, "\n") });
    var old = r.refs[ref];
    r.refs[ref] = sha;
    GH.emit(sys, "push", { repo: r, ref: ref, before: old || null, after: sha, pusher: typeof by === "string" ? by : by.name, bot: true });
    return sha;
  };
  GH.on = function (sys, event, fn) { hub(sys).hooks.push({ event: event, fn: fn }); };
  GH.emit = function (sys, event, data) {
    var h = hub(sys), depth = (h._emitDepth = (h._emitDepth || 0) + 1);
    try { if (depth < 6) h.hooks.slice().forEach(function (x) { if (x.event === event) x.fn(sys, data); }); }
    finally { h._emitDepth--; }
  };
  GH.audit = function (sys, actor, action, data) { hub(sys).audit.push(Object.assign({ "@timestamp": now(sys) * 1000, actor: actor, action: action }, data || {})); };

  /* ================================================================== people, tokens, access */
  function role(sys, r, login) {
    if (!login) return r.private ? null : "read";
    if (r.owner === login) return "admin";
    if (r.collab[login]) return r.collab[login];
    var org = hub(sys).orgs[r.owner];
    if (org) { var rr = org.repoRoles[r.full] || {}; if (rr[login]) return rr[login]; var teamRole = null; keys(rr).forEach(function (k) { if (/^@/.test(k) && (org.teams[k.slice(1)] || []).indexOf(login) >= 0 && (!teamRole || RANK[rr[k]] > RANK[teamRole])) teamRole = rr[k]; }); if (teamRole) return teamRole; if (org.members[login]) return org.members[login] === "owner" ? "admin" : org.base; }
    return r.private ? null : "read";
  }
  function can(sys, r, login, need) { var x = role(sys, r, login); return !!x && RANK[x] >= RANK[need]; }
  GH.role = role; GH.can = can;
  GH.newToken = function (sys, login, o) {
    o = o || {};
    var h = hub(sys); h.seq++;
    var prefix = o.fine ? "github" + "_pat_" : "gh" + "p_";
    var value = prefix + M2.hashChars("tok" + login + h.seq + (o.note || ""), o.fine ? 82 : 36, "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789");
    h.tokens[value] = { login: login, scopes: o.scopes || ["repo", "read:org", "workflow", "gist"], note: o.note || "", fine: !!o.fine, repos: o.repos || null, created: now(sys), revoked: false, expires: o.expires || null };
    return value;
  };
  function tokenInfo(sys, t) { var x = hub(sys).tokens[t]; return x && !x.revoked ? x : null; }
  GH.tokenInfo = tokenInfo;
  // gh's login: hosts.yml plus the token kept in sys.ghAuth (gh keeps it in the keyring).
  GH.login = function (sys, login, token, o) {
    o = o || {};
    token = token || GH.newToken(sys, login);
    sys.ghAuth = { login: login, token: token, protocol: o.protocol || "https" };
    var home = o.home || "/home/dev";
    G.putFile(sys, home + "/.config/gh/hosts.yml", "github.com:\n    users:\n        " + login + ":\n    git_protocol: " + sys.ghAuth.protocol + "\n    user: " + login + "\n", 384, 1000, 1000);
    G.putFile(sys, home + "/.config/gh/config.yml", "version: 1\ngit_protocol: " + sys.ghAuth.protocol + "\neditor:\nprompt: enabled\npager:\n", 420, 1000, 1000);
    if (o.setupGit) setupGitCreds(sys, home);
    return token;
  };
  function setupGitCreds(sys, home) {
    var p = home + "/.gitconfig", t = G.readText(sys, p) || "";
    if (/gh auth git-credential/.test(t)) return;
    t = t.replace(/\n*$/, "\n") + "[credential \"https://github.com\"]\n\thelper = \n\thelper = !/usr/bin/gh auth git-credential\n[credential \"https://gist.github.com\"]\n\thelper = \n\thelper = !/usr/bin/gh auth git-credential\n";
    G.putFile(sys, p, t, 436, 1000, 1000);
  }
  function envToken(sess) { return S.getVar(sess, "GH_TOKEN") || S.getVar(sess, "GITHUB_TOKEN") || null; }
  function ghToken(sess) { return envToken(sess) || (sess.sys.ghAuth && sess.sys.ghAuth.token) || null; }
  GH.ghToken = ghToken;

  /* ================================================================== URLs and connecting */
  function parseUrl(u) {
    var m;
    if ((m = /^https:\/\/(?:([^@\/]+)@)?github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/.exec(u))) return { proto: "https", cred: m[1] || null, full: m[2] + "/" + m[3], url: u };
    if ((m = /^(?:ssh:\/\/)?git@github\.com[:\/]([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/.exec(u))) return { proto: "ssh", full: m[1] + "/" + m[2], url: u };
    return null;
  }
  GH.parseUrl = parseUrl;
  function shownUrl(p, push) { return p.proto === "ssh" ? "github.com:" + p.full + (push ? ".git" : "") : "https://github.com/" + p.full + (push ? ".git" : ""); }
  function remoteUrl(c, name) { return G.configGet(c.sys, c.repo, c.uid, "remote." + name + ".url", c.cfgExtra); }
  function remoteNames(c) {
    var seen = [];
    G.configAll(c.sys, c.repo, c.uid, c.cfgExtra).forEach(function (e) { var m = /^remote\.(.+)\.url$/.exec(e.key); if (m && seen.indexOf(m[1]) < 0) seen.push(m[1]); });
    return seen;
  }
  GH.remoteNames = remoteNames; GH.remoteUrl = remoteUrl;
  function credHelpers(c) {
    var list = [];
    G.configAll(c.sys, c.repo, c.uid, c.cfgExtra).forEach(function (e) { if (e.key === "credential.helper" || e.key === "credential.https://github.com.helper") { if (e.value === "") list = []; else list.push(e.value); } });
    return list;
  }
  function httpsCred(c, p) {
    if (p.cred) { var parts = p.cred.split(":"); return parts.length > 1 ? parts[1] : parts[0]; }
    var helpers = credHelpers(c);
    for (var i = 0; i < helpers.length; i++) {
      var hp = helpers[i];
      if (/gh auth git-credential/.test(hp)) { var t = ghToken(c.sess); if (t) return t; }
      if (/^store\b/.test(hp)) {
        var fm = /--file[= ](\S+)/.exec(hp), f = fm ? fm[1].replace(/^~/, c.sess.home) : c.sess.home + "/.git-credentials";
        var txt = G.readText(c.sys, f) || "", m = /https:\/\/([^:@\s]+):([^@\s]+)@github\.com/.exec(txt);
        if (m) return decodeURIComponent(m[2]);
      }
    }
    return null;
  }
  function sshIdentities(c) {
    var home = c.sess.home, files = [];
    var conf = G.readText(c.sys, home + "/.ssh/config") || "", inHost = false;
    conf.split("\n").forEach(function (l) { var m = /^\s*Host\s+(.+)$/i.exec(l); if (m) { inHost = m[1].split(/\s+/).some(function (h) { return S.globMatch(h, "github.com"); }); return; } var f = /^\s*IdentityFile\s+(\S+)/i.exec(l); if (f && inHost) files.push(f[1].replace(/^~/, home)); });
    ["id_ed25519", "id_ecdsa", "id_rsa"].forEach(function (n) { files.push(home + "/.ssh/" + n); });
    var out = [];
    files.forEach(function (p) { var n = G.nodeAt(c.sys, p); if (!n || n.type !== "f") return; var pub = M2.ssh.pubOfPriv(n.content); if (pub) out.push({ path: p, pub: pub, bad: (n.mode & 63) !== 0 }); });
    return out;
  }
  function knownHost(c, quiet) {
    var kh = c.sess.home + "/.ssh/known_hosts", t = G.readText(c.sys, kh) || "";
    if (/^github\.com\s/m.test(t) || /^\|1\|/m.test(t) && /github/.test(c.sys.ghKnown || "")) return;
    if (!quiet) {
      c.o.err("The authenticity of host 'github.com (140.82.121.4)' can't be established.\nED25519 key fingerprint is " + GH_FP + ".\nThis key is not known by any other names.\nAre you sure you want to continue connecting (yes/no/[fingerprint])? yes\nWarning: Permanently added 'github.com' (ED25519) to the list of known hosts.");
      c.o.err("(The lab answered yes. " + GH_FP + " is GitHub's published ED25519 fingerprint: check it on docs.github.com the first time you connect.)");
    }
    G.ensureDir(c.sys, c.sess.home + "/.ssh", c.uid, c.uid, 448);
    G.putFile(c.sys, kh, t + "github.com ssh-ed25519 " + GH_HOSTKEY + "\n", 420, c.uid, c.uid);
  }
  // Who does GitHub think we are for this URL? {login, deploy} or {error}
  function authenticate(c, p, need, quiet) {
    var sys = c.sys;
    if (p.proto === "https") {
      var t = httpsCred(c, p);
      if (!t) return need === "read" ? { anon: true } : { error: "fatal: could not read Username for 'https://github.com': No such device or address", code: 128 };
      var ti = tokenInfo(sys, t);
      if (!ti) return { error: "remote: " + (/^(gh[pousr]_|github_pat_)/.test(t) ? "Invalid username or token." : "Support for password authentication was removed on August 13, 2021.\nremote: Please see https://docs.github.com/get-started/getting-started-with-git/about-remote-repositories#cloning-with-https-urls for information on currently recommended modes of authentication.") + (/^(gh[pousr]_|github_pat_)/.test(t) ? " Password authentication is not supported for Git operations." : "") + "\nfatal: Authentication failed for 'https://github.com/" + p.full + ".git/'", code: 128 };
      if (ti.expires && ti.expires < now(sys)) return { error: "remote: Invalid username or token. Password authentication is not supported for Git operations.\nfatal: Authentication failed for 'https://github.com/" + p.full + ".git/'", code: 128 };
      return { login: ti.login, token: ti };
    }
    knownHost(c, quiet);
    var ids = sshIdentities(c), h = hub(sys);
    for (var i = 0; i < ids.length; i++) {
      if (ids[i].bad) continue;
      var blob = ids[i].pub.blob;
      var u = keys(h.users).filter(function (k) { return h.users[k].keys.some(function (x) { return x.blob === blob; }); })[0];
      if (u) return { login: u, key: ids[i] };
      var dr = keys(h.repos).filter(function (k) { return h.repos[k].deployKeys.some(function (x) { return x.blob === blob; }); })[0];
      if (dr) { var dk = h.repos[dr].deployKeys.filter(function (x) { return x.blob === blob; })[0]; return { deploy: dr, readOnly: dk.readOnly, key: ids[i] }; }
    }
    if (ids.some(function (x) { return x.bad; })) c.o.err("@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@\n@         WARNING: UNPROTECTED PRIVATE KEY FILE!          @\n@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@\nThis private key will be ignored.");
    return { error: "git@github.com: Permission denied (publickey).\nfatal: Could not read from remote repository.\n\nPlease make sure you have the correct access rights\nand the repository exists.", code: 128 };
  }
  // Open a GitHub repository for reading or writing. Returns {repo, login, p} or prints the error and returns null.
  function connect(c, url, need) {
    var p = parseUrl(url);
    if (!p) {
      var abs = url.charAt(0) === "/" ? url : S.normAbs(c.cwd + "/" + url);
      c.o.err("fatal: '" + url + "' does not appear to be a git repository\nfatal: Could not read from remote repository.\n\nPlease make sure you have the correct access rights\nand the repository exists.");
      void abs; c.lastCode = 128; return null;
    }
    var a = authenticate(c, p, need);
    if (a.error) { c.o.err(a.error); c.lastCode = a.code; return null; }
    var r = GH.find(c.sys, p.full);
    var notFound = p.proto === "ssh" ? "ERROR: Repository not found.\nfatal: Could not read from remote repository.\n\nPlease make sure you have the correct access rights\nand the repository exists." : "remote: Repository not found.\nfatal: repository 'https://github.com/" + p.full + ".git/' not found";
    if (!r) { c.o.err(notFound); c.lastCode = 128; return null; }
    if (a.deploy) {
      if (a.deploy !== r.full) { c.o.err(notFound); c.lastCode = 128; return null; }
      if (need === "write" && a.readOnly) { c.o.err("ERROR: The key you are authenticating with has been marked as read only.\nfatal: Could not read from remote repository.\n\nPlease make sure you have the correct access rights\nand the repository exists."); c.lastCode = 128; return null; }
      return { repo: r, login: null, deploy: true, p: p };
    }
    var login = a.login || null;
    if (!can(c.sys, r, login, "read")) { if (a.anon && r.private) { c.o.err("fatal: could not read Username for 'https://github.com': No such device or address"); c.lastCode = 128; return null; } c.o.err(notFound); c.lastCode = 128; return null; }
    if (need === "write") {
      if (a.anon) { c.o.err("fatal: could not read Username for 'https://github.com': No such device or address"); c.lastCode = 128; return null; }
      if (a.token && a.token.fine && a.token.repos && a.token.repos.indexOf(r.full) < 0) { c.o.err("remote: Permission to " + r.full + ".git denied to " + login + ".\nfatal: unable to access 'https://github.com/" + r.full + ".git/': The requested URL returned error: 403"); c.lastCode = 128; return null; }
      if (!can(c.sys, r, login, "write")) { c.o.err(p.proto === "ssh" ? "ERROR: Permission to " + r.full + ".git denied to " + login + ".\nfatal: Could not read from remote repository.\n\nPlease make sure you have the correct access rights\nand the repository exists." : "remote: Permission to " + r.full + ".git denied to " + login + ".\nfatal: unable to access 'https://github.com/" + r.full + ".git/': The requested URL returned error: 403"); c.lastCode = 128; return null; }
    }
    return { repo: r, login: login, p: p, token: a.token || null };
  }
  GH.connect = connect;

  /* ================================================================== object counts (for the progress lines) */
  function newObjects(sys, tips, haves) {
    var have = {}; haves.forEach(function (s) { if (s) G.ancestors(sys, s, have); });
    var commits = [], seen = {};
    tips.forEach(function (t) { var a = G.ancestors(sys, t); keys(a).forEach(function (k) { if (!have[k] && !seen[k]) { seen[k] = 1; commits.push(k); } }); });
    var objs = commits.length;
    commits.forEach(function (s) { var co = G.commitOf(sys, s); var pf = co.parents[0] ? G.commitFlat(sys, co.parents[0]) : {}, f = G.commitFlat(sys, s); objs += 1 + keys(f).filter(function (k) { return !pf[k] || pf[k].sha !== f[k].sha; }).length; });
    return { commits: commits.length, objects: objs };
  }
  function kib(n) { var b = n * 237; return b < 1024 ? b + " bytes | " + b + ".00 KiB/s" : (b / 1024).toFixed(2) + " KiB | " + (b / 1024).toFixed(2) + " MiB/s"; }

  /* ================================================================== git clone */
  function checkoutInto(c, repo, sha) {
    var flat = G.commitFlat(c.sys, sha), idx = { entries: {}, conflicts: {} };
    keys(flat).forEach(function (p) { G.writeWork(repo, p, flat[p].sha, flat[p].mode, X.umask(c)); idx.entries[p] = flat[p]; });
    G.writeIndex(repo, idx);
  }
  function writeConfig(sys, repo, pairs) {
    var t = G.gread(repo, "config") || "";
    pairs.forEach(function (kv) { t = G.setInConfig(t, kv[0], kv[1]); });
    G.gwrite(repo, "config", t);
  }
  function addFetchSpec(sys, repo, name, url) { writeConfig(sys, repo, [["remote." + name + ".url", url], ["remote." + name + ".fetch", "+refs/heads/*:refs/remotes/" + name + "/*"]]); }
  function storeReachable(sys, repo, tips) { var a = {}; tips.forEach(function (t) { if (t) G.ancestors(sys, G.peel(sys, t), a); }); keys(a).forEach(function (s) { G.writeLoose(repo, s); var co = G.commitOf(sys, s); G.writeLoose(repo, co.tree); }); }
  function cmdClone(c, args) {
    var p = X.parseOpts(c, args, ["b|branch=", "depth=", "o|origin=", "q|quiet", "single-branch", "no-checkout", "bare", "recurse-submodules", "filter="], "git clone [<options>] [--] <repo> [<dir>]");
    var o = p.o, a = p.rest;
    if (!a.length) die(c, "fatal: You must specify a repository to clone.\n\nusage: git clone [<options>] [--] <repo> [<dir>]", 129);
    var url = a[0], pu = parseUrl(url);
    var dirName = a[1] || (pu ? pu.full.split("/")[1] : url.replace(/\/$/, "").split("/").pop().replace(/\.git$/, ""));
    var dest = S.normAbs(dirName.charAt(0) === "/" ? dirName : c.cwd + "/" + dirName);
    var dn = G.nodeAt(c.sys, dest);
    if (dn && (dn.type !== "d" || keys(dn.children).length)) die(c, "fatal: destination path '" + dirName + "' already exists and is not an empty directory.");
    var parent = G.nodeAt(c.sys, dest.slice(0, dest.lastIndexOf("/")) || "/");
    if (!parent || !S.can(c.sess, parent, "w")) die(c, "fatal: could not create work tree dir '" + dirName + "': Permission denied");
    if (!o.q) c.o.line("Cloning into '" + dirName + "'...");
    var conn = connect(c, url, "read");
    if (!conn) return c.lastCode || 128;
    var r = conn.repo, origin = o.origin || "origin";
    var heads = keys(r.refs).filter(function (k) { return /^refs\/heads\//.test(k); });
    var branch = o.branch || r.default;
    if (o.branch && !r.refs["refs/heads/" + o.branch] && !r.refs["refs/tags/" + o.branch]) { die(c, "warning: Could not find remote branch " + o.branch + " to clone.\nfatal: Remote branch " + o.branch + " not found in upstream " + origin); }
    var repo = G.initRepo(c.sys, dest, c.uid, c.sess.gid, branch);
    addFetchSpec(c.sys, repo, origin, url);
    var who = X.softIdent({ sys: c.sys, sess: c.sess, repo: repo, uid: c.uid, cfgExtra: c.cfgExtra });
    if (!heads.length) { c.o.err("warning: You appear to have cloned an empty repository."); return 0; }
    var tips = keys(r.refs).map(function (k) { return r.refs[k]; });
    var cnt = newObjects(c.sys, tips.map(function (s) { return G.peel(c.sys, s); }), []);
    if (!o.q) c.o.line("remote: Enumerating objects: " + cnt.objects + ", done.\nremote: Counting objects: 100% (" + cnt.objects + "/" + cnt.objects + "), done.\nremote: Compressing objects: 100% (" + Math.ceil(cnt.objects * 0.6) + "/" + Math.ceil(cnt.objects * 0.6) + "), done.\nremote: Total " + cnt.objects + " (delta " + Math.floor(cnt.objects / 4) + "), reused " + Math.floor(cnt.objects / 2) + " (delta " + Math.floor(cnt.objects / 8) + "), pack-reused 0\nReceiving objects: 100% (" + cnt.objects + "/" + cnt.objects + "), " + kib(cnt.objects) + ", done.\nResolving deltas: 100% (" + Math.floor(cnt.objects / 4) + "/" + Math.floor(cnt.objects / 4) + "), done.");
    heads.forEach(function (k) { G.updateRef(repo, "refs/remotes/" + origin + "/" + k.slice(11), r.refs[k], false); });
    G.gwrite(repo, "refs/remotes/" + origin + "/HEAD", "ref: refs/remotes/" + origin + "/" + r.default + "\n");
    keys(r.refs).filter(function (k) { return /^refs\/tags\//.test(k); }).forEach(function (k) { G.gwrite(repo, k, r.refs[k] + "\n"); });
    var sha = r.refs["refs/heads/" + branch] || G.peel(c.sys, r.refs["refs/tags/" + branch]);
    storeReachable(c.sys, repo, tips);
    var name = "refs/heads/" + branch;
    G.gwrite(repo, name, sha + "\n");
    G.logRef(repo, name, null, sha, "clone: from " + url, who);
    G.logRef(repo, "HEAD", null, sha, "clone: from " + url, who);
    writeConfig(c.sys, repo, [["branch." + branch + ".remote", origin], ["branch." + branch + ".merge", "refs/heads/" + branch]]);
    if (!o["no-checkout"]) checkoutInto(c, repo, sha);
    var top = G.nodeAt(c.sys, dest); if (top) { top.uid = c.uid; top.gid = c.sess.gid; }
    GH.emit(c.sys, "clone", { repo: r, dest: dest, login: conn.login });
    return 0;
  }

  /* ================================================================== git remote */
  function cmdRemote(c, args) {
    var p = X.parseOpts(c, args, ["v|verbose", "f", "t|track=+", "m|master=", "push", "add", "all", "delete"], "git remote [-v | --verbose]");
    var a = p.rest, repo = c.repo, names = remoteNames(c);
    var sub = a[0];
    if (!sub) { names.forEach(function (n) { if (p.o.verbose) { var u = remoteUrl(c, n); c.o.line(n + "\t" + u + " (fetch)"); c.o.line(n + "\t" + (G.configGet(c.sys, repo, c.uid, "remote." + n + ".pushurl") || u) + " (push)"); } else c.o.line(n); }); return 0; }
    if (sub === "add") {
      var nm = a[1], url = a[2];
      if (!nm || !url) die(c, "usage: git remote add [<options>] <name> <url>", 129);
      if (names.indexOf(nm) >= 0) die(c, "error: remote " + nm + " already exists.", 3);
      if (!/^[\w.-]+$/.test(nm)) die(c, "fatal: '" + nm + "' is not a valid remote name");
      addFetchSpec(c.sys, repo, nm, url);
      if (p.o.f) return cmdFetch(c, [nm]);
      return 0;
    }
    if (sub === "remove" || sub === "rm") {
      var n2 = a[1]; if (names.indexOf(n2) < 0) die(c, "error: No such remote: '" + n2 + "'", 2);
      var t = G.gread(repo, "config");
      t = t.replace(new RegExp("\\[remote \"" + n2.replace(/[.]/g, "\\.") + "\"\\][^\\[]*", "g"), "");
      t = t.split(/(?=\[branch ")/).map(function (sec) { return new RegExp("\\n\\tremote = " + n2.replace(/[.]/g, "\\.") + "\\n").test(sec) ? sec.replace(/\n\tremote = [^\n]*\n/, "\n").replace(/\n\tmerge = [^\n]*\n?/, "\n") : sec; }).join("").replace(/\[branch "[^"]+"\]\n(?=\[|$)/g, "");
      G.gwrite(repo, "config", t);
      G.listRefs(repo, "refs/remotes/" + n2 + "/").forEach(function (r) { G.updateRef(repo, r.name, null); });
      G.gremove(repo, "refs/remotes/" + n2);
      return 0;
    }
    if (sub === "rename") {
      var from = a[1], to = a[2];
      if (names.indexOf(from) < 0) die(c, "error: No such remote: '" + from + "'", 2);
      if (names.indexOf(to) >= 0) die(c, "error: remote " + to + " already exists.", 3);
      var t2 = G.gread(repo, "config").split("[remote \"" + from + "\"]").join("[remote \"" + to + "\"]").split("refs/remotes/" + from + "/").join("refs/remotes/" + to + "/").replace(new RegExp("(\\n\\tremote = )" + from.replace(/[.]/g, "\\.") + "\\n", "g"), "$1" + to + "\n");
      G.gwrite(repo, "config", t2);
      G.listRefs(repo, "refs/remotes/" + from + "/").forEach(function (r) { G.gwrite(repo, "refs/remotes/" + to + "/" + r.name.slice(14 + from.length - 1), r.sha + "\n"); G.updateRef(repo, r.name, null); });
      var hsym = G.gread(repo, "refs/remotes/" + to + "/HEAD"); if (hsym) G.gwrite(repo, "refs/remotes/" + to + "/HEAD", hsym.replace("refs/remotes/" + from + "/", "refs/remotes/" + to + "/"));
      G.gremove(repo, "refs/remotes/" + from);
      return 0;
    }
    if (sub === "set-url") {
      var n3 = a[1], u3 = a[2];
      if (!n3 || !u3) die(c, "usage: git remote set-url [--push] <name> <newurl> [<oldurl>]", 129);
      if (names.indexOf(n3) < 0) die(c, "error: No such remote '" + n3 + "'", 2);
      writeConfig(c.sys, repo, [["remote." + n3 + (p.o.push ? ".pushurl" : ".url"), u3]]);
      return 0;
    }
    if (sub === "get-url") { var n4 = a[1]; if (names.indexOf(n4) < 0) die(c, "error: No such remote '" + n4 + "'", 2); c.o.line(remoteUrl(c, n4)); return 0; }
    if (sub === "show") {
      var n5 = a[1]; if (names.indexOf(n5) < 0) die(c, "error: No such remote '" + n5 + "'", 2);
      var u5 = remoteUrl(c, n5), conn = connect(c, u5, "read"); if (!conn) return c.lastCode || 128;
      var rr = conn.repo;
      c.o.line("* remote " + n5 + "\n  Fetch URL: " + u5 + "\n  Push  URL: " + u5 + "\n  HEAD branch: " + rr.default + "\n  Remote branch" + (keys(rr.refs).filter(function (k) { return /^refs\/heads\//.test(k); }).length > 1 ? "es" : "") + ":");
      keys(rr.refs).filter(function (k) { return /^refs\/heads\//.test(k); }).sort().forEach(function (k) { var b = k.slice(11); c.o.line("    " + X.pad(b, 20) + (G.resolveRefName(repo, "refs/remotes/" + n5 + "/" + b).sha ? "tracked" : "new (next fetch will store in remotes/" + n5 + ")")); });
      return 0;
    }
    if (sub === "prune") return cmdFetch(c, ["--prune", a[1] || "origin"]);
    die(c, "error: Unknown subcommand: " + sub + "\nusage: git remote [-v | --verbose]\n   or: git remote add [-t <branch>] [-m <master>] [-f] <name> <url>\n   or: git remote rename <old> <new>\n   or: git remote remove <name>\n   or: git remote set-url [--push] <name> <newurl> [<oldurl>]", 129);
  }

  /* ================================================================== git fetch */
  function fetchOne(c, name, o, out) {
    var url = remoteUrl(c, name);
    if (!url) { var pu = parseUrl(name); if (!pu) { c.o.err("fatal: '" + name + "' does not appear to be a git repository\nfatal: Could not read from remote repository.\n\nPlease make sure you have the correct access rights\nand the repository exists."); return 128; } url = name; }
    var conn = connect(c, url, "read");
    if (!conn) return c.lastCode || 128;
    var r = conn.repo, repo = c.repo, lines = [], tips = [], haves = [];
    var isNamed = !!remoteUrl(c, name);
    keys(r.refs).filter(function (k) { return /^refs\/heads\//.test(k); }).sort().forEach(function (k) {
      var b = k.slice(11), local = "refs/remotes/" + name + "/" + b, old = isNamed ? G.resolveRefName(repo, local).sha : null, nw = r.refs[k];
      tips.push(nw); if (old) haves.push(old);
      if (old === nw || !isNamed) return;
      var kind = !old ? "new" : G.isAncestor(c.sys, old, nw) ? "ff" : "forced";
      G.updateRef(repo, local, nw, false);
      lines.push(kind === "new" ? " * [new branch]      " + X.pad(b, 10) + " -> " + name + "/" + b : kind === "ff" ? "   " + short(old) + ".." + short(nw) + "  " + X.pad(b, 10) + " -> " + name + "/" + b : " + " + short(old) + "..." + short(nw) + " " + X.pad(b, 10) + " -> " + name + "/" + b + "  (forced update)");
    });
    if (isNamed && (o.prune || G.configBool(G.configGet(c.sys, repo, c.uid, "fetch.prune"), false))) {
      G.listRefs(repo, "refs/remotes/" + name + "/").forEach(function (lr) { var b = lr.name.slice(14 + name.length - 1); if (b === "HEAD") return; if (!r.refs["refs/heads/" + b]) { G.updateRef(repo, lr.name, null); lines.push(" - [deleted]         (none)     -> " + name + "/" + b); } });
    }
    keys(r.refs).filter(function (k) { return /^refs\/tags\//.test(k); }).sort().forEach(function (k) {
      if (G.resolveRefName(repo, k).sha) return;
      var target = G.peel(c.sys, r.refs[k]);
      if (!o.tags && !tips.some(function (t) { return G.isAncestor(c.sys, target, t); })) return;
      G.gwrite(repo, k, r.refs[k] + "\n");
      lines.push(" * [new tag]         " + X.pad(k.slice(10), 10) + " -> " + k.slice(10));
    });
    if (!isNamed && o.refspec) {
      var src = o.refspec.split(":")[0], sha = r.refs["refs/heads/" + src.replace(/^refs\/heads\//, "")] || r.refs[src];
      if (!sha) { c.o.err("fatal: couldn't find remote ref " + src); return 128; }
      G.gwrite(repo, "FETCH_HEAD", sha + "\t\tbranch '" + src + "' of " + shownUrl(conn.p) + "\n");
      lines.push(" * branch            " + X.pad(src, 10) + " -> FETCH_HEAD");
      if (o.refspec.indexOf(":") > 0) { var dst = o.refspec.split(":")[1]; G.updateRef(repo, /^refs\//.test(dst) ? dst : "refs/heads/" + dst, sha, "fetch: storing head", X.softIdent(c)); }
      tips.push(sha);
    }
    if (lines.length) {
      var cnt = newObjects(c.sys, tips.map(function (t) { return G.peel(c.sys, t); }), haves);
      if (cnt.commits && !o.q) out.push("remote: Enumerating objects: " + cnt.objects + ", done.\nremote: Counting objects: 100% (" + cnt.objects + "/" + cnt.objects + "), done.\nremote: Compressing objects: 100% (" + Math.ceil(cnt.objects / 2) + "/" + Math.ceil(cnt.objects / 2) + "), done.\nremote: Total " + cnt.objects + " (delta " + Math.floor(cnt.objects / 3) + "), reused " + cnt.objects + " (delta " + Math.floor(cnt.objects / 3) + "), pack-reused 0\nUnpacking objects: 100% (" + cnt.objects + "/" + cnt.objects + "), " + kib(cnt.objects).split(" | ")[0] + " | 1.02 MiB/s, done.");
      if (!o.q) out.push("From " + shownUrl(conn.p) + "\n" + lines.join("\n"));
      storeReachable(c.sys, repo, tips);
    }
    var fh = keys(r.refs).filter(function (k) { return /^refs\/heads\//.test(k); }).map(function (k) { return r.refs[k] + "\t" + (k.slice(11) === G.head(repo).branch ? "" : "not-for-merge") + "\tbranch '" + k.slice(11) + "' of " + shownUrl(conn.p); });
    if (isNamed) G.gwrite(repo, "FETCH_HEAD", fh.join("\n") + "\n");
    return 0;
  }
  function cmdFetch(c, args) {
    var p = X.parseOpts(c, args, ["all", "p|prune", "t|tags", "q|quiet", "v|verbose", "depth=", "unshallow", "f|force", "dry-run", "multiple"], "git fetch [<options>] [<repository> [<refspec>...]]");
    var o = p.o, a = p.rest, out = [];
    o.refspec = a[1];
    var names = o.all ? remoteNames(c) : [a[0] || defaultRemote(c)];
    if (!names[0]) die(c, "fatal: No remote repository specified.  Please, specify either a URL or a\nremote name from which new revisions should be fetched.");
    var code = 0;
    names.forEach(function (n) { if (o.all && !o.q) out.push("Fetching " + n); var rc = fetchOne(c, n, o, out); if (rc) code = rc; });
    out.forEach(function (l) { c.o.line(l); });
    return code;
  }
  function defaultRemote(c) {
    var h = G.head(c.repo), names = remoteNames(c);
    var r = h.branch ? G.configGet(c.sys, c.repo, c.uid, "branch." + h.branch + ".remote") : null;
    return r || (names.indexOf("origin") >= 0 ? "origin" : names[0]) || null;
  }

  /* ================================================================== git pull */
  function cmdPull(c, args) {
    X.needWork(c);
    var p = X.parseOpts(c, args, ["r|rebase=?", "no-rebase", "ff-only", "ff", "no-ff", "q|quiet", "v|verbose", "all", "autostash", "no-edit", "tags", "p|prune"], "git pull [<options>] [<repository> [<refspec>...]]");
    var o = p.o, a = p.rest, repo = c.repo, h = G.head(repo);
    if (h.detached && !a[1]) die(c, "You are not currently on a branch.\nPlease specify which branch you want to merge with.\nSee git-pull(1) for details.\n\n    git pull <remote> <branch>\n", 1);
    var st = X.computeStatus(c);
    if (keys(st.idx.conflicts).length || G.gexists(repo, "MERGE_HEAD")) die(c, "error: Pulling is not possible because you have unmerged files.\nhint: Fix them up in the work tree, and then use 'git add/rm <file>'\nhint: as appropriate to mark resolution and make a commit.\nfatal: Exiting because of an unresolved conflict.");
    var remote = a[0] || defaultRemote(c);
    var mergeRef = a[1] ? "refs/heads/" + a[1].replace(/^refs\/heads\//, "") : G.configGet(c.sys, repo, c.uid, "branch." + h.branch + ".merge");
    if (!remote) die(c, "There is no tracking information for the current branch.\nPlease specify which branch you want to merge with.\nSee git-pull(1) for details.\n\n    git pull <remote> <branch>\n\nIf you wish to set tracking information for this branch you can do so with:\n\n    git branch --set-upstream-to=origin/<branch> " + h.branch + "\n", 1);
    if (!mergeRef) die(c, "There is no tracking information for the current branch.\nPlease specify which branch you want to merge with.\nSee git-pull(1) for details.\n\n    git pull <remote> <branch>\n\nIf you wish to set tracking information for this branch you can do so with:\n\n    git branch --set-upstream-to=" + remote + "/<branch> " + h.branch + "\n", 1);
    var out = [], rc = fetchOne(c, remote, { q: o.q, prune: o.prune, tags: o.tags }, out);
    out.forEach(function (l) { c.o.line(l); });
    if (rc) return rc;
    var b = mergeRef.replace(/^refs\/heads\//, "");
    var upRef = remoteUrl(c, remote) ? "refs/remotes/" + remote + "/" + b : null;
    var up = upRef ? G.resolveRefName(repo, upRef).sha : (G.gread(repo, "FETCH_HEAD") || "").split("\t")[0];
    if (!up) die(c, "fatal: couldn't find remote ref " + mergeRef);
    var cur = G.head(repo).sha;
    var rebaseCfg = o.rebase !== undefined ? o.rebase !== "false" : o["no-rebase"] ? false : G.configGet(c.sys, repo, c.uid, "branch." + h.branch + ".rebase") !== null ? G.configBool(G.configGet(c.sys, repo, c.uid, "branch." + h.branch + ".rebase"), false) : G.configGet(c.sys, repo, c.uid, "pull.rebase") !== null ? G.configBool(G.configGet(c.sys, repo, c.uid, "pull.rebase"), false) : null;
    var ffCfg = o["ff-only"] ? "only" : o.ff ? "true" : o["no-ff"] ? "false" : G.configGet(c.sys, repo, c.uid, "pull.ff");
    if (cur && G.isAncestor(c.sys, up, cur)) { c.o.line("Already up to date."); return 0; }
    var divergent = cur && !G.isAncestor(c.sys, cur, up);
    if (divergent && rebaseCfg === null && !ffCfg) {
      c.o.hint("You have divergent branches and need to specify how to reconcile them.\nYou can do so by running one of the following commands sometime before\nyour next pull:\n\n  git config pull.rebase false  # merge\n  git config pull.rebase true   # rebase\n  git config pull.ff only       # fast-forward only\n\nYou can replace \"git config\" with \"git config --global\" to set a default\npreference for all repositories. You can also pass --rebase, --no-rebase,\nor --ff-only on the command line to override the configured default per\ninvocation.");
      die(c, "fatal: Need to specify how to reconcile divergent branches.");
    }
    if (divergent && ffCfg === "only") die(c, "hint: Diverging branches can't be fast-forwarded, you need to either:\nhint:\nhint: \tgit merge --no-ff\nhint:\nhint: or:\nhint:\nhint: \tgit rebase\nhint:\nhint: Disable this message with \"git config advice.diverging false\"\nfatal: Not possible to fast-forward, aborting.");
    if (divergent && rebaseCfg) return rebaseStart(c, { upstream: up, upName: upRef ? upRef.replace(/^refs\/remotes\//, "") : "FETCH_HEAD", onto: up, pull: true });
    var conn = parseUrl(remoteUrl(c, remote) || remote);
    var msg = "Merge branch '" + b + "' of " + (conn ? shownUrl(conn) : remote);
    return X.cmdMerge(c, (ffCfg === "false" ? ["--no-ff"] : []).concat(["-m", msg, up]));
  }

  /* ================================================================== git push */
  // Server-side checks GitHub runs on a ref update: returns null or {reason, lines[]}
  function pushCheck(c, r, ref, old, nw, conn, force) {
    var res = null;
    GH.pushChecks.forEach(function (fn) { if (!res) res = fn(c, r, ref, old, nw, conn, force); });
    return res;
  }
  GH.pushChecks = [];
  GH.pushChecks.push(function (c, r, ref, old, nw, conn, force) {
    var b = ref.replace(/^refs\/heads\//, ""), pr = protectionFor(r, b);
    if (!pr || !/^refs\/heads\//.test(ref)) return null;
    var admin = conn.login && role(c.sys, r, conn.login) === "admin";
    var bypass = admin && !pr.enforceAdmins;
    var probs = [];
    if (nw === null && !pr.deletions) probs.push("Cannot delete this protected branch");
    else if (force && !pr.forcePush) probs.push("Cannot force-push to this branch");
    if (nw !== null && pr.pr) probs.push("Changes must be made through a pull request.");
    if (nw !== null && pr.checks && pr.checks.contexts && pr.checks.contexts.length && !pr.pr) probs.push(pr.checks.contexts.length + " of " + pr.checks.contexts.length + " required status checks are expected.");
    if (nw !== null && pr.signatures && unsignedCommits(c.sys, r, old, nw).length) probs.push("Commits must have verified signatures.");
    if (nw !== null && pr.linear && newCommits(c.sys, old, nw).some(function (s) { return G.commitOf(c.sys, s).parents.length > 1; })) probs.push("This branch must not contain merge commits.");
    if (!probs.length) return null;
    if (bypass) return { bypass: true, lines: ["remote: Bypassed rule violations for " + ref + ":", "remote: "].concat(probs.map(function (x) { return "remote: - " + x; })).concat(["remote: "]) };
    return { reason: "protected branch hook declined", lines: ["remote: error: GH006: Protected branch update failed for " + ref + ".", "remote: "].concat(probs.map(function (x) { return "remote: - " + x; })) };
  });
  function newCommits(sys, old, nw) { var have = old ? G.ancestors(sys, old) : {}; return keys(G.ancestors(sys, nw)).filter(function (s) { return !have[s]; }); }
  function unsignedCommits(sys, r, old, nw) { return newCommits(sys, old, nw).filter(function (s) { return !GH.verified(sys, s); }); }
  GH.newCommits = newCommits;
  GH.verified = function (sys, sha) { return GH.verify ? GH.verify(sys, sha).verified : false; };
  function protectionFor(r, branch) { return r.protect[branch] || null; }
  GH.protectionFor = protectionFor;
  function cmdPush(c, args) {
    var p = X.parseOpts(c, args, ["u|set-upstream", "f|force", "force-with-lease=?", "tags", "all", "d|delete", "n|dry-run", "q|quiet", "v|verbose", "no-verify", "follow-tags", "porcelain", "atomic", "o|push-option=+", "mirror", "prune"], "git push [<options>] [<repository> [<refspec>...]]");
    var o = p.o, a = p.rest.slice(), repo = c.repo, h = G.head(repo);
    var names = remoteNames(c), remote, url;
    if (a.length && (names.indexOf(a[0]) >= 0 || parseUrl(a[0]))) { remote = a.shift(); }
    else if (a.length && !/[:+]/.test(a[0]) && !G.resolveRefName(repo, "refs/heads/" + a[0]).sha && !G.resolveRefName(repo, "refs/tags/" + a[0]).sha) { die(c, "fatal: '" + a[0] + "' does not appear to be a git repository\nfatal: Could not read from remote repository.\n\nPlease make sure you have the correct access rights\nand the repository exists."); }
    else remote = (h.branch && (G.configGet(c.sys, repo, c.uid, "branch." + h.branch + ".pushremote") || G.configGet(c.sys, repo, c.uid, "remote.pushdefault") || G.configGet(c.sys, repo, c.uid, "branch." + h.branch + ".remote"))) || (names.indexOf("origin") >= 0 ? "origin" : names[0]);
    if (!remote) die(c, "fatal: No configured push destination.\nEither specify the URL from the command-line or configure a remote repository using\n\n    git remote add <name> <url>\n\nand then push using the remote name\n\n    git push <name>\n");
    url = G.configGet(c.sys, repo, c.uid, "remote." + remote + ".pushurl") || remoteUrl(c, remote) || remote;
    var isNamed = !!remoteUrl(c, remote);
    var specs = [];
    if (o.delete) a.forEach(function (x) { specs.push({ src: null, dst: "refs/heads/" + x.replace(/^refs\/heads\//, ""), force: false }); });
    else if (o.all) G.listRefs(repo, "refs/heads/").forEach(function (r) { specs.push({ src: r.name, dst: r.name, force: false }); });
    else if (a.length) a.forEach(function (x) {
      var force = x.charAt(0) === "+"; if (force) x = x.slice(1);
      var parts = x.split(":"), src = parts[0], dst = parts.length > 1 ? parts[1] : null;
      if (src === "") { specs.push({ src: null, dst: /^refs\//.test(dst) ? dst : "refs/heads/" + dst, force: force }); return; }
      var full = src === "HEAD" ? (h.detached ? null : h.ref) : G.resolveRefName(repo, "refs/heads/" + src).sha ? "refs/heads/" + src : G.resolveRefName(repo, "refs/tags/" + src).sha ? "refs/tags/" + src : /^refs\//.test(src) ? src : null;
      var sha = full ? G.resolveRefName(repo, full).sha : X.tryRev(c, src);
      if (!sha) die(c, "error: src refspec " + src + " does not match any\nerror: failed to push some refs to '" + url + "'", 1);
      specs.push({ src: full || src, sha: sha, dst: dst ? (/^refs\//.test(dst) ? dst : (full && /^refs\/tags\//.test(full) ? "refs/tags/" : "refs/heads/") + dst) : full, force: force });
    });
    else if (!o.tags) {
      if (h.detached) die(c, "fatal: You are not currently on a branch.\nTo push the history leading to the current (detached HEAD)\nstate now, use\n\n    git push " + remote + " HEAD:<name-of-remote-branch>\n");
      var upR = G.configGet(c.sys, repo, c.uid, "branch." + h.branch + ".remote"), upM = G.configGet(c.sys, repo, c.uid, "branch." + h.branch + ".merge");
      var auto = G.configBool(G.configGet(c.sys, repo, c.uid, "push.autosetupremote"), false);
      if ((!upR || !upM || upR !== remote) && !o["set-upstream"] && !auto && isNamed) {
        die(c, "fatal: The current branch " + h.branch + " has no upstream branch.\nTo push the current branch and set the remote as upstream, use\n\n    git push --set-upstream " + remote + " " + h.branch + "\n\nTo have this happen automatically for branches without a tracking\nupstream, see 'push.autoSetupRemote' in 'git help config'.\n");
      }
      if (upM && upR === remote && upM !== h.ref && (G.configGet(c.sys, repo, c.uid, "push.default") || "simple") === "simple") die(c, "fatal: The upstream branch of your current branch does not match\nthe name of your current branch.  To push to the upstream branch\non the remote, use\n\n    git push " + remote + " HEAD:" + upM.replace(/^refs\/heads\//, "") + "\n\nTo push to the branch of the same name on the remote, use\n\n    git push " + remote + " HEAD\n");
      if (!h.sha) die(c, "error: src refspec " + h.branch + " does not match any\nerror: failed to push some refs to '" + url + "'", 1);
      if (auto && !upR) o["set-upstream"] = true;
      specs.push({ src: h.ref, sha: h.sha, dst: h.ref, force: false });
    }
    if (o.tags || o["follow-tags"]) G.listRefs(repo, "refs/tags/").forEach(function (t) { if (!specs.some(function (s) { return s.dst === t.name; })) specs.push({ src: t.name, sha: t.sha, dst: t.name, force: false, tag: true, onlyNew: true }); });
    specs.forEach(function (s) { if (s.src && !s.sha) s.sha = G.resolveRefName(repo, s.src).sha; });
    if (!o["no-verify"]) {
      var hookIn = specs.map(function (s) { return (s.src || "(delete)") + " " + (s.sha || G.zero()) + " " + s.dst + " " + G.zero(); }).join("\n") + "\n";
      var prev = c.io.stdin; c.io.stdin = hookIn;
      var hrc = X.runHook(c, "pre-push", [remote, url]);
      c.io.stdin = prev;
      if (hrc) { c.o.err("error: failed to push some refs to '" + url + "'"); return 1; }
    }
    var conn = connect(c, url, "write");
    if (!conn) return c.lastCode || 128;
    var r = conn.repo, results = [], remoteLines = [], updated = [], rejected = false, reasonFetch = false, reasonBehind = false;
    var force = !!o.force;
    specs.forEach(function (s) {
      var old = r.refs[s.dst] || null, nw = s.sha || null, srcShown = (s.src || "").replace(/^refs\/(heads|tags)\//, ""), dstShown = s.dst.replace(/^refs\/(heads|tags)\//, "");
      var label = (srcShown ? srcShown + " -> " : "") + dstShown;
      if (s.onlyNew && old) return;
      if (nw === null) { if (!old) { results.push(" ! [rejected]        " + dstShown + " (remote ref does not exist)"); rejected = true; return; } }
      else if (old === nw) { results.push({ up: true, text: "Everything up-to-date" }); return; }
      var isTag = /^refs\/tags\//.test(s.dst);
      var ff = !old || nw === null || (!isTag && G.isAncestor(c.sys, old, G.peel(c.sys, nw)));
      if (o["force-with-lease"] !== undefined && old && nw) {
        var expect = typeof o["force-with-lease"] === "string" && o["force-with-lease"].indexOf(":") > 0 ? X.tryRev(c, o["force-with-lease"].split(":")[1]) : G.resolveRefName(repo, "refs/remotes/" + remote + "/" + dstShown).sha;
        if (expect !== old) { results.push(" ! [rejected]        " + label + " (stale info)"); rejected = true; return; }
        ff = true; s.forced = !G.isAncestor(c.sys, old, nw);
      }
      if (!ff && !force && !s.force) {
        var known = !!G.getObject(c.sys, old) && G.listRefs(repo, "refs/").some(function (lr) { return G.isAncestor(c.sys, old, G.peel(c.sys, lr.sha)); });
        if (isTag) results.push(" ! [rejected]        " + label + " (already exists)");
        else if (!known) { results.push(" ! [rejected]        " + label + " (fetch first)"); reasonFetch = true; }
        else { results.push(" ! [rejected]        " + label + " (non-fast-forward)"); reasonBehind = true; }
        rejected = true; return;
      }
      var forced = !ff || s.forced;
      var chk = pushCheck(c, r, s.dst, old, nw, conn, forced);
      if (chk && !chk.bypass) { remoteLines = remoteLines.concat(chk.lines); results.push(" ! [remote rejected] " + label + " (" + chk.reason + ")"); rejected = true; return; }
      if (chk && chk.bypass) remoteLines = remoteLines.concat(chk.lines);
      updated.push({ s: s, old: old, nw: nw, label: label, forced: forced, dstShown: dstShown });
    });
    if (o.atomic && rejected) updated = [];
    var real = updated.filter(function (u) { return u.nw !== null; });
    if (real.length && !o.q) {
      var cnt = newObjects(c.sys, real.map(function (u) { return G.peel(c.sys, u.nw); }), keys(r.refs).map(function (k) { return G.peel(c.sys, r.refs[k]); }));
      var n = Math.max(cnt.objects, 3), d = Math.max(0, Math.floor(n / 2));
      if (cnt.commits) c.o.line("Enumerating objects: " + n + ", done.\nCounting objects: 100% (" + n + "/" + n + "), done.\nDelta compression using up to 8 threads\nCompressing objects: 100% (" + Math.ceil(n / 2) + "/" + Math.ceil(n / 2) + "), done.\nWriting objects: 100% (" + Math.ceil(n * 0.6) + "/" + Math.ceil(n * 0.6) + "), " + kib(n) + ", done.\nTotal " + Math.ceil(n * 0.6) + " (delta " + d + "), reused 0 (delta 0), pack-reused 0");
      if (cnt.commits && d) remoteLines.unshift("remote: Resolving deltas: 100% (" + d + "/" + d + "), completed with " + d + " local object" + (d === 1 ? "" : "s") + ".");
    }
    updated.forEach(function (u) {
      if (u.nw === null) { results.push(" - [deleted]         " + u.dstShown); delete r.refs[u.s.dst]; if (isNamed) G.updateRef(repo, "refs/remotes/" + remote + "/" + u.dstShown, null); }
      else {
        r.refs[u.s.dst] = u.nw;
        if (!u.old) {
          results.push(" * [new " + (/^refs\/tags\//.test(u.s.dst) ? "tag]   " : "branch]") + "      " + u.label);
          if (/^refs\/heads\//.test(u.s.dst) && u.dstShown !== r.default) remoteLines.push("remote: ", "remote: Create a pull request for '" + u.dstShown + "' on GitHub by visiting:", "remote:      https://github.com/" + r.full + "/pull/new/" + u.dstShown, "remote: ");
        } else if (u.forced) results.push(" + " + short(u.old) + "..." + short(u.nw) + " " + u.label + " (forced update)");
        else results.push("   " + short(u.old) + ".." + short(u.nw) + "  " + u.label);
        if (isNamed && /^refs\/heads\//.test(u.s.dst)) G.updateRef(repo, "refs/remotes/" + remote + "/" + u.dstShown, u.nw, false);
      }
    });
    var allUp = results.length && results.every(function (x) { return x.up; });
    remoteLines.forEach(function (l) { c.o.line(l); });
    if (allUp) c.o.line("Everything up-to-date");
    else {
      var printed = results.filter(function (x) { return !x.up; });
      if (printed.length) c.o.line("To " + shownUrl(conn.p, true) + "\n" + printed.join("\n"));
    }
    if (o["set-upstream"] && !rejected) updated.forEach(function (u) { if (/^refs\/heads\//.test(u.s.dst) && u.s.src && /^refs\/heads\//.test(u.s.src) && isNamed) { X.setUpstream(c, u.s.src.slice(11), "refs/remotes/" + remote + "/" + u.dstShown); c.o.line("branch '" + u.s.src.slice(11) + "' set up to track '" + remote + "/" + u.dstShown + "'."); } });
    updated.forEach(function (u) { GH.emit(c.sys, "push", { repo: r, ref: u.s.dst, before: u.old, after: u.nw, pusher: conn.login, forced: u.forced, deploy: !!conn.deploy, viaToken: conn.token || null, proto: conn.p.proto, lease: o["force-with-lease"] !== undefined }); });
    c.sys.pushLog = (c.sys.pushLog || []).concat(updated.map(function (u) { return { repo: r.full, ref: u.s.dst, after: u.nw, proto: conn.p.proto, forced: u.forced, lease: o["force-with-lease"] !== undefined }; }));
    if (rejected) {
      c.o.err("error: failed to push some refs to '" + shownUrl(conn.p, true) + "'");
      if (reasonFetch) c.o.hint("Updates were rejected because the remote contains work that you do not\nhave locally. This is usually caused by another repository pushing to\nthe same ref. If you want to integrate the remote changes, use\n'git pull' before pushing again.\nSee the 'Note about fast-forwards' in 'git push --help' for details.");
      else if (reasonBehind) c.o.hint("Updates were rejected because the tip of your current branch is behind\nits remote counterpart. If you want to integrate the remote changes,\nuse 'git pull' before pushing again.\nSee the 'Note about fast-forwards' in 'git push --help' for details.");
      return 1;
    }
    return 0;
  }
  function cmdLsRemote(c, args) {
    var p = X.parseOpts(c, args, ["heads", "b|branches", "t|tags", "refs", "q|quiet", "symref"], "git ls-remote [--branches] [--tags] [--refs] [<repository> [<patterns>...]]");
    var target = p.rest[0] || (c.repo ? defaultRemote(c) : null);
    if (!target) die(c, "fatal: No remote configured to list refs from.");
    var url = (c.repo && remoteUrl(c, target)) || target, conn = connect(c, url, "read");
    if (!conn) return c.lastCode || 128;
    var r = conn.repo;
    if (!p.o.heads && !p.o.branches && !p.o.tags) c.o.line(r.refs["refs/heads/" + r.default] + "\tHEAD");
    keys(r.refs).sort().forEach(function (k) { if ((p.o.heads || p.o.branches) && !/^refs\/heads\//.test(k)) return; if (p.o.tags && !/^refs\/tags\//.test(k)) return; c.o.line(r.refs[k] + "\t" + k); });
    return 0;
  }

  /* ================================================================== git rebase */
  function rb(repo, f) { return G.gread(repo, "rebase-merge/" + f); }
  function rbw(repo, f, v) { G.gwrite(repo, "rebase-merge/" + f, v); }
  function todoParse(text) {
    return String(text || "").split("\n").map(function (l) { return l.trim(); }).filter(function (l) { return l && l.charAt(0) !== "#"; }).map(function (l) {
      var m = /^(\w+)\s+(?:(-[cC])\s+)?(\S+)(?:\s+(.*))?$/.exec(l);
      if (!m) return { bad: l };
      var cmd = { p: "pick", r: "reword", e: "edit", s: "squash", f: "fixup", d: "drop", x: "exec" }[m[1]] || m[1];
      if (cmd === "exec") return { cmd: "exec", arg: l.replace(/^\w+\s+/, "") };
      return { cmd: cmd, sha: m[3], rest: m[4] || "", line: l };
    });
  }
  function todoLine(t) { return t.cmd === "exec" ? "exec " + t.arg : t.cmd + " " + t.sha + " " + (t.rest || ""); }
  function rebaseCommits(c, upstream, head) {
    var excl = G.ancestors(c.sys, upstream);
    return X.walk(c, [head], [upstream], { topo: true }).reverse().filter(function (s) { return !excl[s] && G.commitOf(c.sys, s).parents.length < 2; });
  }
  function rebaseStart(c, opts) {
    var repo = c.repo, h = G.head(repo), who = X.softIdent(c);
    var st = X.computeStatus(c);
    if (st.staged.length || st.unstaged.length) {
      c.o.err("error: cannot " + (opts.pull ? "pull with rebase" : "rebase") + ": You have unstaged changes.\nerror: Please commit or stash them.");
      return 1;
    }
    var headSha = h.sha, commits = rebaseCommits(c, opts.upstream, headSha);
    if (!opts.interactive && G.isAncestor(c.sys, opts.onto, headSha) && !commits.some(function (s) { return !G.isAncestor(c.sys, s, opts.onto) && G.commitOf(c.sys, s).parents[0] && !G.isAncestor(c.sys, G.commitOf(c.sys, s).parents[0], opts.onto); }) && G.isAncestor(c.sys, opts.upstream, headSha) && opts.onto === opts.upstream) {
      c.o.line("Current branch " + (h.branch || "HEAD") + " is up to date.");
      return 0;
    }
    // skip commits already in upstream (same change)
    var upCommits = X.walk(c, [opts.upstream], [headSha], {}).map(function (s) { return patchId(c.sys, s); });
    var todo = commits.map(function (s) { var co = G.commitOf(c.sys, s); return { cmd: upCommits.indexOf(patchId(c.sys, s)) >= 0 && !opts.interactive ? "drop" : "pick", sha: short(s), rest: subject(co.message), full: s }; }).filter(function (t) { return t.cmd !== "drop"; });
    if (opts.autosquash) todo = autosquash(todo);
    G.ensureDir(c.sys, G.gpath(repo, "rebase-merge"), repo.uid, repo.gid, 509);
    rbw(repo, "head-name", (h.detached ? "detached HEAD" : h.ref) + "\n");
    rbw(repo, "onto", opts.onto + "\n");
    rbw(repo, "orig-head", headSha + "\n");
    rbw(repo, "upstream-name", (opts.upName || "") + "\n");
    G.gwrite(repo, "ORIG_HEAD", headSha + "\n");
    var todoText = todo.map(todoLine).join("\n") + "\n" + (opts.interactive ? "\n# Rebase " + short(opts.upstream) + ".." + short(headSha) + " onto " + short(opts.onto) + " (" + X.plural(todo.length, "command", "commands") + ")\n#\n# Commands:\n# p, pick <commit> = use commit\n# r, reword <commit> = use commit, but edit the commit message\n# e, edit <commit> = use commit, but stop for amending\n# s, squash <commit> = use commit, but meld into previous commit\n# f, fixup <commit> = like \"squash\" but keep only the previous\n#                    commit's log message\n# x, exec <command> = run command (the rest of the line) using shell\n# d, drop <commit> = remove commit\n#\n# These lines can be re-ordered; they are executed from top to bottom.\n#\n# If you remove a line here THAT COMMIT WILL BE LOST.\n#\n# However, if you remove everything, the rebase will be aborted.\n#\n" : "");
    rbw(repo, "git-rebase-todo", todoText);
    rbw(repo, "done", "");
    if (opts.interactive) rbw(repo, "interactive", "");
    if (opts.interactive) {
      var ed = S.getVar(c.sess, "GIT_SEQUENCE_EDITOR") || G.configGet(c.sys, repo, c.uid, "sequence.editor", c.cfgExtra);
      if (ed === null || ed === undefined || ed === "") {
        rbw(repo, "todo-edit", "");
        c.o.line("hint: Waiting for your editor to close the file...");
        c.o.err("(git opened the to-do list in your editor. In this lab: nano .git/rebase-merge/git-rebase-todo, change the words in front of the commits (pick, reword, edit, squash, fixup, drop), save, then run git rebase --continue. To give up: git rebase --abort.)");
        G.setHead(repo, headSha);
        return 0;
      }
      if (!/^\s*(:|true)\s*$/.test(ed)) {
        var sub = S.childSession(c.sess); sub.cwd = repo.top;
        var rc = S.runSource(sub, ed + " " + G.gpath(repo, "rebase-merge/git-rebase-todo"), c.io);
        if (rc) { cleanupRebase(repo); die(c, "error: There was a problem with the editor '" + ed + "'."); }
      }
    }
    return rebaseBegin(c, opts.onto);
  }
  function patchId(sys, s) { var co = G.commitOf(sys, s); if (!co.parents.length) return s; var a = G.commitFlat(sys, co.parents[0]), b = G.commitFlat(sys, s), parts = []; keys(a).concat(keys(b)).sort().forEach(function (k, i, arr) { if (arr.indexOf(k) !== i) return; var x = a[k] ? a[k].sha : "-", y = b[k] ? b[k].sha : "-"; if (x !== y) parts.push(k + ":" + x + ">" + y); }); return parts.join(";"); }
  function autosquash(todo) {
    var out = todo.filter(function (t) { return !/^(fixup|squash)! /.test(t.rest); });
    todo.filter(function (t) { return /^(fixup|squash)! /.test(t.rest); }).forEach(function (t) {
      var m = /^(fixup|squash)! (.*)$/.exec(t.rest), target = m[2];
      var k = -1; out.forEach(function (x, i) { if (x.rest === target || x.sha.indexOf(target) === 0 || target.indexOf(x.sha) === 0) k = i; });
      var item = Object.assign({}, t, { cmd: m[1] });
      if (k < 0) { out.push(Object.assign({}, t)); return; }
      var j = k + 1; while (j < out.length && /^(fixup|squash)$/.test(out[j].cmd)) j++;
      out.splice(j, 0, item);
    });
    return out;
  }
  function rebaseBegin(c, onto) {
    var repo = c.repo, who = X.softIdent(c);
    var flat = G.commitFlat(c.sys, onto);
    var prob = X.moveTree(c, flat, { force: true });
    if (prob) { cleanupRebase(repo); X.overwriteError(c, prob, "checkout", "rebase"); return 1; }
    G.setHead(repo, onto, "rebase (start): checkout " + (rb(repo, "upstream-name") || "").trim() || short(onto), who);
    return rebaseRun(c);
  }
  function resolveTodoSha(c, s) { var x = X.tryRev(c, s); if (!x) die(c, "error: invalid line: could not parse '" + s + "'"); return G.peel(c.sys, x); }
  function rebaseRun(c) {
    var repo = c.repo;
    for (;;) {
      var todo = todoParse(rb(repo, "git-rebase-todo"));
      if (!todo.length) return rebaseFinish(c);
      var t = todo.shift();
      rbw(repo, "git-rebase-todo", todo.map(todoLine).join("\n") + (todo.length ? "\n" : ""));
      rbw(repo, "done", (rb(repo, "done") || "") + todoLine(t) + "\n");
      if (t.bad) { die(c, "error: invalid line 1: " + t.bad + "\nYou can fix this with 'git rebase --edit-todo' and then run 'git rebase --continue'.\nOr you can abort the rebase with 'git rebase --abort'."); }
      if (t.cmd === "drop") continue;
      if (t.cmd === "exec") {
        c.o.line("Executing: " + t.arg);
        var sub = S.childSession(c.sess); sub.cwd = repo.top;
        var rc; try { rc = S.runSource(sub, t.arg, c.io); } catch (e) { if (e instanceof S.ExitSignal) rc = e.code; else throw e; }
        if (rc) { c.o.err("warning: execution failed: " + t.arg + "\nYou can fix the problem, and then run\n\n  git rebase --continue\n"); return 1; }
        continue;
      }
      if (["pick", "reword", "edit", "squash", "fixup"].indexOf(t.cmd) < 0) die(c, "error: invalid line: " + todoLine(t));
      var sha = resolveTodoSha(c, t.sha);
      var r = applyCommit(c, sha, t.cmd);
      if (r.conflict) {
        rbw(repo, "stopped-sha", sha + "\n");
        rbw(repo, "pending", t.cmd + "\n");
        c.o.err("error: could not apply " + short(sha) + "... " + subject(G.commitOf(c.sys, sha).message));
        c.o.hint("Resolve all conflicts manually, mark them as resolved with\n\"git add/rm <conflicted_files>\", then run \"git rebase --continue\".\nYou can instead skip this commit: run \"git rebase --skip\".\nTo abort and get back to the state before \"git rebase\", run \"git rebase --abort\".");
        c.o.line("Could not apply " + short(sha) + "... " + subject(G.commitOf(c.sys, sha).message));
        return 1;
      }
      if (t.cmd === "edit" || t.cmd === "reword") {
        rbw(repo, "amend", G.head(repo).sha + "\n");
        if (t.cmd === "edit") c.o.line("Stopped at " + short(sha) + "...  " + subject(G.commitOf(c.sys, sha).message) + "\nYou can amend the commit now, with\n\n  git commit --amend \n\nOnce you are satisfied with your changes, run\n\n  git rebase --continue");
        else c.o.line("Stopped at " + short(sha) + "...  " + subject(G.commitOf(c.sys, sha).message) + "\n(reword: git would open your editor for the message. In this lab: git commit --amend -m \"New message\", then git rebase --continue.)");
        return 0;
      }
    }
  }
  // Apply one commit on top of HEAD (pick), or meld it into HEAD (squash/fixup).
  function applyCommit(c, sha, cmd) {
    var repo = c.repo, sys = c.sys, co = G.commitOf(sys, sha), headSha = G.head(repo).sha;
    var base = co.parents[0] ? G.commitFlat(sys, co.parents[0]) : {}, ours = G.commitFlat(sys, headSha), theirs = G.commitFlat(sys, sha);
    var mr = G.mergeTrees(sys, base, ours, theirs, ["HEAD", short(sha) + " (" + subject(co.message) + ")"]);
    var res = X.applyMerge(c, mr, ours);
    if (res.error) { X.overwriteError(c, res.error, "merge", "rebase"); throw new X.Exit(1); }
    X.mergeMessages(c, mr);
    if (res.conflicts.length) return { conflict: true };
    return commitApplied(c, sha, cmd, mr.entries);
  }
  function commitApplied(c, sha, cmd, flat) {
    var repo = c.repo, sys = c.sys, co = G.commitOf(sys, sha), h = G.head(repo), cur = G.commitOf(sys, h.sha);
    var tree = G.writeTree(sys, flat);
    var committer = X.ident(c, "committer");
    var who = X.softIdent(c);
    if (cmd === "squash" || cmd === "fixup") {
      var msg = cmd === "fixup" ? cur.message : cur.message.replace(/\n+$/, "") + "\n\n" + co.message;
      var nsha = G.putObject(sys, { type: "commit", tree: tree, parents: cur.parents, author: cur.author, committer: committer, message: msg });
      G.setHead(repo, nsha, "rebase (" + cmd + "): " + subject(msg), who);
      return { sha: nsha };
    }
    if (tree === cur.tree && cmd === "pick") { c.o.err("dropping " + sha + " " + subject(co.message) + " -- patch contents already upstream"); return { empty: true }; }
    var csha = G.putObject(sys, { type: "commit", tree: tree, parents: [h.sha], author: co.author, committer: committer, message: co.message });
    G.setHead(repo, csha, "rebase (" + (cmd === "reword" ? "reword" : "pick") + "): " + subject(co.message), who);
    X.storeObjects(c);
    return { sha: csha };
  }
  function rebaseFinish(c) {
    var repo = c.repo, who = X.softIdent(c), headName = (rb(repo, "head-name") || "").trim(), sha = G.head(repo).sha;
    if (/^refs\//.test(headName)) {
      G.updateRef(repo, headName, sha, "rebase (finish): " + headName + " onto " + (rb(repo, "onto") || "").trim(), who);
      G.setHead(repo, headName, "rebase (finish): returning to " + headName, who);
    }
    cleanupRebase(repo);
    c.o.line("Successfully rebased and updated " + headName + ".");
    return 0;
  }
  function cleanupRebase(repo) { G.removePath(repo.sys, G.gpath(repo, "rebase-merge")); }
  function cmdRebase(c, args) {
    X.needWork(c);
    var p = X.parseOpts(c, args, ["i|interactive", "onto=", "continue", "abort", "skip", "quit", "edit-todo", "autosquash", "no-autosquash", "root", "q|quiet", "v|verbose", "f|force-rebase", "keep-base", "autostash", "x|exec=+", "update-refs", "show-current-patch"], "git rebase [-i] [options] [--exec <cmd>] [--onto <newbase> | --keep-base] [<upstream> [<branch>]]");
    var o = p.o, a = p.rest, repo = c.repo, inProgress = G.gexists(repo, "rebase-merge/head-name");
    if (o.abort || o.quit) {
      if (!inProgress) die(c, "fatal: No rebase in progress?");
      if (o.abort) {
        var orig = rb(repo, "orig-head").trim(), hn = rb(repo, "head-name").trim();
        X.moveTree(c, G.commitFlat(c.sys, orig), { force: true });
        if (/^refs\//.test(hn)) { G.setHead(repo, hn, "rebase (abort): returning to " + hn, X.softIdent(c)); }
        else G.setHead(repo, orig);
      }
      cleanupRebase(repo);
      return 0;
    }
    if (o["edit-todo"]) { if (!inProgress) die(c, "fatal: No rebase in progress?"); c.o.err("(In this lab: nano .git/rebase-merge/git-rebase-todo, save, then git rebase --continue.)"); return 0; }
    if (o.continue || o.skip) {
      if (!inProgress) die(c, "fatal: No rebase in progress?");
      if (G.gexists(repo, "rebase-merge/todo-edit")) { G.gremove(repo, "rebase-merge/todo-edit"); var td = todoParse(rb(repo, "git-rebase-todo")); if (!td.length) { var orig2 = rb(repo, "orig-head").trim(), hn2 = rb(repo, "head-name").trim(); cleanupRebase(repo); if (/^refs\//.test(hn2)) G.setHead(repo, hn2); else G.setHead(repo, orig2); c.o.line("Nothing to do"); return 0; } return rebaseBegin(c, rb(repo, "onto").trim()); }
      if (o.skip) {
        X.moveTree(c, G.commitFlat(c.sys, G.head(repo).sha), { force: true });
        G.gremove(repo, "rebase-merge/stopped-sha"); G.gremove(repo, "rebase-merge/amend");
        return rebaseRun(c);
      }
      var idx = G.readIndex(repo);
      if (keys(idx.conflicts).length) { keys(idx.conflicts).sort().forEach(function (k) { c.o.err(k + ": needs merge"); }); c.o.err("You must edit all merge conflicts and then\nmark them as resolved using git add"); return 1; }
      var stopped = (rb(repo, "stopped-sha") || "").trim();
      if (stopped) {
        var cmd = (rb(repo, "pending") || "pick").trim();
        var st = X.computeStatus(c);
        var flat = {}; keys(st.idx.entries).forEach(function (k) { flat[k] = st.idx.entries[k]; });
        var curTree = G.commitOf(c.sys, G.head(repo).sha).tree;
        if (G.writeTree(c.sys, flat) === curTree && cmd === "pick") c.o.line("(The commit was emptied by your conflict resolution: skipping it.)");
        else { var r = commitApplied(c, stopped, cmd, flat); if (r.sha) c.o.line("[detached HEAD " + short(r.sha) + "] " + subject(G.commitOf(c.sys, r.sha).message)); }
        G.gremove(repo, "rebase-merge/stopped-sha"); G.gremove(repo, "rebase-merge/pending");
        if (cmd === "edit" || cmd === "reword") { rbw(repo, "amend", G.head(repo).sha + "\n"); return 0; }
      }
      G.gremove(repo, "rebase-merge/amend");
      return rebaseRun(c);
    }
    if (inProgress) die(c, "fatal: It seems that there is already a rebase-merge directory, and\nI wonder if you are in the middle of another rebase.  If that is the\ncase, please try\n\tgit rebase (--continue | --abort | --skip)\nIf that is not the case, please\n\trm -fr \"" + G.gpath(repo, "rebase-merge") + "\"\nand run me again.  I am stopping in case you still have something\nvaluable there.");
    if (G.gexists(repo, "MERGE_HEAD")) die(c, "fatal: You have not concluded your merge (MERGE_HEAD exists).");
    var h = G.head(repo);
    if (a[1]) { var r2 = X.cmdSwitch(c, [a[1]]); if (r2) return r2; h = G.head(repo); }
    var upName = a[0], upstream;
    if (o.root) upstream = null;
    if (!upName) {
      var up = h.branch ? G.upstreamOf(repo, h.branch) : null;
      if (!up) die(c, "There is no tracking information for the current branch.\nPlease specify which branch you want to rebase against.\nSee git-rebase(1) for details.\n\n    git rebase '<branch>'\n\nIf you wish to set tracking information for this branch you can do so with:\n\n    git branch --set-upstream-to=<remote>/<branch> " + (h.branch || "<branch>") + "\n", 1);
      upName = up.replace(/^refs\/(remotes|heads)\//, "");
    }
    upstream = X.tryRev(c, upName);
    if (!upstream) die(c, "fatal: invalid upstream '" + upName + "'");
    upstream = G.peel(c.sys, upstream);
    var onto = o.onto ? G.peel(c.sys, X.rev(c, o.onto)) : upstream;
    if (o["keep-base"]) onto = G.mergeBases(c.sys, upstream, h.sha)[0];
    var autosq = o.autosquash || (G.configBool(G.configGet(c.sys, repo, c.uid, "rebase.autosquash"), false) && !o["no-autosquash"]);
    var res = rebaseStart(c, { upstream: upstream, onto: onto, upName: upName, interactive: !!o.interactive, autosquash: autosq && !!o.interactive });
    return res;
  }
  // git commit --amend during an "edit" stop keeps working; ORIG_HEAD etc. handled by commit itself.

  /* ================================================================== register git commands */
  CMDS.clone = { fn: cmdClone, repo: false };
  CMDS.remote = { fn: cmdRemote };
  CMDS.fetch = { fn: cmdFetch };
  CMDS.pull = { fn: cmdPull };
  CMDS.push = { fn: cmdPush };
  CMDS["ls-remote"] = { fn: cmdLsRemote, repo: false };
  CMDS.rebase = { fn: cmdRebase };
  ["clone", "fetch", "pull", "push", "remote", "rebase"].forEach(function (k) { delete X.LATER[k]; });

  /* ================================================================== pull requests, issues, reviews (server side) */
  function item(r, n) { return r.items.filter(function (x) { return x.n === +n; })[0] || null; }
  GH.item = item;
  function nextNum(r) { return r.items.reduce(function (m, x) { return Math.max(m, x.n); }, 0) + 1; }
  GH.issue = function (sys, full, o) {
    var r = GH.find(sys, full), n = o.n || nextNum(r);
    var it = { n: n, type: "issue", title: o.title, body: o.body || "", author: o.author || "maya-chen", state: o.state || "open", labels: o.labels || [], assignees: o.assignees || [], comments: [], created: o.created || now(sys) - 86400 * (o.daysAgo || 3), closedBy: null, reason: null };
    r.items.push(it);
    return it;
  };
  GH.openPR = function (sys, full, o) {
    var r = GH.find(sys, full), n = nextNum(r);
    var pr = { n: n, type: "pr", title: o.title, body: o.body || "", author: o.author, state: "open", draft: !!o.draft, labels: o.labels || [], assignees: o.assignees || [], comments: [], reviews: [], reviewers: o.reviewers || [], created: now(sys),
      base: o.base || r.default, head: o.head, headRepo: o.headRepo || full, mergedSha: null, mergedBy: null, method: null, checks: {}, autoMerge: null };
    r.items.push(pr);
    GH.emit(sys, "pr.opened", { repo: r, pr: pr });
    return pr;
  };
  GH.review = function (sys, full, n, by, state, body) { var r = GH.find(sys, full), pr = item(r, n); pr.reviews.push({ by: by, state: state, body: body || "", at: now(sys), commit: prHeadSha(sys, r, pr) }); pr.reviewers = pr.reviewers.filter(function (x) { return x !== by; }); GH.emit(sys, "pr.reviewed", { repo: r, pr: pr, by: by, state: state }); };
  GH.comment = function (sys, full, n, by, body) { var r = GH.find(sys, full), it = item(r, n); it.comments.push({ by: by, body: body, at: now(sys) }); };
  function prHeadSha(sys, r, pr) { var hr = GH.find(sys, pr.headRepo) || r; return hr.refs["refs/heads/" + pr.head] || pr.lastHead || null; }
  GH.prHeadSha = prHeadSha;
  // Latest review state per reviewer (only reviews on the current head count when stale reviews are dismissed)
  function latestReviews(sys, r, pr) {
    var prot = protectionFor(r, pr.base), head = prHeadSha(sys, r, pr), by = {};
    pr.reviews.forEach(function (rv) { if (rv.state === "COMMENTED") return; if (prot && prot.pr && prot.pr.dismissStale && rv.state === "APPROVED" && rv.commit !== head) return; by[rv.by] = rv.state; });
    return by;
  }
  GH.latestReviews = latestReviews;
  function codeownersOf(sys, r, ref) {
    var sha = r.refs["refs/heads/" + ref]; if (!sha) return [];
    var flat = G.commitFlat(sys, sha), f = flat[".github/CODEOWNERS"] || flat["CODEOWNERS"] || flat["docs/CODEOWNERS"];
    if (!f) return [];
    return G.blobText(sys, f.sha).split("\n").map(function (l) { return l.replace(/#.*/, "").trim(); }).filter(Boolean).map(function (l) { var p = l.split(/\s+/); return { pat: p[0], owners: p.slice(1) }; });
  }
  GH.codeowners = codeownersOf;
  function ownerMatch(pat, path) {
    var re;
    if (pat === "*") return true;
    var anchored = pat.charAt(0) === "/", p = pat.replace(/^\//, "");
    if (/\/$/.test(p)) { p = p.slice(0, -1); return anchored ? path === p || path.indexOf(p + "/") === 0 : (path === p || path.indexOf(p + "/") === 0 || path.indexOf("/" + p + "/") >= 0); }
    re = new RegExp((anchored || p.indexOf("/") >= 0 ? "^" : "(^|/)") + G.globToRe(p).source.replace(/^\^/, "").replace(/\$$/, "") + "(/|$)");
    return re.test(path);
  }
  function prFiles(sys, r, pr) {
    var head = prHeadSha(sys, r, pr), base = pr.state === "merged" && pr.baseSha ? pr.baseSha : r.refs["refs/heads/" + pr.base];
    var mb = G.mergeBases(sys, base, head)[0], a = G.commitFlat(sys, mb), b = G.commitFlat(sys, head), out = [];
    keys(a).concat(keys(b)).forEach(function (k) { if (out.indexOf(k) >= 0) return; if (!a[k] || !b[k] || a[k].sha !== b[k].sha) out.push(k); });
    return out.sort();
  }
  GH.prFiles = prFiles;
  function requiredOwners(sys, r, pr) {
    var rules = codeownersOf(sys, r, pr.base), need = [];
    prFiles(sys, r, pr).forEach(function (f) { var own = null; rules.forEach(function (ru) { if (ownerMatch(ru.pat, f)) own = ru.owners; }); if (own && own.length) { var key = own.join(" "); if (!need.some(function (x) { return x.join(" ") === key; })) need.push(own); } });
    return need;
  }
  GH.requiredOwners = requiredOwners;
  function isOwner(sys, r, login, owners) { return owners.some(function (o) { var t = o.replace(/^@/, ""); if (t.indexOf("/") > 0) { var p = t.split("/"); return GH.team(sys, p[0], p[1]).indexOf(login) >= 0; } return t === login; }); }
  // Why can't this PR be merged right now? [] = mergeable
  GH.blockers = function (sys, r, pr) {
    var out = [], prot = protectionFor(r, pr.base), head = prHeadSha(sys, r, pr), base = r.refs["refs/heads/" + pr.base];
    if (pr.state !== "open") return ["Pull request is " + (pr.state === "merged" ? "already merged" : "closed")];
    if (pr.draft) out.push("Pull request is still a draft");
    if (!head) return ["The head branch was deleted"];
    var mb = G.mergeBases(sys, base, head)[0];
    var mr = G.mergeTrees(sys, G.commitFlat(sys, mb), G.commitFlat(sys, base), G.commitFlat(sys, head), ["base", "head"]);
    if (keys(mr.conflicts).length) out.push("This branch has conflicts that must be resolved");
    if (prot && prot.pr) {
      var lr = latestReviews(sys, r, pr), approvals = keys(lr).filter(function (k) { return lr[k] === "APPROVED" && can(sys, r, k, "write") && k !== pr.author; });
      if (keys(lr).some(function (k) { return lr[k] === "CHANGES_REQUESTED"; })) out.push("Changes requested");
      if (approvals.length < (prot.pr.count || 1)) out.push("At least " + (prot.pr.count || 1) + " approving review" + ((prot.pr.count || 1) > 1 ? "s are" : " is") + " required by reviewers with write access.");
      if (prot.pr.codeowners) requiredOwners(sys, r, pr).forEach(function (own) { if (!approvals.some(function (a) { return isOwner(sys, r, a, own); })) out.push("Waiting on code owner review from " + own.join(", ") + "."); });
    }
    if (prot && prot.checks && prot.checks.contexts) {
      prot.checks.contexts.forEach(function (ctx) { var st = GH.checkState ? GH.checkState(sys, r, head, ctx) : null; if (st !== "success") out.push(st ? "Required status check \"" + ctx + "\" " + (st === "failure" ? "failed" : "is " + st) + "." : "Required status check \"" + ctx + "\" is expected."); });
      if (prot.checks.strict && !G.isAncestor(sys, base, head)) out.push("This branch is out-of-date with the base branch");
    }
    if (prot && prot.signatures && !GH.newCommits(sys, base, head).every(function (s) { return GH.verified(sys, s); })) out.push("Commits must have verified signatures.");
    if (prot && prot.linear && GH.newCommits(sys, base, head).some(function (s) { return G.commitOf(sys, s).parents.length > 1; })) out.push("Merge commits are not allowed on this branch");
    return out;
  };
  var GHBOT = { name: "GitHub", email: "noreply@github.com" };
  GH.mergePR = function (sys, r, pr, how, login, o) {
    o = o || {};
    var head = prHeadSha(sys, r, pr), baseRef = "refs/heads/" + pr.base, base = r.refs[baseRef];
    var u = hub(sys).users[login] || { name: login, email: login + "@users.noreply.github.com" };
    var t = now(sys), who = { name: u.name, email: u.email, time: t, tz: "+0000" }, committer = { name: GHBOT.name, email: GHBOT.email, time: t, tz: "+0000" };
    var mb = G.mergeBases(sys, base, head)[0];
    var commits = X.walk({ sys: sys, repo: null }, [head], [base], { topo: true }).reverse();
    var newTip;
    if (how === "merge") {
      var mr = G.mergeTrees(sys, G.commitFlat(sys, mb), G.commitFlat(sys, base), G.commitFlat(sys, head), ["base", "head"]);
      newTip = G.putObject(sys, { type: "commit", tree: G.writeTree(sys, mr.entries), parents: [base, head], author: who, committer: committer, message: (o.subject || "Merge pull request #" + pr.n + " from " + pr.headRepo.split("/")[0] + "/" + pr.head) + "\n\n" + (o.body !== undefined ? o.body : pr.title) + "\n" });
    } else if (how === "squash") {
      var mr2 = G.mergeTrees(sys, G.commitFlat(sys, mb), G.commitFlat(sys, base), G.commitFlat(sys, head), ["base", "head"]);
      var bodyText = o.body !== undefined ? o.body : commits.map(function (s) { return "* " + subject(G.commitOf(sys, s).message); }).join("\n\n");
      var aut = G.commitOf(sys, commits[0] || head).author;
      newTip = G.putObject(sys, { type: "commit", tree: G.writeTree(sys, mr2.entries), parents: [base], author: { name: aut.name, email: aut.email, time: t, tz: "+0000" }, committer: committer, message: (o.subject || pr.title + " (#" + pr.n + ")") + (bodyText ? "\n\n" + bodyText : "") + "\n" });
    } else {
      newTip = base;
      commits.forEach(function (s) {
        var co = G.commitOf(sys, s), pf = co.parents[0] ? G.commitFlat(sys, co.parents[0]) : {};
        var mr3 = G.mergeTrees(sys, pf, G.commitFlat(sys, newTip), G.commitFlat(sys, s), ["base", "head"]);
        newTip = G.putObject(sys, { type: "commit", tree: G.writeTree(sys, mr3.entries), parents: [newTip], author: co.author, committer: committer, message: co.message });
      });
    }
    r.refs[baseRef] = newTip;
    pr.state = "merged"; pr.mergedSha = newTip; pr.baseSha = base; pr.mergedBy = login; pr.method = how; pr.mergedAt = t; pr.lastHead = head;
    GH.emit(sys, "push", { repo: r, ref: baseRef, before: base, after: newTip, pusher: login, viaPR: pr });
    GH.emit(sys, "pr.merged", { repo: r, pr: pr });
    if (pr.base === r.default) closeLinked(sys, r, (pr.body || "") + "\n" + pr.title + "\n" + commits.map(function (s) { return G.commitOf(sys, s).message; }).join("\n"), login, pr);
    return newTip;
  };
  function closeLinked(sys, r, text, login, pr) {
    var re = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s*:?\s+#(\d+)/gi, m;
    while ((m = re.exec(text))) { var it = item(r, m[1]); if (it && it.type === "issue" && it.state === "open") { it.state = "closed"; it.reason = "completed"; it.closedBy = pr ? "#" + pr.n : login; it.closedAt = now(sys); } }
  }
  GH.closeLinked = closeLinked;
  // Pushes to the default branch close issues named in commit messages ("Fixes #12").
  function globalHooks(sys) {
    var h = hubOrig(sys);
    if (h._globals) return;
    h._globals = true;
    h.hooks.unshift({ event: "push", fn: function (sys2, d) { if (!d.viaPR && d.after && d.ref === "refs/heads/" + d.repo.default && d.before !== undefined) closeLinked(sys2, d.repo, GH.newCommits(sys2, d.before, d.after).map(function (s) { return G.commitOf(sys2, s).message; }).join("\n"), d.pusher, null); } });
    h.hooks.unshift({ event: "push", fn: function (sys2, d) { if (!d.after) return; d.repo.items.forEach(function (pr) { if (pr.type === "pr" && pr.state === "open" && (GH.find(sys2, pr.headRepo) === d.repo) && d.ref === "refs/heads/" + pr.head) GH.emit(sys2, "pr.synchronize", { repo: d.repo, pr: pr, before: d.before, after: d.after }); }); } });
  }
  var hubOrig = hub;
  hub = function (sys) { var h = hubOrig(sys); if (!h._globals) globalHooks(sys); return h; };
  GH.hub = hub;

  /* ================================================================== gh CLI */
  function ago(sys, t) {
    var d = Math.max(0, now(sys) - t);
    if (d < 90) return "about 1 minute ago"; if (d < 3600) return "about " + Math.round(d / 60) + " minutes ago"; if (d < 5400) return "about 1 hour ago"; if (d < 86400) return "about " + Math.round(d / 3600) + " hours ago"; if (d < 172800) return "about 1 day ago"; return "about " + Math.round(d / 86400) + " days ago";
  }
  GH.ago = ago;
  function ghOut(io) { return { line: function (t) { io.out(t + "\n"); }, err: function (t) { io.err(t + "\n"); } }; }
  function ghCtx(sess, io) {
    var repo = G.findRepo(sess.sys, sess.cwd);
    return { sys: sess.sys, sess: sess, io: io, o: X.mkOut ? X.mkOut(io) : GC.mkOut(io), cwd: sess.cwd, repo: repo, uid: sess.uid, cfgExtra: [] };
  }
  function ghLogin(c) {
    var t = ghToken(c.sess);
    if (!t) return null;
    var ti = tokenInfo(c.sys, t);
    return ti ? ti.login : null;
  }
  function needAuth(c) {
    var t = ghToken(c.sess);
    if (!t) { c.o.err("To get started with GitHub CLI, please run:  gh auth login\nAlternatively, populate the GH_TOKEN environment variable with a GitHub API authentication token."); return null; }
    var l = ghLogin(c);
    if (!l) { c.o.err("HTTP 401: Bad credentials (https://api.github.com/graphql)\nTry authenticating with:  gh auth login"); return null; }
    return l;
  }
  // The repository gh works with: -R/--repo, else the local repo's remotes (gh-resolved=base, then upstream, github, origin).
  function ghRepo(c, explicit) {
    if (explicit) { var r0 = GH.find(c.sys, explicit); if (!r0) { c.o.err("GraphQL: Could not resolve to a Repository with the name '" + explicit + "'. (repository)"); return null; } return r0; }
    if (!c.repo) { c.o.err("failed to run git: fatal: not a git repository (or any of the parent directories): .git"); return null; }
    var names = remoteNames(c), pick = null;
    names.forEach(function (n) { if (G.configGet(c.sys, c.repo, c.uid, "remote." + n + ".gh-resolved") === "base") pick = n; });
    if (!pick) pick = ["upstream", "github", "origin"].filter(function (n) { return names.indexOf(n) >= 0; })[0] || names[0];
    if (!pick) { c.o.err("no git remotes found"); return null; }
    var p = parseUrl(remoteUrl(c, pick));
    if (!p) { c.o.err("none of the git remotes configured for this repository point to a known GitHub host. To tell gh about a new GitHub host, please use `gh auth login`"); return null; }
    var r = GH.find(c.sys, p.full);
    if (!r) { c.o.err("GraphQL: Could not resolve to a Repository with the name '" + p.full + "'. (repository)"); return null; }
    return r;
  }
  GH.ghRepo = ghRepo;
  function flags(args, spec) {
    var o = { _: [] }, i;
    for (i = 0; i < args.length; i++) {
      var a = args[i];
      if (a === "--") { o._ = o._.concat(args.slice(i + 1)); break; }
      var m = /^--([\w-]+)(?:=([\s\S]*))?$/.exec(a), sm = /^-(\w)$/.exec(a);
      var name = m ? m[1] : sm ? (spec.short && spec.short[sm[1]]) || sm[1] : null;
      if (name === null) { o._.push(a); continue; }
      if ((spec.vals || []).indexOf(name) >= 0) { var v = m && m[2] !== undefined ? m[2] : args[++i]; if ((spec.multi || []).indexOf(name) >= 0) (o[name] = o[name] || []).push(v); else o[name] = v; }
      else o[name] = m && m[2] !== undefined ? m[2] : true;
    }
    return o;
  }
  function splitList(v) { return [].concat(v || []).join(",").split(",").map(function (x) { return x.trim(); }).filter(Boolean); }
  function prRef(c, r, arg) {
    if (arg === undefined) {
      var h = c.repo ? G.head(c.repo) : null, br = h && h.branch;
      if (!br) { c.o.err("could not determine the current branch: failed to run git: not on any branch"); return null; }
      var hit = r.items.filter(function (x) { return x.type === "pr" && x.state === "open" && x.head === br; })[0] || r.items.filter(function (x) { return x.type === "pr" && x.head === br; }).slice(-1)[0];
      if (!hit) { c.o.err("no pull requests found for branch \"" + br + "\""); return null; }
      return hit;
    }
    var m = /(\d+)$/.exec(String(arg)), it = m ? item(r, m[1]) : r.items.filter(function (x) { return x.type === "pr" && x.head === arg; }).slice(-1)[0];
    if (!it || it.type !== "pr") { c.o.err("GraphQL: Could not resolve to a PullRequest with the number of " + arg + ". (repository.pullRequest)"); return null; }
    return it;
  }
  function stat(sys, r, pr) {
    var head = prHeadSha(sys, r, pr), base = pr.state === "merged" && pr.baseSha ? pr.baseSha : r.refs["refs/heads/" + pr.base] || pr.baseSha;
    if (!head || !base) return { add: 0, del: 0, commits: 0 };
    var mb = G.mergeBases(sys, base, head)[0], a = G.commitFlat(sys, mb), b = G.commitFlat(sys, head), add = 0, del = 0;
    keys(a).concat(keys(b)).forEach(function (k, i, arr) { if (arr.indexOf(k) !== i) return; if (a[k] && b[k] && a[k].sha === b[k].sha) return; var cc = G.countChanges(a[k] ? G.blobText(sys, a[k].sha) : "", b[k] ? G.blobText(sys, b[k].sha) : ""); add += cc.add; del += cc.del; });
    return { add: add, del: del, commits: GH.newCommits(sys, base, head).length };
  }
  function reviewWord(s) { return { APPROVED: "Approved", CHANGES_REQUESTED: "Changes requested", COMMENTED: "Commented" }[s] || s; }
  function cmdGh(args, io, sess) {
    var c = ghCtx(sess, io), a = args.slice(1), sub = a[0];
    if (!sub || sub === "--help" || sub === "help") { io.out("Work seamlessly with GitHub from the command line.\n\nUSAGE\n  gh <command> <subcommand> [flags]\n\nCORE COMMANDS\n  auth:          Authenticate gh and git with GitHub\n  browse:        Open repositories, issues, pull requests, and more in the browser\n  issue:         Manage issues\n  pr:            Manage pull requests\n  release:       Manage releases\n  repo:          Manage repositories\n\nGITHUB ACTIONS COMMANDS\n  run:           View details about workflow runs\n  workflow:      View details about GitHub Actions workflows\n\nADDITIONAL COMMANDS\n  api:           Make an authenticated GitHub API request\n  label:         Manage labels\n  secret:        Manage GitHub secrets\n  ssh-key:       Manage SSH keys\n  variable:      Manage GitHub Actions variables\n"); return 0; }
    if (sub === "--version" || sub === "version") { io.out("gh version 2.45.0 (2024-03-04)\nhttps://github.com/cli/cli/releases/tag/v2.45.0\n"); return 0; }
    var h = GH.ghCommands[sub];
    if (!h) { io.err("unknown command \"" + sub + "\" for \"gh\"\n\nUsage:  gh <command> <subcommand> [flags]\n\nAvailable commands:\n  " + keys(GH.ghCommands).sort().join("\n  ") + "\n"); return 1; }
    try { return h(c, a.slice(1)) || 0; }
    catch (e) { if (e instanceof X.Exit) return e.code; throw e; }
  }
  GH.ghCommands = {};
  var GHC = GH.ghCommands;
  GHC.auth = function (c, a) {
    var sub = a[0], f = flags(a.slice(1), { vals: ["hostname", "git-protocol", "scopes", "s", "h", "p"], short: { h: "hostname", p: "git-protocol", s: "scopes" } });
    if (sub === "login") {
      if (!f["with-token"]) { c.o.err("(gh auth login normally walks you through a browser login. In this lab, log in with a token: gh auth login --with-token < FILE)"); return 1; }
      var t = String(c.io.stdin || "").trim();
      if (!t) { c.o.err("no token provided on standard input"); return 1; }
      var ti = tokenInfo(c.sys, t);
      if (!ti) { c.o.err("error validating token: HTTP 401: Bad credentials (https://api.github.com/)\nTry authenticating with:  gh auth login"); return 1; }
      if (ti.scopes.indexOf("repo") < 0 && !ti.fine) { c.o.err("error validating token: missing required scope 'repo'"); return 1; }
      if (ti.scopes.indexOf("read:org") < 0 && !ti.fine) { c.o.err("error validating token: missing required scope 'read:org'"); return 1; }
      GH.login(c.sys, ti.login, t, { protocol: f["git-protocol"] || "https", home: c.sess.home });
      return 0;
    }
    if (sub === "status") {
      var t2 = ghToken(c.sess);
      if (!t2) { c.o.err("You are not logged into any GitHub hosts. To log in, run: gh auth login"); return 1; }
      var ti2 = tokenInfo(c.sys, t2);
      if (!ti2) { c.o.line("github.com\n  X Failed to log in to github.com using token (" + (envToken(c.sess) ? "GH_TOKEN" : "keyring") + ")\n  - Active account: true\n  - The token in " + (envToken(c.sess) ? "GH_TOKEN" : "keyring") + " is invalid.\n  - To re-authenticate, run: gh auth login -h github.com\n  - To forget about this account, run: gh auth logout -h github.com -u " + ((c.sys.ghAuth || {}).login || "?")); return 1; }
      c.o.line("github.com\n  ✓ Logged in to github.com account " + ti2.login + " (" + (envToken(c.sess) ? "GH_TOKEN" : "keyring") + ")\n  - Active account: true\n  - Git operations protocol: " + ((c.sys.ghAuth || {}).protocol || "https") + "\n  - Token: " + t2.slice(0, 4) + new Array(t2.length - 3).join("*") + (ti2.fine ? "" : "\n  - Token scopes: " + ti2.scopes.map(function (s) { return "'" + s + "'"; }).join(", ")));
      return 0;
    }
    if (sub === "logout") { if (!c.sys.ghAuth) { c.o.err("not logged in to any hosts"); return 1; } var l = c.sys.ghAuth.login; c.sys.ghAuth = null; G.removePath(c.sys, c.sess.home + "/.config/gh/hosts.yml"); c.o.line("✓ Logged out of github.com account " + l); return 0; }
    if (sub === "token") { var t3 = ghToken(c.sess); if (!t3) { c.o.err("no oauth token found for github.com"); return 1; } c.o.line(t3); return 0; }
    if (sub === "setup-git") { if (!ghToken(c.sess)) { c.o.err("You are not logged into any GitHub hosts. To log in, run: gh auth login"); return 1; } setupGitCreds(c.sys, c.sess.home); return 0; }
    if (sub === "git-credential") { if (a[1] === "get") { var t4 = ghToken(c.sess); if (t4) c.o.line("protocol=https\nhost=github.com\nusername=" + (ghLogin(c) || "x-access-token") + "\npassword=" + t4); } return 0; }
    if (sub === "refresh") { c.o.err("(gh auth refresh adds scopes through a browser login. Here, ask for a new token with the scopes you need.)"); return 1; }
    c.o.err("Usage:  gh auth <command> [flags]\n\nAvailable commands:\n  login\n  logout\n  refresh\n  setup-git\n  status\n  token"); return 1;
  };
  GHC["ssh-key"] = function (c, a) {
    var login = needAuth(c); if (!login) return 4;
    var u = hub(c.sys).users[login], sub = a[0], f = flags(a.slice(1), { vals: ["title", "type", "t"], short: { t: "title" } });
    if (sub === "add") {
      var file = f._[0]; if (!file) { c.o.err("public key file missing"); return 1; }
      var rd = S.readFile(c.sess, file); if (rd.error) { c.o.err("failed to read file " + file + ": " + S.ERRTEXT[rd.error]); return 1; }
      var m = /^(ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp256)\s+(\S+)/.exec(rd.content.trim());
      if (!m) { c.o.err("HTTP 422: Validation Failed (https://api.github.com/user/keys)\nkey is invalid. You must supply a key in OpenSSH public key format"); return 1; }
      if (/PRIVATE KEY/.test(rd.content)) { c.o.err("HTTP 422: Validation Failed (https://api.github.com/user/keys)\nkey is invalid. You must supply a key in OpenSSH public key format"); return 1; }
      var list = f.type === "signing" ? u.signing : u.keys;
      if (list.some(function (k) { return k.blob === m[2]; })) { c.o.err("✓ Public key already exists on your account"); return 0; }
      list.push({ title: f.title || (rd.content.trim().split(/\s+/)[2] || ""), blob: m[2], type: m[1], added: now(c.sys) });
      GH.audit(c.sys, login, f.type === "signing" ? "ssh_signing_key.create" : "public_key.create", { title: f.title || "" });
      c.o.line("✓ Public key added to your account");
      return 0;
    }
    if (sub === "list") { u.keys.map(function (k) { return [k.title, k.type + " " + k.blob.slice(0, 20) + "...", "authentication"]; }).concat(u.signing.map(function (k) { return [k.title, k.type + " " + k.blob.slice(0, 20) + "...", "signing"]; })).forEach(function (row) { c.o.line(X.pad(row[0], 18) + " " + X.pad(row[1], 40) + " " + row[2]); }); return 0; }
    if (sub === "delete") { var id = f._[0]; var before = u.keys.length; u.keys = u.keys.filter(function (k) { return k.title !== id; }); c.o.line(u.keys.length < before ? "✓ SSH key \"" + id + "\" deleted from your account" : "key " + id + " not found"); return u.keys.length < before ? 0 : 1; }
    c.o.err("Usage:  gh ssh-key <command> [flags]\n\nAvailable commands:\n  add\n  delete\n  list"); return 1;
  };
  GHC.browse = function (c) { c.o.err("(gh browse would open the page in your web browser. This lab has no browser: use gh repo view, gh pr view, gh issue view.)"); return 0; };
  GHC.repo = function (c, a) {
    var sub = a[0], f = flags(a.slice(1), { vals: ["description", "d", "source", "s", "remote", "r", "fork-name", "remote-name", "visibility", "branch", "b", "json", "jq", "q", "default-branch", "template"], short: { d: "description", s: "source", r: "remote", b: "branch", q: "jq" } });
    if (sub === "view") {
      var r = ghRepo(c, f._[0]); if (!r) return 1;
      if (!needAuth(c) && r.private) return 4;
      var readme = (function () { var sha = r.refs["refs/heads/" + r.default]; var fl = sha ? G.commitFlat(c.sys, sha) : {}; var k = keys(fl).filter(function (x) { return /^readme(\.md)?$/i.test(x); })[0]; return k ? G.blobText(c.sys, fl[k].sha) : null; })();
      c.o.line(r.full + "\n" + (r.description || "No description provided") + "\n\n" + (readme ? readme.replace(/^/gm, "  ").replace(/\s+$/, "") : "This repository does not have a README") + "\n\n\nView this repository on GitHub: https://github.com/" + r.full);
      return 0;
    }
    var login = needAuth(c); if (!login) return 4;
    if (sub === "list") {
      var owner = f._[0] || login, list = keys(hub(c.sys).repos).map(function (k) { return hub(c.sys).repos[k]; }).filter(function (r2) { return r2.owner === owner && can(c.sys, r2, login, "read"); });
      c.o.line("\nShowing " + list.length + " of " + list.length + " repositories in @" + owner + "\n");
      list.forEach(function (r2) { c.o.line(X.pad(r2.full, 28) + " " + X.pad(r2.description || "", 34) + " " + (r2.private ? "private" : "public") + (r2.forkOf ? ", fork" : "")); });
      return 0;
    }
    if (sub === "create") {
      var name = f._[0]; if (!name) { c.o.err("(gh repo create walks you through questions. Here, give a name and flags: gh repo create NAME --private --source=. --remote=origin --push)"); return 1; }
      var full = name.indexOf("/") > 0 ? name : login + "/" + name, owner2 = full.split("/")[0];
      if (owner2 !== login && !(hub(c.sys).orgs[owner2] && hub(c.sys).orgs[owner2].members[login])) { c.o.err("GraphQL: " + login + " cannot create a repository for " + owner2 + ". (createRepository)"); return 1; }
      if (GH.find(c.sys, full)) { c.o.err("GraphQL: Name already exists on this account (createRepository)"); return 1; }
      if (!f.private && !f.public && !f.internal) { c.o.err("--public, --private, or --internal required when not running interactively"); return 1; }
      var nr = GH.createRepo(c.sys, full, { private: !f.public, description: f.description || "" });
      if (owner2 !== login) nr.collab[login] = "admin";
      GH.audit(c.sys, login, "repo.create", { repo: full, visibility: f.public ? "public" : "private" });
      c.o.line("✓ Created repository " + full + " on GitHub\n  https://github.com/" + full);
      var proto = (c.sys.ghAuth || {}).protocol || "https", url = proto === "ssh" ? "git@github.com:" + full + ".git" : "https://github.com/" + full + ".git";
      if (f.source) {
        var dir = S.normAbs(f.source.charAt(0) === "/" ? f.source : c.cwd + "/" + f.source), lr = G.findRepo(c.sys, dir);
        if (!lr) { c.o.err("current directory is not a git repository. Run `git init` to initialize it"); return 1; }
        var c2 = Object.assign({}, c, { repo: lr, cwd: dir }), rname = f.remote || "origin";
        if (remoteNames(c2).indexOf(rname) >= 0) { c.o.err("Unable to add remote \"" + rname + "\""); return 1; }
        addFetchSpec(c.sys, lr, rname, url);
        c.o.line("✓ Added remote " + url);
        if (f.push) { var rc = cmdPush(c2, ["--set-upstream", rname, "HEAD"]); if (rc) return rc; c.o.line("✓ Pushed commits to " + url); }
      } else if (f.clone) { var c3 = Object.assign({}, c, { repo: null }); return cmdClone(c3, [url]); }
      return 0;
    }
    if (sub === "clone") {
      var target = f._[0]; if (!target) { c.o.err("cannot clone: repository argument required"); return 1; }
      var full2 = target.indexOf("/") > 0 ? target.replace(/^https:\/\/github\.com\//, "").replace(/\.git$/, "") : login + "/" + target;
      var proto2 = (c.sys.ghAuth || {}).protocol || "https", url2 = proto2 === "ssh" ? "git@github.com:" + full2 + ".git" : "https://github.com/" + full2 + ".git";
      var r3 = GH.find(c.sys, full2);
      var rc2 = cmdClone(Object.assign({}, c, { repo: null }), [url2].concat(f._.slice(1)));
      if (rc2) return rc2;
      if (r3 && r3.forkOf) {
        var dest = S.normAbs(c.cwd + "/" + (f._[1] || full2.split("/")[1])), fr = G.findRepo(c.sys, dest), c4 = Object.assign({}, c, { repo: fr, cwd: dest });
        addFetchSpec(c.sys, fr, "upstream", proto2 === "ssh" ? "git@github.com:" + r3.forkOf + ".git" : "https://github.com/" + r3.forkOf + ".git");
        var out = []; fetchOne(c4, "upstream", { q: false }, out); out.forEach(function (l) { c.o.line(l); });
        c.o.line("! Repository " + r3.forkOf + " set as the default repository. To learn more or change the selection, see: gh repo set-default");
        writeConfig(c.sys, fr, [["remote.upstream.gh-resolved", "base"]]);
      }
      return 0;
    }
    if (sub === "fork") {
      var src = f._[0] ? GH.find(c.sys, f._[0]) : ghRepo(c); if (!src) { if (f._[0]) c.o.err("GraphQL: Could not resolve to a Repository with the name '" + f._[0] + "'. (repository)"); return 1; }
      if (!can(c.sys, src, login, "read")) { c.o.err("GraphQL: Could not resolve to a Repository with the name '" + src.full + "'. (repository)"); return 1; }
      var fname = login + "/" + (f["fork-name"] || src.name), fork = GH.find(c.sys, fname);
      if (fork) c.o.line("! " + fname + " already exists");
      else { fork = GH.createRepo(c.sys, fname, { private: src.private, description: src.description, forkOf: src.full, default: src.default }); keys(src.refs).forEach(function (k) { fork.refs[k] = src.refs[k]; }); c.o.line("✓ Created fork " + fname); GH.audit(c.sys, login, "repo.create", { repo: fname, fork: src.full }); }
      var proto3 = (c.sys.ghAuth || {}).protocol || "https", furl = proto3 === "ssh" ? "git@github.com:" + fname + ".git" : "https://github.com/" + fname + ".git";
      if (f.clone) { var rc3 = GHC.repo(c, ["clone", fname]); if (rc3) return rc3; c.o.line("✓ Cloned fork"); }
      else if (c.repo && (f.remote === true || f.remote === "true")) {
        var rn = f["remote-name"] || "origin";
        if (remoteNames(c).indexOf(rn) >= 0) { var t5 = G.gread(c.repo, "config").split("[remote \"" + rn + "\"]").join("[remote \"upstream\"]").split("refs/remotes/" + rn + "/").join("refs/remotes/upstream/"); G.gwrite(c.repo, "config", t5); G.listRefs(c.repo, "refs/remotes/" + rn + "/").forEach(function (x) { G.gwrite(c.repo, "refs/remotes/upstream/" + x.name.split("/").slice(3).join("/"), x.sha + "\n"); G.updateRef(c.repo, x.name, null); }); c.o.line("✓ Renamed remote " + rn + " to upstream"); }
        addFetchSpec(c.sys, c.repo, rn, furl); c.o.line("✓ Added remote " + rn);
      }
      return 0;
    }
    if (sub === "sync") {
      var tgt = f._[0];
      if (tgt) {
        var fk = GH.find(c.sys, tgt); if (!fk || !fk.forkOf) { c.o.err("can't determine source repository for " + tgt + " because repository is not fork"); return 1; }
        if (!can(c.sys, fk, login, "write")) { c.o.err("HTTP 403: Must have admin rights to Repository."); return 1; }
        var up = GH.find(c.sys, fk.forkOf), b = f.branch || fk.default, us = up.refs["refs/heads/" + b], fs = fk.refs["refs/heads/" + b];
        if (fs && !G.isAncestor(c.sys, fs, us) && !f.force) { c.o.err("can't sync because there are diverging changes; you can use `--force` to overwrite the destination branch"); return 1; }
        fk.refs["refs/heads/" + b] = us;
        c.o.line("✓ Synced the \"" + fk.owner + ":" + b + "\" branch from \"" + up.owner + ":" + b + "\"");
        return 0;
      }
      if (!c.repo) { c.o.err("failed to run git: fatal: not a git repository"); return 1; }
      var hh = G.head(c.repo), br = f.branch || hh.branch, rem = defaultRemote(c), out2 = [];
      var rcx = fetchOne(c, rem, { q: true }, out2); if (rcx) return rcx;
      var rs = G.resolveRefName(c.repo, "refs/remotes/" + rem + "/" + br).sha, ls = G.resolveRefName(c.repo, "refs/heads/" + br).sha;
      if (ls && !G.isAncestor(c.sys, ls, rs)) { c.o.err("can't sync because there are diverging changes; you can use `--force` to overwrite the destination branch"); return 1; }
      if (br === hh.branch) X.moveTree(c, G.commitFlat(c.sys, rs), {});
      G.updateRef(c.repo, "refs/heads/" + br, rs, "pull: Fast-forward", X.softIdent(c));
      c.o.line("✓ Synced the \"" + br + "\" branch from \"" + rem + "/" + br + "\" to local repository");
      return 0;
    }
    if (sub === "set-default") {
      if (!c.repo) { c.o.err("must be run from inside a git repository"); return 1; }
      var want = f._[0]; if (!want) { c.o.err("(gh repo set-default asks which remote's repository to use. Here, name it: gh repo set-default OWNER/REPO)"); return 1; }
      var hitR = null; remoteNames(c).forEach(function (n) { var pu = parseUrl(remoteUrl(c, n)); if (pu && pu.full.toLowerCase() === want.toLowerCase()) hitR = n; });
      if (!hitR) { c.o.err("Unable to find a remote for " + want); return 1; }
      remoteNames(c).forEach(function (n) { var tt = G.gread(c.repo, "config"); G.gwrite(c.repo, "config", tt.replace(new RegExp("(\\[remote \"" + n + "\"\\][^\\[]*?)\\n\\tgh-resolved = [^\\n]*", ""), "$1")); });
      writeConfig(c.sys, c.repo, [["remote." + hitR + ".gh-resolved", "base"]]);
      c.o.line("✓ Set " + want + " as the default repository for the current directory");
      return 0;
    }
    if (sub === "edit") {
      var r4 = ghRepo(c, f._[0]); if (!r4) return 1;
      if (!can(c.sys, r4, login, "admin")) { c.o.err("HTTP 403: Must have admin rights to Repository. (https://api.github.com/repos/" + r4.full + ")"); return 1; }
      var map = { "delete-branch-on-merge": "deleteBranchOnMerge", "enable-merge-commit": "mergeCommit", "enable-squash-merge": "squash", "enable-rebase-merge": "rebase", "enable-issues": "issues", "enable-secret-scanning": "secretScanning", "enable-secret-scanning-push-protection": "pushProtection", "enable-auto-merge": "autoMerge" };
      keys(map).forEach(function (k) { if (f[k] !== undefined) { r4.settings[map[k]] = f[k] !== "false"; GH.audit(c.sys, login, "repo.update", { repo: r4.full, setting: k, value: f[k] !== "false" }); } });
      if (f.visibility) { r4.private = f.visibility !== "public"; }
      if (f.description !== undefined) r4.description = f.description;
      if (f["default-branch"]) r4.default = f["default-branch"];
      c.o.line("✓ Edited repository " + r4.full);
      return 0;
    }
    c.o.err("Usage:  gh repo <command> [flags]\n\nAvailable commands:\n  clone\n  create\n  edit\n  fork\n  list\n  set-default\n  sync\n  view"); return 1;
  };
  GHC.label = function (c, a) {
    var login = needAuth(c); if (!login) return 4;
    var f = flags(a.slice(1), { vals: ["color", "c", "description", "d", "R", "repo"], short: { c: "color", d: "description", R: "repo" } }), r = ghRepo(c, f.repo); if (!r) return 1;
    if (a[0] === "list") { c.o.line("\nShowing " + r.labels.length + " of " + r.labels.length + " labels in " + r.full + "\n"); r.labels.forEach(function (l) { c.o.line(X.pad(l.name, 18) + " " + X.pad(l.description || "", 44) + " #" + l.color); }); return 0; }
    if (a[0] === "create") { var n = f._[0]; if (r.labels.some(function (l) { return l.name === n; })) { c.o.err("label with name \"" + n + "\" already exists; use `--force` to update its color and description"); return 1; } r.labels.push({ name: n, color: (f.color || "ededed").replace(/^#/, ""), description: f.description || "" }); c.o.line("✓ Label \"" + n + "\" created in " + r.full); return 0; }
    c.o.err("Usage:  gh label <command> [flags]\n\nAvailable commands:\n  create\n  list"); return 1;
  };
  function issueLine(sys, it) { return X.pad("#" + it.n, 5) + X.pad(it.title, 34) + " " + X.pad(it.labels.join(", "), 22) + " " + ago(sys, it.created); }
  GHC.issue = function (c, a) {
    var sub = a[0], f = flags(a.slice(1), { vals: ["title", "t", "body", "b", "label", "l", "assignee", "a", "state", "s", "reason", "r", "comment", "c", "add-label", "remove-label", "add-assignee", "R", "repo", "author", "A", "search", "S", "json", "jq", "q", "limit", "L", "body-file", "F", "base", "name", "n"], multi: ["label", "add-label", "remove-label", "assignee", "add-assignee"], short: { t: "title", b: "body", l: "label", a: "assignee", s: "state", r: "reason", c: "comment", R: "repo", A: "author", S: "search", q: "jq", L: "limit", F: "body-file", n: "name" } });
    var login = needAuth(c); if (!login) return 4;
    var r = ghRepo(c, f.repo); if (!r) return 1;
    if (sub === "list") {
      var st = f.state || "open", labs = splitList(f.label);
      var list = r.items.filter(function (x) { return x.type === "issue" && (st === "all" || x.state === st) && labs.every(function (l) { return x.labels.indexOf(l) >= 0; }) && (!f.assignee || splitList(f.assignee).every(function (a) { return x.assignees.indexOf(a === "@me" ? login : a) >= 0; })) && (!f.author || x.author === (f.author === "@me" ? login : f.author)); }).sort(function (x, y) { return y.n - x.n; });
      if (!list.length) { c.o.err(labs.length || f.assignee || f.author ? "no issues match your search in " + r.full : "no " + (st === "all" ? "" : st + " ") + "issues in " + r.full); return 0; }
      c.o.line("\nShowing " + list.length + " of " + list.length + " " + (st === "all" ? "" : st + " ") + "issues in " + r.full + (labs.length ? " that match your search" : "") + "\n\nID   TITLE" + new Array(31).join(" ") + "LABELS                 UPDATED");
      list.forEach(function (x) { c.o.line(issueLine(c.sys, x)); });
      return 0;
    }
    if (sub === "create") {
      if (!f.title) { c.o.err("must provide `--title` and `--body` (or `--fill` or `fill-first` or `--fillverbose`) when not running interactively"); return 1; }
      var body = f.body !== undefined ? f.body : f["body-file"] ? (S.readFile(c.sess, f["body-file"]).content || "") : null;
      if (body === null) { c.o.err("must provide `--title` and `--body` (or `--fill` or `fill-first` or `--fillverbose`) when not running interactively"); return 1; }
      var lbls = splitList(f.label), bad = lbls.filter(function (l) { return !r.labels.some(function (x) { return x.name === l; }); });
      if (bad.length) { c.o.err("could not add label: '" + bad[0] + "' not found"); return 1; }
      var it = GH.issue(c.sys, r.full, { title: f.title, body: body, author: login, labels: lbls, assignees: splitList(f.assignee).map(function (x) { return x === "@me" ? login : x; }), created: now(c.sys) });
      c.o.line("\nCreating issue in " + r.full + "\n\nhttps://github.com/" + r.full + "/issues/" + it.n);
      GH.emit(c.sys, "issue.opened", { repo: r, issue: it });
      return 0;
    }
    var num = f._[0], it2 = num ? item(r, String(num).replace(/^#/, "")) : null;
    if (!it2 || it2.type !== "issue") { c.o.err("GraphQL: Could not resolve to an issue or pull request with the number of " + num + ". (repository.issue)"); return 1; }
    if (sub === "view") {
      c.o.line(it2.title + " " + r.full + "#" + it2.n + "\n" + (it2.state === "open" ? "Open" : "Closed") + " • " + it2.author + " opened " + ago(c.sys, it2.created) + " • " + it2.comments.length + " comment" + (it2.comments.length === 1 ? "" : "s") + (it2.labels.length ? "\nLabels: " + it2.labels.join(", ") : "") + (it2.assignees.length ? "\nAssignees: " + it2.assignees.join(", ") : "") + "\n\n\n  " + (it2.body || "No description provided").replace(/\n/g, "\n  ") + "\n");
      if (f.comments) it2.comments.forEach(function (cm) { c.o.line(cm.by + " • " + ago(c.sys, cm.at) + "\n  " + cm.body.replace(/\n/g, "\n  ") + "\n"); });
      else if (it2.comments.length) c.o.line("———————— Not showing " + it2.comments.length + " comment" + (it2.comments.length === 1 ? "" : "s") + " ————————\n\nUse --comments to view the full conversation\n");
      if (it2.state === "closed" && it2.closedBy) c.o.line("Closed by " + it2.closedBy);
      c.o.line("View this issue on GitHub: https://github.com/" + r.full + "/issues/" + it2.n);
      return 0;
    }
    if (sub === "close") {
      if (it2.state === "closed") { c.o.err("! Issue " + r.full + "#" + it2.n + " (" + it2.title + ") is already closed"); return 0; }
      if (f.comment) it2.comments.push({ by: login, body: f.comment, at: now(c.sys) });
      it2.state = "closed"; it2.reason = f.reason === "not planned" ? "not planned" : "completed"; it2.closedBy = login; it2.closedAt = now(c.sys);
      c.o.line("✓ Closed issue " + r.full + "#" + it2.n + " (" + it2.title + ")");
      return 0;
    }
    if (sub === "reopen") { it2.state = "open"; it2.reason = null; c.o.line("✓ Reopened issue " + r.full + "#" + it2.n + " (" + it2.title + ")"); return 0; }
    if (sub === "comment") { if (!f.body) { c.o.err("(gh issue comment opens an editor without --body. Here: gh issue comment N --body \"...\")"); return 1; } it2.comments.push({ by: login, body: f.body, at: now(c.sys) }); c.o.line("https://github.com/" + r.full + "/issues/" + it2.n + "#issuecomment-" + (2000000 + it2.comments.length)); return 0; }
    if (sub === "edit") {
      splitList(f["add-label"]).forEach(function (l) { if (it2.labels.indexOf(l) < 0) it2.labels.push(l); });
      splitList(f["remove-label"]).forEach(function (l) { it2.labels = it2.labels.filter(function (x) { return x !== l; }); });
      splitList(f["add-assignee"]).forEach(function (l) { l = l === "@me" ? login : l; if (it2.assignees.indexOf(l) < 0) it2.assignees.push(l); });
      if (f.title) it2.title = f.title; if (f.body !== undefined) it2.body = f.body;
      c.o.line("https://github.com/" + r.full + "/issues/" + it2.n);
      return 0;
    }
    if (sub === "develop") {
      var bname = f.name || (it2.n + "-" + it2.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""));
      var base = f.base || r.default, sha = r.refs["refs/heads/" + base];
      r.refs["refs/heads/" + bname] = sha; it2.linkedBranch = bname;
      c.o.line("github.com/" + r.full + "/tree/" + bname);
      if (f.checkout && c.repo) { var outF = []; fetchOne(c, defaultRemote(c), { q: true }, outF); return X.cmdSwitch(c, [bname]); }
      return 0;
    }
    c.o.err("Usage:  gh issue <command> [flags]\n\nAvailable commands:\n  close\n  comment\n  create\n  develop\n  edit\n  list\n  reopen\n  view"); return 1;
  };
  GHC.pr = function (c, a) {
    var sub = a[0], f = flags(a.slice(1), { vals: ["title", "t", "body", "b", "base", "B", "head", "H", "label", "l", "assignee", "a", "reviewer", "r", "state", "s", "R", "repo", "add-reviewer", "add-label", "remove-label", "subject", "body-file", "F", "json", "jq", "q", "author", "A", "search", "S", "limit", "L", "match-head-commit"], multi: ["label", "reviewer", "add-reviewer", "add-label", "assignee"], short: { t: "title", b: "body", B: "base", H: "head", l: "label", a: "assignee", r: "reviewer", s: "state", R: "repo", F: "body-file", q: "jq", A: "author", S: "search", L: "limit", d: "delete-branch", c: "comment", f: "fill", m: "merge" } });
    var login = needAuth(c); if (!login) return 4;
    var r = ghRepo(c, f.repo); if (!r) return 1;
    if (sub === "create") {
      if (!c.repo && !f.head) { c.o.err("could not determine the current branch: not on any branch"); return 1; }
      var h = c.repo ? G.head(c.repo) : null, branch = f.head || (h && h.branch);
      var headRepo = r.full, headBranch = branch;
      if (branch && branch.indexOf(":") > 0) { headRepo = branch.split(":")[0] + "/" + r.name; headBranch = branch.split(":")[1]; }
      else if (c.repo) {
        var pushRem = G.configGet(c.sys, c.repo, c.uid, "branch." + branch + ".remote") || "origin", pu = parseUrl(remoteUrl(c, pushRem) || "");
        if (pu) headRepo = pu.full;
      }
      var hr = GH.find(c.sys, headRepo);
      var base = f.base || r.default;
      if (!hr || !hr.refs["refs/heads/" + headBranch]) { c.o.err("aborted: you must first push the current branch to a remote, or use the --head flag"); return 1; }
      if (c.repo && h && h.sha && hr.refs["refs/heads/" + headBranch] !== h.sha && !f.head) c.o.err("Warning: 1 uncommitted change");
      if (hr.refs["refs/heads/" + headBranch] === r.refs["refs/heads/" + base] || G.isAncestor(c.sys, hr.refs["refs/heads/" + headBranch], r.refs["refs/heads/" + base])) { c.o.err("pull request create failed: GraphQL: No commits between " + base + " and " + headBranch + " (createPullRequest)"); return 1; }
      var exists = r.items.filter(function (x) { return x.type === "pr" && x.state === "open" && x.head === headBranch && x.headRepo === hr.full && x.base === base; })[0];
      if (exists) { c.o.err("a pull request for branch \"" + headBranch + "\" into branch \"" + base + "\" already exists:\nhttps://github.com/" + r.full + "/pull/" + exists.n); return 1; }
      var commits = GH.newCommits(c.sys, r.refs["refs/heads/" + base], hr.refs["refs/heads/" + headBranch]);
      var title = f.title, body = f.body !== undefined ? f.body : f["body-file"] ? (S.readFile(c.sess, f["body-file"]).content || "") : undefined;
      if (f.fill || f["fill-first"]) { var first = G.commitOf(c.sys, commits[commits.length - 1]); if (title === undefined) title = commits.length === 1 || f["fill-first"] ? subject(first.message) : headBranch.replace(/[-_/]/g, " "); if (body === undefined) body = commits.length === 1 ? X.body(first.message) : commits.slice().reverse().map(function (s) { return "- " + subject(G.commitOf(c.sys, s).message); }).join("\n"); }
      if (title === undefined || body === undefined) { c.o.err("must provide `--title` and `--body` (or `--fill` or `fill-first` or `--fillverbose`) when not running interactively"); return 1; }
      var revs = splitList(f.reviewer), labs = splitList(f.label);
      var bad = labs.filter(function (l) { return !r.labels.some(function (x) { return x.name === l; }); });
      if (bad.length) { c.o.err("could not add label: '" + bad[0] + "' not found"); return 1; }
      c.o.line("\nCreating " + (f.draft ? "draft " : "") + "pull request for " + (headRepo !== r.full ? headRepo.split("/")[0] + ":" : "") + headBranch + " into " + base + " in " + r.full + "\n");
      var pr = GH.openPR(c.sys, r.full, { title: title, body: body, author: login, base: base, head: headBranch, headRepo: hr.full, draft: !!f.draft, reviewers: revs, labels: labs, assignees: splitList(f.assignee).map(function (x) { return x === "@me" ? login : x; }) });
      c.o.line("https://github.com/" + r.full + "/pull/" + pr.n);
      return 0;
    }
    if (sub === "list") {
      var st = f.state || "open", labs2 = splitList(f.label);
      var list = r.items.filter(function (x) { return x.type === "pr" && (st === "all" || x.state === st || (st === "closed" && x.state === "merged")) && labs2.every(function (l) { return x.labels.indexOf(l) >= 0; }) && (!f.author || x.author === (f.author === "@me" ? login : f.author)); }).sort(function (x, y) { return y.n - x.n; });
      if (!list.length) { c.o.err(labs2.length || f.author ? "no pull requests match your search in " + r.full : "no " + (st === "all" ? "" : st + " ") + "pull requests in " + r.full); return 0; }
      c.o.line("\nShowing " + list.length + " of " + list.length + " " + (st === "all" ? "" : st + " ") + "pull requests in " + r.full + "\n\nID   TITLE" + new Array(31).join(" ") + "BRANCH" + new Array(17).join(" ") + "CREATED AT");
      list.forEach(function (x) { c.o.line(X.pad("#" + x.n, 5) + X.pad(x.title, 34) + " " + X.pad((x.headRepo !== r.full ? x.headRepo.split("/")[0] + ":" : "") + x.head, 22) + " " + ago(c.sys, x.created)); });
      return 0;
    }
    var pr2 = prRef(c, r, f._[0]); if (!pr2) return 1;
    if (sub === "view") {
      var s = stat(c.sys, r, pr2), lr = latestReviews(c.sys, r, pr2), checks = GH.prChecks ? GH.prChecks(c.sys, r, pr2) : [];
      var stateWord = pr2.state === "merged" ? "Merged" : pr2.state === "closed" ? "Closed" : pr2.draft ? "Draft" : "Open";
      var revLine = keys(lr).map(function (k) { return k + " (" + reviewWord(lr[k]) + ")"; }).concat(pr2.reviewers.map(function (k) { return k + " (Requested)"; }));
      c.o.line(pr2.title + " " + r.full + "#" + pr2.n + "\n" + stateWord + " • " + pr2.author + " " + (pr2.state === "merged" ? "merged" : "wants to merge") + " " + X.plural(s.commits, "commit", "commits") + " into " + pr2.base + " from " + (pr2.headRepo !== r.full ? pr2.headRepo.split("/")[0] + ":" : "") + pr2.head + " • " + ago(c.sys, pr2.created) + "\n+" + s.add + " -" + s.del + " • " + (checks.length ? checks.filter(function (x) { return x.conclusion === "success"; }).length + "/" + checks.length + " checks passing" : "No checks") + (revLine.length ? "\nReviewers: " + revLine.join(", ") : "") + (pr2.labels.length ? "\nLabels: " + pr2.labels.join(", ") : "") + "\n\n\n  " + (pr2.body || "No description provided").replace(/\n/g, "\n  ") + "\n");
      var conv = pr2.reviews.filter(function (x) { return x.body; }).map(function (x) { return { by: x.by, at: x.at, text: x.by + " " + (x.state === "APPROVED" ? "approved" : x.state === "CHANGES_REQUESTED" ? "requested changes" : "reviewed") + " • " + ago(c.sys, x.at), body: x.body }; }).concat(pr2.comments.map(function (x) { return { at: x.at, text: x.by + " • " + ago(c.sys, x.at), body: x.body }; })).sort(function (x, y) { return x.at - y.at; });
      if (f.comments) conv.forEach(function (x) { c.o.line(x.text + "\n  " + x.body.replace(/\n/g, "\n  ") + "\n"); });
      else if (conv.length) c.o.line("———————— Not showing " + X.plural(conv.length, "comment", "comments") + " ————————\n\n\n" + conv[conv.length - 1].text + "\n  " + conv[conv.length - 1].body.replace(/\n/g, "\n  ") + "\n\nUse --comments to view the full conversation\n");
      if (pr2.state === "open") { var bl = GH.blockers(c.sys, r, pr2); if (bl.length) c.o.line("Merge requirements: " + bl.join(" ")); }
      c.o.line("View this pull request on GitHub: https://github.com/" + r.full + "/pull/" + pr2.n);
      return 0;
    }
    if (sub === "diff") {
      var head = prHeadSha(c.sys, r, pr2), baseSha = r.refs["refs/heads/" + pr2.base] || pr2.baseSha, mb = G.mergeBases(c.sys, baseSha, head)[0];
      var A = G.commitFlat(c.sys, mb), B = G.commitFlat(c.sys, head);
      if (f["name-only"]) { prFiles(c.sys, r, pr2).forEach(function (p) { c.o.line(p); }); return 0; }
      keys(A).concat(keys(B)).filter(function (k, i, arr) { return arr.indexOf(k) === i; }).sort().forEach(function (k) {
        if (A[k] && B[k] && A[k].sha === B[k].sha) return;
        c.o.line("diff --git a/" + k + " b/" + k + (!A[k] ? "\nnew file mode " + B[k].mode : !B[k] ? "\ndeleted file mode " + A[k].mode : "") + "\nindex " + short(A[k] ? A[k].sha : G.zero()) + ".." + short(B[k] ? B[k].sha : G.zero()) + (A[k] && B[k] ? " " + B[k].mode : "") + "\n--- " + (A[k] ? "a/" + k : "/dev/null") + "\n+++ " + (B[k] ? "b/" + k : "/dev/null"));
        G.unifiedBody(A[k] ? G.blobText(c.sys, A[k].sha) : "", B[k] ? G.blobText(c.sys, B[k].sha) : "", 3).lines.forEach(function (l) { c.o.line(l.t, l.c); });
      });
      return 0;
    }
    if (sub === "checkout") {
      if (!c.repo) { c.o.err("not a git repository"); return 1; }
      var hrp = GH.find(c.sys, pr2.headRepo), hsha = hrp.refs["refs/heads/" + pr2.head];
      if (!hsha) { c.o.err("the head branch of this pull request was deleted"); return 1; }
      var local = pr2.headRepo !== r.full ? pr2.headRepo.split("/")[0] + "-" + pr2.head : pr2.head;
      var rem = defaultRemote(c), outx = [];
      if (pr2.headRepo === r.full) { var rc0 = fetchOne(c, rem, { q: true }, outx); if (rc0) return rc0; }
      if (G.resolveRefName(c.repo, "refs/heads/" + local).sha) { var rc1 = X.cmdSwitch(c, [local]); if (rc1) return rc1; X.moveTree(c, G.commitFlat(c.sys, hsha), {}); G.updateRef(c.repo, "refs/heads/" + local, hsha, "pull: Fast-forward", X.softIdent(c)); return 0; }
      if (pr2.headRepo === r.full) return X.cmdSwitch(c, [local]);
      G.updateRef(c.repo, "refs/heads/" + local, hsha, "branch: Created from pull/" + pr2.n + "/head", X.softIdent(c));
      return X.cmdSwitch(c, [local]);
    }
    if (sub === "review") {
      var state = f.approve ? "APPROVED" : f["request-changes"] ? "CHANGES_REQUESTED" : f.comment ? "COMMENTED" : null;
      if (!state) { c.o.err("did not understand desired review action: use --approve, --request-changes, or --comment"); return 1; }
      if ((state !== "APPROVED") && !f.body) { c.o.err("body cannot be blank for " + (state === "COMMENTED" ? "comment" : "request changes") + " review"); return 1; }
      if (pr2.author === login && state !== "COMMENTED") { c.o.err("failed to create review: GraphQL: Review Can not " + (state === "APPROVED" ? "approve" : "request changes on") + " your own pull request (addPullRequestReview)"); return 1; }
      GH.review(c.sys, r.full, pr2.n, login, state, f.body || "");
      c.o.line({ APPROVED: "✓ Approved pull request " + r.full + "#" + pr2.n, CHANGES_REQUESTED: "+ Requested changes to pull request " + r.full + "#" + pr2.n, COMMENTED: "- Reviewed pull request " + r.full + "#" + pr2.n }[state]);
      return 0;
    }
    if (sub === "comment") { if (!f.body) { c.o.err("(Here: gh pr comment N --body \"...\")"); return 1; } pr2.comments.push({ by: login, body: f.body, at: now(c.sys) }); GH.emit(c.sys, "pr.comment", { repo: r, pr: pr2, by: login, body: f.body }); c.o.line("https://github.com/" + r.full + "/pull/" + pr2.n + "#issuecomment-" + (3000000 + pr2.comments.length)); return 0; }
    if (sub === "edit") {
      var addRev = splitList(f["add-reviewer"]);
      addRev.forEach(function (x) { if (pr2.reviewers.indexOf(x) < 0) pr2.reviewers.push(x); });
      splitList(f["add-label"]).forEach(function (l) { if (pr2.labels.indexOf(l) < 0) pr2.labels.push(l); });
      splitList(f["remove-label"]).forEach(function (l) { pr2.labels = pr2.labels.filter(function (x) { return x !== l; }); });
      if (f.title) pr2.title = f.title; if (f.body !== undefined) pr2.body = f.body; if (f.base) pr2.base = f.base;
      if (addRev.length) GH.emit(c.sys, "pr.review_requested", { repo: r, pr: pr2, reviewers: addRev });
      c.o.line("https://github.com/" + r.full + "/pull/" + pr2.n);
      return 0;
    }
    if (sub === "ready") { pr2.draft = false; c.o.line("✓ Pull request " + r.full + "#" + pr2.n + " is marked as \"ready for review\""); GH.emit(c.sys, "pr.ready", { repo: r, pr: pr2 }); return 0; }
    if (sub === "close") { if (pr2.state !== "open") { c.o.err("! Pull request " + r.full + "#" + pr2.n + " (" + pr2.title + ") is already " + pr2.state); return 0; } pr2.state = "closed"; if (f.comment) pr2.comments.push({ by: login, body: f.comment, at: now(c.sys) }); c.o.line("✓ Closed pull request " + r.full + "#" + pr2.n + " (" + pr2.title + ")"); if (f["delete-branch"]) { var hr2 = GH.find(c.sys, pr2.headRepo); delete hr2.refs["refs/heads/" + pr2.head]; c.o.line("✓ Deleted branch " + pr2.head); } return 0; }
    if (sub === "checks") { if (!GH.prChecks) { c.o.err("no checks reported on the '" + pr2.head + "' branch"); return 1; } return GH.printChecks(c, r, pr2, f); }
    if (sub === "merge") {
      if (!can(c.sys, r, login, "write")) { c.o.err("GraphQL: " + login + " does not have the correct permissions to execute `MergePullRequest` (mergePullRequest)"); return 1; }
      if (pr2.state === "merged") { c.o.err("! Pull request " + r.full + "#" + pr2.n + " (" + pr2.title + ") was already merged"); return 1; }
      var how = f.squash ? "squash" : f.rebase ? "rebase" : f.merge ? "merge" : null;
      if (!how) { c.o.err("--merge, --rebase, or --squash required when not running interactively"); return 1; }
      var allowed = { merge: r.settings.mergeCommit, squash: r.settings.squash, rebase: r.settings.rebase }[how];
      if (!allowed) { c.o.err("GraphQL: " + { merge: "Merge commits are", squash: "Squash merges are", rebase: "Rebase merges are" }[how] + " not allowed on this repository. (mergePullRequest)"); return 1; }
      var bl2 = GH.blockers(c.sys, r, pr2);
      var admin = role(c.sys, r, login) === "admin", prot = protectionFor(r, pr2.base);
      if (bl2.length && f.auto) { pr2.autoMerge = { method: how, by: login, deleteBranch: !!f["delete-branch"] }; c.o.line("✓ Pull request " + r.full + "#" + pr2.n + " will be automatically merged via " + how + " when all requirements are met"); return 0; }
      var conflictOnly = bl2.filter(function (x) { return /conflicts/.test(x); }).length;
      if (bl2.length && !(f.admin && admin && (!prot || !prot.enforceAdmins) && !conflictOnly)) {
        c.o.err("X Pull request " + r.full + "#" + pr2.n + " is not mergeable: " + (conflictOnly ? "the merge commit cannot be cleanly created." : "the base branch policy prohibits the merge.") + "\nTo have the pull request merged after all the requirements have been met, add the `--auto` flag.\n" + (admin && (!prot || !prot.enforceAdmins) ? "To use administrator privileges to immediately merge the pull request, add the `--admin` flag.\n" : "") + "(" + bl2.join(" ") + ")");
        return 1;
      }
      if (how === "rebase" && GH.newCommits(c.sys, r.refs["refs/heads/" + pr2.base], prHeadSha(c.sys, r, pr2)).some(function (s2) { return G.commitOf(c.sys, s2).parents.length > 1; })) { c.o.err("GraphQL: This branch can't be rebased (mergePullRequest)"); return 1; }
      GH.mergePR(c.sys, r, pr2, how, login, { subject: f.subject, body: f.body });
      c.o.line("✓ " + { merge: "Merged", squash: "Squashed and merged", rebase: "Rebased and merged" }[how] + " pull request " + r.full + "#" + pr2.n + " (" + pr2.title + ")");
      if (f["delete-branch"] || r.settings.deleteBranchOnMerge) {
        if (c.repo && pr2.headRepo === r.full) {
          var hcur = G.head(c.repo);
          if (hcur.branch === pr2.head) {
            var rem2 = defaultRemote(c), outy = []; fetchOne(c, rem2, { q: true }, outy);
            var bsha = G.resolveRefName(c.repo, "refs/remotes/" + rem2 + "/" + pr2.base).sha;
            var prob = X.moveTree(c, G.commitFlat(c.sys, bsha), {});
            if (!prob) {
              var lb = G.resolveRefName(c.repo, "refs/heads/" + pr2.base).sha;
              if (lb) G.updateRef(c.repo, "refs/heads/" + pr2.base, bsha, "merge " + rem2 + "/" + pr2.base + ": Fast-forward", X.softIdent(c));
              else { G.updateRef(c.repo, "refs/heads/" + pr2.base, bsha, "branch: Created from " + rem2 + "/" + pr2.base, X.softIdent(c)); X.setUpstream(c, pr2.base, "refs/remotes/" + rem2 + "/" + pr2.base); }
              G.setHead(c.repo, "refs/heads/" + pr2.base, "checkout: moving from " + pr2.head + " to " + pr2.base, X.softIdent(c));
              G.updateRef(c.repo, "refs/heads/" + pr2.head, null);
              c.o.line("✓ Deleted local branch " + pr2.head + " and switched to branch " + pr2.base);
            }
          } else if (G.resolveRefName(c.repo, "refs/heads/" + pr2.head).sha) { G.updateRef(c.repo, "refs/heads/" + pr2.head, null); c.o.line("✓ Deleted local branch " + pr2.head); }
        }
        var hr3 = GH.find(c.sys, pr2.headRepo);
        if (hr3 && hr3.refs["refs/heads/" + pr2.head] && pr2.head !== hr3.default) { delete hr3.refs["refs/heads/" + pr2.head]; if (c.repo) { var rn3 = remoteNames(c).filter(function (n) { var pu3 = parseUrl(remoteUrl(c, n)); return pu3 && pu3.full === hr3.full; })[0]; if (rn3) G.updateRef(c.repo, "refs/remotes/" + rn3 + "/" + pr2.head, null); } c.o.line("✓ Deleted remote branch " + pr2.head); }
      }
      return 0;
    }
    c.o.err("Usage:  gh pr <command> [flags]\n\nAvailable commands:\n  checkout\n  checks\n  close\n  comment\n  create\n  diff\n  edit\n  list\n  merge\n  ready\n  review\n  view"); return 1;
  };

  /* ---------------- gh api: the endpoints the labs use */
  function setPath(obj, key, v) {
    var parts = key.replace(/\]/g, "").split("["), cur = obj;
    parts.forEach(function (p, i) { if (i === parts.length - 1) { if (p === "") { /* key[] append */ } cur[p] = v; } else { if (parts[i + 1] === "") { cur[p] = cur[p] || []; if (i + 1 === parts.length - 1) { cur[p].push(v); return; } } cur[p] = cur[p] || {}; cur = cur[p]; } });
  }
  function typed(c, v) { if (v === "true") return true; if (v === "false") return false; if (v === "null") return null; if (/^-?\d+$/.test(v)) return +v; if (v.charAt(0) === "@") { var rd = S.readFile(c.sess, v.slice(1)); return rd.error ? "" : rd.content; } return v; }
  GH.apiRoutes = [];
  GH.api = function (method, re, fn) { GH.apiRoutes.push({ method: method, re: re, fn: fn }); };
  function protOut(r, b, p) {
    var base = "https://api.github.com/repos/" + r.full + "/branches/" + b + "/protection";
    return { url: base, required_status_checks: p.checks ? { strict: !!p.checks.strict, contexts: p.checks.contexts || [] } : null, required_pull_request_reviews: p.pr ? { dismiss_stale_reviews: !!p.pr.dismissStale, require_code_owner_reviews: !!p.pr.codeowners, required_approving_review_count: p.pr.count } : null, required_signatures: { enabled: !!p.signatures }, enforce_admins: { enabled: !!p.enforceAdmins }, required_linear_history: { enabled: !!p.linear }, allow_force_pushes: { enabled: !!p.forcePush }, allow_deletions: { enabled: !!p.deletions } };
  }
  GH.api("GET", /^user$/, function (c, m, body, login) { var u = hub(c.sys).users[login]; return { login: login, name: u.name, type: "User", html_url: "https://github.com/" + login }; });
  GH.api("GET", /^repos\/([^/]+\/[^/]+)$/, function (c, m) { var r = GH.find(c.sys, m[1]); return { full_name: r.full, private: r.private, default_branch: r.default, fork: !!r.forkOf, parent: r.forkOf ? { full_name: r.forkOf } : undefined, delete_branch_on_merge: r.settings.deleteBranchOnMerge, allow_squash_merge: r.settings.squash, allow_merge_commit: r.settings.mergeCommit, allow_rebase_merge: r.settings.rebase, security_and_analysis: { secret_scanning: { status: r.settings.secretScanning ? "enabled" : "disabled" }, secret_scanning_push_protection: { status: r.settings.pushProtection ? "enabled" : "disabled" } } }; });
  GH.api("GET", /^repos\/([^/]+\/[^/]+)\/branches\/(.+)\/protection$/, function (c, m) { var r = GH.find(c.sys, m[1]), p = r.protect[m[2]]; if (!p) return { status: 404, body: { message: "Branch not protected", documentation_url: "https://docs.github.com/rest/branches/branch-protection#get-branch-protection", status: "404" } }; return protOut(r, m[2], p); });
  GH.api("PUT", /^repos\/([^/]+\/[^/]+)\/branches\/(.+)\/protection$/, function (c, m, b, login) {
    var r = GH.find(c.sys, m[1]);
    if (!can(c.sys, r, login, "admin")) return { status: 404, body: { message: "Not Found", status: "404" } };
    var miss = ["required_status_checks", "enforce_admins", "required_pull_request_reviews", "restrictions"].filter(function (k) { return !(k in b); });
    if (miss.length) return { status: 422, body: { message: "Invalid request.\n\n\"" + miss[0] + "\" wasn't supplied.", documentation_url: "https://docs.github.com/rest/branches/branch-protection#update-branch-protection", status: "422" } };
    var rv = b.required_pull_request_reviews, sc = b.required_status_checks;
    var p = { pr: rv ? { count: rv.required_approving_review_count === undefined ? 1 : rv.required_approving_review_count, codeowners: !!rv.require_code_owner_reviews, dismissStale: !!rv.dismiss_stale_reviews } : null, checks: sc ? { strict: !!sc.strict, contexts: sc.contexts || (sc.checks || []).map(function (x) { return x.context; }) } : null, enforceAdmins: !!b.enforce_admins, linear: !!b.required_linear_history, forcePush: !!b.allow_force_pushes, deletions: !!b.allow_deletions, signatures: r.protect[m[2]] ? r.protect[m[2]].signatures : false };
    r.protect[m[2]] = p;
    GH.audit(c.sys, login, "protected_branch.update", { repo: r.full, branch: m[2] });
    return protOut(r, m[2], p);
  });
  GH.api("DELETE", /^repos\/([^/]+\/[^/]+)\/branches\/(.+)\/protection$/, function (c, m, b, login) { var r = GH.find(c.sys, m[1]); delete r.protect[m[2]]; GH.audit(c.sys, login, "protected_branch.destroy", { repo: r.full, branch: m[2] }); return { status: 204 }; });
  GH.api("POST", /^repos\/([^/]+\/[^/]+)\/branches\/(.+)\/protection\/required_signatures$/, function (c, m, b, login) { var r = GH.find(c.sys, m[1]), p = r.protect[m[2]]; if (!p) return { status: 404, body: { message: "Branch not protected", status: "404" } }; p.signatures = true; GH.audit(c.sys, login, "protected_branch.update", { repo: r.full, branch: m[2], required_signatures: true }); return { url: "https://api.github.com/repos/" + r.full + "/branches/" + m[2] + "/protection/required_signatures", enabled: true }; });
  GH.api("GET", /^repos\/([^/]+\/[^/]+)\/collaborators$/, function (c, m) { var r = GH.find(c.sys, m[1]); return keys(r.collab).map(function (k) { return { login: k, role_name: r.collab[k] }; }); });
  GH.api("PUT", /^repos\/([^/]+\/[^/]+)\/collaborators\/([^/]+)$/, function (c, m, b, login) { var r = GH.find(c.sys, m[1]); if (!can(c.sys, r, login, "admin")) return { status: 403, body: { message: "Must have admin rights to Repository.", status: "403" } }; var map = { pull: "read", push: "write", read: "read", write: "write", triage: "triage", maintain: "maintain", admin: "admin" }; r.collab[m[2]] = map[b.permission || "push"] || "write"; GH.audit(c.sys, login, "repo.add_member", { repo: r.full, user: m[2], permission: r.collab[m[2]] }); return { status: 201, body: { id: 1, repository: { full_name: r.full }, invitee: { login: m[2] }, permissions: r.collab[m[2]] } }; });
  GH.api("DELETE", /^repos\/([^/]+\/[^/]+)\/collaborators\/([^/]+)$/, function (c, m, b, login) { var r = GH.find(c.sys, m[1]); delete r.collab[m[2]]; GH.audit(c.sys, login, "repo.remove_member", { repo: r.full, user: m[2] }); return { status: 204 }; });
  GH.api("GET", /^repos\/([^/]+\/[^/]+)\/pulls\/(\d+)\/reviews$/, function (c, m) { var r = GH.find(c.sys, m[1]), pr = item(r, m[2]); return pr.reviews.map(function (x, i) { return { id: 100 + i, user: { login: x.by }, state: x.state, body: x.body, commit_id: x.commit }; }); });
  GH.api("GET", /^repos\/([^/]+\/[^/]+)\/commits\/([0-9a-f]{7,40})$/, function (c, m) { var sha = keys(c.sys.gitObjects || {}).filter(function (k) { return k.indexOf(m[2]) === 0; })[0]; if (!sha) return { status: 422, body: { message: "No commit found for SHA: " + m[2], status: "422" } }; var co = G.commitOf(c.sys, sha), v = GH.verify ? GH.verify(c.sys, sha) : { verified: false, reason: "unsigned" }; return { sha: sha, commit: { author: { name: co.author.name, email: co.author.email }, message: co.message.replace(/\n$/, ""), verification: { verified: v.verified, reason: v.reason } } }; });
  function cmdApi(c, a) {
    var f = flags(a, { vals: ["X", "method", "f", "raw-field", "F", "field", "input", "jq", "q", "H", "header", "t", "template", "hostname"], multi: ["f", "raw-field", "F", "field", "H", "header"], short: { X: "method", f: "raw-field", F: "field", q: "jq", H: "header", t: "template", i: "include", p: "preview" } });
    var login = needAuth(c); if (!login) return 4;
    var ep = (f._[0] || "").replace(/^\//, "").replace(/^https:\/\/api\.github\.com\//, "");
    if (!ep) { c.o.err("Usage:  gh api <endpoint> [flags]"); return 1; }
    if (c.repo && /\{owner\}|\{repo\}/.test(ep)) { var gr = ghRepo(c); if (!gr) return 1; ep = ep.replace("{owner}", gr.owner).replace("{repo}", gr.name); }
    var body = {}, hasBody = false;
    (f["raw-field"] || []).forEach(function (kv) { var i = kv.indexOf("="); setPath(body, kv.slice(0, i), kv.slice(i + 1)); hasBody = true; });
    (f.field || []).forEach(function (kv) { var i = kv.indexOf("="); setPath(body, kv.slice(0, i), typed(c, kv.slice(i + 1))); hasBody = true; });
    if (f.input) { var rd = f.input === "-" ? { content: String(c.io.stdin || "") } : S.readFile(c.sess, f.input); if (rd.error) { c.o.err("open " + f.input + ": no such file or directory"); return 1; } try { body = JSON.parse(rd.content); hasBody = true; } catch (e) { c.o.err("HTTP 400: Problems parsing JSON (https://api.github.com/" + ep + ")"); return 1; } }
    var method = (f.method || (hasBody ? "POST" : "GET")).toUpperCase();
    var path = ep.split("?")[0], query = {};
    (ep.split("?")[1] || "").split("&").forEach(function (kv) { if (kv) { var p2 = kv.split("="); query[p2[0]] = decodeURIComponent(p2[1] || ""); } });
    var hit = null, m = null;
    GH.apiRoutes.forEach(function (rt) { if (hit) return; var mm = rt.re.exec(path); if (mm && rt.method === method) { hit = rt; m = mm; } });
    var repoMatch = /^repos\/([^/]+\/[^/]+)/.exec(path);
    if (repoMatch) { var rr = GH.find(c.sys, repoMatch[1]); if (!rr || !can(c.sys, rr, login, "read")) { c.o.err("gh: Not Found (HTTP 404)"); c.o.line(JSON.stringify({ message: "Not Found", documentation_url: "https://docs.github.com/rest", status: "404" })); return 1; } }
    if (!hit) {
      var any = GH.apiRoutes.some(function (rt) { return rt.re.test(path); });
      c.o.err(any ? "gh: Not Found (HTTP 404)" : "gh: Not Found (HTTP 404)");
      c.o.line(JSON.stringify({ message: "Not Found", documentation_url: "https://docs.github.com/rest", status: "404" }));
      if (!any) c.o.err("(This lab's GitHub only answers the endpoints its tickets use.)");
      return 1;
    }
    var res = hit.fn(c, m, body, login, query);
    var status = res && res.status && res.body !== undefined ? res.status : res && res.status === 204 ? 204 : 200;
    var data = res && res.status && (res.body !== undefined || res.status === 204) ? res.body : res;
    if (status === 204) return 0;
    var text = JSON.stringify(data, null, f.jq ? 0 : 2);
    if (status >= 400) { c.o.err("gh: " + (data && data.message ? data.message.split("\n")[0] : "Error") + " (HTTP " + status + ")"); c.o.line(JSON.stringify(data)); return 1; }
    if (f.jq) { var rc = S.runCommand(c.sess, ["jq", "-r", f.jq], { stdin: text + "\n", out: c.io.out, err: c.io.err, pipedIn: true }); return rc; }
    c.o.line(text);
    return 0;
  }
  GHC.api = cmdApi;
  GHC.status = function (c) { var login = needAuth(c); if (!login) return 4; c.o.line("Relevant pull requests and issues in your repositories: use gh pr status / gh issue list."); return 0; };

  S.CMDS.gh = cmdGh;

  /* ---------------- ssh -T git@github.com */
  var sshOrig = S.CMDS.ssh;
  S.CMDS.ssh = function (args, io, sess) {
    var target = args.slice(1).filter(function (x, i, arr) { return !/^-/.test(x) && !/^-[iFJLRDplo]$/.test(arr[i - 1] || ""); })[0] || "";
    if (!/(^|@)github\.com$/.test(target)) return sshOrig(args, io, sess);
    var c = ghCtx(sess, io);
    var user = /^([^@]+)@/.exec(target);
    if (!user || user[1] !== "git") { knownHost(c); io.err((user ? user[1] : sess.user) + "@github.com: Permission denied (publickey).\n"); return 255; }
    var a = authenticate(c, { proto: "ssh" }, "read");
    if (a.error) { io.err("git@github.com: Permission denied (publickey).\n"); return 255; }
    io.err("Hi " + (a.login || a.deploy) + "! You've successfully authenticated, but GitHub does not provide shell access.\n");
    return 1;
  };
  // Explanations under common errors (the lab runner prints the first that matches).
  var EX = root.ShLab && root.ShLab.EXPLAIN;
  if (EX) [
    [/could not read Username for 'https:\/\/github\.com'/, "Git has no login for GitHub over HTTPS. Log in with gh (gh auth login --with-token < FILE, then gh auth setup-git so git uses it), or use an SSH remote with a key registered on your GitHub account."],
    [/Support for password authentication was removed|Invalid username or token/, "GitHub doesn't accept account passwords for git. Use a personal access token (through gh auth setup-git or a credential helper) or SSH."],
    [/^git@github\.com: Permission denied \(publickey\)/, "GitHub didn't accept any of your SSH keys. Is there a key in ~/.ssh (ssh-keygen -t ed25519), and is its .pub half added to your account (gh ssh-key add ~/.ssh/id_ed25519.pub)? Test with ssh -T git@github.com."],
    [/\(fetch first\)$|\(non-fast-forward\)$/, "GitHub has commits you don't have yet. Bring them in first (git pull, or git fetch then git rebase/git merge), then push again. Never \"fix\" this with --force on a shared branch."],
    [/\(stale info\)$/, "--force-with-lease refused: the branch on GitHub moved since your last fetch, so someone else pushed. git fetch, look at what changed, then decide."],
    [/GH006: Protected branch update failed/, "This branch is protected on GitHub. Push your work to another branch and open a pull request (gh pr create)."],
    [/Need to specify how to reconcile divergent branches/, "Your branch and the remote both have new commits. Choose how pull combines them: git pull --rebase (replay yours on top) or git pull --no-rebase (merge), or set it once with git config pull.rebase true|false."],
    [/has no upstream branch/, "This branch doesn't exist on the remote yet. The first push creates it and links them: git push -u origin BRANCH."],
    [/^error: could not apply [0-9a-f]+\.\.\./, "The rebase stopped at a conflict. Fix the file(s) (remove the <<<<<<< ======= >>>>>>> markers), git add them, then git rebase --continue. git rebase --abort puts everything back."],
    [/^remote: Repository not found|^ERROR: Repository not found/, "GitHub says no such repository, which is also what it says when you have no access to a private one. Check the owner/name, and that you're logged in as an account with access (gh auth status)."],
    [/must first push the current branch/, "A pull request needs your branch on GitHub: git push -u origin BRANCH first."],
    [/is not mergeable/, "GitHub won't merge yet: the line in brackets says what's missing (an approval, a code owner, a check). gh pr view shows the details."],
    [/^To get started with GitHub CLI/, "gh isn't logged in. Log in with a token: gh auth login --with-token < FILE"]
  ].reverse().forEach(function (x) { EX.unshift(x); });
  S.MAN.gh = { syn: "gh <command> <subcommand> [flags]", desc: "GitHub's command-line tool: pull requests, issues, repositories, Actions runs and the API, from the terminal.", opts: [["auth login --with-token < FILE", "log in with a token"], ["auth setup-git", "let git use gh's login for HTTPS"], ["repo clone|create|fork|view", "repositories"], ["pr create|list|view|diff|checkout|review|merge", "pull requests"], ["issue create|list|view|close|comment", "issues"], ["api ENDPOINT", "any REST API call"]] };

  /* ---------------- the laptop: gh installed; GitHub's people */
  S.SYS_HOOKS.push(function (sys) {
    G.putFile(sys, "/usr/bin/gh", "\x7fELF:gh (simulated binary)\n", 493, 0, 0);
  });
  // Lab setup: a clone that already exists on the laptop (no authentication needed), owned by dev.
  GH.cloneTo = function (sys, full, dest, url, o) {
    o = o || {};
    var r = GH.find(sys, full), branch = o.branch || r.default, uid = 1000;
    var repo = G.initRepo(sys, dest, uid, uid, branch);
    url = url || "https://github.com/" + full + ".git";
    addFetchSpec(sys, repo, "origin", url);
    keys(r.refs).forEach(function (k) { if (/^refs\/heads\//.test(k)) G.gwrite(repo, "refs/remotes/origin/" + k.slice(11), r.refs[k] + "\n"); else G.gwrite(repo, k, r.refs[k] + "\n"); });
    G.gwrite(repo, "refs/remotes/origin/HEAD", "ref: refs/remotes/origin/" + r.default + "\n");
    var sha = r.refs["refs/heads/" + branch], who = Object.assign({}, G.PEOPLE.dev, { time: G.clock(sys) - 86400 });
    G.gwrite(repo, "refs/heads/" + branch, sha + "\n");
    G.logRef(repo, "refs/heads/" + branch, null, sha, "clone: from " + url, who);
    G.logRef(repo, "HEAD", null, sha, "clone: from " + url, who);
    writeConfig(sys, repo, [["branch." + branch + ".remote", "origin"], ["branch." + branch + ".merge", "refs/heads/" + branch]]);
    var flat = G.commitFlat(sys, sha), idx = { entries: {}, conflicts: {} };
    keys(flat).forEach(function (p) { G.writeWork(repo, p, flat[p].sha, flat[p].mode, 2); idx.entries[p] = flat[p]; });
    G.writeIndex(repo, idx);
    storeReachable(sys, repo, keys(r.refs).map(function (k) { return r.refs[k]; }));
    return repo;
  };
  // Lab setup: run commands as dev on the laptop (history, reflogs and all), silently.
  GH.runAs = function (sys, cwd, lines) {
    var sess = S.newSession(sys); sess.cwd = cwd;
    var saved = sys.topSession; sys.topSession = sess;
    lines.forEach(function (l) { S.runLine(sess, l); });
    sys.topSession = saved;
  };
  GH.people = function (sys) {
    GH.user(sys, "kc-dev", { name: "dev", email: "dev@kestrel.io" });
    GH.user(sys, "maya-chen", { name: "Maya Chen", email: "maya@kestrel.io" });
    GH.user(sys, "dev-patel", { name: "Dev Patel", email: "devp@kestrel.io" });
    GH.user(sys, "ben-okoro", { name: "Ben Okoro", email: "ben@kestrel.io" });
    GH.user(sys, "ana-silva", { name: "Ana Silva", email: "ana@kestrel.io" });
    var o = GH.org(sys, "kestrel", { "maya-chen": "owner", "dev-patel": "owner", "kc-dev": "member", "ben-okoro": "member", "ana-silva": "member" }, { devs: ["kc-dev", "ben-okoro", "ana-silva", "maya-chen"], security: ["dev-patel"], sre: ["maya-chen"] });
    o.base = "write";
  };
  root.GitHub = GH;
  if (typeof module !== "undefined" && module.exports) module.exports = GH;
})(typeof window !== "undefined" ? window : globalThis);
