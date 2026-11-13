/* sudo learn — Git & GitHub track, Module 3: Workflows & GitHub Actions (GT-120..127). Team workflows and
   releases, then GitHub Actions on the simulated GitHub (actions.js): workflow files, matrix builds and caching,
   triggers, secrets and environments, release pipelines, and debugging failed runs. Checks read GitHub's state:
   workflow files on branches, runs, jobs and their logs, deployments recorded by Kestrel's deploy service. */
(function () {
  "use strict";
  var G = window.GitCore, GL = window.GitLab, GH = window.GitHub, A = window.GitActions, T = window.GIT_TRACK, M2 = T.M2;
  var ex = T.ex, code = T.code, lines = T.lines;
  var MAYA = "Maya Chen · SRE lead", DEV = "Dev Patel · Security", BEN = "Ben Okoro · Developer", ANA = "Ana Silva · Developer";
  var HOME = "/home/dev";
  var LABS = [];

  /* ---------------- helpers */
  function sol() {
    var out = [];
    Array.prototype.slice.call(arguments).forEach(function (x) {
      if (typeof x === "string") out.push(x);
      else { out.push("nano " + x.nano); x.text.replace(/\n$/, "").split("\n").forEach(function (l) { out.push("    " + l); }); }
    });
    return out.join("\n");
  }
  function repo(r, name) { return GL.H.repo(r, name); }
  function ran(r, re, fn) { return r.history.some(function (e) { return re.test(e.cmd) && (!fn || fn(e)); }); }
  function all(e) { return e.out.concat(e.err); }
  function outHas(e, re) { return all(e).some(function (l) { return re.test(l); }); }
  function gh(r, full) { return GH.find(r.sys, full); }
  function tip(r, full, b) { var x = gh(r, full); return x ? x.refs["refs/heads/" + b] || null : null; }
  function fileOn(r, full, b, p) { var s = tip(r, full, b); if (!s) return null; var f = G.commitFlat(r.sys, s)[p]; return f ? G.blobText(r.sys, f.sha) : null; }
  function prs(r, full) { var x = gh(r, full); return x ? x.items.filter(function (i) { return i.type === "pr"; }) : []; }
  function runs(r, full, f) { var x = gh(r, full); return x ? x.runs.filter(f || function () { return true; }).sort(function (a, b) { return b.id - a.id; }) : []; }
  function logOf(j) { return j.steps.map(function (s) { return s.log.map(function (l) { return l.text; }).join("\n"); }).join("\n"); }
  function ok(j) { return j.status === "completed" && j.conclusion === "success"; }
  // the workflows on a branch (or at a commit), parsed
  function wfsOn(r, full, ref) { var x = gh(r, full); if (!x) return []; var s = x.refs["refs/heads/" + ref] || x.refs["refs/tags/" + ref] || (/^[0-9a-f]{40}$/.test(ref) ? ref : null); return s ? A.workflowsAt(r.sys, G.peel(r.sys, s)) : []; }
  function wfText(w) { return w ? w.text : ""; }
  function steps(job) { return job && Array.isArray(job.steps) ? job.steps : []; }
  function usesStep(job, re) { return steps(job).some(function (s) { return s && s.uses && re.test(String(s.uses)); }); }
  function runStep(job, re) { return steps(job).some(function (s) { return s && s.run !== undefined && re.test(String(s.run)); }); }
  function jobsOf(w) { return w && w.doc && w.doc.jobs && typeof w.doc.jobs === "object" ? w.doc.jobs : {}; }
  function anyJob(w, fn) { var js = jobsOf(w); return Object.keys(js).some(function (k) { return fn(js[k], k); }); }
  function world(sys, o) { M2.world(sys, o); }
  // Maya approves a pull request once all of its checks are green (and asks for changes when CI is red)
  function mayaReviewsWhenGreen(sys, full) {
    var seen = {};
    GH.on(sys, "run.completed", function (s2, d) {
      if (d.repo.full !== full || !d.run.pr) return;
      var pr = GH.item(d.repo, d.run.pr); if (!pr || pr.state !== "open") return;
      var head = GH.prHeadSha(s2, d.repo, pr), cs = GH.prChecks(s2, d.repo, pr);
      if (!cs.length || cs.some(function (c) { return c.status !== "completed"; })) return;
      var green = cs.every(function (c) { return c.conclusion === "success" || c.conclusion === "skipped"; });
      if (seen[head + green]) return; seen[head + green] = 1;
      if (green) GH.review(s2, full, pr.n, "maya-chen", "APPROVED", "CI is green and the change looks good. Approved.");
      else if (!seen[head + "commented"]) { seen[head + "commented"] = 1; GH.comment(s2, full, pr.n, "maya-chen", "CI is red on this one, I'll review once the checks pass."); }
    });
  }
  T.M3 = { sol: sol, runs: runs, logOf: logOf, wfsOn: wfsOn, gh: gh, tip: tip, fileOn: fileOn, prs: prs, ok: ok, world: world, mayaReviewsWhenGreen: mayaReviewsWhenGreen };

  /* ---------------- the Kestrel website: a Node project whose tests and build are Bash scripts */
  var WEB_PKG = { name: "kestrel-web", version: "2.3.0", private: true, description: "The Kestrel Cloud website", scripts: { test: "bash test/run.sh", build: "bash scripts/build.sh" }, engines: { node: ">=20" }, dependencies: { marked: "^14.1.0" }, devDependencies: { htmlhint: "^1.1.4" } };
  var WEB_TEST = "#!/bin/bash\n# Website checks: every page has a <title>, and every local link points at a page that exists.\nfail=0\nfor f in site/*.html; do\n  if ! grep -q '<title>' \"$f\"; then\n    echo \"not ok - $f has no <title>\"\n    fail=1\n    continue\n  fi\n  links=\"$(grep -o 'href=\"[^\"]*\"' \"$f\" | cut -d'\"' -f2)\"\n  while IFS= read -r link; do\n    case \"$link\" in ''|http*|'#'*) continue ;; esac\n    if [ ! -f \"site/$link\" ]; then\n      echo \"not ok - $f links to $link, which doesn't exist\"\n      fail=1\n    fi\n  done <<< \"$links\"\n  echo \"ok - $f\"\ndone\nif [ \"$fail\" -ne 0 ]; then exit 1; fi\necho \"all pages ok\"\n";
  var WEB_BUILD = "#!/bin/bash\n# Build the site into dist/\nset -e\nrm -rf dist\nmkdir -p dist\ncp site/*.html dist/\necho \"built $(ls dist | wc -l) pages into dist/\"\n";
  function page(title, body) { return "<!DOCTYPE html>\n<html>\n<head><title>" + title + "</title></head>\n<body>\n" + body + "\n</body>\n</html>\n"; }
  function webFiles(pkg) {
    pkg = pkg || WEB_PKG;
    return {
      "README.md": "# kestrel-web\n\nThe Kestrel Cloud website.\n\n    npm ci        # install dependencies\n    npm test      # check every page\n    npm run build # build into dist/\n",
      "package.json": JSON.stringify(pkg, null, 2) + "\n", "package-lock.json": A.lockFor(pkg),
      "test/run.sh": WEB_TEST, "scripts/build.sh": WEB_BUILD, ".gitignore": "node_modules/\ndist/\n",
      "site/index.html": page("Kestrel Cloud", "<h1>Kestrel Cloud</h1>\n<p>Fast, friendly hosting.</p>\n<a href=\"pricing.html\">Pricing</a>"),
      "site/pricing.html": page("Pricing", "<h1>Pricing</h1>\n<p>From 5 EUR a month.</p>\n<a href=\"index.html\">Home</a>")
    };
  }
  T.M3.webFiles = webFiles; T.M3.WEB_PKG = WEB_PKG; T.M3.page = page;
  function webWorld(o) {
    o = o || {};
    return function (sys) {
      world(sys);
      A.installNode(sys);
      var steps0 = [{ msg: "Kestrel website 2.3", by: "maya", at: "2026-10-01 10:00", files: webFiles(o.pkg), exec: ["test/run.sh", "scripts/build.sh"] }].concat(o.steps || []);
      GH.seed(sys, "kestrel/kestrel-web", { steps: steps0 }, { description: "The Kestrel Cloud website" });
      if (o.admin) GH.find(sys, "kestrel/kestrel-web").collab["kc-dev"] = "admin";
      if (o.before) o.before(sys);
      if (o.clone !== false) GH.cloneTo(sys, "kestrel/kestrel-web", HOME + "/kestrel-web");
      if (o.after) o.after(sys);
    };
  }
  T.M3.webWorld = webWorld;
  var CI_BASIC = "name: CI\n\non:\n  push:\n    branches: [main]\n  pull_request:\n\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n      - uses: actions/setup-node@v4\n        with:\n          node-version: 22\n      - run: npm ci\n      - run: npm test\n";
  T.M3.CI_BASIC = CI_BASIC;

  /* ================================================================== GT-120 Team workflows */
  var KC_V13 = "#!/bin/bash\n# kc: the Kestrel Cloud command-line tool\nhere=\"$(dirname \"$0\")\"\nVERSION=\"$(cat \"$here/../VERSION\")\"\n\n\n\n\n\n\n\n# ------------------------------------------------------------ commands\ncmd=\"${1:-help}\"\ncase \"$cmd\" in\n  version) echo \"kc $VERSION\" ;;\n  *) echo \"usage: kc version\" ;;\nesac\n";
  var KC_V14 = KC_V13.replace("\n\n\n\n\n\n\n\n# ----", "\n\n# deploy REGION: ship the current release to a region\ndeploy() {\n  region=\"$1\"\n  echo \"deploying kc $VERSION to ${region:?a region is required}\"\n}\n\n# ----").replace("  version) echo \"kc $VERSION\" ;;\n  *) echo \"usage: kc version\" ;;", "  version) echo \"kc $VERSION\" ;;\n  deploy) shift; deploy \"$@\" ;;\n  *) echo \"usage: kc version|deploy REGION\" ;;");
  var KC_FIX = KC_V14.replace("  region=\"$1\"\n  echo \"deploying kc $VERSION to ${region:?a region is required}\"", "  region=\"${1:-eu-west-1}\"\n  echo \"deploying kc $VERSION to $region\"");
  var KC_15A = KC_V14.replace("  deploy) shift; deploy \"$@\" ;;\n", "  deploy) shift; deploy \"$@\" ;;\n  status) shift; . \"$here/../lib/status.sh\" ;;\n");
  var KC_15B = KC_15A.replace("  region=\"$1\"\n  echo \"deploying kc $VERSION to ${region:?a region is required}\"", "  region=\"${1:-eu-west-1}\"\n  echo \"deploying kc $VERSION to $region\"");
  var KC_15C = KC_15B.replace("  status) shift;", "  logs) shift; . \"$here/../lib/logs.sh\" ;;\n  status) shift;");
  T.M3.KC = { V14: KC_V14, FIX: KC_FIX, V15: KC_15C };
  function cliSteps() {
    return [
      { msg: "kc 1.3.0", by: "maya", at: "2026-08-03 10:00", files: { "README.md": "# kc\n\nThe Kestrel Cloud command-line tool.\n", "bin/kc": KC_V13, "VERSION": "1.3.0\n", "CHANGELOG.md": "# Changelog\n\n## 1.3.0\n- kc version\n" }, exec: ["bin/kc"] },
      { tag: "v1.3.0", msg: "kc 1.3.0", by: "maya", at: "2026-08-03 10:05" },
      { msg: "feat: kc deploy REGION", by: "ben", at: "2026-09-02 15:00", files: { "bin/kc": KC_V14, "VERSION": "1.4.0\n", "CHANGELOG.md": "# Changelog\n\n## 1.4.0\n- kc deploy REGION\n\n## 1.3.0\n- kc version\n" } },
      { tag: "v1.4.0", msg: "kc 1.4.0", by: "maya", at: "2026-09-02 16:00" },
      { msg: "feat: kc status --json", by: "ana", at: "2026-10-20 11:00", files: { "bin/kc": KC_15A, "lib/status.sh": "# kc status [--json]\nif [ \"${1:-}\" = \"--json\" ]; then echo '{\"status\":\"ok\"}'; else echo \"all systems ok\"; fi\n" } },
      { msg: "fix: kc deploy crashes without a region", by: "ben", at: "2026-11-02 09:30", files: { "bin/kc": KC_15B } },
      { msg: "feat: kc logs --follow", by: "ana", at: "2026-11-05 14:00", files: { "bin/kc": KC_15C, "lib/logs.sh": "# kc logs [--follow]\necho \"(no logs yet)\"\n" } }
    ];
  }
  T.M3.cliSteps = cliSteps;
  function cliWorld(sys) {
    world(sys);
    GH.seed(sys, "kestrel/kestrel-cli", { steps: cliSteps() }, { description: "kc, the Kestrel Cloud CLI" });
    GH.find(sys, "kestrel/kestrel-cli").collab["kc-dev"] = "admin";
    GH.on(sys, "pr.opened", function (s2, d) { if (d.repo.full === "kestrel/kestrel-cli") GH.review(s2, d.repo.full, d.pr.n, "maya-chen", "APPROVED", "Nice, thanks!"); });
  }
  function fixSha(sys) { var r = GH.find(sys, "kestrel/kestrel-cli"), s = r.refs["refs/heads/main"]; while (s) { var co = G.commitOf(sys, s); if (/^fix: kc deploy crashes/.test(co.message)) return s; s = co.parents[0]; } return null; }
  var PR_TEMPLATE = "## What\n\n<!-- What does this change do? -->\n\n## Why\n\n<!-- Link the issue: Closes #123 -->\n\n## How to test\n\n<!-- Commands a reviewer can run -->\n";
  LABS.push({
    id: "gt-120", n: 20, module: 3, ticket: "GT-120", xp: 160,
    title: "Team workflows",
    topic: "GitHub flow, Conventional Commits, release branches",
    from: MAYA,
    story: "<p>The <code>kc</code> CLI (<code>kestrel/kestrel-cli</code>) grew from one person to five, and its history shows it: merge commits everywhere, branches nobody deleted, commit messages like <i>stuff</i>. We're agreeing on a team workflow. Set the repository up for it, and then use it for real: customers on <b>1.4</b> hit a crash that's already fixed on <code>main</code>, and they need a <b>1.4.1</b> today, without the unfinished 1.5 features. You're an admin on this repository.</p>",
    learn:
      "<h3>Three ways teams branch</h3>" +
      '<table class="t"><tr><th>Workflow</th><th>How it works</th><th>Fits</th></tr>' +
      "<tr><td><b>GitHub flow</b></td><td>One long-lived branch, <code>main</code>, always deployable. Every change: short branch → pull request → review + CI → merge → deploy.</td><td>Web apps and services that deploy continuously. Kestrel uses this.</td></tr>" +
      "<tr><td><b>Trunk-based</b></td><td>Like GitHub flow with even smaller, faster changes (hours, not days). Unfinished features hide behind <i>feature flags</i>.</td><td>Large teams with strong CI.</td></tr>" +
      "<tr><td><b>Git flow</b></td><td><code>develop</code>, <code>release/*</code>, <code>hotfix/*</code> and <code>main</code> branches.</td><td>Software shipped in versions (apps, libraries). Heavy for most web teams.</td></tr></table>" +
      "<p>Whatever the flow, teams that support old versions keep <b>release branches</b>: <code>release/1.4</code> starts at the <code>v1.4.0</code> tag, and fixes are <b>cherry-picked</b> onto it from <code>main</code>.</p>" +
      "<h3>Versions: SemVer</h3><p><code>MAJOR.MINOR.PATCH</code>, e.g. <code>1.4.1</code>: bump PATCH for fixes, MINOR for new features that don't break anything, MAJOR when something breaks for users. A release is an annotated tag: <code>git tag -a v1.4.1 -m \"kc 1.4.1\"</code>.</p>" +
      "<h3>Commit messages: Conventional Commits</h3>" + code("feat: kc status --json        # a new feature  → MINOR\nfix: kc deploy crashes ...     # a bug fix      → PATCH\ndocs: ..., chore: ..., ci: ..., test: ..., refactor: ...\nfeat!: drop the old config    # ! = breaking   → MAJOR") +
      "<p>Tools read these to write changelogs and pick the next version. With <b>squash merging</b>, the pull request title becomes the commit on <code>main</code>, so it's the title that has to follow the convention.</p>" +
      "<h3>Repository settings from the terminal</h3>" + code("gh repo edit --enable-merge-commit=false --enable-rebase-merge=false\ngh repo edit --enable-squash-merge --delete-branch-on-merge") +
      "<p>Squash-only gives one commit per pull request on <code>main</code>; deleting merged branches keeps the branch list honest.</p>" +
      "<h3>Pull request templates</h3><p>A Markdown file at <code>.github/pull_request_template.md</code> pre-fills every new pull request's description on GitHub, so authors answer the same questions every time.</p>" +
      "<h3>A hotfix release, step by step</h3>" + code("git log --oneline v1.4.0..main                 # what's on main since 1.4.0\ngit switch -c release/1.4 v1.4.0              # branch from the tag\ngit cherry-pick -x COMMIT                      # -x records where it came from\necho 1.4.1 > VERSION && git commit -am 'chore: release 1.4.1'\ngit tag -a v1.4.1 -m 'kc 1.4.1'\ngit push -u origin release/1.4 && git push origin v1.4.1"),
    system: cliWorld,
    starter: "",
    objectives: [
      {
        id: "settings", text: "Make <code>kestrel/kestrel-cli</code> <b>squash-merge only</b> (no merge commits, no rebase merges) and have GitHub <b>delete branches</b> once their pull request merges.",
        hints: ["gh repo edit takes --enable-merge-commit=false, --enable-rebase-merge=false and --delete-branch-on-merge.", "gh repo edit kestrel/kestrel-cli --enable-merge-commit=false --enable-rebase-merge=false --enable-squash-merge --delete-branch-on-merge"],
        check: function (r) { var s = gh(r, "kestrel/kestrel-cli").settings; if (s.mergeCommit) return "Merge commits are still allowed."; if (s.rebase) return "Rebase merges are still allowed."; if (!s.squash) return "Keep squash merging on: it's the one you want."; return s.deleteBranchOnMerge ? true : "Turn on deleting branches after merge (--delete-branch-on-merge)."; }
      },
      {
        id: "template", text: "Add a pull request template (<code>.github/pull_request_template.md</code>) with the headings <b>What</b>, <b>Why</b> and <b>How to test</b>. It reaches <code>main</code> through a squash-merged pull request whose title follows Conventional Commits (it's documentation, so <code>docs: ...</code>).",
        hints: ["Clone the repository, make a branch, create the file with nano (three ## headings), commit, push, gh pr create --title 'docs: ...', then gh pr merge --squash.", "git switch -c docs/pr-template\nmkdir -p .github\nnano .github/pull_request_template.md\ngit add .github && git commit -m 'docs: add a pull request template'\ngit push -u origin docs/pr-template\ngh pr create --title 'docs: add a pull request template' --body 'What / Why / How to test for every PR.'\ngh pr merge --squash"],
        check: function (r) {
          var t = fileOn(r, "kestrel/kestrel-cli", "main", ".github/pull_request_template.md") || fileOn(r, "kestrel/kestrel-cli", "main", ".github/PULL_REQUEST_TEMPLATE.md");
          if (t === null) return "main has no .github/pull_request_template.md yet.";
          var miss = ["What", "Why", "How to test"].filter(function (h) { return !new RegExp("^#+\\s*" + h + "\\s*$", "mi").test(t); });
          if (miss.length) return "The template needs a heading for: " + miss.join(", ") + " (e.g. ## " + miss[0] + ").";
          var p = prs(r, "kestrel/kestrel-cli").filter(function (x) { return x.state === "merged" && GH.prFiles(r.sys, gh(r, "kestrel/kestrel-cli"), x).some(function (f) { return /pull_request_template/i.test(f); }); })[0];
          if (!p) return "The template should reach main through a pull request.";
          if (p.method !== "squash") return "Squash-merge it.";
          return /^docs(\([\w-]+\))?!?: \S/.test(p.title) ? true : "Its title should follow Conventional Commits: docs: add a pull request template (lowercase type, colon, space).";
        }
      },
      {
        id: "hotfix", text: "Release <b>1.4.1</b>: a <code>release/1.4</code> branch on GitHub that starts at <code>v1.4.0</code> and adds only Ben's deploy fix (cherry-picked with <code>-x</code>) and a commit setting <code>VERSION</code> to <code>1.4.1</code>; an annotated tag <code>v1.4.1</code> on that commit, pushed.",
        hints: ["git log --oneline v1.4.0..main shows the fix. Branch release/1.4 from v1.4.0, cherry-pick -x it, update VERSION, commit, tag -a, push the branch and the tag.", "git switch -c release/1.4 v1.4.0\ngit cherry-pick -x COMMIT\necho 1.4.1 > VERSION\ngit commit -am 'chore: release 1.4.1'\ngit tag -a v1.4.1 -m 'kc 1.4.1'\ngit push -u origin release/1.4\ngit push origin v1.4.1"],
        check: function (r) {
          var x = gh(r, "kestrel/kestrel-cli"), b = x.refs["refs/heads/release/1.4"], fix = fixSha(r.sys);
          if (!b) return "GitHub has no release/1.4 branch yet.";
          var v140 = G.peel(r.sys, x.refs["refs/tags/v1.4.0"]);
          if (!G.isAncestor(r.sys, v140, b)) return "release/1.4 should start at the v1.4.0 tag.";
          var flat = G.commitFlat(r.sys, b), txt = flat["bin/kc"] ? G.blobText(r.sys, flat["bin/kc"].sha) : "";
          if (flat["lib/status.sh"] || flat["lib/logs.sh"]) return "release/1.4 contains 1.5 features (lib/status.sh or lib/logs.sh): it should only get the fix. Start again from v1.4.0.";
          if (txt !== KC_FIX) return "release/1.4's bin/kc should be 1.4.0 plus Ben's fix (fix: kc deploy crashes without a region).";
          var picked = Object.keys(G.ancestors(r.sys, b)).some(function (s) { return new RegExp("\\(cherry picked from commit " + fix + "\\)").test(G.commitOf(r.sys, s).message); });
          if (!picked) return "Cherry-pick the fix with -x, so its message records where it came from.";
          if (!flat.VERSION || G.blobText(r.sys, flat.VERSION.sha).trim() !== "1.4.1") return "Set VERSION to 1.4.1 on the release branch.";
          var t = x.refs["refs/tags/v1.4.1"];
          if (!t) return "Push the tag v1.4.1 (git push origin v1.4.1).";
          if (G.getObject(r.sys, t).type !== "tag") return "v1.4.1 should be an annotated tag (git tag -a v1.4.1 -m '...').";
          return G.peel(r.sys, t) === b ? true : "v1.4.1 should point at the tip of release/1.4 (the commit that sets VERSION).";
        }
      }
    ],
    solution: sol("git clone https://github.com/kestrel/kestrel-cli.git", "cd kestrel-cli",
      "gh repo edit --enable-merge-commit=false --enable-rebase-merge=false --enable-squash-merge --delete-branch-on-merge",
      "git switch -c docs/pr-template", "mkdir -p .github", { nano: ".github/pull_request_template.md", text: PR_TEMPLATE },
      "git add .github", "git commit -m 'docs: add a pull request template'", "git push -u origin docs/pr-template",
      "gh pr create --title 'docs: add a pull request template' --body 'Every pull request answers What / Why / How to test.'", "gh pr merge --squash",
      "git log --oneline v1.4.0..main", "git switch -c release/1.4 v1.4.0", "git cherry-pick -x $(git log --format=%h --grep 'crashes without a region' -1 main)",
      "echo 1.4.1 > VERSION", "git commit -am 'chore: release 1.4.1'", "git tag -a v1.4.1 -m 'kc 1.4.1'", "git push -u origin release/1.4", "git push origin v1.4.1", "git log --oneline --graph --all -8"),
    debrief: "<p>The repository now enforces the workflow instead of relying on memory: one squash commit per pull request, with a Conventional Commits title; branches cleaned up automatically; every pull request starts from the same questions.</p><p>And you shipped a patch release the way maintainers of real projects do: a release branch from the tag, a cherry-picked fix with its origin recorded, a version bump, an annotated tag. Customers on 1.4 get the fix without the unfinished 1.5 work. Next: make GitHub test every change for you.</p>",
    realworld: "Look at the releases page of any big open-source project (for example github.com/nodejs/node/releases): parallel release lines, each fed by cherry-picked fixes. Their commit messages and pull request titles follow a convention for the same reason yours now do.",
    quiz: [
      { q: "Version 2.7.3 gets a new optional flag, nothing breaks. The next version is…", options: ["2.7.4", "2.8.0", "3.0.0", "2.7.3-1"], answer: 1, why: "A new feature that breaks nothing bumps MINOR and resets PATCH." },
      { q: "Why branch release/1.4 from the v1.4.0 tag instead of from main?", options: ["Tags are faster", "main has unreleased 1.5 work that mustn't ship in 1.4.1", "Branches can't start at main", "GitHub requires it"], answer: 1, why: "The release branch must contain exactly 1.4.0 plus the chosen fixes." },
      { q: "With squash merging, what ends up as the commit message on main?", options: ["Every commit from the branch", "The pull request title (and description)", "The branch name", "Nothing"], answer: 1, why: "That's why the PR title is the one that must follow Conventional Commits." }
    ]
  });

  /* ================================================================== GT-121 Your first workflow */
  LABS.push({
    id: "gt-121", n: 21, module: 3, ticket: "GT-121", xp: 180,
    title: "Your first workflow",
    topic: "Actions YAML, jobs, steps, runs",
    from: BEN,
    story: "<p>Twice this month someone merged a page with a broken link into <code>kestrel/kestrel-web</code>. The site has tests (<code>npm test</code>), but nobody remembers to run them. Make GitHub run them on every pull request and every push to <code>main</code>. The repository is already cloned in <code>~/kestrel-web</code>, and Node is installed on your laptop.</p>",
    learn:
      "<h3>GitHub Actions in one picture</h3><p>A <b>workflow</b> is a YAML file in <code>.github/workflows/</code>. When an <b>event</b> happens (a push, a pull request...), GitHub starts a <b>run</b>: each <b>job</b> gets a fresh virtual machine (a <b>runner</b>), and runs its <b>steps</b> in order. A step either runs shell commands (<code>run:</code>) or uses a ready-made <b>action</b> (<code>uses:</code>).</p>" +
      code("name: CI                      # shown in the Actions tab and in gh run list\n\non:                           # which events start it\n  push:\n    branches: [main]\n  pull_request:\n\njobs:\n  test:                       # the job's id (and its name, unless you give it one)\n    runs-on: ubuntu-latest    # the runner\n    steps:\n      - uses: actions/checkout@v4      # get the repository's files onto the runner\n      - uses: actions/setup-node@v4    # install Node\n        with:\n          node-version: 22\n      - run: npm ci                    # install exactly what package-lock.json says\n      - run: npm test") +
      "<p>The runner starts empty: no code until <code>actions/checkout</code>. Every <code>run:</code> step is Bash with <code>-e</code>: the first failing command fails the step, the job, and the run.</p>" +
      "<h3>YAML rules that bite</h3><p>Indentation is structure: spaces only (no tabs), and a child is indented more than its parent. Lists start with <code>- </code>. In the editor, Tab inserts two spaces.</p>" +
      "<h3>Watching runs from the terminal</h3>" +
      '<table class="t"><tr><th>Command</th><th>Shows</th></tr><tr><td><code>gh run list</code></td><td>recent runs: status, workflow, branch, event, ID</td></tr><tr><td><code>gh run view ID</code></td><td>one run: its jobs, and the steps of failed jobs</td></tr><tr><td><code>gh run view ID --log</code></td><td>the full log (<code>--log-failed</code>: only failed steps)</td></tr><tr><td><code>gh run watch ID</code></td><td>follow a run until it finishes</td></tr><tr><td><code>gh pr checks</code></td><td>the checks on your pull request</td></tr></table>' +
      "<p>Run the tests on your laptop first: a red CI run that you could have caught locally costs everyone a review cycle.</p>",
    system: webWorld(),
    starter: "",
    objectives: [
      {
        id: "local", text: "In <code>~/kestrel-web</code>, install the dependencies and run the tests on your laptop.",
        hints: ["npm has a command for a clean install from the lock file, and npm test runs the test script.", "cd ~/kestrel-web\nnpm ci\nnpm test"],
        check: function (r) { return ran(r, /npm\s+(test|t|run\s+test)\b/, function (e) { return e.exit === 0 && outHas(e, /all pages ok/); }) && ran(r, /npm\s+(ci|install|i)\b/, function (e) { return e.exit === 0; }) ? true : "npm ci, then npm test (inside ~/kestrel-web)."; }
      },
      {
        id: "workflow", text: "On a branch <code>ci/github-actions</code>, add <code>.github/workflows/ci.yml</code>: a workflow named <b>CI</b> with a job <code>test</code> that runs on <code>ubuntu-latest</code>, on pull requests and on pushes to <code>main</code>. It checks out the code, sets up Node 22, and runs <code>npm ci</code> and <code>npm test</code>. Push the branch and open a pull request; its CI run must pass.",
        hints: ["mkdir -p .github/workflows, then nano .github/workflows/ci.yml. The Learn tab has the whole file. Commit, push -u, gh pr create.", "git switch -c ci/github-actions\nmkdir -p .github/workflows\nnano .github/workflows/ci.yml\ngit add .github\ngit commit -m 'ci: run the tests on GitHub Actions'\ngit push -u origin ci/github-actions\ngh pr create --title 'ci: run the tests on GitHub Actions' --body 'Runs npm test on every PR and push to main.'"],
        check: function (r) {
          var merged = prs(r, "kestrel/kestrel-web").some(function (x) { return x.head === "ci/github-actions" && x.state === "merged"; });
          var w = wfsOn(r, "kestrel/kestrel-web", merged ? "main" : "ci/github-actions").filter(function (x) { return /^\.github\/workflows\/ci\.ya?ml$/.test(x.path); })[0];
          if (!w) { var any = prs(r, "kestrel/kestrel-web").length; return any ? "The branch ci/github-actions on GitHub has no .github/workflows/ci.yml." : "Push a branch ci/github-actions with .github/workflows/ci.yml, then open a pull request."; }
          if (w.errors.length) return "GitHub can't read ci.yml: " + w.errors[0];
          if (w.name !== "CI") return "Name the workflow CI (name: CI at the top).";
          if (!("pull_request" in w.on)) return "The workflow should run on pull_request.";
          var push = w.on.push; if (!("push" in w.on) || !(push && push.branches && A.matchList(push.branches, "main") && !A.matchList(push.branches, "feature/x") && !A.matchList(push.branches, "develop"))) return "It should also run on pushes, but only to main (push: branches: [main]).";
          var job = jobsOf(w).test;
          if (!job) return "The job's id should be test.";
          if (!usesStep(job, /^actions\/checkout@/)) return "Check out the code first (uses: actions/checkout@v4).";
          if (!usesStep(job, /^actions\/setup-node@/) || !steps(job).some(function (s) { return s && /setup-node/.test(s.uses || "") && s["with"] && String(s["with"]["node-version"]) === "22"; })) return "Set up Node 22 (uses: actions/setup-node@v4 with node-version: 22).";
          if (!runStep(job, /npm\s+ci/) || !runStep(job, /npm\s+(test|t|run\s+test)\b/)) return "Run npm ci and npm test.";
          var p = prs(r, "kestrel/kestrel-web").filter(function (x) { return x.head === "ci/github-actions"; })[0];
          if (!p) return "Open a pull request for ci/github-actions.";
          var run = runs(r, "kestrel/kestrel-web", function (x) { return x.event === "pull_request" && x.pr === p.n && x.wfName === "CI"; })[0];
          if (!run) return "No CI run for the pull request yet: push your latest commit.";
          var j = run.jobs.filter(function (x) { return x.key === "test"; })[0];
          if (!j || !ok(j)) return "The pull request's CI run didn't pass: gh run view " + run.id + " --log-failed shows why.";
          return /all pages ok/.test(logOf(j)) ? true : "The test job passed without running the tests (npm test).";
        }
      },
      {
        id: "look", text: "From the terminal, list the recent runs, open your pull request's run with its log, and show the pull request's checks.",
        hints: ["gh run list, then gh run view ID --log (the ID is in the list), and gh pr checks.", "gh run list\ngh run view RUN_ID --log\ngh pr checks"],
        check: function (r) {
          var a = ran(r, /gh\s+run\s+list/, function (e) { return outHas(e, /\bCI\b/); });
          var b = ran(r, /gh\s+run\s+view\s+.*--log|gh\s+run\s+view\s+.*-v\b/, function (e) { return outHas(e, /test\t|✓ test|Run npm test/); }) || ran(r, /gh\s+run\s+view\s+\d+/, function (e) { return outHas(e, /^JOBS$/); });
          var c = ran(r, /gh\s+pr\s+checks/, function (e) { return outHas(e, /CI\/test/); });
          return a && b && c ? true : !a ? "gh run list" : !b ? "gh run view RUN_ID --log (copy the ID from gh run list)." : "gh pr checks (on the pull request's branch).";
        }
      },
      {
        id: "merge", text: "Squash-merge the pull request. The push to <code>main</code> then runs CI again, and that run passes too.",
        hints: ["gh pr merge --squash --delete-branch, then gh run list shows a push run on main.", "gh pr merge --squash --delete-branch\ngh run list"],
        check: function (r) {
          var p = prs(r, "kestrel/kestrel-web").filter(function (x) { return x.state === "merged" && x.head === "ci/github-actions"; })[0];
          if (!p) return "Merge the pull request (gh pr merge --squash).";
          var run = runs(r, "kestrel/kestrel-web", function (x) { return x.event === "push" && x.branch === "main" && x.wfName === "CI" && x.headSha === tip(r, "kestrel/kestrel-web", "main"); })[0];
          if (!run) return "No CI run for the push to main yet.";
          return run.conclusion === "success" ? true : "CI on main failed: gh run view " + run.id + " --log-failed.";
        }
      }
    ],
    solution: sol("cd ~/kestrel-web", "npm ci", "npm test", "git switch -c ci/github-actions", "mkdir -p .github/workflows", { nano: ".github/workflows/ci.yml", text: CI_BASIC },
      "git add .github", "git commit -m 'ci: run the tests on GitHub Actions'", "git push -u origin ci/github-actions",
      "gh pr create --title 'ci: run the tests on GitHub Actions' --body 'Runs npm test on every pull request and push to main.'",
      "gh run list", "gh run view $(gh run list -L 1 --json databaseId -q '.[0].databaseId') --log", "gh pr checks", "gh pr merge --squash --delete-branch", "gh run list"),
    debrief: "<p>Every pull request on <code>kestrel-web</code> now gets tested on a clean machine before anyone reviews it, and <code>main</code> gets tested after each merge. A clean runner also proves the build doesn't secretly depend on something only your laptop has.</p><p>You also saw the anatomy of a run: <i>Set up job</i>, your steps, <i>Post</i> steps that clean up, <i>Complete job</i>. Next: test on several Node versions at once, and make installs fast with caching.</p>",
    realworld: "Open the .github/workflows folder of any project you use on GitHub and read its CI file: you'll recognise checkout, setup-*, an install step and a test step almost everywhere.",
    quiz: [
      { q: "A workflow has no actions/checkout step. What does npm test see?", options: ["The repository at the pushed commit", "An empty workspace: no package.json", "The default branch", "Your laptop's files"], answer: 1, why: "Runners start empty. checkout puts the commit's files into the workspace." },
      { q: "Which command shows only the log of the failed steps?", options: ["gh run list --failed", "gh run view ID --log-failed", "gh pr checks --log", "git log --failed"], answer: 1, why: "--log-failed prints just the failing steps' output." },
      { q: "Why run npm ci instead of npm install in CI?", options: ["It's shorter", "It installs exactly what package-lock.json lists and fails if it's out of date", "It skips the tests", "It caches automatically"], answer: 1, why: "npm ci is reproducible: same lock file, same dependencies, every run." }
    ]
  });

  /* ================================================================== GT-122 Tests in CI: matrix and caching */
  var STRICT_PKG = Object.assign({}, WEB_PKG, { engines: { node: "20 || 22" } });
  var CI_MATRIX = "name: CI\n\non:\n  push:\n    branches: [main]\n  pull_request:\n\njobs:\n  test:\n    runs-on: ubuntu-latest\n    strategy:\n      fail-fast: false\n      matrix:\n        node: [20, 22, 24]\n    steps:\n      - uses: actions/checkout@v4\n      - uses: actions/setup-node@v4\n        with:\n          node-version: ${{ matrix.node }}\n          cache: npm\n      - run: npm ci\n      - run: npm test\n";
  T.M3.CI_MATRIX = CI_MATRIX;
  function matrixWorld(sys) {
    webWorld({ pkg: STRICT_PKG, steps: [{ msg: "ci: run the tests on GitHub Actions (#4)", by: "ben", at: "2026-11-03 10:00", files: { ".github/workflows/ci.yml": CI_BASIC, ".npmrc": "engine-strict=true\n" } }] })(sys);
  }
  function legs(run) { return run.jobs.filter(function (j) { return /^test \((\d+)\)$/.test(j.name); }); }
  LABS.push({
    id: "gt-122", n: 22, module: 3, ticket: "GT-122", xp: 190,
    title: "Tests in CI",
    topic: "matrix builds and caching",
    from: BEN,
    story: "<p>Kestrel's customers self-host the website builder on <b>Node 20, 22 and 24</b>, and CI only tests 22. Make every pull request test all three. While you're in there: every run downloads all the npm packages from scratch. Cache them.</p>",
    learn:
      "<h3>A matrix: one job, several variations</h3>" + code("jobs:\n  test:\n    runs-on: ubuntu-latest\n    strategy:\n      fail-fast: false        # let the others finish when one fails\n      matrix:\n        node: [20, 22, 24]\n    steps:\n      - uses: actions/checkout@v4\n      - uses: actions/setup-node@v4\n        with:\n          node-version: ${{ matrix.node }}") +
      "<p>GitHub runs one job per value: <code>test (20)</code>, <code>test (22)</code>, <code>test (24)</code>, in parallel. <code>${{ matrix.node }}</code> is an <b>expression</b>: GitHub fills it in before the step runs. Several keys multiply (<code>node: [20, 22]</code> × <code>os: [a, b]</code> = 4 jobs); <code>include:</code> adds or extends combinations, <code>exclude:</code> removes them.</p>" +
      "<p>By default <code>fail-fast</code> is on: when one leg fails, GitHub cancels the others. Turn it off when you want the full picture (\"fails on 24 only\").</p>" +
      "<h3>Caching dependencies</h3><p>Downloading the same packages on every run is slow. A cache saves a folder at the end of a successful job under a <b>key</b>, and restores it at the start of later runs with the same key:</p>" +
      code("      - uses: actions/setup-node@v4\n        with:\n          node-version: ${{ matrix.node }}\n          cache: npm            # caches ~/.npm, keyed on package-lock.json") +
      "<p>For anything else, <code>actions/cache</code> does the same by hand:</p>" + code("      - uses: actions/cache@v4\n        with:\n          path: ~/.npm\n          key: npm-${{ hashFiles('package-lock.json') }}\n          restore-keys: npm-") +
      "<p><code>hashFiles()</code> changes when the lock file changes, so a new dependency means a new cache. The first run saves it (<i>Cache saved with key</i>); later runs restore it (<i>Cache restored from key</i>). <code>gh cache list</code> shows what's stored. Re-running a run (<code>gh run rerun ID</code>) is a quick way to see the cache in action.</p>" +
      "<h3>Engines</h3><p><code>package.json</code> can say which Node versions a project supports (<code>\"engines\": {\"node\": \"&gt;=20\"}</code>). With <code>engine-strict=true</code> in <code>.npmrc</code>, <code>npm ci</code> refuses to install on any other version.</p>",
    system: matrixWorld,
    starter: "",
    objectives: [
      {
        id: "matrix", text: "On a branch <code>ci/node-matrix</code> with an open pull request, make the <code>test</code> job run on Node <b>20, 22 and 24</b> as separate jobs, and let all three finish even when one fails.",
        hints: ["Add strategy: with fail-fast: false and matrix: node: [20, 22, 24], and use ${{ matrix.node }} as the node-version.", "strategy:\n  fail-fast: false\n  matrix:\n    node: [20, 22, 24]\n...\n  node-version: ${{ matrix.node }}"],
        check: function (r) {
          var p = prs(r, "kestrel/kestrel-web").filter(function (x) { return x.head === "ci/node-matrix"; })[0];
          if (!p) return "Push a branch ci/node-matrix and open a pull request for it.";
          var w = wfsOn(r, "kestrel/kestrel-web", p.state === "open" ? "ci/node-matrix" : "main").filter(function (x) { return x.name === "CI"; })[0];
          if (!w || w.errors.length) return w ? "GitHub can't read ci.yml: " + w.errors[0] : "Keep the workflow named CI.";
          var j = jobsOf(w).test, st = j && j.strategy;
          if (!st || !st.matrix) return "Give the test job a strategy: matrix:.";
          if (st["fail-fast"] !== false) return "Set fail-fast: false, so one failing version doesn't cancel the others.";
          var run = runs(r, "kestrel/kestrel-web", function (x) { return x.pr === p.n && x.wfName === "CI"; })[0];
          if (!run) return "Push to the branch so CI runs on the pull request.";
          var names = legs(run).map(function (x) { return x.name; }).sort();
          return names.join() === "test (20),test (22),test (24)" ? true : "The latest run has these test jobs: " + (names.join(", ") || "none") + ". Expected test (20), test (22), test (24): use ${{ matrix.node }} as the node-version.";
        }
      },
      {
        id: "green", text: "Node 24 fails. Find out why from the run's log, fix the project (not the workflow) so 24 is supported, and get all three versions green on the pull request.",
        hints: ["gh run view RUN_ID --log-failed. npm ci refuses to install: look at package.json's engines and .npmrc.", "package.json says \"engines\": {\"node\": \"20 || 22\"}. Change it to \">=20\", commit, push."],
        check: function (r) {
          var p = prs(r, "kestrel/kestrel-web").filter(function (x) { return x.head === "ci/node-matrix"; })[0];
          if (!p) return "Do the first task first.";
          var head = GH.prHeadSha(r.sys, gh(r, "kestrel/kestrel-web"), p), flat = G.commitFlat(r.sys, head), pkg;
          try { pkg = JSON.parse(G.blobText(r.sys, flat["package.json"].sha)); } catch (e) { return "package.json on the branch isn't valid JSON any more."; }
          var e = pkg.engines && pkg.engines.node;
          if (!e || !["20.19.5", "22.21.1", "24.11.1"].every(function (v) { return A.satisfies(v, e); })) return "package.json's engines (" + (e || "missing") + ") should accept Node 20, 22 and 24.";
          if (!flat[".npmrc"] || !/engine-strict\s*=\s*true/.test(G.blobText(r.sys, flat[".npmrc"].sha))) return "Keep engine-strict=true in .npmrc: fix the supported versions, not the check.";
          var run = runs(r, "kestrel/kestrel-web", function (x) { return x.pr === p.n && x.wfName === "CI" && x.headSha === head; })[0];
          if (!run) return "Push the fix so CI runs again.";
          var ls = legs(run);
          return ls.length === 3 && ls.every(ok) ? true : "The latest run isn't green on all three: gh run view " + run.id;
        }
      },
      {
        id: "cache", text: "Cache npm's downloads with <code>setup-node</code>'s built-in cache, and show that a later run on the pull request <b>restores</b> the cache.",
        hints: ["Add cache: npm under the setup-node step's with:. The first green run saves the cache; a re-run (gh run rerun ID) or the next push restores it.", "      - uses: actions/setup-node@v4\n        with:\n          node-version: ${{ matrix.node }}\n          cache: npm\nThen push, and gh run rerun RUN_ID once that run is green."],
        check: function (r) {
          var p = prs(r, "kestrel/kestrel-web").filter(function (x) { return x.head === "ci/node-matrix"; })[0];
          if (!p) return "Do the first task first.";
          var w = wfsOn(r, "kestrel/kestrel-web", p.state === "open" ? "ci/node-matrix" : "main").filter(function (x) { return x.name === "CI"; })[0], j = w && jobsOf(w).test;
          if (!j || !steps(j).some(function (s) { return s && /setup-node/.test(s.uses || "") && s["with"] && s["with"].cache === "npm"; })) return "Add cache: npm to the setup-node step.";
          var hit = runs(r, "kestrel/kestrel-web", function (x) { return x.pr === p.n; }).some(function (run) { return legs(run).some(function (jj) { return /Cache restored from key: node-cache-/.test(logOf(jj)); }); });
          return hit ? true : "No run has restored the cache yet. The first green run saves it; re-run that run (gh run rerun ID) or push again, and the next one restores it.";
        }
      }
    ],
    solution: sol("cd ~/kestrel-web", "git switch -c ci/node-matrix", { nano: ".github/workflows/ci.yml", text: CI_MATRIX }, "git commit -am 'ci: test on Node 20, 22 and 24'", "git push -u origin ci/node-matrix",
      "gh pr create --title 'ci: test on Node 20, 22 and 24' --body 'Matrix build plus npm cache.'", "gh run view $(gh run list -L 1 --json databaseId -q '.[0].databaseId') --log-failed",
      "sed -i 's/\"node\": \"20 || 22\"/\"node\": \">=20\"/' package.json", "npm install", "git commit -am 'fix: support Node 24'", "git push",
      "gh run list -L 2", "gh run rerun $(gh run list -L 1 --json databaseId -q '.[0].databaseId')", "gh run view $(gh run list -L 1 --json databaseId -q '.[0].databaseId') --log", "gh cache list"),
    debrief: "<p>One small block of YAML tests three Node versions in parallel, and <code>fail-fast: false</code> told you exactly which one broke instead of cancelling the evidence. The failure was a real one: the project declared it didn't support Node 24, and <code>engine-strict</code> enforced that. Fixing the declaration (not deleting the check) is the right move.</p><p>The cache cut the install step from seconds of downloading to a restore, and it updates itself whenever <code>package-lock.json</code> changes. Next: choosing exactly <i>when</i> workflows run.</p>",
    realworld: "Search GitHub for \"strategy: matrix\" in workflow files: popular libraries test across Node, Python or Go versions and operating systems this way. gh cache list on one of your own repositories shows what Actions is keeping for you.",
    quiz: [
      { q: "matrix: { node: [20, 22], os: [ubuntu-latest, ubuntu-22.04] } creates how many jobs?", options: ["2", "3", "4", "1"], answer: 2, why: "Every combination: 2 × 2 = 4." },
      { q: "fail-fast is on (the default) and test (20) fails. What happens to test (24)?", options: ["It keeps running", "GitHub cancels it", "It re-runs test (20)", "It's skipped forever"], answer: 1, why: "fail-fast cancels the remaining legs as soon as one fails." },
      { q: "Why key the npm cache on hashFiles('package-lock.json')?", options: ["Hashes are shorter", "A new lock file (new dependencies) gets a fresh cache instead of a stale one", "It encrypts the cache", "It's required syntax"], answer: 1, why: "Same lock file → same key → cache hit; change the dependencies → new key → new cache." }
    ]
  });

  /* ================================================================== GT-123 Triggers */
  var LINKS_SH = "#!/bin/bash\n# Check the docs' links. Internal links must point at files that exist.\n# --external also checks links to other websites (slow: only nightly or on request).\nexternal=false\n[ \"${1:-}\" = \"--external\" ] && external=true\nfail=0\nfor f in docs/*.md; do\n  for link in $(grep -o '](\\([^)]*\\))' \"$f\" | sed 's/^](//; s/)$//'); do\n    case \"$link\" in\n      http*) continue ;;\n    esac\n    if [ ! -f \"docs/$link\" ]; then echo \"BROKEN: $f -> $link\"; fail=1; fi\n  done\ndone\nn=$(grep -ho '](http[^)]*)' docs/*.md | wc -l)\nif [ \"$external\" = true ]; then\n  echo \"checking external links: $n found\"\n  echo \"external links ok\"\nelse\n  echo \"skipping $n external links (use --external)\"\nfi\nif [ \"$fail\" -ne 0 ]; then exit 1; fi\necho \"internal links ok\"\n";
  var LINKS_WF = "name: Links\n\non: push\n\njobs:\n  links:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n      - run: bash scripts/check-links.sh\n";
  var LINKS_DONE = "name: Links\n\non:\n  push:\n    branches: [main]\n    paths: ['docs/**']\n  pull_request:\n    paths: ['docs/**']\n  schedule:\n    - cron: '30 2 * * *'\n  workflow_dispatch:\n    inputs:\n      external:\n        description: Also check links to other websites\n        type: boolean\n        default: false\n\njobs:\n  links:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n      - run: bash scripts/check-links.sh ${{ (github.event_name == 'schedule' || inputs.external) && '--external' || '' }}\n";
  T.M3.LINKS_SH = LINKS_SH; T.M3.LINKS_WF = LINKS_WF;
  function docsFiles() {
    return {
      "README.md": "# kestrel-docs\n\nKestrel's public documentation, published at docs.kestrel.io.\n",
      "docs/index.md": "# Kestrel docs\n\n- [Getting started](start.md)\n- [Deploying](deploy.md)\n- [Status page](https://status.kestrel.io)\n",
      "docs/start.md": "# Getting started\n\nInstall [kc](https://github.com/kestrel/kestrel-cli), then read [Deploying](deploy.md).\n",
      "docs/deploy.md": "# Deploying\n\nkc deploy REGION. Back to the [index](index.md).\n",
      "scripts/check-links.sh": LINKS_SH, ".github/workflows/links.yml": LINKS_WF
    };
  }
  function docsWorld(sys) {
    world(sys);
    GH.seed(sys, "kestrel/kestrel-docs", { steps: [{ msg: "Docs site with a link checker", by: "maya", at: "2026-10-12 10:00", files: docsFiles(), exec: ["scripts/check-links.sh"] }] }, { description: "Kestrel's public docs" });
    GH.cloneTo(sys, "kestrel/kestrel-docs", HOME + "/kestrel-docs");
  }
  function cronIs(c, want) { var a = String(c).trim().split(/\s+/), b = want.split(" "); return a.length === 5 && a.every(function (x, i) { return x === b[i] || (/^\d+$/.test(x) && /^\d+$/.test(b[i]) && +x === +b[i]); }); }
  LABS.push({
    id: "gt-123", n: 23, module: 3, ticket: "GT-123", xp: 190,
    title: "Triggers",
    topic: "branches, paths, schedule, manual runs",
    from: MAYA,
    story: "<p>The docs repository (<code>kestrel/kestrel-docs</code>, cloned in <code>~/kestrel-docs</code>) has a link checker that runs on <b>every push to every branch</b>, even when someone only edits the README. Make it run when docs change, every night (that's when it should also check links to other websites, which is slow), and whenever someone asks for it.</p>",
    learn:
      "<h3>Filtering events</h3>" + code("on:\n  push:\n    branches: [main]          # only pushes to main\n    paths: ['docs/**']        # ...that change something under docs/\n  pull_request:\n    paths: ['docs/**']") +
      "<p>Patterns are globs: <code>*</code> matches within one folder, <code>**</code> across folders, a leading <code>!</code> excludes. There are <code>-ignore</code> versions too (<code>paths-ignore</code>, <code>branches-ignore</code>); use one or the other per event. <code>tags: ['v*']</code> runs on tag pushes. <code>pull_request</code> can be narrowed with <code>types: [opened, synchronize]</code>.</p>" +
      "<h3>On a schedule</h3>" + code("  schedule:\n    - cron: '30 2 * * *'      # 02:30 UTC every day") +
      '<table class="t"><tr><th>Field</th><th>minute</th><th>hour</th><th>day of month</th><th>month</th><th>day of week</th></tr><tr><td>Example</td><td><code>30</code></td><td><code>2</code></td><td><code>*</code></td><td><code>*</code></td><td><code>*</code> (or <code>1-5</code> = Mon-Fri)</td></tr></table>' +
      "<p>Times are UTC. Scheduled runs use the workflow file on the default branch.</p>" +
      "<h3>Manual runs with inputs</h3>" + code("  workflow_dispatch:\n    inputs:\n      external:\n        description: Also check links to other websites\n        type: boolean\n        default: false") +
      code("gh workflow run links.yml -f external=true\ngh run list --workflow links.yml") +
      "<h3>Using the event in steps</h3><p><code>github.event_name</code> says what started the run (<code>push</code>, <code>schedule</code>, <code>workflow_dispatch</code>...) and <code>inputs.NAME</code> holds the manual inputs. Expressions have <code>&amp;&amp;</code> and <code>||</code>, which work like a ternary:</p>" +
      code("- run: bash scripts/check-links.sh ${{ inputs.external && '--external' || '' }}") +
      "<p>A step-level <code>if:</code> is the other way to make choices: <code>if: github.event_name == 'schedule'</code>.</p>",
    system: docsWorld,
    starter: "",
    objectives: [
      {
        id: "filters", text: "In <code>.github/workflows/links.yml</code> on <code>main</code>: run on <b>pushes to main</b> and on <b>pull requests</b>, in both cases only when something under <code>docs/</code> changes.",
        hints: ["on: push: with branches: [main] and paths: ['docs/**'], and pull_request: with the same paths.", "on:\n  push:\n    branches: [main]\n    paths: ['docs/**']\n  pull_request:\n    paths: ['docs/**']"],
        check: function (r) {
          var w = wfsOn(r, "kestrel/kestrel-docs", "main").filter(function (x) { return /links\.ya?ml$/.test(x.path); })[0];
          if (!w) return "main has no .github/workflows/links.yml.";
          if (w.errors.length) return "GitHub can't read links.yml: " + w.errors[0];
          var p = w.on.push, q = w.on.pull_request;
          if (!("push" in w.on) || !p) return "Give push: its own settings (branches and paths).";
          if (!(p.branches && A.matchList(p.branches, "main") && !A.matchList(p.branches, "feature/x") && !A.matchList(p.branches, "develop"))) return "Pushes should only count on main (branches: [main]).";
          if (!p.paths || !A.matchList(p.paths, "docs/start.md") || !A.matchList(p.paths, "docs/a/b.md") || A.matchList(p.paths, "README.md")) return "Push runs should only happen when docs/ changes (paths: ['docs/**']).";
          if (!("pull_request" in w.on) || !q || !q.paths || !A.matchList(q.paths, "docs/start.md") || A.matchList(q.paths, "README.md")) return "Pull requests should run it too, also only for changes under docs/.";
          return true;
        }
      },
      {
        id: "nightly", text: "Also run it every night at <b>02:30 UTC</b>, and make the scheduled runs check external links (<code>scripts/check-links.sh --external</code>).",
        hints: ["schedule: - cron: '30 2 * * *'. Pass --external when github.event_name == 'schedule'.", "  schedule:\n    - cron: '30 2 * * *'\n...\n      - run: bash scripts/check-links.sh ${{ github.event_name == 'schedule' && '--external' || '' }}"],
        check: function (r) {
          var w = wfsOn(r, "kestrel/kestrel-docs", "main").filter(function (x) { return /links\.ya?ml$/.test(x.path); })[0];
          if (!w || w.errors.length) return "Fix links.yml on main first.";
          var sc = w.on.schedule;
          if (!Array.isArray(sc) || !sc.some(function (s) { return s && cronIs(s.cron, "30 2 * * *"); })) return "Add schedule: with cron: '30 2 * * *' (minute 30, hour 2, every day).";
          // would a scheduled run pass --external? Evaluate the step's script as GitHub would.
          var job = jobsOf(w)[Object.keys(jobsOf(w))[0]], ctx = { github: { event_name: "schedule", ref: "refs/heads/main" }, inputs: {}, env: {}, vars: {}, secrets: {}, matrix: {}, needs: {}, steps: {}, runner: {} };
          var says = steps(job).some(function (s) { if (!s || s.run === undefined) return false; var on; try { on = A.evalExpr("true", ctx) && evalIfTrue(s["if"], ctx) && /check-links\.sh/.test(A.interp(String(s.run), ctx)) && /--external/.test(A.interp(String(s.run), ctx)); } catch (e) { on = false; } return on; });
          return says ? true : "A scheduled run should call scripts/check-links.sh --external (use github.event_name == 'schedule').";
        }
      },
      {
        id: "manual", text: "Let people start it by hand with a boolean input <code>external</code> (default <code>false</code>) that adds <code>--external</code>. Then start it from the terminal with external links on, and check that run passed and checked them.",
        hints: ["workflow_dispatch: inputs: external: type: boolean, default: false. Then gh workflow run links.yml -f external=true.", "  workflow_dispatch:\n    inputs:\n      external:\n        type: boolean\n        default: false\n...\n      - run: bash scripts/check-links.sh ${{ (github.event_name == 'schedule' || inputs.external) && '--external' || '' }}\nThen: gh workflow run links.yml -f external=true"],
        check: function (r) {
          var w = wfsOn(r, "kestrel/kestrel-docs", "main").filter(function (x) { return /links\.ya?ml$/.test(x.path); })[0];
          if (!w || w.errors.length) return "Fix links.yml on main first.";
          var wd = w.on.workflow_dispatch, inp = wd && wd.inputs && wd.inputs.external;
          if (!("workflow_dispatch" in w.on)) return "Add workflow_dispatch: to on:.";
          if (!inp || inp.type !== "boolean" || inp["default"] !== false) return "Give workflow_dispatch an input external with type: boolean and default: false.";
          var run = runs(r, "kestrel/kestrel-docs", function (x) { return x.event === "workflow_dispatch" && x.inputs && x.inputs.external === true; })[0];
          if (!run) return "Start a run with gh workflow run links.yml -f external=true.";
          if (run.conclusion !== "success") return "That run didn't pass: gh run view " + run.id + " --log-failed.";
          return run.jobs.some(function (j) { return /checking external links/.test(logOf(j)); }) ? true : "The run didn't check external links: pass --external when inputs.external is true.";
        }
      }
    ],
    solution: sol("cd ~/kestrel-docs", { nano: ".github/workflows/links.yml", text: LINKS_DONE }, "git commit -am 'ci: run the link checker on docs changes, nightly, and on demand'", "git push",
      "gh workflow run links.yml -f external=true", "gh run list --workflow links.yml", "gh run view $(gh run list --workflow links.yml -L 1 --json databaseId -q '.[0].databaseId') --log"),
    debrief: "<p>The link checker now runs only when it can find something: docs changes on pull requests and <code>main</code>, a thorough nightly pass, and on demand with a choice. The README edit that used to trigger it doesn't any more, and CI minutes aren't free.</p><p>One expression did the deciding: <code>github.event_name</code> and <code>inputs</code> are part of the context every run carries. Next: the context that holds passwords. Secrets, variables and deployment environments.</p>",
    realworld: "crontab.guru explains any cron line in plain English. In your own repositories, gh workflow list shows every workflow and gh workflow run starts the ones that have workflow_dispatch.",
    quiz: [
      { q: "With paths: ['docs/**'], which push starts the workflow?", options: ["One that only changes README.md", "One that changes docs/guide/install.md", "Any push", "Only tag pushes"], answer: 1, why: "** matches any depth under docs/; README.md is outside it." },
      { q: "What does cron '0 6 * * 1-5' mean?", options: ["06:00 UTC, Monday to Friday", "6 minutes past every hour", "Every 6 days", "June, weekdays"], answer: 0, why: "minute 0, hour 6, any day of month, any month, days 1-5 (Mon-Fri). Always UTC." },
      { q: "gh workflow run says the workflow has no 'workflow_dispatch' trigger. Why?", options: ["You're not logged in", "The file on that branch has no on: workflow_dispatch", "Manual runs are paid", "The input name is wrong"], answer: 1, why: "Manual runs need workflow_dispatch in the version of the file on the branch you run." }
    ]
  });
  function evalIfTrue(cond, ctx) { if (cond === undefined || cond === null || cond === "") return true; var src = String(cond).replace(/^\$\{\{([\s\S]*)\}\}$/, "$1"); try { return !!A.evalExpr(src, ctx); } catch (e) { return false; } }

  /* ================================================================== GT-124 Secrets & environments */
  var DEPLOY_SH = "#!/bin/bash\n# Deploy the current commit of a site through Kestrel's deploy service.\n# Needs DEPLOY_TOKEN (one per environment) and SITE.\nset -euo pipefail\n: \"${DEPLOY_TOKEN:?DEPLOY_TOKEN is not set}\"\n: \"${SITE:?SITE is not set}\"\nsha=\"${GITHUB_SHA:-$(git rev-parse HEAD)}\"\necho \"Deploying $SITE at $(echo \"$sha\" | cut -c1-7)\"\ncurl -fsS -X POST -H \"Authorization: Bearer $DEPLOY_TOKEN\" \"https://deploy.kestrel.io/api/sites/$SITE/releases\" -d \"sha=$sha\"\necho\n";
  var DEPLOY_WF = "name: Deploy\n\non:\n  push:\n    branches: [main]\n\njobs:\n  staging:\n    runs-on: ubuntu-latest\n    environment: staging\n    steps:\n      - uses: actions/checkout@v4\n      - run: bash scripts/deploy.sh\n        env:\n          DEPLOY_TOKEN: ${{ secrets.DEPLOY_TOKEN }}\n          SITE: ${{ vars.SITE }}\n\n  production:\n    needs: staging\n    runs-on: ubuntu-latest\n    environment: production\n    steps:\n      - uses: actions/checkout@v4\n      - run: bash scripts/deploy.sh\n        env:\n          DEPLOY_TOKEN: ${{ secrets.DEPLOY_TOKEN }}\n          SITE: ${{ vars.SITE }}\n";
  T.M3.DEPLOY_SH = DEPLOY_SH; T.M3.DEPLOY_WF = DEPLOY_WF;
  function envs(sys, full, o) {
    var r = GH.find(sys, full);
    var st = A.envFor(r, "staging"); st.created = 1;
    var pr = A.envFor(r, "production"); pr.reviewers = ["maya-chen"]; pr.branches = ["main"]; pr.created = 1;
    if (o && o.prodToken) pr.secrets.DEPLOY_TOKEN = { value: A.deployToken(sys, o.site, "production"), updated: G.clock(sys) - 86400 * 3 };
    if (o && o.stagingToken) st.secrets.DEPLOY_TOKEN = { value: A.deployToken(sys, o.site, "staging"), updated: G.clock(sys) - 86400 * 3 };
    GH.on(sys, "deployment.waiting", function (s2, d) { if (d.repo.full === full && d.env.name === "production" && d.run.ref === "refs/heads/main") A.review(s2, d.repo, d.run, "production", "maya-chen", "approved", "Staging looks good, go ahead."); });
  }
  T.M3.envs = envs;
  function secretsWorld(sys) {
    webWorld({ admin: true, steps: [{ msg: "Add the deploy script", by: "devp", at: "2026-11-04 10:00", files: { "scripts/deploy.sh": DEPLOY_SH }, exec: ["scripts/deploy.sh"] }] })(sys);
    envs(sys, "kestrel/kestrel-web", { site: "kestrel-web", prodToken: true });
    var t1 = A.deployToken(sys, "kestrel-web", "staging");
    G.putFile(sys, HOME + "/Downloads/staging-deploy-token.txt", t1 + "\n", 384, 1000, 1000);
    sys.lab = { t1: t1 };
    // after the first deploy with it, Dev revokes the first staging token (it was pasted in a chat) and issues a new one
    var rotated = false;
    GH.on(sys, "run.completed", function (s2) {
      var st = A.svc(s2); if (rotated || !st.deploys.some(function (d) { return d.token === t1; })) return;
      rotated = true; st.tokens[t1].revoked = true;
      var home = s2.hubSys || s2, t2 = A.deployToken(home, "kestrel-web", "staging"); home.lab.t2 = t2;
      G.putFile(home, HOME + "/Downloads/staging-deploy-token-2.txt", t2 + "\n", 384, 1000, 1000);
    });
  }
  LABS.push({
    id: "gt-124", n: 24, module: 3, ticket: "GT-124", xp: 210,
    title: "Secrets & environments",
    topic: "secrets, variables, environments, approvals",
    from: DEV,
    story: "<p>The website still gets deployed by hand from someone's laptop. Make GitHub deploy it: every push to <code>main</code> goes to <b>staging</b>, then to <b>production</b> once Maya approves. Kestrel's deploy service wants a token per environment. I put the <b>staging</b> token in <code>~/Downloads/staging-deploy-token.txt</code>; Maya already stored the production one in the <code>production</code> environment (you don't get to see it, and that's the point). <code>scripts/deploy.sh</code> does the actual deploy. You're an admin on <code>kestrel/kestrel-web</code> (cloned in <code>~/kestrel-web</code>).</p>",
    learn:
      "<h3>Secrets</h3><p>A <b>secret</b> is a value GitHub stores encrypted and hands to workflows. Nobody can read it back (not even admins), and GitHub replaces it with <code>***</code> wherever it appears in a log.</p>" +
      code("gh secret set DEPLOY_TOKEN < token.txt            # repository secret (value from a file)\ngh secret set DEPLOY_TOKEN --env staging < token.txt   # environment secret\ngh secret list --env staging") +
      "<p>Pass the value from a file or stdin, never as <code>--body VALUE</code> on the command line: that lands in your shell history. Then delete the file.</p>" +
      "<h3>Variables</h3><p>Non-secret settings (a site name, a region) are <b>variables</b>: readable, shown in logs as they are.</p>" + code("gh variable set SITE --body kestrel-web\ngh variable list") +
      "<h3>Using them in a workflow</h3>" + code("      - run: bash scripts/deploy.sh\n        env:\n          DEPLOY_TOKEN: ${{ secrets.DEPLOY_TOKEN }}\n          SITE: ${{ vars.SITE }}") +
      "<p>Hand secrets to scripts through <code>env:</code>, not by pasting <code>${{ secrets.X }}</code> into the command: the script reads <code>$DEPLOY_TOKEN</code> and the value never becomes part of the command text.</p>" +
      "<h3>Environments</h3><p>An <b>environment</b> (<code>staging</code>, <code>production</code>) is a named deployment target with its own secrets and <b>protection rules</b>: required reviewers who must approve each deployment, and which branches may deploy. A job opts in with <code>environment:</code>, and then sees that environment's secrets (they win over repository secrets with the same name).</p>" +
      code("jobs:\n  staging:\n    runs-on: ubuntu-latest\n    environment: staging\n    steps: ...\n  production:\n    needs: staging            # only after staging succeeded\n    runs-on: ubuntu-latest\n    environment: production   # waits for a required reviewer\n    steps: ...") +
      "<p><code>needs:</code> orders jobs: <code>production</code> starts only when <code>staging</code> succeeded. A waiting run shows <i>Waiting for review</i> in <code>gh run view</code>.</p>" +
      "<h3>Rotating a secret</h3><p>When a secret leaks, revoke it where it was issued, store the new one, and re-run the failed run: <code>gh run rerun ID</code> repeats it on the same commit, with the secrets as they are <i>now</i>.</p>",
    system: secretsWorld,
    starter: "",
    objectives: [
      {
        id: "store", text: "Store the staging token as the secret <code>DEPLOY_TOKEN</code> of the <code>staging</code> environment (from the file, not typed on the command line), and a repository variable <code>SITE</code> = <code>kestrel-web</code>. Then delete the token file.",
        hints: ["gh secret set takes --env staging and reads the value from stdin (< file). gh variable set SITE --body kestrel-web. Then rm the file.", "cd ~/kestrel-web\ngh secret set DEPLOY_TOKEN --env staging < ~/Downloads/staging-deploy-token.txt\ngh variable set SITE --body kestrel-web\nrm ~/Downloads/staging-deploy-token.txt"],
        check: function (r) {
          var x = gh(r, "kestrel/kestrel-web"), lab = r.sys.lab, s = x.envs.staging.secrets.DEPLOY_TOKEN;
          if (!s) return "The staging environment has no DEPLOY_TOKEN secret yet (gh secret set ... --env staging).";
          if (s.value !== lab.t1 && s.value !== lab.t2) return "staging's DEPLOY_TOKEN isn't the token from the file (did a newline or a typo sneak in?). Use < FILE.";
          if (x.secrets.DEPLOY_TOKEN) return "That went to the repository's secrets: it belongs to the staging environment (--env staging). Delete the repository one (gh secret delete DEPLOY_TOKEN).";
          if (!x.vars.SITE || x.vars.SITE.value !== "kestrel-web") return "Set the repository variable SITE to kestrel-web.";
          if (r.history.some(function (e) { return e.cmd.indexOf(lab.t1) >= 0 || (lab.t2 && e.cmd.indexOf(lab.t2) >= 0); })) return "The token appears in a command you typed, so it's in your shell history. Pass it from the file (< FILE) instead.";
          return r.exists("~/Downloads/staging-deploy-token.txt") ? "Delete ~/Downloads/staging-deploy-token.txt once the secret is stored." : true;
        }
      },
      {
        id: "deploy", text: "Add <code>.github/workflows/deploy.yml</code> on <code>main</code>: on each push to <code>main</code>, a job <code>staging</code> (environment <code>staging</code>) runs <code>scripts/deploy.sh</code> with <code>DEPLOY_TOKEN</code> and <code>SITE</code>, then a job <code>production</code> (environment <code>production</code>) does the same once <code>staging</code> succeeded. Get a commit of <code>main</code> deployed to both.",
        hints: ["Two jobs; production has needs: staging. Each step passes env: DEPLOY_TOKEN: ${{ secrets.DEPLOY_TOKEN }} and SITE: ${{ vars.SITE }}. The Learn tab shows the shape.", "Write the workflow with nano, commit it on main, git push. gh run list, then gh run view RUN_ID (production waits for Maya's approval, which comes quickly)."],
        check: function (r) {
          var w = wfsOn(r, "kestrel/kestrel-web", "main").filter(function (x) { return /deploy\.ya?ml$/.test(x.path); })[0];
          if (!w) return "main has no .github/workflows/deploy.yml.";
          if (w.errors.length) return "GitHub can't read deploy.yml: " + w.errors[0];
          var js = jobsOf(w);
          if (!js.staging || !js.production) return "Name the jobs staging and production.";
          if (String(js.staging.environment && (js.staging.environment.name || js.staging.environment)) !== "staging" || String(js.production.environment && (js.production.environment.name || js.production.environment)) !== "production") return "Each job needs its environment: (staging, production).";
          if (A.list(js.production.needs).indexOf("staging") < 0) return "production should wait for staging (needs: staging).";
          if (JSON.stringify(js).indexOf("${{ secrets.DEPLOY_TOKEN }}") < 0 || !/\$\{\{\s*vars\.SITE\s*\}\}/.test(w.text)) return "Pass DEPLOY_TOKEN from secrets and SITE from vars to the deploy script.";
          if (/run:.*\$\{\{\s*secrets\./.test(w.text)) return "Don't put ${{ secrets.DEPLOY_TOKEN }} in the command itself: pass it through env: and let the script read $DEPLOY_TOKEN.";
          var d = A.svc(r.sys).deploys.filter(function (x) { return x.from === "actions" && x.site === "kestrel-web"; });
          var stagingShas = d.filter(function (x) { return x.env === "staging"; }).map(function (x) { return x.sha; });
          var both = d.filter(function (x) { return x.env === "production" && stagingShas.indexOf(x.sha) >= 0; })[0];
          return both ? true : d.length ? "Staging got deployed, but production didn't yet: gh run view the latest Deploy run." : "No deploy has reached Kestrel's deploy service from Actions yet: push to main and check gh run list.";
        }
      },
      {
        id: "rotate", text: "After your first deploy, Dev revoked that staging token (it had been pasted in a chat) and left a new one in <code>~/Downloads/staging-deploy-token-2.txt</code>. Put it in the secret, delete the file, and <b>re-run</b> the failed deployment, without pushing anything new.",
        hints: ["gh secret set DEPLOY_TOKEN --env staging < the new file, rm it, then gh run rerun RUN_ID (the newest Deploy run, from gh run list).", "gh secret set DEPLOY_TOKEN --env staging < ~/Downloads/staging-deploy-token-2.txt\nrm ~/Downloads/staging-deploy-token-2.txt\ngh run rerun RUN_ID"],
        check: function (r) {
          var lab = r.sys.lab;
          if (!lab.t2) return "Do the deploy first: the new token appears after your first successful staging deploy.";
          var x = gh(r, "kestrel/kestrel-web"), s = x.envs.staging.secrets.DEPLOY_TOKEN;
          if (!s || s.value !== lab.t2) return "staging's DEPLOY_TOKEN should be the new token.";
          if (r.exists("~/Downloads/staging-deploy-token-2.txt")) return "Delete ~/Downloads/staging-deploy-token-2.txt.";
          var d = A.svc(r.sys).deploys.filter(function (z) { return z.token === lab.t2 && z.from === "actions"; })[0];
          if (!d) return "Nothing has deployed with the new token yet: re-run the failed Deploy run (gh run rerun RUN_ID).";
          var run = x.runs.filter(function (z) { return z.id === d.run; })[0];
          return run && run.attempt > 1 ? true : "That deploy came from a new push. Re-run the existing run instead (gh run rerun RUN_ID): no new commit needed.";
        }
      }
    ],
    solution: sol("cd ~/kestrel-web", "gh secret set DEPLOY_TOKEN --env staging < ~/Downloads/staging-deploy-token.txt", "gh variable set SITE --body kestrel-web", "rm ~/Downloads/staging-deploy-token.txt", "gh secret list --env staging",
      "mkdir -p .github/workflows", { nano: ".github/workflows/deploy.yml", text: DEPLOY_WF }, "git add .github", "git commit -m 'ci: deploy main to staging, then production'", "git push",
      "gh run list", "gh run view $(gh run list -w Deploy -L 1 --json databaseId -q '.[0].databaseId')",
      "echo 'docs: deploy notes' >> README.md", "git commit -am 'docs: mention automatic deploys'", "git push", "gh run view $(gh run list -w Deploy -L 1 --json databaseId -q '.[0].databaseId') --log-failed",
      "gh secret set DEPLOY_TOKEN --env staging < ~/Downloads/staging-deploy-token-2.txt", "rm ~/Downloads/staging-deploy-token-2.txt", "gh run rerun $(gh run list -w Deploy -L 1 --json databaseId -q '.[0].databaseId')", "gh run list -w Deploy"),
    debrief: "<p>Deploys now happen the same way every time, from a clean machine, with credentials nobody holds on a laptop. Each environment has its own token, and production has a human gate: the run paused until Maya approved.</p><p>When the staging token leaked, rotating it was boring, which is exactly what you want: revoke, store the new one, re-run. The re-run used the same commit and picked up the new secret. Next: turning tags into releases with downloadable builds.</p>",
    realworld: "In a repository you admin: Settings → Environments shows required reviewers and branch rules; gh secret list --env NAME and gh variable list show what's set. Most cloud providers can also skip long-lived tokens entirely with OIDC (Module 4).",
    quiz: [
      { q: "A step runs echo \"$DEPLOY_TOKEN\". What does the log show?", options: ["The token", "***", "Nothing: the step fails", "The token's hash"], answer: 1, why: "GitHub masks secret values in logs. Still, don't print them: transformed values (base64, reversed) aren't masked." },
      { q: "Why gh secret set NAME < file instead of --body VALUE?", options: ["It's faster", "--body puts the secret in your shell history", "--body doesn't work", "Files are encrypted"], answer: 1, why: "Anything typed on a command line can end up in ~/.bash_history and process listings." },
      { q: "You updated a secret. How do you redo the last failed deploy with it?", options: ["Push an empty commit", "gh run rerun RUN_ID", "Delete the workflow", "Wait for the schedule"], answer: 1, why: "A re-run uses the same commit and workflow file, with today's secrets." }
    ]
  });

  /* ================================================================== GT-125 Releases */
  var PACKAGE_SH = "#!/bin/bash\n# Package kc into dist/: a tarball and its SHA-256 checksum.\nset -euo pipefail\nv=\"$(cat VERSION)\"\nrm -rf dist\nmkdir -p dist\ntar czf \"dist/kc-$v.tar.gz\" bin lib VERSION README.md\ncd dist\nsha256sum \"kc-$v.tar.gz\" > \"kc-$v.tar.gz.sha256\"\necho \"packaged kc $v:\"\nls\n";
  var RELEASE_WF = "name: Release\n\non:\n  push:\n    tags: ['v*']\n\npermissions:\n  contents: read\n\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n      - run: bash scripts/package.sh\n      - uses: actions/upload-artifact@v4\n        with:\n          name: dist\n          path: dist/\n\n  publish:\n    needs: build\n    runs-on: ubuntu-latest\n    permissions:\n      contents: write\n    steps:\n      - uses: actions/download-artifact@v4\n        with:\n          name: dist\n          path: dist\n      - run: gh release create \"$GITHUB_REF_NAME\" dist/* --generate-notes\n        env:\n          GH_TOKEN: ${{ github.token }}\n          GH_REPO: ${{ github.repository }}\n";
  T.M3.PACKAGE_SH = PACKAGE_SH; T.M3.RELEASE_WF = RELEASE_WF;
  function releaseWorld(sys) {
    world(sys);
    var st = cliSteps();
    st.push({ msg: "chore: release 1.4.1", by: "maya", at: "2026-11-06 10:00", files: { "VERSION": "1.4.1\n", "scripts/package.sh": PACKAGE_SH }, exec: ["scripts/package.sh"] });
    st.push({ tag: "v1.4.1", msg: "kc 1.4.1", by: "maya", at: "2026-11-06 10:05" });
    st.push({ msg: "feat: kc status --json shows the region (#14)", by: "ana", at: "2026-11-09 11:00", files: { "lib/status.sh": "# kc status [--json]\nif [ \"${1:-}\" = \"--json\" ]; then echo '{\"status\":\"ok\",\"region\":\"eu-west-1\"}'; else echo \"all systems ok (eu-west-1)\"; fi\n" } });
    st.push({ msg: "feat: kc logs --follow streams new lines (#15)", by: "ben", at: "2026-11-10 15:00", files: { "lib/logs.sh": "# kc logs [--follow]\necho \"(no logs yet)\"\n[ \"${1:-}\" = \"--follow\" ] && echo \"(following...)\"\n" } });
    GH.seed(sys, "kestrel/kestrel-cli", { steps: st }, { description: "kc, the Kestrel Cloud CLI" });
    var r = GH.find(sys, "kestrel/kestrel-cli");
    r.collab["kc-dev"] = "admin";
    var shaOf = function (re) { var s = r.refs["refs/heads/main"]; while (s) { var co = G.commitOf(sys, s); if (re.test(co.message)) return s; s = co.parents[0]; } return null; };
    [[14, "feat: kc status --json shows the region", "ana-silva", /\(#14\)/], [15, "feat: kc logs --follow streams new lines", "ben-okoro", /\(#15\)/]].forEach(function (p) {
      r.items.push({ n: p[0], type: "pr", title: p[1], body: "", author: p[2], state: "merged", draft: false, labels: [], assignees: [], comments: [], reviews: [], reviewers: [], created: G.clock(sys) - 86400 * 4, base: "main", head: "feature/" + p[0], headRepo: r.full, mergedSha: shaOf(p[3]), mergedBy: "maya-chen", method: "squash", checks: {}, autoMerge: null });
    });
    r.items.push({ n: 13, type: "issue", title: "Publish releases on GitHub", body: "So people can download kc without cloning.", author: "maya-chen", state: "open", labels: [], assignees: [], comments: [], created: G.clock(sys) - 86400 * 6, closedBy: null, reason: null });
    GH.cloneTo(sys, "kestrel/kestrel-cli", HOME + "/kestrel-cli");
  }
  LABS.push({
    id: "gt-125", n: 25, module: 3, ticket: "GT-125", xp: 210,
    title: "Releases",
    topic: "artifacts, tag-triggered releases, GITHUB_TOKEN",
    from: MAYA,
    story: "<p>People want to download <code>kc</code> without cloning the repository (issue #13). Make <b>tags</b> publish releases: pushing <code>v1.5.0</code> should build the tarball on GitHub, and create a GitHub release with the tarball, its checksum, and notes listing the merged pull requests. Then ship 1.5.0. <code>scripts/package.sh</code> already builds <code>dist/</code>. The repository is in <code>~/kestrel-cli</code>.</p>",
    learn:
      "<h3>Artifacts: passing files between jobs</h3><p>Each job runs on its own fresh machine, so files don't carry over. An <b>artifact</b> is a set of files a job uploads, which later jobs (or people) download:</p>" +
      code("      - uses: actions/upload-artifact@v4\n        with:\n          name: dist\n          path: dist/\n...\n      - uses: actions/download-artifact@v4\n        with:\n          name: dist\n          path: dist") +
      "<p>From the terminal: <code>gh run download RUN_ID -n dist</code>. Artifacts expire (90 days by default) and are tied to one run; a <b>release</b> is permanent and public.</p>" +
      "<h3>Releases</h3>" + code("gh release create v1.5.0 dist/* --generate-notes   # notes from merged PRs since the last tag\ngh release list\ngh release view v1.5.0\ngh release download v1.5.0 -D ~/downloads") +
      "<h3>The workflow's own token</h3><p>Every job gets a <code>GITHUB_TOKEN</code> (<code>${{ github.token }}</code>) that can act on <i>this</i> repository and expires when the job ends. <code>gh</code> uses it when it's in <code>GH_TOKEN</code>. Its powers come from <code>permissions:</code>; Kestrel's repositories default to read-only, so a job that creates a release must ask for <code>contents: write</code>. Ask for it only on that job:</p>" +
      code("permissions:\n  contents: read          # the default for every job\n\njobs:\n  publish:\n    permissions:\n      contents: write     # only this job can create releases") +
      "<p>Without it, <code>gh release create</code> fails with <i>Resource not accessible by integration</i>. A job that never checks out the code has no Git repository for <code>gh</code> to look at, so name the repository too:</p>" +
      code("      - run: gh release create \"$GITHUB_REF_NAME\" dist/* --generate-notes\n        env:\n          GH_TOKEN: ${{ github.token }}\n          GH_REPO: ${{ github.repository }}") +
      "<h3>Starting the workflow from a tag</h3>" + code("on:\n  push:\n    tags: ['v*']") + "<p>Inside, <code>$GITHUB_REF_NAME</code> is the tag (<code>v1.5.0</code>). Bump <code>VERSION</code>, commit, push, then tag and push the tag: the tag is what starts the release.</p>" +
      "<h3>Checksums</h3><p>A <code>.sha256</code> file next to a download lets anyone check they got exactly what was built: <code>sha256sum -c kc-1.5.0.tar.gz.sha256</code> prints <code>OK</code>.</p>",
    system: releaseWorld,
    starter: "",
    objectives: [
      {
        id: "workflow", text: "Add <code>.github/workflows/release.yml</code> on <code>main</code>: on pushes of tags <code>v*</code>, a job <code>build</code> runs <code>scripts/package.sh</code> and uploads <code>dist/</code> as an artifact named <code>dist</code>; a job <code>publish</code> (after <code>build</code>) downloads it and creates the release for the tag with generated notes. Only <code>publish</code> may write to the repository.",
        hints: ["on: push: tags: ['v*']. permissions: contents: read at the top, contents: write on publish only. upload-artifact / download-artifact, then gh release create \"$GITHUB_REF_NAME\" dist/* --generate-notes with GH_TOKEN: ${{ github.token }}.", "The Learn tab has every piece; put them together in nano .github/workflows/release.yml, commit, push."],
        check: function (r) {
          var w = wfsOn(r, "kestrel/kestrel-cli", "main").filter(function (x) { return /release\.ya?ml$/.test(x.path); })[0];
          if (!w) return "main has no .github/workflows/release.yml.";
          if (w.errors.length) return "GitHub can't read release.yml: " + w.errors[0];
          var p = w.on.push;
          if (!p || !p.tags || !A.matchList(p.tags, "v1.5.0") || A.matchList(A.list(p.branches || []), "main")) return "It should run on pushes of v* tags (push: tags: ['v*']), not on branch pushes.";
          var js = jobsOf(w), b = js.build, pub = js.publish;
          if (!b || !pub) return "Name the jobs build and publish.";
          if (!runStep(b, /scripts\/package\.sh/) || !steps(b).some(function (s) { return s && /upload-artifact@v4/.test(s.uses || "") && s["with"] && s["with"].name === "dist"; })) return "build should run scripts/package.sh and upload dist/ with actions/upload-artifact@v4 (name: dist).";
          if (A.list(pub.needs).indexOf("build") < 0 || !usesStep(pub, /download-artifact@v4/) || !runStep(pub, /gh\s+release\s+create/)) return "publish needs: build, downloads the dist artifact, and runs gh release create.";
          var x = gh(r, "kestrel/kestrel-cli"), pb = A.permsFor(x, w.doc.permissions, b.permissions, false), pp = A.permsFor(x, w.doc.permissions, pub.permissions, false);
          if (pp.contents !== "write") return "publish needs permissions: contents: write to create a release.";
          return pb.contents === "write" ? "Only publish should get contents: write; build must stay read-only (permissions: contents: read at the top)." : true;
        }
      },
      {
        id: "ship", text: "Ship <b>1.5.0</b>: set <code>VERSION</code> to <code>1.5.0</code> on <code>main</code>, then push an annotated tag <code>v1.5.0</code>. The release it creates has the tarball <code>kc-1.5.0.tar.gz</code>, its <code>.sha256</code>, and notes that list pull requests #14 and #15.",
        hints: ["echo 1.5.0 > VERSION, commit (chore: release 1.5.0), push; git tag -a v1.5.0 -m 'kc 1.5.0'; git push origin v1.5.0. gh run list, gh release view v1.5.0.", "echo 1.5.0 > VERSION\ngit commit -am 'chore: release 1.5.0'\ngit push\ngit tag -a v1.5.0 -m 'kc 1.5.0'\ngit push origin v1.5.0\ngh release view v1.5.0"],
        check: function (r) {
          var x = gh(r, "kestrel/kestrel-cli"), rel = (x.releases || []).filter(function (z) { return z.tag === "v1.5.0"; })[0];
          if (!rel) { var bad = x.runs.filter(function (z) { return z.ref === "refs/tags/v1.5.0"; })[0]; return bad ? "The Release run for v1.5.0 didn't create a release: gh run view " + bad.id + " --log-failed. (Fix the workflow, then delete and re-push the tag: git push --delete origin v1.5.0, git tag -d v1.5.0.)" : "No release v1.5.0 yet. Push the tag v1.5.0."; }
          if (rel.author !== GH.BOT) return "The release should come from the workflow (github-actions[bot]), not from your laptop.";
          var v = G.commitFlat(r.sys, G.peel(r.sys, x.refs["refs/tags/v1.5.0"])).VERSION;
          if (!v || G.blobText(r.sys, v.sha).trim() !== "1.5.0") return "The tagged commit should have VERSION 1.5.0: bump it before tagging.";
          if (G.getObject(r.sys, x.refs["refs/tags/v1.5.0"]).type !== "tag") return "Use an annotated tag (git tag -a v1.5.0 -m ...).";
          var names = rel.assets.map(function (a) { return a.name; });
          if (names.indexOf("kc-1.5.0.tar.gz") < 0 || names.indexOf("kc-1.5.0.tar.gz.sha256") < 0) return "The release should have kc-1.5.0.tar.gz and kc-1.5.0.tar.gz.sha256 (it has: " + (names.join(", ") || "nothing") + ").";
          return /\/pull\/14\b/.test(rel.body) && /\/pull\/15\b/.test(rel.body) ? true : "The notes should list #14 and #15: use --generate-notes.";
        }
      },
      {
        id: "verify", text: "Download the release's files to <code>~/downloads</code> and verify the tarball against its checksum.",
        hints: ["gh release download v1.5.0 -D ~/downloads, then cd ~/downloads and sha256sum -c the .sha256 file.", "gh release download v1.5.0 -D ~/downloads\ncd ~/downloads\nsha256sum -c kc-1.5.0.tar.gz.sha256"],
        check: function (r) {
          if (!r.exists("~/downloads/kc-1.5.0.tar.gz")) return "~/downloads should have kc-1.5.0.tar.gz (gh release download v1.5.0 -D ~/downloads).";
          return ran(r, /sha256sum\s+(-c|--check)/, function (e) { return outHas(e, /^kc-1\.5\.0\.tar\.gz: OK$/); }) ? true : "In ~/downloads, sha256sum -c kc-1.5.0.tar.gz.sha256 should print kc-1.5.0.tar.gz: OK.";
        }
      }
    ],
    solution: sol("cd ~/kestrel-cli", "git log --oneline v1.4.1..main", "mkdir -p .github/workflows", { nano: ".github/workflows/release.yml", text: RELEASE_WF }, "git add .github", "git commit -m 'ci: publish a GitHub release for every v* tag'",
      "echo 1.5.0 > VERSION", "git commit -am 'chore: release 1.5.0'", "git push", "git tag -a v1.5.0 -m 'kc 1.5.0'", "git push origin v1.5.0",
      "gh run list", "gh release view v1.5.0", "gh release download v1.5.0 -D ~/downloads", "cd ~/downloads", "sha256sum -c kc-1.5.0.tar.gz.sha256"),
    debrief: "<p>A tag is now the only thing a maintainer does to ship: GitHub builds on a clean runner, hands the files from <code>build</code> to <code>publish</code> as an artifact, and publishes a release with notes written from the merged pull requests. You checked the download against its checksum, which is what careful users of <code>kc</code> will do too.</p><p>The token was scoped tight: only the job that publishes could write. If a build step were ever compromised (say, by a malicious dependency), it couldn't touch the repository. Next: what to do when a run goes red and the reason isn't obvious.</p>",
    realworld: "gh release list -R cli/cli shows the gh CLI's own releases; gh release view -R cli/cli shows the latest notes, generated the same way. Many projects also attach checksums (and signatures, Module 4).",
    quiz: [
      { q: "Why can't the publish job just read dist/ from the build job's disk?", options: ["It can", "Each job runs on its own fresh runner: files move as artifacts", "dist/ is in .gitignore", "Releases can't read files"], answer: 1, why: "Jobs don't share a filesystem. upload-artifact / download-artifact carry files between them." },
      { q: "gh release create in a job fails with \"Resource not accessible by integration\". Fix?", options: ["Use your personal token", "Give that job permissions: contents: write", "Make the repository public", "Run it twice"], answer: 1, why: "The GITHUB_TOKEN only has the permissions the workflow asks for; read-only by default here." },
      { q: "What does sha256sum -c FILE.sha256 prove?", options: ["Who built the file", "The file is byte-for-byte what was checksummed", "The file has no viruses", "The file is the newest release"], answer: 1, why: "Same bytes, same hash. (Who built it is what signatures are for, in Module 4.)" }
    ]
  });

  /* ================================================================== GT-126 Debugging runs */
  var BROKEN_PKG = Object.assign({}, WEB_PKG, { dependencies: { marked: "^14.1.0", dayjs: "^1.11.13" } });
  var CI_NOTIFY = "name: CI\n\non:\n  push:\n    branches: [main]\n  pull_request:\n\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n      - uses: actions/setup-node@v4\n        with:\n          node-version: 22\n      - run: npm ci\n      - run: ./test/run.sh\n\n  notify:\n    needs: test\n    runs-on: ubuntu-latest\n    steps:\n      - run: |\n          curl -fsS -X POST \"$WEBHOOK\" -d \"text=CI passed for $GITHUB_REPOSITORY@$GITHUB_SHA\"\n        env:\n          WEBHOOK: ${{ secrets.CHAT_WEBHOOK }}\n";
  var CI_NOTIFY_BROKEN = CI_NOTIFY.replace("      - run: npm ci\n      - run: ./test/run.sh\n", "      - run: npm ci\n       - run: ./test/run.sh\n");
  T.M3.CI_NOTIFY = CI_NOTIFY;
  function debugWorld(sys) {
    webWorld({ admin: true, steps: [{ msg: "ci: run the tests on GitHub Actions (#4)", by: "ben", at: "2026-11-03 10:00", files: { ".github/workflows/ci.yml": CI_BASIC } }] })(sys);
    var hook = A.chatHook(sys, "#ci");
    G.putFile(sys, HOME + "/chat-webhook.txt", hook + "\n", 384, 1000, 1000);
    sys.lab = { hook: hook };
    var r = GH.find(sys, "kestrel/kestrel-web");
    r.refs["refs/heads/feature/changelog"] = r.refs["refs/heads/main"];
    var flat = G.commitFlat(sys, r.refs["refs/heads/main"]);
    var files = { "site/changelog.html": page("Changelog", "<h1>Changelog</h1>\n<p>2.3: dark mode.</p>\n<a href=\"index.html\">Home</a>"), "package.json": JSON.stringify(BROKEN_PKG, null, 2) + "\n", ".github/workflows/ci.yml": CI_NOTIFY_BROKEN };
    GH.commit(sys, "kestrel/kestrel-web", "feature/changelog", "ben", "Add a changelog page", files);
    // test/run.sh loses its executable bit on the branch
    var t = r.refs["refs/heads/feature/changelog"], f2 = G.commitFlat(sys, t);
    f2["test/run.sh"] = { sha: f2["test/run.sh"].sha, mode: "100644" };
    var who = Object.assign({}, G.person("ben"), { time: G.clock(sys) - 60, tz: "+0000" });
    r.refs["refs/heads/feature/changelog"] = G.putObject(sys, { type: "commit", tree: G.writeTree(sys, f2), parents: [t], author: who, committer: who, message: "Tidy up the test script\n" });
    GH.openPR(sys, "kestrel/kestrel-web", { title: "Add a changelog page", body: "Adds site/changelog.html. CI is unhappy and I can't see why, can you take a look?", author: "ben-okoro", head: "feature/changelog" });
    GH.find(sys, "kestrel/kestrel-web").collab["ben-okoro"] = "write";
  }
  function prRuns(r) { var p = GH.item(gh(r, "kestrel/kestrel-web"), 1); return runs(r, "kestrel/kestrel-web", function (x) { return x.pr === 1 && x.headSha === GH.prHeadSha(r.sys, gh(r, "kestrel/kestrel-web"), p); }); }
  LABS.push({
    id: "gt-126", n: 26, module: 3, ticket: "GT-126", xp: 220,
    title: "Debugging runs",
    topic: "invalid workflows, logs, re-runs",
    from: BEN,
    story: "<p>My pull request #1 (a changelog page) is red and I can't work out why. I also added a <code>notify</code> job that posts to our <code>#ci</code> chat channel; the webhook URL is in <code>~/chat-webhook.txt</code>, but I never stored it as the <code>CHAT_WEBHOOK</code> secret. Can you get my pull request green? Push fixes to my branch <code>feature/changelog</code> (the repository is in <code>~/kestrel-web</code>).</p>",
    learn:
      "<h3>Read before you change anything</h3>" +
      code("gh pr checks 1                 # which checks failed\ngh run list -b feature/changelog\ngh run view RUN_ID              # jobs, failed steps, annotations\ngh run view RUN_ID --log-failed # just the failing steps' output") +
      '<table class="t"><tr><th>You see</th><th>It means</th></tr>' +
      "<tr><td><i>This run likely failed because of a workflow file issue</i>, no jobs</td><td>GitHub couldn't read the YAML. The annotation names the line.</td></tr>" +
      "<tr><td>A job stuck on <i>Waiting for a runner</i></td><td>No runner has that <code>runs-on</code> label (a typo like <code>ubuntu-lastest</code>).</td></tr>" +
      "<tr><td><i>Unable to resolve action</i></td><td>A wrong <code>uses:</code> name or version.</td></tr>" +
      "<tr><td><i>Process completed with exit code N</i></td><td>A command in a <code>run:</code> step failed: the lines just above it say which and why.</td></tr></table>" +
      "<h3>Reproduce locally</h3><p>Most failures in a <code>run:</code> step fail on your laptop too, with the same command: <code>npm ci</code>, <code>./test/run.sh</code>. Fix it there, then push.</p>" +
      "<h3>Two classics</h3><p><b>Permission denied</b> on <code>./script.sh</code>: Git stores an executable bit per file, and this one lost it. <code>git update-index --chmod=+x FILE</code> (or <code>chmod +x</code> then <code>git add</code>) records it. <b>npm ci</b> complaining the lock file is out of sync: someone edited <code>package.json</code> without running <code>npm install</code>; run it and commit <code>package-lock.json</code>.</p>" +
      "<h3>Re-run, or push?</h3><p>A re-run repeats the <b>same commit</b> with the same workflow file, so it only helps when the cause was outside the repository: a secret that was missing, a service that was down. <code>gh run rerun RUN_ID --failed</code> re-runs just the failed jobs (and what depends on them) and keeps the jobs that passed. For anything in the code or the YAML, fix it and push.</p>" +
      "<h3>More detail</h3><p><code>gh run rerun RUN_ID --debug</code> re-runs with debug logging, and a repository secret <code>ACTIONS_STEP_DEBUG=true</code> turns it on for every run.</p>",
    system: debugWorld,
    starter: "",
    objectives: [
      {
        id: "yaml", text: "Get GitHub to read the CI workflow on Ben's branch again (find the broken line from the run, fix it, push).",
        hints: ["gh run list -b feature/changelog, then gh run view RUN_ID: the annotation says which line. Check out the branch, fix the indentation in .github/workflows/ci.yml, commit, push.", "git fetch\ngit switch feature/changelog\nnano .github/workflows/ci.yml    # '- run: ./test/run.sh' must line up with the other steps\ngit commit -am 'ci: fix the steps indentation'\ngit push"],
        check: function (r) { var rs = prRuns(r).filter(function (x) { return x.wfPath === ".github/workflows/ci.yml"; }); if (!rs.length) return "No CI run on the pull request's latest commit yet: push your fix to feature/changelog."; return rs[0].error ? "CI's workflow file is still invalid on the latest commit: gh run view " + rs[0].id : true; }
      },
      {
        id: "green", text: "Make the <code>test</code> job pass on the pull request.",
        hints: ["gh run view RUN_ID --log-failed. Then reproduce on your laptop: npm ci, ./test/run.sh. Two separate problems.", "npm install                         # updates package-lock.json for dayjs\ngit update-index --chmod=+x test/run.sh\ngit add package-lock.json\ngit commit -m 'fix: sync the lock file and make the tests executable'\ngit push"],
        check: function (r) {
          var rs = prRuns(r).filter(function (x) { return !x.error && x.wfName === "CI"; }); if (!rs.length) return "No readable CI run on the latest commit yet.";
          var j = rs[0].jobs.filter(function (x) { return x.key === "test"; })[0];
          if (!j || !ok(j)) return "The test job still fails on the latest commit: gh run view " + rs[0].id + " --log-failed.";
          var head = GH.prHeadSha(r.sys, gh(r, "kestrel/kestrel-web"), GH.item(gh(r, "kestrel/kestrel-web"), 1)), flat = G.commitFlat(r.sys, head);
          if (!flat["package.json"] || JSON.parse(G.blobText(r.sys, flat["package.json"].sha)).dependencies.dayjs === undefined) return "Keep Ben's dayjs dependency: update the lock file instead of removing it.";
          return /all pages ok/.test(logOf(j)) ? true : "The tests didn't run in the test job.";
        }
      },
      {
        id: "rerun", text: "Store the webhook from <code>~/chat-webhook.txt</code> as the repository secret <code>CHAT_WEBHOOK</code>, delete the file, and get <code>notify</code> green by re-running <b>only the failed jobs</b> of the existing run.",
        hints: ["gh secret set CHAT_WEBHOOK < ~/chat-webhook.txt, rm it, then gh run rerun RUN_ID --failed on the newest CI run.", "gh secret set CHAT_WEBHOOK < ~/chat-webhook.txt\nrm ~/chat-webhook.txt\ngh run rerun RUN_ID --failed"],
        check: function (r) {
          var x = gh(r, "kestrel/kestrel-web"), lab = r.sys.lab;
          if (!x.secrets.CHAT_WEBHOOK || x.secrets.CHAT_WEBHOOK.value !== lab.hook) return "The repository secret CHAT_WEBHOOK should hold the URL from ~/chat-webhook.txt (gh secret set CHAT_WEBHOOK < ~/chat-webhook.txt).";
          if (r.exists("~/chat-webhook.txt")) return "Delete ~/chat-webhook.txt once it's stored.";
          var hit = x.runs.filter(function (run) { return run.pr === 1 && run.attempt > 1 && run.conclusion === "success" && run.attempts.length && run.attempts[run.attempts.length - 1].jobs.some(function (j) { return j.key === "notify" && j.conclusion === "failure"; }); })[0];
          if (!hit) return A.svc(r.sys).messages.length ? "notify posted, but not from a re-run of a failed run: use gh run rerun RUN_ID --failed on the run whose notify job failed." : "Re-run the failed jobs of the run whose notify job failed (gh run rerun RUN_ID --failed).";
          var prev = hit.attempts[hit.attempts.length - 1].jobs.filter(function (j) { return j.key === "test"; })[0], now0 = hit.jobs.filter(function (j) { return j.key === "test"; })[0];
          return prev && now0 && prev.id === now0.id ? true : "That re-ran every job. Use --failed to re-run only what failed.";
        }
      }
    ],
    solution: sol("cd ~/kestrel-web", "gh pr checks 1", "gh run list -b feature/changelog", "gh run view $(gh run list -b feature/changelog -L 1 --json databaseId -q '.[0].databaseId')",
      "git fetch", "git switch feature/changelog", "sed -i 's/^       - run: .\\/test\\/run.sh/      - run: .\\/test\\/run.sh/' .github/workflows/ci.yml", "git commit -am 'ci: fix the steps indentation'", "git push",
      "gh run view $(gh run list -b feature/changelog -L 1 --json databaseId -q '.[0].databaseId') --log-failed", "npm ci", "npm install", "./test/run.sh",
      "git update-index --chmod=+x test/run.sh", "git add package-lock.json", "git commit -m 'fix: sync the lock file and make the tests executable'", "git push",
      "gh run view $(gh run list -b feature/changelog -L 1 --json databaseId -q '.[0].databaseId')",
      "gh secret set CHAT_WEBHOOK < ~/chat-webhook.txt", "rm ~/chat-webhook.txt", "gh run rerun $(gh run list -b feature/changelog -L 1 --json databaseId -q '.[0].databaseId') --failed", "gh pr checks 1"),
    debrief: "<p>Three different kinds of failure, three different fixes: a YAML file GitHub couldn't read (fix and push), problems in the repository that failed on your laptop too (fix and push), and a missing secret, which lives outside the repository, so a <b>re-run of just the failed job</b> was enough.</p><p>The habit that found all three: read the run first (<code>gh run view</code>, <code>--log-failed</code>), then reproduce locally. Last ticket of the module: a whole pipeline, from pull request to production to release.</p>",
    realworld: "Next time a run fails on a project you work on, try gh run view RUN_ID --log-failed before opening the browser. For workflow files, actionlint (github.com/rhysd/actionlint) catches most YAML and expression mistakes before you push.",
    quiz: [
      { q: "A run failed because a secret was missing. You've added it. Fastest fix?", options: ["Push an empty commit", "gh run rerun RUN_ID --failed", "Delete the workflow", "Rename the branch"], answer: 1, why: "Nothing in the repository changed, so re-running the failed jobs with the new secret is enough." },
      { q: "./test.sh: Permission denied, in CI only. Likely cause?", options: ["The runner is broken", "The file isn't executable in Git (mode 100644)", "A missing secret", "Wrong Node version"], answer: 1, why: "Git tracks the executable bit; git update-index --chmod=+x sets it in the repository." },
      { q: "You fixed a typo in the workflow YAML. Will gh run rerun pick it up?", options: ["Yes", "No: a re-run uses the same commit's workflow file; push the fix", "Only with --debug", "Only for scheduled runs"], answer: 1, why: "Re-runs replay the same commit. Changes need a new push." }
    ]
  });

  /* ================================================================== GT-127 Capstone: a full pipeline */
  var STATUS_PKG = { name: "kestrel-status", version: "1.0.0", private: true, description: "status.kestrel.io", scripts: { test: "bash test/run.sh", build: "bash scripts/build.sh" }, engines: { node: ">=22" }, dependencies: { marked: "^14.1.0" }, files: ["site", "scripts", "VERSION"] };
  var STATUS_DEPLOY = DEPLOY_SH;
  var STATUS_BUILD = "#!/bin/bash\n# Build the status page into dist/\nset -e\nDIST=dist\nrm -rf $DIST\nmkdir -p \"$DIST\"\ncp site/*.html \"$DIST\"/\necho \"built status page into $DIST/\"\n";
  function statusFiles() {
    return {
      "README.md": "# kestrel-status\n\nThe public status page, status.kestrel.io.\n\n    npm ci && npm test && npm run build\n",
      "package.json": JSON.stringify(STATUS_PKG, null, 2) + "\n", "package-lock.json": A.lockFor(STATUS_PKG), ".gitignore": "node_modules/\ndist/\n", "VERSION": "1.0.0\n",
      "test/run.sh": WEB_TEST, "scripts/build.sh": STATUS_BUILD, "scripts/deploy.sh": STATUS_DEPLOY,
      "site/index.html": page("Kestrel status", "<h1>All systems operational</h1>\n<a href=\"history.html\">Incident history</a>"),
      "site/history.html": page("Incident history", "<h1>Incident history</h1>\n<p>No incidents in the last 90 days.</p>\n<a href=\"index.html\">Status</a>")
    };
  }
  T.M3.statusFiles = statusFiles; T.M3.STATUS_PKG = STATUS_PKG;
  function capWorld(sys) {
    world(sys);
    A.installNode(sys);
    GH.seed(sys, "kestrel/kestrel-status", { steps: [{ msg: "Status page 1.0", by: "maya", at: "2026-11-02 10:00", files: statusFiles(), exec: ["test/run.sh", "scripts/build.sh", "scripts/deploy.sh"] }] }, { description: "status.kestrel.io" });
    var r = GH.find(sys, "kestrel/kestrel-status");
    r.collab["kc-dev"] = "admin";
    envs(sys, "kestrel/kestrel-status", { site: "kestrel-status", prodToken: true, stagingToken: true });
    GH.issue(sys, "kestrel/kestrel-status", { n: 1, title: "Show when the page was last updated", body: "Add a line like <p>Last updated: 2026-11-13</p> to the status page (site/index.html).", author: "maya-chen", labels: ["enhancement"], assignees: ["kc-dev"], daysAgo: 1 });
    mayaReviewsWhenGreen(sys, "kestrel/kestrel-status");
    GH.cloneTo(sys, "kestrel/kestrel-status", HOME + "/kestrel-status");
  }
  var CAP_CI = "name: CI\n\non:\n  push:\n    branches: [main]\n  pull_request:\n\npermissions:\n  contents: read\n\njobs:\n  lint:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n      - run: shellcheck scripts/*.sh test/*.sh\n\n  test:\n    runs-on: ubuntu-latest\n    strategy:\n      fail-fast: false\n      matrix:\n        node: [22, 24]\n    steps:\n      - uses: actions/checkout@v4\n      - uses: actions/setup-node@v4\n        with:\n          node-version: ${{ matrix.node }}\n          cache: npm\n      - run: npm ci\n      - run: npm test\n";
  var CAP_DEPLOY = "name: Deploy\n\non:\n  push:\n    branches: [main]\n\npermissions:\n  contents: read\n\njobs:\n  staging:\n    runs-on: ubuntu-latest\n    environment: staging\n    steps:\n      - uses: actions/checkout@v4\n      - run: bash scripts/deploy.sh\n        env:\n          DEPLOY_TOKEN: ${{ secrets.DEPLOY_TOKEN }}\n          SITE: ${{ vars.SITE }}\n\n  production:\n    needs: staging\n    runs-on: ubuntu-latest\n    environment: production\n    steps:\n      - uses: actions/checkout@v4\n      - run: bash scripts/deploy.sh\n        env:\n          DEPLOY_TOKEN: ${{ secrets.DEPLOY_TOKEN }}\n          SITE: ${{ vars.SITE }}\n";
  var CAP_RELEASE = "name: Release\n\non:\n  push:\n    tags: ['v*']\n\npermissions:\n  contents: read\n\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n      - uses: actions/setup-node@v4\n        with:\n          node-version: 24\n      - run: npm pack\n      - uses: actions/upload-artifact@v4\n        with:\n          name: package\n          path: '*.tgz'\n\n  publish:\n    needs: build\n    runs-on: ubuntu-latest\n    permissions:\n      contents: write\n    steps:\n      - uses: actions/download-artifact@v4\n        with:\n          name: package\n      - run: gh release create \"$GITHUB_REF_NAME\" *.tgz --generate-notes\n        env:\n          GH_TOKEN: ${{ github.token }}\n          GH_REPO: ${{ github.repository }}\n";
  var CAP_PROTECT = "{\n  \"required_status_checks\": { \"strict\": true, \"contexts\": [\"lint\", \"test (22)\", \"test (24)\"] },\n  \"enforce_admins\": true,\n  \"required_pull_request_reviews\": { \"required_approving_review_count\": 1 },\n  \"restrictions\": null\n}\n";
  function capPR(r) { return prs(r, "kestrel/kestrel-status").filter(function (p) { return p.state === "merged" && /Last updated/i.test(G.blobText(r.sys, G.commitFlat(r.sys, p.mergedSha)["site/index.html"].sha)); })[0]; }
  LABS.push({
    id: "gt-127", n: 27, module: 3, ticket: "GT-127", xp: 300, capstone: true,
    title: "A full pipeline for Kestrel",
    topic: "Module 3 capstone",
    from: MAYA,
    story: "<p>The new status page, <code>kestrel/kestrel-status</code> (cloned in <code>~/kestrel-status</code>), has no automation at all. Give it the whole pipeline, then ship issue #1 through it. You're an admin. The <code>staging</code> and <code>production</code> environments exist with their <code>DEPLOY_TOKEN</code> secrets; production needs my approval and only accepts <code>main</code>. I review pull requests once their checks are green.</p>" +
      '<table class="t"><tr><th>Done means</th></tr>' +
      "<tr><td><b>CI</b> on pull requests and pushes to <code>main</code>: a <code>lint</code> job (ShellCheck on the scripts) and a <code>test</code> job on Node 22 and 24 with npm caching, and it's green</td></tr>" +
      "<tr><td><code>main</code> is <b>protected</b>: <code>lint</code>, <code>test (22)</code> and <code>test (24)</code> must pass, plus one approval, for everyone</td></tr>" +
      "<tr><td>Issue #1 shipped through a pull request that <b>merged itself</b> (auto-merge) once checks and review passed, closing the issue</td></tr>" +
      "<tr><td>Every push to <code>main</code> <b>deploys</b> to staging, then production (site <code>kestrel-status</code>); the merged change is live on both</td></tr>" +
      "<tr><td>A <b>v1.1.0</b> release built by Actions with the <code>npm pack</code> tarball, where only the publishing job may write</td></tr></table>",
    learn: "<p>Everything from this module, in one repository. Order matters: workflows first (a check can't be required before it has ever run), then protection, then the feature through a pull request with <code>gh pr merge --auto --squash</code> (repository setting: <code>gh repo edit --enable-auto-merge</code>), then the release tag. Branch protection is set with <code>gh api -X PUT repos/OWNER/REPO/branches/main/protection --input FILE.json</code>, as in Module 2. If CI is red, read it before you change anything.</p>",
    system: capWorld,
    starter: "",
    objectives: [
      {
        id: "ci", hints: [], text: "CI runs <code>lint</code> and <code>test (22)</code> / <code>test (24)</code> with npm caching, and all three pass on a pull request.",
        check: function (r) {
          var w = wfsOn(r, "kestrel/kestrel-status", "main").filter(function (x) { return x.name === "CI"; })[0];
          if (!w) return "main has no workflow named CI yet.";
          if (w.errors.length) return "GitHub can't read the CI workflow: " + w.errors[0];
          if (!("pull_request" in w.on) || !("push" in w.on)) return "CI should run on pull requests and pushes to main.";
          var js = jobsOf(w);
          if (!js.lint || !runStep(js.lint, /shellcheck/)) return "Add a lint job that runs shellcheck on the scripts.";
          if (!js.test || !steps(js.test).some(function (s) { return s && /setup-node/.test(s.uses || "") && s["with"] && s["with"].cache === "npm"; })) return "The test job should set up Node with cache: npm.";
          var good = runs(r, "kestrel/kestrel-status", function (x) { return x.event === "pull_request" && x.wfName === "CI"; }).some(function (run) { var n = run.jobs.filter(ok).map(function (j) { return j.name; }); return ["lint", "test (22)", "test (24)"].every(function (k) { return n.indexOf(k) >= 0; }); });
          return good ? true : "No pull request run yet where lint, test (22) and test (24) all passed.";
        }
      },
      {
        id: "protect", hints: [], text: "<code>main</code> requires <code>lint</code>, <code>test (22)</code>, <code>test (24)</code> and one approving review, admins included.",
        check: function (r) {
          var p = gh(r, "kestrel/kestrel-status").protect.main;
          if (!p) return "main isn't protected yet.";
          var ctx = p.checks ? p.checks.contexts : [];
          var miss = ["lint", "test (22)", "test (24)"].filter(function (k) { return ctx.indexOf(k) < 0; });
          if (miss.length) return "Required status checks are missing: " + miss.join(", ") + " (exactly the job names).";
          if (!p.pr || p.pr.count < 1) return "Require at least one approving review.";
          return p.enforceAdmins ? true : "Apply the rules to admins too (enforce_admins).";
        }
      },
      {
        id: "ship", hints: [], text: "Issue #1 shipped through a pull request that merged itself with auto-merge after checks and Maya's review, and closed the issue.",
        check: function (r) {
          var p = capPR(r);
          if (!p) return "No merged pull request adds 'Last updated' to site/index.html yet.";
          if (!p.autoMerged && !p.autoRequested) return "That pull request was merged by hand. Use auto-merge: gh pr merge --auto --squash (it merges as soon as checks and review allow).";
          if (GH.latestReviews(r.sys, gh(r, "kestrel/kestrel-status"), p)["maya-chen"] !== "APPROVED") return "It should carry Maya's approval.";
          var i = GH.item(gh(r, "kestrel/kestrel-status"), 1);
          return i.state === "closed" ? true : "Issue #1 should be closed by the pull request (Closes #1 in its description).";
        }
      },
      {
        id: "deploy", hints: [], text: "Pushes to <code>main</code> deploy to staging, then production, and the merged change reached both.",
        check: function (r) {
          var w = wfsOn(r, "kestrel/kestrel-status", "main").filter(function (x) { return x.doc && x.doc.jobs && Object.keys(x.doc.jobs).some(function (k) { var e = x.doc.jobs[k].environment; return (e && (e.name || e)) === "production"; }); })[0];
          if (!w) return "No workflow on main deploys to the production environment yet.";
          var p = capPR(r); if (!p) return "Ship issue #1 first.";
          var d = A.svc(r.sys).deploys.filter(function (x) { return x.from === "actions" && x.site === "kestrel-status" && G.isAncestor(r.sys, p.mergedSha, x.sha); });
          var st = d.some(function (x) { return x.env === "staging"; }), pr = d.some(function (x) { return x.env === "production"; });
          return st && pr ? true : !st ? "The merged change hasn't been deployed to staging by Actions (check the Deploy run, and the SITE variable)." : "Staging has it, production doesn't yet: gh run view the Deploy run.";
        }
      },
      {
        id: "release", hints: [], text: "Release <b>v1.1.0</b> was created by Actions with the <code>npm pack</code> tarball, and only the publishing job had write access.",
        check: function (r) {
          var x = gh(r, "kestrel/kestrel-status"), rel = (x.releases || []).filter(function (z) { return z.tag === "v1.1.0"; })[0];
          if (!rel) return "No release v1.1.0 yet.";
          if (rel.author !== GH.BOT) return "The release should be created by the workflow, not from your laptop.";
          if (!rel.assets.some(function (a) { return /^kestrel-status-1\.1\.0\.tgz$/.test(a.name); })) return "Attach the npm pack tarball (kestrel-status-1.1.0.tgz: bump package.json's version to 1.1.0 first).";
          var w = A.workflowsAt(r.sys, G.peel(r.sys, x.refs["refs/tags/v1.1.0"])).filter(function (z) { return z.on && z.on.push && z.on.push.tags; })[0];
          if (!w) return "The release workflow should start from tags (on: push: tags).";
          var writers = Object.keys(jobsOf(w)).filter(function (k) { return A.permsFor(x, w.doc.permissions, jobsOf(w)[k].permissions, false).contents === "write"; });
          return writers.length === 1 && runStep(jobsOf(w)[writers[0]], /gh\s+release/) ? true : "Exactly one job (the one that runs gh release create) should have contents: write; the others stay read-only.";
        }
      }
    ],
    solution: sol("cd ~/kestrel-status", "git switch -c ci/pipeline", "mkdir -p .github/workflows",
      { nano: ".github/workflows/ci.yml", text: CAP_CI }, { nano: ".github/workflows/deploy.yml", text: CAP_DEPLOY }, { nano: ".github/workflows/release.yml", text: CAP_RELEASE },
      "git add .github", "git commit -m 'ci: lint, test, deploy and release workflows'", "git push -u origin ci/pipeline",
      "gh pr create --title 'ci: lint, test, deploy and release workflows' --body 'The whole pipeline for the status page.'",
      "gh pr checks", "gh run view $(gh run list -b ci/pipeline -L 1 --json databaseId -q '.[0].databaseId') --log-failed",
      "sed -i 's/^rm -rf .DIST$/rm -rf \"$DIST\"/' scripts/build.sh", "git diff", "git commit -am 'fix: quote $DIST in the build script'", "git push",
      "gh variable set SITE --body kestrel-status", "gh pr checks", "gh pr merge --squash --delete-branch", "git pull",
      { nano: "protection.json", text: CAP_PROTECT },
      "gh api -X PUT repos/kestrel/kestrel-status/branches/main/protection --input protection.json", "rm protection.json",
      "gh repo edit --enable-auto-merge",
      "git switch -c feature/last-updated", "sed -i 's#<h1>All systems operational</h1>#<h1>All systems operational</h1>\\n<p>Last updated: 2026-11-13</p>#' site/index.html", "npm test",
      "git commit -am 'feat: show when the status page was last updated'", "git push -u origin feature/last-updated",
      "gh pr create --title 'feat: show when the status page was last updated' --body 'Closes #1'", "gh pr merge --auto --squash --delete-branch",
      "gh pr view", "git switch main", "git pull", "gh run list -w Deploy",
      "sed -i 's/\"version\": \"1.0.0\"/\"version\": \"1.1.0\"/' package.json", "echo 1.1.0 > VERSION", "npm install", "git switch -c chore/release-1.1.0", "git commit -am 'chore: release 1.1.0'", "git push -u origin chore/release-1.1.0",
      "gh pr create --title 'chore: release 1.1.0' --body 'Version bump.'", "gh pr merge --auto --squash --delete-branch", "git switch main", "git pull",
      "git tag -a v1.1.0 -m 'kestrel-status 1.1.0'", "git push origin v1.1.0", "gh release view v1.1.0"),
    debrief: "<p><b>Module 3 complete.</b> A pull request on <code>kestrel-status</code> now gets linted and tested on two Node versions, can't merge until the checks and a reviewer agree, merges itself the moment they do, deploys to staging and (with a human's OK) production, and a tag turns into a published release. Nobody had to remember a single step.</p><p>That's a real CI/CD pipeline, built with the same YAML and commands teams use every day. Module 4 turns to keeping it all safe: secrets that leak into history, signed commits, scanning, and locking down the pipeline itself.</p>",
    realworld: "gh repo edit --enable-auto-merge and gh pr merge --auto --squash work on any repository with branch protection. Combined with required checks, it's how many teams merge most pull requests: approve, and walk away.",
    quiz: []
  });

  LABS.forEach(function (l) { l.drills = []; T.LABS.push(l); });
  T.UPCOMING = T.UPCOMING.filter(function (row) { return row.module !== 3; });
})();
