/* sudo learn — DevOps track, Module 2: CI/CD pipelines (DEV-201..206; 207..212 are in labs-m2b.js).
   The world: kestrel/notes-api on the simulated GitHub, cloned at ~/notes-api; GitHub Actions runners with
   Docker and Python; ghcr.io; Kestrel's deploy platform (kdeploy) running the notes service in staging and
   production. Checks read the workflow files on main, the runs, the registry, signatures and the fleet (CI.H). */
(function () {
  "use strict";
  var T = window.DEV_TRACK, B = T.B, S = window.ShEngine, Dk = window.Dk, DL = window.DevLab, CI = window.CI, GH = window.GitHub, A = window.GitActions, G = window.GitCore;
  var H = CI.H, ex = T.ex, code = T.code, sc = B.sc, sol = B.sol, out = B.out, all = B.all, ran = B.ran, idx = B.idx, HOME = B.HOME;
  var MAYA = B.MAYA, DEV = B.DEV, BEN = B.BEN;
  var REPO = CI.REPO, IMG = CI.IMG;
  var LABS = [];

  /* ---------------- helpers shared by the Module 2 lab files */
  function yml(s) { return s.replace(/\n$/, "") + "\n"; }
  function wfMain(r, re) { return H.wf(r, "main", re || /\/ci\.ya?ml$/); }
  function jobsMain(r, re) { return H.jobsOf(wfMain(r, re)); }
  function pushRuns(r, re) { return H.runs(r, function (x) { return x.event === "push" && x.branch === "main" && (!re || re.test(x.wfPath)); }); }
  function prRuns(r) { return H.runs(r, function (x) { return x.event === "pull_request"; }); }
  function lastPush(r, re) { return pushRuns(r, re)[0] || null; }
  function jobsOk(run, ks) { return !!run && ks.every(function (k) { return H.ok(H.job(run, k)); }); }
  function setupPy(job) { return H.uses(job, /^actions\/setup-python@/); }
  function stepRuns(job) { return H.steps(job).filter(function (s) { return s && s.run !== undefined; }).map(function (s) { return String(s.run); }).join("\n"); }
  function badJobs(run) { return run ? run.jobs.filter(function (j) { return j.status === "completed" && j.conclusion === "failure"; }).map(function (j) { return j.key; }) : []; }
  function runMsg(run, ks) { if (!run) return "Push to main so the workflow runs."; var bad = badJobs(run); if (bad.length) return "The last run on main failed in: " + bad.join(", ") + ". Read its log: gh run view --log-failed"; var miss = ks.filter(function (k) { return !H.job(run, k); }); if (miss.length) return "The last run on main has no job called " + miss.join(", ") + "."; return "The last run on main isn't green yet."; }
  function tokenFile(name, value) { return function (sys) { S.mkdirs(sys, HOME + "/handoff", 448, 1000, 1000); S.put(sys, HOME + "/handoff/" + name, value + "\n", 384, 1000, 1000); }; }
  function ghPull(r, tag) { return ran(r, /^\s*docker\s+(image\s+)?pull\b/, function (e) { return e.cmd.indexOf(IMG) >= 0 && (!tag || e.cmd.indexOf(tag) >= 0) && /Status: (Downloaded newer image|Image is up to date)/.test(all(e)); }); }
  function world(o) { return CI.world(o); }
  var GH_LOGIN = "gh auth token | docker login ghcr.io -u kc-dev --password-stdin";
  var LAST_RUN = "gh run list -L 1 --json databaseId -q '.[0].databaseId'";

  /* ---------------- workflows the labs start from (each lab's solution is the next one's start) */
  var PY_SETUP = sc("      - uses: actions/checkout@v4", "      - uses: actions/setup-python@v5", "        with:", "          python-version: \"3.12\"", "          cache: pip");
  var WF_ONE_JOB = sc(
    "name: CI", "on:", "  push:", "    branches: [main]", "  pull_request:", "jobs:", "  all:", "    runs-on: ubuntu-latest", "    steps:",
    "      - uses: actions/checkout@v4", "      - uses: actions/setup-python@v5", "        with:", "          python-version: \"3.12\"",
    "      - run: pip install -r requirements.txt -r requirements-dev.txt", "      - run: pytest", "      - run: ruff check .", "      - run: docker build -t notes-api:${{ github.sha }} .");
  var WF_SPLIT = sc(
    "name: CI", "on:", "  push:", "    branches: [main]", "  pull_request:", "concurrency:", "  group: ci-${{ github.ref }}", "  cancel-in-progress: true", "jobs:",
    "  lint:", "    runs-on: ubuntu-latest", "    timeout-minutes: 10", "    steps:") + PY_SETUP + sc("      - run: pip install -r requirements-dev.txt", "      - run: ruff check .",
    "  test:", "    runs-on: ubuntu-latest", "    timeout-minutes: 10", "    steps:") + PY_SETUP + sc("      - run: pip install -r requirements.txt -r requirements-dev.txt", "      - run: pytest",
    "  build:", "    needs: [lint, test]", "    runs-on: ubuntu-latest", "    timeout-minutes: 15", "    steps:", "      - uses: actions/checkout@v4", "      - run: docker build -t notes-api:${{ github.sha }} .");
  function wfPush(o) {
    o = o || {};
    return sc("name: CI", "on:", "  push:", "    branches: [main]", "  pull_request:", "concurrency:", "  group: ci-${{ github.ref }}", "  cancel-in-progress: true", "permissions:", "  contents: read", "jobs:",
      "  lint:", "    runs-on: ubuntu-latest", "    timeout-minutes: 10", "    steps:") + PY_SETUP + sc("      - run: pip install -r requirements-dev.txt", "      - run: ruff check ." + (o.gh ? " --output-format=github" : ""),
      "  test:", "    runs-on: ubuntu-latest", "    timeout-minutes: 10", "    steps:") + PY_SETUP + sc("      - run: pip install -r requirements.txt -r requirements-dev.txt", "      - run: pytest" + (o.cov ? " --cov=app --cov-report=term-missing --cov-fail-under=" + o.cov : "")) +
      (o.gates || "") +
      sc("  build:", "    needs: [" + (o.needs || "lint, test") + "]", "    runs-on: ubuntu-latest", "    timeout-minutes: 15", "    permissions:", "      contents: read", "      packages: write" + (o.sign ? "\n      id-token: write\n      attestations: write" : ""),
        "    steps:", "      - uses: actions/checkout@v4", "      - uses: docker/setup-buildx-action@v3", "      - uses: docker/login-action@v3", "        if: github.event_name != 'pull_request'", "        with:", "          registry: ghcr.io", "          username: ${{ github.actor }}", "          password: ${{ secrets.GITHUB_TOKEN }}",
        "      - uses: docker/metadata-action@v5", "        id: meta", "        with:", "          images: ghcr.io/kestrel/notes-api", "          tags: type=sha,format=long",
        "      - uses: docker/build-push-action@v6", "        id: build", "        with:", "          context: .", (o.scan ? "          load: true\n          push: false" : "          push: ${{ github.event_name != 'pull_request' }}"), "          tags: ${{ steps.meta.outputs.tags }}", "          labels: ${{ steps.meta.outputs.labels }}", "          cache-from: type=gha", "          cache-to: type=gha,mode=max") +
      (o.scan ? sc("      - uses: aquasecurity/trivy-action@0.28.0", "        with:", "          image-ref: ${{ steps.meta.outputs.tags }}", "          severity: HIGH,CRITICAL", "          ignore-unfixed: true", "          exit-code: \"1\"",
        "      - name: Push", "        if: github.event_name != 'pull_request'", "        run: docker push ${{ steps.meta.outputs.tags }}") : "") +
      (o.tail || "");
  }
  var WF_PUSH = wfPush({});

  /* ================================================================== DEV-201 Pipeline design */
  var WORLD_201 = world({ repo: { app: { extraImport: "import sys" }, files: { ".github/workflows/ci.yml": WF_ONE_JOB } }, before: function (sys) { GH.commit(sys, REPO, "main", "ben", "docs: how to run the service locally", { "README.md": sc("# notes-api", "", "The Kestrel notes service (Flask).", "", "    pip install -r requirements.txt -r requirements-dev.txt", "    pytest            # tests", "    ruff check .      # lint", "    python app.py     # http://localhost:8000", "", "Images: ghcr.io/kestrel/notes-api. Deploys: Kestrel's platform (kdeploy).") }); } });
  LABS.push({
    id: "dev-201", n: 1, module: 2, ticket: "DEV-201", xp: 160, tool: "GitHub Actions",
    title: "Pipeline design",
    topic: "jobs, needs, failing fast, caching, timeouts, concurrency",
    from: BEN,
    story: "<p>notes-api has one workflow, <code>.github/workflows/ci.yml</code>, with one job that does everything in a row: install, test, lint, build. Ben's last push waited for the whole test run before the linter failed on a one-line mistake, and every run downloads every Python package again. Read the failed run, then redesign the pipeline: quick checks in parallel, the build only after they pass, packages from a cache, and limits so a stuck job can't run for six hours.</p>",
    learn:
      "<h3>What a pipeline is for</h3><p>CI (continuous integration) runs the same checks on every change, on a clean machine, so <i>main</i> always works. CD (continuous delivery) takes a change that passed and ships it. A good pipeline is <b>fast</b> (people wait for it), <b>early</b> (cheap checks fail first) and <b>trustworthy</b> (same result every time).</p>" +
      "<h3>Jobs, steps and needs</h3><p>A workflow has <b>jobs</b>; each job gets a fresh runner and a list of <b>steps</b>. Jobs run <b>in parallel</b> unless one <code>needs</code> another:</p>" +
      code("lint ─┐\n      ├──▶ build      (build: needs: [lint, test])\ntest ─┘") +
      code("jobs:\n  lint:\n    runs-on: ubuntu-latest\n    steps: [...]\n  test:\n    runs-on: ubuntu-latest\n    steps: [...]\n  build:\n    needs: [lint, test]\n    runs-on: ubuntu-latest\n    steps: [...]") +
      "<p>If lint fails, build is <b>skipped</b>: you never wait for an image you can't ship. Each job starts from scratch, so every job checks out the code (<code>actions/checkout</code>) and installs what it needs.</p>" +
      "<h3>Caching dependencies</h3><p><code>actions/setup-python</code> can cache pip's downloads, keyed on a hash of your requirements files. The first run saves the cache; later runs restore it (<i>Cache restored from key</i>) until the requirements change:</p>" +
      code("      - uses: actions/setup-python@v5\n        with:\n          python-version: \"3.12\"\n          cache: pip") +
      "<h3>Limits</h3><p>A job that hangs runs for up to <b>6 hours</b> by default. <code>timeout-minutes: 10</code> on a job stops it sooner. <b>Concurrency</b> stops two runs for the same branch racing each other: with <code>cancel-in-progress</code>, a new push cancels the run that's still going.</p>" +
      code("concurrency:\n  group: ci-${{ github.ref }}\n  cancel-in-progress: true") +
      "<h3>Reading runs</h3>" + ex("gh run list") + ex("gh run view RUN_ID --log-failed") +
      "<p><code>--log-failed</code> shows only the steps that failed. <code>gh run view RUN_ID</code> shows the jobs and how long each took.</p>" +
      '<div class="callout">The Python tools are installed in the repo\'s instructions (README.md). On the laptop, Ubuntu won\'t let <code>pip</code> install into the system Python (PEP 668): make a virtual environment first, <code>python3 -m venv .venv && . .venv/bin/activate</code>.</div>',
    system: WORLD_201,
    starter: "cd ~/notes-api",
    objectives: [
      { id: "read", text: "Find out why the last run on main failed, from its log.", hints: ["gh run list shows the runs; gh run view ID --log-failed shows the failed step.", "gh run list\ngh run view $(" + LAST_RUN + ") --log-failed"],
        check: function (r) { return ran(r, /^\s*gh\s+run\s+view\b/, function (e) { return /F401|imported but unused/.test(all(e)); }) ? true : "Look at the failed run's log with gh run view (--log-failed): what did ruff say?"; } },
      { id: "split", text: "Split <code>ci.yml</code> into three jobs: <code>lint</code> and <code>test</code> running in parallel, and <code>build</code> that runs only after both pass.", hints: ["Three jobs under jobs:. build gets needs: [lint, test]; lint and test have no needs.", "Copy the steps each job needs: checkout and setup-python in lint and test, checkout and docker build in build."],
        check: function (r) { var j = jobsMain(r); if (!j.lint || !j.test || !j.build) return "ci.yml on main needs jobs called lint, test and build (push your change)."; if (H.needs(j.lint).length || H.needs(j.test).length) return "lint and test should run in parallel: no needs on them."; var n = H.needs(j.build); if (n.indexOf("lint") < 0 || n.indexOf("test") < 0) return "build should need both: needs: [lint, test]"; if (!/ruff\s+check/.test(stepRuns(j.lint))) return "lint should run ruff check ."; if (!/pytest/.test(stepRuns(j.test))) return "test should run pytest."; return /docker\s+build/.test(stepRuns(j.build)) ? true : "build should run docker build."; } },
      { id: "cache", text: "Cache pip downloads in <code>lint</code> and <code>test</code> (<code>actions/setup-python</code>'s <code>cache: pip</code>).", hints: ["Under the setup-python step: with: python-version: \"3.12\" and cache: pip"],
        check: function (r) { var j = jobsMain(r); var bad = ["lint", "test"].filter(function (k) { var s = setupPy(j[k]); return !s || !s.with || s.with.cache !== "pip"; }); return bad.length ? "Add cache: pip to setup-python in: " + bad.join(", ") + "." : true; } },
      { id: "limits", text: "Give every job a <code>timeout-minutes</code> of 15 or less, and make a new push to a branch cancel that branch's run that's still in progress.", hints: ["timeout-minutes: 10 under each job. At the top level: concurrency: group: ci-${{ github.ref }}, cancel-in-progress: true"],
        check: function (r) { var w = wfMain(r), j = jobsMain(r), ks = Object.keys(j); if (!ks.length) return "Push ci.yml first."; var bad = ks.filter(function (k) { var t = j[k]["timeout-minutes"]; return !(+t > 0 && +t <= 15); }); if (bad.length) return "No timeout-minutes (≤ 15) on: " + bad.join(", ") + "."; var c = w.doc.concurrency; if (!c || typeof c !== "object" || !/github\.ref/.test(String(c.group || ""))) return "Add a top-level concurrency group based on ${{ github.ref }}."; return c["cancel-in-progress"] === true ? true : "Set cancel-in-progress: true."; } },
      { id: "green", text: "Fix what the linter found, push, and get a green run on main where <code>build</code> ran after <code>lint</code> and <code>test</code>.", hints: ["ruff check --fix . fixes an unused import (in the venv). Or delete the line.", "git add -A && git commit -m \"ci: split the pipeline\" && git push"],
        check: function (r) { var run = lastPush(r); return jobsOk(run, ["lint", "test", "build"]) ? true : runMsg(run, ["lint", "test", "build"]); } },
      { id: "cached", text: "Push another commit and show, from its log, that pip's packages came from the cache.", hints: ["git commit --allow-empty -m \"ci: check the cache\" && git push", "gh run view $(" + LAST_RUN + ") --log | grep -i cache"],
        check: function (r) { var hit = pushRuns(r).some(function (run) { return /Cache restored from key/.test(H.runLog(run)); }); if (!hit) return "No run has restored the pip cache yet: push a second commit after the one that saved it."; return ran(r, /^\s*gh\s+run\s+view\b/, function (e) { return /Cache restored from key/.test(all(e)); }) ? true : "Show it: gh run view ... --log (grep for cache)."; } }
    ],
    solution: sol("cd ~/notes-api", "gh run list", "gh run view $(" + LAST_RUN + ") --log-failed", "cat .github/workflows/ci.yml", { nano: ".github/workflows/ci.yml", text: WF_SPLIT },
      "python3 -m venv .venv", ". .venv/bin/activate", "pip install -q -r requirements.txt -r requirements-dev.txt", "ruff check --fix .", "pytest -q", "echo .venv/ >> .gitignore",
      "git add -A", "git commit -m \"ci: lint and test in parallel, build after both\"", "git push", "gh run list -L 2", "gh run view $(" + LAST_RUN + ")",
      "git commit --allow-empty -m \"ci: check the cache\"", "git push", "gh run view $(" + LAST_RUN + ") --log | grep -i \"cache restored\""),
    debrief: "<p>Lint and tests now run side by side and the build waits for both, so a typo fails in seconds instead of after the whole test suite. The second run restored pip's packages from the cache instead of downloading them again. Timeouts and concurrency keep the runners free for useful work.</p><p>The build still throws its image away at the end of the job. Next: push it to a registry, tagged so you can always tell which commit it came from.</p>",
    realworld: "Open the Actions tab of any busy open-source project (for example github.com/pallets/flask/actions) and look at a run's graph: the same lint/test/build shape, often with a matrix of Python versions.",
    quiz: [
      { q: "Job <code>build</code> has <code>needs: [lint, test]</code>. <code>lint</code> fails. What happens to <code>build</code>?", options: ["It runs anyway", "It's skipped", "It waits for lint to be re-run", "It fails with lint's error"], answer: 1, why: "A job whose needs didn't succeed is skipped (unless it uses if: always() or similar)." },
      { q: "Why run the linter as its own job instead of after the tests?", options: ["Linters need their own runner", "It finishes in seconds, so a mistake is reported without waiting for the slow steps", "GitHub requires it", "Tests can't run if ruff is installed"], answer: 1, why: "Fail fast: the cheapest checks report first, in parallel with the slow ones." },
      { q: "What does <code>cancel-in-progress: true</code> in a concurrency group do?", options: ["Cancels every run in the repository", "When a new run in the same group starts, the older one still running is cancelled", "Stops a job after its timeout", "Prevents pushes while a run is going"], answer: 1, why: "With group: ci-${{ github.ref }}, two quick pushes to one branch don't both run to the end." }
    ]
  });

  /* ================================================================== DEV-202 Build & push images */
  var WORLD_202 = world({ repo: { files: { ".github/workflows/ci.yml": WF_SPLIT } } });
  LABS.push({
    id: "dev-202", n: 2, module: 2, ticket: "DEV-202", xp: 170, tool: "GitHub Actions",
    title: "Build & push images",
    topic: "ghcr.io, GITHUB_TOKEN permissions, commit-SHA tags, layer cache",
    from: MAYA,
    story: "<p>Deploys need an image in a registry, not one that dies with the runner. Make the pipeline push notes-api to <b>GitHub Container Registry</b> (<code>ghcr.io/kestrel/notes-api</code>), tagged with the <b>full commit SHA</b> so every image points at exactly one commit. Give the workflow only the permissions it needs, and don't push anything from pull requests: those are untrusted until reviewed.</p>",
    learn:
      "<h3>Which tag?</h3><p><code>latest</code> moves every time someone pushes, so it can't tell you what's running. Tag CI images with the <b>commit SHA</b>: <code>ghcr.io/kestrel/notes-api:sha-3e2b7bc5…</code> is that commit and nothing else. Release tags like <code>1.6.0</code> come in DEV-205.</p>" +
      "<h3>GITHUB_TOKEN and permissions</h3><p>Every run gets a short-lived <code>GITHUB_TOKEN</code>. What it may do is set by <code>permissions</code>. Set the workflow's default to read-only and give <code>packages: write</code> only to the job that pushes:</p>" +
      code("permissions:\n  contents: read          # every job: read the code, nothing else\n\njobs:\n  build:\n    permissions:\n      contents: read\n      packages: write     # this job may push to ghcr.io") +
      "<p>Listing permissions on a job <b>replaces</b> the defaults for that job, so repeat <code>contents: read</code> there (checkout needs it).</p>" +
      "<h3>The Docker actions</h3>" +
      '<table class="t"><tr><th>Action</th><th>Does</th></tr><tr><td><code>docker/setup-buildx-action</code></td><td>starts BuildKit with a builder that can export cache</td></tr><tr><td><code>docker/login-action</code></td><td><code>docker login</code> (here with the GITHUB_TOKEN)</td></tr><tr><td><code>docker/metadata-action</code></td><td>works out tags and OCI labels from the event: <code>type=sha,format=long</code> gives <code>sha-&lt;full sha&gt;</code></td></tr><tr><td><code>docker/build-push-action</code></td><td>builds, and pushes when <code>push: true</code></td></tr></table>' +
      code("      - uses: docker/metadata-action@v5\n        id: meta\n        with:\n          images: ghcr.io/kestrel/notes-api\n          tags: type=sha,format=long\n      - uses: docker/build-push-action@v6\n        with:\n          context: .\n          push: ${{ github.event_name != 'pull_request' }}\n          tags: ${{ steps.meta.outputs.tags }}\n          labels: ${{ steps.meta.outputs.labels }}\n          cache-from: type=gha\n          cache-to: type=gha,mode=max") +
      "<p><code>cache-to: type=gha</code> saves BuildKit's layers in the GitHub Actions cache and <code>cache-from</code> reuses them, so the next build says <b>CACHED</b> for steps whose inputs didn't change.</p>" +
      "<h3>Pull requests</h3><p>A PR's code hasn't been reviewed yet. Build it (that checks the Dockerfile works) but don't log in or push: <code>if: github.event_name != 'pull_request'</code> on the login step, and the same expression for <code>push</code>.</p>" +
      "<h3>Pulling on the laptop</h3><p>ghcr.io takes a GitHub token as the password. <code>gh</code> already has one with <code>read:packages</code>:</p>" + ex(GH_LOGIN) + ex("docker pull ghcr.io/kestrel/notes-api:sha-$(git rev-parse HEAD)"),
    system: WORLD_202,
    starter: "cd ~/notes-api",
    objectives: [
      { id: "perms", text: "Make the workflow's token read-only by default (<code>permissions: contents: read</code> at the top), with <code>packages: write</code> only on the <code>build</code> job.", hints: ["Top level: permissions: contents: read. Under build: permissions: with contents: read and packages: write."],
        check: function (r) { var w = wfMain(r); if (!w) return "Push ci.yml."; var p = w.doc.permissions; if (!p || typeof p !== "object" || p.contents !== "read" || Object.keys(p).some(function (k) { return p[k] === "write"; })) return "Set top-level permissions to contents: read (nothing else writable)."; var j = jobsMain(r); if (!j.build) return "Keep the build job."; var bp = j.build.permissions; if (!bp || bp.packages !== "write") return "Give the build job permissions: packages: write (and contents: read)."; var other = Object.keys(j).filter(function (k) { return k !== "build" && j[k].permissions && j[k].permissions.packages === "write"; }); return other.length ? "Only build should be able to write packages (not " + other.join(", ") + ")." : true; } },
      { id: "push", text: "Log in to <code>ghcr.io</code> with the <code>GITHUB_TOKEN</code> and push the image tagged <code>sha-&lt;full commit SHA&gt;</code>, using the Docker actions with the GitHub Actions layer cache.", hints: ["setup-buildx-action, login-action (registry: ghcr.io, password: ${{ secrets.GITHUB_TOKEN }}), metadata-action (tags: type=sha,format=long), build-push-action (cache-from/cache-to: type=gha).", "See the Learn tab for the whole build job."],
        check: function (r) { var j = jobsMain(r).build; if (!j) return "Keep the build job."; if (!H.uses(j, /^docker\/login-action@/)) return "Log in with docker/login-action."; var bp = H.uses(j, /^docker\/build-push-action@/); if (!bp) return "Build and push with docker/build-push-action."; if (!/type=gha/.test(String((bp.with || {})["cache-to"] || ""))) return "Export the layer cache: cache-to: type=gha,mode=max (and cache-from: type=gha)."; if (!H.uses(j, /^docker\/setup-buildx-action@/)) return "Exporting cache needs docker/setup-buildx-action before the build."; var tip = H.tip(r); return tip && H.tags(r)["sha-" + tip] ? true : "ghcr.io has no image tagged sha-" + (tip || "<sha of main>") + " yet. Push to main and check the run."; } },
      { id: "green", text: "Get a green run on main: lint, test and build.", hints: ["gh run list; gh run view ID --log-failed if something failed."],
        check: function (r) { var run = lastPush(r); return jobsOk(run, ["lint", "test", "build"]) ? true : runMsg(run, ["lint", "test", "build"]); } },
      { id: "pull", text: "On the laptop, log in to ghcr.io with your <code>gh</code> token and pull the image built from main's latest commit.", hints: [GH_LOGIN, "docker pull ghcr.io/kestrel/notes-api:sha-$(git rev-parse origin/main)"],
        check: function (r) { var tip = H.tip(r); return tip && ghPull(r, "sha-") && r.history.some(function (e) { return /docker\s+(image\s+)?pull/.test(e.cmd) && /Status:/.test(all(e)) && (e.cmd.indexOf(tip) >= 0 || /\$\(git rev-parse/.test(e.cmd)); }) ? true : "Pull ghcr.io/kestrel/notes-api:sha-<main's commit> (log in first: " + GH_LOGIN + ")."; } },
      { id: "pr", text: "Open a pull request. Its run must <b>build</b> the image without pushing it.", hints: ["Branch, commit, push, gh pr create. The login step gets if: github.event_name != 'pull_request', and push: ${{ github.event_name != 'pull_request' }}", "git switch -c docs/run-locally\necho \"Run it: docker run -p 8000:8000 notes-api\" >> README.md\ngit commit -am \"docs: run the image\"\ngit push -u origin docs/run-locally\ngh pr create --fill"],
        check: function (r) { var run = prRuns(r)[0]; if (!run) return "Open a pull request (gh pr create) so a pull_request run happens."; var b = H.job(run, "build"); if (!H.ok(b)) return "The PR's build job should succeed (it failed or didn't run: gh pr checks)."; if (/The push refers to repository/.test(H.log(b))) return "The PR's run pushed an image. Pull requests should only build: push: ${{ github.event_name != 'pull_request' }}"; return /login-action/.test(H.log(b)) && /Login Succeeded/.test(H.log(b)) ? "The PR's run still logs in to ghcr.io: skip the login step on pull requests." : true; } },
      { id: "cache", text: "Show that a later build reused layers: a build log where the pip install step is <code>CACHED</code>.", hints: ["Any second push builds again (the PR counts too). gh run view ID --log | grep CACHED"],
        check: function (r) { return ran(r, /^\s*gh\s+run\s+view\b/, function (e) { return /CACHED \[\d\/\d\] RUN pip install/.test(all(e)); }) ? true : "Look at a later run's build log (gh run view ID --log) and find the CACHED pip install step."; } }
    ],
    solution: sol("cd ~/notes-api", { nano: ".github/workflows/ci.yml", text: WF_PUSH }, "git add -A", "git commit -m \"ci: push images to ghcr.io tagged with the commit\"", "git push", "gh run list -L 1",
      GH_LOGIN, "docker pull ghcr.io/kestrel/notes-api:sha-$(git rev-parse HEAD)",
      "git switch -c docs/run-locally", "echo \"Run it: docker run -p 8000:8000 ghcr.io/kestrel/notes-api:sha-COMMIT\" >> README.md", "git commit -am \"docs: run the image\"", "git push -u origin docs/run-locally", "gh pr create --fill", "gh pr checks",
      "gh run view $(" + LAST_RUN + ") --log | grep -E \"CACHED|push refers\""),
    debrief: "<p>Every push to main now leaves an image in ghcr.io whose tag <i>is</i> its commit, built with a token that can only write packages from the one job that needs to. Pull requests build but never publish, and BuildKit's layer cache makes repeat builds take seconds.</p><p>The image is only as good as the checks in front of it. Next: make the tests and linter <b>gates</b> that a change can't get past.</p>",
    realworld: "Look at the Packages tab of a GitHub organisation (for example github.com/orgs/home-assistant/packages): many projects publish to ghcr.io from Actions exactly like this.",
    quiz: [
      { q: "Why tag CI images with the commit SHA rather than <code>latest</code>?", options: ["SHA tags are smaller", "A SHA tag always means the same commit, so you know exactly what's deployed", "latest isn't allowed on ghcr.io", "SHA tags are signed automatically"], answer: 1, why: "latest moves on every push. A SHA tag is traceable to one commit forever." },
      { q: "A job lists <code>permissions: packages: write</code> only. What can its GITHUB_TOKEN do with the code?", options: ["Read and write it", "Read it", "Nothing: listed permissions replace the defaults, so contents is none", "Whatever the workflow's top level says"], answer: 2, why: "Job-level permissions replace the defaults for that job. Add contents: read or checkout fails." },
      { q: "Why not push images from pull_request runs?", options: ["PR runs have no Docker", "The code isn't reviewed yet, so its image shouldn't land next to trusted ones", "It's slower", "ghcr.io rejects them"], answer: 1, why: "Build to prove it works; publish only what's been reviewed and merged." }
    ]
  });

  /* ================================================================== DEV-203 Tests & quality gates */
  var WORLD_203 = world({ repo: { files: { ".github/workflows/ci.yml": WF_PUSH } } });
  var PROTECTION = '{\n  "required_status_checks": { "strict": true, "contexts": ["lint", "test"] },\n  "enforce_admins": true,\n  "required_pull_request_reviews": null,\n  "restrictions": null\n}\n';
  LABS.push({
    id: "dev-203", n: 3, module: 2, ticket: "DEV-203", xp: 180, tool: "pytest",
    title: "Tests & quality gates",
    topic: "pytest, coverage, fail-under, lint annotations, required status checks",
    from: MAYA,
    story: "<p>The tests pass, but nobody knows how much of the code they cover, and last week a PR with a failing test was merged anyway because nothing stopped it. Measure coverage, write the missing test, make the pipeline <b>fail</b> when coverage drops, and protect <code>main</code> so a pull request can't merge until lint and tests are green.</p>",
    learn:
      "<h3>Tests in a virtual environment</h3><p>Ubuntu's Python is managed by apt, so <code>pip install</code> into it fails with <i>externally-managed-environment</i> (PEP 668). A virtual environment is a private Python for the project:</p>" +
      code("python3 -m venv .venv          # once\n. .venv/bin/activate           # every new shell\npip install -r requirements.txt -r requirements-dev.txt\npytest -v") +
      "<h3>Coverage</h3><p><code>pytest-cov</code> records which lines the tests ran:</p>" + ex("pytest --cov=app --cov-report=term-missing") +
      code("Name      Stmts   Miss  Cover   Missing\n---------------------------------------\napp.py       27      6    77%   35-39, 44") +
      "<p><b>Missing</b> lists the lines no test touched: that's where to write tests. Coverage doesn't prove the code is right, but code that no test runs is certainly untested.</p>" +
      "<h3>A test for POST</h3><p>Flask's test client sends requests without a server:</p>" + code(CI.notes.TEST_POST.replace(/^\n+/, "")) +
      "<h3>Gates</h3><p>A <b>quality gate</b> is a check that fails the pipeline. <code>--cov-fail-under=85</code> makes pytest exit non-zero when total coverage is below 85%. For lint, <code>ruff check --output-format=github</code> turns each problem into an <b>annotation</b> that GitHub shows on the PR's changed lines.</p>" +
      "<h3>Required status checks</h3><p>A red check is only a gate if it blocks the merge. Branch protection on <code>main</code> can require named checks (the job names) to pass:</p>" + code(PROTECTION) +
      ex("gh api -X PUT repos/kestrel/notes-api/branches/main/protection --input protection.json") +
      "<p><code>strict</code> also requires the PR to be up to date with main. With <code>enforce_admins</code> it applies to admins too, so <b>finish pushing your own changes to main first</b>: after this, main only changes through green pull requests.</p>",
    system: WORLD_203,
    starter: "cd ~/notes-api",
    objectives: [
      { id: "cov", text: "Run the tests with coverage on the laptop (in a virtual environment) and find which lines are missed.", hints: ["python3 -m venv .venv && . .venv/bin/activate, then install both requirements files.", "pytest --cov=app --cov-report=term-missing"],
        check: function (r) { return ran(r, /pytest\b.*--cov/, function (e) { return /TOTAL\s+\d+\s+\d+\s+\d+%/.test(all(e)) && /Missing/.test(all(e)); }) ? true : "Run pytest --cov=app --cov-report=term-missing in a venv."; } },
      { id: "test", text: "Write <code>test_add_note</code> for <code>POST /notes</code> and get coverage to <b>90% or more</b> on the laptop.", hints: ["Add the test from the Learn tab to tests/test_app.py (nano or cat >>).", "pytest --cov=app --cov-report=term-missing"],
        check: function (r) { var k = idx(r, /pytest\b.*--cov/, function (e) { var m = /TOTAL\s+\d+\s+\d+\s+(\d+)%/.exec(all(e)); return m && +m[1] >= 90 && !/failed/.test(all(e)); }); return k >= 0 ? true : "Coverage should reach 90% with all tests passing: test POST /notes."; } },
      { id: "gate", text: "Make CI fail below <b>85%</b> coverage, and have the lint job report problems as GitHub annotations.", hints: ["test job: pytest --cov=app --cov-report=term-missing --cov-fail-under=85", "lint job: ruff check . --output-format=github"],
        check: function (r) { var j = jobsMain(r); if (!j.test || !j.lint) return "Keep the lint and test jobs."; var m = /--cov-fail-under[= ](\d+)/.exec(stepRuns(j.test)); if (!m || !/--cov\b|--cov=/.test(stepRuns(j.test))) return "In the test job, run pytest with --cov=app and --cov-fail-under=85."; if (+m[1] < 85) return "--cov-fail-under should be at least 85."; return /--output-format[= ]github/.test(stepRuns(j.lint)) ? true : "In the lint job: ruff check . --output-format=github"; } },
      { id: "green", text: "Push to main and get a green run with the new test and gates.", hints: ["git add -A && git commit -m \"test: POST /notes; coverage gate\" && git push"],
        check: function (r) { var run = lastPush(r); if (!jobsOk(run, ["lint", "test", "build"])) return runMsg(run, ["lint", "test", "build"]); return /test_add_note/.test(H.fileOn(r, "main", "tests/test_app.py") || "") ? true : "main's tests/test_app.py should have test_add_note."; } },
      { id: "protect", text: "Protect <code>main</code>: the <code>lint</code> and <code>test</code> checks must pass before anything merges.", hints: ["Write protection.json (Learn tab), then gh api -X PUT repos/kestrel/notes-api/branches/main/protection --input protection.json"],
        check: function (r) { var x = H.repo(r), p = x && x.protect && x.protect.main; var ctx = p && p.checks && p.checks.contexts || []; return ["lint", "test"].every(function (c) { return ctx.indexOf(c) >= 0; }) ? true : "main's protection should require the lint and test checks."; } },
      { id: "blocked", text: "Prove the gate works: open a PR that breaks a test, see its checks fail, and watch <code>gh pr merge</code> refuse it.", hints: ["git switch -c break-health, change \"ok\" to \"OK\" in app.py's /health, commit, push, gh pr create --fill.", "gh pr checks\ngh pr merge --merge"],
        check: function (r) { var bad = prRuns(r).some(function (run) { var t = H.job(run, "test"); return t && t.conclusion === "failure"; }); if (!bad) return "Open a PR whose test job fails."; return ran(r, /^\s*gh\s+pr\s+merge\b/, function (e) { return /Required status check|required status checks|is not mergeable|failed/i.test(all(e)) && e.exit !== 0; }) ? true : "Try to merge it: gh pr merge --merge (it should be refused)."; } }
    ],
    solution: sol("cd ~/notes-api", "pip install -r requirements.txt", "python3 -m venv .venv", ". .venv/bin/activate", "pip install -q -r requirements.txt -r requirements-dev.txt", "pytest --cov=app --cov-report=term-missing",
      { nano: "tests/test_app.py", text: CI.notes.TESTS + CI.notes.TEST_POST }, "pytest --cov=app --cov-report=term-missing",
      { nano: ".github/workflows/ci.yml", text: wfPush({ cov: 85, gh: true }) }, "echo .venv/ >> .gitignore", "git add -A", "git commit -m \"test: POST /notes, coverage gate, lint annotations\"", "git push", "gh run list -L 1",
      { nano: "protection.json", text: PROTECTION }, "gh api -X PUT repos/kestrel/notes-api/branches/main/protection --input protection.json", "rm protection.json",
      "git switch -c break-health", "sed -i 's/status=\"ok\"/status=\"OK\"/' app.py", "git commit -am \"chore: shout\"", "git push -u origin break-health", "gh pr create --fill", "gh pr checks", "gh pr merge --merge"),
    debrief: "<p>Coverage went from 77% to the high 90s with one test, and the pipeline now fails if it slips under 85%. Lint problems show up on the PR's lines. Most importantly, branch protection turned red checks into a <b>gate</b>: the broken PR couldn't merge.</p><p>Tests check that the code does what you meant. Next: checks for what an attacker would do with it.</p>",
    realworld: "In a GitHub repo you admin: Settings → Branches (or Rules → Rulesets) → require status checks to pass. Codecov and Coveralls track coverage over time and comment on PRs.",
    quiz: [
      { q: "<code>pytest --cov=app --cov-fail-under=85</code> runs, all tests pass, coverage is 80%. Exit code?", options: ["0", "Non-zero: the coverage gate failed", "0 with a warning", "It depends on ruff"], answer: 1, why: "The gate fails the run even though every test passed." },
      { q: "A PR's <code>test</code> check is red, but nothing stops the merge button. What's missing?", options: ["A coverage report", "Branch protection that requires the test check", "A second reviewer", "permissions: checks: write"], answer: 1, why: "Checks only report. Required status checks in branch protection (or a ruleset) make them block." },
      { q: "Why does <code>pip install</code> on Ubuntu 24.04 say <i>externally-managed-environment</i>?", options: ["pip is broken", "The system Python belongs to apt (PEP 668); use a virtual environment", "You need sudo", "requirements.txt is invalid"], answer: 1, why: "Installing into the system Python could break OS tools. A venv keeps the project's packages separate." }
    ]
  });

  /* ================================================================== DEV-204 Security gates */
  // a revoked token committed (and later deleted) in history: gitleaks finds it with full history
  var OLD_TOKEN = ["gh", "p_"].join("") + "Z3kQ8vT1mW6yR4nP0sL7dF2hJ9cX5bA8eK3u";
  var GATES = sc(
    "  sast:", "    runs-on: ubuntu-latest", "    timeout-minutes: 10", "    steps:") + PY_SETUP + sc("      - run: pip install semgrep", "      - run: semgrep scan --config p/python --error",
    "  deps:", "    runs-on: ubuntu-latest", "    timeout-minutes: 10", "    steps:", "      - uses: actions/checkout@v4", "      - uses: aquasecurity/trivy-action@0.28.0", "        with:", "          scan-type: fs", "          scan-ref: .", "          severity: HIGH,CRITICAL", "          ignore-unfixed: true", "          exit-code: \"1\"",
    "  secrets:", "    runs-on: ubuntu-latest", "    timeout-minutes: 10", "    steps:", "      - uses: actions/checkout@v4", "        with:", "          fetch-depth: 0", "      - uses: gitleaks/gitleaks-action@v2", "        env:", "          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}");
  var WF_GATES = wfPush({ cov: 85, gh: true, gates: GATES, needs: "lint, test, sast, deps, secrets", scan: true });
  var WORLD_204 = world({ repo: { postTest: true, app: { debug: true }, req: sc("flask==3.1.1", "gunicorn==21.2.0"), files: { ".github/workflows/ci.yml": wfPush({ cov: 85, gh: true }) } },
    steps: [{ msg: "chore: local settings for the demo", by: "ben", at: "2026-10-22 16:40", files: { ".env": sc("NOTES_DIR=/tmp/notes", "GITHUB_TOKEN=" + OLD_TOKEN) } }, { msg: "chore: remove .env", by: "ben", at: "2026-10-22 16:52", files: { ".env": null } }] });
  LABS.push({
    id: "dev-204", n: 4, module: 2, ticket: "DEV-204", xp: 190, tool: "Semgrep · Trivy · Gitleaks",
    title: "Security gates",
    topic: "SAST, dependency scanning, secret scanning, image scanning",
    from: DEV,
    story: "<p>Before notes-api goes anywhere near production, Dev from Security wants four scans in the pipeline, each one a gate the build waits for: <b>code</b> (Semgrep), <b>dependencies</b> (Trivy), <b>secrets in the whole Git history</b> (Gitleaks) and the <b>finished image</b> (Trivy, before it's pushed). Add them, then fix what they find. One finding is a GitHub token Ben committed and deleted in October: it was revoked the same day, so it can be marked as handled rather than rewriting history.</p>",
    learn:
      "<h3>Four kinds of scan</h3>" +
      '<table class="t"><tr><th>Scan</th><th>Looks at</th><th>Tool here</th></tr><tr><td>SAST (static analysis)</td><td>your source code: dangerous patterns</td><td><code>semgrep scan --config p/python --error</code></td></tr><tr><td>SCA (dependencies)</td><td>versions in requirements.txt against known CVEs</td><td><code>trivy fs</code></td></tr><tr><td>Secrets</td><td>every commit, for keys and tokens</td><td><code>gitleaks</code></td></tr><tr><td>Image</td><td>the OS packages and libraries in the built image</td><td><code>trivy image</code></td></tr></table>' +
      "<p>Each runs as its own job, in parallel with lint and test. The build <code>needs</code> all of them, so nothing is built (let alone pushed) until every gate is green.</p>" +
      "<h3>Semgrep</h3><p><code>--error</code> makes findings fail the job. Flask's <code>debug=True</code> is a classic: the debugger lets anyone who can reach the page run code.</p>" + ex("pip install semgrep && semgrep scan --config p/python --error") +
      "<h3>Trivy on the repository</h3>" + code("      - uses: aquasecurity/trivy-action@0.28.0\n        with:\n          scan-type: fs\n          scan-ref: .\n          severity: HIGH,CRITICAL\n          ignore-unfixed: true\n          exit-code: \"1\"") +
      "<p>The fix for a vulnerable dependency is usually to bump it to the <b>Fixed Version</b> Trivy prints, then re-run the tests.</p>" +
      "<h3>Gitleaks needs the whole history</h3><p><code>actions/checkout</code> fetches only the latest commit by default. A secret deleted in a later commit is still in an earlier one, so give the secrets job <code>fetch-depth: 0</code>:</p>" +
      code("      - uses: actions/checkout@v4\n        with:\n          fetch-depth: 0\n      - uses: gitleaks/gitleaks-action@v2\n        env:\n          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}") +
      "<p>A real leak means: <b>revoke the secret first</b>, then decide about history. A finding that's already handled goes in <code>.gitleaksignore</code>, one <b>Fingerprint</b> per line (gitleaks prints it: <code>commit:file:rule:line</code>). Run gitleaks on the laptop to see it:</p>" + ex("gitleaks detect -v") +
      "<h3>Scan the image before pushing</h3><p>Build with <code>load: true, push: false</code>, scan the local image with trivy-action (<code>image-ref</code>), and push in a later step only if the scan passed.</p>" +
      code("      - uses: docker/build-push-action@v6\n        with:\n          context: .\n          load: true\n          push: false\n          tags: ${{ steps.meta.outputs.tags }}\n      - uses: aquasecurity/trivy-action@0.28.0\n        with:\n          image-ref: ${{ steps.meta.outputs.tags }}\n          severity: HIGH,CRITICAL\n          ignore-unfixed: true\n          exit-code: \"1\"\n      - name: Push\n        if: github.event_name != 'pull_request'\n        run: docker push ${{ steps.meta.outputs.tags }}"),
    system: WORLD_204,
    starter: "cd ~/notes-api",
    objectives: [
      { id: "sast", text: "Add a <code>sast</code> job that runs Semgrep's <code>p/python</code> rules and fails on findings, and fix what it finds.", hints: ["Job steps: checkout, setup-python, pip install semgrep, semgrep scan --config p/python --error. Try it on the laptop in the venv first.", "The finding is debug=True in app.run(...): remove it."],
        check: function (r) { var j = jobsMain(r).sast; if (!j) return "Add a job called sast."; if (!/semgrep\b[^\n]*--config[= ]?\S*p\/python/.test(stepRuns(j)) || !/--error/.test(stepRuns(j))) return "sast should run semgrep scan --config p/python --error."; if (/debug\s*=\s*True/.test(H.fileOn(r, "main", "app.py") || "")) return "app.py on main still runs Flask with debug=True."; var run = lastPush(r); return run && H.ok(H.job(run, "sast")) ? true : "Push and get a green sast job."; } },
      { id: "deps", text: "Add a <code>deps</code> job that scans the repository's dependencies with Trivy (HIGH and CRITICAL fail it), and upgrade what it flags.", hints: ["aquasecurity/trivy-action with scan-type: fs, scan-ref: ., severity: HIGH,CRITICAL, ignore-unfixed: true, exit-code: \"1\". On the laptop: trivy fs .", "gunicorn 21.2.0 has CVE-2024-1135: set gunicorn==23.0.0 in requirements.txt."],
        check: function (r) { var j = jobsMain(r).deps, t = j && H.uses(j, /^aquasecurity\/trivy-action@/); if (!t) return "Add a job called deps using aquasecurity/trivy-action."; var w = t.with || {}; if (w["scan-type"] !== "fs") return "Scan the repository: scan-type: fs (scan-ref: .)."; if (String(w["exit-code"]) !== "1" || !/HIGH/.test(String(w.severity || "")) || !/CRITICAL/.test(String(w.severity || ""))) return "Make it a gate: severity: HIGH,CRITICAL and exit-code: \"1\"."; if (/gunicorn==21\./.test(H.fileOn(r, "main", "requirements.txt") || "")) return "requirements.txt on main still pins gunicorn 21.2.0."; var run = lastPush(r); return run && H.ok(H.job(run, "deps")) ? true : "Push and get a green deps job."; } },
      { id: "secrets", text: "Add a <code>secrets</code> job that runs Gitleaks over the <b>whole</b> history. Mark Ben's revoked October token as handled in <code>.gitleaksignore</code>.", hints: ["checkout with fetch-depth: 0, then gitleaks/gitleaks-action@v2 with env GITHUB_TOKEN.", "gitleaks detect -v on the laptop prints the Fingerprint. Put it in .gitleaksignore: gitleaks detect -v 2>&1 | awk '/^Fingerprint:/ {print $2}' > .gitleaksignore"],
        check: function (r) { var j = jobsMain(r).secrets; if (!j || !H.uses(j, /^gitleaks\/gitleaks-action@/)) return "Add a job called secrets with gitleaks/gitleaks-action."; var co = H.uses(j, /^actions\/checkout@/); if (!co || !co.with || String(co.with["fetch-depth"]) !== "0") return "Checkout in the secrets job needs fetch-depth: 0, or the old commit isn't there to scan."; var ig = H.fileOn(r, "main", ".gitleaksignore") || ""; if (!/:\.env:github-pat:\d+/.test(ig)) return ".gitleaksignore on main should hold the finding's Fingerprint (commit:.env:github-pat:line)."; var run = lastPush(r); return run && H.ok(H.job(run, "secrets")) ? true : "Push and get a green secrets job."; } },
      { id: "image", text: "Scan the built image with Trivy <b>before</b> it's pushed: build it locally in the job, scan it (HIGH and CRITICAL fail), then push.", hints: ["build-push-action with load: true and push: false; trivy-action with image-ref; a docker push step (if: github.event_name != 'pull_request') after the scan. See the Learn tab."],
        check: function (r) { var j = jobsMain(r).build; if (!j) return "Keep the build job."; var st = H.steps(j), bi = -1, ti = -1, pi = -1; st.forEach(function (s, i) { if (s.uses && /^docker\/build-push-action@/.test(s.uses)) bi = i; if (s.uses && /^aquasecurity\/trivy-action@/.test(s.uses) && s.with && s.with["image-ref"]) ti = i; if ((s.run && /docker\s+push/.test(s.run)) || (s.uses && /build-push-action/.test(s.uses) && i > bi && bi >= 0 && String((s.with || {}).push) !== "false")) pi = i; }); if (bi < 0 || ti < 0) return "The build job should build, then scan with trivy-action (image-ref)."; var bw = st[bi].with || {}; if (String(bw.push) === "true") return "Don't push in the first build step: load: true, push: false."; if (ti < bi || pi < ti) return "Order: build (load), scan, then push."; var tw = st[ti].with || {}; if (String(tw["exit-code"]) !== "1") return "The image scan should fail the job: exit-code: \"1\"."; var tip = H.tip(r); return tip && H.tags(r)["sha-" + tip] ? true : "Push to main: the scanned image should land in ghcr.io as sha-<commit>."; } },
      { id: "order", text: "The build waits for every gate: <code>needs</code> lint, test, sast, deps and secrets. Get a fully green run on main.", hints: ["build: needs: [lint, test, sast, deps, secrets]"],
        check: function (r) { var n = H.needs(jobsMain(r).build); var miss = ["lint", "test", "sast", "deps", "secrets"].filter(function (k) { return n.indexOf(k) < 0; }); if (miss.length) return "build should also need: " + miss.join(", ") + "."; var run = lastPush(r); return jobsOk(run, ["lint", "test", "sast", "deps", "secrets", "build"]) ? true : runMsg(run, ["lint", "test", "sast", "deps", "secrets", "build"]); } }
    ],
    solution: sol("cd ~/notes-api", "python3 -m venv .venv", ". .venv/bin/activate", "pip install -q -r requirements.txt -r requirements-dev.txt semgrep", "semgrep scan --config p/python --error", "sed -i 's/, debug=True//' app.py", "semgrep scan --config p/python --error",
      "trivy fs --severity HIGH,CRITICAL .", "sed -i 's/gunicorn==21.2.0/gunicorn==23.0.0/' requirements.txt", "trivy fs --severity HIGH,CRITICAL --exit-code 1 .",
      "gitleaks detect -v", "gitleaks detect -v 2>&1 | awk '/^Fingerprint:/ {print $2}' > .gitleaksignore", "cat .gitleaksignore", "gitleaks detect",
      { nano: ".github/workflows/ci.yml", text: WF_GATES }, "echo .venv/ >> .gitignore", "git add -A", "git commit -m \"ci: security gates (semgrep, trivy, gitleaks, image scan)\"", "git push", "gh run list -L 1", "gh run view $(" + LAST_RUN + ")"),
    debrief: "<p>Four gates now stand between a commit and ghcr.io: Semgrep caught the Flask debugger, Trivy caught a request-smuggling bug in an old gunicorn, Gitleaks found a token in a commit nobody remembered, and the image itself is scanned before it can be pushed. The build can't start until all of them pass.</p><p>Next: images with a SHA tag are perfect for machines, but people talk about <b>versions</b>. Time for releases.</p>",
    realworld: "GitHub's own secret scanning and Dependabot do the secrets and dependency parts for free on public repos (Settings → Code security). Semgrep, Trivy and Gitleaks are all open source and run the same way on your laptop.",
    quiz: [
      { q: "Gitleaks in CI finds nothing, but locally it finds a token in an old commit. Most likely reason?", options: ["CI uses a different rule set", "CI checked out only the latest commit (no fetch-depth: 0)", "The token was revoked", "Gitleaks ignores .env files in CI"], answer: 1, why: "actions/checkout fetches one commit by default; history scanning needs fetch-depth: 0." },
      { q: "A leaked token is found in Git history. What comes first?", options: ["Add it to .gitleaksignore", "Rewrite history", "Revoke the token", "Make the repository private"], answer: 2, why: "Anyone who cloned it has the token already. Revoke it; history clean-up and ignore files come after." },
      { q: "Why scan the image as well as requirements.txt?", options: ["It's faster", "The image also has OS packages and anything the base image brings", "requirements.txt can't be scanned", "Registries require it"], answer: 1, why: "The base image (Debian packages, OpenSSL, ...) isn't in requirements.txt but ships in the image." }
    ]
  });

  /* ================================================================== DEV-205 Versions & releases */
  var RELEASE_WF = sc("name: Release", "on:", "  push:", "    tags: ['v*.*.*']", "permissions:", "  contents: write", "  packages: write", "jobs:", "  release:", "    runs-on: ubuntu-latest", "    timeout-minutes: 15", "    steps:",
    "      - uses: actions/checkout@v4", "      - uses: docker/setup-buildx-action@v3", "      - uses: docker/login-action@v3", "        with:", "          registry: ghcr.io", "          username: ${{ github.actor }}", "          password: ${{ secrets.GITHUB_TOKEN }}",
    "      - uses: docker/metadata-action@v5", "        id: meta", "        with:", "          images: ghcr.io/kestrel/notes-api", "          tags: |", "            type=semver,pattern={{version}}", "            type=semver,pattern={{major}}.{{minor}}",
    "      - uses: docker/build-push-action@v6", "        with:", "          context: .", "          push: true", "          tags: ${{ steps.meta.outputs.tags }}", "          labels: ${{ steps.meta.outputs.labels }}", "          cache-from: type=gha",
    "      - run: gh release create \"$GITHUB_REF_NAME\" --generate-notes --title \"notes-api $GITHUB_REF_NAME\"", "        env:", "          GH_TOKEN: ${{ github.token }}");
  var WORLD_205 = world({ repo: { postTest: true, files: { ".github/workflows/ci.yml": wfPush({ cov: 85, gh: true }) } }, releases: ["1.4.0", "1.5.0"],
    steps: [
      { msg: "fix: return 404 JSON for unknown notes", by: "ben", at: "2026-10-27 10:12", files: { "CHANGES.md": sc("# Changes", "", "Kept by hand until we automate it.") } },
      { msg: "feat: GET /notes?q= filters notes by text", by: "ana", at: "2026-11-03 14:30", files: { "docs/search.md": sc("# Search", "", "GET /notes?q=bank returns the notes that contain \"bank\".") } },
      { msg: "docs: describe search", by: "ana", at: "2026-11-03 14:41", files: { "README.md": sc("# notes-api", "", "The Kestrel notes service (Flask). Search: GET /notes?q=TEXT.") } },
      { msg: "chore(deps): bump gunicorn to 23.0.0", by: "ben", at: "2026-11-06 09:02", files: {} }
    ] });
  LABS.push({
    id: "dev-205", n: 5, module: 2, ticket: "DEV-205", xp: 180, tool: "GitHub Actions",
    title: "Versions & releases",
    topic: "semantic versioning, conventional commits, tags, release images",
    from: MAYA,
    story: "<p>Support keeps asking \"is the search fix in yet?\", and the answer is a 40-character SHA. Kestrel uses <b>semantic versions</b> for releases. notes-api is at <b>1.5.0</b>; work out the next version from what changed since, set it in the code, and build a release pipeline: pushing a tag like <code>v1.6.0</code> publishes images tagged <code>1.6.0</code> and <code>1.6</code> and a GitHub release with notes.</p>",
    learn:
      "<h3>Semantic versioning</h3><p><code>MAJOR.MINOR.PATCH</code>: bump <b>MAJOR</b> for breaking changes, <b>MINOR</b> for new features that don't break anything, <b>PATCH</b> for fixes only. Reset the parts to the right: 1.5.3 + a feature = <b>1.6.0</b>.</p>" +
      "<h3>Conventional commits</h3><p>If commit messages start with a type, the next version can be read off the log: <code>fix:</code> → patch, <code>feat:</code> → minor, <code>feat!:</code> or <code>BREAKING CHANGE:</code> → major. <code>docs:</code>, <code>chore:</code>, <code>ci:</code>, <code>test:</code> don't change the version on their own.</p>" +
      ex("git log --oneline v1.5.0..HEAD") +
      "<p><code>A..B</code> means \"commits in B that aren't in A\": everything since the last release.</p>" +
      "<h3>Tags are releases</h3><p>Release from an <b>annotated</b> tag on main (it records who tagged and when):</p>" + ex("git tag -a v1.6.0 -m \"notes-api 1.6.0\"") + ex("git push origin v1.6.0") +
      "<h3>A workflow for tags</h3>" + code("on:\n  push:\n    tags: ['v*.*.*']") +
      "<p><code>docker/metadata-action</code> turns the tag into image tags with <code>type=semver</code>:</p>" + code("          tags: |\n            type=semver,pattern={{version}}         # 1.6.0\n            type=semver,pattern={{major}}.{{minor}} # 1.6") +
      "<p>It also adds <code>latest</code> for a semver release, and its <code>labels</code> output sets <code>org.opencontainers.image.version</code> in the image, so <code>docker inspect</code> says which version it is. Pass it to build-push-action with <code>labels: ${{ steps.meta.outputs.labels }}</code>.</p>" +
      "<h3>The GitHub release</h3><p><code>gh release create v1.6.0 --generate-notes</code> writes the notes from the commits and PRs since the previous release. In a workflow, <code>gh</code> needs <code>GH_TOKEN: ${{ github.token }}</code> and the job needs <code>contents: write</code>.</p>" +
      '<div class="callout">Keep the version in one place. Here it\'s <code>VERSION</code> in <code>app.py</code>; it must match the tag, or <code>GET /</code> reports the wrong version.</div>',
    system: WORLD_205,
    starter: "cd ~/notes-api",
    objectives: [
      { id: "log", text: "List the commits since the <code>v1.5.0</code> release.", hints: ["git log --oneline v1.5.0..HEAD"],
        check: function (r) { return ran(r, /^\s*git\s+log\b.*v1\.5\.0\.\.(HEAD|main|origin\/main)?/, function (e) { return /feat: GET \/notes\?q=/.test(all(e)); }) ? true : "git log --oneline v1.5.0..HEAD"; } },
      { id: "version", text: "From those commits, work out the next version and set <code>VERSION</code> in <code>app.py</code> on main to it.", hints: ["There's a feat: and a fix: since 1.5.0: a new feature means MINOR.", "sed -i 's/VERSION = \"1.5.0\"/VERSION = \"1.6.0\"/' app.py, commit, push"],
        check: function (r) { var a = H.fileOn(r, "main", "app.py") || "", m = /^VERSION\s*=\s*"([^"]+)"/m.exec(a); if (!m) return "app.py should still set VERSION."; if (m[1] === "1.5.0") return "VERSION on main is still 1.5.0."; return m[1] === "1.6.0" ? true : "VERSION is " + m[1] + ". There's a feat: and a fix: since 1.5.0. Which part goes up, and what happens to the parts to its right?"; } },
      { id: "wf", text: "Add <code>.github/workflows/release.yml</code>: on tags <code>v*.*.*</code>, push images tagged with the full version and <code>MAJOR.MINOR</code>, with the version label, and create a GitHub release with generated notes.", hints: ["The Learn tab has every piece: on: push: tags, metadata-action with two type=semver patterns, build-push-action with labels, gh release create in a run step.", "permissions: contents: write (for the release) and packages: write."],
        check: function (r) { var w = H.wf(r, "main", /release\.ya?ml$/); if (!w) return "Push .github/workflows/release.yml to main."; var on = w.doc.on || {}; var tg = on.push && on.push.tags; if (!tg || !/v/.test(JSON.stringify(tg))) return "release.yml should run on push of tags like v*.*.*."; var j = H.jobsOf(w), k = Object.keys(j)[0], job = j[k]; var md = H.uses(job, /^docker\/metadata-action@/); if (!md || !/type=semver/.test(String((md.with || {}).tags || ""))) return "Tag images with metadata-action type=semver patterns."; var bp = H.uses(job, /^docker\/build-push-action@/); if (!bp || !/outputs\.labels/.test(String((bp.with || {}).labels || ""))) return "Pass the labels to build-push-action: labels: ${{ steps.meta.outputs.labels }}"; return /gh\s+release\s+create/.test(stepRuns(job)) ? true : "Create the GitHub release in the workflow: gh release create ... --generate-notes"; } },
      { id: "tag", text: "Tag the release on main with an <b>annotated</b> tag and push it.", hints: ["git tag -a v1.6.0 -m \"notes-api 1.6.0\"\ngit push origin v1.6.0"],
        check: function (r) { var x = H.repo(r), s = x && x.refs["refs/tags/v1.6.0"]; if (!s) return "Push the tag v1.6.0."; var o = G.getObject(r.sys, s); if (!o || o.type !== "tag") return "v1.6.0 is a lightweight tag: delete it (git tag -d, git push origin :refs/tags/v1.6.0) and make an annotated one with -a."; return G.peel(r.sys, s) === H.tip(r) ? true : "v1.6.0 should point at main's latest commit (the one with VERSION = 1.6.0)."; } },
      { id: "images", text: "The release run is green: ghcr.io has <code>1.6.0</code>, <code>1.6</code> and <code>latest</code>, all the same image, labelled version 1.6.0.", hints: ["gh run list --workflow release.yml; docker pull ghcr.io/kestrel/notes-api:1.6 and docker inspect it."],
        check: function (r) { var t = H.tags(r); if (!t["1.6.0"] || !t["1.6"]) return "ghcr.io should have 1.6.0 and 1.6 (gh run list --workflow release.yml)."; if (t["1.6.0"] !== t["1.6"] || t.latest !== t["1.6.0"]) return "1.6.0, 1.6 and latest should all be the same digest."; var hit = CI.resolveRemote(r.sys, IMG + ":1.6.0"); return hit && (hit.img.cfg.Labels || {})["org.opencontainers.image.version"] === "1.6.0" ? true : "The image's org.opencontainers.image.version label should be 1.6.0 (labels: ${{ steps.meta.outputs.labels }})."; } },
      { id: "notes", text: "There's a GitHub release <code>v1.6.0</code> whose notes list the changes. Show it.", hints: ["gh release view v1.6.0"],
        check: function (r) { var x = H.repo(r), rel = x && (x.releases || []).filter(function (y) { return y.tag === "v1.6.0"; })[0]; if (!rel) return "Create the release v1.6.0 (the workflow's gh release create step)."; return ran(r, /^\s*gh\s+release\s+(view|list)\b/, function (e) { return /v1\.6\.0/.test(all(e)); }) ? true : "Show it: gh release view v1.6.0"; } }
    ],
    solution: sol("cd ~/notes-api", "git fetch --tags", "git log --oneline v1.5.0..HEAD", "sed -i 's/VERSION = \"1.5.0\"/VERSION = \"1.6.0\"/' app.py", "grep VERSION app.py", { nano: ".github/workflows/release.yml", text: RELEASE_WF },
      "git add -A", "git commit -m \"chore(release): 1.6.0\"", "git push", "git tag -a v1.6.0 -m \"notes-api 1.6.0\"", "git push origin v1.6.0", "gh run list -L 2", GH_LOGIN, "docker pull ghcr.io/kestrel/notes-api:1.6",
      "docker inspect -f '{{ index .Config.Labels \"org.opencontainers.image.version\" }}' ghcr.io/kestrel/notes-api:1.6", "gh release view v1.6.0"),
    debrief: "<p>One <code>git push origin v1.6.0</code> now produces a versioned image under three tags and a release page that says what changed. Support can ask \"is 1.6 deployed?\" and get an answer.</p><p>Having an image isn't the same as running it. Next: getting a new version into production without anyone noticing, and noticing fast when it's bad.</p>",
    realworld: "release-please (Google) and semantic-release automate this: they read conventional commits, open a release PR that bumps the version and changelog, and tag when it merges.",
    quiz: [
      { q: "notes-api is at 2.3.4. Since then: a <code>fix:</code> and a <code>feat:</code>. Next version?", options: ["2.3.5", "2.4.0", "2.4.4", "3.0.0"], answer: 1, why: "A feature bumps MINOR and resets PATCH to 0." },
      { q: "What does <code>git log v1.5.0..HEAD</code> show?", options: ["Commits in v1.5.0 but not HEAD", "Commits reachable from HEAD that aren't in v1.5.0", "Only tagged commits", "The diff between them"], answer: 1, why: "A..B lists what B has that A doesn't: everything since the release." },
      { q: "Why use an annotated tag (<code>-a</code>) for a release?", options: ["Lightweight tags can't be pushed", "It's an object with the tagger, date and a message (and can be signed)", "Actions only sees annotated tags", "It's faster"], answer: 1, why: "A release deserves a record of who made it and when." }
    ]
  });

  /* ================================================================== DEV-206 Deployment strategies */
  var WORLD_206 = world({ releases: ["1.5.0", "1.6.0", "1.7.0"], releaseOpts: { "1.7.0": { limitBug: true } }, fleet: { staging: "1.5.0", production: "1.5.0" },
    after: function (sys) { var E = CI.fleetEnv(sys, "notes", "staging"), dg = CI.digests["1.7.0"]; var rev = { rev: 2, ref: IMG + "@" + dg, digest: dg, version: "1.7.0", strategy: "rolling", status: "succeeded", by: "ben-okoro", t: G.clock(sys) - 3600 * 3, note: "rollout" }; E.revs.push(rev); E.current = rev; E.insts.forEach(function (i) { i.version = "1.7.0"; i.digest = dg; }); var pr = CI.imageProfile(sys, IMG + ":1.7.0"); E.profiles = E.profiles || {}; E.profiles[dg] = { errRate: pr.errRate, version: pr.version, bug: pr.bug }; } });
  LABS.push({
    id: "dev-206", n: 6, module: 2, ticket: "DEV-206", xp: 200, tool: "kdeploy",
    title: "Deployment strategies",
    topic: "rolling, blue-green, canary with automatic analysis, rollback",
    from: MAYA,
    story: "<p>notes-api runs on Kestrel's deploy platform: 2 instances in <b>staging</b>, 4 in <b>production</b>. Production is on 1.5.0; releases 1.6.0 and 1.7.0 are in ghcr.io. Ben put 1.7.0 on staging this morning and support says staging's notes page is broken. Undo that first, then take production to 1.6.0 with zero downtime, and try 1.7.0 the safe way: a canary that the platform stops by itself if it's bad.</p>",
    learn:
      "<h3>kdeploy</h3><p>Kestrel's deploy tool talks to the platform (your token is in <code>~/.kdeploy/token</code>):</p>" + ex("kdeploy status") + ex("kdeploy history staging") +
      "<h3>Rolling update</h3><p>Replace instances a few at a time: each new one must pass its health check before the next old one stops. Capacity dips by <code>--max-unavailable</code>, but the service never goes down. Rolling back is another rolling update, to the previous revision:</p>" +
      ex("kdeploy rollout staging --image ghcr.io/kestrel/notes-api:1.6.0 --strategy rolling --max-unavailable 1") + ex("kdeploy rollback staging") +
      "<h3>Blue-green</h3><p>Start a full second set (<b>green</b>) next to the live one (<b>blue</b>), test green on its own URL, then switch all traffic at once. Rolling back is switching back: instant, because blue is still running.</p>" +
      code("kdeploy rollout production --image ...:1.6.0 --strategy blue-green\ncurl https://green.notes.kestrel.io/health     # test before anyone sees it\nkdeploy promote production                       # switch traffic") +
      "<h3>Canary</h3><p>Send a small share of real traffic to the new version, watch its error rate, and increase the share step by step. If the error rate goes over a threshold, stop and send everything back:</p>" +
      ex("kdeploy rollout production --image ...:1.7.0 --strategy canary --canary-steps 10,50,100 --max-error-rate 1") +
      '<table class="t"><tr><th>Strategy</th><th>Cost</th><th>Bad release reaches</th><th>Rollback</th></tr><tr><td>Rolling</td><td>no extra servers</td><td>everyone, gradually</td><td>another rollout</td></tr><tr><td>Blue-green</td><td>double, briefly</td><td>everyone, at the switch</td><td>instant switch back</td></tr><tr><td>Canary</td><td>a little</td><td>a small share, until the analysis stops it</td><td>automatic</td></tr></table>' +
      "<p><code>kdeploy metrics ENV</code> shows requests and errors per version (any response that isn't 2xx or 3xx counts as an error), which is what the canary analysis compares.</p>",
    system: WORLD_206,
    starter: "",
    objectives: [
      { id: "look", text: "See what runs where, and staging's revision history.", hints: ["kdeploy status\nkdeploy history staging"],
        check: function (r) { return ran(r, /^\s*kdeploy\s+status\b/) && ran(r, /^\s*kdeploy\s+history\s+staging\b/) ? true : "kdeploy status, then kdeploy history staging."; } },
      { id: "rollback", text: "Staging's 1.7.0 is broken: roll staging back to the revision before it, then prove <code>GET /notes</code> works again.", hints: ["kdeploy rollback staging", "curl -s https://staging.notes.kestrel.io/notes"],
        check: function (r) { var k = idx(r, /^\s*kdeploy\s+rollback\s+staging\b/, function (e) { return e.exit === 0; }); if (k < 0 || !H.fleetEvents(r).some(function (e) { return e.env === "staging" && e.kind === "rollback" && e.version === "1.5.0"; })) return "Roll staging back to the revision before 1.7.0: kdeploy rollback staging"; return r.history.slice(k + 1).some(function (e) { return /^\s*curl\b/.test(e.cmd) && /staging\.notes\.kestrel\.io\/notes/.test(e.cmd) && /^\[/.test(out(e).trim()); }) ? true : "Check it afterwards: curl -s https://staging.notes.kestrel.io/notes"; } },
      { id: "rolling", text: "Take staging to <b>1.6.0</b> with a rolling update, one instance at a time.", hints: ["kdeploy rollout staging --image ghcr.io/kestrel/notes-api:1.6.0 --strategy rolling --max-unavailable 1"],
        check: function (r) { var E = H.env(r, "staging"); return E.current.version === "1.6.0" && E.current.strategy === "rolling" ? true : "Roll staging to ghcr.io/kestrel/notes-api:1.6.0 with --strategy rolling."; } },
      { id: "bluegreen", text: "Take production to <b>1.6.0</b> blue-green: start green, check its <code>/health</code> on the preview URL, then switch traffic.", hints: ["kdeploy rollout production --image ghcr.io/kestrel/notes-api:1.6.0 --strategy blue-green", "curl -s https://green.notes.kestrel.io/health (the rollout prints the preview URL), then kdeploy promote production"],
        check: function (r) { var E = H.env(r, "production"); if (E.current.version !== "1.6.0" || E.current.strategy !== "blue-green") return "Production should be on 1.6.0 via a blue-green rollout that you promoted."; return r.history.some(function (e) { return /^\s*curl\b/.test(e.cmd) && /(green|blue)\.notes\.kestrel\.io\/health/.test(e.cmd) && /"status"/.test(out(e)); }) ? true : "Before switching, test the new set on its preview URL: curl https://green.notes.kestrel.io/health"; } },
      { id: "canary", text: "Try <b>1.7.0</b> in production as a canary (10%, 50%, 100%) that stops above a <b>1%</b> error rate. Production must end up still on 1.6.0.", hints: ["kdeploy rollout production --image ghcr.io/kestrel/notes-api:1.7.0 --strategy canary --canary-steps 10,50,100 --max-error-rate 1"],
        check: function (r) { var ev = H.fleetEvents(r).filter(function (e) { return e.env === "production" && e.version === "1.7.0" && e.strategy === "canary"; }); if (!ev.length) return "Start a canary of 1.7.0 in production."; if (!ev.some(function (e) { return /abort/.test(e.status || ""); })) return "The canary should be stopped by its analysis (--max-error-rate 1)."; return H.env(r, "production").current.version === "1.6.0" ? true : "Production should still run 1.6.0."; } },
      { id: "why", text: "Find out from the platform's metrics what the canary's error rate was.", hints: ["kdeploy metrics production"],
        check: function (r) { return ran(r, /^\s*kdeploy\s+metrics\s+production\b/, function (e) { return /1\.7\.0/.test(all(e)); }) ? true : "kdeploy metrics production (after the canary) shows the error rate per version."; } }
    ],
    solution: sol("kdeploy status", "kdeploy history staging", "curl -s https://staging.notes.kestrel.io/notes", "kdeploy rollback staging", "curl -s https://staging.notes.kestrel.io/notes",
      "kdeploy rollout staging --image ghcr.io/kestrel/notes-api:1.6.0 --strategy rolling --max-unavailable 1", "kdeploy status staging",
      "kdeploy rollout production --image ghcr.io/kestrel/notes-api:1.6.0 --strategy blue-green", "curl -s https://green.notes.kestrel.io/health", "curl -s https://green.notes.kestrel.io/", "kdeploy promote production", "kdeploy status production",
      "kdeploy rollout production --image ghcr.io/kestrel/notes-api:1.7.0 --strategy canary --canary-steps 10,50,100 --max-error-rate 1", "kdeploy metrics production", "kdeploy status production"),
    debrief: "<p>Staging was fixed by rolling back first and asking questions later. Production moved to 1.6.0 with blue-green after you'd tested the new set yourself, and 1.7.0 never got past a slice of traffic: the canary saw the error rate jump on <code>GET /notes</code> and sent everyone back to 1.6.0 without a person in the loop.</p><p>So far a person ran every deploy. Next: let the pipeline do it, through staging, with a human approval in front of production.</p>",
    realworld: "Kubernetes Deployments do rolling updates out of the box (maxUnavailable, maxSurge); Argo Rollouts and Flagger add blue-green and canary with metric analysis, and AWS CodeDeploy does the same for EC2, ECS and Lambda.",
    quiz: [
      { q: "Which strategy lets you roll back instantly because the old version is still running?", options: ["Rolling", "Blue-green", "Recreate", "None of them"], answer: 1, why: "Blue keeps running until you're sure about green; switching back is just moving traffic." },
      { q: "A canary at 10% shows a 23% error rate with a 1% limit. What should happen?", options: ["Go to 50% to get more data", "Abort and send all traffic to the stable version", "Restart the canary instances", "Nothing until a person looks"], answer: 1, why: "That's what the analysis is for: a bad release reaches a small share, briefly." },
      { q: "Something's broken in production after a deploy. What first?", options: ["Debug it live", "Roll back, then investigate", "Deploy a fix forward straight away", "Scale up"], answer: 1, why: "Restore service first. You can find the cause on staging or in the logs afterwards." }
    ]
  });

  LABS.forEach(function (l) { T.LABS.push(l); });
  Object.assign(B, { M2: { yml: yml, wfMain: wfMain, jobsMain: jobsMain, pushRuns: pushRuns, prRuns: prRuns, lastPush: lastPush, jobsOk: jobsOk, setupPy: setupPy, stepRuns: stepRuns, badJobs: badJobs, runMsg: runMsg, tokenFile: tokenFile, ghPull: ghPull, world: world, GH_LOGIN: GH_LOGIN, LAST_RUN: LAST_RUN,
    PY_SETUP: PY_SETUP, WF_ONE_JOB: WF_ONE_JOB, WF_SPLIT: WF_SPLIT, wfPush: wfPush, WF_PUSH: WF_PUSH, GATES: GATES, WF_GATES: WF_GATES, RELEASE_WF: RELEASE_WF, PROTECTION: PROTECTION, OLD_TOKEN: OLD_TOKEN } });
})();
