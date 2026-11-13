/* sudo learn — a simulated Git, part 2: the commands you type (git status, add, commit, log, diff, branch, switch,
   merge, stash, tag, blame, bisect, ...). Output follows Git 2.43 (the version on Ubuntu 24.04). Messages that real
   Git writes to stderr but that aren't errors ("Switched to branch ...") are printed as normal output here. */
(function (root) {
  "use strict";
  var S = root.ShEngine, G = root.GitCore;
  var VERSION = "2.43.0";

  function Exit(code) { this.code = code; }
  function die(c, msg, code) { c.o.err(msg); throw new Exit(code == null ? 128 : code); }
  function mkOut(io) {
    return {
      line: function (t, col) { if (col && io.tty && io.color) io.color(t + "\n", col); else io.out(t + "\n"); },
      err: function (t) { io.err(t + "\n"); },
      hint: function (t) { var s = t.split("\n").map(function (l) { return "hint: " + l; }).join("\n") + "\n"; if (io.tty && io.color) io.color(s, "yellow"); else io.err(s); }
    };
  }
  function pad(s, n) { s = String(s); while (s.length < n) s += " "; return s; }
  function lpad(s, n) { s = String(s); while (s.length < n) s = " " + s; return s; }
  function plural(n, a, b) { return n + " " + (n === 1 ? a : b); }
  function keys(o) { return Object.keys(o); }
  function subject(msg) { return (msg || "").split("\n")[0]; }
  function body(msg) { var i = (msg || "").indexOf("\n\n"); return i < 0 ? "" : msg.slice(i + 2).replace(/\n+$/, ""); }

  /* ================================================================== option parsing */
  // spec: ["a|all", "m|message=+", "n|max-count=", "date=", "graph"]   (= takes a value, =+ repeatable, =? only --x=value)
  function parseOpts(c, args, spec, usage) {
    var shorts = {}, longs = {}, o = {}, rest = [], paths = null;
    spec.forEach(function (s) {
      var m = /^(?:(\w)\|)?([\w-]*)(=\+|=\?|=)?$/.exec(s);
      var def = { key: m[2] || m[1], val: m[3] || "" };
      if (m[1]) shorts[m[1]] = def;
      if (m[2] && m[2].length === 1 && !m[1]) shorts[m[2]] = def;
      else if (m[2]) longs[m[2]] = def;
    });
    function set(def, v) { if (def.val === "=+") (o[def.key] = o[def.key] || []).push(v); else o[def.key] = v; }
    for (var i = 0; i < args.length; i++) {
      var a = args[i];
      if (a === "--") { paths = args.slice(i + 1); break; }
      if (/^--./.test(a)) {
        var eq = a.indexOf("="), name = eq < 0 ? a.slice(2) : a.slice(2, eq), val = eq < 0 ? undefined : a.slice(eq + 1);
        var def = longs[name];
        if (!def && /^no-/.test(name) && longs[name.slice(3)] && !longs[name.slice(3)].val) { o[longs[name.slice(3)].key] = false; continue; }
        if (!def) { var hits = keys(longs).filter(function (k) { return k.indexOf(name) === 0; }); if (hits.length === 1) def = longs[hits[0]]; }
        if (!def) { c.o.err("error: unknown option `" + name + "'"); if (usage) c.o.err("usage: " + usage); throw new Exit(129); }
        if (def.val === "=?") { set(def, val === undefined ? true : val); continue; }
        if (def.val) {
          if (val === undefined) { if (i + 1 >= args.length) { c.o.err("error: option `" + name + "' requires a value"); throw new Exit(129); } val = args[++i]; }
          set(def, val);
        } else o[def.key] = true;
        continue;
      }
      if (/^-[^-]/.test(a) && !/^-\d+$/.test(a)) {
        for (var j = 1; j < a.length; j++) {
          var ch = a.charAt(j), d2 = shorts[ch];
          if (!d2) { c.o.err("error: unknown switch `" + ch + "'"); if (usage) c.o.err("usage: " + usage); throw new Exit(129); }
          if (d2.val && d2.val !== "=?") {
            var v = a.slice(j + 1);
            if (v === "") { if (i + 1 >= args.length) { c.o.err("error: switch `" + ch + "' requires a value"); throw new Exit(129); } v = args[++i]; }
            set(d2, v); break;
          }
          o[d2.key] = d2.val === "=?" ? true : true;
        }
        continue;
      }
      if (/^-\d+$/.test(a) && longs["max-count"]) { o["max-count"] = a.slice(1); continue; }
      rest.push(a);
    }
    return { o: o, rest: rest, paths: paths };
  }

  /* ================================================================== context helpers */
  function cfg(c, key) { return G.configGet(c.sys, c.repo, c.uid, key, c.cfgExtra); }
  function needRepo(c) {
    if (!c.repo) die(c, "fatal: not a git repository (or any of the parent directories): .git");
    return c.repo;
  }
  function needWork(c) { needRepo(c); }
  function cwdRel(c) {
    var top = c.repo.top;
    if (c.cwd === top) return "";
    if (c.cwd.indexOf(top === "/" ? "/" : top + "/") === 0) return c.cwd.slice(top === "/" ? 1 : top.length + 1);
    return null;
  }
  // Path as typed -> path relative to the top of the repository (or null if outside).
  function toRel(c, p) {
    var abs = S.normAbs(p.charAt(0) === "/" ? p : (c.cwd === "/" ? "" : c.cwd) + "/" + p);
    var top = c.repo.top;
    if (abs === top) return "";
    if (abs.indexOf(top === "/" ? "/" : top + "/") === 0) return abs.slice(top === "/" ? 1 : top.length + 1);
    return null;
  }
  function relOrDie(c, p) {
    var r = toRel(c, p);
    if (r === null) die(c, "fatal: " + p + ": '" + p + "' is outside repository at '" + c.repo.top + "'");
    return r;
  }
  // Show a top-relative path relative to the current folder.
  function showPath(c, rel) {
    var pre = cwdRel(c);
    if (!pre) return rel;
    if (rel === pre) return ".";
    if (rel.indexOf(pre + "/") === 0) return rel.slice(pre.length + 1);
    var a = pre.split("/"), b = rel.split("/"), i = 0;
    while (i < a.length && i < b.length - 1 && a[i] === b[i]) i++;
    var up = []; for (var k = i; k < a.length; k++) up.push("..");
    return up.concat(b.slice(i)).join("/");
  }
  function hasGlob(p) { return /[*?[]/.test(p); }
  // A pathspec matcher for top-relative paths. specs are as typed (relative to cwd).
  function matcher(c, specs) {
    var list = specs.map(function (s) {
      if (s === ":/" || s === ":/:") return { all: true };
      var top = /^:\/(.*)$/.exec(s);
      var rel = top ? top[1] : toRel(c, s.replace(/\/$/, ""));
      if (rel === null) die(c, "fatal: " + s + ": '" + s + "' is outside repository at '" + c.repo.top + "'");
      if (hasGlob(s)) {
        var pre = cwdRel(c), pat = top ? top[1] : (pre ? pre + "/" : "") + s;
        return { re: new RegExp("^" + G.globToRe(pat).replace(/\[\^\/\]\*/g, ".*").replace(/\[\^\/\]/g, ".") + "(/.*)?$"), spec: s };
      }
      return { rel: rel, spec: s };
    });
    function test(p) {
      return list.some(function (m) { return m.all || (m.re ? m.re.test(p) : m.rel === "" || p === m.rel || p.indexOf(m.rel + "/") === 0); });
    }
    test.list = list;
    test.hit = function (p, m) { return m.all || (m.re ? m.re.test(p) : m.rel === "" || p === m.rel || p.indexOf(m.rel + "/") === 0); };
    return test;
  }
  function ident(c, kind) {
    var env = kind === "author" ? ["GIT_AUTHOR_NAME", "GIT_AUTHOR_EMAIL"] : ["GIT_COMMITTER_NAME", "GIT_COMMITTER_EMAIL"];
    var name = S.getVar(c.sess, env[0]) || cfg(c, "user.name"), email = S.getVar(c.sess, env[1]) || cfg(c, "user.email");
    if (!name && email) { var u = S.userById(c.sys, c.uid); name = u && u.gecos ? u.gecos.split(",")[0] || u.name : c.sess.user; }
    if (!name || !email) {
      c.o.err("Author identity unknown\n\n*** Please tell me who you are.\n\nRun\n\n  git config --global user.email \"you@example.com\"\n  git config --global user.name \"Your Name\"\n\nto set your account's default identity.\nOmit --global to set the identity only in this repository.\n");
      die(c, "fatal: unable to auto-detect email address (got '" + c.sess.user + "@" + c.sys.host + ".(none)')");
    }
    return { name: name, email: email, time: G.clock(c.sys), tz: "+0000" };
  }
  function softIdent(c) {
    var name = cfg(c, "user.name") || c.sess.user, email = cfg(c, "user.email") || c.sess.user + "@" + c.sys.host;
    return { name: name, email: email, time: G.clock(c.sys), tz: "+0000" };
  }
  function rev(c, spec) {
    try { return G.resolve(c.repo, spec); }
    catch (e) { if (e instanceof G.RevError) die(c, e.message); throw e; }
  }
  function tryRev(c, spec) { try { return G.resolve(c.repo, spec); } catch (e) { if (e instanceof G.RevError) return null; throw e; } }
  function commitRev(c, spec) {
    var sha = rev(c, spec), co = G.commitOf(c.sys, sha);
    if (!co) die(c, "fatal: " + spec + ": not a commit"); // rarely reached
    return G.peel(c.sys, sha);
  }
  function short(sha) { return G.abbrev(sha, 7); }
  function storeObjects(c) { var repo = c.repo; keys(c.sys.gitObjects || {}).forEach(function (s) { G.writeLoose(repo, s); }); }
  function headFlat(c) { var h = G.head(c.repo); return G.commitFlat(c.sys, h.sha); }
  function umask(c) { return c.sess.umask == null ? 2 : c.sess.umask; }

  /* ================================================================== status */
  function ignorer(c) {
    var ex = cfg(c, "core.excludesfile"), path = null;
    if (ex) path = ex.replace(/^~(?=\/)/, G.homeOf(c.sys, c.uid));
    else { var dflt = G.homeOf(c.sys, c.uid) + "/.config/git/ignore"; if (G.readText(c.sys, dflt) !== null) path = dflt; }
    return G.makeIgnorer(c.repo, path);
  }
  function computeStatus(c) {
    var repo = c.repo, h = G.head(repo), hf = G.commitFlat(c.sys, h.sha), idx = G.readIndex(repo), work = G.workFiles(repo), ign = ignorer(c);
    var st = { head: h, headFlat: hf, idx: idx, work: work, ign: ign, staged: [], unstaged: [], untracked: [], ignored: [], unmerged: [] };
    var all = {};
    keys(hf).forEach(function (p) { all[p] = 1; });
    keys(idx.entries).forEach(function (p) { all[p] = 1; });
    keys(idx.conflicts).forEach(function (p) { all[p] = 1; });
    var added = [], deleted = [];
    keys(all).sort().forEach(function (p) {
      if (idx.conflicts[p]) return;
      var a = hf[p], b = idx.entries[p];
      if (G.same(a, b)) return;
      if (!a) added.push(p); else if (!b) deleted.push(p); else st.staged.push({ type: (a.mode === "120000") !== (b.mode === "120000") ? "typechange" : "modified", path: p, mode: a.mode !== b.mode });
    });
    // exact renames
    deleted.slice().forEach(function (d) {
      var hit = added.filter(function (a) { return idx.entries[a].sha === hf[d].sha; })[0];
      if (hit) { added.splice(added.indexOf(hit), 1); deleted.splice(deleted.indexOf(d), 1); st.staged.push({ type: "renamed", path: hit, from: d }); }
    });
    added.forEach(function (p) { st.staged.push({ type: "new file", path: p }); });
    deleted.forEach(function (p) { st.staged.push({ type: "deleted", path: p }); });
    st.staged.sort(function (x, y) { return x.path < y.path ? -1 : 1; });
    keys(idx.entries).sort().forEach(function (p) {
      var w = work[p];
      if (!w) { st.unstaged.push({ type: "deleted", path: p }); return; }
      var we = G.workEntryNode(w), ie = idx.entries[p];
      if (we.sha !== ie.sha || (we.mode !== ie.mode && G.configBool(cfg(c, "core.filemode"), true))) st.unstaged.push({ type: "modified", path: p });
    });
    keys(idx.conflicts).sort().forEach(function (p) {
      var x = idx.conflicts[p], k = (x[1] ? "1" : "") + (x[2] ? "2" : "") + (x[3] ? "3" : "");
      st.unmerged.push({ path: p, type: { "123": "both modified", "23": "both added", "12": "deleted by them", "13": "deleted by us", "2": "added by us", "3": "added by them" }[k] || "both modified", code: { "123": "UU", "23": "AA", "12": "UD", "13": "DU", "2": "AU", "3": "UA" }[k] || "UU" });
    });
    keys(work).sort().forEach(function (p) {
      if (idx.entries[p] || idx.conflicts[p]) return;
      if (ign.ignored(p, false)) st.ignored.push(p); else st.untracked.push(p);
    });
    return st;
  }
  // Collapse untracked files into their top-most untracked folder ("logs/").
  function collapse(c, st, files) {
    var tracked = {};
    keys(st.idx.entries).concat(keys(st.idx.conflicts)).forEach(function (p) { var parts = p.split("/"); for (var i = 1; i < parts.length; i++) tracked[parts.slice(0, i).join("/")] = 1; });
    var out = [], seen = {};
    files.forEach(function (f) {
      var parts = f.split("/"), shown = f;
      for (var i = 1; i < parts.length; i++) { var d = parts.slice(0, i).join("/"); if (!tracked[d]) { shown = d + "/"; break; } }
      if (!seen[shown]) { seen[shown] = 1; out.push(shown); }
    });
    return out;
  }
  function collapseIgnored(c, st) {
    var out = [], seen = {};
    st.ignored.forEach(function (f) {
      var parts = f.split("/"), shown = f;
      for (var i = 1; i < parts.length; i++) { var d = parts.slice(0, i).join("/"); if (st.ign.ignored(d, true)) { shown = d + "/"; break; } }
      if (!seen[shown]) { seen[shown] = 1; out.push(shown); }
    });
    return out;
  }
  function stateLines(c) {
    var repo = c.repo, L = [];
    if (G.gexists(repo, "MERGE_HEAD")) {
      var st = G.readIndex(repo);
      if (keys(st.conflicts).length) L.push("You have unmerged paths.", "  (fix conflicts and run \"git commit\")", "  (use \"git merge --abort\" to abort the merge)");
      else L.push("All conflicts fixed but you are still merging.", "  (use \"git commit\" to conclude merge)");
    } else if (G.gexists(repo, "REVERT_HEAD")) {
      var rv = G.gread(repo, "REVERT_HEAD").trim(), st2 = G.readIndex(repo);
      L.push("You are currently reverting commit " + short(rv) + ".");
      if (keys(st2.conflicts).length) L.push("  (fix conflicts and run \"git revert --continue\")"); else L.push("  (all conflicts fixed: run \"git revert --continue\")");
      L.push("  (use \"git revert --skip\" to skip this patch)", "  (use \"git revert --abort\" to cancel the revert operation)");
    } else if (G.gexists(repo, "CHERRY_PICK_HEAD")) {
      var cp = G.gread(repo, "CHERRY_PICK_HEAD").trim(), st3 = G.readIndex(repo);
      L.push("You are currently cherry-picking commit " + short(cp) + ".");
      if (keys(st3.conflicts).length) L.push("  (fix conflicts and run \"git cherry-pick --continue\")"); else L.push("  (all conflicts fixed: run \"git cherry-pick --continue\")");
      L.push("  (use \"git cherry-pick --skip\" to skip this patch)", "  (use \"git cherry-pick --abort\" to cancel the cherry-pick operation)");
    }
    var rb = rebaseDir(repo);
    if (rb) {
      var done = (G.gread(repo, rb + "/done") || "").split("\n").filter(function (l) { return l.trim() && !/^#/.test(l); });
      var todo = (G.gread(repo, rb + "/git-rebase-todo") || "").split("\n").filter(function (l) { return l.trim() && !/^#/.test(l); });
      if (done.length) L.push("Last command" + (done.length > 1 ? "s" : "") + " done (" + plural(done.length, "command", "commands") + " done):", done.slice(-2).map(function (l) { return "   " + l; }).join("\n"));
      if (todo.length) L.push("Next command" + (todo.length > 1 ? "s" : "") + " to do (" + plural(todo.length, "remaining command", "remaining commands") + "):", todo.slice(0, 2).map(function (l) { return "   " + l; }).join("\n"), "  (use \"git rebase --edit-todo\" to view and edit)");
      else L.push("No commands remaining.");
      var bname = (G.gread(repo, rb + "/head-name") || "").trim().replace(/^refs\/heads\//, ""), onto = short((G.gread(repo, rb + "/onto") || "").trim());
      var stR = G.readIndex(repo);
      if (G.gexists(repo, rb + "/amend") && !keys(stR.conflicts).length) L.push("You are currently editing a commit while rebasing branch '" + bname + "' on '" + onto + "'.", "  (use \"git commit --amend\" to amend the current commit)", "  (use \"git rebase --continue\" once you are satisfied with your changes)");
      else {
        L.push("You are currently rebasing branch '" + bname + "' on '" + onto + "'.");
        if (keys(stR.conflicts).length) L.push("  (fix conflicts and then run \"git rebase --continue\")"); else L.push("  (all conflicts fixed: run \"git rebase --continue\")");
        L.push("  (use \"git rebase --skip\" to skip this patch)", "  (use \"git rebase --abort\" to check out the original branch)");
      }
    }
    if (G.gexists(repo, "BISECT_START")) L.push("You are currently bisecting, started from branch '" + G.gread(repo, "BISECT_START").trim() + "'.", "  (use \"git bisect reset\" to get back to the original branch)");
    return L;
  }
  function trackingLines(c, h) {
    if (!h.branch || h.detached) return [];
    var up = G.upstreamOf(c.repo, h.branch);
    if (!up) return [];
    var upName = up.replace(/^refs\/remotes\//, "").replace(/^refs\/heads\//, "");
    var upSha = G.resolveRefName(c.repo, up).sha;
    if (!upSha) return ["Your branch is based on '" + upName + "', but the upstream is gone.", "  (use \"git branch --unset-upstream\" to fixup)"];
    var ab = aheadBehind(c, h.sha, upSha);
    if (!ab.ahead && !ab.behind) return ["Your branch is up to date with '" + upName + "'."];
    if (ab.ahead && !ab.behind) return ["Your branch is ahead of '" + upName + "' by " + plural(ab.ahead, "commit", "commits") + ".", "  (use \"git push\" to publish your local commits)"];
    if (!ab.ahead) return ["Your branch is behind '" + upName + "' by " + plural(ab.behind, "commit", "commits") + ", and can be fast-forwarded.", "  (use \"git pull\" to update your local branch)"];
    return ["Your branch and '" + upName + "' have diverged,", "and have " + ab.ahead + " and " + ab.behind + " different commits each, respectively.", "  (use \"git pull\" if you want to integrate the remote branch with yours)"];
  }
  function aheadBehind(c, a, b) {
    var A = a ? G.ancestors(c.sys, a) : {}, B = b ? G.ancestors(c.sys, b) : {};
    return { ahead: keys(A).filter(function (x) { return !B[x]; }).length, behind: keys(B).filter(function (x) { return !A[x]; }).length };
  }
  function rebaseDir(repo) { return G.gexists(repo, "rebase-merge/head-name") ? "rebase-merge" : null; }
  function headLine(c, h) {
    var rb = rebaseDir(c.repo);
    if (rb && h.detached) return (G.gexists(c.repo, rb + "/interactive") ? "interactive rebase" : "rebase") + " in progress; onto " + short(G.gread(c.repo, rb + "/onto").trim());
    if (!h.detached) return "On branch " + h.branch;
    if (G.gexists(c.repo, "BISECT_START")) return "HEAD detached at " + short(h.sha);
    // "detached at" if HEAD still points where it was detached, otherwise "detached from"
    var from = null, at = true;
    G.reflog(c.repo, "HEAD").some(function (e) {
      var m = /^checkout: moving from .+ to (.+)$/.exec(e.msg);
      if (m) { from = m[1]; return true; }
      if (/^(commit|reset|merge|cherry-pick|revert)/.test(e.msg)) at = false;
      return false;
    });
    if (from && /^[0-9a-f]{40}$/.test(from)) from = short(from);
    var label = from && tryRev(c, from) === h.sha ? from : short(h.sha);
    return at ? "HEAD detached at " + label : "HEAD detached from " + (from || short(h.sha));
  }
  function printLongStatus(c, st, opts) {
    opts = opts || {};
    var o = c.o, h = st.head, out = [];
    out.push([headLine(c, h)]);
    var track = trackingLines(c, h);
    track.forEach(function (l) { out.push([l]); });
    var state = stateLines(c);
    var hasHeader = track.length > 0;
    if (state.length) { if (track.length) out.push([""]); state.forEach(function (l) { out.push([l]); }); hasHeader = true; }
    if (!h.sha) { out.push([""]); out.push(["No commits yet"]); hasHeader = true; }
    var sections = 0;
    function section(title, hints, rows, col) {
      if (!rows.length) return;
      out.push([""]); out.push([title]); hints.forEach(function (x) { out.push([x]); });
      rows.forEach(function (r) { out.push([r, col]); });
      sections++;
    }
    var fmt = function (t, p) { return "\t" + pad(t + ":", 12) + p; };
    section("Changes to be committed:", [h.sha ? "  (use \"git restore --staged <file>...\" to unstage)" : "  (use \"git rm --cached <file>...\" to unstage)"],
      st.staged.map(function (x) { return x.type === "renamed" ? fmt("renamed", showPath(c, x.from) + " -> " + showPath(c, x.path)) : fmt(x.type, showPath(c, x.path)); }), "green");
    section("Unmerged paths:", ["  (use \"git add <file>...\" to mark resolution)"], st.unmerged.map(function (x) { return "\t" + pad(x.type + ":", 17) + showPath(c, x.path); }), "red");
    var hasDel = st.unstaged.some(function (x) { return x.type === "deleted"; });
    section("Changes not staged for commit:", [hasDel ? "  (use \"git add/rm <file>...\" to update what will be committed)" : "  (use \"git add <file>...\" to update what will be committed)", "  (use \"git restore <file>...\" to discard changes in working directory)"],
      st.unstaged.map(function (x) { return fmt(x.type, showPath(c, x.path)); }), "red");
    var unt = opts.untrackedAll ? st.untracked : collapse(c, st, st.untracked);
    if (opts.untracked !== "no") section("Untracked files:", ["  (use \"git add <file>...\" to include in what will be committed)"], unt.map(function (p) { return "\t" + showPath(c, p); }), "red");
    if (opts.ignored) section("Ignored files:", ["  (use \"git add -f <file>...\" to include in what will be committed)"], collapseIgnored(c, st).map(function (p) { return "\t" + showPath(c, p); }), "red");
    var tail = null;
    if (!st.staged.length) {
      if (st.unstaged.length || st.unmerged.length) tail = "no changes added to commit (use \"git add\" and/or \"git commit -a\")";
      else if (unt.length && opts.untracked !== "no") tail = "nothing added to commit but untracked files present (use \"git add\" to track)";
      else if (!h.sha) tail = "nothing to commit (create/copy files and use \"git add\" to track)";
      else tail = "nothing to commit, working tree clean";
    }
    if (tail) { if (sections || hasHeader) out.push([""]); out.push([tail]); }
    else if (sections) { /* git ends after the last section */ }
    out.forEach(function (l) { o.line(l[0], l[1]); });
  }
  function shortStatus(c, st, opts) {
    var o = c.o, h = st.head;
    if (opts.branch) {
      var line = "## ";
      if (!h.sha) line += "No commits yet on " + h.branch;
      else if (h.detached) line += "HEAD (no branch)";
      else {
        line += h.branch;
        var up = G.upstreamOf(c.repo, h.branch);
        if (up) {
          var upSha = G.resolveRefName(c.repo, up).sha, upName = up.replace(/^refs\/remotes\//, "");
          line += "..." + upName;
          if (!upSha) line += " [gone]";
          else { var ab = aheadBehind(c, h.sha, upSha); if (ab.ahead || ab.behind) line += " [" + [ab.ahead ? "ahead " + ab.ahead : "", ab.behind ? "behind " + ab.behind : ""].filter(Boolean).join(", ") + "]"; }
        }
      }
      o.line(line, "green");
    }
    var rows = {};
    function r(p) { return rows[p] || (rows[p] = { x: " ", y: " ", path: p }); }
    st.staged.forEach(function (x) { var e = r(x.path); e.x = { "new file": "A", modified: "M", deleted: "D", renamed: "R", typechange: "T" }[x.type]; if (x.from) e.from = x.from; });
    st.unstaged.forEach(function (x) { r(x.path).y = x.type === "deleted" ? "D" : "M"; });
    st.unmerged.forEach(function (x) { var e = r(x.path); e.x = x.code[0]; e.y = x.code[1]; });
    keys(rows).sort().forEach(function (p) { var e = rows[p]; o.line(e.x + e.y + " " + (e.from ? showPath(c, e.from) + " -> " : "") + showPath(c, p), e.y !== " " ? "red" : "green"); });
    if (opts.untracked !== "no") (opts.untrackedAll ? st.untracked : collapse(c, st, st.untracked)).forEach(function (p) { o.line("?? " + showPath(c, p), "red"); });
    if (opts.ignored) collapseIgnored(c, st).forEach(function (p) { o.line("!! " + showPath(c, p), "red"); });
  }
  function cmdStatus(c, args) {
    needWork(c);
    var p = parseOpts(c, args, ["s|short", "b|branch", "porcelain=?", "long", "u|untracked-files=?", "ignored=?", "v|verbose"], "git status [<options>] [--] [<pathspec>...]");
    var st = computeStatus(c);
    var specs = p.rest.concat(p.paths || []);
    if (specs.length) {
      var m = matcher(c, specs);
      ["staged", "unstaged", "unmerged"].forEach(function (k) { st[k] = st[k].filter(function (x) { return m(x.path) || (x.from && m(x.from)); }); });
      st.untracked = st.untracked.filter(m); st.ignored = st.ignored.filter(m);
    }
    var u = p.o["untracked-files"], opts = { untracked: u === "no" ? "no" : "normal", untrackedAll: u === true || u === "all", ignored: !!p.o.ignored, branch: !!p.o.branch };
    if (p.o.short || p.o.porcelain) shortStatus(c, st, opts);
    else printLongStatus(c, st, opts);
    return 0;
  }

  /* ================================================================== add / rm / mv */
  function cmdAdd(c, args) {
    needWork(c);
    var p = parseOpts(c, args, ["A|all", "u|update", "f|force", "n|dry-run", "v|verbose", "p|patch", "i|interactive", "N|intent-to-add", "ignore-errors", "q|quiet"], "git add [<options>] [--] <pathspec>...");
    if (p.o.patch || p.o.interactive) die(c, "(git add -p asks about each change interactively, which this lab's terminal can't do. Stage whole files with git add <file>.)", 1);
    var specs = p.rest.concat(p.paths || []);
    if (!specs.length && !p.o.all && !p.o.update) {
      c.o.line("Nothing specified, nothing added.");
      c.o.hint("Maybe you wanted to say 'git add .'?\nTurn this message off by running\n\"git config advice.addEmptyPathspec false\"");
      return 0;
    }
    if (!specs.length) specs = [":/"];
    var st = computeStatus(c), idx = st.idx, work = st.work, ign = st.ign;
    var m = matcher(c, specs);
    // every pathspec must match something (in the working tree or the index)
    var cand = {};
    keys(work).forEach(function (k) { cand[k] = 1; }); keys(idx.entries).forEach(function (k) { cand[k] = 1; }); keys(idx.conflicts).forEach(function (k) { cand[k] = 1; });
    m.list.forEach(function (one) {
      if (one.all || one.rel === "") return;
      var any = keys(cand).some(function (k) { return m.hit(k, one); });
      if (!any) die(c, "fatal: pathspec '" + one.spec + "' did not match any files");
    });
    var ignoredNamed = [], changed = 0;
    keys(cand).sort().forEach(function (k) {
      if (!m(k)) return;
      var tracked = !!idx.entries[k] || !!idx.conflicts[k];
      if (p.o.update && !tracked) return;
      var w = work[k];
      if (!tracked && w && !p.o.force && ign.ignored(k, false)) {
        var explicit = m.list.some(function (one) { return !one.re && one.rel === k; }) || m.list.some(function (one) { return !one.re && one.rel && ign.ignored(one.rel, true) && k.indexOf(one.rel + "/") === 0; });
        if (explicit) ignoredNamed.push(m.list.filter(function (one) { return one.rel === k; }).length ? k : m.list.filter(function (one) { return one.rel && k.indexOf(one.rel + "/") === 0; })[0].rel);
        return;
      }
      if (w) {
        var we = G.workEntryNode(w);
        var before = idx.entries[k];
        if (!G.same(before, we) || idx.conflicts[k]) {
          if (!p.o["dry-run"]) { G.putObject(c.sys, { type: "blob", content: G.nodeContent(w) }); idx.entries[k] = { sha: we.sha, mode: we.mode }; delete idx.conflicts[k]; }
          if (p.o.verbose || p.o["dry-run"]) c.o.line("add '" + showPath(c, k) + "'");
          changed++;
        }
      } else if (tracked) {
        if (!p.o["dry-run"]) { delete idx.entries[k]; delete idx.conflicts[k]; }
        if (p.o.verbose || p.o["dry-run"]) c.o.line("remove '" + showPath(c, k) + "'");
        changed++;
      }
    });
    if (!p.o["dry-run"]) { G.writeIndex(c.repo, idx); storeObjects(c); }
    if (ignoredNamed.length) {
      c.o.err("The following paths are ignored by one of your .gitignore files:");
      ignoredNamed.filter(function (x, i) { return ignoredNamed.indexOf(x) === i; }).forEach(function (x) { c.o.err(showPath(c, x)); });
      c.o.hint("Use -f if you really want to add them.\nTurn this message off by running\n\"git config advice.addIgnoredFile false\"");
      return 1;
    }
    return 0;
  }
  // git update-index --chmod=+x FILE: set the executable bit in the index (the file on disk is untouched)
  function cmdUpdateIndex(c, args) {
    needWork(c);
    var chmod = null, files = [];
    args.forEach(function (x) { var m = /^--chmod=([+-])x$/.exec(x); if (m) chmod = m[1]; else if (x === "--add" || x === "--refresh" || x === "-q" || x === "--") return; else if (/^-/.test(x)) die(c, "error: unknown option '" + x.replace(/^-+/, "") + "'\nusage: git update-index [<options>] [--] [<file>...]", 129); else files.push(x); });
    if (!chmod) { if (args.indexOf("--refresh") >= 0) return 0; die(c, "usage: git update-index [<options>] [--] [<file>...]\n\n    --chmod (+|-)x        override the executable bit of the listed files", 129); }
    var idx = G.readIndex(c.repo);
    files.forEach(function (f) { var rel = relOrDie(c, f); if (!idx.entries[rel]) die(c, "error: " + f + ": cannot add to the index - missing --add option?\nfatal: Unable to process path " + f, 128); });
    files.forEach(function (f) { var rel = toRel(c, f), e = idx.entries[rel]; if (e.mode !== "120000") idx.entries[rel] = Object.assign({}, e, { mode: chmod === "+" ? "100755" : "100644" }); });
    G.writeIndex(c.repo, idx);
    return 0;
  }
  function cmdRm(c, args) {
    needWork(c);
    var p = parseOpts(c, args, ["cached", "f|force", "r", "n|dry-run", "q|quiet", "ignore-unmatch"], "git rm [-f | --force] [-n] [-r] [--cached] [--ignore-unmatch] [--quiet] [--] <file>...");
    var specs = p.rest.concat(p.paths || []);
    if (!specs.length) { c.o.err("usage: git rm [-f | --force] [-n] [-r] [--cached] [--ignore-unmatch]\n              [--quiet] [--pathspec-from-file=<file> [--pathspec-file-nul]]\n              [--] [<pathspec>...]"); return 129; }
    var st = computeStatus(c), idx = st.idx, work = st.work, hf = st.headFlat;
    var m = matcher(c, specs), targets = [];
    m.list.forEach(function (one) {
      var hits = keys(idx.entries).concat(keys(idx.conflicts)).filter(function (k) { return m.hit(k, one); });
      if (!hits.length) { if (p.o["ignore-unmatch"]) return; die(c, "fatal: pathspec '" + one.spec + "' did not match any files"); }
      if (!one.re && hits.some(function (k) { return k !== one.rel; }) && !p.o.r) die(c, "fatal: not removing '" + one.spec + "' recursively without -r");
      hits.forEach(function (k) { if (targets.indexOf(k) < 0) targets.push(k); });
    });
    targets.sort();
    if (!p.o.force) {
      var staged = [], local = [], both = [];
      targets.forEach(function (k) {
        var ie = idx.entries[k], w = work[k], we = w ? G.workEntryNode(w) : null;
        var idxDiff = !G.same(ie, hf[k]) && hf[k], workDiff = w && !G.same(we, ie);
        if (p.o.cached) { if (idxDiff && workDiff) both.push(k); return; }
        if (idxDiff && workDiff) both.push(k);
        else if (workDiff) local.push(k);
        else if (idxDiff || (!hf[k] && ie)) staged.push(k);
      });
      var msgs = [];
      if (both.length) msgs.push("error: the following file" + (both.length > 1 ? "s have" : " has") + " staged content different from both the\nfile and the HEAD:\n" + both.map(function (k) { return "    " + showPath(c, k); }).join("\n") + "\n(use -f to force removal)");
      if (staged.length && !p.o.cached) msgs.push("error: the following file" + (staged.length > 1 ? "s have" : " has") + " changes staged in the index:\n" + staged.map(function (k) { return "    " + showPath(c, k); }).join("\n") + "\n(use --cached to keep the file, or -f to force removal)");
      if (local.length) msgs.push("error: the following file" + (local.length > 1 ? "s have" : " has") + " local modifications:\n" + local.map(function (k) { return "    " + showPath(c, k); }).join("\n") + "\n(use --cached to keep the file, or -f to force removal)");
      if (msgs.length) { c.o.err(msgs.join("\n")); return 1; }
    }
    targets.forEach(function (k) {
      if (!p.o.quiet) c.o.line("rm '" + k + "'");
      if (p.o["dry-run"]) return;
      delete idx.entries[k]; delete idx.conflicts[k];
      if (!p.o.cached && work[k]) G.removeWork(c.repo, k);
    });
    if (!p.o["dry-run"]) G.writeIndex(c.repo, idx);
    return 0;
  }
  function cmdMv(c, args) {
    needWork(c);
    var p = parseOpts(c, args, ["f|force", "n|dry-run", "k", "v|verbose"], "git mv [<options>] <source>... <destination>");
    var a = p.rest.concat(p.paths || []);
    if (a.length < 2) { c.o.err("usage: git mv [<options>] <source>... <destination>"); return 129; }
    var idx = G.readIndex(c.repo), dstSpec = a.pop(), dst = relOrDie(c, dstSpec);
    var dstNode = G.nodeAt(c.sys, G.workPath(c.repo, dst));
    var dstIsDir = dstNode && dstNode.type === "d";
    if (a.length > 1 && !dstIsDir) die(c, "fatal: destination '" + dstSpec + "' is not a directory");
    var moves = [];
    a.forEach(function (sSpec) {
      var src = relOrDie(c, sSpec.replace(/\/$/, ""));
      var target = dstIsDir ? (dst ? dst + "/" : "") + src.split("/").pop() : dst;
      var srcNode = G.nodeAt(c.sys, G.workPath(c.repo, src));
      if (!srcNode) die(c, "fatal: bad source, source=" + sSpec + ", destination=" + dstSpec);
      var under = keys(idx.entries).filter(function (k) { return k === src || k.indexOf(src + "/") === 0; });
      if (!under.length) die(c, "fatal: not under version control, source=" + sSpec + ", destination=" + dstSpec);
      if (G.nodeAt(c.sys, G.workPath(c.repo, target)) && !p.o.force) die(c, "fatal: destination exists, source=" + sSpec + ", destination=" + dstSpec);
      moves.push({ src: src, dst: target, files: under, node: srcNode });
    });
    if (p.o["dry-run"]) { moves.forEach(function (mv) { c.o.line("Checking rename of '" + mv.src + "' to '" + mv.dst + "'"); c.o.line("Renaming " + mv.src + " to " + mv.dst); }); return 0; }
    moves.forEach(function (mv) {
      var srcAbs = G.workPath(c.repo, mv.src), dstAbs = G.workPath(c.repo, mv.dst);
      var sp = G.nodeAt(c.sys, srcAbs.slice(0, srcAbs.lastIndexOf("/")) || "/"), dp = G.ensureDir(c.sys, dstAbs.slice(0, dstAbs.lastIndexOf("/")) || "/", c.repo.uid, c.repo.gid);
      delete sp.children[srcAbs.slice(srcAbs.lastIndexOf("/") + 1)];
      dp.children[dstAbs.slice(dstAbs.lastIndexOf("/") + 1)] = mv.node;
      mv.files.forEach(function (k) { var nk = mv.dst + k.slice(mv.src.length); idx.entries[nk] = idx.entries[k]; delete idx.entries[k]; if (p.o.verbose) c.o.line("Renaming " + k + " to " + nk); });
    });
    G.writeIndex(c.repo, idx);
    return 0;
  }

  /* ================================================================== diffs */
  // Compare two flat maps (null side = working tree view supplied in b with .text). Returns file changes.
  function changes(c, A, B, m, opts) {
    opts = opts || {};
    var all = {};
    keys(A).forEach(function (p) { all[p] = 1; }); keys(B).forEach(function (p) { all[p] = 1; });
    var out = [];
    keys(all).sort().forEach(function (p) {
      if (m && !m(p)) return;
      var a = A[p], b = B[p];
      if (G.same(a, b)) return;
      out.push({ path: p, a: a || null, b: b || null });
    });
    if (opts.renames !== false) {
      var adds = out.filter(function (x) { return !x.a; }), dels = out.filter(function (x) { return !x.b; });
      dels.forEach(function (d) {
        var hit = adds.filter(function (x) { return x.b.sha === d.a.sha && !x.used; })[0];
        if (!hit) return;
        hit.used = true;
        hit.a = d.a; hit.from = d.path; hit.rename = true;
        out.splice(out.indexOf(d), 1);
      });
    }
    return out;
  }
  function textOf(c, e) { if (!e) return ""; if (e.text !== undefined) return e.text; return G.blobText(c.sys, e.sha); }
  function stats(c, list) {
    list.forEach(function (f) { if (f.add === undefined) { var n = G.countChanges(textOf(c, f.a), textOf(c, f.b)); f.add = n.add; f.del = n.del; } });
    return list;
  }
  function summaryLine(list) {
    var add = 0, del = 0;
    list.forEach(function (f) { add += f.add; del += f.del; });
    var s = " " + plural(list.length, "file changed", "files changed");
    if (add || !del) s += ", " + plural(add, "insertion(+)", "insertions(+)");
    if (del) s += ", " + plural(del, "deletion(-)", "deletions(-)");
    if (!add && !del && list.length) s = " " + plural(list.length, "file changed", "files changed") + ", 0 insertions(+), 0 deletions(-)";
    return s;
  }
  function statName(c, f, rel) {
    var p = rel ? showPath(c, f.path) : f.path;
    if (!f.rename) return p;
    var a = rel ? showPath(c, f.from) : f.from, b = p;
    // common prefix/suffix, like git's "dir/{old => new}.txt"
    var pre = 0; while (pre < a.length && pre < b.length && a[pre] === b[pre]) pre++;
    while (pre > 0 && a[pre - 1] !== "/") pre--;
    var suf = 0; while (suf < a.length - pre && suf < b.length - pre && a[a.length - 1 - suf] === b[b.length - 1 - suf]) suf++;
    while (suf > 0 && a[a.length - suf] !== "/") suf--;
    if (pre || suf) return a.slice(0, pre) + "{" + a.slice(pre, a.length - suf) + " => " + b.slice(pre, b.length - suf) + "}" + a.slice(a.length - suf);
    return a + " => " + b;
  }
  function printStat(c, list, opts) {
    opts = opts || {};
    stats(c, list);
    if (!list.length) return;
    var names = list.map(function (f) { return statName(c, f, opts.rel); });
    var nw = Math.max.apply(null, names.map(function (n) { return n.length; }));
    var maxc = Math.max.apply(null, list.map(function (f) { return f.add + f.del; }));
    var cw = String(maxc).length, room = 80 - nw - cw - 6;
    if (room < 10) room = 10;
    list.forEach(function (f, i) {
      var n = f.add + f.del, a = f.add, d = f.del;
      if (n > room) { a = Math.round(f.add * room / maxc); d = Math.round(f.del * room / maxc); if (f.add && !a) a = 1; if (f.del && !d) d = 1; }
      var bin = f.binary;
      c.o.line(" " + pad(names[i], nw) + " | " + (bin ? "Bin" : lpad(n, cw) + (n ? " " + new Array(a + 1).join("+") + new Array(d + 1).join("-") : "")));
    });
    c.o.line(summaryLine(list));
  }
  function modeSummary(c, list) {
    list.forEach(function (f) {
      if (!f.a) c.o.line(" create mode " + f.b.mode + " " + f.path);
      else if (!f.b) c.o.line(" delete mode " + f.a.mode + " " + f.path);
      else if (f.rename) c.o.line(" rename " + statName(c, f) + " (100%)");
      else if (f.a.mode !== f.b.mode) c.o.line(" mode change " + f.a.mode + " => " + f.b.mode + " " + f.path);
    });
  }
  function printPatch(c, f, opts) {
    opts = opts || {};
    var o = c.o, pa = (opts.srcPrefix || "a/") + (f.from || f.path), pb = (opts.dstPrefix || "b/") + f.path;
    var W = "white";
    o.line("diff --git " + pa + " " + pb, W);
    var aSha = f.a ? f.a.sha : null, bSha = f.b ? (f.b.sha || G.blobSha(f.b.text)) : null;
    if (!f.a) o.line("new file mode " + f.b.mode, W);
    else if (!f.b) o.line("deleted file mode " + f.a.mode, W);
    else if (f.a.mode !== f.b.mode) { o.line("old mode " + f.a.mode, W); o.line("new mode " + f.b.mode, W); }
    if (f.rename) { o.line("similarity index 100%", W); o.line("rename from " + f.from, W); o.line("rename to " + f.path, W); }
    if (aSha === bSha) return;
    o.line("index " + short(aSha || G.zero()) + ".." + short(bSha || G.zero()) + (f.a && f.b && f.a.mode === f.b.mode ? " " + f.a.mode : ""), W);
    o.line("--- " + (f.a ? pa : "/dev/null"), W);
    o.line("+++ " + (f.b ? pb : "/dev/null"), W);
    var bodyRes = G.unifiedBody(textOf(c, f.a), textOf(c, f.b), opts.ctx);
    bodyRes.lines.forEach(function (l) { o.line(l.t, l.c); });
  }
  function printChanges(c, list, opts) {
    opts = opts || {};
    if (opts.nameOnly) { list.forEach(function (f) { c.o.line(opts.rel ? showPath(c, f.path) : f.path); }); return; }
    if (opts.nameStatus) { list.forEach(function (f) { var s = !f.a ? "A" : !f.b ? "D" : f.rename ? "R100" : "M"; c.o.line(s + "\t" + (f.rename ? (opts.rel ? showPath(c, f.from) : f.from) + "\t" : "") + (opts.rel ? showPath(c, f.path) : f.path)); }); return; }
    if (opts.numstat) { stats(c, list); list.forEach(function (f) { c.o.line(f.add + "\t" + f.del + "\t" + (opts.rel ? showPath(c, f.path) : f.path)); }); return; }
    if (opts.stat || opts.shortstat) {
      if (opts.shortstat) { stats(c, list); if (list.length) c.o.line(summaryLine(list)); }
      else printStat(c, list, opts);
      if (opts.summary) modeSummary(c, list);
      if (!opts.patch) return;
      if (list.length) c.o.line("");
    }
    list.forEach(function (f) { printPatch(c, f, opts); });
  }
  function workFlat(c, st, onlyTracked) {
    var out = {};
    var tracked = {};
    keys(st.idx.entries).forEach(function (k) { tracked[k] = 1; });
    keys(st.work).forEach(function (k) {
      if (onlyTracked && !onlyTracked[k]) return;
      var n = st.work[k];
      out[k] = { text: G.nodeContent(n), mode: G.fileMode(n), sha: G.blobSha(G.nodeContent(n)) };
    });
    return out;
  }
  function diffOpts(p) {
    var u = p.o.unified !== undefined ? +p.o.unified : p.o.U !== undefined ? +p.o.U : undefined;
    return { stat: !!p.o.stat, shortstat: !!p.o.shortstat, numstat: !!p.o.numstat, nameOnly: !!p.o["name-only"], nameStatus: !!p.o["name-status"], ctx: u, patch: !!p.o.patch || !!p.o.p, summary: !!p.o.summary, rel: false };
  }
  var DIFFSPEC = ["stat=?", "shortstat", "numstat", "name-only", "name-status", "U|unified=", "p|patch", "u", "summary", "color=?", "no-color", "R", "exit-code", "quiet", "no-renames", "find-renames=?", "M", "w|ignore-all-space", "word-diff=?", "relative=?", "raw", "minimal", "patience", "histogram"];
  // Split arguments into revisions and paths.
  function revsAndPaths(c, p) {
    var revs = [], paths = (p.paths || []).slice();
    p.rest.forEach(function (a, i) {
      if (paths.length > (p.paths || []).length) { paths.push(a); return; }
      if (/\.\.\.?/.test(a) && a !== "..") {
        var mm = /^(.*?)(\.\.\.?)(.*)$/.exec(a);
        if (tryRev(c, mm[1] || "HEAD") && tryRev(c, mm[3] || "HEAD")) { revs.push(a); return; }
      }
      if (p.paths === null && tryRev(c, a) && !(G.nodeAt(c.sys, S.normAbs((a.charAt(0) === "/" ? "" : c.cwd + "/") + a)) && revs.length)) { revs.push(a); return; }
      var exists = G.nodeAt(c.sys, S.normAbs(a.charAt(0) === "/" ? a : c.cwd + "/" + a));
      if (exists || p.paths !== null || hasGlob(a)) { paths.push(a); return; }
      die(c, "fatal: ambiguous argument '" + a + "': unknown revision or path not in the working tree.\nUse '--' to separate paths from revisions, like this:\n'git <command> [<revision>...] -- [<file>...]'");
    });
    return { revs: revs, paths: paths };
  }
  function combinedDiff(c, p, x, workText) {
    var o = c.o;
    o.line("diff --cc " + p, "white");
    var ours = x[2] ? G.blobText(c.sys, x[2].sha) : "", theirs = x[3] ? G.blobText(c.sys, x[3].sha) : "";
    var W = G.splitLines(workText), A = G.splitLines(ours), B = G.splitLines(theirs);
    function inSide(side) { var ops = G.myers(side, W), keep = {}; ops.forEach(function (op) { if (op.t === "=") keep[op.b] = 1; }); return keep; }
    var ka = inSide(A), kb = inSide(B);
    o.line("index " + short(x[2] ? x[2].sha : G.zero()) + "," + short(x[3] ? x[3].sha : G.zero()) + "..0000000", "white");
    o.line("--- a/" + p, "white"); o.line("+++ b/" + p, "white");
    o.line("@@@ -1," + A.length + " -1," + B.length + " +1," + W.length + " @@@", "cyan");
    W.forEach(function (l, i) { var s = (ka[i] ? " " : "+") + (kb[i] ? " " : "+"); o.line(s + G.stripNl(l), s === "  " ? null : "green"); });
  }
  function cmdDiff(c, args) {
    var p = parseOpts(c, args, DIFFSPEC.concat(["cached", "staged", "no-index"]), "git diff [<options>] [<commit>] [--] [<path>...]");
    var opts = diffOpts(p);
    if (p.o["no-index"] || !c.repo) {
      var files = p.rest.concat(p.paths || []);
      if (files.length !== 2) { if (!c.repo) die(c, "fatal: not a git repository (or any of the parent directories): .git\n(git diff outside a repository needs exactly two files: git diff --no-index a b)"); die(c, "usage: git diff --no-index [<options>] <path> <path>", 129); }
      var ta = S.readFile(c.sess, files[0]), tb = S.readFile(c.sess, files[1]);
      if (ta.error) die(c, "error: Could not access '" + files[0] + "'", 1);
      if (tb.error) die(c, "error: Could not access '" + files[1] + "'", 1);
      if (ta.content === tb.content) return 0;
      var f0 = { path: files[1], from: files[0], a: { text: ta.content, mode: "100644", sha: G.blobSha(ta.content) }, b: { text: tb.content, mode: "100644", sha: G.blobSha(tb.content) } };
      if (f0.from === f0.path) f0.from = null;
      printChanges(c, [f0], Object.assign(opts, { srcPrefix: "a/", dstPrefix: "b/" }));
      return 1;
    }
    var rp = revsAndPaths(c, p), m = rp.paths.length ? matcher(c, rp.paths) : null;
    var st = computeStatus(c), A, B, list;
    var cached = p.o.cached || p.o.staged;
    if (rp.revs.length === 1 && /\.\.\.?/.test(rp.revs[0])) {
      var mm = /^(.*?)(\.\.\.?)(.*)$/.exec(rp.revs[0]);
      var r1 = commitRev(c, mm[1] || "HEAD"), r2 = commitRev(c, mm[3] || "HEAD");
      if (mm[2] === "...") { var mb = G.mergeBases(c.sys, r1, r2)[0]; r1 = mb; }
      A = G.commitFlat(c.sys, r1); B = G.commitFlat(c.sys, r2);
    } else if (rp.revs.length === 2) { A = G.commitFlat(c.sys, commitRev(c, rp.revs[0])); B = G.commitFlat(c.sys, commitRev(c, rp.revs[1])); }
    else if (cached) { A = rp.revs.length ? G.commitFlat(c.sys, commitRev(c, rp.revs[0])) : st.headFlat; B = st.idx.entries; }
    else if (rp.revs.length === 1) {
      A = G.commitFlat(c.sys, commitRev(c, rp.revs[0]));
      var tracked = {}; keys(st.idx.entries).forEach(function (k) { tracked[k] = 1; }); keys(A).forEach(function (k) { tracked[k] = 1; });
      B = workFlat(c, st, tracked);
    } else {
      A = st.idx.entries;
      var tr = {}; keys(st.idx.entries).forEach(function (k) { tr[k] = 1; });
      B = workFlat(c, st, tr);
      keys(st.idx.conflicts).forEach(function (k) { if (m && !m(k)) return; });
    }
    if (p.o.R) { var t = A; A = B; B = t; }
    list = changes(c, A, B, m, { renames: !p.o["no-renames"] && (cached || rp.revs.length > 0) });
    opts.rel = false;
    if (!rp.revs.length && !cached) {
      var conf = keys(st.idx.conflicts).sort().filter(function (k) { return !m || m(k); });
      conf.forEach(function (k) {
        if (opts.stat || opts.nameOnly || opts.nameStatus) return;
        var w = st.work[k];
        if (w) combinedDiff(c, k, st.idx.conflicts[k], G.nodeContent(w));
        else c.o.line("* Unmerged path " + k);
      });
    }
    if (!p.o.quiet) printChanges(c, list, opts);
    return (p.o["exit-code"] || p.o.quiet) && list.length ? 1 : 0;
  }

  /* ================================================================== history: walking, formats, graph */
  function decorations(c) {
    var map = {}, repo = c.repo, h = G.head(repo);
    function add(sha, label, kind) { if (!sha) return; (map[sha] = map[sha] || []).push({ label: label, kind: kind }); }
    G.listRefs(repo, "refs/tags/").forEach(function (r) { add(G.peel(c.sys, r.sha), "tag: " + r.name.slice(10), "tag"); });
    G.listRefs(repo, "refs/heads/").forEach(function (r) { if (!h.detached && r.name === h.ref) return; add(r.sha, r.name.slice(11), "branch"); });
    G.listRefs(repo, "refs/remotes/").forEach(function (r) { add(r.sha, r.name.slice(13), "remote"); });
    var st = G.resolveRefName(repo, "refs/stash").sha; if (st) add(st, "refs/stash", "stash");
    if (h.sha) (map[h.sha] = map[h.sha] || []).unshift({ label: h.detached ? "HEAD" : "HEAD -> " + h.branch, kind: "head" });
    return map;
  }
  function decoText(dec, sha) { var d = dec && dec[sha]; return d && d.length ? " (" + d.map(function (x) { return x.label; }).join(", ") + ")" : ""; }
  function fmtPlaceholder(c, sha, co, fmt, dec, dateMode) {
    var now = G.clock(c.sys);
    return fmt.replace(/%(H|h|T|t|P|p|an|ae|al|ad|ar|at|ai|aI|as|cn|ce|cd|cr|ct|ci|cI|cs|s|b|B|d|D|n|%|C\([^)]*\)|Cred|Cgreen|Cblue|Creset|<\(\d+\)|>\(\d+\))/g, function (m, k) {
      switch (k) {
        case "H": return sha; case "h": return short(sha);
        case "T": return co.tree; case "t": return short(co.tree);
        case "P": return co.parents.join(" "); case "p": return co.parents.map(short).join(" ");
        case "an": return co.author.name; case "ae": return co.author.email; case "al": return co.author.email.split("@")[0];
        case "ad": return G.fmtDate(co.author.time, co.author.tz, dateMode, now); case "ar": return G.relDate(co.author.time, now);
        case "at": return String(co.author.time); case "ai": return G.fmtDate(co.author.time, co.author.tz, "iso"); case "aI": return G.fmtDate(co.author.time, co.author.tz, "iso-strict"); case "as": return G.fmtDate(co.author.time, co.author.tz, "short");
        case "cn": return co.committer.name; case "ce": return co.committer.email;
        case "cd": return G.fmtDate(co.committer.time, co.committer.tz, dateMode, now); case "cr": return G.relDate(co.committer.time, now);
        case "ct": return String(co.committer.time); case "ci": return G.fmtDate(co.committer.time, co.committer.tz, "iso"); case "cI": return G.fmtDate(co.committer.time, co.committer.tz, "iso-strict"); case "cs": return G.fmtDate(co.committer.time, co.committer.tz, "short");
        case "s": return subject(co.message); case "b": var b = body(co.message); return b ? b + "\n" : ""; case "B": return co.message.replace(/\n$/, "");
        case "d": return decoText(dec, sha); case "D": var dd = dec && dec[sha]; return dd ? dd.map(function (x) { return x.label; }).join(", ") : "";
        case "n": return "\n"; case "%": return "%";
        default: return "";
      }
    });
  }
  // Walk commits: include/exclude lists of shas. Returns ordered list of shas.
  function walk(c, include, exclude, o) {
    o = o || {};
    var sys = c.sys, hidden = {};
    exclude.forEach(function (x) { G.ancestors(sys, x, hidden); });
    var seen = {}, list = [];
    function parentsFor(s) { var ps = G.parentsOf(sys, s); return o.firstParent ? ps.slice(0, 1) : ps; }
    if (o.topo) {
      // children before parents, keeping lines of history together (like git log --graph)
      var reach = {}, stack = include.slice();
      while (stack.length) { var s = stack.pop(); if (reach[s] || hidden[s]) continue; reach[s] = 1; parentsFor(s).forEach(function (p) { stack.push(p); }); }
      var indeg = {};
      keys(reach).forEach(function (s) { parentsFor(s).forEach(function (p) { if (reach[p]) indeg[p] = (indeg[p] || 0) + 1; }); });
      var tips = include.filter(function (s, i) { return reach[s] && !indeg[s] && include.indexOf(s) === i; })
        .sort(function (a, b) { return G.commitOf(sys, a).committer.time - G.commitOf(sys, b).committer.time; });
      var st = tips.slice();
      while (st.length) {
        var cur = st.pop();
        if (seen[cur]) continue;
        seen[cur] = 1; list.push(cur);
        var ps = parentsFor(cur).filter(function (p) { return reach[p]; });
        ps.forEach(function (p) { indeg[p]--; });
        for (var i = 0; i < ps.length; i++) if (indeg[ps[i]] === 0 && !seen[ps[i]]) st.push(ps[i]);
      }
      return list;
    }
    var queue = include.filter(function (s) { return !hidden[s]; }).map(function (s, i) { return { s: s, t: G.commitOf(sys, s).committer.time, k: i }; }), k = 0;
    while (queue.length) {
      queue.sort(function (a, b) { return b.t - a.t || a.k - b.k; });
      var q = queue.shift();
      if (seen[q.s] || hidden[q.s]) continue;
      seen[q.s] = 1; list.push(q.s);
      parentsFor(q.s).forEach(function (p) { if (!seen[p] && !hidden[p]) queue.push({ s: p, t: G.commitOf(sys, p).committer.time, k: ++k }); });
    }
    return list;
  }
  function makeGraph() {
    var cols = [];
    return {
      step: function (sha, parents) {
        var idx = cols.indexOf(sha);
        if (idx < 0) { cols.push(sha); idx = cols.length - 1; }
        var before = cols.slice(), next = cols.slice(), ins = [];
        if (!parents.length) next.splice(idx, 1);
        else {
          next[idx] = parents[0];
          ins = parents.slice(1).filter(function (p) { return next.indexOf(p) < 0; });
          Array.prototype.splice.apply(next, [idx + 1, 0].concat(ins));
        }
        var width = Math.max(before.length, next.length);
        var row = before.map(function (s, i) { return i === idx ? "*" : "|"; }).join(" ");
        var prefix = pad(row, width * 2 > row.length + 1 ? width * 2 : row.length + 1);
        var after = [];
        if (ins.length) {
          var g = []; for (var i = 0; i <= idx; i++) g[i * 2] = "|";
          g[idx * 2 + 1] = "\\";
          for (var j = idx + 1; j < before.length; j++) g[j * 2 + 1] = "\\";
          after.push(fill(g));
        }
        if (!parents.length && idx < next.length) {
          var g2 = []; for (var i2 = 0; i2 < idx; i2++) g2[i2 * 2] = "|";
          for (var j2 = idx; j2 < next.length; j2++) g2[j2 * 2 + 1] = "/";
          after.push(fill(g2));
        }
        // lanes that now wait for the same commit join up
        var guard = 0;
        while (guard++ < 20) {
          var dupK = -1;
          for (var a = 0; a < next.length && dupK < 0; a++) for (var b = a + 1; b < next.length; b++) if (next[a] === next[b]) { dupK = b; break; }
          if (dupK < 0) break;
          var g3 = []; for (var i3 = 0; i3 < dupK; i3++) g3[i3 * 2] = "|";
          for (var j3 = dupK; j3 < next.length; j3++) g3[j3 * 2 - 1] = "/";
          after.push(fill(g3));
          next.splice(dupK, 1);
        }
        cols = next;
        var padRow = cols.map(function () { return "|"; }).join(" ");
        return { prefix: prefix, after: after, padding: padRow ? pad(padRow, padRow.length + 1) : "" };
      }
    };
    function fill(g) { var s = ""; for (var i = 0; i < g.length; i++) s += g[i] || " "; return s.replace(/\s+$/, ""); }
  }
  function prettyLines(c, sha, co, fmtName, opts, dec) {
    var now = G.clock(c.sys), L = [], dm = opts.date || "default";
    var ab = opts.abbrevCommit ? short(sha) : sha;
    if (fmtName === "oneline") return [{ t: (opts.abbrevCommit ? short(sha) : sha) + decoText(dec, sha) + " " + subject(co.message), first: true }];
    if (/^(t?format):/.test(fmtName) || opts.userFormat) {
      var f = opts.userFormat || fmtName.replace(/^t?format:/, "");
      return fmtPlaceholder(c, sha, co, f, dec, dm).split("\n").map(function (t, i) { return { t: t, first: i === 0 }; });
    }
    L.push({ t: "commit " + ab + decoText(dec, sha), c: "yellow", first: true });
    if (co.parents.length > 1) L.push({ t: "Merge: " + co.parents.map(short).join(" ") });
    if (fmtName === "full" || fmtName === "fuller") {
      L.push({ t: (fmtName === "fuller" ? "Author:     " : "Author: ") + co.author.name + " <" + co.author.email + ">" });
      if (fmtName === "fuller") L.push({ t: "AuthorDate: " + G.fmtDate(co.author.time, co.author.tz, dm, now) });
      L.push({ t: (fmtName === "fuller" ? "Commit:     " : "Commit: ") + co.committer.name + " <" + co.committer.email + ">" });
      if (fmtName === "fuller") L.push({ t: "CommitDate: " + G.fmtDate(co.committer.time, co.committer.tz, dm, now) });
    } else {
      L.push({ t: "Author: " + co.author.name + " <" + co.author.email + ">" });
      if (fmtName !== "short") L.push({ t: "Date:   " + G.fmtDate(co.author.time, co.author.tz, dm, now) });
    }
    L.push({ t: "" });
    var msgLines = co.message.replace(/\n+$/, "").split("\n");
    if (fmtName === "short") msgLines = [msgLines[0]];
    msgLines.forEach(function (l) { L.push({ t: l ? "    " + l : "" }); });
    return L;
  }
  // Parse "A..B", "^A", "A...B" etc. into include/exclude lists.
  function parseRange(c, specs, all) {
    var inc = [], exc = [];
    if (all) {
      var h = G.head(c.repo);
      if (h.sha) inc.push(h.sha);
      G.listRefs(c.repo, "refs/").forEach(function (r) { if (/^refs\/(heads|tags|remotes)\//.test(r.name)) { var x = G.peel(c.sys, r.sha); if (G.commitOf(c.sys, x)) inc.push(x); } });
    }
    specs.forEach(function (s) {
      var m = /^(.*?)(\.\.\.?)(.*)$/.exec(s);
      if (m && s !== "..") {
        var a = commitRev(c, m[1] || "HEAD"), b = commitRev(c, m[3] || "HEAD");
        if (m[2] === "...") { inc.push(a, b); G.mergeBases(c.sys, a, b).forEach(function (x) { exc.push(x); }); }
        else { exc.push(a); inc.push(b); }
      } else if (s.charAt(0) === "^") exc.push(commitRev(c, s.slice(1)));
      else inc.push(commitRev(c, s));
    });
    return { inc: inc, exc: exc };
  }
  function touches(c, sha, m, firstParentOnly) {
    var co = G.commitOf(c.sys, sha), f = G.flatTree(c.sys, co.tree);
    function rel(F) { var o = {}; keys(F).forEach(function (k) { if (m(k)) o[k] = F[k].sha + F[k].mode; }); return JSON.stringify(o); }
    var mine = rel(f);
    if (!co.parents.length) return mine !== "{}";
    var ps = firstParentOnly ? co.parents.slice(0, 1) : co.parents;
    return ps.every(function (p) { return rel(G.commitFlat(c.sys, p)) !== mine; });
  }
  var LOGSPEC = ["oneline", "graph", "all", "decorate=?", "no-decorate", "n|max-count=", "skip=", "p|patch", "u", "stat=?", "shortstat", "name-only", "name-status", "numstat", "author=+", "committer=", "grep=+", "i|regexp-ignore-case", "S=", "G=", "since=", "after=", "until=", "before=", "reverse", "format=", "pretty=?", "abbrev-commit", "no-abbrev-commit", "date=", "first-parent", "no-merges", "merges", "follow", "topo-order", "date-order", "full-diff", "U|unified=", "color=?", "no-color", "summary", "relative-date", "source", "left-right", "branches=?", "tags=?", "remotes=?", "simplify-by-decoration", "invert-grep", "all-match", "E|extended-regexp", "F|fixed-strings", "L=", "no-walk", "m", "c", "cc", "walk-reflogs", "g", "z"];
  function cmdLog(c, args, mode) {
    needRepo(c);
    var p = parseOpts(c, args, LOGSPEC, "git log [<options>] [<revision-range>] [[--] <path>...]");
    var o = p.o;
    if (o.L) die(c, "(git log -L is not available in this lab. Use git log -p -- <file> or git blame -L.)", 1);
    var h = G.head(c.repo);
    var rp = revsAndPaths(c, p);
    if (!h.sha && !rp.revs.length && !o.all) die(c, "fatal: your current branch '" + h.branch + "' does not have any commits yet");
    var rng = parseRange(c, rp.revs.length ? rp.revs : (o.all ? [] : ["HEAD"]), o.all || o.branches || o.tags);
    var m = rp.paths.length ? matcher(c, rp.paths) : null;
    var list = walk(c, rng.inc, rng.exc, { topo: o.graph || o["topo-order"], firstParent: o["first-parent"] });
    // filters
    var now = G.clock(c.sys);
    var since = o.since || o.after, until = o.until || o.before;
    var tSince = since ? G.approxidate(since, now) : null, tUntil = until ? G.approxidate(until, now) : null;
    var grepFlags = o["regexp-ignore-case"] ? "i" : "";
    function re(s) { try { return new RegExp(o["fixed-strings"] ? s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") : s, grepFlags); } catch (e) { return new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), grepFlags); } }
    var follow = o.follow && rp.paths.length === 1 ? toRel(c, rp.paths[0]) : null;
    list = list.filter(function (sha) {
      var co = G.commitOf(c.sys, sha);
      if (o["no-merges"] && co.parents.length > 1) return false;
      if (o.merges && co.parents.length < 2) return false;
      if (tSince !== null && co.committer.time < tSince) return false;
      if (tUntil !== null && co.committer.time > tUntil) return false;
      if (o.author && !o.author.some(function (a) { return re(a).test(co.author.name + " <" + co.author.email + ">"); })) return false;
      if (o.committer && !re(o.committer).test(co.committer.name + " <" + co.committer.email + ">")) return false;
      if (o.grep) {
        var hit = o["all-match"] ? o.grep.every(function (g) { return re(g).test(co.message); }) : o.grep.some(function (g) { return re(g).test(co.message); });
        if (o["invert-grep"] ? hit : !hit) return false;
      }
      if (o.S !== undefined || o.G !== undefined) {
        var mine = G.commitFlat(c.sys, sha), par = co.parents[0] ? G.commitFlat(c.sys, co.parents[0]) : {};
        if (co.parents.length > 1) return false;
        var any = keys(Object.assign({}, mine, par)).some(function (k) {
          if (m && !m(k)) return false;
          var a = par[k] ? G.blobText(c.sys, par[k].sha) : "", b = mine[k] ? G.blobText(c.sys, mine[k].sha) : "";
          if (a === b) return false;
          if (o.S !== undefined) { var cnt = function (t) { return o.S === "" ? 0 : t.split(o.S).length - 1; }; return cnt(a) !== cnt(b); }
          var rg = re(o.G);
          var ops = G.myers(G.splitLines(a), G.splitLines(b)), A = G.splitLines(a), B = G.splitLines(b);
          return ops.some(function (op) { return (op.t === "-" && rg.test(A[op.a])) || (op.t === "+" && rg.test(B[op.b])); });
        });
        if (!any) return false;
      }
      if (m && !follow && !touches(c, sha, m)) return false;
      return true;
    });
    if (follow) {
      // follow one file through renames
      var cur = follow, kept = [];
      walk(c, rng.inc, rng.exc, {}).forEach(function (sha) {
        if (list.indexOf(sha) < 0 && !(o.S === undefined && o.G === undefined && !o.author && !o.grep)) return;
        var co = G.commitOf(c.sys, sha), mine = G.commitFlat(c.sys, sha), par = co.parents[0] ? G.commitFlat(c.sys, co.parents[0]) : {};
        if (!mine[cur]) return;
        if (par[cur] && par[cur].sha === mine[cur].sha) return;
        kept.push(sha);
        if (!par[cur]) { var src = keys(par).filter(function (k) { return par[k].sha === mine[cur].sha && !mine[k]; })[0]; if (src) cur = src; }
      });
      list = kept;
    }
    var skip = +(o.skip || 0); if (skip) list = list.slice(skip);
    if (o["max-count"] !== undefined) list = list.slice(0, +o["max-count"]);
    if (o.reverse) list.reverse();
    var fmtName = "medium", userFormat = null;
    if (o.oneline) fmtName = "oneline";
    var pf = o.format !== undefined ? o.format : o.pretty;
    if (pf !== undefined && pf !== true) {
      if (/^(oneline|short|medium|full|fuller|raw|reference)$/.test(pf)) fmtName = pf;
      else if (/^t?format:/.test(pf)) { fmtName = "format"; userFormat = pf.replace(/^t?format:/, ""); }
      else { fmtName = "format"; userFormat = pf; }
    }
    var abbrevCommit = o.oneline || o["abbrev-commit"];
    if (o["no-abbrev-commit"]) abbrevCommit = false;
    var dec = (o.decorate !== undefined && o.decorate !== "no") || (c.io.tty && o.decorate === undefined && !o["no-decorate"]) ? decorations(c) : null;
    if (o["no-decorate"] || o.decorate === "no") dec = null;
    var dopts = { date: o["relative-date"] ? "relative" : o.date, abbrevCommit: abbrevCommit, userFormat: userFormat };
    var showPatch = o.patch || o.u || o.p, showStat = o.stat !== undefined, dmode = diffOpts(p);
    var graph = o.graph ? makeGraph() : null;
    var shownSet = {}; list.forEach(function (s) { shownSet[s] = 1; });
    list.forEach(function (sha, n) {
      var co = G.commitOf(c.sys, sha);
      var lines = prettyLines(c, sha, co, fmtName, dopts, dec);
      var extra = [];
      if (showPatch || showStat || o["name-only"] || o["name-status"] || o.numstat || o.shortstat || o.summary) {
        if (co.parents.length <= 1 || o.m) {
          var A = co.parents[0] ? G.commitFlat(c.sys, co.parents[0]) : {}, B = G.commitFlat(c.sys, sha);
          var ch = changes(c, A, B, o["full-diff"] ? null : m);
          extra = captureChanges(c, ch, Object.assign({}, dmode, { patch: showPatch, stat: showStat || dmode.stat }));
        }
      }
      if (graph) {
        var parentsShown = G.parentsOf(c.sys, sha);
        if (o["first-parent"]) parentsShown = parentsShown.slice(0, 1);
        var g = graph.step(sha, parentsShown);
        var queue = g.after.slice();
        var all = lines.concat(extra.length ? (fmtName === "oneline" || fmtName === "format" ? [] : []).concat(extra) : []);
        if (fmtName !== "oneline" && fmtName !== "format" && n > 0) { /* blank line between commits is drawn by the padding row */ }
        all.forEach(function (l, i) {
          var pre = i === 0 ? g.prefix : (queue.length ? pad(queue.shift(), g.padding.length) : g.padding);
          c.o.line((pre + l.t).replace(/\s+$/, ""), i === 0 ? l.c : l.c);
        });
        queue.forEach(function (r) { c.o.line(r); });
        if (fmtName !== "oneline" && fmtName !== "format" && n < list.length - 1) c.o.line(g.padding.replace(/\s+$/, ""));
      } else {
        if (n > 0 && fmtName !== "oneline" && fmtName !== "format") c.o.line("");
        lines.forEach(function (l) { c.o.line(l.t, l.c); });
        if (extra.length) {
          if (fmtName !== "oneline" && fmtName !== "format") c.o.line("");
          extra.forEach(function (l) { c.o.line(l.t, l.c); });
        }
      }
    });
    return 0;
  }
  // Run printChanges into a list of lines instead of printing.
  function captureChanges(c, list, opts) {
    var buf = [], saved = c.o;
    c.o = { line: function (t, col) { buf.push({ t: t, c: col }); }, err: saved.err, hint: saved.hint };
    try { printChanges(c, list, opts); } finally { c.o = saved; }
    return buf;
  }
  function cmdShow(c, args) {
    needRepo(c);
    var p = parseOpts(c, args, LOGSPEC.concat(["s|no-patch"]), "git show [<options>] <object>...");
    var objs = p.rest.length ? p.rest : ["HEAD"];
    var o = p.o, dec = (c.io.tty && !o["no-decorate"]) || o.decorate ? decorations(c) : null;
    var first = true;
    objs.forEach(function (spec) {
      var sha = rev(c, spec), ob = G.getObject(c.sys, sha);
      if (!first && ob.type !== "blob") c.o.line("");
      first = false;
      if (ob.type === "blob") { c.io.out(ob.content); return; }
      if (ob.type === "tree") { c.o.line("tree " + spec, "yellow"); c.o.line(""); ob.entries.slice().sort(function (a, b) { return a.name < b.name ? -1 : 1; }).forEach(function (e) { c.o.line(e.name + (e.mode === "40000" ? "/" : "")); }); return; }
      if (ob.type === "tag") {
        c.o.line("tag " + ob.tag, "yellow");
        c.o.line("Tagger: " + ob.tagger.name + " <" + ob.tagger.email + ">");
        c.o.line("Date:   " + G.fmtDate(ob.tagger.time, ob.tagger.tz, o.date, G.clock(c.sys)));
        c.o.line("");
        ob.message.replace(/\n+$/, "").split("\n").forEach(function (l) { c.o.line(l); });
        c.o.line("");
        sha = G.peel(c.sys, sha);
        if (!G.commitOf(c.sys, sha)) return;
      }
      var co = G.commitOf(c.sys, sha);
      var fmtName = o.oneline ? "oneline" : "medium", userFormat = null;
      var pf = o.format !== undefined ? o.format : o.pretty;
      if (pf !== undefined && pf !== true) { if (/^(oneline|short|medium|full|fuller)$/.test(pf)) fmtName = pf; else { fmtName = "format"; userFormat = pf.replace(/^t?format:/, ""); } }
      prettyLines(c, sha, co, fmtName, { date: o.date, abbrevCommit: o.oneline || o["abbrev-commit"], userFormat: userFormat }, dec).forEach(function (l) { c.o.line(l.t, l.c); });
      if (o["no-patch"] || o.s) return;
      if (co.parents.length > 1) return;
      var rp = p.paths ? matcher(c, p.paths) : null;
      var ch = changes(c, co.parents[0] ? G.commitFlat(c.sys, co.parents[0]) : {}, G.commitFlat(c.sys, sha), rp);
      var dm = diffOpts(p);
      var onlyMeta = dm.stat || dm.nameOnly || dm.nameStatus || dm.shortstat || dm.numstat || o.stat !== undefined;
      if (!onlyMeta) dm.patch = true;
      if (o.stat !== undefined) dm.stat = true;
      if (ch.length && fmtName !== "oneline" && fmtName !== "format") c.o.line("");
      printChanges(c, ch, dm);
    });
    return 0;
  }

  /* ================================================================== commit */
  function cleanupMessage(msg, strip) {
    var lines = msg.split("\n");
    if (strip) lines = lines.filter(function (l) { return l.charAt(0) !== "#"; });
    lines = lines.map(function (l) { return l.replace(/\s+$/, ""); });
    var out = [];
    lines.forEach(function (l) { if (l === "" && (out.length === 0 || out[out.length - 1] === "")) return; out.push(l); });
    while (out.length && out[out.length - 1] === "") out.pop();
    return out.length ? out.join("\n") + "\n" : "";
  }
  function runHook(c, name, hookArgs) {
    if (c.noHooks) return 0;
    var hp = G.cfgHooksPath ? null : null;
    var dirCfg = cfg(c, "core.hookspath");
    var path = dirCfg ? (dirCfg.charAt(0) === "/" ? dirCfg : c.repo.top + "/" + dirCfg) + "/" + name : G.gpath(c.repo, "hooks/" + name);
    var n = G.nodeAt(c.sys, path);
    if (!n || n.type !== "f") return 0;
    if (!(n.mode & 73)) { c.o.hint("The '" + path.replace(c.repo.top + "/", "") + "' hook was ignored because it's not set as executable.\nYou can disable this warning with `git config advice.ignoredHook false`."); return 0; }
    var sub = S.childSession(c.sess);
    sub.cwd = c.repo.top;
    S.setVar(sub, "GIT_DIR", ".git", true);
    return S.runScriptFile(sub, path, hookArgs || [], c.io, path);
  }
  function commitSummary(c, branchLabel, sha, co, opts) {
    var root = !co.parents.length;
    c.o.line("[" + branchLabel + (root ? " (root-commit)" : "") + " " + short(sha) + "] " + subject(co.message));
    if (opts.amend || opts.showDate) c.o.line(" Date: " + G.fmtDate(co.author.time, co.author.tz));
    if (co.parents.length > 1) return;
    var list = changes(c, co.parents[0] ? G.commitFlat(c.sys, co.parents[0]) : {}, G.commitFlat(c.sys, sha));
    if (!list.length) return;
    stats(c, list);
    c.o.line(summaryLine(list));
    modeSummary(c, list);
  }
  function branchLabel(h) { return h.detached ? "detached HEAD" : h.branch; }
  function cmdCommit(c, args) {
    needWork(c);
    var p = parseOpts(c, args, ["m|message=+", "a|all", "amend", "no-edit", "allow-empty", "allow-empty-message", "F|file=", "n|no-verify", "q|quiet", "v|verbose", "s|signoff", "author=", "e|edit", "reset-author", "C|reuse-message=", "fixup=", "squash=", "o|only", "i|include", "S|gpg-sign=?", "date=", "dry-run", "status", "no-status", "cleanup="], "git commit [<options>] [--] <pathspec>...");
    var o = p.o, repo = c.repo, h = G.head(repo);
    var idx = G.readIndex(repo);
    if (keys(idx.conflicts).length) {
      c.o.err("error: Committing is not possible because you have unmerged files.");
      c.o.hint("Fix them up in the work tree, and then use 'git add/rm <file>'\nas appropriate to mark resolution and make a commit.");
      die(c, "fatal: Exiting because of an unresolved conflict.");
    }
    if (o.amend && !h.sha) die(c, "fatal: You have nothing to amend.");
    var merging = G.gexists(repo, "MERGE_HEAD") ? G.gread(repo, "MERGE_HEAD").trim().split("\n") : null;
    if (merging && o.amend) die(c, "fatal: You are in the middle of a merge -- cannot amend.");
    var specs = p.rest.concat(p.paths || []);
    var st = computeStatus(c);
    if (o.all) {
      if (specs.length) die(c, "fatal: paths '" + specs.join(" ") + " ...' with -a does not make sense");
      keys(st.idx.entries).forEach(function (k) {
        var w = st.work[k];
        if (!w) { delete idx.entries[k]; return; }
        var we = G.workEntryNode(w);
        if (!G.same(we, idx.entries[k])) { G.putObject(c.sys, { type: "blob", content: G.nodeContent(w) }); idx.entries[k] = { sha: we.sha, mode: we.mode }; }
      });
    }
    var commitEntries = idx.entries, partial = null;
    if (specs.length) {
      if (merging) die(c, "fatal: cannot do a partial commit during a merge.");
      var m = matcher(c, specs), base = o.amend ? G.commitFlat(c.sys, G.commitOf(c.sys, h.sha).parents[0]) : G.commitFlat(c.sys, h.sha);
      var hitAny = {};
      partial = {};
      m.list.forEach(function (one) {
        var any = keys(st.work).concat(keys(idx.entries)).some(function (k) { return m.hit(k, one) && (idx.entries[k] || base[k]); });
        if (!any) die(c, "error: pathspec '" + one.spec + "' did not match any file(s) known to git", 1);
      });
      commitEntries = Object.assign({}, G.commitFlat(c.sys, h.sha));
      keys(Object.assign({}, idx.entries, commitEntries)).forEach(function (k) {
        if (!m(k)) return;
        var w = st.work[k];
        if (w && (idx.entries[k] || commitEntries[k])) { var we = G.workEntryNode(w); G.putObject(c.sys, { type: "blob", content: G.nodeContent(w) }); commitEntries[k] = { sha: we.sha, mode: we.mode }; partial[k] = commitEntries[k]; }
        else if (!w) { delete commitEntries[k]; partial[k] = null; }
      });
    }
    var tree = G.writeTree(c.sys, commitEntries);
    var parentTree = h.sha ? (o.amend ? (function () { var pc = G.commitOf(c.sys, h.sha).parents[0]; return pc ? G.commitOf(c.sys, pc).tree : G.writeTree(c.sys, {}); })() : G.commitOf(c.sys, h.sha).tree) : null;
    if (!o.amend && !merging && !o["allow-empty"] && (h.sha ? tree === parentTree : !keys(commitEntries).length)) {
      if (o.all || specs.length || true) {
        var st2 = computeStatus(c);
        if (o["dry-run"]) { printLongStatus(c, st2); return 1; }
        printLongStatus(c, st2);
      }
      return 1;
    }
    // the message
    var msg = null, strip = false;
    if (o.message) msg = o.message.join("\n\n");
    else if (o.file) { var rf = S.readFile(c.sess, o.file); if (rf.error) die(c, "fatal: could not read log file '" + o.file + "': " + S.ERRTEXT[rf.error]); msg = rf.content; }
    else if (o["reuse-message"]) msg = G.commitOf(c.sys, rev(c, o["reuse-message"])).message;
    else if (o.fixup) { var fx = G.commitOf(c.sys, rev(c, o.fixup)); msg = "fixup! " + subject(fx.message); }
    else if (o.squash) { var sq = G.commitOf(c.sys, rev(c, o.squash)); msg = "squash! " + subject(sq.message); }
    else if (o.amend) msg = G.commitOf(c.sys, h.sha).message;
    else if (merging) { msg = G.gread(repo, "MERGE_MSG") || ("Merge commit '" + merging[0] + "'\n"); strip = true; }
    if (msg === null) {
      c.o.err("(git now opens your text editor so you can write the commit message. This lab's terminal can't open one for commits,\n so give the message on the command line: git commit -m \"Describe the change\")");
      c.o.err("Aborting commit due to empty commit message.");
      return 1;
    }
    msg = cleanupMessage(msg, strip);
    if (o.signoff) { var me = ident(c, "committer"); var so = "Signed-off-by: " + me.name + " <" + me.email + ">"; if (msg.indexOf(so) < 0) msg = msg.replace(/\n$/, "") + (/\n\n[\w-]+: /.test(msg) ? "\n" : "\n\n") + so + "\n"; }
    if (!msg && !o["allow-empty-message"]) { c.o.err("Aborting commit due to empty commit message."); return 1; }
    var committer = ident(c, "committer"), author;
    if (o.author) { var am = /^(.*?)\s*<([^>]*)>$/.exec(o.author); if (!am) die(c, "fatal: --author '" + o.author + "' is not 'Name <email>' and matches no existing author"); author = { name: am[1], email: am[2], time: committer.time, tz: "+0000" }; }
    else if (o.amend && !o["reset-author"]) author = Object.assign({}, G.commitOf(c.sys, h.sha).author);
    else if (o["reuse-message"]) author = Object.assign({}, G.commitOf(c.sys, rev(c, o["reuse-message"])).author);
    else author = ident(c, "author");
    // hooks
    if (!o["no-verify"]) {
      var hc = runHook(c, "pre-commit");
      if (hc !== 0) return 1;
    }
    G.gwrite(repo, "COMMIT_EDITMSG", msg);
    if (!o["no-verify"]) {
      var hm = runHook(c, "commit-msg", [".git/COMMIT_EDITMSG"]);
      if (hm !== 0) return 1;
      msg = cleanupMessage(G.gread(repo, "COMMIT_EDITMSG") || msg, true);
    }
    var parents = o.amend ? G.commitOf(c.sys, h.sha).parents.slice() : h.sha ? [h.sha] : [];
    if (merging) parents = parents.concat(merging);
    var co = { type: "commit", tree: tree, parents: parents, author: author, committer: committer, message: msg };
    if (o["gpg-sign"] !== undefined || G.configBool(cfg(c, "commit.gpgsign"), false)) { if (root.GitSign) root.GitSign.sign(c, co); }
    var sha = G.putObject(c.sys, co);
    var subj = subject(msg);
    var reflogMsg = o.amend ? "commit (amend): " + subj : merging ? "commit (merge): " + subj : parents.length ? "commit: " + subj : "commit (initial): " + subj;
    if (h.detached) G.setHead(repo, sha, reflogMsg, committer);
    else G.updateRef(repo, h.ref, sha, reflogMsg, committer);
    if (partial) { keys(partial).forEach(function (k) { if (partial[k]) idx.entries[k] = partial[k]; else delete idx.entries[k]; }); }
    G.writeIndex(repo, idx);
    ["MERGE_HEAD", "MERGE_MSG", "MERGE_MODE", "AUTO_MERGE", "SQUASH_MSG"].forEach(function (f) { G.gremove(repo, f); });
    if (G.gexists(repo, "REVERT_HEAD")) G.gremove(repo, "REVERT_HEAD");
    if (G.gexists(repo, "CHERRY_PICK_HEAD")) G.gremove(repo, "CHERRY_PICK_HEAD");
    storeObjects(c);
    if (!o.quiet) commitSummary(c, branchLabel(h), sha, co, { amend: o.amend });
    runHook(c, "post-commit");
    return 0;
  }

  /* ================================================================== moving between commits (checkout machinery) */
  // Move the index and working tree from the HEAD tree to target (flat map). Keeps local changes that don't clash.
  // Returns null on success or a list of problems.
  function moveTree(c, target, opts) {
    opts = opts || {};
    var st = computeStatus(c), idx = st.idx, from = st.headFlat;
    var local = [], untracked = [];
    var all = {};
    keys(from).forEach(function (k) { all[k] = 1; }); keys(target).forEach(function (k) { all[k] = 1; });
    var todo = [];
    keys(all).sort().forEach(function (k) {
      var f = from[k], t = target[k];
      if (G.same(f, t)) return;
      var ie = idx.entries[k], w = st.work[k], we = w ? G.workEntryNode(w) : null;
      if (!opts.force) {
        if (idx.conflicts[k]) { local.push(k); return; }
        var dirtyIdx = !G.same(ie, f), dirtyWork = ie ? !G.same(we && { sha: we.sha, mode: we.mode }, ie) : !!we;
        if (f || ie) {
          if ((dirtyIdx || dirtyWork) && !(G.same(ie, t) && G.same(we && { sha: we.sha, mode: we.mode }, t))) { local.push(k); return; }
        } else if (we && !(t && we.sha === t.sha) && !st.ign.ignored(k, false)) { untracked.push(k); return; }
      }
      todo.push(k);
    });
    if (local.length || untracked.length) return { local: local, untracked: untracked };
    if (opts.dryRun) return null;
    todo.forEach(function (k) {
      var t = target[k];
      if (t) { idx.entries[k] = t; G.writeWork(c.repo, k, t.sha, t.mode, umask(c)); }
      else { delete idx.entries[k]; if (st.work[k]) G.removeWork(c.repo, k); }
      delete idx.conflicts[k];
    });
    if (opts.force) {
      // hard reset: tracked files that differ go back to the target too
      keys(idx.entries).forEach(function (k) {
        var t = target[k];
        if (!t) { delete idx.entries[k]; if (st.work[k]) G.removeWork(c.repo, k); return; }
        var w = G.nodeAt(c.sys, G.workPath(c.repo, k)), we = w && w.type !== "d" ? G.workEntryNode(w) : null;
        if (!G.same(we && { sha: we.sha, mode: we.mode }, t)) G.writeWork(c.repo, k, t.sha, t.mode, umask(c));
        idx.entries[k] = t;
      });
      keys(idx.conflicts).forEach(function (k) { var t = target[k]; if (t) { idx.entries[k] = t; G.writeWork(c.repo, k, t.sha, t.mode, umask(c)); } else G.removeWork(c.repo, k); });
      idx.conflicts = {};
      keys(target).forEach(function (k) { if (!idx.entries[k]) { idx.entries[k] = target[k]; G.writeWork(c.repo, k, target[k].sha, target[k].mode, umask(c)); } });
    }
    G.writeIndex(c.repo, idx);
    return null;
  }
  function overwriteError(c, prob, verb, what) {
    if (prob.local.length) {
      c.o.err("error: Your local changes to the following files would be overwritten by " + verb + ":\n" + prob.local.map(function (k) { return "\t" + showPath(c, k); }).join("\n") + "\nPlease commit your changes or stash them before you " + what + ".");
    }
    if (prob.untracked.length) {
      c.o.err("error: The following untracked working tree files would be overwritten by " + verb + ":\n" + prob.untracked.map(function (k) { return "\t" + showPath(c, k); }).join("\n") + "\nPlease move or remove them before you " + what + ".");
    }
    c.o.err("Aborting");
  }
  function localChangeList(c) {
    var st = computeStatus(c), rows = {};
    st.staged.forEach(function (x) { rows[x.path] = { "new file": "A", deleted: "D", renamed: "R" }[x.type] || "M"; });
    st.unstaged.forEach(function (x) { rows[x.path] = x.type === "deleted" ? "D" : "M"; });
    return keys(rows).sort().map(function (k) { return rows[k] + "\t" + showPath(c, k); });
  }
  function orphanWarning(c, oldSha, newSha) {
    if (!oldSha) return;
    var reach = {};
    G.listRefs(c.repo, "refs/").forEach(function (r) { if (/^refs\/(heads|tags|remotes)\//.test(r.name)) G.ancestors(c.sys, G.peel(c.sys, r.sha), reach); });
    if (newSha) G.ancestors(c.sys, newSha, reach);
    if (reach[oldSha]) return;
    var lost = walk(c, [oldSha], keys(reach).length ? keys(reach).filter(function (k) { return reach[k]; }).slice(0, 1).concat([]) : [], {}).filter(function (s) { return !reach[s]; });
    c.o.err("Warning: you are leaving " + plural(lost.length, "commit", "commits") + " behind, not connected to\nany of your branches:\n\n" + lost.slice(0, 4).map(function (s) { return "  " + short(s) + " " + subject(G.commitOf(c.sys, s).message); }).join("\n") + (lost.length > 4 ? "\n ... and " + (lost.length - 4) + " more." : "") + "\n\nIf you want to keep " + (lost.length === 1 ? "it" : "them") + " by creating a new branch, this may be a good time\nto do so with:\n\n git branch <new-branch-name> " + short(oldSha) + "\n");
  }
  function validBranchName(n) { return /^[^\s~^:?*[\\]+$/.test(n) && !/(^|\/)\.|\.\.|\.lock$|\/$|^-|@\{|\/\//.test(n) && n !== "@" && n !== "HEAD"; }
  // switch HEAD to a branch (or detach at sha).
  function doSwitch(c, opts) {
    var repo = c.repo, h = G.head(repo), who = softIdent(c);
    var targetSha = opts.sha;
    var target = G.commitFlat(c.sys, targetSha);
    var prob = moveTree(c, target, { force: opts.force });
    if (prob) { overwriteError(c, prob, "checkout", "switch branches"); return 1; }
    var fromName = h.detached ? h.sha : h.branch;
    if (opts.create) {
      var exists = !!G.resolveRefName(repo, "refs/heads/" + opts.branch).sha;
      G.updateRef(repo, "refs/heads/" + opts.branch, targetSha, "branch: " + (opts.reset && exists ? "Reset to " : "Created from ") + (opts.startName || "HEAD"), who);
    }
    var toName = opts.branch || targetSha;
    if (opts.branch) G.setHead(repo, "refs/heads/" + opts.branch, "checkout: moving from " + fromName + " to " + opts.branch, who);
    else G.setHead(repo, targetSha, "checkout: moving from " + fromName + " to " + (opts.label || targetSha), who);
    if (h.detached && h.sha && h.sha !== targetSha) orphanWarning(c, h.sha, targetSha);
    else if (h.detached && opts.branch && !opts.quiet) { /* nothing */ }
    var lc = localChangeList(c);
    if (!opts.quiet) lc.forEach(function (l) { c.o.line(l); });
    if (opts.quiet) return 0;
    if (!opts.branch) {
      if (opts.advice && G.configBool(cfg(c, "advice.detachedhead"), true)) {
        c.o.line("Note: switching to '" + (opts.label || targetSha) + "'.\n\nYou are in 'detached HEAD' state. You can look around, make experimental\nchanges and commit them, and you can discard any commits you make in this\nstate without impacting any branches by switching back to a branch.\n\nIf you want to create a new branch to retain commits you create, you may\ndo so (now or later) by using -c with the switch command. Example:\n\n  git switch -c <new-branch-name>\n\nOr undo this operation with:\n\n  git switch -\n\nTurn off this advice by setting config variable advice.detachedHead to false\n");
      } else if (h.detached && h.sha && h.sha !== targetSha) c.o.line("Previous HEAD position was " + short(h.sha) + " " + subject(G.commitOf(c.sys, h.sha).message));
      c.o.line("HEAD is now at " + short(targetSha) + " " + subject(G.commitOf(c.sys, targetSha).message));
      return 0;
    }
    if (h.detached && h.sha && h.sha !== targetSha && !opts.create) c.o.line("Previous HEAD position was " + short(h.sha) + " " + subject(G.commitOf(c.sys, h.sha).message));
    if (opts.create) c.o.line(opts.reset && G.resolveRefName(repo, "refs/heads/" + opts.branch).sha && opts.existed ? "Switched to and reset branch '" + opts.branch + "'" : "Switched to a new branch '" + opts.branch + "'");
    else if (!h.detached && h.branch === opts.branch) c.o.line("Already on '" + opts.branch + "'");
    else c.o.line("Switched to branch '" + opts.branch + "'");
    var tl = trackingLines(c, G.head(repo));
    tl.forEach(function (l) { c.o.line(l); });
    return 0;
  }
  function previousBranch(c) {
    var prev = null;
    G.reflog(c.repo, "HEAD").some(function (e) { var mv = /^checkout: moving from (.+) to (.+)$/.exec(e.msg); if (mv) { prev = mv[1]; return true; } return false; });
    return prev;
  }
  // A remote branch with this name -> create a tracking branch (git switch feature when origin/feature exists).
  function guessRemote(c, name) {
    var hits = G.listRefs(c.repo, "refs/remotes/").filter(function (r) { return r.name.replace(/^refs\/remotes\/[^/]+\//, "") === name && !/\/HEAD$/.test(r.name); });
    return hits.length === 1 ? hits[0] : null;
  }
  function setUpstream(c, branch, remoteRef) {
    var m = /^refs\/remotes\/([^/]+)\/(.+)$/.exec(remoteRef);
    if (!m) return;
    var path = G.gpath(c.repo, "config");
    var t = G.readText(c.sys, path) || "";
    t = G.setInConfig(t, "branch." + branch + ".remote", m[1]);
    t = G.setInConfig(t, "branch." + branch + ".merge", "refs/heads/" + m[2]);
    G.putFile(c.sys, path, t, 436, c.repo.uid, c.repo.gid);
  }
  function cmdSwitch(c, args) {
    needWork(c);
    var p = parseOpts(c, args, ["c|create=", "C|force-create=", "d|detach", "f|force", "discard-changes", "q|quiet", "t|track=?", "no-track", "guess", "orphan="], "git switch [<options>] [<branch>]");
    var o = p.o, a = p.rest;
    if (o.orphan) {
      var ob = o.orphan;
      if (!validBranchName(ob)) die(c, "fatal: '" + ob + "' is not a valid branch name");
      var prob0 = moveTree(c, {}, { force: true });
      G.setHead(c.repo, "refs/heads/" + ob, "checkout: moving from " + (G.head(c.repo).branch || "HEAD") + " to " + ob, softIdent(c));
      c.o.line("Switched to a new branch '" + ob + "'");
      return 0;
    }
    if (o.create || o["force-create"]) {
      var nb = o.create || o["force-create"];
      if (!validBranchName(nb)) die(c, "fatal: '" + nb + "' is not a valid branch name");
      var existed = !!G.resolveRefName(c.repo, "refs/heads/" + nb).sha;
      if (existed && !o["force-create"]) die(c, "fatal: a branch named '" + nb + "' already exists");
      var startName = a[0] || "HEAD", start = a[0] ? commitRev(c, a[0]) : G.head(c.repo).sha;
      if (!start) die(c, "fatal: invalid reference: HEAD");
      var rc = doSwitch(c, { branch: nb, sha: start, create: true, reset: !!o["force-create"], existed: existed, startName: startName, force: o.force || o["discard-changes"], quiet: o.quiet });
      if (rc === 0 && a[0] && /^refs\/remotes\//.test(G.refFull(c.repo, a[0]) || "") && o["no-track"] !== true) { setUpstream(c, nb, G.refFull(c.repo, a[0])); if (!o.quiet) c.o.line("branch '" + nb + "' set up to track '" + a[0] + "'."); }
      return rc;
    }
    if (!a.length) die(c, "fatal: missing branch or commit argument");
    var name = a[0];
    if (name === "-") { name = previousBranch(c); if (!name) die(c, "fatal: invalid reference: @{-1}"); }
    if (o.detach) { var ds = commitRev(c, name); return doSwitch(c, { sha: ds, label: name, force: o.force, quiet: o.quiet, advice: false }); }
    var ref = G.resolveRefName(c.repo, "refs/heads/" + name);
    if (!ref.sha) {
      var gr = guessRemote(c, name);
      if (gr) { var rc2 = doSwitch(c, { branch: name, sha: gr.sha, create: true, startName: gr.name.slice(13), force: o.force, quiet: true }); if (rc2) return rc2; setUpstream(c, name, gr.name); if (!o.quiet) { c.o.line("branch '" + name + "' set up to track '" + gr.name.slice(13) + "'."); c.o.line("Switched to a new branch '" + name + "'"); } return 0; }
      var any = tryRev(c, name);
      if (any) {
        var kind = G.resolveRefName(c.repo, "refs/tags/" + name).sha ? "tag" : G.resolveRefName(c.repo, "refs/remotes/" + name).sha ? "remote-tracking branch" : "commit";
        die(c, "fatal: a branch is expected, got " + kind + " '" + name + "'\nhint: If you want to detach HEAD at the commit, try again with the --detach option.");
      }
      die(c, "fatal: invalid reference: " + name);
    }
    return doSwitch(c, { branch: name, sha: ref.sha, force: o.force || o["discard-changes"], quiet: o.quiet });
  }
  // restore paths from a source into the index and/or working tree
  function restorePaths(c, specs, o) {
    var st = computeStatus(c), idx = st.idx;
    var m = matcher(c, specs);
    var src = o.source !== undefined ? G.commitFlat(c.sys, commitRev(c, o.source)) : o.staged ? st.headFlat : idx.entries;
    if (o.source === undefined && o.staged && !st.head.sha) src = {};
    var cand = {};
    keys(src).forEach(function (k) { cand[k] = 1; });
    if (o.staged) keys(idx.entries).forEach(function (k) { cand[k] = 1; });
    if (o.worktree && o.source !== undefined) keys(idx.entries).forEach(function (k) { if (!o.noOverlay) return; cand[k] = 1; });
    keys(idx.conflicts).forEach(function (k) { cand[k] = 1; });
    var failed = false;
    m.list.forEach(function (one) {
      if (!keys(cand).some(function (k) { return m.hit(k, one); })) { c.o.err("error: pathspec '" + one.spec + "' did not match any file(s) known to git"); failed = true; }
    });
    if (failed) return 1;
    var unmergedErr = [];
    keys(cand).sort().forEach(function (k) {
      if (!m(k)) return;
      var s = src[k];
      if (idx.conflicts[k] && o.worktree && !o.staged && o.source === undefined) {
        var side = o.ours ? 2 : o.theirs ? 3 : 0;
        if (!side) { unmergedErr.push(k); return; }
        var e = idx.conflicts[k][side];
        if (!e) { c.o.err("error: path '" + k + "' does not have " + (side === 2 ? "our" : "their") + " version"); return; }
        G.writeWork(c.repo, k, e.sha, e.mode, umask(c));
        return;
      }
      if (o.staged) { if (s) idx.entries[k] = s; else delete idx.entries[k]; delete idx.conflicts[k]; }
      if (o.worktree) {
        if (s) G.writeWork(c.repo, k, s.sha, s.mode, umask(c));
        else if (o.staged || o.noOverlay) G.removeWork(c.repo, k);
      }
    });
    G.writeIndex(c.repo, idx);
    if (unmergedErr.length) { unmergedErr.forEach(function (k) { c.o.err("error: path '" + k + "' is unmerged"); }); return 1; }
    return 0;
  }
  function cmdRestore(c, args) {
    needWork(c);
    var p = parseOpts(c, args, ["s|source=", "S|staged", "W|worktree", "ours", "theirs", "q|quiet", "p|patch", "overlay", "m|merge"], "git restore [<options>] [--source=<branch>] <file>...");
    var specs = p.rest.concat(p.paths || []);
    if (p.o.patch) die(c, "(git restore -p asks about each change interactively, which this lab's terminal can't do.)", 1);
    if (!specs.length) die(c, "fatal: you must specify path(s) to restore");
    var staged = !!p.o.staged, worktree = !!p.o.worktree || !staged;
    return restorePaths(c, specs, { source: p.o.source, staged: staged, worktree: worktree, ours: p.o.ours, theirs: p.o.theirs, noOverlay: true });
  }
  function cmdCheckout(c, args) {
    needWork(c);
    var p = parseOpts(c, args, ["b=", "B=", "f|force", "detach", "q|quiet", "ours", "theirs", "t|track=?", "no-track", "orphan=", "m|merge", "p|patch"], "git checkout [<options>] <branch>");
    var o = p.o, a = p.rest, paths = p.paths;
    if (o.b || o.B) {
      var nb = o.b || o.B;
      if (!validBranchName(nb)) die(c, "fatal: '" + nb + "' is not a valid branch name");
      var existed = !!G.resolveRefName(c.repo, "refs/heads/" + nb).sha;
      if (existed && !o.B) die(c, "fatal: a branch named '" + nb + "' already exists");
      var start = a[0] ? commitRev(c, a[0]) : G.head(c.repo).sha;
      var rc = doSwitch(c, { branch: nb, sha: start, create: true, reset: !!o.B, existed: existed, startName: a[0] || "HEAD", force: o.force, quiet: o.quiet });
      if (rc === 0 && a[0] && /^refs\/remotes\//.test(G.refFull(c.repo, a[0]) || "") && o["no-track"] !== true) { setUpstream(c, nb, G.refFull(c.repo, a[0])); if (!o.quiet) c.o.line("branch '" + nb + "' set up to track '" + a[0] + "'."); }
      return rc;
    }
    if (o.orphan) return cmdSwitch(c, ["--orphan", o.orphan]);
    // checkout paths: "git checkout [rev] -- paths" or "git checkout file"
    if (paths !== null || o.ours || o.theirs) {
      var revSpec = paths !== null ? a[0] : null, specs = paths !== null ? paths : a;
      if (!specs.length) die(c, "fatal: you must specify path(s) to restore");
      if (revSpec) return restorePaths(c, specs, { source: revSpec, staged: true, worktree: true });
      return restorePaths(c, specs, { worktree: true, ours: o.ours, theirs: o.theirs });
    }
    if (!a.length) { localChangeList(c).forEach(function (l) { c.o.line(l); }); trackingLines(c, G.head(c.repo)).forEach(function (l) { c.o.line(l); }); return 0; }
    var name = a[0];
    if (name === "-") { name = previousBranch(c); if (!name) die(c, "error: pathspec '-' did not match any file(s) known to git", 1); }
    if (a.length === 1) {
      var ref = G.resolveRefName(c.repo, "refs/heads/" + name);
      if (ref.sha && !o.detach) return doSwitch(c, { branch: name, sha: ref.sha, force: o.force, quiet: o.quiet });
      var sha = tryRev(c, name);
      if (sha && G.commitOf(c.sys, sha) && !(sha && !ref.sha && guessRemote(c, name) && !o.detach && !/^[0-9a-f]+$/.test(name) && false)) {
        if (!ref.sha && !o.detach) { var gr = guessRemote(c, name); if (gr && !G.resolveRefName(c.repo, "refs/tags/" + name).sha && !/^[0-9a-f]{4,}$/.test(name)) { /* fall through to dwim below */ } else return doSwitch(c, { sha: G.peel(c.sys, sha), label: name, force: o.force, quiet: o.quiet, advice: true }); }
        else return doSwitch(c, { sha: G.peel(c.sys, sha), label: name, force: o.force, quiet: o.quiet, advice: !o.detach || true });
      }
      var gr2 = guessRemote(c, name);
      if (gr2) { var rc3 = doSwitch(c, { branch: name, sha: gr2.sha, create: true, startName: gr2.name.slice(13), force: o.force, quiet: true }); if (rc3) return rc3; setUpstream(c, name, gr2.name); c.o.line("branch '" + name + "' set up to track '" + gr2.name.slice(13) + "'."); c.o.line("Switched to a new branch '" + name + "'"); return 0; }
    }
    // not a revision: paths
    var revFirst = a.length > 1 ? tryRev(c, a[0]) : null;
    if (revFirst) return restorePaths(c, a.slice(1), { source: a[0], staged: true, worktree: true });
    var st = computeStatus(c), known = keys(st.idx.entries).concat(keys(st.idx.conflicts));
    var m = matcher(c, a);
    var ok = m.list.every(function (one) { return known.some(function (k) { return m.hit(k, one); }); });
    if (!ok) { m.list.forEach(function (one) { if (!known.some(function (k) { return m.hit(k, one); })) c.o.err("error: pathspec '" + one.spec + "' did not match any file(s) known to git"); }); return 1; }
    var rc4 = restorePaths(c, a, { worktree: true });
    if (rc4 === 0 && !o.quiet) { var n = known.filter(function (k) { return m(k); }).length; c.o.line("Updated " + plural(n, "path", "paths") + " from the index"); }
    return rc4;
  }

  /* ================================================================== branch */
  function cmdBranch(c, args) {
    needRepo(c);
    var p = parseOpts(c, args, ["d|delete", "D", "m|move", "M", "c|copy", "C", "f|force", "v|verbose", "a|all", "r|remotes", "l|list", "merged=?", "no-merged=?", "show-current", "u|set-upstream-to=", "unset-upstream", "t|track=?", "no-track", "contains=?", "q|quiet", "sort=", "format=", "column", "no-column", "color=?", "edit-description", "points-at="], "git branch [<options>] [-r | -a] [--merged] [--no-merged]");
    var o = p.o, a = p.rest, repo = c.repo, h = G.head(repo), who = softIdent(c);
    if (o["show-current"]) { if (!h.detached) c.o.line(h.branch); return 0; }
    if (o.delete || o.D) {
      if (!a.length) die(c, "fatal: branch name required");
      var rc = 0;
      a.forEach(function (n) {
        if (o.remotes) {
          var rr = G.resolveRefName(repo, "refs/remotes/" + n);
          if (!rr.sha) { c.o.err("error: remote-tracking branch '" + n + "' not found"); rc = 1; return; }
          G.updateRef(repo, "refs/remotes/" + n, null); c.o.line("Deleted remote-tracking branch " + n + " (was " + short(rr.sha) + ")."); return;
        }
        var r = G.resolveRefName(repo, "refs/heads/" + n);
        if (!r.sha) { c.o.err("error: branch '" + n + "' not found"); rc = 1; return; }
        if (!h.detached && h.branch === n) { c.o.err("error: cannot delete branch '" + n + "' used by worktree at '" + repo.top + "'"); rc = 1; return; }
        if (!o.D && !o.force) {
          var up = G.upstreamOf(repo, n), upSha = up ? G.resolveRefName(repo, up).sha : null;
          var against = upSha || h.sha;
          if (!against || !G.isAncestor(c.sys, r.sha, against)) {
            c.o.err("error: the branch '" + n + "' is not fully merged");
            c.o.hint("If you are sure you want to delete it, run 'git branch -D " + n + "'\nDisable this message with \"git config advice.forceDeleteBranch false\"");
            rc = 1; return;
          }
        }
        G.updateRef(repo, "refs/heads/" + n, null);
        var cfgPath = G.gpath(repo, "config"), t = G.readText(c.sys, cfgPath);
        if (t && /\[branch "/.test(t)) { t = G.setInConfig(t, "branch." + n + ".remote", null); t = G.setInConfig(t, "branch." + n + ".merge", null); G.putFile(c.sys, cfgPath, t, 436, repo.uid, repo.gid); }
        c.o.line("Deleted branch " + n + " (was " + short(r.sha) + ").");
      });
      return rc;
    }
    if (o.move || o.M || o.copy || o.C) {
      var from = a.length === 2 ? a[0] : h.branch, to = a.length === 2 ? a[1] : a[0];
      if (!to) die(c, "fatal: branch name required");
      if (!validBranchName(to)) die(c, "fatal: '" + to + "' is not a valid branch name");
      var fr = G.resolveRefName(repo, "refs/heads/" + from);
      var unborn = !fr.sha && !h.detached && h.branch === from;
      if (!fr.sha && !unborn) die(c, "error: refname refs/heads/" + from + " not found\nfatal: branch rename failed", 128);
      if (G.resolveRefName(repo, "refs/heads/" + to).sha && !(o.M || o.C) && from !== to) die(c, "fatal: a branch named '" + to + "' already exists");
      if (unborn) { G.gwrite(repo, "HEAD", "ref: refs/heads/" + to + "\n"); return 0; }
      var log = G.gread(repo, "logs/refs/heads/" + from);
      G.gwrite(repo, "refs/heads/" + to, fr.sha + "\n");
      if (log) G.gwrite(repo, "logs/refs/heads/" + to, log);
      G.logRef(repo, "refs/heads/" + to, fr.sha, fr.sha, (o.copy || o.C ? "Branch: copied refs/heads/" : "Branch: renamed refs/heads/") + from + " to refs/heads/" + to, who);
      if (o.move || o.M) {
        if (from !== to) G.updateRef(repo, "refs/heads/" + from, null);
        if (!h.detached && h.branch === from) G.gwrite(repo, "HEAD", "ref: refs/heads/" + to + "\n");
      }
      return 0;
    }
    if (o["set-upstream-to"] !== undefined) {
      var target = o["set-upstream-to"], br = a[0] || h.branch;
      var full = G.refFull(repo, target);
      if (!full) die(c, "fatal: the requested upstream branch '" + target + "' does not exist");
      if (/^refs\/remotes\//.test(full)) setUpstream(c, br, full);
      else { var t2 = G.readText(c.sys, G.gpath(repo, "config")); t2 = G.setInConfig(t2, "branch." + br + ".remote", "."); t2 = G.setInConfig(t2, "branch." + br + ".merge", full); G.putFile(c.sys, G.gpath(repo, "config"), t2, 436, repo.uid, repo.gid); }
      c.o.line("branch '" + br + "' set up to track '" + full.replace(/^refs\/(remotes|heads)\//, "") + "'.");
      return 0;
    }
    if (o["unset-upstream"]) { var br2 = a[0] || h.branch, t3 = G.readText(c.sys, G.gpath(repo, "config")); t3 = G.setInConfig(t3, "branch." + br2 + ".remote", null); t3 = G.setInConfig(t3, "branch." + br2 + ".merge", null); G.putFile(c.sys, G.gpath(repo, "config"), t3, 436, repo.uid, repo.gid); return 0; }
    // create
    if (a.length && !o.list && o.merged === undefined && o["no-merged"] === undefined && o.contains === undefined) {
      var nb = a[0];
      if (!validBranchName(nb)) die(c, "fatal: '" + nb + "' is not a valid branch name");
      if (G.resolveRefName(repo, "refs/heads/" + nb).sha && !o.force) die(c, "fatal: a branch named '" + nb + "' already exists");
      if (!a[1] && !h.sha) die(c, "fatal: not a valid object name: '" + (h.branch || "HEAD") + "'");
      var start = a[1] ? commitRev(c, a[1]) : h.sha;
      G.updateRef(repo, "refs/heads/" + nb, start, "branch: Created from " + (a[1] || "HEAD"), who);
      var sfull = a[1] ? G.refFull(repo, a[1]) : null;
      if ((o.track || (sfull && /^refs\/remotes\//.test(sfull))) && o["no-track"] !== true && sfull && /^refs\/remotes\//.test(sfull)) { setUpstream(c, nb, sfull); c.o.line("branch '" + nb + "' set up to track '" + a[1] + "'."); }
      return 0;
    }
    // list
    var rows = [];
    if (!o.remotes) {
      if (h.detached) {
        var label = G.gexists(repo, "BISECT_START") ? "(no branch, bisect started on " + G.gread(repo, "BISECT_START").trim() + ")" : "(" + headLine(c, h).replace(/^HEAD /, "HEAD ") + ")";
        rows.push({ name: label, sha: h.sha, cur: true, kind: "head" });
      }
      G.listRefs(repo, "refs/heads/").forEach(function (r) { rows.push({ name: r.name.slice(11), sha: r.sha, cur: !h.detached && r.name === h.ref, kind: "local", ref: r.name }); });
    }
    if (o.all || o.remotes) G.listRefs(repo, "refs/remotes/").forEach(function (r) {
      var v = G.readRef(repo, r.name);
      rows.push({ name: (o.all ? "remotes/" : "") + r.name.slice(13), sha: G.resolveRefName(repo, r.name).sha, kind: "remote", sym: v && v.indexOf("ref: ") === 0 ? v.slice(5).replace(/^refs\/remotes\//, "") : null });
    });
    var filt = a.length ? a.map(function (g) { return new RegExp("^" + G.globToRe(g) + "$"); }) : null;
    if (filt) rows = rows.filter(function (r) { return r.kind === "head" || filt.some(function (re) { return re.test(r.name); }); });
    if (o.merged !== undefined) { var mt = o.merged === true ? h.sha : commitRev(c, o.merged); rows = rows.filter(function (r) { return r.sha && G.isAncestor(c.sys, r.sha, mt); }); }
    if (o["no-merged"] !== undefined) { var nt = o["no-merged"] === true ? h.sha : commitRev(c, o["no-merged"]); rows = rows.filter(function (r) { return r.sha && !G.isAncestor(c.sys, r.sha, nt); }); }
    if (o.contains !== undefined) { var ct = o.contains === true ? h.sha : commitRev(c, o.contains); rows = rows.filter(function (r) { return r.sha && G.isAncestor(c.sys, ct, r.sha); }); }
    if (o["points-at"] !== undefined) { var pt = commitRev(c, o["points-at"]); rows = rows.filter(function (r) { return r.sha === pt; }); }
    if (o.format) { rows.forEach(function (r) { var co = G.commitOf(c.sys, r.sha); c.o.line(fmtPlaceholder(c, r.sha, co, o.format.replace(/%\(refname:short\)/g, r.name).replace(/%\(refname\)/g, r.ref || r.name).replace(/%\(objectname:short\)/g, short(r.sha)).replace(/%\(subject\)/g, subject(co.message)), null)); }); return 0; }
    var w = Math.max.apply(null, [0].concat(rows.map(function (r) { return r.name.length; })));
    rows.forEach(function (r) {
      var mark = r.cur ? "* " : "  ";
      var col = r.cur ? "green" : r.kind === "remote" ? "red" : null;
      if (r.sym) { c.o.line(mark + r.name + " -> " + r.sym, col); return; }
      if (!o.verbose) { c.o.line(mark + r.name, col); return; }
      var co = r.sha ? G.commitOf(c.sys, r.sha) : null;
      var extra = "";
      if (o.verbose && r.kind === "local") {
        var up = G.upstreamOf(repo, r.name);
        if (up) {
          var upSha = G.resolveRefName(repo, up).sha, upName = up.replace(/^refs\/remotes\//, "");
          var parts = [];
          if (!upSha) parts.push("gone");
          else { var ab = aheadBehind(c, r.sha, upSha); if (ab.ahead) parts.push("ahead " + ab.ahead); if (ab.behind) parts.push("behind " + ab.behind); }
          if (c.vv) extra = "[" + upName + (parts.length ? ": " + parts.join(", ") : "") + "] ";
          else if (parts.length) extra = "[" + parts.join(", ") + "] ";
        }
      }
      c.o.line(mark + pad(r.name, w) + " " + short(r.sha) + " " + extra + (co ? subject(co.message) : ""), col);
    });
    return 0;
  }

  /* ================================================================== reset */
  function cmdReset(c, args) {
    needWork(c);
    var p = parseOpts(c, args, ["soft", "mixed", "hard", "merge", "keep", "q|quiet", "p|patch", "N|intent-to-add"], "git reset [--mixed | --soft | --hard | --merge | --keep] [-q] [<commit>]");
    var o = p.o, repo = c.repo, h = G.head(repo), who = softIdent(c);
    var a = p.rest, paths = p.paths;
    var target = null, targetSpec = "HEAD";
    if (a.length && paths === null) {
      var t = tryRev(c, a[0]);
      if (t && G.commitOf(c.sys, t)) { target = G.peel(c.sys, t); targetSpec = a[0]; a = a.slice(1); }
    } else if (a.length && paths !== null) { target = commitRev(c, a[0]); targetSpec = a[0]; a = a.slice(1); }
    var specs = a.concat(paths || []);
    if (specs.length) {
      if (o.soft || o.hard) die(c, "fatal: Cannot do " + (o.soft ? "soft" : "hard") + " reset with paths.");
      var tf = target ? G.commitFlat(c.sys, target) : h.sha ? G.commitFlat(c.sys, h.sha) : {};
      var idx = G.readIndex(repo), m = matcher(c, specs);
      keys(Object.assign({}, idx.entries, idx.conflicts, tf)).forEach(function (k) {
        if (!m(k)) return;
        if (tf[k]) idx.entries[k] = tf[k]; else delete idx.entries[k];
        delete idx.conflicts[k];
      });
      G.writeIndex(repo, idx);
      if (!o.quiet) { var lc = unstagedList(c); if (lc.length) { c.o.line("Unstaged changes after reset:"); lc.forEach(function (l) { c.o.line(l); }); } }
      return 0;
    }
    if (!target) {
      if (!h.sha) {
        if (o.hard || o.soft) die(c, "fatal: ambiguous argument 'HEAD': unknown revision or path not in the working tree.");
        var idx0 = G.readIndex(repo); idx0.entries = {}; idx0.conflicts = {}; G.writeIndex(repo, idx0); return 0;
      }
      target = h.sha;
    }
    var mode = o.soft ? "soft" : o.hard ? "hard" : o.merge ? "merge" : o.keep ? "keep" : "mixed";
    if (mode === "soft" && (G.gexists(repo, "MERGE_HEAD") || keys(G.readIndex(repo).conflicts).length)) die(c, "fatal: Cannot do a soft reset in the middle of a merge.");
    var tflat = G.commitFlat(c.sys, target);
    if (mode === "keep") { var pr = moveTree(c, tflat, {}); if (pr) { c.o.err("error: Entry '" + (pr.local[0] || pr.untracked[0]) + "' not uptodate. Cannot merge.\nfatal: Could not reset index file to revision '" + targetSpec + "'."); return 128; } }
    if (mode === "hard" || mode === "merge") moveTree(c, tflat, { force: true });
    if (mode === "mixed") { var idx2 = G.readIndex(repo); idx2.entries = Object.assign({}, tflat); idx2.conflicts = {}; G.writeIndex(repo, idx2); }
    if (h.sha) G.gwrite(repo, "ORIG_HEAD", h.sha + "\n");
    var msg = "reset: moving to " + targetSpec;
    if (h.detached) G.setHead(repo, target, msg, who);
    else G.updateRef(repo, h.ref, target, msg, who);
    if (mode !== "soft") ["MERGE_HEAD", "MERGE_MSG", "MERGE_MODE", "AUTO_MERGE", "REVERT_HEAD", "CHERRY_PICK_HEAD", "SQUASH_MSG"].forEach(function (f) { G.gremove(repo, f); });
    if (o.quiet) return 0;
    if (mode === "hard" || mode === "merge" || mode === "keep") c.o.line("HEAD is now at " + short(target) + " " + subject(G.commitOf(c.sys, target).message));
    else if (mode === "mixed") { var l2 = unstagedList(c); if (l2.length) { c.o.line("Unstaged changes after reset:"); l2.forEach(function (l) { c.o.line(l); }); } }
    return 0;
  }
  function unstagedList(c) {
    var st = computeStatus(c);
    return st.unstaged.map(function (x) { return (x.type === "deleted" ? "D" : "M") + "\t" + x.path; });
  }

  /* ================================================================== merge, revert, cherry-pick */
  function writeMergeState(c, list) { list.forEach(function (kv) { G.gwrite(c.repo, kv[0], kv[1]); }); }
  // Apply a tree merge to the index and working tree. Returns {conflicts: [paths]} or {error}.
  function applyMerge(c, mr, oursFlat) {
    var st = computeStatus(c), idx = st.idx;
    var touched = {};
    keys(oursFlat).forEach(function (k) { if (!G.same(oursFlat[k], mr.entries[k]) || mr.conflicts[k]) touched[k] = 1; });
    keys(mr.entries).forEach(function (k) { if (!G.same(oursFlat[k], mr.entries[k])) touched[k] = 1; });
    keys(mr.conflicts).forEach(function (k) { touched[k] = 1; });
    var local = [], untracked = [];
    // a dirty index blocks a merge
    st.staged.forEach(function (x) { local.push(x.path); });
    keys(touched).forEach(function (k) {
      var ie = idx.entries[k], w = st.work[k];
      if (ie && w && !G.same(G.workEntryNode(w) && { sha: G.workEntryNode(w).sha, mode: G.workEntryNode(w).mode }, ie)) { if (local.indexOf(k) < 0) local.push(k); }
      else if (ie && !w) { if (local.indexOf(k) < 0) local.push(k); }
      else if (!ie && w && !st.ign.ignored(k, false)) { var res = mr.entries[k] || (mr.conflicts[k] && mr.conflicts[k].work); if (!res || res.sha !== G.workEntryNode(w).sha) untracked.push(k); }
    });
    if (local.length || untracked.length) return { error: { local: local, untracked: untracked } };
    keys(touched).forEach(function (k) {
      var r = mr.entries[k];
      if (mr.conflicts[k]) {
        var x = mr.conflicts[k];
        delete idx.entries[k];
        idx.conflicts[k] = { 1: x[1], 2: x[2], 3: x[3] };
        if (x.work) G.writeWork(c.repo, k, x.work.sha, x.work.mode, umask(c)); else G.removeWork(c.repo, k);
      } else if (r) { idx.entries[k] = r; G.writeWork(c.repo, k, r.sha, r.mode, umask(c)); }
      else { delete idx.entries[k]; G.removeWork(c.repo, k); }
    });
    G.writeIndex(c.repo, idx);
    storeObjects(c);
    return { conflicts: keys(mr.conflicts).sort() };
  }
  function mergeMessages(c, mr) { mr.messages.forEach(function (m) { c.o.line(m.t); }); }
  function cmdMerge(c, args) {
    needWork(c);
    var p = parseOpts(c, args, ["m|message=+", "no-ff", "ff", "ff-only", "squash", "no-commit", "commit", "no-edit", "e|edit", "abort", "continue", "quit", "allow-unrelated-histories", "s|strategy=", "X|strategy-option=+", "q|quiet", "v|verbose", "stat", "n|no-stat", "log=?", "no-verify", "conflict="], "git merge [<options>] [<commit>...]");
    var o = p.o, repo = c.repo, h = G.head(repo), who;
    if (o.abort) {
      if (!G.gexists(repo, "MERGE_HEAD")) die(c, "fatal: There is no merge to abort (MERGE_HEAD missing).");
      var orig = (G.gread(repo, "ORIG_HEAD") || "").trim() || h.sha;
      moveTree(c, G.commitFlat(c.sys, h.sha), { force: true });
      ["MERGE_HEAD", "MERGE_MSG", "MERGE_MODE", "AUTO_MERGE"].forEach(function (f) { G.gremove(repo, f); });
      return 0;
    }
    if (o.continue) {
      if (!G.gexists(repo, "MERGE_HEAD")) die(c, "fatal: There is no merge in progress (MERGE_HEAD missing).");
      return cmdCommit(c, ["--no-edit"]);
    }
    if (G.gexists(repo, "MERGE_HEAD")) {
      if (keys(G.readIndex(repo).conflicts).length) { c.o.err("error: Merging is not possible because you have unmerged files."); c.o.hint("Fix them up in the work tree, and then use 'git add/rm <file>'\nas appropriate to mark resolution and make a commit."); die(c, "fatal: Exiting because of an unresolved conflict."); }
      die(c, "fatal: You have not concluded your merge (MERGE_HEAD exists).\nPlease, commit your changes before you merge.");
    }
    var a = p.rest;
    if (!a.length) {
      var up = h.branch ? G.upstreamOf(repo, h.branch) : null;
      if (!up) die(c, "fatal: No remote for the current branch.");
      a = [up.replace(/^refs\/remotes\//, "")];
    }
    if (a.length > 1) die(c, "(Merging several branches at once, an \"octopus\" merge, isn't available in this lab. Merge them one at a time.)", 1);
    var name = a[0], theirs = commitRev(c, name);
    var ours = h.sha;
    var label = G.resolveRefName(repo, "refs/heads/" + name).sha ? "branch '" + name + "'" : G.resolveRefName(repo, "refs/tags/" + name).sha ? "tag '" + name + "'" : G.resolveRefName(repo, "refs/remotes/" + name).sha ? "remote-tracking branch '" + name + "'" : "commit '" + name + "'";
    var defaultMsg = "Merge " + label + (h.branch && !/^(main|master)$/.test(h.branch) && !h.detached ? " into " + h.branch : "") + "\n";
    if (!ours) {
      // merging into an unborn branch just points it at theirs
      moveTree(c, G.commitFlat(c.sys, theirs), {});
      G.updateRef(repo, h.ref, theirs, "initial pull", softIdent(c));
      return 0;
    }
    if (G.isAncestor(c.sys, theirs, ours)) { c.o.line("Already up to date."); return 0; }
    var bases = G.mergeBases(c.sys, ours, theirs);
    if (!bases.length && !o["allow-unrelated-histories"]) die(c, "fatal: refusing to merge unrelated histories");
    var canFF = bases[0] === ours;
    var ffMode = o["ff-only"] ? "only" : o["no-ff"] ? "no" : (cfg(c, "merge.ff") === "false" ? "no" : cfg(c, "merge.ff") === "only" ? "only" : "yes");
    if (o.ff) ffMode = "yes";
    if (!canFF && ffMode === "only") { c.o.hint("Diverging branches can't be fast-forwarded, you need to either:\n\n\tgit merge --no-ff\n\nor:\n\n\tgit rebase\n\nDisable this message with \"git config advice.diverging false\""); die(c, "fatal: Not possible to fast-forward, aborting."); }
    who = softIdent(c);
    if (canFF && ffMode !== "no" && !o.squash) {
      var tf = G.commitFlat(c.sys, theirs), of = G.commitFlat(c.sys, ours);
      var prob = moveTree(c, tf, {});
      if (prob) { overwriteError(c, prob, "merge", "merge"); return 2; }
      c.o.line("Updating " + short(ours) + ".." + short(theirs));
      c.o.line("Fast-forward");
      G.gwrite(repo, "ORIG_HEAD", ours + "\n");
      if (h.detached) G.setHead(repo, theirs, "merge " + name + ": Fast-forward", who);
      else G.updateRef(repo, h.ref, theirs, "merge " + name + ": Fast-forward", who);
      if (!o["no-stat"]) { var ch = changes(c, of, tf); printStat(c, ch, {}); modeSummary(c, ch); }
      return 0;
    }
    var baseFlat = bases.length ? G.commitFlat(c.sys, bases[0]) : {};
    var oursFlat = G.commitFlat(c.sys, ours), theirsFlat = G.commitFlat(c.sys, theirs);
    var style = cfg(c, "merge.conflictstyle") || o.conflict;
    var mr = G.mergeTrees(c.sys, baseFlat, oursFlat, theirsFlat, ["HEAD", name, "merged common ancestors"], style === "diff3" || style === "zdiff3" ? "diff3" : null);
    var res = applyMerge(c, mr, oursFlat);
    if (res.error) { overwriteError(c, res.error, "merge", "merge"); return 2; }
    G.gwrite(repo, "ORIG_HEAD", ours + "\n");
    mergeMessages(c, mr);
    var msg = o.message ? o.message.join("\n\n") + "\n" : defaultMsg;
    if (o.squash) {
      G.gwrite(repo, "SQUASH_MSG", "Squashed commit of the following:\n\n" + walk(c, [theirs], [ours], {}).map(function (s) { var co = G.commitOf(c.sys, s); return "commit " + s + "\nAuthor: " + co.author.name + " <" + co.author.email + ">\nDate:   " + G.fmtDate(co.author.time, co.author.tz) + "\n\n    " + subject(co.message) + "\n"; }).join("\n"));
      if (res.conflicts.length) { c.o.line("Squash commit -- not updating HEAD"); c.o.line("Automatic merge failed; fix conflicts and then commit the result."); return 1; }
      c.o.line("Squash commit -- not updating HEAD");
      c.o.line("Automatic merge went well; stopped before committing as requested");
      return 0;
    }
    if (res.conflicts.length) {
      writeMergeState(c, [["MERGE_HEAD", theirs + "\n"], ["MERGE_MODE", ""], ["MERGE_MSG", msg + "\n# Conflicts:\n" + res.conflicts.map(function (k) { return "#\t" + k + "\n"; }).join("")]]);
      c.o.line("Automatic merge failed; fix conflicts and then commit the result.");
      return 1;
    }
    if (o["no-commit"]) {
      writeMergeState(c, [["MERGE_HEAD", theirs + "\n"], ["MERGE_MODE", "no-ff"], ["MERGE_MSG", msg]]);
      c.o.line("Automatic merge went well; stopped before committing as requested");
      return 0;
    }
    var committer = ident(c, "committer");
    var tree = G.writeTree(c.sys, mr.entries);
    var co = { type: "commit", tree: tree, parents: [ours, theirs], author: ident(c, "author"), committer: committer, message: cleanupMessage(msg) };
    var sha = G.putObject(c.sys, co);
    if (h.detached) G.setHead(repo, sha, "merge " + name + ": Merge made by the 'ort' strategy.", committer);
    else G.updateRef(repo, h.ref, sha, "merge " + name + ": Merge made by the 'ort' strategy.", committer);
    storeObjects(c);
    c.o.line("Merge made by the 'ort' strategy.");
    if (!o["no-stat"]) { var ch2 = changes(c, oursFlat, mr.entries); printStat(c, ch2, {}); modeSummary(c, ch2); }
    return 0;
  }
  // Shared by revert and cherry-pick: apply the change base->theirs onto HEAD.
  function pickLike(c, kind, args) {
    needWork(c);
    var p = parseOpts(c, args, ["n|no-commit", "e|edit", "no-edit", "m|mainline=", "x", "continue", "abort", "skip", "quit", "s|signoff", "ff", "allow-empty"], "git " + kind + " [<options>] <commit>...");
    var o = p.o, repo = c.repo, STATE = kind === "revert" ? "REVERT_HEAD" : "CHERRY_PICK_HEAD";
    if (o.abort) {
      if (!G.gexists(repo, STATE) && !G.gexists(repo, "sequencer/head")) die(c, "error: no " + (kind === "revert" ? "revert" : "cherry-pick") + " in progress\nfatal: " + kind + " failed");
      var orig = (G.gread(repo, "sequencer/head") || G.gread(repo, "ORIG_HEAD") || "").trim();
      var h0 = G.head(repo);
      if (orig) { moveTree(c, G.commitFlat(c.sys, orig), { force: true }); if (h0.detached) G.setHead(repo, orig); else G.updateRef(repo, h0.ref, orig, kind + ": aborting", softIdent(c)); }
      [STATE, "MERGE_MSG", "sequencer/head", "sequencer/todo"].forEach(function (f) { G.gremove(repo, f); });
      return 0;
    }
    if (o.skip) {
      if (!G.gexists(repo, STATE)) die(c, "error: no " + kind + " in progress\nfatal: " + kind + " failed");
      moveTree(c, G.commitFlat(c.sys, G.head(repo).sha), { force: true });
      [STATE, "MERGE_MSG", "sequencer/head", "sequencer/todo"].forEach(function (f) { G.gremove(repo, f); });
      return 0;
    }
    if (o.continue) {
      if (!G.gexists(repo, STATE)) die(c, "error: no " + kind + " in progress\nfatal: " + kind + " failed");
      if (keys(G.readIndex(repo).conflicts).length) { c.o.err("error: Committing is not possible because you have unmerged files."); c.o.hint("Fix them up in the work tree, and then use 'git add/rm <file>'\nas appropriate to mark resolution and make a commit."); die(c, "fatal: Exiting because of an unresolved conflict."); }
      var src = G.commitOf(c.sys, G.gread(repo, STATE).trim());
      var msg0 = G.gread(repo, "MERGE_MSG") || "";
      var rc0 = finishPick(c, kind, msg0.replace(/\n# Conflicts:[\s\S]*$/, "\n"), kind === "cherry-pick" ? src.author : null);
      [STATE, "MERGE_MSG", "sequencer/head", "sequencer/todo"].forEach(function (f) { G.gremove(repo, f); });
      if (rc0) return rc0;
      var todo = (G.gread(repo, "sequencer/todo") || "").split("\n").filter(Boolean);
      return todo.length ? pickLike(c, kind, todo) : 0;
    }
    if (G.gexists(repo, STATE)) die(c, "error: " + (kind === "revert" ? "revert" : "cherry-pick") + " is already in progress\nhint: try \"git " + kind + " (--continue | --abort | --quit)\"\nfatal: " + kind + " failed");
    var targets = [];
    p.rest.forEach(function (s) {
      if (/\.\./.test(s)) { var rg = parseRange(c, [s]); var l = walk(c, rg.inc, rg.exc, {}); if (kind === "cherry-pick") l.reverse(); targets = targets.concat(l); }
      else targets.push(commitRev(c, s));
    });
    if (!targets.length) die(c, "usage: git " + kind + " [--[no-]edit] [-n] [-m <parent-number>] [-s] [-S[<keyid>]] <commit>...", 129);
    var h = G.head(repo);
    if (!h.sha) die(c, "fatal: your current branch '" + h.branch + "' does not have any commits yet");
    var st0 = computeStatus(c);
    if (st0.staged.length && !o["no-commit"]) { c.o.err("error: your local changes would be overwritten by " + kind + ".\nhint: commit your changes or stash them to proceed.\nfatal: " + kind + " failed"); return 128; }
    G.gwrite(repo, "ORIG_HEAD", h.sha + "\n");
    for (var i = 0; i < targets.length; i++) {
      var t = targets[i], co = G.commitOf(c.sys, t);
      if (co.parents.length > 1 && !o.mainline) die(c, "error: commit " + t + " is a merge but no -m option was given.\nfatal: " + kind + " failed");
      var parent = co.parents[(+o.mainline || 1) - 1] || null;
      var headNow = G.head(repo).sha;
      var oursFlat = G.commitFlat(c.sys, headNow);
      var base, theirs, labels, msg, author = null;
      if (kind === "revert") {
        base = G.commitFlat(c.sys, t); theirs = parent ? G.commitFlat(c.sys, parent) : {};
        labels = ["HEAD", "parent of " + short(t) + " (" + subject(co.message) + ")"];
        msg = "Revert \"" + subject(co.message) + "\"\n\nThis reverts commit " + t + (co.parents.length > 1 ? ", reversing\nchanges made to " + parent : "") + ".\n";
      } else {
        base = parent ? G.commitFlat(c.sys, parent) : {}; theirs = G.commitFlat(c.sys, t);
        labels = ["HEAD", short(t) + " (" + subject(co.message) + ")"];
        msg = co.message + (o.x ? (body(co.message) || /\n\n/.test(co.message) ? "\n" : "\n") + "(cherry picked from commit " + t + ")\n" : "");
        author = co.author;
        if (o.ff && parent === headNow) {
          moveTree(c, theirs, {});
          if (h.detached) G.setHead(repo, t); else G.updateRef(repo, h.ref, t, "cherry-pick: fast-forward", softIdent(c));
          continue;
        }
      }
      var mr = G.mergeTrees(c.sys, base, oursFlat, theirs, labels);
      var res = applyMerge(c, mr, oursFlat);
      if (res.error) { overwriteError(c, res.error, "merge", "merge"); return 128; }
      mergeMessages(c, mr);
      if (res.conflicts.length) {
        G.gwrite(repo, STATE, t + "\n");
        G.gwrite(repo, "MERGE_MSG", msg + "\n# Conflicts:\n" + res.conflicts.map(function (k) { return "#\t" + k + "\n"; }).join(""));
        if (targets.length > i + 1) G.gwrite(repo, "sequencer/todo", targets.slice(i + 1).join("\n") + "\n");
        G.gwrite(repo, "sequencer/head", (G.gread(repo, "ORIG_HEAD") || "").trim() + "\n");
        c.o.err("error: could not " + (kind === "revert" ? "revert" : "apply") + " " + short(t) + "... " + subject(co.message));
        c.o.hint("After resolving the conflicts, mark them with\n\"git add/rm <pathspec>\", then run\n\"git " + kind + " --continue\".\nYou can instead skip this commit with \"git " + kind + " --skip\".\nTo abort and get back to the state before \"git " + kind + "\",\nrun \"git " + kind + " --abort\".");
        return 1;
      }
      if (o["no-commit"]) continue;
      var tree = G.writeTree(c.sys, G.readIndex(repo).entries);
      if (tree === G.commitOf(c.sys, headNow).tree && !o["allow-empty"]) {
        if (kind === "cherry-pick") {
          c.o.line("On branch " + (G.head(repo).branch || "HEAD") + "\nYou are currently cherry-picking commit " + short(t) + ".\n  (all conflicts fixed: run \"git cherry-pick --continue\")\n  (use \"git cherry-pick --skip\" to skip this patch)\n  (use \"git cherry-pick --abort\" to cancel the cherry-pick operation)\n\nnothing to commit, working tree clean");
          c.o.err("The previous cherry-pick is now empty, possibly due to conflict resolution.\nIf you wish to commit it anyway, use:\n\n    git commit --allow-empty\n\nOtherwise, please use 'git cherry-pick --skip'");
          G.gwrite(repo, STATE, t + "\n");
          return 1;
        }
      }
      var rc = finishPick(c, kind, msg, author, o.signoff);
      if (rc) return rc;
    }
    return 0;
  }
  function finishPick(c, kind, msg, author, signoff) {
    var repo = c.repo, h = G.head(repo);
    var committer = ident(c, "committer");
    var idx = G.readIndex(repo);
    var co = { type: "commit", tree: G.writeTree(c.sys, idx.entries), parents: [h.sha], author: author ? Object.assign({}, author) : ident(c, "author"), committer: committer, message: cleanupMessage(msg) };
    if (signoff) co.message = co.message.replace(/\n$/, "") + "\n\nSigned-off-by: " + committer.name + " <" + committer.email + ">\n";
    var sha = G.putObject(c.sys, co);
    var rl = (kind === "revert" ? "revert: " : "cherry-pick: ") + subject(co.message);
    if (h.detached) G.setHead(repo, sha, rl, committer); else G.updateRef(repo, h.ref, sha, rl, committer);
    storeObjects(c);
    commitSummary(c, branchLabel(h), sha, co, { showDate: kind === "cherry-pick" });
    return 0;
  }

  /* ================================================================== stash */
  function stashList(c) { return G.reflog(c.repo, "refs/stash"); }
  function stashRef(c, spec) {
    var list = stashList(c);
    if (!list.length) die(c, "error: No stash entries found.", 1);
    var n = 0;
    if (spec !== undefined) { var m = /^(?:stash|refs\/stash)?@?\{?(\d+)\}?$/.exec(spec); if (!m) die(c, "error: '" + spec + "' is not a stash-like commit", 1); n = +m[1]; }
    if (n >= list.length) die(c, "error: stash@{" + n + "} is not a valid reference", 1);
    return { n: n, sha: list[n].sha, msg: list[n].msg, label: spec !== undefined ? "stash@{" + n + "}" : "refs/stash@{0}" };
  }
  function cmdStash(c, args) {
    needWork(c);
    var sub = args[0] && !/^-/.test(args[0]) ? args[0] : "push";
    var rest = sub === "push" && args[0] !== "push" ? args : args.slice(1);
    if (sub === "save") { sub = "push"; if (rest.length && !/^-/.test(rest[rest.length - 1])) rest = ["-m", rest.join(" ")]; }
    var repo = c.repo, h = G.head(repo), who = softIdent(c);
    if (sub === "list") { stashList(c).forEach(function (e, i) { c.o.line("stash@{" + i + "}: " + e.msg); }); return 0; }
    if (sub === "clear") { G.updateRef(repo, "refs/stash", null); G.gremove(repo, "logs/refs/stash"); return 0; }
    if (sub === "show") {
      var ps = parseOpts(c, rest, ["p|patch", "stat", "u|include-untracked", "name-only", "name-status"], "git stash show [<options>] [<stash>]");
      var sr = stashRef(c, ps.rest[0]), w = G.commitOf(c.sys, sr.sha);
      var ch = changes(c, G.commitFlat(c.sys, w.parents[0]), G.commitFlat(c.sys, sr.sha));
      if (ps.o["include-untracked"] && w.parents[2]) ch = ch.concat(changes(c, {}, G.commitFlat(c.sys, w.parents[2])));
      printChanges(c, ch, { patch: !!ps.o.patch, stat: !ps.o.patch || !!ps.o.stat, nameOnly: !!ps.o["name-only"], nameStatus: !!ps.o["name-status"] });
      return 0;
    }
    if (sub === "drop") {
      var dr = stashRef(c, rest[0]);
      dropStash(c, dr.n);
      c.o.line("Dropped " + dr.label + " (" + dr.sha + ")");
      return 0;
    }
    if (sub === "pop" || sub === "apply") {
      var pa = parseOpts(c, rest, ["index", "q|quiet"], "git stash " + sub + " [--index] [-q|--quiet] [<stash>]");
      var r = stashRef(c, pa.rest[0]);
      var rc = applyStash(c, r.sha, pa.o.index);
      if (rc) { if (sub === "pop") c.o.line("The stash entry is kept in case you need it again."); return rc; }
      if (!pa.o.quiet) printLongStatus(c, computeStatus(c));
      if (sub === "pop") { dropStash(c, r.n); if (!pa.o.quiet) c.o.line("Dropped " + r.label + " (" + r.sha + ")"); }
      return 0;
    }
    if (sub === "branch") {
      var bn = rest[0]; if (!bn) die(c, "fatal: No branch name specified");
      var rb = stashRef(c, rest[1]);
      var base = G.commitOf(c.sys, rb.sha).parents[0];
      var rc2 = doSwitch(c, { branch: bn, sha: base, create: true, startName: base });
      if (rc2) return rc2;
      var rc3 = applyStash(c, rb.sha, true);
      if (rc3) return rc3;
      printLongStatus(c, computeStatus(c));
      dropStash(c, rb.n); c.o.line("Dropped " + rb.label + " (" + rb.sha + ")");
      return 0;
    }
    if (sub !== "push") { c.o.err("error: unknown subcommand: `" + sub + "'"); c.o.err("usage: git stash list [<log-options>]\n   or: git stash show [-u | --include-untracked | --only-untracked] [<diff-options>] [<stash>]\n   or: git stash drop [-q | --quiet] [<stash>]\n   or: git stash pop [--index] [-q | --quiet] [<stash>]\n   or: git stash apply [--index] [-q | --quiet] [<stash>]\n   or: git stash branch <branchname> [<stash>]\n   or: git stash [push [-p | --patch] [-S | --staged] [-k | --[no-]keep-index] [-q | --quiet]\n          [-u | --include-untracked] [-a | --all] [(-m | --message) <message>]\n          [--pathspec-from-file=<file> [--pathspec-file-nul]]\n          [--] [<pathspec>...]]\n   or: git stash clear"); return 129; }
    var po = parseOpts(c, rest, ["m|message=", "u|include-untracked", "a|all", "k|keep-index", "q|quiet", "p|patch", "S|staged"], "git stash [push [-p | --patch] [-S | --staged] [-k | --[no-]keep-index] [-q | --quiet] [-u | --include-untracked] [-a | --all] [(-m | --message) <message>] [--] [<pathspec>...]]");
    if (!h.sha) die(c, "You do not have the initial commit yet", 1);
    var st = computeStatus(c);
    var specs = po.rest.concat(po.paths || []), m = specs.length ? matcher(c, specs) : null;
    var inc = function (k) { return !m || m(k); };
    var untrackedFiles = po.o["include-untracked"] || po.o.all ? st.untracked.concat(po.o.all ? st.ignored : []).filter(inc) : [];
    var hasChanges = st.staged.some(function (x) { return inc(x.path) || (x.from && inc(x.from)); }) || st.unstaged.some(function (x) { return inc(x.path); }) || untrackedFiles.length;
    if (keys(st.idx.conflicts).length) { c.o.err("error: could not write index"); c.o.err("x: needs merge"); return 1; }
    if (!hasChanges) { c.o.line("No local changes to save"); return 0; }
    var co0 = G.commitOf(c.sys, h.sha);
    var desc = (h.detached ? "(no branch)" : h.branch) + ": " + short(h.sha) + " " + subject(co0.message);
    var me = { name: who.name, email: who.email, time: who.time, tz: "+0000" };
    var hf = st.headFlat;
    // index commit
    var idxFlat = Object.assign({}, hf);
    keys(Object.assign({}, hf, st.idx.entries)).forEach(function (k) { if (!inc(k)) return; if (st.idx.entries[k]) idxFlat[k] = st.idx.entries[k]; else delete idxFlat[k]; });
    var iSha = G.putObject(c.sys, { type: "commit", tree: G.writeTree(c.sys, idxFlat), parents: [h.sha], author: me, committer: me, message: "index on " + desc + "\n" });
    // working tree commit
    var wFlat = Object.assign({}, idxFlat);
    keys(st.idx.entries).forEach(function (k) {
      if (!inc(k)) return;
      var w = st.work[k];
      if (!w) { delete wFlat[k]; return; }
      var we = G.workEntryNode(w); G.putObject(c.sys, { type: "blob", content: G.nodeContent(w) }); wFlat[k] = { sha: we.sha, mode: we.mode };
    });
    var parents = [h.sha, iSha];
    if (untrackedFiles.length) {
      var uFlat = {};
      untrackedFiles.forEach(function (k) { var w = st.work[k], we = G.workEntryNode(w); G.putObject(c.sys, { type: "blob", content: G.nodeContent(w) }); uFlat[k] = { sha: we.sha, mode: we.mode }; });
      parents.push(G.putObject(c.sys, { type: "commit", tree: G.writeTree(c.sys, uFlat), parents: [], author: me, committer: me, message: "untracked files on " + desc + "\n" }));
    }
    var label = po.o.message ? "On " + (h.detached ? "(no branch)" : h.branch) + ": " + po.o.message : "WIP on " + desc;
    var wSha = G.putObject(c.sys, { type: "commit", tree: G.writeTree(c.sys, wFlat), parents: parents, author: me, committer: me, message: label + "\n" });
    var old = G.resolveRefName(repo, "refs/stash").sha;
    G.gwrite(repo, "refs/stash", wSha + "\n");
    G.logRef(repo, "refs/stash", old, wSha, label, me);
    storeObjects(c);
    // clean up: put the stashed paths back to HEAD
    var idx = G.readIndex(repo);
    keys(Object.assign({}, hf, idx.entries)).forEach(function (k) {
      if (!inc(k)) return;
      if (po.o["keep-index"]) { var ie = idx.entries[k]; if (ie) G.writeWork(repo, k, ie.sha, ie.mode, umask(c)); else if (st.work[k]) G.removeWork(repo, k); return; }
      var t = hf[k];
      if (t) { idx.entries[k] = t; G.writeWork(repo, k, t.sha, t.mode, umask(c)); }
      else { delete idx.entries[k]; if (st.work[k]) G.removeWork(repo, k); }
    });
    untrackedFiles.forEach(function (k) { G.removeWork(repo, k); });
    G.writeIndex(repo, idx);
    if (!po.o.quiet) c.o.line("Saved working directory and index state " + label);
    return 0;
  }
  function dropStash(c, n) {
    var repo = c.repo, list = stashList(c);
    list.splice(n, 1);
    if (!list.length) { G.updateRef(repo, "refs/stash", null); G.gremove(repo, "logs/refs/stash"); return; }
    var lines = list.slice().reverse().map(function (e) { return e.old + " " + e.sha + " " + e.name + " <" + e.email + "> " + e.time + " " + e.tz + "\t" + e.msg + "\n"; });
    G.gwrite(repo, "logs/refs/stash", lines.join(""));
    G.gwrite(repo, "refs/stash", list[0].sha + "\n");
  }
  function applyStash(c, wSha, withIndex) {
    var repo = c.repo, w = G.commitOf(c.sys, wSha);
    var baseFlat = G.commitFlat(c.sys, w.parents[0]), wFlat = G.commitFlat(c.sys, wSha), iFlat = G.commitFlat(c.sys, w.parents[1]);
    var st = computeStatus(c);
    var oursFlat = Object.assign({}, st.idx.entries);
    var mr = G.mergeTrees(c.sys, baseFlat, oursFlat, wFlat, ["Updated upstream", "Stashed changes", "Stash base"]);
    // untracked files must not exist
    var uFlat = w.parents[2] ? G.commitFlat(c.sys, w.parents[2]) : {};
    var clash = keys(uFlat).filter(function (k) { return st.work[k]; });
    if (clash.length) { clash.forEach(function (k) { c.o.err(k + " already exists, no checkout"); }); c.o.err("error: could not restore untracked files from stash"); return 1; }
    // local changes on paths the stash touches
    var touched = keys(Object.assign({}, baseFlat, wFlat)).filter(function (k) { return !G.same(baseFlat[k], wFlat[k]); });
    var dirty = touched.filter(function (k) { var ie = st.idx.entries[k], ww = st.work[k]; return ie && ww && G.workEntryNode(ww).sha !== ie.sha; });
    if (dirty.length) { c.o.err("error: Your local changes to the following files would be overwritten by merge:\n" + dirty.map(function (k) { return "\t" + k; }).join("\n") + "\nPlease commit your changes or stash them before you merge.\nAborting"); return 1; }
    var idx = G.readIndex(repo);
    keys(mr.entries).concat(keys(mr.conflicts)).concat(keys(oursFlat)).forEach(function (k) {
      if (mr.conflicts[k]) {
        var x = mr.conflicts[k]; idx.conflicts[k] = { 1: x[1], 2: x[2], 3: x[3] }; delete idx.entries[k];
        if (x.work) G.writeWork(repo, k, x.work.sha, x.work.mode, umask(c));
        return;
      }
      var r = mr.entries[k];
      if (G.same(r, oursFlat[k])) return;
      if (r) G.writeWork(repo, k, r.sha, r.mode, umask(c)); else G.removeWork(repo, k);
      // without --index the changes come back unstaged, except new files
      if (withIndex) { var ie = iFlat[k]; if (ie) idx.entries[k] = ie; else if (!r) delete idx.entries[k]; }
      else if (!baseFlat[k] && r) idx.entries[k] = r;
      else if (!r) delete idx.entries[k];
    });
    keys(uFlat).forEach(function (k) { G.writeWork(repo, k, uFlat[k].sha, uFlat[k].mode, umask(c)); });
    G.writeIndex(repo, idx);
    mergeMessages(c, { messages: mr.messages.filter(function (m) { return m.conflict; }) });
    if (keys(mr.conflicts).length) { c.o.line("On branch " + (G.head(repo).branch || "HEAD")); return 1; }
    return 0;
  }

  /* ================================================================== tags and describe */
  function cmdTag(c, args) {
    needRepo(c);
    var p = parseOpts(c, args, ["a|annotate", "m|message=+", "F|file=", "d|delete", "l|list", "n=?", "f|force", "s|sign", "u|local-user=", "v|verify", "contains=?", "points-at=", "sort=", "merged=?", "no-merged=?", "i|ignore-case", "format="], "git tag [-a | -s | -u <key-id>] [-f] [-m <msg> | -F <file>] [-e] <tagname> [<commit> | <object>]");
    var o = p.o, a = p.rest, repo = c.repo;
    if (o.delete) {
      var rc = 0;
      a.forEach(function (n) { var r = G.resolveRefName(repo, "refs/tags/" + n); if (!r.sha) { c.o.err("error: tag '" + n + "' not found."); rc = 1; return; } G.updateRef(repo, "refs/tags/" + n, null); c.o.line("Deleted tag '" + n + "' (was " + short(r.sha) + ")"); });
      return rc;
    }
    if (o.verify) { if (root.GitSign) return root.GitSign.verifyTag(c, a); die(c, "error: no signature found", 1); }
    var listing = o.list || !a.length || o.n !== undefined && !a.length || o.contains !== undefined || o["points-at"] !== undefined || o.merged !== undefined || o["no-merged"] !== undefined;
    if (listing && !(o.annotate || o.message || o.file || o.sign) ) {
      var tags = G.listRefs(repo, "refs/tags/");
      if (a.length) { var res = a.map(function (g) { return new RegExp("^" + G.globToRe(g) + "$", o["ignore-case"] ? "i" : ""); }); tags = tags.filter(function (t) { return res.some(function (re) { return re.test(t.name.slice(10)); }); }); }
      if (o.contains !== undefined) { var ct = o.contains === true ? G.head(repo).sha : commitRev(c, o.contains); tags = tags.filter(function (t) { return G.isAncestor(c.sys, ct, G.peel(c.sys, t.sha)); }); }
      if (o["points-at"] !== undefined) { var pt = commitRev(c, o["points-at"]); tags = tags.filter(function (t) { return G.peel(c.sys, t.sha) === pt; }); }
      if (o.merged !== undefined) { var mt = o.merged === true ? G.head(repo).sha : commitRev(c, o.merged); tags = tags.filter(function (t) { return G.isAncestor(c.sys, G.peel(c.sys, t.sha), mt); }); }
      if (o.sort) {
        var desc = o.sort.charAt(0) === "-", key = o.sort.replace(/^-/, "");
        var vcmp = function (x, y) { var A = x.split(/(\d+)/), B = y.split(/(\d+)/); for (var i = 0; i < Math.max(A.length, B.length); i++) { var s = A[i] || "", t = B[i] || ""; if (/^\d+$/.test(s) && /^\d+$/.test(t)) { if (+s !== +t) return +s - +t; } else if (s !== t) return s < t ? -1 : 1; } return 0; };
        tags.sort(function (x, y) {
          var r;
          if (key === "v:refname" || key === "version:refname") r = vcmp(x.name.slice(10), y.name.slice(10));
          else if (key === "creatordate" || key === "taggerdate") { var tx = G.getObject(c.sys, x.sha), ty = G.getObject(c.sys, y.sha); r = (tx.tagger ? tx.tagger.time : tx.committer.time) - (ty.tagger ? ty.tagger.time : ty.committer.time); }
          else r = x.name < y.name ? -1 : 1;
          return desc ? -r : r;
        });
      }
      tags.forEach(function (t) {
        var name = t.name.slice(10);
        if (o.n === undefined) { c.o.line(name); return; }
        var ob = G.getObject(c.sys, t.sha), msg = ob.type === "tag" ? ob.message : G.commitOf(c.sys, t.sha).message;
        var n = o.n === true ? 1 : +o.n;
        var ls = msg.replace(/\n+$/, "").split("\n").slice(0, n);
        c.o.line(pad(name, 15) + " " + ls[0]);
        ls.slice(1).forEach(function (l) { c.o.line(pad("", 15) + "     " + l); });
      });
      return 0;
    }
    var name = a[0];
    if (!/^[^\s~^:?*[\\]+$/.test(name) || /\.\.|^-|\.lock$|\/$/.test(name)) die(c, "fatal: '" + name + "' is not a valid tag name.");
    var target = a[1] ? rev(c, a[1]) : G.head(repo).sha;
    if (!target) die(c, "fatal: Failed to resolve 'HEAD' as a valid ref.");
    var exists = G.resolveRefName(repo, "refs/tags/" + name).sha;
    if (exists && !o.force) die(c, "fatal: tag '" + name + "' already exists");
    var annotated = o.annotate || o.message || o.file || o.sign || o["local-user"];
    var sha = target;
    if (annotated) {
      var msg = o.message ? o.message.join("\n\n") : o.file ? (S.readFile(c.sess, o.file).content || "") : null;
      if (msg === null) { c.o.err("(git now opens your editor for the tag message. This lab's terminal can't, so give it with -m: git tag -a " + name + " -m \"Release " + name + "\")"); die(c, "fatal: no tag message?"); }
      msg = cleanupMessage(msg);
      var tagObj = { type: "tag", object: target, objtype: G.getObject(c.sys, target).type, tag: name, tagger: ident(c, "committer"), message: msg };
      if ((o.sign || o["local-user"]) && root.GitSign) root.GitSign.signTag(c, tagObj);
      sha = G.putObject(c.sys, tagObj);
      storeObjects(c);
    }
    G.gwrite(repo, "refs/tags/" + name, sha + "\n");
    if (exists && exists !== sha) c.o.line("Updated tag '" + name + "' (was " + short(exists) + ")");
    return 0;
  }
  function cmdDescribe(c, args) {
    needRepo(c);
    var p = parseOpts(c, args, ["tags", "all", "always", "abbrev=", "long", "exact-match", "dirty=?", "match=+", "exclude=+", "contains", "first-parent"], "git describe [--all] [--tags] [--contains] [--abbrev=<n>] [<commit-ish>...]");
    var o = p.o, repo = c.repo;
    var targets = p.rest.length ? p.rest : ["HEAD"];
    var ab = o.abbrev !== undefined ? +o.abbrev : 7;
    var rc = 0;
    targets.forEach(function (spec) {
      var sha = commitRev(c, spec);
      var tags = G.listRefs(repo, "refs/tags/").filter(function (t) { return o.tags || o.all || G.getObject(c.sys, t.sha).type === "tag"; });
      if (o.match) tags = tags.filter(function (t) { return o.match.some(function (g) { return new RegExp("^" + G.globToRe(g) + "$").test(t.name.slice(10)); }); });
      if (o.exclude) tags = tags.filter(function (t) { return !o.exclude.some(function (g) { return new RegExp("^" + G.globToRe(g) + "$").test(t.name.slice(10)); }); });
      var anc = G.ancestors(c.sys, sha), best = null;
      tags.forEach(function (t) {
        var tc = G.peel(c.sys, t.sha);
        if (!anc[tc]) return;
        var depth = keys(anc).filter(function (x) { return !G.ancestors(c.sys, tc)[x]; }).length;
        var tob = G.getObject(c.sys, t.sha), time = tob.type === "tag" ? tob.tagger.time : G.commitOf(c.sys, tc).committer.time;
        if (!best || depth < best.depth || (depth === best.depth && time > best.time)) best = { name: t.name.slice(10), depth: depth, time: time };
      });
      var dirty = "";
      if (o.dirty !== undefined) { var st = computeStatus(c); if (st.staged.length || st.unstaged.length) dirty = o.dirty === true ? "-dirty" : o.dirty; }
      if (!best) {
        if (o.always) { c.o.line(G.abbrev(sha, ab) + dirty); return; }
        if (!G.listRefs(repo, "refs/tags/").length) die(c, "fatal: No names found, cannot describe anything.");
        if (!o.tags) die(c, "fatal: No annotated tags can describe '" + sha + "'.\nHowever, there were unannotated tags: try --tags.");
        die(c, "fatal: No tags can describe '" + sha + "'.\nTry --always, or create some tags.");
      }
      if (o["exact-match"] && best.depth) die(c, "fatal: no tag exactly matches '" + sha + "'");
      c.o.line(best.name + (best.depth || o.long ? "-" + best.depth + "-g" + G.abbrev(sha, ab) : "") + dirty);
    });
    return rc;
  }

  /* ================================================================== blame */
  function fileAt(c, sha, path) { if (!sha) return null; var f = G.commitFlat(c.sys, sha)[path]; return f ? G.blobText(c.sys, f.sha) : null; }
  function blameLines(c, startSha, path, workText) {
    var finalText = workText !== null && workText !== undefined ? workText : fileAt(c, startSha, path);
    var lines = G.splitLines(finalText), owner = new Array(lines.length);
    var todo = [];
    var all = lines.map(function (_, i) { return i; });
    if (workText !== null && workText !== undefined) {
      var headText = fileAt(c, startSha, path);
      if (headText === null) { all.forEach(function (i) { owner[i] = null; }); return { lines: lines, owner: owner }; }
      var ops = G.myers(G.splitLines(headText), lines), map = [];
      ops.forEach(function (op) { if (op.t === "=") map.push([op.b, op.a]); });
      var matched = {}; map.forEach(function (m) { matched[m[0]] = 1; });
      all.forEach(function (i) { if (!matched[i]) owner[i] = null; });
      todo.push({ sha: startSha, path: path, lines: map.map(function (m) { return { final: m[0], at: m[1] }; }) });
    } else todo.push({ sha: startSha, path: path, lines: all.map(function (i) { return { final: i, at: i }; }) });
    var guard = 0;
    while (todo.length && guard++ < 5000) {
      var cur = todo.shift();
      if (!cur.lines.length) continue;
      var co = G.commitOf(c.sys, cur.sha), text = fileAt(c, cur.sha, cur.path), mine = G.splitLines(text);
      var remaining = cur.lines.slice();
      for (var pi = 0; pi < co.parents.length && remaining.length; pi++) {
        var ptext = fileAt(c, co.parents[pi], cur.path);
        if (ptext === null) continue;
        var ops2 = G.myers(G.splitLines(ptext), mine), back = {};
        ops2.forEach(function (op) { if (op.t === "=") back[op.b] = op.a; });
        var pass = [], keep = [];
        remaining.forEach(function (l) { if (back[l.at] !== undefined) pass.push({ final: l.final, at: back[l.at] }); else keep.push(l); });
        if (pass.length) {
          var ex = todo.filter(function (t) { return t.sha === co.parents[pi] && t.path === cur.path; })[0];
          if (ex) ex.lines = ex.lines.concat(pass); else todo.push({ sha: co.parents[pi], path: cur.path, lines: pass });
        }
        remaining = keep;
      }
      remaining.forEach(function (l) { owner[l.final] = { sha: cur.sha, line: l.at, boundary: !co.parents.length }; });
      todo.sort(function (x, y) { return G.commitOf(c.sys, y.sha).committer.time - G.commitOf(c.sys, x.sha).committer.time; });
    }
    return { lines: lines, owner: owner };
  }
  function cmdBlame(c, args) {
    needRepo(c);
    var p = parseOpts(c, args, ["L=+", "e|show-email", "s", "l", "w", "M", "C", "date=", "porcelain", "c", "t", "f|show-name", "n|show-number", "root"], "git blame [<options>] [<rev-opts>] [<rev>] [--] <file>");
    var o = p.o, a = p.rest.concat(p.paths || []);
    if (!a.length) die(c, "usage: git blame [<options>] [<rev-opts>] [<rev>] [--] <file>", 129);
    var revSpec = a.length > 1 ? a[0] : null, file = a[a.length - 1];
    var path = relOrDie(c, file);
    var h = G.head(c.repo), start = revSpec ? commitRev(c, revSpec) : h.sha, work = null;
    if (!revSpec) {
      var n = G.nodeAt(c.sys, G.workPath(c.repo, path));
      if (!n || n.type !== "f") { if (!start || fileAt(c, start, path) === null) die(c, "fatal: no such path '" + file + "' in HEAD"); }
      else work = n.content;
      if (work !== null && (!start || fileAt(c, start, path) === null) && !(G.readIndex(c.repo).entries[path])) die(c, "fatal: no such path '" + file + "' in HEAD");
    } else if (fileAt(c, start, path) === null) die(c, "fatal: no such path " + file + " in " + revSpec);
    var res = blameLines(c, start, path, work);
    var from = 1, to = res.lines.length;
    if (o.L) {
      var mL = /^(\d+)?(?:,([+-]?\d+)?)?$/.exec(o.L[0]);
      if (!mL) die(c, "fatal: -L parameter '" + o.L[0] + "': no match");
      from = mL[1] ? +mL[1] : 1;
      if (mL[2]) to = mL[2].charAt(0) === "+" ? from + +mL[2].slice(1) - 1 : mL[2].charAt(0) === "-" ? from : +mL[2];
      else to = o.L[0].indexOf(",") >= 0 ? res.lines.length : res.lines.length;
      if (from > res.lines.length) die(c, "fatal: file " + file + " has only " + res.lines.length + " line" + (res.lines.length === 1 ? "" : "s"));
      to = Math.min(to, res.lines.length);
    }
    var now = G.clock(c.sys);
    var rows = [];
    for (var i = from - 1; i < to; i++) {
      var ow = res.owner[i], co = ow ? G.commitOf(c.sys, ow.sha) : null;
      var who = co ? (o["show-email"] ? "<" + co.author.email + ">" : co.author.name) : (o["show-email"] ? "<not.committed.yet>" : "Not Committed Yet");
      var date = co ? G.fmtDate(co.author.time, co.author.tz, o.date || "iso", now) : G.fmtDate(now, "+0000", o.date || "iso", now);
      var id = ow ? (ow.boundary && !o.root ? "^" + ow.sha.slice(0, 7) : ow.sha.slice(0, 8)) : "00000000";
      if (o.l) id = ow ? (ow.boundary ? "^" + ow.sha.slice(0, 39) : ow.sha) : G.zero();
      rows.push({ id: id, who: who, date: date, n: i + 1, text: G.stripNl(res.lines[i]) });
    }
    var ww = Math.max.apply(null, [0].concat(rows.map(function (r) { return r.who.length; }))), nw = String(to).length;
    var showName = o["show-name"];
    rows.forEach(function (r) {
      c.o.line(r.id + (showName ? " " + path : "") + (o.s ? " (" : " (" + pad(r.who, ww) + " " + r.date + " ") + lpad(r.n, nw) + ") " + r.text);
    });
    return 0;
  }

  /* ================================================================== bisect */
  function bisectTerms() { return { bad: "bad", good: "good" }; }
  function bisectState(c) {
    var repo = c.repo;
    var bad = G.resolveRefName(repo, "refs/bisect/bad").sha;
    var goods = G.listRefs(repo, "refs/bisect/").filter(function (r) { return /\/good-/.test(r.name); }).map(function (r) { return r.sha; });
    var skips = G.listRefs(repo, "refs/bisect/").filter(function (r) { return /\/skip-/.test(r.name); }).map(function (r) { return r.sha; });
    return { bad: bad, goods: goods, skips: skips };
  }
  function bisectLog(c, line) { var t = G.gread(c.repo, "BISECT_LOG") || ""; G.gwrite(c.repo, "BISECT_LOG", t + line + "\n"); }
  function estimateSteps(all) { if (all < 3) return 0; var n = Math.floor(Math.log2(all)), e = Math.pow(2, n), x = all - e; return e < 3 * x ? n : n - 1; }
  // Pick the next commit to test, or report the first bad commit. Returns the exit code.
  function bisectNext(c, quietCheckout) {
    var repo = c.repo, s = bisectState(c);
    if (!s.bad || !s.goods.length) {
      if (!s.bad && !s.goods.length) return 0;
      c.o.line("status: waiting for " + (!s.bad ? "bad commit, " + plural(s.goods.length, "good commit", "good commits") + " known" : "good commit(s), bad commit known"));
      return 0;
    }
    var hidden = {}; s.goods.forEach(function (g) { G.ancestors(c.sys, g, hidden); });
    var cands = keys(G.ancestors(c.sys, s.bad)).filter(function (x) { return !hidden[x]; });
    var testable = cands.filter(function (x) { return s.skips.indexOf(x) < 0; });
    if (cands.length === 1 || !testable.filter(function (x) { return x !== s.bad; }).length) {
      if (cands.length > 1) {
        c.o.line("There are only 'skip'ped commits left to test.\nThe first bad commit could be any of:");
        cands.forEach(function (x) { c.o.line(x); });
        c.o.line("We cannot bisect more!");
        return 2;
      }
      var b = s.bad, co = G.commitOf(c.sys, b);
      c.o.line(b + " is the first bad commit");
      prettyLines(c, b, co, "medium", {}, null).forEach(function (l) { c.o.line(l.t, l.c); });
      c.o.line("");
      var ch = changes(c, co.parents[0] ? G.commitFlat(c.sys, co.parents[0]) : {}, G.commitFlat(c.sys, b));
      printStat(c, ch, {});
      bisectLog(c, "# first bad commit: [" + b + "] " + subject(co.message));
      return 10;
    }
    var all = cands.length, best = null;
    var inCand = {}; cands.forEach(function (x) { inCand[x] = 1; });
    testable.forEach(function (x) {
      var anc = G.ancestors(c.sys, x), w = keys(anc).filter(function (y) { return inCand[y]; }).length;
      var score = Math.min(w, all - w);
      if (!best || score > best.score || (score === best.score && G.commitOf(c.sys, x).committer.time > G.commitOf(c.sys, best.sha).committer.time)) best = { sha: x, score: score, w: w };
    });
    var left = all - best.w - 1; if (left < 0) left = 0;
    var steps = estimateSteps(all);
    var prob = moveTree(c, G.commitFlat(c.sys, best.sha), { force: false });
    if (prob) { overwriteError(c, prob, "checkout", "switch branches"); return 1; }
    G.setHead(repo, best.sha, "checkout: moving from " + (G.head(repo).detached ? G.head(repo).sha : G.head(repo).branch) + " to " + best.sha, softIdent(c));
    G.gwrite(repo, "BISECT_EXPECTED_REV", best.sha + "\n");
    c.o.line("Bisecting: " + plural(left, "revision", "revisions") + " left to test after this (roughly " + plural(steps, "step", "steps") + ")");
    c.o.line("[" + best.sha + "] " + subject(G.commitOf(c.sys, best.sha).message), "yellow");
    return 0;
  }
  function cmdBisect(c, args) {
    needWork(c);
    var repo = c.repo, sub = args[0], rest = args.slice(1);
    var started = G.gexists(repo, "BISECT_START");
    function mark(kind, specs) {
      if (!started) { c.o.err("You need to start by \"git bisect start\""); c.o.err(""); c.o.err("Do you want me to do it for you [Y/n]? (this lab answers no)"); return 1; }
      if (!specs.length) specs = ["HEAD"];
      specs.forEach(function (sp) {
        var sha = commitRev(c, sp), co = G.commitOf(c.sys, sha);
        if (kind === "bad") G.gwrite(repo, "refs/bisect/bad", sha + "\n");
        else G.gwrite(repo, "refs/bisect/" + kind + "-" + sha, sha + "\n");
        bisectLog(c, "# " + kind + ": [" + sha + "] " + subject(co.message));
        bisectLog(c, "git bisect " + kind + " " + sha);
      });
      return bisectNext(c);
    }
    if (sub === "start") {
      if (started) { /* restart */ cmdBisect(c, ["reset"]); }
      var h = G.head(repo);
      var specs = rest.filter(function (x) { return x !== "--" && !/^--/.test(x); });
      G.gwrite(repo, "BISECT_START", (h.detached ? h.sha : h.branch) + "\n");
      G.gwrite(repo, "BISECT_LOG", "git bisect start" + (specs.length ? " '" + specs.join("' '") + "'" : "") + "\n");
      G.gwrite(repo, "BISECT_TERMS", "bad\ngood\n");
      started = true;
      if (!specs.length) { c.o.line("status: waiting for both good and bad commits"); return 0; }
      var badSha = commitRev(c, specs[0]);
      G.gwrite(repo, "refs/bisect/bad", badSha + "\n");
      bisectLog(c, "# bad: [" + badSha + "] " + subject(G.commitOf(c.sys, badSha).message));
      specs.slice(1).forEach(function (g) { var gs = commitRev(c, g); G.gwrite(repo, "refs/bisect/good-" + gs, gs + "\n"); bisectLog(c, "# good: [" + gs + "] " + subject(G.commitOf(c.sys, gs).message)); });
      if (specs.length === 1) { c.o.line("status: waiting for good commit(s), bad commit known"); return 0; }
      var rc0 = bisectNext(c);
      return rc0 === 10 ? 0 : rc0;
    }
    if (sub === "bad" || sub === "new") { var r1 = mark("bad", rest); return r1 === 10 ? 0 : r1; }
    if (sub === "good" || sub === "old") { var r2 = mark("good", rest); return r2 === 10 ? 0 : r2; }
    if (sub === "skip") { var r3 = mark("skip", rest); return r3 === 10 ? 0 : r3; }
    if (sub === "reset") {
      if (!started) { c.o.line("We are not bisecting."); return 0; }
      var orig = rest[0] || G.gread(repo, "BISECT_START").trim();
      var target = G.resolveRefName(repo, "refs/heads/" + orig).sha;
      var cur = G.head(repo);
      G.listRefs(repo, "refs/bisect/").forEach(function (r) { G.gremove(repo, r.name); });
      G.pruneEmptyDirs(c.sys, G.gpath(repo, "refs/bisect"), G.gpath(repo, "refs"));
      ["BISECT_START", "BISECT_LOG", "BISECT_TERMS", "BISECT_EXPECTED_REV", "BISECT_ANCESTORS_OK", "BISECT_NAMES", "BISECT_RUN"].forEach(function (f) { G.gremove(repo, f); });
      if (target) {
        var prob = moveTree(c, G.commitFlat(c.sys, target), {});
        if (prob) { overwriteError(c, prob, "checkout", "switch branches"); return 1; }
        G.setHead(repo, "refs/heads/" + orig, "checkout: moving from " + (cur.detached ? cur.sha : cur.branch) + " to " + orig, softIdent(c));
        if (cur.detached && cur.sha !== target) c.o.line("Previous HEAD position was " + short(cur.sha) + " " + subject(G.commitOf(c.sys, cur.sha).message));
        c.o.line("Switched to branch '" + orig + "'");
      } else {
        var tsha = commitRev(c, orig);
        moveTree(c, G.commitFlat(c.sys, tsha), {}); G.setHead(repo, tsha);
      }
      return 0;
    }
    if (sub === "log") { if (!started) die(c, "error: We are not bisecting.", 1); c.io.out(G.gread(repo, "BISECT_LOG") || ""); return 0; }
    if (sub === "visualize" || sub === "view") { if (!started) die(c, "error: We are not bisecting.", 1); var s = bisectState(c); return cmdLog(c, ["--oneline", s.bad].concat(s.goods.map(function (g) { return "^" + g; }))); }
    if (sub === "terms") { c.o.line("Your current terms are good for the old state\nand bad for the new state."); return 0; }
    if (sub === "run") {
      if (!started) { c.o.err("You need to start by \"git bisect start\""); return 1; }
      if (!rest.length) die(c, "error: bisect run failed: no command provided.", 1);
      var cmdline = rest.map(function (x) { return /[\s'"$`\\|&;<>()*?]/.test(x) ? "'" + x.replace(/'/g, "'\\''") + "'" : x; }).join(" ");
      for (var guard = 0; guard < 40; guard++) {
        var s2 = bisectState(c);
        if (!s2.bad || !s2.goods.length) { c.o.err("bisect run failed: the bad and good commits must be set first (git bisect bad / git bisect good)"); return 1; }
        c.o.line("running  " + cmdline);
        var sub2 = S.childSession(c.sess); sub2.cwd = c.cwd;
        var code;
        try { code = S.runSource(sub2, cmdline, c.io); }
        catch (e) { if (e instanceof S.ExitSignal) code = e.code; else if (e instanceof S.ShError) { c.io.err(e.message + "\n"); code = e.code; } else throw e; }
        if (code === 125) { var rs = mark("skip", []); if (rs === 10) { c.o.line("bisect found first bad commit"); return 0; } if (rs) return rs; continue; }
        if (code < 0 || code >= 128) { c.o.err("bisect run failed: exit code " + code + " from '" + cmdline + "' is < 0 or >= 128"); return 1; }
        var r = mark(code === 0 ? "good" : "bad", []);
        if (r === 10) { c.o.line("bisect found first bad commit"); return 0; }
        if (r) return r;
      }
      return 1;
    }
    c.o.err("usage: git bisect [help|start|bad|good|new|old|terms|skip|next|reset|visualize|view|replay|log|run]");
    return 1;
  }

  /* ================================================================== reflog, small plumbing commands */
  function cmdReflog(c, args) {
    needRepo(c);
    var sub = args[0];
    if (sub === "show") args = args.slice(1);
    else if (sub === "expire" || sub === "delete") { c.o.line("(Reflog entries expire on their own after 90 days. This lab doesn't let you delete them.)"); return 0; }
    var p = parseOpts(c, args, ["n|max-count=", "oneline", "date=", "all", "format=", "pretty="], "git reflog [show] [<log-options>] [<ref>]");
    var ref = p.rest[0] || "HEAD", name = ref;
    var full = ref === "HEAD" ? "HEAD" : G.refFull(c.repo, ref);
    if (!full) die(c, "fatal: ambiguous argument '" + ref + "': unknown revision or path not in the working tree.");
    var entries = G.reflog(c.repo, full);
    if (p.o["max-count"] !== undefined) entries = entries.slice(0, +p.o["max-count"]);
    var dec = c.io.tty ? decorations(c) : null;
    var label = full === "HEAD" ? "HEAD" : ref.replace(/^refs\/heads\//, "");
    entries.forEach(function (e, i) {
      var sel = p.o.date ? label + "@{" + G.fmtDate(e.time, e.tz, p.o.date === "relative" ? "relative" : p.o.date, G.clock(c.sys)) + "}" : label + "@{" + i + "}";
      c.o.line(short(e.sha) + decoText(dec, e.sha) + " " + sel + ": " + e.msg);
    });
    return 0;
  }
  function cmdLsFiles(c, args) {
    needWork(c);
    var p = parseOpts(c, args, ["c|cached", "s|stage", "o|others", "i|ignored", "exclude-standard", "m|modified", "d|deleted", "u|unmerged", "directory", "z", "full-name", "error-unmatch", "x|exclude=+", "t", "v"], "git ls-files [<options>] [<file>...]");
    var o = p.o, st = computeStatus(c), specs = p.rest.concat(p.paths || []);
    var m = specs.length ? matcher(c, specs) : null;
    var pre = cwdRel(c);
    var inCwd = function (k) { return !pre || k.indexOf(pre + "/") === 0; };
    var show = function (k) { return o["full-name"] ? k : showPath(c, k); };
    var out = [];
    if (o.others) {
      var list = o.ignored ? st.ignored : st.untracked;
      if (!o["exclude-standard"] && !o.ignored) list = st.untracked.concat(st.ignored).sort();
      if (o.directory) list = o.ignored ? collapseIgnored(c, st) : collapse(c, st, list);
      list.forEach(function (k) { if ((!m || m(k)) && inCwd(k)) out.push(show(k)); });
    } else if (o.ignored && !o.others) {
      keys(st.idx.entries).forEach(function (k) { if (st.ign.ignored(k, false) && inCwd(k)) out.push(show(k)); });
    } else if (o.stage || o.unmerged) {
      keys(Object.assign({}, st.idx.entries, st.idx.conflicts)).sort().forEach(function (k) {
        if (m && !m(k)) return; if (!inCwd(k)) return;
        var x = st.idx.conflicts[k];
        if (x) [1, 2, 3].forEach(function (n) { if (x[n]) out.push(x[n].mode + " " + x[n].sha + " " + n + "\t" + show(k)); });
        else if (!o.unmerged) { var e = st.idx.entries[k]; out.push(e.mode + " " + e.sha + " 0\t" + show(k)); }
      });
    } else if (o.modified || o.deleted) {
      st.unstaged.forEach(function (x) { if ((o.modified || x.type === "deleted") && (!o.deleted || x.type === "deleted" || o.modified) && (!m || m(x.path)) && inCwd(x.path)) out.push(show(x.path)); });
    } else {
      keys(Object.assign({}, st.idx.entries, st.idx.conflicts)).sort().forEach(function (k) { if ((!m || m(k)) && inCwd(k)) out.push((o.t ? (st.idx.conflicts[k] ? "M " : "H ") : "") + show(k)); });
      if (o["error-unmatch"] && m) { var bad = m.list.filter(function (one) { return !keys(st.idx.entries).some(function (k) { return m.hit(k, one); }); }); if (bad.length) { bad.forEach(function (one) { c.o.err("error: pathspec '" + one.spec + "' did not match any file(s) known to git"); }); c.o.err("Did you forget to 'git add'?"); return 1; } }
    }
    out.forEach(function (l) { c.o.line(l); });
    return 0;
  }
  function cmdCatFile(c, args) {
    needRepo(c);
    var p = parseOpts(c, args, ["t", "s", "p", "e", "batch", "batch-check"], "git cat-file <type> <object>\n   or: git cat-file (-e | -p) <object>\n   or: git cat-file (-t | -s) <object>");
    var o = p.o, a = p.rest;
    if (!a.length) die(c, "usage: git cat-file (-t | -s | -e | -p) <object>", 129);
    var spec = a[a.length - 1], sha;
    try { sha = G.resolve(c.repo, spec); } catch (e) { if (o.e) return 1; die(c, "fatal: Not a valid object name " + spec); }
    var ob = G.getObject(c.sys, sha);
    if (!ob) { if (o.e) return 1; die(c, "fatal: Not a valid object name " + spec); }
    if (o.e) return 0;
    if (o.t) { c.o.line(ob.type); return 0; }
    if (o.s) { c.o.line(String(G.objSize(c.sys, sha))); return 0; }
    if (a.length === 2 && a[0] !== ob.type) die(c, "fatal: git cat-file " + spec + ": bad file");
    if (ob.type === "blob") { c.io.out(ob.content); return 0; }
    if (ob.type === "tree") { ob.entries.forEach(function (e) { var kind = e.mode === "40000" ? "tree" : "blob"; c.o.line((e.mode === "40000" ? "040000" : e.mode) + " " + kind + " " + e.sha + "\t" + e.name); }); return 0; }
    if (ob.type === "commit") { c.io.out(commitTextOf(ob)); return 0; }
    c.io.out("object " + ob.object + "\ntype " + ob.objtype + "\ntag " + ob.tag + "\ntagger " + ob.tagger.name + " <" + ob.tagger.email + "> " + ob.tagger.time + " " + (ob.tagger.tz || "+0000") + "\n\n" + ob.message);
    return 0;
  }
  function commitTextOf(co) {
    var t = "tree " + co.tree + "\n";
    co.parents.forEach(function (x) { t += "parent " + x + "\n"; });
    t += "author " + co.author.name + " <" + co.author.email + "> " + co.author.time + " " + (co.author.tz || "+0000") + "\n";
    t += "committer " + co.committer.name + " <" + co.committer.email + "> " + co.committer.time + " " + (co.committer.tz || "+0000") + "\n";
    if (co.gpgsig) t += "gpgsig " + co.gpgsig.replace(/\n/g, "\n ") + "\n";
    return t + "\n" + co.message;
  }
  function cmdRevParse(c, args) {
    var out = [], i = 0, shortN = 0, abbrevRef = false, verify = false, quiet = false;
    for (i = 0; i < args.length; i++) {
      var a = args[i];
      if (a === "--show-toplevel") { needRepo(c); out.push(c.repo.top); continue; }
      if (a === "--git-dir") { needRepo(c); out.push(c.cwd === c.repo.top ? ".git" : c.repo.gitdir); continue; }
      if (a === "--absolute-git-dir") { needRepo(c); out.push(c.repo.gitdir); continue; }
      if (a === "--is-inside-work-tree") { if (!c.repo) die(c, "fatal: not a git repository (or any of the parent directories): .git"); out.push("true"); continue; }
      if (a === "--is-inside-git-dir") { out.push(c.repo && c.cwd.indexOf(c.repo.gitdir) === 0 ? "true" : "false"); continue; }
      if (a === "--show-prefix") { needRepo(c); var pr = cwdRel(c); out.push(pr ? pr + "/" : ""); continue; }
      if (a === "--show-cdup") { needRepo(c); var pr2 = cwdRel(c); out.push(pr2 ? pr2.split("/").map(function () { return ".."; }).join("/") + "/" : ""); continue; }
      if (a === "--abbrev-ref") { abbrevRef = true; continue; }
      if (a === "--symbolic-full-name") { abbrevRef = "full"; continue; }
      if (a === "--verify") { verify = true; continue; }
      if (a === "-q" || a === "--quiet") { quiet = true; continue; }
      if (a === "--short") { shortN = 7; continue; }
      if (/^--short=\d+$/.test(a)) { shortN = +a.split("=")[1]; continue; }
      if (a === "--all") { needRepo(c); G.listRefs(c.repo, "refs/").forEach(function (r) { out.push(r.sha); }); continue; }
      if (a === "--branches") { needRepo(c); G.listRefs(c.repo, "refs/heads/").forEach(function (r) { out.push(r.sha); }); continue; }
      if (a === "--tags") { needRepo(c); G.listRefs(c.repo, "refs/tags/").forEach(function (r) { out.push(r.sha); }); continue; }
      if (a === "--local-env-vars" || a === "--") continue;
      needRepo(c);
      if (abbrevRef) {
        var spec = a.replace(/@\{(u|upstream)\}$/, "");
        if (/@\{(u|upstream)\}$/.test(a)) { var br = spec === "" || spec === "HEAD" ? G.head(c.repo).branch : spec; var up = G.upstreamOf(c.repo, br); if (!up) die(c, "fatal: no upstream configured for branch '" + br + "'"); out.push(abbrevRef === "full" ? up : up.replace(/^refs\/(remotes|heads)\//, "")); continue; }
        if (a === "HEAD") { var h = G.head(c.repo); if (!h.sha && !h.detached) { if (!quiet) die(c, "fatal: ambiguous argument 'HEAD': unknown revision or path not in the working tree.\nUse '--' to separate paths from revisions, like this:\n'git <command> [<revision>...] -- [<file>...]'"); return 128; } out.push(h.detached ? "HEAD" : abbrevRef === "full" ? h.ref : h.branch); continue; }
        var full = G.refFull(c.repo, a);
        if (full) { out.push(abbrevRef === "full" ? full : full.replace(/^refs\/(heads|remotes|tags)\//, "")); continue; }
      }
      var sha = tryRev(c, a);
      if (!sha) { if (verify) { if (!quiet) c.o.err("fatal: Needed a single revision"); return 128; } die(c, "fatal: ambiguous argument '" + a + "': unknown revision or path not in the working tree.\nUse '--' to separate paths from revisions, like this:\n'git <command> [<revision>...] -- [<file>...]'"); }
      out.push(shortN ? G.abbrev(sha, shortN) : sha);
    }
    out.forEach(function (l) { c.o.line(l); });
    return 0;
  }
  function cmdHashObject(c, args) {
    var p = parseOpts(c, args, ["w", "t=", "stdin", "path="], "git hash-object [-t <type>] [-w] [--path=<file> | --no-filters] [--stdin] [--] <file>...");
    var files = p.rest.concat(p.paths || []), texts = [];
    if (p.o.stdin) texts.push(c.io.stdin ? c.io.stdin.join ? c.io.stdin.join("") : String(c.io.stdin) : "");
    files.forEach(function (f) { var rf = S.readFile(c.sess, f); if (rf.error) die(c, "fatal: could not open '" + f + "' for reading: " + S.ERRTEXT[rf.error]); texts.push(rf.content); });
    texts.forEach(function (t) {
      if (p.o.w) { needRepo(c); G.putObject(c.sys, { type: "blob", content: t }); storeObjects(c); }
      c.o.line(G.blobSha(t));
    });
    return 0;
  }
  function cmdShortlog(c, args) {
    needRepo(c);
    var p = parseOpts(c, args, ["s|summary", "n|numbered", "e|email", "all", "no-merges", "c|committer", "since=", "until=", "after=", "before="], "git shortlog [<options>] [<revision-range>] [[--] <path>...]");
    var rp = revsAndPaths(c, p), rng = parseRange(c, rp.revs.length ? rp.revs : p.o.all ? [] : ["HEAD"], p.o.all);
    var m = rp.paths.length ? matcher(c, rp.paths) : null;
    var groups = {}, order = [];
    walk(c, rng.inc, rng.exc, {}).forEach(function (sha) {
      var co = G.commitOf(c.sys, sha);
      if (p.o["no-merges"] && co.parents.length > 1) return;
      if (m && !touches(c, sha, m)) return;
      var who = p.o.committer ? co.committer : co.author;
      var key = who.name + (p.o.email ? " <" + who.email + ">" : "");
      if (!groups[key]) { groups[key] = []; order.push(key); }
      groups[key].push(subject(co.message));
    });
    var names = order.slice().sort(function (a, b) { return p.o.numbered ? groups[b].length - groups[a].length || (a < b ? -1 : 1) : a < b ? -1 : 1; });
    names.forEach(function (n) {
      if (p.o.summary) { c.o.line(lpad(groups[n].length, 6) + "\t" + n); return; }
      c.o.line(n + " (" + groups[n].length + "):");
      groups[n].slice().reverse().forEach(function (s) { c.o.line("      " + s); });
      c.o.line("");
    });
    return 0;
  }
  function breToJs(s) { return s.replace(/\\([(){}|+?])/g, "$1").replace(/(^|[^\\])([(){}|+?])/g, function (m, a, b) { return a + "\\" + b; }); }
  function cmdGrep(c, args) {
    needRepo(c);
    var p = parseOpts(c, args, ["n|line-number", "i|ignore-case", "c|count", "l|files-with-matches", "L|files-without-match", "w|word-regexp", "v|invert-match", "e=+", "E|extended-regexp", "F|fixed-strings", "h", "H", "untracked", "cached", "q|quiet", "o|only-matching", "max-depth=", "color=?", "break", "heading", "p|show-function", "A=", "B=", "C="], "git grep [<options>] [-e] <pattern> [<rev>...] [[--] <path>...]");
    var o = p.o, a = p.rest.slice();
    var pats = o.e ? o.e.slice() : a.length ? [a.shift()] : [];
    if (!pats.length) die(c, "fatal: no pattern given");
    var revs = [], paths = p.paths ? p.paths.slice() : [];
    a.forEach(function (x) { if (!paths.length && tryRev(c, x) && G.commitOf(c.sys, tryRev(c, x))) revs.push(x); else paths.push(x); });
    var res = pats.map(function (pt) {
      var src = o["fixed-strings"] ? pt.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") : o["extended-regexp"] ? pt : breToJs(pt);
      if (o["word-regexp"]) src = "(?:^|[^\\w])(" + src + ")(?=$|[^\\w])";
      return new RegExp(src, o["ignore-case"] ? "i" : "");
    });
    var m = paths.length ? matcher(c, paths) : null, pre = cwdRel(c);
    var found = false;
    function search(label, files) {
      keys(files).sort().forEach(function (k) {
        if (m && !m(k)) return;
        if (!m && pre && k.indexOf(pre + "/") !== 0) return;
        var text = files[k], lines = G.splitLines(text).map(G.stripNl), hits = [];
        lines.forEach(function (l, i) { var hit = res.some(function (re) { return re.test(l); }); if (o["invert-match"] ? !hit : hit) hits.push(i); });
        var name = label + showPath(c, k);
        if (o["files-without-match"]) { if (!hits.length) c.o.line(name); return; }
        if (!hits.length) return;
        found = true;
        if (o.quiet) return;
        if (o["files-with-matches"]) { c.o.line(name); return; }
        if (o.count) { c.o.line(name + ":" + hits.length); return; }
        hits.forEach(function (i) { c.o.line((o.h ? "" : name + ":") + (o["line-number"] ? (i + 1) + ":" : "") + lines[i]); });
      });
    }
    if (revs.length) revs.forEach(function (r) { var f = G.commitFlat(c.sys, commitRev(c, r)), files = {}; keys(f).forEach(function (k) { files[k] = G.blobText(c.sys, f[k].sha); }); search(r + ":", files); });
    else {
      var st = computeStatus(c), files = {};
      keys(st.idx.entries).forEach(function (k) { var w = st.work[k]; files[k] = o.cached || !w ? G.blobText(c.sys, st.idx.entries[k].sha) : G.nodeContent(w); });
      if (o.untracked) st.untracked.forEach(function (k) { files[k] = G.nodeContent(st.work[k]); });
      search("", files);
    }
    return found ? 0 : 1;
  }
  function cmdCheckIgnore(c, args) {
    needWork(c);
    var p = parseOpts(c, args, ["v|verbose", "n|non-matching", "q|quiet", "no-index", "stdin"], "git check-ignore [<options>] <pathname>...");
    var files = p.rest.concat(p.paths || []);
    if (!files.length) die(c, "fatal: no path specified");
    if (p.o["non-matching"] && !p.o.verbose) die(c, "fatal: --non-matching is only valid with --verbose");
    var ign = ignorer(c), idx = G.readIndex(c.repo), any = false;
    files.forEach(function (f) {
      var rel = relOrDie(c, f.replace(/\/$/, ""));
      var n = G.nodeAt(c.sys, G.workPath(c.repo, rel)), isDir = (n && n.type === "d") || /\/$/.test(f);
      var tracked = !p.o["no-index"] && (idx.entries[rel] || keys(idx.entries).some(function (k) { return k.indexOf(rel + "/") === 0 && isDir && false; }));
      var r = tracked ? null : ign.rule(rel, isDir);
      var hit = r && !r.neg;
      if (hit) any = true;
      if (p.o.quiet) return;
      if (p.o.verbose) {
        if (r) c.o.line(r.src + ":" + r.line + ":" + r.text + "\t" + f);
        else if (p.o["non-matching"]) c.o.line("::\t" + f);
      } else if (hit) c.o.line(f);
    });
    return any ? 0 : 1;
  }
  function cmdClean(c, args) {
    needWork(c);
    var p = parseOpts(c, args, ["n|dry-run", "f|force", "d", "x", "X", "i|interactive", "q|quiet", "e|exclude=+"], "git clean [-d] [-f] [-i] [-n] [-q] [-e <pattern>] [-x | -X] [--] [<pathspec>...]");
    var o = p.o;
    if (o.interactive) die(c, "(git clean -i asks questions interactively, which this lab's terminal can't do. Preview with git clean -n, then run git clean -f.)", 1);
    if (!o.force && !o["dry-run"] && G.configBool(cfg(c, "clean.requireforce"), true)) die(c, "fatal: clean.requireForce defaults to true and neither -i, -n, nor -f given; refusing to clean");
    var st = computeStatus(c), specs = p.rest.concat(p.paths || []), m = specs.length ? matcher(c, specs) : null;
    var pre = cwdRel(c);
    var files = o.X ? st.ignored : o.x ? st.untracked.concat(st.ignored).sort() : st.untracked;
    files = files.filter(function (k) { return (!m || m(k)) && (!pre || k.indexOf(pre + "/") === 0); });
    var shown = o.d ? (o.X ? collapseIgnored(c, Object.assign({}, st, { ignored: files })) : collapse(c, st, files)) : files.filter(function (k) {
      // without -d, files inside untracked folders are left alone
      var parts = k.split("/"), tracked = {};
      keys(st.idx.entries).forEach(function (t) { var pp = t.split("/"); for (var i = 1; i < pp.length; i++) tracked[pp.slice(0, i).join("/")] = 1; });
      for (var i = 1; i < parts.length; i++) if (!tracked[parts.slice(0, i).join("/")]) return false;
      return true;
    });
    shown.forEach(function (k) {
      if (!o.quiet) c.o.line((o["dry-run"] ? "Would remove " : "Removing ") + showPath(c, k.replace(/\/$/, "")) + (/\/$/.test(k) ? "/" : ""));
      if (o["dry-run"]) return;
      var abs = G.workPath(c.repo, k.replace(/\/$/, ""));
      G.removePath(c.sys, abs);
      G.pruneEmptyDirs(c.sys, abs.slice(0, abs.lastIndexOf("/")), c.repo.top);
    });
    return 0;
  }
  function cmdMergeBase(c, args) {
    needRepo(c);
    var p = parseOpts(c, args, ["a|all", "is-ancestor", "octopus", "fork-point"], "git merge-base [-a | --all] <commit> <commit>...");
    if (p.o["is-ancestor"]) return G.isAncestor(c.sys, commitRev(c, p.rest[0]), commitRev(c, p.rest[1])) ? 0 : 1;
    if (p.rest.length < 2) die(c, "usage: git merge-base [-a | --all] <commit> <commit>...", 129);
    var b = G.mergeBases(c.sys, commitRev(c, p.rest[0]), commitRev(c, p.rest[1]));
    if (!b.length) return 1;
    (p.o.all ? b : b.slice(0, 1)).forEach(function (x) { c.o.line(x); });
    return 0;
  }
  function cmdRevList(c, args) {
    needRepo(c);
    var p = parseOpts(c, args, ["count", "all", "n|max-count=", "reverse", "no-merges", "merges", "first-parent", "left-right", "oneline", "abbrev-commit"], "git rev-list [<options>] <commit>... [--] [<path>...]");
    var rng = parseRange(c, p.rest, p.o.all);
    var list = walk(c, rng.inc, rng.exc, { firstParent: p.o["first-parent"] }).filter(function (s) { var n = G.parentsOf(c.sys, s).length; return (!p.o["no-merges"] || n < 2) && (!p.o.merges || n > 1); });
    if (p.o["max-count"] !== undefined) list = list.slice(0, +p.o["max-count"]);
    if (p.o.count) { c.o.line(String(list.length)); return 0; }
    if (p.o.reverse) list.reverse();
    list.forEach(function (s) { c.o.line(p.o.oneline ? short(s) + " " + subject(G.commitOf(c.sys, s).message) : s); });
    return 0;
  }
  function cmdLsTree(c, args) {
    needRepo(c);
    var p = parseOpts(c, args, ["r", "d", "t", "l|long", "name-only", "name-status", "full-tree", "abbrev=?"], "git ls-tree [<options>] <tree-ish> [<path>...]");
    if (!p.rest.length) die(c, "usage: git ls-tree [<options>] <tree-ish> [<path>...]", 129);
    var sha = rev(c, p.rest[0]), ob = G.getObject(c.sys, sha);
    if (ob.type === "commit" || ob.type === "tag") sha = G.commitOf(c.sys, sha).tree;
    function list(treeSha, prefix) {
      G.getObject(c.sys, treeSha).entries.forEach(function (e) {
        var path = prefix + e.name;
        if (e.mode === "40000" && p.o.r) { if (p.o.t) out(e, path); list(e.sha, path + "/"); return; }
        if (p.o.d && e.mode !== "40000") return;
        out(e, path);
      });
    }
    function out(e, path) { if (p.o["name-only"] || p.o["name-status"]) c.o.line(path); else c.o.line((e.mode === "40000" ? "040000 tree " : e.mode + " blob ") + (p.o.abbrev ? short(e.sha) : e.sha) + (p.o.long ? " " + lpad(e.mode === "40000" ? "-" : G.objSize(c.sys, e.sha), 7) : "") + "\t" + path); }
    list(sha, "");
    return 0;
  }
  function cmdShowRef(c, args) {
    needRepo(c);
    var p = parseOpts(c, args, ["heads", "branches", "tags", "head", "s|hash=?", "d|dereference", "verify", "q|quiet"], "git show-ref [--head] [-d | --dereference] [-s | --hash[=<n>]] [--abbrev[=<n>]] [--tags] [--heads] [--] [<pattern>...]");
    var refs = G.listRefs(c.repo, "refs/").filter(function (r) { return (!p.o.heads && !p.o.branches && !p.o.tags) || ((p.o.heads || p.o.branches) && /^refs\/heads\//.test(r.name)) || (p.o.tags && /^refs\/tags\//.test(r.name)); });
    if (p.o.head) refs.unshift({ name: "HEAD", sha: G.head(c.repo).sha });
    if (p.rest.length) refs = refs.filter(function (r) { return p.rest.some(function (x) { return r.name === x || r.name.slice(-x.length - 1) === "/" + x; }); });
    if (!refs.length) return 1;
    refs.forEach(function (r) { c.o.line(p.o.hash ? r.sha : r.sha + " " + r.name); if (p.o.dereference && G.getObject(c.sys, r.sha).type === "tag") c.o.line(G.peel(c.sys, r.sha) + " " + r.name + "^{}"); });
    return 0;
  }
  function cmdSymbolicRef(c, args) {
    needRepo(c);
    var a = args.filter(function (x) { return !/^-/.test(x); });
    if (a.length === 1) { var v = G.readRef(c.repo, a[0]); if (!v || v.indexOf("ref: ") !== 0) die(c, "fatal: ref " + a[0] + " is not a symbolic ref"); c.o.line(args.indexOf("--short") >= 0 ? v.slice(5).replace(/^refs\/heads\//, "") : v.slice(5)); return 0; }
    G.gwrite(c.repo, a[0], "ref: " + a[1] + "\n"); return 0;
  }
  function cmdUpdateRef(c, args) {
    needRepo(c);
    var del = args[0] === "-d", a = args.filter(function (x) { return !/^-/.test(x); });
    if (del) { G.updateRef(c.repo, a[0], null); return 0; }
    G.updateRef(c.repo, a[0], commitRev(c, a[1]), "update-ref", softIdent(c)); return 0;
  }
  function cmdWriteTree(c) { needRepo(c); c.o.line(G.writeTree(c.sys, G.readIndex(c.repo).entries)); storeObjects(c); return 0; }
  function cmdCountObjects(c) { needRepo(c); var n = keys(c.sys.gitObjects || {}).length; c.o.line(n + " objects, " + Math.ceil(n * 0.4) + " kilobytes"); return 0; }
  function cmdGc(c) { needRepo(c); c.o.line("Enumerating objects: " + keys(c.sys.gitObjects || {}).length + ", done."); c.o.line("Nothing else to do: this lab keeps every object loose."); return 0; }
  function cmdFsck(c) { needRepo(c); c.o.line("Checking object directories: 100% (256/256), done."); return 0; }
  function cmdWhatchanged(c, args) { return cmdLog(c, ["--stat"].concat(args)); }

  /* ================================================================== init and config */
  function cmdInit(c, args) {
    var p = parseOpts(c, args, ["b|initial-branch=", "q|quiet", "bare", "template=", "shared=?", "separate-git-dir=", "object-format="], "git init [-q | --quiet] [--bare] [--template=<template-directory>] [--shared[=<permissions>]] [<directory>]");
    var dir = p.rest[0] ? S.normAbs(p.rest[0].charAt(0) === "/" ? p.rest[0] : (c.cwd === "/" ? "" : c.cwd) + "/" + p.rest[0]) : c.cwd;
    // need write access where the repo goes
    var existing = G.nodeAt(c.sys, dir);
    if (existing && existing.type !== "d") die(c, "fatal: cannot mkdir " + p.rest[0] + ": File exists");
    var parent = existing ? existing : G.nodeAt(c.sys, dir.slice(0, dir.lastIndexOf("/")) || "/");
    if (!parent) { /* mkdir -p */ var up = dir; while (!G.nodeAt(c.sys, up)) up = up.slice(0, up.lastIndexOf("/")) || "/"; parent = G.nodeAt(c.sys, up); }
    if (!S.can(c.sess, parent, "w")) die(c, "fatal: cannot " + (existing ? "create directory at '" + dir + "/.git'" : "mkdir " + (p.rest[0] || dir)) + ": Permission denied");
    var bare = p.o.bare;
    var gitdir = bare ? dir : dir + "/.git";
    var reinit = !!G.nodeAt(c.sys, gitdir + "/HEAD");
    var uid = c.sess.uid, gid = c.sess.gid;
    if (reinit) {
      if (!p.o.quiet) c.o.line("Reinitialized existing Git repository in " + gitdir + "/");
      if (p.o["initial-branch"]) c.o.err("warning: re-init: ignored --initial-branch=" + p.o["initial-branch"]);
      return 0;
    }
    var branch = p.o["initial-branch"] || G.configGet(c.sys, null, c.uid, "init.defaultBranch", c.cfgExtra);
    if (!branch) {
      branch = "master";
      c.o.hint("Using 'master' as the name for the initial branch. This default branch name\nis subject to change. To configure the initial branch name to use in all\nof your new repositories, which will suppress this warning, call:\n\n\tgit config --global init.defaultBranch <name>\n\nNames commonly chosen instead of 'master' are 'main', 'trunk' and\n'development'. The just-created branch can be renamed via this command:\n\n\tgit branch -m <name>");
    }
    if (!validBranchName(branch)) die(c, "fatal: invalid initial branch name: '" + branch + "'");
    if (bare) {
      G.ensureDir(c.sys, dir, uid, gid, 509);
      var r0 = { sys: c.sys, top: dir, gitdir: dir, uid: uid, gid: gid };
      ["objects/info", "objects/pack", "refs/heads", "refs/tags", "hooks", "info", "branches"].forEach(function (d) { G.ensureDir(c.sys, dir + "/" + d, uid, gid, 509); });
      G.putFile(c.sys, dir + "/HEAD", "ref: refs/heads/" + branch + "\n", 436, uid, gid);
      G.putFile(c.sys, dir + "/config", "[core]\n\trepositoryformatversion = 0\n\tfilemode = true\n\tbare = true\n", 436, uid, gid);
      G.putFile(c.sys, dir + "/description", "Unnamed repository; edit this file 'description' to name the repository.\n", 436, uid, gid);
      if (!p.o.quiet) c.o.line("Initialized empty Git repository in " + dir + "/");
      return 0;
    }
    G.initRepo(c.sys, dir, uid, gid, branch);
    if (!p.o.quiet) c.o.line("Initialized empty Git repository in " + gitdir + "/");
    return 0;
  }
  function cmdConfig(c, args) {
    var p = parseOpts(c, args, ["global", "system", "local", "worktree", "file=", "f=", "l|list", "get", "get-all", "get-regexp", "unset", "unset-all", "add", "replace-all", "e|edit", "show-origin", "show-scope", "bool", "int", "type=", "default=", "name-only", "z|null", "includes", "no-includes", "rename-section", "remove-section"], "git config [<options>]");
    var o = p.o, a = p.rest;
    var scope = o.global ? "global" : o.system ? "system" : o.local ? "local" : (o.file || o.f) ? "file" : null;
    function fileFor(s) {
      if (s === "global") return G.homeOf(c.sys, c.uid) + "/.gitconfig";
      if (s === "system") return "/etc/gitconfig";
      if (s === "file") { var f = o.file || o.f; return S.normAbs(f.charAt(0) === "/" ? f : c.cwd + "/" + f); }
      if (!c.repo) die(c, "fatal: --local can only be used inside a git repository");
      return c.repo.gitdir + "/config";
    }
    function show(e) { var pre = (o["show-scope"] ? e.scope + "\t" : "") + (o["show-origin"] ? (e.scope === "command" ? "command line:" : "file:" + e.path.replace(c.repo ? c.repo.top + "/" : "\u0000", "")) + "\t" : ""); return pre; }
    function entries() {
      if (scope) { var f = fileFor(scope), t = G.readText(c.sys, f); if (t === null) { if (o.list) die(c, "fatal: unable to read config file '" + f + "': No such file or directory", 128); return []; } return G.parseConfig(t).map(function (e) { return { key: e.key, value: e.value, scope: scope, path: f }; }); }
      return G.configAll(c.sys, c.repo, c.uid, c.cfgExtra);
    }
    if (o.edit) { c.o.err("(git config --edit opens the config file in your editor. Here, open it with: nano " + fileFor(scope || "local").replace(G.homeOf(c.sys, c.uid), "~") + ", or set values with git config <key> <value>.)"); return 1; }
    if (o.list) { entries().forEach(function (e) { c.o.line(show(e) + (o["name-only"] ? e.key : e.key + "=" + e.value)); }); return 0; }
    if (o["remove-section"] || o["rename-section"]) {
      var fpath = fileFor(scope || "local"), txt = G.readText(c.sys, fpath) || "";
      var secName = a[0], lines = txt.split("\n"), outL = [], inSec = false, found = false;
      lines.forEach(function (l) {
        var hm = /^\s*\[\s*([A-Za-z0-9.-]+)(?:\s+"([^"]*)")?\s*\]/.exec(l);
        if (hm) { var nm = hm[1].toLowerCase() + (hm[2] !== undefined ? "." + hm[2] : ""); inSec = nm === secName.replace(/^([^.]+)/, function (x) { return x.toLowerCase(); }); if (inSec) { found = true; if (o["rename-section"]) { var nn = a[1].split("."); outL.push("[" + nn[0] + (nn.length > 1 ? " \"" + nn.slice(1).join(".") + "\"" : "") + "]"); inSec = false; } return; } }
        if (!inSec) outL.push(l);
      });
      if (!found) die(c, "fatal: no such section: " + secName);
      G.putFile(c.sys, fpath, outL.join("\n"), 436, c.uid, c.sess.gid);
      return 0;
    }
    if (!a.length) { c.o.err("usage: git config [<options>]"); return 129; }
    var key = a[0];
    if (o["get-regexp"]) { var re = new RegExp(key, "i"), any = false; entries().forEach(function (e) { if (re.test(e.key)) { any = true; c.o.line(show(e) + (o["name-only"] ? e.key : e.key + " " + e.value)); } }); return any ? 0 : 1; }
    if (!G.splitKey(key)) { c.o.err(/\./.test(key) ? "error: invalid key: " + key : "error: key does not contain a section: " + key); return /\./.test(key) ? 1 : 2; }
    var nk = G.normKey(key);
    if (o.unset || o["unset-all"]) {
      var f = fileFor(scope || "local"), t = G.readText(c.sys, f) || "";
      if (!G.parseConfig(t).some(function (e) { return e.key === nk; })) return 5;
      G.putFile(c.sys, f, G.setInConfig(t, key, null, true), 436, c.uid, c.sess.gid);
      return 0;
    }
    if (a.length === 1 || o.get || o["get-all"]) {
      var vals = entries().filter(function (e) { return e.key === nk; });
      if (!vals.length) { if (o.default !== undefined) { c.o.line(o.default); return 0; } return 1; }
      var outVals = o["get-all"] ? vals : vals.slice(-1);
      outVals.forEach(function (e) {
        var v = e.value;
        if (o.bool || o.type === "bool") v = G.configBool(v, false) ? "true" : "false";
        c.o.line(show(e) + v);
      });
      return 0;
    }
    if (!scope && !c.repo) die(c, "fatal: not in a git directory", 128);
    var file = fileFor(scope || "local");
    var text = G.readText(c.sys, file);
    if (text === null) {
      var dirN = G.nodeAt(c.sys, file.slice(0, file.lastIndexOf("/")) || "/");
      if (!dirN || !S.can(c.sess, dirN, "w")) die(c, "error: could not lock config file " + file + ": Permission denied", 255);
      text = "";
    } else { var fn = G.nodeAt(c.sys, file); if (!S.can(c.sess, fn, "w")) die(c, "error: could not lock config file " + file + ": Permission denied", 255); }
    var value = a.slice(1).join(" ");
    if (o.add) { text = text.replace(/\n?$/, "\n"); var k2 = G.splitKey(key); var hdr = "[" + k2.sec + (k2.sub !== null ? ' "' + k2.sub + '"' : "") + "]"; text = text.indexOf(hdr) >= 0 ? text.replace(hdr, hdr + "\n\t" + k2.rawName + " = " + value) : text + hdr + "\n\t" + k2.rawName + " = " + value + "\n"; }
    else text = G.setInConfig(text, key, value, !!o["replace-all"]);
    var nodeF = G.nodeAt(c.sys, file);
    if (nodeF) { nodeF.content = text; nodeF.mtime = c.sys.now; }
    else G.putFile(c.sys, file, text, 436 & ~umask(c), c.uid, c.sess.gid);
    return 0;
  }

  /* ================================================================== help */
  var USAGE = {
    init: ["git init [-b <branch-name>] [<directory>]", "Create an empty Git repository (the .git folder)"],
    config: ["git config [--global | --local] <name> [<value>]", "Get and set options, e.g. user.name, user.email, init.defaultBranch"],
    status: ["git status [-s] [-b]", "Show the working tree status: staged, unstaged and untracked changes"],
    add: ["git add [-A | -u] [-f] [--] <pathspec>...", "Add file contents to the staging area (the index)"],
    rm: ["git rm [--cached] [-r] [-f] <file>...", "Remove files from the working tree and the index (--cached: from the index only)"],
    mv: ["git mv <source> <destination>", "Move or rename a file and stage the change"],
    commit: ["git commit [-a] [--amend] [-m <msg>]", "Record the staged changes as a new commit"],
    diff: ["git diff [--staged] [<commit>] [<commit>] [-- <path>...]", "Show changes between the working tree, the index and commits"],
    log: ["git log [--oneline] [--graph] [--all] [-n <number>] [-p] [--stat] [<revision-range>] [-- <path>...]", "Show commit history"],
    show: ["git show [<object>...]", "Show a commit (message and diff), a tag, or a file at a commit (HEAD:path)"],
    branch: ["git branch [-v] [-a] [-d | -D <branch>] [-m <old> <new>] [<new-branch> [<start>]]", "List, create, rename or delete branches"],
    switch: ["git switch [-c <new-branch>] <branch>", "Switch branches (-c creates one)"],
    checkout: ["git checkout [-b <new-branch>] <branch> | git checkout [<commit>] -- <file>", "Switch branches, or restore files (older command; switch and restore split its two jobs)"],
    restore: ["git restore [--staged] [--source=<commit>] <file>...", "Restore files in the working tree (or unstage them with --staged)"],
    reset: ["git reset [--soft | --mixed | --hard] [<commit>] | git reset <file>", "Move the current branch to another commit, or unstage files"],
    revert: ["git revert [--no-edit] <commit>...", "Make a new commit that undoes an earlier commit"],
    merge: ["git merge [--no-ff | --ff-only] [-m <msg>] <branch> | --abort | --continue", "Join another branch's history into the current branch"],
    stash: ["git stash [push [-u] [-m <msg>]] | list | show [-p] | pop | apply | drop | clear", "Put local changes aside and get them back later"],
    tag: ["git tag [-a -m <msg>] <name> [<commit>] | -l [<pattern>] | -d <name>", "Create, list or delete tags"],
    describe: ["git describe [--tags] [--always] [<commit>]", "Name a commit after the nearest tag (v1.2-3-gabc1234)"],
    blame: ["git blame [-L <start>,<end>] [-e] [<rev>] <file>", "Show which commit and author last changed each line"],
    bisect: ["git bisect start | bad | good | skip | reset | log | run <cmd>", "Binary search through history for the commit that introduced a bug"],
    reflog: ["git reflog [<ref>]", "Show where HEAD (or a branch) has pointed: your safety net for lost commits"],
    "cherry-pick": ["git cherry-pick [-x] <commit>...", "Copy the changes from existing commits onto the current branch"],
    clean: ["git clean -n | -f [-d] [-x]", "Remove untracked files (-n shows what would go)"],
    grep: ["git grep [-n] [-i] <pattern> [<rev>] [-- <path>...]", "Search tracked files"],
    shortlog: ["git shortlog [-s] [-n]", "Summarize history by author"],
    "check-ignore": ["git check-ignore [-v] <path>...", "Show which .gitignore rule ignores a path"],
    "ls-files": ["git ls-files [-s] [-o] [--exclude-standard]", "List files in the index (tracked files)"],
    "cat-file": ["git cat-file (-t | -s | -p) <object>", "Show an object's type, size or contents"],
    "rev-parse": ["git rev-parse [--short] [--abbrev-ref] [--show-toplevel] <rev>", "Turn names into commit IDs, and more"],
    "hash-object": ["git hash-object [-w] <file>", "Compute the ID Git would give a file"],
    "merge-base": ["git merge-base <commit> <commit>", "Find the common ancestor of two commits"],
    "rev-list": ["git rev-list [--count] <rev-range>", "List commit IDs"],
    "ls-tree": ["git ls-tree [-r] <tree-ish>", "List the contents of a tree (a folder snapshot)"]
  };
  function cmdHelp(c, args) {
    var topic = args.filter(function (x) { return !/^-/.test(x); })[0];
    if (args.indexOf("-a") >= 0 || args.indexOf("--all") >= 0) { keys(USAGE).sort().forEach(function (k) { c.o.line("   " + pad(k, 16) + USAGE[k][1]); }); return 0; }
    if (topic && USAGE[topic.replace(/^git-/, "")]) {
      var u = USAGE[topic.replace(/^git-/, "")];
      c.o.line("usage: " + u[0]);
      c.o.line("");
      c.o.line(u[1] + ".");
      c.o.line("");
      c.o.line("(The full manual is in man git-" + topic.replace(/^git-/, "") + " on a real machine, or https://git-scm.com/docs/git-" + topic.replace(/^git-/, "") + ".)");
      return 0;
    }
    if (topic === "gitignore" || topic === "ignore") { c.o.line("A .gitignore file lists patterns of untracked files Git should ignore. One pattern per line:\n  *.log         any file ending in .log, in any folder\n  build/        any folder called build (and everything in it)\n  /todo.txt     only todo.txt at the top of the repository\n  !keep.log     an exception: don't ignore keep.log\n  # comment\n(https://git-scm.com/docs/gitignore)"); return 0; }
    if (topic) { c.o.err("No manual entry for git-" + topic); return 1; }
    c.o.line("usage: git [-v | --version] [-h | --help] [-C <path>] [-c <name>=<value>]\n           [--no-pager] <command> [<args>]\n\nThese are common Git commands used in various situations:\n\nstart a working area\n   clone     Clone a repository into a new directory\n   init      Create an empty Git repository or reinitialize an existing one\n\nwork on the current change\n   add       Add file contents to the index\n   mv        Move or rename a file, a directory, or a symlink\n   restore   Restore working tree files\n   rm        Remove files from the working tree and from the index\n\nexamine the history and state\n   bisect    Use binary search to find the commit that introduced a bug\n   diff      Show changes between commits, commit and working tree, etc\n   grep      Print lines matching a pattern\n   log       Show commit logs\n   show      Show various types of objects\n   status    Show the working tree status\n\ngrow, mark and tweak your common history\n   branch    List, create, or delete branches\n   commit    Record changes to the repository\n   merge     Join two or more development histories together\n   rebase    Reapply commits on top of another base tip\n   reset     Reset current HEAD to the specified state\n   switch    Switch branches\n   tag       Create, list, delete or verify a tag object signed with GPG\n\ncollaborate\n   fetch     Download objects and refs from another repository\n   pull      Fetch from and integrate with another repository or a local branch\n   push      Update remote refs along with associated objects\n\n'git help -a' lists the commands this lab knows. 'git help <command>' shows how to use one.");
    return 0;
  }

  /* ================================================================== dispatcher */
  var CMDS = {
    init: { fn: cmdInit, repo: false }, config: { fn: cmdConfig, repo: false }, status: { fn: cmdStatus }, add: { fn: cmdAdd }, rm: { fn: cmdRm }, mv: { fn: cmdMv },
    commit: { fn: cmdCommit }, diff: { fn: cmdDiff, repo: false }, log: { fn: cmdLog }, show: { fn: cmdShow }, branch: { fn: cmdBranch }, switch: { fn: cmdSwitch },
    checkout: { fn: cmdCheckout }, restore: { fn: cmdRestore }, reset: { fn: cmdReset }, revert: { fn: function (c, a) { return pickLike(c, "revert", a); } },
    "cherry-pick": { fn: function (c, a) { return pickLike(c, "cherry-pick", a); } }, merge: { fn: cmdMerge }, stash: { fn: cmdStash }, tag: { fn: cmdTag }, describe: { fn: cmdDescribe },
    blame: { fn: cmdBlame }, bisect: { fn: cmdBisect }, reflog: { fn: cmdReflog }, "ls-files": { fn: cmdLsFiles }, "cat-file": { fn: cmdCatFile }, "rev-parse": { fn: cmdRevParse, repo: false },
    "hash-object": { fn: cmdHashObject, repo: false }, shortlog: { fn: cmdShortlog }, grep: { fn: cmdGrep }, "check-ignore": { fn: cmdCheckIgnore }, clean: { fn: cmdClean },
    "merge-base": { fn: cmdMergeBase }, "rev-list": { fn: cmdRevList }, "ls-tree": { fn: cmdLsTree }, "show-ref": { fn: cmdShowRef }, "symbolic-ref": { fn: cmdSymbolicRef }, "update-ref": { fn: cmdUpdateRef }, "update-index": { fn: cmdUpdateIndex },
    "write-tree": { fn: cmdWriteTree }, "count-objects": { fn: cmdCountObjects }, gc: { fn: cmdGc }, fsck: { fn: cmdFsck }, whatchanged: { fn: cmdWhatchanged },
    help: { fn: cmdHelp, repo: false }, version: { fn: function (c) { c.o.line("git version " + VERSION); return 0; }, repo: false }
  };
  var LATER = { clone: "Module 2", fetch: "Module 2", pull: "Module 2", push: "Module 2", remote: "Module 2", rebase: "Module 2", worktree: "a later lab", submodule: "a later lab", am: "a later lab", "format-patch": "a later lab", "filter-repo": "Module 4", "filter-branch": "Module 4", lfs: "a later lab", notes: "a later lab", archive: "a later lab", sparse: "a later lab", maintenance: "a later lab", gui: "a later lab", gitk: "a later lab", instaweb: "a later lab", svn: "a later lab", "request-pull": "a later lab", "range-diff": "a later lab", "difftool": "a later lab", "mergetool": "a later lab" };
  function similar(name) {
    var best = null, bd = 99;
    keys(CMDS).forEach(function (k) {
      var a = name, b = k, d = [];
      for (var i = 0; i <= a.length; i++) { d[i] = [i]; for (var j = 1; j <= b.length; j++) d[i][j] = i === 0 ? j : Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); }
      if (d[a.length][b.length] < bd) { bd = d[a.length][b.length]; best = k; }
    });
    return bd <= 2 ? best : null;
  }
  function gitMain(args, io, sess) {
    var sys = sess.sys;
    G.tick(sys);
    var a = args.slice(1), cwd = sess.cwd, cfgExtra = [];
    var o = mkOut(io);
    while (a.length && /^-/.test(a[0])) {
      var x = a.shift();
      if (x === "-C") { var d = a.shift(); cwd = S.normAbs(d.charAt(0) === "/" ? d : cwd + "/" + d); var dn = G.nodeAt(sys, cwd); if (!dn || dn.type !== "d") { o.err("fatal: cannot change to '" + d + "': No such file or directory"); return 128; } continue; }
      if (x === "-c") { var kv = a.shift() || "", eq = kv.indexOf("="); cfgExtra.push({ key: eq < 0 ? kv : kv.slice(0, eq), value: eq < 0 ? "true" : kv.slice(eq + 1) }); continue; }
      if (x === "--no-pager" || x === "-P" || x === "-p" || x === "--paginate" || x === "--no-replace-objects" || x === "--literal-pathspecs" || x === "--no-optional-locks") continue;
      if (x === "--version" || x === "-v") { o.line("git version " + VERSION); return 0; }
      if (x === "--help" || x === "-h") { a = ["help"].concat(a); break; }
      if (x === "--exec-path") { o.line("/usr/lib/git-core"); return 0; }
      o.err("unknown option: " + x);
      o.err("usage: git [-v | --version] [-h | --help] [-C <path>] [-c <name>=<value>]\n           [--exec-path[=<path>]] [--html-path] [--man-path] [--info-path]\n           [-p | --paginate | -P | --no-pager] [--no-replace-objects] [--bare]\n           [--git-dir=<path>] [--work-tree=<path>] [--namespace=<name>]\n           [--config-env=<name>=<envvar>] <command> [<args>]");
      return 129;
    }
    if (!a.length) { var c0 = { sys: sys, sess: sess, io: io, o: o, cwd: cwd, uid: sess.uid, cfgExtra: cfgExtra }; cmdHelp(c0, []); return 1; }
    var name = a.shift();
    var repo = G.findRepo(sys, cwd);
    var c = { sys: sys, sess: sess, io: io, o: o, cwd: cwd, repo: repo, uid: sess.uid, cfgExtra: cfgExtra };
    // aliases
    var guard = 0;
    while (!CMDS[name] && guard++ < 10) {
      var al = G.configGet(sys, repo, sess.uid, "alias." + name, cfgExtra);
      if (!al) break;
      if (al.charAt(0) === "!") {
        var sub = S.childSession(sess); sub.cwd = repo ? repo.top : cwd;
        var line = al.slice(1) + (a.length ? " " + a.map(function (w) { return "'" + w.replace(/'/g, "'\\''") + "'"; }).join(" ") : "");
        try { return S.runSource(sub, line, io); } catch (e) { if (e instanceof S.ExitSignal) return e.code; if (e instanceof S.ShError) { io.err(e.message + "\n"); return e.code; } throw e; }
      }
      var words = al.match(/"[^"]*"|'[^']*'|\S+/g).map(function (w) { return w.replace(/^["']|["']$/g, ""); });
      name = words.shift(); a = words.concat(a);
    }
    if (a.indexOf("-h") >= 0 && CMDS[name] && name !== "help" && !(name === "branch" || name === "grep" || name === "ls-files" || name === "blame")) { cmdHelp(c, [name]); return 129; }
    if (!CMDS[name]) {
      if (LATER[name]) { o.err("(git " + name + " arrives in " + LATER[name] + " of the Git track. Module 1 works with one repository on your own machine.)"); return 1; }
      o.err("git: '" + name + "' is not a git command. See 'git --help'.");
      var sim = similar(name);
      if (sim) o.err("\nThe most similar command is\n\t" + sim);
      return 1;
    }
    var def = CMDS[name];
    if (def.repo !== false && !repo) { o.err("fatal: not a git repository (or any of the parent directories): .git"); return 128; }
    if (def.repo !== false && repo) {
      // git refuses repositories owned by someone else (CVE-2022-24765)
      var topNode = G.nodeAt(sys, repo.top), gnode = G.nodeAt(sys, repo.gitdir);
      if (gnode && gnode.uid !== sess.uid && sess.uid !== 0 && !safeDir(c, repo.top)) {
        o.err("fatal: detected dubious ownership in repository at '" + repo.top + "'\nTo add an exception for this directory, call:\n\n\tgit config --global --add safe.directory " + repo.top);
        return 128;
      }
    }
    try { return def.fn(c, a); }
    catch (e) {
      if (e instanceof Exit) return e.code;
      if (e instanceof G.RevError) { o.err(e.message); return 128; }
      throw e;
    }
  }
  function safeDir(c, top) {
    var all = G.configAll(c.sys, null, c.uid, c.cfgExtra).filter(function (e) { return e.key === "safe.directory" && (e.scope === "global" || e.scope === "system" || e.scope === "command"); });
    return all.some(function (e) { return e.value === "*" || e.value === top; });
  }

  S.CMDS.git = gitMain;
  // Internals for the files that add commands (remotes, rebase, GitHub, Actions, security).
  var X = { parseOpts: parseOpts, die: die, Exit: Exit, cfg: cfg, rev: rev, tryRev: tryRev, commitRev: commitRev, short: short, ident: ident, softIdent: softIdent,
    storeObjects: storeObjects, headFlat: headFlat, umask: umask, computeStatus: computeStatus, moveTree: moveTree, overwriteError: overwriteError, doSwitch: doSwitch,
    setUpstream: setUpstream, guessRemote: guessRemote, applyMerge: applyMerge, mergeMessages: mergeMessages, cmdMerge: cmdMerge, cmdCommit: cmdCommit, cmdSwitch: cmdSwitch,
    cmdCheckout: cmdCheckout, cmdReset: cmdReset, cmdBranch: cmdBranch, pickLike: pickLike, commitSummary: commitSummary, cleanupMessage: cleanupMessage, runHook: runHook,
    changes: changes, stats: stats, summaryLine: summaryLine, printChanges: printChanges, subject: subject, body: body, keys: keys, plural: plural, pad: pad, lpad: lpad,
    needWork: needWork, needRepo: needRepo, walk: walk, aheadBehind: aheadBehind, decorations: decorations, safeDir: safeDir, similar: similar, LATER: LATER };
  var api = { X: X, CMDS: CMDS, computeStatus: computeStatus, walk: walk, changes: changes, decorations: decorations, mkOut: mkOut, Exit: Exit, cmdLog: cmdLog, USAGE: USAGE, VERSION: VERSION, matcher: matcher, toRel: toRel, ignorer: ignorer, blameLines: blameLines };
  root.GitCmds = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
