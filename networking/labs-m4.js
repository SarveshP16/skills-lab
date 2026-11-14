/* sudo learn — Networking track, Module 4: Defending the network (NET-401..410). Scanning your own servers with
   nmap from inside and outside, closing dangerous ports, ufw and nftables, segmentation with host firewalls, a
   bastion with ProxyJump, WireGuard, HTTPS done right, DNS and email security, and a capstone that proves every
   fix with a scan. The engine is in net-m4.js. */
(function () {
  "use strict";
  var T = window.NET_TRACK, S = window.ShEngine, M2 = S.M2, M3 = S.M3, M4 = S.M4, N = window.NetCore, NH = window.NetLab.H, SH = window.ShLab.H;
  var MAYA = "Maya Chen · SRE lead", DEV = "Dev Patel · Security";
  var NOW = S.NOW, DAY = S.DAY, HOUR = 3600000, W = N.W, ME = "10.20.0.15", MON = "10.20.5.10", EXT = "198.51.100.200", BASTION = "10.20.0.5", DB = "10.20.0.21", SESSION_IP = "198.51.100.20";
  var ex = T.ex, code = T.code, lines = T.lines;
  var ran = NH.ran, outHas = NH.outHas, idx = NH.idx;
  var LABS = [];
  function L(t) { return SH.lines(t || ""); }
  function after(r, i, re, fn) { return r.history.some(function (e, k) { return k > i && re.test(e.cmd) && (!fn || fn(e)); }); }
  function word(r, p) { return (r.read(p) || "").trim().toLowerCase(); }
  function nums(r, p) { return (r.read(p) || "").split(/[\s,]+/).filter(function (x) { return /^\d+$/.test(x); }).map(Number).sort(function (a, b) { return a - b; }); }
  function pre(names) { return function (sys) { names.forEach(function (n) { M3.preinstall(sys, n); }); }; }
  function mach(r, ip) { return M2.machine(r.sys, ip); }
  var CAND = [21, 22, 23, 25, 80, 443, 2375, 3306, 5432, 6379, 8080, 9100, 11211];
  // which candidate ports a machine can open on a target right now
  function openFrom(r, fromIp, toIp, ports) { var m = fromIp ? mach(r, fromIp) : r.sys; return (ports || CAND).filter(function (p) { return N.tcpOpen(m, toIp, p).ok; }); }
  function stateFrom(r, fromIp, toIp, port) { var m = fromIp ? mach(r, fromIp) : r.sys, t = N.tcpOpen(m, toIp, port); return t.ok ? "open" : t.err === "refused" ? "closed" : "filtered"; }
  function publicListeners(sys) { return M2.listeners(sys).filter(function (l) { return !/^(127\.|\[::1\])/.test(l.sock.addr); }); }
  function nmapOut(r, re, fn) { return ran(r, /\bnmap\b/, function (e) { return (!re || re.test(e.cmd)) && (!fn || fn(e)); }); }
  function openLines(e) { return e.out.filter(function (l) { return /^\d+\/(tcp|udp)\s+open\s/.test(l); }).map(function (l) { return +l.split("/")[0]; }); }
  function unitOn(sys, name) { var u = sys.units && sys.units[name]; return !!u && u.rt.active === "active"; }
  function enabled(sys, name) { return M2.enabledState(sys, M2.loadUnit(sys, name) || { name: name }) === "enabled"; }
  var VANTAGE_HELP = "<h3>Seeing your server from outside</h3><p>A scan from the server itself goes over the loopback interface: no firewall in the way, and services bound to 127.0.0.1 answer. To see what <b>others</b> see, scan from another machine:</p>" +
    '<table class="t"><tr><th>Machine</th><th>Where</th><th>Use it for</th></tr><tr><td><code>kc-mon-01</code></td><td>office network, 10.20.5.10</td><td>what colleagues and the monitoring see</td></tr><tr><td><code>ext-scan-01.example.net</code></td><td>the internet, 198.51.100.200</td><td>what attackers see</td></tr></table>' +
    code("ssh kc-mon-01 nmap kc-web-01                       # one command over SSH\nssh ext-scan-01.example.net nmap -Pn kestrel.example.com") + "<p>Both have nmap; the lab types your password on them.</p>";

  /* ================================================================== NET-401 Scan your own servers */
  var SCOPE = "Kestrel scan authorisation (signed: D. Patel, Security)\n\nIN SCOPE\n  10.20.0.0/24            server LAN\n  kestrel.example.com     public site (203.0.113.80)\n  kc-web-01 from kc-mon-01 and ext-scan-01.example.net\n\nOUT OF SCOPE\n  10.20.5.0/24            office network (people's laptops)\n  172.16.50.0/24          partner network\n  anything else on the internet\n";
  function scopeOk(r) {
    var bad = r.history.filter(function (e) { return /\bnmap\b/.test(e.cmd) && /(\b10\.20\.5\.\d|\b172\.16\.|\b8\.8\.|\b1\.1\.1\.1\b|\bexample\.com\b|scanme)/.test(e.cmd.replace(/kestrel\.example\.com/g, "")); });
    return bad.length ? "Out of scope: \"" + bad[0].cmd + "\". Only scan what ~/scope.txt allows." : null;
  }
  LABS.push({
    id: "net-401", n: 30, module: 4, ticket: "NET-401", xp: 160, layer: "L3–7",
    title: "Know what you expose",
    topic: "nmap: host discovery, port states, versions, all ports, UDP, inside vs outside, scope",
    from: MAYA,
    story: "<p>Module 3 was about attackers. This module is about making their life boring. Step one is knowing what we expose, and the attacker's favourite tool, <b>nmap</b>, is also the defender's.</p><p>Dev signed a scan authorisation (<code>~/scope.txt</code>): the server LAN and our public site. Inventory it: which machines are up, what runs on them, what our own server shows to the office versus to itself.</p>",
    learn:
      '<div class="callout warn">Only scan what you\'re authorised to scan, and keep the authorisation. To a network owner a scan is indistinguishable from the start of an attack.</div>' +
      "<h3>Host discovery</h3>" + ex("sudo nmap -sn 10.20.0.0/24") + "<p><code>-sn</code> only asks \"who's there?\" (ARP on the local network, ping and a couple of TCP probes elsewhere) without scanning ports.</p>" +
      "<h3>Port states</h3>" + '<table class="t"><tr><th>State</th><th>Means</th></tr><tr><td>open</td><td>something accepts connections</td></tr><tr><td>closed</td><td>the host answered RST: reachable, nothing listening</td></tr><tr><td>filtered</td><td>no answer: a firewall dropped the probe</td></tr><tr><td>open|filtered</td><td>UDP with no answer: can\'t tell</td></tr></table>' +
      "<h3>Useful options</h3>" + '<table class="t"><tr><th>Option</th><th>Does</th></tr><tr><td><code>-sS</code> (root default) / <code>-sT</code></td><td>SYN scan (half-open) / full connect scan (the default without sudo)</td></tr><tr><td><code>-p 22,80</code>, <code>-p 1-1024</code>, <code>-p-</code></td><td>which ports; <b>by default only the 1000 most common</b></td></tr><tr><td><code>-sV</code></td><td>ask each open port what software it runs</td></tr><tr><td><code>-sU</code></td><td>UDP (slow, needs root)</td></tr><tr><td><code>-Pn</code></td><td>skip discovery: treat the host as up (for hosts that drop pings)</td></tr><tr><td><code>-oN FILE</code></td><td>save the report</td></tr></table>' +
      VANTAGE_HELP,
    files: { "scope.txt": SCOPE },
    system: pre(["nmap"]),
    diagram: ["legacy", "data", "mon"],
    starter: "",
    objectives: [
      {
        id: "sweep", text: "Find every live host on the server LAN and write how many there are to <code>~/live-hosts.txt</code>.",
        hints: ["nmap -sn on the /24, as root; the last line counts them.", "sudo nmap -sn 10.20.0.0/24\necho 13 > ~/live-hosts.txt"],
        check: function (r) { var so = scopeOk(r); if (so) return so; var e = r.history.filter(function (x) { return /\bnmap\b.*-sn\b.*10\.20\.0\.0\/24|\bnmap\b.*10\.20\.0\.0\/24.*-sn\b/.test(x.cmd); }).pop(); if (!e) return "Run a ping sweep of 10.20.0.0/24 (-sn)."; var m = /\((\d+) hosts? up\)/.exec(e.out.join("\n")); return m && word(r, "live-hosts.txt") === m[1] ? true : "Copy the number of hosts up from nmap's last line."; }
      },
      {
        id: "legacy", text: "Scan kc-legacy-01 with <b>service versions</b> and save the report as <code>~/legacy.nmap</code>.",
        hints: ["-sV and -oN FILE.", "sudo nmap -sV -oN ~/legacy.nmap kc-legacy-01"],
        check: function (r) { var t = r.read("legacy.nmap") || ""; if (!t) return "Save the scan with -oN ~/legacy.nmap."; if (!/VERSION/.test(t)) return "Add -sV so the report has versions."; return /8081\/tcp\s+open/.test(t) && /OpenSSH 7\.6p1/.test(t) ? true : "Scan kc-legacy-01 itself (its default 1000 ports)."; }
      },
      {
        id: "missed", text: "A default scan of kc-data-01 shows two open ports. Scan <b>all 65535</b> and write the open ports the default scan <b>missed</b> to <code>~/missed.txt</code>.",
        hints: ["nmap kc-data-01, then nmap -p- kc-data-01, and compare.", "nmap kc-data-01\nnmap -p- kc-data-01\necho '6379 27017' > ~/missed.txt"],
        check: function (r) { if (!nmapOut(r, /-p-|-p\s*1-65535/, function (e) { return outHas(e, /27017\/tcp\s+open/); })) return "Scan every port of kc-data-01 (-p-)."; return nums(r, "missed.txt").join(",") === "6379,27017" ? true : "Which open ports appear only with -p-?"; }
      },
      {
        id: "udp", text: "Check UDP ports <b>53, 123 and 161</b> on kc-legacy-01. Write the ones that are <b>open</b> to <code>~/udp-open.txt</code>.",
        hints: ["sudo nmap -sU -p 53,123,161 kc-legacy-01", "sudo nmap -sU -p 53,123,161 kc-legacy-01\necho '123 161' > ~/udp-open.txt"],
        check: function (r) { if (!nmapOut(r, /-sU/, function (e) { return outHas(e, /161\/udp\s+open\s/); })) return "Run a UDP scan (-sU, as root) of those three ports."; return nums(r, "udp-open.txt").join(",") === "123,161" ? true : "Only the ports nmap reports as open (not closed)."; }
      },
      {
        id: "inside", text: "Scan all ports of kc-web-01 <b>from itself</b> (localhost) and <b>from kc-mon-01</b>. Write the port that only answers from inside to <code>~/inside-only.txt</code>.",
        hints: ["nmap -p- localhost, then ssh kc-mon-01 nmap -p- kc-web-01. Compare the lists.", "nmap -p- localhost\nssh kc-mon-01 nmap -p- kc-web-01\necho 8080 > ~/inside-only.txt"],
        check: function (r) {
          if (!nmapOut(r, /localhost|127\.0\.0\.1/, function (e) { return outHas(e, /8080\/tcp\s+open/); })) return "Scan localhost (all ports).";
          if (!ran(r, /\bnmap\b/, function (e) { return outHas(e, /Nmap scan report for kc-web-01/) && !outHas(e, /8080\/tcp\s+open/) && outHas(e, /22\/tcp\s+open/) && /ssh\s+kc-mon-01|^nmap/.test(e.cmd); })) return "Now scan kc-web-01 from kc-mon-01 (ssh kc-mon-01 nmap -p- kc-web-01).";
          var so = scopeOk(r); if (so) return so;
          return nums(r, "inside-only.txt").join(",") === "8080" ? true : "Which port is open from localhost but not from the office?";
        }
      }
    ],
    solution: lines("cat ~/scope.txt", "sudo nmap -sn 10.20.0.0/24", "echo 13 > ~/live-hosts.txt", "sudo nmap -sV -oN ~/legacy.nmap kc-legacy-01", "nmap kc-data-01", "nmap -p- kc-data-01", "echo '6379 27017' > ~/missed.txt",
      "sudo nmap -sU -p 53,123,161 kc-legacy-01", "echo '123 161' > ~/udp-open.txt", "nmap -p- localhost", "ssh kc-mon-01 nmap -p- kc-web-01", "echo 8080 > ~/inside-only.txt"),
    debrief: "<p>An inventory you can trust. The server LAN has 13 live hosts; kc-legacy-01 runs old OpenSSH, Postfix, MySQL 5.7 and Jenkins; kc-data-01 hides Redis and MongoDB on ports a default scan never touches, which is exactly why attackers scan <code>-p-</code> and so should you. UDP needed a separate (slow, root) scan.</p><p>And the most useful habit: <b>scan from where the attacker sits</b>. From inside, kc-web-01 shows the app on 8080; from the office it doesn't, because the app only listens on 127.0.0.1. Next: a server that exposes far too much.</p>",
    realworld: "nmap -sn 192.168.1.0/24 on your home network shows every device; nmap -p- your own laptop's IP from another device shows what it exposes. Only scan networks you own.",
    quiz: [
      { q: "A port shows as filtered. Why?", options: ["Nothing listens", "A firewall dropped the probe, so nmap got no answer", "The service crashed", "It's UDP"], answer: 1, why: "Closed ports answer RST; filtered ones don't answer." },
      { q: "Why scan with -p-?", options: ["It's faster", "The default only checks the 1000 most common ports", "It skips the firewall", "It finds versions"], answer: 1, why: "Services on unusual ports are invisible to a default scan." },
      { q: "Why scan your server from another machine?", options: ["It's faster", "Locally you bypass the firewall and see loopback-only services", "nmap can't scan localhost", "For UDP"], answer: 1, why: "Only an outside scan shows what others can reach." }
    ]
  });

  /* ================================================================== NET-402 Dangerous open ports */
  function riskySys(sys) { M3.preinstall(sys, "nmap"); N.riskyServices(sys, ["redis", "memcached", "docker", "snmp", "telnet", "mysql"], NOW - 40 * DAY); }
  function listenAddrs(sys, port, proto) { return M2.listeners(sys).filter(function (l) { return l.sock.port === port && l.sock.proto === (proto || "tcp"); }).map(function (l) { return l.sock.addr; }); }
  function onlyLoopback(sys, port, proto) { var a = listenAddrs(sys, port, proto); return a.length > 0 && a.every(function (x) { return /^(127\.|\[::1\])/.test(x); }); }
  LABS.push({
    id: "net-402", n: 31, module: 4, ticket: "NET-402", xp: 190, layer: "L4–7",
    title: "Close the doors",
    topic: "Redis, memcached, the Docker API, MySQL, SNMP and Telnet: find them from outside, bind to localhost or switch off",
    from: DEV,
    story: "<p>Last quarter a contractor set kc-web-01 up \"to make debugging easier\". The office scanner now lights up like a Christmas tree. Every one of these services is either used <b>only by kc-web-01 itself</b> (the app's Redis, memcached and MySQL), or not used at all (Docker's remote API, SNMP, Telnet).</p><p>Find them all from the office side, fix each one properly (localhost or off, no firewall tricks yet), then scan again to prove only SSH, HTTP and HTTPS are left.</p>",
    learn:
      "<h3>Why these are dangerous</h3>" + '<table class="t"><tr><th>Port</th><th>Service</th><th>Exposed means</th><th>Fix</th></tr>' +
      "<tr><td>6379</td><td>Redis</td><td>read and change every key; often write files, then a shell</td><td><code>bind 127.0.0.1 -::1</code>, <code>protected-mode yes</code> in /etc/redis/redis.conf</td></tr>" +
      "<tr><td>11211</td><td>memcached</td><td>read the cache; used in huge UDP amplification DDoS</td><td><code>-l 127.0.0.1</code> in /etc/memcached.conf</td></tr>" +
      "<tr><td>2375</td><td>Docker API (no TLS)</td><td><b>root on the host</b> for anyone who can connect</td><td>remove the tcp:// host from /etc/docker/daemon.json (use the local socket, or SSH: <code>DOCKER_HOST=ssh://…</code>)</td></tr>" +
      "<tr><td>3306</td><td>MySQL</td><td>password guessing, old bugs</td><td><code>bind-address = 127.0.0.1</code> in mysqld.cnf</td></tr>" +
      "<tr><td>161/udp</td><td>SNMP with \"public\"</td><td>anyone reads system details; v1/v2c send the community in clear text</td><td>switch it off, or SNMPv3 restricted to the monitoring host</td></tr>" +
      "<tr><td>23</td><td>Telnet</td><td>logins in clear text (Module 3)</td><td>switch it off: <code>systemctl disable --now inetutils-inetd</code></td></tr></table>" +
      "<h3>The method</h3>" + code("sudo ss -tulpn                     # what listens, on which address, which program\n# fix the config, then\nsudo systemctl restart SERVICE\nsudo ss -tlnp | grep PORT          # 127.0.0.1:PORT now, not 0.0.0.0:PORT") +
      "<p>Binding to <b>127.0.0.1</b> (and <b>::1</b>) means only programs on the same machine can connect, whatever any firewall does. That's the first line of defence; the firewall is the second.</p>" + VANTAGE_HELP,
    system: riskySys,
    diagram: ["mon"],
    starter: "",
    objectives: [
      {
        id: "find", text: "From <b>kc-mon-01</b>, scan <b>every TCP port</b> of kc-web-01 with versions, and check UDP 161 too.",
        hints: ["ssh kc-mon-01 nmap -p- -sV kc-web-01, and sudo nmap -sU -p 161 there.", "ssh kc-mon-01 nmap -p- -sV kc-web-01\nssh kc-mon-01 sudo nmap -sU -p 161 kc-web-01"],
        check: function (r) { if (!nmapOut(r, /-p-/, function (e) { return outHas(e, /2375\/tcp\s+open\s+docker/) && outHas(e, /VERSION/) && outHas(e, /Nmap scan report for kc-web-01/); })) return "Scan all TCP ports of kc-web-01 with -sV from kc-mon-01."; return nmapOut(r, /-sU/, function (e) { return outHas(e, /161\/udp\s+open/); }) ? true : "Now UDP port 161 (sudo nmap -sU -p 161 kc-web-01 on kc-mon-01)."; }
      },
      {
        id: "redis", text: "<b>Redis</b>: only kc-web-01's app uses it. Make it listen on localhost only, with protected mode on, and restart it.",
        hints: ["Edit /etc/redis/redis.conf: bind 127.0.0.1 -::1 and protected-mode yes. Then restart redis-server.", "sudo sed -i 's/^bind 0.0.0.0/bind 127.0.0.1 -::1/; s/^protected-mode no/protected-mode yes/' /etc/redis/redis.conf\nsudo systemctl restart redis-server\nsudo ss -tlnp | grep 6379"],
        check: function (r) { var c = r.read("/etc/redis/redis.conf") || ""; if (!/^protected-mode\s+yes/m.test(c)) return "Turn protected-mode back on."; return onlyLoopback(r.sys, 6379) ? true : "Redis still listens on more than localhost (did you restart it?)."; }
      },
      {
        id: "memcached", text: "<b>memcached</b> and <b>MySQL</b>: same story. Localhost only, restarted.",
        hints: ["-l 127.0.0.1 in /etc/memcached.conf; bind-address = 127.0.0.1 in /etc/mysql/mysql.conf.d/mysqld.cnf.", "sudo sed -i 's/^-l 0.0.0.0/-l 127.0.0.1/' /etc/memcached.conf\nsudo sed -i 's/^bind-address.*/bind-address\\t\\t= 127.0.0.1/' /etc/mysql/mysql.conf.d/mysqld.cnf\nsudo systemctl restart memcached mysql"],
        check: function (r) { if (!onlyLoopback(r.sys, 11211)) return "memcached still listens beyond localhost."; return onlyLoopback(r.sys, 3306) ? true : "MySQL still listens beyond localhost (bind-address)."; }
      },
      {
        id: "docker", text: "The <b>Docker API</b> on 2375 gives root to anyone who connects. Remove the TCP listener (keep the local socket) and restart Docker.",
        hints: ["Edit /etc/docker/daemon.json: keep only unix:///var/run/docker.sock in hosts (or drop hosts).", "sudo nano /etc/docker/daemon.json  (\"hosts\": [\"unix:///var/run/docker.sock\"])\nsudo systemctl restart docker"],
        check: function (r) { var dj = r.read("/etc/docker/daemon.json") || "{}"; try { JSON.parse(dj); } catch (e) { return "/etc/docker/daemon.json isn't valid JSON any more."; } return listenAddrs(r.sys, 2375).length ? "dockerd still listens on 2375 (did you restart docker?)." : unitOn(r.sys, "docker.service") ? true : "Docker should still be running, just without the TCP API."; }
      },
      {
        id: "off", text: "<b>Telnet</b> and <b>SNMP</b> aren't used at all: stop them and stop them starting at boot.",
        hints: ["systemctl disable --now for inetutils-inetd and snmpd.", "sudo systemctl disable --now inetutils-inetd snmpd"],
        check: function (r) { if (listenAddrs(r.sys, 23).length || unitOn(r.sys, "inetutils-inetd.service")) return "Telnet (inetutils-inetd) is still running."; if (listenAddrs(r.sys, 161, "udp").length || unitOn(r.sys, "snmpd.service")) return "snmpd is still running."; return enabled(r.sys, "inetutils-inetd.service") || enabled(r.sys, "snmpd.service") ? "Running no more, but still enabled at boot: disable them." : true; }
      },
      {
        id: "prove", text: "Prove it: scan all TCP ports of kc-web-01 from kc-mon-01 again. Only <b>22, 80 and 443</b> may be open.",
        hints: ["The same scan as the first task.", "ssh kc-mon-01 nmap -p- kc-web-01"],
        check: function (r) {
          var open = openFrom(r, MON, ME); if (open.join(",") !== "22,80,443") return "From the office these are still open: " + open.join(", ") + ".";
          var k = Math.max(idx(r, /systemctl\b.*(restart|disable|stop)/), idx(r, /redis\.conf|memcached\.conf|mysqld\.cnf|daemon\.json/));
          return after(r, k, /\bnmap\b/, function (e) { var o = openLines(e); return outHas(e, /Nmap scan report for kc-web-01/) && /-p-/.test(e.cmd) && o.join(",") === "22,80,443"; }) ? true : "Run the full scan from kc-mon-01 again, after your fixes.";
        }
      }
    ],
    solution: lines("ssh kc-mon-01 nmap -p- -sV kc-web-01", "ssh kc-mon-01 sudo nmap -sU -p 161 kc-web-01", "sudo ss -tulpn",
      "sudo sed -i 's/^bind 0.0.0.0/bind 127.0.0.1 -::1/; s/^protected-mode no/protected-mode yes/' /etc/redis/redis.conf", "sudo systemctl restart redis-server",
      "sudo sed -i 's/^-l 0.0.0.0/-l 127.0.0.1/' /etc/memcached.conf", "sudo sed -i 's/^bind-address.*/bind-address = 127.0.0.1/' /etc/mysql/mysql.conf.d/mysqld.cnf", "sudo systemctl restart memcached mysql",
      "sudo nano /etc/docker/daemon.json", "    {", "      \"hosts\": [\"unix:///var/run/docker.sock\"],", "      \"log-driver\": \"journald\"", "    }", "sudo systemctl restart docker",
      "sudo systemctl disable --now inetutils-inetd snmpd", "sudo ss -tulpn", "ssh kc-mon-01 nmap -p- kc-web-01"),
    debrief: "<p>Eight open ports down to three. Each fix was in the service itself: Redis, memcached and MySQL now listen on 127.0.0.1, which nobody can reach over the network whatever a firewall does; the Docker API is back on its local socket; Telnet and SNMP are off and stay off after a reboot.</p><p>An exposed Docker API or Redis is one of the most common ways cloud servers get taken over: bots scan the whole internet for 2375 and 6379 within minutes of a server appearing. Next: the firewall, so the next mistake isn't automatically exposed.</p>",
    realworld: "sudo ss -tulpn on any server you run: everything listening on 0.0.0.0 or [::] that isn't meant for the world should move to 127.0.0.1. Shodan shows how many Redis and Docker APIs are open on the internet.",
    quiz: [
      { q: "Why is an open Docker API (2375) so bad?", options: ["It leaks logs", "Anyone can start a container that mounts / : root on the host", "It slows Docker", "It uses UDP"], answer: 1, why: "Control of dockerd is control of the machine." },
      { q: "A service only the local app uses should listen on…", options: ["0.0.0.0", "127.0.0.1 (and ::1)", "the public IP", "any free port"], answer: 1, why: "Loopback is unreachable from the network." },
      { q: "What does disable --now do?", options: ["Stops it now only", "Stops it now and stops it starting at boot", "Uninstalls it", "Restarts it"], answer: 1, why: "disable alone only affects boot; --now also stops it." }
    ]
  });

  /* ================================================================== NET-403 ufw */
  function ufwRule(f, port, from) { return f.rules.some(function (x) { return (x.action === "allow" || x.action === "limit") && String(x.port) === String(port) && (from ? x.from === from : x.from === "any") && !x.v6; }); }
  LABS.push({
    id: "net-403", n: 32, module: 4, ticket: "NET-403", xp: 170, layer: "L3–4",
    title: "Deny by default",
    topic: "ufw: default policy, allow rules by source, enabling without locking yourself out, logs, IPv6",
    from: MAYA,
    story: "<p>kc-web-01's services are tidy now, but nothing stops the next mistake from being exposed. Turn on the host firewall: <b>deny everything incoming</b>, then allow only what we need:</p><ul><li>HTTP and HTTPS from anywhere (IPv4 and IPv6)</li><li>SSH only from the office network <code>10.20.5.0/24</code>, and from wherever you're connected from right now (find out first!)</li></ul><p>Then check it from both sides, and show me what the firewall blocked.</p>",
    learn:
      "<h3>ufw</h3><p>Ubuntu's front end to the kernel firewall. Rules are checked in order; the first match wins; anything unmatched gets the default policy.</p>" +
      code("sudo ufw default deny incoming\nsudo ufw default allow outgoing\nsudo ufw allow 80/tcp                                  # adds IPv4 and IPv6 rules\nsudo ufw allow from 10.20.5.0/24 to any port 22 proto tcp\nsudo ufw status numbered\nsudo ufw delete 3") +
      '<div class="callout warn"><b>Before</b> <code>ufw enable</code>, allow SSH from the address you\'re connected from, or the firewall cuts you off. <code>who</code> or <code>echo $SSH_CLIENT</code> shows it.</div>' +
      "<h3>Logs</h3>" + code("sudo ufw logging on\nsudo grep 'UFW BLOCK' /var/log/ufw.log | tail") + "<p>Each blocked packet shows its source (<code>SRC=</code>) and destination port (<code>DPT=</code>).</p>" +
      "<h3>deny vs reject</h3><p><code>deny</code> drops silently (nmap: filtered, and the scanner waits); <code>reject</code> answers with a refusal (closed, fast). Deny for the internet, reject is friendlier inside.</p>" + VANTAGE_HELP,
    system: pre(["nmap"]),
    diagram: ["mon", "scan"],
    starter: "",
    objectives: [
      {
        id: "who", text: "Find the address <b>your</b> SSH session comes from and write it to <code>~/my-ip.txt</code>.",
        hints: ["who shows logged-in sessions and where from.", "who\necho " + SESSION_IP + " > ~/my-ip.txt"],
        check: function (r) { if (!ran(r, /\bwho\b|\$SSH_CLIENT|\$SSH_CONNECTION|\bw\b|\blast\b/)) return "Look it up (who)."; return word(r, "my-ip.txt") === SESSION_IP ? true : "The address in brackets on your session's line."; }
      },
      {
        id: "rules", text: "Default <b>deny incoming</b>; allow 80/tcp and 443/tcp from anywhere; SSH only from <code>10.20.5.0/24</code> and from your address. Then enable ufw <b>without</b> locking yourself out.",
        hints: ["ufw default deny incoming, three or four allow rules, then ufw enable.", "sudo ufw default deny incoming\nsudo ufw allow 80/tcp\nsudo ufw allow 443/tcp\nsudo ufw allow from 10.20.5.0/24 to any port 22 proto tcp\nsudo ufw allow from " + SESSION_IP + " to any port 22 proto tcp\nsudo ufw enable"],
        check: function (r) {
          if (r.sys.lockedOut) return "You locked yourself out (the firewall blocked your SSH session). Reset the machine; allow your address before enabling.";
          var f = M4.fw(r.sys);
          if (!f.enabled) return "Enable ufw.";
          if (f.def.incoming === "allow") return "The default for incoming should be deny.";
          if (!ufwRule(f, 80) || !ufwRule(f, 443)) return "Allow 80/tcp and 443/tcp from anywhere.";
          if (f.rules.some(function (x) { return x.action === "allow" && String(x.port) === "22" && x.from === "any"; })) return "SSH must not be open to everyone.";
          if (!ufwRule(f, 22, "10.20.5.0/24")) return "Allow SSH from the office network 10.20.5.0/24.";
          if (!f.rules.some(function (x) { return x.action === "allow" && String(x.port) === "22" && x.from === SESSION_IP; })) return "Allow SSH from your own address too.";
          return f.rules.some(function (x) { return x.v6 && String(x.port) === "443"; }) ? true : "HTTPS should be allowed over IPv6 too (ufw allow 443/tcp adds both).";
        }
      },
      {
        id: "office", text: "From <b>kc-mon-01</b>, scan kc-web-01: SSH, HTTP and HTTPS open, everything else <b>filtered</b>.",
        hints: ["ssh kc-mon-01 nmap kc-web-01", "ssh kc-mon-01 nmap kc-web-01"],
        check: function (r) { return nmapOut(r, null, function (e) { return outHas(e, /Nmap scan report for kc-web-01/) && openLines(e).join(",") === "22,80,443" && outHas(e, /filtered tcp ports/); }) ? true : "Scan kc-web-01 from kc-mon-01 with the firewall on."; }
      },
      {
        id: "internet", text: "From <b>ext-scan-01.example.net</b>, scan kestrel.example.com: only HTTP and HTTPS may be open.",
        hints: ["ssh ext-scan-01.example.net nmap -Pn kestrel.example.com", "ssh ext-scan-01.example.net nmap -Pn kestrel.example.com"],
        check: function (r) { return nmapOut(r, null, function (e) { return outHas(e, /Nmap scan report for kestrel\.example\.com/) && openLines(e).join(",") === "80,443"; }) ? true : "Scan kestrel.example.com from ext-scan-01.example.net: 22 should not be open."; }
      },
      {
        id: "logs", text: "Show the firewall's log entries for the <b>internet scanner's</b> blocked probes.",
        hints: ["grep UFW BLOCK and the scanner's address in /var/log/ufw.log.", "sudo grep 'SRC=" + EXT + "' /var/log/ufw.log | head"],
        check: function (r) { return ran(r, /ufw\.log|\bdmesg\b|journalctl/, function (e) { return outHas(e, new RegExp("UFW BLOCK.*SRC=" + EXT.replace(/\./g, "\\."))); }) ? true : "grep /var/log/ufw.log for SRC=" + EXT + " after the internet scan."; }
      }
    ],
    solution: lines("who", "echo " + SESSION_IP + " > ~/my-ip.txt", "sudo ufw default deny incoming", "sudo ufw default allow outgoing", "sudo ufw allow 80/tcp", "sudo ufw allow 443/tcp",
      "sudo ufw allow from 10.20.5.0/24 to any port 22 proto tcp", "sudo ufw allow from " + SESSION_IP + " to any port 22 proto tcp", "sudo ufw enable", "sudo ufw status numbered",
      "ssh kc-mon-01 nmap kc-web-01", "ssh ext-scan-01.example.net nmap -Pn kestrel.example.com", "sudo grep 'SRC=" + EXT + "' /var/log/ufw.log | head"),
    debrief: "<p>Deny by default: the office sees SSH, HTTP and HTTPS; the internet sees only HTTP and HTTPS, and every other probe vanishes into silence (filtered), which also makes scanning slower and less useful. The log shows exactly what got blocked and from where.</p><p>The key habit: find your own connection <i>before</i> enabling a firewall over SSH. Next: the same policy written directly in nftables, the engine underneath ufw.</p>",
    realworld: "On your own Ubuntu machine: sudo ufw status verbose. Cloud servers have a second firewall in front (security groups, Module 5); use both.",
    quiz: [
      { q: "What must you do before ufw enable over SSH?", options: ["Reboot", "Allow SSH from the address you're connected from", "Disable IPv6", "Install fail2ban"], answer: 1, why: "Otherwise the firewall drops your own session." },
      { q: "ufw allow 443/tcp creates rules for…", options: ["IPv4 only", "IPv4 and IPv6", "IPv6 only", "UDP too"], answer: 1, why: "Rules without a source address get a (v6) copy." },
      { q: "A probe to a denied port looks like what to the scanner?", options: ["open", "closed", "filtered", "error"], answer: 2, why: "deny drops silently; reject would show closed." }
    ]
  });

  /* ================================================================== NET-404 nftables */
  var SAM_NFT = "#!/usr/sbin/nft -f\n# kc-web-01 firewall (Sam, 2026-10-02). ufw is off; this is it.\nflush ruleset\n\ntable ip filter {\n\tchain input {\n\t\ttype filter hook input priority filter; policy drop;\n\t\tiif \"lo\" accept\n\t\tct state established,related accept\n\t\ttcp dport 22 drop\n\t\tip saddr 10.20.5.0/24 tcp dport 22 accept\n\t\tip saddr " + SESSION_IP + " tcp dport 22 accept\n\t\ttcp dport { 80, 443 } accept\n\t\tip protocol icmp accept\n\t\tcounter log prefix \"nft-drop: \" drop\n\t}\n}\n";
  var GOOD_NFT = "#!/usr/sbin/nft -f\nflush ruleset\n\ntable inet filter {\n\tchain input {\n\t\ttype filter hook input priority filter; policy drop;\n\t\tiif \"lo\" accept\n\t\tct state established,related accept\n\t\tct state invalid drop\n\t\tip saddr 10.20.5.0/24 tcp dport 22 accept\n\t\tip saddr " + SESSION_IP + " tcp dport 22 accept\n\t\ttcp dport { 80, 443 } accept\n\t\tmeta l4proto { icmp, ipv6-icmp } accept\n\t\tcounter log prefix \"nft-drop: \" drop\n\t}\n\tchain forward {\n\t\ttype filter hook forward priority filter; policy drop;\n\t}\n\tchain output {\n\t\ttype filter hook output priority filter; policy accept;\n\t}\n}\n";
  function nftSys(sys) {
    M3.preinstall(sys, "nmap");
    M2.putRoot(sys, "/etc/nftables.conf", SAM_NFT, 493, 0, 0, NOW - 40 * DAY);
    S.mkdirs(sys, "/etc/systemd/system/sysinit.target.wants").children["nftables.service"] = S.linkNode("/usr/lib/systemd/system/nftables.service");
    M2.unitUp(sys, "nftables.service", NOW - 2 * DAY);
  }
  function webV6(sys) { var a = N.own6(sys.nw).filter(function (x) { return x.scope !== "link" && x.dev === "eth0"; })[0]; return a ? a.ip : null; }
  function v(r, src, port, v6) { return N.fwVerdict(r.sys, src, port, "tcp", !!v6, ME); }
  LABS.push({
    id: "net-404", n: 33, module: 4, ticket: "NET-404", xp: 190, layer: "L3–4",
    title: "Rules you can read",
    topic: "nftables: tables, chains, rule order, conntrack, counters, logging, handles, IPv6 with inet",
    from: DEV,
    story: "<p>kc-web-01 runs Sam's hand-written <b>nftables</b> ruleset instead of ufw. Two complaints since: the office can't SSH in, and our internet scanner says SSH is wide open on the server's <b>IPv6</b> address. Sam is on holiday.</p><p>Get the office back in right now, prove the IPv6 hole, then rewrite <code>/etc/nftables.conf</code> so it does what it says on the tin.</p>",
    learn:
      "<h3>Reading a ruleset</h3>" + code("table inet filter {                      # family + name. inet = IPv4 AND IPv6\n\tchain input {                          # a base chain hooks into the kernel\n\t\ttype filter hook input priority filter; policy drop;\n\t\tiif \"lo\" accept                    # rules run top to bottom; first verdict wins\n\t\tct state established,related accept   # replies to connections WE opened\n\t\ttcp dport { 80, 443 } accept\n\t\tcounter log prefix \"nft-drop: \" drop\n\t}\n}") +
      '<table class="t"><tr><th>Family</th><th>Sees</th></tr><tr><td>ip</td><td>IPv4 only</td></tr><tr><td>ip6</td><td>IPv6 only</td></tr><tr><td>inet</td><td>both: use this</td></tr></table>' +
      "<p>Without <code>ct state established,related accept</code>, the <b>replies</b> to your server's own connections (apt, DNS, curl) hit the drop policy.</p>" +
      "<h3>Commands</h3>" + code("sudo nft list ruleset                      # everything\nsudo nft -a list chain inet filter input    # with handles (rule ids)\nsudo nft delete rule inet filter input handle 7\nsudo nft add rule inet filter input tcp dport 9100 ip saddr 10.20.5.10 accept\nsudo nft -c -f /etc/nftables.conf          # check a file without loading it\nsudo systemctl restart nftables            # load /etc/nftables.conf") +
      "<p>Changes with <code>nft add</code> are lost at reboot; the file is what <code>nftables.service</code> loads. The <code>counter</code> on a rule counts the packets that reached it, and <code>log</code> writes them to the kernel log (<code>dmesg</code>).</p>" +
      "<h3>IPv6</h3>" + ex("ip -6 addr show eth0") + "<p>Scan it with <code>nmap -6</code>. A server with a public IPv6 address and an IPv4-only firewall is wide open over IPv6.</p>" + VANTAGE_HELP,
    system: nftSys,
    diagram: ["mon", "scan"],
    starter: "",
    objectives: [
      {
        id: "read", text: "List the ruleset with <b>rule handles</b>.",
        hints: ["nft -a list ruleset, as root.", "sudo nft -a list ruleset"],
        check: function (r) { return ran(r, /\bnft\b.*(-a|--handle).*list|\bnft\b.*list.*(-a|--handle)|\bnft\s+-a\b/, function (e) { return outHas(e, /# handle \d+/); }) ? true : "sudo nft -a list ruleset"; }
      },
      {
        id: "live", text: "Get the office back in <b>now</b>: delete the rule that drops all SSH by its <b>handle</b>, then show from kc-mon-01 that port 22 is open.",
        hints: ["nft -a list chain ip filter input shows the handles; nft delete rule ip filter input handle N. Then ssh kc-mon-01 nmap -p 22 kc-web-01.", "sudo nft -a list chain ip filter input\nsudo nft delete rule ip filter input handle 5\nssh kc-mon-01 nmap -p 22 kc-web-01"],
        check: function (r) {
          if (!ran(r, /\bnft\b.*delete\s+rule\b.*handle\s+\d+/)) return "Delete the stray rule by handle (nft delete rule ... handle N).";
          var k = idx(r, /\bnft\b.*delete\s+rule\b/);
          return after(r, k, /\bnmap\b/, function (e) { return outHas(e, /Nmap scan report for kc-web-01/) && outHas(e, /22\/tcp\s+open/); }) ? true : "Then scan port 22 of kc-web-01 from kc-mon-01.";
        }
      },
      {
        id: "v6hole", text: "Show the IPv6 hole: from ext-scan-01.example.net, scan port 22 on kc-web-01's <b>IPv6</b> address (IPv4 is filtered; IPv6 isn't).",
        hints: ["ip -6 addr show eth0 gives the global address; then ssh ext-scan-01.example.net nmap -6 -Pn -p 22 ADDRESS.", "ip -6 addr show eth0\nssh ext-scan-01.example.net nmap -6 -Pn -p 22 2001:db8:20:0:5054:ff:fe4e:1a07"],
        check: function (r) { return nmapOut(r, /-6|:/, function (e) { return outHas(e, /22\/tcp\s+open/) && outHas(e, /2001:db8:20:/); }) ? true : "Scan the IPv6 address's port 22 from the internet scanner (-6 -Pn -p 22)."; }
      },
      {
        id: "rewrite", text: "Rewrite <code>/etc/nftables.conf</code>: an <code>inet</code> table, <b>conntrack</b> accepted first, SSH from the office and from your address only (fix the order), web from anywhere, ICMP and ICMPv6, logged drops. Check it with <code>nft -c</code>, load it, and keep nftables enabled at boot.",
        hints: ["Change table ip to table inet, remove the early 'tcp dport 22 drop', add ct state established,related accept and ICMPv6. nft -c -f, then restart nftables.", "sudo nano /etc/nftables.conf\nsudo nft -c -f /etc/nftables.conf\nsudo systemctl restart nftables\nsudo nft list ruleset"],
        check: function (r) {
          if (!ran(r, /\bnft\b.*-c\b.*-f|\bnft\b.*--check/)) return "Check the file with nft -c -f before loading it.";
          var st = r.sys.nft || { tables: [] };
          if (st.tables.some(function (t) { return t.family === "ip"; })) return "The loaded ruleset still has an ip (IPv4-only) table.";
          if (!st.tables.some(function (t) { return t.family === "inet"; })) return "Load a table inet filter (restart nftables after editing the file).";
          if (v(r, MON, 22) !== "accept") return "The office (10.20.5.10) still can't reach SSH: rule order?";
          if (v(r, SESSION_IP, 22) !== "accept") return "Keep SSH open from your own address, or you'd be locked out.";
          if (v(r, EXT, 22) === "accept" || v(r, EXT, 22, true) === "accept") return "SSH is still open to the internet (IPv4 or IPv6).";
          if (v(r, EXT, 443) !== "accept" || v(r, EXT, 443, true) !== "accept") return "HTTPS must be open over IPv4 and IPv6.";
          if (N.nftVerdict(r.sys, { src: "91.189.91.83", dst: ME, port: 41000, proto: "tcp", v6: false, ct: "established" }) !== "accept") return "Replies to kc-web-01's own connections are dropped: accept ct state established,related.";
          if (N.nftVerdict(r.sys, { src: EXT, dst: ME, port: null, proto: "icmp", v6: true }) !== "accept") return "Allow ICMPv6 (IPv6 needs it to work at all).";
          var t = r.read("/etc/nftables.conf") || "", ops; try { ops = N.parseNft(t); } catch (e) { return "/etc/nftables.conf has an error: nft -c -f shows it."; }
          if (!ops.some(function (o) { return o.op === "table" && o.table.family === "inet"; })) return "Put the inet table in /etc/nftables.conf, so it survives a reboot.";
          return enabled(r.sys, "nftables.service") ? true : "Keep nftables.service enabled at boot.";
        }
      },
      {
        id: "counter", text: "Watch the drop counter work: list the input chain, scan kc-web-01 from ext-scan-01.example.net, list it again, and see the counter climb. Then find the logged drops in the kernel log.",
        hints: ["nft list chain inet filter input before and after a scan; dmesg | grep nft-drop.", "sudo nft list chain inet filter input\nssh ext-scan-01.example.net nmap -Pn kestrel.example.com\nsudo nft list chain inet filter input\nsudo dmesg | grep nft-drop | tail -3"],
        check: function (r) {
          var vals = r.history.filter(function (e) { return /\bnft\b.*list/.test(e.cmd); }).map(function (e) { var m = /counter packets (\d+) bytes \d+ log prefix "nft-drop/.exec(e.out.join("\n")); return m ? +m[1] : null; }).filter(function (x) { return x !== null; });
          if (vals.length < 2 || !(vals[vals.length - 1] > vals[0])) return "List the chain, scan from the internet, list it again: the drop counter should grow.";
          return ran(r, /\bdmesg\b|journalctl\s+-k/, function (e) { return outHas(e, /nft-drop: .*SRC=/); }) ? true : "Find the logged drops: sudo dmesg | grep nft-drop.";
        }
      }
    ],
    solution: lines.apply(null, ["sudo nft -a list ruleset", "sudo nft delete rule ip filter input handle 5", "ssh kc-mon-01 nmap -p 22 kc-web-01", "ip -6 addr show eth0", "ssh ext-scan-01.example.net nmap -6 -Pn -p 22 2001:db8:20:0:5054:ff:fe4e:1a07", "ssh ext-scan-01.example.net nmap -Pn -p 22 kestrel.example.com", "sudo nano /etc/nftables.conf"].concat(GOOD_NFT.replace(/\n$/, "").split("\n").map(function (l) { return "    " + l; })).concat([
      "sudo nft -c -f /etc/nftables.conf", "sudo systemctl restart nftables", "sudo nft list ruleset",
      "sudo nft list chain inet filter input", "ssh ext-scan-01.example.net nmap -Pn kestrel.example.com", "sudo nft list chain inet filter input", "sudo dmesg | grep nft-drop | tail -3"])),
    debrief: "<p>Three bugs, three lessons. <b>Order</b>: <code>tcp dport 22 drop</code> sat above the office's accept rule, and the first verdict wins. <b>Conntrack</b>: with a drop policy and no <code>ct state established,related accept</code>, the replies to kc-web-01's own connections (apt, DNS over TCP, curl) were dropped. <b>Families</b>: <code>table ip</code> never sees IPv6, so the server's IPv6 address had no firewall at all.</p><p>The <code>inet</code> table fixes both protocols with one ruleset, and the counter and log show the policy working. Next: firewalls on the <i>other</i> servers, to keep tiers apart.</p>",
    realworld: "sudo nft list ruleset on any modern Linux box shows what's really loaded (ufw, firewalld and Docker all write nftables rules underneath).",
    quiz: [
      { q: "Which family covers IPv4 and IPv6?", options: ["ip", "ip6", "inet", "bridge"], answer: 2, why: "inet tables see both." },
      { q: "Why accept ct state established,related?", options: ["Speed", "So replies to connections you opened get back in", "For SSH only", "It's required syntax"], answer: 1, why: "Otherwise a drop policy kills your own outgoing traffic." },
      { q: "Two rules match a packet. Which applies?", options: ["The last", "The first one with a verdict", "The most specific", "Both"], answer: 1, why: "Rules run top to bottom; the first accept/drop ends the chain." }
    ]
  });

  /* ================================================================== NET-405 Segmentation */
  function dbSetup(opts) {
    opts = opts || {};
    return function (sys) {
      M3.preinstall(sys, "nmap");
      var pub = N.devKey(sys);
      sys.remoteSetup = sys.remoteSetup || {};
      sys.remoteSetup["kc-db-01"] = function (m) {
        N.authorize(m, "dev", pub);
        N.riskyServices(m, ["postgres"], NOW - 60 * DAY);
        if (opts.fw) { var f = M4.fw(m); f.enabled = true; opts.fw.forEach(function (x) { f.rules.push({ action: "allow", dir: "in", port: x[0], proto: "tcp", from: x[1], to: "any", v6: false }); }); }
        m.knownPasswords = { dev: true };
      };
      sys.remoteSetup["kc-bastion-01"] = function (m) { if (opts.bastionKey) N.authorize(m, "dev", pub); };
      if (opts.after) opts.after(sys);
    };
  }
  var DB_POLICY = "Database tier policy (kc-db-01, 10.20.0.21)\n\nWHO                          PORT        WHY\nkc-web-01   10.20.0.15       5432/tcp    the app\nkc-web-01   10.20.0.15       22/tcp      admin (for now: NET-406 moves this to the bastion)\nkc-backup-01 10.20.0.31      22/tcp      nightly pg_dump over SSH\neveryone else                nothing     including the office and kc-data-01\n";
  function dbMach(r) { return mach(r, DB); }
  LABS.push({
    id: "net-405", n: 34, module: 4, ticket: "NET-405", xp: 180, layer: "L3",
    title: "Tiers",
    topic: "segmentation: which tier may talk to which, enforced by the database's own firewall",
    from: DEV,
    story: "<p>In Module 3, kc-data-01 was compromised and immediately scanned <b>kc-db-01</b>, where it found PostgreSQL and SSH wide open. Right now <i>anything</i> on our network can talk to the database.</p><p>That's what <b>segmentation</b> fixes: web tier, app tier, database tier, and only the connections the policy (<code>~/db-policy.txt</code>) lists. Log in to kc-db-01, enforce the policy with its own firewall, and prove both sides of it.</p>",
    learn:
      "<h3>Segmentation</h3><p>Split the network into zones by role and allow only the flows you need between them. A compromised web server then can't reach the backups; a compromised laptop can't reach the database. It's done with VLANs and routers between subnets (Module 1), cloud security groups (Module 5), and <b>host firewalls on each server</b>, which work even when everything shares one LAN, like here.</p>" +
      code("ssh kc-db-01                                                    # you have a key there\nsudo ufw default deny incoming\nsudo ufw allow from 10.20.0.15 to any port 5432 proto tcp\nsudo ufw allow from 10.20.0.15 to any port 22 proto tcp\n...\nsudo ufw enable\nexit") +
      "<h3>Prove both directions</h3><p>A rule set is only proven when the allowed flow works <b>and</b> the forbidden one fails:</p>" + code("nc -zv -w 2 kc-db-01 5432                          # from kc-web-01: succeeded\nssh kc-mon-01 nc -zv -w 2 kc-db-01 5432            # from the office: timed out") +
      "<h3>Defence in depth</h3><p>Also make PostgreSQL itself listen only where it must: <code>listen_addresses</code> in <code>postgresql.conf</code>. If the firewall is ever switched off by mistake, the database still isn't on every interface.</p>",
    files: { "db-policy.txt": DB_POLICY },
    system: dbSetup(),
    diagram: ["db", "backup", "mon"],
    starter: "",
    objectives: [
      {
        id: "before", text: "Show the problem: from the <b>office</b> (kc-mon-01), PostgreSQL on kc-db-01 is reachable.",
        hints: ["ssh kc-mon-01 nc -zv -w 2 kc-db-01 5432", "ssh kc-mon-01 nc -zv -w 2 kc-db-01 5432"],
        check: function (r) { return ran(r, /\bnc\b.*kc-db-01.*5432|\bnc\b.*10\.20\.0\.21.*5432|\bnmap\b.*kc-db-01/, function (e) { return /kc-mon-01/.test(e.cmd) && outHas(e, /succeeded|5432\/tcp\s+open/); }) ? true : "From kc-mon-01, connect to kc-db-01 port 5432."; }
      },
      {
        id: "listen", text: "On kc-db-01, show what listens and on which addresses.",
        hints: ["ssh kc-db-01, then sudo ss -tlnp.", "ssh kc-db-01 sudo ss -tlnp"],
        check: function (r) { return ran(r, /\bss\b/, function (e) { return outHas(e, /0\.0\.0\.0:5432.*postgres/); }) ? true : "Run sudo ss -tlnp on kc-db-01."; }
      },
      {
        id: "fw", text: "Enforce the policy with ufw <b>on kc-db-01</b>: deny incoming by default, then allow exactly the flows in <code>~/db-policy.txt</code>.",
        hints: ["Log in to kc-db-01 and add three allow rules (5432 from .15, 22 from .15 and .31) before ufw enable.", "ssh kc-db-01\nsudo ufw default deny incoming\nsudo ufw allow from 10.20.0.15 to any port 5432 proto tcp\nsudo ufw allow from 10.20.0.15 to any port 22 proto tcp\nsudo ufw allow from 10.20.0.31 to any port 22 proto tcp\nsudo ufw enable\nexit"],
        check: function (r) {
          var m = dbMach(r), f = M4.fw(m);
          if (!f.enabled) return "ufw isn't enabled on kc-db-01.";
          var want = [["10.20.0.15", 5432, "accept"], ["10.20.0.15", 22, "accept"], ["10.20.0.31", 22, "accept"], ["10.20.0.31", 5432, "drop"], ["10.20.0.45", 5432, "drop"], ["10.20.0.45", 22, "drop"], [MON, 5432, "drop"], [MON, 22, "drop"], ["10.20.0.40", 5432, "drop"]];
          for (var i = 0; i < want.length; i++) { var got = N.fwVerdict(m, want[i][0], want[i][1], "tcp", false, DB); if ((got === "accept") !== (want[i][2] === "accept")) return want[i][0] + " → port " + want[i][1] + " is " + (got === "accept" ? "allowed" : "blocked") + ", but the policy says " + (want[i][2] === "accept" ? "allow" : "deny") + "."; }
          return true;
        }
      },
      {
        id: "prove", text: "Prove both directions from the outside: <code>nc</code> to port 5432 <b>succeeds</b> from kc-web-01 and <b>times out</b> from kc-mon-01.",
        hints: ["Run them after enabling the firewall.", "nc -zv -w 2 kc-db-01 5432\nssh kc-mon-01 nc -zv -w 2 kc-db-01 5432"],
        check: function (r) {
          var k = idx(r, /\bufw\b.*enable/);
          if (!after(r, k, /\bnc\b.*5432/, function (e) { return !/kc-mon-01/.test(e.cmd) && outHas(e, /succeeded/); })) return "After enabling the firewall: nc -zv -w 2 kc-db-01 5432 from kc-web-01.";
          return after(r, k, /\bnc\b.*5432/, function (e) { return /kc-mon-01/.test(e.cmd) && outHas(e, /timed out/); }) ? true : "And from the office: ssh kc-mon-01 nc -zv -w 2 kc-db-01 5432 should time out.";
        }
      },
      {
        id: "pg", text: "Defence in depth: make PostgreSQL listen only on <b>localhost and 10.20.0.21</b> (<code>listen_addresses</code>), restart it, and check.",
        hints: ["/etc/postgresql/16/main/postgresql.conf on kc-db-01: listen_addresses = 'localhost,10.20.0.21'. Restart postgresql@16-main.", "ssh kc-db-01\nsudo sed -i \"s/^listen_addresses = .*/listen_addresses = 'localhost,10.20.0.21'/\" /etc/postgresql/16/main/postgresql.conf\nsudo systemctl restart postgresql@16-main\nsudo ss -tlnp | grep 5432\nexit"],
        check: function (r) { var a = listenAddrs(dbMach(r), 5432); a.sort(); return a.join(",") === "10.20.0.21,127.0.0.1" ? true : a.some(function (x) { return x === "0.0.0.0" || x === "[::]"; }) ? "PostgreSQL still listens on every address (restart it after the change)." : "listen_addresses should be 'localhost,10.20.0.21'."; }
      }
    ],
    solution: lines("cat ~/db-policy.txt", "ssh kc-mon-01 nc -zv -w 2 kc-db-01 5432", "ssh kc-db-01", "sudo ss -tlnp", "sudo ufw default deny incoming", "sudo ufw allow from 10.20.0.15 to any port 5432 proto tcp", "sudo ufw allow from 10.20.0.15 to any port 22 proto tcp", "sudo ufw allow from 10.20.0.31 to any port 22 proto tcp", "sudo ufw enable",
      "sudo sed -i \"s/^listen_addresses = .*/listen_addresses = 'localhost,10.20.0.21'/\" /etc/postgresql/16/main/postgresql.conf", "sudo systemctl restart postgresql@16-main", "sudo ss -tlnp", "exit",
      "nc -zv -w 2 kc-db-01 5432", "ssh kc-mon-01 nc -zv -w 2 kc-db-01 5432"),
    debrief: "<p>kc-db-01 now accepts exactly three flows. If kc-data-01 (or anything else) gets compromised again, its scan of the database finds nothing but silence. PostgreSQL also stopped listening on every interface, so a firewall accident alone won't expose it.</p><p>One flow on the list is a stopgap: admins SSH to the database straight from the web server. Next ticket replaces that with one hardened door: a bastion.</p>",
    realworld: "In the cloud the same policy is a security group on the database that allows 5432 only from the web servers' security group (Module 5). At home: your router's guest Wi-Fi is segmentation.",
    quiz: [
      { q: "What does segmentation limit?", options: ["Bandwidth", "How far an attacker can move after one machine is compromised", "DNS", "Disk use"], answer: 1, why: "Lateral movement needs flows the policy doesn't allow." },
      { q: "How do you prove a firewall policy?", options: ["ufw status only", "Test an allowed flow works and a forbidden one fails", "Reboot", "Ping"], answer: 1, why: "Both directions, from the real sources." },
      { q: "Why also set listen_addresses?", options: ["Speed", "Defence in depth: still safe if the firewall is off", "PostgreSQL requires it", "For IPv6"], answer: 1, why: "Two independent controls are better than one." }
    ]
  });

  /* ================================================================== NET-406 Bastion hosts */
  var SSH_CONFIG = "Host bastion\n    HostName kc-bastion-01\n    User dev\n\nHost db\n    HostName kc-db-01\n    User dev\n    ProxyJump bastion\n";
  function bastionSys(sys) {
    dbSetup({ fw: [["22", BASTION], ["5432", ME]], bastionKey: true })(sys);
    var prev = sys.remoteSetup["kc-bastion-01"];
    sys.remoteSetup["kc-bastion-01"] = function (m) { prev(m); M2.putRoot(m, "/etc/ssh/sshd_config.d/50-cloud-init.conf", "PasswordAuthentication yes\n", 384); M2.writeRoot(m, "/etc/ssh/sshd_config", "PermitRootLogin yes\n", true); };
    sys.nw.extraPeers.srv = Object.assign({}, sys.nw.extraPeers.srv); sys.nw.extraPeers.srv[BASTION] = { name: "kc-bastion-01", node: "bastion", mac: "52:54:00:b5:71:05", rtt: 0.3 };
  }
  function bastionConf(r) { var m = mach(r, BASTION); return m.sshdLive || M2.sshdConf(m); }
  LABS.push({
    id: "net-406", n: 35, module: 4, ticket: "NET-406", xp: 180, layer: "L7",
    title: "One door in",
    topic: "bastion hosts: ssh -J, ProxyJump in ~/.ssh/config, key-only SSH, PermitRootLogin, AllowUsers",
    from: MAYA,
    story: "<p>kc-db-01's firewall now only takes SSH from <b>kc-bastion-01</b> (10.20.0.5): one hardened, well-logged door for every admin connection to the inner servers. The network team built it; I need you to get through it comfortably and harden it properly.</p><p>Right now it still allows passwords and root logins. Your key is already on both the bastion and the database.</p>",
    learn:
      "<h3>A bastion (jump host)</h3><p>Inner servers accept SSH only from the bastion, and the bastion is the one place that is hardened, patched and audited. With <b>ProxyJump</b> your SSH client connects to the bastion and asks it to forward a connection to the target; your <b>keys stay on your machine</b> (no copying private keys onto the bastion, no agent forwarding needed).</p>" +
      code("ssh -J kc-bastion-01 kc-db-01           # once\n\n# ~/.ssh/config, so 'ssh db' just works\nHost bastion\n    HostName kc-bastion-01\n    User dev\nHost db\n    HostName kc-db-01\n    User dev\n    ProxyJump bastion") +
      "<h3>Hardening the bastion's sshd</h3>" + code("PasswordAuthentication no      # keys only\nPermitRootLogin no\nAllowUsers dev                  # only named accounts") +
      "<p>Remember the drop-in trap from the Linux track: files in <code>/etc/ssh/sshd_config.d/</code> are read first and the <b>first</b> value wins. <code>sudo sshd -T</code> prints the effective settings. Test with <code>sudo sshd -t</code>, then <code>sudo systemctl reload ssh</code>; keep your current session open until you've logged in again successfully.</p>",
    system: bastionSys,
    diagram: ["bastion", "db"],
    starter: "",
    objectives: [
      {
        id: "direct", text: "Show that a direct <code>ssh kc-db-01</code> no longer works from kc-web-01.",
        hints: ["Just try it: it times out at the database's firewall.", "ssh kc-db-01 hostname"],
        check: function (r) { return ran(r, /\bssh\b(?!.*-J).*kc-db-01/, function (e) { return outHas(e, /Connection timed out/); }) ? true : "Try ssh kc-db-01 directly."; }
      },
      {
        id: "jump", text: "Run <code>hostname</code> on kc-db-01 <b>through</b> the bastion with <code>ssh -J</code>.",
        hints: ["ssh -J JUMPHOST TARGET COMMAND", "ssh -J kc-bastion-01 kc-db-01 hostname"],
        check: function (r) { return ran(r, /\bssh\b.*-J\s*\S+.*kc-db-01/, function (e) { return outHas(e, /^kc-db-01$/); }) ? true : "ssh -J kc-bastion-01 kc-db-01 hostname"; }
      },
      {
        id: "config", text: "Write <code>~/.ssh/config</code> so that <code>ssh db</code> reaches kc-db-01 through the bastion (aliases <code>bastion</code> and <code>db</code>), then run <code>ssh db uptime</code>.",
        hints: ["Host bastion with HostName kc-bastion-01; Host db with HostName kc-db-01 and ProxyJump bastion.", "nano ~/.ssh/config\n" + SSH_CONFIG + "ssh db uptime"],
        check: function (r) {
          var c = N.sshCfg(r.shell || r.sess, "db");
          if (!c.proxyjump) return "~/.ssh/config needs a Host db block with ProxyJump.";
          return ran(r, /^\s*ssh\s+db\b/, function (e) { return outHas(e, /load average/); }) && (r.sys.sshJumps || []).some(function (j) { return j.via === "kc-bastion-01" && j.to === DB; }) ? true : "Run ssh db uptime (it should go through the bastion).";
        }
      },
      {
        id: "harden", text: "Harden the <b>bastion</b>: keys only, no root logins, only <code>dev</code> may log in. Test the config and reload ssh.",
        hints: ["ssh bastion, edit /etc/ssh/sshd_config and the drop-in in sshd_config.d/, sshd -t, reload ssh. sshd -T shows the result.", "ssh bastion\nsudo nano /etc/ssh/sshd_config.d/50-cloud-init.conf  (PasswordAuthentication no)\necho -e 'PermitRootLogin no\\nAllowUsers dev' | sudo tee /etc/ssh/sshd_config.d/10-bastion.conf\nsudo sshd -t && sudo systemctl reload ssh\nsudo sshd -T | grep -Ei 'passwordauth|permitroot|allowusers'\nexit"],
        check: function (r) {
          var c = bastionConf(r);
          if (c.passwordauthentication !== "no") return "Passwords are still accepted on the bastion (sshd -T shows the effective value; check sshd_config.d/).";
          if (c.permitrootlogin !== "no") return "Root can still log in to the bastion.";
          if (!c.allowusers || c.allowusers.join(" ") !== "dev") return "Only dev should be allowed (AllowUsers dev).";
          return ran(r, /\bsshd\b.*-t\b/) ? true : "Test the config with sudo sshd -t before reloading.";
        }
      },
      {
        id: "prove", text: "Prove passwords are refused now: try the bastion with <b>public keys turned off</b>, and see it refuse. Your <code>ssh db</code> must still work.",
        hints: ["ssh -o PubkeyAuthentication=no bastion: Permission denied (publickey).", "ssh -o PubkeyAuthentication=no bastion true\nssh db hostname"],
        check: function (r) {
          var k = idx(r, /systemctl\s+(reload|restart)\s+(ssh|sshd)/);
          if (!after(r, k, /\bssh\b.*PubkeyAuthentication=no/, function (e) { return outHas(e, /Permission denied \(publickey\)/); })) return "After the reload: ssh -o PubkeyAuthentication=no bastion should be refused with (publickey).";
          return after(r, k, /^\s*ssh\s+db\b/, function (e) { return outHas(e, /kc-db-01|load average/); }) ? true : "And ssh db must still work with your key.";
        }
      }
    ],
    solution: lines.apply(null, ["ssh kc-db-01 hostname", "ssh -J kc-bastion-01 kc-db-01 hostname", "nano ~/.ssh/config"].concat(SSH_CONFIG.replace(/\n$/, "").split("\n").map(function (l) { return "    " + l; })).concat([
      "chmod 600 ~/.ssh/config", "ssh db uptime", "ssh bastion", "sudo sshd -T | grep -Ei 'passwordauth|permitroot|allowusers'", "echo 'PasswordAuthentication no' | sudo tee /etc/ssh/sshd_config.d/50-cloud-init.conf", "printf 'PermitRootLogin no\\nAllowUsers dev\\n' | sudo tee /etc/ssh/sshd_config.d/10-bastion.conf",
      "sudo sshd -t", "sudo systemctl reload ssh", "sudo sshd -T | grep -Ei 'passwordauth|permitroot|allowusers'", "exit", "ssh -o PubkeyAuthentication=no bastion true", "ssh db hostname"])),
    debrief: "<p>One door, properly locked. kc-db-01 only takes SSH from the bastion; the bastion only takes <b>dev</b>, with a <b>key</b>, never root. And with ProxyJump in <code>~/.ssh/config</code>, <code>ssh db</code> is as easy as before, with your private key never leaving kc-web-01.</p><p>Bastions are also where you put session logging and MFA. Many cloud teams now replace them with identity-aware proxies (AWS SSM Session Manager, Teleport), same idea, no open port 22 at all.</p>",
    realworld: "ProxyJump works for any chain of hosts: ssh -J a,b target. Add it to your own ~/.ssh/config for servers behind a jump host.",
    quiz: [
      { q: "With ProxyJump, where is your private key used?", options: ["Copied to the bastion", "Only on your own machine", "On the target", "Nowhere"], answer: 1, why: "The bastion only forwards the TCP connection; authentication to both happens from your client." },
      { q: "Settings in sshd_config.d/ and sshd_config disagree. Which wins?", options: ["sshd_config", "The first one read (the drop-in)", "The last one", "Neither"], answer: 1, why: "For sshd the first value wins, and the Include is at the top." },
      { q: "Why a bastion?", options: ["Faster SSH", "One hardened, audited entry point instead of SSH open on every server", "It stores keys", "It replaces the firewall"], answer: 1, why: "Fewer doors, better watched." }
    ]
  });

  /* ================================================================== NET-407 WireGuard */
  var WG_PRIV = N.wgKey("kc-web-01-wg"), LIS_PUB = N.wgPub(N.wgKey("lis-gw")), MY_PUB = N.wgPub(WG_PRIV);
  var HANDOUT = "Lisbon office VPN (network team)\n\nLisbon gateway:   lis-gw-01\n  Endpoint:       203.0.113.90:51820\n  Public key:     " + LIS_PUB + "\n\nkc-web-01's side:\n  Private key:    /etc/wireguard/kc-web-01.key (we generated it; the public key is registered on lis-gw-01)\n  Tunnel address: 10.99.0.15/24\n\nRoute through the tunnel ONLY:\n  10.99.0.0/24    tunnel network (lis-gw-01 is 10.99.0.1)\n  10.30.0.0/24    Lisbon office (file server lis-files-01 = 10.30.0.10)\n\nKeep the handshake alive through their NAT: PersistentKeepalive = 25\n";
  var WG0 = "[Interface]\nPrivateKey = " + WG_PRIV + "\nAddress = 10.99.0.15/24\n\n[Peer]\nPublicKey = " + LIS_PUB + "\nEndpoint = 203.0.113.90:51820\nAllowedIPs = 10.99.0.0/24, 10.30.0.0/24\nPersistentKeepalive = 25\n";
  function wgSys(sys) {
    M3.preinstall(sys, "wireguard-tools");
    M2.putRoot(sys, "/etc/wireguard/kc-web-01.key", WG_PRIV + "\n", 384, 0, 0, NOW - 3 * DAY);
    sys.wgSite = { pub: LIS_PUB, endpoint: "203.0.113.90", port: 51820, accepts: [MY_PUB], tunnelNet: "10.99.0.0", tunnelPrefix: 24, gw: "10.99.0.1", hosts: { "10.30.0.10": { rtt: 1.1 } } };
    M2.net.HOSTS["10.30.0.10"] = M2.net.HOSTS["10.30.0.10"] || { ping: 41, ports: [22, 445] };
    W.NAMES["10.30.0.10"] = W.NAMES["10.30.0.10"] || "lis-files-01";
  }
  function wgUp(r) { return (r.sys.wgLive || {}).wg0; }
  LABS.push({
    id: "net-407", n: 36, module: 4, ticket: "NET-407", xp: 180, layer: "L3",
    title: "A tunnel to Lisbon",
    topic: "WireGuard: key pairs, wg0.conf, AllowedIPs as routing and access control, wg-quick, wg show",
    from: MAYA,
    story: "<p>We opened an office in Lisbon, and kc-web-01 needs to reach their file server (<b>lis-files-01</b>, 10.30.0.10) for nightly uploads. The network team set up a <b>WireGuard</b> gateway there and left you <code>~/lisbon-vpn.txt</code>.</p><p>Bring the tunnel up, route only Lisbon's networks through it (not all our traffic!), and prove it works.</p>",
    learn:
      "<h3>WireGuard in one picture</h3><p>Each side has a key pair. You give the other side your <b>public</b> key; they give you theirs. A packet into the tunnel is encrypted to the peer's key and sent over UDP to its <b>Endpoint</b>. There's no login and no certificate authority: knowing the right public keys <i>is</i> the authentication.</p>" +
      code("wg genkey | sudo tee /etc/wireguard/private.key     # a new private key\nsudo cat /etc/wireguard/private.key | wg pubkey      # its public key") +
      "<h3>/etc/wireguard/wg0.conf</h3>" + code("[Interface]\nPrivateKey = <your private key>\nAddress = 10.99.0.15/24            # your address inside the tunnel\n\n[Peer]\nPublicKey = <the peer's public key>\nEndpoint = 203.0.113.90:51820\nAllowedIPs = 10.99.0.0/24, 10.30.0.0/24\nPersistentKeepalive = 25") +
      "<p><b>AllowedIPs</b> does two jobs: on the way out it's a routing table (these destinations go into the tunnel); on the way in it's an access list (packets from the peer are only accepted from these source addresses). <code>0.0.0.0/0</code> would send <b>all</b> your traffic through Lisbon.</p>" +
      code("sudo chmod 600 /etc/wireguard/wg0.conf       # it holds a private key\nsudo wg-quick up wg0\nsudo wg show                                   # latest handshake = it's working\nip route | grep wg0\nsudo wg-quick down wg0"),
    files: { "lisbon-vpn.txt": HANDOUT },
    system: wgSys,
    diagram: ["lis"],
    starter: "",
    objectives: [
      {
        id: "pub", text: "Derive the <b>public key</b> of <code>/etc/wireguard/kc-web-01.key</code> and write it to <code>~/wg-public.txt</code>.",
        hints: ["wg pubkey reads a private key on stdin.", "sudo cat /etc/wireguard/kc-web-01.key | wg pubkey > ~/wg-public.txt"],
        check: function (r) { return (r.read("wg-public.txt") || "").trim() === MY_PUB ? true : "Pipe the private key into wg pubkey."; }
      },
      {
        id: "conf", text: "Write <code>/etc/wireguard/wg0.conf</code> from the handout (readable by root only).",
        hints: ["[Interface] with PrivateKey and Address; [Peer] with PublicKey, Endpoint, AllowedIPs, PersistentKeepalive. chmod 600.", "sudo nano /etc/wireguard/wg0.conf\nsudo chmod 600 /etc/wireguard/wg0.conf"],
        check: function (r) {
          var c = N.wgConf(r.sys, "wg0"); if (!c) return "Create /etc/wireguard/wg0.conf.";
          if (c.iface.privatekey !== WG_PRIV) return "PrivateKey should be the contents of kc-web-01.key.";
          if (!/^10\.99\.0\.15\/24$/.test((c.iface.address || "").trim())) return "Address = 10.99.0.15/24.";
          var p = c.peers[0]; if (!p) return "Add a [Peer] section.";
          if (p.publickey !== LIS_PUB) return "The peer's PublicKey is lis-gw-01's (from the handout), not ours.";
          if (p.endpoint !== "203.0.113.90:51820") return "Endpoint = 203.0.113.90:51820.";
          var al = (p.allowedips || "").split(",").map(function (x) { return x.trim(); }).sort();
          if (al.indexOf("0.0.0.0/0") >= 0) return "AllowedIPs 0.0.0.0/0 would send ALL traffic to Lisbon: list only their networks.";
          if (al.join(",") !== "10.30.0.0/24,10.99.0.0/24") return "AllowedIPs: exactly the two networks from the handout.";
          return (r.node("/etc/wireguard/wg0.conf").mode & 63) === 0 ? true : "The file holds a private key: chmod 600.";
        }
      },
      {
        id: "up", text: "Bring the tunnel up and <b>ping lis-files-01</b> (10.30.0.10). Then show the handshake with <code>wg show</code>.",
        hints: ["wg-quick up wg0, ping -c 3 10.30.0.10, wg show.", "sudo wg-quick up wg0\nping -c 3 10.30.0.10\nsudo wg show"],
        check: function (r) {
          if (!wgUp(r)) return "Bring wg0 up with wg-quick.";
          if (!ran(r, /\bping\b.*10\.30\.0\.10/, function (e) { return outHas(e, / 0% packet loss/); })) return "Ping 10.30.0.10 through the tunnel.";
          return ran(r, /\bwg\b(\s+show)?/, function (e) { return outHas(e, /latest handshake/); }) ? true : "sudo wg show: there should be a latest handshake.";
        }
      },
      {
        id: "route", text: "Show that only Lisbon goes through the tunnel: the route to <code>10.30.0.10</code> uses wg0, the route to <code>1.1.1.1</code> still uses eth0.",
        hints: ["ip route get ADDRESS shows which interface a destination uses.", "ip route get 10.30.0.10\nip route get 1.1.1.1"],
        check: function (r) {
          if (!ran(r, /\bip\s+(-\w+\s+)*r(oute)?\s+get\b.*10\.30\.0\.10/, function (e) { return outHas(e, /dev wg0/); })) return "ip route get 10.30.0.10 should say dev wg0.";
          return ran(r, /\bip\s+(-\w+\s+)*r(oute)?\s+get\b.*1\.1\.1\.1/, function (e) { return outHas(e, /dev eth0/); }) ? true : "ip route get 1.1.1.1 should still say dev eth0.";
        }
      },
      {
        id: "smb", text: "The nightly upload uses the file server's <b>port 445</b>. Check it's reachable through the tunnel.",
        hints: ["nc -zv -w 2 10.30.0.10 445", "nc -zv -w 2 10.30.0.10 445"],
        check: function (r) { return ran(r, /\bnc\b.*10\.30\.0\.10.*445/, function (e) { return outHas(e, /succeeded/); }) ? true : "nc -zv -w 2 10.30.0.10 445"; }
      }
    ],
    solution: lines.apply(null, ["cat ~/lisbon-vpn.txt", "sudo cat /etc/wireguard/kc-web-01.key | wg pubkey > ~/wg-public.txt", "sudo nano /etc/wireguard/wg0.conf"].concat(WG0.replace(/\n$/, "").split("\n").map(function (l) { return "    " + l; })).concat([
      "sudo chmod 600 /etc/wireguard/wg0.conf", "sudo wg-quick up wg0", "ping -c 3 10.30.0.10", "sudo wg show", "ip route get 10.30.0.10", "ip route get 1.1.1.1", "nc -zv -w 2 10.30.0.10 445"])),
    debrief: "<p>The tunnel is up: a handshake with lis-gw-01, routes for exactly the two Lisbon networks, and SMB to the file server through it. Everything else, including the internet, still leaves through eth0.</p><p>The whole security model fit in the config: our private key, their public key, and AllowedIPs deciding both what we send into the tunnel and what we accept out of it. WireGuard has no \"login\" to brute-force and doesn't even answer packets without a valid key, which is why it shows as closed/filtered to scanners.</p>",
    realworld: "WireGuard is in every Linux kernel and has clients for every OS; Tailscale and many commercial VPNs are built on it. A home server reachable only over WireGuard is a great first project.",
    quiz: [
      { q: "What do you give the other side?", options: ["Your private key", "Your public key", "A password", "A certificate"], answer: 1, why: "Never share the private key." },
      { q: "AllowedIPs = 0.0.0.0/0 means…", options: ["Allow everyone to connect", "Route all your IPv4 traffic through this peer", "No routes", "Allow ping"], answer: 1, why: "AllowedIPs is the routing table for the tunnel." },
      { q: "wg show has no 'latest handshake'. Most likely?", options: ["All fine", "Keys or endpoint don't match, or UDP is blocked", "Too much traffic", "DNS is broken"], answer: 1, why: "No handshake = the two sides never agreed." }
    ]
  });

  /* ================================================================== NET-408 HTTPS done right */
  function httpsSys(sys) {
    var k = N.NGX.kestrel;
    k = k.replace("\tlocation / {\n\t\treturn 301 https://$host$request_uri;\n\t}", "\tlocation / {\n\t\troot /var/www/kestrel;\n\t}");
    k = k.replace("\tadd_header Strict-Transport-Security \"max-age=31536000\" always;\n", "");
    k = k.replace("\tssl_certificate /etc/letsencrypt/live/kestrel.example.com/fullchain.pem;", "\tssl_protocols TLSv1 TLSv1.1 TLSv1.2 TLSv1.3;\n\tssl_certificate /etc/letsencrypt/live/kestrel.example.com/fullchain.pem;");
    M2.putRoot(sys, "/etc/nginx/sites-available/kestrel", k, 420, 0, 0, NOW - 200 * DAY);
    M3.preinstall(sys, "nmap");
    M2.reloadUnit ? M2.reloadUnit(sys, M2.loadUnit(sys, "nginx.service"), null) : null;
  }
  function kTls(r, ver) { return N.tlsConnect(r.sys, W.PUB, 443, "kestrel.example.com", { only: ver, seclevel0: true }); }
  LABS.push({
    id: "net-408", n: 37, module: 4, ticket: "NET-408", xp: 170, layer: "L5–7",
    title: "HTTPS done right",
    topic: "redirect HTTP to HTTPS, HSTS, TLS 1.2 and 1.3 only, testing with nmap ssl-enum-ciphers, openssl and curl",
    from: DEV,
    story: "<p>A customer's security team ran a scanner against <b>kestrel.example.com</b> and sent three findings: <i>\"TLS 1.0 and 1.1 enabled\"</i>, <i>\"HTTP served without redirect\"</i>, <i>\"no HSTS\"</i>. They're right: someone \"simplified\" the nginx site last spring.</p><p>Confirm each finding yourself, fix the site, and show me the evidence that it's fixed.</p>",
    learn:
      "<h3>Three settings that matter</h3>" + '<table class="t"><tr><th>Setting</th><th>Why</th></tr><tr><td><code>return 301 https://$host$request_uri;</code> on port 80</td><td>nobody should use the site over plain HTTP</td></tr><tr><td><code>add_header Strict-Transport-Security "max-age=31536000" always;</code></td><td><b>HSTS</b>: the browser remembers to use HTTPS, so even a typed http:// never goes out in clear (stops SSL-stripping attacks)</td></tr><tr><td><code>ssl_protocols TLSv1.2 TLSv1.3;</code></td><td>TLS 1.0 and 1.1 are deprecated (weak ciphers, known attacks)</td></tr></table>' +
      "<h3>Testing</h3>" + ex("nmap --script ssl-enum-ciphers -p 443 kestrel.example.com") +
      code("# Ubuntu's OpenSSL refuses old versions itself; lower its security level to test the SERVER:\necho | openssl s_client -connect kestrel.example.com:443 -tls1_1 -cipher 'DEFAULT@SECLEVEL=0' -brief\necho | openssl s_client -connect kestrel.example.com:443 -tls1_2 -brief\ncurl -sI http://kestrel.example.com/             # want: 301 and a Location: https://...\ncurl -sI https://kestrel.example.com/ | grep -i strict") +
      "<p>nginx's own default (<code>/etc/nginx/nginx.conf</code>) is already <code>TLSv1.2 TLSv1.3</code>; a <code>ssl_protocols</code> line in a server block overrides it. After editing: <code>sudo nginx -t &amp;&amp; sudo systemctl reload nginx</code>.</p>",
    system: httpsSys,
    diagram: ["site"],
    starter: "",
    objectives: [
      {
        id: "scan", text: "Confirm finding 1 with nmap's <b>ssl-enum-ciphers</b> script on port 443.",
        hints: ["nmap --script ssl-enum-ciphers -p 443 kestrel.example.com", "nmap --script ssl-enum-ciphers -p 443 kestrel.example.com"],
        check: function (r) { return nmapOut(r, /ssl-enum-ciphers/, function (e) { return outHas(e, /TLSv1\.0:/); }) ? true : "Run the ssl-enum-ciphers script against port 443 while TLS 1.0 is still on."; }
      },
      {
        id: "s11", text: "Show a <b>TLS 1.1</b> handshake succeeding with openssl (you'll need to lower OpenSSL's own security level).",
        hints: ["-tls1_1 plus -cipher 'DEFAULT@SECLEVEL=0'.", "echo | openssl s_client -connect kestrel.example.com:443 -tls1_1 -cipher 'DEFAULT@SECLEVEL=0' -brief"],
        check: function (r) { return ran(r, /s_client\b.*-tls1_1/, function (e) { return outHas(e, /Protocol version: TLSv1\.1/); }) ? true : "openssl s_client with -tls1_1 and -cipher 'DEFAULT@SECLEVEL=0'."; }
      },
      {
        id: "fix", text: "Fix the kestrel site: HTTP <b>redirects</b> to HTTPS, HTTPS sends <b>HSTS</b> (at least 6 months), only <b>TLS 1.2 and 1.3</b>. Test and reload nginx.",
        hints: ["/etc/nginx/sites-available/kestrel: the port 80 server's location / should return 301; add the HSTS header to the 443 server; remove the ssl_protocols line (or set TLSv1.2 TLSv1.3).", "sudo nano /etc/nginx/sites-available/kestrel\nsudo nginx -t\nsudo systemctl reload nginx"],
        check: function (r) {
          if (!kTls(r, "TLSv1.2").ok || !kTls(r, "TLSv1.3").ok) return "TLS 1.2 and 1.3 must still work (did nginx reload?).";
          if (kTls(r, "TLSv1.1").ok || kTls(r, "TLSv1").ok) return "The running nginx still accepts TLS 1.0 or 1.1 (fix ssl_protocols, then reload).";
          var h = N.httpTo(r.sys, ME, 80, { scheme: "http", host: "kestrel.example.com", port: 80, path: "/pricing", method: "GET", headers: { host: "kestrel.example.com" } });
          if (!h || h.status !== 301 || !/^https:\/\/kestrel\.example\.com\/pricing/.test((h.headers || {}).Location || "")) return "http://kestrel.example.com/ should answer 301 to the same URL on https://.";
          var s = N.httpTo(r.sys, ME, 443, { scheme: "https", host: "kestrel.example.com", port: 443, path: "/", method: "GET", headers: { host: "kestrel.example.com" } });
          var hs = s && s.headers && (s.headers["Strict-Transport-Security"] || ""), m = /max-age=(\d+)/.exec(hs || "");
          return m && +m[1] >= 15552000 ? true : "HTTPS responses need Strict-Transport-Security with max-age of at least 15552000 (6 months).";
        }
      },
      {
        id: "prove", text: "Prove it: TLS 1.1 is now <b>refused by the server</b>, TLS 1.2 works, HTTP gives a 301, and HTTPS carries the HSTS header.",
        hints: ["The openssl tests again (alert protocol version for 1.1), then curl -sI on http:// and https://.", "echo | openssl s_client -connect kestrel.example.com:443 -tls1_1 -cipher 'DEFAULT@SECLEVEL=0' -brief\necho | openssl s_client -connect kestrel.example.com:443 -tls1_2 -brief\ncurl -sI http://kestrel.example.com/\ncurl -sI https://kestrel.example.com/ | grep -i strict"],
        check: function (r) {
          var k = idx(r, /systemctl\s+(reload|restart)\s+nginx|\bnginx\s+-s\s+reload/);
          if (!after(r, k, /s_client\b.*-tls1_1/, function (e) { return outHas(e, /alert protocol version/); })) return "After the reload, a TLS 1.1 handshake should get 'alert protocol version' from the server.";
          if (!after(r, k, /s_client\b.*-tls1_2/, function (e) { return outHas(e, /Protocol version: TLSv1\.2|TLSv1\.2/); })) return "And TLS 1.2 should connect.";
          if (!after(r, k, /\bcurl\b.*http:\/\/kestrel/, function (e) { return outHas(e, /^HTTP\/1\.1 301/) && outHas(e, /^Location: https:/i); })) return "curl -sI http://kestrel.example.com/ should show the 301.";
          return after(r, k, /\bcurl\b.*https:\/\/kestrel/, function (e) { return outHas(e, /strict-transport-security/i); }) ? true : "curl -sI https://kestrel.example.com/ should show the HSTS header.";
        }
      }
    ],
    solution: lines.apply(null, ["nmap --script ssl-enum-ciphers -p 443 kestrel.example.com", "echo | openssl s_client -connect kestrel.example.com:443 -tls1_1 -cipher 'DEFAULT@SECLEVEL=0' -brief", "curl -sI http://kestrel.example.com/", "curl -sI https://kestrel.example.com/",
      "sudo nano /etc/nginx/sites-available/kestrel"].concat(N.NGX.kestrel.replace(/\n$/, "").split("\n").map(function (l) { return "    " + l; })).concat([
      "sudo nginx -t", "sudo systemctl reload nginx", "echo | openssl s_client -connect kestrel.example.com:443 -tls1_1 -cipher 'DEFAULT@SECLEVEL=0' -brief", "echo | openssl s_client -connect kestrel.example.com:443 -tls1_2 -brief",
      "curl -sI http://kestrel.example.com/", "curl -sI https://kestrel.example.com/ | grep -i strict"])),
    debrief: "<p>All three findings closed, with evidence: the server now ends a TLS 1.1 handshake with <i>protocol version</i>, plain HTTP answers 301 to HTTPS, and every HTTPS response tells browsers to never try HTTP again for a year.</p><p>The trap in this ticket: <code>openssl s_client -tls1_1</code> on Ubuntu fails <i>even against a vulnerable server</i>, because the client refuses first. A test that can't fail proves nothing; lowering the client's security level made it a real test. Next: the security records in DNS.</p>",
    realworld: "Run nmap --script ssl-enum-ciphers -p 443 against your own site, or use the SSL Labs server test; curl -sI https://YOURSITE | grep -i strict checks HSTS.",
    quiz: [
      { q: "What does HSTS do?", options: ["Encrypts HTTP", "Tells the browser to always use HTTPS for this site", "Redirects to HTTP", "Speeds up TLS"], answer: 1, why: "After the first visit, http:// is upgraded in the browser before anything is sent." },
      { q: "openssl -tls1_1 fails against a server on Ubuntu. What do you know?", options: ["The server refuses TLS 1.1", "Maybe nothing: the client may have refused first (security level)", "TLS 1.2 is off", "The cert expired"], answer: 1, why: "Check the error: 'no protocols available' is the client; 'alert protocol version' is the server." },
      { q: "Which TLS versions should a public site allow today?", options: ["1.0–1.3", "1.1–1.3", "1.2 and 1.3", "1.3 only, always"], answer: 2, why: "1.2 is still needed for some clients; 1.0/1.1 are deprecated (RFC 8996)." }
    ]
  });

  /* ================================================================== NET-409 DNS & email security */
  var DKIM_KEY = "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAu3F9bQk1n0W2c7Xr5LhVd8YtA6zQe2PjKm4sTbN1oRfG0wHiU9vC3xEyZaJ8pD5qLmNnO7sR2tUvW4xY6zA1bC3dE5fG7hI9jK1lM3nO5pQ7rS9tU1vW3xY5zA7bC9dE1fG3hI5jK7lM9nO1pQ3rS5tU7vW9xY1zA3bC5dE7fG9hI1jK3lM5nO7pQ9rS1tU3vW5xY7zA9bC1dE3fG5hI7jK9lM1nO3pQ5rS7tU9vW1xY3zA5bC7dE9fG1hI3jK5lM7nO9pQ1rS3tU5vW7xY9zQIDAQAB";
  function dnsSys(sys) {
    sys.dnsExtra = {
      "kestrel.example.com": { A: [W.PUB], MX: ["10 mail.kestrel.example.com."], NS: ["ns1.kestrel.example.com.", "ns2.kestrel.example.com."], TXT: ["\"v=spf1 ip4:203.0.113.25 ~all\"", "\"google-site-verification=Xk2L9qWmRzOa8T1bV0cYdQ\""] },
      "_dmarc.kestrel.example.com": { TXT: ["\"v=DMARC1; p=none; rua=mailto:dmarc@kestrel.example.com\""] },
      "s1._domainkey.kestrel.example.com": { TXT: ["\"v=DKIM1; k=rsa; p=" + DKIM_KEY + "\""] },
      "blog.kestrel.example.com": { CNAME: "kestrel-blog.pages.example-cloud.net." },
      "status.kestrel.example.com": { CNAME: "kestrel.status.example-cloud.net." },
      "kestrel.status.example-cloud.net": { A: ["192.0.2.80"] }
    };
  }
  var BOUNCE = "Return-Path: <news@kestrel.example.com>\nReceived: from news-relay.mailer.example (news-relay.mailer.example [198.51.100.140])\n\tby mx.customer.example with ESMTPS id 4Xk9; Tue, 10 Nov 2026 14:02:11 +0000\nAuthentication-Results: mx.customer.example;\n\tspf=softfail (domain of transitioning news@kestrel.example.com does not designate 198.51.100.140 as permitted sender) smtp.mailfrom=news@kestrel.example.com;\n\tdkim=pass header.d=kestrel.example.com header.s=s1;\n\tdmarc=pass (p=NONE) header.from=kestrel.example.com\nDKIM-Signature: v=1; a=rsa-sha256; d=kestrel.example.com; s=s1; c=relaxed/relaxed; h=from:to:subject:date; bh=8pY1yC2vV3wR4jX5kL6mN7oP8qS9tU0vW1xY2zA3bC4=; b=dGhpcyBpcyBub3QgYSByZWFsIHNpZ25hdHVyZQ==\nFrom: Kestrel <news@kestrel.example.com>\nTo: someone@customer.example\nSubject: November newsletter\n\n(The customer's mail server put it in spam.)\n";
  function change(r) { return (r.read("dns-change.txt") || "").replace(/\r/g, ""); }
  LABS.push({
    id: "net-409", n: 38, module: 4, ticket: "NET-409", xp: 180, layer: "L7",
    title: "Trust in DNS",
    topic: "SPF, DKIM and DMARC records, a dangling CNAME, DNSSEC validation, DNS over HTTPS",
    from: DEV,
    story: "<p>Two problems landed together. Marketing's newsletter, sent through a mailing service, is going to <b>spam</b> (one bounce is in <code>~/newsletter-bounce.eml</code>). And Security wants anyone to be able to spoof <code>@kestrel.example.com</code> to be impossible, not just discouraged.</p><p>Our public DNS is run by the DNS team: you can't edit it, but you can write the change request. Read the records, work out what's wrong, and put the exact new records in <code>~/dns-change.txt</code>. While you're at it, check what DNSSEC and DNS over HTTPS look like.</p>",
    learn:
      "<h3>Email authentication lives in DNS</h3>" + '<table class="t"><tr><th>Record</th><th>Where</th><th>Says</th></tr>' +
      "<tr><td>SPF</td><td>TXT on the domain</td><td>which servers may send mail for it: <code>v=spf1 ip4:203.0.113.25 include:… -all</code> (<code>-all</code> fail others, <code>~all</code> softfail)</td></tr>" +
      "<tr><td>DKIM</td><td>TXT on <code>SELECTOR._domainkey.DOMAIN</code></td><td>the public key that verifies the signature in each mail's <code>DKIM-Signature</code> header (<code>s=</code> is the selector)</td></tr>" +
      "<tr><td>DMARC</td><td>TXT on <code>_dmarc.DOMAIN</code></td><td>what receivers do when SPF and DKIM don't line up: <code>p=none</code> (just report), <code>quarantine</code> (spam), <code>reject</code></td></tr></table>" +
      ex("dig TXT kestrel.example.com +short") + ex("dig TXT _dmarc.kestrel.example.com +short") +
      "<h3>Dangling CNAMEs: subdomain takeover</h3><p>A CNAME pointing at a cloud resource you deleted (a static site bucket, an app) answers <b>NXDOMAIN</b>. Anyone who creates a resource with that name on the same cloud then serves content on <i>your</i> subdomain. Delete CNAMEs when you delete what they point at.</p>" +
      "<h3>DNSSEC</h3><p>Signed zones carry signatures (RRSIG records); a <b>validating</b> resolver checks them and sets the <code>ad</code> (authenticated data) flag. A bad signature gives <b>SERVFAIL</b>; <code>+cd</code> (checking disabled) shows the answer anyway. The public resolvers validate; Ubuntu's local stub (DNSSEC=no) doesn't.</p>" +
      ex("dig @1.1.1.1 +dnssec example.com") +
      "<h3>DNS over HTTPS</h3><p>Normal DNS is plain UDP anyone on the path can read and forge; DoH sends it inside HTTPS:</p>" + ex("curl -s -H 'accept: application/dns-json' 'https://1.1.1.1/dns-query?name=example.com&type=A'"),
    files: { "newsletter-bounce.eml": BOUNCE, "dns-change.txt": "# DNS change request for kestrel.example.com\n# One record per line: NAME TYPE VALUE, or DELETE NAME TYPE\n" },
    system: dnsSys,
    diagram: ["inet"],
    starter: "",
    objectives: [
      {
        id: "spf", text: "The newsletter comes from <b>198.51.100.140</b>, which SPF doesn't list. In <code>~/dns-change.txt</code>, write the corrected SPF record for kestrel.example.com: the mail server <b>and</b> the newsletter relay, and <b>-all</b> for everyone else.",
        hints: ["dig TXT kestrel.example.com +short shows the current SPF. Keep 203.0.113.25.", "dig TXT kestrel.example.com +short\necho 'kestrel.example.com TXT \"v=spf1 ip4:203.0.113.25 ip4:198.51.100.140 -all\"' >> ~/dns-change.txt"],
        check: function (r) {
          if (!ran(r, /\bdig\b.*TXT.*kestrel\.example\.com|\bdig\b.*kestrel\.example\.com.*TXT/i)) return "Look at the current TXT records with dig.";
          var l = change(r).split("\n").filter(function (x) { return /v=spf1/.test(x) && !/^\s*#/.test(x); })[0];
          if (!l) return "Add the new SPF record (a TXT line with v=spf1) to ~/dns-change.txt.";
          if (!/^\s*kestrel\.example\.com\.?\s+(IN\s+)?TXT\b/i.test(l)) return "The SPF record belongs on kestrel.example.com itself (NAME TXT VALUE).";
          if (!/ip4:203\.0\.113\.25\b/.test(l) || !/ip4:198\.51\.100\.140\b/.test(l)) return "List both senders: ip4:203.0.113.25 and ip4:198.51.100.140.";
          return /\s-all"?\s*$/.test(l) ? true : "End it with -all (hard fail for everyone else).";
        }
      },
      {
        id: "dkim", text: "Find the DKIM <b>selector</b> the newsletter was signed with (in the bounce) and look up its public key record.",
        hints: ["s= in the DKIM-Signature header; the record is SELECTOR._domainkey.kestrel.example.com.", "grep DKIM-Signature ~/newsletter-bounce.eml\ndig TXT s1._domainkey.kestrel.example.com +short"],
        check: function (r) { return ran(r, /\bdig\b.*s1\._domainkey\.kestrel\.example\.com/, function (e) { return outHas(e, /v=DKIM1/); }) ? true : "dig TXT SELECTOR._domainkey.kestrel.example.com, using the selector from the bounce."; }
      },
      {
        id: "dmarc", text: "DMARC is only reporting (<code>p=none</code>). Add a DMARC record to the change request that sends failing mail to <b>quarantine</b>, keeping the reports.",
        hints: ["dig TXT _dmarc.kestrel.example.com +short; change p=none to p=quarantine.", "echo '_dmarc.kestrel.example.com TXT \"v=DMARC1; p=quarantine; rua=mailto:dmarc@kestrel.example.com\"' >> ~/dns-change.txt"],
        check: function (r) {
          var l = change(r).split("\n").filter(function (x) { return /v=DMARC1/.test(x) && !/^\s*#/.test(x); })[0];
          if (!l) return "Add the new DMARC record to ~/dns-change.txt.";
          if (!/^\s*_dmarc\.kestrel\.example\.com\.?\s+(IN\s+)?TXT\b/i.test(l)) return "DMARC lives on _dmarc.kestrel.example.com.";
          if (!/p=(quarantine|reject)\b/.test(l)) return "Set the policy to p=quarantine.";
          return /rua=mailto:dmarc@kestrel\.example\.com/.test(l) ? true : "Keep the reports: rua=mailto:dmarc@kestrel.example.com.";
        }
      },
      {
        id: "dangling", text: "One of our subdomains is a <b>dangling CNAME</b> (blog and status both point at a cloud service). Find it and add a <code>DELETE</code> line for it to the change request.",
        hints: ["dig both: one target answers, the other gives NXDOMAIN.", "dig blog.kestrel.example.com\ndig status.kestrel.example.com\necho 'DELETE blog.kestrel.example.com CNAME' >> ~/dns-change.txt"],
        check: function (r) {
          if (!ran(r, /\b(dig|host|nslookup)\b.*blog\.kestrel/, function (e) { return outHas(e, /NXDOMAIN|not found/); })) return "Resolve blog.kestrel.example.com and look at the status.";
          var c = change(r);
          if (/DELETE\s+status\.kestrel/i.test(c)) return "status.kestrel.example.com works fine: don't delete it.";
          return /^\s*DELETE\s+blog\.kestrel\.example\.com\.?\s+CNAME\s*$/im.test(c) ? true : "Add: DELETE blog.kestrel.example.com CNAME";
        }
      },
      {
        id: "dnssec", text: "Using the validating resolver <code>1.1.1.1</code>: show that <code>example.com</code> validates (the <b>ad</b> flag), that <code>dnssec-failed.org</code> fails (SERVFAIL) unless you disable checking, and write the name of the one of these that's <b>signed and valid</b> plus whether kestrel.example.com is signed, to <code>~/dnssec.txt</code> (<code>example.com</code> / <code>unsigned</code>).",
        hints: ["dig @1.1.1.1 example.com (look at flags), dig @1.1.1.1 dnssec-failed.org, then again with +cd. dig @1.1.1.1 kestrel.example.com has no ad flag.", "dig @1.1.1.1 +dnssec example.com\ndig @1.1.1.1 dnssec-failed.org\ndig @1.1.1.1 +cd dnssec-failed.org +short\ndig @1.1.1.1 kestrel.example.com\nprintf 'example.com\\nunsigned\\n' > ~/dnssec.txt"],
        check: function (r) {
          if (!ran(r, /\bdig\b.*@1\.1\.1\.1.*example\.com|\bdig\b.*example\.com.*@1\.1\.1\.1/, function (e) { return outHas(e, /flags: .*\bad\b/); })) return "dig @1.1.1.1 example.com and look for the ad flag.";
          if (!ran(r, /\bdig\b.*dnssec-failed\.org/, function (e) { return outHas(e, /SERVFAIL/); })) return "dig @1.1.1.1 dnssec-failed.org should SERVFAIL.";
          if (!ran(r, /\bdig\b.*\+cd.*dnssec-failed\.org|\bdig\b.*dnssec-failed\.org.*\+cd/, function (e) { return outHas(e, /96\.99\.227\.255/); })) return "Now with +cd (checking disabled).";
          var t = word(r, "dnssec.txt"); return /example\.com/.test(t) && /unsigned/.test(t) && !/dnssec-failed/.test(t) ? true : "~/dnssec.txt: the valid signed name, and 'unsigned' for kestrel.example.com.";
        }
      },
      {
        id: "doh", text: "Look up <code>kestrel.example.com</code> over <b>DNS over HTTPS</b> with curl (JSON API at 1.1.1.1).",
        hints: ["curl with the header accept: application/dns-json and ?name=...&type=A.", "curl -s -H 'accept: application/dns-json' 'https://1.1.1.1/dns-query?name=kestrel.example.com&type=A'"],
        check: function (r) { return ran(r, /\bcurl\b.*dns-query/, function (e) { return outHas(e, /"data":"203\.0\.113\.80"/); }) ? true : "curl -s -H 'accept: application/dns-json' 'https://1.1.1.1/dns-query?name=kestrel.example.com&type=A'"; }
      }
    ],
    solution: lines("dig TXT kestrel.example.com +short", "grep -iE 'spf=|dkim=|dmarc=' ~/newsletter-bounce.eml", "echo 'kestrel.example.com TXT \"v=spf1 ip4:203.0.113.25 ip4:198.51.100.140 -all\"' >> ~/dns-change.txt",
      "grep DKIM-Signature ~/newsletter-bounce.eml", "dig TXT s1._domainkey.kestrel.example.com +short", "dig TXT _dmarc.kestrel.example.com +short",
      "echo '_dmarc.kestrel.example.com TXT \"v=DMARC1; p=quarantine; rua=mailto:dmarc@kestrel.example.com\"' >> ~/dns-change.txt",
      "dig blog.kestrel.example.com", "dig status.kestrel.example.com +short", "echo 'DELETE blog.kestrel.example.com CNAME' >> ~/dns-change.txt",
      "dig @1.1.1.1 +dnssec example.com", "dig @1.1.1.1 dnssec-failed.org", "dig @1.1.1.1 +cd dnssec-failed.org +short", "dig @1.1.1.1 kestrel.example.com", "printf 'example.com\\nunsigned\\n' > ~/dnssec.txt",
      "curl -s -H 'accept: application/dns-json' 'https://1.1.1.1/dns-query?name=kestrel.example.com&type=A'", "cat ~/dns-change.txt"),
    debrief: "<p>The newsletter failed SPF because its relay wasn't listed; it only reached inboxes at all because DKIM passed and DMARC was set to <code>p=none</code>, which also means anyone could spoof us without consequence. The change request lists the relay, hardens SPF to <code>-all</code> and moves DMARC to quarantine (reject is the next step once the reports look clean). It also deletes <b>blog</b>, a CNAME to a cloud page that no longer exists: free real estate for a takeover.</p><p>DNSSEC is the missing piece from Module 3's cache poisoning: validating resolvers reject forged answers for signed zones. kestrel.example.com isn't signed yet; that's a ticket for the DNS team too.</p>",
    realworld: "dig TXT yourdomain.com and dig TXT _dmarc.yourdomain.com for any domain you send mail from. Firefox and Chrome can use DoH; dig @1.1.1.1 +dnssec shows the ad flag for signed zones.",
    quiz: [
      { q: "Where does a receiver find the DKIM public key?", options: ["In the email", "TXT at SELECTOR._domainkey.DOMAIN", "In SPF", "On the web site"], answer: 1, why: "The selector (s=) in the signature says which key." },
      { q: "DMARC p=none means…", options: ["Reject everything", "Only report; deliver as usual", "Quarantine", "No email"], answer: 1, why: "Monitoring mode: a start, not protection." },
      { q: "A validating resolver returns SERVFAIL for a signed name. Why?", options: ["The name doesn't exist", "The signatures don't verify", "Too slow", "No IPv6"], answer: 1, why: "Bogus DNSSEC = refuse rather than return a possibly forged answer." }
    ]
  });

  /* ================================================================== NET-410 Lock down Kestrel's network (capstone) */
  var REQUIREMENTS = "# Kestrel network baseline (approved by Dev and Maya)\n\nkc-web-01 (10.20.0.15, public 203.0.113.80 = kestrel.example.com)\n  - From the internet (ext-scan-01.example.net): only TCP 80 and 443.\n  - From the office (kc-mon-01, 10.20.5.0/24): also SSH (22).\n  - SSH from our admin session (198.51.100.20) keeps working.\n  - Nothing else listens on a non-loopback address except sshd and nginx.\n  - HTTPS: TLS 1.2 and 1.3 only.\n\nkc-db-01 (10.20.0.21)\n  - PostgreSQL (5432) and SSH (22) only from kc-web-01. Nothing from anywhere else.\n\nEvidence\n  - ~/proof-internet.nmap   full TCP scan of kestrel.example.com from ext-scan-01.example.net (-p- -Pn, -oN)\n  - ~/proof-office.nmap     full TCP scan of kc-web-01 from kc-mon-01 (-p-, -oN)\n  Both taken AFTER your changes.\n";
  function capSys(sys) {
    M3.preinstall(sys, "nmap");
    N.riskyServices(sys, ["redis", "docker", "telnet"], NOW - 40 * DAY);
    httpsSys(sys);
    M2.putRoot(sys, "/etc/nginx/sites-available/kestrel", (M2.rd(sys, "/etc/nginx/sites-available/kestrel") || "").replace("\tlocation / {\n\t\troot /var/www/kestrel;\n\t}", "\tlocation / {\n\t\treturn 301 https://$host$request_uri;\n\t}").replace("\troot /var/www/kestrel;\n\tadd_header Alt-Svc", "\troot /var/www/kestrel;\n\tadd_header Strict-Transport-Security \"max-age=31536000\" always;\n\tadd_header Alt-Svc"), 420, 0, 0, NOW - 200 * DAY);
    dbSetup()(sys);
  }
  var CAP_PORTS = [21, 22, 23, 25, 80, 443, 2375, 3306, 5432, 6379, 8080, 11211];
  function proofOk(r, f, want, label) {
    var t = r.read(f) || ""; if (!t) return "Save the " + label + " scan to ~/" + f + " (-oN).";
    if (!/Not shown: 655\d\d|All 65535 scanned/.test(t)) return "~/" + f + " should be a full scan of all 65535 ports (-p-).";
    var open = t.split("\n").filter(function (l) { return /^\d+\/tcp\s+open\s/.test(l); }).map(function (l) { return +l.split("/")[0]; });
    return open.join(",") === want ? null : "~/" + f + " shows open: " + (open.join(", ") || "nothing") + ". Re-run it after fixing.";
  }
  LABS.push({
    id: "net-410", n: 39, module: 4, ticket: "NET-410", xp: 300, layer: "L1–7", capstone: true,
    title: "Lock down Kestrel's network",
    topic: "Capstone: meet a written network baseline and prove it with scans from outside",
    from: MAYA,
    story: "<p>We've done this piece by piece. Now the auditors want it all at once, on a freshly restored copy of kc-web-01 (the restore brought back some old sins) and kc-db-01. The baseline is in <code>~/requirements.md</code>.</p><p>Make both servers match it, and bring the evidence: scans from the internet and from the office, taken after your changes.</p>",
    learn:
      "<h3>Your brief</h3><p>No hints in a capstone. Read <code>~/requirements.md</code>; meet every line; save the two evidence files.</p>" +
      '<div class="callout">Everything you need is from this module: <code>ss -tulpn</code>, service configs and <code>systemctl</code>, ufw (or nftables) on kc-web-01 and on kc-db-01 (you have a key there), nginx\'s TLS settings, nmap from <code>kc-mon-01</code> and <code>ext-scan-01.example.net</code>. Don\'t lock yourself out.</div>' +
      "<p>The reference solution is hidden behind a button on the Tasks tab; revealing it halves this capstone's XP.</p>",
    files: { "requirements.md": REQUIREMENTS },
    system: capSys,
    diagram: ["db", "mon", "scan"],
    starter: "",
    objectives: [
      { id: "internet", hints: [], text: "From the internet, kestrel.example.com shows only <b>80 and 443</b>.", check: function (r) { if (r.sys.lockedOut) return "You locked yourself out. Reset and allow your session's SSH first."; var o = openFrom(r, EXT, W.PUB, CAP_PORTS); return o.join(",") === "80,443" ? true : "From ext-scan-01 these are open: " + (o.join(", ") || "nothing") + "."; } },
      { id: "office", hints: [], text: "From the office, kc-web-01 shows only <b>22, 80 and 443</b>, and your own SSH session still works.", check: function (r) { if (r.sys.lockedOut) return "You're locked out."; var o = openFrom(r, MON, ME, CAP_PORTS); if (o.join(",") !== "22,80,443") return "From kc-mon-01 these are open: " + (o.join(", ") || "nothing") + "."; return N.fwVerdict(r.sys, SESSION_IP, 22, "tcp", false, ME) === "accept" ? true : "SSH from 198.51.100.20 must keep working."; } },
      { id: "listen", hints: [], text: "Nothing but sshd and nginx listens on kc-web-01 beyond loopback, even with the firewall off.", check: function (r) { var bad = publicListeners(r.sys).filter(function (l) { return !/^(sshd|nginx)$/.test(l.proc.comm || ""); }); return bad.length ? (bad[0].proc.comm || "something") + " still listens on " + bad[0].sock.addr + ":" + bad[0].sock.port + "." : true; } },
      { id: "tls", hints: [], text: "HTTPS accepts only TLS 1.2 and 1.3.", check: function (r) { if (kTls(r, "TLSv1.1").ok || kTls(r, "TLSv1").ok) return "TLS 1.0/1.1 are still accepted."; return kTls(r, "TLSv1.2").ok && kTls(r, "TLSv1.3").ok ? true : "TLS 1.2 and 1.3 must work."; } },
      { id: "db", hints: [], text: "kc-db-01: 5432 and 22 only from kc-web-01.", check: function (r) { if (stateFrom(r, null, DB, 5432) !== "open") return "kc-web-01 must still reach PostgreSQL."; if (stateFrom(r, null, DB, 22) !== "open") return "kc-web-01 must still reach kc-db-01 over SSH."; if (stateFrom(r, MON, DB, 5432) === "open" || stateFrom(r, MON, DB, 22) === "open") return "The office can still reach kc-db-01."; var m = dbMach(r); return N.fwVerdict(m, "10.20.0.45", 5432, "tcp", false, DB) === "accept" ? "Other servers (kc-data-01) can still reach PostgreSQL." : true; } },
      { id: "proof", hints: [], text: "<code>~/proof-internet.nmap</code> and <code>~/proof-office.nmap</code>: full scans taken after your changes.", check: function (r) { return proofOk(r, "proof-internet.nmap", "80,443", "internet") || proofOk(r, "proof-office.nmap", "22,80,443", "office") || true; } }
    ],
    solution: lines.apply(null, ["cat ~/requirements.md", "sudo ss -tulpn", "ssh kc-mon-01 nmap -p- kc-web-01",
      "sudo sed -i 's/^bind 0.0.0.0/bind 127.0.0.1 -::1/; s/^protected-mode no/protected-mode yes/' /etc/redis/redis.conf", "sudo systemctl restart redis-server",
      "sudo nano /etc/docker/daemon.json", "    {", "      \"hosts\": [\"unix:///var/run/docker.sock\"],", "      \"log-driver\": \"journald\"", "    }", "sudo systemctl restart docker", "sudo systemctl disable --now inetutils-inetd",
      "sudo nano /etc/nginx/sites-available/kestrel"].concat(N.NGX.kestrel.replace(/\n$/, "").split("\n").map(function (l) { return "    " + l; })).concat([
      "sudo nginx -t", "sudo systemctl reload nginx",
      "sudo ufw default deny incoming", "sudo ufw allow 80/tcp", "sudo ufw allow 443/tcp", "sudo ufw allow from 10.20.5.0/24 to any port 22 proto tcp", "sudo ufw allow from " + SESSION_IP + " to any port 22 proto tcp", "sudo ufw enable",
      "ssh kc-db-01", "sudo ufw default deny incoming", "sudo ufw allow from 10.20.0.15 to any port 5432 proto tcp", "sudo ufw allow from 10.20.0.15 to any port 22 proto tcp", "sudo ufw enable", "exit",
      "nc -zv -w 2 kc-db-01 5432", "ssh kc-mon-01 nc -zv -w 2 kc-db-01 5432",
      "echo | openssl s_client -connect kestrel.example.com:443 -tls1_1 -cipher 'DEFAULT@SECLEVEL=0' -brief",
      "ssh ext-scan-01.example.net nmap -p- -Pn kestrel.example.com > ~/proof-internet.nmap", "ssh kc-mon-01 nmap -p- kc-web-01 > ~/proof-office.nmap", "cat ~/proof-internet.nmap ~/proof-office.nmap"])),
    debrief: "<p><b>Module 4 complete.</b> Two servers meet a written baseline, with the evidence to show it: from the internet only the web site; from the office the web site and SSH; kc-db-01 talking only to kc-web-01. Underneath the firewall, every service that didn't need the network stopped listening on it, so the firewall is the second line of defence, not the only one. And the site speaks only modern TLS.</p>" +
      "<p>You've now seen networks from both sides: attacks on the wire in Module 3, and the boring, layered defences that stop them here. Module 5 takes all of it to the cloud.</p>",
    realworld: "Write your own baseline for a server you run (who may reach what), then prove it with nmap from outside. Re-run the proof after every change: that's what continuous compliance tools automate.",
    quiz: []
  });

  LABS.forEach(function (l) { l.drills = l.drills || []; T.LABS.push(l); });
  T.UPCOMING = T.UPCOMING.filter(function (x) { return x.module !== 4; });
  T.M4 = { riskySys: riskySys, nftSys: nftSys, dbSetup: dbSetup, bastionSys: bastionSys, wgSys: wgSys, httpsSys: httpsSys, dnsSys: dnsSys, capSys: capSys, openFrom: openFrom, stateFrom: stateFrom, listenAddrs: listenAddrs, onlyLoopback: onlyLoopback, nmapOut: nmapOut, openLines: openLines, pre: pre, SAM_NFT: SAM_NFT, GOOD_NFT: GOOD_NFT, SSH_CONFIG: SSH_CONFIG, WG0: WG0, SESSION_IP: SESSION_IP };
})();
