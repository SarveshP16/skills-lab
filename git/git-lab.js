/* sudo learn — the Git lab runner. The Git track runs on the same simulated Ubuntu machine and Bash as the Linux
   track, but on a developer laptop (kc-dev-01) with git installed and an identity set up. Each lab's `system`
   function builds its repositories with GitCore.build. Checks get helpers in GitLab.H to inspect repositories. */
(function (root) {
  "use strict";
  var S = root.ShEngine, G = root.GitCore, GC = root.GitCmds, SL = root.ShLab;
  var HOME = "/home/dev";

  // The laptop: hostname, git binary, identity (labs that teach `git config` remove ~/.gitconfig).
  function base(sys) {
    sys.host = "kc-dev-01";
    S.put(sys, "/etc/hostname", "kc-dev-01\n", 420);
    S.put(sys, "/usr/bin/git", "\x7fELF:git (simulated binary)\n", 493);
    S.put(sys, HOME + "/.gitconfig", "[user]\n\tname = dev\n\temail = dev@kestrel.io\n[init]\n\tdefaultBranch = main\n", 436, 1000, 1000);
    S.mkdirs(sys, HOME + "/projects", 509, 1000, 1000);
  }
  function compose(labSystem) {
    return function (sys) { base(sys); if (labSystem) labSystem(sys); };
  }
  function wrap(msg) { return Object.assign({}, msg, { system: compose(msg.system) }); }
  function handle(msg) {
    if (msg.type === "complete") { var c = complete(wrap(msg)); if (c) return c; }
    return SL.handle(wrap(msg));
  }
  // Tab completion: git subcommands, then branch and tag names for commands that take them.
  var COMMON = ["add", "bisect", "blame", "branch", "checkout", "cherry-pick", "clean", "clone", "commit", "fetch", "pull", "push", "rebase", "remote", "config", "describe", "diff", "grep", "help", "init", "log", "merge", "mv", "reflog", "reset", "restore", "revert", "rm", "shortlog", "show", "stash", "status", "switch", "tag"];
  function common(list, word) {
    var c = list.filter(function (x) { return x.indexOf(word) === 0; });
    if (!c.length) return null;
    var pre = c.reduce(function (a, b) { var k = 0; while (k < a.length && a.charAt(k) === b.charAt(k)) k++; return a.slice(0, k); });
    return { cands: c, pre: pre };
  }
  function complete(msg) {
    var line = msg.line || "";
    var m = /^(\s*git\s+)([\w-]*)$/.exec(line);
    if (m) {
      var r = common(COMMON, m[2]);
      if (!r) return { line: line, options: [] };
      return { line: m[1] + (r.cands.length === 1 ? r.cands[0] + " " : r.pre), options: r.cands.length > 1 ? r.cands : [] };
    }
    var m2 = /^(\s*git\s+(?:switch|checkout|merge|branch|log|diff|show|reset|revert|cherry-pick|rebase|describe|tag\s+-d|bisect\s+(?:good|bad|start))\b(?:\s+-\S+)*\s+)(\S*)$/.exec(line);
    if (!m2) return null;
    var run = SL.replay(msg.code, { files: msg.files || {}, prelude: msg.prelude || "", system: msg.system });
    var shell = S.activeShell(run.sess), repo = G.findRepo(run.sess.sys, shell.cwd);
    if (!repo) return null;
    var names = G.listRefs(repo, "refs/heads/").map(function (x) { return x.name.slice(11); })
      .concat(G.listRefs(repo, "refs/tags/").map(function (x) { return x.name.slice(10); }))
      .concat(G.listRefs(repo, "refs/remotes/").map(function (x) { return x.name.slice(13); }));
    var r2 = common(names, m2[2]);
    if (!r2) return null;
    return { line: m2[1] + (r2.cands.length === 1 ? r2.cands[0] + " " : r2.pre), options: r2.cands.length > 1 ? r2.cands : [] };
  }

  /* ---------------- check helpers: inspect a repository on the learner's final machine */
  function repoView(r, path) {
    var abs = path.charAt(0) === "/" ? path : HOME + "/" + path.replace(/^~\//, "");
    var sys = r.sys;
    var gd = G.nodeAt(sys, abs + "/.git");
    if (!gd || gd.type !== "d" || !gd.children.HEAD) return null;
    var repo = G.repoAt(sys, abs);
    var self = {
      repo: repo, sys: sys, top: abs,
      head: function () { return G.head(repo); },
      branch: function () { var h = G.head(repo); return h.detached ? null : h.branch; },
      sha: function (spec) { try { return G.peel(sys, G.resolve(repo, spec || "HEAD")); } catch (e) { return null; } },
      commit: function (spec) { var s = self.sha(spec); var co = s ? G.commitOf(sys, s) : null; return co ? Object.assign({ sha: s, subject: co.message.split("\n")[0] }, co) : null; },
      // commits reachable from spec, newest first (first-parent order unless all)
      log: function (spec, all) {
        var s = self.sha(spec || "HEAD"); if (!s) return [];
        return GC.walk({ sys: sys, repo: repo }, [s], [], { firstParent: !all }).map(function (x) { var co = G.commitOf(sys, x); return Object.assign({ sha: x, subject: co.message.split("\n")[0] }, co); });
      },
      count: function (spec) { var s = self.sha(spec || "HEAD"); return s ? Object.keys(G.ancestors(sys, s)).length : 0; },
      files: function (spec) { var s = self.sha(spec || "HEAD"); return s ? G.commitFlat(sys, s) : {}; },
      file: function (spec, p) { var f = self.files(spec)[p]; return f ? G.blobText(sys, f.sha) : null; },
      branches: function () { return G.listRefs(repo, "refs/heads/").map(function (x) { return x.name.slice(11); }); },
      tags: function () { return G.listRefs(repo, "refs/tags/").map(function (x) { return x.name.slice(10); }); },
      tag: function (name) { var sha = G.resolveRefName(repo, "refs/tags/" + name).sha; if (!sha) return null; var o = G.getObject(sys, sha); return { sha: sha, annotated: o.type === "tag", target: G.peel(sys, sha), message: o.type === "tag" ? o.message : null, tagger: o.tagger || null }; },
      index: function () { return G.readIndex(repo); },
      status: function () {
        var sess = S.newSession(sys); sess.cwd = abs;
        var c = { sys: sys, sess: sess, repo: repo, cwd: abs, uid: 1000, cfgExtra: [], io: { out: function () {}, err: function () {} }, o: { line: function () {}, err: function () {}, hint: function () {} } };
        return GC.computeStatus(c);
      },
      clean: function () { var st = self.status(); return !st.staged.length && !st.unstaged.length && !st.unmerged.length; },
      config: function (key) { return G.configGet(sys, repo, 1000, key); },
      ignored: function (p, isDir) { var sess = S.newSession(sys); var c = { sys: sys, sess: sess, repo: repo, cwd: abs, uid: 1000, cfgExtra: [] }; return !!GC.ignorer(c).ignored(p, !!isDir); },
      merging: function () { return G.gexists(repo, "MERGE_HEAD"); },
      bisecting: function () { return G.gexists(repo, "BISECT_START"); },
      stashes: function () { return G.reflog(repo, "refs/stash"); },
      reflog: function (ref) { return G.reflog(repo, ref || "HEAD"); },
      isAncestor: function (a, b) { var x = self.sha(a), y = self.sha(b); return !!x && !!y && G.isAncestor(sys, x, y); },
      work: function (p) { var n = G.nodeAt(sys, abs + "/" + p); return n && n.type === "f" ? n.content : null; }
    };
    return self;
  }
  // Git output lines from the history: every command that started with "git".
  function gitRuns(r, sub) {
    var re = new RegExp("^\\s*git\\s+(?:-C\\s+\\S+\\s+)?" + (sub || ""));
    return r.history.filter(function (e) { return re.test(e.cmd); });
  }
  var H = {
    repo: repoView,
    gitRuns: gitRuns,
    // Re-run the learner's commands on another machine (alt.system is a lab system; the laptop base is added).
    run: function (r, alt) { return r.run(null, alt && alt.system ? Object.assign({}, alt, { system: compose(alt.system) }) : alt); },
    // Did some command print text matching re (or containing a string)?
    printed: function (r, what, filter) {
      return r.history.some(function (e) {
        if (filter && !filter(e)) return false;
        var t = e.out.join("\n");
        return typeof what === "string" ? t.indexOf(what) >= 0 : what.test(t);
      });
    },
    // Index of the last command whose output contains want(r) (string). With alt, the same command must also
    // print want(r2) on the alternative machine. Returns true or a reason ("none"/"alt").
    showsAnswer: function (r, want, alt, filter) {
      var w = want(r);
      var idx = -1;
      for (var i = r.history.length - 1; i >= 0; i--) { var e = r.history[i]; if (filter && !filter(e)) continue; if (e.out.join("\n").indexOf(w) >= 0) { idx = i; break; } }
      if (idx < 0) return "none";
      if (!alt) return true;
      var r2 = H.run(r, alt), e2 = r2.history[idx], w2 = want(r2);
      return e2 && e2.out.join("\n").indexOf(w2) >= 0 ? true : "alt";
    }
  };

  var runner = {
    ready: false,
    start: function (hooks) { this.ready = true; hooks.setStatus("ok", "kc-dev-01 · Ubuntu 24.04 · git 2.43 (simulated)"); hooks.enableRun(); },
    call: function (msg) { return new Promise(function (res) { setTimeout(function () { res(handle(msg)); }, 0); }); }
  };
  var api = { handle: handle, runner: runner, base: base, compose: compose, H: H, HOME: HOME };
  root.GitLab = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
