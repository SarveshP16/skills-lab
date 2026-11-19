/* sudo learn — DevOps Module 2 lab world: the notes service on the simulated GitHub (kestrel/notes-api), cloned
   on the laptop, the CI tools on the laptop (cosign, syft, kdeploy, jenkins-cli, bamboo), images of past
   releases in ghcr.io, and the notes service running on Kestrel's deploy platform. Check helpers for runs,
   jobs, logs, workflow files, registry tags, signatures and the fleet are in CI.H. */
(function (root) {
  "use strict";
  var S = root.ShEngine, M2 = S.M2, Dk = root.Dk, GH = root.GitHub, A = root.GitActions, G = root.GitCore, CI = root.CI, DL = root.DevLab;
  var HOME = "/home/dev", REPO = "kestrel/notes-api", IMG = "ghcr.io/kestrel/notes-api";
  function keys(o) { return o ? Object.keys(o) : []; }
  function sc() { return Array.prototype.slice.call(arguments).join("\n") + "\n"; }

  /* ================================================================== the notes service's source */
  function appPy(o) {
    o = o || {};
    return sc(
      "# Kestrel notes API: a tiny note store for the support team",
      "import os",
      o.extraImport ? o.extraImport : null,
      "",
      "from flask import Flask, jsonify, request",
      "",
      "VERSION = \"" + (o.version || "1.5.0") + "\"",
      "NOTES_DIR = os.environ.get(\"NOTES_DIR\", \"/data\")",
      "",
      "app = Flask(__name__)",
      "",
      "",
      "@app.get(\"/\")",
      "def index():",
      "    return jsonify(service=\"notes\", version=VERSION)",
      "",
      "",
      "@app.get(\"/health\")",
      "def health():",
      "    return jsonify(status=\"" + (o.health || "ok") + "\")",
      "",
      "",
      "@app.get(\"/notes\")",
      "def list_notes():",
      o.limitBug ? "    limit = int(request.args[\"limit\"])" : null,
      "    if not os.path.isdir(NOTES_DIR):",
      "        return jsonify([])",
      "    names = sorted(os.listdir(NOTES_DIR), key=lambda n: int(n.split(\".\")[0]))",
      "    notes = [{\"id\": int(n.split(\".\")[0]), \"text\": open(os.path.join(NOTES_DIR, n)).read().strip()} for n in names]",
      o.limitBug ? "    return jsonify(notes[:limit])" : "    return jsonify(notes)",
      "",
      "",
      "@app.post(\"/notes\")",
      "def add_note():",
      "    os.makedirs(NOTES_DIR, exist_ok=True)",
      "    note_id = len(os.listdir(NOTES_DIR)) + 1",
      "    with open(os.path.join(NOTES_DIR, f\"{note_id}.txt\"), \"w\") as f:",
      "        f.write(request.get_data(as_text=True))",
      "    return jsonify(id=note_id), 201",
      o.extraRoute ? "\n\n" + o.extraRoute.replace(/\n$/, "") : null,
      "",
      "",
      "if __name__ == \"__main__\":",
      "    app.run(host=\"0.0.0.0\", port=int(os.environ.get(\"PORT\", \"8000\"))" + (o.debug ? ", debug=True" : "") + ")"
    ).replace(/^null\n/gm, "");
  }
  var TESTS = sc(
    "from app import app",
    "",
    "client = app.test_client()",
    "",
    "",
    "def test_health():",
    "    r = client.get(\"/health\")",
    "    assert r.status_code == 200",
    "    assert r.json == {\"status\": \"ok\"}",
    "",
    "",
    "def test_index_names_the_service():",
    "    assert client.get(\"/\").json[\"service\"] == \"notes\"",
    "",
    "",
    "def test_notes_start_empty():",
    "    r = client.get(\"/notes\")",
    "    assert r.status_code == 200");
  var TEST_POST = sc("", "", "def test_add_note():", "    r = client.post(\"/notes\", data=\"Call the bank\")", "    assert r.status_code == 201", "    assert r.json[\"id\"] == 1", "    assert client.get(\"/notes\").json[0][\"text\"] == \"Call the bank\"");
  var DOCKERFILE = sc("FROM python:3.12-slim", "WORKDIR /app", "COPY requirements.txt .", "RUN pip install --no-cache-dir -r requirements.txt", "COPY app.py .", "RUN useradd --uid 10001 --no-create-home --shell /usr/sbin/nologin app", "USER 10001", "EXPOSE 8000", "HEALTHCHECK --interval=30s CMD python -c \"import urllib.request; urllib.request.urlopen('http://localhost:8000/health')\"", "CMD [\"gunicorn\", \"-b\", \"0.0.0.0:8000\", \"app:app\"]");
  function repoFiles(o) {
    o = o || {};
    var f = {
      "README.md": sc("# notes-api", "", "The Kestrel notes service (Flask).", "", "    pip install -r requirements.txt -r requirements-dev.txt", "    pytest            # tests", "    ruff check .      # lint", "    docker build -t notes-api .", "", "Images: ghcr.io/kestrel/notes-api. Deploys: Kestrel's platform (kdeploy)."),
      "app.py": appPy(o.app),
      "tests/test_app.py": TESTS + (o.postTest ? TEST_POST : ""),
      "pytest.ini": sc("[pytest]", "pythonpath = .", "testpaths = tests"),
      "requirements.txt": o.req || sc("flask==3.1.1", "gunicorn==23.0.0"),
      "requirements-dev.txt": sc("pytest==8.3.3", "pytest-cov==6.0.0", "ruff==0.7.4"),
      "Dockerfile": o.dockerfile || DOCKERFILE,
      ".dockerignore": sc(".git", ".github", "tests", "__pycache__", "*.md"),
      ".gitignore": sc("__pycache__/", ".pytest_cache/", ".coverage", "coverage.xml", "reports/")
    };
    keys(o.files || {}).forEach(function (k) { if (o.files[k] === null) delete f[k]; else f[k] = o.files[k]; });
    return f;
  }
  CI.notes = { appPy: appPy, TESTS: TESTS, TEST_POST: TEST_POST, DOCKERFILE: DOCKERFILE, repoFiles: repoFiles, REPO: REPO, IMG: IMG };

  /* ================================================================== images of the service (past releases, lab setups) */
  function siteFor(pkgs) {
    var f = {}, sp = "/usr/local/lib/python3.12/site-packages";
    pkgs.forEach(function (p) { var P = Dk.PIP[p[0]]; f[sp + "/" + (P ? P.mod : p[0])] = Dk.Dd(); f[sp + "/" + (P ? P.mod : p[0]) + "/__init__.py"] = Dk.F("# " + p[0] + "\n", 420, 0, 0, P && P.versions[p[1]] ? P.versions[p[1]].size : 2e5); f[sp + "/" + (P ? P.name : p[0]) + "-" + p[1] + ".dist-info"] = Dk.Dd(); f[sp + "/" + (P ? P.name : p[0]) + "-" + p[1] + ".dist-info/METADATA"] = Dk.F("Metadata-Version: 2.1\nName: " + (P ? P.name : p[0]) + "\nVersion: " + p[1] + "\n"); });
    f["/usr/local/bin/gunicorn"] = Dk.bin("dkgunicorn");
    return f;
  }
  var BASE_PKGS = [["flask", "3.1.1"], ["werkzeug", "3.1.3"], ["jinja2", "3.1.6"], ["markupsafe", "3.0.2"], ["itsdangerous", "2.2.0"], ["click", "8.1.8"], ["blinker", "1.9.0"], ["gunicorn", "23.0.0"], ["packaging", "24.2"]];
  CI.notesImage = function (sys, version, o) {
    o = o || {};
    var src = o.app || appPy({ version: version, limitBug: o.limitBug });
    var im = DL.setup.image(sys, { from: "python:3.12-slim", key: "notes-" + version + (o.key || ""), created: o.created != null ? o.created : -86400 * (o.daysAgo || 10), layers: [
      { by: "WORKDIR /app", files: { "/app": Dk.Dd() }, size: 0 },
      { by: "RUN /bin/sh -c pip install --no-cache-dir -r requirements.txt # buildkit", files: siteFor(o.pkgs || BASE_PKGS) },
      { by: "COPY app.py . # buildkit", files: { "/app/app.py": Dk.F(src) } },
      { by: "RUN /bin/sh -c useradd --uid 10001 --no-create-home --shell /usr/sbin/nologin app # buildkit", files: { "/etc/passwd": Dk.F("root:x:0:0:root:/root:/bin/bash\napp:x:10001:10001::/home/app:/usr/sbin/nologin\n") } }
    ], cfg: { WorkingDir: "/app", User: "10001", ExposedPorts: { "8000/tcp": {} }, Cmd: ["gunicorn", "-b", "0.0.0.0:8000", "app:app"], Labels: { "org.opencontainers.image.version": version, "org.opencontainers.image.source": "https://github.com/" + REPO } } });
    return im;
  };
  // Publish release images to ghcr.io: versions = ["1.4.0", "1.5.0"]; returns {version: digest}
  CI.publishReleases = function (sys, versions, o) {
    var dg = {};
    versions.forEach(function (v, i) { var im = CI.notesImage(sys, v, Object.assign({ daysAgo: 30 - i * 7 }, (o || {})[v] || {})); dg[v] = DL.setup.publish(sys, IMG + ":" + v, im); });
    return dg;
  };
  // Sign an image in the registry as if a given workflow had signed it keylessly
  CI.signAs = function (sys, ref, workflowRef) {
    var hit = CI.resolveRemote(sys, ref), reg = CI.regOf(sys, "ghcr.io");
    reg.sigs = reg.sigs || {}; (reg.sigs[hit.digest] = reg.sigs[hit.digest] || []).push({ keyless: true, identity: "https://github.com/" + workflowRef, issuer: "https://token.actions.githubusercontent.com", t: 0, ref: hit.p ? Dk.repoName(hit.p) : IMG });
  };

  /* ================================================================== the world */
  CI.tools = function (sys) { ["cosign", "syft", "kdeploy", "trivy", "gitleaks"].forEach(function (b) { CI.putBin(sys, "/usr/local/bin/" + b, b); }); CI.systemPython(sys); };
  // o: {files (repo files options), steps (extra history), admin, clone, fleet: {staging: ver, production: ver}, releases: [...], before, after}
  CI.world = function (o) {
    o = o || {};
    return function (sys) {
      GH.people(sys);
      var tok = GH.newToken(sys, "kc-dev", { scopes: ["repo", "read:org", "workflow", "gist", "read:packages"], note: "gh" });
      GH.login(sys, "kc-dev", tok, { setupGit: true });
      CI.tools(sys);
      var steps = [{ msg: "notes-api 1.5.0", by: "maya", at: "2026-10-20 10:00", files: repoFiles(o.repo) }];
      if (o.tag !== false) steps.push({ tag: "v1.5.0", msg: "notes-api 1.5.0", by: "maya", at: "2026-10-20 10:05" });
      steps = steps.concat(o.steps || []);
      GH.seed(sys, REPO, { steps: steps }, { description: "The Kestrel notes service" });
      var r = GH.find(sys, REPO);
      if (o.admin !== false) r.collab["kc-dev"] = "admin";
      if (o.before) o.before(sys, r);
      if (o.releases) CI.digests = CI.publishReleases(sys, o.releases, o.releaseOpts);
      if (o.fleet) {
        var envs = {}; keys(o.fleet).forEach(function (e) { envs[e] = IMG + ":" + o.fleet[e]; });
        CI.fleetSetup(sys, "notes", envs);
        if (o.opsToken !== false) { S.mkdirs(sys, HOME + "/.kdeploy", 448, 1000, 1000); S.put(sys, HOME + "/.kdeploy/token", CI.fleetToken(sys, keys(o.fleet), "ops") + "\n", 384, 1000, 1000); }
      }
      if (o.clone !== false) GH.cloneTo(sys, REPO, HOME + "/notes-api");
      if (o.after) o.after(sys, r);
    };
  };

  /* ================================================================== check helpers */
  var H = CI.H = {
    repo: function (r) { return GH.find(r.sys, REPO); },
    runs: function (r, f) { var x = GH.find(r.sys, REPO); return x ? x.runs.filter(f || function () { return true; }).sort(function (a, b) { return b.id - a.id; }) : []; },
    job: function (run, key) { return run ? run.jobs.filter(function (j) { return j.key === key; })[0] || null : null; },
    jobs: function (run) { return run ? run.jobs : []; },
    log: function (j) { return j ? j.steps.map(function (s) { return s.log.map(function (l) { return l.text; }).join("\n"); }).join("\n") : ""; },
    runLog: function (run) { return run ? run.jobs.map(function (j) { return H.log(j); }).join("\n") : ""; },
    ok: function (j) { return !!j && j.status === "completed" && j.conclusion === "success"; },
    // the parsed workflows on a branch or tag
    wfs: function (r, ref) { var x = GH.find(r.sys, REPO); if (!x) return []; var s = x.refs["refs/heads/" + ref] || x.refs["refs/tags/" + ref]; return s ? A.workflowsAt(r.sys, G.peel(r.sys, s)) : []; },
    wf: function (r, ref, re) { return H.wfs(r, ref).filter(function (w) { return re.test(w.path) || re.test(w.name || ""); })[0] || null; },
    jobsOf: function (w) { return w && w.doc && w.doc.jobs && typeof w.doc.jobs === "object" ? w.doc.jobs : {}; },
    steps: function (job) { return job && Array.isArray(job.steps) ? job.steps : []; },
    uses: function (job, re) { return H.steps(job).filter(function (s) { return s && s.uses && re.test(String(s.uses)); })[0] || null; },
    runs_: function (job, re) { return H.steps(job).some(function (s) { return s && s.run !== undefined && re.test(String(s.run)); }); },
    needs: function (job) { return A.list(job && job.needs); },
    fileOn: function (r, branch, p) { var x = GH.find(r.sys, REPO); var s = x && x.refs["refs/heads/" + branch]; if (!s) return null; var f = G.commitFlat(r.sys, s)[p]; return f ? G.blobText(r.sys, f.sha) : null; },
    tip: function (r, branch) { var x = GH.find(r.sys, REPO); return x ? x.refs["refs/heads/" + (branch || "main")] || null : null; },
    tags: function (r, image) { var p = Dk.parseRef(image || IMG + ":x"), reg = CI.regOf(r.sys, p.registry), rp = reg && reg.repos[p.repo]; return rp ? rp.tags : {}; },
    digestOf: function (r, ref) { var hit = CI.resolveRemote(r.sys, ref); return hit ? hit.digest : null; },
    sigs: function (r, digest) { var reg = CI.regOf(r.sys, "ghcr.io"); return ((reg.sigs || {})[digest]) || []; },
    atts: function (r, digest) { var reg = CI.regOf(r.sys, "ghcr.io"); return ((reg.atts || {})[digest]) || []; },
    env: function (r, name) { return CI.fleetEnv(r.sys, "notes", name); },
    fleetEvents: function (r) { return (CI.fleet(r.sys).events || []); },
    perm: function (w, job) { var p = job && job.permissions !== undefined ? job.permissions : w && w.doc ? w.doc.permissions : undefined; return p; },
    ghEnv: function (r, name) { var x = GH.find(r.sys, REPO); return x && x.envs ? x.envs[name] || null : null; },
    out: function (e) { return e.out.join("\n"); },
    all: function (e) { return e.lines.map(function (l) { return l.text; }).join("\n"); },
    ran: function (r, re, fn) { return r.history.some(function (e) { return re.test(e.cmd) && (!fn || fn(e)); }); },
    idx: function (r, re, fn) { var k = -1; r.history.forEach(function (e, i) { if (re.test(e.cmd) && (!fn || fn(e))) k = i; }); return k; }
  };
  CI.HOME = HOME; CI.REPO = REPO; CI.IMG = IMG;

  /* ================================================================== explanations for Module 2's errors */
  var SL = root.ShLab;
  if (SL && SL.EXPLAIN) [
    [/externally-managed-environment/, "Ubuntu's Python belongs to apt (PEP 668). Make a virtual environment for the project: python3 -m venv .venv && . .venv/bin/activate, then pip install."],
    [/installation not allowed to Write organization package/, "The workflow's GITHUB_TOKEN can't push packages. Give the job that pushes permissions: packages: write (and contents: read)."],
    [/ghcr\.io.*(unauthorized|denied)|denied: denied/, "ghcr.io didn't accept the credentials. Log in with a GitHub token that has read:packages (pull) or write:packages (push): gh auth token | docker login ghcr.io -u USER --password-stdin"],
    [/Required status check .* (failed|is expected|is pending)/, "Branch protection requires that check to pass on the PR's latest commit. Fix the failure (gh pr checks, gh run view --log-failed) and push again."],
    [/policy: .* requires an image signed|admission denied/, "Production only runs images signed by the trusted CI identity. Deploy an image the pipeline built and signed (sha-<commit>), not one built elsewhere."],
    [/forbidden: this token can only deploy to/, "Each kdeploy token is limited to some environments. Use the token for that environment (or let the pipeline deploy with its environment secret)."],
    [/no matching signatures|none of the expected identities matched/, "There's a signature, but not from the identity you said you trust: compare the subject cosign printed with --certificate-identity(-regexp). Or the image isn't signed at all."],
    [/anonymous is missing the Overall\/Read permission|Invalid username or API token/, "jenkins-cli isn't authenticated. Its token is in ~/.jenkins-cli (or set JENKINS_USER_ID and JENKINS_API_TOKEN)."],
    [/^WorkflowScript: \d+:/, "Jenkins couldn't parse the Jenkinsfile: the message says which line. Check it with jenkins-cli declarative-linter < Jenkinsfile before pushing."],
    [/No agent can (build this job|run this deployment)/, "No Bamboo agent has every capability the job requires. bamboo agents lists them: fix the requirement's spelling or pick a capability an agent has."],
    [/Failing task since return code/, "A Bamboo script task exited non-zero. The lines above it in the build log are the script's own output."],
    [/Waiting for review: .* needs approval/, "That job's environment has required reviewers. Approve it: gh api repos/OWNER/REPO/environments/ENV --jq .id, then POST .../actions/runs/RUN_ID/pending_deployments with that id and state=approved."]
  ].reverse().forEach(function (e) { SL.EXPLAIN.unshift(e); });
})(typeof window !== "undefined" ? window : globalThis);
