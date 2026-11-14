/* sudo learn — Networking Module 4 practice drills (3 per lab, +5 XP each). Loaded after labs-m4.js. */
(function () {
  "use strict";
  var T = window.NET_TRACK, S = window.ShEngine, M2 = S.M2, M3 = S.M3, M4 = S.M4, N = window.NetCore, NH = window.NetLab.H, X = T.M4, W = N.W;
  var lines = T.lines, ran = NH.ran, outHas = NH.outHas, idx = NH.idx;
  function word(r, p) { return (r.read(p) || "").trim().toLowerCase(); }
  var NMAP = X.pre(["nmap"]);
  function nm(r, fn) { return ran(r, /\bnmap\b/, fn); }

  var DRILLS = {
    "net-401": [
      { id: "d1", title: "Just the open ones", system: NMAP, text: "<p>Scan kc-legacy-01 and show <b>only open</b> ports.</p>", starter: "", solution: lines("nmap --open kc-legacy-01"),
        check: function (r) { return nm(r, function (e) { return /--open/.test(e.cmd) && outHas(e, /8081\/tcp\s+open/); }) ? true : "nmap --open kc-legacy-01"; } },
      { id: "d2", title: "Grepable", system: NMAP, text: "<p>Scan ports 1-1024 of kc-legacy-01 and save the <b>grepable</b> output to <code>~/legacy.gnmap</code>.</p>", starter: "", solution: lines("nmap -p 1-1024 -oG ~/legacy.gnmap kc-legacy-01"),
        check: function (r) { var t = r.read("legacy.gnmap") || ""; return /Ports: .*22\/open\/tcp/.test(t) ? true : "-oG ~/legacy.gnmap"; } },
      { id: "d3", title: "Quick sweep", system: NMAP, text: "<p>Ping-sweep <b>10.20.0.1-60</b> without resolving names (<code>-n</code>).</p>", starter: "", solution: lines("sudo nmap -sn -n 10.20.0.1-60"),
        check: function (r) { return nm(r, function (e) { return /-sn/.test(e.cmd) && /-n\b/.test(e.cmd) && outHas(e, /Nmap scan report for 10\.20\.0\.40$/) && outHas(e, /60 IP addresses/); }) ? true : "nmap -sn -n with the range 10.20.0.1-60."; } }
    ],
    "net-402": [
      { id: "d1", title: "Who's on 0.0.0.0?", system: X.riskySys, text: "<p>List the <b>TCP</b> listeners that aren't on a loopback address (127.x or ::1), with their programs.</p>", starter: "", solution: lines("sudo ss -tlnp | grep -vE '127\\.0\\.0\\.|\\[::1\\]'"),
        check: function (r) { return ran(r, /\bss\b/, function (e) { return outHas(e, /0\.0\.0\.0:6379/) && !outHas(e, /127\.0\.0\.53:53/) && !outHas(e, /127\.0\.0\.1:8080/); }) ? true : "sudo ss -tlnp, filtered with grep -v for loopback addresses."; } },
      { id: "d2", title: "Version of 2375", system: X.riskySys, text: "<p>Ask nmap what runs on port <b>2375</b> of kc-web-01 (from kc-web-01 is fine).</p>", starter: "", solution: lines("nmap -sV -p 2375 10.20.0.15"),
        check: function (r) { return nm(r, function (e) { return /-sV/.test(e.cmd) && outHas(e, /2375\/tcp\s+open\s+docker\s+Docker/); }) ? true : "nmap -sV -p 2375 10.20.0.15"; } },
      { id: "d3", title: "Telnet off", system: X.riskySys, text: "<p>Stop Telnet (<code>inetutils-inetd</code>) now and at boot.</p>", starter: "", solution: lines("sudo systemctl disable --now inetutils-inetd"),
        check: function (r) { return X.listenAddrs(r.sys, 23).length ? "Port 23 still listens." : M2.enabledState(r.sys, M2.loadUnit(r.sys, "inetutils-inetd.service")) === "enabled" ? "Still enabled at boot." : true; } }
    ],
    "net-403": [
      { id: "d1", title: "Numbered", system: function (sys) { var f = M4.fw(sys); f.enabled = true; f.rules.push({ action: "allow", dir: "in", port: "22", proto: "tcp", from: "any", to: "any", v6: false }, { action: "allow", dir: "in", port: "8080", proto: "tcp", from: "any", to: "any", v6: false }, { action: "allow", dir: "in", port: "443", proto: "tcp", from: "any", to: "any", v6: false }); }, text: "<p>A colleague opened 8080 to the world by mistake. Delete that rule by its <b>number</b>.</p>", starter: "", solution: lines("sudo ufw status numbered", "sudo ufw --force delete 2"),
        check: function (r) { var f = M4.fw(r.sys); if (f.rules.some(function (x) { return String(x.port) === "8080"; })) return "The 8080 rule is still there."; return f.rules.length === 2 && ran(r, /ufw\b.*delete\s+\d/) ? true : "Delete only rule 2, by number."; } },
      { id: "d2", title: "Limit", text: "<p>Add a ufw <b>limit</b> rule for SSH (rate-limits repeated connections from one address).</p>", starter: "", solution: lines("sudo ufw limit 22/tcp"),
        check: function (r) { return M4.fw(r.sys).rules.some(function (x) { return x.action === "limit" && String(x.port) === "22"; }) ? true : "sudo ufw limit 22/tcp"; } },
      { id: "d3", title: "Reject inside", text: "<p>Make ufw <b>reject</b> (not silently drop) connections to port <b>3306</b> from 10.20.0.0/24.</p>", starter: "", solution: lines("sudo ufw reject from 10.20.0.0/24 to any port 3306 proto tcp"),
        check: function (r) { return M4.fw(r.sys).rules.some(function (x) { return x.action === "reject" && String(x.port) === "3306" && x.from === "10.20.0.0/24"; }) ? true : "ufw reject from 10.20.0.0/24 to any port 3306 proto tcp"; } }
    ],
    "net-404": [
      { id: "d1", title: "Check before load", system: X.nftSys, text: "<p>Check <code>/etc/nftables.conf</code> for errors <b>without</b> loading it.</p>", starter: "", solution: lines("sudo nft -c -f /etc/nftables.conf && echo OK"),
        check: function (r) { return ran(r, /\bnft\b.*-c\b.*-f\b|\bnft\b.*--check/, function (e) { return !e.err.length; }) ? true : "sudo nft -c -f /etc/nftables.conf"; } },
      { id: "d2", title: "Add live", system: function (sys) { X.nftSys(sys); M2.putRoot(sys, "/etc/nftables.conf", X.GOOD_NFT); sys.nft = null; M2.stopUnit(sys, M2.loadUnit(sys, "nftables.service")); M2.unitUp(sys, "nftables.service"); }, text: "<p>Allow node_exporter (<b>tcp 9100</b>) from <b>10.20.5.10</b> only, in the running inet filter input chain, <b>before</b> the final drop rule.</p>", starter: "", solution: lines("sudo nft -a list chain inet filter input", "sudo nft insert rule inet filter input position 10 ip saddr 10.20.5.10 tcp dport 9100 accept"),
        check: function (r) { if (N.fwVerdict(r.sys, "10.20.5.10", 9100, "tcp", false, "10.20.0.15") !== "accept") return "kc-mon-01 can't reach 9100 yet (is your rule before the drop?)."; return N.fwVerdict(r.sys, "10.20.5.22", 9100, "tcp", false, "10.20.0.15") === "accept" ? "Only 10.20.5.10, not the whole office." : true; } },
      { id: "d3", title: "Flush", system: X.nftSys, text: "<p>Emergency: remove <b>every</b> nftables rule right now (the file stays as it is).</p>", starter: "", solution: lines("sudo nft flush ruleset", "sudo nft list ruleset"),
        check: function (r) { return !r.sys.nft || !r.sys.nft.tables.length ? (/table ip filter/.test(r.read("/etc/nftables.conf") || "") ? true : "Leave /etc/nftables.conf alone.") : "sudo nft flush ruleset"; } }
    ],
    "net-405": [
      { id: "d1", title: "What's on db?", system: X.dbSetup(), text: "<p>Without logging in interactively, show kc-db-01's TCP listeners.</p>", starter: "", solution: lines("ssh kc-db-01 sudo ss -tlnp"),
        check: function (r) { return ran(r, /\bssh\b.*kc-db-01.*\bss\b/, function (e) { return outHas(e, /0\.0\.0\.0:5432/); }) ? true : "ssh kc-db-01 sudo ss -tlnp"; } },
      { id: "d2", title: "From where?", system: X.dbSetup({ fw: [["5432", "10.20.0.15"], ["22", "10.20.0.15"]] }), text: "<p>From <b>kc-mon-01</b>, check port 5432 on kc-db-01 with nmap (it should be filtered).</p>", starter: "", solution: lines("ssh kc-mon-01 nmap -Pn -p 5432 kc-db-01"),
        check: function (r) { return ran(r, /\bnmap\b/, function (e) { return /kc-mon-01/.test(e.cmd) && outHas(e, /5432\/tcp\s+filtered/); }) ? true : "ssh kc-mon-01 nmap -Pn -p 5432 kc-db-01"; } },
      { id: "d3", title: "Backups too", system: X.dbSetup({ fw: [["5432", "10.20.0.15"], ["22", "10.20.0.15"]] }), text: "<p>kc-backup-01 (10.20.0.31) now also needs SSH to kc-db-01. Add that rule on kc-db-01.</p>", starter: "", solution: lines("ssh kc-db-01 sudo ufw allow from 10.20.0.31 to any port 22 proto tcp"),
        check: function (r) { var m = M2.machine(r.sys, "10.20.0.21"); return N.fwVerdict(m, "10.20.0.31", 22, "tcp", false, "10.20.0.21") === "accept" && N.fwVerdict(m, "10.20.0.31", 5432, "tcp", false, "10.20.0.21") !== "accept" ? true : "Allow 22 from 10.20.0.31 only (not 5432)."; } }
    ],
    "net-406": [
      { id: "d1", title: "One-off jump", system: X.bastionSys, text: "<p>Run <code>uptime</code> on kc-db-01 through kc-bastion-01, without any config file.</p>", starter: "", solution: lines("ssh -J kc-bastion-01 kc-db-01 uptime"),
        check: function (r) { return ran(r, /\bssh\b.*-J/, function (e) { return outHas(e, /load average/); }) ? true : "ssh -J kc-bastion-01 kc-db-01 uptime"; } },
      { id: "d2", title: "Effective settings", system: X.bastionSys, text: "<p>Show the bastion's <b>effective</b> PasswordAuthentication setting.</p>", starter: "", solution: lines("ssh kc-bastion-01 sudo sshd -T | grep -i passwordauthentication"),
        check: function (r) { return ran(r, /sshd\s+-T/, function (e) { return outHas(e, /^passwordauthentication yes$/); }) ? true : "ssh kc-bastion-01 sudo sshd -T, grep for passwordauthentication."; } },
      { id: "d3", title: "Config alias", system: X.bastionSys, text: "<p>Write <code>~/.ssh/config</code> so that <code>ssh db</code> goes through the bastion, and use it to run <code>hostname</code>.</p>", starter: "", solution: lines.apply(null, ["nano ~/.ssh/config"].concat(X.SSH_CONFIG.replace(/\n$/, "").split("\n").map(function (l) { return "    " + l; })).concat(["ssh db hostname"])),
        check: function (r) { return ran(r, /^\s*ssh\s+db\b/, function (e) { return outHas(e, /^kc-db-01$/); }) ? true : "Host db with HostName kc-db-01 and ProxyJump bastion; then ssh db hostname."; } }
    ],
    "net-407": [
      { id: "d1", title: "New key pair", system: X.pre(["wireguard-tools"]), text: "<p>Generate a WireGuard key pair: private key in <code>/etc/wireguard/test.key</code> (mode 600), public key in <code>/etc/wireguard/test.pub</code>.</p>", starter: "", solution: lines("wg genkey | sudo tee /etc/wireguard/test.key | wg pubkey | sudo tee /etc/wireguard/test.pub", "sudo chmod 600 /etc/wireguard/test.key"),
        check: function (r) { var k = (r.read("/etc/wireguard/test.key") || "").trim(), p = (r.read("/etc/wireguard/test.pub") || "").trim(); if (!k) return "Write the private key to /etc/wireguard/test.key."; if (p !== N.wgPub(k)) return "test.pub must be the public key of test.key (wg pubkey)."; return (r.node("/etc/wireguard/test.key").mode & 63) === 0 ? true : "chmod 600 the private key."; } },
      { id: "d2", title: "Peers only", system: function (sys) { X.wgSys(sys); M2.putRoot(sys, "/etc/wireguard/wg0.conf", X.WG0, 384); }, text: "<p>Bring wg0 up and show just its <b>peers</b> (<code>wg show wg0 peers</code>-style: the peer line).</p>", starter: "", solution: lines("sudo wg-quick up wg0", "sudo wg show wg0"),
        check: function (r) { return ran(r, /\bwg\s+show\b/, function (e) { return outHas(e, /^peer: /); }) ? true : "wg-quick up wg0, then sudo wg show wg0."; } },
      { id: "d3", title: "Down again", system: function (sys) { X.wgSys(sys); M2.putRoot(sys, "/etc/wireguard/wg0.conf", X.WG0, 384); }, text: "<p>Bring wg0 up, then take it <b>down</b> and show that the route to 10.30.0.0/24 is gone.</p>", starter: "", solution: lines("sudo wg-quick up wg0", "sudo wg-quick down wg0", "ip route"),
        check: function (r) { if (!ran(r, /wg-quick\s+down\s+wg0/)) return "sudo wg-quick down wg0"; var k = idx(r, /wg-quick\s+down/); return r.history.some(function (e, i) { return i > k && /\bip\s+(-\w+\s+)*r(oute)?\b/.test(e.cmd) && !outHas(e, /10\.30\.0\.0\/24/); }) && !(r.sys.wgLive || {}).wg0 ? true : "Show ip route after taking it down."; } }
    ],
    "net-408": [
      { id: "d1", title: "Which version?", text: "<p>Connect to kestrel.example.com with openssl in <b>brief</b> mode and see which protocol version it negotiates.</p>", starter: "", solution: lines("echo | openssl s_client -connect kestrel.example.com:443 -brief"),
        check: function (r) { return ran(r, /s_client\b/, function (e) { return outHas(e, /Protocol version: TLSv1\.3/); }) ? true : "echo | openssl s_client -connect kestrel.example.com:443 -brief"; } },
      { id: "d2", title: "curl max", text: "<p>Make curl use <b>at most TLS 1.2</b> for https://kestrel.example.com/ and print just the status code.</p>", starter: "", solution: lines("curl -s -o /dev/null --tls-max 1.2 -w '%{http_code}\\n' https://kestrel.example.com/"),
        check: function (r) { return ran(r, /\bcurl\b.*--tls-max\s+1\.2/, function (e) { return outHas(e, /^200$/); }) ? true : "curl --tls-max 1.2 with -w '%{http_code}'."; } },
      { id: "d3", title: "HSTS present?", text: "<p>Print only the <b>Strict-Transport-Security</b> header of https://kestrel.example.com/.</p>", starter: "", solution: lines("curl -sI https://kestrel.example.com/ | grep -i strict-transport-security"),
        check: function (r) { return ran(r, /\bcurl\b/, function (e) { return e.out.length === 1 && /strict-transport-security/i.test(e.out[0]); }) ? true : "curl -sI, piped to grep -i strict-transport-security."; } }
    ],
    "net-409": [
      { id: "d1", title: "MX", system: X.dnsSys, text: "<p>Which server receives mail for kestrel.example.com? Show the MX record, short form.</p>", starter: "", solution: lines("dig MX kestrel.example.com +short"),
        check: function (r) { return ran(r, /\bdig\b.*MX/i, function (e) { return outHas(e, /^10 mail\.kestrel\.example\.com\.$/); }) ? true : "dig MX kestrel.example.com +short"; } },
      { id: "d2", title: "The ad flag", text: "<p>Ask <b>8.8.8.8</b> for example.com and show only the flags line.</p>", starter: "", solution: lines("dig @8.8.8.8 example.com | grep flags"),
        check: function (r) { return ran(r, /\bdig\b.*@8\.8\.8\.8/, function (e) { return outHas(e, /^;; flags: .*\bad\b/); }) ? true : "dig @8.8.8.8 example.com | grep flags"; } },
      { id: "d3", title: "DoH for MX", system: X.dnsSys, text: "<p>Ask Cloudflare's DNS-over-HTTPS API for the <b>MX</b> record of example.com.</p>", starter: "", solution: lines("curl -s -H 'accept: application/dns-json' 'https://1.1.1.1/dns-query?name=example.com&type=MX'"),
        check: function (r) { return ran(r, /\bcurl\b.*dns-query.*type=MX/i, function (e) { return outHas(e, /"type":15/); }) ? true : "dns-query?name=example.com&type=MX with the dns-json accept header."; } }
    ],
    "net-410": [
      { id: "d1", title: "Outside in one line", system: NMAP, text: "<p>From ext-scan-01.example.net, scan the top <b>100</b> ports of kestrel.example.com without host discovery.</p>", starter: "", solution: lines("ssh ext-scan-01.example.net nmap -Pn --top-ports 100 kestrel.example.com"),
        check: function (r) { return ran(r, /\bnmap\b/, function (e) { return /ext-scan-01/.test(e.cmd) && /--top-ports\s+100|-F\b/.test(e.cmd) && outHas(e, /Nmap scan report for kestrel\.example\.com/); }) ? true : "ssh ext-scan-01.example.net nmap -Pn --top-ports 100 kestrel.example.com"; } },
      { id: "d2", title: "Save the evidence", system: NMAP, text: "<p>Save a full TCP scan of kc-web-01 <b>from kc-mon-01</b> to <code>~/office.nmap</code> on kc-web-01.</p>", starter: "", solution: lines("ssh kc-mon-01 nmap -p- kc-web-01 > ~/office.nmap"),
        check: function (r) { var t = r.read("office.nmap") || ""; return /Nmap scan report for kc-web-01/.test(t) && /Not shown: 655\d\d/.test(t) ? true : "Redirect the remote scan's output: ssh kc-mon-01 nmap -p- kc-web-01 > ~/office.nmap"; } },
      { id: "d3", title: "Diff two scans", system: NMAP, files: { "before.txt": "22/tcp open ssh\n23/tcp open telnet\n80/tcp open http\n443/tcp open https\n6379/tcp open redis\n", "after.txt": "22/tcp open ssh\n80/tcp open http\n443/tcp open https\n" }, text: "<p>Show which open ports disappeared between <code>~/before.txt</code> and <code>~/after.txt</code>, using <code>diff</code>.</p>", starter: "", solution: lines("diff ~/before.txt ~/after.txt"),
        check: function (r) { return ran(r, /\bdiff\b.*before\.txt.*after\.txt/, function (e) { return outHas(e, /^< 23\/tcp/) && outHas(e, /^< 6379\/tcp/); }) ? true : "diff ~/before.txt ~/after.txt"; } }
    ]
  };
  T.LABS.forEach(function (l) { if (DRILLS[l.id]) l.drills = DRILLS[l.id].map(function (d) { d.layer = d.layer || l.layer; return d; }); });
})();
