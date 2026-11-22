/* sudo learn — DevOps Module 3: infrastructure pipelines on the simulated GitHub Actions. hashicorp/setup-terraform
   installs Terraform on the runner; aws-actions/configure-aws-credentials swaps the job's GitHub OIDC token for
   temporary AWS credentials by assuming an IAM role, checked against the role's trust policy (the OIDC provider,
   the audience, and the `sub` claim: branch, pull_request or environment) — no stored keys; the role's attached
   policies decide what Terraform may then do. bridgecrewio/checkov-action runs Checkov as a gate. */
(function (root) {
  "use strict";
  var S = root.ShEngine, M2 = S.M2, CMDS = S.CMDS, CI = root.CI, A = root.GitActions, IAC = root.IAC, G = root.GitCore;
  function keys(o) { return o ? Object.keys(o) : []; }
  CI.addActionRepos({
    "hashicorp/setup-terraform": { v: ["v3.0.0", "v3.1.2"], desc: "Sets up Terraform CLI in your GitHub Actions workflow." },
    "aws-actions/configure-aws-credentials": { v: ["v4.0.1", "v4.0.2"], desc: "Configure AWS credential environment variables for use in other GitHub Actions." },
    "bridgecrewio/checkov-action": { v: ["v12.2896.0", "v12.2918.0"], desc: "This GitHub Action runs Checkov against an Infrastructure-as-Code repository." }
  });
  A.envHooks.push(function (J) { if (!J.rs.iacTools) { J.rs.iacTools = true; CI.putBin(J.rs, "/usr/local/bin/aws", "aws"); CI.putBin(J.rs, "/usr/bin/ansible", "ansible"); CI.putBin(J.rs, "/usr/bin/ansible-playbook", "ansibleplaybook"); CI.putBin(J.rs, "/usr/bin/ansible-lint", "ansiblelint"); } });

  A.action("hashicorp/setup-terraform", { run: function (J, s, w) {
    var v = String(w.terraform_version || "1.10.5");
    CI.putBin(J.rs, "/home/runner/work/_tool/terraform/" + v + "/x64/terraform", "terraform");
    J.pathAdd.push("/home/runner/work/_tool/terraform/" + v + "/x64");
    J.log(s, "Downloading Terraform CLI from https://releases.hashicorp.com/terraform/" + v + "/terraform_" + v + "_linux_amd64.zip\nExtracting Terraform CLI zip file\nAdding Terraform to path");
    return { code: 0, secs: 2 };
  } });

  // the role a workflow may assume: its trust policy against the OIDC claims of this job
  function trustOk(Acct, role, claims) {
    var doc; try { doc = JSON.parse(role.assume_role_policy || "{}"); } catch (e) { return "the role's trust policy isn't valid JSON"; }
    var prov = IAC.find(Acct, "aws_iam_openid_connect_provider", function (p) { return /token\.actions\.githubusercontent\.com\/?$/.test(p.url); });
    if (!prov) return "No OpenIDConnect provider found in your account for https://token.actions.githubusercontent.com";
    if ((prov.client_id_list || []).indexOf("sts.amazonaws.com") < 0) return "Incorrect token audience";
    var ok = [].concat(doc.Statement || []).some(function (st) {
      if (st.Effect !== "Allow") return false;
      if ([].concat(st.Action || []).indexOf("sts:AssumeRoleWithWebIdentity") < 0) return false;
      var fed = st.Principal && st.Principal.Federated; if (!fed || [].concat(fed).indexOf(prov.arn) < 0) return false;
      var c = st.Condition || {};
      var conds = [];
      keys(c).forEach(function (test) { keys(c[test]).forEach(function (k) { conds.push({ test: test, key: k, vals: [].concat(c[test][k]) }); }); });
      if (!conds.some(function (x) { return /:sub$/.test(x.key); })) return true; // (no sub condition: Checkov CKV_AWS_358 flags this)
      return conds.every(function (x) {
        var claim = /:sub$/.test(x.key) ? claims.sub : /:aud$/.test(x.key) ? "sts.amazonaws.com" : /:repository$/.test(x.key) ? claims.repository : null;
        if (claim == null) return true;
        if (/StringLike/.test(x.test)) return x.vals.some(function (p) { return new RegExp("^" + String(p).replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".") + "$").test(claim); });
        return x.vals.indexOf(claim) >= 0;
      });
    });
    return ok ? null : "Not authorized to perform sts:AssumeRoleWithWebIdentity";
  }
  IAC.trustOk = trustOk;
  function permsOf(Acct, role) {
    var att = IAC.all(Acct, "aws_iam_role_policy_attachment").filter(function (x) { return x.role === role.name; }).map(function (x) { return x.policy_arn; });
    var inl = IAC.all(Acct, "aws_iam_role_policy").filter(function (x) { return x.role === role.name; }).map(function (x) { return x.policy; }).join(" ");
    if (att.some(function (p) { return /AdministratorAccess$|PowerUserAccess$/.test(p); }) || /"Action"\s*:\s*"\*"/.test(inl)) return "admin";
    if (att.some(function (p) { return /ReadOnlyAccess$/.test(p); })) return /s3:PutObject|s3:\*/.test(inl) ? "plan" : "readonly";
    if (/s3:PutObject|s3:\*/.test(inl)) return "plan";
    return "none";
  }
  IAC.rolePerms = permsOf;
  A.action("aws-actions/configure-aws-credentials", { run: function (J, s, w) {
    var Acct = IAC.aws(J.sys), roleArn = String(w["role-to-assume"] || ""), region = String(w["aws-region"] || "");
    if (!region) { J.log(s, "##[error]Input required and not supplied: aws-region"); J.annotate("error", "Input required and not supplied: aws-region"); return { code: 1, secs: 1 }; }
    if (w["aws-access-key-id"]) {
      var kid = String(w["aws-access-key-id"]), idn = Acct.identities[kid];
      if (!idn) { J.log(s, "##[error]The security token included in the request is invalid."); J.annotate("error", "The security token included in the request is invalid."); return { code: 1, secs: 1 }; }
      J.envJob.AWS_ACCESS_KEY_ID = kid; J.envJob.AWS_SECRET_ACCESS_KEY = String(w["aws-secret-access-key"] || ""); J.envJob.AWS_REGION = region; J.envJob.AWS_DEFAULT_REGION = region;
      J.rs.awsIdentity = idn; J.addMask(String(w["aws-secret-access-key"] || ""));
      J.log(s, "##[warning]Long-lived access keys found in the workflow. Prefer role-to-assume with GitHub's OIDC provider."); J.annotate("warning", "Long-lived AWS access keys are used: prefer OIDC with role-to-assume");
      return { code: 0, secs: 1 };
    }
    if (!roleArn) { J.log(s, "##[error]Credentials could not be loaded, please check your action inputs: Could not load credentials from any providers"); J.annotate("error", "Credentials could not be loaded, please check your action inputs: Could not load credentials from any providers"); return { code: 1, secs: 1 }; }
    var hb = {}; A.envHooks.forEach(function (fn) { fn(J, hb); }); var tok = hb.ACTIONS_ID_TOKEN_REQUEST_TOKEN, st = A.svc(J.sys), claims = tok && st.oidcReq ? st.oidcReq[tok] : null;
    J.log(s, "Assuming role with OIDC");
    if (!claims) { J.log(s, "##[error]Could not assume role with OIDC: Error: Unable to get ACTIONS_ID_TOKEN_REQUEST_URL env variable"); J.annotate("error", "It looks like you might be trying to authenticate with OIDC. Did you mean to set the `id-token` permission? If you are not trying to authenticate with OIDC and the action is working successfully, you can ignore this message."); return { code: 1, secs: 1 }; }
    var name = roleArn.replace(/^arn:aws:iam::\d+:role\/(.*\/)?/, ""), role = IAC.find(Acct, "aws_iam_role", function (r) { return r.name === name; });
    var why = !role ? "Not authorized to perform sts:AssumeRoleWithWebIdentity" : trustOk(Acct, role, claims);
    if (why) { J.log(s, "##[error]Could not assume role with OIDC: " + why); J.annotate("error", "Could not assume role with OIDC: " + why); IAC.ev(J.sys, { kind: "oidc-denied", role: name, sub: claims.sub }); return { code: 1, secs: 2 }; }
    var sessName = String(w["role-session-name"] || "GitHubActions");
    var key = "ASIA" + M2.hashChars("asia" + J.run.id + J.job.id, 16, "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"), sec = M2.hashChars("sec" + J.run.id + J.job.id, 40, "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"), stok = "IQoJb3JpZ2luX2VjE" + M2.hashChars("sts" + J.run.id + J.job.id, 180, "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/");
    var idn2 = { name: name + "/" + sessName, arn: "arn:aws:sts::" + Acct.account + ":assumed-role/" + name + "/" + sessName, userId: role.unique_id + ":" + sessName, kind: "role", role: name, session: sessName, perms: permsOf(Acct, role), sub: claims.sub };
    Acct.roleSessions[stok] = idn2;
    J.envJob.AWS_ACCESS_KEY_ID = key; J.envJob.AWS_SECRET_ACCESS_KEY = sec; J.envJob.AWS_SESSION_TOKEN = stok; J.envJob.AWS_REGION = region; J.envJob.AWS_DEFAULT_REGION = region;
    J.addMask(sec); J.addMask(stok);
    J.log(s, "Authenticated as assumedRoleId " + role.unique_id + ":" + sessName);
    IAC.ev(J.sys, { kind: "oidc-assume", role: name, sub: claims.sub, perms: idn2.perms });
    return { code: 0, secs: 2 };
  } });
  A.action("bridgecrewio/checkov-action", { run: function (J, s, w) {
    var args = ["checkov", "-d", String(w.directory || ".")];
    if (w.framework) args.push("--framework", String(w.framework));
    if (w.check) args.push("--check", String(w.check));
    if (w.skip_check) args.push("--skip-check", String(w.skip_check));
    if (String(w.soft_fail) === "true") args.push("--soft-fail");
    if (w.output_format) args.push("-o", String(w.output_format).split(",")[0]);
    if (String(w.quiet) === "true") args.push("--quiet");
    var sess = J.shell(J.env(), J.ws), buf = [], io = { stdin: "", out: function (t) { buf.push(t); }, err: function (t) { buf.push(t); }, note: function () {} };
    var code = CMDS.checkov(args, io, sess);
    J.log(s, buf.join("").replace(/\n$/, ""));
    if (code) { J.annotate("error", "Checkov found failed checks"); return { code: code, secs: 6 }; }
    return { code: 0, secs: 6 };
  } });
})(typeof window !== "undefined" ? window : globalThis);
