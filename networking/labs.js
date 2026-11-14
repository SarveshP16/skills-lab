/* sudo learn — Networking track, Module 1: Up the OSI stack (NET-101..111). Terminal-first labs on kc-web-01, now
   seen as one machine on Kestrel's network (net-core.js). Each lab works on a layer, from the cable to HTTP, and the
   network panel beside the terminal shows what kc-web-01 can reach after every command. Checks read the machine's
   network state (links, addresses, routes, neighbours, sockets, certificates) and what commands printed. */
(function () {
  "use strict";
  var S = window.ShEngine, M2 = S.M2, N = window.NetCore, NH = window.NetLab.H, SH = window.ShLab.H;
  var MAYA = "Maya Chen · SRE lead", DEV = "Dev Patel · Security", BEN = "Ben Okoro · Developer";
  var NOW = S.NOW, DAY = S.DAY, HOUR = 3600000, P = N.P, W = N.W, ME = "10.20.0.15";
  var LABS = [];

  function esc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
  function ex(cmd) { return '<pre class="ex">' + esc(cmd) + "</pre>"; }
  function code(text) { return '<pre class="code">' + esc(text) + "</pre>"; }
  function lines() { return Array.prototype.slice.call(arguments).join("\n") + "\n"; }
  function L(t) { return SH.lines(t || ""); }
  var ran = NH.ran, outHas = NH.outHas, rootish = NH.rootish, idx = NH.idx;
  function lastIdx(r, re, fn) { return idx(r, re, fn); }
  function after(r, i, re, fn) { return r.history.some(function (e, k) { return k > i && re.test(e.cmd) && (!fn || fn(e)); }); }
  function nw(r) { return r.sys.nw; }
  function npText(r) { return r.read("/etc/netplan/01-kestrel.yaml") || ""; }
  function npConf(r) { return N.npLoad(r.sys).conf; }
  function lineOf(text, re) { var m = L(text).map(function (l) { return re.exec(l); }).filter(Boolean)[0]; return m ? m[1].trim() : null; }
  function setNetplan(sys, text) { M2.putRoot(sys, "/etc/netplan/01-kestrel.yaml", text, 384, 0, 0, NOW - 2 * DAY); }
  function loss0(e) { return / 0% packet loss/.test(e.out.join("\n")); }
  function pingOk(e) { return / 0% packet loss/.test(e.out.join("\n")) || /[1-9]\d* received/.test(e.out.join("\n")) && !/100% packet loss/.test(e.out.join("\n")); }
  function unitText(desc, exec) { return "[Unit]\nDescription=" + desc + "\nAfter=network.target\n\n[Service]\nUser=www-data\nWorkingDirectory=/opt/kestrel/app\nExecStart=" + exec + "\nRestart=on-failure\n\n[Install]\nWantedBy=multi-user.target\n"; }
  function listener(r, port, unit) { return M2.listeners(r.sys).filter(function (x) { return x.sock.proto === "tcp" && x.sock.port === port && (!unit || x.proc.unit === unit); }).map(function (x) { return x.sock.addr; })[0] || null; }

  /* ================================================================== NET-101 Layers & encapsulation */
  var REQ = "GET / HTTP/1.1\r\nHost: example.com\r\nUser-Agent: curl/8.5.0\r\nAccept: */*\r\n\r\n";
  var RESP = "HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: 1256\r\nServer: ECAcc (nyd/D184)\r\n\r\n<!doctype html>\n<html>\n<head>\n    <title>Example Domain</title>\n";
  function webCapture() {
    var t0 = Date.UTC(2026, 10, 11, 8, 47, 12) / 1000 + 0.104221;
    var dns = P.dns(t0, ME, "10.20.0.2", 48712, 30114, "example.com", "A", [{ type: "A", data: "93.184.215.14", ttl: 3561 }]);
    var tcp = P.convo({ t: t0 + 0.0213, a: ME, b: "93.184.215.14", pa: 51822, pb: 80, ttlB: 57, steps: [
      { flags: "S", dt: 0 }, { dir: "<", flags: "S.", dt: 0.0884 }, { flags: ".", dt: 0.0885 }, { flags: "P.", data: REQ, dt: 0.0886 },
      { dir: "<", flags: ".", dt: 0.1771 }, { dir: "<", flags: "P.", data: RESP, dt: 0.1779 }, { flags: ".", dt: 0.1781 },
      { flags: "F.", dt: 0.1790 }, { dir: "<", flags: "F.", dt: 0.2672 }, { flags: ".", dt: 0.2674 }] });
    return { all: dns.concat(tcp), get: tcp[3] };
  }
  var CAP = webCapture();
  var NOTES = "# Packet notes for ~/captures/one-packet.pcap\n# Replace each ? with what tcpdump shows. Keep the labels.\nL2 source MAC: ?\nL3 destination IP: ?\nL3 TTL: ?\nL4 destination port: ?\nL7 request line: ?\n";
  LABS.push({
    id: "net-101", n: 1, module: 1, ticket: "NET-101", xp: 100, layer: "L1–7",
    title: "Take a packet apart",
    topic: "OSI layers, encapsulation, tcpdump -r -n -e -v -X",
    from: MAYA,
    story: "<p>Welcome to the network side of Kestrel. Before we fix anything, you need to be able to <b>see</b> traffic. Yesterday I captured kc-web-01 fetching <code>http://example.com/</code>: it's in <code>~/captures/web-request.pcap</code>, and the single packet that carries the request is in <code>~/captures/one-packet.pcap</code>.</p><p>Read them, take that one packet apart header by header, and fill in <code>~/packet-notes.txt</code>. The panel above the terminal will draw each packet you look at.</p>",
    learn:
      "<h3>Layers</h3><p>Networking is split into <b>layers</b>. Each layer does one job and only talks to the layers next to it. The OSI model names seven:</p>" +
      '<table class="t"><tr><th>#</th><th>Layer</th><th>Job</th><th>Here you meet</th></tr>' +
      "<tr><td>7</td><td>Application</td><td>what the programs say</td><td>HTTP, DNS, SSH</td></tr><tr><td>6</td><td>Presentation</td><td>encoding and encryption</td><td>TLS, gzip, UTF-8</td></tr><tr><td>5</td><td>Session</td><td>keeping a conversation going</td><td>TLS sessions</td></tr>" +
      "<tr><td>4</td><td>Transport</td><td>which program gets the data: <b>ports</b></td><td>TCP, UDP</td></tr><tr><td>3</td><td>Network</td><td>getting across networks: <b>IP addresses</b>, routing</td><td>IPv4, IPv6, ICMP</td></tr>" +
      "<tr><td>2</td><td>Data link</td><td>getting to the next box on this network: <b>MAC addresses</b></td><td>Ethernet, ARP, VLANs</td></tr><tr><td>1</td><td>Physical</td><td>bits on a wire or radio</td><td>cables, link lights, speed</td></tr></table>" +
      "<p>The internet itself uses the simpler <b>TCP/IP model</b>: application (OSI 5 to 7), transport (4), internet (3) and link (1 and 2). People still say \"a layer 7 problem\" or \"it's layer 2\", so learn the OSI numbers.</p>" +
      "<h3>Encapsulation</h3><p>When curl sends <code>GET /</code>, every layer on the way down wraps the data in its own <b>header</b>: TCP adds ports (a <i>segment</i>), IP adds addresses (a <i>packet</i>), Ethernet adds MAC addresses (a <i>frame</i>). The receiver unwraps them in the opposite order. Routers only look as far as the IP header; switches only as far as Ethernet.</p>" +
      code("[ Ethernet: dst MAC | src MAC | type ][ IP: src | dst | TTL ][ TCP: ports | flags ][ HTTP: GET / ... ]") +
      "<h3>Reading a capture with tcpdump</h3><p><code>tcpdump</code> captures packets (that needs root) or reads a saved capture file with <code>-r</code> (that doesn't):</p>" +
      ex("tcpdump -r ~/captures/web-request.pcap") +
      '<table class="t"><tr><th>Option</th><th>Shows</th></tr><tr><td><code>-n</code></td><td>numbers: IPs and ports instead of names (faster, and nothing is hidden)</td></tr><tr><td><code>-e</code></td><td>the Ethernet header: MAC addresses</td></tr><tr><td><code>-v</code>, <code>-vv</code></td><td>more of the IP header: TTL, ID, flags, checksums</td></tr><tr><td><code>-X</code></td><td>the raw bytes in hex and ASCII</td></tr><tr><td><code>-c 5</code></td><td>stop after 5 packets</td></tr></table>' +
      "<p>Each line is one packet: time, source <code>IP.port</code>, <code>&gt;</code>, destination, then what's inside. You can add a <b>filter</b> at the end to keep only some packets:</p>" + ex("tcpdump -r ~/captures/web-request.pcap -n port 53") +
      "<p>Filters combine words like <code>host 10.20.0.21</code>, <code>port 80</code>, <code>tcp</code>, <code>udp</code>, <code>icmp</code>, <code>arp</code> with <code>and</code>, <code>or</code>, <code>not</code>.</p>" +
      '<div class="callout">Watch the <b>Packet</b> tab above the terminal: after <code>tcpdump</code> it shows the packet as nested layers, and hovering a layer lights up its bytes.</div>',
    files: {
      "captures/web-request.pcap": N.pcapFile(CAP.all),
      "captures/one-packet.pcap": N.pcapFile([CAP.get]),
      "packet-notes.txt": NOTES
    },
    starter: "",
    objectives: [
      {
        id: "read", text: "Read <code>~/captures/web-request.pcap</code> with numeric addresses and ports (<code>-n</code>).",
        hints: ["tcpdump -r FILE reads a capture; -n turns off name lookups.", "tcpdump -r ~/captures/web-request.pcap -n"],
        check: function (r) { return ran(r, /\btcpdump\b.*web-request\.pcap/, function (e) { return outHas(e, /IP 10\.20\.0\.15\.51822 > 93\.184\.215\.14\.80: Flags \[S\]/); }) ? true : "Read the file with tcpdump -r and -n: you should see 10.20.0.15.51822 > 93.184.215.14.80 lines."; }
      },
      {
        id: "filter", text: "Show only the web traffic in it: add a filter for <b>TCP port 80</b>, so the DNS lookup disappears.",
        hints: ["Put the filter after the options: tcp port 80 (or just port 80).", "tcpdump -r ~/captures/web-request.pcap -n tcp port 80"],
        check: function (r) { return ran(r, /\btcpdump\b.*web-request\.pcap/, function (e) { return outHas(e, /HTTP: GET \/ HTTP\/1\.1/) && !outHas(e, /\.53[: ]/) && e.out.length >= 8; }) ? true : "Filter the capture to port 80: the GET request should be there, the two DNS packets (port 53) gone."; }
      },
      {
        id: "full", text: "Open <code>~/captures/one-packet.pcap</code> showing every layer at once: the Ethernet header (<code>-e</code>), the IP details (<code>-v</code>) and the hex dump (<code>-X</code>).",
        hints: ["Options can be combined: -e -v -X, or -evX. Add -n too.", "tcpdump -r ~/captures/one-packet.pcap -n -e -v -X"],
        check: function (r) { return ran(r, /\btcpdump\b.*one-packet\.pcap/, function (e) { return outHas(e, /ethertype IPv4/) && outHas(e, /ttl 64/) && outHas(e, /0x0000:/); }) ? true : "One command on one-packet.pcap that shows the MACs (-e), the TTL (-v) and the hex (-X)."; }
      },
      {
        id: "notes", text: "Fill in <code>~/packet-notes.txt</code> from that packet: its source MAC, destination IP, TTL, destination port and the HTTP request line.",
        hints: ["nano ~/packet-notes.txt. The source MAC is the first address after the time with -e; TTL is in the (tos ..., ttl N, ...) part; the request line is what follows HTTP:.", "L2 source MAC: 52:54:00:4e:1a:07\nL3 destination IP: 93.184.215.14\nL3 TTL: 64\nL4 destination port: 80\nL7 request line: GET / HTTP/1.1"],
        check: function (r) {
          var t = r.read("packet-notes.txt") || "";
          var want = [["L2 source MAC", /^52:54:00:4e:1a:07$/i, "the source MAC (the first MAC after the time, with -e)"], ["L3 destination IP", /^93\.184\.215\.14$/, "the destination IP"], ["L3 TTL", /^64$/, "the TTL (shown with -v)"], ["L4 destination port", /^80$/, "the destination port (after the last dot of the destination)"], ["L7 request line", /^GET \/ HTTP\/1\.1$/i, "the request line (GET / HTTP/1.1)"]];
          for (var i = 0; i < want.length; i++) { var v = lineOf(t, new RegExp("^" + want[i][0] + ":\\s*(.*)$", "i")); if (v === null) return "Keep the line \"" + want[i][0] + ": ...\" in the file."; if (!want[i][1].test(v)) return "Check " + want[i][2] + ": you wrote \"" + v + "\"."; }
          return true;
        }
      }
    ],
    solution: lines("tcpdump -r ~/captures/web-request.pcap -n", "tcpdump -r ~/captures/web-request.pcap -n tcp port 80", "tcpdump -r ~/captures/one-packet.pcap -n -e -v -X", "nano ~/packet-notes.txt", "    # Packet notes for ~/captures/one-packet.pcap", "    L2 source MAC: 52:54:00:4e:1a:07", "    L3 destination IP: 93.184.215.14", "    L3 TTL: 64", "    L4 destination port: 80", "    L7 request line: GET / HTTP/1.1"),
    debrief: "<p>Ticket closed. One packet, four headers: Ethernet carried it to the router (destination MAC <code>52:54:00:12:35:02</code> is kc-gw-01, not example.com: MACs only matter on the local network), IP carried it across the internet (TTL 64, going down by one at every router), TCP picked port 80 on the far end, and HTTP is the request itself.</p><p>Notice the order in the capture: a <b>DNS</b> lookup first (UDP port 53), then the TCP <b>handshake</b> (S, S., .), then data. Every lab in this module climbs one of those layers.</p>",
    realworld: "On your own Linux machine: sudo tcpdump -i any -n -c 20 while you open a web page. On Windows or macOS, Wireshark does the same with a GUI and reads the same .pcap files.",
    quiz: [
      { q: "Which layer do MAC addresses belong to?", options: ["Layer 1", "Layer 2", "Layer 3", "Layer 4"], answer: 1, why: "MACs are data-link addresses: they only get a frame to the next box on the same network." },
      { q: "The destination MAC in the packet was the router's, not example.com's. Why?", options: ["A bug in tcpdump", "Frames only travel to the next hop; IP carries the real destination", "example.com has no MAC", "ARP was wrong"], answer: 1, why: "Off the local network, frames go to the gateway's MAC; the IP header keeps the final destination." },
      { q: "Which option shows the raw bytes of a packet?", options: ["-n", "-e", "-v", "-X"], answer: 3, why: "-X prints hex and ASCII; -XX includes the Ethernet header too." }
    ]
  });

  /* ================================================================== NET-102 Layer 1: Physical */
  function movedCable(sys) {
    var nw = sys.nw;
    nw.ifs.eth1 = N.nic("eth1", W.MY_MAC2, "sw-core-01/15", 3, "enp0s4");
    nw.ifs.eth1.admin = false;
    nw.ifs.eth1.stats = { rxB: 0, rxP: 0, rxE: 0, rxD: 0, txB: 0, txP: 0, txE: 0, coll: 0, crc: 0 };
    nw.ifs.eth0.cable = false;
    nw.sw["sw-core-01/15"] = { autoneg: false, speed: 100, duplex: "full", maxSpeed: 1000 };
    M2.jadd(sys, "kernel", null, "virtio_net virtio0 eth0: Link is Down", null, 6, NOW - 9 * HOUR);
  }
  LABS.push({
    id: "net-102", n: 2, module: 1, ticket: "NET-102", xp: 120, layer: "L1",
    title: "The cable that moved",
    topic: "ip link, NO-CARRIER, ethtool, speed and duplex",
    from: MAYA,
    story: "<p>kc-web-01 dropped off the network at 00:14. The data-centre team says port 14 on the switch died last night, so they moved its cable to <b>port 15</b>, which is wired to the server's second network card. Since then: nothing.</p><p>You're on the server's console. Find which card has a link, move the network settings to it, and make sure the link is actually healthy, not just up.</p>",
    learn:
      "<h3>Layer 1: is there a link?</h3><p>Before addresses or routes matter, a network card needs a working <b>link</b>: a cable plugged in at both ends, a switch port that's on, and both sides agreeing on speed and duplex. Linux calls the presence of a link <b>carrier</b>.</p>" +
      ex("ip -br link") + ex("ip link show eth0") +
      '<table class="t"><tr><th>You see</th><th>Means</th></tr><tr><td><code>UP,LOWER_UP</code>, state <code>UP</code></td><td>turned on and the link is there</td></tr><tr><td><code>NO-CARRIER</code>, state <code>DOWN</code></td><td>turned on, but no link: cable, switch port or the card</td></tr><tr><td>no <code>UP</code> at all</td><td>turned off by an admin: <code>sudo ip link set eth1 up</code></td></tr></table>' +
      "<h3>ethtool: what the card negotiated</h3>" + ex("ethtool eth0") +
      "<p>Look at three lines: <b>Speed</b>, <b>Duplex</b> and <b>Link detected</b>. <i>Full duplex</i> sends and receives at the same time; <i>half duplex</i> takes turns, like a walkie-talkie. Both ends normally <b>auto-negotiate</b> the best common setting.</p>" +
      '<div class="callout warn">The classic trap: one side is forced (say 100 Mb/s full duplex), the other auto-negotiates. The auto side can\'t negotiate with a forced port, so it guesses <b>half duplex</b>. The link is \"up\", but packets collide and get lost. That\'s a <b>duplex mismatch</b>: errors in <code>ip -s link</code>, packet loss in ping. Fix it by making both sides match.</div>' +
      ex("ip -s link show eth0") +
      code("sudo ethtool -s eth1 speed 100 duplex full autoneg off   # force it to match a forced switch port\nsudo ethtool -s eth1 autoneg on                          # or let both sides negotiate") +
      "<h3>Where the settings live: netplan</h3><p>Ubuntu keeps its network settings in YAML files in <code>/etc/netplan/</code> (readable only by root). The interface name is a key in the file:</p>" +
      code("network:\n  version: 2\n  ethernets:\n    eth0:\n      addresses:\n        - 10.20.0.15/24\n      routes:\n        - to: default\n          via: 10.20.0.1") +
      "<p>After editing, <code>sudo netplan apply</code> makes it live. YAML is picky: spaces, never tabs, and the indentation is the structure.</p>",
    system: movedCable,
    starter: "",
    objectives: [
      {
        id: "links", text: "List the network links and spot the one with <b>no carrier</b>.",
        hints: ["ip link (or ip -br link) shows every interface and its state.", "ip -br link"],
        check: function (r) { return ran(r, /\bip\b.*\bl(ink)?\b/, function (e) { return outHas(e, /eth0.*NO-CARRIER|^eth0\s+DOWN/); }) ? true : "Show the links with ip link: eth0 should say NO-CARRIER."; }
      },
      {
        id: "eth0", text: "Ask eth0's card directly whether it detects a link.",
        hints: ["ethtool INTERFACE prints the physical settings; the last line answers the question.", "ethtool eth0"],
        check: function (r) { return ran(r, /\bethtool\s+eth0\b/, function (e) { return outHas(e, /Link detected: no/); }) ? true : "Run ethtool on eth0 and find \"Link detected: no\"."; }
      },
      {
        id: "eth1", text: "eth1 is switched off. Turn it on, then check with ethtool that <b>it</b> has a link.",
        hints: ["ip link set DEV up needs sudo. Then ethtool eth1.", "sudo ip link set eth1 up\nethtool eth1"],
        check: function (r) {
          if (!nw(r).ifs.eth1.admin) return "Turn eth1 on: sudo ip link set eth1 up.";
          return ran(r, /\bethtool\s+eth1\b/, function (e) { return outHas(e, /Link detected: yes/); }) ? true : "Now confirm the link with ethtool eth1 (Link detected: yes).";
        }
      },
      {
        id: "move", text: "Move the network settings from eth0 to eth1 in <code>/etc/netplan/01-kestrel.yaml</code> and apply them. kc-gw-01 (10.20.0.1) must answer a ping.",
        hints: ["Only the interface name changes: eth0: becomes eth1:. Edit with sudo nano, or sed, then sudo netplan apply.", "sudo sed -i 's/eth0:/eth1:/' /etc/netplan/01-kestrel.yaml\nsudo netplan apply\nping -c 4 10.20.0.1"],
        check: function (r) {
          var d = nw(r).ifs.eth1;
          if (!d.addrs.some(function (a) { return a.ip === ME && a.prefix === 24; })) return /eth1:/.test(npText(r)) ? "eth1 still has no address: apply the file with sudo netplan apply." : "Change eth0: to eth1: in the netplan file.";
          if (!N.reach(r.sys, "10.20.0.1", { quiet: true }).ok) return "eth1 has the address, but the gateway doesn't answer yet. Is eth0 still in the file too?";
          return ran(r, /\bping\b.*(10\.20\.0\.1|kc-gw-01)\b/, function (e) { return / [1-9]\d* received/.test(e.out.join("\n")); }) ? true : "Ping kc-gw-01 (10.20.0.1) to prove it.";
        }
      },
      {
        id: "duplex", text: "Ping loses packets. Find out why with <code>ethtool</code> and the error counters (<code>ip -s link</code>), fix the link so it matches the switch port (forced to <b>100 Mb/s full duplex</b>), and ping again with <b>0% loss</b>.",
        hints: ["ethtool eth1 says Duplex: Half. The switch port is forced, so force eth1 to the same: speed 100, duplex full, autoneg off.", "ip -s link show eth1\nsudo ethtool -s eth1 speed 100 duplex full autoneg off\nping -c 4 10.20.0.1"],
        check: function (r) {
          var l = N.linkOf(nw(r), nw(r).ifs.eth1);
          if (!l.carrier) return "eth1 has no link: if you forced a speed, it must match the switch port (100).";
          if (l.mismatch) return "eth1 still runs at " + l.speed + " Mb/s " + l.duplex + " duplex against a port forced to 100 full: that's the mismatch.";
          if (!ran(r, /\bip\b.*-s.*\blink\b|\bethtool\s+-S\b/)) return "Look at the error counters too (ip -s link show eth1): that's how you'd spot this on a busy server.";
          var k = lastIdx(r, /\bethtool\s+-s\b/);
          return after(r, k, /\bping\b/, loss0) ? true : "Ping again after the fix: 0% packet loss.";
        }
      }
    ],
    solution: lines("ip -br link", "ethtool eth0", "sudo ip link set eth1 up", "ethtool eth1", "sudo sed -i 's/eth0:/eth1:/' /etc/netplan/01-kestrel.yaml", "sudo netplan apply", "ping -c 4 10.20.0.1", "ethtool eth1", "ip -s link show eth1", "sudo ethtool -s eth1 speed 100 duplex full autoneg off", "ping -c 4 10.20.0.1"),
    debrief: "<p>Ticket closed. Two layer 1 problems in one: the cable was on a card with no config, and once it worked, the link was <b>up but bad</b> because the switch port is forced to 100/full while eth1 auto-negotiated and fell back to half duplex. Neither shows up in <code>ip a</code>; both show up in <code>ethtool</code> and the error counters.</p><p>The real fix is to ask the network team to set the port to auto, then set eth1 back to <code>autoneg on</code>. Until then, the forced setting is lost at reboot: a <code>.link</code> file in <code>/etc/systemd/network/</code> can make it permanent.</p>",
    realworld: "Run ethtool on any wired Linux machine; on Windows, Get-NetAdapter | Format-List Name,LinkSpeed,FullDuplex shows the same. Slow file copies on an office PC are still caused by duplex mismatches today.",
    quiz: [
      { q: "<code>ip link</code> shows <code>NO-CARRIER</code>. Which layer is the problem on?", options: ["Layer 1", "Layer 3", "Layer 4", "Layer 7"], answer: 0, why: "No carrier means no physical link: cable, port or card." },
      { q: "One side forced to 100/full, the other auto-negotiating. What happens?", options: ["The link stays down", "The auto side picks half duplex and you get errors", "Both pick 1000/full", "Nothing, it works"], answer: 1, why: "Auto-negotiation can't talk to a forced port, so it falls back to half duplex: a duplex mismatch." },
      { q: "Which command shows a card's speed and duplex?", options: ["ip a", "ss -t", "ethtool", "netplan get"], answer: 2, why: "ethtool talks to the network card's driver." }
    ]
  });

  /* ================================================================== NET-103 Layer 2: Data link */
  var IMPOSTOR = "3c:52:82:11:9a:f0", IMPOSTOR2 = "b8:27:eb:44:10:02";
  function dupDb(mac) {
    return function (sys) {
      sys.nw.dups["10.20.0.21"] = mac;
      sys.nw.ambientExtra = function (s, t) { return [P.arpReq(t + 0.05, W.MY_MAC, ME, "10.20.0.21"), P.arpRep(t + 0.0506, W.MAC.db, "10.20.0.21", W.MY_MAC, ME), P.arpRep(t + 0.0509, mac, "10.20.0.21", W.MY_MAC, ME)]; };
      M2.jadd(sys, "kernel", null, "IPv4: martian source 10.20.0.21 from 10.20.0.21, on dev eth0", null, 4, NOW - 40 * 60000);
    };
  }
  LABS.push({
    id: "net-103", n: 3, module: 1, ticket: "NET-103", xp: 130, layer: "L2",
    title: "Two machines, one address",
    topic: "MAC addresses, ARP, ip neigh, arping, VLANs",
    from: DEV,
    story: "<p>Since about 08:20 the app's database connections to <b>kc-db-01</b> (10.20.0.21) fail every few seconds, then work again. kc-db-01 itself looks fine. My bet: something else on the server LAN is answering for that address. Find the impostor's MAC and who made its network card, and keep kc-web-01 talking to the real database until facilities finds the device.</p><p>Second job while you're there: backups are moving to the storage VLAN 30. Give kc-web-01 a leg in it.</p>",
    learn:
      "<h3>MAC addresses</h3><p>Every network card has a 48-bit <b>MAC address</b>, written as six hex bytes: <code>52:54:00:4e:1a:07</code>. The first three bytes are the <b>OUI</b>, the maker's ID (52:54:00 is QEMU's virtual card; real vendors are listed in <code>/usr/share/ieee-data/oui.txt</code>, written like <code>3C-52-82</code>). Switches forward frames by MAC address, inside one network.</p>" + ex("ip link show eth0") +
      "<h3>ARP: from IP to MAC</h3><p>To send to 10.20.0.21 on the local network, kc-web-01 needs its MAC. It broadcasts an <b>ARP request</b>, \"who has 10.20.0.21? tell 10.20.0.15\", and the owner replies with its MAC. Answers are cached in the <b>neighbour table</b>:</p>" + ex("ip neigh") +
      '<table class="t"><tr><th>State</th><th>Means</th></tr><tr><td><code>REACHABLE</code></td><td>confirmed recently</td></tr><tr><td><code>STALE</code></td><td>known, will be re-checked on next use</td></tr><tr><td><code>FAILED</code></td><td>nobody answered ARP</td></tr><tr><td><code>PERMANENT</code></td><td>set by hand, never changes</td></tr></table>' +
      "<p><code>arping</code> sends ARP requests and prints every reply, with the MAC that sent it. It's in the <code>iputils-arping</code> package:</p>" + ex("arping -c 3 10.20.0.1") +
      '<div class="callout warn">If two different MACs answer for one IP, you have a <b>duplicate IP</b>: whichever answered last wins in everyone\'s ARP cache, so traffic flips between the real machine and the impostor. (An attacker doing this on purpose is ARP spoofing: Module 3.)</div>' +
      "<p>A static entry pins an IP to a MAC until reboot, a common stopgap:</p>" + code("sudo ip neigh replace 10.20.0.21 lladdr 52:54:00:9c:41:7e dev eth0 nud permanent") +
      "<h3>VLANs</h3><p>A <b>VLAN</b> splits one switch into several separate layer 2 networks. A port can carry several VLANs at once by <b>tagging</b> each frame with a VLAN ID (802.1Q). Linux reaches a tagged VLAN through a sub-interface:</p>" +
      code("sudo ip link add link eth0 name eth0.30 type vlan id 30\nsudo ip addr add 10.20.30.15/24 dev eth0.30\nsudo ip link set eth0.30 up") +
      "<p><code>ip -d link show eth0.30</code> shows the VLAN ID. Port 14 carries VLANs 20 (management) and 30 (storage).</p>",
    system: dupDb(IMPOSTOR),
    diagram: ["backup"],
    starter: "",
    objectives: [
      {
        id: "mymac", text: "Show kc-web-01's own MAC address on eth0.",
        hints: ["ip link show eth0: the address after link/ether.", "ip link show eth0"],
        check: function (r) { return ran(r, /\b(ip|ifconfig|cat)\b/, function (e) { return outHas(e, /52:54:00:4e:1a:07/) && !/neigh/.test(e.cmd); }) ? true : "Show eth0's MAC address (ip link show eth0)."; }
      },
      {
        id: "neigh", text: "Look at the neighbour (ARP) table. Which MAC does kc-web-01 have for 10.20.0.21 right now?",
        hints: ["ip neigh (short for neighbour).", "ip neigh"],
        check: function (r) { return ran(r, /\bip\b.*\bn(eigh(bou?r)?)?\b/, function (e) { return outHas(e, /10\.20\.0\.21 dev eth0/); }) ? true : "Show the neighbour table with ip neigh."; }
      },
      {
        id: "arping", text: "Install <code>arping</code> and ARP for 10.20.0.21. Show every MAC that answers.",
        hints: ["sudo apt install iputils-arping. Then arping with a count, e.g. -c 3.", "sudo apt install -y iputils-arping\narping -c 3 10.20.0.21"],
        check: function (r) { return NH.printedIn(r, function (x) { return [x.sys.nw.dups["10.20.0.21"].toUpperCase(), W.MAC.db.toUpperCase()]; }, { system: dupDb(IMPOSTOR2) }, function (e) { return /\barping\b/.test(e.cmd); }, "arping 10.20.0.21 should show two different MACs answering.", "Ask the network (arping), don't type the MAC: on another day the impostor has another MAC."); }
      },
      {
        id: "oui", text: "Which company made the impostor's network card? Look its first three bytes up in <code>/usr/share/ieee-data/oui.txt</code>.",
        hints: ["The file writes OUIs in capitals with dashes: 3C-52-82. grep -i for it.", "grep -i 3C-52-82 /usr/share/ieee-data/oui.txt"],
        check: function (r) { return ran(r, /oui\.txt/, function (e) { return outHas(e, /Hewlett Packard/); }) ? true : "Search oui.txt for the impostor's OUI (its first three bytes, written like 3C-52-82)."; }
      },
      {
        id: "pin", text: "Pin 10.20.0.21 to the real database's MAC (<code>52:54:00:9c:41:7e</code>) with a permanent neighbour entry, then ping kc-db-01 with <b>0% loss</b>.",
        hints: ["ip neigh replace IP lladdr MAC dev eth0 nud permanent (with sudo).", "sudo ip neigh replace 10.20.0.21 lladdr 52:54:00:9c:41:7e dev eth0 nud permanent\nping -c 4 10.20.0.21"],
        check: function (r) {
          var n = nw(r).neigh["10.20.0.21"];
          if (!n || !n.perm) return "Add a permanent entry for 10.20.0.21 (ip neigh replace ... nud permanent).";
          if (n.mac !== W.MAC.db) return "That entry points at " + n.mac + ": pin the real database's MAC, 52:54:00:9c:41:7e.";
          var k = lastIdx(r, /\bip\b.*\bneigh\b.*\b(add|replace|change)\b/);
          return after(r, k, /\bping\b.*(10\.20\.0\.21|kc-db-01)/, loss0) ? true : "Ping kc-db-01 again: 0% packet loss now.";
        }
      },
      {
        id: "vlan", text: "Create <code>eth0.30</code> on <b>VLAN 30</b> with the address <code>10.20.30.15/24</code>, bring it up, and ping kc-backup-01's storage address <code>10.20.30.31</code>.",
        hints: ["Three ip commands: link add ... type vlan id 30, addr add ... dev eth0.30, link set eth0.30 up.", "sudo ip link add link eth0 name eth0.30 type vlan id 30\nsudo ip addr add 10.20.30.15/24 dev eth0.30\nsudo ip link set eth0.30 up\nping -c 3 10.20.30.31"],
        check: function (r) {
          var d = nw(r).ifs["eth0.30"];
          if (!d || d.kind !== "vlan") return "Create the VLAN interface eth0.30 (ip link add link eth0 name eth0.30 type vlan id 30).";
          if (d.vid !== 30) return "eth0.30 is on VLAN " + d.vid + ": the storage VLAN is 30.";
          if (!d.addrs.some(function (a) { return a.ip === "10.20.30.15" && a.prefix === 24; })) return "Give eth0.30 the address 10.20.30.15/24.";
          if (!d.admin) return "Bring eth0.30 up.";
          return ran(r, /\bping\b.*10\.20\.30\.31/, function (e) { return / [1-9]\d* received/.test(e.out.join("\n")); }) ? true : "Ping 10.20.30.31 over the new VLAN.";
        }
      }
    ],
    solution: lines("ip link show eth0", "ip neigh", "sudo apt install -y iputils-arping", "arping -c 3 10.20.0.21", "grep -i 3C-52-82 /usr/share/ieee-data/oui.txt", "sudo ip neigh replace 10.20.0.21 lladdr 52:54:00:9c:41:7e dev eth0 nud permanent", "ping -c 4 10.20.0.21", "sudo ip link add link eth0 name eth0.30 type vlan id 30", "sudo ip addr add 10.20.30.15/24 dev eth0.30", "sudo ip link set eth0.30 up", "ping -c 3 10.20.30.31"),
    debrief: "<p>Ticket closed. arping showed it plainly: two MACs answering for 10.20.0.21, the real VM (52:54:00, QEMU) and an <b>HP</b> device. A laptop or printer someone gave a static address. Facilities found it: an HP printer set up with \"the IP from the old wiki page\".</p><p>The static ARP entry is a stopgap: it disappears at reboot and only protects kc-web-01. The fixes are DHCP reservations so nobody types addresses by hand, and on managed switches <b>DHCP snooping</b> and <b>dynamic ARP inspection</b>, which also stop ARP spoofing attacks (Module 3).</p>",
    realworld: "On your own machine: ip neigh (Linux), arp -a (Windows, macOS). Run it at home and you'll see your router's MAC; its OUI tells you the router's maker.",
    quiz: [
      { q: "What does ARP do?", options: ["Finds a route to a network", "Finds the MAC address for an IP on the local network", "Translates names to IPs", "Assigns IP addresses"], answer: 1, why: "ARP maps IPv4 addresses to MAC addresses on one layer 2 network." },
      { q: "arping gets replies from two different MACs for one IP. What is it?", options: ["Normal load balancing", "A duplicate IP (or ARP spoofing)", "A VLAN", "A broken cable"], answer: 1, why: "One IP should have one MAC on a LAN. Two answers means a conflict or an attack." },
      { q: "What does a VLAN tag (802.1Q) carry?", options: ["The VLAN ID", "The MAC address", "The TTL", "The port number"], answer: 0, why: "The tag says which VLAN the frame belongs to, so one cable can carry several." }
    ]
  });

  /* ================================================================== NET-104 Addresses & subnets */
  function wrongMask(prefix) { return function (sys) { setNetplan(sys, N.NETPLAN.replace("10.20.0.15/24", "10.20.0.15/" + prefix)); }; }
  LABS.push({
    id: "net-104", n: 4, module: 1, ticket: "NET-104", xp: 130, layer: "L3",
    title: "The monitoring server can't see us",
    topic: "IPv4, CIDR, netmasks, ipcalc, ip route get",
    from: MAYA,
    story: "<p>Since Friday's \"network tidy-up\", <b>kc-mon-01</b> (10.20.5.10, in the office network) marks kc-web-01 as down. Everything else works: the website, the database, the internet. Only the office network can't reach us, and we can't reach it.</p><p>Find out why, fix it, and while you're thinking in subnets, plan the new lab network for me.</p>",
    learn:
      "<h3>IPv4 addresses and prefixes</h3><p>An IPv4 address is 32 bits, written as four bytes: <code>10.20.0.15</code>. The <b>prefix</b> after the slash says how many leading bits are the <b>network</b> part; the rest identify the host. <code>10.20.0.15/24</code> means: network <code>10.20.0.x</code>, host <code>.15</code>.</p>" +
      '<table class="t"><tr><th>Prefix</th><th>Netmask</th><th>Addresses</th><th>Usable hosts</th></tr><tr><td>/24</td><td>255.255.255.0</td><td>256</td><td>254</td></tr><tr><td>/25</td><td>255.255.255.128</td><td>128</td><td>126</td></tr><tr><td>/26</td><td>255.255.255.192</td><td>64</td><td>62</td></tr><tr><td>/16</td><td>255.255.0.0</td><td>65 536</td><td>65 534</td></tr></table>' +
      "<p>In each network, the first address is the <b>network address</b> and the last is the <b>broadcast address</b>; neither can be given to a host. <code>ipcalc</code> works it all out (install it from the <code>ipcalc</code> package):</p>" + ex("ipcalc 10.20.0.15/24") +
      "<p>With a second prefix it splits a network into subnets: <code>ipcalc 10.20.40.0/24 26</code>.</p>" +
      "<h3>Why the prefix matters</h3><p>The prefix decides what the server thinks is <b>on its own network</b>. For those addresses it uses ARP and sends directly; for everything else it sends to the <b>gateway</b>. Ask the kernel which way it would go:</p>" + ex("ip route get 1.1.1.1") +
      "<p>If the answer has <code>via 10.20.0.1</code>, it goes through the router. If it only says <code>dev eth0</code>, the kernel believes the address is on the local network and will ARP for it.</p>" +
      '<div class="callout">Private ranges (not routed on the internet): <code>10.0.0.0/8</code>, <code>172.16.0.0/12</code>, <code>192.168.0.0/16</code>. Kestrel uses 10.20.0.0/24 for servers and 10.20.5.0/24 for the office.</div>',
    system: wrongMask(16),
    diagram: ["mon"],
    starter: "",
    objectives: [
      {
        id: "ipcalc", text: "Install <code>ipcalc</code> and run it on kc-web-01's address <b>with the prefix it has now</b> (check <code>ip a</code> first).",
        hints: ["ip -br a shows the address and prefix. Then ipcalc ADDRESS/PREFIX.", "ip -br a\nsudo apt install -y ipcalc\nipcalc 10.20.0.15/16"],
        check: function (r) { return ran(r, /\bipcalc\b.*10\.20\.0\.15\/16\b/, function (e) { return outHas(e, /Network:\s+10\.20\.0\.0\/16/); }) ? true : ran(r, /\bipcalc\b/) ? "Run ipcalc on the address and prefix eth0 has right now (ip -br a shows it)." : "Install ipcalc (sudo apt install ipcalc) and run it on kc-web-01's address/prefix."; }
      },
      {
        id: "route", text: "Ask the kernel which route it uses to reach kc-mon-01 (10.20.5.10).",
        hints: ["ip route get ADDRESS.", "ip route get 10.20.5.10"],
        check: function (r) { return ran(r, /\bip\b.*\br(oute)?\b.*\bget\b.*10\.20\.5\.10/, function (e) { return outHas(e, /10\.20\.5\.10 dev eth0/); }) ? true : "Use ip route get 10.20.5.10: notice there's no \"via\"."; }
      },
      {
        id: "arp", text: "Ping 10.20.5.10, then look at the neighbour table: kc-web-01 tried to find it with ARP, as if it were next door.",
        hints: ["ping -c 2 10.20.5.10, then ip neigh.", "ping -c 2 10.20.5.10\nip neigh"],
        check: function (r) { return ran(r, /\bip\b.*\bneigh\b/, function (e) { return outHas(e, /10\.20\.5\.10 dev eth0\s+FAILED/); }) ? true : "Ping 10.20.5.10 first, then ip neigh: you'll see a FAILED entry for it."; }
      },
      {
        id: "fix", text: "The servers' network is <code>10.20.0.0/24</code>. Fix the prefix in <code>/etc/netplan/01-kestrel.yaml</code> and apply it.",
        hints: ["Change /16 to /24 on the addresses line (sudo nano or sed), then sudo netplan apply.", "sudo sed -i 's#10.20.0.15/16#10.20.0.15/24#' /etc/netplan/01-kestrel.yaml\nsudo netplan apply"],
        check: function (r) {
          if (!/10\.20\.0\.15\/24/.test(npText(r))) return "The netplan file should say 10.20.0.15/24.";
          return nw(r).ifs.eth0.addrs.some(function (a) { return a.ip === ME && a.prefix === 24; }) ? true : "The file is right; now apply it (sudo netplan apply).";
        }
      },
      {
        id: "prove", text: "Prove it: <code>ip route get 10.20.5.10</code> now goes <b>via</b> the gateway, and kc-mon-01 answers a ping.",
        hints: ["Run both again.", "ip route get 10.20.5.10\nping -c 2 10.20.5.10"],
        check: function (r) {
          var k = lastIdx(r, /\bnetplan\s+apply\b/);
          if (!after(r, k, /\bip\b.*\bget\b.*10\.20\.5\.10/, function (e) { return outHas(e, /via 10\.20\.0\.1/); })) return "Ask ip route get 10.20.5.10 again, after the fix: it should go via 10.20.0.1.";
          return after(r, k, /\bping\b.*(10\.20\.5\.10|kc-mon-01)/, function (e) { return / [1-9]\d* received/.test(e.out.join("\n")); }) ? true : "And ping 10.20.5.10: it answers now.";
        }
      },
      {
        id: "plan", text: "Plan: split <code>10.20.40.0/24</code> into <b>four equal subnets</b> with ipcalc and write their network addresses with prefix, one per line, to <code>~/subnets.txt</code>.",
        hints: ["Four subnets of a /24 are /26s: ipcalc 10.20.40.0/24 26. Copy the four Network: values.", "ipcalc -b 10.20.40.0/24 26\nnano ~/subnets.txt\n(10.20.40.0/26, 10.20.40.64/26, 10.20.40.128/26, 10.20.40.192/26)"],
        check: function (r) {
          var got = L(r.read("subnets.txt") || "").map(function (l) { return l.trim(); }).filter(Boolean);
          var want = ["10.20.40.0/26", "10.20.40.64/26", "10.20.40.128/26", "10.20.40.192/26"];
          if (!ran(r, /\bipcalc\b.*10\.20\.40\.0\/24\s+(\/?26|255\.255\.255\.192)/)) return "Let ipcalc do the splitting: ipcalc 10.20.40.0/24 26.";
          return SH.same(got, want) ? true : "~/subnets.txt should have the four /26 networks, one per line, in order (it has: " + (got.join(", ") || "nothing") + ").";
        }
      }
    ],
    solution: lines("ip -br a", "sudo apt install -y ipcalc", "ipcalc 10.20.0.15/16", "ip route get 10.20.5.10", "ping -c 2 10.20.5.10", "ip neigh", "sudo sed -i 's#10.20.0.15/16#10.20.0.15/24#' /etc/netplan/01-kestrel.yaml", "sudo netplan apply", "ip route get 10.20.5.10", "ping -c 2 10.20.5.10", "ipcalc -b 10.20.40.0/24 26", "nano ~/subnets.txt", "    10.20.40.0/26", "    10.20.40.64/26", "    10.20.40.128/26", "    10.20.40.192/26"),
    debrief: "<p>Ticket closed. With <code>/16</code>, kc-web-01 believed the whole of 10.20.0.0 to 10.20.255.255 was on its own cable, including the office's 10.20.5.0/24. So instead of handing those packets to the router, it shouted ARP requests nobody could answer. Everything else worked, which is what made it hard to see: the gateway, the database and the internet were all still where the server expected.</p><p>A prefix that's too <b>big</b> breaks traffic to nearby networks; one that's too <b>small</b> breaks traffic to your own neighbours. Either way, <code>ip route get</code> tells you what the kernel will do.</p>",
    realworld: "Check your own machine: ip -br a (or ipconfig on Windows), then ipcalc the address. Most home networks are a /24 such as 192.168.1.0/24.",
    quiz: [
      { q: "How many usable host addresses does a /26 have?", options: ["64", "62", "126", "30"], answer: 1, why: "64 addresses minus the network and broadcast addresses." },
      { q: "<code>ip route get X</code> shows no <code>via</code>. What does the kernel think?", options: ["X is on the local network: it will ARP for it", "X is unreachable", "X is the gateway", "X is on the internet"], answer: 0, why: "No via means directly connected: frames go straight to X's MAC." },
      { q: "Which range is private?", options: ["8.8.8.0/24", "172.20.0.0/16", "100.0.0.0/8", "203.0.113.0/24"], answer: 1, why: "172.16.0.0/12 covers 172.16 to 172.31." }
    ]
  });

  /* ================================================================== NET-105 IPv6 */
  function v6off(name) { return function (sys) { M2.putRoot(sys, "/etc/sysctl.d/" + name, "# Turned off while debugging the 2019 VPN outage. Re-enable when done. -- contractor\nnet.ipv6.conf.all.disable_ipv6 = 1\nnet.ipv6.conf.default.disable_ipv6 = 1\n", 420, 0, 0, Date.UTC(2019, 5, 14)); }; }
  function v6disabledAnywhere(r) {
    var d = r.node("/etc/sysctl.d"), files = ["/etc/sysctl.conf"].concat(d ? Object.keys(d.children).map(function (n) { return "/etc/sysctl.d/" + n; }) : []);
    return files.filter(function (p) { return /\.conf$/.test(p) && /^\s*net\.ipv6\.conf\.\w+\.disable_ipv6\s*=\s*1/m.test(r.read(p) || ""); });
  }
  LABS.push({
    id: "net-105", n: 5, module: 1, ticket: "NET-105", xp: 130, layer: "L3",
    title: "Turn IPv6 back on",
    topic: "IPv6 addresses, link-local, SLAAC, sysctl, dual stack",
    from: DEV,
    story: "<p>Our ISP gave us IPv6 a while ago and kc-gw-01 announces it on the server LAN, but kc-web-01 has no IPv6 at all. Somebody turned it off years ago and nobody remembers why.</p><p>Find what disabled it, turn it back on so it survives a reboot, and show me the server reaching the internet over IPv6.</p>",
    learn:
      "<h3>IPv6 addresses</h3><p>IPv6 addresses are 128 bits, written as eight groups of four hex digits: <code>2001:0db8:0020:0000:0000:0000:0000:0001</code>. Two rules shorten them: drop leading zeros in a group, and replace <b>one</b> run of all-zero groups with <code>::</code>. That one becomes <code>2001:db8:20::1</code>. Networks are almost always <code>/64</code>: 64 bits of network, 64 bits of host.</p>" +
      ex("ip -6 addr") +
      '<table class="t"><tr><th>Address</th><th>Scope</th><th>Where it comes from</th></tr><tr><td><code>::1</code></td><td>host</td><td>loopback, like 127.0.0.1</td></tr><tr><td><code>fe80::…</code></td><td>link</td><td>every IPv6 interface makes one itself; only valid on that one link</td></tr><tr><td><code>2001:db8:20::…</code></td><td>global</td><td>routable; here from <b>SLAAC</b></td></tr></table>' +
      "<h3>SLAAC: no DHCP needed</h3><p>Routers send <b>router advertisements</b>: \"the prefix here is 2001:db8:20::/64, I'm your gateway\". The host combines that prefix with an ID made from its MAC (the <b>EUI-64</b>: <code>52:54:00:4e:1a:07</code> becomes <code>5054:ff:fe4e:1a07</code>) and has a global address. Its IPv6 default route points at the router's <b>link-local</b> address.</p>" + ex("ip -6 route") +
      "<p>A link-local address is only meaningful on one link, so you must say which: <code>ping -6 fe80::1%eth0</code>.</p>" +
      "<h3>Kernel switches: sysctl</h3><p>Many network behaviours are kernel settings you read and change with <code>sysctl</code>. Settings in <code>/etc/sysctl.d/*.conf</code> are applied at boot:</p>" +
      ex("sysctl net.ipv6.conf.all.disable_ipv6") + code("sudo sysctl -w net.ipv6.conf.all.disable_ipv6=0   # change it now\nsudo sysctl --system                              # re-apply every file in /etc/sysctl.d") +
      '<div class="callout warn">Deleting a sysctl file doesn\'t change the running kernel: the old value stays until you set it or reboot. Fix the file <b>and</b> the live value.</div>' +
      "<h3>Dual stack</h3><p>Most servers run IPv4 and IPv6 side by side. A name with an <b>AAAA</b> record has an IPv6 address; programs try IPv6 first and fall back to IPv4. <code>curl -6</code> and <code>curl -4</code> force one.</p>",
    system: v6off("60-disable-ipv6.conf"),
    starter: "",
    objectives: [
      {
        id: "look", text: "Show the IPv6 addresses. (There are none: confirm it.)",
        hints: ["ip with -6 and the address object.", "ip -6 addr"],
        check: function (r) { return ran(r, /\bip\b.*-6.*\ba(ddr|ddress)?\b/) ? true : "Run ip -6 addr."; }
      },
      {
        id: "find", text: "Find the file that disables IPv6: search the sysctl settings for <code>disable_ipv6</code>.",
        hints: ["Boot-time sysctl settings live in /etc/sysctl.d. grep -r searches a folder.", "grep -r disable_ipv6 /etc/sysctl.d /etc/sysctl.conf"],
        check: function (r) { return NH.printedIn(r, function (x) { return [v6disabledAnywhereAtStart(x)]; }, { system: v6off("99-hardening.conf") }, function (e) { return /\bgrep\b|\bcat\b/.test(e.cmd); }, "Search for disable_ipv6 (grep -r disable_ipv6 /etc/sysctl.d): the output should name the file.", "Search, don't guess the file name: on another server it's called something else."); }
      },
      {
        id: "enable", text: "Turn IPv6 back on <b>for good</b>: fix that file so it no longer disables IPv6, and change the running kernel too.",
        hints: ["Edit the file to = 0 (then sudo sysctl --system applies it), or delete it and set the values with sudo sysctl -w.", "sudo sed -i 's/= 1/= 0/' /etc/sysctl.d/60-disable-ipv6.conf\nsudo sysctl --system"],
        check: function (r) {
          var bad = v6disabledAnywhere(r);
          if (bad.length) return bad[0] + " still sets disable_ipv6 = 1: IPv6 would be off again after a reboot.";
          return N.v6enabled(nw(r), nw(r).ifs.eth0) ? true : "The file is fixed, but the running kernel still has IPv6 disabled: sudo sysctl --system (if the file now says 0) or sudo sysctl -w net.ipv6.conf.all.disable_ipv6=0.";
        }
      },
      {
        id: "ll", text: "Look again: eth0 has a link-local and a global (SLAAC) address. Ping the router's link-local address, <code>fe80::1</code>, on eth0.",
        hints: ["ip -6 addr to see them. A link-local address needs the interface: fe80::1%eth0.", "ip -6 addr\nping -6 -c 2 fe80::1%eth0"],
        check: function (r) {
          if (!ran(r, /\bip\b.*-6.*\ba(ddr)?\b/, function (e) { return outHas(e, /inet6 fe80::5054:ff:fe4e:1a07/) && outHas(e, /2001:db8:20:0:5054:ff:fe4e:1a07/); })) return "Show the IPv6 addresses again now that it's on (ip -6 addr).";
          return ran(r, /\bping6?\b.*fe80::1%eth0/, function (e) { return / [1-9]\d* received/.test(e.out.join("\n")); }) ? true : "Ping fe80::1%eth0 (the %eth0 says which link).";
        }
      },
      {
        id: "dual", text: "Dual stack: look up example.com's IPv6 address (its <b>AAAA</b> record), then fetch <code>https://example.com/</code> forcing IPv6.",
        hints: ["dig with the AAAA type; curl with -6.", "dig AAAA example.com +short\ncurl -6 -sI https://example.com/"],
        check: function (r) {
          if (!ran(r, /\b(dig|host|nslookup)\b.*example\.com/, function (e) { return outHas(e, /2606:2800:21f:cb07:6820:80da:af6b:8b2c/); })) return "Look up example.com's AAAA record (dig AAAA example.com).";
          return ran(r, /\bcurl\b.*(-6|--ipv6).*example\.com|\bcurl\b.*example\.com.*(-6|--ipv6)/, function (e) { return outHas(e, /^HTTP\/2 200|Example Domain/); }) ? true : "Fetch https://example.com/ with curl -6.";
        }
      }
    ],
    solution: lines("ip -6 addr", "grep -r disable_ipv6 /etc/sysctl.d /etc/sysctl.conf", "sudo sed -i 's/= 1/= 0/' /etc/sysctl.d/60-disable-ipv6.conf", "sudo sysctl --system", "ip -6 addr", "ping -6 -c 2 fe80::1%eth0", "dig AAAA example.com +short", "curl -6 -sI https://example.com/"),
    debrief: "<p>Ticket closed. A five-year-old \"temporary\" sysctl file was the whole problem. As soon as IPv6 was allowed, eth0 made its own link-local address, heard kc-gw-01's router advertisement and built a global address from the prefix and its MAC: no DHCP, no config.</p><p>Security note: turning IPv6 on means the server is reachable over a second protocol. Firewall rules must cover <b>both</b> (Module 4 does exactly that), and kestrel.example.com still has no AAAA record, so customers reach it over IPv4 only for now.</p>",
    realworld: "Check your own connection: curl -6 https://ifconfig.co shows your IPv6 address if your ISP provides one; ip -6 addr (or ipconfig) shows your link-local fe80:: address either way.",
    quiz: [
      { q: "What's the short form of <code>2001:0db8:0000:0000:0000:0000:0000:0042</code>?", options: ["2001:db8::42", "2001:db8:0:42", "2001:db8::0042::", "2001:db8:42"], answer: 0, why: "Drop leading zeros and replace the longest run of zero groups with ::, once." },
      { q: "Where does a SLAAC address come from?", options: ["A DHCP server", "The router's advertised prefix plus an ID the host makes itself", "DNS", "The admin types it"], answer: 1, why: "Stateless address autoconfiguration: prefix from the router, host part from the host." },
      { q: "Why does <code>ping fe80::1</code> need <code>%eth0</code>?", options: ["It doesn't", "Link-local addresses exist on every link, so you must say which one", "To use IPv4", "To skip DNS"], answer: 1, why: "fe80:: addresses are only unique per link." }
    ]
  });
  function v6disabledAnywhereAtStart(r) { var s = r.run("").sys, d = S.lookup({ sys: s, uid: 0, gid: 0, groups: [], cwd: "/", umask: 18, vars: {} }, "/etc/sysctl.d").node; var name = Object.keys(d.children).filter(function (n) { return /disable_ipv6\s*=\s*1/.test(d.children[n].content || ""); })[0]; return name || "?"; }

  /* ================================================================== NET-106 Routing & NAT */
  function hasPartnerRoute(rt) { return rt.dst === "172.16.50.0" && rt.prefix === 24 && rt.via === "10.20.0.254"; }
  LABS.push({
    id: "net-106", n: 6, module: 1, ticket: "NET-106", xp: 130, layer: "L3",
    title: "A route to the partner",
    topic: "ip route, gateways, traceroute and TTL, NAT, private vs public",
    from: BEN,
    story: "<p>Our shipping partner, Northwind, opened a site-to-site VPN for us. Their API is at <code>172.16.50.10</code> (<code>partner-api.kestrel.internal</code>), reachable through our VPN router <b>kc-vpn-01</b> (10.20.0.254). From kc-web-01 it just times out. Can you make the app reach it, and make it stick?</p><p>Also: their firewall wants to know what address our requests come from. I told them 10.20.0.15. Was that right?</p>",
    learn:
      "<h3>Routing</h3><p>A host decides where each packet goes with its <b>routing table</b>: a list of networks and how to reach them. The most specific match wins; <code>default</code> (0.0.0.0/0) matches everything else.</p>" + ex("ip route") +
      code("default via 10.20.0.1 dev eth0 proto static          # everything else: to the router\n10.20.0.0/24 dev eth0 proto kernel scope link ...      # my own network: send directly") +
      "<p>You can add a route for one network through a different router. The gateway must be on a directly connected network:</p>" + code("sudo ip route add 172.16.50.0/24 via 10.20.0.254") +
      "<p>That lasts until reboot. To keep it, add it to netplan, as a second item under <code>routes:</code>.</p>" +
      "<h3>traceroute and TTL</h3><p>Every IP packet has a <b>TTL</b> (time to live). Each router subtracts one and drops the packet at zero, sending back an ICMP \"time exceeded\". <code>traceroute</code> uses that: TTL 1 shows the first router, TTL 2 the second, and so on. <code>* * *</code> means that hop didn't answer (some routers never do).</p>" +
      ex("traceroute -n example.com") +
      "<p>The TTL in ping replies tells you something too: Linux starts at 64, so a reply arriving with <code>ttl=57</code> crossed 7 routers.</p>" +
      "<h3>NAT: private inside, public outside</h3><p>10.20.0.15 is a private address: it can't be used on the internet. kc-gw-01 does <b>NAT</b> (network address translation): it rewrites the source of outgoing packets to its own public address, and the answers back. Ask a website what address it sees:</p>" + ex("curl ifconfig.me") +
      '<div class="callout"><b>BGP, briefly.</b> Inside our network, routes are typed by hand. Between the internet\'s networks they\'re exchanged automatically with <b>BGP</b>, and every network simply trusts what its neighbours announce. In 2008 Pakistan Telecom announced a more specific route for YouTube\'s addresses to block it locally; the announcement leaked, and for about two hours much of the world\'s YouTube traffic went to Pakistan. Route filtering and RPKI exist because of incidents like that.</div>',
    diagram: ["vpn", "partner"],
    starter: "",
    objectives: [
      {
        id: "table", text: "Show the routing table.",
        hints: ["ip route (or ip r).", "ip route"],
        check: function (r) { return ran(r, /\bip\b.*\br(oute)?\b(?!.*\bget\b)/, function (e) { return outHas(e, /^default via 10\.20\.0\.1/); }) ? true : "Show the routes with ip route."; }
      },
      {
        id: "trace", text: "Traceroute to the partner API (<code>172.16.50.10</code>), numeric. Where do the packets go?",
        hints: ["traceroute -n ADDRESS. Use -m 6 to stop after 6 hops.", "traceroute -n -m 6 172.16.50.10"],
        check: function (r) { return ran(r, /\btraceroute\b.*172\.16\.50\.10/, function (e) { return outHas(e, /^ 1\s+10\.20\.0\.1\b|^ 1\s+kc-gw-01/) && outHas(e, /203\.0\.113\.1/); }) ? true : "traceroute -n 172.16.50.10: the first hop is the internet gateway, not the VPN router."; }
      },
      {
        id: "add", text: "Add a route for <code>172.16.50.0/24</code> via kc-vpn-01 (10.20.0.254), then fetch <code>https://partner-api.kestrel.internal/v1/status</code>.",
        hints: ["sudo ip route add NETWORK via GATEWAY. Then curl the URL.", "sudo ip route add 172.16.50.0/24 via 10.20.0.254\ncurl -s https://partner-api.kestrel.internal/v1/status"],
        check: function (r) {
          if (!nw(r).routes.some(hasPartnerRoute)) return "Add the route: 172.16.50.0/24 via 10.20.0.254.";
          return ran(r, /\bcurl\b.*partner-api/, function (e) { return outHas(e, /Northwind/); }) ? true : "Now fetch https://partner-api.kestrel.internal/v1/status.";
        }
      },
      {
        id: "keep", text: "Make the route permanent in <code>/etc/netplan/01-kestrel.yaml</code> (a second entry under <code>routes:</code>) and apply.",
        hints: ["Under routes: add another item with the same indentation as the default route: \"- to: 172.16.50.0/24\" and \"via: 10.20.0.254\".", "sudo nano /etc/netplan/01-kestrel.yaml\n      routes:\n        - to: default\n          via: 10.20.0.1\n        - to: 172.16.50.0/24\n          via: 10.20.0.254\nsudo netplan apply"],
        check: function (r) {
          var l = N.npLoad(r.sys);
          if (l.errors.length) return "netplan can't read the file: " + l.errors[0].split("\n")[0];
          var routes = (l.conf.ethernets.eth0 || {}).routes || [];
          if (!routes.some(function (x) { return String(x.to) === "172.16.50.0/24" && String(x.via) === "10.20.0.254"; })) return "Add the partner route under routes: in the netplan file.";
          if (!routes.some(function (x) { return String(x.to) === "default" && String(x.via) === "10.20.0.1"; })) return "Keep the default route via 10.20.0.1 in the file too.";
          return nw(r).routes.some(function (x) { return x.netplan && hasPartnerRoute(x); }) ? true : "Apply it: sudo netplan apply.";
        }
      },
      {
        id: "nat", text: "What address does the internet (and Northwind's firewall, for internet traffic) see? Ask <code>ifconfig.me</code>.",
        hints: ["curl a site that echoes your address back.", "curl ifconfig.me"],
        check: function (r) { return ran(r, /\bcurl\b.*ifconfig\.me/, function (e) { return outHas(e, /^203\.0\.113\.80$/); }) ? true : "curl ifconfig.me shows the address after NAT."; }
      },
      {
        id: "ttl", text: "How many routers does a packet cross on its way to example.com? Ping it once and work it out from the reply's TTL (example.com starts at 64). Write the number in <code>~/routers.txt</code>.",
        hints: ["64 minus the ttl= in the reply.", "ping -c 1 example.com\necho 7 > ~/routers.txt"],
        check: function (r) {
          if (!ran(r, /\b(ping|traceroute)\b.*example\.com/)) return "Ping (or traceroute) example.com first.";
          return (r.read("routers.txt") || "").trim() === "7" ? true : "~/routers.txt should hold one number: 64 minus the TTL in the reply.";
        }
      }
    ],
    solution: lines("ip route", "traceroute -n -m 6 172.16.50.10", "sudo ip route add 172.16.50.0/24 via 10.20.0.254", "curl -s https://partner-api.kestrel.internal/v1/status", "sudo nano /etc/netplan/01-kestrel.yaml", "    # Network for kc-web-01. Managed by the Kestrel ops team.", "    network:", "      version: 2", "      ethernets:", "        eth0:", "          addresses:", "            - 10.20.0.15/24", "          routes:", "            - to: default", "              via: 10.20.0.1", "            - to: 172.16.50.0/24", "              via: 10.20.0.254", "          nameservers:", "            addresses: [10.20.0.2]", "            search: [kestrel.internal]", "sudo netplan apply", "curl ifconfig.me", "ping -c 1 example.com", "echo 7 > ~/routers.txt"),
    debrief: "<p>Ticket closed. Without a specific route, 172.16.50.10 matched <code>default</code>, so packets went to kc-gw-01 and out to the ISP, which drops private addresses: traceroute showed exactly that. One route through kc-vpn-01 fixed it, and netplan keeps it across reboots.</p><p>And no, 10.20.0.15 wasn't right for internet traffic: after NAT the world sees <b>203.0.113.80</b>. Traffic through the VPN is different: it isn't NATed, so Northwind sees 10.20.0.15 for API calls. Both answers matter for their firewall rules.</p>",
    realworld: "Run traceroute (tracert on Windows) to a website from home: hop 1 is your home router, then your ISP. curl ifconfig.me shows your public address, almost certainly different from the private one on your computer.",
    quiz: [
      { q: "Two routes match a destination: 0.0.0.0/0 and 172.16.50.0/24. Which is used?", options: ["The default route", "The /24: the most specific match wins", "Both, alternately", "The newest"], answer: 1, why: "Longest prefix match: more specific routes win." },
      { q: "A ping reply arrives with ttl=58 from a Linux server. How many routers did it cross?", options: ["58", "6", "4", "64"], answer: 1, why: "Linux starts at 64; 64 - 58 = 6." },
      { q: "What does NAT on kc-gw-01 change in outgoing packets?", options: ["The destination port", "The source address (private to public)", "The MAC of the server", "The TTL only"], answer: 1, why: "Source NAT rewrites the private source to the router's public address." }
    ]
  });

  /* ================================================================== NET-107 TCP & UDP */
  function apiOn(bind) {
    return function (sys) {
      M2.putRoot(sys, "/etc/systemd/system/kestrel-api.service", unitText("Kestrel API v2", "/opt/kestrel/app/venv/bin/gunicorn -b " + bind + " api:app"), 420);
      S.mkdirs(sys, "/etc/systemd/system/multi-user.target.wants").children["kestrel-api.service"] = S.linkNode("/etc/systemd/system/kestrel-api.service");
      M2.putRoot(sys, "/opt/kestrel/app/api.py", "from flask import Flask, jsonify\napp = Flask(__name__)\n\n@app.get('/v2/health')\ndef health():\n    return jsonify(status='ok', version='2.0.0')\n", 420);
      M2.unitUp(sys, "kestrel-api.service", NOW - 3 * HOUR);
      sys.nw.filtered = { "10.20.0.21:3306": true };
    };
  }
  LABS.push({
    id: "net-107", n: 7, module: 1, ticket: "NET-107", xp: 130, layer: "L4",
    title: "Refused or timed out?",
    topic: "TCP and UDP, ports, ss, nc, 0.0.0.0 vs 127.0.0.1",
    from: BEN,
    story: "<p>I deployed the new <b>kestrel-api</b> service on kc-web-01, port 9000. It works when I curl it on the server, but the load balancer (kc-lb-01) says the backend is down. Also, can you check what kc-db-01 offers? I need Postgres (5432), someone said Redis (6379) is there, and an old config mentions MySQL (3306).</p>",
    learn:
      "<h3>Ports</h3><p>An IP address gets a packet to a machine; a <b>port</b> (0 to 65535) gets it to one program on it. A server program <b>listens</b> on a port; clients connect from a random high port. Well-known ones: 22 SSH, 53 DNS, 80 HTTP, 443 HTTPS, 5432 PostgreSQL.</p>" +
      "<h3>TCP and UDP</h3>" +
      '<table class="t"><tr><th></th><th>TCP</th><th>UDP</th></tr><tr><td>Connection</td><td>yes: a handshake first (SYN, SYN-ACK, ACK)</td><td>no: just send</td></tr><tr><td>Reliable, in order</td><td>yes, it resends lost data</td><td>no</td></tr><tr><td>Used by</td><td>HTTP, SSH, databases</td><td>DNS lookups, NTP, video, HTTP/3</td></tr></table>' +
      "<h3>Who's listening: ss</h3>" + ex("sudo ss -tlnp") +
      "<p><code>-t</code> TCP, <code>-u</code> UDP, <code>-l</code> listening, <code>-n</code> numbers, <code>-p</code> process (needs sudo for other users' programs). Without <code>-l</code> you see connections and their <b>state</b> (<code>ESTAB</code>, <code>TIME-WAIT</code>, <code>SYN-SENT</code>...). Filters narrow it down: <code>ss -tn state established '( dport = :5432 )'</code>.</p>" +
      '<div class="callout">The local address is the important column. <code>127.0.0.1:9000</code> accepts connections only from this machine. <code>0.0.0.0:9000</code> (or <code>*:9000</code>) accepts them on every address the machine has.</div>' +
      "<h3>Testing a port: nc</h3>" + ex("nc -zv kc-db-01 5432") +
      "<p><code>-z</code> only connect, <code>-v</code> say what happened, <code>-w 3</code> give up after 3 seconds. The three outcomes tell you a lot:</p>" +
      '<table class="t"><tr><th>nc says</th><th>On the wire</th><th>Means</th></tr><tr><td>succeeded</td><td>SYN, SYN-ACK, ACK</td><td>something listens</td></tr><tr><td>Connection refused</td><td>SYN, then a <b>RST</b> back</td><td>the host is there, nothing listens on that port</td></tr><tr><td>timed out</td><td>SYN, then silence</td><td>a firewall drops it, or the host is gone</td></tr></table>' +
      "<p>Over UDP (<code>nc -zu</code>) nc always says \"succeeded\": UDP has no handshake, so there's no way to know if anyone is listening.</p>",
    system: apiOn("127.0.0.1:9000"),
    diagram: ["lb"],
    starter: "",
    objectives: [
      {
        id: "listen", text: "List the listening TCP sockets with the program behind each. Find kestrel-api's port and the address it listens on.",
        hints: ["ss -tlnp, with sudo to see every program.", "sudo ss -tlnp"],
        check: function (r) { return ran(r, /\bss\b/, function (e) { return rootish(e) && outHas(e, /127\.0\.0\.1:9000\b.*gunicorn/); }) ? true : "sudo ss -tlnp: kestrel-api is the gunicorn on port 9000."; }
      },
      {
        id: "refused", text: "Test port 9000 on kc-web-01's <b>network</b> address (10.20.0.15), the way the load balancer does.",
        hints: ["nc -zv ADDRESS PORT.", "nc -zv 10.20.0.15 9000"],
        check: function (r) { return ran(r, /\bnc\b.*10\.20\.0\.15\s+9000/, function (e) { return outHas(e, /Connection refused/); }) ? true : "nc -zv 10.20.0.15 9000 (before fixing anything): refused."; }
      },
      {
        id: "bind", text: "Make kestrel-api listen on all addresses: change its unit file (<code>/etc/systemd/system/kestrel-api.service</code>) to bind <code>0.0.0.0:9000</code>, reload systemd and restart it.",
        hints: ["Edit the -b address in ExecStart. After editing a unit: sudo systemctl daemon-reload, then sudo systemctl restart kestrel-api.", "sudo sed -i 's/127.0.0.1:9000/0.0.0.0:9000/' /etc/systemd/system/kestrel-api.service\nsudo systemctl daemon-reload\nsudo systemctl restart kestrel-api"],
        check: function (r) {
          var a = listener(r, 9000, "kestrel-api.service");
          if (a === "0.0.0.0" || a === "*") return true;
          if (/0\.0\.0\.0:9000/.test(r.read("/etc/systemd/system/kestrel-api.service") || "")) return "The unit file is right, but the service still listens on " + (a || "nothing") + ": daemon-reload, then restart it.";
          return "Change -b 127.0.0.1:9000 to -b 0.0.0.0:9000 in the unit file.";
        }
      },
      {
        id: "ok", text: "Prove the load balancer can connect now.",
        hints: ["The same nc test.", "nc -zv 10.20.0.15 9000"],
        check: function (r) { return ran(r, /\bnc\b.*10\.20\.0\.15\s+9000/, function (e) { return outHas(e, /succeeded/); }) ? true : "nc -zv 10.20.0.15 9000 should succeed now."; }
      },
      {
        id: "db", text: "Test kc-db-01's ports <b>5432, 6379 and 3306</b> with nc (give up after 3 seconds). Write one line per port to <code>~/db-ports.txt</code>: the port and <code>open</code>, <code>refused</code> or <code>filtered</code>.",
        hints: ["nc -zv -w 3 kc-db-01 PORT for each. Refused = closed; timed out = filtered by a firewall.", "nc -zv -w 3 kc-db-01 5432\nnc -zv -w 3 kc-db-01 6379\nnc -zv -w 3 kc-db-01 3306\nnano ~/db-ports.txt\n5432 open\n6379 refused\n3306 filtered"],
        check: function (r) {
          var tested = [5432, 6379, 3306].filter(function (p) { return ran(r, new RegExp("\\bnc\\b.*(kc-db-01|10\\.20\\.0\\.21)\\b.*\\b" + p + "\\b")); });
          if (tested.length < 3) return "Test all three ports with nc (" + [5432, 6379, 3306].filter(function (p) { return tested.indexOf(p) < 0; }).join(", ") + " still to do).";
          var t = r.read("db-ports.txt") || "", want = { 5432: "open", 6379: "refused", 3306: "filtered" };
          for (var p in want) { var m = new RegExp("^\\s*" + p + "\\s+(\\w+)", "m").exec(t); if (!m) return "~/db-ports.txt needs a line for port " + p + "."; if (m[1].toLowerCase() !== want[p]) return "Port " + p + ": you wrote " + m[1] + ". Look at what nc said again (succeeded, refused, or timed out)."; }
          return true;
        }
      },
      {
        id: "udp", text: "UDP: list the UDP sockets with their programs. Which program listens on <code>127.0.0.53:53</code>?",
        hints: ["Same ss, with -u instead of -t.", "sudo ss -ulnp"],
        check: function (r) { return ran(r, /\bss\b.*-\w*u/, function (e) { return outHas(e, /127\.0\.0\.53:53\b.*systemd-resolve/); }) ? true : "sudo ss -ulnp: the DNS stub resolver listens on 127.0.0.53:53."; }
      }
    ],
    solution: lines("sudo ss -tlnp", "nc -zv 10.20.0.15 9000", "sudo sed -i 's/127.0.0.1:9000/0.0.0.0:9000/' /etc/systemd/system/kestrel-api.service", "sudo systemctl daemon-reload", "sudo systemctl restart kestrel-api", "nc -zv 10.20.0.15 9000", "nc -zv -w 3 kc-db-01 5432", "nc -zv -w 3 kc-db-01 6379", "nc -zv -w 3 kc-db-01 3306", "nano ~/db-ports.txt", "    5432 open", "    6379 refused", "    3306 filtered", "sudo ss -ulnp"),
    debrief: "<p>Ticket closed. Ben's curl worked because it ran on the server, where 127.0.0.1 is reachable; the load balancer connects to 10.20.0.15, where nothing listened. That's the most common \"works on my machine\" of servers. Binding to <code>0.0.0.0</code> fixed it, but it also means <b>anyone</b> who can reach the server can reach port 9000: the firewall (Module 4) should allow it only from kc-lb-01.</p><p>On kc-db-01: Postgres open, Redis refused (not installed: whoever said it was there was wrong), MySQL <b>filtered</b>, a firewall silently dropping it. Refused answers fast; filtered makes you wait. Remember the difference: it tells you whether to look at the service or at a firewall.</p>",
    realworld: "On your own Linux machine, ss -tlnp lists what listens (on Windows: netstat -ano, or Get-NetTCPConnection -State Listen). nc -zv example.com 443 tests a port on any server.",
    quiz: [
      { q: "A service listens on <code>127.0.0.1:9000</code>. Who can connect?", options: ["Anyone", "Only programs on the same machine", "Only the load balancer", "Only root"], answer: 1, why: "127.0.0.1 is loopback: never reachable from outside." },
      { q: "nc says \"Connection refused\". What came back?", options: ["Nothing", "A TCP RST: the host is up, nothing listens on that port", "An ICMP echo reply", "A SYN-ACK"], answer: 1, why: "Refused means a reset came back: the port is closed, not filtered." },
      { q: "Why does <code>nc -zu</code> always say \"succeeded\"?", options: ["UDP is always open", "UDP has no handshake, so nc can't tell", "nc doesn't support UDP", "It uses TCP anyway"], answer: 1, why: "Without a handshake there's no answer to wait for." }
    ]
  });

  /* ================================================================== NET-108 TLS & encodings */
  var PW = "Winter" + "2026" + "!";
  var LATIN = "id,name,city\n1001,Jürgen Müller,Köln\n1002,Zoë Ångström,Malmö\n1003,François Lefèvre,Genève\n";
  function tlsLab(sys) {
    var w = M2.nodeAt(sys, "/etc/systemd/system/timers.target.wants");
    if (w) delete w.children["certbot.timer"];
    M2.jadd(sys, "systemd", 1, "Removed \"/etc/systemd/system/timers.target.wants/certbot.timer\".", null, 6, NOW - 95 * DAY);
    var auth = "Authorization: Basic " + btoa("deploy:" + PW) + "\n";
    S.mkdirs(sys, "/home/dev/encoded", 509, 1000, 1000);
    S.put(sys, "/home/dev/encoded/auth-header.txt", "# Copied from a debug log of the old deploy script (2026-11-02):\n" + auth, 436, 1000, 1000, NOW - 9 * DAY);
    var n = S.put(sys, "/home/dev/encoded/customers.csv", LATIN.replace(/[^\x00-\x7f]/g, "�"), 436, 1000, 1000, NOW - DAY);
    n.latin1 = LATIN;
    S.put(sys, "/home/dev/encoded/orders.json.gz", M2.archive.GZ_MAGIC + btoa(JSON.stringify({ n: "orders.json", m: NOW - DAY, c: "{\"orders\":[{\"id\":7731,\"total\":42.5},{\"id\":7732,\"total\":18.0}]}\n" })), 436, 1000, 1000, NOW - DAY);
  }
  LABS.push({
    id: "net-108", n: 8, module: 1, ticket: "NET-108", xp: 140, layer: "L5–6",
    title: "Certificates and other encodings",
    topic: "TLS, certificates, SNI, Let's Encrypt, base64, character sets",
    from: DEV,
    story: "<p>Customers get a scary warning on <code>https://shop.kestrel.example.com</code> since yesterday. Find out why, fix it properly, and find out why it wasn't fixed automatically.</p><p>Then a few things from my inbox: a debug log that \"only contains an encoded header\" (I don't believe it's harmless), and a customer export from the old system where every name with an accent is garbled.</p>",
    learn:
      "<h3>Layers 5 and 6</h3><p>The session and presentation layers are about <b>how</b> data is carried: keeping a secure session going (TLS), and how it's <b>encoded</b> (encrypted, compressed, which character set). In practice they live inside the application, which is why TCP/IP folds them into \"application\".</p>" +
      "<h3>TLS and certificates</h3><p>HTTPS is HTTP inside <b>TLS</b>. At the start of the connection the server sends a <b>certificate</b>: its public key, the names it's valid for, dates, and a signature from a <b>certificate authority</b> (CA) your system trusts. The client checks three things: it chains to a trusted CA, it's within its dates, and the name you asked for is in it.</p>" +
      ex("echo | openssl s_client -connect kestrel.example.com:443 -servername kestrel.example.com") +
      "<p>The <code>depth=</code> lines are the chain, from the root CA down to the server's certificate; any <code>verify error</code> is shown there. <code>echo |</code> closes the connection straight away. To read a certificate file:</p>" +
      ex("openssl x509 -in /etc/letsencrypt/live/kestrel.example.com/cert.pem -noout -subject -dates") +
      "<h3>SNI</h3><p>One IP address often serves many sites. The client says which name it wants in the TLS hello: <b>SNI</b> (server name indication), so the server can pick the right certificate. <code>-servername</code> sets it in s_client; connect by IP without it and you get the server's default certificate.</p>" +
      "<h3>Let's Encrypt and ACME</h3><p>Let's Encrypt issues free certificates valid for <b>90 days</b>, over a protocol called <b>ACME</b>. <code>certbot</code> proves you control the name (HTTP-01: it puts a token under <code>/.well-known/acme-challenge/</code> and Let's Encrypt fetches it over port 80), then saves the certificate in <code>/etc/letsencrypt/live/NAME/</code>. Renewal is meant to be automatic: <code>certbot.timer</code> runs <code>certbot renew</code> twice a day.</p>" +
      ex("sudo certbot certificates") +
      '<div class="callout warn">nginx reads certificate files when it starts or reloads. A renewed certificate on disk does nothing until <code>sudo systemctl reload nginx</code>.</div>' +
      "<h3>Encodings are not encryption</h3>" +
      '<table class="t"><tr><th>Encoding</th><th>Looks like</th><th>Undo with</th></tr><tr><td>base64</td><td><code>ZGVwbG95Oi4uLg==</code></td><td><code>base64 -d</code></td></tr><tr><td>gzip</td><td>binary, starts with bytes 1f 8b</td><td><code>zcat</code>, <code>gunzip</code></td></tr><tr><td>hex</td><td><code>48 65 6c 6c 6f</code></td><td><code>xxd -r -p</code></td></tr><tr><td>ISO-8859-1 text</td><td>fine in old programs, garbled (<code>M�ller</code>) in UTF-8</td><td><code>iconv -f ISO-8859-1 -t UTF-8</code></td></tr></table>' +
      "<p>Anyone can decode these: they protect nothing. HTTP Basic authentication is just <code>base64(user:password)</code> in a header. <code>file</code> tells you what a file is; <code>xxd</code> shows its bytes.</p>",
    system: tlsLab,
    diagram: ["site"],
    starter: "",
    objectives: [
      {
        id: "see", text: "Look at the certificate <code>shop.kestrel.example.com</code> serves with <code>openssl s_client</code> (with <code>-servername</code>). What's the verify error?",
        hints: ["echo | openssl s_client -connect HOST:443 -servername HOST. Read the depth= lines.", "echo | openssl s_client -connect shop.kestrel.example.com:443 -servername shop.kestrel.example.com"],
        check: function (r) { return ran(r, /\bopenssl\s+s_client\b.*shop\.kestrel\.example\.com/, function (e) { return outHas(e, /certificate has expired/); }) ? true : "Connect to shop.kestrel.example.com:443 with s_client and -servername; the verify error says what's wrong."; }
      },
      {
        id: "dates", text: "Show the dates of the certificate <b>file</b>, <code>/etc/letsencrypt/live/shop.kestrel.example.com/cert.pem</code>.",
        hints: ["openssl x509 -in FILE -noout -dates.", "openssl x509 -in /etc/letsencrypt/live/shop.kestrel.example.com/cert.pem -noout -dates"],
        check: function (r) { return ran(r, /\bopenssl\s+x509\b.*shop/, function (e) { return outHas(e, /^notAfter=Nov 10 07:58:01 2026 GMT/); }) ? true : "Read the file's dates with openssl x509 -noout -dates."; }
      },
      {
        id: "timer", text: "Why didn't it renew? Check certbot's timer, then <b>enable</b> and start it.",
        hints: ["systemctl list-timers --all, or systemctl status certbot.timer. Enable with --now to start it too.", "systemctl status certbot.timer\nsudo systemctl enable --now certbot.timer"],
        check: function (r) {
          var u = M2.loadUnit(r.sys, "certbot.timer");
          if (!u || M2.enabledState(r.sys, u) !== "enabled") return "certbot.timer isn't enabled: sudo systemctl enable --now certbot.timer.";
          return u.rt.active === "active" ? true : "It's enabled for the next boot, but not running now: start it too (enable --now).";
        }
      },
      {
        id: "renew", text: "Renew the certificate with certbot, make nginx use it, and prove it: <code>curl -I https://shop.kestrel.example.com/</code> answers <b>HTTP/2 200</b>.",
        hints: ["sudo certbot renew. Then nginx must re-read its files: reload it.", "sudo certbot renew\nsudo systemctl reload nginx\ncurl -I https://shop.kestrel.example.com/"],
        check: function (r) {
          var c = N.parsePems(r.read("/etc/letsencrypt/live/shop.kestrel.example.com/cert.pem"))[0];
          if (!c || c.na < r.sys.now) return "The certificate file is still the expired one: sudo certbot renew.";
          var t = N.tlsConnect(r.sys, W.PUB, 443, "shop.kestrel.example.com");
          if (!t.ok || N.verifyChain(r.sys, t.chain).code) return "The new certificate is on disk, but nginx still serves the old one: reload nginx.";
          var k = lastIdx(r, /\b(reload|restart)\b.*nginx|nginx\s+-s\s+reload/);
          return after(r, k, /\bcurl\b.*shop\.kestrel\.example\.com/, function (e) { return outHas(e, /^HTTP\/2 200/); }) ? true : "Check it with curl -I https://shop.kestrel.example.com/.";
        }
      },
      {
        id: "sni", text: "SNI: connect to <code>203.0.113.80:443</code> with s_client <b>without</b> a server name. Whose certificate do you get?",
        hints: ["Connect by IP address and leave out -servername.", "echo | openssl s_client -connect 203.0.113.80:443"],
        check: function (r) { return ran(r, /\bopenssl\s+s_client\b/, function (e) { return /203\.0\.113\.80|-noservername/.test(e.cmd) && !/-servername/.test(e.cmd) && outHas(e, /subject=CN = kc-web-01/); }) ? true : "Connect to 203.0.113.80:443 without -servername: you get the default (self-signed) certificate."; }
      },
      {
        id: "b64", text: "Decode the header in <code>~/encoded/auth-header.txt</code> (the part after <code>Basic</code> is base64) and save the result to <code>~/encoded/decoded.txt</code>.",
        hints: ["Take the last word of the Authorization line (awk '{print $3}' or cut) and pipe it to base64 -d.", "grep Authorization ~/encoded/auth-header.txt | awk '{print $3}' | base64 -d > ~/encoded/decoded.txt\ncat ~/encoded/decoded.txt"],
        check: function (r) { return (r.read("encoded/decoded.txt") || "").trim() === "deploy:" + PW ? true : "~/encoded/decoded.txt should contain the decoded user:password (base64 -d)."; }
      },
      {
        id: "iconv", text: "<code>~/encoded/customers.csv</code> is in ISO-8859-1. Convert it to UTF-8 as <code>~/encoded/customers-utf8.csv</code>.",
        hints: ["file shows the encoding. iconv -f FROM -t TO FILE > NEWFILE.", "file ~/encoded/customers.csv\niconv -f ISO-8859-1 -t UTF-8 ~/encoded/customers.csv > ~/encoded/customers-utf8.csv\ncat ~/encoded/customers-utf8.csv"],
        check: function (r) { var t = r.read("encoded/customers-utf8.csv"); return t === LATIN ? true : t === null ? "Create ~/encoded/customers-utf8.csv with iconv." : "customers-utf8.csv isn't right yet: convert from ISO-8859-1 to UTF-8."; }
      }
    ],
    solution: lines("echo | openssl s_client -connect shop.kestrel.example.com:443 -servername shop.kestrel.example.com", "openssl x509 -in /etc/letsencrypt/live/shop.kestrel.example.com/cert.pem -noout -dates", "systemctl status certbot.timer", "sudo systemctl enable --now certbot.timer", "sudo certbot renew", "sudo systemctl reload nginx", "curl -I https://shop.kestrel.example.com/", "echo | openssl s_client -connect 203.0.113.80:443", "grep Authorization ~/encoded/auth-header.txt | awk '{print $3}' | base64 -d > ~/encoded/decoded.txt", "file ~/encoded/customers.csv", "iconv -f ISO-8859-1 -t UTF-8 ~/encoded/customers.csv > ~/encoded/customers-utf8.csv"),
    debrief: "<p>Ticket closed. The certbot timer had been disabled since the server was migrated in August, so nothing renewed shop's 90-day certificate; kestrel.example.com only survived because someone renewed it by hand. The renewal itself still had a trap: until nginx reloads, the old certificate stays in memory.</p><p>The \"harmless\" log line was a password: base64 is an encoding anyone can reverse. Dev has rotated the deploy account's password and is removing the debug logging. And the garbled names were never broken data, just bytes read with the wrong character set.</p>",
    realworld: "Check any site: echo | openssl s_client -connect example.com:443 -servername example.com 2>/dev/null | openssl x509 -noout -dates. Monitoring certificate expiry (and alerting 2 to 3 weeks ahead) is a standard check in every ops team.",
    quiz: [
      { q: "Which three things does a client check on a server certificate?", options: ["Size, colour, port", "Trusted chain, valid dates, matching name", "Only the date", "The server's IP"], answer: 1, why: "Chain to a trusted CA, within notBefore/notAfter, and the requested name in the SAN list." },
      { q: "What is SNI for?", options: ["Encrypting the certificate", "Telling the server which site's certificate you want", "Speeding up DNS", "Compressing data"], answer: 1, why: "Many sites share one IP; SNI names the one you want in the TLS hello." },
      { q: "A log line has <code>Authorization: Basic ZGVwbG95Oi4uLg==</code>. Is it safe?", options: ["Yes, it's encrypted", "No, base64 is reversible: it's the password", "Yes, it's a hash", "Only over HTTPS"], answer: 1, why: "base64 is an encoding. Anyone can decode it." }
    ]
  });

  /* ================================================================== NET-109 DNS */
  function staleHosts(ip) { return function (sys) { M2.writeRoot(sys, "/etc/hosts", "\n# testing the API on the old box before the LB move -- remove afterwards!\n" + ip + " api.kestrel.example.com\n", true); }; }
  LABS.push({
    id: "net-109", n: 9, module: 1, ticket: "NET-109", xp: 130, layer: "L7",
    title: "It works for everyone but us",
    topic: "DNS records, dig, TTL, resolv.conf, /etc/hosts, +trace",
    from: BEN,
    story: "<p>The API moved to the new load balancer on Monday: <code>api.kestrel.example.com</code>. Customers are fine. But from kc-web-01, <code>curl https://api.kestrel.example.com/v2/health</code> fails with a certificate error, and our checkout calls the API from this server!</p><p>While you're in DNS: I need the mail server and SPF record for the domain, and the names of our authoritative DNS servers for a form the registrar sent.</p>",
    learn:
      "<h3>DNS: names to records</h3><p>DNS is a distributed database of <b>records</b>. The common types:</p>" +
      '<table class="t"><tr><th>Type</th><th>Holds</th></tr><tr><td><code>A</code> / <code>AAAA</code></td><td>IPv4 / IPv6 address</td></tr><tr><td><code>CNAME</code></td><td>\"this name is an alias for that name\"</td></tr><tr><td><code>MX</code></td><td>mail servers for the domain, with priorities</td></tr><tr><td><code>TXT</code></td><td>free text: SPF, domain verification</td></tr><tr><td><code>NS</code></td><td>the authoritative name servers for a zone</td></tr><tr><td><code>PTR</code></td><td>reverse: address to name</td></tr></table>' +
      ex("dig kestrel.example.com") +
      "<p>Read the <b>ANSWER SECTION</b>: name, <b>TTL</b> (seconds the answer may be cached), class, type, data. <code>+short</code> prints only the data; <code>+noall +answer</code> only the answer lines; <code>dig MX name</code> asks for another type; <code>dig @1.1.1.1 name</code> asks a specific server.</p>" +
      "<h3>How a Linux server resolves names</h3><p>Programs (curl, ssh, the app) go through the system resolver: first <code>/etc/hosts</code>, then DNS. On Ubuntu, <code>/etc/resolv.conf</code> points at <b>systemd-resolved</b> on <code>127.0.0.53</code>, which forwards to the real DNS servers from netplan. <code>resolvectl status</code> shows them.</p>" +
      '<div class="callout warn"><code>dig</code> asks DNS directly and <b>ignores /etc/hosts</b>. <code>getent hosts NAME</code> resolves the way programs do. When they disagree, look in /etc/hosts.</div>' +
      "<h3>Who's in charge: delegation</h3><p>Nobody has the whole database. The <b>root</b> servers know who runs <code>com.</code>; those know who runs <code>example.com.</code>; and so on, down to the <b>authoritative</b> servers for your zone. <code>dig +trace NAME</code> follows that chain from the root, without caches.</p>" +
      "<h3>TTLs and \"propagation\"</h3><p>Resolvers cache an answer for its TTL. When you change a record, old answers live on until their TTL runs out: that's all \"DNS propagation\" is. Lower the TTL a day before a planned move.</p>",
    system: staleHosts(W.PUB),
    diagram: ["site"],
    starter: "",
    objectives: [
      {
        id: "ttl", text: "Look up <code>kestrel.example.com</code>, showing <b>only the answer lines</b>, so you can read its TTL.",
        hints: ["dig with +noall +answer.", "dig +noall +answer kestrel.example.com"],
        check: function (r) { return ran(r, /\bdig\b.*kestrel\.example\.com/, function (e) { return outHas(e, /^kestrel\.example\.com\.\s+\d+\s+IN\s+A\s+203\.0\.113\.80/) && !outHas(e, /^;;/); }) ? true : "dig +noall +answer kestrel.example.com prints just the answer line, with the TTL."; }
      },
      {
        id: "mx", text: "Find the domain's <b>mail server</b> (MX) and its <b>SPF</b> record (TXT).",
        hints: ["dig MX NAME and dig TXT NAME.", "dig MX kestrel.example.com +short\ndig TXT kestrel.example.com +short"],
        check: function (r) {
          if (!ran(r, /\b(dig|host)\b/, function (e) { return outHas(e, /mail\.kestrel\.example\.com/); })) return "Ask for the MX record.";
          return ran(r, /\b(dig|host)\b/, function (e) { return outHas(e, /v=spf1/); }) ? true : "Now the TXT records: one of them starts with v=spf1.";
        }
      },
      {
        id: "compare", text: "Compare how <b>programs</b> resolve <code>api.kestrel.example.com</code> (<code>getent hosts</code>) with what <b>DNS</b> says (<code>dig</code>).",
        hints: ["getent hosts NAME goes through /etc/hosts first; dig doesn't.", "getent hosts api.kestrel.example.com\ndig +short api.kestrel.example.com"],
        check: function (r) {
          if (!ran(r, /\bgetent\s+hosts\b.*api\.kestrel/, function (e) { return outHas(e, /203\.0\.113\.80/); })) return "getent hosts api.kestrel.example.com: what programs on this server get.";
          return ran(r, /\bdig\b.*api\.kestrel/, function (e) { return outHas(e, /203\.0\.113\.90/); }) ? true : "Now dig the same name: DNS says something else.";
        }
      },
      {
        id: "fix", text: "Remove the stale line from <code>/etc/hosts</code> and fetch <code>https://api.kestrel.example.com/v2/health</code>.",
        hints: ["sudo nano /etc/hosts, or sudo sed -i '/api.kestrel/d' /etc/hosts. Keep the other lines!", "sudo sed -i '/api\\.kestrel\\.example\\.com/d' /etc/hosts\ncurl -s https://api.kestrel.example.com/v2/health"],
        check: function (r) {
          var h = r.read("/etc/hosts") || "";
          if (/^\s*[^#\s].*\bapi\.kestrel\.example\.com\b/m.test(h)) return "/etc/hosts still pins api.kestrel.example.com.";
          if (!/127\.0\.0\.1\s+localhost/.test(h)) return "You removed too much: /etc/hosts must keep its localhost line.";
          return ran(r, /\bcurl\b.*api\.kestrel\.example\.com/, function (e) { return outHas(e, /"version":"2\.0\.0"/); }) ? true : "Now fetch https://api.kestrel.example.com/v2/health.";
        }
      },
      {
        id: "servers", text: "Which DNS server does this machine use? Show it with <code>resolvectl status</code>, then ask Cloudflare's <code>1.1.1.1</code> directly for <code>api.kestrel.example.com</code>.",
        hints: ["resolvectl status; dig @SERVER NAME.", "resolvectl status\ndig @1.1.1.1 api.kestrel.example.com +short"],
        check: function (r) {
          if (!ran(r, /\bresolvectl\b/, function (e) { return outHas(e, /DNS Servers: 10\.20\.0\.2/); })) return "Run resolvectl status: look at \"DNS Servers\".";
          return ran(r, /\bdig\b.*@1\.1\.1\.1.*api\.kestrel|\bdig\b.*api\.kestrel.*@1\.1\.1\.1/, function (e) { return outHas(e, /203\.0\.113\.90/); }) ? true : "Ask 1.1.1.1 directly: dig @1.1.1.1 api.kestrel.example.com.";
        }
      },
      {
        id: "trace", text: "Follow the delegation from the root with <code>dig +trace kestrel.example.com</code>. Write the names of the zone's authoritative servers to <code>~/authoritative.txt</code>, one per line.",
        hints: ["The last NS records before the answer are the ones for kestrel.example.com.", "dig +trace kestrel.example.com\nnano ~/authoritative.txt\nns1.example-dns.net\nns2.example-dns.net"],
        check: function (r) {
          if (!ran(r, /\bdig\b.*\+trace/)) return "Run dig +trace kestrel.example.com.";
          var got = L(r.read("authoritative.txt") || "").map(function (l) { return l.trim().replace(/\.$/, "").toLowerCase(); }).filter(Boolean).sort();
          return SH.same(got, ["ns1.example-dns.net", "ns2.example-dns.net"]) ? true : "~/authoritative.txt should list the two NS names for kestrel.example.com.";
        }
      }
    ],
    solution: lines("dig +noall +answer kestrel.example.com", "dig MX kestrel.example.com +short", "dig TXT kestrel.example.com +short", "getent hosts api.kestrel.example.com", "dig +short api.kestrel.example.com", "sudo sed -i '/api\\.kestrel\\.example\\.com/d' /etc/hosts", "curl -s https://api.kestrel.example.com/v2/health", "resolvectl status", "dig @1.1.1.1 api.kestrel.example.com +short", "dig +trace kestrel.example.com", "nano ~/authoritative.txt", "    ns1.example-dns.net", "    ns2.example-dns.net"),
    debrief: "<p>Ticket closed. DNS had been right since Monday; kc-web-01 never asked it. A testing line in <code>/etc/hosts</code> pinned the name to the old server, which doesn't have a certificate for <code>api.</code>, so the DNS problem showed up as a TLS error. That's why the first question with \"works for everyone but us\" is always <code>getent hosts</code> vs <code>dig</code>.</p><p>For Ben's form: mail goes to mail.kestrel.example.com, SPF allows only the MX hosts (<code>v=spf1 mx -all</code>), and the zone is served by ns1/ns2.example-dns.net.</p>",
    realworld: "Try dig +trace on your own domain or any site, and compare dig example.com with dig @1.1.1.1 example.com and dig @8.8.8.8 example.com. On Windows, Resolve-DnsName and nslookup do the lookups.",
    quiz: [
      { q: "Which tool resolves a name the way curl and ssh do, including /etc/hosts?", options: ["dig", "getent hosts", "host", "nslookup"], answer: 1, why: "getent uses the system resolver (nsswitch): files first, then DNS." },
      { q: "A record has TTL 86400. You change it. When will everyone see the new value?", options: ["Immediately", "Within about a day, as caches expire", "Never", "After a reboot"], answer: 1, why: "Resolvers may cache the old answer for up to its TTL: 86400 s is one day." },
      { q: "Which record type lists a domain's mail servers?", options: ["A", "TXT", "MX", "NS"], answer: 2, why: "MX = mail exchanger, with a priority number." }
    ]
  });

  /* ================================================================== NET-110 HTTP by hand */
  var URLS = "https://kestrel.example.com/\nhttps://kestrel.example.com/old-pricing.html\nhttps://kestrel.example.com/pricing\nhttps://kestrel.example.com/api/health\nhttps://kestrel.example.com/api/payments\nhttp://kestrel.example.com/robots.txt\n";
  var URLS_ALT = "https://kestrel.example.com/robots.txt\nhttps://kestrel.example.com/missing.html\nhttp://kestrel.example.com/\nhttps://kestrel.example.com/api/version\n";
  function urlCodes(r) {
    var res = [];
    L(r.read("urls.txt") || "").forEach(function (u) {
      u = u.trim(); if (!u) return;
      var x = M2.parseUrl(u), g = N.getaddrinfo(r.sys, x.host, 4);
      var resp = N.httpTo(r.sys, g.ip, x.port, { scheme: x.scheme, host: x.host, port: x.port, path: x.path, method: "GET", headers: { host: x.host, "user-agent": "curl/8.5.0", accept: "*/*" } });
      res.push({ url: u, code: resp.err ? "000" : String(resp.status) });
    });
    return res;
  }
  function browserCapture() {
    var t0 = Date.UTC(2026, 10, 11, 7, 58, 3) / 1000 + 0.2211, B = "198.51.100.77";
    var out = P.dns(t0, B, "1.1.1.1", 53214, 9021, "kestrel.example.com", "A", [{ type: "A", data: W.PUB, ttl: 300 }]).map(function (p) { p.eth = { src: "f0:1f:af:22:31:9e", dst: "00:1b:54:c3:11:02" }; if (p.ip.src !== B) p.eth = { src: "00:1b:54:c3:11:02", dst: "f0:1f:af:22:31:9e" }; return p; });
    var tls = P.convo({ t: t0 + 0.031, a: B, b: W.PUB, pa: 61022, pb: 443, ttlB: 52, eth: ["f0:1f:af:22:31:9e", "00:1b:54:c3:11:02"], steps: [{ flags: "S", dt: 0 }, { dir: "<", flags: "S.", dt: 0.012 }, { flags: ".", dt: 0.0121 }, { flags: "P.", enc: { tls: 22, len: 517, seed: 41 }, dt: 0.0123, appName: "TLS ClientHello" }, { dir: "<", flags: "P.", enc: { tls: 22, len: 1460, seed: 43 }, dt: 0.025, appName: "TLS ServerHello" }] });
    var quic = [];
    for (var i = 0; i < 6; i++) { var up = i % 2 === 0; quic.push(P.udp(t0 + 0.4 + i * 0.011, up ? B : W.PUB, up ? W.PUB : B, up ? 55871 : 443, up ? 443 : 55871, { appName: "QUIC", enc: { len: i === 0 ? 1252 : 1200 - i * 90, seed: 60 + i }, eth: up ? { src: "f0:1f:af:22:31:9e", dst: "00:1b:54:c3:11:02" } : { src: "00:1b:54:c3:11:02", dst: "f0:1f:af:22:31:9e" } })); }
    return out.concat(tls, quic);
  }
  LABS.push({
    id: "net-110", n: 10, module: 1, ticket: "NET-110", xp: 130, layer: "L7",
    title: "HTTP by hand",
    topic: "curl -v, status codes, headers, raw requests with nc, HTTP/2 and HTTP/3",
    from: BEN,
    story: "<p>Marketing says \"some pages are broken\", the app team says \"the API is fine\", and nobody can tell me what the web server actually answers. Show me how to talk HTTP directly, and check every URL in <code>~/urls.txt</code>.</p><p>Also, a customer's browser capture (<code>~/captures/browser.pcap</code>) shows no TCP to our site after the first second. Their security team thinks something is hiding traffic. Is it?</p>",
    learn:
      "<h3>An HTTP exchange</h3><p>HTTP is plain text (in HTTP/1.1): a request line, headers, a blank line, maybe a body. The answer is a status line, headers, a blank line and the body.</p>" +
      code("GET /api/health HTTP/1.1          HTTP/1.1 200 OK\nHost: kestrel.example.com         Content-Type: application/json\nUser-Agent: curl/8.5.0            Content-Length: 16\nAccept: */*\n                                  {\"status\":\"ok\"}") +
      "<p>The <code>Host:</code> header is required in HTTP/1.1: one server answers for many names, and Host says which one you want (like SNI does for TLS).</p>" +
      '<table class="t"><tr><th>Status</th><th>Means</th><th>Examples</th></tr><tr><td>2xx</td><td>it worked</td><td>200 OK, 204 No Content</td></tr><tr><td>3xx</td><td>go elsewhere</td><td>301 permanent, 302 temporary redirect: see <code>Location:</code></td></tr><tr><td>4xx</td><td>your request is wrong</td><td>400 bad request, 401/403 not allowed, 404 not found</td></tr><tr><td>5xx</td><td>the server failed</td><td>500 error, 502 bad gateway (the app behind nginx didn\'t answer), 503 unavailable</td></tr></table>' +
      "<h3>curl</h3>" + ex("curl -v http://kestrel.example.com/") +
      "<p><code>-v</code> shows everything: lines starting <code>&gt;</code> are what curl sent, <code>&lt;</code> what came back, <code>*</code> what curl did (DNS, TCP, TLS). <code>-I</code> headers only, <code>-L</code> follow redirects, <code>-s</code> quiet, <code>-o /dev/null</code> throw the body away, and <code>-w</code> prints details after the transfer:</p>" +
      code("curl -s -o /dev/null -w '%{http_code} %{time_total}\\n' https://kestrel.example.com/") +
      "<h3>Raw HTTP with nc</h3><p>Because HTTP/1.1 is text, you can type it yourself. <code>printf</code> lets you send the <code>\\r\\n</code> line endings HTTP needs:</p>" +
      code("printf 'GET / HTTP/1.1\\r\\nHost: kestrel.example.com\\r\\nConnection: close\\r\\n\\r\\n' | nc 10.20.0.15 80") +
      "<h3>HTTP/2 and HTTP/3</h3><p><b>HTTP/2</b> is binary and sends many requests over one TLS connection; client and server agree on it during the TLS handshake (ALPN). curl shows <code>HTTP/2 200</code> with lower-case headers. <b>HTTP/3</b> runs over <b>QUIC</b>, on <b>UDP port 443</b> instead of TCP. A server advertises it with an <code>alt-svc</code> header, and browsers switch to it for later requests. Ubuntu's curl is built without HTTP/3, so you'll find it in captures rather than in curl.</p>",
    files: { "urls.txt": URLS, "captures/browser.pcap": N.pcapFile(browserCapture()) },
    diagram: ["site"],
    starter: "",
    objectives: [
      {
        id: "verbose", text: "Fetch <code>http://kestrel.example.com/</code> verbosely. What status does it answer, and where does it send you?",
        hints: ["curl -v URL. Look at the < lines.", "curl -v http://kestrel.example.com/"],
        check: function (r) { return ran(r, /\bcurl\b.*-\w*v.*http:\/\/kestrel\.example\.com|\bcurl\b.*http:\/\/kestrel\.example\.com.*-\w*v/, function (e) { return outHas(e, /^< HTTP\/1\.1 301/) && outHas(e, /^< Location: https:\/\/kestrel\.example\.com\//); }) ? true : "curl -v http://kestrel.example.com/ shows a 301 and its Location header."; }
      },
      {
        id: "follow", text: "Follow the redirect and show only the headers. Which HTTP version does the HTTPS site answer with, and which header advertises HTTP/3?",
        hints: ["-I and -L together.", "curl -IL http://kestrel.example.com/"],
        check: function (r) { return ran(r, /\bcurl\b/, function (e) { return /-\w*L|--location/.test(e.cmd) && outHas(e, /^HTTP\/2 200/) && outHas(e, /^alt-svc: h3=":443"/); }) ? true : "curl -IL http://kestrel.example.com/: the second response is HTTP/2 with an alt-svc header."; }
      },
      {
        id: "raw", text: "Talk to the app directly with a hand-typed request: send <code>GET /api/health</code> to <code>127.0.0.1</code> port <code>8080</code> with <code>nc</code>.",
        hints: ["printf the request (request line, Host header, empty line, all ending in \\r\\n) and pipe it into nc 127.0.0.1 8080.", "printf 'GET /api/health HTTP/1.1\\r\\nHost: localhost\\r\\n\\r\\n' | nc 127.0.0.1 8080"],
        check: function (r) { return ran(r, /\bnc\b.*127\.0\.0\.1\s+8080/, function (e) { return outHas(e, /^HTTP\/1\.1 200 OK/) && outHas(e, /"status":"ok"/); }) ? true : "Pipe a GET /api/health request into nc 127.0.0.1 8080: you should get HTTP/1.1 200 OK and {\"status\":\"ok\"}."; }
      },
      {
        id: "nohost", text: "Now send nginx (10.20.0.15, port 80) a request <b>without</b> a Host header. What does it answer?",
        hints: ["Same printf, with only the request line and the empty line.", "printf 'GET / HTTP/1.1\\r\\n\\r\\n' | nc 10.20.0.15 80"],
        check: function (r) { return ran(r, /\bnc\b.*(10\.20\.0\.15|kc-web-01|localhost|127\.0\.0\.1)\s+80\b/, function (e) { return outHas(e, /^HTTP\/1\.1 400 Bad Request/); }) ? true : "Send GET / HTTP/1.1 with no Host header to port 80: nginx answers 400 Bad Request."; }
      },
      {
        id: "codes", text: "Check every URL in <code>~/urls.txt</code>: one command that prints each URL's <b>status code</b> next to it.",
        hints: ["A while read loop over the file, with curl -s -o /dev/null -w for each URL.", "while read u; do curl -s -o /dev/null -w \"%{http_code} $u\\n\" \"$u\"; done < ~/urls.txt"],
        check: function (r) {
          function good(ctx, i) {
            var e = ctx.history[i], txt = e.out;
            return urlCodes(ctx).every(function (x) { return txt.some(function (l) { return l.indexOf(x.url) >= 0 && new RegExp("(^|\\s)" + x.code + "(\\s|$)").test(l); }); });
          }
          var k = -1;
          r.history.forEach(function (e, i) { if (/\bcurl\b/.test(e.cmd) && good(r, i)) k = i; });
          if (k < 0) return "One command should print every URL from ~/urls.txt with its status code (a loop with curl -w '%{http_code}').";
          var r2 = r.run(null, { files: { "urls.txt": URLS_ALT } });
          return r2.history[k] && good(r2, k) ? true : "Read the URLs from the file instead of typing them: with a different urls.txt your command didn't check the new list.";
        }
      },
      {
        id: "h3", text: "Read <code>~/captures/browser.pcap</code>. After the first TLS connection, which transport protocol and port does the browser use? Write the answer (for example <code>TCP 8443</code>) to <code>~/http3.txt</code>.",
        hints: ["tcpdump -r FILE -n. The later packets aren't TCP.", "tcpdump -r ~/captures/browser.pcap -n\necho 'UDP 443' > ~/http3.txt"],
        check: function (r) {
          if (!ran(r, /\btcpdump\b.*browser\.pcap/)) return "Read the capture with tcpdump -r ~/captures/browser.pcap -n.";
          var t = (r.read("http3.txt") || "").toUpperCase();
          return /UDP/.test(t) && /\b443\b/.test(t) && !/TCP/.test(t) ? true : "~/http3.txt should name the protocol and port the later packets use.";
        }
      }
    ],
    solution: lines("curl -v http://kestrel.example.com/", "curl -IL http://kestrel.example.com/", "printf 'GET /api/health HTTP/1.1\\r\\nHost: localhost\\r\\n\\r\\n' | nc 127.0.0.1 8080", "printf 'GET / HTTP/1.1\\r\\n\\r\\n' | nc 10.20.0.15 80", "while read u; do curl -s -o /dev/null -w \"%{http_code} $u\\n\" \"$u\"; done < ~/urls.txt", "tcpdump -r ~/captures/browser.pcap -n", "echo 'UDP 443' > ~/http3.txt"),
    debrief: "<p>Ticket closed. HTTP is a conversation you can read and even type: a 301 sends plain HTTP to HTTPS, the HTTPS site answers in HTTP/2 and advertises HTTP/3, and nginx refuses a request with no Host header because it can't know which site you want.</p><p>Marketing's broken pages: <code>/pricing</code> is a 404 (the page was renamed), and <code>/api/payments</code> was never a public URL. And the customer's \"hidden\" traffic is just HTTP/3: after the first visit, their browser switched to QUIC on <b>UDP 443</b>. Firewalls that only allow TCP 443 silently push browsers back to HTTP/2, which is worth knowing when you write rules.</p>",
    realworld: "curl -v https://example.com on any machine (curl ships with Windows 10+ and macOS). In a browser, the Network tab of the developer tools shows the same request and response headers, and a Protocol column with h2 or h3.",
    quiz: [
      { q: "nginx answers <b>502 Bad Gateway</b>. Where's the problem?", options: ["In your request", "In the app behind nginx: it didn't answer", "In DNS", "In the TLS certificate"], answer: 1, why: "502 means the proxy's upstream failed." },
      { q: "Why does HTTP/1.1 require a Host header?", options: ["For logging", "One server hosts many sites; Host says which", "For compression", "It doesn't"], answer: 1, why: "Name-based virtual hosting: same IP, different sites." },
      { q: "HTTP/3 runs over...", options: ["TCP 443", "UDP 443 (QUIC)", "TCP 80", "UDP 53"], answer: 1, why: "HTTP/3 uses QUIC, which runs over UDP." }
    ]
  });

  /* ================================================================== NET-111 Capstone: Why is the site down? */
  var EXPIRED = N.certs.leaf("kestrel.example.com", ["kestrel.example.com", "www.kestrel.example.com"], Date.UTC(2026, 7, 2, 4, 1, 9), Date.UTC(2026, 9, 31, 4, 1, 8));
  function outage(sys) {
    var nw = sys.nw;
    nw.ifs.eth0.autoneg = false; nw.ifs.eth0.speed = 100; nw.ifs.eth0.duplex = "full";
    setNetplan(sys, N.NETPLAN.replace("via: 10.20.0.1", "via: 10.20.0.11").replace("addresses: [10.20.0.2]", "addresses: [10.20.0.3]"));
    M2.putRoot(sys, "/etc/systemd/system/kestrel-app.service", (M2.rd(sys, "/etc/systemd/system/kestrel-app.service") || "").replace("127.0.0.1:8080", "127.0.0.1:8081"), 420, 0, 0, NOW - 12 * HOUR);
    sys.procs.forEach(function (p) { if (p.unit === "kestrel-app.service") { p.listen = [{ proto: "tcp", addr: "127.0.0.1", port: 8081 }]; p.cmd = p.cmd.replace("8080", "8081"); } });
    M2.daemonReload(sys);   // the contractor reloaded systemd after editing the unit
    N.writeLe(sys, "kestrel.example.com", EXPIRED, EXPIRED.nb + 60000);
    M2.putRoot(sys, "/var/log/letsencrypt/letsencrypt.log", "2026-10-02 00:00:09,114:ERROR:certbot._internal.renewal:Failed to renew certificate kestrel.example.com with error: HTTPSConnectionPool(host='acme-v02.api.letsencrypt.org', port=443): Max retries exceeded\n", 384);
    M2.writeRoot(sys, "/home/dev/maintenance-notes.txt", "Maintenance window 2026-11-10 22:00-23:30 (contractor)\n- \"optimised\" NIC settings for performance\n- updated network config (new gateway and DNS per the new plan)\n- moved kestrel-app to the new port layout\n", false);
    M2.jadd(sys, "systemd-networkd", 588, "eth0: Lost carrier", "systemd-networkd.service", 4, NOW - 10 * HOUR);
    M2.jadd(sys, "kernel", null, "virtio_net virtio0 eth0: Link is Up - 100Mbps/Full - flow control off", null, 6, NOW - 10 * HOUR + 4000);
  }
  var KEYS = [
    { name: "the duplex mismatch", re: /duplex|autoneg|ethtool|speed|half/i, ok: [1] },
    { name: "the wrong gateway", re: /gateway|10\.20\.0\.11|default route/i, ok: [3, 2] },
    { name: "the wrong DNS server", re: /dns|resolv|nameserver|10\.20\.0\.3/i, ok: [7] },
    { name: "the app's port", re: /808[01]|port|bind|listen|gunicorn|kestrel-app|502/i, ok: [4] },
    { name: "the expired certificate", re: /cert|tls|ssl|expir|certbot/i, ok: [6, 5] }
  ];
  LABS.push({
    id: "net-111", n: 11, module: 1, ticket: "NET-111", xp: 250, layer: "L1–7", capstone: true,
    title: "Why is the site down?",
    topic: "Capstone: troubleshoot from the cable up",
    from: MAYA,
    story: "<p><b>kestrel.example.com has been down since last night's maintenance window.</b> The contractor's notes are in <code>~/maintenance-notes.txt</code>; they \"changed a few things\". Monitoring only says the site is unreachable.</p><p>Work up the stack, layer by layer, and fix everything that's broken so <code>https://kestrel.example.com/api/health</code> answers again from kc-web-01. Then write <code>~/postmortem.txt</code>: one line per fault, starting with its layer, like <code>L3: ...</code>.</p>",
    learn:
      "<h3>Your brief</h3><p>No hints in a capstone. Work <b>bottom-up</b>: there's no point debugging DNS on a server whose link is broken, and a fix at one layer often reveals the next fault. The map above the terminal turns green as each part works again.</p>" +
      '<table class="t"><tr><th>Layer</th><th>Ask</th><th>Tools</th></tr>' +
      "<tr><td>1</td><td>Is the link healthy: speed, duplex, errors?</td><td><code>ip -br link</code>, <code>ethtool</code>, <code>ip -s link</code></td></tr>" +
      "<tr><td>2</td><td>Can I reach neighbours: ARP?</td><td><code>ip neigh</code>, <code>arping</code></td></tr>" +
      "<tr><td>3</td><td>Do I have the right address, and a route out?</td><td><code>ip a</code>, <code>ip r</code>, <code>ping</code>, <code>traceroute</code>, <code>/etc/netplan</code></td></tr>" +
      "<tr><td>4</td><td>Is the service listening where it should?</td><td><code>ss -tlnp</code>, <code>nc -zv</code></td></tr>" +
      "<tr><td>5–6</td><td>Is TLS working: certificate valid, served?</td><td><code>openssl s_client</code>, <code>certbot</code></td></tr>" +
      "<tr><td>7</td><td>Do names resolve, does the app answer?</td><td><code>dig</code>, <code>resolvectl</code>, <code>curl -v</code></td></tr></table>" +
      '<div class="callout">Fix things so they <b>survive a reboot</b>: settings in netplan and unit files, not just <code>ip</code> commands. (One exception: the NIC settings, which you can set with ethtool.)</div>' +
      "<p>The reference solution is hidden behind a button on the Tasks tab; revealing it halves this capstone's XP.</p>",
    system: outage,
    diagram: ["site"],
    starter: "",
    objectives: [
      {
        id: "l1", hints: [], text: "The link on eth0 is healthy: no duplex mismatch.",
        check: function (r) { var l = N.linkOf(nw(r), nw(r).ifs.eth0); if (!l.carrier) return "eth0 has no link."; return l.mismatch ? "eth0's link is up but not healthy. What do ethtool and ip -s link say?" : true; }
      },
      {
        id: "l3", hints: [], text: "kc-web-01 reaches the internet through kc-gw-01, and the setting is saved in netplan.",
        check: function (r) {
          if (!NH.reachOk(r, "1.1.1.1")) return "kc-web-01 can't reach the internet (try ping 1.1.1.1, ip r).";
          var e = N.npLoad(r.sys);
          return (e.conf.ethernets.eth0 && (e.conf.ethernets.eth0.routes || []).some(function (x) { return String(x.via) === "10.20.0.1"; })) ? true : "It works now, but netplan would put the wrong gateway back at the next reboot.";
        }
      },
      {
        id: "l7dns", hints: [], text: "Names resolve through the company DNS server, as configured in netplan.",
        check: function (r) {
          var a = N.askServer(r.sys, "127.0.0.53", "kestrel.example.com", "A", { quiet: true });
          if (a.err || a.status !== "NOERROR") return "Names don't resolve yet (dig kestrel.example.com, resolvectl status).";
          var ns = ((npConf(r).ethernets.eth0 || {}).nameservers || {}).addresses || [];
          return ns.map(String).indexOf("10.20.0.2") >= 0 && ns.map(String).indexOf("10.20.0.3") < 0 ? true : "Fix the DNS server in netplan, not only in the running system.";
        }
      },
      {
        id: "l6", hints: [], text: "kestrel.example.com serves a valid certificate.",
        check: function (r) { var t = N.tlsConnect(r.sys, W.PUB, 443, "kestrel.example.com"); if (!t.ok) return "Nothing serves TLS on 443."; var v = N.verifyChain(r.sys, t.chain); return v.code ? "The certificate nginx serves: " + v.text + "." : true; }
      },
      {
        id: "l4", hints: [], text: "The app listens where nginx expects it, and the setting survives a restart.",
        check: function (r) {
          if (listener(r, 8080, "kestrel-app.service") !== "127.0.0.1") return "nginx proxies /api/ to 127.0.0.1:8080. Is kestrel-app listening there?";
          return /127\.0\.0\.1:8080/.test(r.read("/etc/systemd/system/kestrel-app.service") || "") ? true : "Fix the port in kestrel-app's unit file too.";
        }
      },
      {
        id: "up", hints: [], text: "<code>curl https://kestrel.example.com/api/health</code> from kc-web-01 answers <code>{\"status\":\"ok\"}</code>.",
        check: function (r) {
          var s = NH.site(r.sys);
          if (s.st !== "ok") return "The site isn't healthy yet: " + s.why + ".";
          return ran(r, /\bcurl\b.*https:\/\/kestrel\.example\.com\/api\/health/, function (e) { return outHas(e, /"status":"ok"/); }) ? true : "Prove it with curl https://kestrel.example.com/api/health.";
        }
      },
      {
        id: "pm", hints: [], text: "<code>~/postmortem.txt</code> has one line per fault (five of them), each starting with the layer it was on: <code>L1:</code>, <code>L3:</code> ...",
        check: function (r) {
          var t = r.read("postmortem.txt");
          if (t === null) return "Write ~/postmortem.txt.";
          var rows = L(t).map(function (l) { var m = /^\s*L(\d)\s*[:\-–]\s*(.+)$/i.exec(l); return m ? { l: +m[1], text: m[2] } : null; }).filter(Boolean);
          for (var i = 0; i < KEYS.length; i++) {
            var k = KEYS[i], row = rows.filter(function (x) { return k.re.test(x.text); })[0];
            if (!row) return "No line about " + k.name + " (start each line with its layer, like L3: ...).";
            if (k.ok.indexOf(row.l) < 0) return "Which layer was " + k.name + " on? You wrote L" + row.l + ".";
          }
          return true;
        }
      }
    ],
    solution: lines(
      "cat ~/maintenance-notes.txt", "ip -br link", "ethtool eth0", "ip -s link show eth0", "sudo ethtool -s eth0 autoneg on", "ethtool eth0",
      "ip r", "ping -c 2 10.20.0.11", "sudo cat /etc/netplan/01-kestrel.yaml",
      "sudo sed -i 's/via: 10.20.0.11/via: 10.20.0.1/' /etc/netplan/01-kestrel.yaml", "sudo sed -i 's/10.20.0.3/10.20.0.2/' /etc/netplan/01-kestrel.yaml", "sudo netplan apply",
      "ping -c 2 1.1.1.1", "resolvectl status", "dig +short kestrel.example.com",
      "curl -v https://kestrel.example.com/api/health", "sudo certbot certificates", "sudo certbot renew", "sudo systemctl reload nginx",
      "curl -s https://kestrel.example.com/api/health", "sudo ss -tlnp", "grep ExecStart /etc/systemd/system/kestrel-app.service",
      "sudo sed -i 's/127.0.0.1:8081/127.0.0.1:8080/' /etc/systemd/system/kestrel-app.service", "sudo systemctl daemon-reload", "sudo systemctl restart kestrel-app",
      "curl -s https://kestrel.example.com/api/health",
      "nano ~/postmortem.txt",
      "    L1: eth0 was forced to 100 Mb/s full duplex while the switch auto-negotiated: duplex mismatch. Fixed with ethtool autoneg on.",
      "    L3: the default gateway in netplan was 10.20.0.11 instead of 10.20.0.1.",
      "    L7: the DNS server in netplan was 10.20.0.3, which doesn't exist; set back to 10.20.0.2.",
      "    L6: the TLS certificate had expired (renewals failed while the network was broken); renewed with certbot and reloaded nginx.",
      "    L4: kestrel-app listened on port 8081 but nginx proxies to 8080; fixed the unit file and restarted it."),
    debrief: "<p><b>Module 1 complete.</b> Five faults, five layers, and you found them in the right order: a duplex mismatch (L1) making everything flaky, a typo in the gateway (L3) cutting the server off, a DNS server that doesn't exist (L7), an expired certificate (L6) that couldn't renew while the network was down, and an app on the wrong port (L4) giving nginx nothing to talk to.</p>" +
      "<p>That's the method you'll use for the rest of your career: start at the bottom, prove each layer works, move up. Module 2 goes deeper into the middle of the stack: the ports that matter, and capturing and reading real traffic.</p>",
    realworld: "Write your own one-page checklist from the table in the brief. When something \"doesn't work\" on any network, at home or at work, run through it from layer 1 up before guessing.",
    quiz: []
  });

  /* ================================================================== the rest of the track (outline, from outline.html) */
  var UPCOMING = [
    [2, "The top 15 ports", "/etc/services, ss -tulpn, banners"], [2, "Infrastructure ports & secure pairs", "databases, caches, plain vs encrypted"], [2, "tcpdump basics", "interfaces, filters, saving"], [2, "The TCP handshake", "SYN, SYN-ACK, ACK, RST vs drop"], [2, "Reading captures", "tcpdump -r, tshark"],
    [2, "ICMP & MTU", "ping, unreachable, MTU black holes"], [2, "DNS & DHCP on the wire", "UDP 53, how hosts get addresses"], [2, "Slow, not down", "latency, loss, mtr, curl -w"], [2, "Proxies & load balancers", "L4 vs L7, X-Forwarded-For"], [2, "The mystery capture", "Module 2 capstone", true],
    [3, "Clear text on the wire", "HTTP and Telnet vs HTTPS and SSH"], [3, "Scans & brute force", "captures, logs, fail2ban"], [3, "Man in the middle on the LAN", "ARP spoofing, rogue DHCP"], [3, "DNS spoofing & cache poisoning", "fake answers"], [3, "Floods & DoS", "SYN floods, SYN cookies"], [3, "Suricata IDS", "rules and alerts"], [3, "Zeek logs", "conn.log, dns.log, http.log"], [3, "Reconstruct an intrusion", "Module 3 capstone", true],
    [4, "Scan your own servers", "nmap, only hosts in scope"], [4, "Dangerous open ports", "Telnet, SMB, Redis, Docker API..."], [4, "ufw", "deny by default"], [4, "nftables", "chains, counters, IPv6"], [4, "Segmentation", "web, app and database tiers"], [4, "Bastion hosts", "ProxyJump, key-only SSH"], [4, "WireGuard VPN", "keys, peers, AllowedIPs"], [4, "HTTPS done right", "redirects, HSTS, modern TLS"], [4, "DNS & email security", "SPF, DKIM, DMARC, DNSSEC"], [4, "Lock down Kestrel's network", "Module 4 capstone", true],
    [5, "VPCs", "subnets, route tables, gateways"], [5, "Security groups vs network ACLs", "stateful vs stateless"], [5, "Cloud load balancers & DNS", "health checks, records"], [5, "Docker networking", "bridges, -p and ufw"], [5, "VPC flow logs", "scans and exfiltration"], [5, "Zero trust & mTLS", "services prove who they are"], [5, "Egress control, WAF & CDN", "what a WAF can stop"], [5, "Network rules as code", "Terraform security groups"], [5, "Contain a compromised instance", "Module 5 capstone", true]
  ].map(function (x) { return { module: x[0], title: x[1], topic: x[2], capstone: !!x[3] }; });
  var MODULES = [{ n: 1, name: "Up the OSI stack" }, { n: 2, name: "Ports & traffic" }, { n: 3, name: "Attacks & detection" }, { n: 4, name: "Defending the network" }, { n: 5, name: "Cloud networks & DevSecOps" }];
  LABS.forEach(function (l) { l.drills = l.drills || []; });
  window.NET_TRACK = { MODULES: MODULES, LABS: LABS, UPCOMING: UPCOMING, ex: ex, code: code, lines: lines, M1: { webCapture: webCapture, movedCable: movedCable, dupDb: dupDb, wrongMask: wrongMask, v6off: v6off, apiOn: apiOn, tlsLab: tlsLab, staleHosts: staleHosts, outage: outage, setNetplan: setNetplan, unitText: unitText, listener: listener, LATIN: LATIN, PW: PW } };
})();
