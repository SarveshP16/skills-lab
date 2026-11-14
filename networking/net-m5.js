/* sudo learn — Networking Module 5: cloud networks. A simulated AWS account (one VPC with public, app and database
   subnets, route tables, an internet gateway and a NAT gateway, security groups, network ACLs, EC2 instances, a load
   balancer, Route 53, VPC flow logs) and a subset of the real `aws` CLI with --query (JMESPath), --filters and
   --output. Instances are real machines you open a shell on with `aws ssm start-session`; whether a packet gets
   through is worked out from the security groups, the network ACLs and the route tables, like in AWS. */
(function (root) {
  "use strict";
  var S = root.ShEngine, U = S.util, CMDS = S.CMDS, M2 = S.M2, M3 = S.M3, N = M2.NET, W = N.W;
  var out = U.out, errl = U.errl, note = U.note;
  var rd = M2.rd, putRoot = M2.putRoot, hash = M2.hash, NOW = S.NOW, DAY = S.DAY;
  var isV4 = N.isV4, ME = "10.20.0.15";
  var ACCOUNT = "111122223333", REGION = "eu-west-1", VPC_CIDR = "10.0.0.0/16";
  var OUR_NAT_IP = "203.0.113.15";   // kc-web-01 and the office leave the company network from this address

  /* ================================================================== helpers */
  function hid(prefix, seed, n) { return prefix + "-0" + M2.hexOf(prefix + ":" + seed, n || 16); }
  function ipn(ip) { return String(ip).split(".").reduce(function (a, b) { return a * 256 + (+b); }, 0); }
  function inCidr(ip, c) {
    if (!c || !isV4(ip)) return false;
    var m = String(c).split("/"), p = m[1] == null ? 32 : +m[1];
    if (!isV4(m[0])) return false;
    if (p === 0) return true;
    var sz = Math.pow(2, 32 - p);
    return Math.floor(ipn(ip) / sz) === Math.floor(ipn(m[0]) / sz);
  }
  function plen(c) { return +(String(c).split("/")[1] || 32); }
  function validCidr(c) { var m = /^(\d+)\.(\d+)\.(\d+)\.(\d+)\/(\d+)$/.exec(String(c || "")); return !!m && [1, 2, 3, 4].every(function (k) { return +m[k] <= 255; }) && +m[5] <= 32; }
  function iso(ms) { return new Date(ms).toISOString().replace(/\.\d{3}Z$/, "+00:00"); }
  function isoZ(ms) { return new Date(ms).toISOString().replace(/\.\d{3}Z$/, ".000Z"); }
  function tag(o, k) { var t = (o.Tags || []).filter(function (x) { return x.Key === k; })[0]; return t ? t.Value : null; }
  function nameTag(v) { return [{ Key: "Name", Value: v }]; }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function eph(seed) { return 32768 + (hash("eph" + seed) >>> 0) % 28000; }

  /* ================================================================== the AWS account */
  var SUBNETS = [
    ["public-a", "10.0.1.0/24", "eu-west-1a", true], ["public-b", "10.0.2.0/24", "eu-west-1b", true],
    ["app-a", "10.0.11.0/24", "eu-west-1a", false], ["app-b", "10.0.12.0/24", "eu-west-1b", false],
    ["db-a", "10.0.21.0/24", "eu-west-1a", false], ["db-b", "10.0.22.0/24", "eu-west-1b", false]
  ];
  // instances: name, private IP, subnet, public IP, security groups, role
  var INSTANCES = [
    ["bastion-1", "10.0.1.10", "public-a", "192.0.2.11", ["bastion"], "bastion"],
    ["web-1", "10.0.11.20", "app-a", null, ["web"], "web"],
    ["web-2", "10.0.12.20", "app-b", null, ["web"], "web"],
    ["db-1", "10.0.21.30", "db-a", null, ["db"], "db"],
    ["proxy-1", "10.0.2.50", "public-b", "192.0.2.12", ["proxy"], "proxy"]
  ];
  var ALB_NODES = { "public-a": { priv: "10.0.1.100", pub: "192.0.2.20" }, "public-b": { priv: "10.0.2.100", pub: "192.0.2.21" } };
  var ALB_DNS = "kestrel-shop-alb-1517254032.eu-west-1.elb.amazonaws.com", ALB_ZONE = "Z32O12XQLNTSW2";
  function hostOf(ip) { return "ip-" + ip.replace(/\./g, "-"); }

  function rule(egress, proto, from, to, peer, desc) {
    var r = { egress: !!egress, proto: String(proto), from: from == null ? null : +from, to: to == null ? null : +to, desc: desc || null };
    if (/^sg-/.test(peer)) r.sg = peer; else r.cidr = peer;
    return r;
  }
  function sgNamed(c, n) { return c.sgs.filter(function (g) { return g.key === n || g.GroupName === n || g.GroupId === n; })[0]; }
  function subnetNamed(c, n) { return c.subnets.filter(function (s) { return s.key === n || s.SubnetId === n || tag(s, "Name") === n; })[0]; }
  function rtNamed(c, n) { return c.rts.filter(function (t) { return t.key === n || t.RouteTableId === n || tag(t, "Name") === n; })[0]; }
  function aclNamed(c, n) { return c.acls.filter(function (t) { return t.key === n || t.NetworkAclId === n || tag(t, "Name") === n; })[0]; }
  function instNamed(c, n) { return c.insts.filter(function (i) { return i.name === n || i.InstanceId === n || i.ip === n || i.pub === n; })[0]; }
  function ruleId(g, r) { return "sgr-0" + M2.hexOf(g.GroupId + JSON.stringify([r.egress, r.proto, r.from, r.to, r.cidr, r.sg]), 16); }
  function addRule(g, r) { r.id = ruleId(g, r); g.rules.push(r); return r; }

  function build(home) {
    var c = { region: REGION, vpcs: [], subnets: [], rts: [], acls: [], sgs: [], insts: [], igws: [], nats: [], tgs: [], lbs: [], zones: [], flowLogs: [], logGroups: {}, snapshots: [], eips: [], enis: [], log: [] };
    var vpcId = hid("vpc", "prod");
    c.vpc = { VpcId: vpcId, CidrBlock: VPC_CIDR, State: "available", OwnerId: ACCOUNT, InstanceTenancy: "default", IsDefault: false, DhcpOptionsId: hid("dopt", "prod", 8), CidrBlockAssociationSet: [{ AssociationId: hid("vpc-cidr-assoc", "p", 16), CidrBlock: VPC_CIDR, CidrBlockState: { State: "associated" } }], Tags: nameTag("kestrel-prod") };
    c.vpcs.push(c.vpc);
    var dflt = { VpcId: hid("vpc", "default"), CidrBlock: "172.31.0.0/16", State: "available", OwnerId: ACCOUNT, InstanceTenancy: "default", IsDefault: true, DhcpOptionsId: hid("dopt", "d", 8), CidrBlockAssociationSet: [{ AssociationId: hid("vpc-cidr-assoc", "d", 16), CidrBlock: "172.31.0.0/16", CidrBlockState: { State: "associated" } }] };
    c.vpcs.push(dflt);
    SUBNETS.forEach(function (s) {
      var id = hid("subnet", s[0]);
      c.subnets.push({ key: s[0], SubnetId: id, VpcId: vpcId, CidrBlock: s[1], AvailabilityZone: s[2], AvailabilityZoneId: s[2] === "eu-west-1a" ? "euw1-az1" : "euw1-az2", AvailableIpAddressCount: 249, MapPublicIpOnLaunch: s[3], DefaultForAz: false, State: "available", OwnerId: ACCOUNT, SubnetArn: "arn:aws:ec2:" + REGION + ":" + ACCOUNT + ":subnet/" + id, Tags: nameTag("kestrel-prod-" + s[0]) });
    });
    var igw = { key: "igw", InternetGatewayId: hid("igw", "prod"), Attachments: [{ State: "available", VpcId: vpcId }], OwnerId: ACCOUNT, Tags: nameTag("kestrel-prod-igw") };
    c.igws.push(igw);
    var natEni = hid("eni", "nat");
    var nat = { key: "nat", NatGatewayId: hid("nat", "a"), SubnetId: subnetNamed(c, "public-a").SubnetId, VpcId: vpcId, State: "available", ConnectivityType: "public", CreateTime: iso(NOW - 120 * DAY), NatGatewayAddresses: [{ AllocationId: hid("eipalloc", "nat"), NetworkInterfaceId: natEni, PrivateIp: "10.0.1.5", PublicIp: "192.0.2.10", AssociationId: hid("eipassoc", "nat"), IsPrimary: true, Status: "succeeded" }], Tags: nameTag("kestrel-prod-nat-a") };
    c.nats.push(nat);
    function rt(key, name, routes, subs, main) {
      var id = hid("rtb", key), t = { key: key, RouteTableId: id, VpcId: vpcId, OwnerId: ACCOUNT, PropagatingVgws: [], Tags: nameTag(name), Routes: [{ DestinationCidrBlock: VPC_CIDR, GatewayId: "local", Origin: "CreateRouteTable", State: "active" }].concat(routes), Associations: [] };
      if (main) t.Associations.push({ Main: true, RouteTableAssociationId: hid("rtbassoc", key + "main"), RouteTableId: id, AssociationState: { State: "associated" } });
      subs.forEach(function (sn) { t.Associations.push({ Main: false, RouteTableAssociationId: hid("rtbassoc", key + sn), RouteTableId: id, SubnetId: subnetNamed(c, sn).SubnetId, AssociationState: { State: "associated" } }); });
      c.rts.push(t); return t;
    }
    rt("main", "kestrel-prod-main", [], [], true);
    rt("public", "kestrel-prod-public", [{ DestinationCidrBlock: "0.0.0.0/0", GatewayId: igw.InternetGatewayId, Origin: "CreateRoute", State: "active" }], ["public-a", "public-b"]);
    rt("private-a", "kestrel-prod-private-a", [{ DestinationCidrBlock: "0.0.0.0/0", NatGatewayId: nat.NatGatewayId, Origin: "CreateRoute", State: "active" }], ["app-a"]);
    rt("private-b", "kestrel-prod-private-b", [{ DestinationCidrBlock: "0.0.0.0/0", NatGatewayId: nat.NatGatewayId, Origin: "CreateRoute", State: "active" }], ["app-b"]);
    rt("db", "kestrel-prod-db", [], ["db-a", "db-b"]);
    // network ACLs: the default one allows everything, both ways
    function acl(key, name, isDefault, entries, subs) {
      var id = hid("acl", key), a = { key: key, NetworkAclId: id, VpcId: vpcId, IsDefault: isDefault, OwnerId: ACCOUNT, Tags: name ? nameTag(name) : [], Entries: entries, Associations: [] };
      subs.forEach(function (sn) { a.Associations.push({ NetworkAclAssociationId: hid("aclassoc", key + sn), NetworkAclId: id, SubnetId: subnetNamed(c, sn).SubnetId }); });
      c.acls.push(a); return a;
    }
    acl("default", null, true, allowAllEntries(), SUBNETS.map(function (s) { return s[0]; }));
    // security groups
    function sg(key, name, desc, rules) {
      var g = { key: key, GroupId: hid("sg", key), GroupName: name, Description: desc, VpcId: vpcId, OwnerId: ACCOUNT, Tags: nameTag(name), rules: [] };
      c.sgs.push(g);
      rules(g).forEach(function (r) { addRule(g, r); });
      addRule(g, rule(true, "-1", null, null, "0.0.0.0/0"));
      return g;
    }
    var G = {};
    G.def = sg("default", "default", "default VPC security group", function (g) { return [rule(false, "-1", null, null, g.GroupId)]; });
    G.alb = sg("alb", "kestrel-alb", "Public load balancer", function () { return [rule(false, "tcp", 80, 80, "0.0.0.0/0", "HTTP from anywhere"), rule(false, "tcp", 443, 443, "0.0.0.0/0", "HTTPS from anywhere")]; });
    G.bastion = sg("bastion", "kestrel-bastion", "SSH jump host", function () { return [rule(false, "tcp", 22, 22, OUR_NAT_IP + "/32", "SSH from the office")]; });
    G.web = sg("web", "kestrel-web", "Web servers", function () { return [rule(false, "tcp", 80, 80, G.alb.GroupId, "HTTP from the load balancer"), rule(false, "tcp", 22, 22, G.bastion.GroupId, "SSH from the bastion")]; });
    G.db = sg("db", "kestrel-db", "PostgreSQL", function () { return [rule(false, "tcp", 5432, 5432, G.web.GroupId, "PostgreSQL from the web servers"), rule(false, "tcp", 22, 22, G.bastion.GroupId, "SSH from the bastion")]; });
    G.proxy = sg("proxy", "kestrel-egress-proxy", "Outbound web proxy", function () { return [rule(false, "tcp", 3128, 3128, VPC_CIDR, "Proxy for the VPC")]; });
    // instances
    INSTANCES.forEach(function (d, k) {
      var sub = subnetNamed(c, d[2]), id = "i-0" + M2.hexOf("inst:" + d[0], 16);
      var i = { name: d[0], InstanceId: id, ip: d[1], pub: d[3], subnet: d[2], SubnetId: sub.SubnetId, sgs: d[4].map(function (x) { return G[x].GroupId; }), state: "running", role: d[5], eni: "eni-0" + M2.hexOf("eni:" + d[0], 16), vol: "vol-0" + M2.hexOf("vol:" + d[0], 16), type: d[5] === "db" ? "t3.large" : "t3.small", ami: "ami-0" + M2.hexOf("ami:noble", 16), launch: NOW - (60 - k * 5) * DAY, host: hostOf(d[1]), tags: [] };
      c.insts.push(i);
      c.enis.push({ id: i.eni, ip: i.ip, pub: i.pub, inst: id, subnet: sub.SubnetId, desc: "" });
    });
    // load balancer, target group
    var tgArn = "arn:aws:elasticloadbalancing:" + REGION + ":" + ACCOUNT + ":targetgroup/kestrel-web-tg/" + M2.hexOf("tg", 16);
    var lbArn = "arn:aws:elasticloadbalancing:" + REGION + ":" + ACCOUNT + ":loadbalancer/app/kestrel-shop-alb/" + M2.hexOf("alb", 16);
    c.tgs.push({ name: "kestrel-web-tg", arn: tgArn, port: 80, protocol: "HTTP", vpc: vpcId, hc: { path: "/healthz", port: "traffic-port", protocol: "HTTP", matcher: "200", interval: 30, timeout: 5, healthy: 5, unhealthy: 2 }, targets: [{ id: instNamed(c, "web-1").InstanceId, port: 80 }, { id: instNamed(c, "web-2").InstanceId, port: 80 }], lb: lbArn });
    c.lbs.push({ name: "kestrel-shop-alb", arn: lbArn, dns: ALB_DNS, zone: ALB_ZONE, scheme: "internet-facing", sgs: [G.alb.GroupId], nodes: ALB_NODES, created: NOW - 50 * DAY, listeners: [{ arn: lbArn.replace(":loadbalancer/", ":listener/") + "/" + M2.hexOf("l80", 16), port: 80, protocol: "HTTP", tg: tgArn }], rr: 0 });
    Object.keys(ALB_NODES).forEach(function (k) { c.enis.push({ id: "eni-0" + M2.hexOf("albeni" + k, 16), ip: ALB_NODES[k].priv, pub: ALB_NODES[k].pub, inst: null, subnet: subnetNamed(c, k).SubnetId, desc: "ELB app/kestrel-shop-alb/" + M2.hexOf("alb", 16), alb: k }); });
    c.enis.push({ id: natEni, ip: "10.0.1.5", pub: "192.0.2.10", inst: null, subnet: nat.SubnetId, desc: "Interface for NAT Gateway " + nat.NatGatewayId, nat: true });
    // Route 53
    c.zones.push({ Id: "/hostedzone/Z0" + M2.hexOf("zone", 12).toUpperCase(), Name: "kestrel.example.com.", CallerReference: "kestrel-2024", Config: { Comment: "Kestrel public zone", PrivateZone: false }, records: [
      { Name: "kestrel.example.com.", Type: "A", TTL: 300, ResourceRecords: [{ Value: "203.0.113.80" }] },
      { Name: "kestrel.example.com.", Type: "NS", TTL: 172800, ResourceRecords: [{ Value: "ns-1201.awsdns-22.org." }, { Value: "ns-310.awsdns-38.com." }] },
      { Name: "www.kestrel.example.com.", Type: "CNAME", TTL: 300, ResourceRecords: [{ Value: "kestrel.example.com" }] }
    ] });
    c.G = G; c.homeSys = home;
    home.cloud = c;
    syncDns(home);
    return c;
  }
  function allowAllEntries() {
    return [{ RuleNumber: 100, Protocol: "-1", RuleAction: "allow", Egress: false, CidrBlock: "0.0.0.0/0" }, { RuleNumber: 32767, Protocol: "-1", RuleAction: "deny", Egress: false, CidrBlock: "0.0.0.0/0" },
      { RuleNumber: 100, Protocol: "-1", RuleAction: "allow", Egress: true, CidrBlock: "0.0.0.0/0" }, { RuleNumber: 32767, Protocol: "-1", RuleAction: "deny", Egress: true, CidrBlock: "0.0.0.0/0" }];
  }
  function cloudOf(sys) { var h = N.homeOf ? N.homeOf(sys) : sys; return (h && h.cloud) || (sys && sys.cloud) || null; }
  function homeOf(sys) { return N.homeOf ? N.homeOf(sys) || sys : sys; }

  /* ================================================================== where a packet is allowed */
  function subnetOf(c, id) { return c.subnets.filter(function (s) { return s.SubnetId === id; })[0]; }
  function rtFor(c, subnetId) {
    var t = c.rts.filter(function (r) { return r.Associations.some(function (a) { return a.SubnetId === subnetId; }); })[0];
    return t || c.rts.filter(function (r) { return r.Associations.some(function (a) { return a.Main; }); })[0];
  }
  function routeTo(c, subnetId, ip) {
    var t = rtFor(c, subnetId); if (!t) return null;
    return t.Routes.filter(function (r) { return r.DestinationCidrBlock && inCidr(ip, r.DestinationCidrBlock); }).sort(function (a, b) { return plen(b.DestinationCidrBlock) - plen(a.DestinationCidrBlock); })[0] || null;
  }
  function aclFor(c, subnetId) { return c.acls.filter(function (a) { return a.Associations.some(function (x) { return x.SubnetId === subnetId; }); })[0]; }
  var PNUM = { tcp: "6", udp: "17", icmp: "1", "-1": "-1", all: "-1" };
  function aclCheck(a, egress, proto, port, peer) {
    if (!a) return { ok: true };
    var es = a.Entries.filter(function (e) { return !!e.Egress === !!egress; }).sort(function (x, y) { return x.RuleNumber - y.RuleNumber; });
    for (var i = 0; i < es.length; i++) {
      var e = es[i];
      if (e.Protocol !== "-1" && e.Protocol !== PNUM[proto]) continue;
      if (!inCidr(peer, e.CidrBlock)) continue;
      if (e.Protocol !== "-1" && proto !== "icmp" && e.PortRange && (port == null || port < e.PortRange.From || port > e.PortRange.To)) continue;
      return { ok: e.RuleAction === "allow", entry: e, acl: a };
    }
    return { ok: false, entry: null, acl: a };
  }
  function sgCheck(c, sgIds, egress, proto, port, peerIp, peerSgs) {
    var hit = null;
    sgIds.some(function (gid) {
      var g = sgNamed(c, gid); if (!g) return false;
      return g.rules.some(function (r) {
        if (r.egress !== !!egress) return false;
        if (r.proto !== "-1" && r.proto !== proto) return false;
        if (r.proto !== "-1" && proto !== "icmp" && r.from != null && r.from !== -1 && (port == null || port < r.from || port > r.to)) return false;
        if (r.cidr && !inCidr(peerIp, r.cidr)) return false;
        if (r.sg && (peerSgs || []).indexOf(r.sg) < 0) return false;
        hit = { g: g, r: r }; return true;
      });
    });
    return hit;
  }
  // an endpoint: an instance (by private or public IP), a load balancer node, the NAT gateway, or the internet
  function endpoint(c, ip) {
    var i = c.insts.filter(function (x) { return x.ip === ip || (x.pub && x.pub === ip); })[0];
    if (i) return { kind: "inst", inst: i, ip: i.ip, pub: i.pub, viaPub: ip === i.pub, subnet: i.SubnetId, sgs: i.state === "running" ? i.sgs : [], down: i.state !== "running" };
    var lb = c.lbs[0];
    if (lb) for (var k in lb.nodes) if (lb.nodes[k].priv === ip || lb.nodes[k].pub === ip) return { kind: "alb", lb: lb, node: k, ip: lb.nodes[k].priv, pub: lb.nodes[k].pub, viaPub: ip === lb.nodes[k].pub, subnet: subnetNamed(c, k).SubnetId, sgs: lb.sgs };
    if (inCidr(ip, VPC_CIDR)) return { kind: "none", ip: ip };
    return { kind: "internet", ip: ip };
  }
  function fail(at, why, extra) { return Object.assign({ ok: false, at: at, why: why }, extra || {}); }
  // src and dst are endpoints; port null for ICMP
  function flow(c, src, dst, port, proto) {
    proto = proto || "tcp";
    var sp = eph(src.ip + dst.ip + port);
    if (dst.kind === "none") return fail("host", "nothing has the address " + dst.ip + " in the VPC");
    if (src.kind !== "internet") {
      if (dst.kind !== "internet" && !dst.viaPub) {
        // inside the VPC
        if (dst.down) return fail("host", dst.inst.name + " is " + dst.inst.state);
        if (!sgCheck(c, src.sgs, true, proto, port, dst.ip, dst.sgs)) return fail("sg-out", "the security groups of the source don't allow this traffic out");
        if (src.subnet !== dst.subnet) {
          var a1 = aclCheck(aclFor(c, src.subnet), true, proto, port, dst.ip); if (!a1.ok) return fail("acl-out", "network ACL " + a1.acl.NetworkAclId + " (source subnet) denies it outbound", { acl: a1 });
          var a2 = aclCheck(aclFor(c, dst.subnet), false, proto, port, src.ip); if (!a2.ok) return fail("acl-in", "network ACL " + a2.acl.NetworkAclId + " (destination subnet) denies it inbound", { acl: a2 });
        }
        if (!sgCheck(c, dst.sgs, false, proto, port, src.ip, src.sgs)) return fail("sg-in", "the destination's security groups don't allow it in");
        if (src.subnet !== dst.subnet) {
          var a3 = aclCheck(aclFor(c, dst.subnet), true, proto, proto === "icmp" ? null : sp, src.ip); if (!a3.ok) return fail("acl-return", "network ACL " + a3.acl.NetworkAclId + " (destination subnet) drops the replies going back out to port " + sp, { acl: a3, eph: sp });
          var a4 = aclCheck(aclFor(c, src.subnet), false, proto, proto === "icmp" ? null : sp, dst.ip); if (!a4.ok) return fail("acl-return", "network ACL " + a4.acl.NetworkAclId + " (source subnet) drops the replies coming back in to port " + sp, { acl: a4, eph: sp });
        }
        return { ok: true, local: true };
      }
      // out to the internet (or to one of our own public addresses, the long way round)
      if (!sgCheck(c, src.sgs, true, proto, port, dst.ip, [])) return fail("sg-out", "the security groups of the source don't allow this traffic out");
      var b1 = aclCheck(aclFor(c, src.subnet), true, proto, port, dst.ip); if (!b1.ok) return fail("acl-out", "network ACL " + b1.acl.NetworkAclId + " denies it outbound", { acl: b1 });
      var rt = routeTo(c, src.subnet, dst.ip);
      if (!rt || rt.GatewayId === "local") return fail("route", "the route table of the subnet has no route to " + dst.ip);
      if (rt.State === "blackhole") return fail("route", "the route to " + rt.DestinationCidrBlock + " is a blackhole (its target is gone)");
      var outIp;
      if (rt.GatewayId && /^igw-/.test(rt.GatewayId)) { if (!src.pub) return fail("nopub", "the route goes to the internet gateway, but this instance has no public IP address"); outIp = src.pub; }
      else if (rt.NatGatewayId) {
        var nat = c.nats.filter(function (n) { return n.NatGatewayId === rt.NatGatewayId; })[0];
        if (!nat || nat.State !== "available") return fail("route", "the NAT gateway in the route isn't available");
        var nr = routeTo(c, nat.SubnetId, dst.ip); if (!nr || !/^igw-/.test(nr.GatewayId || "")) return fail("route", "the NAT gateway's subnet has no route to the internet gateway");
        if (nat.SubnetId !== src.subnet) {
          var n1 = aclCheck(aclFor(c, nat.SubnetId), false, proto, port, src.ip); if (!n1.ok) return fail("acl-in", "the NAT gateway's subnet ACL denies it", { acl: n1 });
        }
        var n2 = aclCheck(aclFor(c, nat.SubnetId), true, proto, port, dst.ip); if (!n2.ok) return fail("acl-out", "the NAT gateway's subnet ACL denies it outbound", { acl: n2 });
        outIp = nat.NatGatewayAddresses[0].PublicIp;
      } else return fail("route", "no usable route");
      var b2 = aclCheck(aclFor(c, src.subnet), false, proto, proto === "icmp" ? null : sp, dst.ip); if (!b2.ok) return fail("acl-return", "network ACL " + b2.acl.NetworkAclId + " drops the replies coming back in to port " + sp, { acl: b2, eph: sp });
      if (dst.viaPub) {   // hairpin: back in through the internet gateway to our own public address
        var back = flow(c, { kind: "internet", ip: outIp }, dst, port, proto);
        return back.ok ? Object.assign(back, { outIp: outIp }) : back;
      }
      return { ok: true, outIp: outIp, internet: true };
    }
    // from the internet, to a public address
    if (dst.kind === "internet") return { ok: true };
    if (!dst.viaPub) return fail("private", dst.ip + " is a private address: not reachable from the internet");
    if (dst.down) return fail("host", dst.inst.name + " is " + dst.inst.state);
    var r2 = routeTo(c, dst.subnet, src.ip); if (!r2 || !/^igw-/.test(r2.GatewayId || "")) return fail("route", "the subnet of " + dst.pub + " has no route back to the internet gateway");
    var c1 = aclCheck(aclFor(c, dst.subnet), false, proto, port, src.ip); if (!c1.ok) return fail("acl-in", "network ACL " + c1.acl.NetworkAclId + " denies it inbound", { acl: c1 });
    if (!sgCheck(c, dst.sgs, false, proto, port, src.ip, [])) return fail("sg-in", "the security groups don't allow it in");
    var c2 = aclCheck(aclFor(c, dst.subnet), true, proto, proto === "icmp" ? null : sp, src.ip); if (!c2.ok) return fail("acl-return", "network ACL " + c2.acl.NetworkAclId + " drops the replies going out to port " + sp, { acl: c2, eph: sp });
    return { ok: true };
  }

  /* ================================================================== instances are machines */
  var MACH = M2.MACHINES, HOSTS = M2.net.HOSTS;
  INSTANCES.forEach(function (d) {
    var h = hostOf(d[1]);
    MACH[h] = { ip: d[1], setup: instSetup(d[0], d[5]) };
    HOSTS[d[1]] = { ping: 0.4, ports: [], machine: h };
  });
  W.RESOLVERS.push("10.0.0.2");
  var APP_PAGES = {};   // per role: path -> [status, body]
  function instSetup(name, role) {
    return function (m) {
      m.vantage = "cloud"; m.cloudName = name; m.cloudRole = role;
      M2.writeRoot(m, "/etc/passwd", "ssm-user:x:1100:1100::/home/ssm-user:/bin/bash\nubuntu:x:1101:1101:Ubuntu:/home/ubuntu:/bin/bash\n", true);
      M2.writeRoot(m, "/etc/group", "ssm-user:x:1100:\nubuntu:x:1101:\n", true);
      ["ssm-user", "ubuntu"].forEach(function (u, k) { var d = S.mkdirs(m, "/home/" + u, 488, 1100 + k, 1100 + k); d.uid = 1100 + k; d.gid = 1100 + k; putRoot(m, "/home/" + u + "/.bashrc", rd(m, "/home/dev/.bashrc") || "", 420, 1100 + k, 1100 + k); });
      putRoot(m, "/etc/sudoers.d/ssm-agent-users", "# User rules for ssm-user\nssm-user ALL=(ALL) NOPASSWD:ALL\n", 288, 0, 0);
      putRoot(m, "/etc/cloud/cloud.cfg.d/90-instance.cfg", "# " + name + " (" + role + ")\n", 420, 0, 0);
      if (role === "web") {
        M2.spawn(m, { cmd: "/usr/bin/node /srv/shop/server.js", comm: "node", uid: 33, unitless: true, appRole: "shop", start: NOW - 9 * DAY, listen: [{ proto: "tcp", addr: "0.0.0.0", port: 80 }] });
        putRoot(m, "/srv/shop/server.js", "// Kestrel Shop front end (listens on :80)\n", 420, 0, 0);
      }
      if (role === "db") { N.riskyServices(m, ["postgres"], NOW - 60 * DAY); }
      if (N.cloudRoleSetup && N.cloudRoleSetup[role]) N.cloudRoleSetup[role](m);
    };
  }
  // the shop app on the web instances
  M2.appHandlers = M2.appHandlers || [];
  M2.appHandlers.push(function (sys, proc, req) {
    if (proc.appRole !== "shop") return null;
    var p = req.path.split("?")[0], extra = (sys.shopRoutes || {})[p];
    var hdr = { "Content-Type": "text/html; charset=utf-8", "X-Powered-By": "Express" };
    if (extra) return { status: extra[0], headers: Object.assign(hdr, extra[2] || {}), body: typeof extra[1] === "function" ? extra[1](sys, req) : extra[1] };
    if (p === "/healthz") return { status: 200, headers: { "Content-Type": "text/plain" }, body: "ok\n" };
    if (p === "/" || p === "/index.html") return { status: 200, headers: hdr, body: "<!doctype html><title>Kestrel Shop</title><h1>Kestrel Shop</h1><p>served by " + sys.cloudName + "</p>\n" };
    return { status: 404, headers: hdr, body: "<!DOCTYPE html>\n<html lang=\"en\"><head><title>Error</title></head><body><pre>Cannot GET " + p + "</pre></body></html>\n" };
  });
  S.POST_HOOKS.push(function (sys) {
    var nw = sys.nw; if (!nw || sys.vantage !== "cloud") return;
    var d = nw.ifs.eth0, sub = SUBNETS.filter(function (s) { return inCidr(sys.ip, s[1]); })[0];
    d.addrs = [{ ip: sys.ip, prefix: 24, scope: "global" }]; d.addrs6 = []; nw.noV6 = true; d.acceptRa = false; d.mtu = 9001;
    nw.routes = [{ dst: "0.0.0.0", prefix: 0, via: sub[1].replace(/\.0\/24$/, ".1"), dev: "eth0", proto: "dhcp", metric: 100 }];
    nw.linkDns.eth0 = { servers: ["10.0.0.2"], search: [REGION + ".compute.internal"] };
  });
  function instOfSys(c, sys) { return c.insts.filter(function (i) { return i.ip === sys.ip; })[0]; }
  function epOfSys(c, sys) {
    if (sys.vantage === "cloud") { var i = instOfSys(c, sys); return i ? endpoint(c, i.ip) : null; }
    return { kind: "internet", ip: sys.vantage === "internet" ? sys.ip : OUR_NAT_IP };
  }

  /* ================================================================== reachability hooks */
  function okReach(sys, dst, rtt, hops, node) { return { ok: true, dev: "eth0", src: sys.ip || ME, path: sys.vantage === "cloud" ? ["vpc"] : ["you", "sw", "gw", "inet", "vpc"], hops: hops || [{ ip: dst, rtt: rtt }], rtt: rtt, ttl: 64 - ((hops || []).length ? hops.length - 1 : 0), loss: 0, routeMtu: sys.vantage === "cloud" ? 9001 : 1500, node: node || "vpc" }; }
  function noReach(sys, why, f) { return { ok: false, err: "timeout", path: sys.vantage === "cloud" ? ["vpc"] : ["you", "sw", "gw", "inet"], fail: "vpc", hops: [], src: sys.ip || ME, dev: "eth0", cloudWhy: why, flow: f }; }
  function lastFlow(sys, f, src, dst, port, proto) { var h = homeOf(sys); if (h) { h.cloudLast = { flow: f, src: src.ip, dst: dst.ip, port: port, proto: proto }; } }
  var prevPreReach = N.preReach;
  N.preReach = function (sys, dst, o) {
    o = o || {};
    var c = cloudOf(sys);
    if (!c || !isV4(dst)) return prevPreReach ? prevPreReach(sys, dst, o) : null;
    var proto = o.port != null ? "tcp" : "icmp";
    if (sys.vantage === "cloud") {
      var me = instOfSys(c, sys); if (!me) return null;
      if (dst === sys.ip || /^127\./.test(dst)) return null;
      if (dst === "10.0.0.2" || dst === "169.254.169.254" || /^10\.0\.\d+\.1$/.test(dst)) return okReach(sys, dst, 0.12, null, "vpc");
      var src = endpoint(c, me.ip), to = endpoint(c, dst), f = flow(c, src, to, o.port, proto);
      if (!o.quiet) lastFlow(sys, f, src, to, o.port, proto);
      if (!f.ok) return noReach(sys, f.why, f);
      if (f.internet) {
        var hr = N.reach(homeOf(sys), dst, { quiet: true, port: o.port });
        if (!hr.ok) return noReach(sys, "no answer from " + dst);
        var hops = [{ ip: null, rtt: 0.4 }, { ip: null, rtt: 1.1 }].concat((hr.hops || []).slice(-2).map(function (h) { return { ip: h.ip, rtt: (h.rtt || 10) + 1.2 }; }));
        return okReach(sys, dst, (hr.rtt || 10) + 1.2, hops, "inet");
      }
      return okReach(sys, dst, 0.4, [{ ip: dst, rtt: 0.41 }], "vpc");
    }
    // kc-web-01, the office or the internet scanner, to an address of ours in AWS
    if (inCidr(dst, VPC_CIDR)) return noReach(sys, dst + " is a private address inside the AWS VPC: nothing outside it can reach it (no VPN)");
    var to2 = endpoint(c, dst);
    if (to2.kind === "inst" || to2.kind === "alb") {
      var from = epOfSys(c, sys), f2 = flow(c, from, to2, o.port, proto);
      if (!o.quiet) lastFlow(sys, f2, from, to2, o.port, proto);
      if (!f2.ok) return noReach(sys, f2.why, f2);
      var base = sys.vantage === "internet" ? 18.4 : 9.6;
      return okReach(sys, dst, base, [{ ip: sys.vantage === "internet" ? "198.51.100.193" : "10.20.0.1", rtt: 0.4 }, { ip: null, rtt: base - 1 }, { ip: dst, rtt: base }], "vpc");
    }
    return prevPreReach ? prevPreReach(sys, dst, o) : null;
  };
  var prevPreTcp = N.preTcp;
  N.preTcp = function (sys, ip, port, proto) {
    var c = cloudOf(sys);
    if (!c || !isV4(ip)) return prevPreTcp ? prevPreTcp(sys, ip, port, proto) : null;
    proto = proto || "tcp";
    var inCloud = sys.vantage === "cloud";
    if (inCloud && (ip === sys.ip || /^127\./.test(ip))) return null;
    if (inCloud && ip === "10.0.0.2") return null;
    var to = endpoint(c, ip);
    if (!inCloud && to.kind !== "inst" && to.kind !== "alb" && !inCidr(ip, VPC_CIDR)) return prevPreTcp ? prevPreTcp(sys, ip, port, proto) : null;
    var r = N.reach(sys, ip, { quiet: true, port: port });
    if (!r.ok) { var from0 = epOfSys(c, sys); if (from0) lastFlow(sys, r.flow || fail("route", r.cloudWhy || "unreachable"), from0, to, port, proto); return { err: "timeout", r: r, filtered: true, cloudWhy: r.cloudWhy }; }
    var from = epOfSys(c, sys);
    if (from) lastFlow(sys, { ok: true }, from, to, port, proto);
    if (to.kind === "inst") {
      var m = M2.machine(homeOf(sys), to.inst.ip);
      if (!m) return { err: "timeout", r: r };
      var cn = M2.tcpConnect(m, to.inst.ip, port);
      return cn.refused ? { err: "refused", r: r } : { ok: true, r: r, proc: cn.proc, remote: m, target: m };
    }
    if (to.kind === "alb") { var lb = to.lb; return lb.listeners.some(function (l) { return l.port === port; }) ? { ok: true, r: r, alb: lb } : { err: "timeout", r: r, filtered: true }; }
    if (to.kind === "internet") return null;
    return { err: "timeout", r: r };
  };

  /* ================================================================== the load balancer */
  function targetHealth(c, tg, t) {
    var inst = c.insts.filter(function (i) { return i.InstanceId === t.id; })[0];
    if (!inst) return { State: "unavailable", Reason: "Target.InvalidState", Description: "Target is in an invalid state" };
    if (inst.state !== "running") return { State: "unused", Reason: "Target.InvalidState", Description: "Target is in the " + inst.state + " state" };
    var lb = c.lbs.filter(function (l) { return l.arn === tg.lb; })[0];
    var port = tg.hc.port === "traffic-port" ? t.port : +tg.hc.port, codes = [], timeout = false;
    Object.keys(lb.nodes).forEach(function (k) {
      var src = endpoint(c, lb.nodes[k].priv), f = flow(c, src, endpoint(c, inst.ip), port, "tcp");
      if (!f.ok) { timeout = true; return; }
      var res = shopHttp(c, inst, { method: "GET", path: tg.hc.path, port: port, headers: { host: inst.ip + ":" + port, "user-agent": "ELB-HealthChecker/2.0" } }, lb.nodes[k].priv);
      if (res.err) timeout = true; else codes.push(res.status);
    });
    var want = String(tg.hc.matcher || "200");
    function okCode(s) { return want.split(",").some(function (w) { var mm = /^(\d+)-(\d+)$/.exec(w.trim()); return mm ? s >= +mm[1] && s <= +mm[2] : +w === s; }); }
    // a wrong answer is reported before a missing one
    var bad = codes.filter(function (s) { return !okCode(s); });
    if (bad.length) return { State: "unhealthy", Reason: "Target.ResponseCodeMismatch", Description: "Health checks failed with these codes: [" + bad[0] + "]" };
    if (timeout) return { State: "unhealthy", Reason: "Target.Timeout", Description: "Request timed out" };
    return { State: "healthy" };
  }
  function shopHttp(c, inst, req, client) {
    var m = M2.machine(c.homeSys, inst.ip); if (!m) return { err: true };
    var cn = M2.tcpConnect(m, inst.ip, req.port); if (cn.refused) return { err: "refused" };
    return M2.httpRequest(m, Object.assign({ scheme: "http", host: inst.ip }, req, { resolveTo: "127.0.0.1", client: client }));
  }
  var WDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"], MONS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  function httpDate(ms) { var x = new Date(ms); return WDAY[x.getUTCDay()] + ", " + ("0" + x.getUTCDate()).slice(-2) + " " + MONS[x.getUTCMonth()] + " " + x.getUTCFullYear() + " " + x.toISOString().slice(11, 19) + " GMT"; }
  function albPage(code, text) { return "<html>\r\n<head><title>" + code + " " + text + "</title></head>\r\n<body>\r\n<center><h1>" + code + " " + text + "</h1></center>\r\n</body>\r\n</html>\r\n"; }
  function albServe(sys, c, lb, port, req) {
    var l = lb.listeners.filter(function (x) { return x.port === port; })[0];
    var hdr = function (h) { return Object.assign({ Date: httpDate(sys.now), "Content-Type": "text/html", Server: "awselb/2.0" }, h || {}); };
    if (!l) return { status: 503, headers: hdr(), body: albPage(503, "Service Temporarily Unavailable") };
    if (l.redirect) return { status: 301, headers: hdr({ Location: "https://" + (req.headers.host || lb.dns) + req.path }), body: albPage(301, "Moved Permanently") };
    var tg = c.tgs.filter(function (t) { return t.arn === l.tg; })[0];
    if (c.waf && c.waf(req)) return { status: 403, headers: hdr(), body: albPage(403, "Forbidden") };
    var healthy = tg.targets.filter(function (t) { return targetHealth(c, tg, t).State === "healthy"; });
    // with no healthy target at all the ALB "fails open" and tries every registered target
    var pool = healthy.length ? healthy : tg.targets;
    if (!pool.length) return { status: 503, headers: hdr(), body: albPage(503, "Service Temporarily Unavailable") };
    for (var k = 0; k < pool.length; k++) {
      var t = pool[(lb.rr++) % pool.length], inst = c.insts.filter(function (i) { return i.InstanceId === t.id; })[0];
      var node = Object.keys(lb.nodes)[lb.rr % 2], f = flow(c, endpoint(c, lb.nodes[node].priv), endpoint(c, inst.ip), t.port, "tcp");
      if (!f.ok) { if (healthy.length) continue; return { status: 504, headers: hdr(), body: albPage(504, "Gateway Time-out") }; }
      var res = shopHttp(c, inst, Object.assign({}, req, { port: t.port, headers: Object.assign({}, req.headers, { "x-forwarded-for": req.clientIp || OUR_NAT_IP, "x-forwarded-proto": "http", "x-forwarded-port": String(port) }) }), lb.nodes[node].priv);
      if (res.err) { if (healthy.length) continue; return { status: 502, headers: hdr(), body: albPage(502, "Bad Gateway") }; }
      var rh = Object.assign({ Date: httpDate(sys.now), "Content-Type": res.headers["Content-Type"] || "text/html" }, res.headers); delete rh.Server;
      return { status: res.status, headers: rh, body: res.body };
    }
    return { status: 502, headers: hdr(), body: albPage(502, "Bad Gateway") };
  }
  var prevPreHttp = N.preHttp;
  N.preHttp = function (sys, ip, port, req) {
    var c = cloudOf(sys);
    if (c) {
      c.homeSys = homeOf(sys);
      var to = endpoint(c, ip);
      if (to.kind === "alb") { var from = epOfSys(c, sys); return albServe(sys, c, to.lb, port, Object.assign({}, req, { clientIp: from ? (from.pub || from.ip) : OUR_NAT_IP })); }
    }
    return prevPreHttp ? prevPreHttp(sys, ip, port, req) : null;
  };
  // Route 53 records become DNS answers for everyone
  function syncDns(home) {
    var c = home.cloud; if (!c) return;
    var ex = home.dnsExtra = home.dnsExtra || {};
    Object.keys(ex).forEach(function (k) { if (ex[k] && ex[k].r53) delete ex[k]; });
    ex[ALB_DNS] = { A: [ALB_NODES["public-a"].pub, ALB_NODES["public-b"].pub], r53: true };
    c.zones.forEach(function (z) {
      z.records.forEach(function (r) {
        var n = r.Name.replace(/\.$/, "").replace(/^\\052/, "*");
        if (r.Type === "NS" || r.Type === "SOA") return;
        var e = ex[n] = ex[n] && ex[n].r53 ? ex[n] : { r53: true };
        if (r.AliasTarget) { var tgt = r.AliasTarget.DNSName.replace(/\.$/, "").replace(/^dualstack\./, "").toLowerCase(); var tr = ex[tgt]; e[r.Type] = tr && tr.A ? tr.A.slice() : []; }
        else if (r.Type === "CNAME") e.CNAME = r.ResourceRecords[0].Value.replace(/\.$/, "");
        else e[r.Type] = r.ResourceRecords.map(function (x) { return x.Value; });
      });
    });
  }

  /* ================================================================== JMESPath (the subset people use with --query) */
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
  N.JP = JP;

  /* ================================================================== output formats */
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

  /* ================================================================== AWS shapes */
  function permsOf(g, egress) {
    var by = {};
    g.rules.filter(function (r) { return r.egress === egress; }).forEach(function (r) {
      var k = r.proto + "|" + r.from + "|" + r.to;
      var p = by[k] = by[k] || Object.assign({ IpProtocol: r.proto }, r.proto === "-1" ? {} : { FromPort: r.from, ToPort: r.to }, { IpRanges: [], Ipv6Ranges: [], PrefixListIds: [], UserIdGroupPairs: [] });
      if (r.cidr) p.IpRanges.push(r.desc ? { CidrIp: r.cidr, Description: r.desc } : { CidrIp: r.cidr });
      if (r.sg) p.UserIdGroupPairs.push(r.desc ? { Description: r.desc, GroupId: r.sg, UserId: ACCOUNT } : { GroupId: r.sg, UserId: ACCOUNT });
    });
    return Object.keys(by).map(function (k) { return by[k]; });
  }
  function sgShape(g) { return { Description: g.Description, GroupName: g.GroupName, IpPermissions: permsOf(g, false), OwnerId: ACCOUNT, GroupId: g.GroupId, IpPermissionsEgress: permsOf(g, true), Tags: g.Tags, VpcId: g.VpcId }; }
  function sgRuleShape(g, r) { var o = { SecurityGroupRuleId: r.id, GroupId: g.GroupId, GroupOwnerId: ACCOUNT, IsEgress: r.egress, IpProtocol: r.proto, FromPort: r.from == null ? -1 : r.from, ToPort: r.to == null ? -1 : r.to }; if (r.cidr) o.CidrIpv4 = r.cidr; if (r.sg) o.ReferencedGroupInfo = { GroupId: r.sg, UserId: ACCOUNT }; if (r.desc) o.Description = r.desc; o.Tags = []; return o; }
  function instShape(c, i) {
    var sub = subnetOf(c, i.SubnetId);
    return {
      AmiLaunchIndex: 0, ImageId: i.ami, InstanceId: i.InstanceId, InstanceType: i.type, LaunchTime: iso(i.launch),
      Placement: { AvailabilityZone: sub.AvailabilityZone, GroupName: "", Tenancy: "default" },
      PrivateDnsName: i.host + "." + REGION + ".compute.internal", PrivateIpAddress: i.ip,
      PublicDnsName: i.pub ? "ec2-" + i.pub.replace(/\./g, "-") + "." + REGION + ".compute.amazonaws.com" : "", PublicIpAddress: i.pub || undefined,
      State: { Code: i.state === "running" ? 16 : i.state === "stopped" ? 80 : 48, Name: i.state }, SubnetId: i.SubnetId, VpcId: c.vpc.VpcId, Architecture: "x86_64",
      BlockDeviceMappings: [{ DeviceName: "/dev/sda1", Ebs: { AttachTime: iso(i.launch), DeleteOnTermination: true, Status: "attached", VolumeId: i.vol } }],
      IamInstanceProfile: { Arn: "arn:aws:iam::" + ACCOUNT + ":instance-profile/kestrel-" + i.role, Id: "AIPA" + M2.hexOf("ip" + i.role, 17).toUpperCase() },
      NetworkInterfaces: [{ Attachment: { DeviceIndex: 0, Status: "attached" }, Groups: i.sgs.map(function (s) { var g = sgNamed(c, s); return { GroupName: g ? g.GroupName : s, GroupId: s }; }), NetworkInterfaceId: i.eni, PrivateIpAddress: i.ip, SubnetId: i.SubnetId, VpcId: c.vpc.VpcId, Association: i.pub ? { PublicIp: i.pub, IpOwnerId: "amazon" } : undefined }],
      SecurityGroups: i.sgs.map(function (s) { var g = sgNamed(c, s); return { GroupName: g ? g.GroupName : s, GroupId: s }; }),
      Tags: [{ Key: "Name", Value: i.name }, { Key: "Role", Value: i.role }].concat(i.tags || []),
      MetadataOptions: { State: "applied", HttpTokens: "required", HttpPutResponseHopLimit: 2, HttpEndpoint: "enabled" }
    };
  }
  function strip(o) { return JSON.parse(JSON.stringify(o, function (k, v) { return k === "key" || k === "rules" ? undefined : v; })); }

  /* ================================================================== aws CLI */
  function AwsErr(code, op, msg, exit, extra) { this.code = code; this.op = op; this.msg = msg; this.exit = exit || 254; this.extra = extra; }
  function needVal(o, k, op) { if (o[k] == null || o[k] === true) throw new AwsErr(null, op, null, 252, "\naws: error: the following arguments are required: --" + k); return o[k]; }
  // --opt value pairs; list options take every value up to the next --opt
  var LISTS = { "filters": 1, "instance-ids": 1, "group-ids": 1, "subnet-ids": 1, "vpc-ids": 1, "route-table-ids": 1, "network-acl-ids": 1, "groups": 1, "resource-ids": 1, "tags": 1, "resources": 1, "names": 1, "targets": 1, "load-balancer-arns": 1, "flow-log-ids": 1, "security-group-rule-ids": 1, "allocation-ids": 1, "nat-gateway-ids": 1, "internet-gateway-ids": 1, "network-interface-ids": 1, "target-group-arns": 1, "volume-ids": 1, "snapshot-ids": 1, "log-stream-names": 1, "ip-permissions": 1, "group-names": 1 };
  function parseOpts(a) {
    var o = {};
    for (var i = 0; i < a.length; i++) {
      var x = a[i]; if (!/^--/.test(x)) { (o._ = o._ || []).push(x); continue; }
      var k = x.slice(2), eqi = k.indexOf("=");
      if (eqi > 0) { o[k.slice(0, eqi)] = k.slice(eqi + 1); continue; }
      if (LISTS[k]) { var v = []; while (i + 1 < a.length && !/^--/.test(a[i + 1])) v.push(a[++i]); o[k] = v; continue; }
      if (i + 1 < a.length && !/^--/.test(a[i + 1])) o[k] = a[++i]; else o[k] = true;
    }
    return o;
  }
  // AWS shorthand: Key=Value,Key2=[{A=1,B=2},{...}],Values=a,b
  function splitTop(s, sep) { var parts = [], d = 0, cur = "", q = null; for (var i = 0; i < s.length; i++) { var ch = s.charAt(i); if (q) { cur += ch; if (ch === q) q = null; continue; } if (ch === "\"" || ch === "'") { q = ch; cur += ch; continue; } if (ch === "[" || ch === "{") d++; if (ch === "]" || ch === "}") d--; if (ch === sep && d === 0) { parts.push(cur); cur = ""; continue; } cur += ch; } parts.push(cur); return parts; }
  function shVal(v) {
    v = v.trim();
    if (/^\[.*\]$/.test(v)) { var inner = v.slice(1, -1).trim(); return inner ? splitTop(inner, ",").map(shVal) : []; }
    if (/^\{.*\}$/.test(v)) return shObj(v.slice(1, -1));
    if (/^".*"$|^'.*'$/.test(v)) return v.slice(1, -1);
    return v;
  }
  function shObj(s) {
    var o = {}, last = null;
    splitTop(s, ",").forEach(function (p) {
      var e = p.indexOf("=");
      if (e < 0 || (last && /^Values$|^Value$/.test(last) && !/^[A-Z][A-Za-z]*=/.test(p))) { if (last) { if (!Array.isArray(o[last])) o[last] = [o[last]]; o[last].push(shVal(p)); } return; }
      last = p.slice(0, e).trim(); o[last] = shVal(p.slice(e + 1));
    });
    return o;
  }
  function structArg(sys, sess, v) {
    if (Array.isArray(v)) { if (v.length === 1) v = v[0]; else return v.map(function (x) { return structArg(sys, sess, x); }); }
    v = String(v);
    if (/^file:\/\//.test(v)) { var p = v.slice(7), t = rd(sys, p.charAt(0) === "/" ? p : (sess.cwd || "/home/dev").replace(/\/$/, "") + "/" + p.replace(/^\.\//, "")); if (t == null) throw new AwsErr(null, null, null, 255, "\nError parsing parameter: Unable to load paramfile " + v + ": [Errno 2] No such file or directory: '" + p + "'"); v = t; }
    var tr = v.trim();
    if (/^[[{]/.test(tr)) { try { return JSON.parse(tr); } catch (e) { if (/^\[\s*\{/.test(tr) || /^\{\s*"/.test(tr)) throw new AwsErr(null, null, null, 252, "\nError parsing parameter: Invalid JSON: " + e.message.replace(/^JSON\.parse: /, "") + "\nJSON received: " + tr); } }
    return shObj(tr);
  }
  function filtersOf(o, sys, sess) {
    return (o.filters || []).map(function (f) { var x = shObj(f); var vals = x.Values; return { name: x.Name, values: Array.isArray(vals) ? vals : vals != null ? [vals] : [] }; });
  }
  function globMatch(pat, s) { return new RegExp("^" + String(pat).replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".") + "$").test(String(s)); }
  function applyFilters(list, filters, getter, op) {
    return list.filter(function (x) {
      return filters.every(function (f) {
        var vals = getter(x, f.name);
        if (vals === undefined) throw new AwsErr("InvalidParameterValue", op, "The filter '" + f.name + "' is invalid");
        vals = [].concat(vals).filter(function (v) { return v != null; });
        return f.values.some(function (want) { return vals.some(function (v) { return globMatch(want, v); }); });
      });
    });
  }
  function tagGet(o, name) { if (/^tag:/.test(name)) return (o.Tags || []).filter(function (t) { return t.Key === name.slice(4); }).map(function (t) { return t.Value; }); if (name === "tag-key") return (o.Tags || []).map(function (t) { return t.Key; }); return undefined; }
  function OP(name) { return name.split("-").map(function (w) { return w.charAt(0).toUpperCase() + w.slice(1); }).join(""); }

  var EC2 = {
    "describe-vpcs": function (c, o, x) { var l = c.vpcs.filter(function (v) { return !o["vpc-ids"] || o["vpc-ids"].indexOf(v.VpcId) >= 0; }); l = applyFilters(l, x.filters, function (v, n) { return n === "vpc-id" ? v.VpcId : n === "cidr" || n === "cidr-block" ? v.CidrBlock : n === "is-default" ? String(v.IsDefault) : n === "state" ? v.State : tagGet(v, n); }, x.op); return { Vpcs: l.map(strip) }; },
    "describe-subnets": function (c, o, x) { var l = c.subnets.filter(function (s) { return !o["subnet-ids"] || o["subnet-ids"].indexOf(s.SubnetId) >= 0; }); notFound(o["subnet-ids"], c.subnets.map(function (s) { return s.SubnetId; }), "InvalidSubnetID.NotFound", "subnet ID", x.op); l = applyFilters(l, x.filters, function (s, n) { return n === "vpc-id" ? s.VpcId : n === "subnet-id" ? s.SubnetId : n === "availability-zone" ? s.AvailabilityZone : n === "cidr-block" || n === "cidr" ? s.CidrBlock : n === "map-public-ip-on-launch" ? String(s.MapPublicIpOnLaunch) : tagGet(s, n); }, x.op); return { Subnets: l.map(strip) }; },
    "describe-route-tables": function (c, o, x) { var l = c.rts.filter(function (t) { return !o["route-table-ids"] || o["route-table-ids"].indexOf(t.RouteTableId) >= 0; }); notFound(o["route-table-ids"], c.rts.map(function (t) { return t.RouteTableId; }), "InvalidRouteTableID.NotFound", "route table ID", x.op); l = applyFilters(l, x.filters, function (t, n) { return n === "vpc-id" ? t.VpcId : n === "route-table-id" ? t.RouteTableId : n === "association.subnet-id" ? t.Associations.map(function (a) { return a.SubnetId; }) : n === "association.main" ? t.Associations.map(function (a) { return String(!!a.Main); }) : n === "route.gateway-id" ? t.Routes.map(function (r) { return r.GatewayId; }) : n === "route.nat-gateway-id" ? t.Routes.map(function (r) { return r.NatGatewayId; }) : n === "route.destination-cidr-block" ? t.Routes.map(function (r) { return r.DestinationCidrBlock; }) : n === "association.route-table-association-id" ? t.Associations.map(function (a) { return a.RouteTableAssociationId; }) : tagGet(t, n); }, x.op); return { RouteTables: l.map(strip) }; },
    "describe-internet-gateways": function (c, o, x) { return { InternetGateways: applyFilters(c.igws, x.filters, function (g, n) { return n === "attachment.vpc-id" ? g.Attachments.map(function (a) { return a.VpcId; }) : n === "internet-gateway-id" ? g.InternetGatewayId : tagGet(g, n); }, x.op).map(strip) }; },
    "describe-nat-gateways": function (c, o, x) { return { NatGateways: applyFilters(c.nats, x.filters, function (g, n) { return n === "vpc-id" ? g.VpcId : n === "subnet-id" ? g.SubnetId : n === "state" ? g.State : n === "nat-gateway-id" ? g.NatGatewayId : tagGet(g, n); }, x.op).map(strip) }; },
    "describe-security-groups": function (c, o, x) { var l = c.sgs.filter(function (g) { return (!o["group-ids"] || o["group-ids"].indexOf(g.GroupId) >= 0) && (!o["group-names"] || [].concat(o["group-names"]).indexOf(g.GroupName) >= 0); }); notFound(o["group-ids"], c.sgs.map(function (g) { return g.GroupId; }), "InvalidGroup.NotFound", "security group", x.op, true); l = applyFilters(l, x.filters, function (g, n) { return n === "vpc-id" ? g.VpcId : n === "group-id" ? g.GroupId : n === "group-name" ? g.GroupName : n === "ip-permission.from-port" ? g.rules.filter(function (r) { return !r.egress; }).map(function (r) { return String(r.from); }) : n === "ip-permission.to-port" ? g.rules.filter(function (r) { return !r.egress; }).map(function (r) { return String(r.to); }) : n === "ip-permission.cidr" ? g.rules.filter(function (r) { return !r.egress; }).map(function (r) { return r.cidr; }) : n === "ip-permission.group-id" ? g.rules.filter(function (r) { return !r.egress; }).map(function (r) { return r.sg; }) : n === "description" ? g.Description : tagGet(g, n); }, x.op); return { SecurityGroups: l.map(sgShape) }; },
    "describe-security-group-rules": function (c, o, x) { var all = []; c.sgs.forEach(function (g) { g.rules.forEach(function (r) { all.push({ g: g, r: r }); }); }); all = all.filter(function (e) { return !o["security-group-rule-ids"] || o["security-group-rule-ids"].indexOf(e.r.id) >= 0; }); all = applyFilters(all, x.filters, function (e, n) { return n === "group-id" ? e.g.GroupId : n === "security-group-rule-id" ? e.r.id : undefined; }, x.op); return { SecurityGroupRules: all.map(function (e) { return sgRuleShape(e.g, e.r); }) }; },
    "describe-network-acls": function (c, o, x) { var l = c.acls.filter(function (a) { return !o["network-acl-ids"] || o["network-acl-ids"].indexOf(a.NetworkAclId) >= 0; }); l = applyFilters(l, x.filters, function (a, n) { return n === "vpc-id" ? a.VpcId : n === "network-acl-id" ? a.NetworkAclId : n === "association.subnet-id" ? a.Associations.map(function (s) { return s.SubnetId; }) : n === "default" ? String(a.IsDefault) : tagGet(a, n); }, x.op); return { NetworkAcls: l.map(function (a) { var s = strip(a); s.Entries = a.Entries.slice().sort(function (p, q) { return (p.Egress === q.Egress ? 0 : p.Egress ? -1 : 1) || p.RuleNumber - q.RuleNumber; }); return s; }) }; },
    "describe-instances": function (c, o, x) { var l = c.insts.filter(function (i) { return !o["instance-ids"] || o["instance-ids"].indexOf(i.InstanceId) >= 0; }); notFound(o["instance-ids"], c.insts.map(function (i) { return i.InstanceId; }), "InvalidInstanceID.NotFound", "instance ID", x.op); l = applyFilters(l, x.filters, function (i, n) { return n === "instance-id" ? i.InstanceId : n === "vpc-id" ? c.vpc.VpcId : n === "subnet-id" ? i.SubnetId : n === "instance-state-name" ? i.state : n === "private-ip-address" ? i.ip : n === "ip-address" ? i.pub : n === "instance.group-id" || n === "group-id" ? i.sgs : n === "instance.group-name" || n === "group-name" ? i.sgs.map(function (s) { return (sgNamed(c, s) || {}).GroupName; }) : n === "network-interface.network-interface-id" ? i.eni : n === "tag:Name" ? i.name : n === "tag:Role" ? i.role : /^tag:/.test(n) ? (i.tags || []).filter(function (t) { return t.Key === n.slice(4); }).map(function (t) { return t.Value; }) : undefined; }, x.op); return { Reservations: l.map(function (i) { return { Groups: [], Instances: [instShape(c, i)], OwnerId: ACCOUNT, ReservationId: "r-0" + M2.hexOf("res" + i.name, 16) }; }) }; },
    "describe-network-interfaces": function (c, o, x) { var l = c.enis.filter(function (e) { return !o["network-interface-ids"] || o["network-interface-ids"].indexOf(e.id) >= 0; }); l = applyFilters(l, x.filters, function (e, n) { return n === "network-interface-id" ? e.id : n === "addresses.private-ip-address" || n === "private-ip-address" ? e.ip : n === "association.public-ip" ? e.pub : n === "attachment.instance-id" ? e.inst : n === "subnet-id" ? e.subnet : n === "description" ? e.desc : undefined; }, x.op); return { NetworkInterfaces: l.map(function (e) { var i = e.inst && c.insts.filter(function (k) { return k.InstanceId === e.inst; })[0]; return { Attachment: e.inst ? { InstanceId: e.inst, DeviceIndex: 0, Status: "attached" } : { InstanceOwnerId: e.alb ? "amazon-elb" : "amazon-aws", Status: "attached" }, AvailabilityZone: subnetOf(c, e.subnet).AvailabilityZone, Description: e.desc, Groups: i ? i.sgs.map(function (s) { return { GroupId: s, GroupName: (sgNamed(c, s) || {}).GroupName }; }) : e.alb ? c.lbs[0].sgs.map(function (s) { return { GroupId: s, GroupName: (sgNamed(c, s) || {}).GroupName }; }) : [], InterfaceType: e.nat ? "nat_gateway" : "interface", NetworkInterfaceId: e.id, PrivateIpAddress: e.ip, Association: e.pub ? { PublicIp: e.pub, IpOwnerId: "amazon" } : undefined, RequesterManaged: !e.inst, Status: "in-use", SubnetId: e.subnet, VpcId: c.vpc.VpcId }; }) }; },
    "describe-flow-logs": function (c, o, x) { return { FlowLogs: applyFilters(c.flowLogs, x.filters, function (f, n) { return n === "resource-id" ? f.ResourceId : n === "flow-log-id" ? f.FlowLogId : n === "traffic-type" ? f.TrafficType : n === "log-group-name" ? f.LogGroupName : undefined; }, x.op).map(strip) }; },
    "describe-volumes": function (c, o, x) { return { Volumes: applyFilters(c.insts, x.filters, function (i, n) { return n === "attachment.instance-id" ? i.InstanceId : n === "volume-id" ? i.vol : undefined; }, x.op).filter(function (i) { return !o["volume-ids"] || o["volume-ids"].indexOf(i.vol) >= 0; }).map(function (i) { return { Attachments: [{ AttachTime: iso(i.launch), Device: "/dev/sda1", InstanceId: i.InstanceId, State: "attached", VolumeId: i.vol, DeleteOnTermination: true }], AvailabilityZone: subnetOf(c, i.SubnetId).AvailabilityZone, CreateTime: iso(i.launch), Encrypted: true, Size: i.role === "db" ? 100 : 20, SnapshotId: "", State: "in-use", VolumeId: i.vol, Iops: 3000, VolumeType: "gp3" }; }) }; },
    "describe-snapshots": function (c, o, x) { return { Snapshots: c.snapshots.map(strip) }; },
    "create-route": function (c, o, x) {
      var t = needRt(c, o, x), dst = needVal(o, "destination-cidr-block", x.op);
      if (!validCidr(dst)) throw new AwsErr("InvalidParameterValue", x.op, "Value (" + dst + ") for parameter destinationCidrBlock is invalid. This is not a valid CIDR block.");
      if (t.Routes.some(function (r) { return r.DestinationCidrBlock === dst; })) throw new AwsErr("RouteAlreadyExists", x.op, "The route identified by " + dst + " already exists.");
      t.Routes.push(routeTarget(c, o, x, { DestinationCidrBlock: dst, Origin: "CreateRoute", State: "active" }));
      return { Return: true };
    },
    "replace-route": function (c, o, x) {
      var t = needRt(c, o, x), dst = needVal(o, "destination-cidr-block", x.op), k = t.Routes.findIndex(function (r) { return r.DestinationCidrBlock === dst; });
      if (k < 0 || t.Routes[k].GatewayId === "local") throw new AwsErr("InvalidRoute.NotFound", x.op, "no route with destination-cidr-block " + dst + " in route table " + t.RouteTableId);
      t.Routes[k] = routeTarget(c, o, x, { DestinationCidrBlock: dst, Origin: "ReplaceRoute", State: "active" });
      return null;
    },
    "delete-route": function (c, o, x) {
      var t = needRt(c, o, x), dst = needVal(o, "destination-cidr-block", x.op), k = t.Routes.findIndex(function (r) { return r.DestinationCidrBlock === dst; });
      if (k < 0) throw new AwsErr("InvalidRoute.NotFound", x.op, "no route with destination-cidr-block " + dst + " in route table " + t.RouteTableId);
      if (t.Routes[k].GatewayId === "local") throw new AwsErr("InvalidParameterValue", x.op, "cannot remove local route " + dst + " in route table " + t.RouteTableId);
      t.Routes.splice(k, 1); return null;
    },
    "associate-route-table": function (c, o, x) {
      var t = needRt(c, o, x), sid = needVal(o, "subnet-id", x.op), sub = subnetOf(c, sid);
      if (!sub) throw new AwsErr("InvalidSubnetID.NotFound", x.op, "The subnet ID '" + sid + "' does not exist");
      var cur = c.rts.filter(function (r) { return r.Associations.some(function (a) { return a.SubnetId === sid; }); })[0];
      if (cur) throw new AwsErr("Resource.AlreadyAssociated", x.op, "the specified association for route table " + cur.RouteTableId + " conflicts with an existing association");
      var a = { Main: false, RouteTableAssociationId: hid("rtbassoc", t.RouteTableId + sid + c.log.length), RouteTableId: t.RouteTableId, SubnetId: sid, AssociationState: { State: "associated" } };
      t.Associations.push(a); return { AssociationId: a.RouteTableAssociationId, AssociationState: { State: "associated" } };
    },
    "disassociate-route-table": function (c, o, x) {
      var id = needVal(o, "association-id", x.op), found = false;
      c.rts.forEach(function (t) { var k = t.Associations.findIndex(function (a) { return a.RouteTableAssociationId === id; }); if (k >= 0) { if (t.Associations[k].Main) throw new AwsErr("InvalidParameterValue", x.op, "cannot disassociate the main route table association " + id); t.Associations.splice(k, 1); found = true; } });
      if (!found) throw new AwsErr("InvalidAssociationID.NotFound", x.op, "The association ID '" + id + "' does not exist");
      return null;
    },
    "replace-route-table-association": function (c, o, x) {
      var id = needVal(o, "association-id", x.op), t = needRt(c, o, x), hit = null;
      c.rts.forEach(function (r) { var k = r.Associations.findIndex(function (a) { return a.RouteTableAssociationId === id; }); if (k >= 0) { hit = r.Associations[k]; r.Associations.splice(k, 1); } });
      if (!hit) throw new AwsErr("InvalidAssociationID.NotFound", x.op, "The association ID '" + id + "' does not exist");
      var n = Object.assign({}, hit, { RouteTableAssociationId: hid("rtbassoc", id + t.RouteTableId), RouteTableId: t.RouteTableId });
      t.Associations.push(n); return { NewAssociationId: n.RouteTableAssociationId, AssociationState: { State: "associated" } };
    },
    "authorize-security-group-ingress": function (c, o, x) { return sgEdit(c, o, x, false, true); },
    "authorize-security-group-egress": function (c, o, x) { return sgEdit(c, o, x, true, true); },
    "revoke-security-group-ingress": function (c, o, x) { return sgEdit(c, o, x, false, false); },
    "revoke-security-group-egress": function (c, o, x) { return sgEdit(c, o, x, true, false); },
    "create-security-group": function (c, o, x) {
      var name = needVal(o, "group-name", x.op), desc = needVal(o, "description", x.op), vpc = o["vpc-id"] || c.vpc.VpcId;
      if (c.sgs.some(function (g) { return g.GroupName === name && g.VpcId === vpc; })) throw new AwsErr("InvalidGroup.Duplicate", x.op, "The security group '" + name + "' already exists for VPC '" + vpc + "'");
      var g = { key: name, GroupId: hid("sg", name + c.sgs.length), GroupName: name, Description: desc, VpcId: vpc, OwnerId: ACCOUNT, Tags: [], rules: [] };
      addRule(g, rule(true, "-1", null, null, "0.0.0.0/0"));
      c.sgs.push(g); return { GroupId: g.GroupId, SecurityGroupArn: "arn:aws:ec2:" + REGION + ":" + ACCOUNT + ":security-group/" + g.GroupId };
    },
    "delete-security-group": function (c, o, x) { var g = sgNamed(c, needVal(o, "group-id", x.op)); if (!g) throw new AwsErr("InvalidGroup.NotFound", x.op, "The security group '" + o["group-id"] + "' does not exist"); if (c.insts.some(function (i) { return i.sgs.indexOf(g.GroupId) >= 0; })) throw new AwsErr("DependencyViolation", x.op, "resource " + g.GroupId + " has a dependent object"); c.sgs.splice(c.sgs.indexOf(g), 1); return { Return: true, GroupId: g.GroupId }; },
    "modify-instance-attribute": function (c, o, x) {
      var i = needInst(c, o, x);
      if (o.groups) { var gs = [].concat(o.groups); gs.forEach(function (g) { if (!sgNamed(c, g)) throw new AwsErr("InvalidGroup.NotFound", x.op, "The security group '" + g + "' does not exist"); }); i.sgs = gs.slice(); return null; }
      throw new AwsErr(null, x.op, null, 252, "\naws: error: one of the attributes to change is required (for example --groups)");
    },
    "create-network-acl-entry": function (c, o, x) { return aclEdit(c, o, x, "create"); },
    "replace-network-acl-entry": function (c, o, x) { return aclEdit(c, o, x, "replace"); },
    "delete-network-acl-entry": function (c, o, x) { return aclEdit(c, o, x, "delete"); },
    "create-network-acl": function (c, o, x) { var id = hid("acl", "new" + c.acls.length), a = { key: id, NetworkAclId: id, VpcId: o["vpc-id"] || c.vpc.VpcId, IsDefault: false, OwnerId: ACCOUNT, Tags: [], Entries: [{ RuleNumber: 32767, Protocol: "-1", RuleAction: "deny", Egress: false, CidrBlock: "0.0.0.0/0" }, { RuleNumber: 32767, Protocol: "-1", RuleAction: "deny", Egress: true, CidrBlock: "0.0.0.0/0" }], Associations: [] }; c.acls.push(a); return { NetworkAcl: strip(a) }; },
    "replace-network-acl-association": function (c, o, x) {
      var id = needVal(o, "association-id", x.op), a = aclNamed(c, needVal(o, "network-acl-id", x.op)), hit = null;
      if (!a) throw new AwsErr("InvalidNetworkAclID.NotFound", x.op, "The network ACL ID '" + o["network-acl-id"] + "' does not exist");
      c.acls.forEach(function (n) { var k = n.Associations.findIndex(function (s) { return s.NetworkAclAssociationId === id; }); if (k >= 0) { hit = n.Associations[k]; n.Associations.splice(k, 1); } });
      if (!hit) throw new AwsErr("InvalidAssociationID.NotFound", x.op, "The association ID '" + id + "' does not exist");
      var nn = { NetworkAclAssociationId: hid("aclassoc", id + a.NetworkAclId), NetworkAclId: a.NetworkAclId, SubnetId: hit.SubnetId }; a.Associations.push(nn); return { NewAssociationId: nn.NetworkAclAssociationId };
    },
    "create-flow-logs": function (c, o, x) {
      var ids = needVal(o, "resource-ids", x.op), rtype = needVal(o, "resource-type", x.op), tt = needVal(o, "traffic-type", x.op);
      if (["ACCEPT", "REJECT", "ALL"].indexOf(tt) < 0) throw new AwsErr("InvalidParameter", x.op, "Invalid traffic type: " + tt);
      var group = o["log-group-name"] || (o["log-destination"] ? String(o["log-destination"]).replace(/^arn:aws:logs:[^:]+:\d+:log-group:/, "").replace(/:\*$/, "") : null);
      if (!group && o["log-destination-type"] !== "s3") throw new AwsErr("InvalidParameter", x.op, "LogDestination or LogGroupName is required");
      if ((!o["log-destination-type"] || o["log-destination-type"] === "cloud-watch-logs") && !o["deliver-logs-permission-arn"]) throw new AwsErr("InvalidParameter", x.op, "DeliverLogsPermissionArn is required for CloudWatch Logs destinations");
      var made = [];
      [].concat(ids).forEach(function (rid) {
        var ok = rtype === "VPC" ? c.vpcs.some(function (v) { return v.VpcId === rid; }) : rtype === "Subnet" ? !!subnetOf(c, rid) : rtype === "NetworkInterface" ? c.enis.some(function (e) { return e.id === rid; }) : false;
        if (!ok) throw new AwsErr("InvalidParameter", x.op, rtype + " " + rid + " does not exist");
        if (c.flowLogs.some(function (f) { return f.ResourceId === rid && f.TrafficType === tt && f.LogGroupName === group; })) throw new AwsErr("FlowLogAlreadyExists", x.op, "Error. There is an existing Flow Log with the same configuration and log destination.");
        var f = { FlowLogId: hid("fl", rid + tt + c.flowLogs.length), CreationTime: isoZ(c.homeNow || NOW), DeliverLogsStatus: "SUCCESS", FlowLogStatus: "ACTIVE", ResourceId: rid, TrafficType: tt, LogDestinationType: o["log-destination-type"] || "cloud-watch-logs", LogGroupName: group, DeliverLogsPermissionArn: o["deliver-logs-permission-arn"], LogFormat: "${version} ${account-id} ${interface-id} ${srcaddr} ${dstaddr} ${srcport} ${dstport} ${protocol} ${packets} ${bytes} ${start} ${end} ${action} ${log-status}", MaxAggregationInterval: +(o["max-aggregation-interval"] || 600) };
        c.flowLogs.push(f); made.push(f.FlowLogId);
      });
      return { ClientToken: M2.hexOf("ct" + made.join(), 32), FlowLogIds: made, Unsuccessful: [] };
    },
    "delete-flow-logs": function (c, o, x) { var ids = needVal(o, "flow-log-ids", x.op), bad = []; [].concat(ids).forEach(function (id) { var k = c.flowLogs.findIndex(function (f) { return f.FlowLogId === id; }); if (k < 0) bad.push({ Error: { Code: "InvalidFlowLogId.NotFound", Message: "flow log ID '" + id + "' does not exist" }, ResourceId: id }); else c.flowLogs.splice(k, 1); }); return { Unsuccessful: bad }; },
    "create-snapshot": function (c, o, x) { var vid = needVal(o, "volume-id", x.op), i = c.insts.filter(function (k) { return k.vol === vid; })[0]; if (!i) throw new AwsErr("InvalidVolume.NotFound", x.op, "The volume '" + vid + "' does not exist."); var s = { Description: o.description || "", Encrypted: true, OwnerId: ACCOUNT, Progress: "", SnapshotId: "snap-0" + M2.hexOf("snap" + vid + c.snapshots.length, 16), StartTime: isoZ(c.homeNow || NOW), State: "pending", VolumeId: vid, VolumeSize: i.role === "db" ? 100 : 20, Tags: tagsArg(o) }; c.snapshots.push(s); return s; },
    "create-tags": function (c, o, x) { var res = needVal(o, "resources", x.op), tags = tagsArg(o); [].concat(res).forEach(function (rid) { var i = c.insts.filter(function (k) { return k.InstanceId === rid; })[0]; var obj = i || c.sgs.filter(function (g) { return g.GroupId === rid; })[0] || c.subnets.filter(function (s) { return s.SubnetId === rid; })[0]; if (!obj) throw new AwsErr("InvalidID", x.op, "The ID '" + rid + "' is not valid"); tags.forEach(function (t) { var list = i ? (i.tags = i.tags || []) : (obj.Tags = obj.Tags || []); var e = list.filter(function (z) { return z.Key === t.Key; })[0]; if (e) e.Value = t.Value; else list.push(t); if (i && t.Key === "Name") i.name = t.Value; }); }); return null; },
    "stop-instances": function (c, o, x) { var ids = needVal(o, "instance-ids", x.op); return { StoppingInstances: [].concat(ids).map(function (id) { var i = needInst(c, { "instance-id": id }, x), prev = i.state; i.state = "stopped"; return { CurrentState: { Code: 64, Name: "stopping" }, InstanceId: id, PreviousState: { Code: 16, Name: prev } }; }) }; },
    "start-instances": function (c, o, x) { var ids = needVal(o, "instance-ids", x.op); return { StartingInstances: [].concat(ids).map(function (id) { var i = needInst(c, { "instance-id": id }, x), prev = i.state; i.state = "running"; return { CurrentState: { Code: 0, Name: "pending" }, InstanceId: id, PreviousState: { Code: 80, Name: prev } }; }) }; },
    "terminate-instances": function (c, o, x) { var ids = needVal(o, "instance-ids", x.op); return { TerminatingInstances: [].concat(ids).map(function (id) { var i = needInst(c, { "instance-id": id }, x), prev = i.state; i.state = "terminated"; return { CurrentState: { Code: 32, Name: "shutting-down" }, InstanceId: id, PreviousState: { Code: 16, Name: prev } }; }) }; },
    "disassociate-address": function (c, o, x) { var pub = o["public-ip"], aid = o["association-id"]; var i = c.insts.filter(function (k) { return k.pub && (k.pub === pub || hid("eipassoc", k.name) === aid); })[0]; if (!i) throw new AwsErr("InvalidAssociationID.NotFound", x.op, "The association ID '" + (aid || pub) + "' does not exist"); i.pub = null; c.enis.forEach(function (e) { if (e.inst === i.InstanceId) e.pub = null; }); return null; },
    "describe-addresses": function (c, o, x) { var l = []; c.insts.forEach(function (i) { if (i.pub) l.push({ AllocationId: hid("eipalloc", i.name), AssociationId: hid("eipassoc", i.name), Domain: "vpc", InstanceId: i.InstanceId, NetworkInterfaceId: i.eni, PrivateIpAddress: i.ip, PublicIp: i.pub, Tags: [{ Key: "Name", Value: i.name + "-eip" }] }); }); c.nats.forEach(function (n) { var a = n.NatGatewayAddresses[0]; l.push({ AllocationId: a.AllocationId, AssociationId: a.AssociationId, Domain: "vpc", NetworkInterfaceId: a.NetworkInterfaceId, PrivateIpAddress: a.PrivateIp, PublicIp: a.PublicIp }); }); return { Addresses: l }; }
  };
  function tagsArg(o) { var t = o.tags || (o["tag-specifications"] ? [] : []); return [].concat(t).map(function (s) { var x = shObj(s); return { Key: x.Key, Value: x.Value == null ? "" : x.Value }; }); }
  function notFound(ids, known, code, what, op, sg) { (ids || []).forEach(function (id) { if (known.indexOf(id) < 0) throw new AwsErr(code, op, sg ? "The security group '" + id + "' does not exist" : "The " + what + " '" + id + "' does not exist"); }); }
  function needRt(c, o, x) { var id = needVal(o, "route-table-id", x.op), t = c.rts.filter(function (r) { return r.RouteTableId === id; })[0]; if (!t) throw new AwsErr("InvalidRouteTableID.NotFound", x.op, "The routeTable ID '" + id + "' does not exist"); return t; }
  function needInst(c, o, x) { var id = needVal(o, "instance-id", x.op), i = c.insts.filter(function (k) { return k.InstanceId === id; })[0]; if (!i) throw new AwsErr("InvalidInstanceID.NotFound", x.op, "The instance ID '" + id + "' does not exist"); return i; }
  function routeTarget(c, o, x, r) {
    if (o["gateway-id"]) { if (!c.igws.some(function (g) { return g.InternetGatewayId === o["gateway-id"]; })) throw new AwsErr("InvalidGatewayID.NotFound", x.op, "The gateway ID '" + o["gateway-id"] + "' does not exist"); r.GatewayId = o["gateway-id"]; }
    else if (o["nat-gateway-id"]) { if (!c.nats.some(function (g) { return g.NatGatewayId === o["nat-gateway-id"]; })) throw new AwsErr("InvalidNatGatewayID.NotFound", x.op, "The natGateway ID '" + o["nat-gateway-id"] + "' does not exist"); r.NatGatewayId = o["nat-gateway-id"]; }
    else throw new AwsErr("MissingParameter", x.op, "The request must contain exactly one of gatewayId, natGatewayId, networkInterfaceId, vpcPeeringConnectionId or instanceId");
    return r;
  }
  function protoOf(p) { p = String(p).toLowerCase(); return { "6": "tcp", "17": "udp", "1": "icmp", all: "-1", "-1": "-1", tcp: "tcp", udp: "udp", icmp: "icmp" }[p] || null; }
  function sgEdit(c, o, x, egress, add) {
    var g = sgNamed(c, o["group-id"] || o["group-name"] || "");
    if (!g) { if (!o["group-id"] && !o["group-name"]) throw new AwsErr("MissingParameter", x.op, "The request must contain the parameter groupId or groupName"); throw new AwsErr("InvalidGroup.NotFound", x.op, "The security group '" + (o["group-id"] || o["group-name"]) + "' does not exist"); }
    var want = [];
    if (o["security-group-rule-ids"]) {
      if (add) throw new AwsErr("InvalidParameterCombination", x.op, "--security-group-rule-ids works with revoke only");
      var gone = [];
      o["security-group-rule-ids"].forEach(function (id) { var k = g.rules.findIndex(function (r) { return r.id === id && r.egress === egress; }); if (k < 0) throw new AwsErr("InvalidSecurityGroupRuleId.NotFound", x.op, "The security group rule ID '" + id + "' does not exist"); gone.push(g.rules[k]); g.rules.splice(k, 1); });
      return { Return: true };
    }
    if (o["ip-permissions"]) {
      [].concat(structArg(c.sys, c.sess, o["ip-permissions"])).forEach(function (p) {
        var pr = protoOf(p.IpProtocol); if (!pr) throw new AwsErr("InvalidParameterValue", x.op, "Invalid value '" + p.IpProtocol + "' for IP protocol. Unknown protocol.");
        var fr = pr === "-1" ? null : p.FromPort != null ? +p.FromPort : null, to = pr === "-1" ? null : p.ToPort != null ? +p.ToPort : null;
        [].concat(p.IpRanges || []).forEach(function (rg) { want.push(rule(egress, pr, fr, to, rg.CidrIp, rg.Description)); });
        [].concat(p.UserIdGroupPairs || []).forEach(function (rg) { want.push(rule(egress, pr, fr, to, rg.GroupId, rg.Description)); });
      });
    } else {
      var pr2 = protoOf(o.protocol || ""); if (!pr2) throw new AwsErr(null, x.op, null, 252, "\naws: error: --protocol is required (tcp, udp, icmp or all) unless you give --ip-permissions");
      var fr2 = null, to2 = null;
      if (pr2 !== "-1" && o.port != null) { var m = /^(-?\d+)(?:-(\d+))?$/.exec(String(o.port)); if (!m) throw new AwsErr("InvalidParameterValue", x.op, "Invalid port: " + o.port); fr2 = +m[1]; to2 = m[2] ? +m[2] : +m[1]; }
      if (pr2 === "tcp" || pr2 === "udp") { if (fr2 == null) throw new AwsErr("InvalidParameterValue", x.op, "Invalid value for portRange. Must specify both from and to ports with TCP/UDP."); }
      if (pr2 === "icmp" && fr2 == null) { fr2 = -1; to2 = -1; }
      var peer = o.cidr || o["source-group"]; if (!peer) throw new AwsErr(null, x.op, null, 252, "\naws: error: give --cidr or --source-group (or --ip-permissions)");
      if (o.cidr && !validCidr(o.cidr)) throw new AwsErr("InvalidParameterValue", x.op, "CIDR block " + o.cidr + " is malformed");
      want.push(rule(egress, pr2, fr2, to2, peer));
    }
    want.forEach(function (w) { if (w.sg && !sgNamed(c, w.sg)) throw new AwsErr("InvalidGroup.NotFound", x.op, "The security group '" + w.sg + "' does not exist"); if (w.cidr && !validCidr(w.cidr)) throw new AwsErr("InvalidParameterValue", x.op, "CIDR block " + w.cidr + " is malformed"); });
    function same(r, w) { return r.egress === w.egress && r.proto === w.proto && (r.proto === "-1" || (r.from === w.from && r.to === w.to)) && (r.cidr || null) === (w.cidr || null) && (r.sg || null) === (w.sg || null); }
    var added = [];
    want.forEach(function (w) {
      var k = g.rules.findIndex(function (r) { return same(r, w); });
      if (add) {
        if (k >= 0) throw new AwsErr("InvalidPermission.Duplicate", x.op, "the specified rule \"peer: " + (w.cidr || w.sg) + ", " + (w.proto === "-1" ? "ALL" : w.proto.toUpperCase()) + (w.proto === "-1" ? "" : ", from port: " + w.from + ", to port: " + w.to) + ", ALLOW\" already exists");
        added.push(addRule(g, w));
      } else {
        if (k < 0) throw new AwsErr("InvalidPermission.NotFound", x.op, "The specified rule does not exist in this security group.");
        g.rules.splice(k, 1);
      }
    });
    return add ? { Return: true, SecurityGroupRules: added.map(function (r) { return sgRuleShape(g, r); }) } : { Return: true };
  }
  function aclEdit(c, o, x, mode) {
    var a = aclNamed(c, needVal(o, "network-acl-id", x.op)); if (!a) throw new AwsErr("InvalidNetworkAclID.NotFound", x.op, "The network ACL ID '" + o["network-acl-id"] + "' does not exist");
    var egress = !!o.egress && o.egress !== "false";
    if (!o.egress && !o.ingress) throw new AwsErr(null, x.op, null, 252, "\naws: error: either --ingress or --egress is required");
    var num = +needVal(o, "rule-number", x.op);
    if (!(num >= 1 && num <= 32766)) throw new AwsErr("InvalidParameterValue", x.op, "Invalid value '" + o["rule-number"] + "' for ruleNumber. It must be between 1 and 32766.");
    var k = a.Entries.findIndex(function (e) { return e.RuleNumber === num && !!e.Egress === egress; });
    if (mode === "delete") { if (k < 0) throw new AwsErr("InvalidNetworkAclEntry.NotFound", x.op, "The specified rule does not exist in this network acl"); a.Entries.splice(k, 1); return null; }
    if (mode === "create" && k >= 0) throw new AwsErr("NetworkAclEntryAlreadyExists", x.op, "The network acl entry identified by " + num + " already exists.");
    if (mode === "replace" && k < 0) throw new AwsErr("InvalidNetworkAclEntry.NotFound", x.op, "The specified rule does not exist in this network acl");
    var pr = protoOf(needVal(o, "protocol", x.op)); if (!pr) throw new AwsErr("InvalidParameterValue", x.op, "Invalid value '" + o.protocol + "' for protocol");
    var act = String(needVal(o, "rule-action", x.op)).toLowerCase(); if (act !== "allow" && act !== "deny") throw new AwsErr("InvalidParameterValue", x.op, "Invalid value '" + o["rule-action"] + "' for ruleAction");
    var cidr = needVal(o, "cidr-block", x.op); if (!validCidr(cidr)) throw new AwsErr("InvalidParameterValue", x.op, "Value (" + cidr + ") for parameter cidrBlock is invalid. This is not a valid CIDR block.");
    var e = { RuleNumber: num, Protocol: PNUM[pr], RuleAction: act, Egress: egress, CidrBlock: cidr };
    if (pr === "tcp" || pr === "udp") {
      if (!o["port-range"]) throw new AwsErr("InvalidParameterValue", x.op, "PortRange is required for TCP and UDP");
      var pr2 = shObj(String(o["port-range"])); e.PortRange = { From: +pr2.From, To: +pr2.To };
      if (isNaN(e.PortRange.From) || isNaN(e.PortRange.To)) throw new AwsErr("InvalidParameterValue", x.op, "Invalid port range: " + o["port-range"]);
    }
    if (pr === "icmp") e.IcmpTypeCode = { Code: -1, Type: -1 };
    if (k >= 0) a.Entries[k] = e; else a.Entries.push(e);
    return null;
  }
  var SVC = { ec2: EC2 };
  SVC.sts = { "get-caller-identity": function () { return { UserId: "AROA" + M2.hexOf("role", 17).toUpperCase() + ":dev@kestrel.io", Account: ACCOUNT, Arn: "arn:aws:sts::" + ACCOUNT + ":assumed-role/KestrelNetworkAdmin/dev@kestrel.io" }; } };
  SVC.elbv2 = {
    "describe-load-balancers": function (c, o, x) { var l = c.lbs.filter(function (b) { return !o.names || o.names.indexOf(b.name) >= 0; }); if (o.names && !l.length) throw new AwsErr("LoadBalancerNotFound", x.op, "Load balancers '[" + o.names.join(", ") + "]' not found"); return { LoadBalancers: l.map(function (b) { return { LoadBalancerArn: b.arn, DNSName: b.dns, CanonicalHostedZoneId: b.zone, CreatedTime: isoZ(b.created), LoadBalancerName: b.name, Scheme: b.scheme, VpcId: c.vpc.VpcId, State: { Code: "active" }, Type: "application", AvailabilityZones: Object.keys(b.nodes).map(function (k) { var s = subnetNamed(c, k); return { ZoneName: s.AvailabilityZone, SubnetId: s.SubnetId, LoadBalancerAddresses: [] }; }), SecurityGroups: b.sgs.slice(), IpAddressType: "ipv4" }; }) }; },
    "describe-listeners": function (c, o, x) { var b = c.lbs.filter(function (l) { return l.arn === o["load-balancer-arn"]; })[0]; if (!b) throw new AwsErr("LoadBalancerNotFound", x.op, "One or more load balancers not found"); return { Listeners: b.listeners.map(function (l) { return { ListenerArn: l.arn, LoadBalancerArn: b.arn, Port: l.port, Protocol: l.protocol, DefaultActions: [l.redirect ? { Type: "redirect", RedirectConfig: { Protocol: "HTTPS", Port: "443", StatusCode: "HTTP_301" } } : { Type: "forward", TargetGroupArn: l.tg }] }; }) }; },
    "describe-target-groups": function (c, o, x) { var l = c.tgs.filter(function (t) { return (!o.names || o.names.indexOf(t.name) >= 0) && (!o["target-group-arns"] || o["target-group-arns"].indexOf(t.arn) >= 0); }); if (o.names && !l.length) throw new AwsErr("TargetGroupNotFound", x.op, "One or more target groups not found"); return { TargetGroups: l.map(tgShape) }; },
    "describe-target-health": function (c, o, x) { var t = needTg(c, o, x); return { TargetHealthDescriptions: t.targets.map(function (tt) { return { Target: { Id: tt.id, Port: tt.port }, HealthCheckPort: String(t.hc.port === "traffic-port" ? tt.port : t.hc.port), TargetHealth: targetHealth(c, t, tt) }; }) }; },
    "modify-target-group": function (c, o, x) { var t = needTg(c, o, x); if (o["health-check-path"]) t.hc.path = o["health-check-path"]; if (o["health-check-port"]) t.hc.port = o["health-check-port"]; if (o.matcher) t.hc.matcher = shObj(String(o.matcher)).HttpCode || t.hc.matcher; if (o["health-check-interval-seconds"]) t.hc.interval = +o["health-check-interval-seconds"]; if (o["healthy-threshold-count"]) t.hc.healthy = +o["healthy-threshold-count"]; return { TargetGroups: [tgShape(t)] }; },
    "register-targets": function (c, o, x) { var t = needTg(c, o, x); [].concat(needVal(o, "targets", x.op)).forEach(function (s) { var tt = shObj(s); if (!c.insts.some(function (i) { return i.InstanceId === tt.Id; })) throw new AwsErr("InvalidTarget", x.op, "The following targets are not in a running state and cannot be registered: '" + tt.Id + "'"); if (!t.targets.some(function (q) { return q.id === tt.Id; })) t.targets.push({ id: tt.Id, port: +(tt.Port || t.port) }); }); return null; },
    "deregister-targets": function (c, o, x) { var t = needTg(c, o, x); [].concat(needVal(o, "targets", x.op)).forEach(function (s) { var tt = shObj(s); var k = t.targets.findIndex(function (q) { return q.id === tt.Id; }); if (k < 0) throw new AwsErr("InvalidTarget", x.op, "The following targets are not registered: '" + tt.Id + "'"); t.targets.splice(k, 1); }); return null; }
  };
  function tgShape(t) { return { TargetGroupArn: t.arn, TargetGroupName: t.name, Protocol: t.protocol, Port: t.port, VpcId: t.vpc, HealthCheckProtocol: t.hc.protocol, HealthCheckPort: t.hc.port, HealthCheckEnabled: true, HealthCheckIntervalSeconds: t.hc.interval, HealthCheckTimeoutSeconds: t.hc.timeout, HealthyThresholdCount: t.hc.healthy, UnhealthyThresholdCount: t.hc.unhealthy, HealthCheckPath: t.hc.path, Matcher: { HttpCode: t.hc.matcher }, LoadBalancerArns: [t.lb], TargetType: "instance", ProtocolVersion: "HTTP1", IpAddressType: "ipv4" }; }
  function needTg(c, o, x) { var arn = needVal(o, "target-group-arn", x.op), t = c.tgs.filter(function (g) { return g.arn === arn || g.name === arn; })[0]; if (!t) throw new AwsErr("TargetGroupNotFound", x.op, "One or more target groups not found"); return t; }
  SVC.route53 = {
    "list-hosted-zones": function (c) { return { HostedZones: c.zones.map(function (z) { return { Id: z.Id, Name: z.Name, CallerReference: z.CallerReference, Config: z.Config, ResourceRecordSetCount: z.records.length + 1 }; }) }; },
    "list-resource-record-sets": function (c, o, x) { var z = needZone(c, o, x); var soa = { Name: z.Name, Type: "SOA", TTL: 900, ResourceRecords: [{ Value: "ns-1201.awsdns-22.org. awsdns-hostmaster.amazon.com. 1 7200 900 1209600 86400" }] }; return { ResourceRecordSets: z.records.slice(0, 2).concat([soa]).concat(z.records.slice(2)).map(clone) }; },
    "change-resource-record-sets": function (c, o, x) {
      var z = needZone(c, o, x), batch = structArg(c.sys, c.sess, needVal(o, "change-batch", x.op));
      if (!batch || !Array.isArray(batch.Changes)) throw new AwsErr("InvalidChangeBatch", x.op, "[ChangeBatch must contain a Changes list]");
      batch.Changes.forEach(function (ch) {
        var rs = ch.ResourceRecordSet || {}, name = String(rs.Name || "").toLowerCase().replace(/\.?$/, ".");
        if (!/^(CREATE|UPSERT|DELETE)$/.test(ch.Action)) throw new AwsErr("InvalidInput", x.op, "Invalid request: Expected Action to be CREATE, DELETE or UPSERT");
        if (name.slice(-z.Name.length) !== z.Name) throw new AwsErr("InvalidChangeBatch", x.op, "[RRSet with DNS name " + name + " is not permitted in zone " + z.Name + "]");
        if (!rs.Type) throw new AwsErr("InvalidInput", x.op, "Invalid request: Missing field 'Type' in Change with [Action=" + ch.Action + ", Name=" + name + "]");
        if (rs.AliasTarget && (rs.TTL != null || rs.ResourceRecords)) throw new AwsErr("InvalidInput", x.op, "Invalid request: Expected exactly one of [AliasTarget, all of [TTL, and ResourceRecords], or TrafficPolicyInstanceId], but found more than one in Change with [Action=" + ch.Action + ", Name=" + name + ", Type=" + rs.Type + "]");
        if (rs.AliasTarget) { var dn = String(rs.AliasTarget.DNSName || "").toLowerCase().replace(/\.$/, "").replace(/^dualstack\./, ""); if (dn !== ALB_DNS || rs.AliasTarget.HostedZoneId !== ALB_ZONE) throw new AwsErr("InvalidChangeBatch", x.op, "[Tried to create an alias that targets " + rs.AliasTarget.DNSName + "., type " + rs.Type + " in zone " + rs.AliasTarget.HostedZoneId + ", but the alias target name does not lie within the target zone]"); }
        var k = z.records.findIndex(function (r) { return r.Name === name && r.Type === rs.Type; });
        var conflictCname = z.records.findIndex(function (r) { return r.Name === name && (r.Type === "CNAME") !== (rs.Type === "CNAME"); });
        if (ch.Action === "DELETE") { if (k < 0) throw new AwsErr("InvalidChangeBatch", x.op, "[Tried to delete resource record set [name='" + name + "', type='" + rs.Type + "'] but it was not found]"); z.records.splice(k, 1); return; }
        if (ch.Action === "CREATE" && k >= 0) throw new AwsErr("InvalidChangeBatch", x.op, "[Tried to create resource record set [name='" + name + "', type='" + rs.Type + "'] but it already exists]");
        if (conflictCname >= 0 && !(ch.Action === "UPSERT" && k >= 0)) throw new AwsErr("InvalidChangeBatch", x.op, "[RRSet of type " + rs.Type + " with DNS name " + name + " is not permitted because a conflicting RRSet of type " + z.records[conflictCname].Type + " with the same DNS name already exists in zone " + z.Name + ".]");
        var rec = rs.AliasTarget ? { Name: name, Type: rs.Type, AliasTarget: { HostedZoneId: rs.AliasTarget.HostedZoneId, DNSName: rs.AliasTarget.DNSName.replace(/\.?$/, "."), EvaluateTargetHealth: !!rs.AliasTarget.EvaluateTargetHealth } } : { Name: name, Type: rs.Type, TTL: +rs.TTL, ResourceRecords: rs.ResourceRecords };
        if (k >= 0) z.records[k] = rec; else z.records.push(rec);
      });
      syncDns(c.homeSys);
      return { ChangeInfo: { Id: "/change/C" + M2.hexOf("chg" + JSON.stringify(batch), 20).toUpperCase(), Status: "PENDING", SubmittedAt: isoZ(c.homeNow || NOW), Comment: batch.Comment } };
    }
  };
  function needZone(c, o, x) { var id = String(needVal(o, "hosted-zone-id", x.op)).replace(/^\/hostedzone\//, ""); var z = c.zones.filter(function (q) { return q.Id === "/hostedzone/" + id; })[0]; if (!z) throw new AwsErr("NoSuchHostedZone", x.op, "No hosted zone found with ID: " + id); return z; }
  SVC.logs = {
    "describe-log-groups": function (c) { return { logGroups: Object.keys(c.logGroups).map(function (n) { return { logGroupName: n, creationTime: NOW - 90 * DAY, retentionInDays: 90, metricFilterCount: 0, arn: "arn:aws:logs:" + REGION + ":" + ACCOUNT + ":log-group:" + n + ":*", storedBytes: 48211043 }; }) }; },
    "describe-log-streams": function (c, o, x) { var g = needGroup(c, o, x); return { logStreams: Object.keys(g.streams).map(function (s) { return { logStreamName: s, creationTime: NOW - 30 * DAY, storedBytes: 0 }; }) }; },
    "filter-log-events": function (c, o, x) {
      var g = needGroup(c, o, x), pat = o["filter-pattern"] || "", test = logPattern(pat, x), ev = [];
      var start = o["start-time"] != null ? +o["start-time"] : 0, end = o["end-time"] != null ? +o["end-time"] : Infinity;
      Object.keys(g.streams).forEach(function (s) { if (o["log-stream-names"] && o["log-stream-names"].indexOf(s) < 0) return; g.streams[s].forEach(function (e) { if (e.timestamp >= start && e.timestamp <= end && test(e.message)) ev.push({ logStreamName: s, timestamp: e.timestamp, message: e.message, ingestionTime: e.timestamp + 61000, eventId: M2.hexOf(s + e.timestamp + e.message, 56).replace(/[a-f]/g, function (q) { return "" + (q.charCodeAt(0) % 10); }) }); }); });
      ev.sort(function (a, b) { return a.timestamp - b.timestamp; });
      var lim = o.limit ? +o.limit : 10000;
      return { events: ev.slice(0, lim), searchedLogStreams: Object.keys(g.streams).map(function (s) { return { logStreamName: s, searchedCompletely: true }; }) };
    }
  };
  function needGroup(c, o, x) { var n = needVal(o, "log-group-name", x.op), g = c.logGroups[n]; if (!g) throw new AwsErr("ResourceNotFoundException", x.op, "The specified log group does not exist."); return g; }
  var FLOW_FIELDS = ["version", "account-id", "interface-id", "srcaddr", "dstaddr", "srcport", "dstport", "protocol", "packets", "bytes", "start", "end", "action", "log-status"];
  // CloudWatch Logs filter patterns: plain terms (all must appear), "quoted phrases", and the space-delimited [a, b=1, c!=x, d>100] form
  function logPattern(p, x) {
    p = String(p || "").trim();
    if (!p) return function () { return true; };
    if (/^\[.*\]$/.test(p)) {
      var names = splitTop(p.slice(1, -1), ",").map(function (f) { return f.trim(); });
      var conds = names.map(function (f) { var m = /^([\w.-]+)\s*(=|!=|>=|<=|>|<)\s*(.+)$/.exec(f); if (!m) { if (!/^[\w.-]+$|^\.\.\.$/.test(f)) throw new AwsErr("InvalidParameterException", x.op, "Invalid filter pattern"); return null; } return { op: m[2], v: m[3].replace(/^"(.*)"$/, "$1") }; });
      return function (msg) {
        var w = msg.split(/\s+/);
        if (w.length < names.length) return false;
        return conds.every(function (cd, i) {
          if (!cd) return true;
          var val = w[i];
          if (cd.op === "=") return /\*/.test(cd.v) ? globMatch(cd.v, val) : val === cd.v;
          if (cd.op === "!=") return val !== cd.v;
          var a = +val, b = +cd.v;
          return cd.op === ">" ? a > b : cd.op === "<" ? a < b : cd.op === ">=" ? a >= b : a <= b;
        });
      };
    }
    var terms = []; p.replace(/"([^"]*)"|(\S+)/g, function (m0, q, w) { terms.push(q != null ? q : w); });
    return function (msg) { return terms.every(function (t) { return t.charAt(0) === "-" ? msg.indexOf(t.slice(1)) < 0 : msg.indexOf(t) >= 0; }); };
  }
  SVC.ssm = { "start-session": function (c, o, x, ctx) { return ctx.ssm(); } };

  var USAGE = "usage: aws [options] <command> <subcommand> [<subcommand> ...] [parameters]\nTo see help text, you can run:\n\n  aws help\n  aws <command> help\n  aws <command> <subcommand> help\n";
  CMDS.aws = function (args, io, sess) {
    var sys = sess.sys, home = homeOf(sys), c = cloudOf(sys);
    var a = args.slice(1), g = { output: null, query: null, region: null };
    var rest = [];
    for (var i = 0; i < a.length; i++) {
      var xx = a[i];
      if (xx === "--output") g.output = a[++i]; else if (xx === "--query") g.query = a[++i]; else if (xx === "--region") g.region = a[++i]; else if (xx === "--profile") g.profile = a[++i];
      else if (xx === "--no-cli-pager" || xx === "--no-paginate" || xx === "--debug") continue; else rest.push(xx);
    }
    if (rest[0] === "--version") { out(io, "aws-cli/2.17.62 Python/3.12.6 Linux/6.8.0-48-generic exe/x86_64.ubuntu.24\n"); return 0; }
    if (!rest.length || rest[0] === "help") { errl(io, USAGE.replace(/\n$/, "")); errl(io, "aws: error: the following arguments are required: command"); return 252; }
    if (rest[0] === "configure") { if (rest[1] === "list") { out(io, "      Name                    Value             Type    Location\n      ----                    -----             ----    --------\n   profile                <not set>             None    None\n access_key     ****************7Q2M shared-credentials-file    \n secret_key     ****************hU9x shared-credentials-file    \n    region                eu-west-1      config-file    ~/.aws/config\n"); return 0; } if (rest[1] === "get" && rest[2] === "region") { out(io, REGION + "\n"); return 0; } note(io, "(The lab already configured credentials for you: see ~/.aws/config.)"); return 0; }
    if (!c) { errl(io, "\nUnable to locate credentials. You can configure credentials by running \"aws configure\"."); return 253; }
    var svc = rest[0], op = rest[1], table = SVC[svc];
    if (!table) { errl(io, USAGE.replace(/\n$/, "")); errl(io, "\naws: error: argument command: Invalid choice, valid choices are:\n\nec2                                      | elbv2\nlogs                                     | route53\nssm                                      | sts\n" + (svc === "s3" || svc === "iam" || svc === "wafv2" ? "\n(This lab's AWS account only simulates the networking services above.)" : "")); return 252; }
    if (!op || op === "help") { errl(io, USAGE.replace(/\n$/, "")); errl(io, "aws: error: the following arguments are required: operation"); return 252; }
    if (!table[op]) { errl(io, USAGE.replace(/\n$/, "")); errl(io, "\naws: error: argument operation: Invalid choice, valid choices are:\n\n" + Object.keys(table).sort().join("\n")); return 252; }
    if (g.region && g.region !== REGION) { if (svc !== "route53" && svc !== "sts") { if (/^describe|^list|^filter/.test(op)) { var empty = table[op](build({ now: sys.now, dnsExtra: {} }), {}, { op: OP(op), filters: [] }); Object.keys(empty).forEach(function (k) { if (Array.isArray(empty[k])) empty[k] = []; }); out(io, JSON.stringify(empty, null, 4) + "\n"); note(io, "(Nothing in " + g.region + ": Kestrel's VPC is in " + REGION + ".)"); return 0; } } }
    var o = parseOpts(rest.slice(2)), x = { op: OP(op) };
    if (svc === "route53") x.op = OP(op);
    var res;
    try {
      c.sys = sys; c.sess = sess; c.homeSys = home; c.homeNow = sys.now;
      x.filters = filtersOf(o, sys, sess);
      if (o["dry-run"]) throw new AwsErr("DryRunOperation", x.op, "Request would have succeeded, but DryRun flag is set.");
      res = table[op](c, o, x, { ssm: function () { return ssmStart(sess, io, o.target, c); } });
      c.log.push({ svc: svc, op: op, at: sys.cmdIndex });
    } catch (e) {
      if (!(e instanceof AwsErr)) throw e;
      if (e.code) errl(io, "\nAn error occurred (" + e.code + ") when calling the " + e.op + " operation: " + e.msg);
      else if (e.exit === 252) { errl(io, USAGE.replace(/\n$/, "")); errl(io, (e.extra || "").replace(/^\n/, "")); }
      else errl(io, (e.extra || "").replace(/^\n/, ""));
      return e.exit;
    }
    if (res && res.__done != null) return res.__done;
    if (res == null) return 0;
    res = JSON.parse(JSON.stringify(res));
    var data = res;
    if (g.query) { try { data = JP.search(res, g.query); } catch (e2) { errl(io, "\nBad value for --query " + g.query + ": " + e2.message); return 255; } }
    var fmt = g.output || "json";
    if (fmt === "json") out(io, JSON.stringify(data === undefined ? null : data, null, 4) + "\n");
    else if (fmt === "text") { var t = textOut(data); out(io, t + (t ? "\n" : "")); }
    else if (fmt === "table") out(io, tableOut(data, OP(op)) + "\n");
    else if (fmt === "yaml") out(io, JSON.stringify(data, null, 2).replace(/^(\s*)"([^"]+)":/gm, "$1$2:").replace(/[{}[\],]/g, "") + "\n");
    else { errl(io, "\naws: error: argument --output: Invalid choice, valid choices are:\n\njson                                     | text\ntable                                    | yaml\nyaml-stream"); return 252; }
    return 0;
  };

  function ssmStart(sess, io, target, c) {
    var i = target && c.insts.filter(function (k) { return k.InstanceId === target; })[0];
    if (!target) { errl(io, USAGE.replace(/\n$/, "")); errl(io, "aws: error: the following arguments are required: --target"); return { __done: 252 }; }
    if (!i || i.state !== "running") { errl(io, "\nAn error occurred (TargetNotConnected) when calling the StartSession operation: " + target + " is not connected."); return { __done: 254 }; }
    var home = homeOf(sess.sys), m = M2.machine(home, i.ip);
    var rs = S.newSession(m, { user: "ssm-user" }); S.login(rs);
    var sid = "dev@kestrel.io-0" + M2.hexOf("ssm" + target + sess.sys.cmdIndex, 16);
    out(io, "\nStarting session with SessionId: " + sid + "\n");
    var top = sess.sys.topSession || sess;
    top.userStack.push({ shell: rs, exitMsg: "\n\nExiting session with sessionId: " + sid + ".\n\n" });
    note(io, "(You're on " + i.name + " (" + m.host + ") through Session Manager: no SSH key, no open port 22. Commands run there until you type exit.)");
    return { __done: 0 };
  }

  /* ================================================================== flow logs */
  var FL_GROUP = "/kestrel/vpc-flow-logs";
  // records: [eni, src, dst, srcport, dstport, proto, packets, bytes, start(s), end(s), action]
  function flowLine(r) { return "2 " + ACCOUNT + " " + r[0] + " " + r[1] + " " + r[2] + " " + r[3] + " " + r[4] + " " + r[5] + " " + r[6] + " " + r[7] + " " + r[8] + " " + r[9] + " " + r[10] + " OK"; }
  function putFlowLogs(sys, recs, file) {
    var c = sys.cloud, g = c.logGroups[FL_GROUP] = c.logGroups[FL_GROUP] || { streams: {} };
    recs.sort(function (a, b) { return a[8] - b[8]; }).forEach(function (r) { var s = r[0] + "-all"; (g.streams[s] = g.streams[s] || []).push({ timestamp: r[9] * 1000, message: flowLine(r) }); });
    if (file) putRoot(sys, file, "version account-id interface-id srcaddr dstaddr srcport dstport protocol packets bytes start end action log-status\n" + recs.map(flowLine).join("\n") + "\n", 420, 1000, 1000);
  }

  /* ================================================================== exports */
  N.cloud = {
    build: build, of: cloudOf, flow: flow, endpoint: endpoint, inCidr: inCidr, sgNamed: sgNamed, subnetNamed: subnetNamed, rtNamed: rtNamed, aclNamed: aclNamed, instNamed: instNamed,
    addRule: addRule, rule: rule, rtFor: rtFor, routeTo: routeTo, aclFor: aclFor, aclCheck: aclCheck, sgCheck: sgCheck, targetHealth: targetHealth, syncDns: syncDns, putFlowLogs: putFlowLogs, flowLine: flowLine,
    allowAllEntries: allowAllEntries, hid: hid, eph: eph, JP: JP, ACCOUNT: ACCOUNT, REGION: REGION, ALB_DNS: ALB_DNS, ALB_ZONE: ALB_ZONE, ALB_NODES: ALB_NODES, OUR_NAT_IP: OUR_NAT_IP, FL_GROUP: FL_GROUP, hostOf: hostOf, httpDate: httpDate
  };
  // a lab with the cloud: credentials and config for dev
  N.cloudLab = function (sys) {
    var c = build(sys);
    S.mkdirs(sys, "/home/dev/.aws", 448, 1000, 1000);
    putRoot(sys, "/home/dev/.aws/config", "[default]\nregion = " + REGION + "\noutput = json\ncli_pager =\n", 384, 1000, 1000, NOW - 20 * DAY);
    putRoot(sys, "/home/dev/.aws/credentials", "[default]\naws_access_key_id = " + ["AKIA", "EXAMPLE", "KESTREL7Q2M"].join("") + "\naws_secret_access_key = " + ["wJalr", "XUtnFEMI", "K7MDENG", "bPxRfiCYEXAMPLEhU9x"].join("/").replace(/\//g, "") + "\n", 384, 1000, 1000, NOW - 20 * DAY);
    M3.preinstall(sys, "jq");
    return c;
  };
  M2.CATALOG.push({ name: "awscli", ver: "2.17.62", arch: "amd64", section: "admin", size: 210000, desc: "Universal Command Line Interface for Amazon Web Services", deps: [], bins: [], sbins: [], installed: true, auto: false, archive: "noble" });
  S.SYS_HOOKS.push(function (sys) { putRoot(sys, "/usr/local/bin/aws", "\x7fELF:aws\n", 493, 0, 0, Date.UTC(2026, 9, 2)); });
})(typeof window !== "undefined" ? window : globalThis);
