/* sudo learn — Networking Module 1 practice drills (3 per lab, +5 XP each). Loaded after labs.js. */
(function () {
  "use strict";
  var T = window.NET_TRACK, S = window.ShEngine, M2 = S.M2, N = window.NetCore, NH = window.NetLab.H, SH = window.ShLab.H, X = T.M1, W = N.W;
  var lines = T.lines, ran = NH.ran, outHas = NH.outHas, NOW = S.NOW, P = N.P;
  function L(t) { return SH.lines(t || ""); }
  function nw(r) { return r.sys.nw; }
  function received(e) { return / [1-9]\d* received/.test(e.out.join("\n")); }
  function preinstall(name) { return function (sys) { if (S.M3 && S.M3.preinstall) S.M3.preinstall(sys, name); }; }
  function both() { var fs = Array.prototype.slice.call(arguments); return function (sys) { fs.forEach(function (f) { f(sys); }); }; }
  var CAP = X.webCapture();

  var DRILLS = {
    "net-101": [
      {
        id: "d1", title: "Just the DNS", files: { "captures/web-request.pcap": N.pcapFile(CAP.all) },
        text: "<p>Show only the <b>DNS</b> packets in <code>~/captures/web-request.pcap</code> (numeric output).</p>",
        starter: "", solution: lines("tcpdump -r ~/captures/web-request.pcap -n port 53"),
        check: function (r) { return ran(r, /\btcpdump\b.*web-request/, function (e) { return e.out.length === 2 && outHas(e, /A\? example\.com/) && outHas(e, /1\/0\/0 A 93\.184\.215\.14/); }) ? true : "Filter on DNS's port, 53: exactly the question and the answer should remain."; }
      },
      {
        id: "d2", title: "The handshake", files: { "captures/web-request.pcap": N.pcapFile(CAP.all) },
        text: "<p>Print only the first <b>three TCP packets</b> of the capture: the handshake.</p>",
        starter: "", solution: lines("tcpdump -r ~/captures/web-request.pcap -n -c 3 tcp"),
        check: function (r) { return ran(r, /\btcpdump\b.*web-request/, function (e) { return e.out.length === 3 && /Flags \[S\],/.test(e.out[0]) && /Flags \[S\.\]/.test(e.out[1]) && /Flags \[\.\]/.test(e.out[2]); }) ? true : "Filter tcp and stop after 3 packets (-c 3): you should see [S], [S.] and [.]."; }
      },
      {
        id: "d3", title: "Whose MAC is that?", files: { "captures/web-request.pcap": N.pcapFile(CAP.all) },
        text: "<p>Show the DNS <b>reply</b> with its Ethernet header, so you can see the DNS server's MAC address.</p>",
        starter: "", solution: lines("tcpdump -r ~/captures/web-request.pcap -n -e src port 53"),
        check: function (r) { return ran(r, /\btcpdump\b.*web-request/, function (e) { return outHas(e, /^\S+ 52:54:00:6d:0e:91 > 52:54:00:4e:1a:07, ethertype IPv4/); }) ? true : "Use -e and a filter that keeps the reply (it comes from port 53)."; }
      }
    ],
    "net-102": [
      {
        id: "d1", title: "Count the errors",
        text: "<p>Show eth0's packet and <b>error counters</b>.</p>",
        starter: "", solution: lines("ip -s link show eth0"),
        check: function (r) { return ran(r, /\bip\b.*-s/, function (e) { return outHas(e, /RX:\s+bytes packets errors/) && outHas(e, /eth0/); }) ? true : "ip -s link show eth0 adds the RX/TX counters."; }
      },
      {
        id: "d2", title: "Switched off", system: function (sys) { sys.nw.ifs.eth0.admin = false; },
        text: "<p>Someone ran <code>ip link set eth0 down</code>. Bring it back and ping the gateway (10.20.0.1).</p>",
        starter: "", solution: lines("sudo ip link set eth0 up", "ping -c 2 10.20.0.1"),
        check: function (r) { if (!nw(r).ifs.eth0.admin) return "eth0 is still down: sudo ip link set eth0 up."; return ran(r, /\bping\b.*10\.20\.0\.1/, received) ? true : "Now ping 10.20.0.1."; }
      },
      {
        id: "d3", title: "Let them negotiate", system: function (sys) { var e = sys.nw.ifs.eth0; e.autoneg = false; e.speed = 100; e.duplex = "full"; },
        text: "<p>eth0 was forced to 100 Mb/s full duplex, but its switch port auto-negotiates. Put eth0 back on auto-negotiation and check it's at 1000 Mb/s full duplex.</p>",
        starter: "", solution: lines("ethtool eth0", "sudo ethtool -s eth0 autoneg on", "ethtool eth0"),
        check: function (r) { var l = N.linkOf(nw(r), nw(r).ifs.eth0); if (l.mismatch || !nw(r).ifs.eth0.autoneg) return "Turn auto-negotiation back on (ethtool -s eth0 autoneg on)."; return ran(r, /\bethtool\s+eth0\b/, function (e) { return outHas(e, /Speed: 1000Mb\/s/) && outHas(e, /Duplex: Full/); }) ? true : "Check with ethtool eth0: 1000Mb/s, Full."; }
      }
    ],
    "net-103": [
      {
        id: "d1", title: "The gateway's MAC",
        text: "<p>Show the neighbour entry for the gateway, <b>10.20.0.1</b>, and nothing else.</p>",
        starter: "", solution: lines("ip neigh show 10.20.0.1"),
        check: function (r) { return ran(r, /\bip\b.*\bneigh\b/, function (e) { return e.out.length === 1 && /^10\.20\.0\.1 dev eth0 lladdr 52:54:00:12:35:02/.test(e.out[0]); }) ? true : "ip neigh show ADDRESS shows one entry."; }
      },
      {
        id: "d2", title: "A stale pin", system: function (sys) { sys.nw.neigh["10.20.0.31"] = { mac: "52:54:00:b7:99:01", dev: "eth0", state: "PERMANENT", perm: true }; },
        text: "<p>Backups to kc-backup-01 (10.20.0.31) time out. Someone pinned it to an old MAC. Remove the entry and ping it.</p>",
        starter: "", solution: lines("ip neigh", "sudo ip neigh del 10.20.0.31 dev eth0", "ping -c 2 10.20.0.31"),
        check: function (r) { var n = nw(r).neigh["10.20.0.31"]; if (n && n.perm) return "The permanent entry is still there: sudo ip neigh del 10.20.0.31 dev eth0."; return ran(r, /\bping\b.*(10\.20\.0\.31|kc-backup-01)/, received) ? true : "Now ping 10.20.0.31."; }
      },
      {
        id: "d3", title: "The management VLAN",
        text: "<p>Reach the switch's management address <b>10.20.20.2</b> on <b>VLAN 20</b>: create <code>eth0.20</code> with <code>10.20.20.15/24</code>, bring it up and ping it.</p>",
        starter: "", solution: lines("sudo ip link add link eth0 name eth0.20 type vlan id 20", "sudo ip addr add 10.20.20.15/24 dev eth0.20", "sudo ip link set eth0.20 up", "ping -c 2 10.20.20.2"),
        check: function (r) { var d = nw(r).ifs["eth0.20"]; if (!d || d.vid !== 20) return "Create eth0.20 on VLAN 20."; if (!d.addrs.some(function (a) { return a.ip === "10.20.20.15"; }) || !d.admin) return "Give it 10.20.20.15/24 and bring it up."; return ran(r, /\bping\b.*10\.20\.20\.2\b/, received) ? true : "Ping 10.20.20.2."; }
      }
    ],
    "net-104": [
      {
        id: "d1", title: "A broadcast address", system: preinstall("ipcalc"),
        text: "<p>What's the broadcast address of <code>192.168.10.77/27</code>? Work it out with ipcalc and write it to <code>~/bcast.txt</code>.</p>",
        starter: "", solution: lines("ipcalc 192.168.10.77/27", "echo 192.168.10.95 > ~/bcast.txt"),
        check: function (r) { if (!ran(r, /\bipcalc\b.*192\.168\.10\.77/)) return "Run ipcalc 192.168.10.77/27."; return (r.read("bcast.txt") || "").trim() === "192.168.10.95" ? true : "~/bcast.txt should hold the Broadcast: value."; }
      },
      {
        id: "d2", title: "How many hosts?", system: preinstall("ipcalc"),
        text: "<p>How many hosts fit in <code>10.20.0.0/22</code>? Write the number to <code>~/hosts.txt</code>.</p>",
        starter: "", solution: lines("ipcalc 10.20.0.0/22", "echo 1022 > ~/hosts.txt"),
        check: function (r) { if (!ran(r, /\bipcalc\b.*\/22/)) return "Ask ipcalc about 10.20.0.0/22."; return (r.read("hosts.txt") || "").trim() === "1022" ? true : "~/hosts.txt should hold the Hosts/Net number."; }
      },
      {
        id: "d3", title: "A second address",
        text: "<p>For a migration, kc-web-01 must also answer on <code>10.20.0.16</code>. Add it to eth0 (same /24, until reboot) and show eth0's addresses.</p>",
        starter: "", solution: lines("sudo ip addr add 10.20.0.16/24 dev eth0", "ip -br a show eth0"),
        check: function (r) { if (!nw(r).ifs.eth0.addrs.some(function (a) { return a.ip === "10.20.0.16" && a.prefix === 24; })) return "sudo ip addr add 10.20.0.16/24 dev eth0."; return ran(r, /\bip\b.*\ba(ddr)?\b/, function (e) { return outHas(e, /10\.20\.0\.16\/24/); }) ? true : "Show the addresses to check."; }
      }
    ],
    "net-105": [
      {
        id: "d1", title: "Shorten it",
        text: "<p>Write the short form of <code>2001:0db8:0020:0000:0000:0000:0000:0001</code> to <code>~/short.txt</code>.</p>",
        starter: "", solution: lines("echo 2001:db8:20::1 > ~/short.txt"),
        check: function (r) { return (r.read("short.txt") || "").trim().toLowerCase() === "2001:db8:20::1" ? true : "Drop the leading zeros of each group and replace the run of zero groups with ::."; }
      },
      {
        id: "d2", title: "IPv6 routes",
        text: "<p>Show the IPv6 routing table. Where does the default route point?</p>",
        starter: "", solution: lines("ip -6 route"),
        check: function (r) { return ran(r, /\bip\b.*-6.*\br(oute)?\b/, function (e) { return outHas(e, /^default via fe80::1 dev eth0 proto ra/); }) ? true : "ip -6 route: the default route goes to the router's link-local address."; }
      },
      {
        id: "d3", title: "Google over IPv6",
        text: "<p>Ping <code>dns.google</code> over <b>IPv6</b>, twice.</p>",
        starter: "", solution: lines("ping -6 -c 2 dns.google"),
        check: function (r) { return ran(r, /\bping6?\b.*dns\.google/, function (e) { return outHas(e, /2001:4860:4860::8888/) && received(e); }) ? true : "ping -6 -c 2 dns.google."; }
      }
    ],
    "net-106": [
      {
        id: "d1", title: "Which way out?",
        text: "<p>Ask the kernel which route it would use to reach <code>8.8.8.8</code>.</p>",
        starter: "", solution: lines("ip route get 8.8.8.8"),
        check: function (r) { return ran(r, /\bip\b.*\bget\b.*8\.8\.8\.8/, function (e) { return outHas(e, /via 10\.20\.0\.1 dev eth0/); }) ? true : "ip route get 8.8.8.8."; }
      },
      {
        id: "d2", title: "A bad route", system: function (sys) { sys.nw.routes.push({ dst: "1.1.1.0", prefix: 24, via: "10.20.0.254", dev: "eth0", proto: "static", metric: 0, manual: true }); },
        text: "<p>Someone added a route that sends Cloudflare's <code>1.1.1.0/24</code> to the VPN router. Delete it and ping 1.1.1.1.</p>",
        starter: "", solution: lines("ip route", "sudo ip route del 1.1.1.0/24", "ping -c 2 1.1.1.1"),
        check: function (r) { if (nw(r).routes.some(function (x) { return x.dst === "1.1.1.0"; })) return "The 1.1.1.0/24 route is still there."; return ran(r, /\bping\b.*1\.1\.1\.1/, received) ? true : "Now ping 1.1.1.1."; }
      },
      {
        id: "d3", title: "Five hops",
        text: "<p>Traceroute to <code>8.8.8.8</code>, numeric, stopping after <b>5 hops</b>.</p>",
        starter: "", solution: lines("traceroute -n -m 5 8.8.8.8"),
        check: function (r) { return ran(r, /\btraceroute\b.*8\.8\.8\.8/, function (e) { return /-m\s*5\b/.test(e.cmd) && e.out.filter(function (l) { return /^\s*\d+\s/.test(l); }).length === 5 && outHas(e, /^ 1\s+10\.20\.0\.1\s/); }) ? true : "traceroute -n -m 5 8.8.8.8: five numbered lines, numeric."; }
      }
    ],
    "net-107": [
      {
        id: "d1", title: "Database connections",
        text: "<p>Show only the <b>established</b> TCP connections to port <b>5432</b>, numeric.</p>",
        starter: "", solution: lines("ss -tn state established '( dport = :5432 )'"),
        check: function (r) { return ran(r, /\bss\b/, function (e) { var rows = e.out.filter(function (l) { return /:5432\b/.test(l); }); return rows.length === 2 && e.out.length === 3; }) ? true : "ss -tn state established '( dport = :5432 )' shows exactly the two app-to-database connections."; }
      },
      {
        id: "d2", title: "Who's on 22?",
        text: "<p>Show which program listens on TCP port <b>22</b> (only that port).</p>",
        starter: "", solution: lines("sudo ss -tlnp sport = :22"),
        check: function (r) { return ran(r, /\bss\b/, function (e) { return NH.rootish(e) && outHas(e, /:22\b.*sshd/) && !outHas(e, /:80\b/); }) ? true : "sudo ss -tlnp with a filter for port 22 (sport = :22)."; }
      },
      {
        id: "d3", title: "rsync's port",
        text: "<p>Is the rsync port (<b>873</b>) open on kc-backup-01? Test it with nc.</p>",
        starter: "", solution: lines("nc -zv kc-backup-01 873"),
        check: function (r) { return ran(r, /\bnc\b.*(kc-backup-01|10\.20\.0\.31).*873/, function (e) { return outHas(e, /succeeded/); }) ? true : "nc -zv kc-backup-01 873."; }
      }
    ],
    "net-108": [
      {
        id: "d1", title: "When does it expire?",
        text: "<p>Print only the <b>expiry date</b> of <code>/etc/letsencrypt/live/kestrel.example.com/cert.pem</code>.</p>",
        starter: "", solution: lines("openssl x509 -in /etc/letsencrypt/live/kestrel.example.com/cert.pem -noout -enddate"),
        check: function (r) { return ran(r, /\bopenssl\s+x509\b/, function (e) { return e.out.length === 1 && /^notAfter=Jan 18 08:12:43 2027 GMT$/.test(e.out[0]); }) ? true : "openssl x509 -noout -enddate prints one line."; }
      },
      {
        id: "d2", title: "Encode it",
        text: "<p>base64-encode the text <code>kc-web-01</code> (no newline at the end).</p>",
        starter: "", solution: lines("echo -n kc-web-01 | base64"),
        check: function (r) { return ran(r, /\bbase64\b/, function (e) { return outHas(e, /^a2Mtd2ViLTAx$/); }) ? true : "echo -n (no trailing newline) piped to base64."; }
      },
      {
        id: "d3", title: "Read a gzip", system: X.tlsLab,
        text: "<p>Print the contents of <code>~/encoded/orders.json.gz</code> without unpacking it to disk.</p>",
        starter: "", solution: lines("zcat ~/encoded/orders.json.gz"),
        check: function (r) { return ran(r, /\b(zcat|gunzip|gzip)\b/, function (e) { return outHas(e, /"orders"/); }) && (r.exists("encoded/orders.json.gz")) ? true : "zcat (or gunzip -c) prints a .gz without changing it."; }
      }
    ],
    "net-109": [
      {
        id: "d1", title: "Name servers",
        text: "<p>Ask DNS for the <b>NS</b> records of <code>kestrel.example.com</code>, data only.</p>",
        starter: "", solution: lines("dig NS kestrel.example.com +short"),
        check: function (r) { return ran(r, /\bdig\b/, function (e) { return SH.same(e.out.slice().sort(), ["ns1.example-dns.net.", "ns2.example-dns.net."]); }) ? true : "dig NS kestrel.example.com +short."; }
      },
      {
        id: "d2", title: "Reverse lookup",
        text: "<p>Which name belongs to <code>10.20.0.21</code>? Do a reverse lookup, data only.</p>",
        starter: "", solution: lines("dig -x 10.20.0.21 +short"),
        check: function (r) { return ran(r, /\bdig\b.*-x\s+10\.20\.0\.21/, function (e) { return outHas(e, /^kc-db-01\.kestrel\.internal\.$/); }) ? true : "dig -x 10.20.0.21 +short."; }
      },
      {
        id: "d3", title: "Follow the alias",
        text: "<p><code>status.kestrel.example.com</code> is an alias. Show what it points to and the final address, data only.</p>",
        starter: "", solution: lines("dig +short status.kestrel.example.com"),
        check: function (r) { return ran(r, /\bdig\b.*status\.kestrel/, function (e) { return SH.same(e.out, ["kestrel-status.statuspage.example.net.", "198.51.100.200"]); }) ? true : "dig +short status.kestrel.example.com prints the CNAME target, then the address."; }
      }
    ],
    "net-110": [
      {
        id: "d1", title: "Just the code",
        text: "<p>Print only the status code of <code>https://kestrel.example.com/nope</code>.</p>",
        starter: "", solution: lines("curl -s -o /dev/null -w '%{http_code}\\n' https://kestrel.example.com/nope"),
        check: function (r) { return ran(r, /\bcurl\b.*\/nope/, function (e) { return SH.same(e.out, ["404"]); }) ? true : "curl -s -o /dev/null -w '%{http_code}\\n' URL."; }
      },
      {
        id: "d2", title: "Old school",
        text: "<p>Fetch the headers of <code>https://kestrel.example.com/</code> forcing <b>HTTP/1.1</b>.</p>",
        starter: "", solution: lines("curl -sI --http1.1 https://kestrel.example.com/"),
        check: function (r) { return ran(r, /\bcurl\b.*--http1\.1/, function (e) { return outHas(e, /^HTTP\/1\.1 200 OK/); }) ? true : "curl -I with --http1.1."; }
      },
      {
        id: "d3", title: "Which server?",
        text: "<p>Show only the <code>server</code> header of <code>https://kestrel.example.com/</code>.</p>",
        starter: "", solution: lines("curl -sI https://kestrel.example.com/ | grep -i '^server'"),
        check: function (r) { return ran(r, /\bcurl\b.*\|\s*grep/, function (e) { return SH.same(e.out, ["server: nginx"]); }) ? true : "Pipe curl -sI into grep -i '^server'."; }
      }
    ],
    "net-111": [
      {
        id: "d1", title: "No names", system: function (sys) { X.setNetplan(sys, N.NETPLAN.replace("addresses: [10.20.0.2]", "addresses: [10.20.0.4]")); },
        text: "<p>Names don't resolve on kc-web-01. Find out why, fix it permanently, and resolve <code>kestrel.example.com</code>.</p>",
        starter: "", solution: lines("resolvectl status", "sudo sed -i 's/10.20.0.4/10.20.0.2/' /etc/netplan/01-kestrel.yaml", "sudo netplan apply", "dig +short kestrel.example.com"),
        check: function (r) { var a = N.askServer(r.sys, "127.0.0.53", "kestrel.example.com", "A", { quiet: true }); if (a.err || a.status !== "NOERROR") return "Names still don't resolve. Which DNS server is configured (resolvectl status)?"; return ran(r, /\b(dig|host|getent|nslookup)\b.*kestrel\.example\.com/, function (e) { return outHas(e, /203\.0\.113\.80/); }) ? true : "Resolve kestrel.example.com to prove it."; }
      },
      {
        id: "d2", title: "No way out", system: function (sys) { X.setNetplan(sys, N.NETPLAN.replace("via: 10.20.0.1", "via: 10.20.1.1")); },
        text: "<p>kc-web-01 can't reach the internet. Find the fault, fix it permanently, and ping 1.1.1.1.</p>",
        starter: "", solution: lines("ip r", "journalctl -u systemd-networkd", "sudo sed -i 's/via: 10.20.1.1/via: 10.20.0.1/' /etc/netplan/01-kestrel.yaml", "sudo netplan apply", "ping -c 2 1.1.1.1"),
        check: function (r) { if (!NH.reachOk(r, "1.1.1.1")) return "No route to the internet yet: what does ip r show? (journalctl -u systemd-networkd says why netplan's route was rejected.)"; return ran(r, /\bping\b.*1\.1\.1\.1/, received) ? true : "Ping 1.1.1.1."; }
      },
      {
        id: "d3", title: "Bad gateway", system: function (sys) { M2.listeners(sys); sys.procs = sys.procs.filter(function (p) { return p.unit !== "kestrel-app.service"; }); var u = M2.loadUnit(sys, "kestrel-app.service"); if (u) { u.rt.active = "failed"; u.rt.sub = "failed"; u.rt.result = "exit-code"; } },
        text: "<p><code>https://kestrel.example.com/api/health</code> answers <b>502</b>. Find out why and fix it.</p>",
        starter: "", solution: lines("curl -s https://kestrel.example.com/api/health", "sudo ss -tlnp", "systemctl status kestrel-app", "sudo systemctl restart kestrel-app", "curl -s https://kestrel.example.com/api/health"),
        check: function (r) { return ran(r, /\bcurl\b.*api\/health/, function (e) { return outHas(e, /"status":"ok"/); }) ? true : "The app behind nginx isn't running. Start it, then curl /api/health."; }
      }
    ]
  };
  T.LABS.forEach(function (l) { if (DRILLS[l.id]) l.drills = DRILLS[l.id].map(function (d) { d.layer = d.layer || l.layer; return d; }); });
})();
