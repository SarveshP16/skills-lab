/* sudo learn — the Networking lab runner. Labs run on kc-web-01 (the Linux track's server) on the simulated network
   from net-core.js. The runner is ShLab's; this file adds the network status the diagram shows (NetLab.status) and
   helpers for checks (NetLab.H). */
(function (root) {
  "use strict";
  var S = root.ShEngine, SL = root.ShLab, N = root.NetCore, M2 = S.M2;

  /* ---------------- what the diagram shows: every node's status, worked out quietly from the machine */
  var NODES = {
    you: { label: "kc-web-01", kind: "server" },
    sw: { label: "sw-core-01", kind: "switch", ip: "switch" },
    gw: { label: "kc-gw-01", kind: "router", ip: "10.20.0.1" },
    dns: { label: "kc-dns-01", kind: "server", ip: "10.20.0.2" },
    db: { label: "kc-db-01", kind: "server", ip: "10.20.0.21" },
    backup: { label: "kc-backup-01", kind: "server", ip: "10.20.0.31" },
    lb: { label: "kc-lb-01", kind: "server", ip: "10.20.0.10" },
    vpn: { label: "kc-vpn-01", kind: "router", ip: "10.20.0.254" },
    partner: { label: "partner API", kind: "cloud", ip: "172.16.50.10" },
    mon: { label: "kc-mon-01", kind: "server", ip: "10.20.5.10" },
    stor: { label: "backup storage", kind: "server", ip: "10.20.30.31" },
    legacy: { label: "kc-legacy-01", kind: "server", ip: "10.20.0.40" },
    data: { label: "kc-data-01", kind: "server", ip: "10.20.0.45" },
    build: { label: "kc-build-01", kind: "server", ip: "10.20.0.60" },
    inet: { label: "internet", kind: "cloud", ip: "1.1.1.1" },
    site: { label: "kestrel.example.com", kind: "site", ip: "https" }
  };
  function nicState(sys) {
    var nw = sys.nw, best = null;
    N.ifList(nw).forEach(function (d) {
      if (d.kind !== "ether") return;
      var l = N.linkOf(nw, d), s;
      if (!d.admin) s = { st: "bad", why: d.name + " is down (ip link set " + d.name + " up)", layer: 2 };
      else if (!l.carrier) s = { st: "bad", why: d.name + ": NO-CARRIER (no link)", layer: 1 };
      else if (!d.addrs.length) s = { st: "bad", why: d.name + " has a link but no IPv4 address", layer: 3 };
      else if (l.mismatch) s = { st: "warn", why: d.name + ": " + l.speed + " Mb/s " + l.duplex + " duplex, errors (duplex mismatch)", layer: 1 };
      else s = { st: "ok", why: d.name + " " + d.addrs[0].ip + "/" + d.addrs[0].prefix + ", " + l.speed + " Mb/s " + l.duplex, layer: 1 };
      s.dev = d.name;
      var rank = { ok: 3, warn: 2, bad: 1 };
      if (!best || rank[s.st] > rank[best.st] || (rank[s.st] === rank[best.st] && d.addrs.length > (nw.ifs[best.dev].addrs.length))) best = s;
    });
    return best || { st: "bad", why: "no network card", layer: 1 };
  }
  function ipState(sys, ip) {
    var r = N.reach(sys, ip, { quiet: true });
    if (r.ok) return r.loss > 0 ? { st: "warn", why: (r.dup ? "two machines answer for " + ip + " (duplicate IP)" : Math.round(r.loss * 100) + "% packet loss"), r: r } : { st: "ok", why: ip + " answers in " + N.fmtMs(r.rtt) + " ms", r: r };
    var why = r.err === "netunreach" ? "no route to " + ip : r.err === "hostunreach" ? (r.nic ? "no link" : "no ARP answer from " + (r.arpFail || ip)) : "no answer from " + ip;
    return { st: "bad", why: why, r: r };
  }
  function dnsState(sys) {
    var ns = ipState(sys, "10.20.0.2");
    var g = N.askServer(sys, "127.0.0.53", "kestrel.example.com", "A", { quiet: true });
    if (!g.err && g.status === "NOERROR" && g.answers.length) return { st: "ok", why: "names resolve (via " + (g.via || g.server) + ")" };
    if (ns.st === "bad") return { st: "bad", why: "can't reach the DNS server: " + ns.why };
    return { st: "bad", why: g.noUpstream ? "no DNS server configured" : "lookups fail (" + (g.status || g.err) + "): check the DNS servers in netplan" };
  }
  function siteState(sys) {
    var g = N.getaddrinfo(sys, "kestrel.example.com", 4);
    if (g.err) return { st: "bad", why: "the name doesn't resolve", layer: 7 };
    var tc = N.tcpOpen(sys, g.ip, 443);
    if (tc.err) return { st: "bad", why: "can't connect to " + g.ip + ":443 (" + tc.err + ")", layer: tc.err === "refused" ? 4 : 3 };
    var t = N.tlsConnect(sys, g.ip, 443, "kestrel.example.com");
    if (t.err) return { st: "bad", why: "no TLS on port 443", layer: 6 };
    var v = N.verifyChain(sys, t.chain);
    if (v.code) return { st: "bad", why: "certificate: " + v.text, layer: 6 };
    if (!N.nameMatch(t.chain[0], "kestrel.example.com")) return { st: "bad", why: "certificate is for another name", layer: 6 };
    var res = N.httpTo(sys, g.ip, 443, { scheme: "https", host: "kestrel.example.com", port: 443, path: "/api/health", method: "GET", headers: { host: "kestrel.example.com", "user-agent": "kestrel-monitor/2.1", accept: "*/*" } });
    if (res.err) return { st: "bad", why: "no HTTP answer", layer: 7 };
    if (res.status !== 200) return { st: "bad", why: "/api/health answers " + res.status, layer: 7 };
    return { st: "ok", why: "https://kestrel.example.com/api/health → 200", layer: 7 };
  }
  function status(sys, want) {
    var res = {};
    (want || Object.keys(NODES)).forEach(function (id) {
      var base = NODES[id], s;
      try {
        if (id === "you") s = nicState(sys);
        else if (id === "sw") { var n = nicState(sys); s = n.st === "bad" && n.layer === 1 ? { st: "bad", why: "no link to the switch" } : { st: n.st === "warn" ? "warn" : "ok", why: n.st === "warn" ? n.why : "port 14 up" }; }
        else if (id === "dns") s = dnsState(sys);
        else if (id === "site") s = siteState(sys);
        else s = ipState(sys, base.ip);
      } catch (e) { s = { st: "unknown", why: String(e && e.message || e) }; }
      res[id] = Object.assign({ id: id, label: base.label, kind: base.kind, ip: id === "you" ? ((sys.nw.ifs[(s && s.dev) || "eth0"] || { addrs: [] }).addrs[0] || {}).ip || "no IP" : base.ip }, s);
    });
    return res;
  }

  /* ---------------- check helpers */
  function ran(r, re, fn) { return r.history.some(function (e) { return re.test(e.cmd) && (!fn || fn(e)); }); }
  function outHas(e, re) { return e.out.concat(e.err).some(function (l) { return re.test(l); }); }
  function stdoutHas(e, re) { return e.out.some(function (l) { return re.test(l); }); }
  function rootish(e) { return /^\s*sudo\b/.test(e.cmd) || e.userBefore === "root"; }
  function idx(r, re, fn) { var k = -1; r.history.forEach(function (e, i) { if (re.test(e.cmd) && (!fn || fn(e))) k = i; }); return k; }
  function reachOk(r, ip) { var x = N.reach(r.sys, ip, { quiet: true }); return x.ok && !(x.loss > 0); }
  // A "find X" answer must come from a command: the same command must print the right thing on another machine.
  function proves(r, wantFn, alt, filter, msgNone, msgAlt) {
    var p = SL.H.proves(r, wantFn, alt, { filter: filter, norm: true });
    if (p.ok) return true;
    return p.reason === "alt" ? msgAlt : msgNone;
  }
  // Did some command print a line containing each of the given strings (in this run and in the alt run)?
  function printedIn(r, wantFn, alt, filter, msgNone, msgAlt) {
    function find(ctx) {
      var w = wantFn(ctx);
      for (var i = ctx.history.length - 1; i >= 0; i--) { var e = ctx.history[i]; if (filter && !filter(e)) continue; var all = e.out.join("\n"); if (w.every(function (s) { return all.indexOf(s) >= 0; })) return i; }
      return -1;
    }
    var i = find(r);
    if (i < 0) return msgNone;
    if (!alt) return true;
    var r2 = r.run(null, alt), w2 = wantFn(r2), e2 = r2.history[i];
    return e2 && w2.every(function (s) { return e2.out.join("\n").indexOf(s) >= 0; }) ? true : msgAlt;
  }
  var H = { ran: ran, outHas: outHas, stdoutHas: stdoutHas, rootish: rootish, idx: idx, reachOk: reachOk, proves: proves, printedIn: printedIn, status: status, site: siteState, nic: nicState };

  var runner = {
    ready: false,
    start: function (hooks) { this.ready = true; hooks.setStatus("ok", "kc-web-01 · Ubuntu 24.04 · console (simulated)"); hooks.enableRun(); },
    call: function (msg) { return new Promise(function (res) { setTimeout(function () { res(SL.handle(msg)); }, 0); }); }
  };
  root.NetLab = { runner: runner, status: status, NODES: NODES, H: H };
})(typeof window !== "undefined" ? window : globalThis);
