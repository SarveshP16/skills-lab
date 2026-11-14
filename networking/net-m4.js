/* sudo learn — Networking Module 4: defending the network. Other vantage points (kc-mon-01 on the office network,
   ext-scan-01 on the internet, kc-bastion-01) as real machines you can SSH into; firewalls that decide what those
   machines see (ufw and a real nftables engine with counters, logging and handles); nmap; WireGuard. */
(function (root) {
  "use strict";
  var S = root.ShEngine, U = S.util, CMDS = S.CMDS, M2 = S.M2, M4 = S.M4, N = M2.NET, W = N.W;
  var out = U.out, errl = U.errl, note = U.note, lines = U.lines, joinLines = U.joinLines, pad = U.pad, rpad = U.rpad;
  var rd = M2.rd, putRoot = M2.putRoot, hash = M2.hash, tod = M2.tod, NOW = S.NOW, DAY = S.DAY;
  var isV4 = N.isV4, isV6 = N.isV6, v6norm = N.v6norm, ME = "10.20.0.15";

  /* ================================================================== SSH keys for lab setup */
  var KEY_PREFIX_ED = "b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAABAAAAMwAAAAtzc2gtZW";
  function makeKey(seed, comment) {
    var body = KEY_PREFIX_ED + M2.hashChars("key:" + seed, 330), wrapped = body.match(/.{1,70}/g).join("\n");
    return { priv: "-----BEGIN OPENSSH PRIVATE KEY-----\n" + wrapped + "\n-----END OPENSSH PRIVATE KEY-----\n", pub: "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAI" + M2.hashChars("pub:" + body, 43) + " " + comment };
  }
  // give dev on kc-web-01 a key pair; returns the public key line
  function devKey(sys) {
    var k = makeKey("dev@kc-web-01", "dev@kc-web-01"), uid = S.uidOf(sys, "dev"), gid = S.gidOf(sys, "dev");
    var d = S.mkdirs(sys, "/home/dev/.ssh", 448, uid, gid); d.mode = 448; d.uid = uid; d.gid = gid;
    putRoot(sys, "/home/dev/.ssh/id_ed25519", k.priv, 384, uid, gid, NOW - 30 * DAY);
    putRoot(sys, "/home/dev/.ssh/id_ed25519.pub", k.pub + "\n", 420, uid, gid, NOW - 30 * DAY);
    return k.pub;
  }
  function authorize(m, user, pubLine) {
    var u = S.userByName(m, user); if (!u) return;
    var d = S.mkdirs(m, u.home + "/.ssh", 448, u.uid, u.gid); d.mode = 448; d.uid = u.uid; d.gid = u.gid;
    var cur = rd(m, u.home + "/.ssh/authorized_keys") || "";
    putRoot(m, u.home + "/.ssh/authorized_keys", cur + pubLine + "\n", 384, u.uid, u.gid, NOW - 30 * DAY);
  }
  N.devKey = devKey; N.authorize = authorize; N.makeKey = makeKey;

  /* ================================================================== more machines */
  var MACH = M2.MACHINES, HOSTS = M2.net.HOSTS, DNS = M2.net.DNS;
  function addMachine(name, ip, ports, ping, fqdn, setup) {
    MACH[name] = { ip: ip, setup: setup };
    HOSTS[ip] = { ping: ping, ports: ports, machine: name };
    if (fqdn && !DNS[fqdn]) DNS[fqdn] = { A: [ip], internal: /kestrel\.internal$/.test(fqdn) };
    W.NAMES[ip] = W.NAMES[ip] || fqdn;
  }
  addMachine("kc-mon-01", "10.20.5.10", [22, 9090], 1.2, "kc-mon-01.kestrel.internal", function (m) { m.knownPasswords = { dev: true }; m.vantage = "office"; S.M3.preinstall(m, "nmap"); });
  addMachine("ext-scan-01", "198.51.100.200", [22], 14.2, "ext-scan-01.example.net", function (m) { m.knownPasswords = { dev: true }; m.vantage = "internet"; S.M3.preinstall(m, "nmap"); });
  addMachine("kc-bastion-01", "10.20.0.5", [22], 0.3, "kc-bastion-01.kestrel.internal", function (m) { m.knownPasswords = { dev: true }; m.vantage = "lan"; S.M3.preinstall(m, "nmap"); });
  W.SEGS.srv.peers["10.20.0.5"] = W.SEGS.srv.peers["10.20.0.5"] || { name: "kc-bastion-01", node: "bastion", mac: "52:54:00:b5:71:05", rtt: 0.3 };
  // the internet scanner is reachable like any internet host
  W.TAILS["198.51.100.200"] = [["198.51.100.193", null, 13.8]];
  N.MACHINE_IPS = function () { var r = {}; Object.keys(MACH).forEach(function (k) { r[MACH[k].ip] = k; }); return r; };

  /* ================================================================== vantage points */
  function isRemote(sys) { return !!(sys && sys.ip && sys.ip !== ME); }
  function homeOf(sys) { return isRemote(sys) ? (sys.topSession && sys.topSession.sys) || null : sys; }
  function srcOf(sys) { return sys.ip || ME; }
  function webIps(home) { var r = [ME, W.PUB]; if (home && home.nw) N.own6(home.nw).forEach(function (a) { if (a.scope !== "link") r.push(a.ip); }); return r; }
  function isWeb(home, ip) { var n = isV6(ip) ? v6norm(ip) : ip; return webIps(home).indexOf(n) >= 0; }
  N.isRemote = isRemote; N.homeOf = homeOf; N.srcOf = srcOf;
  var GW_OF = { office: "10.20.5.1", internet: "198.51.100.193", lan: null };
  var prevPreReach = N.preReach;
  N.preReach = function (sys, dst, o) {
    o = o || {};
    if (!isRemote(sys)) return prevPreReach ? prevPreReach(sys, dst, o) : null;
    var home = homeOf(sys); if (!home || !home.nw) return null;
    var me = sys.ip, v = sys.vantage || "lan", n = isV6(dst) ? v6norm(dst) : dst;
    if (n === me || /^127\./.test(n) || n === "::1") return { ok: true, self: true, dev: "lo", src: me, path: ["you"], hops: [{ ip: n, rtt: 0.03 }], rtt: 0.03, ttl: 64, loss: 0, routeMtu: 65536 };
    var hopGw = GW_OF[v], base = v === "internet" ? 14.2 : v === "office" ? 1.2 : 0.3;
    if (isWeb(home, n)) {
      var hops = [];
      if (hopGw) hops.push({ ip: hopGw, rtt: base * 0.3 });
      if (v === "internet") hops.push({ ip: "203.0.113.1", rtt: base * 0.8 });
      hops.push({ ip: n, rtt: base });
      if (o.port == null && !o.quiet && fwVerdict(home, me, null, "icmp", isV6(n), n) === "drop") return { ok: false, err: "timeout", path: ["you"], fail: "web", hops: hops.slice(0, -1), src: me, dev: "eth0" };
      return { ok: true, dev: "eth0", src: me, via: hopGw, path: ["you", "gw"], hops: hops, rtt: base, ttl: 64 - (hops.length - 1), loss: 0, routeMtu: 1500, node: "you" };
    }
    // anywhere else: as far as kc-web-01 can see it, from here
    var r = N.reach(home, dst, { quiet: true, port: o.port });
    if (!r.ok) return Object.assign({}, r, { src: me });
    // the office and the internet can't see the private server LAN's other hosts directly
    if (v === "internet" && isV4(n) && /^10\./.test(n)) return { ok: false, err: "timeout", path: ["you"], fail: "inet", src: me, dev: "eth0", hops: [] };
    return Object.assign({}, r, { src: me, rtt: (r.rtt || 0) + base });
  };

  /* ================================================================== firewall evaluation */
  function inNet(ip, cidr) {
    if (cidr === "any" || cidr == null) return true;
    var m = /^([^/]+)(?:\/(\d+))?$/.exec(String(cidr)); if (!m) return false;
    if (isV4(ip) && isV4(m[1])) return N.inNet(ip, m[1], m[2] ? +m[2] : 32);
    if (isV6(ip) && isV6(m[1])) { var a = N.v6full(ip).replace(/:/g, ""), b = N.v6full(m[1]).replace(/:/g, ""), bits = m[2] ? +m[2] : 128; return a.slice(0, Math.floor(bits / 4)) === b.slice(0, Math.floor(bits / 4)); }
    return false;
  }
  function portIn(port, spec) {
    if (spec == null || spec === "") return true;
    if (port == null) return false;
    return String(spec).split(",").some(function (p) { var r = /^(\d+)[:-](\d+)$/.exec(p.trim()); return r ? port >= +r[1] && port <= +r[2] : +p === port; });
  }
  var logBudget = {};
  function kernLog(T, line) {
    var k = T.host + "|" + (T.cmdIndex || (homeOf(T) || {}).cmdIndex || 0);
    logBudget[k] = (logBudget[k] || 0) + 1;
    if (logBudget[k] > 6) return;
    M2.jadd(T, "kernel", null, line, null, 4, T.now);
    var lf = T === homeOf(T) || !isRemote(T) ? "/var/log/ufw.log" : null;
    if (lf && /UFW/.test(line)) M2.writeRoot(T, lf, new Date(T.now).toISOString().replace("Z", "000+00:00") + " " + T.host + " kernel: " + line + "\n", true);
  }
  function blockLine(prefix, T, src, dst, port, proto) {
    var p = proto === "icmp" ? "ICMP TYPE=8 CODE=0" : "PROTO=" + proto.toUpperCase() + " SPT=" + (40000 + (hash(src + port) >>> 0) % 20000) + " DPT=" + port + (proto === "tcp" ? " WINDOW=1024 RES=0x00 SYN URGP=0" : " LEN=8");
    return prefix + "IN=eth0 OUT= MAC=" + W.MY_MAC + ":" + W.MAC.gw + ":08:00 SRC=" + src + " DST=" + dst + " LEN=44 TOS=0x00 PREC=0x00 TTL=" + (isV4(src) && /^10\./.test(src) ? 63 : 52) + " ID=" + ((hash(src + dst + port) >>> 0) % 65000) + " " + p;
  }
  // ufw: first matching rule wins; default policy otherwise; ping is allowed by ufw's before.rules
  function ufwVerdict(T, src, port, proto, v6, dst) {
    var f = M4.fw(T); if (!f.enabled) return "accept";
    var rules = f.rules.filter(function (r) { return r.dir === "in" && !!r.v6 === !!v6; });
    for (var i = 0; i < rules.length; i++) {
      var r = rules[i];
      if (r.port && (port == null || !portIn(port, r.port))) continue;
      if (r.proto && r.proto !== proto) continue;
      if (!r.port && !r.from && !r.proto) continue;
      if (r.from !== "any" && !inNet(src, r.from)) continue;
      var a = r.action === "allow" || r.action === "limit" ? "accept" : r.action === "reject" ? "reject" : "drop";
      if (a !== "accept" && f.logging !== "off" && proto !== "icmp") kernLog(T, blockLine("[UFW BLOCK] ", T, src, dst || ME, port, proto));
      return a;
    }
    if (proto === "icmp") return "accept";
    var d = f.def.incoming === "allow" ? "accept" : f.def.incoming === "reject" ? "reject" : "drop";
    if (d !== "accept" && f.logging !== "off") kernLog(T, blockLine("[UFW BLOCK] ", T, src, dst || ME, port, proto));
    return d;
  }
  function fwVerdict(T, src, port, proto, v6, dst) {
    var a = nftVerdict(T, { src: src, dst: dst || ME, port: port, proto: proto, v6: !!v6 });
    if (a !== "accept") return a;
    return ufwVerdict(T, src, port, proto, v6, dst);
  }
  N.fwVerdict = fwVerdict;
  function hasFirewall(T) { return M4.fw(T).enabled || !!(T.nft && T.nft.tables.some(function (t) { return t.chains.some(function (c) { return c.hook === "input"; }); })); }
  function machineAt(sys, ip) { var ips = N.MACHINE_IPS(); if (!ips[ip]) return null; try { return M2.machine(sys, ip); } catch (e) { return null; } }
  function reachFrom(sys, ip, port) { return N.reach(sys, ip, { quiet: true, port: port }); }
  function verdictFor(sys, ip, port, proto) {
    var remote = isRemote(sys), home = homeOf(sys), src = srcOf(sys), n = isV6(ip) ? v6norm(ip) : ip;
    if (!home) return null;
    // the last hop of an ssh -J connection starts at the jump host
    if (sys.jumpFrom && sys.jumpFrom.to === n) { var jm = sys.jumpFrom.m; sys.jumpFrom = null; try { return verdictFor(jm, ip, port, proto) || { ok: true, r: reachFrom(jm, ip, port) }; } finally { sys.jumpFrom = null; } }
    var T = null, tip = n;
    if (remote && isWeb(home, n)) { T = home; tip = n === W.PUB ? ME : n; }
    else if (!remote && isWeb(home, n)) return null;            // to itself: over lo, no firewall
    else if (n === src || /^127\./.test(n)) return null;
    // our own outgoing connection: the replies come back in through the input chain
    else if (!remote && home.nft && home.nft.tables.length && proto === "tcp" && nftVerdict(home, { src: n, dst: ME, port: 40000 + (port % 20000), proto: "tcp", v6: isV6(n), ct: "established" }) !== "accept") return { err: "timeout", r: reachFrom(sys, ip, port), repliesDropped: true };
    else {
      var m = machineAt(sys, n);
      if (m && m !== sys && hasFirewall(m)) { T = m; tip = m.ip; }
      else if (remote) { var rr = reachFrom(sys, ip, port); if (!rr.ok) return { err: rr.err === "netunreach" ? "netunreach" : "timeout", r: rr }; var r0 = N.tcpOpen(home, ip, port); return Object.assign({}, r0, { r: rr }); }
      else return null;
    }
    var r = reachFrom(sys, ip, port);
    if (!r.ok) return { err: r.err === "netunreach" ? "netunreach" : r.err === "hostunreach" ? "hostunreach" : "timeout", r: r };
    var fv = fwVerdict(T, src, port, proto, isV6(n), tip);
    if (fv === "drop") return { err: "timeout", r: r, filtered: true };
    if (fv === "reject") return { err: "refused", r: r, rejected: true };
    if (proto === "udp") return { ok: true, r: r, target: T, tip: tip };
    var c = M2.tcpConnect(T, tip, port);
    return c.refused ? { err: "refused", r: r } : { ok: true, r: r, proc: c.proc, remote: T === home ? undefined : T, target: T };
  }
  var prevPreTcp = N.preTcp;
  N.preTcp = function (sys, ip, port, proto) {
    var v = verdictFor(sys, ip, port, proto || "tcp");
    if (v) return v;
    return prevPreTcp ? prevPreTcp(sys, ip, port, proto) : null;
  };
  N.verdictFor = verdictFor;

  /* ================================================================== ssh -J / ProxyJump */
  // ~/.ssh/config: the options for one alias (first value wins, like ssh)
  function sshCfg(sess, alias) {
    var t = rd(sess.sys, sess.home + "/.ssh/config") || "", res = {}, on = true;
    lines(t).forEach(function (l) {
      l = l.replace(/#.*/, "").trim(); if (!l) return;
      var m = /^(\w+)\s*(?:=\s*|\s+)(.*)$/.exec(l); if (!m) return;
      var k = m[1].toLowerCase(), v = m[2].trim();
      if (k === "host") { on = v.split(/\s+/).some(function (p) { return new RegExp("^" + p.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".") + "$", "i").test(alias); }); return; }
      if (k === "match") { on = false; return; }
      if (on && res[k] === undefined) res[k] = v;
    });
    return res;
  }
  N.sshCfg = sshCfg;
  var sshPrev = CMDS.ssh;
  CMDS.ssh = function (args, io, sess) {
    var a = args.slice(1), jump = null, target = null, k;
    for (k = 0; k < a.length; k++) { var x = a[k]; if (x === "-J") { jump = a[k + 1]; k++; continue; } if (x === "-o" && /^ProxyJump\s*=?\s*/i.test(a[k + 1] || "")) { jump = a[k + 1].replace(/^ProxyJump\s*=?\s*/i, ""); k++; continue; } if (/^-[iplFoLRDWEcmbP]$/.test(x)) { k++; continue; } if (/^-/.test(x)) continue; target = x; break; }
    if (!target) return sshPrev(args, io, sess);
    var alias = target.replace(/^[^@]*@/, ""), cfg = sshCfg(sess, alias);
    if (!jump && cfg.proxyjump && !/^none$/i.test(cfg.proxyjump)) jump = cfg.proxyjump;
    var host = cfg.hostname || alias, sys = sess.sys;
    var g = isV4(host) ? { ip: host } : N.getaddrinfo(sys, host, 4);
    // the machine we log in to sees the SSH connection coming from us (or from the jump host)
    var tm0 = g && g.ip ? machineAt(sys, g.ip) : null; if (tm0) tm0.sshFrom = srcOf(sys);
    if (!jump) {
      // an alias from ~/.ssh/config: check the network path to the real host first
      if (cfg.hostname && !g.err && g.ip) { var tc0 = N.tcpOpen(sys, g.ip, +(cfg.port || 22)); if (tc0.err && tc0.err !== "refused") { errl(io, "ssh: connect to host " + host + " port " + (cfg.port || 22) + ": " + ({ netunreach: "Network is unreachable", hostunreach: "No route to host", timeout: "Connection timed out" })[tc0.err]); return 255; } }
      return sshPrev(args, io, sess);
    }
    // first hop: log in to the jump host
    var jalias = jump.split(",")[0], jc = sshCfg(sess, jalias.replace(/^[^@]*@/, "")), jhost = jc.hostname || jalias.replace(/^[^@]*@/, "");
    var jg = isV4(jhost) ? { ip: jhost } : N.getaddrinfo(sys, jhost, 4);
    if (jg.err || !jg.ip) { errl(io, "ssh: Could not resolve hostname " + jhost + ": Name or service not known\nConnection closed by UNKNOWN port 65535"); return 255; }
    var jt = N.tcpOpen(sys, jg.ip, 22);
    if (jt.err) { errl(io, "ssh: connect to host " + jhost + " port 22: " + (jt.err === "refused" ? "Connection refused" : "Connection timed out") + "\nConnection closed by UNKNOWN port 65535"); return 255; }
    var jconn = M2.sshConnect(sess, jalias, {}, io, "jump");
    if (!jconn.ok) { errl(io, "Connection closed by UNKNOWN port 65535"); return 255; }
    if (g.err || !g.ip) { errl(io, "channel 0: open failed: administratively prohibited: open failed\nstdio forwarding failed\nConnection closed by UNKNOWN port 65535"); return 255; }
    // second hop: from the jump host to the target
    var hop = N.tcpOpen(jconn.m, g.ip, +(cfg.port || 22));
    if (hop.err) { errl(io, "channel 0: open failed: connect failed: " + (hop.err === "refused" ? "Connection refused" : "Connection timed out") + "\nstdio forwarding failed\nConnection closed by UNKNOWN port 65535"); return 255; }
    sys.jumpFrom = { to: g.ip, m: jconn.m };
    if (tm0) tm0.sshFrom = jconn.m.ip;
    sys.sshJumps = (sys.sshJumps || []).concat([{ via: jconn.m.host, to: g.ip }]);
    try { return sshPrev(args.filter(function (x, i2) { return !(x === "-J" || args[i2 - 1] === "-J"); }), io, sess); } finally { sys.jumpFrom = null; }
  };

  /* ================================================================== DNSSEC and DNS over HTTPS */
  // which zones are signed; the public resolvers validate, the local stub (DNSSEC=no) doesn't
  var SIGNED = { "example.com": "secure", "www.example.com": "secure", "dnssec-failed.org": "bogus", "isc.org": "secure" };
  var VALIDATING = ["1.1.1.1", "1.0.0.1", "8.8.8.8", "8.8.4.4", "9.9.9.9"];
  if (!DNS["dnssec-failed.org"]) DNS["dnssec-failed.org"] = { A: ["96.99.227.255"] };
  if (!DNS["isc.org"]) DNS["isc.org"] = { A: ["151.101.2.217"] };
  DNS["example.com"].DNSKEY = ["257 3 13 kXKkvWU3vGYfTJGl3qBd4qhiWp5aRs7YtkCJxD2d+t7KXqwahww5IgJt xJT2yFItlggazyfXqJEVOmMJ3qT0tQ=="];
  DNS["example.com"].DS = ["370 13 2 BE74359954660069D5C63D200C39F5603827D7DD02B56F120EE9F3A8 6764247C"];
  function rrsig(name, type, ttl) { return name.replace(/\.?$/, ".") + "\t" + ttl + "\tIN\tRRSIG\t" + type + " 13 " + (name.split(".").length) + " " + ttl + " 20261125061530 20261104045030 37939 " + name.replace(/^www\./, "").replace(/\.?$/, ".") + " " + M2.hashChars("sig" + name + type, 86) + "=="; }
  var digPrev2 = CMDS.dig;
  CMDS.dig = function (args, io, sess) {
    var a = args.slice(1), server = null, dnssec = false, cd = false, short = false, name = null, type = null;
    a.forEach(function (x) { if (/^@/.test(x)) server = x.slice(1); else if (x === "+dnssec") dnssec = true; else if (x === "+cd" || x === "+cdflag") cd = true; else if (x === "+short") short = true; else if (/^[+-]/.test(x)) return; else if (!type && /^(A|AAAA|MX|TXT|NS|CNAME|SOA|PTR|DS|DNSKEY|CAA|SRV|ANY)$/i.test(x) && (name || a.indexOf(x) < a.length - 1)) type = x.toUpperCase(); else if (!name) name = x.toLowerCase().replace(/\.$/, ""); });
    var st = name && SIGNED[name], validating = server && VALIDATING.indexOf(server) >= 0;
    if (!st || !validating) return digPrev2(args, io, sess);
    var buf = "", code = digPrev2(args, Object.assign({}, io, { out: function (t) { buf += t; } }), sess);
    var L = buf.split("\n");
    if (st === "bogus" && !cd) {
      if (short) { out(io, ""); return 0; }
      L = L.filter(function (l) { return !(l.indexOf(name + ".\t") === 0 && !/^;/.test(l)); }).map(function (l) { return l.replace(/status: NOERROR/, "status: SERVFAIL").replace(/ANSWER: \d+/, "ANSWER: 0").replace(/^;; ANSWER SECTION:$/, "; EDE: 6 (DNSSEC Bogus)"); });
      out(io, L.join("\n")); return 0;
    }
    if (st === "secure" && !cd) L = L.map(function (l) { return l.replace(/^;; flags: ([a-z ]+);/, function (m0, f) { return ";; flags: " + f + " ad;"; }); });
    if (dnssec) {
      var R = [];
      L.forEach(function (l) {
        if (/^; EDNS: version: 0, flags:;/.test(l)) l = l.replace("flags:;", "flags: do;");
        R.push(l);
        var m = /^(\S+)\t(\d+)\tIN\t(\w+)\t/.exec(l);
        if (m && !/^;/.test(l) && m[3] !== "RRSIG" && !R.some(function (x) { return x.indexOf("\tRRSIG\t" + m[3] + " ") > 0 && x.indexOf(m[1]) === 0; })) {
          var next = L[L.indexOf(l) + 1] || "";
          if (!new RegExp("^" + m[1].replace(/\./g, "\\.") + "\\t\\d+\\tIN\\t" + m[3] + "\\t").test(next)) R.push(rrsig(m[1].replace(/\.$/, ""), m[3], m[2]));
        }
        if (short && /^\S/.test(l) && !/^;/.test(l)) { /* +short prints data only */ }
      });
      if (short) R = R.concat(L.length && !/\t/.test(L[0]) ? [] : []);
      L = R;
    }
    out(io, L.join("\n"));
    return code;
  };
  N.SIGNED = SIGNED;
  // DNS over HTTPS: Cloudflare's JSON API
  N.MYSITES["1.1.1.1:443"] = function (req) {
    var q = {}; String(req.path.split("?")[1] || "").split("&").forEach(function (kv) { var p = kv.split("="); if (p[0]) q[decodeURIComponent(p[0])] = decodeURIComponent(p[1] || ""); });
    if (req.path.split("?")[0] !== "/dns-query") return { status: 404, headers: { "Content-Type": "text/plain" }, body: "Not Found\n" };
    if (!/application\/dns-json/.test(req.headers.accept || "")) return { status: 400, headers: { "Content-Type": "text/plain" }, body: "Bad Request: send accept: application/dns-json (or a binary DNS message)\n" };
    var t = (q.type || "A").toUpperCase(), n = String(q.name || "").toLowerCase().replace(/\.$/, ""), r = M2.dnsLookup(req.sys || {}, n, t, "1.1.1.1");
    var TN = { A: 1, NS: 2, CNAME: 5, MX: 15, TXT: 16, AAAA: 28, DS: 43, DNSKEY: 48 };
    var body = { Status: r.status === "NXDOMAIN" ? 3 : r.status === "SERVFAIL" || SIGNED[n] === "bogus" ? 2 : 0, TC: false, RD: true, RA: true, AD: SIGNED[n] === "secure", CD: false, Question: [{ name: n, type: TN[t] || 1 }] };
    var ans = r.chain.map(function (c) { return { name: c.name, type: 5, TTL: 300, data: c.data }; }).concat(r.answers.map(function (x) { return { name: x.name, type: TN[x.type] || 1, TTL: N.ttlOf ? N.ttlOf(req.sys || {}, x.name, x.type) : 300, data: x.data }; }));
    if (body.Status !== 2 && ans.length) body.Answer = ans;
    return { status: 200, headers: { "Content-Type": "application/dns-json", Server: "cloudflare", "Access-Control-Allow-Origin": "*" }, body: JSON.stringify(body) + "\n" };
  };

  /* ================================================================== nftables */
  function NftError(msg, line, col) { this.message = msg; this.line = line; this.col = col; }
  function nftState(sys) { if (!sys.nft) sys.nft = { tables: [], handle: 0 }; return sys.nft; }
  function tokenize(text) {
    var toks = [], i = 0, line = 1;
    while (i < text.length) {
      var c = text.charAt(i);
      if (c === "\n") { toks.push({ t: "nl", line: line }); line++; i++; continue; }
      if (/\s/.test(c)) { i++; continue; }
      if (c === "#") { while (i < text.length && text.charAt(i) !== "\n") i++; continue; }
      if (c === "\\" && text.charAt(i + 1) === "\n") { i += 2; line++; continue; }
      if ("{};,".indexOf(c) >= 0) { toks.push({ t: c, line: line }); i++; continue; }
      if (c === "\"") { var j = text.indexOf("\"", i + 1); if (j < 0) throw new NftError("syntax error, unterminated string", line); toks.push({ t: "w", v: text.slice(i + 1, j), q: true, line: line }); i = j + 1; continue; }
      var w = ""; while (i < text.length && !/[\s{};,#"]/.test(text.charAt(i))) w += text.charAt(i++);
      toks.push({ t: "w", v: w, line: line });
    }
    return toks;
  }
  var FAMS = { ip: 1, ip6: 1, inet: 1, arp: 1, bridge: 1, netdev: 1 };
  var PRIO = { raw: -300, mangle: -150, dstnat: -100, filter: 0, security: 50, srcnat: 100 };
  var ICMP_TYPES = ["echo-reply", "destination-unreachable", "echo-request", "time-exceeded", "parameter-problem", "router-advertisement", "router-solicitation", "nd-router-solicit", "nd-router-advert", "nd-neighbor-solicit", "nd-neighbor-advert", "packet-too-big"];
  // a rule: list of matches and statements from its words
  function parseRuleWords(ws, line) {
    var r = { m: [], counter: null, log: null, verdict: null, target: null, limit: null };
    function val(i) {
      if (ws[i] && ws[i].v === "{") { var set = [], k = i + 1; while (k < ws.length && ws[k].v !== "}") { if (ws[k].v !== ",") set.push(ws[k].v); k++; } if (k >= ws.length) throw new NftError("syntax error, unexpected end of file, expecting '}'", line); return { set: set, next: k + 1 }; }
      if (!ws[i]) throw new NftError("syntax error, unexpected newline", line);
      var list = [ws[i].v], k2 = i + 1;
      while (ws[k2] && ws[k2].v === "," && ws[k2 + 1]) { list.push(ws[k2 + 1].v); k2 += 2; }   // established,related
      return { set: list, next: k2, single: list.length === 1, q: ws[i].q };
    }
    for (var i = 0; i < ws.length;) {
      var w = ws[i].v, neg = false;
      if (w === "iif" || w === "iifname" || w === "oif" || w === "oifname") { var v1 = val(i + 1); r.m.push({ k: w, set: v1.set }); i = v1.next; continue; }
      if (w === "ct" && ws[i + 1] && ws[i + 1].v === "state") { var v2 = val(i + 2); v2.set.forEach(function (s) { if (!/^(new|established|related|invalid|untracked)$/.test(s)) throw new NftError("Could not parse ct state \"" + s + "\"", line); }); r.m.push({ k: "ct state", set: v2.set }); i = v2.next; continue; }
      if ((w === "ip" || w === "ip6") && ws[i + 1] && /^(saddr|daddr)$/.test(ws[i + 1].v)) { var j = i + 2; if (ws[j] && ws[j].v === "!=") { neg = true; j++; } var v3 = val(j); r.m.push({ k: w + " " + ws[i + 1].v, set: v3.set, neg: neg }); i = v3.next; continue; }
      if (w === "ip" && ws[i + 1] && ws[i + 1].v === "protocol") { var v4 = val(i + 2); r.m.push({ k: "ip protocol", set: v4.set }); i = v4.next; continue; }
      if (w === "ip6" && ws[i + 1] && ws[i + 1].v === "nexthdr") { var v4b = val(i + 2); r.m.push({ k: "ip6 nexthdr", set: v4b.set }); i = v4b.next; continue; }
      if ((w === "tcp" || w === "udp" || w === "th") && ws[i + 1] && /^(dport|sport)$/.test(ws[i + 1].v)) { var j2 = i + 2; if (ws[j2] && ws[j2].v === "!=") { neg = true; j2++; } var v5 = val(j2); v5.set.forEach(function (p) { if (!/^\d+(-\d+)?$/.test(p) && !N.SVC_PORT(p)) throw new NftError("Could not resolve service: Servname not found in nft services list", line); }); r.m.push({ k: w + " " + ws[i + 1].v, set: v5.set, neg: neg }); i = v5.next; continue; }
      if (w === "meta" && ws[i + 1] && /^(l4proto|nfproto|iif|iifname)$/.test(ws[i + 1].v)) { var v6 = val(i + 2); r.m.push({ k: ws[i + 1].v === "l4proto" ? "meta l4proto" : ws[i + 1].v === "nfproto" ? "meta nfproto" : ws[i + 1].v, set: v6.set }); i = v6.next; continue; }
      if ((w === "icmp" || w === "icmpv6") && ws[i + 1] && ws[i + 1].v === "type") { var v7 = val(i + 2); v7.set.forEach(function (t) { if (ICMP_TYPES.indexOf(t) < 0) throw new NftError("Could not parse ICMP" + (w === "icmpv6" ? "v6" : "") + " type " + t, line); }); r.m.push({ k: w + " type", set: v7.set }); i = v7.next; continue; }
      if (w === "counter") { r.counter = { p: 0, b: 0 }; i++; if (ws[i] && ws[i].v === "packets") i += 4; continue; }
      if (w === "log") { r.log = { prefix: "" }; i++; while (ws[i] && /^(prefix|level|flags)$/.test(ws[i].v)) { if (ws[i].v === "prefix") r.log.prefix = ws[i + 1] ? ws[i + 1].v : ""; else if (ws[i].v === "level") r.log.level = ws[i + 1] && ws[i + 1].v; i += 2; } continue; }
      if (w === "limit" && ws[i + 1] && ws[i + 1].v === "rate") { var k3 = i + 2, lim = []; while (ws[k3] && !/^(accept|drop|reject|counter|log|jump|goto|return)$/.test(ws[k3].v)) lim.push(ws[k3++].v); r.limit = lim.join(" "); i = k3; continue; }
      if (/^(accept|drop|return|continue)$/.test(w)) { r.verdict = w; i++; continue; }
      if (w === "reject") { r.verdict = "reject"; i++; if (ws[i] && ws[i].v === "with") { r.rejectWith = ws.slice(i + 1, i + 3).map(function (x) { return x.v; }).join(" "); i += 3; } continue; }
      if (w === "jump" || w === "goto") { if (!ws[i + 1]) throw new NftError("syntax error, unexpected newline, expecting string", line); r.verdict = w; r.target = ws[i + 1].v; i += 2; continue; }
      if (w === "comment") { r.comment = ws[i + 1] ? ws[i + 1].v : ""; i += 2; continue; }
      throw new NftError("syntax error, unexpected " + (/^[a-z]+$/.test(w) ? w : "string"), line);
    }
    if (!r.m.length && !r.verdict && !r.counter && !r.log) throw new NftError("syntax error, unexpected newline", line);
    return r;
  }
  function ruleText(r) {
    var p = r.m.map(function (m) { var v = m.k === "ct state" ? m.set.join(",") : m.set.length > 1 ? "{ " + m.set.join(", ") + " }" : (/^(iif|iifname|oif|oifname|meta iifname)$/.test(m.k) ? "\"" + m.set[0] + "\"" : m.set[0]); return m.k + " " + (m.neg ? "!= " : "") + v; });
    if (r.limit) p.push("limit rate " + r.limit);
    if (r.counter) p.push("counter packets " + r.counter.p + " bytes " + r.counter.b);
    if (r.log) p.push("log" + (r.log.prefix ? " prefix \"" + r.log.prefix + "\"" : "") + (r.log.level ? " level " + r.log.level : ""));
    if (r.verdict) p.push(r.verdict + (r.target ? " " + r.target : "") + (r.rejectWith ? " with " + r.rejectWith : ""));
    if (r.comment) p.push("comment \"" + r.comment + "\"");
    return p.join(" ");
  }
  // parse a whole ruleset file (or one nft command line) into operations
  function parseNft(text) {
    var toks = tokenize(text), i = 0, ops = [];
    function peek() { return toks[i]; }
    function skipNl() { while (toks[i] && (toks[i].t === "nl" || toks[i].t === ";")) i++; }
    function word() { var t = toks[i]; if (!t || t.t !== "w") throw new NftError("syntax error, unexpected " + (t ? (t.t === "nl" ? "newline" : "'" + t.t + "'") : "end of file") + ", expecting string", t ? t.line : 0); i++; return t.v; }
    function stmtWords() { var ws = []; while (toks[i] && toks[i].t !== "nl" && toks[i].t !== ";" && !(toks[i].t === "}" && !ws.some(function (x) { return x.v === "{"; }) )) { var t = toks[i]; ws.push(t.t === "w" ? t : { v: t.t, line: t.line }); i++; if (t.t === "}" && ws.filter(function (x) { return x.v === "{"; }).length === ws.filter(function (x) { return x.v === "}"; }).length) { /* closed set */ } } return ws; }
    function chainBody(ch) {
      while (true) {
        skipNl();
        var t = peek(); if (!t) throw new NftError("syntax error, unexpected end of file", 0);
        if (t.t === "}") { i++; return; }
        if (t.t === "w" && t.v === "type") {
          var ws = []; while (toks[i] && toks[i].t !== ";" && toks[i].t !== "nl") { ws.push(toks[i].v); i++; }
          if (ws[1] !== "filter" && ws[1] !== "nat" && ws[1] !== "route") throw new NftError("Could not parse chain type " + ws[1], t.line);
          if (ws[2] !== "hook") throw new NftError("syntax error, unexpected newline, expecting hook", t.line);
          ch.type = ws[1]; ch.hook = ws[3]; ch.prio = ws[5] != null ? ws[5] : "0";
          if (!/^(input|output|forward|prerouting|postrouting|ingress)$/.test(ch.hook || "")) throw new NftError("unknown chain hook " + ch.hook, t.line);
          continue;
        }
        if (t.t === "w" && t.v === "policy") { i++; var pv = word(); if (!/^(accept|drop)$/.test(pv)) throw new NftError("syntax error, unexpected " + pv + ", expecting accept or drop", t.line); ch.policy = pv; continue; }
        var ws2 = stmtWords();
        if (!ws2.length) { i++; continue; }
        ch.rules.push(parseRuleWords(ws2, t.line));
      }
    }
    function tableBody(tb) {
      while (true) {
        skipNl();
        var t = peek(); if (!t) throw new NftError("syntax error, unexpected end of file, expecting '}'", 0);
        if (t.t === "}") { i++; return; }
        var w = word();
        if (w === "chain") { var cn = word(); skipNl(); if (!peek() || peek().t !== "{") throw new NftError("syntax error, expecting '{'", t.line); i++; var ch = { name: cn, rules: [], policy: null }; chainBody(ch); tb.chains.push(ch); continue; }
        if (w === "set" || w === "map") { var depth = 0; while (toks[i]) { if (toks[i].t === "{") depth++; if (toks[i].t === "}") { depth--; if (depth === 0) { i++; break; } } i++; } continue; }
        throw new NftError("syntax error, unexpected " + w, t.line);
      }
    }
    while (true) {
      skipNl();
      var t = peek(); if (!t) break;
      var w = word();
      if (w === "flush" && peek() && peek().v === "ruleset") { i++; ops.push({ op: "flush" }); continue; }
      if (w === "table") {
        var fam = word(), name; if (!FAMS[fam]) { name = fam; fam = "ip"; } else name = word();
        skipNl(); if (!peek() || peek().t !== "{") throw new NftError("syntax error, expecting '{'", t.line); i++;
        var tb = { family: fam, name: name, chains: [] }; tableBody(tb); ops.push({ op: "table", table: tb }); continue;
      }
      if (w === "include") { word(); continue; }
      if (w === "#!/usr/sbin/nft") continue;
      throw new NftError("syntax error, unexpected " + w, t.line);
    }
    return ops;
  }
  N.parseNft = parseNft;
  function applyOps(sys, ops) {
    var st = nftState(sys);
    ops.forEach(function (o) {
      if (o.op === "flush") { st.tables = []; return; }
      var tb = st.tables.filter(function (x) { return x.family === o.table.family && x.name === o.table.name; })[0];
      if (!tb) { tb = { family: o.table.family, name: o.table.name, chains: [], handle: ++st.handle }; st.tables.push(tb); }
      o.table.chains.forEach(function (c) {
        var ch = tb.chains.filter(function (x) { return x.name === c.name; })[0];
        if (!ch) { ch = { name: c.name, rules: [], handle: ++st.handle }; tb.chains.push(ch); }
        if (c.hook) { ch.type = c.type; ch.hook = c.hook; ch.prio = c.prio; }
        if (c.policy) ch.policy = c.policy;
        c.rules.forEach(function (r) { r.handle = ++st.handle; ch.rules.push(r); });
      });
    });
  }
  function checkJumps(sys, ops) {
    var st = nftState(sys), errs = [];
    ops.forEach(function (o) { if (o.op !== "table") return; o.table.chains.forEach(function (c) { c.rules.forEach(function (r) { if (r.target) { var known = o.table.chains.some(function (x) { return x.name === r.target; }) || st.tables.some(function (t) { return t.name === o.table.name && t.chains.some(function (x) { return x.name === r.target; }); }); if (!known) errs.push("Error: Could not process rule: No such file or directory\njump " + r.target); } }); }); });
    return errs;
  }
  function famMatch(fam, v6) { return fam === "inet" || (fam === "ip" && !v6) || (fam === "ip6" && v6); }
  function protoNum(p) { return { tcp: "tcp", udp: "udp", icmp: "icmp", "ipv6-icmp": "icmp", icmpv6: "icmp", "6": "tcp", "17": "udp", "1": "icmp", "58": "icmp" }[p] || p; }
  function portOk(set, port) { return set.some(function (s) { var r = /^(\d+)-(\d+)$/.exec(s); if (r) return port >= +r[1] && port <= +r[2]; var n = /^\d+$/.test(s) ? +s : N.SVC_PORT(s); return n === port; }); }
  function matchRule(r, pk) {
    for (var i = 0; i < r.m.length; i++) {
      var m = r.m[i], ok;
      if (/^(iif|iifname|meta iif|meta iifname)$/.test(m.k)) ok = m.set.indexOf(pk.iif || "eth0") >= 0;
      else if (/^(oif|oifname)$/.test(m.k)) ok = false;
      else if (m.k === "ct state") ok = m.set.indexOf(pk.ct || "new") >= 0;
      else if (m.k === "ip saddr") ok = !pk.v6 && m.set.some(function (c) { return inNet(pk.src, c); });
      else if (m.k === "ip daddr") ok = !pk.v6 && m.set.some(function (c) { return inNet(pk.dst, c); });
      else if (m.k === "ip6 saddr") ok = pk.v6 && m.set.some(function (c) { return inNet(pk.src, c); });
      else if (m.k === "ip6 daddr") ok = pk.v6 && m.set.some(function (c) { return inNet(pk.dst, c); });
      else if (m.k === "ip protocol") ok = !pk.v6 && m.set.some(function (p) { return protoNum(p) === pk.proto && (p !== "icmp" || true); });
      else if (m.k === "ip6 nexthdr") ok = pk.v6 && m.set.some(function (p) { return protoNum(p) === pk.proto; });
      else if (m.k === "meta l4proto") ok = m.set.some(function (p) { return protoNum(p) === pk.proto && (p === "icmp" ? !pk.v6 : /ipv6-icmp|icmpv6/.test(p) ? pk.v6 : true); });
      else if (m.k === "meta nfproto") ok = m.set.indexOf(pk.v6 ? "ipv6" : "ipv4") >= 0;
      else if (m.k === "tcp dport") ok = pk.proto === "tcp" && portOk(m.set, pk.port);
      else if (m.k === "udp dport") ok = pk.proto === "udp" && portOk(m.set, pk.port);
      else if (m.k === "th dport") ok = (pk.proto === "tcp" || pk.proto === "udp") && portOk(m.set, pk.port);
      else if (/sport$/.test(m.k)) ok = false;
      else if (m.k === "icmp type") ok = pk.proto === "icmp" && !pk.v6 && m.set.indexOf("echo-request") >= 0;
      else if (m.k === "icmpv6 type") ok = pk.proto === "icmp" && pk.v6 && m.set.indexOf("echo-request") >= 0;
      else ok = false;
      if (m.neg) ok = !ok;
      if (!ok) return false;
    }
    return true;
  }
  function runChain(T, tb, ch, pk, depth) {
    for (var i = 0; i < ch.rules.length; i++) {
      var r = ch.rules[i];
      if (!matchRule(r, pk)) continue;
      if (r.counter) { r.counter.p += 1; r.counter.b += pk.proto === "tcp" ? 60 : pk.proto === "udp" ? 36 : 84; }
      if (r.log) kernLog(T, blockLine(r.log.prefix, T, pk.src, pk.dst, pk.port, pk.proto));
      if (r.verdict === "accept" || r.verdict === "drop" || r.verdict === "reject") return r.verdict;
      if (r.verdict === "return") return null;
      if ((r.verdict === "jump" || r.verdict === "goto") && depth < 8) {
        var tgt = tb.chains.filter(function (x) { return x.name === r.target; })[0];
        if (tgt) { var v = runChain(T, tb, tgt, pk, depth + 1); if (v) return v; if (r.verdict === "goto") return null; }
      }
    }
    return null;
  }
  function nftVerdict(T, pk) {
    if (!T.nft || !T.nft.tables.length) return "accept";
    var base = [];
    T.nft.tables.forEach(function (tb) { if (!famMatch(tb.family, pk.v6)) return; tb.chains.forEach(function (ch) { if (ch.hook === "input" && ch.type === "filter") base.push({ tb: tb, ch: ch, prio: PRIO[ch.prio] != null ? PRIO[ch.prio] : +ch.prio || 0 }); }); });
    base.sort(function (a, b) { return a.prio - b.prio; });
    for (var i = 0; i < base.length; i++) {
      var v = runChain(T, base[i].tb, base[i].ch, pk, 0) || base[i].ch.policy || "accept";
      if (v !== "accept") return v;
    }
    return "accept";
  }
  N.nftVerdict = nftVerdict;
  function listTable(tb, a) {
    var L = ["table " + tb.family + " " + tb.name + " {" + (a ? " # handle " + tb.handle : "")];
    tb.chains.forEach(function (ch, k) {
      if (k) L.push("");
      L.push("\tchain " + ch.name + " {" + (a ? " # handle " + ch.handle : ""));
      if (ch.hook) L.push("\t\ttype " + ch.type + " hook " + ch.hook + " priority " + ch.prio + "; policy " + (ch.policy || "accept") + ";");
      ch.rules.forEach(function (r) { L.push("\t\t" + ruleText(r) + (a ? " # handle " + r.handle : "")); });
      L.push("\t}");
    });
    L.push("}");
    return L;
  }
  function nftErr(io, e, src) { errl(io, (src ? src + ":" + e.line + ":1-1: " : "") + "Error: " + e.message.replace(/^Error: /, "")); }
  var nftPrev = CMDS.nft;
  CMDS.nft = function (args, io, sess) {
    var sys = sess.sys, a = args.slice(1), handles = false, check = false, file = null;
    var rest = [];
    for (var i = 0; i < a.length; i++) { var x = a[i]; if (x === "-a" || x === "--handle") handles = true; else if (x === "-c" || x === "--check") check = true; else if (x === "-f" || x === "--file") file = a[++i]; else if (/^-[ac]+f?$/.test(x)) { if (x.indexOf("a") >= 0) handles = true; if (x.indexOf("c") >= 0) check = true; if (/f$/.test(x)) file = a[++i]; } else if (x === "-n" || x === "-s" || x === "--stateless") continue; else if (x === "-v" || x === "--version") { out(io, "nftables v1.0.9 (Old Doc Yak #3)\n"); return 0; } else rest.push(x); }
    if (sess.uid !== 0) { errl(io, "Error: Could not process rule: Operation not permitted"); return 1; }
    var st = nftState(sys);
    if (file) {
      var rf = S.readFile(sess, file);
      if (rf.error) { errl(io, "Error: Could not process rule: No such file or directory\n" + file); return 1; }
      var ops;
      try { ops = parseNft(rf.content); } catch (e) { if (!(e instanceof NftError)) throw e; nftErr(io, e, file); return 1; }
      var je = checkJumps(sys, ops); if (je.length) { errl(io, je[0]); return 1; }
      if (check) return 0;
      applyOps(sys, ops);
      N.ev(sys, { k: "link", what: "nft -f " + file, layer: 3, nowire: true });
      return 0;
    }
    var cmd = rest[0];
    if (!cmd) { errl(io, "Error: syntax error, unexpected end of file"); return 1; }
    if (cmd === "list") {
      var what = rest[1];
      if (what === "ruleset") { var L = []; st.tables.forEach(function (tb) { L = L.concat(listTable(tb, handles)); }); if (L.length) out(io, L.join("\n") + "\n"); if (M4.fw(sys).enabled && nftPrev) return nftPrev(["nft", "list", "ruleset"], io, sess); return 0; }
      if (what === "tables") { out(io, joinLines(st.tables.map(function (tb) { return "table " + tb.family + " " + tb.name; }))); return 0; }
      var fam = FAMS[rest[2]] ? rest[2] : "ip", off = FAMS[rest[2]] ? 3 : 2, tname = rest[off], tb = st.tables.filter(function (t) { return t.family === fam && t.name === tname; })[0];
      if (!tb) { errl(io, "Error: No such file or directory\nlist " + what + " " + rest.slice(2).join(" ")); return 1; }
      if (what === "table") { out(io, listTable(tb, handles).join("\n") + "\n"); return 0; }
      if (what === "chain") { var ch = tb.chains.filter(function (c) { return c.name === rest[off + 1]; })[0]; if (!ch) { errl(io, "Error: No such file or directory\nlist chain " + rest.slice(2).join(" ")); return 1; } out(io, listTable({ family: tb.family, name: tb.name, handle: tb.handle, chains: [ch] }, handles).join("\n") + "\n"); return 0; }
      errl(io, "Error: syntax error, unexpected " + what); return 1;
    }
    if (cmd === "flush" && rest[1] === "ruleset") { st.tables = []; return 0; }
    if (cmd === "flush" && rest[1] === "chain") { var fc = findChain(st, rest.slice(2)); if (!fc) { errl(io, "Error: No such file or directory"); return 1; } fc.ch.rules = []; return 0; }
    if ((cmd === "add" || cmd === "create") && rest[1] === "table") { var f2 = FAMS[rest[2]] ? rest[2] : "ip", n2 = FAMS[rest[2]] ? rest[3] : rest[2]; if (!st.tables.some(function (t) { return t.family === f2 && t.name === n2; })) st.tables.push({ family: f2, name: n2, chains: [], handle: ++st.handle }); return 0; }
    if ((cmd === "add" || cmd === "create") && rest[1] === "chain") {
      var f3 = FAMS[rest[2]] ? rest[2] : "ip", o3 = FAMS[rest[2]] ? 3 : 2, tb3 = st.tables.filter(function (t) { return t.family === f3 && t.name === rest[o3]; })[0];
      if (!tb3) { errl(io, "Error: Could not process rule: No such file or directory\nadd chain " + rest.slice(2).join(" ")); return 1; }
      var body = rest.slice(o3 + 2).join(" "), ops3;
      try { ops3 = parseNft("table " + f3 + " " + rest[o3] + " { chain " + rest[o3 + 1] + " " + (body ? body.replace(/^\{?/, "{").replace(/\}?$/, "}") : "{ }") + " }"); } catch (e) { if (!(e instanceof NftError)) throw e; nftErr(io, e); return 1; }
      applyOps(sys, ops3); return 0;
    }
    if (cmd === "add" && rest[1] === "rule" || cmd === "insert" && rest[1] === "rule") {
      var fc2 = findChain(st, rest.slice(2));
      if (!fc2) { errl(io, "Error: Could not process rule: No such file or directory\n" + rest.join(" ")); return 1; }
      var rw = rest.slice(2 + fc2.next), pos = null;
      if (rw[0] === "position" || rw[0] === "handle") { pos = +rw[1]; rw = rw.slice(2); }
      var r;
      try { var wtoks = tokenize(rw.join(" ")).filter(function (t) { return t.t !== "nl"; }).map(function (t) { return t.t === "w" ? t : { v: t.t, line: 1 }; }); r = parseRuleWords(wtoks, 1); } catch (e) { if (!(e instanceof NftError)) throw e; errl(io, "Error: " + e.message + "\n" + rest.join(" ")); return 1; }
      if (r.target && !fc2.tb.chains.some(function (c) { return c.name === r.target; })) { errl(io, "Error: Could not process rule: No such file or directory\n" + rest.join(" ")); return 1; }
      r.handle = ++st.handle;
      var list = fc2.ch.rules, at = pos != null ? list.findIndex(function (x) { return x.handle === pos; }) : -1;
      if (pos != null && at < 0) { errl(io, "Error: Could not process rule: No such file or directory\n" + rest.join(" ")); return 1; }
      if (cmd === "insert") list.splice(at >= 0 ? at : 0, 0, r); else list.splice(at >= 0 ? at + 1 : list.length, 0, r);
      return 0;
    }
    if (cmd === "delete" && rest[1] === "rule") {
      var fc3 = findChain(st, rest.slice(2)); var hi = rest.indexOf("handle");
      if (!fc3 || hi < 0) { errl(io, "Error: syntax error, unexpected end of file, expecting handle"); return 1; }
      var hn = +rest[hi + 1], k3 = fc3.ch.rules.findIndex(function (x) { return x.handle === hn; });
      if (k3 < 0) { errl(io, "Error: Could not process rule: No such file or directory\n" + rest.join(" ")); return 1; }
      fc3.ch.rules.splice(k3, 1); return 0;
    }
    if (cmd === "delete" && rest[1] === "table") { var f4 = FAMS[rest[2]] ? rest[2] : "ip", n4 = FAMS[rest[2]] ? rest[3] : rest[2], k4 = st.tables.findIndex(function (t) { return t.family === f4 && t.name === n4; }); if (k4 < 0) { errl(io, "Error: Could not process rule: No such file or directory"); return 1; } st.tables.splice(k4, 1); return 0; }
    if (cmd === "reset" && rest[1] === "counters") { st.tables.forEach(function (tb) { tb.chains.forEach(function (ch) { ch.rules.forEach(function (r) { if (r.counter) r.counter = { p: 0, b: 0 }; }); }); }); return 0; }
    errl(io, "Error: syntax error, unexpected " + cmd); return 1;
  };
  function findChain(st, w) {
    var fam = FAMS[w[0]] ? w[0] : "ip", o = FAMS[w[0]] ? 1 : 0, tb = st.tables.filter(function (t) { return t.family === fam && t.name === w[o]; })[0];
    if (!tb) return null;
    var ch = tb.chains.filter(function (c) { return c.name === w[o + 1]; })[0];
    return ch ? { tb: tb, ch: ch, next: o + 2 } : null;
  }

  /* ================================================================== nmap */
  var TOP = [80, 23, 443, 21, 22, 25, 3389, 110, 445, 139, 143, 53, 135, 3306, 8080, 1723, 111, 995, 993, 5900, 1025, 587, 8888, 199, 1720, 465, 548, 113, 81, 6001, 10000, 514, 5060, 179, 1026, 2000, 8443, 8000, 32768, 554, 26, 1433, 49152, 2001, 515, 8008, 49154, 1027, 5666, 646, 5000, 5631, 631, 49153, 8081, 2049, 88, 79, 5800, 106, 2121, 1110, 49155, 6000, 513, 990, 5357, 427, 49156, 543, 544, 5101, 144, 7, 389, 8009, 3128, 444, 9999, 5009, 7070, 5190, 3000, 5432, 1900, 3986, 13, 1029, 9, 5051, 6646, 49157, 1028, 873, 1755, 2717, 4899, 9100, 119, 37,
    2222, 9090, 8082, 9000, 9200, 5001, 873, 6667, 8181, 1521, 2375, 8089];
  var TOP_UDP = [631, 161, 137, 123, 138, 1434, 445, 135, 67, 53, 139, 500, 68, 520, 1900, 4500, 514, 49152, 162, 69];
  var SVCNAME = { 7: "echo", 9: "discard", 13: "daytime", 21: "ftp", 22: "ssh", 23: "telnet", 25: "smtp", 26: "rsftp", 37: "time", 53: "domain", 67: "dhcps", 68: "dhcpc", 69: "tftp", 79: "finger", 80: "http", 81: "hosts2-ns", 88: "kerberos-sec", 106: "pop3pw", 110: "pop3", 111: "rpcbind", 113: "ident", 119: "nntp", 123: "ntp", 135: "msrpc", 137: "netbios-ns", 138: "netbios-dgm", 139: "netbios-ssn", 143: "imap", 144: "news", 161: "snmp", 162: "snmptrap", 179: "bgp", 199: "smux", 389: "ldap", 427: "svrloc", 443: "https", 444: "snpp", 445: "microsoft-ds", 465: "smtps", 500: "isakmp", 513: "login", 514: "shell", 515: "printer", 520: "route", 543: "klogin", 544: "kshell", 548: "afp", 554: "rtsp", 587: "submission", 631: "ipp", 636: "ldapssl", 646: "ldp", 873: "rsync", 990: "ftps", 993: "imaps", 995: "pop3s", 1025: "NFS-or-IIS", 1433: "ms-sql-s", 1434: "ms-sql-m", 1521: "oracle", 1723: "pptp", 1900: "upnp", 2049: "nfs", 2121: "ccproxy-ftp", 2222: "EtherNetIP-1", 2375: "docker", 2376: "docker", 3000: "ppp", 3128: "squid-http", 3306: "mysql", 3389: "ms-wbt-server", 4500: "nat-t-ike", 5000: "upnp", 5432: "postgresql", 5900: "vnc", 6379: "redis", 6443: "sun-sr-https", 8000: "http-alt", 8008: "http", 8080: "http-proxy", 8081: "blackice-icecap", 8443: "https-alt", 8888: "sun-answerbook", 9000: "cslistener", 9090: "zeus-admin", 9100: "jetdirect", 9200: "wap-wsp", 10000: "snet-sensor-mgmt", 10250: "unknown", 11211: "memcache", 27017: "mongod", 51820: "unknown" };
  N.SVC_PORT = function (name) { for (var k in SVCNAME) if (SVCNAME[k] === name) return +k; return { http: 80, https: 443, ssh: 22, domain: 53, dns: 53 }[name] || null; };
  var VERSION_OF_PROC = { sshd: "OpenSSH 9.6p1 Ubuntu 3ubuntu13.5 (Ubuntu Linux; protocol 2.0)", nginx: "nginx 1.24.0 (Ubuntu)", "redis-server": "Redis key-value store 7.0.15", memcached: "Memcached 1.6.24 (uptime 512312 seconds)", dockerd: "Docker 26.1.3 (API 1.45)", mysqld: "MySQL 8.0.39-0ubuntu0.24.04.2", inetd: "Linux telnetd", "inetutils-inetd": "Linux telnetd", gunicorn: "Gunicorn 21.2.0", postgres: "PostgreSQL DB 16.4 - 16.6", node_exporter: "Golang net/http server (Prometheus node_exporter)", snmpd: "net-snmp; net-snmp SNMPv3 server", "systemd-resolve": "dnsmasq-like stub", chronyd: "NTP v4 (secondary server)" };
  var NAME_OF_PROC = { sshd: "ssh", nginx: "http", "redis-server": "redis", memcached: "memcache", dockerd: "docker", mysqld: "mysql", inetd: "telnet", "inetutils-inetd": "telnet", gunicorn: "http", postgres: "postgresql", node_exporter: "http", snmpd: "snmp" };
  function versionOfSvc(sv, port) {
    if (!sv) return "";
    var b = sv.banner || "";
    var m = /SSH-2\.0-OpenSSH_(\S+?)\s?(Ubuntu-\S+)?\r?\n?$/.exec(b); if (m) return "OpenSSH " + m[1] + (m[2] ? " " + m[2].replace("-", " ") : "") + " (Ubuntu Linux; protocol 2.0)";
    if (/vsFTPd ([\d.]+)/.test(b)) return "vsftpd " + /vsFTPd ([\d.]+)/.exec(b)[1];
    if (/Postfix/.test(b)) return "Postfix smtpd";
    if (/Dovecot/.test(b)) return "Dovecot " + (port === 110 ? "pop3d" : "imapd");
    if (/login: /.test(b)) return "Linux telnetd";
    if (/^J\n5\.7/.test(b)) return "MySQL 5.7.42-0ubuntu0.18.04.1";
    if (sv.http) { try { var res = sv.http({ method: "GET", path: "/", headers: {} }); var srv = res.headers.Server || res.headers.server; if (res.headers["X-Jenkins"]) return "Jetty 10.0.13"; if (srv) return srv.replace(/\//, " ").replace(/\s*\(linux\)$/, ""); if (sv.name === "elasticsearch") return "Elasticsearch REST API 7.10.2 (name: kc-data-01; cluster: kestrel-logs; Lucene 8.7.0)"; } catch (e) { return ""; } }
    if (sv.name === "redis") return "Redis key-value store 7.0.15";
    if (sv.name === "mongodb") return "MongoDB 4.4.29";
    if (sv.name === "snmp") return "SNMPv1 server; net-snmp SNMPv3 server (public)";
    if (sv.name === "ntp") return "NTP v4 (unsynchronized)";
    return "";
  }
  function expandTargets(sys, specs, io, noDns) {
    var T = [];
    for (var i = 0; i < specs.length; i++) {
      var s = specs[i], m = /^([\d.]+)\/(\d+)$/.exec(s);
      if (m && isV4(m[1])) { var pre = +m[2]; if (pre < 16) { errl(io, "Your netmask is too broad for this lab: scan a /16 or smaller."); return null; } var base = N.ip2n(N.netOf(m[1], pre)), cnt = Math.pow(2, 32 - pre); for (var k = 0; k < cnt; k++) T.push({ ip: N.n2ip(base + k), name: null, sweep: true }); continue; }
      var r = /^(\d+\.\d+\.\d+)\.(\d+)-(\d+)$/.exec(s); if (r) { for (var q = +r[2]; q <= +r[3]; q++) T.push({ ip: r[1] + "." + q, name: null, sweep: true }); continue; }
      if (isV4(s) || isV6(s)) { T.push({ ip: isV6(s) ? v6norm(s) : s, name: null }); continue; }
      var g = N.getaddrinfo(sys, s, 4);
      if (g.err || !g.ip) { errl(io, "Failed to resolve \"" + s + "\"."); continue; }
      T.push({ ip: g.ip, name: s });
    }
    return T;
  }
  function parsePorts(spec) {
    var res = [], tcpU = { t: [], u: [] }, cur = "t";
    String(spec).split(",").forEach(function (p) {
      var m = /^([TU]):(.*)$/.exec(p); if (m) { cur = m[1] === "T" ? "t" : "u"; p = m[2]; }
      var r = /^(\d*)-(\d*)$/.exec(p);
      if (r) { var a = r[1] ? +r[1] : 1, b = r[2] ? +r[2] : 65535; tcpU[cur].push([a, b]); }
      else if (/^\d+$/.test(p)) tcpU[cur].push([+p, +p]);
      else { var n = N.SVC_PORT(p); if (n) tcpU[cur].push([n, n]); }
    });
    void res;
    return tcpU;
  }
  // every port worth asking about on a host: the known open/filtered ones plus the requested list
  function interesting(sys, ip, proto) {
    var set = {}, home = homeOf(sys) || sys;
    var hs = N.HOSTSVC(home, ip); if (hs) Object.keys(hs).forEach(function (p) { if (!!hs[p].udp === (proto === "udp")) set[p] = 1; });
    var tgt = isWeb(home, ip) || ip === srcOf(sys) || /^127\./.test(ip) ? (isWeb(home, ip) ? home : sys) : machineAt(sys, ip);
    if (tgt) M2.listeners(tgt).forEach(function (l) { if (l.sock.proto === proto) set[l.sock.port] = 1; });
    var h = HOSTS[ip]; if (h && proto === "tcp") (h.ports || []).forEach(function (p) { set[p] = 1; });
    var peer = W.SEGS.srv.peers[ip]; if (peer && peer.ports && proto === "tcp") peer.ports.forEach(function (p) { set[p] = 1; });
    var oh = W.OFFICE.hosts[ip]; if (oh && oh.ports && proto === "tcp") oh.ports.forEach(function (p) { set[p] = 1; });
    var fl = (home.nw && home.nw.filtered) || {}; Object.keys(fl).forEach(function (k) { var x = k.split(":"); if (x[0] === ip) set[x[1]] = 1; });
    return Object.keys(set).map(Number);
  }
  function tcpState(sys, ip, port) {
    var tc = N.tcpOpen(sys, ip, port);
    if (tc.ok) return { st: "open", tc: tc };
    if (tc.err === "refused") return { st: "closed", tc: tc };
    return { st: "filtered", tc: tc };
  }
  function udpState(sys, ip, port) {
    var home = homeOf(sys) || sys, v = verdictFor(sys, ip, port, "udp");
    if (v && v.err === "timeout") return "open|filtered";
    if (v && v.err === "refused") return "closed";
    var tgt = v && v.target ? v.target : (isWeb(home, ip) || /^127\./.test(ip) ? sys : machineAt(sys, ip));
    if (tgt) { var l = M2.listeners(tgt).filter(function (x) { return x.sock.proto === "udp" && x.sock.port === port && (x.sock.addr === "0.0.0.0" || x.sock.addr === "*" || x.sock.addr === "[::]" || x.sock.addr === (v && v.tip) || /^127\./.test(ip) && /^127\./.test(x.sock.addr) || !isRemote(sys) && x.sock.addr === ip); })[0]; if (!l) return "closed"; return /^(snmpd|named|systemd-resolve|chronyd|ntpd)$/.test(l.proc.comm || "") ? (l.proc.comm === "snmpd" && !tgt.snmpPublic ? "open|filtered" : "open") : "open|filtered"; }
    var hs = N.HOSTSVC(home, ip);
    if (hs) { var sv = hs[port]; return sv && sv.udp ? (/^(snmp|ntp|domain|dns)$/.test(sv.name) ? "open" : "open|filtered") : "closed"; }
    if (port === 53 && W.RESOLVERS.indexOf(ip) >= 0) return "open";
    return "closed";
  }
  function hostUp(sys, t, o) {
    if (o.Pn) return { up: true, lat: 0.0004 };
    var r = N.reach(sys, t.ip, { quiet: true });
    if (!r.ok) {
      if (!t.sweep) { var s443 = tcpState(sys, t.ip, 443), s80 = tcpState(sys, t.ip, 80); if (s443.st !== "filtered" || s80.st !== "filtered") return { up: true, lat: 0.0009 }; }
      return { up: false };
    }
    return { up: true, lat: (r.rtt || 0.4) / 1000, r: r };
  }
  function macLine(sys, ip) {
    if (isRemote(sys) || N.isOwn(sys.nw, ip)) return null;
    var p = (sys.nw.extraPeers.srv || {})[ip] || W.SEGS.srv.peers[ip];
    var mac = p ? p.mac : ({ "10.20.0.40": "52:54:00:40:aa:01", "10.20.0.45": "52:54:00:45:d1:3c", "10.20.0.60": "52:54:00:60:b2:7f", "10.20.0.70": "52:54:00:70:1e:44", "10.20.0.80": "52:54:00:80:c3:29" })[ip];
    return mac ? "MAC Address: " + mac.toUpperCase() + " (QEMU virtual NIC)" : null;
  }
  function svcFor(sys, ip, port, proto, tc) {
    var home = homeOf(sys) || sys, hs = N.HOSTSVC(home, ip), sv = hs && hs[port];
    var name = sv ? sv.name.replace(/\s*\(.*\)$/, "") : null, ver = "";
    if (tc && tc.proc) { var c = tc.proc.comm || ""; name = NAME_OF_PROC[c] || name; ver = VERSION_OF_PROC[c] || ""; if (c === "nginx" && port === 443) name = "ssl/http"; if (c === "dockerd" && port === 2375) name = "docker"; }
    else if (sv) ver = versionOfSvc(sv, port);
    if (!name) name = (proto === "udp" && port === 161 ? "snmp" : SVCNAME[port]) || "unknown";
    if (sv && sv.tls && name !== "ssl/http") name = /http|docker|kubernetes|kubelet/.test(sv.name) ? "ssl/" + sv.name.replace(/^docker-s$/, "docker") : sv.name === "ldaps" ? "ssl/ldap" : name;
    return { name: name, ver: ver };
  }
  function tlsProtocolsAt(sys, ip, port, sni) {
    var out2 = [];
    ["TLSv1", "TLSv1.1", "TLSv1.2", "TLSv1.3"].forEach(function (v) { var t = N.tlsConnect(sys, ip, port, sni, { only: v, seclevel0: true }); if (t.ok) out2.push(v); });
    return out2;
  }
  var CIPHERS = { "TLSv1": ["TLS_ECDHE_RSA_WITH_AES_128_CBC_SHA (secp256r1) - A", "TLS_ECDHE_RSA_WITH_AES_256_CBC_SHA (secp256r1) - A", "TLS_RSA_WITH_AES_128_CBC_SHA (rsa 2048) - A"], "TLSv1.1": ["TLS_ECDHE_RSA_WITH_AES_128_CBC_SHA (secp256r1) - A", "TLS_ECDHE_RSA_WITH_AES_256_CBC_SHA (secp256r1) - A", "TLS_RSA_WITH_AES_128_CBC_SHA (rsa 2048) - A"], "TLSv1.2": ["TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256 (secp256r1) - A", "TLS_ECDHE_RSA_WITH_AES_256_GCM_SHA384 (secp256r1) - A", "TLS_ECDHE_RSA_WITH_CHACHA20_POLY1305_SHA256 (secp256r1) - A"], "TLSv1.3": ["TLS_AKE_WITH_AES_128_GCM_SHA256 (ecdh_x25519) - A", "TLS_AKE_WITH_AES_256_GCM_SHA384 (ecdh_x25519) - A", "TLS_AKE_WITH_CHACHA20_POLY1305_SHA256 (ecdh_x25519) - A"] };
  CMDS.nmap = function (args, io, sess) {
    var sys = sess.sys, a = args.slice(1), o = { targets: [], scan: null }, i;
    for (i = 0; i < a.length; i++) {
      var x = a[i];
      if (x === "-sS" || x === "-sT" || x === "-sU" || x === "-sn" || x === "-sV" || x === "-sC") { if (x === "-sV") o.sV = true; else if (x === "-sC") o.sC = true; else if (x === "-sU") o.sU = true; else if (x === "-sn") o.sn = true; else o.scan = x.slice(2); }
      else if (/^-s[STUV]{2,}$/.test(x)) { x.slice(2).split("").forEach(function (c) { if (c === "V") o.sV = true; else if (c === "U") o.sU = true; else o.scan = c; }); }
      else if (x === "-p") o.p = a[++i]; else if (/^-p./.test(x)) o.p = x.slice(2);
      else if (x === "--top-ports") o.top = +a[++i]; else if (x === "-F") o.top = 100;
      else if (x === "-Pn") o.Pn = true; else if (x === "-n") o.n = true; else if (x === "-v" || x === "-vv") o.v = true; else if (x === "-6") o.six = true; else if (x === "--open") o.open = true; else if (x === "-A") { o.sV = true; o.sC = true; }
      else if (x === "-oN") o.oN = a[++i]; else if (x === "-oG") o.oG = a[++i]; else if (x === "-oA") { o.oN = a[i + 1] + ".nmap"; o.oG = a[++i] + ".gnmap"; }
      else if (/^-T[0-5]$/.test(x) || x === "--reason" || x === "-r") continue; else if (x === "--max-retries" || x === "--min-rate" || x === "--host-timeout") i++;
      else if (x === "--script") o.script = a[++i]; else if (/^--script=/.test(x)) o.script = x.slice(9);
      else if (x === "-O") { if (sess.uid !== 0) { errl(io, "TCP/IP fingerprinting (for OS scan) requires root privileges.\nQUITTING!"); return 1; } o.O = true; }
      else if (x === "-h" || x === "--help") { out(io, "Nmap 7.94SVN ( https://nmap.org )\nUsage: nmap [Scan Type(s)] [Options] {target specification}\n  -sn: Ping Scan - disable port scan\n  -Pn: Treat all hosts as online -- skip host discovery\n  -sS/sT: TCP SYN/Connect() scans\n  -sU: UDP Scan\n  -p <port ranges>: Only scan specified ports (Ex: -p22; -p1-65535; -p U:53,T:21-25,80)\n  -F: Fast mode - Scan fewer ports than the default scan\n  --top-ports <number>: Scan <number> most common ports\n  -sV: Probe open ports to determine service/version info\n  --script=<Lua scripts>: e.g. ssl-enum-ciphers\n  -oN/-oG <file>: Output scan in normal or grepable format\n  --open: Only show open (or possibly open) ports\n  -n: Never do DNS resolution\n  -6: Enable IPv6 scanning\n"); return 0; }
      else if (/^-/.test(x)) { errl(io, "nmap: unrecognized option '" + x + "'\nSee the output of nmap -h for a summary of options."); return 255; }
      else o.targets.push(x);
    }
    if (!o.targets.length) { errl(io, "WARNING: No targets were specified, so 0 hosts scanned."); out(io, "Starting Nmap 7.94SVN ( https://nmap.org ) at " + M2.ymd(sys.now) + " " + tod(sys.now).slice(0, 5) + " UTC\nNmap done: 0 IP addresses (0 hosts up) scanned in 0.03 seconds\n"); return 0; }
    var root2 = sess.uid === 0;
    if ((o.sU || o.scan === "S") && !root2) { errl(io, "You requested a scan type which requires root privileges.\nQUITTING!"); return 1; }
    var scanType = o.scan || (root2 ? "S" : "T");
    var targets = expandTargets(sys, o.targets, io, o.n); if (!targets) return 1;
    var L = ["Starting Nmap 7.94SVN ( https://nmap.org ) at " + M2.ymd(sys.now) + " " + tod(sys.now).slice(0, 5) + " UTC"], G = ["# Nmap 7.94SVN scan initiated " + new Date(sys.now).toUTCString().replace(/^(\w+), (\d+) (\w+) (\d+) ([\d:]+) GMT$/, "$1 $3 $2 $5 $4") + " as: nmap " + a.join(" ")];
    var upCount = 0, t0 = 0.05;
    var portsT = null, portsU = null;
    if (o.p) { var pp = parsePorts(o.p); portsT = pp.t; portsU = pp.u.length ? pp.u : pp.t; }
    targets.forEach(function (t) {
      var hu = hostUp(sys, t, o);
      if (!hu.up) { if (!t.sweep) L.push("Note: Host seems down. If it is really up, but blocking our ping probes, try -Pn"); t0 += t.sweep ? 0.004 : 2; return; }
      upCount++;
      var label = o.n ? t.ip : t.name ? t.name + " (" + t.ip + ")" : (W.NAMES[t.ip] ? W.NAMES[t.ip] + " (" + t.ip + ")" : t.ip);
      L.push("Nmap scan report for " + label);
      L.push("Host is up (" + (hu.lat || 0.0003).toFixed(hu.lat < 0.001 ? 5 : 4).replace(/^0\.0+(\d)/, function (m0) { return m0; }) + "s latency).");
      if (t.name && W.NAMES[t.ip] && W.NAMES[t.ip] !== t.name && !o.n) L.push("rDNS record for " + t.ip + ": " + W.NAMES[t.ip]);
      var mac = root2 ? macLine(sys, t.ip) : null;
      if (o.sn) { if (mac) L.push(mac); G.push("Host: " + t.ip + " (" + (W.NAMES[t.ip] || "") + ")\tStatus: Up"); return; }
      var protos = o.sU ? (o.scan || o.p && /T:/.test(o.p) ? ["tcp", "udp"] : ["udp"]) : ["tcp"];
      var rows = [], counts = {}, gports = [];
      protos.forEach(function (proto) {
        var list;
        var spec = proto === "udp" ? portsU : portsT;
        var inter = interesting(sys, t.ip, proto);
        if (spec) { list = []; spec.forEach(function (rg) { if (rg[1] - rg[0] > 2000) { inter.forEach(function (p) { if (p >= rg[0] && p <= rg[1] && list.indexOf(p) < 0) list.push(p); }); } else for (var q = rg[0]; q <= rg[1]; q++) list.push(q); }); var total = spec.reduce(function (s, rg) { return s + rg[1] - rg[0] + 1; }, 0); list.total = total; }
        else { var n = o.top || 1000, base2 = (proto === "udp" ? TOP_UDP : TOP).slice(0, Math.min(n, 1000)); list = base2.filter(function (p, k) { return base2.indexOf(p) === k; }); list.total = n; }
        var shown = 0;
        list.forEach(function (port) {
          var st, tc = null;
          if (proto === "tcp") { var s2 = tcpState(sys, t.ip, port); st = s2.st; tc = s2.tc; } else st = udpState(sys, t.ip, port);
          if (st === "closed" || (st === "filtered" && proto === "tcp" && !(o.p && list.length <= 30))) { counts[proto + st] = (counts[proto + st] || 0) + 1; return; }
          if (o.open && !/open/.test(st)) { counts[proto + st] = (counts[proto + st] || 0) + 1; return; }
          shown++;
          var sv = svcFor(sys, t.ip, port, proto, tc);
          rows.push({ port: port, proto: proto, st: st, name: sv.name + (st === "open" || !o.sV ? "" : ""), ver: o.sV && st === "open" ? sv.ver : "", tc: tc });
          gports.push(port + "/" + st + "/" + proto + "//" + sv.name + "//" + (o.sV ? sv.ver : "") + "/");
        });
        // ports not probed one by one behave like a port nothing listens on
        var hidden = list.total - list.length; if (hidden > 0) { var hs0 = proto === "tcp" ? tcpState(sys, t.ip, 64999).st : udpState(sys, t.ip, 64999); counts[proto + hs0] = (counts[proto + hs0] || 0) + hidden; }
        void shown;
      });
      var notShown = [];
      ["tcp", "udp"].forEach(function (pr) {
        var f = counts[pr + "filtered"] || 0, c = counts[pr + "closed"] || 0, of = counts[pr + "open|filtered"] || 0;
        var parts = [];
        if (f >= c && f) parts.push(f + " filtered " + pr + " ports (no-response)");
        if (c) parts.push(c + " closed " + pr + " ports (" + (pr === "udp" ? "port-unreach" : scanType === "S" ? "reset" : "conn-refused") + ")");
        if (f && f < c) parts.push(f + " filtered " + pr + " ports (no-response)");
        if (of) parts.push(of + " open|filtered " + pr + " ports (no-response)");
        if (parts.length) notShown.push(parts.join(", "));
      });
      if (!rows.length) { L.push("All " + Object.keys(counts).reduce(function (s, k) { return s + counts[k]; }, 0) + " scanned ports on " + label + " are in ignored states."); if (notShown.length) L.push("Not shown: " + notShown.join(", ")); }
      else {
        if (notShown.length) L.push("Not shown: " + notShown.join(", "));
        rows.sort(function (x, y) { return x.proto === y.proto ? x.port - y.port : x.proto < y.proto ? -1 : 1; });
        var w1 = Math.max(8, Math.max.apply(null, rows.map(function (r) { return (r.port + "/" + r.proto).length + 1; }))), w2 = Math.max(5, Math.max.apply(null, rows.map(function (r) { return r.st.length; }))) + 1, w3 = Math.max(7, Math.max.apply(null, rows.map(function (r) { return r.name.length; }))) + 1;
        L.push(rpad("PORT", w1) + " " + rpad("STATE", w2) + (o.sV ? rpad("SERVICE", w3) + " VERSION" : "SERVICE"));
        rows.forEach(function (r) {
          L.push(rpad(r.port + "/" + r.proto, w1) + " " + rpad(r.st, w2) + (o.sV ? rpad(r.name, w3) + " " + r.ver : r.name).replace(/\s+$/, ""));
          if (o.script && /ssl-enum-ciphers/.test(o.script) && r.st === "open" && /ssl|https/.test(r.name)) {
            var vs = tlsProtocolsAt(sys, t.ip, r.port, t.name && !isV4(t.name) ? t.name : null);
            if (vs.length) { L.push("| ssl-enum-ciphers: "); vs.forEach(function (v) { L.push("|   " + v.replace("TLSv1", "TLSv1").replace(/^TLSv1$/, "TLSv1.0") + ": ", "|     ciphers: "); CIPHERS[v].forEach(function (c) { L.push("|       " + c); }); L.push("|     compressors: ", "|       NULL", "|     cipher preference: " + (v === "TLSv1.3" ? "client" : "server")); if (v === "TLSv1" || v === "TLSv1.1") L.push("|     warnings: ", "|       Deprecated protocol version " + (v === "TLSv1" ? "TLSv1.0" : v)); }); L.push("|_  least strength: A"); }
          }
        });
      }
      if (mac) L.push(mac);
      if (o.sV && rows.some(function (r) { return r.st === "open"; })) L.push("Service Info: OS: Linux; CPE: cpe:/o:linux:linux_kernel");
      G.push("Host: " + t.ip + " (" + (W.NAMES[t.ip] || "") + ")\tPorts: " + gports.join(", ") + "\tIgnored State: closed (" + (counts.tcpclosed || 0) + ")");
      t0 += 0.2 + (counts.tcpfiltered || 0) * 0.002 + (o.sU ? 1.1 : 0) + (o.sV ? 6 : 0);
      L.push("");
    });
    if (o.sV && upCount) L.push("Service detection performed. Please report any incorrect results at https://nmap.org/submit/ .");
    var total = targets.length;
    L.push("Nmap done: " + total + " IP address" + (total === 1 ? "" : "es") + " (" + upCount + " host" + (upCount === 1 ? "" : "s") + " up) scanned in " + t0.toFixed(2) + " seconds");
    out(io, L.join("\n") + "\n");
    if (o.oN) { var we = S.writeFile(sess, o.oN, "# Nmap 7.94SVN scan initiated as: nmap " + a.join(" ") + "\n" + L.slice(1).join("\n") + "\n# Nmap done\n"); if (we) { errl(io, "Failed to open normal output file " + o.oN + " for writing: " + S.ERRTEXT[we]); return 1; } }
    if (o.oG) { var we2 = S.writeFile(sess, o.oG, G.concat(["# Nmap done -- " + total + " IP address (" + upCount + " host up) scanned"]).join("\n") + "\n"); if (we2) { errl(io, "Failed to open greppable output file " + o.oG + " for writing: " + S.ERRTEXT[we2]); return 1; } }
    N.ev(homeOf(sys) || sys, { k: "look", what: "nmap", layer: 4, nowire: true });
    return 0;
  };

  /* ================================================================== WireGuard */
  function b64key(seed) { var c = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/", s = "", h = hash("wg" + seed) >>> 0; for (var i = 0; i < 42; i++) { h = (Math.imul(h, 1103515245) + 12345) >>> 0; s += c.charAt((h >>> 16) % 64); } return s + c.charAt((h >>> 8) % 16 * 4) + "="; }
  function wgPub(priv) { return b64key("pub:" + String(priv).trim()); }
  N.wgPub = wgPub; N.wgKey = b64key;
  function wgConf(sys, name) {
    var t = rd(sys, "/etc/wireguard/" + name + ".conf"); if (t === null) return null;
    var c = { iface: {}, peers: [] }, cur = null;
    lines(t).forEach(function (l) {
      l = l.replace(/#.*/, "").trim(); if (!l) return;
      if (/^\[Interface\]$/i.test(l)) { cur = c.iface; return; }
      if (/^\[Peer\]$/i.test(l)) { cur = {}; c.peers.push(cur); return; }
      var m = /^(\w+)\s*=\s*(.*)$/.exec(l); if (m && cur) cur[m[1].toLowerCase()] = m[2].trim();
    });
    return c;
  }
  N.wgConf = wgConf;
  // the remote side: who the far end is and which keys it accepts (set by the lab)
  function wgSite(sys) { return sys.wgSite || null; }
  CMDS.wg = function (args, io, sess) {
    var sys = sess.sys, a = args.slice(1);
    if (a[0] === "genkey") { sys.wgSeq = (sys.wgSeq || 0) + 1; out(io, b64key("gen" + sys.wgSeq + ":" + sys.cmdIndex) + "\n"); if (!/0[67]7$/.test("")) void 0; return 0; }
    if (a[0] === "pubkey") { var k = String(io.stdin || "").trim(); if (!/^[A-Za-z0-9+/]{42}[AEIMQUYcgkosw048]=$/.test(k)) { errl(io, "Key is not the correct length or format"); return 1; } out(io, wgPub(k) + "\n"); return 0; }
    if (a[0] === "genpsk") { out(io, b64key("psk" + sys.cmdIndex) + "\n"); return 0; }
    if (sess.uid !== 0) { errl(io, "Unable to access interface: Operation not permitted"); return 1; }
    var live = sys.wgLive || {};
    if (!a.length || a[0] === "show") {
      var names = a[1] && a[1] !== "all" && a[1] !== "interfaces" ? [a[1]] : Object.keys(live);
      if (a[1] === "interfaces") { out(io, Object.keys(live).join(" ") + (Object.keys(live).length ? "\n" : "")); return 0; }
      if (a[1] && !live[a[1]] && a[1] !== "all") { errl(io, "Unable to access interface: No such device"); return 1; }
      var L = [];
      names.forEach(function (n, k) {
        var w = live[n]; if (k) L.push("");
        L.push("interface: " + n, "  public key: " + w.pub, "  private key: (hidden)", "  listening port: " + (w.port || 51820));
        w.peers.forEach(function (p) {
          L.push("", "peer: " + p.publickey);
          if (p.endpoint) L.push("  endpoint: " + p.endpoint);
          L.push("  allowed ips: " + (p.allowed || []).join(", "));
          if (p.hs) L.push("  latest handshake: " + Math.max(1, Math.round((sys.now - p.hs) / 1000) + 3) + " seconds ago", "  transfer: " + (p.rx / 1024).toFixed(2) + " KiB received, " + (p.tx / 1024).toFixed(2) + " KiB sent");
          if (p.persistentkeepalive) L.push("  persistent keepalive: every " + p.persistentkeepalive + " seconds");
        });
      });
      out(io, joinLines(L));
      return 0;
    }
    errl(io, "Invalid subcommand: `" + a[0] + "'\nUsage: wg <cmd> [<args>]\n\nAvailable subcommands:\n  show: Shows the current configuration and device information\n  genkey: Generates a new private key and writes it to stdout\n  genpsk: Generates a new preshared key and writes it to stdout\n  pubkey: Reads a private key from stdin and writes a public key to stdout"); return 1;
  };
  CMDS["wg-quick"] = function (args, io, sess) {
    var sys = sess.sys, nw = sys.nw, verb = args[1], name = args[2];
    if (!/^(up|down|save|strip)$/.test(verb || "") || !name) { errl(io, "Usage: wg-quick [ up | down | save | strip ] [ CONFIG_FILE | INTERFACE ]"); return 1; }
    if (sess.uid !== 0) { errl(io, "wg-quick must be run as root. Please enter the password for " + sess.user + " to continue: "); return 1; }
    name = name.replace(/^.*\//, "").replace(/\.conf$/, "");
    var path = "/etc/wireguard/" + name + ".conf", node = M2.nodeAt(sys, path);
    sys.wgLive = sys.wgLive || {};
    if (verb === "down") {
      if (!sys.wgLive[name]) { errl(io, "wg-quick: `" + name + "' is not a WireGuard interface"); return 1; }
      errl(io, "[#] ip link delete dev " + name);
      delete sys.wgLive[name]; delete nw.ifs[name];
      nw.routes = nw.routes.filter(function (r) { return r.dev !== name; });
      return 0;
    }
    if (verb === "strip") { out(io, (rd(sys, path) || "").replace(/^\s*(Address|DNS|MTU|Table|PreUp|PostUp|PreDown|PostDown|SaveConfig)\s*=.*\n/gim, "")); return 0; }
    if (!node) { errl(io, "wg-quick: `" + path + "' does not exist"); return 1; }
    if (sys.wgLive[name]) { errl(io, "wg-quick: `" + name + "' already exists"); return 1; }
    if (node.mode & 7) errl(io, "Warning: `" + path + "' is world accessible");
    var c = wgConf(sys, name);
    if (!c.iface.privatekey || !/^[A-Za-z0-9+/]{42}[AEIMQUYcgkosw048]=$/.test(c.iface.privatekey)) { errl(io, "[#] ip link add " + name + " type wireguard\n[#] wg setconf " + name + " /dev/fd/63\nKey is not the correct length or format: `" + (c.iface.privatekey || "") + "'\nConfiguration parsing error\n[#] ip link delete dev " + name); return 1; }
    var bad = c.peers.filter(function (p) { return !/^[A-Za-z0-9+/]{42}[AEIMQUYcgkosw048]=$/.test(p.publickey || ""); })[0];
    if (bad) { errl(io, "[#] ip link add " + name + " type wireguard\n[#] wg setconf " + name + " /dev/fd/63\nKey is not the correct length or format: `" + (bad.publickey || "") + "'\nConfiguration parsing error\n[#] ip link delete dev " + name); return 1; }
    var addrs = (c.iface.address || "").split(",").map(function (x) { return x.trim(); }).filter(Boolean);
    if (!addrs.length) note(io, "(No Address = in [Interface]: the tunnel comes up with no IP address, so nothing can use it.)");
    var L = ["[#] ip link add " + name + " type wireguard", "[#] wg setconf " + name + " /dev/fd/63"];
    var d = { name: name, idx: 10 + Object.keys(sys.wgLive).length, kind: "wg", mac: "", admin: true, cable: true, carrier: true, mtu: +(c.iface.mtu || 1420), addrs: [], addrs6: [], managed: false, stats: { rxB: 0, rxP: 0, rxE: 0, rxD: 0, txB: 0, txP: 0, txE: 0, coll: 0, crc: 0 } };
    addrs.forEach(function (x) { var pc = N.parseCidr(x); if (pc && isV4(pc.ip)) { d.addrs.push({ ip: pc.ip, prefix: pc.prefix, wg: true }); L.push("[#] ip -4 address add " + x + " dev " + name); } });
    L.push("[#] ip link set mtu " + d.mtu + " up dev " + name);
    nw.ifs[name] = d;
    var peers = c.peers.map(function (p) { return { publickey: p.publickey, endpoint: p.endpoint || null, allowed: (p.allowedips || "").split(",").map(function (x) { return x.trim(); }).filter(Boolean), persistentkeepalive: p.persistentkeepalive || null, hs: 0, rx: 0, tx: 0 }; });
    var all = [];
    peers.forEach(function (p) { p.allowed.forEach(function (x) { if (all.indexOf(x) < 0) all.push(x); }); });
    var full = all.some(function (x) { return /\/0$/.test(x) && isV4(x.split("/")[0]); });
    all.sort(function (x, y) { return (+y.split("/")[1] || 0) - (+x.split("/")[1] || 0); }).forEach(function (x) {
      var pc = N.parseCidr(x); if (!pc || !isV4(pc.ip)) return;
      if (pc.prefix === 0) return;
      var onSelf = d.addrs.some(function (aa) { return String(N.netOf(aa.ip, aa.prefix)) === String(N.netOf(pc.ip, pc.prefix)) && +aa.prefix === +pc.prefix; });
      if (onSelf) return;   // the address itself already gives a connected route
      L.push("[#] ip -4 route add " + x + " dev " + name);
      nw.routes.push({ dst: N.netOf(pc.ip, pc.prefix), prefix: pc.prefix, via: null, dev: name, proto: onSelf ? "kernel" : "static", scope: "link", metric: 0, wg: true, src: d.addrs[0] ? d.addrs[0].ip : undefined });
    });
    if (full) {
      L.push("[#] wg set " + name + " fwmark 51820", "[#] ip -4 route add 0.0.0.0/0 dev " + name + " table 51820", "[#] ip -4 rule add not fwmark 51820 table 51820", "[#] ip -4 rule add table main suppress_prefixlength 0", "[#] sysctl -q net.ipv4.conf.all.src_valid_mark=1", "[#] nft -f /dev/fd/63");
      nw.routes.push({ dst: "0.0.0.0", prefix: 1, via: null, dev: name, proto: "static", metric: 0, wg: true }, { dst: "128.0.0.0", prefix: 1, via: null, dev: name, proto: "static", metric: 0, wg: true });
    }
    errl(io, L.join("\n"));
    sys.wgLive[name] = { pub: wgPub(c.iface.privatekey), priv: c.iface.privatekey, port: c.iface.listenport, peers: peers };
    N.ev(sys, { k: "link", what: "wg-quick up " + name, layer: 3, nowire: true });
    return 0;
  };
  // traffic routed into a WireGuard interface: it gets through if the far end knows our key and we know its key,
  // the endpoint is reachable, and the far end routes the address back to us (its AllowedIPs for our peer)
  N.wgReach = function (sys, dst, rt, d, o) {
    var w = (sys.wgLive || {})[d.name], site = wgSite(sys), res = { dev: d.name, src: rt.src || (d.addrs[0] || {}).ip, path: ["you"], hops: [], loss: 0, routeMtu: d.mtu };
    if (!w) return Object.assign(res, { ok: false, err: "timeout", fail: "you" });
    var peer = w.peers.filter(function (p) { return p.allowed.some(function (x) { var pc = N.parseCidr(x); return pc && isV4(pc.ip) && N.inNet(dst, pc.ip, pc.prefix); }); })[0];
    if (!peer) return Object.assign(res, { ok: false, err: "nokey", fail: "you" });
    if (!site || peer.publickey !== site.pub) return Object.assign(res, { ok: false, err: "timeout", fail: "you", wg: "no handshake (peer's public key isn't the far end's)" });
    if (!peer.endpoint) return Object.assign(res, { ok: false, err: "timeout", fail: "you", wg: "no endpoint" });
    var ep = /^([^:]+):(\d+)$/.exec(peer.endpoint), epIp = ep ? (isV4(ep[1]) ? ep[1] : (N.getaddrinfo(sys, ep[1], 4) || {}).ip) : null;
    if (!ep || epIp !== site.endpoint || +ep[2] !== site.port) return Object.assign(res, { ok: false, err: "timeout", fail: "you", wg: "wrong endpoint" });
    if (site.accepts.indexOf(w.pub) < 0) return Object.assign(res, { ok: false, err: "timeout", fail: "you", wg: "the far end doesn't know our key" });
    var src = (d.addrs[0] || {}).ip;
    if (!src || !N.inNet(src, site.tunnelNet, site.tunnelPrefix)) return Object.assign(res, { ok: false, err: "timeout", fail: "you", wg: "our tunnel address isn't one the far end routes to us" });
    var er = N.reach(sys, epIp, { quiet: true });
    if (!er.ok) return Object.assign(res, { ok: false, err: "timeout", fail: "inet" });
    if (!o || !o.quiet) { peer.hs = sys.now; peer.rx += 148 + 92; peer.tx += 148 + 92; }
    var host = site.hosts[dst];
    if (!host && dst !== site.gw) return Object.assign(res, { ok: false, err: "hostunreach", fail: "vpn", from: site.gw });
    var rtt = (er.rtt || 10) + (host ? host.rtt : 0.3);
    return Object.assign(res, { ok: true, rtt: rtt, ttl: host ? 63 : 64, path: ["you", "inet", "vpn"], hops: [{ ip: site.gw, rtt: er.rtt + 0.2 }].concat(host ? [{ ip: dst, rtt: rtt }] : []), node: "vpn", wg: true });
  };

  /* ================================================================== services whose listening address comes from their config */
  function confLines(sys, p) { return lines(rd(sys, p) || "").map(function (l) { return l.replace(/#.*/, "").trim(); }).filter(Boolean); }
  function sock(proto, a, port) { a = String(a); return { proto: proto, addr: a === "*" || a === "0.0.0.0" ? "0.0.0.0" : a === "::" || a === "::*" || a === "[::]" ? "[::]" : /:/.test(a) && !/^\[/.test(a) ? "[" + a + "]" : a, port: port }; }
  M2.shapes["redis-server"] = function (sys) {
    var bind = ["127.0.0.1", "::1"], port = 6379;
    confLines(sys, "/etc/redis/redis.conf").forEach(function (l) { var m = /^bind\s+(.*)$/.exec(l); if (m) bind = m[1].split(/\s+/).map(function (x) { return x.replace(/^-/, ""); }); var p = /^port\s+(\d+)/.exec(l); if (p) port = +p[1]; });
    return [{ cmd: "/usr/bin/redis-server " + (bind[0] === "0.0.0.0" || bind[0] === "*" ? "*" : bind[0]) + ":" + port, comm: "redis-server", uid: S.uidOf(sys, "redis"), main: true, listen: bind.map(function (a) { return sock("tcp", a, port); }) }];
  };
  M2.shapes.memcached = function (sys) {
    var addr = "127.0.0.1", port = 11211;
    confLines(sys, "/etc/memcached.conf").forEach(function (l) { var m = /^-l\s+(\S+)/.exec(l); if (m) addr = m[1]; var p = /^-p\s+(\d+)/.exec(l); if (p) port = +p[1]; });
    return [{ cmd: "/usr/bin/memcached -m 64 -p " + port + " -u memcache -l " + addr + " -P /var/run/memcached/memcached.pid", comm: "memcached", uid: S.uidOf(sys, "memcache"), main: true, listen: addr.split(",").map(function (a) { return sock("tcp", a, port); }) }];
  };
  M2.shapes.dockerd = function (sys, u, cmd) {
    var hosts = [], dj = rd(sys, "/etc/docker/daemon.json");
    (cmd.match(/-H\s+(\S+)/g) || []).forEach(function (h) { hosts.push(h.replace(/^-H\s+/, "")); });
    if (dj) { try { (JSON.parse(dj).hosts || []).forEach(function (h) { hosts.push(h); }); } catch (e) { /* docker would refuse to start; keep it simple */ } }
    var listen = hosts.map(function (h) { var m = /^tcp:\/\/([^:]*):(\d+)$/.exec(h); return m ? sock("tcp", m[1] || "0.0.0.0", +m[2]) : null; }).filter(Boolean);
    return [{ cmd: cmd.replace(/\s+$/, ""), comm: "dockerd", uid: 0, main: true, listen: listen }];
  };
  M2.shapes.snmpd = function (sys) {
    var L2 = confLines(sys, "/etc/snmp/snmpd.conf"), listen = [];
    L2.forEach(function (l) { var m = /^agentaddress\s+(.*)$/i.exec(l); if (!m) return; m[1].split(",").forEach(function (x) { var mm = /^udp:(?:([\d.]+):)?(\d+)$/.exec(x.trim()); if (mm) listen.push(sock("udp", mm[1] || "0.0.0.0", +mm[2])); }); });
    if (!L2.some(function (l) { return /^agentaddress/i.test(l); })) listen.push(sock("udp", "127.0.0.1", 161));
    sys.snmpPublic = L2.some(function (l) { return /^rocommunity6?\s+public(\s+default|\s*$)/.test(l); });
    return [{ cmd: "/usr/sbin/snmpd -LOw -u Debian-snmp -g Debian-snmp -I -smux mteTrigger mteTriggerConf -f -p /run/snmpd.pid", comm: "snmpd", uid: S.uidOf(sys, "Debian-snmp"), main: true, listen: listen }];
  };
  M2.shapes["inetutils-inetd"] = function (sys) {
    var listen = [];
    confLines(sys, "/etc/inetd.conf").forEach(function (l) { var f = l.split(/\s+/); var p = { telnet: 23, ftp: 21, shell: 514, login: 513, exec: 512, finger: 79 }[f[0]]; if (p && f[1] === "stream") listen.push(sock("tcp", "0.0.0.0", p)); });
    return [{ cmd: "/usr/sbin/inetutils-inetd", comm: "inetutils-inetd", uid: 0, main: true, listen: listen }];
  };
  M2.shapes.mysqld = function (sys) {
    var addr = "127.0.0.1";
    confLines(sys, "/etc/mysql/mysql.conf.d/mysqld.cnf").forEach(function (l) { var m = /^bind-address\s*=\s*(\S+)/.exec(l); if (m) addr = m[1]; });
    return [{ cmd: "/usr/sbin/mysqld", comm: "mysqld", uid: S.uidOf(sys, "mysql"), main: true, listen: [sock("tcp", addr, 3306), sock("tcp", "127.0.0.1", 33060)] }];
  };
  M2.shapes.postgres = function (sys) {
    var addr = "localhost";
    confLines(sys, "/etc/postgresql/16/main/postgresql.conf").forEach(function (l) { var m = /^listen_addresses\s*=\s*'([^']*)'/.exec(l); if (m) addr = m[1]; });
    var listen = addr === "*" ? [sock("tcp", "0.0.0.0", 5432), sock("tcp", "[::]", 5432)] : addr.split(",").map(function (x) { x = x.trim(); return sock("tcp", x === "localhost" ? "127.0.0.1" : x, 5432); });
    return [{ cmd: "/usr/lib/postgresql/16/bin/postgres -D /var/lib/postgresql/16/main -c config_file=/etc/postgresql/16/main/postgresql.conf", comm: "postgres", uid: S.uidOf(sys, "postgres"), main: true, listen: listen }];
  };
  var RISKY = {
    postgres: { unit: "postgresql@16-main.service", exe: "/usr/lib/postgresql/16/bin/postgres", start: "/usr/lib/postgresql/16/bin/postgres -D /var/lib/postgresql/16/main -c config_file=/etc/postgresql/16/main/postgresql.conf", user: ["postgres", 114, "/var/lib/postgresql"], conf: ["/etc/postgresql/16/main/postgresql.conf", "# PostgreSQL configuration file (excerpt)\ndata_directory = '/var/lib/postgresql/16/main'\nlisten_addresses = '*'\nport = 5432\nmax_connections = 100\nssl = on\n"], desc: "PostgreSQL Cluster 16-main" },
    redis: { unit: "redis-server.service", exe: "/usr/bin/redis-server", start: "/usr/bin/redis-server /etc/redis/redis.conf --supervised systemd --daemonize no", user: ["redis", 114, "/var/lib/redis"], conf: ["/etc/redis/redis.conf", "# Redis configuration file (excerpt)\n# By default Redis listens on localhost only. Someone changed that.\nbind 0.0.0.0\nprotected-mode no\nport 6379\ndaemonize yes\nsupervised systemd\ndir /var/lib/redis\n# requirepass foobared\n"], desc: "Advanced key-value store" },
    memcached: { unit: "memcached.service", exe: "/usr/bin/memcached", start: "/usr/share/memcached/scripts/systemd-memcached-wrapper /etc/memcached.conf", shapeExe: "/usr/bin/memcached", user: ["memcache", 115, "/nonexistent"], conf: ["/etc/memcached.conf", "# memcached default config file\n-d\nlogfile /var/log/memcached.log\n-m 64\n-p 11211\n-u memcache\n# Listen on all interfaces (the default is -l 127.0.0.1)\n-l 0.0.0.0\n-P /var/run/memcached/memcached.pid\n"], desc: "memcached daemon" },
    docker: { unit: "docker.service", exe: "/usr/bin/dockerd", start: "/usr/bin/dockerd -H fd:// --containerd=/run/containerd/containerd.sock", conf: ["/etc/docker/daemon.json", "{\n  \"hosts\": [\"unix:///var/run/docker.sock\", \"tcp://0.0.0.0:2375\"],\n  \"log-driver\": \"journald\"\n}\n"], desc: "Docker Application Container Engine" },
    snmp: { unit: "snmpd.service", exe: "/usr/sbin/snmpd", start: "/usr/sbin/snmpd -LOw -u Debian-snmp -g Debian-snmp -I -smux,mteTrigger,mteTriggerConf -f -p /run/snmpd.pid", user: ["Debian-snmp", 116, "/var/lib/snmp"], conf: ["/etc/snmp/snmpd.conf", "# snmpd.conf (excerpt)\n# Listen for connections on all interfaces\nagentaddress udp:161\n# Full read access for anyone who knows the community string\nrocommunity public default\nsysLocation    Rack 4, Kestrel DC\nsysContact     ops@kestrel.example.com\n"], desc: "Simple Network Management Protocol (SNMP) Daemon." },
    telnet: { unit: "inetutils-inetd.service", exe: "/usr/sbin/inetutils-inetd", start: "/usr/sbin/inetutils-inetd", conf: ["/etc/inetd.conf", "# /etc/inetd.conf:  see inetd(8) for further informations.\n#\n# <service_name> <sock_type> <proto> <flags> <user> <server_path> <args>\n#:STANDARD: These are standard services.\ntelnet\tstream\ttcp\tnowait\troot\t/usr/sbin/tcpd\t/usr/sbin/telnetd\n"], desc: "internet superserver" },
    mysql: { unit: "mysql.service", exe: "/usr/sbin/mysqld", start: "/usr/sbin/mysqld", user: ["mysql", 117, "/nonexistent"], conf: ["/etc/mysql/mysql.conf.d/mysqld.cnf", "[mysqld]\nuser\t\t= mysql\n# Instead of skip-networking the default is now to listen only on\n# localhost which is more compatible and is not less secure.\nbind-address\t\t= 0.0.0.0\nmysqlx-bind-address\t= 127.0.0.1\nkey_buffer_size\t\t= 16M\nmax_binlog_size   = 100M\n"], desc: "MySQL Community Server" }
  };
  // install and start some of the risky services on a machine (as a lab sets it up)
  N.riskyServices = function (sys, names, since) {
    names.forEach(function (n) {
      var r = RISKY[n];
      if (r.user && !S.userByName(sys, r.user[0])) { M2.writeRoot(sys, "/etc/passwd", r.user[0] + ":x:" + r.user[1] + ":" + (r.user[1] + 10) + "::" + r.user[2] + ":/usr/sbin/nologin\n", true); M2.writeRoot(sys, "/etc/group", r.user[0] + ":x:" + (r.user[1] + 10) + ":\n", true); }
      putRoot(sys, r.exe, "\x7fELF:" + r.exe.replace(/^.*\//, "") + " (simulated binary)\n", 493, 0, 0, Date.UTC(2024, 3, 8));
      var dir = r.conf[0].replace(/\/[^/]*$/, ""); S.mkdirs(sys, dir, 493, 0, 0);
      putRoot(sys, r.conf[0], r.conf[1], 420, 0, 0, NOW - 90 * DAY);
      var start = r.shapeExe ? r.shapeExe + " -c /etc/memcached.conf" : r.start;
      putRoot(sys, "/usr/lib/systemd/system/" + r.unit, "[Unit]\nDescription=" + r.desc + "\nAfter=network.target\n\n[Service]\nType=simple\nExecStart=" + start + "\nRestart=on-failure\n\n[Install]\nWantedBy=multi-user.target\n", 420, 0, 0, Date.UTC(2024, 3, 8));
      S.mkdirs(sys, "/etc/systemd/system/multi-user.target.wants").children[r.unit] = S.linkNode("/usr/lib/systemd/system/" + r.unit);
      M2.unitUp(sys, r.unit, since || NOW - 40 * DAY);
    });
  };
  N.RISKY = RISKY;

  /* ================================================================== packages, service files */
  function PK(name, ver, o) { return Object.assign({ name: name, ver: ver, arch: "amd64", section: "net", size: 120, desc: "", deps: [], bins: [], sbins: [], installed: false, auto: false, archive: "noble" }, o || {}); }
  M2.CATALOG.push(
    PK("nmap", "7.94+git20230807.3be01efb1+dfsg-3build2", { size: 4400, desc: "The Network Mapper", bins: ["nmap"] }),
    PK("wireguard-tools", "1.0.20210914-1ubuntu4", { size: 300, desc: "fast, modern, secure kernel VPN tunnel (userland utilities)", bins: ["wg", "wg-quick"] }),
    PK("nftables", "1.0.9-1build1", { installed: true, size: 180, desc: "Program to control packet filtering rules by Netfilter project", sbins: ["nft"] })
  );
  var NFT_UNIT = "[Unit]\nDescription=nftables\nDocumentation=man:nft(8) http://wiki.nftables.org\nWants=network-pre.target\nBefore=network-pre.target shutdown.target\nConflicts=shutdown.target\nDefaultDependencies=no\n\n[Service]\nType=oneshot\nRemainAfterExit=yes\nStandardInput=null\nProtectSystem=full\nProtectHome=true\nExecStart=/usr/sbin/nft -f /etc/nftables.conf\nExecReload=/usr/sbin/nft -f /etc/nftables.conf\nExecStop=/usr/sbin/nft flush ruleset\n\n[Install]\nWantedBy=sysinit.target\n";
  var NFT_DEFAULT = "#!/usr/sbin/nft -f\n\nflush ruleset\n\ntable inet filter {\n\tchain input {\n\t\ttype filter hook input priority filter;\n\t}\n\tchain forward {\n\t\ttype filter hook forward priority filter;\n\t}\n\tchain output {\n\t\ttype filter hook output priority filter;\n\t}\n}\n";
  // the office and internet machines live on their own networks
  S.POST_HOOKS.push(function (sys) {
    var nw = sys.nw; if (!nw || !sys.vantage || sys.vantage === "lan") return;
    var d = nw.ifs.eth0;
    d.addrs = [{ ip: sys.ip, prefix: sys.vantage === "internet" ? 26 : 24, scope: "global" }];
    d.addrs6 = []; nw.noV6 = true;
    nw.routes = [{ dst: "0.0.0.0", prefix: 0, via: GW_OF[sys.vantage], dev: "eth0", proto: "static", metric: 0 }];
    nw.linkDns.eth0 = sys.vantage === "internet" ? { servers: ["1.1.1.1", "8.8.8.8"], search: [] } : { servers: ["10.20.0.2"], search: ["kestrel.internal"] };
  });
  S.SYS_HOOKS.push(function (sys) {
    putRoot(sys, "/usr/lib/systemd/system/nftables.service", NFT_UNIT, 420, 0, 0, Date.UTC(2024, 3, 8));
    putRoot(sys, "/etc/nftables.conf", NFT_DEFAULT, 493, 0, 0, Date.UTC(2024, 3, 8));
    S.mkdirs(sys, "/etc/wireguard", 448, 0, 0);
  });
})(typeof window !== "undefined" ? window : globalThis);
