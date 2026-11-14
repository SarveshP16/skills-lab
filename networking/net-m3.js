/* sudo learn — Networking Module 3: attacks and detection. dmesg; SYN floods (backlog, SYN cookies); Suricata
   (rules with content/http/dns/tls buffers, flow, flags, thresholds; fast.log and eve.json from a capture); Zeek
   (conn, dns, http, ssl, ssh and ftp logs from a capture, zeek-cut). ARP spoofing, rogue DHCP and DNS cache
   poisoning are scenario state that net-core/net-apps/net-m2 read (nw.arpSpoof, nw.rogueDhcp, nw.poison). */
(function (root) {
  "use strict";
  var S = root.ShEngine, U = S.util, CMDS = S.CMDS, M2 = S.M2, N = M2.NET, W = N.W;
  var out = U.out, errl = U.errl, note = U.note, lines = U.lines, joinLines = U.joinLines, pad = U.pad, rpad = U.rpad, bytes = U.bytes;
  var rd = M2.rd, putRoot = M2.putRoot, hash = M2.hash, tod = M2.tod, NOW = S.NOW, DAY = S.DAY;
  var isV4 = N.isV4;

  /* ================================================================== dmesg */
  var BOOT = NOW - 2 * DAY - 4 * 3600000;
  CMDS.dmesg = function (args, io, sess) {
    if (sess.uid !== 0) { errl(io, "dmesg: read kernel buffer failed: Operation not permitted"); return 1; }
    var human = args.indexOf("-T") >= 0 || args.indexOf("--ctime") >= 0;
    var L = (sess.sys.journal || []).filter(function (e) { return e.ident === "kernel"; }).sort(function (a, b) { return a.t - b.t; }).map(function (e) {
      var s = Math.max(0, (e.t - BOOT) / 1000);
      return human ? "[" + new Date(e.t).toUTCString().replace(/^(\w+), (\d+) (\w+) (\d+) ([\d:]+) GMT$/, "$1 $3 $2 $5 $4") + "] " + e.msg : "[" + pad(s.toFixed(6), 12) + "] " + e.msg;
    });
    out(io, joinLines(L));
    return 0;
  };

  /* ================================================================== SYN floods */
  // nw.synFlood = { port, count }: the listen queue is full of half-open connections from spoofed sources.
  function floodRows(sys) {
    var f = sys.nw.synFlood, rows = [];
    for (var i = 0; i < f.count; i++) { var h = hash("flood" + i) >>> 0; rows.push({ proto: "tcp", state: "SYN-RECV", local: "10.20.0.15", lport: f.port, peer: (h % 200 + 20) + "." + ((h >>> 8) % 250 + 1) + "." + ((h >>> 16) % 250 + 1) + "." + ((h >>> 4) % 250 + 1), pport: 1024 + (h % 60000) }); }
    return rows;
  }
  S.POST_HOOKS.push(function (sys) {
    var nw = sys.nw; if (!nw || !nw.synFlood) return;
    nw.conns = (nw.conns || []).concat(floodRows(sys));
    M2.jadd(sys, "kernel", null, "TCP: request_sock_TCP: Possible SYN flooding on port 10.20.0.15:" + nw.synFlood.port + ". " + (nw.sysctl["net.ipv4.tcp_syncookies"] === "1" ? "Sending cookies." : "Dropping request.") + "  Check SNMP counters.", null, 4, NOW - 7 * 60000);
    var prevAmb = nw.ambientExtra;
    nw.ambientExtra = function (s, t) {
      var L = prevAmb ? prevAmb(s, t) : [];
      for (var i = 0; i < 12; i++) { var r = floodRows(s)[i]; L.push({ t: t + 0.0101 * i, eth: { src: W.MAC.gw, dst: W.MY_MAC }, ip: { src: r.peer, dst: "10.20.0.15", ttl: 240 + (i % 10), id: 54321 }, tcp: { sport: r.pport, dport: r.lport, flags: "S", seq: hash("s" + i), ack: 0, win: 1024, ts: false, tsval: 0, tsecr: 0, mss: 1460 } }); }
      return L;
    };
  });
  // a full backlog without SYN cookies drops new connections to that port
  var preTcpPrev = N.preTcp;
  N.preTcp = function (sys, ip, port, proto) {
    var f = sys.nw && sys.nw.synFlood;
    if (f && port === f.port && (N.isOwn(sys.nw, ip) || ip === W.PUB) && sys.nw.sysctl["net.ipv4.tcp_syncookies"] !== "1") { var r = N.reach(sys, ip, { quiet: true }); return { err: "timeout", r: r, flood: true }; }
    return preTcpPrev ? preTcpPrev(sys, ip, port, proto) : null;
  };

  /* ================================================================== flows: shared by Suricata and Zeek */
  function flows(pkts) {
    var map = {}, list = [];
    pkts.forEach(function (p, i) {
      if (!p.ip) return;
      var l4 = p.tcp || p.udp, proto = p.tcp ? "tcp" : p.udp ? "udp" : p.icmp ? "icmp" : "ip";
      var sp = l4 ? l4.sport : p.icmp ? p.icmp.type : 0, dp = l4 ? l4.dport : p.icmp ? p.icmp.code || 0 : 0;
      var a = p.ip.src + ":" + sp, b = p.ip.dst + ":" + dp, key = proto + "|" + (a < b ? a + "|" + b : b + "|" + a);
      if (proto === "icmp") key = "icmp|" + [p.ip.src, p.ip.dst].sort().join("|") + "|" + (p.icmp.id || 0);
      var f = map[key];
      if (!f) {
        // the side that sent the first packet is the originator (for TCP, the one that sent the SYN)
        var origIsSrc = !(p.tcp && /S\./.test(p.tcp.flags));
        f = map[key] = { key: key, proto: proto, oh: origIsSrc ? p.ip.src : p.ip.dst, op: origIsSrc ? sp : dp, rh: origIsSrc ? p.ip.dst : p.ip.src, rp: origIsSrc ? dp : sp, t0: p.t, t1: p.t, pk: [], hist: "", ob: 0, rb: 0, opk: 0, rpk: 0, oib: 0, rib: 0, syn: false, synack: false, rst: null, fin: 0 };
        list.push(f);
      }
      var fromOrig = p.ip.src === f.oh && (sp === f.op || proto === "icmp");
      var e = N.encode(p), len = e.paylen;
      f.t1 = p.t; f.pk.push({ p: p, o: fromOrig, i: i });
      if (fromOrig) { f.ob += len; f.opk++; f.oib += e.bytes.length - 14; } else { f.rb += len; f.rpk++; f.rib += e.bytes.length - 14; }
      if (p.tcp) {
        var fl = p.tcp.flags, h = function (c) { var ch = fromOrig ? c : c.toLowerCase(); if (f.hist.indexOf(ch) < 0) f.hist += ch; };
        if (/S/.test(fl) && !/\./.test(fl)) { f.syn = true; h("S"); }
        else if (/S\./.test(fl)) { f.synack = true; h("H"); }
        if (/\./.test(fl) && !/S/.test(fl) && !len) h("A");
        if (len) h("D");
        if (/F/.test(fl)) { h("F"); f.fin++; }
        if (/R/.test(fl)) { h("R"); f.rst = fromOrig ? "o" : "r"; }
      }
    });
    list.forEach(function (f) {
      if (f.proto !== "tcp") { f.state = f.rpk ? "SF" : "S0"; return; }
      f.state = f.syn && !f.synack && !f.rst ? "S0" : f.syn && f.rst === "r" && !f.synack ? "REJ" : f.rst === "o" ? "RSTO" : f.rst === "r" ? "RSTR" : f.syn && f.synack && f.fin >= 2 ? "SF" : f.syn && f.synack ? "S1" : "OTH";
      f.service = serviceOf(f);
    });
    list.forEach(function (f) { if (!f.service) f.service = serviceOf(f); });
    return list;
  }
  function serviceOf(f) {
    var ps = f.pk.map(function (x) { return x.p; });
    if (ps.some(function (p) { return p.dns; })) return "dns";
    if (ps.some(function (p) { return p.dhcp; })) return "dhcp";
    if (ps.some(function (p) { return p.snmp; })) return "snmp";
    if (ps.some(function (p) { return p.appName && /NTP/.test(p.appName); })) return "ntp";
    if (ps.some(function (p) { return p.data != null && /^(GET|POST|PUT|HEAD|DELETE) \S+ HTTP\/1/.test(p.data); })) return "http";
    if (ps.some(function (p) { return p.enc && p.enc.tls; })) return "ssl";
    if (ps.some(function (p) { return p.data != null && /^SSH-2\.0/.test(p.data); }) || (f.rp === 22 || f.rp === 2222) && ps.some(function (p) { return p.enc; })) return "ssh";
    if (f.rp === 21 && ps.some(function (p) { return p.data != null; })) return "ftp";
    if (f.rp === 25 && ps.some(function (p) { return p.data != null; })) return "smtp";
    if (f.rp === 3306 && ps.some(function (p) { return p.enc || p.data; })) return "mysql";
    if (f.rp === 6379 && ps.some(function (p) { return p.data != null; })) return "redis";
    if (f.rp === 23 && ps.some(function (p) { return p.data != null; })) return null;
    return null;
  }
  N.flows = flows;
  function uid(seed) { var c = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789", s = "C", h = hash("uid" + seed); for (var i = 0; i < 17; i++) { s += c.charAt(h % 62); h = hash(h + "x" + i); } return s; }
  function httpParts(data) {
    var t = String(data || ""), head = t.split("\r\n\r\n")[0], L = head.split("\r\n"), first = L[0] || "", h = {};
    L.slice(1).forEach(function (l) { var m = /^([^:]+):\s*(.*)$/.exec(l); if (m) h[m[1].toLowerCase()] = m[2]; });
    var m = /^(\w+) (\S+) HTTP\/(\d\.\d)$/.exec(first), r = /^HTTP\/(\d\.\d) (\d+) ?(.*)$/.exec(first);
    var body = t.indexOf("\r\n\r\n") >= 0 ? t.slice(t.indexOf("\r\n\r\n") + 4) : "";
    return { req: !!m, method: m && m[1], uri: m && m[2], version: m ? m[3] : r && r[1], status: r && +r[2], msg: r && r[3], h: h, body: body };
  }

  /* ================================================================== Suricata */
  var CLASSES = { "attempted-recon": [2, "Attempted Information Leak"], "network-scan": [3, "Detection of a Network Scan"], "web-application-attack": [1, "Web Application Attack"], "policy-violation": [1, "Potential Corporate Privacy Violation"], "bad-unknown": [2, "Potentially Bad Traffic"], "attempted-admin": [1, "Attempted Administrator Privilege Gain"], "trojan-activity": [1, "A Network Trojan was detected"], "misc-activity": [3, "Misc activity"], "successful-admin": [1, "Successful Administrator Privilege Gain"], "unsuccessful-user": [1, "Unsuccessful User Privilege Gain"], "protocol-command-decode": [3, "Generic Protocol Command Decode"], "credential-theft": [1, "Successful Credential Theft Detected"] };
  var KEYWORDS = ["msg", "content", "nocase", "depth", "offset", "distance", "within", "http.uri", "http_uri", "http.user_agent", "http_user_agent", "http.method", "http_method", "http.host", "http_host", "http.request_body", "dns.query", "dns_query", "tls.sni", "tls_sni", "flow", "flags", "threshold", "detection_filter", "sid", "rev", "classtype", "priority", "metadata", "reference", "pcre", "dsize", "itype", "icode", "fast_pattern", "app-layer-protocol", "target", "flowbits", "noalert", "bsize"];
  var BUF = { "http.uri": "http.uri", http_uri: "http.uri", "http.user_agent": "http.user_agent", http_user_agent: "http.user_agent", "http.method": "http.method", http_method: "http.method", "http.host": "http.host", http_host: "http.host", "http.request_body": "http.request_body", "dns.query": "dns.query", dns_query: "dns.query", "tls.sni": "tls.sni", tls_sni: "tls.sni" };
  function RuleError(m) { this.message = m; }
  function unhex(s) { return s.replace(/\|([0-9a-fA-F ]+)\|/g, function (m0, h) { return h.trim().split(/\s+/).map(function (x) { return String.fromCharCode(parseInt(x, 16)); }).join(""); }); }
  function parseRule(line) {
    var m = /^(alert|drop|pass|reject)\s+(\S+)\s+(\S+)\s+(\S+)\s+(->|<>)\s+(\S+)\s+(\S+)\s+\((.*)\)\s*$/.exec(line.trim());
    if (!m) throw new RuleError("detect-parse: Error parsing signature header: \"" + line.trim().slice(0, 60) + "\"");
    var r = { action: m[1], proto: m[2].toLowerCase(), src: m[3], sport: m[4], dir: m[5], dst: m[6], dport: m[7], contents: [], raw: line.trim() };
    var body = m[8], opts = [], cur = "", q = false;
    for (var i = 0; i < body.length; i++) { var c = body.charAt(i); if (c === "\\" && i + 1 < body.length) { cur += body.charAt(++i); continue; } if (c === "\"") q = !q; if (c === ";" && !q) { if (cur.trim()) opts.push(cur.trim()); cur = ""; continue; } cur += c; }
    if (cur.trim()) opts.push(cur.trim());
    var buf = null;
    opts.forEach(function (o) {
      var mm = /^([\w.\-]+)\s*(?::\s*(.*))?$/.exec(o);
      if (!mm) throw new RuleError("detect-parse: unknown rule keyword '" + o + "'.");
      var k = mm[1], v = mm[2] === undefined ? null : mm[2].trim(), sv = v && /^".*"$/.test(v) ? v.slice(1, -1) : v;
      if (KEYWORDS.indexOf(k) < 0) throw new RuleError("detect-parse: unknown rule keyword '" + k + "'.");
      if (BUF[k] && /\./.test(k)) { buf = BUF[k]; return; }
      if (BUF[k]) { if (r.contents.length) r.contents[r.contents.length - 1].buf = BUF[k]; return; }
      if (k === "content") { if (sv === null) throw new RuleError("detect-content: content keyword needs a value"); var neg = /^!/.test(v); r.contents.push({ str: unhex(sv.replace(/^!"|^"|"$/g, "")), neg: neg, buf: buf, nocase: false }); return; }
      if (k === "nocase") { if (!r.contents.length) throw new RuleError("detect-nocase: nocase needs a preceding content option"); r.contents[r.contents.length - 1].nocase = true; return; }
      if (k === "pcre") { var pm = /^"\/(.*)\/([ismxUR]*)"$/.exec(v || ""); if (!pm) throw new RuleError("detect-pcre: pcre parse error"); r.pcre = { re: new RegExp(pm[1], pm[2].replace(/[^is]/g, "")), buf: buf }; return; }
      if (k === "msg") r.msg = sv; else if (k === "sid") r.sid = +v; else if (k === "rev") r.rev = +v; else if (k === "classtype") { if (!CLASSES[v]) throw new RuleError("detect-classtype: unknown classtype: \"" + v + "\""); r.classtype = v; } else if (k === "priority") r.priority = +v;
      else if (k === "flow") r.flow = v.split(",").map(function (x) { return x.trim(); });
      else if (k === "flags") r.flags = v;
      else if (k === "threshold" || k === "detection_filter") { var t = {}; v.split(",").forEach(function (x) { var p2 = x.trim().split(/\s+/); t[p2[0]] = p2[1]; }); r.threshold = { type: k === "detection_filter" ? "detection_filter" : t.type, track: t.track || "by_src", count: +t.count, seconds: +t.seconds }; }
      else if (k === "dsize") r.dsize = v; else if (k === "itype") r.itype = +v;
    });
    if (!r.sid) throw new RuleError("detect-parse: Signature missing required value \"sid\".");
    if (!r.msg) r.msg = "";
    return r;
  }
  function addrMatch(spec, ip, vars) {
    spec = String(spec);
    if (/^\$/.test(spec)) spec = vars[spec.slice(1)] || "any";
    if (spec === "any") return true;
    if (/^!/.test(spec)) return !addrMatch(spec.slice(1), ip, vars);
    if (/^\[.*\]$/.test(spec)) { var items = spec.slice(1, -1).split(","), pos = items.filter(function (x) { return !/^!/.test(x.trim()); }), neg = items.filter(function (x) { return /^!/.test(x.trim()); }); return (pos.length ? pos.some(function (x) { return addrMatch(x.trim(), ip, vars); }) : true) && !neg.some(function (x) { return addrMatch(x.trim().slice(1), ip, vars); }); }
    var mm = /^([\d.]+)(?:\/(\d+))?$/.exec(spec);
    return !!mm && isV4(ip) && N.inNet(ip, mm[1], mm[2] ? +mm[2] : 32);
  }
  function portMatch(spec, port, vars) {
    spec = String(spec);
    if (/^\$/.test(spec)) spec = vars[spec.slice(1)] || "any";
    if (spec === "any") return true;
    if (/^!/.test(spec)) return !portMatch(spec.slice(1), port, vars);
    if (/^\[.*\]$/.test(spec)) return spec.slice(1, -1).split(",").some(function (x) { return portMatch(x.trim(), port, vars); });
    var r = /^(\d*):(\d*)$/.exec(spec); if (r) return port >= (r[1] ? +r[1] : 0) && port <= (r[2] ? +r[2] : 65535);
    return +spec === port;
  }
  function suriConf(sys) {
    var y = rd(sys, "/etc/suricata/suricata.yaml") || "", vars = { HOME_NET: "[10.20.0.0/24]", EXTERNAL_NET: "!$HOME_NET", HTTP_PORTS: "[80,8080,8081]" }, files = [];
    var mh = /HOME_NET:\s*"([^"]+)"/.exec(y); if (mh) vars.HOME_NET = mh[1];
    var me = /EXTERNAL_NET:\s*"([^"]+)"/.exec(y); if (me) vars.EXTERNAL_NET = me[1];
    var dp = (/default-rule-path:\s*(\S+)/.exec(y) || [])[1] || "/etc/suricata/rules";
    var inRf = false;
    lines(y).forEach(function (l) { if (/^rule-files:/.test(l)) { inRf = true; return; } if (inRf) { var mf = /^\s+-\s+(\S+)/.exec(l); if (mf) files.push(mf[1].charAt(0) === "/" ? mf[1] : dp + "/" + mf[1]); else if (/^\S/.test(l)) inRf = false; } });
    vars.EXTERNAL_NET = vars.EXTERNAL_NET.replace("$HOME_NET", vars.HOME_NET);
    return { vars: vars, files: files.length ? files : [dp + "/suricata.rules", dp + "/local.rules"] };
  }
  function loadRules(sys, files, io) {
    var rules = [], failed = 0, okFiles = 0, errs = [];
    files.forEach(function (f) {
      var t = rd(sys, f);
      if (t === null) { errs.push("W: detect: No rule files match the pattern " + f); return; }
      okFiles++;
      lines(t).forEach(function (l, i) {
        if (!l.trim() || /^\s*#/.test(l)) return;
        try { rules.push(parseRule(l)); }
        catch (e) { if (!(e instanceof RuleError)) throw e; failed++; errs.push("E: " + e.message, "E: detect: error parsing signature \"" + l.trim() + "\" from file " + f + " at line " + (i + 1)); }
      });
    });
    return { rules: rules, failed: failed, files: okFiles, errs: errs };
  }
  function buffers(p) {
    var b = { payload: p.data != null ? String(p.data) : "" };
    if (p.data != null) { var h = httpParts(p.data); if (h.req) { b["http.uri"] = h.uri; b["http.method"] = h.method; b["http.user_agent"] = h.h["user-agent"]; b["http.host"] = h.h.host; b["http.request_body"] = h.body; } }
    if (p.dns && !p.dns.resp) b["dns.query"] = p.dns.q;
    if (p.sni) b["tls.sni"] = p.sni;
    if (p.snmp) b.payload = "\x04" + p.snmp.community + " " + p.snmp.oid;
    return b;
  }
  function flagBits(f) { var v = 0; String(f).split("").forEach(function (c) { v |= { F: 1, S: 2, R: 4, P: 8, ".": 16, A: 16, U: 32 }[c] || 0; }); return v; }
  function ruleMatch(r, p, ctx, vars) {
    var proto = p.tcp ? "tcp" : p.udp ? "udp" : p.icmp ? "icmp" : "ip";
    if (r.proto === "http") { if (!p.tcp || !(p.data != null && httpParts(p.data).method !== null && httpParts(p.data).req)) return false; }
    else if (r.proto === "dns") { if (!p.dns) return false; }
    else if (r.proto === "tls") { if (!(p.enc && p.enc.tls)) return false; }
    else if (r.proto === "ftp") { if (!(p.tcp && (p.tcp.dport === 21 || p.tcp.sport === 21) && p.data != null)) return false; }
    else if (r.proto !== "ip" && r.proto !== proto) return false;
    if (!p.ip) return false;
    var l4 = p.tcp || p.udp, sp = l4 ? l4.sport : 0, dp = l4 ? l4.dport : 0;
    var fwd = addrMatch(r.src, p.ip.src, vars) && addrMatch(r.dst, p.ip.dst, vars) && portMatch(r.sport, sp, vars) && portMatch(r.dport, dp, vars);
    var back = r.dir === "<>" && addrMatch(r.src, p.ip.dst, vars) && addrMatch(r.dst, p.ip.src, vars) && portMatch(r.sport, dp, vars) && portMatch(r.dport, sp, vars);
    if (!fwd && !back) return false;
    if (r.flags) { if (!p.tcp) return false; var fm = /^([A-Z+*!]+)(?:,([A-Z0-9]+))?$/.exec(r.flags.toUpperCase()); if (fm) { var want = flagBits(fm[1].replace(/[+*!]/g, "")), ign = fm[2] ? flagBits(fm[2].replace(/[12]/g, "")) : 0, have = flagBits(p.tcp.flags) & ~ign & 63; if (/\+/.test(fm[1]) ? (have & want) !== want : have !== want) return false; } }
    if (r.flow) {
      var f = ctx.flowOf(p);
      if (r.flow.indexOf("to_server") >= 0 || r.flow.indexOf("from_client") >= 0) { if (!f || !f.toServer) return false; }
      if (r.flow.indexOf("to_client") >= 0 || r.flow.indexOf("from_server") >= 0) { if (!f || f.toServer) return false; }
      if (r.flow.indexOf("established") >= 0 && (!f || !f.established)) return false;
    }
    if (r.itype != null && (!p.icmp || p.icmp.type !== r.itype)) return false;
    if (r.dsize) { var n = N.encode(p).paylen, dm = /^([<>]?)(\d+)$/.exec(r.dsize); if (dm && !(dm[1] === "<" ? n < +dm[2] : dm[1] === ">" ? n > +dm[2] : n === +dm[2])) return false; }
    var bufs = buffers(p);
    for (var i = 0; i < r.contents.length; i++) {
      var c = r.contents[i], hay = bufs[c.buf || "payload"];
      if (hay == null) return false;
      var found = c.nocase ? hay.toLowerCase().indexOf(c.str.toLowerCase()) >= 0 : hay.indexOf(c.str) >= 0;
      if (found === c.neg) return false;
    }
    if (r.pcre) { var hp = bufs[r.pcre.buf || "payload"]; if (hp == null || !r.pcre.re.test(hp)) return false; }
    return true;
  }
  function isoT(t) { var ms = t * 1000; return new Date(ms).toISOString().replace("Z", "").replace(/\.(\d{3})$/, "." + ("00000" + Math.round((t % 1) * 1e6)).slice(-6)) + "+0000"; }
  function fastT(t) { var d = new Date(t * 1000); return ("0" + (d.getUTCMonth() + 1)).slice(-2) + "/" + ("0" + d.getUTCDate()).slice(-2) + "/" + d.getUTCFullYear() + "-" + tod(t * 1000) + "." + ("00000" + Math.round((t % 1) * 1e6)).slice(-6); }
  function runSuricata(sys, pkts, rules, vars) {
    var st = {}, alerts = [], seen = {};
    pkts.forEach(function (p, i) {
      if (!p.ip) return;
      var l4 = p.tcp || p.udp, a = p.ip.src + ":" + (l4 ? l4.sport : 0), b = p.ip.dst + ":" + (l4 ? l4.dport : 0), k = a < b ? a + "|" + b : b + "|" + a;
      if (!st[k]) st[k] = { client: p.tcp && /S\./.test(p.tcp.flags) ? b : a, est: false, id: 1000000000000000 + (hash(k) % 900000000000000) };
      if (p.tcp && /S\./.test(p.tcp.flags)) st[k].est = true;
      var ctx = { flowOf: function () { return { toServer: st[k].client === a, established: st[k].est || (!!p.udp) }; } };
      // a matching pass rule stops all inspection of the rest of that flow
      if (!st[k].passed && rules.some(function (r) { return r.action === "pass" && ruleMatch(r, p, ctx, vars); })) st[k].passed = true;
      if (st[k].passed) return;
      rules.forEach(function (r) {
        if (r.action === "pass") return;
        if (!ruleMatch(r, p, ctx, vars)) return;
        if (r.threshold) {
          var th = r.threshold, tk = r.sid + "|" + (th.track === "by_dst" ? p.ip.dst : p.ip.src), s = seen[tk] = seen[tk] || { n: 0, t0: p.t, fired: 0 };
          if (p.t - s.t0 > th.seconds) { s.n = 0; s.t0 = p.t; s.fired = 0; }
          s.n++;
          if (th.type === "limit") { if (s.fired >= th.count) return; s.fired++; }
          else if (th.type === "threshold") { if (s.n % th.count !== 0) return; }
          else if (th.type === "both") { if (s.n !== th.count) return; }
          else if (th.type === "detection_filter") { if (s.n <= th.count) return; }
        }
        alerts.push({ r: r, p: p, i: i, flow: st[k].id });
      });
    });
    return alerts;
  }
  N.suricata = { parseRule: parseRule, run: runSuricata };
  CMDS.suricata = function (args, io, sess) {
    var sys = sess.sys, a = args.slice(1), o = { extra: [] };
    for (var i = 0; i < a.length; i++) { var x = a[i]; if (x === "-r") o.r = a[++i]; else if (x === "-l") o.l = a[++i]; else if (x === "-S") o.S = a[++i]; else if (x === "-s") o.extra.push(a[++i]); else if (x === "-c") o.c = a[++i]; else if (x === "-T") o.T = true; else if (x === "-k") i++; else if (x === "--build-info" || x === "-V") { out(io, "This is Suricata version 7.0.3 RELEASE\n"); return 0; } else if (x === "-i") { errl(io, "E: suricata: live capture needs the service: sudo systemctl start suricata"); note(io, "(In this lab, run Suricata on a capture file: suricata -r FILE -l DIR.)"); return 1; } else if (/^--runmode/.test(x) || x === "-v") continue; else { errl(io, "E: suricata: unknown command line argument: " + x); return 1; } }
    if (!o.r && !o.T) { errl(io, "E: suricata: No run mode specified (-r FILE to read a capture, -T to test the configuration)"); return 1; }
    var conf = suriConf(sys), files = o.S ? [o.S] : conf.files.concat(o.extra);
    var lr = loadRules(sys, files, io);
    if (o.T) {
      out(io, "i: suricata: This is Suricata version 7.0.3 RELEASE running in SYSTEM mode\n");
      lr.errs.forEach(function (e) { errl(io, e); });
      out(io, "i: detect: " + lr.files + " rule files processed. " + lr.rules.length + " rules successfully loaded, " + lr.failed + " rules failed, 0\n");
      if (lr.failed) { errl(io, "E: detect: Loading signatures failed."); return 1; }
      out(io, "i: suricata: Configuration provided was successfully loaded. Exiting.\n");
      return 0;
    }
    var rf = S.readFile(sess, o.r);
    if (rf.error) { errl(io, "E: pcap: Failed to open file \"" + o.r + "\"" ); return 1; }
    var pkts = N.readPcap(rf.content);
    if (!pkts) { errl(io, "E: pcap: \"" + o.r + "\" is not a pcap file"); return 1; }
    var dir = (o.l || "/var/log/suricata").replace(/\/$/, "") || "/", dirAbs = dir;
    var dn = S.lookup(sess, dirAbs);
    if (!dn.node || dn.node.type !== "d") { errl(io, "E: suricata: The logging directory \"" + dir + "\" supplied at the command-line (-l " + dir + ") doesn't exist. Shutting down the engine"); return 1; }
    if (!S.can(sess, dn.node, "w")) { errl(io, "E: logopenfile: Error opening file: \"" + dir + "/fast.log\": Permission denied"); return 1; }
    out(io, "i: suricata: This is Suricata version 7.0.3 RELEASE running in USER mode\n");
    lr.errs.forEach(function (e) { errl(io, e); });
    var alerts = runSuricata(sys, pkts, lr.rules, conf.vars);
    out(io, "i: threads: Threads created -> RX: 1 W: 2 FM: 1 FR: 1   Engine started.\ni: suricata: Signal Received.  Stopping engine.\ni: pcap: read 1 file, " + pkts.length + " packets, " + pkts.reduce(function (s, p) { return s + N.encode(p).bytes.length; }, 0) + " bytes\n");
    var fast = alerts.map(function (al) { var r = al.r, p = al.p, l4 = p.tcp || p.udp, cl = CLASSES[r.classtype] || [3, "Misc activity"]; return fastT(p.t) + "  [**] [1:" + r.sid + ":" + (r.rev || 1) + "] " + r.msg + " [**] [Classification: " + cl[1] + "] [Priority: " + (r.priority || cl[0]) + "] {" + (p.tcp ? "TCP" : p.udp ? "UDP" : "ICMP") + "} " + p.ip.src + (l4 ? ":" + l4.sport : "") + " -> " + p.ip.dst + (l4 ? ":" + l4.dport : ""); });
    var eve = alerts.map(function (al) {
      var r = al.r, p = al.p, l4 = p.tcp || p.udp, cl = CLASSES[r.classtype] || [3, "Misc activity"], e = { timestamp: isoT(p.t), flow_id: al.flow, pcap_cnt: al.i + 1, event_type: "alert", src_ip: p.ip.src, src_port: l4 ? l4.sport : undefined, dest_ip: p.ip.dst, dest_port: l4 ? l4.dport : undefined, proto: p.tcp ? "TCP" : p.udp ? "UDP" : "ICMP", alert: { action: "allowed", gid: 1, signature_id: r.sid, rev: r.rev || 1, signature: r.msg, category: cl[1], severity: r.priority || cl[0] } };
      if (p.data != null) { var h = httpParts(p.data); if (h.req) { e.app_proto = "http"; e.http = { hostname: h.h.host, url: h.uri, http_user_agent: h.h["user-agent"], http_method: h.method, protocol: "HTTP/" + h.version, length: 0 }; } }
      if (p.dns) { e.app_proto = "dns"; e.dns = { query: [{ type: "query", rrname: p.dns.q, rrtype: p.dns.qt }] }; }
      if (p.sni) { e.app_proto = "tls"; e.tls = { sni: p.sni, version: "TLS 1.3" }; }
      return JSON.stringify(e);
    });
    S.writeFile(sess, dirAbs + "/fast.log", fast.length ? fast.join("\n") + "\n" : "");
    S.writeFile(sess, dirAbs + "/eve.json", eve.length ? eve.join("\n") + "\n" : "");
    S.writeFile(sess, dirAbs + "/stats.log", "------------------------------------------------------------------------------------\nDate: 11/11/2026 -- 09:00:00 (uptime: 0d, 00h 00m 01s)\n------------------------------------------------------------------------------------\nCounter                                       | TM Name                   | Value\n------------------------------------------------------------------------------------\ndecoder.pkts                                  | Total                     | " + pkts.length + "\ndetect.alert                                  | Total                     | " + alerts.length + "\n");
    out(io, "i: counters: Alerts: " + alerts.length + "\ni: suricata: cleaning up signature grouping structure... complete\n");
    N.ev(sys, { k: "look", what: "suricata", layer: 7, nowire: true });
    return 0;
  };

  /* ================================================================== Zeek */
  function zh(path, fields, types, rows, t) {
    var stamp = M2.ymd(t * 1000) + "-" + tod(t * 1000).replace(/:/g, "-");
    return ["#separator \\x09", "#set_separator\t,", "#empty_field\t(empty)", "#unset_field\t-", "#path\t" + path, "#open\t" + stamp, "#fields\t" + fields.join("\t"), "#types\t" + types.join("\t")].concat(rows.map(function (r) { return r.map(function (v) { return v === undefined || v === null ? "-" : v === "" ? "(empty)" : String(v); }).join("\t"); })).concat(["#close\t" + stamp]).join("\n") + "\n";
  }
  function zt(t) { return t.toFixed(6); }
  function zeekLogs(pkts) {
    var fl = flows(pkts), t0 = pkts.length ? pkts[0].t : NOW / 1000, logs = {};
    fl.forEach(function (f, i) { f.uid = uid(f.key + i); });
    var C = ["ts", "uid", "id.orig_h", "id.orig_p", "id.resp_h", "id.resp_p", "proto", "service", "duration", "orig_bytes", "resp_bytes", "conn_state", "local_orig", "local_resp", "missed_bytes", "history", "orig_pkts", "orig_ip_bytes", "resp_pkts", "resp_ip_bytes", "tunnel_parents"];
    var CT = ["time", "string", "addr", "port", "addr", "port", "enum", "string", "interval", "count", "count", "string", "bool", "bool", "count", "string", "count", "count", "count", "count", "set[string]"];
    function local(ip) { return /^10\./.test(ip) ? "T" : "F"; }
    logs.conn = zh("conn", C, CT, fl.map(function (f) { var dur = f.t1 - f.t0; return [zt(f.t0), f.uid, f.oh, f.op, f.rh, f.rp, f.proto, f.service, dur ? dur.toFixed(6) : f.proto === "tcp" && f.state !== "S0" ? "0.000000" : null, f.proto === "icmp" || f.state === "S0" && !f.ob ? (f.state === "S0" ? 0 : f.ob) : f.ob, f.proto === "icmp" ? f.rb : f.state === "S0" ? 0 : f.rb, f.proto === "icmp" ? "OTH" : f.state, local(f.oh), local(f.rh), 0, f.proto === "tcp" ? f.hist : f.rpk ? "Dd" : "D", f.opk, f.oib, f.rpk, f.rib, null]; }), t0);
    // dns
    var drows = [];
    fl.filter(function (f) { return f.service === "dns"; }).forEach(function (f) {
      var q = f.pk.filter(function (x) { return x.p.dns && !x.p.dns.resp; })[0], rsp = f.pk.filter(function (x) { return x.p.dns && x.p.dns.resp; })[0];
      if (!q) return;
      var d = q.p.dns, rr = rsp && rsp.p.dns;
      drows.push([zt(q.p.t), f.uid, f.oh, f.op, f.rh, f.rp, f.proto, d.id, rsp ? (rsp.p.t - q.p.t).toFixed(6) : null, d.q, 1, "C_INTERNET", { A: 1, AAAA: 28, MX: 15, TXT: 16, NS: 2, CNAME: 5, PTR: 12 }[d.qt] || 1, d.qt, rr ? (rr.rcode === "NXDOMAIN" ? 3 : rr.rcode === "SERVFAIL" ? 2 : 0) : null, rr ? (rr.rcode === "NXDOMAIN" ? "NXDOMAIN" : rr.rcode === "SERVFAIL" ? "SERVFAIL" : "NOERROR") : null, "F", "F", "T", rr ? "T" : "F", 0, rr && rr.an && rr.an.length ? rr.an.map(function (x) { return x.data; }).join(",") : null, rr && rr.an && rr.an.length ? rr.an.map(function (x) { return (x.ttl || 300).toFixed(6); }).join(",") : null, "F"]);
    });
    logs.dns = zh("dns", ["ts", "uid", "id.orig_h", "id.orig_p", "id.resp_h", "id.resp_p", "proto", "trans_id", "rtt", "query", "qclass", "qclass_name", "qtype", "qtype_name", "rcode", "rcode_name", "AA", "TC", "RD", "RA", "Z", "answers", "TTLs", "rejected"], ["time", "string", "addr", "port", "addr", "port", "enum", "count", "interval", "string", "count", "string", "count", "string", "count", "string", "bool", "bool", "bool", "bool", "count", "vector[string]", "vector[interval]", "bool"], drows, t0);
    // http
    var hrows = [];
    fl.filter(function (f) { return f.service === "http"; }).forEach(function (f) {
      var depth = 0, pend = null;
      f.pk.forEach(function (x) {
        if (x.p.data == null) return;
        var h = httpParts(x.p.data);
        if (h.req && x.o) { depth++; pend = { t: x.p.t, h: h, depth: depth }; return; }
        if (!h.req && h.status && pend) { var rq = pend.h; hrows.push([zt(pend.t), f.uid, f.oh, f.op, f.rh, f.rp, pend.depth, rq.method, rq.h.host, rq.uri, rq.h.referer, rq.version, rq.h["user-agent"], null, bytes(rq.body || ""), bytes(h.body || ""), h.status, h.msg, null, null, "(empty)", null, null, null, null, null, null, null, null, null]); pend = null; }
      });
      if (pend) { var rq2 = pend.h; hrows.push([zt(pend.t), f.uid, f.oh, f.op, f.rh, f.rp, pend.depth, rq2.method, rq2.h.host, rq2.uri, rq2.h.referer, rq2.version, rq2.h["user-agent"], null, bytes(rq2.body || ""), 0, null, null, null, null, "(empty)", null, null, null, null, null, null, null, null, null]); }
    });
    logs.http = zh("http", ["ts", "uid", "id.orig_h", "id.orig_p", "id.resp_h", "id.resp_p", "trans_depth", "method", "host", "uri", "referrer", "version", "user_agent", "origin", "request_body_len", "response_body_len", "status_code", "status_msg", "info_code", "info_msg", "tags", "username", "password", "proxied", "orig_fuids", "orig_filenames", "orig_mime_types", "resp_fuids", "resp_filenames", "resp_mime_types"], ["time", "string", "addr", "port", "addr", "port", "count", "string", "string", "string", "string", "string", "string", "string", "count", "count", "count", "string", "count", "string", "set[enum]", "string", "string", "set[string]", "vector[string]", "vector[string]", "vector[string]", "vector[string]", "vector[string]", "vector[string]"], hrows, t0);
    // ssl
    var srows = fl.filter(function (f) { return f.service === "ssl"; }).map(function (f) { var ch = f.pk.filter(function (x) { return x.p.sni; })[0]; return [zt(f.t0), f.uid, f.oh, f.op, f.rh, f.rp, "TLSv13", "TLS_AES_256_GCM_SHA384", "x25519", ch ? ch.p.sni : null, "F", null, null, f.rpk ? "T" : "F", "CsiI", null, null, null]; });
    logs.ssl = zh("ssl", ["ts", "uid", "id.orig_h", "id.orig_p", "id.resp_h", "id.resp_p", "version", "cipher", "curve", "server_name", "resumed", "last_alert", "next_protocol", "established", "ssl_history", "cert_chain_fps", "client_cert_chain_fps", "sni_matches_cert"], ["time", "string", "addr", "port", "addr", "port", "string", "string", "string", "string", "bool", "string", "string", "bool", "string", "vector[string]", "vector[string]", "bool"], srows, t0);
    // ssh
    var shrows = fl.filter(function (f) { return f.service === "ssh"; }).map(function (f) { var ok = f.pk.filter(function (x) { return x.p.enc; }).length > 6; return [zt(f.t0), f.uid, f.oh, f.op, f.rh, f.rp, 2, ok ? "T" : "F", ok ? 1 : 2, /^10\./.test(f.oh) ? "INBOUND".replace("IN", /^10\./.test(f.rh) ? "IN" : "OUT") : "INBOUND", "SSH-2.0-libssh2_1.10.0", "SSH-2.0-OpenSSH_9.6p1 Ubuntu-3ubuntu13.5"]; });
    logs.ssh = zh("ssh", ["ts", "uid", "id.orig_h", "id.orig_p", "id.resp_h", "id.resp_p", "version", "auth_success", "auth_attempts", "direction", "client", "server"], ["time", "string", "addr", "port", "addr", "port", "count", "bool", "count", "enum", "string", "string"], shrows, t0);
    // ftp
    var frows = [];
    fl.filter(function (f) { return f.service === "ftp"; }).forEach(function (f) {
      var user = null, last = null;
      f.pk.forEach(function (x) {
        if (x.p.data == null) return;
        var t = String(x.p.data).replace(/\r\n$/, "");
        if (x.o) { var m = /^(\w+)\s?(.*)$/.exec(t); if (!m) return; if (m[1].toUpperCase() === "USER") user = m[2]; last = { t: x.p.t, cmd: m[1].toUpperCase(), arg: m[1].toUpperCase() === "PASS" ? "<hidden>" : m[2] }; }
        else if (last) { var rm = /^(\d{3}) ?(.*)$/.exec(t); if (rm && last.cmd !== "USER") frows.push([zt(last.t), f.uid, f.oh, f.op, f.rh, f.rp, user || "<unknown>", "<hidden>", last.cmd, last.arg, null, null, +rm[1], rm[2], null, null, null, null]); last = null; }
      });
    });
    logs.ftp = zh("ftp", ["ts", "uid", "id.orig_h", "id.orig_p", "id.resp_h", "id.resp_p", "user", "password", "command", "arg", "mime_type", "file_size", "reply_code", "reply_msg", "data_channel.passive", "data_channel.orig_h", "data_channel.resp_h", "data_channel.resp_p"], ["time", "string", "addr", "port", "addr", "port", "string", "string", "string", "string", "string", "count", "count", "string", "bool", "addr", "addr", "port"], frows, t0);
    Object.keys(logs).forEach(function (k) { if (k !== "conn" && !/\n(?!#)[^\n]+\n#close/.test(logs[k])) delete logs[k]; });
    return logs;
  }
  N.zeekLogs = zeekLogs;
  CMDS.zeek = function (args, io, sess) {
    var a = args.slice(1), file = null;
    for (var i = 0; i < a.length; i++) { if (a[i] === "-r") file = a[++i]; else if (a[i] === "-i") { errl(io, "fatal error: problem with interface " + (a[i + 1] || "eth0") + " (pcap_error: socket: Operation not permitted (permission denied))"); note(io, "(In this lab, run Zeek on a capture: zeek -r FILE. It writes its logs to the current folder.)"); return 1; } else if (a[i] === "-v" || a[i] === "--version") { out(io, "zeek version 6.0.4\n"); return 0; } else if (a[i] === "-C" || a[i] === "local" || /\.zeek$/.test(a[i])) continue; }
    if (!file) { errl(io, "zeek: no input sources specified (use -r FILE)"); return 1; }
    var rf = S.readFile(sess, file);
    if (rf.error) { errl(io, "fatal error: problem with trace file " + file + " (" + file + ": No such file or directory)"); return 1; }
    var pkts = N.readPcap(rf.content);
    if (!pkts) { errl(io, "fatal error: problem with trace file " + file + " (unknown file format)"); return 1; }
    var logs = zeekLogs(pkts);
    var code = 0;
    Object.keys(logs).forEach(function (k) { var e = S.writeFile(sess, k + ".log", logs[k]); if (e) { if (!code) errl(io, "error: can't open " + k + ".log: " + S.ERRTEXT[e]); code = 1; } });
    S.writeFile(sess, "packet_filter.log", zh("packet_filter", ["ts", "node", "filter", "init", "success"], ["time", "string", "string", "bool", "bool"], [[zt(NOW / 1000), "zeek", "ip or not ip", "T", "T"]], NOW / 1000));
    N.ev(sess.sys, { k: "look", what: "zeek", layer: 7, nowire: true });
    return code;
  };
  CMDS["zeek-cut"] = function (args, io, sess) {
    var a = args.slice(1), human = false, fields = [];
    a.forEach(function (x) { if (x === "-d") human = true; else if (/^-[nucCm]+$/.test(x)) return; else fields.push(x); });
    var hdr = null, L = [];
    lines(io.stdin || "").forEach(function (l) {
      if (/^#fields\t/.test(l)) { hdr = l.split("\t").slice(1); return; }
      if (/^#/.test(l) || !hdr) return;
      var v = l.split("\t"), pick = fields.length ? fields.map(function (f) { var k = hdr.indexOf(f); return k < 0 ? "" : v[k]; }) : v;
      if (human) pick = pick.map(function (x, k) { var f = fields.length ? fields[k] : hdr[k]; return f === "ts" && /^\d+\.\d+$/.test(x) ? new Date(+x * 1000).toISOString().replace(/\.\d+Z$/, "+0000") : x; });
      L.push(pick.join("\t"));
    });
    out(io, joinLines(L));
    return 0;
  };

  /* ================================================================== packages and base files */
  M2.CATALOG.forEach(function (p) { if (p.name === "util-linux" && p.bins.indexOf("dmesg") < 0) p.bins.push("dmesg"); });
  function PK(name, ver, o) { return Object.assign({ name: name, ver: ver, arch: "amd64", section: "net", size: 120, desc: "", deps: [], bins: [], sbins: [], installed: false, auto: false, archive: "noble" }, o || {}); }
  M2.CATALOG.push(
    PK("suricata", "1:7.0.3-1build3", { size: 7400, desc: "Next Generation Intrusion Detection and Prevention Tool", bins: ["suricata"] }),
    PK("zeek", "6.0.4-0", { size: 52000, desc: "passive network traffic analyzer", bins: ["zeek", "zeek-cut"] })
  );
  var SURI_YAML = "%YAML 1.1\n---\n# Suricata configuration (excerpt)\nvars:\n  address-groups:\n    HOME_NET: \"[10.20.0.0/24]\"\n    EXTERNAL_NET: \"!$HOME_NET\"\n  port-groups:\n    HTTP_PORTS: \"80\"\n\ndefault-log-dir: /var/log/suricata/\ndefault-rule-path: /etc/suricata/rules\nrule-files:\n  - suricata.rules\n  - local.rules\n\noutputs:\n  - fast:\n      enabled: yes\n      filename: fast.log\n  - eve-log:\n      enabled: yes\n      filename: eve.json\n";
  var SURI_RULES = [
    'alert tcp $EXTERNAL_NET any -> $HOME_NET 22 (msg:"ET SCAN Potential SSH Scan"; flow:to_server; flags:S,12; threshold: type both, track by_src, count 5, seconds 120; classtype:attempted-recon; sid:2001219; rev:20;)',
    'alert tcp $EXTERNAL_NET any -> $HOME_NET [1:1024] (msg:"ET SCAN Possible Port Scan (many SYNs from one source)"; flags:S; threshold: type both, track by_src, count 15, seconds 10; classtype:network-scan; sid:2100623; rev:3;)',
    'alert http $EXTERNAL_NET any -> $HOME_NET any (msg:"ET SCAN Sqlmap SQL Injection Scan"; flow:to_server,established; http.user_agent; content:"sqlmap"; nocase; classtype:attempted-recon; sid:2008538; rev:9;)',
    'alert udp $EXTERNAL_NET any -> $HOME_NET 161 (msg:"GPL SNMP public access udp"; content:"public"; classtype:attempted-recon; sid:2101411; rev:11;)',
    'alert tcp $EXTERNAL_NET any -> $HOME_NET 21 (msg:"GPL FTP PASS command (clear-text password)"; flow:to_server,established; content:"PASS "; nocase; classtype:policy-violation; sid:2100553; rev:8;)',
    'alert tcp $EXTERNAL_NET any -> $HOME_NET 23 (msg:"ET POLICY Inbound Telnet session"; flow:to_server,established; classtype:policy-violation; sid:2100716; rev:5; threshold: type limit, track by_src, count 1, seconds 60;)',
    'alert http $HOME_NET any -> $EXTERNAL_NET any (msg:"ET POLICY curl User-Agent Outbound"; flow:to_server,established; http.user_agent; content:"curl/"; classtype:policy-violation; sid:2013028; rev:7;)',
    'alert tcp any any -> any any (msg:"GPL ATTACK_RESPONSE id check returned root"; content:"uid=0|28|root|29|"; classtype:bad-unknown; sid:2100498; rev:7;)'
  ];
  S.SYS_HOOKS.push(function (sys) {
    S.mkdirs(sys, "/etc/suricata/rules", 493, 0, 0);
    putRoot(sys, "/etc/suricata/suricata.yaml", SURI_YAML, 420, 0, 0, NOW - 30 * DAY);
    putRoot(sys, "/etc/suricata/rules/suricata.rules", "# Emerging Threats Open (excerpt), fetched by suricata-update\n" + SURI_RULES.join("\n") + "\n", 420, 0, 0, NOW - DAY);
    putRoot(sys, "/etc/suricata/rules/local.rules", "# Your own rules go here.\n", 420, 0, 0, NOW - 30 * DAY);
    S.mkdirs(sys, "/var/log/suricata", 493, 0, 0);
  });
})(typeof window !== "undefined" ? window : globalThis);
