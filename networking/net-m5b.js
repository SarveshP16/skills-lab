/* sudo learn — Networking Module 5, part 2: Docker networking (bridges, published ports that skip ufw, the
   DOCKER-USER chain), a private CA with OpenSSL and nginx asking for client certificates (mTLS), an egress proxy
   (Squid) with curl -x, ModSecurity with the OWASP Core Rule Set, a CDN in front of the origin, and network rules
   as code (Terraform and Checkov). */
(function (root) {
  "use strict";
  var S = root.ShEngine, U = S.util, CMDS = S.CMDS, M2 = S.M2, M3 = S.M3, N = M2.NET, W = N.W;
  var out = U.out, errl = U.errl, note = U.note, pad = U.pad;
  var rd = M2.rd, putRoot = M2.putRoot, hash = M2.hash, NOW = S.NOW, DAY = S.DAY;
  var isV4 = N.isV4, ME = "10.20.0.15";
  function b64(s) { return typeof btoa === "function" ? btoa(s) : Buffer.from(s, "binary").toString("base64"); }
  function unb64(s) { return typeof atob === "function" ? atob(s) : Buffer.from(s, "base64").toString("binary"); }
  function wrap64(s) { return s.replace(/(.{64})/g, "$1\n").replace(/\n$/, ""); }
  function rp(s, n) { s = String(s); return s.length >= n ? s : s + " ".repeat(n - s.length); }
  function readAs(sess, p) { var r = S.readFile(sess, p); return r.error ? null : r.content; }
  function writeAs(sess, p, text) { return S.writeFile(sess, p, text, false); }
  function isRoot(sess) { return sess.uid === 0; }

  /* ================================================================== Docker */
  var IMAGES = {
    "redis:7": { cmd: "\"docker-entrypoint.s…\"", port: 6379, app: "redis", id: "sha256:" + M2.hexOf("img-redis", 64), size: "117MB", repo: "redis", tag: "7" },
    "postgres:16": { cmd: "\"docker-entrypoint.s…\"", port: 5432, app: "postgres", id: "sha256:" + M2.hexOf("img-pg", 64), size: "432MB", repo: "postgres", tag: "16" },
    "nginx:1.27": { cmd: "\"/docker-entrypoint.…\"", port: 80, app: "nginx", id: "sha256:" + M2.hexOf("img-nginx", 64), size: "192MB", repo: "nginx", tag: "1.27" },
    "kestrel/orders-api:2.3": { cmd: "\"gunicorn -b 0.0.0.…\"", port: 8000, app: "orders", id: "sha256:" + M2.hexOf("img-orders", 64), size: "164MB", repo: "kestrel/orders-api", tag: "2.3" },
    "busybox:1.36": { cmd: "\"sh\"", port: null, app: "busybox", id: "sha256:" + M2.hexOf("img-bb", 64), size: "4.26MB", repo: "busybox", tag: "1.36" }
  };
  function imgKey(n) { n = String(n || ""); if (IMAGES[n]) return n; if (n === "busybox" || n === "busybox:latest") return "busybox:1.36"; if (n === "redis" || n === "redis:latest") return "redis:7"; if (n === "nginx" || n === "nginx:latest") return "nginx:1.27"; return null; }
  function dock(sys) {
    if (!sys.docker) sys.docker = { nets: [], ctrs: [], user: [{ target: "RETURN" }], seq: 0 };
    var d = sys.docker;
    if (!d.nets.length) { d.nets.push({ name: "bridge", id: M2.hexOf("net-bridge", 64), driver: "bridge", subnet: "172.17.0.0/16", gw: "172.17.0.1", next: 2, dflt: true }, { name: "host", id: M2.hexOf("net-host", 64), driver: "host", subnet: null }, { name: "none", id: M2.hexOf("net-none", 64), driver: "null", subnet: null }); }
    return d;
  }
  function netByName(d, n) { return d.nets.filter(function (x) { return x.name === n || x.id.indexOf(n) === 0; })[0]; }
  function ctrByName(d, n) { n = String(n || "").replace(/^\//, ""); return d.ctrs.filter(function (c) { return c.name === n || (n.length >= 3 && c.id.indexOf(n) === 0); })[0]; }
  function ipIn(net) { var base = net.subnet.split("/")[0].split("."); var ip = base[0] + "." + base[1] + "." + Math.floor(net.next / 256) + "." + (net.next % 256); net.next++; return ip; }
  function proxyProcs(sys, c) {
    c.ports.forEach(function (p) {
      [p.hostIp].concat(p.hostIp === "0.0.0.0" ? ["[::]"] : []).forEach(function (hip) {
        M2.spawn(sys, { cmd: "/usr/bin/docker-proxy -proto " + p.proto + " -host-ip " + hip.replace(/[[\]]/g, "") + " -host-port " + p.hostPort + " -container-ip " + c.nets[0].ip + " -container-port " + p.ctrPort, comm: "docker-proxy", uid: 0, ppid: 1, dockerCtr: c.name, listen: [{ proto: p.proto, addr: hip, port: p.hostPort }] });
      });
    });
  }
  function killProxies(sys, c) { sys.procs.filter(function (p) { return p.dockerCtr === c.name; }).forEach(function (p) { M2.removeProc(sys, p); }); }
  function addCtr(sys, o) {
    var d = dock(sys), img = IMAGES[o.image], net = netByName(d, o.net || "bridge");
    var c = { id: M2.hexOf("ctr" + o.name + d.seq++ + (sys.cmdIndex || 0), 64), name: o.name, image: o.image, cmd: img.cmd, created: o.created || sys.now, started: o.created || sys.now, status: "running", env: o.env || {}, ports: o.ports || [], nets: [], restart: o.restart || "no" };
    c.nets.push({ name: net.name, ip: ipIn(net), aliases: [] });
    d.ctrs.push(c); proxyProcs(sys, c);
    return c;
  }
  function parsePort(spec) {
    var proto = "tcp", s = String(spec); var pm = /\/(tcp|udp)$/.exec(s); if (pm) { proto = pm[1]; s = s.slice(0, -pm[0].length); }
    var parts = s.split(":");
    if (parts.length === 3) return { hostIp: parts[0] || "0.0.0.0", hostPort: +parts[1], ctrPort: +parts[2], proto: proto };
    if (parts.length === 2) return { hostIp: "0.0.0.0", hostPort: +parts[0], ctrPort: +parts[1], proto: proto };
    return { hostIp: "0.0.0.0", hostPort: 32768 + (hash(s) >>> 0) % 1000, ctrPort: +parts[0], proto: proto };
  }
  function ago(ms) { var s = Math.max(1, Math.round(ms / 1000)); if (s < 60) return s === 1 ? "1 second" : s + " seconds"; var m = Math.round(s / 60); if (m < 60) return m === 1 ? "About a minute" : m + " minutes"; var h = Math.round(m / 60); if (h < 48) return h === 1 ? "About an hour" : h + " hours"; return Math.round(h / 24) + " days"; }
  function portsCol(c) {
    if (c.status !== "running") return "";
    var img = IMAGES[c.image], parts = [];
    c.ports.forEach(function (p) { parts.push((p.hostIp === "0.0.0.0" ? "0.0.0.0" : p.hostIp) + ":" + p.hostPort + "->" + p.ctrPort + "/" + p.proto); if (p.hostIp === "0.0.0.0") parts.push(":::" + p.hostPort + "->" + p.ctrPort + "/" + p.proto); });
    if (img.port && !c.ports.some(function (p) { return p.ctrPort === img.port; })) parts.unshift(img.port + "/tcp");
    return parts.join(", ");
  }
  function tabw(rows) { var w = []; rows.forEach(function (r) { r.forEach(function (x, i) { w[i] = Math.max(w[i] || 0, String(x).length); }); }); return rows.map(function (r) { return r.map(function (x, i) { return i === r.length - 1 ? String(x) : rp(x, w[i] + 3); }).join("").replace(/\s+$/, ""); }).join("\n"); }
  function goTemplate(tpl, obj) {
    function path(o, p) { if (p === "." || p === "") return o; return p.replace(/^\./, "").split(".").reduce(function (a, k) { return a == null ? null : a[k]; }, o); }
    function show(v) { if (v == null) return "<no value>"; if (Array.isArray(v)) return "[" + v.map(show).join(" ") + "]"; if (typeof v === "object") return "map[" + Object.keys(v).sort().map(function (k) { return k + ":" + show(v[k]); }).join(" ") + "]"; return String(v); }
    function run(t, o) {
      var res = "", re = /\{\{\s*(range\s+[^}]+|end|json\s+[^}]+|[^}]+?)\s*\}\}/g, m, last = 0;
      while ((m = re.exec(t))) {
        res += t.slice(last, m.index); last = re.lastIndex;
        var e = m[1];
        if (/^range\s+/.test(e)) {
          var depth = 1, re2 = /\{\{\s*(range\s+[^}]+|end)\s*\}\}/g, m2; re2.lastIndex = last;
          while ((m2 = re2.exec(t))) { if (/^range/.test(m2[1])) depth++; else if (--depth === 0) break; }
          var body = t.slice(last, m2 ? m2.index : t.length), coll = path(o, e.replace(/^range\s+/, "").trim());
          (Array.isArray(coll) ? coll : coll && typeof coll === "object" ? Object.keys(coll).sort().map(function (k) { return coll[k]; }) : []).forEach(function (it) { res += run(body, it); });
          last = m2 ? re2.lastIndex : t.length; re.lastIndex = last; continue;
        }
        if (/^json\s+/.test(e)) { res += JSON.stringify(path(o, e.replace(/^json\s+/, "").trim())); continue; }
        res += show(path(o, e));
      }
      return res + t.slice(last);
    }
    return run(tpl, obj);
  }
  function inspectCtr(d, c) {
    var portsMap = {}, img = IMAGES[c.image];
    if (img.port) portsMap[img.port + "/tcp"] = null;
    c.ports.forEach(function (p) { var k = p.ctrPort + "/" + p.proto; portsMap[k] = (portsMap[k] || []).concat([{ HostIp: p.hostIp, HostPort: String(p.hostPort) }]).concat(p.hostIp === "0.0.0.0" ? [{ HostIp: "::", HostPort: String(p.hostPort) }] : []); });
    var nets = {}; c.nets.forEach(function (n) { var net = netByName(d, n.name); nets[n.name] = { IPAMConfig: null, Links: null, Aliases: net.dflt ? null : [c.name, c.id.slice(0, 12)].concat(n.aliases), NetworkID: net.id, EndpointID: M2.hexOf("ep" + c.id + n.name, 64), Gateway: net.gw, IPAddress: n.ip, IPPrefixLen: 16, MacAddress: "02:42:" + n.ip.split(".").slice(0, 4).map(function (x) { return ("0" + (+x).toString(16)).slice(-2); }).join(":"), DNSNames: net.dflt ? null : [c.name, c.id.slice(0, 12)] }; });
    var dfl = c.nets.filter(function (n) { return n.name === "bridge"; })[0];
    return { Id: c.id, Created: new Date(c.created).toISOString(), Path: "docker-entrypoint.sh", State: { Status: c.status, Running: c.status === "running", Paused: false, Restarting: false, OOMKilled: false, Dead: false, Pid: c.status === "running" ? 4000 + (hash(c.id) >>> 0) % 3000 : 0, ExitCode: c.status === "running" ? 0 : 137, StartedAt: new Date(c.started).toISOString() }, Image: img.id, Name: "/" + c.name,
      HostConfig: { NetworkMode: c.nets[0].name, PortBindings: c.ports.reduce(function (a, p) { a[p.ctrPort + "/" + p.proto] = [{ HostIp: p.hostIp === "0.0.0.0" ? "" : p.hostIp, HostPort: String(p.hostPort) }]; return a; }, {}), RestartPolicy: { Name: c.restart, MaximumRetryCount: 0 } },
      Config: { Hostname: c.id.slice(0, 12), Env: Object.keys(c.env).map(function (k) { return k + "=" + c.env[k]; }).concat(["PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"]), Image: c.image, ExposedPorts: img.port ? (function () { var e = {}; e[img.port + "/tcp"] = {}; return e; })() : {} },
      NetworkSettings: { Ports: portsMap, IPAddress: dfl ? dfl.ip : "", Gateway: dfl ? "172.17.0.1" : "", Networks: nets } };
  }
  function dockerErr(io, msg, code) { errl(io, msg); return code == null ? 1 : code; }
  // where a name resolves from inside a container: user-defined networks have DNS for container names; the default bridge doesn't
  function ctrResolve(sys, c, name) {
    var d = dock(sys);
    if (isV4(name)) return name;
    if (name === "localhost") return "127.0.0.1";
    var hit = null;
    c.nets.forEach(function (n) { var net = netByName(d, n.name); if (net.dflt || hit) return; d.ctrs.forEach(function (o) { if (o.status !== "running") return; var on = o.nets.filter(function (x) { return x.name === n.name; })[0]; if (on && (o.name === name || on.aliases.indexOf(name) >= 0 || o.id.indexOf(name) === 0)) hit = on.ip; }); });
    if (hit) return hit;
    if (/\./.test(name)) { var g = N.getaddrinfo(sys, name, 4); if (!g.err) return g.ip; }
    return null;
  }
  // can container c open ip:port? "open" | "refused" | "timeout"
  function ctrConnect(sys, c, ip, port) {
    var d = dock(sys);
    if (ip === "127.0.0.1") { var me = IMAGES[c.image]; return me.port === port ? "open" : "refused"; }
    var t = null, tn = null;
    d.ctrs.forEach(function (o) { o.nets.forEach(function (n) { if (n.ip === ip) { t = o; tn = n; } }); });
    if (t) {
      if (!c.nets.some(function (n) { return n.name === tn.name; })) return "timeout";
      if (t.status !== "running") return "timeout";
      return IMAGES[t.image].port === port ? "open" : "refused";
    }
    if (/^172\.(1[7-9]|2\d)\./.test(ip) && /\.1$/.test(ip)) return M2.listeners(sys).some(function (l) { return l.sock.port === port && l.sock.proto === "tcp" && !/^127\./.test(l.sock.addr); }) ? "open" : "refused";
    var tc = N.tcpOpen(sys, ip, port);
    return tc.ok ? "open" : tc.err === "refused" ? "refused" : "timeout";
  }
  function redisOk(sys, c) {
    var host = c.env.REDIS_HOST || "localhost", ip = ctrResolve(sys, c, host);
    if (!ip) return { ok: false, why: "Error -3 connecting to " + host + ":6379. Temporary failure in name resolution." };
    var r = ctrConnect(sys, c, ip, 6379);
    if (r !== "open") return { ok: false, why: "Error " + (r === "refused" ? "111 connecting to " + host + ":6379. Connection refused." : "110 connecting to " + host + ":6379. Connection timed out.") };
    return { ok: true };
  }
  // the app inside a container, reached through docker-proxy
  M2.appHandlers = M2.appHandlers || [];
  M2.appHandlers.push(function (sys, proc, req) {
    if (proc.comm !== "docker-proxy" || !sys.docker) return null;
    var c = ctrByName(sys.docker, proc.dockerCtr); if (!c) return { closed: true };
    return ctrHttp(sys, c, req);
  });
  function ctrHttp(sys, c, req) {
    var img = IMAGES[c.image], p = req.path.split("?")[0];
    if (img.app === "orders") {
      var h = { "Content-Type": "application/json", Server: "gunicorn" };
      if (p === "/health") { var ro = redisOk(sys, c); return ro.ok ? { status: 200, headers: h, body: "{\"status\":\"ok\",\"redis\":\"connected\"}\n" } : { status: 503, headers: h, body: JSON.stringify({ status: "degraded", redis: ro.why }) + "\n" }; }
      if (p === "/orders") return { status: 200, headers: h, body: "[{\"id\":7731,\"status\":\"shipped\"},{\"id\":7732,\"status\":\"pending\"}]\n" };
      return { status: 404, headers: h, body: "{\"error\":\"not found\"}\n" };
    }
    if (img.app === "nginx") return { status: 200, headers: { "Content-Type": "text/html", Server: "nginx/1.27.2" }, body: "<!DOCTYPE html>\n<html>\n<head>\n<title>Welcome to nginx!</title>\n</head>\n<body>\n<h1>Welcome to nginx!</h1>\n</body>\n</html>\n" };
    return { proto: true };
  }
  // commands inside a container (busybox-style tools)
  function ctrExec(sys, c, argv, io) {
    var cmd = argv[0];
    if (cmd === "sh" && argv[1] === "-c" && argv[2]) return ctrExec(sys, c, argv[2].match(/'[^']*'|"[^"]*"|\S+/g).map(function (x) { return x.replace(/^['"]|['"]$/g, ""); }), io);
    var me = c.nets[0];
    if (cmd === "hostname") { out(io, (argv[1] === "-i" ? c.nets.map(function (n) { return n.ip; }).join(" ") : c.id.slice(0, 12)) + "\n"); return 0; }
    if (cmd === "cat" && argv[1] === "/etc/hosts") { out(io, "127.0.0.1\tlocalhost\n::1\tlocalhost ip6-localhost ip6-loopback\n" + c.nets.map(function (n) { return n.ip + "\t" + c.id.slice(0, 12); }).join("\n") + "\n"); return 0; }
    if (cmd === "cat" && argv[1] === "/etc/resolv.conf") { var udn = c.nets.some(function (n) { return !netByName(dock(sys), n.name).dflt; }); out(io, udn ? "# Generated by Docker Engine.\nnameserver 127.0.0.11\nsearch kestrel.internal\noptions edns0 trust-ad ndots:0\n" : "# Generated by Docker Engine.\nnameserver 10.20.0.2\nsearch kestrel.internal\n"); return 0; }
    if (cmd === "env") { out(io, "PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin\nHOSTNAME=" + c.id.slice(0, 12) + "\n" + Object.keys(c.env).map(function (k) { return k + "=" + c.env[k] + "\n"; }).join("") + "HOME=/root\n"); return 0; }
    if (cmd === "ip" && /^a(ddr)?$/.test(argv[1] || "")) { out(io, "1: lo: <LOOPBACK,UP,LOWER_UP> mtu 65536 qdisc noqueue state UNKNOWN qlen 1000\n    inet 127.0.0.1/8 scope host lo\n" + c.nets.map(function (n, k) { return (k + 2) + ": eth" + k + "@if" + (20 + k) + ": <BROADCAST,MULTICAST,UP,LOWER_UP,M-DOWN> mtu 1500 qdisc noqueue state UP\n    inet " + n.ip + "/16 brd " + n.ip.replace(/\.\d+\.\d+$/, ".255.255") + " scope global eth" + k + "\n"; }).join("")); return 0; }
    if (cmd === "getent" || cmd === "nslookup") {
      var nm = cmd === "getent" ? argv[2] : argv[1], ip0 = nm && ctrResolve(sys, c, nm);
      if (cmd === "getent") { if (!ip0) return 2; out(io, ip0 + "\t" + nm + "\n"); return 0; }
      var udn2 = c.nets.some(function (n) { return !netByName(dock(sys), n.name).dflt; }), srv = udn2 ? "127.0.0.11" : "10.20.0.2";
      if (!ip0) { out(io, "Server:\t\t" + srv + "\nAddress:\t" + srv + ":53\n\n"); errl(io, "** server can't find " + nm + ": NXDOMAIN"); return 1; }
      out(io, "Server:\t\t" + srv + "\nAddress:\t" + srv + ":53\n\nNon-authoritative answer:\nName:\t" + nm + "\nAddress: " + ip0 + "\n"); return 0;
    }
    if (cmd === "ping") {
      var host = argv.filter(function (x, i) { return !/^-/.test(x) && !/^-[cW]$/.test(argv[i - 1] || "") && i > 0; })[0], ip = ctrResolve(sys, c, host || "");
      if (!ip) { errl(io, "ping: bad address '" + host + "'"); return 1; }
      var n = +(argv[argv.indexOf("-c") + 1] || 1) || 1, reach = ctrConnect(sys, c, ip, IMAGES[c.image].port || 1) !== "timeout" || ip === me.gw;
      var L = ["PING " + host + " (" + ip + "): 56 data bytes"];
      for (var k = 0; k < n; k++) if (reach) L.push("64 bytes from " + ip + ": seq=" + k + " ttl=64 time=0.0" + (80 + k * 7) + " ms");
      L.push("", "--- " + host + " ping statistics ---", n + " packets transmitted, " + (reach ? n : 0) + " packets received, " + (reach ? 0 : 100) + "% packet loss");
      if (reach) L.push("round-trip min/avg/max = 0.080/0.090/0.101 ms");
      out(io, L.join("\n") + "\n"); return reach ? 0 : 1;
    }
    if (cmd === "nc") {
      var a = argv.slice(1).filter(function (x, i, arr) { return !/^-/.test(x) && !/^-w$/.test(arr[i - 1] || ""); }), h = a[0], port = +a[1], ip2 = ctrResolve(sys, c, h || "");
      if (!ip2) { errl(io, "nc: bad address '" + h + "'"); return 1; }
      var st = ctrConnect(sys, c, ip2, port);
      if (st === "open") { errl(io, h + " (" + ip2 + ":" + port + ") open"); return 0; }
      errl(io, "nc: " + h + " (" + ip2 + ":" + port + "): " + (st === "refused" ? "Connection refused" : "Operation timed out")); return 1;
    }
    if (cmd === "redis-cli") {
      var hi = argv.indexOf("-h"), rh = hi >= 0 ? argv[hi + 1] : "127.0.0.1", rip = ctrResolve(sys, c, rh);
      if (!rip) { errl(io, "Could not connect to Redis at " + rh + ":6379: Name or service not known"); return 1; }
      var rs = ctrConnect(sys, c, rip, 6379); if (rs !== "open") { errl(io, "Could not connect to Redis at " + rh + ":6379: " + (rs === "refused" ? "Connection refused" : "Connection timed out")); return 1; }
      out(io, "PONG\n"); return 0;
    }
    if (cmd === "wget" || cmd === "curl") {
      var url = argv.filter(function (x) { return /^https?:\/\//.test(x) || /^[\w.-]+:\d+/.test(x); })[0] || "";
      var pu = M2.parseUrl(url); if (!pu) { errl(io, "wget: bad address ''"); return 1; }
      var wip = ctrResolve(sys, c, pu.host);
      if (!wip) { errl(io, cmd === "wget" ? "wget: bad address '" + pu.host + "'" : "curl: (6) Could not resolve host: " + pu.host); return cmd === "wget" ? 1 : 6; }
      var ws = ctrConnect(sys, c, wip, pu.port);
      if (ws !== "open") { errl(io, cmd === "wget" ? "wget: can't connect to remote host (" + wip + "): " + (ws === "refused" ? "Connection refused" : "Operation timed out") : "curl: (" + (ws === "refused" ? 7 : 28) + ") Failed to connect to " + pu.host + " port " + pu.port); return 1; }
      var t = null; dock(sys).ctrs.forEach(function (o) { o.nets.forEach(function (n) { if (n.ip === wip) t = o; }); });
      var res = t ? ctrHttp(sys, t, { path: pu.path, headers: {}, method: "GET" }) : { status: 200, headers: {}, body: "" };
      if (res.proto) { errl(io, "wget: server returned error: HTTP/0.9"); return 1; }
      if (res.status >= 400 && cmd === "wget") { errl(io, "wget: server returned error: HTTP/1.1 " + res.status); return 8; }
      out(io, res.body); return 0;
    }
    errl(io, "OCI runtime exec failed: exec failed: unable to start container process: exec: \"" + cmd + "\": executable file not found in $PATH: unknown");
    return 126;
  }
  function dockerHelp(io) { out(io, "\nUsage:  docker [OPTIONS] COMMAND\n\nA self-sufficient runtime for containers\n\nCommon Commands:\n  run         Create and run a new container from an image\n  exec        Execute a command in a running container\n  ps          List containers\n  images      List images\n  pull        Download an image from a registry\n\nManagement Commands:\n  network     Manage networks\n\nCommands:\n  inspect     Return low-level information on Docker objects\n  logs        Fetch the logs of a container\n  port        List port mappings or a specific mapping for the container\n  rm          Remove one or more containers\n  start       Start one or more stopped containers\n  stop        Stop one or more running containers\n"); return 0; }
  CMDS.docker = function (args, io, sess) {
    var sys = sess.sys, a = args.slice(1);
    var u = S.userByName(sys, sess.user) || {}, groups = [sess.gid].concat(S.supplementary(sys, sess.user));
    var dg = (rd(sys, "/etc/group") || "").split("\n").filter(function (l) { return /^docker:/.test(l); })[0];
    var dgid = dg ? +dg.split(":")[2] : -1;
    var unit = sys.units && sys.units["docker.service"];
    if (!a.length || a[0] === "--help") return dockerHelp(io);
    if (a[0] === "--version" || a[0] === "-v") { out(io, "Docker version 26.1.3, build 26.1.3-0ubuntu1~24.04.1\n"); return 0; }
    if (sess.uid !== 0 && groups.indexOf(dgid) < 0) return dockerErr(io, "permission denied while trying to connect to the Docker daemon socket at unix:///var/run/docker.sock: Get \"http://%2Fvar%2Frun%2Fdocker.sock/v1.45/containers/json\": dial unix /var/run/docker.sock: connect: permission denied");
    if (!unit || unit.rt.active !== "active") return dockerErr(io, "Cannot connect to the Docker daemon at unix:///var/run/docker.sock. Is the docker daemon running?");
    var d = dock(sys), sub = a[0], rest = a.slice(1);
    if (sub === "container" && /^(ls|list|rm|run|start|stop|inspect|port|exec|logs)$/.test(rest[0] || "")) { sub = rest[0] === "ls" || rest[0] === "list" ? "ps" : rest[0]; rest = rest.slice(1); }
    if (sub === "ps") {
      var all = rest.indexOf("-a") >= 0 || rest.indexOf("--all") >= 0, fi = rest.indexOf("--format"), fmt = fi >= 0 ? rest[fi + 1] : null;
      var list = d.ctrs.filter(function (c) { return all || c.status === "running"; }).slice().reverse();
      if (rest.indexOf("-q") >= 0) { out(io, list.map(function (c) { return c.id.slice(0, 12) + "\n"; }).join("")); return 0; }
      function field(c, k) { return { ID: c.id.slice(0, 12), Names: c.name, Image: c.image, Ports: portsCol(c), Status: c.status === "running" ? "Up " + ago(sys.now - c.started) : "Exited (137) " + ago(sys.now - c.started) + " ago", Networks: c.nets.map(function (n) { return n.name; }).join(","), Command: c.cmd, CreatedAt: new Date(c.created).toISOString(), RunningFor: ago(sys.now - c.created) + " ago" }[k]; }
      if (fmt) {
        var table = /^table\s*/.test(fmt), f2 = fmt.replace(/^table\s*/, "").replace(/\\t/g, "\t");
        var rows = list.map(function (c) { return f2.replace(/\{\{\s*\.(\w+)\s*\}\}/g, function (m0, k) { var v = field(c, k); return v == null ? "<no value>" : v; }); });
        if (table) { var hdr = f2.replace(/\{\{\s*\.(\w+)\s*\}\}/g, function (m0, k) { return { ID: "CONTAINER ID", Names: "NAMES", RunningFor: "CREATED", CreatedAt: "CREATED AT" }[k] || k.toUpperCase(); }); out(io, tabw([hdr].concat(rows).map(function (r) { return r.split("\t"); })) + "\n"); }
        else out(io, rows.join("\n") + (rows.length ? "\n" : ""));
        return 0;
      }
      out(io, tabw([["CONTAINER ID", "IMAGE", "COMMAND", "CREATED", "STATUS", "PORTS", "NAMES"]].concat(list.map(function (c) { return [c.id.slice(0, 12), c.image, c.cmd, ago(sys.now - c.created) + " ago", field(c, "Status"), portsCol(c), c.name]; }))) + "\n");
      return 0;
    }
    if (sub === "images") { out(io, tabw([["REPOSITORY", "TAG", "IMAGE ID", "CREATED", "SIZE"]].concat(Object.keys(IMAGES).filter(function (k) { return (d.pulled || {})[k] || d.ctrs.some(function (c) { return c.image === k; }); }).map(function (k) { var im = IMAGES[k]; return [im.repo, im.tag, im.id.slice(7, 19), "3 weeks ago", im.size]; }))) + "\n"); return 0; }
    if (sub === "pull") { var ik = imgKey(rest[0]); if (!ik) return dockerErr(io, "Error response from daemon: pull access denied for " + rest[0] + ", repository does not exist or may require 'docker login': denied: requested access to the resource is denied"); (d.pulled = d.pulled || {})[ik] = true; out(io, IMAGES[ik].tag + ": Pulling from " + (IMAGES[ik].repo.indexOf("/") < 0 ? "library/" : "") + IMAGES[ik].repo + "\nDigest: sha256:" + M2.hexOf("dig" + ik, 64) + "\nStatus: Image is up to date for " + ik + "\ndocker.io/" + (IMAGES[ik].repo.indexOf("/") < 0 ? "library/" : "") + ik + "\n"); return 0; }
    if (sub === "run" || sub === "create") {
      var o = { env: {}, ports: [], net: "bridge", name: null, rm: false, detach: false }, k = 0, cmdArgs = [];
      for (; k < rest.length; k++) {
        var x = rest[k];
        if (x === "-d" || x === "--detach") o.detach = true; else if (x === "--rm") o.rm = true; else if (/^-(it|ti|i|t)$/.test(x)) o.it = true;
        else if (x === "--name") o.name = rest[++k]; else if (/^--name=/.test(x)) o.name = x.slice(7);
        else if (x === "-p" || x === "--publish") o.ports.push(parsePort(rest[++k])); else if (/^--publish=/.test(x)) o.ports.push(parsePort(x.slice(10)));
        else if (x === "-e" || x === "--env") { var ev = rest[++k], eq = ev.indexOf("="); o.env[ev.slice(0, eq)] = ev.slice(eq + 1); }
        else if (x === "--network" || x === "--net") o.net = rest[++k]; else if (/^--net(work)?=/.test(x)) o.net = x.split("=")[1];
        else if (x === "--restart") o.restart = rest[++k]; else if (x === "-v" || x === "--volume" || x === "--network-alias" || x === "--hostname" || x === "-h") { if (x === "--network-alias") o.alias = rest[k + 1]; k++; }
        else if (/^-/.test(x)) return dockerErr(io, "unknown flag: " + x + "\nSee 'docker run --help'.", 125);
        else { o.image = x; cmdArgs = rest.slice(k + 1); break; }
      }
      if (!o.image) return dockerErr(io, "\"docker run\" requires at least 1 argument.\nSee 'docker run --help'.\n\nUsage:  docker run [OPTIONS] IMAGE [COMMAND] [ARG...]\n\nCreate and run a new container from an image", 1);
      var key = imgKey(o.image);
      if (!key) return dockerErr(io, "Unable to find image '" + o.image + (o.image.indexOf(":") < 0 ? ":latest" : "") + "' locally\ndocker: Error response from daemon: pull access denied for " + o.image.split(":")[0] + ", repository does not exist or may require 'docker login': denied: requested access to the resource is denied.\nSee 'docker run --help'.", 125);
      var net = netByName(d, o.net); if (!net) return dockerErr(io, "docker: Error response from daemon: network " + o.net + " not found.\nSee 'docker run --help'.", 125);
      if (net.driver !== "bridge") return dockerErr(io, "docker: Error response from daemon: this lab only simulates bridge networks.\n", 125);
      if (o.name && ctrByName(d, o.name) && ctrByName(d, o.name).name === o.name) { var ex = ctrByName(d, o.name); return dockerErr(io, "docker: Error response from daemon: Conflict. The container name \"/" + o.name + "\" is already in use by container \"" + ex.id + "\". You have to remove (or rename) that container to be able to reuse that name.\nSee 'docker run --help'.", 125); }
      var nm = o.name || ["eager", "brave", "quiet", "jolly", "nifty"][hash(o.image + sys.cmdIndex) % 5] + "_" + ["turing", "hopper", "lovelace", "ritchie", "torvalds"][(hash(o.image) >>> 3) % 5];
      for (var pi = 0; pi < o.ports.length; pi++) {
        var p = o.ports[pi];
        if (d.ctrs.some(function (c) { return c.status === "running" && c.ports.some(function (q) { return q.hostPort === p.hostPort && q.proto === p.proto && (q.hostIp === p.hostIp || q.hostIp === "0.0.0.0" || p.hostIp === "0.0.0.0"); }); })) return dockerErr(io, "docker: Error response from daemon: driver failed programming external connectivity on endpoint " + nm + " (" + M2.hexOf("ep" + nm, 64) + "): Bind for " + p.hostIp + ":" + p.hostPort + " failed: port is already allocated.", 125);
        var busy = M2.listeners(sys).filter(function (l) { return l.sock.port === p.hostPort && l.sock.proto === p.proto && l.proc.comm !== "docker-proxy" && (l.sock.addr === "0.0.0.0" || l.sock.addr === "*" || p.hostIp === "0.0.0.0" || l.sock.addr === p.hostIp); })[0];
        if (busy) return dockerErr(io, "docker: Error response from daemon: driver failed programming external connectivity on endpoint " + nm + " (" + M2.hexOf("ep" + nm, 64) + "): failed to bind port " + p.hostIp + ":" + p.hostPort + "/" + p.proto + ": Error starting userland proxy: listen " + p.proto + "4 " + p.hostIp + ":" + p.hostPort + ": bind: address already in use.", 125);
      }
      if (cmdArgs.length && IMAGES[key].app === "busybox") {
        var tmp = addCtr(sys, { name: nm, image: key, net: o.net, env: o.env, ports: [] });
        var code = ctrExec(sys, tmp, cmdArgs, io); tmp.status = "exited";
        if (o.rm) d.ctrs.splice(d.ctrs.indexOf(tmp), 1);
        return code;
      }
      var c = addCtr(sys, { name: nm, image: key, net: o.net, env: o.env, ports: o.ports, restart: o.restart });
      if (o.alias) c.nets[0].aliases.push(o.alias);
      if (sub === "create") { c.status = "created"; killProxies(sys, c); }
      out(io, c.id + "\n");
      if (!o.detach && sub === "run") note(io, "(Without -d the container would stay attached to your terminal. The lab started it in the background.)");
      return 0;
    }
    if (sub === "rm" || sub === "stop" || sub === "start" || sub === "restart" || sub === "kill") {
      var force = rest.indexOf("-f") >= 0 || rest.indexOf("--force") >= 0, names = rest.filter(function (x) { return !/^-/.test(x); }), code2 = 0;
      if (!names.length) return dockerErr(io, "\"docker " + sub + "\" requires at least 1 argument.");
      names.forEach(function (n) {
        var c = ctrByName(d, n);
        if (!c) { errl(io, "Error response from daemon: No such container: " + n); code2 = 1; return; }
        if (sub === "rm") { if (c.status === "running" && !force) { errl(io, "Error response from daemon: cannot remove container \"/" + c.name + "\": container is running: stop the container before removing or force remove"); code2 = 1; return; } killProxies(sys, c); d.ctrs.splice(d.ctrs.indexOf(c), 1); out(io, n + "\n"); return; }
        if (sub === "stop" || sub === "kill") { c.status = "exited"; killProxies(sys, c); out(io, n + "\n"); return; }
        if (c.status !== "running") { c.status = "running"; c.started = sys.now; proxyProcs(sys, c); }
        out(io, n + "\n");
      });
      return code2;
    }
    if (sub === "port") { var c3 = ctrByName(d, rest[0]); if (!c3) return dockerErr(io, "Error response from daemon: No such container: " + rest[0]); out(io, c3.ports.map(function (p) { return p.ctrPort + "/" + p.proto + " -> " + p.hostIp + ":" + p.hostPort + "\n" + (p.hostIp === "0.0.0.0" ? p.ctrPort + "/" + p.proto + " -> [::]:" + p.hostPort + "\n" : ""); }).join("")); return 0; }
    if (sub === "logs") { var c4 = ctrByName(d, rest.filter(function (x) { return !/^-/.test(x); })[0]); if (!c4) return dockerErr(io, "Error response from daemon: No such container: " + rest[0]); var app = IMAGES[c4.image].app; if (app === "redis") out(io, "1:C 14 Nov 2026 08:00:01.112 * oO0OoO0OoO0Oo Redis is starting oO0OoO0OoO0Oo\n1:M 14 Nov 2026 08:00:01.115 * Running mode=standalone, port=6379.\n1:M 14 Nov 2026 08:00:01.116 * Ready to accept connections tcp\n"); else if (app === "orders") { var ro = redisOk(sys, c4); out(io, "[2026-11-14 08:00:03 +0000] [1] [INFO] Starting gunicorn 22.0.0\n[2026-11-14 08:00:03 +0000] [1] [INFO] Listening at: http://0.0.0.0:8000 (1)\n" + (ro.ok ? "" : "[2026-11-14 08:00:04 +0000] [7] [ERROR] redis: " + ro.why + "\n")); } return 0; }
    if (sub === "inspect") {
      var fi2 = rest.indexOf("-f") >= 0 ? rest.indexOf("-f") : rest.indexOf("--format"), tpl = fi2 >= 0 ? rest[fi2 + 1] : null;
      var targets = rest.filter(function (x, i) { return !/^-/.test(x) && i !== fi2 + 1; }), res = [], code3 = 0;
      targets.forEach(function (n) { var c = ctrByName(d, n), net = netByName(d, n); if (c) res.push(inspectCtr(d, c)); else if (net) res.push(netShape(d, net)); else { errl(io, "Error: No such object: " + n); code3 = 1; } });
      if (tpl) res.forEach(function (r) { out(io, goTemplate(tpl, r) + "\n"); });
      else out(io, JSON.stringify(res, null, 4) + "\n");
      return code3;
    }
    if (sub === "exec") {
      var k2 = 0; while (k2 < rest.length && /^-/.test(rest[k2])) { if (rest[k2] === "-e" || rest[k2] === "-u" || rest[k2] === "-w") k2++; k2++; }
      var c5 = ctrByName(d, rest[k2]); if (!c5) return dockerErr(io, "Error response from daemon: No such container: " + rest[k2]);
      if (c5.status !== "running") return dockerErr(io, "Error response from daemon: container " + c5.id + " is not running");
      var argv = rest.slice(k2 + 1); if (!argv.length) return dockerErr(io, "\"docker exec\" requires at least 2 arguments.");
      return ctrExec(sys, c5, argv, io);
    }
    if (sub === "network") {
      var op = rest[0], r2 = rest.slice(1);
      if (op === "ls") { out(io, tabw([["NETWORK ID", "NAME", "DRIVER", "SCOPE"]].concat(d.nets.map(function (n) { return [n.id.slice(0, 12), n.name, n.driver, "local"]; }))) + "\n"); return 0; }
      if (op === "create") {
        var nn = r2.filter(function (x, i) { return !/^-/.test(x) && !/^--(subnet|driver|gateway)$|^-d$/.test(r2[i - 1] || ""); })[0], si = r2.indexOf("--subnet");
        if (!nn) return dockerErr(io, "\"docker network create\" requires exactly 1 argument.");
        if (netByName(d, nn) && netByName(d, nn).name === nn) return dockerErr(io, "Error response from daemon: network with name " + nn + " already exists");
        var cnt = d.nets.filter(function (x) { return x.subnet; }).length, subnet = si >= 0 ? r2[si + 1] : "172." + (17 + cnt) + ".0.0/16";
        var nw = { name: nn, id: M2.hexOf("net" + nn + sys.cmdIndex, 64), driver: "bridge", subnet: subnet, gw: subnet.replace(/\.0\/\d+$/, ".1"), next: 2 };
        d.nets.push(nw); out(io, nw.id + "\n"); return 0;
      }
      if (op === "inspect") {
        var nfi = r2.indexOf("-f") >= 0 ? r2.indexOf("-f") : r2.indexOf("--format"), ntpl = nfi >= 0 ? r2[nfi + 1] : null;
        var nnames = r2.filter(function (x, i) { return !/^-/.test(x) && i !== nfi + 1; }), nets = nnames.map(function (n) { return netByName(d, n); });
        var miss = nnames.filter(function (n, i) { return !nets[i]; })[0]; if (miss || !nnames.length) return dockerErr(io, "Error response from daemon: network " + (miss || "") + " not found");
        if (ntpl) nets.forEach(function (n) { out(io, goTemplate(ntpl, netShape(d, n)) + "\n"); }); else out(io, JSON.stringify(nets.map(function (n) { return netShape(d, n); }), null, 4) + "\n");
        return 0;
      }
      if (op === "rm") { var n2 = netByName(d, r2[0]); if (!n2) return dockerErr(io, "Error response from daemon: network " + r2[0] + " not found"); if (n2.dflt || n2.driver !== "bridge") return dockerErr(io, "Error response from daemon: " + n2.name + " is a pre-defined network and cannot be removed"); if (d.ctrs.some(function (c) { return c.nets.some(function (x) { return x.name === n2.name; }); })) return dockerErr(io, "Error response from daemon: error while removing network: network " + n2.name + " id " + n2.id + " has active endpoints"); d.nets.splice(d.nets.indexOf(n2), 1); out(io, r2[0] + "\n"); return 0; }
      if (op === "connect" || op === "disconnect") {
        var n3 = netByName(d, r2[0]), c6 = ctrByName(d, r2[1]);
        if (!n3) return dockerErr(io, "Error response from daemon: network " + r2[0] + " not found"); if (!c6) return dockerErr(io, "Error response from daemon: No such container: " + r2[1]);
        var on = c6.nets.filter(function (x) { return x.name === n3.name; })[0];
        if (op === "connect") { if (on) return dockerErr(io, "Error response from daemon: endpoint with name " + c6.name + " already exists in network " + n3.name); c6.nets.push({ name: n3.name, ip: ipIn(n3), aliases: [] }); return 0; }
        if (!on) return dockerErr(io, "Error response from daemon: container " + c6.id + " is not connected to network " + n3.name);
        if (c6.nets.length === 1) { c6.nets = [{ name: "none", ip: "", aliases: [] }]; return 0; }
        c6.nets.splice(c6.nets.indexOf(on), 1); return 0;
      }
      out(io, "\nUsage:  docker network COMMAND\n\nManage networks\n\nCommands:\n  connect     Connect a container to a network\n  create      Create a network\n  disconnect  Disconnect a container from a network\n  inspect     Display detailed information on one or more networks\n  ls          List networks\n  rm          Remove one or more networks\n"); return 0;
    }
    return dockerErr(io, "docker: '" + sub + "' is not a docker command.\nSee 'docker --help'");
  };
  function netShape(d, n) {
    var cs = {}; d.ctrs.forEach(function (c) { c.nets.forEach(function (x) { if (x.name === n.name && c.status === "running") cs[c.id] = { Name: c.name, EndpointID: M2.hexOf("ep" + c.id + n.name, 64), MacAddress: "02:42:" + x.ip.split(".").map(function (q) { return ("0" + (+q).toString(16)).slice(-2); }).join(":"), IPv4Address: x.ip + "/16", IPv6Address: "" }; }); });
    return { Name: n.name, Id: n.id, Created: "2026-10-20T09:12:44.517338121Z", Scope: "local", Driver: n.driver, EnableIPv6: false, IPAM: { Driver: "default", Options: null, Config: n.subnet ? [{ Subnet: n.subnet, Gateway: n.gw }] : [] }, Internal: false, Attachable: false, Ingress: false, ConfigFrom: { Network: "" }, ConfigOnly: false, Containers: cs, Options: n.dflt ? { "com.docker.network.bridge.default_bridge": "true", "com.docker.network.bridge.enable_icc": "true", "com.docker.network.bridge.enable_ip_masquerade": "true", "com.docker.network.bridge.host_binding_ipv4": "0.0.0.0", "com.docker.network.bridge.name": "docker0" } : {}, Labels: {} };
  }
  // published ports go through DNAT and the FORWARD chain: ufw's INPUT rules never see them. DOCKER-USER does.
  function publishedAt(T, dst, port, proto) {
    var d = T.docker; if (!d) return null;
    var hit = null;
    d.ctrs.forEach(function (c) { if (c.status !== "running" || hit) return; c.ports.forEach(function (p) { if (p.hostPort === port && p.proto === proto && (p.hostIp === "0.0.0.0" || p.hostIp === dst)) hit = { ctr: c, p: p }; }); });
    return hit;
  }
  function ruleMatch(r, pk) {
    function neg(v, b) { return v ? !b : b; }
    if (r.i && !neg(r.ni, r.i === pk.iface || (r.i.slice(-1) === "+" && pk.iface.indexOf(r.i.slice(0, -1)) === 0))) return false;
    if (r.s && !neg(r.ns, N.cloud.inCidr(pk.src, r.s.indexOf("/") < 0 ? r.s + "/32" : r.s))) return false;
    if (r.d && !neg(r.nd, N.cloud.inCidr(pk.dst, r.d.indexOf("/") < 0 ? r.d + "/32" : r.d))) return false;
    if (r.p && r.p !== "all" && r.p !== pk.proto) return false;
    if (r.dport != null && !neg(r.ndport, portIn(pk.port, r.dport))) return false;
    if (r.dports && !r.dports.split(",").some(function (x) { return portIn(pk.port, x); })) return false;
    if (r.origdport != null && !portIn(pk.origPort, r.origdport)) return false;
    if (r.ctstate && r.ctstate.split(",").indexOf("NEW") < 0) return false;
    return true;
  }
  function portIn(p, spec) { var m = /^(\d+)[:-](\d+)$/.exec(String(spec)); return m ? p >= +m[1] && p <= +m[2] : +spec === p; }
  function dockerUserVerdict(T, pk) {
    var rules = dock(T).user;
    for (var i = 0; i < rules.length; i++) {
      var r = rules[i]; if (!ruleMatch(r, pk)) continue;
      r.pkts = (r.pkts || 0) + 1;
      if (r.target === "DROP") return "drop"; if (r.target === "REJECT") return "reject"; if (r.target === "ACCEPT") return "accept"; if (r.target === "RETURN") break;
    }
    return "accept";
  }
  var prevFw = N.fwVerdict;
  N.fwVerdict = function (T, src, port, proto, v6, dst) {
    if (T && T.docker && port != null && proto !== "icmp" && !v6) {
      var hit = publishedAt(T, dst || ME, port, proto);
      if (hit) return dockerUserVerdict(T, { src: src, dst: hit.ctr.nets[0].ip, port: hit.p.ctrPort, origPort: port, proto: proto, iface: "eth0" });
    }
    return prevFw(T, src, port, proto, v6, dst);
  };
  N.docker = { dock: dock, addCtr: addCtr, ctrByName: ctrByName, netByName: netByName, ctrResolve: ctrResolve, ctrConnect: ctrConnect, redisOk: redisOk, publishedAt: publishedAt, IMAGES: IMAGES, userVerdict: dockerUserVerdict };
  // iptables: the DOCKER chains are real here; everything else goes to the read-only view from the Linux track
  function ruleSpec(r) {
    var p = [];
    if (r.s) p.push((r.ns ? "! " : "") + "-s " + (r.s.indexOf("/") < 0 ? r.s + "/32" : r.s));
    if (r.d) p.push((r.nd ? "! " : "") + "-d " + (r.d.indexOf("/") < 0 ? r.d + "/32" : r.d));
    if (r.i) p.push((r.ni ? "! " : "") + "-i " + r.i);
    if (r.p) p.push("-p " + r.p);
    if (r.origdport != null || r.ctstate) p.push("-m conntrack" + (r.ctstate ? " --ctstate " + r.ctstate : "") + (r.origdport != null ? " --ctorigdstport " + r.origdport : ""));
    if (r.dports) p.push("-m multiport --dports " + r.dports);
    if (r.dport != null) p.push("-m " + (r.p || "tcp") + " " + (r.ndport ? "! " : "") + "--dport " + r.dport);
    p.push("-j " + r.target);
    return p.join(" ");
  }
  function ruleRow(r, num) {
    var src = r.s ? (r.ns ? "!" : "") + (r.s.indexOf("/") < 0 ? r.s : r.s) : "0.0.0.0/0", dst = r.d ? (r.nd ? "!" : "") + r.d : "0.0.0.0/0", extra = [];
    if (r.dport != null) extra.push((r.p || "tcp") + " " + (r.ndport ? "!" : "") + "dpt:" + r.dport);
    if (r.dports) extra.push("multiport dports " + r.dports);
    if (r.origdport != null) extra.push("ctorigdstport " + r.origdport);
    if (r.ctstate) extra.push("ctstate " + r.ctstate);
    return (num != null ? rp(num, 5) : "") + rp(r.target, 11) + rp(r.p || "all", 5) + rp("--", 4) + rp(src, 21) + rp(dst, 21) + extra.join(" ");
  }
  function parseRule(w, io) {
    var r = {}, neg = false;
    for (var i = 0; i < w.length; i++) {
      var x = w[i];
      if (x === "!") { neg = true; continue; }
      if (x === "-s" || x === "--source") { r.s = w[++i]; r.ns = neg; }
      else if (x === "-d" || x === "--destination") { r.d = w[++i]; r.nd = neg; }
      else if (x === "-i" || x === "--in-interface") { r.i = w[++i]; r.ni = neg; }
      else if (x === "-o") { i++; }
      else if (x === "-p" || x === "--protocol") r.p = w[++i];
      else if (x === "--dport" || x === "--destination-port") { r.dport = w[++i]; r.ndport = neg; }
      else if (x === "--dports") r.dports = w[++i];
      else if (x === "--ctorigdstport") r.origdport = w[++i];
      else if (x === "--ctstate" || x === "--state") r.ctstate = w[++i];
      else if (x === "-m" || x === "--match") { i++; }
      else if (x === "-j" || x === "--jump") r.target = w[++i];
      else { errl(io, "Bad argument `" + x + "'\nTry `iptables -h' or 'iptables --help' for more information."); return null; }
      neg = false;
    }
    if (!r.target) { r.target = ""; }
    if (r.dport != null && !r.p) { errl(io, "iptables v1.8.10 (nf_tables): unknown option \"--dport\"\nTry `iptables -h' or 'iptables --help' for more information."); return null; }
    if (r.target && !/^(ACCEPT|DROP|REJECT|RETURN|LOG)$/.test(r.target)) { errl(io, "iptables v1.8.10 (nf_tables): Couldn't load target `" + r.target + "':No such file or directory\n\nTry `iptables -h' or 'iptables --help' for more information."); return null; }
    return r;
  }
  var iptPrev = CMDS.iptables;
  CMDS.iptables = function (args, io, sess) {
    var sys = sess.sys, a = args.slice(1);
    var touchesDocker = a.some(function (x) { return /^DOCKER/.test(x); }) || (a.indexOf("-t") >= 0 && a[a.indexOf("-t") + 1] === "nat");
    if (!touchesDocker || !sys.docker) return iptPrev ? iptPrev(args, io, sess) : 1;
    if (sess.uid !== 0) { errl(io, "iptables v1.8.10 (nf_tables): Could not fetch rule set generation id: Permission denied (you must be root)\n"); return 4; }
    var d = dock(sys), nat = a.indexOf("-t") >= 0 && a[a.indexOf("-t") + 1] === "nat";
    var w = a.filter(function (x, i) { return !(x === "-t" || a[i - 1] === "-t"); });
    var verb = w[0], chain = w[1];
    var lineNums = w.indexOf("--line-numbers") >= 0;
    if (nat && (verb === "-L" || verb === "-S" || verb === "--list")) {
      var rows = [["RETURN", "all", "0.0.0.0/0", "0.0.0.0/0", ""]];
      d.ctrs.forEach(function (c) { if (c.status !== "running") return; c.ports.forEach(function (p) { rows.push(["DNAT", p.proto, "0.0.0.0/0", p.hostIp === "0.0.0.0" ? "0.0.0.0/0" : p.hostIp, p.proto + " dpt:" + p.hostPort + " to:" + c.nets[0].ip + ":" + p.ctrPort]); }); });
      if (verb === "-S") { out(io, "-N DOCKER\n-A DOCKER -i docker0 -j RETURN\n" + rows.slice(1).map(function (r) { return "-A DOCKER " + (r[3] !== "0.0.0.0/0" ? "-d " + r[3] + "/32 " : "") + "! -i docker0 -p " + r[1] + " -m " + r[1] + " --dport " + r[4].replace(/^\w+ dpt:(\d+).*$/, "$1") + " -j DNAT --to-destination " + r[4].replace(/^.* to:/, ""); }).join("\n") + "\n"); return 0; }
      if (chain && chain !== "DOCKER" && !/^-/.test(chain)) { errl(io, "iptables: No chain/target/match by that name."); return 1; }
      out(io, "Chain DOCKER (2 references)\n" + rp("target", 11) + rp("prot", 5) + rp("opt", 4) + rp("source", 21) + rp("destination", 21) + "\n" + rows.map(function (r) { return (rp(r[0], 11) + rp(r[1], 5) + rp("--", 4) + rp(r[2], 21) + rp(r[3], 21) + r[4]).replace(/\s+$/, " "); }).join("\n") + "\n");
      return 0;
    }
    if (chain !== "DOCKER-USER" && !(verb === "-L" && chain === "FORWARD")) { if (/^-[LS]$/.test(verb) && /^DOCKER/.test(chain || "")) { out(io, "Chain " + chain + " (1 references)\n" + rp("target", 11) + rp("prot", 5) + rp("opt", 4) + rp("source", 21) + rp("destination", 21) + "\n"); return 0; } errl(io, "iptables: No chain/target/match by that name."); return 1; }
    if (verb === "-L" && chain === "FORWARD") { out(io, "Chain FORWARD (policy DROP)\n" + rp("target", 11) + rp("prot", 5) + rp("opt", 4) + rp("source", 21) + rp("destination", 21) + "\nDOCKER-USER  all  --  0.0.0.0/0            0.0.0.0/0           \nDOCKER-FORWARD  all  --  0.0.0.0/0            0.0.0.0/0           \nufw-before-forward  all  --  0.0.0.0/0            0.0.0.0/0           \n"); return 0; }
    var U2 = d.user;
    if (verb === "-L" || verb === "--list") { out(io, "Chain DOCKER-USER (1 references)\n" + (lineNums ? rp("num", 5) : "") + rp("target", 11) + rp("prot", 5) + rp("opt", 4) + rp("source", 21) + rp("destination", 21) + "\n" + U2.map(function (r, k) { return ruleRow(r, lineNums ? k + 1 : null).replace(/\s+$/, " "); }).join("\n") + (U2.length ? "\n" : "")); return 0; }
    if (verb === "-S") { out(io, "-N DOCKER-USER\n" + U2.map(function (r) { return "-A DOCKER-USER " + ruleSpec(r) + "\n"; }).join("")); return 0; }
    if (verb === "-F") { d.user = []; return 0; }
    if (verb === "-I" || verb === "-A") {
      var pos = verb === "-I" && /^\d+$/.test(w[2] || "") ? +w[2] : null, spec = w.slice(pos != null ? 3 : 2), r = parseRule(spec, io);
      if (!r) return 2;
      if (pos != null && (pos < 1 || pos > U2.length + 1)) { errl(io, "iptables: Index of insertion too big."); return 1; }
      if (verb === "-A") U2.push(r); else U2.splice(pos != null ? pos - 1 : 0, 0, r);
      return 0;
    }
    if (verb === "-D") {
      if (/^\d+$/.test(w[2] || "")) { var n = +w[2]; if (n < 1 || n > U2.length) { errl(io, "iptables: Index of deletion too big."); return 1; } U2.splice(n - 1, 1); return 0; }
      var r2 = parseRule(w.slice(2), io); if (!r2) return 2;
      var k = U2.findIndex(function (x) { return ruleSpec(x) === ruleSpec(r2); });
      if (k < 0) { errl(io, "iptables: Bad rule (does a matching rule exist in that chain?)."); return 1; }
      U2.splice(k, 1); return 0;
    }
    errl(io, "iptables v1.8.10 (nf_tables): unknown option \"" + verb + "\"\nTry `iptables -h' or 'iptables --help' for more information."); return 2;
  };
  N.dockerLab = function (sys, setup) {
    M3.preinstall(sys, "nmap");
    N.riskyServices(sys, ["docker"], NOW - 30 * DAY);
    putRoot(sys, "/etc/docker/daemon.json", "{\n  \"log-driver\": \"journald\"\n}\n", 420, 0, 0, NOW - 30 * DAY);
    M2.writeRoot(sys, "/etc/group", "docker:x:988:dev\n", true);
    var u = sys.units && sys.units["docker.service"]; if (u) { sys.procs.filter(function (p) { return p.unit === "docker.service"; }).forEach(function (p) { p.listen = []; }); }
    dock(sys);
    if (setup) setup(sys, dock(sys));
  };

  /* ================================================================== a private CA with OpenSSL */
  function keyText(kid, alg) { return "-----BEGIN PRIVATE KEY-----\n" + wrap64(b64("\x30\x81\x87\x02\x01\x00KID:" + kid + "|" + alg + "|" + M2.hashChars("k" + kid, 60))) + "\n-----END PRIVATE KEY-----\n"; }
  function keyId(text) {
    var m = /-----BEGIN (?:EC |RSA )?PRIVATE KEY-----([\s\S]*?)-----END/.exec(String(text || "")); if (!m) return null;
    var raw = ""; try { raw = unb64(m[1].replace(/\s+/g, "")); } catch (e) { return null; }
    var k = /KID:([0-9a-f]+)\|(\w+)/.exec(raw); return k ? { kid: k[1], alg: k[2] } : { kid: M2.hexOf("kid:" + raw, 16), alg: "rsa2048" };
  }
  function certText(c) { return "-----BEGIN CERTIFICATE-----\n" + wrap64(b64("\x30\x82\x05\x1a" + JSON.stringify(c))) + "\n-----END CERTIFICATE-----\n"; }
  function csrText(c) { return "-----BEGIN CERTIFICATE REQUEST-----\n" + wrap64(b64("\x30\x82\x01\x0a" + JSON.stringify(c))) + "\n-----END CERTIFICATE REQUEST-----\n"; }
  function parseCerts(text) { var r = [], re = /-----BEGIN CERTIFICATE-----([\s\S]*?)-----END CERTIFICATE-----/g, m; while ((m = re.exec(String(text || "")))) { try { r.push(JSON.parse(unb64(m[1].replace(/\s+/g, "")).slice(4))); } catch (e) { r.push({ bad: true }); } } return r; }
  function parseCsr(text) { var m = /-----BEGIN CERTIFICATE REQUEST-----([\s\S]*?)-----END CERTIFICATE REQUEST-----/.exec(String(text || "")); if (!m) return null; try { return JSON.parse(unb64(m[1].replace(/\s+/g, "")).slice(4)); } catch (e) { return null; } }
  function subjFrom(s) {
    s = String(s || "").trim(); if (!/^\//.test(s)) return null;
    var parts = s.slice(1).split("/").filter(Boolean).map(function (p) { var e = p.indexOf("="); return e < 0 ? null : [p.slice(0, e), p.slice(e + 1)]; });
    if (parts.some(function (p) { return !p; })) return null;
    return parts.map(function (p) { return p[0] + " = " + p[1]; }).join(", ");
  }
  function dnRfc2253(s) { return String(s).split(", ").reverse().map(function (x) { return x.replace(" = ", "="); }).join(","); }
  function algOf(newkey, pkeyopt) { if (!newkey) return "ec256"; if (/^rsa/i.test(newkey)) return "rsa" + ((/:(\d+)/.exec(newkey) || [])[1] || "2048"); if (/^ed25519/i.test(newkey)) return "ed25519"; return "ec256"; }
  N.pki = { keyText: keyText, keyId: keyId, certText: certText, parseCerts: parseCerts, parseCsr: parseCsr, dn: dnRfc2253 };
  function osslErr(io, msg) { errl(io, msg); return 1; }
  function extsFrom(text) {
    var e = {}; String(text || "").split(/\n|,(?=\s*\w+\s*=)/).forEach(function (l) {
      var m = /^\s*(\w+)\s*=\s*(.+?)\s*$/.exec(l); if (!m) return;
      if (m[1] === "subjectAltName") e.san = m[2].split(",").map(function (x) { return x.trim().replace(/^(DNS|IP):/, ""); });
      if (m[1] === "basicConstraints") e.ca = /CA:TRUE/i.test(m[2]);
      if (m[1] === "extendedKeyUsage") e.eku = m[2].split(",").map(function (x) { return x.trim(); });
    });
    return e;
  }
  function serialHex(seed) { return M2.hexOf("serial:" + seed, 40).toUpperCase(); }
  function opensslReq(a, io, sess) {
    var o = { addext: [] };
    for (var i = 0; i < a.length; i++) {
      var x = a[i];
      if (x === "-new" || x === "-nodes" || x === "-noenc" || x === "-sha256" || x === "-batch" || x === "-verify" || x === "-noout" || x === "-text") o[x.slice(1)] = true;
      else if (x === "-x509") o.x509 = true;
      else if (/^-(newkey|pkeyopt|keyout|key|out|in|days|subj|config|extensions|reqexts)$/.test(x)) { if (x === "-pkeyopt") o.pkeyopt = (o.pkeyopt || []).concat([a[++i]]); else o[x.slice(1)] = a[++i]; }
      else if (x === "-addext") o.addext.push(a[++i]);
      else return osslErr(io, "req: Unknown option or message digest: " + x.replace(/^-/, "") + "\nreq: Use -help for summary.");
    }
    if (o.in && !o.new) { var t = readAs(sess, o.in), csr = parseCsr(t); if (!csr) return osslErr(io, "Could not read certificate request from " + o.in + "\nUnable to load X509 request"); if (o.text) out(io, "Certificate Request:\n    Data:\n        Version: 1 (0x0)\n        Subject: " + csr.s + "\n        Subject Public Key Info:\n            Public Key Algorithm: " + (/^ec/.test(csr.key) ? "id-ecPublicKey" : "rsaEncryption") + "\n"); else if (!o.noout) out(io, t); if (o.verify) errl(io, "Certificate request self-signature verify OK"); return 0; }
    if (!o.new && !o.x509 && !o.newkey) return osslErr(io, "req: Use -help for summary.");
    var subj = o.subj ? subjFrom(o.subj) : null;
    if (!subj) { if (o.subj) return osslErr(io, "req: Error parsing -subj: " + o.subj + " (it looks like /CN=name/O=org)"); note(io, "(openssl would now ask for each part of the name, one prompt at a time. Give it on the command line instead: -subj \"/CN=name\")"); return osslErr(io, "Error making certificate request"); }
    var kid, alg;
    if (o.key) { var kt = readAs(sess, o.key), kk = keyId(kt); if (!kk) return osslErr(io, "Could not open file or uri for loading private key from " + o.key); kid = kk.kid; alg = kk.alg; }
    else {
      alg = algOf(o.newkey, o.pkeyopt); kid = M2.hexOf("newkey:" + (o.keyout || "") + (sess.sys.cmdIndex || 0) + subj, 16);
      var kout = o.keyout || "privkey.pem";
      if (!o.nodes && !o.noenc) { note(io, "(Without -nodes (or -noenc), openssl asks for a passphrase to encrypt the key. Services need to read their key at start, so add -nodes.)"); return osslErr(io, "Enter PEM pass phrase:\nError: no passphrase given"); }
      if (/^rsa/.test(alg)) errl(io, ".+...+..+.+.....+...+.....+.+++++++++++++++++++++++++++++++++++++++*...+....+.+++++++++++++++++++++++++++++++++++++++*\n-----");
      else errl(io, "-----");
      if (writeAs(sess, kout, keyText(kid, alg)) !== 0 && readAs(sess, kout) == null) return osslErr(io, "Could not open file or uri for writing " + kout);
      var kn = S.lookup(sess, kout).node; if (kn) kn.mode = 384;
    }
    var ext = {}; o.addext.forEach(function (e) { var x2 = extsFrom(e); Object.keys(x2).forEach(function (k) { ext[k] = x2[k]; }); });
    var now = sess.sys.now, outText;
    if (o.x509) { var days = o.days ? +o.days : 30; var c = { s: subj, i: subj, nb: now, na: now + days * DAY, san: ext.san || [], sn: serialHex(subj + now + kid), key: alg, sig: /^ec/.test(alg) ? "ecdsa-with-SHA256" : "sha256WithRSAEncryption", ca: ext.ca != null ? ext.ca : true, pk: kid, ik: kid, eku: ext.eku }; outText = certText(c); }
    else outText = csrText({ s: subj, pk: kid, key: alg, san: ext.san || [], eku: ext.eku });
    if (o.out) { if (writeAs(sess, o.out, outText) !== 0 && readAs(sess, o.out) == null) return osslErr(io, "Could not open file or uri for writing " + o.out); }
    else out(io, outText);
    return 0;
  }
  function opensslX509Req(a, io, sess) {
    var o = {};
    for (var i = 0; i < a.length; i++) { var x = a[i]; if (x === "-req" || x === "-CAcreateserial" || x === "-sha256" || x === "-noout" || x === "-text") o[x.slice(1)] = true; else if (/^-(in|CA|CAkey|CAserial|out|days|extfile|extensions|set_serial|signkey)$/.test(x)) o[x.slice(1)] = a[++i]; else return osslErr(io, "x509: Unknown option or message digest: " + x.replace(/^-/, "") + "\nx509: Use -help for summary."); }
    var csrT = readAs(sess, o.in || ""), csr = csrT && parseCsr(csrT);
    if (!csr) return osslErr(io, "Could not open file or uri for loading certificate request from " + (o.in || "stdin") + "\nUnable to load certificate request input");
    var now = sess.sys.now, days = o.days ? +o.days : 30, ext = o.extfile ? extsFrom(readAs(sess, o.extfile) || "") : {};
    var c;
    if (o.CA) {
      var caT = readAs(sess, o.CA), ca = caT && parseCerts(caT)[0]; if (!ca || ca.bad) return osslErr(io, "Could not open file or uri for loading CA certificate from " + o.CA + "\nUnable to load CA certificate");
      var kT = readAs(sess, o.CAkey || o.CA), kk = keyId(kT); if (!kk) return osslErr(io, "Could not read CA private key from " + (o.CAkey || o.CA) + "\nUnable to load CA private key");
      if (kk.kid !== ca.pk) return osslErr(io, "Warning: Signature key and public key of cert do not match\n40C7B1D4A97F0000:error:05800074:x509 certificate routines:X509_check_private_key:key values mismatch:../crypto/x509/x509_cmp.c:405:");
      if (!o.CAcreateserial && !o.CAserial && !o.set_serial) { var serPath = o.CA.replace(/\.[^./]*$/, "") + ".srl"; if (readAs(sess, serPath) == null) return osslErr(io, "Certificate request self-signature ok\nsubject=" + csr.s + "\n" + serPath + ": No such file or directory\n40C7B1D4A97F0000:error:80000002:system library:file_open:No such file or directory:../providers/implementations/storemgmt/file_store.c:267:calling stat(" + serPath + ")\n(add -CAcreateserial the first time you sign with this CA)"); }
      var sn = serialHex(csr.s + now + (sess.sys.cmdIndex || 0));
      if (o.CAcreateserial || o.CAserial) writeAs(sess, o.CAserial || o.CA.replace(/\.[^./]*$/, "") + ".srl", sn + "\n");
      c = { s: csr.s, i: ca.s, nb: now, na: now + days * DAY, san: ext.san || csr.san || [], sn: sn, key: csr.key, sig: /^ec/.test(ca.key) ? "ecdsa-with-SHA256" : "sha256WithRSAEncryption", ca: !!ext.ca, pk: csr.pk, ik: ca.pk, eku: ext.eku || csr.eku };
    } else if (o.signkey) {
      var sk = keyId(readAs(sess, o.signkey)); if (!sk) return osslErr(io, "Could not read private key from " + o.signkey);
      c = { s: csr.s, i: csr.s, nb: now, na: now + days * DAY, san: ext.san || csr.san || [], sn: serialHex(csr.s + now), key: csr.key, sig: "ecdsa-with-SHA256", ca: false, pk: csr.pk, ik: sk.kid };
    } else return osslErr(io, "x509: give the CA to sign with: -CA ca.crt -CAkey ca.key");
    errl(io, "Certificate request self-signature ok\nsubject=" + csr.s);
    var t = certText(c);
    if (o.out) writeAs(sess, o.out, t); else out(io, t);
    return 0;
  }
  function verifyAgainst(cas, c, now) {
    if (!c || c.bad) return { code: 9, text: "unable to load certificate" };
    var issuer = cas.filter(function (x) { return !x.bad && x.s === c.i && (x.pk == null || c.ik == null || x.pk === c.ik); })[0];
    if (c.i === c.s && c.ik === c.pk && !issuer) return { code: 18, text: "self-signed certificate" };
    if (!issuer) return { code: 20, text: "unable to get local issuer certificate" };
    if (now < c.nb) return { code: 9, text: "certificate is not yet valid" };
    if (now > c.na) return { code: 10, text: "certificate has expired" };
    if (issuer !== c && !issuer.ca) return { code: 24, text: "invalid CA certificate" };
    return { code: 0 };
  }
  N.pki.verify = verifyAgainst;
  function opensslVerify(a, io, sess) {
    var caFile = null, files = [];
    for (var i = 0; i < a.length; i++) { if (a[i] === "-CAfile") caFile = a[++i]; else if (/^-/.test(a[i])) { if (a[i] === "-untrusted" || a[i] === "-purpose") i++; } else files.push(a[i]); }
    var cas = caFile ? parseCerts(readAs(sess, caFile) || "") : [];
    if (caFile && !cas.length) return osslErr(io, "Error loading file " + caFile);
    var code = 0;
    files.forEach(function (f) {
      var c = parseCerts(readAs(sess, f) || "")[0];
      if (!c) { errl(io, "Could not open file or uri for loading certificate from " + f); code = 2; return; }
      var v = verifyAgainst(cas.concat(caFile ? [] : []), c, sess.sys.now);
      if (!v.code) { out(io, f + ": OK\n"); return; }
      errl(io, c.s + "\nerror " + v.code + " at 0 depth lookup: " + v.text + "\nerror " + f + ": verification failed"); code = 2;
    });
    return code;
  }
  function opensslGenKey(a, io, sess, kind) {
    var outF = null, alg = "ec256";
    for (var i = 0; i < a.length; i++) { var x = a[i]; if (x === "-out") outF = a[++i]; else if (x === "-algorithm") { var al = a[++i]; alg = /rsa/i.test(al) ? "rsa2048" : /ed25519/i.test(al) ? "ed25519" : "ec256"; } else if (x === "-pkeyopt" || x === "-name") i++; else if (x === "-genkey" || x === "-noout") continue; }
    var kid = M2.hexOf("genkey:" + (outF || "") + (sess.sys.cmdIndex || 0), 16), t = keyText(kid, alg);
    if (outF) { writeAs(sess, outF, t); var n = S.lookup(sess, outF).node; if (n) n.mode = 384; } else out(io, t);
    return 0;
  }
  var osslPrev = CMDS.openssl;
  CMDS.openssl = function (args, io, sess) {
    var v = args[1], rest = args.slice(2);
    if (v === "req") return opensslReq(rest, io, sess);
    if (v === "x509" && (rest.indexOf("-req") >= 0)) return opensslX509Req(rest, io, sess);
    if (v === "verify") return opensslVerify(rest, io, sess);
    if (v === "genpkey" || (v === "ecparam" && rest.indexOf("-genkey") >= 0)) return opensslGenKey(rest, io, sess, v);
    return osslPrev(args, io, sess);
  };
  // nginx asks for client certificates: ssl_verify_client on + ssl_client_certificate
  M2.ngxHooks = M2.ngxHooks || [];
  function ngx400(title, sys) { return "<html>\r\n<head><title>400 " + title + "</title></head>\r\n<body>\r\n<center><h1>400 Bad Request</h1></center>\r\n<center>" + title + "</center>\r\n<hr><center>nginx/1.24.0 (Ubuntu)</center>\r\n</body>\r\n</html>\r\n"; }
  M2.ngxHooks.push(function (h) {
    var req = h.req; if (req.scheme !== "https") return null;
    var vc = h.get("ssl_verify_client"); if (!vc || vc.args[0] === "off") return null;
    var cap = h.get("ssl_client_certificate"), cas = cap ? parseCerts((h.conf._mtlsCa = h.conf._mtlsCa || {})[cap.args[0]] != null ? h.conf._mtlsCa[cap.args[0]] : (h.conf._mtlsCa[cap.args[0]] = rd(h.sys, cap.args[0]) || "")) : [];
    if (!req.clientCert) {
      if (vc.args[0] === "optional" || vc.args[0] === "optional_no_ca") { req.sslClientVerify = "NONE"; return null; }
      return { status: 400, body: ngx400("No required SSL certificate was sent"), log: "client sent no required SSL certificate while reading client request headers", level: "info" };
    }
    var c = parseCerts(req.clientCert)[0], v = verifyAgainst(cas, c, h.sys.now);
    if (v.code && vc.args[0] !== "optional_no_ca") return { status: 400, body: ngx400("The SSL certificate error"), log: "client SSL certificate verify error: (" + v.code + ":" + v.text + ") while reading client request headers", level: "info" };
    req.sslClientDn = dnRfc2253(c.s); req.sslClientVerify = v.code ? "FAILED:" + v.text : "SUCCESS";
    return null;
  });
  // the internal payments API: it trusts the identity nginx passes on
  M2.appHandlers.push(function (sys, proc, req) {
    if (proc.comm !== "payments-api") return null;
    var p = req.path.split("?")[0], h = { "Content-Type": "application/json", Server: "uvicorn" }, dn = req.headers["x-client-dn"] || "", cn = (/(?:^|,)CN=([^,]+)/.exec(dn) || [])[1];
    if (p === "/v1/health") return { status: 200, headers: h, body: "{\"status\":\"ok\"}\n" };
    if (p.indexOf("/v1/charges") === 0) {
      if (!cn) return { status: 401, headers: h, body: "{\"error\":\"no client identity: call through the mTLS gateway\"}\n" };
      var allowed = (sys.paymentsAllowed || ["orders-svc"]);
      if (allowed.indexOf(cn) < 0) return { status: 403, headers: h, body: "{\"error\":\"" + cn + " may not use /v1/charges\"}\n" };
      return { status: 200, headers: h, body: "{\"caller\":\"" + cn + "\",\"charges\":[{\"id\":\"ch_7731\",\"order\":7731,\"amount\":42.5}]}\n" };
    }
    return { status: 404, headers: h, body: "{\"detail\":\"Not Found\"}\n" };
  });

  /* ================================================================== Squid egress proxy + curl -x */
  function squidSnap(m) {
    var conf = rd(m, "/etc/squid/squid.conf") || "", lf = (/acl\s+allowed_sites\s+dstdomain\s+"([^"]+)"/.exec(conf) || [])[1];
    var list = lf ? (rd(m, lf) || "").split("\n").map(function (l) { return l.replace(/#.*/, "").trim().toLowerCase(); }).filter(Boolean) : [];
    m.squidLive = { allow: list, file: lf };
  }
  N.cloudRoleSetup = N.cloudRoleSetup || {};
  N.cloudRoleSetup.proxy = function (m) {
    S.mkdirs(m, "/etc/squid", 493, 0, 0); S.mkdirs(m, "/var/log/squid", 488, 13, 13);
    putRoot(m, "/etc/squid/squid.conf", "# Kestrel egress proxy (excerpt)\nhttp_port 3128\n\nacl localnet src 10.0.0.0/16\nacl SSL_ports port 443\nacl Safe_ports port 80 443\nacl CONNECT method CONNECT\n\n# only these domains, one per line; .example.com also allows its subdomains\nacl allowed_sites dstdomain \"/etc/squid/allowed-domains.txt\"\n\nhttp_access deny !Safe_ports\nhttp_access deny CONNECT !SSL_ports\nhttp_access allow localnet allowed_sites\nhttp_access deny all\n\naccess_log daemon:/var/log/squid/access.log squid\n", 420, 0, 0, NOW - 30 * DAY);
    putRoot(m, "/etc/squid/allowed-domains.txt", "# Where Kestrel servers may connect to\n.archive.ubuntu.com\n.security.ubuntu.com\n", 420, 0, 0, NOW - 30 * DAY);
    putRoot(m, "/var/log/squid/access.log", "", 416, 13, 13);
    putRoot(m, "/usr/sbin/squid", "\x7fELF:squid (simulated binary)\n", 493, 0, 0);
    putRoot(m, "/usr/lib/systemd/system/squid.service", "[Unit]\nDescription=Squid Web Proxy Server\nAfter=network.target\n\n[Service]\nType=simple\nExecStart=/usr/sbin/squid --foreground -sYC\nExecReload=/bin/kill -HUP $MAINPID\n\n[Install]\nWantedBy=multi-user.target\n", 420, 0, 0);
    S.mkdirs(m, "/etc/systemd/system/multi-user.target.wants").children["squid.service"] = S.linkNode("/usr/lib/systemd/system/squid.service");
    M2.unitUp(m, "squid.service", NOW - 30 * DAY);
    squidSnap(m);
  };
  M2.shapes.squid = function (sys) { return [{ cmd: "/usr/sbin/squid --foreground -sYC", comm: "squid", uid: 13, main: true, listen: [{ proto: "tcp", addr: "0.0.0.0", port: 3128 }], onHup: function (s2) { squidSnap(s2); } }]; };
  var prevOnStart = M2.onUnitStart;
  M2.onUnitStart = function (sys, u) {
    if (prevOnStart) prevOnStart(sys, u);
    if (u.name === "squid.service") squidSnap(sys);
    if (u.execStart && /nginx/.test(u.execStart) && sys.nginxLive) sys.nginxLive._modsec = modsecLoad(sys, sys.nginxLive);
  };
  function domainAllowed(list, host) { host = host.toLowerCase(); return list.some(function (d) { return d.charAt(0) === "." ? host === d.slice(1) || host.slice(-d.length) === d : host === d; }); }
  function squidLog(m, from, code, method, target, bytes) { M2.writeRoot(m, "/var/log/squid/access.log", (m.now / 1000).toFixed(3) + pad(String(code === 200 ? 214 : 0), 6) + " " + from + " " + (code === 403 ? "TCP_DENIED/403" : code === 503 ? "TCP_MISS/503" : method === "CONNECT" ? "TCP_TUNNEL/200" : "TCP_MISS/200") + " " + bytes + " " + method + " " + target + " - " + (code === 403 ? "HIER_NONE/-" : "HIER_DIRECT/" + target.split(":")[0]) + " " + (code === 200 && method !== "CONNECT" ? "text/html" : "-") + "\n", true); }
  function envProxy(sess, scheme) { var v = sess.vars[scheme + "_proxy"] || sess.vars[(scheme + "_proxy").toUpperCase()]; return v && v.x ? v.v : null; }
  var curlPrev = CMDS.curl;
  CMDS.curl = function (args, io, sess) {
    var a = args.slice(1), proxy = null, url = null, o = { headers: {} }, noproxy = null;
    for (var i = 0; i < a.length; i++) {
      var x = a[i];
      if (x === "-x" || x === "--proxy") { proxy = a[++i]; continue; } if (/^--proxy=/.test(x)) { proxy = x.slice(8); continue; }
      if (x === "--noproxy") { noproxy = a[++i]; continue; }
      if (/^--/.test(x)) { if (/^--(silent|show-error|head|include|verbose|fail|insecure|location)$/.test(x)) o[{ "--silent": "s", "--show-error": "S", "--head": "I", "--include": "i", "--verbose": "v", "--fail": "f", "--insecure": "k", "--location": "L" }[x]] = true; else if (/^--(max-time|connect-timeout|output|write-out|header|data|request|user-agent|cert|key|cacert|resolve|retry|user)$/.test(x)) { if (x === "--max-time" || x === "--connect-timeout") o.m = +a[i + 1]; if (x === "--output") o.o = a[i + 1]; if (x === "--write-out") o.w = a[i + 1]; i++; } continue; }
      if (/^-[a-zA-Z]+$/.test(x)) { var takes = false; for (var k = 1; k < x.length; k++) { var ch = x.charAt(k); if ("mowHdXAEuU".indexOf(ch) >= 0) { if (ch === "m") o.m = +a[i + 1]; if (ch === "o") o.o = a[i + 1]; if (ch === "w") o.w = a[i + 1]; takes = true; } else o[ch] = true; } if (takes) i++; continue; }
      if (!url) url = x;
    }
    var pu = url && M2.parseUrl(url);
    if (!proxy && pu && !noproxy) proxy = envProxy(sess, pu.scheme);
    if (!proxy || !pu || noproxy === "*") return curlPrev(args, io, sess);
    if (sess.vars.no_proxy && sess.vars.no_proxy.v.split(",").some(function (d) { d = d.trim(); return d && (pu.host === d || pu.host.slice(-d.length) === d); })) return curlPrev(args, io, sess);
    return viaProxy(sess, io, proxy, pu, o);
  };
  function viaProxy(sess, io, proxy, pu, o) {
    var sys = sess.sys, px = M2.parseUrl(/^\w+:\/\//.test(proxy) ? proxy : "http://" + proxy); px.port = px.explicitPort ? px.port : 1080;
    if (!/^\w+:\/\//.test(proxy) && !/:\d+/.test(proxy)) px.port = 1080;
    if (/:(\d+)/.test(proxy)) px.port = +/:(\d+)(?:\/|$)/.exec(proxy)[1];
    function fail(code, msg) { if (!o.s || o.S) errl(io, "curl: (" + code + ") " + msg); if (o.w) out(io, o.w.replace(/%\{http_code\}/g, "000").replace(/\\n/g, "\n")); return code; }
    var g = N.getaddrinfo(sys, px.host, 4); if (g.err) return fail(5, "Could not resolve proxy: " + px.host);
    var tc = N.tcpOpen(sys, g.ip, px.port);
    if (tc.err) return tc.err === "timeout" ? fail(28, o.m ? "Connection timed out after " + (o.m * 1000 + 1) + " milliseconds" : "Failed to connect to " + px.host + " port " + px.port + " after 130" + (hash(g.ip) % 900 + 100) + " ms: Couldn't connect to server") : fail(7, "Failed to connect to " + px.host + " port " + px.port + " after 0 ms: Couldn't connect to server");
    var pm = tc.remote || (N.homeOf(sys) || sys);
    if (!pm.squidLive) return fail(56, "Proxy CONNECT aborted");
    var https = pu.scheme === "https", target = https ? pu.host + ":" + pu.port : "http://" + pu.host + (pu.port !== 80 ? ":" + pu.port : "") + pu.path;
    if (o.v) errl(io, "*   Trying " + g.ip + ":" + px.port + "...\n* Connected to " + px.host + " (" + g.ip + ") port " + px.port + (https ? "\n* CONNECT tunnel: HTTP/1.1 negotiated\n* allocate connect buffer\n* Establish HTTP proxy tunnel to " + pu.host + ":" + pu.port + "\n> CONNECT " + pu.host + ":" + pu.port + " HTTP/1.1\n> Host: " + pu.host + ":" + pu.port + "\n> User-Agent: curl/8.5.0\n> Proxy-Connection: Keep-Alive\n>" : ""));
    var from = sys.ip || ME;
    var DENY_PAGE = "<!DOCTYPE html>\n<html><head><title>ERROR: The requested URL could not be retrieved</title></head><body>\n<h1>ERROR</h1>\n<h2>The requested URL could not be retrieved</h2>\n<p>Access control configuration prevents your request from being allowed at this time.</p>\n<p>Generated by proxy-1 (squid/6.10)</p>\n</body></html>\n";
    if (!domainAllowed(pm.squidLive.allow, pu.host)) {
      squidLog(pm, from, 403, https ? "CONNECT" : "GET", https ? target : target, 3920);
      if (https) { if (o.v) errl(io, "< HTTP/1.1 403 Forbidden\n< Server: squid/6.10\n< X-Squid-Error: ERR_ACCESS_DENIED 0\n<\n* CONNECT tunnel failed, response 403"); return fail(56, "CONNECT tunnel failed, response 403"); }
      if (o.I || o.i) out(io, "HTTP/1.1 403 Forbidden\r\nServer: squid/6.10\r\nContent-Type: text/html;charset=utf-8\r\nX-Squid-Error: ERR_ACCESS_DENIED 0\r\n\r\n");
      if (!o.I) out(io, DENY_PAGE);
      if (o.w) out(io, o.w.replace(/%\{http_code\}/g, "403").replace(/\\n/g, "\n"));
      return o.f ? 22 : 0;
    }
    var tg = N.getaddrinfo(pm, pu.host, 4), ttc = tg.err ? { err: "dns" } : N.tcpOpen(pm, tg.ip, pu.port);
    if (ttc.err) {
      squidLog(pm, from, 503, https ? "CONNECT" : "GET", target, 0);
      if (https) return fail(56, "CONNECT tunnel failed, response 503");
      out(io, "<!DOCTYPE html>\n<html><head><title>ERROR: The requested URL could not be retrieved</title></head><body><h1>ERROR</h1><p>Connection to " + pu.host + " failed.</p></body></html>\n"); return o.f ? 22 : 0;
    }
    var res = N.httpTo(pm, tg.ip, pu.port, { scheme: pu.scheme, host: pu.host, port: pu.port, path: pu.path, method: o.I ? "HEAD" : "GET", headers: { host: pu.host, "user-agent": "curl/8.5.0", accept: "*/*" } });
    if (res.err) { squidLog(pm, from, 503, https ? "CONNECT" : "GET", target, 0); return fail(56, https ? "CONNECT tunnel failed, response 503" : "Recv failure: Connection reset by peer"); }
    squidLog(pm, from, 200, https ? "CONNECT" : "GET", target, (res.body || "").length + 300);
    var head = (https ? "HTTP/1.1 200 Connection established\r\n\r\n" : "") + "HTTP/" + (https ? "2 " : "1.1 ") + res.status + (https ? "" : " OK") + "\r\n" + Object.keys(res.headers || {}).map(function (k) { return (https ? k.toLowerCase() : k) + ": " + res.headers[k] + "\r\n"; }).join("") + (https ? "" : "Via: 1.1 proxy-1 (squid/6.10)\r\n") + "\r\n";
    if (o.I || o.i) out(io, head);
    if (!o.I) { if (o.o) S.writeFile(sess, o.o, res.body || "", false); else out(io, res.body || ""); }
    if (o.w) out(io, o.w.replace(/%\{http_code\}/g, String(res.status)).replace(/\\n/g, "\n"));
    return o.f && res.status >= 400 ? 22 : 0;
  }
  // the payment provider and a paste site, out on the internet
  var DNS = M2.net.DNS, HOSTS = M2.net.HOSTS;
  DNS["pay.example.net"] = { A: ["198.51.100.50"] }; HOSTS["198.51.100.50"] = { ping: 12.4, ports: [443] };
  DNS["paste.example.org"] = { A: ["203.0.113.199"] }; HOSTS["203.0.113.199"] = { ping: 31.2, ports: [80, 443] };
  N.MYSITES["198.51.100.50:443"] = function (req) { var p = req.path.split("?")[0]; return p === "/v1/ping" ? { status: 200, headers: { "Content-Type": "application/json", Server: "example-pay" }, body: "{\"ok\":true,\"provider\":\"Example Pay\"}\n" } : { status: 404, headers: { "Content-Type": "application/json", Server: "example-pay" }, body: "{\"error\":\"not_found\"}\n" }; };
  N.MYSITES["203.0.113.199:443"] = function () { return { status: 200, headers: { "Content-Type": "text/html", Server: "nginx" }, body: "<!doctype html><title>paste</title><h1>Paste anything, share the link</h1>\n" }; };
  N.MYSITES["203.0.113.199:80"] = function (req) { return { status: 301, headers: { Location: "https://paste.example.org" + req.path, "Content-Type": "text/html", Server: "nginx" }, body: "" }; };

  /* ================================================================== ModSecurity + OWASP CRS */
  var CRS = [
    { id: "942100", file: "REQUEST-942-APPLICATION-ATTACK-SQLI.conf", line: 46, msg: "SQL Injection Attack Detected via libinjection", tag: "attack-sqli", re: /(union\s+(all\s+)?select|'\s*or\s*'?\d*'?\s*=\s*'?\d|\bor\s+1\s*=\s*1|;\s*drop\s+table|sleep\s*\(\s*\d|'\s*--|benchmark\s*\()/i, fp: "n&(1)" },
    { id: "941100", file: "REQUEST-941-APPLICATION-ATTACK-XSS.conf", line: 55, msg: "XSS Attack Detected via libinjection", tag: "attack-xss", re: /(<script|javascript:|onerror\s*=|onload\s*=|<svg[^>]*on\w+\s*=)/i },
    { id: "930100", file: "REQUEST-930-APPLICATION-ATTACK-LFI.conf", line: 33, msg: "Path Traversal Attack (/../ or /..;/)", tag: "attack-lfi", re: /(\.\.\/|\.\.%2f|%2e%2e\/|\.\.;\/)/i, raw: true },
    { id: "932160", file: "REQUEST-932-APPLICATION-ATTACK-RCE.conf", line: 497, msg: "Remote Command Execution: Unix Shell Code Found", tag: "attack-rce", re: /(\/etc\/passwd|\/bin\/(ba)?sh|;\s*(cat|id|wget|curl)\b|\|\s*(id|sh|bash)\b|\$\(\s*\w)/i },
    { id: "913100", file: "REQUEST-913-SCANNER-DETECTION.conf", line: 33, msg: "Found User-Agent associated with security scanner", tag: "attack-reputation-scanner", ua: /(sqlmap|nikto|nessus|masscan|nmap)/i }
  ];
  function confIncludes(sys, path, seen) {
    seen = seen || {}; if (seen[path]) return ""; seen[path] = true;
    var t = rd(sys, path); if (t == null) return "";
    return t.split("\n").map(function (l) { var m = /^\s*Include\s+(\S+)/i.exec(l); if (!m) return l; if (/\*/.test(m[1])) return ""; return confIncludes(sys, m[1], seen); }).join("\n");
  }
  function modsecLoad(sys, conf) {
    var srvOn = false, rulesFile = null;
    function scan(ds) { ds.forEach(function (d) { if (d.name === "modsecurity" && d.args[0] === "on") srvOn = true; if (d.name === "modsecurity_rules_file") rulesFile = d.args[0]; }); }
    scan(conf.http.block || []); conf.servers.forEach(function (s) { scan(s.d); (s.locs || []).forEach(function (l) { scan(l.d || []); }); });
    if (!srvOn || !rulesFile) return { on: false };
    var text = confIncludes(sys, rulesFile), engine = "On", removed = [], audit = "/var/log/nginx/modsec_audit.log";
    text.split("\n").forEach(function (l) {
      var m = /^\s*SecRuleEngine\s+(\w+)/i.exec(l); if (m) engine = m[1];
      var r = /^\s*SecRuleRemoveById\s+(.+)$/i.exec(l); if (r) r[1].split(/\s+/).forEach(function (x) { removed.push(x.replace(/"/g, "")); });
      var a = /^\s*SecAuditLog\s+(\S+)/i.exec(l); if (a) audit = a[1];
    });
    return { on: true, engine: engine, removed: removed, audit: audit };
  }
  function decodeAll(s) { try { return decodeURIComponent(String(s).replace(/\+/g, " ")); } catch (e) { return String(s); } }
  M2.ngxHooks.push(function (h) {
    var conf = h.conf, req = h.req;
    if (conf._modsec === undefined) conf._modsec = modsecLoad(h.sys, conf);
    var ms = conf._modsec; if (!ms.on || /^off$/i.test(ms.engine)) return null;
    var srvOn = (h.srv.d || []).some(function (d) { return d.name === "modsecurity" && d.args[0] === "on"; }) || (conf.http.block || []).some(function (d) { return d.name === "modsecurity" && d.args[0] === "on"; });
    if (!srvOn) return null;
    var q = req.path.split("?")[1] || "", args = [];
    q.split("&").forEach(function (kv) { if (!kv) return; var e = kv.indexOf("="); args.push(["ARGS:" + decodeAll(e < 0 ? kv : kv.slice(0, e)), decodeAll(e < 0 ? "" : kv.slice(e + 1))]); });
    if (req.body) String(req.body).split("&").forEach(function (kv) { var e = kv.indexOf("="); if (e > 0) args.push(["ARGS:" + decodeAll(kv.slice(0, e)), decodeAll(kv.slice(e + 1))]); });
    var hits = [];
    CRS.forEach(function (r) {
      if (ms.removed.indexOf(r.id) >= 0) return;
      if (r.ua) { var ua = req.headers["user-agent"] || ""; if (r.ua.test(ua)) hits.push({ r: r, where: "REQUEST_HEADERS:User-Agent", val: ua }); return; }
      if (r.raw && r.re.test(req.path.split("?")[0])) { hits.push({ r: r, where: "REQUEST_URI", val: req.path }); return; }
      for (var i = 0; i < args.length; i++) if (r.re.test(args[i][1])) { hits.push({ r: r, where: args[i][0], val: args[i][1] }); return; }
      if (r.raw && r.re.test(q)) hits.push({ r: r, where: "REQUEST_URI", val: req.path });
    });
    if (!hits.length) return null;
    var block = /^on$/i.test(ms.engine), uid = "1731" + M2.hexOf("uid" + req.path + h.sys.now + (h.sys.nginxConn || 0), 6).replace(/[a-f]/g, "7") + "." + String(100000 + (hash(req.path) >>> 0) % 899999);
    var sep = "---" + M2.hashChars("ms" + uid, 8) + "---";
    var lines = hits.map(function (x) { return "ModSecurity: Warning. " + (x.r.fp ? "detected SQLi using libinjection with fingerprint '" + x.r.fp + "'" : "Matched \"Operator `Rx' with parameter `...' against variable `" + x.where + "' (Value: `" + x.val.slice(0, 60) + "' )") + " [file \"/usr/share/modsecurity-crs/rules/" + x.r.file + "\"] [line \"" + x.r.line + "\"] [id \"" + x.r.id + "\"] [rev \"\"] [msg \"" + x.r.msg + "\"] [data \"Matched Data: " + x.val.slice(0, 60) + " found within " + x.where + ": " + x.val.slice(0, 60) + "\"] [severity \"2\"] [ver \"OWASP_CRS/3.3.5\"] [maturity \"0\"] [accuracy \"0\"] [tag \"application-multi\"] [tag \"" + x.r.tag + "\"] [hostname \"" + (req.localIp || "10.20.0.15") + "\"] [uri \"" + req.path.split("?")[0] + "\"] [unique_id \"" + uid + "\"]"; });
    var score = hits.length * 5;
    var denyLine = "ModSecurity: Access denied with code 403 (phase 2). Matched \"Operator `Ge' with parameter `5' against variable `TX:ANOMALY_SCORE' (Value: `" + score + "' ) [file \"/usr/share/modsecurity-crs/rules/REQUEST-949-BLOCKING-EVALUATION.conf\"] [line \"81\"] [id \"949110\"] [rev \"\"] [msg \"Inbound Anomaly Score Exceeded (Total Score: " + score + ")\"] [data \"\"] [severity \"2\"] [ver \"OWASP_CRS/3.3.5\"] [maturity \"0\"] [accuracy \"0\"] [tag \"application-multi\"] [tag \"anomaly-evaluation\"] [hostname \"" + (req.localIp || "10.20.0.15") + "\"] [uri \"" + req.path.split("?")[0] + "\"] [unique_id \"" + uid + "\"]";
    var d = new Date(h.sys.now), stamp = "[" + ("0" + d.getUTCDate()).slice(-2) + "/" + ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getUTCMonth()] + "/" + d.getUTCFullYear() + ":" + d.toISOString().slice(11, 19) + " +0000]";
    var entry = sep + "A--\n" + stamp + " " + uid + " " + h.client + " " + (40000 + (hash(uid) >>> 0) % 20000) + " " + (req.localIp || "10.20.0.15") + " " + req.port + "\n" + sep + "B--\n" + req.method + " " + req.path + " HTTP/1.1\nHost: " + (req.headers.host || "") + "\nUser-Agent: " + (req.headers["user-agent"] || "") + "\nAccept: */*\n\n" + sep + "F--\nHTTP/1.1 " + (block ? "403" : "200") + "\n\n" + sep + "H--\n" + lines.join("\n") + (block ? "\n" + denyLine : "") + "\n\n" + sep + "Z--\n\n";
    if (S.lookup({ sys: h.sys, uid: 0, gid: 0, groups: [0], cwd: "/" }, ms.audit.replace(/\/[^/]*$/, "")).node) M2.writeRoot(h.sys, ms.audit, entry, true);
    if (block) return { status: 403, log: "[client " + h.client + "] " + denyLine, level: "error" };
    h.errLog("warn", "[client " + h.client + "] " + lines[0]);
    return null;
  });
  N.modsecLab = function (sys, engine) {
    ["libnginx-mod-http-modsecurity", "modsecurity-crs"].forEach(function (p) { if (sys.pkgs[p]) M3.preinstall(sys, p); });
    S.mkdirs(sys, "/etc/nginx/modsec", 493, 0, 0); S.mkdirs(sys, "/usr/share/modsecurity-crs/rules", 493, 0, 0);
    putRoot(sys, "/etc/nginx/modsec/main.conf", "# Loaded by nginx: modsecurity_rules_file /etc/nginx/modsec/main.conf;\nInclude /etc/nginx/modsec/modsecurity.conf\nInclude /usr/share/modsecurity-crs/crs-setup.conf\nInclude /usr/share/modsecurity-crs/rules/*.conf\n", 420, 0, 0, NOW - 10 * DAY);
    putRoot(sys, "/etc/nginx/modsec/modsecurity.conf", "# ModSecurity recommended configuration (excerpt)\n# -- Rule engine initialization ----------------------------------------------\n# Enable ModSecurity, attaching it to every transaction. Use detection\n# only to start with, because that minimises the chances of post-installation\n# disruption.\n#\nSecRuleEngine " + (engine || "DetectionOnly") + "\n\nSecRequestBodyAccess On\nSecRequestBodyLimit 13107200\nSecResponseBodyAccess Off\n\n# -- Audit log configuration -------------------------------------------------\nSecAuditEngine RelevantOnly\nSecAuditLogRelevantStatus \"^(?:5|4(?!04))\"\nSecAuditLogParts ABIJDEFHZ\nSecAuditLogType Serial\nSecAuditLog /var/log/nginx/modsec_audit.log\n", 420, 0, 0, NOW - 10 * DAY);
    putRoot(sys, "/usr/share/modsecurity-crs/crs-setup.conf", "# OWASP CRS 3.3.5 setup (excerpt)\nSecDefaultAction \"phase:1,log,auditlog,pass\"\nSecDefaultAction \"phase:2,log,auditlog,pass\"\n# Paranoia level 1 (default)\nSecAction \"id:900000,phase:1,nolog,pass,t:none,setvar:tx.paranoia_level=1\"\n# Block when the inbound anomaly score reaches 5\nSecAction \"id:900110,phase:1,nolog,pass,t:none,setvar:tx.inbound_anomaly_score_threshold=5\"\n", 420, 0, 0, NOW - 10 * DAY);
    CRS.concat([{ file: "REQUEST-949-BLOCKING-EVALUATION.conf" }]).forEach(function (r) { putRoot(sys, "/usr/share/modsecurity-crs/rules/" + r.file, "# OWASP CRS 3.3.5: " + r.file + " (rules not shown in the lab)\n", 420, 0, 0, NOW - 60 * DAY); });
    putRoot(sys, "/var/log/nginx/modsec_audit.log", "", 416, 33, 4);
  };
  M2.CATALOG.push({ name: "libnginx-mod-http-modsecurity", ver: "1.0.3-1build3", arch: "amd64", section: "httpd", size: 120, desc: "ModSecurity v3 connector for nginx", deps: [], bins: [], sbins: [], installed: false, auto: false, archive: "noble" },
    { name: "modsecurity-crs", ver: "3.3.5-2", arch: "all", section: "web", size: 600, desc: "OWASP ModSecurity Core Rule Set", deps: [], bins: [], sbins: [], installed: false, auto: false, archive: "noble" },
    { name: "squid", ver: "6.10-1ubuntu1", arch: "amd64", section: "web", size: 9000, desc: "Full featured Web Proxy cache (HTTP proxy)", deps: [], bins: [], sbins: ["squid"], installed: false, auto: false, archive: "noble" });

  /* ================================================================== a CDN in front of the origin */
  var EDGE = "192.0.2.80", EDGE_SRC = "192.0.2.140", CDN_RANGE = "192.0.2.128/25";
  HOSTS[EDGE] = { ping: 4.1, ports: [80, 443] };
  var prevPreHttp2 = N.preHttp;
  N.preHttp = function (sys, ip, port, req) {
    // the office and the internet scanner talk to kc-web-01's own nginx
    if (N.isRemote(sys) && sys.vantage !== "cloud" && (ip === W.PUB || ip === ME)) { var h0 = N.homeOf(sys); if (h0) return N.httpTo(h0, ip, port, req); }
    if (ip === EDGE) {
      var home = N.homeOf(sys) || sys, d = new Date(sys.now);
      var hdr = { "Content-Type": "text/html", Server: "KCDN", Via: "1.1 lhr-edge-07 (KCDN)", "X-Cache": "Error from kcdn" };
      var fv = N.fwVerdict(home, EDGE_SRC, port, "tcp", false, ME);
      if (fv !== "accept") return { status: 504, headers: hdr, body: "<html><body><h1>504 Gateway Timeout</h1><p>The CDN couldn't reach the origin server.</p><p>Edge: lhr-edge-07</p></body></html>\n" };
      var res = M2.httpRequest(home, Object.assign({}, req, { resolveTo: "10.20.0.15", port: port, headers: Object.assign({}, req.headers, { "x-forwarded-for": "198.51.100.200", via: "1.1 lhr-edge-07 (KCDN)" }) }));
      if (res.err) return { status: 502, headers: hdr, body: "<html><body><h1>502 Bad Gateway</h1><p>The origin didn't answer.</p></body></html>\n" };
      var h2 = Object.assign({}, res.headers, { Via: "1.1 lhr-edge-07 (KCDN)", "X-Cache": "Miss from kcdn" }); delete h2["Content-Length"]; delete h2.Connection;
      return { status: res.status, headers: h2, body: res.body };
    }
    return prevPreHttp2 ? prevPreHttp2(sys, ip, port, req) : null;
  };
  N.CDN = { EDGE: EDGE, EDGE_SRC: EDGE_SRC, RANGE: CDN_RANGE };

  /* ================================================================== Terraform (HCL) */
  function TfErr(title, detail, file, line, ctx) { this.title = title; this.detail = detail; this.file = file; this.line = line; this.ctx = ctx; }
  function hclLex(text, file) {
    var t = [], i = 0, line = 1;
    while (i < text.length) {
      var ch = text.charAt(i);
      if (ch === "\n") { t.push({ t: "nl", line: line }); line++; i++; continue; }
      if (/[ \t\r]/.test(ch)) { i++; continue; }
      if (ch === "#" || text.substr(i, 2) === "//") { var e = text.indexOf("\n", i); var com = text.slice(i, e < 0 ? text.length : e); t.push({ t: "comment", v: com, line: line }); i = e < 0 ? text.length : e; continue; }
      if (text.substr(i, 2) === "/*") { var e2 = text.indexOf("*/", i + 2); var blk = text.slice(i, e2 < 0 ? text.length : e2 + 2); line += (blk.match(/\n/g) || []).length; i = e2 < 0 ? text.length : e2 + 2; continue; }
      if (ch === "\"") { var j = i + 1, s = ""; while (j < text.length && text.charAt(j) !== "\"") { if (text.charAt(j) === "\\") { s += text.charAt(j + 1) === "n" ? "\n" : text.charAt(j + 1); j += 2; continue; } if (text.charAt(j) === "\n") throw new TfErr("Unterminated template string", "No closing marker was found for the string.", file, line); s += text.charAt(j); j++; } t.push({ t: "str", v: s, line: line }); i = j + 1; continue; }
      if (/[0-9]/.test(ch) || (ch === "-" && /[0-9]/.test(text.charAt(i + 1)))) { var k = i + 1; while (k < text.length && /[0-9.]/.test(text.charAt(k))) k++; t.push({ t: "num", v: +text.slice(i, k), line: line }); i = k; continue; }
      if (/[A-Za-z_]/.test(ch)) { var m = i; while (m < text.length && /[A-Za-z0-9_-]/.test(text.charAt(m))) m++; t.push({ t: "id", v: text.slice(i, m), line: line }); i = m; continue; }
      if ("{}[]=,().:".indexOf(ch) >= 0) { t.push({ t: ch, line: line }); i++; continue; }
      throw new TfErr("Invalid character", "This character is not used within the language.", file, line);
    }
    t.push({ t: "eof", line: line });
    return t;
  }
  function hclParse(text, file) {
    var toks = hclLex(text, file), p = 0, comments = toks.filter(function (x) { return x.t === "comment"; });
    toks = toks.filter(function (x) { return x.t !== "comment"; });
    function peek() { return toks[p]; } function next() { return toks[p++]; }
    function skipNl() { while (peek().t === "nl") p++; }
    function expr() {
      var tk = next();
      if (tk.t === "str") return { k: "str", v: tk.v, line: tk.line };
      if (tk.t === "num") return { k: "num", v: tk.v };
      if (tk.t === "id" && (tk.v === "true" || tk.v === "false")) return { k: "bool", v: tk.v === "true" };
      if (tk.t === "[") { var items = []; skipNl(); while (peek().t !== "]") { items.push(expr()); skipNl(); if (peek().t === ",") { next(); skipNl(); } else if (peek().t !== "]") throw new TfErr("Missing item separator", "Expected a comma to mark the beginning of the next item.", file, peek().line); } next(); return { k: "list", items: items }; }
      if (tk.t === "{") { var obj = {}; skipNl(); while (peek().t !== "}") { var kt = next(); if (kt.t !== "id" && kt.t !== "str") throw new TfErr("Invalid object key", "", file, kt.line); if (next().t !== "=" ) throw new TfErr("Missing key/value separator", "Expected an equals sign (\"=\") to mark the beginning of the attribute value.", file, kt.line); obj[kt.v] = expr(); skipNl(); if (peek().t === ",") next(); skipNl(); } next(); return { k: "obj", v: obj }; }
      if (tk.t === "id") {
        if (peek().t === "(") { next(); var args = []; while (peek().t !== ")") { args.push(expr()); if (peek().t === ",") next(); } next(); return { k: "call", n: tk.v, args: args }; }
        var parts = [tk.v];
        while (peek().t === "." || peek().t === "[") { if (next().t === ".") parts.push(next().v); else { parts.push(expr()); next(); } }
        return { k: "ref", parts: parts, line: tk.line };
      }
      throw new TfErr("Invalid expression", "Expected the start of an expression, but found an invalid expression token.", file, tk.line);
    }
    function body(end) {
      var attrs = {}, blocks = [], order = [];
      skipNl();
      while (peek().t !== end) {
        var tk = next();
        if (tk.t !== "id") throw new TfErr("Argument or block definition required", "An argument or block definition is required here.", file, tk.line);
        if (peek().t === "=") { next(); var v = expr(); v.line = tk.line; attrs[tk.v] = v; order.push(tk.v); if (peek().t !== "nl" && peek().t !== end && peek().t !== "eof") throw new TfErr("Missing newline after argument", "An argument definition must end with a newline.", file, tk.line); }
        else {
          var labels = []; while (peek().t === "str" || peek().t === "id") labels.push(next().v);
          if (next().t !== "{") throw new TfErr("Invalid block definition", "A block definition must have block content delimited by \"{\" and \"}\", starting on the same line as the block header.", file, tk.line);
          var b = body("}"); var endTok = next(); b.type = tk.v; b.labels = labels; b.line = tk.line; b.end = endTok.line; blocks.push(b);
        }
        skipNl();
        if (peek().t === "eof" && end !== "eof") throw new TfErr("Unclosed configuration block", "There is no closing brace for this block before the end of the file. This may be caused by incorrect brace nesting elsewhere in this file.", file, tk.line);
      }
      return { attrs: attrs, blocks: blocks, order: order };
    }
    var top = body("eof");
    top.comments = comments;
    return top;
  }
  var SG_ARGS = { name: 1, description: 1, vpc_id: 1, ingress: 1, egress: 1, tags: 1, name_prefix: 1, revoke_rules_on_delete: 1, lifecycle: 1 }, RULE_ARGS = { from_port: 1, to_port: 1, protocol: 1, cidr_blocks: 1, ipv6_cidr_blocks: 1, security_groups: 1, self: 1, description: 1, prefix_list_ids: 1 };
  function suggest(n, keys) { var best = null; keys.forEach(function (k) { if (!best && (k.indexOf(n) === 0 || n.indexOf(k) === 0 || (Math.abs(k.length - n.length) <= 2 && k.slice(0, 4) === n.slice(0, 4)))) best = k; }); return best; }
  function tfLoad(sess, dir) {
    var node = S.lookup(sess, dir).node; if (!node || node.type !== "d") return { err: new TfErr("No configuration files", "Apply requires configuration to be present.", null, null) };
    var files = Object.keys(node.children).filter(function (f) { return /\.tf$/.test(f); }).sort(), res = { files: {}, resources: [], vars: {}, data: [], dir: dir };
    if (!files.length) return { err: new TfErr("No configuration files", "Plan requires configuration to be present. Planning without a configuration would mark everything for destruction, which is normally not what is desired.", null, null) };
    try {
      files.forEach(function (f) {
        var text = node.children[f].content || "", ast = hclParse(text, f);
        res.files[f] = { text: text, ast: ast };
        ast.blocks.forEach(function (b) {
          if (b.type === "resource") res.resources.push({ type: b.labels[0], name: b.labels[1], b: b, file: f, text: text, comments: ast.comments.filter(function (c) { return c.line >= b.line && c.line <= b.end; }) });
          else if (b.type === "variable") res.vars[b.labels[0]] = b.attrs["default"] ? lit(b.attrs["default"]) : null;
          else if (b.type === "data") res.data.push({ type: b.labels[0], name: b.labels[1] });
        });
      });
    } catch (e) { if (e instanceof TfErr) return { err: e }; throw e; }
    return res;
  }
  function lit(e) { if (!e) return null; if (e.k === "str" || e.k === "num" || e.k === "bool") return e.v; if (e.k === "list") return e.items.map(lit); if (e.k === "obj") { var o = {}; Object.keys(e.v).forEach(function (k) { o[k] = lit(e.v[k]); }); return o; } return null; }
  function tfValidate(cfg, state) {
    var errs = [];
    cfg.resources.forEach(function (r) {
      if (r.type !== "aws_security_group") return;
      Object.keys(r.b.attrs).forEach(function (k) { if (!SG_ARGS[k]) errs.push(new TfErr("Unsupported argument", "An argument named \"" + k + "\" is not expected here." + (suggest(k, Object.keys(SG_ARGS)) ? " Did you mean \"" + suggest(k, Object.keys(SG_ARGS)) + "\"?" : ""), r.file, r.b.attrs[k].line, "resource \"" + r.type + "\" \"" + r.name + "\"")); });
      r.b.blocks.forEach(function (bb) {
        if (bb.type !== "ingress" && bb.type !== "egress" && bb.type !== "lifecycle") { errs.push(new TfErr("Unsupported block type", "Blocks of type \"" + bb.type + "\" are not expected here.", r.file, bb.line, "resource \"" + r.type + "\" \"" + r.name + "\"")); return; }
        if (bb.type === "lifecycle") return;
        Object.keys(bb.attrs).forEach(function (k) { if (!RULE_ARGS[k]) errs.push(new TfErr("Unsupported argument", "An argument named \"" + k + "\" is not expected here." + (suggest(k, Object.keys(RULE_ARGS)) ? " Did you mean \"" + suggest(k, Object.keys(RULE_ARGS)) + "\"?" : ""), r.file, bb.attrs[k].line, "resource \"" + r.type + "\" \"" + r.name + "\"")); });
        ["from_port", "to_port", "protocol"].forEach(function (k) { if (!bb.attrs[k]) errs.push(new TfErr("Missing required argument", "The argument \"" + k + "\" is required, but no definition was found.", r.file, bb.line, "resource \"" + r.type + "\" \"" + r.name + "\"")); });
      });
      walkRefs(r.b, function (ref) {
        if (ref.parts[0] === "var" && !(ref.parts[1] in cfg.vars)) { var sg = suggest(ref.parts[1], Object.keys(cfg.vars)); errs.push(new TfErr("Reference to undeclared input variable", "An input variable with the name \"" + ref.parts[1] + "\" has not been declared." + (sg ? " Did you mean \"" + sg + "\"?" : " This variable can be declared with a variable \"" + ref.parts[1] + "\" {} block."), r.file, ref.line, "resource \"" + r.type + "\" \"" + r.name + "\"")); }
        if (/^aws_/.test(ref.parts[0]) && !cfg.resources.some(function (x) { return x.type === ref.parts[0] && x.name === ref.parts[1]; })) errs.push(new TfErr("Reference to undeclared resource", "A managed resource \"" + ref.parts[0] + "\" \"" + ref.parts[1] + "\" has not been declared in the root module.", r.file, ref.line, "resource \"" + r.type + "\" \"" + r.name + "\""));
      });
    });
    return errs;
  }
  function walkRefs(b, fn) { function w(e) { if (!e) return; if (e.k === "ref") fn(e); if (e.k === "list") e.items.forEach(w); if (e.k === "obj") Object.keys(e.v).forEach(function (k) { w(e.v[k]); }); if (e.k === "call") e.args.forEach(w); } Object.keys(b.attrs).forEach(function (k) { w(b.attrs[k]); }); b.blocks.forEach(function (x) { walkRefs(x, fn); }); }
  function evalE(e, cfg, state) {
    if (!e) return null;
    if (e.k === "str") return e.v.replace(/\$\{([^}]+)\}/g, function (m0, inner) { var v = evalE({ k: "ref", parts: inner.trim().split(".") }, cfg, state); return v == null ? "" : v; });
    if (e.k === "num" || e.k === "bool") return e.v;
    if (e.k === "list") { var out2 = []; e.items.forEach(function (x) { var v = evalE(x, cfg, state); if (Array.isArray(v) && x.k === "ref" && false) out2 = out2.concat(v); else out2.push(v); }); return out2; }
    if (e.k === "obj") { var o = {}; Object.keys(e.v).forEach(function (k) { o[k] = evalE(e.v[k], cfg, state); }); return o; }
    if (e.k === "ref") {
      if (e.parts[0] === "var") return cfg.vars[e.parts[1]];
      if (e.parts[0] === "data") { var ds = (state.resources || []).filter(function (x) { return x.mode === "data" && x.type === e.parts[1] && x.name === e.parts[2]; })[0]; return ds ? ds.instances[0].attributes[e.parts[3] || "id"] : null; }
      var rs = (state.resources || []).filter(function (x) { return x.mode === "managed" && x.type === e.parts[0] && x.name === e.parts[1]; })[0];
      return rs ? rs.instances[0].attributes[e.parts[2] || "id"] : "(known after apply)";
    }
    return null;
  }
  function desiredSg(r, cfg, state) {
    var b = r.b, out2 = { name: evalE(b.attrs.name, cfg, state), description: evalE(b.attrs.description, cfg, state) || "Managed by Terraform", vpc_id: evalE(b.attrs.vpc_id, cfg, state), ingress: [], egress: [], tags: evalE(b.attrs.tags, cfg, state) || {} };
    b.blocks.forEach(function (bb) {
      if (bb.type !== "ingress" && bb.type !== "egress") return;
      out2[bb.type].push({ cidr_blocks: evalE(bb.attrs.cidr_blocks, cfg, state) || [], description: evalE(bb.attrs.description, cfg, state) || "", from_port: evalE(bb.attrs.from_port, cfg, state), ipv6_cidr_blocks: evalE(bb.attrs.ipv6_cidr_blocks, cfg, state) || [], prefix_list_ids: [], protocol: String(evalE(bb.attrs.protocol, cfg, state)), security_groups: evalE(bb.attrs.security_groups, cfg, state) || [], self: !!evalE(bb.attrs.self, cfg, state), to_port: evalE(bb.attrs.to_port, cfg, state) });
    });
    function canon(list) { return list.map(function (x) { x.cidr_blocks = x.cidr_blocks.slice().sort(); x.security_groups = x.security_groups.slice().sort(); return x; }).sort(function (a, c) { return JSON.stringify(a) < JSON.stringify(c) ? -1 : 1; }); }
    out2.ingress = canon(out2.ingress); out2.egress = canon(out2.egress);
    return out2;
  }
  function stateOf(sess, dir) { var t = readAs(sess, dir + "/terraform.tfstate"); try { return t ? JSON.parse(t) : { version: 4, resources: [] }; } catch (e) { return { version: 4, resources: [] }; } }
  function stateRes(state, type, name) { return (state.resources || []).filter(function (x) { return x.mode === "managed" && x.type === type && x.name === name; })[0]; }
  function tfErrOut(io, e) { errl(io, "╷\n│ Error: " + e.title + "\n│ " + (e.file ? "\n│   on " + e.file + " line " + e.line + (e.ctx ? ", in " + e.ctx : "") + ":\n│ " : "") + "\n│ " + e.detail.replace(/\n/g, "\n│ ") + "\n╵"); }
  function ruleLines(r, sign, ind) {
    var L = [ind + sign + " {"];
    var keys = ["cidr_blocks", "description", "from_port", "ipv6_cidr_blocks", "prefix_list_ids", "protocol", "security_groups", "self", "to_port"];
    keys.forEach(function (k) {
      var v = r[k];
      if (Array.isArray(v)) { if (!v.length) { L.push(ind + "    " + sign + " " + rp(k, 16) + " = []"); return; } L.push(ind + "    " + sign + " " + rp(k, 16) + " = ["); v.forEach(function (x) { L.push(ind + "        " + sign + " \"" + x + "\","); }); L.push(ind + "      ]"); return; }
      L.push(ind + "    " + sign + " " + rp(k, 16) + " = " + (typeof v === "string" ? "\"" + v + "\"" : String(v)));
    });
    L.push(ind + "  },");
    return L;
  }
  function planOf(cfg, state) {
    var changes = [];
    cfg.resources.forEach(function (r) {
      if (r.type !== "aws_security_group") return;
      var st = stateRes(state, r.type, r.name), want = desiredSg(r, cfg, state);
      if (!st) { changes.push({ r: r, action: "create", want: want }); return; }
      var cur = st.instances[0].attributes, diffs = {};
      ["ingress", "egress"].forEach(function (k) {
        var a = cur[k].map(function (x) { return JSON.stringify(x); }), b2 = want[k].map(function (x) { return JSON.stringify(x); });
        var gone = cur[k].filter(function (x, i) { return b2.indexOf(a[i]) < 0; }), added = want[k].filter(function (x, i) { return a.indexOf(b2[i]) < 0; });
        if (gone.length || added.length) diffs[k] = { gone: gone, added: added };
      });
      ["name", "description"].forEach(function (k) { if (cur[k] !== want[k]) diffs[k] = { from: cur[k], to: want[k], replace: true }; });
      if (Object.keys(diffs).length) changes.push({ r: r, action: Object.keys(diffs).some(function (k) { return diffs[k].replace; }) ? "replace" : "update", diffs: diffs, cur: cur, want: want });
    });
    (state.resources || []).forEach(function (s) { if (s.mode === "managed" && !cfg.resources.some(function (r) { return r.type === s.type && r.name === s.name; })) changes.push({ gone: s, action: "delete" }); });
    return changes;
  }
  function printPlan(io, cfg, state, changes) {
    var L = [];
    (state.resources || []).forEach(function (s) { if (s.mode === "data") L.push("data." + s.type + "." + s.name + ": Reading..."); });
    (state.resources || []).forEach(function (s) { if (s.mode === "data") L.push("data." + s.type + "." + s.name + ": Read complete after 0s [id=" + s.instances[0].attributes.id + "]"); });
    (state.resources || []).forEach(function (s) { if (s.mode === "managed") L.push(s.type + "." + s.name + ": Refreshing state... [id=" + s.instances[0].attributes.id + "]"); });
    L.push("");
    if (!changes.length) { L.push("No changes. Your infrastructure matches the configuration.", "", "Terraform has compared your real infrastructure against your configuration and", "found no differences, so no changes are needed."); out(io, L.join("\n") + "\n"); return; }
    L.push("Terraform used the selected providers to generate the following execution", "plan. Resource actions are indicated with the following symbols:");
    if (changes.some(function (c) { return c.action === "create"; })) L.push("  + create");
    if (changes.some(function (c) { return c.action === "update"; })) L.push("  ~ update in-place");
    if (changes.some(function (c) { return c.action === "replace"; })) L.push("-/+ destroy and then create replacement");
    if (changes.some(function (c) { return c.action === "delete"; })) L.push("  - destroy");
    L.push("", "Terraform will perform the following actions:", "");
    changes.forEach(function (c) {
      if (c.action === "delete") { L.push("  # " + c.gone.type + "." + c.gone.name + " will be destroyed", "  - resource \"" + c.gone.type + "\" \"" + c.gone.name + "\" {", "      - id = \"" + c.gone.instances[0].attributes.id + "\"", "    }", ""); return; }
      var addr = c.r.type + "." + c.r.name;
      if (c.action === "create") { L.push("  # " + addr + " will be created", "  + resource \"" + c.r.type + "\" \"" + c.r.name + "\" {", "      + id                     = (known after apply)", "      + name                   = \"" + c.want.name + "\"", "    }", ""); return; }
      L.push("  # " + addr + (c.action === "replace" ? " must be replaced" : " will be updated in-place"), (c.action === "replace" ? "-/+" : "  ~") + " resource \"" + c.r.type + "\" \"" + c.r.name + "\" {", "        id                     = \"" + c.cur.id + "\"");
      ["ingress", "egress"].forEach(function (k) {
        var dd = c.diffs[k]; if (!dd) return;
        L.push("      ~ " + rp(k, 22) + " = [");
        dd.gone.forEach(function (x) { L = L.concat(ruleLines(x, "-", "          ")); });
        dd.added.forEach(function (x) { L = L.concat(ruleLines(x, "+", "          ")); });
        var same = c.want[k].length - dd.added.length;
        if (same > 0) L.push("            # (" + same + " unchanged element" + (same === 1 ? "" : "s") + " hidden)");
        L.push("        ]");
      });
      ["name", "description"].forEach(function (k) { var dd = c.diffs[k]; if (dd) L.push("      ~ " + rp(k, 22) + " = \"" + dd.from + "\" -> \"" + dd.to + "\" # forces replacement"); });
      L.push("        # (5 unchanged attributes hidden)", "    }", "");
    });
    var add = changes.filter(function (c) { return c.action === "create" || c.action === "replace"; }).length, chg = changes.filter(function (c) { return c.action === "update"; }).length, del = changes.filter(function (c) { return c.action === "delete" || c.action === "replace"; }).length;
    L.push("Plan: " + add + " to add, " + chg + " to change, " + del + " to destroy.");
    out(io, L.join("\n") + "\n");
    return { add: add, chg: chg, del: del };
  }
  // copy the desired rules to the cloud and to the state file
  function applyChanges(sess, dir, cfg, state, changes, io) {
    var c = N.cloud.of(sess.sys), L = [];
    changes.forEach(function (ch) {
      if (ch.action !== "update") return;
      var st = stateRes(state, ch.r.type, ch.r.name), id = st.instances[0].attributes.id, addr = ch.r.type + "." + ch.r.name;
      L.push(addr + ": Modifying... [id=" + id + "]");
      var g = c && N.cloud.sgNamed(c, id);
      if (g) {
        g.rules = [];
        ["ingress", "egress"].forEach(function (k) { ch.want[k].forEach(function (x) { var proto = x.protocol === "-1" || x.protocol === "all" ? "-1" : x.protocol; var fr = proto === "-1" ? null : x.from_port, to = proto === "-1" ? null : x.to_port; x.cidr_blocks.forEach(function (cb) { N.cloud.addRule(g, N.cloud.rule(k === "egress", proto, fr, to, cb, x.description || null)); }); x.security_groups.forEach(function (sg) { N.cloud.addRule(g, N.cloud.rule(k === "egress", proto, fr, to, sg, x.description || null)); }); }); });
      }
      st.instances[0].attributes.ingress = ch.want.ingress; st.instances[0].attributes.egress = ch.want.egress;
      L.push(addr + ": Modifications complete after 1s [id=" + id + "]");
    });
    state.serial = (state.serial || 1) + 1;
    writeAs(sess, dir + "/terraform.tfstate", JSON.stringify(state, null, 2) + "\n");
    var n = changes.filter(function (x) { return x.action === "update"; }).length;
    out(io, L.join("\n") + (L.length ? "\n" : "") + "\nApply complete! Resources: 0 added, " + n + " changed, 0 destroyed.\n");
  }
  CMDS.terraform = function (args, io, sess) {
    var a = args.slice(1), dir = sess.cwd;
    a = a.filter(function (x) { if (/^-chdir=/.test(x)) { dir = x.slice(7).replace(/^~/, "/home/" + sess.user); if (dir.charAt(0) !== "/") dir = sess.cwd.replace(/\/$/, "") + "/" + dir; return false; } return true; });
    var sub = a[0], rest = a.slice(1);
    if (!sub || sub === "-help" || sub === "--help") { out(io, "Usage: terraform [global options] <subcommand> [args]\n\nMain commands:\n  init          Prepare your working directory for other commands\n  validate      Check whether the configuration is valid\n  plan          Show changes required by the current configuration\n  apply         Create or update infrastructure\n  destroy       Destroy previously-created infrastructure\n\nAll other commands:\n  fmt           Reformat your configuration in the standard style\n  show          Show the current state or a saved plan\n  state         Advanced state management\n"); return sub ? 0 : 127; }
    if (sub === "version" || sub === "-version") { out(io, "Terraform v1.9.8\non linux_amd64\n+ provider registry.terraform.io/hashicorp/aws v5.74.0\n"); return 0; }
    var inited = !!S.lookup(sess, dir + "/.terraform").node;
    if (sub === "init") { S.mkdirs(sess.sys, dir + "/.terraform/providers", 493, sess.uid, sess.gid); out(io, "\nInitializing the backend...\nInitializing provider plugins...\n- Reusing previous version of hashicorp/aws from the dependency lock file\n- Using previously-installed hashicorp/aws v5.74.0\n\nTerraform has been successfully initialized!\n\nYou may now begin working with Terraform. Try running \"terraform plan\" to see\nany changes that are required for your infrastructure. All Terraform commands\nshould now work.\n"); return 0; }
    var cfg = tfLoad(sess, dir);
    if (cfg.err) { tfErrOut(io, cfg.err); return 1; }
    if (sub === "fmt") {
      var check = rest.indexOf("-check") >= 0, bad = [];
      Object.keys(cfg.files).forEach(function (f) { var t = cfg.files[f].text, fx = tfFmt(t); if (fx !== t) { bad.push(f); if (!check) writeAs(sess, dir + "/" + f, fx); } });
      if (bad.length) out(io, bad.join("\n") + "\n");
      return check && bad.length ? 3 : 0;
    }
    var state = stateOf(sess, dir), errs = tfValidate(cfg, state);
    if (sub === "validate") { if (errs.length) { errs.forEach(function (e) { tfErrOut(io, e); }); return 1; } out(io, "Success! The configuration is valid.\n\n"); return 0; }
    if (!inited && (sub === "plan" || sub === "apply")) { tfErrOut(io, new TfErr("Inconsistent dependency lock file", "The following dependency selections recorded in the lock file are inconsistent with the current configuration:\n  - provider registry.terraform.io/hashicorp/aws: required by this configuration but no version is selected\n\nTo make the initial dependency selections that will initialize the dependency lock file, run:\n  terraform init")); return 1; }
    if (sub === "plan" || sub === "apply") {
      if (errs.length) { errs.forEach(function (e) { tfErrOut(io, e); }); return 1; }
      var changes = planOf(cfg, state);
      if (changes.some(function (c) { return c.action !== "update"; })) { printPlan(io, cfg, state, changes); errl(io, "\n(This lab only applies in-place changes to security groups. Rename or delete nothing.)"); return 1; }
      printPlan(io, cfg, state, changes);
      if (sub === "plan") { if (rest.indexOf("-detailed-exitcode") >= 0 && changes.length) return 2; if (changes.length) out(io, "\n─────────────────────────────────────────────────────────────────────────────\n\nNote: You didn't use the -out option to save this plan, so Terraform can't\nguarantee to take exactly these actions if you run \"terraform apply\" now.\n"); return 0; }
      if (!changes.length) { out(io, "\nApply complete! Resources: 0 added, 0 changed, 0 destroyed.\n"); return 0; }
      if (rest.indexOf("-auto-approve") < 0) { out(io, "\nDo you want to perform these actions?\n  Terraform will perform the actions described above.\n  Only 'yes' will be accepted to approve.\n\n  Enter a value: \n"); errl(io, "\nError: error asking for approval: no terminal input\n"); note(io, "(The lab can't type 'yes' for you. Run terraform apply -auto-approve once you've read the plan.)"); return 1; }
      out(io, "\n"); applyChanges(sess, dir, cfg, state, changes, io); return 0;
    }
    if (sub === "state" && rest[0] === "list") { out(io, (state.resources || []).map(function (s) { return (s.mode === "data" ? "data." : "") + s.type + "." + s.name + "\n"; }).join("")); return 0; }
    if (sub === "show") { out(io, (state.resources || []).filter(function (s) { return s.mode === "managed"; }).map(function (s) { var at = s.instances[0].attributes; return "# " + s.type + "." + s.name + ":\nresource \"" + s.type + "\" \"" + s.name + "\" {\n    id          = \"" + at.id + "\"\n    name        = \"" + at.name + "\"\n    ingress     = " + JSON.stringify(at.ingress, null, 4).replace(/\n/g, "\n    ") + "\n}\n"; }).join("\n")); return 0; }
    errl(io, "Terraform has no command named \"" + sub + "\".\n\nTo see all of Terraform's top-level commands, run:\n  terraform -help"); return 1;
  };
  // terraform fmt: two-space indentation and aligned equals signs within each group of attribute lines
  function tfFmt(text) {
    var lines = text.replace(/\t/g, "  ").split("\n"), depth = 0, outL = [];
    lines.forEach(function (l) {
      var t = l.trim();
      if (/^[}\]]/.test(t)) depth = Math.max(0, depth - 1);
      outL.push(t ? "  ".repeat(depth) + t : "");
      var opens = (t.replace(/"[^"]*"/g, "").match(/[{[]/g) || []).length, closes = (t.replace(/"[^"]*"/g, "").match(/[}\]]/g) || []).length;
      depth += opens - closes + (/^[}\]]/.test(t) ? 1 : 0);
    });
    var res = [], grp = [];
    function flush() { var w = Math.max.apply(null, grp.map(function (g) { return g.k.length; })); grp.forEach(function (g) { res.push(g.ind + rp(g.k, w) + " = " + g.v); }); grp = []; }
    outL.forEach(function (l) {
      var m = /^(\s*)([\w-]+)\s*=\s*(.*)$/.exec(l);
      if (m && !/[{[]\s*$/.test(m[3]) && (!grp.length || grp[0].ind === m[1])) { grp.push({ ind: m[1], k: m[2], v: m[3] }); return; }
      if (grp.length) flush();
      if (m && !/[{[]\s*$/.test(m[3])) { grp.push({ ind: m[1], k: m[2], v: m[3] }); return; }
      res.push(l);
    });
    if (grp.length) flush();
    return res.join("\n");
  }
  // a lab's starting point: the cloud's security groups and the state file both match the configuration in dir
  function tfSeed(sys, dir) {
    var sess = { sys: sys, uid: 0, gid: 0, groups: [0], cwd: dir, user: "root" }, cfg = tfLoad(sess, dir), c = N.cloud.of(sys);
    var state = { version: 4, terraform_version: "1.9.8", serial: 7, lineage: "5c1d2e7a-" + M2.hexOf("lin", 4) + "-4b1e-9d2f-" + M2.hexOf("lineage", 12), outputs: {}, resources: [] };
    state.resources.push({ mode: "data", type: "aws_vpc", name: "prod", provider: "provider[\"registry.terraform.io/hashicorp/aws\"]", instances: [{ schema_version: 0, attributes: { id: c.vpc.VpcId, cidr_block: c.vpc.CidrBlock } }] });
    cfg.resources.forEach(function (r) { if (r.type !== "aws_security_group") return; var nm = lit(r.b.attrs.name), g = N.cloud.sgNamed(c, nm); state.resources.push({ mode: "managed", type: r.type, name: r.name, provider: "provider[\"registry.terraform.io/hashicorp/aws\"]", instances: [{ schema_version: 1, attributes: { id: g.GroupId, arn: "arn:aws:ec2:" + N.cloud.REGION + ":" + N.cloud.ACCOUNT + ":security-group/" + g.GroupId, name: nm, description: lit(r.b.attrs.description), vpc_id: c.vpc.VpcId, ingress: [], egress: [], tags: { Name: nm } } }] }); });
    var changes = planOf(cfg, state);
    changes.forEach(function (ch) { ch.action = "update"; });
    var quiet = { out: function () {}, err: function () {}, note: function () {} };
    var cwSess = Object.assign({}, sess);
    applyChanges(cwSess, dir, cfg, state, changes, quiet);
    var st = M2.rd(sys, dir + "/terraform.tfstate"); M2.putRoot(sys, dir + "/terraform.tfstate", st, 420, 1000, 1000, NOW - 2 * DAY);
  }
  N.tf = { load: tfLoad, desiredSg: desiredSg, planOf: planOf, stateOf: stateOf, fmt: tfFmt, hclParse: hclParse, seed: tfSeed };

  /* ================================================================== Checkov */
  var CHECKS = [
    { id: "CKV_AWS_23", name: "Ensure every security group and rule has a description", test: function (sg) { return !!sg.description && sg.rules.every(function (r) { return !!r.description; }); } },
    { id: "CKV_AWS_24", name: "Ensure no security groups allow ingress from 0.0.0.0:0 to port 22", test: function (sg) { return !worldTo(sg, 22); } },
    { id: "CKV_AWS_25", name: "Ensure no security groups allow ingress from 0.0.0.0:0 to port 3389", test: function (sg) { return !worldTo(sg, 3389); } },
    { id: "CKV_AWS_260", name: "Ensure no security groups allow ingress from 0.0.0.0:0 to port 80", test: function (sg) { return !worldTo(sg, 80); } },
    { id: "CKV_AWS_277", name: "Ensure no security groups allow ingress from 0.0.0.0:0 to port -1", test: function (sg) { return !sg.rules.some(function (r) { return r.ingress && r.world && (r.protocol === "-1" || r.protocol === "all"); }); } }
  ];
  function worldTo(sg, port) { return sg.rules.some(function (r) { return r.ingress && r.world && (r.protocol === "-1" || r.protocol === "all" || (+r.from <= port && port <= +r.to)); }); }
  function ckSg(r, cfg) {
    var b = r.b, rules = [];
    b.blocks.forEach(function (bb) {
      if (bb.type !== "ingress" && bb.type !== "egress") return;
      var cb = lit(bb.attrs.cidr_blocks) || [], v6 = lit(bb.attrs.ipv6_cidr_blocks) || [];
      rules.push({ ingress: bb.type === "ingress", world: cb.indexOf("0.0.0.0/0") >= 0 || v6.indexOf("::/0") >= 0, from: lit(bb.attrs.from_port), to: lit(bb.attrs.to_port), protocol: String(lit(bb.attrs.protocol)), description: lit(bb.attrs.description) });
    });
    var skips = {};
    r.comments.forEach(function (c) { var m = /checkov:skip=([A-Z0-9_]+)(?::(.*))?/.exec(c.v); if (m) skips[m[1]] = (m[2] || "").trim() || "No comment provided"; });
    return { description: lit(b.attrs.description), rules: rules, skips: skips };
  }
  function ckEval(cfg, file, only, skip) {
    var res = { passed: [], failed: [], skipped: [] };
    cfg.resources.forEach(function (r) {
      if (file && r.file !== file.replace(/^.*\//, "")) return;
      if (r.type !== "aws_security_group") return;
      var sg = ckSg(r, cfg);
      CHECKS.forEach(function (ck) {
        if (only && only.indexOf(ck.id) < 0) return; if ((skip || []).indexOf(ck.id) >= 0) return;
        var item = { ck: ck, r: r };
        if (sg.skips[ck.id]) { item.why = sg.skips[ck.id]; res.skipped.push(item); return; }
        (ck.test(sg) ? res.passed : res.failed).push(item);
      });
    });
    return res;
  }
  N.checkovEval = function (sys, dir) { var cfg = tfLoad({ sys: sys, uid: 0, gid: 0, groups: [0], cwd: dir, user: "root" }, dir); return cfg.err ? { err: cfg.err } : ckEval(cfg, null, null, []); };
  CMDS.checkov = function (args, io, sess) {
    var a = args.slice(1), dir = null, file = null, compact = false, quiet = false, only = null, skip = [], soft = false, fw = null;
    for (var i = 0; i < a.length; i++) { var x = a[i]; if (x === "-d" || x === "--directory") dir = a[++i]; else if (x === "-f" || x === "--file") file = a[++i]; else if (x === "--compact") compact = true; else if (x === "--quiet") quiet = true; else if (x === "--check" || x === "-c") only = a[++i].split(","); else if (x === "--skip-check") skip = skip.concat(a[++i].split(",")); else if (x === "--soft-fail") soft = true; else if (x === "--framework") fw = a[++i]; else if (x === "-o" || x === "--output") i++; else if (x === "-v" || x === "--version") { out(io, "3.2.255\n"); return 0; } else if (x === "-h" || x === "--help") { out(io, "usage: checkov [-h] [-v] [-d DIRECTORY] [-f FILE [FILE ...]] [--framework FRAMEWORK] [-c CHECK] [--skip-check SKIP_CHECK] [--compact] [--quiet] [--soft-fail]\n"); return 0; } else { errl(io, "checkov: error: unrecognized arguments: " + x); return 2; } }
    if (!dir && !file) { errl(io, "usage: checkov [-h] [-v] [-d DIRECTORY] [-f FILE [FILE ...]] ...\ncheckov: error: at least one of the following arguments are required: -d/--directory, -f/--file"); return 2; }
    var base = (dir || file.replace(/\/[^/]*$/, "") || ".").replace(/^~/, "/home/" + sess.user), cfg = tfLoad(sess, base.charAt(0) === "/" ? base : sess.cwd.replace(/\/$/, "") + "/" + base);
    if (cfg.err && !cfg.files) { out(io, "\n"); return 0; }
    if (cfg.err) { errl(io, "Failed to parse file " + (cfg.err.file || "") + " (line " + cfg.err.line + "): " + cfg.err.title); return 1; }
    var res = ckEval(cfg, file, only, skip);
    var L = ["", "terraform scan results:", "", "Passed checks: " + res.passed.length + ", Failed checks: " + res.failed.length + ", Skipped checks: " + res.skipped.length, ""];
    function block(item, verdict) {
      var r = item.r; L.push("Check: " + item.ck.id + ": \"" + item.ck.name + "\"", "\t" + verdict + " for resource: " + r.type + "." + r.name, "\tFile: /" + r.file + ":" + r.b.line + "-" + r.b.end);
      if (verdict === "SKIPPED") L.push("\tSuppress comment: " + item.why);
      if (verdict === "FAILED" && !compact) { L.push(""); var tl = r.text.split("\n"); for (var n = r.b.line; n <= r.b.end; n++) L.push("\t\t" + rp(n, 3) + "| " + tl[n - 1]); }
      L.push("");
    }
    if (!quiet) res.passed.forEach(function (x) { block(x, "PASSED"); });
    res.failed.forEach(function (x) { block(x, "FAILED"); });
    if (!quiet) res.skipped.forEach(function (x) { block(x, "SKIPPED"); });
    out(io, L.join("\n") + "\n");
    return res.failed.length && !soft ? 1 : 0;
  };
  M2.CATALOG.push({ name: "terraform", ver: "1.9.8-1", arch: "amd64", section: "admin", size: 90000, desc: "Terraform enables you to safely and predictably create, change, and improve infrastructure", deps: [], bins: ["terraform"], sbins: [], installed: false, auto: false, archive: "hashicorp" });
  S.SYS_HOOKS.push(function (sys) { putRoot(sys, "/usr/local/bin/docker", "\x7fELF:docker\n", 493, 0, 0); });
  // tools the M5 labs install into ~/.local/bin (pipx) or /usr/bin
  N.tfLab = function (sys) { M3.preinstall(sys, "terraform"); putRoot(sys, "/usr/local/bin/checkov", "\x7fELF:checkov\n", 493, 0, 0); };
})(typeof window !== "undefined" ? window : globalThis);
