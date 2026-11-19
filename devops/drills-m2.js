/* sudo learn — DevOps Module 2 practice drills (3 per lab, +5 XP each). Each drill is its own small scenario
   around kestrel/notes-api: a workflow, a Jenkinsfile, Bamboo Specs or the deploy platform, set up just so. */
(function () {
  "use strict";
  var T = window.DEV_TRACK, B = T.B, M = B.M2, S = window.ShEngine, Dk = window.Dk, CI = window.CI, GH = window.GitHub, G = window.GitCore;
  var H = CI.H, sc = B.sc, sol = B.sol, out = B.out, all = B.all, ran = B.ran, idx = B.idx, HOME = B.HOME;
  var REPO = CI.REPO, IMG = CI.IMG, GH_LOGIN = M.GH_LOGIN, LAST_RUN = M.LAST_RUN, PY = M.PY_SETUP;
  var wfMain = M.wfMain, jobsMain = M.jobsMain, lastPush = M.lastPush, prRuns = M.prRuns, jobsOk = M.jobsOk, stepRuns = M.stepRuns, runMsg = M.runMsg;
  function keys(o) { return o ? Object.keys(o) : []; }
  function W(o) { return M.world(o); }
  function readLocal(r, p) { return r.read(HOME + "/notes-api/" + p); }
  function ghEnvSecret(sys, env, value) { var r = GH.find(sys, REPO); r.envs[env].secrets.KDEPLOY_TOKEN = { value: value, updated: G.clock(sys) - 3600 }; }
  function fleetEv(r, fn) { return H.fleetEvents(r).filter(fn); }
  var START = "cd ~/notes-api";

  /* workflows used by several drills */
  var WF_PARALLEL = sc("name: CI", "on:", "  push:", "    branches: [main]", "  pull_request:", "jobs:",
    "  lint:", "    runs-on: ubuntu-latest", "    steps:") + PY + sc("      - run: pip install -r requirements-dev.txt", "      - run: ruff check .",
    "  test:", "    runs-on: ubuntu-latest", "    steps:") + PY + sc("      - run: pip install -r requirements.txt -r requirements-dev.txt", "      - run: pytest",
    "  build:", "    runs-on: ubuntu-latest", "    steps:", "      - uses: actions/checkout@v4", "      - run: docker build -t notes-api:${{ github.sha }} .");
  var WF_NOCACHE = M.WF_SPLIT.replace(/\n          cache: pip/g, "");
  var WF_WRITEALL = M.WF_PUSH.replace("permissions:\n  contents: read\n", "permissions: write-all\n").replace("    permissions:\n      contents: read\n      packages: write\n", "");
  var WF_PR_PUSH = M.WF_PUSH.replace("        if: github.event_name != 'pull_request'\n", "").replace("push: ${{ github.event_name != 'pull_request' }}", "push: true");
  var WF_COV80 = M.wfPush({ cov: 80 });

  var DRILLS = {
    /* ---------------------------------------------------------------- DEV-201 */
    "dev-201": [
      { id: "d1", title: "Wait for it", text: "<p>All three jobs in <code>ci.yml</code> start at once, so an image gets built even when lint fails. Make <code>build</code> wait for <code>lint</code> and <code>test</code>, push, and get a green run.</p>",
        system: W({ repo: { files: { ".github/workflows/ci.yml": WF_PARALLEL } } }), starter: START,
        solution: sol(START, "sed -i 's/^  build:$/  build:\\n    needs: [lint, test]/' .github/workflows/ci.yml", "grep -A1 '^  build:' .github/workflows/ci.yml", "git commit -am \"ci: build after lint and test\"", "git push", "gh run list -L 1"),
        check: function (r) { var n = H.needs(jobsMain(r).build); if (n.indexOf("lint") < 0 || n.indexOf("test") < 0) return "build should have needs: [lint, test] on main."; var run = lastPush(r); return jobsOk(run, ["lint", "test", "build"]) ? true : runMsg(run, ["lint", "test", "build"]); } },
      { id: "d2", title: "Stop downloading the internet", text: "<p>Every run downloads every package again. Cache pip in both Python jobs, then push twice and show a log line proving the second run used the cache.</p>",
        system: W({ repo: { files: { ".github/workflows/ci.yml": WF_NOCACHE } } }), starter: START,
        solution: sol(START, { nano: ".github/workflows/ci.yml", text: M.WF_SPLIT }, "git commit -am \"ci: cache pip\"", "git push", "git commit --allow-empty -m \"ci: again\"", "git push", "gh run view $(" + LAST_RUN + ") --log | grep \"Cache restored\""),
        check: function (r) { var j = jobsMain(r); if (["lint", "test"].some(function (k) { var s = M.setupPy(j[k]); return !s || !s.with || s.with.cache !== "pip"; })) return "Add cache: pip to setup-python in lint and test."; return ran(r, /^\s*gh\s+run\s+view\b/, function (e) { return /Cache restored from key/.test(all(e)); }) ? true : "Push a second time and show the Cache restored line from its log."; } },
      { id: "d3", title: "One run per branch", text: "<p>Two quick pushes to one branch run two full pipelines side by side. Add a concurrency group per branch (<code>github.ref</code>) that cancels the older run, and a timeout of at most 15 minutes on every job. Push it.</p>",
        system: W({ repo: { files: { ".github/workflows/ci.yml": WF_PARALLEL } } }), starter: START,
        solution: sol(START, { nano: ".github/workflows/ci.yml", text: M.WF_SPLIT }, "git commit -am \"ci: concurrency and timeouts\"", "git push"),
        check: function (r) { var w = wfMain(r); if (!w) return "Push ci.yml."; var c = w.doc.concurrency; if (!c || !/github\.ref/.test(String(c.group || "")) || c["cancel-in-progress"] !== true) return "Add concurrency: group: ci-${{ github.ref }}, cancel-in-progress: true"; var j = jobsMain(r), bad = keys(j).filter(function (k) { return !(+j[k]["timeout-minutes"] > 0 && +j[k]["timeout-minutes"] <= 15); }); return bad.length ? "timeout-minutes: 15 (or less) on: " + bad.join(", ") : true; } }
    ],
    /* ---------------------------------------------------------------- DEV-202 */
    "dev-202": [
      { id: "d1", title: "write-all", text: "<p>The workflow gives every job <code>permissions: write-all</code>. Cut it to read-only by default, with <code>packages: write</code> only where the image is pushed. The run must stay green.</p>",
        system: W({ repo: { files: { ".github/workflows/ci.yml": WF_WRITEALL } } }), starter: START,
        solution: sol(START, { nano: ".github/workflows/ci.yml", text: M.WF_PUSH }, "git commit -am \"ci: least-privilege token\"", "git push", "gh run list -L 1"),
        check: function (r) { var w = wfMain(r), p = w && w.doc.permissions; if (!p || typeof p !== "object" || p.contents !== "read" || keys(p).some(function (k) { return p[k] === "write"; })) return "Top-level permissions: contents: read."; var bp = jobsMain(r).build && jobsMain(r).build.permissions; if (!bp || bp.packages !== "write") return "Give the build job packages: write."; var run = lastPush(r); return jobsOk(run, ["lint", "test", "build"]) ? true : runMsg(run, ["lint", "test", "build"]); } },
      { id: "d2", title: "Which image is that commit?", text: "<p>Support reports a bug in the version built from the commit <b>before</b> main's latest. Pull exactly that image from ghcr.io to the laptop.</p>",
        system: W({ repo: { files: { ".github/workflows/ci.yml": M.WF_PUSH } }, before: function (sys) { GH.commit(sys, REPO, "main", "ben", "fix: trim note text", { "CHANGES.md": "trimmed\n" }); GH.commit(sys, REPO, "main", "ana", "docs: changelog", { "CHANGES.md": "trimmed notes\n" }); } }), starter: START,
        solution: sol(START, "git log --oneline -3", GH_LOGIN, "docker pull ghcr.io/kestrel/notes-api:sha-$(git rev-parse HEAD~1)"),
        check: function (r) { var x = H.repo(r), tip = x.refs["refs/heads/main"], prev = G.commitOf(r.sys, tip).parents[0]; return ran(r, /^\s*docker\s+(image\s+)?pull\b/, function (e) { return /Status:/.test(all(e)) && (e.cmd.indexOf("sha-" + prev) >= 0 || /HEAD~1|HEAD\^/.test(e.cmd)); }) ? true : "Pull ghcr.io/kestrel/notes-api:sha-<the commit before main's tip> (git rev-parse HEAD~1)."; } },
      { id: "d3", title: "Pull requests don't publish", text: "<p>This workflow logs in and pushes on pull requests too. Fix it, then open a PR and show its build ran without pushing.</p>",
        system: W({ repo: { files: { ".github/workflows/ci.yml": WF_PR_PUSH } } }), starter: START,
        solution: sol(START, { nano: ".github/workflows/ci.yml", text: M.WF_PUSH }, "git commit -am \"ci: no pushes from pull requests\"", "git push", "git switch -c docs/x", "echo x >> README.md", "git commit -am \"docs: x\"", "git push -u origin docs/x", "gh pr create --fill", "gh pr checks"),
        check: function (r) { var run = prRuns(r)[0]; if (!run) return "Open a pull request."; var b = H.job(run, "build"); if (!H.ok(b)) return "The PR's build should pass."; return /The push refers to repository/.test(H.log(b)) ? "The PR's run still pushed." : true; } }
    ],
    /* ---------------------------------------------------------------- DEV-203 */
    "dev-203": [
      { id: "d1", title: "Read the coverage", text: "<p>Run the tests with coverage on the laptop and write the total coverage (just the number, like <code>42</code>) into <code>~/coverage.txt</code>.</p>",
        system: W({}), starter: START,
        solution: sol(START, "python3 -m venv .venv", ". .venv/bin/activate", "pip install -q -r requirements.txt -r requirements-dev.txt", "pytest --cov=app | grep TOTAL", "pytest --cov=app | awk '/^TOTAL/ {print $4}' | tr -d % > ~/coverage.txt", "cat ~/coverage.txt"),
        check: function (r) { var t = (r.read(HOME + "/coverage.txt") || "").trim(); if (!t) return "Write the number into ~/coverage.txt."; return t === "77" ? true : "Not quite: pytest --cov=app shows the TOTAL line."; } },
      { id: "d2", title: "Under the bar", text: "<p>The test job now requires 80% coverage and main is red at 77%. Don't lower the bar: add a test for <code>POST /notes</code> and get main green.</p>",
        system: W({ repo: { files: { ".github/workflows/ci.yml": WF_COV80 } }, before: function (sys) { GH.commit(sys, REPO, "main", "maya", "ci: coverage gate 80%", { "README.md": "# notes-api\n" }); } }), starter: START,
        solution: sol(START, "gh run list -L 1", { nano: "tests/test_app.py", text: CI.notes.TESTS + CI.notes.TEST_POST }, "git commit -am \"test: POST /notes\"", "git push", "gh run list -L 1"),
        check: function (r) { var m = /--cov-fail-under[= ](\d+)/.exec(stepRuns(jobsMain(r).test)); if (!m || +m[1] < 80) return "Keep the gate at 80% or more."; var run = lastPush(r); return jobsOk(run, ["test"]) ? true : runMsg(run, ["test"]); } },
      { id: "d3", title: "Make it required", text: "<p>Protect <code>main</code> so the <code>test</code> check must pass before a PR merges (no review requirement).</p>",
        system: W({ repo: { files: { ".github/workflows/ci.yml": M.WF_PUSH } } }), starter: START,
        solution: sol(START, { nano: "protection.json", text: M.PROTECTION.replace("[\"lint\", \"test\"]", "[\"test\"]") }, "gh api -X PUT repos/kestrel/notes-api/branches/main/protection --input protection.json", "gh api repos/kestrel/notes-api/branches/main/protection --jq .required_status_checks.contexts"),
        check: function (r) { var p = H.repo(r).protect && H.repo(r).protect.main; return p && p.checks && (p.checks.contexts || []).indexOf("test") >= 0 ? true : "main's protection should require the test check."; } }
    ],
    /* ---------------------------------------------------------------- DEV-204 */
    "dev-204": [
      { id: "d1", title: "Debugger in production", text: "<p>Run Semgrep's <code>p/python</code> rules over the repo on the laptop (in a venv), fix the finding, and show a clean scan.</p>",
        system: W({ repo: { app: { debug: true } } }), starter: START,
        solution: sol(START, "python3 -m venv .venv", ". .venv/bin/activate", "pip install -q semgrep", "semgrep scan --config p/python --error", "sed -i 's/, debug=True//' app.py", "semgrep scan --config p/python --error"),
        check: function (r) { var k = idx(r, /^\s*semgrep\b/, function (e) { return /debug-enabled/.test(all(e)); }); if (k < 0) return "Run semgrep scan --config p/python first."; return r.history.slice(k + 1).some(function (e) { return /^\s*semgrep\b/.test(e.cmd) && /--error/.test(e.cmd) && e.exit === 0 && /0 findings/.test(all(e)); }) ? true : "Fix app.py and scan again with --error until it's clean."; } },
      { id: "d2", title: "Bump it", text: "<p>Trivy says the repo's dependencies have a HIGH vulnerability. Upgrade to the fixed version and show <code>trivy fs --severity HIGH,CRITICAL --exit-code 1 .</code> passing.</p>",
        system: W({ repo: { req: sc("flask==3.1.1", "gunicorn==21.2.0") } }), starter: START,
        solution: sol(START, "trivy fs --severity HIGH,CRITICAL .", "sed -i 's/gunicorn==21.2.0/gunicorn==23.0.0/' requirements.txt", "trivy fs --severity HIGH,CRITICAL --exit-code 1 ."),
        check: function (r) { if (/gunicorn==21\./.test(readLocal(r, "requirements.txt") || "")) return "requirements.txt still pins gunicorn 21.2.0."; return ran(r, /^\s*trivy\s+fs\b/, function (e) { return /--exit-code\s+1/.test(e.cmd) && e.exit === 0; }) ? true : "Show trivy fs --severity HIGH,CRITICAL --exit-code 1 . passing."; } },
      { id: "d3", title: "It's in the history", text: "<p>Gitleaks finds a token in an old commit. It was revoked long ago: record its fingerprint in <code>.gitleaksignore</code> so <code>gitleaks detect</code> exits 0.</p>",
        system: W({ steps: [{ msg: "chore: settings", by: "ben", at: "2026-10-22 16:40", files: { ".env": "GITHUB_TOKEN=" + M.OLD_TOKEN + "\n" } }, { msg: "chore: remove .env", by: "ben", at: "2026-10-22 16:52", files: { ".env": null } }] }), starter: START,
        solution: sol(START, "gitleaks detect -v", "gitleaks detect -v 2>&1 | awk '/^Fingerprint:/ {print $2}' >> .gitleaksignore", "gitleaks detect"),
        check: function (r) { if (!/github-pat/.test(readLocal(r, ".gitleaksignore") || "")) return "Put the finding's Fingerprint in .gitleaksignore."; return ran(r, /^\s*gitleaks\s+detect\b/, function (e) { return e.exit === 0; }) ? true : "Show gitleaks detect exiting 0."; } }
    ],
    /* ---------------------------------------------------------------- DEV-205 */
    "dev-205": [
      { id: "d1", title: "Read the log", text: "<p>Work out the next version from the commits since <code>v1.5.0</code> and write it (like <code>1.5.1</code>) into <code>~/next-version.txt</code>.</p>",
        system: W({ steps: [{ msg: "fix: 404 for unknown notes", by: "ben", at: "2026-10-27 10:12", files: { "a.txt": "a\n" } }, { msg: "feat!: notes are now JSON objects, not plain text", by: "ana", at: "2026-11-03 14:30", files: { "b.txt": "b\n" } }, { msg: "docs: describe the new format", by: "ana", at: "2026-11-03 14:41", files: { "c.txt": "c\n" } }] }), starter: START,
        solution: sol(START, "git log --oneline v1.5.0..HEAD", "echo 2.0.0 > ~/next-version.txt"),
        check: function (r) { var t = (r.read(HOME + "/next-version.txt") || "").trim(); if (!t) return "Write the version into ~/next-version.txt."; return t === "2.0.0" ? true : "Look again: a type with ! (or BREAKING CHANGE) means a breaking change."; } },
      { id: "d2", title: "Lightweight by mistake", text: "<p>Someone pushed <code>v1.5.1</code> as a lightweight tag. Replace it, on GitHub too, with an annotated tag on the same commit.</p>",
        system: W({ steps: [{ msg: "fix: trim notes", by: "ben", at: "2026-10-27 10:12", files: { "a.txt": "a\n" } }], after: function (sys) { var r = GH.find(sys, REPO); r.refs["refs/tags/v1.5.1"] = r.refs["refs/heads/main"]; } }), starter: START,
        solution: sol(START, "git fetch --tags", "git cat-file -t v1.5.1", "git tag -d v1.5.1", "git tag -a v1.5.1 -m \"notes-api 1.5.1\" origin/main", "git push --force origin v1.5.1", "git cat-file -t v1.5.1"),
        check: function (r) { var x = H.repo(r), s = x.refs["refs/tags/v1.5.1"]; if (!s) return "v1.5.1 should exist on GitHub."; if (G.getObject(r.sys, s).type !== "tag") return "On GitHub, v1.5.1 is still lightweight (git push --force origin v1.5.1 after re-creating it)."; return G.peel(r.sys, s) === x.refs["refs/heads/main"] ? true : "It should point at the same commit as before (main's tip)."; } },
      { id: "d3", title: "1.6, and 1", text: "<p><code>release.yml</code> only tags images with the full version. Also publish <code>MAJOR.MINOR</code> and <code>MAJOR</code>, then release <code>v1.6.0</code>.</p>",
        system: W({ repo: { files: { ".github/workflows/release.yml": M.RELEASE_WF.replace("            type=semver,pattern={{major}}.{{minor}}\n", "") } } }), starter: START,
        solution: sol(START, { nano: ".github/workflows/release.yml", text: M.RELEASE_WF.replace("            type=semver,pattern={{major}}.{{minor}}\n", "            type=semver,pattern={{major}}.{{minor}}\n            type=semver,pattern={{major}}\n") }, "sed -i 's/1.5.0/1.6.0/' app.py", "git commit -am \"chore(release): 1.6.0\"", "git push", "git tag -a v1.6.0 -m \"notes-api 1.6.0\"", "git push origin v1.6.0", "gh run list -L 1"),
        check: function (r) { var t = H.tags(r); return t["1.6.0"] && t["1.6"] && t["1"] ? true : "ghcr.io should have 1.6.0, 1.6 and 1."; } }
    ],
    /* ---------------------------------------------------------------- DEV-206 */
    "dev-206": [
      { id: "d1", title: "Two at a time", text: "<p>Production has 4 instances. Roll it to 1.6.0 replacing <b>two</b> instances at a time.</p>",
        system: W({ releases: ["1.5.0", "1.6.0"], fleet: { staging: "1.5.0", production: "1.5.0" }, clone: false }), starter: "",
        solution: sol("kdeploy rollout production --image ghcr.io/kestrel/notes-api:1.6.0 --strategy rolling --max-unavailable 2", "kdeploy status production"),
        check: function (r) { if (H.env(r, "production").current.version !== "1.6.0") return "Production should run 1.6.0."; return ran(r, /^\s*kdeploy\s+rollout\s+production\b/, function (e) { return /--max-unavailable[ =]2\b/.test(e.cmd) && e.exit === 0; }) ? true : "Use --max-unavailable 2."; } },
      { id: "d2", title: "Step by step", text: "<p>Roll 1.6.0 into production as a canary that <b>pauses</b> at each step (10%, 50%) until you promote it. Watch the metrics at each pause and promote it all the way.</p>",
        system: W({ releases: ["1.5.0", "1.6.0"], fleet: { staging: "1.5.0", production: "1.5.0" }, clone: false }), starter: "",
        solution: sol("kdeploy rollout production --image ghcr.io/kestrel/notes-api:1.6.0 --strategy canary --canary-steps 10,50,100 --manual", "kdeploy metrics production", "kdeploy promote production", "kdeploy metrics production", "kdeploy promote production", "kdeploy status production"),
        check: function (r) { var E = H.env(r, "production"); if (E.current.version !== "1.6.0" || E.current.strategy !== "canary") return "Production should reach 1.6.0 through a canary."; if (!ran(r, /^\s*kdeploy\s+rollout\b.*--manual/)) return "Use --manual so it waits at each step."; return ran(r, /^\s*kdeploy\s+metrics\s+production\b/, function (e) { return /1\.6\.0/.test(all(e)) && /1\.5\.0/.test(all(e)); }) ? true : "Look at kdeploy metrics production while both versions take traffic."; } },
      { id: "d3", title: "Back to that one", text: "<p>Production's last two deploys were both bad. Roll it back to <b>revision 2</b> specifically.</p>",
        system: W({ releases: ["1.5.0", "1.6.0", "1.6.1", "1.6.2"], fleet: { staging: "1.5.0", production: "1.5.0" }, clone: false,
          after: function (sys) { var E = CI.fleetEnv(sys, "notes", "production"); ["1.6.0", "1.6.1", "1.6.2"].forEach(function (v, i) { var dg = CI.digests[v], rev = { rev: i + 2, ref: IMG + "@" + dg, digest: dg, version: v, strategy: "rolling", status: "succeeded", by: "ben-okoro", t: G.clock(sys) - 3600 * (6 - i), note: "rollout" }; E.revs.push(rev); E.current = rev; }); E.insts.forEach(function (x) { x.version = "1.6.2"; x.digest = CI.digests["1.6.2"]; }); } }), starter: "",
        solution: sol("kdeploy history production", "kdeploy rollback production --to 2", "kdeploy status production"),
        check: function (r) { var E = H.env(r, "production"); return E.current.version === "1.6.0" && fleetEv(r, function (e) { return e.kind === "rollback" && e.env === "production"; }).length ? true : "kdeploy rollback production --to 2 (kdeploy history production lists the revisions)."; } }
    ],
    /* ---------------------------------------------------------------- DEV-207 */
    "dev-207": [
      { id: "d1", title: "Per-environment secret", text: "<p>Set the <code>KDEPLOY_TOKEN</code> secret of the <b>staging</b> environment from <code>~/handoff/staging.token</code>, without the token ever appearing in your shell history as text.</p>",
        system: W({ before: function (sys) { M.ghEnvs(sys, { staging: {}, production: {} }); M.tokens(sys, ["staging"]); }, fleet: { staging: "1.5.0" }, releases: ["1.5.0"] }), starter: START,
        solution: sol(START, "gh secret set KDEPLOY_TOKEN --env staging < ~/handoff/staging.token", "gh secret list --env staging"),
        check: function (r) { var e = H.ghEnv(r, "staging"), want = (r.read(HOME + "/handoff/staging.token") || "").trim(); if (!e || !e.secrets.KDEPLOY_TOKEN || String(e.secrets.KDEPLOY_TOKEN.value).trim() !== want) return "Set KDEPLOY_TOKEN in the staging environment."; return r.history.some(function (x) { return want && x.cmd.indexOf(want) >= 0; }) ? "The token is in your command line. Read it from the file instead (< ~/handoff/staging.token)." : true; } },
      { id: "d2", title: "Waiting for you", text: "<p>The last push to main deployed staging and is waiting at production. You're a reviewer: approve it and let it finish.</p>",
        system: W({ repo: { postTest: true, files: { ".github/workflows/ci.yml": M.WF_DEPLOY } }, releases: ["1.5.0"], fleet: { staging: "1.5.0", production: "1.5.0" },
          before: function (sys) { M.ghEnvs(sys, { staging: {}, production: { reviewers: ["kc-dev"] } }); var t = M.tokens(sys, ["staging", "production"]); ghEnvSecret(sys, "staging", t.staging); ghEnvSecret(sys, "production", t.production); }, after: function (sys) { GH.commit(sys, REPO, "main", "ben", "fix: trim note text", { "CHANGES.md": "trim\n" }); } }), starter: START,
        solution: sol(START, "gh run list -L 1", M.APPROVE, "gh run view $(" + LAST_RUN + ")", "kdeploy status production"),
        check: function (r) { var tip = H.tip(r), dg = H.tags(r)["sha-" + tip]; return dg && H.env(r, "production").current.digest === dg ? true : "Approve the waiting production deployment (gh api ... pending_deployments)."; } },
      { id: "d3", title: "3 a.m. button", text: "<p>Production is broken after the last deploy. Use the repo's <code>rollback.yml</code> workflow to roll production back. (Production needs an approval; you're a reviewer.)</p>",
        system: W({ repo: { files: { ".github/workflows/rollback.yml": M.ROLLBACK_WF } }, releases: ["1.5.0", "1.6.0"], fleet: { staging: "1.5.0", production: "1.5.0" },
          before: function (sys) { M.ghEnvs(sys, { staging: {}, production: { reviewers: ["kc-dev"] } }); var t = M.tokens(sys, ["staging", "production"]); ghEnvSecret(sys, "staging", t.staging); ghEnvSecret(sys, "production", t.production); },
          after: function (sys) { var E = CI.fleetEnv(sys, "notes", "production"), dg = CI.digests["1.6.0"], rev = { rev: 2, ref: IMG + "@" + dg, digest: dg, version: "1.6.0", strategy: "rolling", status: "succeeded", by: "actions", t: G.clock(sys) - 1800, note: "rollout" }; E.revs.push(rev); E.current = rev; E.insts.forEach(function (x) { x.version = "1.6.0"; x.digest = dg; }); } }), starter: START,
        solution: sol(START, "gh workflow run rollback.yml -f environment=production", "gh run list -L 1", M.APPROVE, "kdeploy status production"),
        check: function (r) { return H.env(r, "production").current.version === "1.5.0" && fleetEv(r, function (e) { return e.kind === "rollback" && e.env === "production" && e.where === "actions"; }).length ? true : "Run rollback.yml for production and approve it."; } }
    ],
    /* ---------------------------------------------------------------- DEV-208 */
    "dev-208": [
      { id: "d1", title: "Who signed this?", text: "<p>Verify the signature on <code>ghcr.io/kestrel/notes-api:1.6.0</code>, accepting only this repository's workflows issued by GitHub Actions.</p>",
        system: W({ releases: ["1.5.0", "1.6.0"], clone: false, after: function (sys) { CI.signAs(sys, IMG + ":1.6.0", REPO + "/.github/workflows/release.yml@refs/tags/v1.6.0"); } }), starter: "",
        solution: sol(GH_LOGIN, "cosign verify --certificate-identity-regexp '^https://github.com/kestrel/notes-api/' --certificate-oidc-issuer " + M.ISSUER + " ghcr.io/kestrel/notes-api:1.6.0"),
        check: function (r) { return ran(r, /^\s*cosign\s+verify\b/, function (e) { return /1\.6\.0/.test(e.cmd) && /--certificate-oidc-issuer/.test(e.cmd) && /token\.actions\.githubusercontent\.com/.test(e.cmd) && /--certificate-identity/.test(e.cmd) && e.exit === 0; }) ? true : "cosign verify with --certificate-identity-regexp and --certificate-oidc-issuer (log in to ghcr.io first)."; } },
      { id: "d2", title: "Signed, but by whom?", text: "<p><code>1.6.1</code> is signed, but production only trusts <code>ci.yml</code> on <code>main</code>. Verify it with that identity, see it fail, and write the branch it was really signed from (just the branch name) into <code>~/signer.txt</code>.</p>",
        system: W({ releases: ["1.5.0", "1.6.1"], clone: false, after: function (sys) { CI.signAs(sys, IMG + ":1.6.1", REPO + "/.github/workflows/ci.yml@refs/heads/try-faster-build"); } }), starter: "",
        solution: sol(GH_LOGIN, M.VERIFY.replace("sha-$(git rev-parse HEAD)", "1.6.1"), "echo try-faster-build > ~/signer.txt"),
        check: function (r) { if (!ran(r, /^\s*cosign\s+verify\b/, function (e) { return /1\.6\.1/.test(e.cmd) && e.exit !== 0; })) return "Verify 1.6.1 against ci.yml on main (it should fail)."; return (r.read(HOME + "/signer.txt") || "").trim() === "try-faster-build" ? true : "Read the identity cosign printed and write the branch into ~/signer.txt."; } },
      { id: "d3", title: "Signed only", text: "<p>Turn on production's signature policy (trust <code>ci.yml</code> on main), then deploy the signed <code>1.6.0</code>.</p>",
        system: W({ releases: ["1.5.0", "1.6.0"], fleet: { staging: "1.5.0", production: "1.5.0" }, clone: false, after: function (sys) { CI.signAs(sys, IMG + ":1.6.0", REPO + "/.github/workflows/ci.yml@refs/heads/main"); } }), starter: "",
        solution: sol(M.POLICY, "kdeploy policy show production", "kdeploy rollout production --image ghcr.io/kestrel/notes-api:1.6.0"),
        check: function (r) { var E = H.env(r, "production"); if (!E.policy || !E.policy.requireSignature) return "Turn on the signature policy for production."; return E.current.version === "1.6.0" ? true : "Deploy 1.6.0 to production."; } }
    ],
    /* ---------------------------------------------------------------- DEV-209 */
    "dev-209": [
      { id: "d1", title: "Lint before you push", text: "<p>The <code>Jenkinsfile</code> in the repo doesn't validate. Fix it (keep its stages) until <code>declarative-linter</code> accepts it.</p>",
        system: W({ repo: { files: { "Jenkinsfile": M.BAD_JENKINSFILE } }, before: function (sys) { CI.jenkinsSetup(sys, {}); } }), starter: START,
        solution: sol(START, "jenkins-cli declarative-linter < Jenkinsfile", { nano: "Jenkinsfile", text: sc("pipeline {", "  agent { label 'linux' }", "  stages {", "    stage('Test') {", "      steps {", "        sh '''", "          python3 -m venv .venv", "          . .venv/bin/activate", "          pip install -r requirements.txt -r requirements-dev.txt", "          pytest", "        '''", "      }", "    }", "  }", "}") }, "jenkins-cli declarative-linter < Jenkinsfile"),
        check: function (r) { var t = readLocal(r, "Jenkinsfile"); if (!t || CI.parseJenkinsfile(t).errors.length) return "The Jenkinsfile should validate."; return ran(r, /declarative-linter/, function (e) { return /successfully validated/.test(all(e)); }) ? true : "Show it: jenkins-cli declarative-linter < Jenkinsfile"; } },
      { id: "d2", title: "Quote it right", text: "<p>main's Jenkins log warns that a secret goes through Groovy string interpolation. Fix the <code>Jenkinsfile</code> so the build is clean and still logs in.</p>",
        system: W({ before: function (sys) { CI.jenkinsSetup(sys, { creds: { "ghcr-push": { type: "usernamePassword", user: "kestrel-ci", pass: CI.machineUser(sys, "kestrel-ci") } } }); GH.commit(sys, REPO, "main", "ben", "ci: Jenkins login", { "Jenkinsfile": sc("pipeline {", "  agent { label 'docker' }", "  environment {", "    GHCR = credentials('ghcr-push')", "  }", "  stages {", "    stage('Login') {", "      steps {", "        sh \"echo $GHCR_PSW | docker login ghcr.io -u $GHCR_USR --password-stdin\"", "      }", "    }", "  }", "}") }); } }), starter: START,
        solution: sol(START, "jenkins-cli console notes-api/main | grep -A2 Warning", "sed -i \"s|sh \\\"echo \\$GHCR_PSW \\| docker login ghcr.io -u \\$GHCR_USR --password-stdin\\\"|sh 'echo \\\"\\$GHCR_PSW\\\" \\| docker login ghcr.io -u \\\"\\$GHCR_USR\\\" --password-stdin'|\" Jenkinsfile", "grep docker Jenkinsfile", "git commit -am \"ci: let the shell expand the secret\"", "git push", "jenkins-cli console notes-api/main -n 8"),
        check: function (r) { var b = M.jenkinsBuilds(r, "main").slice(-1)[0]; if (!b || b.sha !== H.tip(r)) return "Push the fix so Jenkins builds it."; if (/Groovy String interpolation/.test(b.console.join("\n"))) return "The latest build still warns: use single quotes around the sh command."; return b.result === "SUCCESS" && /Login Succeeded/.test(b.console.join("\n")) ? true : "The build should still log in and succeed."; } },
      { id: "d3", title: "Main only", text: "<p>The Deploy stage runs on every branch. Make it main-only, then push a branch and show Jenkins skipping it there.</p>",
        system: W({ before: function (sys) { CI.jenkinsSetup(sys, {}); GH.commit(sys, REPO, "main", "ben", "ci: Jenkinsfile", { "Jenkinsfile": sc("pipeline {", "  agent { label 'linux' }", "  stages {", "    stage('Test') {", "      steps { echo 'testing' }", "    }", "    stage('Deploy') {", "      steps { echo \"deploying ${BRANCH_NAME}\" }", "    }", "  }", "}") }); } }), starter: START,
        solution: sol(START, "sed -i \"s|    stage('Deploy') {|    stage('Deploy') {\\n      when { branch 'main' }|\" Jenkinsfile", "cat Jenkinsfile", "git commit -am \"ci: deploy from main only\"", "git push", "git switch -c feature/y", "git commit --allow-empty -m \"wip\"", "git push -u origin feature/y", "jenkins-cli console notes-api/feature/y | grep skipped"),
        check: function (r) { var J = CI.jenkins(r.sys).jobs["notes-api"], other = keys(J.branches).filter(function (b) { return b !== "main"; }); if (!other.length) return "Push a branch so Jenkins builds it."; return other.some(function (b) { var x = J.branches[b].builds.slice(-1)[0]; return x && x.stages.some(function (s) { return s.name === "Deploy" && s.when; }); }) ? true : "On the branch, Deploy should be skipped by when { branch 'main' }."; } }
    ],
    /* ---------------------------------------------------------------- DEV-210 */
    "dev-210": [
      { id: "d1", title: "Queued forever", text: "<p>Build image never runs: it sits in the queue. Find out why from the result and fix <code>bamboo.yml</code> so it builds.</p>",
        system: W({ repo: { postTest: true }, before: function (sys) { var t = M.tokens(sys, ["ghcr"]); var B0 = CI.bambooSetup(sys, {}); B0.secrets.SEEDKEY = t.ghcr; GH.commit(sys, REPO, "main", "ben", "ci: Bamboo", { "bamboo-specs/bamboo.yml": M.specsPlan({ secret: "BAMBOO-SECRET-V1:SEEDKEY==" }).replace("    - system.docker.executable", "    - system.docker.exe") }); } }), starter: START,
        solution: sol(START, "bamboo result NOTES-API", "bamboo agents", "sed -i 's/system.docker.exe$/system.docker.executable/' bamboo-specs/bamboo.yml", "git commit -am \"ci: fix the Docker requirement\"", "git push", "bamboo result NOTES-API"),
        check: function (r) { var res = M.lastResult(r), j = res && res.jobs.filter(function (x) { return x.name === "Build image"; })[0]; return j && j.state === "Successful" ? true : "Build image should run and succeed (bamboo agents lists the capabilities)."; } },
      { id: "d2", title: "Plain text password", text: "<p>The ghcr password is in <code>bamboo.yml</code> in plain text. Replace it with an encrypted value and keep the build green.</p>",
        system: W({ repo: { postTest: true }, before: function (sys) { var t = M.tokens(sys, ["ghcr"]); CI.bambooSetup(sys, {}); GH.commit(sys, REPO, "main", "ben", "ci: Bamboo", { "bamboo-specs/bamboo.yml": M.specsPlan({ secret: t.ghcr }) }); } }), starter: START,
        solution: sol(START, "grep ghcr_password bamboo-specs/bamboo.yml", "sed -i \"s|ghcr_password: .*|ghcr_password: $(bamboo encrypt \"$(cat ~/handoff/ghcr.token)\")|\" bamboo-specs/bamboo.yml", "git commit -am \"ci: encrypt the ghcr password\"", "git push", "bamboo result NOTES-API"),
        check: function (r) { var txt = H.fileOn(r, "main", "bamboo-specs/bamboo.yml") || "", tok = (r.read(HOME + "/handoff/ghcr.token") || "").trim(); if (txt.indexOf(tok) >= 0) return "The token is still in plain text on main."; if (!/ghcr_password:\s*BAMBOO-SECRET-V1:/.test(txt)) return "ghcr_password should be a BAMBOO-SECRET-V1 value."; var res = M.lastResult(r); return res && res.state === "Successful" && res.sha === H.tip(r) ? true : "The build of main's latest commit should succeed."; } },
      { id: "d3", title: "Count the tests", text: "<p>The Unit tests job runs pytest but Bamboo records no test results. Add a JUnit test parser (in <code>final-tasks</code>) and get the plan to report the tests.</p>",
        system: W({ repo: { postTest: true }, before: function (sys) { var t = M.tokens(sys, ["ghcr"]); var B0 = CI.bambooSetup(sys, {}); B0.secrets.SEEDKEY = t.ghcr; GH.commit(sys, REPO, "main", "ben", "ci: Bamboo", { "bamboo-specs/bamboo.yml": M.specsPlan({ secret: "BAMBOO-SECRET-V1:SEEDKEY==" }).replace("  final-tasks:\n    - test-parser:\n        type: junit\n        test-results: test-reports/*.xml\n", "") }); } }), starter: START,
        solution: sol(START, "bamboo result NOTES-API", "sed -i 's|^Build image:$|  final-tasks:\\n    - test-parser:\\n        type: junit\\n        test-results: test-reports/*.xml\\nBuild image:|' bamboo-specs/bamboo.yml", "bamboo encrypt test > /dev/null", "git commit -am \"ci: record test results\"", "git push", "bamboo result NOTES-API"),
        check: function (r) { var res = M.lastResult(r), j = res && res.jobs.filter(function (x) { return x.name === "Unit tests"; })[0]; return j && j.tests && j.tests.total >= 4 && res.sha === H.tip(r) ? true : "main's latest result should show Unit tests' test count."; } }
    ],
    /* ---------------------------------------------------------------- DEV-211 */
    "dev-211": [
      { id: "d1", title: "Promote a release", text: "<p>release-1 is on Staging. Deploy it to Production.</p>",
        system: bambooDeployWorld(0), starter: START,
        solution: sol(START, "bamboo releases", "bamboo deploy Production release-1", "bamboo deployments"),
        check: function (r) { var D = M.deployProject(r); return D && D.results.some(function (x) { return x.env === "Production" && x.release === "release-1" && x.state === "Success"; }) ? true : "bamboo deploy Production release-1"; } },
      { id: "d2", title: "Lock the door", text: "<p>Anyone can deploy Production. Let only the <code>release-managers</code> group deploy it (others may still view), and push.</p>",
        system: bambooDeployWorld(0, { noPerms: true }), starter: START,
        solution: sol(START, "tail -5 bamboo-specs/bamboo.yml", "printf 'environment-permissions:\\n  - Production:\\n      - groups: [release-managers]\\n        permissions: [view, deploy]\\n' >> bamboo-specs/bamboo.yml", "git commit -am \"cd: only release managers deploy production\"", "git push", "bamboo specs"),
        check: function (r) { var D = M.deployProject(r), p = D && D.perms.Production; return p && p.some(function (x) { return x.groups.indexOf("release-managers") >= 0 && x.perms.indexOf("deploy") >= 0; }) ? true : "Add environment-permissions for Production: groups [release-managers], permissions [view, deploy]."; } },
      { id: "d3", title: "The previous one, please", text: "<p>Production runs release-2 and support reports errors. Put the previous release back on Production.</p>",
        system: bambooDeployWorld(2), starter: START,
        solution: sol(START, "bamboo deployments Production", "bamboo releases", "bamboo deploy Production release-1", "kdeploy status production"),
        check: function (r) { var D = M.deployProject(r), last = D && D.results.filter(function (x) { return x.env === "Production" && x.state === "Success"; }).slice(-1)[0]; return last && last.release === "release-1" ? true : "Redeploy release-1 to Production."; } }
    ],
    /* ---------------------------------------------------------------- DEV-212 */
    "dev-212": [
      { id: "d1", title: "Ship a fix", text: "<p>The full pipeline from the capstone is in place. Add a line to <code>README.md</code> describing it, push, and take that commit all the way to production.</p>",
        system: capDone(), starter: START,
        solution: sol(START, "echo \"Pipeline: lint, test, sast, deps, secrets, build, staging, production\" >> README.md", "git commit -am \"docs: the pipeline\"", "git push", "gh run view $(" + LAST_RUN + ")", M.APPROVE, "kdeploy status production"),
        check: function (r) { var dg = H.tags(r)["sha-" + H.tip(r)]; return dg && H.env(r, "production").current.digest === dg ? true : "Production should run main's latest commit (approve the deployment)."; } },
      { id: "d2", title: "The canary bites", text: "<p>Ben's branch <code>export</code> adds <code>GET /export</code>. It passes every gate. Merge it into main, push, and approve production: watch what the canary does, and why (<code>kdeploy metrics production</code>). Then revert the merge and get production onto the reverted commit.</p>",
        system: capDone(function (sys) { var x = GH.find(sys, REPO); x.refs["refs/heads/export"] = x.refs["refs/heads/main"]; GH.commit(sys, REPO, "export", "ben", "feat: GET /export", { "app.py": CI.notes.appPy({ extraImport: "import time", extraRoute: "@app.get(\"/export\")\ndef export():\n    time.sleep(5)  # wait for the notes folder to settle\n    return jsonify(status=\"ok\")" }) }); }), starter: START,
        solution: sol(START, "git fetch origin", "git merge --no-edit origin/export", "git push", "gh run view $(" + LAST_RUN + ")", M.APPROVE, "kdeploy metrics production", "git revert --no-edit HEAD", "git push", M.APPROVE, "kdeploy status production"),
        check: function (r) { if (!fleetEv(r, function (e) { return e.env === "production" && e.strategy === "canary" && e.status === "aborted"; }).length) return "Merge Ben's branch, push and approve: the production canary should abort."; var dg = H.tags(r)["sha-" + H.tip(r)]; if (/time\.sleep\(/.test(H.fileOn(r, "main", "app.py") || "")) return "Revert Ben's change on main."; return dg && H.env(r, "production").current.digest === dg ? true : "Get the reverted commit to production."; } },
      { id: "d3", title: "Patch release", text: "<p>Release <code>v1.5.1</code>: set <code>VERSION</code>, tag it (annotated), and get images <code>1.5.1</code> and <code>1.5</code>.</p>",
        system: capDone(), starter: START,
        solution: sol(START, "sed -i 's/VERSION = \"1.5.0\"/VERSION = \"1.5.1\"/' app.py", "git commit -am \"chore(release): 1.5.1\"", "git push", "git tag -a v1.5.1 -m \"notes-api 1.5.1\"", "git push origin v1.5.1", "gh run list -L 2"),
        check: function (r) { var t = H.tags(r); return t["1.5.1"] && t["1.5"] ? true : "ghcr.io should have 1.5.1 and 1.5."; } }
    ]
  };

  // Bamboo: a plan and deployment project already set up; `released` releases deployed (Staging gets each, Production the last)
  function bambooDeployWorld(released, o) {
    o = o || {};
    return W({ repo: { postTest: true }, releases: ["1.5.0"], fleet: { staging: "1.5.0", production: "1.5.0" },
      before: function (sys) {
        var t = M.tokens(sys, ["ghcr", "staging", "production"]), B0 = CI.bambooSetup(sys, {});
        B0.secrets.SEEDG = t.ghcr; B0.secrets.SEEDS = t.staging; B0.secrets.SEEDP = t.production;
        var dep = M.deploySpecs({ staging: "BAMBOO-SECRET-V1:SEEDS==", production: "BAMBOO-SECRET-V1:SEEDP==" });
        if (o.noPerms) dep = dep.replace(/environment-permissions:[\s\S]*$/, "");
        GH.commit(sys, REPO, "main", "ben", "ci: Bamboo plan and deployments", { "bamboo-specs/bamboo.yml": M.specsPlan({ secret: "BAMBOO-SECRET-V1:SEEDG==" }) + dep });
        if (released >= 2) {
          GH.commit(sys, REPO, "main", "ben", "feat: 1.6.0", { "app.py": CI.notes.appPy({ version: "1.6.0" }) });
          var D = CI.bamboo(sys).deploys["notes-api deployments"], prodEnv = D.envs.filter(function (e) { return e.name === "Production"; })[0];
          D.releases.forEach(function (rel) { CI.bambooDeploy(sys, D, prodEnv, rel, "Manual deployment by maya-chen", "maya-chen"); });
        }
      } });
  }
  // The capstone done: the reference pipeline on main, environment secrets, production policy
  function capDone(extra) {
    return W({ repo: { postTest: true, files: { ".github/workflows/ci.yml": M.CAP_WF, ".github/workflows/release.yml": M.RELEASE_WF } }, releases: ["1.4.0", "1.5.0"], fleet: { staging: "1.5.0", production: "1.5.0" },
      before: function (sys) { M.ghEnvs(sys, { staging: {}, production: { reviewers: ["maya-chen", "kc-dev"] } }); var t = M.tokens(sys, ["staging", "production"]); ghEnvSecret(sys, "staging", t.staging); ghEnvSecret(sys, "production", t.production); if (extra) extra(sys); },
      after: function (sys) { CI.fleetEnv(sys, "notes", "production").policy = { requireSignature: true, identityRe: M.ID_RE, issuer: M.ISSUER }; } });
  }

  T.LABS.forEach(function (l) { if (DRILLS[l.id]) l.drills = DRILLS[l.id]; });
})();
