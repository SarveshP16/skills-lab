/* sudo learn — DevOps Module 2: a simulated Jenkins (jenkins.kestrel.io). A multibranch pipeline job watches
   kestrel/notes-api on the simulated GitHub: every push to a branch that has a Jenkinsfile builds that branch.
   The Jenkinsfile is parsed as Declarative Pipeline (agent, environment, options, stages, when, steps, post,
   parallel) and its steps really run on build agents (fresh Ubuntu machines: linux-1, and docker-1 which has
   Docker). Credentials are bound the Jenkins way (credentials() and withCredentials, masked as ****, with the
   real warning when a secret goes through Groovy string interpolation). The console log looks like Jenkins'.
   jenkins-cli (a wrapper around `java -jar jenkins-cli.jar`) builds, shows consoles and lints Jenkinsfiles. */
(function (root) {
  "use strict";
  var S = root.ShEngine, M2 = S.M2, CMDS = S.CMDS, U = S.util, Dk = root.Dk, GH = root.GitHub, G = root.GitCore, CI = root.CI;
  var out = U.out, errl = U.errl;
  function keys(o) { return o ? Object.keys(o) : []; }
  function now(sys) { return G.clock(CI.homeSys(sys)); }
  var URL = "https://jenkins.kestrel.io/";

  /* ================================================================== a Groovy-ish reader for Declarative Pipeline */
  function PErr(line, col, msg) { this.line = line; this.col = col; this.message = msg; }
  function tokenize(src) {
    var toks = [], i = 0, line = 1, col = 1, s = String(src);
    function adv(n) { for (var k = 0; k < n; k++) { if (s.charAt(i) === "\n") { line++; col = 1; } else col++; i++; } }
    while (i < s.length) {
      var c = s.charAt(i), m;
      if (c === "\n" || c === " " || c === "\t" || c === "\r") { adv(1); continue; }
      if (s.substr(i, 2) === "//") { while (i < s.length && s.charAt(i) !== "\n") adv(1); continue; }
      if (s.substr(i, 2) === "/*") { var e = s.indexOf("*/", i + 2); adv((e < 0 ? s.length : e + 2) - i); continue; }
      var L = line, C = col;
      if (s.substr(i, 3) === "'''" || s.substr(i, 3) === "\"\"\"") { var q3 = s.substr(i, 3), e3 = s.indexOf(q3, i + 3); if (e3 < 0) throw new PErr(L, C, "unexpected end of file, expected " + q3); var raw = s.slice(i + 3, e3); adv(e3 + 3 - i); toks.push({ t: "str", v: raw.replace(/^\n/, ""), dq: q3 === "\"\"\"", line: L, col: C }); continue; }
      if (c === "'" || c === "\"") { var j = i + 1, v = ""; while (j < s.length && s.charAt(j) !== c) { if (s.charAt(j) === "\\") { var nx = s.charAt(j + 1); v += nx === "n" ? "\n" : nx === "t" ? "\t" : nx === "$" ? "\\$" : nx; j += 2; continue; } if (s.charAt(j) === "\n") throw new PErr(L, C, "expecting '" + c + "', found '\\n'"); v += s.charAt(j); j++; } if (j >= s.length) throw new PErr(L, C, "unexpected end of file in string"); adv(j + 1 - i); toks.push({ t: "str", v: v, dq: c === "\"", line: L, col: C }); continue; }
      if ((m = /^[A-Za-z_$][\w$]*/.exec(s.slice(i)))) { adv(m[0].length); toks.push({ t: "id", v: m[0], line: L, col: C }); continue; }
      if ((m = /^\d+(\.\d+)?/.exec(s.slice(i)))) { adv(m[0].length); toks.push({ t: "num", v: +m[0], line: L, col: C }); continue; }
      if ((m = /^(==|!=|&&|\|\||<=|>=|->)/.exec(s.slice(i)))) { adv(2); toks.push({ t: "sym", v: m[0], line: L, col: C }); continue; }
      if ("{}()[],:=.!+<>?;".indexOf(c) >= 0) { adv(1); toks.push({ t: "sym", v: c, line: L, col: C }); continue; }
      throw new PErr(L, C, "unexpected character '" + c + "'");
    }
    toks.push({ t: "eof", v: "", line: line, col: col });
    return toks;
  }
  // Calls: {name, args: [values], named: {k: value}, block: [calls] | null, line, col}; values: {str|num|bool|list|map|call|ref|closure}
  function parseGroovy(src) {
    var T = tokenize(src), p = 0;
    function peek(k) { return T[p + (k || 0)]; }
    function next() { return T[p++]; }
    function isSym(tk, v) { return tk.t === "sym" && tk.v === v; }
    function expect(v) { var tk = next(); if (!(tk.t === "sym" && tk.v === v)) throw new PErr(tk.line, tk.col, "expecting '" + v + "', found '" + (tk.v || "end of file") + "'"); return tk; }
    function block() { expect("{"); var calls = []; while (!isSym(peek(), "}")) { if (peek().t === "eof") throw new PErr(peek().line, peek().col, "unexpected end of file, expecting '}'"); var c = statement(); if (c) calls.push(c); } expect("}"); return calls; }
    function value() {
      var tk = peek(), v;
      if (tk.t === "str") { next(); v = { str: tk.v, dq: tk.dq }; }
      else if (tk.t === "num") { next(); v = { num: tk.v }; }
      else if (tk.t === "id" && (tk.v === "true" || tk.v === "false")) { next(); v = { bool: tk.v === "true" }; }
      else if (tk.t === "id" && tk.v === "null") { next(); v = { nul: true }; }
      else if (isSym(tk, "!")) { next(); v = { not: value() }; }
      else if (isSym(tk, "[")) {
        next(); var items = [], map = null;
        if (isSym(peek(), ":")) { next(); expect("]"); return { map: {} }; }
        while (!isSym(peek(), "]")) {
          if ((peek().t === "id" || peek().t === "str") && isSym(peek(1), ":")) { var k = next().v; next(); (map = map || {})[k] = value(); }
          else items.push(value());
          if (isSym(peek(), ",")) next(); else break;
        }
        expect("]"); v = map ? { map: map } : { list: items };
      }
      else if (isSym(tk, "{")) { v = { closure: block() }; }
      else if (tk.t === "id") {
        var name = next().v;
        while (isSym(peek(), ".") && peek(1).t === "id") { next(); name += "." + next().v; }
        if (isSym(peek(), "(")) { var call = { name: name, args: [], named: {}, line: tk.line, col: tk.col, block: null }; argsParen(call); if (isSym(peek(), "{") && peek().line === T[p - 1].line) call.block = block(); v = { call: call }; }
        else v = { ref: name };
      }
      else throw new PErr(tk.line, tk.col, "unexpected token: " + (tk.v || "end of file"));
      // a.b(...) chains and + concatenation (enough for the odd Groovy expression)
      while (isSym(peek(), ".") && peek(1).t === "id") { next(); var mth = next().v; if (isSym(peek(), "(")) { var dummy = { args: [], named: {} }; argsParen(dummy); } v = { method: mth, on: v }; }
      if (isSym(peek(), "+")) { next(); var rhs = value(); v = { plus: [v, rhs] }; }
      if (peek().t === "sym" && /^(==|!=|&&|\|\|)$/.test(peek().v)) { var op = next().v; v = { op: op, l: v, r: value() }; }
      return v;
    }
    function argsParen(call) {
      expect("(");
      while (!isSym(peek(), ")")) {
        if ((peek().t === "id" || peek().t === "str") && isSym(peek(1), ":")) { var k = next().v; next(); call.named[k] = value(); }
        else call.args.push(value());
        if (isSym(peek(), ",")) next(); else break;
      }
      expect(")");
    }
    function statement() {
      var tk = peek();
      if (isSym(tk, ";")) { next(); return null; }
      if (tk.t !== "id") throw new PErr(tk.line, tk.col, "unexpected token: " + (tk.v || "end of file"));
      next();
      var name = tk.v;
      if (name === "def") { var nmT = next(); if (isSym(peek(), "=")) { next(); return { name: "=", target: nmT.v, value: value(), line: tk.line, col: tk.col }; } return { name: "def", target: nmT.v, line: tk.line, col: tk.col }; }
      while (isSym(peek(), ".") && peek(1).t === "id") { next(); name += "." + next().v; }
      var call = { name: name, args: [], named: {}, block: null, line: tk.line, col: tk.col };
      if (isSym(peek(), "=")) { next(); return { name: "=", target: name, value: value(), line: tk.line, col: tk.col }; }
      if (isSym(peek(), "(")) argsParen(call);
      else if (peek().line === tk.line && !isSym(peek(), "{") && !isSym(peek(), "}") && peek().t !== "eof") {
        for (;;) {
          if ((peek().t === "id" || peek().t === "str") && isSym(peek(1), ":")) { var k = next().v; next(); call.named[k] = value(); }
          else call.args.push(value());
          if (isSym(peek(), ",")) { next(); continue; }
          break;
        }
      }
      if (isSym(peek(), "{")) call.block = block();
      return call;
    }
    var top = [];
    while (peek().t !== "eof") { var c = statement(); if (c) top.push(c); }
    return top;
  }
  CI.parseGroovy = parseGroovy;

  /* ---------------- Declarative Pipeline structure and validation */
  var SECTIONS = ["agent", "environment", "options", "parameters", "triggers", "tools", "stages", "post", "libraries", "input"];
  var STAGE_SECTIONS = ["agent", "environment", "options", "when", "steps", "post", "parallel", "stages", "input", "tools", "matrix", "failFast"];
  var POSTS = ["always", "changed", "fixed", "regression", "aborted", "failure", "success", "unstable", "unsuccessful", "cleanup"];
  var STEPS = ["sh", "echo", "error", "checkout", "dir", "withEnv", "withCredentials", "timeout", "retry", "catchError", "junit", "archiveArtifacts", "cleanWs", "deleteDir", "script", "input", "sleep", "writeFile", "readFile", "stash", "unstash", "git", "fileExists", "unstable", "warnError", "build", "mail", "emailext", "slackSend"];
  function lintErr(c, msg) { return "WorkflowScript: " + c.line + ": " + msg + " @ line " + c.line + ", column " + c.col + "."; }
  function strOf(v) { if (!v) return null; if (v.str != null) return v.str; if (v.num != null) return String(v.num); if (v.bool != null) return String(v.bool); return null; }
  function parseJenkinsfile(text) {
    var top;
    try { top = parseGroovy(text); } catch (e) { if (e instanceof PErr) return { errors: ["WorkflowScript: " + e.line + ": " + e.message + " @ line " + e.line + ", column " + e.col + "."] }; throw e; }
    var pipe = top.filter(function (c) { return c.name === "pipeline"; })[0], errors = [];
    if (!pipe || !pipe.block) return { errors: ["WorkflowScript: 1: Missing required section \"pipeline\" (a Declarative Pipeline file starts with pipeline { ... }) @ line 1, column 1."] };
    var P = { agent: null, env: [], options: [], stages: [], post: {}, line: pipe.line };
    var seen = {};
    pipe.block.forEach(function (c) {
      if (SECTIONS.indexOf(c.name) < 0) { errors.push(lintErr(c, "Undefined section \"" + c.name + "\"")); return; }
      if (seen[c.name]) errors.push(lintErr(c, "Multiple occurrences of the " + c.name + " section")); seen[c.name] = 1;
      if (c.name === "agent") P.agent = agentOf(c, errors);
      else if (c.name === "environment") P.env = envOf(c, errors);
      else if (c.name === "options") P.options = c.block || [];
      else if (c.name === "stages") P.stages = stagesOf(c, errors);
      else if (c.name === "post") P.post = postOf(c, errors);
    });
    if (!seen.agent) errors.push("WorkflowScript: " + pipe.line + ": Missing required section \"agent\" @ line " + pipe.line + ", column " + pipe.col + ".");
    if (!seen.stages) errors.push("WorkflowScript: " + pipe.line + ": Missing required section \"stages\" @ line " + pipe.line + ", column " + pipe.col + ".");
    else if (!P.stages.length) errors.push("WorkflowScript: " + pipe.line + ": No stages specified @ line " + pipe.line + ", column " + pipe.col + ".");
    return { pipeline: P, errors: errors };
  }
  CI.parseJenkinsfile = parseJenkinsfile;
  function agentOf(c, errors) {
    if (c.args.length && c.args[0].ref) { var r = c.args[0].ref; if (r === "any" || r === "none") return { kind: r }; errors.push(lintErr(c, "Invalid agent type \"" + r + "\" specified. Must be one of [any, docker, dockerfile, kubernetes, label, none]")); return { kind: "any" }; }
    if (c.block) {
      var lb = c.block.filter(function (x) { return x.name === "label"; })[0], dk = c.block.filter(function (x) { return x.name === "docker"; })[0], nd = c.block.filter(function (x) { return x.name === "node"; })[0];
      if (lb) return { kind: "label", label: strOf(lb.args[0]) || "" };
      if (nd && nd.block) { var l2 = nd.block.filter(function (x) { return x.name === "label"; })[0]; return { kind: "label", label: l2 ? strOf(l2.args[0]) : "" }; }
      if (dk) { var img = dk.args.length ? strOf(dk.args[0]) : dk.block ? strOf((dk.block.filter(function (x) { return x.name === "image"; })[0] || { args: [] }).args[0]) : null; return { kind: "docker", image: img }; }
    }
    errors.push(lintErr(c, "Not a valid agent declaration")); return { kind: "any" };
  }
  function envOf(c, errors) {
    var list = [];
    (c.block || []).forEach(function (x) { if (x.name !== "=") { errors.push(lintErr(x, "\"" + x.name + "\" is not a valid environment expression. Use \"key = value\" pairs with valid Java/shell keys.")); return; } list.push({ name: x.target, value: x.value, line: x.line }); });
    return list;
  }
  function postOf(c, errors) {
    var p = {};
    (c.block || []).forEach(function (x) { if (POSTS.indexOf(x.name) < 0) { errors.push(lintErr(x, "Invalid condition \"" + x.name + "\" - valid conditions are [" + POSTS.join(", ") + "]")); return; } p[x.name] = x.block || []; });
    return p;
  }
  function stagesOf(c, errors) {
    var list = [];
    (c.block || []).forEach(function (x) {
      if (x.name !== "stage") { errors.push(lintErr(x, "Expected a stage")); return; }
      var name = strOf(x.args[0]);
      if (!name) { errors.push(lintErr(x, "Expected a stage name but didn't find any")); return; }
      var st = { name: name, line: x.line, steps: null, when: null, agent: null, env: [], post: {}, parallel: null };
      (x.block || []).forEach(function (y) {
        if (STAGE_SECTIONS.indexOf(y.name) < 0) { errors.push(lintErr(y, "Unknown stage section \"" + y.name + "\". Starting with version 0.5, steps in a stage must be in a ‘steps’ block.")); return; }
        if (y.name === "steps") { st.steps = y.block || []; checkSteps(st.steps, errors); }
        else if (y.name === "when") st.when = y.block || [];
        else if (y.name === "agent") st.agent = agentOf(y, errors);
        else if (y.name === "environment") st.env = envOf(y, errors);
        else if (y.name === "post") st.post = postOf(y, errors);
        else if (y.name === "parallel") st.parallel = stagesOf(y, errors);
        else if (y.name === "stages") st.parallel = stagesOf(y, errors), st.sequential = true;
      });
      if (!st.steps && !st.parallel) errors.push(lintErr(x, "Expected one of \"steps\", \"stages\", or \"parallel\" for stage \"" + name + "\""));
      list.push(st);
    });
    return list;
  }
  function checkSteps(steps, errors) { (steps || []).forEach(function (s) { if (s.name === "=" || s.name === "def") return; if (s.block && ["dir", "withEnv", "withCredentials", "timeout", "retry", "catchError", "script", "warnError"].indexOf(s.name) >= 0) { if (s.name !== "script") checkSteps(s.block, errors); } }); }

  /* ================================================================== state */
  function jenkins(sys) { var h = CI.hubOf(sys); if (!h.jenkins) h.jenkins = { jobs: {}, creds: {}, agents: [], users: {}, queue: 0 }; return h.jenkins; }
  CI.jenkins = jenkins;
  // Lab setup: Jenkins with a multibranch job for a GitHub repository
  CI.jenkinsSetup = function (sys, o) {
    o = o || {};
    var J = jenkins(sys);
    J.agents = [{ name: "built-in", labels: ["built-in"], executors: 0 }, { name: "linux-1", labels: ["linux"], executors: 2 }, { name: "docker-1", labels: ["linux", "docker"], executors: 2, docker: true }];
    J.jobs[o.job || "notes-api"] = { name: o.job || "notes-api", repo: o.repo || CI.REPO, branches: {}, created: now(sys) };
    J.users["kc-dev"] = { token: "11" + M2.hexOf("jenkins-kc-dev", 32) };
    keys(o.creds || {}).forEach(function (k) { J.creds[k] = o.creds[k]; });
    if (o.cli !== false) {
      CI.putBin(sys, "/usr/local/bin/jenkins-cli", "jenkinscli");
      S.put(sys, "/home/dev/.jenkins-cli", "# read by Kestrel's jenkins-cli wrapper (java -jar jenkins-cli.jar -s $JENKINS_URL ...)\nJENKINS_URL=" + URL + "\nJENKINS_USER_ID=kc-dev\nJENKINS_API_TOKEN=" + J.users["kc-dev"].token + "\n", 384, 1000, 1000);
    }
    if (!J.hooked) {
      J.hooked = true;
      GH.on(sys, "push", function (s2, d) {
        var jj = jenkins(s2);
        keys(jj.jobs).forEach(function (jn) {
          var job = jj.jobs[jn];
          if (d.repo.full !== job.repo || !d.after || !/^refs\/heads\//.test(d.ref)) return;
          var br = d.ref.slice(11), flat = G.commitFlat(s2, d.after);
          if (!flat.Jenkinsfile) return;
          build(s2, job, br, d.after, "Push event to branch " + br);
        });
      });
    }
    return J;
  };
  // A machine user (e.g. kestrel-ci) in the kestrel org with a classic PAT: what CI systems outside GitHub push with
  CI.machineUser = function (sys, login, scopes) {
    var h = CI.hubOf(sys), org = h.orgs.kestrel || GH.org(sys, "kestrel", {});
    org.members[login] = org.members[login] || "member";
    return GH.newToken(sys, login, { scopes: scopes || ["write:packages", "read:packages"], note: "ci" });
  };
  function branchJob(job, br) { return job.branches[br] = job.branches[br] || { name: br, builds: [], next: 1 }; }

  /* ================================================================== running a build */
  function build(sys, job, br, sha, cause) {
    var bj = branchJob(job, br), num = bj.next++, home = CI.homeSys(sys), J = jenkins(sys);
    var b = { number: num, branch: br, sha: sha, cause: cause, result: null, console: [], stages: [], started: now(sys), duration: 0, tests: null };
    bj.builds.push(b);
    var log = function (t) { String(t).split("\n").forEach(function (l) { b.console.push(l); }); };
    var masks = [];
    function mask(t) { masks.forEach(function (m) { if (m && m.length > 2) t = String(t).split(m).join("****"); }); return t; }
    var plog = function (t) { log(mask(t)); };
    log("Started by " + (cause || "user Dev (kc-dev)"));
    var flat = G.commitFlat(home, sha), jf = flat.Jenkinsfile ? G.blobText(home, flat.Jenkinsfile.sha) : null;
    if (jf == null) { log("ERROR: Unable to find Jenkinsfile from git https://github.com/" + job.repo + ".git"); b.result = "FAILURE"; log("Finished: FAILURE"); return b; }
    log("Obtained Jenkinsfile from git https://github.com/" + job.repo + ".git");
    var parsed = parseJenkinsfile(jf);
    if (parsed.errors.length) { log("org.codehaus.groovy.control.MultipleCompilationErrorsException: startup failed:\n" + parsed.errors.join("\n\n") + "\n\n" + parsed.errors.length + " error" + (parsed.errors.length > 1 ? "s" : "") + "\n"); log("[Pipeline] End of Pipeline"); b.result = "FAILURE"; log("Finished: FAILURE"); return b; }
    var P = parsed.pipeline, secs = 0;
    var env = { BRANCH_NAME: br, BUILD_NUMBER: String(num), BUILD_ID: String(num), JOB_NAME: job.name + "/" + br, JOB_BASE_NAME: br, BUILD_TAG: "jenkins-" + job.name + "-" + br + "-" + num, GIT_COMMIT: sha, GIT_BRANCH: br, GIT_URL: "https://github.com/" + job.repo + ".git", JENKINS_URL: URL, BUILD_URL: URL + "job/" + job.name + "/job/" + br + "/" + num + "/", CI: "true" };
    var secretVars = {};
    log("[Pipeline] Start of Pipeline");
    function pickAgent(spec) {
      if (!spec || spec.kind === "none") return null;
      if (spec.kind === "docker") return { error: "This lab's Jenkins doesn't run docker agents; use agent { label 'docker' } and run docker commands in sh steps" };
      var cands = J.agents.filter(function (a) { return a.executors > 0 && (spec.kind === "any" || spec.label.split(/\s*&&\s*/).every(function (l) { return a.labels.indexOf(l) >= 0; })); });
      if (!cands.length) return { error: "There are no nodes with the label ‘" + spec.label + "’" };
      return cands[0];
    }
    var agentSys = null, agentName = null, ws = null;
    function enterAgent(a) {
      agentName = a.name;
      agentSys = CI.makeAgent(home, a.name + "-" + job.name + "-" + num, { docker: !!a.docker, kind: "jenkinsAgent" });
      agentSys.host = a.name;
      ws = "/home/jenkins/agent/workspace/" + job.name + "_" + br.replace(/[^\w.-]/g, "_");
      log("[Pipeline] node\nRunning on " + a.name + " in " + ws + "\n[Pipeline] {\n[Pipeline] stage\n[Pipeline] { (Declarative: Checkout SCM)\n[Pipeline] checkout\nThe recommended git tool is: NONE\nusing credential github-app-kestrel\nCloning the remote Git repository\nCloning repository https://github.com/" + job.repo + ".git\n > git init " + ws + " # timeout=10\nFetching upstream changes from https://github.com/" + job.repo + ".git\n > git fetch --no-tags --force --progress -- https://github.com/" + job.repo + ".git +refs/heads/" + br + ":refs/remotes/origin/" + br + " # timeout=10\nChecking out Revision " + sha + " (" + br + ")\n > git config core.sparsecheckout # timeout=10\n > git checkout -f " + sha + " # timeout=10\nCommit message: \"" + (G.commitOf(home, sha).message.split("\n")[0]) + "\"\n[Pipeline] }\n[Pipeline] // stage");
      CI.checkout(agentSys, job.repo, sha, br, ws, 1001);
      env.WORKSPACE = ws; env.NODE_NAME = a.name;
    }
    function evalStr(v, scope, why) {
      if (!v) return "";
      if (v.str != null) { if (!v.dq) return v.str; return interp(v.str, scope, why); }
      if (v.num != null) return String(v.num);
      if (v.bool != null) return String(v.bool);
      if (v.ref) { var k = v.ref.replace(/^env\./, "").replace(/^params\./, ""); return scope[k] != null ? scope[k] : ""; }
      if (v.plus) return evalStr(v.plus[0], scope, why) + evalStr(v.plus[1], scope, why);
      if (v.method) return evalStr(v.on, scope, why);
      if (v.call && v.call.name === "credentials") return { cred: strOf(v.call.args[0]) };
      return "";
    }
    function interp(s, scope, why) {
      return String(s).replace(/(\\?)\$\{\s*(?:env\.)?(\w+)\s*\}|(\\?)\$(\w+)/g, function (m0, esc1, a, esc2, b2) {
        if (esc1 || esc2) return m0.slice(1);
        var k = a || b2; if (scope[k] == null) return m0;
        if (secretVars[k] && why) why.push(k);
        return scope[k];
      });
    }
    function bindCred(id, kind, vars, scope) {
      var c = J.creds[id];
      if (!c) { plog("ERROR: " + (kind === "env" ? "credentials('" + id + "')" : "Could not find credentials entry with ID '" + id + "'")); return false; }
      if (kind === "env") {
        if (c.type === "usernamePassword") { scope[vars] = c.user + ":" + c.pass; scope[vars + "_USR"] = c.user; scope[vars + "_PSW"] = c.pass; secretVars[vars] = secretVars[vars + "_PSW"] = 1; masks.push(c.pass, c.user + ":" + c.pass); }
        else { scope[vars] = c.secret; secretVars[vars] = 1; masks.push(c.secret); }
        return true;
      }
      return c;
    }
    function condOk(conds, scope) {
      return (conds || []).every(function (c) {
        var a0 = strOf(c.args[0]) || strOf(c.named.pattern);
        if (c.name === "branch") return globMatch(a0, br);
        if (c.name === "tag") return false;
        if (c.name === "changeRequest") return /^PR-\d+$/.test(br);
        if (c.name === "buildingTag") return false;
        if (c.name === "environment") return scope[strOf(c.named.name)] === strOf(c.named.value);
        if (c.name === "not") return !condOk(c.block, scope);
        if (c.name === "anyOf") return (c.block || []).some(function (x) { return condOk([x], scope); });
        if (c.name === "allOf") return condOk(c.block, scope);
        if (c.name === "expression") { var st0 = (c.block || [])[0]; var e = st0 && st0.name === "return" ? st0.args[0] : st0 ? { call: st0 } : null; return evalCond(e, scope); }
        return true;
      });
    }
    function evalCond(v, scope) {
      if (!v) return true;
      if (v.op === "==") return evalStr(v.l, scope) === evalStr(v.r, scope);
      if (v.op === "!=") return evalStr(v.l, scope) !== evalStr(v.r, scope);
      if (v.op === "&&") return evalCond(v.l, scope) && evalCond(v.r, scope);
      if (v.op === "||") return evalCond(v.l, scope) || evalCond(v.r, scope);
      if (v.not) return !evalCond(v.not, scope);
      if (v.bool != null) return v.bool;
      return !!evalStr(v, scope);
    }
    function globMatch(pat, s) { if (!pat) return false; return new RegExp("^" + pat.replace(/[.+^${}()|\\]/g, "\\$&").replace(/\*\*/g, "\u0001").replace(/\*/g, "[^/]*").replace(/\u0001/g, ".*").replace(/\?/g, ".") + "$").test(s); }
    var status = { result: "SUCCESS", unstable: false };
    function runSteps(steps, scope, cwd) {
      for (var i = 0; i < (steps || []).length; i++) { var r = runStep(steps[i], scope, cwd); if (!r) return false; }
      return true;
    }
    function runStep(s, scope, cwd) {
      var n = s.name;
      if (n === "=" || n === "def") { if (s.value && n === "=") { var target = s.target.replace(/^env\./, ""); var v0 = evalStr(s.value, scope); if (typeof v0 === "string") scope[target] = v0; } return true; }
      if (STEPS.indexOf(n) < 0) { plog("[Pipeline] End of Pipeline\njava.lang.NoSuchMethodError: No such DSL method '" + n + "' found among steps [archiveArtifacts, catchError, checkout, cleanWs, deleteDir, dir, echo, error, fileExists, git, input, junit, readFile, retry, script, sh, sleep, stash, timeout, unstable, unstash, withCredentials, withEnv, writeFile, ...]"); status.result = "FAILURE"; status.fatal = true; return false; }
      if (!agentSys && ["sh", "junit", "archiveArtifacts", "dir", "cleanWs", "checkout", "writeFile"].indexOf(n) >= 0) { plog("[Pipeline] " + n + "\norg.jenkinsci.plugins.workflow.steps.MissingContextVariableException: Required context class hudson.FilePath is missing\nPerhaps you forgot to surround the " + n + " step with a step that provides this, such as: node, dockerNode"); status.result = "FAILURE"; return false; }
      log("[Pipeline] " + n);
      if (n === "echo") { plog(evalStr(s.args[0] || s.named.message, scope)); return true; }
      if (n === "error") { plog("ERROR: " + evalStr(s.args[0] || s.named.message, scope)); status.result = "FAILURE"; return false; }
      if (n === "sleep") return true;
      if (n === "checkout" || n === "git") return true;
      if (n === "input") { plog("(input steps wait for a person to click Proceed in the Jenkins UI; this lab's Jenkins proceeds automatically as kc-dev)"); return true; }
      if (n === "cleanWs" || n === "deleteDir") { plog("[WS-CLEANUP] Deleting project workspace...\n[WS-CLEANUP] Deferred wipeout is used...\n[WS-CLEANUP] done"); return true; }
      if (n === "sh") {
        var why = [], scriptV = s.args[0] || s.named.script, script = typeof evalStr(scriptV, scope, why) === "string" ? evalStr(scriptV, scope, why) : "";
        if (why.length) plog("Warning: A secret was passed to \"sh\" using Groovy String interpolation, which is insecure.\n\t\t Affected argument(s) used the following variable(s): [" + why.filter(function (x, i) { return why.indexOf(x) === i; }).join(", ") + "]\n\t\t See https://jenkins.io/redirect/groovy-string-interpolation for details.");
        var res = CI.runScript(agentSys, "jenkins", cwd, scope, script, {});
        secs += res.secs;
        res.text.replace(/\n$/, "").split("\n").forEach(function (l) { if (l !== "" || res.text) plog(l); });
        if (res.code) { plog("ERROR: script returned exit code " + res.code); status.result = "FAILURE"; return false; }
        return true;
      }
      if (n === "dir") { var d = evalStr(s.args[0] || s.named.path, scope), nd = S.normAbs((d.charAt(0) === "/" ? "" : cwd + "/") + d); S.mkdirs(agentSys, nd, 493, 1001, 1001); log("Running in " + nd + "\n[Pipeline] {"); var okd = runSteps(s.block, scope, nd); log("[Pipeline] }\n[Pipeline] // dir"); return okd; }
      if (n === "withEnv") { var sc2 = Object.assign({}, scope); ((s.args[0] || {}).list || []).forEach(function (x) { var kv = evalStr(x, scope); var i2 = kv.indexOf("="); if (i2 > 0) sc2[kv.slice(0, i2)] = kv.slice(i2 + 1); }); log("[Pipeline] {"); var okw = runSteps(s.block, sc2, cwd); log("[Pipeline] }\n[Pipeline] // withEnv"); return okw; }
      if (n === "withCredentials") {
        var sc3 = Object.assign({}, scope), names = [];
        var bindings = (s.args[0] || {}).list || [];
        for (var k = 0; k < bindings.length; k++) {
          var bc = bindings[k].call; if (!bc) continue;
          var id = strOf(bc.named.credentialsId), c = bindCred(id, "with");
          if (!c) { status.result = "FAILURE"; return false; }
          if (bc.name === "usernamePassword") { var uv = strOf(bc.named.usernameVariable), pv = strOf(bc.named.passwordVariable); if (c.type !== "usernamePassword") { plog("ERROR: Credentials '" + id + "' is of type 'Secret text' where 'com.cloudbees.plugins.credentials.common.StandardUsernamePasswordCredentials' was expected"); status.result = "FAILURE"; return false; } sc3[uv] = c.user; sc3[pv] = c.pass; secretVars[pv] = 1; secretVars[uv] = 1; masks.push(c.pass); names.push(pv, uv); }
          else if (bc.name === "string") { var sv = strOf(bc.named.variable); if (c.type !== "string") { plog("ERROR: Credentials '" + id + "' is of type 'Username with password' where 'org.jenkinsci.plugins.plaincredentials.StringCredentials' was expected"); status.result = "FAILURE"; return false; } sc3[sv] = c.secret; secretVars[sv] = 1; masks.push(c.secret); names.push(sv); }
          else if (bc.name === "file") { var fv = strOf(bc.named.variable), fp = ws + "@tmp/secretFiles/" + Dk.hex(id, 8) + "/" + (c.fileName || "secret"); S.mkdirs(agentSys, fp.replace(/\/[^/]*$/, ""), 448, 1001, 1001); S.put(agentSys, fp, c.secret || "", 384, 1001, 1001); sc3[fv] = fp; names.push(fv); }
        }
        log("Masking supported pattern matches of " + names.map(function (x) { return "$" + x; }).join(" or ") + "\n[Pipeline] {");
        var okc = runSteps(s.block, sc3, cwd);
        log("[Pipeline] }\n[Pipeline] // withCredentials");
        return okc;
      }
      if (n === "timeout") { log("Timeout set to expire in " + (evalStr(s.named.time, scope) || "10") + " " + (evalStr(s.named.unit, scope) || "MIN").toLowerCase().replace(/s$/, "") + "\n[Pipeline] {"); var okt = runSteps(s.block, scope, cwd); log("[Pipeline] }\n[Pipeline] // timeout"); return okt; }
      if (n === "retry") { var times = +(evalStr(s.args[0] || s.named.count, scope) || 1); for (var t = 1; t <= times; t++) { log("[Pipeline] {"); var keep = status.result; var okr = runSteps(s.block, scope, cwd); log("[Pipeline] }"); if (okr) { status.result = keep; log("[Pipeline] // retry"); return true; } if (t < times) { log("ERROR: script returned exit code 1\nRetrying"); status.result = keep; } } log("[Pipeline] // retry"); return false; }
      if (n === "catchError" || n === "warnError") { log("[Pipeline] {"); var keep2 = status.result; var okce = runSteps(s.block, scope, cwd); log("[Pipeline] }\n[Pipeline] // " + n); if (!okce) { status.result = keep2 === "SUCCESS" ? (strOf(s.named.buildResult) || (n === "warnError" ? "UNSTABLE" : "FAILURE")) : keep2; if (status.result === "UNSTABLE") status.unstable = true; } return true; }
      if (n === "script") { log("[Pipeline] {"); var oks = runSteps((s.block || []).filter(function (x) { return x.name !== "if" && x.name !== "for"; }), scope, cwd); log("[Pipeline] }\n[Pipeline] // script"); return oks; }
      if (n === "unstable") { plog("WARNING: " + evalStr(s.args[0] || s.named.message, scope)); status.unstable = true; return true; }
      if (n === "junit") {
        var pat = evalStr(s.args[0] || s.named.testResults, scope), allow = s.named.allowEmptyResults && s.named.allowEmptyResults.bool;
        var dirN = Dk.fsNode(agentSys, ws), files = [];
        (function walk(dn, rel) { if (!dn || dn.type !== "d") return; keys(dn.children).forEach(function (k2) { var cN = dn.children[k2], pth = rel ? rel + "/" + k2 : k2; if (cN.type === "d") walk(cN, pth); else if (globMatch(pat, pth)) files.push(cN.content); }); })(dirN, "");
        if (!files.length) { if (allow) { plog("None of the test reports contained any result"); return true; } plog("ERROR: No test report files were found. Configuration error?"); status.result = "FAILURE"; return false; }
        var tests = 0, fails = 0; files.forEach(function (x) { var m = /tests="(\d+)"/.exec(x), f = /failures="(\d+)"/.exec(x); tests += m ? +m[1] : 0; fails += f ? +f[1] : 0; });
        b.tests = { total: tests, failed: fails };
        plog("Recording test results\n[Checks API] No suitable checks publisher found.");
        if (fails) { status.unstable = true; plog("Test results: " + fails + " failed of " + tests); }
        return true;
      }
      if (n === "archiveArtifacts") { plog("Archiving artifacts"); b.artifacts = (b.artifacts || []).concat([evalStr(s.args[0] || s.named.artifacts, scope)]); return true; }
      if (n === "writeFile") { S.writeFile({ sys: agentSys, uid: 1001, gid: 1001, groups: [], cwd: cwd, umask: 18, vars: {} }, S.normAbs(cwd + "/" + evalStr(s.named.file, scope)), evalStr(s.named.text, scope), false); return true; }
      if (n === "stash" || n === "unstash" || n === "fileExists" || n === "readFile" || n === "build" || /^(mail|emailext|slackSend)$/.test(n)) { plog("(" + n + " is accepted but not simulated in this lab)"); return true; }
      return true;
    }
    function runPost(post, scope, cwd, label) {
      var res = status.result === "SUCCESS" && status.unstable ? "UNSTABLE" : status.result;
      var order = ["always", "changed", "fixed", "regression", "aborted", "failure", "success", "unstable", "unsuccessful", "cleanup"];
      var prev = (branchJob(job, br).builds.slice(-2, -1)[0] || {}).result;
      var any = order.filter(function (k) { return post[k]; });
      if (!any.length) return;
      log("[Pipeline] stage\n[Pipeline] { (Declarative: Post Actions" + (label ? ": " + label : "") + ")");
      order.forEach(function (k) {
        if (!post[k]) return;
        var hit = k === "always" || k === "cleanup" || (k === "success" && res === "SUCCESS") || (k === "failure" && res === "FAILURE") || (k === "unstable" && res === "UNSTABLE") || (k === "unsuccessful" && res !== "SUCCESS") || (k === "changed" && prev && prev !== res) || (k === "fixed" && res === "SUCCESS" && prev && prev !== "SUCCESS") || (k === "regression" && res !== "SUCCESS" && prev === "SUCCESS") || (k === "aborted" && res === "ABORTED");
        if (!hit) return;
        var keep = status.result; runSteps(post[k], scope, cwd); if (status.result === "FAILURE" && keep !== "FAILURE") status.result = "FAILURE";
      });
      log("[Pipeline] }\n[Pipeline] // stage");
    }
    // pipeline-level environment
    var scope = Object.assign({}, env);
    var envOk = true;
    P.env.forEach(function (e) { if (!envOk) return; var v = evalStr(e.value, scope); if (v && v.cred) { if (!bindCred(v.cred, "env", e.name, scope)) envOk = false; } else scope[e.name] = v; });
    var topAgent = pickAgent(P.agent);
    if (topAgent && topAgent.error) { log("[Pipeline] node\nStill waiting to schedule task\n" + topAgent.error + "\nAborted by kc-dev (the lab stopped waiting for an agent)\n[Pipeline] // node\n[Pipeline] End of Pipeline\nFinished: ABORTED"); b.result = "ABORTED"; return finish(); }
    if (topAgent) enterAgent(topAgent);
    if (P.env.length) log("[Pipeline] withEnv\n[Pipeline] {" + (P.env.some(function (e) { return e.value && e.value.call && e.value.call.name === "credentials"; }) ? "\n[Pipeline] withCredentials\nMasking supported pattern matches of " + P.env.filter(function (e) { return e.value && e.value.call && e.value.call.name === "credentials"; }).map(function (e) { return "$" + e.name + (J.creds[strOf(e.value.call.args[0])] && J.creds[strOf(e.value.call.args[0])].type === "usernamePassword" ? " or $" + e.name + "_USR or $" + e.name + "_PSW" : ""); }).join(" or ") + "\n[Pipeline] {" : ""));
    if (!envOk) status.result = "FAILURE";
    function runStage(st, scope0, depth) {
      var sScope = Object.assign({}, scope0), started = secs, rec = { name: st.name, status: "skipped", secs: 0, depth: depth };
      b.stages.push(rec);
      log("[Pipeline] stage\n[Pipeline] { (" + st.name + ")");
      if (status.result !== "SUCCESS" && !status.unstable || status.result === "FAILURE") { log("Stage \"" + st.name + "\" skipped due to earlier failure(s)\n[Pipeline] getContext\n[Pipeline] }\n[Pipeline] // stage"); rec.status = "skipped"; return; }
      if (st.when && !condOk(st.when, sScope)) { log("Stage \"" + st.name + "\" skipped due to when conditional\n[Pipeline] getContext\n[Pipeline] }\n[Pipeline] // stage"); rec.status = "skipped"; rec.when = true; return; }
      st.env.forEach(function (e) { var v = evalStr(e.value, sScope); if (v && v.cred) bindCred(v.cred, "env", e.name, sScope); else sScope[e.name] = v; });
      var savedAgent = agentSys, savedName = agentName;
      if (st.agent) { var ag = pickAgent(st.agent); if (ag && ag.error) { log("Still waiting to schedule task\n" + ag.error + "\nAborted by kc-dev (the lab stopped waiting for an agent)"); status.result = "ABORTED"; rec.status = "aborted"; log("[Pipeline] }\n[Pipeline] // stage"); return; } if (ag) enterAgent(ag); }
      if (st.parallel) {
        if (!st.sequential) log("[Pipeline] parallel");
        st.parallel.forEach(function (sub) { if (!st.sequential) log("[Pipeline] { (Branch: " + sub.name + ")"); runStage(sub, sScope, depth + 1); if (!st.sequential) log("[Pipeline] }"); });
        if (!st.sequential) log("[Pipeline] // parallel");
      } else {
        var ok = runSteps(st.steps, sScope, ws || "/");
        if (!ok && status.result === "SUCCESS") status.result = "FAILURE";
      }
      runPost(st.post, sScope, ws || "/", st.name);
      rec.status = status.result === "FAILURE" ? "failed" : status.unstable ? "unstable" : "success";
      rec.secs = Math.max(1, secs - started);
      if (st.agent && agentSys !== savedAgent) { log("[Pipeline] }\n[Pipeline] // node"); agentSys = savedAgent; agentName = savedName; if (savedAgent) { ws = env.WORKSPACE; } }
      log("[Pipeline] }\n[Pipeline] // stage");
    }
    P.stages.forEach(function (st) { if (!status.fatal) runStage(st, scope, 0); });
    if (!status.fatal) runPost(P.post, scope, ws || "/", null);
    if (P.env.length) log((P.env.some(function (e) { return e.value && e.value.call && e.value.call.name === "credentials"; }) ? "[Pipeline] }\n[Pipeline] // withCredentials\n" : "") + "[Pipeline] }\n[Pipeline] // withEnv");
    if (topAgent) log("[Pipeline] }\n[Pipeline] // node");
    log("[Pipeline] End of Pipeline");
    b.result = status.result === "SUCCESS" && status.unstable ? "UNSTABLE" : status.result;
    log("Finished: " + b.result);
    return finish();
    function finish() { b.duration = secs + 6; b.agent = agentName; CI.jenkinsLast = b; (CI.hubOf(sys).ciEvents = CI.hubOf(sys).ciEvents || []).push({ system: "jenkins", job: job.name, branch: br, number: b.number, t: now(sys), cmd: CI.homeSys(sys).cmdIndex }); return b; }
  }
  CI.jenkinsBuild = build;

  /* ================================================================== jenkins-cli */
  function findJob(J, spec) { var p = String(spec || "").split("/"); var job = J.jobs[p[0]]; return { job: job, branch: p[1] || null }; }
  CMDS.jenkinscli = function (args, io, sess) {
    var a = args.slice(1), sys = sess.sys, J = jenkins(sys), sub = null, rest = [];
    var auth = null;
    for (var i = 0; i < a.length; i++) { if (a[i] === "-s" && !sub) { i++; continue; } if (a[i] === "-auth" && !sub) { auth = a[++i] || ""; continue; } if ((a[i] === "-webSocket" || a[i] === "-http") && !sub) continue; if (!sub) sub = a[i]; else rest.push(a[i]); }
    // Credentials: -auth user:token or -auth @file, else $JENKINS_USER_ID/$JENKINS_API_TOKEN, else the wrapper's ~/.jenkins-cli file
    var user = S.getVar(sess, "JENKINS_USER_ID"), tok = S.getVar(sess, "JENKINS_API_TOKEN");
    function rd(pth) { var x = pth.replace(/^~(?=\/|$)/, sess.home); var n = Dk.fsNode(sys, S.normAbs(x.charAt(0) === "/" ? x : sess.cwd + "/" + x)); return n && n.type === "f" ? String(n.content) : null; }
    if (auth != null) { var av = auth.charAt(0) === "@" ? rd(auth.slice(1)) : auth; if (av == null) { errl(io, "ERROR: " + auth.slice(1) + " (No such file or directory)"); return 1; } av = av.trim(); user = av.split(":")[0]; tok = av.split(":").slice(1).join(":"); }
    else if (!user || !tok) { var cf = rd("~/.jenkins-cli"); if (cf) cf.split("\n").forEach(function (l) { var m = /^\s*(?:export\s+)?(JENKINS_USER_ID|JENKINS_API_TOKEN)=["']?([^"'\s]*)/.exec(l); if (m) { if (m[1] === "JENKINS_USER_ID" && !user) user = m[2]; if (m[1] === "JENKINS_API_TOKEN" && !tok) tok = m[2]; } }); }
    if (!sub || sub === "help") { out(io, "  build\n    Builds a job, and optionally waits until its completion.\n  console\n    Retrieves console output of a build.\n  declarative-linter\n    Validate a Jenkinsfile containing a Declarative Pipeline\n  list-jobs\n    Lists all jobs in a specific view or item group.\n  who-am-i\n    Reports your credential and permissions.\n"); return 0; }
    if (!user || !tok) { errl(io, "ERROR: anonymous is missing the Overall/Read permission"); return 6; }
    if (!J.users[user] || J.users[user].token !== tok) { errl(io, "ERROR: Invalid username or API token for " + user + " (HTTP 401)"); return 6; }
    if (sub === "who-am-i") { out(io, "Authenticated as: " + user + "\nAuthorities:\n  authenticated\n  kestrel*devs\n"); return 0; }
    if (sub === "declarative-linter") { var text = io.stdin || ""; if (!text.trim()) { errl(io, "ERROR: No Jenkinsfile given: run jenkins-cli declarative-linter < Jenkinsfile"); return 1; } var res = parseJenkinsfile(text); if (res.errors.length) { out(io, "Errors encountered validating Jenkinsfile:\n" + res.errors.join("\n") + "\n\n"); return 1; } out(io, "Jenkinsfile successfully validated.\n"); return 0; }
    if (sub === "list-jobs") { if (rest[0]) { var j0 = J.jobs[rest[0]]; if (!j0) { errl(io, "ERROR: No view or item group with the given name '" + rest[0] + "' found."); return 3; } out(io, keys(j0.branches).sort().map(function (k) { return k + "\n"; }).join("")); return 0; } out(io, keys(J.jobs).map(function (k) { return k + "\n"; }).join("")); return 0; }
    if (sub === "build") {
      var wait = rest.indexOf("-s") >= 0 || rest.indexOf("-f") >= 0, verbose = rest.indexOf("-v") >= 0, spec = rest.filter(function (x) { return !/^-/.test(x); })[0];
      var fj = findJob(J, spec);
      if (!fj.job || !fj.branch) { errl(io, "ERROR: No such job '" + (spec || "") + "' (a multibranch job's branches are JOB/BRANCH, e.g. notes-api/main)"); return 3; }
      var sha = (GH.find(sys, fj.job.repo) || { refs: {} }).refs["refs/heads/" + fj.branch];
      if (!sha) { errl(io, "ERROR: No such job '" + spec + "'; perhaps you meant 'notes-api/main'?"); return 3; }
      var b = build(sys, fj.job, fj.branch, sha, "user Dev (kc-dev)");
      out(io, "Started " + fj.job.name + " » " + fj.branch + " #" + b.number + "\n");
      if (verbose) out(io, b.console.join("\n") + "\n");
      if (wait) { out(io, "Completed " + fj.job.name + " » " + fj.branch + " #" + b.number + " : " + b.result + "\n"); return b.result === "SUCCESS" ? 0 : b.result === "UNSTABLE" ? 1 : 1; }
      return 0;
    }
    if (sub === "console") {
      var ni0 = rest.indexOf("-n"), pos = rest.filter(function (x, i) { return !/^-/.test(x) && !(ni0 >= 0 && i === ni0 + 1); });
      var fj2 = findJob(J, pos[0]), nn = pos.filter(function (x) { return /^\d+$/.test(x); })[0];
      if (!fj2.job || !fj2.branch || !fj2.job.branches[fj2.branch]) { errl(io, "ERROR: No such job '" + (rest[0] || "") + "'"); return 3; }
      var bs = fj2.job.branches[fj2.branch].builds, bb = nn ? bs.filter(function (x) { return x.number === +nn; })[0] : bs[bs.length - 1];
      if (!bb) { errl(io, "ERROR: No such build #" + (nn || "lastBuild")); return 3; }
      var lines = bb.console, ni = rest.indexOf("-n"); if (ni >= 0) lines = lines.slice(-+rest[ni + 1]);
      out(io, lines.join("\n") + "\n"); return 0;
    }
    errl(io, "ERROR: No such command " + sub + ". Available commands are above."); return 255;
  };
  if (M2.net && M2.net.SITES) {
    M2.net.DNS["jenkins.kestrel.io"] = { A: ["203.0.113.90"] };
    M2.net.HOSTS["203.0.113.90"] = { ping: 5.1, ports: [443], site: "kestrel-jenkins" };
    M2.net.SITES["kestrel-jenkins"] = function (req, sys) { var J = jenkins(sys); if (/^\/login/.test(req.path) || req.path === "/") return { status: 200, headers: { "Content-Type": "text/html;charset=utf-8", "X-Jenkins": "2.479.1", Server: "Jetty(12.0.13)" }, body: "<!doctype html><html><head><title>Dashboard [Jenkins]</title></head><body>Jenkins 2.479.1 · " + keys(J.jobs).length + " job(s)</body></html>\n" }; return { status: 403, headers: { "Content-Type": "text/html", "X-Jenkins": "2.479.1" }, body: "<html><body>Authentication required</body></html>\n" }; };
  }
})(typeof window !== "undefined" ? window : globalThis);
