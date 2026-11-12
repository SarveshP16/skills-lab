/* sudo learn — Bash scripting support for the Linux track's Module 3: getopts, trap, bash -n/-x, mktemp, a
   ShellCheck that knows the most useful real rules (same SC codes and wording), and small helpers scripts use
   (nproc, logger, paste, column, comm, timeout). Loaded after sh-net.js. */
(function (root) {
  "use strict";
  var S = root.ShEngine, U = S.util, CMDS = S.CMDS, B = S.BUILTINS, M2 = S.M2, ShError = S.ShError;
  var opts = U.opts, out = U.out, errl = U.errl, note = U.note, lines = U.lines, rpad = U.rpad;
  var M3 = S.M3 = {};
  function optsFlat(name, args, spec) { var r = opts(name, args, spec); r.o.rest = r.rest; return r.o; }

  /* ================================================================== set (rewritten: -euo pipefail, -E, -o lists) */
  var setOrig = B.set;
  var SETOPTS = { errexit: 1, nounset: 1, pipefail: 1, xtrace: 1, errtrace: 1, noclobber: 1, noglob: 1, verbose: 1 };
  var SETMAP = { e: "errexit", u: "nounset", x: "xtrace", E: "errtrace", C: "noclobber", f: "noglob", v: "verbose" };
  function setList(io, sess, plus) {
    ["errexit", "errtrace", "nounset", "pipefail", "xtrace"].forEach(function (k) { out(io, plus ? "set " + (sess.opts[k] ? "-o " : "+o ") + k + "\n" : rpad(k, 15) + "\t" + (sess.opts[k] ? "on" : "off") + "\n"); });
    return 0;
  }
  B.set = function (args, io, sess) {
    var a = args.slice(1);
    if (!a.length) return setOrig(args, io, sess);
    for (var i = 0; i < a.length; i++) {
      var x = a[i];
      if (x === "--") { sess.positional = a.slice(i + 1); return 0; }
      if (x === "-" ) { sess.opts.xtrace = false; sess.opts.verbose = false; sess.positional = a.slice(i + 1); return 0; }
      if (/^[-+][a-zA-Z]+$/.test(x)) {
        var on = x.charAt(0) === "-";
        for (var j = 1; j < x.length; j++) {
          var c = x.charAt(j);
          if (c === "o") {
            var nm = a[i + 1];
            if (nm === undefined) return setList(io, sess, !on);
            i++;
            if (!SETOPTS[nm]) { errl(io, S.shMsg(sess, "bash: set: " + nm + ": invalid option name")); return 2; }
            sess.opts[nm] = on;
          } else if (SETMAP[c]) sess.opts[SETMAP[c]] = on;
          else if (!/[hmBHPbk]/.test(c)) { errl(io, S.shMsg(sess, "bash: set: " + x.charAt(0) + c + ": invalid option")); return 2; }
        }
        continue;
      }
      sess.positional = a.slice(i);
      return 0;
    }
    return 0;
  };

  /* ================================================================== trap */
  var SIGS = { EXIT: "EXIT", "0": "EXIT", ERR: "ERR", DEBUG: "DEBUG", RETURN: "RETURN", HUP: "HUP", "1": "HUP", INT: "INT", "2": "INT", QUIT: "QUIT", "3": "QUIT", TERM: "TERM", "15": "TERM", USR1: "USR1", "10": "USR1", USR2: "USR2", "12": "USR2", KILL: "KILL", "9": "KILL", STOP: "STOP", "19": "STOP" };
  function sigName(x) { var k = String(x).toUpperCase().replace(/^SIG/, ""); return SIGS[k] || null; }
  B.trap = function (args, io, sess) {
    var a = args.slice(1);
    sess.traps = sess.traps || {};
    if (a[0] === "--") a.shift();
    if (!a.length || a[0] === "-p") {
      var only = a[0] === "-p" ? a.slice(1).map(sigName) : null;
      Object.keys(sess.traps).forEach(function (k) { if (sess.traps[k] !== null && sess.traps[k] !== undefined && (!only || !only.length || only.indexOf(k) >= 0)) out(io, "trap -- '" + String(sess.traps[k]).replace(/'/g, "'\\''") + "' " + (k === "EXIT" || k === "ERR" || k === "DEBUG" || k === "RETURN" ? k : "SIG" + k) + "\n"); });
      return 0;
    }
    if (a[0] === "-l") { out(io, " 1) SIGHUP\t 2) SIGINT\t 3) SIGQUIT\t 4) SIGILL\t 5) SIGTRAP\n 6) SIGABRT\t 7) SIGBUS\t 8) SIGFPE\t 9) SIGKILL\t10) SIGUSR1\n11) SIGSEGV\t12) SIGUSR2\t13) SIGPIPE\t14) SIGALRM\t15) SIGTERM\n"); return 0; }
    var action = a[0], sigs = a.slice(1);
    if (!sigs.length) { if (sigName(action)) { sigs = [action]; action = "-"; } else { errl(io, "bash: trap: usage: trap [-lp] [[arg] signal_spec ...]"); return 2; } }
    var code = 0;
    sigs.forEach(function (s) {
      var n = sigName(s);
      if (!n) { errl(io, S.shMsg(sess, "bash: trap: " + s + ": invalid signal specification")); code = 1; return; }
      if (action === "-") delete sess.traps[n]; else sess.traps[n] = action;
    });
    return code;
  };

  /* ================================================================== getopts */
  B.getopts = function (args, io, sess) {
    if (args.length < 3) { errl(io, "bash: getopts: usage: getopts optstring name [arg ...]"); return 2; }
    var spec = args[1], name = args[2];
    var argv = args.length > 3 ? args.slice(3) : sess.positional;
    var ind = parseInt(S.getVar(sess, "OPTIND"), 10); if (!(ind >= 1)) ind = 1;
    if (sess._goLast !== ind) sess._goSub = 1;
    var sub = sess._goSub || 1;
    var silent = spec.charAt(0) === ":"; if (silent) spec = spec.slice(1);
    function finish(val, ret) {
      S.setVar(sess, name, val);
      S.setVar(sess, "OPTIND", String(ind));
      sess._goLast = ind; sess._goSub = sub;
      return ret;
    }
    function unsetArg() { if (sess.vars.OPTARG) delete sess.vars.OPTARG; }
    var arg = argv[ind - 1];
    if (sub === 1) {
      if (arg === undefined || arg.charAt(0) !== "-" || arg === "-") { unsetArg(); return finish("?", 1); }
      if (arg === "--") { ind++; unsetArg(); return finish("?", 1); }
    }
    var c = arg.charAt(sub);
    sub++;
    function advance() { if (sub >= arg.length) { ind++; sub = 1; } }
    var k = spec.indexOf(c);
    if (c === ":" || k < 0) {
      if (silent) S.setVar(sess, "OPTARG", c); else { unsetArg(); errl(io, sess.argv0 + ": illegal option -- " + c); }
      advance();
      return finish("?", 0);
    }
    if (spec.charAt(k + 1) === ":") {
      if (sub < arg.length) { S.setVar(sess, "OPTARG", arg.slice(sub)); ind++; sub = 1; return finish(c, 0); }
      var val = argv[ind];
      if (val === undefined) {
        ind++; sub = 1;
        if (silent) { S.setVar(sess, "OPTARG", c); return finish(":", 0); }
        unsetArg(); errl(io, sess.argv0 + ": option requires an argument -- " + c);
        return finish("?", 0);
      }
      S.setVar(sess, "OPTARG", val); ind += 2; sub = 1;
      return finish(c, 0);
    }
    unsetArg();
    advance();
    return finish(c, 0);
  };

  /* ================================================================== bash [-nxeu] [-c CMD | FILE ARGS] */
  function syntaxErr(name, text, e) {
    var msgs = [name + ": line " + (e.line || 1) + ": " + e.message.replace(/^bash: /, "")];
    var src = String(text).split("\n")[(e.line || 1) - 1];
    if (/near unexpected token/.test(e.message) && src !== undefined) msgs.push(name + ": line " + (e.line || 1) + ": `" + src.trim() + "'");
    return msgs;
  }
  M3.syntaxErr = syntaxErr;
  var bashOrig = CMDS.bash;
  CMDS.bash = function (args, io, sess) {
    var a = args.slice(1), o = {}, check = false, cmd = null;
    while (a.length && /^[-+]/.test(a[0]) && a[0] !== "-" && a[0] !== "--") {
      var x = a.shift();
      if (x === "-c") { cmd = a.shift() || ""; break; }
      if (x === "-o" || x === "+o") { var nm = a.shift(); if (/^(errexit|nounset|pipefail|xtrace|errtrace)$/.test(nm)) o[nm] = x === "-o"; continue; }
      if (x === "--version") { out(io, "GNU bash, version 5.2.21(1)-release (x86_64-pc-linux-gnu)\n"); return 0; }
      if (x === "--help" || x === "-l" || x === "-i" || x === "--login" || x === "--norc" || x === "--noprofile") { if (x === "--help") return bashOrig(args, io, sess); continue; }
      for (var j = 1; j < x.length; j++) {
        var ch = x.charAt(j);
        if (ch === "n") check = true; else if (ch === "x") o.xtrace = x.charAt(0) === "-"; else if (ch === "e") o.errexit = x.charAt(0) === "-"; else if (ch === "u") o.nounset = x.charAt(0) === "-"; else if (ch === "E") o.errtrace = true;
        else if (ch === "c") { cmd = a.shift() || ""; break; }
        else if (ch !== "v" && ch !== "l" && ch !== "i") { errl(io, "bash: " + x + ": invalid option\nUsage:\tbash [GNU long option] [option] ...\n\tbash [GNU long option] [option] script-file ..."); return 2; }
      }
      if (cmd !== null) break;
    }
    if (a[0] === "--") a.shift();
    if (cmd !== null) {
      var c = S.childSession(sess); c.positional = a.slice(1); c.argv0 = a[0] || "bash"; Object.keys(o).forEach(function (k) { c.opts[k] = o[k]; });
      if (check) { try { S.parse(cmd); return 0; } catch (e) { if (e instanceof S.ParseError) { errl(io, "bash: -c: line " + (e.line || 1) + ": " + e.message.replace(/^bash: /, "")); return 2; } throw e; } }
      c.scriptName = "bash";
      try { return S.runSource(c, cmd, io); } catch (e) { if (e instanceof S.ExitSignal) return e.code; if (e instanceof ShError) { errl(io, e.message); return e.code; } throw e; }
    }
    if (!a.length) return bashOrig(args, io, sess);
    var file = a[0];
    var rf = S.readFile(sess, file);
    if (rf.error) { errl(io, "bash: " + file + ": " + S.ERRTEXT[rf.error]); return 127; }
    if (check) {
      try { S.parse(rf.content); return 0; }
      catch (e) { if (e instanceof S.ParseError) { syntaxErr(file, rf.content, e).forEach(function (l) { errl(io, l); }); return 2; } throw e; }
    }
    var c2 = S.childSession(sess);
    c2.argv0 = file; c2.scriptName = file; c2.positional = a.slice(1); c2.isScript = true;
    Object.keys(o).forEach(function (k) { c2.opts[k] = o[k]; });
    return runText(c2, rf.content, io, sess);
  };
  CMDS.sh = CMDS.bash;
  function runText(c, text, io, parent) { return S.runScriptBody(c, text, io, parent); }

  /* ================================================================== mktemp */
  CMDS.mktemp = function (args, io, sess) {
    var o = optsFlat("mktemp", args, { flags: "dqtu", vals: "p", long: { directory: "d", quiet: "q", tmpdir: "p=", "dry-run": "u" } });
    var tmpl = o.rest[0] || "tmp.XXXXXXXXXX";
    var m = /(X{3,})$/.exec(tmpl.replace(/\.[^./X]*$/, ""));
    var tail = /X*(\.[^./X]*)?$/.exec(tmpl);
    var xs = /(X+)(\.[^./]*)?$/.exec(tmpl);
    if (!xs || xs[1].length < 3) { errl(io, "mktemp: too few X's in template '" + tmpl + "'"); return 1; }
    var dir;
    if (tmpl.indexOf("/") >= 0) dir = "";
    else if (o.p !== undefined || o.t || !o.rest.length) dir = (typeof o.p === "string" && o.p) || S.getVar(sess, "TMPDIR") || "/tmp";
    else dir = "";
    var sys = sess.sys;
    sys.mktempSeq = (sys.mktempSeq || 0) + 1;
    var rnd = M2.hashChars("mktemp" + sys.mktempSeq + tmpl, xs[1].length, "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789");
    var name = tmpl.slice(0, xs.index) + rnd + (xs[2] || "");
    var path = dir ? dir.replace(/\/$/, "") + "/" + name : name;
    if (!o.u) {
      if (o.d) {
        var pr = S.lookup(sess, path.replace(/\/[^/]*$/, "") || "/");
        if (!pr.node || !S.can(sess, pr.node, "w")) { if (!o.q) errl(io, "mktemp: failed to create directory via template '" + path.replace(rnd, xs[1]) + "': " + (pr.node ? "Permission denied" : "No such file or directory")); return 1; }
        var abs = S.absPath(sess, path), i = abs.lastIndexOf("/"), parent = S.lookup(sess, abs.slice(0, i) || "/").node;
        parent.children[abs.slice(i + 1)] = S.dirNode(448, sess.uid, sess.gid, sys.now);
      } else {
        var e = S.writeFile(sess, path, "", false);
        if (e) { if (!o.q) errl(io, "mktemp: failed to create file via template '" + path.replace(rnd, xs[1]) + "': " + S.ERRTEXT[e]); return 1; }
        var n = S.lookup(sess, path).node; n.mode = 384;
      }
    }
    out(io, path + "\n");
    return 0;
  };

  /* ================================================================== small helpers scripts use */
  CMDS.nproc = function (args, io) { out(io, "2\n"); return 0; };
  CMDS.logger = function (args, io, sess) {
    var o = optsFlat("logger", args, { flags: "is", vals: "tp", long: { tag: "t=", priority: "p=", stderr: "s" } });
    var msg = o.rest.length ? o.rest.join(" ") : String(io.stdin || "").replace(/\n$/, "");
    var tag = o.t || sess.user;
    var prio = { emerg: 0, alert: 1, crit: 2, err: 3, error: 3, warning: 4, warn: 4, notice: 5, info: 6, debug: 7 }[String(o.p || "user.notice").split(".").pop()];
    msg.split("\n").forEach(function (m) {
      if (M2.jadd) M2.jadd(sess.sys, tag, null, m, null, prio == null ? 5 : prio);
      M2.writeRoot(sess.sys, "/var/log/syslog", M2.ymd(sess.sys.now) + "T" + M2.tod(sess.sys.now) + ".000000+00:00 " + sess.sys.host + " " + tag + ": " + m + "\n", true);
      if (o.s) errl(io, "<" + (prio == null ? 13 : 8 + prio) + ">" + M2.jdate(sess.sys.now) + " " + tag + ": " + m);
    });
    return 0;
  };
  CMDS.timeout = function (args, io, sess) {
    var a = args.slice(1);
    while (a.length && /^-/.test(a[0])) { var f = a.shift(); if (/^(-s|--signal|-k|--kill-after)$/.test(f)) a.shift(); }
    if (a.length < 2 || !/^\d+(\.\d+)?[smhd]?$/.test(a[0])) { errl(io, "timeout: invalid time interval '" + (a[0] || "") + "'\nTry 'timeout --help' for more information."); return 125; }
    return S.runCommand(sess, a.slice(1), io);
  };
  function readInputs(sess, io, files, name) {
    if (!files.length || (files.length === 1 && files[0] === "-")) return [String(io.stdin || "")];
    var res = [];
    for (var i = 0; i < files.length; i++) {
      if (files[i] === "-") { res.push(String(io.stdin || "")); continue; }
      var r = S.readFile(sess, files[i]);
      if (r.error) throw new ShError(name + ": " + files[i] + ": " + S.ERRTEXT[r.error], 1);
      res.push(r.content);
    }
    return res;
  }
  CMDS.paste = function (args, io, sess) {
    var o = optsFlat("paste", args, { flags: "s", vals: "d", long: { serial: "s", delimiters: "d=" } });
    var d = o.d === undefined ? "\t" : o.d.replace(/\\t/g, "\t").replace(/\\n/g, "\n");
    var texts = readInputs(sess, io, o.rest, "paste").map(lines);
    if (o.s) { texts.forEach(function (ls) { var s = ""; ls.forEach(function (l, i) { s += (i ? d.charAt((i - 1) % d.length) : "") + l; }); out(io, s + "\n"); }); return 0; }
    var n = Math.max.apply(null, texts.map(function (t) { return t.length; }));
    for (var r = 0; r < n; r++) out(io, texts.map(function (t) { return t[r] === undefined ? "" : t[r]; }).reduce(function (acc, v, i) { return i ? acc + d.charAt((i - 1) % d.length) + v : v; }, "") + "\n");
    return 0;
  };
  CMDS.column = function (args, io, sess) {
    var o = optsFlat("column", args, { flags: "t", vals: "so", long: { table: "t", separator: "s=", "output-separator": "o=" } });
    var ls = lines(readInputs(sess, io, o.rest, "column").join(""));
    if (!o.t) { ls.forEach(function (l) { out(io, l + "\n"); }); return 0; }
    var sep = o.s ? new RegExp("[" + o.s.replace(/[\]\\^-]/g, "\\$&") + "]") : /\s+/;
    var rows = ls.filter(function (l) { return l.trim() !== ""; }).map(function (l) { return (o.s ? l : l.trim()).split(sep); });
    var w = [];
    rows.forEach(function (r) { r.forEach(function (c, i) { w[i] = Math.max(w[i] || 0, c.length); }); });
    rows.forEach(function (r) { out(io, r.map(function (c, i) { return i === r.length - 1 ? c : rpad(c, w[i]) + (o.o === undefined ? "  " : o.o); }).join("").replace(/\s+$/, "") + "\n"); });
    return 0;
  };
  CMDS.comm = function (args, io, sess) {
    var o = optsFlat("comm", args, { flags: "123" });
    if (o.rest.length !== 2) { errl(io, "comm: missing operand\nTry 'comm --help' for more information."); return 1; }
    var t = readInputs(sess, io, o.rest, "comm").map(lines), a = t[0], b = t[1], i = 0, j = 0;
    function emit(col, v) { if (o[String(col)]) return; var pre = ""; for (var k = 1; k < col; k++) if (!o[String(k)]) pre += "\t"; out(io, pre + v + "\n"); }
    while (i < a.length || j < b.length) {
      if (j >= b.length || (i < a.length && a[i] < b[j])) emit(1, a[i++]);
      else if (i >= a.length || b[j] < a[i]) emit(2, b[j++]);
      else { emit(3, a[i]); i++; j++; }
    }
    return 0;
  };

  // df --output=pcent,target... (handy in scripts: no awk needed to pick a column)
  var dfOrig = CMDS.df;
  CMDS.df = function (args, io, sess) {
    var oi = -1; args.forEach(function (x, i) { if (/^--output(=|$)/.test(x)) oi = i; });
    if (oi < 0) return dfOrig(args, io, sess);
    var fields = (args[oi].split("=")[1] || "source,fstype,size,used,avail,pcent,target").split(",");
    var HEAD = { source: "Filesystem", fstype: "Type", size: "1K-blocks", used: "Used", avail: "Avail", pcent: "Use%", target: "Mounted on", file: "File" };
    var bad = fields.filter(function (f) { return !HEAD[f]; });
    if (bad.length) { errl(io, "df: '" + bad[0] + "': not a valid field for --output\nTry 'df --help' for more information."); return 1; }
    var paths = args.slice(1).filter(function (x, i) { return i + 1 !== oi && !/^-/.test(x); }), code = 0, rows = [];
    if (paths.length) paths.forEach(function (p) { var r = S.lookup(sess, p); if (!r.node && r.error !== "EACCES") { errl(io, "df: " + p + ": No such file or directory"); code = 1; return; } var m = M2.mountOf(sess.sys, r.path || S.absPath(sess, p)); if (m) rows.push({ m: m, file: p }); });
    else rows = sess.sys.mounts.map(function (m) { return { m: m, file: "-" }; });
    var table = [fields.map(function (f) { return HEAD[f]; })];
    rows.forEach(function (x) { var u = M2.mountUsage(sess.sys, x.m); table.push(fields.map(function (f) { return f === "source" ? x.m.src : f === "fstype" ? x.m.fstype : f === "size" ? String(u.size) : f === "used" ? String(u.used) : f === "avail" ? String(u.avail) : f === "pcent" ? u.pct + "%" : f === "target" ? x.m.target : x.file; })); });
    var w = fields.map(function (f, i) { return Math.max.apply(null, table.map(function (r) { return r[i].length; })); });
    table.forEach(function (r) { out(io, r.map(function (c, i) { var left = /^(source|fstype|target|file)$/.test(fields[i]); return left ? (i === r.length - 1 ? c : rpad(c, w[i])) : U.pad(c, w[i]); }).join(" ").replace(/\s+$/, "") + "\n"); });
    return code;
  };

  /* ================================================================== ShellCheck (a subset of the real rules) */
  var SEV = { error: 0, warning: 1, info: 2, style: 3 };
  var RULES = {
    SC2148: ["error", "Tips depend on target shell and yours is unknown. Add a shebang or a 'shell' directive."],
    SC2086: ["info", "Double quote to prevent globbing and word splitting."],
    SC2068: ["error", "Double quote array expansions to avoid re-splitting elements."],
    SC2048: ["warning", "Use \"$@\" (with quotes) to prevent whitespace problems."],
    SC2046: ["warning", "Quote this to prevent word splitting."],
    SC2045: ["error", "Iterating over ls output is fragile. Use globs."],
    SC2013: ["info", "To read lines rather than words, pipe/redirect to a 'while read' loop."],
    SC2006: ["style", "Use $(...) notation instead of legacy backticks `...`."],
    SC2164: ["warning", "Use 'cd ... || exit' or 'cd ... || return' in case cd fails."],
    SC2162: ["info", "read without -r will mangle backslashes."],
    SC2155: ["warning", "Declare and assign separately to avoid masking return values."],
    SC2002: ["style", "Useless cat. Consider 'cmd < file | ..' or 'cmd file | ..' instead."],
    SC2181: ["style", "Check exit code directly with e.g. 'if mycmd;', not indirectly with $?."],
    SC2115: ["warning", "Use \"${var:?}\" to ensure this never expands to / ."],
    SC2034: ["warning", "%s appears unused. Verify use (or export if used externally)."],
    SC2154: ["warning", "%s is referenced but not assigned."],
    SC2004: ["style", "$/${} is unnecessary on arithmetic variables."],
    SC2009: ["info", "Consider using pgrep instead of grepping ps output."],
    SC2059: ["info", "Don't use variables in the printf format string. Use printf '..%s..' \"$foo\"."],
    SC1072: ["error", "Unexpected syntax. Fix any mentioned problems and try again."]
  };
  var SPECIAL_VARS = /^(HOME|PATH|USER|LOGNAME|PWD|OLDPWD|SHELL|HOSTNAME|LANG|TERM|EDITOR|IFS|PS1|PS2|RANDOM|LINENO|SECONDS|BASH_SOURCE|BASH_REMATCH|FUNCNAME|OPTARG|OPTIND|REPLY|UID|EUID|PPID|TMPDIR|BASH_VERSION|PIPESTATUS|HISTFILE|[0-9]+|[@*#?$!-])$/;

  // Scan one line of code (no comments) for $-expansions and backticks, tracking quotes, [[ ]], (( )) and assignments.
  function scanLine(line) {
    var found = [];   // {kind: "var"|"subst"|"arith"|"tick", name, col, quoted, ctx, text}
    var q = null, i = 0, dbr = 0, wordStart = true, inAssign = false, cmdPos = true;
    function readBal(k, open, close) { var d = 0; for (var j = k; j < line.length; j++) { var c = line.charAt(j); if (c === "\\") { j++; continue; } if (c === open) d++; else if (c === close) { d--; if (d === 0) return j; } } return line.length - 1; }
    while (i < line.length) {
      var c = line.charAt(i);
      if (q === "'") { if (c === "'") q = null; i++; continue; }
      if (c === "\\") { i += 2; wordStart = false; continue; }
      if (!q && (c === " " || c === "\t")) { wordStart = true; inAssign = false; i++; continue; }
      if (!q && (c === ";" || c === "|" || c === "&" || c === ")" || c === "(")) { wordStart = true; inAssign = false; cmdPos = true; i++; continue; }
      if (!q && wordStart) {
        var rest = line.slice(i);
        if (/^\[\[(\s|$)/.test(rest)) { dbr++; i += 2; continue; }
        if (/^\]\](\s|$|;)/.test(rest)) { dbr = Math.max(0, dbr - 1); i += 2; continue; }
        if (/^\(\(/.test(rest)) { var e0 = readBal(i, "(", ")"); found.push({ kind: "arith", col: i, text: line.slice(i + 2, e0 - 1) }); i = e0 + 1; continue; }
        var kw = /^(then|do|else|elif|if|while|until|\{|!|time)(?=\s|$)/.exec(rest);
        if (kw && cmdPos) { i += kw[0].length; continue; }
        var am = /^(?:(?:local|export|declare|readonly|typeset)\s+(?:-\w+\s+)*)?([A-Za-z_]\w*)(\+?=)/.exec(rest);
        if (am && (cmdPos || /^(local|export|declare|readonly|typeset)\b/.test(rest))) { inAssign = true; i += am[0].length; wordStart = false; continue; }
        cmdPos = false;
      }
      wordStart = false;
      if (c === "'") { q = "'"; i++; continue; }
      if (c === "\"") { q = q === "\"" ? null : "\""; i++; continue; }
      if (c === "`") { var e1 = line.indexOf("`", i + 1); found.push({ kind: "tick", col: i, quoted: !!q }); i = e1 < 0 ? line.length : e1 + 1; continue; }
      if (c === "$") {
        var n1 = line.charAt(i + 1);
        if (n1 === "(" && line.charAt(i + 2) === "(") { var e2 = readBal(i + 1, "(", ")"); found.push({ kind: "arith", col: i, text: line.slice(i + 3, e2 - 1) }); i = e2 + 1; continue; }
        if (n1 === "(") { var e3 = readBal(i + 1, "(", ")"); found.push({ kind: "subst", col: i, quoted: !!q, ctx: dbr ? "dbr" : inAssign ? "assign" : "arg", text: line.slice(i + 2, e3) }); i = e3 + 1; continue; }
        if (n1 === "{") { var e4 = readBal(i + 1, "{", "}"); var body = line.slice(i + 2, e4); var nm = /^[#!]?([A-Za-z_]\w*|[0-9]+|[@*#?$!])/.exec(body); found.push({ kind: "var", col: i, quoted: !!q, ctx: dbr ? "dbr" : inAssign ? "assign" : "arg", name: nm ? nm[1] : "", body: body, braces: true }); i = e4 + 1; continue; }
        var m = /^([A-Za-z_]\w*|[0-9]|[@*#?$!-])/.exec(line.slice(i + 1));
        if (m) { found.push({ kind: "var", col: i, quoted: !!q, ctx: dbr ? "dbr" : inAssign ? "assign" : "arg", name: m[1] }); i += 1 + m[1].length; continue; }
      }
      i++;
    }
    return found;
  }
  function stripComment(line) {
    var q = null;
    for (var i = 0; i < line.length; i++) {
      var c = line.charAt(i);
      if (c === "\\" && q !== "'") { i++; continue; }
      if (q) { if (c === q) q = null; continue; }
      if (c === "'" || c === "\"") { q = c; continue; }
      if (c === "#" && (i === 0 || /[\s;]/.test(line.charAt(i - 1))) && line.charAt(i - 1) !== "$") return line.slice(0, i);
    }
    return line;
  }
  function lintText(text) {
    var src = String(text).replace(/\r/g, "").split("\n");
    if (src.length && src[src.length - 1] === "") src.pop();
    var issues = [], disabledAll = {}, disabledNext = null, seenCode = false;
    function add(line, col, code, arg) { issues.push({ line: line, col: col, code: code, arg: arg }); }
    try { S.parse(String(text)); }
    catch (e) { if (e instanceof S.ParseError) { add(e.line || 1, 0, "SC1072"); return { issues: issues, src: src }; } throw e; }
    if (!/^#!/.test(src[0] || "")) add(1, 0, "SC2148");
    var code = [], heredoc = null;
    src.forEach(function (raw, idx) {
      if (heredoc) { if (raw.replace(/^\t+/, "") === heredoc) heredoc = null; code.push(""); return; }
      var dm = /^\s*#\s*shellcheck\s+disable=([\w,]+)/.exec(raw);
      if (dm) { var list = dm[1].split(","); if (!seenCode) list.forEach(function (x) { disabledAll[x] = true; }); else disabledNext = { line: idx + 2, codes: list }; code.push(""); return; }
      var c = idx === 0 && /^#!/.test(raw) ? "" : stripComment(raw);
      if (c.trim()) seenCode = true;
      if (disabledNext && disabledNext.line === idx + 1) disabledNext.lineReal = idx + 1;
      var hm = /<<-?\s*(['"]?)([A-Za-z_]\w*)\1/.exec(c);
      if (hm) heredoc = hm[2];
      code.push(c);
    });
    // assignments and references, for SC2034 / SC2154
    var assigned = {}, referenced = {}, firstRef = {};
    code.forEach(function (c, idx) {
      var re = /(?:^|[\s;&|(])(?:(?:local|export|declare|readonly|typeset)\s+(?:-\w+\s+)*)?([A-Za-z_]\w*)\+?=/g, m;
      while ((m = re.exec(c))) { if (!assigned[m[1]]) assigned[m[1]] = { line: idx + 1, col: m.index + m[0].indexOf(m[1]), exported: /\bexport\s/.test(c) }; }
      var fm = /\bfor\s+([A-Za-z_]\w*)\s+in\b/.exec(c); if (fm && !assigned[fm[1]]) assigned[fm[1]] = { line: idx + 1, col: c.indexOf(fm[1]), loop: true };
      var rm2 = /(?:^|[\s;&|]|while\s+|if\s+)read\s+((?:-[a-zA-Z]+\s+(?:\S+\s+)?)*)([A-Za-z_][\w\s]*)/.exec(c);
      if (rm2) rm2[2].trim().split(/\s+/).forEach(function (n) { if (/^[A-Za-z_]\w*$/.test(n) && !assigned[n]) assigned[n] = { line: idx + 1, col: c.indexOf(n), read: true }; });
      var gm = /\bgetopts\s+\S+\s+([A-Za-z_]\w*)/.exec(c); if (gm && !assigned[gm[1]]) assigned[gm[1]] = { line: idx + 1, col: c.indexOf(gm[1]), used: true };
      var xm = /\bexport\s+([A-Za-z_]\w*)\s*$/.exec(c); if (xm) referenced[xm[1]] = true;
      var um = /\b(?:unset|declare\s+-p)\s+([A-Za-z_]\w*)/.exec(c); if (um) referenced[um[1]] = true;
      scanLine(c).forEach(function (f) {
        if (f.kind === "var" && f.name) { referenced[f.name] = true; if (!firstRef[f.name]) firstRef[f.name] = { line: idx + 1, col: f.col }; }
        if (f.kind === "arith" || f.kind === "subst") { (f.text.match(/[A-Za-z_]\w*/g) || []).forEach(function (n) { referenced[n] = true; }); (f.text.match(/\$\{?([A-Za-z_]\w*)/g) || []).forEach(function (n) { var nn = n.replace(/^\$\{?/, ""); if (!firstRef[nn]) firstRef[nn] = { line: idx + 1, col: f.col }; }); }
      });
      var am2 = /\[\[\s+-v\s+([A-Za-z_]\w*)/.exec(c); if (am2) referenced[am2[1]] = true;
    });
    code.forEach(function (c, idx) {
      var ln = idx + 1;
      if (!c.trim()) return;
      scanLine(c).forEach(function (f) {
        if (f.kind === "tick") add(ln, f.col, "SC2006");
        if (f.kind === "arith" && /\$\{?[A-Za-z_]/.test(f.text)) add(ln, f.col + (f.text ? c.indexOf("$", f.col + 2) - f.col : 0), "SC2004");
        if (f.kind === "subst" && !f.quoted && f.ctx === "arg") {
          var forIn = new RegExp("\\bfor\\s+\\w+\\s+in\\s+[^;]*$").test(c.slice(0, f.col));
          if (forIn && /^\s*ls\b/.test(f.text)) add(ln, f.col, "SC2045");
          else if (forIn && /^\s*cat\b/.test(f.text)) add(ln, f.col, "SC2013");
          else if (!/^\s*case\b/.test(c.slice(0, f.col).replace(/.*[;&|]/, ""))) add(ln, f.col, "SC2046");
        }
        if (f.kind === "var" && !f.quoted && f.ctx === "arg") {
          var before = c.slice(0, f.col);
          if (/\bcase\s+$/.test(before)) return;
          if (f.name === "@") add(ln, f.col, "SC2068");
          else if (f.name === "*") add(ln, f.col, "SC2048");
          else if (/^[#?$!-]$/.test(f.name)) return;
          else if (f.braces && /^#/.test(f.body)) return;
          else add(ln, f.col, "SC2086");
        }
      });
      var cdRe = /(^|[;&|]\s*|\b(?:then|do|else)\s+|^\s*)cd(\s+[^;&|]*)?(?=;|$|\|(?!\|)|&(?!&))/g, cm;
      while ((cm = cdRe.exec(c))) {
        var pre = c.slice(0, cm.index + cm[1].length);
        var after = c.slice(cm.index + cm[0].length);
        if (/(&&|\|\|)\s*$/.test(pre) || /^\s*(\|\||&&)/.test(after) || /\b(if|while|until)\s+(!\s*)?$/.test(pre)) continue;
        add(ln, cm.index + cm[1].length, "SC2164");
      }
      var rd = /(^|[;&|]\s*|\b(?:while|if|then|do|until)\s+|^\s*)read(\s+[^;&|]*)?/g, rmm;
      while ((rmm = rd.exec(c))) { if (!/\s-\w*r/.test(rmm[2] || "")) add(ln, rmm.index + rmm[1].length, "SC2162"); }
      var dm2 = /\b(local|export|declare|readonly|typeset)\s+(?:-\w+\s+)*[A-Za-z_]\w*=["']?(\$\(|`)/.exec(c);
      if (dm2) add(ln, dm2.index + dm2[0].indexOf(dm2[1]) + dm2[1].length + 1, "SC2155");
      var cat = /(^|[;&|(]\s*|^\s*)cat\s+([^\s|;&<>-][^\s|;&<>]*)\s*\|/.exec(c);
      if (cat) add(ln, cat.index + cat[1].length + 4, "SC2002");
      var qm = /\[\[?\s*"?\$\?"?\s*(-ne|-eq|!=|==|=|-gt|-lt)\s/.exec(c);
      if (qm) add(ln, c.indexOf("$?"), "SC2181");
      var rmf = /\brm\s+(-\w*[rR]\w*\s+)+("?)\$\{?([A-Za-z_]\w*)(\}?)\2?\/\*?/.exec(c);
      if (rmf && !/:\?/.test(rmf[0])) add(ln, c.indexOf("$", rmf.index), "SC2115");
      if (/\bps\s+[-\w]*\s*\|\s*grep\b/.test(c)) add(ln, c.search(/\bps\b/), "SC2009");
      var pf = /\bprintf\s+("[^"]*\$[A-Za-z_{][^"]*"|\$[A-Za-z_{])/.exec(c);
      if (pf) add(ln, pf.index + 7, "SC2059");
    });
    Object.keys(assigned).forEach(function (n) {
      var a = assigned[n];
      if (referenced[n] || a.exported || a.used || /^(OPTIND|IFS|PATH|_)$/.test(n)) return;
      if (/^[A-Z_][A-Z0-9_]*$/.test(n) && a.exportedLater) return;
      add(a.line, a.col, "SC2034", n);
    });
    Object.keys(firstRef).forEach(function (n) {
      if (assigned[n] || SPECIAL_VARS.test(n) || !/[a-z]/.test(n)) return;
      add(firstRef[n].line, firstRef[n].col, "SC2154", n);
    });
    issues = issues.filter(function (x) {
      if (disabledAll[x.code]) return false;
      var lineText = src[x.line - 2] || "";
      var dm3 = /^\s*#\s*shellcheck\s+disable=([\w,]+)/.exec(lineText);
      return !(dm3 && dm3[1].split(",").indexOf(x.code) >= 0);
    });
    issues.sort(function (a, b) { return a.line - b.line || a.col - b.col; });
    return { issues: issues, src: src };
  }
  function ruleMsg(x) { return RULES[x.code][1].replace("%s", x.arg || ""); }
  M3.lint = function (text) { return lintText(text).issues.map(function (x) { return { line: x.line, col: x.col + 1, code: x.code, severity: RULES[x.code][0], message: ruleMsg(x) }; }); };
  CMDS.shellcheck = function (args, io, sess) {
    var o = optsFlat("shellcheck", args, { flags: "xaCV", vals: "fSesoW", long: { format: "f=", severity: "S=", exclude: "e=", "external-sources": "x", version: "V", color: "C", shell: "s=" } });
    if (o.V) { out(io, "ShellCheck - shell script analysis tool\nversion: 0.9.0\nlicense: GNU General Public License, version 3\nwebsite: https://www.shellcheck.net\n"); return 0; }
    if (!o.rest.length) { errl(io, "No files specified.\n\nUsage: shellcheck [OPTIONS...] FILES..."); return 3; }
    var minSev = SEV[o.S || "style"]; if (minSev === undefined) { errl(io, "Invalid severity: " + o.S); return 3; }
    var excl = (o.e || "").split(",").filter(Boolean).map(function (x) { return /^SC/.test(x) ? x : "SC" + x; });
    var fmt = o.f || "tty", any = false, failed = false, codes = [];
    o.rest.forEach(function (f) {
      var r = S.readFile(sess, f);
      if (r.error) { errl(io, f + ": " + (r.error === "ENOENT" ? "does not exist" : S.ERRTEXT[r.error])); failed = true; return; }
      var res = lintText(r.content);
      var list = res.issues.filter(function (x) { return SEV[RULES[x.code][0]] <= minSev && excl.indexOf(x.code) < 0; });
      if (!list.length) return;
      any = true;
      if (fmt === "gcc") { list.forEach(function (x) { var sev = RULES[x.code][0]; out(io, f + ":" + x.line + ":" + (x.col + 1) + ": " + (sev === "error" ? "error" : sev === "warning" ? "warning" : "note") + ": " + ruleMsg(x) + " [" + x.code + "]\n"); }); return; }
      if (fmt === "quiet") return;
      var byLine = {};
      list.forEach(function (x) { (byLine[x.line] = byLine[x.line] || []).push(x); if (codes.indexOf(x.code) < 0) codes.push(x.code); });
      Object.keys(byLine).map(Number).sort(function (a, b) { return a - b; }).forEach(function (ln) {
        out(io, "\nIn " + f + " line " + ln + ":\n" + (res.src[ln - 1] || "") + "\n");
        byLine[ln].forEach(function (x) { out(io, new Array(x.col + 1).join(" ") + "^-- " + x.code + " (" + RULES[x.code][0] + "): " + ruleMsg(x) + "\n"); });
      });
    });
    if (any && fmt === "tty") { out(io, "\nFor more information:\n"); codes.forEach(function (c) { var m = RULES[c][1].replace("%s ", "").replace("%s", ""); out(io, "  https://www.shellcheck.net/wiki/" + c + " -- " + (m.length > 44 ? m.slice(0, 41) + "..." : m) + "\n"); }); }
    return failed ? 2 : any ? 1 : 0;
  };

  /* ================================================================== man pages */
  var MAN = S.MAN;
  MAN.getopts = { syn: "getopts optstring name [arg ...]", desc: "Parse short options (-a, -f FILE) in a script, one per call, in a while loop. A colon after a letter means it takes a value, put in $OPTARG. A leading colon in optstring turns off getopts' own error messages.", opts: [["while getopts \"hvf:\" opt; do", "loop over the options"], ["case $opt in f) file=$OPTARG ;; esac", "handle each one"], ["shift $((OPTIND - 1))", "afterwards, drop the options so $1 is the first real argument"]] };
  MAN.trap = { syn: "trap [-lp] [[ACTION] SIGNAL ...]", desc: "Run ACTION when the shell gets a signal or reaches a point: EXIT (the script ends, however it ends), ERR (a command fails), INT (Ctrl+C), TERM.", opts: [["trap 'rm -f \"$tmp\"' EXIT", "clean up when the script exits"], ["trap 'echo \"failed at line $LINENO\"' ERR", "report where a command failed"], ["trap - EXIT", "remove the trap"], ["-p", "show the traps that are set"]] };
  MAN.mktemp = { syn: "mktemp [-d] [-p DIR] [TEMPLATE]", desc: "Create a temporary file (or directory) with a unique, hard-to-guess name and print its name. Safer than picking a fixed name in /tmp.", opts: [["(no options)", "a file like /tmp/tmp.k3Jq0aZx9P, readable only by you"], ["-d", "a directory instead"], ["-p DIR", "create it in DIR"], ["TEMPLATE", "e.g. backup.XXXXXX: the X's are replaced"]] };
  MAN.shellcheck = { syn: "shellcheck [-S SEVERITY] [-e CODES] [-f FORMAT] FILE...", desc: "Find bugs in shell scripts: unquoted variables, cd without a check, unused or unset variables, and more. Each finding has a code (SC2086...) explained on www.shellcheck.net. Exits 1 if it found anything, 0 if the script is clean.", opts: [["-S warning", "only show warnings and errors (levels: error, warning, info, style)"], ["-e SC2034", "ignore these codes"], ["-f gcc", "one line per finding: file:line:col: level: message [code]"], ["# shellcheck disable=SC2086", "a comment on the line before silences a code there"]] };
  MAN.nproc = { syn: "nproc", desc: "Print the number of CPUs.", opts: [] };
  MAN.logger = { syn: "logger [-t TAG] [-p PRIORITY] MESSAGE", desc: "Write a message to the system log (journalctl and /var/log/syslog).", opts: [["-t TAG", "label the line (default: your user name)"], ["-p user.err", "priority: err, warning, info..."], ["-s", "also print it to stderr"]] };
  MAN.timeout = { syn: "timeout DURATION COMMAND [ARG]...", desc: "Run COMMAND, and kill it if it's still running after DURATION (e.g. 10s, 5m). Exit code 124 means it timed out.", opts: [] };
  MAN.paste = { syn: "paste [-s] [-d DELIMS] [FILE]...", desc: "Join files side by side, line by line; with -s, join the lines of each file into one line.", opts: [["-s", "join all lines of a file into one"], ["-d ,", "use , between the pieces instead of a tab"]] };
  MAN.column = { syn: "column -t [-s SEP]", desc: "Line text up in columns.", opts: [["-t", "make a table"], ["-s ,", "split columns on commas (default: whitespace)"]] };
  MAN.comm = { syn: "comm [-123] FILE1 FILE2", desc: "Compare two sorted files: column 1 lines only in FILE1, column 2 only in FILE2, column 3 in both.", opts: [["-12", "show only lines in both"], ["-23", "show only lines unique to FILE1"]] };

  /* ================================================================== install the new binaries; shellcheck is an apt package */
  var NEW = ["mktemp", "nproc", "logger", "timeout", "paste", "column", "comm"];
  M2.CATALOG.push({ name: "shellcheck", ver: "0.9.0-1", arch: "amd64", section: "devel", size: 21564, desc: "lint tool for shell scripts", deps: [], bins: ["shellcheck"], sbins: [], installed: false, auto: false, archive: "noble" });
  function binPut(sys, path, impl) { M2.putRoot(sys, path, "\x7fELF:" + impl + " (simulated binary)\n", 493, 0, 0, Date.UTC(2024, 3, 8)); }
  S.SYS_HOOKS.push(function (sys) {
    NEW.forEach(function (b) { binPut(sys, "/usr/bin/" + b, b); });
    var p = sys.pkgs && sys.pkgs.shellcheck;
    if (p && p.installed) binPut(sys, "/usr/bin/shellcheck", "shellcheck");
  });
  // A lab machine that already has a package installed (as if apt install had run before).
  M3.preinstall = function (sys, name) {
    var p = sys.pkgs[name]; if (!p) return;
    p.installed = true; p.curVer = p.ver;
    p.bins.forEach(function (b) { binPut(sys, "/usr/bin/" + b, b); });
    p.sbins.forEach(function (b) { binPut(sys, "/usr/sbin/" + b, b); });
  };
})(typeof window !== "undefined" ? window : globalThis);
