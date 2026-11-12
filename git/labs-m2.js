/* sudo learn — Git & GitHub track, Module 2: Working with GitHub (GT-111..119). The laptop talks to a simulated
   GitHub (github.js): remotes, sign-in with tokens and SSH keys, pull requests with reviews from simulated
   teammates, rebase, forks, issues, branch protection and CODEOWNERS, and rescues with cherry-pick and reflog.
   Checks read both the local repositories and GitHub's state (refs, pull requests, issues, settings). */
(function () {
  "use strict";
  var S = window.ShEngine, G = window.GitCore, GL = window.GitLab, GH = window.GitHub, SH = window.ShLab.H, T = window.GIT_TRACK;
  var ex = T.ex, code = T.code, lines = T.lines;
  var MAYA = "Maya Chen · SRE lead", DEV = "Dev Patel · Security", BEN = "Ben Okoro · Developer", ANA = "Ana Silva · Developer";
  var HOME = "/home/dev";
  var LABS = [];
  function repo(r, name) { return GL.H.repo(r, name); }
  function ran(r, re, fn) { return r.history.some(function (e) { return re.test(e.cmd) && (!fn || fn(e)); }); }
  function idxOf(r, re, fn) { var k = -1; r.history.forEach(function (e, i) { if (re.test(e.cmd) && (!fn || fn(e))) k = i; }); return k; }
  function all(e) { return e.out.concat(e.err); }
  function outHas(e, re) { return all(e).some(function (l) { return re.test(l); }); }
  function gh(r, full) { return GH.find(r.sys, full); }
  function tip(r, full, b) { var x = gh(r, full); return x ? x.refs["refs/heads/" + b] || null : null; }
  function fileOn(r, full, b, p) { var s = tip(r, full, b); if (!s) return null; var f = G.commitFlat(r.sys, s)[p]; return f ? G.blobText(r.sys, f.sha) : null; }
  function commitsOn(r, full, b) { var s = tip(r, full, b); if (!s) return []; return G.walk ? [] : Object.keys(G.ancestors(r.sys, s)).map(function (x) { return G.commitOf(r.sys, x); }); }
  function subjects(r, full, b) { var s = tip(r, full, b); if (!s) return []; return Object.keys(G.ancestors(r.sys, s)).map(function (x) { return G.commitOf(r.sys, x).message.split("\n")[0]; }); }
  function prs(r, full) { var x = gh(r, full); return x ? x.items.filter(function (i) { return i.type === "pr"; }) : []; }
  function issue(r, full, n) { var x = gh(r, full); return x ? GH.item(x, n) : null; }
  function localRemote(v, name) { return v ? G.configGet(v.sys, v.repo, 1000, "remote." + name + ".url") : null; }
  function urlIs(u, full) { var p = u ? GH.parseUrl(u) : null; return !!p && p.full.toLowerCase() === full.toLowerCase(); }
  function lines2(t) { return String(t || "").split("\n"); }
  // The world every Module 2 lab lives in: GitHub's people and the kestrel organisation; gh logged in unless auth:false.
  function world(sys, o) {
    o = o || {};
    GH.people(sys);
    if (o.auth !== false) GH.login(sys, "kc-dev", null, { setupGit: true });
  }
  T.M2 = { world: world, gh: gh, tip: tip, fileOn: fileOn, prs: prs, issue: issue };

  /* ================================================================== GT-111 Remotes */
  var DOCS = [
    { msg: "Start the on-call docs", by: "maya", at: "2026-10-05 10:00", files: { "README.md": "# Kestrel on-call docs\n\nHow to recieve pages, who to call, and what to do first.\n", "escalation.md": "# Escalation\n\n1. Page the on-call engineer.\n2. After 15 minutes, page the SRE lead.\n" } },
    { msg: "Add incident checklist", by: "ben", at: "2026-10-12 15:20", files: { "checklist.md": "# Incident checklist\n\n- [ ] Open an incident channel\n- [ ] Write down the time\n- [ ] Tell support\n" } }
  ];
  function docsWorld(sys) {
    world(sys);
    GH.seed(sys, "kestrel/kestrel-docs", { steps: DOCS }, { description: "On-call documentation" });
    var done = false;
    GH.on(sys, "clone", function (sys2, d) { if (done || d.repo.full !== "kestrel/kestrel-docs") return; done = true; GH.commit(sys2, "kestrel/kestrel-docs", "main", "maya", "Add on-call contacts", { "contacts.md": "# On-call contacts\n\n- SRE lead: Maya Chen\n- Security: Dev Patel\n" }); });
  }
  LABS.push({
    id: "gt-111", n: 11, module: 2, ticket: "GT-111", xp: 130,
    title: "Remotes",
    topic: "clone, fetch, pull, push, upstreams",
    from: MAYA,
    story: "<p>The on-call docs live on GitHub in <code>kestrel/kestrel-docs</code>, and the whole team edits them. Get a copy on your laptop, fix a typo everyone keeps tripping over, and get your fix back to GitHub, even though Maya is editing the same repository at the same time. IT already logged your laptop into GitHub.</p>",
    learn:
      "<h3>Remotes</h3><p>Your repository and the one on GitHub are two separate copies with the same history. A <b>remote</b> is a saved name for the other copy's address. <code>git clone</code> makes the copy and names the remote <code>origin</code>:</p>" +
      ex("git clone https://github.com/kestrel/kestrel-docs.git") + code("cd kestrel-docs\ngit remote -v\ngit branch -a") +
      "<p>Besides your own branches, Git keeps <b>remote-tracking branches</b> such as <code>origin/main</code>: what <code>main</code> on GitHub looked like the last time you talked to it. They only move when you fetch, pull or push.</p>" +
      "<h3>The four verbs</h3>" +
      '<table class="t"><tr><th>Command</th><th>Does</th></tr><tr><td><code>git fetch</code></td><td>download new commits; update <code>origin/*</code>; your branches don\'t move</td></tr><tr><td><code>git pull</code></td><td>fetch, then combine <code>origin/main</code> into your branch</td></tr><tr><td><code>git push</code></td><td>upload your commits and move the branch on GitHub</td></tr><tr><td><code>git clone URL</code></td><td>copy a repository the first time</td></tr></table>' +
      "<h3>When push is rejected</h3><p>GitHub only accepts a push that <b>adds</b> to its branch. If a teammate pushed first, yours is rejected with <i>fetch first</i>. Look at what arrived, then combine:</p>" +
      code("git fetch\ngit log --oneline main..origin/main     # what they have that you don't\ngit pull --rebase                      # replay your commits on top of theirs\ngit push") +
      "<p><code>git pull</code> needs to know how to combine diverged branches: <code>--rebase</code> (a straight line, preferred for small changes) or <code>--no-rebase</code> (a merge commit). Set a default once with <code>git config pull.rebase true</code>.</p>" +
      "<h3>New branches and upstreams</h3>" + code("git switch -c docs/runbook-links\ngit push -u origin docs/runbook-links") +
      "<p><code>-u</code> (<code>--set-upstream</code>) links your branch to the one on GitHub, so afterwards plain <code>git push</code>, <code>git pull</code> and <code>git status</code> know where to compare.</p>",
    system: docsWorld,
    starter: "",
    objectives: [
      {
        id: "clone", text: "Clone <code>https://github.com/kestrel/kestrel-docs.git</code> into your home folder (<code>~/kestrel-docs</code>).",
        hints: ["git clone URL, from your home folder.", "cd ~\ngit clone https://github.com/kestrel/kestrel-docs.git"],
        check: function (r) { var v = repo(r, "kestrel-docs"); if (!v) return "~/kestrel-docs isn't a repository yet: git clone the URL from your home folder."; return urlIs(localRemote(v, "origin"), "kestrel/kestrel-docs") ? true : "~/kestrel-docs's origin should point at kestrel/kestrel-docs."; }
      },
      {
        id: "look", text: "Show the remotes with their URLs, and every branch including the remote-tracking ones.",
        hints: ["remote has a verbose flag; branch has one for all branches.", "git remote -v\ngit branch -a"],
        check: function (r) {
          var a = ran(r, /git\s+remote\s+(-v|--verbose)/, function (e) { return outHas(e, /^origin\s+\S*kestrel-docs\S*\s+\(fetch\)/); });
          var b = ran(r, /git\s+branch\s+.*(-a|--all|-r|--remotes)/, function (e) { return outHas(e, /origin\/main/); });
          return a && b ? true : !a ? "git remote -v lists the remotes with their URLs." : "git branch -a lists your branches and the remote-tracking ones (origin/...).";
        }
      },
      {
        id: "fetch", text: "README.md says <i>recieve</i>: fix it to <i>receive</i>, commit, and push. When the push is rejected, <b>fetch</b> and show the commit(s) GitHub has that you don't.",
        hints: ["sed -i 's/recieve/receive/' README.md, git commit -am ..., git push. Then git fetch and git log main..origin/main.", "git fetch\ngit log --oneline main..origin/main"],
        check: function (r) {
          if (!ran(r, /git\s+push/, function (e) { return outHas(e, /\(fetch first\)/); })) return "Commit the fix and push it: GitHub will reject it, because Maya pushed in the meantime.";
          var k = idxOf(r, /git\s+fetch/);
          if (k < 0) return "Fetch what's new on GitHub: git fetch.";
          return r.history.some(function (e, i) { return i > k && /git\s+log/.test(e.cmd) && outHas(e, /Add on-call contacts/) && !outHas(e, /Fix typo|receive|recieve/i) || i > k && /git\s+log/.test(e.cmd) && /\.\.\s*origin\/main|origin\/main\s+\^main|\^main\s+origin\/main/.test(e.cmd) && outHas(e, /Add on-call contacts/); }) ? true : "Show what arrived: git log --oneline main..origin/main (commits on origin/main that main doesn't have).";
        }
      },
      {
        id: "pushed", text: "Combine Maya's commit with yours (pull) and push, so GitHub has both and your <code>main</code> matches <code>origin/main</code>.",
        hints: ["git pull --rebase (or set pull.rebase once), then git push.", "git pull --rebase\ngit push"],
        check: function (r) {
          var readme = fileOn(r, "kestrel/kestrel-docs", "main", "README.md") || "";
          if (/recieve/.test(readme)) return "GitHub's README.md still says recieve.";
          if (!fileOn(r, "kestrel/kestrel-docs", "main", "contacts.md")) return "Maya's contacts.md is missing on GitHub's main: did you force-push over her work? Reset the machine and pull instead.";
          var v = repo(r, "kestrel-docs");
          if (!v || v.sha("main") !== tip(r, "kestrel/kestrel-docs", "main") || v.sha("origin/main") !== v.sha("main")) return "Your main and GitHub's main should be the same commit (git status: up to date with 'origin/main').";
          return true;
        }
      },
      {
        id: "branch", text: "Create a branch <code>docs/runbook-links</code>, add a file <code>links.md</code>, commit it, and push the branch with an upstream so <code>git status</code> tracks it.",
        hints: ["git switch -c, then git push -u origin BRANCH.", "git switch -c docs/runbook-links\necho '# Runbook links' > links.md\ngit add links.md\ngit commit -m 'Add runbook links'\ngit push -u origin docs/runbook-links"],
        check: function (r) {
          var v = repo(r, "kestrel-docs"); if (!v) return "Clone the repository first.";
          if (!fileOn(r, "kestrel/kestrel-docs", "docs/runbook-links", "links.md")) return "GitHub doesn't have docs/runbook-links with links.md yet.";
          if (v.config("branch.docs/runbook-links.merge") !== "refs/heads/docs/runbook-links" || v.config("branch.docs/runbook-links.remote") !== "origin") return "Your local branch isn't linked to origin/docs/runbook-links: push it with -u.";
          return v.sha("docs/runbook-links") === tip(r, "kestrel/kestrel-docs", "docs/runbook-links") ? true : "Your local docs/runbook-links and GitHub's differ: push again.";
        }
      }
    ],
    solution: lines("git clone https://github.com/kestrel/kestrel-docs.git", "cd kestrel-docs", "git remote -v", "git branch -a",
      "sed -i 's/recieve/receive/' README.md", "git commit -am 'Fix typo in README'", "git push", "git fetch", "git log --oneline main..origin/main",
      "git pull --rebase", "git push", "git status",
      "git switch -c docs/runbook-links", "echo '# Runbook links' > links.md", "git add links.md", "git commit -m 'Add runbook links'", "git push -u origin docs/runbook-links", "git status"),
    debrief: "<p>You've used the whole loop: clone once, then fetch, pull and push. The rejected push wasn't an error to work around: it was Git protecting Maya's commit. Fetching first and replaying yours on top kept both.</p><p>Remote-tracking branches like <code>origin/main</code> are just your laptop's memory of GitHub; <code>git fetch</code> is how you refresh it. Next: how GitHub knows who you are.</p>",
    realworld: "Clone any public repository you like (https://github.com/git/git is a good one) and run git log origin/master..master and git branch -a. Then git fetch a week later and see what moved.",
    quiz: [
      { q: "What does <code>git fetch</code> change?", options: ["Your current branch", "Only the remote-tracking branches like origin/main", "The files in your folder", "GitHub"], answer: 1, why: "Fetch downloads and updates origin/*. Your branches and files stay put until you merge or rebase." },
      { q: "Push says <i>rejected (fetch first)</i>. The right move?", options: ["git push --force", "git pull (or fetch + rebase), then push", "Delete the repository and clone again", "Wait and try later"], answer: 1, why: "GitHub has commits you don't. Bring them in, then push. --force would delete them." },
      { q: "What does <code>-u</code> do in <code>git push -u origin feature</code>?", options: ["Uploads untracked files", "Links the local branch to origin/feature as its upstream", "Pushes all branches", "Updates Git"], answer: 1, why: "After that, plain git push/pull/status know which remote branch to use." }
    ]
  });

  /* ================================================================== GT-112 Signing in to GitHub */
  function opsWorld(sys) {
    world(sys, { auth: false });
    GH.seed(sys, "kestrel/ops-scripts", { steps: [{ msg: "Add health check", by: "maya", at: "2026-10-02 09:00", files: { "README.md": "# ops-scripts\n\nSmall scripts the SRE team runs on servers.\n", "health.sh": "#!/bin/bash\nsystemctl is-active --quiet nginx && echo ok\n" }, exec: ["health.sh"] }] }, { description: "Operations scripts" });
    GH.cloneTo(sys, "kestrel/ops-scripts", HOME + "/ops-scripts");
    GH.runAs(sys, HOME + "/ops-scripts", ["printf '#!/bin/bash\\ndf -h / | tail -1\\n' > disk.sh", "chmod +x disk.sh", "git add disk.sh", "git commit -qm 'Add disk check script'"]);
    var tok = GH.newToken(sys, "kc-dev", { scopes: ["repo", "read:org", "workflow"], note: "kc-dev-01 laptop" });
    G.putFile(sys, HOME + "/github-token.txt", tok + "\n", 384, 1000, 1000);
  }
  LABS.push({
    id: "gt-112", n: 12, module: 2, ticket: "GT-112", xp: 140,
    title: "Signing in to GitHub",
    topic: "tokens, gh auth, SSH keys",
    from: DEV,
    story: "<p>Your laptop was reinstalled and has no GitHub login. You have an unpushed commit in <code>~/ops-scripts</code>. Security sent you a fresh personal access token in <code>~/github-token.txt</code>. Sign in the right way, push over HTTPS, then set up an SSH key as well (it's what the build servers use), and don't leave the token lying around.</p>",
    learn:
      "<h3>Two ways to prove who you are</h3>" +
      '<table class="t"><tr><th>Remote URL</th><th>Credential</th></tr><tr><td><code>https://github.com/OWNER/REPO.git</code></td><td>a <b>token</b> (GitHub stopped accepting account passwords for Git in 2021)</td></tr><tr><td><code>git@github.com:OWNER/REPO.git</code></td><td>an <b>SSH key</b> whose public half is on your GitHub account</td></tr></table>' +
      "<h3>Tokens with gh</h3><p>The GitHub CLI stores the token in your system's keyring and can hand it to Git, so it never sits in a file or in your shell history:</p>" +
      code("gh auth login --with-token < ~/github-token.txt\ngh auth status\ngh auth setup-git          # git uses gh's login for https://github.com") +
      "<p>A classic token has <b>scopes</b> (<code>repo</code>, <code>read:org</code>, <code>workflow</code>...): ask for the fewest that do the job. Fine-grained tokens go further and limit which repositories it can touch.</p>" +
      "<h3>SSH keys</h3>" + code("ssh-keygen -t ed25519 -C \"kc-dev@kc-dev-01\"\ngh ssh-key add ~/.ssh/id_ed25519.pub --title kc-dev-01\nssh -T git@github.com") +
      "<p>The first connection asks whether to trust GitHub's host key: compare the fingerprint with the one GitHub publishes. <code>ssh -T</code> answers \"Hi <i>you</i>!\" when the key works. Then point the remote at the SSH address:</p>" +
      code("git remote set-url origin git@github.com:kestrel/ops-scripts.git") +
      '<div class="callout">A token is a password. Once gh has it, delete the file: anyone who can read it can push as you. And never paste one into a URL (<code>https://TOKEN@github.com/...</code>): it ends up in <code>.git/config</code> and in shell history.</div>',
    system: opsWorld,
    starter: "",
    objectives: [
      {
        id: "fail", text: "In <code>~/ops-scripts</code>, try to push your commit and see why it fails.",
        hints: ["cd ~/ops-scripts, then git push."],
        check: function (r) { return ran(r, /git\s+push/, function (e) { return outHas(e, /could not read Username for 'https:\/\/github\.com'/); }) ? true : "Run git push in ~/ops-scripts before logging in."; }
      },
      {
        id: "login", text: "Log gh in with the token from <code>~/github-token.txt</code> (from standard input), and check the login.",
        hints: ["gh auth login --with-token reads the token from stdin: use < FILE.", "gh auth login --with-token < ~/github-token.txt\ngh auth status"],
        check: function (r) {
          if (!r.sys.ghAuth || r.sys.ghAuth.login !== "kc-dev") return "gh isn't logged in: gh auth login --with-token < ~/github-token.txt";
          return ran(r, /gh\s+auth\s+status/, function (e) { return outHas(e, /Logged in to github\.com account kc-dev/); }) ? true : "Check it with gh auth status.";
        }
      },
      {
        id: "https", text: "Let Git use gh's login, and push your commit over HTTPS.",
        hints: ["gh auth setup-git configures Git's credential helper.", "gh auth setup-git\ngit push"],
        check: function (r) {
          if (!GL.H.printed(r, /\.\.\w+\s+main -> main/, function (e) { return /git\s+push/.test(e.cmd); })) return "Push the commit: gh auth setup-git, then git push.";
          if (!/gh auth git-credential/.test(r.read(HOME + "/.gitconfig") || "")) return "Use gh auth setup-git so the token stays in gh's keyring (not in a file or a URL).";
          return (r.sys.pushLog || []).some(function (p) { return p.proto === "https" && p.repo === "kestrel/ops-scripts"; }) ? true : "That push didn't go over HTTPS.";
        }
      },
      {
        id: "ssh", text: "Create an <b>ed25519</b> SSH key, add its public half to your GitHub account, and test it with <code>ssh -T git@github.com</code>.",
        hints: ["ssh-keygen -t ed25519 (accept the default file), gh ssh-key add the .pub file.", "ssh-keygen -t ed25519 -C kc-dev@kc-dev-01 -f ~/.ssh/id_ed25519 -N ''\ngh ssh-key add ~/.ssh/id_ed25519.pub --title kc-dev-01\nssh -T git@github.com"],
        check: function (r) {
          var u = GH.hub(r.sys).users["kc-dev"];
          if (!u.keys.length) return "Your GitHub account has no SSH key yet (gh ssh-key add ~/.ssh/id_ed25519.pub).";
          if (!u.keys.some(function (k) { return k.type === "ssh-ed25519"; })) return "Use an ed25519 key (ssh-keygen -t ed25519).";
          return ran(r, /ssh\s+.*-T.*git@github\.com|ssh\s+git@github\.com/, function (e) { return outHas(e, /^Hi kc-dev!/); }) ? true : "Test it: ssh -T git@github.com should say Hi kc-dev!";
        }
      },
      {
        id: "switch", text: "Switch <code>origin</code> to the SSH address, then commit a small change and push it over SSH.",
        hints: ["git remote set-url origin git@github.com:kestrel/ops-scripts.git", "git remote set-url origin git@github.com:kestrel/ops-scripts.git\necho '# run as root' >> disk.sh\ngit commit -am 'Note that disk.sh runs as root'\ngit push"],
        check: function (r) {
          var v = repo(r, "ops-scripts");
          if (!/^(ssh:\/\/)?git@github\.com[:\/]kestrel\/ops-scripts(\.git)?$/.test(localRemote(v, "origin") || "")) return "origin should be git@github.com:kestrel/ops-scripts.git";
          return (r.sys.pushLog || []).some(function (p) { return p.proto === "ssh" && p.repo === "kestrel/ops-scripts"; }) ? true : "Push a new commit over SSH.";
        }
      },
      {
        id: "clean", text: "gh keeps the token now: delete <code>~/github-token.txt</code>.",
        hints: ["rm ~/github-token.txt"],
        check: function (r) { return r.exists(HOME + "/github-token.txt") ? "~/github-token.txt is still there." : (!r.sys.ghAuth ? "Log in with it before deleting it." : true); }
      }
    ],
    solution: lines("cd ~/ops-scripts", "git push", "gh auth login --with-token < ~/github-token.txt", "gh auth status", "gh auth setup-git", "git push",
      "ssh-keygen -t ed25519 -C kc-dev@kc-dev-01 -f ~/.ssh/id_ed25519 -N ''", "gh ssh-key add ~/.ssh/id_ed25519.pub --title kc-dev-01", "ssh -T git@github.com",
      "git remote set-url origin git@github.com:kestrel/ops-scripts.git", "echo '# run as root' >> disk.sh", "git commit -am 'Note that disk.sh runs as root'", "git push", "rm ~/github-token.txt"),
    debrief: "<p>Both doors work now: HTTPS with a token that lives in gh's keyring, and SSH with a key whose private half never leaves your laptop. The token file is gone, so a stolen backup of your home folder won't contain it.</p><p>Next: changes that go through review, the way most teams work on GitHub.</p>",
    realworld: "On your own machine: gh auth login (it opens a browser), gh auth setup-git, and add an SSH key. GitHub's settings page lists your keys and tokens: review it now and then and delete what you no longer use.",
    quiz: [
      { q: "Why does <code>git push</code> over HTTPS fail with your GitHub account password?", options: ["The password is wrong", "GitHub only accepts tokens (or SSH) for Git since 2021", "HTTPS is blocked", "You need sudo"], answer: 1, why: "Passwords were retired for Git operations. Use a token or a key." },
      { q: "Which part of an SSH key goes on GitHub?", options: ["id_ed25519", "id_ed25519.pub", "known_hosts", "Both files"], answer: 1, why: "Only the public half (.pub). The private key never leaves your machine." },
      { q: "The first <code>ssh -T git@github.com</code> asks you to trust a fingerprint. What should you do?", options: ["Always type yes", "Compare it with GitHub's published fingerprint first", "Say no and use HTTPS", "Delete known_hosts"], answer: 1, why: "That check is what protects you from someone impersonating github.com." }
    ]
  });

  /* ================================================================== GT-113 Pull requests */
  var WEB = [
    { msg: "Initial site", by: "maya", at: "2026-10-01 10:00", files: { "README.md": "# kestrel-web\n\nThe Kestrel Cloud website.\n", "index.html": "<!DOCTYPE html>\n<html>\n<head><title>Kestrel Cloud</title></head>\n<body>\n<h1>Kestrel Cloud</h1>\n<p>Fast, friendly hosting.</p>\n</body>\n</html>\n" } },
    { msg: "Add pricing page", by: "ben", at: "2026-10-08 14:00", files: { "pricing.html": "<!DOCTYPE html>\n<html>\n<head><title>Pricing</title></head>\n<body>\n<h1>Pricing</h1>\n<a href=\"/\">Home</a>\n</body>\n</html>\n" } }
  ];
  function webWorld(sys, o) {
    o = o || {};
    world(sys);
    GH.seed(sys, "kestrel/kestrel-web", { steps: WEB }, { description: "The Kestrel Cloud website" });
    GH.find(sys, "kestrel/kestrel-web").protect.main = { pr: { count: 1, codeowners: false, dismissStale: false }, checks: null, enforceAdmins: true, linear: false, forcePush: false, deletions: false };
    if (o.clone !== false) GH.cloneTo(sys, "kestrel/kestrel-web", HOME + "/kestrel-web");
  }
  function hasHomeLink(t) { return /<a\s+href="(\/|\/?index\.html)"/.test(t || ""); }
  LABS.push({
    id: "gt-113", n: 13, module: 2, ticket: "GT-113", xp: 150,
    title: "Pull requests",
    topic: "gh pr create, review, merge",
    from: MAYA,
    story: "<p>Customers want a status page. Add <code>status.html</code> to the website (<code>~/kestrel-web</code>). On this team nothing reaches <code>main</code> without review: <code>main</code> is protected, so the change goes through a <b>pull request</b> that Maya reviews.</p>",
    learn:
      "<h3>The pull request flow</h3>" + code("git switch -c feature/status-page\n# ...edit, git add, git commit...\ngit push -u origin feature/status-page\ngh pr create --title \"Add status page\" --body \"Shows the current service status.\" --reviewer maya-chen") +
      "<p>A pull request (PR) asks to merge one branch into another, here <code>feature/status-page</code> into <code>main</code>. Reviewers read the diff, comment, and <b>approve</b> or <b>request changes</b>. Every push to the branch updates the PR.</p>" +
      code("gh pr list\ngh pr view                 # the PR for the branch you're on\ngh pr view --comments      # with the whole conversation\ngh pr diff") +
      "<h3>Merging: three strategies</h3>" +
      '<table class="t"><tr><th>Option</th><th>Result on main</th></tr><tr><td><code>--merge</code></td><td>a merge commit; every commit of the branch kept</td></tr><tr><td><code>--squash</code></td><td>one commit with all the changes, titled <i>PR title (#N)</i></td></tr><tr><td><code>--rebase</code></td><td>the branch\'s commits replayed on main, no merge commit</td></tr></table>' +
      code("gh pr merge --squash --delete-branch") +
      "<p><code>--delete-branch</code> removes the branch on GitHub and locally, switches you back to <code>main</code> and pulls it.</p>" +
      '<div class="callout">Small PRs get reviewed fast and well. One change, a clear title, a body that says <b>why</b>.</div>',
    system: function (sys) {
      webWorld(sys);
      GH.on(sys, "pr.opened", function (sys2, d) { if (d.repo.full === "kestrel/kestrel-web" && d.pr.author === "kc-dev") GH.review(sys2, d.repo.full, d.pr.n, "maya-chen", "CHANGES_REQUESTED", "Thanks! The page needs a link back to the homepage (<a href=\"/\">Home</a>), like pricing.html has."); });
      GH.on(sys, "pr.synchronize", function (sys2, d) { if (d.repo.full !== "kestrel/kestrel-web") return; var t = G.commitFlat(sys2, d.after)["status.html"]; if (t && hasHomeLink(G.blobText(sys2, t.sha))) GH.review(sys2, d.repo.full, d.pr.n, "maya-chen", "APPROVED", "Perfect, thanks!"); else GH.comment(sys2, d.repo.full, d.pr.n, "maya-chen", "Still no link to the homepage on status.html."); });
    },
    starter: "",
    objectives: [
      {
        id: "branch", text: "In <code>~/kestrel-web</code>, on a new branch <code>feature/status-page</code>, add <code>status.html</code> (any HTML page), commit it and push the branch.",
        hints: ["git switch -c, create the file, add, commit, git push -u origin feature/status-page.", "cd ~/kestrel-web\ngit switch -c feature/status-page\necho '<h1>Status: all systems normal</h1>' > status.html\ngit add status.html\ngit commit -m 'Add status page'\ngit push -u origin feature/status-page"],
        check: function (r) { var p = prs(r, "kestrel/kestrel-web").filter(function (x) { return x.head === "feature/status-page"; })[0]; if (p && p.state === "merged") return true; return fileOn(r, "kestrel/kestrel-web", "feature/status-page", "status.html") !== null ? true : "GitHub doesn't have feature/status-page with status.html yet."; }
      },
      {
        id: "pr", text: "Open a pull request into <code>main</code> with a title and a description, and ask <code>maya-chen</code> to review it.",
        hints: ["gh pr create with --title, --body and --reviewer.", "gh pr create --title 'Add status page' --body 'Shows customers the current service status.' --reviewer maya-chen"],
        check: function (r) {
          var p = prs(r, "kestrel/kestrel-web").filter(function (x) { return x.head === "feature/status-page"; })[0];
          if (!p) return "No pull request for feature/status-page yet (gh pr create).";
          if (!p.body.trim()) return "Give the PR a description (--body): reviewers need to know why.";
          return p.reviews.some(function (x) { return x.by === "maya-chen"; }) || p.reviewers.indexOf("maya-chen") >= 0 ? true : "Ask maya-chen to review (--reviewer maya-chen).";
        }
      },
      {
        id: "read", text: "Read Maya's review from the terminal.",
        hints: ["gh pr view shows the latest comment; --comments shows them all.", "gh pr view --comments"],
        check: function (r) { return ran(r, /gh\s+pr\s+view/, function (e) { return outHas(e, /link back to the homepage/); }) ? true : "Look at the PR with gh pr view (or gh pr view --comments) to see what Maya asked for."; }
      },
      {
        id: "fix", text: "Do what Maya asked on the same branch and push: the pull request updates and Maya approves it.",
        hints: ["Add <a href=\"/\">Home</a> to status.html, commit, git push (the upstream is set).", "echo '<a href=\"/\">Home</a>' >> status.html\ngit commit -am 'Link back to the homepage'\ngit push"],
        check: function (r) { var p = prs(r, "kestrel/kestrel-web").filter(function (x) { return x.head === "feature/status-page"; })[0]; if (!p) return "Open the pull request first."; return GH.latestReviews(r.sys, gh(r, "kestrel/kestrel-web"), p)["maya-chen"] === "APPROVED" || p.reviews.some(function (x) { return x.state === "APPROVED"; }) ? true : "Maya hasn't approved yet: add the homepage link to status.html and push."; }
      },
      {
        id: "merge", text: "Squash-merge the pull request and delete its branch, ending up on an up-to-date <code>main</code>.",
        hints: ["gh pr merge with --squash and --delete-branch.", "gh pr merge --squash --delete-branch"],
        check: function (r) {
          var p = prs(r, "kestrel/kestrel-web").filter(function (x) { return x.head === "feature/status-page"; })[0];
          if (!p || p.state !== "merged") return "Merge the pull request (gh pr merge --squash --delete-branch).";
          if (p.method !== "squash") return "Use a squash merge (--squash): one tidy commit on main.";
          if (tip(r, "kestrel/kestrel-web", "feature/status-page")) return "Delete the branch on GitHub too (--delete-branch).";
          var v = repo(r, "kestrel-web");
          return v.branch() === "main" && v.sha("main") === tip(r, "kestrel/kestrel-web", "main") ? true : "Finish on main, up to date with GitHub (gh pr merge --delete-branch does that, or git switch main && git pull).";
        }
      }
    ],
    solution: lines("cd ~/kestrel-web", "git switch -c feature/status-page", "echo '<h1>Status: all systems normal</h1>' > status.html", "git add status.html", "git commit -m 'Add status page'", "git push -u origin feature/status-page",
      "gh pr create --title 'Add status page' --body 'Shows customers the current service status.' --reviewer maya-chen", "gh pr view --comments",
      "echo '<a href=\"/\">Home</a>' >> status.html", "git commit -am 'Link back to the homepage'", "git push", "gh pr view",
      "gh pr merge --squash --delete-branch", "git log --oneline -3"),
    debrief: "<p>That's the everyday GitHub loop: branch, push, PR, review, fix, approve, merge. The protection on <code>main</code> made it non-negotiable: even an admin's push to main would have been refused.</p><p>Squash merging turned your two commits (the page, then the review fix) into one commit on main named after the PR, which keeps main's history readable. Next: rebase, for when main moves under your branch.</p>",
    realworld: "Open a PR on any of your own repositories with gh pr create --fill (title and body from your commits), then gh pr view --web would open it in the browser.",
    quiz: [
      { q: "Maya requested changes. What do you do?", options: ["Open a new pull request", "Push more commits to the same branch", "Merge anyway", "Close the PR"], answer: 1, why: "The PR follows the branch: new commits appear in it automatically." },
      { q: "What does a squash merge put on main?", options: ["Every commit of the branch", "One commit with all the branch's changes", "A merge commit plus all commits", "Nothing until you pull"], answer: 1, why: "One commit, usually titled \"PR title (#N)\"." },
      { q: "Why protect <code>main</code>?", options: ["To make Git faster", "So changes only arrive through reviewed pull requests", "To hide it", "It's required by Git"], answer: 1, why: "Protection enforces the process: no direct pushes, reviews required." }
    ]
  });

  /* ================================================================== GT-114 Rebase */
  var API = [
    { msg: "Initial API", by: "ben", at: "2026-10-01 10:00", files: { "app/config.py": "RATE_LIMIT = None\nTIMEOUT = 30\nDEBUG = False\n", "app/api.py": "from app import config\n\ndef handle(request):\n    return {\"ok\": True}\n", "README.md": "# kestrel-api\n" } },
    { msg: "Add health endpoint", by: "maya", at: "2026-10-04 11:00", files: { "app/health.py": "def health():\n    return {\"status\": \"ok\"}\n" } }
  ];
  function apiWorld(sys) {
    world(sys);
    GH.seed(sys, "kestrel/kestrel-api", { steps: API }, { description: "The Kestrel API" });
    GH.cloneTo(sys, "kestrel/kestrel-api", HOME + "/kestrel-api");
    GH.runAs(sys, HOME + "/kestrel-api", [
      "git switch -q -c feature/rate-limit",
      "sed -i 's/^RATE_LIMIT = None$/RATE_LIMIT = 100/' app/config.py", "printf 'def limited(count):\\n    return count > config.RATE_LIMT\\n' >> app/api.py", "git commit -qam 'Add rate limiter'",
      "sed -i 's/RATE_LIMT/RATE_LIMIT/' app/api.py", "git commit -qam 'fix typo'",
      "mkdir -p tests", "printf 'from app.api import limited\\n\\ndef test_limit():\\n    assert limited(101)\\n' > tests/test_limit.py", "git add tests", "git commit -qm 'Add tests for limiter'",
      "git push -q -u origin feature/rate-limit"
    ]);
    GH.commit(sys, "kestrel/kestrel-api", "main", "maya", "Raise the timeout to 60s", { "app/config.py": "RATE_LIMIT = None\nTIMEOUT = 60\nDEBUG = False\n" }, G.clock(sys) - 3600);
    GH.commit(sys, "kestrel/kestrel-api", "main", "ana", "Document the endpoints", { "README.md": "# kestrel-api\n\nEndpoints: /health, /orders\n" }, G.clock(sys) - 1800);
  }
  function featureSubjects(v, base) { return v.log("feature/rate-limit", true).filter(function (c) { return !v.isAncestor(c.sha, base); }).map(function (c) { return c.subject; }); }
  LABS.push({
    id: "gt-114", n: 14, module: 2, ticket: "GT-114", xp: 150,
    title: "Rebase",
    topic: "rebase onto main, interactive rebase",
    from: BEN,
    story: "<p>Your branch <code>feature/rate-limit</code> in <code>~/kestrel-api</code> is ready for review, but <code>main</code> has moved on since you started (Maya changed the timeout in the same file), and your history has an embarrassing \"fix typo\" commit. Before opening the PR: bring the branch up to date with a straight history, clean up the commits, and update the branch on GitHub safely.</p>",
    learn:
      "<h3>Rebase: replay your commits on a new base</h3>" + code("git fetch\ngit rebase origin/main") +
      "<p>Rebase takes the commits that are on your branch but not on <code>origin/main</code>, and re-applies them one by one on top of it. The result is a straight line, as if you'd started from today's main. Each replayed commit gets a <b>new ID</b>.</p>" +
      "<h3>Conflicts during a rebase</h3><p>If a commit doesn't apply cleanly, the rebase stops on it. Fix the file as with a merge conflict, then:</p>" + code("git add app/config.py\ngit rebase --continue      # or --skip this commit, or --abort to undo everything") +
      "<h3>Interactive rebase: edit history</h3>" + code("git rebase -i origin/main") +
      "<p>Git opens a to-do list, one line per commit, oldest first. Change the word in front of a commit: <code>pick</code> (keep), <code>reword</code>, <code>edit</code>, <code>squash</code> (merge into the previous one, keeping both messages), <code>fixup</code> (merge into the previous one, dropping this message), <code>drop</code>. In this lab the list opens as a file: <code>nano .git/rebase-merge/git-rebase-todo</code>, save, <code>git rebase --continue</code>.</p>" +
      "<p>Shortcut for next time: commit fixes with <code>git commit --fixup=SHA</code>, and <code>git rebase -i --autosquash</code> places them for you.</p>" +
      "<h3>Pushing rewritten history</h3><p>Your branch on GitHub still has the old commits, so a normal push is rejected. Overwrite it, but safely:</p>" + code("git push --force-with-lease") +
      "<p><code>--force-with-lease</code> only overwrites if GitHub's branch is still what you last fetched; if a teammate pushed meanwhile, it refuses instead of deleting their work. Plain <code>--force</code> doesn't check.</p>" +
      '<div class="callout warn">Only rewrite branches that are yours. Never rebase or force-push <code>main</code> or a branch others build on.</div>',
    system: apiWorld,
    starter: "",
    objectives: [
      {
        id: "behind", text: "In <code>~/kestrel-api</code>, fetch, and show the commits on <code>origin/main</code> that your branch doesn't have.",
        hints: ["git log A..B shows commits in B but not in A.", "cd ~/kestrel-api\ngit fetch\ngit log --oneline feature/rate-limit..origin/main"],
        check: function (r) { var k = idxOf(r, /git\s+fetch|git\s+pull/); if (k < 0) return "Fetch first: git fetch."; return r.history.some(function (e, i) { return i > k && /git\s+log/.test(e.cmd) && outHas(e, /Raise the timeout/) && outHas(e, /Document the endpoints/) && !outHas(e, /Add rate limiter/); }) ? true : "Show only what origin/main has that your branch lacks: git log --oneline feature/rate-limit..origin/main"; }
      },
      {
        id: "rebase", text: "Rebase <code>feature/rate-limit</code> onto <code>origin/main</code>, resolving the conflict so both changes survive (rate limit 100 <b>and</b> timeout 60).",
        hints: ["git rebase origin/main stops at the conflict in app/config.py. Edit it to RATE_LIMIT = 100 and TIMEOUT = 60, git add, git rebase --continue.", "git rebase origin/main\nprintf 'RATE_LIMIT = 100\\nTIMEOUT = 60\\nDEBUG = False\\n' > app/config.py\ngit add app/config.py\ngit rebase --continue"],
        check: function (r) {
          var v = repo(r, "kestrel-api");
          if (v.bisecting() || r.exists(HOME + "/kestrel-api/.git/rebase-merge")) return "A rebase is still in progress (git status).";
          var base = tip(r, "kestrel/kestrel-api", "main");
          if (!v.isAncestor(base, "feature/rate-limit")) return "feature/rate-limit doesn't contain the latest origin/main yet: git rebase origin/main.";
          if (v.log("feature/rate-limit", true).some(function (c) { return c.parents.length > 1; })) return "There's a merge commit on the branch: rebase instead of merging, for a straight history.";
          var cfg = v.file("feature/rate-limit", "app/config.py") || "";
          if (!/^RATE_LIMIT = 100$/m.test(cfg) || !/^TIMEOUT = 60$/m.test(cfg) || /^(<{7}|>{7}|={7})/m.test(cfg)) return "app/config.py on your branch should have RATE_LIMIT = 100 and TIMEOUT = 60 (and no conflict markers).";
          return true;
        }
      },
      {
        id: "squash", text: "With an interactive rebase, fold the <i>fix typo</i> commit into <i>Add rate limiter</i>, so the branch has exactly two commits: <i>Add rate limiter</i>, then <i>Add tests for limiter</i>.",
        hints: ["git rebase -i origin/main, then in .git/rebase-merge/git-rebase-todo change pick to fixup on the 'fix typo' line. Save, git rebase --continue.", "git rebase -i origin/main\nsed -i 's/^pick \\([0-9a-f]*\\) fix typo/fixup \\1 fix typo/' .git/rebase-merge/git-rebase-todo\ngit rebase --continue"],
        check: function (r) {
          var v = repo(r, "kestrel-api"), base = tip(r, "kestrel/kestrel-api", "main");
          if (r.exists(HOME + "/kestrel-api/.git/rebase-merge")) return "Finish the rebase (git rebase --continue).";
          var subs = featureSubjects(v, base);
          if (subs.join("|") !== "Add tests for limiter|Add rate limiter") return "The branch should have exactly: Add rate limiter, then Add tests for limiter (it has " + JSON.stringify(subs.slice().reverse()) + ").";
          return /RATE_LIMIT\b(?!_)/.test(v.file("feature/rate-limit", "app/api.py") || "") && !/RATE_LIMT/.test(v.file("feature/rate-limit", "app/api.py") || "") ? true : "The typo fix got lost: app/api.py should say config.RATE_LIMIT. Use fixup, not drop.";
        }
      },
      {
        id: "push", text: "Update the branch on GitHub. A plain push is refused: use the <b>safe</b> force.",
        hints: ["--force-with-lease checks nobody else pushed first.", "git push --force-with-lease"],
        check: function (r) {
          var v = repo(r, "kestrel-api");
          if (tip(r, "kestrel/kestrel-api", "feature/rate-limit") !== v.sha("feature/rate-limit")) return "GitHub's feature/rate-limit isn't your rebased branch yet.";
          if (ran(r, /git\s+push\b.*(\s-f\b|--force(?!-with-lease))/)) return "That worked, but with plain --force: use --force-with-lease, which refuses if someone else pushed. Reset and redo it.";
          return (r.sys.pushLog || []).some(function (p) { return p.ref === "refs/heads/feature/rate-limit" && p.lease; }) ? true : "Push with --force-with-lease.";
        }
      }
    ],
    solution: lines("cd ~/kestrel-api", "git fetch", "git log --oneline feature/rate-limit..origin/main", "git rebase origin/main",
      "printf 'RATE_LIMIT = 100\\nTIMEOUT = 60\\nDEBUG = False\\n' > app/config.py", "git add app/config.py", "git rebase --continue",
      "git rebase -i origin/main", "sed -i 's/^pick \\([0-9a-f]*\\) fix typo/fixup \\1 fix typo/' .git/rebase-merge/git-rebase-todo", "git rebase --continue",
      "git log --oneline -3", "git push", "git push --force-with-lease"),
    debrief: "<p>Your branch now looks as if you'd written it this morning on top of the newest main: two clean commits, the conflict resolved once, no merge noise. The reviewer sees exactly the change and nothing else.</p><p><code>--force-with-lease</code> was needed because rebasing creates new commits, and it's the only force you should use: it's a force push that checks first. Next: contributing to a project you don't own.</p>",
    realworld: "Set it once on your machine: git config --global pull.rebase true and git config --global rebase.autosquash true. Many teams also enable \"Require linear history\" on main.",
    quiz: [
      { q: "After a rebase, why is a normal <code>git push</code> rejected?", options: ["Rebase broke the branch", "The commits were rewritten (new IDs), so it's no longer a fast-forward", "GitHub blocks rebases", "You need to pull first"], answer: 1, why: "The old commits on GitHub aren't ancestors of the new ones." },
      { q: "<code>fixup</code> vs <code>squash</code> in an interactive rebase?", options: ["Same thing", "fixup drops the commit's message; squash keeps both", "squash deletes the commit", "fixup reorders"], answer: 1, why: "Both meld the commit into the previous one." },
      { q: "When is rebasing a bad idea?", options: ["On your own feature branch", "On a branch other people have based work on, like main", "Before opening a PR", "Never"], answer: 1, why: "Rewriting shared history breaks everyone else's copies." }
    ]
  });

  /* ================================================================== GT-115 Forks */
  function kiteWorld(sys) {
    world(sys);
    GH.user(sys, "ivan-k", { name: "Ivan Kowalski", email: "ivan@openkite.dev" });
    GH.org(sys, "openkite", { "ivan-k": "owner" }, { maintainers: ["ivan-k"] });
    GH.seed(sys, "openkite/kite-lint", { steps: [
      { msg: "kite-lint 0.9", by: { name: "Ivan Kowalski", email: "ivan@openkite.dev" }, at: "2026-09-01 12:00", files: { "README.md": "# kite-lint\n\nLint YAML deploy files.\n\nUsage: kite-lint [--quiet] FILE...\n", "kite_lint/cli.py": "import sys\n\ndef main(argv):\n    quiet = False\n    for f in argv:\n        print(\"checking\", f)\n    return 0\n", "CONTRIBUTING.md": "# Contributing\n\nFork the repo, make a branch, open a PR against main. Mention the issue number.\n" } },
      { msg: "Add version flag", by: { name: "Ivan Kowalski", email: "ivan@openkite.dev" }, at: "2026-09-20 12:00", files: { "kite_lint/version.py": "VERSION = \"0.9.1\"\n" } }
    ] }, { private: false, description: "A tiny linter for deploy files" });
    GH.issue(sys, "openkite/kite-lint", { n: 41, title: "--quiet flag is ignored", body: "Passing --quiet still prints 'checking FILE' for every file.", author: "ana-silva", labels: ["bug"] });
    var done = false;
    GH.on(sys, "clone", function (sys2, d) { if (done || d.repo.full !== "kc-dev/kite-lint") return; done = true; GH.commit(sys2, "openkite/kite-lint", "main", { name: "Ivan Kowalski", email: "ivan@openkite.dev" }, "Support Python 3.13", { "setup.cfg": "[metadata]\nname = kite-lint\npython_requires = >=3.9\n" }); });
    GH.on(sys, "pr.opened", function (sys2, d) { if (d.repo.full === "openkite/kite-lint") GH.comment(sys2, d.repo.full, d.pr.n, "ivan-k", "Thanks for the fix! I'll take a look this week."); });
  }
  LABS.push({
    id: "gt-115", n: 15, module: 2, ticket: "GT-115", xp: 150,
    title: "Forks",
    topic: "fork, upstream remote, keeping in sync",
    from: ANA,
    story: "<p>Kestrel's deploy pipeline uses <b>kite-lint</b>, an open-source tool by the OpenKite project. Its <code>--quiet</code> flag is broken (issue #41, reported by Ana). You can't push to their repository, so contribute the fix the open-source way: <b>fork</b>, keep your fork in sync, and send a pull request.</p>",
    learn:
      "<h3>Forks</h3><p>A fork is your own copy of someone else's repository, on GitHub, under your account. You push to your fork, then open a pull request from your fork into theirs (the <b>upstream</b>).</p>" +
      code("gh repo fork openkite/kite-lint --clone\ncd kite-lint\ngit remote -v") +
      "<p>With <code>--clone</code>, gh clones your fork and sets up two remotes: <code>origin</code> (your fork, where you push) and <code>upstream</code> (the original, where new work comes from).</p>" +
      "<h3>Staying in sync</h3><p>The upstream keeps moving. Before starting work, bring your <code>main</code> up to date and push it to your fork:</p>" +
      code("git fetch upstream\ngit switch main\ngit merge --ff-only upstream/main\ngit push origin main") +
      "<p>(<code>gh repo sync</code> does the same for the fork on GitHub.) Never commit on your fork's <code>main</code>: keep it a clean copy of upstream, and work on branches.</p>" +
      "<h3>The pull request</h3>" + code("git switch -c fix-quiet-flag\n# ...fix, commit...\ngit push -u origin fix-quiet-flag\ngh pr create --title \"...\" --body \"Fixes #41\"") +
      "<p>From a fork, gh opens the PR against the upstream repository (it asks once which one is the default; <code>gh repo set-default</code> changes it). Read the project's CONTRIBUTING file first: it says how they like PRs.</p>",
    system: kiteWorld,
    starter: "",
    objectives: [
      {
        id: "fork", text: "Fork <code>openkite/kite-lint</code> and clone your fork into <code>~/kite-lint</code>, with <code>origin</code> pointing at your fork and <code>upstream</code> at OpenKite's repository.",
        hints: ["gh repo fork with --clone sets up both remotes.", "cd ~\ngh repo fork openkite/kite-lint --clone"],
        check: function (r) {
          if (!gh(r, "kc-dev/kite-lint")) return "Fork it: gh repo fork openkite/kite-lint --clone";
          var v = repo(r, "kite-lint"); if (!v) return "Clone your fork into ~/kite-lint.";
          if (!urlIs(localRemote(v, "origin"), "kc-dev/kite-lint")) return "origin should point at your fork, kc-dev/kite-lint.";
          return urlIs(localRemote(v, "upstream"), "openkite/kite-lint") ? true : "Add the original as upstream: git remote add upstream https://github.com/openkite/kite-lint.git";
        }
      },
      {
        id: "sync", text: "OpenKite merged something new since you forked. Bring your local <code>main</code> up to date with <code>upstream/main</code> and push it to your fork.",
        hints: ["git fetch upstream, then fast-forward main to upstream/main, then git push origin main.", "git fetch upstream\ngit merge --ff-only upstream/main\ngit push origin main"],
        check: function (r) {
          var up = tip(r, "openkite/kite-lint", "main"), v = repo(r, "kite-lint");
          if (!v || v.sha("main") !== up) return "Your local main isn't the same as upstream/main (git fetch upstream, git merge --ff-only upstream/main).";
          return tip(r, "kc-dev/kite-lint", "main") === up ? true : "Push the updated main to your fork: git push origin main.";
        }
      },
      {
        id: "fix", text: "On a branch <code>fix-quiet-flag</code>, make <code>--quiet</code> work in <code>kite_lint/cli.py</code> (don't print for each file when it's given), commit, and push the branch to your fork.",
        hints: ["Something like: quiet = \"--quiet\" in argv, and only print when not quiet.", "git switch -c fix-quiet-flag\nsed -i 's/    quiet = False/    quiet = \"--quiet\" in argv/; s/        print(\"checking\", f)/        if not quiet:\\n            print(\"checking\", f)/' kite_lint/cli.py\ngit commit -am 'Honour --quiet'\ngit push -u origin fix-quiet-flag"],
        check: function (r) {
          var t = fileOn(r, "kc-dev/kite-lint", "fix-quiet-flag", "kite_lint/cli.py");
          if (t === null) return "Your fork doesn't have the fix-quiet-flag branch yet.";
          if (!/--quiet/.test(t) || !/if\s+not\s+quiet|if\s+quiet/.test(t)) return "cli.py on fix-quiet-flag should check for --quiet before printing.";
          return tip(r, "openkite/kite-lint", "fix-quiet-flag") ? "Push to your fork (origin), not to upstream." : true;
        }
      },
      {
        id: "pr", text: "Open a pull request from your fork's branch into <code>openkite/kite-lint</code>'s <code>main</code>, saying it fixes issue #41.",
        hints: ["From inside ~/kite-lint, gh pr create targets the upstream. Put \"Fixes #41\" in the body.", "gh pr create --title 'Make --quiet work' --body 'Fixes #41: skip the per-file output when --quiet is given.'"],
        check: function (r) {
          var p = prs(r, "openkite/kite-lint").filter(function (x) { return x.headRepo === "kc-dev/kite-lint" && x.head === "fix-quiet-flag"; })[0];
          if (!p) return "No pull request into openkite/kite-lint from kc-dev:fix-quiet-flag yet.";
          return /#41\b/.test(p.body + " " + p.title) ? true : "Mention the issue (Fixes #41) so it's linked.";
        }
      }
    ],
    solution: lines("cd ~", "gh repo fork openkite/kite-lint --clone", "cd kite-lint", "git remote -v", "git fetch upstream", "git merge --ff-only upstream/main", "git push origin main",
      "git switch -c fix-quiet-flag", "sed -i 's/    quiet = False/    quiet = \"--quiet\" in argv/; s/        print(\"checking\", f)/        if not quiet:\\n            print(\"checking\", f)/' kite_lint/cli.py",
      "git commit -am 'Honour --quiet'", "git push -u origin fix-quiet-flag", "gh pr create --title 'Make --quiet work' --body 'Fixes #41: skip the per-file output when --quiet is given.'"),
    debrief: "<p>Your fix is waiting in OpenKite's queue, and Ivan has already said thanks. The two-remote setup is the whole trick: <code>upstream</code> is where truth comes from, <code>origin</code> is your fork where you push, and <code>main</code> stays a clean mirror so every new branch starts from the latest upstream.</p><p>Next: issues, the to-do list that pull requests close.</p>",
    realworld: "Find a project you use, look for issues labelled good first issue, and contribute a fix the same way. Read CONTRIBUTING.md first: some projects want signed commits or a changelog entry.",
    quiz: [
      { q: "In a fork clone, where do you push your branch?", options: ["upstream", "origin (your fork)", "Both", "Nowhere: PRs are created locally"], answer: 1, why: "You can't push to upstream; your fork is yours." },
      { q: "Why keep your fork's main untouched?", options: ["GitHub requires it", "So it can always fast-forward to upstream and new branches start clean", "To save space", "main can't be pushed"], answer: 1, why: "Commits on main would make syncing a merge every time." },
      { q: "What does \"Fixes #41\" in the PR body do?", options: ["Nothing", "Links the PR to issue #41 and closes it when merged", "Assigns issue 41 to you", "Labels the PR"], answer: 1, why: "Closing keywords link and auto-close issues on merge into the default branch." }
    ]
  });

  /* ================================================================== GT-116 Issues */
  function issuesWorld(sys) {
    webWorld(sys, { clone: false });
    GH.find(sys, "kestrel/kestrel-web").protect = {};
    GH.issue(sys, "kestrel/kestrel-web", { n: 3, title: "Footer link to pricing 404s", body: "The footer links to /prices.html, which doesn't exist. It should be /pricing.html.", author: "ana-silva", labels: ["bug"], daysAgo: 5 });
    GH.issue(sys, "kestrel/kestrel-web", { n: 4, title: "Add a dark mode", body: "Several customers asked for one.", author: "ben-okoro", labels: ["enhancement"], daysAgo: 4 });
    GH.issue(sys, "kestrel/kestrel-web", { n: 5, title: "Broken pricing link in footer", body: "Clicking Pricing at the bottom gives a 404.", author: "maya-chen", labels: ["bug"], daysAgo: 2 });
    GH.issue(sys, "kestrel/kestrel-web", { n: 6, title: "Typo on the homepage", body: "\"Fast, friendly hosting\" is fine, but the about page says \"recieve\".", author: "maya-chen", labels: ["documentation"], daysAgo: 1 });
    GH.commit(sys, "kestrel/kestrel-web", "main", "maya", "Add footer", { "footer.html": "<footer><a href=\"/prices.html\">Pricing</a> · <a href=\"/status.html\">Status</a></footer>\n" }, G.clock(sys) - 86400 * 6);
    GH.cloneTo(sys, "kestrel/kestrel-web", HOME + "/kestrel-web");
    GH.on(sys, "pr.opened", function (sys2, d) { if (d.repo.full === "kestrel/kestrel-web") GH.review(sys2, d.repo.full, d.pr.n, "maya-chen", "APPROVED", "Thanks!"); });
  }
  LABS.push({
    id: "gt-116", n: 16, module: 2, ticket: "GT-116", xp: 140,
    title: "Issues",
    topic: "issues, labels, \"Closes #3\"",
    from: MAYA,
    story: "<p>The website's issue tracker needs some love: triage the bugs, close a duplicate, file a new bug you noticed, and fix the most-reported one so that merging the fix closes its issue automatically.</p>",
    learn:
      "<h3>Issues</h3><p>An issue is a tracked to-do: a bug, a feature request, a question. Each has a number shared with pull requests (#3, #7...), labels, assignees and a conversation.</p>" +
      code("gh issue list\ngh issue list --label bug\ngh issue view 3\ngh issue create --title \"...\" --body \"...\" --label bug --assignee @me") +
      "<h3>Closing</h3>" + code("gh issue close 5 --reason \"not planned\" --comment \"Duplicate of #3\"\ngh issue comment 4 --body \"...\"") +
      "<p>A duplicate or a won't-fix is closed as <b>not planned</b>; fixed work as <b>completed</b>.</p>" +
      "<h3>Let the fix close the issue</h3><p>Put a closing keyword in the pull request description (or a commit message) and GitHub closes the issue when the PR is merged into the default branch:</p>" +
      code("gh pr create --title \"Fix the pricing link\" --body \"Closes #3\"") +
      "<p>Keywords: <code>close</code>, <code>closes</code>, <code>closed</code>, <code>fix</code>, <code>fixes</code>, <code>fixed</code>, <code>resolve</code>, <code>resolves</code>, <code>resolved</code>, followed by <code>#N</code>. One keyword per issue: \"Fixes #3, #5\" only closes #3.</p>",
    system: issuesWorld,
    starter: "",
    objectives: [
      {
        id: "bugs", text: "List the open issues labelled <code>bug</code>.",
        hints: ["gh issue list has a --label filter. Run it inside ~/kestrel-web (or add -R kestrel/kestrel-web).", "cd ~/kestrel-web\ngh issue list --label bug"],
        check: function (r) { return ran(r, /gh\s+issue\s+list\b.*(--label|-l)\s*bug/, function (e) { return outHas(e, /^#3\s/) && outHas(e, /^#5\s/) && !outHas(e, /^#4\s/); }) ? true : "gh issue list --label bug"; }
      },
      {
        id: "dup", text: "#5 reports the same problem as #3. Close #5 as <b>not planned</b> with a comment pointing to #3.",
        hints: ["gh issue close with --reason and --comment.", "gh issue close 5 --reason \"not planned\" --comment \"Duplicate of #3\""],
        check: function (r) { var i = issue(r, "kestrel/kestrel-web", 5); if (i.state !== "closed") return "#5 is still open."; if (i.reason !== "not planned") return "Close it as not planned (--reason \"not planned\"): it wasn't fixed separately."; return i.comments.some(function (c) { return /#3\b/.test(c.body); }) ? true : "Leave a comment that mentions #3, so people find the original."; }
      },
      {
        id: "new", text: "File a new bug: the status page link in the footer points to a page that doesn't exist yet. Label it <code>bug</code> and assign it to yourself.",
        hints: ["gh issue create with --title, --body, --label bug and --assignee @me.", "gh issue create --title 'Footer links to a missing status page' --body 'footer.html links to /status.html, which does not exist yet.' --label bug --assignee @me"],
        check: function (r) { var x = gh(r, "kestrel/kestrel-web").items.filter(function (i) { return i.type === "issue" && i.author === "kc-dev"; })[0]; if (!x) return "Create the issue with gh issue create."; if (x.labels.indexOf("bug") < 0) return "Label it bug."; return x.assignees.indexOf("kc-dev") >= 0 ? true : "Assign it to yourself (--assignee @me)."; }
      },
      {
        id: "fix", text: "Fix #3 (the footer should link to <code>/pricing.html</code>) on a branch, open a pull request whose description closes #3, and merge it. Check that #3 got closed by the merge.",
        hints: ["Branch, sed the link, commit, push -u, gh pr create --body 'Closes #3', gh pr merge --squash --delete-branch, then gh issue view 3.", "git switch -c fix/pricing-link\nsed -i 's#/prices.html#/pricing.html#' footer.html\ngit commit -am 'Fix pricing link in footer'\ngit push -u origin fix/pricing-link\ngh pr create --title 'Fix pricing link in footer' --body 'Closes #3'\ngh pr merge --squash --delete-branch\ngh issue view 3"],
        check: function (r) {
          if (!/\/pricing\.html/.test(fileOn(r, "kestrel/kestrel-web", "main", "footer.html") || "")) return "main's footer.html still links to /prices.html.";
          var i = issue(r, "kestrel/kestrel-web", 3);
          if (i.state !== "closed") return "#3 is still open: merge a PR whose body says Closes #3.";
          if (!/^#\d+$/.test(i.closedBy || "")) return "#3 was closed by hand: let the pull request close it (Closes #3 in its description). Reset and redo.";
          return ran(r, /gh\s+issue\s+view\s+#?3\b/, function (e) { return outHas(e, /^Closed/); }) ? true : "Check it: gh issue view 3.";
        }
      }
    ],
    solution: lines("cd ~/kestrel-web", "gh issue list --label bug", "gh issue view 5", "gh issue close 5 --reason \"not planned\" --comment \"Duplicate of #3\"",
      "gh issue create --title 'Footer links to a missing status page' --body 'footer.html links to /status.html, which does not exist yet.' --label bug --assignee @me",
      "git switch -c fix/pricing-link", "sed -i 's#/prices.html#/pricing.html#' footer.html", "git commit -am 'Fix pricing link in footer'", "git push -u origin fix/pricing-link",
      "gh pr create --title 'Fix pricing link in footer' --body 'Closes #3'", "gh pr merge --squash --delete-branch", "gh issue view 3"),
    debrief: "<p>The tracker tells the truth again: one bug instead of two, a new one filed and owned, and #3 closed by the merge itself, with a link to the PR that fixed it. Anyone looking at #3 later can click through to the exact change.</p><p>Next: making sure <code>main</code> only changes through reviews, enforced by GitHub.</p>",
    realworld: "Templates make good issues: add .github/ISSUE_TEMPLATE/bug.yml to a repository and GitHub asks reporters for steps to reproduce, expected and actual behaviour.",
    quiz: [
      { q: "Which PR description closes issues #3 <b>and</b> #5 on merge?", options: ["Fixes #3, #5", "Fixes #3, fixes #5", "#3 #5", "Close #3-5"], answer: 1, why: "Each issue needs its own keyword." },
      { q: "When does \"Closes #3\" in a PR close the issue?", options: ["When the PR is opened", "When it's merged into the default branch", "When it's approved", "Never automatically"], answer: 1, why: "Only a merge into the default branch closes linked issues." },
      { q: "A duplicate issue should be closed as...", options: ["completed", "not planned", "deleted", "merged"], answer: 1, why: "Nothing was done for it specifically." }
    ]
  });

  /* ================================================================== GT-117 Protecting main */
  var PROTECTION = "{\n  \"required_status_checks\": null,\n  \"enforce_admins\": true,\n  \"required_pull_request_reviews\": {\n    \"required_approving_review_count\": 1,\n    \"require_code_owner_reviews\": true,\n    \"dismiss_stale_reviews\": true\n  },\n  \"restrictions\": null,\n  \"allow_force_pushes\": false,\n  \"allow_deletions\": false\n}\n";
  function protectWorld(sys) {
    world(sys);
    GH.seed(sys, "kestrel/kestrel-api", { steps: API.concat([{ msg: "Add login handler", by: "devp", at: "2026-10-10 10:00", files: { "app/auth/login.py": "def login(user, password):\n    return check(user, password)\n" } }]) }, { description: "The Kestrel API" });
    var r = GH.find(sys, "kestrel/kestrel-api"); r.collab["kc-dev"] = "admin";
    GH.cloneTo(sys, "kestrel/kestrel-api", HOME + "/kestrel-api");
    GH.on(sys, "pr.opened", function (sys2, d) { if (d.repo.full === "kestrel/kestrel-api" && d.pr.reviewers.indexOf("maya-chen") >= 0) GH.review(sys2, d.repo.full, d.pr.n, "maya-chen", "APPROVED", "LGTM"); });
    GH.on(sys, "pr.review_requested", function (sys2, d) { if (d.repo.full !== "kestrel/kestrel-api") return; if (d.reviewers.some(function (x) { return /security|dev-patel/.test(x); })) GH.review(sys2, d.repo.full, d.pr.n, "dev-patel", "APPROVED", "Auth change looks safe. Approved."); if (d.reviewers.indexOf("maya-chen") >= 0) GH.review(sys2, d.repo.full, d.pr.n, "maya-chen", "APPROVED", "LGTM"); });
    GH.on(sys, "pr.opened", function (sys2, d) { if (d.repo.full === "kestrel/kestrel-api" && d.pr.reviewers.some(function (x) { return /security|dev-patel/.test(x); })) GH.review(sys2, d.repo.full, d.pr.n, "dev-patel", "APPROVED", "Auth change looks safe. Approved."); });
  }
  LABS.push({
    id: "gt-117", n: 17, module: 2, ticket: "GT-117", xp: 160,
    title: "Protecting main",
    topic: "branch protection, CODEOWNERS",
    from: DEV,
    story: "<p>Last week someone pushed straight to <code>main</code> of <code>kestrel/kestrel-api</code> and broke login. You're an admin of that repository: make GitHub enforce the rules. Everything under <code>app/auth/</code> must be approved by the security team, everything else by any developer, and nobody, admins included, pushes to <code>main</code> directly.</p>",
    learn:
      "<h3>CODEOWNERS</h3><p>A file <code>.github/CODEOWNERS</code> on the default branch maps paths to the people or teams who must review changes to them. The <b>last</b> matching line wins:</p>" +
      code("*             @kestrel/devs\n/app/auth/    @kestrel/security") +
      "<h3>Branch protection</h3><p>Set in the repository's settings, or through the API. With gh, describe the rules in JSON and send it:</p>" + code(PROTECTION) +
      code("gh api -X PUT repos/kestrel/kestrel-api/branches/main/protection --input protection.json\ngh api repos/kestrel/kestrel-api/branches/main/protection") +
      '<table class="t"><tr><th>Setting</th><th>Effect</th></tr><tr><td><code>required_approving_review_count</code></td><td>approvals needed before merging (from people with write access, not the author)</td></tr><tr><td><code>require_code_owner_reviews</code></td><td>a code owner of every changed path must approve</td></tr><tr><td><code>dismiss_stale_reviews</code></td><td>new pushes reset earlier approvals</td></tr><tr><td><code>enforce_admins</code></td><td>admins follow the rules too (otherwise they bypass them)</td></tr><tr><td><code>allow_force_pushes</code>, <code>allow_deletions</code></td><td>false: history on main can\'t be rewritten or the branch deleted</td></tr></table>' +
      "<p>GitHub also has <b>rulesets</b>, a newer way to write the same rules for many branches or repositories at once.</p>" +
      "<h3>Asking a team for review</h3>" + code("gh pr edit --add-reviewer kestrel/security") +
      '<div class="callout">Add CODEOWNERS <b>before</b> turning on protection: after that, even that change has to go through a pull request.</div>',
    system: protectWorld,
    starter: "",
    objectives: [
      {
        id: "owners", text: "On <code>main</code>, add <code>.github/CODEOWNERS</code>: <code>@kestrel/devs</code> own everything, <code>@kestrel/security</code> own <code>/app/auth/</code>. Push it.",
        hints: ["Two lines; the more specific one last.", "cd ~/kestrel-api\nmkdir -p .github\nprintf '*             @kestrel/devs\\n/app/auth/    @kestrel/security\\n' > .github/CODEOWNERS\ngit add .github/CODEOWNERS\ngit commit -m 'Add CODEOWNERS'\ngit push"],
        check: function (r) {
          var t = fileOn(r, "kestrel/kestrel-api", "main", ".github/CODEOWNERS");
          if (t === null) return "GitHub's main doesn't have .github/CODEOWNERS yet.";
          var rules = GH.codeowners(r.sys, gh(r, "kestrel/kestrel-api"), "main");
          var last = function (p) { var o = null; rules.forEach(function (x) { if (x.pat === "*" || p.indexOf(x.pat.replace(/^\//, "")) === 0) o = x.owners.join(" "); }); return o; };
          if (last("app/auth/login.py") !== "@kestrel/security") return "app/auth/ should be owned by @kestrel/security (and that line must come after the * line).";
          return last("app/api.py") === "@kestrel/devs" ? true : "Everything else should be owned by @kestrel/devs (*).";
        }
      },
      {
        id: "protect", text: "Protect <code>main</code>: pull requests with 1 approval, code-owner review required, stale approvals dismissed, rules enforced for admins, no force pushes, no deletion. Then read the protection back.",
        hints: ["Write the JSON from the Learn tab to protection.json, then gh api -X PUT ... --input protection.json.", "gh api -X PUT repos/kestrel/kestrel-api/branches/main/protection --input protection.json\ngh api repos/kestrel/kestrel-api/branches/main/protection"],
        check: function (r) {
          var p = gh(r, "kestrel/kestrel-api").protect.main;
          if (!p) return "main isn't protected yet.";
          if (!p.pr || p.pr.count < 1 || !p.pr.codeowners || !p.pr.dismissStale) return "Require PR reviews: at least 1 approval, code owner reviews, and dismiss stale reviews.";
          if (!p.enforceAdmins) return "enforce_admins should be true: you're an admin, and the rules should apply to you too.";
          if (p.forcePush || p.deletions) return "Force pushes and deletion must stay off.";
          return ran(r, /gh\s+api\s.*branches\/main\/protection/, function (e) { return !/-X\s*(PUT|POST|DELETE|PATCH)|--method\s*(PUT|POST|DELETE|PATCH)|--input/.test(e.cmd) && outHas(e, /require_code_owner_reviews/); }) ? true : "Read it back: gh api repos/kestrel/kestrel-api/branches/main/protection";
        }
      },
      {
        id: "blocked", text: "Prove it: commit something on <code>main</code> locally and try to push it. It must be refused.",
        hints: ["Any commit; git push. Then undo it locally: git reset --hard origin/main.", "echo '# test' >> README.md\ngit commit -am 'Test protection'\ngit push\ngit reset --hard origin/main"],
        check: function (r) { return ran(r, /git\s+push/, function (e) { return outHas(e, /GH006: Protected branch update failed/); }) ? true : "Try a direct push to main after protecting it."; }
      },
      {
        id: "pr", text: "Change <code>app/auth/login.py</code> through a pull request (any small change, e.g. a comment) reviewed by <code>maya-chen</code>. See that it's still blocked, request a review from the security team, and merge once they approve. Leave your local <code>main</code> matching GitHub.",
        hints: ["gh pr view shows what the PR is waiting for. gh pr edit --add-reviewer kestrel/security.", "git switch -c auth-comment\necho '# Passwords are checked with bcrypt' >> app/auth/login.py\ngit commit -am 'Document password check'\ngit push -u origin auth-comment\ngh pr create --title 'Document password check' --body 'Comment only.' --reviewer maya-chen\ngh pr view\ngh pr edit --add-reviewer kestrel/security\ngh pr merge --squash --delete-branch"],
        check: function (r) {
          var p = prs(r, "kestrel/kestrel-api").filter(function (x) { return GH.prFiles(r.sys, gh(r, "kestrel/kestrel-api"), x).some(function (f) { return /^app\/auth\//.test(f); }); })[0];
          if (!p) return "Open a pull request that changes something in app/auth/.";
          if (!ran(r, /gh\s+pr\s+(view|merge|checks)/, function (e) { return outHas(e, /Waiting on code owner review from @kestrel\/security|code owner/); })) return "Look at what the PR waits for (gh pr view): Maya's approval isn't enough for app/auth/.";
          if (p.state !== "merged") return "Get @kestrel/security to review (gh pr edit --add-reviewer kestrel/security), then merge.";
          if (!p.reviews.some(function (x) { return x.by === "dev-patel" && x.state === "APPROVED"; })) return "The merge should include the security team's approval.";
          var v = repo(r, "kestrel-api");
          return v.sha("main") === tip(r, "kestrel/kestrel-api", "main") ? true : "Bring your local main up to date (git switch main && git pull).";
        }
      }
    ],
    solution: lines("cd ~/kestrel-api", "mkdir -p .github", "printf '*             @kestrel/devs\\n/app/auth/    @kestrel/security\\n' > .github/CODEOWNERS", "git add .github/CODEOWNERS", "git commit -m 'Add CODEOWNERS'", "git push",
      "printf '{\"required_status_checks\": null, \"enforce_admins\": true, \"required_pull_request_reviews\": {\"required_approving_review_count\": 1, \"require_code_owner_reviews\": true, \"dismiss_stale_reviews\": true}, \"restrictions\": null, \"allow_force_pushes\": false, \"allow_deletions\": false}\\n' > ~/protection.json",
      "gh api -X PUT repos/kestrel/kestrel-api/branches/main/protection --input ~/protection.json", "gh api repos/kestrel/kestrel-api/branches/main/protection",
      "echo '# test' >> README.md", "git commit -am 'Test protection'", "git push", "git reset --hard origin/main",
      "git switch -c auth-comment", "echo '# Passwords are checked with bcrypt' >> app/auth/login.py", "git commit -am 'Document password check'", "git push -u origin auth-comment",
      "gh pr create --title 'Document password check' --body 'Comment only.' --reviewer maya-chen", "gh pr view", "gh pr edit --add-reviewer kestrel/security", "gh pr merge --squash --delete-branch"),
    debrief: "<p>The rules are now GitHub's job, not people's memory. A direct push to main is refused for everyone, you included, and a change to the login code can't merge until the security team has looked at it, no matter who else approved.</p><p>Dismissing stale reviews closes a sneaky gap: without it, someone could get an approval and then push more commits that nobody reviewed. Last skill before the capstone: rescuing work with cherry-pick and the reflog.</p>",
    realworld: "In your own repositories: Settings → Branches (or Rules → Rulesets). Many organisations apply one ruleset to every repository, so a new repo is protected from day one.",
    quiz: [
      { q: "CODEOWNERS has <code>* @kestrel/devs</code> then <code>/app/auth/ @kestrel/security</code>. Who owns <code>app/auth/login.py</code>?", options: ["@kestrel/devs", "@kestrel/security", "Both teams", "Nobody"], answer: 1, why: "The last matching pattern wins." },
      { q: "Without <code>enforce_admins</code>, an admin's direct push to main...", options: ["is refused", "goes through, bypassing the rules", "needs a review", "is queued"], answer: 1, why: "Admins bypass protection unless it's enforced for them." },
      { q: "What does <i>dismiss stale reviews</i> prevent?", options: ["Old PRs staying open", "Merging commits pushed after the approval without re-review", "Reviews by the author", "Force pushes"], answer: 1, why: "A new push resets approvals." }
    ]
  });

  /* ================================================================== GT-118 Rescues */
  function shopWorld(sys) {
    world(sys);
    GH.seed(sys, "kestrel/kestrel-shop", { steps: [
      { msg: "Shop 1.3", by: "ben", at: "2026-09-10 10:00", files: { "cart.py": "def total(items):\n    return sum(i.price for i in items)\n", "vat.py": "def vat(amount):\n    return round(amount * 0.2)\n", "README.md": "# kestrel-shop\n" } },
      { msg: "Prepare 1.4", by: "ben", at: "2026-09-25 10:00", files: { "VERSION": "1.4\n" } },
      { branch: "release/1.4", from: "main" },
      { checkout: "main" },
      { msg: "Add coupons model", by: "ana", at: "2026-10-05 10:00", files: { "coupons.py": "COUPONS = {}\n" } },
      { msg: "Fix VAT rounding", by: "maya", at: "2026-10-12 16:00", files: { "vat.py": "from decimal import Decimal, ROUND_HALF_UP\n\ndef vat(amount):\n    return (Decimal(amount) * Decimal(\"0.2\")).quantize(Decimal(\"0.01\"), ROUND_HALF_UP)\n" } },
      { msg: "Start new checkout page", by: "ben", at: "2026-10-20 10:00", files: { "checkout.py": "def checkout(cart):\n    pass\n" } }
    ] }, { description: "The Kestrel shop" });
    GH.cloneTo(sys, "kestrel/kestrel-shop", HOME + "/kestrel-shop");
    GH.runAs(sys, HOME + "/kestrel-shop", [
      "git switch -q -c experiment/new-cart", "echo 'def total(items, coupons=()):' > cart2.py", "git add cart2.py", "git commit -qm 'Try a coupon-aware cart'", "echo '    return 0' >> cart2.py", "git commit -qam 'Cart: stub total'",
      "git switch -q main", "git branch -D experiment/new-cart",
      "git switch -q -c feature/coupons", "echo 'COUPONS[\"WELCOME10\"] = 10' >> coupons.py", "git commit -qam 'Add WELCOME10 coupon'", "echo 'COUPONS[\"SPRING15\"] = 15' >> coupons.py", "git commit -qam 'Add SPRING15 coupon'",
      "git reset -q --hard HEAD~2", "git switch -q main"
    ]);
  }
  function origTip(r, branch) {
    var c = r.run("");
    var lr = G.findRepo(c.sys, HOME + "/kestrel-shop");
    if (branch === "experiment/new-cart") { var hl = G.reflog(lr, "HEAD").filter(function (e) { return /Cart: stub total/.test(e.msg); })[0]; return hl ? hl.sha : null; }
    var fl = G.reflog(lr, "refs/heads/feature/coupons").filter(function (e) { return /SPRING15/.test(e.msg); })[0];
    return fl ? fl.sha : null;
  }
  LABS.push({
    id: "gt-118", n: 18, module: 2, ticket: "GT-118", xp: 150,
    title: "Rescues",
    topic: "cherry-pick and reflog",
    from: BEN,
    story: "<p>Three requests in <code>~/kestrel-shop</code>. Release 1.4 needs Maya's VAT rounding fix from <code>main</code>, but none of the half-finished features. And Ben, in a hurry yesterday, deleted his <code>experiment/new-cart</code> branch and did a <code>git reset --hard</code> that threw away his two coupon commits on <code>feature/coupons</code>. Get it all back.</p>",
    learn:
      "<h3>cherry-pick: copy one commit</h3>" + code("git switch release/1.4\ngit cherry-pick -x SHA") +
      "<p>Applies the change from one commit onto your current branch as a new commit. <code>-x</code> adds \"(cherry picked from commit ...)\" to the message, so people can trace it. Find the commit first: <code>git log --oneline --grep VAT main</code>.</p>" +
      "<h3>The reflog: Git's undo history</h3><p>Every time a branch or HEAD moves (commit, reset, switch, rebase, delete), Git writes it down in the <b>reflog</b>, local to your machine and kept for about 90 days. \"Lost\" commits are almost never gone:</p>" +
      code("git reflog                       # where HEAD has been\ngit reflog show feature/coupons   # where one branch has been") +
      "<p>Entries look like <code>a1b2c3d HEAD@{3}: reset: moving to HEAD~2</code>. To bring something back, point a branch at the old commit:</p>" +
      code("git branch experiment/new-cart a1b2c3d\ngit switch feature/coupons && git reset --hard feature/coupons@{1}") +
      "<p><code>branch@{1}</code> means \"where this branch was one move ago\". After a reset, <code>ORIG_HEAD</code> also remembers the previous position.</p>" +
      '<div class="callout">The reflog is only on your laptop: commits you never pushed and deleted on a fresh clone are really gone. Push early, even to a work-in-progress branch.</div>',
    system: shopWorld,
    starter: "",
    objectives: [
      {
        id: "pick", text: "Copy the <i>Fix VAT rounding</i> commit from <code>main</code> onto <code>release/1.4</code> (with a reference to the original), and push <code>release/1.4</code>.",
        hints: ["git log --oneline --grep VAT main finds it. git switch release/1.4, git cherry-pick -x SHA, git push.", "cd ~/kestrel-shop\ngit log --oneline --grep VAT main\ngit switch release/1.4\ngit cherry-pick -x $(git log --format=%h --grep 'Fix VAT' -1 main)\ngit push"],
        check: function (r) {
          var t = fileOn(r, "kestrel/kestrel-shop", "release/1.4", "vat.py") || "";
          if (!/ROUND_HALF_UP/.test(t)) return "GitHub's release/1.4 doesn't have the VAT fix yet.";
          if (fileOn(r, "kestrel/kestrel-shop", "release/1.4", "coupons.py") !== null || fileOn(r, "kestrel/kestrel-shop", "release/1.4", "checkout.py") !== null) return "release/1.4 got more than the VAT fix (coupons or checkout came along). Cherry-pick just that one commit, don't merge main.";
          var s = tip(r, "kestrel/kestrel-shop", "release/1.4"), m = G.commitOf(r.sys, s).message;
          return /cherry picked from commit [0-9a-f]{40}/.test(m) ? true : "Use cherry-pick -x so the commit says where it came from.";
        }
      },
      {
        id: "branch", text: "Bring back the deleted branch <code>experiment/new-cart</code> exactly as it was (both its commits).",
        hints: ["git reflog shows HEAD's moves; find the 'Cart: stub total' commit.", "git reflog | grep 'Cart: stub total'\ngit branch experiment/new-cart SHA"],
        check: function (r) { var v = repo(r, "kestrel-shop"), want = origTip(r, "experiment/new-cart"); return v.sha("experiment/new-cart") === want ? true : v.sha("experiment/new-cart") ? "experiment/new-cart exists but doesn't point at its last commit (Cart: stub total)." : "There's no experiment/new-cart branch yet."; }
      },
      {
        id: "reset", text: "Undo Ben's <code>git reset --hard</code>: <code>feature/coupons</code> should have its two coupon commits back.",
        hints: ["git reflog show feature/coupons, or feature/coupons@{1}.", "git switch feature/coupons\ngit reset --hard feature/coupons@{1}"],
        check: function (r) { var v = repo(r, "kestrel-shop"), want = origTip(r, "feature/coupons"); return v.sha("feature/coupons") === want ? true : "feature/coupons should point at 'Add SPRING15 coupon' again."; }
      }
    ],
    solution: lines("cd ~/kestrel-shop", "git log --oneline --grep VAT main", "git switch release/1.4", "git cherry-pick -x $(git log --format=%h --grep 'Fix VAT' -1 main)", "git push",
      "git reflog", "git branch experiment/new-cart $(git reflog | grep 'commit: Cart: stub total' | head -1 | cut -d' ' -f1)",
      "git reflog show feature/coupons", "git switch feature/coupons", "git reset --hard feature/coupons@{1}", "git log --oneline -3"),
    debrief: "<p>Release 1.4 got exactly one commit from main, labelled with where it came from, and Ben has both of his \"lost\" branches back. Nothing was really lost: the reflog had every position those branches had been at.</p><p>One ticket left in this module: the capstone, a feature from issue to merged pull request.</p>",
    realworld: "Next time something \"disappears\" in Git, run git reflog before anything else. It's the first thing experienced engineers check.",
    quiz: [
      { q: "You need one bug fix from main on a release branch. Best tool?", options: ["git merge main", "git cherry-pick -x SHA", "git rebase main", "Copy the file by hand"], answer: 1, why: "cherry-pick copies just that commit; merging would bring everything else." },
      { q: "What does <code>feature/coupons@{1}</code> mean?", options: ["The first commit of the branch", "Where the branch pointed one move ago (from its reflog)", "The parent commit", "The remote branch"], answer: 1, why: "@{n} reads the branch's reflog." },
      { q: "Is the reflog shared when you push?", options: ["Yes", "No, it's local to your clone", "Only with --tags", "Only on GitHub Enterprise"], answer: 1, why: "It's your machine's history of moves." }
    ]
  });

  /* ================================================================== GT-119 Capstone: ship a feature through review */
  var ROBOTS = "User-agent: *\nDisallow: /admin\nDisallow: /tmp\n";
  function capWorld(sys) {
    webWorld(sys);
    GH.issue(sys, "kestrel/kestrel-web", { n: 8, title: "Add a robots.txt", body: "Search engines are indexing /admin and /tmp. Add a robots.txt at the root:\n\nUser-agent: *\nDisallow: /admin\nDisallow: /tmp", author: "maya-chen", labels: ["enhancement"], assignees: ["kc-dev"] });
    var bump = false;
    GH.on(sys, "pr.opened", function (sys2, d) {
      if (d.repo.full !== "kestrel/kestrel-web") return;
      var t = G.commitFlat(sys2, GH.prHeadSha(sys2, d.repo, d.pr))["robots.txt"], txt = t ? G.blobText(sys2, t.sha) : "";
      if (/Disallow: \/tmp/.test(txt) && /Disallow: \/admin/.test(txt)) GH.review(sys2, d.repo.full, d.pr.n, "maya-chen", "APPROVED", "Great, thanks!");
      else GH.review(sys2, d.repo.full, d.pr.n, "maya-chen", "CHANGES_REQUESTED", "Close! The issue asks to block /tmp as well as /admin.");
      if (!bump) { bump = true; GH.commit(sys2, "kestrel/kestrel-web", "main", "ben", "Update homepage tagline", { "index.html": "<!DOCTYPE html>\n<html>\n<head><title>Kestrel Cloud</title></head>\n<body>\n<h1>Kestrel Cloud</h1>\n<p>Fast, friendly, secure hosting.</p>\n</body>\n</html>\n" }); }
    });
    GH.on(sys, "pr.synchronize", function (sys2, d) {
      if (d.repo.full !== "kestrel/kestrel-web") return;
      var t = G.commitFlat(sys2, d.after)["robots.txt"], txt = t ? G.blobText(sys2, t.sha) : "";
      if (/Disallow: \/tmp/.test(txt) && /Disallow: \/admin/.test(txt)) GH.review(sys2, d.repo.full, d.pr.n, "maya-chen", "APPROVED", "Great, thanks!");
    });
  }
  LABS.push({
    id: "gt-119", n: 19, module: 2, ticket: "GT-119", xp: 250, capstone: true,
    title: "Ship a feature through review",
    topic: "Module 2 capstone",
    from: MAYA,
    story: "<p>Issue #8 on <code>kestrel/kestrel-web</code> is assigned to you: search engines are indexing pages they shouldn't. Ship it the way the team works. <code>main</code> is protected (one approval), Maya reviews, and the team keeps a <b>straight history</b>: rebase your branch on the latest <code>main</code> right before merging.</p>" +
      '<table class="t"><tr><th>Done means</th></tr><tr><td><code>robots.txt</code> on <code>main</code> blocks <code>/admin</code> and <code>/tmp</code> for every crawler</td></tr><tr><td>it got there through a pull request approved by Maya, which closed #8 when it merged</td></tr><tr><td>the PR branch contained the latest <code>main</code> when it was merged, and it was squash-merged</td></tr><tr><td>no leftover branch on GitHub, and your local <code>main</code> matches GitHub\'s</td></tr></table>',
    learn: "<p>Everything from this module, in order: read the issue (<code>gh issue view 8</code>), branch, commit, push, open a PR that closes the issue, address the review, rebase on the newest <code>main</code> and update the branch safely, merge, clean up.</p>",
    system: capWorld,
    starter: "",
    objectives: [
      {
        id: "file", hints: [], text: "<code>robots.txt</code> on GitHub's <code>main</code> blocks <code>/admin</code> and <code>/tmp</code> for every crawler.",
        check: function (r) { var t = fileOn(r, "kestrel/kestrel-web", "main", "robots.txt"); if (t === null) return "main has no robots.txt yet."; return /^User-agent:\s*\*\s*$/mi.test(t) && /^Disallow:\s*\/admin\/?\s*$/mi.test(t) && /^Disallow:\s*\/tmp\/?\s*$/mi.test(t) ? true : "robots.txt should have User-agent: * and Disallow lines for /admin and /tmp."; }
      },
      {
        id: "review", hints: [], text: "It arrived through a pull request that Maya approved, and the merge closed issue #8.",
        check: function (r) {
          var p = prs(r, "kestrel/kestrel-web").filter(function (x) { return x.state === "merged" && GH.prFiles(r.sys, gh(r, "kestrel/kestrel-web"), x).indexOf("robots.txt") >= 0; })[0];
          if (!p) return "No merged pull request adds robots.txt yet.";
          if (GH.latestReviews(r.sys, gh(r, "kestrel/kestrel-web"), p)["maya-chen"] !== "APPROVED") return "The merged PR should carry Maya's approval.";
          var i = issue(r, "kestrel/kestrel-web", 8);
          return i.state === "closed" && /^#\d+$/.test(i.closedBy || "") ? true : "Issue #8 should be closed by the pull request (a closing keyword in its description).";
        }
      },
      {
        id: "linear", hints: [], text: "The branch contained the latest <code>main</code> when it was merged, and it was squash-merged.",
        check: function (r) {
          var p = prs(r, "kestrel/kestrel-web").filter(function (x) { return x.state === "merged" && GH.prFiles(r.sys, gh(r, "kestrel/kestrel-web"), x).indexOf("robots.txt") >= 0; })[0];
          if (!p) return "Merge the pull request first.";
          if (p.method !== "squash") return "Squash-merge it.";
          var parent = G.commitOf(r.sys, p.mergedSha).parents[0], head = p.lastHead;
          return G.isAncestor(r.sys, parent, head) ? true : "When you merged, the branch didn't contain Ben's newest commit on main: fetch, rebase onto origin/main, push --force-with-lease, then merge.";
        }
      },
      {
        id: "tidy", hints: [], text: "No leftover branch on GitHub, and your local <code>main</code> matches GitHub's.",
        check: function (r) {
          if (!prs(r, "kestrel/kestrel-web").some(function (p) { return p.state === "merged"; })) return "Ship the pull request first.";
          var x = gh(r, "kestrel/kestrel-web"), extra = Object.keys(x.refs).filter(function (k) { return /^refs\/heads\//.test(k) && k !== "refs/heads/main"; });
          if (extra.length) return "Still on GitHub: " + extra.map(function (k) { return k.slice(11); }).join(", ") + ".";
          var v = repo(r, "kestrel-web");
          return v && v.sha("main") === tip(r, "kestrel/kestrel-web", "main") ? true : "Your local main should match GitHub's (git switch main && git pull).";
        }
      }
    ],
    solution: lines("cd ~/kestrel-web", "gh issue view 8", "git switch -c feature/robots-txt", "printf 'User-agent: *\\nDisallow: /admin\\n' > robots.txt", "git add robots.txt", "git commit -m 'Add robots.txt'", "git push -u origin feature/robots-txt",
      "gh pr create --title 'Add robots.txt' --body 'Closes #8' --reviewer maya-chen", "gh pr view --comments",
      "echo 'Disallow: /tmp' >> robots.txt", "git commit -am 'Block /tmp too'", "git fetch", "git rebase origin/main", "git push --force-with-lease",
      "gh pr view", "gh pr merge --squash --delete-branch", "git log --oneline -3", "git status"),
    debrief: "<p><b>Module 2 complete.</b> From an issue to a reviewed, rebased, squash-merged change that closed its issue, with nothing left behind. That's a normal day on most engineering teams, and you did all of it from the terminal.</p>" +
      "<p>Module 3 makes GitHub do work for you: <b>GitHub Actions</b> run tests and checks on every push and pull request, so the review starts from \"the robots agree it works\".</p>",
    realworld: "This exact loop works on any GitHub repository. gh pr create --fill --reviewer @me-friend and gh pr merge --auto --squash (merge as soon as checks and reviews pass) save even more time.",
    quiz: []
  });

  LABS.forEach(function (l) { l.drills = []; T.LABS.push(l); });
  T.UPCOMING = T.UPCOMING.filter(function (row) { return row.module !== 2; });
})();
