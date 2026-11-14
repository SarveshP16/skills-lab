/* sudo learn — packets and tcpdump for the Networking track. A packet is a small object (Ethernet, optional VLAN tag,
   ARP or IPv4/IPv6, TCP/UDP/ICMP, payload). It is encoded to real bytes with real checksums, so tcpdump -X shows
   the same hex a real capture would, and the visual panel can colour each byte by its layer. .pcap files hold
   packets as JSON behind the pcap magic number. Live captures show the traffic on the scenario's network. */
(function (root) {
  "use strict";
  var S = root.ShEngine, U = S.util, CMDS = S.CMDS, M2 = S.M2, N = M2.NET;
  var out = U.out, errl = U.errl, note = U.note, joinLines = U.joinLines, pad = U.pad, rpad = U.rpad, tod = M2.tod;
  var W = N.W, isV4 = N.isV4, isV6 = N.isV6, ev = N.ev;
  var MAGIC = "\xd4\xc3\xb2\xa1\x02\x00\x04\x00";

  /* ================================================================== bytes */
  function ipBytes(ip) { return ip.split(".").map(Number); }
  function ip6Bytes(ip) { var g = N.v6parse(ip), b = []; g.forEach(function (x) { b.push(x >> 8, x & 255); }); return b; }
  function macBytes(m) { return m.split(":").map(function (x) { return parseInt(x, 16); }); }
  function u16(n) { return [(n >> 8) & 255, n & 255]; }
  function u32(n) { n = n >>> 0; return [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]; }
  function sum16(bytes) { var s = 0; for (var i = 0; i < bytes.length; i += 2) s += (bytes[i] << 8) + (bytes[i + 1] || 0); while (s >> 16) s = (s & 0xffff) + (s >> 16); return (~s) & 0xffff; }
  function strBytes(s) { return Array.prototype.slice.call(new TextEncoder().encode(s || "")); }
  var FLAGBITS = { F: 1, S: 2, R: 4, P: 8, ".": 16, U: 32 };
  function tcpOpts(p) {
    var t = p.tcp, o = [];
    if (/S/.test(t.flags)) { o = o.concat([2, 4], u16(t.mss || 1460), [4, 2], [8, 10], u32(t.tsval || 0), u32(t.tsecr || 0), [1], [3, 3, t.wscale == null ? 7 : t.wscale]); }
    else if (t.ts !== false) o = o.concat([1, 1, 8, 10], u32(t.tsval || 0), u32(t.tsecr || 0));
    return o;
  }
  // DNS message bytes
  function dnsName(n) { var b = []; String(n).replace(/\.$/, "").split(".").forEach(function (l) { if (!l) return; b.push(l.length); strBytes(l).forEach(function (c) { b.push(c); }); }); b.push(0); return b; }
  var QT = { A: 1, NS: 2, CNAME: 5, SOA: 6, PTR: 12, MX: 15, TXT: 16, AAAA: 28 };
  function dnsBytes(d) {
    var flags = d.resp ? 0x8180 | (d.rcode === "NXDOMAIN" ? 3 : d.rcode === "SERVFAIL" ? 2 : 0) : 0x0100;
    var b = u16(d.id).concat(u16(flags), u16(1), u16((d.an || []).length), u16(0), u16(0), dnsName(d.q), u16(QT[d.qt] || 1), u16(1));
    (d.an || []).forEach(function (a) {
      var rdata = a.type === "A" ? ipBytes(a.data) : a.type === "AAAA" ? ip6Bytes(a.data) : dnsName(a.data);
      b = b.concat([0xc0, 0x0c], u16(QT[a.type] || 1), u16(1), u32(a.ttl || 300), u16(rdata.length), rdata);
    });
    return b;
  }
  function payloadBytes(p) {
    if (p.dns) return dnsBytes(p.dns);
    if (p.bin) return p.bin.slice();
    if (p.enc) { var x = [], s = p.enc.seed || 1; for (var i = 0; i < p.enc.len; i++) { s = (s * 1103515245 + 12345) & 0x7fffffff; x.push(s & 255); } if (p.enc.tls) { x[0] = p.enc.tls; x[1] = 3; x[2] = 3; x[3] = (p.enc.len - 5) >> 8; x[4] = (p.enc.len - 5) & 255; } return x; }
    if (p.icmp) { var y = []; if (p.icmp.type === 8 || p.icmp.type === 0) { y = u32(Math.floor((p.t || 0) / 1000)).concat([0, 0, 0, 0]); for (var k = 0x10; y.length < 56; k++) y.push(k & 255); } return y; }
    return strBytes(p.data || "");
  }
  // Encode a packet. Returns {bytes, spans: [{l: layer, from, to, name}]}
  function encode(p) {
    var spans = [], b = [];
    var vlan = p.vlan;
    var etype = p.arp ? 0x0806 : p.ip6 ? 0x86dd : 0x0800;
    b = b.concat(macBytes(p.eth.dst), macBytes(p.eth.src));
    if (vlan) b = b.concat(u16(0x8100), u16(vlan & 0xfff));
    b = b.concat(u16(etype));
    spans.push({ l: 2, from: 0, to: b.length, name: vlan ? "Ethernet + 802.1Q" : "Ethernet" });
    if (p.arp) {
      var a = p.arp, ab = u16(1).concat(u16(0x0800), [6, 4], u16(a.op === "reply" ? 2 : 1), macBytes(a.sha), ipBytes(a.spa), macBytes(a.tha || "00:00:00:00:00:00"), ipBytes(a.tpa));
      spans.push({ l: 2, from: b.length, to: b.length + ab.length, name: "ARP" });
      b = b.concat(ab);
      while (b.length < 60) b.push(0);
      return { bytes: b, spans: spans };
    }
    var pay = payloadBytes(p), l4 = [], proto, l4name;
    if (p.tcp) {
      var t = p.tcp, opts = tcpOpts(p), hl = 20 + opts.length;
      var fl = 0; String(t.flags).split("").forEach(function (c) { fl |= FLAGBITS[c] || 0; });
      l4 = u16(t.sport).concat(u16(t.dport), u32(t.seq || 0), u32(t.ack || 0), [(hl / 4) << 4, fl], u16(t.win == null ? 502 : t.win), [0, 0], [0, 0], opts);
      proto = 6; l4name = "TCP";
    } else if (p.udp) {
      l4 = u16(p.udp.sport).concat(u16(p.udp.dport), u16(8 + pay.length), [0, 0]);
      proto = 17; l4name = "UDP";
    } else if (p.icmp) {
      l4 = [p.icmp.type, p.icmp.code || 0, 0, 0].concat(u16(p.icmp.id || 0), u16(p.icmp.seq || 0));
      proto = p.ip6 ? 58 : 1; l4name = p.ip6 ? "ICMPv6" : "ICMP";
    }
    var ipStart = b.length, iph;
    if (p.ip6) {
      var h6 = p.ip6;
      iph = [0x60, 0, 0, 0].concat(u16(l4.length + pay.length), [proto, h6.hlim || 64], ip6Bytes(h6.src), ip6Bytes(h6.dst));
      spans.push({ l: 3, from: ipStart, to: ipStart + 40, name: "IPv6" });
    } else {
      var h = p.ip, tot = 20 + l4.length + pay.length;
      iph = [0x45, h.tos || 0].concat(u16(tot), u16(h.id || 0), u16(h.df === false ? 0 : 0x4000), [h.ttl || 64, proto], [0, 0], ipBytes(h.src), ipBytes(h.dst));
      var c = sum16(iph); iph[10] = c >> 8; iph[11] = c & 255;
      spans.push({ l: 3, from: ipStart, to: ipStart + 20, name: "IPv4" });
    }
    // L4 checksum over the pseudo header
    var pseudo = p.ip6 ? ip6Bytes(p.ip6.src).concat(ip6Bytes(p.ip6.dst), u32(l4.length + pay.length), [0, 0, 0, proto]) : ipBytes(p.ip.src).concat(ipBytes(p.ip.dst), [0, proto], u16(l4.length + pay.length));
    var ck = sum16((p.icmp && !p.ip6 ? [] : pseudo).concat(l4, pay));
    var at = p.tcp ? 16 : p.udp ? 6 : 2;
    if (p.udp && ck === 0) ck = 0xffff;
    l4[at] = ck >> 8; l4[at + 1] = ck & 255;
    b = b.concat(iph);
    spans.push({ l: p.icmp ? 3 : 4, from: b.length, to: b.length + l4.length, name: l4name });
    b = b.concat(l4);
    if (pay.length) spans.push({ l: p.dns || p.data ? 7 : p.enc && p.enc.tls ? 6 : p.icmp ? 3 : 7, from: b.length, to: b.length + pay.length, name: p.dns ? "DNS" : p.appName || (p.data != null && /^(GET|POST|PUT|DELETE|HEAD|OPTIONS|PATCH) |^HTTP\/1/.test(p.data) ? "HTTP" : null) || (p.enc && p.enc.tls ? "TLS (encrypted)" : p.enc ? "encrypted data" : p.icmp ? "ICMP data" : "payload") });
    b = b.concat(pay);
    return { bytes: b, spans: spans, l4len: l4.length, paylen: pay.length };
  }
  N.encode = encode;

  /* ================================================================== building packets (used by labs and the ambient traffic) */
  var MACOF = { "10.20.0.15": W.MY_MAC, "10.20.0.1": W.MAC.gw, "10.20.0.2": W.MAC.dns, "10.20.0.21": W.MAC.db, "10.20.0.31": W.MAC.backup, "10.20.0.254": W.MAC.vpn, "10.20.0.10": W.MAC.lb, "10.20.30.31": W.MAC.backup30, "10.20.30.15": W.MY_MAC };
  function macFor(ip) { return MACOF[ip] || W.MAC.gw; }   // off-LAN traffic goes through the router's MAC
  N.macFor = macFor;
  // A TCP conversation: [{dir: ">"|"<", flags, data?, len?, enc?}] -> packets with seq/ack worked out
  function convo(o) {
    var t = o.t || 0, seqA = o.isnA || 3121542010, seqB = o.isnB || 2210911407, tsA = o.tsA || 3412871, tsB = o.tsB || 998120, idA = o.idA || 41022, idB = o.idB || 0, res = [];
    (o.steps || []).forEach(function (s, i) {
      var fromA = s.dir !== "<", pay = s.data != null ? strBytes(s.data).length : s.enc ? s.enc.len : 0;
      var p = {
        t: t + (s.dt != null ? s.dt : i * 0.4),
        eth: { src: fromA ? macFor(o.a) : macFor(o.b), dst: fromA ? macFor(o.b) : macFor(o.a) },
        ip: { src: fromA ? o.a : o.b, dst: fromA ? o.b : o.a, ttl: fromA ? 64 : (o.ttlB || 64), id: fromA ? idA++ : idB++ },
        tcp: { sport: fromA ? o.pa : o.pb, dport: fromA ? o.pb : o.pa, flags: s.flags, seq: fromA ? seqA : seqB, ack: /S$/.test(s.flags) ? 0 : fromA ? seqB : seqA, win: fromA ? (s.flags === "S" ? 64240 : 502) : (/S/.test(s.flags) ? 65160 : 509), tsval: fromA ? tsA : tsB, tsecr: fromA ? (s.flags === "S" ? 0 : tsB) : tsA, mss: 1460 }
      };
      if (o.eth) { p.eth = { src: fromA ? o.eth[0] : o.eth[1], dst: fromA ? o.eth[1] : o.eth[0] }; }
      if (s.data != null) p.data = s.data; if (s.enc) p.enc = s.enc; if (s.appName) p.appName = s.appName;
      if (/S|F/.test(s.flags)) pay += 1;
      if (fromA) { seqA += pay; tsA += 13; } else { seqB += pay; tsB += 11; }
      res.push(p);
    });
    return res;
  }
  function udpPkt(t, a, b, pa, pb, o) { var p = { t: t, eth: { src: macFor(a), dst: macFor(b) }, ip: { src: a, dst: b, ttl: 64, id: (o && o.id) || 0, df: !(o && o.nodf) }, udp: { sport: pa, dport: pb } }; return Object.assign(p, o || {}); }
  function dnsPair(t, client, server, cport, id, q, qt, answers, rcode) {
    return [udpPkt(t, client, server, cport, 53, { dns: { id: id, q: q, qt: qt || "A" } }), udpPkt(t + 0.0012, server, client, 53, cport, { dns: { id: id, q: q, qt: qt || "A", resp: true, an: answers || [], rcode: rcode } })];
  }
  function icmpPair(t, a, b, id, seq, ttlB) {
    return [{ t: t, eth: { src: macFor(a), dst: macFor(b) }, ip: { src: a, dst: b, ttl: 64, id: 30000 + seq }, icmp: { type: 8, id: id, seq: seq } },
      { t: t + 0.00041, eth: { src: macFor(b), dst: macFor(a) }, ip: { src: b, dst: a, ttl: ttlB || 64, id: 50000 + seq, df: false }, icmp: { type: 0, id: id, seq: seq } }];
  }
  function arpReq(t, smac, sip, tip, vlan) { return { t: t, eth: { src: smac, dst: "ff:ff:ff:ff:ff:ff" }, vlan: vlan, arp: { op: "request", sha: smac, spa: sip, tha: "00:00:00:00:00:00", tpa: tip } }; }
  function arpRep(t, smac, sip, dmac, dip, vlan) { return { t: t, eth: { src: smac, dst: dmac }, vlan: vlan, arp: { op: "reply", sha: smac, spa: sip, tha: dmac, tpa: dip } }; }
  N.P = { convo: convo, udp: udpPkt, dns: dnsPair, icmp: icmpPair, arpReq: arpReq, arpRep: arpRep };
  function pcapFile(pkts) { return MAGIC + JSON.stringify(pkts); }
  function readPcap(text) { if (String(text || "").indexOf(MAGIC) !== 0) return null; try { return JSON.parse(String(text).slice(MAGIC.length)); } catch (e) { return null; } }
  N.pcapFile = pcapFile; N.readPcap = readPcap;

  // The background traffic on kc-web-01's LAN, at "now". Scenarios can add to it (nw.ambientExtra) or replace it.
  function ambient(sys) {
    var t = sys.now / 1000 + 0.118374, me = "10.20.0.15", L = [];
    var nw = sys.nw;
    if (nw.ambient) return nw.ambient(sys, t);
    L.push(arpReq(t, W.MAC.gw, "10.20.0.1", "10.20.0.31"));
    L.push(arpRep(t + 0.0003, W.MAC.backup, "10.20.0.31", W.MAC.gw, "10.20.0.1"));
    L = L.concat(dnsPair(t + 0.21, me, "10.20.0.2", 51003, 7311, "kc-db-01.kestrel.internal", "A", [{ type: "A", data: "10.20.0.21", ttl: 3600 }]));
    L = L.concat(convo({ t: t + 0.42, a: "10.20.0.10", b: me, pa: 39822, pb: 443, ttlB: 64, steps: [{ flags: "S", dt: 0 }, { dir: "<", flags: "S.", dt: 0.0002 }, { flags: ".", dt: 0.0004 }, { flags: "P.", enc: { tls: 22, len: 517, seed: 3 }, dt: 0.0006, appName: "TLS ClientHello" }, { dir: "<", flags: "P.", enc: { tls: 22, len: 1460, seed: 5 }, dt: 0.0019, appName: "TLS ServerHello" }] }));
    L = L.concat(icmpPair(t + 0.71, "10.20.5.10", me, 211, 4410, 64).map(function (p, i) { if (i === 0) { p.eth = { src: W.MAC.gw, dst: W.MY_MAC }; p.ip.ttl = 63; } else p.eth = { src: W.MY_MAC, dst: W.MAC.gw }; return p; }));
    L = L.concat(convo({ t: t + 0.93, a: "10.20.5.22", b: me, pa: 50122, pb: 22, isnA: 1800400, isnB: 922001, steps: [{ flags: "P.", enc: { len: 36, seed: 9 }, dt: 0, appName: "SSH (encrypted)" }, { dir: "<", flags: "P.", enc: { len: 52, seed: 11 }, dt: 0.0003, appName: "SSH (encrypted)" }, { flags: ".", dt: 0.041 }] }).map(function (p) { p.eth = p.ip.src === me ? { src: W.MY_MAC, dst: W.MAC.gw } : { src: W.MAC.gw, dst: W.MY_MAC }; if (p.ip.src !== me) p.ip.ttl = 63; return p; }));
    L.push(udpPkt(t + 1.3, me, "10.20.0.1", 41211, 123, { appName: "NTPv4 request", bin: [0x23, 0, 6, 0x20].concat(new Array(44).fill(0)) }));
    L.push(udpPkt(t + 1.3012, "10.20.0.1", me, 123, 41211, { appName: "NTPv4 reply", bin: [0x24, 2, 6, 0xe9].concat(new Array(44).fill(7)) }));
    L = L.concat(convo({ t: t + 1.52, a: me, b: "10.20.0.21", pa: 51210, pb: 5432, isnA: 7714001, isnB: 6620044, steps: [{ flags: "P.", enc: { len: 94, seed: 21 }, dt: 0, appName: "PostgreSQL query" }, { dir: "<", flags: "P.", enc: { len: 288, seed: 23 }, dt: 0.0009, appName: "PostgreSQL result" }, { flags: ".", dt: 0.0011 }] }));
    (nw.ambientExtra ? nw.ambientExtra(sys, t) : []).forEach(function (p) { L.push(p); });
    L.sort(function (x, y) { return x.t - y.t; });
    return L;
  }
  N.ambient = ambient;

  /* ================================================================== filters (a useful subset of pcap-filter) */
  function FilterError(msg) { this.message = msg; }
  function parseFilter(text) {
    var toks = String(text || "").replace(/\(/g, " ( ").replace(/\)/g, " ) ").replace(/&&/g, " and ").replace(/\|\|/g, " or ").replace(/!/g, " not ").trim().split(/\s+/).filter(Boolean);
    if (!toks.length) return null;
    var pos = 0;
    function peek() { return toks[pos]; }
    function expr() { var l = term(); while (peek() === "or") { pos++; var r = term(); l = { or: [l, r] }; } return l; }
    function term() { var l = factor(); while (peek() === "and" || (peek() && peek() !== "or" && peek() !== ")")) { if (peek() === "and") pos++; var r = factor(); l = { and: [l, r] }; } return l; }
    function factor() {
      var t = peek();
      if (t === "not") { pos++; return { not: factor() }; }
      if (t === "(") { pos++; var e = expr(); if (peek() !== ")") throw new FilterError("syntax error in filter expression"); pos++; return e; }
      return prim();
    }
    function prim() {
      var p = { proto: null, dir: null, type: null, id: null };
      var protos = ["ether", "ip", "ip6", "arp", "tcp", "udp", "icmp", "icmp6", "vlan"], dirs = ["src", "dst"], types = ["host", "net", "port", "portrange"];
      if (protos.indexOf(peek()) >= 0) { p.proto = toks[pos++]; if (p.proto === "vlan" && /^\d+$/.test(peek() || "")) { p.vid = +toks[pos++]; return p; } }
      if (dirs.indexOf(peek()) >= 0) { p.dir = toks[pos++]; if (peek() === "or" && dirs.indexOf(toks[pos + 1]) >= 0) { pos += 2; p.dir = "any"; } }
      if (types.indexOf(peek()) >= 0) p.type = toks[pos++];
      if (p.type || p.dir) {
        if (peek() === undefined) throw new FilterError("syntax error in filter expression");
        p.id = toks[pos++];
        if (!p.type) p.type = p.proto === "ether" ? "host" : /^\d+$/.test(p.id) ? "port" : "host";
        if (p.type === "net" && peek() === "mask") { pos++; p.mask = toks[pos++]; }
        return p;
      }
      if (p.proto) return p;
      var bad = toks[pos++];
      if (/^\d+$/.test(bad)) throw new FilterError("syntax error in filter expression");
      throw new FilterError("can't parse filter expression: syntax error");
    }
    var e = expr();
    if (pos < toks.length) throw new FilterError("syntax error in filter expression");
    return e;
  }
  N.parseFilter = parseFilter;
  function svcPort(id) { if (/^\d+$/.test(id)) return +id; var k = Object.keys(N.SVC).filter(function (x) { return N.SVC[x] === id; })[0]; return k ? +k : -1; }
  function match(sys, e, p) {
    if (!e) return true;
    if (e.or) return match(sys, e.or[0], p) || match(sys, e.or[1], p);
    if (e.and) return match(sys, e.and[0], p) && match(sys, e.and[1], p);
    if (e.not) return !match(sys, e.not, p);
    var src = p.ip ? p.ip.src : p.ip6 ? p.ip6.src : p.arp ? p.arp.spa : null, dst = p.ip ? p.ip.dst : p.ip6 ? p.ip6.dst : p.arp ? p.arp.tpa : null;
    var l4 = p.tcp || p.udp;
    if (e.proto && !e.type) {
      if (e.proto === "tcp") return !!p.tcp; if (e.proto === "udp") return !!p.udp; if (e.proto === "icmp") return !!p.icmp && !p.ip6; if (e.proto === "icmp6") return !!p.icmp && !!p.ip6;
      if (e.proto === "arp") return !!p.arp; if (e.proto === "ip") return !!p.ip; if (e.proto === "ip6") return !!p.ip6; if (e.proto === "vlan") return e.vid ? p.vlan === e.vid : !!p.vlan;
      if (e.proto === "ether") return true;
    }
    if (e.proto === "tcp" && !p.tcp || e.proto === "udp" && !p.udp || e.proto === "ip" && !p.ip || e.proto === "ip6" && !p.ip6 || e.proto === "arp" && !p.arp) return false;
    function dirOk(a, b, f) { if (e.dir === "src") return f(a); if (e.dir === "dst") return f(b); return f(a) || f(b); }
    if (e.type === "host") {
      if (e.proto === "ether") { var mm = e.id.toLowerCase(); return dirOk(p.eth.src, p.eth.dst, function (x) { return x === mm; }); }
      var ip = e.id;
      if (!isV4(ip) && !isV6(ip)) { var g = N.getaddrinfo(sys, ip, 4); if (g.err) throw new FilterError("can't resolve host '" + ip + "'".replace("can't resolve host", "unknown host")); ip = g.ip; }
      return dirOk(src, dst, function (x) { return x === ip || (isV6(ip) && x && N.v6norm(x) === N.v6norm(ip)); });
    }
    if (e.type === "net") {
      var m = /^([\d.]+)(?:\/(\d+))?$/.exec(e.id); if (!m) throw new FilterError("invalid net " + e.id);
      var pre = m[2] ? +m[2] : e.mask ? N.maskToPrefix(e.mask) : 24;
      return dirOk(src, dst, function (x) { return !!x && isV4(x) && N.inNet(x, m[1], pre); });
    }
    if (e.type === "port" || e.type === "portrange") {
      if (!l4) return false;
      var lo, hi;
      if (e.type === "portrange") { var r = /^(\d+)-(\d+)$/.exec(e.id); lo = +r[1]; hi = +r[2]; } else { lo = hi = svcPort(e.id); if (lo < 0) throw new FilterError("unknown port '" + e.id + "'"); }
      return dirOk(l4.sport, l4.dport, function (x) { return x >= lo && x <= hi; });
    }
    return true;
  }
  N.matchFilter = match;

  /* ================================================================== printing */
  function ts(t, mode) {
    if (mode === "t") return "";
    var ms = t * 1000, base = tod(ms) + "." + ("00000" + Math.round((t % 1) * 1e6)).slice(-6);
    if (mode === "tttt") return M2.ymd(ms) + " " + base;
    return base;
  }
  function nm(sys, ip, numeric) { if (numeric) return ip; return W.NAMES[ip] || ip; }
  function port(p, numeric, udp) { if (numeric) return String(p); var n = N.SVC[p]; return n ? (p === 53 ? "domain" : n) : String(p); }
  function seqTrack() { return {}; }
  function decodeLine(sys, p, o, track, enc) {
    var n = o.n, line = "", sub = [];
    var eth = p.eth;
    var etName = p.arp ? "ARP (0x0806)" : p.ip6 ? "IPv6 (0x86dd)" : "IPv4 (0x0800)";
    var flen = enc.bytes.length;
    if (o.e) line += eth.src + " > " + eth.dst + ", ethertype " + (p.vlan ? "802.1Q (0x8100), length " + flen + ": vlan " + p.vlan + ", p 0, ethertype " + etName + ", " : etName + ", length " + flen + ": ");
    if (p.arp) {
      var a = p.arp;
      if (!o.e) line += "ARP, ";
      line += a.op === "reply" ? "Reply " + nm(sys, a.spa, n) + " is-at " + a.sha + ", length " + (o.e ? 28 : 28) : "Request who-has " + nm(sys, a.tpa, n) + (a.tha && a.tha !== "00:00:00:00:00:00" ? " (" + a.tha + ")" : "") + " tell " + nm(sys, a.spa, n) + ", length 28";
      if (o.e) line = line.replace(/^(.*?ethertype ARP \(0x0806\), length \d+: )/, "$1" + (o.v ? "Ethernet (len 6), IPv4 (len 4), " : ""));
      return { line: line, sub: sub };
    }
    var ip = p.ip || p.ip6, v6 = !!p.ip6;
    var ipTot = enc.bytes.length - (p.vlan ? 18 : 14);
    if (!o.e) line += v6 ? "IP6 " : "IP ";
    if (o.v) {
      var proto = p.tcp ? "TCP (6)" : p.udp ? "UDP (17)" : v6 ? "ICMPv6 (58)" : "ICMP (1)";
      if (v6) line += "(flowlabel 0x0, hlim " + (ip.hlim || 64) + ", next-header " + proto.replace(/ \(\d+\)/, "") + " (" + (p.tcp ? 6 : p.udp ? 17 : 58) + ") payload length: " + (ipTot - 40) + ") ";
      else line += "(tos 0x" + (ip.tos || 0).toString(16) + ", ttl " + (ip.ttl || 64) + ", id " + (ip.id || 0) + ", offset 0, flags [" + (ip.df === false ? "none" : "DF") + "], proto " + proto + ", length " + ipTot + ")";
    }
    var srcA = ip.src, dstA = ip.dst;
    var head = o.v && !v6 ? "\n    " : "";
    if (p.tcp || p.udp) {
      var l4 = p.tcp || p.udp;
      line += head + nm(sys, srcA, n) + "." + port(l4.sport, n || o.nn) + " > " + nm(sys, dstA, n) + "." + port(l4.dport, n || o.nn) + ": ";
    } else line += head + nm(sys, srcA, n) + " > " + nm(sys, dstA, n) + ": ";
    var ck = function (at) { var hi = enc.bytes[at], lo = enc.bytes[at + 1]; return "cksum 0x" + ("000" + ((hi << 8) | lo).toString(16)).slice(-4) + " (correct), "; };
    var l4start = enc.spans.filter(function (s) { return s.l === 4; })[0];
    if (p.tcp) {
      var t = p.tcp, key = [srcA, t.sport, dstA, t.dport].join("|"), rkey = [dstA, t.dport, srcA, t.sport].join("|");
      if (/S/.test(t.flags) && !/\./.test(t.flags)) track[key] = t.seq;
      if (/S\./.test(t.flags)) { track[key] = t.seq; }
      var pl = enc.paylen;
      var fl = "Flags [" + t.flags + "]";
      var rel = track[key] !== undefined && !/S/.test(t.flags) && !o.S;
      var seqS = /S/.test(t.flags) ? "seq " + (t.seq >>> 0) : pl ? "seq " + (rel ? (t.seq - track[key]) >>> 0 : t.seq >>> 0) + ":" + ((rel ? (t.seq - track[key]) : t.seq) + pl >>> 0) : null;
      var ackS = /\./.test(t.flags) ? "ack " + (track[rkey] !== undefined && !o.S && !/S/.test(t.flags) ?(t.ack - track[rkey]) >>> 0 : t.ack >>> 0) : null;
      var optS = /S/.test(t.flags) ? "options [mss " + (t.mss || 1460) + ",sackOK,TS val " + t.tsval + " ecr " + (t.tsecr || 0) + ",nop,wscale " + (t.wscale == null ? 7 : t.wscale) + "]" : "options [nop,nop,TS val " + t.tsval + " ecr " + t.tsecr + "]";
      line += [fl].concat(o.v ? [ck(l4start.from + 16).replace(/, $/, "")] : []).concat([seqS, ackS, "win " + (t.win == null ? 502 : t.win), optS, "length " + pl]).filter(Boolean).join(", ");
      if (pl && p.data != null) {
        var first = String(p.data).split("\r\n")[0];
        if (/^(GET|POST|PUT|DELETE|HEAD|OPTIONS|PATCH) |^HTTP\/1\.[01] /.test(first)) { line += ": HTTP" + (o.v ? ", length: " + pl : ": " + first); if (o.v) String(p.data).split("\r\n").forEach(function (l, i, arr) { if (i === arr.length - 1 && l === "") return; sub.push("\t" + l); }); }
        else if (o.v) line += ": " + (p.appName || "");
      } else if (pl && p.appName && o.v) line += ": " + p.appName;
    } else if (p.udp) {
      if (p.dns) {
        var d = p.dns;
        if (!d.resp) line += d.id + "+ " + (o.v ? "[1au] " : "") + d.qt + "? " + d.q.replace(/\.?$/, ".") + " (" + (enc.paylen) + ")";
        else line += d.id + (d.rcode && d.rcode !== "NOERROR" ? " " + d.rcode : "") + " " + (d.an || []).length + "/0/" + (o.v ? 1 : 0) + " " + (d.an || []).map(function (x) { return x.type + " " + x.data.replace(/\.?$/, x.type === "A" || x.type === "AAAA" ? "" : "."); }).join(", ") + " (" + enc.paylen + ")";
      } else if (p.appName && /^NTP/.test(p.appName)) line += (o.v ? ck(l4start.from + 6) : "") + "NTPv4, " + (/request/.test(p.appName) ? "Client" : "Server") + ", length 48";
      else if (p.appName && /QUIC/.test(p.appName)) line += (o.v ? ck(l4start.from + 6) : "") + "UDP, length " + enc.paylen + (o.v ? "" : "");
      else line += (o.v ? ck(l4start.from + 6) : "") + "UDP, length " + enc.paylen;
    } else if (p.icmp) {
      var ic = p.icmp, ilen = enc.l4len + enc.paylen;
      if (v6) line += "ICMP6, " + (ic.type === 128 ? "echo request" : ic.type === 129 ? "echo reply" : ic.type === 134 ? "router advertisement" : ic.type === 135 ? "neighbor solicitation" : ic.type === 136 ? "neighbor advertisement" : "type " + ic.type) + (ic.type >= 128 && ic.type <= 129 ? ", id " + ic.id + ", seq " + ic.seq : "") + ", length " + ilen;
      else line += "ICMP " + (ic.type === 8 ? "echo request" : ic.type === 0 ? "echo reply" : ic.type === 11 ? "time exceeded in-transit" : ic.type === 3 ? (ic.code === 4 ? dstA + " unreachable - need to frag (mtu 1400)" : nm(sys, ic.orig || dstA, n) + " udp port " + (ic.port || 33434) + " unreachable") : "type " + ic.type) + (ic.type === 8 || ic.type === 0 ? ", id " + ic.id + ", seq " + ic.seq : "") + ", length " + ilen;
    }
    return { line: line, sub: sub };
  }
  function hexDump(bytes, from) {
    var L = [];
    var b = bytes.slice(from);
    for (var off = 0; off < b.length; off += 16) {
      var row = b.slice(off, off + 16), words = [];
      for (var j = 0; j < row.length; j += 2) words.push(("0" + row[j].toString(16)).slice(-2) + (j + 1 < row.length ? ("0" + row[j + 1].toString(16)).slice(-2) : ""));
      L.push("\t0x" + ("000" + off.toString(16)).slice(-4) + ":  " + rpad(words.join(" "), 40) + "  " + row.map(function (c) { return c >= 32 && c < 127 ? String.fromCharCode(c) : "."; }).join(""));
    }
    return L;
  }
  // What the visual panel shows for one packet: its layers, fields and bytes
  function describe(sys, p) {
    var e = encode(p), layers = [];
    var ethF = [["Destination MAC", p.eth.dst], ["Source MAC", p.eth.src]];
    if (p.vlan) ethF.push(["VLAN tag", "802.1Q, VLAN " + p.vlan]);
    ethF.push(["EtherType", p.arp ? "0x0806 (ARP)" : p.ip6 ? "0x86dd (IPv6)" : "0x0800 (IPv4)"]);
    layers.push({ l: 2, name: "Ethernet frame", unit: "frame", fields: ethF, span: 0 });
    if (p.arp) { var a = p.arp; layers.push({ l: 2, span: 1, name: "ARP " + a.op, unit: "", fields: [["Operation", a.op === "reply" ? "2 (reply)" : "1 (request)"], ["Sender MAC", a.sha], ["Sender IP", a.spa], ["Target MAC", a.tha || "00:00:00:00:00:00"], ["Target IP", a.tpa]] }); }
    else {
      var ip = p.ip || p.ip6;
      layers.push({ l: 3, name: p.ip6 ? "IPv6 packet" : "IPv4 packet", unit: "packet", fields: p.ip6 ? [["Source", ip.src], ["Destination", ip.dst], ["Hop limit", String(ip.hlim || 64)], ["Next header", p.tcp ? "6 (TCP)" : p.udp ? "17 (UDP)" : "58 (ICMPv6)"]] : [["Source IP", ip.src], ["Destination IP", ip.dst], ["TTL", String(ip.ttl || 64)], ["Protocol", p.tcp ? "6 (TCP)" : p.udp ? "17 (UDP)" : "1 (ICMP)"], ["ID / flags", (ip.id || 0) + " / " + (ip.df === false ? "none" : "DF")]] });
      if (p.tcp) layers.push({ l: 4, name: "TCP segment", unit: "segment", fields: [["Source port", String(p.tcp.sport)], ["Destination port", p.tcp.dport + (N.SVC[p.tcp.dport] ? " (" + N.SVC[p.tcp.dport] + ")" : "")], ["Flags", flagWords(p.tcp.flags)], ["Sequence", String(p.tcp.seq >>> 0)], ["Window", String(p.tcp.win == null ? 502 : p.tcp.win)]] });
      if (p.udp) layers.push({ l: 4, name: "UDP datagram", unit: "datagram", fields: [["Source port", String(p.udp.sport)], ["Destination port", p.udp.dport + (N.SVC[p.udp.dport] ? " (" + N.SVC[p.udp.dport] + ")" : "")], ["Length", String(8 + e.paylen)]] });
      if (p.icmp) layers.push({ l: 3, name: p.ip6 ? "ICMPv6" : "ICMP message", unit: "", fields: [["Type", p.icmp.type + (p.icmp.type === 8 ? " (echo request)" : p.icmp.type === 0 ? " (echo reply)" : "")], ["Id / seq", p.icmp.id + " / " + p.icmp.seq]] });
      if (e.paylen) {
        var app = p.dns ? [["Query", (p.dns.qt || "A") + " " + p.dns.q], ["Answers", (p.dns.an || []).map(function (x) { return x.data; }).join(", ") || (p.dns.resp ? "none" : "(question)")]] : p.data != null ? String(p.data).split("\r\n").filter(Boolean).slice(0, 4).map(function (l, i) { return [i ? "Header" : "First line", l]; }) : [["Data", p.appName || e.paylen + " bytes"]];
        var spanP = e.spans[e.spans.length - 1];
        layers.push({ l: spanP.l, name: spanP.name, unit: "data", fields: app });
      }
      // each layer after Ethernet owns the next span of bytes (IP header, then TCP/UDP/ICMP header, then the data)
      layers.forEach(function (l, i) { if (i > 0) l.span = i; });
    }
    return { layers: layers, bytes: e.bytes, spans: e.spans, summary: decodeLine(sys, p, { n: true }, {}, e).line };
  }
  function flagWords(f) { var w = { S: "SYN", ".": "ACK", P: "PSH", F: "FIN", R: "RST", U: "URG" }; return f + " (" + String(f).split("").map(function (c) { return w[c] || c; }).join(", ") + ")"; }
  N.describe = describe;

  /* ================================================================== tcpdump */
  CMDS.tcpdump = function (args, io, sess) {
    var sys = sess.sys, a = args.slice(1), o = { c: null, i: null, r: null, w: null, e: false, n: false, v: 0, X: 0, x: 0, A: false, tmode: null, q: false, S: false }, filt = [];
    for (var i = 0; i < a.length; i++) {
      var x = a[i];
      if (x === "-c") o.c = +a[++i]; else if (x === "-i" || x === "--interface") o.i = a[++i]; else if (x === "-r") o.r = a[++i]; else if (x === "-w") o.w = a[++i];
      else if (x === "-s" || x === "-W" || x === "-C" || x === "-G" || x === "-B" || x === "-F") i++;
      else if (x === "-D" || x === "--list-interfaces") { out(io, "1.eth0 [Up, Running, Connected]\n2.any (Pseudo-device that captures on all interfaces) [Up, Running]\n3.lo [Up, Running, Loopback]\n" + N.ifList(sys.nw).filter(function (d) { return d.kind !== "loopback" && d.name !== "eth0"; }).map(function (d, k) { return (k + 4) + "." + d.name + " [Up" + (N.linkOf(sys.nw, d).carrier ? ", Running, Connected" : "") + "]\n"; }).join("") + "4.bluetooth-monitor (Bluetooth Linux Monitor) [Wireless]\n".replace(/^4/, "9")); return 0; }
      else if (x === "--version" || x === "-h" || x === "--help") { out(io, "tcpdump version 4.99.4\nlibpcap version 1.10.4 (with TPACKET_V3)\nOpenSSL 3.0.13 30 Jan 2024\nUsage: tcpdump [-AbdDefhHIJKlLnNOpqStuUvxX#] [ -B size ] [ -c count ] [--count]\n\t\t[ -C file_size ] [ -E algo:secret ] [ -F file ] [ -G seconds ]\n\t\t[ -i interface ] [ --immediate-mode ] [ -j tstamptype ]\n\t\t[ -M secret ] [ --number ] [ --print ] [ -Q in|out|inout ]\n\t\t[ -r file ] [ -s snaplen ] [ -T type ] [ --version ]\n\t\t[ -V file ] [ -w file ] [ -W filecount ] [ -y datalinktype ]\n\t\t[ --time-stamp-precision precision ] [ --micro ] [ --nano ]\n\t\t[ -z postrotate-command ] [ -Z user ] [ expression ]\n"); return 0; }
      else if (/^-[envXxAtqSlp#]+$/.test(x)) x.slice(1).split("").forEach(function (c) { if (c === "e") o.e = true; else if (c === "n") { if (o.n) o.nn = true; o.n = true; } else if (c === "v") o.v++; else if (c === "X") o.X++; else if (c === "x") o.x++; else if (c === "A") o.A = true; else if (c === "t") o.tmode = o.tmode === "t" ? "tt" : o.tmode === "tt" ? "ttt" : o.tmode === "ttt" ? "tttt" : "t"; else if (c === "q") o.q = true; else if (c === "S") o.S = true; });
      else if (x === "-nn") { o.n = true; o.nn = true; }
      else if (/^-/.test(x)) { errl(io, "tcpdump: invalid option -- '" + x.replace(/^-+/, "").charAt(0) + "'"); return 1; }
      else filt.push(x);
    }
    var fexpr;
    try { fexpr = parseFilter(filt.join(" ")); } catch (e) { if (e instanceof FilterError) { errl(io, "tcpdump: " + e.message); return 1; } throw e; }
    var pkts, src;
    if (o.r) {
      var rf = S.readFile(sess, o.r);
      if (rf.error) { errl(io, "tcpdump: " + o.r + ": " + (rf.error === "ENOENT" ? "No such file or directory" : S.ERRTEXT[rf.error])); return 1; }
      pkts = readPcap(rf.content);
      if (!pkts) { errl(io, "tcpdump: " + o.r + ": unknown file format"); return 1; }
      src = "file";
      errl(io, "reading from file " + o.r + ", link-type EN10MB (Ethernet), snapshot length 262144");
    } else {
      if (sess.uid !== 0) { errl(io, "tcpdump: " + (o.i || "eth0") + ": You don't have permission to perform this capture on that device\n(socket: Operation not permitted)"); return 1; }
      var dev = o.i || "eth0";
      if (dev !== "any" && !sys.nw.ifs[dev]) { errl(io, "tcpdump: " + dev + ": No such device exists\n(No such device exists)"); return 1; }
      var d = sys.nw.ifs[dev], up = dev === "any" || dev === "lo" || (d && N.linkOf(sys.nw, d).carrier);
      if (d && !d.admin) { errl(io, "tcpdump: " + dev + ": That device is not up"); return 1; }
      pkts = up && dev !== "lo" ? ambient(sys) : [];
      if (d && d.kind === "vlan") pkts = (sys.nw.vlanAmbient ? sys.nw.vlanAmbient(sys, dev) : []);
      src = "live";
      errl(io, (o.v || o.w ? "tcpdump: " : "tcpdump: verbose output suppressed, use -v[v]... for full protocol decode\n") + "listening on " + dev + ", link-type " + (dev === "any" ? "LINUX_SLL2 (Linux cooked v2)" : "EN10MB (Ethernet)") + ", snapshot length 262144 bytes");
    }
    var sel = [];
    try { pkts.forEach(function (p) { if (match(sys, fexpr, p)) sel.push(p); }); } catch (e) { if (e instanceof FilterError) { errl(io, "tcpdump: " + e.message); return 1; } throw e; }
    if (o.c != null) sel = sel.slice(0, o.c);
    if (o.w) {
      var we = S.writeFile(sess, o.w, pcapFile(sel));
      if (we) { errl(io, "tcpdump: " + o.w + ": " + S.ERRTEXT[we]); return 1; }
      if (src === "live") { if (o.c == null) out(io, "^C"); errl(io, (o.c == null ? "" : "") + sel.length + " packets captured\n" + sel.length + " packets received by filter\n0 packets dropped by kernel"); }
      ev(sys, { k: "pkt", pkts: sel.slice(0, 1).map(function (p) { return describe(sys, p); }), count: sel.length, saved: o.w, layer: 2 });
      return 0;
    }
    var track = seqTrack(), L = [], first = sel.length ? sel[0].t : 0, prev = first;
    sel.forEach(function (p) {
      var enc = encode(p), dl = decodeLine(sys, p, o, track, enc);
      var stamp = o.tmode === "ttt" ? "00:00:00." + ("00000" + Math.round((p.t - prev) * 1e6)).slice(-6) : o.tmode === "tt" ? String(Math.floor(p.t)) + "." + ("00000" + Math.round((p.t % 1) * 1e6)).slice(-6) : ts(p.t, o.tmode);
      prev = p.t;
      L.push((stamp ? stamp + " " : "") + dl.line);
      if (o.X || o.x) { var from = o.X >= 2 || o.x >= 2 ? 0 : (p.vlan ? 18 : 14); var hd = hexDump(enc.bytes, from); if (!o.X) hd = hd.map(function (l) { return l.replace(/\s{2}\S*$/, "").replace(/\s+$/, ""); }); L = L.concat(hd); }
      else if (o.A && p.data != null) L = L.concat(String(p.data).split("\r\n").map(function (l) { return l; }));
      else L = L.concat(dl.sub);
    });
    out(io, joinLines(L));
    if (src === "live") {
      if (o.c == null) { out(io, "^C\n"); note(io, "(tcpdump keeps capturing until you press Ctrl+C; the lab stopped it here. -c N stops after N packets.)"); }
      errl(io, sel.length + " packets captured\n" + (sel.length + (o.c == null ? 0 : 2)) + " packets received by filter\n0 packets dropped by kernel");
    }
    ev(sys, { k: "pkt", pkts: sel.slice(0, 40).map(function (p) { return describe(sys, p); }), count: sel.length, file: o.r || null, layer: 2 });
    return 0;
  };
})(typeof window !== "undefined" ? window : globalThis);
