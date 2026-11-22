/* sudo learn — DevOps Module 3: a simulated AWS account for infrastructure as code. Resources are kept in the
   shape Terraform's AWS provider uses (so Terraform, the aws CLI and drift all see the same objects), shared by
   the laptop and CI runners through the simulated GitHub hub. EC2 instances are real machines (Linux engine) you
   can ssh into, reachable only when the VPC routes and the security group allow it. Identities (the laptop's
   profile, roles assumed by GitHub Actions through OIDC) decide what each caller may do. */
(function (root) {
  "use strict";
  var S = root.ShEngine, M2 = S.M2, CMDS = S.CMDS, U = S.util, CI = root.CI, G = root.GitCore;
  var out = U.out, errl = U.errl;
  function keys(o) { return o ? Object.keys(o) : []; }
  function clone(o) { return o === undefined ? undefined : JSON.parse(JSON.stringify(o)); }
  var IAC = root.IAC = root.IAC || {};
  var ACCOUNT = "210987654321", REGION = "eu-west-1", OFFICE_IP = "203.0.113.15";
  IAC.ACCOUNT = ACCOUNT; IAC.REGION = REGION; IAC.OFFICE_IP = OFFICE_IP;
  function now(sys) { return G.clock(CI.homeSys(sys)); }
  function hx(seed, n) { return M2.hexOf("aws:" + seed, n || 17); }

  /* ================================================================== the account */
  function aws(sys) {
    var h = CI.hubOf(sys);
    if (!h.aws) h.aws = { account: ACCOUNT, region: REGION, seq: 0, res: {}, events: [], ipSeq: {}, pubSeq: 0, machines: {}, taken: { "kestrel-notes": 1, "kestrel-backups": 1, "terraform-state": 1 }, identities: {}, roleSessions: {} };
    return h.aws;
  }
  IAC.aws = aws;
  function bag(A, type) { return A.res[type] = A.res[type] || {}; }
  IAC.bag = bag;
  function all(A, type) { var b = A.res[type] || {}; return keys(b).map(function (k) { return b[k]; }); }
  IAC.all = all;
  function find(A, type, fn) { return all(A, type).filter(fn)[0] || null; }
  IAC.find = find;
  function ev(sys, e) { var A = aws(sys); e.t = now(sys); e.cmd = CI.homeSys(sys).cmdIndex; e.by = e.by || callerName(sys); e.where = sys.isRunner ? "actions" : "laptop"; A.events.push(e); }
  IAC.ev = ev;
  function callerName(sys) { return sys.awsIdentity ? sys.awsIdentity.name : "kc-dev"; }
  function newId(A, prefix, seed) { A.seq++; return prefix + "-0" + hx(prefix + seed + A.seq, 16); }
  IAC.newId = newId;
  function ipn(ip) { return String(ip).split(".").reduce(function (a, b) { return a * 256 + (+b); }, 0); }
  function nip(n) { return [n >>> 24 & 255, n >>> 16 & 255, n >>> 8 & 255, n & 255].join("."); }
  function inCidr(ip, c) { if (!c) return false; var m = String(c).split("/"), p = +(m[1] == null ? 32 : m[1]); if (p === 0) return true; var sz = Math.pow(2, 32 - p); return Math.floor(ipn(ip) / sz) === Math.floor(ipn(m[0]) / sz); }
  IAC.inCidr = inCidr; IAC.ipn = ipn; IAC.nip = nip;
  function validCidr(c) { var m = /^(\d+)\.(\d+)\.(\d+)\.(\d+)\/(\d+)$/.exec(String(c || "")); return !!m && [1, 2, 3, 4].every(function (k) { return +m[k] <= 255; }) && +m[5] <= 32 && ipn(m[1] + "." + m[2] + "." + m[3] + "." + m[4]) % Math.pow(2, 32 - +m[5]) === 0; }
  IAC.validCidr = validCidr;
  function cidrSub(base, newbits, num) {
    var m = String(base).split("/"), p = +m[1], np = p + newbits;
    if (np > 32) throw new Error("insufficient address space to extend prefix of " + p + " by " + newbits);
    if (num >= Math.pow(2, newbits)) throw new Error("prefix extension of " + newbits + " does not accommodate a subnet numbered " + num);
    return nip(ipn(m[0]) + num * Math.pow(2, 32 - np)) + "/" + np;
  }
  IAC.cidrSub = cidrSub;
  function arn(svc, rest, region) { return "arn:aws:" + svc + ":" + (region === false ? "" : REGION) + ":" + (svc === "s3" ? "" : ACCOUNT) + ":" + rest; }
  IAC.arn = arn;
  var AZS = ["eu-west-1a", "eu-west-1b", "eu-west-1c"];
  IAC.AZS = AZS;
  var AMIS = [
    { id: "ami-0e9085e60087ce171", name: "ubuntu/images/hvm-ssd-gp3/ubuntu-noble-24.04-amd64-server-20241109", owner: "099720109477", created: "2026-11-09T00:00:00.000Z" },
    { id: "ami-0d64bb532e0502c46", name: "ubuntu/images/hvm-ssd-gp3/ubuntu-noble-24.04-amd64-server-20241016", owner: "099720109477", created: "2026-10-16T00:00:00.000Z" },
    { id: "ami-0a094c309b87cc107", name: "ubuntu/images/hvm-ssd/ubuntu-jammy-22.04-amd64-server-20241002", owner: "099720109477", created: "2026-10-02T00:00:00.000Z" },
    { id: "ami-0c38b837cd80f13bb", name: "al2023-ami-2023.6.20241111.0-kernel-6.1-x86_64", owner: "137112412989", created: "2026-11-11T00:00:00.000Z" }
  ];
  IAC.AMIS = AMIS;
  var TYPES = { "t3.micro": 1, "t3.small": 1, "t3.medium": 1, "t3.large": 1, "t2.micro": 1, "m5.large": 1, "c5.large": 1 };
  IAC.INSTANCE_TYPES = TYPES;

  /* ================================================================== identities and permissions */
  // A caller: {name, arn, kind: user|role, perms: "admin"|"readonly"|"state", account}
  IAC.laptopIdentity = { name: "kc-dev", arn: "arn:aws:iam::" + ACCOUNT + ":user/kc-dev", userId: "AIDA" + "SAMPLEKCDEV7Q2XV4N", kind: "user", perms: "admin" };
  function identityOf(sess) {
    var sys = sess.sys;
    if (sys.awsIdentity) return sys.awsIdentity;
    var env = function (k) { return S.getVar(sess, k); };
    var A = aws(sys);
    if (env("AWS_ACCESS_KEY_ID") && env("AWS_SESSION_TOKEN")) { var rs = A.roleSessions[env("AWS_SESSION_TOKEN")]; if (rs) return rs; return { error: "ExpiredToken", msg: "The security token included in the request is expired" }; }
    var prof = env("AWS_PROFILE") || "default", cred = rdHome(sess, ".aws/credentials");
    if (!cred) return null;
    var sec = new RegExp("\\[" + prof.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\]([^\\[]*)").exec(cred);
    if (!sec) return { error: "ProfileNotFound", msg: "The config profile (" + prof + ") could not be found" };
    var kid = /aws_access_key_id\s*=\s*(\S+)/.exec(sec[1]);
    var id = kid && A.identities[kid[1]];
    if (!id) return { error: "InvalidClientTokenId", msg: "The security token included in the request is invalid." };
    return id;
  }
  IAC.identityOf = identityOf;
  function rdHome(sess, rel) { var n = root.Dk.fsNode(sess.sys, sess.home + "/" + rel); return n && n.type === "f" ? String(n.content) : null; }
  // Put a profile on the laptop
  IAC.laptopCreds = function (sys) {
    var A = aws(sys), kid = "AKIA" + "SAMPLE" + "KCDEV7Q2XV4N";
    A.identities[kid] = IAC.laptopIdentity;
    S.mkdirs(sys, "/home/dev/.aws", 448, 1000, 1000);
    S.put(sys, "/home/dev/.aws/config", "[default]\nregion = " + REGION + "\noutput = json\n", 384, 1000, 1000);
    S.put(sys, "/home/dev/.aws/credentials", "[default]\naws_access_key_id = " + kid + "\naws_secret_access_key = " + ["wJalr", "XUtnFEMI/K7MDENG/", "bPxRfiCY", "SAMPLEKEYKCDEV"].join("") + "\n", 384, 1000, 1000);
  };
  // can this caller do this? (perms: admin, readonly, or a role's own policy)
  function allowed(id, action) {
    if (!id) return false;
    if (id.perms === "admin") return true;
    if (id.perms === "readonly" || id.perms === "plan") return /^(\w+):(Get|List|Describe|Head)/.test(action) || action === "sts:GetCallerIdentity" || (id.perms === "plan" && /^(s3:(GetObject|PutObject|DeleteObject)|dynamodb:(GetItem|PutItem|DeleteItem))$/.test(action));
    return false;
  }
  IAC.allowed = allowed;
  function AwsErr(code, op, msg, exit) { this.code = code; this.op = op; this.msg = msg; this.exit = exit || 254; }
  IAC.AwsErr = AwsErr;
  function deny(id, action, resource, op) { return new AwsErr("AccessDenied", op, "User: " + (id.arn || id.name) + " is not authorized to perform: " + action + " on resource: " + resource + " because no identity-based policy allows the " + action + " action"); }
  IAC.deny = deny;
  function need(sess, action, resource, op) {
    var id = identityOf(sess);
    if (!id) throw new AwsErr(null, null, "Unable to locate credentials. You can configure credentials by running \"aws configure\".", 253);
    if (id.error) throw new AwsErr(id.error, op, id.msg);
    if (!allowed(id, action)) throw deny(id, action, resource, op);
    return id;
  }
  IAC.need = need;

  /* ================================================================== instances are machines */
  function pubIp(A, inst) { A.pubSeq++; return "52.18." + (40 + (A.pubSeq >> 8)) + "." + (10 + A.pubSeq % 240); }
  IAC.allocPrivateIp = function (A, subnet) { var c = subnet.cidr_block, base = ipn(c.split("/")[0]); A.ipSeq[c] = (A.ipSeq[c] || 9) + 1; return nip(base + A.ipSeq[c]); };
  IAC.allocPublicIp = pubIp;
  // The Ubuntu machine for an instance (made on first use): cloud-init ran user_data, the key pair is authorized for ubuntu
  function machineOf(sys, inst) {
    var A = aws(sys), m = A.machines[inst.id];
    if (m) return m;
    var home = CI.homeSys(sys);
    m = S.makeSystem({ host: "ip-" + inst.private_ip.replace(/\./g, "-") });
    m.ip = inst.public_ip || inst.private_ip; m.net = home.net || { byIp: {} }; m.now = home.now; m.topSession = home.topSession;
    m.github = CI.hubOf(home); m.hubSys = home;
    var pw = S.readSys(m, "/etc/passwd").split("\n").filter(function (l) { var f = l.split(":"); return l && !(+f[2] >= 1000 && +f[2] < 65534); });
    pw.push("ubuntu:x:1000:1000:Ubuntu:/home/ubuntu:/bin/bash"); S.put(m, "/etc/passwd", pw.join("\n") + "\n", 420);
    var gr = S.readSys(m, "/etc/group").split("\n").filter(function (l) { var f = l.split(":"); return l && !(+f[2] >= 1000 && +f[2] < 65534) && !/^sudo:/.test(l); });
    gr.push("ubuntu:x:1000:", "sudo:x:27:ubuntu"); S.put(m, "/etc/group", gr.join("\n") + "\n", 420);
    delete S.mkdirs(m, "/home").children.dev;
    var hn = S.mkdirs(m, "/home/ubuntu"); hn.uid = 1000; hn.gid = 1000; hn.mode = 488;
    S.put(m, "/etc/sudoers.d/90-cloud-init-users", "# Created by cloud-init\nubuntu ALL=(ALL) NOPASSWD:ALL\n", 288, 0, 0);
    S.put(m, "/etc/hostname", m.host + "\n", 420);
    var sc = S.readSys(m, "/etc/ssh/sshd_config"); if (sc) S.put(m, "/etc/ssh/sshd_config", sc.replace(/PasswordAuthentication yes/, "PasswordAuthentication no"), 420);
    var kp = inst.key_name && find(A, "aws_key_pair", function (k) { return k.key_name === inst.key_name; });
    if (kp) { S.mkdirs(m, "/home/ubuntu/.ssh", 448, 1000, 1000); S.put(m, "/home/ubuntu/.ssh/authorized_keys", kp.public_key.trim() + "\n", 384, 1000, 1000); }
    S.put(m, "/var/lib/cloud/instance/instance-id", inst.id + "\n", 420);
    // a fresh Ubuntu cloud image: no web server until user_data (or Ansible) installs one
    if (m.pkgs && m.pkgs.nginx && m.pkgs.nginx.installed) CI.runScript(m, "root", "/", {}, "apt-get purge -y -q nginx nginx-common > /dev/null 2>&1; rm -rf /var/www/html /etc/nginx; true", { errexit: false, xtrace: false });
    if (!S.readSys(m, "/usr/bin/python3")) S.put(m, "/usr/bin/python3", "\x7fELF python3", 493, 0, 0);
    if (inst.user_data) {
      S.put(m, "/var/lib/cloud/instance/user-data.txt", inst.user_data, 384, 0, 0);
      var res = /^#!/.test(inst.user_data) ? CI.runScript(m, "root", "/", { HOME: "/root" }, inst.user_data.replace(/^#![^\n]*\n/, ""), { errexit: false, xtrace: false }) : { code: 0, text: "" };
      S.put(m, "/var/log/cloud-init-output.log", "Cloud-init v. 24.3.1-0ubuntu0~24.04.2 running 'modules:final' at " + new Date(now(sys) * 1000).toUTCString() + ". Up 12.40 seconds.\n" + res.text + "Cloud-init v. 24.3.1-0ubuntu0~24.04.2 finished at " + new Date(now(sys) * 1000 + 31000).toUTCString() + ". Datasource DataSourceEc2Local.  Up 41.18 seconds\n", 416, 0, 0);
    }
    if (root.IAC.onMachine) root.IAC.onMachine(m, inst, sys);
    A.machines[inst.id] = m;
    return m;
  }
  IAC.machineOf = machineOf;
  // Which instances the laptop can reach on a port: public IP, a route to an internet gateway, and a security group rule
  function sgAllows(A, sgIds, port, ip) {
    var rules = [];
    (sgIds || []).forEach(function (id) {
      var g = find(A, "aws_security_group", function (x) { return x.id === id; }); if (!g) return;
      (g.ingress || []).forEach(function (r) { rules.push({ from: +r.from_port, to: +r.to_port, proto: r.protocol, cidrs: r.cidr_blocks || [] }); });
      all(A, "aws_vpc_security_group_ingress_rule").forEach(function (r) { if (r.security_group_id === id) rules.push({ from: +r.from_port, to: +r.to_port, proto: r.ip_protocol, cidrs: r.cidr_ipv4 ? [r.cidr_ipv4] : [] }); });
    });
    return rules.some(function (r) { var protoOk = r.proto === "-1" || r.proto === "tcp" || r.proto === "6"; var portOk = r.proto === "-1" || (port >= r.from && port <= r.to); return protoOk && portOk && r.cidrs.some(function (c) { return inCidr(ip, c); }); });
  }
  IAC.sgAllows = sgAllows;
  function publicRoute(A, subnetId) {
    var assoc = find(A, "aws_route_table_association", function (x) { return x.subnet_id === subnetId; });
    var rt = assoc && find(A, "aws_route_table", function (x) { return x.id === assoc.route_table_id; });
    return !!rt && (rt.route || []).some(function (r) { return r.cidr_block === "0.0.0.0/0" && /^igw-/.test(r.gateway_id || ""); });
  }
  IAC.publicRoute = publicRoute;
  var POOL = [];
  for (var pa = 40; pa < 42; pa++) for (var pb = 10; pb < 250; pb++) POOL.push("52.18." + pa + "." + pb);
  // Keep the laptop's view of the cloud in step with the account (called after anything that changes it)
  IAC.syncNet = function (sys) {
    var home = CI.homeSys(sys), A = aws(home), H = M2.net && M2.net.HOSTS;
    if (!H) return;
    if (!home.net) home.net = { byIp: {} };
    if (!A.netInit) { A.netInit = true; POOL.forEach(function (ip) { H[ip] = { ping: null, ports: [] }; delete home.net.byIp[ip]; }); }
    all(A, "aws_instance").forEach(function (inst) {
      if (!inst.public_ip) return;
      var up = inst.instance_state === "running" && publicRoute(A, inst.subnet_id);
      var ports = [22, 80, 443].filter(function (p) { return up && sgAllows(A, inst.vpc_security_group_ids, p, OFFICE_IP); });
      if (!up) { H[inst.public_ip] = { ping: null, ports: [] }; delete home.net.byIp[inst.public_ip]; return; }
      H[inst.public_ip] = { ping: ports.length ? 21.4 : null, ports: ports, machine: null };
      if (ports.length) home.net.byIp[inst.public_ip] = machineOf(home, inst); else delete home.net.byIp[inst.public_ip];
    });
    all(A, "aws_instance").filter(function (i) { return i.instance_state !== "running" && i.public_ip; }).forEach(function (i) { H[i.public_ip] = { ping: null, ports: [] }; delete home.net.byIp[i.public_ip]; });
  };

  /* ================================================================== JMESPath and output formats (from the Networking track) */
  var JP = (function () {
    function lex(s) {
      var t = [], i = 0;
      while (i < s.length) {
        var ch = s.charAt(i);
        if (/\s/.test(ch)) { i++; continue; }
        if (/[A-Za-z_]/.test(ch)) { var j = i; while (j < s.length && /[A-Za-z0-9_]/.test(s.charAt(j))) j++; t.push({ t: "id", v: s.slice(i, j) }); i = j; continue; }
        if (/[0-9-]/.test(ch) && (ch !== "-" || /[0-9]/.test(s.charAt(i + 1)))) { var k = i + 1; while (k < s.length && /[0-9]/.test(s.charAt(k))) k++; t.push({ t: "num", v: +s.slice(i, k) }); i = k; continue; }
        if (ch === "'") { var e = s.indexOf("'", i + 1); if (e < 0) throw new Error("Unclosed raw string"); t.push({ t: "lit", v: s.slice(i + 1, e).replace(/\\'/g, "'") }); i = e + 1; continue; }
        if (ch === "`") { var e2 = s.indexOf("`", i + 1); if (e2 < 0) throw new Error("Unclosed literal"); var raw = s.slice(i + 1, e2); var val; try { val = JSON.parse(raw); } catch (x) { val = raw; } t.push({ t: "lit", v: val }); i = e2 + 1; continue; }
        if (ch === "\"") { var e3 = i + 1; while (e3 < s.length && s.charAt(e3) !== "\"") { if (s.charAt(e3) === "\\") e3++; e3++; } t.push({ t: "id", v: JSON.parse(s.slice(i, e3 + 1)), q: true }); i = e3 + 1; continue; }
        var two = s.substr(i, 2);
        if (two === "[]") { t.push({ t: "flat" }); i += 2; continue; }
        if (two === "[?") { t.push({ t: "filter" }); i += 2; continue; }
        if (two === "||") { t.push({ t: "or" }); i += 2; continue; }
        if (two === "&&") { t.push({ t: "and" }); i += 2; continue; }
        if (two === "==" || two === "!=" || two === "<=" || two === ">=") { t.push({ t: "cmp", v: two }); i += 2; continue; }
        if (ch === "<" || ch === ">") { t.push({ t: "cmp", v: ch }); i++; continue; }
        var map = { ".": "dot", "*": "star", "[": "lb", "]": "rb", "{": "lc", "}": "rc", "(": "lp", ")": "rp", ",": "comma", ":": "colon", "|": "pipe", "@": "cur", "&": "amp", "!": "not" };
        if (map[ch]) { t.push({ t: map[ch] }); i++; continue; }
        throw new Error("Unknown token '" + ch + "'");
      }
      t.push({ t: "eof" });
      return t;
    }
    var BP = { eof: 0, id: 0, lit: 0, num: 0, rb: 0, rp: 0, comma: 0, rc: 0, cur: 0, amp: 0, colon: 0, pipe: 1, or: 2, and: 3, cmp: 5, flat: 9, star: 20, filter: 21, dot: 40, not: 45, lc: 50, lb: 55, lp: 60 };
    function parse(src) {
      var toks = lex(src), p = 0;
      function peek(o) { return toks[p + (o || 0)]; }
      function next() { return toks[p++]; }
      function expect(t) { var x = next(); if (x.t !== t) throw new Error("Expected " + t + ", got " + x.t); return x; }
      function expr(rbp) { var tk = next(), left = nud(tk); while (rbp < BP[peek().t]) left = led(next(), left); return left; }
      function projRhs(bp) {
        var n = peek().t;
        if (BP[n] < 10) return { k: "cur" };
        if (n === "lb" || n === "filter") return expr(bp);
        if (n === "dot") { next(); return dotRhs(bp); }
        throw new Error("Syntax error after projection");
      }
      function dotRhs(bp) {
        var n = peek().t;
        if (n === "lb") { next(); return mlist(); }
        if (n === "lc") { next(); return mhash(); }
        return expr(bp);
      }
      function mlist() { var items = []; while (true) { items.push(expr(0)); var x = next(); if (x.t === "rb") break; if (x.t !== "comma") throw new Error("Expected , or ]"); } return { k: "mlist", items: items }; }
      function mhash() { var items = []; while (true) { var key = next(); if (key.t !== "id") throw new Error("Expected key"); expect("colon"); items.push([key.v, expr(0)]); var x = next(); if (x.t === "rc") break; if (x.t !== "comma") throw new Error("Expected , or }"); } return { k: "mhash", items: items }; }
      function bracket(left) {
        // after '[': number, slice, star, or (for nud) multiselect list
        if (peek().t === "num" || peek().t === "colon") {
          var parts = [null, null, null], k = 0;
          while (peek().t !== "rb") { var x = next(); if (x.t === "colon") k++; else if (x.t === "num") parts[k] = x.v; else throw new Error("Bad index"); }
          next();
          if (k === 0) return { k: "index", left: left, i: parts[0] };
          return { k: "proj", left: { k: "slice", left: left, a: parts[0], b: parts[1], s: parts[2] }, right: projRhs(BP.star) };
        }
        if (peek().t === "star" && peek(1).t === "rb") { next(); next(); return { k: "proj", left: left, right: projRhs(BP.star) }; }
        return null;
      }
      function nud(tk) {
        switch (tk.t) {
          case "lit": return { k: "lit", v: tk.v };
          case "num": return { k: "lit", v: tk.v };
          case "id": return { k: "field", n: tk.v };
          case "cur": return { k: "cur" };
          case "star": return { k: "vproj", left: { k: "cur" }, right: projRhs(BP.star) };
          case "flat": return { k: "proj", left: { k: "flatten", left: { k: "cur" } }, right: projRhs(BP.flat) };
          case "filter": var cond = expr(0); expect("rb"); return { k: "fproj", left: { k: "cur" }, cond: cond, right: projRhs(BP.filter) };
          case "lb": var b = bracket({ k: "cur" }); return b || mlist();
          case "lc": return mhash();
          case "not": return { k: "not", e: expr(BP.not) };
          case "lp": var e = expr(0); expect("rp"); return e;
          case "amp": return { k: "ref", e: expr(BP.amp) };
        }
        throw new Error("Unexpected token: " + tk.t);
      }
      function led(tk, left) {
        switch (tk.t) {
          case "dot": if (peek().t === "star") { next(); return { k: "vproj", left: left, right: projRhs(BP.star) }; } return { k: "sub", left: left, right: dotRhs(BP.dot) };
          case "pipe": return { k: "pipe", left: left, right: expr(BP.pipe) };
          case "or": return { k: "or", a: left, b: expr(BP.or) };
          case "and": return { k: "and", a: left, b: expr(BP.and) };
          case "cmp": return { k: "cmp", op: tk.v, a: left, b: expr(BP.cmp) };
          case "flat": return { k: "proj", left: { k: "flatten", left: left }, right: projRhs(BP.flat) };
          case "filter": var cond = expr(0); expect("rb"); return { k: "fproj", left: left, cond: cond, right: projRhs(BP.filter) };
          case "lb": var b = bracket(left); if (!b) throw new Error("Bad bracket expression"); return b;
          case "lp": var args = []; while (peek().t !== "rp") { args.push(expr(0)); if (peek().t === "comma") next(); } next(); if (left.k !== "field") throw new Error("Bad function call"); return { k: "fn", n: left.n, args: args };
        }
        throw new Error("Unexpected token: " + tk.t);
      }
      var ast = expr(0);
      if (peek().t !== "eof") throw new Error("Unexpected token at end: " + peek().t);
      return ast;
    }
    function truthy(v) { return !(v === null || v === undefined || v === false || v === "" || (Array.isArray(v) && !v.length) || (typeof v === "object" && !Array.isArray(v) && !Object.keys(v).length)); }
    function eq(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
    var FN = {
      length: function (a) { return a == null ? null : typeof a === "object" && !Array.isArray(a) ? Object.keys(a).length : a.length; },
      contains: function (a, b) { return a == null ? false : Array.isArray(a) ? a.some(function (x) { return eq(x, b); }) : String(a).indexOf(b) >= 0; },
      starts_with: function (a, b) { return typeof a === "string" && a.indexOf(b) === 0; },
      ends_with: function (a, b) { return typeof a === "string" && a.slice(-b.length) === b; },
      join: function (s, a) { return (a || []).join(s); },
      keys: function (o) { return Object.keys(o || {}); }, values: function (o) { return Object.keys(o || {}).map(function (k) { return o[k]; }); },
      to_string: function (v) { return typeof v === "string" ? v : JSON.stringify(v); }, to_number: function (v) { return +v; },
      sort: function (a) { return (a || []).slice().sort(function (x, y) { return x < y ? -1 : x > y ? 1 : 0; }); },
      reverse: function (a) { return typeof a === "string" ? a.split("").reverse().join("") : (a || []).slice().reverse(); },
      sum: function (a) { return (a || []).reduce(function (s, x) { return s + x; }, 0); }, max: function (a) { return a && a.length ? a.reduce(function (s, x) { return x > s ? x : s; }) : null; }, min: function (a) { return a && a.length ? a.reduce(function (s, x) { return x < s ? x : s; }) : null; },
      not_null: function () { for (var i = 0; i < arguments.length; i++) if (arguments[i] != null) return arguments[i]; return null; },
      type: function (v) { return v === null ? "null" : Array.isArray(v) ? "array" : typeof v; }
    };
    function ev(n, v) {
      switch (n.k) {
        case "lit": return n.v;
        case "cur": return v;
        case "field": return v && typeof v === "object" && !Array.isArray(v) && n.n in v ? v[n.n] : null;
        case "sub": var l = ev(n.left, v); return l == null ? null : ev(n.right, l);
        case "pipe": return ev(n.right, ev(n.left, v));
        case "index": var a = ev(n.left, v); if (!Array.isArray(a)) return null; var i = n.i < 0 ? a.length + n.i : n.i; return a[i] === undefined ? null : a[i];
        case "slice": var s = ev(n.left, v); if (!Array.isArray(s)) return null; var st = n.s || 1, A = n.a == null ? (st > 0 ? 0 : s.length - 1) : n.a, B = n.b == null ? (st > 0 ? s.length : -s.length - 1) : n.b; if (A < 0) A += s.length; if (B < 0) B += s.length; var r = []; if (st > 0) for (var x = Math.max(0, A); x < Math.min(B, s.length); x += st) r.push(s[x]); else for (var y = Math.min(A, s.length - 1); y > B; y += st) r.push(s[y]); return r;
        case "flatten": var f = ev(n.left, v); if (!Array.isArray(f)) return null; var o = []; f.forEach(function (e) { if (Array.isArray(e)) o = o.concat(e); else o.push(e); }); return o;
        case "proj": var b = ev(n.left, v); if (!Array.isArray(b)) return null; return b.map(function (e) { return ev(n.right, e); }).filter(function (e) { return e !== null && e !== undefined; });
        case "vproj": var ob = ev(n.left, v); if (!ob || typeof ob !== "object" || Array.isArray(ob)) return null; return Object.keys(ob).map(function (k) { return ev(n.right, ob[k]); }).filter(function (e) { return e !== null && e !== undefined; });
        case "fproj": var fb = ev(n.left, v); if (!Array.isArray(fb)) return null; return fb.filter(function (e) { return truthy(ev(n.cond, e)); }).map(function (e) { return ev(n.right, e); }).filter(function (e) { return e !== null && e !== undefined; });
        case "mlist": if (v == null) return null; return n.items.map(function (e) { return ev(e, v); });
        case "mhash": if (v == null) return null; var h = {}; n.items.forEach(function (kv) { h[kv[0]] = ev(kv[1], v); }); return h;
        case "or": var x1 = ev(n.a, v); return truthy(x1) ? x1 : ev(n.b, v);
        case "and": var x2 = ev(n.a, v); return truthy(x2) ? ev(n.b, v) : x2;
        case "not": return !truthy(ev(n.e, v));
        case "cmp": var p = ev(n.a, v), q = ev(n.b, v);
          if (n.op === "==") return eq(p, q); if (n.op === "!=") return !eq(p, q);
          if (typeof p !== "number" || typeof q !== "number") return null;
          return n.op === "<" ? p < q : n.op === "<=" ? p <= q : n.op === ">" ? p > q : p >= q;
        case "ref": return { ref: n.e };
        case "fn":
          if (n.n === "sort_by" || n.n === "max_by" || n.n === "min_by") {
            var arr = ev(n.args[0], v) || [], key = n.args[1].k === "ref" ? n.args[1].e : n.args[1];
            var sorted = arr.slice().sort(function (a1, b1) { var ka = ev(key, a1), kb = ev(key, b1); return ka < kb ? -1 : ka > kb ? 1 : 0; });
            return n.n === "sort_by" ? sorted : n.n === "max_by" ? sorted[sorted.length - 1] || null : sorted[0] || null;
          }
          if (n.n === "map") { var ex = n.args[0].k === "ref" ? n.args[0].e : n.args[0]; return (ev(n.args[1], v) || []).map(function (e) { return ev(ex, e); }); }
          if (!FN[n.n]) throw new Error("Unknown function: " + n.n + "()");
          return FN[n.n].apply(null, n.args.map(function (a2) { return ev(a2, v); }));
      }
      throw new Error("bad node " + n.k);
    }
    return { search: function (data, q) { return ev(parse(q), data); }, parse: parse };
  })();
  function textOut(v) {
    if (v === null || v === undefined) return "None";
    if (typeof v !== "object") return String(v);
    if (Array.isArray(v)) {
      if (v.every(function (x) { return x === null || typeof x !== "object"; })) return v.map(function (x) { return x === null ? "None" : String(x); }).join("\t");
      if (v.every(function (x) { return Array.isArray(x); })) return v.map(textOut).join("\n");
      return v.map(textOut).join("\n");
    }
    var keys = Object.keys(v), scal = keys.filter(function (k) { return v[k] === null || typeof v[k] !== "object"; }).sort();
    var linesOut = [];
    if (scal.length) linesOut.push(scal.map(function (k) { return v[k] === null ? "None" : String(v[k]); }).join("\t"));
    keys.filter(function (k) { return v[k] !== null && typeof v[k] === "object"; }).forEach(function (k) {
      var sub = v[k];
      (Array.isArray(sub) ? sub : [sub]).forEach(function (s) {
        if (s === null || typeof s !== "object") { linesOut.push(k.toUpperCase() + "\t" + s); return; }
        var t = textOut(s).split("\n");
        linesOut.push(k.toUpperCase() + "\t" + t[0]); t.slice(1).forEach(function (l) { linesOut.push(l); });
      });
    });
    return linesOut.join("\n");
  }
  function tableOut(v, title) {
    var rows = [];
    function cells(x) { return x === null ? "None" : typeof x === "object" ? JSON.stringify(x) : String(x); }
    if (Array.isArray(v) && v.length && v.every(function (x) { return x && typeof x === "object" && !Array.isArray(x); })) {
      var cols = Object.keys(v[0]); rows.push(cols); v.forEach(function (x) { rows.push(cols.map(function (k) { return cells(x[k]); })); });
    } else if (Array.isArray(v) && v.every(function (x) { return Array.isArray(x); })) v.forEach(function (x) { rows.push(x.map(cells)); });
    else if (Array.isArray(v)) v.forEach(function (x) { rows.push([cells(x)]); });
    else if (v && typeof v === "object") Object.keys(v).forEach(function (k) { rows.push([k, cells(v[k])]); });
    else rows.push([cells(v)]);
    var w = []; rows.forEach(function (r) { r.forEach(function (x, i) { w[i] = Math.max(w[i] || 0, x.length); }); });
    var total = w.reduce(function (s, x) { return s + x + 3; }, 1);
    var L = ["-".repeat(total)], t = title || "";
    L.push("|" + " ".repeat(Math.max(0, Math.floor((total - 2 - t.length) / 2))) + t + " ".repeat(Math.max(0, total - 2 - t.length - Math.floor((total - 2 - t.length) / 2))) + "|");
    L.push("+" + w.map(function (x) { return "-".repeat(x + 2); }).join("+") + "+");
    rows.forEach(function (r) { L.push("|" + w.map(function (x, i) { var s = r[i] || ""; return " " + s + " ".repeat(x - s.length) + " "; }).join("|") + "|"); });
    L.push("+" + w.map(function (x) { return "-".repeat(x + 2); }).join("+") + "+");
    return L.join("\n");
  }


  /* ================================================================== aws CLI */
  function parseOpts(a) {
    var o = {}, pos = [];
    for (var i = 0; i < a.length; i++) {
      var x = a[i];
      if (/^--/.test(x)) { var k = x.slice(2), v = true, eq = k.indexOf("="); if (eq > 0) { v = k.slice(eq + 1); k = k.slice(0, eq); } else if (i + 1 < a.length && !/^--/.test(a[i + 1])) { v = a[++i]; if (/^(filters|instance-ids|group-ids|subnet-ids|vpc-ids|names|tags|resources|ip-permissions)$/.test(k)) { v = [v]; while (i + 1 < a.length && !/^--/.test(a[i + 1])) v.push(a[++i]); } } o[k] = v; }
      else pos.push(x);
    }
    return { o: o, pos: pos };
  }
  function shapeOut(io, v, o, title) {
    if (o.query) { try { v = JP.search(v, o.query); } catch (e) { throw new AwsErr(null, null, "\nBad value for --query " + o.query + ": " + e.message, 255); } }
    var fmt = o.output || "json";
    if (fmt === "text") out(io, textOut(v) + "\n");
    else if (fmt === "table") out(io, tableOut(v, title) + "\n");
    else if (fmt === "yaml") out(io, root.DevYaml.dump(v));
    else out(io, JSON.stringify(v, null, 4) + "\n");
  }
  function tagsList(t) { return keys(t || {}).map(function (k) { return { Key: k, Value: t[k] }; }); }
  function filt(list, filters, get) {
    (filters || []).forEach(function (f) { var m = /^Name=([^,]+),Values=(.+)$/.exec(f); if (!m) return; var vals = m[2].split(","); list = list.filter(function (x) { var v = get(x, m[1]); return [].concat(v).some(function (y) { return vals.some(function (p) { return new RegExp("^" + p.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$").test(String(y)); }); }); }); });
    return list;
  }
  function tagOf(x, name) { return /^tag:/.test(name) ? (x.tags || {})[name.slice(4)] : null; }
  var SHAPES = {
    instance: function (i) { return { InstanceId: i.id, ImageId: i.ami, InstanceType: i.instance_type, KeyName: i.key_name || undefined, LaunchTime: new Date((i.created || 0) * 1000).toISOString().replace(/\.\d+Z$/, "+00:00"), Placement: { AvailabilityZone: i.availability_zone }, PrivateIpAddress: i.private_ip, PublicIpAddress: i.public_ip || undefined, PrivateDnsName: i.private_dns, PublicDnsName: i.public_dns || "", State: { Code: i.instance_state === "running" ? 16 : i.instance_state === "stopped" ? 80 : 48, Name: i.instance_state }, SubnetId: i.subnet_id, VpcId: i.vpc_id, SecurityGroups: (i.vpc_security_group_ids || []).map(function (g) { return { GroupId: g }; }), IamInstanceProfile: i.iam_instance_profile ? { Arn: arn("iam", "instance-profile/" + i.iam_instance_profile, false) } : undefined, MetadataOptions: { HttpTokens: (i.metadata_options && i.metadata_options[0] && i.metadata_options[0].http_tokens) || "optional", HttpEndpoint: "enabled" }, Tags: tagsList(i.tags) }; },
    vpc: function (v) { return { CidrBlock: v.cidr_block, VpcId: v.id, State: "available", IsDefault: !!v.is_default, Tags: tagsList(v.tags) }; },
    subnet: function (s) { return { SubnetId: s.id, VpcId: s.vpc_id, CidrBlock: s.cidr_block, AvailabilityZone: s.availability_zone, MapPublicIpOnLaunch: !!s.map_public_ip_on_launch, Tags: tagsList(s.tags) }; },
    sg: function (g, A) { var perms = (g.ingress || []).map(function (r) { return { IpProtocol: r.protocol, FromPort: +r.from_port, ToPort: +r.to_port, IpRanges: (r.cidr_blocks || []).map(function (c) { return { CidrIp: c, Description: r.description || undefined }; }) }; }); all(A, "aws_vpc_security_group_ingress_rule").forEach(function (x) { if (x.security_group_id === g.id) perms.push({ IpProtocol: x.ip_protocol, FromPort: +x.from_port, ToPort: +x.to_port, IpRanges: x.cidr_ipv4 ? [{ CidrIp: x.cidr_ipv4, Description: x.description || undefined }] : [] }); }); return { GroupId: g.id, GroupName: g.name, Description: g.description, VpcId: g.vpc_id, IpPermissions: perms, Tags: tagsList(g.tags) }; }
  };
  CMDS.aws = function (args, io, sess) {
    var a = args.slice(1), sys = sess.sys;
    if (!a.length || a[0] === "help") { out(io, "usage: aws [options] <command> <subcommand> [<subcommand> ...] [parameters]\nTo see help text, you can run:\n\n  aws help\n  aws <command> help\n  aws <command> <subcommand> help\n\n(This lab's aws CLI knows: sts, s3, s3api, ec2, ssm, iam, dynamodb.)\n"); return a.length ? 0 : 252; }
    if (a[0] === "--version") { out(io, "aws-cli/2.18.15 Python/3.12.6 Linux/6.8.0-48-generic exe/x86_64.ubuntu.24\n"); return 0; }
    var svc = a[0], op = a[1], p = parseOpts(a.slice(2)), o = p.o, A = aws(sys);
    try {
      var r = awsOp(sess, A, svc, op, o, p.pos, io);
      if (r && r.raw != null) { out(io, r.raw); return 0; }
      if (r !== undefined && r !== null) shapeOut(io, r, o, OPNAME(op));
      IAC.syncNet(sys);
      return 0;
    } catch (e) {
      if (!(e instanceof AwsErr)) throw e;
      if (e.code) errl(io, "\nAn error occurred (" + e.code + ") when calling the " + (e.op || OPNAME(op)) + " operation: " + e.msg);
      else errl(io, e.msg);
      return e.exit;
    }
  };
  function OPNAME(op) { return String(op || "").split("-").map(function (w) { return w.charAt(0).toUpperCase() + w.slice(1); }).join(""); }
  function bucketOf(A, name, op) { var b = find(A, "aws_s3_bucket", function (x) { return x.bucket === name; }); if (!b) throw new AwsErr("NoSuchBucket", op, "The specified bucket does not exist"); return b; }
  function sub(A, type, bucket) { return find(A, type, function (x) { return x.bucket === bucket; }); }
  function awsOp(sess, A, svc, op, o, pos, io) {
    var sys = sess.sys, id;
    if (svc === "sts" && op === "get-caller-identity") { id = need(sess, "sts:GetCallerIdentity", "*", "GetCallerIdentity"); return { UserId: id.userId || "AROA" + "SAMPLEROLE7Q2XV" + ":" + (id.session || id.name), Account: ACCOUNT, Arn: id.arn }; }
    if (svc === "s3" && op === "ls") {
      if (!pos[0]) { need(sess, "s3:ListAllMyBuckets", "*", "ListBuckets"); return { raw: all(A, "aws_s3_bucket").map(function (b) { return new Date((b.created || 0) * 1000).toISOString().replace("T", " ").slice(0, 19) + " " + b.bucket + "\n"; }).join("") }; }
      var m = /^s3:\/\/([^/]+)\/?(.*)$/.exec(pos[0]); if (!m) throw new AwsErr(null, null, "\nParameter validation failed:\nInvalid bucket name \"" + pos[0] + "\"", 252);
      need(sess, "s3:ListBucket", "arn:aws:s3:::" + m[1], "ListObjectsV2"); var b = bucketOf(A, m[1], "ListObjectsV2");
      return { raw: keys(b.objects || {}).filter(function (k) { return k.indexOf(m[2]) === 0; }).sort().map(function (k) { return new Date((b.objects[k].t || 0) * 1000).toISOString().replace("T", " ").slice(0, 19) + String(b.objects[k].body.length).padStart(11) + " " + k.slice(m[2].replace(/[^/]*$/, "").length) + "\n"; }).join("") };
    }
    if (svc === "s3" && op === "cp") {
      var src = pos[0], dst = pos[1], mm = /^s3:\/\/([^/]+)\/(.+)$/.exec(src);
      if (mm && dst) { need(sess, "s3:GetObject", "arn:aws:s3:::" + mm[1] + "/" + mm[2], "GetObject"); var bb = bucketOf(A, mm[1], "GetObject"), obj = (bb.objects || {})[mm[2]]; if (!obj) throw new AwsErr("404", "HeadObject", "Not Found", 1); if (dst === "-") return { raw: obj.body }; S.writeFile(sess, dst.charAt(0) === "/" ? dst : sess.cwd + "/" + dst, obj.body, false); return { raw: "download: " + src + " to " + dst + "\n" }; }
      var md = /^s3:\/\/([^/]+)\/(.+)$/.exec(dst || "");
      if (md) { need(sess, "s3:PutObject", "arn:aws:s3:::" + md[1] + "/" + md[2], "PutObject"); var b2 = bucketOf(A, md[1], "PutObject"), rf = S.readFile(sess, src.charAt(0) === "/" ? src : sess.cwd + "/" + src); if (rf.error) throw new AwsErr(null, null, "\nThe user-provided path " + src + " does not exist.", 255); (b2.objects = b2.objects || {})[md[2]] = { body: rf.content, t: now(sys) }; ev(sys, { kind: "s3-put", bucket: md[1], key: md[2] }); return { raw: "upload: " + src + " to " + dst + "\n" }; }
      throw new AwsErr(null, null, "\nusage: aws s3 cp <LocalPath> <S3Uri> or <S3Uri> <LocalPath>", 252);
    }
    if (svc === "s3api") {
      var bn = o.bucket, OPN = OPNAME(op);
      if (op === "list-buckets") { need(sess, "s3:ListAllMyBuckets", "*", OPN); return { Buckets: all(A, "aws_s3_bucket").map(function (b) { return { Name: b.bucket, CreationDate: new Date((b.created || 0) * 1000).toISOString().replace(/\.\d+Z$/, "+00:00") }; }), Owner: { ID: hx("owner", 64) } }; }
      if (!bn || bn === true) throw new AwsErr(null, null, "\naws: error: the following arguments are required: --bucket", 252);
      var act = { "get-bucket-encryption": "s3:GetEncryptionConfiguration", "get-public-access-block": "s3:GetBucketPublicAccessBlock", "put-public-access-block": "s3:PutBucketPublicAccessBlock", "delete-public-access-block": "s3:PutBucketPublicAccessBlock", "get-bucket-versioning": "s3:GetBucketVersioning", "put-bucket-versioning": "s3:PutBucketVersioning", "get-bucket-tagging": "s3:GetBucketTagging", "put-bucket-tagging": "s3:PutBucketTagging", "delete-bucket-encryption": "s3:PutEncryptionConfiguration", "head-bucket": "s3:ListBucket" }[op];
      if (!act) throw new AwsErr(null, null, "\naws: error: argument operation: Invalid choice for s3api in this lab: " + op, 252);
      need(sess, act, "arn:aws:s3:::" + bn, OPN);
      var B = bucketOf(A, bn, OPN);
      if (op === "head-bucket") return { BucketRegion: REGION, AccessPointAlias: false };
      if (op === "get-bucket-encryption") { var e = sub(A, "aws_s3_bucket_server_side_encryption_configuration", bn); var alg = e && e.rule && e.rule[0] && e.rule[0].apply_server_side_encryption_by_default[0].sse_algorithm || "AES256"; return { ServerSideEncryptionConfiguration: { Rules: [{ ApplyServerSideEncryptionByDefault: { SSEAlgorithm: alg }, BucketKeyEnabled: !!(e && e.rule[0].bucket_key_enabled) }] } }; }
      if (op === "get-public-access-block") { var pab = sub(A, "aws_s3_bucket_public_access_block", bn); if (!pab) throw new AwsErr("NoSuchPublicAccessBlockConfiguration", OPN, "The public access block configuration was not found"); return { PublicAccessBlockConfiguration: { BlockPublicAcls: !!pab.block_public_acls, IgnorePublicAcls: !!pab.ignore_public_acls, BlockPublicPolicy: !!pab.block_public_policy, RestrictPublicBuckets: !!pab.restrict_public_buckets } }; }
      if (op === "delete-public-access-block") { var p0 = sub(A, "aws_s3_bucket_public_access_block", bn); if (p0) delete bag(A, "aws_s3_bucket_public_access_block")[p0.id]; ev(sys, { kind: "drift", type: "aws_s3_bucket_public_access_block", id: bn, what: "deleted" }); return null; }
      if (op === "put-public-access-block") { var cfg = String(o["public-access-block-configuration"] || ""), get = function (k) { var mm2 = new RegExp(k + "\\s*[=:]\\s*\"?(true|false)", "i").exec(cfg); return mm2 ? /true/i.test(mm2[1]) : false; }; var pb = sub(A, "aws_s3_bucket_public_access_block", bn) || (bag(A, "aws_s3_bucket_public_access_block")[bn] = { id: bn, bucket: bn }); pb.block_public_acls = get("BlockPublicAcls"); pb.ignore_public_acls = get("IgnorePublicAcls"); pb.block_public_policy = get("BlockPublicPolicy"); pb.restrict_public_buckets = get("RestrictPublicBuckets"); ev(sys, { kind: "drift", type: "aws_s3_bucket_public_access_block", id: bn }); return null; }
      if (op === "get-bucket-versioning") { var v0 = sub(A, "aws_s3_bucket_versioning", bn); return v0 ? { Status: v0.versioning_configuration[0].status } : {}; }
      if (op === "put-bucket-versioning") { var st = /Status=(\w+)/.exec(String(o["versioning-configuration"] || "")); var vv = sub(A, "aws_s3_bucket_versioning", bn) || (bag(A, "aws_s3_bucket_versioning")[bn] = { id: bn, bucket: bn, expected_bucket_owner: "", mfa: null }); vv.versioning_configuration = [{ status: st ? st[1] : "Enabled", mfa_delete: "" }]; ev(sys, { kind: "drift", type: "aws_s3_bucket_versioning", id: bn }); return null; }
      if (op === "get-bucket-tagging") { if (!keys(B.tags || {}).length) throw new AwsErr("NoSuchTagSet", OPN, "The TagSet does not exist"); return { TagSet: tagsList(B.tags) }; }
      if (op === "put-bucket-tagging") { var ts = {}, re = /Key=([^,}\]]+),Value=([^,}\]]+)/g, mt; while ((mt = re.exec(String(o.tagging || "")))) ts[mt[1]] = mt[2]; B.tags = ts; B.tags_all = clone(ts); ev(sys, { kind: "drift", type: "aws_s3_bucket", id: bn }); return null; }
      if (op === "delete-bucket-encryption") { var e2 = sub(A, "aws_s3_bucket_server_side_encryption_configuration", bn); if (e2) delete bag(A, "aws_s3_bucket_server_side_encryption_configuration")[e2.id]; ev(sys, { kind: "drift", type: "aws_s3_bucket_server_side_encryption_configuration", id: bn }); return null; }
    }
    if (svc === "ec2") {
      var OP2 = OPNAME(op);
      if (/^describe-/.test(op)) need(sess, "ec2:" + OP2, "*", OP2);
      if (op === "describe-instances") { var L = filt(all(A, "aws_instance").filter(function (i) { return i.instance_state !== "terminated" || true; }), o.filters, function (x, n) { return n === "instance-state-name" ? x.instance_state : n === "vpc-id" ? x.vpc_id : tagOf(x, n); }); if (o["instance-ids"]) L = L.filter(function (i) { return [].concat(o["instance-ids"]).indexOf(i.id) >= 0; }); return { Reservations: L.map(function (i) { return { ReservationId: "r-0" + hx("res" + i.id), OwnerId: ACCOUNT, Instances: [SHAPES.instance(i)] }; }) }; }
      if (op === "describe-vpcs") return { Vpcs: filt(all(A, "aws_vpc"), o.filters, function (x, n) { return n === "cidr" || n === "cidr-block" ? x.cidr_block : tagOf(x, n); }).map(SHAPES.vpc) };
      if (op === "describe-subnets") return { Subnets: filt(all(A, "aws_subnet"), o.filters, function (x, n) { return n === "vpc-id" ? x.vpc_id : tagOf(x, n); }).map(SHAPES.subnet) };
      if (op === "describe-security-groups") { var gs = all(A, "aws_security_group"); if (o["group-ids"]) gs = gs.filter(function (g) { return [].concat(o["group-ids"]).indexOf(g.id) >= 0; }); gs = filt(gs, o.filters, function (x, n) { return n === "group-name" ? x.name : n === "vpc-id" ? x.vpc_id : tagOf(x, n); }); return { SecurityGroups: gs.map(function (g) { return SHAPES.sg(g, A); }) }; }
      if (op === "describe-images") { var im = AMIS.filter(function (x) { return !o.owners || [].concat(o.owners).join(" ").indexOf(x.owner) >= 0 || /canonical|amazon/.test(String(o.owners)); }); im = filt(im, o.filters, function (x, n) { return n === "name" ? x.name : n === "image-id" ? x.id : null; }); return { Images: im.map(function (x) { return { ImageId: x.id, Name: x.name, OwnerId: x.owner, CreationDate: x.created, Architecture: "x86_64", State: "available" }; }) }; }
      if (op === "authorize-security-group-ingress") {
        var gid = o["group-id"]; need(sess, "ec2:AuthorizeSecurityGroupIngress", arn("ec2", "security-group/" + gid), OP2);
        var g = find(A, "aws_security_group", function (x) { return x.id === gid || x.name === o["group-name"]; }); if (!g) throw new AwsErr("InvalidGroup.NotFound", OP2, "The security group '" + (gid || o["group-name"]) + "' does not exist");
        var rule = { from_port: +(o.port || 0), to_port: +(o.port || 0), protocol: o.protocol || "tcp", cidr_blocks: [o.cidr || "0.0.0.0/0"], description: "", ipv6_cidr_blocks: [], prefix_list_ids: [], security_groups: [], self: false };
        if (String(o.port).indexOf("-") > 0) { rule.from_port = +String(o.port).split("-")[0]; rule.to_port = +String(o.port).split("-")[1]; }
        g.ingress = (g.ingress || []).concat([rule]);
        ev(sys, { kind: "drift", type: "aws_security_group", id: g.id, what: "ingress " + rule.protocol + "/" + rule.from_port + " from " + rule.cidr_blocks[0] });
        return { Return: true, SecurityGroupRules: [{ SecurityGroupRuleId: "sgr-0" + hx("sgr" + g.id + o.port + o.cidr), GroupId: g.id, IsEgress: false, IpProtocol: rule.protocol, FromPort: rule.from_port, ToPort: rule.to_port, CidrIpv4: rule.cidr_blocks[0] }] };
      }
      if (op === "revoke-security-group-ingress") { var gid2 = o["group-id"]; need(sess, "ec2:RevokeSecurityGroupIngress", arn("ec2", "security-group/" + gid2), OP2); var g2 = find(A, "aws_security_group", function (x) { return x.id === gid2; }); if (!g2) throw new AwsErr("InvalidGroup.NotFound", OP2, "The security group '" + gid2 + "' does not exist"); var before = (g2.ingress || []).length; g2.ingress = (g2.ingress || []).filter(function (r) { return !(String(r.from_port) === String(o.port) && (r.cidr_blocks || []).indexOf(o.cidr) >= 0); }); if (g2.ingress.length === before) throw new AwsErr("InvalidPermission.NotFound", OP2, "The specified rule does not exist in this security group."); ev(sys, { kind: "drift", type: "aws_security_group", id: g2.id }); return { Return: true }; }
      if (op === "create-tags") { need(sess, "ec2:CreateTags", "*", OP2); [].concat(o.resources || []).forEach(function (rid) { ["aws_instance", "aws_vpc", "aws_subnet", "aws_security_group"].forEach(function (t) { var x = bag(A, t)[rid]; if (x) { x.tags = x.tags || {}; [].concat(o.tags || []).forEach(function (tg) { var m3 = /Key=([^,]+),Value=(.*)$/.exec(tg); if (m3) x.tags[m3[1]] = m3[2]; }); x.tags_all = clone(x.tags); ev(sys, { kind: "drift", type: t, id: rid }); } }); }); return null; }
      if (op === "stop-instances" || op === "start-instances" || op === "terminate-instances") { need(sess, "ec2:" + OP2.replace(/s$/, "s"), "*", OP2); var ids = [].concat(o["instance-ids"] || []); var key = { "stop-instances": "StoppingInstances", "start-instances": "StartingInstances", "terminate-instances": "TerminatingInstances" }[op]; var res = {}; res[key] = ids.map(function (iid) { var inst = bag(A, "aws_instance")[iid]; if (!inst) throw new AwsErr("InvalidInstanceID.NotFound", OP2, "The instance ID '" + iid + "' does not exist"); var prev = inst.instance_state; inst.instance_state = op === "stop-instances" ? "stopped" : op === "start-instances" ? "running" : "terminated"; if (op === "terminate-instances") { delete bag(A, "aws_instance")[iid]; } ev(sys, { kind: "drift", type: "aws_instance", id: iid, what: inst.instance_state }); return { InstanceId: iid, CurrentState: { Name: op === "stop-instances" ? "stopping" : op === "start-instances" ? "pending" : "shutting-down" }, PreviousState: { Name: prev } }; }); return res; }
      throw new AwsErr(null, null, "\naws: error: argument operation: Invalid choice for ec2 in this lab: " + op, 252);
    }
    if (svc === "ssm") {
      var OP3 = OPNAME(op), nm = o.name;
      if (op === "put-parameter") {
        need(sess, "ssm:PutParameter", arn("ssm", "parameter" + nm), OP3);
        var cur = find(A, "aws_ssm_parameter", function (x) { return x.name === nm; });
        if (cur && !o.overwrite) throw new AwsErr("ParameterAlreadyExists", OP3, "The parameter already exists. To overwrite this request value, set the overwrite option in the request to true.");
        var type = o.type || (cur && cur.type) || "String";
        if (["String", "StringList", "SecureString"].indexOf(type) < 0) throw new AwsErr("ValidationException", OP3, "1 validation error detected: Value '" + type + "' at 'type' failed to satisfy constraint: Member must satisfy enum value set: [SecureString, StringList, String]");
        var val = String(o.value == null ? "" : o.value);
        if (/^file:\/\//.test(val)) { var fr = S.readFile(sess, val.slice(7).replace(/^~/, sess.home)); val = fr.error ? "" : fr.content.replace(/\n$/, ""); }
        var pm = cur || (bag(A, "aws_ssm_parameter")[nm] = { id: nm, name: nm, arn: arn("ssm", "parameter" + nm), tier: "Standard", data_type: "text", tags: {}, tags_all: {} });
        pm.type = type; pm.value = val; pm.insecure_value = null; pm.version = (pm.version || 0) + 1; pm.key_id = type === "SecureString" ? (o["key-id"] || "alias/aws/ssm") : ""; pm.description = o.description || pm.description || "";
        ev(sys, { kind: cur ? "drift" : "ssm-put", type: "aws_ssm_parameter", id: nm });
        return { Version: pm.version, Tier: "Standard" };
      }
      if (op === "get-parameter") {
        need(sess, "ssm:GetParameter", arn("ssm", "parameter" + nm), OP3);
        var pr = find(A, "aws_ssm_parameter", function (x) { return x.name === nm; }); if (!pr) throw new AwsErr("ParameterNotFound", OP3, "");
        var dec = !!o["with-decryption"];
        return { Parameter: { Name: pr.name, Type: pr.type, Value: pr.type === "SecureString" && !dec ? "AQICAHh" + M2.hashChars("enc" + pr.value, 120, "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/") + "==" : pr.value, Version: pr.version, LastModifiedDate: new Date(now(sys) * 1000).toISOString(), ARN: pr.arn, DataType: "text" } };
      }
      if (op === "get-parameters-by-path") { need(sess, "ssm:GetParametersByPath", arn("ssm", "parameter" + o.path), OP3); var pre = String(o.path || "/").replace(/\/?$/, "/"); return { Parameters: all(A, "aws_ssm_parameter").filter(function (x) { return x.name.indexOf(pre) === 0 && (o.recursive || x.name.slice(pre.length).indexOf("/") < 0); }).map(function (x) { return { Name: x.name, Type: x.type, Value: x.type === "SecureString" && !o["with-decryption"] ? "AQICAHh" + M2.hashChars("enc" + x.value, 60, "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789") + "==" : x.value, Version: x.version, ARN: x.arn, DataType: "text" }; }) }; }
      if (op === "describe-parameters") { need(sess, "ssm:DescribeParameters", "*", OP3); return { Parameters: all(A, "aws_ssm_parameter").map(function (x) { return { Name: x.name, Type: x.type, KeyId: x.key_id || undefined, Version: x.version, Tier: "Standard", DataType: "text" }; }) }; }
      if (op === "delete-parameter") { need(sess, "ssm:DeleteParameter", arn("ssm", "parameter" + nm), OP3); var pd = find(A, "aws_ssm_parameter", function (x) { return x.name === nm; }); if (!pd) throw new AwsErr("ParameterNotFound", OP3, ""); delete bag(A, "aws_ssm_parameter")[pd.id]; return null; }
      throw new AwsErr(null, null, "\naws: error: argument operation: Invalid choice for ssm in this lab: " + op, 252);
    }
    if (svc === "dynamodb") {
      var OP4 = OPNAME(op);
      if (op === "list-tables") { need(sess, "dynamodb:ListTables", "*", OP4); return { TableNames: all(A, "aws_dynamodb_table").map(function (t) { return t.name; }).sort() }; }
      if (op === "scan") { need(sess, "dynamodb:Scan", arn("dynamodb", "table/" + o["table-name"]), OP4); var tb = find(A, "aws_dynamodb_table", function (t) { return t.name === o["table-name"]; }); if (!tb) throw new AwsErr("ResourceNotFoundException", OP4, "Requested resource not found"); var items = keys(tb.items || {}).map(function (k) { var it = {}; keys(tb.items[k]).forEach(function (f) { it[f] = { S: String(tb.items[k][f]) }; }); return it; }); return { Items: items, Count: items.length, ScannedCount: items.length, ConsumedCapacity: null }; }
      if (op === "describe-table") { need(sess, "dynamodb:DescribeTable", arn("dynamodb", "table/" + o["table-name"]), OP4); var td = find(A, "aws_dynamodb_table", function (t) { return t.name === o["table-name"]; }); if (!td) throw new AwsErr("ResourceNotFoundException", OP4, "Requested resource not found: Table: " + o["table-name"] + " not found"); return { Table: { TableName: td.name, TableStatus: "ACTIVE", KeySchema: [{ AttributeName: td.hash_key, KeyType: "HASH" }], BillingModeSummary: { BillingMode: td.billing_mode }, ItemCount: keys(td.items || {}).length, TableArn: td.arn } }; }
      throw new AwsErr(null, null, "\naws: error: argument operation: Invalid choice for dynamodb in this lab: " + op, 252);
    }
    if (svc === "iam") {
      var OP5 = OPNAME(op);
      if (op === "list-roles") { need(sess, "iam:ListRoles", "*", OP5); return { Roles: all(A, "aws_iam_role").map(function (r) { return { RoleName: r.name, Arn: r.arn, RoleId: r.unique_id, CreateDate: new Date((r.created || 0) * 1000).toISOString().replace(/\.\d+Z$/, "+00:00"), AssumeRolePolicyDocument: JSON.parse(r.assume_role_policy || "{}") }; }) }; }
      if (op === "get-role") { need(sess, "iam:GetRole", arn("iam", "role/" + o["role-name"], false), OP5); var rr = find(A, "aws_iam_role", function (r) { return r.name === o["role-name"]; }); if (!rr) throw new AwsErr("NoSuchEntity", OP5, "The role with name " + o["role-name"] + " cannot be found."); return { Role: { RoleName: rr.name, Arn: rr.arn, RoleId: rr.unique_id, AssumeRolePolicyDocument: JSON.parse(rr.assume_role_policy || "{}"), MaxSessionDuration: 3600 } }; }
      if (op === "list-attached-role-policies") { need(sess, "iam:ListAttachedRolePolicies", arn("iam", "role/" + o["role-name"], false), OP5); return { AttachedPolicies: all(A, "aws_iam_role_policy_attachment").filter(function (x) { return x.role === o["role-name"]; }).map(function (x) { return { PolicyName: x.policy_arn.split("/").pop(), PolicyArn: x.policy_arn }; }) }; }
      if (op === "list-open-id-connect-providers") { need(sess, "iam:ListOpenIDConnectProviders", "*", OP5); return { OpenIDConnectProviderList: all(A, "aws_iam_openid_connect_provider").map(function (x) { return { Arn: x.arn }; }) }; }
      throw new AwsErr(null, null, "\naws: error: argument operation: Invalid choice for iam in this lab: " + op, 252);
    }
    throw new AwsErr(null, null, "\naws: error: argument command: Invalid choice for this lab: " + svc + " (known: sts, s3, s3api, ec2, ssm, iam, dynamodb)", 252);
  }
  IAC.JP = JP;
})(typeof window !== "undefined" ? window : globalThis);
