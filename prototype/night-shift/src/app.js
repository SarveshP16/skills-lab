/* ==========================================================================
   Night Shift — UI: queue, briefing, terminal, editor, progress
   ========================================================================== */
const $ = s => document.querySelector(s);
const STORE = 'nightshift.progress.v1';
const RANKS = [[0, 'Intern'], [250, 'Junior Engineer'], [700, 'Engineer'], [1300, 'Senior Engineer'], [2000, 'Staff Engineer'], [2600, 'Night Shift Lead']];
const HINT_COST = 10, QUIZ_XP = 15;

let progress = loadProgress();
let S = null, LAB = null, cmdHistory = [], hIdx = 0, editor = null, edDirty = false, edExitArmed = false;

function loadProgress() { try { const p = JSON.parse(localStorage.getItem(STORE)); if (p && p.labs) return p; } catch {} return { labs:{}, current:null }; }
function saveProgress() { try { localStorage.setItem(STORE, JSON.stringify(progress)); } catch {} }
const labProg = id => (progress.labs[id] ||= { done:false, xp:0, quiz:{} });
function totalXP() { return Object.values(progress.labs).reduce((a, l) => a + (l.xp || 0) + Object.values(l.quiz || {}).filter(Boolean).length * QUIZ_XP, 0); }

/* ---------------- sandbox ---------------- */
function createSandbox(lab) {
  const S = { lab, user:'ops', root:false, host:lab.host, cwd:lab.cwd || HOME, oldpwd:null, history:[], flags:{}, done:new Set(), events:[], hintsShown:0,
    env:{ HOME, USER:'ops', LOGNAME:'ops', SHELL:'/bin/bash', PATH:'/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin', LANG:'C.UTF-8', TERM:'xterm-256color', PWD:lab.cwd || HOME, HOSTNAME:lab.host, EDITOR:'nano' },
    procs:BASE_PROCS(), services:{}, scripts:{}, fw:null, cron:{ text:null, draft:null }, git:null, docker:null, ci:null };
  S.fs = buildFS({ ...baseFiles(lab.host, lab.ns), ...(lab.files ? lab.files(S) : {}) });
  S.net = lab.net(S);
  if (lab.setup) lab.setup(S);
  S.history = cmdHistory;
  return S;
}

/* ---------------- terminal ---------------- */
const linesEl = $('#lines'), outEl = $('#out'), input = $('#cmd'), promptEl = $('#prompt');
function print(text, cls) {
  const d = document.createElement('div'); d.className = 'ln' + (cls ? ' ' + cls : '');
  d.innerHTML = ansiToHtml(text); linesEl.appendChild(d);
  while (linesEl.childElementCount > 1200) linesEl.firstElementChild.remove();
}
const scrollEnd = () => { outEl.scrollTop = outEl.scrollHeight; };
const shortPath = p => p === HOME ? '~' : p.startsWith(HOME + '/') ? '~' + p.slice(HOME.length) : p;
function promptHTML() { return `ops@${esc(S.host)}:<span class="path">${esc(shortPath(S.cwd))}</span>$ `; }
function renderPrompt() { promptEl.innerHTML = promptHTML(); $('#termHost').textContent = `ops@${S.host} — ${LAB.code}`; }
function echoCmd(line) { const d = document.createElement('div'); d.className = 'ln cmdline'; d.innerHTML = `<span class="p">${promptHTML()}</span>${esc(line)}`; linesEl.appendChild(d); }

function runInput(line) {
  echoCmd(line);
  if (line.trim()) { cmdHistory.push(line); if (cmdHistory.length > 200) cmdHistory.shift(); }
  hIdx = cmdHistory.length;
  if (!line.trim()) return;
  const res = runLine(S, line, print);
  if (S.events.some(e => e.name === 'clear')) linesEl.innerHTML = '';
  afterCommands(line);
  renderPrompt();
  if (res.editor) openEditor(res.editor);
}
function afterCommands(line) {
  for (const ev of S.events) if (LAB.onEvent) LAB.onEvent(S, ev);
  evaluate(S.events);
  const c = (LAB.coach && LAB.coach(S, line)) || genericCoach(line);
  if (c) print('coach › ' + c, 'coach');
}
const WINDOWS = { ipconfig:'ip addr', cls:'clear', dir:'ls -la', type:'cat', 'netstat.exe':'ss -tulpn', copy:'cp', move:'mv', del:'rm', ifup:'ip link', service:'systemctl' };
function genericCoach(line) {
  const evs = S.events;
  const nf = evs.find(e => e.code === 127 && WINDOWS[e.name]); if (nf) return `On Linux, use \`${WINDOWS[nf.name]}\` instead of ${nf.name}.`;
  if (evs.some(e => e.name === '__redirect_fail') && /^\s*sudo\b/.test(line)) return 'The > redirection is done by your own shell, which is not root. sudo only applied to the command. Pipe into `sudo tee FILE` instead.';
  if (!S.flags.coachedSudo && evs.some(e => !e.sudo && /Permission denied|Operation not permitted|Interactive authentication required|need to be root|needs root/.test(e.err))) { S.flags.coachedSudo = true; return 'That needs administrator rights. Run the same command again with `sudo` in front.'; }
  return null;
}

