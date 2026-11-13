/* sudo learn — Git track Module 3 practice drills (3 per lab, +5 XP each). Loaded after labs-m3.js. */
(function () {
  "use strict";
  var G = window.GitCore, GL = window.GitLab, GH = window.GitHub, A = window.GitActions, T = window.GIT_TRACK, X = T.M3, lines = T.lines, sol = X.sol;
  var HOME = "/home/dev";
  function ran(r, re, fn) { return r.history.some(function (e) { return re.test(e.cmd) && (!fn || fn(e)); }); }
  function all(e) { return e.out.concat(e.err); }
  function outHas(e, re) { return all(e).some(function (l) { return re.test(l); }); }
  function gh(r, full) { return GH.find(r.sys, full); }
  function wf(r, full, ref, re) { return X.wfsOn(r, full, ref).filter(function (w) { return re.test(w.path); })[0] || null; }
  function web(o) { return X.webWorld(o); }
  // a kestrel-web whose main already has a workflow file (pushed as a teammate, so it has runs)
  function webWith(files, o) {
    o = o || {};
    return web(Object.assign({}, o, {
      clone: false,
      before: function (sys) { if (o.before) o.before(sys); GH.commit(sys, "kestrel/kestrel-web", "main", "ben", o.msg || "ci: add workflow", files); },
      after: function (sys) { GH.cloneTo(sys, "kestrel/kestrel-web", HOME + "/kestrel-web"); if (o.after) o.after(sys); }
    }));
  }
  function cli(after) {
    return function (sys) {
      X.world(sys);
      GH.seed(sys, "kestrel/kestrel-cli", { steps: X.cliSteps() }, { description: "kc" });
      GH.find(sys, "kestrel/kestrel-cli").collab["kc-dev"] = "admin";
      GH.cloneTo(sys, "kestrel/kestrel-cli", HOME + "/kestrel-cli");
      if (after) after(sys);
    };
  }
  function lastRun(r, full, f) { return X.runs(r, full, f)[0] || null; }
  var CI = X.CI_BASIC;
  var MATRIX2 = "name: CI\non:\n  push:\n    branches: [main]\n  pull_request:\njobs:\n  test:\n    runs-on: ${{ matrix.os }}\n    strategy:\n      matrix:\n        node: [20, 22, 24]\n        os: [ubuntu-latest, ubuntu-22.04]\n    steps:\n      - uses: actions/checkout@v4\n      - uses: actions/setup-node@v4\n        with:\n          node-version: ${{ matrix.node }}\n      - run: npm ci\n      - run: npm test\n";
  var DISPATCH = "name: Smoke\non:\n  workflow_dispatch:\n    inputs:\n      level:\n        type: choice\n        options: [quick, full]\n        default: quick\njobs:\n  smoke:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo \"smoke test, level ${{ inputs.level }}\"\n";
  var BUILD_ART = "name: Build\non:\n  push:\n    branches: [main]\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n      - uses: actions/setup-node@v4\n        with:\n          node-version: 22\n          cache: npm\n      - run: npm ci\n      - run: npm run build\n      - uses: actions/upload-artifact@v4\n        with:\n          name: site\n          path: dist/\n";
  var FAILING = "name: CI\non:\n  push:\n    branches: [main]\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n      - run: npm ci\n      - run: npm test\n";

  var DRILLS = {
    "gt-120": [
      {
        id: "d1", title: "What's unreleased?", system: cli(),
        text: "<p>In <code>~/kestrel-cli</code>, list the commits on <code>main</code> since the <code>v1.4.0</code> tag, one line each.</p>",
        starter: "", solution: lines("cd ~/kestrel-cli", "git log --oneline v1.4.0..main"),
        check: function (r) { return ran(r, /git\s+log\b.*v1\.4\.0\.\.(main|HEAD|origin\/main)?/, function (e) { return e.out.length === 3 && outHas(e, /fix: kc deploy crashes/) && !outHas(e, /kc deploy REGION/); }) ? true : "git log --oneline v1.4.0..main"; }
      },
      {
        id: "d2", title: "A release candidate", system: cli(),
        text: "<p>Tag the tip of <code>main</code> as <code>v1.5.0-rc.1</code> (an annotated tag, message <i>kc 1.5.0 release candidate 1</i>) and push the tag to GitHub.</p>",
        starter: "", solution: lines("cd ~/kestrel-cli", "git tag -a v1.5.0-rc.1 -m 'kc 1.5.0 release candidate 1'", "git push origin v1.5.0-rc.1"),
        check: function (r) { var x = gh(r, "kestrel/kestrel-cli"), t = x.refs["refs/tags/v1.5.0-rc.1"]; if (!t) return "GitHub has no v1.5.0-rc.1 tag yet (push it: git push origin v1.5.0-rc.1)."; if (G.getObject(r.sys, t).type !== "tag") return "Make it annotated (git tag -a ... -m ...)."; return G.peel(r.sys, t) === x.refs["refs/heads/main"] ? true : "Tag the tip of main."; }
      },
      {
        id: "d3", title: "Sweep merged branches", system: cli(function (sys) { var x = GH.find(sys, "kestrel/kestrel-cli"), m = x.refs["refs/heads/main"], p = G.commitOf(sys, m).parents[0]; x.refs["refs/heads/feature/logs"] = m; x.refs["refs/heads/fix/deploy-region"] = p; GH.commit(sys, "kestrel/kestrel-cli", "feature/wip-ui", "ana", "wip: new UI", { "ui.txt": "draft\n" }); }),
        text: "<p>GitHub still has three branches besides <code>main</code>. Delete the two that are already fully merged into <code>main</code> from GitHub; keep the one with unmerged work.</p>",
        starter: "", solution: lines("cd ~/kestrel-cli", "git fetch", "git branch -r --merged origin/main", "git push origin --delete feature/logs fix/deploy-region"),
        check: function (r) { var x = gh(r, "kestrel/kestrel-cli"); if (!x.refs["refs/heads/feature/wip-ui"]) return "feature/wip-ui has unmerged work: it should stay."; return x.refs["refs/heads/feature/logs"] || x.refs["refs/heads/fix/deploy-region"] ? "git branch -r --merged origin/main shows which are merged; git push origin --delete NAME removes them." : true; }
      }
    ],
    "gt-121": [
      {
        id: "d1", title: "Only the failure", system: webWith({ ".github/workflows/ci.yml": FAILING, "site/about.html": X.page("About", "<h1>About</h1>\n<a href=\"team.html\">Team</a>") }, { msg: "Add an about page" }),
        text: "<p>CI on <code>kestrel/kestrel-web</code>'s <code>main</code> is red. Print <b>only</b> the log of the step that failed.</p>",
        starter: "", solution: lines("cd ~/kestrel-web", "gh run list", "gh run view $(gh run list -L 1 --json databaseId -q '.[0].databaseId') --log-failed"),
        check: function (r) { return ran(r, /gh\s+run\s+view\b.*--log-failed/, function (e) { return outHas(e, /links to team\.html/) && !outHas(e, /Run actions\/checkout/); }) ? true : "gh run list for the ID, then gh run view ID --log-failed."; }
      },
      {
        id: "d2", title: "Not every branch", system: webWith({ ".github/workflows/ci.yml": CI.replace("  push:\n    branches: [main]\n", "  push:\n") }),
        text: "<p>CI in <code>~/kestrel-web</code> runs on pushes to <b>every</b> branch, on top of pull requests. Make pushes count only for <code>main</code>, and push the change.</p>",
        starter: "", solution: sol("cd ~/kestrel-web", { nano: ".github/workflows/ci.yml", text: CI }, "git commit -am 'ci: only run pushes on main'", "git push"),
        check: function (r) { var w = wf(r, "kestrel/kestrel-web", "main", /ci\.ya?ml$/); if (!w || w.errors.length) return w ? "GitHub can't read ci.yml: " + w.errors[0] : "Keep .github/workflows/ci.yml."; var p = w.on.push; if (!("pull_request" in w.on)) return "Keep pull_request."; return p && p.branches && A.matchList(p.branches, "main") && !A.matchList(p.branches, "feature/x") && !A.matchList(p.branches, "develop") ? true : "push: needs branches: [main]."; }
      },
      {
        id: "d3", title: "Build it too", system: webWith({ ".github/workflows/ci.yml": CI }),
        text: "<p>Add a step to the <code>test</code> job of <code>~/kestrel-web</code>'s CI that runs <code>npm run build</code> after the tests. Push it to <code>main</code>; the run must pass and show the build.</p>",
        starter: "", solution: sol("cd ~/kestrel-web", { nano: ".github/workflows/ci.yml", text: CI + "      - run: npm run build\n" }, "git commit -am 'ci: build the site too'", "git push"),
        check: function (r) { var run = lastRun(r, "kestrel/kestrel-web", function (x) { return x.event === "push" && x.wfName === "CI"; }); if (!run || run.headSha !== gh(r, "kestrel/kestrel-web").refs["refs/heads/main"]) return "Push your change to main so CI runs."; return run.conclusion === "success" && run.jobs.some(function (j) { return /built \d+ pages into dist/.test(X.logOf(j)); }) ? true : "The latest run should pass and include npm run build."; }
      }
    ],
    "gt-122": [
      {
        id: "d1", title: "One combination too many", system: webWith({ ".github/workflows/ci.yml": MATRIX2 }),
        text: "<p>CI in <code>~/kestrel-web</code> tests 3 Node versions × 2 Ubuntu versions. Node 20 on <code>ubuntu-22.04</code> isn't supported: remove just that combination (5 jobs left), and push.</p>",
        starter: "", solution: sol("cd ~/kestrel-web", { nano: ".github/workflows/ci.yml", text: MATRIX2.replace("        os: [ubuntu-latest, ubuntu-22.04]\n", "        os: [ubuntu-latest, ubuntu-22.04]\n        exclude:\n          - node: 20\n            os: ubuntu-22.04\n") }, "git commit -am 'ci: skip Node 20 on Ubuntu 22.04'", "git push"),
        check: function (r) { var run = lastRun(r, "kestrel/kestrel-web", function (x) { return x.wfName === "CI" && x.headSha === gh(r, "kestrel/kestrel-web").refs["refs/heads/main"]; }); if (!run) return "Push your change so CI runs."; var n = run.jobs.map(function (j) { return j.name; }); if (n.length !== 5) return "The latest run has " + n.length + " jobs; expected 5 (use exclude:)."; return n.indexOf("test (20, ubuntu-22.04)") < 0 ? true : "test (20, ubuntu-22.04) is still there."; }
      },
      {
        id: "d2", title: "Cache by hand", system: webWith({ ".github/workflows/ci.yml": CI }),
        text: "<p>Cache <code>~/.npm</code> in <code>~/kestrel-web</code>'s CI with <code>actions/cache@v4</code> (not setup-node's option), keyed on the hash of <code>package-lock.json</code>, before <code>npm ci</code>. Push it; the run must pass.</p>",
        starter: "", solution: sol("cd ~/kestrel-web", { nano: ".github/workflows/ci.yml", text: CI.replace("      - run: npm ci\n", "      - uses: actions/cache@v4\n        with:\n          path: ~/.npm\n          key: npm-${{ hashFiles('package-lock.json') }}\n      - run: npm ci\n") }, "git commit -am 'ci: cache npm downloads'", "git push"),
        check: function (r) { var run = lastRun(r, "kestrel/kestrel-web", function (x) { return x.wfName === "CI" && x.headSha === gh(r, "kestrel/kestrel-web").refs["refs/heads/main"]; }); if (!run) return "Push your change so CI runs."; if (run.conclusion !== "success") return "The run failed: gh run view " + run.id + " --log-failed."; var log = run.jobs.map(X.logOf).join("\n"); if (!/Run actions\/cache@v4/.test(log)) return "Use actions/cache@v4."; return /Cache saved with key: \S*[0-9a-f]{32}/.test(log) ? true : "Key the cache on ${{ hashFiles('package-lock.json') }} and cache ~/.npm."; }
      },
      {
        id: "d3", title: "What's cached?", system: webWith({ ".github/workflows/ci.yml": X.CI_MATRIX }),
        text: "<p>List the GitHub Actions caches of <code>kestrel/kestrel-web</code> from the terminal.</p>",
        starter: "", solution: lines("cd ~/kestrel-web", "gh cache list"),
        check: function (r) { return ran(r, /gh\s+cache\s+(list|ls)/, function (e) { return outHas(e, /node-cache-Linux-x64-npm-/); }) ? true : "gh cache list (inside the repository, or with -R kestrel/kestrel-web)."; }
      }
    ],
    "gt-123": [
      {
        id: "d1", title: "Weekday mornings", system: function (sys) { X.world(sys); GH.seed(sys, "kestrel/kestrel-docs", { steps: [{ msg: "Docs", by: "maya", files: { "docs/index.md": "# Docs\n", "scripts/check-links.sh": X.LINKS_SH, ".github/workflows/links.yml": X.LINKS_WF } }] }); GH.cloneTo(sys, "kestrel/kestrel-docs", HOME + "/kestrel-docs"); },
        text: "<p>Make <code>~/kestrel-docs</code>'s link checker also run at <b>07:00 UTC, Monday to Friday</b> (keep it running on pushes), and push.</p>",
        starter: "", solution: sol("cd ~/kestrel-docs", { nano: ".github/workflows/links.yml", text: X.LINKS_WF.replace("on: push\n", "on:\n  push:\n  schedule:\n    - cron: '0 7 * * 1-5'\n") }, "git commit -am 'ci: check links on weekday mornings'", "git push"),
        check: function (r) { var w = wf(r, "kestrel/kestrel-docs", "main", /links\.ya?ml$/); if (!w || w.errors.length) return w ? "GitHub can't read links.yml: " + w.errors[0] : "Keep links.yml."; if (!("push" in w.on)) return "Keep the push trigger."; var ok = Array.isArray(w.on.schedule) && w.on.schedule.some(function (s) { var f = String(s && s.cron).trim().split(/\s+/); return f.length === 5 && +f[0] === 0 && +f[1] === 7 && f[2] === "*" && f[3] === "*" && /^(1-5|mon-fri|1,2,3,4,5)$/i.test(f[4]); }); return ok ? true : "schedule: - cron: '0 7 * * 1-5' (minute 0, hour 7, Mon-Fri)."; }
      },
      {
        id: "d2", title: "Docs don't need CI", system: webWith({ ".github/workflows/ci.yml": CI }),
        text: "<p>Pull requests that only touch Markdown files or <code>docs/</code> shouldn't run <code>~/kestrel-web</code>'s CI. Change the <code>pull_request</code> trigger and push.</p>",
        starter: "", solution: sol("cd ~/kestrel-web", { nano: ".github/workflows/ci.yml", text: CI.replace("  pull_request:\n", "  pull_request:\n    paths-ignore:\n      - '**.md'\n      - 'docs/**'\n") }, "git commit -am 'ci: skip docs-only pull requests'", "git push"),
        check: function (r) {
          var w = wf(r, "kestrel/kestrel-web", "main", /ci\.ya?ml$/); if (!w || w.errors.length) return w ? "GitHub can't read ci.yml: " + w.errors[0] : "Keep ci.yml.";
          var c = w.on.pull_request; if (!c) return "Give pull_request: a paths-ignore: (or paths:) filter.";
          function runs(files) { if (c["paths-ignore"]) return files.some(function (f) { return !A.matchList(c["paths-ignore"], f); }); if (c.paths) return files.some(function (f) { return A.matchList(c.paths, f); }); return true; }
          if (runs(["README.md"]) || runs(["docs/guide/setup.md"]) || runs(["docs/a.txt"])) return "A pull request changing only README.md or files under docs/ would still run CI.";
          return runs(["site/index.html"]) && runs(["README.md", "test/run.sh"]) ? true : "Code changes must still run CI.";
        }
      },
      {
        id: "d3", title: "The full smoke test", system: webWith({ ".github/workflows/smoke.yml": DISPATCH }),
        text: "<p><code>kestrel/kestrel-web</code> has a manual workflow, <i>Smoke</i>. Start it from the terminal with its <code>level</code> input set to <code>full</code>.</p>",
        starter: "", solution: lines("cd ~/kestrel-web", "gh workflow list", "gh workflow run smoke.yml -f level=full"),
        check: function (r) { var run = lastRun(r, "kestrel/kestrel-web", function (x) { return x.event === "workflow_dispatch"; }); return run && run.inputs.level === "full" && run.conclusion === "success" ? true : "gh workflow run smoke.yml -f level=full"; }
      }
    ],
    "gt-124": [
      {
        id: "d1", title: "A variable", system: web({ admin: true }),
        text: "<p>Add a repository variable <code>REGION</code> with the value <code>eu-west-1</code> to <code>kestrel/kestrel-web</code>.</p>",
        starter: "", solution: lines("cd ~/kestrel-web", "gh variable set REGION --body eu-west-1"),
        check: function (r) { var v = gh(r, "kestrel/kestrel-web").vars.REGION; return v && v.value === "eu-west-1" ? true : "gh variable set REGION --body eu-west-1"; }
      },
      {
        id: "d2", title: "Production's secrets", system: web({ admin: true, after: function (sys) { X.envs(sys, "kestrel/kestrel-web", { site: "kestrel-web", prodToken: true }); } }),
        text: "<p>List the secrets of <code>kestrel/kestrel-web</code>'s <code>production</code> environment (names only: values can't be read).</p>",
        starter: "", solution: lines("cd ~/kestrel-web", "gh secret list --env production"),
        check: function (r) { return ran(r, /gh\s+secret\s+(list|ls)\b.*(--env|-e)\s*=?\s*production/, function (e) { return outHas(e, /^DEPLOY_TOKEN\s/); }) ? true : "gh secret list --env production"; }
      },
      {
        id: "d3", title: "A leftover secret", system: web({ admin: true, after: function (sys) { var x = GH.find(sys, "kestrel/kestrel-web"); x.secrets.OLD_FTP_PASSWORD = { value: "hunter2-ftp", updated: G.clock(sys) - 86400 * 400 }; x.secrets.NPM_TOKEN = { value: "npm-ro-123", updated: G.clock(sys) - 86400 * 9 }; } }),
        text: "<p>The site stopped using FTP a year ago. Delete its old secret from <code>kestrel/kestrel-web</code>, and nothing else.</p>",
        starter: "", solution: lines("cd ~/kestrel-web", "gh secret list", "gh secret delete OLD_FTP_PASSWORD"),
        check: function (r) { var x = gh(r, "kestrel/kestrel-web"); if (!x.secrets.NPM_TOKEN) return "NPM_TOKEN is still in use: keep it."; return x.secrets.OLD_FTP_PASSWORD ? "gh secret list, then gh secret delete NAME." : true; }
      }
    ],
    "gt-125": [
      {
        id: "d1", title: "Grab the build", system: webWith({ ".github/workflows/build.yml": BUILD_ART }, { msg: "ci: build the site" }),
        text: "<p>The latest <i>Build</i> run of <code>kestrel/kestrel-web</code> uploaded an artifact named <code>site</code>. Download its files into <code>~/site-build</code>.</p>",
        starter: "", solution: lines("cd ~/kestrel-web", "gh run list", "gh run download $(gh run list -L 1 --json databaseId -q '.[0].databaseId') -n site -D ~/site-build", "ls ~/site-build"),
        check: function (r) { return r.exists("~/site-build/index.html") && r.exists("~/site-build/pricing.html") ? true : "gh run download RUN_ID -n site -D ~/site-build"; }
      },
      {
        id: "d2", title: "A beta", system: cli(),
        text: "<p>Publish a <b>pre-release</b> of <code>kc</code> called <code>v2.0.0-beta.1</code>, from the tip of <code>main</code>, with the notes <i>First beta of kc 2.0. Expect rough edges.</i></p>",
        starter: "", solution: lines("cd ~/kestrel-cli", "gh release create v2.0.0-beta.1 --prerelease --notes 'First beta of kc 2.0. Expect rough edges.'"),
        check: function (r) { var x = gh(r, "kestrel/kestrel-cli"), rel = (x.releases || []).filter(function (z) { return z.tag === "v2.0.0-beta.1"; })[0]; if (!rel) return "gh release create v2.0.0-beta.1 --prerelease --notes '...'"; if (!rel.prerelease) return "Mark it as a pre-release (--prerelease)."; return /First beta of kc 2\.0/.test(rel.body) ? true : "Use the notes from the ticket (--notes)."; }
      },
      {
        id: "d3", title: "What's the latest?", system: cli(function (sys) { var x = GH.find(sys, "kestrel/kestrel-cli"); x.releases = [{ tag: "v1.3.0", name: "kc 1.3.0", body: "kc version", draft: false, prerelease: false, author: "maya-chen", created: G.clock(sys) - 86400 * 90, assets: [], seq: 1, id: 1 }, { tag: "v1.4.0", name: "kc 1.4.0", body: "## What's Changed\n* kc deploy REGION", draft: false, prerelease: false, author: "maya-chen", created: G.clock(sys) - 86400 * 60, assets: [], seq: 2, id: 2 }, { tag: "v1.5.0-rc.1", name: "kc 1.5.0 rc 1", body: "Release candidate", draft: false, prerelease: true, author: "maya-chen", created: G.clock(sys) - 86400 * 2, assets: [], seq: 3, id: 3 }]; }),
        text: "<p>Show the notes of <code>kc</code>'s latest <b>stable</b> release, without typing its tag.</p>",
        starter: "", solution: lines("cd ~/kestrel-cli", "gh release view"),
        check: function (r) { return ran(r, /gh\s+release\s+view\s*$/, function (e) { return outHas(e, /^kc 1\.4\.0/); }) ? true : "gh release view, with no tag, shows the latest release (pre-releases don't count)."; }
      }
    ],
    "gt-126": [
      {
        id: "d1", title: "Stuck in the queue", system: webWith({ ".github/workflows/ci.yml": CI.replace("ubuntu-latest", "ubuntu-lastest") }),
        text: "<p><code>kestrel/kestrel-web</code>'s latest CI run has been <i>waiting for a runner</i> for an hour. Find out why, fix it, and push: the new run must pass.</p>",
        starter: "", solution: lines("cd ~/kestrel-web", "gh run view $(gh run list -L 1 --json databaseId -q '.[0].databaseId')", "sed -i 's/ubuntu-lastest/ubuntu-latest/' .github/workflows/ci.yml", "git commit -am 'ci: fix the runner label'", "git push"),
        check: function (r) { var run = lastRun(r, "kestrel/kestrel-web", function (x) { return x.wfName === "CI"; }); return run && run.conclusion === "success" && run.headSha === gh(r, "kestrel/kestrel-web").refs["refs/heads/main"] ? true : "gh run view RUN_ID shows the label it's waiting for. Fix runs-on: and push."; }
      },
      {
        id: "d2", title: "A retired action", system: webWith({ ".github/workflows/build.yml": BUILD_ART.replace("upload-artifact@v4", "upload-artifact@v3") }, { msg: "ci: build the site" }),
        text: "<p>The <i>Build</i> workflow in <code>~/kestrel-web</code> fails before running a single step. Fix it and push; the run must pass.</p>",
        starter: "", solution: lines("cd ~/kestrel-web", "gh run view $(gh run list -L 1 --json databaseId -q '.[0].databaseId')", "sed -i 's/upload-artifact@v3/upload-artifact@v4/' .github/workflows/build.yml", "git commit -am 'ci: upload-artifact v4'", "git push"),
        check: function (r) { var run = lastRun(r, "kestrel/kestrel-web", function (x) { return x.wfName === "Build"; }); return run && run.conclusion === "success" && run.headSha === gh(r, "kestrel/kestrel-web").refs["refs/heads/main"] ? true : "gh run view RUN_ID: the annotation explains it. Upgrade the action and push."; }
      },
      {
        id: "d3", title: "More detail, please", system: webWith({ ".github/workflows/ci.yml": FAILING }),
        text: "<p>Re-run <code>kestrel/kestrel-web</code>'s latest failed CI run with <b>debug logging</b> turned on.</p>",
        starter: "", solution: lines("cd ~/kestrel-web", "gh run rerun $(gh run list -L 1 --json databaseId -q '.[0].databaseId') --debug"),
        check: function (r) { var run = lastRun(r, "kestrel/kestrel-web", function (x) { return x.wfName === "CI"; }); return run && run.attempt > 1 && run.debug ? true : "gh run rerun RUN_ID --debug"; }
      }
    ],
    "gt-127": [
      {
        id: "d1", title: "Require the tests", system: webWith({ ".github/workflows/ci.yml": CI }, { admin: true }),
        text: "<p>Protect <code>kestrel/kestrel-web</code>'s <code>main</code>: the <code>test</code> check must pass and one approval is needed. (Write the JSON body in a file and send it with <code>gh api -X PUT ... --input FILE</code>.)</p>",
        starter: "", solution: sol("cd ~/kestrel-web", { nano: "/tmp/protect.json", text: "{\n  \"required_status_checks\": { \"strict\": false, \"contexts\": [\"test\"] },\n  \"enforce_admins\": false,\n  \"required_pull_request_reviews\": { \"required_approving_review_count\": 1 },\n  \"restrictions\": null\n}\n" }, "gh api -X PUT repos/kestrel/kestrel-web/branches/main/protection --input /tmp/protect.json"),
        check: function (r) { var p = gh(r, "kestrel/kestrel-web").protect.main; if (!p) return "main isn't protected yet."; if (!p.checks || p.checks.contexts.indexOf("test") < 0) return "Require the status check test."; return p.pr && p.pr.count >= 1 ? true : "Require one approving review."; }
      },
      {
        id: "d2", title: "Merge when ready", system: web({ admin: true }),
        text: "<p>Allow auto-merge on <code>kestrel/kestrel-web</code>, so pull requests can be set to merge themselves once checks and reviews pass.</p>",
        starter: "", solution: lines("cd ~/kestrel-web", "gh repo edit --enable-auto-merge"),
        check: function (r) { return gh(r, "kestrel/kestrel-web").settings.autoMerge ? true : "gh repo edit --enable-auto-merge"; }
      },
      {
        id: "d3", title: "You're the approver", system: webWith({ ".github/workflows/deploy.yml": X.DEPLOY_WF, "scripts/deploy.sh": X.DEPLOY_SH }, { admin: true, msg: "ci: deploy", before: function (sys) { var x = GH.find(sys, "kestrel/kestrel-web"); x.vars.SITE = { value: "kestrel-web", updated: 0 }; var st = A.envFor(x, "staging"), pr = A.envFor(x, "production"); st.secrets.DEPLOY_TOKEN = { value: A.deployToken(sys, "kestrel-web", "staging"), updated: 0 }; pr.secrets.DEPLOY_TOKEN = { value: A.deployToken(sys, "kestrel-web", "production"), updated: 0 }; pr.reviewers = ["kc-dev"]; pr.branches = ["main"]; } }),
        text: "<p>A <i>Deploy</i> run on <code>kestrel/kestrel-web</code> is waiting for <b>your</b> approval to deploy to <code>production</code>. Approve it from the terminal with the REST API: find the environment's id, then POST to the run's <code>pending_deployments</code>.</p>",
        starter: "", solution: lines("cd ~/kestrel-web", "gh run list", "gh api repos/kestrel/kestrel-web/environments/production --jq .id", "gh api -X POST repos/kestrel/kestrel-web/actions/runs/$(gh run list -L 1 --json databaseId -q '.[0].databaseId')/pending_deployments -F \"environment_ids[]=$(gh api repos/kestrel/kestrel-web/environments/production --jq .id)\" -f state=approved -f comment='Staging checked'"),
        check: function (r) { var d = A.svc(r.sys).deploys.filter(function (x) { return x.env === "production" && x.from === "actions"; }); return d.length ? true : "gh api repos/kestrel/kestrel-web/environments/production --jq .id gives the id; then gh api -X POST repos/kestrel/kestrel-web/actions/runs/RUN_ID/pending_deployments -F 'environment_ids[]=ID' -f state=approved -f comment='...'"; }
      }
    ]
  };
  T.LABS.forEach(function (l) { if (DRILLS[l.id]) l.drills = DRILLS[l.id]; });
})();
