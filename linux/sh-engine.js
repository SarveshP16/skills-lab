/* sudo learn — a simulated Bash shell on a simulated Ubuntu 24.04 server (kc-web-01), in plain JavaScript.
   This file: the machine (a Unix file system with owners and permission bits, users and groups read from /etc),
   the Bash parser (pipes, && ||, ;, redirections, here-docs, if/for/while/case/functions), word expansion
   (quotes, $VAR and ${...}, $(...), $((...)), ~, braces, globbing) and the interpreter. Commands live in sh-cmds.js.
   Works in the browser (window.ShEngine) and in Node (module.exports). */
(function (root) {
  "use strict";

  var NOW = Date.UTC(2026, 10, 11, 9, 0, 0);   // Wed 11 Nov 2026 09:00 UTC on kc-web-01
  var DAY = 86400000;

  /* ================================================================== Errors and signals */
  function ShError(msg, code) { this.message = msg; this.code = code == null ? 1 : code; }
  function ExitSignal(code) { this.code = code; }
  function ReturnSignal(code) { this.code = code; }
  function BreakSignal(n) { this.n = n || 1; }
  function ContinueSignal(n) { this.n = n || 1; }
  function StepLimit() {}

  /* ================================================================== File system */
  function dirNode(mode, uid, gid, mtime) { return { type: "d", mode: mode, uid: uid, gid: gid, mtime: mtime || NOW - 30 * DAY, children: {} }; }
  function fileNode(content, mode, uid, gid, mtime) { return { type: "f", mode: mode, uid: uid, gid: gid, mtime: mtime || NOW - 2 * DAY, content: content == null ? "" : String(content) }; }
  function linkNode(target, uid, gid) { return { type: "l", mode: 511, uid: uid || 0, gid: gid || 0, mtime: NOW - 300 * DAY, target: target }; }

  function splitPath(p) { return p.split("/").filter(function (s) { return s !== ""; }); }
  function normAbs(p) {
    var out = [];
    splitPath(p).forEach(function (s) { if (s === ".") return; if (s === "..") { out.pop(); return; } out.push(s); });
    return "/" + out.join("/");
  }
  function absPath(sess, p) {
    p = String(p);
    if (p === "") return sess.cwd;
    return p.charAt(0) === "/" ? normAbs(p) : normAbs(sess.cwd + "/" + p);
  }

  // Walk a path. Returns {node, parent, name, path} or {error: 'ENOENT'|'ENOTDIR'|'EACCES'|'ELOOP'}.
  // opts.nofollow: don't follow a symlink in the last component.
  function lookup(sess, path, opts) {
    opts = opts || {};
    var sys = sess.sys;
    var abs = absPath(sess, path);
    var parts = splitPath(abs);
    var node = sys.root, parent = null, name = "", hops = 0, real = [];
    for (var i = 0; i < parts.length; i++) {
      if (node.type !== "d") return { error: "ENOTDIR", path: abs };
      if (!can(sess, node, "x")) return { error: "EACCES", path: abs };
      parent = node; name = parts[i];
      var next = node.children[name];
      if (!next) return { error: "ENOENT", path: abs, parent: parent, name: name, last: i === parts.length - 1 };
      real.push(name);
      var last = i === parts.length - 1;
      if (next.type === "l" && !(last && opts.nofollow)) {
        if (++hops > 20) return { error: "ELOOP", path: abs };
        var target = next.target.charAt(0) === "/" ? next.target : "/" + real.slice(0, -1).join("/") + "/" + next.target;
        var rest = parts.slice(i + 1).join("/");
        var res = lookup(sess, normAbs(target) + (rest ? "/" + rest : ""), opts);
        return res;
      }
      node = next;
    }
    return { node: node, parent: parent, name: name, path: "/" + real.join("/") };
  }
  function inGroup(sess, gid) {
    if (sess.gid === gid) return true;
    return (sess.groups || []).indexOf(gid) >= 0;
  }
  function can(sess, node, what) {
    if (sess.uid === 0) return what !== "x" || node.type === "d" || (node.mode & 73) !== 0;
    var shift = node.uid === sess.uid ? 6 : inGroup(sess, node.gid) ? 3 : 0;
    var bit = what === "r" ? 4 : what === "w" ? 2 : 1;
    return ((node.mode >> shift) & bit) !== 0;
  }
  // Create/overwrite a file at path as the current user (respects permissions). Returns error code or null.
  function writeFile(sess, path, content, append) {
    var r = lookup(sess, path);
    if (r.node) {
      if (r.node.type === "d") return "EISDIR";
      if (!can(sess, r.node, "w")) return "EACCES";
      r.node.content = append ? r.node.content + content : content;
      r.node.mtime = sess.sys.now;
      return null;
    }
    if (r.error !== "ENOENT" || !r.last || !r.parent || r.parent.type !== "d") return r.error;
    if (!can(sess, r.parent, "w") || !can(sess, r.parent, "x")) return "EACCES";
    r.parent.children[r.name] = fileNode(content, 438 & ~sess.umask, sess.uid, sess.gid, sess.sys.now);
    r.parent.mtime = sess.sys.now;
    return null;
  }
  function readFile(sess, path) {
    var r = lookup(sess, path);
    if (r.error) return { error: r.error };
    if (r.node.type === "d") return { error: "EISDIR" };
    if (r.node.special === "null") return { content: "" };
    if (!can(sess, r.node, "r")) return { error: "EACCES" };
    return { content: r.node.content, node: r.node };
  }
  var ERRTEXT = { ENOENT: "No such file or directory", ENOTDIR: "Not a directory", EACCES: "Permission denied", EISDIR: "Is a directory", EEXIST: "File exists", ENOTEMPTY: "Directory not empty", ELOOP: "Too many levels of symbolic links", EPERM: "Operation not permitted" };

  /* ================================================================== Users and groups (from /etc files) */
  function readSys(sys, path) { var n = sys.root, parts = splitPath(path); for (var i = 0; i < parts.length; i++) { if (!n || n.type !== "d") return ""; n = n.children[parts[i]]; } return n && n.type === "f" ? n.content : ""; }
  function passwd(sys) {
    return readSys(sys, "/etc/passwd").split("\n").filter(Boolean).map(function (l) { var f = l.split(":"); return { name: f[0], uid: +f[2], gid: +f[3], gecos: f[4], home: f[5], shell: f[6] }; });
  }
  function groups(sys) {
    return readSys(sys, "/etc/group").split("\n").filter(Boolean).map(function (l) { var f = l.split(":"); return { name: f[0], gid: +f[2], members: f[3] ? f[3].split(",").filter(Boolean) : [] }; });
  }
  function userByName(sys, n) { return passwd(sys).filter(function (u) { return u.name === n; })[0] || null; }
  function userById(sys, id) { return passwd(sys).filter(function (u) { return u.uid === id; })[0] || null; }
  function groupByName(sys, n) { return groups(sys).filter(function (g) { return g.name === n; })[0] || null; }
  function groupById(sys, id) { return groups(sys).filter(function (g) { return g.gid === id; })[0] || null; }
  function uname(sys, id) { var u = userById(sys, id); return u ? u.name : String(id); }
  function gname(sys, id) { var g = groupById(sys, id); return g ? g.name : String(id); }
  function supplementary(sys, user) { return groups(sys).filter(function (g) { return g.members.indexOf(user) >= 0; }).map(function (g) { return g.gid; }); }

  /* ================================================================== Sessions (one per shell process) */
  function setUser(sess, name) {
    var u = userByName(sess.sys, name);
    sess.user = u.name; sess.uid = u.uid; sess.gid = u.gid; sess.home = u.home;
    sess.groups = supplementary(sess.sys, u.name);
    sess.vars.USER = { v: u.name, x: true }; sess.vars.LOGNAME = { v: u.name, x: true }; sess.vars.HOME = { v: u.home, x: true };
  }
  function newSession(sys, opts) {
    opts = opts || {};
    var s = {
      sys: sys, vars: {}, aliases: {}, functions: {}, cwd: "/", umask: 2, lastExit: 0, positional: [], argv0: "bash",
      term: [], histLines: [], steps: 0, maxSteps: opts.maxSteps || 400000, opts: { errexit: false, nounset: false, pipefail: false, xtrace: false },
      userStack: [], depth: 0, pid: 2400 + (sys.pidSeq++ || 0)
    };
    var base = { PATH: "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin", SHELL: "/bin/bash", HOSTNAME: sys.host, LANG: "en_US.UTF-8", TERM: "xterm-256color", EDITOR: "nano" };
    Object.keys(base).forEach(function (k) { s.vars[k] = { v: base[k], x: true }; });
    setUser(s, opts.user || "dev");
    s.cwd = s.home;
    s.vars.PWD = { v: s.cwd, x: true };
    s.vars.PS1 = { v: "\\u@\\h:\\w\\$ ", x: false };
    s.vars.IFS = { v: " \t\n", x: false };
    if (s.uid === 0) s.umask = 18;
    return s;
  }
  function getVar(sess, name) { var v = sess.vars[name]; return v ? v.v : undefined; }
  function setVar(sess, name, val, exp) {
    var scope = sess.locals && sess.locals.length ? sess.locals[sess.locals.length - 1] : null;
    if (scope && Object.prototype.hasOwnProperty.call(scope, name)) { scope[name].v = String(val); return; }
    var cur = sess.vars[name];
    if (cur && cur.ro) throw new ShError("bash: " + name + ": readonly variable", 1);
    sess.vars[name] = { v: String(val), x: exp || (cur ? cur.x : false) };
  }
  function lookupVar(sess, name) {
    if (sess.locals) for (var i = sess.locals.length - 1; i >= 0; i--) if (Object.prototype.hasOwnProperty.call(sess.locals[i], name)) return sess.locals[i][name].v;
    return getVar(sess, name);
  }
  function exportedEnv(sess) { var e = {}; Object.keys(sess.vars).forEach(function (k) { if (sess.vars[k].x) e[k] = sess.vars[k].v; }); return e; }
  // A child process: copies exported variables, cwd and user; shares the machine.
  function childSession(sess) {
    var c = newSession(sess.sys, { user: sess.user, maxSteps: sess.maxSteps - sess.steps });
    c.vars = {};
    var env = exportedEnv(sess);
    Object.keys(env).forEach(function (k) { c.vars[k] = { v: env[k], x: true }; });
    c.vars.IFS = { v: " \t\n", x: false };
    c.cwd = sess.cwd; c.umask = sess.umask; c.uid = sess.uid; c.gid = sess.gid; c.groups = sess.groups; c.user = sess.user; c.home = sess.home;
    c.depth = sess.depth + 1;
    c.parent = sess;
    return c;
  }
  // A subshell ( ... ) or $( ... ): copies everything (variables, functions, aliases, options).
  function subshell(sess) {
    var c = Object.create(null);
    Object.keys(sess).forEach(function (k) { c[k] = sess[k]; });
    c.vars = {}; Object.keys(sess.vars).forEach(function (k) { c.vars[k] = { v: sess.vars[k].v, x: sess.vars[k].x, ro: sess.vars[k].ro }; });
    c.functions = Object.assign({}, sess.functions); c.aliases = Object.assign({}, sess.aliases); c.opts = Object.assign({}, sess.opts);
    c.locals = sess.locals ? sess.locals.slice() : null;
    c.positional = sess.positional.slice();
    c.isSub = true;
    c.root = sess.root || sess;
    return c;
  }
  function step(sess) { var r = sess.root || sess; if (++r.steps > r.maxSteps) throw new StepLimit(); }

  /* ================================================================== Parser */
  var RESERVED = { "if": 1, "then": 1, "elif": 1, "else": 1, "fi": 1, "for": 1, "in": 1, "do": 1, "done": 1, "while": 1, "until": 1, "case": 1, "esac": 1, "function": 1, "{": 1, "}": 1, "!": 1 };
  function ParseError(msg) { this.message = msg; }
  function Parser(src) { this.s = src; this.i = 0; this.pendingHeredocs = []; }
  var P = Parser.prototype;
  P.c = function (k) { return this.s.charAt(this.i + (k || 0)); };
  P.eof = function () { return this.i >= this.s.length; };
  P.err = function (tok) { throw new ParseError("bash: syntax error near unexpected token `" + (tok || "newline") + "'"); };
  P.ws = function () {
    for (;;) {
      var c = this.c();
      if (c === " " || c === "\t") { this.i++; continue; }
      if (c === "\\" && this.c(1) === "\n") { this.i += 2; continue; }
      if (c === "#") { while (!this.eof() && this.c() !== "\n") this.i++; continue; }
      break;
    }
  };
  P.newlines = function () {
    for (;;) { this.ws(); if (this.c() === "\n") { this.i++; this.readHeredocs(); continue; } break; }
  };
  P.readHeredocs = function () {
    var self = this;
    this.pendingHeredocs.forEach(function (h) {
      var lines = [];
      for (;;) {
        if (self.eof()) break;
        var nl = self.s.indexOf("\n", self.i);
        var line = nl < 0 ? self.s.slice(self.i) : self.s.slice(self.i, nl);
        self.i = nl < 0 ? self.s.length : nl + 1;
        var cmp = h.strip ? line.replace(/^\t+/, "") : line;
        if (cmp === h.delim) { h.done = true; break; }
        lines.push(h.strip ? line.replace(/^\t+/, "") : line);
      }
      h.redir.body = lines.join("\n") + (lines.length ? "\n" : "");
    });
    this.pendingHeredocs = [];
  };
  P.peekOp = function () {
    var s = this.s.slice(this.i, this.i + 3);
    var ops = ["&&", "||", ";;", "|&", ";", "&", "|", "(", ")", "\n"];
    for (var k = 0; k < ops.length; k++) if (s.indexOf(ops[k]) === 0) return ops[k];
    return null;
  };
  // A raw word: everything up to an unquoted metacharacter, quotes kept for the expander.
  P.word = function () {
    var start = this.i, out = "";
    while (!this.eof()) {
      var c = this.c();
      if (/[ \t\n;&|<>()]/.test(c)) break;
      if (c === "\\") { out += c + this.c(1); this.i += 2; continue; }
      if (c === "'") { var e = this.s.indexOf("'", this.i + 1); if (e < 0) throw new ParseError("bash: unexpected EOF while looking for matching `''"); out += this.s.slice(this.i, e + 1); this.i = e + 1; continue; }
      if (c === "\"") { out += this.dquoted(); continue; }
      if (c === "`") { var b = this.i + 1; while (b < this.s.length && this.s.charAt(b) !== "`") { if (this.s.charAt(b) === "\\") b++; b++; } if (b >= this.s.length) throw new ParseError("bash: unexpected EOF while looking for matching ``'"); out += this.s.slice(this.i, b + 1); this.i = b + 1; continue; }
      if (c === "$" && (this.c(1) === "(" || this.c(1) === "{")) { out += this.dollar(); continue; }
      out += c; this.i++;
    }
    return out;
  };
  P.dquoted = function () {
    var out = "\"";
    this.i++;
    for (;;) {
      if (this.eof()) throw new ParseError("bash: unexpected EOF while looking for matching `\"'");
      var c = this.c();
      if (c === "\\") { out += c + this.c(1); this.i += 2; continue; }
      if (c === "\"") { this.i++; return out + "\""; }
      if (c === "$" && (this.c(1) === "(" || this.c(1) === "{")) { out += this.dollar(); continue; }
      if (c === "`") { var b = this.i + 1; while (b < this.s.length && this.s.charAt(b) !== "`") { if (this.s.charAt(b) === "\\") b++; b++; } out += this.s.slice(this.i, b + 1); this.i = b + 1; continue; }
      out += c; this.i++;
    }
  };
  // $( ... ), $(( ... )), ${ ... } with nesting and quotes inside.
  P.dollar = function () {
    var start = this.i, open = this.c(1), close = open === "(" ? ")" : "}", depth = 0;
    this.i += 1;
    for (;;) {
      if (this.eof()) throw new ParseError("bash: unexpected EOF while looking for matching `" + close + "'");
      var c = this.c();
      if (c === "\\") { this.i += 2; continue; }
      if (c === "'" && open === "(") { var e = this.s.indexOf("'", this.i + 1); this.i = e < 0 ? this.s.length : e + 1; continue; }
      if (c === "\"") { this.dquoted(); continue; }
      if (c === open) depth++;
      else if (c === close) { depth--; if (depth === 0) { this.i++; return this.s.slice(start, this.i); } }
      this.i++;
    }
  };
  P.redirect = function () {
    var m = /^(\d*)(&>>|&>|>>|>&|>\||<<<|<<-|<<|<&|<>|>|<)/.exec(this.s.slice(this.i, this.i + 6));
    if (!m) return null;
    var fd = m[1] === "" ? null : +m[1];
    var op = m[2];
    this.i += m[0].length;
    this.ws();
    var r = { fd: fd, op: op };
    if ((op === ">&" || op === "<&") && /^[0-9-]/.test(this.c())) { var d = ""; while (/[0-9-]/.test(this.c())) d += this.s.charAt(this.i++); r.dup = d; return r; }
    var w = this.word();
    if (!w) this.err(this.c() || "newline");
    if (op === "<<" || op === "<<-") {
      r.quoted = /['"\\]/.test(w);
      r.delim = w.replace(/['"\\]/g, "");
      r.strip = op === "<<-";
      this.pendingHeredocs.push({ delim: r.delim, strip: r.strip, redir: r });
      r.body = "";
    } else r.target = w;
    return r;
  };
  P.atRedirect = function () { return /^\d*(&>|>|<)/.test(this.s.slice(this.i, this.i + 4)); };
  P.keyword = function (k) {
    this.ws();
    if (this.s.slice(this.i, this.i + k.length) === k && /^($|[\s;&|()<>])/.test(this.s.slice(this.i + k.length, this.i + k.length + 1))) return true;
    return false;
  };
  P.expectKw = function (k) { this.newlines(); if (!this.keyword(k)) this.err(this.peekWord() || "newline"); this.i += k.length; };
  P.peekWord = function () { var save = this.i; this.ws(); var w = this.atRedirect() ? "" : this.word(); this.i = save; return w; };

  P.program = function () {
    var list = this.list(null);
    this.newlines();
    if (!this.eof()) this.err(this.peekOp() || this.peekWord());
    return list;
  };
  // A list of and-or chains separated by ; & or newlines, until one of the stop keywords.
  P.list = function (stops) {
    var items = [];
    for (;;) {
      this.newlines();
      if (this.eof()) break;
      var w = this.peekWord();
      if (stops && stops.indexOf(w) >= 0) break;
      var op = this.peekOp();
      if (op === ")" || op === ";;") break;
      if (op && op !== "(" && op !== "\n") this.err(op);
      var node = this.andOr();
      this.ws();
      var sep = this.peekOp();
      if (sep === ";" || sep === "&") { this.i++; items.push({ node: node, bg: sep === "&" }); continue; }
      items.push({ node: node, bg: false });
      if (sep === "\n") { this.i++; this.readHeredocs(); continue; }
      break;
    }
    return { t: "list", items: items };
  };
  P.andOr = function () {
    var first = this.pipeline(), rest = [];
    for (;;) {
      this.ws();
      var op = this.peekOp();
      if (op !== "&&" && op !== "||") break;
      this.i += 2;
      this.newlines();
      rest.push({ op: op, node: this.pipeline() });
    }
    return rest.length ? { t: "andor", first: first, rest: rest } : first;
  };
  P.pipeline = function () {
    this.ws();
    var neg = false;
    if (this.keyword("!")) { this.i++; neg = true; }
    var cmds = [this.command()];
    for (;;) {
      this.ws();
      var op = this.peekOp();
      if (op !== "|" && op !== "|&") break;
      this.i += op.length;
      this.newlines();
      var c = this.command();
      if (op === "|&") c.stderrToPipe = true;
      cmds.push(c);
    }
    return cmds.length > 1 || neg ? { t: "pipe", cmds: cmds, neg: neg } : cmds[0];
  };
  P.command = function () {
    this.ws();
    var node;
    if (this.c() === "(") {
      if (this.c(1) === "(") { var a = this.dollarArith(); node = { t: "arithcmd", expr: a }; }
      else { this.i++; var body = this.list(null); this.newlines(); if (this.c() !== ")") this.err(this.c() || "newline"); this.i++; node = { t: "subshell", body: body }; }
    } else if (this.keyword("{")) { this.i++; var b = this.list(["}"]); this.expectKw("}"); node = { t: "group", body: b }; }
    else if (this.keyword("if")) node = this.ifCmd();
    else if (this.keyword("for")) node = this.forCmd();
    else if (this.keyword("while") || this.keyword("until")) node = this.whileCmd();
    else if (this.keyword("case")) node = this.caseCmd();
    else if (this.keyword("function")) { this.i += 8; this.ws(); var fn = this.word(); this.ws(); if (this.c() === "(" && this.c(1) === ")") this.i += 2; this.newlines(); node = { t: "func", name: fn, body: this.command() }; return node; }
    else if (this.s.slice(this.i, this.i + 2) === "[[") node = this.dbracket();
    else {
      node = this.simple();
      if (node.words.length === 1 && !node.assigns.length && /^[A-Za-z_][\w.-]*$/.test(node.words[0])) {
        var save = this.i;
        this.ws();
        if (this.c() === "(" && this.s.slice(this.i).match(/^\(\s*\)/)) {
          this.i = this.s.indexOf(")", this.i) + 1;
          this.newlines();
          return { t: "func", name: node.words[0], body: this.command() };
        }
        this.i = save;
      }
      return node;
    }
    node.redirs = [];
    for (;;) { this.ws(); if (!this.atRedirect()) break; node.redirs.push(this.redirect()); }
    return node;
  };
  P.dollarArith = function () {
    var start = this.i + 2, depth = 0;
    for (var k = this.i; k < this.s.length; k++) {
      var c = this.s.charAt(k);
      if (c === "(") depth++;
      else if (c === ")") { depth--; if (depth === 0) { var expr = this.s.slice(start, k - 1); this.i = k + 1; return expr; } }
    }
    throw new ParseError("bash: unexpected EOF while looking for matching `)'");
  };
  P.simple = function () {
    var assigns = [], words = [], redirs = [];
    for (;;) {
      this.ws();
      if (this.eof()) break;
      if (this.atRedirect()) { redirs.push(this.redirect()); continue; }
      var op = this.peekOp();
      if (op) break;
      if (!words.length && (this.keyword("then") || this.keyword("do") || this.keyword("done") || this.keyword("fi") || this.keyword("esac") || this.keyword("else") || this.keyword("elif") || this.keyword("}"))) break;
      var w = this.word();
      if (!w) break;
      if (!words.length && /^[A-Za-z_][A-Za-z0-9_]*(\+)?=/.test(w)) { assigns.push(w); continue; }
      words.push(w);
    }
    if (!assigns.length && !words.length && !redirs.length) this.err(this.peekOp() || this.c() || "newline");
    return { t: "simple", assigns: assigns, words: words, redirs: redirs };
  };
  P.ifCmd = function () {
    this.i += 2;
    var clauses = [], els = null;
    var cond = this.list(["then"]); this.expectKw("then");
    var body = this.list(["elif", "else", "fi"]);
    clauses.push({ cond: cond, body: body });
    for (;;) {
      this.newlines();
      if (this.keyword("elif")) { this.i += 4; var c2 = this.list(["then"]); this.expectKw("then"); clauses.push({ cond: c2, body: this.list(["elif", "else", "fi"]) }); continue; }
      if (this.keyword("else")) { this.i += 4; els = this.list(["fi"]); }
      break;
    }
    this.expectKw("fi");
    return { t: "if", clauses: clauses, els: els };
  };
  P.forCmd = function () {
    this.i += 3; this.ws();
    if (this.s.slice(this.i, this.i + 2) === "((") {
      var expr = this.dollarArith().split(";");
      this.ws(); if (this.c() === ";") this.i++;
      this.expectKw("do"); var b = this.list(["done"]); this.expectKw("done");
      return { t: "cfor", init: expr[0], cond: expr[1], step: expr[2], body: b };
    }
    var name = this.word(), words = null;
    this.newlines();
    if (this.keyword("in")) { this.i += 2; words = []; for (;;) { this.ws(); var op = this.peekOp(); if (op) break; if (this.eof()) break; words.push(this.word()); } }
    this.ws(); if (this.c() === ";") this.i++;
    this.expectKw("do");
    var body = this.list(["done"]);
    this.expectKw("done");
    return { t: "for", name: name, words: words, body: body };
  };
  P.whileCmd = function () {
    var until = this.keyword("until");
    this.i += until ? 5 : 5;
    var cond = this.list(["do"]); this.expectKw("do");
    var body = this.list(["done"]); this.expectKw("done");
    return { t: "while", cond: cond, body: body, until: until };
  };
  P.caseCmd = function () {
    this.i += 4; this.ws();
    var word = this.word();
    this.newlines(); this.expectKw("in");
    var items = [];
    for (;;) {
      this.newlines();
      if (this.keyword("esac")) { this.i += 4; break; }
      if (this.c() === "(") this.i++;
      var pats = [];
      for (;;) { this.ws(); pats.push(this.word()); this.ws(); if (this.c() === "|") { this.i++; continue; } break; }
      if (this.c() !== ")") this.err(this.c());
      this.i++;
      var body = this.list(["esac"]);
      this.ws();
      if (this.s.slice(this.i, this.i + 2) === ";;") this.i += 2;
      items.push({ patterns: pats, body: body });
    }
    return { t: "case", word: word, items: items };
  };
  P.dbracket = function () {
    this.i += 2;
    var words = [];
    for (;;) {
      this.ws();
      if (this.s.slice(this.i, this.i + 2) === "]]") { this.i += 2; break; }
      if (this.eof()) throw new ParseError("bash: unexpected EOF while looking for `]]'");
      var two = this.s.slice(this.i, this.i + 2);
      if (two === "&&" || two === "||") { words.push(two); this.i += 2; continue; }
      if (this.c() === "(" || this.c() === ")" || this.c() === "!") { words.push(this.c()); this.i++; continue; }
      if (this.c() === "<" || this.c() === ">") { words.push(this.c()); this.i++; continue; }
      words.push(this.word());
    }
    return { t: "dbracket", words: words };
  };
  function parse(src) {
    var p = new Parser(src);
    var prog = p.program();
    if (p.pendingHeredocs.length) p.readHeredocs();
    return prog;
  }

  /* ================================================================== Expansion */
  // Brace expansion on a raw (unexpanded) word: {a,b}, {1..5}, {a..e}.
  function braceExpand(w) {
    var depth = 0, start = -1, q = null;
    for (var i = 0; i < w.length; i++) {
      var c = w.charAt(i);
      if (c === "\\") { i++; continue; }
      if (q) { if (c === q) q = null; continue; }
      if (c === "'" || c === "\"") { q = c; continue; }
      if (c === "$" && w.charAt(i + 1) === "{") { var d = 0; for (; i < w.length; i++) { if (w.charAt(i) === "{") d++; else if (w.charAt(i) === "}" && --d === 0) break; } continue; }
      if (c === "{") { if (depth === 0) start = i; depth++; }
      else if (c === "}" && depth > 0) {
        depth--;
        if (depth === 0) {
          var inner = w.slice(start + 1, i), pre = w.slice(0, start), post = w.slice(i + 1);
          var seq = /^(-?\d+)\.\.(-?\d+)(?:\.\.(\d+))?$/.exec(inner) || /^([a-zA-Z])\.\.([a-zA-Z])$/.exec(inner);
          var alts = null;
          if (seq) {
            alts = [];
            var num = /\d/.test(seq[1]);
            var a = num ? +seq[1] : seq[1].charCodeAt(0), b = num ? +seq[2] : seq[2].charCodeAt(0), st = seq[3] ? +seq[3] : 1;
            var pad = num && (/^-?0\d/.test(seq[1]) || /^-?0\d/.test(seq[2])) ? Math.max(seq[1].length, seq[2].length) : 0;
            for (var k = a; a <= b ? k <= b : k >= b; k += a <= b ? st : -st) { var s = num ? String(k) : String.fromCharCode(k); while (s.length < pad) s = "0" + s; alts.push(s); if (alts.length > 10000) break; }
          } else {
            var parts = [], d2 = 0, cur = "", q2 = null;
            for (var j = 0; j < inner.length; j++) {
              var ch = inner.charAt(j);
              if (ch === "\\") { cur += ch + inner.charAt(++j); continue; }
              if (q2) { cur += ch; if (ch === q2) q2 = null; continue; }
              if (ch === "'" || ch === "\"") { q2 = ch; cur += ch; continue; }
              if (ch === "{") d2++; if (ch === "}") d2--;
              if (ch === "," && d2 === 0) { parts.push(cur); cur = ""; continue; }
              cur += ch;
            }
            parts.push(cur);
            if (parts.length > 1) alts = parts;
          }
          if (alts) {
            var out = [];
            alts.forEach(function (x) { braceExpand(pre + x + post).forEach(function (y) { out.push(y); }); });
            return out;
          }
        }
      }
    }
    return [w];
  }

  // Chunks: {text, quoted} pieces of one word; unquoted expansion results may be field-split.
  function expandChunks(sess, raw, opts) {
    opts = opts || {};
    var chunks = [], i = 0, n = raw.length;
    function lit(t, q, splittable) { if (t !== "") chunks.push({ text: t, quoted: q, split: !!splittable }); }
    if (!opts.noTilde && raw.charAt(0) === "~") {
      var m = /^~([A-Za-z_][\w-]*)?(?=\/|$)/.exec(raw);
      if (m) {
        var home = m[1] ? (userByName(sess.sys, m[1]) || {}).home : lookupVar(sess, "HOME");
        if (home) { lit(home, true); i = m[0].length; }
      }
    }
    var buf = "";
    function flush(q) { if (buf) { lit(buf, q); buf = ""; } }
    while (i < n) {
      var c = raw.charAt(i);
      if (c === "\\") { flush(false); lit(raw.charAt(i + 1), true); i += 2; continue; }
      if (c === "'") { flush(false); var e = raw.indexOf("'", i + 1); lit(raw.slice(i + 1, e), true); if (raw.slice(i + 1, e) === "") chunks.push({ text: "", quoted: true }); i = e + 1; continue; }
      if (c === "\"") {
        flush(false);
        var j = i + 1, inner = "";
        var mark = chunks.length;
        while (j < n && raw.charAt(j) !== "\"") {
          var d = raw.charAt(j);
          if (d === "\\" && /[$`"\\\n]/.test(raw.charAt(j + 1))) { inner += raw.charAt(j + 1); j += 2; continue; }
          if (d === "$" || d === "`") {
            if (inner) { lit(inner, true); inner = ""; }
            var r = dollar(sess, raw, j, true);
            if (r.fields) { r.fields.forEach(function (f, fi) { if (fi > 0) chunks.push({ text: "", quoted: true, newField: true }); lit(f, true); }); }
            else lit(r.text, true);
            j = r.end; continue;
          }
          inner += d; j++;
        }
        if (inner) lit(inner, true);
        if (chunks.length === mark) chunks.push({ text: "", quoted: true });
        i = j + 1; continue;
      }
      if (c === "$" || c === "`") {
        var r2 = dollar(sess, raw, i, false);
        if (r2.end === i + 1 && c === "$") { buf += "$"; i++; continue; }
        flush(false);
        if (r2.fields) r2.fields.forEach(function (f, fi) { if (fi > 0) chunks.push({ text: "", quoted: true, newField: true }); lit(f, false, true); });
        else lit(r2.text, false, true);
        i = r2.end; continue;
      }
      buf += c; i++;
    }
    flush(false);
    return chunks;
  }
  // $name ${...} $(...) $((...)) `...` starting at raw[i]. Returns {text, end} (or {fields} for "$@").
  function dollar(sess, raw, i, inQuotes) {
    var c = raw.charAt(i);
    if (c === "`") {
      var e = i + 1; while (e < raw.length && raw.charAt(e) !== "`") { if (raw.charAt(e) === "\\") e++; e++; }
      var src = raw.slice(i + 1, e).replace(/\\([`$\\])/g, "$1");
      return { text: cmdSubst(sess, src), end: e + 1 };
    }
    var n1 = raw.charAt(i + 1);
    if (n1 === "(" && raw.charAt(i + 2) === "(") {
      var depth = 0, k;
      for (k = i + 1; k < raw.length; k++) { if (raw.charAt(k) === "(") depth++; else if (raw.charAt(k) === ")") { depth--; if (depth === 0) break; } }
      return { text: String(arith(sess, raw.slice(i + 3, k - 1))), end: k + 1 };
    }
    if (n1 === "(") {
      var d2 = 0, k2, q = null;
      for (k2 = i + 1; k2 < raw.length; k2++) {
        var ch = raw.charAt(k2);
        if (ch === "\\") { k2++; continue; }
        if (q) { if (ch === q) q = null; continue; }
        if (ch === "'" || ch === "\"") { q = ch; continue; }
        if (ch === "(") d2++; else if (ch === ")") { d2--; if (d2 === 0) break; }
      }
      return { text: cmdSubst(sess, raw.slice(i + 2, k2)), end: k2 + 1 };
    }
    if (n1 === "{") {
      var d3 = 0, k3;
      for (k3 = i + 1; k3 < raw.length; k3++) { if (raw.charAt(k3) === "{") d3++; else if (raw.charAt(k3) === "}") { d3--; if (d3 === 0) break; } }
      return { text: paramExpand(sess, raw.slice(i + 2, k3)), end: k3 + 1 };
    }
    if (/[@*#?$!0-9-]/.test(n1)) {
      if (n1 === "@" && inQuotes) return { fields: sess.positional.slice(), end: i + 2 };
      return { text: special(sess, n1), end: i + 2 };
    }
    var m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(raw.slice(i + 1));
    if (!m) return { text: "$", end: i + 1 };
    var v = lookupVar(sess, m[0]);
    if (v === undefined && sess.opts.nounset) throw new ShError("bash: " + m[0] + ": unbound variable", 1);
    return { text: v === undefined ? "" : v, end: i + 1 + m[0].length };
  }
  function special(sess, c) {
    if (c === "?") return String(sess.lastExit);
    if (c === "$") return String(sess.pid);
    if (c === "#") return String(sess.positional.length);
    if (c === "@" || c === "*") return sess.positional.join(" ");
    if (c === "0") return sess.argv0;
    if (c === "!") return String(sess.lastBg || "");
    if (c === "-") return "himBH";
    var v = sess.positional[+c - 1];
    if (v === undefined && sess.opts.nounset) throw new ShError("bash: $" + c + ": unbound variable", 1);
    return v === undefined ? "" : v;
  }
  function paramExpand(sess, body) {
    if (body.charAt(0) === "#" && body.length > 1) { var v0 = paramValue(sess, body.slice(1)); return String((v0 || "").length); }
    var m = /^([A-Za-z_][A-Za-z0-9_]*|[0-9]+|[@*#?$!])(.*)$/.exec(body);
    if (!m) throw new ShError("bash: ${" + body + "}: bad substitution", 1);
    var name = m[1], rest = m[2], val = paramValue(sess, name);
    if (rest === "") { if (val === undefined && sess.opts.nounset) throw new ShError("bash: " + name + ": unbound variable", 1); return val === undefined ? "" : val; }
    var w = function (s) { return expandString(sess, s); };
    var mm;
    if ((mm = /^(:?)([-=+?])([\s\S]*)$/.exec(rest))) {
      var unset = val === undefined || (mm[1] && val === "");
      if (mm[2] === "-") return unset ? w(mm[3]) : val;
      if (mm[2] === "=") { if (unset) { setVar(sess, name, w(mm[3])); return w(mm[3]); } return val; }
      if (mm[2] === "+") return unset ? "" : w(mm[3]);
      if (mm[2] === "?") { if (unset) throw new ShError("bash: " + name + ": " + (mm[3] ? w(mm[3]) : "parameter null or not set"), 1); return val; }
    }
    val = val || "";
    if ((mm = /^(##?|%%?)([\s\S]*)$/.exec(rest))) {
      var re = globRegexSrc(w(mm[2]), true);
      var greedy = mm[1].length === 2;
      if (mm[1].charAt(0) === "#") {
        for (var k = greedy ? val.length : 0; greedy ? k >= 0 : k <= val.length; greedy ? k-- : k++) if (new RegExp("^" + re + "$").test(val.slice(0, k))) return val.slice(k);
        return val;
      }
      for (var k2 = greedy ? 0 : val.length; greedy ? k2 <= val.length : k2 >= 0; greedy ? k2++ : k2--) if (new RegExp("^" + re + "$").test(val.slice(k2))) return val.slice(0, k2);
      return val;
    }
    if ((mm = /^(\/\/?)([^/]*)(?:\/([\s\S]*))?$/.exec(rest))) {
      var pat = new RegExp(globRegexSrc(w(mm[2]), true), mm[1] === "//" ? "g" : "");
      return val.replace(pat, function () { return w(mm[3] || ""); });
    }
    if ((mm = /^:(-?\d+)(?::(\d+))?$/.exec(rest))) { var off = +mm[1]; if (off < 0) off = Math.max(0, val.length + off); return mm[2] !== undefined ? val.substr(off, +mm[2]) : val.slice(off); }
    if (rest === "^^") return val.toUpperCase();
    if (rest === ",,") return val.toLowerCase();
    if (rest === "^") return val.charAt(0).toUpperCase() + val.slice(1);
    throw new ShError("bash: ${" + body + "}: bad substitution", 1);
  }
  function paramValue(sess, name) { if (/^[0-9]+$/.test(name)) return name === "0" ? sess.argv0 : sess.positional[+name - 1]; if (/^[@*#?$!]$/.test(name)) return special(sess, name); return lookupVar(sess, name); }
  function cmdSubst(sess, src) {
    var sub = subshell(sess);
    var buf = [];
    var io = { stdin: null, out: function (t) { buf.push(t); }, err: sess.curIO ? sess.curIO.err : function (t) { termWrite(sess, t, true); }, tty: false };
    var code = 0;
    try { code = runSource(sub, src, io); }
    catch (e) { if (e instanceof ExitSignal) code = e.code; else throw e; }
    sess.lastExit = code;
    return buf.join("").replace(/\n+$/, "");
  }
  // Expand a word to fields (split + glob unless quoted).
  function expandWord(sess, raw) {
    var out = [];
    braceExpand(raw).forEach(function (w) {
      var chunks = expandChunks(sess, w);
      var fields = [[]];
      var ifs = lookupVar(sess, "IFS");
      if (ifs === undefined) ifs = " \t\n";
      chunks.forEach(function (ch) {
        if (ch.newField) { fields.push([]); return; }
        if (!ch.quoted && ch.split && ifs) {
          var pieces = ch.text.split(new RegExp("[" + ifs.replace(/[\]\\^-]/g, "\\$&") + "]+"));
          pieces.forEach(function (p, k) { if (k > 0) fields.push([]); if (p !== "") fields[fields.length - 1].push({ text: p, quoted: false }); });
          if (/^\s/.test(ch.text) && fields.length > 1 && !fields[fields.length - 2].length) { /* leading space handled */ }
          return;
        }
        fields[fields.length - 1].push(ch);
      });
      fields.forEach(function (f) {
        if (!f.length) return;
        var hasGlob = f.some(function (ch) { return !ch.quoted && /[*?[]/.test(ch.text); });
        var text = f.map(function (ch) { return ch.text; }).join("");
        if (hasGlob) {
          var pat = f.map(function (ch) { return ch.quoted ? ch.text.replace(/[*?[\]\\]/g, "\\$&") : ch.text; }).join("");
          var hits = glob(sess, pat);
          if (hits.length) { hits.forEach(function (h) { out.push(h); }); return; }
        }
        if (text === "" && !f.some(function (ch) { return ch.quoted; })) return;
        out.push(text);
      });
    });
    return out;
  }
  // Expand without splitting or globbing (assignments, redirect targets, here-doc bodies, case words).
  function expandString(sess, raw, opts) { return expandChunks(sess, raw, opts).filter(function (c) { return !c.newField; }).map(function (c) { return c.text; }).join(""); }
  function expandHeredoc(sess, body) {
    var out = "", i = 0;
    while (i < body.length) {
      var c = body.charAt(i);
      if (c === "\\" && /[$`\\]/.test(body.charAt(i + 1))) { out += body.charAt(i + 1); i += 2; continue; }
      if (c === "$" || c === "`") { var r = dollar(sess, body, i, true); if (r.end === i + 1 && c === "$") { out += "$"; i++; continue; } out += r.fields ? r.fields.join(" ") : r.text; i = r.end; continue; }
      out += c; i++;
    }
    return out;
  }

  /* ---------------- Globbing */
  function globRegexSrc(pat, anyChar) {
    var re = "", i = 0;
    while (i < pat.length) {
      var c = pat.charAt(i);
      if (c === "\\") { re += "\\" + (pat.charAt(i + 1) || "\\"); i += 2; continue; }
      if (c === "*") { re += anyChar ? "[\\s\\S]*" : "[^/]*"; i++; continue; }
      if (c === "?") { re += anyChar ? "[\\s\\S]" : "[^/]"; i++; continue; }
      if (c === "[") {
        var e = pat.indexOf("]", i + 2);
        if (e < 0) { re += "\\["; i++; continue; }
        var cls = pat.slice(i + 1, e);
        if (cls.charAt(0) === "!") cls = "^" + cls.slice(1);
        cls = cls.replace(/\[:(alpha|digit|alnum|upper|lower|space|punct|xdigit):\]/g, function (m0, k) { return { alpha: "A-Za-z", digit: "0-9", alnum: "A-Za-z0-9", upper: "A-Z", lower: "a-z", space: "\\s", punct: "!-\\/:-@\\[-`{-~", xdigit: "0-9A-Fa-f" }[k]; });
        re += "[" + cls.replace(/\\/g, "\\\\") + "]";
        i = e + 1; continue;
      }
      re += c.replace(/[.+^${}()|\/]/g, "\\$&");
      i++;
    }
    return re;
  }
  function globMatch(pat, name) { return new RegExp("^" + globRegexSrc(pat, true) + "$").test(name); }
  function sortNames(a, b) {
    var x = a.replace(/^\.+/, "").toLowerCase(), y = b.replace(/^\.+/, "").toLowerCase();
    var xs = x.replace(/[^a-z0-9]/g, ""), ys = y.replace(/[^a-z0-9]/g, "");
    if (xs !== ys) return xs < ys ? -1 : 1;
    return a < b ? -1 : a > b ? 1 : 0;
  }
  function glob(sess, pat) {
    var absolute = pat.charAt(0) === "/";
    var parts = pat.split("/").filter(function (p, i) { return p !== "" || i === 0; });
    if (absolute) parts = parts.slice(1);
    var bases = [{ abs: absolute ? "/" : sess.cwd, shown: absolute ? "/" : "" }];
    for (var k = 0; k < parts.length; k++) {
      var part = parts[k], next = [];
      var isPat = /(^|[^\\])[*?[]/.test(part);
      bases.forEach(function (b) {
        var r = lookup(sess, b.abs);
        if (!r.node || r.node.type !== "d") return;
        if (!isPat) {
          var lit = part.replace(/\\(.)/g, "$1");
          if (r.node.children[lit] || lit === "." || lit === "..") next.push({ abs: normAbs(b.abs + "/" + lit), shown: b.shown + (b.shown && b.shown !== "/" ? "/" : "") + lit });
          return;
        }
        if (!can(sess, r.node, "r")) return;
        Object.keys(r.node.children).sort(sortNames).forEach(function (name) {
          if (name.charAt(0) === "." && part.charAt(0) !== ".") return;
          if (globMatchPart(part, name)) next.push({ abs: normAbs(b.abs + "/" + name), shown: b.shown + (b.shown && b.shown !== "/" ? "/" : "") + name });
        });
      });
      bases = next;
      if (!bases.length) return [];
    }
    return bases.map(function (b) { return b.shown; });
  }
  function globMatchPart(pat, name) { return new RegExp("^" + globRegexSrc(pat, false) + "$").test(name); }

  /* ---------------- Arithmetic $(( )) */
  function arith(sess, src) {
    src = expandString(sess, src.replace(/\$([A-Za-z_]\w*)/g, "$1"));
    var toks = src.match(/\d+|[A-Za-z_]\w*|\*\*|<<|>>|<=|>=|==|!=|&&|\|\||\+\+|--|[+\-*\/%]=|[-+*\/%()<>!=?:~&|^,]/g) || [];
    var pos = 0;
    function peek() { return toks[pos]; }
    function next() { return toks[pos++]; }
    function num(v) { var n = parseInt(v, 10); return isNaN(n) ? 0 : n; }
    function getv(name) { var v = lookupVar(sess, name); if (v === undefined || v === "") return 0; return /^-?\d+$/.test(v) ? +v : arith(sess, v); }
    function assign(name, v) { setVar(sess, name, String(v)); return v; }
    function primary() {
      var t = next();
      if (t === "(") { var v = comma(); next(); return v; }
      if (t === "-") return -primary();
      if (t === "+") return +primary();
      if (t === "!") return primary() ? 0 : 1;
      if (t === "~") return ~primary();
      if (t === "++" || t === "--") { var n = next(); return assign(n, getv(n) + (t === "++" ? 1 : -1)); }
      if (/^\d/.test(t)) return num(t);
      if (/^[A-Za-z_]/.test(t)) {
        if (peek() === "++" || peek() === "--") { var op = next(), old = getv(t); assign(t, old + (op === "++" ? 1 : -1)); return old; }
        if (peek() === "=" ) { next(); return assign(t, assignExpr()); }
        if (/^[+\-*\/%]=$/.test(peek() || "")) { var o = next().charAt(0), r = assignExpr(), cur = getv(t); return assign(t, o === "+" ? cur + r : o === "-" ? cur - r : o === "*" ? cur * r : o === "/" ? Math.trunc(cur / r) : cur % r); }
        return getv(t);
      }
      throw new ShError("bash: " + src + ": syntax error: operand expected (error token is \"" + (t || "") + "\")", 1);
    }
    function pow() { var b = primary(); if (peek() === "**") { next(); return Math.pow(b, pow()); } return b; }
    function bin(nextFn, ops) { return function () { var v = nextFn(); while (ops.indexOf(peek()) >= 0) { var op = next(), r = nextFn(); v = calc(op, v, r); } return v; }; }
    function calc(op, a, b) {
      switch (op) {
        case "*": return a * b; case "/": if (b === 0) throw new ShError("bash: " + src + ": division by 0 (error token is \"" + b + "\")", 1); return Math.trunc(a / b);
        case "%": if (b === 0) throw new ShError("bash: division by 0", 1); return a % b;
        case "+": return a + b; case "-": return a - b; case "<<": return a << b; case ">>": return a >> b;
        case "<": return a < b ? 1 : 0; case ">": return a > b ? 1 : 0; case "<=": return a <= b ? 1 : 0; case ">=": return a >= b ? 1 : 0;
        case "==": return a === b ? 1 : 0; case "!=": return a !== b ? 1 : 0; case "&": return a & b; case "^": return a ^ b; case "|": return a | b;
        case "&&": return a && b ? 1 : 0; case "||": return a || b ? 1 : 0;
      }
      return 0;
    }
    var mul = bin(pow, ["*", "/", "%"]), add = bin(mul, ["+", "-"]), shift = bin(add, ["<<", ">>"]), rel = bin(shift, ["<", ">", "<=", ">="]),
      eq = bin(rel, ["==", "!="]), band = bin(eq, ["&"]), bxor = bin(band, ["^"]), bor = bin(bxor, ["|"]), land = bin(bor, ["&&"]), lor = bin(land, ["||"]);
    function ternary() { var c = lor(); if (peek() === "?") { next(); var a = assignExpr(); next(); var b = assignExpr(); return c ? a : b; } return c; }
    function assignExpr() { return ternary(); }
    function comma() { var v = assignExpr(); while (peek() === ",") { next(); v = assignExpr(); } return v; }
    if (!toks.length) return 0;
    var v = comma();
    if (pos < toks.length) throw new ShError("bash: " + src + ": syntax error in expression (error token is \"" + toks.slice(pos).join(" ") + "\")", 1);
    return v;
  }

  /* ================================================================== Terminal output */
  // kind: false = stdout, true = stderr, "sys" = a dim note from the lab (not real output)
  function termWrite(sess, text, kind) { (sess.root || sess).term.push({ text: String(text), err: kind === true, sys: kind === "sys" }); }
  // Turn the stream of chunks into lines: [{text, cls}]
  function termLines(chunks) {
    var lines = [], cur = "", kind = null;
    function k(ch) { return ch.err ? "err" : ch.sys ? "sys" : ""; }
    chunks.forEach(function (ch) {
      var parts = ch.text.split("\n");
      parts.forEach(function (p, i) {
        if (i > 0) { lines.push({ text: cur, cls: kind || "" }); cur = ""; kind = null; }
        if (p !== "") { cur += p; kind = kind === null ? k(ch) : kind === k(ch) ? kind : ""; }
      });
    });
    if (cur !== "") lines.push({ text: cur, cls: kind || "" });
    return lines;
  }

  /* ================================================================== Interpreter */
  var CMDS = {};     // command implementations (sh-cmds.js): CMDS[name] = function (args, io, sess) -> exit code
  var BUILTINS = {}; // shell builtins run in the current shell
  function runSource(sess, src, io) {
    var ast = parse(src);
    return execList(sess, ast, io);
  }
  function execList(sess, list, io) {
    var code = sess.lastExit;
    for (var k = 0; k < list.items.length; k++) {
      var it = list.items[k];
      if (it.bg) {
        // No job control in the lab: run it now, report a job number like bash does.
        var jobs = (sess.root || sess).jobs = ((sess.root || sess).jobs || 0) + 1;
        sess.lastBg = 3000 + jobs;
        io.err("[" + jobs + "] " + sess.lastBg + "\n");
      }
      code = execNode(sess, it.node, io, false);
      sess.lastExit = code;
      if (code !== 0 && sess.opts.errexit && !sess.noErrexit && isPlainFailure(it.node)) throw new ExitSignal(code);
    }
    return code;
  }
  function isPlainFailure(node) { return node.t !== "andor" && !(node.t === "pipe" && node.neg); }
  function execNode(sess, node, io, inCond) {
    step(sess);
    switch (node.t) {
      case "list": return execList(sess, node, io);
      case "andor": {
        var prevNE = sess.noErrexit;
        sess.noErrexit = true;
        var code;
        try {
          code = execNode(sess, node.first, io, true);
          for (var k = 0; k < node.rest.length; k++) {
            var r = node.rest[k];
            if ((r.op === "&&" && code === 0) || (r.op === "||" && code !== 0)) {
              if (k === node.rest.length - 1) sess.noErrexit = prevNE;
              code = execNode(sess, r.node, io, inCond);
            }
            sess.lastExit = code;
          }
        } finally { sess.noErrexit = prevNE; }
        return code;
      }
      case "pipe": return execPipe(sess, node, io);
      case "simple": return execSimple(sess, node, io);
      default: return withRedirs(sess, node.redirs || [], io, function (io2) { return execCompound(sess, node, io2); });
    }
  }
  function execCompound(sess, node, io) {
    switch (node.t) {
      case "group": return execList(sess, node.body, io);
      case "subshell": {
        var sub = subshell(sess);
        try { return execList(sub, node.body, io); } catch (e) { if (e instanceof ExitSignal) return e.code; throw e; }
      }
      case "if": {
        for (var k = 0; k < node.clauses.length; k++) {
          if (condRun(sess, node.clauses[k].cond, io) === 0) return execList(sess, node.clauses[k].body, io);
        }
        return node.els ? execList(sess, node.els, io) : 0;
      }
      case "for": {
        var words = [];
        if (node.words) node.words.forEach(function (w) { expandWord(sess, w).forEach(function (x) { words.push(x); }); });
        else words = sess.positional.slice();
        var code = 0;
        for (var i = 0; i < words.length; i++) {
          step(sess);
          setVar(sess, node.name, words[i]);
          try { code = execList(sess, node.body, io); }
          catch (e) { if (e instanceof BreakSignal) { if (e.n > 1) { e.n--; throw e; } break; } if (e instanceof ContinueSignal) { if (e.n > 1) { e.n--; throw e; } continue; } throw e; }
        }
        return code;
      }
      case "cfor": {
        var c2 = 0;
        if (node.init && node.init.trim()) arith(sess, node.init);
        for (;;) {
          step(sess);
          if (node.cond && node.cond.trim() && !arith(sess, node.cond)) break;
          try { c2 = execList(sess, node.body, io); }
          catch (e) { if (e instanceof BreakSignal) break; if (!(e instanceof ContinueSignal)) throw e; }
          if (node.step && node.step.trim()) arith(sess, node.step);
        }
        return c2;
      }
      case "while": {
        var c3 = 0;
        for (;;) {
          step(sess);
          var ok = condRun(sess, node.cond, io) === 0;
          if (node.until ? ok : !ok) break;
          try { c3 = execList(sess, node.body, io); }
          catch (e) { if (e instanceof BreakSignal) { if (e.n > 1) { e.n--; throw e; } break; } if (e instanceof ContinueSignal) { if (e.n > 1) { e.n--; throw e; } continue; } throw e; }
        }
        return c3;
      }
      case "case": {
        var w = expandString(sess, node.word);
        for (var j = 0; j < node.items.length; j++) {
          var it = node.items[j];
          if (it.patterns.some(function (p) { return globMatch(expandString(sess, p), w); })) return execList(sess, it.body, io);
        }
        return 0;
      }
      case "func": sess.functions[node.name] = node.body; return 0;
      case "arithcmd": return arith(sess, node.expr) ? 0 : 1;
      case "dbracket": return dbracket(sess, node.words) ? 0 : 1;
    }
    throw new ShError("bash: unsupported construct", 2);
  }
  function condRun(sess, list, io) {
    var prev = sess.noErrexit; sess.noErrexit = true;
    try { return execList(sess, list, io); } finally { sess.noErrexit = prev; }
  }
  function execPipe(sess, node, io) {
    var input = io.stdin, codes = [];
    for (var k = 0; k < node.cmds.length; k++) {
      var last = k === node.cmds.length - 1;
      var buf = [];
      var cmd = node.cmds[k];
      var io2 = { stdin: input, out: last ? io.out : function (t) { buf.push(t); }, err: cmd.stderrToPipe && !last ? function (t) { buf.push(t); } : io.err, tty: last ? io.tty : false, pipedIn: k > 0, note: last ? io.note : null };
      var code;
      var ps = node.cmds.length > 1 ? subshellLite(sess) : sess;
      try { code = execNode(ps, cmd, io2, false); }
      catch (e) { if (e instanceof ExitSignal && node.cmds.length > 1) code = e.code; else throw e; }
      codes.push(code);
      input = buf.join("");
    }
    var c = codes[codes.length - 1];
    if (sess.opts.pipefail) for (var j = codes.length - 1; j >= 0; j--) if (codes[j] !== 0) { c = codes[j]; break; }
    if (node.neg) c = c === 0 ? 1 : 0;
    return c;
  }
  // Pipeline members run in subshells in bash (cd/variables there don't stick). Keep cwd/vars changes local.
  function subshellLite(sess) { return subshell(sess); }

  function openRedirs(sess, redirs, io) {
    var o = { stdin: io.stdin, out: io.out, err: io.err, tty: io.tty, pipedIn: io.pipedIn, note: io.note };
    var files = [];
    for (var k = 0; k < redirs.length; k++) {
      var r = redirs[k];
      var fd = r.fd === null ? (r.op.charAt(0) === "<" ? 0 : 1) : r.fd;
      if (r.op === "<<" || r.op === "<<-") { o.stdin = r.quoted ? r.body : expandHeredoc(sess, r.body); o.pipedIn = true; continue; }
      if (r.op === "<<<") { o.stdin = expandString(sess, r.target) + "\n"; o.pipedIn = true; continue; }
      if (r.op === ">&" || r.op === "<&") {
        if (r.dup === "1") { if (fd === 2) o.err = o.out; }
        else if (r.dup === "2") { if (fd === 1) o.out = o.err; }
        else if (r.dup === "-") { if (fd === 1) o.out = function () {}; if (fd === 2) o.err = function () {}; }
        else if (r.target !== undefined) { r = { fd: null, op: "&>", target: r.target }; } else continue;
        if (r.op !== "&>") continue;
      }
      var fields = expandWord(sess, r.target);
      if (fields.length !== 1) throw new ShError("bash: " + r.target + ": ambiguous redirect", 1);
      var target = fields[0];
      if (r.op === "<") {
        var rf = readFile(sess, target);
        if (rf.error) throw new ShError("bash: " + target + ": " + ERRTEXT[rf.error], 1);
        if (fd === 0) { o.stdin = rf.content; o.pipedIn = true; }
        continue;
      }
      var append = r.op === ">>" || r.op === "&>>";
      var path = absPath(sess, target);
      if (path === "/dev/null") { var sink = function () {}; if (r.op === "&>" || r.op === "&>>") { o.out = sink; o.err = sink; } else if (fd === 2) o.err = sink; else o.out = sink; continue; }
      if (path === "/dev/stderr") { if (fd === 1) o.out = io.err; continue; }
      if (path === "/dev/stdout") { if (fd === 2) o.err = io.out; continue; }
      var e = writeFile(sess, target, "", append);
      if (e) throw new ShError("bash: " + target + ": " + ERRTEXT[e], 1);
      var writer = (function (p) { return function (t) { var x = writeFile(sess, p, t, true); if (x) throw new ShError("bash: " + p + ": " + ERRTEXT[x], 1); }; })(path);
      files.push(path);
      if (r.op === "&>" || r.op === "&>>") { o.out = writer; o.err = writer; }
      else if (fd === 2) o.err = writer; else o.out = writer;
      if (fd === 1 || r.op.charAt(0) === "&") o.tty = false;
    }
    return o;
  }
  function withRedirs(sess, redirs, io, fn) {
    if (!redirs.length) return fn(io);
    var io2;
    try { io2 = openRedirs(sess, redirs, io); }
    catch (e) { if (e instanceof ShError) { io.err(e.message + "\n"); return e.code; } throw e; }
    return fn(io2);
  }

  function execSimple(sess, node, io) {
    // Alias expansion of the first word (interactive shells; also in scripts when expand_aliases).
    var words = node.words;
    if (words.length && sess.aliases[words[0]] && !sess.noAlias) {
      var src = sess.aliases[words[0]] + " " + words.slice(1).join(" ");
      sess.noAlias = true;
      try {
        var ast = parse(src);
        var item = ast.items[0] && ast.items[0].node;
        if (item && item.t === "simple" && ast.items.length === 1) { item.redirs = item.redirs.concat(node.redirs); item.assigns = node.assigns.concat(item.assigns); return execSimple(sess, item, io); }
        return withRedirs(sess, node.redirs, io, function (io2) { return execList(sess, ast, io2); });
      } finally { sess.noAlias = false; }
    }
    var args = [];
    var xe;
    try { words.forEach(function (w) { expandWord(sess, w).forEach(function (x) { args.push(x); }); }); }
    catch (e) { if (e instanceof ShError) { io.err(e.message + "\n"); return e.code; } throw e; }
    var assigns = [];
    try {
      node.assigns.forEach(function (a) {
        var m = /^([A-Za-z_][A-Za-z0-9_]*)(\+?)=([\s\S]*)$/.exec(a);
        assigns.push({ name: m[1], append: m[2] === "+", value: expandString(sess, m[3]) });
      });
    } catch (e) { if (e instanceof ShError) { io.err(e.message + "\n"); return e.code; } throw e; }
    if (!args.length) {
      assigns.forEach(function (a) { setVar(sess, a.name, a.append ? (lookupVar(sess, a.name) || "") + a.value : a.value); });
      if (node.redirs.length) return withRedirs(sess, node.redirs, io, function () { return 0; });
      return sess.lastExitFromSubst !== undefined ? 0 : 0;
    }
    if (sess.opts.xtrace) io.err("+ " + args.join(" ") + "\n");
    return withRedirs(sess, node.redirs, io, function (io2) {
      // VAR=x cmd: the assignments only apply to that command's environment.
      var saved = {};
      assigns.forEach(function (a) { saved[a.name] = sess.vars[a.name]; setVar(sess, a.name, a.value, true); });
      try { return runCommand(sess, args, io2); }
      finally { assigns.forEach(function (a) { if (saved[a.name]) sess.vars[a.name] = saved[a.name]; else delete sess.vars[a.name]; }); }
    });
  }

  // Resolve and run a command by name: function, builtin, then $PATH (binaries and scripts).
  function runCommand(sess, args, io) {
    var name = args[0];
    sess.curIO = io;
    if (sess.functions[name]) return callFunction(sess, name, args.slice(1), io);
    if (BUILTINS[name]) {
      try { return BUILTINS[name](args, io, sess); }
      catch (e) { if (e instanceof ShError) { io.err(e.message + "\n"); return e.code; } throw e; }
    }
    var found = resolveCommand(sess, name);
    if (found.error) {
      io.err(found.error + "\n");
      return found.code;
    }
    return execFound(sess, found, args, io);
  }
  function execFound(sess, found, args, io) {
    if (found.script) return runScriptFile(sess, found.path, args.slice(1), io, args[0]);
    var impl = CMDS[found.impl];
    if (!impl) { io.err("bash: " + found.path + ": cannot execute binary file: Exec format error\n"); return 126; }
    try { return impl(args, io, sess) || 0; }
    catch (e) {
      if (e instanceof ShError) { io.err(e.message + "\n"); return e.code; }
      throw e;
    }
  }
  function resolveCommand(sess, name) {
    if (name.indexOf("/") >= 0) {
      var r = lookup(sess, name);
      if (r.error === "EACCES") return { error: "bash: " + name + ": Permission denied", code: 126 };
      if (!r.node) return { error: "bash: " + name + ": No such file or directory", code: 127 };
      if (r.node.type === "d") return { error: "bash: " + name + ": Is a directory", code: 126 };
      if (!can(sess, r.node, "x")) return { error: "bash: " + name + ": Permission denied", code: 126 };
      return classify(r.node, r.path);
    }
    var dirs = (lookupVar(sess, "PATH") || "").split(":");
    for (var k = 0; k < dirs.length; k++) {
      if (!dirs[k]) continue;
      var r2 = lookup(sess, dirs[k] + "/" + name);
      if (r2.node && r2.node.type === "f" && can(sess, r2.node, "x")) return classify(r2.node, r2.path);
    }
    return { error: name + ": command not found", code: 127 };
  }
  function classify(node, path) {
    var m = /^\x7fELF:(\S+)/.exec(node.content);
    if (m) return { impl: m[1], path: path };
    return { script: true, path: path };
  }
  function runScriptFile(sess, path, args, io, argv0) {
    var rf = readFile(sess, path);
    if (rf.error) { io.err("bash: " + path + ": " + ERRTEXT[rf.error] + "\n"); return 126; }
    var first = rf.content.split("\n")[0];
    var interp = /^#!\s*(\S+)(?:\s+(\S+))?/.exec(first);
    if (interp && !/(^|\/)(bash|sh|env)$/.test(interp[1])) {
      io.err("bash: " + path + ": " + interp[1] + ": bad interpreter: No such file or directory\n"); return 126;
    }
    var c = childSession(sess);
    c.argv0 = argv0 || path;
    c.positional = args.slice();
    c.isScript = true;
    var code;
    try { code = runSource(c, rf.content, io); }
    catch (e) {
      if (e instanceof ExitSignal) code = e.code;
      else if (e instanceof ParseError) { io.err(path + ": line " + 1 + ": " + e.message.replace(/^bash: /, "") + "\n"); code = 2; }
      else throw e;
    }
    sess.steps = c.steps;
    return code;
  }
  function callFunction(sess, name, args, io) {
    var saved = sess.positional;
    sess.positional = args;
    sess.locals = sess.locals || [];
    sess.locals.push({});
    if (sess.locals.length > 100) throw new ShError("bash: " + name + ": maximum function nesting level exceeded (100)", 1);
    try { return execNode(sess, sess.functions[name], io, false); }
    catch (e) { if (e instanceof ReturnSignal) return e.code; throw e; }
    finally { sess.positional = saved; sess.locals.pop(); }
  }

  /* ---------------- [[ ... ]] */
  function dbracket(sess, words) {
    var pos = 0;
    function peek() { return words[pos]; }
    function next() { return words[pos++]; }
    function str(w) { return expandString(sess, w); }
    function primary() {
      var t = peek();
      if (t === "!") { next(); return !primary(); }
      if (t === "(") { next(); var v = or(); next(); return v; }
      var a = next();
      if (/^-[a-zA-Z]$/.test(a) && pos < words.length && !/^(==|=|!=|=~|<|>|-eq|-ne|-lt|-le|-gt|-ge|&&|\|\|)$/.test(peek())) return unaryTest(sess, a, str(next()));
      var op = peek();
      if (op && /^(==|=|!=|=~|<|>|-eq|-ne|-lt|-le|-gt|-ge|-nt|-ot)$/.test(op)) {
        next();
        var rawB = next(), A = str(a);
        if (op === "==" || op === "=") return globMatch(str(rawB), A);
        if (op === "!=") return !globMatch(str(rawB), A);
        if (op === "=~") { var m = new RegExp(str(rawB)).exec(A); if (m) setVar(sess, "BASH_REMATCH", m[0]); return !!m; }
        return binaryTest(op, A, str(rawB));
      }
      return str(a) !== "";
    }
    function and() { var v = primary(); while (peek() === "&&") { next(); var r = primary(); v = v && r; } return v; }
    function or() { var v = and(); while (peek() === "||") { next(); var r = and(); v = v || r; } return v; }
    return or();
  }
  function unaryTest(sess, op, a) {
    var r = a === "" ? { error: "ENOENT" } : lookup(sess, a, { nofollow: op === "-h" || op === "-L" });
    switch (op) {
      case "-e": case "-a": return !!r.node;
      case "-f": return !!r.node && r.node.type === "f";
      case "-d": return !!r.node && r.node.type === "d";
      case "-h": case "-L": return !!r.node && r.node.type === "l";
      case "-r": return !!r.node && can(sess, r.node, "r");
      case "-w": return !!r.node && can(sess, r.node, "w");
      case "-x": return !!r.node && can(sess, r.node, "x");
      case "-s": return !!r.node && r.node.type === "f" && r.node.content.length > 0;
      case "-z": return a === "";
      case "-n": return a !== "";
      case "-u": return !!r.node && (r.node.mode & 2048) !== 0;
      case "-g": return !!r.node && (r.node.mode & 1024) !== 0;
      case "-k": return !!r.node && (r.node.mode & 512) !== 0;
      case "-O": return !!r.node && r.node.uid === sess.uid;
    }
    throw new ShError("bash: " + op + ": unary operator expected", 2);
  }
  function binaryTest(op, a, b) {
    if (/^-(eq|ne|lt|le|gt|ge)$/.test(op)) {
      if (!/^\s*-?\d+\s*$/.test(a)) throw new ShError("bash: [: " + a + ": integer expression expected", 2);
      if (!/^\s*-?\d+\s*$/.test(b)) throw new ShError("bash: [: " + b + ": integer expression expected", 2);
      var x = +a, y = +b;
      return { "-eq": x === y, "-ne": x !== y, "-lt": x < y, "-le": x <= y, "-gt": x > y, "-ge": x >= y }[op];
    }
    if (op === "<") return a < b;
    if (op === ">") return a > b;
    return false;
  }

  /* ================================================================== The machine kc-web-01 */
  function mkdirs(sys, path, mode, uid, gid) {
    var n = sys.root;
    splitPath(path).forEach(function (seg) {
      if (!n.children[seg]) n.children[seg] = dirNode(mode == null ? 493 : mode, uid || 0, gid || 0);
      n = n.children[seg];
    });
    return n;
  }
  function put(sys, path, content, mode, uid, gid, mtime) {
    var dir = path.slice(0, path.lastIndexOf("/")) || "/", name = path.slice(path.lastIndexOf("/") + 1);
    var d = mkdirs(sys, dir);
    d.children[name] = fileNode(content, mode == null ? 420 : mode, uid || 0, gid || 0, mtime);
    return d.children[name];
  }
  var SYS_HOOKS = [];
  function makeSystem(opts) {
    opts = opts || {};
    var sys = { host: "kc-web-01", now: NOW, root: dirNode(493, 0, 0, NOW - 400 * DAY), pidSeq: 0, actions: [], seed: 7 };
    SYS_HOOKS.forEach(function (h) { h(sys, opts); });
    // Lab files: relative paths go in /home/dev; values are text or {content, mode, owner, group, ageDays}.
    var home = "/home/dev";
    Object.keys(opts.files || {}).forEach(function (k) {
      var v = opts.files[k];
      var path = k.charAt(0) === "/" ? k : home + "/" + k;
      if (v && typeof v === "object" && v.dir) {
        var dn = mkdirs(sys, path, v.mode, uidOf(sys, v.owner || "dev"), gidOf(sys, v.group || v.owner || "dev"));
        dn.mode = v.mode == null ? 493 : v.mode; dn.uid = uidOf(sys, v.owner || "dev"); dn.gid = gidOf(sys, v.group || v.owner || "dev");
        return;
      }
      var content = v && typeof v === "object" ? v.content : v;
      var owner = v && typeof v === "object" && v.owner ? v.owner : path.indexOf(home + "/") === 0 ? "dev" : "root";
      var group = v && typeof v === "object" && v.group ? v.group : owner;
      var mode = v && typeof v === "object" && v.mode != null ? v.mode : 436;
      var mt = v && typeof v === "object" && v.ageDays != null ? NOW - v.ageDays * DAY : v && typeof v === "object" && v.mtime ? v.mtime : NOW - 2 * DAY;
      // folders created for lab files belong to dev when they're inside the home
      var dirPath = path.slice(0, path.lastIndexOf("/"));
      if (dirPath.indexOf(home) === 0) { var cur = home; splitPath(dirPath.slice(home.length)).forEach(function (seg) { cur += "/" + seg; mkdirs(sys, cur, 509, 1000, 1000); }); }
      put(sys, path, content, mode, uidOf(sys, owner), gidOf(sys, group), mt);
    });
    if (opts.system) opts.system(sys);
    return sys;
  }
  function uidOf(sys, name) { var u = userByName(sys, name); return u ? u.uid : 0; }
  function gidOf(sys, name) { var g = groupByName(sys, name); return g ? g.gid : 0; }

  /* ================================================================== Running a line (the terminal) */
  function prompt(sess) {
    var home = sess.home, cwd = sess.cwd;
    var w = cwd === home ? "~" : cwd.indexOf(home + "/") === 0 ? "~" + cwd.slice(home.length) : cwd;
    return sess.user + "@" + sess.sys.host + ":" + w + (sess.uid === 0 ? "#" : "$");
  }
  // Run one line typed at the prompt. Output goes to sess.term.
  function runLine(sess, line) {
    sess.term = [];
    sess.histLines.push(line);
    var shell = sess.userStack.length ? sess.userStack[sess.userStack.length - 1].shell : sess;
    var io = { stdin: null, out: function (t) { termWrite(sess, t, false); }, err: function (t) { termWrite(sess, t, true); }, note: function (t) { termWrite(sess, t, "sys"); }, tty: true };
    var code;
    sess.cleared = false;
    try {
      shell.term = sess.term;
      code = runSource(shell, line, io);
    } catch (e) {
      if (e instanceof ParseError) { termWrite(sess, e.message + "\n", true); code = 2; }
      else if (e instanceof ExitSignal) {
        code = e.code;
        if (sess.userStack.length) sess.userStack.pop(); // leave a sudo -i / su shell
        else termWrite(sess, "logout\n(This lab's terminal stays open.)\n", false);
      }
      else if (e instanceof StepLimit) { termWrite(sess, "^C\n(Stopped: the command ran too long. An endless loop?)\n", true); code = 130; }
      else if (e instanceof ShError) { termWrite(sess, e.message + "\n", true); code = e.code; }
      else if (e instanceof ReturnSignal || e instanceof BreakSignal || e instanceof ContinueSignal) { code = 0; }
      else throw e;
    }
    shell.lastExit = code;
    sess.lastExit = code;
    return { code: code, lines: termLines(sess.term), clear: !!sess.cleared };
  }
  // A login shell reads ~/.bashrc (through ~/.profile): aliases like ll come from there.
  function login(sess) {
    var quiet = { stdin: null, out: function () {}, err: function () {}, tty: true };
    try { if (readFile(sess, sess.home + "/.bashrc").content !== undefined) runSource(sess, ". " + sess.home + "/.bashrc", quiet); } catch (e) { /* a broken .bashrc doesn't stop the login */ }
    sess.lastExit = 0;
  }
  // The shell currently at the prompt (after sudo -i, the root shell).
  function activeShell(sess) { return sess.userStack.length ? sess.userStack[sess.userStack.length - 1].shell : sess; }

  var api = {
    NOW: NOW, DAY: DAY, ShError: ShError, ExitSignal: ExitSignal, ReturnSignal: ReturnSignal, BreakSignal: BreakSignal, ContinueSignal: ContinueSignal, ParseError: ParseError,
    CMDS: CMDS, BUILTINS: BUILTINS, SYS_HOOKS: SYS_HOOKS, ERRTEXT: ERRTEXT,
    dirNode: dirNode, fileNode: fileNode, linkNode: linkNode, mkdirs: mkdirs, put: put, makeSystem: makeSystem, newSession: newSession, childSession: childSession, subshell: subshell,
    lookup: lookup, can: can, writeFile: writeFile, readFile: readFile, absPath: absPath, normAbs: normAbs, splitPath: splitPath,
    passwd: passwd, groups: groups, userByName: userByName, userById: userById, groupByName: groupByName, groupById: groupById, uname: uname, gname: gname, supplementary: supplementary, setUser: setUser,
    getVar: lookupVar, setVar: setVar, exportedEnv: exportedEnv, parse: parse, runSource: runSource, runLine: runLine, runCommand: runCommand, runScriptFile: runScriptFile, resolveCommand: resolveCommand, execFound: execFound,
    expandWord: expandWord, expandString: expandString, glob: glob, globMatch: globMatch, globRegexSrc: globRegexSrc, sortNames: sortNames, arith: arith,
    login: login, unaryTest: unaryTest, binaryTest: binaryTest, termLines: termLines, termWrite: termWrite, prompt: prompt, activeShell: activeShell, step: step, readSys: readSys, uidOf: uidOf, gidOf: gidOf
  };
  root.ShEngine = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
