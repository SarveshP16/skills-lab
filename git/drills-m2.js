/* sudo learn — Git track Module 2 practice drills (3 per lab, +5 XP each). Loaded after labs-m2.js. */
(function () {
  "use strict";
  var G = window.GitCore, GL = window.GitLab, GH = window.GitHub, T = window.GIT_TRACK, X = T.M2, lines = T.lines;
  var HOME = "/home/dev";
  function ran(r, re, fn) { return r.history.some(function (e) { return re.test(e.cmd) && (!fn || fn(e)); }); }
  function all(e) { return e.out.concat(e.err); }
  function outHas(e, re) { return all(e).some(function (l) { return re.test(l); }); }
  function repo(r, n) { return GL.H.repo(r, n); }
  function cfg(v, k) { return v ? G.configGet(v.sys, v.repo, 1000, k) : null; }
  var WEB = [{ msg: "Initial site", by: "maya", at: "2026-10-01 10:00", files: { "README.md": "# kestrel-web\n", "index.html": "<h1>Kestrel Cloud</h1>\n" } }];
  function web(o) {
    o = o || {};
    return function (sys) {
      X.world(sys, o);
      GH.seed(sys, "kestrel/kestrel-web", { steps: WEB.concat(o.steps || []) }, { description: "The Kestrel Cloud website" });
      if (o.before) o.before(sys);
      if (o.clone !== false) GH.cloneTo(sys, "kestrel/kestrel-web", HOME + "/kestrel-web");
      if (o.after) o.after(sys);
    };
  }
  function kite(o) {
    o = o || {};
    return function (sys) {
      X.world(sys);
      GH.user(sys, "ivan-k", { name: "Ivan Kowalski" }); GH.org(sys, "openkite", { "ivan-k": "owner" });
      var up = GH.seed(sys, "openkite/kite-lint", { steps: [{ msg: "kite-lint 0.9", by: { name: "Ivan Kowalski", email: "ivan@openkite.dev" }, files: { "README.md": "# kite-lint\n" } }] }, { private: false });
      var f = GH.createRepo(sys, "kc-dev/kite-lint", { private: false, forkOf: "openkite/kite-lint" }); Object.keys(up.refs).forEach(function (k) { f.refs[k] = up.refs[k]; });
      GH.cloneTo(sys, "kc-dev/kite-lint", HOME + "/kite-lint");
      if (o.upstream) GH.runAs(sys, HOME + "/kite-lint", ["git remote add upstream https://github.com/openkite/kite-lint.git", "git fetch -q upstream"]);
      if (o.ahead) GH.commit(sys, "openkite/kite-lint", "main", { name: "Ivan Kowalski", email: "ivan@openkite.dev" }, "Add CI badge", { "README.md": "# kite-lint\n\n![ci](badge.svg)\n" });
    };
  }
  function pr(r, full, n) { var x = GH.find(r.sys, full); return x ? GH.item(x, n) : null; }

  var DRILLS = {
    "gt-111": [
      {
        id: "d1", title: "Where is origin?", system: web(),
        text: "<p>In <code>~/kestrel-web</code>, print <b>only</b> the URL of the remote <code>origin</code>.</p>",
        starter: "", solution: lines("cd ~/kestrel-web", "git remote get-url origin"),
        check: function (r) { return ran(r, /git\s+(remote\s+get-url\s+origin|config\s+(--get\s+)?remote\.origin\.url)/, function (e) { return e.out.length === 1 && /github\.com.kestrel\/kestrel-web/.test(e.out[0]); }) ? true : "git remote get-url origin"; }
      },
      {
        id: "d2", title: "Remote branches only", system: web({ steps: [{ branch: "feature/search" }, { msg: "Search box", files: { "search.html": "<input>\n" } }, { checkout: "main" }] }),
        text: "<p>List <b>only</b> the remote-tracking branches of <code>~/kestrel-web</code>.</p>",
        starter: "", solution: lines("cd ~/kestrel-web", "git branch -r"),
        check: function (r) { return ran(r, /git\s+branch\s+(-r|--remotes)/, function (e) { return outHas(e, /origin\/feature\/search/) && !outHas(e, /^\*/); }) ? true : "git branch has an option for remote-tracking branches only."; }
      },
      {
        id: "d3", title: "Behind?", system: web({ after: function (sys) { GH.commit(sys, "kestrel/kestrel-web", "main", "ben", "Add footer", { "footer.html": "<footer></footer>\n" }); } }),
        text: "<p>Ben just pushed to GitHub. Without changing your branch, find out (with <code>git status</code>) how far behind <code>origin/main</code> your <code>main</code> is.</p>",
        starter: "", solution: lines("cd ~/kestrel-web", "git fetch", "git status"),
        check: function (r) { return ran(r, /git\s+status/, function (e) { return outHas(e, /Your branch is behind 'origin\/main' by 1 commit/); }) && repo(r, "kestrel-web").sha("main") !== GH.find(r.sys, "kestrel/kestrel-web").refs["refs/heads/main"] ? true : "git fetch first (git status only knows what your laptop has seen), then git status. Don't pull."; }
      }
    ],
    "gt-112": [
      {
        id: "d1", title: "Who am I?", system: web({ clone: false }),
        text: "<p>Check which GitHub account <code>gh</code> is logged in as, and with which token scopes.</p>",
        starter: "", solution: lines("gh auth status"),
        check: function (r) { return ran(r, /gh\s+auth\s+status/, function (e) { return outHas(e, /account kc-dev/) && outHas(e, /Token scopes/); }) ? true : "gh auth status"; }
      },
      {
        id: "d2", title: "Your keys", system: function (sys) { X.world(sys); GH.hub(sys).users["kc-dev"].keys.push({ title: "old-laptop", blob: "AAAAC3NzaC1lZDI1NTE5AAAAIOldLaptopKeyOldLaptopKeyOldLaptopKeyAA", type: "ssh-ed25519" }); },
        text: "<p>List the SSH keys on your GitHub account. There's one from an old laptop you no longer have: delete it.</p>",
        starter: "", solution: lines("gh ssh-key list", "gh ssh-key delete old-laptop"),
        check: function (r) { if (!ran(r, /gh\s+ssh-key\s+list/)) return "gh ssh-key list"; return GH.hub(r.sys).users["kc-dev"].keys.length === 0 ? true : "Delete the old-laptop key (gh ssh-key delete ...)."; }
      },
      {
        id: "d3", title: "HTTPS to SSH", system: web(),
        text: "<p>Change <code>~/kestrel-web</code>'s <code>origin</code> to use SSH instead of HTTPS (same repository).</p>",
        starter: "", solution: lines("cd ~/kestrel-web", "git remote set-url origin git@github.com:kestrel/kestrel-web.git", "git remote -v"),
        check: function (r) { return /^(ssh:\/\/)?git@github\.com[:\/]kestrel\/kestrel-web(\.git)?$/.test(cfg(repo(r, "kestrel-web"), "remote.origin.url") || "") ? true : "git remote set-url origin git@github.com:kestrel/kestrel-web.git"; }
      }
    ],
    "gt-113": [
      {
        id: "d1", title: "What's open?", system: web({ after: function (sys) { var x = GH.find(sys, "kestrel/kestrel-web"); x.refs["refs/heads/feature/a"] = x.refs["refs/heads/main"]; GH.commit(sys, "kestrel/kestrel-web", "feature/a", "ben", "Add FAQ", { "faq.html": "<h1>FAQ</h1>\n" }); GH.openPR(sys, "kestrel/kestrel-web", { title: "Add FAQ page", body: "FAQ", author: "ben-okoro", head: "feature/a" }); x.refs["refs/heads/feature/b"] = x.refs["refs/heads/main"]; GH.commit(sys, "kestrel/kestrel-web", "feature/b", "ana", "Add jobs", { "jobs.html": "<h1>Jobs</h1>\n" }); GH.openPR(sys, "kestrel/kestrel-web", { title: "Add jobs page", body: "Jobs", author: "ana-silva", head: "feature/b" }); } }),
        text: "<p>List the open pull requests on <code>kestrel/kestrel-web</code>.</p>",
        starter: "", solution: lines("cd ~/kestrel-web", "gh pr list"),
        check: function (r) { return ran(r, /gh\s+pr\s+list/, function (e) { return outHas(e, /Add FAQ page/) && outHas(e, /Add jobs page/); }) ? true : "gh pr list (inside ~/kestrel-web, or with -R kestrel/kestrel-web)."; }
      },
      {
        id: "d2", title: "Read the diff", system: web({ after: function (sys) { var x = GH.find(sys, "kestrel/kestrel-web"); x.refs["refs/heads/fix/title"] = x.refs["refs/heads/main"]; GH.commit(sys, "kestrel/kestrel-web", "fix/title", "ben", "Better heading", { "index.html": "<h1>Kestrel Cloud hosting</h1>\n" }); GH.openPR(sys, "kestrel/kestrel-web", { title: "Better heading", body: "", author: "ben-okoro", head: "fix/title" }); } }),
        text: "<p>Show the changes in pull request #1 without checking it out.</p>",
        starter: "", solution: lines("cd ~/kestrel-web", "gh pr diff 1"),
        check: function (r) { return ran(r, /gh\s+pr\s+diff/, function (e) { return outHas(e, /^\+<h1>Kestrel Cloud hosting<\/h1>/); }) ? true : "gh pr diff NUMBER"; }
      },
      {
        id: "d3", title: "Approve a teammate", system: web({ after: function (sys) { var x = GH.find(sys, "kestrel/kestrel-web"); x.refs["refs/heads/docs/readme"] = x.refs["refs/heads/main"]; GH.commit(sys, "kestrel/kestrel-web", "docs/readme", "ana", "Explain how to run the site", { "README.md": "# kestrel-web\n\nOpen index.html in a browser.\n" }); GH.openPR(sys, "kestrel/kestrel-web", { title: "Explain how to run the site", body: "Docs only.", author: "ana-silva", head: "docs/readme", reviewers: ["kc-dev"] }); } }),
        text: "<p>Ana asked you to review her pull request #1. It's fine: approve it with a short comment.</p>",
        starter: "", solution: lines("cd ~/kestrel-web", "gh pr review 1 --approve --body 'Clear, thanks!'"),
        check: function (r) { var p = pr(r, "kestrel/kestrel-web", 1); return p && p.reviews.some(function (x) { return x.by === "kc-dev" && x.state === "APPROVED"; }) ? true : "gh pr review 1 --approve --body '...'"; }
      }
    ],
    "gt-114": [
      {
        id: "d1", title: "Abort!", system: web({ after: function (sys) { GH.commit(sys, "kestrel/kestrel-web", "main", "ben", "New heading", { "index.html": "<h1>Kestrel</h1>\n" }); GH.runAs(sys, HOME + "/kestrel-web", ["git switch -q -c topic", "echo '<h1>Kestrel Cloud!</h1>' > index.html", "git commit -qam 'Exclaim'", "git fetch -q", "git rebase origin/main"]); } }),
        text: "<p>A rebase in <code>~/kestrel-web</code> stopped on a conflict and you'd rather not deal with it now. Put everything back as it was before the rebase.</p>",
        starter: "", solution: lines("cd ~/kestrel-web", "git status", "git rebase --abort"),
        check: function (r) { var v = repo(r, "kestrel-web"); return !r.exists(HOME + "/kestrel-web/.git/rebase-merge") && v.branch() === "topic" && v.commit("topic").subject === "Exclaim" && v.clean() ? true : "git rebase --abort"; }
      },
      {
        id: "d2", title: "Autosquash", system: web({ after: function (sys) { GH.runAs(sys, HOME + "/kestrel-web", ["git switch -q -c feature/login", "echo login > login.html", "git add login.html", "git commit -qm 'Add login page'", "echo '<form>' >> login.html", "git commit -qam 'fixup! Add login page'"]); } }),
        text: "<p>Branch <code>feature/login</code> has a <i>fixup!</i> commit. Fold it into <i>Add login page</i> with an interactive rebase onto <code>main</code> that arranges fixups automatically, telling Git not to open an editor (<code>GIT_SEQUENCE_EDITOR=:</code>).</p>",
        starter: "", solution: lines("cd ~/kestrel-web", "GIT_SEQUENCE_EDITOR=: git rebase -i --autosquash main", "git log --oneline -2"),
        check: function (r) { var v = repo(r, "kestrel-web"), l = v.log("feature/login").filter(function (c) { return !v.isAncestor(c.sha, "main"); }); return l.length === 1 && l[0].subject === "Add login page" && /<form>/.test(v.file("feature/login", "login.html") || "") ? true : "GIT_SEQUENCE_EDITOR=: git rebase -i --autosquash main"; }
      },
      {
        id: "d3", title: "Pull with rebase", system: web({ after: function (sys) { GH.runAs(sys, HOME + "/kestrel-web", ["echo hi > notes.txt", "git add notes.txt", "git commit -qm 'Add notes'"]); GH.commit(sys, "kestrel/kestrel-web", "main", "ben", "Add footer", { "footer.html": "<footer></footer>\n" }); } }),
        text: "<p>Your <code>main</code> has a local commit and GitHub's has a new one from Ben. Update <code>main</code> so your commit sits <b>on top</b> of Ben's (no merge commit).</p>",
        starter: "", solution: lines("cd ~/kestrel-web", "git pull --rebase"),
        check: function (r) { var v = repo(r, "kestrel-web"), up = GH.find(r.sys, "kestrel/kestrel-web").refs["refs/heads/main"]; return v.isAncestor(up, "main") && v.commit("main").parents.length === 1 && v.commit("main").subject === "Add notes" ? true : "git pull --rebase"; }
      }
    ],
    "gt-115": [
      {
        id: "d1", title: "Add upstream", system: kite(),
        text: "<p><code>~/kite-lint</code> is a clone of your fork, but it has no <code>upstream</code> remote. Add one for <code>openkite/kite-lint</code> and fetch it.</p>",
        starter: "", solution: lines("cd ~/kite-lint", "git remote add upstream https://github.com/openkite/kite-lint.git", "git fetch upstream"),
        check: function (r) { var v = repo(r, "kite-lint"); if (!/openkite\/kite-lint/.test(cfg(v, "remote.upstream.url") || "")) return "git remote add upstream https://github.com/openkite/kite-lint.git"; return v.sha("upstream/main") ? true : "Now fetch it: git fetch upstream"; }
      },
      {
        id: "d2", title: "Sync on GitHub", system: kite({ ahead: true }),
        text: "<p>OpenKite's <code>main</code> moved on. Bring <b>your fork's</b> <code>main</code> on GitHub up to date with one gh command (no local git needed).</p>",
        starter: "", solution: lines("gh repo sync kc-dev/kite-lint"),
        check: function (r) { var f = GH.find(r.sys, "kc-dev/kite-lint"), u = GH.find(r.sys, "openkite/kite-lint"); return f.refs["refs/heads/main"] === u.refs["refs/heads/main"] ? true : "gh repo sync OWNER/FORK"; }
      },
      {
        id: "d3", title: "Default repository", system: kite({ upstream: true }),
        text: "<p>In <code>~/kite-lint</code>, tell gh that pull requests and issues should go to <code>openkite/kite-lint</code>.</p>",
        starter: "", solution: lines("cd ~/kite-lint", "gh repo set-default openkite/kite-lint"),
        check: function (r) { return cfg(repo(r, "kite-lint"), "remote.upstream.gh-resolved") === "base" ? true : "gh repo set-default openkite/kite-lint"; }
      }
    ],
    "gt-116": [
      {
        id: "d1", title: "Mine", system: web({ after: function (sys) { GH.issue(sys, "kestrel/kestrel-web", { n: 2, title: "Compress images", author: "maya-chen", assignees: ["kc-dev"] }); GH.issue(sys, "kestrel/kestrel-web", { n: 3, title: "Update logo", author: "maya-chen", assignees: ["ben-okoro"] }); } }),
        text: "<p>List the open issues assigned to <b>you</b>.</p>",
        starter: "", solution: lines("cd ~/kestrel-web", "gh issue list --assignee @me"),
        check: function (r) { return ran(r, /gh\s+issue\s+list.*(--assignee|-a)\s*(@me|kc-dev)/, function (e) { return outHas(e, /Compress images/) && !outHas(e, /Update logo/); }) ? true : "gh issue list --assignee @me"; }
      },
      {
        id: "d2", title: "Good first issue", system: web({ after: function (sys) { GH.issue(sys, "kestrel/kestrel-web", { n: 4, title: "Fix alt text on the logo", author: "maya-chen", labels: ["documentation"] }); } }),
        text: "<p>Issue #4 is a nice starter task: add the <code>good first issue</code> label to it (keep its other label).</p>",
        starter: "", solution: lines("cd ~/kestrel-web", "gh issue edit 4 --add-label 'good first issue'"),
        check: function (r) { var i = pr(r, "kestrel/kestrel-web", 4); return i.labels.indexOf("good first issue") >= 0 && i.labels.indexOf("documentation") >= 0 ? true : "gh issue edit 4 --add-label 'good first issue'"; }
      },
      {
        id: "d3", title: "Ask a question", system: web({ after: function (sys) { GH.issue(sys, "kestrel/kestrel-web", { n: 6, title: "Site is slow in Asia", author: "ana-silva" }); } }),
        text: "<p>Comment on issue #6 asking which page was slow.</p>",
        starter: "", solution: lines("cd ~/kestrel-web", "gh issue comment 6 --body 'Which page was slow, and around what time?'"),
        check: function (r) { var i = pr(r, "kestrel/kestrel-web", 6); return i.comments.some(function (c) { return c.by === "kc-dev"; }) ? true : "gh issue comment 6 --body '...'"; }
      }
    ],
    "gt-117": [
      {
        id: "d1", title: "Protected?", system: web(),
        text: "<p>Ask the GitHub API whether <code>main</code> of <code>kestrel/kestrel-web</code> is protected.</p>",
        starter: "", solution: lines("gh api repos/kestrel/kestrel-web/branches/main/protection"),
        check: function (r) { return ran(r, /gh\s+api\s.*branches\/main\/protection/, function (e) { return outHas(e, /Branch not protected/); }) ? true : "gh api repos/OWNER/REPO/branches/main/protection"; }
      },
      {
        id: "d2", title: "SRE owns deploy", system: web({ steps: [{ msg: "Add deploy script", files: { "deploy/run.sh": "#!/bin/bash\n", ".github/CODEOWNERS": "* @kestrel/devs\n" } }] }),
        text: "<p>Make <code>@kestrel/sre</code> the code owners of everything under <code>/deploy/</code> (everyone else stays as is), and push it to <code>main</code>.</p>",
        starter: "", solution: lines("cd ~/kestrel-web", "echo '/deploy/ @kestrel/sre' >> .github/CODEOWNERS", "git commit -am 'SRE owns deploy/'", "git push"),
        check: function (r) { var rules = GH.codeowners(r.sys, GH.find(r.sys, "kestrel/kestrel-web"), "main"); var last = rules.filter(function (x) { return /^\/?deploy\/?/.test(x.pat); }).pop(); return last && last.owners.indexOf("@kestrel/sre") >= 0 && rules.some(function (x) { return x.pat === "*"; }) ? true : "Append a /deploy/ @kestrel/sre line to .github/CODEOWNERS, commit and push."; }
      },
      {
        id: "d3", title: "Tidy merges", system: web({ before: function (sys) { GH.find(sys, "kestrel/kestrel-web").collab["kc-dev"] = "admin"; } }),
        text: "<p>Make GitHub delete pull request branches automatically after they're merged, for <code>kestrel/kestrel-web</code>.</p>",
        starter: "", solution: lines("gh repo edit kestrel/kestrel-web --delete-branch-on-merge"),
        check: function (r) { return GH.find(r.sys, "kestrel/kestrel-web").settings.deleteBranchOnMerge ? true : "gh repo edit OWNER/REPO --delete-branch-on-merge"; }
      }
    ],
    "gt-118": [
      {
        id: "d1", title: "What happened here?", system: web({ after: function (sys) { GH.runAs(sys, HOME + "/kestrel-web", ["git switch -q -c wip", "echo 1 > a", "git add a", "git commit -qm 'Step 1'", "echo 2 > b", "git add b", "git commit -qm 'Step 2'", "git reset -q --hard HEAD~1"]); } }),
        text: "<p>Show the history of moves of the branch <code>wip</code> (not HEAD's), to see the reset.</p>",
        starter: "", solution: lines("cd ~/kestrel-web", "git reflog show wip"),
        check: function (r) { return ran(r, /git\s+reflog\s+(show\s+)?wip\b|git\s+log\s+-g\s+.*wip/, function (e) { return outHas(e, /reset: moving to HEAD~1/); }) ? true : "git reflog show wip"; }
      },
      {
        id: "d2", title: "ORIG_HEAD", system: web({ after: function (sys) { GH.runAs(sys, HOME + "/kestrel-web", ["echo 1 > a", "git add a", "git commit -qm 'Keep me'", "git reset -q --hard HEAD~1"]); } }),
        text: "<p>Someone just ran <code>git reset --hard HEAD~1</code> on <code>main</code> by mistake. Undo it with the ref Git saves before every reset.</p>",
        starter: "", solution: lines("cd ~/kestrel-web", "git reset --hard ORIG_HEAD"),
        check: function (r) { var v = repo(r, "kestrel-web"); return v.commit("main").subject === "Keep me" && ran(r, /ORIG_HEAD/) ? true : "git reset --hard ORIG_HEAD"; }
      },
      {
        id: "d3", title: "Two at once", system: web({ steps: [{ branch: "release/2.0", from: "main" }, { checkout: "main" }, { msg: "Fix login typo", files: { "login.html": "Log in\n" } }, { msg: "Fix logout typo", files: { "logout.html": "Log out\n" } }] }),
        text: "<p>Copy <b>both</b> of the last two commits on <code>main</code> onto <code>release/2.0</code>, in one cherry-pick.</p>",
        starter: "", solution: lines("cd ~/kestrel-web", "git switch release/2.0", "git cherry-pick main~2..main"),
        check: function (r) { var v = repo(r, "kestrel-web"), s = v.log("release/2.0").slice(0, 2).map(function (c) { return c.subject; }); return s.join("|") === "Fix logout typo|Fix login typo" ? true : "git switch release/2.0, then git cherry-pick main~2..main (a range)."; }
      }
    ],
    "gt-119": [
      {
        id: "d1", title: "Not ready yet", system: web({ after: function (sys) { GH.runAs(sys, HOME + "/kestrel-web", ["git switch -q -c feature/blog", "echo blog > blog.html", "git add blog.html", "git commit -qm 'Start blog'", "git push -q -u origin feature/blog"]); } }),
        text: "<p>Open a <b>draft</b> pull request for <code>feature/blog</code> to show work in progress.</p>",
        starter: "", solution: lines("cd ~/kestrel-web", "gh pr create --draft --title 'Blog (WIP)' --body 'Early draft, not ready for review.'"),
        check: function (r) { var p = pr(r, "kestrel/kestrel-web", 1); return p && p.draft ? true : "gh pr create --draft --title ... --body ..."; }
      },
      {
        id: "d2", title: "Ready for review", system: web({ after: function (sys) { var x = GH.find(sys, "kestrel/kestrel-web"); x.refs["refs/heads/feature/blog"] = x.refs["refs/heads/main"]; GH.commit(sys, "kestrel/kestrel-web", "feature/blog", "dev", "Blog", { "blog.html": "blog\n" }); GH.openPR(sys, "kestrel/kestrel-web", { title: "Blog", body: "Blog.", author: "kc-dev", head: "feature/blog", draft: true }); } }),
        text: "<p>Your draft pull request #1 is finished: mark it ready for review.</p>",
        starter: "", solution: lines("cd ~/kestrel-web", "gh pr ready 1"),
        check: function (r) { var p = pr(r, "kestrel/kestrel-web", 1); return p && !p.draft ? true : "gh pr ready 1"; }
      },
      {
        id: "d3", title: "Not this one", system: web({ after: function (sys) { var x = GH.find(sys, "kestrel/kestrel-web"); x.refs["refs/heads/experiment/fonts"] = x.refs["refs/heads/main"]; GH.commit(sys, "kestrel/kestrel-web", "experiment/fonts", "dev", "Try new fonts", { "fonts.css": "body{}\n" }); GH.openPR(sys, "kestrel/kestrel-web", { title: "Try new fonts", body: "Experiment.", author: "kc-dev", head: "experiment/fonts" }); } }),
        text: "<p>The fonts experiment (PR #1) won't be merged. Close it with a comment saying why, and delete its branch.</p>",
        starter: "", solution: lines("cd ~/kestrel-web", "gh pr close 1 --comment 'Going with the current fonts.' --delete-branch"),
        check: function (r) { var p = pr(r, "kestrel/kestrel-web", 1), x = GH.find(r.sys, "kestrel/kestrel-web"); if (!p || p.state !== "closed") return "gh pr close 1 --comment '...' --delete-branch"; if (!p.comments.some(function (c) { return c.by === "kc-dev"; })) return "Say why (--comment)."; return x.refs["refs/heads/experiment/fonts"] ? "Delete the branch too (--delete-branch)." : true; }
      }
    ]
  };
  T.LABS.forEach(function (l) { if (DRILLS[l.id]) l.drills = DRILLS[l.id]; });
})();
