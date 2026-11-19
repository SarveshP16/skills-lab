/* sudo learn — DevOps Module 2: a simulated Atlassian Bamboo (bamboo.kestrel.io) with repository-stored
   Bamboo YAML Specs. Every push to kestrel/notes-api is scanned for bamboo-specs/bamboo.yml: a plan document
   (stages, jobs, tasks, requirements, artifacts, variables, plan branches) and a deployment document
   (release naming, environments with triggers, tasks and permissions). Jobs run on build agents chosen by
   their requirements; script tasks really run there (like Bamboo, *without* `set -e` unless you add it).
   Logs use Bamboo's build-log format, secrets are masked, and BAMBOO-SECRET values are decrypted at run time.
   `bamboo` is Kestrel's small wrapper around Bamboo's REST API (Bamboo has no official CLI). */
(function (root) {
  "use strict";
  var S = root.ShEngine, M2 = S.M2, CMDS = S.CMDS, U = S.util, Dk = root.Dk, GH = root.GitHub, G = root.GitCore, CI = root.CI, Y = root.DevYaml;
  var out = U.out, errl = U.errl;
  function keys(o) { return o ? Object.keys(o) : []; }
  function now(sys) { return G.clock(CI.homeSys(sys)); }
  var URL = "https://bamboo.kestrel.io", VERSION = "10.2.1", SPECS = "bamboo-specs/bamboo.yml";
  var MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  function stamp(t) { var d = new Date(t * 1000); function p(n) { return (n < 10 ? "0" : "") + n; } return p(d.getUTCDate()) + "-" + MON[d.getUTCMonth()] + "-" + d.getUTCFullYear() + " " + p(d.getUTCHours()) + ":" + p(d.getUTCMinutes()) + ":" + p(d.getUTCSeconds()); }
  function list(x) { return x == null ? [] : Array.isArray(x) ? x : [x]; }
  function one(o) { if (o && typeof o === "object" && !Array.isArray(o)) { var k = keys(o); if (k.length === 1) return { k: k[0], v: o[k[0]] }; } return { k: typeof o === "string" ? o : null, v: null }; }

  /* ================================================================== secrets */
  var PREFIX = "BAMBOO-SECRET-V1:";
  function encrypt(B, value) { var id = M2.hashChars("bsec" + value + keys(B.secrets).length, 40, "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"); B.secrets[id] = value; return PREFIX + id + "=="; }
  function decrypt(B, v) { var m = new RegExp("^" + PREFIX.replace(/-/g, "\\-") + "([A-Za-z0-9+/]+)=*$").exec(String(v)); return m ? (B.secrets[m[1]] != null ? { ok: true, v: B.secrets[m[1]] } : { ok: false }) : null; }
  var MASK_NAMES = /password|secret|passphrase|sshkey/i;

  /* ================================================================== state */
  function bamboo(sys) { var h = CI.hubOf(sys); if (!h.bamboo) h.bamboo = { plans: {}, deploys: {}, specs: [], agents: [], users: {}, secrets: {}, repo: null, n: 0 }; return h.bamboo; }
  CI.bamboo = bamboo;
  CI.bambooSetup = function (sys, o) {
    o = o || {};
    var B = bamboo(sys);
    B.repo = o.repo || CI.REPO;
    B.project = o.project || { key: "NOTES", name: "Kestrel Notes" };
    B.agents = [
      { name: "linux-1", caps: { "system.git.executable": "/usr/bin/git", "python3": "/usr/bin/python3" } },
      { name: "docker-1", caps: { "system.git.executable": "/usr/bin/git", "python3": "/usr/bin/python3", "system.docker.executable": "/usr/bin/docker" }, docker: true },
      { name: "deploy-1", caps: { "system.git.executable": "/usr/bin/git", "kdeploy": "/usr/local/bin/kdeploy", "deploy.production": "true" } }
    ];
    B.users["kc-dev"] = { token: "BBT" + M2.hashChars("bamboo-pat-kc-dev", 41, "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"), groups: ["developers", "release-managers"] };
    B.users["sam-okafor"] = { groups: ["developers"] };
    if (o.cli !== false) {
      CI.putBin(sys, "/usr/local/bin/bamboo", "bamboocli");
      S.put(sys, "/home/dev/.bamboo-cli", "# read by Kestrel's bamboo wrapper (curl + Bamboo REST API)\nBAMBOO_URL=" + URL + "\nBAMBOO_TOKEN=" + B.users["kc-dev"].token + "\n", 384, 1000, 1000);
    }
    if (!B.hooked) {
      B.hooked = true;
      GH.on(sys, "push", function (s2, d) {
        var bb = bamboo(s2);
        if (!d.after || d.repo.full !== bb.repo || !/^refs\/heads\//.test(d.ref)) return;
        onPush(s2, d.ref.slice(11), d.after);
      });
      GH.on(sys, "pr.opened", function (s2, d) {
        var bb = bamboo(s2); if (d.repo.full !== bb.repo) return;
        keys(bb.plans).forEach(function (k) { var P = bb.plans[k]; if (P.branchMode === "for-pull-request" && !P.branches[d.pr.head]) { var sha = d.repo.refs["refs/heads/" + d.pr.head]; if (sha) { branchOf(P, d.pr.head); runPlan(s2, P, d.pr.head, sha, "Pull request #" + d.pr.n + " opened"); } } });
      });
    }
    return B;
  };
  function branchOf(P, br) { if (!P.branches[br]) { var n = keys(P.branches).length; P.branches[br] = { name: br, key: br === P.defaultBranch ? P.key : P.key + n, results: [], next: 1 }; } return P.branches[br]; }

  /* ================================================================== Specs */
  function slugKey(name) { var w = String(name).toUpperCase().replace(/[^A-Z0-9 ]/g, " ").trim().split(/\s+/); var k = w.length > 1 ? w.map(function (x) { return x.charAt(0); }).join("") : w[0].slice(0, 4); return k || "JOB"; }
  // Parse bamboo.yml into {plan, deployment, errors}
  function parseSpecs(text) {
    var docs = String(text).split(/^---[ \t]*$/m).filter(function (d) { return /\S/.test(d.replace(/^\s*#.*$/mg, "")); }), res = { plan: null, deployments: [], errors: [] };
    if (!docs.length) { res.errors.push("Bamboo YAML Specs: no documents found in " + SPECS); return res; }
    docs.forEach(function (doc, di) {
      var y = Y.tryParse(doc);
      if (y.error) { res.errors.push("Document " + (di + 1) + ": " + y.error); return; }
      var v = y.value;
      if (!v || typeof v !== "object") { res.errors.push("Document " + (di + 1) + ": expected a mapping"); return; }
      if (v.version !== 2) { res.errors.push("Document " + (di + 1) + ": Unsupported or missing version. Bamboo YAML Specs need 'version: 2' at the top of each document"); return; }
      if (v.plan) res.plan = planOf(v, res.errors, di + 1);
      else if (v.deployment) res.deployments.push(deployOf(v, res.errors, di + 1));
      else res.errors.push("Document " + (di + 1) + ": expected a 'plan' or 'deployment' document");
    });
    return res;
  }
  CI.parseBambooSpecs = parseSpecs;
  var TASKS = ["checkout", "script", "clean", "test-parser", "artifact-download", "inject-variables", "any-task", "command", "maven", "docker", "ssh", "scp"];
  function tasksOf(lst, errors, where) {
    var outL = [];
    list(lst).forEach(function (t) {
      var o = one(t);
      if (!o.k) { errors.push(where + ": can't read task " + JSON.stringify(t)); return; }
      if (TASKS.indexOf(o.k) < 0) { errors.push(where + ": unknown task type '" + o.k + "'. Known types: checkout, script, clean, test-parser, artifact-download, inject-variables"); return; }
      var v = o.v, task = { type: o.k };
      if (o.k === "script") {
        if (typeof v === "string") task.lines = [v];
        else if (Array.isArray(v)) task.lines = v.map(String);
        else if (v && typeof v === "object") { task.lines = list(v.scripts).map(String); task.description = v.description; task.workdir = v["working-dir"]; task.env = v.environment; }
        else { errors.push(where + ": a script task needs scripts"); return; }
      } else if (o.k === "checkout") { task.force = !!(v && v["force-clean-build"]); task.path = v && v.path; }
      else if (o.k === "test-parser") { task.kind = v && v.type || (typeof v === "string" ? v : "junit"); task.pattern = v && v["test-results"] ? list(v["test-results"]) : ["**/test-reports/*.xml"]; }
      else if (o.k === "artifact-download") { task.dest = v && v.destination || "."; task.names = v && v.artifacts ? list(v.artifacts).map(function (a) { return a && a.name ? a.name : String(a); }) : null; }
      else if (o.k === "inject-variables") { task.file = v && v.file; task.ns = v && v.namespace || "inject"; task.scope = v && v.scope || "LOCAL"; if (!task.file) { errors.push(where + ": inject-variables needs a file"); return; } }
      outL.push(task);
    });
    return outL;
  }
  function reqsOf(lst) { return list(lst).map(function (r) { var o = one(r); return typeof r === "string" ? { key: r } : { key: o.k, value: o.v == null ? null : String(o.v) }; }); }
  function varsOf(v) { var o = {}; keys(v || {}).forEach(function (k) { o[k] = v[k] == null ? "" : String(v[k]); }); return o; }
  function planOf(v, errors, dn) {
    var w = "Plan", pl = v.plan || {};
    if (!pl["project-key"] || !pl.key || !pl.name) errors.push("Document " + dn + ": plan needs project-key, key and name");
    var P = { projectKey: pl["project-key"], key: (pl["project-key"] || "X") + "-" + pl.key, short: pl.key, name: pl.name, stages: [], jobs: {}, vars: varsOf(v.variables), triggers: v.triggers, branchMode: v.branches && v.branches.create || "manually", errors: [] };
    if (!Array.isArray(v.stages) || !v.stages.length) errors.push("Document " + dn + ": plan " + P.key + " needs a 'stages' list");
    list(v.stages).forEach(function (st) {
      var o = one(st); if (!o.k) { errors.push("Document " + dn + ": can't read stage " + JSON.stringify(st)); return; }
      var jobs = o.v && o.v.jobs ? list(o.v.jobs).map(String) : [];
      if (!jobs.length) errors.push("Document " + dn + ": stage '" + o.k + "' has no jobs");
      P.stages.push({ name: o.k, jobs: jobs, manual: !!(o.v && o.v.manual), final: !!(o.v && o.v.final) });
      jobs.forEach(function (jn) {
        var jd = v[jn];
        if (!jd || typeof jd !== "object") { errors.push("Document " + dn + ": stage '" + o.k + "' lists job '" + jn + "', but there is no top-level '" + jn + ":' section defining it"); return; }
        if (!jd.tasks) errors.push("Document " + dn + ": job '" + jn + "' has no tasks");
        P.jobs[jn] = { name: jn, key: jd.key || slugKey(jn), tasks: tasksOf(jd.tasks, errors, "Job '" + jn + "'"), finals: tasksOf(jd["final-tasks"], errors, "Job '" + jn + "'"), reqs: reqsOf(jd.requirements), arts: list(jd.artifacts).map(function (a) { return { name: a.name, pattern: a.pattern, shared: a.shared !== false && a.shared !== undefined ? true : !!a.shared, required: !!a.required }; }), vars: varsOf(jd.variables) };
      });
    });
    void w;
    return P;
  }
  function deployOf(v, errors, dn) {
    var dd = v.deployment || {};
    var D = { name: dd.name, source: dd["source-plan"], naming: v["release-naming"], envs: [], perms: {}, deployPerms: v["deployment-permissions"] };
    if (!D.name || !D.source) errors.push("Document " + dn + ": deployment needs a name and a source-plan");
    list(v.environments).forEach(function (en) {
      en = String(en);
      var ed = v[en];
      if (!ed || typeof ed !== "object") { errors.push("Document " + dn + ": environment '" + en + "' is listed but has no '" + en + ":' section"); return; }
      D.envs.push({ name: en, triggers: list(ed.triggers).map(function (t) { var o = one(t); return o.k; }), tasks: tasksOf(ed.tasks, errors, "Environment '" + en + "'"), finals: tasksOf(ed["final-tasks"], errors, "Environment '" + en + "'"), reqs: reqsOf(ed.requirements), vars: varsOf(ed.variables) });
    });
    if (!D.envs.length) errors.push("Document " + dn + ": deployment '" + D.name + "' needs an 'environments' list");
    list(v["environment-permissions"]).forEach(function (ep) { keys(ep).forEach(function (en) { D.perms[en] = list(ep[en]).map(function (p) { return { users: list(p.users).map(String), groups: list(p.groups).map(String), perms: list(p.permissions).map(String) }; }); }); });
    return D;
  }

  function onPush(sys, br, sha) {
    var B = bamboo(sys), home = CI.homeSys(sys), flat = G.commitFlat(home, sha);
    if (!flat[SPECS]) return;
    var res = parseSpecs(G.blobText(home, flat[SPECS].sha)), rec = { branch: br, sha: sha, t: now(sys), errors: res.errors.slice(), plans: [], deployments: [] };
    var repoDefault = (GH.find(sys, B.repo) || {}).default || "main";
    if (!res.errors.length && res.plan) {
      if (res.plan.projectKey !== B.project.key) rec.errors.push("Plan " + res.plan.key + ": project " + res.plan.projectKey + " does not exist (projects on this Bamboo: " + B.project.key + ")");
      res.deployments.forEach(function (D) { if (D.source !== res.plan.key) rec.errors.push("Deployment '" + D.name + "': source-plan " + D.source + " is not a plan defined in this repository (did you mean " + res.plan.key + "?)"); });
    }
    B.specs.push(rec);
    if (rec.errors.length) return;
    var P = res.plan;
    if (P && br === repoDefault) {
      var old = B.plans[P.key];
      P.branches = old ? old.branches : {};
      P.defaultBranch = repoDefault;
      B.plans[P.key] = P; rec.plans.push(P.key);
      res.deployments.forEach(function (D) { var od = B.deploys[D.name]; D.releases = od ? od.releases : []; D.results = od ? od.results : []; D.nextRel = od ? od.nextRel : null; B.deploys[D.name] = D; rec.deployments.push(D.name); });
    }
    var plan = P ? B.plans[P.key] : null;
    if (!plan) return;
    var triggers = P.triggers;
    if (Array.isArray(triggers) && !triggers.length) return;
    var known = !!plan.branches[br];
    if (br !== plan.defaultBranch && !known && plan.branchMode !== "for-new-branch") return;
    branchOf(plan, br);
    // plan branches build with the specs from their own branch
    runPlan(sys, br === plan.defaultBranch ? plan : Object.assign({}, P, { branches: plan.branches, defaultBranch: plan.defaultBranch, key: plan.key }), br, sha, "Changes by " + ((G.commitOf(home, sha).author || {}).name || "Dev") + " (" + sha.slice(0, 7) + ")");
  }

  /* ================================================================== running jobs */
  function agentFor(B, reqs) {
    var hit = B.agents.filter(function (a) { return reqs.every(function (r) { return a.caps[r.key] != null && (r.value == null || String(a.caps[r.key]) === r.value); }); });
    return hit[0] || null;
  }
  // Context for one job or deployment: {B, sys, label, rs, ws, log, masks, vars}
  function blog(ctx, type, text) { String(text).split("\n").forEach(function (l) { var m = l; ctx.masks.forEach(function (s) { if (s && s.length > 2) m = m.split(s).join("********"); }); ctx.log.push(type + "\t" + stamp(ctx.t + Math.round(ctx.secs)) + "\t" + m); }); }
  function subst(s, vars) { return String(s).replace(/\$\{bamboo\.([\w.]+)\}/g, function (m0, k) { return vars[k] != null ? vars[k] : m0; }); }
  function envFromVars(vars) { var e = {}; keys(vars).forEach(function (k) { e["bamboo_" + k.replace(/\./g, "_")] = vars[k]; }); return e; }
  function resolveVars(ctx, raw) {
    var v = {};
    keys(raw).forEach(function (k) {
      var d = decrypt(ctx.B, raw[k]);
      if (d && !d.ok) { ctx.badSecret = k; v[k] = raw[k]; return; }
      v[k] = d ? d.v : raw[k];
      if (d || MASK_NAMES.test(k)) ctx.masks.push(v[k]);
    });
    return v;
  }
  function runTasks(ctx, tasks, final) {
    for (var i = 0; i < tasks.length; i++) {
      var t = tasks[i], name = t.description || ({ checkout: "Checkout Default Repository", script: "Script", clean: "Clean working directory task", "test-parser": "JUnit Parser", "artifact-download": "Download release contents", "inject-variables": "Inject Bamboo variables" })[t.type] || t.type;
      if (ctx.failed && !final) continue;
      blog(ctx, "simple", "Starting task '" + name + "' of type '" + taskType(t.type) + "'");
      var ok = runTask(ctx, t);
      blog(ctx, "simple", "Finished task '" + name + "' with result: " + (ok ? "Success" : "Failed"));
      if (!ok) ctx.failed = true;
    }
  }
  function taskType(t) { return { checkout: "com.atlassian.bamboo.plugins.vcs:task.vcs.checkout", script: "com.atlassian.bamboo.plugins.scripttask:task.builder.script", clean: "com.atlassian.bamboo.plugins.bamboo-artifact-downloader-plugin:cleanWorkingDirectoryTask", "test-parser": "com.atlassian.bamboo.plugins.testresultparser:task.testresultparser.junit", "artifact-download": "com.atlassian.bamboo.plugins.bamboo-artifact-downloader-plugin:artifactdownloadertask", "inject-variables": "com.atlassian.bamboo.plugins.bamboo-variable-inject-plugin:inject" }[t] || t; }
  function wsGlob(rs, ws, pats) {
    var files = [];
    function re(p) { return new RegExp("^" + String(p).replace(/^\.\//, "").replace(/[.+^${}()|\\]/g, "\\$&").replace(/\*\*\//g, "\u0001").replace(/\*\*/g, "\u0002").replace(/\*/g, "[^/]*").replace(/\u0001/g, "(?:.*/)?").replace(/\u0002/g, ".*").replace(/\?/g, ".") + "$"); }
    var res = pats.map(re);
    (function walk(dn, rel) { if (!dn || dn.type !== "d") return; keys(dn.children).forEach(function (k) { var c = dn.children[k], p = rel ? rel + "/" + k : k; if (c.type === "d") walk(c, p); else if (res.some(function (r) { return r.test(p); })) files.push({ path: p, content: String(c.content) }); }); })(Dk.fsNode(rs, ws), "");
    return files;
  }
  function runTask(ctx, t) {
    var rs = ctx.rs, ws = ctx.ws;
    if (t.type === "checkout") {
      blog(ctx, "simple", "Updating source code to revision: " + ctx.sha);
      blog(ctx, "simple", "Fetching 'refs/heads/" + ctx.branch + "' from 'https://github.com/" + ctx.B.repo + ".git'.");
      CI.checkout(rs, ctx.B.repo, ctx.sha, ctx.branch, t.path ? S.normAbs(ws + "/" + t.path) : ws, 1001);
      blog(ctx, "simple", "Checking out revision " + ctx.sha + ".");
      blog(ctx, "simple", "Updated source code to revision: " + ctx.sha);
      return true;
    }
    if (t.type === "clean") { var n = Dk.fsNode(rs, ws); if (n) n.children = {}; blog(ctx, "simple", "Cleaning working directory '" + ws + "'"); return true; }
    if (t.type === "script") {
      var body = t.lines.map(function (l) { return subst(l, ctx.vars); }).join("\n");
      var unres = /\$\{bamboo\.([\w.]+)\}/.exec(body);
      var file = "/tmp/" + ctx.label + "-ScriptBuildTask-" + (1000 + ctx.log.length) + ".sh";
      blog(ctx, "command", "Beginning to execute external process for build '" + ctx.title + "'\n ... running command line: \n/bin/sh " + file + "\n ... in: " + (t.workdir ? S.normAbs(ws + "/" + t.workdir) : ws));
      if (unres) blog(ctx, "error", file + ": 1: Bad substitution");
      var env = Object.assign({}, envFromVars(ctx.vars), ctx.env, t.env ? parseEnvStr(t.env) : {});
      var res = unres ? { code: 2, text: "", secs: 1 } : CI.runScript(rs, ctx.user, t.workdir ? S.normAbs(ws + "/" + t.workdir) : ws, env, body, { errexit: false, xtrace: false });
      ctx.secs += res.secs;
      if (res.text) res.text.replace(/\n$/, "").split("\n").forEach(function (l) { blog(ctx, /^(ERROR|error|E |Traceback|.*: (command )?not found|.*No such file)/.test(l) ? "error" : "build", l); });
      if (res.code) { blog(ctx, "error", "Failing task since return code of [/bin/sh " + file + "] was " + res.code + " while expected 0"); return false; }
      return true;
    }
    if (t.type === "test-parser") {
      var files = wsGlob(rs, ws, t.pattern);
      blog(ctx, "simple", "Parsing test results under " + ws + "...");
      if (!files.length) { blog(ctx, "error", "Failing task since test cases were expected but none were found."); return false; }
      var tot = 0, fl = 0; files.forEach(function (f) { var m = /tests="(\d+)"/.exec(f.content), x = /failures="(\d+)"/.exec(f.content), e = /errors="(\d+)"/.exec(f.content); tot += m ? +m[1] : 0; fl += (x ? +x[1] : 0) + (e ? +e[1] : 0); });
      ctx.tests = { total: tot, failed: fl };
      if (fl) { blog(ctx, "error", "Failing task since " + fl + " failing test cases were found."); return false; }
      return true;
    }
    if (t.type === "artifact-download") {
      var arts = ctx.artifacts || {};
      var names = t.names || keys(arts);
      if (!names.length) { blog(ctx, "error", "No artifacts to download: the source build shared none (add artifacts with shared: true to a job)"); return false; }
      for (var i = 0; i < names.length; i++) {
        var a = arts[names[i]];
        if (!a) { blog(ctx, "error", "Unable to find artifact '" + names[i] + "' in the release's build " + (ctx.sourceKey || "")); return false; }
        var dest = S.normAbs(ws + "/" + (t.dest === "." ? "" : t.dest));
        a.files.forEach(function (f) { var p = S.normAbs(dest + "/" + f.path); S.mkdirs(rs, p.replace(/\/[^/]*$/, "") || "/", 493, 1001, 1001); S.put(rs, p, f.content, 420, 1001, 1001); });
        blog(ctx, "simple", "Downloaded artifact '" + names[i] + "' (" + a.files.length + " file" + (a.files.length === 1 ? "" : "s") + ") to " + dest);
      }
      return true;
    }
    if (t.type === "inject-variables") {
      var fn = Dk.fsNode(rs, S.normAbs(ws + "/" + t.file));
      if (!fn || fn.type !== "f") { blog(ctx, "error", "Unable to read the file " + S.normAbs(ws + "/" + t.file) + " (No such file or directory)"); return false; }
      String(fn.content).split("\n").forEach(function (l) { var m = /^\s*([\w.]+)\s*=\s*(.*)$/.exec(l); if (m) { ctx.vars[t.ns + "." + m[1]] = m[2]; if (t.scope === "RESULT") (ctx.resultVars = ctx.resultVars || {})[t.ns + "." + m[1]] = m[2]; } });
      blog(ctx, "simple", "Injected variables from " + t.file + " into namespace '" + t.ns + "'");
      return true;
    }
    blog(ctx, "simple", "(task type " + t.type + " is accepted but not simulated in this lab)");
    return true;
  }
  function parseEnvStr(s) { var e = {}; String(s).split(/\s+/).forEach(function (kv) { var i = kv.indexOf("="); if (i > 0) e[kv.slice(0, i)] = kv.slice(i + 1).replace(/^["']|["']$/g, ""); }); return e; }
  function newCtx(sys, title, label, agent, user) {
    var B = bamboo(sys), rs = CI.makeAgent(sys, agent.name + "-" + label.toLowerCase(), { user: "bamboo", home: "/home/bamboo", docker: !!agent.docker, kind: "bambooAgent", kdeploy: !!agent.caps.kdeploy });
    rs.host = agent.name;
    return { B: B, sys: sys, rs: rs, user: user || "bamboo", log: [], masks: [], vars: {}, env: {}, t: now(sys), secs: 0, title: title, label: label, agent: agent.name };
  }

  function runPlan(sys, P, br, sha, reason) {
    var B = bamboo(sys), bj = branchOf(B.plans[P.key] || P, br), num = bj.next++, home = CI.homeSys(sys);
    var key = bj.key + "-" + num, result = { key: key, plan: P.key, branch: br, number: num, sha: sha, reason: reason, jobs: [], state: "Successful", t: now(sys), artifacts: {}, vars: {} };
    bj.results.push(result);
    var vars0 = Object.assign({}, P.vars);
    var failedStage = false;
    P.stages.forEach(function (st) {
      st.jobs.forEach(function (jn) {
        var J = P.jobs[jn]; if (!J) return;
        var jr = { name: jn, key: bj.key + "-" + J.key + "-" + num, stage: st.name, state: "Not built", log: [], tests: null, agent: null };
        result.jobs.push(jr);
        if (failedStage) { jr.state = "Not built"; return; }
        if (st.manual) { jr.state = "Not built"; jr.manual = true; result.manualStop = true; return; }
        var agent = agentFor(B, J.reqs);
        if (!agent) { jr.state = "Queued"; jr.queued = "No agent can build this job. Unmet requirements: " + J.reqs.map(function (r) { return r.key + (r.value != null ? "=" + r.value : ""); }).join(", "); result.state = "Queued"; failedStage = true; return; }
        var title = (B.project.name) + " - " + P.name + (br !== P.defaultBranch ? " - " + br : "") + " - " + jn + " #" + num + " (" + jr.key + ")";
        var ctx = newCtx(sys, title, jr.key, agent);
        ctx.ws = "/home/bamboo/bamboo-agent-home/xml-data/build-dir/" + bj.key + "-" + J.key;
        S.mkdirs(ctx.rs, ctx.ws, 493, 1001, 1001);
        ctx.branch = br; ctx.sha = sha;
        ctx.vars = resolveVars(ctx, Object.assign({}, vars0, J.vars));
        Object.assign(ctx.vars, { buildNumber: String(num), buildResultKey: jr.key, planKey: P.key, planName: (B.project.name) + " - " + P.name, shortJobName: jn, "planRepository.branchName": br, "planRepository.revision": sha, "repository.git.branch": br, "build.working.directory": ctx.ws, agentWorkingDirectory: "/home/bamboo/bamboo-agent-home/xml-data/build-dir" });
        blog(ctx, "build", "Build " + title + " started building on agent " + agent.name + ", bamboo version: " + VERSION);
        blog(ctx, "simple", "Build working directory is " + ctx.ws);
        blog(ctx, "simple", "Executing build " + title);
        if (ctx.badSecret) { blog(ctx, "error", "Unable to decrypt the value of variable '" + ctx.badSecret + "': it was not encrypted by this Bamboo instance (use Specs > Encryption, or `bamboo encrypt`)"); ctx.failed = true; }
        else runTasks(ctx, J.tasks, false);
        runTasks(ctx, J.finals, true);
        // artifacts
        J.arts.forEach(function (a) {
          var files = wsGlob(ctx.rs, ctx.ws, [a.pattern]);
          if (!files.length) { blog(ctx, "simple", "The artifact '" + a.name + "' is empty: no files match '" + a.pattern + "'"); if (a.required) ctx.failed = true; return; }
          blog(ctx, "simple", "Publishing an artifact: " + a.name);
          blog(ctx, "simple", "Finished publishing of artifact " + (a.shared ? "Shared" : "Non-required non-shared") + " artifact: [" + a.name + "], pattern: [" + a.pattern + "] in " + Math.max(1, files.length * 7) + " ms");
          if (a.shared) result.artifacts[a.name] = { name: a.name, files: files, job: jn };
        });
        if (ctx.resultVars) Object.assign(result.vars, ctx.resultVars);
        jr.tests = ctx.tests || null; jr.agent = agent.name; jr.secs = ctx.secs + 3;
        jr.state = ctx.failed ? "Failed" : "Successful";
        blog(ctx, "simple", "Finished building " + jr.key + ".");
        jr.log = ctx.log;
        if (ctx.failed) { result.state = "Failed"; }
      });
      if (result.state !== "Successful") failedStage = true;
    });
    if (result.manualStop && result.state === "Successful") result.state = "Successful";
    CI.bambooLast = result;
    (CI.hubOf(sys).ciEvents = CI.hubOf(sys).ciEvents || []).push({ system: "bamboo", plan: P.key, branch: br, number: num, t: now(sys), cmd: home.cmdIndex });
    // deployment triggers
    if (result.state === "Successful" && br === P.defaultBranch) keys(B.deploys).forEach(function (dn) {
      var D = B.deploys[dn]; if (D.source !== P.key) return;
      var auto = D.envs.filter(function (e) { return e.triggers.indexOf("build-success") >= 0; });
      if (!auto.length) return;
      var rel = createRelease(sys, D, result);
      auto.forEach(function (e) { deploy(sys, D, e, rel, "Triggered by successful build " + result.key); });
    });
    return result;
  }
  CI.bambooRun = runPlan;

  /* ================================================================== deployments */
  function relName(D, result) {
    var nm = D.naming;
    if (nm && typeof nm === "object") {
      var base = String(nm["next-version-name"] || "release-1");
      if (D.nextRel == null) D.nextRel = base;
      var name = subst(D.nextRel, { buildNumber: String(result.number) });
      if (nm["auto-increment"] !== false) D.nextRel = D.nextRel.replace(/(\d+)(?!.*\d)/, function (m) { return String(+m + 1); });
      return name;
    }
    if (typeof nm === "string") return subst(nm, Object.assign({ buildNumber: String(result.number) }, result.vars));
    return "release-" + (D.releases.length + 1);
  }
  function createRelease(sys, D, result) {
    var name = relName(D, result);
    if (D.releases.some(function (r) { return r.name === name; })) name = name + "-" + result.number;
    var rel = { name: name, build: result.key, sha: result.sha, artifacts: result.artifacts, vars: result.vars, t: now(sys) };
    D.releases.push(rel);
    return rel;
  }
  function canDeploy(B, D, env, user) {
    var perms = D.perms[env.name];
    if (!perms) return true;
    var u = B.users[user] || { groups: [] };
    return perms.some(function (p) { return p.perms.indexOf("deploy") >= 0 && (p.users.indexOf(user) >= 0 || p.groups.some(function (g) { return u.groups.indexOf(g) >= 0; })); });
  }
  function deploy(sys, D, env, rel, reason, user) {
    var B = bamboo(sys), n = D.results.length + 1;
    var dr = { id: 1000 + n, env: env.name, release: rel.name, state: "Unknown", log: [], reason: reason, t: now(sys), by: user || null };
    D.results.push(dr);
    var agent = agentFor(B, env.reqs);
    if (!agent) { dr.state = "Queued"; dr.queued = "No agent can run this deployment. Unmet requirements: " + env.reqs.map(function (r) { return r.key; }).join(", "); return dr; }
    var label = "NOTES-" + env.name.toUpperCase().replace(/\W+/g, "") + "-" + dr.id;
    var ctx = newCtx(sys, D.name + " - " + env.name + " - " + rel.name, label, agent);
    ctx.ws = "/home/bamboo/bamboo-agent-home/xml-data/build-dir/" + (1310000 + D.envs.indexOf(env)) + "-" + (1340000 + n);
    S.mkdirs(ctx.rs, ctx.ws, 493, 1001, 1001);
    ctx.branch = "main"; ctx.sha = rel.sha; ctx.artifacts = rel.artifacts; ctx.sourceKey = rel.build;
    ctx.vars = resolveVars(ctx, Object.assign({}, (B.plans[D.source] || {}).vars || {}, env.vars));
    Object.assign(ctx.vars, rel.vars, { "deploy.release": rel.name, "deploy.environment": env.name, "deploy.project": D.name, "deploy.version": rel.name, buildResultKey: rel.build, buildNumber: rel.build.replace(/^.*-/, ""), "planRepository.revision": rel.sha });
    blog(ctx, "simple", "Executing deployment " + D.name + " - " + env.name + " - " + rel.name + " on agent " + agent.name);
    blog(ctx, "simple", reason);
    if (ctx.badSecret) { blog(ctx, "error", "Unable to decrypt the value of variable '" + ctx.badSecret + "': it was not encrypted by this Bamboo instance (use Specs > Encryption, or `bamboo encrypt`)"); ctx.failed = true; }
    else runTasks(ctx, env.tasks, false);
    runTasks(ctx, env.finals, true);
    dr.state = ctx.failed ? "Failed" : "Success";
    blog(ctx, "simple", "Finished deployment " + D.name + " - " + env.name + " - " + rel.name + ": " + dr.state);
    dr.log = ctx.log; dr.agent = agent.name;
    if (dr.state === "Success") env.current = rel.name;
    (CI.hubOf(sys).ciEvents = CI.hubOf(sys).ciEvents || []).push({ system: "bamboo-deploy", env: env.name, release: rel.name, t: now(sys), cmd: CI.homeSys(sys).cmdIndex });
    return dr;
  }
  CI.bambooDeploy = deploy;

  /* ================================================================== the bamboo wrapper CLI */
  function pad(s, n) { s = String(s); return s.length >= n ? s + " " : s + new Array(n - s.length + 1).join(" "); }
  CMDS.bamboocli = function (args, io, sess) {
    var sys = sess.sys, B = bamboo(sys), a = args.slice(1), sub = a[0], rest = a.slice(1);
    var tok = S.getVar(sess, "BAMBOO_TOKEN");
    if (!tok) { var f = Dk.fsNode(sys, sess.home + "/.bamboo-cli"); if (f && f.type === "f") { var m = /BAMBOO_TOKEN=["']?([^"'\s]+)/.exec(String(f.content)); if (m) tok = m[1]; } }
    var HELP = "usage: bamboo <command>   (Kestrel's wrapper around the Bamboo REST API at " + URL + ")\n\n  specs [--log]                 result of the last Bamboo Specs scans of the repository\n  plans                         plans, plan branches and their latest results\n  agents                        build agents and their capabilities\n  queue PLAN [-b BRANCH]        start a build (POST /rest/api/latest/queue/PLAN)\n  result PLAN[-N] [--log [JOB]] a build result; --log prints a job's build log\n  releases [PROJECT]            releases of a deployment project\n  deploy ENVIRONMENT RELEASE    deploy a release to an environment\n  deployments [ENVIRONMENT] [--log]  deployment results\n  encrypt VALUE                 encrypt a secret for Bamboo Specs (BAMBOO-SECRET-V1:...)\n";
    if (!sub || sub === "help" || sub === "--help" || sub === "-h") { out(io, HELP); return 0; }
    var who = keys(B.users).filter(function (u) { return B.users[u].token && B.users[u].token === tok; })[0];
    if (!who) { errl(io, "bamboo: HTTP 401 Unauthorized from " + URL + "/rest/api/latest (set BAMBOO_TOKEN to a Bamboo personal access token)"); return 1; }
    if (sub === "encrypt") { if (!rest[0]) { errl(io, "usage: bamboo encrypt VALUE"); return 2; } out(io, encrypt(B, rest.join(" ")) + "\n"); return 0; }
    if (sub === "agents") { out(io, B.agents.map(function (ag) { return ag.name + "\n" + keys(ag.caps).map(function (k) { return "    " + pad(k, 28) + ag.caps[k]; }).join("\n"); }).join("\n") + "\n"); return 0; }
    if (sub === "specs") {
      if (!B.specs.length) { out(io, "No Bamboo Specs scans yet. Bamboo scans " + SPECS + " on every push to " + B.repo + ".\n"); return 0; }
      var showLog = rest.indexOf("--log") >= 0, sp = B.specs.slice(-5).reverse();
      sp.forEach(function (r, i) {
        out(io, (r.errors.length ? "Failed  " : "Success ") + " " + stamp(r.t) + "  " + r.branch + " @ " + r.sha.slice(0, 7) + (r.plans.length ? "  updated plan " + r.plans.join(", ") : r.errors.length ? "" : r.branch !== "main" ? "  (plan branch: specs used for that branch's builds)" : "") + (r.deployments.length ? "; deployment " + r.deployments.join(", ") : "") + "\n");
        if (r.errors.length && (showLog || i === 0)) out(io, r.errors.map(function (e) { return "    " + e; }).join("\n") + "\n");
      });
      return 0;
    }
    if (sub === "plans") {
      var pk = keys(B.plans);
      if (!pk.length) { out(io, "No plans yet. Push " + SPECS + " to " + B.repo + "'s default branch and Bamboo creates them.\n"); return 0; }
      pk.forEach(function (k) { var P = B.plans[k]; out(io, k + "  " + B.project.name + " - " + P.name + "\n"); keys(P.branches).forEach(function (bn) { var b = P.branches[bn], last = b.results[b.results.length - 1]; out(io, "    " + pad(bn, 22) + pad(b.key, 12) + (last ? "#" + last.number + " " + last.state + (last.state === "Queued" ? "" : "") : "never built") + "\n"); }); });
      return 0;
    }
    if (sub === "queue") {
      var pkey = rest[0], bi = rest.indexOf("-b"), br = bi >= 0 ? rest[bi + 1] : null, P0 = B.plans[pkey];
      if (!P0) { errl(io, "bamboo: HTTP 404: Plan \"" + (pkey || "") + "\" not found" + (keys(B.plans).length ? " (plans: " + keys(B.plans).join(", ") + ")" : "")); return 1; }
      br = br || P0.defaultBranch;
      var sha = (GH.find(sys, B.repo) || { refs: {} }).refs["refs/heads/" + br];
      if (!sha) { errl(io, "bamboo: HTTP 404: no branch '" + br + "' in " + B.repo); return 1; }
      var specsRes = br === P0.defaultBranch ? null : (function () { var fl = G.commitFlat(CI.homeSys(sys), sha); return fl[SPECS] ? parseSpecs(G.blobText(CI.homeSys(sys), fl[SPECS].sha)) : null; })();
      var Prun = specsRes && specsRes.plan && !specsRes.errors.length ? Object.assign({}, specsRes.plan, { branches: P0.branches, defaultBranch: P0.defaultBranch, key: P0.key }) : P0;
      var r = runPlan(sys, Prun, br, sha, "Manual run by " + who);
      out(io, "Queued " + r.key + " (" + br + ")  " + URL + "/browse/" + r.key + "\n" + resultText(r));
      return r.state === "Successful" ? 0 : 1;
    }
    if (sub === "result") {
      var spec = rest.filter(function (x) { return !/^--/.test(x); }), id = spec[0] || "", li = rest.indexOf("--log"), job = li >= 0 ? rest[li + 1] : null;
      var r2 = findResult(B, id);
      if (!r2) { errl(io, "bamboo: HTTP 404: result \"" + id + "\" not found"); return 1; }
      if (li < 0) { out(io, resultText(r2)); return 0; }
      var jobs = r2.jobs.filter(function (j) { return !job || j.name === job || j.key === job || j.key.split("-").slice(-2, -1)[0] === job; });
      if (!jobs.length) { errl(io, "bamboo: no job \"" + job + "\" in " + r2.key + " (jobs: " + r2.jobs.map(function (j) { return j.name; }).join(", ") + ")"); return 1; }
      jobs.forEach(function (j) { out(io, "==> " + j.key + " (" + j.name + ")\n" + (j.log.length ? j.log.join("\n") + "\n" : j.queued ? j.queued + "\n" : "(not built)\n")); });
      return 0;
    }
    if (sub === "releases") {
      var D = deployProject(B, rest[0]);
      if (!D) { errl(io, "bamboo: no deployment projects yet. Add a deployment document to " + SPECS + "."); return 1; }
      out(io, D.name + " (from " + D.source + ")\n");
      if (!D.releases.length) out(io, "    no releases yet\n");
      D.releases.slice().reverse().forEach(function (r) { var on = D.envs.filter(function (e) { return e.current === r.name; }).map(function (e) { return e.name; }); out(io, "    " + pad(r.name, 16) + pad(r.build, 16) + r.sha.slice(0, 7) + (on.length ? "   on " + on.join(", ") : "") + "\n"); });
      return 0;
    }
    if (sub === "deploy") {
      var D2 = deployProject(B, null), envName = rest[0], relN = rest[1];
      if (!D2) { errl(io, "bamboo: no deployment projects yet."); return 1; }
      var env = D2.envs.filter(function (e) { return e.name.toLowerCase() === String(envName).toLowerCase(); })[0];
      if (!env) { errl(io, "bamboo: no environment \"" + (envName || "") + "\" in " + D2.name + " (environments: " + D2.envs.map(function (e) { return e.name; }).join(", ") + ")"); return 1; }
      var rel = D2.releases.filter(function (r) { return r.name === relN; })[0];
      if (!rel) { errl(io, "bamboo: no release \"" + (relN || "") + "\" (see bamboo releases)"); return 1; }
      if (!canDeploy(B, D2, env, who)) { errl(io, "bamboo: HTTP 403: " + who + " doesn't have permission to deploy to " + env.name); return 1; }
      var dr = deploy(sys, D2, env, rel, "Manual deployment by " + who, who);
      out(io, "Deploying " + rel.name + " to " + env.name + " ... " + (dr.state === "Queued" ? "Queued: " + dr.queued : dr.state) + "\n");
      return dr.state === "Success" ? 0 : 1;
    }
    if (sub === "deployments") {
      var D3 = deployProject(B, null); if (!D3) { errl(io, "bamboo: no deployment projects yet."); return 1; }
      var en = rest.filter(function (x) { return !/^--/.test(x); })[0], rs = D3.results.filter(function (d) { return !en || d.env.toLowerCase() === en.toLowerCase(); });
      if (!rs.length) { out(io, "No deployments yet.\n"); return 0; }
      if (rest.indexOf("--log") >= 0) { var last = rs[rs.length - 1]; out(io, "==> " + last.env + " / " + last.release + " (" + last.state + ")\n" + (last.log.length ? last.log.join("\n") : last.queued || "") + "\n"); return 0; }
      rs.slice().reverse().forEach(function (d) { out(io, pad(d.env, 12) + pad(d.release, 16) + pad(d.state, 9) + stamp(d.t) + "  " + (d.queued || d.reason) + "\n"); });
      return 0;
    }
    errl(io, "bamboo: unknown command '" + sub + "'\n" + HELP); return 2;
  };
  function deployProject(B, name) { var k = keys(B.deploys); if (name) return B.deploys[name] || null; return k.length ? B.deploys[k[0]] : null; }
  function findResult(B, id) {
    var all = [];
    keys(B.plans).forEach(function (k) { keys(B.plans[k].branches).forEach(function (bn) { all = all.concat(B.plans[k].branches[bn].results); }); });
    if (B.plans[id]) { var b = B.plans[id].branches[B.plans[id].defaultBranch]; return b && b.results[b.results.length - 1]; }
    return all.filter(function (r) { return r.key === id; })[0] || null;
  }
  function resultText(r) {
    var s = r.key + "  " + r.state + "  (" + r.branch + " @ " + r.sha.slice(0, 7) + ", " + r.reason + ")\n";
    r.jobs.forEach(function (j) { s += "    " + pad(j.stage, 12) + pad(j.name, 20) + pad(j.state, 11) + (j.tests ? j.tests.total + " tests" + (j.tests.failed ? ", " + j.tests.failed + " failed" : "") : "") + (j.queued ? j.queued : "") + (j.manual ? "manual stage: run it from the plan's page" : "") + "\n"; });
    var arts = keys(r.artifacts); if (arts.length) s += "    shared artifacts: " + arts.join(", ") + "\n";
    return s;
  }

  if (M2.net && M2.net.SITES) {
    M2.net.DNS["bamboo.kestrel.io"] = { A: ["203.0.113.91"] };
    M2.net.HOSTS["203.0.113.91"] = { ping: 5.4, ports: [443], site: "kestrel-bamboo" };
    M2.net.SITES["kestrel-bamboo"] = function (req) { if (/^\/rest\/api\/latest\/info/.test(req.path)) return { status: 200, headers: { "Content-Type": "application/json" }, body: "{\"version\":\"" + VERSION + "\",\"edition\":\"Data Center\",\"buildDate\":\"2026-09-30T00:00:00.000Z\",\"buildNumber\":\"100210\",\"state\":\"RUNNING\"}\n" }; return { status: 401, headers: { "Content-Type": "application/json" }, body: "{\"message\":\"You must be logged in to access this resource\",\"status-code\":401}\n" }; };
  }
})(typeof window !== "undefined" ? window : globalThis);
