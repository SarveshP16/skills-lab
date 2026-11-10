/* ==========================================================================
   Networking, security and DevOps tools for the simulated shell
   ========================================================================== */
const PORT_NAMES = { 21:'ftp', 22:'ssh', 23:'telnet', 25:'smtp', 53:'domain', 80:'http', 443:'https', 445:'microsoft-ds', 3389:'ms-wbt-server', 5432:'postgresql', 6379:'redis', 8080:'http-proxy', 8554:'rtsp-alt' };
const HTTP_TEXT = { 200:'OK', 201:'Created', 301:'Moved Permanently', 302:'Found', 403:'Forbidden', 404:'Not Found', 500:'Internal Server Error', 502:'Bad Gateway', 503:'Service Unavailable' };

/* ---------- network model helpers */
const localIPs = S => ['127.0.0.1', S.net.iface.ip];
const isLocal = (S, ip) => ip.startsWith('127.') || ip === S.net.iface.ip || ip === '0.0.0.0';
function reachable(S, ip) {
  if (isLocal(S, ip)) return { rtt:0.035, ttl:64 };
  const h = S.net.hosts[ip]; if (!h || h.down) return null;
  return { rtt:h.rtt ?? 0.55, ttl:h.ttl ?? 64 };
}
function nameservers(S) {
  const c = (getNode(S, '/etc/resolv.conf') || {}).content || '';
  return lines(c).map(l => l.replace(/[#;].*/, '').trim()).filter(l => /^nameserver\s+\S/.test(l)).map(l => l.split(/\s+/)[1]);
}
function dnsQuery(S, name, server) {
  const servers = server ? [server] : nameservers(S);
  const fqdn = name.replace(/\.$/, '').toLowerCase();
  for (const s of servers) {
    const srv = S.net.dnsServers[s];
    if (!srv || !reachable(S, s)) continue;
    const cands = fqdn.includes('.') ? [fqdn] : [fqdn + '.halcyon.lan'];
    for (const c of cands) { const ip = S.net.dns[c]; if (ip && (srv.internal || !c.endsWith('.lan'))) return { ip, server:s, fqdn:c }; }
    return { nx:true, server:s, fqdn:cands[0] };
  }
  return { timeout:true, servers };
}
function resolve(S, name) {
  if (isIP(name)) return { ip:name };
  if (name === 'localhost') return { ip:'127.0.0.1', name };
  if (name === S.host) return { ip:'127.0.1.1', name };
  if (name === '_gateway') return { ip:S.net.gw, name };
  const hosts = (getNode(S, '/etc/hosts') || {}).content || '';
  for (const l of lines(hosts)) { const p = l.replace(/#.*/, '').trim().split(/\s+/); if (p.length > 1 && p.slice(1).includes(name)) return { ip:p[0], name }; }
  const q = dnsQuery(S, name);
  if (q.ip) return { ip:q.ip, name };
  return { err:q.timeout ? 'Temporary failure in name resolution' : 'Name or service not known', timeout:q.timeout };
}
function sockets(S) {
  const out = [];
  for (const p of S.procs) for (const l of (p.listen || [])) out.push({ ...l, proc:p.name || p.cmd.split(' ')[0], pid:p.pid });
  for (const svc of Object.values(S.services)) if (svc.state === 'active' && svc.listen) for (const l of svc.listen(S)) out.push({ ...l, proc:svc.proc || svc.name, pid:svc.pid });
  if (S.docker) for (const c of S.docker.containers) if (c.status === 'running') for (const m of c.ports) out.push({ p:'tcp', a:'0.0.0.0', port:m.host, proc:'docker-proxy', pid:c.proxyPid, docker:{ c, m } });
  return out;
}
function httpRequest(S, ip, port, path, hostHeader) {
  if (isLocal(S, ip)) {
    const sock = sockets(S).find(s => s.p === 'tcp' && s.port === port && (s.a === '0.0.0.0' || s.a === '*' || s.a === '[::]' || (ip.startsWith('127.') && s.a.startsWith('127.')) || s.a === ip));
    if (!sock) return { err:`curl: (7) Failed to connect to ${hostHeader} port ${port} after 0 ms: Couldn't connect to server`, code:7 };
    if (sock.docker) return dockerHttp(S, sock.docker.c, sock.docker.m, path);
    if (!sock.http) return { err:'curl: (52) Empty reply from server', code:52 };
    return sock.http(S, path, hostHeader);
  }
  const h = S.net.hosts[ip];
  if (!h || h.down) return { err:`curl: (28) Failed to connect to ${hostHeader} port ${port} after 10002 ms: Timeout was reached`, code:28 };
  if (h.http && h.http[port]) return h.http[port](S, path, hostHeader);
  if (h.ports && h.ports[port]) return { err:'curl: (52) Empty reply from server', code:52 };
  return { err:`curl: (7) Failed to connect to ${hostHeader} port ${port} after 2 ms: Couldn't connect to server`, code:7 };
}
const html = (title, body) => `<!doctype html>\n<html><head><title>${title}</title></head>\n<body>\n${body}\n</body></html>`;

/* ---------- ip / ifconfig / route */
def('ip', 'ip addr | ip route | ip link — show network interfaces, IP addresses and the routing table (iproute2)', ({ S, args }) => {
  const br = args.includes('-br'); const a = args.filter(x => !x.startsWith('-')); const obj = a[0] || '';
  const I = S.net.iface; const info = cidrInfo(I.ip, I.bits);
  if (/^a(d(d(r(e(s(s)?)?)?)?)?)?$/.test(obj)) {
    if (br) return ok(`lo               UNKNOWN        127.0.0.1/8 ::1/128\n${I.name.padEnd(16)} UP             ${I.ip}/${I.bits} fe80::5054:ff:fe3a:9c11/64`);
    return ok([`1: lo: <LOOPBACK,UP,LOWER_UP> mtu 65536 qdisc noqueue state UNKNOWN group default qlen 1000`,
      `    link/loopback 00:00:00:00:00:00 brd 00:00:00:00:00:00`,
      `    inet ${C.m}127.0.0.1${C.x}/8 scope host lo`, `       valid_lft forever preferred_lft forever`,
      `2: ${C.c}${I.name}${C.x}: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 qdisc fq_codel state ${C.g}UP${C.x} group default qlen 1000`,
      `    link/ether ${C.y}${I.mac}${C.x} brd ff:ff:ff:ff:ff:ff`,
      `    inet ${C.m}${I.ip}${C.x}/${I.bits} brd ${info.bcast} scope global dynamic ${I.name}`, `       valid_lft 85912sec preferred_lft 85912sec`].join('\n'));
  }
  if (/^r(o(u(t(e)?)?)?)?$/.test(obj)) {
    if (a[1] === 'add' || a[1] === 'del') return S.root ? ok() : fail('RTNETLINK answers: Operation not permitted', 2);
    return ok([`default via ${S.net.gw} dev ${I.name} proto dhcp src ${I.ip} metric 100`, `${info.net}/${I.bits} dev ${I.name} proto kernel scope link src ${I.ip} metric 100`, ...(S.net.extraRoutes || [])].join('\n'));
  }
  if (/^l(i(n(k)?)?)?$/.test(obj)) return ok(`1: lo: <LOOPBACK,UP,LOWER_UP> mtu 65536 qdisc noqueue state UNKNOWN mode DEFAULT group default qlen 1000\n    link/loopback 00:00:00:00:00:00 brd 00:00:00:00:00:00\n2: ${I.name}: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 qdisc fq_codel state UP mode DEFAULT group default qlen 1000\n    link/ether ${I.mac} brd ff:ff:ff:ff:ff:ff`);
  if (/^n(e(i(g(h)?)?)?)?$/.test(obj)) return ok(Object.keys(S.net.hosts).filter(ip => inCidr(ip, `${I.ip}/${I.bits}`)).slice(0, 4).map(ip => `${ip} dev ${I.name} lladdr 52:54:00:${ip.split('.').slice(1).map(n => (+n).toString(16).padStart(2, '0')).join(':')} REACHABLE`).join('\n'));
  return fail(`Object "${obj}" is unknown, try "ip help".`, 255);
});
def('ifconfig', 'ifconfig — older tool to show interfaces (ip addr is the modern one)', ({ S }) => {
  const I = S.net.iface; const info = cidrInfo(I.ip, I.bits);
  return ok(`${I.name}: flags=4163<UP,BROADCAST,RUNNING,MULTICAST>  mtu 1500\n        inet ${I.ip}  netmask ${info.mask}  broadcast ${info.bcast}\n        ether ${I.mac}  txqueuelen 1000  (Ethernet)\n\nlo: flags=73<UP,LOOPBACK,RUNNING>  mtu 65536\n        inet 127.0.0.1  netmask 255.0.0.0\n        loop  txqueuelen 1000  (Local Loopback)`);
});
def('route', 'route -n — older tool to show the routing table (ip route is the modern one)', ({ S }) => {
  const I = S.net.iface; const info = cidrInfo(I.ip, I.bits);
  return ok(`Kernel IP routing table\nDestination     Gateway         Genmask         Flags Metric Ref    Use Iface\n0.0.0.0         ${S.net.gw.padEnd(15)} 0.0.0.0         UG    100    0        0 ${I.name}\n${info.net.padEnd(15)} 0.0.0.0         ${info.mask.padEnd(15)} U     100    0        0 ${I.name}`);
});

/* ---------- ping */
def('ping', 'ping [-c N] HOST — send ICMP echo requests to test if a host is reachable and how fast', ({ S, args }) => {
  const { f, pos } = opts(args, 'cWiws'); const target = pos[0];
  if (!target) return fail('ping: usage error: Destination address required', 2);
  const count = Math.max(1, Math.min(+(f.c || 4) || 4, 10));
  const r = resolve(S, target); if (r.err) return fail(`ping: ${target}: ${r.err}`, 2);
  const ip = r.ip, reach = reachable(S, ip);
  const label = r.name && r.name !== ip ? `${r.name} (${ip})` : ip;
  const L = [`PING ${target} (${ip}) 56(84) bytes of data.`];
  if (reach) {
    const t = []; for (let i = 1; i <= count; i++) { const v = reach.rtt * (0.85 + Math.random() * 0.3); t.push(v); L.push(`64 bytes from ${label}: icmp_seq=${i} ttl=${reach.ttl} time=${v < 10 ? v.toFixed(3) : v.toFixed(1)} ms`); }
    const avg = t.reduce((a, b) => a + b) / count;
    L.push('', `--- ${target} ping statistics ---`, `${count} packets transmitted, ${count} received, 0% packet loss, time ${(count - 1) * 1001}ms`, `rtt min/avg/max/mdev = ${Math.min(...t).toFixed(3)}/${avg.toFixed(3)}/${Math.max(...t).toFixed(3)}/${(avg * 0.07).toFixed(3)} ms`);
    return { out:L.join('\n'), code:0, meta:{ ip, ok:true } };
  }
  L.push('', `--- ${target} ping statistics ---`, `${count} packets transmitted, 0 received, ${C.r}100% packet loss${C.x}, time ${(count - 1) * 1000 + 31}ms`);
  return { out:L.join('\n'), code:1, meta:{ ip, ok:false } };
});

/* ---------- DNS */
function digOut(S, name, q, short, type) {
  if (short) return q.ip ? ok(q.ip) : q.timeout ? fail(`;; communications error to ${q.servers[0] || '?'}#53: timed out\n;; no servers could be reached`, 9) : ok('');
  const head = `\n; <<>> DiG 9.18.28-0ubuntu0.24.04.1-Ubuntu <<>> ${name}\n;; global options: +cmd`;
  if (q.timeout) { const s = q.servers[0] || '127.0.0.1'; return { out:'', err:`;; communications error to ${s}#53: timed out\n;; communications error to ${s}#53: timed out\n;; communications error to ${s}#53: timed out\n${head.trim()}\n;; no servers could be reached`, code:9 }; }
  const fq = q.fqdn + '.';
  const L = [head, ';; Got answer:', `;; ->>HEADER<<- opcode: QUERY, status: ${q.ip ? 'NOERROR' : C.r + 'NXDOMAIN' + C.x}, id: ${Math.floor(1000 + Math.random() * 60000)}`, `;; flags: qr rd ra; QUERY: 1, ANSWER: ${q.ip ? 1 : 0}, AUTHORITY: ${q.ip ? 0 : 1}, ADDITIONAL: 1`, '', ';; QUESTION SECTION:', `;${fq}\t\t\tIN\t${type}`, ''];
  if (q.ip) L.push(';; ANSWER SECTION:', `${fq}\t300\tIN\tA\t${C.g}${q.ip}${C.x}`, '');
  else L.push(';; AUTHORITY SECTION:', `${fq.split('.').slice(-2).join('.')}\t\t900\tIN\tSOA\ta.root-servers.net. nstld.verisign-grs.com. 2026111000 1800 900 604800 86400`, '');
  L.push(`;; Query time: ${Math.floor(1 + Math.random() * 3)} msec`, `;; SERVER: ${q.server}#53(${q.server}) (UDP)`, `;; WHEN: ${dateStr()}`, ';; MSG SIZE  rcvd: 65');
  return { out:L.join('\n'), code:0, meta:{ server:q.server, answered:!!q.ip } };
}
def('dig', 'dig [@SERVER] NAME [+short] — ask a DNS server for a name\'s records. @SERVER picks which server to ask', ({ S, args }) => {
  const at = args.find(a => a.startsWith('@')); const short = args.includes('+short');
  const rest = args.filter(a => !a.startsWith('@') && !a.startsWith('+') && !a.startsWith('-'));
  const type = (rest.find(a => /^(A|AAAA|MX|NS|TXT|CNAME|SOA)$/i.test(a)) || 'A').toUpperCase();
  const name = rest.find(a => !/^(A|AAAA|MX|NS|TXT|CNAME|SOA|IN)$/i.test(a));
  if (!name) return ok('\n; <<>> DiG 9.18.28-0ubuntu0.24.04.1-Ubuntu <<>>\n;; global options: +cmd\n;; (root hints omitted in this training shell — give dig a name to look up)');
  const server = at ? at.slice(1) : null;
  if (server && !isIP(server)) return fail(`dig: couldn't get address for '${server}': not found`, 10);
  const q = dnsQuery(S, name, server);
  const res = digOut(S, name, q, short, type);
  res.meta = { ...(res.meta || {}), server:q.server || server, answered:!!q.ip, name };
  return res;
});
def(['nslookup', 'host'], 'nslookup NAME [SERVER] — simple DNS lookup', ({ S, args, name: cmd }) => {
  const [name, server] = args.filter(a => !a.startsWith('-')); if (!name) return fail(`usage: ${cmd} NAME [SERVER]`);
  const q = dnsQuery(S, name, server);
  if (q.timeout) return fail(';; connection timed out; no servers could be reached', 1);
  if (cmd === 'host') return q.ip ? ok(`${q.fqdn} has address ${q.ip}`) : fail(`Host ${name} not found: 3(NXDOMAIN)`);
  const head = `Server:\t\t${q.server}\nAddress:\t${q.server}#53\n\n`;
  return q.ip ? { out:head + `Name:\t${q.fqdn}\nAddress: ${q.ip}`, code:0, meta:{ server:q.server, answered:true, name } } : { out:head + `** server can't find ${q.fqdn}: NXDOMAIN`, code:1 };
});

/* ---------- curl */
def('curl', 'curl [-I] [-v] [-s] URL — make an HTTP request and print the response. -I shows only headers', ({ S, args }) => {
  const { f, pos } = opts(args, 'XHdowmA'); let url = pos[0];
  if (!url) return fail("curl: try 'curl --help' or 'curl --manual' for more information", 2);
  if (!/^[a-z]+:\/\//i.test(url)) url = 'http://' + url;
  const m = /^(https?):\/\/([^/:?#]+)(?::(\d+))?([^#]*)$/i.exec(url);
  if (!m) return fail(`curl: (3) URL using bad/illegal format or missing URL`, 3);
  const [, scheme, host, portS, rawPath] = m; const port = +(portS || (scheme === 'https' ? 443 : 80)); const path = rawPath || '/';
  const r = resolve(S, host);
  const meta = { host, port, path };
  if (r.err) { S.flags.curlResolveFail = host; return { err:`curl: (6) Could not resolve host: ${host}`, code:6, meta }; }
  meta.ip = r.ip;
  const resp = httpRequest(S, r.ip, port, path, host);
  if (resp.err) return { err:resp.err, code:resp.code || 7, meta };
  const status = resp.status || 200; meta.status = status;
  const hdrs = [`HTTP/1.1 ${status} ${HTTP_TEXT[status] || ''}`, `Server: ${resp.server || 'nginx/1.24.0 (Ubuntu)'}`, `Date: Tue, 10 Nov 2026 ${shiftTime(true)} GMT`, `Content-Type: ${resp.type || 'text/html'}`, `Content-Length: ${new TextEncoder().encode(resp.body || '').length}`, 'Connection: keep-alive'];
  let out = '';
  if (f.v) out += [`*   Trying ${r.ip}:${port}...`, `* Connected to ${host} (${r.ip}) port ${port}`, `> GET ${path} HTTP/1.1`, `> Host: ${host}${portS ? ':' + port : ''}`, '> User-Agent: curl/8.5.0', '> Accept: */*', '>', ...hdrs.map(h => '< ' + h), '<', ''].join('\n');
  if (f.I || f.head) out += hdrs.join('\n');
  else if (f.i) out += hdrs.join('\n') + '\n\n' + (resp.body || '');
  else if (f.o) { const w = writeFile(S, f.o, resp.body || '', false, 'curl'); if (w.err) return fail(w.err.replace('curl: ', 'curl: (23) Failure writing output to destination: '), 23); }
  else out += resp.body || '';
  if (f.w) out += String(f.w).replace(/%\{http_code\}/g, status).replace(/\\n/g, '\n');
  if (f.f && status >= 400) return { out:'', err:`curl: (22) The requested URL returned error: ${status}`, code:22, meta };
  return { out, code:0, meta };
});

/* ---------- ss / netstat */
function sockRows(S, f) {
  const want = s => (!f.t && !f.u) || (f.t && s.p === 'tcp') || (f.u && s.p === 'udp');
  return sockets(S).filter(want).sort((a, b) => (a.p === b.p ? a.port - b.port : a.p < b.p ? 1 : -1));
}
def('ss', 'ss -tulpn — list listening sockets: -t TCP, -u UDP, -l listening, -p process (needs sudo for other users\' processes), -n numeric ports', ({ S, args }) => {
  const { f } = opts(args);
  if (!f.l && !f.a) return ok(`Netid State Recv-Q Send-Q   Local Address:Port      Peer Address:Port Process\ntcp   ESTAB 0      36      ${S.net.iface.ip}:22          10.20.4.15:52110`);
  const rows = sockRows(S, f).map(s => {
    const local = `${s.a}:${f.n ? s.port : (PORT_NAMES[s.port] || s.port)}`;
    const own = S.procs.find(p => p.pid === s.pid); const mine = !own || own.user === S.user;
    const proc = f.p && (S.root || mine) ? `users:(("${s.proc}",pid=${s.pid},fd=${3 + (s.port % 5)}))` : '';
    return [s.p, s.p === 'udp' ? 'UNCONN' : 'LISTEN', '0', s.p === 'udp' ? '0' : '4096', local, s.p === 'udp' ? '0.0.0.0:*' : '0.0.0.0:*', proc];
  });
  const head = ['Netid', 'State', 'Recv-Q', 'Send-Q', 'Local Address:Port', 'Peer Address:Port', 'Process'];
  const all = [head, ...rows]; const w = head.map((_, i) => Math.max(...all.map(r => r[i].length)));
  const out = all.map(r => r.map((c, i) => i === 6 ? c : (i === 4 ? c.padStart(w[i]) : c.padEnd(w[i]))).join(' ').trimEnd()).join('\n');
  const note = f.p && !S.root && rows.some(r => !r[6]) ? `\n${C.d}(processes owned by other users are hidden — run with sudo to see them)${C.x}` : '';
  return { out:out + note, code:0, meta:{ procs:!!(f.p && S.root) } };
});
def('netstat', 'netstat -tulpn — older tool to list listening ports (ss is the modern one)', ({ S, args }) => {
  const { f } = opts(args);
  const L = ['Active Internet connections (only servers)', 'Proto Recv-Q Send-Q Local Address           Foreign Address         State       PID/Program name'];
  for (const s of sockRows(S, f)) { const own = S.procs.find(p => p.pid === s.pid); const show = f.p && (S.root || !own || own.user === S.user); L.push(`${s.p.padEnd(5)}      0      0 ${(s.a.replace('%lo', '') + ':' + (f.n ? s.port : PORT_NAMES[s.port] || s.port)).padEnd(23)} ${'0.0.0.0:*'.padEnd(23)} ${(s.p === 'tcp' ? 'LISTEN' : '').padEnd(11)} ${show ? s.pid + '/' + s.proc : '-'}`); }
  return { out:L.join('\n'), code:0, meta:{ procs:!!(f.p && S.root) } };
});

/* ---------- traceroute */
def(['traceroute', 'tracepath', 'tracert'], 'traceroute HOST — show each router (hop) between you and a host, using TTL expiry', ({ S, args }) => {
  const t = args.filter(a => !a.startsWith('-'))[0]; if (!t) return fail('Usage: traceroute [ -46dFITnreAUDV ] host');
  const r = resolve(S, t); if (r.err) return fail(`${t}: ${r.err}\nCannot handle "host" cmdline arg \`${t}' on position 1 (argc 1)`, 2);
  let hops = S.net.trace && S.net.trace[r.ip];
  if (!hops) { const local = inCidr(r.ip, `${S.net.iface.ip}/${S.net.iface.bits}`); const h = S.net.hosts[r.ip]; hops = (local ? [] : [{ ip:S.net.gw, name:'_gateway', ms:0.4 }]).concat(h && !h.down ? [{ ip:r.ip, name:h.name, ms:h.rtt || 0.6 }] : ['*', '*', '*', '*', '*', '*']); }
  const L = [`traceroute to ${t} (${r.ip}), 30 hops max, 60 byte packets`];
  hops.forEach((h, i) => {
    const n = String(i + 1).padStart(2);
    if (h === '*') { L.push(`${n}  * * *`); return; }
    const ms = () => (h.ms * (0.9 + Math.random() * 0.2)).toFixed(3) + ' ms';
    L.push(`${n}  ${h.name || h.ip} (${h.ip})  ${ms()}  ${ms()}  ${ms()}`);
  });
  if (hops[hops.length - 1] === '*') L.push(`${C.d}(… silent up to hop 30 — trimmed)${C.x}`);
  return { out:L.join('\n'), code:0, meta:{ ip:r.ip } };
});

/* ---------- nmap */
function targetsFor(S, spec) {
  if (/^[\d.]+\/\d+$/.test(spec)) { const ips = [S.net.iface.ip, ...Object.keys(S.net.hosts)].filter(ip => inCidr(ip, spec)); return { ips:[...new Set(ips)].sort((a, b) => ip2n(a) - ip2n(b)), total:2 ** (32 - +spec.split('/')[1]) }; }
  const r = resolve(S, spec); if (r.err) return { err:`Failed to resolve "${spec}".` };
  return { ips:[r.ip], total:1 };
}
def('nmap', 'nmap [-sn] [-sV] [-p PORTS] TARGET — network scanner. -sn: which hosts are up (no port scan). -sV: detect service versions. Only scan networks you are authorised to test', ({ S, args }) => {
  const { f, pos } = opts(args, 'p'); const spec = pos[0];
  if (!spec) return ok('Nmap 7.94SVN ( https://nmap.org )\nUsage: nmap [Scan Type(s)] [Options] {target specification}');
  if (S.lab.scope && !S.lab.scope(spec)) return { out:'', err:`${C.y}Out of scope.${C.x} The authorised scope for this ticket is ${S.lab.scopeText}. Scanning anything else could break the law and the rules of engagement.`, code:1, meta:{ outOfScope:true } };
  const t = targetsFor(S, spec); if (t.err) return fail(t.err + '\nWARNING: No targets were specified, so 0 hosts scanned.');
  const sweep = f.s && f.n; const ver = (f.s && f.V) || f.A;
  let portFilter = null;
  if (f.p) { portFilter = new Set(); if (f.p !== '-') for (const part of String(f.p).split(',')) { const [a, b] = part.split('-').map(Number); for (let i = a; i <= (b || a); i++) portFilter.add(i); } }
  const L = [`Starting Nmap 7.94SVN ( https://nmap.org ) at 2026-11-10 ${shiftTime()} UTC`]; let up = 0;
  for (const ip of t.ips) {
    const self = ip === S.net.iface.ip; const h = self ? { name:S.host, ports:Object.fromEntries(sockets(S).filter(s => s.p === 'tcp' && s.a === '0.0.0.0').map(s => [s.port, { svc:PORT_NAMES[s.port] || 'unknown', ver:s.ver || '' }])) } : S.net.hosts[ip];
    if (!h || h.down) continue; up++;
    L.push(`Nmap scan report for ${h.name ? `${h.name} (${ip})` : ip}`, `Host is up (${self ? '0.000010' : (0.0003 + Math.random() * 0.0004).toFixed(5)}s latency).`);
    if (sweep) { if (h.mac && !self) L.push(`MAC Address: ${h.mac}`); continue; }
    let ports = Object.entries(h.ports || {}).map(([p, v]) => [+p, v]).filter(([p]) => !portFilter || portFilter.has(p) || f.p === '-');
    const scanned = portFilter && f.p !== '-' ? portFilter.size : (f.p === '-' ? 65535 : 1000);
    if (!ports.length) { L.push(`All ${scanned} scanned ports on ${h.name || ip} are in ignored states.`, `Not shown: ${scanned} closed tcp ports (reset)`, ''); continue; }
    if (scanned - ports.length > 0) L.push(`Not shown: ${scanned - ports.length} closed tcp ports (reset)`);
    L.push(ver ? 'PORT      STATE SERVICE       VERSION' : 'PORT      STATE SERVICE');
    for (const [p, v] of ports) L.push(`${(p + '/tcp').padEnd(9)} ${C.g}open${C.x}  ${(v.svc || 'unknown').padEnd(13)}${ver ? ' ' + (v.ver || '') : ''}`.trimEnd());
    if (ver && h.os) L.push(`Service Info: ${h.os}`);
    L.push('');
  }
  L.push(`Nmap done: ${t.total} IP address${t.total > 1 ? 'es' : ''} (${up} host${up === 1 ? '' : 's'} up) scanned in ${(sweep ? 1.8 : ver ? 14.6 : 3.4).toFixed(2)} seconds`);
  return { out:L.join('\n'), code:0, meta:{ sweep, ver, spec, ips:t.ips, up } };
});

/* ---------- ipcalc */
def('ipcalc', 'ipcalc ADDRESS/PREFIX — show network, broadcast, host range and host count for a subnet, with the binary', ({ args }) => {
  const a = args.find(x => !x.startsWith('-')); if (!a) return fail('ipcalc: give an address like 192.168.10.77/26');
  let [ip, bits] = a.split('/'); bits = bits == null ? 24 : (isIP(bits) ? 32 - Math.log2(2 ** 32 - ip2n(bits)) : +bits);
  if (!isIP(ip) || !(bits >= 0 && bits <= 32)) return fail(`INVALID ADDRESS: ${a}`);
  const i = cidrInfo(ip, bits);
  const bin = s => { const b = ip2n(s).toString(2).padStart(32, '0'); let net = '', host = ''; for (let k = 0; k < 32; k++) { if (k && k % 8 === 0) { if (k - 1 < bits) net += '.'; else host += '.'; } if (k < bits) net += b[k]; else host += b[k]; } return `${C.b}${net}${C.x}${host ? ' ' + C.y + host + C.x : ''}`; };
  const row = (k, v, b) => `${(k + ':').padEnd(11)}${String(v).padEnd(21)}${b ? bin(b) : ''}`;
  const first = +ip.split('.')[0]; const cls = first < 128 ? 'A' : first < 192 ? 'B' : first < 224 ? 'C' : 'D';
  const priv = inCidr(ip, '10.0.0.0/8') || inCidr(ip, '172.16.0.0/12') || inCidr(ip, '192.168.0.0/16');
  return ok([row('Address', ip, ip), row('Netmask', `${i.mask} = ${bits}`, i.mask), row('Wildcard', i.wildcard, i.wildcard), '=>',
    row('Network', `${i.net}/${bits}`, i.net), row('HostMin', i.first, i.first), row('HostMax', i.last, i.last), row('Broadcast', i.bcast, i.bcast),
    `${'Hosts/Net:'.padEnd(11)}${String(i.hosts).padEnd(21)}Class ${cls}${priv ? ', Private Internet' : ''}`, '',
    `${C.d}blue = network bits (fixed), yellow = host bits (free to number hosts)${C.x}`].join('\n'));
});

/* ---------- ufw */
def('ufw', 'ufw status [numbered] | ufw deny from IP | ufw insert N deny from IP | ufw delete N — Uncomplicated Firewall. Rules are checked top to bottom; the first match wins', ({ S, args }) => {
  if (!S.fw) return fail('ufw: command not found', 127);
  const sub = args[0];
  const fmtTo = r => r.to; const fmtFrom = r => r.from;
  if (!S.root) return fail('ERROR: You need to be root to run this script');
  if (!sub || sub === 'status') {
    if (!S.fw.enabled) return ok('Status: inactive');
    const num = args[1] === 'numbered';
    const L = ['Status: active', ''];
    if (args[1] === 'verbose') L.push('Logging: on (low)', 'Default: deny (incoming), allow (outgoing), disabled (routed)', 'New profiles: skip', '');
    L.push(`${num ? '     ' : ''}To                         Action      From`, `${num ? '     ' : ''}--                         ------      ----`);
    S.fw.rules.forEach((r, i) => L.push(`${num ? `[${String(i + 1).padStart(2)}] ` : ''}${fmtTo(r).padEnd(27)}${(r.action + (num ? ' IN' : '')).padEnd(12)}${fmtFrom(r)}`));
    return ok(L.join('\n'));
  }
  const parseRule = a => {
    const action = a[0].toUpperCase(); if (!['ALLOW', 'DENY', 'REJECT', 'LIMIT'].includes(action)) return null;
    let from = 'Anywhere', to = 'Anywhere';
    for (let i = 1; i < a.length; i++) { if (a[i] === 'from') from = a[++i] === 'any' ? 'Anywhere' : a[i]; else if (a[i] === 'to') { const v = a[++i]; if (v !== 'any') to = v; } else if (a[i] === 'port') to = a[++i] + (to !== 'Anywhere' && to.includes('/') ? '' : ''); else if (a[i] === 'proto') to += '/' + a[++i]; else if (i === 1) to = a[i]; }
    return { action, from, to };
  };
  if (sub === 'enable') { S.fw.enabled = true; return ok('Firewall is active and enabled on system startup'); }
  if (sub === 'disable') { S.fw.enabled = false; return ok('Firewall stopped and disabled on system startup'); }
  if (sub === 'reload') return ok('Firewall reloaded');
  if (sub === 'delete') { const n = +args[1]; if (!n || !S.fw.rules[n - 1]) return fail('ERROR: Could not find rule \'' + (args[1] || '') + '\''); const r = S.fw.rules.splice(n - 1, 1)[0]; return ok(`Deleting:\n ${r.action.toLowerCase()} from ${r.from} to ${r.to}\nRule deleted`); }
  if (sub === 'insert') { const n = +args[1]; const r = parseRule(args.slice(2)); if (!n || !r) return fail('ERROR: Invalid syntax'); if (n > S.fw.rules.length + 1) return fail(`ERROR: Invalid position '${n}'`); S.fw.rules.splice(n - 1, 0, r); return ok('Rule inserted'); }
  const r = parseRule(args); if (!r) return fail(`ERROR: Invalid syntax\n\nUsage: ufw COMMAND\n  status [numbered|verbose], allow|deny RULE, insert N RULE, delete N`);
  if (S.fw.rules.some(x => x.action === r.action && x.from === r.from && x.to === r.to)) return ok('Skipping adding existing rule');
  S.fw.rules.push(r); return ok('Rule added');
});

/* ---------- hashing / encoding */
def('sha256sum', 'sha256sum FILE... — print the SHA-256 fingerprint of files. -c FILE checks files against a list of known hashes', ({ S, args, stdin }) => {
  const { f, pos } = opts(args);
  if (f.c) {
    const r = readFile(S, pos[0] || '', 'sha256sum'); if (r.err) return fail(r.err);
    const out = [], errs = [], files = []; let bad = 0;
    for (const l of lines(r.content)) { const m = /^([0-9a-f]{64})\s+\*?(.+)$/.exec(l.trim()); if (!m) continue; const fr = readFile(S, m[2], 'sha256sum'); if (fr.err) { errs.push(fr.err); out.push(`${m[2]}: FAILED open or read`); bad++; continue; } files.push(fr.abs); const good = sha256(fr.content) === m[1]; if (!good) bad++; out.push(`${m[2]}: ${good ? C.g + 'OK' + C.x : C.r + 'FAILED' + C.x}`); }
    if (bad) errs.push(`sha256sum: WARNING: ${bad} computed checksum did NOT match`);
    return { out:out.join('\n'), err:errs.join('\n'), code:bad ? 1 : 0, meta:{ check:true, files } };
  }
  if (!pos.length) return ok(`${sha256(stdin)}  -`);
  const out = [], errs = [], files = [];
  for (const p of pos) { const r = readFile(S, p, 'sha256sum'); if (r.err) { errs.push(r.err); continue; } out.push(`${sha256(r.content)}  ${p}`); files.push(r.abs); }
  return { out:out.join('\n'), err:errs.join('\n'), code:errs.length ? 1 : 0, meta:{ files } };
});
def('md5sum', 'md5sum — MD5 is broken for security use; this shell only ships sha256sum', () => fail('md5sum: MD5 is not collision-resistant — use sha256sum instead (training shell)'));
def('base64', 'base64 [-d] [FILE] — encode bytes as text, or decode with -d. Encoding is NOT encryption: anyone can decode it', ({ S, args, stdin }) => {
  const { f, pos } = opts(args); const r = inputText(S, pos, stdin, 'base64'); if (r.err) return fail(r.err);
  if (f.d || f.decode) { try { const bin = atob(r.text.replace(/\s+/g, '')); const bytes = Uint8Array.from(bin, c => c.charCodeAt(0)); return { out:new TextDecoder().decode(bytes), code:0, meta:{ decoded:true } }; } catch { return fail('base64: invalid input'); } }
  const bytes = new TextEncoder().encode(r.text); let bin = ''; bytes.forEach(b => bin += String.fromCharCode(b));
  return ok(btoa(bin).match(/.{1,76}/g)?.join('\n') || '');
});

/* ---------- services: systemctl / journalctl */
function svcFind(S, n) { n = (n || '').replace(/\.service$/, ''); return Object.values(S.services).find(s => s.name === n || (s.aliases || []).includes(n)); }
function svcLog(S, svc, msg, who) { svc.logs.push(`${logStamp()} ${S.host} ${who || `${svc.proc || svc.name}[${svc.pid || 2210}]`}: ${msg}`); }
function svcStart(S, svc, verb) {
  const t = svc.test ? svc.test(S) : { ok:true };
  const pid = 2400 + Math.floor(Math.random() * 3000);
  if (!t.ok) {
    svc.state = 'failed'; svc.since = shiftTime(true);
    (t.lines || []).forEach(l => svcLog(S, svc, l, `${svc.proc || svc.name}[${pid}]`));
    svcLog(S, svc, `${svc.name}.service: Control process exited, code=exited, status=1/FAILURE`, 'systemd[1]');
    svcLog(S, svc, `${svc.name}.service: Failed with result 'exit-code'.`, 'systemd[1]');
    svcLog(S, svc, `Failed to start ${svc.name}.service - ${svc.desc}.`, 'systemd[1]');
    return fail(`Job for ${svc.name}.service failed because the control process exited with error code.\nSee "systemctl status ${svc.name}.service" and "journalctl -xeu ${svc.name}.service" for details.`);
  }
  svc.state = 'active'; svc.pid = pid; svc.since = shiftTime(true);
  svcLog(S, svc, `${verb === 'restart' ? 'Stopping' : 'Starting'} ${svc.name}.service - ${svc.desc}...`, 'systemd[1]');
  svcLog(S, svc, `Started ${svc.name}.service - ${svc.desc}.`, 'systemd[1]');
  svc.onStart && svc.onStart(S);
  return ok();
}
def('systemctl', 'systemctl status|start|stop|restart|reload|enable SERVICE — control background services managed by systemd', ({ S, args }) => {
  const { pos } = opts(args); const [verb, unit] = pos;
  if (!verb || verb === 'list-units') return ok(['  UNIT                 LOAD   ACTIVE SUB     DESCRIPTION', ...Object.values(S.services).map(s => `${s.state === 'failed' ? C.r + '●' + C.x : ' '} ${(s.name + '.service').padEnd(20)} loaded ${s.state.padEnd(6)} ${(s.state === 'active' ? 'running' : s.state === 'failed' ? 'failed' : 'dead').padEnd(7)} ${s.desc}`)].join('\n'));
  if (verb === 'daemon-reload') return S.root ? ok() : fail('Failed to reload daemon: Interactive authentication required.');
  if (verb === 'list-timers') return ok('NEXT LEFT LAST PASSED UNIT ACTIVATES\n0 timers listed.');
  const svc = svcFind(S, unit);
  if (!unit) return fail(`Too few arguments.`);
  if (!svc) return fail(verb === 'status' ? `Unit ${unit.replace(/\.service$/, '')}.service could not be found.` : `Failed to ${verb} ${unit}.service: Unit ${unit.replace(/\.service$/, '')}.service not found.`, verb === 'status' ? 4 : 5);
  const needRoot = ['start', 'stop', 'restart', 'reload', 'enable', 'disable', 'try-restart', 'reload-or-restart'];
  if (needRoot.includes(verb) && !S.root) return fail(`Failed to ${verb} ${svc.name}.service: Interactive authentication required.\nSee system logs and 'systemctl status ${svc.name}.service' for details.`);
  if (verb === 'status') {
    const dot = svc.state === 'active' ? `${C.g}●${C.x}` : svc.state === 'failed' ? `${C.r}×${C.x}` : '○';
    const act = svc.state === 'active' ? `${C.g}${C.B}active (running)${C.x}` : svc.state === 'failed' ? `${C.r}${C.B}failed${C.x} (Result: exit-code)` : 'inactive (dead)';
    const L = [`${dot} ${svc.name}.service - ${svc.desc}`, `     Loaded: loaded (/usr/lib/systemd/system/${svc.name}.service; ${svc.enabled ? 'enabled' : 'disabled'}; preset: enabled)`, `     Active: ${act} since Tue 2026-11-10 ${svc.since}`];
    if (svc.state === 'active') L.push(`   Main PID: ${svc.pid} (${svc.proc || svc.name})`, `      Tasks: 3 (limit: 4558)`, `     Memory: 6.1M`);
    L.push('', ...svc.logs.slice(-6));
    return { out:L.join('\n'), code:svc.state === 'active' ? 0 : 3 };
  }
  if (verb === 'is-active') return { out:svc.state, code:svc.state === 'active' ? 0 : 3 };
  if (verb === 'is-enabled') return ok(svc.enabled ? 'enabled' : 'disabled');
  if (verb === 'enable') { svc.enabled = true; return ok(`Synchronizing state of ${svc.name}.service with SysV service script with /usr/lib/systemd/systemd-sysv-install.\nCreated symlink /etc/systemd/system/multi-user.target.wants/${svc.name}.service → /usr/lib/systemd/system/${svc.name}.service.`); }
  if (verb === 'disable') { svc.enabled = false; return ok(`Removed "/etc/systemd/system/multi-user.target.wants/${svc.name}.service".`); }
  if (verb === 'stop') { if (svc.state === 'active') { svcLog(S, svc, `Stopping ${svc.name}.service - ${svc.desc}...`, 'systemd[1]'); svcLog(S, svc, `Stopped ${svc.name}.service - ${svc.desc}.`, 'systemd[1]'); } svc.state = 'inactive'; svc.pid = null; return ok(); }
  if (verb === 'start') { if (svc.state === 'active') return ok(); return svcStart(S, svc, 'start'); }
  if (verb === 'restart' || verb === 'try-restart' || verb === 'reload-or-restart') return svcStart(S, svc, 'restart');
  if (verb === 'reload') {
    if (svc.state !== 'active') return fail(`${svc.name}.service is not active, cannot reload.`);
    const t = svc.test ? svc.test(S) : { ok:true };
    if (!t.ok) { (t.lines || []).forEach(l => svcLog(S, svc, l)); svcLog(S, svc, `${svc.name}.service: Control process exited, code=exited, status=1/FAILURE`, 'systemd[1]'); svcLog(S, svc, `Reload failed for ${svc.name}.service - ${svc.desc}.`, 'systemd[1]'); return fail(`Job for ${svc.name}.service failed.\nSee "systemctl status ${svc.name}.service" and "journalctl -xeu ${svc.name}.service" for details.`); }
    svcLog(S, svc, `Reloading ${svc.name}.service - ${svc.desc}...`, 'systemd[1]'); svcLog(S, svc, `Reloaded ${svc.name}.service - ${svc.desc}.`, 'systemd[1]');
    svc.onStart && svc.onStart(S); return ok();
  }
  return fail(`Unknown command verb '${verb}'.`);
});
def('journalctl', 'journalctl -u SERVICE [-n N] — read a service\'s logs from the systemd journal', ({ S, args }) => {
  const { f } = opts(args, 'unp'); const n = f.n ? +f.n : null;
  let L;
  if (f.u) { const svc = svcFind(S, f.u); if (!svc) return ok('-- No entries --'); L = svc.logs.slice(); }
  else L = Object.values(S.services).flatMap(s => s.logs).sort();
  if (n) L = L.slice(-n);
  return { out:L.length ? L.join('\n') : '-- No entries --', code:0, meta:{ unit:f.u && svcFind(S, f.u)?.name } };
});

/* ---------- nginx */
function nginxTest(conf, file = '/etc/nginx/nginx.conf') {
  const L = conf.split('\n'); let depth = 0;
  for (let i = 0; i < L.length; i++) {
    const raw = L[i].replace(/#.*/, '').trim(); if (!raw) continue;
    if (raw.endsWith('{')) { depth++; continue; }
    if (raw === '}') { depth--; if (depth < 0) return { ok:false, lines:[`nginx: [emerg] unexpected "}" in ${file}:${i + 1}`] }; continue; }
    if (/\{.*\}$/.test(raw)) continue;
    if (!raw.endsWith(';')) return { ok:false, lines:[`nginx: [emerg] directive "${raw.split(/\s+/)[0]}" is not terminated by ";" in ${file}:${i + 1}`] };
  }
  if (depth > 0) return { ok:false, lines:[`nginx: [emerg] unexpected end of file, expecting "}" in ${file}:${L.length}`] };
  return { ok:true };
}
def('nginx', 'nginx -t — test nginx\'s configuration without touching the running server. nginx -s reload applies it', ({ S, args }) => {
  const svc = svcFind(S, 'nginx'); if (!svc) return fail('nginx: command not found', 127);
  if (args.includes('-v') || args.includes('-V')) return { out:'', err:'nginx version: nginx/1.24.0 (Ubuntu)', code:0 };
  if (args.includes('-t') || args.includes('-T')) {
    if (!S.root) return fail('nginx: [alert] could not open error log file: open() "/var/log/nginx/error.log" failed (13: Permission denied)\n2026/11/10 ' + shiftTime(true) + ' [emerg] 3141#3141: open() "/run/nginx.pid" failed (13: Permission denied)\nnginx: configuration file /etc/nginx/nginx.conf test failed\n(hint: nginx -t needs root — try sudo)');
    const t = svc.test(S);
    if (!t.ok) return { out:'', err:t.lines.join('\n') + '\nnginx: configuration file /etc/nginx/nginx.conf test failed', code:1, meta:{ test:false } };
    return { out:'nginx: the configuration file /etc/nginx/nginx.conf syntax is ok\nnginx: configuration file /etc/nginx/nginx.conf test is successful' + (args.includes('-T') ? '\n# configuration file /etc/nginx/nginx.conf:\n' + (getNode(S, '/etc/nginx/nginx.conf') || {}).content : ''), code:0, meta:{ test:true } };
  }
  const si = args.indexOf('-s'); if (si >= 0) { if (!S.root) return fail('nginx: [alert] kill(2210, 1) failed (1: Operation not permitted)'); if (svc.state !== 'active') return fail('nginx: [error] invalid PID number "" in "/run/nginx.pid"'); return CMD.systemctl({ S, args:['reload', 'nginx'] }); }
  return fail('nginx: run it through systemd here: sudo systemctl start nginx');
});

/* ---------- sshd */
const SSHD_KEYS = 'include port addressfamily listenaddress hostkey logingracetime permitrootlogin strictmodes maxauthtries maxsessions pubkeyauthentication authorizedkeysfile passwordauthentication permitemptypasswords kbdinteractiveauthentication challengeresponseauthentication usepam allowagentforwarding allowtcpforwarding x11forwarding printmotd printlastlog tcpkeepalive clientaliveinterval clientalivecountmax acceptenv subsystem allowusers allowgroups denyusers denygroups banner loglevel authenticationmethods permittty match'.split(' ');
function sshdParse(S) {
  const errs = [], eff = {};
  const visit = (path) => {
    const n = getNode(S, path); if (!n || n.type !== 'file') return;
    lines(n.content).forEach((l, i) => {
      const s = l.replace(/#.*/, '').trim(); if (!s) return;
      const [kw, ...rest] = s.split(/\s+/); const k = kw.toLowerCase(); const v = rest.join(' ');
      if (!SSHD_KEYS.includes(k)) { errs.push(`${path}: line ${i + 1}: Bad configuration option: ${kw}`); return; }
      if (k === 'include') { for (const pat of rest) { const g = expandGlob(S, pat); g.filter(x => getNode(S, x)).forEach(visit); } return; }
      if (['permitrootlogin'].includes(k) && !/^(yes|no|prohibit-password|without-password|forced-commands-only)$/i.test(v)) { errs.push(`${path} line ${i + 1}: unsupported option "${v}".`); return; }
      if (['passwordauthentication', 'pubkeyauthentication', 'usepam', 'x11forwarding', 'kbdinteractiveauthentication', 'permitemptypasswords'].includes(k) && !/^(yes|no)$/i.test(v)) { errs.push(`${path} line ${i + 1}: unsupported option "${v}".`); return; }
      if (!(k in eff)) eff[k] = v.toLowerCase();
    });
  };
  visit('/etc/ssh/sshd_config');
  const defaults = { port:'22', addressfamily:'any', listenaddress:'[::]:22\nlistenaddress 0.0.0.0:22', permitrootlogin:'prohibit-password', pubkeyauthentication:'yes', passwordauthentication:'yes', kbdinteractiveauthentication:'no', usepam:'no', x11forwarding:'no', maxauthtries:'6', permitemptypasswords:'no', printmotd:'yes' };
  return { errs, eff:{ ...defaults, ...eff } };
}
def('sshd', 'sshd -t tests the SSH server config; sshd -T prints the effective settings after all includes', ({ S, args }) => {
  if (!S.root) return fail('sshd: no hostkeys available -- exiting.\n(hint: sshd -t / -T must run as root — use sudo)');
  const p = sshdParse(S);
  if (p.errs.length) return { out:'', err:p.errs.join('\n') + `\n/etc/ssh/sshd_config: terminating, ${p.errs.length} bad configuration options`, code:255, meta:{ test:false } };
  if (args.includes('-T')) return { out:Object.entries(p.eff).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k} ${v}`).join('\n'), code:0, meta:{ dump:true } };
  if (args.includes('-t')) return { out:'', code:0, meta:{ test:true } };
  return fail('sshd: re-exec requires execution with an absolute path\n(hint: use sudo sshd -t to test, sudo systemctl restart ssh to apply)');
});
def('ssh', 'ssh USER@HOST — open a remote shell (disabled in this training shell)', () => fail('ssh: outbound SSH is disabled in this training shell — you are already on the box you need.'));

/* ---------- crontab */
const CRON_TEMPLATE = `# Edit this file to introduce tasks to be run by cron.
#
# Each task to run has to be defined through a single line
# indicating with different fields when the task will be run
# and what command to run for the task
#
# To define the time you can provide concrete values for
# minute (m), hour (h), day of month (dom), month (mon),
# and day of week (dow) or use '*' in these fields (for 'any').
#
# Output of the crontab jobs (including errors) is sent through
# email to the user the crontab file belongs to (unless redirected).
#
# For example, you can run a backup of all your user accounts
# at 5 a.m every week with:
# 0 5 * * 1 tar -zcf /var/backups/home.tgz /home/
#
# m h  dom mon dow   command
`;
function cronField(v, lo, hi, names) {
  const vals = new Set();
  for (let part of v.toLowerCase().split(',')) {
    let step = 1; const sm = /^(.*)\/(\d+)$/.exec(part); if (sm) { part = sm[1]; step = +sm[2]; if (!step) return null; }
    let a, b;
    if (part === '*') { a = lo; b = hi; }
    else { const [x, y] = part.split('-'); const num = s => names && names.indexOf(s) >= 0 ? names.indexOf(s) + (names.base || 0) : (/^\d+$/.test(s) ? +s : NaN); a = num(x); b = y == null ? (sm ? hi : a) : num(y); }
    if (isNaN(a) || isNaN(b) || a < lo || b > hi || a > b) return null;
    for (let i = a; i <= b; i += step) vals.add(i);
  }
  return vals;
}
const DOW = Object.assign(['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'], { base:0 });
const MON = Object.assign(['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'], { base:1 });
function parseCron(text) {
  const jobs = [], errs = [];
  lines(text).forEach((l, i) => {
    const s = l.trim(); if (!s || s.startsWith('#')) return;
    if (/^[A-Za-z_]\w*\s*=/.test(s)) return;
    const special = { '@daily':'0 0 * * *', '@midnight':'0 0 * * *', '@hourly':'0 * * * *', '@weekly':'0 0 * * 0', '@monthly':'0 0 1 * *', '@yearly':'0 0 1 1 *', '@annually':'0 0 1 1 *', '@reboot':null };
    let parts = s.split(/\s+/);
    if (parts[0].startsWith('@')) { if (!(parts[0] in special)) { errs.push(`"-":${i + 1}: bad time specifier`); return; } if (special[parts[0]] === null) { jobs.push({ line:i + 1, reboot:true, cmd:parts.slice(1).join(' '), raw:s }); return; } parts = [...special[parts[0]].split(' '), ...parts.slice(1)]; }
    if (parts.length < 6) { errs.push(`"-":${i + 1}: bad command`); return; }
    const names = ['minute', 'hour', 'day-of-month', 'month', 'day-of-week'];
    const f = [cronField(parts[0], 0, 59), cronField(parts[1], 0, 23), cronField(parts[2], 1, 31), cronField(parts[3], 1, 12, MON), cronField(parts[4], 0, 7, DOW)];
    const bad = f.findIndex(x => !x); if (bad >= 0) { errs.push(`"-":${i + 1}: bad ${names[bad]}`); return; }
    if (f[4].has(7)) { f[4].delete(7); f[4].add(0); }
    jobs.push({ line:i + 1, min:f[0], hour:f[1], dom:f[2], mon:f[3], dow:f[4], star:parts.slice(0, 5).map(p => p === '*'), cmd:parts.slice(5).join(' '), raw:s });
  });
  return { jobs, errs };
}
def('crontab', 'crontab -l lists your scheduled jobs; crontab -e edits them. Format: m h dom mon dow command', ({ S, args }) => {
  if (args.includes('-l')) return S.cron.text == null ? fail(`no crontab for ${S.root ? 'root' : 'ops'}`) : ok(S.cron.text.replace(/\n$/, ''));
  if (args.includes('-r')) { S.cron.text = null; return ok(); }
  if (args.includes('-e')) {
    if (S.root) return fail('crontab: you are editing root\'s crontab — the backup job belongs to ops. Run crontab -e without sudo.');
    return { out:S.cron.text == null ? 'no crontab for ops - using an empty one\n\nSelect an editor.  To change later, run \'select-editor\'.\n  1. /bin/nano        <---- easiest\nChoose 1-4 [1]: 1' : '', code:0, editor:{ title:'/tmp/crontab.Kx3bQe/crontab', cron:true, content:S.cron.draft ?? S.cron.text ?? CRON_TEMPLATE } };
  }
  return fail('usage:\tcrontab [-u user] file\n\tcrontab [ -u user ] [ -i ] { -e | -l | -r }');
});

/* ---------- git */
function gitRel(S, p) { const abs = norm(S, p); const root = S.git.root; return abs === root ? '' : abs.startsWith(root + '/') ? abs.slice(root.length + 1) : null; }
function gitWork(S) { const out = {}; const r = getNode(S, S.git.root); if (!r) return out; walk(r, '', (path, n) => { if (n.type !== 'file') return; const rel = path.slice(1); if (rel.startsWith('.git/') || rel === '.git') return; if (S.git.ignore.some(ig => rel === ig || rel.startsWith(ig + '/'))) return; out[rel] = n.content; }); return out; }
const gitHeadTree = S => { const id = S.git.branches[S.git.head]; return id ? S.git.commits[id].tree : {}; };
function gitStatusData(S) {
  const H = gitHeadTree(S), I = S.git.index, W = gitWork(S);
  const staged = [], unstaged = [], untracked = [];
  for (const k of new Set([...Object.keys(H), ...Object.keys(I)])) { if (!(k in H)) staged.push(['new file', k]); else if (!(k in I)) staged.push(['deleted', k]); else if (H[k] !== I[k]) staged.push(['modified', k]); }
  for (const k of Object.keys(I)) { if (!(k in W)) unstaged.push(['deleted', k]); else if (W[k] !== I[k]) unstaged.push(['modified', k]); }
  for (const k of Object.keys(W)) if (!(k in I)) untracked.push(k);
  return { staged, unstaged, untracked };
}
function lineDiff(a, b) {
  const A = lines(a), B = lines(b), n = A.length, m = B.length;
  const dp = Array.from({ length:n + 1 }, () => new Int32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out = []; let i = 0, j = 0;
  while (i < n && j < m) { if (A[i] === B[j]) { out.push([' ', A[i]]); i++; j++; } else if (dp[i + 1][j] >= dp[i][j + 1]) out.push(['-', A[i++]]); else out.push(['+', B[j++]]); }
  while (i < n) out.push(['-', A[i++]]); while (j < m) out.push(['+', B[j++]]);
  return out;
}
function diffText(path, a, b) {
  const d = lineDiff(a, b); const keep = d.map((x, i) => x[0] !== ' ' || d.slice(Math.max(0, i - 3), i + 4).some(y => y[0] !== ' '));
  const L = [`${C.B}diff --git a/${path} b/${path}${C.x}`, `${C.B}--- a/${path}${C.x}`, `${C.B}+++ b/${path}${C.x}`, `${C.c}@@ -1,${lines(a).length} +1,${lines(b).length} @@${C.x}`];
  d.forEach((x, i) => { if (!keep[i]) return; L.push(x[0] === '-' ? `${C.r}-${x[1]}${C.x}` : x[0] === '+' ? `${C.g}+${x[1]}${C.x}` : ' ' + x[1]); });
  return L.join('\n');
}
def('git', 'git status | add | commit -m | log | diff | branch | checkout -b | switch -c | push — version control', ({ S, args }) => {
  const sub = args[0]; const rest = args.slice(1);
  if (!sub) return ok('usage: git [--version] [--help] <command> [<args>]\n\nCommon: status, add, commit, log, diff, branch, switch, checkout, push');
  if (sub === '--version' || sub === 'version') return ok('git version 2.43.0');
  if (!S.git || gitRel(S, S.cwd) === null) return fail('fatal: not a git repository (or any of the parent directories): .git', 128);
  const G = S.git;
  const short = id => id.slice(0, 7);
  switch (sub) {
    case 'status': {
      const st = gitStatusData(S); const { f } = opts(rest);
      if (f.s || f.short) { const L = []; const W = gitWork(S); const keys = new Set([...st.staged.map(x => x[1]), ...st.unstaged.map(x => x[1])]); for (const k of keys) { const s = st.staged.find(x => x[1] === k), u = st.unstaged.find(x => x[1] === k); L.push(`${C.g}${s ? s[0][0].toUpperCase().replace('N', 'A') : ' '}${C.x}${C.r}${u ? u[0][0].toUpperCase() : ' '}${C.x} ${k}`); } st.untracked.forEach(k => L.push(`${C.r}??${C.x} ${k}`)); return ok(L.join('\n')); }
      const L = [`On branch ${G.head}`];
      if (G.remoteBranches[G.head]) L.push(G.remoteBranches[G.head] === G.branches[G.head] ? `Your branch is up to date with 'origin/${G.head}'.` : `Your branch is ahead of 'origin/${G.head}' by 1 commit.\n  (use "git push" to publish your local commits)`);
      if (st.staged.length) L.push('', 'Changes to be committed:', '  (use "git restore --staged <file>..." to unstage)', ...st.staged.map(([t, k]) => `\t${C.g}${(t + ':').padEnd(12)}${k}${C.x}`));
      if (st.unstaged.length) L.push('', 'Changes not staged for commit:', '  (use "git add <file>..." to update what will be committed)', '  (use "git restore <file>..." to discard changes in working directory)', ...st.unstaged.map(([t, k]) => `\t${C.r}${(t + ':').padEnd(12)}${k}${C.x}`));
      if (st.untracked.length) L.push('', 'Untracked files:', '  (use "git add <file>..." to include in what will be committed)', ...st.untracked.map(k => `\t${C.r}${k}${C.x}`));
      L.push('');
      if (!st.staged.length) L.push(st.unstaged.length ? 'no changes added to commit (use "git add" and/or "git commit -a")' : st.untracked.length ? 'nothing added to commit but untracked files present (use "git add" to track)' : 'nothing to commit, working tree clean');
      return ok(L.join('\n'));
    }
    case 'add': {
      const { f, pos } = opts(rest); const W = gitWork(S);
      const targets = f.A || f.all ? [''] : pos; if (!targets.length) return ok('Nothing specified, nothing added.\nhint: Maybe you wanted to say \'git add .\'?');
      for (const t of targets) {
        const rel = f.A || f.all ? '' : gitRel(S, t); if (rel === null) return fail(`fatal: ${t}: '${t}' is outside repository at '${G.root}'`, 128);
        const match = k => rel === '' || k === rel || k.startsWith(rel + '/');
        const keys = [...new Set([...Object.keys(W), ...Object.keys(G.index)])].filter(match);
        if (!keys.length) return fail(`fatal: pathspec '${t}' did not match any files`, 128);
        for (const k of keys) { if (k in W) G.index[k] = W[k]; else delete G.index[k]; }
      }
      return ok();
    }
    case 'restore': {
      const { f, pos } = opts(rest); const H = gitHeadTree(S);
      for (const p of pos) { const rel = gitRel(S, p); if (f.staged || f.S) { if (rel in H) G.index[rel] = H[rel]; else delete G.index[rel]; } else { if (!(rel in G.index)) return fail(`error: pathspec '${p}' did not match any file(s) known to git`); writeFile(S, G.root + '/' + rel, G.index[rel], false); } }
      return ok();
    }
    case 'diff': {
      const { f, pos } = opts(rest); const st = f.staged || f.cached; const H = gitHeadTree(S), W = gitWork(S);
      const A = st ? H : G.index, B = st ? G.index : W; const L = [];
      for (const k of Object.keys({ ...A, ...B }).sort()) { if (pos.length && !pos.some(p => gitRel(S, p) === k)) continue; if (!st && !(k in G.index)) continue; if ((A[k] ?? null) !== (B[k] ?? null)) L.push(diffText(k, A[k] || '', B[k] || '')); }
      return ok(L.join('\n'));
    }
    case 'commit': {
      const { f } = opts(rest, 'm'); if (f.a) { const W = gitWork(S); for (const k of Object.keys(G.index)) { if (k in W) G.index[k] = W[k]; else delete G.index[k]; } }
      if (!f.m) return fail('error: no commit message given — this training shell has no editor for commits.\nhint: use git commit -m "Describe the change"');
      const H = gitHeadTree(S); const st = gitStatusData(S);
      if (!st.staged.length) return { out:`On branch ${G.head}\n` + (st.unstaged.length ? 'Changes not staged for commit:\n' + st.unstaged.map(([t, k]) => `\t${C.r}${t}:   ${k}${C.x}`).join('\n') + '\n\nno changes added to commit (use "git add" and/or "git commit -a")' : st.untracked.length ? 'nothing added to commit but untracked files present (use "git add" to track)' : 'nothing to commit, working tree clean'), code:1 };
      const id = sha256(f.m + Date.now() + Math.random()).slice(0, 40);
      let ins = 0, del = 0; for (const [, k] of st.staged) for (const [t] of lineDiff(H[k] || '', G.index[k] || '')) { if (t === '+') ins++; if (t === '-') del++; }
      G.commits[id] = { id, msg:f.m, parent:G.branches[G.head] || null, tree:{ ...G.index }, date:dateStr() };
      const first = !G.branches[G.head]; G.branches[G.head] = id;
      const created = st.staged.filter(x => x[0] === 'new file').map(x => ` create mode 100644 ${x[1]}`);
      return { out:`[${G.head}${first ? ' (root-commit)' : ''} ${short(id)}] ${f.m}\n ${st.staged.length} file${st.staged.length > 1 ? 's' : ''} changed, ${ins} insertion${ins === 1 ? '' : 's'}(+), ${del} deletion${del === 1 ? '' : 's'}(-)${created.length ? '\n' + created.join('\n') : ''}`, code:0, meta:{ commit:id } };
    }
    case 'log': {
      const { f } = opts(rest, 'n'); const one = f.oneline; const max = f.n ? +f.n : Infinity; const L = []; let id = G.branches[G.head], k = 0;
      const decor = cid => { const names = Object.entries(G.branches).filter(([, v]) => v === cid).map(([b]) => b); const rem = Object.entries(G.remoteBranches).filter(([, v]) => v === cid).map(([b]) => 'origin/' + b); const parts = names.map(b => b === G.head ? `${C.c}${C.B}HEAD -> ${C.g}${b}${C.x}` : `${C.g}${b}${C.x}`).concat(rem.map(r => `${C.r}${r}${C.x}`)); return parts.length ? ` ${C.y}(${C.x}${parts.join(`${C.y}, ${C.x}`)}${C.y})${C.x}` : ''; };
      while (id && k < max) { const c = G.commits[id]; if (one) L.push(`${C.y}${short(id)}${C.x}${decor(id)} ${c.msg}`); else L.push(`${C.y}commit ${id}${C.x}${decor(id)}`, `Author: ${c.author || 'ops <ops@halcyon.lan>'}`, `Date:   ${c.date}`, '', `    ${c.msg}`, ''); id = c.parent; k++; }
      return ok(L.join('\n').trimEnd());
    }
    case 'branch': {
      const { f, pos } = opts(rest);
      if (f.d || f.D) { const b = pos[0]; if (!(b in G.branches)) return fail(`error: branch '${b}' not found.`); if (b === G.head) return fail(`error: Cannot delete branch '${b}' checked out at '${G.root}'`); delete G.branches[b]; return ok(`Deleted branch ${b}.`); }
      if (pos[0]) { if (pos[0] in G.branches) return fail(`fatal: a branch named '${pos[0]}' already exists`, 128); G.branches[pos[0]] = G.branches[G.head]; return ok(); }
      const L = Object.keys(G.branches).sort().map(b => b === G.head ? `* ${C.g}${b}${C.x}` : `  ${b}`);
      if (f.a) Object.keys(G.remoteBranches).forEach(b => L.push(`  ${C.r}remotes/origin/${b}${C.x}`));
      return ok(L.join('\n'));
    }
    case 'checkout': case 'switch': {
      const { f, pos } = opts(rest, 'bcB');
      const nb = f.b || f.c || f.B;
      if (nb) { if (nb in G.branches && !f.B) return fail(`fatal: a branch named '${nb}' already exists`, 128); if (!/^[\w./-]+$/.test(nb) || nb.endsWith('/') || nb.includes('..')) return fail(`fatal: '${nb}' is not a valid branch name`, 128); G.branches[nb] = G.branches[G.head]; G.head = nb; return { out:'', err:`Switched to a new branch '${nb}'`, code:0, meta:{ branch:nb } }; }
      const b = pos[0]; if (!b) return fail('fatal: you must specify a branch to switch to', 128);
      if (!(b in G.branches)) return fail(sub === 'switch' ? `fatal: invalid reference: ${b}` : `error: pathspec '${b}' did not match any file(s) known to git`);
      if (b === G.head) return { out:'', err:`Already on '${b}'`, code:0 };
      const st = gitStatusData(S); const target = G.commits[G.branches[b]].tree, H = gitHeadTree(S);
      const conflicts = [...st.staged, ...st.unstaged].map(x => x[1]).filter(k => target[k] !== H[k]);
      if (conflicts.length) return fail(`error: Your local changes to the following files would be overwritten by checkout:\n\t${conflicts.join('\n\t')}\nPlease commit your changes or stash them before you switch branches.\nAborting`);
      for (const k of Object.keys(H)) if (!(k in target)) { const [d, nm] = parentOf(G.root + '/' + k); const dn = getNode(S, d); if (dn) delete dn.children[nm]; }
      for (const [k, v] of Object.entries(target)) if (H[k] !== v) { writeFile(S, G.root + '/' + k, v, false); G.index[k] = v; }
      G.head = b; return { out:'', err:`Switched to branch '${b}'`, code:0, meta:{ branch:b } };
    }
    case 'push': {
      const { f, pos } = opts(rest);
      const upstream = f.u || f['set-upstream'];
      const remote = pos[0], br = pos[1] || (remote ? G.head : null);
      if (!remote && !G.upstream[G.head]) return fail(`fatal: The current branch ${G.head} has no upstream branch.\nTo push the current branch and set the remote as upstream, use\n\n    git push --set-upstream origin ${G.head}\n\nTo have this happen automatically for branches without a tracking\nupstream, see 'push.autoSetupRemote' in 'git help config'.`, 128);
      if (remote && remote !== 'origin') return fail(`fatal: '${remote}' does not appear to be a git repository\nfatal: Could not read from remote repository.`, 128);
      const b = br || G.head; if (!(b in G.branches)) return fail(`error: src refspec ${b} does not match any\nerror: failed to push some refs to 'github.com:halcyon-freight/status-page.git'`);
      if (b === 'main') return fail(`remote: error: GH006: Protected branch update failed for refs/heads/main.\nremote: error: Changes must be made through a pull request.\nTo github.com:halcyon-freight/status-page.git\n ! [remote rejected] main -> main (protected branch hook declined)\nerror: failed to push some refs to 'github.com:halcyon-freight/status-page.git'`);
      const isNew = !(b in G.remoteBranches); if (G.remoteBranches[b] === G.branches[b]) return { out:'', err:'Everything up-to-date', code:0 };
      G.remoteBranches[b] = G.branches[b]; if (upstream || G.upstream[b]) G.upstream[b] = true;
      return { out:'', err:`Enumerating objects: 5, done.\nCounting objects: 100% (5/5), done.\nDelta compression using up to 4 threads\nCompressing objects: 100% (3/3), done.\nWriting objects: 100% (3/3), 412 bytes | 412.00 KiB/s, done.\nTotal 3 (delta 2), reused 0 (delta 0), pack-reused 0\nremote:\nremote: Create a pull request for '${b}' on GitHub by visiting:\nremote:      https://github.com/halcyon-freight/status-page/pull/new/${b}\nremote:\nTo github.com:halcyon-freight/status-page.git\n ${isNew ? '* [new branch]     ' : `${short(G.branches[b])}..${short(G.branches[b])}`} ${b} -> ${b}${upstream ? `\nbranch '${b}' set up to track 'origin/${b}'.` : ''}`, code:0, meta:{ pushed:b } };
    }
    case 'remote': return ok(rest.includes('-v') ? 'origin\tgit@github.com:halcyon-freight/status-page.git (fetch)\norigin\tgit@github.com:halcyon-freight/status-page.git (push)' : 'origin');
    case 'show': { const id = G.branches[G.head]; const c = G.commits[id]; const P = c.parent ? G.commits[c.parent].tree : {}; return ok([`${C.y}commit ${id}${C.x}`, `Author: ${c.author || 'ops <ops@halcyon.lan>'}`, `Date:   ${c.date}`, '', `    ${c.msg}`, '', ...Object.keys({ ...P, ...c.tree }).filter(k => P[k] !== c.tree[k]).map(k => diffText(k, P[k] || '', c.tree[k] || ''))].join('\n')); }
    case 'init': return ok(`Reinitialized existing Git repository in ${G.root}/.git/`);
    case 'config': return ok(rest.includes('user.name') ? 'ops' : rest.includes('user.email') ? 'ops@halcyon.lan' : '');
    case 'stash': return fail('git stash: not available in this training shell — commit or restore instead');
    case 'pull': case 'fetch': return ok('Already up to date.');
    default: return fail(`git: '${sub}' is not a git command. See 'git --help'.`, 1);
  }
});

/* ---------- docker */
const DOCKER_NAMES = [['admiring', 'brave', 'eager', 'focused', 'gifted', 'jolly', 'nifty', 'quirky', 'sharp', 'vibrant'], ['bassi', 'curie', 'hopper', 'lovelace', 'noether', 'ritchie', 'shannon', 'turing', 'wozniak', 'yonath']];
function dockerfileBuild(S, ctxAbs, file) {
  const df = getNode(S, file);
  if (!df) return { err:`ERROR: failed to solve: failed to read dockerfile: open Dockerfile: no such file or directory` };
  const ctx = getNode(S, ctxAbs);
  const L = lines(df.content); const steps = []; let workdir = '/', files = new Set(), base = null, cmd = null, expose = [], env = {};
  for (let i = 0; i < L.length; i++) {
    const s = L[i].trim(); if (!s || s.startsWith('#')) continue;
    const [ins0, ...rest] = s.split(/\s+/); const ins = ins0.toUpperCase(); const arg = rest.join(' ');
    const known = ['FROM', 'WORKDIR', 'COPY', 'ADD', 'RUN', 'CMD', 'ENTRYPOINT', 'EXPOSE', 'ENV', 'USER', 'ARG', 'LABEL'];
    if (!known.includes(ins)) return { err:`ERROR: failed to solve: dockerfile parse error on line ${i + 1}: unknown instruction: ${ins0}` };
    if (!base && ins !== 'FROM' && ins !== 'ARG') return { err:`ERROR: failed to solve: no build stage in current context` };
    if (ins === 'FROM') { base = arg; steps.push(['FROM docker.io/library/' + arg, 0.0]); continue; }
    if (ins === 'WORKDIR') { workdir = arg.startsWith('/') ? arg : (workdir === '/' ? '' : workdir) + '/' + arg; steps.push([s, 0.1]); continue; }
    if (ins === 'ENV') { const [k, v] = arg.includes('=') ? arg.split('=') : rest; env[k] = v; continue; }
    if (ins === 'COPY' || ins === 'ADD') {
      const parts = rest.filter(x => !x.startsWith('--')); const dest = parts.pop(); const destAbs = dest === '.' || dest === './' ? workdir : dest.startsWith('/') ? dest.replace(/\/$/, '') : (workdir === '/' ? '' : workdir) + '/' + dest.replace(/^\.\//, '').replace(/\/$/, '');
      for (const src of parts) {
        const sn = getNode(S, norm({ cwd:ctxAbs }, src));
        if (!sn) return { err:`ERROR: failed to solve: failed to compute cache key: failed to calculate checksum of ref: "/${src.replace(/^\.\//, '')}": not found`, step:steps.length };
        if (sn.type === 'dir') walk(sn, '', (p, n) => { if (n.type === 'file' && !p.startsWith('/node_modules')) files.add((destAbs === '/' ? '' : destAbs) + p); });
        else files.add(dest.endsWith('/') || dest === '.' || parts.length > 1 ? (destAbs === '/' ? '' : destAbs) + '/' + src.split('/').pop() : destAbs);
      }
      steps.push([s, 0.0]); continue;
    }
    if (ins === 'RUN') {
      if (/npm (install|ci)/.test(arg) && !files.has((workdir === '/' ? '' : workdir) + '/package.json')) return { err:`ERROR: failed to solve: process "/bin/sh -c ${arg}" did not complete successfully: exit code: 254\n------\n > [${steps.length}/${steps.length}] RUN ${arg}:\nnpm error code ENOENT\nnpm error syscall open\nnpm error path ${workdir === '/' ? '' : workdir}/package.json\nnpm error enoent Could not read package.json: Error: ENOENT: no such file or directory\n------`, step:steps.length };
      steps.push([s, 4.2]); continue;
    }
    if (ins === 'EXPOSE') { expose.push(...rest.map(x => parseInt(x))); continue; }
    if (ins === 'CMD' || ins === 'ENTRYPOINT') { try { cmd = JSON.parse(arg); } catch { cmd = arg.split(/\s+/); } continue; }
  }
  if (!base) return { err:'ERROR: failed to solve: the Dockerfile cannot be empty' };
  const script = cmd && cmd[cmd.length - 1]; const scriptAbs = script ? (script.startsWith('/') ? script : (workdir === '/' ? '' : workdir) + '/' + script) : null;
  return { steps, image:{ base, workdir, files:[...files], cmd, expose, env, scriptAbs, hasServer:!!(scriptAbs && files.has(scriptAbs)) } };
}
function dockerFind(S, ref) { return S.docker.containers.find(c => c.name === ref || c.id.startsWith(ref)); }
function dockerHttp(S, c, m, path) {
  const img = S.docker.images[c.image];
  const appPort = +(c.env.PORT || 3000);
  if (m.cont !== appPort) return { err:'curl: (56) Recv failure: Connection reset by peer', code:56 };
  if (path.startsWith('/health')) return { status:200, type:'application/json', server:'node', body:`{"status":"ok","service":"tracker-api","version":"1.4.0","uptime_s":${12 + Math.floor((Date.now() - c.started) / 1000)}}` };
  if (path === '/' || path.startsWith('/shipments')) return { status:200, type:'application/json', server:'node', body:'{"shipments":[{"id":"HF-88213","status":"in_transit","eta":"2026-11-11T09:00Z"},{"id":"HF-88214","status":"loading","dock":4}]}' };
  return { status:404, type:'application/json', server:'node', body:'{"error":"not found"}' };
}
def('docker', 'docker build -t NAME . | run -d -p HOST:CONTAINER IMAGE | ps [-a] | logs NAME | stop NAME | rm NAME | images', ({ S, args }) => {
  if (!S.docker) return fail('docker: command not found', 127);
  const D = S.docker; const sub = args[0]; const rest = args.slice(1);
  const ago = t => { const s = Math.max(1, Math.floor((Date.now() - t) / 1000)); return s < 60 ? `${s} seconds ago` : `${Math.floor(s / 60)} minute${s >= 120 ? 's' : ''} ago`; };
  const fmtPorts = c => c.status === 'running' ? c.ports.map(m => `0.0.0.0:${m.host}->${m.cont}/tcp, [::]:${m.host}->${m.cont}/tcp`).join(', ') : '';
  switch (sub) {
    case 'build': case 'buildx': {
      const a = sub === 'buildx' ? rest.slice(1) : rest; const { f, pos } = opts(a, 'tf');
      if (!pos.length) return fail(`ERROR: "docker buildx build" requires exactly 1 argument.\nSee 'docker buildx build --help'.\n\nUsage:  docker buildx build [OPTIONS] PATH | URL | -\n(hint: the build context is usually the current directory: docker build -t tracker-api .)`);
      const ctxAbs = norm(S, pos[0]); const file = f.f ? norm(S, f.f) : ctxAbs + '/Dockerfile';
      const r = dockerfileBuild(S, ctxAbs, file);
      const head = `[+] Building ${(r.steps ? 6.4 : 1.2).toFixed(1)}s (${r.steps ? r.steps.length + 3 : 3}/${r.steps ? r.steps.length + 3 : 3}) ${r.err ? 'FINISHED' : 'FINISHED'}                       docker:default`;
      const L = [head, ` => [internal] load build definition from Dockerfile                   0.0s`, ` => [internal] load metadata for docker.io/library/node:20-alpine      0.9s`, ` => [internal] load .dockerignore                                      0.0s`];
      if (r.err) { return { out:L.join('\n'), err:r.err, code:1 }; }
      const n = r.steps.length;
      r.steps.forEach(([s, t], i) => L.push(` => [${i + 1}/${n}] ${s.padEnd(60).slice(0, 60)} ${t.toFixed(1)}s`));
      const name = f.t ? (f.t.includes(':') ? f.t : f.t + ':latest') : null; const id = sha256('img' + Date.now() + Math.random());
      L.push(` => exporting to image                                                 0.3s`, ` => => writing image sha256:${id}  0.0s`);
      if (name) L.push(` => => naming to docker.io/library/${name}                       0.0s`);
      D.images[name || '<none>:' + id.slice(0, 12)] = { ...r.image, id, created:Date.now(), name };
      return { out:L.join('\n'), code:0, meta:{ image:name, hasServer:r.image.hasServer } };
    }
    case 'images': case 'image': {
      if (sub === 'image' && rest[0] !== 'ls') return fail(`docker image: try 'docker images'`);
      const L = ['REPOSITORY    TAG       IMAGE ID       CREATED          SIZE'];
      for (const [k, im] of Object.entries(D.images)) { const [repo, tag] = k.split(':'); L.push(`${repo.padEnd(13)} ${tag.padEnd(9)} ${im.id.slice(0, 12)}   ${ago(im.created).padEnd(16)} ${im.base.includes('alpine') ? '148MB' : '1.1GB'}`); }
      return ok(L.join('\n'));
    }
    case 'run': {
      let detach = false, name = null, rm = false; const ports = [], env = {}; let image = null; const extra = [];
      for (let i = 0; i < rest.length; i++) {
        const a = rest[i];
        if (image) { extra.push(a); continue; }
        if (a === '-d' || a === '--detach' || a === '-dit' || a === '-itd') detach = true;
        else if (a === '-it' || a === '-i' || a === '-t') {}
        else if (a === '--rm') rm = true;
        else if (a === '-p' || a === '--publish' || a.startsWith('-p') || a.startsWith('--publish=')) { const v = a === '-p' || a === '--publish' ? rest[++i] : a.replace(/^(-p|--publish=)/, ''); const m = /^(?:[\d.]+:)?(\d+):(\d+)(?:\/tcp)?$/.exec(v || ''); if (!m) return fail(`docker: invalid publish opts format (should be name=value but got "${v}").\nSee 'docker run --help'.`, 125); ports.push({ host:+m[1], cont:+m[2] }); }
        else if (a === '--name' || a.startsWith('--name=')) name = a === '--name' ? rest[++i] : a.slice(7);
        else if (a === '-e' || a === '--env') { const [k, v] = (rest[++i] || '').split('='); env[k] = v; }
        else if (a.startsWith('-')) return fail(`unknown flag: ${a}\nSee 'docker run --help'.`, 125);
        else image = a;
      }
      if (!image) return fail(`"docker run" requires at least 1 argument.\nSee 'docker run --help'.\n\nUsage:  docker run [OPTIONS] IMAGE [COMMAND] [ARG...]`, 125);
      const key = image.includes(':') ? image : image + ':latest';
      const img = D.images[key];
      if (!img) return fail(`Unable to find image '${key}' locally\ndocker: Error response from daemon: pull access denied for ${image.split(':')[0]}, repository does not exist or may require 'docker login'.\n(hint: build it first with docker build -t ${image.split(':')[0]} .)`, 125);
      if (name && D.containers.some(c => c.name === name)) { const other = D.containers.find(c => c.name === name); return fail(`docker: Error response from daemon: Conflict. The container name "/${name}" is already in use by container "${other.id}". You have to remove (or rename) that container to be able to reuse that name.`, 125); }
      const id = sha256('ctr' + Date.now() + Math.random());
      const c = { id, name:name || `${pick(DOCKER_NAMES[0])}_${pick(DOCKER_NAMES[1])}`, image:key, imageId:img.id, ports, env:{ ...img.env, ...env }, created:Date.now(), started:Date.now(), status:'running', exit:0, logs:[], proxyPid:3000 + Math.floor(Math.random() * 999), rm };
      const busy = ports.find(p => D.containers.some(o => o.status === 'running' && o.ports.some(q => q.host === p.host)) || sockets(S).some(s => s.port === p.host && !s.docker));
      if (busy) { c.status = 'created'; D.containers.push(c); return { out:id, err:`docker: Error response from daemon: driver failed programming external connectivity on endpoint ${c.name} (${id.slice(0, 12)}): Bind for 0.0.0.0:${busy.host} failed: port is already allocated.`, code:125 }; }
      if (!img.hasServer) { c.status = 'exited'; c.exit = 1; c.logs = [`node:internal/modules/cjs/loader:1228`, `  throw err;`, `  ^`, ``, `Error: Cannot find module '${img.scriptAbs || '/app/server.js'}'`, `    at Module._resolveFilename (node:internal/modules/cjs/loader:1225:15)`, `    at Module._load (node:internal/modules/cjs/loader:1051:27)`, `    at Function.executeUserEntryPoint [as runMain] (node:internal/modules/run_main:174:12)`, `    at node:internal/main/run_main_module:28:49 {`, `  code: 'MODULE_NOT_FOUND',`, `  requireStack: []`, `}`, ``, `Node.js v20.18.0`]; }
      else c.logs = [`tracker-api 1.4.0 listening on :${c.env.PORT || 3000} (NODE_ENV=production)`];
      D.containers.push(c);
      if (!detach) { const out = c.logs.join('\n') + (c.status === 'running' ? `\n${C.d}(training shell: foreground containers are detached for you — next time add -d. Container: ${c.name})${C.x}` : ''); return { out, code:c.exit, meta:{ container:c.name } }; }
      return { out:id, code:0, meta:{ container:c.name } };
    }
    case 'ps': case 'container': {
      const { f } = opts(sub === 'container' ? rest.slice(1) : rest);
      const rows = D.containers.filter(c => f.a || c.status === 'running');
      const L = ['CONTAINER ID   IMAGE                COMMAND            CREATED          STATUS                      PORTS                                         NAMES'];
      for (const c of rows) { const st = c.status === 'running' ? `Up ${ago(c.started).replace(' ago', '')}` : c.status === 'created' ? 'Created' : `Exited (${c.exit}) ${ago(c.created)}`; L.push(`${c.id.slice(0, 12)}   ${c.image.replace(':latest', '').padEnd(20)} "node server.js"   ${ago(c.created).padEnd(16)} ${st.padEnd(27)} ${fmtPorts(c).padEnd(45)} ${c.name}`); }
      return ok(L.join('\n'));
    }
    case 'logs': {
      const ref = rest.filter(a => !a.startsWith('-'))[0]; if (!ref) return fail(`"docker logs" requires exactly 1 argument.`);
      const c = dockerFind(S, ref); if (!c) return fail(`Error response from daemon: No such container: ${ref}`);
      const crash = c.status === 'exited';
      return { out:crash ? '' : c.logs.join('\n'), err:crash ? c.logs.join('\n') : '', code:0, meta:{ crashed:crash, container:c.name } };
    }
    case 'stop': case 'kill': {
      const out = []; for (const ref of rest.filter(a => !a.startsWith('-'))) { const c = dockerFind(S, ref); if (!c) return fail(`Error response from daemon: No such container: ${ref}`); if (c.status === 'running') { c.status = 'exited'; c.exit = sub === 'kill' ? 137 : 0; } out.push(ref); if (c.rm) D.containers.splice(D.containers.indexOf(c), 1); }
      return ok(out.join('\n'));
    }
    case 'start': { const c = dockerFind(S, rest[0] || ''); if (!c) return fail(`Error response from daemon: No such container: ${rest[0]}`); const img = D.images[c.image]; if (!img.hasServer) { c.status = 'exited'; c.exit = 1; } else { const busy = c.ports.find(p => D.containers.some(o => o !== c && o.status === 'running' && o.ports.some(q => q.host === p.host))); if (busy) return fail(`Error response from daemon: driver failed programming external connectivity on endpoint ${c.name}: Bind for 0.0.0.0:${busy.host} failed: port is already allocated`); c.status = 'running'; c.started = Date.now(); } return ok(rest[0]); }
    case 'rm': {
      const { f, pos } = opts(rest); const out = [];
      for (const ref of pos) { const c = dockerFind(S, ref); if (!c) return fail(`Error response from daemon: No such container: ${ref}`); if (c.status === 'running' && !f.f) return fail(`Error response from daemon: cannot remove container "/${c.name}": container is running: stop the container before removing or force remove`); D.containers.splice(D.containers.indexOf(c), 1); out.push(ref); }
      return ok(out.join('\n'));
    }
    case 'rmi': { const k = (rest[0] || '').includes(':') ? rest[0] : rest[0] + ':latest'; if (!D.images[k]) return fail(`Error response from daemon: No such image: ${rest[0]}`); delete D.images[k]; return ok(`Untagged: ${k}`); }
    case 'exec': return fail('docker exec: not available in this training shell — use docker logs to see what the app is doing');
    case 'inspect': { const c = dockerFind(S, rest[0] || ''); if (!c) return fail(`Error: No such object: ${rest[0]}`); return ok(JSON.stringify({ Id:c.id, Name:'/' + c.name, State:{ Status:c.status, ExitCode:c.exit }, Config:{ Image:c.image, ExposedPorts:Object.fromEntries((D.images[c.image].expose || []).map(p => [p + '/tcp', {}])) }, HostConfig:{ PortBindings:Object.fromEntries(c.ports.map(m => [m.cont + '/tcp', [{ HostIp:'', HostPort:String(m.host) }]])) } }, null, 2)); }
    case '--version': case 'version': return ok('Docker version 27.3.1, build ce12230');
    default: return ok('Usage:  docker [OPTIONS] COMMAND\n\nCommon Commands:\n  run         Create and run a new container from an image\n  ps          List containers\n  build       Build an image from a Dockerfile\n  images      List images\n  logs        Fetch the logs of a container\n  stop        Stop one or more running containers\n  rm          Remove one or more containers');
  }
});

/* ---------- CI: act + gitleaks */
function parseWorkflow(text) {
  const L = text.split('\n');
  const tab = L.findIndex(l => /\t/.test(l.match(/^\s*/)[0]));
  if (tab >= 0) return { err:`yaml: line ${tab + 1}: found a tab character that violates indentation` };
  const si = L.findIndex(l => /^\s*steps:\s*$/.test(l)); if (si < 0) return { err:'workflow is not valid: job "test" has no steps' };
  const steps = []; let cur = null, itemIndent = null, inEnv = null;
  for (let i = si + 1; i < L.length; i++) {
    const l = L[i]; if (!l.trim() || l.trim().startsWith('#')) continue;
    const ind = l.match(/^\s*/)[0].length;
    if (ind <= L[si].match(/^\s*/)[0].length) break;
    const item = /^(\s*)-\s+(.*)$/.exec(l);
    if (item && (itemIndent === null || item[1].length === itemIndent)) { itemIndent = item[1].length; cur = { line:i + 1, env:{} }; steps.push(cur); inEnv = null; const kv = /^([\w-]+):\s*(.*)$/.exec(item[2]); if (kv) cur[kv[1]] = kv[2]; continue; }
    if (!cur) return { err:`yaml: line ${i + 1}: did not find expected '-' indicator` };
    const kv = /^\s*([\w-]+):\s*(.*)$/.exec(l); if (!kv) return { err:`yaml: line ${i + 1}: could not find expected ':'` };
    if (kv[1] === 'env' && !kv[2]) { inEnv = ind; continue; }
    if (inEnv !== null && ind > inEnv) { cur.env[kv[1]] = kv[2].trim(); continue; }
    inEnv = null; if (kv[1] !== 'with') cur[kv[1]] = kv[2];
  }
  return { steps };
}
def('act', 'act — run this repo\'s GitHub Actions workflow locally, step by step, like CI would', ({ S, args }) => {
  const root = S.ci && S.ci.root; if (!root || !(S.cwd === root || S.cwd.startsWith(root + '/'))) return fail('Error: unable to find a .github/workflows directory — run act from the repository root.');
  const wf = getNode(S, root + '/.github/workflows/ci.yml'); if (!wf) return fail('Error: no workflow files found in .github/workflows');
  const p = parseWorkflow(wf.content); const tag = `${C.c}[CI/test]${C.x}`;
  if (p.err) return fail(`Error: ${p.err}`);
  const secretsFile = getNode(S, root + '/.secrets'); const secrets = {};
  if (secretsFile) for (const l of lines(secretsFile.content)) { const m = /^(\w+)=(.*)$/.exec(l.trim()); if (m) secrets[m[1]] = m[2]; }
  const L = [`INFO[0000] Using docker host 'unix:///var/run/docker.sock', and daemon socket 'unix:///var/run/docker.sock'`, `${tag} 🚀  Start image=catthehacker/ubuntu:act-latest`, `${tag}   🐳  docker pull image=catthehacker/ubuntu:act-latest platform= username= forcePull=true`];
  let installed = false, failed = null;
  for (const st of p.steps) {
    const label = st.name || (st.uses ? 'Main ' + st.uses : 'Main ' + (st.run || ''));
    L.push(`${tag} ⭐ Run ${label}`);
    if (st.uses) { L.push(`${tag}   ${C.g}✅  Success${C.x} - ${label}`); continue; }
    const run = (st.run || '').trim();
    if (/^npm (ci|install)\b/.test(run)) { installed = true; L.push(`| added 412 packages, and audited 413 packages in 6s`, `| found 0 vulnerabilities`, `${tag}   ${C.g}✅  Success${C.x} - ${label}`); continue; }
    if (/^npm (test|run test)\b/.test(run)) {
      if (!installed) { L.push(`| `, `| > tracker-api@1.4.0 test`, `| > jest --ci`, `| `, `| sh: 1: jest: not found`, `${tag}   ${C.r}❌  Failure${C.x} - ${label}`, `${tag} exitcode '127': command not found, please refer to https://github.com/nektos/act/issues/107 for more information`); failed = label; break; }
      L.push(`| PASS  test/shipments.test.js`, `| PASS  test/health.test.js`, `| Tests:       42 passed, 42 total`, `| Time:        3.81 s`, `${tag}   ${C.g}✅  Success${C.x} - ${label}`); continue;
    }
    if (/upload-coverage/.test(run)) {
      const v = st.env.COVERAGE_TOKEN; let token = null, masked = false;
      const sm = v && /^\$\{\{\s*secrets\.(\w+)\s*\}\}$/.exec(v);
      if (sm) { token = secrets[sm[1]]; masked = true; } else if (v) token = v;
      if (!token) { L.push(`| error: COVERAGE_TOKEN is empty${sm ? ` — secret ${sm[1]} was not provided` : ''}`, `${tag}   ${C.r}❌  Failure${C.x} - ${label}`); failed = label; break; }
      L.push(`| uploading coverage report (lcov, 87.4%) with token ${masked ? '***' : token}`, `| done.`, `${tag}   ${C.g}✅  Success${C.x} - ${label}`); continue;
    }
    L.push(`| ${run}`, `${tag}   ${C.g}✅  Success${C.x} - ${label}`);
  }
  if (failed) { L.push(`${tag} 🏁  Job ${C.r}failed${C.x}`); return { out:L.join('\n'), err:`Error: Job 'test' failed`, code:1, meta:{ ok:false } }; }
  L.push(`${tag} 🏁  Job ${C.g}succeeded${C.x}`);
  return { out:L.join('\n'), code:0, meta:{ ok:true } };
});
def('gitleaks', 'gitleaks detect — scan a repository for leaked secrets (tokens, keys, passwords)', ({ S, args }) => {
  if (args[0] !== 'detect' && args[0] !== 'dir' && args[0] !== 'git') return ok('Gitleaks scans code, past or present, for secrets\n\nUsage:\n  gitleaks detect [flags]\n  gitleaks dir [path]');
  const root = S.ci ? S.ci.root : S.cwd; const n = getNode(S, root);
  const ignore = ((getNode(S, root + '/.gitignore') || {}).content || '').split('\n').map(s => s.trim()).filter(Boolean);
  const finds = [];
  walk(n, '', (p, node) => {
    if (node.type !== 'file') return; const rel = p.slice(1); if (ignore.some(ig => rel === ig || rel.startsWith(ig.replace(/\/$/, '') + '/'))) return;
    lines(node.content).forEach((l, i) => { const m = /(cov_live_[a-z0-9]{8,}|AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{20,})/.exec(l); if (m) finds.push({ rel, line:i + 1, secret:m[1], text:l.trim() }); });
  });
  const banner = `\n    ○\n    │╲\n    │ ○\n    ○ ░\n    ░    gitleaks\n`;
  const L = [banner];
  for (const x of finds) L.push(`Finding:     ${x.text.replace(x.secret, C.r + x.secret + C.x)}`, `Secret:      ${C.r}${x.secret}${C.x}`, `RuleID:      generic-api-key`, `Entropy:     3.952820`, `File:        ${x.rel}`, `Line:        ${x.line}`, `Fingerprint: ${x.rel}:generic-api-key:${x.line}`, '');
  L.push(`${shiftTime()}AM INF scanned ~4.1 KB in 38.2ms`);
  if (finds.length) L.push(`${shiftTime()}AM ${C.y}WRN${C.x} leaks found: ${finds.length}`); else L.push(`${shiftTime()}AM INF no leaks found`);
  return { out:L.join('\n'), code:finds.length ? 1 : 0, meta:{ leaks:finds.length } };
});
