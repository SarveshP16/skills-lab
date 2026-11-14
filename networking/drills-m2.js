/* sudo learn — Networking Module 2 practice drills (3 per lab, +5 XP each). Loaded after labs-m2.js. */
(function () {
  "use strict";
  var T = window.NET_TRACK, S = window.ShEngine, M2 = S.M2, N = window.NetCore, NH = window.NetLab.H, SH = window.ShLab.H, X = T.M2, W = N.W;
  var lines = T.lines, ran = NH.ran, outHas = NH.outHas;
  function anyOut(r, re) { return r.history.some(function (e) { return e.out.concat(e.err).some(function (l) { return re.test(l); }); }); }
  function word(r, p) { return (r.read(p) || "").trim().toLowerCase(); }
  var WEB = T.M1.webCapture();

  var DRILLS = {
    "net-201": [
      { id: "d1", title: "Postgres's port", text: "<p>Ask <code>getent</code> which port <b>postgresql</b> uses.</p>", starter: "", solution: lines("getent services postgresql"),
        check: function (r) { return ran(r, /\bgetent\s+services\b/, function (e) { return outHas(e, /^postgresql\s+5432\/tcp/); }) ? true : "getent services postgresql."; } },
      { id: "d2", title: "Who has 443?", text: "<p>Show only the listener on TCP port <b>443</b> on kc-web-01, with its program.</p>", starter: "", solution: lines("sudo ss -tlnp sport = :443"),
        check: function (r) { return ran(r, /\bss\b/, function (e) { return NH.rootish(e) && outHas(e, /:443\b.*nginx/) && !outHas(e, /:80\b/); }) ? true : "sudo ss -tlnp with a filter: sport = :443."; } },
      { id: "d3", title: "Above 1024", text: "<p>Scan kc-legacy-01's ports <b>2200 to 2300</b> and print only the open ones.</p>", starter: "", solution: lines("nc -zv -w 1 kc-legacy-01 2200-2300 2>&1 | grep succeeded"),
        check: function (r) { return ran(r, /\bnc\b/, function (e) { return e.out.length === 1 && / 2222 port .*succeeded/.test(e.out[0]); }) ? true : "nc -zv over the range, stderr into grep succeeded."; } }
    ],
    "net-202": [
      { id: "d1", title: "Redis version", text: "<p>Ask Redis on kc-data-01 for its <code>INFO server</code> section.</p>", starter: "", solution: lines("printf 'INFO server\\r\\n' | nc kc-data-01 6379"),
        check: function (r) { return ran(r, /\bnc\b.*6379/, function (e) { return outHas(e, /^redis_version:7\.0\.15/); }) ? true : "printf 'INFO server\\r\\n' | nc kc-data-01 6379"; } },
      { id: "d2", title: "Which cluster?", text: "<p>What's the Elasticsearch cluster's name on kc-data-01? Write it to <code>~/cluster.txt</code>.</p>", starter: "", solution: lines("curl -s http://kc-data-01:9200/", "echo kestrel-logs > ~/cluster.txt"),
        check: function (r) { if (!ran(r, /\bcurl\b.*9200/)) return "curl http://kc-data-01:9200/"; return word(r, "cluster.txt") === "kestrel-logs" ? true : "The cluster_name field."; } },
      { id: "d3", title: "STARTTLS", text: "<p>Check that the mail server's submission port (<b>587</b>) upgrades to TLS with STARTTLS.</p>", starter: "", solution: lines("echo | openssl s_client -starttls smtp -connect mail.kestrel.example.com:587 -brief"),
        check: function (r) { return ran(r, /\bopenssl\s+s_client\b.*-starttls\s+smtp.*587|\bopenssl\s+s_client\b.*587.*-starttls\s+smtp/, function (e) { return outHas(e, /Protocol version: TLSv1\.3/); }) ? true : "openssl s_client -starttls smtp -connect mail.kestrel.example.com:587 -brief"; } }
    ],
    "net-203": [
      { id: "d1", title: "ARP with MACs", text: "<p>Capture <b>2 ARP</b> packets on eth0, showing the Ethernet header.</p>", starter: "", solution: lines("sudo tcpdump -i eth0 -n -e -c 2 arp"),
        check: function (r) { return ran(r, /\btcpdump\b/, function (e) { return e.out.length === 2 && e.out.every(function (l) { return /ethertype ARP/.test(l); }); }) ? true : "-e and the arp filter, with -c 2."; } },
      { id: "d2", title: "Save HTTPS", text: "<p>Save <b>4 packets</b> of port 443 traffic on eth0 to <code>~/https.pcap</code> (no background needed: -c ends it).</p>", starter: "", solution: lines("sudo tcpdump -i eth0 -n -c 4 -w ~/https.pcap port 443"),
        check: function (r) { var pk = N.readPcap(r.read("https.pcap") || ""); return pk && pk.length === 4 && pk.every(function (p) { return p.tcp && (p.tcp.sport === 443 || p.tcp.dport === 443); }) ? true : "-c 4 -w ~/https.pcap port 443."; } },
      { id: "d3", title: "See your GET", text: "<p>Capture <b>port 80</b> in the background while you curl <code>http://kc-legacy-01/</code>, then stop. The request line should appear.</p>", starter: "", solution: lines("sudo tcpdump -i eth0 -n port 80 &", "curl -s http://kc-legacy-01/", "sudo pkill tcpdump"),
        check: function (r) { return anyOut(r, /HTTP: GET \/ HTTP\/1\.1/) ? true : "Background capture of port 80, then curl, then sudo pkill tcpdump."; } }
    ],
    "net-204": [
      { id: "d1", title: "A reset, live", text: "<p>Capture traffic with kc-db-01 in the background while you try its port 6379 with nc. Stop it. You should see the RST.</p>", starter: "", solution: lines("sudo tcpdump -i eth0 -n host 10.20.0.21 &", "nc -zv kc-db-01 6379", "sudo pkill tcpdump"),
        check: function (r) { return anyOut(r, /10\.20\.0\.21\.6379 > 10\.20\.0\.15\.\d+: Flags \[R\.\]/) ? true : "Start the capture first, then nc -zv kc-db-01 6379."; } },
      { id: "d2", title: "Only SYN-ACKs", files: { "captures/web-request.pcap": N.pcapFile(WEB.all) }, text: "<p>Print only the <b>SYN-ACK</b> packets in <code>~/captures/web-request.pcap</code>.</p>", starter: "", solution: lines("tcpdump -r ~/captures/web-request.pcap -n 'tcp[tcpflags] & (tcp-syn|tcp-ack) == (tcp-syn|tcp-ack)'"),
        check: function (r) { return ran(r, /\btcpdump\b.*web-request/, function (e) { return e.out.length === 1 && /Flags \[S\.\]/.test(e.out[0]); }) ? true : "'tcp[tcpflags] & (tcp-syn|tcp-ack) == (tcp-syn|tcp-ack)'"; } },
      { id: "d3", title: "Goodbyes", files: { "captures/web-request.pcap": N.pcapFile(WEB.all) }, text: "<p>Print only the packets with <b>FIN</b> set in the same capture.</p>", starter: "", solution: lines("tcpdump -r ~/captures/web-request.pcap -n 'tcp[tcpflags] & tcp-fin != 0'"),
        check: function (r) { return ran(r, /\btcpdump\b.*web-request/, function (e) { return e.out.length === 2 && e.out.every(function (l) { return /Flags \[F\.\]/.test(l); }); }) ? true : "'tcp[tcpflags] & tcp-fin != 0'"; } }
    ],
    "net-205": [
      { id: "d1", title: "How much DNS?", system: X.preTshark, files: { "captures/day.pcap": N.pcapFile(X.dayCapture(false)) }, text: "<p>Count the DNS packets in <code>~/captures/day.pcap</code> (one number).</p>", starter: "", solution: lines("tshark -r ~/captures/day.pcap -Y dns | wc -l"),
        check: function (r) { return ran(r, /\btshark\b.*\|\s*wc\b/, function (e) { return SH.same(e.out.map(function (l) { return l.trim(); }), ["8"]); }) ? true : "tshark -r FILE -Y dns | wc -l"; } },
      { id: "d2", title: "Who pings?", system: X.preTshark, files: { "captures/day.pcap": N.pcapFile(X.dayCapture(false)) }, text: "<p>Print the source address of every ICMP <b>echo request</b> in the capture, and nothing else.</p>", starter: "", solution: lines("tshark -r ~/captures/day.pcap -Y 'icmp.type == 8' -T fields -e ip.src"),
        check: function (r) { return ran(r, /\btshark\b/, function (e) { return e.out.length === 2 && e.out.every(function (l) { return l.trim() === "10.20.5.10"; }); }) ? true : "A display filter for echo requests and -T fields -e ip.src (try icmp.type == 8, or icmp and ip.dst == 10.20.0.15)."; } },
      { id: "d3", title: "Protocol mix", system: X.preTshark, files: { "captures/day.pcap": N.pcapFile(X.dayCapture(false)) }, text: "<p>Show the protocol hierarchy statistics of the capture.</p>", starter: "", solution: lines("tshark -r ~/captures/day.pcap -q -z io,phs"),
        check: function (r) { return ran(r, /\btshark\b.*io,phs/, function (e) { return outHas(e, /Protocol Hierarchy Statistics/); }) ? true : "-q -z io,phs"; } }
    ],
    "net-206": [
      { id: "d1", title: "Full size to the internet", text: "<p>Send a full 1500-byte ping with \"don't fragment\" to <code>1.1.1.1</code>, twice. Does it get through?</p>", starter: "", solution: lines("ping -M do -s 1472 -c 2 1.1.1.1"),
        check: function (r) { return ran(r, /\bping\b.*-s\s*1472/, function (e) { return /-M\s*do/.test(e.cmd) && / 0% packet loss/.test(e.out.join("\n")); }) ? true : "ping -M do -s 1472 -c 2 1.1.1.1"; } },
      { id: "d2", title: "Tracepath", text: "<p>Use <code>tracepath</code> (numeric) to example.com: it reports the path MTU as it goes.</p>", starter: "", solution: lines("tracepath -n example.com"),
        check: function (r) { return ran(r, /\btracepath\b.*example\.com/, function (e) { return outHas(e, /pmtu 1500/); }) ? true : "tracepath -n example.com"; } },
      { id: "d3", title: "Echo and reply", text: "<p>Capture ICMP in the background while you ping kc-db-01 once. Stop it.</p>", starter: "", solution: lines("sudo tcpdump -i eth0 -n icmp &", "ping -c 1 kc-db-01", "sudo pkill tcpdump"),
        check: function (r) { return anyOut(r, /ICMP echo request/) && anyOut(r, /ICMP echo reply/) ? true : "Start the capture first, then ping."; } }
    ],
    "net-207": [
      { id: "d1", title: "DNS over TCP", text: "<p>Look up <code>example.com</code> over <b>TCP</b> with dig.</p>", starter: "", solution: lines("dig +tcp example.com"),
        check: function (r) { return ran(r, /\bdig\b.*\+tcp/, function (e) { return outHas(e, /\(TCP\)$/) && outHas(e, /93\.184\.215\.14/); }) ? true : "dig +tcp example.com"; } },
      { id: "d2", title: "No such name", text: "<p>Capture port 53 in the background while you look up <code>nosuchname.example.com</code>. Stop it.</p>", starter: "", solution: lines("sudo tcpdump -i eth0 -n port 53 &", "dig nosuchname.example.com", "sudo pkill tcpdump"),
        check: function (r) { return anyOut(r, /NXDomain/) ? true : "Background capture of port 53, then the dig, then sudo pkill tcpdump."; } },
      { id: "d3", title: "A lease", system: X.buildNic, text: "<p>Put <code>~/02-build.yaml</code> in place (root-only) and apply it. Show eth1's address.</p>", starter: "", solution: lines("sudo cp ~/02-build.yaml /etc/netplan/", "sudo chmod 600 /etc/netplan/02-build.yaml", "sudo netplan apply", "ip -br a show eth1"),
        check: function (r) { if (!r.sys.nw.ifs.eth1.addrs.some(function (a) { return a.dhcp; })) return "eth1 has no DHCP address yet."; return ran(r, /\bip\b.*\ba(ddr)?\b/, function (e) { return outHas(e, /10\.20\.60\.15\/24/); }) ? true : "Show eth1's address with ip -br a."; } }
    ],
    "net-208": [
      { id: "d1", title: "Total time", text: "<p>Print only the total time of a request to <code>https://example.com/</code>.</p>", starter: "", solution: lines("curl -s -o /dev/null -w '%{time_total}\\n' https://example.com/"),
        check: function (r) { return ran(r, /\bcurl\b.*time_total/, function (e) { return e.out.length === 1 && /^\d+\.\d+$/.test(e.out[0].trim()); }) ? true : "curl -s -o /dev/null -w '%{time_total}\\n' URL"; } },
      { id: "d2", title: "Drop the dead server", system: X.slow, text: "<p>Lookups wait 5 seconds. Fix it by <b>editing</b> <code>/etc/resolv.conf</code> (remove the nameserver that doesn't answer), then resolve kestrel.example.com.</p>", starter: "", solution: lines("sudo sed -i '/10.20.0.9/d' /etc/resolv.conf", "getent hosts kestrel.example.com"),
        check: function (r) { if ((N.getaddrinfo(r.sys, "kestrel.example.com", 4).delay || 0) > 0) return "The dead server is still in /etc/resolv.conf."; return ran(r, /\b(getent|dig|host|curl|ping)\b.*kestrel\.example\.com/) ? true : "Resolve kestrel.example.com to check."; } },
      { id: "d3", title: "Numeric mtr", text: "<p>An mtr report to <code>1.1.1.1</code>, numeric, 5 cycles.</p>", starter: "", solution: lines("mtr -r -n -c 5 1.1.1.1"),
        check: function (r) { return ran(r, /\bmtr\b.*1\.1\.1\.1/, function (e) { return outHas(e, /^\s+1\.\|-- 10\.20\.0\.1\s/) && outHas(e, /1\.1\.1\.1\s+0\.0%\s+5/); }) ? true : "mtr -r -n -c 5 1.1.1.1"; } }
    ],
    "net-209": [
      { id: "d1", title: "Only one left", system: X.twoApps, text: "<p>Stop the first app instance (<code>kestrel-app</code>) and show that whoami still answers.</p>", starter: "", solution: lines("sudo systemctl stop kestrel-app", "curl -s https://kestrel.example.com/api/whoami"),
        check: function (r) { var u = M2.loadUnit(r.sys, "kestrel-app.service"); if (u && u.rt.active === "active") return "Stop kestrel-app first."; return ran(r, /\bcurl\b.*whoami/, function (e) { return outHas(e, /"instance":"app-2"/); }) ? true : "Call /api/whoami after stopping it."; } },
      { id: "d2", title: "Take one out", system: X.twoApps, text: "<p>Take <code>127.0.0.1:8081</code> out of rotation by marking it <code>down</code> in <code>/etc/nginx/conf.d/kestrel-upstream.conf</code>. Test, reload, and call whoami twice: always app-1.</p>", starter: "", solution: lines("sudo sed -i 's/server 127.0.0.1:8081;/server 127.0.0.1:8081 down;/' /etc/nginx/conf.d/kestrel-upstream.conf", "sudo nginx -t", "sudo systemctl reload nginx", "curl -s https://kestrel.example.com/api/whoami", "curl -s https://kestrel.example.com/api/whoami"),
        check: function (r) { if (!/127\.0\.0\.1:8081\s+down/.test(r.read("/etc/nginx/conf.d/kestrel-upstream.conf") || "")) return "Add down after server 127.0.0.1:8081."; var k = NH.idx(r, /reload\b.*nginx|nginx\s+-s\s+reload/); var n = r.history.filter(function (e, i) { return i > k && /\bcurl\b.*whoami/.test(e.cmd) && outHas(e, /"instance":"app-1"/); }).length; return k >= 0 && n >= 2 ? true : "Reload nginx, then call whoami twice."; } },
      { id: "d3", title: "The whole config", system: X.twoApps, text: "<p>Print nginx's complete configuration and find the upstream block in it.</p>", starter: "", solution: lines("sudo nginx -T | grep -A 3 upstream"),
        check: function (r) { return ran(r, /\bnginx\s+-T\b/, function (e) { return outHas(e, /upstream kestrel_app/); }) ? true : "sudo nginx -T prints the whole config; grep for upstream."; } }
    ],
    "net-210": [
      { id: "d1", title: "UDP conversations", system: X.preTshark, files: { "captures/mystery.pcap": N.pcapFile(X.mystery(false)) }, text: "<p>List the <b>UDP</b> conversations in <code>~/captures/mystery.pcap</code>.</p>", starter: "", solution: lines("tshark -r ~/captures/mystery.pcap -q -z conv,udp"),
        check: function (r) { return ran(r, /\btshark\b.*conv,udp/, function (e) { return outHas(e, /UDP Conversations/) && outHas(e, /:161\b/); }) ? true : "-q -z conv,udp"; } },
      { id: "d2", title: "How many ports?", system: X.preTshark, files: { "captures/mystery.pcap": N.pcapFile(X.mystery(false)) }, text: "<p>How many different ports did 10.20.5.47 send a <b>first SYN</b> to? Write the number to <code>~/probed.txt</code>.</p>", starter: "", solution: lines("tshark -r ~/captures/mystery.pcap -Y 'ip.src == 10.20.5.47 && tcp.flags.syn == 1 && tcp.flags.ack == 0' -T fields -e tcp.dstport | sort -u | wc -l", "echo 25 > ~/probed.txt"),
        check: function (r) { var pk = N.readPcap(r.read("captures/mystery.pcap")), ports = {}; pk.forEach(function (p) { if (p.tcp && p.ip.src === "10.20.5.47" && p.tcp.flags === "S") ports[p.tcp.dport] = 1; }); var n = Object.keys(ports).length; if (!ran(r, /\b(tshark|tcpdump)\b.*mystery/)) return "Filter the capture for SYNs from 10.20.5.47."; return word(r, "probed.txt") === String(n) ? true : "Count the distinct destination ports of its SYN-only packets."; } },
      { id: "d3", title: "SSH from where?", system: X.preTshark, files: { "captures/mystery.pcap": N.pcapFile(X.mystery(false)) }, text: "<p>Which address had an SSH session to kc-web-01 in the capture? Write it to <code>~/ssh-client.txt</code>.</p>", starter: "", solution: lines("tcpdump -r ~/captures/mystery.pcap -n port 22 and host 10.20.0.15", "echo 10.20.5.22 > ~/ssh-client.txt"),
        check: function (r) { if (!ran(r, /\b(tshark|tcpdump)\b.*mystery/)) return "Look at the port 22 traffic in the capture."; return word(r, "ssh-client.txt") === "10.20.5.22" ? true : "The other end of the port 22 conversation."; } }
    ]
  };
  T.LABS.forEach(function (l) { if (DRILLS[l.id]) l.drills = DRILLS[l.id].map(function (d) { d.layer = d.layer || l.layer; return d; }); });
})();
