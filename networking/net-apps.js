/* sudo learn — the Networking track, layers 4 to 7: names (resolv.conf, systemd-resolved, dig, getent), TCP and
   UDP (ss, nc), TLS (certificates as PEM files, nginx serving them, openssl s_client/x509, certbot renewing them
   over HTTP-01), HTTP (curl with HTTP/1.1 and HTTP/2, raw requests through nc) and encodings (base64, xxd,
   hexdump, iconv). Every network step goes through NetCore.reach, so a broken lower layer breaks these too. */
(function (root) {
  "use strict";
  var S = root.ShEngine, U = S.util, CMDS = S.CMDS, M2 = S.M2, N = M2.NET;
  var out = U.out, errl = U.errl, note = U.note, lines = U.lines, joinLines = U.joinLines, pad = U.pad, rpad = U.rpad, bytes = U.bytes, MON = U.MON, WDAY = U.WDAY;
  var rd = M2.rd, putRoot = M2.putRoot, nodeAt = M2.nodeAt, hash = M2.hash, tod = M2.tod;
  var NOW = S.NOW, DAY = S.DAY, W = N.W, PUB = W.PUB;
  var isV4 = N.isV4, isV6 = N.isV6, v6norm = N.v6norm, reach = N.reach, ev = N.ev;

  /* ================================================================== names */
  function resolvConf(sys) {
    var r = { servers: [], search: [] };
    lines(rd(sys, "/etc/resolv.conf") || "").forEach(function (l) { l = l.replace(/[#;].*$/, "").trim(); var m = /^nameserver\s+(\S+)/.exec(l); if (m) r.servers.push(m[1]); m = /^(?:search|domain)\s+(.+)$/.exec(l); if (m) r.search = m[1].trim().split(/\s+/); });
    return r;
  }
  function resolvedUp(sys) { var u = M2.loadUnit(sys, "systemd-resolved.service"); return !u || u.rt.active === "active"; }
  function upstreams(sys) { return N.linkDnsServers(sys.nw); }
  function searchList(sys) { var s = resolvConf(sys).search; Object.keys(sys.nw.linkDns).forEach(function (k) { sys.nw.linkDns[k].search.forEach(function (d) { if (s.indexOf(d) < 0) s.push(d); }); }); return s; }
  var AUTH = { "192.0.2.53": "kestrel.example.com", "198.51.100.53": "kestrel.example.com", "199.43.135.53": "example.com" };
  // Ask one DNS server. Returns {status, answers, chain, aa, err: timeout|refused, server, via}
  function askServer(sys, server, name, type, o) {
    o = o || {};
    var n = String(name).toLowerCase().replace(/\.$/, "");
    if (/^127\.0\.0\.5[34]$/.test(server)) {
      if (!resolvedUp(sys)) return { err: "refused", server: server };
      var spz = sys.nw.poison && sys.nw.poison["127.0.0.53"] && sys.nw.poison["127.0.0.53"][n + "|" + type];
      if (spz) return { status: "NOERROR", answers: [{ name: n, type: type, data: spz.data, ttl: spz.ttl }], chain: [], server: server, via: upstreams(sys)[0], aa: false, poisoned: true, cached: true };
      var ups = upstreams(sys), tried = [];
      for (var i = 0; i < ups.length; i++) {
        var a = askServer(sys, ups[i], n, type, { quiet: true });
        tried.push(ups[i]);
        if (!a.err) { a.server = server; a.via = ups[i]; a.aa = false; return a; }
      }
      return { status: "SERVFAIL", answers: [], chain: [], server: server, tried: tried, noUpstream: !ups.length };
    }
    var r = reach(sys, server, { quiet: o.quiet });
    if (!r.ok) return { err: r.err === "hostunreach" || r.err === "netunreach" ? (r.err === "netunreach" ? "netunreach" : "timeout") : "timeout", server: server, path: r.path, fail: r.fail };
    var isRes = W.RESOLVERS.indexOf(server) >= 0, zone = AUTH[server];
    if (!isRes && !zone) return { err: "refused", server: server, path: r.path };
    if (zone && !(n === zone || n.slice(-zone.length - 1) === "." + zone)) return { status: "REFUSED", answers: [], chain: [], server: server, path: r.path };
    var pz = sys.nw.poison && sys.nw.poison[server] && sys.nw.poison[server][n + "|" + type];
    if (pz) return { status: "NOERROR", answers: [{ name: n, type: type, data: pz.data, ttl: pz.ttl }], chain: [], server: server, aa: false, path: r.path, rtt: r.rtt, poisoned: true };
    var internal = server === "10.20.0.2";
    var res = M2.dnsLookup(sys, n, type, internal ? "10.20.0.2" : "1.1.1.1");
    return { status: res.status, answers: res.answers, chain: res.chain, server: server, aa: !!zone, path: r.path, rtt: r.rtt };
  }
  N.askServer = askServer;
  // getaddrinfo: /etc/hosts, then DNS via resolv.conf with the search domains. fam: 4, 6 or null (both)
  function getaddrinfo(sys, name, fam) {
    var n = String(name).toLowerCase().replace(/\.$/, "");
    if (isV4(n) || isV6(n)) return { ip: isV6(n) ? n : n, name: n, literal: true };
    if (n === "localhost") return { ip: fam === 6 ? "::1" : "127.0.0.1", name: "localhost", hosts: true };
    var hf = N.hostsFile(sys).filter(function (h) { return h.name === n && (fam === 6 ? isV6(h.ip) : fam === 4 ? isV4(h.ip) : true); })[0];
    if (hf) return { ip: hf.ip, name: n, hosts: true };
    var rc = resolvConf(sys), servers = rc.servers.length ? rc.servers : ["127.0.0.53"];
    var names = n.indexOf(".") >= 0 ? [n] : [];
    searchList(sys).forEach(function (d) { names.push(n + "." + d); });
    if (n.indexOf(".") < 0) names.push(n);
    var sawTimeout = false, delay = 0;
    for (var k = 0; k < names.length; k++) {
      var types = fam === 6 ? ["AAAA"] : fam === 4 ? ["A"] : ["A", "AAAA"];
      for (var t = 0; t < types.length; t++) {
        var got = null;
        for (var s = 0; s < servers.length; s++) {
          var a = askServer(sys, servers[s], names[k], types[t], { quiet: true });
          if (a.err || a.status === "SERVFAIL") { sawTimeout = true; if (a.err === "timeout") delay += 5; continue; }
          got = a; break;
        }
        if (got && got.answers.length) return { delay: delay, ip: got.answers[0].data, name: names[k], dns: true, server: got.server, all: got.answers.map(function (x) { return x.data; }), canon: got.answers[0].name };
      }
    }
    return { err: sawTimeout ? "Temporary failure in name resolution" : "Name or service not known", timeout: sawTimeout };
  }
  N.getaddrinfo = getaddrinfo;
  N.resolveQuiet = function (sys, name) { var r = getaddrinfo(sys, name, 4); return r.err ? null : r.ip; };
  N.resolveForPing = function (sys, target, six, four) {
    if (isV4(target)) return { ip: target };
    if (isV6(target.replace(/%.*$/, ""))) return { ip: v6norm(target.replace(/%.*$/, "")) };
    var r = getaddrinfo(sys, target, six ? 6 : 4);
    if (r.err && !six && !four) { var r6 = getaddrinfo(sys, target, 6); if (!r6.err) r = r6; }
    if (r.err) return { err: r.err };
    return { ip: r.ip, name: r.canon || r.name, viaName: true };
  };

  /* ---------------- dig */
  var DIGV = "DiG 9.18.28-0ubuntu0.24.04.1-Ubuntu";
  function dnsDate(sys) { var d = new Date(sys.now); return WDAY[d.getUTCDay()] + " " + MON[d.getUTCMonth()] + " " + d.getUTCDate() + " " + tod(sys.now) + " UTC " + d.getUTCFullYear(); }
  function rr(sys, x) { return x.name.replace(/\.?$/, ".") + "\t" + (x.ttl || N.ttlOf(sys, x.name, x.type)) + "\tIN\t" + x.type + "\t" + x.data; }
  function soaFor(name) { var parts = String(name).replace(/\.$/, "").split("."); var zone = /kestrel\.example\.com$/.test(name) ? "kestrel.example.com" : /\.internal$/.test(name) ? "kestrel.internal" : parts.slice(-2).join("."); return zone + ".\t\t900\tIN\tSOA\t" + (zone === "kestrel.example.com" ? "ns1.example-dns.net. hostmaster.kestrel.example.com. 2026111101 7200 3600 1209600 300" : zone === "kestrel.internal" ? "kc-dns-01.kestrel.internal. hostmaster.kestrel.internal. 2026111001 3600 600 604800 3600" : "ns.icann.org. noc.dns.icann.org. 2026110501 7200 3600 1209600 3600"); }
  CMDS.dig = function (args, io, sess) {
    var sys = sess.sys, a = args.slice(1), type = null, name = null, server = null, o = { cmd: true, question: true, answer: true, authority: true, additional: true, stats: true, comments: true }, short = false, trace = false, tcp = false, rev = false;
    for (var i = 0; i < a.length; i++) {
      var x = a[i];
      if (x === "+short") short = true; else if (x === "+trace") trace = true; else if (x === "+tcp" || x === "+vc") tcp = true;
      else if (x === "+noall") Object.keys(o).forEach(function (k) { o[k] = false; }); else if (x === "+all") Object.keys(o).forEach(function (k) { o[k] = true; });
      else if (/^\+no(cmd|question|answer|authority|additional|stats|comments)$/.test(x)) o[x.slice(3)] = false;
      else if (/^\+(cmd|question|answer|authority|additional|stats|comments)$/.test(x)) o[x.slice(1)] = true;
      else if (x.charAt(0) === "+") continue;
      else if (x.charAt(0) === "@") server = x.slice(1);
      else if (x === "-x") { rev = true; name = a[++i]; }
      else if (x === "-t") type = (a[++i] || "").toUpperCase();
      else if (x === "-4" || x === "-6") continue;
      else if (/^(A|AAAA|MX|CNAME|TXT|NS|SOA|PTR|ANY|SRV|CAA)$/i.test(x) && (name !== null || type === null && /^(MX|AAAA|TXT|NS|SOA|CNAME|PTR|SRV|CAA)$/i.test(x))) { if (name === null && !/^A$/i.test(x)) type = x.toUpperCase(); else if (name !== null) type = x.toUpperCase(); else name = x; }
      else if (name === null) name = x;
    }
    if (name === null) { name = "."; type = type || "NS"; }
    type = type || "A";
    var qname = name;
    if (rev) {
      type = "PTR";
      qname = isV4(name) ? name.split(".").reverse().join(".") + ".in-addr.arpa" : name;
    }
    var rc = resolvConf(sys), srv = server || rc.servers[0] || "127.0.0.53", srvIp = srv;
    if (!isV4(srv) && !isV6(srv)) { var g = getaddrinfo(sys, srv, 4); if (g.err) { errl(io, "dig: couldn't get address for '" + srv + "': failure"); return 10; } srvIp = g.ip; }
    if (trace) return digTrace(sys, io, a, qname, type);
    var res;
    if (rev) {
      var ptr = W.NAMES[name];
      var internalOk = /^10\./.test(name);
      var ask = askServer(sys, srvIp, "kestrel.example.com", "A", {});
      if (ask.err) res = ask;
      else if (ptr && (!internalOk || ask.via === "10.20.0.2" || srvIp === "10.20.0.2")) res = { status: "NOERROR", answers: [{ name: qname, type: "PTR", data: ptr + "." }], chain: [] };
      else res = { status: "NXDOMAIN", answers: [], chain: [] };
      res.server = srvIp;
    } else {
      res = askServer(sys, srvIp, qname, type, {});
      var extraT = 0;
      if (!server && res.err === "timeout") {
        for (var si = 1; si < rc.servers.length && res.err; si++) { errl(io, ";; communications error to " + srv + "#53: timed out"); extraT += 5000; srv = srvIp = rc.servers[si]; res = askServer(sys, srvIp, qname, type, {}); }
      }
      res.extraT = extraT;
    }
    var head = ["", "; <<>> " + DIGV + " <<>> " + a.join(" ")];
    if (server) head.push("; (1 server found)");
    head.push(";; global options: +cmd");
    if (res.err) {
      var msg = res.err === "refused" ? "connection refused" : res.err === "netunreach" ? "network unreachable" : "timed out";
      var Lr = [];
      for (var k = 0; k < 3; k++) Lr.push(";; communications error to " + srv + "#53: " + msg);
      if (!short) Lr = Lr.concat(head, ";; no servers could be reached");
      out(io, joinLines(Lr) + (short ? "" : "\n"));
      ev(sys, { k: "dns", name: qname, type: type, tcp: tcp, server: srvIp, ok: false, timeout: true, path: res.path || ["you"], fail: res.fail || "you", layer: 7 });
      return 9;
    }
    var ans = res.chain.concat(res.answers);
    ev(sys, { k: "dns", name: qname, type: type, tcp: tcp, ans: ans.map(function (x) { return { type: x.type, data: x.data, name: x.name }; }), server: srvIp, via: res.via, ok: res.status === "NOERROR" && ans.length > 0, status: res.status, path: dnsPath(sys, res), layer: 7 });
    if (short) { out(io, joinLines(ans.map(function (x) { return x.data; }))); return 0; }
    var L = [];
    if (o.cmd) L = L.concat(head);
    if (o.comments) {
      L.push(";; Got answer:", ";; ->>HEADER<<- opcode: QUERY, status: " + res.status + ", id: " + (hash(qname + type + sys.cmdIndex) % 65536));
      L.push(";; flags: qr" + (res.aa ? " aa" : "") + " rd" + (res.aa ? "" : " ra") + "; QUERY: 1, ANSWER: " + ans.length + ", AUTHORITY: " + (ans.length ? 0 : 1) + ", ADDITIONAL: 1");
      if (res.aa) L.push(";; WARNING: recursion requested but not available");
      L.push("", ";; OPT PSEUDOSECTION:", "; EDNS: version: 0, flags:; udp: " + (/^127\./.test(srvIp) ? 65494 : 1232));
    }
    if (o.question) L.push(";; QUESTION SECTION:", ";" + qname.replace(/\.?$/, ".") + "\t\tIN\t" + type, "");
    if (ans.length && o.answer) { if (o.comments) L.push(";; ANSWER SECTION:"); ans.forEach(function (x) { L.push(rr(sys, x)); }); L.push(""); }
    if (!ans.length && o.authority && res.status !== "SERVFAIL") { if (o.comments) L.push(";; AUTHORITY SECTION:"); L.push(soaFor(qname)); L.push(""); }
    if (o.stats) L.push(";; Query time: " + ((res.extraT || 0) + (/^127\./.test(srvIp) ? 12 : Math.max(1, Math.round((res.rtt || 10) * 2)))) + " msec", ";; SERVER: " + srvIp + "#53(" + srv + ") (" + (tcp ? "TCP" : "UDP") + ")", ";; WHEN: " + dnsDate(sys), ";; MSG SIZE  rcvd: " + (40 + qname.length + ans.length * 16), "");
    out(io, joinLines(L));
    return 0;
  };
  function dnsPath(sys, res) {
    var srv = res.via || res.server;
    var r = reach(sys, srv, { quiet: true });
    return r.path || ["you"];
  }
  function digTrace(sys, io, a, qname, type) {
    var L = ["", "; <<>> " + DIGV + " <<>> " + a.join(" "), ";; global options: +cmd"];
    var root = askServer(sys, "127.0.0.53", "kestrel.example.com", "A", { quiet: true });
    if (root.err || root.status === "SERVFAIL") { L.push(";; communications error to 127.0.0.53#53: timed out", ";; no servers could be reached"); out(io, joinLines(L)); return 9; }
    var inet = reach(sys, "198.41.0.4", { quiet: true });
    if (!inet.ok && !(N.lookup4(sys.nw, "1.1.1.1"))) { L.push("."); out(io, joinLines(L) + ";; communications error to 198.41.0.4#53: network unreachable\n"); return 9; }
    ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l", "m"].forEach(function (l) { L.push(".\t\t\t86400\tIN\tNS\t" + l + ".root-servers.net."); });
    L.push(";; Received 239 bytes from 127.0.0.53#53(127.0.0.53) in 0 ms", "");
    var n = qname.replace(/\.$/, "").toLowerCase(), tld = n.split(".").pop();
    if (/\.internal$/.test(n)) { L.push("internal.\t\t86400\tIN\tSOA\ta.root-servers.net. nstld.verisign-grs.com. 2026111100 1800 900 604800 86400", ";; Received 117 bytes from 198.41.0.4#53(a.root-servers.net) in 23 ms", ""); out(io, joinLines(L)); note(io, "(.internal names only exist inside Kestrel's network: the internet's root servers have never heard of them. Only kc-dns-01 knows them.)"); return 0; }
    ["a", "b", "c", "d"].forEach(function (l) { L.push(tld + ".\t\t\t172800\tIN\tNS\t" + l + ".gtld-servers.net."); });
    L.push(";; Received 1170 bytes from 198.41.0.4#53(a.root-servers.net) in 23 ms", "");
    var parts = n.split("."), zone2 = parts.slice(-2).join(".");
    var zns = zone2 === "example.com" ? ["a.iana-servers.net.", "b.iana-servers.net."] : zone2 === "github.com" ? ["dns1.p08.nsone.net.", "dns2.p08.nsone.net."] : ["ns1." + zone2 + ".", "ns2." + zone2 + "."];
    zns.forEach(function (s) { L.push(zone2 + ".\t\t172800\tIN\tNS\t" + s); });
    L.push(";; Received 202 bytes from 192.5.6.30#53(a.gtld-servers.net) in 15 ms", "");
    var last = zns[0], lastIp = zone2 === "example.com" ? "199.43.135.53" : "192.0.2.10";
    if (/(^|\.)kestrel\.example\.com$/.test(n)) {
      L.push("kestrel.example.com.\t86400\tIN\tNS\tns1.example-dns.net.", "kestrel.example.com.\t86400\tIN\tNS\tns2.example-dns.net.", ";; Received 113 bytes from 199.43.135.53#53(a.iana-servers.net) in 88 ms", "");
      last = "ns1.example-dns.net"; lastIp = "192.0.2.53";
    }
    var res = M2.dnsLookup(sys, n, type, "1.1.1.1"), ans = res.chain.concat(res.answers);
    if (ans.length) ans.forEach(function (x) { L.push(rr(sys, x)); }); else L.push(soaFor(n));
    L.push(";; Received " + (48 + ans.length * 16) + " bytes from " + lastIp + "#53(" + last.replace(/\.$/, "") + ") in 12 ms", "");
    out(io, joinLines(L));
    ev(sys, { k: "dns", name: n, server: "root", ok: !!ans.length, trace: true, path: ["you", "sw", "gw", "inet"], layer: 7 });
    return 0;
  }
  CMDS.host = function (args, io, sess) {
    var sys = sess.sys, a = args.slice(1).filter(function (x) { return !/^-/.test(x); }), ti = args.indexOf("-t"), type = ti >= 0 ? (args[ti + 1] || "").toUpperCase() : null;
    if (type) a = a.filter(function (x) { return x.toUpperCase() !== type; });
    var name = a[0], server = a[1] || resolvConf(sys).servers[0] || "127.0.0.53";
    if (!name) { errl(io, "Usage: host [-aCdilrTvVw] [-c class] [-N ndots] [-t type] [-W time]\n            [-R number] [-m flag] [-p port] hostname [server]"); return 1; }
    if (isV4(name)) { var ptr = W.NAMES[name]; if (ptr) { out(io, name.split(".").reverse().join(".") + ".in-addr.arpa domain name pointer " + ptr + ".\n"); return 0; } out(io, "Host " + name.split(".").reverse().join(".") + ".in-addr.arpa. not found: 3(NXDOMAIN)\n"); return 1; }
    var types = type ? [type] : ["A", "AAAA", "MX"], any = false, L = [], fail = null;
    if (a[1]) L.push("Using domain server:", "Name: " + server, "Address: " + server + "#53", "Aliases: ", "");
    types.forEach(function (t) {
      var r = askServer(sys, server, name, t, { quiet: true });
      if (r.err || r.status === "SERVFAIL") { fail = r; return; }
      if (r.status === "NXDOMAIN") return;
      r.chain.forEach(function (c) { var s = c.name + " is an alias for " + c.data; if (L.indexOf(s) < 0) L.push(s); });
      r.answers.forEach(function (x) { any = true; L.push(x.name + (t === "A" ? " has address " : t === "AAAA" ? " has IPv6 address " : t === "MX" ? " mail is handled by " : t === "TXT" ? " descriptive text " : t === "NS" ? " name server " : " has " + t + " record ") + x.data); });
      if (r.chain.length) any = true;
    });
    if (fail && !any) { out(io, ";; communications error to " + server + "#53: timed out\n;; no servers could be reached\n"); return 1; }
    if (!any) { out(io, "Host " + name + " not found: 3(NXDOMAIN)\n"); return 1; }
    out(io, joinLines(L));
    ev(sys, { k: "dns", name: name, ok: true, path: ["you", "sw", "dns"], layer: 7 });
    return 0;
  };
  CMDS.nslookup = function (args, io, sess) {
    var sys = sess.sys, a = args.slice(1).filter(function (x) { return !/^-/.test(x); }), name = a[0], server = a[1] || resolvConf(sys).servers[0] || "127.0.0.53";
    if (!name) { note(io, "(nslookup without a name opens an interactive prompt. Pass a name: nslookup kestrel.example.com)"); return 0; }
    var r = askServer(sys, server, name, "A", {});
    if (r.err) { out(io, ";; communications error to " + server + "#53: timed out\n;; communications error to " + server + "#53: timed out\n;; no servers could be reached\n\n"); return 1; }
    out(io, "Server:\t\t" + server + "\nAddress:\t" + server + "#53\n\n");
    if (r.status === "NXDOMAIN") { out(io, "** server can't find " + name + ": NXDOMAIN\n\n"); return 1; }
    if (r.status === "SERVFAIL") { out(io, "** server can't find " + name + ": SERVFAIL\n\n"); return 1; }
    out(io, (r.aa || /\.internal$/.test(name) ? "" : "Non-authoritative answer:\n") + r.chain.map(function (c) { return c.name + "\tcanonical name = " + c.data + "\n"; }).join("") + r.answers.map(function (x) { return "Name:\t" + x.name + "\nAddress: " + x.data + "\n"; }).join("") + "\n");
    return 0;
  };
  var getentPrev = CMDS.getent;
  CMDS.getent = function (args, io, sess) {
    if ((args[1] !== "hosts" && args[1] !== "ahosts" && args[1] !== "ahostsv4" && args[1] !== "ahostsv6") || !args[2]) return getentPrev(args, io, sess);
    var code = 0;
    args.slice(2).forEach(function (n) {
      var r = getaddrinfo(sess.sys, n, args[1] === "ahostsv4" ? 4 : args[1] === "ahostsv6" ? 6 : null);
      if (r.err) { code = 2; return; }
      if (args[1] === "hosts") out(io, rpad(r.ip, 15) + " " + (r.dns ? r.canon || r.name : n) + "\n");
      else out(io, rpad(r.ip, 15) + " STREAM " + (r.canon || n) + "\n" + rpad(r.ip, 15) + " DGRAM  \n" + rpad(r.ip, 15) + " RAW    \n");
      ev(sess.sys, { k: "dns", name: n, ok: true, hosts: !!r.hosts, path: r.hosts ? ["you"] : ["you", "sw", "dns"], layer: 7 });
    });
    return code;
  };
  CMDS.resolvectl = function (args, io, sess) {
    var sys = sess.sys, nw = sys.nw, sub = args[1] || "status";
    if (!resolvedUp(sys)) { errl(io, "Failed to get global data: Unit dbus-org.freedesktop.resolve1.service not found."); return 1; }
    if (sub === "status") {
      var L = ["Global", "         Protocols: -LLMNR -mDNS -DNSOverTLS DNSSEC=no/unsupported", "  resolv.conf mode: stub", ""];
      N.ifList(nw).forEach(function (d) {
        if (d.kind === "loopback") return;
        var dn = nw.linkDns[d.name], up = d.admin && N.linkOf(nw, d).carrier;
        L.push("Link " + d.idx + " (" + d.name + ")");
        L.push("    Current Scopes: " + (dn && up ? "DNS" : "none"));
        L.push("         Protocols: " + (dn && up ? "+DefaultRoute" : "-DefaultRoute") + " -LLMNR -mDNS -DNSOverTLS DNSSEC=no/unsupported");
        if (dn && up && dn.servers.length) { L.push("Current DNS Server: " + dn.servers[0], "       DNS Servers: " + dn.servers.join(" ")); }
        if (dn && up && dn.search.length) L.push("        DNS Domain: " + dn.search.join(" "));
        L.push("");
      });
      out(io, joinLines(L));
      return 0;
    }
    if (sub === "dns") {
      if (!args[2]) { N.ifList(nw).forEach(function (d) { out(io, "Link " + d.idx + " (" + d.name + "): " + ((nw.linkDns[d.name] || {}).servers || []).join(" ") + "\n"); }); return 0; }
      if (!args[3]) { var dd = nw.linkDns[args[2]]; out(io, "Link " + (nw.ifs[args[2]] || {}).idx + " (" + args[2] + "): " + (dd ? dd.servers.join(" ") : "") + "\n"); return 0; }
      if (sess.uid !== 0) { errl(io, "Failed to set DNS configuration: Access denied"); return 1; }
      if (!nw.ifs[args[2]]) { errl(io, "Failed to resolve interface \"" + args[2] + "\": No such device"); return 1; }
      nw.linkDns[args[2]] = { servers: args.slice(3), search: (nw.linkDns[args[2]] || { search: [] }).search };
      return 0;
    }
    if (sub === "flush-caches") { if (sess.uid !== 0) { errl(io, "Failed to flush caches: Access denied"); return 1; } if (sys.nw.poison) delete sys.nw.poison["127.0.0.53"]; sys.nw.cacheFlushed = (sys.nw.cacheFlushed || 0) + 1; return 0; }
    if (sub === "query") {
      var nm = args[2]; if (!nm) { errl(io, "resolvectl: query requires an argument"); return 1; }
      var t0 = Date.now ? 0 : 0;
      var r = askServer(sys, "127.0.0.53", nm, "A", {});
      if (r.err || r.status === "SERVFAIL") { errl(io, nm + ": resolve call failed: All attempts to contact name servers or networks failed"); return 1; }
      if (r.status === "NXDOMAIN" || !r.answers.length) { errl(io, nm + ": resolve call failed: '" + nm + "' not found"); return 1; }
      out(io, joinLines(r.answers.map(function (x, i) { return (i ? rpad("", nm.length + 1) : nm + ":") + " " + rpad(x.data, 30) + " -- link: eth0"; })) + (r.chain.length ? "                                (" + r.chain[r.chain.length - 1].data.replace(/\.$/, "") + ")\n" : "") + "\n-- Information acquired via protocol DNS in 23.1ms.\n-- Data is authenticated: no; Data was acquired via local or encrypted transport: no\n-- Data from: network\n");
      return 0;
    }
    if (sub === "statistics") { out(io, "DNSSEC supported by current servers: no\n\nTransactions\nCurrent Transactions: 0\n  Total Transactions: 1824\n"); return 0; }
    errl(io, "Unknown command verb '" + sub + "'."); return 1;
  };

  /* ================================================================== TLS: certificates */
  function b64enc(s) { return typeof btoa === "function" ? btoa(s) : Buffer.from(s, "binary").toString("base64"); }
  function b64dec(s) { return typeof atob === "function" ? atob(s) : Buffer.from(s, "base64").toString("binary"); }
  function wrap64(s) { return s.replace(/(.{64})/g, "$1\n").replace(/\n$/, ""); }
  function pem(c) { return "-----BEGIN CERTIFICATE-----\n" + wrap64(b64enc("\x30\x82\x05\x1a" + JSON.stringify(c))) + "\n-----END CERTIFICATE-----\n"; }
  function keyPem(seed, ec) { return "-----BEGIN PRIVATE KEY-----\n" + wrap64(b64enc("\x30\x81\x87\x02\x01" + M2.hashChars("key:" + seed, 120))) + "\n-----END PRIVATE KEY-----\n"; }
  function parsePems(text) {
    var res = [], re = /-----BEGIN CERTIFICATE-----([\s\S]*?)-----END CERTIFICATE-----/g, m;
    while ((m = re.exec(String(text || "")))) {
      try { var raw = b64dec(m[1].replace(/\s+/g, "")); res.push(JSON.parse(raw.slice(4))); } catch (e) { res.push({ bad: true }); }
    }
    return res;
  }
  N.pem = pem; N.parsePems = parsePems;
  var R11 = "C = US, O = Let's Encrypt, CN = R11", ISRG = "C = US, O = Internet Security Research Group, CN = ISRG Root X1";
  var DIGI = "C = US, O = DigiCert Inc, OU = www.digicert.com, CN = DigiCert Global Root G2", DIGI_I = "C = US, O = DigiCert Inc, CN = DigiCert Global G2 TLS RSA SHA256 2020 CA1";
  var KCA = "C = GB, O = Kestrel Cloud, CN = Kestrel Internal Root CA";
  var TRUST = [ISRG, DIGI, KCA, "C = US, O = Google Trust Services LLC, CN = GTS Root R1", "C = US, ST = New Jersey, L = Jersey City, O = The USERTRUST Network, CN = USERTrust ECC Certification Authority"];
  N.TRUST = TRUST;
  function serial(seed) { return M2.hexOf("serial:" + seed, 36).toUpperCase(); }
  function leaf(cn, sans, nb, na, issuer, o) { return Object.assign({ s: "CN = " + cn, i: issuer || R11, nb: nb, na: na, san: sans, sn: serial(cn + nb), key: "ec256", sig: "sha256WithRSAEncryption" }, o || {}); }
  var INTER = { s: R11, i: ISRG, nb: Date.UTC(2024, 2, 13), na: Date.UTC(2027, 2, 12, 23, 59, 59), sn: serial("R11"), key: "rsa2048", sig: "sha256WithRSAEncryption", ca: true };
  var DIGI_INT = { s: DIGI_I, i: DIGI, nb: Date.UTC(2021, 2, 30), na: Date.UTC(2031, 2, 29, 23, 59, 59), sn: serial("digi"), key: "rsa2048", sig: "sha256WithRSAEncryption", ca: true };
  N.certs = { leaf: leaf, INTER: INTER, R11: R11, ISRG: ISRG, KCA: KCA };
  function d(y, m, dd, h, mi, s) { return Date.UTC(y, m - 1, dd, h || 0, mi || 0, s || 0); }
  var KESTREL_CERT = leaf("kestrel.example.com", ["kestrel.example.com", "www.kestrel.example.com"], d(2026, 10, 20, 8, 12, 44), d(2027, 1, 18, 8, 12, 43));
  var SHOP_CERT = leaf("shop.kestrel.example.com", ["shop.kestrel.example.com"], d(2026, 8, 12, 7, 58, 2), d(2026, 11, 10, 7, 58, 1));
  var SNAKE = { s: "CN = kc-web-01", i: "CN = kc-web-01", nb: d(2026, 11, 2, 10, 12, 50), na: d(2036, 10, 31, 10, 12, 50), san: ["kc-web-01"], sn: serial("snake"), key: "rsa2048", sig: "sha256WithRSAEncryption" };
  var REMOTE_TLS = {
    "93.184.215.14": { chain: [leaf("www.example.org", ["www.example.org", "example.com", "example.net", "example.org", "www.example.com", "www.example.net"], d(2026, 1, 30), d(2027, 3, 1, 23, 59, 59), DIGI_I, { key: "rsa2048" }), DIGI_INT], alpn: "h2" },
    "140.82.121.4": { chain: [leaf("github.com", ["github.com", "www.github.com"], d(2026, 3, 7), d(2027, 3, 7, 23, 59, 59), "C = GB, O = Sectigo Limited, CN = Sectigo ECC Domain Validation Secure Server CA"), { s: "C = GB, O = Sectigo Limited, CN = Sectigo ECC Domain Validation Secure Server CA", i: "C = US, ST = New Jersey, L = Jersey City, O = The USERTRUST Network, CN = USERTrust ECC Certification Authority", nb: d(2018, 11, 2), na: d(2030, 12, 31), ca: true, key: "ec256" }], alpn: "h2" },
    "140.82.121.6": { chain: [leaf("*.github.com", ["*.github.com", "github.com"], d(2026, 3, 7), d(2027, 3, 7, 23, 59, 59), "C = GB, O = Sectigo Limited, CN = Sectigo ECC Domain Validation Secure Server CA"), { s: "C = GB, O = Sectigo Limited, CN = Sectigo ECC Domain Validation Secure Server CA", i: "C = US, ST = New Jersey, L = Jersey City, O = The USERTRUST Network, CN = USERTrust ECC Certification Authority", nb: d(2018, 11, 2), na: d(2030, 12, 31), ca: true, key: "ec256" }], alpn: "h2" },
    "1.1.1.1": { chain: [leaf("cloudflare-dns.com", ["cloudflare-dns.com", "*.cloudflare-dns.com", "one.one.one.one", "1.1.1.1", "1.0.0.1"], d(2026, 1, 2), d(2027, 1, 21, 23, 59, 59), DIGI_I), DIGI_INT], alpn: "h2" },
    "203.0.113.90": { chain: [leaf("api.kestrel.example.com", ["api.kestrel.example.com"], d(2026, 11, 9, 14, 2, 10), d(2027, 2, 7, 14, 2, 9)), INTER], alpn: "h2" },
    "172.16.50.10": { chain: [leaf("partner-api.kestrel.internal", ["partner-api.kestrel.internal"], d(2026, 6, 1), d(2027, 6, 1), KCA, { key: "rsa2048" })], alpn: "http/1.1" },
    "142.250.185.78": { chain: [leaf("*.google.com", ["*.google.com", "google.com"], d(2026, 10, 14), d(2027, 1, 6), "C = US, O = Google Trust Services, CN = WR2"), { s: "C = US, O = Google Trust Services, CN = WR2", i: "C = US, O = Google Trust Services LLC, CN = GTS Root R1", nb: d(2023, 12, 13), na: d(2029, 2, 20), ca: true }], alpn: "h2" },
    "34.160.111.145": { chain: [leaf("ifconfig.me", ["ifconfig.me"], d(2026, 9, 30), d(2026, 12, 29), "C = US, O = Google Trust Services, CN = WR3"), { s: "C = US, O = Google Trust Services, CN = WR3", i: "C = US, O = Google Trust Services LLC, CN = GTS Root R1", nb: d(2023, 12, 13), na: d(2029, 2, 20), ca: true }], alpn: "h2" },
    "185.125.190.36": { chain: [leaf("archive.ubuntu.com", ["archive.ubuntu.com"], d(2026, 9, 1), d(2026, 11, 30)), INTER], alpn: "http/1.1" }
  };
  N.REMOTE_TLS = REMOTE_TLS;
  function selfTarget(sys, ip) { return N.isOwn(sys.nw, ip) || ip === PUB || ip === "10.20.0.10" || ip === "203.0.113.90" && false; }
  // nginx serves TLS on kc-web-01 with the certificate files it read at its last start or reload
  function tlsSnap(sys) {
    var nw = sys.nw, live = sys.nginxLive;
    if (!live) return null;
    if (nw.tlsLive !== live) {
      nw.tlsLive = live;
      nw.tlsFiles = {};
      live.servers.forEach(function (s) { (s.d || []).forEach(function (dd) { if (dd.name === "ssl_certificate") nw.tlsFiles[dd.args[0]] = rd(sys, dd.args[0]); }); });
    }
    return nw.tlsFiles;
  }
  N.tlsSnap = tlsSnap;
  // TLS handshake with ip:port, sending SNI. Returns {ok, err: refused|timeout|notls, chain, alpn, version, cipher, served}
  var TLS_ORDER = ["TLSv1.3", "TLSv1.2", "TLSv1.1", "TLSv1"], TLS_CIPHER = { "TLSv1.3": "TLS_AES_256_GCM_SHA384", "TLSv1.2": "ECDHE-RSA-AES256-GCM-SHA384", "TLSv1.1": "ECDHE-RSA-AES256-SHA", "TLSv1": "ECDHE-RSA-AES256-SHA" };
  function tlsRank(v) { return { "TLSv1": 0, "TLSv1.0": 0, "TLSv1.1": 1, "TLSv1.2": 2, "TLSv1.3": 3 }[v]; }
  // pick a version both sides allow; Ubuntu's OpenSSL (security level 2) refuses anything below TLS 1.2 unless told otherwise
  function tlsPick(serverProtos, want, res) {
    want = want || {};
    var client = TLS_ORDER.filter(function (v) { var k = tlsRank(v); if (want.only) return k === tlsRank(want.only); return (want.min == null || k >= tlsRank(want.min)) && (want.max == null || k <= tlsRank(want.max)); });
    if (!want.seclevel0) client = client.filter(function (v) { return tlsRank(v) >= 2; });
    if (!client.length) return { err: "noproto" };
    var v = client.filter(function (x) { return serverProtos.indexOf(x) >= 0; })[0];
    if (!v) return { err: "protocol" };
    res.version = v; res.cipher = TLS_CIPHER[v]; return res;
  }
  N.tlsPick = tlsPick;
  function tlsConnect(sys, ip, port, sni, want) {
    if (selfTarget(sys, ip)) {
      if (N.preTcp) { var pt0 = N.preTcp(sys, ip, port, "tcp"); if (pt0) return pt0; }
      var local = /^127\./.test(ip) ? ip : "10.20.0.15";
      var c = M2.tcpConnect(sys, local, port);
      if (c.refused) return { err: "refused" };
      var live = sys.nginxLive;
      if (!c.proc || c.proc.unit !== "nginx.service" || !live) return { err: "notls" };
      var cands = live.servers.filter(function (s) { return s.listens.some(function (l) { return l.port === port && l.ssl; }); });
      if (!cands.length) return { err: "notls" };
      var h = String(sni || "").toLowerCase();
      var srv = (h && cands.filter(function (s) { return s.names.some(function (n) { return n.toLowerCase() === h; }); })[0]) || cands.filter(function (s) { return s.listens.some(function (l) { return l.port === port && l.def; }); })[0] || cands[0];
      var cp = (srv.d.filter(function (dd) { return dd.name === "ssl_certificate"; })[0] || { args: [] }).args[0];
      var files = tlsSnap(sys) || {};
      var chain = parsePems(files[cp] || "");
      var h2 = srv.d.some(function (dd) { return dd.name === "http2" && dd.args[0] === "on"; }) || srv.listens.some(function (l) { return l.http2; });
      var spd = srv.d.filter(function (dd) { return dd.name === "ssl_protocols"; })[0] || ((live.http && live.http.block) || []).filter(function (dd) { return dd.name === "ssl_protocols"; })[0];
      var protos = spd ? spd.args.map(function (x) { return x === "TLSv1.0" ? "TLSv1" : x; }) : ["TLSv1.2", "TLSv1.3"];
      return tlsPick(protos, want, { ok: true, chain: chain, alpn: h2 ? "h2" : "http/1.1", version: "TLSv1.3", cipher: "TLS_AES_256_GCM_SHA384", server: srv.names[0], certPath: cp, protocols: protos });
    }
    if (isV6(ip) && W.V6HOSTS[v6norm(ip)]) ip = W.V6HOSTS[v6norm(ip)].v4;
    var hs2 = N.HOSTSVC && N.HOSTSVC(sys, ip);
    if (hs2 && hs2[port]) { var sv2 = hs2[port]; if (!sv2.tls) return { err: "notls" }; return { ok: true, chain: sv2.tls, alpn: sv2.alpn || "http/1.1", version: "TLSv1.3", cipher: "TLS_AES_256_GCM_SHA384", starttls: sv2.starttls, clientCert: sv2.clientCert }; }
    var t = REMOTE_TLS[ip];
    if (!t) { var hh = M2.net.HOSTS[ip]; if (hh && hh.ports.indexOf(port) >= 0 && port === 443) t = { chain: [leaf(sni || ip, [sni || ip], d(2026, 9, 1), d(2026, 12, 30)), INTER], alpn: "h2" }; }
    if (!t || port !== 443 && !(ip === "172.16.50.10" && port === 443)) return { err: t ? "notls" : "notls" };
    return tlsPick(["TLSv1.2", "TLSv1.3"], want, { ok: true, chain: t.chain, alpn: t.alpn, version: "TLSv1.3", cipher: "TLS_AES_256_GCM_SHA384" });
  }
  N.tlsConnect = tlsConnect;
  function nameMatch(c, host) {
    host = String(host || "").toLowerCase();
    var names = (c.san || []).length ? c.san : [String(c.s).replace(/^.*CN = /, "")];
    return names.some(function (n) { n = n.toLowerCase(); if (n === host) return true; if (n.indexOf("*.") === 0) { var rest = n.slice(2); var hh = host.split("."); return hh.length > 2 && hh.slice(1).join(".") === rest; } return false; });
  }
  // OpenSSL-style verification: dates, chain to a trusted root. Hostname is checked by the client (curl), not s_client.
  function verify(sys, chain) {
    if (!chain.length || chain[0].bad) return { code: 20, text: "unable to get local issuer certificate", depth: 0 };
    var now = sys.now, trust = TRUST.concat(sys.nw.extraTrust || []);
    for (var i = 0; i < chain.length; i++) {
      var c = chain[i];
      if (now > c.na) return { code: 10, text: "certificate has expired", depth: i };
      if (now < c.nb) return { code: 9, text: "certificate is not yet valid", depth: i };
    }
    var top = chain[chain.length - 1];
    if (top.s === top.i) return trust.indexOf(top.s) >= 0 ? { code: 0, text: "ok" } : { code: chain.length === 1 ? 18 : 19, text: chain.length === 1 ? "self-signed certificate" : "self-signed certificate in certificate chain", depth: chain.length - 1 };
    if (trust.indexOf(top.i) >= 0) return { code: 0, text: "ok" };
    return { code: 20, text: "unable to get local issuer certificate", depth: chain.length - 1 };
  }
  N.verifyChain = verify; N.nameMatch = nameMatch;
  function gmt(ms) { var x = new Date(ms); return MON[x.getUTCMonth()] + " " + pad(x.getUTCDate(), 2) + " " + tod(ms) + " " + x.getUTCFullYear() + " GMT"; }
  N.gmt = gmt;
  function keyDesc(c) { return /^ec/.test(c.key) ? "PKEY: id-ecPublicKey, 256 (bit); sigalg: " + (c.ca ? "RSA-SHA256" : "ecdsa-with-SHA384") : "PKEY: rsaEncryption, 2048 (bit); sigalg: RSA-SHA256"; }

  /* ---------------- openssl s_client, x509 */
  var opensslPrev = CMDS.openssl;
  CMDS.openssl = function (args, io, sess) {
    var v = args[1];
    if (v === "s_client") return sClient(args.slice(2), io, sess);
    if (v === "x509") return x509(args.slice(2), io, sess);
    if (v === "base64" || v === "enc" && args.indexOf("-base64") >= 0) return CMDS.base64(["base64"].concat(args.indexOf("-d") >= 0 ? ["-d"] : []).concat(args.indexOf("-in") >= 0 ? [args[args.indexOf("-in") + 1]] : []), io, sess);
    return opensslPrev(args, io, sess);
  };
  function sClient(a, io, sess) {
    var sys = sess.sys, connect = null, sni, showcerts = false, brief = false, noSni = false, quiet = false, want = {};
    for (var i = 0; i < a.length; i++) {
      var x = a[i];
      if (/^-tls1(_[123])?$/.test(x)) { want.only = { "-tls1": "TLSv1", "-tls1_1": "TLSv1.1", "-tls1_2": "TLSv1.2", "-tls1_3": "TLSv1.3" }[x]; continue; }
      if (x === "-no_tls1_3") { want.max = "TLSv1.2"; continue; }
      if (x === "-cipher" || x === "-ciphersuites") { if (/SECLEVEL=[01]/.test(a[i + 1] || "")) want.seclevel0 = true; i++; continue; }
      if (x === "-connect") connect = a[++i]; else if (x === "-servername") sni = a[++i]; else if (x === "-noservername") noSni = true; else if (x === "-showcerts") showcerts = true; else if (x === "-brief") brief = true; else if (x === "-quiet") quiet = true;
      else if (/^-(tls1_[23]|tls1|ign_eof|crlf|no_ign_eof|status)$/.test(x)) continue; else if (/^-(alpn|verify|CAfile|cert|key|starttls|verify_hostname)$/.test(x)) i++;
      else if (!/^-/.test(x) && !connect) connect = x;
      else { errl(io, "s_client: Unknown option: " + x + "\ns_client: Use -help for summary."); return 1; }
    }
    if (!connect) connect = "localhost:4433";
    var m = /^(\[[^\]]+\]|[^:]+)(?::(\d+))?$/.exec(connect), host = m[1].replace(/^\[|\]$/g, ""), port = m[2] ? +m[2] : 443;
    if (sni === undefined && !noSni && !isV4(host) && !isV6(host)) sni = host;
    var g = getaddrinfo(sys, host, 4);
    if (g.err) { errl(io, "40A7E3B1D27F0000:error:10080002:BIO routines:BIO_lookup_ex:system lib:../crypto/bio/bio_addr.c:738:" + g.err + "\nconnect:errno=0"); return 1; }
    var ip = g.ip, r = reach(sys, ip, { port: port });
    if (!r.ok && !r.tcpOk) { errl(io, "40F7E1A9C77F0000:error:8000006" + (r.err === "netunreach" ? "5:system library:BIO_connect:Network is unreachable" : "E:system library:BIO_connect:Connection timed out") + ":../crypto/bio/bio_sock2.c:114:calling connect()\n40F7E1A9C77F0000:error:10000067:BIO routines:BIO_connect:connect error:../crypto/bio/bio_sock2.c:116:\nconnect:errno=" + (r.err === "netunreach" ? 101 : 110)); ev(sys, { k: "tls", host: host, ok: false, path: r.path, fail: r.fail, layer: 6 }); return 1; }
    var t = tlsConnect(sys, ip, port, sni, want);
    if (t.err === "noproto") { out(io, "CONNECTED(00000003)\n"); errl(io, "40F7E1A9C77F0000:error:0A0000BF:SSL routines:tls_setup_handshake:no protocols available:../ssl/statem/statem_lib.c:104:"); out(io, "---\nno peer certificate available\n---\nNo client certificate CA names sent\n---\nSSL handshake has read 0 bytes and written 0 bytes\nVerification: OK\n---\nNew, (NONE), Cipher is (NONE)\nSecure Renegotiation IS NOT supported\nCompression: NONE\nExpansion: NONE\nNo ALPN negotiated\nEarly data was not sent\nVerify return code: 0 (ok)\n---\n"); note(io, "(Ubuntu's OpenSSL refuses TLS 1.0 and 1.1 itself, at security level 2. To test whether a server still accepts them, add -cipher 'DEFAULT@SECLEVEL=0'.)"); return 1; }
    if (t.err === "protocol") { out(io, "CONNECTED(00000003)\n"); errl(io, "40F7E1A9C77F0000:error:0A00042E:SSL routines:ssl3_read_bytes:tlsv1 alert protocol version:../ssl/record/rec_layer_s3.c:1593:SSL alert number 70"); out(io, "---\nno peer certificate available\n---\nNo client certificate CA names sent\n---\nSSL handshake has read 7 bytes and written 210 bytes\nVerification: OK\n---\nNew, (NONE), Cipher is (NONE)\nSecure Renegotiation IS NOT supported\nCompression: NONE\nExpansion: NONE\nNo ALPN negotiated\nEarly data was not sent\nVerify return code: 0 (ok)\n---\n"); ev(sys, { k: "tls", host: host, ok: false, path: r.path, layer: 6 }); return 1; }
    if (t.err === "refused" || (t.err === "notls" && !selfTarget(sys, ip) && !(M2.net.HOSTS[ip] && M2.net.HOSTS[ip].ports.indexOf(port) >= 0) && !(W.SEGS.srv.peers[ip] || {}).ports)) { errl(io, "40F7E1A9C77F0000:error:8000006F:system library:BIO_connect:Connection refused:../crypto/bio/bio_sock2.c:114:calling connect()\n40F7E1A9C77F0000:error:10000067:BIO routines:BIO_connect:connect error:../crypto/bio/bio_sock2.c:116:\nconnect:errno=111"); ev(sys, { k: "tls", host: host, ok: false, path: r.path, fail: r.node || "inet", layer: 4 }); return 1; }
    if (t.err === "notls") { out(io, "CONNECTED(00000003)\n"); errl(io, "40D7A2B3C47F0000:error:0A00010B:SSL routines:ssl3_get_record:wrong version number:../ssl/record/ssl3_record.c:354:"); out(io, "---\nno peer certificate available\n---\nNo client certificate CA names sent\n---\nSSL handshake has read 5 bytes and written 312 bytes\nVerification: OK\n---\nNew, (NONE), Cipher is (NONE)\nSecure Renegotiation IS NOT supported\nCompression: NONE\nExpansion: NONE\nNo ALPN negotiated\nEarly data was not sent\nVerify return code: 0 (ok)\n---\n"); ev(sys, { k: "tls", host: host, ok: false, notls: true, path: r.path, layer: 6 }); return 1; }
    var chain = t.chain, vr = verify(sys, chain);
    // the verify callback lines go to stderr, from the top of the chain down
    var V = [];
    for (var k = chain.length - 1; k >= 0; k--) {
      var c = chain[k];
      if (k === chain.length - 1 && c.s !== c.i && TRUST.indexOf(c.i) >= 0) { V.push("depth=" + (k + 1) + " " + c.i, "verify return:1"); }
      V.push("depth=" + k + " " + c.s);
      if (vr.code && vr.depth === k) { V.push("verify error:num=" + vr.code + ":" + vr.text); if (vr.code === 10) V.push("notAfter=" + gmt(c.na)); }
      V.push("verify return:1");
    }
    if (!brief && !quiet) out(io, "CONNECTED(00000003)\n");
    if (!brief) errl(io, V.join("\n"));
    var leafC = chain[0];
    if (brief) {
      errl(io, "CONNECTION ESTABLISHED\nProtocol version: " + t.version + "\nCiphersuite: " + t.cipher + "\nPeer certificate: " + leafC.s + "\nHash used: SHA256\nSignature type: " + (/^ec/.test(leafC.key) ? "ECDSA" : "RSA-PSS") + "\nVerification" + (vr.code ? " error: " + vr.text : ": OK") + "\nServer Temp Key: X25519, 253 bits");
    } else if (!quiet) {
      var L = ["---", "Certificate chain"];
      chain.forEach(function (c, i2) { L.push(" " + i2 + " s:" + c.s, "   i:" + c.i, "   a:" + keyDesc(c), "   v:NotBefore: " + gmt(c.nb) + "; NotAfter: " + gmt(c.na)); if (showcerts) L.push(pem(c).replace(/\n$/, "")); });
      L.push("---", "Server certificate");
      L.push(pem(leafC).replace(/\n$/, ""));
      L.push("subject=" + leafC.s, "issuer=" + leafC.i, "---", "No client certificate CA names sent", "Peer signing digest: SHA256", "Peer signature type: " + (/^ec/.test(leafC.key) ? "ECDSA" : "RSA-PSS"), "Server Temp Key: X25519, 253 bits", "---",
        "SSL handshake has read " + (1400 + chain.length * 1200) + " bytes and written 403 bytes", "Verification" + (vr.code ? " error: " + vr.text : ": OK"), "---", "New, " + t.version + ", Cipher is " + t.cipher, "Server public key is " + (/^ec/.test(leafC.key) ? 256 : 2048) + " bit",
        "Secure Renegotiation IS NOT supported", "Compression: NONE", "Expansion: NONE", "No ALPN negotiated", "Early data was not sent", "Verify return code: " + vr.code + " (" + vr.text + ")", "---");
      out(io, joinLines(L));
    }
    var stdinGiven = io.stdin != null || io.pipedIn;
    if (stdinGiven) out(io, "DONE\n");
    else note(io, "(s_client keeps the connection open so you can type a request; the lab closed it. Feed it no input with </dev/null or echo | to make it quit at once.)");
    ev(sys, { k: "tls", host: host, sni: sni, ok: vr.code === 0, verify: vr.text, cert: leafC.s, path: r.path, layer: 6 });
    return 0;
  }
  function x509(a, io, sess) {
    var file = null, want = [], noout = false, text = false, checkend = null, extReq = null;
    for (var i = 0; i < a.length; i++) {
      var x = a[i];
      if (x === "-in") file = a[++i]; else if (x === "-noout") noout = true; else if (x === "-text") text = true; else if (x === "-checkend") checkend = +a[++i]; else if (x === "-ext") extReq = a[++i];
      else if (/^-(subject|issuer|dates|enddate|startdate|serial|fingerprint|email|pubkey|issuer_hash|subject_hash)$/.test(x)) want.push(x.slice(1)); else if (/^-(sha256|sha1|md5|nameopt|inform|outform)$/.test(x)) { if (/nameopt|inform|outform/.test(x)) i++; }
      else { errl(io, "x509: Unknown option or message digest: " + x.replace(/^-/, "") + "\nx509: Use -help for summary."); return 1; }
    }
    var content;
    if (file) { var r = S.readFile(sess, file); if (r.error) { errl(io, "Could not open file or uri for loading certificate from " + file + "\n40B7C1F2D47F0000:error:16000069:STORE routines:ossl_store_get0_loader_int:unregistered scheme:../crypto/store/store_register.c:237:scheme=file\n40B7C1F2D47F0000:error:80000002:system library:file_open:No such file or directory:../providers/implementations/storemgmt/file_store.c:267:calling stat(" + file + ")\nUnable to load certificate"); return 1; } content = r.content; }
    else content = io.stdin || "";
    var c = parsePems(content)[0];
    if (!c || c.bad) { errl(io, "Could not read certificate from " + (file || "<stdin>") + "\nUnable to load certificate"); return 1; }
    var L = [];
    if (text) {
      L.push("Certificate:", "    Data:", "        Version: 3 (0x2)", "        Serial Number:", "            " + c.sn.toLowerCase().match(/../g).join(":"), "        Signature Algorithm: " + (c.sig || "sha256WithRSAEncryption"), "        Issuer: " + c.i, "        Validity", "            Not Before: " + gmt(c.nb), "            Not After : " + gmt(c.na), "        Subject: " + c.s,
        "        Subject Public Key Info:", "            Public Key Algorithm: " + (/^ec/.test(c.key) ? "id-ecPublicKey" : "rsaEncryption"), "                Public-Key: (" + (/^ec/.test(c.key) ? 256 : 2048) + " bit)", "        X509v3 extensions:");
      if (c.ca) L.push("            X509v3 Basic Constraints: critical", "                CA:TRUE, pathlen:0");
      else L.push("            X509v3 Key Usage: critical", "                Digital Signature" + (/^ec/.test(c.key) ? "" : ", Key Encipherment"), "            X509v3 Extended Key Usage: ", "                TLS Web Server Authentication, TLS Web Client Authentication", "            X509v3 Basic Constraints: critical", "                CA:FALSE");
      if (c.san) L.push("            X509v3 Subject Alternative Name: ", "                " + c.san.map(function (n) { return isV4(n) ? "IP Address:" + n : "DNS:" + n; }).join(", "));
      if (/Let's Encrypt/.test(c.i)) L.push("            Authority Information Access: ", "                CA Issuers - URI:http://r11.i.lencr.org/");
      L.push("    Signature Algorithm: " + (c.sig || "sha256WithRSAEncryption"), "    Signature Value:", "        " + M2.hexOf("sig" + c.sn, 32).match(/../g).join(":"));
    }
    want.forEach(function (w) {
      if (w === "subject") L.push("subject=" + c.s); else if (w === "issuer") L.push("issuer=" + c.i);
      else if (w === "dates") L.push("notBefore=" + gmt(c.nb), "notAfter=" + gmt(c.na)); else if (w === "enddate") L.push("notAfter=" + gmt(c.na)); else if (w === "startdate") L.push("notBefore=" + gmt(c.nb));
      else if (w === "serial") L.push("serial=" + c.sn); else if (w === "fingerprint") L.push("sha1 Fingerprint=".replace("sha1", a.indexOf("-sha256") >= 0 ? "sha256" : "sha1") + M2.hexOf("fp" + c.sn + (a.indexOf("-sha256") >= 0 ? 2 : 1), a.indexOf("-sha256") >= 0 ? 64 : 40).toUpperCase().match(/../g).join(":"));
    });
    if (extReq) { if (/subjectAltName/.test(extReq)) { if (c.san) L.push("X509v3 Subject Alternative Name: ", "    " + c.san.map(function (n) { return isV4(n) ? "IP Address:" + n : "DNS:" + n; }).join(", ")); else L.push("No extensions matched with -ext " + extReq); } }
    if (!noout && !text && checkend === null) L.push(pem(c).replace(/\n$/, ""));
    if (L.length) out(io, joinLines(L));
    if (checkend !== null) { var exp = sess.sys.now + checkend * 1000 > c.na; out(io, exp ? "Certificate will expire\n" : "Certificate will not expire\n"); return exp ? 1 : 0; }
    return 0;
  }

  /* ---------------- certbot (Let's Encrypt over HTTP-01, webroot) */
  var DASH = "- - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -";
  function leCerts(sys) {
    var dir = nodeAt(sys, "/etc/letsencrypt/renewal");
    if (!dir) return [];
    return Object.keys(dir.children).filter(function (n) { return /\.conf$/.test(n); }).sort().map(function (n) {
      var name = n.replace(/\.conf$/, ""), conf = rd(sys, "/etc/letsencrypt/renewal/" + n) || "", c = parsePems(rd(sys, "/etc/letsencrypt/live/" + name + "/cert.pem") || "")[0] || {};
      var webroot = (/webroot_path\s*=\s*(.+?),?\s*$/m.exec(conf) || [])[1] || "/var/www/letsencrypt";
      return { name: name, conf: conf, cert: c, webroot: webroot.trim() };
    });
  }
  CMDS.certbot = function (args, io, sess) {
    var sys = sess.sys, a = args.slice(1), sub = a[0] && !/^-/.test(a[0]) ? a[0] : null, dry = a.indexOf("--dry-run") >= 0, force = a.indexOf("--force-renewal") >= 0, ci = a.indexOf("--cert-name"), only = ci >= 0 ? a[ci + 1] : null;
    if (!sub) { errl(io, "Saving debug log to /var/log/letsencrypt/letsencrypt.log"); note(io, "(Plain certbot asks questions to get a new certificate. In this lab use: certbot certificates, certbot renew [--dry-run] [--cert-name NAME].)"); return 1; }
    if (sess.uid !== 0) { errl(io, "The following error was encountered:\n[Errno 13] Permission denied: '/var/log/letsencrypt/.certbot.lock'\nEither run as root, or set --config-dir, --work-dir, and --logs-dir to writeable paths."); return 1; }
    errl(io, "Saving debug log to /var/log/letsencrypt/letsencrypt.log");
    var certs = leCerts(sys);
    if (sub === "certificates") {
      var L = ["", DASH, "Found the following certs:"];
      certs.forEach(function (c) {
        var days = Math.floor((c.cert.na - sys.now) / DAY), exp = new Date(c.cert.na).toISOString().replace("T", " ").replace(/\.\d+Z$/, "+00:00");
        L.push("  Certificate Name: " + c.name, "    Serial Number: " + String(c.cert.sn || "").toLowerCase().replace(/^0+/, ""), "    Key Type: " + (/^ec/.test(c.cert.key) ? "ECDSA" : "RSA"), "    Domains: " + (c.cert.san || []).join(" "), "    Expiry Date: " + exp + (days < 0 ? " (INVALID: EXPIRED)" : " (VALID: " + days + " days)"), "    Certificate Path: /etc/letsencrypt/live/" + c.name + "/fullchain.pem", "    Private Key Path: /etc/letsencrypt/live/" + c.name + "/privkey.pem");
      });
      L.push(DASH);
      out(io, joinLines(L));
      return 0;
    }
    if (sub !== "renew") { errl(io, "certbot: error: unrecognized arguments: " + sub); return 2; }
    var done = [], skipped = [], failed = [];
    var L2 = [];
    certs.filter(function (c) { return !only || c.name === only; }).forEach(function (c) {
      L2.push("", DASH, "Processing /etc/letsencrypt/renewal/" + c.name + ".conf", DASH);
      var due = force || dry || c.cert.na - sys.now < 30 * DAY;
      if (!due) { L2.push("Certificate not yet due for renewal"); skipped.push(c); return; }
      L2.push((dry ? "Simulating renewal of an existing certificate for " : "Renewing an existing certificate for ") + (c.cert.san || [c.name]).join(" and "));
      // talk to the ACME server, then let it fetch the challenge over HTTP from our public address
      var acmeName = getaddrinfo(sys, "acme-v02.api.letsencrypt.org", 4);
      if (acmeName.err) { L2.push("An unexpected error occurred:", "requests.exceptions.ConnectionError: HTTPSConnectionPool(host='acme-v02.api.letsencrypt.org', port=443): Max retries exceeded with url: /directory (Caused by NameResolutionError(\"<urllib3.connection.HTTPSConnection object at 0x7f3a2c1d5e50>: Failed to resolve 'acme-v02.api.letsencrypt.org' ([Errno -3] " + acmeName.err + ")\"))"); failed.push(c); return; }
      var api = tcpOpen(sys, acmeName.ip, 443);
      if (api.err) { L2.push("An unexpected error occurred:", "requests.exceptions.ConnectionError: HTTPSConnectionPool(host='acme-v02.api.letsencrypt.org', port=443): Max retries exceeded with url: /directory (Caused by NewConnectionError('<urllib3.connection.HTTPSConnection object at 0x7f3a2c1d5e50>: Failed to establish a new connection: [Errno " + (api.err === "netunreach" ? "101] Network is unreachable" : api.err === "hostunreach" ? "113] No route to host" : "110] Connection timed out") + "'))"); failed.push(c); return; }
      var token = M2.hashChars("acme" + c.name + sys.cmdIndex, 43);
      var dir = c.webroot.replace(/\/$/, "") + "/.well-known/acme-challenge";
      S.mkdirs(sys, dir, 493, 0, 0);
      putRoot(sys, dir + "/" + token, token + ".kX9-thumbprint\n", 420);
      var bad = null;
      (c.cert.san || [c.name]).forEach(function (dom) {
        if (bad) return;
        var resp = httpTo(sys, PUB, 80, { scheme: "http", host: dom, port: 80, path: "/.well-known/acme-challenge/" + token, method: "GET", headers: { host: dom, "user-agent": "Mozilla/5.0 (compatible; Let's Encrypt validation server; +https://www.letsencrypt.org)", accept: "*/*" } });
        if (resp.err) bad = { dom: dom, type: "connection", detail: PUB + ": Fetching http://" + dom + "/.well-known/acme-challenge/" + token + ": Connection refused" };
        else if (resp.status !== 200 || String(resp.body).trim() !== token + ".kX9-thumbprint") bad = { dom: dom, type: "unauthorized", detail: PUB + ": Invalid response from http://" + dom + "/.well-known/acme-challenge/" + token + ": " + resp.status };
      });
      M2.rmRoot(sys, dir + "/" + token);
      if (bad) {
        L2.push("", "Certbot failed to authenticate some domains (authenticator: webroot). The Certificate Authority reported these problems:", "  Domain: " + bad.dom, "  Type:   " + bad.type, "  Detail: " + bad.detail, "", "Hint: The Certificate Authority failed to download the temporary challenge files created by Certbot. Ensure that the listed domains serve their content from the provided --webroot-path/-w and that files created there can be downloaded from the internet.", "", "Failed to renew certificate " + c.name + " with error: Some challenges have failed.");
        failed.push(c); return;
      }
      if (!dry) {
        var nc = Object.assign({}, c.cert, { nb: sys.now - 3600000, na: sys.now - 3600000 + 90 * DAY - 1000, sn: serial(c.name + sys.now + sys.cmdIndex) });
        var live = "/etc/letsencrypt/live/" + c.name;
        putRoot(sys, live + "/cert.pem", pem(nc), 420); putRoot(sys, live + "/chain.pem", pem(INTER), 420); putRoot(sys, live + "/fullchain.pem", pem(nc) + pem(INTER), 420); putRoot(sys, live + "/privkey.pem", keyPem(c.name + sys.now + sys.cmdIndex), 384);
        sys.nw.renewed = (sys.nw.renewed || []).concat([c.name]);
      }
      done.push(c);
    });
    L2.push("", DASH);
    if (skipped.length) { L2.push("The following certificates are not due for renewal yet:"); skipped.forEach(function (c) { L2.push("  /etc/letsencrypt/live/" + c.name + "/fullchain.pem expires on " + new Date(c.cert.na).toISOString().slice(0, 10) + " (skipped)"); }); }
    if (done.length) { L2.push(dry ? "Congratulations, all simulated renewals succeeded: " : failed.length ? "The following renewals succeeded:" : "Congratulations, all renewals succeeded: "); done.forEach(function (c) { L2.push("  /etc/letsencrypt/live/" + c.name + "/fullchain.pem (success)"); }); }
    if (failed.length) { L2.push("All renewals failed. The following certificates could not be renewed:".replace("All renewals failed", done.length ? "Some renewals failed" : "All renewals failed")); failed.forEach(function (c) { L2.push("  /etc/letsencrypt/live/" + c.name + "/fullchain.pem (failure)"); }); }
    if (!done.length && !failed.length && !skipped.length) L2.push("No simulated renewals were attempted.");
    L2.push(DASH);
    if (failed.length) L2.push(failed.length + " renew failure(s), 0 parse failure(s)", "Ask for help or search for solutions at https://community.letsencrypt.org. See the logfile /var/log/letsencrypt/letsencrypt.log or re-run Certbot with -v for more details.");
    out(io, joinLines(L2));
    if (done.length && !dry) note(io, "(The new files are on disk, but nginx still serves the certificate it loaded at its last start or reload.)");
    ev(sys, { k: "tls", what: "certbot", ok: !failed.length, path: ["you", "sw", "gw", "inet"], layer: 6 });
    return failed.length ? 1 : 0;
  };

  /* ================================================================== HTTP */
  var REASON = { 200: "OK", 201: "Created", 204: "No Content", 301: "Moved Permanently", 302: "Found", 304: "Not Modified", 400: "Bad Request", 401: "Unauthorized", 403: "Forbidden", 404: "Not Found", 405: "Method Not Allowed", 500: "Internal Server Error", 502: "Bad Gateway", 503: "Service Temporarily Unavailable", 504: "Gateway Time-out" };
  function httpDate(ms) { var x = new Date(ms); return WDAY[x.getUTCDay()] + ", " + pad(x.getUTCDate(), 2, "0") + " " + MON[x.getUTCMonth()] + " " + x.getUTCFullYear() + " " + tod(ms) + " GMT"; }
  // Servers on our network that the Linux simulation doesn't know about
  var MYSITES = {
    "10.20.5.10:9090": function (req) { return req.path === "/-/healthy" ? { status: 200, headers: { "Content-Type": "text/plain; charset=utf-8" }, body: "Prometheus Server is Healthy.\n" } : { status: 302, headers: { Location: "/graph", "Content-Type": "text/html; charset=utf-8" }, body: "<a href=\"/graph\">Found</a>.\n\n" }; },
    "172.16.50.10:443": function (req) { return req.path.split("?")[0] === "/v1/status" ? { status: 200, headers: { "Content-Type": "application/json", Server: "envoy" }, body: "{\"status\":\"ok\",\"partner\":\"Northwind Logistics\",\"region\":\"eu-west\"}\n" } : { status: 404, headers: { "Content-Type": "application/json", Server: "envoy" }, body: "{\"error\":\"not found\"}\n" }; },
    "203.0.113.90:443": function (req) { var p = req.path.split("?")[0]; return p === "/v2/health" ? { status: 200, headers: { "Content-Type": "application/json", Server: "awselb/2.0" }, body: "{\"status\":\"ok\",\"version\":\"2.0.0\"}\n" } : p.indexOf("/v2/") === 0 ? { status: 200, headers: { "Content-Type": "application/json", Server: "awselb/2.0" }, body: "{\"orders\":[7731,7732],\"version\":\"2.0.0\"}\n" } : { status: 404, headers: { "Content-Type": "application/json", Server: "awselb/2.0" }, body: "{\"error\":\"not found\"}\n" }; },
    "203.0.113.90:80": function (req) { return { status: 301, headers: { Location: "https://" + (req.headers.host || "api.kestrel.example.com") + req.path, "Content-Type": "text/html", Server: "awselb/2.0" }, body: "<html>\r\n<head><title>301 Moved Permanently</title></head>\r\n<body>\r\n<center><h1>301 Moved Permanently</h1></center>\r\n</body>\r\n</html>\r\n" }; }
  };
  N.MYSITES = MYSITES;
  var LISTEN_EXTRA = { "10.20.0.21": [22, 5432], "10.20.0.31": [22, 873], "10.20.5.10": [22, 9090], "172.16.50.10": [443], "203.0.113.90": [80, 443], "10.20.30.31": [22, 873], "10.20.20.2": [22, 443], "10.20.0.10": [22, 80, 443], "10.20.0.2": [53] };
  // One TCP connection's worth of HTTP: {status, headers, body} or {err: {code, msg}}
  function httpTo(sys, ip, port, req) {
    if (selfTarget(sys, ip)) {
      var local = /^127\./.test(ip) ? ip : "10.20.0.15";
      var r = M2.httpRequest(sys, Object.assign({}, req, { resolveTo: local, port: port }));
      return r;
    }
    var hs3 = N.HOSTSVC && N.HOSTSVC(sys, ip), sv3 = hs3 && hs3[port];
    if (sv3) { if (!sv3.http) return { err: { code: 1, msg: "Received HTTP/0.9 when not allowed" } }; var y = sv3.http(req); y.headers = Object.assign({ Date: httpDate(sys.now) }, y.headers); y.headers["Content-Length"] = String(bytes(y.body)); return y; }
    var f = MYSITES[ip + ":" + port];
    if (f) { var x = f(req); x.headers = Object.assign({ Date: httpDate(sys.now) }, x.headers); x.headers["Content-Length"] = String(bytes(x.body)); return x; }
    var v4 = isV6(ip) && W.V6HOSTS[v6norm(ip)] ? W.V6HOSTS[v6norm(ip)].v4 : ip;
    return M2.httpRequest(sys, Object.assign({}, req, { resolveTo: v4, port: port }));
  }
  N.httpTo = httpTo;
  M2.net.SITES.kestrel = function (req, sys) { var r = M2.httpRequest(sys, Object.assign({}, req, { resolveTo: "10.20.0.15" })); return r.err ? { status: 502, headers: { "Content-Type": "text/plain" }, body: "" } : r; };
  // Can a TCP connection be opened? {ok} or {err: refused|timeout|netunreach|hostunreach, r}
  function tcpOpen(sys, ip, port) {
    if (N.preTcp) { var pt = N.preTcp(sys, ip, port, "tcp"); if (pt) return pt; }
    var r = reach(sys, ip, { port: port });
    if (!r.ok && !r.tcpOk) return { err: r.err === "netunreach" ? "netunreach" : r.err === "hostunreach" ? "hostunreach" : "timeout", r: r };
    if (r.self || selfTarget(sys, ip)) { var c = M2.tcpConnect(sys, /^127\./.test(ip) ? ip : N.isOwn(sys.nw, ip) ? ip : "10.20.0.15", port); return c.refused ? { err: "refused", r: r } : { ok: true, r: r, proc: c.proc }; }
    if ((sys.nw.filtered || {})[ip + ":" + port]) return { err: "timeout", r: r, filtered: true };
    var hs = N.HOSTSVC && N.HOSTSVC(sys, ip);
    if (hs) { var sv = hs[port]; if (sv && sv.filtered) return { err: "timeout", r: r, filtered: true }; return sv && !sv.udp ? { ok: true, r: r, svc: sv } : { err: "refused", r: r }; }
    var extra = LISTEN_EXTRA[ip];
    if (extra) return extra.indexOf(port) >= 0 ? { ok: true, r: r } : { err: "refused", r: r };
    if (isV6(ip)) { var h6 = W.V6HOSTS[v6norm(ip)]; return h6 && h6.ports.indexOf(port) >= 0 ? { ok: true, r: r } : { err: "refused", r: r }; }
    var c2 = M2.tcpConnect(sys, ip, port);
    if (c2.timeout) return { err: "timeout", r: r };
    return c2.refused ? { err: "refused", r: r } : { ok: true, r: r, remote: c2.remote };
  }
  N.tcpOpen = tcpOpen;
  var SVC = { 21: "ftp", 22: "ssh", 23: "telnet", 25: "smtp", 53: "domain", 80: "http", 110: "pop3", 123: "ntp", 143: "imap2", 443: "https", 445: "microsoft-ds", 587: "submission", 873: "rsync", 993: "imaps", 995: "pop3s", 3306: "mysql", 3389: "ms-wbt-server", 5432: "postgresql", 6379: "redis", 8080: "http-alt", 9090: "websm", 9000: "cslistener", 9200: "wap-wsp" };
  N.SVC = SVC;

  function parseCurl(a, io) {
    var o = { headers: {}, method: null, url: null, wfmt: null };
    var LONG = { "--silent": "s", "--show-error": "S", "--head": "I", "--include": "i", "--verbose": "v", "--fail": "f", "--location": "L", "--insecure": "k", "--remote-name": "O", "--ipv4": "4", "--ipv6": "6" };
    for (var i = 0; i < a.length; i++) {
      var x = a[i], m;
      if (/^--/.test(x)) {
        if (LONG[x]) o[LONG[x]] = true;
        else if (x === "--output") o.o = a[++i]; else if (x === "--header") { m = /^([^:]+):\s*(.*)$/.exec(a[++i] || ""); if (m) o.headers[m[1].toLowerCase()] = m[2]; } else if (x === "--request") o.method = a[++i];
        else if (x === "--data" || x === "--data-raw" || x === "--data-binary") o.data = a[++i]; else if (x === "--write-out") o.wfmt = a[++i]; else if (x === "--user-agent") o.headers["user-agent"] = a[++i]; else if (x === "--user") o.user = a[++i];
        else if (x === "--resolve") { var rv = (a[++i] || "").split(":"); o.resolve = { host: rv[0], port: +rv[1], ip: rv.slice(2).join(":").replace(/^\[|\]$/g, "") }; }
        else if (/^--tlsv1(\.[0-3])?$/.test(x)) o.tlsMin = x === "--tlsv1" ? "TLSv1" : "TLSv1" + x.slice(7).replace(/^\.0$/, "");
        else if (x === "--tls-max") { var tm = a[++i] || ""; o.tlsMax = tm === "1.0" ? "TLSv1" : "TLSv" + tm; }
        else if (x === "--http1.1" || x === "--http1.0") o.http = "1.1"; else if (x === "--http2") o.http = "2"; else if (x === "--http3" || x === "--http3-only") o.http = "3";
        else if (x === "--connect-timeout" || x === "--max-time" || x === "--retry" || x === "--cacert" || x === "--cert" || x === "--key") { if (x === "--cacert") o.cacert = a[i + 1]; if (x === "--cert") o.cert = a[i + 1]; if (x === "--max-time" || x === "--connect-timeout") o.maxTime = +a[i + 1]; i++; } else if (x === "--compressed") o.compressed = true; else if (x === "--no-progress-meter") o.noProgress = true;
        else if (x === "--help") { out(io, "Usage: curl [options...] <url>\n -d, --data <data>          HTTP POST data\n -f, --fail                 Fail fast with no output on HTTP errors\n -H, --header <header/@file> Pass custom header(s) to server\n -i, --include              Include protocol response headers in the output\n -I, --head                 Show document info only\n -k, --insecure             Allow insecure server connections\n -L, --location             Follow redirects\n -o, --output <file>        Write to file instead of stdout\n -s, --silent               Silent mode\n -v, --verbose              Make the operation more talkative\n -w, --write-out <format>   Use output FORMAT after completion\n     --http1.1 / --http2    Use HTTP 1.1 / try HTTP 2\n     --resolve <host:port:addr> Resolve the host+port to this address\n -4 / -6                    Resolve names to IPv4 / IPv6 addresses\n"); return null; }
        else { errl(io, "curl: option " + x + ": is unknown\ncurl: try 'curl --help' or 'curl --manual' for more information"); return { bad: 2 }; }
        continue;
      }
      if (/^-[a-zA-Z0-9]+$/.test(x)) {
        for (var k = 1; k < x.length; k++) {
          var c = x.charAt(k);
          if ("sSIivfLkO46".indexOf(c) >= 0) o[c] = true;
          else if ("oHXdwAmu".indexOf(c) >= 0) {
            var val = x.slice(k + 1) || a[++i];
            if (c === "o") o.o = val; else if (c === "H") { m = /^([^:]+):\s*(.*)$/.exec(val || ""); if (m) o.headers[m[1].toLowerCase()] = m[2]; } else if (c === "X") o.method = val; else if (c === "d") o.data = val; else if (c === "w") o.wfmt = val; else if (c === "A") o.headers["user-agent"] = val; else if (c === "u") o.user = val; else if (c === "m") o.maxTime = +val;
            break;
          } else { errl(io, "curl: option -" + c + ": is unknown\ncurl: try 'curl --help' or 'curl --manual' for more information"); return { bad: 2 }; }
        }
        continue;
      }
      o.url = x;
    }
    return o;
  }
  CMDS.curl = function (args, io, sess) {
    var sys = sess.sys, o = parseCurl(args.slice(1), io);
    if (!o) return 0; if (o.bad) return o.bad;
    if (!o.url) { errl(io, "curl: try 'curl --help' or 'curl --manual' for more information"); return 2; }
    if (o.http === "3") { errl(io, "curl: option --http3: the installed libcurl version doesn't support this\ncurl: try 'curl --help' or 'curl --manual' for more information"); note(io, "(Ubuntu's curl is built without HTTP/3 (QUIC). Browsers speak it: they see the alt-svc header and switch to UDP port 443.)"); return 2; }
    var u = M2.parseUrl(o.url);
    if (!u) { errl(io, "curl: (3) URL rejected: Malformed input to a URL function"); return 3; }
    var method = o.method || (o.I ? "HEAD" : o.data !== undefined ? "POST" : "GET");
    var showErr = !o.s || o.S, verbose = function (t) { if (o.v) errl(io, t); };
    var g = null, redirects = 0, cur = u, hostHdr = o.headers.host || (u.host + (u.explicitPort ? ":" + u.port : "")), res, tls = null, ip, outText = "", httpv = "1.1", t0 = { dns: 0.004, conn: 0, app: 0, tot: 0 };
    var stdoutTty = !!io.tty && !o.o && !o.O;
    function fail(code, msg, extra) { if (showErr) errl(io, "curl: (" + code + ") " + msg + (extra || "")); if (o.wfmt) out(io, wfmt(o.wfmt, { http_code: "000", response_code: "0" })); return code; }
    function wfmt(f, vals) { return f.replace(/%\{(\w+)\}/g, function (m0, k) { return vals[k] !== undefined ? vals[k] : ""; }).replace(/\\n/g, "\n").replace(/\\t/g, "\t"); }
    for (;;) {
      // name -> address
      var fam = o["4"] ? 4 : o["6"] ? 6 : null, lit = cur.host;
      if (o.resolve && o.resolve.host === cur.host && o.resolve.port === cur.port) ip = o.resolve.ip;
      else if (isV4(lit) || isV6(lit)) ip = isV6(lit) ? v6norm(lit) : lit;
      else {
        g = null; var g6 = null;
        if (fam !== 4) g6 = getaddrinfo(sys, lit, 6);
        if (fam !== 6) g = getaddrinfo(sys, lit, 4);
        var cands = [];
        if (g6 && !g6.err && !g6.hosts) cands.push(g6.ip);
        if (g && !g.err) cands.push(g.ip);
        if (!cands.length) { ev(sys, { k: "http", url: o.url, ok: false, dns: true, path: ["you", "sw", "dns"], fail: "dns", layer: 7 }); return fail(6, "Could not resolve host: " + cur.host); }
        // happy eyeballs: IPv6 first if it works, else IPv4
        ip = cands[0];
        if (cands.length > 1) { var t6 = reach(sys, cands[0], { quiet: true }); verbose("*   Trying [" + cands[0] + "]:" + cur.port + "..."); if (!t6.ok) { verbose("* Immediate connect fail for " + cands[0] + ": Network is unreachable"); ip = cands[1]; } }
      }
      verbose("*   Trying " + (isV6(ip) ? "[" + ip + "]" : ip) + ":" + cur.port + "...");
      var tc = tcpOpen(sys, ip, cur.port);
      if (tc.err) {
        ev(sys, { k: "http", url: o.url, ok: false, err: tc.err, ip: ip, port: cur.port, host: cur.host, path: tc.r.path, fail: tc.r.fail || tc.r.node || "inet", layer: tc.err === "refused" ? 4 : 3 });
        if (tc.err === "timeout" && o.maxTime > 0) return fail(28, "Connection timed out after " + (o.maxTime * 1000 + 1) + " milliseconds");
        if (tc.err === "timeout") return fail(28, "Failed to connect to " + cur.host + " port " + cur.port + " after 133" + (hash(ip) % 900 + 100) + " ms: Couldn't connect to server");
        return fail(7, "Failed to connect to " + cur.host + " port " + cur.port + " after " + (tc.err === "hostunreach" ? 3071 : 0) + " ms: Couldn't connect to server");
      }
      verbose("* Connected to " + cur.host + " (" + ip + ") port " + cur.port);
      httpv = "1.1";
      if (tc.r && tc.r.pmtu && sys.nw.pmtuBlackhole && (tc.r.routeMtu || 1500) > tc.r.pmtu) {
        if (cur.scheme === "https") verbose("* ALPN: curl offers h2,http/1.1\n* TLSv1.3 (OUT), TLS handshake, Client hello (1):");
        ev(sys, { k: "http", url: o.url, ok: false, err: "timeout", hang: true, ip: ip, port: cur.port, host: cur.host, tls: cur.scheme === "https", path: tc.r.path, fail: tc.r.node || "inet", layer: 3 });
        return fail(28, cur.scheme === "https" ? "SSL connection timeout" : "Operation timed out after 30001 milliseconds with 0 bytes received");
      }
      if (cur.scheme === "https") {
        var sni = isV4(cur.host) || isV6(cur.host) ? null : cur.host;
        tls = tlsConnect(sys, ip, cur.port, sni, { min: o.tlsMin, max: o.tlsMax });
        if (tls.err === "noproto") return fail(35, "OpenSSL/3.0.13: error:0A0000BF:SSL routines::no protocols available");
        if (tls.err === "protocol") { ev(sys, { k: "http", url: o.url, ok: false, tlsErr: "protocol version", path: tc.r.path, layer: 6 }); return fail(35, "OpenSSL/3.0.13: error:0A00042E:SSL routines::tlsv1 alert protocol version, errno 0"); }
        verbose("* ALPN: curl offers h2,http/1.1\n* TLSv1.3 (OUT), TLS handshake, Client hello (1):\n*  CAfile: /etc/ssl/certs/ca-certificates.crt\n*  CApath: /etc/ssl/certs");
        if (tls.err) { ev(sys, { k: "http", url: o.url, ok: false, tlsErr: true, path: tc.r.path, layer: 6 }); return fail(35, "OpenSSL/3.0.13: error:0A00010B:SSL routines::wrong version number"); }
        verbose("* TLSv1.3 (IN), TLS handshake, Server hello (2):\n* TLSv1.3 (IN), TLS handshake, Encrypted Extensions (8):\n* TLSv1.3 (IN), TLS handshake, Certificate (11):\n* TLSv1.3 (IN), TLS handshake, CERT verify (15):\n* TLSv1.3 (IN), TLS handshake, Finished (20):\n* TLSv1.3 (OUT), TLS handshake, Finished (20):\n* SSL connection using " + tls.version + " / " + tls.cipher + " / X25519 / " + (/^ec/.test(tls.chain[0].key) ? "id-ecPublicKey" : "RSASSA-PSS"));
        var negotiated = o.http === "1.1" ? "http/1.1" : tls.alpn;
        verbose("* ALPN: server accepted " + negotiated);
        var lc = tls.chain[0];
        verbose("* Server certificate:\n*  subject: " + lc.s.replace(/ = /g, "=") + "\n*  start date: " + gmt(lc.nb) + "\n*  expire date: " + gmt(lc.na) + "\n*  subjectAltName: " + (sni && nameMatch(lc, sni) ? "host \"" + sni + "\" matched cert's \"" + (lc.san || []).filter(function (n) { return nameMatch({ san: [n] }, sni); })[0] + "\"" : "does not match " + (sni || ip)) + "\n*  issuer: " + lc.i.replace(/ = /g, "="));
        var vr = verify(sys, tls.chain);
        if (vr.code && o.cacert) { var extra = parsePems(rd(sys, o.cacert) || "").map(function (c) { return c.s; }); if (extra.length) { sys.nw.extraTrust = (sys.nw.extraTrust || []).concat(extra); vr = verify(sys, tls.chain); sys.nw.extraTrust = sys.nw.extraTrust.slice(0, -extra.length); } }
        if (!o.k) {
          if (vr.code) { verbose("* SSL certificate problem: " + vr.text + "\n* Closing connection"); ev(sys, { k: "http", url: o.url, ok: false, tlsErr: vr.text, path: tc.r.path, layer: 6 }); return fail(60, "SSL certificate problem: " + vr.text, "\nMore details here: https://curl.se/docs/sslcerts.html\n\ncurl failed to verify the legitimacy of the server and therefore could not\nestablish a secure connection to it. To learn more about this situation and\nhow to fix it, please visit the web page mentioned above."); }
          if (sni && !nameMatch(lc, sni) || !sni && !nameMatch(lc, ip)) { ev(sys, { k: "http", url: o.url, ok: false, tlsErr: "name", path: tc.r.path, layer: 6 }); return fail(60, "SSL: no alternative certificate subject name matches target host name '" + cur.host + "'", "\nMore details here: https://curl.se/docs/sslcerts.html\n\ncurl failed to verify the legitimacy of the server and therefore could not\nestablish a secure connection to it. To learn more about this situation and\nhow to fix it, please visit the web page mentioned above."); }
          verbose("*  SSL certificate verify ok.");
        } else verbose("*  SSL certificate verify result: " + (vr.code ? vr.text + " (" + vr.code + "), continuing anyway." : "ok"));
        if (negotiated === "h2") httpv = "2";
        if (tls.clientCert && !o.cert) { verbose("* TLSv1.3 (IN), TLS alert, unknown (628):"); ev(sys, { k: "http", url: o.url, ok: false, tlsErr: "client certificate required", ip: ip, port: cur.port, path: tc.r.path, layer: 6 }); return fail(56, "OpenSSL SSL_read: OpenSSL/3.0.13: error:0A00045C:SSL routines::tlsv13 alert certificate required, errno 0"); }
      }
      var hdrs = Object.assign({ host: hostHdr, "user-agent": "curl/8.5.0", accept: "*/*" }, o.headers);
      if (o.user) hdrs.authorization = "Basic " + b64enc(unescape(encodeURIComponent(o.user)));
      if (o.compressed) hdrs["accept-encoding"] = "deflate, gzip, br, zstd";
      var req = { scheme: cur.scheme, host: cur.host, port: cur.port, path: cur.path, method: method, headers: hdrs, body: o.data };
      if (httpv === "2") verbose("* using HTTP/2\n* [HTTP/2] [1] OPENED stream for " + cur.scheme + "://" + cur.host + cur.path + "\n* [HTTP/2] [1] [:method: " + method + "]\n* [HTTP/2] [1] [:scheme: https]\n* [HTTP/2] [1] [:authority: " + hostHdr + "]\n* [HTTP/2] [1] [:path: " + cur.path + "]\n> " + method + " " + cur.path + " HTTP/2\n> Host: " + hostHdr + "\n> User-Agent: " + hdrs["user-agent"] + "\n> Accept: */*\n> ");
      else verbose("> " + method + " " + cur.path + " HTTP/1.1\n> Host: " + hostHdr + "\n> User-Agent: " + hdrs["user-agent"] + "\n> Accept: */*\n" + Object.keys(o.headers).filter(function (k) { return k !== "host" && k !== "user-agent"; }).map(function (k) { return "> " + k.replace(/(^|-)\w/g, function (s) { return s.toUpperCase(); }) + ": " + o.headers[k] + "\n"; }).join("") + "> ");
      res = httpTo(sys, ip, cur.port, req);
      if (res.err) {
        ev(sys, { k: "http", url: o.url, ok: false, err: res.err.msg, path: tc.r.path, layer: 7 });
        if (res.err.code === 7 && /Couldn't connect/.test(res.err.msg)) return fail(7, "Failed to connect to " + cur.host + " port " + cur.port + " after 0 ms: Couldn't connect to server");
        if (/HTTP\/0\.9/.test(res.err.msg)) return fail(1, "Received HTTP/0.9 when not allowed");
        return fail(res.err.code === 35 ? 35 : 52, res.err.code === 35 ? res.err.msg : "Empty reply from server");
      }
      var head = statusBlock(res, httpv);
      verbose(head.replace(/\r\n$/, "").split("\r\n").map(function (l) { return "< " + l; }).join("\n") + "\n< ");
      if (o.L && res.status >= 300 && res.status < 400 && res.headers.Location && redirects < 50) {
        redirects++;
        var loc = res.headers.Location || res.headers.location;
        var nu = M2.parseUrl(loc.charAt(0) === "/" ? cur.scheme + "://" + cur.host + (cur.explicitPort ? ":" + cur.port : "") + loc : loc);
        if (o.i || o.I) outText += head.replace(/\r\n/g, "\n");
        verbose("* Issue another request to this URL: '" + loc + "'");
        cur = nu; hostHdr = nu.host + (nu.explicitPort ? ":" + nu.port : ""); if (method !== "HEAD") method = "GET";
        continue;
      }
      break;
    }
    ev(sys, { k: "http", url: o.url, ok: res.status < 400, status: res.status, tls: !!tls, http: httpv, ip: ip, port: cur.port, host: cur.host, method: method, reqPath: cur.path, hdrs: hdrs, resp: res, dnsName: isV4(cur.host) || isV6(cur.host) ? null : cur.host, path: (reach(sys, ip, { quiet: true }).path), layer: 7 });
    if (o.f && res.status >= 400) { if (showErr) errl(io, "curl: (22) The requested URL returned error: " + res.status); return 22; }
    var body = method === "HEAD" ? "" : res.body;
    if (method === "HEAD" && res.headLen != null) res.headers["Content-Length"] = String(res.headLen);
    var hb = statusBlock(res, httpv).replace(/\r\n/g, "\n");
    outText += o.I ? hb : o.i ? hb + body : body;
    var target = o.o || (o.O ? M2.basename(cur.path.split("?")[0]) || "index.html" : null);
    if (target && target !== "/dev/null") { var we = S.writeFile(sess, target, outText); if (we) { if (showErr) errl(io, "curl: (23) Failure writing output to destination"); return 23; } }
    else if (!target) out(io, outText);
    if (!o.s && !o.noProgress && !stdoutTty && !o.v) { var nb = bytes(outText); errl(io, "  % Total    % Received % Xferd  Average Speed   Time    Time     Time  Current\n                                 Dload  Upload   Total   Spent    Left  Speed\n100 " + pad(nb, 5) + "  100 " + pad(nb, 5) + "    0     0  " + pad(Math.max(1, Math.round(nb / 2)) + "k", 5) + "      0 --:--:-- --:--:-- --:--:-- " + pad(Math.max(1, nb) + "k", 5)); }
    if (o.v) verbose("* Connection #0 to host " + cur.host + " left intact");
    if (o.wfmt) {
      var rt = reach(sys, ip, { quiet: true }).rtt || 0.1, dnsT = 0.004 + (isV4(cur.host) ? 0 : 0.008) + (g && g.delay ? g.delay : 0), con = dnsT + rt / 1000, app = tls ? con + 2 * rt / 1000 : 0, st = (tls ? app : con) + rt / 1000 + 0.002 + (res.delay || 0) / 1000;
      out(io, wfmt(o.wfmt, { http_code: pad(res.status, 3, "0"), response_code: res.status, http_version: httpv, size_download: bytes(body), size_header: bytes(hb), time_namelookup: dnsT.toFixed(6), time_connect: con.toFixed(6), time_appconnect: app.toFixed(6), time_starttransfer: st.toFixed(6), time_total: (st + 0.0003).toFixed(6), remote_ip: ip, remote_port: cur.port, local_ip: (reach(sys, ip, { quiet: true }).src || ""), scheme: cur.scheme.toUpperCase(), content_type: res.headers["Content-Type"] || res.headers["content-type"] || "", url_effective: cur.scheme + "://" + cur.host + cur.path, num_redirects: redirects, ssl_verify_result: tls ? verify(sys, tls.chain).code : 0, redirect_url: res.headers.Location || "" }));
    }
    sys.actions.push("curl " + o.url);
    return 0;
  };
  function statusBlock(r, v) {
    if (v === "2") return "HTTP/2 " + r.status + " \r\n" + Object.keys(r.headers).filter(function (h) { return !/^(Connection|Keep-Alive|Transfer-Encoding)$/i.test(h); }).map(function (h) { return h.toLowerCase() + ": " + r.headers[h] + "\r\n"; }).join("") + "\r\n";
    return "HTTP/1.1 " + r.status + " " + (REASON[r.status] || "") + "\r\n" + Object.keys(r.headers).map(function (h) { return h + ": " + r.headers[h] + "\r\n"; }).join("") + "\r\n";
  }
  N.statusBlock = statusBlock;
  var wgetPrev = CMDS.wget;
  CMDS.wget = function (args, io, sess) {
    var url = args.slice(1).filter(function (x) { return !/^-/.test(x); }).pop();
    if (url) {
      var u = M2.parseUrl(url);
      if (u && !isV4(u.host)) { var g = getaddrinfo(sess.sys, u.host, 4); if (g.err) { errl(io, "--" + M2.ymd(sess.sys.now) + " " + tod(sess.sys.now) + "--  " + url + "\nResolving " + u.host + " (" + u.host + ")... failed: " + g.err + ".\nwget: unable to resolve host address ‘" + u.host + "’"); return 4; } var tc = tcpOpen(sess.sys, g.ip, u.port); if (tc.err) { errl(io, "--" + M2.ymd(sess.sys.now) + " " + tod(sess.sys.now) + "--  " + url + "\nResolving " + u.host + " (" + u.host + ")... " + g.ip + "\nConnecting to " + u.host + " (" + u.host + ")|" + g.ip + "|:" + u.port + "... failed: " + ({ refused: "Connection refused", netunreach: "Network is unreachable", hostunreach: "No route to host", timeout: "Connection timed out" })[tc.err] + "."); return 4; } }
    }
    return wgetPrev(args, io, sess);
  };

  /* ================================================================== TCP and UDP: nc, ss */
  CMDS.nc = function (args, io, sess) {
    var sys = sess.sys, a = args.slice(1), z = false, v = false, udp = false, wait = null, rest = [], four = false, six = false, crlf = false;
    for (var i = 0; i < a.length; i++) {
      var x = a[i];
      if (/^-[zvnu46NC]+$/.test(x)) { if (x.indexOf("z") >= 0) z = true; if (x.indexOf("v") >= 0) v = true; if (x.indexOf("u") >= 0) udp = true; if (x.indexOf("4") >= 0) four = true; if (x.indexOf("6") >= 0) six = true; if (x.indexOf("C") >= 0) crlf = true; }
      else if (x === "-w" || x === "-W") wait = +a[++i]; else if (x === "-q" || x === "-p" || x === "-s") i++;
      else if (x === "-l") { note(io, "(nc -l listens for a connection and waits; the lab can't keep it open. Its side of the conversation is what servers do.)"); return 0; }
      else rest.push(x);
    }
    if (rest.length < 2) { errl(io, "usage: nc [-46CDdFhklNnrStUuvZz] [-I length] [-i interval] [-M ttl]\n\t  [-m minttl] [-O length] [-P proxy_username] [-p source_port]\n\t  [-q seconds] [-s sourceaddr] [-T keyword] [-V rtable] [-W recvlimit]\n\t  [-w timeout] [-X proxy_protocol] [-x proxy_address[:port]]\n\t  [destination] [port]"); return 1; }
    var host = rest[0], ports = [];
    rest.slice(1).forEach(function (p) { var m = /^(\d+)-(\d+)$/.exec(p); if (m) { for (var k = +m[1]; k <= +m[2] && ports.length < 1100; k++) ports.push(k); } else if (/^\d+$/.test(p)) ports.push(+p); else { var f = Object.keys(SVC).filter(function (k) { return SVC[k] === p; })[0]; if (f) ports.push(+f); } });
    if (!ports.length) { errl(io, "nc: port number invalid: " + rest[1]); return 1; }
    var g = isV4(host) || isV6(host) ? { ip: host } : getaddrinfo(sys, host, six ? 6 : 4);
    if (g.err) { errl(io, "nc: getaddrinfo for host \"" + host + "\" port " + ports[0] + ": " + g.err); return 1; }
    var ip = g.ip, code = 1, shownHost = host;
    ports.forEach(function (port) {
      var svc = SVC[port] || "*", proto = udp ? "udp" : "tcp";
      if (udp) {
        var ru = reach(sys, ip, { quiet: true });
        if (!ru.ok && ru.err === "netunreach") { if (v) errl(io, "nc: connect to " + shownHost + " port " + port + " (udp) failed: Network is unreachable"); return; }
        if (v) errl(io, "Connection to " + shownHost + " (" + ip + ") " + port + " port [udp/" + svc + "] succeeded!");
        code = 0;
        ev(sys, { k: "udp", to: ip, port: port, ok: true, path: ru.path, layer: 4 });
        return;
      }
      var tc = tcpOpen(sys, ip, port);
      if (tc.err) {
        if (v) {
          if (tc.err === "refused") errl(io, "nc: connect to " + shownHost + " port " + port + " (tcp) failed: Connection refused");
          else if (tc.err === "netunreach") errl(io, "nc: connect to " + shownHost + " port " + port + " (tcp) failed: Network is unreachable");
          else if (tc.err === "hostunreach") errl(io, "nc: connect to " + shownHost + " port " + port + " (tcp) failed: No route to host");
          else errl(io, "nc: connect to " + shownHost + " port " + port + " (tcp) timed out: Operation now in progress");
        }
        if (tc.err === "timeout" && wait === null && ports.length === 1) note(io, "(Without -w, nc would have waited about two minutes for an answer. Add -w 3 to give up after 3 seconds.)");
        ev(sys, { k: "tcp", to: ip, port: port, ok: false, err: tc.err, path: tc.r.path, fail: tc.err === "refused" ? (tc.r.node || "you") : tc.r.fail, layer: tc.err === "refused" ? 4 : 3 });
        return;
      }
      code = 0;
      if (v) errl(io, "Connection to " + shownHost + " (" + ip + ") " + port + " port [" + proto + "/" + svc + "] succeeded!");
      ev(sys, { k: "tcp", to: ip, port: port, ok: true, path: tc.r.path, layer: 4 });
      if (z) return;
      var input = io.stdin;
      var talk = N.talk ? N.talk(sys, ip, port, input, tc) : null;
      if (talk != null) { out(io, talk); return; }
      if (input != null && input !== "" && /^[A-Z]+ \S+ HTTP\/\d/.test(input)) { out(io, rawHttp(sys, ip, port, input)); return; }
      if (port === 22) out(io, "SSH-2.0-OpenSSH_9.6p1 Ubuntu-3ubuntu13.5\n");
      else if (port === 25) out(io, "220 mail.kestrel.example.com ESMTP Postfix (Ubuntu)\n");
      else if (port === 5432 && input) out(io, "");
      if (input == null && !z && port !== 22 && port !== 25) note(io, "(nc is now connected and waits for you to type. Pipe the request in instead, e.g. printf 'GET / HTTP/1.1\\r\\nHost: x\\r\\n\\r\\n' | nc host 80)");
    });
    return code;
  };
  // A request typed by hand: parse it the way the server would, answer with the raw response
  function rawHttp(sys, ip, port, input) {
    var text = String(input), headEnd = text.search(/\r?\n\r?\n/);
    var head = headEnd >= 0 ? text.slice(0, headEnd) : text;
    var L = head.split(/\r?\n/), m = /^([A-Z]+) (\S+) HTTP\/(1\.[01])$/.exec(L[0].replace(/\r$/, ""));
    if (!m) return "HTTP/1.1 400 Bad Request\r\nServer: nginx\r\nContent-Type: text/html\r\nContent-Length: 150\r\nConnection: close\r\n\r\n<html>\r\n<head><title>400 Bad Request</title></head>\r\n<body>\r\n<center><h1>400 Bad Request</h1></center>\r\n<hr><center>nginx</center>\r\n</body>\r\n</html>\r\n".replace(/\r/g, "");
    var hdrs = {};
    L.slice(1).forEach(function (l) { var mm = /^([^:]+):\s*(.*?)\s*$/.exec(l); if (mm) hdrs[mm[1].toLowerCase()] = mm[2]; });
    if (m[3] === "1.1" && !hdrs.host) { var bad = "<html>\r\n<head><title>400 Bad Request</title></head>\r\n<body>\r\n<center><h1>400 Bad Request</h1></center>\r\n<hr><center>nginx</center>\r\n</body>\r\n</html>\r\n"; return ("HTTP/1.1 400 Bad Request\r\nServer: nginx\r\nDate: " + httpDate(sys.now) + "\r\nContent-Type: text/html\r\nContent-Length: " + bytes(bad) + "\r\nConnection: close\r\n\r\n" + bad).replace(/\r/g, ""); }
    var req = { scheme: "http", host: (hdrs.host || ip).replace(/:\d+$/, ""), port: port, path: m[2], method: m[1], headers: Object.assign({ host: hdrs.host || "" }, hdrs) };
    var res = httpTo(sys, ip, port, req);
    if (res.err) return "";
    var body = m[1] === "HEAD" ? "" : res.body;
    return statusBlock(res, "1.1").replace(/\r/g, "") + body;
  }
  N.rawHttp = rawHttp;
  // sockets: listeners from the process table, plus connections the scenario describes on sys.nw.conns
  function baseConns(sys) {
    return [
      { proto: "tcp", state: "ESTAB", local: "127.0.0.1", lport: 41872, peer: "127.0.0.1", pport: 8080, pid: 1124 },
      { proto: "tcp", state: "ESTAB", local: "127.0.0.1", lport: 8080, peer: "127.0.0.1", pport: 41872, pid: 1302 },
      { proto: "tcp", state: "ESTAB", local: "10.20.0.15", lport: 51210, peer: "10.20.0.21", pport: 5432, pid: 1302 },
      { proto: "tcp", state: "ESTAB", local: "10.20.0.15", lport: 51224, peer: "10.20.0.21", pport: 5432, pid: 1303 },
      { proto: "tcp", state: "ESTAB", local: "10.20.0.15", lport: 22, peer: "10.20.5.22", pport: 50122, pid: 2190 },
      { proto: "tcp", state: "TIME-WAIT", local: "10.20.0.15", lport: 443, peer: "10.20.0.10", pport: 39814 },
      { proto: "udp", state: "ESTAB", local: "10.20.0.15", lport: 51003, peer: "10.20.0.2", pport: 53, pid: 512 }
    ];
  }
  var STATE_ALIASES = { established: "ESTAB", listening: "LISTEN", "time-wait": "TIME-WAIT", "syn-sent": "SYN-SENT", "syn-recv": "SYN-RECV", "close-wait": "CLOSE-WAIT", "fin-wait-1": "FIN-WAIT-1", "fin-wait-2": "FIN-WAIT-2", closing: "CLOSING", "last-ack": "LAST-ACK" };
  function socketRows(sys) {
    var rows = [], groups = {};
    M2.listeners(sys).forEach(function (x) {
      var s = x.sock, key = s.proto + "|" + s.addr + "|" + s.port;
      if (!groups[key]) { groups[key] = { proto: s.proto, state: s.proto === "udp" ? "UNCONN" : "LISTEN", recvq: 0, sendq: s.proto === "udp" ? 0 : s.port === 80 || s.port === 443 ? 511 : s.port === 8080 || s.port === 9000 ? 2048 : s.port === 53 ? 4096 : 128, local: s.addr, lport: s.port, peer: s.proto === "udp" ? "0.0.0.0" : s.addr.charAt(0) === "[" ? "[::]" : "0.0.0.0", pport: "*", procs: [] }; rows.push(groups[key]); }
      groups[key].procs.push(x.proc);
    });
    (sys.nw.conns || baseConns(sys)).forEach(function (c) { var p = c.pid ? M2.procByPid(sys, c.pid) : null; rows.push({ proto: c.proto, state: c.state, recvq: c.recvq || 0, sendq: c.sendq || 0, local: c.local, lport: c.lport, peer: c.peer, pport: c.pport, procs: p ? [p] : [] }); });
    return rows;
  }
  N.socketRows = socketRows;
  CMDS.ss = function (args, io, sess) {
    var sys = sess.sys, o = {}, a = args.slice(1), filt = [];
    a.forEach(function (x) {
      if (/^-[a-zA-Z46]+$/.test(x)) x.slice(1).split("").forEach(function (c) { if (c === "4") o.four = true; else if (c === "6") o.six = true; else o[c] = true; });
      else if (/^--/.test(x)) { var mm = { "--tcp": "t", "--udp": "u", "--listening": "l", "--numeric": "n", "--processes": "p", "--all": "a", "--summary": "s", "--no-header": "H" }[x]; if (mm) o[mm] = true; }
      else filt.push(x);
    });
    if (o.s) { var rs = socketRows(sys); out(io, "Total: 168\nTCP:   " + rs.filter(function (r) { return r.proto === "tcp"; }).length + " (estab " + rs.filter(function (r) { return r.state === "ESTAB" && r.proto === "tcp"; }).length + ", closed 1, orphaned 0, timewait " + rs.filter(function (r) { return r.state === "TIME-WAIT"; }).length + ")\n\nTransport Total     IP        IPv6\nRAW\t  1         0         1        \nUDP\t  " + rs.filter(function (r) { return r.proto === "udp"; }).length + "         " + rs.filter(function (r) { return r.proto === "udp"; }).length + "         0        \nTCP\t  " + rs.filter(function (r) { return r.proto === "tcp"; }).length + "         " + rs.filter(function (r) { return r.proto === "tcp" && r.local.charAt(0) !== "["; }).length + "         " + rs.filter(function (r) { return r.proto === "tcp" && r.local.charAt(0) === "["; }).length + "        \n\n"); return 0; }
    // filters: state X, sport/dport OP :N, dst/src ADDR, joined by and/or, in parentheses
    var fs = filt.join(" ").replace(/[()]/g, " "), states = [], conds = [], useOr = /\bor\b|\|\|/.test(fs);
    var st = /\bstate\s+([\w-]+)/g, m;
    while ((m = st.exec(fs))) { var sn = m[1].toLowerCase(); if (sn === "all") states.push("*"); else if (sn === "connected") states.push("!LISTEN"); else if (STATE_ALIASES[sn]) states.push(STATE_ALIASES[sn]); else { errl(io, "ss: wrong state name: " + m[1]); return 1; } }
    var pr = /\b(sport|dport)\s*(=|==|eq|!=|ne|>|gt|<|lt|>=|ge|<=|le)?\s*:?(\w+)/g;
    var num = function (vv) { if (/^\d+$/.test(vv)) return +vv; for (var k in SVC) if (SVC[k] === vv) return +k; return -1; };
    while ((m = pr.exec(fs))) conds.push({ k: m[1], op: m[2] || "=", v: num(m[3]) });
    var ad = /\b(dst|src)\s+(\[?[\w.:]+\]?)/g;
    while ((m = ad.exec(fs))) { var hp = /^(.*?)(?::(\d+))?$/.exec(m[2]); conds.push({ k: m[1], ip: hp[1], port: hp[2] ? +hp[2] : null }); }
    if (!o.t && !o.u && !o.x && !o.w) o.t = o.u = true;
    var rows = socketRows(sys).filter(function (r) {
      if (r.proto === "tcp" && !o.t) return false; if (r.proto === "udp" && !o.u) return false;
      if (states.length) { if (!states.some(function (s) { return s === "*" || s === r.state || (s === "!LISTEN" && r.state !== "LISTEN" && r.state !== "UNCONN"); })) return false; }
      else { if (o.l && !o.a && r.state !== "LISTEN" && r.state !== "UNCONN") return false; if (!o.l && !o.a && (r.state === "LISTEN" || r.state === "UNCONN")) return false; }
      if (o.four && r.local.charAt(0) === "[") return false; if (o.six && r.local.charAt(0) !== "[" && r.local !== "*") return false;
      if (!conds.length) return true;
      var tests = conds.map(function (c) {
        if (c.k === "sport" || c.k === "dport") { var val = c.k === "sport" ? r.lport : r.pport; if (val === "*") return false; return /^(=|==|eq)$/.test(c.op) ? val === c.v : /^(!=|ne)$/.test(c.op) ? val !== c.v : /^(>|gt)$/.test(c.op) ? val > c.v : /^(<|lt)$/.test(c.op) ? val < c.v : /^(>=|ge)$/.test(c.op) ? val >= c.v : val <= c.v; }
        var addr = c.k === "dst" ? r.peer : r.local, port = c.k === "dst" ? r.pport : r.lport;
        return (c.ip === "*" || addr === c.ip || addr === "[" + c.ip + "]") && (c.port === null || port === c.port);
      });
      return useOr ? tests.some(Boolean) : tests.every(Boolean);
    }).sort(function (x, y) { return x.proto < y.proto ? 1 : x.proto > y.proto ? -1 : 0; });
    var port = function (p) { return p === "*" ? "*" : !o.n && SVC[p] ? SVC[p] : String(p); };
    var cells = rows.map(function (r) {
      var procs = "";
      if (o.p) { var vis = r.procs.filter(function (p) { return sess.uid === 0 || p.uid === sess.uid; }).sort(function (x, y) { return y.pid - x.pid; }); if (vis.length) procs = "users:(" + vis.map(function (p) { return "(\"" + p.comm + "\",pid=" + p.pid + ",fd=" + (p.comm === "sshd" ? 3 : 6) + ")"; }).join(",") + ")"; }
      return { netid: r.proto, state: r.state, rq: String(r.recvq), sq: String(r.sendq), la: r.local, lp: port(r.lport), pa: r.peer, pp: port(r.pport), proc: procs };
    });
    var showNet = o.t && o.u;
    var wla = Math.max.apply(null, [13].concat(cells.map(function (c) { return c.la.length; }))), wlp = Math.max.apply(null, [4].concat(cells.map(function (c) { return c.lp.length; })));
    var wpa = Math.max.apply(null, [12].concat(cells.map(function (c) { return c.pa.length; }))), wpp = Math.max.apply(null, [4].concat(cells.map(function (c) { return c.pp.length; })));
    var wst = Math.max.apply(null, [6].concat(cells.map(function (c) { return c.state.length; })));
    var L = o.H ? [] : [(showNet ? "Netid " : "") + rpad("State", wst) + " Recv-Q Send-Q " + pad("Local Address", wla) + ":" + rpad("Port", wlp) + " " + pad("Peer Address", wpa) + ":" + rpad("Port", wpp) + (o.p ? "Process" : "")];
    cells.forEach(function (c) { L.push(((showNet ? rpad(c.netid, 5) + " " : "") + rpad(c.state, wst) + " " + rpad(c.rq, 6) + " " + rpad(c.sq, 6) + " " + pad(c.la, wla) + ":" + rpad(c.lp, wlp) + " " + pad(c.pa, wpa) + ":" + rpad(c.pp, wpp) + c.proc).replace(/\s+$/, "")); });
    out(io, joinLines(L));
    ev(sys, { k: "look", what: "ss", layer: 4 });
    return 0;
  };

  /* ---------------- ssh and scp check the network first */
  function sshHost(args) {
    var a = args.slice(1);
    for (var i = 0; i < a.length; i++) { if (/^-[iplFoJLRDWEcmbP]$/.test(a[i])) { i++; continue; } if (/^-/.test(a[i])) continue; return a[i]; }
    return null;
  }
  ["ssh", "scp", "rsync", "ssh-copy-id"].forEach(function (name) {
    var prev = CMDS[name]; if (!prev) return;
    CMDS[name] = function (args, io, sess) {
      var target = name === "ssh" || name === "ssh-copy-id" ? sshHost(args) : (args.slice(1).filter(function (x) { return /^[^-/][^/]*:/.test(x); })[0] || "");
      var host = String(target || "").replace(/^[^@]*@/, "").replace(/:.*$/, "");
      if (host && !/^(localhost|127\.)/.test(host)) {
        var cfgHost = M2.ssh ? host : host;
        var g = isV4(host) ? { ip: host } : getaddrinfo(sess.sys, host, 4);
        if (g.err) {
          var conf = rd(sess.sys, sess.home + "/.ssh/config") || "";
          if (!new RegExp("^\\s*Host\\s+.*\\b" + host.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b", "mi").test(conf)) { errl(io, "ssh: Could not resolve hostname " + host + ": " + g.err); return 255; }
        } else {
          var tc = tcpOpen(sess.sys, g.ip, 22);
          if (tc.err && tc.err !== "refused") { errl(io, "ssh: connect to host " + host + " port 22: " + ({ netunreach: "Network is unreachable", hostunreach: "No route to host", timeout: "Connection timed out" })[tc.err]); ev(sess.sys, { k: "tcp", to: g.ip, port: 22, ok: false, path: tc.r.path, fail: tc.r.fail, layer: 3 }); return 255; }
        }
      }
      return prev(args, io, sess);
    };
  });

  /* ================================================================== encodings: base64, xxd, hexdump, iconv, file */
  function utf8Bytes(s) { return Array.prototype.slice.call(new TextEncoder().encode(s)); }
  function nodeBytes(n) {
    if (n.latin1 != null) return n.latin1.split("").map(function (c) { return c.charCodeAt(0) & 255; });
    if (n.binary != null) return n.binary.split("").map(function (c) { return c.charCodeAt(0) & 255; });
    return utf8Bytes(n.content);
  }
  function bytesToText(b) { try { return new TextDecoder("utf-8", { fatal: false }).decode(new Uint8Array(b)); } catch (e) { return String.fromCharCode.apply(null, b); } }
  N.nodeBytes = nodeBytes;
  function inputBytes(sess, io, file, name) {
    if (!file || file === "-") return { b: utf8Bytes(io.stdin || "") };
    var r = S.lookup(sess, file);
    if (!r.node) return { err: name + ": " + file + ": No such file or directory" };
    if (r.node.type === "d") return { err: name + ": " + file + ": Is a directory" };
    if (!S.can(sess, r.node, "r")) return { err: name + ": " + file + ": Permission denied" };
    return { b: nodeBytes(r.node), node: r.node };
  }
  CMDS.base64 = function (args, io, sess) {
    var a = args.slice(1), dec = false, wrapN = 76, files = [], ign = false;
    for (var i = 0; i < a.length; i++) { var x = a[i]; if (x === "-d" || x === "--decode") dec = true; else if (x === "-w") wrapN = +a[++i]; else if (/^-w\d+$/.test(x)) wrapN = +x.slice(2); else if (/^--wrap=/.test(x)) wrapN = +x.slice(7); else if (x === "-i" || x === "--ignore-garbage") ign = true; else if (/^-./.test(x)) { errl(io, "base64: invalid option -- '" + x.slice(1) + "'\nTry 'base64 --help' for more information."); return 1; } else files.push(x); }
    var inp = inputBytes(sess, io, files[0], "base64");
    if (inp.err) { errl(io, inp.err); return 1; }
    if (dec) {
      var s = String.fromCharCode.apply(null, inp.b).replace(/\s+/g, "");
      if (ign) s = s.replace(/[^A-Za-z0-9+/=]/g, "");
      var valid = /^[A-Za-z0-9+/]*={0,2}$/.test(s) && s.length % 4 !== 1;
      var good = valid ? s : s.slice(0, (s.search(/[^A-Za-z0-9+/=]/) + 4) & ~3);
      var raw = "";
      try { raw = b64dec(good.length % 4 ? good + "===".slice(0, 4 - good.length % 4) : good); } catch (e) { raw = ""; }
      out(io, bytesToText(raw.split("").map(function (c) { return c.charCodeAt(0); })));
      if (!valid) { errl(io, "base64: invalid input"); return 1; }
      return 0;
    }
    var enc = b64enc(String.fromCharCode.apply(null, inp.b));
    out(io, (wrapN ? enc.replace(new RegExp("(.{" + wrapN + "})", "g"), "$1\n").replace(/\n$/, "") : enc) + "\n");
    return 0;
  };
  function printable(b) { return b >= 32 && b < 127 ? String.fromCharCode(b) : "."; }
  CMDS.xxd = function (args, io, sess) {
    var a = args.slice(1), plain = false, limit = null, seek = 0, cols = 16, file = null, upper = false;
    for (var i = 0; i < a.length; i++) { var x = a[i]; if (x === "-p" || x === "-ps" || x === "-plain") plain = true; else if (x === "-l") limit = +a[++i]; else if (x === "-s") seek = +a[++i]; else if (x === "-c") cols = +a[++i]; else if (x === "-u") upper = true; else if (/^-/.test(x)) { errl(io, "xxd: invalid option " + x); return 1; } else file = x; }
    var inp = inputBytes(sess, io, file, "xxd");
    if (inp.err) { errl(io, inp.err.replace(/^xxd: /, "xxd: ")); return 2; }
    var b = inp.b.slice(seek, limit != null ? seek + limit : undefined), L = [];
    function hx(n) { var h = ("0" + n.toString(16)).slice(-2); return upper ? h.toUpperCase() : h; }
    if (plain) { var all = b.map(hx).join(""); for (var k = 0; k < all.length; k += 60) L.push(all.slice(k, k + 60)); out(io, joinLines(L)); return 0; }
    for (var off = 0; off < b.length; off += cols) {
      var row = b.slice(off, off + cols), hex = "";
      for (var j = 0; j < cols; j += 2) hex += (j < row.length ? hx(row[j]) + (j + 1 < row.length ? hx(row[j + 1]) : "  ") : "    ") + " ";
      L.push(("0000000" + (off + seek).toString(16)).slice(-8) + ": " + hex + " " + row.map(printable).join(""));
    }
    out(io, joinLines(L));
    return 0;
  };
  CMDS.hexdump = function (args, io, sess) {
    var a = args.slice(1), canon = false, file = null, limit = null;
    for (var i = 0; i < a.length; i++) { var x = a[i]; if (x === "-C") canon = true; else if (x === "-n") limit = +a[++i]; else if (/^-/.test(x)) continue; else file = x; }
    var inp = inputBytes(sess, io, file, "hexdump");
    if (inp.err) { errl(io, inp.err + "\nhexdump: all input file arguments failed"); return 1; }
    var b = limit != null ? inp.b.slice(0, limit) : inp.b, L = [];
    for (var off = 0; off < b.length; off += 16) {
      var row = b.slice(off, off + 16);
      if (canon) {
        var h = row.map(function (n) { return ("0" + n.toString(16)).slice(-2); });
        var left = h.slice(0, 8).join(" "), right = h.slice(8).join(" ");
        L.push(("0000000" + off.toString(16)).slice(-8) + "  " + rpad(left, 23) + "  " + rpad(right, 23) + "  |" + row.map(printable).join("") + "|");
      } else {
        var w = []; for (var j = 0; j < row.length; j += 2) w.push(("000" + ((row[j + 1] || 0) << 8 | row[j]).toString(16)).slice(-4));
        L.push(("000000" + off.toString(16)).slice(-7) + " " + w.join(" "));
      }
    }
    L.push(canon ? ("0000000" + b.length.toString(16)).slice(-8) : ("000000" + b.length.toString(16)).slice(-7));
    out(io, joinLines(L));
    return 0;
  };
  var ENC = { "UTF-8": "utf8", "UTF8": "utf8", "ISO-8859-1": "latin1", "ISO8859-1": "latin1", "LATIN1": "latin1", "ISO_8859-1": "latin1", "L1": "latin1", "CP1252": "latin1", "WINDOWS-1252": "latin1", "ASCII": "ascii", "US-ASCII": "ascii", "UTF-16": "utf16" };
  CMDS.iconv = function (args, io, sess) {
    var a = args.slice(1), from = null, to = null, outFile = null, files = [];
    for (var i = 0; i < a.length; i++) { var x = a[i]; if (x === "-f") from = a[++i]; else if (/^--from-code=/.test(x)) from = x.split("=")[1]; else if (x === "-t") to = a[++i]; else if (/^--to-code=/.test(x)) to = x.split("=")[1]; else if (x === "-o") outFile = a[++i]; else if (x === "-l" || x === "--list") { out(io, "The following list contains all the coded character sets known.\n\n  ISO-8859-1, ISO8859-1, LATIN1, L1, CP1252, WINDOWS-1252, UTF-8, UTF8, ASCII, US-ASCII, UTF-16\n"); return 0; } else if (x === "-c") continue; else if (/^-/.test(x)) { errl(io, "iconv: unrecognized option '" + x + "'"); return 1; } else files.push(x); }
    var fe = from ? ENC[from.toUpperCase().replace(/\/\/.*$/, "")] : "utf8", te = to ? ENC[to.toUpperCase().replace(/\/\/.*$/, "")] : "utf8";
    if (!fe || !te) { errl(io, "iconv: conversion " + (!fe ? "from `" + from + "'" : "to `" + to + "'") + " is not supported\nTry `iconv --help' or `iconv --usage' for more information."); return 1; }
    var inp = inputBytes(sess, io, files[0], "iconv");
    if (inp.err) { errl(io, "iconv: cannot open input file `" + files[0] + "': No such file or directory"); return 1; }
    var text;
    if (fe === "latin1") text = inp.b.map(function (c) { return String.fromCharCode(c); }).join("");
    else { text = bytesToText(inp.b); if (/�/.test(text) && fe === "utf8") { var pos = text.indexOf("�"); out(io, text.slice(0, pos)); errl(io, "iconv: illegal input sequence at position " + utf8Bytes(text.slice(0, pos)).length); return 1; } }
    var res;
    if (te === "latin1" || te === "ascii") {
      var badAt = -1; for (var k = 0; k < text.length; k++) if (text.charCodeAt(k) > (te === "ascii" ? 127 : 255)) { badAt = k; break; }
      if (badAt >= 0) { errl(io, "iconv: cannot convert"); return 1; }
      res = { latin1: text, shown: text.replace(/[\x80-\xff]/g, "�") };
    } else res = { text: text };
    if (outFile) {
      var we = S.writeFile(sess, outFile, res.text != null ? res.text : res.shown);
      if (we) { errl(io, "iconv: cannot open output file: " + S.ERRTEXT[we]); return 1; }
      var n = S.lookup(sess, outFile).node; if (n) { if (res.latin1 != null) n.latin1 = res.latin1; else delete n.latin1; }
      return 0;
    }
    out(io, res.text != null ? res.text : res.shown);
    return 0;
  };
  var filePrev = CMDS.file;
  CMDS.file = function (args, io, sess) {
    var names = args.slice(1).filter(function (x) { return !/^-/.test(x); }), brief = args.indexOf("-b") >= 0, mime = args.indexOf("-i") >= 0 || args.indexOf("--mime") >= 0, special = [], rest = [];
    names.forEach(function (f) {
      var r = S.lookup(sess, f), nd = r.node;
      if (nd && nd.type === "f") {
        var desc = null;
        if (nd.latin1 != null) desc = mime ? "text/plain; charset=iso-8859-1" : "ISO-8859 text";
        else if (/^\xd4\xc3\xb2\xa1/.test(nd.content)) desc = mime ? "application/vnd.tcpdump.pcap; charset=binary" : "pcap capture file, microsecond ts (little-endian) - version 2.4 (Ethernet, capture length 262144)";
        else if (/^-----BEGIN CERTIFICATE-----/.test(nd.content)) desc = mime ? "text/plain; charset=us-ascii" : "PEM certificate";
        else if (/^-----BEGIN PRIVATE KEY-----/.test(nd.content)) desc = mime ? "text/plain; charset=us-ascii" : "OpenSSH private key (no password)".replace("OpenSSH private key (no password)", "PEM RSA private key");
        else if (/^[A-Za-z0-9+/=\s]+$/.test(nd.content) && nd.content.replace(/\s/g, "").length > 16 && nd.content.replace(/\s/g, "").length % 4 === 0 && /[A-Z]/.test(nd.content) && /\d/.test(nd.content) && !/ /.test(nd.content.trim())) desc = mime ? "text/plain; charset=us-ascii" : "ASCII text";
        else if (/[^\x00-\x7f]/.test(nd.content) && !/�/.test(nd.content) && !/^\x1f\x8b/.test(nd.content) && !/^\x7fELF/.test(nd.content) && !/^(PK|BZh|\xfd7zXZ)/.test(nd.content)) desc = mime ? "text/plain; charset=utf-8" : "Unicode text, UTF-8 text";
        if (desc) { out(io, (brief ? "" : f + ": ") + desc + "\n"); return; }
      }
      rest.push(f);
    });
    if (!rest.length) return 0;
    return filePrev([args[0]].concat(args.slice(1).filter(function (x) { return /^-/.test(x); })).concat(rest), io, sess);
  };

  /* ================================================================== kc-web-01's web setup for this track */
  var NGX_KESTREL = "server {\n\tlisten 80;\n\tlisten [::]:80;\n\tserver_name kestrel.example.com www.kestrel.example.com shop.kestrel.example.com;\n\n\t# Let's Encrypt fetches renewal challenges over plain HTTP\n\tlocation /.well-known/acme-challenge/ {\n\t\troot /var/www/letsencrypt;\n\t}\n\n\tlocation / {\n\t\treturn 301 https://$host$request_uri;\n\t}\n}\n\nserver {\n\tlisten 443 ssl;\n\tlisten [::]:443 ssl;\n\thttp2 on;\n\tserver_name kestrel.example.com www.kestrel.example.com;\n\n\tssl_certificate /etc/letsencrypt/live/kestrel.example.com/fullchain.pem;\n\tssl_certificate_key /etc/letsencrypt/live/kestrel.example.com/privkey.pem;\n\n\troot /var/www/kestrel;\n\tadd_header Strict-Transport-Security \"max-age=31536000\" always;\n\tadd_header Alt-Svc 'h3=\":443\"; ma=86400';\n\n\tlocation /api/ {\n\t\tproxy_pass http://127.0.0.1:8080;\n\t}\n}\n";
  var NGX_SHOP = "server {\n\tlisten 443 ssl;\n\tlisten [::]:443 ssl;\n\thttp2 on;\n\tserver_name shop.kestrel.example.com;\n\n\tssl_certificate /etc/letsencrypt/live/shop.kestrel.example.com/fullchain.pem;\n\tssl_certificate_key /etc/letsencrypt/live/shop.kestrel.example.com/privkey.pem;\n\n\troot /var/www/shop;\n}\n";
  var NGX_DEFAULT = "server {\n\tlisten 80 default_server;\n\tlisten [::]:80 default_server;\n\tlisten 443 ssl default_server;\n\tlisten [::]:443 ssl default_server;\n\tserver_name _;\n\n\tssl_certificate /etc/ssl/certs/ssl-cert-snakeoil.pem;\n\tssl_certificate_key /etc/ssl/private/ssl-cert-snakeoil.key;\n\n\troot /var/www/html;\n\tindex index.html;\n}\n";
  N.NGX = { kestrel: NGX_KESTREL, shop: NGX_SHOP, def: NGX_DEFAULT };
  N.CERTS = { KESTREL: KESTREL_CERT, SHOP: SHOP_CERT, SNAKE: SNAKE };
  function writeLe(sys, name, c, t) {
    var live = "/etc/letsencrypt/live/" + name;
    S.mkdirs(sys, live, 493, 0, 0);
    putRoot(sys, live + "/cert.pem", pem(c), 420, 0, 0, t); putRoot(sys, live + "/chain.pem", pem(INTER), 420, 0, 0, t); putRoot(sys, live + "/fullchain.pem", pem(c) + pem(INTER), 420, 0, 0, t); putRoot(sys, live + "/privkey.pem", keyPem(name + t), 384, 0, 0, t);
    S.mkdirs(sys, "/etc/letsencrypt/renewal", 493, 0, 0);
    putRoot(sys, "/etc/letsencrypt/renewal/" + name + ".conf", "# renew_before_expiry = 30 days\nversion = 2.9.0\narchive_dir = /etc/letsencrypt/archive/" + name + "\ncert = /etc/letsencrypt/live/" + name + "/cert.pem\nprivkey = /etc/letsencrypt/live/" + name + "/privkey.pem\nchain = /etc/letsencrypt/live/" + name + "/chain.pem\nfullchain = /etc/letsencrypt/live/" + name + "/fullchain.pem\n\n# Options used in the renewal process\n[renewalparams]\naccount = 6c1f0e2a9b8d7c3e4f5a6b7c8d9e0f1a\nauthenticator = webroot\nwebroot_path = /var/www/letsencrypt,\nserver = https://acme-v02.api.letsencrypt.org/directory\nkey_type = ecdsa\n[[webroot_map]]\n" + (c.san || [name]).map(function (n) { return n + " = /var/www/letsencrypt"; }).join("\n") + "\n", 420, 0, 0, t);
  }
  N.writeLe = writeLe;
  S.SYS_HOOKS.push(function (sys) {
    if (sys.host !== "kc-web-01") return;
    putRoot(sys, "/etc/nginx/sites-available/kestrel", NGX_KESTREL);
    putRoot(sys, "/etc/nginx/sites-available/shop", NGX_SHOP);
    putRoot(sys, "/etc/nginx/sites-available/default", NGX_DEFAULT);
    var en = S.mkdirs(sys, "/etc/nginx/sites-enabled");
    en.children.default = S.linkNode("/etc/nginx/sites-available/default");
    en.children.shop = S.linkNode("/etc/nginx/sites-available/shop");
    S.mkdirs(sys, "/var/www/letsencrypt/.well-known/acme-challenge", 493, 0, 0);
    putRoot(sys, "/var/www/shop/index.html", "<!DOCTYPE html>\n<html><head><title>Kestrel Shop</title></head>\n<body><h1>Kestrel Shop</h1><p>Winter sale: 20% off all plans.</p></body></html>\n", 420, 33, 33);
    putRoot(sys, "/etc/ssl/certs/ssl-cert-snakeoil.pem", pem(SNAKE), 420, 0, 0, Date.UTC(2026, 10, 2));
    S.mkdirs(sys, "/etc/ssl/private", 448, 0, 0);
    putRoot(sys, "/etc/ssl/private/ssl-cert-snakeoil.key", keyPem("snake"), 384, 0, 0, Date.UTC(2026, 10, 2));
    putRoot(sys, "/usr/local/share/ca-certificates/kestrel-internal-ca.crt", pem({ s: KCA, i: KCA, nb: Date.UTC(2024, 0, 1), na: Date.UTC(2034, 0, 1), sn: serial("kca"), key: "rsa2048", ca: true }), 420, 0, 0, NOW - 200 * DAY);
    writeLe(sys, "kestrel.example.com", KESTREL_CERT, KESTREL_CERT.nb + 60000);
    writeLe(sys, "shop.kestrel.example.com", SHOP_CERT, SHOP_CERT.nb + 60000);
    S.mkdirs(sys, "/var/log/letsencrypt", 448, 0, 0);
    putRoot(sys, "/usr/lib/systemd/system/certbot.service", "[Unit]\nDescription=Certbot\nDocumentation=file:///usr/share/doc/python-certbot-doc/html/index.html\nDocumentation=https://certbot.eff.org/docs\n[Service]\nType=oneshot\nExecStart=/usr/bin/certbot -q renew --no-random-sleep-on-renew\nPrivateTmp=true\n", 420, 0, 0, Date.UTC(2024, 3, 8));
    putRoot(sys, "/usr/lib/systemd/system/certbot.timer", "[Unit]\nDescription=Run certbot twice daily\n\n[Timer]\nOnCalendar=*-*-* 00,12:00:00\nRandomizedDelaySec=43200\nPersistent=true\n\n[Install]\nWantedBy=timers.target\n", 420, 0, 0, Date.UTC(2024, 3, 8));
    var wantsT = S.mkdirs(sys, "/etc/systemd/system/timers.target.wants");
    wantsT.children["certbot.timer"] = S.linkNode("/usr/lib/systemd/system/certbot.timer");
    // the app listens on port 8080; the LB health checks hit nginx
    putRoot(sys, "/var/www/kestrel/robots.txt", "User-agent: *\nDisallow: /api/\n", 420, 33, 33);
    putRoot(sys, "/var/www/kestrel/old-pricing.html", "<!DOCTYPE html>\n<html><body><h1>Pricing (2024)</h1></body></html>\n", 420, 33, 33);
  });
  S.POST_HOOKS.push(function (sys) {
    if (sys.host !== "kc-web-01" || !sys.nw) return;
    // nginx was started before the config above was written: give its processes the ports the config listens on
    if (M2.nginxListens) { var ports = M2.nginxListens(sys); sys.procs.forEach(function (p) { if (p.unit === "nginx.service") p.listen = ports; }); }
    tlsSnap(sys);
    // certbot's timer runs if it's enabled
    var en = nodeAt(sys, "/etc/systemd/system/timers.target.wants");
    if (en && en.children["certbot.timer"]) { try { M2.unitUp(sys, "certbot.timer", NOW - 2 * DAY); var u = M2.loadUnit(sys, "certbot.timer"); if (u) u.rt.lastTrigger = Date.UTC(2026, 10, 11, 0, 0, 7); } catch (e) { /* the timer is optional */ } }
    // UDP 443 for HTTP/3 isn't served by this nginx; the conns list is the scenario's
    if (sys.nw.conns === undefined) sys.nw.conns = baseConns(sys);
  });
})(typeof window !== "undefined" ? window : globalThis);
