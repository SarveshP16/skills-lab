/* sudo learn — DevOps Module 3 lab world: the laptop kc-dev-01 with an AWS profile for the staging account
   (210987654321, eu-west-1), Terraform, the aws CLI, Ansible, Vault, Checkov and ansible-lint, an SSH key that
   the on-prem servers web-1, web-2 and db-1 (user ansible, passwordless sudo) trust, and — for the pipeline labs
   — the kestrel/infra repository on the simulated GitHub. Check helpers are in IAC.H. */
(function (root) {
  "use strict";
  var S = root.ShEngine, M2 = S.M2, CI = root.CI, GH = root.GitHub, G = root.GitCore, IAC = root.IAC, Dk = root.Dk;
  function keys(o) { return o ? Object.keys(o) : []; }
  var HOME = "/home/dev";
  IAC.HOME = HOME;
  IAC.INFRA_REPO = "kestrel/infra";
  var BINS = { terraform: "terraform", aws: "aws", ansible: "ansible", "ansible-playbook": "ansibleplaybook", "ansible-inventory": "ansibleinventory", "ansible-galaxy": "ansiblegalaxy", "ansible-vault": "ansiblevault", "ansible-lint": "ansiblelint", checkov: "checkov", vault: "vault" };
  function put(sys, path, text, mode) {
    S.mkdirs(sys, path.replace(/\/[^/]*$/, ""), 493, 1000, 1000); S.put(sys, path, text, mode || 420, 1000, 1000);
    // every folder below the home directory belongs to dev, whoever made it first
    var parts = path.replace(HOME + "/", "").split("/").slice(0, -1), cur = HOME;
    parts.forEach(function (p) { cur += "/" + p; var n = Dk.fsNode(sys, cur); if (n) { n.uid = 1000; n.gid = 1000; } });
  }
  IAC.put = put;
  function files(sys, base, map) { keys(map).forEach(function (k) { if (map[k] == null) return; put(sys, base + "/" + k, map[k]); }); }
  IAC.files = files;
  // the laptop: tools, AWS profile, SSH key trusted by the servers
  IAC.base = function (sys, o) {
    o = o || {};
    keys(BINS).forEach(function (b) { CI.putBin(sys, "/usr/local/bin/" + b, BINS[b]); });
    IAC.laptopCreds(sys);
    var r = CI.runScript(sys, "dev", HOME, { HOME: HOME }, "ssh-keygen -t ed25519 -N '' -C dev@kc-dev-01 -f ~/.ssh/id_ed25519 -q > /dev/null 2>&1", { errexit: false, xtrace: false });
    void r;
    S.put(sys, "/etc/hosts", (S.readSys(sys, "/etc/hosts") || "127.0.0.1 localhost\n") + keys(IAC.SERVERS).map(function (n) { return IAC.SERVERS[n] + " " + n + ".kestrel.internal " + n; }).join("\n") + "\n", 420, 0, 0);
    var pub = S.readSys(sys, HOME + "/.ssh/id_ed25519.pub");
    sys.remoteSetup = sys.remoteSetup || {};
    keys(IAC.SERVERS).forEach(function (n) { sys.remoteSetup[n] = function (m) { S.mkdirs(m, "/home/ansible/.ssh", 448, 1001, 1001); S.put(m, "/home/ansible/.ssh/authorized_keys", pub || "", 384, 1001, 1001); if (o.serverSetup) o.serverSetup(n, m); }; });
    IAC.aws(sys).netInit = false; IAC.syncNet(sys);
    if (o.vault !== false) { S.put(sys, HOME + "/.vault-token", IAC.vaultToken(sys, ["root"], { display_name: "kc-dev" }), 384, 1000, 1000); S.put(sys, HOME + "/.bashrc", (S.readSys(sys, HOME + "/.bashrc") || "") + "\nexport VAULT_ADDR=" + IAC.VAULT_ADDR + "\n", 420, 1000, 1000); }
  };
  // a whole lab world: o.files {path: text} under ~, o.cloud(sys) makes AWS objects, o.repo for kestrel/infra
  IAC.world = function (o) {
    o = o || {};
    return CI.world({ clone: false, tag: false, admin: true, after: function (sys, r) {
      IAC.base(sys, o);
      if (o.cloud) o.cloud(sys);
      if (o.files) files(sys, HOME, o.files);
      if (o.repo) {
        GH.seed(sys, IAC.INFRA_REPO, { steps: [{ msg: o.repo.msg || "infra: staging", by: "maya", at: "2026-11-02 10:00", files: o.repo.files }].concat(o.repo.steps || []) }, { description: "Kestrel's infrastructure as code" });
        var x = GH.find(sys, IAC.INFRA_REPO); x.collab["kc-dev"] = "admin";
        if (o.repo.envs) { x.envs = x.envs || {}; keys(o.repo.envs).forEach(function (n) { x.envs[n] = { name: n, secrets: {}, vars: {}, reviewers: o.repo.envs[n].reviewers || [], branches: null, created: 0 }; }); }
        if (o.repo.clone !== false) GH.cloneTo(sys, IAC.INFRA_REPO, HOME + "/infra");
      }
      if (o.after) o.after(sys);
      IAC.syncNet(sys);
    } });
  };
  // common cloud pieces
  IAC.stateBucket = function (sys) { return IAC.make(sys, "aws_s3_bucket", { bucket: "kestrel-tfstate-" + IAC.ACCOUNT, tags: { Purpose: "terraform-state" } }); };
  IAC.oidcProvider = function (sys) { return IAC.make(sys, "aws_iam_openid_connect_provider", { url: "https://token.actions.githubusercontent.com", client_id_list: ["sts.amazonaws.com"] }); };

  /* ================================================================== check helpers */
  var H = IAC.H = {
    A: function (r) { return IAC.aws(r.sys); },
    all: function (r, type) { return IAC.all(IAC.aws(r.sys), type); },
    find: function (r, type, fn) { return IAC.find(IAC.aws(r.sys), type, fn); },
    bucket: function (r, name) { return IAC.find(IAC.aws(r.sys), "aws_s3_bucket", function (b) { return b.bucket === name; }); },
    sub: function (r, type, bucket) { return IAC.find(IAC.aws(r.sys), type, function (b) { return b.bucket === bucket; }); },
    events: function (r, kind) { return IAC.aws(r.sys).events.filter(function (e) { return !kind || (kind instanceof RegExp ? kind.test(e.kind) : e.kind === kind); }); },
    state: function (r, dir) { return IAC.stateOf(r.sys, dir.replace(/^~/, HOME)); },
    s3state: function (r, key) { return IAC.stateFromS3(r.sys, "kestrel-tfstate-" + IAC.ACCOUNT, key); },
    cfg: function (r, dir) { var sess = S.newSession(r.sys, { user: "dev" }); var fs = { read: function (p) { var x = S.readFile(sess, p); return x.error ? null : x.content; }, list: function (d) { var n = Dk.fsNode(r.sys, d); return n && n.type === "d" ? keys(n.children).sort() : null; }, isDir: function (d) { var n = Dk.fsNode(r.sys, d); return !!n && n.type === "d"; } }; try { return IAC.loadConfig(fs, dir.replace(/^~/, HOME)); } catch (e) { return null; } },
    res: function (cfg, type) { return cfg ? cfg.resources.filter(function (x) { return x.type === type && x.mode === "managed"; }) : []; },
    tfText: function (r, dir) { var d = dir.replace(/^~/, HOME), n = Dk.fsNode(r.sys, d); if (!n || n.type !== "d") return ""; return keys(n.children).filter(function (f) { return /\.tf$/.test(f); }).map(function (f) { return String(n.children[f].content); }).join("\n"); },
    machine: function (r, name) { var ip = IAC.SERVERS[name] || name; var home = CI.homeSys(r.sys); return (home.net && home.net.byIp && home.net.byIp[ip]) || null; },
    machineOf: function (r, inst) { return IAC.aws(r.sys).machines[inst.id] || null; },
    sh: function (m, cmd) { if (!m) return { code: 1, text: "" }; return CI.runScript(m, "root", "/", { HOME: "/root" }, cmd, { errexit: false, xtrace: false }); },
    active: function (m, unit) { return !!m && /^active/.test(H.sh(m, "systemctl is-active " + unit).text); },
    enabled: function (m, unit) { return !!m && /^enabled/.test(H.sh(m, "systemctl is-enabled " + unit).text); },
    pkg: function (m, name) { return !!(m && m.pkgs && m.pkgs[name] && m.pkgs[name].installed); },
    file: function (m, p) { var n = m && Dk.fsNode(m, p); return n && n.type === "f" ? String(n.content) : null; },
    node: function (m, p) { return m ? Dk.fsNode(m, p) : null; },
    runs: function (r) { return CI.hubOf(r.sys).ansibleRuns || []; },
    vault: function (r) { return IAC.vault(r.sys); },
    out: function (e) { return e.out.join("\n"); },
    all_: function (e) { return e.lines.map(function (l) { return l.text; }).join("\n"); },
    ran: function (r, re, fn) { return r.history.some(function (e) { return re.test(e.cmd) && (!fn || fn(e)); }); },
    idx: function (r, re, fn) { var k = -1; r.history.forEach(function (e, i) { if (re.test(e.cmd) && (!fn || fn(e))) k = i; }); return k; },
    yaml: function (r, path) { var t = r.read(path.replace(/^~/, HOME)); if (t == null) return null; try { return root.DevYaml.parse(t.replace(/:\s*!vault\s*\|/g, ": |")); } catch (e) { return null; } }
  };

  /* ================================================================== explanations for Module 3's errors */
  var SL = root.ShLab;
  if (SL && SL.EXPLAIN) [
    [/Error acquiring the state lock/, "Someone else's Terraform run holds the lock (the Lock Info says who and since when). Wait for it, or if that run is really dead: terraform force-unlock LOCK_ID."],
    [/Backend initialization required|Inconsistent dependency lock file|Required plugins are not installed|Module not installed/, "This folder needs terraform init: after adding a provider, a module or a backend (and after changing the backend, terraform init -migrate-state)."],
    [/Unsupported argument|An argument named .* is not expected here/, "That resource type has no argument with that name: check the spelling against the provider's documentation (aws_s3_bucket takes tags, not tag)."],
    [/Reference to undeclared (resource|input variable)/, "Terraform can't find what this expression refers to: declare the variable (variable \"name\" {}) or check the resource's type and name."],
    [/Invalid value for variable/, "A validation rule on that variable rejected the value: its error message says what's allowed."],
    [/No valid credential sources found|InvalidClientTokenId|ExpiredToken/, "Terraform and the aws CLI couldn't find working AWS credentials: check aws sts get-caller-identity, AWS_PROFILE, or the role your pipeline assumed."],
    [/is not authorized to perform/, "The identity running this (aws sts get-caller-identity) has no IAM permission for that action. Plans run with a read-only role on purpose: changes go through the apply job."],
    [/BucketAlreadyExists|BucketAlreadyOwnedByYou|EntityAlreadyExists|InvalidGroup\.Duplicate/, "Something with that name already exists outside this state. If it should be managed here, import it (import block or terraform import) instead of creating it."],
    [/Not authorized to perform sts:AssumeRoleWithWebIdentity/, "The role's trust policy didn't accept this job's OIDC token: compare its sub condition with the job (repo:OWNER/REPO:pull_request, :ref:refs/heads/BRANCH or :environment:NAME)."],
    [/Unable to get ACTIONS_ID_TOKEN_REQUEST_URL|Did you mean to set the `id-token` permission/, "The job can't ask GitHub for an OIDC token: give it permissions: id-token: write."],
    [/UNREACHABLE!/, "Ansible couldn't SSH to that host: check ansible_host in the inventory, remote_user in ansible.cfg and that your key is authorised (ssh USER@HOST)."],
    [/Missing sudo password|FAILED! => .*You need to be root/, "That task needs root on the server: add become: true to the play (or -b for an ad-hoc command)."],
    [/The task includes an option with an undefined variable|AnsibleUndefinedVariable|FAILED! => .*is undefined/, "A template or task used a variable that isn't set for this host: check group_vars/host_vars, role defaults and the spelling."],
    [/No package matching .* is available/, "apt doesn't know that package yet: add update_cache: true to the apt task (apt-get update), and check the package name."],
    [/Attempting to decrypt but no vault secrets found/, "Some vars are encrypted with ansible-vault: run with --vault-password-file FILE (or --ask-vault-pass)."],
    [/\* permission denied/, "Vault refused: the token's policies don't grant that capability on that path (vault token lookup shows its policies; KV v2 data lives under secret/data/...)."],
    [/Check: CKV2?_AWS_\d+/, "Checkov found a misconfiguration: fix it in the resource, or if the check really doesn't apply, add #checkov:skip=ID:reason inside that resource."]
  ].reverse().forEach(function (e) { SL.EXPLAIN.unshift(e); });
})(typeof window !== "undefined" ? window : globalThis);