/* ---------------- objectives ---------------- */
function evaluate(evs) {
  let changed = false;
  LAB.objectives.forEach((o, i) => {
    if (S.done.has(i) || o.answer || !o.check) return;
    let hit = false;
    try { hit = o.check(S, null) || evs.some(ev => o.check(S, ev)); } catch (e) { console.error(e); }
    if (hit) { S.done.add(i); changed = true; print(`${C.g}✔ Objective complete:${C.x} ${plain(o.text)}`); }
  });
  if (changed) { renderObjectives(); checkComplete(); }
}
const plain = t => t.replace(/`([^`]+)`/g, '$1');
const fmt = t => esc(t).replace(/`([^`]+)`/g, '<code>$1</code>');
function markDone(i) { S.done.add(i); }
function checkComplete() {
  if (S.completed || S.done.size < LAB.objectives.length) return;
  S.completed = true;
  const lp = labProg(LAB.id);
  const earned = Math.max(Math.round(LAB.xp / 2), LAB.xp - S.hintsShown * HINT_COST);
  const first = !lp.done; lp.done = true; lp.xp = Math.max(lp.xp || 0, earned); saveProgress();
  print('');
  print(`${C.g}${C.B}━━━ TICKET ${LAB.code} RESOLVED ━━━${C.x}  ${first ? `+${earned} XP` : `best: ${lp.xp} XP`}${S.hintsShown ? ` (${S.hintsShown} hint${S.hintsShown > 1 ? 's' : ''} used)` : ''}`);
  print(`${C.d}Read the debrief and take the two-question check in the briefing panel for +${QUIZ_XP} XP each.${C.x}`, 'sys');
  renderAll();
  const r = document.getElementById('resolved'); if (r) r.scrollIntoView({ behavior:matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block:'start' });
}

/* game commands */
const normAns = s => String(s).trim().toLowerCase().replace(/^["']|["']$/g, '').replace(/[.。]$/, '').replace(/\s+/g, ' ');
CMD.submit = ({ args }) => {
  const raw = args.join(' ').trim(); const ans = normAns(raw);
  if (!ans) return fail('usage: submit <answer>     e.g.  submit 10.20.4.1');
  const open = LAB.objectives.map((o, i) => [o, i]).filter(([o, i]) => o.answer && !S.done.has(i));
  if (!open.length) return ok('Nothing left to submit on this ticket.');
  for (const [o, i] of open) {
    const acc = (typeof o.answer === 'function' ? o.answer(S) : o.answer).map(normAns);
    if (acc.includes(ans)) { markDone(i); setTimeout(() => { renderObjectives(); checkComplete(); }); return ok(`${C.g}✔ Correct${C.x} — ${plain(o.text)}${o.explain ? `\n  ${C.d}${o.explain}${C.x}` : ''}`); }
  }
  return fail(`✘ "${raw}" doesn't answer any open question. Re-read the objectives (and the expected format), or type hint.`);
};
CMD.hint = () => { const h = revealHint(); return h ? ok(`${C.y}hint ${S.hintsShown}/${LAB.hints.length} ›${C.x} ${plain(h)}`) : ok('No more hints for this ticket. You\'ve got this.'); };
CMD.tasks = () => ok(LAB.objectives.map((o, i) => `${S.done.has(i) ? C.g + '✔' : C.d + '·'}${C.x} ${plain(o.text)}`).join('\n'));
function revealHint() {
  if (S.hintsShown >= LAB.hints.length) return null;
  const h = LAB.hints[S.hintsShown++]; renderHints(); return h;
}

/* ---------------- editor ---------------- */
const edEl = $('#editor'), edText = $('#edText'), edStatus = $('#edStatus');
function edMsg(msg, bad) { edStatus.textContent = msg ? `[ ${msg} ]` : ''; edStatus.className = 'ed-status' + (msg ? ' show' : '') + (bad ? ' bad' : ''); }
function openEditor(ed) {
  editor = ed; edDirty = false; edExitArmed = false;
  $('#edName').textContent = ed.title + (ed.ro ? '  (read-only)' : '');
  edText.value = ed.content; edEl.hidden = false; input.disabled = true;
  edMsg(ed.ro ? `File '${ed.title}' is unwritable. Saving will fail; exit and use sudo nano` : `Read ${lines(ed.content).length} lines`, ed.ro);
  setTimeout(() => { edText.focus(); edText.setSelectionRange(0, 0); edText.scrollTop = 0; });
}
function saveEditor() {
  if (!editor) return;
  let content = edText.value; if (content && !content.endsWith('\n')) content += '\n';
  if (editor.cron) {
    const p = parseCron(content);
    if (p.errs.length) { S.cron.draft = content; edMsg('errors in crontab file, can\'t install: ' + p.errs[0].replace('"-":', 'line '), true); print('crontab: installing new crontab'); print(p.errs.map(e => e.replace('"-"', '"/tmp/crontab.Kx3bQe/crontab"')).join('\n') + '\nerrors in crontab file, can\'t install.', 'err'); return; }
    S.cron.text = content; S.cron.draft = null; edDirty = false;
    edMsg(`Wrote ${lines(content).length} lines — crontab: installing new crontab`);
    print('crontab: installing new crontab');
    S.events = [{ name:'__cron', args:[], code:0, out:'', err:'', meta:{} }]; evaluate(S.events); return;
  }
  const prev = S.root; S.root = editor.asRoot;
  const w = writeFile(S, editor.path, content, false, 'nano'); S.root = prev;
  if (w.err) { edMsg(`Error writing ${editor.title}: Permission denied`, true); return; }
  edDirty = false; editor.content = content;
  edMsg(`Wrote ${lines(content).length} lines`);
  S.events = [{ name:'__save', args:[w.abs], code:0, out:'', err:'', meta:{ path:w.abs } }];
  afterCommands('');
}
function closeEditor(force) {
  if (!editor) return;
  if (edDirty && !force && !edExitArmed) { edExitArmed = true; edMsg('Modified buffer not saved. Press Save, or Exit again to discard changes', true); return; }
  if (editor.cron && edDirty) S.cron.draft = edText.value;
  if (editor.ro && editor.title) { const n = getNode(S, editor.path); if (n && edDirty) print(`coach › ${editor.title} is owned by root, so your edits were not saved. Open it with: sudo nano ${editor.title}`, 'coach'); }
  editor = null; edEl.hidden = true; input.disabled = false; input.focus(); scrollEnd();
}
edText.addEventListener('input', () => { edDirty = true; edExitArmed = false; });
edText.addEventListener('keydown', e => {
  const k = e.key.toLowerCase();
  if ((e.ctrlKey || e.metaKey) && (k === 's' || k === 'o')) { e.preventDefault(); saveEditor(); }
  else if ((e.ctrlKey || e.metaKey) && k === 'x') { e.preventDefault(); closeEditor(); }
  else if (k === 'escape') { e.preventDefault(); closeEditor(); }
  else if (k === 'tab') { e.preventDefault(); const s = edText.selectionStart; edText.setRangeText('  ', s, edText.selectionEnd, 'end'); edDirty = true; }
});
$('#edSave').addEventListener('click', saveEditor);
$('#edClose').addEventListener('click', () => closeEditor());

/* ---------------- input: history, tab completion, shortcuts ---------------- */
$('#cmdForm').addEventListener('submit', e => { e.preventDefault(); const v = input.value; input.value = ''; runInput(v); scrollEnd(); });
input.addEventListener('keydown', e => {
  if (e.key === 'ArrowUp') { e.preventDefault(); if (hIdx > 0) { hIdx--; input.value = cmdHistory[hIdx]; requestAnimationFrame(() => input.setSelectionRange(input.value.length, input.value.length)); } }
  else if (e.key === 'ArrowDown') { e.preventDefault(); if (hIdx < cmdHistory.length - 1) { hIdx++; input.value = cmdHistory[hIdx]; } else { hIdx = cmdHistory.length; input.value = ''; } }
  else if (e.key === 'Tab') { e.preventDefault(); complete(); }
  else if (e.ctrlKey && e.key.toLowerCase() === 'l') { e.preventDefault(); linesEl.innerHTML = ''; }
  else if (e.ctrlKey && e.key.toLowerCase() === 'c' && !window.getSelection().toString()) { e.preventDefault(); echoCmd(input.value + '^C'); input.value = ''; scrollEnd(); }
});
function complete() {
  const v = input.value.slice(0, input.selectionStart); const after = input.value.slice(input.selectionStart);
  const m = /(\S*)$/.exec(v); const word = m[1]; const before = v.slice(0, v.length - word.length);
  const isCmd = !before.trim() || /(\||&&|;|sudo)\s*$/.test(before);
  let opts_ = [];
  if (isCmd && !word.includes('/')) opts_ = Object.keys(CMD).filter(c => c.startsWith(word) && c !== '.').sort();
  else {
    const i = word.lastIndexOf('/'); const dir = i >= 0 ? word.slice(0, i + 1) : ''; const base = word.slice(i + 1);
    const n = getNode(S, norm(S, dir || '.'));
    if (n && n.type === 'dir') opts_ = Object.keys(n.children).filter(k => k.startsWith(base) && (base.startsWith('.') || !k.startsWith('.'))).sort().map(k => dir + k + (n.children[k].type === 'dir' ? '/' : ''));
  }
  if (!opts_.length) return;
  let pre = opts_[0]; for (const o of opts_) while (!o.startsWith(pre)) pre = pre.slice(0, -1);
  if (opts_.length === 1) { const one = opts_[0]; input.value = before + one + (one.endsWith('/') ? '' : ' ') + after; }
  else if (pre.length > word.length) input.value = before + pre + after;
  else { echoCmd(input.value); print(opts_.map(o => o.replace(/^.*\/(?=.)/, '')).join('  ')); scrollEnd(); return; }
  const pos = input.value.length - after.length; input.setSelectionRange(pos, pos);
}
outEl.addEventListener('mouseup', () => { if (!window.getSelection().toString() && !input.disabled) input.focus({ preventScroll:true }); });

/* ---------------- rendering ---------------- */
function rankFor(xp) { let r = RANKS[0], next = null; for (let i = 0; i < RANKS.length; i++) if (xp >= RANKS[i][0]) { r = RANKS[i]; next = RANKS[i + 1] || null; } return { r, next }; }
function renderHeader() {
  const xp = totalXP(); const { r, next } = rankFor(xp);
  $('#rankName').textContent = r[1]; $('#xpText').textContent = `${xp} XP`;
  const pct = next ? (xp - r[0]) / (next[0] - r[0]) * 100 : 100;
  $('#xpFill').style.width = Math.min(100, pct) + '%';
  $('#xpbarWrap').setAttribute('aria-valuenow', Math.round(pct)); $('#xpbarWrap').setAttribute('aria-valuemin', '0'); $('#xpbarWrap').setAttribute('aria-valuemax', '100');
  $('#rankNext').textContent = next ? `${next[0] - xp} XP to ${next[1]}` : 'Top rank reached';
}
function renderQueue() {
  const q = $('#queue'); const parts = ['<h2>Ticket queue</h2>'];
  for (const t of ['net', 'sec', 'ops']) {
    const labs = LABS.filter(l => l.track === t); const done = labs.filter(l => progress.labs[l.id]?.done).length;
    parts.push(`<div class="track" data-t="${t}"><div class="track-head"><b>${TRACKS[t].name}</b><span>${done}/${labs.length}</span></div>`);
    for (const l of labs) {
      const d = progress.labs[l.id]?.done; const cur = LAB && LAB.id === l.id;
      parts.push(`<button class="tk${d ? ' done' : ''}${cur && !d ? ' active' : ''}" data-id="${l.id}" ${cur ? 'aria-current="true"' : ''}><span class="code">${l.code}</span><span class="t">${esc(l.title)}</span><span class="st" aria-label="${d ? 'resolved' : cur ? 'in progress' : 'open'}">${d ? '✓' : ''}</span></button>`);
    }
    parts.push('</div>');
  }
  parts.push(`<p class="queue-foot">Progress is saved in this browser. <button id="wipe" type="button">Reset all progress</button></p>`);
  q.innerHTML = parts.join('');
  q.querySelectorAll('.tk').forEach(b => b.addEventListener('click', () => { loadLab(b.dataset.id); document.body.classList.remove('qopen'); $('#queueBtn').setAttribute('aria-expanded', 'false'); }));
  $('#wipe').addEventListener('click', e => {
    const b = e.currentTarget;
    if (b.dataset.armed) { progress = { labs:{}, current:LAB.id }; saveProgress(); renderAll(); return; }
    b.dataset.armed = '1'; b.textContent = 'Click again to erase all XP and progress';
    setTimeout(() => { if (document.body.contains(b)) { delete b.dataset.armed; b.textContent = 'Reset all progress'; } }, 4000);
  });
}
function objectivesHTML() {
  const firstOpen = LAB.objectives.findIndex((_, i) => !S.done.has(i));
  return LAB.objectives.map((o, i) => `<li class="${S.done.has(i) ? 'done' : ''}${i === firstOpen ? ' next' : ''}"><span class="box" aria-hidden="true">${S.done.has(i) ? '✓' : ''}</span><span class="txt">${fmt(o.text)}</span></li>`).join('');
}
function renderObjectives() {
  const ol = document.getElementById('objList'); if (!ol) return;
  ol.innerHTML = objectivesHTML(); document.getElementById('objCount').textContent = `${S.done.size}/${LAB.objectives.length}`;
}
function renderHints() {
  const box = document.getElementById('hintList'); if (!box) return;
  box.innerHTML = LAB.hints.slice(0, S.hintsShown).map((h, i) => `<div class="hint"><b>HINT ${i + 1}</b>${fmt(h)}</div>`).join('');
  const b = document.getElementById('hintReveal');
  if (S.hintsShown >= LAB.hints.length) b.hidden = true; else { b.hidden = false; b.textContent = `Reveal hint ${S.hintsShown + 1} of ${LAB.hints.length}`; }
}
function quizHTML() {
  const lp = labProg(LAB.id);
  return LAB.quiz.map((q, qi) => {
    const ans = lp.quiz[qi]; const answered = ans !== undefined; const chosen = lp.quizPick?.[qi];
    return `<div class="q"><p>${qi + 1}. ${fmt(q.q)}</p><div class="opts">${q.o.map((o, oi) => `<button type="button" data-q="${qi}" data-o="${oi}" ${answered ? 'disabled' : ''} class="${answered && oi === q.a ? 'right' : ''}${answered && oi === chosen && oi !== q.a ? 'wrong' : ''}">${fmt(o)}</button>`).join('')}</div>${answered ? `<p class="why">${ans ? `✓ Correct, +${QUIZ_XP} XP. ` : '✗ Not quite. '}${fmt(q.why)}</p>` : ''}</div>`;
  }).join('');
}
function renderBrief() {
  const lp = progress.labs[LAB.id]; const solved = S.completed || lp?.done;
  const idx = LABS.indexOf(LAB); const next = LABS.slice(idx + 1).concat(LABS.slice(0, idx)).find(l => !progress.labs[l.id]?.done);
  const resolved = solved ? `<section class="resolved" id="resolved">
      <h3>${S.completed ? 'Ticket resolved' : 'Resolved earlier'}</h3>
      <div class="xpline">${LAB.code} · ${lp?.xp || 0} XP earned${S.completed && S.hintsShown ? ` · ${S.hintsShown} hint${S.hintsShown > 1 ? 's' : ''} used` : ''}${!S.completed ? ' · replay it in the terminal any time' : ''}</div>
      <div class="prose">${LAB.debrief}</div>
      <div class="sec-h"><h3>Check yourself</h3><span>+${QUIZ_XP} XP each</span></div>
      <div class="quiz" id="quiz">${quizHTML()}</div>
      ${next ? `<div><button class="btn primary" type="button" id="nextBtn">Next ticket: ${next.code} ${esc(next.title)} →</button></div>` : '<p>Every ticket in the queue is resolved. Shift complete.</p>'}
    </section>` : '';
  $('#briefIn').innerHTML = `
    <div>
      <div class="tk-meta"><span class="chip ${LAB.track}">${LAB.code}</span><span>${TRACKS[LAB.track].name}</span><span>· host ${LAB.host}</span><span>· ${LAB.xp} XP</span></div>
      <h1>${esc(LAB.title)}</h1>
    </div>
    <div class="req"><div class="from">${esc(LAB.from)}</div><p>${esc(LAB.ticket)}</p></div>
    ${resolved}
    <section aria-labelledby="objH"><div class="sec-h"><h3 id="objH">Objectives</h3><span id="objCount">${S.done.size}/${LAB.objectives.length}</span></div>
      <ol class="obj" id="objList">${objectivesHTML()}</ol>
      ${LAB.objectives.some(o => o.answer) ? '<p class="submit-note">Answer questions in the terminal: <code>submit &lt;answer&gt;</code>. Type <code>tasks</code> to list objectives there.</p>' : ''}
    </section>
    <section><div class="sec-h"><h3>The concept</h3></div><div class="prose">${LAB.concept}</div></section>
    <pre class="diagram" aria-label="Diagram">${esc(LAB.diagram)}</pre>
    <section><div class="sec-h"><h3>Your tools</h3><span>man &lt;cmd&gt; explains any of them</span></div>
      <div class="tbl-wrap"><table class="cmds"><tbody>${LAB.cmds.map(([c, d]) => `<tr><td>${esc(c)}</td><td>${esc(d)}</td></tr>`).join('')}</tbody></table></div></section>
    <section><div class="sec-h"><h3>Stuck?</h3><span>−${HINT_COST} XP per hint</span></div>
      <div class="hints" id="hintList"></div>
      <div style="margin-top:8px"><button class="btn" type="button" id="hintReveal">Reveal hint 1 of ${LAB.hints.length}</button></div></section>`;
  renderHints();
  $('#hintReveal').addEventListener('click', () => { const h = revealHint(); if (h) { print(`${C.y}hint ${S.hintsShown}/${LAB.hints.length} ›${C.x} ${plain(h)}`); scrollEnd(); } });
  const nb = document.getElementById('nextBtn'); if (nb) nb.addEventListener('click', () => loadLab(next.id));
  const qz = document.getElementById('quiz');
  if (qz) qz.addEventListener('click', e => {
    const b = e.target.closest('button[data-q]'); if (!b || b.disabled) return;
    const qi = +b.dataset.q, oi = +b.dataset.o; const lp2 = labProg(LAB.id);
    if (lp2.quiz[qi] !== undefined) return;
    lp2.quiz[qi] = oi === LAB.quiz[qi].a; (lp2.quizPick ||= {})[qi] = oi; saveProgress();
    qz.innerHTML = quizHTML(); renderHeader();
  });
}
function renderAll() { renderHeader(); renderQueue(); renderBrief(); }

/* ---------------- lab lifecycle ---------------- */
function loadLab(id, opts = {}) {
  const lab = LABS.find(l => l.id === id) || LABS[0];
  LAB = lab; S = createSandbox(lab);
  progress.current = lab.id; saveProgress();
  linesEl.innerHTML = '';
  print(`Welcome to ${lab.host} (Ubuntu 24.04.1 LTS, GNU/Linux 6.8.0-48-generic x86_64)`, 'sys');
  print(`${C.d} * Halcyon Freight night shift · ${dateStr()}${C.x}`, 'sys');
  print(`${C.d} * Ticket ${C.x}${C.y}${lab.code}${C.x}${C.d} is assigned to you. The briefing explains the concept and lists the objectives.${C.x}`, 'sys');
  print(`${C.d} * ${C.x}help${C.d} commands · ${C.x}man <cmd>${C.d} explains one · ${C.x}tasks${C.d} objectives · ${C.x}hint${C.d} when stuck · ${C.x}submit <answer>${C.d} answers${C.x}`, 'sys');
  print('');
  if (opts.reset) print(`${C.y}Lab reset: fresh machine, objectives cleared.${C.x}`);
  renderPrompt(); renderAll();
  $('#brief').scrollTop = 0; window.scrollTo && opts.scrollTop && window.scrollTo(0, 0);
  input.disabled = false; if (!opts.noFocus) input.focus({ preventScroll:true });
}
$('#resetBtn').addEventListener('click', () => loadLab(LAB.id, { reset:true }));
$('#hintBtn').addEventListener('click', () => { const h = revealHint(); print(h ? `${C.y}hint ${S.hintsShown}/${LAB.hints.length} ›${C.x} ${plain(h)}` : 'No more hints for this ticket.'); scrollEnd(); input.focus(); });
$('#queueBtn').addEventListener('click', () => { const open = document.body.classList.toggle('qopen'); $('#queueBtn').setAttribute('aria-expanded', String(open)); });
$('#scrim').addEventListener('click', () => { document.body.classList.remove('qopen'); $('#queueBtn').setAttribute('aria-expanded', 'false'); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && document.body.classList.contains('qopen')) document.body.classList.remove('qopen'); });
setInterval(() => { $('#clock').textContent = shiftTime(); }, 10000);
$('#clock').textContent = shiftTime();

loadLab(progress.current || LABS[0].id, { noFocus:true });
