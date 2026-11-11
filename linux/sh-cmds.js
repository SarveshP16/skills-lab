/* sudo learn — commands and shell builtins for the simulated Bash (sh-engine.js), plus the base contents of
   kc-web-01 (Ubuntu 24.04: /etc, /var/log, /home, /usr/bin...). GNU coreutils / grep / findutils / sed / gawk
   behaviour and messages, for the options a learner meets. */
(function (root) {
  "use strict";
  var S = root.ShEngine;
  var CMDS = S.CMDS, B = S.BUILTINS, NOW = S.NOW, DAY = S.DAY;
  var ShError = S.ShError, ERR = S.ERRTEXT;

  /* ================================================================== Helpers */
  // GNU-style option parsing. spec: {flags: "la", vals: "n", long: {all: "a", lines: "n="}}
  function opts(name, args, spec) {
    var o = {}, rest = [], i = 1, flags = spec.flags || "", vals = spec.vals || "", long = spec.long || {};
    for (; i < args.length; i++) {
      var a = args[i];
      if (a === "--") { rest = rest.concat(args.slice(i + 1)); break; }
      if (/^--[^-]/.test(a)) {
        var m = /^--([^=]+)(?:=(.*))?$/.exec(a), key = long[m[1]];
        if (m[1] === "help") { o.help = true; continue; }
        if (key === undefined) {
          var hits = Object.keys(long).filter(function (k) { return k.indexOf(m[1]) === 0; });
          if (hits.length === 1) key = long[hits[0]];
          else throw new ShError(name + ": unrecognized option '" + a + "'\nTry '" + name + " --help' for more information.", 2);
        }
        if (/=$/.test(key)) { var k2 = key.slice(0, -1); if (m[2] !== undefined) o[k2] = m[2]; else if (i + 1 < args.length) o[k2] = args[++i]; else throw new ShError(name + ": option '--" + m[1] + "' requires an argument\nTry '" + name + " --help' for more information.", 2); }
        else if (key) o[key] = m[2] === undefined ? true : m[2];
        continue;
      }
      if (a.charAt(0) === "-" && a.length > 1 && !(spec.numeric && /^-\d/.test(a))) {
        for (var j = 1; j < a.length; j++) {
          var c = a.charAt(j);
          if (vals.indexOf(c) >= 0) {
            var v = a.slice(j + 1);
            if (v === "") { if (i + 1 >= args.length) throw new ShError(name + ": option requires an argument -- '" + c + "'\nTry '" + name + " --help' for more information.", 2); v = args[++i]; }
            o[c] = v; break;
          }
          if (flags.indexOf(c) < 0) {
            if (spec.numeric && /\d/.test(c)) { o.num = a.slice(j); break; }
            throw new ShError(name + ": invalid option -- '" + c + "'\nTry '" + name + " --help' for more information.", spec.badCode || 2);
          }
          o[c] = true;
        }
        continue;
      }
      if (spec.numeric && /^-\d+$/.test(a)) { o.num = a.slice(1); continue; }
      rest.push(a);
    }
    return { o: o, rest: rest };
  }
  function out(io, s) { io.out(s); }
  function errl(io, s) { io.err(s + "\n"); }
  function note(io, s) { if (io.note && io.tty) io.note(s + "\n"); }
  function lines(text) { if (text == null || text === "") return []; var l = text.split("\n"); if (l[l.length - 1] === "") l.pop(); return l; }
  function joinLines(arr) { return arr.length ? arr.join("\n") + "\n" : ""; }
  function bytes(s) { return new TextEncoder().encode(s).length; }
  // Read each named file, or stdin when no files / "-". cb(text, name) ; returns exit status.
  function eachInput(name, files, io, sess, cb) {
    var code = 0;
    if (!files.length) files = ["-"];
    files.forEach(function (f) {
      if (f === "-") { cb(io.stdin || "", "-"); return; }
      var r = S.readFile(sess, f);
      if (r.error) { errl(io, name + ": " + f + ": " + ERR[r.error]); code = 1; return; }
      cb(r.content, f);
    });
    return code;
  }
  var MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  var WDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  function pad(n, w, ch) { n = String(n); while (n.length < w) n = (ch || " ") + n; return n; }
  function rpad(s, w) { s = String(s); while (s.length < w) s += " "; return s; }
  function lsDate(ms) {
    var d = new Date(ms);
    var recent = NOW - ms < 182 * DAY && ms <= NOW + 3600000;
    return MON[d.getUTCMonth()] + " " + pad(d.getUTCDate(), 2) + " " + (recent ? pad(d.getUTCHours(), 2, "0") + ":" + pad(d.getUTCMinutes(), 2, "0") : " " + d.getUTCFullYear());
  }
  function isoDate(ms) { var d = new Date(ms); return d.getUTCFullYear() + "-" + pad(d.getUTCMonth() + 1, 2, "0") + "-" + pad(d.getUTCDate(), 2, "0") + " " + pad(d.getUTCHours(), 2, "0") + ":" + pad(d.getUTCMinutes(), 2, "0") + ":" + pad(d.getUTCSeconds(), 2, "0"); }
  function modeStr(n) {
    var t = n.type === "d" ? "d" : n.type === "l" ? "l" : n.special ? "c" : "-";
    var m = n.mode, s = "";
    var bits = ["r", "w", "x"];
    for (var k = 8; k >= 0; k--) s += (m >> k) & 1 ? bits[(8 - k) % 3] : "-";
    s = s.split("");
    if (m & 2048) s[2] = s[2] === "x" ? "s" : "S";
    if (m & 1024) s[5] = s[5] === "x" ? "s" : "S";
    if (m & 512) s[8] = s[8] === "x" ? "t" : "T";
    return t + s.join("");
  }
  function octal(m) { return (m & 4095).toString(8); }
  function nodeSize(n) { return n.type === "d" ? 4096 : n.type === "l" ? n.target.length : n.special ? 0 : n.size != null ? n.size : bytes(n.content); }
  function blocks(n) { if (n.type === "d") return 4; var sz = nodeSize(n); return sz === 0 ? 0 : Math.ceil(sz / 4096) * 4; }
  function human(sz) {
    if (sz < 1024) return String(sz);
    var u = ["K", "M", "G", "T"], v = sz, i = -1;
    do { v /= 1024; i++; } while (v >= 1024 && i < u.length - 1);
    return (v < 10 ? (Math.ceil(v * 10) / 10).toFixed(1) : String(Math.ceil(v))) + u[i];
  }
  function quoteName(n) { return /[\s'"$`\\*?]/.test(n) ? "'" + n.replace(/'/g, "'\\''") + "'" : n; }
  function sortLines(a, b) {
    var x = a.toLowerCase().replace(/[^a-z0-9\s]/g, ""), y = b.toLowerCase().replace(/[^a-z0-9\s]/g, "");
    if (x !== y) return x < y ? -1 : 1;
    return a < b ? -1 : a > b ? 1 : 0;
  }
  function help(io, name) {
    var m = MAN[name];
    out(io, "Usage: " + (m ? m.syn.split("\n")[0] : name + " [OPTION]...") + "\n" + (m ? m.desc + "\n\n" + (m.opts || []).map(function (o) { return "  " + rpad(o[0], 22) + o[1]; }).join("\n") + "\n" : ""));
    return 0;
  }
  // POSIX regex (BRE / ERE) to a JavaScript RegExp source.
  function posixClasses(s) {
    return s.replace(/\[:(alpha|digit|alnum|upper|lower|space|blank|punct|xdigit|word):\]/g, function (m0, k) {
      return { alpha: "A-Za-z", digit: "0-9", alnum: "A-Za-z0-9", upper: "A-Z", lower: "a-z", space: "\\s", blank: " \\t", punct: "!-\\/:-@\\[-`{-~", xdigit: "0-9A-Fa-f", word: "\\w" }[k];
    });
  }
  function toJsRegex(src, ere) {
    var out = "", i = 0;
    while (i < src.length) {
      var c = src.charAt(i);
      if (c === "[") {
        var j = i + 1;
        if (src.charAt(j) === "^") j++;
        if (src.charAt(j) === "]") j++;
        while (j < src.length && src.charAt(j) !== "]") { if (src.slice(j, j + 2) === "[:") { var e = src.indexOf(":]", j); j = e < 0 ? j + 1 : e + 2; continue; } j++; }
        var cls = src.slice(i, j + 1);
        out += posixClasses(cls).replace(/\\(?![sSwWdD\-\]\[^\\tn])/g, "\\\\");
        i = j + 1; continue;
      }
      if (c === "\\") {
        var d = src.charAt(i + 1);
        if (!ere && /[(){}+?|]/.test(d)) { out += d; i += 2; continue; }
        if (d === "<" || d === ">") { out += "\\b"; i += 2; continue; }
        out += "\\" + d; i += 2; continue;
      }
      if (!ere && /[(){}+?|]/.test(c)) { out += "\\" + c; i++; continue; }
      if (!ere && c === "*" && (out === "" || out === "^")) { out += "\\*"; i++; continue; }
      out += c; i++;
    }
    return out;
  }
  function mkRegex(pat, o, flags) {
    var src = o.F ? pat.replace(/[.*+?^${}()|[\]\\\/]/g, "\\$&") : toJsRegex(pat, !!o.E);
    if (o.w) src = "(?<![\\w])(?:" + src + ")(?![\\w])";
    if (o.x) src = "^(?:" + src + ")$";
    try { return new RegExp(src, (o.i ? "i" : "") + (flags || "")); }
    catch (e) { throw new ShError("grep: Unmatched ( or \\(", 2); }
  }

  /* ================================================================== Builtins */
  B.cd = function (args, io, sess) {
    var a = args.slice(1).filter(function (x) { return x !== "-L" && x !== "-P"; });
    if (a.length > 1) throw new ShError("bash: cd: too many arguments", 1);
    var target = a[0];
    var printIt = false;
    if (target === undefined || target === "") target = S.getVar(sess, "HOME");
    else if (target === "-") { target = S.getVar(sess, "OLDPWD"); if (!target) throw new ShError("bash: cd: OLDPWD not set", 1); printIt = true; }
    var r = S.lookup(sess, target);
    if (r.error) throw new ShError("bash: cd: " + target + ": " + ERR[r.error], 1);
    if (r.node.type !== "d") throw new ShError("bash: cd: " + target + ": Not a directory", 1);
    if (!S.can(sess, r.node, "x")) throw new ShError("bash: cd: " + target + ": Permission denied", 1);
    S.setVar(sess, "OLDPWD", sess.cwd, true);
    sess.cwd = S.absPath(sess, target);
    S.setVar(sess, "PWD", sess.cwd, true);
    if (printIt) out(io, sess.cwd + "\n");
    return 0;
  };
  B.pwd = function (args, io, sess) { out(io, (args[1] === "-P" ? S.lookup(sess, sess.cwd).path || sess.cwd : sess.cwd) + "\n"); return 0; };
  function echoImpl(args, io) {
    var i = 1, nl = true, esc = false;
    for (; i < args.length; i++) { if (/^-[neE]+$/.test(args[i])) { if (args[i].indexOf("n") >= 0) nl = false; if (args[i].indexOf("e") >= 0) esc = true; if (args[i].indexOf("E") >= 0) esc = false; } else break; }
    var s = args.slice(i).join(" ");
    if (esc) { var stop = s.indexOf("\\c"); if (stop >= 0) { s = s.slice(0, stop); nl = false; } s = unescape(s); }
    out(io, s + (nl ? "\n" : ""));
    return 0;
  }
  function unescape(s) {
    return s.replace(/\\(0[0-7]{0,3}|x[0-9a-fA-F]{1,2}|.)/g, function (m, c) {
      if (c.charAt(0) === "0") return String.fromCharCode(parseInt(c, 8) || 0);
      if (c.charAt(0) === "x") return String.fromCharCode(parseInt(c.slice(1), 16));
      return { n: "\n", t: "\t", r: "\r", a: "\x07", b: "\b", e: "\x1b", f: "\f", v: "\v", "\\": "\\" }[c] !== undefined ? { n: "\n", t: "\t", r: "\r", a: "\x07", b: "\b", e: "\x1b", f: "\f", v: "\v", "\\": "\\" }[c] : m;
    });
  }
  B.echo = echoImpl;
  CMDS.echo = echoImpl;
  // printf FORMAT [ARGS]: %s %d %i %f %x %o %c %b %q %%, widths, precision, flags; the format repeats for extra args.
  function formatPrintf(fmt, argsIn, name) {
    var args = argsIn.slice(), outS = "", first = true;
    while (first || args.length) {
      var used = 0;
      outS += fmt.replace(/%([-+ 0#]*)(\*|\d+)?(?:\.(\*|\d+))?([sdifxXoceEgGbq%])|\\(0[0-7]{0,3}|x[0-9a-fA-F]{1,2}|.)/g, function (m, fl, w, pr, conv, esc) {
        if (esc !== undefined) return unescape("\\" + esc);
        if (conv === "%") return "%";
        if (w === "*") { w = args.shift(); used++; }
        if (pr === "*") { pr = args.shift(); used++; }
        var a = args.length ? args.shift() : undefined; used++;
        var s;
        if (conv === "s" || conv === "q") s = a === undefined ? "" : String(a);
        else if (conv === "b") s = a === undefined ? "" : unescape(String(a));
        else if (conv === "c") s = a === undefined ? "" : String(a).charAt(0);
        else if (/[dixXo]/.test(conv)) {
          var n = a === undefined || a === "" ? 0 : /^'/.test(a) ? a.charCodeAt(1) : parseInt(a, /^0x/i.test(a) ? 16 : 10);
          if (isNaN(n)) throw new ShError("bash: " + name + ": " + a + ": invalid number", 1);
          s = conv === "x" ? n.toString(16) : conv === "X" ? n.toString(16).toUpperCase() : conv === "o" ? n.toString(8) : String(n);
          if (fl.indexOf("+") >= 0 && n >= 0) s = "+" + s;
        } else {
          var f = a === undefined || a === "" ? 0 : parseFloat(a);
          s = /[eE]/.test(conv) ? f.toExponential(pr === undefined ? 6 : +pr) : f.toFixed(pr === undefined ? 6 : +pr);
          if (fl.indexOf("+") >= 0 && f >= 0) s = "+" + s;
        }
        if (pr !== undefined && /[sbq]/.test(conv)) s = s.slice(0, +pr);
        if (w !== undefined) { w = +w; var left = fl.indexOf("-") >= 0; var z = fl.indexOf("0") >= 0 && !left && !/[sbcq]/.test(conv); while (s.length < w) s = left ? s + " " : z ? (s.charAt(0) === "-" || s.charAt(0) === "+" ? s.charAt(0) + "0" + s.slice(1) : "0" + s) : " " + s; }
        return s;
      });
      first = false;
      if (!used) break;
    }
    return outS;
  }
  S.formatPrintf = formatPrintf;
  B.printf = function (args, io, sess) {
    var a = args.slice(1);
    if (a[0] === "-v") { S.setVar(sess, a[1], formatPrintf(a[2] || "", a.slice(3), "printf")); return 0; }
    if (!a.length) throw new ShError("printf: usage: printf [-v var] format [arguments]", 2);
    out(io, formatPrintf(a[0], a.slice(1), "printf"));
    return 0;
  };
  CMDS.printf = B.printf;
  B.export = function (args, io, sess) {
    var a = args.slice(1), unexport = false;
    if (a[0] === "-n") { unexport = true; a.shift(); }
    if (!a.length || a[0] === "-p") {
      Object.keys(sess.vars).sort().forEach(function (k) { if (sess.vars[k].x) out(io, "declare -x " + k + "=\"" + sess.vars[k].v.replace(/(["\\$`])/g, "\\$1") + "\"\n"); });
      return 0;
    }
    var code = 0;
    a.forEach(function (x) {
      var m = /^([A-Za-z_][A-Za-z0-9_]*)(?:=([\s\S]*))?$/.exec(x);
      if (!m) { errl(io, "bash: export: `" + x + "': not a valid identifier"); code = 1; return; }
      if (m[2] !== undefined) S.setVar(sess, m[1], m[2], !unexport);
      if (!sess.vars[m[1]]) sess.vars[m[1]] = { v: "", x: !unexport, unsetButExported: true };
      sess.vars[m[1]].x = !unexport;
    });
    return code;
  };
  B.unset = function (args, io, sess) { args.slice(1).filter(function (x) { return !/^-[fv]$/.test(x); }).forEach(function (n) { delete sess.vars[n]; if (args[1] === "-f") delete sess.functions[n]; }); return 0; };
  B.alias = function (args, io, sess) {
    var a = args.slice(1).filter(function (x) { return x !== "-p"; });
    if (!a.length) { Object.keys(sess.aliases).sort().forEach(function (k) { out(io, "alias " + k + "='" + sess.aliases[k].replace(/'/g, "'\\''") + "'\n"); }); return 0; }
    var code = 0;
    a.forEach(function (x) {
      var i = x.indexOf("=");
      if (i < 0) { if (sess.aliases[x] !== undefined) out(io, "alias " + x + "='" + sess.aliases[x] + "'\n"); else { errl(io, "bash: alias: " + x + ": not found"); code = 1; } return; }
      sess.aliases[x.slice(0, i)] = x.slice(i + 1);
    });
    return code;
  };
  B.unalias = function (args, io, sess) {
    if (args[1] === "-a") { sess.aliases = {}; return 0; }
    var code = 0;
    args.slice(1).forEach(function (n) { if (sess.aliases[n] === undefined) { errl(io, "bash: unalias: " + n + ": not found"); code = 1; } else delete sess.aliases[n]; });
    return code;
  };
  B.source = function (args, io, sess) {
    if (args.length < 2) throw new ShError("bash: " + args[0] + ": filename argument required\n" + args[0] + ": usage: " + args[0] + " filename [arguments]", 2);
    var f = args[1];
    var path = f;
    if (f.indexOf("/") < 0) {
      var dirs = (S.getVar(sess, "PATH") || "").split(":").concat(["."]);
      for (var k = 0; k < dirs.length; k++) { var r0 = S.lookup(sess, (dirs[k] || ".") + "/" + f); if (r0.node && r0.node.type === "f") { path = (dirs[k] || ".") + "/" + f; break; } }
    }
    var r = S.readFile(sess, path);
    if (r.error) throw new ShError("bash: " + f + ": " + ERR[r.error], 1);
    var saved = sess.positional;
    if (args.length > 2) sess.positional = args.slice(2);
    try { return S.runSource(sess, r.content, io); }
    catch (e) { if (e instanceof S.ReturnSignal) return e.code; if (e instanceof S.ParseError) { errl(io, f + ": " + e.message.replace(/^bash: /, "")); return 2; } throw e; }
    finally { sess.positional = saved; }
  };
  B["."] = B.source;
  B.exit = function (args, io, sess) { var c = args[1] !== undefined ? parseInt(args[1], 10) & 255 : sess.lastExit; throw new S.ExitSignal(isNaN(c) ? 2 : c); };
  B.logout = B.exit;
  B["return"] = function (args, io, sess) { throw new S.ReturnSignal(args[1] !== undefined ? parseInt(args[1], 10) & 255 : sess.lastExit); };
  B["break"] = function (args) { throw new S.BreakSignal(args[1] ? +args[1] : 1); };
  B["continue"] = function (args) { throw new S.ContinueSignal(args[1] ? +args[1] : 1); };
  B.shift = function (args, io, sess) { var n = args[1] ? +args[1] : 1; if (n > sess.positional.length) return 1; sess.positional = sess.positional.slice(n); return 0; };
  B["true"] = function () { return 0; };
  B["false"] = function () { return 1; };
  B[":"] = function () { return 0; };
  CMDS["true"] = B["true"]; CMDS["false"] = B["false"];
  B.set = function (args, io, sess) {
    var a = args.slice(1);
    if (!a.length) { Object.keys(sess.vars).sort().forEach(function (k) { out(io, k + "=" + sess.vars[k].v + "\n"); }); return 0; }
    var map = { e: "errexit", u: "nounset", x: "xtrace" };
    for (var i = 0; i < a.length; i++) {
      var x = a[i];
      if (x === "-o" || x === "+o") { var name = a[++i]; if (name === "pipefail" || name === "errexit" || name === "nounset" || name === "xtrace") sess.opts[name] = x === "-o"; continue; }
      if (x === "--") { sess.positional = a.slice(i + 1); break; }
      if (/^[-+][euxo]+$/.test(x)) { for (var j = 1; j < x.length; j++) if (map[x.charAt(j)]) sess.opts[map[x.charAt(j)]] = x.charAt(0) === "-"; continue; }
      sess.positional = a.slice(i); break;
    }
    return 0;
  };
  B.read = function (args, io, sess) {
    var o = opts("read", args, { flags: "rs", vals: "pnta" });
    if (o.o.p) out(io, o.o.p);
    if (io.stdin === null || io.stdin === undefined) {
      if (io.tty) { note(io, "(read waits for you to type a line. In this lab's terminal, give it input with a pipe or <<<, e.g.: read name <<< \"Ana\")"); return 1; }
      return 1;
    }
    var text = io.stdin;
    if (text === "") return 1;
    var nl = text.indexOf("\n");
    var line = nl < 0 ? text : text.slice(0, nl);
    io.stdin = nl < 0 ? "" : text.slice(nl + 1);
    if (io.consumeStdin) io.consumeStdin(line.length + 1);
    if (!o.o.r) line = line.replace(/\\(.)/g, "$1");
    var names = o.rest.length ? o.rest : ["REPLY"];
    var ifs = S.getVar(sess, "IFS"); if (ifs === undefined) ifs = " \t\n";
    if (names.length === 1 && names[0] === "REPLY" && !o.rest.length) { S.setVar(sess, "REPLY", line); return nl < 0 ? 1 : 0; }
    var parts = ifs ? line.replace(new RegExp("^[" + ifs.replace(/[\]\\^-]/g, "\\$&") + "]+"), "").split(new RegExp("[" + ifs.replace(/[\]\\^-]/g, "\\$&") + "]+")) : [line];
    names.forEach(function (n, k) {
      var v = k === names.length - 1 ? parts.slice(k).join(ifs ? ifs.charAt(0) : "") : parts[k];
      S.setVar(sess, n, v === undefined ? "" : v);
    });
    return nl < 0 ? 1 : 0;
  };
  // test / [ : POSIX test expressions.
  function testExpr(sess, a, name) {
    var pos = 0;
    function peek() { return a[pos]; }
    function next() { return a[pos++]; }
    function primary() {
      var t = peek();
      if (t === "!") { next(); return !primary(); }
      if (t === "(") { next(); var v = orE(); if (next() !== ")") throw new ShError("bash: " + name + ": `)' expected", 2); return v; }
      if (a.length - pos >= 3 && /^(=|==|!=|-eq|-ne|-lt|-le|-gt|-ge|<|>|-nt|-ot)$/.test(a[pos + 1])) {
        var l = next(), op = next(), r = next();
        if (op === "=" || op === "==") return l === r;
        if (op === "!=") return l !== r;
        return S.binaryTest(op, l, r);
      }
      if (/^-[a-zA-Z]$/.test(t) && a.length - pos >= 2) { next(); return S.unaryTest(sess, t, next()); }
      next();
      return t !== undefined && t !== "";
    }
    function andE() { var v = primary(); while (peek() === "-a") { next(); var r = primary(); v = v && r; } return v; }
    function orE() { var v = andE(); while (peek() === "-o") { next(); var r = andE(); v = v || r; } return v; }
    if (!a.length) return false;
    var v = orE();
    if (pos < a.length) throw new ShError("bash: " + name + ": too many arguments", 2);
    return v;
  }
  B.test = function (args, io, sess) { try { return testExpr(sess, args.slice(1), "test") ? 0 : 1; } catch (e) { if (e instanceof ShError) { errl(io, e.message); return 2; } throw e; } };
  B["["] = function (args, io, sess) {
    if (args[args.length - 1] !== "]") { errl(io, "bash: [: missing `]'"); return 2; }
    try { return testExpr(sess, args.slice(1, -1), "[") ? 0 : 1; } catch (e) { if (e instanceof ShError) { errl(io, e.message); return 2; } throw e; }
  };
  CMDS.test = B.test; CMDS["["] = B["["];
  B.type = function (args, io, sess) {
    var code = 0, a = args.slice(1), tOnly = false;
    if (a[0] === "-t") { tOnly = true; a.shift(); }
    a.forEach(function (n) {
      if (sess.aliases[n] !== undefined) { out(io, tOnly ? "alias\n" : n + " is aliased to `" + sess.aliases[n] + "'\n"); return; }
      if (["if", "then", "else", "elif", "fi", "for", "while", "until", "do", "done", "case", "esac", "function", "in"].indexOf(n) >= 0) { out(io, tOnly ? "keyword\n" : n + " is a shell keyword\n"); return; }
      if (sess.functions[n]) { out(io, tOnly ? "function\n" : n + " is a function\n"); return; }
      if (B[n]) { out(io, tOnly ? "builtin\n" : n + " is a shell builtin\n"); return; }
      var f = S.resolveCommand(sess, n);
      if (f.error) { errl(io, "bash: type: " + n + ": not found"); code = 1; return; }
      out(io, tOnly ? "file\n" : n + " is " + f.path + "\n");
    });
    return code;
  };
  B.command = function (args, io, sess) {
    if (args[1] === "-v" || args[1] === "-V") {
      var code = 0;
      args.slice(2).forEach(function (n) {
        if (sess.aliases[n] !== undefined) { out(io, "alias " + n + "='" + sess.aliases[n] + "'\n"); return; }
        if (B[n] || sess.functions[n]) { out(io, n + "\n"); return; }
        var f = S.resolveCommand(sess, n);
        if (f.error) { code = 1; return; }
        out(io, f.path + "\n");
      });
      return code;
    }
    var rest = args.slice(1);
    if (!rest.length) return 0;
    var f2 = S.resolveCommand(sess, rest[0]);
    if (B[rest[0]]) return B[rest[0]](rest, io, sess);
    if (f2.error) { errl(io, "bash: " + rest[0] + ": command not found"); return 127; }
    return S.execFound(sess, f2, rest, io);
  };
  B.history = function (args, io, sess) {
    var r = sess.root || sess;
    var h = (r.parent ? r : r).histLines || [];
    var top = sess;
    while (top.parent) top = top.parent;
    h = top.histLines || h;
    if (args[1] === "-c") { h.length = 0; return 0; }
    var n = args[1] && /^\d+$/.test(args[1]) ? +args[1] : h.length;
    h.slice(-n).forEach(function (l, i) { out(io, pad(h.length - Math.min(n, h.length) + i + 1, 5) + "  " + l + "\n"); });
    return 0;
  };
  B.umask = function (args, io, sess) {
    var a = args.slice(1);
    if (a[0] === "-S") { var m = (~sess.umask) & 511; out(io, "u=" + rwx(m >> 6) + ",g=" + rwx(m >> 3) + ",o=" + rwx(m) + "\n"); return 0; }
    if (!a.length) { out(io, pad(sess.umask.toString(8), 4, "0") + "\n"); return 0; }
    if (!/^[0-7]{1,4}$/.test(a[0])) throw new ShError("bash: umask: " + a[0] + ": octal number out of range", 1);
    sess.umask = parseInt(a[0], 8) & 511;
    return 0;
  };
  function rwx(b) { return (b & 4 ? "r" : "") + (b & 2 ? "w" : "") + (b & 1 ? "x" : ""); }
  B.local = function (args, io, sess) {
    if (!sess.locals || !sess.locals.length) throw new ShError("bash: local: can only be used in a function", 1);
    var scope = sess.locals[sess.locals.length - 1];
    args.slice(1).forEach(function (x) { var m = /^([A-Za-z_]\w*)(?:=([\s\S]*))?$/.exec(x); if (m) scope[m[1]] = { v: m[2] === undefined ? "" : m[2], x: false }; });
    return 0;
  };
  B.declare = function (args, io, sess) {
    var a = args.slice(1), exp = false, ro = false;
    while (a.length && /^-/.test(a[0])) { var f = a.shift(); if (f.indexOf("x") >= 0) exp = true; if (f.indexOf("r") >= 0) ro = true; if (f === "-p") { Object.keys(sess.vars).sort().forEach(function (k) { out(io, "declare -- " + k + "=\"" + sess.vars[k].v + "\"\n"); }); return 0; } }
    a.forEach(function (x) { var m = /^([A-Za-z_]\w*)(?:=([\s\S]*))?$/.exec(x); if (!m) return; if (m[2] !== undefined || !sess.vars[m[1]]) S.setVar(sess, m[1], m[2] === undefined ? "" : m[2], exp); if (exp) sess.vars[m[1]].x = true; if (ro) sess.vars[m[1]].ro = true; });
    return 0;
  };
  B.typeset = B.declare;
  B.readonly = function (args, io, sess) { args.slice(1).forEach(function (x) { var m = /^([A-Za-z_]\w*)(?:=([\s\S]*))?$/.exec(x); if (!m) return; if (m[2] !== undefined) S.setVar(sess, m[1], m[2]); if (sess.vars[m[1]]) sess.vars[m[1]].ro = true; }); return 0; };
  B.let = function (args, io, sess) { var v = 0; args.slice(1).forEach(function (x) { v = S.arith(sess, x); }); return v ? 0 : 1; };
  B["eval"] = function (args, io, sess) { return S.runSource(sess, args.slice(1).join(" "), io); };
  B.trap = function (args, io, sess) { sess.traps = sess.traps || {}; if (args.length >= 3) args.slice(2).forEach(function (sig) { sess.traps[sig.replace(/^SIG/, "")] = args[1]; }); return 0; };
  B.jobs = function () { return 0; };
  B.wait = function () { return 0; };
  B.fg = B.bg = function (args, io) { errl(io, "bash: " + args[0] + ": no job control in this lab's terminal"); return 1; };
  B.hash = function () { return 0; };
  B.help = function (args, io) { out(io, "GNU bash, version 5.2.21(1)-release (x86_64-pc-linux-gnu)\nThese shell commands are defined internally. Type `help' to see this list.\nType `man <command>' for help on other commands, e.g. man ls.\n\n cd [dir]   echo [arg ...]   export [name[=value] ...]   alias [name[=value] ...]\n source filename   exit [n]   history   type name   umask [mode]   read [name ...]\n test expr   [ expr ]   set [-eux] [-o pipefail]   unset name   pwd   printf format [args]\n"); return 0; };

  /* ================================================================== Files: ls */
  function listColumns(names, width) {
    if (!names.length) return "";
    var w = width || 80;
    for (var cols = Math.min(names.length, 12); cols > 1; cols--) {
      var rows = Math.ceil(names.length / cols), widths = [];
      for (var c = 0; c < cols; c++) { var mx = 0; for (var r = 0; r < rows; r++) { var n = names[c * rows + r]; if (n !== undefined) mx = Math.max(mx, n.length); } widths.push(mx); }
      var total = widths.reduce(function (a, b) { return a + b; }, 0) + 2 * (cols - 1);
      if (total <= w) {
        var outL = [];
        for (var r2 = 0; r2 < rows; r2++) {
          var line = "";
          for (var c2 = 0; c2 < cols; c2++) { var nm = names[c2 * rows + r2]; if (nm === undefined) continue; var last = c2 === cols - 1 || names[(c2 + 1) * rows + r2] === undefined; line += last ? nm : rpad(nm, widths[c2] + 2); }
          outL.push(line);
        }
        return outL.join("\n") + "\n";
      }
    }
    return names.join("\n") + "\n";
  }
  CMDS.ls = function (args, io, sess) {
    var p = opts("ls", args, { flags: "alhRtrSd1FAiCsUcn", long: { all: "a", "almost-all": "A", "human-readable": "h", recursive: "R", reverse: "r", directory: "d", classify: "F", color: "", "group-directories-first": "G" } });
    if (p.o.help) return help(io, "ls");
    var o = p.o, targets = p.rest.length ? p.rest : ["."];
    var code = 0, files = [], dirs = [];
    targets.forEach(function (t) {
      var r = S.lookup(sess, t, { nofollow: o.l || o.d });
      if (r.error) { errl(io, "ls: cannot access '" + t + "': " + ERR[r.error]); code = 2; return; }
      if (r.node.type === "d" && !o.d) dirs.push({ name: t, node: r.node, path: r.path });
      else files.push({ name: t, node: r.node, path: r.path });
    });
    var long = o.l || o.n;
    function entryName(e) {
      var n = e.name;
      if (o.F) n += e.node.type === "d" ? "/" : e.node.type === "l" ? "@" : (e.node.mode & 73) ? "*" : "";
      if (long && e.node.type === "l") n += " -> " + e.node.target;
      return n;
    }
    function sortEntries(list) {
      list.sort(function (a, b) {
        if (o.t) { var d = b.node.mtime - a.node.mtime; if (d) return d; }
        if (o.S) { var s = nodeSize(b.node) - nodeSize(a.node); if (s) return s; }
        return S.sortNames(a.name, b.name);
      });
      if (o.r) list.reverse();
      return list;
    }
    function render(list, withTotal) {
      if (!long) {
        var names = list.map(entryName);
        if (o["1"] || !io.tty) out(io, joinLines(names));
        else out(io, listColumns(names));
        return;
      }
      if (withTotal) out(io, "total " + list.reduce(function (a, e) { return a + blocks(e.node); }, 0) + "\n");
      var rows = list.map(function (e) {
        var n = e.node;
        var links = n.type === "d" ? 2 + Object.keys(n.children).filter(function (k) { return n.children[k].type === "d"; }).length : 1;
        return [modeStr(n), String(links), o.n ? String(n.uid) : S.uname(sess.sys, n.uid), o.n ? String(n.gid) : S.gname(sess.sys, n.gid), o.h ? human(nodeSize(n)) : String(nodeSize(n)), lsDate(n.mtime), entryName(e)];
      });
      var w = [0, 0, 0, 0, 0];
      rows.forEach(function (r) { for (var k = 1; k <= 4; k++) w[k] = Math.max(w[k], r[k].length); });
      out(io, rows.map(function (r) { return r[0] + " " + pad(r[1], w[1]) + " " + rpad(r[2], w[2]) + " " + rpad(r[3], w[3]) + " " + pad(r[4], w[4]) + " " + r[5] + " " + r[6]; }).join("\n") + (rows.length ? "\n" : ""));
    }
    sortEntries(files);
    if (files.length) render(files, false);
    sortEntries(dirs);
    var multi = files.length + dirs.length > 1 || o.R;
    var queue = dirs.slice();
    var first = !files.length;
    while (queue.length) {
      var d = queue.shift();
      if (!S.can(sess, d.node, "r")) { errl(io, "ls: cannot open directory '" + d.name + "': Permission denied"); code = 2; continue; }
      var names = Object.keys(d.node.children).filter(function (n) { return o.a || o.A || n.charAt(0) !== "."; });
      var list = names.map(function (n) { return { name: n, node: d.node.children[n], path: S.normAbs(d.path + "/" + n) }; });
      if (o.a) { list.push({ name: ".", node: d.node, path: d.path }); var par = S.lookup(sess, d.path + "/.."); list.push({ name: "..", node: par.node || d.node, path: d.path }); }
      sortEntries(list);
      if (multi) out(io, (first ? "" : "\n") + d.name + ":\n");
      first = false;
      render(list, true);
      if (o.R) {
        var subs = list.filter(function (e) { return e.node.type === "d" && e.name !== "." && e.name !== ".."; }).map(function (e) { return { name: d.name.replace(/\/$/, "") + "/" + e.name, node: e.node, path: e.path }; });
        queue = subs.concat(queue);
      }
    }
    return code;
  };
  CMDS.dir = CMDS.ls;

  /* ---------------- reading files */
  CMDS.cat = function (args, io, sess) {
    var p = opts("cat", args, { flags: "nbsAEvT", long: { number: "n", "number-nonblank": "b", "show-all": "A", "squeeze-blank": "s" } });
    if (p.o.help) return help(io, "cat");
    var o = p.o, n = 0, chunks = [];
    var code = 0;
    var targets = p.rest.length ? p.rest : ["-"];
    targets.forEach(function (f) {
      if (f !== "-") { var r0 = S.lookup(sess, f); if (r0.node && r0.node.type === "d") { errl(io, "cat: " + f + ": Is a directory"); code = 1; return; } }
      code = eachInput("cat", [f], io, sess, function (text) {
        if (!o.n && !o.b && !o.A && !o.E && !o.s) { chunks.push(text); return; }
        var ls = text.split("\n"), endsNl = text.slice(-1) === "\n";
        if (endsNl) ls.pop();
        var prevBlank = false;
        ls.forEach(function (l, i) {
          if (o.s && l === "" && prevBlank) return;
          prevBlank = l === "";
          var shown = o.A || o.E ? l.replace(/\t/g, o.A || o.T ? "^I" : "\t") + "$" : l;
          var num = (o.b ? l !== "" : o.n) ? pad(++n, 6) + "\t" : "";
          chunks.push(num + shown + (i < ls.length - 1 || endsNl ? "\n" : ""));
        });
      }) || code;
    });
    out(io, chunks.join(""));
    return code;
  };
  CMDS.tac = function (args, io, sess) { var t = []; var code = eachInput("tac", args.slice(1), io, sess, function (text) { t = t.concat(lines(text).reverse()); }); out(io, joinLines(t)); return code; };
  function pager(name) {
    return function (args, io, sess) {
      var files = args.slice(1).filter(function (a) { return a.charAt(0) !== "-" && a.charAt(0) !== "+"; });
      if (io.tty) note(io, "(" + name + " shows a file one screen at a time: Space or f = next page, b = back, /word = search, q = quit. This lab prints the whole file instead.)");
      return CMDS.cat(["cat"].concat(files), io, sess);
    };
  }
  CMDS.less = pager("less"); CMDS.more = pager("more");
  function headTail(isTail) {
    var name = isTail ? "tail" : "head";
    return function (args, io, sess) {
      var p = opts(name, args, { flags: "qvfF", vals: "nc", numeric: true, long: { lines: "n=", bytes: "c=", quiet: "q", silent: "q", verbose: "v", follow: "f" } });
      if (p.o.help) return help(io, name);
      var o = p.o, spec = o.n !== undefined ? String(o.n) : o.num !== undefined ? o.num : "10";
      var files = p.rest.length ? p.rest : ["-"];
      var code = 0;
      files.forEach(function (f, idx) {
        if (f !== "-") { var r0 = S.lookup(sess, f); if (r0.node && r0.node.type === "d") { errl(io, name + ": error reading '" + f + "': Is a directory"); code = 1; return; } }
        code = eachInput(name, [f], io, sess, function (text) {
          if ((files.length > 1 && !o.q) || o.v) out(io, (idx ? "\n" : "") + "==> " + (f === "-" ? "standard input" : f) + " <==\n");
          if (o.c !== undefined) { var nb = parseInt(o.c, 10); out(io, isTail ? text.slice(-nb) : text.slice(0, nb)); return; }
          var ls = lines(text), sel;
          if (isTail) {
            if (/^\+/.test(spec)) sel = ls.slice(Math.max(0, parseInt(spec.slice(1), 10) - 1));
            else { var k = Math.abs(parseInt(spec, 10)); sel = k === 0 ? [] : ls.slice(-k); }
          } else {
            var k2 = parseInt(spec, 10);
            sel = /^-/.test(spec) ? ls.slice(0, Math.max(0, ls.length + k2)) : ls.slice(0, k2);
          }
          out(io, joinLines(sel));
        }) || code;
      });
      if (isTail && o.f && io.tty) note(io, "(tail -f would keep waiting and print new lines as they're written, until you press Ctrl+C. This lab shows what's there now.)");
      return code;
    };
  }
  CMDS.head = headTail(false); CMDS.tail = headTail(true);
  CMDS.wc = function (args, io, sess) {
    var p = opts("wc", args, { flags: "lwcmL", long: { lines: "l", words: "w", bytes: "c", chars: "m" } });
    if (p.o.help) return help(io, "wc");
    var o = p.o, which = ["l", "w", "c", "m"].filter(function (k) { return o[k]; });
    if (!which.length) which = ["l", "w", "c"];
    var rows = [], code = 0, total = { l: 0, w: 0, c: 0, m: 0 };
    var files = p.rest.length ? p.rest : ["-"];
    files.forEach(function (f) {
      if (f !== "-") { var r0 = S.lookup(sess, f); if (r0.node && r0.node.type === "d") { errl(io, "wc: " + f + ": Is a directory"); rows.push({ name: f, v: { l: 0, w: 0, c: 0, m: 0 } }); code = 1; return; } }
      code = eachInput("wc", [f], io, sess, function (text) {
        var v = { l: (text.match(/\n/g) || []).length, w: (text.match(/\S+/g) || []).length, c: bytes(text), m: text.length };
        Object.keys(total).forEach(function (k) { total[k] += v[k]; });
        rows.push({ name: f === "-" ? "" : f, v: v });
      }) || code;
    });
    if (rows.length > 1) rows.push({ name: "total", v: total });
    var width = 1;
    rows.forEach(function (r) { which.forEach(function (k) { width = Math.max(width, String(r.v[k]).length); }); });
    var single = which.length === 1 && rows.length === 1;
    if (!single && files.some(function (f) { return f !== "-"; }) && width < 1) width = 1;
    rows.forEach(function (r) {
      var nums = which.map(function (k) { return single ? String(r.v[k]) : pad(r.v[k], width); });
      out(io, nums.join(" ") + (r.name ? " " + r.name : "") + "\n");
    });
    return code;
  };

  /* ---------------- grep */
  function grepImpl(args, io, sess, mode) {
    var p = opts("grep", args, { flags: "ivncwlLrRhHoqsxEFPZz", vals: "eABCm", long: { "ignore-case": "i", "invert-match": "v", "line-number": "n", count: "c", "word-regexp": "w", "files-with-matches": "l", "files-without-match": "L", recursive: "r", "dereference-recursive": "R", "no-filename": "h", "with-filename": "H", "only-matching": "o", quiet: "q", silent: "q", "line-regexp": "x", "extended-regexp": "E", "fixed-strings": "F", "perl-regexp": "P", regexp: "e=", include: "include=", exclude: "exclude=", "exclude-dir": "excludedir=", color: "", colour: "", "max-count": "m=", context: "C=", "after-context": "A=", "before-context": "B=" } });
    if (p.o.help) return help(io, "grep");
    var o = p.o;
    if (mode === "E") o.E = true; if (mode === "F") o.F = true; if (o.P) o.E = true;
    var rest = p.rest.slice();
    var patterns = [];
    if (o.e !== undefined) patterns.push(o.e); else { if (!rest.length) { errl(io, "Usage: grep [OPTION]... PATTERNS [FILE]...\nTry 'grep --help' for more information."); return 2; } patterns = rest.shift().split("\n"); }
    var res = patterns.map(function (pt) { return mkRegex(pt, o, "g"); });
    var rec = o.r || o.R;
    var files = rest.length ? rest : rec ? ["."] : ["-"];
    var targets = [], code = 1, errored = false;
    files.forEach(function (f) {
      if (f === "-") { targets.push({ name: "(standard input)", text: io.stdin || "" }); return; }
      var r = S.lookup(sess, f);
      if (r.error) { if (!o.s) errl(io, "grep: " + f + ": " + ERR[r.error]); errored = true; return; }
      if (r.node.type === "d") {
        if (!rec) { if (!o.s) errl(io, "grep: " + f + ": Is a directory"); errored = true; return; }
        walk(sess, f, r.node, function (path, node) {
          if (o.include !== undefined && !S.globMatch(o.include, path.split("/").pop())) return;
          if (o.exclude !== undefined && S.globMatch(o.exclude, path.split("/").pop())) return;
          if (!S.can(sess, node, "r")) { if (!o.s) errl(io, "grep: " + path + ": Permission denied"); errored = true; return; }
          targets.push({ name: path, text: node.content, binary: /^\x7fELF/.test(node.content) });
        }, function (path) { if (!o.s) errl(io, "grep: " + path + ": Permission denied"); errored = true; }, o.excludedir);
        return;
      }
      if (!S.can(sess, r.node, "r")) { if (!o.s) errl(io, "grep: " + f + ": Permission denied"); errored = true; return; }
      targets.push({ name: f, text: r.node.content, binary: /^\x7fELF/.test(r.node.content) });
    });
    var showName = o.H || (!o.h && (targets.length > 1 || rec));
    var after = +(o.A !== undefined ? o.A : o.C !== undefined ? o.C : 0), before = +(o.B !== undefined ? o.B : o.C !== undefined ? o.C : 0);
    targets.forEach(function (t) {
      var ls = lines(t.text), count = 0, lastPrinted = -1, pendingAfter = 0, outLines = [];
      var max = o.m !== undefined ? +o.m : Infinity;
      for (var i = 0; i < ls.length; i++) {
        var l = ls[i];
        var hit = res.some(function (re) { re.lastIndex = 0; return re.test(l); });
        if (o.v) hit = !hit;
        if (hit && count < max) {
          count++;
          if (o.q || o.l || o.L || o.c) continue;
          if (t.binary) continue;
          if (before) for (var b = Math.max(lastPrinted + 1, i - before); b < i; b++) { if (lastPrinted >= 0 && b > lastPrinted + 1 && outLines.length) outLines.push("--"); outLines.push(prefix(t.name, b + 1, "-") + ls[b]); lastPrinted = b; }
          if ((before || after) && lastPrinted >= 0 && i > lastPrinted + 1 && outLines.length && outLines[outLines.length - 1] !== "--") outLines.push("--");
          if (o.o && !o.v) {
            res.forEach(function (re) { re.lastIndex = 0; var m; while ((m = re.exec(l))) { if (m[0] === "") { re.lastIndex++; continue; } outLines.push(prefix(t.name, i + 1, ":") + m[0]); } });
          } else outLines.push(prefix(t.name, i + 1, ":") + l);
          lastPrinted = i; pendingAfter = after;
        } else if (pendingAfter > 0 && !o.c && !o.l) { outLines.push(prefix(t.name, i + 1, "-") + l); lastPrinted = i; pendingAfter--; }
        if (count >= max && pendingAfter <= 0) break;
      }
      if (count) code = 0;
      if (o.q) return;
      if (o.l) { if (count) out(io, t.name + "\n"); return; }
      if (o.L) { if (!count) out(io, t.name + "\n"); return; }
      if (o.c) { out(io, (showName ? t.name + ":" : "") + count + "\n"); return; }
      if (t.binary && count) { out(io, "grep: " + t.name + ": binary file matches\n"); return; }
      out(io, joinLines(outLines));
    });
    function prefix(name, n, sep) { return (showName ? name + sep : "") + (o.n ? n + sep : ""); }
    if (errored && code === 1) return 2;
    if (o.q && code === 0) return 0;
    return errored && !o.s ? (code === 0 ? 2 : 2) : code;
  }
  // Recursive walk of a directory: cb(path, fileNode); denied(path) for unreadable folders.
  function walk(sess, base, node, cb, denied, excludeDir) {
    if (!S.can(sess, node, "r") || !S.can(sess, node, "x")) { if (denied) denied(base); return; }
    Object.keys(node.children).sort(S.sortNames).forEach(function (n) {
      var ch = node.children[n], path = base.replace(/\/$/, "") + "/" + n;
      if (ch.type === "d") { if (excludeDir && S.globMatch(excludeDir, n)) return; walk(sess, path, ch, cb, denied, excludeDir); }
      else if (ch.type === "f") cb(path, ch);
    });
  }
  CMDS.grep = function (a, io, s) { return grepImpl(a, io, s, null); };
  CMDS.egrep = function (a, io, s) { return grepImpl(a, io, s, "E"); };
  CMDS.fgrep = function (a, io, s) { return grepImpl(a, io, s, "F"); };

  /* ---------------- find */
  CMDS.find = function (args, io, sess) {
    if (args[1] === "--help") return help(io, "find");
    var a = args.slice(1), paths = [];
    while (a.length && (a[0].charAt(0) !== "-" || a[0] === "-") && a[0] !== "!" && a[0] !== "(") paths.push(a.shift());
    if (!paths.length) paths = ["."];
    var maxdepth = Infinity, mindepth = 0, pos = 0, hasAction = false;
    // Parse the expression into a tree.
    function parseOr() { var l = parseAnd(); while (a[pos] === "-o" || a[pos] === "-or") { pos++; var r = parseAnd(); l = { op: "or", l: l, r: r }; } return l; }
    function parseAnd() {
      var l = parseNot();
      for (;;) {
        if (a[pos] === "-a" || a[pos] === "-and") { pos++; l = { op: "and", l: l, r: parseNot() }; continue; }
        if (pos < a.length && a[pos] !== "-o" && a[pos] !== "-or" && a[pos] !== ")") { l = { op: "and", l: l, r: parseNot() }; continue; }
        return l;
      }
    }
    function parseNot() { if (a[pos] === "!" || a[pos] === "-not") { pos++; return { op: "not", e: parseNot() }; } return prim(); }
    function need(t) { if (pos >= a.length) throw new ShError("find: missing argument to `" + t + "'", 1); return a[pos++]; }
    function prim() {
      var t = a[pos++];
      if (t === "(") { var e = parseOr(); if (a[pos++] !== ")") throw new ShError("find: invalid expression; I was expecting to find a ')' somewhere but did not see one.", 1); return e; }
      switch (t) {
        case "-name": case "-iname": { var pat = need(t), ci = t === "-iname"; return { test: function (x) { return ci ? S.globMatch(pat.toLowerCase(), x.name.toLowerCase()) : S.globMatch(pat, x.name); } }; }
        case "-path": case "-wholename": { var pp = need(t); return { test: function (x) { return S.globMatch(pp, x.path); } }; }
        case "-type": { var ty = need(t); return { test: function (x) { return (ty === "f" && x.node.type === "f") || (ty === "d" && x.node.type === "d") || (ty === "l" && x.node.type === "l"); } }; }
        case "-mtime": case "-mmin": case "-atime": case "-ctime": case "-amin": case "-cmin": {
          var spec = need(t), unit = /min$/.test(t) ? 60000 : DAY;
          return { test: function (x) { var age = Math.floor((sess.sys.now - x.node.mtime) / unit); return cmpN(age, spec); } };
        }
        case "-size": {
          var sz = need(t), m = /^([+-]?)(\d+)([ckMGb]?)$/.exec(sz);
          if (!m) throw new ShError("find: invalid -size type `" + sz + "'", 1);
          var unitB = { c: 1, k: 1024, M: 1048576, G: 1073741824, b: 512, "": 512 }[m[3]];
          return { test: function (x) { var s = x.node.type === "f" ? nodeSize(x.node) : 4096; var units = Math.ceil(s / unitB); return cmpN(units, m[1] + m[2]); } };
        }
        case "-user": { var un = need(t); return { test: function (x) { return S.uname(sess.sys, x.node.uid) === un || String(x.node.uid) === un; } }; }
        case "-group": { var gn = need(t); return { test: function (x) { return S.gname(sess.sys, x.node.gid) === gn || String(x.node.gid) === gn; } }; }
        case "-nouser": return { test: function (x) { return !S.userById(sess.sys, x.node.uid); } };
        case "-perm": {
          var pm = need(t), kind = pm.charAt(0) === "-" ? "all" : pm.charAt(0) === "/" ? "any" : "exact";
          var bits = parseInt(kind === "exact" ? pm : pm.slice(1), 8);
          if (isNaN(bits)) bits = symbolicBits(kind === "exact" ? pm : pm.slice(1));
          return { test: function (x) { var md = x.node.mode & 4095; return kind === "exact" ? md === bits : kind === "all" ? (md & bits) === bits : (md & bits) !== 0 || bits === 0; } };
        }
        case "-empty": return { test: function (x) { return x.node.type === "d" ? !Object.keys(x.node.children).length : x.node.type === "f" && x.node.content.length === 0; } };
        case "-newer": { var ref = S.lookup(sess, need(t)); if (ref.error) throw new ShError("find: ‘" + a[pos - 1] + "’: No such file or directory", 1); return { test: function (x) { return x.node.mtime > ref.node.mtime; } }; }
        case "-maxdepth": maxdepth = +need(t); return { test: function () { return true; } };
        case "-mindepth": mindepth = +need(t); return { test: function () { return true; } };
        case "-print": hasAction = true; return { test: function (x) { emit(x.path + "\n"); return true; } };
        case "-print0": hasAction = true; return { test: function (x) { emit(x.path + "\0"); return true; } };
        case "-ls": hasAction = true; return { test: function (x) { emit(pad(1000 + x.depth, 8) + " " + pad(blocks(x.node), 6) + " " + modeStr(x.node) + "   1 " + rpad(S.uname(sess.sys, x.node.uid), 8) + " " + rpad(S.gname(sess.sys, x.node.gid), 8) + " " + pad(nodeSize(x.node), 8) + " " + lsDate(x.node.mtime) + " " + x.path + "\n"); return true; } };
        case "-delete": hasAction = true; return { test: function (x) { return deleteNode(x); } };
        case "-exec": case "-execdir": case "-ok": {
          hasAction = true;
          var cmd = [];
          while (pos < a.length && a[pos] !== ";" && a[pos] !== "+") cmd.push(a[pos++]);
          if (pos >= a.length) throw new ShError("find: missing argument to `" + t + "'", 1);
          var plus = a[pos++] === "+";
          if (plus) { var batch = []; batches.push({ cmd: cmd, items: batch }); return { test: function (x) { batch.push(x.path); return true; } }; }
          return { test: function (x) { var argv = cmd.map(function (c) { return c.replace(/\{\}/g, x.path); }); return S.runCommand(sess, argv, io) === 0; } };
        }
        case "-prune": return { test: function (x) { x.prune = true; return true; } };
        case "-true": return { test: function () { return true; } };
        case "-false": return { test: function () { return false; } };
      }
      throw new ShError("find: unknown predicate `" + t + "'", 1);
    }
    function cmpN(v, spec) { var s = String(spec); if (s.charAt(0) === "+") return v > +s.slice(1); if (s.charAt(0) === "-") return v < +s.slice(1); return v === +s; }
    var batches = [], outBuf = [];
    function emit(s) { outBuf.push(s); }
    var expr = a.length ? parseOr() : null;
    if (pos < a.length) throw new ShError("find: paths must precede expression: `" + a[pos] + "'", 1);
    function evalE(e, x) { if (!e) return true; if (e.op === "and") return evalE(e.l, x) && evalE(e.r, x); if (e.op === "or") return evalE(e.l, x) || evalE(e.r, x); if (e.op === "not") return !evalE(e.e, x); return e.test(x); }
    var code = 0;
    function deleteNode(x) {
      if (!x.parentNode) return false;
      if (x.node.type === "d" && Object.keys(x.node.children).length) { errl(io, "find: cannot delete ‘" + x.path + "’: Directory not empty"); code = 1; return false; }
      if (!S.can(sess, x.parentNode, "w")) { errl(io, "find: cannot delete ‘" + x.path + "’: Permission denied"); code = 1; return false; }
      delete x.parentNode.children[x.name];
      return true;
    }
    var deleting = a.indexOf("-delete") >= 0;
    paths.forEach(function (start) {
      var r = S.lookup(sess, start);
      if (r.error) { errl(io, "find: ‘" + start + "’: " + ERR[r.error]); code = 1; return; }
      (function visit(path, node, depth, parentNode, name) {
        S.step(sess);
        var x = { path: path, node: node, depth: depth, name: depth === 0 ? start.replace(/\/$/, "").split("/").pop() || start : name, parentNode: parentNode };
        if (!deleting && depth >= mindepth && depth <= maxdepth) { if (evalE(expr, x) && !hasAction) emit(path + "\n"); }
        if (node.type === "d" && depth < maxdepth && !x.prune) {
          if (!S.can(sess, node, "r") || !S.can(sess, node, "x")) { flushOut(); errl(io, "find: ‘" + path + "’: Permission denied"); code = 1; }
          else Object.keys(node.children).sort(S.sortNames).forEach(function (n) { var ch = node.children[n]; visit(path.replace(/\/$/, "") + "/" + n, ch.type === "l" ? ch : ch, depth + 1, node, n); });
        }
        if (deleting && depth >= mindepth && depth <= maxdepth) { if (evalE(expr, x) && !hasAction) emit(path + "\n"); }
      })(start, r.node, 0, r.parent, r.name);
    });
    function flushOut() { if (outBuf.length) { out(io, outBuf.join("")); outBuf = []; } }
    flushOut();
    batches.forEach(function (b) { if (b.items.length) S.runCommand(sess, b.cmd.filter(function (c) { return c !== "{}"; }).concat(b.items), io); });
    return code;
  };
  function symbolicBits(s) { var m = 0; s.split(",").forEach(function (part) { var mm = /^([ugoa]*)[+=-]([rwxst]*)$/.exec(part); if (!mm) return; var who = mm[1] || "a"; mm[2].split("").forEach(function (p) { var b = { r: 4, w: 2, x: 1 }[p]; if (b) { if (/[ua]/.test(who)) m |= b << 6; if (/[ga]/.test(who)) m |= b << 3; if (/[oa]/.test(who)) m |= b; } if (p === "s") { if (/[ua]/.test(who)) m |= 2048; if (/[ga]/.test(who)) m |= 1024; } if (p === "t") m |= 512; }); }); return m; }

  /* ---------------- text tools */
  CMDS.sort = function (args, io, sess) {
    var p = opts("sort", args, { flags: "nrufbhVMsc", vals: "kto", long: { numeric: "n", "numeric-sort": "n", reverse: "r", unique: "u", "ignore-case": "f", "human-numeric-sort": "h", key: "k=", "field-separator": "t=", output: "o=", "version-sort": "V" } });
    if (p.o.help) return help(io, "sort");
    var o = p.o, all = [];
    var code = eachInput("sort", p.rest, io, sess, function (t) { all = all.concat(lines(t)); });
    var key = null;
    if (o.k !== undefined) {
      var km = /^(\d+)(?:\.(\d+))?([nrbfh]*)(?:,(\d+)(?:\.(\d+))?([nrbfh]*))?$/.exec(o.k);
      if (!km) throw new ShError("sort: invalid number at field start: invalid count at start of '" + o.k + "'", 2);
      key = { a: +km[1], b: km[4] ? +km[4] : null, flags: (km[3] || "") + (km[6] || "") };
    }
    function fieldsOf(l) { return o.t !== undefined ? l.split(o.t) : l.trim().split(/\s+/); }
    function keyOf(l) {
      if (!key) return l;
      var f = fieldsOf(l);
      return f.slice(key.a - 1, key.b ? key.b : f.length).join(o.t !== undefined ? o.t : " ");
    }
    var numeric = o.n || (key && /n/.test(key.flags)), hum = o.h || (key && /h/.test(key.flags)), rev = o.r || (key && /r/.test(key.flags)), fold = o.f || (key && /f/.test(key.flags));
    function num(s) { var m = /^\s*(-?\d+(?:\.\d+)?)([KMGT]?)/.exec(s); if (!m) return 0; var v = parseFloat(m[1]); if (hum) v *= { "": 1, K: 1e3, M: 1e6, G: 1e9, T: 1e12 }[m[2]]; return v; }
    function cmpKey(x, y) {
      var a = keyOf(x), b = keyOf(y);
      if (numeric || hum) { var d = num(a) - num(b); if (d) return d; return 0; }
      if (fold) { a = a.toLowerCase(); b = b.toLowerCase(); }
      return sortLines(a, b);
    }
    var sorted = all.slice().sort(function (x, y) {
      var c = cmpKey(x, y);
      if (c === 0 && !o.u && !o.s) c = sortLines(x, y);
      return rev ? -c : c;
    });
    if (o.u) sorted = sorted.filter(function (l, i) { return i === 0 || cmpKey(sorted[i - 1], l) !== 0; });
    if (o.o !== undefined) { var e = S.writeFile(sess, o.o, joinLines(sorted), false); if (e) { errl(io, "sort: open failed: " + o.o + ": " + ERR[e]); return 2; } return code; }
    out(io, joinLines(sorted));
    return code;
  };
  CMDS.uniq = function (args, io, sess) {
    var p = opts("uniq", args, { flags: "cdui", long: { count: "c", repeated: "d", unique: "u", "ignore-case": "i" } });
    if (p.o.help) return help(io, "uniq");
    var o = p.o, all = [];
    var code = eachInput("uniq", p.rest.slice(0, 1), io, sess, function (t) { all = lines(t); });
    var groups = [];
    all.forEach(function (l) { var last = groups[groups.length - 1]; if (last && (o.i ? last.l.toLowerCase() === l.toLowerCase() : last.l === l)) last.n++; else groups.push({ l: l, n: 1 }); });
    var res = groups.filter(function (g) { return o.d ? g.n > 1 : o.u ? g.n === 1 : true; }).map(function (g) { return o.c ? pad(g.n, 7) + " " + g.l : g.l; });
    out(io, joinLines(res));
    return code;
  };
  function rangeList(spec, name) {
    return spec.split(",").map(function (part) {
      var m = /^(\d*)(-?)(\d*)$/.exec(part);
      if (!m || (m[1] === "" && m[3] === "" )) throw new ShError(name + ": invalid field range\nTry '" + name + " --help' for more information.", 1);
      var a = m[1] === "" ? 1 : +m[1], b = m[2] ? (m[3] === "" ? Infinity : +m[3]) : a;
      if (a === 0) throw new ShError(name + ": fields and positions are numbered from 1\nTry '" + name + " --help' for more information.", 1);
      return [a, b];
    });
  }
  CMDS.cut = function (args, io, sess) {
    var p = opts("cut", args, { flags: "s", vals: "dfcb", long: { delimiter: "d=", fields: "f=", characters: "c=", bytes: "b=", "only-delimited": "s", "output-delimiter": "od=" } });
    if (p.o.help) return help(io, "cut");
    var o = p.o;
    if (o.f === undefined && o.c === undefined && o.b === undefined) throw new ShError("cut: you must specify a list of bytes, characters, or fields\nTry 'cut --help' for more information.", 1);
    var d = o.d !== undefined ? o.d : "\t";
    if (d.length !== 1) throw new ShError("cut: the delimiter must be a single character\nTry 'cut --help' for more information.", 1);
    var ranges = rangeList(o.f !== undefined ? o.f : o.c !== undefined ? o.c : o.b, "cut");
    function inR(n) { return ranges.some(function (r) { return n >= r[0] && n <= r[1]; }); }
    var res = [];
    var code = eachInput("cut", p.rest, io, sess, function (t) {
      lines(t).forEach(function (l) {
        if (o.f !== undefined) {
          if (l.indexOf(d) < 0) { if (!o.s) res.push(l); return; }
          res.push(l.split(d).filter(function (x, i) { return inR(i + 1); }).join(o.od !== undefined ? o.od : d));
        } else res.push(l.split("").filter(function (x, i) { return inR(i + 1); }).join(""));
      });
    });
    out(io, joinLines(res));
    return code;
  };
  function trSet(s) {
    s = s.replace(/\[:(alpha|digit|alnum|upper|lower|space|blank|punct):\]/g, function (m, k) {
      return { alpha: "A-Za-z", digit: "0-9", alnum: "A-Za-z0-9", upper: "A-Z", lower: "a-z", space: " \t\n\r\f\v", blank: " \t", punct: "!-/:-@[-`{-~" }[k];
    });
    s = unescape(s);
    var outS = [];
    for (var i = 0; i < s.length; i++) {
      if (s.charAt(i + 1) === "-" && i + 2 < s.length) { for (var c = s.charCodeAt(i); c <= s.charCodeAt(i + 2); c++) outS.push(String.fromCharCode(c)); i += 2; }
      else outS.push(s.charAt(i));
    }
    return outS;
  }
  CMDS.tr = function (args, io) {
    var p = opts("tr", args, { flags: "dscC", long: { delete: "d", "squeeze-repeats": "s", complement: "c" } });
    if (p.o.help) return help(io, "tr");
    var o = p.o, a = p.rest;
    if (!a.length) throw new ShError("tr: missing operand\nTry 'tr --help' for more information.", 1);
    var s1 = trSet(a[0]), s2 = a[1] !== undefined ? trSet(a[1]) : [];
    var comp = o.c || o.C;
    function inS1(ch) { var i = s1.indexOf(ch) >= 0; return comp ? !i : i; }
    var text = io.stdin || "", res = "", prev = null;
    for (var i = 0; i < text.length; i++) {
      var ch = text.charAt(i);
      if (o.d) { if (inS1(ch)) continue; res += ch; continue; }
      var mapped = ch;
      if (s2.length && inS1(ch)) { var k = comp ? s2.length - 1 : s1.indexOf(ch); mapped = s2[Math.min(k, s2.length - 1)]; }
      if (o.s && prev === mapped && (s2.length ? s2.indexOf(mapped) >= 0 : inS1(mapped))) continue;
      res += mapped; prev = mapped;
    }
    out(io, res);
    return 0;
  };
  CMDS.rev = function (args, io, sess) { var r = []; var code = eachInput("rev", args.slice(1), io, sess, function (t) { lines(t).forEach(function (l) { r.push(l.split("").reverse().join("")); }); }); out(io, joinLines(r)); return code; };
  CMDS.tee = function (args, io, sess) {
    var p = opts("tee", args, { flags: "a", long: { append: "a" } });
    var text = io.stdin || "", code = 0;
    p.rest.forEach(function (f) { var e = S.writeFile(sess, f, text, !!p.o.a); if (e) { errl(io, "tee: " + f + ": " + ERR[e]); code = 1; } });
    out(io, text);
    return code;
  };
  CMDS.nl = function (args, io, sess) { var r = [], n = 0; var code = eachInput("nl", args.slice(1).filter(function (x) { return x.charAt(0) !== "-"; }), io, sess, function (t) { lines(t).forEach(function (l) { r.push(l === "" ? "" : pad(++n, 6) + "\t" + l); }); }); out(io, joinLines(r)); return code; };

  /* ---------------- sed */
  CMDS.sed = function (args, io, sess) {
    var p = opts("sed", args, { flags: "nErsuz", vals: "eif", long: { quiet: "n", silent: "n", "regexp-extended": "E", expression: "e=", "in-place": "inplace" } });
    if (p.o.help) return help(io, "sed");
    var o = p.o, rest = p.rest.slice();
    var inPlace = o.i !== undefined || o.inplace;
    // "-i" may be glued to a suffix (-i.bak); a bare -i consumed the next word: give it back.
    if (o.i !== undefined && !/^\./.test(o.i) && o.i !== "") { rest.unshift(o.i); o.i = ""; }
    var script = o.e !== undefined ? o.e : rest.shift();
    if (script === undefined) throw new ShError("Usage: sed [OPTION]... {script-only-if-no-other-script} [input-file]...", 1);
    var ere = o.E || o.r;
    var cmds = parseSed(script, ere);
    function process(text) {
      var ls = lines(text), outL = [], quit = false;
      var inRange = cmds.map(function () { return false; });
      for (var i = 0; i < ls.length && !quit; i++) {
        var line = ls[i], del = false, printed = [], appendAfter = [];
        for (var k = 0; k < cmds.length; k++) {
          var c = cmds[k];
          var sel = matchAddr(c, k, line, i + 1, ls.length);
          if (c.neg) sel = !sel;
          if (!sel) continue;
          if (c.cmd === "s") {
            var hit = false, n = 0;
            line = line.replace(c.re, function () {
              var m = arguments, idx = m[m.length - 2];
              n++;
              if (c.nth && n !== c.nth) return m[0];
              hit = true;
              return c.repl.replace(/\\(\d)|&|\\n|\\&|\\\\/g, function (t, d) { if (t === "&") return m[0]; if (t === "\\&") return "&"; if (t === "\\n") return "\n"; if (t === "\\\\") return "\\"; return m[+d] || ""; });
            });
            if (hit && c.p) printed.push(line);
          } else if (c.cmd === "d") { del = true; break; }
          else if (c.cmd === "p") printed.push(line);
          else if (c.cmd === "q") { quit = true; break; }
          else if (c.cmd === "=") printed.push(String(i + 1));
          else if (c.cmd === "a") appendAfter.push(c.text);
          else if (c.cmd === "i") printed.push(c.text);
          else if (c.cmd === "c") { del = true; outL.push(c.text); break; }
          else if (c.cmd === "y") line = line.split("").map(function (ch) { var j = c.from.indexOf(ch); return j >= 0 ? c.to.charAt(j) : ch; }).join("");
        }
        printed.forEach(function (x) { outL.push(x); });
        if (!del && !o.n) outL.push(line);
        appendAfter.forEach(function (x) { outL.push(x); });
      }
      return joinLines(outL);
      function matchAddr(c, k, line, n, total) {
        if (!c.a1) return true;
        function one(a) { return a.type === "n" ? n === a.v : a.type === "last" ? n === total : a.re.test(line); }
        if (!c.a2) return one(c.a1);
        if (inRange[k]) { if (c.a2.type === "n" ? n >= c.a2.v : one(c.a2)) inRange[k] = false; return true; }
        if (one(c.a1)) { inRange[k] = !(c.a2.type === "n" && n >= c.a2.v); return true; }
        return false;
      }
    }
    if (inPlace) {
      var code = 0;
      if (!rest.length) throw new ShError("sed: no input files", 1);
      rest.forEach(function (f) {
        var r = S.readFile(sess, f);
        if (r.error) { errl(io, "sed: can't read " + f + ": " + ERR[r.error]); code = 2; return; }
        if (o.i) S.writeFile(sess, f + o.i, r.content, false);
        var e = S.writeFile(sess, f, process(r.content), false);
        if (e) { errl(io, "sed: couldn't open temporary file " + f + ": " + ERR[e]); code = 4; }
      });
      return code;
    }
    var all = "";
    var code2 = 0;
    (rest.length ? rest : ["-"]).forEach(function (f) {
      if (f === "-") { all += io.stdin || ""; return; }
      var r = S.readFile(sess, f);
      if (r.error) { errl(io, "sed: can't read " + f + ": " + ERR[r.error]); code2 = 2; return; }
      all += r.content;
    });
    out(io, process(all));
    return code2;
  };
  function parseSed(script, ere) {
    var cmds = [], i = 0, s = script;
    function ws() { while (i < s.length && /[\s;]/.test(s.charAt(i))) i++; }
    function addr() {
      var c = s.charAt(i);
      if (/\d/.test(c)) { var m = /^\d+/.exec(s.slice(i)); i += m[0].length; return { type: "n", v: +m[0] }; }
      if (c === "$") { i++; return { type: "last" }; }
      if (c === "/" || c === "\\") { var d = c === "\\" ? s.charAt(++i) : "/"; i++; var re = readDelim(d); var flag = ""; if (s.charAt(i) === "I") { flag = "i"; i++; } return { type: "re", re: new RegExp(toJsRegex(re, ere), flag) }; }
      return null;
    }
    function readDelim(d) { var outS = ""; while (i < s.length && s.charAt(i) !== d) { if (s.charAt(i) === "\\" && s.charAt(i + 1) === d) { outS += d; i += 2; continue; } if (s.charAt(i) === "\\") { outS += s.charAt(i) + s.charAt(i + 1); i += 2; continue; } outS += s.charAt(i++); } if (i >= s.length) throw new ShError("sed: -e expression #1, char " + (i + 1) + ": unterminated `s' command", 1); i++; return outS; }
    while (i < s.length) {
      ws();
      if (i >= s.length) break;
      var c = { a1: addr() };
      if (c.a1 && s.charAt(i) === ",") { i++; c.a2 = addr(); }
      while (s.charAt(i) === " ") i++;
      if (s.charAt(i) === "!") { c.neg = true; i++; }
      var cmd = s.charAt(i++);
      c.cmd = cmd;
      if (cmd === "s") {
        var d = s.charAt(i++);
        var re = readDelim(d), repl = readDelim(d), flags = "";
        while (i < s.length && /[gpiIw0-9]/.test(s.charAt(i))) flags += s.charAt(i++);
        var m = /\d+/.exec(flags);
        c.re = new RegExp(toJsRegex(re, ere), (flags.indexOf("g") >= 0 || m ? "g" : "") + (/[iI]/.test(flags) ? "i" : ""));
        c.repl = ere ? repl : repl.replace(/\\\(|\\\)/g, "");
        c.p = flags.indexOf("p") >= 0; c.nth = m ? +m[0] : 0;
      } else if (cmd === "y") { var dd = s.charAt(i++); c.from = readDelim(dd); c.to = readDelim(dd); }
      else if (cmd === "a" || cmd === "i" || cmd === "c") { if (s.charAt(i) === "\\") i++; while (s.charAt(i) === " ") i++; var e = s.indexOf("\n", i); c.text = s.slice(i, e < 0 ? s.length : e); i = e < 0 ? s.length : e; }
      else if (!/[dpq=]/.test(cmd)) throw new ShError("sed: -e expression #1, char " + i + ": unknown command: `" + cmd + "'", 1);
      cmds.push(c);
    }
    return cmds;
  }
  S.toJsRegex = toJsRegex;

  /* ---------------- awk (a small but real one) */
  CMDS.awk = function (args, io, sess) {
    var a = args.slice(1), fs = " ", vars = {}, prog = null, files = [];
    for (var i = 0; i < a.length; i++) {
      var x = a[i];
      if (x === "-F") { fs = a[++i]; continue; }
      if (/^-F/.test(x)) { fs = x.slice(2); continue; }
      if (x === "-v") { var kv = a[++i].split("="); vars[kv[0]] = unescape(kv.slice(1).join("=")); continue; }
      if (x === "--help") return help(io, "awk");
      if (prog === null) { prog = x; continue; }
      files.push(x);
    }
    if (prog === null) throw new ShError("usage: awk [-F fs][-v var=value][prog | -f progfile][file ...]", 2);
    if (fs === "t" || fs === "\\t") fs = "\t";
    var A = awkCompile(prog);
    var env = { vars: Object.assign({ FS: fs, OFS: " ", ORS: "\n", NR: 0, NF: 0, FNR: 0, FILENAME: "", RS: "\n", SUBSEP: "\x1c" }, vars), fields: [], out: [] };
    var outText = [];
    var ctx = { env: env, write: function (s) { outText.push(s); }, exit: false };
    try {
      A.begin.forEach(function (b) { awkExec(b, ctx); });
      if (!ctx.exit && (A.main.length || A.end.length)) {
        var inputs = files.length ? files : ["-"];
        for (var f = 0; f < inputs.length && !ctx.exit; f++) {
          var text;
          if (inputs[f] === "-") text = io.stdin || "";
          else if (/^[A-Za-z_]\w*=/.test(inputs[f])) { var p2 = inputs[f].split("="); env.vars[p2[0]] = p2.slice(1).join("="); continue; }
          else { var r = S.readFile(sess, inputs[f]); if (r.error) { errl(io, "awk: cannot open \"" + inputs[f] + "\" (" + ERR[r.error] + ")"); return 2; } text = r.content; }
          env.vars.FILENAME = inputs[f] === "-" ? "" : inputs[f];
          env.vars.FNR = 0;
          var ls = lines(text);
          for (var k = 0; k < ls.length && !ctx.exit; k++) {
            S.step(sess);
            setRecord(env, ls[k]);
            env.vars.NR++; env.vars.FNR++;
            ctx.next = false;
            for (var m = 0; m < A.main.length && !ctx.next && !ctx.exit; m++) {
              var rule = A.main[m];
              if (rule.pattern && !truthy(awkEval(rule.pattern, ctx))) continue;
              if (rule.action) awkExec(rule.action, ctx);
              else ctx.write(env.record + env.vars.ORS);
            }
          }
        }
      }
      ctx.exit = false;
      A.end.forEach(function (b) { if (!ctx.exit) awkExec(b, ctx); });
    } catch (e) {
      if (e && e.awkError) { out(io, outText.join("")); errl(io, "awk: " + e.message); return 2; }
      if (e && e.awkExit !== undefined) { out(io, outText.join("")); return e.awkExit; }
      throw e;
    }
    out(io, outText.join(""));
    return ctx.exitCode || 0;
  };
  function setRecord(env, line) {
    env.record = line;
    var fs = String(env.vars.FS);
    var f;
    if (fs === " ") f = line.trim() === "" ? [] : line.trim().split(/[ \t]+/);
    else if (fs.length === 1 && fs !== "|" && fs !== ".") f = line.split(fs);
    else f = line.split(new RegExp(toJsRegex(fs, true)));
    if (line === "") f = [];
    env.fields = f;
    env.vars.NF = f.length;
  }
  function getField(env, n) { n = Math.floor(toNum(n)); if (n === 0) return env.record; return env.fields[n - 1] === undefined ? "" : env.fields[n - 1]; }
  function setField(env, n, v) {
    n = Math.floor(toNum(n));
    if (n === 0) { setRecord(env, toStr(v)); return; }
    while (env.fields.length < n) env.fields.push("");
    env.fields[n - 1] = toStr(v);
    env.vars.NF = env.fields.length;
    env.record = env.fields.join(String(env.vars.OFS));
  }
  function looksNum(s) { return typeof s === "number" || /^\s*[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?\s*$/.test(s); }
  function toNum(v) { if (typeof v === "number") return v; var m = /^\s*[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?/.exec(String(v)); return m ? parseFloat(m[0]) : 0; }
  function toStr(v) { if (typeof v === "number") { if (Number.isInteger(v)) return String(v); return String(parseFloat(v.toPrecision(6))); } return v === undefined ? "" : String(v); }
  function truthy(v) { if (typeof v === "number") return v !== 0; if (v && v.strnum) return toNum(v.s) !== 0; return v !== "" && v !== undefined; }

  // Tokenizer + recursive-descent parser for awk programs.
  function awkTokens(src) {
    var t = [], i = 0, prevSig = null;
    function canRegex() { return !prevSig || /^(op|punct|nl)$/.test(prevSig.type) && !/^[)\]]$/.test(prevSig.v); }
    while (i < src.length) {
      var c = src.charAt(i);
      if (c === " " || c === "\t" || (c === "\\" && src.charAt(i + 1) === "\n")) { i += c === "\\" ? 2 : 1; continue; }
      if (c === "#") { while (i < src.length && src.charAt(i) !== "\n") i++; continue; }
      if (c === "\n" || c === ";") { t.push(prevSig = { type: "nl", v: c }); i++; continue; }
      if (c === "\"") { var s = "", j = i + 1; while (j < src.length && src.charAt(j) !== "\"") { if (src.charAt(j) === "\\") { s += unescape(src.slice(j, j + 2)); j += 2; continue; } s += src.charAt(j++); } t.push(prevSig = { type: "str", v: s }); i = j + 1; continue; }
      if (c === "/" && canRegex()) { var r = "", k = i + 1; while (k < src.length && src.charAt(k) !== "/") { if (src.charAt(k) === "\\") { r += src.charAt(k) + src.charAt(k + 1); k += 2; continue; } r += src.charAt(k++); } t.push(prevSig = { type: "re", v: r }); i = k + 1; continue; }
      var num = /^(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?/.exec(src.slice(i));
      if (num) { t.push(prevSig = { type: "num", v: parseFloat(num[0]) }); i += num[0].length; continue; }
      var id = /^[A-Za-z_]\w*/.exec(src.slice(i));
      if (id) { t.push(prevSig = { type: "id", v: id[0] }); i += id[0].length; continue; }
      var op = /^(\+\+|--|\+=|-=|\*=|\/=|%=|\^=|==|!=|<=|>=|&&|\|\||!~|>>|[-+*\/%^!<>=~?:$(),{}\[\]|])/.exec(src.slice(i));
      if (op) { var ty = /^[(),{}\[\]]$/.test(op[0]) ? "punct" : "op"; t.push(prevSig = { type: ty, v: op[0] }); i += op[0].length; continue; }
      throw { awkError: true, message: "syntax error at source line 1: unexpected character '" + c + "'" };
    }
    return t;
  }
  function awkCompile(src) {
    var toks = awkTokens(src), pos = 0;
    function peek(k) { return toks[pos + (k || 0)]; }
    function is(v, k) { var t = peek(k); return t && (t.type === "op" || t.type === "punct") && t.v === v; }
    function eat(v) { if (!is(v)) throw { awkError: true, message: "syntax error at source line 1 near '" + (peek() ? peek().v : "end") + "'" }; pos++; }
    function skipNl() { while (peek() && peek().type === "nl") pos++; }
    var prog = { begin: [], main: [], end: [] };
    skipNl();
    while (peek()) {
      if (peek().type === "id" && peek().v === "BEGIN") { pos++; skipNl(); prog.begin.push(block()); }
      else if (peek().type === "id" && peek().v === "END") { pos++; skipNl(); prog.end.push(block()); }
      else if (peek().type === "id" && peek().v === "function") throw { awkError: true, message: "user functions aren't supported in this lab's awk" };
      else {
        var pat = null, action = null;
        if (!is("{")) pat = expr();
        if (is("{")) action = block();
        prog.main.push({ pattern: pat, action: action });
      }
      skipNl();
    }
    return prog;
    function block() { eat("{"); var stmts = []; skipNl(); while (!is("}")) { if (!peek()) throw { awkError: true, message: "syntax error: missing }" }; stmts.push(statement()); skipNl(); } eat("}"); return { t: "block", stmts: stmts }; }
    function simpleEnd() { if (peek() && peek().type === "nl") pos++; }
    function statement() {
      var t = peek();
      if (is("{")) return block();
      if (t.type === "id") {
        switch (t.v) {
          case "print": case "printf": {
            pos++;
            var argsL = [];
            var paren = is("(") && t.v === "printf";
            if (!(peek() && (peek().type === "nl" || is("}") || is(">") || is(">>") || is("|")))) {
              if (paren) { pos++; argsL.push(expr(true)); while (is(",")) { pos++; argsL.push(expr(true)); } eat(")"); }
              else { argsL.push(expr(true)); while (is(",")) { pos++; skipNl(); argsL.push(expr(true)); } }
            }
            var redir = null;
            if (is(">") || is(">>")) { var rop = peek().v; pos++; redir = { op: rop, target: primaryE() }; }
            simpleEnd();
            return { t: t.v, args: argsL, redir: redir };
          }
          case "if": { pos++; eat("("); var c = expr(); eat(")"); skipNl(); var th = statement(); skipNl(); var el = null; if (peek() && peek().type === "id" && peek().v === "else") { pos++; skipNl(); el = statement(); } else if (peek() && peek().type === "nl") { /* keep */ } return { t: "if", c: c, th: th, el: el }; }
          case "while": { pos++; eat("("); var wc = expr(); eat(")"); skipNl(); return { t: "while", c: wc, body: statement() }; }
          case "for": {
            pos++; eat("(");
            if (peek().type === "id" && is("in", 1) === false && peek(1) && peek(1).type === "id" && peek(1).v === "in") {
              var vn = peek().v; pos += 2; var arr = peek().v; pos++; eat(")"); skipNl();
              return { t: "forin", v: vn, arr: arr, body: statement() };
            }
            var init = is(";") || (peek().type === "nl") ? null : expr(); if (peek().type === "nl") pos++;
            var cond = peek().type === "nl" ? null : expr(); if (peek().type === "nl") pos++;
            var stepE = is(")") ? null : expr(); eat(")"); skipNl();
            return { t: "for", init: init, c: cond, step: stepE, body: statement() };
          }
          case "next": pos++; simpleEnd(); return { t: "next" };
          case "exit": { pos++; var ec = peek() && peek().type !== "nl" && !is("}") ? expr() : null; simpleEnd(); return { t: "exit", e: ec }; }
          case "delete": { pos++; var dn = peek().v; pos++; var di = null; if (is("[")) { pos++; di = expr(); eat("]"); } simpleEnd(); return { t: "delete", name: dn, idx: di }; }
          case "break": pos++; simpleEnd(); return { t: "break" };
          case "continue": pos++; simpleEnd(); return { t: "continue" };
        }
      }
      var e = expr();
      simpleEnd();
      return { t: "expr", e: e };
    }
    // precedence: ternary > || > && > in > ~ !~ > comparison > concat > additive > multiplicative > unary > power > postfix
    function expr(noGt) { return ternary(noGt); }
    function ternary(noGt) { var c = orE(noGt); if (is("?")) { pos++; var a = ternary(noGt); eat(":"); var b = ternary(noGt); return { t: "?:", c: c, a: a, b: b }; } return assignE(c, noGt); }
    function assignE(lhs, noGt) {
      if ((lhs.t === "var" || lhs.t === "field" || lhs.t === "idx") && peek() && peek().type === "op" && /^(=|\+=|-=|\*=|\/=|%=|\^=)$/.test(peek().v)) { var op = peek().v; pos++; return { t: "assign", op: op, lhs: lhs, rhs: ternary(noGt) }; }
      return lhs;
    }
    function orE(noGt) { var l = andE(noGt); while (is("||")) { pos++; skipNl(); l = { t: "||", l: l, r: andE(noGt) }; } return l; }
    function andE(noGt) { var l = inE(noGt); while (is("&&")) { pos++; skipNl(); l = { t: "&&", l: l, r: inE(noGt) }; } return l; }
    function inE(noGt) { var l = matchE(noGt); while (peek() && peek().type === "id" && peek().v === "in") { pos++; var arr = peek().v; pos++; l = { t: "in", k: l, arr: arr }; } return l; }
    function matchE(noGt) { var l = cmpE(noGt); while (is("~") || is("!~")) { var op = peek().v; pos++; l = { t: op, l: l, r: cmpE(noGt) }; } return l; }
    function cmpE(noGt) { var l = concatE(); while (peek() && peek().type === "op" && /^(<|<=|==|!=|>=|>)$/.test(peek().v) && !(noGt && peek().v === ">")) { var op = peek().v; pos++; l = { t: "cmp", op: op, l: l, r: concatE() }; } return l; }
    function startsPrimary() { var t = peek(); if (!t) return false; if (t.type === "num" || t.type === "str" || t.type === "re") return true; if (t.type === "id") return !/^(in|getline)$/.test(t.v); if (t.type === "op") return t.v === "$" || t.v === "!" || t.v === "-" && false || t.v === "++" || t.v === "--"; if (t.type === "punct") return t.v === "("; return false; }
    function concatE() { var l = addE(); while (startsPrimary()) l = { t: "cat", l: l, r: addE() }; return l; }
    function addE() { var l = mulE(); while (is("+") || is("-")) { var op = peek().v; pos++; l = { t: "arith", op: op, l: l, r: mulE() }; } return l; }
    function mulE() { var l = unaryE(); while (is("*") || is("/") || is("%")) { var op = peek().v; pos++; l = { t: "arith", op: op, l: l, r: unaryE() }; } return l; }
    function unaryE() { if (is("!")) { pos++; return { t: "not", e: unaryE() }; } if (is("-")) { pos++; return { t: "neg", e: unaryE() }; } if (is("+")) { pos++; return { t: "pos", e: unaryE() }; } return powE(); }
    function powE() { var b = postfixE(); if (is("^")) { pos++; return { t: "arith", op: "^", l: b, r: unaryE() }; } return b; }
    function postfixE() {
      if (is("++") || is("--")) { var op = peek().v; pos++; return { t: "pre", op: op, e: postfixE() }; }
      var p = primaryE();
      if (is("++") || is("--")) { var op2 = peek().v; pos++; return { t: "post", op: op2, e: p }; }
      return p;
    }
    function primaryE() {
      var t = peek();
      if (!t) throw { awkError: true, message: "syntax error: unexpected end of program" };
      if (t.type === "num") { pos++; return { t: "num", v: t.v }; }
      if (t.type === "str") { pos++; return { t: "str", v: t.v }; }
      if (t.type === "re") { pos++; return { t: "re", v: t.v }; }
      if (is("$")) { pos++; return { t: "field", e: postfixE() }; }
      if (is("(")) { pos++; var e = expr(); eat(")"); return { t: "grp", e: e }; }
      if (t.type === "id") {
        pos++;
        if (is("(") ) {
          pos++; var argsL = [];
          if (!is(")")) { argsL.push(expr()); while (is(",")) { pos++; argsL.push(expr()); } }
          eat(")");
          return { t: "call", name: t.v, args: argsL };
        }
        if (is("[")) { pos++; var idx = expr(); while (is(",")) { pos++; idx = { t: "cat", l: { t: "cat", l: idx, r: { t: "var", name: "SUBSEP" } }, r: expr() }; } eat("]"); return { t: "idx", name: t.v, i: idx }; }
        if (t.v === "length") return { t: "call", name: "length", args: [] };
        return { t: "var", name: t.v };
      }
      throw { awkError: true, message: "syntax error at source line 1 near '" + t.v + "'" };
    }
  }
  function awkEval(e, ctx) {
    var env = ctx.env, v = env.vars;
    switch (e.t) {
      case "num": return e.v;
      case "str": return e.v;
      case "re": return new RegExp(toJsRegex(e.v, true)).test(env.record) ? 1 : 0;
      case "grp": return awkEval(e.e, ctx);
      case "field": return strnum(getField(env, awkEval(e.e, ctx)));
      case "var": { if (e.name === "NF") return env.fields.length; var x = v[e.name]; if (x === undefined) return ""; return typeof x === "object" ? "" : x; }
      case "idx": { var arr = v[e.name] = typeof v[e.name] === "object" ? v[e.name] : {}; var key = toStr(val(awkEval(e.i, ctx))); return arr[key] === undefined ? (arr[key] = "", "") : arr[key]; }
      case "assign": {
        var rhs = val(awkEval(e.rhs, ctx)), cur, res;
        if (e.op !== "=") { cur = toNum(val(awkEval(e.lhs, ctx))); var r = toNum(rhs); res = e.op === "+=" ? cur + r : e.op === "-=" ? cur - r : e.op === "*=" ? cur * r : e.op === "/=" ? cur / r : e.op === "%=" ? cur % r : Math.pow(cur, r); }
        else res = rhs;
        store(e.lhs, res, ctx); return res;
      }
      case "pre": case "post": { var old = toNum(val(awkEval(e.e, ctx))), nv = old + (e.op === "++" ? 1 : -1); store(e.e, nv, ctx); return e.t === "pre" ? nv : old; }
      case "arith": { var a = toNum(val(awkEval(e.l, ctx))), b = toNum(val(awkEval(e.r, ctx))); switch (e.op) { case "+": return a + b; case "-": return a - b; case "*": return a * b; case "/": if (b === 0) throw { awkError: true, message: "division by zero" }; return a / b; case "%": return a % b; case "^": return Math.pow(a, b); } return 0; }
      case "neg": return -toNum(val(awkEval(e.e, ctx)));
      case "pos": return toNum(val(awkEval(e.e, ctx)));
      case "not": return truthy(awkEval(e.e, ctx)) ? 0 : 1;
      case "cat": return toStr(val(awkEval(e.l, ctx))) + toStr(val(awkEval(e.r, ctx)));
      case "cmp": {
        var L = awkEval(e.l, ctx), R = awkEval(e.r, ctx), c;
        var numeric = (typeof val(L) === "number" || (L && L.strnum && looksNum(L.s))) && (typeof val(R) === "number" || (R && R.strnum && looksNum(R.s)));
        if (numeric) { var x2 = toNum(val(L)), y2 = toNum(val(R)); c = x2 < y2 ? -1 : x2 > y2 ? 1 : 0; }
        else { var xs = toStr(val(L)), ys = toStr(val(R)); c = xs < ys ? -1 : xs > ys ? 1 : 0; }
        return ({ "<": c < 0, "<=": c <= 0, "==": c === 0, "!=": c !== 0, ">=": c >= 0, ">": c > 0 })[e.op] ? 1 : 0;
      }
      case "&&": return truthy(awkEval(e.l, ctx)) && truthy(awkEval(e.r, ctx)) ? 1 : 0;
      case "||": return truthy(awkEval(e.l, ctx)) || truthy(awkEval(e.r, ctx)) ? 1 : 0;
      case "~": case "!~": { var re = e.r.t === "re" ? e.r.v : toStr(val(awkEval(e.r, ctx))); var m = new RegExp(toJsRegex(re, true)).test(toStr(val(awkEval(e.l, ctx)))); return (e.t === "~" ? m : !m) ? 1 : 0; }
      case "in": { var ar = v[e.arr]; return ar && typeof ar === "object" && Object.prototype.hasOwnProperty.call(ar, toStr(val(awkEval(e.k, ctx)))) ? 1 : 0; }
      case "?:": return truthy(awkEval(e.c, ctx)) ? awkEval(e.a, ctx) : awkEval(e.b, ctx);
      case "call": return awkCall(e, ctx);
    }
    throw { awkError: true, message: "unsupported expression" };
  }
  function strnum(s) { return { strnum: true, s: s }; }
  function val(x) { return x && x.strnum ? (looksNum(x.s) ? x.s : x.s) : x; }
  function store(lhs, value, ctx) {
    var env = ctx.env;
    value = val(value);
    if (lhs.t === "var") { if (lhs.name === "NF") { env.fields.length = toNum(value); env.record = env.fields.join(String(env.vars.OFS)); } env.vars[lhs.name] = value; return; }
    if (lhs.t === "field") { setField(env, val(awkEval(lhs.e, ctx)), value); return; }
    if (lhs.t === "idx") { var arr = env.vars[lhs.name] = typeof env.vars[lhs.name] === "object" ? env.vars[lhs.name] : {}; arr[toStr(val(awkEval(lhs.i, ctx)))] = value; return; }
    if (lhs.t === "grp") return store(lhs.e, value, ctx);
    throw { awkError: true, message: "can't assign to that" };
  }
  function awkCall(e, ctx) {
    var env = ctx.env;
    function arg(k) { return e.args[k] ? val(awkEval(e.args[k], ctx)) : undefined; }
    switch (e.name) {
      case "length": { if (!e.args.length) return env.record.length; var a0 = e.args[0]; if (a0.t === "var" && typeof env.vars[a0.name] === "object") return Object.keys(env.vars[a0.name]).length; return toStr(arg(0)).length; }
      case "substr": { var s = toStr(arg(0)), st = Math.round(toNum(arg(1))), n = e.args.length > 2 ? Math.round(toNum(arg(2))) : Infinity; var from = Math.max(st, 1), to = n === Infinity ? s.length + 1 : st + n; return s.slice(from - 1, Math.max(from - 1, to - 1)); }
      case "index": { return toStr(arg(0)).indexOf(toStr(arg(1))) + 1; }
      case "tolower": return toStr(arg(0)).toLowerCase();
      case "toupper": return toStr(arg(0)).toUpperCase();
      case "int": return Math.trunc(toNum(arg(0)));
      case "sqrt": return Math.sqrt(toNum(arg(0)));
      case "rand": return 0.237;
      case "srand": return 0;
      case "sprintf": return S.formatPrintf(toStr(arg(0)), e.args.slice(1).map(function (x, k) { return toStr(arg(k + 1)); }), "awk");
      case "split": {
        var str = toStr(arg(0)), name = e.args[1].name, sep = e.args.length > 2 ? (e.args[2].t === "re" ? new RegExp(toJsRegex(e.args[2].v, true)) : toStr(arg(2))) : env.vars.FS;
        var parts = sep === " " ? str.trim().split(/\s+/) : typeof sep === "string" && sep.length === 1 ? str.split(sep) : str.split(sep instanceof RegExp ? sep : new RegExp(toJsRegex(sep, true)));
        if (str === "") parts = [];
        var arr = env.vars[name] = {};
        parts.forEach(function (p, k) { arr[String(k + 1)] = p; });
        return parts.length;
      }
      case "sub": case "gsub": {
        var reSrc = e.args[0].t === "re" ? e.args[0].v : toStr(arg(0));
        var re = new RegExp(toJsRegex(reSrc, true), e.name === "gsub" ? "g" : "");
        var target = e.args[2] || { t: "field", e: { t: "num", v: 0 } };
        var cur = toStr(val(awkEval(target, ctx))), n2 = 0;
        var repl = toStr(arg(1));
        var res = cur.replace(re, function (m) { n2++; return repl.replace(/\\&|&/g, function (x) { return x === "&" ? m : "&"; }); });
        store(target, res, ctx);
        return n2;
      }
      case "match": { var m = new RegExp(toJsRegex(e.args[1].t === "re" ? e.args[1].v : toStr(arg(1)), true)).exec(toStr(arg(0))); env.vars.RSTART = m ? m.index + 1 : 0; env.vars.RLENGTH = m ? m[0].length : -1; return env.vars.RSTART; }
      case "system": return 0;
    }
    throw { awkError: true, message: "calling undefined function " + e.name };
  }
  function awkExec(s, ctx) {
    var env = ctx.env;
    switch (s.t) {
      case "block": for (var i = 0; i < s.stmts.length; i++) { awkExec(s.stmts[i], ctx); if (ctx.next || ctx.exit || ctx.brk || ctx.cont) return; } return;
      case "expr": awkEval(s.e, ctx); return;
      case "print": {
        var text = s.args.length ? s.args.map(function (a) { var v = val(awkEval(a, ctx)); return typeof v === "number" ? (Number.isInteger(v) ? String(v) : toStr(v)) : toStr(v); }).join(String(env.vars.OFS)) : env.record;
        ctx.write(text + env.vars.ORS); return;
      }
      case "printf": { var vals = s.args.map(function (a) { return toStr(val(awkEval(a, ctx))); }); ctx.write(S.formatPrintf(vals[0] || "", vals.slice(1), "awk")); return; }
      case "if": if (truthy(awkEval(s.c, ctx))) awkExec(s.th, ctx); else if (s.el) awkExec(s.el, ctx); return;
      case "while": { var guard = 0; while (truthy(awkEval(s.c, ctx))) { if (++guard > 100000) throw { awkError: true, message: "loop ran too long" }; awkExec(s.body, ctx); if (ctx.brk) { ctx.brk = false; break; } ctx.cont = false; if (ctx.next || ctx.exit) return; } return; }
      case "for": { if (s.init) awkEval(s.init, ctx); var g2 = 0; while (!s.c || truthy(awkEval(s.c, ctx))) { if (++g2 > 100000) throw { awkError: true, message: "loop ran too long" }; awkExec(s.body, ctx); if (ctx.brk) { ctx.brk = false; break; } ctx.cont = false; if (ctx.next || ctx.exit) return; if (s.step) awkEval(s.step, ctx); } return; }
      case "forin": { var arr = env.vars[s.arr]; if (!arr || typeof arr !== "object") return; Object.keys(arr).forEach(function (k) { if (ctx.brk || ctx.next || ctx.exit) return; env.vars[s.v] = k; awkExec(s.body, ctx); ctx.cont = false; }); ctx.brk = false; return; }
      case "next": ctx.next = true; return;
      case "exit": ctx.exit = true; if (s.e) ctx.exitCode = toNum(val(awkEval(s.e, ctx))); return;
      case "delete": if (s.idx) { var a2 = env.vars[s.name]; if (a2 && typeof a2 === "object") delete a2[toStr(val(awkEval(s.idx, ctx)))]; } else env.vars[s.name] = {}; return;
      case "break": ctx.brk = true; return;
      case "continue": ctx.cont = true; return;
    }
  }
  CMDS.gawk = CMDS.awk; CMDS.mawk = CMDS.awk;

  /* ---------------- making and changing files */
  function parentOf(sess, path) { var abs = S.absPath(sess, path); var dir = abs.slice(0, abs.lastIndexOf("/")) || "/"; return { dir: dir, name: abs.slice(abs.lastIndexOf("/") + 1), abs: abs }; }
  CMDS.touch = function (args, io, sess) {
    var p = opts("touch", args, { flags: "acm", vals: "dtr", long: { "no-create": "c", date: "d=" } });
    if (p.o.help) return help(io, "touch");
    if (!p.rest.length) throw new ShError("touch: missing file operand\nTry 'touch --help' for more information.", 1);
    var code = 0;
    var when = sess.sys.now;
    if (p.o.d !== undefined) { var t = Date.parse(p.o.d.replace(" ", "T") + (/[zZ]|[+-]\d\d:?\d\d$/.test(p.o.d) ? "" : "Z")); if (!isNaN(t)) when = t; else { var m = /^(\d+)\s+days?\s+ago$/.exec(p.o.d); if (m) when = NOW - m[1] * DAY; } }
    p.rest.forEach(function (f) {
      var r = S.lookup(sess, f);
      if (r.node) { if (r.node.uid !== sess.uid && !S.can(sess, r.node, "w")) { errl(io, "touch: cannot touch '" + f + "': Permission denied"); code = 1; return; } r.node.mtime = when; return; }
      if (p.o.c) return;
      var e = S.writeFile(sess, f, "", false);
      if (e) { errl(io, "touch: cannot touch '" + f + "': " + ERR[e]); code = 1; return; }
      S.lookup(sess, f).node.mtime = when;
    });
    return code;
  };
  CMDS.mkdir = function (args, io, sess) {
    var p = opts("mkdir", args, { flags: "pv", vals: "m", long: { parents: "p", verbose: "v", mode: "m=" } });
    if (p.o.help) return help(io, "mkdir");
    if (!p.rest.length) throw new ShError("mkdir: missing operand\nTry 'mkdir --help' for more information.", 1);
    var code = 0;
    var mode = p.o.m !== undefined ? parseInt(p.o.m, 8) : 511 & ~sess.umask;
    p.rest.forEach(function (d) {
      var abs = S.absPath(sess, d);
      var parts = S.splitPath(abs), cur = "";
      for (var k = 0; k < parts.length; k++) {
        cur += "/" + parts[k];
        var last = k === parts.length - 1;
        var r = S.lookup(sess, cur);
        if (r.node) {
          if (last && !p.o.p) { errl(io, "mkdir: cannot create directory ‘" + d + "’: File exists"); code = 1; }
          else if (r.node.type !== "d") { errl(io, "mkdir: cannot create directory ‘" + d + "’: Not a directory"); code = 1; return; }
          continue;
        }
        if (r.error !== "ENOENT") { errl(io, "mkdir: cannot create directory ‘" + d + "’: " + ERR[r.error]); code = 1; return; }
        if (!last && !p.o.p) { errl(io, "mkdir: cannot create directory ‘" + d + "’: No such file or directory"); code = 1; return; }
        if (!S.can(sess, r.parent, "w")) { errl(io, "mkdir: cannot create directory ‘" + d + "’: Permission denied"); code = 1; return; }
        r.parent.children[r.name] = S.dirNode(last ? mode : 511 & ~sess.umask, sess.uid, sess.gid, sess.sys.now);
        if (p.o.v) out(io, "mkdir: created directory '" + (last ? d : cur) + "'\n");
      }
    });
    return code;
  };
  CMDS.rmdir = function (args, io, sess) {
    var p = opts("rmdir", args, { flags: "pv", long: { parents: "p", verbose: "v" } });
    var code = 0;
    p.rest.forEach(function (d) {
      var r = S.lookup(sess, d, { nofollow: true });
      if (r.error) { errl(io, "rmdir: failed to remove '" + d + "': " + ERR[r.error]); code = 1; return; }
      if (r.node.type !== "d") { errl(io, "rmdir: failed to remove '" + d + "': Not a directory"); code = 1; return; }
      if (Object.keys(r.node.children).length) { errl(io, "rmdir: failed to remove '" + d + "': Directory not empty"); code = 1; return; }
      if (!S.can(sess, r.parent, "w")) { errl(io, "rmdir: failed to remove '" + d + "': Permission denied"); code = 1; return; }
      delete r.parent.children[r.name];
    });
    return code;
  };
  function canRemove(sess, parent, node) {
    if (!S.can(sess, parent, "w") || !S.can(sess, parent, "x")) return false;
    if ((parent.mode & 512) && sess.uid !== 0 && node.uid !== sess.uid && parent.uid !== sess.uid) return false; // sticky bit (/tmp)
    return true;
  }
  CMDS.rm = function (args, io, sess) {
    var p = opts("rm", args, { flags: "rRfivdI", long: { recursive: "r", force: "f", verbose: "v", dir: "d", interactive: "", "no-preserve-root": "npr", "preserve-root": "" } });
    if (p.o.help) return help(io, "rm");
    var o = p.o, rec = o.r || o.R, code = 0;
    if (!p.rest.length) { if (o.f) return 0; throw new ShError("rm: missing operand\nTry 'rm --help' for more information.", 1); }
    p.rest.forEach(function (f) {
      if (rec && S.absPath(sess, f) === "/" && !o.npr) { errl(io, "rm: it is dangerous to operate recursively on '/'\nrm: use --no-preserve-root to override this failsafe"); code = 1; return; }
      if (/(^|\/)\.\.?\/?$/.test(f)) { errl(io, "rm: refusing to remove '.' or '..' directory: skipping '" + f + "'"); code = 1; return; }
      var r = S.lookup(sess, f, { nofollow: true });
      if (r.error) { if (!o.f) { errl(io, "rm: cannot remove '" + f + "': " + ERR[r.error]); code = 1; } return; }
      if (r.node.type === "d" && !rec && !(o.d && !Object.keys(r.node.children).length)) { errl(io, "rm: cannot remove '" + f + "': Is a directory"); code = 1; return; }
      if (!removeTree(r.parent, r.name, f)) code = 1;
    });
    function removeTree(parent, name, shown) {
      var node = parent.children[name];
      if (node.type === "d") {
        if (!S.can(sess, node, "r") || !S.can(sess, node, "x")) { errl(io, "rm: cannot remove '" + shown + "': Permission denied"); return false; }
        var ok = true;
        Object.keys(node.children).forEach(function (n) { if (!removeTree(node, n, shown.replace(/\/$/, "") + "/" + n)) ok = false; });
        if (!ok) return false;
      }
      if (!canRemove(sess, parent, node)) { errl(io, "rm: cannot remove '" + shown + "': " + ((parent.mode & 512) ? "Operation not permitted" : "Permission denied")); return false; }
      delete parent.children[name];
      parent.mtime = sess.sys.now;
      if (o.v) out(io, (node.type === "d" ? "removed directory '" : "removed '") + shown + "'\n");
      return true;
    }
    return code;
  };
  function cloneNode(n, sess, preserve) {
    var c;
    if (n.type === "d") { c = S.dirNode(preserve ? n.mode : n.mode & ~sess.umask & 4095, preserve && sess.uid === 0 ? n.uid : sess.uid, preserve && sess.uid === 0 ? n.gid : sess.gid, preserve ? n.mtime : sess.sys.now); Object.keys(n.children).forEach(function (k) { c.children[k] = cloneNode(n.children[k], sess, preserve); }); return c; }
    if (n.type === "l") return S.linkNode(n.target, sess.uid, sess.gid);
    c = S.fileNode(n.content, preserve ? n.mode : n.mode & ~sess.umask & 4095, preserve && sess.uid === 0 ? n.uid : sess.uid, preserve && sess.uid === 0 ? n.gid : sess.gid, preserve ? n.mtime : sess.sys.now);
    if (n.size != null) c.size = n.size;
    return c;
  }
  function copyOrMove(isMove) {
    var name = isMove ? "mv" : "cp";
    return function (args, io, sess) {
      var p = opts(name, args, { flags: isMove ? "fivnuT" : "rRapfivnuTL", vals: "t", long: { recursive: "r", archive: "a", verbose: "v", force: "f", interactive: "i", "no-clobber": "n", "preserve": "p", "target-directory": "t=" } });
      if (p.o.help) return help(io, name);
      var o = p.o, items = p.rest.slice(), code = 0;
      if (o.t !== undefined) items.push(o.t);
      if (items.length < 2) { if (!items.length) throw new ShError(name + ": missing file operand\nTry '" + name + " --help' for more information.", 1); throw new ShError(name + ": missing destination file operand after '" + items[0] + "'\nTry '" + name + " --help' for more information.", 1); }
      var dest = items.pop();
      var dr = S.lookup(sess, dest);
      var destIsDir = dr.node && dr.node.type === "d";
      if (items.length > 1 && !destIsDir) { errl(io, name + ": target '" + dest + "' is not a directory"); return 1; }
      items.forEach(function (src) {
        var sr = S.lookup(sess, src, { nofollow: isMove });
        if (sr.error) { errl(io, name + ": cannot stat '" + src + "': " + ERR[sr.error]); code = 1; return; }
        if (!isMove && sr.node.type === "d" && !(o.r || o.R || o.a)) { errl(io, "cp: -r not specified; omitting directory '" + src + "'"); code = 1; return; }
        if (!isMove && sr.node.type === "f" && !S.can(sess, sr.node, "r")) { errl(io, "cp: cannot open '" + src + "' for reading: Permission denied"); code = 1; return; }
        var target = destIsDir ? dest.replace(/\/$/, "") + "/" + S.splitPath(S.absPath(sess, src)).pop() : dest;
        var tp = parentOf(sess, target);
        var pr = S.lookup(sess, tp.dir);
        if (pr.error || pr.node.type !== "d") { errl(io, name + ": cannot " + (isMove ? "move '" + src + "' to" : "create regular file") + " '" + target + "': " + (pr.error ? ERR[pr.error] : "Not a directory")); code = 1; return; }
        var existing = pr.node.children[tp.name];
        if (existing && o.n) return;
        if (S.absPath(sess, src) === tp.abs) { errl(io, name + ": '" + src + "' and '" + target + "' are the same file"); code = 1; return; }
        if (isMove && sr.node.type === "d" && (tp.abs + "/").indexOf(S.absPath(sess, src) + "/") === 0) { errl(io, "mv: cannot move '" + src + "' to a subdirectory of itself, '" + target + "'"); code = 1; return; }
        if (existing && existing.type === "d" && sr.node.type !== "d") { errl(io, name + ": cannot overwrite directory '" + target + "' with non-directory"); code = 1; return; }
        if (!S.can(sess, pr.node, "w") || (existing && existing.type === "f" && !isMove && !S.can(sess, existing, "w"))) { errl(io, name + ": cannot " + (isMove ? "move '" + src + "' to" : "create regular file") + " '" + target + "': Permission denied"); code = 1; return; }
        if (isMove) {
          if (!canRemove(sess, sr.parent, sr.node)) { errl(io, "mv: cannot move '" + src + "' to '" + target + "': Permission denied"); code = 1; return; }
          delete sr.parent.children[sr.name];
          pr.node.children[tp.name] = sr.node;
        } else {
          if (existing && existing.type === "f" && sr.node.type === "f") { existing.content = sr.node.content; existing.mtime = o.p || o.a ? sr.node.mtime : sess.sys.now; }
          else pr.node.children[tp.name] = cloneNode(sr.node, sess, o.p || o.a);
        }
        pr.node.mtime = sess.sys.now;
        if (o.v) out(io, (isMove ? "renamed '" : "'") + src + "' -> '" + target + "'\n");
      });
      return code;
    };
  }
  CMDS.cp = copyOrMove(false); CMDS.mv = copyOrMove(true);
  CMDS.ln = function (args, io, sess) {
    var p = opts("ln", args, { flags: "sfvnT", long: { symbolic: "s", force: "f", verbose: "v" } });
    if (p.rest.length < 1) throw new ShError("ln: missing file operand\nTry 'ln --help' for more information.", 1);
    var target = p.rest[0], linkPath = p.rest[1] || S.splitPath(target).pop();
    var lr = S.lookup(sess, linkPath, { nofollow: true });
    if (lr.node && lr.node.type === "d" && p.rest[1] !== undefined && !p.o.n) { linkPath = linkPath.replace(/\/$/, "") + "/" + S.splitPath(target).pop(); lr = S.lookup(sess, linkPath, { nofollow: true }); }
    if (lr.node) { if (!p.o.f) { errl(io, "ln: failed to create " + (p.o.s ? "symbolic " : "hard ") + "link '" + linkPath + "': File exists"); return 1; } delete lr.parent.children[lr.name]; lr = S.lookup(sess, linkPath, { nofollow: true }); }
    if (!lr.parent || !S.can(sess, lr.parent, "w")) { errl(io, "ln: failed to create symbolic link '" + linkPath + "': Permission denied"); return 1; }
    if (p.o.s) lr.parent.children[lr.name] = S.linkNode(target, sess.uid, sess.gid);
    else { var tr = S.lookup(sess, target); if (tr.error) { errl(io, "ln: failed to access '" + target + "': " + ERR[tr.error]); return 1; } lr.parent.children[lr.name] = tr.node; }
    return 0;
  };

  /* ---------------- permissions */
  function applyMode(spec, mode, isDir, umask) {
    if (/^[0-7]{1,4}$/.test(spec)) return parseInt(spec, 8);
    var m = mode;
    spec.split(",").forEach(function (part) {
      var mm = /^([ugoa]*)([-+=])([rwxXstugo]*)$/.exec(part);
      if (!mm) throw new Error("bad");
      var who = mm[1] || "a", op = mm[2], perms = mm[3];
      var noWho = mm[1] === "";
      var bits = 0;
      perms.split("").forEach(function (c) {
        if (c === "r") bits |= 292; if (c === "w") bits |= 146; if (c === "x") bits |= 73;
        if (c === "X" && (isDir || (mode & 73))) bits |= 73;
        if (c === "s") bits |= 3072; if (c === "t") bits |= 512;
      });
      var mask = 0;
      if (/[ua]/.test(who)) mask |= 448 | 2048; if (/[ga]/.test(who)) mask |= 56 | 1024; if (/[oa]/.test(who)) mask |= 7 | 512;
      var b = bits & mask;
      if (noWho && op !== "=") b &= ~umask;
      if (op === "+") m |= b; else if (op === "-") m &= ~b; else m = (m & ~(mask & 4095)) | b;
    });
    return m;
  }
  CMDS.chmod = function (args, io, sess) {
    var a = args.slice(1), rec = false, verbose = false;
    while (a.length && /^-[Rvcf]+$/.test(a[0])) { var f = a.shift(); if (f.indexOf("R") >= 0) rec = true; if (f.indexOf("v") >= 0) verbose = true; }
    if (a[0] === "--help") return help(io, "chmod");
    if (a.length < 2) throw new ShError(a.length ? "chmod: missing operand after '" + a[0] + "'\nTry 'chmod --help' for more information." : "chmod: missing operand\nTry 'chmod --help' for more information.", 1);
    var spec = a.shift(), code = 0;
    a.forEach(function (f) {
      var r = S.lookup(sess, f);
      if (r.error) { errl(io, "chmod: cannot access '" + f + "': " + ERR[r.error]); code = 1; return; }
      (function apply(node, shown) {
        if (sess.uid !== 0 && node.uid !== sess.uid) { errl(io, "chmod: changing permissions of '" + shown + "': Operation not permitted"); code = 1; return; }
        var nm;
        try { nm = applyMode(spec, node.mode, node.type === "d", sess.umask); }
        catch (e) { throw new ShError("chmod: invalid mode: ‘" + spec + "’\nTry 'chmod --help' for more information.", 1); }
        if (verbose) out(io, "mode of '" + shown + "' changed from " + pad(octal(node.mode), 4, "0") + " (" + modeStr(node).slice(1) + ") to " + pad(octal(nm), 4, "0") + "\n");
        node.mode = nm;
        if (rec && node.type === "d") Object.keys(node.children).forEach(function (k) { var ch = node.children[k]; if (ch.type !== "l") apply(ch, shown.replace(/\/$/, "") + "/" + k); });
      })(r.node, f);
    });
    return code;
  };
  function chownImpl(isGrp) {
    var name = isGrp ? "chgrp" : "chown";
    return function (args, io, sess) {
      var a = args.slice(1), rec = false, verbose = false;
      while (a.length && /^-[Rvhcf]+$/.test(a[0])) { var f = a.shift(); if (f.indexOf("R") >= 0) rec = true; if (f.indexOf("v") >= 0) verbose = true; }
      if (a[0] === "--help") return help(io, name);
      if (a.length < 2) throw new ShError(name + ": missing operand\nTry '" + name + " --help' for more information.", 1);
      var spec = a.shift(), user = null, group = null;
      if (isGrp) group = spec;
      else { var m = /^([^:.]*)(?:[:.]([^:]*))?$/.exec(spec); user = m[1] || null; group = m[2] !== undefined && m[2] !== "" ? m[2] : null; if (m[2] === "" && user) group = (S.userByName(sess.sys, user) || {}).gid !== undefined ? S.gname(sess.sys, S.userByName(sess.sys, user).gid) : null; }
      var uid = null, gid = null;
      if (user) { var u = S.userByName(sess.sys, user); if (!u && !/^\d+$/.test(user)) throw new ShError(name + ": invalid user: ‘" + spec + "’", 1); uid = u ? u.uid : +user; }
      if (group) { var g = S.groupByName(sess.sys, group); if (!g && !/^\d+$/.test(group)) throw new ShError(name + ": invalid group: ‘" + spec + "’", 1); gid = g ? g.gid : +group; }
      var code = 0;
      a.forEach(function (f) {
        var r = S.lookup(sess, f);
        if (r.error) { errl(io, name + ": cannot access '" + f + "': " + ERR[r.error]); code = 1; return; }
        (function apply(node, shown) {
          var allowed = sess.uid === 0 || (uid === null || uid === node.uid) && node.uid === sess.uid && (gid === null || (sess.groups || []).concat([sess.gid]).indexOf(gid) >= 0);
          if (!allowed) { errl(io, name + ": changing " + (uid !== null && uid !== node.uid ? "ownership" : "group") + " of '" + shown + "': Operation not permitted"); code = 1; return; }
          if (uid !== null) node.uid = uid;
          if (gid !== null) node.gid = gid;
          if (uid !== null && sess.uid === 0) node.mode &= ~3072 | (node.type === "d" ? 1024 : 0);
          if (verbose) out(io, "changed ownership of '" + shown + "' to " + (user || "") + (group ? ":" + group : "") + "\n");
          if (rec && node.type === "d") Object.keys(node.children).forEach(function (k) { var ch = node.children[k]; if (ch.type !== "l") apply(ch, shown.replace(/\/$/, "") + "/" + k); });
        })(r.node, f);
      });
      return code;
    };
  }
  CMDS.chown = chownImpl(false); CMDS.chgrp = chownImpl(true);
  CMDS.stat = function (args, io, sess) {
    var p = opts("stat", args, { flags: "Lt", vals: "c", long: { format: "c=" } });
    if (p.o.help) return help(io, "stat");
    var code = 0;
    p.rest.forEach(function (f) {
      var r = S.lookup(sess, f, { nofollow: !p.o.L });
      if (r.error) { errl(io, "stat: cannot statx '" + f + "': " + ERR[r.error]); code = 1; return; }
      var n = r.node, kind = n.type === "d" ? "directory" : n.type === "l" ? "symbolic link" : n.special ? "character special file" : nodeSize(n) ? "regular file" : "regular empty file";
      if (p.o.c !== undefined) {
        out(io, p.o.c.replace(/%([aAUGugnsyFhiN%])/g, function (m, c) {
          return { a: octal(n.mode), A: modeStr(n), U: S.uname(sess.sys, n.uid), G: S.gname(sess.sys, n.gid), u: String(n.uid), g: String(n.gid), n: f, N: "'" + f + "'", s: String(nodeSize(n)), y: isoDate(n.mtime) + ".000000000 +0000", F: kind, h: "1", i: "1310722", "%": "%" }[c];
        }) + "\n");
        return;
      }
      var u = S.uname(sess.sys, n.uid), g = S.gname(sess.sys, n.gid);
      out(io, "  File: " + f + (n.type === "l" ? " -> " + n.target : "") + "\n  Size: " + rpad(nodeSize(n), 10) + "\tBlocks: " + rpad(blocks(n) * 2, 10) + " IO Block: 4096   " + kind + "\n" +
        "Device: 252,1\tInode: " + rpad(1310720 + f.length * 37, 11) + " Links: 1\n" +
        "Access: (" + pad(octal(n.mode), 4, "0") + "/" + modeStr(n) + ")  Uid: (" + pad(n.uid, 5) + "/" + pad(u, 8) + ")   Gid: (" + pad(n.gid, 5) + "/" + pad(g, 8) + ")\n" +
        "Access: " + isoDate(n.mtime) + ".000000000 +0000\nModify: " + isoDate(n.mtime) + ".000000000 +0000\nChange: " + isoDate(n.mtime) + ".000000000 +0000\n Birth: " + isoDate(n.mtime) + ".000000000 +0000\n");
    });
    return code;
  };
  CMDS.file = function (args, io, sess) {
    var code = 0;
    args.slice(1).filter(function (a) { return a.charAt(0) !== "-"; }).forEach(function (f) {
      var r = S.lookup(sess, f, { nofollow: true });
      if (r.error) { out(io, f + ": cannot open `" + f + "' (" + ERR[r.error] + ")\n"); return; }
      var n = r.node, t;
      if (n.type === "d") t = "directory";
      else if (n.type === "l") t = "symbolic link to " + n.target;
      else if (n.special) t = "character special (1/3)";
      else if (!S.can(sess, n, "r")) t = "regular file, no read permission";
      else if (n.content === "") t = "empty";
      else if (/^\x7fELF/.test(n.content)) t = "ELF 64-bit LSB pie executable, x86-64, version 1 (SYSV), dynamically linked, interpreter /lib64/ld-linux-x86-64.so.2, stripped" + ((n.mode & 2048) ? ", setuid" : "");
      else if (/^#!.*\b(ba)?sh\b/.test(n.content)) t = "Bourne-Again shell script, ASCII text executable";
      else if (/^#!.*python/.test(n.content)) t = "Python script, ASCII text executable";
      else if (/^\s*[{[]/.test(n.content)) t = "JSON text data";
      else if (/^<(!DOCTYPE|html)/i.test(n.content)) t = "HTML document, ASCII text";
      else if (/^MZ/.test(n.content)) t = "PE32+ executable (console) x86-64, for MS Windows";
      else if (/^PK/.test(n.content)) t = "Zip archive data, at least v2.0 to extract";
      else if (/^\x1f\x8b/.test(n.content)) t = "gzip compressed data";
      else if (/^-----BEGIN (OPENSSH|RSA) PRIVATE KEY/.test(n.content)) t = "OpenSSH private key";
      else t = /[^\x00-\x7f]/.test(n.content) ? "Unicode text, UTF-8 text" : "ASCII text" + (/\r\n/.test(n.content) ? ", with CRLF line terminators" : "");
      out(io, f + ": " + t + "\n");
    });
    return code;
  };
  CMDS.du = function (args, io, sess) {
    var p = opts("du", args, { flags: "shacb", vals: "d", long: { summarize: "s", "human-readable": "h", all: "a", total: "c", "max-depth": "d=" } });
    if (p.o.help) return help(io, "du");
    var o = p.o, code = 0, grand = 0, maxd = o.d !== undefined ? +o.d : o.s ? 0 : Infinity;
    function fmt(k) { return o.h ? human(k * 1024) : String(k); }
    (p.rest.length ? p.rest : ["."]).forEach(function (f) {
      var r = S.lookup(sess, f);
      if (r.error) { errl(io, "du: cannot access '" + f + "': " + ERR[r.error]); code = 1; return; }
      var linesOut = [];
      function size(node, path, depth) {
        if (node.type !== "d") { var b = blocks(node); if (o.a && depth <= maxd && depth > 0) linesOut.push(fmt(b) + "\t" + path); return b; }
        var total = 4;
        if (!S.can(sess, node, "r") || !S.can(sess, node, "x")) { errl(io, "du: cannot read directory '" + path + "': Permission denied"); code = 1; }
        else Object.keys(node.children).sort(S.sortNames).forEach(function (k) { total += size(node.children[k], path.replace(/\/$/, "") + "/" + k, depth + 1); });
        if (depth <= maxd) linesOut.push(fmt(total) + "\t" + path);
        return total;
      }
      grand += size(r.node, f, 0);
      out(io, joinLines(linesOut));
    });
    if (o.c) out(io, fmt(grand) + "\ttotal\n");
    return code;
  };
  CMDS.df = function (args, io) {
    var h = args.indexOf("-h") >= 0 || args.indexOf("-H") >= 0;
    var rows = [["tmpfs", 404664, 1088, 403576, "/run"], ["/dev/vda1", 40581564, 31212800, 9352380, "/"], ["tmpfs", 2023312, 0, 2023312, "/dev/shm"], ["/dev/vda15", 106832, 6250, 100582, "/boot/efi"], ["/dev/vdb", 103081248, 41232500, 56589540, "/srv/backups"]];
    out(io, (h ? "Filesystem      Size  Used Avail Use% Mounted on\n" : "Filesystem     1K-blocks     Used Available Use% Mounted on\n") +
      rows.map(function (r) { var pct = Math.ceil(r[2] / r[1] * 100) + "%"; return h ? rpad(r[0], 15) + " " + pad(human(r[1] * 1024), 4) + " " + pad(human(r[2] * 1024), 5) + " " + pad(human(r[3] * 1024), 5) + " " + pad(pct, 4) + " " + r[4] : rpad(r[0], 14) + " " + pad(r[1], 9) + " " + pad(r[2], 8) + " " + pad(r[3], 9) + " " + pad(pct, 4) + " " + r[4]; }).join("\n") + "\n");
    return 0;
  };

  /* ---------------- who am I, where am I */
  function fmtDate(ms, fmt) {
    var d = new Date(ms);
    var Y = d.getUTCFullYear(), m = d.getUTCMonth(), D = d.getUTCDate(), H = d.getUTCHours(), M = d.getUTCMinutes(), Sx = d.getUTCSeconds(), w = d.getUTCDay();
    var FULLM = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"], FULLD = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    return fmt.replace(/%([YmdHMSFTaAbBejsuyZz%nR])/g, function (x, c) {
      switch (c) {
        case "Y": return Y; case "m": return pad(m + 1, 2, "0"); case "d": return pad(D, 2, "0"); case "H": return pad(H, 2, "0"); case "M": return pad(M, 2, "0"); case "S": return pad(Sx, 2, "0");
        case "F": return Y + "-" + pad(m + 1, 2, "0") + "-" + pad(D, 2, "0"); case "T": return pad(H, 2, "0") + ":" + pad(M, 2, "0") + ":" + pad(Sx, 2, "0"); case "R": return pad(H, 2, "0") + ":" + pad(M, 2, "0");
        case "a": return WDAY[w]; case "A": return FULLD[w]; case "b": return MON[m]; case "B": return FULLM[m]; case "e": return pad(D, 2); case "j": return pad(Math.floor((ms - Date.UTC(Y, 0, 1)) / DAY) + 1, 3, "0");
        case "s": return Math.floor(ms / 1000); case "u": return w || 7; case "y": return pad(Y % 100, 2, "0"); case "Z": return "UTC"; case "z": return "+0000"; case "n": return "\n"; case "%": return "%";
      }
      return x;
    });
  }
  S.fmtDate = fmtDate;
  CMDS.date = function (args, io, sess) {
    var a = args.slice(1), t = sess.sys.now, fmt = "%a %b %e %T %Z %Y";
    for (var i = 0; i < a.length; i++) {
      if (a[i].charAt(0) === "+") fmt = a[i].slice(1);
      else if (a[i] === "-u" || a[i] === "--utc") continue;
      else if (a[i] === "-I" || a[i] === "--iso-8601") fmt = "%F";
      else if (a[i] === "-d" || /^--date=/.test(a[i])) {
        var spec = a[i] === "-d" ? a[++i] : a[i].slice(7), m;
        if ((m = /^(-?\d+)\s+(day|hour|minute|week)s?(\s+ago)?$/.exec(spec))) { var n = +m[1] * ({ day: DAY, hour: 3600000, minute: 60000, week: 7 * DAY }[m[2]]); t = m[3] ? t - n : t + n; }
        else if (spec === "yesterday") t -= DAY; else if (spec === "tomorrow") t += DAY;
        else if (/^@\d+$/.test(spec)) t = +spec.slice(1) * 1000;
        else { var p2 = Date.parse(spec.replace(" ", "T") + (/Z|[+-]\d\d/.test(spec) ? "" : "Z")); if (isNaN(p2)) { errl(io, "date: invalid date ‘" + spec + "’"); return 1; } t = p2; }
      }
    }
    out(io, fmtDate(t, fmt) + "\n");
    return 0;
  };
  CMDS.hostname = function (args, io, sess) { out(io, (args[1] === "-I" ? "10.20.0.15 " : args[1] === "-f" ? sess.sys.host + ".kestrel.internal" : sess.sys.host) + "\n"); return 0; };
  CMDS.uname = function (args, io, sess) {
    var a = args.slice(1).join("");
    var f = { s: "Linux", n: sess.sys.host, r: "6.8.0-48-generic", v: "#48-Ubuntu SMP PREEMPT_DYNAMIC Fri Sep 27 14:04:52 UTC 2024", m: "x86_64", p: "x86_64", i: "x86_64", o: "GNU/Linux" };
    if (!a) { out(io, "Linux\n"); return 0; }
    if (/a|--all/.test(a)) { out(io, [f.s, f.n, f.r, f.v, f.m, f.p, f.i, f.o].join(" ") + "\n"); return 0; }
    out(io, "snrvmpio".split("").filter(function (k) { return a.indexOf(k) >= 0; }).map(function (k) { return f[k]; }).join(" ") + "\n");
    return 0;
  };
  CMDS.whoami = function (args, io, sess) { out(io, sess.user + "\n"); return 0; };
  CMDS.logname = function (args, io, sess) { out(io, "dev\n"); return 0; };
  CMDS.id = function (args, io, sess) {
    var p = opts("id", args, { flags: "ugGnr" });
    var name = p.rest[0];
    var u = name ? S.userByName(sess.sys, name) : { name: sess.user, uid: sess.uid, gid: sess.gid };
    if (!u) { errl(io, "id: ‘" + name + "’: no such user"); return 1; }
    var gids = name ? [u.gid].concat(S.supplementary(sess.sys, u.name)) : [sess.gid].concat(sess.groups || []);
    gids = gids.filter(function (g, i) { return gids.indexOf(g) === i; });
    if (p.o.u) { out(io, (p.o.n ? u.name : u.uid) + "\n"); return 0; }
    if (p.o.g) { out(io, (p.o.n ? S.gname(sess.sys, u.gid) : u.gid) + "\n"); return 0; }
    if (p.o.G) { out(io, gids.map(function (g) { return p.o.n ? S.gname(sess.sys, g) : g; }).join(" ") + "\n"); return 0; }
    out(io, "uid=" + u.uid + "(" + u.name + ") gid=" + u.gid + "(" + S.gname(sess.sys, u.gid) + ") groups=" + gids.map(function (g) { return g + "(" + S.gname(sess.sys, g) + ")"; }).join(",") + "\n");
    return 0;
  };
  CMDS.groups = function (args, io, sess) {
    var names = args.slice(1);
    if (!names.length) { var g = [sess.gid].concat(sess.groups || []); out(io, g.filter(function (x, i) { return g.indexOf(x) === i; }).map(function (x) { return S.gname(sess.sys, x); }).join(" ") + "\n"); return 0; }
    var code = 0;
    names.forEach(function (n) { var u = S.userByName(sess.sys, n); if (!u) { errl(io, "groups: ‘" + n + "’: no such user"); code = 1; return; } var g2 = [u.gid].concat(S.supplementary(sess.sys, n)); out(io, n + " : " + g2.filter(function (x, i) { return g2.indexOf(x) === i; }).map(function (x) { return S.gname(sess.sys, x); }).join(" ") + "\n"); });
    return code;
  };
  CMDS.who = function (args, io, sess) { var logins = sess.sys.logins || [["dev", "pts/0", "2026-11-11 08:52", "198.51.100.20"]]; out(io, logins.map(function (l) { return rpad(l[0], 8) + " " + rpad(l[1], 12) + " " + l[2] + " (" + l[3] + ")"; }).join("\n") + "\n"); return 0; };
  CMDS.w = function (args, io, sess) { out(io, " 09:00:00 up 12 days,  3:14,  1 user,  load average: 0.08, 0.12, 0.10\nUSER     TTY      FROM             LOGIN@   IDLE   JCPU   PCPU  WHAT\ndev      pts/0    198.51.100.20    08:52    0.00s  0.04s  0.00s w\n"); return 0; };
  CMDS.uptime = function (args, io) { out(io, args[1] === "-p" ? "up 1 week, 5 days, 3 hours, 14 minutes\n" : " 09:00:00 up 12 days,  3:14,  1 user,  load average: 0.08, 0.12, 0.10\n"); return 0; };
  CMDS.env = function (args, io, sess) {
    var a = args.slice(1);
    if (a.length && !/^[A-Za-z_]\w*=/.test(a[0]) && a[0] !== "-i") { return S.runCommand(sess, a, io); }
    var e = S.exportedEnv(sess);
    out(io, Object.keys(e).map(function (k) { return k + "=" + e[k]; }).join("\n") + "\n");
    return 0;
  };
  CMDS.printenv = function (args, io, sess) {
    var e = S.exportedEnv(sess);
    if (args.length > 1) { var code = 0; args.slice(1).forEach(function (k) { if (e[k] === undefined) code = 1; else out(io, e[k] + "\n"); }); return code; }
    out(io, Object.keys(e).map(function (k) { return k + "=" + e[k]; }).join("\n") + "\n");
    return 0;
  };
  CMDS.which = function (args, io, sess) {
    var all = args[1] === "-a", names = args.slice(all ? 2 : 1), code = 0;
    names.forEach(function (n) {
      var dirs = (S.getVar(sess, "PATH") || "").split(":"), found = false;
      for (var k = 0; k < dirs.length; k++) {
        if (!dirs[k]) continue;
        var r = S.lookup(sess, dirs[k] + "/" + n);
        if (r.node && r.node.type === "f" && S.can(sess, r.node, "x")) { out(io, dirs[k].replace(/\/$/, "") + "/" + n + "\n"); found = true; if (!all) break; }
      }
      if (!found) code = 1;
    });
    return code;
  };
  CMDS.getent = function (args, io, sess) {
    var db = args[1], key = args[2];
    var file = { passwd: "/etc/passwd", group: "/etc/group", hosts: "/etc/hosts", services: "/etc/services" }[db];
    if (!file) { errl(io, "Unknown database: " + db + "\nTry `getent --help' or `getent --usage' for more information."); return 1; }
    var ls = lines(S.readSys(sess.sys, file)).filter(function (l) { return l && l.charAt(0) !== "#"; });
    if (key !== undefined) { ls = ls.filter(function (l) { var f = db === "hosts" ? l.split(/\s+/) : l.split(":"); return db === "hosts" ? f.indexOf(key) >= 0 : f[0] === key || f[2] === key; }); if (!ls.length) return 2; ls = ls.slice(0, 1); }
    out(io, joinLines(ls));
    return 0;
  };
  CMDS.basename = function (args, io) { var a = args.slice(1).filter(function (x) { return x !== "-a"; }); if (!a.length) throw new ShError("basename: missing operand\nTry 'basename --help' for more information.", 1); var b = a[0].replace(/\/+$/, "").split("/").pop() || "/"; if (a[1] && b.slice(-a[1].length) === a[1] && b !== a[1]) b = b.slice(0, -a[1].length); out(io, b + "\n"); return 0; };
  CMDS.dirname = function (args, io) { args.slice(1).forEach(function (p) { var s = p.replace(/\/+$/, ""); var i = s.lastIndexOf("/"); out(io, (i < 0 ? "." : i === 0 ? "/" : s.slice(0, i)) + "\n"); }); return 0; };
  CMDS.realpath = function (args, io, sess) { var code = 0; args.slice(1).filter(function (x) { return x.charAt(0) !== "-"; }).forEach(function (p) { var r = S.lookup(sess, p); if (r.error && r.error !== "ENOENT") { errl(io, "realpath: " + p + ": " + ERR[r.error]); code = 1; return; } out(io, (r.path || S.absPath(sess, p)) + "\n"); }); return code; };
  CMDS.readlink = function (args, io, sess) { var f = args.indexOf("-f") >= 0; var code = 0; args.slice(1).filter(function (x) { return x.charAt(0) !== "-"; }).forEach(function (p) { if (f) { var r = S.lookup(sess, p); out(io, (r.path || S.absPath(sess, p)) + "\n"); return; } var r2 = S.lookup(sess, p, { nofollow: true }); if (!r2.node || r2.node.type !== "l") { code = 1; return; } out(io, r2.node.target + "\n"); }); return code; };
  CMDS.seq = function (args, io) {
    var a = args.slice(1).filter(function (x) { return !/^-[sw]/.test(x); });
    var first = 1, step = 1, last;
    if (a.length === 1) last = +a[0]; else if (a.length === 2) { first = +a[0]; last = +a[1]; } else if (a.length >= 3) { first = +a[0]; step = +a[1]; last = +a[2]; }
    else throw new ShError("seq: missing operand\nTry 'seq --help' for more information.", 1);
    var r = [];
    for (var v = first; step > 0 ? v <= last : v >= last; v += step) { r.push(String(v)); if (r.length > 100000) break; }
    out(io, joinLines(r));
    return 0;
  };
  CMDS.sleep = function () { return 0; };
  CMDS.yes = function (args, io) { var s = (args.slice(1).join(" ") || "y") + "\n"; out(io, new Array(201).join(s)); return 0; };
  CMDS.xargs = function (args, io, sess) {
    var a = args.slice(1), n = 0, rep = null, cmd;
    while (a.length && /^-/.test(a[0])) { var f = a.shift(); if (f === "-n") n = +a.shift(); else if (/^-n\d+$/.test(f)) n = +f.slice(2); else if (f === "-I") rep = a.shift(); else if (f === "-0" || f === "-r" || f === "--no-run-if-empty") continue; }
    cmd = a.length ? a : ["echo"];
    var items = rep ? lines(io.stdin || "") : (io.stdin || "").trim().split(/\s+/).filter(Boolean);
    if (!items.length) return 0;
    var code = 0;
    var io2 = { stdin: null, out: io.out, err: io.err, tty: io.tty };
    if (rep) items.forEach(function (it) { var c = S.runCommand(sess, cmd.map(function (x) { return x.split(rep).join(it); }), io2); if (c) code = 123; });
    else if (n) for (var i = 0; i < items.length; i += n) { if (S.runCommand(sess, cmd.concat(items.slice(i, i + n)), io2)) code = 123; }
    else if (S.runCommand(sess, cmd.concat(items), io2)) code = 123;
    return code;
  };
  CMDS.clear = function (args, io, sess) { var top = sess.sys.topSession || sess; top.cleared = true; top.term.length = 0; return 0; };
  CMDS.reset = CMDS.clear;
  CMDS.history = function (a, io, s) { return B.history(a, io, s); };
  CMDS.bash = function (args, io, sess) {
    var a = args.slice(1);
    if (a[0] === "-c") { var c = S.childSession(sess); c.positional = a.slice(2); try { return S.runSource(c, a[1] || "", io); } catch (e) { if (e instanceof S.ExitSignal) return e.code; throw e; } }
    if (a.length && a[0].charAt(0) !== "-") return S.runScriptFile(sess, a[0], a.slice(1), io, a[0]);
    note(io, "(A new bash shell would start here; type exit to leave it. In this lab, you're already in bash.)");
    return 0;
  };
  CMDS.sh = CMDS.bash;

  /* ---------------- editors and pagers we can't run full-screen */
  function editor(name) {
    var tips = {
      nano: "nano FILE  ·  type to edit  ·  Ctrl+O then Enter = save  ·  Ctrl+X = exit  ·  Ctrl+W = search  ·  Ctrl+K = cut line  ·  Ctrl+U = paste",
      vim: "vim FILE  ·  i = start typing (insert mode)  ·  Esc = stop typing  ·  :w = save  ·  :q = quit  ·  :wq = save and quit  ·  :q! = quit without saving  ·  /word = search  ·  dd = delete line"
    };
    return function (args, io) {
      note(io, "(" + name + " is a full-screen editor, which this lab's terminal can't show. Edit files here with echo/printf and > or >>, sed -i, or tee.)\n(" + (tips[name] || tips.vim) + ")");
      return 0;
    };
  }
  CMDS.nano = editor("nano"); CMDS.vim = editor("vim"); CMDS.vi = editor("vim"); CMDS.view = editor("vim");
  CMDS.top = function (args, io) { note(io, "(top is a live, full-screen view of running processes; q quits. Module 2 covers processes with ps.)"); return 0; };

  /* ---------------- sudo, su, visudo */
  function sudoRules(sys) {
    var text = S.readSys(sys, "/etc/sudoers");
    var dir = S.lookup({ sys: sys, uid: 0, cwd: "/", groups: [] }, "/etc/sudoers.d");
    if (dir.node) Object.keys(dir.node.children).sort().forEach(function (k) { if (!/[~.]/.test(k)) text += "\n" + dir.node.children[k].content; });
    var rules = [];
    lines(text).forEach(function (l) {
      l = l.replace(/#.*$/, "").trim();
      var m = /^(%?[\w.-]+)\s+(\S+)\s*=\s*(?:\(([^)]*)\))?\s*(NOPASSWD:)?\s*(.+)$/.exec(l);
      if (!m || /^Defaults/.test(l)) return;
      rules.push({ who: m[1], host: m[2], runas: m[3] || "root", nopasswd: !!m[4], cmds: m[5].split(/\s*,\s*/) });
    });
    return rules;
  }
  function sudoAllowed(sess, user, cmdPath) {
    var u = S.userByName(sess.sys, user);
    var gnames = S.supplementary(sess.sys, user).concat([u.gid]).map(function (g) { return S.gname(sess.sys, g); });
    var hit = null;
    sudoRules(sess.sys).forEach(function (r) {
      var applies = r.who.charAt(0) === "%" ? gnames.indexOf(r.who.slice(1)) >= 0 : r.who === user;
      if (!applies) return;
      var ok = r.cmds.some(function (c) { return c === "ALL" || cmdPath === null || c.split(/\s+/)[0] === cmdPath; });
      if (ok) { if (!hit || r.nopasswd) hit = r; }
    });
    return hit;
  }
  function logAuth(sess, line) {
    var r = S.lookup({ sys: sess.sys, uid: 0, cwd: "/", groups: [] }, "/var/log/auth.log");
    if (r.node) r.node.content += "2026-11-11T09:00:00.000000+00:00 " + sess.sys.host + " " + line + "\n";
  }
  CMDS.sudo = function (args, io, sess) {
    var a = args.slice(1), asUser = "root", mode = null;
    while (a.length && /^-/.test(a[0])) {
      var f = a.shift();
      if (f === "-u") asUser = a.shift();
      else if (/^-u./.test(f)) asUser = f.slice(2);
      else if (f === "-i" || f === "-s") mode = f;
      else if (f === "-l" || f === "-ll") mode = "-l";
      else if (f === "-k" || f === "-K") return 0;
      else if (f === "-v") return 0;
      else if (f === "-E" || f === "-H" || f === "-n") continue;
      else if (f === "--") break;
      else if (f === "-h" || f === "--help") { out(io, "usage: sudo -h | -K | -k | -V\nusage: sudo -v [-ABkNnS] [-g group] [-h host] [-p prompt] [-u user]\nusage: sudo -l [-ABkNnS] [-g group] [-h host] [-p prompt] [-U user] [-u user] [command [arg ...]]\nusage: sudo [-ABbEHkNnPS] [-C num] [-D directory] [-g group] [-h host] [-p prompt] [-R directory] [-T timeout] [-u user] [VAR=value] [-i | -s] [command [arg ...]]\n"); return 0; }
      else { errl(io, "sudo: invalid option -- '" + f.replace(/^-+/, "") + "'"); return 1; }
    }
    if (sess.uid !== 0) {
      var rule = sudoAllowed(sess, sess.user, null);
      if (!rule) {
        errl(io, "[sudo] password for " + sess.user + ": ");
        errl(io, sess.user + " is not in the sudoers file.");
        logAuth(sess, "sudo: " + sess.user + " : user NOT in sudoers ; TTY=pts/0 ; PWD=" + sess.cwd + " ; USER=root ; COMMAND=" + a.join(" "));
        return 1;
      }
      if (!rule.nopasswd) note(io, "[sudo] password for " + sess.user + ": (typed; the lab fills it in)");
    }
    if (mode === "-l") {
      out(io, "Matching Defaults entries for " + sess.user + " on " + sess.sys.host + ":\n    env_reset, mail_badpass, secure_path=/usr/local/sbin\\:/usr/local/bin\\:/usr/sbin\\:/usr/bin\\:/sbin\\:/bin\\:/snap/bin, use_pty\n\nUser " + sess.user + " may run the following commands on " + sess.sys.host + ":\n");
      var u = S.userByName(sess.sys, sess.user);
      var gn = S.supplementary(sess.sys, sess.user).concat([u.gid]).map(function (g) { return S.gname(sess.sys, g); });
      sudoRules(sess.sys).forEach(function (r) { var ap = r.who.charAt(0) === "%" ? gn.indexOf(r.who.slice(1)) >= 0 : r.who === sess.user; if (ap) out(io, "    (" + r.runas + ") " + (r.nopasswd ? "NOPASSWD: " : "") + r.cmds.join(", ") + "\n"); });
      return 0;
    }
    var target = S.userByName(sess.sys, asUser);
    if (!target) { errl(io, "sudo: unknown user " + asUser); return 1; }
    if (mode === "-i" || mode === "-s" || (!a.length && mode)) {
      var shell = S.newSession(sess.sys, { user: asUser });
      if (mode === "-s") shell.cwd = sess.cwd; else S.login(shell);
      (sess.sys.topSession || sess).userStack.push({ shell: shell });
      logAuth(sess, "sudo:      " + sess.user + " : TTY=pts/0 ; PWD=" + sess.cwd + " ; USER=" + asUser + " ; COMMAND=/bin/bash");
      if (mode === "-i") note(io, "(You're now in a shell as " + asUser + ". Type exit to go back to " + sess.user + ".)");
      return 0;
    }
    if (!a.length) { out(io, "usage: sudo -h | -K | -k | -V\n"); return 1; }
    if (B[a[0]] && ["echo", "printf", "test", "[", "true", "false", "pwd", "kill"].indexOf(a[0]) < 0) { errl(io, "sudo: " + a[0] + ": command not found"); return 1; }
    var saved = { uid: sess.uid, gid: sess.gid, user: sess.user, groups: sess.groups, home: sess.home };
    var t = S.userByName(sess.sys, asUser);
    var found = S.resolveCommand(Object.assign({}, sess, { uid: 0, vars: Object.assign({}, sess.vars, { PATH: { v: "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/snap/bin", x: true } }) }), a[0]);
    if (found.error) { errl(io, "sudo: " + a[0] + ": command not found"); return 1; }
    logAuth(sess, "sudo:      " + sess.user + " : TTY=pts/0 ; PWD=" + sess.cwd + " ; USER=" + asUser + " ; COMMAND=" + found.path + (a.length > 1 ? " " + a.slice(1).join(" ") : ""));
    sess.sys.actions.push("sudo " + a.join(" "));
    sess.uid = t.uid; sess.gid = t.gid; sess.user = t.name; sess.groups = S.supplementary(sess.sys, t.name);
    try { return S.execFound(sess, found, a, io); }
    finally { sess.uid = saved.uid; sess.gid = saved.gid; sess.user = saved.user; sess.groups = saved.groups; sess.home = saved.home; }
  };
  CMDS.su = function (args, io, sess) {
    var a = args.slice(1).filter(function (x) { return x !== "-" && x !== "-l" && x !== "--login"; });
    var user = a[0] || "root";
    if (!S.userByName(sess.sys, user)) { errl(io, "su: user " + user + " does not exist or the user entry does not contain all the required fields"); return 1; }
    if (sess.uid === 0) {
      var shell = S.newSession(sess.sys, { user: user });
      (sess.sys.topSession || sess).userStack.push({ shell: shell });
      return 0;
    }
    errl(io, "Password: ");
    errl(io, "su: Authentication failure");
    note(io, "(On Ubuntu the root account has no password, so su to root always fails. Use sudo -i for a root shell, or sudo <command> for one command.)");
    logAuth(sess, "su: pam_unix(su:auth): authentication failure; logname=" + sess.user + " uid=" + sess.uid + " euid=0 tty=/dev/pts/0 ruser=" + sess.user + " rhost=  user=" + user);
    return 1;
  };
  CMDS.visudo = function (args, io, sess) {
    if (sess.uid !== 0) { errl(io, "visudo: /etc/sudoers: Permission denied"); return 1; }
    if (args.indexOf("-c") >= 0) { out(io, "/etc/sudoers: parsed OK\n/etc/sudoers.d/90-cloud-init-users: parsed OK\n"); return 0; }
    note(io, "(visudo opens /etc/sudoers in an editor and refuses to save a file with mistakes, so a typo can't lock everyone out of sudo. This lab can't show full-screen editors; here's what's in it:)");
    return CMDS.cat(["cat", "/etc/sudoers"], io, sess);
  };

  /* ---------------- man pages */
  var MAN = {
    ls: { syn: "ls [OPTION]... [FILE]...", desc: "List information about the FILEs (the current directory by default). Entries are sorted alphabetically.", opts: [["-a, --all", "do not ignore entries starting with ."], ["-A, --almost-all", "like -a, but without . and .."], ["-l", "use a long listing format"], ["-h, --human-readable", "with -l, print sizes like 1K 234M 2G"], ["-t", "sort by time, newest first"], ["-S", "sort by file size, largest first"], ["-r, --reverse", "reverse order while sorting"], ["-R, --recursive", "list subdirectories recursively"], ["-d, --directory", "list directories themselves, not their contents"], ["-F, --classify", "append indicator (one of */=>@|) to entries"], ["-1", "list one file per line"]] },
    cd: { syn: "cd [-L|[-P [-e]] [-@]] [dir]", desc: "Change the shell working directory. With no DIR, go to $HOME. 'cd -' goes back to the previous directory. '..' is the parent directory, '.' the current one, '~' your home.", opts: [] },
    pwd: { syn: "pwd [-LP]", desc: "Print the full name of the current working directory.", opts: [["-P", "print the physical directory, without any symbolic links"]] },
    cat: { syn: "cat [OPTION]... [FILE]...", desc: "Concatenate FILE(s) to standard output. With no FILE, or when FILE is -, read standard input.", opts: [["-n, --number", "number all output lines"], ["-b", "number nonempty output lines"], ["-A, --show-all", "show tabs as ^I and line ends as $"], ["-s", "suppress repeated empty output lines"]] },
    less: { syn: "less [options] file...", desc: "A pager: shows a file one screen at a time. Space = next page, b = back, /pattern = search, n = next match, G = end, g = start, q = quit.", opts: [["-N", "show line numbers"], ["+F", "follow the file as it grows (like tail -f)"]] },
    head: { syn: "head [OPTION]... [FILE]...", desc: "Print the first 10 lines of each FILE to standard output.", opts: [["-n, --lines=[-]NUM", "print the first NUM lines; with -NUM, all but the last NUM lines"], ["-c, --bytes=NUM", "print the first NUM bytes"]] },
    tail: { syn: "tail [OPTION]... [FILE]...", desc: "Print the last 10 lines of each FILE to standard output.", opts: [["-n, --lines=[+]NUM", "output the last NUM lines; with +NUM, start at line NUM"], ["-f, --follow", "output appended data as the file grows"], ["-c, --bytes=NUM", "output the last NUM bytes"]] },
    wc: { syn: "wc [OPTION]... [FILE]...", desc: "Print newline, word, and byte counts for each FILE, and a total line if more than one FILE is specified.", opts: [["-l, --lines", "print the newline counts"], ["-w, --words", "print the word counts"], ["-c, --bytes", "print the byte counts"], ["-m, --chars", "print the character counts"]] },
    grep: { syn: "grep [OPTION...] PATTERNS [FILE...]", desc: "Search for PATTERNS in each FILE and print matching lines. PATTERNS are basic regular expressions unless -E or -F.", opts: [["-i, --ignore-case", "ignore case distinctions"], ["-v, --invert-match", "select non-matching lines"], ["-n, --line-number", "print line number with output lines"], ["-c, --count", "print only a count of matching lines per FILE"], ["-r, --recursive", "search directories recursively"], ["-l, --files-with-matches", "print only names of FILEs with matches"], ["-w, --word-regexp", "match only whole words"], ["-x, --line-regexp", "match only whole lines"], ["-o, --only-matching", "show only the matching part of lines"], ["-E, --extended-regexp", "PATTERNS are extended regular expressions"], ["-F, --fixed-strings", "PATTERNS are plain strings"], ["-A NUM / -B NUM / -C NUM", "print NUM lines of context after / before / around"], ["--include=GLOB", "search only files that match GLOB"]] },
    find: { syn: "find [path...] [expression]", desc: "Search for files in a directory hierarchy. Tests are combined with AND unless you use -o (OR); ! negates.", opts: [["-name PATTERN", "base name matches the shell pattern (quote it: '*.log')"], ["-iname PATTERN", "like -name, ignoring case"], ["-type f|d|l", "file, directory or symbolic link"], ["-mtime N", "modified N*24 hours ago (+N = more than, -N = less than)"], ["-mmin N", "modified N minutes ago"], ["-size N[ckMG]", "size is N units (+N bigger, -N smaller)"], ["-user NAME / -group NAME", "owned by user / group"], ["-perm MODE", "exact mode; -MODE = all of these bits; /MODE = any of them"], ["-empty", "empty file or directory"], ["-maxdepth N", "descend at most N levels"], ["-exec CMD {} \\;", "run CMD on each file ({} is the file)"], ["-delete", "delete the matching files"]] },
    sort: { syn: "sort [OPTION]... [FILE]...", desc: "Write sorted concatenation of all FILE(s) to standard output.", opts: [["-n, --numeric-sort", "compare according to string numerical value"], ["-r, --reverse", "reverse the result of comparisons"], ["-u, --unique", "output only the first of equal lines"], ["-k, --key=POS1[,POS2]", "sort by field POS1 (to POS2)"], ["-t, --field-separator=SEP", "use SEP instead of blanks between fields"], ["-h", "compare human readable numbers (2K, 1G)"], ["-f", "ignore case"]] },
    uniq: { syn: "uniq [OPTION]... [INPUT [OUTPUT]]", desc: "Filter adjacent matching lines from INPUT. Lines must be sorted first (sort | uniq) for duplicates far apart.", opts: [["-c, --count", "prefix lines by the number of occurrences"], ["-d, --repeated", "only print duplicate lines, one for each group"], ["-u, --unique", "only print unique lines"], ["-i", "ignore differences in case"]] },
    cut: { syn: "cut OPTION... [FILE]...", desc: "Print selected parts of lines from each FILE.", opts: [["-d, --delimiter=DELIM", "use DELIM instead of TAB for field delimiter"], ["-f, --fields=LIST", "select only these fields, e.g. 1,3 or 2-4 or 3-"], ["-c, --characters=LIST", "select only these characters"]] },
    tr: { syn: "tr [OPTION]... STRING1 [STRING2]", desc: "Translate, squeeze, and/or delete characters from standard input, writing to standard output.", opts: [["-d, --delete", "delete characters in STRING1"], ["-s, --squeeze-repeats", "replace each run of a repeated character with one"], ["-c", "use the complement of STRING1"], ["a-z, [:upper:], [:digit:]", "ranges and character classes"]] },
    sed: { syn: "sed [OPTION]... {script} [input-file]...", desc: "A stream editor: filters and transforms text. The most used command is s/old/new/ (substitute; add g for every match on a line).", opts: [["-n, --quiet", "don't print every line; only what p prints"], ["-i[SUFFIX], --in-place", "edit files in place (makes a backup if SUFFIX given)"], ["-E, -r", "use extended regular expressions"], ["s/RE/TEXT/g", "replace every match of RE with TEXT"], ["/RE/d", "delete lines matching RE"], ["N,Mp", "print lines N to M (with -n)"]] },
    awk: { syn: "awk [-F fs] [-v var=value] 'program' [file ...]", desc: "Pattern scanning and processing language. A program is pattern { action } rules run on every line. $1, $2... are the fields (split on blanks, or on -F); $0 is the whole line; NR is the line number; NF the number of fields.", opts: [["-F fs", "use fs as the field separator, e.g. -F: or -F,"], ["'{print $1}'", "print the first field of every line"], ["'$9 == 404'", "print lines whose 9th field is 404"], ["'{n++} END {print n}'", "count, then print at the end"], ["'{c[$1]++} END {for (k in c) print c[k], k}'", "count by first field"]] },
    tee: { syn: "tee [OPTION]... [FILE]...", desc: "Copy standard input to each FILE, and also to standard output.", opts: [["-a, --append", "append to the given FILEs, do not overwrite"]] },
    touch: { syn: "touch [OPTION]... FILE...", desc: "Update the modification time of each FILE to now. A FILE that does not exist is created empty.", opts: [["-c", "do not create any files"], ["-d, --date=STRING", "use STRING instead of the current time"]] },
    mkdir: { syn: "mkdir [OPTION]... DIRECTORY...", desc: "Create the DIRECTORY(ies), if they do not already exist.", opts: [["-p, --parents", "no error if existing, make parent directories as needed"], ["-m, --mode=MODE", "set file mode (as in chmod)"], ["-v", "print a message for each created directory"]] },
    rmdir: { syn: "rmdir [OPTION]... DIRECTORY...", desc: "Remove the DIRECTORY(ies), if they are empty.", opts: [] },
    rm: { syn: "rm [OPTION]... [FILE]...", desc: "Remove (unlink) the FILE(s). There is no recycle bin: removed files are gone.", opts: [["-r, -R, --recursive", "remove directories and their contents recursively"], ["-f, --force", "ignore nonexistent files and arguments, never prompt"], ["-i", "prompt before every removal"], ["-v, --verbose", "explain what is being done"]] },
    cp: { syn: "cp [OPTION]... SOURCE... DEST", desc: "Copy SOURCE to DEST, or multiple SOURCE(s) to DIRECTORY.", opts: [["-r, -R, --recursive", "copy directories recursively"], ["-a, --archive", "copy everything, keeping modes, owners and times"], ["-p", "preserve mode, ownership, timestamps"], ["-i", "prompt before overwrite"], ["-n", "do not overwrite an existing file"], ["-v", "explain what is being done"]] },
    mv: { syn: "mv [OPTION]... SOURCE... DEST", desc: "Rename SOURCE to DEST, or move SOURCE(s) to DIRECTORY.", opts: [["-i", "prompt before overwrite"], ["-n", "do not overwrite an existing file"], ["-v", "explain what is being done"]] },
    ln: { syn: "ln [OPTION]... TARGET LINK_NAME", desc: "Make links between files. With -s, LINK_NAME becomes a symbolic link pointing to TARGET.", opts: [["-s, --symbolic", "make symbolic links instead of hard links"], ["-f, --force", "remove existing destination files"]] },
    chmod: { syn: "chmod [OPTION]... MODE[,MODE]... FILE...", desc: "Change the mode (permissions) of each FILE. MODE is octal (e.g. 640) or symbolic: [ugoa][+-=][rwx], e.g. u+x, g-w, o=, a+r.", opts: [["-R, --recursive", "change files and directories recursively"], ["-v", "output a diagnostic for every file processed"], ["u/g/o/a", "user (owner), group, others, all"], ["r=4 w=2 x=1", "so 7=rwx 6=rw- 5=r-x 4=r-- 0=---"]] },
    chown: { syn: "chown [OPTION]... [OWNER][:[GROUP]] FILE...", desc: "Change the owner and/or group of each FILE. Only root can give files away (use sudo).", opts: [["-R, --recursive", "operate on files and directories recursively"], ["OWNER:GROUP", "set both, e.g. ana:www-data"], [":GROUP", "change only the group"]] },
    chgrp: { syn: "chgrp [OPTION]... GROUP FILE...", desc: "Change the group of each FILE to GROUP. You can choose any group you belong to.", opts: [["-R", "operate recursively"]] },
    umask: { syn: "umask [-p] [-S] [mode]", desc: "Display or set the file mode creation mask: bits removed from the permissions of new files and folders. 0002 makes new files rw-rw-r-- and folders rwxrwxr-x.", opts: [["-S", "show the mask in symbolic form"]] },
    stat: { syn: "stat [OPTION]... FILE...", desc: "Display file or file system status: size, permissions, owner, times.", opts: [["-c FORMAT", "use FORMAT, e.g. '%a %U %G %n' (octal mode, owner, group, name)"]] },
    file: { syn: "file [OPTION...] FILE...", desc: "Determine the type of each FILE by looking at its contents, not its name.", opts: [] },
    du: { syn: "du [OPTION]... [FILE]...", desc: "Summarize device usage of the set of FILEs, recursively for directories.", opts: [["-s", "display only a total for each argument"], ["-h", "print sizes in human readable format (e.g., 1K 234M 2G)"], ["-a", "write counts for all files, not just directories"], ["--max-depth=N", "print totals only N levels deep"]] },
    df: { syn: "df [OPTION]... [FILE]...", desc: "Show information about the file systems: size, used, available, mount point.", opts: [["-h", "print sizes in powers of 1024 (e.g., 1023M)"]] },
    whoami: { syn: "whoami", desc: "Print the user name associated with the current effective user ID.", opts: [] },
    id: { syn: "id [OPTION]... [USER]...", desc: "Print user and group information for each USER, or for the current user.", opts: [["-u", "print only the user ID"], ["-g", "print only the group ID"], ["-G", "print all group IDs"], ["-n", "print names instead of numbers (with -u, -g, -G)"]] },
    groups: { syn: "groups [USER]...", desc: "Print the groups a user is in.", opts: [] },
    sudo: { syn: "sudo [-u user] [-i | -s] [command [arg ...]]", desc: "Execute a command as another user (root by default), as allowed by /etc/sudoers. Every use is logged to /var/log/auth.log.", opts: [["-l", "list what you're allowed to run"], ["-u USER", "run as USER instead of root"], ["-i", "start a login shell as the target user (exit to leave)"], ["-k", "forget the cached password"]] },
    su: { syn: "su [options] [-] [user]", desc: "Run a shell as another user (root by default). Needs that user's password. On Ubuntu root has no password: use sudo -i.", opts: [] },
    visudo: { syn: "visudo [-c] [-f sudoers]", desc: "Edit the sudoers file safely: it locks the file and checks the syntax before saving.", opts: [["-c", "check the syntax only"]] },
    echo: { syn: "echo [-neE] [arg ...]", desc: "Display the ARGs, separated by a single space character and followed by a newline.", opts: [["-n", "do not append a newline"], ["-e", "interpret backslash escapes like \\n and \\t"]] },
    printf: { syn: "printf FORMAT [ARGUMENT]...", desc: "Print ARGUMENT(s) according to FORMAT: %s text, %d integer, %5.2f number, \\n newline.", opts: [] },
    export: { syn: "export [-fn] [name[=value] ...]", desc: "Mark variables to be passed to programs started from this shell (environment variables).", opts: [["-n", "remove the export property"], ["-p", "list all exported variables"]] },
    alias: { syn: "alias [-p] [name[=value] ... ]", desc: "Define or display aliases: a shortcut name that's replaced by a longer command. Without arguments, lists all aliases.", opts: [] },
    source: { syn: "source filename [arguments]", desc: "Read and execute commands from FILENAME in the current shell (also written as . filename). Used to reload ~/.bashrc after editing it.", opts: [] },
    which: { syn: "which [-a] filename ...", desc: "Locate a command: print the path of the program that would run, searching the folders in $PATH in order.", opts: [["-a", "print all matches, not just the first"]] },
    type: { syn: "type [-afptP] name [name ...]", desc: "Display how a name would be interpreted: alias, keyword, function, builtin or file.", opts: [] },
    env: { syn: "env [NAME=VALUE]... [COMMAND [ARG]...]", desc: "Print the environment, or run a command in a modified environment.", opts: [] },
    printenv: { syn: "printenv [VARIABLE]...", desc: "Print the values of the specified environment VARIABLE(s), or all of them.", opts: [] },
    history: { syn: "history [n]", desc: "Display the command history list with line numbers. !N re-runs command N; Ctrl+R searches.", opts: [["-c", "clear the history list"]] },
    man: { syn: "man [section] page", desc: "An interface to the system reference manuals. In a real terminal it opens in a pager: Space to scroll, /word to search, q to quit.", opts: [["-k KEYWORD", "search the manual page names and descriptions (same as apropos)"]] },
    date: { syn: "date [OPTION]... [+FORMAT]", desc: "Display the current time in the given FORMAT.", opts: [["+%F", "full date, e.g. 2026-11-11"], ["+%T", "time, e.g. 09:00:00"], ["+%Y-%m-%d_%H%M", "build a timestamp for file names"], ["-d STRING", "display time described by STRING, e.g. '7 days ago'"]] },
    nano: { syn: "nano [OPTIONS] [[+LINE[,COLUMN]] FILE]...", desc: "A small, friendly text editor. The shortcuts are shown at the bottom (^ means Ctrl). Ctrl+O saves, Ctrl+X exits, Ctrl+W searches.", opts: [] },
    vim: { syn: "vim [options] [file ..]", desc: "Vi IMproved, a programmer's text editor with modes. Press i to insert text, Esc to go back to normal mode, :wq to save and quit, :q! to quit without saving.", opts: [] },
    xargs: { syn: "xargs [OPTION]... COMMAND [INITIAL-ARGS]...", desc: "Build and execute command lines from standard input: each word read becomes an argument to COMMAND.", opts: [["-n MAX", "use at most MAX arguments per command line"], ["-I R", "replace R in INITIAL-ARGS with each input line"]] },
    hostname: { syn: "hostname [-I] [-f]", desc: "Show the system's host name.", opts: [["-I", "show all IP addresses"], ["-f", "show the fully qualified name"]] },
    uname: { syn: "uname [OPTION]...", desc: "Print certain system information.", opts: [["-a", "print all information"], ["-r", "print the kernel release"]] },
    getent: { syn: "getent database [key ...]", desc: "Get entries from administrative databases: passwd, group, hosts.", opts: [] }
  };
  S.MAN = MAN;
  CMDS.man = function (args, io) {
    var a = args.slice(1).filter(function (x) { return !/^\d$/.test(x); });
    if (!a.length) { out(io, "What manual page do you want?\nFor example, try 'man man'.\n"); return 1; }
    if (a[0] === "-k") { var kw = (a[1] || "").toLowerCase(); var hits = Object.keys(MAN).filter(function (k) { return k.indexOf(kw) >= 0 || MAN[k].desc.toLowerCase().indexOf(kw) >= 0; }).sort(); if (!hits.length) { out(io, kw + ": nothing appropriate.\n"); return 16; } out(io, hits.map(function (k) { return rpad(k + " (1)", 20) + " - " + MAN[k].desc.split(". ")[0].replace(/\.$/, ""); }).join("\n") + "\n"); return 0; }
    var code = 0;
    a.forEach(function (name) {
      var m = MAN[name];
      if (!m) { errl(io, "No manual entry for " + name); code = 16; return; }
      out(io, name.toUpperCase() + "(1)                      User Commands                     " + name.toUpperCase() + "(1)\n\nNAME\n       " + name + " - " + m.desc.split(". ")[0].replace(/\.$/, "") + "\n\nSYNOPSIS\n       " + m.syn + "\n\nDESCRIPTION\n       " + m.desc + "\n" +
        (m.opts && m.opts.length ? "\n" + m.opts.map(function (o) { return "       " + o[0] + "\n              " + o[1]; }).join("\n\n") + "\n" : ""));
    });
    if (io.tty && !code) note(io, "(In a real terminal man opens a pager: Space scrolls, /word searches, q quits.)");
    return code;
  };
  CMDS.apropos = function (args, io, s) { return CMDS.man(["man", "-k"].concat(args.slice(1)), io, s); };
  CMDS.whatis = function (args, io) { args.slice(1).forEach(function (n) { if (MAN[n]) out(io, rpad(n + " (1)", 20) + " - " + MAN[n].desc.split(". ")[0] + "\n"); else out(io, n + ": nothing appropriate.\n"); }); return 0; };
  ["ls", "cat", "head", "tail", "wc", "grep", "find", "sort", "uniq", "cut", "tr", "sed", "touch", "mkdir", "rm", "cp", "mv", "chmod", "chown", "du"].forEach(function (k) {
    var impl = CMDS[k];
    CMDS[k] = function (args, io, sess) { if (args.indexOf("--help") > 0 && k !== "find") return help(io, k); return impl(args, io, sess); };
  });

  /* ================================================================== The base system of kc-web-01 */
  var BINS = Object.keys(CMDS);
  var SUID = ["sudo", "su", "passwd", "mount", "umount", "chsh", "chfn", "newgrp", "gpasswd", "pkexec", "fusermount3"];
  var PASSWD = [
    "root:x:0:0:root:/root:/bin/bash", "daemon:x:1:1:daemon:/usr/sbin:/usr/sbin/nologin", "bin:x:2:2:bin:/bin:/usr/sbin/nologin", "sys:x:3:3:sys:/dev:/usr/sbin/nologin",
    "sync:x:4:65534:sync:/bin:/bin/sync", "man:x:6:12:man:/var/cache/man:/usr/sbin/nologin", "mail:x:8:8:mail:/var/mail:/usr/sbin/nologin", "www-data:x:33:33:www-data:/var/www:/usr/sbin/nologin",
    "nobody:x:65534:65534:nobody:/nonexistent:/usr/sbin/nologin", "systemd-network:x:998:998:systemd Network Management:/:/usr/sbin/nologin", "syslog:x:104:111::/nonexistent:/usr/sbin/nologin",
    "sshd:x:106:65534::/run/sshd:/usr/sbin/nologin", "dev:x:1000:1000:Dev Patel,,,:/home/dev:/bin/bash", "ana:x:1001:1001:Ana Silva,,,:/home/ana:/bin/bash",
    "ben:x:1002:1002:Ben Okoro,,,:/home/ben:/bin/bash", "deploy:x:1003:1003:CI deploy user,,,:/home/deploy:/bin/bash"
  ];
  var GROUP = ["root:x:0:", "daemon:x:1:", "bin:x:2:", "sys:x:3:", "adm:x:4:syslog,dev", "tty:x:5:", "disk:x:6:", "mail:x:8:", "man:x:12:", "cdrom:x:24:dev", "sudo:x:27:dev", "dip:x:30:dev",
    "www-data:x:33:ana", "shadow:x:42:", "plugdev:x:46:dev", "staff:x:50:", "syslog:x:111:", "systemd-network:x:998:", "nogroup:x:65534:", "dev:x:1000:", "ana:x:1001:", "ben:x:1002:", "deploy:x:1003:",
    "developers:x:1010:dev,ana,ben"];
  var SHADOW = ["root:*:20031:0:99999:7:::", "daemon:*:20031:0:99999:7:::", "www-data:*:20031:0:99999:7:::", "nobody:*:20031:0:99999:7:::", "syslog:!:20031::::::", "sshd:!:20031::::::",
    "dev:$y$j9T$Kq3n1oXcVt8pE5m2/1Wf0.$zQ8r0nV1f3UyH2LkqP6mWbXt9aR4cD7eF0gS5hJ8kL1:20389:0:99999:7:::", "ana:$y$j9T$a1B2c3D4e5F6g7H8i9J0k/$mN1oP2qR3sT4uV5wX6yZ7aB8cD9eF0gH1iJ2kL3mN4:20390:0:99999:7:::",
    "ben:$y$j9T$Zx9Yw8Vu7Ts6Rq5Po4Nm3/$Lk2Jh1Gf0Ed9Cb8Az7Yx6Wv5Ut4Sr3Qp2On1Ml0Kj9:20391:0:99999:7:::", "deploy:!:20392:0:99999:7:::"];
  var BASHRC = [
    "# ~/.bashrc: executed by bash(1) for non-login shells.",
    "# If not running interactively, don't do anything",
    "case $- in",
    "    *i*) ;;",
    "      *) return;;",
    "esac",
    "HISTCONTROL=ignoreboth",
    "HISTSIZE=1000",
    "HISTFILESIZE=2000",
    "# some more ls aliases",
    "alias ll='ls -alF'",
    "alias la='ls -A'",
    "alias l='ls -CF'",
    "alias grep='grep --color=auto'",
    ""].join("\n");
  function accessLog(seed, n) {
    var rnd = (function (s) { return function () { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; }; })(seed || 42);
    var ips = ["198.51.100.20", "198.51.100.20", "10.20.0.8", "192.0.2.44", "192.0.2.44", "192.0.2.44", "203.0.113.7", "198.51.100.73", "192.0.2.10", "10.20.0.8"];
    var paths = [["/", 200], ["/index.html", 200], ["/api/orders", 200], ["/api/orders/7731", 200], ["/assets/app.css", 200], ["/assets/app.js", 200], ["/login", 200], ["/api/health", 200], ["/favicon.ico", 404], ["/api/orders/9999", 404], ["/api/payments", 500], ["/robots.txt", 200]];
    var agents = ["Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36", "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6) AppleWebKit/605.1.15 Safari/605.1.15", "curl/8.5.0", "kestrel-monitor/2.1"];
    var out = [], t = Date.UTC(2026, 10, 11, 0, 0, 0);
    for (var i = 0; i < n; i++) {
      t += Math.floor(rnd() * 200000);
      var ip = ips[Math.floor(rnd() * ips.length)], p = paths[Math.floor(rnd() * paths.length)], ag = ip === "10.20.0.8" ? agents[3] : agents[Math.floor(rnd() * 3)];
      out.push(logLine(ip, t, "GET", p[0], p[1], p[1] === 200 ? 512 + Math.floor(rnd() * 9000) : 162, ag));
    }
    return out;
  }
  function logLine(ip, t, method, path, status, size, agent) {
    var d = new Date(t);
    var ts = pad(d.getUTCDate(), 2, "0") + "/" + MON[d.getUTCMonth()] + "/" + d.getUTCFullYear() + ":" + pad(d.getUTCHours(), 2, "0") + ":" + pad(d.getUTCMinutes(), 2, "0") + ":" + pad(d.getUTCSeconds(), 2, "0") + " +0000";
    return ip + " - - [" + ts + "] \"" + method + " " + path + " HTTP/1.1\" " + status + " " + size + " \"-\" \"" + agent + "\"";
  }
  S.gen = { accessLog: accessLog, logLine: logLine, pad: pad, MON: MON };
  S.SYS_HOOKS.push(function (sys) {
    var put = function (p, c, mode, uid, gid, mt) { return S.put(sys, p, c, mode, uid, gid, mt); };
    var mk = function (p, mode, uid, gid) { var d = S.mkdirs(sys, p); d.mode = mode == null ? 493 : mode; d.uid = uid || 0; d.gid = gid || 0; return d; };
    mk("/usr/bin"); mk("/usr/sbin"); mk("/usr/local/bin"); mk("/usr/local/sbin"); mk("/usr/lib"); mk("/usr/share/doc");
    BINS.forEach(function (b) { put("/usr/bin/" + b, "\x7fELF:" + b + " (simulated binary)\n", SUID.indexOf(b) >= 0 ? 2541 : 493, 0, 0, Date.UTC(2024, 3, 8)); });
    ["passwd", "chsh", "chfn", "newgrp", "gpasswd", "pkexec", "mount", "umount"].forEach(function (b) { put("/usr/bin/" + b, "\x7fELF:" + b + " (simulated binary)\n", 2541, 0, 0, Date.UTC(2024, 3, 8)); });
    put("/usr/sbin/visudo", "\x7fELF:visudo (simulated binary)\n", 493, 0, 0, Date.UTC(2024, 3, 8));
    delete sys.root.children.usr.children.bin.children.visudo;
    ["nginx", "sshd", "useradd", "usermod"].forEach(function (b) { put("/usr/sbin/" + b, "\x7fELF:" + b + " (simulated binary)\n", 493, 0, 0, Date.UTC(2024, 3, 8)); });
    sys.root.children.bin = S.linkNode("usr/bin"); sys.root.children.sbin = S.linkNode("usr/sbin"); sys.root.children.lib = S.linkNode("usr/lib");
    mk("/boot"); mk("/mnt"); mk("/media"); mk("/opt"); mk("/srv"); mk("/run"); mk("/proc", 365); mk("/sys", 365); mk("/snap");
    mk("/tmp", 1023); mk("/var/tmp", 1023);
    var devd = mk("/dev"); devd.children["null"] = { type: "f", special: "null", mode: 438, uid: 0, gid: 0, mtime: NOW, content: "" };
    // /etc
    put("/etc/passwd", PASSWD.join("\n") + "\n", 420);
    put("/etc/group", GROUP.join("\n") + "\n", 420);
    put("/etc/shadow", SHADOW.join("\n") + "\n", 416, 0, 42);
    put("/etc/hostname", "kc-web-01\n");
    put("/etc/hosts", "127.0.0.1 localhost\n127.0.1.1 kc-web-01\n10.20.0.15 kc-web-01.kestrel.internal kc-web-01\n10.20.0.21 kc-db-01.kestrel.internal kc-db-01\n\n# The following lines are desirable for IPv6 capable hosts\n::1     ip6-localhost ip6-loopback\n");
    put("/etc/os-release", "PRETTY_NAME=\"Ubuntu 24.04.1 LTS\"\nNAME=\"Ubuntu\"\nVERSION_ID=\"24.04\"\nVERSION=\"24.04.1 LTS (Noble Numbat)\"\nVERSION_CODENAME=noble\nID=ubuntu\nID_LIKE=debian\nHOME_URL=\"https://www.ubuntu.com/\"\n");
    put("/etc/issue", "Ubuntu 24.04.1 LTS \\n \\l\n\n");
    put("/etc/timezone", "Etc/UTC\n");
    put("/etc/shells", "# /etc/shells: valid login shells\n/bin/sh\n/usr/bin/sh\n/bin/bash\n/usr/bin/bash\n");
    put("/etc/environment", "PATH=\"/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/usr/games:/usr/local/games:/snap/bin\"\n");
    put("/etc/profile", "# /etc/profile: system-wide .profile file for the Bourne shell (sh(1))\nif [ -d /etc/profile.d ]; then\n  for i in /etc/profile.d/*.sh; do\n    if [ -r $i ]; then\n      . $i\n    fi\n  done\n  unset i\nfi\n");
    put("/etc/bash.bashrc", "# System-wide .bashrc file for interactive bash(1) shells.\n[ -z \"$PS1\" ] && return\nshopt -s checkwinsize\n");
    put("/etc/sudoers", "#\n# This file MUST be edited with the 'visudo' command as root.\n#\nDefaults\tenv_reset\nDefaults\tmail_badpass\nDefaults\tsecure_path=\"/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/snap/bin\"\nDefaults\tuse_pty\n\n# User privilege specification\nroot\tALL=(ALL:ALL) ALL\n\n# Members of the admin group may gain root privileges\n%admin ALL=(ALL) ALL\n\n# Allow members of group sudo to execute any command\n%sudo\tALL=(ALL:ALL) ALL\n\n# See sudoers(5) for more information on \"@include\" directives:\n\n@includedir /etc/sudoers.d\n", 288);
    mk("/etc/sudoers.d", 493);
    put("/etc/sudoers.d/README", "#\n# Files in this directory are read by sudo after /etc/sudoers.\n# Use visudo -f /etc/sudoers.d/NAME to edit them safely.\n#\n", 288);
    put("/etc/sudoers.d/90-cloud-init-users", "# Created by cloud-init v. 24.1.3 on Mon, 02 Nov 2026 10:12:44 +0000\n\n# User rules for dev\ndev ALL=(ALL) NOPASSWD:ALL\n", 288);
    put("/etc/sudoers.d/deploy", "# CI deploys restart the app, nothing else\ndeploy ALL=(root) NOPASSWD: /usr/bin/systemctl restart kestrel-app\n", 288);
    put("/etc/crontab", "# /etc/crontab: system-wide crontab\nSHELL=/bin/sh\nPATH=/usr/local/sbin:/usr/local/bin:/sbin:/bin:/usr/sbin:/usr/bin\n\n# m h dom mon dow user  command\n17 *    * * *   root    cd / && run-parts --report /etc/cron.hourly\n25 6    * * *   root    test -x /usr/sbin/anacron || run-parts --report /etc/cron.daily\n");
    put("/etc/fstab", "# <file system> <mount point>   <type>  <options>       <dump>  <pass>\nLABEL=cloudimg-rootfs\t/\t ext4\tdiscard,errors=remount-ro\t0 1\nLABEL=UEFI\t/boot/efi\tvfat\tumask=0077\t0 1\n/dev/vdb\t/srv/backups\text4\tdefaults,nofail\t0 2\n");
    put("/etc/resolv.conf", "nameserver 127.0.0.53\noptions edns0 trust-ad\nsearch kestrel.internal\n");
    put("/etc/nginx/nginx.conf", "user www-data;\nworker_processes auto;\npid /run/nginx.pid;\nerror_log /var/log/nginx/error.log;\ninclude /etc/nginx/modules-enabled/*.conf;\n\nevents {\n\tworker_connections 768;\n}\n\nhttp {\n\tsendfile on;\n\ttcp_nopush on;\n\ttypes_hash_max_size 2048;\n\tserver_tokens off;\n\n\tinclude /etc/nginx/mime.types;\n\tdefault_type application/octet-stream;\n\n\tssl_protocols TLSv1.2 TLSv1.3;\n\tssl_prefer_server_ciphers on;\n\n\taccess_log /var/log/nginx/access.log;\n\n\tgzip on;\n\n\tinclude /etc/nginx/conf.d/*.conf;\n\tinclude /etc/nginx/sites-enabled/*;\n}\n");
    put("/etc/nginx/mime.types", "types {\n    text/html                             html htm shtml;\n    text/css                              css;\n    application/javascript                js;\n    application/json                      json;\n    image/png                             png;\n}\n");
    put("/etc/nginx/conf.d/security-headers.conf", "add_header X-Content-Type-Options nosniff;\nadd_header X-Frame-Options DENY;\nadd_header Referrer-Policy strict-origin-when-cross-origin;\n");
    put("/etc/nginx/sites-available/default", "server {\n\tlisten 80 default_server;\n\troot /var/www/html;\n\tindex index.html;\n\tserver_name _;\n}\n");
    put("/etc/nginx/sites-available/kestrel", "server {\n\tlisten 80;\n\tserver_name kestrel.example.com;\n\troot /var/www/kestrel;\n\n\tlocation /api/ {\n\t\tproxy_pass http://127.0.0.1:8080;\n\t}\n\n\tlocation /uploads/ {\n\t\tautoindex off;\n\t}\n}\n");
    mk("/etc/nginx/sites-enabled");
    sys.root.children.etc.children.nginx.children["sites-enabled"].children.kestrel = S.linkNode("/etc/nginx/sites-available/kestrel");
    mk("/etc/nginx/modules-enabled");
    put("/etc/ssh/sshd_config", "# This is the sshd server system-wide configuration file.\nInclude /etc/ssh/sshd_config.d/*.conf\n\nPort 22\n#PermitRootLogin prohibit-password\nPubkeyAuthentication yes\nPasswordAuthentication yes\nKbdInteractiveAuthentication no\nUsePAM yes\nX11Forwarding yes\nPrintMotd no\nAcceptEnv LANG LC_*\nSubsystem\tsftp\t/usr/lib/openssh/sftp-server\n");
    mk("/etc/ssh/sshd_config.d");
    put("/etc/logrotate.d/nginx", "/var/log/nginx/*.log {\n\tdaily\n\tmissingok\n\trotate 14\n\tcompress\n\tdelaycompress\n\tnotifempty\n\tcreate 0640 www-data adm\n}\n");
    put("/etc/systemd/system/kestrel-app.service", "[Unit]\nDescription=Kestrel web app\nAfter=network.target\n\n[Service]\nUser=www-data\nWorkingDirectory=/opt/kestrel/app\nExecStart=/opt/kestrel/app/venv/bin/gunicorn -b 127.0.0.1:8080 app:app\nRestart=on-failure\n\n[Install]\nWantedBy=multi-user.target\n");
    // homes
    mk("/home");
    mk("/root", 448, 0, 0);
    put("/root/.bashrc", BASHRC, 420, 0, 0);
    put("/root/.profile", "# ~/.profile: executed by Bourne-compatible login shells.\nif [ \"$BASH\" ]; then\n  if [ -f ~/.bashrc ]; then\n    . ~/.bashrc\n  fi\nfi\nmesg n 2> /dev/null || true\n", 420, 0, 0);
    [["dev", 1000], ["ana", 1001], ["ben", 1002], ["deploy", 1003]].forEach(function (u) {
      mk("/home/" + u[0], 488, u[1], u[1]);
      put("/home/" + u[0] + "/.bashrc", BASHRC, 420, u[1], u[1], NOW - 9 * DAY);
      put("/home/" + u[0] + "/.profile", "# ~/.profile: executed by the command interpreter for login shells.\nif [ -n \"$BASH_VERSION\" ]; then\n    if [ -f \"$HOME/.bashrc\" ]; then\n\t. \"$HOME/.bashrc\"\n    fi\nfi\nif [ -d \"$HOME/bin\" ] ; then\n    PATH=\"$HOME/bin:$PATH\"\nfi\nif [ -d \"$HOME/.local/bin\" ] ; then\n    PATH=\"$HOME/.local/bin:$PATH\"\nfi\n", 420, u[1], u[1], NOW - 9 * DAY);
      put("/home/" + u[0] + "/.bash_logout", "# ~/.bash_logout: executed by bash(1) when login shell exits.\n", 420, u[1], u[1], NOW - 9 * DAY);
    });
    mk("/home/dev/.ssh", 448, 1000, 1000);
    put("/home/dev/.ssh/authorized_keys", "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIL7kQ2c1H9mY3vXr5tPq8sWn0aZ4jF6bD2eG1hK9uM3x dev@laptop\n", 384, 1000, 1000, NOW - 9 * DAY);
    put("/home/ana/notes.txt", "Remember: rotate the staging DB password on Friday.\n", 416, 1001, 1001);
    // logs
    mk("/var/log", 509, 0, 111);
    var access = accessLog(42, 120);
    put("/var/log/nginx/access.log", access.join("\n") + "\n", 416, 33, 4, NOW - 60000);
    put("/var/log/nginx/error.log", "2026/11/11 03:12:08 [error] 1123#1123: *88 connect() failed (111: Connection refused) while connecting to upstream, client: 192.0.2.44, server: kestrel.example.com, request: \"GET /api/payments HTTP/1.1\", upstream: \"http://127.0.0.1:8080/api/payments\"\n", 416, 33, 4);
    S.mkdirs(sys, "/var/log/nginx").gid = 4;
    put("/var/log/syslog", "2026-11-11T08:52:01.114201+00:00 kc-web-01 systemd[1]: Started session-41.scope - Session 41 of User dev.\n2026-11-11T08:55:00.004113+00:00 kc-web-01 CRON[2201]: (root) CMD (command -v debian-sa1 > /dev/null && debian-sa1 1 1)\n", 416, 104, 4);
    put("/var/log/auth.log", "2026-11-11T08:52:00.884512+00:00 kc-web-01 sshd[2188]: Accepted publickey for dev from 198.51.100.20 port 51544 ssh2: ED25519 SHA256:3mN4oP5qR6sT7uV8wX9yZ0aB1cD2eF3gH4iJ5kL6mN7\n2026-11-11T08:52:00.901233+00:00 kc-web-01 sshd[2188]: pam_unix(sshd:session): session opened for user dev(uid=1000) by dev(uid=0)\n", 416, 104, 4);
    put("/var/log/dpkg.log", "2026-11-09 10:15:32 status installed nginx-common:all 1.24.0-2ubuntu7.1\n2026-11-09 10:15:33 status installed nginx:amd64 1.24.0-2ubuntu7.1\n", 420);
    put("/var/log/kern.log", "2026-11-11T07:00:12.000000+00:00 kc-web-01 kernel: [UFW BLOCK] IN=eth0 OUT= SRC=203.0.113.50 DST=10.20.0.15 PROTO=TCP SPT=51022 DPT=3306\n", 416, 104, 4);
    // web and app
    mk("/var/www", 493);
    put("/var/www/html/index.html", "<!DOCTYPE html>\n<html><head><title>Welcome to nginx!</title></head><body><h1>Welcome to nginx!</h1></body></html>\n", 420);
    put("/var/www/kestrel/index.html", "<!DOCTYPE html>\n<html><head><title>Kestrel Cloud</title><link rel=\"stylesheet\" href=\"/assets/app.css\"></head>\n<body><h1>Kestrel Cloud</h1><p>Status: all systems normal.</p></body></html>\n", 420, 33, 33);
    put("/var/www/kestrel/assets/app.css", "body { font-family: system-ui; margin: 2rem; }\nh1 { color: #0b6; }\n", 420, 33, 33);
    mk("/var/www/kestrel/uploads", 509, 33, 33);
    put("/opt/kestrel/app/app.py", "from flask import Flask, jsonify\napp = Flask(__name__)\n\n@app.get('/api/health')\ndef health():\n    return jsonify(status='ok')\n", 420, 0, 0);
    put("/opt/kestrel/app/requirements.txt", "flask==3.0.3\ngunicorn==22.0.0\n", 420);
    put("/opt/kestrel/app/config.yml", "database:\n  host: kc-db-01.kestrel.internal\n  port: 5432\n  name: kestrel\nlog_level: info\n", 416, 0, 33);
  });

  S.util = { opts: opts, out: out, errl: errl, note: note, lines: lines, joinLines: joinLines, bytes: bytes, eachInput: eachInput, pad: pad, rpad: rpad, lsDate: lsDate, isoDate: isoDate, modeStr: modeStr, octal: octal, nodeSize: nodeSize, blocks: blocks, human: human, help: help, MON: MON, WDAY: WDAY, logAuth: logAuth, BINS: BINS, cloneNode: cloneNode, quoteName: quoteName };
  S.cmdNames = function () { return Object.keys(CMDS).concat(Object.keys(B)); };
  S.sortLines = sortLines;
})(typeof window !== "undefined" ? window : globalThis);
