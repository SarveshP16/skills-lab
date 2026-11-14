/* sudo learn — Networking track, Module 5: Cloud networks & DevSecOps (NET-501..505 here, 506..509 in labs-m5b.js).
   The same ideas as Modules 1 to 4, in an AWS account: VPCs and route tables, security groups and network ACLs, a load
   balancer and Route 53, Docker's networks on kc-web-01, and VPC flow logs. The engine is in net-m5.js and net-m5b.js. */
(function () {
  "use strict";
  var T = window.NET_TRACK, S = window.ShEngine, M2 = S.M2, M3 = S.M3, M4 = S.M4, N = window.NetCore, NH = window.NetLab.H, SH = window.ShLab.H;
  var MAYA = "Maya Chen · SRE lead", DEV = "Dev Patel · Security";
  var NOW = S.NOW, DAY = S.DAY, ME = "10.20.0.15", MON = "10.20.5.10", EXT = "198.51.100.200", OFFICE_NAT = "203.0.113.15";
  var ex = T.ex, code = T.code, lines = T.lines, ran = NH.ran, outHas = NH.outHas, idx = NH.idx;
  var C5 = N.cloud, LABS = [];
  // the AWS account on the network map: amber while a load balancer target is unhealthy
  window.NetLab.NODES.vpc = { label: "AWS VPC", kind: "cloud", ip: "10.0.0.0/16", fn: function (sys) {
    var c = sys.cloud; if (!c) return { st: "unknown", why: "no AWS account in this lab" };
    var t = c.tgs[0], bad = t ? t.targets.filter(function (x) { return C5.targetHealth(c, t, x).State !== "healthy"; }) : [];
    var up = c.insts.filter(function (i) { return i.state === "running"; }).length;
    return bad.length ? { st: "warn", why: bad.length + " load balancer target(s) unhealthy" } : { st: "ok", why: "kestrel-prod: " + c.subnets.length + " subnets, " + up + " instances running" };
  } };
  function word(r, p) { return (r.read(p) || "").trim(); }
  function after(r, i, re, fn) { return r.history.some(function (e, k) { return k > i && re.test(e.cmd) && (!fn || fn(e)); }); }
  // fixed IDs in the simulated account (the same every time, like a real account)
  function iid(n) { return "i-0" + M2.hexOf("inst:" + n, 16); }
  var ID = {
    vpc: C5.hid("vpc", "prod"), igw: C5.hid("igw", "prod"), nat: C5.hid("nat", "a"), acl: C5.hid("acl", "default"),
    rtb: function (k) { return C5.hid("rtb", k); }, sub: function (k) { return C5.hid("subnet", k); }, sg: function (k) { return C5.hid("sg", k); },
    tg: "arn:aws:elasticloadbalancing:eu-west-1:111122223333:targetgroup/kestrel-web-tg/" + M2.hexOf("tg", 16),
    zone: "Z0" + M2.hexOf("zone", 12).toUpperCase(), alb: C5.ALB_DNS, albZone: C5.ALB_ZONE,
    web1: iid("web-1"), web2: iid("web-2"), db1: iid("db-1"), bastion: iid("bastion-1"), proxy: iid("proxy-1")
  };
  var HOST = { web1: "ip-10-0-11-20", web2: "ip-10-0-12-20", db1: "ip-10-0-21-30", bastion: "ip-10-0-1-10", proxy: "ip-10-0-2-50" };
  function cl(r) { return C5.of(r.sys); }
  function sgOf(r, k) { return C5.sgNamed(cl(r), C5.hid("sg", k)); }
  function flowOk(r, from, to, port, proto) { var c = cl(r); return C5.flow(c, C5.endpoint(c, from), C5.endpoint(c, to), port, proto || "tcp"); }
  function worldIn(g, port) { return g.rules.some(function (x) { return !x.egress && x.cidr === "0.0.0.0/0" && (x.proto === "-1" || (port == null || (x.from <= port && port <= x.to))); }); }
  function awsRan(r, re, fn) { return ran(r, /^\s*aws\b/, function (e) { return re.test(e.cmd) && e.exit === 0 && (!fn || fn(e)); }); }
  function on(host) { return function (e) { return e.host === host; }; }
  function setRules(g, list) { g.rules = []; list.forEach(function (x) { C5.addRule(g, x); }); C5.addRule(g, C5.rule(true, "-1", null, null, "0.0.0.0/0")); }
  function moveAssoc(c, subnetKey, toRt) {
    var sid = C5.subnetNamed(c, subnetKey).SubnetId;
    c.rts.forEach(function (t) { t.Associations = t.Associations.filter(function (a) { return a.SubnetId !== sid; }); });
    var t = C5.rtNamed(c, toRt); t.Associations.push({ Main: false, RouteTableAssociationId: C5.hid("rtbassoc", toRt + subnetKey), RouteTableId: t.RouteTableId, SubnetId: sid, AssociationState: { State: "associated" } });
  }
  var AWS_HELP = "<h3>The aws CLI</h3>" + code("aws ec2 describe-vpcs                                  # JSON by default\naws ec2 describe-subnets --output table\naws ec2 describe-instances --query 'Reservations[].Instances[].[InstanceId, PrivateIpAddress]' --output text\naws ec2 describe-subnets --filters Name=tag:Name,Values=kestrel-prod-app-b") +
    '<table class="t"><tr><th>Option</th><th>Does</th></tr><tr><td><code>--query</code></td><td>picks fields out of the answer (JMESPath): <code>Things[].Field</code>, <code>[?Key==`value`]</code> filters, <code>[0]</code> the first</td></tr><tr><td><code>--filters Name=…,Values=…</code></td><td>AWS does the filtering: by <code>vpc-id</code>, <code>subnet-id</code>, <code>tag:Name</code>, <code>association.subnet-id</code>…</td></tr><tr><td><code>--output text|table|json</code></td><td>tab-separated text is easy to use in scripts</td></tr></table>' +
    "<p>Your credentials and region are already in <code>~/.aws/</code>. <code>aws sts get-caller-identity</code> shows who you are.</p>";
  var SSM_HELP = "<h3>A shell on an instance, without SSH</h3>" + code("aws ssm start-session --target " + ID.web2 + "\n# … you're on the instance as ssm-user; exit to come back") +
    "<p>Session Manager connects through the AWS API: no open port 22, no SSH keys to manage, and every session is logged. Private instances can still be reached this way.</p>";

  /* ================================================================== NET-501 VPCs */
  function vpcSys(sys) {
    var c = N.cloudLab(sys);
    moveAssoc(c, "db-a", "public");
    var pb = C5.rtNamed(c, "private-b"); pb.Routes = pb.Routes.filter(function (x) { return x.DestinationCidrBlock !== "0.0.0.0/0"; });
    return c;
  }
  // the same mistakes, on db-b and private-a: answers that were copied instead of looked up don't match
  function vpcAlt(sys) {
    var c = N.cloudLab(sys);
    moveAssoc(c, "db-b", "public");
    var pa = C5.rtNamed(c, "private-a"); pa.Routes = pa.Routes.filter(function (x) { return x.DestinationCidrBlock !== "0.0.0.0/0"; });
    return c;
  }
  function publicNames(c) { return c.subnets.filter(function (s) { var rt = C5.routeTo(c, s.SubnetId, "8.8.8.8"); return rt && /^igw-/.test(rt.GatewayId || ""); }).map(function (s) { return s.Tags[0].Value.replace(/^kestrel-prod-/, ""); }).sort(); }
  function namesIn(r, p) { return (r.read(p) || "").split(/[\s,]+/).map(function (x) { return x.trim().replace(/^kestrel-prod-/, ""); }).filter(Boolean).sort(); }
  LABS.push({
    id: "net-501", n: 40, module: 5, ticket: "NET-501", xp: 170, layer: "L3",
    title: "Your network in the cloud",
    topic: "VPCs, subnets, route tables, internet and NAT gateways, public vs private, the aws CLI and Session Manager",
    from: MAYA,
    story: "<p>The shop is moving to AWS. Our VPC <code>kestrel-prod</code> has a public tier (the load balancer and a bastion), an app tier (web-1, web-2) and a database tier (db-1). Two things look wrong:</p><ul><li>web-2 can't install updates: every <code>apt update</code> times out.</li><li>Someone \"temporarily\" made a database subnet public for a data migration and may not have undone it.</li></ul><p>Map the VPC with the <code>aws</code> CLI, fix the routing, and prove it from web-2 itself.</p>",
    learn:
      "<h3>A VPC is your own network</h3><p>A <b>VPC</b> is a private address range (here <code>10.0.0.0/16</code>) cut into <b>subnets</b>, one per tier and availability zone. Every subnet uses one <b>route table</b>: that table alone decides whether the subnet is public or private.</p>" +
      '<table class="t"><tr><th>Route 0.0.0.0/0 goes to</th><th>The subnet is</th><th>What it means</th></tr><tr><td><code>igw-…</code> internet gateway</td><td>public</td><td>instances with a public IP are reachable from the internet, and reach it</td></tr><tr><td><code>nat-…</code> NAT gateway</td><td>private</td><td>instances can reach out (updates, APIs); nothing can connect in</td></tr><tr><td>no default route</td><td>isolated</td><td>only the VPC itself (the <code>local</code> route): right for databases</td></tr></table>' +
      "<p>A NAT gateway lives in a <b>public</b> subnet and does what your home router does: many private addresses share one public address, outbound only.</p>" +
      AWS_HELP + code("aws ec2 describe-route-tables --query 'RouteTables[].{Name: Tags[0].Value, Routes: Routes[].[DestinationCidrBlock, GatewayId || NatGatewayId], Subnets: Associations[].SubnetId}'\naws ec2 replace-route-table-association --association-id rtbassoc-… --route-table-id rtb-…\naws ec2 create-route --route-table-id rtb-… --destination-cidr-block 0.0.0.0/0 --nat-gateway-id nat-…") + SSM_HELP,
    system: vpcSys,
    diagram: ["vpc"],
    starter: "",
    objectives: [
      {
        id: "cidr", text: "Find the address range of the <code>kestrel-prod</code> VPC and write it to <code>~/vpc-cidr.txt</code>.",
        hints: ["aws ec2 describe-vpcs, and look for the one tagged kestrel-prod.", "aws ec2 describe-vpcs --query 'Vpcs[].[CidrBlock, Tags[0].Value]' --output text\necho 10.0.0.0/16 > ~/vpc-cidr.txt"],
        check: function (r) { if (!awsRan(r, /describe-vpcs/)) return "Look at the VPCs with aws ec2 describe-vpcs."; return word(r, "vpc-cidr.txt") === "10.0.0.0/16" ? true : "That isn't kestrel-prod's range (the other VPC is the account's default one)."; }
      },
      {
        id: "public", text: "Which subnets are <b>public</b> right now (their route table sends 0.0.0.0/0 to the internet gateway)? Write their names, one per line, to <code>~/public-subnets.txt</code>.",
        hints: ["List each route table's routes and the subnets associated with it, then turn subnet IDs into names with describe-subnets.", "aws ec2 describe-route-tables --filters Name=route.gateway-id,Values=" + ID.igw + " --query 'RouteTables[].Associations[].SubnetId' --output text\naws ec2 describe-subnets --subnet-ids SUBNET-IDS --query 'Subnets[].Tags[0].Value' --output text\nprintf 'public-a\\npublic-b\\ndb-a\\n' > ~/public-subnets.txt"],
        check: function (r) { if (!awsRan(r, /describe-route-tables/)) return "Look at the route tables (aws ec2 describe-route-tables)."; var want = publicNames(r.run("").sys.cloud).join(","), got = namesIn(r, "public-subnets.txt").join(","); if (!got) return "Write the names to ~/public-subnets.txt."; return got === want ? true : "Not quite: check which route tables have a 0.0.0.0/0 route to igw-…, and every subnet associated with them."; }
      },
      {
        id: "db", text: "Make the database subnet private again: associate it with the <code>kestrel-prod-db</code> route table (no internet route at all).",
        hints: ["Find the association ID of db-a's current association, then replace-route-table-association.", "aws ec2 describe-route-tables --filters Name=association.subnet-id,Values=" + ID.sub("db-a") + " --query 'RouteTables[0].Associations'\naws ec2 replace-route-table-association --association-id " + C5.hid("rtbassoc", "publicdb-a") + " --route-table-id " + ID.rtb("db")],
        check: function (r) { var c = cl(r), bad = c.subnets.filter(function (s) { return /^db-/.test(s.key) && C5.rtFor(c, s.SubnetId).key !== "db"; }); return bad.length ? bad[0].Tags[0].Value + " still uses the " + (C5.rtFor(c, bad[0].SubnetId).Tags[0].Value) + " route table." : true; }
      },
      {
        id: "nat", text: "Fix web-2's updates: its subnet (app-b) must send internet traffic through the <b>NAT gateway</b>.",
        hints: ["Compare app-b's route table with app-a's. Which route is missing?", "aws ec2 create-route --route-table-id " + ID.rtb("private-b") + " --destination-cidr-block 0.0.0.0/0 --nat-gateway-id " + ID.nat],
        check: function (r) { var c = cl(r), rt = C5.routeTo(c, ID.sub("app-b"), "185.125.190.36"); if (!rt || rt.GatewayId === "local") return "app-b still has no route to the internet."; if (/^igw-/.test(rt.GatewayId || "")) return "Through the NAT gateway, not the internet gateway: web-2 has no public address, and it must not be reachable from the internet."; return rt.NatGatewayId === ID.nat ? true : "Point the route at the NAT gateway."; }
      },
      {
        id: "prove", text: "Prove it from web-2: open a Session Manager session on it and fetch <code>http://archive.ubuntu.com/ubuntu/</code> (with <code>curl -I</code>). Then come back with <code>exit</code>.",
        hints: ["aws ssm start-session --target (web-2's instance ID), then curl -I.", "aws ssm start-session --target " + ID.web2 + "\ncurl -I http://archive.ubuntu.com/ubuntu/\nexit"],
        check: function (r) { var k = idx(r, /create-route|replace-route/); if (!ran(r, /\bcurl\b.*archive\.ubuntu\.com/, function (e) { return e.host === HOST.web2 && outHas(e, /^HTTP\/1\.1 200/); })) return "Run curl -I http://archive.ubuntu.com/ubuntu/ on web-2 (inside its session) after the fix."; return after(r, k, /\bcurl\b.*archive/, on(HOST.web2)) ? true : "Fetch it again after fixing the route."; }
      }
    ],
    solution: lines("aws sts get-caller-identity", "aws ec2 describe-vpcs --query 'Vpcs[].[CidrBlock, Tags[0].Value]' --output text", "echo 10.0.0.0/16 > ~/vpc-cidr.txt",
      "aws ec2 describe-route-tables --query 'RouteTables[].{Name: Tags[0].Value, Routes: Routes[].[DestinationCidrBlock, GatewayId || NatGatewayId], Subnets: Associations[].SubnetId}'",
      "aws ec2 describe-subnets --query 'Subnets[].[SubnetId, Tags[0].Value, CidrBlock]' --output text",
      "printf 'public-a\\npublic-b\\ndb-a\\n' > ~/public-subnets.txt",
      "aws ec2 replace-route-table-association --association-id " + C5.hid("rtbassoc", "publicdb-a") + " --route-table-id " + ID.rtb("db"),
      "aws ec2 create-route --route-table-id " + ID.rtb("private-b") + " --destination-cidr-block 0.0.0.0/0 --nat-gateway-id " + ID.nat,
      "aws ssm start-session --target " + ID.web2, "curl -I http://archive.ubuntu.com/ubuntu/", "exit"),
    debrief: "<p>You read a cloud network the way you read Linux routing in Module 1: <b>the route table decides</b>. db-a had been pointed at the public route table, so anything in it with a public address would have been on the internet. Now it's isolated again, and web-2 reaches out through the NAT gateway like web-1, without being reachable from outside.</p><p>The CLI pattern you used (describe, filter, query, change, verify from the instance) is the same for every AWS service. Next: the two firewalls of a VPC.</p>",
    realworld: "In any AWS account: aws ec2 describe-route-tables --query 'RouteTables[].{Id: RouteTableId, Default: Routes[?DestinationCidrBlock==`0.0.0.0/0`].[GatewayId, NatGatewayId]}' shows public and private subnets at a glance.",
    quiz: [
      { q: "What makes a subnet public?", options: ["Its name", "Its route table sends 0.0.0.0/0 to an internet gateway", "It has a NAT gateway in it", "Its CIDR"], answer: 1, why: "Only the route table decides." },
      { q: "web-2 is private and needs updates. Where should 0.0.0.0/0 point?", options: ["The internet gateway", "A NAT gateway in a public subnet", "Nowhere", "The database"], answer: 1, why: "NAT lets private instances reach out without being reachable." },
      { q: "Why use Session Manager instead of SSH?", options: ["It's faster", "No open port 22 and no keys to manage, every session is logged", "SSH doesn't work in AWS", "It gives root"], answer: 1, why: "Nothing to scan, nothing to steal." }
    ]
  });

  /* ================================================================== NET-502 Security groups vs network ACLs */
  var ATTACKER = "198.51.100.66";
  function aclEntries(list) { return list.map(function (e) { return { RuleNumber: e[0], Protocol: e[1], RuleAction: e[2], Egress: e[3], CidrBlock: e[4], PortRange: e[5] ? { From: e[5], To: e[6] } : undefined }; }).map(function (e) { if (!e.PortRange) delete e.PortRange; return e; }); }
  function sgNaclSys(sys) {
    var c = N.cloudLab(sys), G = c.G;
    C5.addRule(G.bastion, C5.rule(false, "tcp", 22, 22, "0.0.0.0/0", "SSH from anywhere (temporary)"));
    C5.addRule(G.db, C5.rule(false, "tcp", 5432, 5432, "0.0.0.0/0", "temporary: data migration"));
    var id = C5.hid("acl", "db"), a = { key: "db", NetworkAclId: id, VpcId: c.vpc.VpcId, IsDefault: false, OwnerId: C5.ACCOUNT, Tags: [{ Key: "Name", Value: "kestrel-prod-db-acl" }], Associations: [],
      Entries: aclEntries([[100, "6", "allow", false, "10.0.0.0/16", 5432, 5432], [110, "6", "allow", false, "10.0.1.0/24", 22, 22], [32767, "-1", "deny", false, "0.0.0.0/0"], [100, "6", "allow", true, "10.0.0.0/16", 5432, 5432], [32767, "-1", "deny", true, "0.0.0.0/0"]]) };
    ["db-a", "db-b"].forEach(function (sn) { var sid = C5.subnetNamed(c, sn).SubnetId; c.acls.forEach(function (x) { x.Associations = x.Associations.filter(function (s) { return s.SubnetId !== sid; }); }); a.Associations.push({ NetworkAclAssociationId: C5.hid("aclassoc", "db" + sn), NetworkAclId: id, SubnetId: sid }); });
    c.acls.push(a);
    return c;
  }
  LABS.push({
    id: "net-502", n: 41, module: 5, ticket: "NET-502", xp: 190, layer: "L3–4",
    title: "Two firewalls",
    topic: "Security groups (stateful, on each instance, allow only) vs network ACLs (stateless, per subnet, allow and deny, numbered); ephemeral ports",
    from: DEV,
    story: "<p>Three problems, one afternoon:</p><ul><li>The bastion and the database have \"temporary\" rules open to the whole internet.</li><li>Since someone added a network ACL to the database subnets, web-1 can't reach PostgreSQL on db-1: connections just hang, although the security groups allow them.</li><li><code>" + ATTACKER + "</code> is hammering the shop's login. Block that address for the whole VPC.</li></ul>",
    learn:
      '<table class="t"><tr><th></th><th>Security group</th><th>Network ACL</th></tr><tr><td>Applies to</td><td>each network interface (instance)</td><td>a whole subnet</td></tr><tr><td>Rules</td><td>allow only</td><td>allow <b>and deny</b>, numbered, lowest number first, first match wins</td></tr><tr><td>State</td><td><b>stateful</b>: replies are always allowed</td><td><b>stateless</b>: replies need their own rule</td></tr><tr><td>Sources</td><td>CIDRs or <b>other security groups</b></td><td>CIDRs only</td></tr></table>' +
      "<h3>Ephemeral ports</h3><p>When web-1 connects to db-1:5432, web-1 picks a random source port (Linux: 32768 to 60999). db-1's reply goes <b>to that port</b>. A stateless ACL that only allows port 5432 outbound drops every reply: the connection hangs. That's why ACLs usually allow <code>1024-65535</code> back out.</p>" +
      "<h3>Reference security groups, not addresses</h3><p>\"PostgreSQL from <code>sg-web</code>\" means \"from anything that has the web security group\": new web servers work automatically, nothing else does.</p>" +
      code("aws ec2 describe-security-groups --group-names kestrel-db --query 'SecurityGroups[0].IpPermissions'\naws ec2 revoke-security-group-ingress --group-id sg-… --protocol tcp --port 22 --cidr 0.0.0.0/0\naws ec2 authorize-security-group-ingress --group-id sg-… --protocol tcp --port 5432 --source-group sg-…\naws ec2 describe-network-acls --filters Name=association.subnet-id,Values=subnet-…\naws ec2 create-network-acl-entry --network-acl-id acl-… --egress --rule-number 110 --protocol tcp --port-range From=1024,To=65535 --cidr-block 10.0.0.0/16 --rule-action allow") + SSM_HELP,
    system: sgNaclSys,
    diagram: ["vpc", "scan"],
    starter: "",
    objectives: [
      {
        id: "bastion", text: "The bastion: remove the rule that opens SSH to the whole internet, keep the office rule (<code>" + OFFICE_NAT + "/32</code>). Then show from <b>ext-scan-01</b> that port 22 of the bastion (<code>192.0.2.11</code>) no longer answers.",
        hints: ["revoke-security-group-ingress on kestrel-bastion, then ssh ext-scan-01.example.net nc -zv -w 3 192.0.2.11 22.", "aws ec2 revoke-security-group-ingress --group-id " + ID.sg("bastion") + " --protocol tcp --port 22 --cidr 0.0.0.0/0\nssh ext-scan-01.example.net nc -zv -w 3 192.0.2.11 22"],
        check: function (r) { var g = sgOf(r, "bastion"); if (worldIn(g, 22)) return "SSH is still open to 0.0.0.0/0."; if (!g.rules.some(function (x) { return !x.egress && x.cidr === OFFICE_NAT + "/32"; })) return "Keep the office's SSH rule."; var k = idx(r, new RegExp("revoke-security-group-ingress.*(" + ID.sg("bastion") + "|kestrel-bastion)")); return after(r, k, /ssh\s+ext-scan-01.*\bnc\b.*192\.0\.2\.11/, function (e) { return outHas(e, /timed out/); }) ? true : "Now try it from ext-scan-01 (nc -zv -w 3 192.0.2.11 22): it should time out."; }
      },
      {
        id: "db", text: "The database: PostgreSQL only from the <b>web servers' security group</b>, nothing from the internet.",
        hints: ["Remove the 0.0.0.0/0 rule; the rule from kestrel-web is already there.", "aws ec2 revoke-security-group-ingress --group-id " + ID.sg("db") + " --protocol tcp --port 5432 --cidr 0.0.0.0/0"],
        check: function (r) { var g = sgOf(r, "db"); if (g.rules.some(function (x) { return !x.egress && x.cidr && (x.proto === "-1" || (x.from <= 5432 && 5432 <= x.to)); })) return "kestrel-db still allows PostgreSQL from an address range. Only from the web servers' security group."; return g.rules.some(function (x) { return !x.egress && x.sg === ID.sg("web") && x.from <= 5432 && 5432 <= x.to; }) ? true : "Keep (or add) the rule from the kestrel-web security group."; }
      },
      {
        id: "nacl", text: "web-1 can't reach PostgreSQL on db-1 (it hangs). Fix the database subnets' <b>network ACL</b>, then prove it from web-1 with <code>nc -zv -w 3 10.0.21.30 5432</code>.",
        hints: ["Read the db ACL's outbound rules: where do db-1's replies go?", "aws ec2 create-network-acl-entry --network-acl-id " + C5.hid("acl", "db") + " --egress --rule-number 110 --protocol tcp --port-range From=1024,To=65535 --cidr-block 10.0.0.0/16 --rule-action allow\naws ssm start-session --target " + ID.web1 + "\nnc -zv -w 3 10.0.21.30 5432\nexit"],
        check: function (r) { var f = flowOk(r, "10.0.11.20", "10.0.21.30", 5432); if (!f.ok) return "web-1 → db-1:5432 still fails: " + f.why + "."; var c = cl(r), a = C5.aclNamed(c, "db"); if (a && a.Entries.some(function (e) { return e.Egress && e.RuleAction === "allow" && e.Protocol === "-1" && e.CidrBlock === "0.0.0.0/0"; })) return "Works, but don't allow everything out to anywhere: allow the ephemeral ports back to the VPC."; var k = idx(r, /network-acl-entry.*--egress/); return after(r, k, /\bnc\b.*10\.0\.21\.30.*5432/, function (e) { return e.host === HOST.web1 && outHas(e, /succeeded/); }) ? true : "Prove it from web-1: nc -zv -w 3 10.0.21.30 5432 in a session on web-1."; }
      },
      {
        id: "deny", text: "Block <code>" + ATTACKER + "</code> from <b>every subnet</b> of the VPC, inbound. (Security groups can't deny; network ACLs can.)",
        hints: ["Add a deny entry to the default network ACL with a rule number lower than its allow-all rule (100).", "aws ec2 create-network-acl-entry --network-acl-id " + ID.acl + " --ingress --rule-number 90 --protocol -1 --cidr-block " + ATTACKER + "/32 --rule-action deny"],
        check: function (r) {
          var c = cl(r), bad = c.subnets.filter(function (s) { var a = C5.aclCheck(C5.aclFor(c, s.SubnetId), false, "tcp", 443, ATTACKER); return a.ok; });
          if (bad.length) { var ent = C5.aclFor(c, bad[0].SubnetId).Entries.filter(function (e) { return !e.Egress && e.CidrBlock === ATTACKER + "/32"; })[0]; return ent ? "There's a rule for " + ATTACKER + ", but a lower-numbered allow matches first (" + bad[0].Tags[0].Value + "). Lower numbers win." : bad[0].Tags[0].Value + " still lets " + ATTACKER + " in."; }
          return flowOk(r, EXT, "192.0.2.20", 443).ok ? true : "You blocked more than " + ATTACKER + ": other internet clients can't reach the load balancer now.";
        }
      }
    ],
    solution: lines("aws ec2 describe-security-groups --group-names kestrel-bastion kestrel-db --query 'SecurityGroups[].[GroupName, IpPermissions]'",
      "aws ec2 revoke-security-group-ingress --group-id " + ID.sg("bastion") + " --protocol tcp --port 22 --cidr 0.0.0.0/0", "ssh ext-scan-01.example.net nc -zv -w 3 192.0.2.11 22",
      "aws ec2 revoke-security-group-ingress --group-id " + ID.sg("db") + " --protocol tcp --port 5432 --cidr 0.0.0.0/0",
      "aws ec2 describe-network-acls --filters Name=association.subnet-id,Values=" + ID.sub("db-a") + " --query 'NetworkAcls[0].Entries'",
      "aws ec2 create-network-acl-entry --network-acl-id " + C5.hid("acl", "db") + " --egress --rule-number 110 --protocol tcp --port-range From=1024,To=65535 --cidr-block 10.0.0.0/16 --rule-action allow",
      "aws ssm start-session --target " + ID.web1, "nc -zv -w 3 10.0.21.30 5432", "exit",
      "aws ec2 create-network-acl-entry --network-acl-id " + ID.acl + " --ingress --rule-number 90 --protocol -1 --cidr-block " + ATTACKER + "/32 --rule-action deny"),
    debrief: "<p>Two layers, two jobs. <b>Security groups</b> say who may talk to each instance, stateful and by role (\"PostgreSQL from the web servers\"). <b>Network ACLs</b> are a coarse, stateless fence around a subnet: good for a quick deny of a bad address, painful when you forget the replies, as the db subnet showed: port 5432 out was useless, the replies go to ephemeral ports.</p><p>The scan from ext-scan-01 is the habit from Module 4: prove a firewall change from where the attacker sits.</p>",
    realworld: "Search an account for world-open rules: aws ec2 describe-security-groups --filters Name=ip-permission.cidr,Values=0.0.0.0/0 --query 'SecurityGroups[].[GroupName, IpPermissions[].FromPort]'.",
    quiz: [
      { q: "A network ACL allows 5432 in and 5432 out. Connections to the database hang. Why?", options: ["PostgreSQL is down", "ACLs are stateless: the replies go to the client's ephemeral port, which isn't allowed out", "Security groups block it", "DNS"], answer: 1, why: "Replies need their own rule in a stateless filter." },
      { q: "You must block one abusive address. Where?", options: ["A security group deny rule", "A network ACL deny rule with a low number", "The route table", "The load balancer"], answer: 1, why: "Security groups have no deny." },
      { q: "Why reference a security group as the source instead of IP ranges?", options: ["It's faster", "New instances with that group are allowed automatically, and nothing else is", "It's required", "It encrypts traffic"], answer: 1, why: "Rules follow roles, not addresses." }
    ]
  });

  /* ================================================================== NET-503 Load balancer + DNS */
  function albSys(sys) {
    var c = N.cloudLab(sys), G = c.G;
    c.tgs[0].hc.path = "/health";
    G.web.rules = G.web.rules.filter(function (x) { return !(x.sg === G.alb.GroupId); });
    C5.addRule(G.web, C5.rule(false, "tcp", 80, 80, "10.0.1.0/24", "HTTP from the load balancer"));
    c.zones[0].records.push({ Name: "shop.kestrel.example.com.", Type: "A", TTL: 3600, ResourceRecords: [{ Value: "203.0.113.80" }] });
    C5.syncDns(sys);
    return c;
  }
  function reason(c) { var t = c.tgs[0]; return C5.targetHealth(c, t, t.targets[0]).Reason || "healthy"; }
  var ALIAS_JSON = ["{", "  \"Comment\": \"shop moves to the load balancer\",", "  \"Changes\": [{", "    \"Action\": \"UPSERT\",", "    \"ResourceRecordSet\": {", "      \"Name\": \"shop.kestrel.example.com\",", "      \"Type\": \"A\",", "      \"AliasTarget\": {", "        \"HostedZoneId\": \"" + ID.albZone + "\",", "        \"DNSName\": \"" + ID.alb + "\",", "        \"EvaluateTargetHealth\": true", "      }", "    }", "  }]", "}"];
  LABS.push({
    id: "net-503", n: 42, module: 5, ticket: "NET-503", xp: 190, layer: "L4–7",
    title: "Behind the load balancer",
    topic: "Application load balancer, target groups and health checks, reason codes, security group chaining, Route 53 alias records and TTLs",
    from: MAYA,
    story: "<p><code>shop.kestrel.example.com</code> still points at the old server. Tonight it moves to the new load balancer <code>kestrel-shop-alb</code>, which spreads requests over web-1 and web-2. But the targets show <b>unhealthy</b>, and nobody switches DNS to a load balancer whose targets are unhealthy.</p><p>Find out why, fix it at the right layer, check both web servers answer, then move the name.</p>",
    learn:
      "<h3>How an application load balancer works</h3><p>Clients connect to the load balancer's nodes (one per public subnet). Each node forwards requests to the <b>targets</b> registered in a <b>target group</b>, but only to targets that pass the <b>health check</b>: a request to a path every few seconds that must answer with the expected code.</p>" +
      '<table class="t"><tr><th>Reason code</th><th>Means</th></tr><tr><td><code>Target.ResponseCodeMismatch</code></td><td>the target answered, with the wrong code (often 404: wrong path)</td></tr><tr><td><code>Target.Timeout</code></td><td>no answer: a security group, an ACL or a dead service</td></tr><tr><td><code>Target.FailedHealthChecks</code></td><td>the connection failed</td></tr></table>' +
      code("aws elbv2 describe-target-health --target-group-arn arn:… --query 'TargetHealthDescriptions[].[Target.Id, TargetHealth.State, TargetHealth.Reason, TargetHealth.Description]' --output text\naws elbv2 modify-target-group --target-group-arn arn:… --health-check-path /healthz") +
      "<h3>Security group chaining</h3><p>The web servers should accept HTTP from <b>the load balancer's security group</b>, not from an address range: the load balancer has a node in each public subnet, and its addresses change.</p>" +
      "<h3>DNS for a load balancer</h3><p>Its addresses change, so never put them in an A record. Route 53 has <b>alias</b> records: an A record that follows the load balancer's name. Changes go in a JSON \"change batch\".</p>" +
      code("aws route53 list-resource-record-sets --hosted-zone-id Z… --query \"ResourceRecordSets[?Name=='shop.kestrel.example.com.']\"\naws route53 change-resource-record-sets --hosted-zone-id Z… --change-batch file://alias.json") +
      "<p>Plan a DNS move around the old record's <b>TTL</b>: resolvers may keep the old answer that long.</p>",
    system: albSys,
    diagram: ["vpc", "site"],
    starter: "",
    objectives: [
      {
        id: "why", text: "Show the targets' health and write the <b>reason code</b> AWS gives to <code>~/reason.txt</code>.",
        hints: ["describe-target-health, with the target group's ARN from describe-target-groups.", "aws elbv2 describe-target-groups --names kestrel-web-tg --query 'TargetGroups[0].TargetGroupArn' --output text\naws elbv2 describe-target-health --target-group-arn " + ID.tg + "\necho Target.ResponseCodeMismatch > ~/reason.txt"],
        check: function (r) { var want = reason(r.run("").sys.cloud); if (!awsRan(r, /describe-target-health/, function (e) { return outHas(e, new RegExp(want.replace(/\./g, "\\."))); })) return "Show the targets' health (aws elbv2 describe-target-health)."; return word(r, "reason.txt") === want ? true : "Copy the Reason field exactly."; }
      },
      {
        id: "path", text: "Find which path the web servers use for health (look at the app on web-1) and point the health check at it.",
        hints: ["In a session on web-1: curl -i http://localhost/health and /healthz.", "aws ssm start-session --target " + ID.web1 + "\ncurl -s -o /dev/null -w '%{http_code}' http://localhost/healthz\nexit\naws elbv2 modify-target-group --target-group-arn " + ID.tg + " --health-check-path /healthz"],
        check: function (r) { var p = cl(r).tgs[0].hc.path; return p === "/healthz" ? true : "The health check path is " + p + ": what does the app answer there?"; }
      },
      {
        id: "sg", text: "The targets are still unhealthy, with a different reason. Fix it at the right layer, so that <b>both</b> targets are healthy.",
        hints: ["Read the new reason. Where do health checks come from? The load balancer has a node in public-a and in public-b.", "aws ec2 authorize-security-group-ingress --group-id " + ID.sg("web") + " --protocol tcp --port 80 --source-group " + ID.sg("alb") + "\naws ec2 revoke-security-group-ingress --group-id " + ID.sg("web") + " --protocol tcp --port 80 --cidr 10.0.1.0/24"],
        check: function (r) { var c = cl(r), t = c.tgs[0], bad = t.targets.filter(function (x) { return C5.targetHealth(c, t, x).State !== "healthy"; }); if (bad.length) return bad.length + " target(s) still unhealthy: " + C5.targetHealth(c, t, bad[0]).Reason + "."; var g = sgOf(r, "web"); return g.rules.some(function (x) { return !x.egress && x.sg === ID.sg("alb") && x.from <= 80 && 80 <= x.to; }) ? (g.rules.some(function (x) { return !x.egress && x.cidr && x.from <= 80 && 80 <= x.to; }) ? "Healthy. Now remove the address-range rule for port 80: the security group rule covers it." : true) : "Healthy, but allow HTTP from the load balancer's security group instead of address ranges."; }
      },
      {
        id: "both", text: "Request the load balancer's DNS name a few times with curl and see <b>both</b> web servers answer.",
        hints: ["curl it twice.", "curl -s http://" + ID.alb + "/\ncurl -s http://" + ID.alb + "/"],
        check: function (r) { var w1 = ran(r, /\bcurl\b.*elb\.amazonaws\.com|\bcurl\b.*192\.0\.2\.2[01]/, function (e) { return outHas(e, /served by web-1/); }), w2 = ran(r, /\bcurl\b.*elb\.amazonaws\.com|\bcurl\b.*192\.0\.2\.2[01]/, function (e) { return outHas(e, /served by web-2/); }); return w1 && w2 ? true : "Keep requesting until you've seen both web-1 and web-2."; }
      },
      {
        id: "dns", text: "Move <code>shop.kestrel.example.com</code> to the load balancer with a Route 53 <b>alias</b> record (write the change batch in <code>~/alias.json</code>), then check the name with <code>dig</code>.",
        hints: ["UPSERT an A record with an AliasTarget: the load balancer's DNS name and its hosted zone ID (" + ID.albZone + ", from describe-load-balancers).", "nano ~/alias.json   (see the learn panel)\naws route53 change-resource-record-sets --hosted-zone-id " + ID.zone + " --change-batch file://alias.json\ndig +short shop.kestrel.example.com"],
        check: function (r) {
          var z = cl(r).zones[0], rec = z.records.filter(function (x) { return x.Name === "shop.kestrel.example.com." && x.Type === "A"; })[0];
          if (!rec || !rec.AliasTarget) return "shop.kestrel.example.com still has its old A record.";
          if (rec.AliasTarget.DNSName.replace(/\.$/, "").toLowerCase().replace(/^dualstack\./, "") !== ID.alb) return "The alias should point at the load balancer's DNS name.";
          var k = idx(r, /change-resource-record-sets/);
          return after(r, k, /\b(dig|host|nslookup)\b.*shop\.kestrel\.example\.com/, function (e) { return outHas(e, /192\.0\.2\.2[01]/); }) ? true : "Check the name with dig after the change.";
        }
      }
    ],
    solution: ["aws elbv2 describe-target-groups --names kestrel-web-tg --query 'TargetGroups[0].[TargetGroupArn, HealthCheckPath]' --output text",
      "aws elbv2 describe-target-health --target-group-arn " + ID.tg, "echo Target.ResponseCodeMismatch > ~/reason.txt",
      "aws ssm start-session --target " + ID.web1, "curl -s -o /dev/null -w '%{http_code}' http://localhost/health", "curl -s http://localhost/healthz", "exit",
      "aws elbv2 modify-target-group --target-group-arn " + ID.tg + " --health-check-path /healthz",
      "aws elbv2 describe-target-health --target-group-arn " + ID.tg + " --query 'TargetHealthDescriptions[].TargetHealth.Reason' --output text",
      "aws ec2 authorize-security-group-ingress --group-id " + ID.sg("web") + " --protocol tcp --port 80 --source-group " + ID.sg("alb"),
      "aws ec2 revoke-security-group-ingress --group-id " + ID.sg("web") + " --protocol tcp --port 80 --cidr 10.0.1.0/24",
      "aws elbv2 describe-target-health --target-group-arn " + ID.tg + " --query 'TargetHealthDescriptions[].TargetHealth.State' --output text",
      "curl -s http://" + ID.alb + "/", "curl -s http://" + ID.alb + "/",
      "aws route53 list-hosted-zones --query 'HostedZones[].[Id, Name]' --output text",
      "nano ~/alias.json"].concat(ALIAS_JSON.map(function (l) { return "    " + l; })).concat([
      "aws route53 change-resource-record-sets --hosted-zone-id " + ID.zone + " --change-batch file://alias.json", "dig +short shop.kestrel.example.com"]).join("\n") + "\n",
    debrief: "<p>The health check was asking the wrong question (<code>/health</code> gets a 404 from the app), so the load balancer correctly refused to use either server. After that, the reason changed to <b>Target.Timeout</b>: the web servers accepted HTTP only from public-a's address range, but the load balancer also checks (and forwards) from its node in public-b. Allowing the load balancer's <b>security group</b> fixed it for every node, now and later.</p><p>The alias record follows the load balancer wherever its addresses go. Next: containers, on our own server.</p>",
    realworld: "aws elbv2 describe-target-health is the first command for any 502 or 503 from a load balancer. On a real move, lower the old record's TTL a day before.",
    quiz: [
      { q: "Targets show Target.ResponseCodeMismatch with code 404. Most likely?", options: ["The security group", "The health check path doesn't exist on the app", "DNS", "TLS"], answer: 1, why: "The target answered, with the wrong code." },
      { q: "Why allow the load balancer's security group rather than its subnet ranges?", options: ["Faster", "Its nodes and addresses change; the group rule follows them", "Required by AWS", "It encrypts"], answer: 1, why: "Roles, not addresses." },
      { q: "Why an alias record instead of an A record with the load balancer's IPs?", options: ["Cheaper", "The load balancer's addresses change; the alias follows its name", "Aliases are faster", "A records can't point at AWS"], answer: 1, why: "Never hard-code a load balancer's addresses." }
    ]
  });

  /* ================================================================== NET-504 Docker networking */
  var UFW_BASE = [["22", "any"], ["80", "any"], ["443", "any"]];
  function dockerSys(sys) {
    N.dockerLab(sys, function (s) {
      var f = M4.fw(s); f.enabled = true; f.def.incoming = "deny";
      UFW_BASE.forEach(function (x) { f.rules.push({ dir: "in", port: x[0], proto: "tcp", from: x[1], to: "any", app: null, action: "allow", v6: false }, { dir: "in", port: x[0], proto: "tcp", from: x[1], to: "any", app: null, action: "allow", v6: true }); });
      // the api was started first and remembers the cache's old address; the cache was recreated yesterday
      N.docker.addCtr(s, { name: "api", image: "kestrel/orders-api:2.3", env: { REDIS_HOST: "172.17.0.2" }, ports: [{ hostIp: "0.0.0.0", hostPort: 8000, ctrPort: 8000, proto: "tcp" }], created: NOW - 9 * DAY });
      N.docker.addCtr(s, { name: "cache", image: "redis:7", ports: [{ hostIp: "0.0.0.0", hostPort: 6379, ctrPort: 6379, proto: "tcp" }], created: NOW - DAY });
    });
  }
  function ctr(r, n) { return N.docker.ctrByName(N.docker.dock(r.sys), n); }
  LABS.push({
    id: "net-504", n: 43, module: 5, ticket: "NET-504", xp: 200, layer: "L3–4",
    title: "Containers have networks too",
    topic: "Docker bridge networks, container DNS on user-defined networks, publishing ports with -p, why published ports skip ufw, DOCKER-USER",
    from: DEV,
    story: "<p>The orders API and its Redis cache run in Docker on kc-web-01. ufw denies everything except SSH and the web site, so Ben published both containers' ports \"to make them reachable\". Two problems:</p><ul><li>The office scanner says Redis is reachable on <b>6379</b>, whatever ufw says.</li><li>The API is broken since the cache was recreated yesterday: it talks to the cache by its <b>old IP address</b>.</li></ul><p>Put both on a proper network, keep Redis private, and let only the office reach the API.</p>",
    learn:
      "<h3>Docker's networks</h3>" + '<table class="t"><tr><th>Network</th><th>Containers can…</th></tr><tr><td>default <code>bridge</code> (docker0, 172.17.0.0/16)</td><td>talk by IP only; no names</td></tr><tr><td>your own: <code>docker network create kestrel</code></td><td>find each other <b>by container name</b> (Docker\'s DNS at 127.0.0.11) and are isolated from other networks</td></tr></table>' +
      code("docker network create kestrel\ndocker run -d --name cache --network kestrel redis:7                 # no -p: only containers on 'kestrel' reach it\ndocker run -d --name api --network kestrel -e REDIS_HOST=cache -p 8000:8000 kestrel/orders-api:2.3\ndocker exec api nc -zv cache 6379") +
      "<h3>-p and the firewall</h3><p><code>-p 6379:6379</code> makes Docker add a NAT rule (DNAT) in the <code>nat</code> table: packets for port 6379 are rewritten to the container and take the <b>FORWARD</b> path. ufw's rules are on the INPUT path, so they never see them. <code>-p 127.0.0.1:6379:6379</code> publishes on localhost only.</p>" +
      code("sudo iptables -t nat -L DOCKER -n                   # Docker's port rules\nsudo iptables -I DOCKER-USER -i eth0 ! -s 10.20.5.0/24 -p tcp --dport 8000 -j DROP\nsudo iptables -L DOCKER-USER -n --line-numbers") +
      "<p><b>DOCKER-USER</b> is the chain Docker leaves for you: it's checked before Docker's own rules for every forwarded packet. (Rules there match the <i>container</i> port; when it differs from the host port, use <code>-m conntrack --ctorigdstport</code>.)</p>" +
      '<div class="callout">dev is in the <code>docker</code> group, so docker works without sudo. Being in that group is as good as root: anyone who can run containers can mount <code>/</code>.</div>',
    system: dockerSys,
    diagram: ["mon", "scan"],
    starter: "",
    objectives: [
      {
        id: "exposed", text: "From <b>kc-mon-01</b>, scan kc-web-01's ports 6379 and 8000. Write the ones that are open to <code>~/exposed.txt</code>.",
        hints: ["ssh kc-mon-01 nmap -p 6379,8000 kc-web-01", "ssh kc-mon-01 nmap -p 6379,8000 kc-web-01\necho '6379 8000' > ~/exposed.txt"],
        check: function (r) { if (!ran(r, /ssh\s+kc-mon-01\b.*\bnmap\b/, function (e) { return outHas(e, /6379\/tcp\s+open/); })) return "Scan from kc-mon-01 (ssh kc-mon-01 nmap -p 6379,8000 kc-web-01)."; var n = (r.read("exposed.txt") || "").split(/[\s,]+/).filter(Boolean).sort().join(","); return n === "6379,8000" ? true : "Which of the two did nmap report as open?"; }
      },
      {
        id: "why", text: "Show the <b>NAT rules</b> Docker added for the published ports.",
        hints: ["They're in the nat table, chain DOCKER (as root).", "sudo iptables -t nat -L DOCKER -n"],
        check: function (r) { return ran(r, /\biptables\b.*-t\s+nat/, function (e) { return outHas(e, /DNAT.*dpt:6379/); }) ? true : "List the nat table's DOCKER chain (sudo iptables -t nat -L DOCKER -n)."; }
      },
      {
        id: "network", text: "Recreate both containers on a new network <code>kestrel</code>: the API finds the cache <b>by name</b>, the cache publishes <b>no</b> ports, the API still publishes 8000. <code>curl localhost:8000/health</code> must say <code>connected</code>.",
        hints: ["docker network create kestrel; docker rm -f the two; docker run them again with --network kestrel (and REDIS_HOST=cache for the API).", "docker network create kestrel\ndocker rm -f cache api\ndocker run -d --name cache --network kestrel redis:7\ndocker run -d --name api --network kestrel -e REDIS_HOST=cache -p 8000:8000 kestrel/orders-api:2.3\ncurl -s localhost:8000/health"],
        check: function (r) {
          var d = N.docker.dock(r.sys), net = N.docker.netByName(d, "kestrel"); if (!net || net.name !== "kestrel") return "Create the network: docker network create kestrel.";
          var c = ctr(r, "cache"), a = ctr(r, "api"); if (!c || c.name !== "cache" || !a || a.name !== "api") return "Run two containers named cache and api.";
          if (c.status !== "running" || a.status !== "running") return "Both containers must be running.";
          if (![c, a].every(function (x) { return x.nets.some(function (n) { return n.name === "kestrel"; }); })) return "Put both on the kestrel network.";
          if (c.ports.length) return "The cache publishes " + c.ports.map(function (p) { return p.hostIp + ":" + p.hostPort; }).join(", ") + ": it doesn't need to; the API reaches it over the network.";
          if (!a.ports.some(function (p) { return p.hostPort === 8000; })) return "The API must still publish port 8000.";
          if (/^\d/.test(a.env.REDIS_HOST || "")) return "Use the cache's name, not an IP address: addresses change when containers are recreated.";
          var ok = N.docker.redisOk(r.sys, a); if (!ok.ok) return "The API can't reach Redis: " + ok.why;
          return ran(r, /\bcurl\b.*:8000\/health/, function (e) { return outHas(e, /"redis":"connected"/); }) ? true : "Check the API: curl -s localhost:8000/health.";
        }
      },
      {
        id: "office", text: "Port 8000 must answer the office (<code>10.20.5.0/24</code>) only. ufw can't do it here: add a <b>DOCKER-USER</b> rule.",
        hints: ["Drop packets for port 8000 that come in on eth0 from anywhere but the office.", "sudo iptables -I DOCKER-USER -i eth0 ! -s 10.20.5.0/24 -p tcp --dport 8000 -j DROP\nsudo iptables -L DOCKER-USER -n --line-numbers"],
        check: function (r) { if (N.fwVerdict(r.sys, MON, 8000, "tcp", false, ME) !== "accept") return "The office (kc-mon-01, 10.20.5.10) can't reach 8000 any more."; if (N.fwVerdict(r.sys, EXT, 8000, "tcp", false, ME) === "accept") return "The internet can still reach 8000."; return N.fwVerdict(r.sys, "10.20.0.45", 8000, "tcp", false, ME) === "accept" ? "Other servers on the LAN can still reach 8000: only the office." : true; }
      },
      {
        id: "prove", text: "Prove it: scan 6379 and 8000 again from <b>kc-mon-01</b> (only 8000 open) and from <b>ext-scan-01</b> against <code>kestrel.example.com</code> (neither open).",
        hints: ["The same scan as the first task, plus the one from the internet.", "ssh kc-mon-01 nmap -p 6379,8000 kc-web-01\nssh ext-scan-01.example.net nmap -Pn -p 6379,8000 kestrel.example.com"],
        check: function (r) {
          var k = Math.max(idx(r, /DOCKER-USER/), idx(r, /docker\s+run/));
          if (!after(r, k, /ssh\s+kc-mon-01\b.*\bnmap\b/, function (e) { return outHas(e, /8000\/tcp\s+open/) && !outHas(e, /6379\/tcp\s+open/); })) return "Scan from kc-mon-01 after your changes: 8000 open, 6379 not.";
          return after(r, k, /ssh\s+ext-scan-01.*\bnmap\b/, function (e) { return outHas(e, /8000\/tcp\s+filtered/) && !outHas(e, /6379\/tcp\s+open/); }) ? true : "Scan from ext-scan-01 too (nmap -Pn -p 6379,8000 kestrel.example.com): 8000 should be filtered.";
        }
      }
    ],
    solution: lines("docker ps", "sudo ufw status", "ssh kc-mon-01 nmap -p 6379,8000 kc-web-01", "echo '6379 8000' > ~/exposed.txt", "sudo iptables -t nat -L DOCKER -n", "curl -s localhost:8000/health",
      "docker network create kestrel", "docker rm -f cache api", "docker run -d --name cache --network kestrel redis:7", "docker run -d --name api --network kestrel -e REDIS_HOST=cache -p 8000:8000 kestrel/orders-api:2.3",
      "docker exec api nc -zv cache 6379", "curl -s localhost:8000/health",
      "sudo iptables -I DOCKER-USER -i eth0 ! -s 10.20.5.0/24 -p tcp --dport 8000 -j DROP", "sudo iptables -L DOCKER-USER -n --line-numbers",
      "ssh kc-mon-01 nmap -p 6379,8000 kc-web-01", "ssh ext-scan-01.example.net nmap -Pn -p 6379,8000 kestrel.example.com"),
    debrief: "<p>Two classic container mistakes, fixed. A <b>published port is a hole in the host firewall</b>: Docker's DNAT sends the traffic down the FORWARD path, which ufw never inspects, so Redis was open to the office (and, on a cloud VM, to the internet). Now the cache isn't published at all, and the API is limited in DOCKER-USER, the chain Docker leaves for you.</p><p>And containers should find each other <b>by name</b> on a user-defined network: IPs change every time a container is recreated. Next: who talks to whom in the VPC, from its flow logs.</p>",
    realworld: "On any Docker host: sudo ss -tlnp | grep docker-proxy lists what's published, and sudo iptables -t nat -L DOCKER -n shows the rules ufw doesn't see. In Compose, leave out ports: for services only other containers use.",
    quiz: [
      { q: "ufw denies 6379, yet a container published with -p 6379:6379 is reachable. Why?", options: ["ufw is broken", "Docker's DNAT sends the traffic through FORWARD, which ufw's INPUT rules never see", "Redis bypasses firewalls", "IPv6"], answer: 1, why: "Published ports skip the host's INPUT chain." },
      { q: "How should the API reach the cache?", options: ["By the cache's IP", "By name, on a user-defined network", "Through the host's port 6379", "With --link"], answer: 1, why: "Names survive recreation; IPs don't." },
      { q: "Where do you filter traffic to published ports?", options: ["ufw", "The DOCKER-USER chain", "The DOCKER chain (Docker rewrites it)", "/etc/hosts"], answer: 1, why: "Docker leaves DOCKER-USER alone and checks it first." }
    ]
  });

  /* ================================================================== NET-505 VPC flow logs */
  var FL_FILE = "/home/dev/flows/flows-2026-11-10.log", ROLE = "arn:aws:iam::111122223333:role/kestrel-flow-logs";
  function rnd(seed, n) { return (M2.hash("fl" + seed) >>> 0) % n; }
  // one night of traffic on the VPC's interfaces; v changes who scans and who sends data out
  function night(c, v) {
    var R = [], T0 = Date.UTC(2026, 10, 10) / 1000, I = function (n) { return C5.instNamed(c, n); }, bast = I("bastion-1"), db = I("db-1");
    for (var k = 0; k < 72; k++) {
      var t = T0 + k * 300, w = I(k % 2 ? "web-2" : "web-1"), node = k % 4 < 2 ? "10.0.1.100" : "10.0.2.100";
      R.push([w.eni, node, w.ip, 40000 + rnd(k, 20000), 80, 6, 40 + rnd("p" + k, 60), 30000 + rnd("b" + k, 90000), t, t + 60, "ACCEPT"]);
      R.push([db.eni, w.ip, db.ip, 45000 + rnd("d" + k, 15000), 5432, 6, 20 + rnd("q" + k, 30), 8000 + rnd("r" + k, 20000), t + 5, t + 65, "ACCEPT"]);
    }
    ["web-1", "web-2", "db-1"].forEach(function (n, j) { var i = I(n); R.push([i.eni, i.ip, "185.125.190.36", 50000 + j, 80, 6, 900 + j, 1200000 + j * 5000, T0 + 20700 + j * 60, T0 + 20760 + j * 60, "ACCEPT"]); });
    ["203.0.113.7", "198.51.100.140", "192.0.2.201", "203.0.113.188", "198.51.100.33"].forEach(function (ip, j) { [23, 3389, 445, 8080].forEach(function (p, q) { if ((j + q) % 2) R.push([bast.eni, ip, bast.ip, 40000 + rnd(ip + p, 20000), p, 6, 1, 44, T0 + 3600 * (j + 1) + q * 7, T0 + 3600 * (j + 1) + q * 7 + 60, "REJECT"]); }); });
    [21, 22, 23, 25, 53, 80, 110, 111, 135, 139, 143, 443, 445, 993, 995, 1433, 1723, 3306, 3389, 5432, 5900, 6379, 8080, 8443, 9200, 27017].forEach(function (p, q) { R.push([bast.eni, v.scanner, bast.ip, 61000 + q, p, 6, 1, 44, T0 + 4320 + q, T0 + 4380 + q, p === 22 ? "ACCEPT" : "REJECT"]); });
    for (var b = 0; b < 12; b++) R.push([bast.eni, v.scanner, bast.ip, 52000 + b * 7, 22, 6, 14 + rnd("s" + b, 9), 2900 + rnd("sb" + b, 900), T0 + 4500 + b * 120, T0 + 4560 + b * 120, "ACCEPT"]);
    var ex2 = I(v.exfilFrom);
    for (var x = 0; x < 6; x++) R.push([ex2.eni, ex2.ip, v.exfilTo, 47000 + x, 443, 6, 280000 + rnd("x" + x, 40000), 390000000 + rnd("xb" + x, 50000000), T0 + 11400 + x * 180, T0 + 11460 + x * 180, "ACCEPT"]);
    return R;
  }
  function flowSys(v) {
    return function (sys) {
      var c = N.cloudLab(sys);
      C5.addRule(c.G.bastion, C5.rule(false, "tcp", 22, 22, "0.0.0.0/0", "SSH from anywhere"));
      c.flowLogs.push({ FlowLogId: C5.hid("fl", "rejects"), CreationTime: "2026-08-02T10:14:07.000Z", DeliverLogsStatus: "SUCCESS", FlowLogStatus: "ACTIVE", ResourceId: c.vpc.VpcId, TrafficType: "REJECT", LogDestinationType: "cloud-watch-logs", LogGroupName: C5.FL_GROUP, DeliverLogsPermissionArn: ROLE, LogFormat: "${version} ${account-id} ${interface-id} ${srcaddr} ${dstaddr} ${srcport} ${dstport} ${protocol} ${packets} ${bytes} ${start} ${end} ${action} ${log-status}", MaxAggregationInterval: 600 });
      S.mkdirs(sys, "/home/dev/flows", 493, 1000, 1000);
      C5.putFlowLogs(sys, night(c, v), FL_FILE);
      return c;
    };
  }
  var FLOWS_A = { scanner: "198.51.100.77", exfilFrom: "web-2", exfilTo: "203.0.113.199" }, FLOWS_B = { scanner: "198.51.100.91", exfilFrom: "web-1", exfilTo: "198.51.100.150" };
  var flowsA = flowSys(FLOWS_A), flowsB = flowSys(FLOWS_B);
  function trueV(r) { return r.read(FL_FILE) && r.read(FL_FILE).indexOf("198.51.100.91") >= 0 ? FLOWS_B : FLOWS_A; }
  var PATTERN = "[version, account, eni, src, dst, srcport, dstport=22, protocol, packets, bytes, start, end, action=ACCEPT, status]";
  LABS.push({
    id: "net-505", n: 44, module: 5, ticket: "NET-505", xp: 200, layer: "L3–4",
    title: "Who talked to whom",
    topic: "VPC flow logs: what they record (and don't), the record format, ACCEPT vs REJECT, finding scans and exfiltration with awk and CloudWatch Logs filters",
    from: DEV,
    story: "<p>Our VPC flow log only records <b>REJECT</b>ed traffic, to save money. That's why nobody noticed anything last night. For an investigation, I captured <b>everything</b> on every interface for the night and exported it to <code>~/flows/</code> (it's in CloudWatch Logs too).</p><p>Find out who scanned us, whether they got in anywhere, and whether data left the VPC. Then make the permanent flow log record all traffic.</p>",
    learn:
      "<h3>A flow log record</h3>" + code("2 111122223333 eni-0a1b… 198.51.100.77 10.0.1.10 61003 23 6 1 44 1794356723 1794356783 REJECT OK\n1   2            3        4             5         6     7  8 9 10 11         12         13     14") +
      '<table class="t"><tr><th>Field</th><th></th><th>Field</th><th></th></tr><tr><td>3</td><td>the network interface (ENI) it was seen on</td><td>8</td><td>protocol (6 TCP, 17 UDP, 1 ICMP)</td></tr><tr><td>4, 5</td><td>source, destination address</td><td>9, 10</td><td>packets, bytes in that window</td></tr><tr><td>6, 7</td><td>source, destination port</td><td>13</td><td><b>ACCEPT</b> or <b>REJECT</b> (by a security group or network ACL)</td></tr></table>' +
      "<p>Flow logs are metadata: who, where, how much, allowed or not. No payloads. They're the cloud's version of the conn.log you met with Zeek.</p>" +
      code("awk '$13 == \"REJECT\" {print $4}' ~/flows/flows-2026-11-10.log | sort | uniq -c | sort -rn | head\nawk '$13 == \"ACCEPT\" {sum[$3\" \"$5] += $10} END {for (k in sum) print sum[k], k}' FILE | sort -rn | head -3\naws ec2 describe-network-interfaces --network-interface-ids eni-… --query 'NetworkInterfaces[0].Attachment.InstanceId'") +
      "<h3>Searching in CloudWatch Logs</h3>" + code("aws logs filter-log-events --log-group-name /kestrel/vpc-flow-logs --filter-pattern '" + PATTERN + "' --query 'events[].message' --output text") +
      "<p>The space-delimited pattern names each field and puts conditions on some (<code>dstport=22</code>, <code>action=REJECT</code>, <code>bytes&gt;1000000</code>).</p>" +
      code("aws ec2 create-flow-logs --resource-type VPC --resource-ids vpc-… --traffic-type ALL \\\n    --log-destination-type cloud-watch-logs --log-group-name /kestrel/vpc-flow-logs \\\n    --deliver-logs-permission-arn " + ROLE + "\naws ec2 delete-flow-logs --flow-log-ids fl-…"),
    system: flowsA,
    diagram: ["vpc"],
    starter: "",
    objectives: [
      {
        id: "scanner", text: "Which outside address <b>scanned</b> the bastion (rejected on many different ports)? Write it to <code>~/scanner.txt</code>.",
        hints: ["Count REJECTed records per source address.", "awk '$13 == \"REJECT\" {print $4}' ~/flows/flows-2026-11-10.log | sort | uniq -c | sort -rn | head -3\necho 198.51.100.77 > ~/scanner.txt"],
        check: function (r) { var p = NH.printedIn(r, function (x) { return [trueV(x).scanner]; }, { system: flowsB }, function (e) { return /flows|filter-log-events/.test(e.cmd) && /REJECT|uniq|sort/.test(e.cmd); }, "Count the REJECTed records per source address.", "Your command has to find the scanner, not just print a fixed address."); if (p !== true) return p; return word(r, "scanner.txt") === trueV(r).scanner ? true : "That isn't the address with the most rejected ports."; }
      },
      {
        id: "in", text: "Did the scanner get <b>accepted</b> anywhere? Write that port to <code>~/scanner-port.txt</code>, then close it to the internet (keep the office's SSH rule).",
        hints: ["Its ACCEPT records; then the bastion's security group.", "grep 198.51.100.77 ~/flows/flows-2026-11-10.log | awk '$13 == \"ACCEPT\" {print $7}' | sort | uniq -c\necho 22 > ~/scanner-port.txt\naws ec2 revoke-security-group-ingress --group-id " + ID.sg("bastion") + " --protocol tcp --port 22 --cidr 0.0.0.0/0"],
        check: function (r) { if (!ran(r, /flows|filter-log-events/, function (e) { return /ACCEPT/.test(e.cmd) && outHas(e, /\b22\b/); })) return "Look at the scanner's ACCEPT records."; if (word(r, "scanner-port.txt") !== "22") return "Which port did it get through on?"; var g = sgOf(r, "bastion"); if (worldIn(g, 22)) return "Port 22 of the bastion is still open to the internet."; return g.rules.some(function (x) { return !x.egress && x.cidr === OFFICE_NAT + "/32"; }) ? true : "Keep the office's SSH rule."; }
      },
      {
        id: "exfil", text: "Which <b>instance</b> sent the most data out of the VPC, and <b>where to</b>? Write its instance ID and the destination address to <code>~/exfil.txt</code>.",
        hints: ["Add up bytes per (interface, destination) for ACCEPT records; then turn the ENI into an instance ID.", "awk '$13 == \"ACCEPT\" {sum[$3\" \"$5] += $10} END {for (k in sum) print sum[k], k}' ~/flows/flows-2026-11-10.log | sort -rn | head -3\naws ec2 describe-network-interfaces --network-interface-ids ENI --query 'NetworkInterfaces[0].Attachment.InstanceId' --output text\necho '" + ID.web2 + " 203.0.113.199' > ~/exfil.txt"],
        check: function (r) {
          var v = trueV(r), inst = iid(v.exfilFrom), eni = C5.instNamed(cl(r), v.exfilFrom).eni;
          var p = NH.printedIn(r, function (x) { var vv = trueV(x); return [C5.instNamed(x.sys.cloud, vv.exfilFrom).eni, vv.exfilTo]; }, { system: flowsB }, function (e) { return /flows|filter-log-events/.test(e.cmd); }, "Add up the bytes per interface and destination (awk with an array, then sort -rn).", "Your command has to find the biggest sender, not print a fixed one.");
          if (p !== true) return p;
          if (!ran(r, /describe-network-interfaces|describe-instances/, function (e) { return outHas(e, new RegExp(inst)); })) return "Turn " + eni + " into an instance ID with aws ec2 describe-network-interfaces.";
          var t = r.read("exfil.txt") || ""; return t.indexOf(inst) >= 0 && t.indexOf(v.exfilTo) >= 0 ? true : "Write the instance ID (i-…) and the destination address.";
        }
      },
      {
        id: "filter", text: "In CloudWatch Logs, show only the <b>accepted SSH</b> connections (who got in on port 22?) with one <code>filter-log-events</code> pattern.",
        hints: ["A space-delimited pattern with dstport=22 and action=ACCEPT.", "aws logs filter-log-events --log-group-name /kestrel/vpc-flow-logs --filter-pattern '" + PATTERN + "' --query 'events[].message' --output text"],
        check: function (r) { return awsRan(r, /filter-log-events/, function (e) { var t = e.out.join("\n"); var msgs = t.match(/2 111122223333 eni-\S+ \S+ \S+ \d+ \d+ \d+ \d+ \d+ \d+ \d+ (ACCEPT|REJECT) OK/g) || []; return msgs.length > 0 && msgs.every(function (m) { var f = m.split(" "); return f[6] === "22" && f[12] === "ACCEPT"; }); }) ? true : "Filter so that every event is dstport 22 and ACCEPT (and there is at least one)."; }
      },
      {
        id: "all", text: "Make the permanent flow log useful: a VPC flow log for <b>ALL</b> traffic into <code>/kestrel/vpc-flow-logs</code> (role <code>" + ROLE + "</code>), and delete the REJECT-only one.",
        hints: ["create-flow-logs with --traffic-type ALL, then delete-flow-logs for the old ID (describe-flow-logs).", "aws ec2 create-flow-logs --resource-type VPC --resource-ids " + ID.vpc + " --traffic-type ALL --log-destination-type cloud-watch-logs --log-group-name /kestrel/vpc-flow-logs --deliver-logs-permission-arn " + ROLE + "\naws ec2 delete-flow-logs --flow-log-ids " + C5.hid("fl", "rejects")],
        check: function (r) { var c = cl(r), all = c.flowLogs.filter(function (f) { return f.ResourceId === ID.vpc && f.TrafficType === "ALL" && f.LogGroupName === C5.FL_GROUP; }); if (!all.length) return "No VPC flow log for ALL traffic into /kestrel/vpc-flow-logs yet."; return c.flowLogs.some(function (f) { return f.TrafficType === "REJECT"; }) ? "Delete the REJECT-only flow log (it would log the same rejects twice)." : true; }
      }
    ],
    solution: lines("head -3 " + FL_FILE, "awk '$13 == \"REJECT\" {print $4}' " + FL_FILE + " | sort | uniq -c | sort -rn | head -3", "echo 198.51.100.77 > ~/scanner.txt",
      "grep 198.51.100.77 " + FL_FILE + " | awk '$13 == \"ACCEPT\" {print $7}' | sort | uniq -c", "echo 22 > ~/scanner-port.txt",
      "aws ec2 revoke-security-group-ingress --group-id " + ID.sg("bastion") + " --protocol tcp --port 22 --cidr 0.0.0.0/0",
      "awk '$13 == \"ACCEPT\" {sum[$3\" \"$5] += $10} END {for (k in sum) print sum[k], k}' " + FL_FILE + " | sort -rn | head -3",
      "aws ec2 describe-network-interfaces --network-interface-ids " + "eni-0" + M2.hexOf("eni:web-2", 16) + " --query 'NetworkInterfaces[0].Attachment.InstanceId' --output text",
      "echo '" + ID.web2 + " 203.0.113.199' > ~/exfil.txt",
      "aws logs filter-log-events --log-group-name /kestrel/vpc-flow-logs --filter-pattern '" + PATTERN + "' --query 'events[].message' --output text",
      "aws ec2 describe-flow-logs --query 'FlowLogs[].[FlowLogId, TrafficType]' --output text",
      "aws ec2 create-flow-logs --resource-type VPC --resource-ids " + ID.vpc + " --traffic-type ALL --log-destination-type cloud-watch-logs --log-group-name /kestrel/vpc-flow-logs --deliver-logs-permission-arn " + ROLE,
      "aws ec2 delete-flow-logs --flow-log-ids " + C5.hid("fl", "rejects")),
    debrief: "<p>A scan is easy to spot: one source, many destination ports, mostly REJECT. The dangerous line was the one <b>ACCEPT</b> among them: SSH open to the world on the bastion, followed by a dozen more SSH connections. And web-2 sent about 2.4 GB to one address in twenty minutes at 3 a.m., which a REJECT-only flow log could never have shown: allowed traffic is where incidents hide.</p><p>Flow logs give you who, where and how much. They don't show what was said, which is why encryption and the next lab's identities matter. Next: services that prove who they are.</p>",
    realworld: "Athena or CloudWatch Logs Insights run the same queries over months of flow logs: \"top talkers to the internet\" and \"rejected by destination port\" are standard detections.",
    quiz: [
      { q: "A flow log records only REJECT. What can't it show?", options: ["Port scans", "Data successfully leaving through an allowed connection", "Blocked SSH", "Anything"], answer: 1, why: "Exfiltration uses allowed paths." },
      { q: "What's in a flow log record?", options: ["The packets' contents", "Addresses, ports, protocol, packet and byte counts, accept/reject", "URLs", "Usernames"], answer: 1, why: "Metadata only." },
      { q: "Field 3 is an eni-… ID. How do you find the instance?", options: ["You can't", "aws ec2 describe-network-interfaces shows what it's attached to", "It's the hostname", "ping it"], answer: 1, why: "Interfaces are attached to instances (or load balancers, NAT gateways…)." }
    ]
  });

  LABS.forEach(function (l) { l.drills = l.drills || []; T.LABS.push(l); });
  T.M5 = { ID: ID, HOST: HOST, iid: iid, cl: cl, sgOf: sgOf, flowOk: flowOk, worldIn: worldIn, awsRan: awsRan, on: on, setRules: setRules, moveAssoc: moveAssoc, after: after, word: word,
    vpcSys: vpcSys, sgNaclSys: sgNaclSys, albSys: albSys, dockerSys: dockerSys, flowsA: flowsA, flowsB: flowsB, night: night, flowSys: flowSys, FL_FILE: FL_FILE, ROLE: ROLE, PATTERN: PATTERN, ALIAS_JSON: ALIAS_JSON, OFFICE_NAT: OFFICE_NAT, AWS_HELP: AWS_HELP, SSM_HELP: SSM_HELP };
})();
