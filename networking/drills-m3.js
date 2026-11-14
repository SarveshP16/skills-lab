/* sudo learn — Networking Module 3 practice drills (3 per lab, +5 XP each). Loaded after labs-m3.js. */
(function () {
  "use strict";
  var T = window.NET_TRACK, S = window.ShEngine, M2 = S.M2, M3 = S.M3, N = window.NetCore, NH = window.NetLab.H, X = T.M3, W = N.W;
  var lines = T.lines, ran = NH.ran, outHas = NH.outHas, idx = NH.idx;
  function word(r, p) { return (r.read(p) || "").trim().toLowerCase(); }
  function after(r, i, re, fn) { return r.history.some(function (e, k) { return k > i && re.test(e.cmd) && (!fn || fn(e)); }); }
  var CLEAR = { "captures/office.pcap": N.pcapFile(X.clearCapture()) }, SCAN = { "captures/scan.pcap": N.pcapFile(X.scanCapture()) };
  var POISON = { "captures/dns-burst.pcap": N.pcapFile(X.poisonCapture()) }, IDS = { "captures/ids.pcap": N.pcapFile(X.idsCapture()) };
  var LAN = { "captures/lan.pcap": N.pcapFile(X.zeekCapture()) }, INC = { "captures/incident.pcap": N.pcapFile(X.incident()), "evidence/legacy-access.log": X.accessLog() };
  var TSHARK = X.pre(["tshark"]), ZEEK = X.pre(["zeek"]), SURI = X.pre(["suricata", "jq"]);
  function localHits(r, pk) { return X.alertsOf(X.localRules(r).filter(Boolean), pk); }

  var DRILLS = {
    "net-301": [
      { id: "d1", title: "Every HTTP request", files: CLEAR, system: TSHARK, text: "<p>List every HTTP <b>request</b> in <code>~/captures/office.pcap</code>: method, host and URI.</p>", starter: "", solution: lines("tshark -r ~/captures/office.pcap -Y http.request -T fields -e http.request.method -e http.host -e http.request.uri"),
        check: function (r) { return ran(r, /\btshark\b.*http\.request/, function (e) { return e.out.length === 2 && outHas(e, /^POST\s+intranet\.kestrel\.internal\s+\/login$/); }) ? true : "tshark -Y http.request -T fields -e http.request.method -e http.host -e http.request.uri"; } },
      { id: "d2", title: "Decode it", text: "<p>Decode <code>bmV0b3BzOnMzY3JldA==</code> and write the result to <code>~/decoded.txt</code>.</p>", starter: "", solution: lines("echo 'bmV0b3BzOnMzY3JldA==' | base64 -d > ~/decoded.txt"),
        check: function (r) { return (r.read("decoded.txt") || "").trim() === "netops:s3cret" ? true : "echo ... | base64 -d > ~/decoded.txt"; } },
      { id: "d3", title: "The cookie", files: CLEAR, system: TSHARK, text: "<p>The intranet answered the login with a session cookie. Print its <b>Set-Cookie</b> header from the capture.</p>", starter: "", solution: lines("tcpdump -r ~/captures/office.pcap -n -A port 80 | grep Set-Cookie"),
        check: function (r) { return ran(r, /\b(tcpdump|tshark)\b.*office\.pcap/, function (e) { return outHas(e, /Set-Cookie: PHPSESSID=8f1c2e9a/); }) ? true : "tcpdump -A on port 80, filtered with grep Set-Cookie."; } }
    ],
    "net-302": [
      { id: "d1", title: "How many probes?", files: SCAN, system: TSHARK, text: "<p>How many SYNs did the scanner send in <code>~/captures/scan.pcap</code>? Write the number to <code>~/probes.txt</code>.</p>", starter: "", solution: lines("tcpdump -r ~/captures/scan.pcap -n 'tcp[tcpflags] == tcp-syn and src host 45.155.205.233' | wc -l > ~/probes.txt"),
        check: function (r) { if (!ran(r, /\b(tcpdump|tshark)\b.*scan\.pcap/)) return "Filter the capture for the scanner's SYNs and count them."; return word(r, "probes.txt") === "25" ? true : "Count only the scanner's SYN-only packets."; } },
      { id: "d2", title: "Busiest guesser", system: X.bruteSys, text: "<p>Print the <b>usernames</b> tried by 203.0.113.50 in /var/log/auth.log, each once, sorted.</p>", starter: "", solution: lines("sudo grep 'Failed password' /var/log/auth.log | grep 203.0.113.50 | grep -oE 'for (invalid user )?[a-z]+' | awk '{print $NF}' | sort -u"),
        check: function (r) { return ran(r, /\bauth\.log\b/, function (e) { var o = e.out.map(function (l) { return l.trim(); }); return o.length === 10 && o.indexOf("root") >= 0 && o.indexOf("oracle") >= 0 && o.join(",") === o.slice().sort().join(","); }) ? true : "Ten names, each once, sorted: grep, extract the name, sort -u."; } },
      { id: "d3", title: "When did it work?", system: X.bruteSys, text: "<p>Show just the <b>Accepted password</b> line (only that line) from /var/log/auth.log.</p>", starter: "", solution: lines("sudo grep 'Accepted password' /var/log/auth.log"),
        check: function (r) { return ran(r, /\bauth\.log\b/, function (e) { var hit = e.out.filter(function (l) { return /sshd\[\d+\]: Accepted /.test(l); }); return hit.length === 1 && /Accepted password for deploy from 198\.51\.100\.23/.test(hit[0]); }) ? true : "sudo grep 'Accepted password' /var/log/auth.log"; } }
    ],
    "net-303": [
      { id: "d1", title: "Two MACs", system: X.mitmSys, text: "<p>Ask for the gateway with <code>arping</code> (3 requests on eth0) and see two different MACs answer.</p>", starter: "", solution: lines("sudo arping -c 3 -I eth0 10.20.0.1"),
        check: function (r) { return ran(r, /\barping\b.*10\.20\.0\.1/, function (e) { return outHas(e, new RegExp(X.EVIL_MAC, "i")) && outHas(e, new RegExp(W.MAC.gw, "i")); }) ? true : "sudo arping -c 3 -I eth0 10.20.0.1"; } },
      { id: "d2", title: "Only replies", system: X.mitmSys, text: "<p>Capture <b>8 ARP packets</b> on eth0 and print only the <b>replies</b> (is-at).</p>", starter: "", solution: lines("sudo tcpdump -i eth0 -n -c 8 arp | grep is-at"),
        check: function (r) { return ran(r, /\btcpdump\b.*\barp\b/, function (e) { return e.out.length >= 3 && e.out.every(function (l) { return /Reply .* is-at/.test(l); }); }) ? true : "tcpdump -c 8 arp, piped into grep is-at."; } },
      { id: "d3", title: "Unpin", system: function (sys) { X.mitmSys(sys); sys.nw.arpSpoof = null; sys.nw.neigh["10.20.0.1"] = { mac: W.MAC.gw, dev: "eth0", state: "PERMANENT", perm: true }; }, text: "<p>The spoofer is gone. Remove the <b>permanent</b> neighbour entry for 10.20.0.1, so ARP works normally again.</p>", starter: "", solution: lines("sudo ip neigh del 10.20.0.1 dev eth0"),
        check: function (r) { var n = r.sys.nw.neigh["10.20.0.1"]; return n && n.perm ? "The permanent entry is still there: ip neigh del 10.20.0.1 dev eth0." : true; } }
    ],
    "net-304": [
      { id: "d1", title: "Who's authoritative?", text: "<p>Show the <b>name servers</b> for kestrel.example.com, short form.</p>", starter: "", solution: lines("dig NS kestrel.example.com +short"),
        check: function (r) { return ran(r, /\bdig\b.*\bNS\b.*kestrel|\bdig\b.*kestrel.*\bNS\b/i, function (e) { return e.out.length >= 1 && e.out.every(function (l) { return /\.$/.test(l.trim()); }); }) ? true : "dig NS kestrel.example.com +short"; } },
      { id: "d2", title: "Forged TTLs", files: POISON, system: TSHARK, text: "<p>Print the distinct <b>TTLs</b> of the answers in <code>~/captures/dns-burst.pcap</code>, with how many replies had each.</p>", starter: "", solution: lines("tshark -r ~/captures/dns-burst.pcap -Y 'dns.flags.response == 1' -T fields -e dns.resp.ttl | sort | uniq -c"),
        check: function (r) { return ran(r, /\btshark\b.*dns\.resp\.ttl/, function (e) { return outHas(e, /^\s*40\s+604800$/) && outHas(e, /^\s*1\s+300$/); }) ? true : "-T fields -e dns.resp.ttl, then sort | uniq -c."; } },
      { id: "d3", title: "Programs vs dig", system: X.poisonSys, text: "<p>Resolve <code>api.partner-pay.example</code> the way <b>programs</b> do (hosts file first).</p>", starter: "", solution: lines("getent hosts api.partner-pay.example"),
        check: function (r) { return ran(r, /\bgetent\s+(a)?hosts\b.*partner-pay/, function (e) { return outHas(e, /203\.0\.113\.200/); }) ? true : "getent hosts NAME"; } }
    ],
    "net-305": [
      { id: "d1", title: "Current setting", text: "<p>Show the running value of <code>net.ipv4.tcp_syncookies</code>.</p>", starter: "", solution: lines("sysctl net.ipv4.tcp_syncookies"),
        check: function (r) { return ran(r, /\bsysctl\b.*tcp_syncookies/, function (e) { return outHas(e, /^net\.ipv4\.tcp_syncookies = 1$/); }) ? true : "sysctl net.ipv4.tcp_syncookies"; } },
      { id: "d2", title: "Half-open by peer", system: X.floodSys, text: "<p>Show the first 5 half-open connections on port 443 with <b>numeric</b> addresses.</p>", starter: "", solution: lines("ss -tn state syn-recv '( sport = :443 )' | head -6"),
        check: function (r) { return ran(r, /\bss\b.*syn-recv/, function (e) { return e.out.filter(function (l) { return /:443\b/.test(l); }).length === 5; }) ? true : "ss -tn state syn-recv, then head (5 sockets plus the header)."; } },
      { id: "d3", title: "Persist it", text: "<p>Make sure SYN cookies stay <b>on</b> after a reboot: put <code>net.ipv4.tcp_syncookies = 1</code> in <code>/etc/sysctl.d/90-syncookies.conf</code> and load it.</p>", starter: "", solution: lines("echo 'net.ipv4.tcp_syncookies = 1' | sudo tee /etc/sysctl.d/90-syncookies.conf", "sudo sysctl -p /etc/sysctl.d/90-syncookies.conf"),
        check: function (r) { if (!/^\s*net\.ipv4\.tcp_syncookies\s*=\s*1\s*$/m.test(r.read("/etc/sysctl.d/90-syncookies.conf") || "")) return "Write the setting to /etc/sysctl.d/90-syncookies.conf."; return ran(r, /\bsysctl\b.*(-p|--load|--system)/) ? true : "Load it: sudo sysctl -p FILE (or --system)."; } }
    ],
    "net-306": [
      { id: "d1", title: "Test mode", system: SURI, text: "<p>Test Suricata's configuration and rules.</p>", starter: "", solution: lines("sudo suricata -T"),
        check: function (r) { return ran(r, /\bsuricata\b.*-T\b/, function (e) { return outHas(e, /successfully loaded/); }) ? true : "sudo suricata -T"; } },
      { id: "d2", title: "Alert per source", files: IDS, system: SURI, text: "<p>Run Suricata on <code>~/captures/ids.pcap</code> into <code>~/ids</code>, then count the alerts per <b>source address</b> from eve.json, most first.</p>", starter: "", solution: lines("mkdir -p ~/ids", "suricata -r ~/captures/ids.pcap -l ~/ids", "jq -r '.src_ip' ~/ids/eve.json | sort | uniq -c | sort -rn"),
        check: function (r) { return ran(r, /\bjq\b.*src_ip.*eve\.json|\bjq\b.*eve\.json/, function (e) { return /^\s*3\s+198\.51\.100\.23$/.test(e.out[0] || ""); }) ? true : "jq -r '.src_ip' ~/ids/eve.json | sort | uniq -c | sort -rn"; } },
      { id: "d3", title: "SNI rule", files: IDS, system: SURI, text: "<p>Add a rule to <code>local.rules</code> that alerts on TLS connections whose <b>SNI</b> contains <code>pastebin.com</code> (sticky buffer <code>tls.sni</code>), and check it loads.</p>", starter: "", solution: lines("echo 'alert tls $HOME_NET any -> any any (msg:\"KESTREL TLS to pastebin\"; tls.sni; content:\"pastebin.com\"; nocase; sid:1000030; rev:1;)' | sudo tee -a /etc/suricata/rules/local.rules", "sudo suricata -T"),
        check: function (r) {
          var lr = X.localRules(r);
          if (lr.some(function (x) { return !x; })) return "A rule in local.rules doesn't parse.";
          var pk = X.conv(1, "10.20.0.15", "104.20.67.143", 50000, 443, [{ enc: { tls: 22, len: 517, seed: 1 }, sni: "pastebin.com" }]), other = X.conv(1, "10.20.0.15", "140.82.121.4", 50001, 443, [{ enc: { tls: 22, len: 517, seed: 1 }, sni: "github.com" }]);
          if (!localHits(r, pk).length) return "No local rule matches a TLS ClientHello for pastebin.com.";
          if (localHits(r, other).length) return "Your rule also matches other sites.";
          return ran(r, /\bsuricata\b.*-T\b/, function (e) { return outHas(e, /0 rules failed/); }) ? true : "Test it with sudo suricata -T.";
        } }
    ],
    "net-307": [
      { id: "d1", title: "Services seen", files: LAN, system: ZEEK, text: "<p>Run Zeek on <code>~/captures/lan.pcap</code> in <code>~/zeek</code>, then count connections per <b>service</b>.</p>", starter: "", solution: lines("mkdir -p ~/zeek && cd ~/zeek", "zeek -r ~/captures/lan.pcap", "zeek-cut service < conn.log | sort | uniq -c | sort -rn"),
        check: function (r) { return ran(r, /\bzeek-cut\b.*service|\bservice\b.*zeek-cut/, function (e) { return outHas(e, /^\s*\d+\s+dns$/) && outHas(e, /^\s*\d+\s+ssl$/); }) ? true : "zeek-cut service < conn.log | sort | uniq -c"; } },
      { id: "d2", title: "Readable times", files: LAN, system: ZEEK, text: "<p>Print the HTTP requests (host and uri) with <b>human-readable</b> timestamps.</p>", starter: "", solution: lines("mkdir -p ~/zeek && cd ~/zeek", "zeek -r ~/captures/lan.pcap", "zeek-cut -d ts host uri < http.log"),
        check: function (r) { return ran(r, /\bzeek-cut\b.*-d\b/, function (e) { return outHas(e, /^2026-\d\d-\d\dT[\d:]+\+0000\s+\S+\s+\//); }) ? true : "zeek-cut -d converts the ts column."; } },
      { id: "d3", title: "Rejected", files: LAN, system: ZEEK, text: "<p>Which ports on 10.20.0.21 actively <b>refused</b> the scan (conn_state REJ)? Print just the port numbers.</p>", starter: "", solution: lines("mkdir -p ~/zeek && cd ~/zeek", "zeek -r ~/captures/lan.pcap", "zeek-cut id.resp_h id.resp_p conn_state < conn.log | awk '$1 == \"10.20.0.21\" && $3 == \"REJ\" {print $2}'"),
        check: function (r) { return ran(r, /\bzeek-cut\b/, function (e) { var o = e.out.map(function (l) { return l.trim(); }).sort(); return o.join(",") === "11211,443,80,8080"; }) ? true : "Filter conn.log for 10.20.0.21 with conn_state REJ and print id.resp_p."; } }
    ],
    "net-308": [
      { id: "d1", title: "Decode the URI", files: INC, text: "<p>Turn the web shell commands in <code>~/evidence/legacy-access.log</code> into readable commands: print each <code>c=</code> value with <code>%20</code> as spaces.</p>", starter: "", solution: lines("grep -o 'c=[^ ]*' ~/evidence/legacy-access.log | sed 's/^c=//; s/%20/ /g'"),
        check: function (r) { return ran(r, /legacy-access\.log/, function (e) { return e.out.length === 4 && outHas(e, /^sudo -n id$/); }) ? true : "grep -o the c= values, then sed to drop c= and turn %20 into spaces."; } },
      { id: "d2", title: "Who answered root?", files: INC, system: TSHARK, text: "<p>Find the HTTP response in <code>~/captures/incident.pcap</code> that contains <code>uid=0(root)</code> and print the <b>TCP stream number</b> it belongs to.</p>", starter: "", solution: lines("tshark -r ~/captures/incident.pcap -Y 'http.response' -T fields -e tcp.stream -e http.file_data | grep 'uid=0' | cut -f1"),
        check: function (r) { return ran(r, /\btshark\b.*incident\.pcap/, function (e) { return e.out.length === 1 && /^\d+$/.test(e.out[0].trim()); }) ? true : "Fields tcp.stream and http.file_data of the responses, grep uid=0, keep the first column."; } },
      { id: "d3", title: "Community rules knew", files: INC, system: SURI, text: "<p>Run Suricata on <code>~/captures/incident.pcap</code> into <code>~/ids</code> and show only the alert about the <b>root</b> response.</p>", starter: "", solution: lines("mkdir -p ~/ids", "suricata -r ~/captures/incident.pcap -l ~/ids", "grep -i 'returned root' ~/ids/fast.log"),
        check: function (r) { return ran(r, /\bgrep\b.*fast\.log/, function (e) { return e.out.length === 1 && /id check returned root/.test(e.out[0]); }) ? true : "grep the fast.log for the ATTACK_RESPONSE alert."; } }
    ]
  };
  T.LABS.forEach(function (l) { if (DRILLS[l.id]) l.drills = DRILLS[l.id].map(function (d) { d.layer = d.layer || l.layer; return d; }); });
})();
