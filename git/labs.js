/* sudo learn — Git & GitHub track, Module 1: Git on your own machine (GT-101..110). Terminal-first labs on a
   simulated laptop (kc-dev-01) with a simulated git 2.43. Each lab's `system` builds its repositories and history
   with GitCore.build; checks inspect the repositories (GitLab.H.repo) and what your commands printed. */
(function () {
  "use strict";
  var S = window.ShEngine, G = window.GitCore, GL = window.GitLab, SH = window.ShLab.H;
  var MAYA = "Maya Chen · SRE lead", DEV = "Dev Patel · Security", BEN = "Ben Okoro · Developer";
  var HOME = "/home/dev";

  function esc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
  function ex(cmd) { return '<pre class="ex">' + esc(cmd) + "</pre>"; }
  function code(text) { return '<pre class="code">' + esc(text) + "</pre>"; }
  function lines() { return Array.prototype.slice.call(arguments).join("\n") + "\n"; }
  function repo(r, name) { return GL.H.repo(r, name); }
  function short(s) { return s ? s.slice(0, 7) : ""; }
  function ran(r, re, fn) { return r.history.some(function (e) { return re.test(e.cmd) && (!fn || fn(e)); }); }
  function out(e) { return e.out.join("\n"); }
  // A repo must exist; returns the view or a message string.
  function need(r, name) { var v = repo(r, name); return v || "~/" + name + " isn't a Git repository any more (was .git deleted?). Use Reset machine to start over."; }
  function noMarkers(t) { return !/^(<{7}|={7}|>{7})( |$)/m.test(t || ""); }
  function linesOf(t) { return String(t || "").split("\n").map(function (l) { return l.replace(/\s+$/, ""); }).filter(Boolean); }
  function sameLines(a, b) { var x = linesOf(a).slice().sort(), y = linesOf(b).slice().sort(); return JSON.stringify(x) === JSON.stringify(y); }
  function rmGitconfig(sys) { var h = G.nodeAt(sys, HOME); if (h) delete h.children[".gitconfig"]; }
  function inRepo(e, name) { return e.cwdBefore === HOME + "/" + name || e.cwdBefore.indexOf(HOME + "/" + name + "/") === 0 || /\s-C\s/.test(e.cmd); }

  var LABS = [];

  /* ================================================================== GT-101 */
  var RUNBOOKS = {
    "runbooks/README.md": "# Runbooks\n\nStep-by-step fixes for the things that break at 3 a.m.\n",
    "runbooks/disk-full.md": "# Disk full\n\n1. Find the full filesystem: df -h\n2. Find what's big: sudo du -sh /var/* | sort -h\n3. Old logs? Compress or delete them.\n4. Check the app's log level isn't DEBUG.\n"
  };
  LABS.push({
    id: "gt-101", n: 1, module: 1, ticket: "GT-101", xp: 100,
    title: "Your first repository",
    topic: "git config, git init, git status",
    from: MAYA,
    story: "<p>Welcome to the dev team! IT gave you a laptop, <code>kc-dev-01</code>, with Git installed. Before you touch team code, set Git up properly, then start keeping your own notes in <code>~/runbooks</code> under version control.</p>",
    learn:
      "<h3>What Git does</h3><p>Git records <b>snapshots</b> of a folder over time. Each snapshot (a <b>commit</b>) remembers every file, who made it, when, and why. You can compare snapshots, go back to one, or work on several versions side by side. The whole history lives in a hidden <code>.git</code> folder inside your project, so every copy of a repository has the complete history.</p>" +
      "<h3>Tell Git who you are</h3><p>Every commit is signed with a name and email. Set them once for your whole user account with <code>--global</code>:</p>" +
      ex('git config --global user.name "Sam Lee"') + ex('git config --global user.email "sam.lee@kestrel.io"') +
      "<p>Settings live at three levels. A more specific level wins:</p>" +
      '<table class="t"><tr><th>Level</th><th>Option</th><th>File</th></tr><tr><td>system (every user)</td><td><code>--system</code></td><td><code>/etc/gitconfig</code></td></tr><tr><td>global (you)</td><td><code>--global</code></td><td><code>~/.gitconfig</code></td></tr><tr><td>local (one repo)</td><td><code>--local</code> (the default inside a repo)</td><td><code>.git/config</code></td></tr></table>' +
      "<p>Read a setting with <code>git config user.name</code>. See everything, and which file each value comes from:</p>" + ex("git config --list --show-origin") +
      "<h3>The first branch's name</h3><p>A new repository starts with one branch. Old Git versions call it <code>master</code>; GitHub and most teams now use <code>main</code>. Set that once and Git stops printing a long hint every time:</p>" + ex("git config --global init.defaultBranch main") +
      "<h3>Start a repository</h3>" + ex("cd ~/runbooks\ngit init") +
      "<p><code>git init</code> creates <code>.git</code> in the current folder (or <code>git init NAME</code> creates the folder too). Nothing is tracked yet: you choose what goes in. Leave <code>.git</code> alone; deleting it deletes the history.</p>" +
      "<h3>Your most-used command</h3>" + ex("git status") +
      "<p><code>git status</code> tells you which branch you're on and how each file differs from the last snapshot. New files Git doesn't know about yet are <b>untracked</b>. When in doubt, run <code>git status</code>.</p>",
    system: function (sys) {
      rmGitconfig(sys);
      Object.keys(RUNBOOKS).forEach(function (k) { G.putFile(sys, HOME + "/" + k, RUNBOOKS[k], 436, 1000, 1000); });
    },
    starter: "",
    objectives: [
      {
        id: "ident", text: "Set your name and email for <b>every</b> repository on this laptop (any name, an email with an <code>@</code>).",
        hints: ["git config with --global, once for user.name and once for user.email.", 'git config --global user.name "Sam Lee"\ngit config --global user.email "sam.lee@kestrel.io"'],
        check: function (r) {
          var t = r.read("~/.gitconfig");
          if (!t) return "Nothing in ~/.gitconfig yet. Use git config --global user.name \"Your Name\".";
          var cfg = G.parseConfig(t), get = function (k) { var v = null; cfg.forEach(function (e) { if (e.key === k) v = e.value; }); return v; };
          if (!get("user.name")) return "Set user.name with --global (put names with spaces in quotes).";
          if (!/.+@.+/.test(get("user.email") || "")) return "Set user.email with --global (it should contain an @).";
          return true;
        }
      },
      {
        id: "branch", text: "Make new repositories start on a branch called <code>main</code>.",
        hints: ["The setting is init.defaultBranch.", "git config --global init.defaultBranch main"],
        check: function (r) { var t = r.read("~/.gitconfig") || ""; var v = null; G.parseConfig(t).forEach(function (e) { if (e.key === "init.defaultbranch") v = e.value; }); return v === "main" ? true : "Set init.defaultBranch to main in your global config."; }
      },
      {
        id: "origin", text: "List all your Git settings together with the file each one comes from.",
        hints: ["git config --list, plus an option that shows the origin.", "git config --list --show-origin"],
        check: function (r) { return ran(r, /git\s+config\b.*(--list|-l\b)/, function (e) { return /--show-origin/.test(e.cmd) && /file:.*\.gitconfig/.test(out(e)); }) ? true : "Run git config --list with --show-origin (after setting your name)."; }
      },
      {
        id: "init", text: "Turn <code>~/runbooks</code> into a Git repository whose branch is <code>main</code>.",
        hints: ["cd into the folder, then one command creates the repository.", "cd ~/runbooks\ngit init"],
        check: function (r) {
          var v = repo(r, "runbooks");
          if (!v) return "~/runbooks isn't a repository yet: run git init inside it.";
          var h = v.head();
          if (h.branch !== "main") return "The repository's branch is " + h.branch + ". Set init.defaultBranch first, or rename the branch: git branch -m main";
          if (!r.exists("~/runbooks/README.md")) return "Keep the files in ~/runbooks.";
          return true;
        }
      },
      {
        id: "status", text: "Ask the new repository for its status: <code>README.md</code> and <code>disk-full.md</code> should show up as untracked.",
        hints: ["One command shows the state of the repository. Run it inside ~/runbooks.", "git status"],
        check: function (r) { return ran(r, /^\s*git\s+status/, function (e) { return /Untracked files:|^\?\? /m.test(out(e)) && /README\.md/.test(out(e)) && /disk-full\.md/.test(out(e)); }) ? true : "Run git status inside ~/runbooks (after git init)."; }
      }
    ],
    solution: lines('git config --global user.name "Sam Lee"', 'git config --global user.email "sam.lee@kestrel.io"', "git config --global init.defaultBranch main", "git config --list --show-origin", "cd ~/runbooks", "git init", "git status"),
    debrief: "<p>Ticket closed. Git knows who you are, new repositories start on <code>main</code>, and <code>~/runbooks</code> has a <code>.git</code> folder ready to record history. Nothing is saved in it yet: Git only tracks what you tell it to. That's the next ticket.</p>",
    realworld: "On your own machine, run git --version (install Git from git-scm.com if it's missing), then the same three git config --global commands. Use the email of your GitHub account so GitHub links your commits to you.",
    quiz: [
      { q: "Where does <code>git config --global user.name</code> store the name?", options: [".git/config", "~/.gitconfig", "/etc/gitconfig", "In every commit only"], answer: 1, why: "--global is your user's file, ~/.gitconfig. --local (the default in a repo) is .git/config." },
      { q: "What does <code>git init</code> create?", options: ["A first commit", "A .git folder that holds the history", "A copy of the files", "A GitHub repository"], answer: 1, why: "git init creates an empty repository (.git). Nothing is committed until you add and commit." },
      { q: "A file Git has never been told about shows up in <code>git status</code> as…", options: ["modified", "staged", "untracked", "ignored"], answer: 2, why: "Untracked = in the folder but not in the repository yet." }
    ]
  });

  /* ================================================================== GT-102 */
  var NGINX_RB = "# Restart nginx safely\n\n1. Test the config first: sudo nginx -t\n2. Reload (no dropped connections): sudo systemctl reload nginx\n3. Check it: systemctl status nginx\n";
  function runbooksRepo(sys) {
    G.initRepo(sys, HOME + "/runbooks", 1000, 1000, "main");
    Object.keys(RUNBOOKS).forEach(function (k) { G.putFile(sys, HOME + "/" + k, RUNBOOKS[k], 436, 1000, 1000); });
    G.putFile(sys, HOME + "/runbooks/nginx-restart.md", NGINX_RB, 436, 1000, 1000);
    G.putFile(sys, HOME + "/runbooks/scratch.txt", "my notes - don't commit\nask Maya about on-call rota\n", 436, 1000, 1000);
  }
  var LSOF = "5. Check for deleted files still held open: sudo lsof +L1";
  LABS.push({
    id: "gt-102", n: 2, module: 1, ticket: "GT-102", xp: 100,
    title: "Your first commits",
    topic: "git add, git commit, git diff, the staging area",
    from: MAYA,
    story: "<p>Your <code>~/runbooks</code> repository is set up but empty. Save the runbooks in it, one logical change per commit. <code>scratch.txt</code> is just your personal notes: it stays out.</p>",
    learn:
      "<h3>Three places a change can be</h3>" +
      '<table class="t"><tr><th>Place</th><th>What it is</th><th>Move it on with</th></tr><tr><td><b>Working tree</b></td><td>the files you edit</td><td><code>git add</code></td></tr><tr><td><b>Staging area</b> (the index)</td><td>what the next commit will contain</td><td><code>git commit</code></td></tr><tr><td><b>Repository</b></td><td>the saved snapshots (commits)</td><td></td></tr></table>' +
      "<p>The staging area lets you choose exactly what goes into each commit, even when you've changed many files.</p>" +
      ex("git add README.md disk-full.md") + ex('git commit -m "Add first runbooks"') +
      "<p><code>git add .</code> stages everything in the current folder; naming files stages just those. <code>-m</code> gives the commit message. Write it as a short summary in the imperative: <i>Add</i>, <i>Fix</i>, <i>Remove</i> (\"Add first runbooks\", not \"added stuff\").</p>" +
      "<h3>See what changed</h3>" +
      '<table class="t"><tr><th>Command</th><th>Shows</th></tr><tr><td><code>git diff</code></td><td>working tree vs staging area: changes you haven\'t staged</td></tr><tr><td><code>git diff --staged</code></td><td>staging area vs last commit: what <code>git commit</code> would save</td></tr></table>' +
      "<p>In a diff, lines starting with <code>+</code> were added and <code>-</code> removed. <code>@@ -3,4 +3,5 @@</code> says where: lines 3 to 6 before, 3 to 7 after.</p>" +
      "<h3>Editing files</h3><p>Type <code>nano FILE</code> to open a file in the editor panel (it stands in for a real terminal editor). Or append from the shell:</p>" + ex('echo "6. Tell #ops when you\'re done" >> disk-full.md') +
      "<h3>The loop</h3>" + code("edit → git status → git diff → git add → git diff --staged → git commit") +
      "<p><code>git log --oneline</code> lists your commits, newest first.</p>",
    system: runbooksRepo,
    starter: "",
    objectives: [
      {
        id: "first", text: "Commit <code>README.md</code> and <code>disk-full.md</code> (only those two) with the message <code>Add first runbooks</code>.",
        hints: ["Name the two files in git add, then commit with -m.", 'cd ~/runbooks\ngit add README.md disk-full.md\ngit commit -m "Add first runbooks"'],
        check: function (r) {
          var v = need(r, "runbooks"); if (typeof v === "string") return v;
          var log = v.log("HEAD"); if (!log.length) return "No commits yet. Stage the two files with git add, then git commit -m \"Add first runbooks\".";
          var first = log[log.length - 1], files = Object.keys(G.commitFlat(r.sys, first.sha)).sort();
          if (files.join(",") !== "README.md,disk-full.md") return "The first commit should contain exactly README.md and disk-full.md. It contains: " + files.join(", ") + ". (Reset machine to try again.)";
          return first.subject === "Add first runbooks" ? true : "The first commit's message should be exactly: Add first runbooks (it's \"" + first.subject + "\").";
        }
      },
      {
        id: "second", text: "Commit <code>nginx-restart.md</code> in a second commit, with a message that describes it.",
        hints: ["git add the file, then git commit -m with your own message.", 'git add nginx-restart.md\ngit commit -m "Add nginx restart runbook"'],
        check: function (r) {
          var v = need(r, "runbooks"); if (typeof v === "string") return v;
          var log = v.log("HEAD");
          var hit = log.filter(function (c) { var f = G.commitFlat(r.sys, c.sha), p = c.parents[0] ? G.commitFlat(r.sys, c.parents[0]) : {}; return f["nginx-restart.md"] && !p["nginx-restart.md"]; })[0];
          if (!hit) return "Commit nginx-restart.md (it isn't in any commit yet).";
          if (!hit.parents.length) return "nginx-restart.md should arrive in its own, second commit.";
          return /^(update|wip|commit|changes?|stuff|asdf|x+)$/i.test(hit.subject.trim()) ? "Give that commit a message that says what it does, e.g. \"Add nginx restart runbook\"." : true;
        }
      },
      {
        id: "diff", text: "Add the line <code>" + esc(LSOF) + "</code> to the end of <code>disk-full.md</code>, then look at the change with <code>git diff</code> <b>before</b> staging it.",
        hints: ["Append with echo and >> (or nano disk-full.md), then git diff with no options.", 'echo "' + LSOF + '" >> disk-full.md\ngit diff'],
        check: function (r) { return ran(r, /^\s*git\s+diff\s*$|^\s*git\s+diff\s+(--\s+)?disk-full\.md\s*$/, function (e) { return out(e).indexOf("+" + LSOF) >= 0; }) ? true : "After adding the line, run git diff (no options): it should show the new line with a + in front."; }
      },
      {
        id: "staged", text: "Stage it, check what will be committed with <code>git diff --staged</code>, then commit.",
        hints: ["git add disk-full.md, then git diff --staged, then git commit -m.", 'git add disk-full.md\ngit diff --staged\ngit commit -m "Add lsof step to disk-full runbook"'],
        check: function (r) {
          var v = need(r, "runbooks"); if (typeof v === "string") return v;
          if (!ran(r, /^\s*git\s+diff\s+.*(--staged|--cached)/, function (e) { return out(e).indexOf("+" + LSOF) >= 0; })) return "Run git diff --staged after git add: it shows what the commit will contain.";
          if ((v.file("HEAD", "disk-full.md") || "").indexOf(LSOF) < 0) return "Now commit the change.";
          return true;
        }
      },
      {
        id: "scratch", text: "Keep <code>scratch.txt</code> out of every commit (but don't delete it).",
        hints: ["Don't use git add . here, or if you did, unstage scratch.txt before committing.", "git status should still list scratch.txt as untracked."],
        check: function (r) {
          var v = need(r, "runbooks"); if (typeof v === "string") return v;
          if (!r.exists("~/runbooks/scratch.txt")) return "Don't delete scratch.txt: just leave it untracked.";
          var inAny = v.log("HEAD").some(function (c) { return G.commitFlat(r.sys, c.sha)["scratch.txt"]; });
          if (inAny) return "scratch.txt made it into a commit. Reset machine and stage files by name this time.";
          return v.log("HEAD").length >= 3 ? true : "Finish the other tasks (three commits) without ever committing scratch.txt.";
        }
      }
    ],
    solution: lines("cd ~/runbooks", "git status", "git add README.md disk-full.md", 'git commit -m "Add first runbooks"', "git add nginx-restart.md", 'git commit -m "Add nginx restart runbook"', 'echo "' + LSOF + '" >> disk-full.md', "git diff", "git add disk-full.md", "git diff --staged", 'git commit -m "Add lsof step to disk-full runbook"', "git log --oneline"),
    debrief: "<p>Three commits, each one a single logical change with a clear message. That's what makes history useful later: you can read it, undo one change without the others, and find when something happened.</p><p>The habit to keep: <b>look before you commit</b>. <code>git status</code> and <code>git diff --staged</code> are how you catch the debug line, the stray file, or the password you didn't mean to commit.</p>",
    realworld: "In any project of yours: git init, git add a few files, git commit. Many editors (VS Code included) show the staging area in a Source Control panel: it's the same index you used here.",
    quiz: [
      { q: "You changed a file and ran <code>git add</code>. Which command now shows that change?", options: ["git diff", "git diff --staged", "git log", "git show"], answer: 1, why: "Once staged, the change is between the index and the last commit: git diff --staged (or --cached)." },
      { q: "Why have a staging area at all?", options: ["To back up files", "To choose exactly what goes into the next commit", "To make commits faster", "It's required by GitHub"], answer: 1, why: "You can change ten files and commit them as three separate, focused commits." },
      { q: "Which is the best commit message?", options: ["changes", "Fixed it", "Add lsof step to disk-full runbook", "WIP!!!"], answer: 2, why: "Short, specific, imperative: it says what the commit does." }
    ]
  });

  /* ================================================================== shared: the kestrel-web history (GT-103, 106, 108) */
  var NGX = function (timeout, gzip, maint) {
    return "server {\n    listen 80;\n    server_name kestrel.io www.kestrel.io;\n    root /var/www/kestrel;\n" + (gzip ? "    gzip on;\n" : "") + (maint ? "    error_page 503 /maintenance.html;\n" : "") +
      "\n    location /api/ {\n        proxy_pass http://127.0.0.1:8000;\n        proxy_read_timeout " + timeout + ";\n    }\n}\n";
  };
  function indexHtml(o) {
    o = o || {};
    return "<!doctype html>\n<html lang=\"en\">\n<head>\n  <meta charset=\"utf-8\">\n  <title>Kestrel Cloud</title>\n  <link rel=\"stylesheet\" href=\"style.css\">\n" + (o.favicon ? "  <link rel=\"icon\" href=\"favicon.ico\">\n" : "") +
      "</head>\n<body>\n  <header><h1>Kestrel Cloud</h1></header>\n" + (o.banner ? "  <div class=\"banner\">New: status page alerts</div>\n" : "") +
      "  <main>\n    <p>" + (o.copy ? "Hosting that stays up, with humans who answer." : "Fast, friendly cloud hosting.") + "</p>\n" + (o.search ? "    <input id=\"search\" placeholder=\"Search the docs\">\n" : "") + "  </main>\n" + (o.footer ? "  <footer>© 2026 Kestrel Cloud</footer>\n" : "") + (o.searchJs ? "  <script src=\"search.js\"></script>\n" : "") + "</body>\n</html>\n";
  }
  var CSS1 = "body { font-family: system-ui, sans-serif; margin: 0; }\nheader { background: #0b6; color: #fff; padding: 1rem; }\nmain { padding: 2rem; }\n";
  var CSS2 = CSS1.replace("padding: 1rem; }", "padding: 1rem; position: sticky; top: 0; }");
  function statusHtml(o) { o = o || {}; return "<!doctype html>\n<html lang=\"en\">\n<head><meta charset=\"utf-8\"><title>Status</title></head>\n<body>\n  <h1>" + (o.fixed ? "Kestrel" : "Kestral") + " Cloud status</h1>\n  <p id=\"state\">All systems operational</p>\n" + (o.uptime ? "  <p id=\"uptime\">Uptime (90 days): 99.98%</p>\n" : "") + (o.incidents ? "  <p><a href=\"/incidents\">Incident history</a></p>\n" : "") + "</body>\n</html>\n"; }
  var DEPLOY1 = "#!/bin/bash\n# Deploy the site to the web server\nset -euo pipefail\nrsync -av --delete site/ deploy@kc-web-01:/var/www/kestrel/\n";
  var DEPLOY2 = "#!/bin/bash\n# Deploy the site to the web server, keeping the last 5 releases\nset -euo pipefail\nREL=$(date +%Y%m%d%H%M)\nrsync -av site/ deploy@kc-web-01:/srv/releases/$REL/\nssh deploy@kc-web-01 \"ln -sfn /srv/releases/$REL /var/www/kestrel && ls -1dt /srv/releases/* | tail -n +6 | xargs rm -rf\"\n";
  var MAINT = "<!doctype html>\n<html lang=\"en\">\n<head><meta charset=\"utf-8\"><title>Back soon</title></head>\n<body>\n  <h1>We'll be right back</h1>\n  <p>Kestrel Cloud is down for planned maintenance.</p>\n</body>\n</html>\n";
  // v: 0 = the lab's history, 1 = an alternative used to check answers came from commands
  function webSteps(v) {
    var t = v ? "90s" : "60s";
    var who = v ? { a: "ben", b: "leo", c: "maya", d: "ana" } : { a: "maya", b: "ben", c: "ana", d: "leo" };
    return [
      { msg: "Initial commit", by: who.a, at: "2026-10-01 09:12", files: { "README.md": "# kestrel-web\n\nThe Kestrel Cloud website and status page.\n" } },
      { msg: "Add nginx config", by: who.a, at: "2026-10-02 11:40", files: { "nginx/kestrel.conf": NGX("30s") } },
      { msg: "Add landing page", by: who.b, at: "2026-10-05 14:03", files: { "site/index.html": indexHtml(), "site/style.css": CSS1 } },
      { msg: "Add status page", by: who.c, at: "2026-10-08 10:27", files: { "site/status.html": statusHtml() } },
      { msg: "Add deploy script", by: who.b, at: "2026-10-12 16:55", files: { "deploy.sh": DEPLOY1 }, exec: ["deploy.sh"] },
      { msg: "Make the header sticky", by: who.d, at: "2026-10-15 09:48", files: { "site/style.css": CSS2 } },
      { msg: "Add maintenance page", by: who.c, at: "2026-10-19 13:20", files: { "site/maintenance.html": MAINT, "nginx/kestrel.conf": NGX("30s", false, true) } },
      { msg: "Enable gzip", by: who.a, at: "2026-10-22 08:31", files: { "nginx/kestrel.conf": NGX("30s", true, true) } },
      { msg: "Show uptime on status page", by: who.b, at: "2026-10-26 15:12", files: { "site/status.html": statusHtml({ uptime: 1 }) } },
      { msg: "Update copy on landing page", by: who.c, at: "2026-10-29 11:05", files: { "site/index.html": indexHtml({ copy: 1 }) } },
      { msg: "Raise proxy timeout to " + t, by: who.d, at: "2026-11-02 17:44", files: { "nginx/kestrel.conf": NGX(t, true, true) } },
      { msg: "Add favicon link", by: who.c, at: "2026-11-05 10:16", files: { "site/index.html": indexHtml({ copy: 1, favicon: 1 }) } },
      { msg: "Deploy script: keep 5 releases", by: who.a, at: "2026-11-07 14:38", files: { "deploy.sh": DEPLOY2 } },
      { msg: "Status page: link to incident history", by: who.b, at: "2026-11-10 10:02", files: { "site/status.html": statusHtml({ uptime: 1, incidents: 1 }) } }
    ];
  }
  var WEB = HOME + "/kestrel-web";

  /* ================================================================== GT-103 */
  LABS.push({
    id: "gt-103", n: 3, module: 1, ticket: "GT-103", xp: 100,
    title: "Reading history",
    topic: "git log, git show",
    from: BEN,
    story: "<p>Since last week, some API calls through the website time out. Before anyone changes anything, find out what changed and who changed it. The website lives in <code>~/kestrel-web</code>, with a month of history.</p>",
    learn:
      "<h3>git log</h3>" + ex("git log") +
      "<p>Newest first. Each commit has an <b>ID</b> (a 40-character SHA-1 hash of its contents; the first 7 characters are enough to name it), an author, a date and a message. <code>(HEAD -> main)</code> marks where you are.</p>" +
      '<table class="t"><tr><th>Option</th><th>Does</th></tr>' +
      "<tr><td><code>--oneline</code></td><td>one line per commit</td></tr>" +
      "<tr><td><code>-n 5</code> or <code>-5</code></td><td>only the last 5</td></tr>" +
      "<tr><td><code>-p</code></td><td>with the diff of each commit</td></tr>" +
      "<tr><td><code>--stat</code></td><td>which files changed, and how much</td></tr>" +
      '<tr><td><code>--author="Ana"</code></td><td>commits whose author matches</td></tr>' +
      '<tr><td><code>--grep="timeout"</code></td><td>commits whose message matches</td></tr>' +
      '<tr><td><code>--since="2 weeks ago"</code></td><td>recent commits only (also <code>--until</code>)</td></tr>' +
      "<tr><td><code>-- PATH</code></td><td>only commits that changed that file or folder</td></tr>" +
      '<tr><td><code>--format="%h %an %ar %s"</code></td><td>your own format: short ID, author, relative date, subject</td></tr></table>' +
      "<p>Options combine:</p>" + ex("git log --oneline -3 -- deploy.sh") +
      "<h3>git show</h3><p>Shows one commit: its message and its diff.</p>" + ex("git show HEAD") + ex("git show --stat HEAD~2") +
      "<p><code>HEAD</code> is the commit you're on; <code>HEAD~1</code> is its parent, <code>HEAD~2</code> the grandparent. You can also use an ID: <code>git show 1a2b3c4</code>. To see a file as it was at a commit: <code>git show HEAD~3:site/index.html</code>.</p>",
    system: function (sys) { G.build(sys, WEB, { steps: webSteps(0) }); },
    starter: "",
    objectives: [
      {
        id: "oneline", text: "Show the whole history of <code>~/kestrel-web</code> with one line per commit.",
        hints: ["cd into the repository, then git log with the one-line option.", "cd ~/kestrel-web\ngit log --oneline"],
        check: function (r) {
          var v = need(r, "kestrel-web"); if (typeof v === "string") return v;
          var log = v.log("HEAD"), first = log[log.length - 1], last = log[0];
          return ran(r, /^\s*git\s+log\b/, function (e) { var t = out(e); return t.split("\n").length <= log.length + 2 && t.indexOf(short(first.sha)) >= 0 && t.indexOf(short(last.sha)) >= 0; }) ? true : "Use git log --oneline: every commit on one line, from the newest to \"Initial commit\".";
        }
      },
      {
        id: "nginx", text: "Find the most recent commit that changed <code>nginx/kestrel.conf</code>, and show its diff.",
        hints: ["git log can be limited to one file (-- PATH), show diffs (-p) and only one commit (-1).", "git log -p -1 -- nginx/kestrel.conf"],
        check: function (r) {
          return ran(r, /^\s*git\s+(log|show)\b/, function (e) { var t = out(e); return t.indexOf("+        proxy_read_timeout 60s;") >= 0 && t.indexOf("-        proxy_read_timeout 30s;") >= 0; }) ? true : "Show the diff of the last commit that touched nginx/kestrel.conf (git log -p -1 -- FILE, or find it and git show it).";
        }
      },
      {
        id: "author", text: "List only the commits made by <b>Ana Silva</b>, one per line.",
        hints: ["git log has an option to filter by author.", 'git log --author="Ana" --oneline'],
        check: function (r) {
          var v = need(r, "kestrel-web"); if (typeof v === "string") return v;
          var log = v.log("HEAD"), ana = log.filter(function (c) { return c.author.name === "Ana Silva"; }), other = log.filter(function (c) { return c.author.name !== "Ana Silva"; });
          return ran(r, /^\s*git\s+(log|shortlog)\b/, function (e) { var t = out(e); return ana.every(function (c) { return t.indexOf(short(c.sha)) >= 0; }) && other.every(function (c) { return t.indexOf(short(c.sha)) < 0; }); }) ? true : "Show all of Ana's commits and nobody else's (git log --author=...), one per line.";
        }
      },
      {
        id: "grep", text: "Find the commit whose message mentions the <b>maintenance page</b>, and show which files it changed (names or a stat, not the whole diff).",
        hints: ["--grep searches commit messages; --stat (or --name-only) lists the files.", 'git log --grep="maintenance page" --stat'],
        check: function (r) {
          return ran(r, /^\s*git\s+(log|show)\b/, function (e) { var t = out(e); return /Add maintenance page/.test(t) && /site\/maintenance\.html/.test(t) && /nginx\/kestrel\.conf/.test(t) && !/^\+\s*<h1>We'll be right back/m.test(t); }) ? true : "Show the \"maintenance page\" commit with the files it changed: --grep plus --stat or --name-only.";
        }
      },
      {
        id: "since", text: "Show only the commits from the last week.",
        hints: ["git log --since takes things like \"1 week ago\" or a date.", 'git log --oneline --since="1 week ago"'],
        check: function (r) {
          var v = need(r, "kestrel-web"); if (typeof v === "string") return v;
          var now = G.clock(r.sys), log = v.log("HEAD");
          var recent = log.filter(function (c) { return c.committer.time >= now - 7 * 86400 - 3600; }), old = log.filter(function (c) { return c.committer.time < now - 8 * 86400; });
          return ran(r, /^\s*git\s+log\b.*(--since|--after)/, function (e) { var t = out(e); return recent.every(function (c) { return t.indexOf(short(c.sha)) >= 0; }) && old.every(function (c) { return t.indexOf(short(c.sha)) < 0; }); }) ? true : "Use git log --since=\"1 week ago\" (it's Wednesday 11 November; the last week has 3 commits).";
        }
      }
    ],
    solution: lines("cd ~/kestrel-web", "git log", "git log --oneline", "git log -p -1 -- nginx/kestrel.conf", 'git log --author="Ana" --oneline', 'git log --grep="maintenance page" --stat', 'git log --oneline --since="1 week ago"'),
    debrief: "<p>Found it: on 2 November Leo raised <code>proxy_read_timeout</code> to 60 seconds, so slow API calls now hang for a minute before failing. That's a lead to follow up, not proof, but you got from \"something changed\" to \"this line, this commit, this person\" in five commands.</p><p>That's why focused commits with clear messages matter: <code>git log</code> is only as useful as the history people write.</p>",
    realworld: "Try git log --oneline --graph --all and git log -p -- <some file> in any repository you've cloned. Many people add an alias: git config --global alias.lg \"log --oneline --graph --all\".",
    quiz: [
      { q: "What is <code>HEAD~2</code>?", options: ["The second branch", "The commit two before the current one", "The last two commits", "A tag"], answer: 1, why: "~ walks back through first parents: HEAD~1 is the parent, HEAD~2 the grandparent." },
      { q: "Which command lists only commits that touched <code>deploy.sh</code>?", options: ["git log deploy.sh --all", "git log -- deploy.sh", "git show deploy.sh", "git diff deploy.sh"], answer: 1, why: "Paths after -- limit git log to commits that changed them." },
      { q: "A commit ID like <code>3f9c2ab</code> is…", options: ["A counter", "The start of a hash of the commit's contents", "Random", "The author's ID"], answer: 1, why: "Git names every object by the SHA-1 hash of its content, so the same content always gets the same ID." }
    ]
  });

  /* ================================================================== GT-104 */
  var TOKEN = ["kc_live_", "7Hq2ZpLw", "93xRtVb1"].join("");
  var API = HOME + "/kestrel-api";
  function apiIgnoreRepo(sys) {
    G.build(sys, API, {
      steps: [
        { msg: "Initial API skeleton", by: "ben", at: "2026-10-20 10:00", files: { "README.md": "# kestrel-api\n\nThe Kestrel Cloud public API.\n", "requirements.txt": "fastapi==0.115.0\nuvicorn==0.30.6\n", "app/__init__.py": "", "app/main.py": "from fastapi import FastAPI\n\napp = FastAPI()\n\n\n@app.get(\"/health\")\ndef health():\n    return {\"ok\": True}\n" } },
        { msg: "Add settings", by: "ben", at: "2026-10-23 15:30", files: { "config/settings.example.json": "{\n  \"api_token\": \"<put your token here>\",\n  \"debug\": false\n}\n", "config/settings.local.json": "{\n  \"api_token\": \"" + TOKEN + "\",\n  \"debug\": true\n}\n" } },
        { msg: "Add orders endpoint", by: "ana", at: "2026-11-03 11:20", files: { "app/orders.py": "def list_orders():\n    return []\n" } }
      ]
    });
    var put = function (p, t) { G.putFile(sys, API + "/" + p, t, 436, 1000, 1000); };
    put(".env", "DATABASE_URL=postgres://api:" + ["s3cr", "et-pa", "ss"].join("") + "@kc-db-01/kestrel\n");
    put("app/__pycache__/main.cpython-312.pyc", "\u0000compiled\n");
    put("app/__pycache__/orders.cpython-312.pyc", "\u0000compiled\n");
    put("tests/__pycache__/test_orders.cpython-312.pyc", "\u0000compiled\n");
    put("tests/test_orders.py", "from app.orders import list_orders\n\n\ndef test_empty():\n    assert list_orders() == []\n");
    put("venv/bin/activate", "# virtualenv activate script\n");
    put("venv/lib/python3.12/site-packages/fastapi/__init__.py", "# fastapi\n");
    put("logs/api.log", "2026-11-11 08:59:01 INFO started\n");
    put("logs/api.log.1.gz", "\u001f\u008b(gzip)\n");
    put("logs/.gitkeep", "");
  }
  function ign(r, p, d) { var v = repo(r, "kestrel-api"); return v && v.ignored(p, d); }
  LABS.push({
    id: "gt-104", n: 4, module: 1, ticket: "GT-104", xp: 120,
    title: "Keep it out: .gitignore",
    topic: ".gitignore, git check-ignore, git rm --cached",
    from: DEV,
    story: "<p>Ben's <code>~/kestrel-api</code> has no <code>.gitignore</code>, so <code>git status</code> is a wall of caches, a virtualenv, logs and a <code>.env</code> full of passwords. One <code>git add .</code> and they're all in the repository. Worse: <code>config/settings.local.json</code>, with a live API token, is <b>already</b> committed.</p>" +
      '<div class="callout warn">A secret that reached a commit must be treated as leaked. Removing the file stops new leaks; it doesn\'t erase the old commit. The token gets rotated today (and in Module 4 you\'ll learn to clean history).</div>',
    learn:
      "<h3>.gitignore</h3><p>A text file listing patterns of untracked files Git should ignore: <code>git status</code> stops showing them and <code>git add .</code> skips them. One pattern per line:</p>" +
      '<table class="t"><tr><th>Pattern</th><th>Ignores</th></tr>' +
      "<tr><td><code>.env</code></td><td>any file or folder named .env, anywhere</td></tr>" +
      "<tr><td><code>*.log</code></td><td>any name ending in .log, anywhere</td></tr>" +
      "<tr><td><code>__pycache__/</code></td><td>any <b>folder</b> with that name (trailing <code>/</code> = folders only)</td></tr>" +
      "<tr><td><code>/todo.txt</code></td><td>only todo.txt at the top (a leading <code>/</code>, or any <code>/</code> in the middle, anchors the pattern to the .gitignore's folder)</td></tr>" +
      "<tr><td><code>logs/*</code></td><td>everything inside logs/ (but not logs itself)</td></tr>" +
      "<tr><td><code>!logs/.gitkeep</code></td><td>an exception: <b>don't</b> ignore this one</td></tr>" +
      "<tr><td><code># note</code></td><td>a comment</td></tr></table>" +
      '<div class="callout">Order matters: the last matching line wins. And an exception can\'t rescue a file inside a folder that is itself ignored: <code>logs/</code> followed by <code>!logs/.gitkeep</code> doesn\'t work, but <code>logs/*</code> followed by <code>!logs/.gitkeep</code> does.</div>' +
      "<p>Create it with the editor (<code>nano .gitignore</code>) or from the shell:</p>" + ex("printf '.env\\n*.log\\n' > .gitignore") +
      "<h3>Which rule ignores this?</h3>" + ex("git check-ignore -v .env") + "<p>prints the file, line number and pattern responsible. <code>git status --ignored</code> lists ignored files too.</p>" +
      "<h3>Already tracked? .gitignore doesn't help</h3><p>Ignore rules only apply to <b>untracked</b> files. To stop tracking a committed file but keep it on disk:</p>" + ex("git rm --cached config/settings.local.json") +
      "<p>That stages the file's removal from the repository (<code>git rm</code> without <code>--cached</code> would delete it from disk too). Add it to <code>.gitignore</code> and commit both. Use <code>-r</code> for a folder.</p>",
    system: apiIgnoreRepo,
    starter: "",
    objectives: [
      {
        id: "basic", text: "Create <code>~/kestrel-api/.gitignore</code> so Git ignores <code>.env</code>, every <code>__pycache__/</code> folder, <code>venv/</code> and <code>*.log</code> files.",
        hints: ["One pattern per line. A trailing / means \"folders only\".", "printf '.env\\n__pycache__/\\nvenv/\\n*.log\\n' > .gitignore\ngit status"],
        check: function (r) {
          if (!r.exists("~/kestrel-api/.gitignore")) return "Create the file ~/kestrel-api/.gitignore.";
          var miss = [[".env", 0], ["app/__pycache__/main.cpython-312.pyc", 0], ["tests/__pycache__/test_orders.cpython-312.pyc", 0], ["venv/bin/activate", 0], ["logs/api.log", 0]].filter(function (x) { return !ign(r, x[0], x[1]); }).map(function (x) { return x[0]; });
          if (miss.length) return "Not ignored yet: " + miss.join(", ");
          if (ign(r, "app/main.py") || ign(r, "requirements.txt") || ign(r, "tests/test_orders.py")) return "Your rules ignore real source files too (app/main.py, tests/...). Make them more specific.";
          return true;
        }
      },
      {
        id: "logs", text: "Ignore <b>everything</b> inside <code>logs/</code> (there are rotated <code>.gz</code> files too) <b>except</b> <code>logs/.gitkeep</code>.",
        hints: ["Ignore the folder's contents with logs/* (not logs/), then add an exception line starting with !.", "logs/*\n!logs/.gitkeep"],
        check: function (r) {
          if (!ign(r, "logs/api.log.1.gz")) return "logs/api.log.1.gz isn't ignored yet: ignore everything in logs/.";
          if (ign(r, "logs/.gitkeep")) return "logs/.gitkeep is ignored too. Use logs/* (contents) instead of logs/ (the folder), then !logs/.gitkeep.";
          return true;
        }
      },
      {
        id: "commit", text: "Commit <code>.gitignore</code> and <code>logs/.gitkeep</code> (and nothing secret).",
        hints: ["git add the two files by name and commit.", 'git add .gitignore logs/.gitkeep\ngit commit -m "Add .gitignore"'],
        check: function (r) {
          var v = need(r, "kestrel-api"); if (typeof v === "string") return v;
          var f = v.files("HEAD");
          if (f[".env"] || Object.keys(f).some(function (k) { return /__pycache__|^venv\/|\.log/.test(k); })) return "Something that should be ignored got committed (.env, caches, venv or logs). Reset machine and try again.";
          if (!f[".gitignore"]) return "Commit .gitignore.";
          return f["logs/.gitkeep"] ? true : "Commit logs/.gitkeep too.";
        }
      },
      {
        id: "untrack", text: "Stop tracking <code>config/settings.local.json</code> (keep the file on disk), make Git ignore it, and commit.",
        hints: ["git rm --cached removes it from the repository but not from the disk. Then add its path to .gitignore.", 'git rm --cached config/settings.local.json\necho "config/settings.local.json" >> .gitignore\ngit add .gitignore\ngit commit -m "Stop tracking local settings"'],
        check: function (r) {
          var v = need(r, "kestrel-api"); if (typeof v === "string") return v;
          if (!r.exists("~/kestrel-api/config/settings.local.json")) return "The app still needs config/settings.local.json on disk: use git rm --cached (Reset machine to get it back).";
          if (v.files("HEAD")["config/settings.local.json"]) return "config/settings.local.json is still in the latest commit. git rm --cached it, then commit.";
          if (!ign(r, "config/settings.local.json")) return "Add config/settings.local.json to .gitignore so it can't be added again by accident.";
          var st = v.status();
          if (st.staged.length) return "Commit the staged changes.";
          return true;
        }
      },
      {
        id: "check", text: "Ask Git which <code>.gitignore</code> line is ignoring <code>.env</code>.",
        hints: ["git check-ignore with -v (verbose) shows the rule.", "git check-ignore -v .env"],
        check: function (r) { return ran(r, /git\s+check-ignore\b/, function (e) { return /\.gitignore:\d+:/.test(out(e)) && /\.env/.test(out(e)); }) ? true : "Run git check-ignore -v .env inside ~/kestrel-api."; }
      }
    ],
    solution: lines("cd ~/kestrel-api", "git status", "printf '.env\\n__pycache__/\\nvenv/\\n*.log\\nlogs/*\\n!logs/.gitkeep\\n' > .gitignore", "git status", "git check-ignore -v .env", "git add .gitignore logs/.gitkeep", 'git commit -m "Add .gitignore"', "git rm --cached config/settings.local.json", 'echo "config/settings.local.json" >> .gitignore', "git add .gitignore", 'git commit -m "Stop tracking local settings"', "git status"),
    debrief: "<p><code>git status</code> is readable again, and the obvious leaks can't happen by accident. Two lessons stick:</p><ul><li>Commit a <code>.gitignore</code> on day one of every project (GitHub's <i>gitignore</i> templates are a good start).</li><li>Removing a secret from the latest commit is not removing it. Everyone with a clone still has the token in history: <b>rotate it first</b>, then clean up (Module 4).</li></ul>",
    realworld: "Look at github.com/github/gitignore for ready-made Python, Node and editor templates. Run git status --ignored in one of your projects to see what you're already skipping.",
    quiz: [
      { q: "You add <code>secrets.json</code> to .gitignore, but it still shows as modified. Why?", options: ["The pattern is wrong", "It's already tracked: ignore rules only apply to untracked files", ".gitignore needs a commit first", "Git caches .gitignore for a day"], answer: 1, why: "Untrack it with git rm --cached, then the rule applies." },
      { q: "Which keeps <code>logs/.gitkeep</code> while ignoring the rest of logs/?", options: ["logs/ then !logs/.gitkeep", "logs/* then !logs/.gitkeep", "!logs/.gitkeep then logs/", "*.log"], answer: 1, why: "Git can't re-include a file whose folder is ignored, so ignore the contents (logs/*), not the folder." },
      { q: "A token was committed last week. What comes first?", options: ["git rm --cached the file", "Add it to .gitignore", "Rotate (revoke and replace) the token", "Delete the repository"], answer: 2, why: "Anyone with a copy of the history can read it. Revoke it first; clean up after." }
    ]
  });

  /* ================================================================== GT-105 */
  var OPS = HOME + "/ops-scripts";
  var DEPLOY_OK = "#!/bin/bash\n# Deploy a release to the web servers\nset -euo pipefail\nfor host in kc-web-01 kc-web-02; do\n  curl --fail https://$host/healthz\n  rsync -av build/ deploy@$host:/var/www/kestrel/\ndone\n";
  var DEPLOY_BAD = DEPLOY_OK.replace("curl --fail https://$host/healthz", "curl --fail --insecure https://$host/healthz");
  function opsRepo(sys) {
    G.build(sys, OPS, {
      steps: [
        { msg: "Initial commit", by: "maya", at: "2026-10-03 09:00", files: { "README.md": "# ops-scripts\n\nSmall scripts the SRE team runs by hand.\n" } },
        { msg: "Add deploy script", by: "maya", at: "2026-10-09 14:00", files: { "deploy.sh": DEPLOY_OK }, exec: ["deploy.sh"] },
        { msg: "Add disk check", by: "ben", at: "2026-10-21 10:30", files: { "check-disk.sh": "#!/bin/bash\ndf -h --output=pcent,target | awk 'NR>1 && $1+0 > 80'\n" }, exec: ["check-disk.sh"] },
        { msg: "Disable TLS check in deploy", by: "leo", at: "2026-11-04 18:20", files: { "deploy.sh": DEPLOY_BAD } },
        { msg: "Add bakup script", by: "dev", at: "2026-11-11 08:40", files: { "backup.sh": "#!/bin/bash\ntar -czf /srv/backups/www-$(date +%F).tar.gz /var/www/kestrel\n" }, exec: ["backup.sh"] }
      ],
      stage: { "secrets.txt": "db password: " + ["hunter", "2", "-prod"].join("") + "\n" },
      work: { "deploy.sh": DEPLOY_BAD.replace("set -euo pipefail\n", "set -euo pipefail\nset -x  # TODO remove: trying something\nDRY_RUN=1\n"), "backup-cron.txt": "# m h dom mon dow  command\n30 2 * * *  /home/dev/ops-scripts/backup.sh\n" }
    });
  }
  LABS.push({
    id: "gt-105", n: 5, module: 1, ticket: "GT-105", xp: 120,
    title: "Undo!",
    topic: "git restore, commit --amend, git reset, git revert",
    from: MAYA,
    story: "<p>It's been one of those mornings in <code>~/ops-scripts</code>. You staged a file of passwords by accident, made an experiment in <code>deploy.sh</code> you don't want, committed your backup script with a typo and without its cron file, and the team found that Leo's commit from last week turned off the TLS check in deploy. Everything before your last commit is already shared with the team.</p>",
    learn:
      "<h3>Pick the right undo</h3>" +
      '<table class="t"><tr><th>To undo…</th><th>Use</th></tr>' +
      "<tr><td>edits to a file you haven't staged</td><td><code>git restore FILE</code> (the edits are gone for good)</td></tr>" +
      "<tr><td>a <code>git add</code> (unstage, keep the edits)</td><td><code>git restore --staged FILE</code></td></tr>" +
      "<tr><td>the last commit's message, or a forgotten file</td><td><code>git add FILE</code> then <code>git commit --amend</code></td></tr>" +
      "<tr><td>your last N local commits</td><td><code>git reset</code> (see below)</td></tr>" +
      "<tr><td>a commit others already have</td><td><code>git revert COMMIT</code></td></tr></table>" +
      "<h3>--amend</h3>" + ex('git commit --amend -m "Better message"') +
      "<p>Replaces the last commit with a new one: the same changes plus whatever is staged now, with the new message (or the old one with <code>--no-edit</code>). It gets a new ID. Only amend commits nobody else has yet.</p>" +
      "<h3>reset moves your branch back</h3>" +
      '<table class="t"><tr><th>Command</th><th>Branch</th><th>Staging area</th><th>Your files</th></tr>' +
      "<tr><td><code>git reset --soft HEAD~1</code></td><td>moved back</td><td>keeps the changes, staged</td><td>untouched</td></tr>" +
      "<tr><td><code>git reset HEAD~1</code> (--mixed)</td><td>moved back</td><td>reset</td><td>keep the changes, unstaged</td></tr>" +
      "<tr><td><code>git reset --hard HEAD~1</code></td><td>moved back</td><td>reset</td><td><b>changes thrown away</b></td></tr></table>" +
      "<h3>revert undoes by adding a commit</h3>" + ex("git revert --no-edit HEAD~1") +
      "<p>Makes a new commit with the opposite changes. History isn't rewritten, so it's safe for shared work: everyone just gets one more commit. (<code>--no-edit</code> keeps Git's message, <i>Revert \"…\"</i>.)</p>" +
      '<div class="callout">Lost something? <code>git reflog</code> lists every commit HEAD has pointed at, even ones no branch shows any more. <code>git reset --hard HEAD@{2}</code> goes back to one.</div>',
    system: opsRepo,
    starter: "",
    objectives: [
      {
        id: "unstage", text: "Unstage <code>secrets.txt</code> (it must not be committed). Leave the file on disk for now.",
        hints: ["git status even tells you the command.", "git restore --staged secrets.txt"],
        check: function (r) {
          var v = need(r, "ops-scripts"); if (typeof v === "string") return v;
          if (v.log("HEAD").some(function (c) { return G.commitFlat(r.sys, c.sha)["secrets.txt"]; })) return "secrets.txt got committed! Reset machine and unstage it first.";
          if (v.index().entries["secrets.txt"]) return "secrets.txt is still staged.";
          return r.exists("~/ops-scripts/secrets.txt") ? true : "Unstage it, don't delete it (the next tasks don't need it, but it's yours to deal with).";
        }
      },
      {
        id: "discard", text: "Throw away your uncommitted experiment in <code>deploy.sh</code> (the <code>set -x</code> and <code>DRY_RUN</code> lines).",
        hints: ["git restore FILE replaces the file with the staged (= last committed) version.", "git restore deploy.sh"],
        check: function (r) {
          var t = r.read("~/ops-scripts/deploy.sh") || "";
          if (/DRY_RUN|set -x/.test(t)) return "deploy.sh still has the experiment. git restore deploy.sh discards it.";
          return true;
        }
      },
      {
        id: "amend", text: "Fix your last commit: its message should be <code>Add backup script</code> and it should also include <code>backup-cron.txt</code>. Don't add a new commit for it.",
        hints: ["Stage the forgotten file, then git commit --amend with the right message.", 'git add backup-cron.txt\ngit commit --amend -m "Add backup script"'],
        check: function (r) {
          var v = need(r, "ops-scripts"); if (typeof v === "string") return v;
          var log = v.log("HEAD");
          if (log.some(function (c) { return /bakup/.test(c.subject); })) return "The commit with the typo (\"Add bakup script\") is still in the history: amend it instead of adding a new commit.";
          var bk = log.filter(function (c) { return c.subject === "Add backup script"; });
          if (!bk.length) return "There's no commit called \"Add backup script\" yet.";
          var f = G.commitFlat(r.sys, bk[0].sha);
          if (!f["backup-cron.txt"]) return "\"Add backup script\" should include backup-cron.txt (stage it before amending).";
          if (!f["backup.sh"]) return "\"Add backup script\" lost backup.sh.";
          if (f["secrets.txt"]) return "secrets.txt slipped into the amended commit.";
          var parent = bk[0].parents[0] ? G.commitOf(r.sys, bk[0].parents[0]) : null;
          return parent && /Disable TLS check/.test(parent.message) ? true : "Amend the existing commit rather than stacking a new one on top.";
        }
      },
      {
        id: "revert", text: "Undo Leo's shared commit <i>Disable TLS check in deploy</i> without rewriting history.",
        hints: ["git revert makes a new commit with the opposite change. Find the commit with git log --oneline.", "git revert --no-edit HEAD~1"],
        check: function (r) {
          var v = need(r, "ops-scripts"); if (typeof v === "string") return v;
          var log = v.log("HEAD");
          if (!log.some(function (c) { return c.subject === "Disable TLS check in deploy"; })) return "Leo's commit is gone from the history: that rewrites shared history. Reset machine and use git revert.";
          if (!log.some(function (c) { return /^Revert "Disable TLS check in deploy"/.test(c.subject); })) return "No revert commit yet: git revert <that commit>.";
          return /--insecure/.test(v.file("HEAD", "deploy.sh") || "") ? "deploy.sh in the latest commit still has --insecure." : true;
        }
      }
    ],
    solution: lines("cd ~/ops-scripts", "git status", "git restore --staged secrets.txt", "git restore deploy.sh", "git add backup-cron.txt", 'git commit --amend -m "Add backup script"', "git log --oneline", "git revert --no-edit HEAD~1", "git log --oneline"),
    debrief: "<p>Four different mistakes, four different tools. The rule of thumb:</p><ul><li>Not committed yet? <code>git restore</code> (with <code>--staged</code> to unstage).</li><li>Committed but only you have it? <code>--amend</code> or <code>reset</code> rewrite it.</li><li>Already shared? <code>git revert</code>: never rewrite history other people have pulled.</li></ul><p>And <code>secrets.txt</code>? It never reached a commit, so nothing leaked. Delete it, or ignore it.</p>",
    realworld: "Practise in a scratch repository: make three commits, then try git reset --soft HEAD~2 and git reflog. Nothing's really lost until git gc runs (weeks later), so reflog is your safety net.",
    quiz: [
      { q: "Your last commit is already on the shared server. How do you undo it?", options: ["git reset --hard HEAD~1", "git commit --amend", "git revert HEAD", "Delete the branch"], answer: 2, why: "revert adds a new commit, so nobody's history is rewritten." },
      { q: "<code>git reset --soft HEAD~2</code> does what with the changes in those two commits?", options: ["Deletes them", "Keeps them staged", "Keeps them unstaged", "Moves them to a stash"], answer: 1, why: "--soft only moves the branch; everything stays staged, ready to commit again as one." },
      { q: "Which undo can lose work for good?", options: ["git restore --staged", "git revert", "git reset --hard", "git commit --amend"], answer: 2, why: "--hard overwrites your files (uncommitted changes can't be recovered; committed ones can, via reflog)." }
    ]
  });

  /* ================================================================== GT-106 */
  var BANNER_CSS = CSS2 + ".banner { background: #fffbe6; padding: .5rem 1rem; text-align: center; }\n";
  function branchRepo(sys) {
    var st = webSteps(0);
    var main = st.slice(0, 13);
    var steps = main.concat([
      { branch: "feature/banner", from: "main" },
      { msg: "Add launch banner", by: "ana", at: "2026-11-09 11:00", files: { "site/index.html": indexHtml({ copy: 1, favicon: 1, banner: 1 }) } },
      { msg: "Style the banner", by: "ana", at: "2026-11-09 15:40", files: { "site/style.css": BANNER_CSS } },
      { checkout: "main" },
      st[13]
    ]);
    G.build(sys, WEB, { steps: steps, head: "main" });
  }
  var FOOTER = "<footer>© 2026 Kestrel Cloud</footer>";
  function footerCommit(v) { return v.log("HEAD", true).filter(function (c) { var p = c.parents[0] ? G.commitFlat(v.sys, c.parents[0]) : {}, f = G.commitFlat(v.sys, c.sha); return c.parents.length === 1 && f["site/index.html"] && (G.blobText(v.sys, f["site/index.html"].sha).indexOf(FOOTER) >= 0) && (!p["site/index.html"] || G.blobText(v.sys, p["site/index.html"].sha).indexOf(FOOTER) < 0); })[0]; }
  LABS.push({
    id: "gt-106", n: 6, module: 1, ticket: "GT-106", xp: 120,
    title: "Branches",
    topic: "git branch, git switch, git merge",
    from: BEN,
    story: "<p>The website needs a footer, and Ana's launch banner (on her branch <code>feature/banner</code>) is ready to go live. Work on a branch of your own so <code>main</code> always stays deployable, then bring both changes into <code>main</code>.</p>",
    learn:
      "<h3>A branch is a movable label</h3><p>A branch is just a name pointing at a commit. When you commit on a branch, its label moves to the new commit. <code>HEAD</code> is the branch you're on. Creating a branch costs nothing, so make one for every piece of work.</p>" +
      ex("git branch") + "<p>lists branches (<code>*</code> marks the current one; <code>-v</code> adds each tip's commit).</p>" +
      ex("git switch -c feature/footer") +
      "<p>creates a branch and switches to it (<code>git switch NAME</code> switches to an existing one; older guides use <code>git checkout -b</code> and <code>git checkout</code>). Switching changes the files in your folder to match that branch.</p>" +
      "<h3>Merging</h3><p>Switch to the branch that should <b>receive</b> the work, then merge the other one into it:</p>" + ex("git switch main\ngit merge feature/footer") +
      '<table class="t"><tr><th>If…</th><th>Git does a…</th></tr><tr><td><code>main</code> hasn\'t moved since you branched</td><td><b>fast-forward</b>: main\'s label just moves up to your commits. No new commit.</td></tr><tr><td>both branches have new commits</td><td><b>merge commit</b>: a new commit with two parents that joins the two lines of history.</td></tr></table>' +
      "<p>See it as a picture:</p>" + ex("git log --oneline --graph --all") +
      "<h3>Tidy up</h3>" + ex("git branch -d feature/footer") +
      "<p><code>-d</code> refuses to delete a branch whose work isn't merged (<code>-D</code> forces it).</p>",
    system: branchRepo,
    starter: "",
    objectives: [
      {
        id: "create", text: "In <code>~/kestrel-web</code>, create a branch called <code>feature/footer</code> and switch to it.",
        hints: ["One command creates and switches.", "cd ~/kestrel-web\ngit switch -c feature/footer"],
        check: function (r) {
          var v = need(r, "kestrel-web"); if (typeof v === "string") return v;
          return v.reflog("HEAD").some(function (e) { return /moving from main to feature\/footer$/.test(e.msg); }) ? true : "Create feature/footer and switch to it (git switch -c feature/footer).";
        }
      },
      {
        id: "commit", text: "On that branch, add <code>" + esc(FOOTER) + "</code> to <code>site/index.html</code> (just before <code>&lt;/body&gt;</code>) and commit it.",
        hints: ["Edit with nano site/index.html, or insert the line with sed's i command, then commit.", "sed -i 's|</body>|  " + FOOTER + "\\n</body>|' site/index.html\ngit commit -am \"Add footer\""],
        check: function (r) {
          var v = need(r, "kestrel-web"); if (typeof v === "string") return v;
          var fc = footerCommit(v);
          if (!fc) return "No commit adds the footer to site/index.html yet.";
          var rl = v.reflog("HEAD"), made = rl.filter(function (e) { return e.sha === fc.sha && /^commit/.test(e.msg); })[0];
          if (!made) return "Commit the footer change.";
          // the last branch switch before that commit tells which branch it was made on
          var onFooter = rl.slice(rl.indexOf(made) + 1).filter(function (e) { return /^checkout: moving from/.test(e.msg); })[0];
          return onFooter && /to feature\/footer$/.test(onFooter.msg) ? true : "Make the footer commit on feature/footer, not on main.";
        }
      },
      {
        id: "ff", text: "Switch back to <code>main</code> and merge <code>feature/footer</code> into it. It should be a <b>fast-forward</b>.",
        hints: ["git switch main, then git merge feature/footer. Git prints \"Fast-forward\".", "git switch main\ngit merge feature/footer"],
        check: function (r) {
          var v = need(r, "kestrel-web"); if (typeof v === "string") return v;
          var fc = footerCommit(v);
          if (!fc || !v.isAncestor(fc.sha, "main")) return "main doesn't have the footer commit yet: switch to main and merge feature/footer.";
          return v.reflog("refs/heads/main").some(function (e) { return /^merge feature\/footer: Fast-forward/.test(e.msg); }) ? true : "Merge feature/footer into main as a fast-forward (no new commit on main before merging).";
        }
      },
      {
        id: "delete", text: "Delete the <code>feature/footer</code> branch now that it's merged.",
        hints: ["git branch with -d.", "git branch -d feature/footer"],
        check: function (r) {
          var v = need(r, "kestrel-web"); if (typeof v === "string") return v;
          if (v.branches().indexOf("feature/footer") >= 0) return "feature/footer still exists: git branch -d feature/footer.";
          var fc = footerCommit(v);
          return fc && v.isAncestor(fc.sha, "main") ? true : "Merge it into main before deleting it.";
        }
      },
      {
        id: "banner", text: "Merge Ana's <code>feature/banner</code> into <code>main</code>. Both have moved on, so Git makes a merge commit.",
        hints: ["On main: git merge feature/banner (the default message is fine).", "git merge feature/banner"],
        check: function (r) {
          var v = need(r, "kestrel-web"); if (typeof v === "string") return v;
          var tip = v.sha("feature/banner");
          if (!tip) return "Don't delete Ana's feature/banner branch (Reset machine to get it back).";
          if (!v.isAncestor(tip, "main")) return "main doesn't contain feature/banner yet.";
          var mc = v.log("main", true).filter(function (c) { return c.parents.length === 2 && c.parents[1] === tip; })[0];
          if (!mc) return "Merge feature/banner into main with a merge commit (switch to main first).";
          var html = v.file("main", "site/index.html") || "";
          return html.indexOf("banner") >= 0 && html.indexOf(FOOTER) >= 0 ? true : "main's site/index.html should have both the banner and your footer.";
        }
      },
      {
        id: "graph", text: "Look at the result as a graph of all branches.",
        hints: ["git log with --oneline --graph --all.", "git log --oneline --graph --all"],
        check: function (r) { return ran(r, /git\s+log\b.*--graph/, function (e) { return /Merge branch 'feature\/banner'/.test(out(e)) && /\|\\/.test(out(e)); }) ? true : "After the merge, run git log --oneline --graph --all."; }
      }
    ],
    solution: lines("cd ~/kestrel-web", "git branch -v", "git switch -c feature/footer", "sed -i 's|</body>|  " + FOOTER + "\\n</body>|' site/index.html", "git diff", 'git commit -am "Add footer"', "git switch main", "git merge feature/footer", "git branch -d feature/footer", "git merge feature/banner", "git log --oneline --graph --all"),
    debrief: "<p>Your footer went in as a fast-forward: <code>main</code> hadn't moved, so its label simply slid up to your commit. Ana's banner needed a merge commit because <code>main</code> had new work she didn't have. The graph shows both: one straight line, then a fork that joins back.</p><p>Short-lived branches merged often are the heart of every team workflow you'll meet (GitHub flow, trunk-based development). Next ticket: what happens when two branches change the <b>same</b> lines.</p>",
    realworld: "In your own repo: git switch -c try-something, commit, git switch main, git merge try-something. Then make main and the branch both change different files and merge again to get a merge commit.",
    quiz: [
      { q: "What is a branch, really?", options: ["A copy of all the files", "A name pointing at a commit, which moves as you commit", "A separate repository", "A folder in .git with the changes"], answer: 1, why: "That's why branches are cheap: a branch is a 41-byte file in .git/refs/heads/." },
      { q: "When is a merge a fast-forward?", options: ["When there are no conflicts", "When the receiving branch has no commits the other lacks", "When you use --ff", "Always, unless you use --no-ff"], answer: 1, why: "If main is an ancestor of the branch, Git just moves main's label forward." },
      { q: "You're on <code>main</code> and run <code>git merge feature/x</code>. Which branch changes?", options: ["feature/x", "main", "Both", "Neither: it makes a new branch"], answer: 1, why: "Merge brings the other branch's work into the current one." }
    ]
  });

  /* ================================================================== GT-107 */
  var APP_YAML = "server:\n  port: 8080\n  workers: 4\n  timeout: 30\nlogging:\n  level: info\n";
  var CHANGELOG0 = "# Changelog\n\n## Unreleased\n\n## 1.3.0\n- Initial public API\n";
  var APP_YAML_WANT = "server:\n  port: 8080\n  workers: 4\n  timeout: 45\n  rate_limit: 100\nlogging:\n  level: info\n";
  var CH_MAIN = "- Raise server timeout to 45s", CH_FEAT = "- Add rate limiting (100 requests/minute)";
  function conflictRepo(sys) {
    G.build(sys, API, {
      steps: [
        { msg: "Initial API", by: "ben", at: "2026-10-20 10:00", files: { "README.md": "# kestrel-api\n", "config/app.yaml": APP_YAML, "CHANGELOG.md": CHANGELOG0, "app/main.py": "from fastapi import FastAPI\n\napp = FastAPI()\n" } },
        { branch: "feature/rate-limit", from: "main" },
        { msg: "Add rate limiting", by: "ben", at: "2026-11-06 14:00", files: { "config/app.yaml": APP_YAML.replace("  timeout: 30\n", "  timeout: 60\n  rate_limit: 100\n"), "CHANGELOG.md": CHANGELOG0.replace("## Unreleased\n", "## Unreleased\n" + CH_FEAT + "\n"), "app/ratelimit.py": "LIMIT = 100  # requests per minute\n" } },
        { checkout: "main" },
        { branch: "hotfix/timeout", from: "main" },
        { msg: "Timeout 90s for the reports endpoint", by: "leo", at: "2026-11-09 09:30", files: { "config/app.yaml": APP_YAML.replace("timeout: 30", "timeout: 90") } },
        { checkout: "main" },
        { msg: "Raise timeout to 45s for slow reports", by: "maya", at: "2026-11-08 16:10", files: { "config/app.yaml": APP_YAML.replace("timeout: 30", "timeout: 45"), "CHANGELOG.md": CHANGELOG0.replace("## Unreleased\n", "## Unreleased\n" + CH_MAIN + "\n") } }
      ],
      head: "main"
    });
  }
  function mergeCommitOf(v, branch) { var tip = v.sha(branch); return tip ? v.log("main", true).filter(function (c) { return c.parents.length === 2 && c.parents[1] === tip; })[0] : null; }
  LABS.push({
    id: "gt-107", n: 7, module: 1, ticket: "GT-107", xp: 140,
    title: "Merge conflicts",
    topic: "conflict markers, resolving, git merge --abort",
    from: BEN,
    story: "<p>My <code>feature/rate-limit</code> branch is ready, but while I worked Maya changed the same timeout line on <code>main</code>, and we both added a line to the changelog. Git can't guess which version is right, so this merge needs a human.</p><p>We agreed: <b>keep Maya's timeout (45) and my <code>rate_limit</code> line</b>, and keep <b>both</b> changelog entries.</p>",
    learn:
      "<h3>Why conflicts happen</h3><p>Git merges line by line. If only one side changed a part of a file, it takes that change. If <b>both</b> sides changed the same lines (or lines right next to each other), it stops and asks you:</p>" +
      code("Auto-merging config/app.yaml\nCONFLICT (content): Merge conflict in config/app.yaml\nAutomatic merge failed; fix conflicts and then commit the result.") +
      "<p>The merge is now <b>in progress</b>. <code>git status</code> lists the files under <i>Unmerged paths</i>. Each conflicted file has markers where the versions differ:</p>" +
      code("<<<<<<< HEAD\n  timeout: 45            (your side: the branch you're on)\n=======\n  timeout: 60            (their side: the branch you're merging)\n  rate_limit: 100\n>>>>>>> feature/rate-limit") +
      "<h3>Resolve, mark, commit</h3><ol><li>Edit each file into the version you want and <b>delete all three marker lines</b>. Open it with <code>nano config/app.yaml</code>.</li><li><code>git add FILE</code> marks it resolved.</li><li>When <code>git status</code> says <i>All conflicts fixed</i>, <code>git commit</code> finishes the merge (the message is prepared for you; <code>--no-edit</code> keeps it).</li></ol>" +
      "<p>When you simply want one whole side of a file: <code>git checkout --ours FILE</code> or <code>--theirs FILE</code>, then <code>git add</code>. To keep <b>both</b> sides as they are, deleting just the marker lines is enough:</p>" + ex("sed -i '/^<<<<<<<\\|^=======\\|^>>>>>>>/d' CHANGELOG.md") +
      "<h3>Get out</h3>" + ex("git merge --abort") + "<p>puts everything back as it was before the merge started.</p>" +
      '<div class="callout">Before committing, check nothing is left behind: <code>git diff --staged</code> and <code>grep -n "<<<<<<<" -r .</code>. Committing a file with markers in it is a classic way to break the build.</div>',
    system: conflictRepo,
    starter: "",
    objectives: [
      {
        id: "start", text: "In <code>~/kestrel-api</code>, merge <code>feature/rate-limit</code> into <code>main</code>, then check which files conflict.",
        hints: ["git merge feature/rate-limit, then git status.", "cd ~/kestrel-api\ngit merge feature/rate-limit\ngit status"],
        check: function (r) {
          if (!ran(r, /git\s+merge\s+feature\/rate-limit/, function (e) { return /CONFLICT/.test(out(e)); })) return "Start the merge: git merge feature/rate-limit (on main).";
          return ran(r, /^\s*git\s+status/, function (e) { return /Unmerged paths:|^UU /m.test(out(e)); }) ? true : "Run git status while the merge is in progress to see the unmerged files.";
        }
      },
      {
        id: "yaml", text: "Resolve <code>config/app.yaml</code>: Maya's <code>timeout: 45</code> plus Ben's <code>rate_limit: 100</code>, no markers left.",
        hints: ["nano config/app.yaml, keep timeout: 45 and the rate_limit line, delete the three marker lines.", "The server block should read: port: 8080, workers: 4, timeout: 45, rate_limit: 100."],
        check: function (r) {
          var v = need(r, "kestrel-api"); if (typeof v === "string") return v;
          var mc = mergeCommitOf(v, "feature/rate-limit");
          var t = mc ? v.file(mc.sha, "config/app.yaml") : r.read("~/kestrel-api/config/app.yaml");
          if (!noMarkers(t)) return "config/app.yaml still has conflict markers (<<<<<<<, =======, >>>>>>>).";
          if (!/timeout: 45/.test(t) || /timeout: 60/.test(t)) return "Keep Maya's timeout: 45 (and drop 60).";
          if (!/rate_limit: 100/.test(t)) return "Keep Ben's rate_limit: 100 line.";
          return sameLines(t, APP_YAML_WANT) ? true : "Something else changed in config/app.yaml. It should be:\nserver:\n  port: 8080\n  workers: 4\n  timeout: 45\n  rate_limit: 100\nlogging:\n  level: info";
        }
      },
      {
        id: "changelog", text: "Resolve <code>CHANGELOG.md</code> keeping <b>both</b> new entries.",
        hints: ["Both entries stay, so only the marker lines need to go.", "sed -i '/^<<<<<<<\\|^=======\\|^>>>>>>>/d' CHANGELOG.md"],
        check: function (r) {
          var v = need(r, "kestrel-api"); if (typeof v === "string") return v;
          var mc = mergeCommitOf(v, "feature/rate-limit");
          var t = mc ? v.file(mc.sha, "CHANGELOG.md") : r.read("~/kestrel-api/CHANGELOG.md");
          if (!noMarkers(t)) return "CHANGELOG.md still has conflict markers.";
          return t.indexOf(CH_MAIN) >= 0 && t.indexOf(CH_FEAT) >= 0 && t.indexOf("- Initial public API") >= 0 ? true : "Keep both entries (\"" + CH_MAIN.slice(2) + "\" and \"" + CH_FEAT.slice(2) + "\") and the rest of the file.";
        }
      },
      {
        id: "commit", text: "Mark both files resolved and finish the merge with a commit.",
        hints: ["git add both files, check git status, then git commit (--no-edit keeps the prepared message).", "git add config/app.yaml CHANGELOG.md\ngit commit --no-edit"],
        check: function (r) {
          var v = need(r, "kestrel-api"); if (typeof v === "string") return v;
          var mc = mergeCommitOf(v, "feature/rate-limit");
          if (!mc) return v.merging() ? "Mark the files resolved with git add, then git commit." : "Merge feature/rate-limit into main and commit the result.";
          if (!v.file(mc.sha, "app/ratelimit.py")) return "The merge commit lost app/ratelimit.py from Ben's branch.";
          return true;
        }
      },
      {
        id: "abort", text: "Leo's <code>hotfix/timeout</code> changes the timeout yet again. Start merging it, see the conflict, and back out with <code>git merge --abort</code>.",
        hints: ["After the first merge is committed: git merge hotfix/timeout, then git merge --abort.", "git merge hotfix/timeout\ngit merge --abort"],
        check: function (r) {
          var v = need(r, "kestrel-api"); if (typeof v === "string") return v;
          if (!ran(r, /git\s+merge\s+hotfix\/timeout/, function (e) { return /CONFLICT/.test(out(e)); })) return "Start the hotfix/timeout merge (after finishing the first one).";
          if (!ran(r, /git\s+merge\s+--abort/, function (e) { return e.exit === 0; })) return "Back out with git merge --abort.";
          if (v.merging()) return "A merge is still in progress.";
          if (v.isAncestor("hotfix/timeout", "main")) return "hotfix/timeout ended up merged into main. Leave it out for today (Reset machine to redo).";
          return v.clean() ? true : "After aborting, the working tree should be clean.";
        }
      }
    ],
    solution: lines("cd ~/kestrel-api", "git merge feature/rate-limit", "git status", "git diff", "printf 'server:\\n  port: 8080\\n  workers: 4\\n  timeout: 45\\n  rate_limit: 100\\nlogging:\\n  level: info\\n' > config/app.yaml", "sed -i '/^<<<<<<<\\|^=======\\|^>>>>>>>/d' CHANGELOG.md", "cat CHANGELOG.md", "git add config/app.yaml CHANGELOG.md", "git status", "git commit --no-edit", "git log --oneline --graph", "git merge hotfix/timeout", "git merge --abort", "git status"),
    debrief: "<p>A conflict isn't an error: it's Git asking a question only a person can answer. You answered it (45 seconds, plus rate limiting), checked nothing was left behind, and committed. You also learned the emergency exit: <code>git merge --abort</code>.</p><p>Small, frequent merges keep conflicts small. A branch that lives for weeks collects conflicts like dust.</p>",
    realworld: "VS Code shows conflicts with \"Accept Current / Incoming / Both\" buttons above each block: it's editing the same markers you edited here. Set git config --global merge.conflictStyle diff3 to also see the original version between the markers.",
    quiz: [
      { q: "In a conflict block, the part between <code>&lt;&lt;&lt;&lt;&lt;&lt;&lt; HEAD</code> and <code>=======</code> is…", options: ["the other branch's version", "your current branch's version", "the original version", "Git's suggestion"], answer: 1, why: "HEAD = the branch you're on. After ======= comes the branch being merged in." },
      { q: "You've edited a conflicted file. How do you tell Git it's resolved?", options: ["git resolve FILE", "git add FILE", "git commit FILE", "git merge --continue FILE"], answer: 1, why: "Staging the file marks it resolved; git commit (or git merge --continue) then finishes." },
      { q: "Halfway through a messy merge you want to start over. Use…", options: ["git reset --soft", "git merge --abort", "git stash", "git revert"], answer: 1, why: "--abort restores the state from before the merge." }
    ]
  });

  /* ================================================================== GT-108 */
  var SEARCH_JS = "document.getElementById('search').addEventListener('input', function (e) {\n  console.log('searching for', e.target.value);\n});\n";
  function stashRepo(sys) {
    var st = webSteps(0);
    var steps = st.slice(0, 9).concat([
      { tag: "v1.2.0", msg: "Kestrel web 1.2.0", by: "maya", at: "2026-10-26 18:00" }
    ]).concat(st.slice(9)).concat([
      { msg: "Release 1.3.0", by: "maya", at: "2026-11-10 14:00", files: { "VERSION": "1.3.0\n" } },
      { msg: "Update README", by: "ben", at: "2026-11-10 16:20", files: { "README.md": "# kestrel-web\n\nThe Kestrel Cloud website and status page.\n\nDeploy with ./deploy.sh (needs SSH access to kc-web-01).\n" } },
      { branch: "feature/search", from: "main" },
      { msg: "Search: add input box", by: "dev", at: "2026-11-11 08:30", files: { "site/index.html": indexHtml({ copy: 1, favicon: 1, search: 1 }) } }
    ]);
    G.build(sys, WEB, { steps: steps, head: "feature/search", work: { "site/index.html": indexHtml({ copy: 1, favicon: 1, search: 1, searchJs: 1 }), "site/search.js": SEARCH_JS } });
  }
  LABS.push({
    id: "gt-108", n: 8, module: 1, ticket: "GT-108", xp: 120,
    title: "Stash and tag",
    topic: "git stash, git tag, git describe",
    from: MAYA,
    story: "<p>You're halfway through the search feature on <code>feature/search</code> when a customer reports the status page says <b>Kestral</b>. Fix it on <code>main</code> right now without committing your half-done work, tag the release properly, then pick up where you left off.</p>",
    learn:
      "<h3>git stash: put work aside</h3><p>Switching branches with uncommitted changes either carries them along or is refused. When you're not ready to commit, stash them:</p>" + ex("git stash -u") +
      "<p>saves your changes (staged and unstaged; <code>-u</code> also takes untracked files) on a stack and gives you a clean working tree. Later, on the same branch:</p>" + ex("git stash pop") +
      '<table class="t"><tr><th>Command</th><th>Does</th></tr><tr><td><code>git stash push -m "note"</code></td><td>stash with a description</td></tr><tr><td><code>git stash list</code></td><td>list stashes: <code>stash@{0}</code> is the newest</td></tr><tr><td><code>git stash show -p stash@{1}</code></td><td>what a stash contains</td></tr><tr><td><code>git stash apply</code></td><td>restore but keep the stash</td></tr><tr><td><code>git stash pop</code></td><td>restore and drop it</td></tr><tr><td><code>git stash drop</code></td><td>throw one away</td></tr></table>' +
      "<h3>Tags: names for releases</h3><p>A tag is a label that never moves, normally used for versions. Two kinds:</p>" +
      ex('git tag -a v1.3.0 -m "Kestrel web 1.3.0" COMMIT') +
      "<p>An <b>annotated</b> tag (<code>-a</code>) is a real object with a tagger, a date and a message: use it for releases. A <b>lightweight</b> tag (<code>git tag NAME</code>) is just a name. Leave out COMMIT to tag where you are.</p>" +
      ex("git tag") + ex("git show v1.2.0") +
      "<p><code>git describe</code> names a commit after the nearest annotated tag: <code>v1.2.0-5-g3f9c2ab</code> means 5 commits after v1.2.0, at commit 3f9c2ab. Build systems use it as a version number.</p>",
    system: stashRepo,
    starter: "",
    objectives: [
      {
        id: "stash", text: "In <code>~/kestrel-web</code>, stash your unfinished work, <b>including</b> the new <code>site/search.js</code>, so the working tree is clean.",
        hints: ["git stash on its own leaves untracked files behind. Add -u.", "cd ~/kestrel-web\ngit stash -u"],
        check: function (r) { return ran(r, /^\s*git\s+stash\b/, function (e) { return /Saved working directory/.test(out(e)) && /(-u|--include-untracked|-a\b|--all)/.test(e.cmd); }) ? true : "Stash your changes with -u so search.js goes too."; }
      },
      {
        id: "fix", text: "Switch to <code>main</code>, fix <code>Kestral</code> → <code>Kestrel</code> in <code>site/status.html</code>, and commit.",
        hints: ["git switch main, then sed -i 's/Kestral/Kestrel/' site/status.html, then commit.", 'git switch main\nsed -i \'s/Kestral/Kestrel/\' site/status.html\ngit commit -am "Fix typo on status page"'],
        check: function (r) {
          var v = need(r, "kestrel-web"); if (typeof v === "string") return v;
          var t = v.file("main", "site/status.html") || "";
          if (/Kestral/.test(t)) return "main's site/status.html still says Kestral.";
          if (v.files("main")["site/search.js"]) return "search.js ended up on main. It belongs to feature/search (Reset machine and stash it first).";
          return true;
        }
      },
      {
        id: "v130", text: "Tag the <i>Release 1.3.0</i> commit as <code>v1.3.0</code>: an <b>annotated</b> tag with the message <code>Kestrel web 1.3.0</code>.",
        hints: ["Find the commit with git log --oneline. git tag -a NAME -m MESSAGE COMMIT.", 'git log --oneline -4\ngit tag -a v1.3.0 -m "Kestrel web 1.3.0" HEAD~2'],
        check: function (r) {
          var v = need(r, "kestrel-web"); if (typeof v === "string") return v;
          var t = v.tag("v1.3.0");
          if (!t) return "There's no tag v1.3.0 yet.";
          if (!t.annotated) return "v1.3.0 is a lightweight tag. Delete it (git tag -d v1.3.0) and create it with -a and -m.";
          var co = G.commitOf(r.sys, t.target);
          if (!co || co.message.split("\n")[0] !== "Release 1.3.0") return "v1.3.0 points at \"" + (co ? co.message.split("\n")[0] : "?") + "\", not at the Release 1.3.0 commit. Delete it and tag the right commit.";
          return /Kestrel web 1\.3\.0/.test(t.message) ? true : "Give the tag the message: Kestrel web 1.3.0";
        }
      },
      {
        id: "v131", text: "Tag your typo fix as <code>v1.3.1</code> (annotated, any message) and check <code>git describe</code>.",
        hints: ["On main, git tag -a v1.3.1 -m \"...\" tags the current commit.", 'git tag -a v1.3.1 -m "Kestrel web 1.3.1"\ngit describe'],
        check: function (r) {
          var v = need(r, "kestrel-web"); if (typeof v === "string") return v;
          var t = v.tag("v1.3.1");
          if (!t) return "There's no tag v1.3.1 yet.";
          if (!t.annotated) return "Make v1.3.1 annotated (-a -m).";
          var co = G.commitOf(r.sys, t.target), par = co && co.parents[0] ? G.commitFlat(r.sys, co.parents[0]) : {};
          var fixed = co && !/Kestral/.test(G.blobText(r.sys, G.commitFlat(r.sys, t.target)["site/status.html"].sha)) && par["site/status.html"] && /Kestral/.test(G.blobText(r.sys, par["site/status.html"].sha));
          if (!fixed) return "v1.3.1 should point at your typo-fix commit.";
          return ran(r, /git\s+describe/, function (e) { return /^v1\.3\.1/.test(out(e)); }) ? true : "Run git describe on main: it should print v1.3.1.";
        }
      },
      {
        id: "back", text: "Go back to <code>feature/search</code> and bring your stashed work back.",
        hints: ["git switch feature/search, then git stash pop.", "git switch feature/search\ngit stash pop"],
        check: function (r) {
          var v = need(r, "kestrel-web"); if (typeof v === "string") return v;
          if (!ran(r, /git\s+stash\s+(pop|apply)/, function (e) { return e.exit === 0; })) return "Switch back to feature/search and bring the work back with git stash pop.";
          if (v.branch() !== "feature/search") return "Switch back to feature/search.";
          if (!r.exists("~/kestrel-web/site/search.js")) return "site/search.js isn't back yet: git stash pop.";
          return /search\.js/.test(r.read("~/kestrel-web/site/index.html") || "") ? true : "Your index.html changes (the search.js script tag) aren't back yet.";
        }
      }
    ],
    solution: lines("cd ~/kestrel-web", "git status", "git stash -u", "git status", "git switch main", "sed -i 's/Kestral/Kestrel/' site/status.html", 'git commit -am "Fix typo on status page"', "git log --oneline -4", 'git tag -a v1.3.0 -m "Kestrel web 1.3.0" HEAD~2', 'git tag -a v1.3.1 -m "Kestrel web 1.3.1"', "git tag", "git describe", "git switch feature/search", "git stash pop"),
    debrief: "<p>Fix shipped and tagged, and your search work is exactly where you left it. Stash is for short interruptions; if a stash would live for days, commit to a branch instead (stashes are easy to forget).</p><p>Annotated tags are how releases are marked in almost every project: CI systems build a release whenever a <code>v*</code> tag appears (Module 3), and GitHub turns tags into downloadable Releases.</p>",
    realworld: "Run git tag in a big open-source project you've cloned (git, nginx, Python): every release is a tag. git describe --tags in your own repo after tagging v0.1.0.",
    quiz: [
      { q: "You run <code>git stash</code> but your new file <code>notes.txt</code> is still there. Why?", options: ["Stash only saves staged changes", "Untracked files aren't stashed without -u", "notes.txt is ignored", "Stash failed"], answer: 1, why: "git stash -u (--include-untracked) takes new files too." },
      { q: "Which tag should mark a release?", options: ["git tag v2.0", "git tag -a v2.0 -m \"Release 2.0\"", "git branch v2.0", "git stash -m v2.0"], answer: 1, why: "Annotated tags record who tagged, when and why, and can be signed." },
      { q: "<code>v1.3.1-2-g9ab3c1d</code> from git describe means…", options: ["Version 1.3.1.2", "2 commits after tag v1.3.1, at commit 9ab3c1d", "Tag v1.3.1 on branch g9ab3c1d", "2 tags since v1.3.1"], answer: 1, why: "TAG-COUNT-gID: commits since the tag, and the current commit's ID." }
    ]
  });

  /* ================================================================== GT-109 */
  // A history with three planted facts: who changed MAX_LOGIN_ATTEMPTS, when DEBUG = True arrived, and which
  // commit broke the upload limit (found with bisect). v=1 moves all three (to check answers come from commands).
  function authPy(n) { return "\"\"\"Login and sessions.\"\"\"\n\nMAX_LOGIN_ATTEMPTS = " + n + "\nLOCKOUT_MINUTES = 15\n\n\ndef too_many(attempts):\n    return attempts >= MAX_LOGIN_ATTEMPTS\n"; }
  function uploadPy(mb, extra) { return "\"\"\"File uploads.\"\"\"\n\nMAX_UPLOAD_MB = " + mb + "\nALLOWED = [\".png\", \".jpg\", \".pdf\"]\n" + (extra || ""); }
  function settingsPy(debug, extra) { return "\"\"\"Settings.\"\"\"\n\nDEBUG = " + (debug ? "True" : "False") + "\nLOG_LEVEL = \"info\"\n" + (extra || ""); }
  var CHECK_UPLOAD = "#!/bin/bash\n# Fails if uploads above 25 MB would be accepted.\nmb=$(grep -o 'MAX_UPLOAD_MB = [0-9]*' app/upload.py | grep -o '[0-9]*$')\nif [ \"$mb\" -gt 25 ]; then\n  echo \"FAIL: MAX_UPLOAD_MB is $mb (limit 25)\"\n  exit 1\nfi\necho \"ok: MAX_UPLOAD_MB is $mb\"\n";
  function detectiveSteps(v) {
    var people = ["ben", "ana", "leo", "maya", "kim"];
    var badAt = v ? 9 : 12, debugAt = v ? 7 : 4, attemptsAt = v ? 14 : 5;
    var attemptsBy = v ? "kim" : "leo";
    var msgs = ["Initial API", "Add upload endpoint", "Add auth module", "Add upload check script", "Settings: log level", "Refactor auth helpers", "Uploads: allow PDF", "Settings: cache TTL", "Auth: session cleanup", "Upload: clearer errors", "Docs: API overview", "Auth: lockout message", "Upload: stream large files", "Docs: upload limits", "Settings: rate limits", "Upload: resize thumbnails", "Auth: audit log", "Release prep"];
    var st = { mb: 10, up: "", attempts: 5, auth: "", debug: false, set: "", readme: "# kestrel-api\n" };
    var steps = [];
    for (var i = 0; i < msgs.length; i++) {
      var m = msgs[i], files = {};
      if (i === 0) { files["README.md"] = st.readme; files["app/settings.py"] = settingsPy(false); }
      else if (i === 1) files["app/upload.py"] = uploadPy(st.mb);
      else if (i === 2) files["app/auth.py"] = authPy(st.attempts);
      else if (i === 3) files["tests/check_upload.sh"] = CHECK_UPLOAD;
      else {
        if (i === badAt) st.mb = 1000;
        if (i === attemptsAt) st.attempts = 50;
        if (i === debugAt) st.debug = true;
        if (/[Aa]uth/.test(m) || i === attemptsAt) { st.auth += "# " + m.toLowerCase() + "\n"; files["app/auth.py"] = authPy(st.attempts) + st.auth; }
        if (/[Uu]pload/.test(m) || i === badAt) { st.up += "# " + m.toLowerCase() + "\n"; files["app/upload.py"] = uploadPy(st.mb, st.up); }
        if (/Settings/.test(m) || i === debugAt) { st.set += "# " + m.toLowerCase() + "\n"; files["app/settings.py"] = settingsPy(st.debug, st.set); }
        if (/Docs|Release/.test(m)) { st.readme += "\n" + m + "\n"; files["README.md"] = st.readme; }
      }
      steps.push({ msg: m, by: i === attemptsAt ? attemptsBy : people[i % people.length], at: "2026-10-" + String(10 + i).padStart(2, "0") + " " + String(9 + (i % 7)).padStart(2, "0") + ":15", files: files, exec: i === 3 ? ["tests/check_upload.sh"] : undefined });
      if (i === 5) steps.push({ tag: "v1.0", msg: "Kestrel API 1.0", by: "maya" });
    }
    return steps;
  }
  function detectiveSys(v) { return function (sys) { G.build(sys, API, { steps: detectiveSteps(v) }); }; }
  function firstWith(v, path, re) { var log = v.log("main").slice().reverse(); for (var i = 0; i < log.length; i++) { var f = G.commitFlat(v.sys, log[i].sha)[path]; if (f && re.test(G.blobText(v.sys, f.sha))) return log[i]; } return null; }
  function badUpload(v) { var log = v.log("main").slice().reverse(); for (var i = 0; i < log.length; i++) { var f = G.commitFlat(v.sys, log[i].sha)["app/upload.py"]; if (f && /MAX_UPLOAD_MB = 1000/.test(G.blobText(v.sys, f.sha))) return log[i]; } return null; }
  LABS.push({
    id: "gt-109", n: 9, module: 1, ticket: "GT-109", xp: 140,
    title: "Detective work",
    topic: "git blame, git log -S, git bisect",
    from: DEV,
    story: "<p>A security review of <code>~/kestrel-api</code> found three things. Login lockout kicks in after <b>50</b> attempts instead of 5. <code>DEBUG = True</code> is set in production settings. And uploads of any size are accepted again, even though <code>tests/check_upload.sh</code> passed at release <code>v1.0</code>. For each one, find the commit that did it.</p>",
    learn:
      "<h3>git blame: who last touched each line</h3>" + ex("git blame app/auth.py") +
      "<p>Each line shows the commit that last changed it, the author, the date and the line number. Limit it to some lines with <code>-L 3,5</code>. A commit ID starting with <code>^</code> is the very first commit. Then <code>git show ID</code> shows the whole change and its message.</p>" +
      '<div class="callout">Blame finds the <i>last</i> change to a line. If someone only re-indented it, blame points at them; look further back with <code>git blame ID^ -- FILE</code>.</div>' +
      "<h3>git log -S: when did this text appear?</h3>" + ex('git log -S "DEBUG = True" --oneline') +
      "<p>The \"pickaxe\" lists commits that changed how many times the text appears: the commit that added it, and any that removed it. Add <code>-p</code> to see the diffs, or <code>-- PATH</code> to search one file. <code>-G REGEX</code> does the same with a regular expression.</p>" +
      "<h3>git bisect: binary search for a bug</h3><p>You know a good commit (the test passed) and a bad one (it fails now). Bisect checks out the commit halfway between; you test it and say <code>good</code> or <code>bad</code>; it halves the range again. 1,000 commits take about 10 steps.</p>" +
      ex("git bisect start\ngit bisect bad\ngit bisect good v1.0") +
      "<p>Test, then type <code>git bisect good</code> or <code>git bisect bad</code>, until Git prints <i>X is the first bad commit</i>. If a script can tell good from bad (exit code 0 = good, 1 = bad), let Git do all the steps:</p>" + ex("git bisect run ./tests/check_upload.sh") +
      "<p>Always finish with <code>git bisect reset</code>, which takes you back to your branch. While bisecting you're in \"detached HEAD\" state: on a commit, not a branch.</p>",
    system: detectiveSys(0),
    starter: "",
    objectives: [
      {
        id: "blame", text: "Use <code>git blame</code> to find who last changed the <code>MAX_LOGIN_ATTEMPTS</code> line in <code>app/auth.py</code>, and in which commit.",
        hints: ["git blame FILE; -L 3,3 shows just line 3.", "cd ~/kestrel-api\ngit blame -L 3,3 app/auth.py"],
        check: function (r) {
          var want = function (x) { var v = repo(x, "kestrel-api"), c = firstWith(v, "app/auth.py", /MAX_LOGIN_ATTEMPTS = 50/); return c ? c.sha.slice(0, 8) + " (" + c.author.name : "???"; };
          var res = GL.H.showsAnswer(r, want, { system: detectiveSys(1) }, function (e) { return /git\s+blame/.test(e.cmd); });
          return res === true ? true : res === "alt" ? "Use git blame itself (not a commit ID you typed in) so the answer comes from the command." : "Run git blame on app/auth.py: the line MAX_LOGIN_ATTEMPTS = 50 shows the commit and author.";
        }
      },
      {
        id: "pickaxe", text: "Find the commit that first added <code>DEBUG = True</code> to <code>app/settings.py</code>.",
        hints: ["git log -S \"TEXT\" lists the commits that added or removed TEXT.", 'git log -S "DEBUG = True" --oneline -- app/settings.py'],
        check: function (r) {
          var want = function (x) { var v = repo(x, "kestrel-api"), c = firstWith(v, "app/settings.py", /DEBUG = True/); return c ? short(c.sha) : "???"; };
          var res = GL.H.showsAnswer(r, want, { system: detectiveSys(1) }, function (e) { return /git\s+log\b.*(-S|-G|--grep|-p)/.test(e.cmd); });
          return res === true ? true : res === "alt" ? "Search the history with git log -S rather than naming a commit." : "Use git log -S \"DEBUG = True\" to list the commit that added it.";
        }
      },
      {
        id: "bisect", text: "<code>./tests/check_upload.sh</code> fails now but passed at <code>v1.0</code>. Use <code>git bisect</code> to find the first bad commit.",
        hints: ["git bisect start, git bisect bad (now), git bisect good v1.0, then let git run the script.", "git bisect start\ngit bisect bad\ngit bisect good v1.0\ngit bisect run ./tests/check_upload.sh"],
        check: function (r) {
          var v = need(r, "kestrel-api"); if (typeof v === "string") return v;
          var b = badUpload(v);
          return ran(r, /git\s+bisect/, function (e) { return out(e).indexOf(b.sha + " is the first bad commit") >= 0; }) ? true : "Bisect until Git prints \"<commit> is the first bad commit\".";
        }
      },
      {
        id: "show", text: "Show the bad commit's diff, then end the bisect so you're back on <code>main</code>.",
        hints: ["While still bisecting, git show bisect/bad shows it. Then git bisect reset.", "git show bisect/bad\ngit bisect reset"],
        check: function (r) {
          var v = need(r, "kestrel-api"); if (typeof v === "string") return v;
          if (!ran(r, /git\s+(show|log)\b/, function (e) { return /^\+MAX_UPLOAD_MB = 1000/m.test(out(e)); })) return "Show the diff of the first bad commit (the + line should read MAX_UPLOAD_MB = 1000).";
          if (v.bisecting()) return "Finish with git bisect reset.";
          return v.branch() === "main" ? true : "You should be back on main (git bisect reset).";
        }
      }
    ],
    solution: lines("cd ~/kestrel-api", "git blame -L 3,3 app/auth.py", 'git log -S "DEBUG = True" --oneline -- app/settings.py', "./tests/check_upload.sh", "git bisect start", "git bisect bad", "git bisect good v1.0", "git bisect run ./tests/check_upload.sh", "git show bisect/bad", "git bisect reset", "git status"),
    debrief: "<p>Three questions, three tools: <b>blame</b> for \"who last touched this line\", <b>log -S</b> for \"when did this text appear\", <b>bisect</b> for \"which commit broke it\" when all you have is a test. With 18 commits bisect needed 3 or 4 tests; with 10,000 it would need about 14.</p><p>Look at what the bad commits' messages said: \"Refactor auth helpers\", \"Upload: stream large files\". Changes that weaken security are often hidden inside commits that say something else. That's why code review (Module 2) matters.</p>",
    realworld: "Most IDEs show blame inline (GitLens in VS Code). On GitHub, open a file and click Blame. Try git bisect on any bug that \"used to work\": it's one of Git's most underused superpowers.",
    quiz: [
      { q: "<code>git blame</code> shows, for each line…", options: ["Who wrote it first", "The commit that last changed it", "Who reviewed it", "How many times it changed"], answer: 1, why: "Blame shows the last change. To see earlier versions, blame the parent commit." },
      { q: "<code>git log -S \"API_KEY\"</code> finds commits that…", options: ["mention API_KEY in their message", "added or removed the text API_KEY", "touched a file named API_KEY", "are signed"], answer: 1, why: "-S compares the number of occurrences before and after each commit (--grep searches messages)." },
      { q: "<code>git bisect run SCRIPT</code> treats exit code 0 as…", options: ["bad", "good", "skip", "an error"], answer: 1, why: "0 = good, 1-127 (except 125) = bad, 125 = skip this commit." }
    ]
  });

  /* ================================================================== GT-110 capstone */
  var SHOP = HOME + "/kestrel-shop";
  var CH2 = "# Changelog\n\n## 2.0.0\n- New checkout page\n- Pay with cards and invoices\n";
  var CH_ROUND = "- Fix cart total rounding";
  var CH_LOGIN = "- Fix login redirect loop";
  function shopRepo(sys) {
    var loginPy = "def after_login(user, next_url):\n    if next_url and next_url.startswith(\"/\"):\n        return next_url\n    return \"/login\"\n";
    G.build(sys, SHOP, {
      steps: [
        { msg: "Initial shop", by: "ana", at: "2026-09-20 10:00", files: { "README.md": "# kestrel-shop\n", "app/cart.py": "def total(items):\n    return sum(i.price for i in items)\n", "app/login.py": loginPy, ".gitignore": "__pycache__/\n.env\n", "CHANGELOG.md": "# Changelog\n" } },
        { msg: "Build: add minified bundle", by: "leo", at: "2026-10-02 12:00", files: { "build/app.min.js": "!function(){/* 48 KB of minified code */}();\n", "build/app.css.map": "{\"version\":3,\"sources\":[]}\n" } },
        { msg: "Release 2.0.0", by: "ana", at: "2026-10-30 17:00", files: { "CHANGELOG.md": CH2 } },
        { tag: "v2.0.0", msg: "Kestrel shop 2.0.0", by: "ana" },
        { branch: "hotfix/login", from: "main" },
        { msg: "Fix login redirect loop", by: "ben", at: "2026-11-09 10:00", files: { "app/login.py": loginPy.replace("return \"/login\"", "return \"/account\""), "CHANGELOG.md": CH2.replace("# Changelog\n\n", "# Changelog\n\n## Unreleased\n" + CH_LOGIN + "\n\n") } },
        { checkout: "main" },
        { msg: "Fix cart total rounding", by: "ana", at: "2026-11-08 15:00", files: { "app/cart.py": "def total(items):\n    return round(sum(i.price for i in items), 2)\n", "CHANGELOG.md": CH2.replace("# Changelog\n\n", "# Changelog\n\n## Unreleased\n" + CH_ROUND + "\n\n") } },
        { msg: "wip: new checkout flow", by: "dev", at: "2026-11-10 17:30", files: { "app/checkout.py": "# TODO: new checkout flow\ndef start():\n    pass\n" } },
        { msg: "wip: checkout styles", by: "dev", at: "2026-11-10 18:05", files: { "static/checkout.css": ".checkout { display: grid; }\n" } }
      ],
      head: "main"
    });
  }
  LABS.push({
    id: "gt-110", n: 10, module: 1, ticket: "GT-110", xp: 200, capstone: true,
    title: "Capstone: Untangle the release",
    topic: "everything from Module 1",
    from: MAYA,
    story: "<p>We ship <b>kestrel-shop 2.0.1</b> this afternoon and <code>~/kestrel-shop</code> is a tangle:</p><ul>" +
      "<li>Your two <i>wip: checkout</i> commits went straight onto <code>main</code>. They belong on a branch called <code>feature/checkout</code>, and <code>main</code> must end at <i>Fix cart total rounding</i> again.</li>" +
      "<li>Ben's <code>hotfix/login</code> has to be in the release. Both his branch and <code>main</code> added a changelog entry: keep both.</li>" +
      "<li>Someone committed the <code>build/</code> folder. It's generated: stop tracking it (keep it on disk) and make Git ignore it.</li>" +
      "<li>Tag the finished release <code>v2.0.1</code> (annotated) and leave a clean working tree on <code>main</code>.</li></ul>" +
      "<p>No hints on a capstone. Use <code>git log --oneline --graph --all</code> and <code>git status</code> often.</p>",
    learn: "<h3>You've got this</h3><p>Everything you need is from this module:</p>" +
      '<table class="t"><tr><th>Need</th><th>Lab</th></tr><tr><td>Put a branch label where you are, and move main back</td><td>GT-106 branches, GT-105 reset</td></tr><tr><td>Merge with a conflict, keep both sides</td><td>GT-107</td></tr><tr><td>Stop tracking a folder, ignore it</td><td>GT-104 (<code>git rm -r --cached</code>)</td></tr><tr><td>Annotated tag</td><td>GT-108</td></tr></table>' +
      '<div class="callout">The order matters: fix the branches first, then merge, then clean up, and tag last (a tag should point at the final commit).</div>',
    system: shopRepo,
    starter: "",
    objectives: [
      {
        id: "branch", hints: [], text: "<code>feature/checkout</code> holds both <i>wip</i> commits; <code>main</code> doesn't.",
        check: function (r) {
          var v = need(r, "kestrel-shop"); if (typeof v === "string") return v;
          if (v.branches().indexOf("feature/checkout") < 0) return "There's no feature/checkout branch.";
          var subj = v.log("feature/checkout").map(function (c) { return c.subject; });
          if (subj.indexOf("wip: new checkout flow") < 0 || subj.indexOf("wip: checkout styles") < 0) return "feature/checkout should contain both wip commits.";
          var mainSubj = v.log("main", true).map(function (c) { return c.subject; });
          if (mainSubj.some(function (s) { return /^wip:/.test(s); })) return "main still contains wip commits.";
          return v.files("main")["app/checkout.py"] ? "app/checkout.py is still on main." : true;
        }
      },
      {
        id: "hotfix", hints: [], text: "<code>main</code> contains <code>hotfix/login</code>, merged, with both changelog entries and no conflict markers.",
        check: function (r) {
          var v = need(r, "kestrel-shop"); if (typeof v === "string") return v;
          if (!v.sha("hotfix/login") || !v.isAncestor("hotfix/login", "main")) return "Merge hotfix/login into main.";
          var ch = v.file("main", "CHANGELOG.md") || "";
          if (!noMarkers(ch)) return "CHANGELOG.md on main has conflict markers.";
          if (ch.indexOf(CH_ROUND) < 0 || ch.indexOf(CH_LOGIN) < 0) return "CHANGELOG.md should keep both entries: \"" + CH_ROUND.slice(2) + "\" and \"" + CH_LOGIN.slice(2) + "\".";
          if (ch.indexOf("## 2.0.0") < 0) return "CHANGELOG.md lost the 2.0.0 section.";
          if (!/\/account/.test(v.file("main", "app/login.py") || "")) return "main's app/login.py doesn't have Ben's fix.";
          return /round\(/.test(v.file("main", "app/cart.py") || "") ? true : "main lost the cart rounding fix.";
        }
      },
      {
        id: "build", hints: [], text: "<code>build/</code> is no longer tracked on <code>main</code>, is ignored, and its files are still on disk.",
        check: function (r) {
          var v = need(r, "kestrel-shop"); if (typeof v === "string") return v;
          if (Object.keys(v.files("main")).some(function (k) { return k.indexOf("build/") === 0; })) return "build/ files are still in main's latest commit.";
          if (!r.exists("~/kestrel-shop/build/app.min.js")) return "Keep the build/ files on disk (use --cached).";
          return v.ignored("build/app.min.js") ? true : "Make Git ignore build/.";
        }
      },
      {
        id: "tag", hints: [], text: "An annotated tag <code>v2.0.1</code> points at the final commit on <code>main</code>.",
        check: function (r) {
          var v = need(r, "kestrel-shop"); if (typeof v === "string") return v;
          var t = v.tag("v2.0.1");
          if (!t) return "There's no tag v2.0.1.";
          if (!t.annotated) return "v2.0.1 should be annotated (-a -m).";
          return t.target === v.sha("main") ? true : "v2.0.1 should point at main's latest commit (tag last, after everything else).";
        }
      },
      {
        id: "clean", hints: [], text: "You're on <code>main</code> with a clean working tree: no merge in progress, nothing staged or modified, no leftover <code>v2.0.0</code> damage.",
        check: function (r) {
          var v = need(r, "kestrel-shop"); if (typeof v === "string") return v;
          if (!v.tag("v2.0.1")) return "Finish the release first.";
          if (v.branch() !== "main") return "Finish on main.";
          if (v.merging()) return "A merge is still in progress.";
          if (!v.clean()) return "git status should say nothing to commit (untracked files are OK).";
          var t0 = v.tag("v2.0.0");
          return t0 && G.commitOf(r.sys, t0.target).message.indexOf("Release 2.0.0") === 0 ? true : "Leave the v2.0.0 tag where it was.";
        }
      }
    ],
    solution: lines("cd ~/kestrel-shop", "git log --oneline --graph --all", "git status", "git branch feature/checkout", "git reset --hard HEAD~2", "git log --oneline --graph --all", "git merge hotfix/login", "sed -i '/^<<<<<<<\\|^=======\\|^>>>>>>>/d' CHANGELOG.md", "cat CHANGELOG.md", "git add CHANGELOG.md", "git commit --no-edit", "git rm -r --cached build", 'echo "build/" >> .gitignore', "git add .gitignore", 'git commit -m "Stop tracking build output"', 'git tag -a v2.0.1 -m "Kestrel shop 2.0.1"', "git status", "git log --oneline --graph --all"),
    debrief: "<p><b>Module 1 complete.</b> You moved commits to the branch where they belonged without losing anything, merged a hotfix through a conflict, cleaned generated files out of the repository, and tagged a release. That's a normal Thursday for a developer.</p><p>So far everything lived on your laptop. Module 2 adds <b>GitHub</b>: remotes, pushing and pulling, pull requests, code review and protected branches.</p>",
    realworld: "In your own projects, practise the \"oops, I committed on main\" fix: git branch new-branch, then git reset --hard HEAD~N on main. Then look at it in git log --graph --all.",
    quiz: []
  });

  var UPCOMING = [
    { module: 2, title: "Remotes", topic: "clone, fetch, pull, push, upstreams" },
    { module: 2, title: "Signing in to GitHub", topic: "SSH keys and tokens" },
    { module: 2, title: "Pull requests", topic: "gh pr create, review, merge strategies" },
    { module: 2, title: "Rebase", topic: "rebase onto main, interactive rebase" },
    { module: 2, title: "Forks", topic: "upstream remote, keeping in sync" },
    { module: 2, title: "Issues", topic: "issues, labels, \"Closes #12\"" },
    { module: 2, title: "Protecting main", topic: "branch protection, CODEOWNERS" },
    { module: 2, title: "Rescues", topic: "cherry-pick and reflog" },
    { module: 2, title: "Module 2 capstone", topic: "Ship a feature through review", capstone: true },
    { module: 3, title: "Team workflows", topic: "GitHub flow, trunk-based, versions" },
    { module: 3, title: "Your first workflow", topic: "Actions YAML, triggers, jobs" },
    { module: 3, title: "Tests in CI", topic: "matrix builds and caching" },
    { module: 3, title: "Triggers", topic: "pull_request, schedule, manual runs" },
    { module: 3, title: "Secrets & environments", topic: "secrets, variables, approvals" },
    { module: 3, title: "Releases", topic: "artifacts and tag releases" },
    { module: 3, title: "Debugging runs", topic: "logs, re-runs" },
    { module: 3, title: "Module 3 capstone", topic: "A full pipeline for Kestrel", capstone: true },
    { module: 4, title: "A secret in history", topic: "rotate, filter-repo, force-push" },
    { module: 4, title: "Hooks", topic: "pre-commit and gitleaks" },
    { module: 4, title: "Signed commits", topic: "SSH signing, Verified, required signatures" },
    { module: 4, title: "GitHub security features", topic: "secret scanning, Dependabot, CodeQL" },
    { module: 4, title: "Securing Actions", topic: "GITHUB_TOKEN, pinning, injection" },
    { module: 4, title: "Supply chain", topic: "SBOMs, dependency review, OIDC" },
    { module: 4, title: "Access control", topic: "roles, deploy keys, tokens, audit log" },
    { module: 4, title: "Incident: leaked token", topic: "response start to finish" },
    { module: 4, title: "Module 4 capstone", topic: "Harden the Kestrel repo", capstone: true }
  ];
  var MODULES = [{ n: 1, name: "Git on your own machine" }, { n: 2, name: "Working with GitHub" }, { n: 3, name: "Workflows & GitHub Actions" }, { n: 4, name: "Git security & DevSecOps" }];
  window.GIT_TRACK = {
    MODULES: MODULES, LABS: LABS, UPCOMING: UPCOMING, ex: ex, code: code, lines: lines,
    B: { webSteps: webSteps, indexHtml: indexHtml, statusHtml: statusHtml, NGX: NGX, CSS1: CSS1, CSS2: CSS2, runbooksRepo: runbooksRepo, apiIgnoreRepo: apiIgnoreRepo, opsRepo: opsRepo, branchRepo: branchRepo, conflictRepo: conflictRepo, stashRepo: stashRepo, detectiveSys: detectiveSys, shopRepo: shopRepo, rmGitconfig: rmGitconfig, WEB: WEB, API: API, OPS: OPS, SHOP: SHOP, HOME: HOME, noMarkers: noMarkers, sameLines: sameLines, need: need, ran: ran, out: out, short: short }
  };
})();
