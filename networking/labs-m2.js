/* sudo learn — Networking track, Module 2: Ports & traffic (NET-201..210). The ports that matter and what answers
   on them, then capturing and reading traffic: tcpdump in the background while you work, the TCP handshake, tshark,
   ICMP and path MTU, DNS and DHCP on the wire, slowness, proxies and load balancers. Every network command puts its
   packets on the wire (net-m2.js), so captures show what you really did. */
(function () {
  "use strict";
  var T = window.NET_TRACK, S = window.ShEngine, M2 = S.M2, N = window.NetCore, NH = window.NetLab.H, SH = window.ShLab.H, X = T.M1;
  var MAYA = "Maya Chen · SRE lead", DEV = "Dev Patel · Security", BEN = "Ben Okoro · Developer";
  var NOW = S.NOW, DAY = S.DAY, HOUR = 3600000, P = N.P, W = N.W, ME = "10.20.0.15";
  var ex = T.ex, code = T.code, lines = T.lines;
  var ran = NH.ran, outHas = NH.outHas, rootish = NH.rootish, idx = NH.idx;
  var LABS = [];
  function L(t) { return SH.lines(t || ""); }
  function after(r, i, re, fn) { return r.history.some(function (e, k) { return k > i && re.test(e.cmd) && (!fn || fn(e)); }); }
  function nw(r) { return r.sys.nw; }
  function fileLines(r, p) { return L(r.read(p) || "").map(function (l) { return l.trim(); }).filter(Boolean); }
  function word(r, p) { return (r.read(p) || "").trim().toLowerCase(); }
  function pcapOf(r, p) { var t = r.read(p); return t === null ? null : N.readPcap(t); }
  function anyOut(r, re) { return r.history.some(function (e) { return e.out.concat(e.err).some(function (l) { return re.test(l); }); }); }
  var CAPTURE_HELP = '<h3>Capturing while you work</h3><p>The lab terminal runs one command at a time, like a single SSH session. To capture traffic <b>while</b> you do something, start tcpdump in the <b>background</b> with <code>&amp;</code>, run your commands, then stop the capture:</p>' +
    code("sudo tcpdump -i eth0 -n icmp &        # [1] 4100: running in the background\nping -c 2 kc-db-01                     # its packets are printed as they're captured\nsudo pkill tcpdump                     # stop it: tcpdump prints how many it captured") +
    "<p>Add <code>-w FILE</code> to save the packets instead of printing them, then read the file with <code>tcpdump -r FILE</code>. Stop it with <code>sudo pkill tcpdump</code>: the capture runs as root, so a plain <code>kill %1</code> isn't allowed. <code>-c N</code> stops by itself after N packets.</p>";

  /* ================================================================== NET-201 The top 15 ports */
  function legacyAlt(sys) {
    var h = Object.assign({}, N.HOSTS2["10.20.0.40"]);
    delete h[23]; delete h[110]; h[53] = { name: "domain", banner: "" }; h[631] = { name: "ipp", banner: "" };
    sys.nw.hostsvc = { "10.20.0.40": h };
  }
  function legacyOpen(r) { var h = N.HOSTSVC(r.sys, "10.20.0.40"); return Object.keys(h).map(Number).filter(function (p) { return p <= 1024 && !h[p].udp; }).sort(function (a, b) { return a - b; }); }
  LABS.push({
    id: "net-201", n: 12, module: 2, ticket: "NET-201", xp: 130, layer: "L4",
    title: "What's still running on the old box?",
    topic: "/etc/services, ss -tulpn, scanning with nc, banners, UDP",
    from: DEV,
    story: "<p><b>kc-legacy-01</b> (10.20.0.40) is an Ubuntu 18.04 server from 2019 that we're decommissioning. Nobody has a list of what it runs. Before we switch it off I need an inventory: which ports are open, and what software answers on each, including the ones that aren't on standard ports.</p><p>We're allowed to scan it: it's ours and it's in the ticket. Start with our own server so you know what normal looks like.</p>",
    learn:
      "<h3>Ports have names: /etc/services</h3><p>Port numbers are assigned by IANA. Every Linux machine has the common ones in <code>/etc/services</code>, which tools use to print names instead of numbers:</p>" + ex("grep -w 22 /etc/services") + ex("getent services https") +
      '<table class="t"><tr><th>Port</th><th>Service</th><th>Port</th><th>Service</th></tr><tr><td>20/21</td><td>FTP</td><td>123/udp</td><td>NTP (time)</td></tr><tr><td>22</td><td>SSH</td><td>143</td><td>IMAP (mailboxes)</td></tr><tr><td>23</td><td>Telnet</td><td>443</td><td>HTTPS</td></tr><tr><td>25</td><td>SMTP (mail between servers)</td><td>445</td><td>SMB (Windows file sharing)</td></tr><tr><td>53/udp+tcp</td><td>DNS</td><td>3306</td><td>MySQL</td></tr><tr><td>67/68/udp</td><td>DHCP</td><td>3389</td><td>RDP (Windows remote desktop)</td></tr><tr><td>80</td><td>HTTP</td><td>5432</td><td>PostgreSQL</td></tr><tr><td>110</td><td>POP3 (fetch mail)</td><td></td><td></td></tr></table>' +
      "<p>The <b>Ports</b> tab above the terminal is a reference card for every port in this track.</p>" +
      "<h3>What's listening here: ss -tulpn</h3>" + ex("sudo ss -tulpn") + "<p><code>-t</code> TCP, <code>-u</code> UDP, <code>-l</code> listening, <code>-p</code> process, <code>-n</code> numbers. TCP listeners say <code>LISTEN</code>; UDP ones <code>UNCONN</code> (UDP has no connections).</p>" +
      "<h3>What's open over there: scanning with nc</h3><p><code>nc -z</code> accepts a range of ports. It reports to <b>stderr</b>, so redirect it before filtering:</p>" + ex("nc -zv -w 1 kc-db-01 20-25 2>&1 | grep succeeded") +
      '<div class="callout warn">Only scan machines you own or are explicitly allowed to test. Scanning someone else\'s network can be illegal, and it always looks like an attack in their logs. (nmap, the real scanner, comes in Module 4.)</div>' +
      "<h3>Banners: what's really answering</h3><p>A port number is only a convention: anything can listen anywhere. Many services announce themselves the moment you connect (a <b>banner</b>): SSH, FTP, SMTP, POP3 and IMAP do. Connect with nc and read it:</p>" + ex("nc kc-db-01 22") +
      "<p>HTTP waits for you to speak first: send a request, then read the <code>Server:</code> header:</p>" + code("printf 'HEAD / HTTP/1.0\\r\\n\\r\\n' | nc HOST PORT") +
      "<h3>UDP: \"succeeded\" means nothing</h3><p>With no handshake, <code>nc -zu</code> can't tell an open UDP port from a closed one: it always says succeeded. What gives a closed port away is an <b>ICMP port unreachable</b> message coming back, which you can see in a capture.</p>" + CAPTURE_HELP,
    diagram: ["legacy"],
    starter: "",
    objectives: [
      {
        id: "services", text: "Use <code>/etc/services</code> (grep or getent) to find which service uses port <b>3389</b>, and which port <b>imaps</b> uses.",
        hints: ["grep -w 3389 /etc/services and getent services imaps.", "grep -w 3389 /etc/services\ngetent services imaps"],
        check: function (r) {
          if (!ran(r, /\b(grep|getent|awk|cat)\b/, function (e) { return outHas(e, /ms-wbt-server\s+3389\/tcp/); })) return "Look up port 3389 in /etc/services.";
          return ran(r, /\b(grep|getent|awk|cat)\b/, function (e) { return outHas(e, /imaps\s+993\/tcp/); }) ? true : "Now look up the imaps service.";
        }
      },
      {
        id: "ss", text: "List every listening socket on kc-web-01, <b>TCP and UDP</b>, with the program behind each.",
        hints: ["ss with t, u, l, p and n, as root.", "sudo ss -tulpn"],
        check: function (r) { return ran(r, /\bss\b/, function (e) { return rootish(e) && outHas(e, /^udp\s+UNCONN/) && outHas(e, /^tcp\s+LISTEN.*:443\b.*nginx/); }) ? true : "sudo ss -tulpn shows both protocols, with programs."; }
      },
      {
        id: "scan", text: "Scan kc-legacy-01's ports <b>1 to 1024</b> with nc and print <b>only the open ones</b>.",
        hints: ["nc -zv -w 1 HOST 1-1024 reports on stderr: send it to stdout (2>&1) and grep for succeeded.", "nc -zv -w 1 kc-legacy-01 1-1024 2>&1 | grep succeeded"],
        check: function (r) {
          function good(ctx, e) { var want = legacyOpen(ctx); return e && !e.out.some(function (l) { return /refused/.test(l); }) && want.every(function (p) { return e.out.some(function (l) { return new RegExp(" " + p + " port \\[tcp\\/[^\\]]+\\] succeeded").test(l); }); }) && e.out.length === want.length; }
          var k = -1; r.history.forEach(function (e, i) { if (/\bnc\b/.test(e.cmd) && good(r, e)) k = i; });
          if (k < 0) return "One command should print exactly the open ports among 1 to 1024 (nc -zv with a range, stderr into grep succeeded).";
          var r2 = r.run(null, { system: legacyAlt });
          return good(r2, r2.history[k]) ? true : "Scan the ports instead of listing them: on another day a different set is open.";
        }
      },
      {
        id: "odd", text: "kc-legacy-01 also has ports <b>2222</b> and <b>8081</b> open, which aren't standard. Find out what answers on each and write <code>2222 ssh</code> and <code>8081 http</code> (or what you found) to <code>~/nonstandard.txt</code>.",
        hints: ["Connect to 2222 with nc and read the banner. 8081 waits for a request: printf a HEAD request into nc, or curl -I.", "nc kc-legacy-01 2222\nprintf 'HEAD / HTTP/1.0\\r\\n\\r\\n' | nc kc-legacy-01 8081\nprintf '2222 ssh\\n8081 http\\n' > ~/nonstandard.txt"],
        check: function (r) {
          if (!ran(r, /\b(nc|ssh|telnet)\b.*2222/, function (e) { return outHas(e, /SSH-2\.0/); })) return "Read port 2222's banner with nc.";
          if (!ran(r, /\b(nc|curl|wget)\b.*8081/, function (e) { return outHas(e, /X-Jenkins|Jetty|HTTP\/1\.[01] \d{3}/i); })) return "Ask port 8081 with an HTTP request (it doesn't speak first).";
          var t = (r.read("nonstandard.txt") || "").toLowerCase();
          if (!/^\s*2222\s+(ssh|openssh)\b/m.test(t)) return "~/nonstandard.txt: what runs on 2222?";
          return /^\s*8081\s+(http|https?|jenkins|web|jetty)\b/m.test(t) ? true : "~/nonstandard.txt: what runs on 8081?";
        }
      },
      {
        id: "mail", text: "Read the banners on the three mail ports (<b>25, 110, 143</b>). Which two pieces of mail software run there? Write their names to <code>~/mail-software.txt</code>.",
        hints: ["nc kc-legacy-01 25, then 110, then 143. The software's name is in each greeting.", "nc kc-legacy-01 25\nnc kc-legacy-01 110\nnc kc-legacy-01 143\nprintf 'Postfix\\nDovecot\\n' > ~/mail-software.txt"],
        check: function (r) {
          var miss = [25, 110, 143].filter(function (p) { return !ran(r, new RegExp("\\bnc\\b.*kc-legacy-01\\s+" + p + "\\b|\\bnc\\b.*10\\.20\\.0\\.40\\s+" + p + "\\b"), function (e) { return e.out.length > 0; }); });
          if (miss.length) return "Read the banner on port " + miss.join(" and ") + " with nc.";
          var t = word(r, "mail-software.txt");
          return /postfix/.test(t) && /dovecot/.test(t) ? true : "~/mail-software.txt should name the SMTP software and the POP3/IMAP software.";
        }
      },
      {
        id: "udp", text: "UDP: <code>nc -zu</code> says \"succeeded\" for both <b>161</b> (SNMP) and <b>9999</b> on kc-legacy-01. Capture ICMP in the background while you test both, and see which port is really closed.",
        hints: ["sudo tcpdump -i eth0 -n icmp & first, then the two nc -zu commands, then sudo pkill tcpdump.", "sudo tcpdump -i eth0 -n icmp &\nnc -zuv kc-legacy-01 161\nnc -zuv kc-legacy-01 9999\nsudo pkill tcpdump"],
        check: function (r) {
          if (!anyOut(r, /udp port 9999 unreachable/)) return "Run a background capture of ICMP while you nc -zu both ports: the closed one sends back \"port unreachable\".";
          return anyOut(r, /udp port 161 unreachable/) ? "Odd: 161 shouldn't be unreachable." : true;
        }
      }
    ],
    solution: lines("grep -w 3389 /etc/services", "getent services imaps", "sudo ss -tulpn", "nc -zv -w 1 kc-legacy-01 1-1024 2>&1 | grep succeeded", "nc kc-legacy-01 2222", "printf 'HEAD / HTTP/1.0\\r\\n\\r\\n' | nc kc-legacy-01 8081", "printf '2222 ssh\\n8081 http\\n' > ~/nonstandard.txt", "nc kc-legacy-01 25", "nc kc-legacy-01 110", "nc kc-legacy-01 143", "printf 'Postfix\\nDovecot\\n' > ~/mail-software.txt", "sudo tcpdump -i eth0 -n icmp &", "nc -zuv kc-legacy-01 161", "nc -zuv kc-legacy-01 9999", "sudo pkill tcpdump"),
    debrief: "<p>Ticket closed. kc-legacy-01 is a museum: FTP, Telnet, SMTP, POP3 and IMAP all in clear text, SMB, MySQL, a second SSH daemon on 2222 and a <b>Jenkins</b> on 8081 that nobody listed. Port numbers only tell you what <i>should</i> be there; banners and responses tell you what <i>is</i>.</p><p>The UDP test is the lesson people miss: <code>nc -zu</code> said succeeded twice, but only port 9999 sent back an ICMP \"port unreachable\". No answer at all (port 161) means open or filtered: UDP never gives you certainty, which is why scanners are slow at it.</p>",
    realworld: "On your own machine: sudo ss -tulpn (or netstat -ano on Windows). Banner-grab your own services with nc: ssh, a local web server. Never scan networks you don't own.",
    quiz: [
      { q: "Which port is SSH?", options: ["21", "22", "23", "25"], answer: 1, why: "22 SSH; 21 FTP, 23 Telnet, 25 SMTP." },
      { q: "nc -zu says a UDP port \"succeeded\". What do you know?", options: ["It's open", "Almost nothing: UDP has no handshake", "It's closed", "It's filtered"], answer: 1, why: "Only an ICMP port unreachable proves a UDP port is closed." },
      { q: "Something answers SSH-2.0-OpenSSH on port 2222. What is it?", options: ["Telnet", "An SSH server on a non-standard port", "HTTP", "Nothing"], answer: 1, why: "The banner names the protocol, whatever the port number." }
    ]
  });

  /* ================================================================== NET-202 Infrastructure ports & secure pairs */
  LABS.push({
    id: "net-202", n: 13, module: 2, ticket: "NET-202", xp: 140, layer: "L4–7",
    title: "Open doors in the back office",
    topic: "Redis, Elasticsearch, MongoDB, Docker and Kubernetes APIs; plain-text ports and their encrypted pairs",
    from: DEV,
    story: "<p>Our auditors ran a scan from the office network and flagged two internal machines: <b>kc-data-01</b> (Redis, Elasticsearch, MongoDB) and <b>kc-build-01</b> (the Docker API). They want to know which of these let <b>anyone</b> on the network in without a password, with proof.</p><p>Also: for the report, list the encrypted version of each plain-text protocol we still use, and show the mail server's encrypted ports work.</p>",
    learn:
      "<h3>Infrastructure ports</h3><p>Behind every web app are services that were designed for a trusted network: databases, caches, search engines, container and cluster APIs. Several of them have <b>no password by default</b>.</p>" +
      '<table class="t"><tr><th>Port</th><th>Service</th><th>Talk to it with</th><th>If it\'s open to everyone</th></tr>' +
      "<tr><td>6379</td><td>Redis (cache, sessions)</td><td><code>printf 'PING\\r\\n' | nc HOST 6379</code></td><td>read every session, often write files</td></tr>" +
      "<tr><td>9200</td><td>Elasticsearch</td><td><code>curl http://HOST:9200/</code></td><td>read and delete every index</td></tr>" +
      "<tr><td>27017</td><td>MongoDB</td><td>the mongo client (curl gets a hint)</td><td>read every collection</td></tr>" +
      "<tr><td>2375</td><td>Docker API, plain</td><td><code>curl http://HOST:2375/version</code></td><td><b>root on the host</b>: start a container that mounts /</td></tr>" +
      "<tr><td>2376</td><td>Docker API over TLS</td><td>needs a client certificate</td><td>safe if client certs are required</td></tr>" +
      "<tr><td>6443</td><td>Kubernetes API</td><td><code>curl -k https://HOST:6443/</code></td><td>depends on anonymous access</td></tr>" +
      "<tr><td>3306, 5432</td><td>MySQL, PostgreSQL</td><td>their clients</td><td>password guessing, old versions</td></tr></table>" +
      "<p>Redis speaks a simple text protocol: send <code>PING</code> and an open server answers <code>+PONG</code>; a protected one answers <code>-NOAUTH Authentication required</code>.</p>" +
      "<h3>Plain text and its encrypted pair</h3><p>Most old protocols send passwords in clear text. Each has an encrypted version, either on a <b>separate port</b> (TLS from the first byte) or on the <b>same port</b> with <b>STARTTLS</b> (start plain, then upgrade):</p>" +
      '<table class="t"><tr><th>Plain</th><th>Encrypted</th></tr><tr><td>80 HTTP</td><td>443 HTTPS</td></tr><tr><td>21 FTP, 23 Telnet</td><td>22 SFTP and SSH</td></tr><tr><td>25 SMTP</td><td>587 submission with STARTTLS, 465 submissions</td></tr><tr><td>110 POP3</td><td>995 POP3S</td></tr><tr><td>143 IMAP</td><td>993 IMAPS</td></tr><tr><td>389 LDAP</td><td>636 LDAPS</td></tr><tr><td>8080</td><td>8443</td></tr><tr><td>2375 Docker</td><td>2376 Docker with TLS</td></tr></table>' +
      ex("echo | openssl s_client -connect mail.kestrel.example.com:993 -brief") +
      "<p><code>-brief</code> prints just the result. For STARTTLS ports add <code>-starttls smtp</code> (or <code>imap</code>, <code>pop3</code>, <code>ldap</code>).</p>",
    diagram: ["data", "build"],
    starter: "",
    objectives: [
      {
        id: "redis", text: "Does Redis on kc-data-01 need a password? Send it <code>PING</code>, then list its keys with <code>KEYS *</code>.",
        hints: ["printf the command with \\r\\n and pipe it into nc HOST 6379.", "printf 'PING\\r\\n' | nc kc-data-01 6379\nprintf 'KEYS *\\r\\n' | nc kc-data-01 6379"],
        check: function (r) {
          if (!ran(r, /\bnc\b.*6379/, function (e) { return outHas(e, /^\+PONG$/); })) return "PING Redis on kc-data-01:6379 with nc.";
          return ran(r, /\bnc\b.*6379/, function (e) { return outHas(e, /^session:/); }) ? true : "Now ask for the keys (KEYS *).";
        }
      },
      {
        id: "es", text: "Elasticsearch on kc-data-01: list its indices (<code>/_cat/indices?v</code>). Is customer data in there?",
        hints: ["curl the URL; quote it because of the ?.", "curl -s 'http://kc-data-01:9200/_cat/indices?v'"],
        check: function (r) { return ran(r, /\bcurl\b.*9200/, function (e) { return outHas(e, /customers-2026/); }) ? true : "curl http://kc-data-01:9200/_cat/indices?v (in quotes)."; }
      },
      {
        id: "mongo", text: "Port 27017: ask it with curl. What does the answer tell you?",
        hints: ["curl http://kc-data-01:27017/", "curl -s http://kc-data-01:27017/"],
        check: function (r) { return ran(r, /\bcurl\b.*27017/, function (e) { return outHas(e, /MongoDB over HTTP/); }) ? true : "curl http://kc-data-01:27017/: the reply names the service."; }
      },
      {
        id: "docker", text: "kc-build-01: ask the plain Docker API (2375) for its version and its <b>running containers</b>, then try the TLS port (2376).",
        hints: ["/version and /containers/json on port 2375 over http. Port 2376 is https.", "curl -s http://kc-build-01:2375/version\ncurl -s http://kc-build-01:2375/containers/json\ncurl https://kc-build-01:2376/version"],
        check: function (r) {
          if (!ran(r, /\bcurl\b.*2375/, function (e) { return outHas(e, /jenkins-agent/); })) return "List the containers through the plain API (/containers/json on 2375).";
          return ran(r, /\bcurl\b.*2376/, function (e) { return outHas(e, /certificate required/); }) ? true : "Now try https://kc-build-01:2376/version: what does the TLS port want?";
        }
      },
      {
        id: "pairs", text: "Find the encrypted ports for <b>imaps, pop3s, ldaps and submissions</b> in /etc/services (one command), then check that the mail server's IMAPS port (993) speaks TLS.",
        hints: ["grep -wE with the four names joined by |. Then openssl s_client -brief.", "grep -wE 'imaps|pop3s|ldaps|submissions' /etc/services\necho | openssl s_client -connect mail.kestrel.example.com:993 -brief"],
        check: function (r) {
          if (!ran(r, /\b(grep|getent|awk)\b/, function (e) { return ["imaps", "pop3s", "ldaps", "submissions"].every(function (n) { return outHas(e, new RegExp("^" + n + "\\s+\\d+\\/tcp")); }); })) return "One command that prints imaps, pop3s, ldaps and submissions from /etc/services.";
          return ran(r, /\bopenssl\s+s_client\b.*993/, function (e) { return outHas(e, /Protocol version: TLSv1\.3|New, TLSv1\.3/); }) ? true : "Check mail.kestrel.example.com:993 with openssl s_client.";
        }
      },
      {
        id: "report", text: "Write <code>~/exposed.txt</code>: one line per port (on either machine) that let you read data or control the service <b>without any password</b>.",
        hints: ["Which of your tests got real data back? Redis, Elasticsearch, the plain Docker API.", "printf '6379\\n9200\\n2375\\n' > ~/exposed.txt"],
        check: function (r) {
          var got = fileLines(r, "exposed.txt").map(function (l) { return (/\d+/.exec(l) || [""])[0]; });
          var want = ["2375", "6379", "9200"];
          var miss = want.filter(function (p) { return got.indexOf(p) < 0; }), extra = got.filter(function (p) { return p && want.indexOf(p) < 0; });
          if (miss.length) return "Missing from ~/exposed.txt: " + miss.join(", ") + ".";
          return extra.length ? "Did port " + extra[0] + " really give you data without a password?" : true;
        }
      }
    ],
    solution: lines("printf 'PING\\r\\n' | nc kc-data-01 6379", "printf 'KEYS *\\r\\n' | nc kc-data-01 6379", "curl -s 'http://kc-data-01:9200/_cat/indices?v'", "curl -s http://kc-data-01:27017/", "curl -s http://kc-build-01:2375/version", "curl -s http://kc-build-01:2375/containers/json", "curl https://kc-build-01:2376/version", "grep -wE 'imaps|pop3s|ldaps|submissions' /etc/services", "echo | openssl s_client -connect mail.kestrel.example.com:993 -brief", "printf '6379\\n9200\\n2375\\n' > ~/exposed.txt"),
    debrief: "<p>Ticket closed. Three open doors: Redis handed over session keys to anyone who asked, Elasticsearch listed (and would have served) the customer index, and the plain Docker API answered without a question, which on a real build host means <b>root</b> for anyone on the network. MongoDB only told us what it is; the TLS Docker port refused us for lack of a client certificate, which is exactly right.</p><p>The fix is never \"hope nobody finds it\": bind these services to 127.0.0.1 or a private interface, turn on authentication, and firewall them (Module 4). Encrypted protocol pairs are the other half: there's no reason to send a password over 110 or 143 when 995 and 993 work.</p>",
    realworld: "Search engines like Shodan index services exposed to the internet by port. Every week, open Redis, Elasticsearch and Docker APIs are found and wiped or used for crypto-mining within hours.",
    quiz: [
      { q: "Why is an open Docker API (2375) so dangerous?", options: ["It leaks logs", "Anyone can start a container that mounts the host: root on the host", "It slows the build", "It only exposes images"], answer: 1, why: "Docker runs as root; controlling it means controlling the machine." },
      { q: "What's the encrypted version of IMAP?", options: ["143", "993", "995", "587"], answer: 1, why: "IMAPS on 993 (POP3S is 995)." },
      { q: "STARTTLS means...", options: ["A separate TLS port", "Start in plain text on the same port, then upgrade to TLS", "No encryption", "UDP"], answer: 1, why: "SMTP on 587, IMAP on 143 can upgrade with STARTTLS." }
    ]
  });

  /* ================================================================== NET-203 tcpdump basics */
  LABS.push({
    id: "net-203", n: 14, module: 2, ticket: "NET-203", xp: 120, layer: "L2–4",
    title: "Watch the wire",
    topic: "tcpdump: interfaces, capture filters, -c, -w and -r, capturing in the background",
    from: MAYA,
    story: "<p>Module 1 had you read captures someone else made. Now make your own. Get comfortable with tcpdump on kc-web-01: which interfaces it can listen on, how to narrow a capture down to what you care about, how to save it, and how to capture your own traffic while you test something.</p>",
    learn:
      "<h3>Interfaces</h3>" + ex("tcpdump -D") + "<p><code>-i eth0</code> picks one; <code>-i any</code> captures on all of them. Capturing needs root; reading a file doesn't.</p>" +
      "<h3>Capture filters</h3><p>A busy server sees thousands of packets a second. A filter at the end keeps only what you want, before it's even copied:</p>" +
      '<table class="t"><tr><th>Filter</th><th>Keeps</th></tr><tr><td><code>host 10.20.0.21</code></td><td>to or from that address</td></tr><tr><td><code>src host X</code>, <code>dst host X</code></td><td>one direction</td></tr><tr><td><code>net 10.20.5.0/24</code></td><td>a whole network</td></tr><tr><td><code>port 53</code>, <code>dst port 443</code></td><td>a port (TCP or UDP)</td></tr><tr><td><code>tcp</code>, <code>udp</code>, <code>icmp</code>, <code>arp</code></td><td>a protocol</td></tr><tr><td><code>icmp and host 10.20.5.10</code></td><td>both</td></tr><tr><td><code>port 22 or port 443</code></td><td>either</td></tr><tr><td><code>not port 22</code></td><td>everything except your own SSH</td></tr></table>' +
      "<p>Put filters with spaces or special characters in quotes: <code>'icmp or port 53'</code>.</p>" +
      ex("sudo tcpdump -i eth0 -n -c 5") +
      "<h3>Saving and reading</h3><p><code>-w FILE</code> writes raw packets (pcap format) instead of printing them; <code>-r FILE</code> reads them back, and you can filter again when reading. Wireshark opens the same files.</p>" + CAPTURE_HELP,
    diagram: ["mon"],
    starter: "",
    objectives: [
      {
        id: "list", text: "List the interfaces tcpdump can capture on.",
        hints: ["tcpdump has an option for that (-D).", "tcpdump -D"],
        check: function (r) { return ran(r, /\btcpdump\b.*-D\b/, function (e) { return outHas(e, /^1\.eth0/); }) ? true : "tcpdump -D lists them."; }
      },
      {
        id: "five", text: "Capture <b>5 packets</b> on eth0, numeric, then stop.",
        hints: ["-c sets the count; -n numbers.", "sudo tcpdump -i eth0 -n -c 5"],
        check: function (r) { return ran(r, /\btcpdump\b/, function (e) { return rootish(e) && /-c\s*5\b/.test(e.cmd) && e.out.length === 5 && !/-r\b/.test(e.cmd); }) ? true : "sudo tcpdump -i eth0 -n -c 5: five lines."; }
      },
      {
        id: "filter", text: "Something on the office network pings us. Capture just <b>2 ICMP packets to or from kc-mon-01 (10.20.5.10)</b>.",
        hints: ["Combine two filter words with and.", "sudo tcpdump -i eth0 -n -c 2 icmp and host 10.20.5.10"],
        check: function (r) { return ran(r, /\btcpdump\b/, function (e) { return rootish(e) && e.out.length === 2 && e.out.every(function (l) { return /10\.20\.5\.10/.test(l) && /ICMP/.test(l); }); }) ? true : "Filter on icmp and host 10.20.5.10, with -c 2."; }
      },
      {
        id: "bg", text: "Capture your own traffic: start a background capture of ICMP saved to <code>~/ping.pcap</code>, ping kc-db-01 three times, then stop the capture.",
        hints: ["sudo tcpdump ... -w ~/ping.pcap icmp & ; ping -c 3 kc-db-01 ; sudo pkill tcpdump", "sudo tcpdump -i eth0 -n -w ~/ping.pcap icmp &\nping -c 3 kc-db-01\nsudo pkill tcpdump"],
        check: function (r) {
          var pk = pcapOf(r, "ping.pcap");
          if (!pk) return "No ~/ping.pcap yet: capture with -w ~/ping.pcap in the background, ping, then stop it with sudo pkill tcpdump.";
          var n = pk.filter(function (p) { return p.icmp && (p.ip.src === "10.20.0.21" || p.ip.dst === "10.20.0.21"); }).length;
          if (n < 6) return "~/ping.pcap has " + n + " ICMP packets with kc-db-01: start the capture first, then ping -c 3.";
          return pk.every(function (p) { return p.icmp; }) ? true : "Filter the capture to ICMP only.";
        }
      },
      {
        id: "count", text: "Read <code>~/ping.pcap</code> back and <b>count</b> its packets (one number).",
        hints: ["tcpdump -r prints one line per packet; wc -l counts lines (the \"reading from file\" line goes to stderr).", "tcpdump -r ~/ping.pcap -n | wc -l"],
        check: function (r) { var pk = pcapOf(r, "ping.pcap"); if (!pk) return "Make ~/ping.pcap first."; return ran(r, /\btcpdump\b.*-r\b.*ping\.pcap.*\|\s*wc\b/, function (e) { return SH.same(e.out.map(function (l) { return l.trim(); }), [String(pk.length)]); }) ? true : "tcpdump -r ~/ping.pcap -n | wc -l"; }
      },
      {
        id: "dns", text: "Watch your own DNS lookup: capture <b>port 53</b> in the background (printing, not saving), look up example.com with dig, and stop the capture.",
        hints: ["Same as before without -w: the packets print as they arrive.", "sudo tcpdump -i eth0 -n port 53 &\ndig example.com\nsudo pkill tcpdump"],
        check: function (r) { return anyOut(r, /> 10\.20\.0\.2\.53: \d+\+ A\? example\.com\./) && anyOut(r, /10\.20\.0\.2\.53 > .*1\/0\/0 A 93\.184\.215\.14/) ? true : "Start the port 53 capture in the background before dig example.com: you should see the question and the answer."; }
      }
    ],
    solution: lines("tcpdump -D", "sudo tcpdump -i eth0 -n -c 5", "sudo tcpdump -i eth0 -n -c 2 icmp and host 10.20.5.10", "sudo tcpdump -i eth0 -n -w ~/ping.pcap icmp &", "ping -c 3 kc-db-01", "sudo pkill tcpdump", "tcpdump -r ~/ping.pcap -n | wc -l", "sudo tcpdump -i eth0 -n port 53 &", "dig example.com", "sudo pkill tcpdump"),
    debrief: "<p>Ticket closed. You can now point tcpdump at exactly what you need: the right interface, a filter, a count or a file. The background pattern (start the capture, do the thing, stop it) is how you'll debug for real: \"is my request even leaving this box?\" has a definitive answer in a capture.</p><p>Notice the DNS lookup went to <b>10.20.0.2</b>, not 127.0.0.53: systemd-resolved received dig's question on the loopback and forwarded it to the real DNS server on eth0, which is what you captured.</p>",
    realworld: "On any Linux machine: sudo tcpdump -i any -n port 53 & then browse a site and watch the lookups; sudo pkill tcpdump to stop. Open the .pcap files in Wireshark for a friendlier view.",
    quiz: [
      { q: "Which filter keeps DNS traffic?", options: ["host 53", "port 53", "dns only", "udp 53"], answer: 1, why: "port 53 matches TCP and UDP port 53." },
      { q: "What does <code>-w capture.pcap</code> do?", options: ["Prints more detail", "Saves raw packets to a file instead of printing them", "Waits", "Writes a filter"], answer: 1, why: "Read it back with -r (or open it in Wireshark)." },
      { q: "Why does reading a capture file not need sudo?", options: ["It does", "Only capturing from an interface needs root; a file is just a file", "tcpdump ignores permissions", "Because of -n"], answer: 1, why: "Opening a network interface for capture needs root (CAP_NET_RAW); reading a file needs only read permission." }
    ]
  });

  /* ================================================================== NET-204 The TCP handshake */
  function filtered3306(sys) { sys.nw.filtered = { "10.20.0.21:3306": true }; }
  LABS.push({
    id: "net-204", n: 15, module: 2, ticket: "NET-204", xp: 130, layer: "L4",
    title: "Reset or silence?",
    topic: "SYN, SYN-ACK, ACK, FIN and RST; tcp[tcpflags] filters; retransmissions",
    from: BEN,
    story: "<p>Three database ports on kc-db-01 behave differently: Postgres (5432) works, Redis (6379) fails instantly, MySQL (3306) hangs and then fails. I know the words \"refused\" and \"timed out\" from NET-107; now I want to <b>see</b> the difference on the wire. Capture all three attempts and show me.</p>",
    learn:
      "<h3>The handshake</h3><p>Every TCP connection starts with three packets and ends with four:</p>" +
      code("client > server  [S]    SYN: let's talk, my sequence number is X\nserver > client  [S.]   SYN-ACK: OK, mine is Y, I got X\nclient > server  [.]    ACK: I got Y. Connected.\n   ... data ([P.] = data with PUSH) ...\nclient > server  [F.]   FIN: I'm done\nserver > client  [F.]   FIN: me too\nclient > server  [.]    ACK") +
      "<p>tcpdump shows flags in brackets: <code>S</code> SYN, <code>.</code> ACK, <code>P</code> push, <code>F</code> FIN, <code>R</code> reset.</p>" +
      "<h3>When it fails</h3>" +
      '<table class="t"><tr><th>On the wire</th><th>Client sees</th><th>Means</th></tr><tr><td>SYN → <b>RST</b></td><td>Connection refused, at once</td><td>host is up, nothing listens on the port (or a firewall that rejects)</td></tr><tr><td>SYN, SYN, SYN... nothing back</td><td>timed out, after a while</td><td>a firewall drops it, or the host is gone</td></tr></table>' +
      "<p>When nothing comes back, the client <b>retransmits</b> the SYN, waiting longer each time (1 s, then 2 s more, then 4 s...).</p>" +
      "<h3>Filtering on flags</h3><p>The TCP flags are a byte in the header, and tcpdump can test it:</p>" + code("tcpdump -r FILE 'tcp[tcpflags] == tcp-syn'          # SYN and nothing else: new connection attempts\ntcpdump -r FILE 'tcp[tcpflags] & tcp-rst != 0'     # anything with RST set\ntcpdump -r FILE 'tcp[tcpflags] & (tcp-syn|tcp-ack) == (tcp-syn|tcp-ack)'   # SYN-ACKs") +
      "<p>Quote these: the brackets and <code>&amp;</code> mean something to the shell.</p>" + CAPTURE_HELP,
    system: filtered3306,
    starter: "",
    objectives: [
      {
        id: "cap", text: "Start a background capture of traffic with kc-db-01 (10.20.0.21) saved to <code>~/handshake.pcap</code>. Try ports 5432, 6379 and 3306 with <code>nc -zv</code> (give 3306 three seconds), then stop the capture.",
        hints: ["host 10.20.0.21 as the filter, -w ~/handshake.pcap, &. Then three nc commands (-w 3 for the last), then sudo pkill tcpdump.", "sudo tcpdump -i eth0 -n -w ~/handshake.pcap host 10.20.0.21 &\nnc -zv kc-db-01 5432\nnc -zv kc-db-01 6379\nnc -zv -w 3 kc-db-01 3306\nsudo pkill tcpdump"],
        check: function (r) {
          var pk = pcapOf(r, "handshake.pcap");
          if (!pk) return "No ~/handshake.pcap yet.";
          var miss = [5432, 6379, 3306].filter(function (p) { return !pk.some(function (x) { return x.tcp && x.tcp.dport === p && x.tcp.flags === "S"; }); });
          return miss.length ? "The capture has no connection attempt to port " + miss.join(", ") + ": start the capture first, then all three nc tests." : true;
        }
      },
      {
        id: "syn", text: "From the file, show only the packets that have <b>SYN and nothing else</b> set: every connection attempt.",
        hints: ["'tcp[tcpflags] == tcp-syn' (in quotes).", "tcpdump -r ~/handshake.pcap -n 'tcp[tcpflags] == tcp-syn'"],
        check: function (r) { return ran(r, /\btcpdump\b.*-r\b.*handshake\.pcap/, function (e) { return e.out.length >= 5 && e.out.every(function (l) { return /Flags \[S\],/.test(l); }); }) ? true : "Read the file with a tcp[tcpflags] filter that keeps only plain SYNs."; }
      },
      {
        id: "rst", text: "Which port answered with a <b>reset</b>? Filter the file for RST and write the port number to <code>~/rst-port.txt</code>.",
        hints: ["'tcp[tcpflags] & tcp-rst != 0'. The RST comes FROM the port.", "tcpdump -r ~/handshake.pcap -n 'tcp[tcpflags] & tcp-rst != 0'\necho 6379 > ~/rst-port.txt"],
        check: function (r) {
          if (!ran(r, /\btcpdump\b.*-r\b.*handshake\.pcap.*rst/, function (e) { return e.out.length >= 1 && e.out.every(function (l) { return /Flags \[R/.test(l); }); })) return "Filter the file on the RST flag.";
          return word(r, "rst-port.txt") === "6379" ? true : "~/rst-port.txt: the port the RST came from.";
        }
      },
      {
        id: "retry", text: "How many SYNs did kc-web-01 send to port <b>3306</b> before giving up? Write the number to <code>~/syn-3306.txt</code>.",
        hints: ["Filter the file on dst port 3306 and count.", "tcpdump -r ~/handshake.pcap -n dst port 3306\necho 3 > ~/syn-3306.txt"],
        check: function (r) {
          var pk = pcapOf(r, "handshake.pcap"); if (!pk) return "Make the capture first.";
          var n = pk.filter(function (x) { return x.tcp && x.tcp.dport === 3306 && x.tcp.flags === "S"; }).length;
          if (!ran(r, /\btcpdump\b.*-r\b.*handshake\.pcap.*3306/)) return "Look at the port 3306 packets in the file.";
          return word(r, "syn-3306.txt") === String(n) ? true : "~/syn-3306.txt: count the SYNs to 3306 (the first one plus the retransmissions).";
        }
      },
      {
        id: "full", text: "Show the whole life of the Postgres connection (port 5432): handshake and teardown.",
        hints: ["Filter the file on port 5432.", "tcpdump -r ~/handshake.pcap -n port 5432"],
        check: function (r) { return ran(r, /\btcpdump\b.*-r\b.*handshake\.pcap.*5432/, function (e) { return outHas(e, /Flags \[S\],/) && outHas(e, /Flags \[S\.\]/) && outHas(e, /Flags \[F\.\]/); }) ? true : "tcpdump -r ~/handshake.pcap -n port 5432: SYN, SYN-ACK, ACK, then FINs."; }
      }
    ],
    solution: lines("sudo tcpdump -i eth0 -n -w ~/handshake.pcap host 10.20.0.21 &", "nc -zv kc-db-01 5432", "nc -zv kc-db-01 6379", "nc -zv -w 3 kc-db-01 3306", "sudo pkill tcpdump", "tcpdump -r ~/handshake.pcap -n 'tcp[tcpflags] == tcp-syn'", "tcpdump -r ~/handshake.pcap -n 'tcp[tcpflags] & tcp-rst != 0'", "echo 6379 > ~/rst-port.txt", "tcpdump -r ~/handshake.pcap -n dst port 3306", "echo 3 > ~/syn-3306.txt", "tcpdump -r ~/handshake.pcap -n port 5432"),
    debrief: "<p>Ticket closed. Three ports, three stories on the wire: Postgres completed the handshake and closed politely with FINs; Redis's port answered the SYN with an <b>RST</b> (refused: the kernel says nobody's home); MySQL's SYN got <b>nothing</b>, so the client retransmitted until it gave up. That silence is a firewall's DROP, and it's why \"timed out\" is slower and more mysterious than \"refused\".</p><p>Security teams use the same flags: lots of SYNs to many ports followed by RSTs is the signature of a port scan (Module 3).</p>",
    realworld: "Capture your own connections: sudo tcpdump -n -i any 'tcp[tcpflags] & (tcp-syn|tcp-rst) != 0' & and then curl a few sites, including a closed port (curl localhost:1).",
    quiz: [
      { q: "What answers a SYN to a closed port on a reachable host?", options: ["A SYN-ACK", "An RST", "Nothing", "An ICMP echo"], answer: 1, why: "The kernel resets connections to ports nobody listens on." },
      { q: "The client sends SYN after SYN with nothing back. Most likely?", options: ["The service crashed", "A firewall drops the packets", "DNS is broken", "The handshake succeeded"], answer: 1, why: "Silence means the packets are dropped somewhere." },
      { q: "Which flags start a connection, in order?", options: ["SYN, ACK, FIN", "SYN, SYN-ACK, ACK", "ACK, SYN, RST", "PSH, ACK, FIN"], answer: 1, why: "The three-way handshake." }
    ]
  });

  /* ================================================================== NET-205 Reading captures with tshark */
  var UA_SCAN = "sqlmap/1.8.4#stable (https://sqlmap.org)";
  function dayCapture(alt) {
    var t0 = Date.UTC(2026, 10, 10, 14, 2, 7) / 1000 + 0.1, L2 = [], scanner = alt ? "10.20.5.61" : "10.20.5.33";
    function at(dt) { return t0 + dt; }
    L2 = L2.concat(P.dns(at(0), ME, "10.20.0.2", 51003, 7311, "kc-db-01.kestrel.internal", "A", [{ type: "A", data: "10.20.0.21", ttl: 3600 }]));
    L2 = L2.concat(P.dns(at(1.2), ME, "10.20.0.2", 51007, 8812, "api.github.com", "A", [{ type: "A", data: "140.82.121.6", ttl: 60 }]));
    L2 = L2.concat(P.convo({ t: at(1.25), a: ME, b: "140.82.121.6", pa: 50214, pb: 443, ttlB: 56, steps: [{ flags: "S", dt: 0 }, { dir: "<", flags: "S.", dt: 0.021 }, { flags: ".", dt: 0.0212 }, { flags: "P.", enc: { tls: 22, len: 517, seed: 31 }, dt: 0.0214, appName: "TLS ClientHello" }, { dir: "<", flags: "P.", enc: { tls: 22, len: 1448, seed: 32 }, dt: 0.043, appName: "TLS ServerHello, Certificate" }, { flags: "P.", enc: { tls: 23, len: 120, seed: 33 }, dt: 0.044 }, { dir: "<", flags: "P.", enc: { tls: 23, len: 980, seed: 34 }, dt: 0.07 }, { flags: "F.", dt: 0.08 }, { dir: "<", flags: "F.", dt: 0.1 }, { flags: ".", dt: 0.1002 }] }));
    L2 = L2.concat(P.dns(at(3.4), ME, "10.20.0.2", 51011, 9020, "archive.ubuntu.com", "A", [{ type: "A", data: "185.125.190.36", ttl: 300 }]));
    L2 = L2.concat(P.convo({ t: at(4.1), a: "10.20.5.21", b: "10.20.0.40", pa: 61010, pb: 80, steps: [{ flags: "S", dt: 0 }, { dir: "<", flags: "S.", dt: 0.0006 }, { flags: ".", dt: 0.0008 }, { flags: "P.", data: "GET / HTTP/1.1\r\nHost: kc-legacy-01\r\nUser-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) Firefox/132.0\r\nAccept: */*\r\n\r\n", dt: 0.001 }, { dir: "<", flags: "P.", data: "HTTP/1.1 200 OK\r\nServer: Apache/2.4.29 (Ubuntu)\r\nContent-Type: text/html\r\n\r\n<html><body><h1>kc-legacy-01</h1></body></html>\n", dt: 0.003 }, { flags: "F.", dt: 0.004 }, { dir: "<", flags: "F.", dt: 0.0045 }, { flags: ".", dt: 0.0047 }] }));
    ["/index.php?id=1", "/index.php?id=1%27%20OR%20%271%27%3D%271", "/index.php?id=1%20UNION%20ALL%20SELECT%20NULL%2CNULL--%20-"].forEach(function (u, i) {
      L2 = L2.concat(P.convo({ t: at(6 + i * 0.4), a: scanner, b: "10.20.0.40", pa: 44100 + i, pb: 80, isnA: 900000 + i * 77, steps: [{ flags: "S", dt: 0 }, { dir: "<", flags: "S.", dt: 0.0006 }, { flags: ".", dt: 0.0008 }, { flags: "P.", data: "GET " + u + " HTTP/1.1\r\nHost: kc-legacy-01\r\nUser-Agent: " + UA_SCAN + "\r\nAccept: */*\r\n\r\n", dt: 0.001 }, { dir: "<", flags: "P.", data: "HTTP/1.1 404 Not Found\r\nServer: Apache/2.4.29 (Ubuntu)\r\nContent-Type: text/html\r\n\r\n<h1>Not Found</h1>\n", dt: 0.002 }, { flags: "F.", dt: 0.003 }, { dir: "<", flags: "F.", dt: 0.0035 }] }));
    });
    L2 = L2.concat(P.convo({ t: at(8.2), a: "10.20.5.22", b: ME, pa: 50122, pb: 22, isnA: 1800400, steps: [{ flags: "P.", enc: { len: 36, seed: 41 }, dt: 0, appName: "SSH (encrypted)" }, { dir: "<", flags: "P.", enc: { len: 52, seed: 42 }, dt: 0.0004 }, { flags: ".", dt: 0.04 }] }));
    L2 = L2.concat(P.icmp(at(9), "10.20.5.10", ME, 211, 4410).concat(P.icmp(at(10), "10.20.5.10", ME, 211, 4411)));
    var big = [{ flags: "S", dt: 0 }, { dir: "<", flags: "S.", dt: 0.0005 }, { flags: ".", dt: 0.0006 }];
    for (var k = 0; k < 9; k++) big.push({ flags: "P.", enc: { len: 1448, seed: 50 + k }, dt: 0.001 + k * 0.0012, appName: "rsync data" });
    big.push({ dir: "<", flags: ".", dt: 0.013 }, { flags: "F.", dt: 0.014 }, { dir: "<", flags: "F.", dt: 0.0145 }, { flags: ".", dt: 0.0147 });
    L2 = L2.concat(P.convo({ t: at(11), a: ME, b: "10.20.0.31", pa: 51990, pb: 873, steps: big }));
    L2 = L2.concat(P.dns(at(12.5), ME, "10.20.0.2", 51015, 9555, "kestrel-backups.s3.example.net", "A", [{ type: "A", data: "198.51.100.140", ttl: 60 }]));
    L2.sort(function (a, b) { return a.t - b.t; });
    return L2;
  }
  function preTshark(sys) { if (S.M3 && S.M3.preinstall) S.M3.preinstall(sys, "tshark"); }
  LABS.push({
    id: "net-205", n: 16, module: 2, ticket: "NET-205", xp: 140, layer: "L2–7",
    title: "A day on the wire",
    topic: "tshark: display filters, fields, conversations, following a stream",
    from: DEV,
    story: "<p>Yesterday afternoon the IDS on the office network grumbled about kc-legacy-01, then went quiet. The capture is in <code>~/captures/day.pcap</code>. Go through it with <b>tshark</b> (Wireshark's command-line twin): what's in it, who looked up what, which conversation moved the most data, and who was poking the old intranet, with what.</p>",
    learn:
      "<h3>tshark</h3><p>tshark decodes far more protocols than tcpdump and has Wireshark's <b>display filters</b>. Install it from the <code>tshark</code> package (it may ask whether normal users can capture: no is fine).</p>" + ex("tshark -r ~/captures/day.pcap") +
      "<p>Each line: number, seconds since the first packet, source → destination, protocol, length, and an info column.</p>" +
      "<h3>Display filters (-Y)</h3><p>Different from tcpdump's capture filters: they're applied after decoding, and they name protocol <b>fields</b>:</p>" +
      '<table class="t"><tr><th>Filter</th><th>Keeps</th></tr><tr><td><code>dns</code>, <code>http</code>, <code>tls</code>, <code>icmp</code></td><td>a protocol</td></tr><tr><td><code>ip.addr == 10.20.0.40</code></td><td>to or from an address</td></tr><tr><td><code>tcp.port == 873</code></td><td>a port</td></tr><tr><td><code>http.request</code></td><td>HTTP requests only</td></tr><tr><td><code>dns.flags.response == 0</code></td><td>DNS questions, not answers</td></tr><tr><td><code>tcp.flags.syn == 1 &amp;&amp; tcp.flags.ack == 0</code></td><td>connection attempts</td></tr><tr><td><code>http.user_agent contains \"curl\"</code></td><td>text match</td></tr></table>' +
      "<h3>Just the fields you want (-T fields -e)</h3>" + ex("tshark -r ~/captures/day.pcap -Y http.request -T fields -e ip.src -e http.request.uri") +
      "<p>Tab-separated, one line per packet: perfect for <code>sort | uniq -c</code>.</p>" +
      "<h3>Statistics (-z)</h3><p>Add <code>-q</code> to skip the packet list:</p>" + code("tshark -r FILE -q -z conv,tcp               # TCP conversations, biggest first\ntshark -r FILE -q -z follow,tcp,ascii,3     # the text of TCP stream number 3\ntshark -r FILE -q -z io,phs                 # which protocols, how much") +
      "<p>Stream numbers come from the field <code>tcp.stream</code>: <code>-T fields -e tcp.stream</code>.</p>",
    files: { "captures/day.pcap": N.pcapFile(dayCapture(false)) },
    starter: "",
    objectives: [
      {
        id: "read", text: "Install tshark and read <code>~/captures/day.pcap</code>.",
        hints: ["sudo apt install tshark, then tshark -r FILE.", "sudo apt install -y tshark\ntshark -r ~/captures/day.pcap"],
        check: function (r) { return ran(r, /\btshark\b.*-r\b.*day\.pcap/, function (e) { return outHas(e, /Standard query 0x/); }) ? true : "tshark -r ~/captures/day.pcap (install it first)."; }
      },
      {
        id: "names", text: "Which names did machines look up? Print only the <b>names in DNS questions</b>, one per line.",
        hints: ["-Y 'dns.flags.response == 0' -T fields -e dns.qry.name", "tshark -r ~/captures/day.pcap -Y 'dns.flags.response == 0' -T fields -e dns.qry.name"],
        check: function (r) { return NH.proves(r, function (x) { var pk = N.readPcap(x.read("captures/day.pcap")); return pk.filter(function (p) { return p.dns && !p.dns.resp; }).map(function (p) { return p.dns.q; }); }, null, function (e) { return /\btshark\b/.test(e.cmd); }, "Print just the queried names: a display filter for DNS questions and -T fields -e dns.qry.name.", "x"); }
      },
      {
        id: "http", text: "Show only the <b>HTTP requests</b> with who sent them and which URL.",
        hints: ["-Y http.request -T fields -e ip.src -e http.request.uri", "tshark -r ~/captures/day.pcap -Y http.request -T fields -e ip.src -e http.request.uri"],
        check: function (r) { return ran(r, /\btshark\b.*http\.request/, function (e) { return e.out.length === 4 && outHas(e, /10\.20\.5\.33\s+\/index\.php\?id=1%27/) && outHas(e, /10\.20\.5\.21\s+\//); }) ? true : "Four requests, each with its source address and URI (-T fields -e ip.src -e http.request.uri)."; }
      },
      {
        id: "ua", text: "One client isn't a browser. Print the <b>User-Agent</b> of each request and write the tool's name (the word before the slash) to <code>~/scanner.txt</code>.",
        hints: ["-e http.user_agent", "tshark -r ~/captures/day.pcap -Y http.request -T fields -e ip.src -e http.user_agent\necho sqlmap > ~/scanner.txt"],
        check: function (r) {
          if (!ran(r, /\btshark\b/, function (e) { return outHas(e, /sqlmap\/1\.8\.4/); })) return "Print the http.user_agent field of the requests.";
          return word(r, "scanner.txt") === "sqlmap" ? true : "~/scanner.txt: just the tool's name.";
        }
      },
      {
        id: "conv", text: "Which TCP conversation moved the most data? Write its <b>server address and port</b> (like <code>10.20.0.40:80</code>) to <code>~/biggest.txt</code>.",
        hints: ["-q -z conv,tcp lists conversations, biggest first. The server is the side with the well-known port.", "tshark -r ~/captures/day.pcap -q -z conv,tcp\necho 10.20.0.31:873 > ~/biggest.txt"],
        check: function (r) {
          if (!ran(r, /\btshark\b.*conv,tcp/)) return "List the conversations with -q -z conv,tcp.";
          return word(r, "biggest.txt") === "10.20.0.31:873" ? true : "~/biggest.txt: the server side (address:port) of the top conversation.";
        }
      },
      {
        id: "follow", text: "Follow the TCP stream of the scanner's <b>second</b> request and read what it really asked for.",
        hints: ["Find the stream numbers: -Y http.request -T fields -e tcp.stream -e http.request.uri. Then -q -z follow,tcp,ascii,N.", "tshark -r ~/captures/day.pcap -Y http.request -T fields -e tcp.stream -e http.request.uri\ntshark -r ~/captures/day.pcap -q -z follow,tcp,ascii,3"],
        check: function (r) { return ran(r, /\btshark\b.*follow,tcp,ascii,\d+/, function (e) { return outHas(e, /^GET \/index\.php\?id=1%27%20OR%20%271%27%3D%271 HTTP\/1\.1/); }) ? true : "Follow the right stream (-z follow,tcp,ascii,N): it starts with GET /index.php?id=1%27%20OR..."; }
      }
    ],
    solution: lines("sudo apt install -y tshark", "tshark -r ~/captures/day.pcap", "tshark -r ~/captures/day.pcap -Y 'dns.flags.response == 0' -T fields -e dns.qry.name", "tshark -r ~/captures/day.pcap -Y http.request -T fields -e ip.src -e http.request.uri", "tshark -r ~/captures/day.pcap -Y http.request -T fields -e ip.src -e http.user_agent", "echo sqlmap > ~/scanner.txt", "tshark -r ~/captures/day.pcap -q -z conv,tcp", "echo 10.20.0.31:873 > ~/biggest.txt", "tshark -r ~/captures/day.pcap -Y http.request -T fields -e tcp.stream -e http.request.uri", "tshark -r ~/captures/day.pcap -q -z follow,tcp,ascii,3"),
    debrief: "<p>Ticket closed. A normal afternoon, plus one visitor: <b>10.20.5.33</b> ran <b>sqlmap</b> against the old intranet, trying SQL injection (<code>' OR '1'='1</code>, then <code>UNION SELECT</code>). The 404s say it found nothing to inject into this time. Dev will find out whose laptop .33 is.</p><p>The biggest conversation was the nightly rsync to kc-backup-01, as expected. And one DNS name stands out for a follow-up: <code>kestrel-backups.s3.example.net</code>, a storage bucket nobody mentioned.</p>",
    realworld: "Install Wireshark on your computer and open a capture: the same display filters work in its filter bar. Sample captures to practise on: wiki.wireshark.org/SampleCaptures.",
    quiz: [
      { q: "Which is a <b>display</b> filter (tshark -Y / Wireshark)?", options: ["port 80", "host 10.20.0.40", "http.request", "tcp[tcpflags] & tcp-syn != 0"], answer: 2, why: "Display filters name protocol fields; the others are tcpdump/BPF capture filters." },
      { q: "What does <code>-z conv,tcp</code> show?", options: ["Each TCP conversation with its packets and bytes", "Only SYNs", "DNS answers", "The certificate"], answer: 0, why: "A per-conversation summary, sorted by bytes." },
      { q: "Why follow a TCP stream?", options: ["To speed it up", "To read the whole conversation's data in order, as text", "To decrypt TLS", "To drop it"], answer: 1, why: "It reassembles the data both sides sent." }
    ]
  });

  /* ================================================================== NET-206 ICMP & MTU */
  function blackhole(sys) {
    var nw = sys.nw;
    nw.pmtuBlackhole = true; nw.partnerMtu = 1400;
    X.setNetplan(sys, N.NETPLAN.replace("          via: 10.20.0.1\n", "          via: 10.20.0.1\n        - to: 172.16.50.0/24\n          via: 10.20.0.254\n"));
  }
  function partnerRoute(r) { return N.routes4(nw(r)).filter(function (x) { return x.dst === "172.16.50.0" && x.prefix === 24; })[0]; }
  LABS.push({
    id: "net-206", n: 17, module: 2, ticket: "NET-206", xp: 140, layer: "L3",
    title: "Small packets work, big ones vanish",
    topic: "ICMP types, ping -M do -s, path MTU, black holes, route MTU",
    from: BEN,
    story: "<p>Northwind moved their API behind a new VPN tunnel last night. Since then: <code>ping partner-api.kestrel.internal</code> works perfectly, but every HTTPS call hangs until it times out. They say their side is fine and their firewall \"blocks ICMP for security\". Find out what's going on and make our calls work.</p>",
    learn:
      "<h3>ICMP: the network's error messages</h3><p>ICMP carries ping, but mostly it carries <b>errors</b> back to the sender:</p>" +
      '<table class="t"><tr><th>Type</th><th>Name</th><th>Sent when</th></tr><tr><td>8 / 0</td><td>echo request / reply</td><td>ping</td></tr><tr><td>3 code 1, 3</td><td>destination unreachable: host, port</td><td>no route on, or UDP to a closed port</td></tr><tr><td>3 code 4</td><td>fragmentation needed</td><td>a packet with \"don\'t fragment\" is too big for the next link</td></tr><tr><td>11</td><td>time exceeded</td><td>TTL reached zero: what traceroute uses</td></tr></table>' +
      "<h3>MTU</h3><p>Every link has a maximum packet size, its <b>MTU</b>: 1500 bytes on Ethernet. Tunnels (VPNs, WireGuard, GRE) add their own headers, so packets inside them must be smaller: often 1400 or less. The smallest MTU along a path is the <b>path MTU</b>.</p>" +
      "<p>TCP packets carry the <b>DF</b> (don't fragment) flag. When one is too big, the router at the narrow link drops it and sends back ICMP \"fragmentation needed, mtu 1400\"; the sender then uses smaller packets. That's <b>path MTU discovery</b>.</p>" +
      '<div class="callout warn">If a firewall blocks that ICMP message, the sender never learns. Small packets (ping, the TCP handshake, short requests) get through; big ones (a TLS certificate, a page) silently disappear. Connections open and then hang: a <b>PMTU black hole</b>.</div>' +
      "<h3>Testing the path MTU with ping</h3>" + code("ping -M do -s 1472 -c 2 HOST    # 1472 + 28 header bytes = 1500, \"don't fragment\"\nping -M do -s 1372 -c 2 HOST    # 1400") +
      "<p><code>-M do</code> sets DF; <code>-s</code> is the data size, and the packet is 28 bytes bigger (IP and ICMP headers). Find the biggest size that gets an answer.</p>" +
      "<h3>Fixing it from our side</h3><p>If you can't fix the firewall, lower the MTU for traffic to that network only, on the route:</p>" + code("sudo ip route replace 172.16.50.0/24 via 10.20.0.254 mtu 1400") +
      "<p>In netplan, a route can carry <code>mtu: 1400</code> too. (The cleaner fix at the VPN router is \"MSS clamping\", which rewrites TCP's maximum segment size as connections pass through.)</p>" + CAPTURE_HELP,
    system: blackhole,
    diagram: ["vpn", "partner"],
    starter: "",
    objectives: [
      {
        id: "ping", text: "Ping the partner API (<code>partner-api.kestrel.internal</code>) to show the path works for small packets.",
        hints: ["ping -c 2 NAME", "ping -c 2 partner-api.kestrel.internal"],
        check: function (r) { return ran(r, /\bping\b.*(partner-api|172\.16\.50\.10)/, function (e) { return / 0% packet loss/.test(e.out.join("\n")) && !/-M\s*do/.test(e.cmd); }) ? true : "A normal ping to partner-api.kestrel.internal should get every reply."; }
      },
      {
        id: "hang", text: "Now call it: <code>curl https://partner-api.kestrel.internal/v1/status</code>. What happens?",
        hints: ["Just run it (add -v to see how far the TLS handshake gets).", "curl -v https://partner-api.kestrel.internal/v1/status"],
        check: function (r) { return ran(r, /\bcurl\b.*partner-api/, function (e) { return outHas(e, /SSL connection timeout/); }) ? true : "Run the curl before fixing anything: it hangs in the TLS handshake."; }
      },
      {
        id: "pmtu", text: "Find the path MTU with <code>ping -M do</code>: a 1500-byte packet (<code>-s 1472</code>) gets nothing back; a 1400-byte one (<code>-s 1372</code>) works. Write the path MTU to <code>~/pmtu.txt</code>.",
        hints: ["Run both pings. The path MTU is the packet size: data + 28.", "ping -M do -s 1472 -c 2 172.16.50.10\nping -M do -s 1372 -c 2 172.16.50.10\necho 1400 > ~/pmtu.txt"],
        check: function (r) {
          if (!ran(r, /\bping\b.*-M\s*do.*-s\s*1472|\bping\b.*-s\s*1472.*-M\s*do/, function (e) { return /100% packet loss/.test(e.out.join("\n")); })) return "ping -M do -s 1472 to the partner: no answers.";
          if (!ran(r, /\bping\b.*-M\s*do.*-s\s*13\d\d|\bping\b.*-s\s*13\d\d.*-M\s*do/, function (e) { return / [1-9]\d* received/.test(e.out.join("\n")); })) return "Now a smaller size that does get through (-s 1372).";
          return word(r, "pmtu.txt") === "1400" ? true : "~/pmtu.txt: the biggest packet size (data + 28) that gets through.";
        }
      },
      {
        id: "fix", text: "Lower the MTU on the route to <code>172.16.50.0/24</code> to that size and call the API again: it answers.",
        hints: ["ip route replace NETWORK via GATEWAY mtu N.", "sudo ip route replace 172.16.50.0/24 via 10.20.0.254 mtu 1400\ncurl -s https://partner-api.kestrel.internal/v1/status"],
        check: function (r) {
          var rt = partnerRoute(r);
          if (!rt || !rt.mtu || rt.mtu > 1400) return "The route to 172.16.50.0/24 needs mtu 1400 (ip route replace ... mtu 1400).";
          return ran(r, /\bcurl\b.*partner-api/, function (e) { return outHas(e, /Northwind/); }) ? true : "Now call the API again.";
        }
      },
      {
        id: "keep", text: "Make it permanent: add <code>mtu: 1400</code> to the partner route in <code>/etc/netplan/01-kestrel.yaml</code> and apply.",
        hints: ["Under the route's to: and via: lines, add mtu: 1400 with the same indentation.", "sudo nano /etc/netplan/01-kestrel.yaml\n        - to: 172.16.50.0/24\n          via: 10.20.0.254\n          mtu: 1400\nsudo netplan apply"],
        check: function (r) {
          var l = N.npLoad(r.sys);
          if (l.errors.length) return "netplan can't read the file: " + l.errors[0].split("\n")[0];
          var rt = ((l.conf.ethernets.eth0 || {}).routes || []).filter(function (x) { return String(x.to) === "172.16.50.0/24"; })[0];
          if (!rt || +rt.mtu !== 1400) return "Add mtu: 1400 to the 172.16.50.0/24 route in the netplan file.";
          return nw(r).routes.some(function (x) { return x.netplan && x.dst === "172.16.50.0" && x.mtu === 1400; }) ? true : "Apply it: sudo netplan apply.";
        }
      },
      {
        id: "icmp", text: "ICMP at work: capture ICMP in the background while you traceroute (numeric) to kc-mon-01 (10.20.5.10). Which two ICMP message types come back?",
        hints: ["Background icmp capture, traceroute -n 10.20.5.10, stop the capture.", "sudo tcpdump -i eth0 -n icmp &\ntraceroute -n 10.20.5.10\nsudo pkill tcpdump"],
        check: function (r) { return anyOut(r, /ICMP time exceeded in-transit/) && anyOut(r, /udp port \d+ unreachable/) ? true : "Capture ICMP in the background while traceroute runs: you'll see \"time exceeded\" from the router and \"port unreachable\" from the destination."; }
      }
    ],
    solution: lines("ping -c 2 partner-api.kestrel.internal", "curl -v https://partner-api.kestrel.internal/v1/status", "ping -M do -s 1472 -c 2 172.16.50.10", "ping -M do -s 1372 -c 2 172.16.50.10", "echo 1400 > ~/pmtu.txt", "sudo ip route replace 172.16.50.0/24 via 10.20.0.254 mtu 1400", "curl -s https://partner-api.kestrel.internal/v1/status", "sudo nano /etc/netplan/01-kestrel.yaml", "    # Network for kc-web-01. Managed by the Kestrel ops team.", "    # Apply changes with: sudo netplan apply", "    network:", "      version: 2", "      ethernets:", "        eth0:", "          addresses:", "            - 10.20.0.15/24", "          routes:", "            - to: default", "              via: 10.20.0.1", "            - to: 172.16.50.0/24", "              via: 10.20.0.254", "              mtu: 1400", "          nameservers:", "            addresses: [10.20.0.2]", "            search: [kestrel.internal]", "sudo netplan apply", "sudo tcpdump -i eth0 -n icmp &", "traceroute -n 10.20.5.10", "sudo pkill tcpdump"),
    debrief: "<p>Ticket closed. The new tunnel can only carry 1400-byte packets, and Northwind's firewall throws away the ICMP \"fragmentation needed\" that should have told us so. Ping (84 bytes) and the TCP handshake are tiny, so they worked; the server's TLS certificate needs full-size packets, which vanished: a classic <b>PMTU black hole</b>.</p><p>Lowering the route MTU makes kc-web-01 use smaller TCP segments for that network only. The real fix belongs at the VPN (MSS clamping) and in Northwind's firewall: blocking <b>all</b> ICMP breaks the internet in exactly this way. Allow at least \"fragmentation needed\" (type 3 code 4) and time exceeded.</p>",
    realworld: "Find your own path MTU: ping -M do -s 1472 -c 1 1.1.1.1 (Linux) or ping -f -l 1472 1.1.1.1 (Windows). On a VPN at home, try again: the biggest size that works shrinks.",
    quiz: [
      { q: "Pings work but HTTPS hangs after connecting. A likely cause?", options: ["DNS", "A path MTU black hole: big packets dropped, ICMP blocked", "Wrong port", "An expired certificate"], answer: 1, why: "Small packets pass, large ones vanish silently." },
      { q: "<code>ping -M do -s 1472</code> sends a packet of what size?", options: ["1472", "1500", "1400", "56"], answer: 1, why: "1472 data + 8 ICMP + 20 IP = 1500." },
      { q: "Which ICMP message does traceroute rely on?", options: ["Echo reply", "Time exceeded", "Redirect", "Fragmentation needed"], answer: 1, why: "Each router that drops a TTL-expired probe sends time exceeded." }
    ]
  });

  /* ================================================================== NET-207 DNS & DHCP on the wire */
  var BUILD_YAML = "# kc-web-01's leg on the build network (eth1). The build network hands out addresses by DHCP.\nnetwork:\n  version: 2\n  ethernets:\n    eth1:\n      dhcp4: true\n";
  function buildNic(sys) {
    var nw = sys.nw;
    nw.ifs.eth1 = N.nic("eth1", W.MY_MAC2, "sw-core-01/16", 3, "enp0s4");
    nw.ifs.eth1.admin = false;
    nw.ifs.eth1.stats = { rxB: 0, rxP: 0, rxE: 0, rxD: 0, txB: 0, txP: 0, txE: 0, coll: 0, crc: 0 };
    nw.sw["sw-core-01/16"] = { autoneg: true, speed: 1000, duplex: "full", maxSpeed: 1000 };
    M2.putRoot(sys, "/home/dev/02-build.yaml", BUILD_YAML, 436, 1000, 1000, NOW - HOUR);
  }
  LABS.push({
    id: "net-207", n: 18, module: 2, ticket: "NET-207", xp: 130, layer: "L7",
    title: "Lookups and leases",
    topic: "DNS over UDP and TCP, NXDOMAIN, DHCP's four messages",
    from: MAYA,
    story: "<p>Two things you've used all along without seeing them. First, DNS: watch a lookup, a failed lookup and a lookup over TCP go by. Second, DHCP: kc-web-01 is getting a second network card (eth1) on the <b>build network</b>, which hands out addresses with DHCP. The config is ready in <code>~/02-build.yaml</code>. Put it in place and capture the conversation that gives eth1 its address.</p>",
    learn:
      "<h3>DNS on the wire</h3><p>A lookup is normally one UDP packet each way on port 53. In tcpdump:</p>" +
      code("10.20.0.15.51003 > 10.20.0.2.53: 7311+ A? kestrel.example.com. (37)\n10.20.0.2.53 > 10.20.0.15.51003: 7311 1/0/0 A 203.0.113.80 (53)") +
      "<p><code>7311</code> is the query ID (the answer must match it), <code>+</code> means recursion desired, <code>A?</code> the question, <code>1/0/0</code> the counts of answer/authority/additional records. A failed lookup comes back as <code>NXDomain</code> (\"no such name\").</p>" +
      "<p>DNS uses <b>TCP</b> port 53 too: for answers too big for UDP, for zone transfers, and when you ask for it (<code>dig +tcp</code>). Firewalls that only allow UDP 53 break those.</p>" +
      "<h3>DHCP: DORA</h3><p>A machine with no address can't send normal IP packets, so DHCP uses <b>broadcasts</b> from 0.0.0.0 on UDP ports 68 (client) and 67 (server):</p>" +
      '<table class="t"><tr><th>Message</th><th>From → to</th><th>Says</th></tr><tr><td><b>D</b>iscover</td><td>0.0.0.0:68 → 255.255.255.255:67</td><td>any DHCP servers out there? (my MAC is ...)</td></tr><tr><td><b>O</b>ffer</td><td>server → client</td><td>you can have 10.20.60.15, gateway, DNS, for a day</td></tr><tr><td><b>R</b>equest</td><td>0.0.0.0 → broadcast</td><td>I\'ll take 10.20.60.15 from that server</td></tr><tr><td><b>A</b>CK</td><td>server → client</td><td>it\'s yours</td></tr></table>' +
      "<p><code>tcpdump -v</code> shows the DHCP options: message type, offered address, router, DNS servers, lease time. tcpdump can only listen on an interface that is <b>up</b>: <code>sudo ip link set eth1 up</code> first.</p>" +
      '<div class="callout">Netplan files must be owned by root and not readable by others: <code>sudo cp FILE /etc/netplan/</code>, then <code>sudo chmod 600</code> it.</div>' + CAPTURE_HELP,
    system: buildNic,
    starter: "",
    objectives: [
      {
        id: "dns", text: "Capture port 53 in the background while you look up <code>kestrel.example.com</code> and a name that doesn't exist (<code>nope.kestrel.example.com</code>). Stop the capture.",
        hints: ["sudo tcpdump -i eth0 -n port 53 & ; two digs ; sudo pkill tcpdump", "sudo tcpdump -i eth0 -n port 53 &\ndig kestrel.example.com\ndig nope.kestrel.example.com\nsudo pkill tcpdump"],
        check: function (r) {
          if (!anyOut(r, /A\? kestrel\.example\.com\./)) return "Capture the lookup of kestrel.example.com (start the capture first).";
          return anyOut(r, /NXDomain/) ? true : "Look up nope.kestrel.example.com while the capture runs: the answer is NXDomain.";
        }
      },
      {
        id: "tcp", text: "Now the same lookup over <b>TCP</b> (<code>dig +tcp</code>), with a capture of port 53 running. You should see a handshake to port 53.",
        hints: ["Start the capture again, dig +tcp, stop.", "sudo tcpdump -i eth0 -n port 53 &\ndig +tcp kestrel.example.com\nsudo pkill tcpdump"],
        check: function (r) { return anyOut(r, /> 10\.20\.0\.2\.53: Flags \[S\]/) ? true : "Capture port 53 while you run dig +tcp: the first packet is a SYN to 10.20.0.2.53."; }
      },
      {
        id: "dhcp", text: "Give eth1 its address: copy <code>~/02-build.yaml</code> into <code>/etc/netplan/</code> (root-only permissions) and apply it, with a <b>verbose</b> capture of DHCP (ports 67 and 68) on <b>eth1</b> running.",
        hints: ["Bring eth1 up (tcpdump can't listen on a down interface), capture with -i eth1 -n -v 'port 67 or port 68' &. Then cp, chmod 600, netplan apply, pkill.", "sudo ip link set eth1 up\nsudo tcpdump -i eth1 -n -v 'port 67 or port 68' &\nsudo cp ~/02-build.yaml /etc/netplan/\nsudo chmod 600 /etc/netplan/02-build.yaml\nsudo netplan apply\nsudo pkill tcpdump"],
        check: function (r) {
          var d = nw(r).ifs.eth1;
          if (!d.addrs.some(function (a) { return a.dhcp; })) return "eth1 has no DHCP address yet: put the file in /etc/netplan/ and apply.";
          if (!anyOut(r, /DHCP-Message \(53\), length 1: Discover/)) return "Capture the DHCP messages verbosely (-v) on eth1 while netplan applies the file.";
          return anyOut(r, /DHCP-Message \(53\), length 1: ACK/) ? true : "The capture should show all four messages, up to the ACK.";
        }
      },
      {
        id: "lease", text: "From the capture, which address was offered, and by which DHCP server? Write both to <code>~/lease.txt</code> (address first). Then check eth1 with <code>ip -br a</code>.",
        hints: ["Your-IP and Server-ID in the Offer.", "printf '10.20.60.15\\n10.20.60.1\\n' > ~/lease.txt\nip -br a"],
        check: function (r) {
          var t = fileLines(r, "lease.txt");
          if (t[0] !== "10.20.60.15") return "~/lease.txt, line 1: the offered address (Your-IP).";
          if (t[1] !== "10.20.60.1") return "~/lease.txt, line 2: the DHCP server (Server-ID).";
          return ran(r, /\bip\b.*\ba(ddr)?\b/, function (e) { return outHas(e, /^eth1\s+UP\s+10\.20\.60\.15\/24/); }) ? true : "Check with ip -br a: eth1 should be UP with 10.20.60.15/24.";
        }
      }
    ],
    solution: lines("sudo tcpdump -i eth0 -n port 53 &", "dig kestrel.example.com", "dig nope.kestrel.example.com", "sudo pkill tcpdump", "sudo tcpdump -i eth0 -n port 53 &", "dig +tcp kestrel.example.com", "sudo pkill tcpdump", "sudo ip link set eth1 up", "sudo tcpdump -i eth1 -n -v 'port 67 or port 68' &", "sudo cp ~/02-build.yaml /etc/netplan/", "sudo chmod 600 /etc/netplan/02-build.yaml", "sudo netplan apply", "sudo pkill tcpdump", "printf '10.20.60.15\\n10.20.60.1\\n' > ~/lease.txt", "ip -br a"),
    debrief: "<p>Ticket closed. You've now seen both protocols every network depends on. DNS: one small UDP question, one answer, matched by ID; NXDomain when the name doesn't exist; TCP when asked (or when answers are big). DHCP: four messages, broadcast because the client has no address yet, carrying the address, router, DNS servers and lease time.</p><p>Both are also attack surfaces: anyone on a LAN can answer DHCP broadcasts (rogue DHCP) or race the real DNS server's answer. That's Module 3.</p>",
    realworld: "On your own machine: sudo tcpdump -n -v 'port 67 or port 68' & and then reconnect to Wi-Fi (or run sudo dhclient -v on older systems): you'll see DORA.",
    quiz: [
      { q: "Why does DHCP Discover come from 0.0.0.0?", options: ["It's a bug", "The client has no address yet", "To hide the client", "It's IPv6"], answer: 1, why: "The client broadcasts until a server gives it an address." },
      { q: "What does <code>NXDomain</code> in a DNS answer mean?", options: ["Server down", "The name doesn't exist", "Timed out", "TCP needed"], answer: 1, why: "Non-existent domain." },
      { q: "When does DNS use TCP?", options: ["Never", "Big answers, zone transfers, or when asked", "Only for IPv6", "Always"], answer: 1, why: "UDP is the default; TCP for size and transfers." }
    ]
  });

  /* ================================================================== NET-208 Slow, not down */
  function slow(sys) {
    M2.putRoot(sys, "/etc/resolv.conf", "# Set by hand during the 2026-10-03 DNS outage. Put back to the systemd-resolved stub later!\nnameserver 10.20.0.9\nnameserver 10.20.0.2\nsearch kestrel.internal\n", 420, 0, 0, NOW - 39 * DAY);
    sys.nw.hopLoss = { "203.0.113.1": 40 };
    sys.appRoutes = { "/api/report": [200, "{\"rows\":12873,\"generated\":\"2026-11-11T09:00:00Z\"}\n", 2400] };
  }
  function namelookup(r) { var g = N.getaddrinfo(r.sys, "kestrel.example.com", 4); return g.delay || 0; }
  function wTimes(e) { var m = /(\d+\.\d+)/g, v = [], x; var s = e.out.join(" "); while ((x = m.exec(s))) v.push(+x[1]); return v; }
  LABS.push({
    id: "net-208", n: 19, module: 2, ticket: "NET-208", xp: 130, layer: "L3–7",
    title: "Slow, not down",
    topic: "curl -w timings, resolver timeouts, mtr and packet loss, server time",
    from: MAYA,
    story: "<p>Everything on kc-web-01 that talks to the outside feels slow: every request takes five seconds or more before anything happens. Nothing is down. And the new <code>/api/report</code> endpoint is slow on top of that. Ben thinks it's \"the network\" and wants to call the ISP because of a scary mtr report. Measure before anyone calls anyone.</p>",
    learn:
      "<h3>Where does the time go? curl -w</h3><p>curl can print timings for each phase of a request, all measured from the start:</p>" +
      code("curl -s -o /dev/null -w 'dns %{time_namelookup}\\nconnect %{time_connect}\\ntls %{time_appconnect}\\nfirst byte %{time_starttransfer}\\ntotal %{time_total}\\n' https://kestrel.example.com/") +
      '<table class="t"><tr><th>Phase</th><th>A big number means</th></tr><tr><td><code>time_namelookup</code></td><td>slow DNS (5 s exactly: a DNS server that never answers)</td></tr><tr><td><code>time_connect</code> − namelookup</td><td>network round trip, or SYN retransmissions</td></tr><tr><td><code>time_appconnect</code> − connect</td><td>the TLS handshake</td></tr><tr><td><code>time_starttransfer</code> − appconnect</td><td>the <b>server</b> thinking: the app, the database</td></tr></table>' +
      "<h3>The resolver's 5 seconds</h3><p>Programs read <code>/etc/resolv.conf</code> and ask its <code>nameserver</code> lines <b>in order</b>. If the first one doesn't answer, they wait 5 seconds before trying the next, on every lookup. On Ubuntu this file should point at the systemd-resolved stub (<code>127.0.0.53</code>); it's normally a link to <code>/run/systemd/resolve/stub-resolv.conf</code>.</p>" +
      "<h3>mtr: traceroute that keeps going</h3>" + ex("mtr -r -c 10 example.com") +
      "<p>mtr pings every hop many times and shows loss and latency per hop. Read it carefully: routers answer ping only when they have time (<b>ICMP rate limiting</b>), so loss at a middle hop that <b>doesn't continue</b> to the later hops is not real loss. Only loss that carries on to the destination matters.</p>",
    system: slow,
    diagram: ["site"],
    starter: "",
    objectives: [
      {
        id: "measure", text: "Measure a request to <code>https://kestrel.example.com/</code> with <code>curl -w</code>: print at least <code>time_namelookup</code>, <code>time_connect</code> and <code>time_total</code>.",
        hints: ["curl -s -o /dev/null -w 'FORMAT' URL; each %{...} is a variable.", "curl -s -o /dev/null -w 'dns %{time_namelookup}\\nconnect %{time_connect}\\ntotal %{time_total}\\n' https://kestrel.example.com/"],
        check: function (r) { return ran(r, /\bcurl\b.*time_namelookup.*time_connect|time_connect.*time_namelookup/, function (e) { return /time_total/.test(e.cmd) && wTimes(e).some(function (v) { return v >= 5; }); }) ? true : "One curl -w showing time_namelookup, time_connect and time_total (before fixing anything)."; }
      },
      {
        id: "dig", text: "The lookup is the slow part. Ask <code>dig</code> how the resolver gets on, and look at <code>/etc/resolv.conf</code>.",
        hints: ["dig kestrel.example.com and cat /etc/resolv.conf.", "dig kestrel.example.com\ncat /etc/resolv.conf"],
        check: function (r) {
          if (!ran(r, /\bdig\b/, function (e) { return outHas(e, /communications error to 10\.20\.0\.9#53: timed out/); })) return "Run dig kestrel.example.com: the first lines say which server timed out.";
          return ran(r, /\b(cat|less|head|grep|more)\b.*resolv\.conf/) ? true : "Look at /etc/resolv.conf.";
        }
      },
      {
        id: "fix", text: "Put <code>/etc/resolv.conf</code> back the way Ubuntu wants it: a link to <code>/run/systemd/resolve/stub-resolv.conf</code>. Then measure again: the lookup takes milliseconds.",
        hints: ["ln -sf TARGET LINK (with sudo).", "sudo ln -sf /run/systemd/resolve/stub-resolv.conf /etc/resolv.conf\ncurl -s -o /dev/null -w 'dns %{time_namelookup}\\ntotal %{time_total}\\n' https://kestrel.example.com/"],
        check: function (r) {
          if (namelookup(r) > 0) return "Lookups still wait for a dead DNS server: fix /etc/resolv.conf.";
          var n = r.node("/etc/resolv.conf"), ln = S.lookup({ sys: r.sys, uid: 0, gid: 0, groups: [], cwd: "/", umask: 18, vars: {} }, "/etc/resolv.conf", { nofollow: true }).node;
          if (!ln || ln.type !== "l") return "That works, but make /etc/resolv.conf a link to /run/systemd/resolve/stub-resolv.conf again, so the system manages it.";
          var k = idx(r, /\bln\b/);
          return after(r, k, /\bcurl\b.*time_namelookup/, function (e) { var v = wTimes(e); return v.length && v[0] < 1; }) ? true : "Measure again with curl -w: time_namelookup is tiny now.";
        }
      },
      {
        id: "mtr", text: "Run an <code>mtr</code> report to example.com (10 cycles). Is there real packet loss on the way? Write <code>yes</code> or <code>no</code> to <code>~/loss.txt</code>.",
        hints: ["mtr -r -c 10 example.com. Look at whether the loss continues to the last hop.", "mtr -r -c 10 example.com\necho no > ~/loss.txt"],
        check: function (r) {
          if (!ran(r, /\bmtr\b.*example\.com/, function (e) { return outHas(e, /edge1\.isp\.example\.net\s+40\.0%/); })) return "Run mtr -r -c 10 example.com.";
          return word(r, "loss.txt") === "no" ? true : "Look at the last hop: does the 40% at hop 2 carry on?";
        }
      },
      {
        id: "server", text: "Now <code>/api/report</code>: measure <code>https://kestrel.example.com/api/report</code> with <code>time_appconnect</code> and <code>time_starttransfer</code>. How long does the <b>server</b> think? Write the seconds (one decimal) to <code>~/server-time.txt</code>.",
        hints: ["Server time = time_starttransfer − time_appconnect.", "curl -s -o /dev/null -w 'tls %{time_appconnect}\\nfirst byte %{time_starttransfer}\\n' https://kestrel.example.com/api/report\necho 2.4 > ~/server-time.txt"],
        check: function (r) {
          if (!ran(r, /\bcurl\b.*api\/report/, function (e) { return /time_starttransfer/.test(e.cmd) && /time_appconnect/.test(e.cmd); })) return "Measure /api/report with time_appconnect and time_starttransfer.";
          var v = parseFloat(word(r, "server-time.txt"));
          return Math.abs(v - 2.4) <= 0.1 ? true : "~/server-time.txt: time_starttransfer minus time_appconnect, in seconds.";
        }
      }
    ],
    solution: lines("curl -s -o /dev/null -w 'dns %{time_namelookup}\\nconnect %{time_connect}\\ntotal %{time_total}\\n' https://kestrel.example.com/", "dig kestrel.example.com", "cat /etc/resolv.conf", "sudo ln -sf /run/systemd/resolve/stub-resolv.conf /etc/resolv.conf", "curl -s -o /dev/null -w 'dns %{time_namelookup}\\ntotal %{time_total}\\n' https://kestrel.example.com/", "mtr -r -c 10 example.com", "echo no > ~/loss.txt", "curl -s -o /dev/null -w 'tls %{time_appconnect}\\nfirst byte %{time_starttransfer}\\n' https://kestrel.example.com/api/report", "echo 2.4 > ~/server-time.txt"),
    debrief: "<p>Ticket closed, and nobody had to call the ISP. Every request waited exactly <b>5 seconds</b> because a hand-edited <code>/etc/resolv.conf</code> from an old outage listed a DNS server that doesn't exist first. Five seconds on the dot is almost always a resolver timeout.</p><p>The mtr \"loss\" at the ISP's edge router was ICMP rate limiting: the hops after it, and example.com itself, lost nothing. And <code>/api/report</code> spends 2.4 s in the application before sending a byte: that's a ticket for the app team, not the network. Measure each phase and the blame goes where it belongs.</p>",
    realworld: "Time a site from your own machine: curl -s -o /dev/null -w '%{time_namelookup} %{time_connect} %{time_appconnect} %{time_starttransfer} %{time_total}\\n' https://example.com. Install mtr (or WinMTR on Windows) and try it to a far-away site.",
    quiz: [
      { q: "Every lookup takes exactly 5 seconds. Most likely?", options: ["A slow website", "The first nameserver in resolv.conf doesn't answer", "Packet loss", "TLS"], answer: 1, why: "5 s is the resolver's default timeout per server." },
      { q: "mtr shows 40% loss at hop 2 and 0% at every hop after it. Is there real loss?", options: ["Yes, 40%", "No: hop 2 just rate-limits its replies", "Yes, 80%", "Can't tell"], answer: 1, why: "Loss that doesn't carry on to the destination isn't loss of your traffic." },
      { q: "time_starttransfer − time_appconnect is large. Who's slow?", options: ["DNS", "The network", "The server/application", "TLS"], answer: 2, why: "That's the wait between sending the request and the first byte back." }
    ]
  });

  /* ================================================================== NET-209 Proxies & load balancers */
  var UPSTREAM = "# The app runs twice; nginx spreads requests over both.\nupstream kestrel_app {\n\tserver 127.0.0.1:8080;\n\tserver 127.0.0.1:8081;\n}\n";
  function twoApps(sys) {
    M2.putRoot(sys, "/etc/nginx/conf.d/kestrel-upstream.conf", UPSTREAM);
    M2.putRoot(sys, "/etc/nginx/sites-available/kestrel", N.NGX.kestrel.replace("proxy_pass http://127.0.0.1:8080;", "proxy_pass http://kestrel_app;"));
    M2.putRoot(sys, "/etc/systemd/system/kestrel-app2.service", X.unitText("Kestrel web app (second instance)", "/opt/kestrel/app/venv/bin/gunicorn -b 127.0.0.1:8081 app:app"), 420);
    S.mkdirs(sys, "/etc/systemd/system/multi-user.target.wants").children["kestrel-app2.service"] = S.linkNode("/etc/systemd/system/kestrel-app2.service");
    M2.unitUp(sys, "kestrel-app2.service", NOW - 5 * HOUR);
    sys.appRoutes = { "/api/whoami": [200, function (s, req) { return JSON.stringify({ instance: req.port === 8081 ? "app-2" : "app-1", remote_addr: req.client || "127.0.0.1", x_forwarded_for: req.headers["x-forwarded-for"] || null, x_real_ip: req.headers["x-real-ip"] || null, proto: req.headers["x-forwarded-proto"] || null }) + "\n"; }] };
  }
  function siteText(r) { return r.read("/etc/nginx/sites-available/kestrel") || ""; }
  LABS.push({
    id: "net-209", n: 20, module: 2, ticket: "NET-209", xp: 140, layer: "L4–7",
    title: "Who's really asking?",
    topic: "Reverse proxies, upstreams and failover, X-Forwarded-For, L4 vs L7 load balancing",
    from: DEV,
    story: "<p>Our new rate limiter and the audit log both see <b>every</b> customer as <code>127.0.0.1</code>, so one abusive client looks like everyone. nginx sits in front of the app (two instances, behind an <code>upstream</code>) and forgets to tell it who the client was.</p><p>Fix that, show me how easily the header can be faked, and prove the site survives losing one app instance.</p>",
    learn:
      "<h3>Reverse proxies</h3><p>nginx here is a <b>reverse proxy</b>: clients connect to it, it opens its <b>own</b> connection to the app and relays the answer. That's why the app sees nginx's address (127.0.0.1) as the client. A load balancer is a reverse proxy with several backends.</p>" +
      code("upstream kestrel_app {          # a group of backends\n    server 127.0.0.1:8080;\n    server 127.0.0.1:8081;     # round robin between them\n}\nlocation /api/ {\n    proxy_pass http://kestrel_app;\n}") +
      "<p>If a backend refuses the connection, nginx logs an error and tries the next one: the client never notices. (kc-lb-01 in front of us does active <b>health checks</b> too: it requests a URL every few seconds and stops sending to backends that fail.)</p>" +
      "<h3>Passing the client's address on</h3><p>The proxy adds headers for the app:</p>" +
      code("proxy_set_header X-Real-IP $remote_addr;\nproxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;\nproxy_set_header X-Forwarded-Proto $scheme;") +
      "<p><code>$remote_addr</code> is whoever connected to nginx. <code>$proxy_add_x_forwarded_for</code> is the X-Forwarded-For header the client sent, <b>plus</b> <code>$remote_addr</code> at the end: each proxy appends one address.</p>" +
      '<div class="callout warn">A client can send any X-Forwarded-For it likes. Only the addresses added by proxies <b>you</b> run can be trusted: in practice, the last one (or the last N, if you have N proxies). Rate limiting on the first address in the list lets anyone dodge it.</div>' +
      "<h3>L4 vs L7 load balancing</h3>" +
      '<table class="t"><tr><th></th><th>Layer 4 (TCP)</th><th>Layer 7 (HTTP)</th></tr><tr><td>Sees</td><td>addresses and ports only</td><td>URLs, headers, cookies</td></tr><tr><td>TLS</td><td>passes it through</td><td>terminates it (holds the certificate)</td></tr><tr><td>Client IP at the backend</td><td>preserved (or via PROXY protocol)</td><td>lost, unless headers like X-Forwarded-For carry it</td></tr><tr><td>Can route by path, add headers</td><td>no</td><td>yes</td></tr></table>' +
      "<p>After editing nginx: <code>sudo nginx -t</code> to test, <code>sudo systemctl reload nginx</code> to apply.</p>",
    system: twoApps,
    diagram: ["lb", "site"],
    starter: "",
    objectives: [
      {
        id: "rr", text: "Call <code>https://kestrel.example.com/api/whoami</code> a few times. Which app instances answer, and what client address does the app see?",
        hints: ["curl -s it two or three times (↑ repeats).", "curl -s https://kestrel.example.com/api/whoami\ncurl -s https://kestrel.example.com/api/whoami"],
        check: function (r) {
          var outs = r.history.filter(function (e) { return /\bcurl\b.*api\/whoami/.test(e.cmd); }).map(function (e) { return e.out.join(""); });
          if (!outs.some(function (o) { return /"instance":"app-1"/.test(o); }) || !outs.some(function (o) { return /"instance":"app-2"/.test(o); })) return "Call /api/whoami until you've seen both instances answer.";
          return true;
        }
      },
      {
        id: "headers", text: "Make nginx pass the client's address on: add <code>X-Real-IP</code>, <code>X-Forwarded-For</code> and <code>X-Forwarded-Proto</code> headers to the <code>/api/</code> location in <code>/etc/nginx/sites-available/kestrel</code>, test, reload, and check whoami again.",
        hints: ["Three proxy_set_header lines inside location /api/ { }, next to proxy_pass. Then sudo nginx -t and sudo systemctl reload nginx.", "sudo nano /etc/nginx/sites-available/kestrel\n\tlocation /api/ {\n\t\tproxy_pass http://kestrel_app;\n\t\tproxy_set_header X-Real-IP $remote_addr;\n\t\tproxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;\n\t\tproxy_set_header X-Forwarded-Proto $scheme;\n\t}\nsudo nginx -t\nsudo systemctl reload nginx\ncurl -s https://kestrel.example.com/api/whoami"],
        check: function (r) {
          var t = siteText(r);
          if (!/proxy_set_header\s+X-Forwarded-For\s+\$proxy_add_x_forwarded_for/i.test(t)) return "Add proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for; to location /api/.";
          if (!/proxy_set_header\s+X-Real-IP\s+\$remote_addr/i.test(t) || !/proxy_set_header\s+X-Forwarded-Proto\s+\$scheme/i.test(t)) return "Add the X-Real-IP and X-Forwarded-Proto headers too.";
          if (!ran(r, /\bnginx\s+-t\b/)) return "Test the config with sudo nginx -t before reloading.";
          return ran(r, /\bcurl\b.*api\/whoami/, function (e) { return outHas(e, /"x_forwarded_for":"10\.20\.0\.15"/) && outHas(e, /"proto":"https"/); }) ? true : "Reload nginx and call whoami: x_forwarded_for should now be your address.";
        }
      },
      {
        id: "spoof", text: "Now be a cheeky client: send your own <code>X-Forwarded-For: 6.6.6.6</code> header to whoami. What does the app receive?",
        hints: ["curl -H 'X-Forwarded-For: 6.6.6.6' ...", "curl -s -H 'X-Forwarded-For: 6.6.6.6' https://kestrel.example.com/api/whoami"],
        check: function (r) { return ran(r, /\bcurl\b.*X-Forwarded-For/i, function (e) { return outHas(e, /"x_forwarded_for":"6\.6\.6\.6, 10\.20\.0\.15"/); }) ? true : "Send the header with curl -H (after adding the proxy headers): the app gets your fake address first, then the real one."; }
      },
      {
        id: "failover", text: "Stop the second app instance (<code>kestrel-app2</code>). Call whoami a couple of times: does the site still work? Then find nginx's complaint in its error log.",
        hints: ["sudo systemctl stop kestrel-app2, curl twice, then look at the end of /var/log/nginx/error.log.", "sudo systemctl stop kestrel-app2\ncurl -s https://kestrel.example.com/api/whoami\ncurl -s https://kestrel.example.com/api/whoami\nsudo tail -n 3 /var/log/nginx/error.log"],
        check: function (r) {
          var u = M2.loadUnit(r.sys, "kestrel-app2.service");
          if (!u || u.rt.active === "active") return "Stop kestrel-app2 first.";
          var k = idx(r, /\bsystemctl\b.*\bstop\b.*kestrel-app2/);
          var n = r.history.filter(function (e, i) { return i > k && /\bcurl\b.*api\/whoami/.test(e.cmd) && outHas(e, /"instance":"app-1"/); }).length;
          if (n < 2) return "Call whoami at least twice after stopping it: app-1 answers every time.";
          return ran(r, /error\.log/, function (e) { return outHas(e, /connect\(\) failed \(111: Connection refused\).*127\.0\.0\.1:8081/); }) ? true : "Look at the end of /var/log/nginx/error.log (sudo tail): nginx tried 8081 and moved on.";
        }
      }
    ],
    solution: lines.apply(null, ["curl -s https://kestrel.example.com/api/whoami", "curl -s https://kestrel.example.com/api/whoami", "sudo nano /etc/nginx/sites-available/kestrel"].concat(N.NGX.kestrel.replace("proxy_pass http://127.0.0.1:8080;", "proxy_pass http://kestrel_app;\n\t\tproxy_set_header X-Real-IP $remote_addr;\n\t\tproxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;\n\t\tproxy_set_header X-Forwarded-Proto $scheme;").replace(/\n$/, "").split("\n").map(function (l) { return "    " + l; })).concat(["sudo nginx -t", "sudo systemctl reload nginx", "curl -s https://kestrel.example.com/api/whoami", "curl -s -H 'X-Forwarded-For: 6.6.6.6' https://kestrel.example.com/api/whoami", "sudo systemctl stop kestrel-app2", "curl -s https://kestrel.example.com/api/whoami", "curl -s https://kestrel.example.com/api/whoami", "sudo tail -n 3 /var/log/nginx/error.log"])),
    debrief: "<p>Ticket closed. A reverse proxy opens its own connection to the app, so without help the app only ever sees the proxy. Three <code>proxy_set_header</code> lines fixed that, and the spoofing test showed why the rate limiter must use the <b>last</b> address in X-Forwarded-For (the one our nginx added), never the first.</p><p>Stopping an app instance cost nothing: nginx's connection to 8081 was refused, it logged it, and quietly used 8080. In production kc-lb-01 does the same one level up, with active health checks so it stops trying dead backends at all.</p>",
    realworld: "Look at the headers your own requests pick up through a proxy: curl -s https://httpbin.org/headers shows what the server received. Behind a CDN, X-Forwarded-For usually lists your address and the CDN's.",
    quiz: [
      { q: "Behind nginx, why does the app see 127.0.0.1 as the client?", options: ["A bug in the app", "nginx opens its own connection to the app", "IPv6", "The firewall"], answer: 1, why: "A reverse proxy is the app's client." },
      { q: "X-Forwarded-For is \"6.6.6.6, 10.20.0.15\". Which address can you trust?", options: ["6.6.6.6", "10.20.0.15, the one your proxy added", "Both", "Neither"], answer: 1, why: "Clients can put anything first; trust only what your own proxies appended." },
      { q: "Which load balancer can route by URL path?", options: ["Layer 4", "Layer 7", "Both", "Neither"], answer: 1, why: "Only an L7 (HTTP) balancer reads the request." }
    ]
  });

  /* ================================================================== NET-210 Capstone: the mystery capture */
  var FTP_PW = "Summer" + "2026" + "!";
  function mystery(alt) {
    var t0 = Date.UTC(2026, 10, 11, 2, 14, 3) / 1000 + 0.2, L2 = [], ATT = alt ? "10.20.5.88" : "10.20.5.47", LEG = "10.20.0.40", pw = alt ? "Winter" + "1999" : FTP_PW;
    function at(dt) { return t0 + dt; }
    L2 = L2.concat(P.dns(at(0), ME, "10.20.0.2", 51003, 7311, "kc-db-01.kestrel.internal", "A", [{ type: "A", data: "10.20.0.21", ttl: 3600 }]));
    L2.push(P.udp(at(0.4), ME, "10.20.0.1", 41211, 123, { appName: "NTPv4 request", bin: [0x23, 0, 6, 0x20].concat(new Array(44).fill(0)) }), P.udp(at(0.4012), "10.20.0.1", ME, 123, 41211, { appName: "NTPv4 reply", bin: [0x24, 2, 6, 0xe9].concat(new Array(44).fill(7)) }));
    L2 = L2.concat(P.convo({ t: at(1), a: ME, b: "93.184.215.14", pa: 50300, pb: 443, ttlB: 57, steps: [{ flags: "S", dt: 0 }, { dir: "<", flags: "S.", dt: 0.088 }, { flags: ".", dt: 0.0882 }, { flags: "P.", enc: { tls: 22, len: 517, seed: 61 }, dt: 0.0884, appName: "TLS ClientHello" }, { dir: "<", flags: "P.", enc: { tls: 22, len: 1448, seed: 62 }, dt: 0.177, appName: "TLS ServerHello, Certificate" }, { flags: "F.", dt: 0.3 }, { dir: "<", flags: "F.", dt: 0.39 }] }));
    L2 = L2.concat(P.convo({ t: at(2), a: "10.20.5.22", b: ME, pa: 50122, pb: 22, isnA: 1800400, steps: [{ flags: "P.", enc: { len: 36, seed: 71 }, dt: 0 }, { dir: "<", flags: "P.", enc: { len: 52, seed: 72 }, dt: 0.0004 }] }));
    // the scan of kc-legacy-01
    var open = { 21: 1, 22: 1, 23: 1, 25: 1, 80: 1, 110: 1, 143: 1, 445: 1, 3306: 1 };
    [1, 7, 9, 13, 21, 22, 23, 25, 53, 80, 110, 111, 135, 139, 143, 443, 445, 993, 995, 3306, 3389, 5432, 8080].forEach(function (p, i) {
      L2 = L2.concat(P.convo({ t: at(3 + i * 0.002), a: ATT, b: LEG, pa: 44123, pb: p, isnA: 11000 + i, steps: open[p] ? [{ flags: "S", dt: 0 }, { dir: "<", flags: "S.", dt: 0.0004 }, { flags: "R", dt: 0.0005 }] : [{ flags: "S", dt: 0 }, { dir: "<", flags: "R.", dt: 0.0004 }] }));
    });
    // clear-text FTP login
    L2 = L2.concat(P.convo({ t: at(6), a: ATT, b: LEG, pa: 52011, pb: 21, steps: [{ flags: "S", dt: 0 }, { dir: "<", flags: "S.", dt: 0.0004 }, { flags: ".", dt: 0.0006 }, { dir: "<", flags: "P.", data: "220 (vsFTPd 3.0.3)\r\n", dt: 0.01 }, { flags: "P.", data: "USER backup\r\n", dt: 1.2 }, { dir: "<", flags: "P.", data: "331 Please specify the password.\r\n", dt: 1.201 }, { flags: "P.", data: "PASS " + pw + "\r\n", dt: 3.4 }, { dir: "<", flags: "P.", data: "230 Login successful.\r\n", dt: 3.45 }, { flags: "P.", data: "RETR db-backup.sql.gz\r\n", dt: 4 }, { dir: "<", flags: "P.", data: "150 Opening BINARY mode data connection for db-backup.sql.gz (84123904 bytes).\r\n", dt: 4.01 }] }));
    // SNMP with the default community
    L2.push(P.udp(at(11), ATT, LEG, 40312, 161, { snmp: { community: "public", oid: ".1.3.6.1.2.1.1.1.0", reqid: 10780 } }), P.udp(at(11.002), LEG, ATT, 161, 40312, { snmp: { community: "public", oid: ".1.3.6.1.2.1.1.1.0", resp: true, value: "Linux kc-legacy-01 4.15.0-213-generic #224-Ubuntu SMP x86_64", reqid: 10780 } }));
    // Redis on kc-data-01
    L2 = L2.concat(P.convo({ t: at(12), a: ATT, b: "10.20.0.45", pa: 52101, pb: 6379, steps: [{ flags: "S", dt: 0 }, { dir: "<", flags: "S.", dt: 0.0004 }, { flags: ".", dt: 0.0006 }, { flags: "P.", data: "KEYS *\r\n", dt: 0.5 }, { dir: "<", flags: "P.", data: "*3\r\n$22\r\nsession:7c1f0a2e9b3d4c\r\n$22\r\nsession:3a9e5b7d1c0f2e\r\n$13\r\ncart:user:1042\r\n", dt: 0.501 }, { flags: "F.", dt: 1 }] }));
    // Jenkins script console
    L2 = L2.concat(P.convo({ t: at(14), a: ATT, b: LEG, pa: 52200, pb: 8081, steps: [{ flags: "S", dt: 0 }, { dir: "<", flags: "S.", dt: 0.0004 }, { flags: ".", dt: 0.0006 }, { flags: "P.", data: "GET /script HTTP/1.1\r\nHost: kc-legacy-01:8081\r\nUser-Agent: python-requests/2.31.0\r\nAccept: */*\r\n\r\n", dt: 0.001 }, { dir: "<", flags: "P.", data: "HTTP/1.1 200 OK\r\nServer: Jetty(10.0.13)\r\nX-Jenkins: 2.387.3\r\nContent-Type: text/html;charset=utf-8\r\n\r\n<html><title>Script Console [Jenkins]</title></html>\n", dt: 0.02 }, { flags: "F.", dt: 0.03 }] }));
    // Telnet and MySQL
    L2 = L2.concat(P.convo({ t: at(16), a: ATT, b: LEG, pa: 52300, pb: 23, steps: [{ flags: "S", dt: 0 }, { dir: "<", flags: "S.", dt: 0.0004 }, { flags: ".", dt: 0.0006 }, { dir: "<", flags: "P.", data: "Ubuntu 18.04.6 LTS\r\nkc-legacy-01 login: ", dt: 0.02 }, { flags: "P.", data: "root\r\n", dt: 1.5 }, { dir: "<", flags: "P.", data: "Password: ", dt: 1.51 }, { flags: "F.", dt: 4 }] }));
    L2 = L2.concat(P.convo({ t: at(18), a: ME, b: LEG, pa: 51400, pb: 3306, steps: [{ flags: "S", dt: 0 }, { dir: "<", flags: "S.", dt: 0.0005 }, { flags: ".", dt: 0.0006 }, { dir: "<", flags: "P.", enc: { len: 78, seed: 81 }, dt: 0.002, appName: "MySQL server greeting" }, { flags: "P.", enc: { len: 120, seed: 82 }, dt: 0.003, appName: "MySQL login" }, { flags: "F.", dt: 0.01 }] }));
    L2 = L2.concat(P.icmp(at(20), "10.20.5.10", ME, 211, 4410));
    L2.sort(function (a, b) { return a.t - b.t; });
    return L2;
  }
  var FLOWS = { 21: /ftp/, 22: /ssh/, 23: /telnet/, 53: /dns|domain/, 123: /ntp/, 161: /snmp/, 443: /https|tls|ssl/, 3306: /mysql/, 6379: /redis|resp/, 8081: /http|jenkins/ };
  LABS.push({
    id: "net-210", n: 21, module: 2, ticket: "NET-210", xp: 250, layer: "L2–7", capstone: true,
    title: "The mystery capture",
    topic: "Capstone: identify every conversation in a capture",
    from: DEV,
    story: "<p>At 02:14 last night the office network's tap recorded 20 seconds of traffic that triggered half a dozen IDS alerts. It's in <code>~/captures/mystery.pcap</code>. I need to know <b>everything</b> that happened in it, as a list of every service that was used, and the answers to four questions for the incident report.</p><p>Use whatever you like: tcpdump, tshark, grep. The Ports tab may help.</p>",
    learn:
      "<h3>Your brief</h3><p>No hints in a capstone. Produce these files:</p>" +
      '<table class="t"><tr><th>File</th><th>Contents</th></tr>' +
      "<tr><td><code>~/flows.txt</code></td><td>one line per <b>service that carried data</b> (not ports that were only scanned): the server port and the protocol, like <code>22 ssh</code>. Ten of them.</td></tr>" +
      "<tr><td><code>~/scanner.txt</code></td><td>the address that port-scanned kc-legacy-01</td></tr>" +
      "<tr><td><code>~/ftp-password.txt</code></td><td>the FTP password that crossed the network in clear text</td></tr>" +
      "<tr><td><code>~/snmp-community.txt</code></td><td>the SNMP community string used</td></tr>" +
      "<tr><td><code>~/jenkins-path.txt</code></td><td>the path the attacker requested from Jenkins</td></tr></table>" +
      '<div class="callout">Useful starting points: <code>tshark -r FILE -q -z conv,tcp</code> and <code>-z conv,udp</code>; <code>tcpdump -r FILE -n -A</code> shows clear-text payloads; scans are SYNs answered by RSTs (Module 2 lab 4). You already know every protocol in here.</div>' +
      "<p>The reference solution is hidden behind a button on the Tasks tab; revealing it halves this capstone's XP.</p>",
    files: { "captures/mystery.pcap": N.pcapFile(mystery(false)) },
    system: preTshark,
    diagram: ["legacy", "data"],
    starter: "",
    objectives: [
      {
        id: "flows", hints: [], text: "<code>~/flows.txt</code> lists every service that carried data: port and protocol, one per line (ten of them).",
        check: function (r) {
          var t = fileLines(r, "flows.txt").map(function (l) { return l.toLowerCase(); });
          if (!t.length) return "Write ~/flows.txt.";
          for (var p in FLOWS) { var line = t.filter(function (l) { return new RegExp("(^|\\D)" + p + "(\\D|$)").test(l); })[0]; if (!line) return "~/flows.txt is missing a service (" + Object.keys(FLOWS).filter(function (q) { return !t.some(function (l) { return new RegExp("(^|\\D)" + q + "(\\D|$)").test(l); }); }).length + " to go)."; if (!FLOWS[p].test(line)) return "Check the protocol you wrote for port " + p + "."; }
          var extra = t.filter(function (l) { return [1, 7, 9, 13, 111, 135, 139, 993, 995, 3389, 5432, 8080].some(function (q) { return new RegExp("^\\s*" + q + "\\b").test(l); }); });
          return extra.length ? "\"" + extra[0] + "\": that port was only scanned, it didn't carry data." : true;
        }
      },
      { id: "scanner", hints: [], text: "<code>~/scanner.txt</code>: the address that port-scanned kc-legacy-01.", check: function (r) { return word(r, "scanner.txt") === "10.20.5.47" ? true : "Which source sent SYNs to many ports and got RSTs back?"; } },
      { id: "ftp", hints: [], text: "<code>~/ftp-password.txt</code>: the FTP password sent in clear text.", check: function (r) { return (r.read("ftp-password.txt") || "").trim() === FTP_PW ? true : "Read the FTP conversation's payload: the PASS command."; } },
      { id: "snmp", hints: [], text: "<code>~/snmp-community.txt</code>: the SNMP community string.", check: function (r) { return word(r, "snmp-community.txt") === "public" ? true : "Look at the UDP 161 packets."; } },
      { id: "jenkins", hints: [], text: "<code>~/jenkins-path.txt</code>: the path requested from Jenkins.", check: function (r) { return word(r, "jenkins-path.txt") === "/script" ? true : "The HTTP request on port 8081."; } },
      { id: "tools", hints: [], text: "You worked from the capture: read it with tcpdump or tshark, including its TCP conversations.", check: function (r) { if (!ran(r, /\b(tcpdump|tshark)\b.*mystery\.pcap/)) return "Read ~/captures/mystery.pcap with tcpdump or tshark."; return ran(r, /\btshark\b.*conv,(tcp|udp)|\btcpdump\b.*mystery\.pcap/) ? true : "List the conversations."; } }
    ],
    solution: lines("tshark -r ~/captures/mystery.pcap -q -z conv,tcp", "tshark -r ~/captures/mystery.pcap -q -z conv,udp", "tshark -r ~/captures/mystery.pcap -Y 'tcp.flags.reset == 1' -T fields -e ip.dst -e tcp.dstport | sort | uniq -c", "tcpdump -r ~/captures/mystery.pcap -n -A port 21", "tcpdump -r ~/captures/mystery.pcap -n port 161", "tshark -r ~/captures/mystery.pcap -Y http.request -T fields -e ip.src -e http.host -e http.request.uri", "tcpdump -r ~/captures/mystery.pcap -n -A port 6379 or port 23",
      "nano ~/flows.txt", "    21 ftp", "    22 ssh", "    23 telnet", "    53 dns", "    123 ntp", "    161 snmp", "    443 https", "    3306 mysql", "    6379 redis", "    8081 http (jenkins)",
      "echo 10.20.5.47 > ~/scanner.txt", "echo '" + "Summer" + "2026" + "!' > ~/ftp-password.txt", "echo public > ~/snmp-community.txt", "echo /script > ~/jenkins-path.txt"),
    debrief: "<p><b>Module 2 complete.</b> Twenty seconds of capture, the whole story: <b>10.20.5.47</b> scanned kc-legacy-01, logged into its FTP server as <code>backup</code> with a password sent in clear text and started downloading a database backup, read the system description with SNMP's default <code>public</code> community, listed the session keys in the unprotected Redis, opened Jenkins' <b>script console</b> (which runs code on the server) and tried root over Telnet. Mixed in: normal DNS, NTP, HTTPS, SSH and the app's MySQL.</p>" +
      "<p>Everything in that list is something you met this module: plain-text ports, open infrastructure services, scans as SYN and RST. Module 3 is about attacks like this one: how they work on the wire, and how IDS tools like Suricata and Zeek spot them.</p>",
    realworld: "Practise on real captures: the Wireshark sample captures and the Malware-Traffic-Analysis.net exercises are exactly this kind of puzzle.",
    quiz: []
  });

  LABS.forEach(function (l) { l.drills = l.drills || []; T.LABS.push(l); });
  T.UPCOMING = T.UPCOMING.filter(function (x) { return x.module !== 2; });
  T.M2 = { legacyAlt: legacyAlt, filtered3306: filtered3306, dayCapture: dayCapture, blackhole: blackhole, buildNic: buildNic, slow: slow, twoApps: twoApps, mystery: mystery, preTshark: preTshark };
})();
