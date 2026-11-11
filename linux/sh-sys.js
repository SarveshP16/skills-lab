/* sudo learn — kc-web-01 as a running server (Linux Module 2). Processes and job control, systemd services and
   the journal, apt/dpkg, disks, cron and systemd timers, tar/gzip/zip. Networking and SSH live in sh-net.js.
   Everything is state on the sys object, rebuilt from scratch on every replay, so it must stay deterministic. */
(function (root) {
  "use strict";
  var S = root.ShEngine, U = S.util, CMDS = S.CMDS, B = S.BUILTINS, NOW = S.NOW, DAY = S.DAY, ShError = S.ShError, ERR = S.ERRTEXT;
  var opts = U.opts, out = U.out, errl = U.errl, note = U.note, lines = U.lines, joinLines = U.joinLines, pad = U.pad, rpad = U.rpad, human = U.human, MON = U.MON, WDAY = U.WDAY, bytes = U.bytes;
  var HOUR = 3600000, MIN = 60000;
  var BOOT = NOW - (12 * DAY + 3 * HOUR + 14 * MIN);
  var MEM_KB = 4045632;
  var M2 = S.M2 = {};

  /* ================================================================== small helpers */
  function hash(str, seed) {
    var h1 = 0xdeadbeef ^ (seed || 0), h2 = 0x41c6ce57 ^ (seed || 0);
    for (var i = 0; i < str.length; i++) { var ch = str.charCodeAt(i); h1 = Math.imul(h1 ^ ch, 2654435761); h2 = Math.imul(h2 ^ ch, 1597334677); }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return 4294967296 * (2097151 & h2) + (h1 >>> 0);
  }
  var B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  function hashChars(str, n, alpha) { alpha = alpha || B64; var s = ""; for (var i = 0; s.length < n; i++) { var h = hash(str, i); for (var k = 0; k < 6 && s.length < n; k++) { s += alpha.charAt(h % alpha.length); h = Math.floor(h / alpha.length); } } return s; }
  function hexOf(str, n) { return hashChars(str, n, "0123456789abcdef"); }
  M2.hash = hash; M2.hashChars = hashChars; M2.hexOf = hexOf;
  function rootView(sys) { return { sys: sys, uid: 0, gid: 0, groups: [], cwd: "/", umask: 18, vars: {}, user: "root", home: "/root" }; }
  function nodeAt(sys, p, nofollow) { var r = S.lookup(rootView(sys), p, { nofollow: !!nofollow }); return r.node || null; }
  function rd(sys, p) { var n = nodeAt(sys, p); return n && n.type === "f" ? n.content : null; }
  function putRoot(sys, p, content, mode, uid, gid, mtime) { return S.put(sys, p, content, mode == null ? 420 : mode, uid || 0, gid || 0, mtime || sys.now); }
  function writeRoot(sys, p, content, append) {
    var n = nodeAt(sys, p);
    if (n && n.type === "f") { n.content = append ? n.content + content : content; if (!append) delete n.size; n.mtime = sys.now; return n; }
    return putRoot(sys, p, content, 420, 0, 0);
  }
  function mkdirRoot(sys, p, mode, uid, gid) { var d = S.mkdirs(sys, p); if (mode != null) d.mode = mode; if (uid != null) d.uid = uid; if (gid != null) d.gid = gid; return d; }
  function rmRoot(sys, p) { var i = p.lastIndexOf("/"); var parent = nodeAt(sys, p.slice(0, i) || "/"); if (parent && parent.type === "d") delete parent.children[p.slice(i + 1)]; }
  function basename(p) { return String(p).replace(/\/+$/, "").split("/").pop(); }
  function d2(n) { return pad(n, 2, "0"); }
  function tod(ms) { var d = new Date(ms); return d2(d.getUTCHours()) + ":" + d2(d.getUTCMinutes()) + ":" + d2(d.getUTCSeconds()); }
  function ymd(ms) { var d = new Date(ms); return d.getUTCFullYear() + "-" + d2(d.getUTCMonth() + 1) + "-" + d2(d.getUTCDate()); }
  function jdate(ms) { var d = new Date(ms); return MON[d.getUTCMonth()] + " " + d2(d.getUTCDate()) + " " + tod(ms); }
  function sdate(ms) { var d = new Date(ms); return WDAY[d.getUTCDay()] + " " + ymd(ms) + " " + tod(ms) + " UTC"; }
  function span(ms) {
    var s = Math.floor(Math.abs(ms) / 1000);
    var units = [["month", "months", 2629800], ["week", "weeks", 604800], ["day", "days", 86400], ["h", "h", 3600], ["min", "min", 60], ["s", "s", 1]];
    var partsOut = [];
    for (var i = 0; i < units.length && partsOut.length < 2; i++) {
      var v = Math.floor(s / units[i][2]);
      if (v > 0) { s -= v * units[i][2]; partsOut.push(units[i][2] >= 86400 ? v + " " + (v === 1 ? units[i][0] : units[i][1]) : v + units[i][0]); }
      else if (partsOut.length) break;
    }
    return partsOut.length ? partsOut.join(" ") : "0s";
  }
  function spanWords(secs) { if (secs >= 3600 * 24) return Math.round(secs / 86400) + " day" + (secs >= 172800 ? "s" : ""); if (secs >= 3600) { var h = Math.round(secs / 360) / 10; return h + " hour" + (h === 1 ? "" : "s"); } var m = Math.round(secs / 60); return m + " minute" + (m === 1 ? "" : "s"); }
  function commaNum(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ","); }
  function needRoot(sess) { return sess.uid !== 0; }
  M2.span = span; M2.sdate = sdate; M2.jdate = jdate; M2.ymd = ymd; M2.tod = tod; M2.rootView = rootView; M2.nodeAt = nodeAt; M2.rd = rd; M2.putRoot = putRoot; M2.writeRoot = writeRoot; M2.mkdirRoot = mkdirRoot; M2.rmRoot = rmRoot; M2.basename = basename; M2.commaNum = commaNum;

  /* ================================================================== the journal */
  function jadd(sys, ident, pid, msg, unit, prio, t) { sys.journal.push({ t: t == null ? sys.now : t, ident: ident, pid: pid, msg: msg, unit: unit || null, prio: prio == null ? 6 : prio }); }
  function jline(sys, e, fmt) {
    if (fmt === "cat") return e.msg;
    var who = e.ident + (e.pid != null ? "[" + e.pid + "]" : "") + ": ";
    if (fmt === "short-iso") return ymd(e.t) + "T" + tod(e.t) + "+00:00 " + sys.host + " " + who + e.msg;
    return jdate(e.t) + " " + sys.host + " " + who + e.msg;
  }
  M2.jadd = jadd; M2.jline = jline;
  function journalSorted(sys) { return sys.journal.slice().sort(function (a, b) { return a.t - b.t; }); }

  /* ================================================================== processes */
  function commOf(cmd) {
    var c = String(cmd);
    var m = /^\[([^\]]+)\]$/.exec(c); if (m) return m[1].slice(0, 15);
    m = /^([\w.-]+):\s/.exec(c); if (m) return m[1];
    var w = c.split(/\s+/)[0].replace(/^-/, "");
    return basename(w).slice(0, 15);
  }
  function spawn(sys, o) {
    var p = Object.assign({ ppid: 1, uid: 0, tty: "?", stat: "S", start: sys.now, cpu: 0, cpuSecs: 0, listen: [], files: [] }, o);
    if (p.pid == null) p.pid = sys.nextPid++;
    if (!p.comm) p.comm = commOf(p.cmd);
    if (!p.vsz) p.vsz = p.kernel ? 0 : 6000 + (hash(p.cmd) % 18000);
    if (p.rss == null) p.rss = p.kernel ? 0 : Math.round(p.vsz * (0.25 + (hash(p.cmd, 3) % 30) / 100));
    sys.procs.push(p);
    return p;
  }
  function procByPid(sys, pid) { for (var i = 0; i < sys.procs.length; i++) if (sys.procs[i].pid === pid) return sys.procs[i]; return null; }
  function childrenOf(sys, pid) { return sys.procs.filter(function (p) { return p.ppid === pid; }); }
  function removeProc(sys, p) {
    childrenOf(sys, p.pid).forEach(function (c) { removeProc(sys, c); });
    var i = sys.procs.indexOf(p);
    if (i >= 0) sys.procs.splice(i, 1);
  }
  M2.spawn = spawn; M2.procByPid = procByPid; M2.removeProc = removeProc;
  var SIGS = { HUP: 1, INT: 2, QUIT: 3, ILL: 4, TRAP: 5, ABRT: 6, BUS: 7, FPE: 8, KILL: 9, USR1: 10, SEGV: 11, USR2: 12, PIPE: 13, ALRM: 14, TERM: 15, STKFLT: 16, CHLD: 17, CONT: 18, STOP: 19, TSTP: 20, TTIN: 21, TTOU: 22, URG: 23, XCPU: 24, XFSZ: 25, VTALRM: 26, PROF: 27, WINCH: 28, IO: 29, PWR: 30, SYS: 31 };
  function sigNum(s) { s = String(s).toUpperCase().replace(/^SIG/, ""); if (/^\d+$/.test(s)) return +s <= 64 ? +s : null; return SIGS[s] != null ? SIGS[s] : null; }
  function sigName(n) { for (var k in SIGS) if (SIGS[k] === n) return k; return String(n); }
  M2.sigNum = sigNum; M2.sigName = sigName;
  function memPct(p) { return p.rss / MEM_KB * 100; }
  function cpuTimeBsd(p) { var s = Math.floor(p.cpuSecs || 0); return Math.floor(s / 60) + ":" + d2(s % 60); }
  function cpuTimeUnix(p) { var s = Math.floor(p.cpuSecs || 0); return d2(Math.floor(s / 3600)) + ":" + d2(Math.floor(s / 60) % 60) + ":" + d2(s % 60); }
  function startStr(p, sys) { var d = new Date(p.start); return sys.now - p.start < DAY && new Date(sys.now).getUTCDate() === d.getUTCDate() ? d2(d.getUTCHours()) + ":" + d2(d.getUTCMinutes()) : MON[d.getUTCMonth()] + d2(d.getUTCDate()); }
  function etime(p, sys) { var s = Math.floor((sys.now - p.start) / 1000), dd = Math.floor(s / 86400), hh = Math.floor(s / 3600) % 24, mm = Math.floor(s / 60) % 60, ss = s % 60; return (dd ? dd + "-" : "") + (dd || hh ? d2(hh) + ":" : "") + d2(mm) + ":" + d2(ss); }
  function userCol(sys, uid) { var n = S.uname(sys, uid); return n.length > 8 ? n.slice(0, 7) + "+" : n; }

  // signal delivery. sender: a session. Returns null, "EPERM" or "ESRCH".
  function deliver(sys, p, sig, sender) {
    if (!p) return "ESRCH";
    if (sender && sender.uid !== 0 && sender.uid !== p.uid) return "EPERM";
    if (sig === 0 || p.pid === 1 || p.kernel) return null;
    sys.sigLog = (sys.sigLog || []).concat([{ pid: p.pid, sig: sig, uid: sender ? sender.uid : 0, cmd: p.cmd, line: sys.lineNo || 0 }]);
    if (sig === 19 || sig === 20 || sig === 21 || sig === 22) { p.stopped = true; p.stat = "T"; jobUpdate(sys, p, "Stopped"); return null; }
    if (sig === 18) { if (p.stopped) { p.stopped = false; p.stat = "S"; jobUpdate(sys, p, "Running"); } return null; }
    if (sig === 17 || sig === 23 || sig === 28) return null;
    if (sig === 1 && p.onHup) { p.onHup(sys, p); return null; }
    if (sig === 1 && p.nohup) return null;
    if (sig !== 9 && p.ignore && p.ignore.indexOf(sig) >= 0) { if (p.onIgnored) p.onIgnored(sys, p, sig); return null; }
    if (sig === 10 && p.onUsr1) { p.onUsr1(sys, p); return null; }
    terminate(sys, p, sig);
    return null;
  }
  function terminate(sys, p, sig) {
    removeProc(sys, p);
    if (p.job) jobUpdate(sys, p, sig === 9 ? "Killed" : sig === 2 ? "Interrupt" : sig === 1 ? "Hangup" : sig === 3 ? "Quit" : "Terminated");
    if (p.unit) {
      var u = sys.units[p.unit];
      if (u && p.main) unitMainDied(sys, u, p, sig);
      else if (u && u.rt.active === "active" && p.respawn) spawn(sys, Object.assign({}, p, { pid: null, start: sys.now, cpuSecs: 0, stopped: false, stat: p.baseStat || "S" }));
    }
  }
  M2.deliver = deliver; M2.terminate = terminate;

  /* ---------------- ps */
  var PSCOLS = {
    pid: ["PID", 7, function (p) { return p.pid; }], ppid: ["PPID", 7, function (p) { return p.ppid; }],
    user: ["USER", -8, function (p, sys) { return userCol(sys, p.uid); }], euser: ["EUSER", -8, function (p, sys) { return userCol(sys, p.uid); }], uid: ["UID", 5, function (p) { return p.uid; }],
    "%cpu": ["%CPU", 4, function (p) { return p.cpu.toFixed(1); }], pcpu: ["%CPU", 4, function (p) { return p.cpu.toFixed(1); }],
    "%mem": ["%MEM", 4, function (p) { return memPct(p).toFixed(1); }], pmem: ["%MEM", 4, function (p) { return memPct(p).toFixed(1); }],
    vsz: ["VSZ", 6, function (p) { return p.vsz; }], rss: ["RSS", 5, function (p) { return p.rss; }], rssize: ["RSS", 5, function (p) { return p.rss; }],
    tty: ["TT", -8, function (p) { return p.tty; }], stat: ["STAT", -4, function (p) { return p.stat; }], s: ["S", 1, function (p) { return p.stat.charAt(0); }],
    start: ["STARTED", 8, function (p, sys) { return tod(p.start); }], start_time: ["START", 5, startStr], stime: ["STIME", -5, startStr], lstart: ["STARTED", -24, function (p) { var d = new Date(p.start); return WDAY[d.getUTCDay()] + " " + MON[d.getUTCMonth()] + " " + pad(d.getUTCDate(), 2) + " " + tod(p.start) + " " + d.getUTCFullYear(); }],
    time: ["TIME", 8, cpuTimeUnix], cputime: ["TIME", 8, cpuTimeUnix], etime: ["ELAPSED", 11, etime], etimes: ["ELAPSED", 7, function (p, sys) { return Math.floor((sys.now - p.start) / 1000); }],
    ni: ["NI", 3, function () { return 0; }], nice: ["NI", 3, function () { return 0; }],
    comm: ["COMMAND", -15, function (p) { return p.comm; }], ucomm: ["COMMAND", -15, function (p) { return p.comm; }],
    cmd: ["CMD", 0, function (p) { return p.cmd; }], args: ["COMMAND", 0, function (p) { return p.cmd; }], command: ["COMMAND", 0, function (p) { return p.cmd; }]
  };
  function psCell(col, v, last) { v = String(v); if (last) return v; var w = Math.abs(col[1]); if (!w) return v; return col[1] < 0 ? rpad(v, w) : pad(v, w); }
  function sortProcs(list, spec, sys) {
    if (!spec) return list;
    var keys = spec.split(",").filter(Boolean).map(function (k) { var dir = 1; if (k.charAt(0) === "-") { dir = -1; k = k.slice(1); } else if (k.charAt(0) === "+") k = k.slice(1); return { k: k, dir: dir }; });
    var val = { pid: function (p) { return p.pid; }, ppid: function (p) { return p.ppid; }, "%cpu": function (p) { return p.cpu; }, pcpu: function (p) { return p.cpu; }, "%mem": function (p) { return p.rss; }, pmem: function (p) { return p.rss; }, rss: function (p) { return p.rss; }, vsz: function (p) { return p.vsz; }, user: function (p) { return S.uname(sys, p.uid); }, uid: function (p) { return p.uid; }, comm: function (p) { return p.comm; }, cmd: function (p) { return p.cmd; }, args: function (p) { return p.cmd; }, start_time: function (p) { return p.start; }, etime: function (p) { return -p.start; }, time: function (p) { return p.cpuSecs; }, cputime: function (p) { return p.cpuSecs; } };
    keys.forEach(function (k) { if (!val[k.k]) throw new ShError("error: unknown sort specifier\n\nUsage:\n ps [options]\n\n Try 'ps --help <simple|list|output|threads|misc|all>'\n  or 'ps --help <s|l|o|t|m|a>'\n for additional help text.\n\nFor more details see ps(1).", 1); });
    return list.slice().sort(function (a, b) {
      for (var i = 0; i < keys.length; i++) { var x = val[keys[i].k](a), y = val[keys[i].k](b); if (x < y) return -keys[i].dir; if (x > y) return keys[i].dir; }
      return a.pid - b.pid;
    });
  }
  // The other commands of the pipeline ps runs in are processes too (ps aux | grep nginx shows the grep).
  function pipelineProcs(sess, selfArgs) {
    var sys = sess.sys, pl = sys.pipeline, res = [];
    if (!pl) return res;
    pl.cmds.forEach(function (c) {
      if (c.t !== "simple" || !c.words.length) return;
      var words = c.words.map(function (w) { return w.replace(/^'(.*)'$/, "$1").replace(/^"(.*)"$/, "$1"); });
      if (words[0] === selfArgs[0] && words.slice(1).join(" ") === selfArgs.slice(1).join(" ")) return;
      var al = pl.sess.aliases && pl.sess.aliases[words[0]];
      var cmd = (al ? al + " " + words.slice(1).join(" ") : words.join(" ")).trim();
      res.push({ pid: sys.nextPid++, ppid: sess.pid || 2400, uid: sess.uid, tty: "pts/0", stat: "S+", start: sys.now, cpu: 0, cpuSecs: 0, cmd: cmd, comm: commOf(cmd), vsz: 6480 + (hash(cmd) % 3000), rss: 2100 + (hash(cmd, 2) % 900) });
    });
    return res;
  }
  CMDS.ps = function (args, io, sess) {
    var sys = sess.sys, a = args.slice(1), sel = {}, bsdU = false, full = false, sort = null, noHead = false, forest = false, bsd = false, custom = null, longF = false;
    function sysvErr() { throw new ShError("error: unsupported SysV option\n\nUsage:\n ps [options]\n\n Try 'ps --help <simple|list|output|threads|misc|all>'\n  or 'ps --help <s|l|o|t|m|a>'\n for additional help text.\n\nFor more details see ps(1).", 1); }
    for (var i = 0; i < a.length; i++) {
      var x = a[i];
      if (/^--sort=/.test(x)) { sort = x.slice(7); continue; }
      if (x === "--sort" || x === "k" || x === "-k" || x === "--sort=") { sort = a[++i]; continue; }
      if (/^k./.test(x) && !bsd) { sort = x.slice(1); continue; }
      if (x === "--no-headers" || x === "--no-heading" || x === "h") { noHead = true; continue; }
      if (x === "--forest") { forest = true; continue; }
      if (/^--(format|o)=/.test(x)) { custom = x.replace(/^--\w+=/, ""); continue; }
      if (x === "-o" || x === "o" || x === "--format" || x === "-O") { custom = (custom ? custom + "," : "") + (a[++i] || ""); continue; }
      if (/^-o./.test(x)) { custom = x.slice(2); continue; }
      if (x === "-p" || x === "p" || x === "--pid" || x === "q" || x === "-q") { sel.pids = (sel.pids || []).concat(String(a[++i] || "").split(/[ ,]/).filter(Boolean).map(Number)); continue; }
      if (/^-p\d/.test(x)) { sel.pids = (sel.pids || []).concat(x.slice(2).split(",").map(Number)); continue; }
      if (/^--pid=/.test(x)) { sel.pids = (sel.pids || []).concat(x.slice(6).split(",").map(Number)); continue; }
      if (x === "-u" || x === "-U" || x === "--user" || x === "U" || x === "-G" || x === "--group") { sel.users = String(a[++i] || "").split(","); continue; }
      if (/^-u./.test(x)) { sel.users = x.slice(2).split(","); continue; }
      if (/^--user=/.test(x)) { sel.users = x.slice(7).split(","); continue; }
      if (x === "-C") { sel.cmds = String(a[++i] || "").split(","); continue; }
      if (x === "--ppid") { sel.ppids = String(a[++i] || "").split(",").map(Number); continue; }
      if (x === "--help") { out(io, "\nUsage:\n ps [options]\n\nBasic options:\n -A, -e               all processes\n -a                   all with tty, except session leaders\n  a                   all with tty, including other users\n  x                   processes without controlling ttys\n\nSelection by list:\n -C <command>         command name\n -p, p, --pid <PID>   process id\n -u, U, --user <UID>  effective user id or name\n\nOutput formats:\n -f                   full-format, including command lines\n  u                   user-oriented format\n -o, o, --format <format>\n                      user-defined format\n --sort <spec>        sort by, e.g. -%cpu or +pid\n --forest             ascii art process tree\n"); return 0; }
      if (x === "-aux" || x === "-ax") { bsd = true; sel.bsdA = true; sel.bsdX = true; if (x === "-aux") bsdU = true; continue; }
      if (x.charAt(0) === "-") {
        x.slice(1).split("").forEach(function (c) {
          if (c === "e" || c === "A") sel.all = true; else if (c === "f") full = true; else if (c === "F") { full = true; longF = true; } else if (c === "l") full = true;
          else if (c === "a") sel.dashA = true; else if (c === "x") sel.bsdX = true; else if (c === "H") forest = true; else if (c === "w" || c === "y" || c === "c" || c === "j") return;
          else sysvErr();
        });
        continue;
      }
      if (/^[auxwfehrcSmvjlT]+$/.test(x)) { bsd = true; x.split("").forEach(function (c) { if (c === "a") sel.bsdA = true; else if (c === "x") sel.bsdX = true; else if (c === "u") bsdU = true; else if (c === "f") forest = true; else if (c === "r") sel.running = true; }); continue; }
      if (/^\d+$/.test(x)) { sel.pids = (sel.pids || []).concat([+x]); continue; }
      throw new ShError("error: garbage option\n\nUsage:\n ps [options]\n\n Try 'ps --help <simple|list|output|threads|misc|all>'\n  or 'ps --help <s|l|o|t|m|a>'\n for additional help text.\n\nFor more details see ps(1).", 1);
    }
    var self = { pid: sys.nextPid++, ppid: sess.pid || 2400, uid: sess.uid, tty: "pts/0", stat: "R+", start: sys.now, cpu: 0, cpuSecs: 0, cmd: args.join(" "), comm: "ps", vsz: 11320, rss: 4480 };
    var all = sys.procs.concat(pipelineProcs(sess, args)).concat([self]);
    var me = sess.uid, pick;
    if (sel.pids) pick = function (p) { return sel.pids.indexOf(p.pid) >= 0; };
    else if (sel.cmds) pick = function (p) { return sel.cmds.indexOf(p.comm) >= 0; };
    else if (sel.ppids) pick = function (p) { return sel.ppids.indexOf(p.ppid) >= 0; };
    else if (sel.users) pick = function (p) { var n = S.uname(sys, p.uid); return sel.users.indexOf(n) >= 0 || sel.users.indexOf(String(p.uid)) >= 0; };
    else if (sel.all || (sel.bsdA && sel.bsdX)) pick = function () { return true; };
    else if (sel.bsdA || sel.dashA) pick = function (p) { return p.tty !== "?"; };
    else if (sel.bsdX) pick = function (p) { return p.uid === me; };
    else pick = function (p) { return p.uid === me && p.tty === "pts/0"; };
    var list = all.filter(pick);
    if (sel.running) list = list.filter(function (p) { return p.stat.charAt(0) === "R"; });
    list = sort ? sortProcs(list, sort, sys) : list.sort(function (x, y) { return x.pid - y.pid; });
    var cols;
    if (custom) {
      cols = custom.split(/[,\s]+/).filter(Boolean).map(function (spec) {
        var m = /^([^=:]+)(?::(\d+))?(?:=(.*))?$/.exec(spec), key = m[1].toLowerCase(), base = PSCOLS[key];
        if (!base) throw new ShError("error: unknown user-defined format specifier \"" + m[1] + "\"\n\nUsage:\n ps [options]\n\n Try 'ps --help <simple|list|output|threads|misc|all>'\n  or 'ps --help <s|l|o|t|m|a>'\n for additional help text.\n\nFor more details see ps(1).", 1);
        var c = base.slice(); if (m[3] !== undefined) c[0] = m[3]; if (m[2]) c[1] = c[1] < 0 ? -m[2] : +m[2];
        return c;
      });
      if (cols.every(function (c) { return c[0] === ""; })) noHead = true;
    } else if (bsdU) cols = [PSCOLS.user, PSCOLS.pid, PSCOLS["%cpu"], PSCOLS["%mem"], PSCOLS.vsz, PSCOLS.rss, ["TTY", -8, PSCOLS.tty[2]], PSCOLS.stat, ["START", 5, startStr], ["TIME", 6, cpuTimeBsd], ["COMMAND", 0, PSCOLS.args[2]]];
    else if (full) cols = [["UID", -8, PSCOLS.user[2]], PSCOLS.pid, PSCOLS.ppid, ["C", 2, function (p) { return Math.round(p.cpu); }]].concat(longF ? [["SZ", 5, function (p) { return Math.round(p.vsz / 4); }], ["RSS", 5, PSCOLS.rss[2]], ["PSR", 3, function () { return 0; }]] : []).concat([PSCOLS.stime, ["TTY", -8, PSCOLS.tty[2]], PSCOLS.time, ["CMD", 0, PSCOLS.args[2]]]);
    else if (bsd) cols = [PSCOLS.pid, ["TTY", -8, PSCOLS.tty[2]], PSCOLS.stat, ["TIME", 6, cpuTimeBsd], ["COMMAND", 0, PSCOLS.args[2]]];
    else cols = [PSCOLS.pid, ["TTY", -8, PSCOLS.tty[2]], PSCOLS.time, ["CMD", 0, PSCOLS.comm[2]]];
    var depth = {};
    if (forest) {
      var ordered = [], seen = {};
      var byParent = {};
      list.forEach(function (p) { (byParent[p.ppid] = byParent[p.ppid] || []).push(p); });
      var inList = {}; list.forEach(function (p) { inList[p.pid] = true; });
      var walk = function (p, d) { if (seen[p.pid]) return; seen[p.pid] = true; depth[p.pid] = d; ordered.push(p); (byParent[p.pid] || []).forEach(function (c) { walk(c, d + 1); }); };
      list.forEach(function (p) { if (!inList[p.ppid]) walk(p, 0); });
      list = ordered;
    }
    var rows = [];
    if (!noHead) rows.push(cols.map(function (c, k) { return psCell(c, c[0], k === cols.length - 1); }).join(" "));
    list.forEach(function (p) {
      rows.push(cols.map(function (c, k) {
        var v = c[2](p, sys);
        if (forest && (c[0] === "COMMAND" || c[0] === "CMD") && depth[p.pid]) v = new Array(depth[p.pid]).join("    ") + " \\_ " + v;
        return psCell(c, v, k === cols.length - 1);
      }).join(" ").replace(/\s+$/, ""));
    });
    out(io, joinLines(rows));
    return list.length ? 0 : 1;
  };

  /* ---------------- top, htop, free, uptime, load */
  function loadAvg(sys) { var c = sys.procs.reduce(function (s, p) { return s + (p.stopped ? 0 : p.cpu); }, 0) / 100; return [c + 0.08, c * 0.93 + 0.12, c * 0.71 + 0.10].map(function (v) { return v.toFixed(2); }); }
  function memUsedKb(sys) { return 760000 + sys.procs.reduce(function (s, p) { return s + p.rss; }, 0); }
  function uptimeLine(sys) { return " " + tod(sys.now) + " up 12 days,  3:14,  1 user,  load average: " + loadAvg(sys).join(", "); }
  M2.loadAvg = loadAvg;
  CMDS.uptime = function (args, io, sess) { out(io, args[1] === "-p" ? "up 1 week, 5 days, 3 hours, 14 minutes\n" : args[1] === "-s" ? "2026-10-30 05:46:00\n" : uptimeLine(sess.sys) + "\n"); return 0; };
  CMDS.w = function (args, io, sess) { out(io, uptimeLine(sess.sys) + "\nUSER     TTY      FROM             LOGIN@   IDLE   JCPU   PCPU  WHAT\ndev      pts/0    198.51.100.20    08:52    0.00s  0.04s  0.00s w\n"); return 0; };
  function topText(sys, o) {
    var list = sys.procs.slice();
    var key = (o.sortKey || "%CPU").toUpperCase();
    list.sort(function (a, b) { var x = key === "%MEM" || key === "RES" ? b.rss - a.rss : key === "PID" ? a.pid - b.pid : key === "TIME+" ? b.cpuSecs - a.cpuSecs : b.cpu - a.cpu; return x || a.pid - b.pid; });
    if (o.user) list = list.filter(function (p) { return S.uname(sys, p.uid) === o.user || String(p.uid) === o.user; });
    if (o.pids) list = list.filter(function (p) { return o.pids.indexOf(p.pid) >= 0; });
    var running = sys.procs.filter(function (p) { return p.stat.charAt(0) === "R"; }).length + 1, stopped = sys.procs.filter(function (p) { return p.stopped; }).length;
    var cpuSum = sys.procs.reduce(function (s, p) { return s + (p.stopped ? 0 : p.cpu); }, 0) / 2;
    var us = Math.min(99.5, cpuSum + 0.4), sy = 0.6, idle = Math.max(0, 100 - us - sy - 0.2);
    var total = MEM_KB / 1024, used = memUsedKb(sys) / 1024, cache = 2250.4, free = Math.max(50, total - used - cache);
    var t = "top - " + tod(sys.now) + " up 12 days,  3:14,  1 user,  load average: " + loadAvg(sys).join(", ") + "\n" +
      "Tasks: " + pad(sys.procs.length + 1, 3) + " total, " + pad(running, 3) + " running, " + pad(sys.procs.length + 1 - running - stopped, 3) + " sleeping, " + pad(stopped, 3) + " stopped,   0 zombie\n" +
      "%Cpu(s): " + pad(us.toFixed(1), 4) + " us, " + pad(sy.toFixed(1), 4) + " sy,  0.0 ni, " + pad(idle.toFixed(1), 4) + " id,  0.2 wa,  0.0 hi,  0.0 si,  0.0 st\n" +
      "MiB Mem : " + pad(total.toFixed(1), 8) + " total, " + pad(free.toFixed(1), 8) + " free, " + pad(used.toFixed(1), 8) + " used, " + pad(cache.toFixed(1), 8) + " buff/cache\n" +
      "MiB Swap:      0.0 total,      0.0 free,      0.0 used. " + pad((total - used).toFixed(1), 8) + " avail Mem\n\n" +
      "    PID USER      PR  NI    VIRT    RES    SHR S  %CPU  %MEM     TIME+ COMMAND\n";
    var rows = (o.max ? list.slice(0, o.max) : list).map(function (p) {
      var cs = p.cpuSecs || 0, tplus = Math.floor(cs / 60) + ":" + d2(Math.floor(cs % 60)) + "." + d2(Math.floor((cs * 100) % 100));
      return pad(p.pid, 7) + " " + rpad(userCol(sys, p.uid), 8) + "  20   0 " + pad(p.vsz, 7) + " " + pad(p.rss, 6) + " " + pad(Math.round(p.rss / 3), 6) + " " + (p.stopped ? "T" : p.stat.charAt(0) === "R" ? "R" : p.stat.charAt(0) === "I" ? "I" : "S") + " " + pad(p.cpu.toFixed(1), 5) + " " + pad(memPct(p).toFixed(1), 5) + " " + pad(tplus, 9) + " " + (o.full ? p.cmd : p.comm);
    });
    return t + rows.join("\n") + "\n";
  }
  M2.topText = topText;
  CMDS.top = function (args, io, sess) {
    var a = args.slice(1), o = {}, batch = false;
    for (var i = 0; i < a.length; i++) {
      var x = a[i];
      if (x === "-b") batch = true; else if (x === "-n") i++; else if (/^-n\d/.test(x)) continue; else if (x === "-bn1" || x === "-b1") batch = true;
      else if (x === "-o") o.sortKey = a[++i]; else if (/^-o./.test(x)) o.sortKey = x.slice(2);
      else if (x === "-u" || x === "-U") o.user = a[++i]; else if (x === "-p") o.pids = String(a[++i]).split(",").map(Number); else if (x === "-c") o.full = true; else if (x === "-d") i++;
      else if (/^-[bc]+$/.test(x)) { if (x.indexOf("b") >= 0) batch = true; if (x.indexOf("c") >= 0) o.full = true; }
      else if (x === "-h" || x === "--help") { out(io, "Usage:\n  top -hv | -bcEeHiOSs1 -d secs -n max -u|U user -p pid(s) -o field -w [cols]\n"); return 0; }
      else { errl(io, "top: unknown option '" + x.replace(/^-/, "") + "'\nUsage:\n  top -hv | -bcEeHiOSs1 -d secs -n max -u|U user -p pid(s) -o field -w [cols]"); return 1; }
    }
    if (!batch) o.max = 14;
    out(io, topText(sess.sys, o));
    if (!batch) note(io, "(top keeps refreshing until you press q. The lab shows one snapshot. Inside top: P sorts by CPU, M by memory, k kills a process. For scripts and pipes use top -b -n 1.)");
    return 0;
  };
  CMDS.htop = function (args, io, sess) { out(io, topText(sess.sys, { max: 12, full: true })); note(io, "(htop is a friendlier, colourful top: arrow keys to pick a process, F9 to kill it, F6 to sort, q to quit. The lab shows a snapshot.)"); return 0; };
  CMDS.free = function (args, io, sess) {
    var h = args.indexOf("-h") >= 0, m = args.indexOf("-m") >= 0, g = args.indexOf("-g") >= 0;
    var total = MEM_KB, used = memUsedKb(sess.sys), cache = 2304132, shared = 1264, free = Math.max(51200, total - used - cache), avail = total - used;
    function f(k) { if (h) { if (k === 0) return "0B"; var v = k / 1024; return v >= 1024 ? (v / 1024).toFixed(1) + "Gi" : Math.round(v) + "Mi"; } return m ? Math.round(k / 1024) : g ? Math.round(k / 1048576) : k; }
    out(io, "               total        used        free      shared  buff/cache   available\nMem:    " + [total, used, free, shared, cache, avail].map(function (v) { return pad(f(v), 12); }).join("") + "\nSwap:   " + [0, 0, 0].map(function (v) { return pad(f(v), 12); }).join("") + "\n");
    return 0;
  };

  /* ---------------- kill, pkill, pgrep, pidof, killall */
  function sigList() { var r = []; for (var n = 1; n <= 31; n++) r.push(pad(n, 2) + ") SIG" + sigName(n)); var outL = []; for (var i = 0; i < r.length; i += 5) outL.push(r.slice(i, i + 5).join("\t")); return outL.join("\n") + "\n"; }
  function findJob(sys, spec) {
    var live = sys.jobs.filter(function (j) { return !j.gone; });
    if (!live.length) return null;
    if (spec === "%%" || spec === "%+" || spec === "%" || spec === "+") return live[live.length - 1];
    if (spec === "%-" || spec === "-") return live[live.length - 2] || null;
    var s = spec.replace(/^%/, "");
    if (/^\d+$/.test(s)) return live.filter(function (j) { return j.n === +s; })[0] || null;
    if (s.charAt(0) === "?") return live.filter(function (j) { return j.src.indexOf(s.slice(1)) >= 0; }).pop() || null;
    return live.filter(function (j) { return j.src.indexOf(s) === 0; }).pop() || null;
  }
  function killImpl(builtin) {
    return function (args, io, sess) {
      var sys = sess.sys, a = args.slice(1), sig = 15, targets = [], code = 0, pre = builtin ? "bash: kill: " : "kill: ";
      for (var i = 0; i < a.length; i++) {
        var x = a[i];
        if (x === "-l" || x === "-L" || x === "--list" || x === "--table") {
          var w = a[i + 1];
          if (w === undefined) { out(io, sigList()); return 0; }
          if (/^\d+$/.test(w)) { var nm = +w > 128 ? +w - 128 : +w; if (!sigName(nm) || nm > 31) { errl(io, pre + w + ": invalid signal specification"); return 1; } out(io, sigName(nm) + "\n"); return 0; }
          var sn = sigNum(w); if (sn === null) { errl(io, pre + w + ": invalid signal specification"); return 1; } out(io, sn + "\n"); return 0;
        }
        if (x === "-s" || x === "-n" || x === "--signal") { var v = sigNum(a[++i]); if (v === null) { errl(io, pre + a[i] + ": invalid signal specification"); return 1; } sig = v; continue; }
        if (x === "--") { targets = targets.concat(a.slice(i + 1)); break; }
        if (/^-[A-Za-z0-9+]+$/.test(x) && !targets.length) { var v2 = sigNum(x.slice(1)); if (v2 === null) { errl(io, pre + x.slice(1) + ": invalid signal specification"); return 1; } sig = v2; continue; }
        targets.push(x);
      }
      if (!targets.length) { errl(io, builtin ? "kill: usage: kill [-s sigspec | -n signum | -sigspec] pid | jobspec ... or kill -l [sigspec]" : "\nUsage:\n kill [options] <pid> [...]\n\nOptions:\n <pid> [...]            send signal to every <pid> listed\n -<signal>, -s, --signal <signal>\n                        specify the <signal> to be sent\n -l, --list=[<signal>]  list all signal names, or convert one to a name\n"); return builtin ? 2 : 1; }
      targets.forEach(function (t) {
        var pid;
        if (t.charAt(0) === "%") {
          if (!builtin) { errl(io, "kill: failed to parse argument: '" + t + "'"); code = 1; return; }
          var j = findJob(sys, t);
          if (!j) { errl(io, "bash: kill: " + t + ": no such job"); code = 1; return; }
          if (j.finished) { errl(io, "bash: kill: (" + j.pid + ") - No such process"); code = 1; return; }
          pid = j.pid;
        } else if (/^-?\d+$/.test(t)) pid = Math.abs(+t);
        else { errl(io, builtin ? "bash: kill: " + t + ": arguments must be process or job IDs" : "kill: failed to parse argument: '" + t + "'"); code = 1; return; }
        var e = deliver(sys, procByPid(sys, pid), sig, sess);
        if (e === "ESRCH") { errl(io, builtin ? "bash: kill: (" + pid + ") - No such process" : "kill: (" + pid + "): No such process"); code = 1; }
        else if (e === "EPERM") { errl(io, builtin ? "bash: kill: (" + pid + ") - Operation not permitted" : "kill: (" + pid + "): Operation not permitted"); code = 1; }
        else sys.actions.push("kill -" + sig + " " + pid);
      });
      return code;
    };
  }
  B.kill = killImpl(true);
  CMDS.kill = killImpl(false);
  function procMatch(sess, a, name) {
    var sys = sess.sys, o = { sig: 15 }, pats = [];
    for (var i = 0; i < a.length; i++) {
      var x = a[i];
      if (x === "-f" || x === "--full") o.full = true; else if (x === "-l" || x === "--list-name") o.listName = true; else if (x === "-a" || x === "--list-full") o.listFull = true;
      else if (x === "-x" || x === "--exact") o.exact = true; else if (x === "-i" || x === "--ignore-case") o.icase = true; else if (x === "-n" || x === "--newest") o.newest = true; else if (x === "-o" || x === "--oldest") o.oldest = true;
      else if (x === "-c" || x === "--count") o.count = true; else if (x === "-u" || x === "-U" || x === "--euid" || x === "--uid") o.users = String(a[++i]).split(","); else if (x === "-d" || x === "--delimiter") o.delim = a[++i];
      else if (x === "-v" || x === "--inverse") o.inverse = true; else if (x === "-e" || x === "--echo") o.echo = true; else if (x === "-P" || x === "--parent") o.ppid = String(a[++i]).split(",").map(Number);
      else if ((x === "--signal" || x === "-s") && name === "pkill") { o.sig = sigNum(a[++i]); }
      else if (/^-[A-Za-z0-9]+$/.test(x) && name === "pkill" && sigNum(x.slice(1)) !== null) o.sig = sigNum(x.slice(1));
      else if (/^-/.test(x)) throw new ShError(name + ": invalid option -- '" + x.replace(/^-+/, "").charAt(0) + "'\n\nUsage:\n " + name + " [options] <pattern>\n\nFor more details see " + name + "(1).", 2);
      else pats.push(x);
    }
    if (!pats.length && !o.users && !o.ppid) throw new ShError(name + ": no matching criteria specified\nTry `" + name + " --help' for more information.", 2);
    if (pats.length > 1) throw new ShError(name + ": only one pattern can be provided\nTry `" + name + " --help' for more information.", 2);
    var re = null;
    if (pats.length) { try { re = new RegExp(o.exact ? "^(?:" + S.toJsRegex(pats[0], true) + ")$" : S.toJsRegex(pats[0], true), o.icase ? "i" : ""); } catch (e) { throw new ShError(name + ": regular expression compilation failed", 2); } }
    var list = sys.procs.filter(function (p) {
      if (p.kernel && !o.full) { /* kernel threads match by name too */ }
      var hit = true;
      if (re) hit = re.test(o.full ? p.cmd : p.comm);
      if (hit && o.users) hit = o.users.indexOf(S.uname(sys, p.uid)) >= 0 || o.users.indexOf(String(p.uid)) >= 0;
      if (hit && o.ppid) hit = o.ppid.indexOf(p.ppid) >= 0;
      return o.inverse ? !hit : hit;
    }).sort(function (x, y) { return x.pid - y.pid; });
    if (o.newest && list.length) list = [list.reduce(function (b, p) { return p.start > b.start || (p.start === b.start && p.pid > b.pid) ? p : b; })];
    if (o.oldest && list.length) list = [list.reduce(function (b, p) { return p.start < b.start || (p.start === b.start && p.pid < b.pid) ? p : b; })];
    return { list: list, o: o };
  }
  CMDS.pgrep = function (args, io, sess) {
    var m = procMatch(sess, args.slice(1), "pgrep"), o = m.o;
    if (o.count) { out(io, m.list.length + "\n"); return m.list.length ? 0 : 1; }
    var rows = m.list.map(function (p) { return p.pid + (o.listFull ? " " + p.cmd : o.listName ? " " + p.comm : ""); });
    out(io, rows.length ? (o.delim ? rows.join(o.delim) + "\n" : joinLines(rows)) : "");
    return m.list.length ? 0 : 1;
  };
  CMDS.pkill = function (args, io, sess) {
    var m = procMatch(sess, args.slice(1), "pkill"), code = m.list.length ? 0 : 1;
    m.list.forEach(function (p) {
      var e = deliver(sess.sys, p, m.o.sig, sess);
      if (e === "EPERM") { errl(io, "pkill: killing pid " + p.pid + " failed: Operation not permitted"); code = 3; }
      else if (m.o.echo) out(io, p.comm + " killed (pid " + p.pid + ")\n");
    });
    return code;
  };
  CMDS.pidof = function (args, io, sess) {
    var names = args.slice(1).filter(function (x) { return x.charAt(0) !== "-"; }), single = args.indexOf("-s") >= 0;
    var pids = sess.sys.procs.filter(function (p) { return names.indexOf(p.comm) >= 0 || names.indexOf(basename(p.cmd.split(/\s+/)[0])) >= 0; }).map(function (p) { return p.pid; }).sort(function (a, b) { return b - a; });
    if (single) pids = pids.slice(0, 1);
    if (pids.length) out(io, pids.join(" ") + "\n");
    return pids.length ? 0 : 1;
  };
  CMDS.killall = function (args, io, sess) {
    var a = args.slice(1), sig = 15, names = [], code = 0, user = null;
    for (var i = 0; i < a.length; i++) {
      if (a[i] === "-s" || a[i] === "--signal") sig = sigNum(a[++i]); else if (a[i] === "-u" || a[i] === "--user") user = a[++i];
      else if (/^-[A-Z0-9]+$/.test(a[i]) && sigNum(a[i].slice(1)) !== null) sig = sigNum(a[i].slice(1)); else if (a[i] === "-v" || a[i] === "-q" || a[i] === "-w" || a[i] === "-i") continue; else names.push(a[i]);
    }
    if (!names.length) { errl(io, "Usage: killall [OPTION]... [--] NAME..."); return 1; }
    names.forEach(function (n) {
      var list = sess.sys.procs.filter(function (p) { return p.comm === n.slice(0, 15) && (!user || S.uname(sess.sys, p.uid) === user); });
      if (!list.length) { errl(io, n + ": no process found"); code = 1; return; }
      var any = false;
      list.forEach(function (p) { var e = deliver(sess.sys, p, sig, sess); if (e === "EPERM") errl(io, n + "(" + p.pid + "): Operation not permitted"); else any = true; });
      if (!any) code = 1;
    });
    return code;
  };
  CMDS.pstree = function (args, io, sess) {
    var sys = sess.sys, showPid = args.indexOf("-p") >= 0, rootPid = +(args.slice(1).filter(function (x) { return /^\d+$/.test(x); })[0] || 1);
    var outL = [];
    function label(p) { return p.comm + (showPid ? "(" + p.pid + ")" : ""); }
    function walk(p, prefix, isLast, isRoot) {
      var kids = childrenOf(sys, p.pid).filter(function (c) { return !c.kernel; }).sort(function (x, y) { return x.comm < y.comm ? -1 : x.comm > y.comm ? 1 : x.pid - y.pid; });
      outL.push(isRoot ? label(p) : prefix + (isLast ? "└─" : "├─") + label(p));
      kids.forEach(function (k, i) { walk(k, isRoot ? "" : prefix + (isLast ? "  " : "│ "), i === kids.length - 1, false); });
    }
    var r = procByPid(sys, rootPid); if (!r) return 1;
    walk(r, "", true, true);
    out(io, joinLines(outL));
    return 0;
  };

  /* ---------------- job control */
  function jobUpdate(sys, p, state) {
    var j = sys.jobs.filter(function (x) { return x.pid === p.pid && !x.gone; })[0];
    if (!j) return;
    j.state = state;
    if (state !== "Running" && state !== "Stopped") { j.finished = true; j.reportAt = (sys.lineNo || 0) + 1; }
    else if (state === "Stopped") { j.reportStop = (sys.lineNo || 0) + 1; }
  }
  function jobMark(sys, j) { var live = sys.jobs.filter(function (x) { return !x.gone; }); var i = live.indexOf(j); return i === live.length - 1 ? "+" : i === live.length - 2 ? "-" : " "; }
  function jobLine(sys, j, withPid) { var running = j.state === "Running" || j.state === "Stopped"; return "[" + j.n + "]" + jobMark(sys, j) + "  " + (withPid ? j.pid + " " : "") + rpad(j.state, 24) + j.src + (j.state === "Running" ? " &" : ""); }
  function BlockSignal() {}
  S.startJob = function (sess, item, io) {
    var sys = sess.sys;
    var live = sys.jobs.filter(function (j) { return !j.gone; });
    var n = live.length ? Math.max.apply(null, live.map(function (j) { return j.n; })) + 1 : 1;
    var pid = sys.nextPid++;
    io.err("[" + n + "] " + pid + "\n");
    (sess.root || sess).lastBg = pid; sess.lastBg = pid;
    var c = S.subshell(sess);
    var prev = { b: sys.blocking, bg: sys.inBg, nh: sys.nohup };
    sys.blocking = null; sys.inBg = true; sys.nohup = false;
    var code = 0;
    try { code = S.execNode(c, item.node, io, false); }
    catch (e) {
      if (e instanceof BlockSignal) code = 0;
      else if (e instanceof S.ExitSignalCls) code = e.code;
      else if (e instanceof ShError) { io.err(e.message + "\n"); code = e.code; }
      else { sys.blocking = prev.b; sys.inBg = prev.bg; sys.nohup = prev.nh; throw e; }
    }
    var blk = sys.blocking, nh = sys.nohup;
    sys.blocking = prev.b; sys.inBg = prev.bg; sys.nohup = prev.nh;
    var job = { n: n, pid: pid, src: String(item.src || "").replace(/\s*&\s*$/, ""), state: "Running", line: sys.lineNo || 0 };
    sys.jobs.push(job);
    if (blk) {
      var base = { ppid: sess.pid || 2400, uid: sess.uid, tty: "pts/0", stat: "S", job: n, nohup: nh, start: sys.now };
      if (blk.script) {
        spawn(sys, Object.assign({}, base, { pid: pid, cmd: "/bin/bash " + blk.script + (blk.scriptArgs && blk.scriptArgs.length ? " " + blk.scriptArgs.join(" ") : ""), comm: basename(blk.script).slice(0, 15) }));
        spawn(sys, Object.assign({}, base, blk.proc || {}, { ppid: pid, job: null, cmd: blk.cmd, comm: blk.comm || commOf(blk.cmd) }));
      } else spawn(sys, Object.assign({}, base, blk.proc || {}, { pid: pid, cmd: blk.cmd, comm: blk.comm || commOf(blk.cmd) }));
    } else { job.state = code === 0 ? "Done" : "Exit " + code; job.finished = true; job.reportAt = (sys.lineNo || 0) + 2; }
    return 0;
  };
  // A command that keeps running (sleep 600, ping, a server...). In the background it stays in the process table;
  // in the foreground the lab skips the wait.
  function blockHere(sess, info, secs) {
    var sys = sess.sys;
    if (sys.inBg) {
      if (!sys.blocking) sys.blocking = Object.assign({ script: sess.isScript ? sess.argv0 : null, scriptArgs: sess.isScript ? sess.positional : null }, info);
      throw new BlockSignal();
    }
    sys.sleptFg = (sys.sleptFg || 0) + (secs == null ? 3600 : secs);
  }
  M2.blockHere = blockHere;
  S.afterLine = function (sess, io) {
    var sys = sess.sys;
    sys.lineNo = (sys.lineNo || 0) + 1;
    sys.jobs.forEach(function (j) {
      if (j.gone) return;
      if (j.finished && !j.notified && sys.lineNo >= j.reportAt) { io.out(jobLine(sys, j) + "\n"); j.notified = true; j.gone = true; }
      else if (j.reportStop && sys.lineNo >= j.reportStop) { io.out(jobLine(sys, j) + "\n"); j.reportStop = null; }
    });
    if (sys.sleptFg >= 60) note(io, "(That would have kept your terminal busy for " + spanWords(sys.sleptFg) + ". The lab skipped the wait. To keep using the terminal, put & at the end of a long command to run it in the background.)");
    sys.sleptFg = 0;
  };
  CMDS.sleep = function (args, io, sess) {
    var a = args.slice(1).filter(function (x) { return x !== "--"; });
    if (!a.length) { errl(io, "sleep: missing operand\nTry 'sleep --help' for more information."); return 1; }
    var secs = 0;
    for (var i = 0; i < a.length; i++) {
      if (/^inf(inity)?$/.test(a[i])) { secs = Infinity; continue; }
      var m = /^(\d+(?:\.\d+)?|\.\d+)([smhd]?)$/.exec(a[i]);
      if (!m) { errl(io, "sleep: invalid time interval '" + a[i] + "'\nTry 'sleep --help' for more information."); return 1; }
      secs += +m[1] * ({ "": 1, s: 1, m: 60, h: 3600, d: 86400 })[m[2]];
    }
    if (secs > 0) blockHere(sess, { cmd: args.join(" "), comm: "sleep" }, secs === Infinity ? 86400 * 365 : secs);
    return 0;
  };
  B.jobs = function (args, io, sess) {
    var sys = sess.sys, withPid = args.indexOf("-l") >= 0, onlyPid = args.indexOf("-p") >= 0, run = args.indexOf("-r") >= 0, stop = args.indexOf("-s") >= 0;
    sys.jobs.filter(function (j) { return !j.gone; }).forEach(function (j) {
      if (run && j.state !== "Running") return; if (stop && j.state !== "Stopped") return;
      out(io, onlyPid ? j.pid + "\n" : jobLine(sys, j, withPid) + "\n");
      if (j.finished) { j.notified = true; j.gone = true; }
    });
    return 0;
  };
  B.fg = function (args, io, sess) {
    var sys = sess.sys, j = findJob(sys, args[1] || "%+");
    if (!j) { errl(io, "bash: fg: " + (args[1] || "current") + ": no such job"); return 1; }
    if (j.finished) { errl(io, "bash: fg: job has terminated"); out(io, jobLine(sys, j) + "\n"); j.gone = true; return 1; }
    out(io, j.src + "\n");
    var p = procByPid(sys, j.pid);
    if (p) removeProc(sys, p);
    j.gone = true; j.notified = true;
    note(io, "(The job is in the foreground now, so the terminal waits for it. The lab let it run to the end. In a real terminal, Ctrl+C stops it and Ctrl+Z pauses it; then bg resumes it in the background.)");
    return 0;
  };
  B.bg = function (args, io, sess) {
    var sys = sess.sys, j = findJob(sys, args[1] || "%+");
    if (!j) { errl(io, "bash: bg: " + (args[1] || "current") + ": no such job"); return 1; }
    if (j.state === "Running") { errl(io, "bash: bg: job " + j.n + " already in background"); return 0; }
    if (j.finished) { errl(io, "bash: bg: job has terminated"); return 1; }
    var p = procByPid(sys, j.pid); if (p) { p.stopped = false; p.stat = "S"; }
    j.state = "Running"; j.reportStop = null;
    out(io, "[" + j.n + "]" + jobMark(sys, j) + " " + j.src + " &\n");
    return 0;
  };
  B.disown = function (args, io, sess) {
    var sys = sess.sys, j = findJob(sys, args.filter(function (x) { return x.charAt(0) === "%"; })[0] || "%+");
    if (!j) { errl(io, "bash: disown: " + (args[1] || "current") + ": no such job"); return 1; }
    var p = procByPid(sys, j.pid); if (p) { p.disowned = true; p.job = null; }
    j.gone = true; j.notified = true;
    return 0;
  };
  B.wait = function (args, io, sess) {
    var sys = sess.sys, live = sys.jobs.filter(function (j) { return !j.gone && j.state === "Running"; }), code = 0;
    var want = args.slice(1).filter(function (x) { return x !== "-n" && x !== "-f"; });
    if (want.length) live = live.filter(function (j) { return want.some(function (w) { return w === String(j.pid) || findJob(sys, w) === j; }); });
    live.forEach(function (j) { var p = procByPid(sys, j.pid); if (p) removeProc(sys, p); j.state = "Done"; j.finished = true; j.reportAt = (sys.lineNo || 0) + 1; });
    if (live.length) note(io, "(wait blocks until the background jobs finish. The lab skipped ahead.)");
    return code;
  };
  CMDS.nohup = function (args, io, sess) {
    var a = args.slice(1); if (a[0] === "--") a.shift();
    if (!a.length) { errl(io, "nohup: missing operand\nTry 'nohup --help' for more information."); return 125; }
    var sys = sess.sys, io2 = Object.assign({}, io);
    if (io.tty) {
      var target = "nohup.out", shown = "nohup.out";
      if (S.writeFile(sess, target, "", true)) { target = sess.home + "/nohup.out"; shown = target; if (S.writeFile(sess, target, "", true)) { errl(io, "nohup: failed to open 'nohup.out': Permission denied"); return 125; } }
      var abs = S.absPath(sess, target);
      errl(io, "nohup: ignoring input and appending output to '" + shown + "'");
      io2.out = function (t) { S.writeFile(sess, abs, t, true); }; io2.err = io2.out; io2.tty = false; io2.note = null;
    }
    sys.nohup = true;
    var found = !sess.functions[a[0]] && !B[a[0]] ? S.resolveCommand(sess, a[0]) : null;
    if (found && found.error) { errl(io, "nohup: failed to run command '" + a[0] + "': No such file or directory"); return 127; }
    return S.runCommand(sess, a, io2);
  };

  /* ================================================================== systemd */
  var UNIT_DIRS = ["/etc/systemd/system", "/run/systemd/system", "/usr/lib/systemd/system"];
  var ALIASES = { "sshd.service": "ssh.service", "syslog.service": "rsyslog.service", "crond.service": "cron.service" };
  function unitName(n) { n = String(n); return /\.(service|timer|socket|target|mount|path|slice|scope|device)$/.test(n) ? n : n + ".service"; }
  function parseIni(text) {
    var o = {}, sec = null;
    String(text).replace(/\\\n/g, " ").split("\n").forEach(function (l) {
      l = l.trim();
      if (!l || l.charAt(0) === "#" || l.charAt(0) === ";") return;
      var m = /^\[(.+)\]$/.exec(l); if (m) { sec = m[1]; o[sec] = o[sec] || {}; return; }
      var i = l.indexOf("="); if (i < 0 || !sec) return;
      var k = l.slice(0, i).trim(), v = l.slice(i + 1).trim();
      if (v === "") { o[sec][k] = []; return; }
      (o[sec][k] = o[sec][k] || []).push(v);
    });
    return o;
  }
  function getv(ini, sec, key) { var a = ini[sec] && ini[sec][key]; return a && a.length ? a[a.length - 1] : undefined; }
  function findUnitFile(sys, name) {
    for (var i = 0; i < UNIT_DIRS.length; i++) {
      var p = UNIT_DIRS[i] + "/" + name, raw = nodeAt(sys, p, true);
      if (!raw) continue;
      if (raw.type === "l" && /^\/dev\/null$/.test(raw.target)) return { path: p, masked: true };
      var n = nodeAt(sys, p);
      if (n && n.type === "f") return { path: p, content: n.content };
    }
    return null;
  }
  function defineUnit(u, path, content) {
    var ini = parseIni(content), S_ = "Service";
    u.path = path; u.content = content; u.ini = ini; u.masked = false; u.stale = false;
    u.type = u.name.split(".").pop();
    u.desc = getv(ini, "Unit", "Description") || u.name;
    u.docs = getv(ini, "Unit", "Documentation");
    u.svcType = getv(ini, S_, "Type") || "simple";
    u.execStart = getv(ini, S_, "ExecStart");
    u.execStartPre = (ini[S_] && ini[S_].ExecStartPre) || [];
    u.execReload = (ini[S_] && ini[S_].ExecReload) || [];
    u.user = getv(ini, S_, "User") || "root";
    u.workDir = getv(ini, S_, "WorkingDirectory");
    u.envFiles = (ini[S_] && ini[S_].EnvironmentFile) || [];
    u.restart = getv(ini, S_, "Restart") || "no";
    u.remain = /^(yes|true|on|1)$/i.test(getv(ini, S_, "RemainAfterExit") || "");
    var inst = ini.Install || {};
    u.wantedBy = (inst.WantedBy || []).join(" ").split(/\s+/).filter(Boolean);
    u.requiredBy = (inst.RequiredBy || []).join(" ").split(/\s+/).filter(Boolean);
    u.hasInstall = !!(u.wantedBy.length || u.requiredBy.length || inst.Alias);
    if (u.type === "timer") {
      u.onCalendar = (ini.Timer && ini.Timer.OnCalendar) || [];
      u.onBoot = getv(ini, "Timer", "OnBootSec"); u.onActive = getv(ini, "Timer", "OnUnitActiveSec");
      u.timerUnit = getv(ini, "Timer", "Unit") || u.name.replace(/\.timer$/, ".service");
      u.persistent = /^(yes|true|1)$/i.test(getv(ini, "Timer", "Persistent") || "");
    }
    return u;
  }
  function loadUnit(sys, name) {
    name = unitName(name);
    if (ALIASES[name] && !sys.units[name] && !findUnitFile(sys, name)) name = ALIASES[name];
    var u = sys.units[name], f = findUnitFile(sys, name);
    if (u) {
      if (f && f.masked) u.masked = true;
      else { u.masked = false; u.stale = !!f && (f.content !== u.content || f.path !== u.path); u.gone = !f; }
      return u;
    }
    if (!f) return null;
    u = { name: name, rt: { active: "inactive", sub: "dead", result: "success", since: null, nRestarts: 0 } };
    if (f.masked) { u.masked = true; u.type = name.split(".").pop(); u.desc = name; u.path = f.path; u.wantedBy = []; u.requiredBy = []; u.envFiles = []; u.execStartPre = []; u.execReload = []; }
    else defineUnit(u, f.path, f.content);
    sys.units[name] = u;
    return u;
  }
  function wantsDirs(sys) {
    var d = nodeAt(sys, "/etc/systemd/system"); if (!d) return [];
    return Object.keys(d.children).filter(function (k) { return /\.(wants|requires)$/.test(k) && d.children[k].type === "d"; }).map(function (k) { return "/etc/systemd/system/" + k; });
  }
  function enabledState(sys, u) {
    var f = findUnitFile(sys, u.name);
    if (f && f.masked) return "masked";
    if (!f) return u.masked ? "masked" : "not-found";
    var on = wantsDirs(sys).some(function (dir) { var n = nodeAt(sys, dir, true); return n && n.children[u.name]; });
    if (on) return "enabled";
    if (!u.hasInstall) return "static";
    return "disabled";
  }
  function unitProcs(sys, u) { return sys.procs.filter(function (p) { return p.unit === u.name; }).sort(function (a, b) { return (b.main ? 1 : 0) - (a.main ? 1 : 0) || a.pid - b.pid; }); }
  function setState(u, active, sub, result, sys) { u.rt.active = active; u.rt.sub = sub; if (result) u.rt.result = result; u.rt.since = sys.now; }
  M2.loadUnit = loadUnit; M2.enabledState = enabledState; M2.unitProcs = unitProcs; M2.unitName = unitName;
  // How the processes of a service look (exe-specific); default: one process running ExecStart as User.
  function processShape(sys, u, cmd) {
    var exe = cmd.split(/\s+/)[0], b = basename(exe), uid = S.uidOf(sys, u.user), clean = cmd.replace(/\s*\$\{?\w+\}?/g, "").replace(/'/g, "");
    if (M2.shapes[b]) return M2.shapes[b](sys, u, cmd, uid);
    var m = /-m\s+http\.server(?:\s+(\d+))?/.exec(cmd);
    if (m) return [{ cmd: clean, uid: uid, main: true, listen: [{ proto: "tcp", addr: "0.0.0.0", port: +(m[1] || 8000) }] }];
    return [{ cmd: clean, uid: uid, main: true }];
  }
  M2.shapes = {
    nginx: function (sys, u) {
      var ports = M2.nginxListens ? M2.nginxListens(sys) : [{ proto: "tcp", addr: "0.0.0.0", port: 80 }];
      var www = S.uidOf(sys, "www-data");
      return [{ cmd: "nginx: master process /usr/sbin/nginx -g daemon on; master_process on;", comm: "nginx", uid: 0, main: true, listen: ports, onHup: function (s2, p) { reloadUnit(s2, s2.units[u.name], null); } },
        { cmd: "nginx: worker process", comm: "nginx", uid: www, respawn: true, listen: ports }, { cmd: "nginx: worker process", comm: "nginx", uid: www, respawn: true, listen: ports }];
    },
    gunicorn: function (sys, u, cmd, uid) {
      var m = /(?:-b|--bind)[ =]?(\S+)/.exec(cmd), bind = m ? m[1] : "127.0.0.1:8000", hp = bind.split(":"), clean = cmd.replace(/\s*\$\{?\w+\}?/g, "");
      var full = "/opt/kestrel/app/venv/bin/python3 " + clean;
      var l = [{ proto: "tcp", addr: hp[0] || "127.0.0.1", port: +hp[1] }];
      return [{ cmd: full, comm: "gunicorn", uid: uid, main: true, listen: l, cpu: 0.2 }, { cmd: full, comm: "gunicorn", uid: uid, respawn: true, listen: l, cpu: 0.4 }, { cmd: full, comm: "gunicorn", uid: uid, respawn: true, listen: l, cpu: 0.3 }];
    },
    sshd: function (sys) { return [{ cmd: "sshd: /usr/sbin/sshd -D [listener] 0 of 10-100 startups", comm: "sshd", uid: 0, main: true, listen: [{ proto: "tcp", addr: "0.0.0.0", port: 22 }, { proto: "tcp", addr: "[::]", port: 22 }] }]; },
    cron: function () { return [{ cmd: "/usr/sbin/cron -f -P", uid: 0, main: true }]; },
    "redis-server": function (sys) { return [{ cmd: "/usr/bin/redis-server 127.0.0.1:6379", comm: "redis-server", uid: S.uidOf(sys, "redis"), main: true, listen: [{ proto: "tcp", addr: "127.0.0.1", port: 6379 }, { proto: "tcp", addr: "[::1]", port: 6379 }] }]; },
    apache2: function (sys) { var l = [{ proto: "tcp", addr: "*", port: 80 }], www = S.uidOf(sys, "www-data"); return [{ cmd: "/usr/sbin/apache2 -k start", uid: 0, main: true, listen: l }, { cmd: "/usr/sbin/apache2 -k start", uid: www, respawn: true, listen: l }, { cmd: "/usr/sbin/apache2 -k start", uid: www, respawn: true, listen: l }]; },
    "fail2ban-server": function () { return [{ cmd: "/usr/bin/python3 /usr/bin/fail2ban-server -xf start", comm: "fail2ban-server", uid: 0, main: true }]; }
  };
  function listeners(sys) { var l = []; sys.procs.forEach(function (p) { (p.listen || []).forEach(function (s) { l.push({ sock: s, proc: p }); }); }); return l; }
  M2.listeners = listeners;
  function portTaken(sys, sock, exceptUnit) {
    return listeners(sys).filter(function (x) {
      if (x.proc.unit && x.proc.unit === exceptUnit) return false;
      if (x.sock.proto !== sock.proto || x.sock.port !== sock.port) return false;
      var a = x.sock.addr, b = sock.addr, wild = function (v) { return v === "0.0.0.0" || v === "*" || v === "[::]"; };
      return a === b || wild(a) || wild(b);
    })[0] || null;
  }
  M2.portTaken = portTaken;
  function jobFail(u) { return "Job for " + u.name + " failed because the control process exited with error code.\nSee \"systemctl status " + u.name + "\" and \"journalctl -xeu " + u.name + "\" for details."; }
  function failUnit(sys, u, result, logLines, statusText) {
    (logLines || []).forEach(function (l) { if (typeof l === "string") jadd(sys, "systemd", 1, l, u.name, 3); else jadd(sys, l[0], l[1], l[2], u.name, l[3] == null ? 3 : l[3]); });
    jadd(sys, "systemd", 1, u.name + ": Failed with result '" + result + "'.", u.name, 4);
    jadd(sys, "systemd", 1, "Failed to start " + u.name + " - " + u.desc + ".", u.name, 3);
    setState(u, "failed", "failed", result, sys);
    u.rt.mainPid = null; u.rt.exitText = statusText || null;
  }
  function startUnit(sys, u, sess, opts2) {
    opts2 = opts2 || {};
    if (u.masked) return { ok: false, msg: "Failed to start " + u.name + ": Unit " + u.name + " is masked.", code: 1 };
    var rt = u.rt;
    if (rt.active === "active" || rt.active === "activating") return { ok: true };
    if (u.type === "timer") {
      var target = loadUnit(sys, u.timerUnit);
      if (!target) { jadd(sys, "systemd", 1, u.name + ": Refusing to start, unit " + u.timerUnit + " to trigger not loaded.", u.name, 3); setState(u, "failed", "failed", "resources", sys); return { ok: false, msg: "Job for " + u.name + " failed because of unavailable resources or another system error.\nSee \"systemctl status " + u.name + "\" and \"journalctl -xeu " + u.name + "\" for details.", code: 1 }; }
      var cals = u.onCalendar.map(function (c) { return { spec: c, cal: parseCalendar(c) }; });
      cals.forEach(function (c) { if (!c.cal) jadd(sys, "systemd", 1, "/etc/systemd/system/" + u.name + ":" + (lineOf(u.content, "OnCalendar=" + c.spec) || 1) + ": Failed to parse calendar specification, ignoring: " + c.spec, u.name, 3); });
      if (!cals.some(function (c) { return c.cal; }) && !u.onBoot && !u.onActive) { jadd(sys, "systemd", 1, u.name + ": Timer unit lacks value setting. Refusing.", u.name, 3); return { ok: false, msg: "Failed to start " + u.name + ": Unit " + u.name + " has a bad unit file setting.\nSee system logs and 'systemctl status " + u.name + "' for details.", code: 1 }; }
      setState(u, "active", "waiting", "success", sys);
      jadd(sys, "systemd", 1, "Started " + u.name + " - " + u.desc + ".", u.name, 6);
      return { ok: true };
    }
    if (u.type !== "service") return { ok: true };
    rt.result = "success";
    for (var i = 0; i < u.envFiles.length; i++) {
      var ef = u.envFiles[i], optional = ef.charAt(0) === "-", path = ef.replace(/^-/, "");
      if (!optional && !nodeAt(sys, path)) {
        failUnit(sys, u, "resources", [u.name + ": Failed to load environment files: No such file or directory", u.name + ": Failed to spawn 'start' task: No such file or directory"]);
        return { ok: false, msg: "Job for " + u.name + " failed because of unavailable resources or another system error.\nSee \"systemctl status " + u.name + "\" and \"journalctl -xeu " + u.name + "\" for details.", code: 1 };
      }
    }
    var cmd = String(u.execStart || "").replace(/^[-@+!:]+/, "");
    if (!cmd) { jadd(sys, "systemd", 1, u.name + ": Service has no ExecStart=, ExecStop=, or SuccessAction=. Refusing.", u.name, 3); return { ok: false, msg: "Failed to start " + u.name + ": Unit " + u.name + " has a bad unit file setting.\nSee system logs and 'systemctl status " + u.name + "' for details.", code: 1 }; }
    if (!S.userByName(sys, u.user)) {
      failUnit(sys, u, "exit-code", [u.name + ": Failed to determine user credentials: No such process", u.name + ": Failed at step USER spawning " + cmd.split(/\s+/)[0] + ": No such process", u.name + ": Main process exited, code=exited, status=217/USER"], "217/USER");
      return u.svcType === "simple" ? { ok: true } : { ok: false, msg: jobFail(u), code: 1 };
    }
    jadd(sys, "systemd", 1, (u.svcType === "simple" ? "Started " : "Starting ") + u.name + " - " + u.desc + (u.svcType === "simple" ? "." : "..."), u.name, 6);
    // ExecStartPre= (nginx -t, sshd -t)
    for (var k = 0; k < u.execStartPre.length; k++) {
      var pre = u.execStartPre[k].replace(/^[-@+!:]+/, ""), ignore = /^-/.test(u.execStartPre[k]), prePid = sys.nextPid++;
      var r = runControl(sys, u, pre, prePid);
      rt.prePid = prePid; rt.preCmd = pre; rt.preCode = r.code;
      if (r.code !== 0 && !ignore) {
        r.lines.forEach(function (l) { jadd(sys, basename(pre.split(/\s+/)[0]), prePid, l, u.name, 3); });
        failUnit(sys, u, "exit-code", [u.name + ": Control process exited, code=exited, status=" + r.code + "/FAILURE"]);
        return { ok: false, msg: jobFail(u), code: 1 };
      }
    }
    var exe = cmd.split(/\s+/)[0], en = nodeAt(sys, exe);
    if (!en || en.type !== "f" || !(en.mode & 73)) {
      var why = !en ? "No such file or directory" : "Permission denied";
      failUnit(sys, u, "exit-code", [u.name + ": Unable to locate executable '" + exe + "': " + why, u.name + ": Failed at step EXEC spawning " + exe + ": " + why, u.name + ": Main process exited, code=exited, status=203/EXEC"], "203/EXEC");
      return u.svcType === "simple" ? { ok: true } : { ok: false, msg: jobFail(u), code: 1 };
    }
    if (u.failWith) { var fw = u.failWith(sys, u); if (fw) { failUnit(sys, u, "exit-code", fw.log, "1/FAILURE"); return u.svcType === "simple" ? { ok: true } : { ok: false, msg: jobFail(u), code: 1 }; } }
    if (u.svcType === "oneshot") return runOneshot(sys, u, cmd, opts2);
    var shape = processShape(sys, u, cmd);
    // port conflicts
    for (var s1 = 0; s1 < shape.length; s1++) {
      var socks = shape[s1].listen || [];
      for (var s2 = 0; s2 < socks.length; s2++) {
        var taken = portTaken(sys, socks[s2], u.name);
        if (taken) {
          var addrStr = socks[s2].addr.replace("*", "0.0.0.0") + ":" + socks[s2].port, failPid = sys.nextPid++, b = basename(exe);
          var errs = b === "nginx" ? [["nginx", failPid, "nginx: [emerg] bind() to " + addrStr + " failed (98: Address already in use)"], ["nginx", failPid, "nginx: [emerg] still could not bind()"]]
            : b === "apache2" ? [["apachectl", failPid, "(98)Address already in use: AH00072: make_sock: could not bind to address [::]:" + socks[s2].port], ["apachectl", failPid, "(98)Address already in use: AH00072: make_sock: could not bind to address 0.0.0.0:" + socks[s2].port], ["apachectl", failPid, "no listening sockets available, shutting down"], ["apachectl", failPid, "AH00015: Unable to open logs"], ["apachectl", failPid, "Action 'start' failed."]]
            : [[b, failPid, "Error: listen tcp " + addrStr + ": bind: address already in use"]];
          failUnit(sys, u, "exit-code", errs.concat([u.name + ": " + (u.svcType === "simple" ? "Main" : "Control") + " process exited, code=exited, status=1/FAILURE"]), "1/FAILURE");
          rt.exitPid = failPid;
          return u.svcType === "simple" ? { ok: true } : { ok: false, msg: jobFail(u), code: 1 };
        }
      }
    }
    var mainPid = null;
    shape.forEach(function (sp) {
      var p = spawn(sys, Object.assign({ ppid: 1 }, sp, { unit: u.name, start: sys.now, ppid: sp.main ? 1 : mainPid || 1 }));
      if (sp.main) mainPid = p.pid;
    });
    rt.mainPid = mainPid;
    (sys.unitFiles[u.name] || []).forEach(function (f) { if (!nodeAt(sys, f)) putRoot(sys, f, "", 416, S.uidOf(sys, u.user), S.gidOf(sys, "adm")); openFor(sys, mainPid, f); });
    setState(u, "active", "running", "success", sys);
    if (u.svcType !== "simple") jadd(sys, "systemd", 1, "Started " + u.name + " - " + u.desc + ".", u.name, 6);
    if (M2.onUnitStart) M2.onUnitStart(sys, u);
    return { ok: true };
  }
  function lineOf(text, needle) { var ls = String(text || "").split("\n"); for (var i = 0; i < ls.length; i++) if (ls[i].indexOf(needle) >= 0) return i + 1; return 0; }
  // ExecStartPre / control commands: config tests have real checks; anything else runs through the shell.
  function runControl(sys, u, cmd, pid) {
    var w = cmd.split(/\s+/), b = basename(w[0]);
    if (b === "nginx" && w.indexOf("-t") >= 0 && M2.nginxTest) return M2.nginxTest(sys);
    if (b === "sshd" && w.indexOf("-t") >= 0 && M2.sshdTest) return M2.sshdTest(sys);
    var r = runAsUnit(sys, u, cmd);
    return { code: r.code, lines: lines(r.out) };
  }
  function runAsUnit(sys, u, cmd) {
    var rs = S.newSession(sys, { user: u.user, maxSteps: 200000 });
    rs.cwd = u.workDir || "/";
    var buf = "";
    var io = { stdin: "", out: function (t) { buf += t; }, err: function (t) { buf += t; }, tty: false };
    var code;
    try { code = S.runSource(rs, cmd, io); }
    catch (e) {
      if (e instanceof S.ExitSignalCls) code = e.code;
      else if (e instanceof ShError) { buf += e.message + "\n"; code = e.code; }
      else if (e instanceof S.ParseError) { buf += e.message + "\n"; code = 2; }
      else if (e instanceof S.StepLimit) { buf += "(stopped: ran too long)\n"; code = 1; }
      else throw e;
    }
    return { code: code || 0, out: buf };
  }
  function runOneshot(sys, u, cmd, opts2) {
    var pid = sys.nextPid++, exe = cmd.split(/\s+/)[0];
    var r = runAsUnit(sys, u, cmd);
    lines(r.out).forEach(function (l) { jadd(sys, basename(exe), pid, l, u.name, 6); });
    u.rt.lastPid = pid; u.rt.lastCode = r.code; u.rt.lastCmd = cmd; u.rt.lastRun = sys.now;
    if (r.code === 0) {
      if (u.remain) setState(u, "active", "exited", "success", sys);
      else { jadd(sys, "systemd", 1, u.name + ": Deactivated successfully.", u.name, 6); setState(u, "inactive", "dead", "success", sys); }
      jadd(sys, "systemd", 1, "Finished " + u.name + " - " + u.desc + ".", u.name, 6);
      return { ok: true };
    }
    jadd(sys, "systemd", 1, u.name + ": Main process exited, code=exited, status=" + r.code + "/FAILURE", u.name, 4);
    failUnit(sys, u, "exit-code", [], r.code + "/FAILURE");
    u.rt.exitPid = pid;
    return { ok: false, msg: jobFail(u), code: 1 };
  }
  function stopUnit(sys, u, quiet) {
    var rt = u.rt;
    if (u.type === "timer") { if (rt.active === "active") { setState(u, "inactive", "dead", "success", sys); jadd(sys, "systemd", 1, u.name + ": Deactivated successfully.", u.name, 6); jadd(sys, "systemd", 1, "Stopped " + u.name + " - " + u.desc + ".", u.name, 6); } return; }
    var ps = unitProcs(sys, u);
    if (rt.active !== "active" && !ps.length) return;
    jadd(sys, "systemd", 1, "Stopping " + u.name + " - " + u.desc + "...", u.name, 6);
    ps.forEach(function (p) { removeProc(sys, p); sys.openFiles = sys.openFiles.filter(function (f) { return f.pid !== p.pid; }); });
    jadd(sys, "systemd", 1, u.name + ": Deactivated successfully.", u.name, 6);
    jadd(sys, "systemd", 1, "Stopped " + u.name + " - " + u.desc + ".", u.name, 6);
    setState(u, "inactive", "dead", "success", sys);
    rt.mainPid = null;
    if (M2.onUnitStop) M2.onUnitStop(sys, u);
  }
  function reloadUnit(sys, u, sess) {
    if (u.rt.active !== "active") return { ok: false, msg: u.name + " is not active, cannot reload.", code: 1 };
    var isNginx = u.execStart && /nginx/.test(u.execStart);
    if (!u.execReload.length && !isNginx) return { ok: false, msg: "Failed to reload " + u.name + ": Job type reload is not applicable for unit " + u.name + ".", code: 1 };
    jadd(sys, "systemd", 1, "Reloading " + u.name + " - " + u.desc + "...", u.name, 6);
    if (isNginx && M2.nginxTest) {
      var t = M2.nginxTest(sys), pid = sys.nextPid++;
      if (t.code !== 0) {
        t.lines.forEach(function (l) { jadd(sys, "nginx", pid, l, u.name, 3); });
        jadd(sys, "systemd", 1, u.name + ": Control process exited, code=exited, status=1/FAILURE", u.name, 4);
        jadd(sys, "systemd", 1, "Reload failed for " + u.name + " - " + u.desc + ".", u.name, 3);
        return { ok: false, msg: "Job for " + u.name + " failed because the control process exited with error code.\nSee \"systemctl status " + u.name + "\" and \"journalctl -xeu " + u.name + "\" for details.", code: 1 };
      }
      // new workers, same master
      unitProcs(sys, u).filter(function (p) { return !p.main; }).forEach(function (p) { removeProc(sys, p); });
      var master = unitProcs(sys, u)[0], ports = M2.nginxListens(sys), www = S.uidOf(sys, "www-data");
      if (master) master.listen = ports;
      [0, 1].forEach(function () { spawn(sys, { cmd: "nginx: worker process", comm: "nginx", uid: www, respawn: true, listen: ports, unit: u.name, ppid: master ? master.pid : 1 }); });
      if (M2.onUnitStart) M2.onUnitStart(sys, u);
    }
    jadd(sys, "systemd", 1, "Reloaded " + u.name + " - " + u.desc + ".", u.name, 6);
    if (!isNginx && M2.onUnitStart) M2.onUnitStart(sys, u);
    return { ok: true };
  }
  function unitMainDied(sys, u, p, sig) {
    jadd(sys, "systemd", 1, u.name + ": Main process exited, code=killed, status=" + sig + "/" + sigName(sig), u.name, 6);
    unitProcs(sys, u).forEach(function (q) { removeProc(sys, q); });
    sys.openFiles = sys.openFiles.filter(function (f) { return f.pid !== p.pid; });
    var clean = [1, 2, 13, 15].indexOf(sig) >= 0;
    if (clean) { jadd(sys, "systemd", 1, u.name + ": Deactivated successfully.", u.name, 6); setState(u, "inactive", "dead", "success", sys); }
    else { jadd(sys, "systemd", 1, u.name + ": Failed with result 'signal'.", u.name, 4); setState(u, "failed", "failed", "signal", sys); u.rt.exitText = sig + "/" + sigName(sig); u.rt.exitPid = p.pid; }
    u.rt.mainPid = null;
    var again = u.restart === "always" || ((u.restart === "on-failure" || u.restart === "on-abnormal") && !clean);
    if (again) {
      u.rt.nRestarts = (u.rt.nRestarts || 0) + 1;
      jadd(sys, "systemd", 1, u.name + ": Scheduled restart job, restart counter is at " + u.rt.nRestarts + ".", u.name, 6);
      u.rt.active = "inactive";
      startUnit(sys, u, null, { quiet: true });
    }
  }
  M2.startUnit = startUnit; M2.stopUnit = stopUnit; M2.reloadUnit = reloadUnit;
  function activeText(sys, u) {
    var rt = u.rt, since = rt.since ? " since " + sdate(rt.since) + "; " + span(sys.now - rt.since) + " ago" : "";
    if (rt.active === "active") return "active (" + rt.sub + ")" + since;
    if (rt.active === "failed") return "failed (Result: " + rt.result + ")" + since;
    return "inactive (dead)" + since;
  }
  function dot(u) { return u.rt.active === "active" ? "●" : u.rt.active === "failed" ? "×" : "○"; }
  function statusText(sys, u, nLines, full) {
    var rt = u.rt, L = [];
    L.push(dot(u) + " " + u.name + " - " + u.desc);
    if (u.masked) L.push("     Loaded: masked (Reason: Unit " + u.name + " is masked.)");
    else L.push("     Loaded: loaded (" + u.path + "; " + enabledState(sys, u) + "; preset: enabled)");
    L.push("     Active: " + activeText(sys, u));
    if (u.type === "timer" && !u.masked) {
      var nx = timerNext(sys, u);
      L.push("    Trigger: " + (rt.active === "active" && nx ? sdate(nx) + "; " + span(nx - sys.now) + " left" : "n/a"));
      L.push("   Triggers: " + (sys.units[u.timerUnit] ? dot(sys.units[u.timerUnit]) : "●") + " " + u.timerUnit);
    }
    if (u.docs) L.push("       Docs: " + u.docs);
    if (rt.prePid && u.type === "service" && rt.since) L.push("    Process: " + rt.prePid + " ExecStartPre=" + rt.preCmd + " (code=exited, status=" + (rt.preCode === 0 ? "0/SUCCESS" : rt.preCode + "/FAILURE") + ")");
    if (u.type === "service" && u.svcType === "oneshot" && rt.lastPid) L.push("    Process: " + rt.lastPid + " ExecStart=" + rt.lastCmd + " (code=exited, status=" + (rt.lastCode === 0 ? "0/SUCCESS" : rt.lastCode + "/FAILURE") + ")");
    var ps = unitProcs(sys, u);
    if (u.type === "service") {
      if (rt.active === "active" && rt.mainPid) L.push("   Main PID: " + rt.mainPid + " (" + (procByPid(sys, rt.mainPid) || { comm: "?" }).comm + ")");
      else if (rt.active === "failed" && rt.exitText) L.push("   Main PID: " + (rt.exitPid || rt.prePid || (sys.nextPid - 1)) + " (code=" + (/KILL|TERM|HUP|INT|SEGV|ABRT/.test(rt.exitText) ? "killed, signal=" + rt.exitText.split("/")[1] : "exited, status=" + rt.exitText) + ")");
      if (ps.length) {
        var mem = ps.reduce(function (s, p) { return s + p.rss; }, 0) / 1024;
        L.push("      Tasks: " + ps.length + " (limit: 4558)");
        L.push("     Memory: " + mem.toFixed(1) + "M (peak: " + (mem * 1.08).toFixed(1) + "M)");
        var cpuMs = Math.max(12, Math.round(ps.reduce(function (s, p) { return s + (p.cpuSecs || 0.03); }, 0) * 1000) + (hash(u.name) % 900));
        L.push("        CPU: " + (cpuMs < 1000 ? cpuMs + "ms" : (cpuMs / 1000).toFixed(3) + "s"));
        L.push("     CGroup: /system.slice/" + u.name);
        ps.forEach(function (p, i) { var c = p.cmd; if (/^[\w.-]+: /.test(c)) c = "\"" + c + "\""; L.push("             " + (i === ps.length - 1 ? "└─" : "├─") + p.pid + " " + c); });
      } else if (rt.active === "failed" || rt.since) L.push("        CPU: " + (rt.active === "failed" ? "18ms" : "6ms"));
    }
    var js = journalSorted(sys).filter(function (e) { return e.unit === u.name; }).slice(-(nLines == null ? 10 : nLines));
    if (js.length && nLines !== 0) { L.push(""); js.forEach(function (e) { L.push(jline(sys, e)); }); }
    return L.join("\n") + "\n";
  }
  M2.statusText = statusText;
  function systemOverview(sys) {
    var failed = Object.keys(sys.units).filter(function (k) { return sys.units[k].rt.active === "failed"; }).length;
    return "● " + sys.host + "\n    State: " + (failed ? "degraded" : "running") + "\n    Units: 247 loaded (incl. loaded aliases)\n     Jobs: 0 queued\n   Failed: " + failed + " units\n    Since: " + sdate(BOOT) + "; " + span(sys.now - BOOT) + " ago\n  systemd: 255.4-1ubuntu8.4\n   CGroup: /\n";
  }
  function unitRows(sys, o) {
    Object.keys(sys.units).forEach(function (k) { loadUnit(sys, k); });
    var names = Object.keys(sys.units).sort();
    return names.map(function (k) { return sys.units[k]; }).filter(function (u) {
      if (u.gone && u.rt.active === "inactive") return false;
      if (o.type && o.type.split(",").indexOf(u.type) < 0) return false;
      if (o.state) { var st = o.state.split(","); if (st.indexOf(u.rt.active) < 0 && st.indexOf(u.rt.sub) < 0) return false; }
      else if (!o.all && u.rt.active === "inactive") return false;
      if (o.patterns && o.patterns.length && !o.patterns.some(function (p) { return u.name === unitName(p) || S.globMatch(p, u.name); })) return false;
      return true;
    });
  }
  function listUnits(sys, io, o) {
    var rows = unitRows(sys, o);
    if (!rows.length) { if (!o.noLegend) out(io, "  UNIT LOAD ACTIVE SUB DESCRIPTION\n\n0 loaded units listed.\n"); return 0; }
    var w = [Math.max(4, Math.max.apply(null, rows.map(function (u) { return u.name.length; }))), 6, Math.max(6, Math.max.apply(null, rows.map(function (u) { return u.rt.active.length; }))), Math.max(3, Math.max.apply(null, rows.map(function (u) { return u.rt.sub.length; })))];
    var L = [];
    if (!o.noLegend) L.push("  " + rpad("UNIT", w[0]) + " " + rpad("LOAD", w[1]) + " " + rpad("ACTIVE", w[2]) + " " + rpad("SUB", w[3]) + " DESCRIPTION");
    rows.forEach(function (u) { L.push((u.rt.active === "failed" ? "● " : "  ") + rpad(u.name, w[0]) + " " + rpad(u.masked ? "masked" : "loaded", w[1]) + " " + rpad(u.rt.active, w[2]) + " " + rpad(u.rt.sub, w[3]) + " " + u.desc); });
    if (!o.noLegend) L.push("", "Legend: LOAD   → Reflects whether the unit definition was properly loaded.", "        ACTIVE → The high-level unit activation state, i.e. generalization of SUB.", "        SUB    → The low-level unit activation state, values depend on unit type.", "", rows.length + " loaded units listed." + (o.all ? "" : " Pass --all to see loaded but inactive units, too."), "To show all installed unit files use 'systemctl list-unit-files'.");
    out(io, L.join("\n") + "\n");
    return 0;
  }
  function allUnitFiles(sys) {
    var seen = {}, res = [];
    UNIT_DIRS.forEach(function (dir) {
      var d = nodeAt(sys, dir); if (!d || d.type !== "d") return;
      Object.keys(d.children).forEach(function (k) {
        if (!/\.(service|timer|socket|target)$/.test(k) || seen[k]) return;
        var raw = d.children[k]; if (raw.type === "d") return;
        seen[k] = true; res.push(k);
      });
    });
    return res.sort();
  }
  function listUnitFiles(sys, io, o) {
    var rows = allUnitFiles(sys).map(function (n) { var u = loadUnit(sys, n); return { name: n, state: u ? enabledState(sys, u) : "bad" }; }).filter(function (r) {
      if (o.type && o.type.split(",").indexOf(r.name.split(".").pop()) < 0) return false;
      if (o.state && o.state.split(",").indexOf(r.state) < 0) return false;
      if (o.patterns && o.patterns.length && !o.patterns.some(function (p) { return S.globMatch(p, r.name) || r.name === unitName(p); })) return false;
      return true;
    });
    var w = Math.max(9, Math.max.apply(null, rows.map(function (r) { return r.name.length; }).concat([0])));
    var L = o.noLegend ? [] : [rpad("UNIT FILE", w) + " STATE           PRESET"];
    rows.forEach(function (r) { L.push(rpad(r.name, w) + " " + rpad(r.state, 15) + " " + (r.state === "static" ? "-" : "enabled")); });
    if (!o.noLegend) L.push("", rows.length + " unit files listed.");
    out(io, L.join("\n") + "\n");
    return 0;
  }
  function timerNext(sys, u) {
    var best = null;
    (u.onCalendar || []).forEach(function (c) { var cal = parseCalendar(c); if (!cal) return; var t = calNext(cal, sys.now); if (t && (!best || t < best)) best = t; });
    if (u.onActive && u.rt.lastTrigger) { var sec = parseSpan(u.onActive); if (sec) { var t2 = u.rt.lastTrigger + sec * 1000; while (t2 <= sys.now) t2 += sec * 1000; if (!best || t2 < best) best = t2; } }
    return best;
  }
  function parseSpan(s) { var m = /^(\d+)\s*(s|sec|m|min|h|hour|hours|d|day|days|w|week|weeks)?$/.exec(String(s).trim()); if (!m) return null; return +m[1] * ({ s: 1, sec: 1, m: 60, min: 60, h: 3600, hour: 3600, hours: 3600, d: 86400, day: 86400, days: 86400, w: 604800, week: 604800, weeks: 604800 })[m[2] || "s"]; }
  function listTimers(sys, io, o) {
    Object.keys(sys.units).forEach(function (k) { loadUnit(sys, k); });
    var rows = Object.keys(sys.units).map(function (k) { return sys.units[k]; }).filter(function (u) { return u.type === "timer" && !u.masked && (o.all || u.rt.active === "active"); })
      .map(function (u) { return { u: u, next: u.rt.active === "active" ? timerNext(sys, u) : null, last: u.rt.lastTrigger || null }; })
      .sort(function (a, b) { return (a.next || Infinity) - (b.next || Infinity); });
    if (o.patterns && o.patterns.length) rows = rows.filter(function (r) { return o.patterns.some(function (p) { return S.globMatch(p, r.u.name) || r.u.name === p || r.u.name === p + ".timer"; }); });
    var cells = rows.map(function (r) { return [r.next ? sdate(r.next) : "-", r.next ? span(r.next - sys.now) + " left" : "-", r.last ? sdate(r.last) : "-", r.last ? span(sys.now - r.last) + " ago" : "-", r.u.name, r.u.timerUnit]; });
    var head = ["NEXT", "LEFT", "LAST", "PASSED", "UNIT", "ACTIVATES"], w = head.map(function (h, i) { return Math.max.apply(null, [h.length].concat(cells.map(function (c) { return c[i].length; }))); });
    var L = [head.map(function (h, i) { return i === 5 ? h : rpad(h, w[i]); }).join(" ")];
    cells.forEach(function (c) { L.push(c.map(function (v, i) { return i === 5 ? v : rpad(v, w[i]); }).join(" ")); });
    L.push("", rows.length + " timers listed." + (o.all ? "" : "\nPass --all to see loaded but inactive timers, too."));
    out(io, L.join("\n") + "\n");
    return 0;
  }
  function enableUnit(sys, u, io) {
    if (u.masked) { errl(io, "Failed to enable unit: Unit file " + u.path + " is masked."); return 1; }
    if (!u.hasInstall) { errl(io, "The unit files have no installation config (WantedBy=, RequiredBy=, UpheldBy=,\nAlso=, or Alias= settings in the [Install] section, and DefaultInstance= for\ntemplate units). This means they are not meant to be enabled or disabled using systemctl.\n \nPossible reasons for having these kinds of units are:\n• A unit may be statically enabled by being symlinked from another unit's\n  .wants/, .requires/, or .upholds/ directory.\n• A unit's purpose may be to act as a helper for some other unit which has\n  a requirement dependency on it.\n• A unit may be started when needed via activation (socket, path, timer,\n  D-Bus, udev, scripted systemctl call, ...).\n• In case of template units, the unit is meant to be enabled with some\n  instance name specified."); return 0; }
    u.wantedBy.concat(u.requiredBy).forEach(function (t, i) {
      var dir = "/etc/systemd/system/" + t + (i < u.wantedBy.length ? ".wants" : ".requires");
      var d = mkdirRoot(sys, dir);
      if (!d.children[u.name]) { d.children[u.name] = S.linkNode(u.path); errl(io, "Created symlink " + dir + "/" + u.name + " → " + u.path + "."); }
    });
    return 0;
  }
  function disableUnit(sys, u, io) {
    wantsDirs(sys).forEach(function (dir) { var d = nodeAt(sys, dir); if (d && d.children[u.name]) { delete d.children[u.name]; errl(io, "Removed \"" + dir + "/" + u.name + "\"."); } });
    return 0;
  }
  function daemonReload(sys) {
    Object.keys(sys.units).forEach(function (k) {
      var u = sys.units[k], f = findUnitFile(sys, k);
      if (!f) { if (u.rt.active !== "active") delete sys.units[k]; else u.gone = true; return; }
      if (f.masked) { u.masked = true; return; }
      defineUnit(u, f.path, f.content);
    });
  }
  M2.daemonReload = daemonReload;
  function staleWarning(io, u) { errl(io, "Warning: The unit file, source configuration file or drop-ins of " + u.name + " changed on disk. Run 'systemctl daemon-reload' to reload units."); }
  CMDS.systemctl = function (args, io, sess) {
    var sys = sess.sys, a = args.slice(1), o = { patterns: [] }, rest = [];
    for (var i = 0; i < a.length; i++) {
      var x = a[i], m;
      if (x === "--now") o.now = true; else if (x === "--no-pager" || x === "--system" || x === "--no-ask-password" || x === "-l" || x === "--full" || x === "--plain") { if (x === "--plain") o.plain = true; }
      else if (x === "-a" || x === "--all") o.all = true; else if (x === "-q" || x === "--quiet") o.quiet = true; else if (x === "--no-legend") o.noLegend = true; else if (x === "--failed") o.state = "failed";
      else if ((m = /^--type=(.+)$/.exec(x))) o.type = m[1]; else if (x === "-t" || x === "--type") o.type = a[++i];
      else if ((m = /^--state=(.+)$/.exec(x))) o.state = m[1]; else if (x === "--state") o.state = a[++i];
      else if ((m = /^(?:-n|--lines=)(\d+)$/.exec(x))) o.lines = +m[1]; else if (x === "-n" || x === "--lines") o.lines = +a[++i];
      else if ((m = /^(?:-p|--property=)(.+)$/.exec(x))) o.props = (o.props || []).concat(m[1].split(",")); else if (x === "-p" || x === "--property") o.props = (o.props || []).concat(a[++i].split(","));
      else if (x === "--value") o.value = true; else if ((m = /^(?:-s|--signal=)(.+)$/.exec(x))) o.signal = m[1]; else if (x === "-s" || x === "--signal") o.signal = a[++i];
      else if (x === "--user") { errl(io, "Failed to connect to bus: No medium found"); return 1; }
      else if (x === "-h" || x === "--help") { out(io, "systemctl [OPTIONS...] COMMAND ...\n\nQuery or send control commands to the system manager.\n\nUnit Commands:\n  list-units [PATTERN...]             List units currently in memory\n  list-timers [PATTERN...]            List timer units currently in memory\n  status [PATTERN...|PID...]          Show runtime status of one or more units\n  cat PATTERN...                      Show files and drop-ins of specified units\n  start UNIT...                       Start (activate) one or more units\n  stop UNIT...                        Stop (deactivate) one or more units\n  reload UNIT...                      Reload one or more units\n  restart UNIT...                     Start or restart one or more units\n  is-active PATTERN...                Check whether units are active\n  is-failed PATTERN...                Check whether units are failed\n\nUnit File Commands:\n  list-unit-files [PATTERN...]        List installed unit files\n  enable [UNIT...|PATH...]            Enable one or more unit files\n  disable UNIT...                     Disable one or more unit files\n  is-enabled UNIT...                  Check whether unit files are enabled\n  mask UNIT...                        Mask one or more units\n  unmask UNIT...                      Unmask one or more units\n  daemon-reload                       Reload systemd manager configuration\n\nOptions:\n  --now                               Start or stop unit after enabling or disabling it\n  -t --type=TYPE                      List units of a particular type\n     --state=STATE                    List units with particular LOAD or SUB or ACTIVE state\n     --failed                         Shortcut for --state=failed\n  -a --all                            Show all properties/all units\n  -q --quiet                          Suppress output\n  -n --lines=INTEGER                  Number of journal entries to show\n"); return 0; }
      else if (/^-/.test(x)) { errl(io, "systemctl: unrecognized option '" + x + "'"); return 1; }
      else rest.push(x);
    }
    var verb = rest.shift() || "list-units", names = rest;
    var priv = ["start", "stop", "restart", "reload", "try-restart", "reload-or-restart", "condrestart", "enable", "disable", "reenable", "mask", "unmask", "daemon-reload", "reset-failed", "kill", "edit", "daemon-reexec", "link", "revert", "preset", "reboot", "poweroff", "halt", "isolate", "set-property"];
    if (priv.indexOf(verb) >= 0 && sess.uid !== 0) {
      if (/^(enable|disable|reenable|mask|unmask|link|preset|revert)$/.test(verb)) errl(io, "Failed to " + verb + " unit: Interactive authentication required.");
      else if (verb === "daemon-reload") errl(io, "Failed to reload daemon: Interactive authentication required.");
      else if (/^(reboot|poweroff|halt)$/.test(verb)) errl(io, "Call to " + (verb === "reboot" ? "Reboot" : "PowerOff") + " failed: Interactive authentication required.");
      else if (verb === "edit") errl(io, "Failed to edit units: Interactive authentication required.");
      else (names.length ? names : [""]).forEach(function (n) { errl(io, "Failed to " + verb.replace("try-restart", "try-restart").replace("reload-or-restart", "reload or restart") + " " + unitName(n) + ": Interactive authentication required.\nSee system logs and 'systemctl status " + unitName(n) + "' for details."); });
      return 1;
    }
    function needNames() { if (!names.length) { errl(io, "Too few arguments."); return false; } return true; }
    var code = 0;
    switch (verb) {
      case "list-units": o.patterns = names; return listUnits(sys, io, o);
      case "list-unit-files": o.patterns = names; return listUnitFiles(sys, io, o);
      case "list-timers": o.patterns = names; return listTimers(sys, io, o);
      case "status":
        if (!names.length) { out(io, systemOverview(sys)); return 0; }
        names.forEach(function (n, k) {
          var u;
          if (/^\d+$/.test(n)) { var p = procByPid(sys, +n); u = p && p.unit ? sys.units[p.unit] : null; if (!u) { errl(io, "Failed to get unit for PID " + n + ": PID " + n + " does not belong to any loaded unit."); code = 4; return; } }
          else u = loadUnit(sys, n);
          if (!u) { errl(io, "Unit " + unitName(n) + " could not be found."); code = 4; return; }
          if (k) out(io, "\n");
          out(io, statusText(sys, u, o.lines));
          if (u.stale) staleWarning(io, u);
          if (u.rt.active !== "active" && code === 0) code = 3;
        });
        return code;
      case "is-active": case "is-failed":
        if (!needNames()) return 1;
        code = 1;
        names.forEach(function (n) {
          var u = loadUnit(sys, n), st = u ? u.rt.active : "inactive";
          if (!o.quiet) out(io, st + "\n");
          if ((verb === "is-active" && st === "active") || (verb === "is-failed" && st === "failed")) code = 0;
        });
        return verb === "is-active" ? (code === 0 ? 0 : 3) : code;
      case "is-enabled":
        if (!needNames()) return 1;
        code = 1;
        names.forEach(function (n) {
          var u = loadUnit(sys, n);
          if (!u) { errl(io, "Failed to get unit file state for " + unitName(n) + ": No such file or directory"); return; }
          var st = enabledState(sys, u);
          if (!o.quiet) out(io, st + "\n");
          if (st === "enabled" || st === "static" || st === "alias") code = 0;
        });
        return code;
      case "start": case "stop": case "restart": case "reload": case "try-restart": case "reload-or-restart": case "condrestart":
        if (!needNames()) return 1;
        names.forEach(function (n) {
          var u = loadUnit(sys, n);
          if (!u) { errl(io, "Failed to " + verb + " " + unitName(n) + ": Unit " + unitName(n) + " not found."); code = 5; return; }
          if (u.stale) staleWarning(io, u);
          var r = { ok: true };
          if (verb === "start") r = startUnit(sys, u, sess);
          else if (verb === "stop") stopUnit(sys, u);
          else if (verb === "restart" || (verb === "try-restart" || verb === "condrestart") && u.rt.active === "active") { stopUnit(sys, u); if (u.rt.active === "failed") u.rt.active = "inactive"; r = startUnit(sys, u, sess); }
          else if (verb === "reload") r = reloadUnit(sys, u, sess);
          else if (verb === "reload-or-restart") { if (u.rt.active === "active" && (u.execReload.length || /nginx/.test(u.execStart || ""))) r = reloadUnit(sys, u, sess); else { stopUnit(sys, u); if (u.rt.active === "failed") u.rt.active = "inactive"; r = startUnit(sys, u, sess); } }
          if (!r.ok) { errl(io, r.msg); code = r.code || 1; }
          sys.actions.push("systemctl " + verb + " " + u.name);
        });
        return code;
      case "enable": case "disable": case "reenable":
        if (!needNames()) return 1;
        names.forEach(function (n) {
          var u = loadUnit(sys, n);
          if (!u) { errl(io, "Failed to " + verb + " unit: Unit file " + unitName(n) + " does not exist."); code = 1; return; }
          if (verb !== "enable") disableUnit(sys, u, io);
          if (verb !== "disable") code = enableUnit(sys, u, io) || code;
          if (o.now) {
            if (verb === "disable") stopUnit(sys, u);
            else { if (verb === "reenable") stopUnit(sys, u); var r = startUnit(sys, u, sess); if (!r.ok) { errl(io, r.msg); code = 1; } }
          }
        });
        return code;
      case "mask": case "unmask":
        if (!needNames()) return 1;
        names.forEach(function (n) {
          var name = unitName(n), p = "/etc/systemd/system/" + name, raw = nodeAt(sys, p, true);
          if (verb === "mask") {
            if (raw && raw.type === "f") { errl(io, "Failed to mask unit: File " + p + " already exists."); code = 1; return; }
            mkdirRoot(sys, "/etc/systemd/system").children[name] = S.linkNode("/dev/null");
            errl(io, "Created symlink " + p + " → /dev/null.");
            var u = loadUnit(sys, name); if (u) u.masked = true;
          } else if (raw && raw.type === "l" && raw.target === "/dev/null") {
            delete nodeAt(sys, "/etc/systemd/system").children[name];
            errl(io, "Removed \"" + p + "\".");
            var u2 = sys.units[name]; if (u2) { delete sys.units[name]; var nu = loadUnit(sys, name); if (nu) nu.rt = u2.rt; }
          }
        });
        return code;
      case "daemon-reload": case "daemon-reexec": daemonReload(sys); return 0;
      case "reset-failed":
        Object.keys(sys.units).forEach(function (k) { var u = sys.units[k]; if ((!names.length || names.map(unitName).indexOf(k) >= 0) && u.rt.active === "failed") { u.rt.active = "inactive"; u.rt.sub = "dead"; u.rt.result = "success"; } });
        return 0;
      case "cat":
        if (!needNames()) return 1;
        names.forEach(function (n, k) {
          var u = loadUnit(sys, n), f = u && findUnitFile(sys, u.name);
          if (!f || f.masked) { errl(io, "No files found for " + unitName(n) + "."); code = 1; return; }
          out(io, (k ? "\n" : "") + "# " + f.path + "\n" + f.content + (/\n$/.test(f.content) ? "" : "\n"));
        });
        return code;
      case "show":
        if (!needNames()) return 1;
        names.forEach(function (n) {
          var u = loadUnit(sys, n);
          var P = { Id: unitName(n), Names: unitName(n), Description: u ? u.desc : "", LoadState: u ? (u.masked ? "masked" : "loaded") : "not-found", ActiveState: u ? u.rt.active : "inactive", SubState: u ? u.rt.sub : "dead", UnitFileState: u ? enabledState(sys, u) : "", FragmentPath: u ? u.path : "", MainPID: u && u.rt.mainPid ? u.rt.mainPid : 0, ExecMainPID: u && u.rt.mainPid ? u.rt.mainPid : 0, User: u ? (u.user === "root" ? "" : u.user) : "", Restart: u ? u.restart : "no", NRestarts: u ? u.rt.nRestarts || 0 : 0, Result: u ? u.rt.result : "success", ActiveEnterTimestamp: u && u.rt.since ? sdate(u.rt.since) : "", Type: u ? u.svcType : "", WorkingDirectory: u && u.workDir ? u.workDir : "" };
          var keys = o.props || Object.keys(P);
          keys.forEach(function (k) { if (P[k] === undefined) return; out(io, (o.value ? "" : k + "=") + P[k] + "\n"); });
        });
        return 0;
      case "kill":
        if (!needNames()) return 1;
        names.forEach(function (n) { var u = loadUnit(sys, n); if (!u) { errl(io, "Failed to kill unit " + unitName(n) + ": Unit " + unitName(n) + " not loaded."); code = 1; return; } var sg = sigNum(o.signal || "TERM"); unitProcs(sys, u).filter(function (p) { return p.main; }).forEach(function (p) { deliver(sys, p, sg, sess); }); });
        return code;
      case "edit":
        note(io, "(systemctl edit " + (names[0] || "UNIT") + " opens an editor on a drop-in file, /etc/systemd/system/" + unitName(names[0] || "UNIT") + ".d/override.conf, whose settings override the unit's. This lab can't show full-screen editors: create the file with tee instead, then run systemctl daemon-reload.)");
        return 0;
      case "reboot": case "poweroff": case "halt":
        note(io, "(The lab won't " + verb + " kc-web-01. On a real server this ends everyone's session; check who's logged in with w first.)");
        return 0;
      case "get-default": out(io, "graphical.target\n"); return 0;
      default:
        errl(io, "Unknown command verb '" + verb + "'.");
        return 1;
    }
  };

  /* ---------------- journalctl */
  var PRIO = { emerg: 0, alert: 1, crit: 2, err: 3, warning: 4, notice: 5, info: 6, debug: 7 };
  function parseWhen(s, sys) {
    s = String(s).trim().toLowerCase().replace(/^"|"$/g, "");
    var now = sys.now, mid = Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth(), new Date(now).getUTCDate());
    if (s === "now") return now; if (s === "today") return mid; if (s === "yesterday") return mid - DAY; if (s === "tomorrow") return mid + DAY;
    var m = /^([-+])?\s*(\d+)\s*(s|sec|secs|second|seconds|m|min|mins|minute|minutes|h|hr|hour|hours|d|day|days|w|week|weeks)\s*(ago)?$/.exec(s);
    if (m) { var mult = { s: 1, sec: 1, secs: 1, second: 1, seconds: 1, m: 60, min: 60, mins: 60, minute: 60, minutes: 60, h: 3600, hr: 3600, hour: 3600, hours: 3600, d: 86400, day: 86400, days: 86400, w: 604800, week: 604800, weeks: 604800 }[m[3]]; var past = m[1] === "-" || m[4]; return now + (past ? -1 : 1) * +m[2] * mult * 1000; }
    m = /^(\d{4})-(\d{2})-(\d{2})(?:[ t](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(s);
    if (m) return Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
    m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(s);
    if (m) return mid + ((+m[1]) * 3600 + (+m[2]) * 60 + (+(m[3] || 0))) * 1000;
    return null;
  }
  M2.parseWhen = parseWhen;
  CMDS.journalctl = function (args, io, sess) {
    var sys = sess.sys, a = args.slice(1), o = { units: [], idents: [] }, m;
    for (var i = 0; i < a.length; i++) {
      var x = a[i];
      if (x === "-u" || x === "--unit") o.units.push(a[++i]); else if ((m = /^(?:-u|--unit=)(.+)$/.exec(x))) o.units.push(m[1]);
      else if (x === "-n" || x === "--lines") { if (/^\d+$/.test(a[i + 1] || "")) o.n = +a[++i]; else o.n = 10; } else if ((m = /^(?:-n|--lines=)(\d+)$/.exec(x))) o.n = +m[1];
      else if (x === "-e" || x === "--pager-end") o.end = true; else if (x === "-f" || x === "--follow") o.follow = true; else if (x === "-r" || x === "--reverse") o.reverse = true;
      else if (x === "-p" || x === "--priority") o.prio = a[++i]; else if ((m = /^(?:-p|--priority=)(.+)$/.exec(x))) o.prio = m[1];
      else if (x === "-S" || x === "--since") o.since = a[++i]; else if ((m = /^--since=(.+)$/.exec(x))) o.since = m[1];
      else if (x === "-U" || x === "--until") o.until = a[++i]; else if ((m = /^--until=(.+)$/.exec(x))) o.until = m[1];
      else if (x === "-k" || x === "--dmesg") o.kernel = true; else if (x === "-t" || x === "--identifier") o.idents.push(a[++i]); else if ((m = /^--identifier=(.+)$/.exec(x))) o.idents.push(m[1]);
      else if (x === "-o" || x === "--output") o.fmt = a[++i]; else if ((m = /^(?:-o|--output=)(.+)$/.exec(x))) o.fmt = m[1];
      else if (x === "-b" || x === "--boot" || x === "-x" || x === "--catalog" || x === "--no-pager" || x === "-q" || x === "--quiet" || x === "--no-hostname" || x === "-a" || x === "--all" || x === "-l" || x === "--full" || x === "-m" || x === "--merge") { if (x === "--no-hostname") o.noHost = true; if ((x === "-b" || x === "--boot") && /^-?\d+$/.test(a[i + 1] || "")) i++; }
      else if (x === "-xe" || x === "-xeu" || x === "-eu" || x === "-xu") { o.end = true; if (/u$/.test(x)) o.units.push(a[++i]); }
      else if (x === "--list-boots") { out(io, "IDX BOOT ID                          FIRST ENTRY                 LAST ENTRY\n  0 3f1c8e0a9b7d4e21a6c5d2f8e0b1a9c4 " + sdate(BOOT) + " " + sdate(sys.now) + "\n"); return 0; }
      else if (x === "--disk-usage") { out(io, "Archived and active journals take 56.0M in the file system.\n"); return 0; }
      else if (/^--vacuum-(size|time|files)/.test(x)) { if (sess.uid !== 0) { errl(io, "Failed to open /var/log/journal/3f1c8e0a9b7d4e21a6c5d2f8e0b1a9c4/: Permission denied"); return 1; } if (!/=/.test(x)) i++; out(io, "Vacuuming done, freed 0B of archived journals from /var/log/journal/3f1c8e0a9b7d4e21a6c5d2f8e0b1a9c4.\n"); return 0; }
      else if ((m = /^_SYSTEMD_UNIT=(.+)$/.exec(x))) o.units.push(m[1]); else if ((m = /^_PID=(\d+)$/.exec(x))) o.pid = +m[1]; else if ((m = /^SYSLOG_IDENTIFIER=(.+)$/.exec(x))) o.idents.push(m[1]);
      else if (x === "-h" || x === "--help") { out(io, "journalctl [OPTIONS...] [MATCHES...]\n\nQuery the journal.\n\nOptions:\n  -u --unit=UNIT             Show logs from the specified unit\n  -n --lines[=INTEGER]       Number of journal entries to show\n  -e --pager-end             Immediately jump to the end in the pager\n  -f --follow                Follow the journal\n  -r --reverse               Show the newest entries first\n  -p --priority=RANGE        Show entries with the specified priority (err, warning, info...)\n  -S --since=DATE            Show entries not older than the specified date\n  -U --until=DATE            Show entries not newer than the specified date\n  -k --dmesg                 Show kernel message log from the current boot\n  -t --identifier=STRING     Show entries with the specified syslog identifier\n  -o --output=STRING         Change journal output mode (short, short-iso, cat...)\n  -b --boot[=ID]             Show current boot or the specified boot\n     --disk-usage            Show total disk usage of all journal files\n"); return 0; }
      else if (/^-/.test(x)) { errl(io, "journalctl: unrecognized option '" + x + "'"); return 1; }
      else { errl(io, "Failed to add match '" + x + "': Invalid argument"); return 1; }
    }
    var list = journalSorted(sys);
    if (sess.uid !== 0 && sess.groups.indexOf(S.gidOf(sys, "adm")) < 0 && sess.groups.indexOf(S.gidOf(sys, "systemd-journal")) < 0) {
      errl(io, "Hint: You are currently not seeing messages from other users and the system.\n      Users in groups 'adm', 'systemd-journal' can see all messages.\n      Pass -q to turn off this notice.");
      list = [];
    }
    if (o.units.length) {
      var want = o.units.map(function (u) { var n = unitName(u); return ALIASES[n] && !findUnitFile(sys, n) ? ALIASES[n] : n; });
      list = list.filter(function (e) { return want.some(function (w) { return e.unit === w || (/[*?[]/.test(w) && e.unit && S.globMatch(w, e.unit)); }); });
    }
    if (o.kernel) list = list.filter(function (e) { return e.ident === "kernel"; });
    if (o.idents.length) list = list.filter(function (e) { return o.idents.indexOf(e.ident) >= 0; });
    if (o.pid) list = list.filter(function (e) { return e.pid === o.pid; });
    if (o.prio) {
      var pr = String(o.prio).split(".."), lo = pr.length > 1 ? pr[0] : "0", hi = pr.length > 1 ? pr[1] : pr[0];
      var toN = function (v) { return /^\d$/.test(v) ? +v : PRIO[v]; };
      if (toN(hi) === undefined || toN(lo) === undefined) { errl(io, "Failed to parse priority value: " + o.prio); return 1; }
      list = list.filter(function (e) { return e.prio <= toN(hi) && e.prio >= toN(lo); });
    }
    if (o.since) { var t1 = parseWhen(o.since, sys); if (t1 === null) { errl(io, "Failed to parse timestamp: " + o.since); return 1; } list = list.filter(function (e) { return e.t >= t1; }); }
    if (o.until) { var t2 = parseWhen(o.until, sys); if (t2 === null) { errl(io, "Failed to parse timestamp: " + o.until); return 1; } list = list.filter(function (e) { return e.t <= t2; }); }
    var n = o.n != null ? o.n : o.follow ? 10 : o.end ? 1000 : null;
    if (n != null) list = n === 0 ? [] : list.slice(-n);
    if (o.reverse) list = list.slice().reverse();
    if (!list.length) out(io, "-- No entries --\n");
    else out(io, joinLines(list.map(function (e) { var l = jline(sys, e, o.fmt); return o.noHost ? l.replace(" " + sys.host + " ", " ") : l; })));
    if (o.follow) note(io, "(journalctl -f keeps printing new messages as they arrive, until you press Ctrl+C. The lab shows what's there now.)");
    return 0;
  };

  /* ---------------- OnCalendar= and systemd-analyze */
  var DOWN = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6, sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 };
  var CAL_SHORT = { minutely: "*-*-* *:*:00", hourly: "*-*-* *:00:00", daily: "*-*-* 00:00:00", monthly: "*-*-01 00:00:00", weekly: "Mon *-*-* 00:00:00", yearly: "*-01-01 00:00:00", annually: "*-01-01 00:00:00", quarterly: "*-01,04,07,10-01 00:00:00", semiannually: "*-01,07-01 00:00:00" };
  function calField(f, min, max, w) {
    if (f === "*") return { vals: null, norm: "*" };
    var vals = [], norms = [];
    var items = f.split(",");
    for (var i = 0; i < items.length; i++) {
      var it = items[i], m = /^(\*|\d+)(?:\.\.(\d+))?(?:\/(\d+))?$/.exec(it);
      if (!m) return null;
      var a = m[1] === "*" ? min : +m[1], b = m[2] !== undefined ? +m[2] : m[3] !== undefined ? max : a, st = m[3] !== undefined ? +m[3] : 1;
      if (a < min || b > max || a > b || st < 1) return null;
      for (var v = a; v <= b; v += st) vals.push(v);
      var P = function (x) { return pad(x, w, "0"); };
      norms.push((m[1] === "*" ? "*" : P(a)) + (m[2] !== undefined ? ".." + P(b) : "") + (m[3] !== undefined ? "/" + m[3] : ""));
    }
    return { vals: vals, norm: norms.join(",") };
  }
  function parseCalendar(spec) {
    var s = String(spec).trim(), low = s.toLowerCase();
    if (CAL_SHORT[low]) s = CAL_SHORT[low];
    var parts = s.split(/\s+/).filter(function (x) { return x !== "UTC"; });
    var dow = null, dowNorm = "", date = "*-*-*", time = "00:00:00";
    if (parts.length && /^[A-Za-z]/.test(parts[0])) {
      var dp = parts.shift(), set = {};
      var ok = dp.split(",").every(function (item) {
        var r = item.split("..");
        var x = DOWN[r[0].toLowerCase()], y = r.length > 1 ? DOWN[r[1].toLowerCase()] : x;
        if (x === undefined || y === undefined) return false;
        for (var d = x; ; d = (d + 1) % 7) { set[d] = true; if (d === y) break; }
        return true;
      });
      if (!ok) return null;
      dow = set; dowNorm = dp.split(",").map(function (item) { return item.split("..").map(function (n) { var k = DOWN[n.toLowerCase()]; return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][k]; }).join(".."); }).join(",") + " ";
    }
    if (parts.length === 2) { date = parts[0]; time = parts[1]; }
    else if (parts.length === 1) { if (parts[0].indexOf(":") >= 0) time = parts[0]; else if (parts[0].indexOf("-") >= 0) date = parts[0]; else return null; }
    else if (parts.length > 2) return null;
    var dParts = date.split("-");
    if (dParts.length === 2) dParts.unshift("*");
    if (dParts.length !== 3) return null;
    var tParts = time.split(":");
    if (tParts.length === 2) tParts.push("00");
    if (tParts.length !== 3) return null;
    var Y = calField(dParts[0], 1970, 2199, 4), M = calField(dParts[1], 1, 12, 2), D = calField(dParts[2], 1, 31, 2), h = calField(tParts[0], 0, 23, 2), mi = calField(tParts[1], 0, 59, 2), se = calField(tParts[2], 0, 59, 2);
    if (!Y || !M || !D || !h || !mi || !se) return null;
    return { dow: dow, Y: Y.vals, M: M.vals, D: D.vals, h: h.vals || range(0, 23), m: mi.vals || range(0, 59), s: se.vals || range(0, 59), norm: dowNorm + Y.norm + "-" + M.norm + "-" + D.norm + " " + h.norm + ":" + mi.norm + ":" + se.norm };
  }
  function range(a, b) { var r = []; for (var i = a; i <= b; i++) r.push(i); return r; }
  function calNext(cal, from) {
    var start = new Date(from), day = Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate());
    for (var k = 0; k < 2200; k++, day += DAY) {
      var d = new Date(day);
      if (cal.Y && cal.Y.indexOf(d.getUTCFullYear()) < 0) continue;
      if (cal.M && cal.M.indexOf(d.getUTCMonth() + 1) < 0) continue;
      if (cal.D && cal.D.indexOf(d.getUTCDate()) < 0) continue;
      if (cal.dow && !cal.dow[d.getUTCDay()]) continue;
      for (var i = 0; i < cal.h.length; i++) for (var j = 0; j < cal.m.length; j++) for (var q = 0; q < cal.s.length; q++) {
        var t = day + ((cal.h[i] * 60 + cal.m[j]) * 60 + cal.s[q]) * 1000;
        if (t > from) return t;
      }
    }
    return null;
  }
  M2.parseCalendar = parseCalendar; M2.calNext = calNext; M2.timerNext = timerNext;
  CMDS["systemd-analyze"] = function (args, io, sess) {
    var a = args.slice(1), verb = a.shift(), iter = 1, specs = [];
    a.forEach(function (x) { var m = /^--iterations=(\d+)$/.exec(x); if (m) iter = +m[1]; else specs.push(x); });
    if (verb === "calendar") {
      if (!specs.length) { errl(io, "Too few arguments."); return 1; }
      var code = 0;
      specs.forEach(function (sp, k) {
        var cal = parseCalendar(sp);
        if (!cal) { errl(io, "Failed to parse calendar specification '" + sp + "': Invalid argument"); code = 1; return; }
        var L = [(k ? "\n" : "") + "  Original form: " + sp, "Normalized form: " + cal.norm];
        var t = sess.sys.now;
        for (var i = 0; i < iter; i++) {
          t = calNext(cal, t);
          if (!t) { L.push("    Next elapse: never"); break; }
          if (i === 0) { L.push("    Next elapse: " + sdate(t)); L.push("       From now: " + span(t - sess.sys.now) + " left"); }
          else L.push(pad("Iter. #" + (i + 1), 15) + ": " + sdate(t));
        }
        out(io, L.join("\n") + "\n");
      });
      return code;
    }
    if (verb === "verify") {
      var c2 = 0;
      specs.forEach(function (p) { var r = S.readFile(sess, p); if (r.error) { errl(io, "Failed to prepare filename " + p + ": " + ERR[r.error]); c2 = 1; return; } var ini = parseIni(r.content); var name = basename(p); if (/\.service$/.test(name) && !getv(ini, "Service", "ExecStart") && getv(ini, "Service", "Type") !== "oneshot") { errl(io, name + ": Service has no ExecStart=, ExecStop=, or SuccessAction=. Refusing."); c2 = 1; } if (/\.timer$/.test(name)) (ini.Timer && ini.Timer.OnCalendar || []).forEach(function (c) { if (!parseCalendar(c)) { errl(io, p + ":" + lineOf(r.content, c) + ": Failed to parse calendar specification, ignoring: " + c); c2 = 1; } }); });
      return c2;
    }
    if (!verb || verb === "time") { out(io, "Startup finished in 2.512s (kernel) + 6.904s (userspace) = 9.417s\ngraphical.target reached after 6.811s in userspace.\n"); return 0; }
    if (verb === "blame") { out(io, "3.021s cloud-init.service\n1.120s snapd.seeded.service\n 812ms kestrel-app.service\n 402ms nginx.service\n 210ms ssh.service\n"); return 0; }
    errl(io, "Unknown command verb '" + verb + "'.");
    return 1;
  };
  CMDS.timedatectl = function (args, io, sess) {
    if (args[1] && args[1] !== "status") { if (sess.uid !== 0) { errl(io, "Failed to " + args[1].replace("set-", "set ") + ": Interactive authentication required."); return 1; } return 0; }
    var t = sess.sys.now;
    out(io, "               Local time: " + sdate(t) + "\n           Universal time: " + sdate(t) + "\n                 RTC time: " + sdate(t).replace(" UTC", "") + "\n                Time zone: Etc/UTC (UTC, +0000)\nSystem clock synchronized: yes\n              NTP service: active\n          RTC in local TZ: no\n");
    return 0;
  };
  CMDS.hostnamectl = function (args, io, sess) {
    out(io, " Static hostname: " + sess.sys.host + "\n       Icon name: computer-vm\n         Chassis: vm 🖴\n      Machine ID: 3f1c8e0a9b7d4e21a6c5d2f8e0b1a9c4\n         Boot ID: 7a2e44d1c09b4f3c8d6a1e5b2c3f4a90\n  Virtualization: kvm\nOperating System: Ubuntu 24.04.1 LTS\n          Kernel: Linux 6.8.0-48-generic\n    Architecture: x86-64\n");
    return 0;
  };

  /* ================================================================== packages: apt and dpkg */
  function P(name, ver, o) { return Object.assign({ name: name, ver: ver, arch: "amd64", section: "utils", size: 120, desc: "", deps: [], bins: [], sbins: [], installed: false, auto: false, archive: "noble" }, o || {}); }
  var CATALOG = [
    P("nginx", "1.24.0-2ubuntu7.1", { newVer: "1.24.0-2ubuntu7.3", installed: true, section: "httpd", size: 1316, desc: "small, powerful, scalable web/proxy server", deps: ["nginx-common"], sbins: ["nginx"], service: "nginx.service", home: "https://nginx.org", conf: true }),
    P("nginx-common", "1.24.0-2ubuntu7.1", { newVer: "1.24.0-2ubuntu7.3", installed: true, arch: "all", section: "httpd", size: 194, desc: "small, powerful, scalable web/proxy server - common files", tiedTo: "nginx", auto: true, conf: true }),
    P("openssh-server", "1:9.6p1-3ubuntu13.5", { newVer: "1:9.6p1-3ubuntu13.8", installed: true, section: "net", size: 2012, desc: "secure shell (SSH) server, for secure access from remote machines", deps: ["openssh-client"], sbins: ["sshd"], service: "ssh.service", conf: true }),
    P("openssh-client", "1:9.6p1-3ubuntu13.5", { newVer: "1:9.6p1-3ubuntu13.8", installed: true, section: "net", size: 5428, desc: "secure shell (SSH) client, for secure access to remote machines", bins: ["ssh", "scp", "ssh-keygen", "ssh-copy-id", "sftp", "ssh-keyscan"] }),
    P("openssl", "3.0.13-0ubuntu3.4", { newVer: "3.0.13-0ubuntu3.5", installed: true, size: 2280, desc: "Secure Sockets Layer toolkit - cryptographic utility", deps: ["libssl3t64"], bins: ["openssl"] }),
    P("libssl3t64", "3.0.13-0ubuntu3.4", { newVer: "3.0.13-0ubuntu3.5", installed: true, section: "libs", size: 6600, desc: "Secure Sockets Layer toolkit - shared libraries", auto: true }),
    P("curl", "8.5.0-2ubuntu10.4", { newVer: "8.5.0-2ubuntu10.6", installed: true, section: "web", size: 534, desc: "command line tool for transferring data with URL syntax", deps: ["libcurl4t64"], bins: ["curl"] }),
    P("libcurl4t64", "8.5.0-2ubuntu10.4", { newVer: "8.5.0-2ubuntu10.6", installed: true, section: "libs", size: 836, desc: "easy-to-use client-side URL transfer library (OpenSSL flavour)", auto: true }),
    P("wget", "1.21.4-1ubuntu4.1", { installed: true, section: "web", size: 3734, desc: "retrieves files from the web", bins: ["wget"] }),
    P("rsync", "3.2.7-1ubuntu1", { installed: true, section: "net", size: 760, desc: "fast, versatile, remote (and local) file-copying tool", bins: ["rsync"] }),
    P("tar", "1.35+dfsg-3build1", { installed: true, size: 3048, desc: "GNU version of the tar archiving utility", bins: ["tar"] }),
    P("gzip", "1.12-1ubuntu3", { installed: true, size: 252, desc: "GNU compression utilities", bins: ["gzip", "gunzip", "zcat", "zgrep"] }),
    P("cron", "3.0pl1-184ubuntu2", { installed: true, section: "admin", size: 264, desc: "process scheduling daemon", bins: ["crontab"], sbins: ["cron"], service: "cron.service", conf: true }),
    P("procps", "2:4.0.4-4ubuntu3.2", { installed: true, section: "admin", size: 2200, desc: "/proc file system utilities", bins: ["ps", "top", "pgrep", "pkill", "kill", "free", "uptime", "w", "pidof", "watch"] }),
    P("psmisc", "23.7-1build1", { installed: true, size: 650, desc: "utilities that use the proc file system", bins: ["killall", "pstree"] }),
    P("iproute2", "6.1.0-1ubuntu6", { installed: true, section: "net", size: 3700, desc: "networking and traffic control tools", bins: ["ip", "ss"] }),
    P("iputils-ping", "3:20240117-1build1", { installed: true, section: "net", size: 120, desc: "Tools to test the reachability of network hosts", bins: ["ping"] }),
    P("bind9-dnsutils", "1:9.18.28-0ubuntu0.24.04.1", { installed: true, section: "net", size: 700, desc: "Clients provided with BIND 9", bins: ["dig", "nslookup"] }),
    P("bind9-host", "1:9.18.28-0ubuntu0.24.04.1", { installed: true, section: "net", size: 150, desc: "DNS Lookup Utility", bins: ["host"] }),
    P("netcat-openbsd", "1.226-1ubuntu2", { installed: true, section: "net", size: 110, desc: "TCP/IP swiss army knife", bins: ["nc"] }),
    P("lsof", "4.95.0-1build3", { installed: true, size: 460, desc: "utility to list open files", bins: ["lsof"] }),
    P("util-linux", "2.39.3-9ubuntu6.1", { installed: true, size: 4600, desc: "miscellaneous system utilities", bins: ["lsblk", "findmnt"] }),
    P("coreutils", "9.4-3ubuntu6", { installed: true, size: 7200, desc: "GNU core utilities", bins: ["truncate", "sha256sum", "md5sum", "nohup"] }),
    P("systemd", "255.4-1ubuntu8.4", { installed: true, section: "admin", size: 9800, desc: "system and service manager", bins: ["systemctl", "journalctl", "systemd-analyze", "timedatectl", "hostnamectl"] }),
    P("python3", "3.12.3-0ubuntu2", { installed: true, section: "python", size: 92, desc: "interactive high-level object-oriented language (default python3 version)" }),
    P("ufw", "0.36.2-6", { installed: true, section: "admin", arch: "all", size: 880, desc: "program for managing a Netfilter firewall", service: "ufw.service", conf: true }),
    P("rsyslog", "8.2312.0-3ubuntu9", { installed: true, section: "admin", size: 1700, desc: "reliable system and kernel logging daemon", service: "rsyslog.service", conf: true }),
    P("sudo", "1.9.15p5-3ubuntu5", { installed: true, section: "admin", size: 3900, desc: "Provide limited super user privileges to specific users", conf: true }),
    P("tree", "2.1.1-2ubuntu3", { size: 115, desc: "displays an indented directory tree, in color", bins: ["tree"] }),
    P("htop", "3.3.0-4build1", { size: 434, desc: "interactive processes viewer", deps: ["libnl-3-200", "libnl-genl-3-200"], bins: ["htop"] }),
    P("libnl-3-200", "3.7.0-0.3build1.1", { section: "libs", size: 200, desc: "library for dealing with netlink sockets" }),
    P("libnl-genl-3-200", "3.7.0-0.3build1.1", { section: "libs", size: 60, desc: "library for dealing with netlink sockets - generic netlink" }),
    P("jq", "1.7.1-3build1", { size: 102, desc: "lightweight and flexible command-line JSON processor", deps: ["libjq1"], bins: ["jq"] }),
    P("libjq1", "1.7.1-3build1", { section: "libs", size: 397, desc: "lightweight and flexible command-line JSON processor - shared library", deps: ["libonig5"] }),
    P("libonig5", "6.9.9-1build1", { section: "libs", size: 650, desc: "regular expressions library" }),
    P("ncdu", "1.19-0.1", { size: 101, desc: "ncurses disk usage viewer", bins: ["ncdu"] }),
    P("zip", "3.0-13ubuntu0.1", { size: 545, desc: "Archiver for .zip files", bins: ["zip"] }),
    P("unzip", "6.0-28ubuntu4.1", { size: 384, desc: "De-archiver for .zip files", bins: ["unzip"] }),
    P("net-tools", "2.10-0.1ubuntu4", { section: "net", size: 800, desc: "NET-3 networking toolkit", bins: ["netstat", "ifconfig"] }),
    P("redis-server", "5:7.0.15-1build2", { section: "database", size: 230, desc: "Persistent key-value database with network interface", deps: ["redis-tools"], bins: ["redis-server"], service: "redis-server.service", conf: true }),
    P("redis-tools", "5:7.0.15-1build2", { section: "database", size: 5700, desc: "Persistent key-value database with network interface (client)", bins: ["redis-cli"] }),
    P("apache2", "2.4.58-1ubuntu8.4", { section: "httpd", size: 465, desc: "Apache HTTP Server", sbins: ["apache2", "apachectl"], service: "apache2.service", conf: true }),
    P("fail2ban", "1.0.2-3ubuntu0.1", { section: "net", arch: "all", size: 2120, desc: "ban hosts that cause multiple authentication errors", bins: ["fail2ban-client", "fail2ban-server"], service: "fail2ban.service", conf: true })
  ];
  M2.CATALOG = CATALOG;
  function pkg(sys, name) { return sys.pkgs[String(name).replace(/:amd64$|:all$/, "")] || null; }
  function candidate(sys, p) { return sys.aptUpdated && p.newVer ? p.newVer : p.ver; }
  function upgradable(sys, p) { return p.installed && sys.aptUpdated && p.newVer && p.curVer !== p.newVer; }
  M2.pkg = pkg;
  function aptLockErr(io, update) {
    if (update) errl(io, "E: Could not open lock file /var/lib/apt/lists/lock - open (13: Permission denied)\nE: Unable to lock directory /var/lib/apt/lists/");
    else errl(io, "E: Could not open lock file /var/lib/dpkg/lock-frontend - open (13: Permission denied)\nE: Unable to acquire the dpkg frontend lock (/var/lib/dpkg/lock-frontend), are you root?");
    return 100;
  }
  var UNIT_FILES = {};   // package unit files and config, filled by the base hook
  function binPut(sys, path, impl) { putRoot(sys, path, "\x7fELF:" + impl + " (simulated binary)\n", 493, 0, 0, Date.UTC(2024, 3, 8)); }
  function installFiles(sys, p) {
    p.bins.forEach(function (b) { binPut(sys, "/usr/bin/" + b, b); });
    p.sbins.forEach(function (b) { binPut(sys, "/usr/sbin/" + b, b); });
    putRoot(sys, "/usr/share/doc/" + p.name + "/copyright", "Format: https://www.debian.org/doc/packaging-manuals/copyright-format/1.0/\nUpstream-Name: " + p.name + "\n");
    (PKG_FILES[p.name] || function () {})(sys, p);
  }
  function removeFiles(sys, p, purge) {
    p.bins.forEach(function (b) { rmRoot(sys, "/usr/bin/" + b); });
    p.sbins.forEach(function (b) { rmRoot(sys, "/usr/sbin/" + b); });
    rmRoot(sys, "/usr/share/doc/" + p.name);
    if (p.service) { rmRoot(sys, "/usr/lib/systemd/system/" + p.service); }
    if (purge && PKG_CONF[p.name]) PKG_CONF[p.name].forEach(function (f) { rmRoot(sys, f); });
  }
  var PKG_CONF = { nginx: ["/etc/nginx"], "nginx-common": ["/etc/nginx"], "redis-server": ["/etc/redis"], apache2: ["/etc/apache2"], fail2ban: ["/etc/fail2ban"], cron: [] };
  var PKG_FILES = {
    nginx: function (sys) {
      var nx = UNIT_FILES.nginxStock;
      if (!nodeAt(sys, "/etc/nginx/nginx.conf")) Object.keys(nx).forEach(function (f) { putRoot(sys, f, nx[f]); });
      mkdirRoot(sys, "/etc/nginx/conf.d"); mkdirRoot(sys, "/etc/nginx/modules-enabled"); mkdirRoot(sys, "/etc/nginx/sites-enabled");
      var se = nodeAt(sys, "/etc/nginx/sites-enabled");
      if (!Object.keys(se.children).length && !sys.nginxDefaultRemoved) se.children["default"] = S.linkNode("/etc/nginx/sites-available/default");
      putRoot(sys, "/var/www/html/index.nginx-debian.html", "<!DOCTYPE html>\n<html>\n<head>\n<title>Welcome to nginx!</title>\n</head>\n<body>\n<h1>Welcome to nginx!</h1>\n<p>If you see this page, the nginx web server is successfully installed and\nworking. Further configuration is required.</p>\n</body>\n</html>\n");
      var ld = mkdirRoot(sys, "/var/log/nginx", 493, S.uidOf(sys, "www-data"), S.gidOf(sys, "adm"));
      ["access.log", "error.log"].forEach(function (f) { if (!ld.children[f]) putRoot(sys, "/var/log/nginx/" + f, "", 416, S.uidOf(sys, "www-data"), S.gidOf(sys, "adm")); });
      putRoot(sys, "/usr/lib/systemd/system/nginx.service", UNIT_FILES["nginx.service"]);
    },
    "redis-server": function (sys) {
      if (!S.userByName(sys, "redis")) { writeRoot(sys, "/etc/passwd", "redis:x:110:113::/var/lib/redis:/usr/sbin/nologin\n", true); writeRoot(sys, "/etc/group", "redis:x:113:\n", true); }
      putRoot(sys, "/etc/redis/redis.conf", "bind 127.0.0.1 -::1\nprotected-mode yes\nport 6379\ndaemonize yes\nsupervised auto\nloglevel notice\nlogfile /var/log/redis/redis-server.log\ndatabases 16\n", 416, 110, 113);
      putRoot(sys, "/usr/lib/systemd/system/redis-server.service", "[Unit]\nDescription=Advanced key-value store\nAfter=network.target\nDocumentation=http://redis.io/documentation, man:redis-server(1)\n\n[Service]\nType=notify\nExecStart=/usr/bin/redis-server /etc/redis/redis.conf --supervised systemd --daemonize no\nUser=redis\nGroup=redis\nRuntimeDirectory=redis\n\n[Install]\nWantedBy=multi-user.target\nAlias=redis.service\n");
    },
    apache2: function (sys) {
      putRoot(sys, "/etc/apache2/apache2.conf", "# This is the main Apache server configuration file.\nServerRoot \"/etc/apache2\"\nInclude ports.conf\n");
      putRoot(sys, "/etc/apache2/ports.conf", "Listen 80\n\n<IfModule ssl_module>\n\tListen 443\n</IfModule>\n");
      putRoot(sys, "/var/www/html/index.html", "<!DOCTYPE html>\n<html><head><title>Apache2 Ubuntu Default Page: It works</title></head><body><h1>It works!</h1></body></html>\n");
      putRoot(sys, "/usr/lib/systemd/system/apache2.service", "[Unit]\nDescription=The Apache HTTP Server\nAfter=network.target remote-fs.target nss-lookup.target\nDocumentation=https://httpd.apache.org/docs/2.4/\n\n[Service]\nType=forking\nEnvironment=APACHE_STARTED_BY_SYSTEMD=true\nExecStart=/usr/sbin/apachectl start\nExecStop=/usr/sbin/apachectl graceful-stop\nExecReload=/usr/sbin/apachectl graceful\n\n[Install]\nWantedBy=multi-user.target\n");
    },
    fail2ban: function (sys) {
      putRoot(sys, "/etc/fail2ban/jail.conf", "[DEFAULT]\nbantime  = 10m\nfindtime  = 10m\nmaxretry = 5\n\n[sshd]\nport    = ssh\nlogpath = %(sshd_log)s\nbackend = %(sshd_backend)s\n");
      putRoot(sys, "/etc/fail2ban/jail.d/defaults-debian.conf", "[sshd]\nenabled = true\n");
      putRoot(sys, "/usr/lib/systemd/system/fail2ban.service", "[Unit]\nDescription=Fail2Ban Service\nDocumentation=man:fail2ban(1)\nAfter=network.target iptables.service firewalld.service ip6tables.service ipset.service nftables.service\n\n[Service]\nType=simple\nExecStartPre=/bin/mkdir -p /run/fail2ban\nExecStart=/usr/bin/fail2ban-server -xf start\nExecReload=/usr/bin/fail2ban-client reload\nRestart=on-failure\n\n[Install]\nWantedBy=multi-user.target\n");
    }
  };
  // apt install / remove / upgrade, as root
  function aptHeader(io) { out(io, "Reading package lists... Done\nBuilding dependency tree... Done\nReading state information... Done\n"); }
  function confirm(io, a) { if (a.yes) return; out(io, "Do you want to continue? [Y/n] Y\n"); note(io, "(apt asked whether to continue; the lab answered Y. In scripts, add -y so apt doesn't stop to ask.)"); }
  function notUpgradedCount(sys) { return Object.keys(sys.pkgs).filter(function (k) { return upgradable(sys, sys.pkgs[k]); }).length; }
  function sizeStr(kb) { return kb >= 1024 ? (kb / 1024).toFixed(1).replace(/\.0$/, "") + " MB" : commaNum(Math.round(kb)) + " kB"; }
  function debName(sys, p, ver) { return p.name + "_" + (ver || candidate(sys, p)).replace(/^\d+:/, "") + "_" + p.arch + ".deb"; }
  function logDpkg(sys, line) { writeRoot(sys, "/var/log/dpkg.log", ymd(sys.now) + " " + tod(sys.now) + " " + line + "\n", true); }
  function logHistory(sys, cmdline, user, kind, list) {
    writeRoot(sys, "/var/log/apt/history.log", "\nStart-Date: " + ymd(sys.now) + "  " + tod(sys.now) + "\nCommandline: " + cmdline + "\n" + (user ? "Requested-By: " + user.name + " (" + user.uid + ")\n" : "") + kind + ": " + list + "\nEnd-Date: " + ymd(sys.now) + "  " + tod(sys.now) + "\n", true);
  }
  function aptInstall(sys, names, io, a, sess) {
    var want = [], missing = [];
    names.forEach(function (n) { var p = pkg(sys, n); if (!p) missing.push(n); else want.push(p); });
    aptHeader(io);
    if (missing.length) { errl(io, "E: Unable to locate package " + missing[0]); return 100; }
    var newOnes = [], deps = [], upg = [], already = [];
    function add(p, isDep) {
      if (p.installed) { if (!isDep) { if (upgradable(sys, p) && !p.hold) upg.push(p); else already.push(p); } return; }
      if (newOnes.indexOf(p) >= 0 || deps.indexOf(p) >= 0) return;
      (isDep ? deps : newOnes).push(p);
      p.deps.forEach(function (d) { var dp = pkg(sys, d); if (dp) add(dp, true); });
    }
    want.forEach(function (p) { add(p, false); });
    already.forEach(function (p) { out(io, p.name + " is already the newest version (" + p.curVer + ").\n"); if (p.auto) { p.auto = false; out(io, p.name + " set to manually installed.\n"); } });
    var all = deps.concat(newOnes).sort(function (x, y) { return x.name < y.name ? -1 : 1; });
    if (deps.length) out(io, "The following additional packages will be installed:\n  " + deps.map(function (p) { return p.name; }).sort().join(" ") + "\n");
    if (all.length) out(io, "The following NEW packages will be installed:\n  " + all.map(function (p) { return p.name; }).join(" ") + "\n");
    if (upg.length) out(io, "The following packages will be upgraded:\n  " + upg.map(function (p) { return p.name; }).join(" ") + "\n");
    var nu = notUpgradedCount(sys) - upg.length;
    out(io, upg.length + " upgraded, " + all.length + " newly installed, 0 to remove and " + nu + " not upgraded.\n");
    if (!all.length && !upg.length) return 0;
    var dl = all.concat(upg).reduce(function (s, p) { return s + p.size * 0.38; }, 0), inst = all.reduce(function (s, p) { return s + p.size; }, 0);
    out(io, "Need to get " + sizeStr(dl) + " of archives.\nAfter this operation, " + sizeStr(inst + upg.length * 4) + " of additional disk space will be used.\n");
    if (deps.length || upg.length) confirm(io, a);
    all.concat(upg).forEach(function (p, i) { out(io, "Get:" + (i + 1) + " http://archive.ubuntu.com/ubuntu " + (p.newVer && sys.aptUpdated ? "noble-updates" : "noble") + "/" + (p.section === "libs" ? "main" : "main") + " " + p.arch + " " + p.name + " " + p.arch + " " + candidate(sys, p) + " [" + sizeStr(p.size * 0.38) + "]\n"); });
    out(io, "Fetched " + sizeStr(dl) + " in 0s (" + sizeStr(dl * 6) + "/s)\n");
    var dbCount = 74213;
    all.forEach(function (p, i) {
      out(io, "Selecting previously unselected package " + p.name + (p.arch === "all" ? "" : ":" + p.arch) + ".\n" + (i === 0 ? "(Reading database ... " + dbCount + " files and directories currently installed.)\n" : "(Reading database ... " + (dbCount + i * 7) + " files and directories currently installed.)\n") + "Preparing to unpack .../" + (i ? i + "-" : "") + debName(sys, p) + " ...\nUnpacking " + p.name + (p.arch === "all" ? "" : ":" + p.arch) + " (" + candidate(sys, p) + ") ...\n");
    });
    upg.forEach(function (p) { out(io, "Preparing to unpack .../" + debName(sys, p) + " ...\nUnpacking " + p.name + " (" + candidate(sys, p) + ") over (" + p.curVer + ") ...\n"); });
    var started = [];
    all.concat(upg).forEach(function (p) {
      var wasUpg = upg.indexOf(p) >= 0, oldV = p.curVer;
      p.installed = true; p.curVer = candidate(sys, p); p.removed = false; p.auto = deps.indexOf(p) >= 0;
      installFiles(sys, p);
      logDpkg(sys, (wasUpg ? "upgrade " : "install ") + p.name + ":" + p.arch + " " + (wasUpg ? oldV : "<none>") + " " + p.curVer);
      logDpkg(sys, "status installed " + p.name + ":" + p.arch + " " + p.curVer);
      out(io, "Setting up " + p.name + (p.arch === "all" ? "" : ":" + p.arch) + " (" + p.curVer + ") ...\n");
      if (p.service) {
        var u = loadUnit(sys, p.service);
        if (u) {
          if (!wasUpg) {
            var r = enableUnit(sys, u, { err: function (t) { out(io, t); } });
            var st = startUnit(sys, u, sess);
            if (!st.ok) { out(io, st.msg.replace(/^Job/, "Job") + "\ninvoke-rc.d: initscript " + p.service.replace(/\.service$/, "") + ", action \"start\" failed.\n"); started.push({ u: u, failed: true }); }
          } else if (u.rt.active === "active") { stopUnit(sys, u); startUnit(sys, u, sess); started.push({ u: u }); }
        }
      }
    });
    out(io, "Processing triggers for man-db (2.12.0-4build2) ...\n");
    if (all.some(function (p) { return p.service; }) || upg.length) out(io, "Scanning processes...\nScanning linux images...\n\nRunning kernel seems to be up-to-date.\n\n" + (started.filter(function (s) { return !s.failed; }).length ? "Restarting services...\n systemctl restart " + started.filter(function (s) { return !s.failed; }).map(function (s) { return s.u.name; }).join(" ") + "\n\n" : "No services need to be restarted.\n\n") + "No containers need to be restarted.\n\nNo user sessions are running outdated binaries.\n\nNo VM guests are running outdated hypervisor (qemu) binaries on this host.\n");
    if (all.length) logHistory(sys, a.cmdline, sess ? S.userByName(sys, sess.realUser || "dev") : null, "Install", all.map(function (p) { return p.name + ":" + p.arch + " (" + p.curVer + (p.auto ? ", automatic" : "") + ")"; }).join(", "));
    sys.actions.push("apt install " + names.join(" "));
    return 0;
  }
  function aptRemove(sys, names, io, a, purge) {
    aptHeader(io);
    var list = [], code = 0;
    names.forEach(function (n) {
      var p = pkg(sys, n);
      if (!p) { errl(io, "E: Unable to locate package " + n); code = 100; return; }
      if (!p.installed && !(purge && p.removed)) { out(io, "Package '" + p.name + "' is not installed, so not removed\n"); return; }
      list.push(p);
    });
    if (code) return code;
    var orphans = Object.keys(sys.pkgs).map(function (k) { return sys.pkgs[k]; }).filter(function (p) { return p.installed && p.auto && list.indexOf(p) < 0 && !Object.keys(sys.pkgs).some(function (k) { var q = sys.pkgs[k]; return q.installed && list.indexOf(q) < 0 && q.deps.indexOf(p.name) >= 0; }); });
    if (orphans.length) out(io, "The following packages were automatically installed and are no longer required:\n  " + orphans.map(function (p) { return p.name; }).join(" ") + "\nUse 'sudo apt autoremove' to remove them.\n");
    if (!list.length) { out(io, "0 upgraded, 0 newly installed, 0 to remove and " + notUpgradedCount(sys) + " not upgraded.\n"); return 0; }
    out(io, "The following packages will be REMOVED:\n  " + list.map(function (p) { return p.name + (purge ? "*" : ""); }).join(" ") + "\n0 upgraded, 0 newly installed, " + list.length + " to remove and " + notUpgradedCount(sys) + " not upgraded.\nAfter this operation, " + sizeStr(list.reduce(function (s, p) { return s + p.size; }, 0)) + " disk space will be freed.\n");
    confirm(io, a);
    out(io, "(Reading database ... 74213 files and directories currently installed.)\n");
    list.forEach(function (p) {
      if (p.installed) out(io, "Removing " + p.name + " (" + p.curVer + ") ...\n");
      if (p.service) { var u = loadUnit(sys, p.service); if (u) { stopUnit(sys, u); disableUnit(sys, u, { err: function () {} }); } }
      removeFiles(sys, p, purge);
      if (purge) out(io, "Purging configuration files for " + p.name + " (" + p.curVer + ") ...\n");
      logDpkg(sys, (purge ? "purge " : "remove ") + p.name + ":" + p.arch + " " + p.curVer + " <none>");
      p.installed = false; p.removed = !purge && !!p.conf; p.hold = false;
      if (p.service && sys.units[p.service]) delete sys.units[p.service];
    });
    out(io, "Processing triggers for man-db (2.12.0-4build2) ...\n");
    return 0;
  }
  function aptUpgrade(sys, io, a, full) {
    aptHeader(io);
    out(io, "Calculating upgrade... Done\n");
    var all = Object.keys(sys.pkgs).map(function (k) { return sys.pkgs[k]; }).filter(function (p) { return upgradable(sys, p); }).sort(function (x, y) { return x.name < y.name ? -1 : 1; });
    var held = all.filter(function (p) { return p.hold || (p.tiedTo && pkg(sys, p.tiedTo).hold); });
    var go = all.filter(function (p) { return held.indexOf(p) < 0; });
    if (held.length) out(io, "The following packages have been kept back:\n  " + held.map(function (p) { return p.name; }).join(" ") + "\n");
    if (go.length) out(io, "The following packages will be upgraded:\n  " + go.map(function (p) { return p.name; }).join(" ") + "\n");
    out(io, go.length + " upgraded, 0 newly installed, 0 to remove and " + held.length + " not upgraded.\n");
    if (!go.length) return 0;
    var dl = go.reduce(function (s, p) { return s + p.size * 0.38; }, 0);
    out(io, "Need to get " + sizeStr(dl) + " of archives.\nAfter this operation, " + sizeStr(go.length * 4) + " of additional disk space will be used.\n");
    confirm(io, a);
    go.forEach(function (p, i) { out(io, "Get:" + (i + 1) + " http://archive.ubuntu.com/ubuntu noble-updates/main " + p.arch + " " + p.name + " " + p.arch + " " + p.newVer + " [" + sizeStr(p.size * 0.38) + "]\n"); });
    out(io, "Fetched " + sizeStr(dl) + " in 1s (" + sizeStr(dl * 0.9) + "/s)\n(Reading database ... 74213 files and directories currently installed.)\n");
    var restarted = [];
    go.forEach(function (p) {
      out(io, "Preparing to unpack .../" + debName(sys, p, p.newVer) + " ...\nUnpacking " + p.name + (p.arch === "all" ? "" : ":" + p.arch) + " (" + p.newVer + ") over (" + p.curVer + ") ...\n");
    });
    go.forEach(function (p) {
      logDpkg(sys, "upgrade " + p.name + ":" + p.arch + " " + p.curVer + " " + p.newVer);
      logDpkg(sys, "status installed " + p.name + ":" + p.arch + " " + p.newVer);
      p.curVer = p.newVer;
      out(io, "Setting up " + p.name + (p.arch === "all" ? "" : ":" + p.arch) + " (" + p.curVer + ") ...\n");
      if (p.service) { var u = loadUnit(sys, p.service); if (u && u.rt.active === "active") { stopUnit(sys, u); startUnit(sys, u, null); restarted.push(u.name); } }
    });
    out(io, "Processing triggers for man-db (2.12.0-4build2) ...\nProcessing triggers for libc-bin (2.39-0ubuntu8.3) ...\nScanning processes...\nScanning linux images...\n\nRunning kernel seems to be up-to-date.\n\n" + (restarted.length ? "Restarting services...\n systemctl restart " + restarted.join(" ") + "\n\n" : "No services need to be restarted.\n\n") + "No containers need to be restarted.\n\nNo user sessions are running outdated binaries.\n\nNo VM guests are running outdated hypervisor (qemu) binaries on this host.\n");
    logHistory(sys, a.cmdline, null, "Upgrade", go.map(function (p) { return p.name + ":" + p.arch + " (" + p.ver + ", " + p.newVer + ")"; }).join(", "));
    sys.actions.push("apt upgrade");
    return 0;
  }
  function aptList(sys, io, pats, flags, isApt) {
    out(io, "Listing... Done\n");
    var rows = Object.keys(sys.pkgs).sort().map(function (k) { return sys.pkgs[k]; }).filter(function (p) {
      if (flags.installed && !p.installed) return false;
      if (flags.upgradable && !upgradable(sys, p)) return false;
      if (pats.length && !pats.some(function (x) { return S.globMatch(x, p.name); })) return false;
      return true;
    });
    rows.forEach(function (p) {
      var ver = p.installed ? (upgradable(sys, p) && !flags.installed ? p.newVer : p.curVer) : candidate(sys, p);
      var tags = [];
      if (p.installed) { tags.push("installed"); if (upgradable(sys, p)) tags = upgradable(sys, p) && flags.upgradable ? ["upgradable from: " + p.curVer] : ["installed", "upgradable to: " + p.newVer]; if (p.auto && !flags.upgradable) tags.push("automatic"); }
      else if (p.removed) tags.push("residual-config");
      var arc = p.newVer && sys.aptUpdated ? "noble-updates,noble-security" : "noble";
      out(io, p.name + "/" + arc + (p.installed && !flags.upgradable && !upgradable(sys, p) ? ",now" : "") + " " + (flags.upgradable ? p.newVer : ver) + " " + p.arch + (tags.length ? " [" + tags.join(",") + "]" : "") + "\n");
    });
    return 0;
  }
  function aptShow(sys, io, names) {
    var code = 0;
    names.forEach(function (n) {
      var p = pkg(sys, n);
      if (!p) { errl(io, "N: Unable to locate package " + n + "\nE: No packages found"); code = 100; return; }
      out(io, "Package: " + p.name + "\nVersion: " + (p.installed ? p.curVer : candidate(sys, p)) + "\nPriority: optional\nSection: " + p.section + "\nOrigin: Ubuntu\nMaintainer: Ubuntu Developers <ubuntu-devel-discuss@lists.ubuntu.com>\nInstalled-Size: " + sizeStr(p.size) + "\n" + (p.deps.length ? "Depends: " + p.deps.join(", ") + "\n" : "") + (p.home ? "Homepage: " + p.home + "\n" : "") + "Download-Size: " + sizeStr(p.size * 0.38) + "\nAPT-Sources: http://archive.ubuntu.com/ubuntu noble/main " + p.arch + " Packages\nDescription: " + p.desc + "\n\n");
      if (p.installed) out(io, "N: There is 1 additional record. Please use the '-a' switch to see it\n\n");
    });
    return code;
  }
  function aptPolicy(sys, io, names) {
    names.forEach(function (n) {
      var p = pkg(sys, n);
      if (!p) { errl(io, "N: Unable to locate package " + n); return; }
      var cand = candidate(sys, p);
      out(io, p.name + ":\n  Installed: " + (p.installed ? p.curVer : "(none)") + "\n  Candidate: " + cand + "\n  Version table:\n");
      if (sys.aptUpdated && p.newVer) out(io, (p.installed && p.curVer === p.newVer ? " *** " : "     ") + p.newVer + " 500\n        500 http://archive.ubuntu.com/ubuntu noble-updates/main amd64 Packages\n" + (p.installed && p.curVer === p.newVer ? "        100 /var/lib/dpkg/status\n" : ""));
      if (p.installed && p.curVer !== p.ver && p.curVer !== p.newVer) out(io, " *** " + p.curVer + " 100\n        100 /var/lib/dpkg/status\n");
      out(io, (p.installed && p.curVer === p.ver ? " *** " : "     ") + p.ver + " 500\n        500 http://archive.ubuntu.com/ubuntu noble/main amd64 Packages\n" + (p.installed && p.curVer === p.ver ? "        100 /var/lib/dpkg/status\n" : ""));
    });
    return 0;
  }
  function aptCmd(name) {
    return function (args, io, sess) {
      var sys = sess.sys, a = { yes: false, cmdline: args.join(" ") }, rest = [], flags = {};
      args.slice(1).forEach(function (x) {
        if (x === "-y" || x === "--yes" || x === "--assume-yes" || x === "-qy" || x === "-yq") a.yes = true;
        else if (x === "-q" || x === "-qq" || x === "--quiet" || x === "--no-install-recommends" || x === "-f" || x === "--fix-broken") return;
        else if (x === "--installed") flags.installed = true; else if (x === "--upgradable") flags.upgradable = true; else if (x === "--purge") flags.purge = true; else if (x === "--only-upgrade") flags.onlyUpgrade = true;
        else if (x === "-a" || x === "--all-versions") flags.allv = true;
        else rest.push(x);
      });
      var verb = rest.shift();
      if (!verb) { out(io, (name === "apt" ? "apt 2.7.14 (amd64)\nUsage: apt [options] command\n\napt is a commandline package manager and provides commands for\nsearching and managing as well as querying information about packages.\n\nMost used commands:\n  list - list packages based on package names\n  search - search in package descriptions\n  show - show package details\n  install - install packages\n  remove - remove packages\n  autoremove - automatically remove all unused packages\n  update - update list of available packages\n  upgrade - upgrade the system by installing/upgrading packages\n  full-upgrade - upgrade the system by removing/installing/upgrading packages\n" : "apt 2.7.14 (amd64)\nUsage: apt-get [options] command\n")); return name === "apt" ? 1 : 0; }
      if (name === "apt" && !io.tty && /^(list|search|show|install|remove|upgrade|update|purge|policy)$/.test(verb)) errl(io, "\nWARNING: apt does not have a stable CLI interface. Use with caution in scripts.\n");
      var rootOnly = /^(install|remove|purge|update|upgrade|full-upgrade|dist-upgrade|autoremove|clean|autoclean|reinstall)$/.test(verb);
      if (rootOnly && sess.uid !== 0) return aptLockErr(io, verb === "update");
      switch (verb) {
        case "update":
          var first = !sys.aptUpdated;
          out(io, "Hit:1 http://archive.ubuntu.com/ubuntu noble InRelease\n" + (first ? "Get:2 http://archive.ubuntu.com/ubuntu noble-updates InRelease [126 kB]\nHit:3 http://archive.ubuntu.com/ubuntu noble-backports InRelease\nGet:4 http://security.ubuntu.com/ubuntu noble-security InRelease [126 kB]\nGet:5 http://archive.ubuntu.com/ubuntu noble-updates/main amd64 Packages [742 kB]\nGet:6 http://security.ubuntu.com/ubuntu noble-security/main amd64 Packages [541 kB]\nFetched 1,535 kB in 1s (1,812 kB/s)\n" : "Hit:2 http://archive.ubuntu.com/ubuntu noble-updates InRelease\nHit:3 http://archive.ubuntu.com/ubuntu noble-backports InRelease\nHit:4 http://security.ubuntu.com/ubuntu noble-security InRelease\n") + "Reading package lists... Done\n");
          sys.aptUpdated = true;
          if (name === "apt") { var n = notUpgradedCount(sys); out(io, "Building dependency tree... Done\nReading state information... Done\n" + (n ? n + " packages can be upgraded. Run 'apt list --upgradable' to see them.\n" : "All packages are up to date.\n")); }
          sys.actions.push("apt update");
          return 0;
        case "install": case "reinstall":
          if (!rest.length) { aptHeader(io); out(io, "0 upgraded, 0 newly installed, 0 to remove and " + notUpgradedCount(sys) + " not upgraded.\n"); return 0; }
          if (rest.some(function (x) { return /\.deb$/.test(x); })) { errl(io, "E: Unsupported file " + rest[0] + " given on commandline"); return 100; }
          return aptInstall(sys, rest, io, a, sess);
        case "remove": case "purge": return aptRemove(sys, rest, io, a, verb === "purge" || flags.purge);
        case "autoremove":
          var orph = Object.keys(sys.pkgs).map(function (k) { return sys.pkgs[k]; }).filter(function (p) { return p.installed && p.auto && !Object.keys(sys.pkgs).some(function (k) { var q = sys.pkgs[k]; return q.installed && q.deps.indexOf(p.name) >= 0; }); });
          if (!orph.length) { aptHeader(io); out(io, "0 upgraded, 0 newly installed, 0 to remove and " + notUpgradedCount(sys) + " not upgraded.\n"); return 0; }
          return aptRemove(sys, orph.map(function (p) { return p.name; }), io, a, flags.purge);
        case "upgrade": return aptUpgrade(sys, io, a, false);
        case "full-upgrade": case "dist-upgrade": return aptUpgrade(sys, io, a, true);
        case "list": return aptList(sys, io, rest, flags, true);
        case "show": return aptShow(sys, io, rest);
        case "policy": return aptPolicy(sys, io, rest);
        case "search":
          if (name === "apt") out(io, "Sorting... Done\nFull Text Search... Done\n");
          var q = (rest[0] || "").toLowerCase();
          Object.keys(sys.pkgs).sort().forEach(function (k) { var p = sys.pkgs[k]; if (p.name.indexOf(q) >= 0 || p.desc.toLowerCase().indexOf(q) >= 0) out(io, name === "apt" ? p.name + "/noble " + candidate(sys, p) + " " + p.arch + (p.installed ? " [installed]" : "") + "\n  " + p.desc + "\n\n" : p.name + " - " + p.desc + "\n"); });
          return 0;
        case "clean": case "autoclean":
          var d = nodeAt(sys, "/var/cache/apt/archives"); if (d) Object.keys(d.children).forEach(function (k) { if (/\.deb$/.test(k)) delete d.children[k]; });
          return 0;
        default:
          errl(io, "E: Invalid operation " + verb); return 100;
      }
    };
  }
  CMDS.apt = aptCmd("apt");
  CMDS["apt-get"] = aptCmd("apt-get");
  CMDS["apt-cache"] = function (args, io, sess) {
    var verb = args[1], rest = args.slice(2);
    if (verb === "policy") return aptPolicy(sess.sys, io, rest);
    if (verb === "show") return aptShow(sess.sys, io, rest);
    if (verb === "search") return aptCmd("apt-cache")(["apt-cache", "search"].concat(rest), io, sess);
    if (verb === "depends") { var p = pkg(sess.sys, rest[0]); if (!p) { errl(io, "E: No packages found"); return 100; } out(io, p.name + "\n" + p.deps.map(function (d) { return "  Depends: " + d + "\n"; }).join("")); return 0; }
    errl(io, "E: Invalid operation " + verb); return 100;
  };
  CMDS["apt-mark"] = function (args, io, sess) {
    var sys = sess.sys, verb = args[1], names = args.slice(2);
    if (verb === "showhold") { Object.keys(sys.pkgs).sort().forEach(function (k) { if (sys.pkgs[k].hold) out(io, k + "\n"); }); return 0; }
    if (verb === "showmanual" || verb === "showauto") { Object.keys(sys.pkgs).sort().forEach(function (k) { var p = sys.pkgs[k]; if (p.installed && (verb === "showauto") === !!p.auto) out(io, k + "\n"); }); return 0; }
    if (!/^(hold|unhold|auto|manual)$/.test(verb || "")) { errl(io, "E: Invalid operation " + verb); return 100; }
    if (sess.uid !== 0) { errl(io, "E: Could not create temporary file for /var/lib/apt/extended_states - mkstemp (13: Permission denied)\nE: Failed to write temporary StateFile /var/lib/apt/extended_states"); return 100; }
    var code = 0;
    names.forEach(function (n) {
      var p = pkg(sys, n);
      if (!p) { errl(io, "E: Unable to locate package " + n); code = 100; return; }
      if (verb === "hold") { if (p.hold) out(io, p.name + " was already set on hold.\n"); else { p.hold = true; out(io, p.name + " set on hold.\n"); } }
      else if (verb === "unhold") { if (!p.hold) out(io, p.name + " was already not on hold.\n"); else { p.hold = false; out(io, "Canceled hold on " + p.name + ".\n"); } }
      else { p.auto = verb === "auto"; out(io, p.name + " set to " + (verb === "auto" ? "automatically" : "manually") + " installed.\n"); }
    });
    return code;
  };
  function pkgFiles(sys, p) {
    var f = ["/.", "/usr", "/usr/share", "/usr/share/doc", "/usr/share/doc/" + p.name, "/usr/share/doc/" + p.name + "/copyright"];
    if (p.bins.length) f.push("/usr/bin"); p.bins.forEach(function (b) { f.push("/usr/bin/" + b); });
    if (p.sbins.length) f.push("/usr/sbin"); p.sbins.forEach(function (b) { f.push("/usr/sbin/" + b); });
    if (p.service) f.push("/usr/lib/systemd/system/" + p.service);
    (PKG_CONF[p.name] || []).forEach(function (d) { f.push(d); });
    if (p.bins.length) { f.push("/usr/share/man", "/usr/share/man/man1"); p.bins.forEach(function (b) { f.push("/usr/share/man/man1/" + b + ".1.gz"); }); }
    if (p.name === "nginx-common") f.push("/etc/nginx/nginx.conf", "/etc/nginx/mime.types", "/etc/nginx/sites-available/default", "/var/www/html/index.nginx-debian.html");
    return f;
  }
  CMDS.dpkg = function (args, io, sess) {
    var sys = sess.sys, a = args.slice(1), op = a[0], rest = a.slice(1);
    if (/^-l/.test(op) && op.length > 2) rest = [op.slice(2)].concat(rest), op = "-l";
    if (op === "-l" || op === "--list") {
      var rows = Object.keys(sys.pkgs).sort().map(function (k) { return sys.pkgs[k]; }).filter(function (p) { return (p.installed || p.removed) && (!rest.length || rest.some(function (x) { return S.globMatch(x, p.name); })); });
      if (!rows.length) { errl(io, "dpkg-query: no packages found matching " + rest.join(" ")); return 1; }
      out(io, "Desired=Unknown/Install/Remove/Purge/Hold\n| Status=Not/Inst/Conf-files/Unpacked/halF-conf/Half-inst/trig-aWait/Trig-pend\n|/ Err?=(none)/Reinst-required (Status,Err: uppercase=bad)\n||/ Name                 Version                      Architecture Description\n+++-====================-============================-============-==================================================\n");
      rows.forEach(function (p) { out(io, (p.installed ? (p.hold ? "hi" : "ii") : "rc") + "  " + rpad(p.name, 20) + " " + rpad(p.curVer || p.ver, 28) + " " + rpad(p.arch, 12) + " " + p.desc + "\n"); });
      return 0;
    }
    if (op === "-L" || op === "--listfiles") {
      var code = 0;
      rest.forEach(function (n) { var p = pkg(sys, n); if (!p || !p.installed) { errl(io, "dpkg-query: package '" + n + "' is not installed\nUse dpkg --contents (= dpkg-deb --contents) to list archive files contents."); code = 1; return; } out(io, joinLines(pkgFiles(sys, p))); });
      return code;
    }
    if (op === "-S" || op === "--search") {
      var pat = rest[0] || "", hits = [];
      Object.keys(sys.pkgs).sort().forEach(function (k) { var p = sys.pkgs[k]; if (!p.installed) return; pkgFiles(sys, p).forEach(function (f) { if (f === "/." || /^\/usr(\/share(\/doc|\/man(\/man1)?)?|\/bin|\/sbin)?$/.test(f)) return; if (pat.charAt(0) === "/" ? f === pat.replace(/\/+$/, "") || (/[*?]/.test(pat) && S.globMatch(pat, f)) : f.indexOf(pat) >= 0) hits.push(p.name + ": " + f); }); });
      var r = pat.charAt(0) === "/" ? nodeAt(sys, pat, true) : null;
      if (!hits.length && r && r.type === "l") { var real = S.lookup(rootView(sys), pat).path; Object.keys(sys.pkgs).forEach(function (k) { var p = sys.pkgs[k]; if (p.installed && pkgFiles(sys, p).indexOf(real) >= 0) hits.push(p.name + ": " + real); }); }
      if (!hits.length) { errl(io, "dpkg-query: no path found matching pattern " + pat); return 1; }
      out(io, joinLines(hits));
      return 0;
    }
    if (op === "-s" || op === "--status") {
      var c2 = 0;
      rest.forEach(function (n) { var p = pkg(sys, n); if (!p || (!p.installed && !p.removed)) { errl(io, "dpkg-query: package '" + n + "' is not installed and no information is available\nUse dpkg --info (= dpkg-deb --info) to examine archive files."); c2 = 1; return; } out(io, "Package: " + p.name + "\nStatus: " + (p.hold ? "hold" : "install") + " ok " + (p.installed ? "installed" : "config-files") + "\nPriority: optional\nSection: " + p.section + "\nInstalled-Size: " + p.size + "\nMaintainer: Ubuntu Developers <ubuntu-devel-discuss@lists.ubuntu.com>\nArchitecture: " + p.arch + "\nVersion: " + (p.curVer || p.ver) + "\n" + (p.deps.length ? "Depends: " + p.deps.join(", ") + "\n" : "") + "Description: " + p.desc + "\n"); });
      return c2;
    }
    if (op === "--get-selections") { Object.keys(sys.pkgs).sort().forEach(function (k) { var p = sys.pkgs[k]; if (p.installed || p.removed) out(io, rpad(k, 48) + (p.hold ? "hold" : p.installed ? "install" : "deinstall") + "\n"); }); return 0; }
    if (op === "-i" || op === "--install" || op === "-r" || op === "--remove" || op === "-P" || op === "--purge") {
      if (sess.uid !== 0) { errl(io, "dpkg: error: requested operation requires superuser privilege"); return 2; }
      if (op === "-i" || op === "--install") { errl(io, "dpkg: error: cannot access archive '" + (rest[0] || "") + "': No such file or directory"); return 2; }
      return aptRemove(sys, rest, io, { yes: true, cmdline: args.join(" ") }, op === "-P" || op === "--purge");
    }
    if (op === "--version") { out(io, "Debian 'dpkg' package management program version 1.22.6 (amd64).\n"); return 0; }
    errl(io, "dpkg: error: need an action option\n\nType dpkg --help for help about installing and deinstalling packages [*];\nUse 'apt' or 'aptitude' for user-friendly package management;\nType dpkg -Dhelp for a list of dpkg debug flag values;\nType dpkg --force-help for a list of forcing options;\nType dpkg-deb --help for help about manipulating *.deb files;\n\nOptions marked [*] produce a lot of output - pipe it through 'less' or 'more' !");
    return 2;
  };
  CMDS["dpkg-query"] = function (args, io, sess) { return CMDS.dpkg(["dpkg"].concat(args.slice(1)), io, sess); };
  // Ubuntu's command-not-found: suggest the package that has the command.
  S.notFound = function (sess, name) {
    var sys = sess.sys;
    if (!sys.pkgs) return null;
    for (var k in sys.pkgs) {
      var p = sys.pkgs[k];
      if (!p.installed && (p.bins.indexOf(name) >= 0 || p.sbins.indexOf(name) >= 0)) return "Command '" + name + "' not found, but can be installed with:\nsudo apt install " + p.name;
    }
    return null;
  };

  /* ================================================================== disks */
  var MOUNTS = [
    { src: "tmpfs", target: "/run", fstype: "tmpfs", size: 404664, used: 1088, opts: "rw,nosuid,nodev,noexec,relatime,size=404664k,mode=755,inode64" },
    { src: "/dev/vda1", target: "/", fstype: "ext4", size: 40581564, used: 31212800, opts: "rw,relatime,discard,errors=remount-ro", dyn: true, uuid: "8b4c1d2e-6f3a-4e5b-9c7d-0a1b2c3d4e5f", label: "cloudimg-rootfs" },
    { src: "tmpfs", target: "/dev/shm", fstype: "tmpfs", size: 2022816, used: 0, opts: "rw,nosuid,nodev,inode64" },
    { src: "tmpfs", target: "/run/lock", fstype: "tmpfs", size: 5120, used: 0, opts: "rw,nosuid,nodev,noexec,relatime,size=5120k,inode64" },
    { src: "/dev/vda15", target: "/boot/efi", fstype: "vfat", size: 106832, used: 6250, opts: "rw,relatime,fmask=0077,dmask=0077,codepage=437,iocharset=iso8859-1,shortname=mixed,errors=remount-ro", uuid: "4E2B-91D0", label: "UEFI" },
    { src: "/dev/vdb", target: "/srv/backups", fstype: "ext4", size: 103081248, used: 41232500, opts: "rw,relatime", dyn: true, uuid: "c7f3e9a1-2b4d-4f6e-8a0c-1d3e5f7a9b2c", label: "" },
    { src: "tmpfs", target: "/run/user/1000", fstype: "tmpfs", size: 404660, used: 12, opts: "rw,nosuid,nodev,relatime,size=404660k,nr_inodes=101165,mode=700,uid=1000,gid=1000,inode64" }
  ];
  function mountOf(sys, path) { var best = null; sys.mounts.forEach(function (m) { if ((path === m.target || path.indexOf(m.target === "/" ? "/" : m.target + "/") === 0) && (!best || m.target.length > best.target.length)) best = m; }); return best; }
  function sizedBytes(sys, m) {
    var total = 0;
    var start = nodeAt(sys, m.target);
    if (!start) return 0;
    (function walk(n, path) {
      if (n.type === "d") { Object.keys(n.children).forEach(function (k) { var p = (path === "/" ? "" : path) + "/" + k; var mm = mountOf(sys, p); if (mm !== m) return; walk(n.children[k], p); }); return; }
      if (n.type === "f" && n.size != null) total += n.size;
    })(start, m.target);
    sys.openFiles.forEach(function (f) { if (f.node.size != null && mountOf(sys, f.path) === m && procByPid(sys, f.pid) && nodeAt(sys, f.path) !== f.node && sys.openFiles.indexOf(f) === sys.openFiles.findIndex(function (g) { return g.node === f.node; })) total += f.node.size; });
    return total;
  }
  function mountUsage(sys, m) {
    var used = m.used + (m.dyn ? Math.ceil(sizedBytes(sys, m) / 1024) : 0);
    if (m.dyn) used = Math.min(used, m.size - 16384);
    var avail = Math.max(0, m.size - used - (m.dyn ? 16384 : 0));
    return { size: m.size, used: used, avail: avail, pct: used + avail ? Math.ceil(used / (used + avail) * 100) : 0 };
  }
  M2.mountOf = mountOf; M2.mountUsage = mountUsage;
  function openFor(sys, pid, path) { var n = nodeAt(sys, path); if (n) sys.openFiles.push({ pid: pid, path: path, node: n, fd: 3 + sys.openFiles.filter(function (f) { return f.pid === pid; }).length }); }
  M2.openFor = openFor;
  CMDS.df = function (args, io, sess) {
    var sys = sess.sys, a = args.slice(1), h = false, H = false, T = false, inodes = false, total = false, only = null, excl = [], paths = [];
    for (var i = 0; i < a.length; i++) {
      var x = a[i];
      if (x === "-t" || x === "--type") only = a[++i]; else if (/^--type=/.test(x)) only = x.slice(7); else if (x === "-x" || x === "--exclude-type") excl.push(a[++i]); else if (/^--exclude-type=/.test(x)) excl.push(x.slice(15));
      else if (x === "--total") total = true; else if (x === "--help") return U.help(io, "df");
      else if (/^-[hHTiklaP]+$/.test(x)) { if (x.indexOf("h") >= 0) h = true; if (x.indexOf("H") >= 0) H = true; if (x.indexOf("T") >= 0) T = true; if (x.indexOf("i") >= 0) inodes = true; }
      else if (/^-/.test(x)) { errl(io, "df: invalid option -- '" + x.replace(/^-+/, "").charAt(0) + "'\nTry 'df --help' for more information."); return 1; }
      else paths.push(x);
    }
    var code = 0, rows = sys.mounts.slice();
    if (paths.length) {
      rows = [];
      paths.forEach(function (p) { var r = S.lookup(sess, p); if (r.error && r.error !== "EACCES") { errl(io, "df: " + p + ": No such file or directory"); code = 1; return; } var m = mountOf(sys, r.path || S.absPath(sess, p)); if (m && rows.indexOf(m) < 0) rows.push(m); });
    }
    if (only) rows = rows.filter(function (m) { return m.fstype === only; });
    if (excl.length) rows = rows.filter(function (m) { return excl.indexOf(m.fstype) < 0; });
    function hum(k) { if (H) { var v = k * 1024, u = ["", "k", "M", "G", "T"], j = 0; while (v >= 1000 && j < 4) { v /= 1000; j++; } return j === 0 ? String(Math.round(v)) : (v < 10 ? (Math.ceil(v * 10) / 10).toFixed(1) : String(Math.ceil(v))) + u[j]; } return k === 0 ? "0" : human(k * 1024); }
    var L = [];
    if (inodes) {
      L.push("Filesystem      Inodes  IUsed   IFree IUse% Mounted on");
      rows.forEach(function (m) { var tot = Math.round(m.size / 16), used = Math.round(mountUsage(sys, m).used / 160); L.push(rpad(m.src, 15) + " " + pad(tot, 7) + " " + pad(used, 6) + " " + pad(tot - used, 7) + " " + pad(Math.ceil(used / tot * 100) + "%", 5) + " " + m.target); });
    } else if (h || H) {
      L.push("Filesystem      " + (T ? "Type   " : "") + "Size  Used Avail Use% Mounted on");
      rows.forEach(function (m) { var u = mountUsage(sys, m); L.push(rpad(m.src, 15) + " " + (T ? rpad(m.fstype, 6) + " " : "") + pad(hum(u.size), 4) + " " + pad(hum(u.used), 5) + " " + pad(hum(u.avail), 5) + " " + pad(u.pct + "%", 4) + " " + m.target); });
    } else {
      L.push("Filesystem     " + (T ? "Type  " : "") + "1K-blocks     Used Available Use% Mounted on");
      rows.forEach(function (m) { var u = mountUsage(sys, m); L.push(rpad(m.src, 14) + " " + (T ? rpad(m.fstype, 5) + " " : "") + pad(u.size, 9) + " " + pad(u.used, 8) + " " + pad(u.avail, 9) + " " + pad(u.pct + "%", 4) + " " + m.target); });
    }
    if (total && !inodes) { var t = rows.reduce(function (s, m) { var u = mountUsage(sys, m); s.size += u.size; s.used += u.used; s.avail += u.avail; return s; }, { size: 0, used: 0, avail: 0 }); var pct = Math.ceil(t.used / (t.used + t.avail) * 100) + "%"; L.push(h || H ? rpad("total", 15) + " " + (T ? rpad("-", 6) + " " : "") + pad(hum(t.size), 4) + " " + pad(hum(t.used), 5) + " " + pad(hum(t.avail), 5) + " " + pad(pct, 4) + " -" : rpad("total", 14) + " " + (T ? rpad("-", 5) + " " : "") + pad(t.size, 9) + " " + pad(t.used, 8) + " " + pad(t.avail, 9) + " " + pad(pct, 4) + " -"); }
    if (rows.length || !paths.length) out(io, joinLines(L));
    return code;
  };
  CMDS.lsblk = function (args, io, sess) {
    var sys = sess.sys, f = args.indexOf("-f") >= 0 || args.indexOf("--fs") >= 0, d = args.indexOf("-d") >= 0 || args.indexOf("--nodeps") >= 0;
    var root = mountUsage(sys, sys.mounts[1]), bk = mountUsage(sys, sys.mounts[5]);
    if (f) {
      out(io, "NAME    FSTYPE   FSVER LABEL           UUID                                 FSAVAIL FSUSE% MOUNTPOINTS\nloop0   squashfs 4.0                                                           0   100% /snap/core20/2318\nloop1   squashfs 4.0                                                           0   100% /snap/lxd/29351\nloop2   squashfs 4.0                                                           0   100% /snap/snapd/21759\nvda                                                                                     \n" + (d ? "" : "├─vda1  ext4     1.0   cloudimg-rootfs 8b4c1d2e-6f3a-4e5b-9c7d-0a1b2c3d4e5f " + pad(human(root.avail * 1024), 7) + " " + pad(root.pct + "%", 6) + " /\n├─vda14                                                                                 \n└─vda15 vfat     FAT32 UEFI            4E2B-91D0                              98.6M     6% /boot/efi\n") + "vdb     ext4     1.0                   c7f3e9a1-2b4d-4f6e-8a0c-1d3e5f7a9b2c " + pad(human(bk.avail * 1024), 7) + " " + pad(bk.pct + "%", 6) + " /srv/backups\n" + (sys.extraDisk ? "vdc                                                                                     \n" : ""));
      return 0;
    }
    out(io, "NAME    MAJ:MIN RM  SIZE RO TYPE MOUNTPOINTS\nloop0     7:0    0 63.9M  1 loop /snap/core20/2318\nloop1     7:1    0   87M  1 loop /snap/lxd/29351\nloop2     7:2    0 38.8M  1 loop /snap/snapd/21759\nvda     252:0    0   40G  0 disk \n" + (d ? "" : "├─vda1  252:1    0 39.9G  0 part /\n├─vda14 252:14   0    4M  0 part \n└─vda15 252:15   0  106M  0 part /boot/efi\n") + "vdb     252:16   0  100G  0 disk /srv/backups\n" + (sys.extraDisk ? "vdc     252:32   0   20G  0 disk \n" : ""));
    return 0;
  };
  CMDS.findmnt = function (args, io, sess) {
    var sys = sess.sys, target = args.slice(1).filter(function (x) { return x.charAt(0) !== "-"; })[0];
    var rows = target ? sys.mounts.filter(function (m) { return m.target === target || m.src === target; }) : sys.mounts;
    if (!rows.length) return 1;
    var w = Math.max.apply(null, rows.map(function (m) { return m.target.length; }).concat([6]));
    out(io, rpad("TARGET", w) + " SOURCE     FSTYPE OPTIONS\n" + rows.map(function (m) { return rpad(m.target, w) + " " + rpad(m.src, 10) + " " + rpad(m.fstype, 6) + " " + m.opts; }).join("\n") + "\n");
    return 0;
  };
  CMDS.mount = function (args, io, sess) {
    if (args.length === 1 || args[1] === "-l" || /^-t$/.test(args[1])) { out(io, joinLines(sess.sys.mounts.map(function (m) { return m.src + " on " + m.target + " type " + m.fstype + " (" + m.opts + ")"; }))); return 0; }
    if (sess.uid !== 0) { errl(io, "mount: only root can do that"); return 1; }
    note(io, "(The lab's disks are already mounted. Module 2 lab 4 shows how mounts fit together.)");
    return 0;
  };
  CMDS.umount = function (args, io, sess) { if (sess.uid !== 0) { errl(io, "umount: " + (args[1] || "") + ": must be superuser to unmount."); return 32; } errl(io, "umount: " + (args[1] || "") + ": target is busy."); return 32; };
  CMDS.truncate = function (args, io, sess) {
    var a = args.slice(1), size = null, noCreate = false, files = [];
    for (var i = 0; i < a.length; i++) { if (a[i] === "-s" || a[i] === "--size") size = a[++i]; else if (/^-s./.test(a[i])) size = a[i].slice(2); else if (/^--size=/.test(a[i])) size = a[i].slice(7); else if (a[i] === "-c" || a[i] === "--no-create") noCreate = true; else files.push(a[i]); }
    if (size === null) { errl(io, "truncate: you must specify either '--size' or '--reference'\nTry 'truncate --help' for more information."); return 1; }
    if (!files.length) { errl(io, "truncate: missing file operand\nTry 'truncate --help' for more information."); return 1; }
    var m = /^([+-]?)(\d+(?:\.\d+)?)([KMGT]?)(i?B)?$/i.exec(size);
    if (!m) { errl(io, "truncate: Invalid number: '" + size + "'"); return 1; }
    var code = 0;
    files.forEach(function (f) {
      var r = S.lookup(sess, f);
      if (!r.node) { if (noCreate) return; var e = S.writeFile(sess, f, ""); if (e) { errl(io, "truncate: cannot open '" + f + "' for writing: " + ERR[e]); code = 1; return; } r = S.lookup(sess, f); }
      if (r.node.type === "d") { errl(io, "truncate: cannot open '" + f + "' for writing: Is a directory"); code = 1; return; }
      if (!S.can(sess, r.node, "w")) { errl(io, "truncate: cannot open '" + f + "' for writing: Permission denied"); code = 1; return; }
      var bytesN = Math.round(+m[2] * Math.pow(1024, " KMGT".indexOf((m[3] || " ").toUpperCase()))), cur = U.nodeSize(r.node);
      var target = m[1] === "+" ? cur + bytesN : m[1] === "-" ? Math.max(0, cur - bytesN) : bytesN;
      if (target === 0) { r.node.content = ""; delete r.node.size; }
      else if (target < bytes(r.node.content)) { r.node.content = r.node.content.slice(0, target); delete r.node.size; }
      else r.node.size = target;
      r.node.mtime = sess.sys.now;
    });
    return code;
  };
  CMDS.lsof = function (args, io, sess) {
    var sys = sess.sys, a = args.slice(1), o = {};
    for (var i = 0; i < a.length; i++) { var x = a[i]; if (x === "+L1") o.deleted = true; else if (x === "-i") { o.inet = true; if (a[i + 1] && /^[:@\w]/.test(a[i + 1]) && !/^\//.test(a[i + 1])) o.inetSpec = a[++i]; } else if (/^-i./.test(x)) { o.inet = true; o.inetSpec = x.slice(2); } else if (x === "-p") o.pid = +a[++i]; else if (x === "-u") o.user = a[++i]; else if (x === "-n" || x === "-P" || x === "-nP" || x === "-Pn") o.numeric = true; else if (x === "-t") o.terse = true; else o.path = x; }
    var visible = sys.procs.filter(function (p) { return sess.uid === 0 || p.uid === sess.uid; });
    var rows = [];
    if (o.inet) {
      visible.forEach(function (p) {
        (p.listen || []).forEach(function (s) {
          var port = o.inetSpec ? /:(\d+)$/.exec(o.inetSpec) : null;
          if (port && +port[1] !== s.port) return;
          var named = { 22: "ssh", 80: "http", 443: "https", 53: "domain", 6379: "redis", 8080: "http-alt" };
          var addr = (s.addr === "0.0.0.0" || s.addr === "*" ? "*" : s.addr) + ":" + (!o.numeric && named[s.port] ? named[s.port] : s.port);
          rows.push([p.comm.slice(0, 9), p.pid, S.uname(sys, p.uid), "6u", /\[/.test(s.addr) ? "IPv6" : "IPv4", 21003 + p.pid % 900, "0t0", "TCP", addr + " (LISTEN)"]);
        });
      });
    } else {
      sys.openFiles.forEach(function (f) {
        var p = procByPid(sys, f.pid); if (!p || visible.indexOf(p) < 0) return;
        var del = nodeAt(sys, f.path) !== f.node;
        if (o.deleted && !del) return;
        if (o.pid && p.pid !== o.pid) return;
        if (o.user && S.uname(sys, p.uid) !== o.user) return;
        if (o.path && S.normAbs(S.absPath(sess, o.path)) !== f.path) return;
        rows.push([p.comm.slice(0, 9), p.pid, S.uname(sys, p.uid), f.fd + "w", "REG", "252,1", U.nodeSize(f.node), del ? 0 : 1, 1048601 + f.fd, f.path + (del ? " (deleted)" : "")]);
      });
      if (o.path && !rows.length) { var rp = S.lookup(sess, o.path); if (rp.error) { errl(io, "lsof: status error on " + o.path + ": No such file or directory"); errl(io, "lsof 4.95.0\n latest revision: https://github.com/lsof-org/lsof\n latest FAQ: https://github.com/lsof-org/lsof/blob/master/00FAQ\n usage: [-?abhKlnNoOPRtUvVX] [+|-c c] [+|-d s] [+D D] [+|-E] [+|-e s] [+|-f[gG]] [-F [f]] [-g [s]] [-i [i]] [+|-L [l]] [+m [m]] [+|-M] [-o [o]] [-p s] [+|-r [t]] [-s [p:s]] [-S [t]] [-T [t]] [-u s] [+|-w] [-x [fl]] [--] [names]"); } return 1; }
    }
    if (!rows.length) return 1;
    if (o.terse) { out(io, joinLines(rows.map(function (r) { return String(r[1]); }).filter(function (v, i, arr) { return arr.indexOf(v) === i; }))); return 0; }
    var head = o.inet ? ["COMMAND", "PID", "USER", "FD", "TYPE", "DEVICE", "SIZE/OFF", "NODE", "NAME"] : ["COMMAND", "PID", "USER", "FD", "TYPE", "DEVICE", "SIZE/OFF", "NLINK", "NODE", "NAME"];
    var all = [head].concat(rows), w = head.map(function (h, k) { return Math.max.apply(null, all.map(function (r) { return String(r[k]).length; })); });
    out(io, joinLines(all.map(function (r) { return r.map(function (v, k) { return k === r.length - 1 ? v : k === 0 || k === 2 || k === 4 ? rpad(v, w[k]) : pad(v, w[k]); }).join(" "); })));
    return 0;
  };
  CMDS.ncdu = function (args, io, sess) {
    note(io, "(ncdu is an interactive, full-screen disk-usage browser: arrows to move, Enter to open a folder, d to delete, q to quit. Here's the same idea as a plain command:)");
    return CMDS.du(["du", "-h", "--max-depth=1", args[1] || "."], io, sess);
  };
  CMDS.watch = function (args, io, sess) {
    var a = args.slice(1), every = "2.0";
    while (a.length && /^-/.test(a[0])) { var x = a.shift(); if (x === "-n" || x === "--interval") every = (+a.shift()).toFixed(1); else if (/^-n/.test(x)) every = (+x.slice(2)).toFixed(1); }
    if (!a.length) { errl(io, "Usage:\n watch [options] command"); return 1; }
    out(io, "Every " + every + "s: " + a.join(" ") + "    " + sess.sys.host + ": " + WDAY[new Date(sess.sys.now).getUTCDay()] + " " + MON[new Date(sess.sys.now).getUTCMonth()] + " " + new Date(sess.sys.now).getUTCDate() + " " + tod(sess.sys.now) + " 2026\n\n");
    var code = S.runSource(sess, a.join(" "), io);
    note(io, "(watch reruns the command every " + every + " seconds, full-screen, until Ctrl+C. The lab shows one run.)");
    return code;
  };

  /* ================================================================== cron */
  var CRON_SPECIAL = { "@yearly": "0 0 1 1 *", "@annually": "0 0 1 1 *", "@monthly": "0 0 1 * *", "@weekly": "0 0 * * 0", "@daily": "0 0 * * *", "@midnight": "0 0 * * *", "@hourly": "0 * * * *" };
  var MONN = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"], DOWNS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
  function cronField(f, min, max, names) {
    var vals = {};
    var ok = f.split(",").every(function (item) {
      var m = /^(\*|[0-9a-z]+(?:-[0-9a-z]+)?)(?:\/(\d+))?$/i.exec(item);
      if (!m) return false;
      var toN = function (v) { if (/^\d+$/.test(v)) return +v; var i = names ? names.indexOf(v.toLowerCase().slice(0, 3)) : -1; return i < 0 || v.length !== 3 ? NaN : i + min; };
      var a, b;
      if (m[1] === "*") { a = min; b = max; }
      else { var r = m[1].split("-"); a = toN(r[0]); b = r.length > 1 ? toN(r[1]) : m[2] ? max : a; }
      if (isNaN(a) || isNaN(b) || a < min || b > max || a > b) return false;
      var st = m[2] ? +m[2] : 1; if (st < 1) return false;
      for (var v = a; v <= b; v += st) vals[v] = true;
      return true;
    });
    return ok ? Object.keys(vals).map(Number).sort(function (x, y) { return x - y; }) : null;
  }
  function cronLine(line, withUser) {
    var l = line.trim();
    if (!l || l.charAt(0) === "#") return { blank: true };
    if (/^[A-Za-z_][A-Za-z0-9_]*\s*=/.test(l)) return { env: true };
    var parts, i = 0, special = null;
    if (l.charAt(0) === "@") {
      var m = /^(@\w+)\s+(.*)$/.exec(l);
      if (!m) return { err: "bad time specifier" };
      if (m[1] === "@reboot") { var rest = m[2]; if (withUser) { var um = /^(\S+)\s+(.*)$/.exec(rest); if (!um) return { err: "bad username" }; return { reboot: true, user: um[1], cmd: um[2] }; } return { reboot: true, cmd: rest }; }
      if (!CRON_SPECIAL[m[1]]) return { err: "bad time specifier" };
      special = m[1]; l = CRON_SPECIAL[m[1]] + " " + m[2];
    }
    parts = l.split(/\s+/);
    var names = ["minute", "hour", "day-of-month", "month", "day-of-week"], specs = [[0, 59], [0, 23], [1, 31], [1, 12, MONN], [0, 7, DOWNS]], f = [];
    for (i = 0; i < 5; i++) {
      if (parts[i] === undefined) return { err: "bad " + names[i] };
      var v = cronField(parts[i], specs[i][0], specs[i][1], specs[i][2]);
      if (!v) return { err: "bad " + names[i] };
      f.push(v);
    }
    if (f[4].indexOf(7) >= 0) { f[4] = f[4].filter(function (x) { return x !== 7; }); if (f[4].indexOf(0) < 0) f[4].unshift(0); }
    var restParts = parts.slice(5), user = null;
    if (withUser) { user = restParts.shift(); if (!user) return { err: "bad username" }; }
    var cmd = l.replace(/^(\S+\s+){5}/, ""); if (withUser) cmd = cmd.replace(/^\S+\s+/, "");
    if (!restParts.length) return { err: "bad command" };
    return { min: f[0], hour: f[1], dom: f[2], mon: f[3], dow: f[4], domStar: parts[2] === "*", dowStar: parts[4] === "*", cmd: cmd, user: user, special: special, raw: line };
  }
  function cronMatches(e, t) {
    var d = new Date(t);
    if (e.min.indexOf(d.getUTCMinutes()) < 0 || e.hour.indexOf(d.getUTCHours()) < 0 || e.mon.indexOf(d.getUTCMonth() + 1) < 0) return false;
    var domHit = e.dom.indexOf(d.getUTCDate()) >= 0, dowHit = e.dow.indexOf(d.getUTCDay()) >= 0;
    if (e.domStar || e.dowStar) return domHit && dowHit;
    return domHit || dowHit;
  }
  function cronNext(e, from, n) {
    var res = [], t = Math.floor(from / MIN) * MIN + MIN;
    for (var k = 0; k < 600000 && res.length < (n || 1); k++, t += MIN) if (cronMatches(e, t)) res.push(t);
    return n ? res : res[0] || null;
  }
  var CRONDIR = "/var/spool/cron/crontabs";
  function crontabOf(sys, user) { var c = rd(sys, CRONDIR + "/" + user); return c === null ? null : c.replace(/^# DO NOT EDIT THIS FILE[^\n]*\n# \([^\n]*\n# \(Cron version[^\n]*\n/, ""); }
  function cronEntries(sys, user) { var c = crontabOf(sys, user); if (c === null) return []; return c.split("\n").map(function (l) { return cronLine(l, false); }).filter(function (e) { return !e.blank && !e.env && !e.err; }); }
  M2.cron = { parse: cronLine, matches: cronMatches, next: cronNext, crontab: crontabOf, entries: cronEntries, field: cronField };
  CMDS.crontab = function (args, io, sess) {
    var sys = sess.sys, a = args.slice(1), user = sess.user, mode = null, file = null;
    for (var i = 0; i < a.length; i++) {
      var x = a[i];
      if (x === "-u") { user = a[++i]; if (sess.uid !== 0 && user !== sess.user) { errl(io, "must be privileged to use -u"); return 1; } if (!S.userByName(sys, user)) { errl(io, "crontab: user `" + user + "' unknown"); return 1; } }
      else if (x === "-l" || x === "-e" || x === "-r") mode = x; else if (x === "-i") continue; else if (/^-[ler]+$/.test(x)) mode = "-" + x.slice(-1);
      else if (/^-./.test(x)) { errl(io, "crontab: invalid option -- '" + x.slice(1) + "'\ncrontab: usage error: unrecognized option\nusage:\tcrontab [-u user] file\n\tcrontab [ -u user ] [ -i ] { -e | -l | -r }"); return 1; }
      else file = x;
    }
    var spool = CRONDIR + "/" + user;
    if (mode === "-l") { var c = crontabOf(sys, user); if (c === null) { errl(io, "no crontab for " + user); return 1; } out(io, c); return 0; }
    if (mode === "-r") { if (rd(sys, spool) === null) { errl(io, "no crontab for " + user); return 1; } rmRoot(sys, spool); jadd(sys, "crontab", sys.nextPid++, "(" + sess.user + ") DELETE (" + user + ")", "cron.service", 6); return 0; }
    if (mode === "-e") {
      note(io, "(crontab -e opens your crontab in an editor (nano) and installs it when you save and quit. This lab can't show full-screen editors. Add a line like this instead:\n  (crontab -l 2>/dev/null; echo \"30 2 * * * /home/dev/bin/job.sh\") | crontab -\nor write the lines to a file and run: crontab myfile)");
      errl(io, "crontab: no changes made to crontab");
      return 0;
    }
    if (file === null) { errl(io, "usage:\tcrontab [-u user] file\n\tcrontab [ -u user ] [ -i ] { -e | -l | -r }\n\t\t(default operation is replace, per 1003.2)\n\t-e\t(edit user's crontab)\n\t-l\t(list user's crontab)\n\t-r\t(delete user's crontab)\n\t-i\t(prompt before deleting user's crontab)"); return 1; }
    var text, label = file;
    if (file === "-") { text = io.stdin || ""; label = "-"; }
    else { var r = S.readFile(sess, file); if (r.error) { errl(io, file + ": " + ERR[r.error]); return 1; } text = r.content; }
    if (text !== "" && !/\n$/.test(text)) { errl(io, "new crontab file is missing newline before EOF, can't install."); return 1; }
    var ls = text.split("\n");
    for (var k = 0; k < ls.length; k++) { var e = cronLine(ls[k], false); if (e.err) { errl(io, "\"" + label + "\":" + (k + 1) + ": " + e.err + "\nerrors in crontab file, can't install."); return 1; } }
    mkdirRoot(sys, CRONDIR, 984, 0, S.gidOf(sys, "crontab"));
    putRoot(sys, spool, "# DO NOT EDIT THIS FILE - edit the master and reinstall.\n# (" + (file === "-" ? "-" : file) + " installed on " + WDAY[new Date(sys.now).getUTCDay()] + " " + MON[new Date(sys.now).getUTCMonth()] + " " + new Date(sys.now).getUTCDate() + " " + tod(sys.now) + " 2026)\n# (Cron version -- $Id: crontab.c,v 2.13 1994/01/17 03:20:37 vixie Exp $)\n" + text, 384, S.uidOf(sys, user), S.gidOf(sys, "crontab"));
    jadd(sys, "crontab", sys.nextPid++, "(" + sess.user + ") REPLACE (" + user + ")", "cron.service", 6);
    sys.actions.push("crontab install " + user);
    return 0;
  };

  /* ================================================================== archives: tar, gzip, zip */
  var TAR_MAGIC = "\0\0ustar  \0", GZ_MAGIC = "\x1f\x8b\x08\x00", ZIP_MAGIC = "PK\x03\x04", BZ_MAGIC = "BZh91AY&SY", XZ_MAGIC = "\xfd7zXZ\0";
  function b64e(s) { return btoa(unescape(encodeURIComponent(s))); }
  function b64d(s) { return decodeURIComponent(escape(atob(s))); }
  function packJSON(magic, obj) { return magic + b64e(JSON.stringify(obj)); }
  function unpackJSON(magic, content) { if (typeof content !== "string" || content.indexOf(magic) !== 0) return null; try { return JSON.parse(b64d(content.slice(magic.length))); } catch (e) { return null; } }
  function rawSize(c, s) { return s != null ? s : bytes(c); }
  function gzSizeOf(raw, text) { return Math.max(26, Math.round(raw * (text ? 0.27 : 0.9)) + 26); }
  function gzEncode(content, name, mtime, size) { return packJSON(GZ_MAGIC, { n: name, m: mtime, c: content, s: size }); }
  function gzDecode(content) { return unpackJSON(GZ_MAGIC, content) || unpackJSON(BZ_MAGIC, content) || unpackJSON(XZ_MAGIC, content); }
  M2.archive = { tar: function (c) { return unpackJSON(TAR_MAGIC, c); }, gz: gzDecode, zip: function (c) { return unpackJSON(ZIP_MAGIC, c); }, TAR_MAGIC: TAR_MAGIC, GZ_MAGIC: GZ_MAGIC };
  // read an archive: auto-detects gzip around the tar
  function readArchive(content) {
    var gz = gzDecode(content);
    var inner = gz ? gz.c : content;
    var t = unpackJSON(TAR_MAGIC, inner);
    return { entries: t, compressed: !!gz };
  }
  M2.readArchive = readArchive;
  // Build an archive for a lab: list of {p, c, mode, u, g, mt}; directories end with "/".
  M2.makeArchive = function (sys, path, list, o) {
    o = o || {};
    var entries = list.map(function (e) { var dir = /\/$/.test(e.p); return { p: e.p, t: dir ? "d" : "f", c: dir ? undefined : e.c, s: e.s, mode: e.mode || (dir ? 509 : 436), u: e.u || "dev", g: e.g || e.u || "dev", mt: e.mt || NOW - 10 * DAY }; });
    var tarText = packJSON(TAR_MAGIC, entries);
    var raw = entries.reduce(function (s, e) { return s + 512 + (e.t === "f" ? Math.ceil(rawSize(e.c, e.s) / 512) * 512 : 0); }, 1024), tarSize = Math.ceil(raw / 10240) * 10240;
    var gz = o.gz !== false, payload = entries.reduce(function (s, e) { return s + (e.t === "f" ? rawSize(e.c, e.s) : 0); }, 0);
    var blob = gz ? packJSON(GZ_MAGIC, { n: basename(path).replace(/\.(gz|tgz)$/, ""), m: o.mt || NOW - 10 * DAY, c: tarText, s: tarSize }) : tarText;
    var n = putRoot(sys, path, blob, o.mode || 436, S.uidOf(sys, o.owner || "dev"), S.gidOf(sys, o.owner || "dev"), o.mt || NOW - 10 * DAY);
    n.size = gz ? Math.max(45, Math.round(payload * 0.3) + 40 * entries.length) : tarSize;
    return n;
  };
  function at(sess, dir) { var o = Object.create(sess); o.cwd = dir; return o; }
  function setNodeMeta(sess, path, meta) {
    var r = S.lookup(sess, path, { nofollow: true }); if (!r.node) return;
    if (meta.mode != null) r.node.mode = sess.uid === 0 || meta.keepMode ? meta.mode : meta.mode & ~sess.umask & 4095;
    if (meta.mtime != null) r.node.mtime = meta.mtime;
    if (meta.size != null) r.node.size = meta.size; else if (meta.clearSize) delete r.node.size;
    if (sess.uid === 0 && meta.uid != null) { r.node.uid = meta.uid; r.node.gid = meta.gid; }
  }
  function ensureDirs(sess, path, io, prog) {
    var parts = S.splitPath(path), cur = path.charAt(0) === "/" ? "" : ".";
    for (var i = 0; i < parts.length; i++) {
      cur += "/" + parts[i];
      var r = S.lookup(sess, cur);
      if (r.node) { if (r.node.type !== "d") { errl(io, prog + ": " + cur + ": Cannot mkdir: Not a directory"); return false; } continue; }
      if (r.error !== "ENOENT" || !r.parent || !S.can(sess, r.parent, "w") || !S.can(sess, r.parent, "x")) { errl(io, prog + ": " + cur.replace(/^\.\//, "") + ": Cannot mkdir: Permission denied"); return false; }
      r.parent.children[r.name] = S.dirNode(509 & ~sess.umask, sess.uid, sess.gid, sess.sys.now);
    }
    return true;
  }
  CMDS.tar = function (args, io, sess) {
    var sys = sess.sys, a = args.slice(1), mode = null, comp = null, v = 0, file = null, dir = null, excludes = [], strip = 0, members = [], keepAbs = false, toOut = false, keepOld = false;
    if (a.length && a[0].charAt(0) !== "-" && /^[cxtrufzjJvpPOkaC]+$/.test(a[0])) a[0] = "-" + a[0];
    function setMode(m) { if (mode && mode !== m) throw new ShError("tar: You may not specify more than one '-Acdtrux', '--delete' or  '--test-label' option\nTry 'tar --help' or 'tar --usage' for more information.", 2); mode = m; }
    for (var i = 0; i < a.length; i++) {
      var x = a[i], m;
      if (x === "--") { members = members.concat(a.slice(i + 1)); break; }
      if (/^--/.test(x)) {
        if (x === "--create") setMode("c"); else if (x === "--extract" || x === "--get") setMode("x"); else if (x === "--list") setMode("t"); else if (x === "--append") setMode("r");
        else if (x === "--gzip" || x === "--gunzip" || x === "--ungzip") comp = "z"; else if (x === "--bzip2") comp = "j"; else if (x === "--xz") comp = "J"; else if (x === "--auto-compress") comp = "a";
        else if (x === "--verbose") v++; else if (x === "--absolute-names") keepAbs = true; else if (x === "--to-stdout") toOut = true; else if (x === "--keep-old-files") keepOld = true;
        else if ((m = /^--file=(.*)$/.exec(x))) file = m[1]; else if (x === "--file") file = a[++i];
        else if ((m = /^--directory=(.*)$/.exec(x))) dir = m[1]; else if (x === "--directory") dir = a[++i];
        else if ((m = /^--exclude=(.*)$/.exec(x))) excludes.push(m[1]); else if (x === "--exclude") excludes.push(a[++i]);
        else if ((m = /^--strip-components=(\d+)$/.exec(x))) strip = +m[1];
        else if (/^--(preserve-permissions|same-permissions|same-owner|no-same-owner|overwrite|totals|wildcards|numeric-owner|one-file-system)$/.test(x)) continue;
        else if (x === "--help") { out(io, "Usage: tar [OPTION...] [FILE]...\nGNU 'tar' saves many files together into a single tape or disk archive, and can\nrestore individual files from the archive.\n\nExamples:\n  tar -cf archive.tar foo bar  # Create archive.tar from files foo and bar.\n  tar -tvf archive.tar         # List all files in archive.tar verbosely.\n  tar -xf archive.tar          # Extract all files from archive.tar.\n\n  -c, --create               create a new archive\n  -x, --extract              extract files from an archive\n  -t, --list                 list the contents of an archive\n  -f, --file=ARCHIVE         use archive file ARCHIVE\n  -z, --gzip                 filter the archive through gzip\n  -v, --verbose              verbosely list files processed\n  -C, --directory=DIR        change to directory DIR\n      --exclude=PATTERN      exclude files matching PATTERN\n"); return 0; }
        else { errl(io, "tar: unrecognized option '" + x + "'\nTry 'tar --help' or 'tar --usage' for more information."); return 2; }
        continue;
      }
      if (x.charAt(0) === "-" && x.length > 1) {
        for (var k = 1; k < x.length; k++) {
          var c = x.charAt(k);
          if ("cxtru".indexOf(c) >= 0) setMode(c === "u" ? "r" : c);
          else if (c === "z" || c === "j" || c === "J" || c === "a") comp = c;
          else if (c === "v") v++; else if (c === "p" || c === "w") continue; else if (c === "P") keepAbs = true; else if (c === "O") toOut = true; else if (c === "k") keepOld = true;
          else if (c === "f" || c === "C") { var val = x.slice(k + 1); if (val === "") val = a[++i]; if (val === undefined) { errl(io, "tar: option requires an argument -- '" + c + "'\nTry 'tar --help' or 'tar --usage' for more information."); return 2; } if (c === "f") file = val; else dir = val; break; }
          else { errl(io, "tar: invalid option -- '" + c + "'\nTry 'tar --help' or 'tar --usage' for more information."); return 2; }
        }
        continue;
      }
      members.push(x);
    }
    if (!mode) { errl(io, "tar: You must specify one of the '-Acdtrux', '--delete' or '--test-label' options\nTry 'tar --help' or 'tar --usage' for more information."); return 2; }
    var base = dir ? S.absPath(sess, dir) : sess.cwd;
    if (dir) { var dr = S.lookup(sess, dir); if (!dr.node || dr.node.type !== "d") { errl(io, "tar: " + dir + ": Cannot open: " + (dr.node ? "Not a directory" : "No such file or directory") + "\ntar: Error is not recoverable: exiting now"); return 2; } }
    var bs = at(sess, base), code = 0;
    function excluded(name) { var b = basename(name); return excludes.some(function (p) { return S.globMatch(p, b) || S.globMatch(p, name) || S.globMatch(p, name.replace(/\/$/, "")); }); }
    if (mode === "c" || mode === "r") {
      if (!members.length) { errl(io, "tar: Cowardly refusing to create an empty archive\nTry 'tar --help' or 'tar --usage' for more information."); return 2; }
      if (!file) { errl(io, "tar: Refusing to write archive contents to terminal (missing -f option?)\ntar: Error is not recoverable: exiting now"); return 2; }
      var archAbs = S.absPath(sess, file), entries = [], warned = false;
      if (mode === "r") { var ex = S.readFile(sess, file); if (!ex.error) { var prev = readArchive(ex.content); if (prev.compressed) { errl(io, "tar: Cannot update compressed archives\nTry 'tar --help' or 'tar --usage' for more information."); return 2; } entries = prev.entries || []; } }
      members.forEach(function (mem) {
        var r = S.lookup(bs, mem, { nofollow: true });
        if (r.error) { errl(io, "tar: " + mem + ": Cannot stat: " + ERR[r.error]); code = 2; return; }
        var name = keepAbs ? mem : mem.replace(/^\/+/, "");
        if (name !== mem && !warned) { errl(io, "tar: Removing leading `/' from member names"); warned = true; }
        if (name === "") name = ".";
        (function walk(n, nm, absP) {
          if (excluded(nm)) return;
          if (absP === archAbs) { errl(io, "tar: " + nm + ": file is the archive; not dumped"); return; }
          var meta = { mode: n.mode & 4095, u: S.uname(sys, n.uid), g: S.gname(sys, n.gid), mt: n.mtime };
          if (n.type === "d") {
            var dn = nm.replace(/\/?$/, "/");
            entries.push(Object.assign({ p: dn, t: "d" }, meta));
            if (v) out(io, (v > 1 ? longLine(sys, entries[entries.length - 1]) : dn) + "\n");
            if (!S.can(sess, n, "r") || !S.can(sess, n, "x")) { errl(io, "tar: " + nm + ": Cannot open: Permission denied"); code = 2; return; }
            Object.keys(n.children).sort(S.sortNames).forEach(function (k) { walk(n.children[k], (nm === "." ? "." : nm.replace(/\/$/, "")) + "/" + k, absP.replace(/\/$/, "") + "/" + k); });
            return;
          }
          if (n.type === "l") { entries.push(Object.assign({ p: nm, t: "l", target: n.target }, meta)); if (v) out(io, nm + "\n"); return; }
          if (!S.can(sess, n, "r")) { errl(io, "tar: " + nm + ": Cannot open: Permission denied"); code = 2; return; }
          entries.push(Object.assign({ p: nm, t: "f", c: n.content, s: n.size }, meta));
          if (v) out(io, (v > 1 ? longLine(sys, entries[entries.length - 1]) : nm) + "\n");
        })(r.node, name, r.path);
      });
      var useGz = comp === "z" || (comp === "a" && /\.(tgz|tar\.gz)$/.test(file)), useBz = comp === "j" || (comp === "a" && /\.(tbz2?|tar\.bz2)$/.test(file)), useXz = comp === "J" || (comp === "a" && /\.(txz|tar\.xz)$/.test(file));
      var tarText = packJSON(TAR_MAGIC, entries);
      var rawBytes = entries.reduce(function (s, e) { return s + 512 + (e.t === "f" ? Math.ceil(rawSize(e.c, e.s) / 512) * 512 : 0); }, 1024);
      var tarSize = Math.ceil(rawBytes / 10240) * 10240;
      var blob = tarText, size = tarSize;
      if (useGz || useBz || useXz) {
        var textish = entries.every(function (e) { return e.t !== "f" || e.s == null; });
        blob = packJSON(useGz ? GZ_MAGIC : useBz ? BZ_MAGIC : XZ_MAGIC, { n: basename(file).replace(/\.(gz|tgz|bz2|xz)$/, ""), m: sys.now, c: tarText, s: tarSize });
        var payload = entries.reduce(function (s, e) { return s + (e.t === "f" ? rawSize(e.c, e.s) : 0); }, 0);
        size = Math.max(45, Math.round(payload * (textish ? 0.3 : 0.12)) + 40 * entries.length);
      }
      var we = S.writeFile(sess, file, blob);
      if (we) { errl(io, "tar: " + file + ": Cannot open: " + ERR[we] + "\ntar: Error is not recoverable: exiting now"); return 2; }
      var an = S.lookup(sess, file).node; an.size = size;
      sys.actions.push("tar create " + archAbs);
      if (code) errl(io, "tar: Exiting with failure status due to previous errors");
      return code;
    }
    // t and x read an archive
    var content;
    if (!file || file === "-") {
      if (io.pipedIn) content = io.stdin || "";
      else { errl(io, "tar: Refusing to read archive contents from terminal (missing -f option?)\ntar: Error is not recoverable: exiting now"); return 2; }
    } else {
      var rf = S.readFile(sess, file);
      if (rf.error) { errl(io, "tar: " + file + ": Cannot open: " + ERR[rf.error] + "\ntar: Error is not recoverable: exiting now"); return 2; }
      content = rf.content;
    }
    if (comp === "z" && !gzDecode(content)) { errl(io, "\ngzip: stdin: not in gzip format\ntar: Child returned status 1\ntar: Error is not recoverable: exiting now"); return 2; }
    var arch = readArchive(content);
    if (!arch.entries) { errl(io, "tar: This does not look like a tar archive\ntar: Exiting with failure status due to previous errors"); return 2; }
    var found = {};
    function wanted(e) {
      if (!members.length) return true;
      return members.some(function (mm) { var mn = mm.replace(/\/$/, ""), p = e.p.replace(/\/$/, ""); var hit = p === mn || p.indexOf(mn + "/") === 0 || (/[*?[]/.test(mm) && S.globMatch(mm, p)); if (hit) found[mm] = true; return hit; });
    }
    var list = arch.entries.filter(function (e) { return wanted(e) && !excluded(e.p); });
    if (mode === "t") {
      list.forEach(function (e) { out(io, (v ? longLine(sys, e) : e.p) + "\n"); });
    } else {
      list.forEach(function (e) {
        var parts = e.p.split("/").filter(Boolean);
        if (strip) { if (parts.length <= strip) return; parts = parts.slice(strip); }
        var rel = parts.join("/") + (e.t === "d" ? "/" : "");
        if (!rel || rel === "./") return;
        if (toOut) { if (e.t === "f") out(io, e.c); return; }
        if (v) out(io, (v > 1 ? longLine(sys, e) : e.p) + "\n");
        var target = (e.p.charAt(0) === "/" && keepAbs ? "" : base.replace(/\/$/, "") + "/") + rel.replace(/\/$/, "");
        var parent = target.slice(0, target.lastIndexOf("/")) || "/";
        if (!ensureDirs(sess, parent, io, "tar")) { code = 2; return; }
        var meta = { mode: e.mode, mtime: e.mt, uid: S.uidOf(sys, e.u), gid: S.gidOf(sys, e.g) };
        if (e.t === "d") {
          var rr = S.lookup(sess, target);
          if (!rr.node) { if (!ensureDirs(sess, target, io, "tar")) { code = 2; return; } }
          setNodeMeta(sess, target, meta);
          return;
        }
        if (e.t === "l") { var lr = S.lookup(sess, target, { nofollow: true }); if (lr.node) delete lr.parent.children[lr.name]; if (lr.parent) lr.parent.children[lr.name] = S.linkNode(e.target, sess.uid, sess.gid); return; }
        var exn = S.lookup(sess, target);
        if (exn.node && keepOld) { errl(io, "tar: " + rel + ": Cannot open: File exists"); code = 2; return; }
        var we2 = S.writeFile(sess, target, e.c || "");
        if (we2) { errl(io, "tar: " + rel + ": Cannot open: " + ERR[we2]); code = 2; return; }
        meta.size = e.s; meta.clearSize = e.s == null;
        setNodeMeta(sess, target, meta);
      });
      sys.actions.push("tar extract " + (file ? S.absPath(sess, file) : "-") + " -> " + base);
    }
    members.forEach(function (mm) { if (!found[mm]) { errl(io, "tar: " + mm + ": Not found in archive"); code = 2; } });
    if (code) errl(io, "tar: Exiting with failure status due to previous errors");
    return code;
  };
  function longLine(sys, e) {
    var mstr = (e.t === "d" ? "d" : e.t === "l" ? "l" : "-") + U.modeStr({ type: "f", mode: e.mode }).slice(1);
    var ug = e.u + "/" + e.g, sz = String(e.t === "f" ? rawSize(e.c, e.s) : 0), fill = Math.max(1, 19 - ug.length - sz.length);
    var d = new Date(e.mt);
    return mstr + " " + ug + new Array(fill + 1).join(" ") + sz + " " + ymd(e.mt) + " " + d2(d.getUTCHours()) + ":" + d2(d.getUTCMinutes()) + " " + e.p + (e.t === "l" ? " -> " + e.target : "");
  }
  function ratio(comp, raw) { return raw ? ((1 - Math.max(1, comp - 24) / raw) * 100).toFixed(1) + "%" : "0.0%"; }
  function gzipCmd(name) {
    return function (args, io, sess) {
      var p = opts(name, args, { flags: "dckflrvtqnN123456789", long: { decompress: "d", uncompress: "d", stdout: "c", "to-stdout": "c", keep: "k", force: "f", list: "l", recursive: "r", verbose: "v", test: "t", quiet: "q", best: "9", fast: "1" } });
      var o = p.o, dec = o.d || name === "gunzip" || name === "zcat", toOut = o.c || name === "zcat", code = 0;
      if (!p.rest.length) {
        if (!io.pipedIn && io.tty && !dec && !o.f) { errl(io, "gzip: compressed data not written to a terminal. Use -f to force compression.\nFor help, type: gzip -h"); return 1; }
        if (dec) { var g0 = gzDecode(io.stdin || ""); if (!g0) { errl(io, "gzip: stdin: not in gzip format"); return 1; } out(io, g0.c); return 0; }
        out(io, gzEncode(io.stdin || "", "", sess.sys.now));
        return 0;
      }
      if (o.l) out(io, "         compressed        uncompressed  ratio uncompressed_name\n");
      function one(f) {
        var r = S.lookup(sess, f);
        if (!r.node) { errl(io, name + ": " + f + ": No such file or directory"); code = 1; return; }
        if (r.node.type === "d") {
          if (o.r) { Object.keys(r.node.children).sort().forEach(function (k) { one(f.replace(/\/$/, "") + "/" + k); }); return; }
          errl(io, name + ": " + f + " is a directory -- ignored"); if (!code) code = 2; return;
        }
        if (!S.can(sess, r.node, "r")) { errl(io, name + ": " + f + ": Permission denied"); code = 1; return; }
        var n = r.node;
        if (o.l) { var gl = gzDecode(n.content); if (!gl) { errl(io, "gzip: " + f + ": not in gzip format"); code = 1; return; } var comp = U.nodeSize(n), unc = rawSize(gl.c, gl.s); out(io, pad(comp, 19) + " " + pad(unc, 19) + " " + pad(ratio(comp, unc), 6) + " " + f.replace(/\.gz$/, "") + "\n"); return; }
        if (o.t) { if (!gzDecode(n.content)) { errl(io, "gzip: " + f + ": not in gzip format"); code = 1; } return; }
        if (dec) {
          var m = /^(.*?)(\.gz|\.tgz|-gz|\.z|_z)$/i.exec(f);
          if (!m && !toOut) { errl(io, name + ": " + f + ": unknown suffix -- ignored"); if (!code) code = 2; return; }
          var g = gzDecode(n.content);
          if (!g) { errl(io, name + ": " + f + ": not in gzip format"); code = 1; return; }
          if (toOut) { out(io, g.c); return; }
          var target = m[2] === ".tgz" ? m[1] + ".tar" : m[1];
          if (S.lookup(sess, target).node && !o.f) { errl(io, name + ": " + target + " already exists; not overwritten"); if (!code) code = 2; return; }
          var we = S.writeFile(sess, target, g.c);
          if (we) { errl(io, name + ": " + target + ": " + ERR[we]); code = 1; return; }
          setNodeMeta(sess, target, { mode: n.mode & 4095, keepMode: true, mtime: n.mtime, size: g.s, clearSize: g.s == null });
          if (o.v) errl(io, f + ":\t" + pad(ratio(U.nodeSize(n), rawSize(g.c, g.s)), 6) + " -- replaced with " + target);
          if (!o.k) { if (!S.can(sess, r.parent, "w")) { errl(io, name + ": " + f + ": Permission denied"); code = 1; } else delete r.parent.children[r.name]; }
          return;
        }
        if (/\.(gz|tgz)$/.test(f)) { errl(io, "gzip: " + f + " already has ." + f.split(".").pop() + " suffix -- unchanged"); if (!code) code = 2; return; }
        var raw = U.nodeSize(n), blob = gzEncode(n.content, basename(f), n.mtime, n.size), csize = gzSizeOf(raw, n.size == null);
        if (toOut) { out(io, blob); return; }
        var tgt = f + ".gz";
        if (S.lookup(sess, tgt).node && !o.f) { errl(io, "gzip: " + tgt + " already exists; not overwritten"); if (!code) code = 2; return; }
        var we3 = S.writeFile(sess, tgt, blob);
        if (we3) { errl(io, "gzip: " + tgt + ": " + ERR[we3]); code = 1; return; }
        setNodeMeta(sess, tgt, { mode: n.mode & 4095, keepMode: true, mtime: n.mtime, size: csize });
        if (o.v) errl(io, f + ":\t" + pad(ratio(csize, raw), 6) + " -- " + (o.k ? "created " + tgt : "replaced with " + tgt));
        if (!o.k) { if (!S.can(sess, r.parent, "w")) { errl(io, "gzip: " + f + ": Permission denied"); code = 1; } else delete r.parent.children[r.name]; }
      }
      p.rest.forEach(one);
      if (code === 0 || code === 2) sess.sys.actions.push(name + " " + p.rest.join(" "));
      return code;
    };
  }
  CMDS.gzip = gzipCmd("gzip"); CMDS.gunzip = gzipCmd("gunzip"); CMDS.zcat = gzipCmd("zcat");
  CMDS.zgrep = function (args, io, sess) {
    var a = args.slice(1), optsA = [], pat = null, files = [];
    for (var i = 0; i < a.length; i++) { if (pat === null && /^-/.test(a[i])) { optsA.push(a[i]); if (/^-[ABCefm]$/.test(a[i])) optsA.push(a[++i]); } else if (pat === null) pat = a[i]; else files.push(a[i]); }
    if (pat === null) { errl(io, "Usage: zgrep [OPTION]... [-e] PATTERN [FILE]..."); return 2; }
    var code = 1;
    (files.length ? files : ["-"]).forEach(function (f) {
      var text;
      if (f === "-") text = io.stdin || ""; else { var r = S.readFile(sess, f); if (r.error) { errl(io, "gzip: " + f + ": " + ERR[r.error]); code = 2; return; } var g = gzDecode(r.content); text = g ? g.c : r.content; }
      var many = files.length > 1 && optsA.indexOf("-h") < 0;
      var c = CMDS.grep(["grep"].concat(optsA).concat([pat]), Object.assign({}, io, { stdin: text, pipedIn: true, out: many ? function (t) { io.out(t.split("\n").map(function (l, k, arr) { return k === arr.length - 1 && l === "" ? "" : f + ":" + l; }).join("\n")); } : io.out }), sess);
      if (c === 0 && code !== 2) code = 0;
    });
    return code;
  };
  CMDS.zip = function (args, io, sess) {
    var a = args.slice(1), rec = false, quiet = false, rest = [];
    a.forEach(function (x) { if (/^-[rqv9]+$/.test(x)) { if (x.indexOf("r") >= 0) rec = true; if (x.indexOf("q") >= 0) quiet = true; } else rest.push(x); });
    if (rest.length < 2) { errl(io, "\nzip error: Nothing to do! (" + (rest[0] || "") + ")"); return 12; }
    var zf = rest.shift(); if (!/\.zip$/.test(zf)) zf += ".zip";
    var entries = [], ex = S.readFile(sess, zf), code = 0;
    if (!ex.error) entries = (unpackJSON(ZIP_MAGIC, ex.content) || []);
    function addE(e, msg) { var i = entries.findIndex(function (x) { return x.p === e.p; }); if (i >= 0) { entries[i] = e; if (!quiet) out(io, "updating: " + e.p + " " + msg + "\n"); } else { entries.push(e); if (!quiet) out(io, "  adding: " + e.p + " " + msg + "\n"); } }
    rest.forEach(function (f) {
      var r = S.lookup(sess, f);
      if (!r.node) { errl(io, "\tzip warning: name not matched: " + f); code = 12; return; }
      (function walk(n, nm) {
        if (n.type === "d") { addE({ p: nm.replace(/\/?$/, "/"), t: "d", mode: n.mode & 4095, mt: n.mtime }, "(stored 0%)"); if (rec) Object.keys(n.children).sort(S.sortNames).forEach(function (k) { walk(n.children[k], nm.replace(/\/$/, "") + "/" + k); }); return; }
        if (!S.can(sess, n, "r")) { errl(io, "\tzip warning: could not open for reading: " + nm); return; }
        var raw = rawSize(n.content, n.size);
        addE({ p: nm.replace(/^\/+/, ""), t: "f", c: n.content, s: n.size, mode: n.mode & 4095, mt: n.mtime }, raw > 60 ? "(deflated " + Math.min(85, 30 + raw % 50) + "%)" : "(stored 0%)");
      })(r.node, f);
    });
    var we = S.writeFile(sess, zf, packJSON(ZIP_MAGIC, entries));
    if (we) { errl(io, "zip I/O error: " + ERR[we] + "\n\nzip error: Could not create output file (" + zf + ")"); return 15; }
    S.lookup(sess, zf).node.size = Math.max(22, entries.reduce(function (s, e) { return s + 76 + e.p.length * 2 + (e.t === "f" ? Math.round(rawSize(e.c, e.s) * 0.45) : 0); }, 22));
    return code;
  };
  CMDS.unzip = function (args, io, sess) {
    var a = args.slice(1), list = false, over = false, never = false, quiet = false, dir = null, rest = [];
    for (var i = 0; i < a.length; i++) { var x = a[i]; if (x === "-l") list = true; else if (x === "-o") over = true; else if (x === "-n") never = true; else if (x === "-q" || x === "-qq") quiet = true; else if (x === "-d") dir = a[++i]; else rest.push(x); }
    if (!rest.length) { out(io, "UnZip 6.00 of 20 April 2009, by Debian. Original by Info-ZIP.\n\nUsage: unzip [-Z] [-opts[modifiers]] file[.zip] [list] [-x xlist] [-d exdir]\n"); return 0; }
    var zf = rest.shift(), r = S.readFile(sess, zf);
    if (r.error && !/\.zip$/.test(zf)) { var r2 = S.readFile(sess, zf + ".zip"); if (!r2.error) { r = r2; zf += ".zip"; } }
    if (r.error) { errl(io, "unzip:  cannot find or open " + zf + ", " + zf + ".zip or " + zf + ".ZIP."); return 9; }
    var entries = unpackJSON(ZIP_MAGIC, r.content);
    if (!entries) { out(io, "Archive:  " + zf + "\n"); errl(io, "  End-of-central-directory signature not found.  Either this file is not\n  a zipfile, or it constitutes one disk of a multi-part archive.  In the\n  latter case the central directory and zipfile comment will be found on\n  the last disk(s) of this archive.\nunzip:  cannot find zipfile directory in one of " + zf + " or\n        " + zf + ".zip, and cannot find " + zf + ".ZIP, period."); return 9; }
    if (rest.length) entries = entries.filter(function (e) { return rest.some(function (m) { return e.p === m || S.globMatch(m, e.p); }); });
    if (!quiet) out(io, "Archive:  " + zf + "\n");
    if (list) {
      var tot = 0;
      out(io, "  Length      Date    Time    Name\n---------  ---------- -----   ----\n");
      entries.forEach(function (e) { var sz = e.t === "f" ? rawSize(e.c, e.s) : 0; tot += sz; var d = new Date(e.mt); out(io, pad(sz, 9) + "  " + ymd(e.mt).slice(5) + "-" + ymd(e.mt).slice(0, 4) + " " + d2(d.getUTCHours()) + ":" + d2(d.getUTCMinutes()) + "   " + e.p + "\n"); });
      out(io, "---------                     -------\n" + pad(tot, 9) + "                     " + entries.length + " file" + (entries.length === 1 ? "" : "s") + "\n");
      return 0;
    }
    var base = dir ? S.absPath(sess, dir) : sess.cwd, asked = false, code = 0;
    if (dir && !ensureDirs(sess, base, io, "unzip")) return 50;
    entries.forEach(function (e) {
      var target = base.replace(/\/$/, "") + "/" + e.p.replace(/\/$/, "");
      if (e.t === "d") { if (!S.lookup(sess, target).node) { ensureDirs(sess, target, io, "unzip"); if (!quiet) out(io, "   creating: " + (dir ? dir.replace(/\/$/, "") + "/" : "") + e.p + "\n"); } return; }
      var parent = target.slice(0, target.lastIndexOf("/"));
      if (!ensureDirs(sess, parent, io, "unzip")) { code = 50; return; }
      if (S.lookup(sess, target).node) {
        if (never) return;
        if (!over && !asked) { out(io, "replace " + (dir ? dir.replace(/\/$/, "") + "/" : "") + e.p + "? [y]es, [n]o, [A]ll, [N]one, [r]ename: A\n"); note(io, "(unzip asked before overwriting; the lab answered A, for all files. Use unzip -o to overwrite without asking, or -n to never overwrite.)"); asked = true; }
      }
      var we = S.writeFile(sess, target, e.c || "");
      if (we) { errl(io, "error:  cannot create " + target + "\n        " + ERR[we]); code = 50; return; }
      setNodeMeta(sess, target, { mode: e.mode, mtime: e.mt, size: e.s, clearSize: e.s == null });
      if (!quiet) out(io, "  inflating: " + (dir ? dir.replace(/\/$/, "") + "/" : "") + e.p + "\n");
    });
    return code;
  };
  // `file` knows archives
  var fileOrig = CMDS.file;
  CMDS.file = function (args, io, sess) {
    var code = 0, rest = [];
    args.slice(1).forEach(function (f) {
      if (f.charAt(0) === "-") return;
      var r = S.lookup(sess, f);
      var c = r.node && r.node.type === "f" && S.can(sess, r.node, "r") ? r.node.content : "";
      if (c.indexOf(TAR_MAGIC) === 0) out(io, f + ": POSIX tar archive (GNU)\n");
      else if (c.indexOf(GZ_MAGIC) === 0) { var g = gzDecode(c); out(io, f + ": gzip compressed data" + (g && g.n ? ", was \"" + g.n + "\"" : "") + ", last modified: " + (g ? WDAY[new Date(g.m).getUTCDay()] + " " + MON[new Date(g.m).getUTCMonth()] + " " + pad(new Date(g.m).getUTCDate(), 2) + " " + tod(g.m) + " 2026" : "") + ", from Unix, original size modulo 2^32 " + (g ? rawSize(g.c, g.s) : 0) + "\n"); }
      else if (c.indexOf(BZ_MAGIC) === 0) out(io, f + ": bzip2 compressed data, block size = 900k\n");
      else if (c.indexOf(XZ_MAGIC) === 0) out(io, f + ": XZ compressed data, checksum CRC64\n");
      else if (c.indexOf(ZIP_MAGIC) === 0) out(io, f + ": Zip archive data, at least v1.0 to extract, compression method=store\n");
      else { var c2 = fileOrig(["file", f], io, sess); if (c2) code = c2; }
    });
    return code;
  };

  /* ================================================================== tree, jq, sha256sum */
  CMDS.tree = function (args, io, sess) {
    var a = args.slice(1), all = false, dirsOnly = false, depth = Infinity, full = false, noReport = false, roots = [];
    for (var i = 0; i < a.length; i++) { var x = a[i]; if (x === "-L") depth = +a[++i]; else if (/^-[adfh]+$/.test(x)) { if (x.indexOf("a") >= 0) all = true; if (x.indexOf("d") >= 0) dirsOnly = true; if (x.indexOf("f") >= 0) full = true; } else if (x === "--noreport") noReport = true; else if (x === "-I") i++; else roots.push(x); }
    if (!roots.length) roots = ["."];
    var nd = 0, nf = 0, L = [];
    roots.forEach(function (rt) {
      var r = S.lookup(sess, rt);
      if (!r.node || r.node.type !== "d") { L.push(rt + "  [error opening dir]"); return; }
      L.push(rt);
      (function walk(n, prefix, path, d) {
        if (d > depth) return;
        if (!S.can(sess, n, "r") || !S.can(sess, n, "x")) return;
        var kids = Object.keys(n.children).filter(function (k) { return all || k.charAt(0) !== "."; }).filter(function (k) { if (!dirsOnly) return true; var c = n.children[k]; return c.type === "d"; }).sort(S.sortNames);
        kids.forEach(function (k, idx) {
          var c = n.children[k], last = idx === kids.length - 1, p = path.replace(/\/$/, "") + "/" + k;
          var deny = c.type === "d" && (!S.can(sess, c, "r") || !S.can(sess, c, "x"));
          L.push(prefix + (last ? "└── " : "├── ") + (full ? p : k) + (c.type === "l" ? " -> " + c.target : "") + (deny ? "  [error opening dir]" : ""));
          if (c.type === "d") { nd++; walk(c, prefix + (last ? "    " : "│   "), p, d + 1); } else nf++;
        });
      })(r.node, "", rt, 1);
    });
    if (!noReport) L.push("", nd + " director" + (nd === 1 ? "y" : "ies") + (dirsOnly ? "" : ", " + nf + " file" + (nf === 1 ? "" : "s")));
    out(io, joinLines(L));
    return 0;
  };
  function jqRun(filter, val) {
    var segs = [], depthP = 0, cur = "", inStr = false;
    for (var i = 0; i < filter.length; i++) { var ch = filter.charAt(i); if (ch === "\"") inStr = !inStr; if (!inStr && (ch === "(" || ch === "[")) depthP++; if (!inStr && (ch === ")" || ch === "]")) depthP--; if (ch === "|" && !inStr && depthP === 0) { segs.push(cur.trim()); cur = ""; } else cur += ch; }
    segs.push(cur.trim());
    var vals = [val];
    segs.forEach(function (sg) { var next = []; vals.forEach(function (v) { next = next.concat(jqSeg(sg, v)); }); vals = next; });
    return vals;
  }
  function jqSeg(sg, v) {
    if (sg === "." || sg === "") return [v];
    if (sg === "length") return [v == null ? 0 : typeof v === "string" || Array.isArray(v) ? v.length : typeof v === "object" ? Object.keys(v).length : Math.abs(v)];
    if (sg === "keys") { if (v == null || typeof v !== "object") throw new Error((v === null ? "null" : typeof v) + " (" + JSON.stringify(v) + ") has no keys"); return [Array.isArray(v) ? v.map(function (x, i) { return i; }) : Object.keys(v).sort()]; }
    var m = /^select\((.+?)\s*(==|!=|>=|<=|>|<)\s*(.+)\)$/.exec(sg);
    if (m) { var lhs = jqRun(m[1], v)[0], rhs = JSON.parse(m[3]); var ok = { "==": lhs === rhs, "!=": lhs !== rhs, ">": lhs > rhs, "<": lhs < rhs, ">=": lhs >= rhs, "<=": lhs <= rhs }[m[2]]; return ok ? [v] : []; }
    if (sg.charAt(0) !== ".") throw new Error("syntax error, unexpected IDENT");
    var path = sg.slice(1), res = [v];
    var re = /^(?:\.?([A-Za-z_][\w-]*)|\.?"([^"]+)"|\[(\d*|-\d+)\])(\?)?/;
    while (path.length) {
      var mm = re.exec(path); if (!mm) throw new Error("syntax error near " + path);
      path = path.slice(mm[0].length);
      var opt = !!mm[4];
      res = [].concat.apply([], res.map(function (x) {
        if (mm[1] !== undefined || mm[2] !== undefined) { var k = mm[1] || mm[2]; if (x === null) return [null]; if (typeof x !== "object" || Array.isArray(x)) { if (opt) return []; throw new Error("Cannot index " + (Array.isArray(x) ? "array" : typeof x) + " with \"" + k + "\""); } return [x[k] === undefined ? null : x[k]]; }
        if (mm[3] === "") { if (x === null) return []; if (typeof x !== "object") { if (opt) return []; throw new Error("Cannot iterate over " + typeof x); } return Array.isArray(x) ? x : Object.keys(x).map(function (k) { return x[k]; }); }
        if (!Array.isArray(x)) { if (x === null) return [null]; if (opt) return []; throw new Error("Cannot index " + typeof x + " with number"); }
        var n = +mm[3]; if (n < 0) n += x.length; return [x[n] === undefined ? null : x[n]];
      }));
    }
    return res;
  }
  CMDS.jq = function (args, io, sess) {
    var a = args.slice(1), raw = false, compact = false, filter = null, files = [];
    a.forEach(function (x) { if (x === "-r" || x === "--raw-output") raw = true; else if (x === "-c" || x === "--compact-output") compact = true; else if (/^-[rc]+$/.test(x)) { raw = x.indexOf("r") >= 0; compact = x.indexOf("c") >= 0; } else if (filter === null) filter = x; else files.push(x); });
    if (filter === null) { errl(io, "Usage:\tjq [OPTIONS] FILTER [FILES...]\n\tjq [OPTIONS] --args FILTER [ARGUMENTS...]"); return 2; }
    var code = 0;
    U.eachInput("jq", files, io, sess, function (text) {
      var docs = [];
      try { var t = text.trim(); if (t) docs = [JSON.parse(t)]; } catch (e) { errl(io, "jq: error (at <stdin>:" + lines(text).length + "): Cannot parse input: " + e.message.replace(/^JSON\.parse: /, "")); code = 2; return; }
      docs.forEach(function (d) {
        try { jqRun(filter, d).forEach(function (r) { out(io, (raw && typeof r === "string" ? r : compact ? JSON.stringify(r) : JSON.stringify(r, null, 2)) + "\n"); }); }
        catch (e) { errl(io, "jq: error (at <stdin>:" + lines(text).length + "): " + e.message); code = 5; }
      });
    });
    return code;
  };

  /* ================================================================== services' own commands */
  CMDS["fail2ban-client"] = function (args, io, sess) {
    if (sess.uid !== 0) { errl(io, "ERROR  Permission denied to socket: /var/run/fail2ban/fail2ban.sock, (you must be root)"); return 255; }
    var u = sess.sys.units["fail2ban.service"];
    if (!u || u.rt.active !== "active") { errl(io, "ERROR  Failed to access socket path: /var/run/fail2ban/fail2ban.sock. Is fail2ban running?"); return 255; }
    if (args[1] === "status" && args[2]) { out(io, "Status for the jail: " + args[2] + "\n|- Filter\n|  |- Currently failed:\t0\n|  |- Total failed:\t0\n|  `- Journal matches:\t_SYSTEMD_UNIT=sshd.service + _COMM=sshd\n`- Actions\n   |- Currently banned:\t0\n   |- Total banned:\t0\n   `- Banned IP list:\t\n"); return 0; }
    out(io, "Status\n|- Number of jail:\t1\n`- Jail list:\tsshd\n"); return 0;
  };
  CMDS["redis-cli"] = function (args, io, sess) {
    var u = sess.sys.units["redis-server.service"];
    if (!u || u.rt.active !== "active") { errl(io, "Could not connect to Redis at 127.0.0.1:6379: Connection refused"); return 1; }
    var cmd = args.slice(1).filter(function (x) { return !/^-/.test(x); });
    var c = (cmd[0] || "").toLowerCase();
    if (!c) { note(io, "(redis-cli on its own opens an interactive prompt. Pass a command, e.g. redis-cli ping)"); return 0; }
    if (c === "ping") out(io, "PONG\n"); else if (c === "info") out(io, "# Server\nredis_version:7.0.15\nredis_mode:standalone\nos:Linux 6.8.0-48-generic x86_64\ntcp_port:6379\n"); else out(io, "(nil)\n");
    return 0;
  };
  CMDS.gunicorn = function (args, io) { note(io, "(gunicorn serves the Kestrel Python app. On this server systemd runs it for you: systemctl status kestrel-app)"); return 0; };
  CMDS.apachectl = function (args, io, sess) { if (args[1] === "configtest" || args[1] === "-t") { out(io, "Syntax OK\n"); return 0; } note(io, "(apachectl controls Apache. Use systemctl to start and stop it.)"); return 0; };
  CMDS.apache2 = CMDS.apachectl;

  /* ================================================================== man pages for the new commands */
  var MANX = {
    ps: ["ps [options]", "Report a snapshot of the current processes.", [["aux", "every process, user-oriented format (BSD style)"], ["-ef", "every process, full format (UNIX style)"], ["-u USER", "processes owned by USER"], ["-p PID", "the process with this PID"], ["-o pid,user,%cpu,cmd", "choose the columns"], ["--sort=-%cpu", "sort, biggest CPU first (-%mem for memory)"], ["--forest", "show the parent/child tree"]]],
    top: ["top [-b] [-n N] [-o FIELD] [-u USER]", "Display Linux processes, live, sorted by CPU use.", [["-b -n 1", "batch mode: print one snapshot (for scripts and pipes)"], ["-o %MEM", "sort by memory"], ["-u USER", "only USER's processes"], ["(inside) P / M / k / q", "sort by CPU / memory, kill a process, quit"]]],
    kill: ["kill [-s SIGNAL | -SIGNAL] PID|%JOB...", "Send a signal to a process. The default signal is TERM (15): please exit. KILL (9) can't be caught or ignored: use it only when TERM doesn't work.", [["-l", "list signal names"], ["-15, -TERM", "ask the process to exit (default)"], ["-9, -KILL", "force it (no clean-up)"], ["-1, -HUP", "hang up; many daemons reload their config"], ["%1", "job number 1 of this shell"]]],
    pgrep: ["pgrep [options] PATTERN", "Look up processes by name and print their PIDs.", [["-f", "match the full command line, not just the name"], ["-a", "print the command line too"], ["-u USER", "only USER's processes"], ["-x", "the name must match exactly"]]],
    pkill: ["pkill [-SIGNAL] [options] PATTERN", "Signal processes by name (like kill, with pgrep's matching).", [["-f", "match the full command line"], ["-u USER", "only USER's processes"]]],
    jobs: ["jobs [-l]", "List the background jobs of this shell: their number, state and command.", [["-l", "also show PIDs"]]],
    fg: ["fg [%JOB]", "Bring a background job to the foreground.", []], bg: ["bg [%JOB]", "Resume a stopped job in the background.", []],
    nohup: ["nohup COMMAND [ARG]...", "Run COMMAND immune to hangups (so it keeps running after you log out), with output going to nohup.out unless you redirect it.", []],
    systemctl: ["systemctl [OPTIONS...] COMMAND [UNIT...]", "Control the systemd system and service manager.", [["status UNIT", "is it running? since when? last log lines"], ["start / stop / restart UNIT", "start, stop or restart now (needs sudo)"], ["reload UNIT", "re-read config without stopping"], ["enable / disable UNIT", "start (or not) at boot; --now also starts/stops it"], ["is-active / is-enabled UNIT", "one-word answers, handy in scripts"], ["list-units --failed", "what's broken"], ["list-timers", "scheduled timers"], ["daemon-reload", "re-read unit files after editing them"]]],
    journalctl: ["journalctl [OPTIONS...]", "Query the systemd journal: logs of every service, the kernel and the system.", [["-u UNIT", "only this service's messages"], ["-n N", "the last N lines"], ["-e", "jump to the end"], ["-f", "follow new messages"], ["-p err", "only errors (and worse)"], ["--since \"1 hour ago\"", "only recent messages (also: today, \"2026-11-11 08:00\")"], ["-k", "kernel messages"]]],
    apt: ["apt [options] command", "Install, upgrade and remove packages (Debian/Ubuntu).", [["update", "refresh the list of available packages (do this first)"], ["install PKG", "install a package and what it needs"], ["remove PKG / purge PKG", "remove it (purge also deletes its config)"], ["upgrade", "upgrade everything that has updates"], ["list --installed / --upgradable", "list packages"], ["show PKG", "package details"], ["search WORD", "find packages"], ["-y", "answer yes to questions"]]],
    "apt-mark": ["apt-mark hold|unhold|showhold PKG...", "Mark packages: hold keeps a package at its current version during upgrades.", []],
    dpkg: ["dpkg [options] action", "The low-level Debian package tool.", [["-l [PATTERN]", "list installed packages (ii = installed, hi = held, rc = removed, config kept)"], ["-L PKG", "files a package installed"], ["-S PATH", "which package owns a file"], ["-s PKG", "package status"]]],
    lsblk: ["lsblk [options]", "List block devices (disks and partitions) and where they're mounted.", [["-f", "show file systems, labels, UUIDs and free space"]]],
    findmnt: ["findmnt [TARGET]", "Show mounted file systems.", []],
    lsof: ["lsof [options] [FILE]", "List open files and the processes that hold them.", [["+L1", "files deleted while still open (they still use disk space!)"], ["-i :PORT", "who's listening on / connected to a port"], ["-p PID", "files this process has open"], ["FILE", "who has FILE open"]]],
    truncate: ["truncate -s SIZE FILE...", "Shrink or extend files to SIZE. truncate -s 0 empties a file in place (a process writing to it keeps its handle).", []],
    free: ["free [-h]", "Display amount of free and used memory.", [["-h", "human-readable sizes"]]],
    crontab: ["crontab [-u USER] { FILE | - | -l | -e | -r }", "Install, list or remove a user's cron table: commands run on a schedule.", [["-l", "list your crontab"], ["FILE or -", "replace your crontab with FILE (or stdin)"], ["-e", "edit it in an editor"], ["-r", "remove it"], ["m h dom mon dow command", "line format: minute hour day-of-month month day-of-week"]]],
    "systemd-analyze": ["systemd-analyze calendar EXPRESSION", "Check an OnCalendar= expression: shows its normal form and when it next fires.", [["calendar 'daily'", "next run of a timer spec"], ["verify FILE", "check a unit file for mistakes"]]],
    tar: ["tar [OPTION...] [FILE]...", "Save many files into one archive, and restore them.", [["-c", "create an archive"], ["-x", "extract"], ["-t", "list the contents"], ["-z", "compress with gzip (.tar.gz)"], ["-v", "list files as they're processed"], ["-f FILE", "the archive file (always needed)"], ["-C DIR", "work in DIR (where to extract, or where to read from)"], ["--exclude=PATTERN", "leave matching files out"]]],
    gzip: ["gzip [OPTION]... [FILE]...", "Compress files. file.log becomes file.log.gz (the original is removed).", [["-d", "decompress (same as gunzip)"], ["-k", "keep the original"], ["-c", "write to standard output"], ["-l", "list compressed/uncompressed sizes"], ["-r", "recurse into directories"]]],
    gunzip: ["gunzip [OPTION]... [FILE]...", "Decompress .gz files.", [["-k", "keep the .gz file"], ["-c", "write to standard output"]]],
    zcat: ["zcat FILE...", "Print compressed files without decompressing them on disk.", []],
    zip: ["zip [-r] ZIPFILE FILE...", "Package and compress files into a .zip archive.", [["-r", "include folders recursively"]]],
    unzip: ["unzip [-l] [-o] [-d DIR] ZIPFILE", "Extract files from a .zip archive.", [["-l", "list the contents"], ["-d DIR", "extract into DIR"], ["-o", "overwrite without asking"]]],
    tree: ["tree [-a] [-d] [-L LEVEL] [DIR]", "List the contents of directories in a tree-like format.", [["-L N", "go only N levels deep"], ["-d", "folders only"], ["-a", "include hidden files"]]],
    jq: ["jq [-r] FILTER [FILE]", "A lightweight command-line JSON processor.", [[".", "pretty-print"], [".key / .a.b", "pick a field"], [".[]", "each element of an array"], ["-r", "print strings without quotes"]]],
    sleep: ["sleep NUMBER[SUFFIX]...", "Pause for NUMBER seconds (suffix m for minutes, h for hours, d for days).", []],
    watch: ["watch [-n SECONDS] COMMAND", "Run COMMAND repeatedly and show its output full-screen.", []]
  };
  Object.keys(MANX).forEach(function (k) { S.MAN[k] = { syn: MANX[k][0], desc: MANX[k][1], opts: MANX[k][2] }; });

  /* ================================================================== the running server (base hook) */
  var UNITS_TEXT = {
    "nginx.service": "[Unit]\nDescription=A high performance web server and a reverse proxy server\nDocumentation=man:nginx(8)\nAfter=network-online.target remote-fs.target nss-lookup.target\nWants=network-online.target\n\n[Service]\nType=forking\nPIDFile=/run/nginx.pid\nExecStartPre=/usr/sbin/nginx -t -q -g 'daemon on; master_process on;'\nExecStart=/usr/sbin/nginx -g 'daemon on; master_process on;'\nExecReload=/usr/sbin/nginx -g 'daemon on; master_process on;' -s reload\nExecStop=-/sbin/start-stop-daemon --quiet --stop --retry QUIT/5 --pidfile /run/nginx.pid\nTimeoutStopSec=5\nKillMode=mixed\n\n[Install]\nWantedBy=multi-user.target\n",
    "ssh.service": "[Unit]\nDescription=OpenBSD Secure Shell server\nDocumentation=man:sshd(8) man:sshd_config(5)\nAfter=network.target nss-user-lookup.target auditd.service\nConditionPathExists=!/etc/ssh/sshd_not_to_be_run\n\n[Service]\nEnvironmentFile=-/etc/default/ssh\nExecStartPre=/usr/sbin/sshd -t\nExecStart=/usr/sbin/sshd -D $SSHD_OPTS\nExecReload=/usr/sbin/sshd -t\nExecReload=/bin/kill -HUP $MAINPID\nKillMode=process\nRestart=on-failure\nRestartPreventExitStatus=255\nType=notify\nRuntimeDirectory=sshd\nRuntimeDirectoryMode=0755\n\n[Install]\nWantedBy=multi-user.target\nAlias=sshd.service\n",
    "cron.service": "[Unit]\nDescription=Regular background program processing daemon\nDocumentation=man:cron(8)\nAfter=remote-fs.target nss-user-lookup.target\n\n[Service]\nEnvironmentFile=-/etc/default/cron\nExecStart=/usr/sbin/cron -f -P $EXTRA_OPTS\nIgnoreSIGPIPE=false\nKillMode=process\nRestart=on-failure\nSyslogFacility=cron\n\n[Install]\nWantedBy=multi-user.target\n",
    "rsyslog.service": "[Unit]\nDescription=System Logging Service\nRequires=syslog.socket\nDocumentation=man:rsyslogd(8)\nDocumentation=man:rsyslog.conf(5)\n\n[Service]\nType=notify\nExecStart=/usr/sbin/rsyslogd -n -iNONE\nStandardOutput=null\nRestart=on-failure\n\n[Install]\nWantedBy=multi-user.target\nAlias=syslog.service\n",
    "systemd-journald.service": "[Unit]\nDescription=Journal Service\nDocumentation=man:systemd-journald.service(8) man:journald.conf(5)\n\n[Service]\nType=notify\nExecStart=/usr/lib/systemd/systemd-journald\nRestart=always\n",
    "systemd-logind.service": "[Unit]\nDescription=User Login Management\nDocumentation=man:sd-login(3)\n\n[Service]\nType=notify\nExecStart=/usr/lib/systemd/systemd-logind\nRestart=always\n",
    "systemd-resolved.service": "[Unit]\nDescription=Network Name Resolution\nDocumentation=man:systemd-resolved.service(8)\n\n[Service]\nType=notify\nExecStart=/usr/lib/systemd/systemd-resolved\nUser=systemd-resolve\nRestart=always\n\n[Install]\nWantedBy=multi-user.target\n",
    "ufw.service": "[Unit]\nDescription=Uncomplicated firewall\nDocumentation=man:ufw(8)\nDefaultDependencies=no\nBefore=network-pre.target\n\n[Service]\nType=oneshot\nRemainAfterExit=yes\nExecStart=/usr/lib/ufw/ufw-init start quiet\nExecStop=/usr/lib/ufw/ufw-init stop\n\n[Install]\nWantedBy=multi-user.target\n",
    "apt-daily.service": "[Unit]\nDescription=Daily apt download activities\nDocumentation=man:apt(8)\n\n[Service]\nType=oneshot\nExecStart=/usr/lib/apt/apt.systemd.daily update\n",
    "apt-daily.timer": "[Unit]\nDescription=Daily apt download activities\n\n[Timer]\nOnCalendar=*-*-* 6,18:00\nRandomizedDelaySec=12h\nPersistent=true\n\n[Install]\nWantedBy=timers.target\n",
    "apt-daily-upgrade.service": "[Unit]\nDescription=Daily apt upgrade and clean activities\nDocumentation=man:apt(8)\n\n[Service]\nType=oneshot\nExecStart=/usr/lib/apt/apt.systemd.daily install\n",
    "apt-daily-upgrade.timer": "[Unit]\nDescription=Daily apt upgrade and clean activities\nAfter=apt-daily.timer\n\n[Timer]\nOnCalendar=*-*-* 6:00\nRandomizedDelaySec=60m\nPersistent=true\n\n[Install]\nWantedBy=timers.target\n",
    "logrotate.service": "[Unit]\nDescription=Rotate log files\nDocumentation=man:logrotate(8) man:logrotate.conf(5)\n\n[Service]\nType=oneshot\nExecStart=/usr/sbin/logrotate /etc/logrotate.conf\n",
    "logrotate.timer": "[Unit]\nDescription=Daily rotation of log files\nDocumentation=man:logrotate(8) man:logrotate.conf(5)\n\n[Timer]\nOnCalendar=daily\nAccuracySec=1h\nPersistent=true\n\n[Install]\nWantedBy=timers.target\n",
    "man-db.service": "[Unit]\nDescription=Daily man-db regeneration\nDocumentation=man:mandb(8)\n\n[Service]\nType=oneshot\nExecStart=/usr/bin/mandb --quiet\n",
    "man-db.timer": "[Unit]\nDescription=Daily man-db regeneration\nDocumentation=man:mandb(8)\n\n[Timer]\nOnCalendar=daily\nAccuracySec=12h\nPersistent=true\n\n[Install]\nWantedBy=timers.target\n"
  };
  UNIT_FILES["nginx.service"] = UNITS_TEXT["nginx.service"];
  var SYSBINS = ["/usr/sbin/cron", "/usr/sbin/rsyslogd", "/usr/sbin/logrotate", "/usr/lib/systemd/systemd-journald", "/usr/lib/systemd/systemd-logind", "/usr/lib/systemd/systemd-resolved", "/usr/lib/ufw/ufw-init", "/usr/lib/apt/apt.systemd.daily", "/usr/bin/mandb", "/usr/sbin/start-stop-daemon"];
  var NEWBINS = ["ps", "top", "kill", "pgrep", "pkill", "pidof", "killall", "pstree", "free", "nohup", "systemctl", "journalctl", "systemd-analyze", "timedatectl", "hostnamectl", "apt", "apt-get", "apt-cache", "apt-mark", "dpkg", "dpkg-query", "lsblk", "findmnt", "truncate", "lsof", "watch", "crontab", "tar", "gzip", "gunzip", "zcat", "zgrep"];
  S.SYS_HOOKS.push(function (sys, hookOpts) {
    var www = S.uidOf(sys, "www-data");
    if (!UNIT_FILES.nginxStock) {
      var stock = {};
      ["/etc/nginx/nginx.conf", "/etc/nginx/mime.types"].forEach(function (f) { stock[f] = rd(sys, f); });
      stock["/etc/nginx/nginx.conf"] = stock["/etc/nginx/nginx.conf"].replace("\tserver_tokens off;", "\t# server_tokens off;");
      stock["/etc/nginx/sites-available/default"] = "##\n# You should look at the following URL's in order to grasp a solid understanding\n# of Nginx configuration files in order to fully unleash the power of Nginx.\n# https://www.nginx.com/resources/wiki/start/\n##\n\n# Default server configuration\n#\nserver {\n\tlisten 80 default_server;\n\tlisten [::]:80 default_server;\n\n\troot /var/www/html;\n\n\t# Add index.php to the list if you are using PHP\n\tindex index.html index.htm index.nginx-debian.html;\n\n\tserver_name _;\n\n\tlocation / {\n\t\t# First attempt to serve request as file, then\n\t\t# as directory, then fall back to displaying a 404.\n\t\ttry_files $uri $uri/ =404;\n\t}\n}\n";
      UNIT_FILES.nginxStock = stock;
    }
    // users, groups and binaries the running server needs
    writeRoot(sys, "/etc/passwd", "systemd-resolve:x:991:991:systemd Resolver:/:/usr/sbin/nologin\n", true);
    writeRoot(sys, "/etc/group", "crontab:x:101:\nsystemd-journal:x:999:\nsystemd-resolve:x:991:\n", true);
    NEWBINS.forEach(function (b) { binPut(sys, "/usr/bin/" + b, b); });
    SYSBINS.forEach(function (b) { binPut(sys, b, basename(b)); });
    binPut(sys, "/opt/kestrel/app/venv/bin/python3", "python3"); binPut(sys, "/opt/kestrel/app/venv/bin/gunicorn", "gunicorn");
    // packages: catalog copy with per-machine state
    sys.pkgs = {};
    CATALOG.forEach(function (p) { var c = Object.assign({}, p); c.curVer = p.installed ? p.ver : null; sys.pkgs[p.name] = c; });
    sys.aptUpdated = false;
    Object.keys(sys.pkgs).forEach(function (k) { var p = sys.pkgs[k]; if (!p.installed) { p.bins.concat(p.sbins).forEach(function (b) { rmRoot(sys, "/usr/bin/" + b); rmRoot(sys, "/usr/sbin/" + b); }); } else { p.bins.forEach(function (b) { if (!nodeAt(sys, "/usr/bin/" + b)) binPut(sys, "/usr/bin/" + b, b); }); p.sbins.forEach(function (b) { if (!nodeAt(sys, "/usr/sbin/" + b)) binPut(sys, "/usr/sbin/" + b, b); }); } });
    mkdirRoot(sys, "/var/cache/apt/archives");
    mkdirRoot(sys, "/srv/backups", 493, 0, 0);
    putRoot(sys, "/var/log/apt/history.log", "\nStart-Date: 2026-11-09  10:15:20\nCommandline: apt install nginx\nRequested-By: dev (1000)\nInstall: nginx-common:amd64 (1.24.0-2ubuntu7.1, automatic), nginx:amd64 (1.24.0-2ubuntu7.1)\nEnd-Date: 2026-11-09  10:15:34\n", 420);
    mkdirRoot(sys, CRONDIR, 984, 0, 101); mkdirRoot(sys, "/var/spool/cron", 493);
    ["cron.d", "cron.daily", "cron.hourly", "cron.weekly", "cron.monthly"].forEach(function (d) { mkdirRoot(sys, "/etc/" + d); });
    putRoot(sys, "/etc/cron.d/e2scrub_all", "30 3 * * 0 root test -e /run/systemd/system || SERVICE_MODE=1 /usr/lib/x86_64-linux-gnu/e2fsprogs/e2scrub_all_cron\n");
    putRoot(sys, "/etc/cron.daily/logrotate", "#!/bin/sh\n# skip in favour of systemd timer\nif [ -d /run/systemd/system ]; then\n    exit 0\nfi\n/usr/sbin/logrotate /etc/logrotate.conf\n", 493);
    putRoot(sys, "/etc/cron.daily/apt-compat", "#!/bin/sh\nset -e\n# Systemd systems use a systemd timer unit which is preferable to\n# run. We want to randomize the apt update and unattended-upgrade\n# runs as much as possible to avoid hitting the mirrors all at the\n# same time.\nif [ -d /run/systemd/system ]; then\n    exit 0\nfi\n", 493);
    putRoot(sys, "/etc/logrotate.conf", "# see \"man logrotate\" for details\nweekly\nsu root adm\nrotate 4\ncreate\ninclude /etc/logrotate.d\n");
    putRoot(sys, "/etc/default/cron", "# This file has been deprecated. Please add custom options for cron to\n# /etc/systemd/system/cron.service.d/override.conf\n");
    // unit files and the enabled ones
    Object.keys(UNITS_TEXT).forEach(function (n) { putRoot(sys, "/usr/lib/systemd/system/" + n, UNITS_TEXT[n], 420, 0, 0, Date.UTC(2024, 3, 8)); });
    var wantsM = mkdirRoot(sys, "/etc/systemd/system/multi-user.target.wants"), wantsT = mkdirRoot(sys, "/etc/systemd/system/timers.target.wants");
    ["nginx.service", "ssh.service", "cron.service", "rsyslog.service", "ufw.service", "systemd-resolved.service"].forEach(function (n) { wantsM.children[n] = S.linkNode("/usr/lib/systemd/system/" + n); });
    wantsM.children["kestrel-app.service"] = S.linkNode("/etc/systemd/system/kestrel-app.service");
    ["apt-daily.timer", "apt-daily-upgrade.timer", "logrotate.timer", "man-db.timer"].forEach(function (n) { wantsT.children[n] = S.linkNode("/usr/lib/systemd/system/" + n); });
    S.mkdirs(sys, "/etc/systemd/system").children["sshd.service"] = S.linkNode("/usr/lib/systemd/system/ssh.service");
    // runtime state
    sys.procs = []; sys.jobs = []; sys.journal = []; sys.units = {}; sys.openFiles = []; sys.unitFiles = {}; sys.nextPid = 4100; sys.lineNo = 0;
    sys.mounts = MOUNTS.map(function (m) { return Object.assign({}, m); });
    var T0 = Date.UTC(2026, 10, 9, 10, 15, 40), TAPP = Date.UTC(2026, 10, 9, 10, 20, 1);
    [[2, "[kthreadd]", "S"], [3, "[pool_workqueue_release]", "S"], [14, "[rcu_preempt]", "I"], [3301, "[kworker/0:2-events]", "I"], [3302, "[kworker/u4:1-flush-252:0]", "I"]].forEach(function (k) { spawn(sys, { pid: k[0], ppid: k[0] === 2 ? 0 : 2, uid: 0, cmd: k[1], stat: k[2], kernel: true, start: BOOT, cpuSecs: 3 }); });
    spawn(sys, { pid: 1, ppid: 0, uid: 0, cmd: "/sbin/init", comm: "systemd", stat: "Ss", start: BOOT, cpuSecs: 12, vsz: 22140, rss: 13092 });
    function unitUp(name, procs, since, extra) {
      var u = loadUnit(sys, name);
      setState(u, "active", procs.length ? "running" : "exited", "success", sys); u.rt.since = since;
      procs.forEach(function (sp, i) { var p = spawn(sys, Object.assign({ start: since, ppid: i === 0 ? 1 : procs[0].pid, unit: name, cpuSecs: 2 + i }, sp)); if (sp.main) u.rt.mainPid = p.pid; });
      Object.assign(u.rt, extra || {});
      return u;
    }
    unitUp("systemd-journald.service", [{ pid: 312, uid: 0, cmd: "/usr/lib/systemd/systemd-journald", stat: "Ss", main: true, vsz: 50544, rss: 17280 }], BOOT);
    unitUp("systemd-logind.service", [{ pid: 651, uid: 0, cmd: "/usr/lib/systemd/systemd-logind", stat: "Ss", main: true, vsz: 17900, rss: 7896 }], BOOT);
    unitUp("systemd-resolved.service", [{ pid: 512, uid: 991, cmd: "/usr/lib/systemd/systemd-resolved", stat: "Ss", main: true, vsz: 21456, rss: 12800, listen: [{ proto: "udp", addr: "127.0.0.53", port: 53 }, { proto: "tcp", addr: "127.0.0.53", port: 53 }, { proto: "udp", addr: "127.0.0.54", port: 53 }, { proto: "tcp", addr: "127.0.0.54", port: 53 }] }], BOOT);
    unitUp("cron.service", [{ pid: 640, uid: 0, cmd: "/usr/sbin/cron -f -P", stat: "Ss", main: true, vsz: 6696, rss: 2688 }], BOOT);
    unitUp("rsyslog.service", [{ pid: 644, uid: S.uidOf(sys, "syslog"), cmd: "/usr/sbin/rsyslogd -n -iNONE", stat: "Ssl", main: true, vsz: 222508, rss: 6016 }], BOOT);
    unitUp("ssh.service", [{ pid: 702, uid: 0, cmd: "sshd: /usr/sbin/sshd -D [listener] 0 of 10-100 startups", comm: "sshd", stat: "Ss", main: true, vsz: 12020, rss: 7936, listen: [{ proto: "tcp", addr: "0.0.0.0", port: 22 }, { proto: "tcp", addr: "[::]", port: 22 }] }], BOOT, { prePid: 699, preCmd: "/usr/sbin/sshd -t", preCode: 0 });
    unitUp("ufw.service", [], BOOT);
    if (sys.host === "kc-web-01") {
      var nl = [{ proto: "tcp", addr: "0.0.0.0", port: 80 }];
      unitUp("nginx.service", [{ pid: 1123, uid: 0, cmd: "nginx: master process /usr/sbin/nginx -g daemon on; master_process on;", comm: "nginx", stat: "Ss", main: true, vsz: 55228, rss: 1640, listen: nl, onHup: function (s2) { reloadUnit(s2, s2.units["nginx.service"], null); } }, { pid: 1124, uid: www, cmd: "nginx: worker process", comm: "nginx", respawn: true, vsz: 55848, rss: 5672, listen: nl }, { pid: 1125, uid: www, cmd: "nginx: worker process", comm: "nginx", respawn: true, vsz: 55848, rss: 5548, listen: nl }], T0, { prePid: 1121, preCmd: "/usr/sbin/nginx -t -q -g daemon on; master_process on;", preCode: 0 });
      var g = "/opt/kestrel/app/venv/bin/python3 /opt/kestrel/app/venv/bin/gunicorn -b 127.0.0.1:8080 app:app", gl = [{ proto: "tcp", addr: "127.0.0.1", port: 8080 }];
      unitUp("kestrel-app.service", [{ pid: 1301, uid: www, cmd: g, comm: "gunicorn", main: true, vsz: 31744, rss: 23552, listen: gl, cpu: 0.1 }, { pid: 1302, uid: www, cmd: g, comm: "gunicorn", respawn: true, vsz: 41216, rss: 31488, listen: gl, cpu: 0.4 }, { pid: 1303, uid: www, cmd: g, comm: "gunicorn", respawn: true, vsz: 41088, rss: 31232, listen: gl, cpu: 0.3 }], TAPP);
    }
    ["apt-daily.timer", "apt-daily-upgrade.timer", "logrotate.timer", "man-db.timer"].forEach(function (n) { var u = loadUnit(sys, n); setState(u, "active", "waiting", "success", sys); u.rt.since = BOOT; });
    sys.units["apt-daily.timer"].rt.lastTrigger = Date.UTC(2026, 10, 11, 6, 12, 31);
    sys.units["apt-daily-upgrade.timer"].rt.lastTrigger = Date.UTC(2026, 10, 11, 6, 41, 7);
    sys.units["logrotate.timer"].rt.lastTrigger = Date.UTC(2026, 10, 11, 0, 0, 4);
    sys.units["man-db.timer"].rt.lastTrigger = Date.UTC(2026, 10, 11, 0, 0, 4);
    // dev's login
    spawn(sys, { pid: 2188, ppid: 702, uid: 0, cmd: "sshd: dev [priv]", comm: "sshd", stat: "Ss", start: Date.UTC(2026, 10, 11, 8, 52, 0), vsz: 14740, rss: 9216 });
    spawn(sys, { pid: 2190, ppid: 2188, uid: 1000, cmd: "sshd: dev@pts/0", comm: "sshd", stat: "S", start: Date.UTC(2026, 10, 11, 8, 52, 0), vsz: 14872, rss: 6528 });
    spawn(sys, { pid: 2400, ppid: 2190, uid: 1000, cmd: "-bash", comm: "bash", tty: "pts/0", stat: "Ss", start: Date.UTC(2026, 10, 11, 8, 52, 1), vsz: 8648, rss: 5376, cpuSecs: 0 });
    // the journal so far
    var J = function (t, ident, pid, msg, unit, prio) { jadd(sys, ident, pid, msg, unit, prio, t); };
    J(BOOT, "kernel", null, "Linux version 6.8.0-48-generic (buildd@lcy02-amd64-010) (x86_64-linux-gnu-gcc-13 (Ubuntu 13.2.0-23ubuntu4) 13.2.0, GNU ld (GNU Binutils for Ubuntu) 2.42) #48-Ubuntu SMP PREEMPT_DYNAMIC Fri Sep 27 14:04:52 UTC 2024 (Ubuntu 6.8.0-48.48-generic 6.8.12)", null, 5);
    J(BOOT, "kernel", null, "Command line: BOOT_IMAGE=/vmlinuz-6.8.0-48-generic root=LABEL=cloudimg-rootfs ro console=tty1 console=ttyS0", null, 6);
    J(BOOT + 2100, "systemd", 1, "systemd 255.4-1ubuntu8.4 running in system mode (+PAM +AUDIT +SELINUX +APPARMOR +IMA +SMACK +SECCOMP +GCRYPT -GNUTLS +OPENSSL +ACL +BLKID +CURL +ELFUTILS +FIDO2 +IDN2 -IDN +IPTC +KMOD +LIBCRYPTSETUP +LIBFDISK +PCRE2 -PWQUALITY +P11KIT +QRENCODE +TPM2 +BZIP2 +LZ4 +XZ +ZLIB +ZSTD -BPF_FRAMEWORK -XKBCOMMON +UTMP +SYSVINIT default-hierarchy=unified)", null, 6);
    J(BOOT + 2300, "systemd", 1, "Started systemd-journald.service - Journal Service.", "systemd-journald.service", 6);
    J(BOOT + 3100, "systemd", 1, "Started systemd-resolved.service - Network Name Resolution.", "systemd-resolved.service", 6);
    J(BOOT + 4200, "systemd", 1, "Started cron.service - Regular background program processing daemon.", "cron.service", 6);
    J(BOOT + 4210, "cron", 640, "(CRON) INFO (pidfile fd = 3)", "cron.service", 6);
    J(BOOT + 4220, "cron", 640, "(CRON) INFO (Running @reboot jobs)", "cron.service", 6);
    J(BOOT + 4300, "systemd", 1, "Started rsyslog.service - System Logging Service.", "rsyslog.service", 6);
    J(BOOT + 4400, "systemd", 1, "Started systemd-logind.service - User Login Management.", "systemd-logind.service", 6);
    J(BOOT + 4500, "systemd", 1, "Starting ssh.service - OpenBSD Secure Shell server...", "ssh.service", 6);
    J(BOOT + 4600, "sshd", 702, "Server listening on 0.0.0.0 port 22.", "ssh.service", 6);
    J(BOOT + 4610, "sshd", 702, "Server listening on :: port 22.", "ssh.service", 6);
    J(BOOT + 4620, "systemd", 1, "Started ssh.service - OpenBSD Secure Shell server.", "ssh.service", 6);
    J(BOOT + 4900, "systemd", 1, "Finished ufw.service - Uncomplicated firewall.", "ufw.service", 6);
    J(BOOT + 9000, "systemd", 1, "Reached target multi-user.target - Multi-User System.", null, 6);
    if (sys.host === "kc-web-01") {
      J(T0 - 400, "systemd", 1, "Starting nginx.service - A high performance web server and a reverse proxy server...", "nginx.service", 6);
      J(T0, "systemd", 1, "Started nginx.service - A high performance web server and a reverse proxy server.", "nginx.service", 6);
      J(TAPP, "systemd", 1, "Started kestrel-app.service - Kestrel web app.", "kestrel-app.service", 6);
      J(TAPP + 300, "gunicorn", 1301, "[2026-11-09 10:20:01 +0000] [1301] [INFO] Starting gunicorn 22.0.0", "kestrel-app.service", 6);
      J(TAPP + 310, "gunicorn", 1301, "[2026-11-09 10:20:01 +0000] [1301] [INFO] Listening at: http://127.0.0.1:8080 (1301)", "kestrel-app.service", 6);
      J(TAPP + 320, "gunicorn", 1301, "[2026-11-09 10:20:01 +0000] [1301] [INFO] Using worker: sync", "kestrel-app.service", 6);
      J(TAPP + 330, "gunicorn", 1301, "[2026-11-09 10:20:01 +0000] [1302] [INFO] Booting worker with pid: 1302", "kestrel-app.service", 6);
      J(TAPP + 340, "gunicorn", 1301, "[2026-11-09 10:20:01 +0000] [1303] [INFO] Booting worker with pid: 1303", "kestrel-app.service", 6);
    }
    J(Date.UTC(2026, 10, 11, 0, 0, 4), "systemd", 1, "Starting logrotate.service - Rotate log files...", "logrotate.service", 6);
    J(Date.UTC(2026, 10, 11, 0, 0, 4), "systemd", 1, "Starting man-db.service - Daily man-db regeneration...", "man-db.service", 6);
    J(Date.UTC(2026, 10, 11, 0, 0, 5), "systemd", 1, "logrotate.service: Deactivated successfully.", "logrotate.service", 6);
    J(Date.UTC(2026, 10, 11, 0, 0, 5), "systemd", 1, "Finished logrotate.service - Rotate log files.", "logrotate.service", 6);
    J(Date.UTC(2026, 10, 11, 0, 0, 6), "systemd", 1, "man-db.service: Deactivated successfully.", "man-db.service", 6);
    J(Date.UTC(2026, 10, 11, 0, 0, 6), "systemd", 1, "Finished man-db.service - Daily man-db regeneration.", "man-db.service", 6);
    J(Date.UTC(2026, 10, 11, 6, 12, 31), "systemd", 1, "Starting apt-daily.service - Daily apt download activities...", "apt-daily.service", 6);
    J(Date.UTC(2026, 10, 11, 6, 12, 40), "systemd", 1, "apt-daily.service: Deactivated successfully.", "apt-daily.service", 6);
    J(Date.UTC(2026, 10, 11, 6, 12, 40), "systemd", 1, "Finished apt-daily.service - Daily apt download activities.", "apt-daily.service", 6);
    J(Date.UTC(2026, 10, 11, 7, 0, 12), "kernel", null, "[UFW BLOCK] IN=eth0 OUT= MAC=52:54:00:3a:7c:01:52:54:00:12:35:02:08:00 SRC=203.0.113.50 DST=10.20.0.15 LEN=44 TOS=0x00 PREC=0x00 TTL=243 ID=54321 PROTO=TCP SPT=51022 DPT=3306 WINDOW=1024 RES=0x00 SYN URGP=0", null, 4);
    J(Date.UTC(2026, 10, 11, 8, 17, 1), "CRON", 2150, "(root) CMD (cd / && run-parts --report /etc/cron.hourly)", "cron.service", 6);
    J(Date.UTC(2026, 10, 11, 8, 52, 0), "sshd", 2188, "Accepted publickey for dev from 198.51.100.20 port 51544 ssh2: ED25519 SHA256:3mN4oP5qR6sT7uV8wX9yZ0aB1cD2eF3gH4iJ5kL6mN7", "ssh.service", 6);
    J(Date.UTC(2026, 10, 11, 8, 52, 0), "sshd", 2188, "pam_unix(sshd:session): session opened for user dev(uid=1000) by dev(uid=0)", "ssh.service", 6);
    J(Date.UTC(2026, 10, 11, 8, 52, 0), "systemd-logind", 651, "New session 41 of user dev.", "systemd-logind.service", 6);
    J(Date.UTC(2026, 10, 11, 8, 52, 1), "systemd", 1, "Started session-41.scope - Session 41 of User dev.", null, 6);
  });

  M2.setUnitFile = function (sys, path, text) { putRoot(sys, path, text); };
  M2.unitUp = function (sys, name, since) { var u = loadUnit(sys, name); var r = startUnit(sys, u, null); if (since) { u.rt.since = since; unitProcs(sys, u).forEach(function (p) { p.start = since; }); } return r; };
})(typeof window !== "undefined" ? window : globalThis);
