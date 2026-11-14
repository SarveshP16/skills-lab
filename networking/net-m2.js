/* sudo learn — Networking Module 2: ports and traffic. Every network command now puts real packets on the wire
   (built from the event it records), so a capture running in the background (`sudo tcpdump ... &`) sees what you
   do, the way it would on a real server. Also: the machines Module 2 talks to (an old server full of plain-text
   services, a data store, a build host, mail, LDAP, Kubernetes) with their banners and protocol answers;
   /etc/services; tshark; mtr; DHCP on a build network. Loaded after net-pcap.js. */
(function (root) {
  "use strict";
  var S = root.ShEngine, U = S.util, CMDS = S.CMDS, M2 = S.M2, N = M2.NET, W = N.W, P = N.P;
  var out = U.out, errl = U.errl, note = U.note, lines = U.lines, joinLines = U.joinLines, pad = U.pad, rpad = U.rpad, bytes = U.bytes;
  var rd = M2.rd, putRoot = M2.putRoot, hash = M2.hash, tod = M2.tod;
  var NOW = S.NOW, DAY = S.DAY, isV4 = N.isV4, isV6 = N.isV6;

  /* ================================================================== the machines of Module 2 */
  var MACS = { legacy: "f0:1f:af:51:0c:3a", data: "52:54:00:2d:7a:45", build: "52:54:00:83:19:60", k8s: "52:54:00:6b:08:70", ldap: "52:54:00:c4:41:80", buildgw: "52:54:00:12:35:60" };
  var srv = W.SEGS.srv.peers;
  srv["10.20.0.40"] = { name: "kc-legacy-01", node: "legacy", mac: MACS.legacy, rtt: 0.58 };
  srv["10.20.0.45"] = { name: "kc-data-01", node: "data", mac: MACS.data, rtt: 0.44 };
  srv["10.20.0.60"] = { name: "kc-build-01", node: "build", mac: MACS.build, rtt: 0.47 };
  srv["10.20.0.70"] = { name: "kc-k8s-01", node: "k8s", mac: MACS.k8s, rtt: 0.39 };
  srv["10.20.0.80"] = { name: "kc-ldap-01", node: "ldap", mac: MACS.ldap, rtt: 0.41 };
  W.SEGS.build = { name: "build network", net: "10.20.60.0", prefix: 24, dhcp: { "52:54:00:4e:1a:08": "10.20.60.15" }, dhcpServer: "10.20.60.1", dhcpRouter: "10.20.60.1", dhcpDns: "10.20.0.2", peers: { "10.20.60.1": { name: "kc-gw-01", node: "gw", mac: MACS.buildgw, rtt: 0.36, router: "gw" } } };
  W.PORTS["sw-core-01/16"] = { untagged: "build", tagged: {} };
  var DNS = M2.net.DNS;
  [["kc-legacy-01", "10.20.0.40"], ["kc-data-01", "10.20.0.45"], ["kc-build-01", "10.20.0.60"], ["kc-k8s-01", "10.20.0.70"], ["kc-ldap-01", "10.20.0.80"]].forEach(function (h) { DNS[h[0] + ".kestrel.internal"] = { A: [h[1]], internal: true }; W.NAMES[h[1]] = h[0] + ".kestrel.internal"; });
  W.NAMES["203.0.113.25"] = "mail.kestrel.example.com";
  W.NAMES["10.20.60.1"] = "kc-gw-01.kestrel.internal";
  function kca(cn, extra) { return [N.certs.leaf(cn, [cn].concat(extra || []), Date.UTC(2026, 3, 1), Date.UTC(2027, 3, 1), N.certs.KCA, { key: "rsa2048" })]; }
  function le(cn) { return [N.certs.leaf(cn, [cn], Date.UTC(2026, 9, 25), Date.UTC(2027, 0, 23)), N.certs.INTER]; }
  var CRLF = function (t) { return t.replace(/\n/g, "\r\n"); };
  function json(status, obj, extra) { return { status: status, headers: Object.assign({ "Content-Type": "application/json" }, extra || {}), body: JSON.stringify(obj, null, 2) + "\n" }; }
  // port -> { name, banner (sent on connect), talk(input) -> reply, http(req) -> response, tls: chain, udp, filtered }
  var HOSTS = {
    "10.20.0.40": {
      21: { name: "ftp", banner: "220 (vsFTPd 3.0.3)\r\n", talk: function (i) { return /^USER/i.test(i) ? "220 (vsFTPd 3.0.3)\r\n331 Please specify the password.\r\n" : null; } },
      22: { name: "ssh", banner: "SSH-2.0-OpenSSH_7.6p1 Ubuntu-4ubuntu0.7\r\n" },
      23: { name: "telnet", banner: "\r\nUbuntu 18.04.6 LTS\r\nkc-legacy-01 login: " },
      25: { name: "smtp", banner: "220 kc-legacy-01.kestrel.internal ESMTP Postfix (Ubuntu)\r\n", talk: function (i) { return /^(EHLO|HELO)/i.test(i) ? "220 kc-legacy-01.kestrel.internal ESMTP Postfix (Ubuntu)\r\n250-kc-legacy-01.kestrel.internal\r\n250-PIPELINING\r\n250-SIZE 10240000\r\n250-VRFY\r\n250-ETRN\r\n250 8BITMIME\r\n" : null; } },
      80: { name: "http", http: function (req) { return { status: 200, headers: { Server: "Apache/2.4.29 (Ubuntu)", "Content-Type": "text/html" }, body: "<html><body><h1>kc-legacy-01</h1><p>Old intranet. Moved to the wiki.</p></body></html>\n" }; } },
      110: { name: "pop3", banner: "+OK Dovecot (Ubuntu) ready.\r\n" },
      143: { name: "imap", banner: "* OK [CAPABILITY IMAP4rev1 SASL-IR LOGIN-REFERRALS ID ENABLE IDLE LITERAL+ STARTTLS AUTH=PLAIN] Dovecot (Ubuntu) ready.\r\n" },
      445: { name: "microsoft-ds", banner: "" },
      2222: { name: "ssh", banner: "SSH-2.0-OpenSSH_8.2p1 Ubuntu-4ubuntu0.11\r\n" },
      3306: { name: "mysql", banner: "J\n5.7.42-0ubuntu0.18.04.1\u0000\u0016\u0000\u0000\u0000Kp/\u0019\u0007\u000e'\u0000��\b\u0002\u0000��\u0015\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000ZF\u0018\u0011eQ\u0005xbw\u0015\u0004\u0000mysql_native_password\u0000" },
      8081: { name: "http (Jenkins)", http: function () { return { status: 403, headers: { Server: "Jetty(10.0.13)", "X-Jenkins": "2.387.3", "X-Hudson": "1.395", "Content-Type": "text/html;charset=utf-8" }, body: "<html><head><meta http-equiv='refresh' content='1;url=/login?from=%2F'/></head><body>Authentication required</body></html>\n" }; } },
      69: { name: "tftp", udp: true }, 123: { name: "ntp", udp: true }, 161: { name: "snmp", udp: true }
    },
    "10.20.0.45": {
      22: { name: "ssh", banner: "SSH-2.0-OpenSSH_9.6p1 Ubuntu-3ubuntu13.5\r\n" },
      6379: { name: "redis", talk: function (i) {
        var cmds = String(i || "").split(/\r?\n/).filter(Boolean), r = "";
        cmds.forEach(function (c) { c = c.trim().toUpperCase(); if (c === "PING") r += "+PONG\r\n"; else if (/^INFO/.test(c)) { var t = "# Server\r\nredis_version:7.0.15\r\nredis_mode:standalone\r\nos:Linux 6.8.0-48-generic x86_64\r\ntcp_port:6379\r\nuptime_in_days:212\r\nconfig_file:/etc/redis/redis.conf\r\n"; r += "$" + t.length + "\r\n" + t + "\r\n"; } else if (/^KEYS/.test(c)) r += "*3\r\n$22\r\nsession:7c1f0a2e9b3d4c\r\n$22\r\nsession:3a9e5b7d1c0f2e\r\n$13\r\ncart:user:1042\r\n"; else if (c === "QUIT") r += "+OK\r\n"; else r += "-ERR unknown command '" + c.split(" ")[0].toLowerCase() + "', with args beginning with: \r\n"; });
        return r || null;
      } },
      9200: { name: "elasticsearch", http: function (req) {
        var p = req.path.split("?")[0];
        if (p === "/") return json(200, { name: "kc-data-01", cluster_name: "kestrel-logs", cluster_uuid: "pZ4Xc9qkT0e2m8LrV1sNwA", version: { number: "7.10.2", build_flavor: "default", lucene_version: "8.7.0" }, tagline: "You Know, for Search" }, { "X-elastic-product": "Elasticsearch" });
        if (p === "/_cat/indices") return { status: 200, headers: { "Content-Type": "text/plain; charset=UTF-8" }, body: "health status index           uuid                   pri rep docs.count docs.deleted store.size pri.store.size\ngreen  open   customers-2026  Xk2L9qWmRzOa8T1bV0cYdQ   1   0      48211            0     21.3mb         21.3mb\ngreen  open   app-logs-2026.11 7JfP3nQwS2iE5kU8hA1zLg  1   0    1904412            0    602.1mb        602.1mb\n" };
        return json(404, { error: { type: "index_not_found_exception", reason: "no such index" }, status: 404 });
      } },
      27017: { name: "mongodb", http: function () { return { status: 200, headers: { "Content-Type": "text/plain", Connection: "close" }, body: "It looks like you are trying to access MongoDB over HTTP on the native driver port.\n" }; } }
    },
    "10.20.0.60": {
      22: { name: "ssh", banner: "SSH-2.0-OpenSSH_9.6p1 Ubuntu-3ubuntu13.5\r\n" },
      2375: { name: "docker", http: function (req) {
        var p = req.path.split("?")[0];
        if (p === "/version") return json(200, { Platform: { Name: "Docker Engine - Community" }, Version: "27.3.1", ApiVersion: "1.47", Os: "linux", Arch: "amd64", KernelVersion: "6.8.0-48-generic" }, { Server: "Docker/27.3.1 (linux)", "Api-Version": "1.47" });
        if (p === "/containers/json" || /^\/v1\.\d+\/containers\/json$/.test(p)) return { status: 200, headers: { "Content-Type": "application/json", Server: "Docker/27.3.1 (linux)" }, body: "[{\"Id\":\"9f2c1d7a03be\",\"Names\":[\"/jenkins-agent\"],\"Image\":\"jenkins/inbound-agent:3261.v9c670a_4748a_9-1\",\"State\":\"running\"},{\"Id\":\"4b7e0a19c2d5\",\"Names\":[\"/registry\"],\"Image\":\"registry:2\",\"State\":\"running\"}]\n" };
        return json(404, { message: "page not found" }, { Server: "Docker/27.3.1 (linux)" });
      } },
      2376: { name: "docker-s", tls: kca("kc-build-01.kestrel.internal", ["kc-build-01", "10.20.0.60"]), clientCert: true }
    },
    "10.20.0.70": {
      22: { name: "ssh", banner: "SSH-2.0-OpenSSH_9.6p1 Ubuntu-3ubuntu13.5\r\n" },
      6443: { name: "kubernetes", tls: [N.certs.leaf("kube-apiserver", ["kubernetes", "kubernetes.default", "kc-k8s-01.kestrel.internal", "10.20.0.70"], Date.UTC(2026, 4, 2), Date.UTC(2027, 4, 2), "CN = kubernetes", { key: "rsa2048" })], http: function (req) { return json(403, { kind: "Status", apiVersion: "v1", metadata: {}, status: "Failure", message: "forbidden: User \"system:anonymous\" cannot get path \"" + req.path.split("?")[0] + "\"", reason: "Forbidden", details: {}, code: 403 }); } },
      10250: { name: "kubelet", tls: [N.certs.leaf("kc-k8s-01", ["kc-k8s-01"], Date.UTC(2026, 4, 2), Date.UTC(2027, 4, 2), "CN = kc-k8s-01-ca@1777711111", { key: "rsa2048" })], http: function () { return { status: 401, headers: { "Content-Type": "text/plain; charset=utf-8" }, body: "Unauthorized\n" }; } }
    },
    "10.20.0.80": {
      389: { name: "ldap", banner: "" },
      636: { name: "ldaps", tls: kca("kc-ldap-01.kestrel.internal", ["kc-ldap-01"]) }
    },
    "203.0.113.25": {
      25: { name: "smtp", banner: "220 mail.kestrel.example.com ESMTP Postfix (Ubuntu)\r\n" },
      465: { name: "submissions", tls: le("mail.kestrel.example.com") },
      587: { name: "submission", banner: "220 mail.kestrel.example.com ESMTP Postfix (Ubuntu)\r\n", tls: le("mail.kestrel.example.com"), starttls: true },
      110: { name: "pop3", banner: "+OK Dovecot (Ubuntu) ready.\r\n" },
      995: { name: "pop3s", tls: le("mail.kestrel.example.com") },
      143: { name: "imap", banner: "* OK [CAPABILITY IMAP4rev1 SASL-IR LOGIN-REFERRALS ID ENABLE IDLE LITERAL+ STARTTLS AUTH=PLAIN] Dovecot (Ubuntu) ready.\r\n" },
      993: { name: "imaps", tls: le("mail.kestrel.example.com") }
    }
  };
  N.HOSTS2 = HOSTS;
  N.HOSTSVC = function (sys, ip) { var o = sys && sys.nw && sys.nw.hostsvc && sys.nw.hostsvc[ip]; return o || HOSTS[ip] || null; };
  M2.net.HOSTS["203.0.113.25"].ports = [25, 110, 143, 465, 587, 993, 995];
  // what nc prints once connected: the banner, or the answer to what was piped in
  N.talk = function (sys, ip, port, input, tc) {
    var hs = N.HOSTSVC(sys, ip), sv = hs && hs[port];
    if (!sv) return null;
    if (sv.talk && input) { var r = sv.talk(input); if (r != null) return r.replace(/\r\n/g, "\n"); }
    if (sv.http && input && /^[A-Z]+ \S+ HTTP\/\d/.test(input)) return null;   // the HTTP path answers it (rawHttp)
    if (sv.banner != null) return sv.banner.replace(/\r\n/g, "\n") + (sv.banner && !/\n$/.test(sv.banner.replace(/\r\n/g, "\n")) ? "\n" : "");
    if (sv.tls) return "";
    return input ? "" : null;
  };

  /* ================================================================== /etc/services, getent services */
  var SERVICES = [["tcpmux", "1/tcp", "# TCP port service multiplexer"], ["echo", "7/tcp"], ["echo", "7/udp"], ["discard", "9/tcp", "sink null"], ["ftp-data", "20/tcp"], ["ftp", "21/tcp"], ["fsp", "21/udp", "fspd"], ["ssh", "22/tcp", "# SSH Remote Login Protocol"], ["telnet", "23/tcp"], ["smtp", "25/tcp", "mail"], ["time", "37/tcp", "timserver"], ["whois", "43/tcp", "nicname"], ["tacacs", "49/tcp", "# Login Host Protocol (TACACS)"], ["domain", "53/tcp", "# Domain Name Server"], ["domain", "53/udp"], ["bootps", "67/udp"], ["bootpc", "68/udp"], ["tftp", "69/udp"], ["gopher", "70/tcp", "# Internet Gopher"], ["finger", "79/tcp"], ["http", "80/tcp", "www # WorldWideWeb HTTP"], ["kerberos", "88/tcp", "kerberos5 krb5 kerberos-sec # Kerberos v5"], ["kerberos", "88/udp", "kerberos5 krb5 kerberos-sec # Kerberos v5"], ["pop3", "110/tcp", "pop-3 # POP version 3"], ["sunrpc", "111/tcp", "portmapper # RPC 4.0 portmapper"], ["sunrpc", "111/udp", "portmapper"], ["auth", "113/tcp", "authentication tap ident"], ["nntp", "119/tcp", "readnews untp # USENET News Transfer Protocol"], ["ntp", "123/udp", "# Network Time Protocol"], ["epmap", "135/tcp", "loc-srv # DCE endpoint resolution"], ["netbios-ns", "137/udp", "# NETBIOS Name Service"], ["netbios-dgm", "138/udp", "# NETBIOS Datagram Service"], ["netbios-ssn", "139/tcp", "# NETBIOS session service"], ["imap2", "143/tcp", "imap # Interim Mail Access P 2 and 4"], ["snmp", "161/tcp", "# Simple Net Mgmt Protocol"], ["snmp", "161/udp"], ["snmp-trap", "162/tcp", "snmptrap # Traps for SNMP"], ["snmp-trap", "162/udp", "snmptrap"], ["bgp", "179/tcp", "# Border Gateway Protocol"], ["irc", "194/tcp", "# Internet Relay Chat"], ["ldap", "389/tcp", "# Lightweight Directory Access Protocol"], ["ldap", "389/udp"], ["https", "443/tcp", "# http protocol over TLS/SSL"], ["https", "443/udp", "# HTTP/3"], ["microsoft-ds", "445/tcp", "# Microsoft Naked CIFS"], ["kpasswd", "464/tcp"], ["submissions", "465/tcp", "ssmtp smtps urd # Submission over TLS [RFC8314]"], ["syslog", "514/udp"], ["submission", "587/tcp", "# Submission [RFC4409]"], ["ldaps", "636/tcp", "# LDAP over SSL"], ["rsync", "873/tcp"], ["ftps-data", "989/tcp", "# FTP over SSL (data)"], ["ftps", "990/tcp"], ["telnets", "992/tcp", "# Telnet over SSL"], ["imaps", "993/tcp", "# IMAP over SSL"], ["pop3s", "995/tcp", "pop-3s # POP-3 over SSL"], ["socks", "1080/tcp", "# socks proxy server"], ["openvpn", "1194/tcp"], ["openvpn", "1194/udp"], ["ms-sql-s", "1433/tcp", "# Microsoft SQL Server"], ["ms-sql-m", "1434/udp", "# Microsoft SQL Monitor"], ["l2tp", "1701/udp"], ["radius", "1812/tcp"], ["radius", "1812/udp"], ["nfs", "2049/tcp", "# Network File System"], ["nfs", "2049/udp", "# Network File System"], ["mysql", "3306/tcp"], ["ms-wbt-server", "3389/tcp"], ["svn", "3690/tcp", "subversion # Subversion protocol"], ["postgresql", "5432/tcp", "postgres # PostgreSQL Database"], ["amqp", "5672/tcp"], ["x11", "6000/tcp", "x11-0 # X Window System"], ["redis", "6379/tcp"], ["http-alt", "8080/tcp", "webcache # WWW caching service"], ["zabbix-agent", "10050/tcp", "# Zabbix Agent"], ["zabbix-trapper", "10051/tcp", "# Zabbix Trapper"]];
  var ETC_SERVICES = "# Network services, Internet style\n#\n# Updated from https://www.iana.org/assignments/service-names-port-numbers/service-names-port-numbers.xhtml .\n#\n# New ports will be added on request if they have been officially assigned\n# by IANA and used in the real-world or are needed by a debian package.\n# If you need a huge list of used numbers please install the nmap package.\n\n" +
    SERVICES.map(function (s) { var alias = s[2] && !/^#/.test(s[2]) ? s[2].split(" #")[0] : "", comment = s[2] ? (/#/.test(s[2]) ? "# " + s[2].split("#")[1].trim() : "") : ""; return (rpad(s[0], 16) + rpad(s[1], 16) + rpad(alias, 0) + (comment ? (alias ? "\t\t" : "\t\t\t") + comment : "")).replace(/\s+$/, ""); }).join("\n") + "\n";
  N.SERVICES = SERVICES;
  var getentPrev2 = CMDS.getent;
  CMDS.getent = function (args, io, sess) {
    if (args[1] !== "services") return getentPrev2(args, io, sess);
    var keys = args.slice(2), rows = SERVICES.map(function (s) { return { name: s[0], port: +s[1].split("/")[0], proto: s[1].split("/")[1], aliases: s[2] && !/^#/.test(s[2]) ? s[2].split(" #")[0].trim().split(/\s+/) : [] }; });
    function show(r) { out(io, rpad(r.name, 21) + " " + r.port + "/" + r.proto + (r.aliases.length ? " " + r.aliases.join(" ") : "") + "\n"); }
    if (!keys.length) { rows.forEach(show); return 0; }
    var code = 0;
    keys.forEach(function (k) {
      var m = /^([\w-]+)(?:\/(tcp|udp))?$/.exec(k);
      var hit = m && rows.filter(function (r) { return (/^\d+$/.test(m[1]) ? r.port === +m[1] : r.name === m[1] || r.aliases.indexOf(m[1]) >= 0) && (!m[2] || r.proto === m[2]); })[0];
      if (hit) show(hit); else code = 2;
    });
    return code;
  };

  /* ================================================================== the wire: commands -> packets -> captures */
  function ends(sys, ip) {
    var nw = sys.nw;
    if (/^127\./.test(ip) || ip === "::1") return { dev: "lo", src: ip === "::1" ? "::1" : "127.0.0.1", smac: "00:00:00:00:00:00", dmac: "00:00:00:00:00:00", ttl: 64 };
    var r = N.reach(sys, ip, { quiet: true }), d = nw.ifs[r.dev || "eth0"] || nw.ifs.eth0;
    return { dev: r.dev || "eth0", src: r.src || ME(sys), smac: d ? d.mac : W.MY_MAC, dmac: r.nhMac || W.MAC.gw, ttl: r.ttl || 64, r: r, vlan: d && d.kind === "vlan" ? d.vid : null };
  }
  function ME(sys) { var a = N.own4(sys.nw).filter(function (x) { return !/^127\./.test(x.ip); })[0]; return a ? a.ip : "10.20.0.15"; }
  function clock(sys, gap) { var nw = sys.nw; if (nw.wireT == null) nw.wireT = sys.now / 1000 + 0.104221; nw.wireT += gap == null ? 0.0004 : gap; return nw.wireT; }
  function port0(sys) { var nw = sys.nw; nw.eport = (nw.eport || 41000 + (hash("p" + sys.host) % 9000)) + 7; return nw.eport; }
  function frame(sys, e, from, to, body) {
    var p = Object.assign({ t: clock(sys), dev: e.dev, eth: from === e.src ? { src: e.smac, dst: e.dmac } : { src: e.dmac, dst: e.smac }, vlan: e.vlan || undefined, ip: { src: from, dst: to, ttl: from === e.src ? 64 : e.ttl, id: (hash(from + to + clock(sys, 0)) % 60000) } }, body);
    if (e.dev === "lo") p.eth = { src: "00:00:00:00:00:00", dst: "00:00:00:00:00:00" };
    return p;
  }
  // a TCP conversation between our side (a) and the server (b): steps [{dir, flags, data|enc}]
  function tcpConv(sys, e, a, b, pa, pb, steps) {
    var sA = 2000000000 + (hash(a + pa) % 900000000), sB = 1000000000 + (hash(b + pb) % 900000000), res = [];
    steps.forEach(function (s) {
      var fromA = s.dir !== "<", len = s.data != null ? new TextEncoder().encode(s.data).length : s.enc ? s.enc.len : 0;
      var p = frame(sys, e, fromA ? a : b, fromA ? b : a, { tcp: { sport: fromA ? pa : pb, dport: fromA ? pb : pa, flags: s.flags, seq: fromA ? sA : sB, ack: s.flags === "S" || s.flags === "R" ? 0 : fromA ? sB : sA, win: /S/.test(s.flags) ? (fromA ? 64240 : 65160) : fromA ? 502 : 509, tsval: 3412871 + res.length * 11, tsecr: s.flags === "S" ? 0 : 998120 + res.length * 7, mss: 1460 } });
      if (s.data != null) p.data = s.data; if (s.enc) p.enc = s.enc; if (s.appName) p.appName = s.appName;
      if (s.gap) clock(sys, s.gap);
      if (/[SF]/.test(s.flags)) len += 1;
      if (fromA) sA += len; else sB += len;
      res.push(p);
    });
    return res;
  }
  function dnsPkts(sys, name, type, server, answers, rcode, viaStub) {
    var res = [], id = hash(name + type + clock(sys, 0)) % 65536, sp = port0(sys);
    if (viaStub) { var lo = ends(sys, "127.0.0.53"); res.push(frame(sys, lo, "127.0.0.1", "127.0.0.53", { udp: { sport: sp, dport: 53 }, dns: { id: id, q: name, qt: type } })); }
    var e = ends(sys, server), up = viaStub ? port0(sys) : sp, uid = viaStub ? (id + 4099) % 65536 : id;
    res.push(frame(sys, e, e.src, server, { udp: { sport: up, dport: 53 }, dns: { id: uid, q: name, qt: type } }));
    if (answers !== null) {
      clock(sys, 0.0011);
      res.push(frame(sys, e, server, e.src, { udp: { sport: 53, dport: up }, dns: { id: uid, q: name, qt: type, resp: true, an: answers || [], rcode: rcode } }));
      if (viaStub) { var lo2 = ends(sys, "127.0.0.53"); res.push(frame(sys, lo2, "127.0.0.53", "127.0.0.1", { udp: { sport: 53, dport: sp }, dns: { id: id, q: name, qt: type, resp: true, an: answers || [], rcode: rcode } })); }
    }
    return res;
  }
  function upstreamOf(sys) { var s = N.linkDnsServers(sys.nw); return s[0] || "10.20.0.2"; }
  function synth(sys, ev) {
    var P2 = [], e;
    clock(sys, 0.6);
    if (ev.k === "ping" && ev.to && isV4(ev.to) && !/^127\./.test(ev.to)) {
      e = ends(sys, ev.to);
      if (ev.err === "hostunreach") { for (var k0 = 0; k0 < Math.min(3, ev.n || 3); k0++) { P2.push({ t: clock(sys, 1), dev: e.dev, eth: { src: e.smac, dst: "ff:ff:ff:ff:ff:ff" }, arp: { op: "request", sha: e.smac, spa: e.src, tha: "00:00:00:00:00:00", tpa: (e.r && e.r.arpFail) || ev.to } }); } return P2; }
      if (ev.err === "netunreach") return P2;
      var id = 4100 + (hash(ev.to) % 900), from = e.r && e.r.pmtuFrom;
      for (var k = 1; k <= (ev.n || 1); k++) {
        P2.push(frame(sys, e, e.src, ev.to, { icmp: { type: 8, id: id, seq: k }, pad: ev.size }));
        if (ev.tooBig) { if (!sys.nw.pmtuBlackhole) P2.push(frame(sys, e, from, e.src, { icmp: { type: 3, code: 4, id: 0, seq: 0, orig: ev.to, mtu: e.r.pmtu } })); }
        else if (k <= (ev.got || 0)) { clock(sys, (e.r && e.r.rtt || 0.4) / 1000); P2.push(frame(sys, e, ev.to, e.src, { icmp: { type: 0, id: id, seq: k } })); }
        clock(sys, 1);
      }
      return P2;
    }
    if (ev.k === "arp" && ev.to) {
      e = ends(sys, ev.to);
      P2.push({ t: clock(sys), dev: e.dev, eth: { src: e.smac, dst: "ff:ff:ff:ff:ff:ff" }, arp: { op: "request", sha: e.smac, spa: e.src, tha: "00:00:00:00:00:00", tpa: ev.to } });
      (ev.macs || []).forEach(function (m) { P2.push({ t: clock(sys, 0.0004), dev: e.dev, eth: { src: m, dst: e.smac }, arp: { op: "reply", sha: m, spa: ev.to, tha: e.smac, tpa: e.src } }); });
      return P2;
    }
    if (ev.k === "dns" && ev.name && !ev.trace && !ev.hosts) {
      var server = ev.server || "127.0.0.53", stub = /^127\.0\.0\.5[34]$/.test(server), real = stub ? (ev.via || upstreamOf(sys)) : server;
      var ans = ev.ok ? (ev.ans || []) : [];
      if (ev.tcp) {
        e = ends(sys, real);
        return tcpConv(sys, e, e.src, real, port0(sys), 53, [{ flags: "S" }, { dir: "<", flags: "S." }, { flags: "." }, { flags: "P.", enc: { len: 50 + ev.name.length, seed: 3 }, appName: "DNS query over TCP" }, { dir: "<", flags: "P.", enc: { len: 80 + ans.length * 16, seed: 4 }, appName: "DNS response over TCP" }, { flags: "F." }, { dir: "<", flags: "F." }, { flags: "." }]);
      }
      return dnsPkts(sys, ev.name.replace(/\.$/, ""), ev.type || "A", real, ev.timeout ? null : ans.map(function (x) { return { type: x.type, data: String(x.data).replace(/\.$/, ""), ttl: N.ttlOf(sys, x.name || ev.name, x.type) }; }), ev.status && ev.status !== "NOERROR" ? ev.status : null, stub);
    }
    if (ev.k === "tcp" && ev.to && isV4(ev.to)) {
      e = ends(sys, ev.to);
      if (ev.err === "hostunreach") return [{ t: clock(sys), dev: e.dev, eth: { src: e.smac, dst: "ff:ff:ff:ff:ff:ff" }, arp: { op: "request", sha: e.smac, spa: e.src, tha: "00:00:00:00:00:00", tpa: ev.to } }];
      if (ev.err === "netunreach") return [];
      var sp = port0(sys);
      if (ev.ok) return tcpConv(sys, e, e.src, ev.to, sp, ev.port, [{ flags: "S" }, { dir: "<", flags: "S." }, { flags: "." }, { flags: "F." }, { dir: "<", flags: "F." }, { flags: "." }]);
      if (ev.err === "refused") return tcpConv(sys, e, e.src, ev.to, sp, ev.port, [{ flags: "S" }, { dir: "<", flags: "R." }]);
      return tcpConv(sys, e, e.src, ev.to, sp, ev.port, [{ flags: "S" }, { flags: "S", gap: 1.02 }, { flags: "S", gap: 2.05 }]);
    }
    if (ev.k === "udp" && ev.to && isV4(ev.to)) {
      e = ends(sys, ev.to);
      var up2 = port0(sys), hs = N.HOSTSVC(sys, ev.to), open = hs ? !!(hs[ev.port] && hs[ev.port].udp) : ev.port === 53 && W.RESOLVERS.indexOf(ev.to) >= 0;
      P2.push(frame(sys, e, e.src, ev.to, { udp: { sport: up2, dport: ev.port }, bin: [88] }));
      if (!open) { clock(sys, 0.0005); P2.push(frame(sys, e, ev.to, e.src, { icmp: { type: 3, code: 3, id: 0, seq: 0, orig: ev.to, port: ev.port } })); }
      return P2;
    }
    if (ev.k === "trace" && ev.to && isV4(ev.to)) {
      e = ends(sys, ev.to);
      var tp = port0(sys);
      (ev.hops || []).forEach(function (h, i) {
        P2.push(frame(sys, e, e.src, ev.to, { udp: { sport: tp, dport: 33434 + i }, ip_ttl: i + 1, bin: new Array(32).fill(0x40) }));
        P2[P2.length - 1].ip.ttl = i + 1;
        if (!h) return;
        clock(sys, 0.0009 * (i + 1));
        if (h === ev.to) P2.push(frame(sys, e, h, e.src, { icmp: { type: 3, code: 3, id: 0, seq: 0, orig: ev.to, port: 33434 + i } }));
        else P2.push(frame(sys, e, h, e.src, { icmp: { type: 11, code: 0, id: 0, seq: 0 } }));
      });
      return P2;
    }
    if (ev.k === "http" && ev.ip && isV4(ev.ip)) {
      if (ev.dnsName) { var g = N.getaddrinfo(sys, ev.dnsName, 4); if (g && !g.hosts && !g.err) P2 = P2.concat(dnsPkts(sys, ev.dnsName, "A", upstreamOf(sys), [{ type: "A", data: g.ip, ttl: N.ttlOf(sys, ev.dnsName, "A") }], null, true)); }
      var target = ev.ip, isSelf = N.isOwn(sys.nw, target);
      e = isSelf ? ends(sys, "127.0.0.1") : ends(sys, target);
      var a = isSelf ? (/^127\./.test(target) ? "127.0.0.1" : target) : e.src, sp2 = port0(sys);
      if (!ev.ok && ev.err === "refused") return P2.concat(tcpConv(sys, e, a, target, sp2, ev.port, [{ flags: "S" }, { dir: "<", flags: "R." }]));
      if (!ev.ok && (ev.err === "timeout") && !ev.hang) return P2.concat(tcpConv(sys, e, a, target, sp2, ev.port, [{ flags: "S" }, { flags: "S", gap: 1.02 }, { flags: "S", gap: 2.05 }]));
      if (!ev.ok && (ev.err === "netunreach" || ev.err === "hostunreach")) return P2;
      var st = [{ flags: "S" }, { dir: "<", flags: "S." }, { flags: "." }];
      if (ev.hang) { st.push({ flags: "P.", enc: { tls: 22, len: 517, seed: 7 }, appName: "TLS ClientHello" }, { dir: "<", flags: ".", gap: 0.02 }, { flags: "P.", enc: { tls: 22, len: 517, seed: 7 }, appName: "TLS ClientHello (retransmission)", gap: 0.4 }); return P2.concat(tcpConv(sys, e, a, target, sp2, ev.port, st)); }
      if (ev.tls) {
        st.push({ flags: "P.", enc: { tls: 22, len: 517, seed: 7 }, appName: "TLS ClientHello" }, { dir: "<", flags: "P.", enc: { tls: 22, len: 1448, seed: 9 }, appName: "TLS ServerHello, Certificate" }, { dir: "<", flags: "P.", enc: { tls: 23, len: 1102, seed: 10 }, appName: "TLS handshake (encrypted)" }, { flags: ".", gap: 0.0002 }, { flags: "P.", enc: { tls: 23, len: 80, seed: 11 }, appName: "TLS Finished" });
        if (ev.status) st.push({ flags: "P.", enc: { tls: 23, len: 120 + (ev.reqPath || "").length, seed: 12 }, appName: "TLS application data (HTTP request)" }, { dir: "<", flags: "P.", enc: { tls: 23, len: Math.min(1448, 200 + (ev.resp && ev.resp.body ? bytes(ev.resp.body) : 0)), seed: 13 }, appName: "TLS application data (HTTP response)" });
      } else if (ev.status) {
        var h = ev.hdrs || {};
        var req = (ev.method || "GET") + " " + (ev.reqPath || "/") + " HTTP/1.1\r\nHost: " + (h.host || ev.host) + "\r\nUser-Agent: " + (h["user-agent"] || "curl/8.5.0") + "\r\nAccept: */*\r\n" + Object.keys(h).filter(function (k) { return !/^(host|user-agent|accept)$/.test(k); }).map(function (k) { return k.replace(/(^|-)\w/g, function (s) { return s.toUpperCase(); }) + ": " + h[k] + "\r\n"; }).join("") + "\r\n";
        var rs = ev.resp ? N.statusBlock(ev.resp, "1.1") + String(ev.resp.body || "").slice(0, 900) : "HTTP/1.1 " + ev.status + "\r\n\r\n";
        st.push({ flags: "P.", data: req }, { dir: "<", flags: ".", gap: 0.0003 }, { dir: "<", flags: "P.", data: rs, gap: (ev.resp && ev.resp.delay ? ev.resp.delay / 1000 : 0.002) }, { flags: "." });
      }
      st.push({ flags: "F.", gap: 0.001 }, { dir: "<", flags: "F." }, { flags: "." });
      return P2.concat(tcpConv(sys, e, a, target, sp2, ev.port, st));
    }
    if (ev.k === "dhcp") {
      var d = sys.nw.ifs[ev.dev], dev = ev.dev, srvIp = ev.server, smac = (W.SEGS[ev.seg] && W.SEGS[ev.seg].peers[srvIp] || {}).mac || W.MAC.gw, xid = 0x3903f326 ^ (hash(ev.mac) & 0xffff), sg = W.SEGS[ev.seg] || {};
      function dh(src, dst, sp3, dp3, ethS, ethD, body) { return { t: clock(sys, 0.002), dev: dev, eth: { src: ethS, dst: ethD }, ip: { src: src, dst: dst, ttl: src === "0.0.0.0" ? 64 : 64, id: 0, df: false }, udp: { sport: sp3, dport: dp3 }, dhcp: Object.assign({ xid: xid, chaddr: ev.mac }, body) }; }
      var rog = sys.nw.rogueDhcp && sys.nw.rogueDhcp.seg === ev.seg ? sys.nw.rogueDhcp : null;
      if (rog) return [dh("0.0.0.0", "255.255.255.255", 68, 67, ev.mac, "ff:ff:ff:ff:ff:ff", { op: "request", type: "Discover" }),
        dh(rog.server, rog.ip, 67, 68, rog.mac, ev.mac, { op: "reply", type: "Offer", yiaddr: rog.ip, server: rog.server, router: rog.router, dns: rog.dns }),
        dh(srvIp, sg.dhcp[ev.mac] || "10.20.60.15", 67, 68, smac, ev.mac, { op: "reply", type: "Offer", yiaddr: sg.dhcp[ev.mac] || "10.20.60.15", server: srvIp, router: sg.dhcpRouter, dns: sg.dhcpDns }),
        dh("0.0.0.0", "255.255.255.255", 68, 67, ev.mac, "ff:ff:ff:ff:ff:ff", { op: "request", type: "Request", reqIp: rog.ip, server: rog.server }),
        dh(rog.server, rog.ip, 67, 68, rog.mac, ev.mac, { op: "reply", type: "ACK", yiaddr: rog.ip, server: rog.server, router: rog.router, dns: rog.dns })];
      return [dh("0.0.0.0", "255.255.255.255", 68, 67, ev.mac, "ff:ff:ff:ff:ff:ff", { op: "request", type: "Discover" }),
        dh(srvIp, ev.ip, 67, 68, smac, ev.mac, { op: "reply", type: "Offer", yiaddr: ev.ip, server: srvIp, router: sg.dhcpRouter, dns: sg.dhcpDns }),
        dh("0.0.0.0", "255.255.255.255", 68, 67, ev.mac, "ff:ff:ff:ff:ff:ff", { op: "request", type: "Request", reqIp: ev.ip, server: srvIp }),
        dh(srvIp, ev.ip, 67, 68, smac, ev.mac, { op: "reply", type: "ACK", yiaddr: ev.ip, server: srvIp, router: sg.dhcpRouter, dns: sg.dhcpDns })];
    }
    if (ev.k === "tls" && ev.host && !ev.what && ev.ok !== undefined) {
      var g2 = isV4(ev.host) ? { ip: ev.host } : N.getaddrinfo(sys, ev.host, 4);
      if (!g2.ip) return P2;
      e = ends(sys, g2.ip);
      return tcpConv(sys, e, e.src, g2.ip, port0(sys), ev.port || 443, [{ flags: "S" }, { dir: "<", flags: "S." }, { flags: "." }, { flags: "P.", enc: { tls: 22, len: 517, seed: 21 }, appName: "TLS ClientHello" }, { dir: "<", flags: "P.", enc: { tls: 22, len: 1448, seed: 22 }, appName: "TLS ServerHello, Certificate" }, { flags: "F." }, { dir: "<", flags: "F." }, { flags: "." }]);
    }
    return P2;
  }
  N.synth = synth;
  // live captures (background tcpdump) see packets on their interface that match their filter
  function feed(sys, pkts) {
    var nw = sys.nw;
    nw.wire = (nw.wire || []).concat(pkts).slice(-400);
    (nw.captures || []).slice().forEach(function (cap) {
      pkts.forEach(function (p) {
        if (cap.done) return;
        if (cap.dev !== "any" && (p.dev || "eth0") !== cap.dev) return;
        var ok; try { ok = N.matchFilter(sys, cap.fexpr, p); } catch (x) { ok = false; }
        if (!ok) return;
        cap.seen++;
        if (cap.o.w) cap.pkts.push(p);
        else printPkt(sys, cap, p);
        if (cap.o.c != null && cap.seen >= cap.o.c) finish(sys, cap, "count");
      });
    });
  }
  N.feed = feed;
  function printPkt(sys, cap, p) {
    var enc = N.encode(p), dl = N.decodeLine(sys, p, cap.o, cap.track, enc), L = [N.pcapTs(p.t, cap.o.tmode) + " " + dl.line];
    if (cap.o.X || cap.o.x) L = L.concat(N.hexDump(enc.bytes, cap.o.X >= 2 || cap.o.x >= 2 ? 0 : (p.vlan ? 18 : 14))); else L = L.concat(dl.sub);
    S.termWrite(sys.topSession, L.join("\n") + "\n", false);
  }
  N.onEv = function (sys, ev) {
    if (!sys.nw || sys.nw.noWire || ev.nowire) return;
    var pk;
    try { pk = synth(sys, ev); } catch (x) { pk = []; }
    if (pk && pk.length) feed(sys, pk);
  };
  N.startCapture = function (sess, io, c) {
    var sys = sess.sys, nw = sys.nw, pid = sys.nextPid - 1;
    var cap = { pid: pid, dev: c.dev, fexpr: c.fexpr, o: c.o, pkts: [], seen: 0, track: {}, uid: sess.uid };
    nw.captures = (nw.captures || []).concat([cap]);
    M2.blockHere(sess, { cmd: "tcpdump " + c.cmd.replace(/^tcpdump\s*/, ""), comm: "tcpdump", proc: { uid: sess.uid, ignore: [1, 2, 15], onIgnored: function (s2, p) { finish(s2, cap, "signal", p); } } });
    return 0;
  };
  function finish(sys, cap, why, proc) {
    if (cap.done) return;
    cap.done = true;
    var nw = sys.nw;
    nw.captures = (nw.captures || []).filter(function (x) { return x !== cap; });
    if (cap.o.w) {
      var path = cap.o.w.replace(/^~(?=\/|$)/, "/home/" + (S.uname(sys, 1000) || "dev"));
      if (path.charAt(0) !== "/") path = (sys.topSession ? S.activeShell(sys.topSession).cwd : "/home/dev") + "/" + path;
      putRoot(sys, S.normAbs(path), N.pcapFile(cap.pkts), 420, 0, 0, sys.now);
    }
    S.termWrite(sys.topSession, (cap.o.w ? "" : "") + cap.seen + " packet" + (cap.seen === 1 ? "" : "s") + " captured\n" + cap.seen + " packet" + (cap.seen === 1 ? "" : "s") + " received by filter\n0 packets dropped by kernel\n", true);
    var p = proc || M2.procByPid(sys, cap.pid);
    if (p) { M2.terminate(sys, p, 15); var j = (sys.jobs || []).filter(function (x) { return x.pid === p.pid; })[0]; if (j) j.state = "Done"; }
    N.ev(sys, { k: "pkt", pkts: (cap.o.w ? cap.pkts : []).slice(0, 40).map(function (x) { return N.describe(sys, x); }), count: cap.seen, saved: cap.o.w || null, layer: 2, nowire: true });
  }
  // a capture still running at the end of the commands keeps its packets in memory only
  N.captures = function (sys) { return sys.nw.captures || []; };

  /* ================================================================== tshark */
  var PROTO_PORT = { 21: "FTP", 22: "SSH", 2222: "SSH", 23: "TELNET", 25: "SMTP", 587: "SMTP", 53: "DNS", 80: "HTTP", 8080: "HTTP", 8081: "HTTP", 9200: "HTTP", 2375: "HTTP", 110: "POP", 143: "IMAP", 443: "TLSv1.3", 993: "TLSv1.3", 995: "TLSv1.3", 465: "TLSv1.3", 8443: "TLSv1.3", 6443: "TLSv1.3", 445: "SMB2", 3306: "MySQL", 5432: "PGSQL", 6379: "RESP", 123: "NTP", 161: "SNMP", 67: "DHCP", 68: "DHCP", 389: "LDAP", 873: "RSYNC" };
  function protoOf(p) {
    if (p.arp) return "ARP";
    if (p.icmp) return p.ip6 ? "ICMPv6" : "ICMP";
    if (p.dhcp) return "DHCP";
    if (p.dns) return "DNS";
    if (p.udp) { if (p.udp.dport === 443 || p.udp.sport === 443) return "QUIC"; return PROTO_PORT[p.udp.dport] && p.udp.dport < 1024 ? PROTO_PORT[p.udp.dport] : PROTO_PORT[p.udp.sport] && p.udp.sport < 1024 ? PROTO_PORT[p.udp.sport] : "UDP"; }
    if (p.tcp) {
      var hasData = p.data != null || p.enc;
      if (!hasData) return "TCP";
      if (p.data != null && /^(GET|POST|PUT|DELETE|HEAD|OPTIONS|PATCH) |^HTTP\/1/.test(p.data)) return "HTTP";
      if (p.enc && p.enc.tls) return "TLSv1.3";
      return PROTO_PORT[p.tcp.dport] || PROTO_PORT[p.tcp.sport] || "TCP";
    }
    return "ETH";
  }
  N.protoOf = protoOf;
  function streams(pkts) { var map = {}, n = 0; pkts.forEach(function (p) { if (!p.tcp) return; var a = p.ip.src + ":" + p.tcp.sport, b = p.ip.dst + ":" + p.tcp.dport, k = a < b ? a + "|" + b : b + "|" + a; if (map[k] == null) map[k] = n++; p._stream = map[k]; }); }
  function flagsOf(f) { var w = { S: "SYN", ".": "ACK", P: "PSH", F: "FIN", R: "RST" }, order = ["F", "S", "R", "P", "."], s = String(f); return order.filter(function (c) { return s.indexOf(c) >= 0; }).map(function (c) { return w[c]; }).join(", "); }
  function infoOf(p, rel) {
    if (p.arp) return p.arp.op === "reply" ? p.arp.spa + " is at " + p.arp.sha : "Who has " + p.arp.tpa + "? Tell " + p.arp.spa;
    if (p.icmp) { var ic = p.icmp; if (ic.type === 8) return "Echo (ping) request  id=0x" + ("000" + ic.id.toString(16)).slice(-4) + ", seq=" + ic.seq + "/" + (ic.seq << 8) + ", ttl=" + p.ip.ttl; if (ic.type === 0) return "Echo (ping) reply    id=0x" + ("000" + ic.id.toString(16)).slice(-4) + ", seq=" + ic.seq + "/" + (ic.seq << 8) + ", ttl=" + p.ip.ttl; if (ic.type === 11) return "Time-to-live exceeded (Time to live exceeded in transit)"; if (ic.type === 3) return ic.code === 4 ? "Destination unreachable (Fragmentation needed)" : "Destination unreachable (Port unreachable)"; return "Type " + ic.type; }
    if (p.dhcp) return "DHCP " + p.dhcp.type + " - Transaction ID 0x" + (p.dhcp.xid >>> 0).toString(16);
    if (p.dns) { var d = p.dns; return (d.resp ? "Standard query response 0x" : "Standard query 0x") + ("000" + d.id.toString(16)).slice(-4) + (d.rcode && d.rcode !== "NOERROR" ? " No such name" : "") + " " + d.qt + " " + d.q + (d.resp ? (d.an || []).map(function (x) { return " " + x.type + " " + x.data; }).join("") : ""); }
    if (p.udp) { if (p.appName && /NTP/.test(p.appName)) return "NTP Version 4, " + (/request/.test(p.appName) ? "client" : "server"); if (p.appName === "QUIC") return "Protected Payload (KP0), DCID=" + (hash("dcid" + p.udp.sport) % 1e8).toString(16); if (p.appName === "SNMP") return "get-request 1.3.6.1.2.1.1.1.0"; return p.udp.sport + " → " + p.udp.dport + " Len=" + ((N.encode(p).paylen) || 0); }
    if (p.tcp) {
      var t = p.tcp, proto = protoOf(p);
      if (proto === "HTTP") { var fl = String(p.data).split("\r\n")[0]; return /^HTTP/.test(fl) ? fl + " " : fl + " "; }
      if (proto === "TLSv1.3") return p.appName && /Hello|Certificate/.test(p.appName) ? p.appName.replace(/^TLS /, "") : "Application Data";
      if ((proto === "FTP" || proto === "SMTP" || proto === "POP" || proto === "IMAP" || proto === "TELNET") && p.data != null) { var l0 = String(p.data).split("\r\n")[0]; return proto === "TELNET" ? "Telnet Data ..." : (t.dport === 21 || t.dport === 25 || t.dport === 110 || t.dport === 143 ? "Request: " : "Response: ") + l0; }
      if (proto === "SSH") return p.data != null ? "Server: Protocol (" + String(p.data).trim() + ")" : "Encrypted packet (len=" + (p.enc ? p.enc.len : 0) + ")";
      if (proto === "RESP" && p.data != null) return "Request: " + String(p.data).split("\r\n")[0];
      var e = N.encode(p);
      return t.sport + " → " + t.dport + " [" + flagsOf(t.flags) + "] Seq=" + rel.seq + (/\./.test(t.flags) ? " Ack=" + rel.ack : "") + " Win=" + (t.win == null ? 502 : t.win) + " Len=" + e.paylen + (/S/.test(t.flags) ? " MSS=1460 SACK_PERM TSval=" + t.tsval + " TSecr=" + (t.tsecr || 0) + " WS=128" : "");
    }
    return "";
  }
  // display filters: field [op value], and/or/not, parentheses
  function DFError(m) { this.message = m; }
  function parseDF(text) {
    var toks = [], s = String(text || ""), i = 0;
    while (i < s.length) {
      var c = s.charAt(i);
      if (/\s/.test(c)) { i++; continue; }
      if (c === "(" || c === ")") { toks.push(c); i++; continue; }
      var m2 = /^(==|!=|>=|<=|>|<|&&|\|\||!)/.exec(s.slice(i)); if (m2) { toks.push(m2[1]); i += m2[1].length; continue; }
      if (c === "\"") { var j = s.indexOf("\"", i + 1); if (j < 0) throw new DFError("\"" + s.slice(i) + "\" was unexpected in this context."); toks.push({ str: s.slice(i + 1, j) }); i = j + 1; continue; }
      var w = /^[^\s()=!<>&|"]+/.exec(s.slice(i))[0]; toks.push(w); i += w.length;
    }
    var pos = 0;
    function peek() { return toks[pos]; }
    function expr() { var l = term(); while (peek() === "or" || peek() === "||") { pos++; l = { or: [l, term()] }; } return l; }
    function term() { var l = fac(); while (peek() === "and" || peek() === "&&") { pos++; l = { and: [l, fac()] }; } return l; }
    function fac() {
      var t = peek();
      if (t === "not" || t === "!") { pos++; return { not: fac() }; }
      if (t === "(") { pos++; var e = expr(); if (peek() !== ")") throw new DFError("Unexpected end of filter expression."); pos++; return e; }
      if (typeof t !== "string") throw new DFError("Unexpected end of filter expression.");
      pos++;
      var op = peek();
      if (/^(==|!=|>=|<=|>|<|eq|ne|gt|lt|ge|le|contains)$/.test(op || "")) { pos++; var v = toks[pos++]; if (v === undefined) throw new DFError("Unexpected end of filter expression."); return { f: t, op: op, v: typeof v === "object" ? v.str : v }; }
      return { f: t };
    }
    var e = expr();
    if (pos < toks.length) throw new DFError("\"" + (typeof toks[pos] === "object" ? toks[pos].str : toks[pos]) + "\" was unexpected in this context.");
    return e;
  }
  function fieldVals(p, f) {
    var proto = protoOf(p), t = p.tcp, u = p.udp, ip = p.ip;
    var http = proto === "HTTP" ? String(p.data) : null, hl = http ? http.split("\r\n") : [], req = http && !/^HTTP/.test(hl[0]), hdr = function (n) { var l = hl.filter(function (x) { return x.toLowerCase().indexOf(n + ":") === 0; })[0]; return l ? l.slice(n.length + 1).trim() : undefined; };
    var F = {
      "frame.number": p._n, "frame.len": N.encode(p).bytes.length, "frame.time_relative": p._rel, "frame.protocols": proto.toLowerCase(),
      "eth.src": p.eth.src, "eth.dst": p.eth.dst, "eth.addr": [p.eth.src, p.eth.dst],
      "ip.src": ip && ip.src, "ip.dst": ip && ip.dst, "ip.addr": ip ? [ip.src, ip.dst] : undefined, "ip.ttl": ip && ip.ttl, "ip.proto": t ? 6 : u ? 17 : p.icmp ? 1 : undefined,
      "tcp.srcport": t && t.sport, "tcp.dstport": t && t.dport, "tcp.port": t ? [t.sport, t.dport] : undefined, "tcp.stream": t ? p._stream : undefined, "tcp.len": t ? N.encode(p).paylen : undefined,
      "tcp.flags.syn": t ? (/S/.test(t.flags) ? 1 : 0) : undefined, "tcp.flags.ack": t ? (/\./.test(t.flags) ? 1 : 0) : undefined, "tcp.flags.reset": t ? (/R/.test(t.flags) ? 1 : 0) : undefined, "tcp.flags.fin": t ? (/F/.test(t.flags) ? 1 : 0) : undefined, "tcp.flags.push": t ? (/P/.test(t.flags) ? 1 : 0) : undefined,
      "icmp.type": p.icmp ? p.icmp.type : undefined, "icmp.code": p.icmp ? (p.icmp.code || 0) : undefined, "udp.srcport": u && u.sport, "udp.dstport": u && u.dport, "udp.port": u ? [u.sport, u.dport] : undefined, "udp.length": u ? 8 + N.encode(p).paylen : undefined,
      "dns.id": p.dns ? "0x" + ("000" + p.dns.id.toString(16)).slice(-4) : undefined, "tls.handshake.extensions_server_name": p.sni || undefined, "dns.resp.ttl": p.dns && p.dns.resp && p.dns.an && p.dns.an[0] ? p.dns.an[0].ttl : undefined,
      "dns.qry.name": p.dns && p.dns.q, "dns.flags.response": p.dns ? (p.dns.resp ? 1 : 0) : undefined, "dns.a": p.dns && p.dns.resp ? (p.dns.an || []).filter(function (x) { return x.type === "A"; }).map(function (x) { return x.data; }) : undefined, "dns.qry.type": p.dns ? { A: 1, AAAA: 28, MX: 15, TXT: 16, NS: 2, CNAME: 5, PTR: 12 }[p.dns.qt] : undefined, "dns.flags.rcode": p.dns ? (p.dns.rcode === "NXDOMAIN" ? 3 : p.dns.rcode === "SERVFAIL" ? 2 : 0) : undefined,
      "http.request": http && req ? 1 : undefined, "http.response": http && !req ? 1 : undefined, "http.request.method": req ? hl[0].split(" ")[0] : undefined, "http.request.uri": req ? hl[0].split(" ")[1] : undefined, "http.host": req ? hdr("host") : undefined, "http.user_agent": req ? hdr("user-agent") : undefined, "http.authorization": req ? hdr("authorization") : undefined, "http.file_data": http && http.indexOf("\r\n\r\n") >= 0 && http.split("\r\n\r\n")[1] ? http.split("\r\n\r\n").slice(1).join("\r\n\r\n") : undefined, "http.cookie": req ? hdr("cookie") : undefined, "http.response.code": http && !req ? +hl[0].split(" ")[1] : undefined, "http.server": http && !req ? hdr("server") : undefined,
      "ftp.request.command": proto === "FTP" && t.dport === 21 && p.data ? String(p.data).split(" ")[0].trim() : undefined, "ftp.request.arg": proto === "FTP" && t.dport === 21 && p.data ? String(p.data).replace(/^\S+\s?/, "").replace(/\r\n$/, "") : undefined,
      "dhcp.option.dhcp": p.dhcp ? { Discover: 1, Offer: 2, Request: 3, ACK: 5 }[p.dhcp.type] : undefined, "dhcp.hw.mac_addr": p.dhcp && p.dhcp.chaddr, "dhcp.ip.your": p.dhcp && p.dhcp.yiaddr,
      "_ws.col.Protocol": proto, "_ws.col.protocol": proto, "_ws.col.Info": p._info, "_ws.col.info": p._info
    };
    F.bootp = F.dhcp = p.dhcp ? 1 : undefined;
    ["arp", "icmp", "dns", "http", "tls", "ssh", "ftp", "telnet", "smtp", "pop", "imap", "mysql", "pgsql", "ntp", "snmp", "quic", "smb2", "ldap", "tcp", "udp", "ip", "eth", "resp"].forEach(function (k) { if (F[k] === undefined) F[k] = (k === "tcp" ? !!t : k === "udp" ? !!u : k === "ip" ? !!ip : k === "eth" ? true : k === "tls" ? proto === "TLSv1.3" : proto.toLowerCase() === k) ? 1 : undefined; });
    if (!(f in F)) throw new DFError("\"" + f + "\" is neither a field nor a protocol name.");
    return F[f];
  }
  function dfMatch(e, p) {
    if (!e) return true;
    if (e.or) return dfMatch(e.or[0], p) || dfMatch(e.or[1], p);
    if (e.and) return dfMatch(e.and[0], p) && dfMatch(e.and[1], p);
    if (e.not) return !dfMatch(e.not, p);
    var v = fieldVals(p, e.f);
    if (!e.op) return v !== undefined && v !== 0 && !(Array.isArray(v) && !v.length) || (v === 0 && e.f.indexOf("flags") < 0 && e.f !== "frame.number" ? false : v === 1);
    var vs = Array.isArray(v) ? v : [v], want = e.v, num = /^-?\d+(\.\d+)?$/.test(want) || /^0x[0-9a-f]+$/i.test(want) ? Number(want) : null;
    return vs.some(function (x) {
      if (x === undefined) return false;
      var a = typeof x === "number" && num !== null ? x : String(x), b = typeof x === "number" && num !== null ? num : String(want);
      if (e.op === "contains") return String(x).indexOf(String(want)) >= 0;
      if (e.op === "==" || e.op === "eq") return typeof a === "string" ? a.toLowerCase() === String(b).toLowerCase() : a === b;
      if (e.op === "!=" || e.op === "ne") return typeof a === "string" ? a.toLowerCase() !== String(b).toLowerCase() : a !== b;
      if (e.op === ">" || e.op === "gt") return a > b; if (e.op === "<" || e.op === "lt") return a < b; if (e.op === ">=" || e.op === "ge") return a >= b; return a <= b;
    });
  }
  function prep(pkts) {
    streams(pkts);
    var t0 = pkts.length ? pkts[0].t : 0, isn = {};
    pkts.forEach(function (p, i) {
      p._n = i + 1; p._rel = (p.t - t0).toFixed(9);
      var rel = { seq: 0, ack: 0 };
      if (p.tcp) {
        var k = p.ip.src + ":" + p.tcp.sport + ">" + p.ip.dst + ":" + p.tcp.dport, rk = p.ip.dst + ":" + p.tcp.dport + ">" + p.ip.src + ":" + p.tcp.sport;
        if (isn[k] === undefined) isn[k] = /S/.test(p.tcp.flags) ? p.tcp.seq : p.tcp.seq - 1;
        rel.seq = (p.tcp.seq - isn[k]) >>> 0; rel.ack = isn[rk] === undefined ? 0 : (p.tcp.ack - isn[rk]) >>> 0;
      }
      p._info = infoOf(p, rel);
    });
  }
  CMDS.tshark = function (args, io, sess) {
    var sys = sess.sys, a = args.slice(1), o = { e: [], z: [], sep: "\t", header: false };
    for (var i = 0; i < a.length; i++) {
      var x = a[i];
      if (x === "-r") o.r = a[++i]; else if (x === "-Y" || x === "--display-filter") o.Y = a[++i]; else if (x === "-T") o.T = a[++i]; else if (x === "-e") o.e.push(a[++i]); else if (x === "-c") o.c = +a[++i];
      else if (x === "-z") o.z.push(a[++i]); else if (x === "-q") o.q = true; else if (x === "-n" || x === "-N") continue; else if (x === "-E") { var ev = a[++i] || "", m = /^(\w+)=(.*)$/.exec(ev); if (m && m[1] === "separator") o.sep = m[2] === "/t" ? "\t" : m[2] === "/s" ? " " : m[2]; if (m && m[1] === "header") o.header = /^y/.test(m[2]); }
      else if (x === "-i" || x === "-f" || x === "-w") { errl(io, "Capturing on '" + (a[i + 1] || "eth0") + "'"); note(io, "(In this lab, capture with tcpdump (it can run in the background with &), save with -w, then read the file with tshark -r.)"); return 0; }
      else if (x === "-v" || x === "--version") { out(io, "TShark (Wireshark) 4.2.2 (Git v4.2.2 packaged as 4.2.2-1.1build3).\n"); return 0; }
      else if (x === "-h" || x === "--help") { out(io, "TShark (Wireshark) 4.2.2 (Git v4.2.2 packaged as 4.2.2-1.1build3)\nDump and analyze network traffic.\n\nUsage: tshark [options] ...\n  -r <infile>              set the filename to read from\n  -Y <display filter>      packet displaY filter in Wireshark display filter syntax\n  -c <packet count>        stop after n packets\n  -T fields|text           format of text output\n  -e <field>               field to print if -Tfields selected (e.g. tcp.port, _ws.col.info)\n  -E separator=,           field print option (/t tab, /s space)\n  -q                       be more quiet on stdout (e.g. when using statistics)\n  -z <statistics>          conv,tcp  conv,udp  conv,ip  follow,tcp,ascii,N  io,phs\n"); return 0; }
      else if (/^-T\w+$/.test(x)) o.T = x.slice(2);
      else if (/^-/.test(x)) { errl(io, "tshark: option requires an argument -- '" + x.slice(1) + "'\ntshark: Invalid option or option argument: " + x); return 1; }
    }
    if (!o.r) { errl(io, "Capturing on 'eth0'\ntshark: The capture session could not be initiated on interface 'eth0' (You don't have permission to capture on that device)."); note(io, "(Read a saved capture with tshark -r FILE. To capture, use sudo tcpdump -w FILE first.)"); return 2; }
    var rf = S.readFile(sess, o.r);
    if (rf.error) { errl(io, "tshark: The file \"" + o.r + "\" doesn't exist."); return 2; }
    var pkts = N.readPcap(rf.content);
    if (!pkts) { errl(io, "tshark: The file \"" + o.r + "\" isn't a capture file in a format TShark understands."); return 2; }
    pkts = pkts.map(function (p) { return JSON.parse(JSON.stringify(p)); });
    prep(pkts);
    var df = null;
    if (o.Y) { try { df = parseDF(o.Y); pkts.forEach(function (p) { dfMatch(df, p); }); } catch (x) { if (x instanceof DFError) { errl(io, "tshark: " + x.message + "\n    " + o.Y + "\n    ^"); return 4; } throw x; } }
    var sel = pkts.filter(function (p) { return dfMatch(df, p); });
    if (o.c) sel = sel.slice(0, o.c);
    var L = [];
    if (!o.q) {
      if (o.T === "fields") {
        if (!o.e.length) { errl(io, "tshark: \"-Tfields\" was specified, but no fields were specified with \"-e\"."); return 1; }
        try { o.e.forEach(function (f) { fieldVals(pkts[0] || { eth: {} }, f); }); } catch (x) { if (x instanceof DFError) { errl(io, "tshark: Some fields aren't valid:\n\t" + x.message.replace(/^"|" is.*$/g, "")); return 1; } throw x; }
        if (o.header) L.push(o.e.join(o.sep));
        sel.forEach(function (p) { L.push(o.e.map(function (f) { var v = fieldVals(p, f); return v === undefined ? "" : Array.isArray(v) ? v.join(",") : String(v); }).join(o.sep)); });
      } else {
        sel.forEach(function (p) {
          var src = p.ip ? p.ip.src : p.ip6 ? p.ip6.src : p.eth.src, dst = p.ip ? p.ip.dst : p.ip6 ? p.ip6.dst : (p.eth.dst === "ff:ff:ff:ff:ff:ff" ? "Broadcast" : p.eth.dst);
          if (p.arp) { src = p.eth.src; }
          L.push(pad(p._n, 5) + " " + pad(p._rel, 12) + " " + pad(src, 13) + " → " + rpad(dst, 13) + " " + rpad(protoOf(p), 6) + " " + N.encode(p).bytes.length + " " + p._info);
        });
      }
    }
    o.z.forEach(function (z) {
      var m = /^conv,(tcp|udp|ip)$/.exec(z), fm = /^follow,tcp,ascii,(\d+)$/.exec(z);
      if (m) L = L.concat(conv(sel, m[1]));
      else if (fm) L = L.concat(follow(pkts, +fm[1]));
      else if (z === "io,phs") L = L.concat(phs(sel));
      else { errl(io, "tshark: Invalid -z argument \"" + z + "\"; it must be one of:\n     conv,tcp  conv,udp  conv,ip  follow,tcp,ascii,N  io,phs"); }
    });
    out(io, joinLines(L));
    var dpk = sel.slice(0, 40).map(function (p) { var c = JSON.parse(JSON.stringify(p)); delete c._n; delete c._rel; delete c._info; delete c._stream; return N.describe(sys, c); });
    N.ev(sys, { k: "pkt", pkts: dpk, count: sel.length, file: o.r, layer: 7 });
    return 0;
  };
  function commas(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ","); }
  function conv(pkts, kind) {
    var map = {}, order = [];
    pkts.forEach(function (p) {
      var a, b;
      if (kind === "tcp") { if (!p.tcp) return; a = p.ip.src + ":" + p.tcp.sport; b = p.ip.dst + ":" + p.tcp.dport; }
      else if (kind === "udp") { if (!p.udp) return; a = p.ip.src + ":" + p.udp.sport; b = p.ip.dst + ":" + p.udp.dport; }
      else { if (!p.ip) return; a = p.ip.src; b = p.ip.dst; }
      var k = [a, b].sort().join("|"), len = N.encode(p).bytes.length;
      if (!map[k]) { map[k] = { a: a, b: b, ab: [0, 0], ba: [0, 0], t0: +p._rel, t1: +p._rel }; order.push(k); }
      var c = map[k];
      if (a === c.a) { c.ab[0]++; c.ab[1] += len; } else { c.ba[0]++; c.ba[1] += len; }
      c.t1 = +p._rel;
    });
    var rows = order.map(function (k) { return map[k]; }).sort(function (x, y) { return (y.ab[1] + y.ba[1]) - (x.ab[1] + x.ba[1]); });
    var L = ["================================================================================", (kind === "ip" ? "IPv4" : kind.toUpperCase()) + " Conversations", "Filter:<No Filter>",
      "                                                           |       <-      | |       ->      | |     Total     |    Relative    |   Duration   |",
      "                                                           | Frames  Bytes | | Frames  Bytes | | Frames  Bytes |      Start     |              |"];
    rows.forEach(function (c) { L.push(rpad(c.a, 26) + " <-> " + rpad(c.b, 26) + "  " + pad(c.ba[0], 6) + " " + pad(commas(c.ba[1]) + " bytes", 13) + "  " + pad(c.ab[0], 6) + " " + pad(commas(c.ab[1]) + " bytes", 13) + "  " + pad(c.ab[0] + c.ba[0], 6) + " " + pad(commas(c.ab[1] + c.ba[1]) + " bytes", 13) + "  " + pad(c.t0.toFixed(9), 14) + "  " + pad((c.t1 - c.t0).toFixed(4), 12)); });
    L.push("================================================================================");
    return L;
  }
  function follow(pkts, n) {
    var sel = pkts.filter(function (p) { return p.tcp && p._stream === n; });
    var L = ["", "===================================================================", "Follow: tcp,ascii", "Filter: tcp.stream eq " + n];
    if (!sel.length) { L.push("Node 0: :0", "Node 1: :0", "==================================================================="); return L; }
    var a = sel[0].ip.src + ":" + sel[0].tcp.sport, b = sel[0].ip.dst + ":" + sel[0].tcp.dport;
    L.push("Node 0: " + a, "Node 1: " + b);
    sel.forEach(function (p) {
      var data = p.data != null ? String(p.data) : p.enc ? new Array(Math.min(p.enc.len, 60) + 1).join(".") : null;
      if (data == null || data === "") return;
      var fromA = p.ip.src + ":" + p.tcp.sport === a;
      L.push((fromA ? "" : "\t") + bytes(data));
      data.replace(/\r\n$/, "").split(/\r?\n/).forEach(function (l) { L.push((fromA ? "" : "\t") + l); });
    });
    L.push("===================================================================");
    return L;
  }
  function phs(pkts) {
    var counts = {}, total = 0;
    pkts.forEach(function (p) { var pr = protoOf(p), b = N.encode(p).bytes.length; total += b; var path = ["eth"]; if (p.arp) path.push("arp"); else { path.push(p.ip6 ? "ipv6" : "ip"); if (p.tcp) path.push("tcp"); if (p.udp) path.push("udp"); if (p.icmp) path.push("icmp"); if (!/^(TCP|UDP|ICMP|ARP)$/.test(pr)) path.push(pr.toLowerCase().replace("tlsv1.3", "tls")); } var k = ""; path.forEach(function (x, d) { k += (d ? "/" : "") + x; counts[k] = counts[k] || { n: 0, b: 0, d: d, name: x }; counts[k].n++; counts[k].b += b; }); });
    var L = ["", "===================================================================", "Protocol Hierarchy Statistics", "Filter: ", ""];
    Object.keys(counts).sort().forEach(function (k) { var c = counts[k]; L.push(rpad(new Array(c.d + 1).join("  ") + c.name, 40) + "frames:" + c.n + " bytes:" + c.b); });
    L.push("===================================================================");
    return L;
  }

  /* ================================================================== mtr */
  CMDS.mtr = function (args, io, sess) {
    var sys = sess.sys, a = args.slice(1), report = false, count = 10, numeric = false, wide = false, target = null;
    for (var i = 0; i < a.length; i++) { var x = a[i]; if (x === "-r" || x === "--report") report = true; else if (x === "-c" || x === "--report-cycles") count = +a[++i]; else if (/^-c\d+$/.test(x)) count = +x.slice(2); else if (x === "-n" || x === "--no-dns") numeric = true; else if (x === "-w" || x === "--report-wide") { wide = true; report = true; } else if (/^-[rnwb]+$/.test(x)) { if (/r/.test(x)) report = true; if (/n/.test(x)) numeric = true; if (/w/.test(x)) { wide = true; report = true; } } else if (/^-/.test(x)) continue; else target = x; }
    if (!target) { errl(io, "mtr: No hostname"); return 1; }
    var res = N.resolveForPing(sys, target, false, false);
    if (res.err) { errl(io, "mtr: Failed to resolve host: " + target + ": " + res.err); return 1; }
    var r = N.reach(sys, res.ip, { quiet: true });
    if (r.err === "netunreach") { errl(io, "mtr: Failed to bind to 0.0.0.0: Network is unreachable"); return 1; }
    if (!report) note(io, "(mtr normally redraws a live table until you press q. The lab printed a report instead: the same as mtr -r -c " + count + ".)");
    var L = ["Start: " + new Date(sys.now).toISOString().replace(/\.\d+Z$/, "+0000"), rpad("HOST: " + sys.host, wide ? 40 : 30) + "Loss%   Snt   Last   Avg  Best  Wrst StDev"];
    var hops = r.hops.slice();
    if (!r.ok) { while (hops.length && hops[hops.length - 1] === null) hops.pop(); hops.push(null); }
    var nw = sys.nw;
    hops.forEach(function (h, k) {
      var name = h ? (numeric ? h.ip : h.name || h.ip) : "???";
      var isLast = k === hops.length - 1, lossPct;
      if (!h) lossPct = 100;
      else if (isLast) lossPct = Math.round((r.loss || 0) * 100 + ((nw.pathLoss || {})[h.ip] || 0));
      else lossPct = (nw.hopLoss || {})[h.ip] || 0;
      var base = h ? h.rtt : 0, jit = (nw.hopJitter || {})[h ? h.ip : ""] || 0;
      var vals = h ? [base * 1.02, base, base * 0.93, base * 1.12 + jit, base * 0.04 + jit / 3] : [0, 0, 0, 0, 0];
      L.push(pad(k + 1, 3) + ".|-- " + rpad(name, wide ? 34 : 24) + pad(lossPct.toFixed(1) + "%", 6).replace("100.0%", " 100.0") + "  " + pad(count, 4) + pad(vals[0].toFixed(1), 7) + pad(vals[1].toFixed(1), 6) + pad(vals[2].toFixed(1), 6) + pad(vals[3].toFixed(1), 6) + pad(vals[4].toFixed(1), 6));
    });
    out(io, joinLines(L));
    N.ev(sys, { k: "trace", to: res.ip, ok: r.ok, path: r.path, fail: r.ok ? null : r.fail, hops: hops.map(function (h) { return h ? h.ip : null; }), layer: 3, nowire: true });
    return 0;
  };

  /* ================================================================== packages, machine setup */
  function PK(name, ver, o) { return Object.assign({ name: name, ver: ver, arch: "amd64", section: "net", size: 120, desc: "", deps: [], bins: [], sbins: [], installed: false, auto: false, archive: "noble" }, o || {}); }
  M2.CATALOG.push(
    PK("tshark", "4.2.2-1.1build3", { size: 420, desc: "network traffic analyzer - console version", deps: ["wireshark-common"], bins: ["tshark"] }),
    PK("wireshark-common", "4.2.2-1.1build3", { size: 3200, desc: "network traffic analyzer - common files", auto: true }),
    PK("mtr-tiny", "0.95-1.1build2", { installed: true, size: 150, desc: "Full screen ncurses traceroute tool", bins: ["mtr"] })
  );
  S.SYS_HOOKS.push(function (sys) {
    putRoot(sys, "/etc/services", ETC_SERVICES, 420, 0, 0, NOW - 400 * DAY);
    S.mkdirs(sys, "/run/systemd/resolve", 493, 991, 991);
    putRoot(sys, "/run/systemd/resolve/stub-resolv.conf", "# This is /run/systemd/resolve/stub-resolv.conf managed by man:systemd-resolved(8).\n# Do not edit.\n#\n# This file might be symlinked as /etc/resolv.conf.\n\nnameserver 127.0.0.53\noptions edns0 trust-ad\nsearch kestrel.internal\n", 420, 991, 991, NOW - 2 * DAY);
    putRoot(sys, "/run/systemd/resolve/resolv.conf", "# This is /run/systemd/resolve/resolv.conf managed by man:systemd-resolved(8).\n# Do not edit.\n\nnameserver 10.20.0.2\nsearch kestrel.internal\n", 420, 991, 991, NOW - 2 * DAY);
    if (sys.nw) { sys.nw.captures = []; }
  });
  S.POST_HOOKS.push(function (sys) { if (sys.nw) { sys.nw.wire = []; sys.nw.wireT = null; } });
})(typeof window !== "undefined" ? window : globalThis);
