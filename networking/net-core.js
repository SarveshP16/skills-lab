/* sudo learn — the Networking track's network (Module 1). kc-web-01 sits on a simulated company network: a switch,
   a router with NAT, a DNS resolver, other servers, a VPN router to a partner, VLANs and the internet. Everything is
   data on sys.nw, so commands read and change the same state: interfaces (carrier, speed, duplex, VLANs, MTU),
   addresses (IPv4 and IPv6 with SLAAC), routes, the ARP/neighbour table and sysctl. netplan applies
   /etc/netplan/*.yaml the way systemd-networkd would. reach() walks a packet through the network and is used by
   ping, traceroute, curl, nc, dig and the diagram. Commands record events on sys.nw.events for the visual panel.
   Loaded after the Linux engine (sh-*.js) on the Networking page only, so it may override commands there. */
(function (root) {
  "use strict";
  var S = root.ShEngine, U = S.util, CMDS = S.CMDS, M2 = S.M2;
  var out = U.out, errl = U.errl, note = U.note, lines = U.lines, joinLines = U.joinLines, pad = U.pad, rpad = U.rpad;
  var rd = M2.rd, putRoot = M2.putRoot, nodeAt = M2.nodeAt, jadd = M2.jadd, hash = M2.hash, tod = M2.tod;
  var NOW = S.NOW, DAY = S.DAY;
  var N = {};   // the module's API, published as M2.NET

  /* ================================================================== addresses */
  function isV4(s) { return /^\d{1,3}(\.\d{1,3}){3}$/.test(s) && s.split(".").every(function (x) { return +x <= 255; }); }
  function ip2n(ip) { var p = ip.split("."); return ((+p[0] << 24) >>> 0) + (+p[1] << 16) + (+p[2] << 8) + (+p[3]); }
  function n2ip(n) { n = n >>> 0; return [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join("."); }
  function maskN(p) { return p <= 0 ? 0 : (0xffffffff << (32 - p)) >>> 0; }
  function netOf(ip, p) { return n2ip((ip2n(ip) & maskN(p)) >>> 0); }
  function bcastOf(ip, p) { return n2ip(((ip2n(ip) & maskN(p)) | (~maskN(p) >>> 0)) >>> 0); }
  function inNet(ip, net, p) { return isV4(ip) && ((ip2n(ip) & maskN(p)) >>> 0) === ((ip2n(net) & maskN(p)) >>> 0); }
  function maskToPrefix(m) { if (!isV4(m)) return null; var n = ip2n(m), p = 0; while (p < 32 && (n & (0x80000000 >>> p))) p++; return maskN(p) === n ? p : null; }
  function parseCidr(s) {
    var m = /^([\d.]+)(?:\/(\d{1,2}))?$/.exec(String(s || "").trim());
    if (!m || !isV4(m[1]) || (m[2] !== undefined && +m[2] > 32)) return null;
    return { ip: m[1], prefix: m[2] === undefined ? 32 : +m[2] };
  }
  function isPrivate(ip) { return inNet(ip, "10.0.0.0", 8) || inNet(ip, "172.16.0.0", 12) || inNet(ip, "192.168.0.0", 16); }
  // IPv6
  function v6parse(s) {
    s = String(s || "").toLowerCase().replace(/%.*$/, "");
    if (!/^[0-9a-f:]+$/.test(s) || s.indexOf(":") < 0) return null;
    var halves = s.split("::");
    if (halves.length > 2) return null;
    function grp(x) { return x === "" ? [] : x.split(":"); }
    var a = grp(halves[0]), b = halves.length === 2 ? grp(halves[1]) : [];
    if (halves.length === 1 && a.length !== 8) return null;
    if (a.concat(b).some(function (g) { return !/^[0-9a-f]{1,4}$/.test(g); })) return null;
    var fill = 8 - a.length - b.length;
    if (fill < (halves.length === 2 ? 1 : 0)) return null;
    var res = a.map(function (g) { return parseInt(g, 16); });
    for (var i = 0; i < fill; i++) res.push(0);
    return res.concat(b.map(function (g) { return parseInt(g, 16); }));
  }
  function v6str(g) {
    // RFC 5952: the longest run of 2+ zero groups becomes ::, lower case, no leading zeros
    var best = -1, bestLen = 0, i = 0;
    while (i < 8) { if (g[i] === 0) { var j = i; while (j < 8 && g[j] === 0) j++; if (j - i > bestLen && j - i >= 2) { best = i; bestLen = j - i; } i = j; } else i++; }
    var h = g.map(function (x) { return x.toString(16); });
    if (best < 0) return h.join(":");
    return h.slice(0, best).join(":") + "::" + h.slice(best + bestLen).join(":");
  }
  function v6full(g) { return g.map(function (x) { return ("000" + x.toString(16)).slice(-4); }).join(":"); }
  function isV6(s) { return !!v6parse(s); }
  function v6norm(s) { var g = v6parse(s); return g ? v6str(g) : null; }
  function v6inNet(addr, net, p) { var a = v6parse(addr), b = v6parse(net); if (!a || !b) return false; for (var i = 0; i < 8; i++) { var bits = Math.max(0, Math.min(16, p - i * 16)); var m = bits === 0 ? 0 : (0xffff << (16 - bits)) & 0xffff; if ((a[i] & m) !== (b[i] & m)) return false; } return true; }
  function eui64(mac) { var b = mac.split(":").map(function (x) { return parseInt(x, 16); }); b[0] ^= 2; return [(b[0] << 8) | b[1], (b[2] << 8) | 0xff, 0xfe00 | b[3], (b[4] << 8) | b[5]]; }
  function isLinkLocal6(s) { var g = v6parse(s); return !!g && (g[0] & 0xffc0) === 0xfe80; }
  N.isV4 = isV4; N.isV6 = isV6; N.ip2n = ip2n; N.n2ip = n2ip; N.netOf = netOf; N.bcastOf = bcastOf; N.inNet = inNet; N.parseCidr = parseCidr; N.maskToPrefix = maskToPrefix; N.v6parse = v6parse; N.v6str = v6str; N.v6full = v6full; N.v6norm = v6norm; N.eui64 = eui64; N.isPrivate = isPrivate;

  /* ================================================================== the world */
  var MY_MAC = "52:54:00:4e:1a:07", MY_MAC2 = "52:54:00:4e:1a:08", PUB = "203.0.113.80";
  var MAC = { gw: "52:54:00:12:35:02", dns: "52:54:00:6d:0e:91", db: "52:54:00:9c:41:7e", backup: "52:54:00:b7:20:3d", vpn: "52:54:00:e1:77:0c", lb: "52:54:00:3a:c2:19", backup30: "52:54:00:b7:20:3e", gw30: "52:54:00:12:35:30" };
  // L2 segments (broadcast domains). A NIC is plugged into a switch port that carries one untagged segment and
  // maybe some tagged VLANs.
  var SEGS = {
    srv: { name: "server LAN", net: "10.20.0.0", prefix: 24, v6: "2001:db8:20::", ra: true, dhcp: { "52:54:00:4e:1a:07": "10.20.0.15", "52:54:00:4e:1a:08": "10.20.0.15" }, peers: {
      "10.20.0.1": { name: "kc-gw-01", node: "gw", mac: MAC.gw, rtt: 0.38, router: "gw", ll6: "fe80::1", ip6: "2001:db8:20::1" },
      "10.20.0.2": { name: "kc-dns-01", node: "dns", mac: MAC.dns, rtt: 0.31, resolver: true, ip6: "2001:db8:20::2" },
      "10.20.0.10": { name: "kc-lb-01", node: "lb", mac: MAC.lb, rtt: 0.36, ports: [22, 80, 443] },
      "10.20.0.21": { name: "kc-db-01", node: "db", mac: MAC.db, rtt: 0.42, ip6: "2001:db8:20::21" },
      "10.20.0.31": { name: "kc-backup-01", node: "backup", mac: MAC.backup, rtt: 0.51 },
      "10.20.0.254": { name: "kc-vpn-01", node: "vpn", mac: MAC.vpn, rtt: 0.47, router: "vpn" } } },
    bk30: { name: "backup VLAN 30", vid: 30, net: "10.20.30.0", prefix: 24, peers: {
      "10.20.30.31": { name: "kc-backup-01", node: "backup", mac: MAC.backup30, rtt: 0.29, ports: [22, 873] } } },
    mgmt20: { name: "management VLAN 20", vid: 20, net: "10.20.20.0", prefix: 24, peers: {
      "10.20.20.2": { name: "sw-core-01", node: "sw", mac: "00:1b:54:c3:11:02", rtt: 1.1, ports: [22, 443] } } }
  };
  // What a switch port carries: untagged segment + tagged VLAN id -> segment
  var PORTS = { "sw-core-01/14": { untagged: "srv", tagged: { 20: "mgmt20", 30: "bk30" } }, "sw-core-01/15": { untagged: "srv", tagged: { 20: "mgmt20", 30: "bk30" } } };
  // Beyond the LAN. The office network behind kc-gw-01, the partner behind the VPN router, the ISP and the internet.
  var OFFICE = { net: "10.20.5.0", prefix: 24, hosts: { "10.20.5.10": { name: "kc-mon-01", node: "mon", rtt: 1.2, ports: [22, 9090] }, "10.20.5.1": { name: "kc-gw-01", node: "gw", rtt: 0.4 } } };
  var PARTNER = { net: "172.16.50.0", prefix: 24, hosts: { "172.16.50.10": { name: "partner-api", node: "partner", rtt: 18.6, ports: [443] } } };
  var ISP = [["203.0.113.1", "edge1.isp.example.net", 2.1], ["198.51.100.65", "core1.fra.isp.example.net", 5.3], ["198.51.100.130", "ix1.fra.isp.example.net", 8.9]];
  // tail hops after the ISP for some destinations ([ip or null for a hop that doesn't answer, name, ms])
  var TAILS = {
    "93.184.215.14": [[null], ["152.195.64.153", "ae-65.core1.fra.edgecastcdn.net", 86.9], ["93.184.215.1", null, 87.8]],
    "1.1.1.1": [], "1.0.0.1": [], "8.8.8.8": [["142.250.160.85", null, 11.2]], "8.8.4.4": [["142.250.160.85", null, 11.4]],
    "140.82.121.4": [["140.82.112.21", null, 20.7]], "140.82.121.6": [["140.82.112.21", null, 20.9]],
    "142.250.185.78": [["142.250.160.85", null, 10.0]], "34.160.111.145": [["34.160.0.1", null, 13.8]],
    "203.0.113.90": [], "203.0.113.25": []
  };
  var TTLBASE = { "8.8.8.8": 128, "8.8.4.4": 128, "142.250.185.78": 128 };
  var NAMES = { "10.20.0.1": "kc-gw-01.kestrel.internal", "10.20.0.2": "kc-dns-01.kestrel.internal", "10.20.0.10": "kc-lb-01.kestrel.internal", "10.20.0.15": "kc-web-01.kestrel.internal", "10.20.0.21": "kc-db-01.kestrel.internal", "10.20.0.31": "kc-backup-01.kestrel.internal", "10.20.0.254": "kc-vpn-01.kestrel.internal", "10.20.5.10": "kc-mon-01.kestrel.internal", "10.20.30.31": "kc-backup-01-stor.kestrel.internal", "10.20.20.2": "sw-core-01.kestrel.internal", "1.1.1.1": "one.one.one.one", "8.8.8.8": "dns.google", "93.184.215.14": "example.com", "203.0.113.80": "kestrel.example.com" };
  ISP.forEach(function (h) { NAMES[h[0]] = h[1]; });
  Object.keys(TAILS).forEach(function (k) { TAILS[k].forEach(function (h) { if (h[0] && h[1]) NAMES[h[0]] = h[1]; }); });
  // IPv6 hosts on the internet
  var V6HOSTS = {
    "2606:2800:21f:cb07:6820:80da:af6b:8b2c": { name: "example.com", rtt: 89.2, v4: "93.184.215.14", ports: [80, 443] },
    "2606:4700:4700::1111": { name: "one.one.one.one", rtt: 10.1, v4: "1.1.1.1", ports: [53, 80, 443] },
    "2001:4860:4860::8888": { name: "dns.google", rtt: 12.6, v4: "8.8.8.8", ports: [53, 443] }
  };
  var RESOLVERS = ["10.20.0.2", "1.1.1.1", "1.0.0.1", "8.8.8.8", "8.8.4.4", "2606:4700:4700::1111", "2001:4860:4860::8888"];
  N.W = { SEGS: SEGS, PORTS: PORTS, OFFICE: OFFICE, PARTNER: PARTNER, ISP: ISP, TAILS: TAILS, NAMES: NAMES, V6HOSTS: V6HOSTS, RESOLVERS: RESOLVERS, PUB: PUB, MAC: MAC, MY_MAC: MY_MAC, MY_MAC2: MY_MAC2 };

  // The rest of the internet comes from the Linux network (M2.net.HOSTS: ping times and open ports). Add ours.
  var H = M2.net.HOSTS, DNS = M2.net.DNS;
  H[PUB] = { ping: 1.9, ports: [80, 443], site: "kestrel" };
  H["203.0.113.90"] = { ping: 2.4, ports: [80, 443], site: "kestrel-lb" };
  H["172.65.32.248"] = { ping: 15.2, ports: [443] };
  DNS["acme-v02.api.letsencrypt.org"] = { CNAME: "prod.api.letsencrypt.org." };
  DNS["prod.api.letsencrypt.org"] = { A: ["172.65.32.248"] };
  M2.net.SITES.ifconfig = function () { return { status: 200, headers: { "Content-Type": "text/plain; charset=utf-8", Server: "istio-envoy" }, body: PUB + "\n" }; };
  delete H["203.0.113.10"];
  // DNS for the track: kestrel.example.com now lives on kc-web-01 (behind kc-gw-01's public address)
  DNS["kestrel.example.com"] = { A: [PUB], MX: ["10 mail.kestrel.example.com."], TXT: ["\"v=spf1 mx -all\"", "\"google-site-verification=Xk2b8Q1nR4tW7yZ0aC3dF6gH9jL2mP5s\""], NS: ["ns1.example-dns.net.", "ns2.example-dns.net."], SOA: ["ns1.example-dns.net. hostmaster.kestrel.example.com. 2026111101 7200 3600 1209600 300"] };
  DNS["www.kestrel.example.com"] = { CNAME: "kestrel.example.com." };
  DNS["shop.kestrel.example.com"] = { A: [PUB] };
  DNS["api.kestrel.example.com"] = { A: ["203.0.113.90"] };
  DNS["status.kestrel.example.com"] = { CNAME: "kestrel-status.statuspage.example.net." };
  DNS["kestrel-status.statuspage.example.net"] = { A: ["198.51.100.200"] };
  DNS["ns1.example-dns.net"] = { A: ["192.0.2.53"] }; DNS["ns2.example-dns.net"] = { A: ["198.51.100.53"] };
  DNS["example.com"].AAAA = ["2606:2800:21f:cb07:6820:80da:af6b:8b2c"];
  DNS["one.one.one.one"].AAAA = ["2606:4700:4700::1111"];
  DNS["dns.google"].AAAA = ["2001:4860:4860::8888"];
  DNS["kc-gw-01.kestrel.internal"] = { A: ["10.20.0.1"], internal: true };
  DNS["kc-dns-01.kestrel.internal"] = { A: ["10.20.0.2"], internal: true };
  DNS["kc-lb-01.kestrel.internal"] = { A: ["10.20.0.10"], internal: true };
  DNS["kc-vpn-01.kestrel.internal"] = { A: ["10.20.0.254"], internal: true };
  DNS["kc-mon-01.kestrel.internal"] = { A: ["10.20.5.10"], internal: true };
  DNS["kc-backup-01-stor.kestrel.internal"] = { A: ["10.20.30.31"], internal: true };
  DNS["sw-core-01.kestrel.internal"] = { A: ["10.20.20.2"], internal: true };
  DNS["partner-api.kestrel.internal"] = { A: ["172.16.50.10"], internal: true };
  DNS["kc-db-01.kestrel.internal"].AAAA = ["2001:db8:20::21"];
  var TTL = { "kestrel.example.com": 300, "www.kestrel.example.com": 3600, "api.kestrel.example.com": 300, "shop.kestrel.example.com": 300, "example.com": 3561, "github.com": 60, "dns.google": 900, "one.one.one.one": 300 };
  N.ttlOf = function (sys, name, type) {
    var n = String(name).replace(/\.$/, "").toLowerCase(), t = (sys.dnsTtl || {})[n] || TTL[n];
    if (type === "NS") return 172800; if (type === "SOA") return 900; if (type === "MX" || type === "TXT") return 3600;
    if (t) return t; return /\.internal$/.test(n) ? 3600 : 300;
  };

  /* ================================================================== the machine's network state */
  function nic(name, mac, port, idx, alt) {
    return { name: name, idx: idx, kind: "ether", mac: mac, altname: alt, port: port, admin: true, cable: !!port, mtu: 1500,
      autoneg: true, speed: 1000, duplex: "full", maxSpeed: 1000, addrs: [], addrs6: [], managed: false,
      stats: { rxB: 1402187733, rxP: 1824467, rxE: 0, rxD: 0, txB: 912873221, txP: 1301122, txE: 0, coll: 0, crc: 0 } };
  }
  function baseNw(sys) {
    var nw = {
      ifs: {
        lo: { name: "lo", idx: 1, kind: "loopback", mac: "00:00:00:00:00:00", admin: true, mtu: 65536, addrs: [{ ip: "127.0.0.1", prefix: 8, scope: "host" }], addrs6: [{ ip: "::1", prefix: 128, scope: "host" }], stats: { rxB: 81223, rxP: 912, rxE: 0, rxD: 0, txB: 81223, txP: 912, txE: 0, coll: 0, crc: 0 } },
        eth0: nic("eth0", MY_MAC, "sw-core-01/14", 2, "enp0s3")
      },
      sw: { "sw-core-01/14": { autoneg: true, speed: 1000, duplex: "full", maxSpeed: 1000 }, "sw-core-01/15": { autoneg: true, speed: 1000, duplex: "full", maxSpeed: 1000 } },
      routes: [], routes6: [], neigh: {}, neigh6: {}, linkDns: {}, events: [],
      sysctl: { "net.ipv4.ip_forward": "0", "net.ipv4.icmp_echo_ignore_all": "0", "net.ipv4.conf.all.rp_filter": "2", "net.ipv6.conf.all.disable_ipv6": "0", "net.ipv6.conf.default.disable_ipv6": "0", "net.ipv6.conf.all.forwarding": "0", "net.ipv4.tcp_syncookies": "1", "net.core.somaxconn": "4096" },
      v6dis: {}, down: {}, dups: {}, extraPeers: {}, nextIdx: 4, managed: {}
    };
    return nw;
  }
  function nwOf(sys) { return sys.nw; }
  N.nwOf = nwOf; N.nic = nic;
  function ifList(nw) { return Object.keys(nw.ifs).map(function (k) { return nw.ifs[k]; }).sort(function (a, b) { return a.idx - b.idx; }); }
  // Link state: carrier and the negotiated speed/duplex (a forced side and an autonegotiating side end up at half duplex)
  function linkOf(nw, d) {
    if (d.kind === "loopback") return { up: d.admin, carrier: true };
    if (d.kind === "vlan") { var p = nw.ifs[d.parent]; var pl = p ? linkOf(nw, p) : { carrier: false }; return { up: d.admin, carrier: d.admin && p && p.admin && pl.carrier, lowerDown: !(p && p.admin && pl.carrier), speed: pl.speed, duplex: pl.duplex, mismatch: pl.mismatch }; }
    var sw = d.port && nw.sw[d.port];
    if (!d.cable || !sw || sw.shutdown) return { up: d.admin, carrier: false };
    if (!d.admin) return { up: false, carrier: false };
    var speed, duplex, mismatch = false;
    if (d.autoneg && sw.autoneg) { speed = Math.min(d.maxSpeed, sw.maxSpeed); duplex = "full"; }
    else if (d.autoneg && !sw.autoneg) { speed = sw.speed; duplex = "half"; mismatch = sw.duplex === "full"; }
    else if (!d.autoneg && sw.autoneg) { speed = d.speed; duplex = d.duplex; mismatch = d.duplex === "full"; }
    else { if (d.speed !== sw.speed) return { up: true, carrier: false, speedMismatch: true }; speed = d.speed; duplex = d.duplex; mismatch = d.duplex !== sw.duplex; }
    return { up: true, carrier: true, speed: speed, duplex: duplex, mismatch: mismatch };
  }
  N.linkOf = linkOf;
  function segOf(nw, d) {
    var l = linkOf(nw, d);
    if (!l.carrier) return null;
    if (d.kind === "vlan") { var p = nw.ifs[d.parent], pt = PORTS[p.port]; return pt && pt.tagged[d.vid] || null; }
    var pt2 = PORTS[d.port];
    return pt2 ? pt2.untagged : null;
  }
  N.segOf = segOf;
  function v6enabled(nw, d) {
    if (d.kind === "loopback") return nw.sysctl["net.ipv6.conf.all.disable_ipv6"] !== "1" || true;
    var v = nw.sysctl["net.ipv6.conf." + d.name + ".disable_ipv6"];
    if (v === undefined) v = nw.sysctl["net.ipv6.conf.default.disable_ipv6"];
    return nw.sysctl["net.ipv6.conf.all.disable_ipv6"] !== "1" && v !== "1";
  }
  N.v6enabled = v6enabled;
  // The IPv6 addresses an interface really has right now: static ones, link-local, and SLAAC from router adverts.
  function addrs6(nw, d) {
    if (d.kind === "loopback") return nw.sysctl["net.ipv6.conf.all.disable_ipv6"] === "1" ? [] : d.addrs6;
    if (!v6enabled(nw, d) || !d.admin) return [];
    var res = [];
    var l = linkOf(nw, d);
    d.addrs6.forEach(function (a) { res.push(a); });
    var seg = segOf(nw, d), sg = seg && SEGS[seg];
    if (l.carrier && sg && sg.v6 && sg.ra && d.acceptRa !== false && nw.sysctl["net.ipv6.conf.all.forwarding"] !== "1") {
      var g = v6parse(sg.v6).slice(0, 4).concat(eui64(d.mac));
      res.push({ ip: v6str(g), prefix: 64, scope: "global", slaac: true });
    }
    if (d.linkLocal !== false) res.push({ ip: v6str([0xfe80, 0, 0, 0].concat(eui64(d.mac))), prefix: 64, scope: "link" });
    return res;
  }
  N.addrs6 = addrs6;
  function own4(nw) { var r = []; ifList(nw).forEach(function (d) { if (!d.admin) return; d.addrs.forEach(function (a) { r.push({ ip: a.ip, prefix: a.prefix, dev: d.name }); }); }); return r; }
  function own6(nw) { var r = []; ifList(nw).forEach(function (d) { addrs6(nw, d).forEach(function (a) { r.push({ ip: a.ip, prefix: a.prefix, dev: d.name, scope: a.scope }); }); }); return r; }
  function isOwn(nw, ip) {
    if (isV4(ip)) return /^127\./.test(ip) || own4(nw).some(function (a) { return a.ip === ip; });
    var n = v6norm(ip); return n === "::1" || own6(nw).some(function (a) { return a.ip === n; });
  }
  N.own4 = own4; N.own6 = own6; N.isOwn = isOwn; N.ifList = ifList;

  /* ---------------- routes */
  // Kernel routes come from addresses on links that are up; static routes are kept while their device is up.
  function routes4(nw) {
    var r = [];
    ifList(nw).forEach(function (d) {
      if (!d.admin || d.kind === "loopback") return;
      var down = !linkOf(nw, d).carrier;
      d.addrs.forEach(function (a) { if (a.prefix < 32) r.push({ dst: netOf(a.ip, a.prefix), prefix: a.prefix, dev: d.name, proto: "kernel", scope: "link", src: a.ip, metric: a.dhcp ? 100 : 0, linkdown: down }); });
    });
    nw.routes.forEach(function (rt) { var d = nw.ifs[rt.dev]; if (d && d.admin) r.push(Object.assign({}, rt, { linkdown: !linkOf(nw, d).carrier })); });
    return r;
  }
  function lookup4(nw, dst) {
    var best = null;
    routes4(nw).forEach(function (rt) {
      if (!inNet(dst, rt.dst, rt.prefix)) return;
      if (!best || rt.prefix > best.prefix || (rt.prefix === best.prefix && (rt.metric || 0) < (best.metric || 0))) best = rt;
    });
    if (!best) return null;
    var d = nw.ifs[best.dev];
    var src = best.src || (d.addrs[0] && d.addrs[0].ip) || own4(nw).filter(function (a) { return !/^127\./.test(a.ip); }).map(function (a) { return a.ip; })[0];
    return Object.assign({}, best, { src: src });
  }
  function routes6(nw) {
    var r = [];
    ifList(nw).forEach(function (d) {
      if (d.kind === "loopback") return;
      var a6 = addrs6(nw, d);
      if (!a6.length) return;
      var seen = {};
      a6.forEach(function (a) {
        if (a.scope === "link") { if (!seen["fe80::"]) { seen["fe80::"] = true; r.push({ dst: "fe80::", prefix: 64, dev: d.name, proto: "kernel", metric: 256 }); } return; }
        var net = v6str(v6parse(a.ip).slice(0, 4).concat([0, 0, 0, 0]));
        if (!seen[net]) { seen[net] = true; r.push({ dst: net, prefix: a.prefix, dev: d.name, proto: a.slaac ? "ra" : "kernel", metric: a.slaac ? 100 : 256, ra: a.slaac }); }
      });
      var seg = segOf(nw, d);
      if (a6.some(function (a) { return a.slaac; }) && seg && SEGS[seg].ra) r.push({ dst: "::", prefix: 0, via: "fe80::1", dev: d.name, proto: "ra", metric: 100 });
    });
    nw.routes6.forEach(function (rt) { var d = nw.ifs[rt.dev]; if (d && d.admin && v6enabled(nw, d)) r.push(rt); });
    return r;
  }
  function lookup6(nw, dst) {
    var best = null;
    routes6(nw).forEach(function (rt) { if (rt.dst === "fe80::" && !isLinkLocal6(dst)) return; if (!v6inNet(dst, rt.dst, rt.prefix)) return; if (!best || rt.prefix > best.prefix) best = rt; });
    return best;
  }
  N.routes4 = routes4; N.lookup4 = lookup4; N.routes6 = routes6; N.lookup6 = lookup6;

  /* ---------------- reach: walk a packet to dst and back */
  function peerOn(nw, seg, ip) {
    if (!seg) return null;
    if ((nw.down || {})[ip]) return null;
    var p = (nw.extraPeers[seg] || {})[ip] || SEGS[seg].peers[ip];
    return p || null;
  }
  function peer6On(nw, seg, ip) {
    var sg = SEGS[seg]; if (!sg) return null;
    var n = v6norm(ip);
    for (var k in sg.peers) { var p = sg.peers[k]; if ((p.ll6 && v6norm(p.ll6) === n) || (p.ip6 && v6norm(p.ip6) === n)) return (nw.down || {})[k] ? null : Object.assign({ v4: k }, p); }
    return null;
  }
  // Result: {ok, err: netunreach|hostunreach|timeout|badzone, from (ip that reported), loss, rtt, ttl, hops:[{ip,name,rtt}|null],
  //          dev, src, nh, nhMac, path:[diagram node ids], self, dup}
  function reach(sys, dst, o) {
    o = o || {};
    var nw = sys.nw;
    if (isV6(dst)) return reach6(sys, dst, o);
    if (isOwn(nw, dst)) return { ok: true, self: true, rtt: 0.035, ttl: 64, hops: [{ ip: dst, name: sys.host, rtt: 0.035 }], path: ["you"], loss: 0, dev: "lo", src: dst };
    var rt = lookup4(nw, dst);
    if (!rt) return { ok: false, err: "netunreach", path: ["you"], fail: "you" };
    var d = nw.ifs[rt.dev], l = linkOf(nw, d), seg = segOf(nw, d);
    var res = { dev: rt.dev, src: rt.src, via: rt.via || null, path: ["you"], hops: [], loss: 0, routeMtu: rt.mtu || (nw.ifs[rt.dev] || {}).mtu || 1500 };
    if (!l.carrier || !seg) return Object.assign(res, { ok: false, err: "hostunreach", from: rt.src, fail: "you", nic: true });
    res.path.push(seg === "srv" ? "sw" : seg === "bk30" ? "sw" : "sw");
    var nh = rt.via || dst;
    res.nh = nh;
    var p = peerOn(nw, seg, nh);
    var perm = nw.neigh[nh] && nw.neigh[nh].perm ? nw.neigh[nh] : null;
    if (!p) { if (!o.quiet) learnFail(nw, nh, rt.dev); return Object.assign(res, { ok: false, err: "hostunreach", from: rt.src, fail: "sw", arpFail: nh }); }
    var dup = (nw.dups || {})[nh];
    if (perm && perm.mac.toLowerCase() !== p.mac) return Object.assign(res, { ok: false, err: "timeout", fail: "sw", wrongMac: perm.mac });
    res.nhMac = p.mac;
    if (dup && !perm) { res.loss = 0.5; res.dup = dup; }
    if (l.mismatch) { res.loss = Math.max(res.loss, 0.25); res.slow = true; }
    if (!o.quiet) learn(nw, nh, p.mac, rt.dev);
    var speedPenalty = l.speed && l.speed < 100 ? 2.6 : l.mismatch ? 1.9 : 0;
    if (!rt.via) {
      res.path.push(p.node || "lan");
      var ttl = 64;
      if (o.port != null && p.ports && p.ports.indexOf(o.port) < 0 && !p.anyPort) res.refused = true;
      return Object.assign(res, { ok: true, rtt: p.rtt + speedPenalty, ttl: ttl, hops: [{ ip: dst, name: NAMES[dst] || p.name, rtt: p.rtt + speedPenalty }], node: p.node, peer: p });
    }
    // through a router
    if (!p.router) return Object.assign(res, { ok: false, err: "timeout", fail: p.node, notRouter: true });
    res.path.push(p.node);
    var hop1 = { ip: nh, name: NAMES[nh] || p.name, rtt: p.rtt + speedPenalty };
    res.hops.push(hop1);
    var base = p.rtt + speedPenalty;
    if (p.router === "vpn") {
      if (inNet(dst, PARTNER.net, PARTNER.prefix)) {
        res.path.push("partner");
        var ph = PARTNER.hosts[dst];
        res.hops.push({ ip: "172.31.255.2", name: null, rtt: base + 17.9 });
        if (!ph || (nw.down || {})[dst]) return Object.assign(res, { ok: false, err: "timeout", fail: "partner" });
        res.hops.push({ ip: dst, name: NAMES[dst] || null, rtt: base + ph.rtt });
        return Object.assign(res, { ok: true, rtt: base + ph.rtt, ttl: 62, node: "partner", peer: ph, pmtu: nw.partnerMtu || 1400, pmtuFrom: "10.20.0.254" });
      }
      return Object.assign(res, { ok: false, err: "timeout", fail: "vpn" });
    }
    // kc-gw-01: the office network, our own LAN (hairpin), the internet with NAT
    if (inNet(dst, OFFICE.net, OFFICE.prefix)) {
      var oh = OFFICE.hosts[dst];
      if (!oh || (nw.down || {})[dst]) return Object.assign(res, { ok: false, err: "hostunreach", from: nh, fail: "gw" });
      res.path.push(oh.node);
      if (dst !== "10.20.5.1") res.hops.push({ ip: dst, name: NAMES[dst] || oh.name, rtt: base + oh.rtt });
      return Object.assign(res, { ok: true, rtt: base + oh.rtt, ttl: 63, node: oh.node, peer: oh });
    }
    if (inNet(dst, "10.20.0.0", 24)) {
      var lp = peerOn(nw, "srv", dst);
      if (!lp) return Object.assign(res, { ok: false, err: "hostunreach", from: nh, fail: "gw" });
      res.path.push(lp.node);
      res.hops.push({ ip: dst, name: NAMES[dst] || lp.name, rtt: base + lp.rtt });
      return Object.assign(res, { ok: true, rtt: base + lp.rtt, ttl: 63, node: lp.node, peer: lp, redirect: true });
    }
    if (isPrivate(dst) || /^127\./.test(dst)) {
      // private addresses aren't routed on the internet: the ISP drops them
      res.path.push("inet");
      res.hops.push({ ip: ISP[0][0], name: ISP[0][1], rtt: base + ISP[0][2] });
      return Object.assign(res, { ok: false, err: "timeout", fail: "inet", bogon: true });
    }
    if (nw.wanDown) return Object.assign(res, { ok: false, err: "timeout", fail: "gw" });
    res.path.push("inet");
    res.nat = PUB;
    ISP.forEach(function (h) { res.hops.push({ ip: h[0], name: h[1], rtt: base + h[2] }); });
    if (dst === PUB || dst === "203.0.113.1") {
      // our own public address: kc-gw-01 answers (and forwards ports 80/443 back to kc-web-01)
      res.hops = [hop1];
      res.path = res.path.slice(0, 3);
      return Object.assign(res, { ok: true, rtt: base + 0.2, ttl: 64, node: "gw", pub: true });
    }
    var hi = H[dst];
    var tail = TAILS[dst] || (hi ? [] : null);
    if (!hi && !tail) { for (var i = 0; i < 27; i++) res.hops.push(null); return Object.assign(res, { ok: false, err: "timeout", fail: "inet" }); }
    (tail || []).forEach(function (h) { res.hops.push(h[0] ? { ip: h[0], name: h[1] || null, rtt: base + h[2] } : null); });
    var rtt = base + (hi && hi.ping != null ? hi.ping : 30);
    var routers = res.hops.length;
    res.hops.push({ ip: dst, name: NAMES[dst] || null, rtt: rtt });
    if (hi && hi.ping == null) { res.hops.pop(); for (var j = 0; j < 4; j++) res.hops.push(null); return Object.assign(res, { ok: false, err: "timeout", fail: "inet", icmpBlocked: true, tcpOk: true }); }
    return Object.assign(res, { ok: true, rtt: rtt, ttl: (TTLBASE[dst] || 64) - routers, node: "inet", peer: hi });
  }
  function reach6(sys, dst, o) {
    var nw = sys.nw, zone = /%(.+)$/.exec(String(dst)), n = v6norm(dst);
    if (n === "::1" || isOwn(nw, n)) return { ok: true, self: true, rtt: 0.04, ttl: 64, hops: [{ ip: n, rtt: 0.04 }], path: ["you"], loss: 0, v6: true };
    if (isLinkLocal6(n)) {
      if (!zone) return { ok: false, err: "badzone", path: ["you"], fail: "you", v6: true };
      var d = nw.ifs[zone[1]];
      if (!d || !addrs6(nw, d).length) return { ok: false, err: "netunreach", path: ["you"], fail: "you", v6: true };
      var seg = segOf(nw, d), p = peer6On(nw, seg, n);
      if (!p) return { ok: false, err: "hostunreach", path: ["you", "sw"], fail: "sw", v6: true, dev: d.name };
      return { ok: true, rtt: p.rtt, ttl: 64, hops: [{ ip: n, rtt: p.rtt }], path: ["you", "sw", p.node], v6: true, dev: d.name, loss: 0, node: p.node };
    }
    var rt = lookup6(nw, n);
    if (!rt) return { ok: false, err: "netunreach", path: ["you"], fail: "you", v6: true };
    var dv = nw.ifs[rt.dev], sg = segOf(nw, dv);
    if (!sg) return { ok: false, err: "hostunreach", path: ["you"], fail: "you", v6: true };
    var src = (addrs6(nw, dv).filter(function (a) { return a.scope === "global"; })[0] || {}).ip;
    if (!rt.via) {
      var lp = peer6On(nw, sg, n);
      if (!lp) return { ok: false, err: "hostunreach", path: ["you", "sw"], fail: "sw", v6: true, src: src };
      return { ok: true, rtt: lp.rtt, ttl: 64, hops: [{ ip: n, rtt: lp.rtt }], path: ["you", "sw", lp.node], v6: true, loss: 0, src: src, node: lp.node };
    }
    var gw = peer6On(nw, sg, rt.via);
    if (!gw) return { ok: false, err: "hostunreach", path: ["you", "sw"], fail: "sw", v6: true, src: src };
    var host = V6HOSTS[n];
    var hops = [{ ip: "2001:db8:20::1", name: "kc-gw-01.kestrel.internal", rtt: gw.rtt }, { ip: "2001:db8:ffff::1", name: "edge1.isp.example.net", rtt: gw.rtt + 2.2 }, { ip: "2001:db8:ffff:2::1", name: "core1.fra.isp.example.net", rtt: gw.rtt + 5.5 }];
    if (!host || nw.wanDown) { return { ok: false, err: "timeout", path: ["you", "sw", "gw", "inet"], fail: "inet", v6: true, hops: hops, src: src }; }
    hops.push({ ip: n, name: host.name, rtt: gw.rtt + host.rtt });
    return { ok: true, rtt: gw.rtt + host.rtt, ttl: 64 - 3, hops: hops, path: ["you", "sw", "gw", "inet"], v6: true, loss: 0, src: src, node: "inet", peer: host };
  }
  N.reach = reach;
  function learn(nw, ip, mac, dev) { var cur = nw.neigh[ip]; if (cur && cur.perm) return; nw.neigh[ip] = { mac: mac, dev: dev, state: "REACHABLE" }; }
  function learnFail(nw, ip, dev) { var cur = nw.neigh[ip]; if (cur && cur.perm) return; nw.neigh[ip] = { mac: null, dev: dev, state: "FAILED" }; }
  N.learn = learn;

  /* ---------------- events for the visual panel (one list per command line) */
  function ev(sys, e) { if (!sys.nw) return; e.i = sys.cmdIndex == null ? -1 : sys.cmdIndex; sys.nw.events.push(e); if (N.onEv) N.onEv(sys, e); }
  N.ev = ev;

  /* ---------------- names: /etc/hosts, then DNS through the resolver (see net-apps.js for the DNS side) */
  function hostsFile(sys) { var res = []; lines(rd(sys, "/etc/hosts") || "").forEach(function (l) { l = l.replace(/#.*/, "").trim(); if (!l) return; var f = l.split(/\s+/); f.slice(1).forEach(function (n) { res.push({ name: n.toLowerCase(), ip: f[0] }); }); }); return res; }
  N.hostsFile = hostsFile;

  /* ================================================================== netplan */
  // A small YAML reader: maps, block lists, lists of maps, flow lists [a, b], quotes, comments. Keeps line numbers.
  function YamlError(line, col, msg) { this.line = line; this.col = col; this.message = msg; }
  function parseYaml(text) {
    var L = String(text).replace(/\r/g, "").split("\n").map(function (raw, i) {
      var s = raw.replace(/\t/g, "        "), noc = s.replace(/(^|\s)#.*$/, "");
      return { n: i + 1, raw: raw, ind: noc.match(/^ */)[0].length, text: noc.trim() };
    }).filter(function (l) { return l.text !== "" && l.text !== "---"; });
    if (/\t/.test(text)) { var tl = String(text).split("\n").findIndex(function (l) { return /^\s*\t/.test(l); }); if (tl >= 0) throw new YamlError(tl + 1, 1, "Invalid YAML: tabs are not allowed for indent"); }
    var pos = 0;
    function scalar(v, line) {
      v = v.trim();
      if (/^".*"$/.test(v) || /^'.*'$/.test(v)) return v.slice(1, -1);
      if (/^\[.*\]$/.test(v)) { var inner = v.slice(1, -1).trim(); return inner === "" ? [] : inner.split(",").map(function (x) { return scalar(x, line); }); }
      if (/^\{.*\}$/.test(v)) { var o = {}; v.slice(1, -1).split(",").forEach(function (kv) { var m = /^\s*([^:]+):\s*(.*)$/.exec(kv); if (m) o[m[1].trim()] = scalar(m[2], line); }); return o; }
      if (/^\[/.test(v) && !/\]$/.test(v)) throw new YamlError(line.n, line.raw.indexOf("[") + 1, "Invalid YAML: did not find expected ',' or ']'");
      if (v === "true" || v === "yes") return true; if (v === "false" || v === "no") return false;
      if (/^-?\d+$/.test(v)) return +v;
      return v;
    }
    function block(ind) {
      if (pos >= L.length) return null;
      var first = L[pos];
      if (first.ind < ind) return null;
      ind = first.ind;
      if (/^- /.test(first.text) || first.text === "-") {
        var arr = []; arr.__lines = [];
        while (pos < L.length && L[pos].ind === ind && /^-( |$)/.test(L[pos].text)) {
          var ln = L[pos], rest = ln.text.replace(/^-\s*/, "");
          arr.__lines.push(ln.n);
          if (/^[\w.-]+:(\s|$)/.test(rest)) {
            // a map item: re-read this line as a key at the deeper indent
            L[pos] = { n: ln.n, raw: ln.raw, ind: ind + 2, text: rest };
            arr.push(block(ind + 2));
          } else { pos++; arr.push(rest === "" ? block(ind + 1) : scalar(rest, ln)); }
        }
        if (pos < L.length && L[pos].ind > ind) throw new YamlError(L[pos].n, L[pos].ind + 1, "Invalid YAML: inconsistent indentation");
        return arr;
      }
      var obj = {}; Object.defineProperty(obj, "__lines", { value: {}, enumerable: false });
      while (pos < L.length && L[pos].ind === ind) {
        var l2 = L[pos], m = /^("[^"]*"|'[^']*'|[^:]+?):(?:\s+(.*)|$)/.exec(l2.text);
        if (!m) throw new YamlError(l2.n, ind + 1, "Invalid YAML: could not find expected ':'");
        var key = m[1].replace(/^["']|["']$/g, "");
        obj.__lines[key] = { n: l2.n, col: ind + 1 };
        pos++;
        if (m[2] !== undefined && m[2] !== "") obj[key] = scalar(m[2], l2);
        else { var child = block(ind + 1); obj[key] = child === null ? null : child; }
      }
      if (pos < L.length && L[pos].ind > ind) throw new YamlError(L[pos].n, L[pos].ind + 1, "Invalid YAML: mapping values are not allowed in this context");
      return obj;
    }
    var res = block(0);
    if (pos < L.length) throw new YamlError(L[pos].n, L[pos].ind + 1, "Invalid YAML: inconsistent indentation");
    return res || {};
  }
  N.parseYaml = parseYaml;
  var NP_ETH_KEYS = ["addresses", "dhcp4", "dhcp6", "routes", "nameservers", "mtu", "accept-ra", "optional", "match", "set-name", "link-local", "gateway4", "gateway6", "wakeonlan", "macaddress", "critical", "renderer"];
  var NP_VLAN_KEYS = NP_ETH_KEYS.concat(["id", "link"]);
  function npFiles(sys) {
    var d = nodeAt(sys, "/etc/netplan");
    if (!d || d.type !== "d") return [];
    return Object.keys(d.children).filter(function (n) { return /\.yaml$/.test(n) && d.children[n].type === "f"; }).sort().map(function (n) { return { path: "/etc/netplan/" + n, node: d.children[n] }; });
  }
  // Parse and check every file. Returns {conf: {ethernets, vlans}, errors: [text], warnings: [text]}
  function npLoad(sys) {
    var conf = { ethernets: {}, vlans: {} }, errors = [], warnings = [];
    npFiles(sys).forEach(function (f) {
      if (f.node.mode & 63) warnings.push("** (generate:2214): WARNING **: 09:00:00.000: Permissions for " + f.path + " are too open. Netplan configuration should NOT be accessible by others.");
      var y;
      try { y = parseYaml(f.node.content); }
      catch (e) { if (e instanceof YamlError) { errors.push(f.path + ":" + e.line + ":" + e.col + ": " + e.message); return; } throw e; }
      function bad(obj, key, msg) { var at = obj && obj.__lines && obj.__lines[key] || { n: 1, col: 1 }; var raw = String(f.node.content).split("\n")[at.n - 1] || ""; errors.push(f.path + ":" + at.n + ":" + at.col + ": Error in network definition: " + msg + "\n" + raw + "\n" + new Array(at.col).join(" ") + "^"); }
      var net = y.network;
      if (!net || typeof net !== "object") { bad(y, Object.keys(y)[0], "unknown key '" + (Object.keys(y)[0] || "") + "'"); return; }
      Object.keys(net).forEach(function (k) { if (["version", "renderer", "ethernets", "vlans", "bridges", "bonds", "wifis"].indexOf(k) < 0) bad(net, k, "unknown key '" + k + "'"); });
      ["ethernets", "vlans"].forEach(function (sec) {
        var o = net[sec]; if (!o) return;
        Object.keys(o).forEach(function (ifn) {
          var c = o[ifn] || {};
          if (typeof c !== "object" || Array.isArray(c)) { bad(o, ifn, "expected mapping (check indentation)"); return; }
          Object.keys(c).forEach(function (k) { if ((sec === "vlans" ? NP_VLAN_KEYS : NP_ETH_KEYS).indexOf(k) < 0) bad(c, k, "unknown key '" + k + "'"); });
          var addrs = c.addresses || [];
          if (!Array.isArray(addrs)) addrs = [addrs];
          addrs.forEach(function (a) { var s = String(a); if (!/\//.test(s)) bad(c, "addresses", "address '" + s + "' is missing /prefixlength"); else if (!parseCidr(s) && !(isV6(s.split("/")[0]) && /\/\d+$/.test(s))) bad(c, "addresses", "malformed address '" + s + "', must be X.X.X.X/NN or X:X:X:X:X:X:X:X/NN"); });
          if (c.gateway4) warnings.push("\n** (generate:2214): WARNING **: 09:00:00.000: `gateway4` has been deprecated, use default routes instead.\nSee the 'Default routes' section of the documentation for more details.");
          (Array.isArray(c.routes) ? c.routes : []).forEach(function (r) { if (!r || typeof r !== "object" || !r.to) bad(c, "routes", "route requires 'to'"); else if (!r.via && r["on-link"] === undefined && r.scope !== "link") bad(c, "routes", "route requires 'via'"); });
          if (sec === "vlans" && (c.id === undefined || !c.link)) bad(c, Object.keys(c)[0] || "id", "missing 'id' or 'link' property");
          (sec === "ethernets" ? conf.ethernets : conf.vlans)[ifn] = Object.assign({ __file: f.path }, c);
        });
      });
    });
    return { conf: conf, errors: errors, warnings: warnings };
  }
  N.npLoad = npLoad;
  // Apply what netplan generated, like systemd-networkd does on `netplan apply` or at boot.
  function npApply(sys, conf) {
    var nw = sys.nw, journal = [];
    // interfaces netplan configured before but not now lose their addresses
    Object.keys(nw.managed).forEach(function (ifn) { if (!conf.ethernets[ifn] && !conf.vlans[ifn] && nw.ifs[ifn]) { nw.ifs[ifn].addrs = []; nw.ifs[ifn].addrs6 = []; if (nw.ifs[ifn].kind === "vlan") delete nw.ifs[ifn]; } });
    nw.routes = nw.routes.filter(function (r) { return !r.netplan; });
    nw.routes6 = nw.routes6.filter(function (r) { return !r.netplan; });
    nw.linkDns = {};
    nw.managed = {};
    var all = [];
    Object.keys(conf.ethernets).forEach(function (k) { all.push([k, conf.ethernets[k], false]); });
    Object.keys(conf.vlans).forEach(function (k) { all.push([k, conf.vlans[k], true]); });
    all.forEach(function (x) {
      var ifn = x[0], c = x[1], isVlan = x[2], d = nw.ifs[ifn];
      if (isVlan) {
        var parent = nw.ifs[c.link];
        if (!parent) { journal.push("systemd-networkd: " + ifn + ": netdev could not be created: parent " + c.link + " not found"); return; }
        if (!d || d.kind !== "vlan") { d = nw.ifs[ifn] = { name: ifn, idx: nw.nextIdx++, kind: "vlan", parent: c.link, vid: +c.id, mac: parent.mac, admin: true, mtu: 1500, addrs: [], addrs6: [], stats: { rxB: 0, rxP: 0, rxE: 0, rxD: 0, txB: 0, txP: 0, txE: 0, coll: 0, crc: 0 } }; }
        d.vid = +c.id; d.parent = c.link;
      }
      if (!d) { journal.push("systemd-networkd: " + ifn + ": no such interface (netplan config is ignored until it appears)"); return; }
      nw.managed[ifn] = true;
      d.admin = true;
      d.managed = true;
      if (c.mtu) d.mtu = +c.mtu;
      if (c["accept-ra"] !== undefined) d.acceptRa = c["accept-ra"] !== false;
      var a4 = [], a6 = [];
      (Array.isArray(c.addresses) ? c.addresses : c.addresses ? [c.addresses] : []).forEach(function (a) {
        var s = String(a), cc = parseCidr(s);
        if (cc) a4.push({ ip: cc.ip, prefix: cc.prefix, scope: "global" });
        else { var mm = /^(.+)\/(\d+)$/.exec(s); if (mm && isV6(mm[1])) a6.push({ ip: v6norm(mm[1]), prefix: +mm[2], scope: "global" }); }
      });
      if (c.dhcp4 === true) {
        var seg = segOf(nw, d), lease = seg && SEGS[seg].dhcp && SEGS[seg].dhcp[d.mac];
        if (lease) { a4.push({ ip: lease, prefix: 24, scope: "global", dhcp: true }); ev(sys, { k: "dhcp", dev: ifn, mac: d.mac, ip: lease, seg: seg, server: SEGS[seg].dhcpServer || "10.20.0.1", layer: 7 }); }
        else journal.push("systemd-networkd: " + ifn + ": DHCPv4 client: no lease (no DHCP server answered)");
      }
      d.addrs = a4; d.addrs6 = a6;
      var routes = (Array.isArray(c.routes) ? c.routes : []).slice();
      if (c.gateway4) routes.push({ to: "default", via: c.gateway4 });
      if (c.dhcp4 === true && d.addrs.some(function (a) { return a.dhcp; })) { var sg0 = SEGS[segOf(nw, d)] || {}; routes.push({ to: "default", via: sg0.dhcpRouter || "10.20.0.1", dhcp: true }); }
      routes.forEach(function (r) {
        var to = String(r.to), via = r.via ? String(r.via) : null;
        if (to === "default" || to === "0.0.0.0/0" || to === "::/0") {
          if (via && isV6(via)) { nw.routes6.push({ dst: "::", prefix: 0, via: v6norm(via), dev: ifn, proto: "static", metric: 1024, netplan: true }); return; }
          to = "0.0.0.0/0";
        }
        var cc2 = parseCidr(to);
        if (!cc2) { if (/:/.test(to)) { var m6 = /^(.+)\/(\d+)$/.exec(to); if (m6) nw.routes6.push({ dst: v6norm(m6[1]), prefix: +m6[2], via: via ? v6norm(via) : null, dev: ifn, proto: "static", metric: 1024, netplan: true }); } return; }
        var onlink = r["on-link"] === true || d.addrs.some(function (a) { return via && inNet(via, a.ip, a.prefix); });
        if (via && !onlink) { journal.push("systemd-networkd: " + ifn + ": Could not set route: Nexthop has invalid gateway. Network is unreachable"); return; }
        nw.routes.push({ dst: netOf(cc2.ip, cc2.prefix), prefix: cc2.prefix, via: via, dev: ifn, proto: r.dhcp ? "dhcp" : "static", metric: r.metric != null ? +r.metric : r.dhcp ? 100 : 0, mtu: r.mtu != null ? +r.mtu : undefined, netplan: true, src: r.dhcp ? (d.addrs[0] || {}).ip : undefined });
      });
      var ns = c.nameservers || {};
      if (ns.addresses || ns.search) nw.linkDns[ifn] = { servers: (ns.addresses || []).map(String), search: (ns.search || []).map(String) };
      if (c.dhcp4 === true && d.addrs.some(function (a) { return a.dhcp; }) && !ns.addresses) nw.linkDns[ifn] = { servers: [(SEGS[segOf(nw, d)] || {}).dhcpDns || "10.20.0.2"], search: ["kestrel.internal"] };
    });
    // the neighbour table forgets entries on links that changed
    Object.keys(nw.neigh).forEach(function (ip) { var n = nw.neigh[ip]; if (!n.perm && (!nw.ifs[n.dev] || !nw.ifs[n.dev].addrs.length)) delete nw.neigh[ip]; });
    journal.forEach(function (j) { var m = /^(\S+): (.*)$/.exec(j); jadd(sys, m[1], 588, m[2], "systemd-networkd.service", 3); });
    return journal;
  }
  N.npApply = npApply;
  N.npBoot = function (sys) { var l = npLoad(sys); if (l.errors.length) { jadd(sys, "systemd-networkd", 588, "netplan: " + l.errors[0].split("\n")[0], "systemd-networkd.service", 3); return; } npApply(sys, l.conf); };
  CMDS.netplan = function (args, io, sess) {
    var sys = sess.sys, sub = args[1] || "";
    if (!sub || sub === "--help" || sub === "help") { out(io, "usage: /usr/sbin/netplan  [-h] [--debug]  ...\n\nNetwork configuration in YAML\n\nAvailable commands:\n    help      Show this help message\n    apply     Apply current netplan config to running system\n    generate  Generate backend specific configuration files from /etc/netplan/*.yaml\n    get       Get a setting by specifying a nested key like \"ethernets.eth0.addresses\", or \"all\"\n    set       Add new setting by specifying a dotted key=value pair like ethernets.eth0.dhcp4=true\n    try       Try to apply a new netplan config to running system, with automatic rollback\n    status    Query networking state of the running system\n"); return 0; }
    if (["apply", "generate", "try", "get", "status"].indexOf(sub) < 0) { errl(io, "usage: /usr/sbin/netplan  [-h] [--debug]  ...\nnetplan: error: argument : invalid choice: '" + sub + "' (choose from 'help', 'apply', 'generate', 'get', 'info', 'ip', 'set', 'rebind', 'status', 'try')"); return 2; }
    if (sub === "status") return netplanStatus(args, io, sess);
    var unreadable = npFiles(sys).some(function (f) { return !S.can(sess, f.node, "r"); });
    if (unreadable) { errl(io, "PermissionError: [Errno 13] Permission denied: '" + npFiles(sys)[0].path + "'"); note(io, "(netplan reads files only root can read: run it with sudo.)"); return 1; }
    var l = npLoad(sys);
    l.warnings.forEach(function (w) { errl(io, w); });
    if (l.errors.length) { errl(io, l.errors[0]); return 1; }
    if (sub === "get") {
      var key = args[2] || "all", y = {};
      npFiles(sys).forEach(function (f) { try { var d = parseYaml(f.node.content); merge(y, d); } catch (e) { /* reported above */ } });
      var v = key === "all" ? y : key.split(".").reduce(function (o, k) { return o && o[k] !== undefined ? o[k] : (o && o.network && o.network[k] !== undefined ? o.network[k] : undefined); }, y);
      if (v === undefined || v === null) { out(io, "null\n"); return 0; }
      out(io, dumpYaml(v, 0));
      return 0;
    }
    if (sub === "generate") return 0;
    if (sess.uid !== 0) { errl(io, "PermissionError: [Errno 13] Permission denied: '/run/systemd/network'"); note(io, "(Applying network settings changes the whole server: run it with sudo.)"); return 1; }
    var before = JSON.stringify(sys.nw.ifs);
    var journal = npApply(sys, l.conf);
    if (sub === "try") {
      out(io, "Do you want to keep these settings?\n\n\nPress ENTER before the timeout to accept the new configuration\n\n\nChanges will revert in 120 seconds\nConfiguration accepted.\n");
      note(io, "(The lab pressed ENTER for you: you're on the server's console, so the new settings didn't cut you off. Over SSH, netplan try rolls back by itself if you lose the connection.)");
    }
    journal.forEach(function (j) { if (/invalid gateway/.test(j)) note(io, "(netplan applied the file, but systemd-networkd rejected a route: see journalctl -u systemd-networkd.)"); });
    ev(sys, { k: "link", changed: before !== JSON.stringify(sys.nw.ifs), what: "netplan " + sub });
    return 0;
  };
  function merge(a, b) { Object.keys(b || {}).forEach(function (k) { if (b[k] && typeof b[k] === "object" && !Array.isArray(b[k]) && a[k] && typeof a[k] === "object") merge(a[k], b[k]); else a[k] = b[k]; }); return a; }
  function dumpYaml(v, ind) {
    var sp = new Array(ind + 1).join(" ");
    if (Array.isArray(v)) return v.map(function (x) { return x && typeof x === "object" ? sp + "- " + dumpYaml(x, ind + 2).replace(/^\s+/, "") : sp + "- " + (typeof x === "string" && /:/.test(x) ? "\"" + x + "\"" : x) + "\n"; }).join("");
    if (v && typeof v === "object") return Object.keys(v).filter(function (k) { return k !== "__file"; }).map(function (k) { var x = v[k]; if (x && typeof x === "object") return sp + k + ":\n" + dumpYaml(x, ind + 2); return sp + k + ": " + (typeof x === "string" && /:/.test(x) ? "\"" + x + "\"" : x) + "\n"; }).join("");
    return sp + v + "\n";
  }
  function netplanStatus(args, io, sess) {
    var nw = sess.sys.nw, L = [];
    var dns = linkDnsServers(nw);
    L.push("     Online state: " + (lookup4(nw, "1.1.1.1") ? "online" : "offline"));
    L.push("    DNS Addresses: 127.0.0.53 (stub)");
    L.push("       DNS Search: kestrel.internal", "");
    ifList(nw).forEach(function (d) {
      var l = linkOf(nw, d);
      L.push("●  " + d.idx + ": " + d.name + " " + (d.kind === "loopback" ? "standard UP" : d.kind === "vlan" ? "vlan " + (l.carrier ? "UP" : "DOWN") : "ethernet " + (l.carrier ? "UP" : d.admin ? "DOWN (NO-CARRIER)" : "DOWN")) + (d.managed ? " (networkd: " + d.name + ")" : d.kind === "loopback" ? "" : " (unmanaged)"));
      if (d.kind !== "loopback") L.push("      MAC Address: " + d.mac);
      d.addrs.forEach(function (a, i) { L.push((i ? "                   " : "        Addresses: ") + a.ip + "/" + a.prefix + (a.dhcp ? " (dhcp)" : " (static)")); });
      routes4(nw).filter(function (r) { return r.dev === d.name && r.proto !== "kernel"; }).forEach(function (r, i) { L.push((i ? "                   " : "           Routes: ") + (r.prefix === 0 ? "default" : r.dst + "/" + r.prefix) + (r.via ? " via " + r.via : "") + " (" + r.proto + ")"); });
      L.push("");
    });
    if (dns.length) L.push("DNS servers from netplan: " + dns.join(", "));
    out(io, joinLines(L));
    return 0;
  }
  function linkDnsServers(nw) { var r = []; Object.keys(nw.linkDns).forEach(function (k) { var d = nw.ifs[k]; if (d && d.admin && linkOf(nw, d).carrier) nw.linkDns[k].servers.forEach(function (s) { if (r.indexOf(s) < 0) r.push(s); }); }); return r; }
  N.linkDnsServers = linkDnsServers;

  /* ================================================================== sysctl */
  function sysctlKeys(nw) {
    var keys = Object.keys(nw.sysctl);
    ifList(nw).forEach(function (d) { var k = "net.ipv6.conf." + d.name.replace(/\./g, "/") + ".disable_ipv6"; if (keys.indexOf(k) < 0) keys.push(k); });
    return keys.sort();
  }
  function sysctlGet(nw, k) {
    if (nw.sysctl[k] !== undefined) return nw.sysctl[k];
    var m = /^net\.ipv6\.conf\.(.+)\.disable_ipv6$/.exec(k);
    if (m && nw.ifs[m[1].replace(/\//g, ".")]) return nw.v6dis[m[1]] || nw.sysctl["net.ipv6.conf.default.disable_ipv6"];
    return undefined;
  }
  function sysctlSet(nw, k, v) {
    var m = /^net\.ipv6\.conf\.(.+)\.disable_ipv6$/.exec(k);
    if (m && m[1] === "all") { nw.sysctl[k] = v; ifList(nw).forEach(function (d) { if (d.kind !== "loopback") nw.sysctl["net.ipv6.conf." + d.name + ".disable_ipv6"] = v; }); return true; }
    if (m && m[1] !== "default" && !nw.ifs[m[1].replace(/\//g, ".")]) return false;
    if (nw.sysctl[k] === undefined && !m) return false;
    nw.sysctl[k] = v;
    return true;
  }
  function sysctlFile(sys, text, io, show) {
    var nw = sys.nw;
    lines(text || "").forEach(function (l) {
      l = l.replace(/[#;].*$/, "").trim(); if (!l) return;
      var m = /^-?\s*([\w./-]+)\s*=\s*(.*)$/.exec(l); if (!m) return;
      var k = m[1].replace(/\//g, "."), v = m[2].trim();
      if (!sysctlSet(nw, k, v)) { if (io) errl(io, "sysctl: cannot stat /proc/sys/" + k.replace(/\./g, "/") + ": No such file or directory"); return; }
      if (show && io) out(io, k + " = " + v + "\n");
    });
  }
  N.sysctlBoot = function (sys) {
    ["/etc/sysctl.conf"].concat(Object.keys((nodeAt(sys, "/etc/sysctl.d") || { children: {} }).children).sort().map(function (n) { return "/etc/sysctl.d/" + n; })).forEach(function (p) { var t = rd(sys, p); if (t !== null && /\.conf$/.test(p)) sysctlFile(sys, t, null, false); });
  };
  CMDS.sysctl = function (args, io, sess) {
    var sys = sess.sys, nw = sys.nw, a = args.slice(1), write = false, all = false, quiet = false, names = [], load = null, system = false, nameOnly = false, valOnly = false;
    for (var i = 0; i < a.length; i++) {
      var x = a[i];
      if (x === "-w" || x === "--write") write = true; else if (x === "-a" || x === "-A" || x === "-X" || x === "--all") all = true; else if (x === "-q" || x === "--quiet") quiet = true; else if (x === "-n" || x === "--values") valOnly = true; else if (x === "-N" || x === "--names") nameOnly = true;
      else if (x === "-p" || x === "--load") { load = a[i + 1] && !/^-/.test(a[i + 1]) ? a[++i] : "/etc/sysctl.conf"; } else if (/^--load=/.test(x)) load = x.slice(7); else if (x === "--system") system = true;
      else if (/^-/.test(x)) { errl(io, "sysctl: invalid option -- '" + x.replace(/^-+/, "").charAt(0) + "'\nTry `sysctl --help' for more information."); return 1; }
      else names.push(x);
    }
    function fmt(k, v) { return nameOnly ? k : valOnly ? v : k + " = " + v; }
    if (system || load) {
      if (sess.uid !== 0) { errl(io, "sysctl: permission denied on key \"" + (sysctlKeys(nw)[0]) + "\""); return 1; }
      var files = load ? [load] : Object.keys((nodeAt(sys, "/etc/sysctl.d") || { children: {} }).children).filter(function (n) { return /\.conf$/.test(n); }).sort().map(function (n) { return "/etc/sysctl.d/" + n; }).concat(["/etc/sysctl.conf"]);
      files.forEach(function (p) {
        var r = S.readFile(sess, p);
        if (r.error) { if (load) errl(io, "sysctl: cannot open \"" + p + "\": No such file or directory"); return; }
        if (system) out(io, "* Applying " + p + " ...\n");
        sysctlFile(sys, r.content, io, !quiet);
      });
      ev(sys, { k: "link", what: "sysctl" });
      return 0;
    }
    if (all || !names.length) {
      if (!all) { errl(io, "\nUsage:\n sysctl [options] [variable[=value] ...]\n\nOptions:\n  -a, --all            display all variables\n  -n, --values         print only values of the given variable(s)\n  -p, --load[=<file>]  read values from file\n  -w, --write          enable writing a value to variable\n      --system         read values from all system directories\n"); return 1; }
      out(io, joinLines(sysctlKeys(nw).map(function (k) { return fmt(k, sysctlGet(nw, k)); })));
      return 0;
    }
    var code = 0;
    names.forEach(function (nm) {
      var m = /^([^=]+)=(.*)$/.exec(nm);
      if (m) {
        var k = m[1].replace(/\//g, ".").trim(), v = m[2].trim();
        if (sess.uid !== 0) { errl(io, "sysctl: permission denied on key \"" + k + "\""); code = 1; return; }
        if (!sysctlSet(nw, k, v)) { errl(io, "sysctl: cannot stat /proc/sys/" + k.replace(/\./g, "/") + ": No such file or directory"); code = 1; return; }
        if (!quiet) out(io, k + " = " + v + "\n");
        ev(sys, { k: "link", what: "sysctl" });
        return;
      }
      if (write) { errl(io, "sysctl: \"" + nm + "\" must be of the form name=value"); code = 1; return; }
      var k2 = nm.replace(/\//g, "."), val = sysctlGet(nw, k2);
      if (val === undefined) { errl(io, "sysctl: cannot stat /proc/sys/" + k2.replace(/\./g, "/") + ": No such file or directory"); code = 255; return; }
      out(io, fmt(k2, val) + "\n");
    });
    return code;
  };

  /* ================================================================== ip */
  function flags(nw, d) {
    var l = linkOf(nw, d);
    if (d.kind === "loopback") return { f: "<LOOPBACK,UP,LOWER_UP>", state: "UNKNOWN" };
    if (!d.admin) return { f: "<BROADCAST,MULTICAST>", state: "DOWN" };
    if (d.kind === "vlan" && l.lowerDown) return { f: "<NO-CARRIER,BROADCAST,MULTICAST,UP,M-DOWN>", state: "LOWERLAYERDOWN" };
    if (!l.carrier) return { f: "<NO-CARRIER,BROADCAST,MULTICAST,UP>", state: "DOWN" };
    return { f: "<BROADCAST,MULTICAST,UP,LOWER_UP>", state: "UP" };
  }
  function dispName(d) { return d.kind === "vlan" ? d.name + "@" + d.parent : d.name; }
  function linkHead(nw, d, mode) {
    var fl = flags(nw, d);
    return d.idx + ": " + dispName(d) + ": " + fl.f + " mtu " + d.mtu + " qdisc " + (d.kind === "ether" ? "fq_codel" : "noqueue") + " state " + fl.state + (mode ? " mode DEFAULT" : "") + " group default qlen 1000";
  }
  function linkLine(d) { return d.kind === "loopback" ? "    link/loopback 00:00:00:00:00:00 brd 00:00:00:00:00:00" : "    link/ether " + d.mac + " brd ff:ff:ff:ff:ff:ff"; }
  function statsBlock(nw, d) {
    var s = errStats(nw, d);
    return "    RX:  bytes packets errors dropped  missed   mcast           \n" + pad(s.rxB, 14) + " " + pad(s.rxP, 7) + " " + pad(s.rxE, 6) + " " + pad(s.rxD, 7) + " " + pad(0, 7) + " " + pad(d.kind === "loopback" ? 0 : 1204, 7) + " \n" +
      "    TX:  bytes packets errors dropped carrier collsns           \n" + pad(s.txB, 14) + " " + pad(s.txP, 7) + " " + pad(s.txE, 6) + " " + pad(0, 7) + " " + pad(s.carrierErr || 0, 7) + " " + pad(s.coll, 7) + " ";
  }
  // Error counters grow while a link is mismatched (late collisions on the half-duplex side, CRC errors on the other)
  function errStats(nw, d) {
    var s = Object.assign({}, d.stats || {}), l = linkOf(nw, d);
    if (l.mismatch) { s.rxE += 18233; s.crc += 18233; s.coll += 9120; s.txE += 4110; }
    if (d.kind === "ether" && !l.carrier && d.cable === false) s.carrierErr = 3;
    return s;
  }
  N.errStats = errStats;
  function addrLines(nw, d, fam) {
    var L = [];
    if (fam !== 6) d.addrs.forEach(function (a) {
      var label = d.name;
      L.push("    inet " + a.ip + "/" + a.prefix + (a.dhcp ? " metric 100" : "") + (a.prefix < 31 && d.kind !== "loopback" ? " brd " + bcastOf(a.ip, a.prefix) : "") + " scope " + (a.scope || "global") + (a.dhcp ? " dynamic" : "") + " " + label);
      L.push("       valid_lft " + (a.dhcp ? "85633sec preferred_lft 85633sec" : "forever preferred_lft forever"));
    });
    if (fam !== 4) {
      var a6 = addrs6(nw, d);
      a6.filter(function (a) { return a.scope !== "link"; }).concat(a6.filter(function (a) { return a.scope === "link"; })).forEach(function (a) {
        L.push("    inet6 " + a.ip + "/" + a.prefix + " scope " + a.scope + (a.slaac ? " dynamic mngtmpaddr noprefixroute" : a.scope === "host" ? " noprefixroute" : "") + " ");
        L.push("       valid_lft " + (a.slaac ? "86394sec preferred_lft 14394sec" : "forever preferred_lft forever"));
      });
    }
    return L;
  }
  function needRoot(io, sess) { if (sess.uid === 0) return false; errl(io, "RTNETLINK answers: Operation not permitted"); return true; }
  function macOk(m) { return /^([0-9a-f]{2}:){5}[0-9a-f]{2}$/i.test(m); }
  CMDS.ip = function (args, io, sess) {
    var sys = sess.sys, nw = sys.nw, a = args.slice(1), brief = false, fam = null, stats = 0, detail = false;
    while (a.length && /^-/.test(a[0])) {
      var f = a.shift();
      if (/^-br(ief)?$|^--brief$/.test(f)) brief = true; else if (f === "-4") fam = 4; else if (f === "-6") fam = 6; else if (f === "-s" || f === "-stats" || f === "-statistics") stats++; else if (f === "-ss") stats += 2; else if (f === "-d" || f === "-details") detail = true;
      else if (/^-c(olor)?(=\w+)?$|^--color/.test(f) || f === "-j" || f === "-json" || f === "-p" || f === "-o" || f === "-oneline") continue;
      else if (f === "-h" || f === "-help") { a = ["help"]; break; }
      else { errl(io, "Option \"" + f + "\" is unknown, try \"ip -help\"."); return 255; }
    }
    var obj = a.shift() || "";
    function is(full, min) { return obj.length >= (min || 1) && full.indexOf(obj) === 0; }
    if (!obj || obj === "help") { out(io, "Usage: ip [ OPTIONS ] OBJECT { COMMAND | help }\n       ip [ -force ] -batch filename\nwhere  OBJECT := { address | link | neighbour | route | rule | ... }\n       OPTIONS := { -V[ersion] | -s[tatistics] | -d[etails] | -4 | -6 | -br[ief] | -c[olor] | ... }\n"); return obj ? 0 : 255; }
    var cmd = a[0] && !/^dev$/.test(a[0]) && !nw.ifs[a[0]] ? a.shift() : "show";
    function arg(name) { var k = a.indexOf(name); return k >= 0 ? a[k + 1] : undefined; }
    function devArg() { var d = arg("dev"); if (d) return d; var plain = a.filter(function (x, i) { return !/^(dev|to|via|lladdr|nud|label|scope|metric|proto|src|type|id|link|name|mtu|address)$/.test(x) && !/^(dev|via|lladdr|nud|label|scope|metric|proto|src|type|id|link|name|mtu|address)$/.test(a[i - 1] || ""); }); return plain[0]; }
    function noDev(dn) { errl(io, "Device \"" + dn + "\" does not exist."); return 1; }
    // ---- address
    if (is("address", 1) || obj === "addr") {
      if (cmd === "show" || cmd === "list" || cmd === "ls" || cmd === "s" || cmd === "sh") {
        var dn = devArg(), list = ifList(nw);
        if (dn) { if (!nw.ifs[dn]) return noDev(dn); list = [nw.ifs[dn]]; }
        if (brief) {
          out(io, joinLines(list.map(function (d) {
            var ad = (fam === 6 ? [] : d.addrs.map(function (x) { return x.ip + "/" + x.prefix; })).concat(fam === 4 ? [] : addrs6(nw, d).filter(function (x) { return x.scope !== "link"; }).concat(addrs6(nw, d).filter(function (x) { return x.scope === "link"; })).map(function (x) { return x.ip + "/" + x.prefix; }));
            return rpad(dispName(d), 16) + " " + rpad(flags(nw, d).state, 14) + " " + ad.join(" ") + " ";
          })));
          ev(sys, { k: "look", what: "addr" });
          return 0;
        }
        var L = [];
        list.forEach(function (d) {
          var al = addrLines(nw, d, fam);
          if (fam && !al.length) return;
          L.push(linkHead(nw, d, false));
          if (!fam) { L.push(linkLine(d)); if (d.altname) L.push("    altname " + d.altname); }
          if (fam === 6 && d.kind !== "loopback") { /* -6 hides link lines */ }
          L = L.concat(al);
        });
        out(io, joinLines(L));
        ev(sys, { k: "look", what: "addr" });
        return 0;
      }
      if (cmd === "add" || cmd === "del" || cmd === "delete" || cmd === "replace" || cmd === "change") {
        var spec = a[0], dn2 = arg("dev");
        if (!spec || !dn2) { errl(io, "Not enough information: \"dev\" argument is required."); return 1; }
        if (needRoot(io, sess)) return 2;
        var d2 = nw.ifs[dn2]; if (!d2) { errl(io, "Cannot find device \"" + dn2 + "\""); return 1; }
        var mm = /^(.+?)(?:\/(\d+))?$/.exec(spec), v6 = isV6(mm[1]);
        if (!v6 && !isV4(mm[1])) { errl(io, "Error: any valid prefix is expected rather than \"" + spec + "\"."); return 1; }
        var pfx = mm[2] !== undefined ? +mm[2] : v6 ? 128 : 32;
        var arr = v6 ? d2.addrs6 : d2.addrs, ipn = v6 ? v6norm(mm[1]) : mm[1];
        var have = arr.filter(function (x) { return x.ip === ipn && x.prefix === pfx; })[0];
        if (cmd === "add") { if (have) { errl(io, "RTNETLINK answers: File exists"); return 2; } arr.push({ ip: ipn, prefix: pfx, scope: "global", manual: true }); }
        else if (cmd === "replace" || cmd === "change") { arr.splice.apply(arr, [0, 0]); if (!have) arr.push({ ip: ipn, prefix: pfx, scope: "global", manual: true }); }
        else { var k = arr.findIndex(function (x) { return x.ip === ipn && (mm[2] === undefined || x.prefix === pfx); }); if (k < 0) { errl(io, "RTNETLINK answers: Cannot assign requested address"); return 2; } arr.splice(k, 1); }
        ev(sys, { k: "link", what: "ip address " + cmd, dev: dn2 });
        return 0;
      }
      if (cmd === "flush") { var dn3 = devArg(); if (!dn3) { errl(io, "Flush requires arguments."); return 1; } if (needRoot(io, sess)) return 2; if (!nw.ifs[dn3]) return noDev(dn3); if (fam !== 6) nw.ifs[dn3].addrs = []; if (fam !== 4) nw.ifs[dn3].addrs6 = []; ev(sys, { k: "link", what: "ip address flush", dev: dn3 }); return 0; }
      errl(io, "Command \"" + cmd + "\" is unknown, try \"ip address help\"."); return 255;
    }
    // ---- link
    if (is("link", 1)) {
      if (cmd === "show" || cmd === "list" || cmd === "ls") {
        var dl = devArg(), ll = ifList(nw);
        if (dl) { if (!nw.ifs[dl]) return noDev(dl); ll = [nw.ifs[dl]]; }
        if (brief) { out(io, joinLines(ll.map(function (d) { return rpad(dispName(d), 16) + " " + rpad(flags(nw, d).state, 14) + " " + d.mac + " " + flags(nw, d).f + " "; }))); ev(sys, { k: "look", what: "link" }); return 0; }
        var L2 = [];
        ll.forEach(function (d) {
          L2.push(linkHead(nw, d, true)); L2.push(linkLine(d));
          if (detail && d.kind === "vlan") L2.push("    vlan protocol 802.1Q id " + d.vid + " <REORDER_HDR> ");
          if (stats) L2.push(statsBlock(nw, d));
          if (d.altname) L2.push("    altname " + d.altname);
        });
        out(io, joinLines(L2));
        ev(sys, { k: "look", what: "link" });
        return 0;
      }
      if (cmd === "set") {
        var dn4 = a[0] === "dev" ? a[1] : a[0];
        if (!dn4) { errl(io, "Not enough information: \"dev\" argument is required."); return 1; }
        if (needRoot(io, sess)) return 2;
        var d4 = nw.ifs[dn4]; if (!d4) { errl(io, "Cannot find device \"" + dn4 + "\""); return 1; }
        if (a.indexOf("up") >= 0) d4.admin = true;
        if (a.indexOf("down") >= 0) d4.admin = false;
        if (arg("mtu")) { var mtu = +arg("mtu"); if (!(mtu >= 68 && mtu <= 9000)) { errl(io, "Error: mtu less than device minimum."); return 2; } d4.mtu = mtu; }
        if (arg("address")) { if (!macOk(arg("address"))) { errl(io, "Error: \"" + arg("address") + "\" is not a valid MAC address."); return 1; } d4.mac = arg("address").toLowerCase(); }
        ev(sys, { k: "link", what: "ip link set " + dn4 + (a.indexOf("down") >= 0 ? " down" : a.indexOf("up") >= 0 ? " up" : ""), dev: dn4 });
        return 0;
      }
      if (cmd === "add") {
        var name = arg("name"), parent = arg("link"), type = arg("type"), vid = arg("id");
        if (!name && a[0] && a[0] !== "link") name = a[0];
        if (!type) { errl(io, "Not enough information: \"type\" argument is required"); return 1; }
        if (type !== "vlan") { errl(io, "(The lab only simulates VLAN links: ip link add link eth0 name eth0.30 type vlan id 30)"); return 2; }
        if (!parent) { errl(io, "Error: link is required."); return 1; }
        if (vid === undefined || !/^\d+$/.test(vid) || +vid < 1 || +vid > 4094) { errl(io, "vlan: id is required. (1-4094)"); return 1; }
        if (needRoot(io, sess)) return 2;
        if (!nw.ifs[parent]) { errl(io, "Cannot find device \"" + parent + "\""); return 1; }
        if (!name) name = parent + "." + vid;
        if (nw.ifs[name]) { errl(io, "RTNETLINK answers: File exists"); return 2; }
        var pd = nw.ifs[parent];
        nw.ifs[name] = { name: name, idx: nw.nextIdx++, kind: "vlan", parent: parent, vid: +vid, mac: pd.mac, admin: false, mtu: pd.mtu, addrs: [], addrs6: [], stats: { rxB: 0, rxP: 0, rxE: 0, rxD: 0, txB: 0, txP: 0, txE: 0, coll: 0, crc: 0 } };
        ev(sys, { k: "link", what: "ip link add " + name, dev: name });
        return 0;
      }
      if (cmd === "del" || cmd === "delete") {
        var dn5 = a[0] === "dev" ? a[1] : a[0];
        if (needRoot(io, sess)) return 2;
        if (!nw.ifs[dn5]) { errl(io, "Cannot find device \"" + dn5 + "\""); return 1; }
        if (nw.ifs[dn5].kind !== "vlan") { errl(io, "RTNETLINK answers: Operation not supported"); return 2; }
        delete nw.ifs[dn5];
        nw.routes = nw.routes.filter(function (r) { return r.dev !== dn5; });
        ev(sys, { k: "link", what: "ip link del " + dn5 });
        return 0;
      }
      errl(io, "Command \"" + cmd + "\" is unknown, try \"ip link help\"."); return 255;
    }
    // ---- route
    if (is("route", 1)) {
      if (cmd === "get") {
        var to = a[0] === "to" ? a[1] : a[0];
        if (!to) { errl(io, "need at least a destination address"); return 1; }
        if (fam === 6 || isV6(to)) {
          var r6 = lookup6(nw, to);
          if (!r6) { errl(io, "RTNETLINK answers: Network is unreachable"); return 2; }
          out(io, v6norm(to) + " from :: " + (r6.via ? "via " + r6.via + " " : "") + "dev " + r6.dev + " proto " + r6.proto + " src " + ((own6(nw).filter(function (x) { return x.scope === "global"; })[0] || {}).ip || "::") + " metric " + r6.metric + " pref medium\n");
          return 0;
        }
        if (!isV4(to)) { var rr = M2.NET.resolveQuiet ? M2.NET.resolveQuiet(sys, to) : null; if (!rr) { errl(io, "Error: any valid prefix is expected rather than \"" + to + "\"."); return 1; } to = rr; }
        if (isOwn(nw, to)) { out(io, "local " + to + " dev lo table local src " + to + " uid " + sess.uid + " \n    cache <local> \n"); return 0; }
        var r = lookup4(nw, to);
        if (!r) { errl(io, "RTNETLINK answers: Network is unreachable"); ev(sys, { k: "route", to: to, ok: false }); return 2; }
        out(io, to + " " + (r.via ? "via " + r.via + " " : "") + "dev " + r.dev + " src " + r.src + " uid " + sess.uid + " \n    cache \n");
        ev(sys, { k: "route", to: to, ok: true, via: r.via, dev: r.dev });
        return 0;
      }
      if (cmd === "show" || cmd === "list" || cmd === "ls") {
        if (fam === 6) {
          out(io, joinLines(routes6(nw).sort(function (x, y) { return (x.prefix === 0) - (y.prefix === 0) || (x.dst < y.dst ? -1 : 1); }).map(function (r) {
            return (r.prefix === 0 ? "default" : r.dst + "/" + r.prefix) + (r.via ? " via " + r.via : "") + " dev " + r.dev + " proto " + r.proto + " metric " + r.metric + (r.ra ? " expires 86377sec" : r.proto === "ra" && r.prefix === 0 ? " expires 1777sec" : "") + " pref medium";
          })));
          ev(sys, { k: "look", what: "route" });
          return 0;
        }
        var rs = routes4(nw).slice().sort(function (x, y) { return (y.prefix === 0) - (x.prefix === 0) || ip2n(x.dst) - ip2n(y.dst) || y.prefix - x.prefix; });
        out(io, joinLines(rs.map(function (r) {
          return (r.prefix === 0 ? "default" : r.dst + "/" + r.prefix) + (r.via ? " via " + r.via : "") + " dev " + r.dev + " proto " + r.proto + (r.proto === "kernel" ? " scope link" : "") + (r.src && (r.proto !== "static") ? " src " + r.src : "") + (r.metric ? " metric " + r.metric : "") + (r.mtu ? " mtu " + r.mtu : "") + (r.linkdown ? " linkdown" : "") + " ";
        })));
        ev(sys, { k: "look", what: "route" });
        return 0;
      }
      if (cmd === "add" || cmd === "del" || cmd === "delete" || cmd === "replace" || cmd === "change") {
        var dst = a[0] === "to" ? a[1] : a[0], via = arg("via"), dev = arg("dev"), metric = arg("metric");
        if (!dst) { errl(io, "Error: any valid prefix is expected."); return 1; }
        if (needRoot(io, sess)) return 2;
        var six = fam === 6 || isV6(dst.split("/")[0]) || (via && isV6(via));
        if (six) {
          var d6 = dst === "default" ? { ip: "::", prefix: 0 } : (function () { var m6 = /^(.+)\/(\d+)$/.exec(dst); return m6 && isV6(m6[1]) ? { ip: v6norm(m6[1]), prefix: +m6[2] } : null; })();
          if (!d6) { errl(io, "Error: inet6 prefix is expected rather than \"" + dst + "\"."); return 1; }
          if (cmd === "add") nw.routes6.push({ dst: d6.ip, prefix: d6.prefix, via: via ? v6norm(via) : null, dev: dev || "eth0", proto: "static", metric: 1024, manual: true });
          else nw.routes6 = nw.routes6.filter(function (r) { return !(r.dst === d6.ip && r.prefix === d6.prefix); });
          ev(sys, { k: "link", what: "ip -6 route " + cmd });
          return 0;
        }
        var c = dst === "default" ? { ip: "0.0.0.0", prefix: 0 } : parseCidr(dst);
        if (!c) { errl(io, "Error: any valid prefix is expected rather than \"" + dst + "\"."); return 1; }
        var net = netOf(c.ip, c.prefix);
        if (net !== c.ip && cmd !== "del" && cmd !== "delete") { errl(io, "Error: Invalid prefix for given prefix length."); return 2; }
        if (cmd === "del" || cmd === "delete") {
          var k2 = nw.routes.findIndex(function (r) { return r.dst === net && r.prefix === c.prefix && (!via || r.via === via); });
          if (k2 < 0) { errl(io, "RTNETLINK answers: No such process"); return 2; }
          nw.routes.splice(k2, 1);
          ev(sys, { k: "link", what: "ip route del " + dst });
          return 0;
        }
        if (via && !isV4(via)) { errl(io, "Error: inet address is expected rather than \"" + via + "\"."); return 1; }
        // the gateway must be on a directly connected network
        var on = via ? routes4(nw).filter(function (r) { return r.proto === "kernel" && inNet(via, r.dst, r.prefix) && (!dev || r.dev === dev); })[0] : null;
        if (via && !on) { errl(io, "Error: Nexthop has invalid gateway."); return 2; }
        if (!via && !dev) { errl(io, "Error: Device for nexthop is not up."); return 2; }
        if (dev && !nw.ifs[dev]) { errl(io, "Cannot find device \"" + dev + "\""); return 1; }
        var exist = nw.routes.findIndex(function (r) { return r.dst === net && r.prefix === c.prefix && (r.metric || 0) === (+metric || 0); });
        if (exist >= 0 && cmd === "add") { errl(io, "RTNETLINK answers: File exists"); return 2; }
        if (exist >= 0) nw.routes.splice(exist, 1);
        nw.routes.push({ dst: net, prefix: c.prefix, via: via || null, dev: dev || on.dev, proto: "static", metric: metric ? +metric : 0, manual: true, mtu: arg("mtu") ? +arg("mtu") : undefined });
        ev(sys, { k: "link", what: "ip route " + cmd + " " + dst });
        return 0;
      }
      if (cmd === "flush") { if (needRoot(io, sess)) return 2; nw.routes = []; return 0; }
      errl(io, "Command \"" + cmd + "\" is unknown, try \"ip route help\"."); return 255;
    }
    // ---- neighbour
    if (is("neighbour", 1) || obj === "neighbor" || obj === "neigh") {
      if (cmd === "show" || cmd === "list" || cmd === "ls") {
        if (fam === 6) { var L6 = []; ifList(nw).forEach(function (d) { if (addrs6(nw, d).length && d.kind === "ether" && segOf(nw, d)) L6.push("fe80::1 dev " + d.name + " lladdr " + MAC.gw + " router STALE "); }); out(io, joinLines(L6)); return 0; }
        var only = a.filter(function (x) { return isV4(x); })[0], onlyDev = arg("dev");
        var rows = Object.keys(nw.neigh).filter(function (ip) { return (!only || ip === only) && (!onlyDev || nw.neigh[ip].dev === onlyDev); }).sort(function (x, y) { return ip2n(x) - ip2n(y); }).map(function (ip) {
          var n = nw.neigh[ip];
          return ip + " dev " + n.dev + (n.mac ? " lladdr " + n.mac : "") + (n.router ? " router" : "") + " " + (n.perm ? "PERMANENT" : n.state) + " ";
        });
        out(io, joinLines(rows));
        ev(sys, { k: "look", what: "neigh" });
        return 0;
      }
      if (cmd === "flush") { if (needRoot(io, sess)) return 2; Object.keys(nw.neigh).forEach(function (ip) { if (!nw.neigh[ip].perm) delete nw.neigh[ip]; }); return 0; }
      if (cmd === "add" || cmd === "replace" || cmd === "change" || cmd === "del" || cmd === "delete") {
        var nip = a[0] === "to" ? a[1] : a[0], lladdr = arg("lladdr"), ndev = arg("dev"), nud = arg("nud");
        if (!nip || !isV4(nip)) { errl(io, "Error: an inet address is expected rather than \"" + nip + "\"."); return 1; }
        if (!ndev) { errl(io, "Device and destination are required arguments."); return 1; }
        if (needRoot(io, sess)) return 2;
        if (!nw.ifs[ndev]) { errl(io, "Cannot find device \"" + ndev + "\""); return 1; }
        if (cmd === "del" || cmd === "delete") { if (!nw.neigh[nip]) { errl(io, "RTNETLINK answers: No such file or directory"); return 2; } delete nw.neigh[nip]; ev(sys, { k: "link", what: "ip neigh del" }); return 0; }
        if (!lladdr || !macOk(lladdr)) { errl(io, "\"" + (lladdr || "") + "\" is invalid lladdr."); return 1; }
        if (cmd === "add" && nw.neigh[nip] && nw.neigh[nip].perm) { errl(io, "RTNETLINK answers: File exists"); return 2; }
        nw.neigh[nip] = { mac: lladdr.toLowerCase(), dev: ndev, state: (nud || "permanent").toUpperCase(), perm: !nud || /^perm/i.test(nud) };
        ev(sys, { k: "link", what: "ip neigh " + cmd + " " + nip });
        return 0;
      }
      errl(io, "Command \"" + cmd + "\" is unknown, try \"ip neigh help\"."); return 255;
    }
    errl(io, "Object \"" + obj + "\" is unknown, try \"ip help\".");
    return 255;
  };
  CMDS.hostname = (function (orig) {
    return function (args, io, sess) {
      if (args[1] === "-I" || args[1] === "--all-ip-addresses") { var nw = sess.sys.nw; out(io, own4(nw).filter(function (x) { return !/^127\./.test(x.ip); }).map(function (x) { return x.ip; }).concat(own6(nw).filter(function (x) { return x.scope === "global"; }).map(function (x) { return x.ip; })).join(" ") + " \n"); return 0; }
      return orig(args, io, sess);
    };
  })(CMDS.hostname);
  CMDS.ifconfig = function (args, io, sess) {
    var nw = sess.sys.nw, L = [];
    ifList(nw).forEach(function (d) {
      var l = linkOf(nw, d), s = errStats(nw, d);
      if (!d.admin && args.indexOf("-a") < 0) return;
      var fl = d.kind === "loopback" ? "73<UP,LOOPBACK,RUNNING>" : !d.admin ? "4098<BROADCAST,MULTICAST>" : l.carrier ? "4163<UP,BROADCAST,RUNNING,MULTICAST>" : "4099<UP,BROADCAST,MULTICAST>";
      L.push(d.name + ": flags=" + fl + "  mtu " + d.mtu);
      d.addrs.forEach(function (a) { L.push("        inet " + a.ip + "  netmask " + n2ip(maskN(a.prefix)) + (d.kind !== "loopback" ? "  broadcast " + bcastOf(a.ip, a.prefix) : "")); });
      addrs6(nw, d).forEach(function (a) { L.push("        inet6 " + a.ip + "  prefixlen " + a.prefix + "  scopeid 0x" + (a.scope === "link" ? "20<link>" : a.scope === "host" ? "10<host>" : "0<global>")); });
      L.push(d.kind === "loopback" ? "        loop  txqueuelen 1000  (Local Loopback)" : "        ether " + d.mac + "  txqueuelen 1000  (Ethernet)");
      L.push("        RX packets " + s.rxP + "  bytes " + s.rxB, "        RX errors " + s.rxE + "  dropped " + s.rxD + "  overruns 0  frame " + s.crc, "        TX packets " + s.txP + "  bytes " + s.txB, "        TX errors " + s.txE + "  dropped 0 overruns 0  carrier " + (s.carrierErr || 0) + "  collisions " + s.coll, "");
    });
    out(io, joinLines(L));
    return 0;
  };

  /* ================================================================== ethtool */
  CMDS.ethtool = function (args, io, sess) {
    var nw = sess.sys.nw, a = args.slice(1);
    if (!a.length) { errl(io, "ethtool: bad command line argument(s)\nFor more information run ethtool -h"); return 1; }
    if (a[0] === "-h" || a[0] === "--help") { out(io, "ethtool version 6.7\nUsage:\n        ethtool [ FLAGS ] DEVNAME\tDisplay standard information about device\n        ethtool [ FLAGS ] -s|--change DEVNAME\tChange generic options\n\t\t[ speed %d ]\n\t\t[ duplex half|full ]\n\t\t[ autoneg on|off ]\n        ethtool [ FLAGS ] -S|--statistics DEVNAME\tShow adapter statistics\n        ethtool [ FLAGS ] -i|--driver DEVNAME\tShow driver information\n"); return 0; }
    var opt = /^-/.test(a[0]) ? a.shift() : null, dn = a.shift();
    var d = nw.ifs[dn];
    if (!d) { errl(io, "netlink error: no device matches name (offset 24)\nnetlink error: No such device"); return 1; }
    if (opt === "-i" || opt === "--driver") { out(io, d.kind === "ether" ? "driver: virtio_net\nversion: 1.0.0\nfirmware-version: \nexpansion-rom-version: \nbus-info: 0000:00:0" + (d.name === "eth1" ? 4 : 3) + ".0\nsupports-statistics: yes\nsupports-test: no\nsupports-eeprom-access: no\nsupports-register-dump: no\nsupports-priv-flags: no\n" : "driver: " + (d.kind === "vlan" ? "802.1Q VLAN Support" : "loopback") + "\n"); return 0; }
    if (opt === "-S" || opt === "--statistics") {
      var s = errStats(nw, d);
      out(io, "NIC statistics:\n     rx_packets: " + s.rxP + "\n     tx_packets: " + s.txP + "\n     rx_bytes: " + s.rxB + "\n     tx_bytes: " + s.txB + "\n     rx_crc_errors: " + s.crc + "\n     rx_errors: " + s.rxE + "\n     tx_late_collisions: " + Math.round(s.coll / 2) + "\n     tx_collisions: " + s.coll + "\n     tx_errors: " + s.txE + "\n");
      return 0;
    }
    if (opt === "-s" || opt === "--change") {
      if (sess.uid !== 0) { errl(io, "netlink error: Operation not permitted"); return 75; }
      if (d.kind !== "ether") { errl(io, "netlink error: Operation not supported"); return 75; }
      for (var i = 0; i < a.length; i += 2) {
        var k = a[i], v = a[i + 1];
        if (k === "speed") { if (!/^(10|100|1000)$/.test(v || "")) { errl(io, "ethtool: bad command line argument(s)\nFor more information run ethtool -h"); return 1; } d.speed = +v; }
        else if (k === "duplex") { if (v !== "half" && v !== "full") { errl(io, "ethtool: bad command line argument(s)"); return 1; } d.duplex = v; }
        else if (k === "autoneg") { if (v !== "on" && v !== "off") { errl(io, "ethtool: bad command line argument(s)"); return 1; } d.autoneg = v === "on"; if (d.autoneg) { d.speed = d.maxSpeed; d.duplex = "full"; } }
        else if (k === "wol" || k === "msglvl" || k === "port" || k === "advertise") continue;
        else { errl(io, "ethtool: bad command line argument(s)\nFor more information run ethtool -h"); return 1; }
      }
      if ((a.indexOf("speed") >= 0 || a.indexOf("duplex") >= 0) && a.indexOf("autoneg") < 0) d.autoneg = false;
      ev(sess.sys, { k: "link", what: "ethtool -s " + dn, dev: dn });
      return 0;
    }
    if (opt && opt !== "--") { errl(io, "ethtool: bad command line argument(s)\nFor more information run ethtool -h"); return 1; }
    if (d.kind === "loopback") { out(io, "Settings for lo:\n\tLink detected: yes\n"); return 0; }
    if (d.kind === "vlan") { out(io, "Settings for " + d.name + ":\n\tLink detected: " + (linkOf(nw, d).carrier ? "yes" : "no") + "\n"); return 0; }
    var l = linkOf(nw, d);
    var modes = "10baseT/Half 10baseT/Full\n\t                        100baseT/Half 100baseT/Full\n\t                        1000baseT/Full";
    var L = ["Settings for " + dn + ":", "\tSupported ports: [ TP ]", "\tSupported link modes:   " + modes, "\tSupported pause frame use: No", "\tSupports auto-negotiation: Yes", "\tSupported FEC modes: Not reported",
      "\tAdvertised link modes:  " + (d.autoneg ? modes : "Not reported"), "\tAdvertised pause frame use: No", "\tAdvertised auto-negotiation: " + (d.autoneg ? "Yes" : "No"), "\tAdvertised FEC modes: Not reported"];
    if (l.carrier) { L.push("\tSpeed: " + l.speed + "Mb/s", "\tDuplex: " + (l.duplex === "full" ? "Full" : "Half")); }
    else { L.push("\tSpeed: Unknown!", "\tDuplex: Unknown! (255)"); }
    L.push("\tAuto-negotiation: " + (d.autoneg ? "on" : "off"), "\tPort: Twisted Pair", "\tPHYAD: 0", "\tTransceiver: internal", "\tMDI-X: off (auto)");
    if (sess.uid === 0) L.push("\tSupports Wake-on: d", "\tWake-on: d", "\tCurrent message level: 0x00000007 (7)", "\t\t\t       drv probe link");
    L.push("\tLink detected: " + (l.carrier ? "yes" : "no"));
    out(io, joinLines(L));
    if (sess.uid !== 0) errl(io, "netlink error: Operation not permitted");
    ev(sess.sys, { k: "look", what: "ethtool", dev: dn, layer: 1 });
    return 0;
  };

  /* ================================================================== ping */
  function fmtMs(t) { return t < 1 ? t.toFixed(3) : t < 10 ? t.toFixed(2) : t.toFixed(1); }
  function lost(seed, loss) { return loss > 0 && (hash(seed) % 1000) / 1000 < loss; }
  N.fmtMs = fmtMs;
  CMDS.ping = function (args, io, sess) {
    var sys = sess.sys, nw = sys.nw, a = args.slice(1), count = null, quiet = false, target = null, size = 56, six = args[0] === "ping6", four = false, mdo = false, iface = null, ttlOpt = null;
    for (var i = 0; i < a.length; i++) {
      var x = a[i];
      if (x === "-c") count = +a[++i]; else if (/^-c\d+$/.test(x)) count = +x.slice(2); else if (x === "-q") quiet = true; else if (x === "-6") six = true; else if (x === "-4") four = true;
      else if (x === "-s") size = +a[++i]; else if (x === "-M") mdo = a[++i] === "do"; else if (x === "-I") iface = a[++i]; else if (x === "-t") ttlOpt = +a[++i];
      else if (x === "-i" || x === "-W" || x === "-w") i++; else if (x === "-n" || x === "-D" || x === "-O") continue;
      else if (/^-/.test(x)) { errl(io, "ping: invalid option -- '" + x.replace(/^-+/, "").charAt(0) + "'"); return 2; }
      else target = x;
    }
    if (!target) { errl(io, "ping: usage error: Destination address required"); return 1; }
    var res = M2.NET.resolveForPing ? M2.NET.resolveForPing(sys, target, six, four) : { ip: target };
    if (res.err) { errl(io, "ping: " + target + ": " + res.err); ev(sys, { k: "dns", name: target, ok: false }); return 2; }
    var ip = res.ip, v6 = isV6(ip);
    if (v6 && isLinkLocal6(ip) && !/%/.test(target) && !iface) { errl(io, "ping: Warning: IPv6 link-local address on ICMP datagram socket may require ifname or scope-id => use: address%<ifname|scope-id>"); errl(io, "ping: connect: Invalid argument"); ev(sys, { k: "ping", to: ip, ok: false, path: ["you"], fail: "you" }); return 2; }
    var dstSpec = v6 && /%/.test(target) ? target : v6 && iface ? ip + "%" + iface : ip;
    var r = reach(sys, dstSpec);
    var shownName = res.name || target, n = count || 4;
    if (r.err === "netunreach" || r.err === "badzone") { errl(io, "ping: connect: Network is unreachable"); ev(sys, { k: "ping", to: ip, ok: false, path: r.path, fail: r.fail, err: r.err }); return 2; }
    var mtu = (nw.ifs[r.dev || "eth0"] || { mtu: 1500 }).mtu;
    if (mdo && size + 28 > mtu && !r.self) { out(io, "PING " + target + " (" + ip + ") " + size + "(" + (size + 28) + ") bytes of data.\n"); errl(io, "ping: local error: message too long, mtu=" + mtu); return 1; }
    if (v6) out(io, "PING " + target + " (" + (/%/.test(dstSpec) ? dstSpec : ip) + ") " + size + " data bytes\n");
    else out(io, "PING " + shownName + " (" + ip + ") " + size + "(" + (size + 28) + ") bytes of data.\n");
    var times = [], errs = 0;
    var replyName = v6 ? (/%/.test(dstSpec) ? dstSpec : ip) : (res.viaName ? (NAMES[ip] || ip) + " (" + ip + ")" : ip);
    var icmpOff = !r.self && (nw.icmpBlock || {})[ip];
    var tooBig = mdo && !r.self && r.pmtu && size + 28 > r.pmtu;
    for (var k = 1; k <= n; k++) {
      if (tooBig) { if (!nw.pmtuBlackhole) { errs++; if (!quiet) out(io, "From " + r.pmtuFrom + " icmp_seq=" + k + " Frag needed and DF set (mtu = " + r.pmtu + ")\n"); } }
      else if (r.ok && !icmpOff && !lost(ip + "/" + k + "/" + (sys.cmdIndex || 0), r.loss || 0) && !(r.slow && k % 4 === 2) && !(r.dup && k % 2 === 0)) {
        var t = r.rtt * (0.93 + (hash(ip + k) % 15) / 100) * (r.slow ? 1 + (hash("j" + k) % 90) / 30 : 1);
        times.push(t);
        if (!quiet) out(io, (size + 8) + " bytes from " + replyName + ": icmp_seq=" + k + " ttl=" + r.ttl + " time=" + fmtMs(t) + " ms\n");
      } else if (r.err === "hostunreach") {
        errs++;
        if (!quiet && (k % 3 === 1 || k === n)) out(io, "From " + (r.from || r.src) + " icmp_seq=" + k + " Destination Host Unreachable\n");
      } else if (r.ok && r.dup && !quiet && k % 2 === 0) { /* the reply went to the impostor */ }
    }
    if (!count) out(io, "^C\n");
    var loss = Math.round((n - times.length) / n * 100);
    out(io, "\n--- " + target + " ping statistics ---\n" + n + " packets transmitted, " + times.length + " received, " + (errs ? "+" + errs + " errors, " : "") + loss + "% packet loss, time " + (n - 1) * 1001 + "ms\n");
    if (times.length) { var mn = Math.min.apply(null, times), mx = Math.max.apply(null, times), avg = times.reduce(function (s, v) { return s + v; }, 0) / times.length; out(io, "rtt min/avg/max/mdev = " + [mn, avg, mx, (mx - mn) / 3].map(function (v) { return v.toFixed(3); }).join("/") + " ms" + (r.err === "hostunreach" ? ", pipe 3" : "") + "\n"); }
    else if (r.err === "hostunreach") out(io, "pipe 4\n");
    if (!count) note(io, "(ping keeps going until you press Ctrl+C; the lab stopped it after 4. Use ping -c 4 to send a fixed number.)");
    ev(sys, { k: "ping", to: ip, n: n, got: times.length, size: size, df: mdo, tooBig: !!tooBig, ttlr: r.ttl, ok: times.length > 0, loss: loss, path: r.path, fail: r.ok ? null : r.fail, err: r.err, nic: !!r.nic, v6: v6, layer: r.nic ? 1 : 3 });
    return times.length ? 0 : 1;
  };
  CMDS.ping6 = function (args, io, sess) { return CMDS.ping(["ping6"].concat(args.slice(1)), io, sess); };

  /* ================================================================== traceroute, tracepath */
  CMDS.traceroute = function (args, io, sess) {
    var sys = sess.sys, a = args.slice(1), numeric = false, max = 30, target = null, six = false, q = 3;
    for (var i = 0; i < a.length; i++) { var x = a[i]; if (x === "-n") numeric = true; else if (x === "-m") max = +a[++i]; else if (x === "-q") q = +a[++i]; else if (x === "-6") six = true; else if (x === "-4" || x === "-I" || x === "-T") continue; else if (x === "-w" || x === "-p" || x === "-f") i++; else if (/^-/.test(x)) { errl(io, "Bad option `" + x + "' (argc " + (i + 1) + ")"); return 2; } else if (!target) target = x; }
    if (!target) { out(io, "Usage:\n  traceroute [ -46dFITnreAUDV ] [ -f first_ttl ] [ -m max_ttl ] [ -q nqueries ] host [ packetlen ]\n"); return 2; }
    var res = M2.NET.resolveForPing ? M2.NET.resolveForPing(sys, target, six, false) : { ip: target };
    if (res.err) { errl(io, target + ": " + res.err); errl(io, "Cannot handle \"host\" cmdline arg `" + target + "' on position 1 (argc " + (a.indexOf(target) + 1) + ")"); return 2; }
    var ip = res.ip, r = reach(sys, ip);
    out(io, "traceroute to " + target + " (" + ip + "), " + max + " hops max, " + (isV6(ip) ? 80 : 60) + " byte packets\n");
    if (r.err === "netunreach") { errl(io, "connect: Network is unreachable"); ev(sys, { k: "trace", to: ip, ok: false, path: r.path, fail: r.fail }); return 1; }
    function stamp(base, k) { return Array.apply(null, new Array(q)).map(function (_, j) { return fmtMs(base * (0.95 + ((hash(ip + k + "/" + j) % 11) / 100))) + " ms"; }).join("  "); }
    var hops = r.hops.slice(), n = 0;
    if (r.err === "hostunreach") {
      out(io, " 1  " + (numeric ? r.src : sys.host + " (" + r.src + ")") + "  " + Array.apply(null, new Array(q)).map(function (_, j) { return (3069.8 + j * 0.02).toFixed(3) + " ms !H"; }).join("  ") + "\n");
      ev(sys, { k: "trace", to: ip, ok: false, path: r.path, fail: r.fail, hops: [] });
      return 0;
    }
    var shown = [];
    for (var h = 0; h < hops.length && n < max; h++) {
      n++;
      var hp = hops[h];
      if (!hp) { out(io, pad(n, 2) + "  " + Array.apply(null, new Array(q)).map(function () { return "*"; }).join(" ") + "\n"); shown.push(null); continue; }
      var nm = numeric ? hp.ip : (hp.name || hp.ip) + " (" + hp.ip + ")";
      out(io, pad(n, 2) + "  " + nm + "  " + stamp(hp.rtt, n) + "\n");
      shown.push(hp.ip);
    }
    if (!r.ok) { while (n < max) { n++; out(io, pad(n, 2) + "  " + Array.apply(null, new Array(q)).map(function () { return "*"; }).join(" ") + "\n"); } }
    ev(sys, { k: "trace", to: ip, ok: r.ok, path: r.path, fail: r.ok ? null : r.fail, hops: shown, layer: 3 });
    return 0;
  };
  CMDS.tracepath = function (args, io, sess) {
    var sys = sess.sys, a = args.slice(1).filter(function (x) { return !/^-/.test(x); }), numeric = args.indexOf("-n") >= 0, target = a[0];
    if (!target) { errl(io, "Usage\n  tracepath [options] <destination>"); return 1; }
    var res = M2.NET.resolveForPing ? M2.NET.resolveForPing(sys, target, false, false) : { ip: target };
    if (res.err) { errl(io, "tracepath: " + target + ": " + res.err); return 1; }
    var r = reach(sys, res.ip);
    out(io, " 1?: [LOCALHOST]                      pmtu " + (sys.nw.ifs.eth0 ? sys.nw.ifs.eth0.mtu : 1500) + "\n");
    if (!r.ok && !r.hops.length) { out(io, " 1:  send failed\n     Resume: pmtu " + 1500 + " \n"); return 1; }
    r.hops.forEach(function (hp, k) { out(io, pad(k + 1, 2) + ":  " + rpad(hp ? (numeric ? hp.ip : hp.name || hp.ip) : "no reply", 36) + (hp ? fmtMs(hp.rtt) + "ms " : "") + (r.ok && k === r.hops.length - 1 ? "reached" : "") + "\n"); });
    out(io, "     Resume: pmtu 1500 " + (r.ok ? "hops " + r.hops.length + " back " + r.hops.length : "") + "\n");
    ev(sys, { k: "trace", to: res.ip, ok: r.ok, path: r.path, fail: r.ok ? null : r.fail, layer: 3 });
    return 0;
  };

  /* ================================================================== arping */
  CMDS.arping = function (args, io, sess) {
    var sys = sess.sys, nw = sys.nw, a = args.slice(1), count = null, dad = false, iface = null, target = null, quiet = false;
    for (var i = 0; i < a.length; i++) { var x = a[i]; if (x === "-c") count = +a[++i]; else if (x === "-I") iface = a[++i]; else if (x === "-D") dad = true; else if (x === "-q") quiet = true; else if (x === "-w" || x === "-s" || x === "-i") i++; else if (x === "-f" || x === "-b" || x === "-U" || x === "-A") continue; else if (/^-/.test(x)) { errl(io, "arping: invalid option -- '" + x.slice(1) + "'"); return 2; } else target = x; }
    if (!target) { errl(io, "Usage: arping [-fqbDUAV] [-c count] [-w timeout] [-I device] [-s source] destination"); return 2; }
    if (!isV4(target)) { var rr = M2.NET.resolveQuiet ? M2.NET.resolveQuiet(sys, target) : null; if (!rr) { errl(io, "arping: " + target + ": Name or service not known"); return 2; } target = rr; }
    var rt = lookup4(nw, target);
    var dev = iface || (rt ? rt.dev : null);
    if (!dev || !nw.ifs[dev]) { errl(io, "arping: Device " + (dev || "eth0") + " not available."); return 2; }
    var d = nw.ifs[dev], src = dad ? "0.0.0.0" : (d.addrs[0] || {}).ip;
    if (!d.admin) { errl(io, "arping: Interface \"" + dev + "\" is down"); return 2; }
    if (!src) { errl(io, "arping: no source address in not-DAD mode"); return 2; }
    var n = count || 4, seg = segOf(nw, d);
    out(io, "ARPING " + target + " from " + src + " " + dev + "\n");
    var p = peerOn(nw, seg, target), dupMac = (nw.dups || {})[target];
    var answers = [];
    if (dad) { if (p || (nw.dupSelf && nw.dupSelf[target])) answers.push((p || {}).mac || nw.dupSelf[target]); }
    else { if (p) answers.push(p.mac); if (dupMac && seg) answers.push(dupMac); }
    var got = 0;
    for (var k = 1; k <= n; k++) {
      answers.forEach(function (m, j) {
        if (dad && k > 1) return;
        got++;
        if (!quiet) out(io, "Unicast reply from " + target + " [" + m.toUpperCase() + "]  " + ((j ? 0.9 : 0.6) + (hash(target + k + m) % 30) / 100).toFixed(3) + "ms\n");
      });
    }
    if (!count) out(io, "^C\n");
    out(io, "Sent " + n + " probes (" + (dad ? n : 1) + " broadcast(s))\nReceived " + got + " response(s)\n");
    if (!count) note(io, "(arping keeps going until Ctrl+C; the lab stopped it after 4. Use -c to choose.)");
    if (p) learn(nw, target, dupMac && hash("flip" + (sys.cmdIndex || 0)) % 2 ? dupMac : p.mac, dev);
    ev(sys, { k: "arp", to: target, macs: answers, ok: answers.length > 0, path: ["you", "sw"].concat(p ? [p.node] : []), layer: 2 });
    return dad ? (got ? 1 : 0) : (got ? 0 : 1);
  };

  /* ================================================================== ipcalc (the classic Perl ipcalc, as Ubuntu ships it) */
  function bin(ip, prefix) {
    var b = ip.split(".").map(function (o) { return ("0000000" + (+o).toString(2)).slice(-8); }).join(".");
    // a space at the network/host boundary
    var count = 0, i;
    for (i = 0; i < b.length; i++) { if (b.charAt(i) === ".") continue; if (count === prefix) break; count++; }
    return prefix >= 32 ? b : b.slice(0, i) + " " + b.slice(i);
  }
  function klass(ip) {
    var f = +ip.split(".")[0];
    var c = f < 128 ? "Class A" : f < 192 ? "Class B" : f < 224 ? "Class C" : f < 240 ? "Class D, Multicast" : "Class E";
    return c + (isPrivate(ip) ? ", Private Internet" : inNet(ip, "100.64.0.0", 10) ? ", Shared address space" : /^127\./.test(ip) ? ", Loopback" : "");
  }
  function ipcalcBlock(ip, p, nb, showAddr) {
    var L = [], row = function (label, val, b) { L.push(rpad(label, 11) + (nb ? val : rpad(val, 21) + b)); };
    var net = netOf(ip, p), bc = bcastOf(ip, p), mask = n2ip(maskN(p)), wild = n2ip(~maskN(p) >>> 0);
    if (showAddr) { row("Address:", ip, bin(ip, p)); row("Netmask:", mask + " = " + p, bin(mask, p)); row("Wildcard:", wild, bin(wild, p)); L.push("=>"); }
    row("Network:", net + "/" + p, bin(net, p));
    if (p <= 30) { row("HostMin:", n2ip(ip2n(net) + 1), bin(n2ip(ip2n(net) + 1), p)); row("HostMax:", n2ip(ip2n(bc) - 1), bin(n2ip(ip2n(bc) - 1), p)); row("Broadcast:", bc, bin(bc, p)); L.push(rpad("Hosts/Net:", 11) + rpad(String(Math.pow(2, 32 - p) - 2), 21) + " " + klass(net)); }
    else if (p === 31) { row("HostMin:", net, bin(net, p)); row("HostMax:", bc, bin(bc, p)); L.push(rpad("Hosts/Net:", 11) + rpad("2", 22) + " " + klass(net) + ", PtP Link RFC 3021"); }
    else { L.push(rpad("Hostroute:", 11) + rpad(ip, 21) + (nb ? "" : bin(ip, p))); L.push(rpad("Hosts/Net:", 11) + rpad("1", 22) + " " + klass(ip)); }
    return L;
  }
  CMDS.ipcalc = function (args, io, sess) {
    var a = args.slice(1), nb = false, rest = [];
    a.forEach(function (x) { if (x === "-b" || x === "--nobinary") nb = true; else if (x === "-n" || x === "--nocolor" || x === "-c" || x === "--class") return; else if (x === "-h" || x === "--help") rest.push("--help"); else rest.push(x); });
    if (!rest.length || rest[0] === "--help") { out(io, "Usage: ipcalc [options] <ADDRESS>[[/]<NETMASK>] [NETMASK]\n\nipcalc takes an IP address and netmask and calculates the resulting\nbroadcast, network, Cisco wildcard mask, and host range. By giving a\nsecond netmask, you can design sub- and supernetworks.\n\n  -n --nocolor  Don't display ANSI color codes.\n  -b --nobinary Suppress the bitwise output.\n  -c --class    Just print bit-count-mask of given address.\n"); return rest.length ? 0 : 1; }
    var m = /^([\d.]+)(?:\/([\d.]+))?$/.exec(rest[0]);
    var mask2 = rest[1];
    if (!m || !isV4(m[1])) { out(io, "INVALID ADDRESS: " + rest[0] + "\n"); return 1; }
    var p = m[2] === undefined ? (mask2 && !/^\d+$/.test(mask2) ? null : 24) : /^\d+$/.test(m[2]) ? +m[2] : maskToPrefix(m[2]);
    if (m[2] === undefined && rest[1] && !/^\d+$/.test(rest[1])) { p = maskToPrefix(rest[1]); mask2 = rest[2]; }
    if (p === null || p > 32) { out(io, "INVALID MASK1:   " + (m[2] || rest[1]) + "\n"); return 1; }
    var L = ipcalcBlock(m[1], p, nb, true);
    if (mask2 !== undefined) {
      var p2 = /^\d+$/.test(mask2) ? +mask2 : maskToPrefix(mask2);
      if (p2 === null || p2 > 32) { out(io, "INVALID MASK2:   " + mask2 + "\n"); return 1; }
      L.push("");
      if (p2 > p) {
        L.push("Subnets after transition from /" + p + " to /" + p2, "");
        var mask = n2ip(maskN(p2)), wild = n2ip(~maskN(p2) >>> 0);
        L.push(rpad("Netmask:", 11) + (nb ? mask + " = " + p2 : rpad(mask + " = " + p2, 21) + bin(mask, p2)));
        L.push(rpad("Wildcard:", 11) + (nb ? wild : rpad(wild, 21) + bin(wild, p2)), "");
        var count = Math.pow(2, p2 - p), base = ip2n(netOf(m[1], p)), size = Math.pow(2, 32 - p2), shownN = Math.min(count, 64);
        for (var k = 0; k < shownN; k++) { L.push(" " + (k + 1) + "."); L = L.concat(ipcalcBlock(n2ip(base + k * size), p2, nb, false)); L.push(""); }
        if (count > shownN) L.push("(" + (count - shownN) + " more subnets not shown)", "");
        L.push(rpad("Subnets:", 11) + count, rpad("Hosts:", 11) + count * Math.max(0, size - 2));
      } else {
        L.push("Supernet", "");
        L = L.concat(ipcalcBlock(netOf(m[1], p2), p2, nb, false));
      }
    }
    out(io, joinLines(L) + "\n");
    return 0;
  };

  /* ================================================================== the machine: base files and boot */
  var NETPLAN = "# Network for kc-web-01. Managed by the Kestrel ops team.\n# Apply changes with: sudo netplan apply\nnetwork:\n  version: 2\n  ethernets:\n    eth0:\n      addresses:\n        - 10.20.0.15/24\n      routes:\n        - to: default\n          via: 10.20.0.1\n      nameservers:\n        addresses: [10.20.0.2]\n        search: [kestrel.internal]\n";
  N.NETPLAN = NETPLAN;
  var OUI = "OUI/MA-L                                                    Organization                                 \ncompany_id                                                  Organization                                 \n                                                            Address                                      \n\n00-1B-54   (hex)\t\tCisco Systems, Inc\n001B54     (base 16)\t\tCisco Systems, Inc\n\t\t\t\t170 West Tasman Dr.\n\t\t\t\tSan Jose  CA  95134\n\t\t\t\tUS\n\n3C-52-82   (hex)\t\tHewlett Packard\n3C5282     (base 16)\t\tHewlett Packard\n\t\t\t\t11445 Compaq Center Drive\n\t\t\t\tHouston    77070\n\t\t\t\tUS\n\n52-54-00   (hex)\t\tQEMU virtual NIC (locally administered)\n525400     (base 16)\t\tQEMU virtual NIC (locally administered)\n\n00-0C-29   (hex)\t\tVMware, Inc.\n000C29     (base 16)\t\tVMware, Inc.\n\t\t\t\t3401 Hillview Avenue\n\t\t\t\tPalo Alto  CA  94304\n\t\t\t\tUS\n\nB8-27-EB   (hex)\t\tRaspberry Pi Foundation\nB827EB     (base 16)\t\tRaspberry Pi Foundation\n\t\t\t\tMitchell Wood House\n\t\t\t\tCaldecote  Cambridgeshire  CB23 7NU\n\t\t\t\tGB\n\nF0-1F-AF   (hex)\t\tDell Inc.\nF01FAF     (base 16)\t\tDell Inc.\n\t\t\t\tOne Dell Way\n\t\t\t\tRound Rock  TX  78682\n\t\t\t\tUS\n\n00-50-56   (hex)\t\tVMware, Inc.\n005056     (base 16)\t\tVMware, Inc.\n\t\t\t\t3401 Hillview Avenue\n\t\t\t\tPalo Alto  CA  94304\n\t\t\t\tUS\n";
  // packages for the tools this track adds (installed ones get their binaries from sh-sys's package hook)
  function PK(name, ver, o) { return Object.assign({ name: name, ver: ver, arch: "amd64", section: "net", size: 120, desc: "", deps: [], bins: [], sbins: [], installed: false, auto: false, archive: "noble" }, o || {}); }
  M2.CATALOG.push(
    PK("ipcalc", "0.51-1", { arch: "all", size: 30, desc: "parameter calculator for IPv4 addresses", bins: ["ipcalc"] }),
    PK("iputils-arping", "3:20240117-1build1", { size: 60, desc: "Tool to send ICMP echo requests to an ARP address", bins: ["arping"] }),
    PK("iputils-tracepath", "3:20240117-1build1", { installed: true, size: 60, desc: "Tools to trace the network path to a remote host", bins: ["tracepath"] }),
    PK("traceroute", "1:2.1.5-1", { installed: true, size: 160, desc: "Traces the route taken by packets over an IPv4/IPv6 network", bins: ["traceroute"] }),
    PK("ethtool", "1:6.7-1build1", { installed: true, size: 710, desc: "display or change Ethernet device settings", sbins: ["ethtool"] }),
    PK("tcpdump", "4.99.4-3ubuntu4", { installed: true, size: 1300, desc: "command-line network traffic analyzer", bins: ["tcpdump"] }),
    PK("netplan.io", "1.0.1-1ubuntu2~24.04.1", { installed: true, size: 330, desc: "Declarative network configuration for various backends", sbins: ["netplan"] }),
    PK("ieee-data", "20220827.1", { installed: true, arch: "all", section: "misc", size: 4500, desc: "OUI and IAB listings" }),
    PK("certbot", "2.9.0-1", { installed: true, arch: "all", section: "web", size: 40, desc: "automatically configure HTTPS using Let's Encrypt", bins: ["certbot"] }),
    PK("xxd", "2:9.1.0016-1ubuntu7.3", { installed: true, arch: "amd64", section: "editors", size: 90, desc: "tool to make (or reverse) a hex dump", bins: ["xxd"] }),
    PK("bsdextrautils", "2.39.3-9ubuntu6.1", { installed: true, section: "utils", size: 340, desc: "extra utilities from 4.4BSD-Lite", bins: ["hexdump", "column"] })
  );
  var MYBINS = { "/usr/sbin/sysctl": "sysctl", "/usr/bin/ping6": "ping6", "/usr/bin/base64": "base64", "/usr/bin/iconv": "iconv", "/usr/bin/resolvectl": "resolvectl", "/usr/bin/ifconfig": "ifconfig" };
  S.SYS_HOOKS.push(function (sys) {
    sys.nw = baseNw(sys);
    Object.keys(MYBINS).forEach(function (p) { putRoot(sys, p, "\x7fELF:" + MYBINS[p] + " (simulated binary)\n", 493, 0, 0, Date.UTC(2024, 3, 8)); });
    if (sys.pkgs && sys.pkgs["net-tools"] && !sys.pkgs["net-tools"].installed) M2.rmRoot(sys, "/usr/bin/ifconfig");
    S.mkdirs(sys, "/etc/netplan", 493, 0, 0);
    putRoot(sys, "/etc/netplan/01-kestrel.yaml", NETPLAN, 384, 0, 0, NOW - 30 * DAY);
    S.mkdirs(sys, "/etc/sysctl.d", 493, 0, 0);
    putRoot(sys, "/etc/sysctl.conf", "#\n# /etc/sysctl.conf - Configuration file for setting system variables\n# See /etc/sysctl.d/ for additional system variables.\n# See sysctl.conf (5) for information.\n#\n\n# Uncomment the next line to enable packet forwarding for IPv4\n#net.ipv4.ip_forward=1\n", 420, 0, 0, NOW - 400 * DAY);
    putRoot(sys, "/etc/sysctl.d/10-network-security.conf", "\n# Turn on Source Address Verification in all interfaces to\n# prevent some spoofing attacks.\nnet.ipv4.conf.default.rp_filter=2\nnet.ipv4.conf.all.rp_filter=2\n", 420, 0, 0, NOW - 400 * DAY);
    putRoot(sys, "/etc/sysctl.d/README.sysctl", "Kernel system variables configuration files\n\nFiles found under the /etc/sysctl.d directory that end with .conf are\nparsed within sysctl(8) at boot time.\n", 420, 0, 0, NOW - 400 * DAY);
    S.mkdirs(sys, "/usr/share/ieee-data", 493, 0, 0);
    putRoot(sys, "/usr/share/ieee-data/oui.txt", OUI, 420, 0, 0, NOW - 400 * DAY);
    putRoot(sys, "/etc/hosts", "127.0.0.1 localhost\n127.0.1.1 kc-web-01\n10.20.0.15 kc-web-01.kestrel.internal kc-web-01\n\n# The following lines are desirable for IPv6 capable hosts\n::1     ip6-localhost ip6-loopback\nfe00::0 ip6-localnet\nff00::0 ip6-mcastprefix\nff02::1 ip6-allnodes\nff02::2 ip6-allrouters\n", 420, 0, 0, NOW - 30 * DAY);
  });
  // After the lab's own setup: boot the network (sysctl.d, then netplan) unless the lab wants to set it by hand.
  S.POST_HOOKS = S.POST_HOOKS || [];
  S.POST_HOOKS.push(function (sys) {
    var nw = sys.nw; if (!nw) return;
    if (sys.host !== "kc-web-01" && !nw.custom) {
      // other machines (built on demand for SSH) get a plain eth0 with their own address
      nw.ifs.eth0.mac = "52:54:00:" + M2.hexOf("mac" + sys.host, 6).replace(/(..)(..)(..)/, "$1:$2:$3");
      nw.ifs.eth0.addrs = [{ ip: sys.ip || "10.20.0.99", prefix: 24, scope: "global" }];
      nw.routes = [{ dst: "0.0.0.0", prefix: 0, via: "10.20.0.1", dev: "eth0", proto: "static", metric: 0 }];
      nw.linkDns.eth0 = { servers: ["10.20.0.2"], search: ["kestrel.internal"] };
      return;
    }
    N.sysctlBoot(sys);
    if (!nw.noBoot) N.npBoot(sys);
    // what kc-web-01 already knows about its neighbours
    if (nw.neigh["10.20.0.1"] === undefined && lookup4(nw, "10.20.0.1") && SEGS.srv.peers["10.20.0.1"]) { var gw = reach(sys, "10.20.0.1", { quiet: true }); if (gw.ok) nw.neigh["10.20.0.1"] = { mac: MAC.gw, dev: gw.dev, state: "REACHABLE", router: true }; }
    if (nw.neigh["10.20.0.21"] === undefined) { var db = reach(sys, "10.20.0.21", { quiet: true }); if (db.ok && !db.via) nw.neigh["10.20.0.21"] = { mac: nw.dups["10.20.0.21"] || MAC.db, dev: db.dev, state: "STALE" }; }
    nw.events = [];
    if (nw.after) nw.after(sys);
  });

  M2.NET = N;
  root.NetCore = N;
})(typeof window !== "undefined" ? window : globalThis);
