'use strict';
/* ==========================================================================
   Night Shift — simulated Linux shell engine
   Virtual filesystem, permissions, a bash-like parser (pipes, &&, ||, ;, > >>,
   globs, $VARS, quotes) and the core text-processing commands.
   ========================================================================== */
const HOME = '/home/ops';
const C = { r:'\x1b[31m', g:'\x1b[32m', y:'\x1b[33m', b:'\x1b[34m', m:'\x1b[35m', c:'\x1b[36m', B:'\x1b[1m', d:'\x1b[2m', x:'\x1b[0m' };
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;' }[c]));
const stripAnsi = s => String(s).replace(/\x1b\[[\d;]*m/g, '');
const ok = (out = '') => ({ out, err:'', code:0 });
const fail = (err, code = 1, out = '') => ({ out, err, code });
const pick = a => a[Math.floor(Math.random() * a.length)];

function ansiToHtml(s) {
  let html = '', open = 0;
  const parts = String(s).split(/\x1b\[([\d;]*)m/);
  for (let i = 0; i < parts.length; i++) {
    if (i % 2 === 0) { html += esc(parts[i]); continue; }
    const codes = parts[i].split(';');
    if (parts[i] === '' || codes.includes('0')) { html += '</span>'.repeat(open); open = 0; }
    const cls = codes.filter(c => c && c !== '0').map(c => 'a' + c).join(' ');
    if (cls) { html += `<span class="${cls}">`; open++; }
  }
  return html + '</span>'.repeat(open);
}

/* ---------- seeded random (stable lab data) */
function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

/* ---------- SHA-256 (real) */
function sha256(str) {
  const rr = (v, n) => (v >>> n) | (v << (32 - n));
  const H = [], K = []; let p = 2, c = 0;
  const frac = x => ((x - Math.floor(x)) * 4294967296) | 0;
  while (c < 64) { let prime = true; for (let d = 2; d * d <= p; d++) if (p % d === 0) { prime = false; break; } if (prime) { if (c < 8) H[c] = frac(Math.pow(p, 1 / 2)); K[c] = frac(Math.pow(p, 1 / 3)); c++; } p++; }
  const b = new TextEncoder().encode(str), l = b.length;
  const n = ((l + 8) >> 6) * 16 + 16; const w0 = new Array(n).fill(0);
  for (let i = 0; i < l; i++) w0[i >> 2] |= b[i] << ((3 - (i & 3)) * 8);
  w0[l >> 2] |= 0x80 << ((3 - (l & 3)) * 8);
  w0[n - 1] = (l * 8) | 0; w0[n - 2] = Math.floor(l / 536870912);
  let h = H.slice();
  for (let i = 0; i < n; i += 16) {
    const w = w0.slice(i, i + 16);
    let [a, bb, cc, d, e, f, g, hh] = h;
    for (let j = 0; j < 64; j++) {
      if (j >= 16) { const x = w[j - 15], y = w[j - 2]; w[j] = (w[j - 16] + (rr(x, 7) ^ rr(x, 18) ^ (x >>> 3)) + w[j - 7] + (rr(y, 17) ^ rr(y, 19) ^ (y >>> 10))) | 0; }
      const t1 = (hh + (rr(e, 6) ^ rr(e, 11) ^ rr(e, 25)) + ((e & f) ^ (~e & g)) + K[j] + w[j]) | 0;
      const t2 = ((rr(a, 2) ^ rr(a, 13) ^ rr(a, 22)) + ((a & bb) ^ (a & cc) ^ (bb & cc))) | 0;
      hh = g; g = f; f = e; e = (d + t1) | 0; d = cc; cc = bb; bb = a; a = (t1 + t2) | 0;
    }
    h = [a, bb, cc, d, e, f, g, hh].map((v, k) => (v + h[k]) | 0);
  }
  return h.map(v => (v >>> 0).toString(16).padStart(8, '0')).join('');
}

/* ---------- IP helpers */
const ip2n = ip => ip.split('.').reduce((a, o) => a * 256 + (+o), 0);
const n2ip = n => [24, 16, 8, 0].map(s => Math.floor(n / 2 ** s) % 256).join('.');
const isIP = s => /^(\d{1,3}\.){3}\d{1,3}$/.test(s) && s.split('.').every(o => +o < 256);
function cidrInfo(ip, bits) {
  const size = 2 ** (32 - bits); const net = Math.floor(ip2n(ip) / size) * size;
  return { netN:net, size, net:n2ip(net), bcast:n2ip(net + size - 1), first:n2ip(bits >= 31 ? net : net + 1), last:n2ip(bits >= 31 ? net + size - 1 : net + size - 2),
    hosts: bits === 32 ? 1 : bits === 31 ? 2 : size - 2, mask:n2ip(2 ** 32 - size), wildcard:n2ip(size - 1) };
}
function inCidr(ip, cidr) { const [b, bits] = cidr.split('/'); const i = cidrInfo(b, +bits); const n = ip2n(ip); return n >= i.netN && n < i.netN + i.size; }

/* ---------- shift clock */
const SHIFT_START = Date.now();
function shiftTime(sec) { const t = 1 * 3600 + 47 * 60 + Math.floor((Date.now() - SHIFT_START) / 1000); const h = Math.floor(t / 3600) % 24, m = Math.floor(t / 60) % 60, s = t % 60; const p = n => String(n).padStart(2, '0'); return sec ? `${p(h)}:${p(m)}:${p(s)}` : `${p(h)}:${p(m)}`; }
const dateStr = () => `Tue Nov 10 ${shiftTime(true)} UTC 2026`;
const logStamp = () => `Nov 10 ${shiftTime(true)}`;

/* ==========================================================================
   Filesystem
   ========================================================================== */
const defaultOwner = p => /^\/(home\/ops|srv|opt\/backup|var\/backups)/.test(p) ? 'ops' : 'root';
function buildFS(spec) {
  const root = { type:'dir', children:{}, mode:'755', owner:'root' };
  for (const [path, val] of Object.entries(spec)) {
    if (val == null) continue;
    const parts = path.split('/').filter(Boolean); const isDir = path.endsWith('/');
    let node = root, cur = '';
    parts.forEach((seg, i) => {
      cur += '/' + seg; const last = i === parts.length - 1;
      if (last && !isDir) {
        const v = typeof val === 'string' ? { content:val } : val;
        node.children[seg] = { type:'file', content:v.content || '', mode:v.mode || '644', owner:v.owner || defaultOwner(cur) };
      } else {
        if (!node.children[seg]) node.children[seg] = { type:'dir', children:{}, mode:'755', owner:defaultOwner(cur) };
        if (last && typeof val === 'object') { if (val.mode) node.children[seg].mode = val.mode; if (val.owner) node.children[seg].owner = val.owner; }
        node = node.children[seg];
      }
    });
  }
  return root;
}
function norm(S, p) {
  if (p == null || p === '') return S.cwd;
  if (p === '~' || p.startsWith('~/')) p = HOME + p.slice(1);
  const abs = p.startsWith('/') ? p : (S.cwd === '/' ? '' : S.cwd) + '/' + p;
  const out = [];
  for (const seg of abs.split('/')) { if (!seg || seg === '.') continue; if (seg === '..') out.pop(); else out.push(seg); }
  return '/' + out.join('/');
}
function getNode(S, abs) {
  let n = S.fs; if (abs === '/') return n;
  for (const seg of abs.split('/').filter(Boolean)) { if (!n || n.type !== 'dir') return null; n = n.children[seg]; }
  return n || null;
}
const nodeAt = (S, p) => getNode(S, norm(S, p));
function parentOf(abs) { const i = abs.lastIndexOf('/'); return [abs.slice(0, i) || '/', abs.slice(i + 1)]; }
function perm(S, node, bit) {
  if (S.root) return bit !== 1 || node.type === 'dir' || /[1357]/.test(node.mode);
  const d = node.owner === S.user ? +node.mode[0] : +node.mode[2];
  return (d & bit) !== 0;
}
function readFile(S, p, cmd) {
  const abs = norm(S, p), n = getNode(S, abs);
  if (!n) return { err:`${cmd}: ${p}: No such file or directory` };
  if (n.type === 'dir') return { err:`${cmd}: ${p}: Is a directory` };
  if (!perm(S, n, 4)) return { err:`${cmd}: ${p}: Permission denied` };
  return { content:n.content, node:n, abs };
}
function writeFile(S, p, content, append, cmd = 'bash') {
  if (p === '/dev/null') return { abs:'/dev/null' };
  const abs = norm(S, p), n = getNode(S, abs);
  if (n) {
    if (n.type === 'dir') return { err:`${cmd}: ${p}: Is a directory` };
    if (!perm(S, n, 2)) return { err:`${cmd}: ${p}: Permission denied` };
    n.content = append ? n.content + content : content; return { node:n, abs };
  }
  const [d, name] = parentOf(abs); const dn = getNode(S, d);
  if (!dn || dn.type !== 'dir') return { err:`${cmd}: ${p}: No such file or directory` };
  if (!perm(S, dn, 2)) return { err:`${cmd}: ${p}: Permission denied` };
  dn.children[name] = { type:'file', content, mode:'644', owner:S.root ? 'root' : S.user };
  return { node:dn.children[name], abs };
}
function walk(node, base, fn) { // depth-first; base is the path of node
  fn(base, node);
  if (node.type === 'dir') for (const k of Object.keys(node.children).sort()) walk(node.children[k], (base === '/' ? '' : base) + '/' + k, fn);
}
const rwx = m => [...m].map(d => ((+d & 4) ? 'r' : '-') + ((+d & 2) ? 'w' : '-') + ((+d & 1) ? 'x' : '-')).join('');
function inputText(S, files, stdin, cmd) { // returns {text, err}
  if (!files.length || (files.length === 1 && files[0] === '-')) return { text:stdin || '' };
  let text = '', errs = [];
  for (const f of files) { const r = readFile(S, f, cmd); if (r.err) errs.push(r.err); else text += r.content.endsWith('\n') || !r.content ? r.content : r.content + '\n'; }
  return { text, err:errs.join('\n') };
}
const lines = t => { const a = String(t).split('\n'); if (a.length && a[a.length - 1] === '') a.pop(); return a; };

/* ---------- option parser: -abc, -n 5, -n5, --long, --long=value */
function opts(args, withVal = '') {
  const f = {}, pos = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--') { pos.push(...args.slice(i + 1)); break; }
    if (a.startsWith('--') && a.length > 2) { const k = a.slice(2), eq = k.indexOf('='); if (eq >= 0) f[k.slice(0, eq)] = k.slice(eq + 1); else f[k] = true; continue; }
    if (a.startsWith('-') && a.length > 1 && !/^-\d/.test(a)) {
      for (let j = 1; j < a.length; j++) { const c = a[j]; if (withVal.includes(c)) { const rest = a.slice(j + 1); f[c] = rest !== '' ? rest : args[++i]; break; } f[c] = true; }
      continue;
    }
    pos.push(a);
  }
  return { f, pos };
}

/* ==========================================================================
   Parser
   ========================================================================== */
function tokenize(line, env) {
  const toks = []; let cur = '', has = false, glob = false, q = null;
  const flush = () => { if (has) toks.push({ v:cur, glob }); cur = ''; has = false; glob = false; };
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q === "'") { if (c === "'") q = null; else cur += c; continue; }
    if (c === '$' && /[A-Za-z_{]/.test(line[i + 1] || '')) {
      let name;
      if (line[i + 1] === '{') { const k = line.indexOf('}', i); if (k < 0) { cur += c; has = true; continue; } name = line.slice(i + 2, k); i = k; }
      else { name = /^[A-Za-z_][A-Za-z0-9_]*/.exec(line.slice(i + 1))[0]; i += name.length; }
      cur += env[name] ?? ''; has = true; continue;
    }
    if (q === '"') { if (c === '"') q = null; else if (c === '\\' && /["\\$`]/.test(line[i + 1] || '')) cur += line[++i]; else cur += c; continue; }
    if (c === '"' || c === "'") { q = c; has = true; continue; }
    if (c === '\\') { if (i + 1 < line.length) { cur += line[++i]; has = true; } continue; }
    if (c === ' ' || c === '\t') { flush(); continue; }
    if (c === '#' && !has) break;
    if (c === '2' && !has && line[i + 1] === '>') { // 2>&1, 2>/dev/null: stderr already shown, ignore
      i++; if (line[i + 1] === '&' && line[i + 2] === '1') { i += 2; continue; }
      while (line[i + 1] === ' ') i++;
      while (i + 1 < line.length && !/[\s|;&]/.test(line[i + 1])) i++;
      continue;
    }
    if (c === '|' || c === ';' || c === '&' || c === '>') {
      if (c === '&' && line[i + 1] !== '&') { cur += c; has = true; continue; }
      flush(); let op = c; if (c !== ';' && line[i + 1] === c) { op += c; i++; }
      toks.push({ op }); continue;
    }
    if (c === '*' || c === '?') glob = true;
    cur += c; has = true;
  }
  if (q) throw new Error(`unexpected EOF while looking for matching \`${q}'`);
  flush(); return toks;
}
function parseChain(toks) {
  const chain = []; let cmd = { args:[], redir:null }, pipe = [cmd], joiner = null;
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (!t.op) { cmd.args.push(t); continue; }
    if (t.op === '|') { if (!cmd.args.length) throw new Error("syntax error near unexpected token `|'"); cmd = { args:[], redir:null }; pipe.push(cmd); }
    else if (t.op === '>' || t.op === '>>') { const nx = toks[++i]; if (!nx || nx.op) throw new Error("syntax error near unexpected token `newline'"); cmd.redir = { op:t.op, path:nx.v }; }
    else { chain.push({ pipe, joiner }); joiner = t.op; cmd = { args:[], redir:null }; pipe = [cmd]; }
  }
  chain.push({ pipe, joiner });
  return chain.filter(s => s.pipe.some(p => p.args.length));
}
function expandGlob(S, pat) {
  const i = pat.lastIndexOf('/'); const dir = i >= 0 ? (pat.slice(0, i) || '/') : ''; const base = pat.slice(i + 1);
  if (/[*?]/.test(dir)) { // one level of directory glob, e.g. mirror-*/agent.sh
    const dirs = expandGlob(S, dir); if (dirs.length === 1 && dirs[0] === dir) return [pat];
    const out = []; for (const d of dirs) { const r = expandGlob(S, d + '/' + base); if (!(r.length === 1 && r[0] === d + '/' + base && !nodeAt(S, r[0]))) out.push(...r); }
    return out.length ? out : [pat];
  }
  const node = getNode(S, norm(S, dir || '.'));
  if (!node || node.type !== 'dir' || !/[*?]/.test(base)) return [pat];
  const re = new RegExp('^' + base.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$');
  const m = Object.keys(node.children).filter(n => re.test(n) && (base.startsWith('.') || !n.startsWith('.'))).sort();
  return m.length ? m.map(n => (dir ? (dir === '/' ? '/' : dir + '/') : '') + n) : [pat];
}
const expandArgs = (S, toks) => toks.flatMap(t => t.glob ? expandGlob(S, t.v) : [t.v]);

/* ==========================================================================
   Executor
   ========================================================================== */
const CMD = Object.create(null);
const MAN = Object.create(null);
function def(names, man, fn) { for (const n of [].concat(names)) { CMD[n] = fn; if (man) MAN[n] = man; } }

function runCmd(S, argv, stdin, tty, raw) {
  let sudo = false;
  if (argv[0] === 'sudo') {
    argv = argv.slice(1); sudo = true;
    while (argv[0] && argv[0].startsWith('-')) argv = argv.slice(1);
    if (!argv.length) return fail('usage: sudo command');
  }
  const name = argv[0], args = argv.slice(1);
  const prev = S.root; if (sudo) S.root = true;
  let res;
  try {
    if (name.includes('/')) res = runScript(S, name, args);
    else if (CMD[name]) res = CMD[name]({ S, args, stdin, tty, sudo, name, raw }) || ok();
    else res = fail(`${name}: command not found`, 127);
  } catch (e) { console.error(e); res = fail(`${name}: ${e.message}`); }
  S.root = prev;
  res.out = res.out ?? ''; res.err = res.err ?? ''; res.code = res.code ?? 0;
  S.events.push({ name, args, sudo, out:stripAnsi(res.out), err:res.err, code:res.code, raw, meta:res.meta || {} });
  return res;
}
function runScript(S, path, args) {
  const abs = norm(S, path), n = getNode(S, abs);
  if (!n) return fail(`bash: ${path}: No such file or directory`, 127);
  if (n.type === 'dir') return fail(`bash: ${path}: Is a directory`, 126);
  if (!perm(S, n, 1)) return fail(`bash: ${path}: Permission denied`, 126);
  const h = S.scripts[abs];
  return h ? h(S, args) : ok();
}
function runLine(S, line, print) {
  S.events = [];
  let chain;
  try { chain = parseChain(tokenize(line, S.env)); }
  catch (e) { print('bash: ' + e.message, 'err'); return { editor:null }; }
  let last = 0, editor = null;
  for (const seg of chain) {
    if (seg.joiner === '&&' && last !== 0) continue;
    if (seg.joiner === '||' && last === 0) continue;
    let stdin = '', res = ok();
    seg.pipe.forEach((c, k) => {
      const isLast = k === seg.pipe.length - 1;
      const argv = expandArgs(S, c.args);
      if (!argv.length) return;
      res = runCmd(S, argv, stdin, isLast && !c.redir, line);
      if (res.editor) editor = res.editor;
      if (res.err) print(res.err, 'err');
      if (c.redir) {
        const data = res.out ? (res.out.endsWith('\n') ? res.out : res.out + '\n') : '';
        const w = writeFile(S, c.redir.path, stripAnsi(data), c.redir.op === '>>');
        if (w.err) { print(w.err, 'err'); res.code = 1; S.events.push({ name:'__redirect_fail', args:[c.redir.path], code:1, out:'', err:w.err, raw:line, meta:{} }); }
        else S.events.push({ name:'__write', args:[w.abs], code:0, out:'', err:'', raw:line, meta:{ path:w.abs } });
        stdin = '';
      } else if (!isLast) stdin = stripAnsi(res.out);
      else if (res.out) print(res.out);
    });
    last = res.code;
    if (editor) break;
  }
  return { editor };
}

/* ==========================================================================
   Core commands
   ========================================================================== */
def('help', 'help — list the commands this training shell understands', ({ S }) => {
  const g = [
    ['Files & text', 'ls cd pwd cat less head tail grep wc sort uniq cut awk sed tee echo touch mkdir rm cp mv find nano'],
    ['Users & system', 'whoami id sudo chmod ps kill env export source history date hostname clear'],
    ['Networking', 'ip ifconfig ping dig nslookup curl ss netstat traceroute nmap ipcalc'],
    ['Security', 'ufw sha256sum base64 sshd gitleaks'],
    ['DevOps', 'systemctl journalctl nginx git docker act crontab'],
    ['This game', 'submit <answer>   hint   tasks   man <command>'],
  ];
  return ok([`${C.B}Night Shift training shell${C.x} — a simulated Ubuntu 24.04 box for ${S.host}.`, '',
    ...g.map(([t, c]) => `${C.y}${t.padEnd(16)}${C.x}${c}`), '',
    `Pipes ${C.c}|${C.x}, ${C.c}&&${C.x}, ${C.c};${C.x}, redirects ${C.c}> >>${C.x}, globs ${C.c}*${C.x}, Tab completion and ↑/↓ history all work.`,
    `Type ${C.c}man ls${C.x} (or any command) for a one-line explanation.`].join('\n'));
});
def('man', null, ({ args }) => {
  const n = args[0]; if (!n) return fail('What manual page do you want?\nFor example, try \'man ls\'.');
  return MAN[n] ? ok(MAN[n]) : fail(`No manual entry for ${n}`, 16);
});
def('clear', 'clear — clear the terminal screen (Ctrl+L also works)', () => ({ out:'', meta:{ clear:true }, clear:true }));
def('pwd', 'pwd — print the directory you are in', ({ S }) => ok(S.cwd));
def('cd', 'cd DIR — change directory. `cd` alone goes home, `cd ..` goes up one level', ({ S, args }) => {
  const t = args[0] ?? '~'; const abs = norm(S, t === '-' ? (S.oldpwd || S.cwd) : t), n = getNode(S, abs);
  if (!n) return fail(`bash: cd: ${t}: No such file or directory`);
  if (n.type !== 'dir') return fail(`bash: cd: ${t}: Not a directory`);
  if (!perm(S, n, 1)) return fail(`bash: cd: ${t}: Permission denied`);
  S.oldpwd = S.cwd; S.cwd = abs; S.env.PWD = abs; return ok();
});
function longLine(name, n, tty) {
  const size = n.type === 'dir' ? 4096 : new TextEncoder().encode(n.content).length;
  return `${n.type === 'dir' ? 'd' : '-'}${rwx(n.mode)} ${n.type === 'dir' ? 2 : 1} ${n.owner.padEnd(5)} ${n.owner.padEnd(5)} ${String(size).padStart(5)} Nov 10 01:${n.type === 'dir' ? '12' : '31'} ${colorName(name, n, tty)}`;
}
function colorName(name, n, tty) {
  if (!tty) return name;
  if (n.type === 'dir') return n.mode[2] === '7' ? `\x1b[34;42m${name}${C.x}` : `${C.B}${C.b}${name}${C.x}`;
  if (/[1357]/.test(n.mode)) return `${C.B}${C.g}${name}${C.x}`;
  return name;
}
def(['ls', 'll'], 'ls [-l] [-a] [PATH] — list files. -l shows permissions, owner, size; -a includes hidden dotfiles', ({ S, args, tty, name }) => {
  const { f, pos } = opts(args); if (name === 'll') { f.l = true; f.a = true; }
  const long = f.l, all = f.a || f.A;
  const targets = pos.length ? pos : ['.']; const out = [], err = [];
  for (const t of targets) {
    const abs = norm(S, t), n = getNode(S, abs);
    if (!n) { err.push(`ls: cannot access '${t}': No such file or directory`); continue; }
    if (n.type === 'file') { out.push(long ? longLine(t, n, tty) : colorName(t, n, tty)); continue; }
    if (!perm(S, n, 4)) { err.push(`ls: cannot open directory '${t}': Permission denied`); continue; }
    if (targets.length > 1) out.push((out.length ? '\n' : '') + t + ':');
    let ents = Object.keys(n.children).sort((a, b) => a.replace(/^\./, '').localeCompare(b.replace(/^\./, ''))).map(k => [k, n.children[k]]);
    if (!all) ents = ents.filter(([k]) => !k.startsWith('.'));
    if (f.a) ents = [['.', n], ['..', getNode(S, parentOf(abs)[0])], ...ents];
    if (long) { out.push('total ' + ents.length * 4); ents.forEach(([k, c]) => out.push(longLine(k, c, tty))); }
    else if (ents.length) out.push(ents.map(([k, c]) => colorName(k, c, tty)).join('  '));
  }
  return { out:out.join('\n'), err:err.join('\n'), code:err.length ? 2 : 0 };
});
def(['cat', 'less', 'more'], 'cat FILE... — print files. (less/more behave like cat here)', ({ S, args, stdin, name }) => {
  const { pos, f } = opts(args); const r = inputText(S, pos, stdin, name);
  let text = r.text.replace(/\n$/, '');
  if (f.n) text = lines(r.text).map((l, i) => String(i + 1).padStart(6) + '\t' + l).join('\n');
  return { out:text, err:r.err, code:r.err ? 1 : 0 };
});
def('echo', 'echo TEXT — print text. Handy with pipes: echo "x" | base64 -d', ({ args }) => {
  let a = args, nl = true; if (a[0] === '-n') { nl = false; a = a.slice(1); } if (a[0] === '-e') a = a.slice(1);
  return ok(a.join(' '));
});
function headTail(which) {
  return ({ S, args, stdin }) => {
    let n = 10; const rest = [];
    for (let i = 0; i < args.length; i++) { const a = args[i]; if (/^-\d+$/.test(a)) n = +a.slice(1); else if (a === '-n') n = +args[++i]; else if (/^-n\d+$/.test(a)) n = +a.slice(2); else if (a === '-f' || a === '-F') {} else rest.push(a); }
    const r = inputText(S, rest, stdin, which); const L = lines(r.text);
    return { out:(which === 'head' ? L.slice(0, n) : L.slice(Math.max(0, L.length - n))).join('\n'), err:r.err, code:r.err ? 1 : 0 };
  };
}
def('head', 'head [-n N] FILE — first N lines (default 10)', headTail('head'));
def('tail', 'tail [-n N] FILE — last N lines (default 10). Logs grow at the bottom, so tail is your friend', headTail('tail'));
def(['grep', 'egrep'], 'grep [-i -v -c -n -o -E -r -w -l] PATTERN [FILE...] — print lines matching a pattern. -i ignore case, -v invert, -c count, -o only the matching part, -n line numbers, -r recurse directories', ({ S, args, stdin, tty }) => {
  const { f, pos } = opts(args, 'em');
  let pat = f.e ?? pos.shift();
  if (pat == null) return fail('Usage: grep [OPTION]... PATTERNS [FILE]...\nTry \'grep --help\' for more information.', 2);
  if (f.w) pat = `\\b(?:${pat})\\b`;
  let re; try { re = new RegExp(pat.replace(/\\</g, '\\b').replace(/\\>/g, '\\b'), f.i ? 'gi' : 'g'); } catch { re = new RegExp(pat.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), f.i ? 'gi' : 'g'); }
  let files = pos.map(p => ({ p }));
  if (f.r || f.R) { const start = pos.length ? pos : ['.']; files = []; for (const p of start) { const n = nodeAt(S, p); if (!n) { files.push({ p }); continue; } walk(n, p.replace(/\/$/, ''), (path, node) => { if (node.type === 'file') files.push({ p:path }); }); } }
  const multi = files.length > 1 || f.r || f.R;
  const out = [], errs = []; let total = 0;
  const sources = files.length ? files.map(({ p }) => { const r = readFile(S, p, 'grep'); if (r.err) { errs.push(r.err); return null; } return { p, text:r.content }; }).filter(Boolean) : [{ p:'(standard input)', text:stdin || '' }];
  for (const { p, text } of sources) {
    let count = 0;
    lines(text).forEach((l, i) => {
      re.lastIndex = 0; const hit = re.test(l); if (hit === !!f.v) return;
      count++; total++;
      if (f.c || f.l || f.q) return;
      const pre = (multi ? (tty ? `${C.m}${p}${C.x}${C.c}:${C.x}` : p + ':') : '') + (f.n ? (tty ? `${C.g}${i + 1}${C.x}${C.c}:${C.x}` : (i + 1) + ':') : '');
      if (f.o && !f.v) { re.lastIndex = 0; for (const m of l.matchAll(re)) out.push(pre + (tty ? `${C.B}${C.r}${m[0]}${C.x}` : m[0])); }
      else out.push(pre + (tty && !f.v ? l.replace(re, m => `${C.B}${C.r}${m}${C.x}`) : l));
    });
    if (f.c) out.push((multi ? p + ':' : '') + count);
    if (f.l && count) out.push(p);
  }
  if (f.q) return { out:'', code:total ? 0 : 1 };
  return { out:out.join('\n'), err:errs.join('\n'), code:errs.length ? 2 : (total ? 0 : 1) };
});
def('wc', 'wc [-l -w -c] [FILE] — count lines, words, bytes. `grep x file | wc -l` counts matches', ({ S, args, stdin }) => {
  const { f, pos } = opts(args); const r = inputText(S, pos, stdin, 'wc'); if (r.err) return fail(r.err);
  const L = lines(r.text).length, W = r.text.split(/\s+/).filter(Boolean).length, B = new TextEncoder().encode(r.text).length;
  const parts = []; const any = f.l || f.w || f.c || f.m;
  if (!any || f.l) parts.push(L); if (!any || f.w) parts.push(W); if (!any || f.c || f.m) parts.push(B);
  const name = pos.length === 1 ? ' ' + pos[0] : '';
  return ok((parts.length === 1 && !name ? String(parts[0]) : parts.map(x => String(x).padStart(pos.length ? 1 : 7)).join(' ')) + name);
});
def('sort', 'sort [-n -r -u -k N] — sort lines. -n numeric, -r reverse. sort | uniq -c | sort -nr is the classic "top N" recipe', ({ S, args, stdin }) => {
  const { f, pos } = opts(args, 'kt'); const r = inputText(S, pos, stdin, 'sort'); if (r.err) return fail(r.err, 2);
  const k = f.k ? parseInt(f.k) : 0; const sep = f.t;
  const key = l => k ? (sep ? l.split(sep) : l.trim().split(/\s+/))[k - 1] ?? '' : l;
  let L = lines(r.text);
  L.sort((a, b) => { if (f.n) { const d = (parseFloat(key(a)) || 0) - (parseFloat(key(b)) || 0); return d || (a < b ? -1 : a > b ? 1 : 0); } const x = key(a), y = key(b); return x < y ? -1 : x > y ? 1 : 0; });
  if (f.r) L.reverse(); if (f.u) L = L.filter((l, i) => i === 0 || l !== L[i - 1]);
  return ok(L.join('\n'));
});
def('uniq', 'uniq [-c] [-d] — collapse ADJACENT duplicate lines (so sort first). -c prefixes a count', ({ S, args, stdin }) => {
  const { f, pos } = opts(args); const r = inputText(S, pos, stdin, 'uniq'); if (r.err) return fail(r.err);
  const out = []; let prev = null, n = 0;
  const push = () => { if (prev === null) return; if (f.d && n < 2) return; if (f.u && n > 1) return; out.push(f.c ? String(n).padStart(7) + ' ' + prev : prev); };
  for (const l of lines(r.text)) { if (l === prev) n++; else { push(); prev = l; n = 1; } }
  push(); return ok(out.join('\n'));
});
def('cut', 'cut -d DELIM -f FIELDS — pick columns. e.g. cut -d: -f1 /etc/passwd', ({ S, args, stdin }) => {
  const { f, pos } = opts(args, 'dfc'); const r = inputText(S, pos, stdin, 'cut'); if (r.err) return fail(r.err);
  if (!f.f && !f.c) return fail('cut: you must specify a list of bytes, characters, or fields');
  const d = f.d ?? '\t'; const want = new Set();
  for (const part of String(f.f || f.c).split(',')) { const [a, b] = part.split('-'); const s = +a || 1, e = part.includes('-') ? (+b || 999) : s; for (let i = s; i <= e; i++) want.add(i); }
  return ok(lines(r.text).map(l => f.c ? [...l].filter((_, i) => want.has(i + 1)).join('') : (l.includes(d) ? l.split(d).filter((_, i) => want.has(i + 1)).join(d) : l)).join('\n'));
});
def('awk', "awk [-F SEP] '[/regex/] {print $N, $M}' — print chosen fields. $1 is the first field, $NF the last", ({ S, args, stdin }) => {
  const { f, pos } = opts(args, 'F'); const prog = pos.shift(); if (!prog) return fail('usage: awk [-F fs] \'program\' [file ...]', 2);
  const m = /^\s*(?:\/((?:\\\/|[^/])*)\/\s*)?(?:(NR\s*[<>=!]=?\s*\d+)\s*)?\{\s*print\s*([^}]*)\}\s*$/.exec(prog);
  if (!m) return fail("awk: this training shell understands programs like '{print $1}' or '/Failed/ {print $11, $9}'", 2);
  const re = m[1] ? new RegExp(m[1]) : null; const cond = m[2];
  const r = inputText(S, pos, stdin, 'awk'); if (r.err) return fail(r.err, 2);
  const items = m[3].trim() ? m[3].split(',').map(s => s.trim()) : ['$0'];
  const out = [];
  lines(r.text).forEach((l, i) => {
    if (re && !re.test(l)) return;
    if (cond) { const [, op, v] = /NR\s*([<>=!]=?)\s*(\d+)/.exec(cond); const nr = i + 1, n = +v; if (!({ '<':nr < n, '<=':nr <= n, '>':nr > n, '>=':nr >= n, '==':nr === n, '=':nr === n, '!=':nr !== n })[op]) return; }
    const F = f.F ? l.split(f.F === ' ' ? /\s+/ : f.F) : l.trim().split(/\s+/);
    out.push(items.map(it => {
      if (/^"(.*)"$/.test(it)) return it.slice(1, -1);
      if (it === '$0') return l; if (it === '$NF') return F[F.length - 1]; if (it === 'NR') return String(i + 1); if (it === 'NF') return String(F.length);
      const k = /^\$(\d+)$/.exec(it); return k ? (F[+k[1] - 1] ?? '') : it;
    }).join(' '));
  });
  return ok(out.join('\n'));
});
def('sed', "sed [-i] 's/OLD/NEW/[g]' FILE — find & replace in text (-i edits the file in place). Also: sed -n '5,10p' FILE", ({ S, args, stdin }) => {
  const { f, pos } = opts(args, 'e'); const script = f.e ?? pos.shift(); if (!script) return fail('Usage: sed [OPTION]... {script-only-if-no-other-script} [input-file]...', 1);
  let fn;
  const sm = /^s(.)(.*?)\1(.*?)\1([gI]*)$/.exec(script);
  const pm = /^(\d+)(?:,(\d+|\$))?p$/.exec(script);
  const dm = /^\/(.*)\/d$/.exec(script);
  if (sm) { let re; try { re = new RegExp(sm[2], (sm[4].includes('g') ? 'g' : '') + (sm[4].includes('I') ? 'i' : '')); } catch { return fail(`sed: -e expression #1, char ${script.length}: invalid regex`); } const rep = sm[3].replace(/\\(\d)/g, '$$$1').replace(/&/g, '$$&'); fn = L => L.map(l => l.replace(re, rep)); }
  else if (pm) { const a = +pm[1], b = pm[2] === '$' ? Infinity : +(pm[2] || pm[1]); fn = L => f.n ? L.filter((_, i) => i + 1 >= a && i + 1 <= b) : L.flatMap((l, i) => i + 1 >= a && i + 1 <= b ? [l, l] : [l]); }
  else if (dm) { const re = new RegExp(dm[1]); fn = L => L.filter(l => !re.test(l)); }
  else return fail(`sed: -e expression #1, char 1: this training shell supports s/old/new/g, Np, N,Mp and /re/d`);
  if (f.i) {
    if (!pos.length) return fail('sed: no input files');
    for (const p of pos) { const r = readFile(S, p, 'sed'); if (r.err) return fail(r.err.replace('sed: ', 'sed: can\'t read ')); if (!perm(S, r.node, 2)) return fail(`sed: couldn't open temporary file ${parentOf(r.abs)[0]}/sedX1a2b: Permission denied`, 4); r.node.content = fn(lines(r.content)).join('\n') + '\n'; S.events.push({ name:'__write', args:[r.abs], code:0, out:'', err:'', meta:{ path:r.abs } }); }
    return ok();
  }
  const r = inputText(S, pos, stdin, 'sed'); if (r.err) return fail(r.err.replace('sed: ', 'sed: can\'t read '), 2);
  return ok(fn(lines(r.text)).join('\n'));
});
def('tee', 'tee [-a] FILE — copy input to a file AND the screen. `echo x | sudo tee /etc/file` writes as root', ({ S, args, stdin }) => {
  const { f, pos } = opts(args); const errs = [];
  for (const p of pos) { const w = writeFile(S, p, stdin.endsWith('\n') || !stdin ? stdin : stdin + '\n', !!f.a, 'tee'); if (w.err) errs.push(w.err); else S.events.push({ name:'__write', args:[w.abs], code:0, out:'', err:'', meta:{ path:w.abs } }); }
  return { out:stdin.replace(/\n$/, ''), err:errs.join('\n'), code:errs.length ? 1 : 0 };
});
def('touch', 'touch FILE — create an empty file (or update its timestamp)', ({ S, args }) => {
  for (const p of args.filter(a => !a.startsWith('-'))) { if (nodeAt(S, p)) continue; const w = writeFile(S, p, '', false, 'touch'); if (w.err) return fail(w.err.replace(/^touch: (.*): /, "touch: cannot touch '$1': ")); }
  return ok();
});
def('mkdir', 'mkdir [-p] DIR — make a directory (-p creates parents too)', ({ S, args }) => {
  const { f, pos } = opts(args);
  for (const p of pos) {
    const abs = norm(S, p);
    if (getNode(S, abs)) { if (f.p) continue; return fail(`mkdir: cannot create directory '${p}': File exists`); }
    const parts = abs.split('/').filter(Boolean); let n = S.fs;
    for (let i = 0; i < parts.length; i++) {
      const last = i === parts.length - 1;
      if (!n.children[parts[i]]) {
        if (!last && !f.p) return fail(`mkdir: cannot create directory '${p}': No such file or directory`);
        if (!perm(S, n, 2)) return fail(`mkdir: cannot create directory '${p}': Permission denied`);
        n.children[parts[i]] = { type:'dir', children:{}, mode:'755', owner:S.root ? 'root' : S.user };
      }
      n = n.children[parts[i]];
    }
  }
  return ok();
});
def('rm', 'rm [-r] [-f] PATH — delete files (-r for directories). There is no recycle bin', ({ S, args }) => {
  const { f, pos } = opts(args); const errs = [];
  for (const p of pos) {
    const abs = norm(S, p), n = getNode(S, abs);
    if (!n) { if (!f.f) errs.push(`rm: cannot remove '${p}': No such file or directory`); continue; }
    if (n.type === 'dir' && !(f.r || f.R)) { errs.push(`rm: cannot remove '${p}': Is a directory`); continue; }
    const [d, name] = parentOf(abs); const dn = getNode(S, d);
    if (!perm(S, dn, 2)) { errs.push(`rm: cannot remove '${p}': Permission denied`); continue; }
    delete dn.children[name];
  }
  return { out:'', err:errs.join('\n'), code:errs.length ? 1 : 0 };
});
const clone = o => JSON.parse(JSON.stringify(o));
function copyMove(move) {
  return ({ S, args, name }) => {
    const { f, pos } = opts(args); if (pos.length < 2) return fail(`${name}: missing destination file operand after '${pos[0] || ''}'`);
    const dst = pos.pop(); const dstAbs = norm(S, dst); const dn = getNode(S, dstAbs);
    for (const src of pos) {
      const sAbs = norm(S, src), sn = getNode(S, sAbs);
      if (!sn) return fail(`${name}: cannot stat '${src}': No such file or directory`);
      if (sn.type === 'dir' && !move && !(f.r || f.R)) return fail(`cp: -r not specified; omitting directory '${src}'`);
      const target = dn && dn.type === 'dir' ? dstAbs + '/' + parentOf(sAbs)[1] : dstAbs;
      const [td, tname] = parentOf(target); const tdn = getNode(S, td);
      if (!tdn || tdn.type !== 'dir') return fail(`${name}: cannot create regular file '${dst}': No such file or directory`);
      if (!perm(S, tdn, 2)) return fail(`${name}: cannot create regular file '${dst}': Permission denied`);
      const copy = clone(sn); if (!move) copy.owner = S.root ? 'root' : S.user;
      tdn.children[tname] = copy;
      if (move) { const [sd, sname] = parentOf(sAbs); delete getNode(S, sd).children[sname]; }
      S.events.push({ name:'__write', args:[target], code:0, out:'', err:'', meta:{ path:target } });
    }
    return ok();
  };
}
def('cp', 'cp [-r] SRC DST — copy files', copyMove(false));
def('mv', 'mv SRC DST — move or rename files', copyMove(true));
def('chmod', 'chmod MODE FILE — change permissions. Octal: 600, 644, 755 (r=4 w=2 x=1 for owner/group/others). Symbolic: u+x, go-w, o-rwx', ({ S, args }) => {
  const { f, pos } = opts(args.map(a => /^[ugoa]*[+\-=][rwxX]*$/.test(a) && a.startsWith('-') ? '\u0000' + a : a));
  const items = pos.map(a => a.replace('\u0000', ''));
  const mode = items.shift(); if (!mode || !items.length) return fail("chmod: missing operand\nTry 'chmod --help' for more information.");
  const apply = (n) => {
    if (/^0?[0-7]{3}$/.test(mode)) { n.mode = mode.slice(-3); return; }
    let d = [...n.mode].map(Number);
    for (const clause of mode.split(',')) {
      const m = /^([ugoa]*)([+\-=])([rwxX]*)$/.exec(clause); if (!m) throw new Error(`invalid mode: '${mode}'`);
      const who = (m[1] || 'a').replace('a', 'ugo'); let bits = 0; for (const c of m[3]) bits |= c === 'r' ? 4 : c === 'w' ? 2 : 1;
      for (const w of who) { const i = 'ugo'.indexOf(w); if (m[2] === '+') d[i] |= bits; else if (m[2] === '-') d[i] &= ~bits; else d[i] = bits; }
    }
    n.mode = d.join('');
  };
  const errs = [];
  for (const p of items) {
    const n = nodeAt(S, p); if (!n) { errs.push(`chmod: cannot access '${p}': No such file or directory`); continue; }
    if (!S.root && n.owner !== S.user) { errs.push(`chmod: changing permissions of '${p}': Operation not permitted`); continue; }
    try { if (f.R && n.type === 'dir') walk(n, p, (_, c) => apply(c)); else apply(n); } catch (e) { return fail('chmod: ' + e.message); }
  }
  return { out:'', err:errs.join('\n'), code:errs.length ? 1 : 0 };
});
def('find', 'find [PATH] [-name PATTERN] [-type f|d] [-perm MODE] — search for files by name, type or permissions', ({ S, args }) => {
  const start = args[0] && !args[0].startsWith('-') ? args[0] : '.';
  const rest = args[0] === start ? args.slice(1) : args;
  let name = null, type = null, perm_ = null, iname = false;
  for (let i = 0; i < rest.length; i++) { const a = rest[i]; if (a === '-name' || a === '-iname') { name = rest[++i]; iname = a === '-iname'; } else if (a === '-type') type = rest[++i]; else if (a === '-perm') perm_ = rest[++i]; }
  const n = nodeAt(S, start); if (!n) return fail(`find: '${start}': No such file or directory`);
  const re = name ? new RegExp('^' + name.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$', iname ? 'i' : '') : null;
  const out = [];
  walk(n, start.replace(/(.)\/$/, '$1'), (path, node) => {
    const base = path.split('/').pop();
    if (re && !re.test(base)) return; if (type && (type === 'd') !== (node.type === 'dir')) return;
    if (perm_) { const pm = perm_.replace(/^[-/]/, ''); if (perm_.startsWith('-') || perm_.startsWith('/')) { const want = [...pm.padStart(3, '0').slice(-3)].map(Number); if (!want.every((w, i) => (+node.mode[i] & w) === w || (perm_.startsWith('/') && (+node.mode[i] & w)))) return; } else if (node.mode !== pm.slice(-3)) return; }
    out.push(path);
  });
  return ok(out.join('\n'));
});
def('whoami', 'whoami — print your username', ({ S }) => ok(S.root ? 'root' : S.user));
def('id', 'id — show your user id and groups (sudo means you may run commands as root)', ({ S }) => ok(S.root ? 'uid=0(root) gid=0(root) groups=0(root)' : 'uid=1000(ops) gid=1000(ops) groups=1000(ops),4(adm),27(sudo),998(docker)'));
def('hostname', 'hostname — print this machine\'s name', ({ S }) => ok(S.host));
def('date', 'date — print the current date and time', () => ok(dateStr()));
def('uname', 'uname [-a] — print kernel information', ({ S, args }) => ok(args.includes('-a') ? `Linux ${S.host} 6.8.0-48-generic #48-Ubuntu SMP PREEMPT_DYNAMIC x86_64 GNU/Linux` : 'Linux'));
def('history', 'history — list the commands you have typed', ({ S }) => ok(S.history.map((h, i) => String(i + 1).padStart(5) + '  ' + h).join('\n')));
def(['env', 'printenv'], 'env — list environment variables. printenv NAME prints one', ({ S, args, name }) => name === 'printenv' && args[0] ? (S.env[args[0]] != null ? ok(S.env[args[0]]) : { code:1 }) : ok(Object.entries(S.env).map(([k, v]) => `${k}=${v}`).join('\n')));
def('export', 'export NAME=value — set an environment variable for this shell and the programs it starts', ({ S, args }) => {
  for (const a of args) { const m = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(a); if (m) S.env[m[1]] = m[2]; else if (!/^[A-Za-z_]\w*$/.test(a)) return fail(`bash: export: \`${a}': not a valid identifier`); }
  return ok();
});
def('unset', 'unset NAME — remove an environment variable', ({ S, args }) => { args.forEach(a => delete S.env[a]); return ok(); });
def(['source', '.'], 'source FILE — run KEY=value lines from a file in this shell (e.g. source .env)', ({ S, args }) => {
  const r = readFile(S, args[0] || '', 'bash'); if (r.err) return fail(r.err.replace('bash: ', 'bash: '));
  for (const l of lines(r.content)) { const m = /^\s*(?:export\s+)?([A-Za-z_]\w*)=["']?(.*?)["']?\s*$/.exec(l); if (m) S.env[m[1]] = m[2]; }
  return ok();
});
def(['bash', 'sh'], 'bash FILE — run a shell script (no execute permission needed when you name the interpreter)', ({ S, args }) => {
  if (!args[0]) return fail('bash: interactive sub-shells are not available in this training shell');
  const abs = norm(S, args[0]), n = getNode(S, abs); if (!n) return fail(`bash: ${args[0]}: No such file or directory`, 127);
  if (!perm(S, n, 4)) return fail(`bash: ${args[0]}: Permission denied`, 126);
  const h = S.scripts[abs]; return h ? h(S, args.slice(1)) : ok();
});
def(['nano', 'vim', 'vi', 'edit'], 'nano FILE — edit a text file. Ctrl+S saves, Ctrl+X exits. Needs sudo for files owned by root', ({ S, args }) => {
  const p = args.filter(a => !a.startsWith('-') && !a.startsWith('+'))[0]; if (!p) return fail('nano: please name a file to edit, e.g. nano notes.txt');
  const abs = norm(S, p), n = getNode(S, abs);
  if (n && n.type === 'dir') return fail(`nano: ${p} is a directory`);
  if (n && !perm(S, n, 4)) return fail(`nano: ${p}: Permission denied`);
  const asRoot = S.root;
  let ro = false;
  if (n) ro = !perm(S, n, 2); else { const dn = getNode(S, parentOf(abs)[0]); ro = !dn || !perm(S, dn, 2); }
  return { out:'', code:0, editor:{ title:p, path:abs, content:n ? n.content : '', ro, asRoot } };
});
def('submit', 'submit ANSWER — answer a question from the ticket\'s objectives', () => ok()); // replaced by the app
def('hint', 'hint — reveal the next hint for this ticket (costs a little XP)', () => ok());
def('tasks', 'tasks — list this ticket\'s objectives in the terminal', () => ok());
def('exit', null, () => ok('logout? Not on night shift. (Pick another ticket from the queue instead.)'));
def('ps', 'ps aux — list running processes with their PID, user and full command', ({ S, args }) => {
  const rows = S.procs.map(p => ({ ...p }));
  const fp = args.indexOf('-p') >= 0 ? args[args.indexOf('-p') + 1] : (args.find(a => /^-fp/.test(a)) ? args[args.indexOf(args.find(a => /^-fp/.test(a))) + 1] || args.find(a => /^-fp/.test(a)).slice(3) : null);
  if (args.some(a => /^-?e?f/.test(a)) && !args.includes('aux')) {
    const L = ['UID          PID    PPID  C STIME TTY          TIME CMD'];
    rows.filter(p => !fp || String(p.pid) === String(fp)).forEach(p => L.push(`${p.user.padEnd(12).slice(0, 12)} ${String(p.pid).padStart(4)} ${String(p.ppid ?? 1).padStart(7)}  0 01:0${p.pid % 9} ?        00:00:0${p.pid % 7} ${p.cmd}`));
    return { out:L.join('\n'), code:L.length > 1 ? 0 : 1 };
  }
  const L = ['USER         PID %CPU %MEM    VSZ   RSS TTY      STAT START   TIME COMMAND'];
  rows.forEach(p => L.push(`${p.user.padEnd(10).slice(0, 10)} ${String(p.pid).padStart(5)}  ${(p.cpu ?? 0.0).toFixed(1)}  ${(p.mem ?? 0.2).toFixed(1)} ${String(p.vsz ?? 12880).padStart(6)} ${String(p.rss ?? 4120).padStart(5)} ${p.tty ?? '?'}        ${p.stat ?? 'Ss'}   01:0${p.pid % 9}   0:00 ${p.cmd}`));
  return ok(L.join('\n'));
});
def('kill', 'kill [-9] PID — send a signal to a process (default TERM: please exit; -9 KILL: stop now)', ({ S, args }) => {
  const pids = args.filter(a => /^\d+$/.test(a)); if (!pids.length) return fail('kill: usage: kill [-s sigspec | -n signum | -sigspec] pid | jobspec ... or kill -l [sigspec]', 2);
  const errs = [];
  for (const pid of pids) {
    const i = S.procs.findIndex(p => String(p.pid) === pid);
    if (i < 0) { errs.push(`bash: kill: (${pid}) - No such process`); continue; }
    const p = S.procs[i];
    if (!S.root && p.user !== S.user) { errs.push(`bash: kill: (${pid}) - Operation not permitted`); continue; }
    if (p.pid === 1) { errs.push(`bash: kill: (1) - Operation not permitted`); continue; }
    S.procs.splice(i, 1); S.flags['killed_' + pid] = true;
  }
  return { out:'', err:errs.join('\n'), code:errs.length ? 1 : 0 };
});
