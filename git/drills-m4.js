/* sudo learn — Git track Module 4 practice drills (3 per lab, +5 XP each). Loaded after labs-m4.js. */
(function () {
  "use strict";
  var S = window.ShEngine, G = window.GitCore, GL = window.GitLab, GH = window.GitHub, A = window.GitActions, SEC = window.GitSec, T = window.GIT_TRACK, M2 = T.M2, M3 = T.M3, M4 = T.M4, lines = T.lines, sol = M3.sol;
  var HOME = "/home/dev";
  function ran(r, re, fn) { return r.history.some(function (e) { return re.test(e.cmd) && (!fn || fn(e)); }); }
  function all(e) { return e.out.concat(e.err); }
  function outHas(e, re) { return all(e).some(function (l) { return re.test(l); }); }
  function gh(r, full) { return GH.find(r.sys, full); }
  function repo(r, n) { return GL.H.repo(r, n); }
  // kestrel-api, cloned; o.steps go between the first commit and the rest; o.after(sys, r) adjusts it
  function api(o) {
    o = o || {};
    return function (sys) {
      M2.world(sys);
      if (o.node) A.installNode(sys);
      var steps = [{ msg: "Initial API", by: "ben", at: "2026-09-28 10:00", files: M4.API_FILES }].concat(o.steps || [], [{ msg: "Add health check", by: "maya", at: "2026-10-05 10:00", files: { "app/health.py": "def health():\n    return {\"status\": \"ok\"}\n" } }]);
      GH.seed(sys, "kestrel/kestrel-api", { steps: steps }, { private: true });
      var r = GH.find(sys, "kestrel/kestrel-api");
      r.collab["kc-dev"] = "admin";
      sys.lab = {};
      if (o.before) o.before(sys, r);
      if (o.clone !== false) GH.cloneTo(sys, "kestrel/kestrel-api", HOME + "/kestrel-api");
      if (o.after) o.after(sys, r);
    };
  }
  function web(o) {
    o = o || {};
    return M3.webWorld({ admin: true, pkg: o.pkg, steps: o.steps, clone: o.clone, before: o.before, after: o.after });
  }
  var PW = "pg-" + "S3cr3t-" + "Kestrel-2026";
  var DRILLS = {
    "gt-128": [
      {
        id: "d1", title: "Every commit that touched it", system: api({ steps: [{ msg: "Add DB settings", by: "ben", at: "2026-10-01 10:00", files: { "config/db.yml": "password: " + PW + "\n" } }, { msg: "Point DB settings at env vars", by: "ben", at: "2026-10-02 10:00", files: { "config/db.yml": "password: ${DB_PASSWORD}\n" } }] }),
        text: "<p>In <code>~/kestrel-api</code>, list (one line each) every commit, on any branch, that touched <code>config/db.yml</code>.</p>",
        starter: "", solution: lines("cd ~/kestrel-api", "git log --all --oneline -- config/db.yml"),
        check: function (r) { return ran(r, /git\s+log\b.*--\s*config\/db\.yml/, function (e) { return e.out.length === 2 && outHas(e, /Add DB settings/) && outHas(e, /env vars/); }) ? true : "git log --all --oneline -- config/db.yml"; }
      },
      {
        id: "d2", title: "Search the text, not the files", system: api({ steps: [{ msg: "Tune connection pool", by: "ana", at: "2026-10-01 10:00", files: { "app/db.py": "POOL = 5\nDSN = \"postgres://app:" + PW + "@db/kestrel\"\n" } }, { msg: "Read the DSN from the environment", by: "ana", at: "2026-10-03 10:00", files: { "app/db.py": "import os\nPOOL = 5\nDSN = os.environ[\"DSN\"]\n" } }] }),
        text: "<p>Someone says a database password was once hard-coded in <code>~/kestrel-api</code>. Find the commits that added or removed the text <code>postgres://app:</code>.</p>",
        starter: "", solution: lines("cd ~/kestrel-api", "git log --oneline -S postgres://app:"),
        check: function (r) { return ran(r, /git\s+log\b.*(-S|-G)\s*['"]?postgres/, function (e) { return outHas(e, /Tune connection pool/) && outHas(e, /Read the DSN/) && !outHas(e, /health check/); }) ? true : "git log -S TEXT lists the commits that changed how often TEXT appears."; }
      },
      {
        id: "d3", title: "Replace, don't delete", system: api({ steps: [{ msg: "Add DB settings", by: "ben", at: "2026-10-01 10:00", files: { "config/db.yml": "host: db\npassword: " + PW + "\n" } }], clone: false, after: function (sys) { GH.cloneTo(sys, "kestrel/kestrel-api", HOME + "/kestrel-api"); S.M3.preinstall(sys, "git-filter-repo"); G.putFile(sys, HOME + "/replacements.txt", PW + "\n", 384, 1000, 1000); } }),
        text: "<p><code>~/kestrel-api</code> is a fresh clone. Replace the password listed in <code>~/replacements.txt</code> with <code>***REMOVED***</code> in every commit, keeping <code>config/db.yml</code> itself. (Local only; don't push.)</p>",
        starter: "", solution: lines("cd ~/kestrel-api", "git filter-repo --replace-text ~/replacements.txt", "git log -p --all -- config/db.yml | grep password"),
        check: function (r) { var v = repo(r, "kestrel-api"); if (!v) return "Keep ~/kestrel-api."; var hit = v.log("HEAD", true).some(function (c) { var f = G.commitFlat(r.sys, c.sha); return Object.keys(f).some(function (p) { return String(G.blobText(r.sys, f[p].sha)).indexOf(PW) >= 0; }); }); if (hit) return "git filter-repo --replace-text ~/replacements.txt"; return /\*\*\*REMOVED\*\*\*/.test(v.file("HEAD", "config/db.yml") || "") ? true : "Keep config/db.yml (replace the text, don't remove the file)."; }
      }
    ],
    "gt-129": [
      {
        id: "d1", title: "Not a repository", system: function (sys) { M2.world(sys); S.M3.preinstall(sys, "gitleaks"); G.putFile(sys, HOME + "/configs/app.env", "PORT=8080\nGITHUB_TOKEN=" + GH.newToken(sys, "kc-dev") + "\n", 436, 1000, 1000); G.putFile(sys, HOME + "/configs/nginx.conf", "server { listen 80; }\n", 436, 1000, 1000); },
        text: "<p><code>~/configs</code> is just a folder (no Git). Scan its files for secrets with gitleaks, showing the findings.</p>",
        starter: "", solution: lines("gitleaks detect --no-git -s ~/configs -v"),
        check: function (r) { return ran(r, /gitleaks\s+detect\b.*--no-git/, function (e) { return outHas(e, /RuleID:\s+github-pat/) && outHas(e, /File:\s+app\.env/); }) ? true : "gitleaks detect --no-git -s ~/configs -v"; }
      },
      {
        id: "d2", title: "Just for me", system: api({ after: function (sys) { S.M3.preinstall(sys, "gitleaks"); } }),
        text: "<p>Add a pre-commit hook to <b>your own clone</b> of <code>~/kestrel-api</code> only (not shared): it runs <code>gitleaks protect --staged</code>.</p>",
        starter: "", solution: sol("cd ~/kestrel-api", { nano: ".git/hooks/pre-commit", text: M4.HOOK }, "chmod +x .git/hooks/pre-commit"),
        check: function (r) { var n = r.node("~/kestrel-api/.git/hooks/pre-commit"); if (!n || n.type !== "f") return ".git/hooks/pre-commit doesn't exist."; if (!/gitleaks\s+protect\b[^\n]*--staged/.test(n.content)) return "It should run gitleaks protect --staged."; return n.mode & 73 ? true : "Make it executable (chmod +x)."; }
      },
      {
        id: "d3", title: "Teach it our tokens", system: function (sys) { M2.world(sys); S.M3.preinstall(sys, "gitleaks"); var t = A.deployToken(sys, "kestrel-web", "staging"); sys.lab = { t: t }; G.putFile(sys, HOME + "/deploy/notes.md", "# Deploying\n\ncurl -X POST -H \"Authorization: Bearer " + t + "\" https://deploy.kestrel.io/api/sites/kestrel-web/releases\n", 436, 1000, 1000); },
        text: "<p>gitleaks' default rules don't know Kestrel's deploy tokens (<code>kdt_</code> followed by 32 lowercase letters and digits): <code>gitleaks detect --no-git -s ~/deploy</code> finds nothing. Write <code>~/deploy/.gitleaks.toml</code> that keeps the default rules and adds one with the id <code>kestrel-deploy-token</code>, then scan again and show the finding.</p>",
        starter: "", solution: sol({ nano: "~/deploy/.gitleaks.toml", text: "[extend]\nuseDefault = true\n\n[[rules]]\nid = \"kestrel-deploy-token\"\ndescription = \"Kestrel deploy token\"\nregex = '''kdt_[a-z0-9]{32}'''\nkeywords = [\"kdt_\"]\n" }, "gitleaks detect --no-git -s ~/deploy -v"),
        check: function (r) { var t = r.read("~/deploy/.gitleaks.toml"); if (t === null) return "Create ~/deploy/.gitleaks.toml."; if (!/useDefault\s*=\s*true/.test(t)) return "Keep the default rules: [extend] useDefault = true"; return ran(r, /gitleaks\s+detect/, function (e) { return outHas(e, /RuleID:\s+kestrel-deploy-token/); }) ? true : "Scan ~/deploy again with -v: the finding should have RuleID kestrel-deploy-token."; }
      }
    ],
    "gt-130": [
      {
        id: "d1", title: "Just this one", system: api({ after: function (sys) { M4.sshKey(sys); GH.runAs(sys, HOME, ["git config --global gpg.format ssh", "git config --global user.signingkey ~/.ssh/id_ed25519.pub"]); } }),
        text: "<p>Git in <code>~/kestrel-api</code> is set up to sign with your SSH key, but doesn't sign by default. Make <b>one</b> signed commit (any change), without changing the configuration.</p>",
        starter: "", solution: lines("cd ~/kestrel-api", "echo '# signed' >> README.md", "git commit -S -am 'docs: a signed commit'"),
        check: function (r) { var v = repo(r, "kestrel-api"), co = v && v.commit("HEAD"); if (!co || !co.gpgsig) return "git commit -S signs a single commit."; return /true/.test(G.configGet(r.sys, null, 1000, "commit.gpgsign") || "") ? "Leave commit.gpgsign alone: use -S for this one commit." : true; }
      },
      {
        id: "d2", title: "Check it yourself", system: api({ after: function (sys) { M4.sshKey(sys); GH.runAs(sys, HOME + "/kestrel-api", ["git config --global gpg.format ssh", "git config --global user.signingkey ~/.ssh/id_ed25519.pub", "echo x >> README.md", "git commit -qS -am 'Signed change'"]); } }),
        text: "<p>The last commit in <code>~/kestrel-api</code> is signed, but <code>git log --show-signature</code> can't check it yet. Set up an allowed-signers file for <code>dev@kestrel.io</code> and verify the commit.</p>",
        starter: "", solution: lines("cd ~/kestrel-api", "echo 'dev@kestrel.io namespaces=\"git\"' \"$(cat ~/.ssh/id_ed25519.pub)\" > ~/.ssh/allowed_signers", "git config --global gpg.ssh.allowedSignersFile ~/.ssh/allowed_signers", "git verify-commit HEAD"),
        check: function (r) { return ran(r, /git\s+(log|show|verify-commit)\b/, function (e) { return outHas(e, /^Good "git" signature for dev@kestrel\.io/); }) ? true : "Create ~/.ssh/allowed_signers, point gpg.ssh.allowedSignersFile at it, then git verify-commit HEAD."; }
      },
      {
        id: "d3", title: "Why not Verified?", system: api({ after: function (sys, r) { var blob = M4.sshKey(sys); GH.hub(sys).users["kc-dev"].signing.push({ title: "laptop", blob: blob, type: "ssh-ed25519", added: 0 }); GH.runAs(sys, HOME + "/kestrel-api", ["git config --global gpg.format ssh", "git config --global user.signingkey ~/.ssh/id_ed25519.pub", "git config user.email dev@personal.example", "echo x >> README.md", "git commit -qS -am 'Signed, wrong email'", "git push -q"]); } }),
        text: "<p>Your newest commit on <code>kestrel/kestrel-api</code> is signed, with a key GitHub knows, yet GitHub doesn't show it as Verified. Ask GitHub's API why (the commit's verification <code>reason</code>).</p>",
        starter: "", solution: lines("cd ~/kestrel-api", "gh api repos/kestrel/kestrel-api/commits/$(git rev-parse HEAD) --jq .commit.verification.reason"),
        check: function (r) { return ran(r, /gh\s+api\b.*commits\//, function (e) { return outHas(e, /bad_email/); }) ? true : "gh api repos/kestrel/kestrel-api/commits/SHA --jq .commit.verification"; }
      }
    ],
    "gt-131": [
      {
        id: "d1", title: "What's vulnerable?", system: web({ pkg: M4.VULN_PKG, after: function (sys) { var r = GH.find(sys, "kestrel/kestrel-web"), f = G.commitFlat(sys, r.refs["refs/heads/main"]); GH.commit(sys, r.full, "main", "maya", "Pin lodash", { "package-lock.json": M4.vulnLock(M4.VULN_PKG) }); r.settings.dependabotAlerts = true; SEC.depScan(sys, r); void f; } }),
        text: "<p>Print just the package names of <code>kestrel/kestrel-web</code>'s open Dependabot alerts, one per line.</p>",
        starter: "", solution: lines("gh api 'repos/kestrel/kestrel-web/dependabot/alerts?state=open' --jq '.[].dependency.package.name'"),
        check: function (r) { return ran(r, /gh\s+api\b.*dependabot\/alerts/, function (e) { var o = e.out.map(function (l) { return l.trim(); }).sort().join(","); return o === "lodash,minimist"; }) ? true : "gh api repos/kestrel/kestrel-web/dependabot/alerts --jq '.[].dependency.package.name'"; }
      },
      {
        id: "d2", title: "A deliberate decision", system: web({ pkg: M4.VULN_PKG, after: function (sys) { var r = GH.find(sys, "kestrel/kestrel-web"); GH.commit(sys, r.full, "main", "maya", "Pin lodash", { "package-lock.json": M4.vulnLock(M4.VULN_PKG) }); r.settings.dependabotAlerts = true; SEC.depScan(sys, r); } }),
        text: "<p><code>minimist</code> in <code>kestrel/kestrel-web</code> is only used by a dev tool during builds, never with outside input, and its upgrade is blocked for now. Dismiss its Dependabot alert as <code>tolerable_risk</code>, with a comment saying why.</p>",
        starter: "", solution: lines("gh api repos/kestrel/kestrel-web/dependabot/alerts --jq '.[] | [.number, .dependency.package.name] | @tsv'", "gh api -X PATCH repos/kestrel/kestrel-web/dependabot/alerts/2 -f state=dismissed -f dismissed_reason=tolerable_risk -f dismissed_comment='Build-time dev tool only; never sees user input.'"),
        check: function (r) { var a = gh(r, "kestrel/kestrel-web").alerts.dependabot.filter(function (x) { return x.pkg === "minimist"; })[0]; if (!a || a.state !== "dismissed") return "Dismiss the minimist alert (PATCH .../dependabot/alerts/N -f state=dismissed ...)."; if (a.dismissedReason !== "tolerable_risk") return "Use dismissed_reason=tolerable_risk."; if (!a.dismissedComment) return "Add a dismissed_comment saying why."; return gh(r, "kestrel/kestrel-web").alerts.dependabot.some(function (x) { return x.pkg === "lodash" && x.state === "dismissed"; }) ? "Only minimist: leave the lodash alert open." : true; }
      },
      {
        id: "d3", title: "npm audit fix", system: web({ pkg: M4.VULN_PKG, after: function (sys) { var r = GH.find(sys, "kestrel/kestrel-web"); GH.commit(sys, r.full, "main", "maya", "Pin lodash", { "package-lock.json": M4.vulnLock(M4.VULN_PKG) }); G.removePath(sys, HOME + "/kestrel-web"); GH.cloneTo(sys, r.full, HOME + "/kestrel-web"); } }),
        text: "<p>On your laptop, in <code>~/kestrel-web</code>: see what <code>npm audit</code> reports, let npm fix what it can within <code>package.json</code>'s version ranges, and push the updated lock file.</p>",
        starter: "", solution: lines("cd ~/kestrel-web", "npm audit", "npm audit fix", "git commit -am 'fix: npm audit fix'", "git push"),
        check: function (r) { var t = M3.fileOn(r, "kestrel/kestrel-web", "main", "package-lock.json"); if (!t) return "Keep package-lock.json."; var l = JSON.parse(t).packages; return SEC.vcmp(l["node_modules/lodash"].version, "4.17.21") >= 0 && SEC.vcmp(l["node_modules/minimist"].version, "1.2.6") >= 0 ? true : "npm audit fix, then commit and push package-lock.json."; }
      }
    ],
    "gt-132": [
      {
        id: "d1", title: "Tag to commit", system: function (sys) { M2.world(sys); },
        text: "<p>Print the full commit SHA that the tag <code>v2.3.1</code> of <code>notify-hub/slack-notify</code> points to.</p>",
        starter: "", solution: lines("gh api repos/notify-hub/slack-notify/git/ref/tags/v2.3.1 --jq .object.sha"),
        check: function (r) { var sha = G.peel(r.sys, gh(r, "notify-hub/slack-notify").refs["refs/tags/v2.3.1"]); return r.history.some(function (e) { return e.out.some(function (l) { return l.trim() === sha || l.indexOf(sha + "\trefs/tags/v2.3.1") === 0; }); }) ? true : "gh api repos/notify-hub/slack-notify/git/ref/tags/v2.3.1 --jq .object.sha (or git ls-remote --tags URL)."; }
      },
      {
        id: "d2", title: "Read-only by default", system: web({ before: function (sys) { GH.find(sys, "kestrel/kestrel-web").settings.actionsPermissions = "write"; } }),
        text: "<p>Make the default <code>GITHUB_TOKEN</code> of <code>kestrel/kestrel-web</code>'s workflows read-only.</p>",
        starter: "", solution: lines("gh api -X PUT repos/kestrel/kestrel-web/actions/permissions/workflow -f default_workflow_permissions=read"),
        check: function (r) { return gh(r, "kestrel/kestrel-web").settings.actionsPermissions === "read" ? true : "gh api -X PUT repos/kestrel/kestrel-web/actions/permissions/workflow -f default_workflow_permissions=read"; }
      },
      {
        id: "d3", title: "Pull request titles too", system: web({ steps: [{ msg: "ci: greet pull requests", by: "ben", files: { ".github/workflows/hello.yml": "name: Hello\non: pull_request\npermissions:\n  contents: read\njobs:\n  hello:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo \"Thanks for: ${{ github.event.pull_request.title }}\"\n" } }] }),
        text: "<p><code>~/kestrel-web</code>'s <i>Hello</i> workflow puts the pull request title straight into a script. Fix it (keep the greeting) and push.</p>",
        starter: "", solution: sol("cd ~/kestrel-web", { nano: ".github/workflows/hello.yml", text: "name: Hello\non: pull_request\npermissions:\n  contents: read\njobs:\n  hello:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo \"Thanks for: $TITLE\"\n        env:\n          TITLE: ${{ github.event.pull_request.title }}\n" }, "git commit -am 'ci: pass the PR title through env'", "git push"),
        check: function (r) { var w = M3.wfsOn(r, "kestrel/kestrel-web", "main").filter(function (x) { return /hello\.ya?ml$/.test(x.path); })[0]; if (!w || w.errors.length) return w ? "GitHub can't read hello.yml: " + w.errors[0] : "Keep hello.yml."; if (/run:[^\n]*\$\{\{\s*github\.event/.test(w.text)) return "The run: line still contains ${{ github.event... }}."; return /TITLE:\s*\$\{\{\s*github\.event\.pull_request\.title\s*\}\}/.test(w.text) && /\$\{?TITLE/.test(w.text) ? true : "Pass the title through env: (TITLE: ${{ github.event.pull_request.title }}) and use \"$TITLE\"."; }
      }
    ],
    "gt-133": [
      {
        id: "d1", title: "How many components?", system: web(),
        text: "<p>Print how many packages GitHub's SBOM of <code>kestrel/kestrel-web</code> lists (one number).</p>",
        starter: "", solution: lines("gh api repos/kestrel/kestrel-web/dependency-graph/sbom --jq '.sbom.packages | length'"),
        check: function (r) { var n = String(SEC.depsAt(r.sys, gh(r, "kestrel/kestrel-web").refs["refs/heads/main"]).length + 1); return ran(r, /gh\s+api\b.*sbom|jq\b/, function (e) { return e.out.length === 1 && e.out[0].trim() === n; }) ? true : "gh api repos/kestrel/kestrel-web/dependency-graph/sbom --jq '.sbom.packages | length'"; }
      },
      {
        id: "d2", title: "Allowed to ask", system: web({ steps: [{ msg: "ci: deploy", by: "devp", files: { ".github/workflows/deploy.yml": "name: Deploy\non: workflow_dispatch\npermissions:\n  contents: read\njobs:\n  deploy:\n    runs-on: ubuntu-latest\n    environment: production\n    steps:\n      - uses: actions/checkout@v4\n      - run: bash scripts/oidc-login.sh > /dev/null && echo token ok\n", "scripts/oidc-login.sh": M4.OIDC_SH } }] }),
        text: "<p>The <i>Deploy</i> workflow in <code>~/kestrel-web</code> fails with <i>no OIDC token available</i>. Give the workflow exactly the permission it's missing (keep <code>contents: read</code>), and push.</p>",
        starter: "", solution: sol("cd ~/kestrel-web", { nano: ".github/workflows/deploy.yml", text: "name: Deploy\non: workflow_dispatch\npermissions:\n  contents: read\n  id-token: write\njobs:\n  deploy:\n    runs-on: ubuntu-latest\n    environment: production\n    steps:\n      - uses: actions/checkout@v4\n      - run: bash scripts/oidc-login.sh > /dev/null && echo token ok\n" }, "git commit -am 'ci: allow OIDC tokens'", "git push"),
        check: function (r) { var w = M3.wfsOn(r, "kestrel/kestrel-web", "main").filter(function (x) { return x.name === "Deploy"; })[0]; if (!w || w.errors.length) return "Keep deploy.yml valid."; var p = A.permsFor(gh(r, "kestrel/kestrel-web"), w.doc.permissions, undefined, false); if (p["id-token"] !== "write") return "Add id-token: write."; if (p.contents !== "read") return "Keep contents: read."; return Object.keys(p).filter(function (k) { return p[k] === "write"; }).join() === "id-token" ? true : "Grant only id-token: write."; }
      },
      {
        id: "d3", title: "Ask npm", system: web({ pkg: M4.VULN_PKG, after: function (sys) { var r = GH.find(sys, "kestrel/kestrel-web"); GH.commit(sys, r.full, "main", "maya", "Pin lodash", { "package-lock.json": M4.vulnLock(M4.VULN_PKG) }); G.removePath(sys, HOME + "/kestrel-web"); GH.cloneTo(sys, r.full, HOME + "/kestrel-web"); } }),
        text: "<p>Without GitHub: on your laptop, check <code>~/kestrel-web</code>'s installed dependencies against known vulnerabilities.</p>",
        starter: "", solution: lines("cd ~/kestrel-web", "npm audit"),
        check: function (r) { return ran(r, /npm\s+audit\s*$/, function (e) { return outHas(e, /^Severity: high/) && outHas(e, /^Severity: critical/); }) ? true : "npm audit (inside ~/kestrel-web)."; }
      }
    ],
    "gt-134": [
      {
        id: "d1", title: "Who's in?", system: api({ before: function (sys, r) { GH.user(sys, "jo-contractor", { name: "Jo Rivera" }); r.collab["jo-contractor"] = "admin"; r.collab["ben-okoro"] = "write"; } }),
        text: "<p>List the direct collaborators of <code>kestrel/kestrel-api</code> with their roles.</p>",
        starter: "", solution: lines("gh api repos/kestrel/kestrel-api/collaborators --jq '.[] | [.login, .role_name] | @tsv'"),
        check: function (r) { return ran(r, /gh\s+api\b.*collaborators/, function (e) { return outHas(e, /jo-contractor/) && outHas(e, /admin/); }) ? true : "gh api repos/kestrel/kestrel-api/collaborators"; }
      },
      {
        id: "d2", title: "Less than admin", system: api({ before: function (sys, r) { r.collab["ben-okoro"] = "admin"; } }),
        text: "<p>Ben only needs to push branches and merge pull requests on <code>kestrel/kestrel-api</code>, but he's an admin. Change his role to <b>write</b>.</p>",
        starter: "", solution: lines("gh api -X PUT repos/kestrel/kestrel-api/collaborators/ben-okoro -f permission=push"),
        check: function (r) { return gh(r, "kestrel/kestrel-api").collab["ben-okoro"] === "write" ? true : "gh api -X PUT repos/kestrel/kestrel-api/collaborators/ben-okoro -f permission=push"; }
      },
      {
        id: "d3", title: "An old key", system: api({ before: function (sys, r) { r.deployKeys.push({ id: 91234567, title: "old-ci", blob: "AAAAC3NzaC1lZDI1NTE5AAAAIOldCiKeyOldCiKeyOldCiKeyOldCiKeyOldCiKey1", type: "ssh-ed25519", readOnly: false, added: 0 }); r.deployKeys.push({ id: 91234999, title: "staging-server", blob: "AAAAC3NzaC1lZDI1NTE5AAAAIStagingKeyStagingKeyStagingKeyStagingKey12", type: "ssh-ed25519", readOnly: true, added: 0 }); } }),
        text: "<p>The old CI system is gone, but its <b>read-write</b> deploy key (<i>old-ci</i>) is still on <code>kestrel/kestrel-api</code>. Remove it; keep the staging server's key.</p>",
        starter: "", solution: lines("cd ~/kestrel-api", "gh repo deploy-key list", "gh repo deploy-key delete 91234567"),
        check: function (r) { var k = gh(r, "kestrel/kestrel-api").deployKeys; if (!k.some(function (x) { return x.title === "staging-server"; })) return "Keep the staging-server key."; return k.some(function (x) { return x.title === "old-ci"; }) ? "gh repo deploy-key list shows the id; gh repo deploy-key delete ID." : true; }
      }
    ],
    "gt-135": [
      {
        id: "d1", title: "Your keys", system: function (sys) { M2.world(sys); SEC.cloudKey(sys, { name: "terraform" }); SEC.cloudKey(sys, { name: "laptop" }); G.putFile(sys, HOME + "/.config/kc/credentials", "[default]\nuser = dev@kestrel.io\n", 384, 1000, 1000); S.put(sys, "/usr/local/bin/kc", "\x7fELF:kc (simulated binary)\n", 493); },
        text: "<p>List your Kestrel Cloud API keys with the <code>kc</code> CLI.</p>",
        starter: "", solution: lines("kc keys list"),
        check: function (r) { return ran(r, /kc\s+keys\s+(list|ls)/, function (e) { return outHas(e, /terraform/) && outHas(e, /laptop/); }) ? true : "kc keys list"; }
      },
      {
        id: "d2", title: "Only a test", system: api({ steps: [{ msg: "Add an example config", by: "ben", at: "2026-10-01 10:00", files: { "docs/example.env": "# Example only: this key was revoked long ago\nGITHUB_TOKEN=" + "gh" + "p_" + "Ex4mpleT0kenEx4mpleT0kenEx4mpleT0ken" + "\n" } }], after: function (sys, r) { r.settings.secretScanning = true; SEC.fullScan(sys, r); } }),
        text: "<p>Secret scanning flagged a token in <code>kestrel/kestrel-api</code>'s docs. It's a documentation example that never worked. Resolve the alert with the reason that fits.</p>",
        starter: "", solution: lines("gh api repos/kestrel/kestrel-api/secret-scanning/alerts", "gh api -X PATCH repos/kestrel/kestrel-api/secret-scanning/alerts/1 -f state=resolved -f resolution=false_positive -f resolution_comment='Documentation example; never a real token.'"),
        check: function (r) { var a = gh(r, "kestrel/kestrel-api").alerts.secret[0]; if (!a || a.state !== "resolved") return "Resolve alert 1 (PATCH .../secret-scanning/alerts/1 -f state=resolved -f resolution=...)."; return a.resolution === "false_positive" || a.resolution === "used_in_tests" ? true : "It was never a real token: false_positive is the honest resolution."; }
      },
      {
        id: "d3", title: "Where exactly?", system: api({ steps: [{ msg: "Add deploy notes", by: "ana", at: "2026-10-01 10:00", files: { "ops/notes/deploy.md": "Use this token: " + "gh" + "p_" + "N0tesT0kenN0tesT0kenN0tesT0kenN0tes1" + "\n" } }], after: function (sys, r) { r.settings.secretScanning = true; SEC.fullScan(sys, r); } }),
        text: "<p>Print only the file path where <code>kestrel/kestrel-api</code>'s secret scanning alert 1 was found.</p>",
        starter: "", solution: lines("gh api repos/kestrel/kestrel-api/secret-scanning/alerts/1/locations --jq '.[].details.path'"),
        check: function (r) { return ran(r, /gh\s+api\b.*locations/, function (e) { return e.out.length === 1 && e.out[0].trim() === "ops/notes/deploy.md"; }) ? true : "gh api repos/kestrel/kestrel-api/secret-scanning/alerts/1/locations --jq '.[].details.path'"; }
      }
    ],
    "gt-136": [
      {
        id: "d1", title: "Signed or nothing", system: api({ before: function (sys, r) { r.protect.main = { pr: { count: 1, codeowners: false, dismissStale: false }, checks: null, enforceAdmins: true, linear: false, forcePush: false, deletions: false, signatures: false }; } }),
        text: "<p><code>kestrel/kestrel-api</code>'s <code>main</code> is protected. Add the rule that every commit must have a verified signature.</p>",
        starter: "", solution: lines("gh api -X POST repos/kestrel/kestrel-api/branches/main/protection/required_signatures"),
        check: function (r) { return gh(r, "kestrel/kestrel-api").protect.main.signatures ? true : "gh api -X POST repos/kestrel/kestrel-api/branches/main/protection/required_signatures"; }
      },
      {
        id: "d2", title: "Block at the door", system: api(),
        text: "<p>Turn on secret scanning and push protection for <code>kestrel/kestrel-api</code>.</p>",
        starter: "", solution: lines("gh repo edit kestrel/kestrel-api --enable-secret-scanning --enable-secret-scanning-push-protection"),
        check: function (r) { var s = gh(r, "kestrel/kestrel-api").settings; return s.secretScanning && s.pushProtection ? true : "gh repo edit --enable-secret-scanning --enable-secret-scanning-push-protection"; }
      },
      {
        id: "d3", title: "Blocked push", system: api({ after: function (sys, r) { r.settings.secretScanning = true; r.settings.pushProtection = true; GH.runAs(sys, HOME + "/kestrel-api", ["echo 'token=" + "gh" + "p_" + "Bl0ckedT0kenBl0ckedT0kenBl0ckedT0ken" + "' > ops.txt", "git add ops.txt", "git commit -qm 'Add ops notes'", "echo '# ops' > README.md", "git commit -qam 'Retitle README'"]); } }),
        text: "<p>Your push of <code>~/kestrel-api</code> is blocked by push protection: a token sneaked into an earlier commit (<i>Add ops notes</i>). Remove the file from that commit (keep the README change), and push.</p>",
        starter: "", solution: lines("cd ~/kestrel-api", "git push", "GIT_SEQUENCE_EDITOR=\"sed -i 's/^pick \\(.*\\) Add ops notes/drop \\1 Add ops notes/'\" git rebase -i HEAD~2", "git push"),
        check: function (r) { var x = gh(r, "kestrel/kestrel-api"), t = x.refs["refs/heads/main"], f = G.commitFlat(r.sys, t); if (M4.historyHas(r, "kestrel/kestrel-api", "Bl0ckedT0ken")) return "The token must not reach GitHub."; if (f["ops.txt"]) return "Drop ops.txt from your commits."; return /^# ops/.test(f["README.md"] ? G.blobText(r.sys, f["README.md"].sha) : "") ? true : "Keep the README change, and push."; }
      }
    ]
  };
  T.LABS.forEach(function (l) { if (DRILLS[l.id]) l.drills = DRILLS[l.id]; });
})();
