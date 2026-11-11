/* sudo learn — a simulated Git, part 1: the storage model. Objects are hashed exactly like real Git (SHA-1 of
   "type size\0body"), so the same files, author, time and message give the same commit IDs as real Git would.
   Repositories live in the simulated file system: .git/HEAD, .git/refs/..., .git/config and .git/logs are real
   text files; the object database and the index are kept beside them (the files in .git/objects are stand-ins). */
(function (root) {
  "use strict";
  var S = root.ShEngine;

  /* ================================================================== bytes and SHA-1 */
  var ENC = typeof TextEncoder !== "undefined" ? new TextEncoder() : null;
  function utf8(s) {
    if (ENC) return ENC.encode(s);
    var out = [], str = unescape(encodeURIComponent(s));
    for (var i = 0; i < str.length; i++) out.push(str.charCodeAt(i));
    return new Uint8Array(out);
  }
  function concat(parts) {
    var n = 0; parts.forEach(function (p) { n += p.length; });
    var out = new Uint8Array(n), o = 0;
    parts.forEach(function (p) { out.set(p, o); o += p.length; });
    return out;
  }
  function hexBytes(h) { var out = new Uint8Array(h.length / 2); for (var i = 0; i < out.length; i++) out[i] = parseInt(h.substr(i * 2, 2), 16); return out; }
  function sha1(bytes) {
    var ml = bytes.length, withOne = ml + 1, padLen = (withOne % 64 <= 56 ? 56 - withOne % 64 : 120 - withOne % 64);
    var total = withOne + padLen + 8, m = new Uint8Array(total);
    m.set(bytes); m[ml] = 0x80;
    var bits = ml * 8, hi = Math.floor(bits / 0x100000000), lo = bits >>> 0;
    m[total - 8] = hi >>> 24; m[total - 7] = (hi >>> 16) & 255; m[total - 6] = (hi >>> 8) & 255; m[total - 5] = hi & 255;
    m[total - 4] = lo >>> 24; m[total - 3] = (lo >>> 16) & 255; m[total - 2] = (lo >>> 8) & 255; m[total - 1] = lo & 255;
    var h0 = 0x67452301, h1 = 0xEFCDAB89, h2 = 0x98BADCFE, h3 = 0x10325476, h4 = 0xC3D2E1F0, w = new Int32Array(80);
    for (var off = 0; off < total; off += 64) {
      for (var i = 0; i < 16; i++) w[i] = (m[off + i * 4] << 24) | (m[off + i * 4 + 1] << 16) | (m[off + i * 4 + 2] << 8) | m[off + i * 4 + 3];
      for (i = 16; i < 80; i++) { var x = w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16]; w[i] = (x << 1) | (x >>> 31); }
      var a = h0, b = h1, c = h2, d = h3, e = h4;
      for (i = 0; i < 80; i++) {
        var f, k;
        if (i < 20) { f = (b & c) | (~b & d); k = 0x5A827999; }
        else if (i < 40) { f = b ^ c ^ d; k = 0x6ED9EBA1; }
        else if (i < 60) { f = (b & c) | (b & d) | (c & d); k = 0x8F1BBCDC; }
        else { f = b ^ c ^ d; k = 0xCA62C1D6; }
        var t = (((a << 5) | (a >>> 27)) + f + e + k + w[i]) | 0;
        e = d; d = c; c = (b << 30) | (b >>> 2); b = a; a = t;
      }
      h0 = (h0 + a) | 0; h1 = (h1 + b) | 0; h2 = (h2 + c) | 0; h3 = (h3 + d) | 0; h4 = (h4 + e) | 0;
    }
    return [h0, h1, h2, h3, h4].map(function (v) { return ("00000000" + (v >>> 0).toString(16)).slice(-8); }).join("");
  }
  var BLOBCACHE = {};
  var NBLOB = 0;
  function blobSha(content) {
    var k = "b" + content;
    if (Object.prototype.hasOwnProperty.call(BLOBCACHE, k)) return BLOBCACHE[k];
    var body = utf8(content);
    var sha = sha1(concat([utf8("blob " + body.length + "\0"), body]));
    if (++NBLOB > 5000) { BLOBCACHE = {}; NBLOB = 0; }
    BLOBCACHE[k] = sha;
    return sha;
  }

  /* ================================================================== the object database */
  function db(sys) { return sys.gitObjects || (sys.gitObjects = {}); }
  function treeOrder(a, b) {
    var x = a.name + (a.mode === "40000" ? "/" : ""), y = b.name + (b.mode === "40000" ? "/" : "");
    return x < y ? -1 : x > y ? 1 : 0;
  }
  function identLine(p) { return p.name + " <" + p.email + "> " + p.time + " " + (p.tz || "+0000"); }
  function commitText(c) {
    var t = "tree " + c.tree + "\n";
    c.parents.forEach(function (p) { t += "parent " + p + "\n"; });
    return t + "author " + identLine(c.author) + "\ncommitter " + identLine(c.committer) + "\n\n" + c.message;
  }
  function tagText(o) { return "object " + o.object + "\ntype " + o.objtype + "\ntag " + o.tag + "\ntagger " + identLine(o.tagger) + "\n\n" + o.message; }
  function putObject(sys, obj) {
    var body;
    if (obj.type === "blob") { var sha0 = blobSha(obj.content); db(sys)[sha0] = { type: "blob", content: obj.content }; return sha0; }
    if (obj.type === "tree") {
      obj.entries.sort(treeOrder);
      body = concat(obj.entries.map(function (e) { return concat([utf8(e.mode + " " + e.name + "\0"), hexBytes(e.sha)]); }));
    }
    else if (obj.type === "commit") body = utf8(commitText(obj));
    else body = utf8(tagText(obj));
    var sha = sha1(concat([utf8(obj.type + " " + body.length + "\0"), body]));
    obj.size = body.length;
    db(sys)[sha] = obj;
    return sha;
  }
  function getObject(sys, sha) { return sha ? db(sys)[sha] || null : null; }
  function objSize(sys, sha) { var o = getObject(sys, sha); if (!o) return 0; if (o.type === "blob") return utf8(o.content).length; if (o.size == null) putObject(sys, o); return o.size; }
  function commitOf(sys, sha) { var o = getObject(sys, sha); while (o && o.type === "tag") { sha = o.object; o = getObject(sys, sha); } return o && o.type === "commit" ? o : null; }
  function peel(sys, sha) { var o = getObject(sys, sha); while (o && o.type === "tag") { sha = o.object; o = getObject(sys, sha); } return sha; }

  // Flatten a tree into {path: {sha, mode}}.
  function flatTree(sys, treeSha, prefix, out) {
    out = out || {};
    var t = getObject(sys, treeSha);
    if (!t) return out;
    t.entries.forEach(function (e) {
      var p = (prefix ? prefix + "/" : "") + e.name;
      if (e.mode === "40000") flatTree(sys, e.sha, p, out);
      else out[p] = { sha: e.sha, mode: e.mode };
    });
    return out;
  }
  function commitFlat(sys, sha) { var c = sha ? commitOf(sys, sha) : null; return c ? flatTree(sys, c.tree) : {}; }
  // Build tree objects from a flat map; returns the root tree's id.
  function writeTree(sys, flat) {
    var rootDir = { files: {}, dirs: {} };
    Object.keys(flat).forEach(function (p) {
      var parts = p.split("/"), d = rootDir;
      for (var i = 0; i < parts.length - 1; i++) d = d.dirs[parts[i]] || (d.dirs[parts[i]] = { files: {}, dirs: {} });
      d.files[parts[parts.length - 1]] = flat[p];
    });
    function w(d) {
      var entries = [];
      Object.keys(d.dirs).forEach(function (n) { entries.push({ mode: "40000", name: n, sha: w(d.dirs[n]) }); });
      Object.keys(d.files).forEach(function (n) { entries.push({ mode: d.files[n].mode, name: n, sha: d.files[n].sha }); });
      return putObject(sys, { type: "tree", entries: entries });
    }
    return w(rootDir);
  }
  function blobText(sys, sha) { var o = getObject(sys, sha); return o && o.type === "blob" ? o.content : ""; }

  /* ================================================================== file system helpers (bypass permissions: git runs as the repo owner) */
  function nodeAt(sys, abs) {
    var n = sys.root, parts = S.splitPath(abs);
    for (var i = 0; i < parts.length; i++) {
      if (!n || n.type !== "d") return null;
      n = n.children[parts[i]];
      if (n && n.type === "l" && i < parts.length - 1) { var t = n.target.charAt(0) === "/" ? n.target : "/" + parts.slice(0, i).join("/") + "/" + n.target; n = nodeAt(sys, S.normAbs(t)); }
    }
    return n || null;
  }
  function ensureDir(sys, abs, uid, gid, mode) {
    var n = sys.root;
    S.splitPath(abs).forEach(function (seg) {
      if (!n.children[seg] || n.children[seg].type !== "d") { n.children[seg] = S.dirNode(mode == null ? 509 : mode, uid, gid, sys.now); }
      n = n.children[seg];
    });
    return n;
  }
  function putFile(sys, abs, content, mode, uid, gid) {
    var dir = abs.slice(0, abs.lastIndexOf("/")) || "/", name = abs.slice(abs.lastIndexOf("/") + 1);
    var d = ensureDir(sys, dir, uid, gid);
    var old = d.children[name];
    if (old && old.type === "f") { old.content = content; if (mode != null) old.mode = mode; old.mtime = sys.now; delete old.size; return old; }
    d.children[name] = S.fileNode(content, mode == null ? 436 : mode, uid, gid, sys.now);
    return d.children[name];
  }
  function removePath(sys, abs) {
    var dir = abs.slice(0, abs.lastIndexOf("/")) || "/", name = abs.slice(abs.lastIndexOf("/") + 1);
    var d = nodeAt(sys, dir);
    if (d && d.type === "d" && d.children[name]) { delete d.children[name]; return true; }
    return false;
  }
  function readText(sys, abs) { var n = nodeAt(sys, abs); return n && n.type === "f" ? n.content : null; }

  /* ================================================================== repositories */
  // Find the repository that contains dir (walking up to /). Returns null when there is none.
  function findRepo(sys, dir) {
    var parts = S.splitPath(dir);
    for (var i = parts.length; i >= 0; i--) {
      var top = "/" + parts.slice(0, i).join("/");
      var g = nodeAt(sys, (top === "/" ? "" : top) + "/.git");
      if (g && g.type === "d" && g.children.HEAD) return repoAt(sys, top);
    }
    return null;
  }
  function repoAt(sys, top) {
    var gd = (top === "/" ? "" : top) + "/.git";
    var topNode = nodeAt(sys, top) || {};
    return { sys: sys, top: top, gitdir: gd, uid: topNode.uid || 1000, gid: topNode.gid || 1000 };
  }
  function gpath(repo, rel) { return repo.gitdir + "/" + rel; }
  function gread(repo, rel) { return readText(repo.sys, gpath(repo, rel)); }
  function gwrite(repo, rel, content, mode) { return putFile(repo.sys, gpath(repo, rel), content, mode == null ? 436 : mode, repo.uid, repo.gid); }
  function gremove(repo, rel) { return removePath(repo.sys, gpath(repo, rel)); }
  function gexists(repo, rel) { return !!nodeAt(repo.sys, gpath(repo, rel)); }

  var SAMPLE_HOOKS = ["applypatch-msg", "commit-msg", "fsmonitor-watchman", "post-update", "pre-applypatch", "pre-commit", "pre-merge-commit", "pre-push", "pre-rebase", "pre-receive", "prepare-commit-msg", "push-to-checkout", "sendemail-validate", "update"];
  function initRepo(sys, top, uid, gid, branch, opts) {
    opts = opts || {};
    var repo = { sys: sys, top: top, gitdir: (top === "/" ? "" : top) + "/.git", uid: uid, gid: gid };
    ensureDir(sys, top, uid, gid, 509);
    ensureDir(sys, repo.gitdir, uid, gid, 509);
    ["objects/info", "objects/pack", "refs/heads", "refs/tags", "hooks", "info", "branches"].forEach(function (d) { ensureDir(sys, gpath(repo, d), uid, gid, 509); });
    gwrite(repo, "HEAD", "ref: refs/heads/" + branch + "\n");
    if (!gexists(repo, "config")) gwrite(repo, "config", "[core]\n\trepositoryformatversion = 0\n\tfilemode = true\n\tbare = false\n\tlogallrefupdates = true\n");
    gwrite(repo, "description", "Unnamed repository; edit this file 'description' to name the repository.\n");
    gwrite(repo, "info/exclude", "# git ls-files --others --exclude-from=.git/info/exclude\n# Lines that start with '#' are comments.\n# For a project mostly in C, the following would be a good set of\n# exclude patterns (uncomment them if you want to use them):\n# *.[oa]\n# *~\n");
    SAMPLE_HOOKS.forEach(function (h) { gwrite(repo, "hooks/" + h + ".sample", "#!/bin/sh\n#\n# An example hook script. To enable it, rename this file to \"" + h + "\".\n", 509); });
    return repo;
  }

  /* ================================================================== config files */
  function parseConfig(text) {
    var out = [], sec = null, sub = null;
    String(text || "").split("\n").forEach(function (raw) {
      var line = raw.replace(/\s*[#;].*$/, function (m) { return /["]/.test(m) ? m : ""; }).trim();
      if (!line) return;
      var m = /^\[\s*([A-Za-z0-9.-]+)(?:\s+"((?:[^"\\]|\\.)*)")?\s*\]$/.exec(line);
      if (m) { var p = m[1].split("."); sec = p[0].toLowerCase(); sub = m[2] !== undefined ? m[2] : p.length > 1 ? p.slice(1).join(".") : null; return; }
      var kv = /^([A-Za-z][A-Za-z0-9-]*)\s*(?:=\s*(.*))?$/.exec(line);
      if (!kv || !sec) return;
      var v = kv[2] === undefined ? "true" : kv[2];
      v = v.replace(/^"(.*)"$/, "$1").replace(/\\(["\\])/g, "$1");
      out.push({ key: sec + (sub !== null ? "." + sub : "") + "." + kv[1].toLowerCase(), value: v });
    });
    return out;
  }
  function splitKey(key) {
    var first = key.indexOf("."), last = key.lastIndexOf(".");
    if (first < 0 || last === key.length - 1 || first === 0) return null;
    return { sec: key.slice(0, first).toLowerCase(), sub: first === last ? null : key.slice(first + 1, last), name: key.slice(last + 1).toLowerCase(), rawName: key.slice(last + 1) };
  }
  function normKey(key) { var k = splitKey(key); return k ? k.sec + (k.sub !== null ? "." + k.sub : "") + "." + k.name : key; }
  function fmtValue(v) { return /^\s|\s$|[#;"]/.test(v) ? '"' + v.replace(/(["\\])/g, "\\$1") + '"' : v; }
  // Set (or unset with value === null) key in config text; returns the new text.
  function setInConfig(text, key, value, all) {
    var k = splitKey(key);
    var lines = String(text || "").split("\n");
    if (lines[lines.length - 1] === "") lines.pop();
    var sec = null, sub = null, secEnd = -1, found = false, out = [];
    function header(l) { var m = /^\s*\[\s*([A-Za-z0-9.-]+)(?:\s+"((?:[^"\\]|\\.)*)")?\s*\]\s*$/.exec(l); if (!m) return null; var p = m[1].split("."); return { sec: p[0].toLowerCase(), sub: m[2] !== undefined ? m[2] : p.length > 1 ? p.slice(1).join(".") : null }; }
    for (var i = 0; i < lines.length; i++) {
      var l = lines[i], h = header(l);
      if (h) { sec = h.sec; sub = h.sub; out.push(l); if (sec === k.sec && sub === k.sub) secEnd = out.length; continue; }
      var kv = /^\s*([A-Za-z][A-Za-z0-9-]*)\s*(=|$)/.exec(l);
      if (kv && sec === k.sec && sub === k.sub && kv[1].toLowerCase() === k.name) {
        if (value === null) { found = true; continue; }
        if (found && !all) continue;
        out.push("\t" + k.rawName + " = " + fmtValue(value)); found = true; secEnd = out.length; continue;
      }
      out.push(l);
      if (sec === k.sec && sub === k.sub) secEnd = out.length;
    }
    if (value !== null && !found) {
      if (secEnd >= 0) out.splice(secEnd, 0, "\t" + k.rawName + " = " + fmtValue(value));
      else { out.push("[" + k.sec + (k.sub !== null ? ' "' + k.sub + '"' : "") + "]"); out.push("\t" + k.rawName + " = " + fmtValue(value)); }
    }
    // drop sections left empty by an unset
    var res = [];
    for (var j = 0; j < out.length; j++) {
      if (header(out[j]) && (j + 1 >= out.length || header(out[j + 1])) && value === null) continue;
      res.push(out[j]);
    }
    return res.length ? res.join("\n") + "\n" : "";
  }
  function homeOf(sys, uid) { var u = S.userById(sys, uid); return u ? u.home : "/root"; }
  function configFiles(sys, repo, uid) {
    var files = [{ scope: "system", path: "/etc/gitconfig" }, { scope: "global", path: homeOf(sys, uid) + "/.gitconfig" }];
    if (repo) files.push({ scope: "local", path: repo.gitdir + "/config" });
    return files;
  }
  // All config entries in order (later wins), each {key, value, scope, path}.
  function configAll(sys, repo, uid, extra) {
    var all = [];
    configFiles(sys, repo, uid).forEach(function (f) {
      var t = readText(sys, f.path);
      if (t === null) return;
      parseConfig(t).forEach(function (e) { all.push({ key: e.key, value: e.value, scope: f.scope, path: f.path }); });
    });
    (extra || []).forEach(function (e) { all.push({ key: normKey(e.key), value: e.value, scope: "command", path: "" }); });
    return all;
  }
  function configGet(sys, repo, uid, key, extra) {
    var nk = normKey(key), v = null;
    configAll(sys, repo, uid, extra).forEach(function (e) { if (e.key === nk) v = e.value; });
    return v;
  }
  function configBool(v, dflt) { if (v === null || v === undefined) return dflt; return /^(true|yes|on|1)$/i.test(v); }

  /* ================================================================== refs and reflogs */
  function readRef(repo, name) {
    var t = gread(repo, name);
    if (t !== null) return t.trim();
    var packed = gread(repo, "packed-refs");
    if (packed) { var hit = packed.split("\n").filter(function (l) { return l.split(" ")[1] === name; })[0]; if (hit) return hit.split(" ")[0]; }
    return null;
  }
  // Follow symbolic refs. Returns {name: final ref name, sha: id or null}.
  function resolveRefName(repo, name) {
    var hops = 0, cur = name;
    while (hops++ < 5) {
      var v = readRef(repo, cur);
      if (v === null) return { name: cur, sha: null };
      if (v.indexOf("ref: ") === 0) { cur = v.slice(5).trim(); continue; }
      return { name: cur, sha: v };
    }
    return { name: cur, sha: null };
  }
  function head(repo) {
    var v = readRef(repo, "HEAD") || "";
    if (v.indexOf("ref: ") === 0) {
      var ref = v.slice(5).trim(), sha = resolveRefName(repo, ref).sha;
      return { ref: ref, branch: ref.indexOf("refs/heads/") === 0 ? ref.slice(11) : ref, sha: sha, detached: false };
    }
    return { ref: null, branch: null, sha: v || null, detached: true };
  }
  function listRefs(repo, prefix) {
    var out = [];
    function walk(dirRel) {
      var n = nodeAt(repo.sys, gpath(repo, dirRel));
      if (!n || n.type !== "d") return;
      Object.keys(n.children).sort().forEach(function (k) {
        var ch = n.children[k], rel = dirRel + "/" + k;
        if (ch.type === "d") walk(rel);
        else if (ch.type === "f") out.push({ name: rel, sha: ch.content.trim() });
      });
    }
    walk(prefix.replace(/\/$/, ""));
    var packed = gread(repo, "packed-refs");
    if (packed) packed.split("\n").forEach(function (l) { var p = l.split(" "); if (/^[0-9a-f]{40}$/.test(p[0]) && p[1] && p[1].indexOf(prefix) === 0 && !out.some(function (o) { return o.name === p[1]; })) out.push({ name: p[1], sha: p[0] }); });
    out.sort(function (a, b) { return a.name < b.name ? -1 : a.name > b.name ? 1 : 0; });
    return out;
  }
  function pruneEmptyDirs(sys, absDir, stopAt) {
    while (absDir.length > stopAt.length && absDir.indexOf(stopAt) === 0) {
      var n = nodeAt(sys, absDir);
      if (!n || n.type !== "d" || Object.keys(n.children).length) return;
      removePath(sys, absDir);
      absDir = absDir.slice(0, absDir.lastIndexOf("/"));
    }
  }
  function zero() { return "0000000000000000000000000000000000000000"; }
  function logRef(repo, name, oldSha, newSha, msg, who) {
    if (!who) return;
    var line = (oldSha || zero()) + " " + (newSha || zero()) + " " + who.name + " <" + who.email + "> " + who.time + " " + (who.tz || "+0000") + "\t" + msg + "\n";
    var cur = gread(repo, "logs/" + name);
    gwrite(repo, "logs/" + name, (cur || "") + line);
  }
  // Point a ref at sha (null deletes it). msg goes into the reflog (and HEAD's, if HEAD is on that branch).
  function updateRef(repo, name, sha, msg, who) {
    var old = resolveRefName(repo, name).sha;
    if (sha === null) {
      gremove(repo, name);
      gremove(repo, "logs/" + name);
      pruneEmptyDirs(repo.sys, gpath(repo, name).slice(0, gpath(repo, name).lastIndexOf("/")), gpath(repo, "refs/heads"));
      pruneEmptyDirs(repo.sys, gpath(repo, name).slice(0, gpath(repo, name).lastIndexOf("/")), gpath(repo, "refs/tags"));
      var packed = gread(repo, "packed-refs");
      if (packed) gwrite(repo, "packed-refs", packed.split("\n").filter(function (l) { return l.split(" ")[1] !== name; }).join("\n"));
      return;
    }
    gwrite(repo, name, sha + "\n");
    if (msg !== false && (name.indexOf("refs/heads/") === 0 || name === "refs/stash")) logRef(repo, name, old, sha, msg, who);
    var h = head(repo);
    if (msg !== false && h.ref === name) logRef(repo, "HEAD", old, sha, msg, who);
  }
  // Move HEAD: to a branch (ref name) or detached at sha.
  function setHead(repo, target, msg, who) {
    var before = head(repo).sha;
    if (/^refs\//.test(target)) gwrite(repo, "HEAD", "ref: " + target + "\n");
    else gwrite(repo, "HEAD", target + "\n");
    var after = head(repo).sha;
    if (msg && who) logRef(repo, "HEAD", before, after, msg, who);
  }
  function reflog(repo, name) {
    var t = gread(repo, "logs/" + name);
    if (!t) return [];
    return t.split("\n").filter(Boolean).map(function (l) {
      var tab = l.indexOf("\t"), head = l.slice(0, tab), msg = l.slice(tab + 1);
      var m = /^(\w+) (\w+) (.*) <([^>]*)> (\d+) ([+-]\d{4})$/.exec(head) || [];
      return { old: m[1], sha: m[2], name: m[3], email: m[4], time: +m[5], tz: m[6], msg: msg };
    }).reverse();
  }

  /* ================================================================== the index (staging area) */
  function readIndex(repo) {
    var n = nodeAt(repo.sys, gpath(repo, "index"));
    var x = n && n.gitIndex ? n.gitIndex : { entries: {}, conflicts: {} };
    return { entries: Object.assign({}, x.entries), conflicts: JSON.parse(JSON.stringify(x.conflicts || {})) };
  }
  function writeIndex(repo, idx) {
    var n = gwrite(repo, "index", "DIRC\u0000\u0000\u0000\u0002" + Object.keys(idx.entries).length + " entries (binary file)");
    n.gitIndex = { entries: idx.entries, conflicts: idx.conflicts || {} };
  }

  /* ================================================================== the working tree */
  function fileMode(node) { return node.type === "l" ? "120000" : (node.mode & 73) ? "100755" : "100644"; }
  function nodeContent(node) { return node.type === "l" ? node.target : node.content; }
  // All files in the working tree: {rel: node}. Skips .git and nested repositories.
  function workFiles(repo) {
    var out = {}, top = nodeAt(repo.sys, repo.top);
    function walk(n, rel) {
      Object.keys(n.children).forEach(function (k) {
        var ch = n.children[k], p = rel ? rel + "/" + k : k;
        if (!rel && k === ".git") return;
        if (ch.type === "d") { if (ch.children[".git"]) return; walk(ch, p); }
        else if (ch.type === "f" || ch.type === "l") out[p] = ch;
      });
    }
    if (top && top.type === "d") walk(top, "");
    return out;
  }
  function workEntry(repo, rel) {
    var n = nodeAt(repo.sys, repo.top + "/" + rel);
    if (!n) return null;
    if (n.type === "d") return null;
    return { sha: blobSha(nodeContent(n)), mode: fileMode(n), node: n };
  }
  function workEntryNode(n) { return { sha: blobSha(nodeContent(n)), mode: fileMode(n), node: n }; }
  function workPath(repo, rel) { return (repo.top === "/" ? "" : repo.top) + "/" + rel; }
  // Write a blob to the working tree. Returns null or an error string.
  function writeWork(repo, rel, sha, mode, umask) {
    var abs = workPath(repo, rel);
    var parts = rel.split("/"), d = nodeAt(repo.sys, repo.top);
    for (var i = 0; i < parts.length - 1; i++) {
      var ch = d.children[parts[i]];
      if (ch && ch.type !== "d") { delete d.children[parts[i]]; ch = null; }
      if (!ch) { ch = d.children[parts[i]] = S.dirNode(509 & ~(umask == null ? 2 : umask) | 0, repo.uid, repo.gid, repo.sys.now); ch.mode = 509 & ~(umask == null ? 2 : umask); }
      d = ch;
    }
    var name = parts[parts.length - 1], content = blobText(repo.sys, sha);
    var m = (mode === "100755" ? 511 : 438) & ~(umask == null ? 2 : umask);
    var old = d.children[name];
    if (mode === "120000") { d.children[name] = S.linkNode(content, repo.uid, repo.gid); return null; }
    if (old && old.type === "f") { old.content = content; old.mode = (old.mode & ~73) | (mode === "100755" ? (m & 73) : 0); old.mtime = repo.sys.now; delete old.size; }
    else d.children[name] = S.fileNode(content, m, repo.uid, repo.gid, repo.sys.now);
    return null;
  }
  function removeWork(repo, rel) {
    var abs = workPath(repo, rel);
    removePath(repo.sys, abs);
    pruneEmptyDirs(repo.sys, abs.slice(0, abs.lastIndexOf("/")), repo.top);
  }

  /* ================================================================== .gitignore */
  function globToRe(pat) {
    var re = "", i = 0;
    while (i < pat.length) {
      var c = pat.charAt(i);
      if (c === "*") {
        if (pat.charAt(i + 1) === "*") {
          var before = i === 0 || pat.charAt(i - 1) === "/", after = i + 2 >= pat.length || pat.charAt(i + 2) === "/";
          if (before && after) {
            if (i + 2 >= pat.length) { re += ".*"; i += 2; continue; }
            re += "(?:.*/)?"; i += 3; continue;
          }
        }
        re += "[^/]*"; i++; continue;
      }
      if (c === "?") { re += "[^/]"; i++; continue; }
      if (c === "[") {
        var j = pat.indexOf("]", i + 2);
        if (j > 0) { var cls = pat.slice(i + 1, j).replace(/^!/, "^").replace(/\\/g, "\\\\"); re += "[" + cls + "]"; i = j + 1; continue; }
      }
      if (c === "\\" && i + 1 < pat.length) { re += pat.charAt(i + 1).replace(/[.*+?^${}()|[\]\\/]/g, "\\$&"); i += 2; continue; }
      re += c.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&"); i++;
    }
    return re;
  }
  function compileRule(line, base, src, lineNo) {
    var raw = line;
    if (/^\s*$/.test(line) || line.charAt(0) === "#") return null;
    line = line.replace(/(\\ )|\s+$/g, function (m, esc) { return esc ? " " : ""; });
    var neg = false;
    if (line.charAt(0) === "!") { neg = true; line = line.slice(1); }
    else if (line.indexOf("\\!") === 0 || line.indexOf("\\#") === 0) line = line.slice(1);
    var dirOnly = false;
    if (line.length > 1 && line.charAt(line.length - 1) === "/") { dirOnly = true; line = line.slice(0, -1); }
    if (!line) return null;
    var anchored = line.indexOf("/") >= 0;
    var pat = line.replace(/^\//, "");
    return { neg: neg, dirOnly: dirOnly, anchored: anchored, re: new RegExp("^" + globToRe(pat) + "$"), base: base, src: src, line: lineNo, text: raw.replace(/\s+$/, "") };
  }
  function ruleMatches(rule, rel, isDir) {
    if (rule.dirOnly && !isDir) return false;
    var p = rel;
    if (rule.base) { if (rel.indexOf(rule.base + "/") !== 0) return false; p = rel.slice(rule.base.length + 1); }
    if (rule.anchored) return rule.re.test(p);
    return rule.re.test(p.slice(p.lastIndexOf("/") + 1));
  }
  // All ignore rules of the repository, shallow files first (later rules win).
  function ignoreRules(repo, extraGlobal) {
    var rules = [];
    function add(text, base, src) { String(text || "").split("\n").forEach(function (l, i) { var r = compileRule(l, base, src, i + 1); if (r) rules.push(r); }); }
    if (extraGlobal) add(readText(repo.sys, extraGlobal), "", extraGlobal);
    add(gread(repo, "info/exclude"), "", ".git/info/exclude");
    var top = nodeAt(repo.sys, repo.top);
    function walk(n, rel) {
      if (n.children[".gitignore"] && n.children[".gitignore"].type === "f") add(n.children[".gitignore"].content, rel, (rel ? rel + "/" : "") + ".gitignore");
      Object.keys(n.children).sort().forEach(function (k) {
        var ch = n.children[k];
        if (ch.type === "d" && !(rel === "" && k === ".git") && !ch.children[".git"]) walk(ch, rel ? rel + "/" + k : k);
      });
    }
    if (top) walk(top, "");
    return rules;
  }
  function makeIgnorer(repo, extraGlobal) {
    var rules = ignoreRules(repo, extraGlobal), memo = {};
    function own(rel, isDir) {
      var hit = null;
      for (var i = 0; i < rules.length; i++) {
        var r = rules[i];
        if (r.base && rel.indexOf(r.base + "/") !== 0) continue;
        if (ruleMatches(r, rel, isDir)) hit = r;
      }
      return hit;
    }
    // Returns the deciding rule if rel is ignored (a parent folder being ignored counts), else null.
    function check(rel, isDir) {
      var k = rel + (isDir ? "/" : "");
      if (memo[k] !== undefined) return memo[k];
      var parts = rel.split("/"), res = null;
      for (var i = 1; i < parts.length; i++) {
        var d = own(parts.slice(0, i).join("/"), true);
        if (d && !d.neg) { res = d; break; }
      }
      if (!res) { var r = own(rel, isDir); res = r && !r.neg ? r : null; }
      memo[k] = res;
      return res;
    }
    // The last matching rule, negations included (for check-ignore -v).
    function rule(rel, isDir) { var c = check(rel, isDir); return c || own(rel, isDir); }
    return { ignored: check, rule: rule, rules: rules };
  }

  /* ================================================================== diffs (Myers) */
  function splitLines(t) {
    if (!t) return [];
    var parts = t.split("\n"), out = [];
    for (var i = 0; i < parts.length; i++) {
      if (i < parts.length - 1) out.push(parts[i] + "\n");
      else if (parts[i] !== "") out.push(parts[i]);
    }
    return out;
  }
  // Returns the edit script as a list of ops: {t: "=", a, b} | {t: "-", a} | {t: "+", b}.
  function myers(A, B) {
    var N = A.length, M = B.length;
    // trim common prefix/suffix for speed
    var pre = 0; while (pre < N && pre < M && A[pre] === B[pre]) pre++;
    var suf = 0; while (suf < N - pre && suf < M - pre && A[N - 1 - suf] === B[M - 1 - suf]) suf++;
    var a = A.slice(pre, N - suf), b = B.slice(pre, M - suf), n = a.length, m = b.length;
    var max = n + m, v = {}, trace = [];
    v[1] = 0;
    var found = false;
    for (var d = 0; d <= max && !found; d++) {
      trace.push(Object.assign({}, v));
      for (var k = -d; k <= d; k += 2) {
        var x;
        if (k === -d || (k !== d && (v[k - 1] === undefined ? -1 : v[k - 1]) < (v[k + 1] === undefined ? -1 : v[k + 1]))) x = v[k + 1];
        else x = v[k - 1] + 1;
        var y = x - k;
        while (x < n && y < m && a[x] === b[y]) { x++; y++; }
        v[k] = x;
        if (x >= n && y >= m) { found = true; break; }
      }
    }
    // backtrack
    var ops = [], x2 = n, y2 = m;
    for (var dd = trace.length - 1; dd >= 0; dd--) {
      var vv = trace[dd], kk = x2 - y2, prevK;
      if (kk === -dd || (kk !== dd && (vv[kk - 1] === undefined ? -1 : vv[kk - 1]) < (vv[kk + 1] === undefined ? -1 : vv[kk + 1]))) prevK = kk + 1;
      else prevK = kk - 1;
      var prevX = vv[prevK] === undefined ? 0 : vv[prevK], prevY = prevX - prevK;
      while (x2 > prevX && y2 > prevY) { ops.push({ t: "=", a: x2 - 1 + pre, b: y2 - 1 + pre }); x2--; y2--; }
      if (dd > 0) {
        if (x2 === prevX) ops.push({ t: "+", b: y2 - 1 + pre });
        else ops.push({ t: "-", a: x2 - 1 + pre });
      }
      x2 = prevX; y2 = prevY;
    }
    ops.reverse();
    var full = [];
    for (var i = 0; i < pre; i++) full.push({ t: "=", a: i, b: i });
    // within the middle, git prefers deletions before insertions in each changed block
    var block = [];
    function flush() { block.filter(function (o) { return o.t === "-"; }).forEach(function (o) { full.push(o); }); block.filter(function (o) { return o.t === "+"; }).forEach(function (o) { full.push(o); }); block = []; }
    ops.forEach(function (o) { if (o.t === "=") { flush(); full.push(o); } else block.push(o); });
    flush();
    for (i = 0; i < suf; i++) full.push({ t: "=", a: N - suf + i, b: M - suf + i });
    return full;
  }
  // Group ops into hunks with ctx lines of context.
  function hunks(ops, ctx) {
    var out = [], i = 0, n = ops.length;
    var changes = [];
    ops.forEach(function (o, k) { if (o.t !== "=") changes.push(k); });
    if (!changes.length) return out;
    var start = Math.max(0, changes[0] - ctx), end = Math.min(n - 1, changes[0] + ctx);
    for (var c = 1; c < changes.length; c++) {
      if (changes[c] - ctx <= end + 1) end = Math.min(n - 1, changes[c] + ctx);
      else { out.push(ops.slice(start, end + 1)); start = Math.max(0, changes[c] - ctx); end = Math.min(n - 1, changes[c] + ctx); }
    }
    out.push(ops.slice(start, end + 1));
    return out;
  }
  function stripNl(l) { return l.charAt(l.length - 1) === "\n" ? l.slice(0, -1) : l; }
  // Unified diff body lines: [{t: text, c: colour}] for one file. aOld/bNew are contents.
  function unifiedBody(aText, bText, ctx, opts) {
    opts = opts || {};
    var A = splitLines(aText), B = splitLines(bText);
    var ops = myers(A, B), hs = hunks(ops, ctx == null ? 3 : ctx), out = [];
    var stats = { add: 0, del: 0 };
    ops.forEach(function (o) { if (o.t === "+") stats.add++; else if (o.t === "-") stats.del++; });
    hs.forEach(function (h) {
      var aStart = null, bStart = null, aCount = 0, bCount = 0;
      h.forEach(function (o) {
        if (o.t !== "+") { if (aStart === null) aStart = o.a; aCount++; }
        if (o.t !== "-") { if (bStart === null) bStart = o.b; bCount++; }
      });
      if (aStart === null) { var firstB = h.filter(function (o) { return o.b !== undefined; })[0]; aStart = lineBefore(ops, h[0], "a"); }
      if (bStart === null) bStart = lineBefore(ops, h[0], "b");
      var aNum = aCount ? aStart + 1 : aStart, bNum = bCount ? bStart + 1 : bStart;
      var hdr = "@@ -" + aNum + (aCount === 1 ? "" : "," + aCount) + " +" + bNum + (bCount === 1 ? "" : "," + bCount) + " @@";
      var fn = funcName(A, aCount ? aStart : aStart);
      out.push({ t: hdr + (fn ? " " + fn : ""), c: "cyan" });
      h.forEach(function (o) {
        var l = o.t === "+" ? B[o.b] : A[o.a];
        out.push({ t: (o.t === "=" ? " " : o.t) + stripNl(l), c: o.t === "+" ? "green" : o.t === "-" ? "red" : null });
        if (l.charAt(l.length - 1) !== "\n") out.push({ t: "\\ No newline at end of file", c: null });
      });
    });
    return { lines: out, add: stats.add, del: stats.del };
  }
  // For a hunk made only of insertions/deletions, the line number before it in side s.
  function lineBefore(ops, first, s) {
    var idx = ops.indexOf(first), n = 0;
    for (var i = 0; i < idx; i++) if (s === "a" ? ops[i].t !== "+" : ops[i].t !== "-") n++;
    return n;
  }
  function funcName(lines, before) {
    for (var i = before - 1; i >= 0; i--) {
      if (/^[A-Za-z_$]/.test(lines[i])) return stripNl(lines[i]).replace(/\s+$/, "").slice(0, 80);
    }
    return "";
  }
  function countChanges(aText, bText) {
    var ops = myers(splitLines(aText), splitLines(bText)), add = 0, del = 0;
    ops.forEach(function (o) { if (o.t === "+") add++; else if (o.t === "-") del++; });
    return { add: add, del: del };
  }

  /* ================================================================== three-way merge of text */
  // Changed regions of base->side: [{s, e, lines}] (base lines s..e-1 replaced by lines).
  function regions(base, side) {
    var ops = myers(base, side), out = [], cur = null, ai = 0;
    ops.forEach(function (o) {
      if (o.t === "=") { if (cur) { out.push(cur); cur = null; } ai = o.a + 1; return; }
      if (!cur) cur = { s: ai, e: ai, lines: [] };
      if (o.t === "-") { cur.e = o.a + 1; ai = o.a + 1; }
      else cur.lines.push(side[o.b]);
    });
    if (cur) out.push(cur);
    return out;
  }
  function applyRegions(base, regs, s, e) {
    var out = [], pos = s;
    regs.forEach(function (r) { for (var i = pos; i < r.s; i++) out.push(base[i]); r.lines.forEach(function (l) { out.push(l); }); pos = r.e; });
    for (var i = pos; i < e; i++) out.push(base[i]);
    return out;
  }
  function withNl(arr) { return arr.map(function (l, i) { return l.charAt(l.length - 1) === "\n" ? l : l + "\n"; }); }
  // Merge two edits of the same file. Returns {text, conflicts}.
  function merge3(baseText, oursText, theirsText, labels, style) {
    var base = splitLines(baseText), ours = splitLines(oursText), theirs = splitLines(theirsText);
    var ro = regions(base, ours).map(function (r) { r.side = "o"; return r; });
    var rt = regions(base, theirs).map(function (r) { r.side = "t"; return r; });
    var all = ro.concat(rt).sort(function (x, y) { return x.s - y.s || x.e - y.e; });
    var out = [], pos = 0, conflicts = 0, i = 0;
    while (i < all.length) {
      var cl = [all[i]], s = all[i].s, e = all[i].e;
      i++;
      // regions touching or overlapping join the cluster
      while (i < all.length && (all[i].s < e || (all[i].s === e && (all[i].side !== cl[0].side || cl.some(function (c) { return c.side !== all[i].side; }))) || (all[i].s === s && all[i].e === s))) {
        if (all[i].s > e) break;
        cl.push(all[i]); e = Math.max(e, all[i].e); i++;
      }
      for (var k = pos; k < s; k++) out.push(base[k]);
      var os = cl.filter(function (c) { return c.side === "o"; }), ts = cl.filter(function (c) { return c.side === "t"; });
      var oVer = applyRegions(base, os, s, e), tVer = applyRegions(base, ts, s, e);
      if (!ts.length) oVer.forEach(function (l) { out.push(l); });
      else if (!os.length) tVer.forEach(function (l) { out.push(l); });
      else if (oVer.join("") === tVer.join("")) oVer.forEach(function (l) { out.push(l); });
      else {
        // zealous: lines both sides agree on at the edges are not part of the conflict
        var p = 0; while (p < oVer.length && p < tVer.length && oVer[p] === tVer[p]) p++;
        var q = 0; while (q < oVer.length - p && q < tVer.length - p && oVer[oVer.length - 1 - q] === tVer[tVer.length - 1 - q]) q++;
        for (k = 0; k < p; k++) out.push(oVer[k]);
        var oMid = oVer.slice(p, oVer.length - q), tMid = tVer.slice(p, tVer.length - q);
        if (oMid.length && out.length && out[out.length - 1].charAt(out[out.length - 1].length - 1) !== "\n") out[out.length - 1] += "\n";
        out.push("<<<<<<< " + labels[0] + "\n");
        withNl(oMid).forEach(function (l) { out.push(l); });
        if (style === "diff3") { out.push("||||||| " + labels[2] + "\n"); withNl(base.slice(s, e)).forEach(function (l) { out.push(l); }); }
        out.push("=======\n");
        withNl(tMid).forEach(function (l) { out.push(l); });
        out.push(">>>>>>> " + labels[1] + "\n");
        for (k = oVer.length - q; k < oVer.length; k++) out.push(oVer[k]);
        conflicts++;
      }
      pos = e;
    }
    for (var k2 = pos; k2 < base.length; k2++) out.push(base[k2]);
    return { text: out.join(""), conflicts: conflicts };
  }

  /* ================================================================== merging trees */
  function same(a, b) { return (!a && !b) || (a && b && a.sha === b.sha && a.mode === b.mode); }
  // Returns {entries: clean result, conflicts: {path: {1,2,3, work}}, messages: [], changed: [paths]}
  function mergeTrees(sys, baseFlat, oursFlat, theirsFlat, labels, style) {
    var paths = {}, entries = {}, conflicts = {}, messages = [];
    [baseFlat, oursFlat, theirsFlat].forEach(function (f) { Object.keys(f).forEach(function (p) { paths[p] = 1; }); });
    Object.keys(paths).sort().forEach(function (p) {
      var b = baseFlat[p], o = oursFlat[p], t = theirsFlat[p];
      if (same(o, t)) { if (o) entries[p] = o; return; }
      if (same(b, o)) { if (t) entries[p] = t; return; }
      if (same(b, t)) { if (o) entries[p] = o; return; }
      if (o && t) {
        messages.push({ t: "Auto-merging " + p });
        if (o.sha === t.sha) { entries[p] = { sha: o.sha, mode: o.mode !== (b && b.mode) ? o.mode : t.mode }; return; }
        var m = merge3(b ? blobText(sys, b.sha) : "", blobText(sys, o.sha), blobText(sys, t.sha), [labels[0], labels[1], labels[2] || "merged common ancestors"], style);
        var mode = o.mode === (b && b.mode) ? t.mode : o.mode;
        if (!m.conflicts) { entries[p] = { sha: putObject(sys, { type: "blob", content: m.text }), mode: mode }; return; }
        messages.push({ t: "CONFLICT (" + (b ? "content" : "add/add") + "): Merge conflict in " + p, conflict: true });
        conflicts[p] = { 1: b || null, 2: o, 3: t, work: { sha: putObject(sys, { type: "blob", content: m.text }), mode: mode } };
        return;
      }
      // one side deleted, the other changed it
      var kept = o || t, delIn = o ? labels[1] : labels[0], modIn = o ? labels[0] : labels[1];
      messages.push({ t: "CONFLICT (modify/delete): " + p + " deleted in " + delIn + " and modified in " + modIn + ".  Version " + modIn + " of " + p + " left in tree.", conflict: true });
      conflicts[p] = { 1: b || null, 2: o || null, 3: t || null, work: kept };
    });
    return { entries: entries, conflicts: conflicts, messages: messages };
  }

  /* ================================================================== history walking */
  function parentsOf(sys, sha) { var c = commitOf(sys, sha); return c ? c.parents : []; }
  function ancestors(sys, sha, out) {
    out = out || {};
    var stack = [sha];
    while (stack.length) { var s = stack.pop(); if (!s || out[s]) continue; out[s] = 1; parentsOf(sys, s).forEach(function (p) { stack.push(p); }); }
    return out;
  }
  function isAncestor(sys, a, b) { return !!ancestors(sys, b)[a]; }
  // Best common ancestors (all of them; usually one).
  function mergeBases(sys, a, b) {
    var A = ancestors(sys, a), B = ancestors(sys, b), common = Object.keys(A).filter(function (x) { return B[x]; });
    return common.filter(function (x) { return !common.some(function (y) { return y !== x && isAncestor(sys, x, y); }); })
      .sort(function (x, y) { return commitOf(sys, y).committer.time - commitOf(sys, x).committer.time; });
  }

  /* ================================================================== dates */
  var DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"], MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  function tzMinutes(tz) { var m = /^([+-])(\d\d)(\d\d)$/.exec(tz || "+0000"); return m ? (m[1] === "-" ? -1 : 1) * (+m[2] * 60 + +m[3]) : 0; }
  function p2(n) { return (n < 10 ? "0" : "") + n; }
  function local(time, tz) { return new Date((time + tzMinutes(tz) * 60) * 1000); }
  function relDate(time, now) {
    var d = now - time;
    if (d < 0) return "in the future";
    function q(n, u) { return n + " " + u + (n === 1 ? "" : "s") + " ago"; }
    if (d < 90) return q(d, "second");
    d = Math.floor((d + 30) / 60);
    if (d < 90) return q(d, "minute");
    d = Math.floor((d + 30) / 60);
    if (d < 36) return q(d, "hour");
    d = Math.floor((d + 12) / 24);
    if (d < 14) return q(d, "day");
    if (d < 70) return q(Math.floor((d + 3) / 7), "week");
    if (d < 365) return q(Math.floor((d + 15) / 30), "month");
    if (d < 1825) { var tm = Math.floor((d * 12 * 2 + 365) / (365 * 2)), y = Math.floor(tm / 12), mo = tm % 12; return mo ? y + " year" + (y === 1 ? "" : "s") + ", " + mo + " month" + (mo === 1 ? "" : "s") + " ago" : q(y, "year"); }
    return q(Math.floor((d + 183) / 365), "year");
  }
  function fmtDate(time, tz, mode, now) {
    var d = local(time, tz);
    var Y = d.getUTCFullYear(), M = d.getUTCMonth(), D = d.getUTCDate(), h = d.getUTCHours(), mi = d.getUTCMinutes(), s = d.getUTCSeconds();
    tz = tz || "+0000";
    if (mode === "relative") return relDate(time, now);
    if (mode === "short") return Y + "-" + p2(M + 1) + "-" + p2(D);
    if (mode === "iso" || mode === "iso8601") return Y + "-" + p2(M + 1) + "-" + p2(D) + " " + p2(h) + ":" + p2(mi) + ":" + p2(s) + " " + tz;
    if (mode === "iso-strict") return Y + "-" + p2(M + 1) + "-" + p2(D) + "T" + p2(h) + ":" + p2(mi) + ":" + p2(s) + tz.slice(0, 3) + ":" + tz.slice(3);
    if (mode === "unix") return String(time);
    if (mode === "rfc" || mode === "rfc2822") return DAYS[d.getUTCDay()] + ", " + D + " " + MONTHS[M] + " " + Y + " " + p2(h) + ":" + p2(mi) + ":" + p2(s) + " " + tz;
    return DAYS[d.getUTCDay()] + " " + MONTHS[M] + " " + D + " " + p2(h) + ":" + p2(mi) + ":" + p2(s) + " " + Y + " " + tz;
  }
  // "2 weeks ago", "yesterday", "2026-11-01", "2026-11-01 10:00", "3 days".
  function approxidate(s, now) {
    s = String(s).trim().toLowerCase();
    var m = /^(\d{4})-(\d\d)-(\d\d)(?:[ t](\d\d):(\d\d)(?::(\d\d))?)?/.exec(s);
    if (m) return Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0)) / 1000;
    if (s === "now") return now;
    if (s === "yesterday") return now - 86400;
    if (s === "today" || s === "midnight") { var dd = new Date(now * 1000); return Date.UTC(dd.getUTCFullYear(), dd.getUTCMonth(), dd.getUTCDate()) / 1000; }
    m = /^(\d+|a|an|one|two|three)\s*[. ]?\s*(second|minute|hour|day|week|month|year)s?(\s+ago)?$/.exec(s.replace(/\./g, " "));
    if (m) {
      var n = { a: 1, an: 1, one: 1, two: 2, three: 3 }[m[1]] || +m[1];
      var u = { second: 1, minute: 60, hour: 3600, day: 86400, week: 604800, month: 2592000, year: 31536000 }[m[2]];
      return now - n * u;
    }
    if (/^\d+$/.test(s)) return +s;
    return null;
  }

  /* ================================================================== identities and the clock */
  var PEOPLE = {
    dev: { name: "dev", email: "dev@kestrel.io" },
    maya: { name: "Maya Chen", email: "maya.chen@kestrel.io" },
    ben: { name: "Ben Okoro", email: "ben.okoro@kestrel.io" },
    ana: { name: "Ana Silva", email: "ana.silva@kestrel.io" },
    devp: { name: "Dev Patel", email: "dev.patel@kestrel.io" },
    dana: { name: "Dana Park", email: "dana.park@kestrel.io" },
    leo: { name: "Leo Grant", email: "leo.grant@kestrel.io" },
    kim: { name: "Kim Tran", email: "kim.tran@kestrel.io" },
    ci: { name: "kestrel-bot", email: "bot@kestrel.io" }
  };
  // Every git command moves the clock 30 seconds, so commits made one after another have different times.
  function clock(sys) { return Math.floor(sys.now / 1000) + (sys.gitTick || 0) * 30; }
  function tick(sys) { sys.gitTick = (sys.gitTick || 0) + 1; }

  /* ================================================================== builder: lab setups create repositories with history */
  function when(at) {
    if (typeof at === "number") return at;
    var m = /^(\d{4})-(\d\d)-(\d\d)(?:[ T](\d\d):(\d\d)(?::(\d\d))?)?$/.exec(at || "");
    if (!m) throw new Error("bad date " + at);
    return Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 9), +(m[5] || 0), +(m[6] || 0)) / 1000;
  }
  function person(p) { if (!p) return PEOPLE.dev; if (typeof p === "string") { if (PEOPLE[p]) return PEOPLE[p]; var m = /^(.*?)\s*<([^>]*)>$/.exec(p); return m ? { name: m[1], email: m[2] } : { name: p, email: p.toLowerCase().replace(/\s+/g, ".") + "@kestrel.io" }; } return p; }
  function contentOf(v) { return typeof v === "object" && v !== null ? v.content : v; }
  /*
    build(sys, "/home/dev/kestrel-web", {
      branch: "main",                                   // first branch
      steps: [
        {msg, by: "maya", at: "2026-10-02 10:15", files: {"a.txt": "text", "old.txt": null}, exec: ["run.sh"]},
        {branch: "feature/x", from: "main"},            // create and switch (from defaults to current)
        {checkout: "main"},
        {merge: "feature/x", msg, by, at, files},       // merge commit (files resolve conflicts / extra edits)
        {tag: "v1.0", msg?, by?, at?}                   // annotated if msg
      ],
      head: "main",                                      // what's checked out at the end (default: last branch used)
      work: {"a.txt": "edited"}, stage: {"b.txt": "staged"}   // uncommitted changes, applied last
    })
  */
  function build(sys, top, spec) {
    var uid = spec.uid || 1000, gid = spec.gid || 1000;
    var branch0 = spec.branch || "main";
    var repo = initRepo(sys, top, uid, gid, branch0);
    if (spec.config) Object.keys(spec.config).forEach(function (k) { gwrite(repo, "config", setInConfig(gread(repo, "config"), k, spec.config[k])); });
    var cur = branch0, tips = {}, flat = {}, lastAt = when("2026-10-01 09:00");
    function setTip(b, sha, msg, who) { tips[b] = sha; updateRefRaw(b, sha, msg, who); }
    function updateRefRaw(b, sha, msg, who) {
      var name = "refs/heads/" + b, old = resolveRefName(repo, name).sha;
      gwrite(repo, name, sha + "\n");
      logRef(repo, name, old, sha, msg, who);
      if (b === cur) logRef(repo, "HEAD", old, sha, msg, who);
    }
    (spec.steps || []).forEach(function (st) {
      var at = st.at ? when(st.at) : lastAt + 3600;
      lastAt = at;
      var who = Object.assign({}, person(st.by), { time: at, tz: st.tz || "+0000" });
      if (st.branch !== undefined && !st.msg) {
        var from = st.from ? (tips[st.from] || resolve(repo, st.from)) : tips[cur];
        var prev = cur;
        cur = st.branch;
        tips[cur] = from;
        gwrite(repo, "refs/heads/" + cur, from + "\n");
        logRef(repo, "refs/heads/" + cur, null, from, "branch: Created from " + (st.from || prev), who);
        gwrite(repo, "HEAD", "ref: refs/heads/" + cur + "\n");
        logRef(repo, "HEAD", tips[prev], from, "checkout: moving from " + prev + " to " + cur, who);
        flat = commitFlat(sys, from);
        return;
      }
      if (st.checkout) {
        var prev2 = cur;
        cur = st.checkout;
        gwrite(repo, "HEAD", "ref: refs/heads/" + cur + "\n");
        logRef(repo, "HEAD", tips[prev2], tips[cur], "checkout: moving from " + prev2 + " to " + cur, who);
        flat = commitFlat(sys, tips[cur]);
        return;
      }
      if (st.tag) {
        var target = st.on ? (tips[st.on] || resolve(repo, st.on)) : tips[cur];
        if (st.msg) {
          var tsha = putObject(sys, { type: "tag", object: target, objtype: "commit", tag: st.tag, tagger: who, message: st.msg.replace(/\n?$/, "\n") });
          gwrite(repo, "refs/tags/" + st.tag, tsha + "\n");
        } else gwrite(repo, "refs/tags/" + st.tag, target + "\n");
        return;
      }
      var parents = tips[cur] ? [tips[cur]] : [];
      if (st.merge) {
        var other = tips[st.merge] || resolve(repo, st.merge);
        var bases = mergeBases(sys, tips[cur], other);
        var mr = mergeTrees(sys, commitFlat(sys, bases[0]), commitFlat(sys, tips[cur]), commitFlat(sys, other), ["HEAD", st.merge]);
        flat = mr.entries;
        Object.keys(mr.conflicts).forEach(function (p) { if (!st.files || !(p in st.files)) throw new Error("builder merge conflict in " + p); });
        parents.push(other);
      }
      Object.keys(st.files || {}).forEach(function (p) {
        var v = st.files[p];
        if (v === null) { delete flat[p]; return; }
        var exec = (st.exec || []).indexOf(p) >= 0 || (typeof v === "object" && v.exec);
        flat[p] = { sha: putObject(sys, { type: "blob", content: contentOf(v) }), mode: exec ? "100755" : (flat[p] && flat[p].mode) || "100644" };
      });
      (st.exec || []).forEach(function (p) { if (flat[p]) flat[p].mode = "100755"; });
      var msg = (st.msg || "Update").replace(/\s+$/, "") + "\n";
      var committer = st.committer ? Object.assign({}, person(st.committer), { time: at, tz: st.tz || "+0000" }) : who;
      var sha = putObject(sys, { type: "commit", tree: writeTree(sys, flat), parents: parents, author: who, committer: committer, message: msg });
      var subj = msg.split("\n")[0];
      setTip(cur, sha, st.merge ? "merge " + st.merge + ": Merge made by the 'ort' strategy." : (parents.length ? "commit: " : "commit (initial): ") + subj, committer);
    });
    var hb = spec.head || cur;
    if (spec.detach) { gwrite(repo, "HEAD", resolve(repo, spec.detach) + "\n"); }
    else {
      gwrite(repo, "HEAD", "ref: refs/heads/" + hb + "\n");
      if (hb !== cur && tips[hb]) logRef(repo, "HEAD", tips[cur], tips[hb], "checkout: moving from " + cur + " to " + hb, Object.assign({}, PEOPLE.dev, { time: lastAt + 60 }));
    }
    var h = head(repo);
    var hflat = commitFlat(sys, h.sha);
    var idx = { entries: Object.assign({}, hflat), conflicts: {} };
    Object.keys(hflat).forEach(function (p) { writeWork(repo, p, hflat[p].sha, hflat[p].mode, spec.umask); });
    Object.keys(spec.stage || {}).forEach(function (p) {
      var v = spec.stage[p];
      if (v === null) { delete idx.entries[p]; removeWork(repo, p); return; }
      var sha = putObject(sys, { type: "blob", content: v });
      idx.entries[p] = { sha: sha, mode: (hflat[p] && hflat[p].mode) || "100644" };
      writeWork(repo, p, sha, idx.entries[p].mode, spec.umask);
    });
    writeIndex(repo, idx);
    Object.keys(spec.work || {}).forEach(function (p) {
      var v = spec.work[p];
      if (v === null) { removeWork(repo, p); return; }
      writeWork(repo, p, putObject(sys, { type: "blob", content: v }), "100644", spec.umask);
    });
    Object.keys(db(sys)).forEach(function (sha) { writeLoose(repo, sha); });
    return repo;
  }
  // The files in .git/objects are stand-ins (real ones are zlib-compressed).
  function writeLoose(repo, sha) {
    var dir = gpath(repo, "objects/" + sha.slice(0, 2));
    var d = nodeAt(repo.sys, dir) || ensureDir(repo.sys, dir, repo.uid, repo.gid, 509);
    if (!d.children[sha.slice(2)]) d.children[sha.slice(2)] = S.fileNode("x\u0001(compressed git object " + sha + ")", 292, repo.uid, repo.gid, repo.sys.now);
  }

  /* ================================================================== revisions */
  function RevError(msg) { this.message = msg; }
  function refLookup(repo, name) {
    if (/^[A-Z_]+$/.test(name)) { var r0 = resolveRefName(repo, name); if (r0.sha) return r0.sha; }
    var cands = name.indexOf("refs/") === 0 ? [name] : ["refs/" + name, "refs/tags/" + name, "refs/heads/" + name, "refs/remotes/" + name, "refs/remotes/" + name + "/HEAD"];
    for (var i = 0; i < cands.length; i++) {
      var r = resolveRefName(repo, cands[i]);
      if (r.sha) return r.sha;
    }
    return null;
  }
  function shaPrefix(repo, p) {
    var all = Object.keys(db(repo.sys)).filter(function (s) { return s.indexOf(p) === 0; });
    if (all.length === 1) return all[0];
    if (all.length > 1) {
      var commits = all.filter(function (s) { var o = getObject(repo.sys, s); return o.type === "commit" || o.type === "tag"; });
      if (commits.length === 1) return commits[0];
      throw new RevError("error: short object ID " + p + " is ambiguous");
    }
    return null;
  }
  // Resolve a revision to an object id; throws RevError (message) if it doesn't exist.
  function resolve(repo, spec, opts) {
    opts = opts || {};
    var sys = repo.sys, s = String(spec);
    var colon = s.indexOf(":");
    if (colon >= 0 && !/^[^:]*@\{/.test(s.slice(0, colon + 1))) {
      var revPart = s.slice(0, colon), path = s.slice(colon + 1).replace(/^\.\//, "");
      if (revPart === "") {
        var idx = readIndex(repo), stage = /^([0-3]):(.*)$/.exec(path);
        var e = stage ? (stage[1] === "0" ? idx.entries[stage[2]] : (idx.conflicts[stage[2]] || {})[stage[1]]) : idx.entries[path];
        if (!e) throw new RevError("fatal: path '" + path + "' does not exist (neither on disk nor in the index)");
        return e.sha;
      }
      var c = commitOf(sys, resolve(repo, revPart));
      if (!c) throw new RevError("fatal: invalid object name '" + revPart + "'.");
      if (path === "") return c.tree;
      var f = flatTree(sys, c.tree);
      if (f[path]) return f[path].sha;
      var dirSha = subtree(sys, c.tree, path);
      if (dirSha) return dirSha;
      throw new RevError("fatal: path '" + path + "' does not exist in '" + revPart + "'");
    }
    var m = /^(.*?)((?:[~^]\d*|\^\{\w*\}|@\{[^}]*\})*)$/.exec(s);
    var base = m[1], ops = m[2], sha;
    if (base === "" && /^@\{/.test(ops)) base = "";
    var opRe = /\^\{(\w*)\}|([~^])(\d*)|@\{([^}]*)\}/g, list = [], mm;
    while ((mm = opRe.exec(ops))) list.push({ 3: mm[1], 1: mm[2], 2: mm[3], 4: mm[4] });
    if (list.length && list[0][4] !== undefined) {
      // reflog / previous-branch syntax
      var at = list.shift()[4], refname;
      if (/^-\d+$/.test(at)) {
        var nth = -+at, seen = 0, prevB = null;
        reflog(repo, "HEAD").some(function (e) { var mv = /^checkout: moving from (.+) to (.+)$/.exec(e.msg); if (mv) { seen++; if (seen === nth) { prevB = mv[1]; return true; } } return false; });
        if (!prevB) throw new RevError("fatal: ambiguous argument '" + s + "': unknown revision or path not in the working tree.\nUse '--' to separate paths from revisions, like this:\n'git <command> [<revision>...] -- [<file>...]'");
        sha = resolve(repo, prevB);
      } else {
        if (base === "" || base === "HEAD" || base === "@") refname = base === "" ? (head(repo).ref || "HEAD") : "HEAD";
        else refname = refFull(repo, base);
        if (!refname) throw new RevError("fatal: ambiguous argument '" + s + "': unknown revision or path not in the working tree.\nUse '--' to separate paths from revisions, like this:\n'git <command> [<revision>...] -- [<file>...]'");
        var entries = reflog(repo, refname);
        if (/^\d+$/.test(at)) {
          if (+at >= entries.length) throw new RevError("fatal: log for '" + (base || refname.replace(/^refs\/heads\//, "")) + "' only has " + entries.length + " entries");
          sha = entries[+at].sha;
        } else if (at === "u" || at === "upstream") {
          var br = base === "" || base === "HEAD" ? head(repo).branch : base;
          var up = upstreamOf(repo, br);
          if (!up) throw new RevError("fatal: no upstream configured for branch '" + br + "'");
          sha = refLookup(repo, up);
        } else {
          var t = approxidate(at, clock(sys));
          var hit = entries.filter(function (e) { return e.time <= t; })[0] || entries[entries.length - 1];
          if (!hit) throw new RevError("fatal: log for '" + base + "' is empty");
          sha = hit.sha;
        }
      }
    } else if (base === "" && list.length) {
      throw new RevError("fatal: ambiguous argument '" + s + "': unknown revision or path not in the working tree.");
    } else {
      sha = base === "@" ? head(repo).sha : refLookup(repo, base);
      if (!sha && /^[0-9a-f]{4,40}$/.test(base)) sha = shaPrefix(repo, base);
      if (!sha) {
        if (base === "HEAD" || base === "@") throw new RevError("fatal: ambiguous argument 'HEAD': unknown revision or path not in the working tree.\nUse '--' to separate paths from revisions, like this:\n'git <command> [<revision>...] -- [<file>...]'");
        throw new RevError("fatal: ambiguous argument '" + s + "': unknown revision or path not in the working tree.\nUse '--' to separate paths from revisions, like this:\n'git <command> [<revision>...] -- [<file>...]'");
      }
    }
    list.forEach(function (op) {
      if (op[3] !== undefined) {
        if (op[3] === "commit" || op[3] === "") sha = op[3] === "" ? peel(sys, sha) : (commitOf(sys, sha) ? peel(sys, sha) : null);
        else if (op[3] === "tree") { var cc = commitOf(sys, sha); sha = cc ? cc.tree : sha; }
        if (!sha) throw new RevError("fatal: ambiguous argument '" + s + "'");
        return;
      }
      var n = op[2] === "" ? 1 : +op[2];
      var c = commitOf(sys, sha);
      if (!c) throw new RevError("fatal: ambiguous argument '" + s + "': unknown revision or path not in the working tree.");
      if (op[1] === "^") {
        if (n === 0) { sha = peel(sys, sha); return; }
        if (!c.parents[n - 1]) throw new RevError("fatal: ambiguous argument '" + s + "': unknown revision or path not in the working tree.\nUse '--' to separate paths from revisions, like this:\n'git <command> [<revision>...] -- [<file>...]'");
        sha = c.parents[n - 1];
      } else {
        for (var i = 0; i < n; i++) {
          var cc2 = commitOf(sys, sha);
          if (!cc2 || !cc2.parents[0]) throw new RevError("fatal: ambiguous argument '" + s + "': unknown revision or path not in the working tree.\nUse '--' to separate paths from revisions, like this:\n'git <command> [<revision>...] -- [<file>...]'");
          sha = cc2.parents[0];
        }
      }
    });
    return sha;
  }
  function refFull(repo, name) {
    var c = ["refs/heads/" + name, "refs/remotes/" + name, "refs/tags/" + name, name];
    for (var i = 0; i < c.length; i++) if (resolveRefName(repo, c[i]).sha) return c[i];
    return null;
  }
  function subtree(sys, treeSha, path) {
    var t = getObject(sys, treeSha), parts = path.replace(/\/$/, "").split("/");
    for (var i = 0; i < parts.length; i++) {
      if (!t || t.type !== "tree") return null;
      var e = t.entries.filter(function (x) { return x.name === parts[i]; })[0];
      if (!e) return null;
      if (i === parts.length - 1) return e.mode === "40000" ? e.sha : null;
      t = getObject(sys, e.sha);
    }
    return null;
  }
  function upstreamOf(repo, branch) {
    var remote = configGet(repo.sys, repo, repo.uid, "branch." + branch + ".remote"), merge = configGet(repo.sys, repo, repo.uid, "branch." + branch + ".merge");
    if (!remote || !merge) return null;
    return remote === "." ? merge : "refs/remotes/" + remote + "/" + merge.replace(/^refs\/heads\//, "");
  }
  function abbrev(sha, n) { return sha ? sha.slice(0, n || 7) : ""; }

  var api = {
    utf8: utf8, sha1: sha1, blobSha: blobSha, putObject: putObject, getObject: getObject, objSize: objSize, commitOf: commitOf, peel: peel, flatTree: flatTree, commitFlat: commitFlat, writeTree: writeTree, blobText: blobText,
    nodeAt: nodeAt, ensureDir: ensureDir, putFile: putFile, removePath: removePath, readText: readText, pruneEmptyDirs: pruneEmptyDirs,
    findRepo: findRepo, repoAt: repoAt, gpath: gpath, gread: gread, gwrite: gwrite, gremove: gremove, gexists: gexists, initRepo: initRepo,
    parseConfig: parseConfig, setInConfig: setInConfig, normKey: normKey, splitKey: splitKey, configFiles: configFiles, configAll: configAll, configGet: configGet, configBool: configBool, homeOf: homeOf,
    readRef: readRef, resolveRefName: resolveRefName, head: head, listRefs: listRefs, updateRef: updateRef, setHead: setHead, reflog: reflog, logRef: logRef, zero: zero,
    readIndex: readIndex, writeIndex: writeIndex,
    fileMode: fileMode, nodeContent: nodeContent, workFiles: workFiles, workEntry: workEntry, workEntryNode: workEntryNode, workPath: workPath, writeWork: writeWork, removeWork: removeWork,
    makeIgnorer: makeIgnorer, globToRe: globToRe,
    splitLines: splitLines, myers: myers, hunks: hunks, unifiedBody: unifiedBody, countChanges: countChanges, stripNl: stripNl, merge3: merge3, mergeTrees: mergeTrees, same: same,
    parentsOf: parentsOf, ancestors: ancestors, isAncestor: isAncestor, mergeBases: mergeBases,
    fmtDate: fmtDate, relDate: relDate, approxidate: approxidate, clock: clock, tick: tick, PEOPLE: PEOPLE, person: person, when: when,
    build: build, writeLoose: writeLoose, RevError: RevError, resolve: resolve, refFull: refFull, subtree: subtree, upstreamOf: upstreamOf, abbrev: abbrev
  };
  root.GitCore = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
