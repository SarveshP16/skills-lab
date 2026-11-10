/* sudo learn — a small PowerShell engine (a teaching subset of PowerShell 7), in plain JavaScript.
   Parser + runtime + values + Out-Default formatting. Cmdlets live in ps-cmdlets.js, lab glue in ps-lab.js.
   Works in the browser (window.PSEngine) and in Node (module.exports) for headless tests.

   Values: string, number, boolean, null, Array (PowerShell array), PSHashtable, PSObject (custom + typed
   pretend objects), PSDate, PSTimeSpan, ScriptBlock, PSType. Names (variables, functions, properties,
   hashtable keys) are case-insensitive, as in PowerShell. */
(function (root) {
  "use strict";

  /* ================================================================== Errors and signals */
  function PSError(message, opts) {
    opts = opts || {};
    this.message = message;
    this.category = opts.category || "RuntimeException";
    this.command = opts.command || null;
    this.line = opts.line || null;
    this.scriptTerminating = !!opts.scriptTerminating;
    this.target = opts.target;
    this.thrown = opts.thrown; // the value given to throw
    // Optional richer error details (web cmdlets, security errors): FullyQualifiedErrorId, exception type/message/properties, ErrorDetails.
    this.errorId = opts.errorId; this.exceptionType = opts.exceptionType; this.exceptionMessage = opts.exceptionMessage;
    this.exceptionProps = opts.exceptionProps; this.details = opts.details;
  }
  PSError.prototype = Object.create(Error.prototype);
  PSError.prototype.constructor = PSError;
  function ParseError(message, line) { this.message = message; this.line = line; this.category = "ParseError"; }
  ParseError.prototype = Object.create(Error.prototype);
  function BreakSignal() {}
  function ContinueSignal() {}
  function ReturnSignal() {}
  function ExitSignal(code) { this.code = code; }
  function StepLimit() {}

  /* ================================================================== Values */
  function lc(s) { return String(s).toLowerCase(); }

  function PSHashtable(ordered) { this.map = new Map(); this.ordered = !!ordered; }
  PSHashtable.prototype.get = function (k) { var e = this.map.get(keyOf(k)); return e ? e.value : null; };
  PSHashtable.prototype.has = function (k) { return this.map.has(keyOf(k)); };
  PSHashtable.prototype.set = function (k, v) {
    var key = keyOf(k), e = this.map.get(key);
    if (e) e.value = v; else this.map.set(key, { key: k, value: v });
  };
  PSHashtable.prototype.remove = function (k) { this.map.delete(keyOf(k)); };
  PSHashtable.prototype.keys = function () { return Array.from(this.map.values()).map(function (e) { return e.key; }); };
  PSHashtable.prototype.values = function () { return Array.from(this.map.values()).map(function (e) { return e.value; }); };
  PSHashtable.prototype.entries = function () { return Array.from(this.map.values()); };
  Object.defineProperty(PSHashtable.prototype, "size", { get: function () { return this.map.size; } });
  function keyOf(k) { return typeof k === "string" ? "s:" + k.toLowerCase() : typeof k === "number" ? "n:" + k : "o:" + toStr(k); }

  // A PowerShell object with ordered note properties. typeName decides how it's displayed.
  function PSObject(typeName) { this.props = []; this.index = new Map(); this.typeName = typeName || "System.Management.Automation.PSCustomObject"; this.methods = null; }
  PSObject.prototype.get = function (n) { var i = this.index.get(lc(n)); return i == null ? undefined : this.props[i].value; };
  PSObject.prototype.has = function (n) { return this.index.has(lc(n)); };
  PSObject.prototype.set = function (n, v) {
    var i = this.index.get(lc(n));
    if (i == null) { this.index.set(lc(n), this.props.length); this.props.push({ name: n, value: v }); }
    else this.props[i].value = v;
    return this;
  };
  PSObject.prototype.names = function () { return this.props.map(function (p) { return p.name; }); };
  function obj(typeName, fields) {
    var o = new PSObject(typeName);
    Object.keys(fields).forEach(function (k) { o.set(k, fields[k]); });
    return o;
  }

  var DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  var MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  // Dates are kept in UTC internally and shown as local wall-clock time, so results never depend on the viewer's time zone.
  function PSDate(ms) { this.ms = ms; }
  PSDate.prototype.d = function () { return new Date(this.ms); };
  function PSTimeSpan(ms) { this.ms = ms; }
  function ScriptBlock(block, text, params) { this.block = block; this.text = text; this.params = params || null; }
  function PSType(name) { this.name = name; }
  function PSVersion(parts) { this.parts = parts; }

  /* ================================================================== Lexing helpers */
  function isNameStart(c) { return /[A-Za-z_]/.test(c || ""); }
  function isNameChar(c) { return /[A-Za-z0-9_]/.test(c || ""); }
  function isWordChar(c) { return c != null && !/[\s|;(){}\[\],"'`$@<>&=+*\/%!#]/.test(c) && c !== ""; }
  var KEYWORDS = { "if": 1, "elseif": 1, "else": 1, "switch": 1, "foreach": 1, "for": 1, "while": 1, "do": 1, "until": 1, "function": 1, "filter": 1,
    "return": 1, "break": 1, "continue": 1, "throw": 1, "try": 1, "catch": 1, "finally": 1, "param": 1, "begin": 1, "process": 1, "end": 1, "exit": 1 };
  var COMPARE_OPS = ["eq", "ne", "gt", "ge", "lt", "le", "like", "notlike", "match", "notmatch", "contains", "notcontains", "in", "notin",
    "replace", "split", "join", "is", "isnot", "as"];
  var CASE_PREFIX = /^(c|i)(eq|ne|gt|ge|lt|le|like|notlike|match|notmatch|contains|notcontains|in|notin|replace|split)$/;
  var MULT = { kb: 1024, mb: 1048576, gb: 1073741824, tb: 1099511627776 };

  /* ================================================================== Parser */
  function Parser(src) { this.s = src.replace(/\r\n?/g, "\n"); this.i = 0; }
  var P = Parser.prototype;
  P.c = function (o) { return this.s.charAt(this.i + (o || 0)); };
  P.line = function (at) { var n = 1, end = at == null ? this.i : at; for (var k = 0; k < end; k++) if (this.s.charCodeAt(k) === 10) n++; return n; };
  P.err = function (msg, at) { throw new ParseError(msg, this.line(at)); };
  P.eof = function () { return this.i >= this.s.length; };
  // Skip spaces, comments and backtick line continuations; newlines too when nl is true.
  P.ws = function (nl) {
    for (;;) {
      var c = this.c();
      if (c === " " || c === "\t") { this.i++; continue; }
      if (c === "`" && this.c(1) === "\n") { this.i += 2; continue; }
      if (c === "<" && this.c(1) === "#") {
        var e = this.s.indexOf("#>", this.i + 2);
        this.i = e < 0 ? this.s.length : e + 2; continue;
      }
      if (c === "#") { while (!this.eof() && this.c() !== "\n") this.i++; continue; }
      if (nl && (c === "\n" || c === ";" && nl === 2)) { this.i++; continue; }
      if (nl && c === "\n") { this.i++; continue; }
      break;
    }
  };
  P.word = function () { // a name-like word at the cursor (no move)
    var m = /^[A-Za-z_][A-Za-z0-9_-]*/.exec(this.s.slice(this.i, this.i + 64));
    return m ? m[0] : "";
  };
  P.kw = function (w) { // is the keyword w at the cursor (followed by a non-word char)?
    var s = this.s.substr(this.i, w.length);
    if (lc(s) !== w) return false;
    var n = this.s.charAt(this.i + w.length);
    return !/[A-Za-z0-9_-]/.test(n);
  };
  P.eat = function (str) { if (this.s.substr(this.i, str.length) === str) { this.i += str.length; return true; } return false; };
  P.expect = function (str, what) {
    this.ws(true);
    if (!this.eat(str)) this.err("Missing '" + str + "'" + (what ? " " + what : "") + ".");
  };

  P.parseScript = function () {
    var stmts = this.statements(null);
    this.ws(true);
    if (!this.eof()) this.err("Unexpected token '" + this.c() + "'.");
    return { t: "block", stmts: stmts };
  };
  // Statements until a closing char (or end of input).
  P.statements = function (close) {
    var prevNC = this.noComma;
    this.noComma = false; // commas mean arrays again inside nested blocks, even within method arguments
    try { return this.statementsInner(close); } finally { this.noComma = prevNC; }
  };
  P.statementsInner = function (close) {
    var out = [];
    for (;;) {
      this.ws(true);
      while (this.c() === ";") { this.i++; this.ws(true); }
      if (this.eof()) { if (close) this.err("Missing closing '" + close + "' in statement block."); break; }
      if (close && this.c() === close) break;
      var st = this.statement();
      if (st) out.push(st);
      this.ws(false);
      var c = this.c();
      if (c === "\n" || c === ";") { this.i++; continue; }
      if (this.eof() || c === close) continue;
      if (c === "}" || c === ")") this.err("Unexpected token '" + c + "' in expression or statement.");
      this.err("Unexpected token '" + this.s.slice(this.i, this.i + 12).split("\n")[0] + "' in expression or statement.");
    }
    return out;
  };
  P.block = function () {
    this.ws(true);
    var start = this.i;
    if (!this.eat("{")) this.err("Missing '{' to start a block.");
    var stmts = this.statements("}");
    this.i++;
    return { t: "block", stmts: stmts, line: this.line(start) };
  };
  P.cond = function () {
    this.ws(true);
    if (!this.eat("(")) this.err("Missing '(' after the keyword.");
    this.ws(true);
    var p = this.pipelineOrStatement();
    this.ws(true);
    if (!this.eat(")")) this.err("Missing closing ')' after the condition.");
    return p;
  };

  P.statement = function () {
    var at = this.i, line = this.line();
    var w = lc(this.word());
    if (w && KEYWORDS[w] && this.kw(w)) {
      var st = this.keywordStatement(w, line);
      if (st) { st.line = st.line || line; return st; }
      this.i = at;
    }
    if (this.c() === "[" && /^\[cmdletbinding/i.test(this.s.slice(this.i, this.i + 15))) {
      // [CmdletBinding()] at the top of a script belongs to the param() block that follows it.
      this.attributeList();
      this.ws(true);
      var nx = this.statement();
      if (nx && nx.t === "param") nx.binding = true;
      return nx;
    }
    return this.pipelineStatement();
  };

  P.keywordStatement = function (w, line) {
    var self = this;
    function after() { self.i += w.length; }
    if (w === "if") {
      after();
      var clauses = [{ cond: this.cond(), body: this.block() }], els = null;
      for (;;) {
        var save = this.i;
        this.ws(true);
        if (this.kw("elseif")) { this.i += 6; clauses.push({ cond: this.cond(), body: this.block() }); continue; }
        if (this.kw("else")) { this.i += 4; els = this.block(); }
        else this.i = save;
        break;
      }
      return { t: "if", clauses: clauses, els: els, line: line };
    }
    if (w === "while") { after(); return { t: "while", cond: this.cond(), body: this.block(), line: line }; }
    if (w === "do") {
      after();
      var body = this.block();
      this.ws(true);
      var until = this.kw("until");
      if (!until && !this.kw("while")) this.err("Missing 'while' or 'until' after the do block.");
      this.i += until ? 5 : 5;
      return { t: "do", body: body, cond: this.cond(), until: until, line: line };
    }
    if (w === "for") {
      after();
      this.ws(true);
      if (!this.eat("(")) this.err("Missing '(' after 'for'.");
      var parts = [null, null, null];
      for (var k = 0; k < 3; k++) {
        this.ws(true);
        if (this.c() !== (k < 2 ? ";" : ")")) parts[k] = this.statement();
        this.ws(true);
        if (k < 2 && !this.eat(";")) this.err("Missing ';' in the for loop (for (init; condition; step)).");
      }
      if (!this.eat(")")) this.err("Missing closing ')' in the for loop.");
      return { t: "for", init: parts[0], cond: parts[1], step: parts[2], body: this.block(), line: line };
    }
    if (w === "foreach") {
      var save = this.i;
      after();
      this.ws(false);
      if (this.c() !== "(") { this.i = save; return null; }
      this.i++;
      this.ws(true);
      if (this.c() !== "$") this.err("Missing variable name after foreach (.");
      var v = this.variable();
      this.ws(true);
      if (!this.kw("in")) this.err("Missing 'in' after the variable in foreach.");
      this.i += 2;
      this.ws(true);
      var coll = this.pipelineOrStatement();
      this.ws(true);
      if (!this.eat(")")) this.err("Missing closing ')' after foreach.");
      return { t: "foreach", v: v, coll: coll, body: this.block(), line: line };
    }
    if (w === "switch") {
      after();
      var flags = {};
      for (;;) {
        this.ws(false);
        if (this.c() === "-" && isNameStart(this.c(1))) {
          this.i++;
          var f = lc(this.word());
          this.i += f.length;
          flags[f] = true;
          continue;
        }
        break;
      }
      var subject = this.cond();
      this.ws(true);
      if (!this.eat("{")) this.err("Missing '{' after switch (...).");
      var cases = [];
      for (;;) {
        this.ws(2);
        if (this.eat("}")) break;
        if (this.eof()) this.err("Missing closing '}' in switch.");
        var pat;
        if (this.kw("default")) { this.i += 7; pat = "default"; }
        else pat = this.argValue(true);
        cases.push({ pat: pat, body: this.block() });
      }
      return { t: "switch", flags: flags, subject: subject, cases: cases, line: line };
    }
    if (w === "function" || w === "filter") {
      after();
      this.ws(false);
      var name = "";
      while (!this.eof() && /[A-Za-z0-9_\-:.]/.test(this.c())) name += this.s.charAt(this.i++);
      if (!name) this.err("Missing name after 'function'.");
      this.ws(true);
      var params = null;
      if (this.c() === "(") { this.i++; params = this.paramList(")"); }
      this.ws(true);
      var bstart = this.i;
      if (!this.eat("{")) this.err("Missing '{' after function " + name + ".");
      var fb = this.functionBody();
      var text = this.s.slice(bstart, this.i);
      if (params) fb.params = params;
      if (w === "filter") { fb.process = fb.end; fb.end = null; }
      return { t: "function", name: name, def: fb, text: text, line: line };
    }
    if (w === "return" || w === "throw" || w === "exit") {
      after();
      this.ws(false);
      var val = null;
      if (!this.eof() && !/[\n;})]/.test(this.c())) val = this.pipelineOrStatement();
      return { t: w, val: val, line: line };
    }
    if (w === "break" || w === "continue") { after(); return { t: w, line: line }; }
    if (w === "try") {
      after();
      var tb = this.block(), catches = [], fin = null;
      for (;;) {
        var s2 = this.i;
        this.ws(true);
        if (this.kw("catch")) {
          this.i += 5;
          var types = [];
          for (;;) {
            this.ws(true);
            if (this.c() === "[") { types.push(this.typeName()); this.ws(true); this.eat(","); continue; }
            break;
          }
          catches.push({ types: types, body: this.block() });
          continue;
        }
        if (this.kw("finally")) { this.i += 7; fin = this.block(); break; }
        this.i = s2;
        break;
      }
      if (!catches.length && !fin) this.err("The try statement is missing its catch or finally block.");
      return { t: "try", body: tb, catches: catches, fin: fin, line: line };
    }
    if (w === "param") {
      after();
      this.ws(true);
      if (!this.eat("(")) this.err("Missing '(' after param.");
      return { t: "param", params: this.paramList(")"), line: line };
    }
    return null; // begin/process/end/else etc. outside their context: treat as commands
  };

  // Function body: [CmdletBinding()] param(...) then either plain statements or begin/process/end blocks.
  P.functionBody = function () {
    var def = { params: null, binding: null, begin: null, process: null, end: null };
    this.ws(true);
    if (this.c() === "[") {
      var save = this.i;
      var attrs = this.attributeList();
      var cb = attrs.filter(function (a) { return lc(a.name) === "cmdletbinding"; })[0];
      if (cb) def.binding = cb.args; else this.i = save;
    }
    this.ws(true);
    if (this.kw("param")) {
      this.i += 5;
      this.ws(true);
      if (!this.eat("(")) this.err("Missing '(' after param.");
      def.params = this.paramList(")");
    }
    this.ws(true);
    var named = false;
    for (;;) {
      this.ws(true);
      var w = lc(this.word());
      if ((w === "begin" || w === "process" || w === "end") && this.kw(w)) {
        var save2 = this.i;
        this.i += w.length;
        this.ws(true);
        if (this.c() === "{") { def[w] = this.block(); named = true; continue; }
        this.i = save2;
      }
      break;
    }
    if (named) {
      this.ws(true);
      if (!this.eat("}")) this.err("Only begin, process and end blocks can follow each other in a function.");
      return def;
    }
    var stmts = this.statements("}");
    this.i++;
    def.end = { t: "block", stmts: stmts };
    return def;
  };

  // [Attr(...)] [Attr2] ... ; returns [{name, args:[{name, value}|{value}]}]
  P.attributeList = function () {
    var list = [];
    for (;;) {
      this.ws(true);
      if (this.c() !== "[") break;
      var save = this.i;
      this.i++;
      this.ws(true);
      var name = "";
      while (!this.eof() && /[A-Za-z0-9_.]/.test(this.c())) name += this.s.charAt(this.i++);
      this.ws(true);
      if (this.c() !== "(") { this.i = save; break; }
      this.i++;
      var args = [];
      for (;;) {
        this.ws(true);
        if (this.eat(")")) break;
        var m = /^([A-Za-z_][A-Za-z0-9_]*)\s*(=)?/.exec(this.s.slice(this.i));
        if (m && (m[2] || /^\s*[,)]/.test(this.s.slice(this.i + m[1].length)))) {
          this.i += m[0].length;
          var val = m[2] ? (this.ws(true), this.noCommaExpr()) : { t: "const", v: true };
          args.push({ name: m[1], value: val });
        } else {
          args.push({ value: this.noCommaExpr() });
        }
        this.ws(true);
        this.eat(",");
      }
      this.ws(true);
      if (!this.eat("]")) this.err("Missing ']' after the attribute.");
      list.push({ name: name, args: args });
    }
    return list;
  };

  // ( [attrs] [type] $name = default, ... )
  P.paramList = function (close) {
    var params = [];
    for (;;) {
      this.ws(true);
      if (this.eat(close)) break;
      if (this.eof()) this.err("Missing ')' at the end of the parameter list.");
      var p = { name: null, type: null, attrs: [], dflt: null };
      for (;;) {
        this.ws(true);
        if (this.c() !== "[") break;
        var save = this.i;
        var attrs = this.attributeList();
        if (attrs.length) { p.attrs = p.attrs.concat(attrs); continue; }
        this.i = save;
        p.type = this.typeName();
      }
      this.ws(true);
      if (this.c() !== "$") this.err("Missing parameter name (a $variable) in the parameter list.");
      p.name = this.variable().name;
      this.ws(true);
      if (this.eat("=")) { this.ws(true); p.dflt = this.noCommaExpr(); }
      params.push(p);
      this.ws(true);
      if (this.eat(",")) continue;
      this.ws(true);
      if (this.eat(close)) break;
      this.err("Missing ',' or ')' in the parameter list.");
    }
    return params;
  };

  P.typeName = function () {
    if (!this.eat("[")) this.err("Missing '['.");
    var name = "";
    var depth = 0;
    while (!this.eof()) {
      var c = this.c();
      if (c === "[") { depth++; name += c; this.i++; continue; }
      if (c === "]") { if (depth === 0) break; depth--; name += c; this.i++; continue; }
      name += c; this.i++;
    }
    if (!this.eat("]")) this.err("Missing ']' after the type name.");
    return name.trim();
  };

  P.pipelineOrStatement = function () {
    var w = lc(this.word());
    if ((w === "if" || w === "switch" || w === "foreach" || w === "for" || w === "while" || w === "do" || w === "try") && this.kw(w)) {
      var st = this.keywordStatement(w, this.line());
      if (st) return { t: "stmtexpr", st: st };
    }
    return this.pipeline();
  };

  // A pipeline, possibly as the right side of an assignment.
  P.pipelineStatement = function () {
    var start = this.i, line = this.line();
    var first = this.pipelineElement();
    this.ws(false);
    var m = /^(=|\+=|-=|\*=|\/=|%=)(?!=)/.exec(this.s.slice(this.i, this.i + 3));
    if (m && first.t !== "cmd" && isLValue(first)) {
      this.i += m[1].length;
      this.ws(true);
      var value = this.pipelineOrStatement();
      return { t: "assign", target: first, op: m[1], value: value, line: line };
    }
    return this.pipelineRest(first, line);
  };
  P.pipeline = function () {
    var line = this.line();
    return this.pipelineRest(this.pipelineElement(), line);
  };
  P.pipelineRest = function (first, line) {
    var elems = [first];
    for (;;) {
      this.ws(false);
      if (this.c() === "|" && this.c(1) !== "|") {
        this.i++;
        this.ws(true);
        var el = this.pipelineElement();
        if (el.t !== "cmd") this.err("Expressions are only allowed as the first element of a pipeline.");
        elems.push(el);
        continue;
      }
      break;
    }
    return { t: "pipeline", elems: elems, line: line };
  };

  P.pipelineElement = function () {
    this.ws(false);
    var c = this.c(), line = this.line();
    if (c === "&" || (c === "." && /[ \t]/.test(this.c(1)))) {
      var dot = c === ".";
      this.i++;
      this.ws(false);
      var target = this.argValue(false);
      return this.commandArgs({ t: "cmd", nameExpr: target, dot: dot, line: line });
    }
    if ((c === "%" || c === "?") && /[\s{]/.test(this.c(1) || " ")) { this.i++; return this.commandArgs({ t: "cmd", name: c, line: line }); }
    if (c === "." && /[\\\/.]/.test(this.c(1) || "")) {
      // A relative path to a script: .\deploy.ps1, ./x.ps1, ..\tools\y.ps1
      var pth = "";
      while (!this.eof() && isWordChar(this.c())) pth += this.s.charAt(this.i++);
      return this.commandArgs({ t: "cmd", name: pth, line: line });
    }
    if (isNameStart(c)) {
      // Keywords were already handled by statement(); here a word is always a command (e.g. "| foreach { }").
      var name = "";
      while (!this.eof() && isWordChar(this.c())) name += this.s.charAt(this.i++);
      return this.commandArgs({ t: "cmd", name: name, line: line });
    }
    return this.expression();
  };

  P.commandArgs = function (cmd) {
    cmd.args = [];
    for (;;) {
      this.ws(false);
      var c = this.c();
      if (this.eof() || /[\n;|)}]/.test(c) || (c === "&" && this.c(1) === "&")) break;
      if (c === "-" && (isNameStart(this.c(1)) || this.c(1) === "-" && false)) {
        this.i++;
        var name = "";
        while (!this.eof() && isNameChar(this.c())) name += this.s.charAt(this.i++);
        if (this.c() === ":" && !/[\s]/.test(this.c(1))) {
          this.i++;
          cmd.args.push({ t: "param", name: name, value: this.argValue(true) });
        } else cmd.args.push({ t: "param", name: name });
        continue;
      }
      if (c === "@" && isNameStart(this.c(1))) { // splatting @params
        this.i++;
        cmd.args.push({ t: "splat", v: this.variableNameOnly() });
        continue;
      }
      cmd.args.push(this.argValue(true));
    }
    return cmd;
  };

  // A command argument: a value in "argument mode" (barewords are strings), with commas making arrays.
  P.argValue = function (allowComma) {
    var items = [this.argAtom()];
    if (allowComma) {
      for (;;) {
        var save = this.i;
        this.ws(false);
        if (this.c() === ",") { this.i++; this.ws(true); items.push(this.argAtom()); continue; }
        this.i = save;
        break;
      }
    }
    return items.length === 1 ? items[0] : { t: "array", items: items };
  };
  P.argAtom = function () {
    var c = this.c();
    if (c === "$") {
      // In argument mode, text glued to a variable joins it: $PSScriptRoot\..\src\x.ps1, $dir\file.txt
      var vnode = this.postfix(this.primary());
      var rest = "";
      while (!this.eof() && !/[\s|;(){},'"`$]/.test(this.c())) rest += this.s.charAt(this.i++);
      return rest ? { t: "xstr", parts: [vnode, rest] } : vnode;
    }
    if (c === "'" || c === "\"" || c === "(" || c === "@" || c === "{" || c === "[") return this.postfix(this.primary());
    if (c === "-" && /[0-9.]/.test(this.c(1))) { this.i++; var n = this.argAtom(); return { t: "un", op: "-", e: n }; }
    var start = this.i, word = "";
    while (!this.eof()) {
      var ch = this.c();
      if (/[\s|;(){},]/.test(ch)) break;
      if (ch === "`" && this.c(1) !== "\n") { word += this.c(1); this.i += 2; continue; }
      if ((ch === "'" || ch === "\"") && word) break;
      word += ch; this.i++;
    }
    if (!word) this.err("Missing an argument.", start);
    var num = parseNumber(word);
    if (num !== null) return { t: "const", v: num };
    return { t: "const", v: word, bare: true };
  };

  /* ---------------- Expressions (precedence from low to high) */
  P.expression = function () { return this.logical(); };
  P.opAhead = function (names) { // -op ahead (case-insensitive, with optional c/i prefix); returns op name or null
    if (this.c() !== "-") return null;
    var m = /^-([A-Za-z]+)/.exec(this.s.slice(this.i, this.i + 16));
    if (!m) return null;
    var op = lc(m[1]), base = op;
    var cm = CASE_PREFIX.exec(op);
    if (cm) base = cm[2];
    if (names.indexOf(base) < 0) return null;
    return { raw: m[0], op: op, base: base };
  };
  P.logical = function () {
    var l = this.comparison();
    for (;;) {
      var save = this.i;
      this.ws(false);
      var o = this.opAhead(["and", "or", "xor"]);
      if (!o) { this.i = save; return l; }
      this.i += o.raw.length;
      this.ws(true);
      l = { t: "bin", op: o.op, l: l, r: this.comparison() };
    }
  };
  P.comparison = function () {
    var l = this.additive();
    for (;;) {
      var save = this.i;
      this.ws(false);
      var o = this.opAhead(COMPARE_OPS);
      if (!o) { this.i = save; return l; }
      this.i += o.raw.length;
      this.ws(true);
      var r;
      if (o.base === "is" || o.base === "isnot" || o.base === "as") r = this.additive();
      else r = this.additive();
      l = { t: "bin", op: o.op, l: l, r: r };
    }
  };
  P.additive = function () {
    var l = this.multiplicative();
    for (;;) {
      var save = this.i;
      this.ws(false);
      var c = this.c();
      if ((c === "+" || c === "-") && this.c(1) !== "=" && this.c(1) !== c && !(c === "-" && isNameStart(this.c(1)))) {
        this.i++;
        this.ws(true);
        l = { t: "bin", op: c, l: l, r: this.multiplicative() };
        continue;
      }
      this.i = save;
      return l;
    }
  };
  P.multiplicative = function () {
    var l = this.format();
    for (;;) {
      var save = this.i;
      this.ws(false);
      var c = this.c();
      if ((c === "*" || c === "/" || c === "%") && this.c(1) !== "=") {
        this.i++;
        this.ws(true);
        l = { t: "bin", op: c, l: l, r: this.format() };
        continue;
      }
      this.i = save;
      return l;
    }
  };
  P.format = function () {
    var l = this.range();
    for (;;) {
      var save = this.i;
      this.ws(false);
      if (this.opAhead(["f"])) {
        this.i += 2;
        this.ws(true);
        l = { t: "bin", op: "f", l: l, r: this.range() };
        continue;
      }
      this.i = save;
      return l;
    }
  };
  P.range = function () {
    var l = this.comma();
    var save = this.i;
    this.ws(false);
    if (this.c() === "." && this.c(1) === ".") {
      this.i += 2;
      this.ws(true);
      return { t: "range", l: l, r: this.comma() };
    }
    this.i = save;
    return l;
  };
  P.comma = function () {
    var first = this.unary();
    var save = this.i;
    this.ws(false);
    if (this.c() !== "," || this.noComma) { this.i = save; return first; }
    var items = [first];
    while (this.c() === ",") {
      this.i++;
      this.ws(true);
      items.push(this.unary());
      save = this.i;
      this.ws(false);
      if (this.c() !== ",") { this.i = save; break; }
    }
    return { t: "array", items: items };
  };
  P.noCommaExpr = function () {
    var prev = this.noComma;
    this.noComma = true;
    try { return this.expression(); } finally { this.noComma = prev; }
  };
  P.unary = function () {
    this.ws(false);
    var c = this.c();
    if (c === "!") { this.i++; this.ws(true); return { t: "un", op: "not", e: this.unary() }; }
    var o = this.opAhead(["not", "split", "join", "bnot"]);
    if (o) { this.i += o.raw.length; this.ws(true); return { t: "un", op: o.base, e: this.unary() }; }
    if (c === "," ) { this.i++; this.ws(true); return { t: "array", items: [this.unary()], unaryComma: true }; }
    if ((c === "+" || c === "-") && (this.c(1) === c)) {
      this.i += 2;
      var tgt = this.unary();
      return { t: "incdec", op: c + c, target: tgt, prefix: true };
    }
    if (c === "-" && !isNameStart(this.c(1))) { this.i++; this.ws(true); return { t: "un", op: "-", e: this.unary() }; }
    if (c === "+" && !isNameStart(this.c(1))) { this.i++; this.ws(true); return this.unary(); }
    if (c === "[") {
      // [type] cast, type literal or [type]::Static
      var save = this.i;
      var tn = this.typeName();
      if (this.c() === ":" && this.c(1) === ":") { this.i = save; return this.postfix(this.primary()); }
      var save2 = this.i;
      this.ws(false);
      var n = this.c();
      if (n && /[$'"(@\[0-9{\-]/.test(n)) {
        if (n === "-" && !/[0-9]/.test(this.c(1))) { this.i = save2; return this.postfix({ t: "type", name: tn }); }
        return { t: "cast", type: tn, e: this.unary() };
      }
      this.i = save2;
      return this.postfix({ t: "type", name: tn });
    }
    var e = this.postfix(this.primary());
    var s3 = this.i;
    if ((this.c() === "+" && this.c(1) === "+") || (this.c() === "-" && this.c(1) === "-" && !isNameStart(this.c(2)))) {
      var op = this.c() + this.c();
      this.i += 2;
      return { t: "incdec", op: op, target: e, prefix: false };
    }
    this.i = s3;
    return e;
  };

  P.postfix = function (e) {
    for (;;) {
      var c = this.c();
      if (c === "." && this.c(1) !== "." && (isNameStart(this.c(1)) || this.c(1) === "$" || this.c(1) === "'" || this.c(1) === "\"")) {
        this.i++;
        e = this.member(e, false);
        continue;
      }
      if (c === ":" && this.c(1) === ":") {
        this.i += 2;
        e = this.member(e, true);
        continue;
      }
      if (c === "[") {
        this.i++;
        this.ws(true);
        var idx = this.expression();
        this.ws(true);
        if (!this.eat("]")) this.err("Missing ']' after the index.");
        e = { t: "index", obj: e, idx: idx };
        continue;
      }
      return e;
    }
  };
  P.member = function (e, isStatic) {
    var name;
    if (this.c() === "$") name = this.primary();
    else if (this.c() === "'" || this.c() === "\"") name = this.primary();
    else {
      var n = "";
      while (!this.eof() && isNameChar(this.c())) n += this.s.charAt(this.i++);
      name = n;
    }
    if (this.c() === "(") {
      this.i++;
      var args = [];
      for (;;) {
        this.ws(true);
        if (this.eat(")")) break;
        args.push(this.noCommaExpr());
        this.ws(true);
        if (this.eat(",")) continue;
        this.ws(true);
        if (this.eat(")")) break;
        this.err("Missing ')' in the method call.");
      }
      return { t: "invoke", obj: e, name: name, args: args, isStatic: isStatic };
    }
    return { t: "member", obj: e, name: name, isStatic: isStatic };
  };

  P.primary = function () {
    this.ws(false);
    var c = this.c(), start = this.i;
    if (c === "$") {
      if (this.c(1) === "(") {
        this.i += 2;
        var stmts = this.statements(")");
        this.i++;
        return { t: "subexpr", block: { t: "block", stmts: stmts } };
      }
      return this.variable();
    }
    if (c === "'") return { t: "const", v: this.singleQuoted() };
    if (c === "\"") return this.doubleQuoted();
    if (c === "@") {
      var n1 = this.c(1);
      if (n1 === "(") {
        this.i += 2;
        var st = this.statements(")");
        this.i++;
        return { t: "arrayexpr", block: { t: "block", stmts: st } };
      }
      if (n1 === "{") { this.i += 2; return this.hashLiteral(); }
      if (n1 === "\"" || n1 === "'") return this.hereString();
      this.err("Unrecognized token after '@'.");
    }
    if (c === "(") {
      this.i++;
      this.ws(true);
      if (this.c() === ")") { this.i++; return { t: "const", v: null }; }
      var p = this.pipelineOrStatementInParens();
      this.ws(true);
      if (!this.eat(")")) this.err("Missing closing ')' in expression.");
      return { t: "paren", p: p };
    }
    if (c === "{") return this.scriptBlockLiteral();
    if (c === "[") { var tn = this.typeName(); return { t: "type", name: tn }; }
    if (/[0-9]/.test(c) || (c === "." && /[0-9]/.test(this.c(1)))) {
      var m = /^(0x[0-9a-fA-F]+|[0-9]*\.?[0-9]+(?:[eE][+-]?[0-9]+)?)(kb|mb|gb|tb)?(?![A-Za-z0-9_])/i.exec(this.s.slice(this.i));
      if (!m) this.err("Bad number.");
      this.i += m[0].length;
      var v = m[1].slice(0, 2).toLowerCase() === "0x" ? parseInt(m[1], 16) : parseFloat(m[1]);
      if (m[2]) v *= MULT[m[2].toLowerCase()];
      return { t: "const", v: v, dbl: /\./.test(m[1]) };
    }
    if (isNameStart(c)) {
      var w = this.word();
      // A bare word in an expression: PowerShell would read it as a command. Give a clearer message.
      this.err("Unexpected token '" + w + "'. In an expression, text needs quotes: '" + w + "'. To run a command here, wrap it in parentheses: (" + w + " ...).");
    }
    if (this.eof()) this.err("The expression is incomplete: something is missing at the end.");
    this.err("Unexpected token '" + c + "' in expression.", start);
  };
  P.pipelineOrStatementInParens = function () {
    var prevNC = this.noComma;
    this.noComma = false;
    try { return this.parensInner(); } finally { this.noComma = prevNC; }
  };
  P.parensInner = function () {
    var w = lc(this.word());
    if (w && KEYWORDS[w] && this.kw(w)) { var st = this.keywordStatement(w, this.line()); if (st) return { t: "stmtexpr", st: st }; }
    var first = this.pipelineElement();
    this.ws(true);
    var m = /^(=|\+=|-=|\*=|\/=)(?!=)/.exec(this.s.slice(this.i, this.i + 3));
    if (m && first.t !== "cmd" && isLValue(first)) {
      this.i += m[1].length;
      this.ws(true);
      return { t: "assignexpr", a: { t: "assign", target: first, op: m[1], value: this.pipelineOrStatement() } };
    }
    return this.pipelineRest(first, this.line());
  };

  P.variable = function () {
    var at = this.i;
    this.i++; // $
    var c = this.c();
    if (c === "{") {
      var e = this.s.indexOf("}", this.i);
      if (e < 0) this.err("Missing '}' after ${.");
      var full = this.s.slice(this.i + 1, e);
      this.i = e + 1;
      return splitScope(full);
    }
    if (c === "_" && !isNameChar(this.c(1))) { this.i++; return { t: "var", name: "_" }; }
    if (c === "?" || c === "^" || c === "$") { this.i++; return { t: "var", name: c }; }
    var name = "";
    while (!this.eof() && isNameChar(this.c())) name += this.s.charAt(this.i++);
    if (!name) this.err("A '$' was not followed by a valid variable name. If you meant a literal $, use single quotes or escape it as `$.", at);
    if (this.c() === ":" && this.c(1) !== ":") {
      if (isNameStart(this.c(1)) || /[0-9]/.test(this.c(1))) {
        this.i++;
        var rest = "";
        while (!this.eof() && (isNameChar(this.c()) || this.c() === "-" && lc(name) === "env")) rest += this.s.charAt(this.i++);
        return splitScope(name + ":" + rest);
      }
      this.err("Variable reference is not valid. ':' was not followed by a valid variable name character. Consider using ${} to delimit the name.", at);
    }
    return { t: "var", name: name };
  };
  P.variableNameOnly = function () { var n = ""; while (!this.eof() && isNameChar(this.c())) n += this.s.charAt(this.i++); return n; };

  P.singleQuoted = function () {
    this.i++;
    var out = "";
    for (;;) {
      if (this.eof()) this.err("The string is missing the terminator: '.");
      var c = this.c();
      if (c === "'" || c === "‘" || c === "’") {
        if (this.c(1) === "'") { out += "'"; this.i += 2; continue; }
        this.i++;
        return out;
      }
      out += c; this.i++;
    }
  };
  P.doubleQuoted = function () {
    var start = this.i;
    this.i++;
    var parts = [], buf = "";
    for (;;) {
      if (this.eof()) this.err("The string is missing the terminator: \".", start);
      var c = this.c();
      if (c === "\"") {
        if (this.c(1) === "\"") { buf += "\""; this.i += 2; continue; }
        this.i++;
        break;
      }
      if (c === "`") { buf += backtick(this.c(1)); this.i += 2; continue; }
      if (c === "$") {
        var n = this.c(1);
        if (n === "(") {
          if (buf) { parts.push(buf); buf = ""; }
          this.i += 2;
          var stmts = this.statements(")");
          this.i++;
          parts.push({ t: "subexpr", block: { t: "block", stmts: stmts } });
          continue;
        }
        if (isNameStart(n) || /[0-9]/.test(n) || n === "{" || n === "_") {
          if (buf) { parts.push(buf); buf = ""; }
          parts.push(this.variable());
          continue;
        }
      }
      buf += c; this.i++;
    }
    if (buf) parts.push(buf);
    if (!parts.length) return { t: "const", v: "" };
    if (parts.length === 1 && typeof parts[0] === "string") return { t: "const", v: parts[0] };
    return { t: "xstr", parts: parts };
  };
  P.hereString = function () {
    var q = this.c(1);
    var startLine = this.line();
    this.i += 2;
    while (this.c() === " " || this.c() === "\t") this.i++;
    if (this.c() !== "\n") this.err("A here-string's opening @" + q + " must be the last thing on its line.");
    this.i++;
    var endRe = new RegExp("\\n" + (q === "\"" ? "\"" : "'") + "@");
    var rest = this.s.slice(this.i);
    var m = endRe.exec("\n" + rest);
    if (!m) this.err("The here-string is missing its terminator: " + q + "@ at the start of a line.", this.i);
    var body = rest.slice(0, Math.max(0, m.index - 1));
    if (m.index === 0) body = "";
    this.i += (m.index - 1) + m[0].length;
    if (q === "'") return { t: "const", v: body };
    var sub = new Parser("\"" + body.replace(/"/g, "\"\"") + "\"");
    var node = sub.doubleQuoted();
    return node;
  };
  P.hashLiteral = function () {
    var prevNC = this.noComma;
    this.noComma = false;
    try { return this.hashInner(); } finally { this.noComma = prevNC; }
  };
  P.hashInner = function () {
    var entries = [];
    for (;;) {
      this.ws(2);
      if (this.eat("}")) break;
      if (this.eof()) this.err("Missing closing '}' in the hashtable literal.");
      var key;
      var c = this.c();
      if (c === "'" || c === "\"") key = this.primary();
      else if (c === "(") key = this.primary();
      else if (c === "$") key = this.postfix(this.primary());
      else {
        var k = "";
        while (!this.eof() && /[A-Za-z0-9_\-.]/.test(this.c())) k += this.s.charAt(this.i++);
        if (!k) this.err("Missing a key in the hashtable literal.");
        var num = parseNumber(k);
        key = { t: "const", v: num !== null ? num : k };
      }
      this.ws(false);
      if (!this.eat("=")) this.err("Missing '=' after a key in the hashtable literal (@{ Key = Value }).");
      this.ws(true);
      var val = this.pipelineOrStatement();
      entries.push([key, val]);
      this.ws(false);
      if (this.c() === ";" || this.c() === "\n") { this.i++; continue; }
      this.ws(true);
      if (this.eat("}")) break;
      this.err("Missing ';' or a new line between hashtable entries.");
    }
    return { t: "hash", entries: entries };
  };
  P.scriptBlockLiteral = function () {
    var start = this.i;
    this.i++;
    this.ws(true);
    var params = null;
    if (this.kw("param")) {
      this.i += 5;
      this.ws(true);
      if (!this.eat("(")) this.err("Missing '(' after param.");
      params = this.paramList(")");
    }
    var stmts = this.statements("}");
    this.i++;
    var text = this.s.slice(start + 1, this.i - 1);
    return { t: "sblit", block: { t: "block", stmts: stmts }, text: text, params: params };
  };

  function splitScope(full) {
    var m = /^(global|script|local|private|env|variable|using):(.*)$/i.exec(full);
    if (m) return { t: "var", scope: lc(m[1]), name: m[2] };
    return { t: "var", name: full };
  }
  function backtick(c) {
    return { n: "\n", t: "\t", r: "\r", "0": "\0", a: "\x07", b: "\b", e: "\x1b", f: "\f", v: "\v" }[c] || c;
  }
  function isLValue(e) {
    if (e.t === "array" && !e.unaryComma) return e.items.every(function (x) { return x.t === "var" || x.t === "member" || x.t === "index"; });
    return e.t === "var" || e.t === "member" || e.t === "index" || (e.t === "cast" && e.e.t === "var");
  }
  function parseNumber(w) {
    var m = /^(-?)(0x[0-9a-fA-F]+|[0-9]*\.?[0-9]+(?:[eE][+-]?[0-9]+)?)(kb|mb|gb|tb)?$/i.exec(w);
    if (!m) return null;
    var v = m[2].slice(0, 2).toLowerCase() === "0x" ? parseInt(m[2], 16) : parseFloat(m[2]);
    if (m[3]) v *= MULT[m[3].toLowerCase()];
    return m[1] ? -v : v;
  }

  function parse(src) { return new Parser(src).parseScript(); }

  /* ================================================================== Conversions */
  function typeOfValue(v) {
    if (v === null || v === undefined) return null;
    if (typeof v === "string") return "System.String";
    if (typeof v === "number") return Number.isInteger(v) && Math.abs(v) <= 2147483647 ? "System.Int32" : Number.isInteger(v) && Math.abs(v) < 9.2e18 ? "System.Int64" : "System.Double";
    if (typeof v === "boolean") return "System.Boolean";
    if (Array.isArray(v)) return "System.Object[]";
    if (v instanceof PSHashtable) return v.ordered ? "System.Collections.Specialized.OrderedDictionary" : "System.Collections.Hashtable";
    if (v instanceof PSObject) return v.typeName;
    if (v instanceof PSDate) return "System.DateTime";
    if (v instanceof PSTimeSpan) return "System.TimeSpan";
    if (v instanceof ScriptBlock) return "System.Management.Automation.ScriptBlock";
    if (v instanceof PSType) return "System.RuntimeType";
    if (v instanceof PSVersion) return "System.Version";
    if (v instanceof RegExp) return "System.Text.RegularExpressions.Regex";
    return "System.Object";
  }
  function shortType(full) { return full ? full.replace(/^.*\./, "") : "null"; }

  function fmtNumber(n) {
    if (!isFinite(n)) return isNaN(n) ? "NaN" : n > 0 ? "∞" : "-∞";
    if (Number.isInteger(n)) return String(n);
    var s = n.toPrecision(15);
    if (s.indexOf("e") < 0 && s.indexOf(".") >= 0) s = s.replace(/0+$/, "").replace(/\.$/, "");
    else if (s.indexOf("e") >= 0) s = String(n).toUpperCase().replace("E+", "E+").replace(/E([+-])(\d)$/, "E$10$2");
    return s;
  }
  function pad2(n) { return (n < 10 ? "0" : "") + n; }
  function dateInvariant(d) { // what "$date" gives: MM/dd/yyyy HH:mm:ss
    var x = d.d();
    return pad2(x.getUTCMonth() + 1) + "/" + pad2(x.getUTCDate()) + "/" + x.getUTCFullYear() + " " + pad2(x.getUTCHours()) + ":" + pad2(x.getUTCMinutes()) + ":" + pad2(x.getUTCSeconds());
  }
  function dateLong(d) {
    var x = d.d();
    var h = x.getUTCHours(), ap = h < 12 ? "AM" : "PM";
    var h12 = h % 12 === 0 ? 12 : h % 12;
    return DAYS[x.getUTCDay()] + ", " + MONTHS[x.getUTCMonth()] + " " + x.getUTCDate() + ", " + x.getUTCFullYear() + " " + h12 + ":" + pad2(x.getUTCMinutes()) + ":" + pad2(x.getUTCSeconds()) + " " + ap;
  }
  function dateShort(d) { // as shown in tables: M/d/yyyy h:mm:ss AM
    var x = d.d();
    var h = x.getUTCHours(), ap = h < 12 ? "AM" : "PM";
    var h12 = h % 12 === 0 ? 12 : h % 12;
    return (x.getUTCMonth() + 1) + "/" + x.getUTCDate() + "/" + x.getUTCFullYear() + " " + h12 + ":" + pad2(x.getUTCMinutes()) + ":" + pad2(x.getUTCSeconds()) + " " + ap;
  }
  function spanString(t) {
    var ms = Math.abs(t.ms), sign = t.ms < 0 ? "-" : "";
    var d = Math.floor(ms / 86400000), h = Math.floor(ms / 3600000) % 24, m = Math.floor(ms / 60000) % 60, s = Math.floor(ms / 1000) % 60;
    return sign + (d ? d + "." : "") + pad2(h) + ":" + pad2(m) + ":" + pad2(s);
  }

  // How a value turns into text: string interpolation, -join, Write-Host, [string].
  function toStr(v) {
    if (v === null || v === undefined) return "";
    if (typeof v === "string") return v;
    if (typeof v === "number") return fmtNumber(v);
    if (typeof v === "boolean") return v ? "True" : "False";
    if (Array.isArray(v)) return v.map(toStr).join(" ");
    if (v instanceof PSHashtable) return typeOfValue(v);
    if (v instanceof PSDate) return dateInvariant(v);
    if (v instanceof PSTimeSpan) return spanString(v);
    if (v instanceof ScriptBlock) return v.text;
    if (v instanceof PSType) return v.name;
    if (v instanceof PSVersion) return v.parts.join(".");
    if (v instanceof RegExp) return v.source;
    if (v instanceof PSObject) {
      if (v.toStringFn) return v.toStringFn();
      if (v.typeName === "System.Management.Automation.PSCustomObject") {
        return "@{" + v.props.map(function (p) { return p.name + "=" + toStr(p.value); }).join("; ") + "}";
      }
      if (v.has("Name")) return toStr(v.get("Name"));
      return v.typeName;
    }
    return String(v);
  }

  function toBool(v) {
    if (v === null || v === undefined) return false;
    if (typeof v === "boolean") return v;
    if (typeof v === "number") return v !== 0;
    if (typeof v === "string") return v.length > 0;
    if (Array.isArray(v)) return v.length === 0 ? false : v.length === 1 ? toBool(v[0]) : true;
    return true;
  }

  function convError(v, type) {
    var shown = toStr(v);
    return new PSError("Cannot convert value \"" + shown + "\" to type \"" + type + "\". Error: \"The input string '" + shown + "' was not in a correct format.\"", { category: "InvalidArgument" });
  }
  function toNumber(v, typeName) {
    if (typeof v === "number") return v;
    if (v === null || v === undefined) return 0;
    if (typeof v === "boolean") return v ? 1 : 0;
    if (typeof v === "string") {
      var t = v.trim();
      if (t === "") return 0;
      var n = parseNumber(t.replace(/,/g, ""));
      if (n === null || /,/.test(t) && !/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(t)) throw convError(v, typeName || "System.Int32");
      return n;
    }
    if (Array.isArray(v) && v.length === 1) return toNumber(v[0], typeName);
    if (v instanceof PSTimeSpan) return v.ms;
    throw new PSError("Cannot convert the \"" + toStr(v) + "\" value of type \"" + typeOfValue(v) + "\" to type \"" + (typeName || "System.Int32") + "\".", { category: "InvalidArgument" });
  }
  function roundEven(x) {
    var r = Math.round(x);
    if (Math.abs(x % 1) === 0.5) r = 2 * Math.round(x / 2);
    return r;
  }
  function parseDate(s) {
    s = String(s).trim();
    var m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2}))?)?Z?$/.exec(s);
    if (m) return new PSDate(Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0)));
    m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?)?$/i.exec(s);
    if (m) {
      var h = +(m[4] || 0);
      if (m[7]) { if (/pm/i.test(m[7]) && h < 12) h += 12; if (/am/i.test(m[7]) && h === 12) h = 0; }
      return new PSDate(Date.UTC(+m[3], +m[1] - 1, +m[2], h, +(m[5] || 0), +(m[6] || 0)));
    }
    throw new PSError("Cannot convert value \"" + s + "\" to type \"System.DateTime\". Error: \"String '" + s + "' was not recognized as a valid DateTime.\"", { category: "InvalidArgument" });
  }

  // [type] casts and parameter type conversion.
  function convertTo(v, typeName, ctx) {
    var t = lc(typeName).replace(/^system\./, "");
    if (/\[\]$/.test(t)) {
      var inner = typeName.replace(/\[\]$/, "");
      var arr = v === null || v === undefined ? [] : Array.isArray(v) ? v : [v];
      return arr.map(function (x) { return convertTo(x, inner, ctx); });
    }
    switch (t) {
      case "int": case "int32": case "long": case "int64": case "byte": case "int16": case "uint32":
        if (typeof v === "string" && v.trim() !== "" && parseNumber(v.trim()) === null) throw convError(v, "System.Int32");
        if (v instanceof PSObject || v instanceof PSHashtable) throw new PSError("Cannot convert the \"" + toStr(v) + "\" value of type \"" + typeOfValue(v) + "\" to type \"System.Int32\".", { category: "InvalidArgument" });
        return roundEven(toNumber(v, "System.Int32"));
      case "double": case "float": case "single": case "decimal":
        if (typeof v === "string" && v.trim() !== "" && parseNumber(v.trim().replace(/,/g, "")) === null) throw convError(v, "System.Double");
        return toNumber(v, "System.Double");
      case "string": return v === null || v === undefined ? "" : toStr(v);
      case "bool": case "boolean": return toBool(v);
      case "switch": case "management.automation.switchparameter": return toBool(v);
      case "char":
        if (typeof v === "number") return String.fromCharCode(v);
        if (typeof v === "string" && v.length === 1) return v;
        throw new PSError("Cannot convert value \"" + toStr(v) + "\" to type \"System.Char\". Error: \"String must be exactly one character long.\"", { category: "InvalidArgument" });
      case "datetime":
        if (v instanceof PSDate) return v;
        return parseDate(v);
      case "timespan": return v instanceof PSTimeSpan ? v : new PSTimeSpan(toNumber(v));
      case "array": case "object[]": return v === null || v === undefined ? [] : Array.isArray(v) ? v : [v];
      case "hashtable": case "collections.hashtable":
        if (v instanceof PSHashtable) return v;
        throw new PSError("Cannot convert the \"" + toStr(v) + "\" value of type \"" + typeOfValue(v) + "\" to type \"System.Collections.Hashtable\".", { category: "InvalidArgument" });
      case "pscustomobject": case "management.automation.pscustomobject": case "psobject":
        if (v instanceof PSHashtable) {
          var o = new PSObject();
          v.entries().forEach(function (e) { o.set(toStr(e.key), e.value); });
          return o;
        }
        return v;
      case "ordered":
        if (v instanceof PSHashtable) { v.ordered = true; return v; }
        throw new PSError("The ordered attribute can be specified only on a hash literal node.", { category: "ParseError" });
      case "regex": return new RegExp(toStr(v), "i");
      case "version":
        if (v instanceof PSVersion) return v;
        var parts = toStr(v).split(".").map(function (x) { return parseInt(x, 10); });
        if (parts.some(isNaN) || parts.length < 2) throw new PSError("Cannot convert value \"" + toStr(v) + "\" to type \"System.Version\".", { category: "InvalidArgument" });
        return new PSVersion(parts);
      case "object": case "psobject[]": return v;
      case "void": return undefined;
    }
    if (ctx && ctx.session && ctx.session.lib.convert) {
      var r = ctx.session.lib.convert(v, typeName);
      if (r !== undefined) return r;
    }
    throw new PSError("Unable to find type [" + typeName + "].", { category: "InvalidOperation" });
  }

  function isType(v, typeName) {
    var t = lc(typeName).replace(/^system\./, "");
    var vt = typeOfValue(v);
    if (v === null || v === undefined) return false;
    switch (t) {
      case "int": case "int32": return typeof v === "number" && vt === "System.Int32";
      case "long": case "int64": return typeof v === "number" && Number.isInteger(v);
      case "double": return typeof v === "number" && !Number.isInteger(v);
      case "string": return typeof v === "string";
      case "bool": case "boolean": return typeof v === "boolean";
      case "array": case "object[]": return Array.isArray(v);
      case "hashtable": case "collections.hashtable": return v instanceof PSHashtable;
      case "pscustomobject": case "management.automation.pscustomobject": return v instanceof PSObject && v.typeName === "System.Management.Automation.PSCustomObject";
      case "datetime": return v instanceof PSDate;
      case "timespan": return v instanceof PSTimeSpan;
      case "scriptblock": return v instanceof ScriptBlock;
      case "object": case "psobject": return true;
      case "valuetype": return typeof v === "number" || typeof v === "boolean" || v instanceof PSDate;
      case "version": return v instanceof PSVersion;
    }
    return lc(vt || "") === lc(typeName) || lc(shortType(vt)) === t;
  }

  /* ================================================================== Comparison */
  function cmpEq(a, b, cs) {
    if (a === null || a === undefined) return b === null || b === undefined;
    if (typeof a === "string") { var bs = b === null || b === undefined ? "" : toStr(b); return cs ? a === bs : lc(a) === lc(bs); }
    if (typeof a === "number") { if (b === null || b === undefined) return false; try { return a === toNumber(b); } catch (e) { return false; } }
    if (typeof a === "boolean") return a === toBool(b);
    if (a instanceof PSDate) { try { return b !== null && a.ms === (b instanceof PSDate ? b : parseDate(b)).ms; } catch (e) { return false; } }
    if (a instanceof PSVersion) { try { return compareVersions(a, convertTo(b, "version")) === 0; } catch (e) { return false; } }
    if (a instanceof PSTimeSpan) return b instanceof PSTimeSpan && a.ms === b.ms;
    // Objects that compare like their text (e.g. an NTAccount IdentityReference vs 'BUILTIN\Users').
    if (a instanceof PSObject && a.cmpAsString) return cmpEq(toStr(a), b, cs);
    return a === b;
  }
  function compareVersions(a, b) {
    for (var k = 0; k < Math.max(a.parts.length, b.parts.length); k++) {
      var x = a.parts[k] == null ? -1 : a.parts[k], y = b.parts[k] == null ? -1 : b.parts[k];
      if (x !== y) return x < y ? -1 : 1;
    }
    return 0;
  }
  function cmpOrder(a, b, cs) { // -1, 0, 1
    if (a === null || a === undefined) return b === null || b === undefined ? 0 : -1;
    if (b === null || b === undefined) return 1;
    if (typeof a === "number") { var n = toNumber(b); return a < n ? -1 : a > n ? 1 : 0; }
    if (a instanceof PSDate) { var d = b instanceof PSDate ? b : parseDate(b); return a.ms < d.ms ? -1 : a.ms > d.ms ? 1 : 0; }
    if (a instanceof PSTimeSpan) { var t = b instanceof PSTimeSpan ? b.ms : toNumber(b); return a.ms < t ? -1 : a.ms > t ? 1 : 0; }
    if (a instanceof PSVersion) return compareVersions(a, convertTo(b, "version"));
    if (typeof a === "boolean") { var bb = toBool(b); return a === bb ? 0 : a ? 1 : -1; }
    var x = toStr(a), y = toStr(b);
    if (!cs) { x = lc(x); y = lc(y); }
    return x < y ? -1 : x > y ? 1 : 0;
  }
  function wildcardRe(pat, cs) {
    var re = "";
    for (var k = 0; k < pat.length; k++) {
      var c = pat[k];
      if (c === "*") re += ".*";
      else if (c === "?") re += ".";
      else if (c === "[") { var e = pat.indexOf("]", k); if (e > k) { re += pat.slice(k, e + 1); k = e; } else re += "\\["; }
      else if (c === "`" && k + 1 < pat.length) { re += pat[k + 1].replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); k++; }
      else re += c.replace(/[.*+?^${}()|[\]\\\/]/g, "\\$&");
    }
    return new RegExp("^" + re + "$", cs ? "" : "i");
  }
  // .NET regex -> JS regex (the common parts).
  function netRegex(pat, flags) {
    var src = toStr(pat);
    src = src.replace(/\(\?<([A-Za-z_][A-Za-z0-9_]*)>/g, "(?<$1>").replace(/\(\?i\)/g, function () { flags = (flags || "").replace("i", "") + "i"; return ""; });
    try { return new RegExp(src, flags); }
    catch (e) { throw new PSError("The regular expression pattern " + src + " is not valid.", { category: "InvalidArgument" }); }
  }

  /* ================================================================== Scopes and session */
  function Scope(parent) { this.vars = new Map(); this.parent = parent; }
  Scope.prototype.lookup = function (name) {
    var k = lc(name);
    for (var s = this; s; s = s.parent) if (s.vars.has(k)) return s.vars.get(k);
    return undefined;
  };
  Scope.prototype.find = function (name) {
    var k = lc(name);
    for (var s = this; s; s = s.parent) if (s.vars.has(k)) return s;
    return null;
  };
  Scope.prototype.setLocal = function (name, v) { this.vars.set(lc(name), { name: name, value: v }); };

  var MAX_STEPS = 2000000;

  function Session(opts) {
    opts = opts || {};
    this.global = new Scope(null);
    this.functions = new Map();
    this.parts = [];          // host output: [{text, cls}]
    this.errors = [];         // error records written to the error stream
    this.steps = 0;
    this.maxSteps = opts.maxSteps || MAX_STEPS;
    this.env = Object.assign({ USERNAME: "dev", COMPUTERNAME: "KC-WIN-01", USERDOMAIN: "KESTREL", OS: "Windows_NT",
      PATH: "C:\\Windows\\system32;C:\\Windows;C:\\Program Files\\PowerShell\\7", TEMP: "C:\\Users\\dev\\AppData\\Local\\Temp" }, opts.env || {});
    this.lib = root.PSEngine.lib || {};
    this.system = this.lib.makeSystem ? this.lib.makeSystem(opts) : {};
    this.pendingHost = "";
    var g = this.global;
    g.setLocal("true", true); g.setLocal("false", false); g.setLocal("null", null);
    g.setLocal("Error", []);
    g.setLocal("ErrorActionPreference", "Continue");
    g.setLocal("VerbosePreference", "SilentlyContinue");
    g.setLocal("WhatIfPreference", false);
    g.setLocal("OFS", " ");
    g.setLocal("HOME", "C:\\Users\\dev");
    g.setLocal("PSVersionTable", (function () { var h = new PSHashtable(); h.set("PSVersion", new PSVersion([7, 4, 6])); h.set("PSEdition", "Core"); h.set("OS", "Microsoft Windows 10.0.26100 (simulated)"); h.set("Platform", "Win32NT"); return h; })());
    g.setLocal("PID", 4242);
    this.scriptScope = g;
    var self = this;
    (this.lib.sessionHooks || []).forEach(function (h) { h(self); });
  }
  Session.prototype.write = function (text, cls) {
    var self = this;
    // Anything written to the screen first lets buffered pipeline objects out, so the order matches PowerShell's streaming.
    if (this.activeSink && !this.sinkWriting) this.activeSink.flushObjects();
    String(text).split("\n").forEach(function (l) { self.parts.push({ text: l, cls: cls || "" }); });
  };
  // Output sink for a top-level statement: strings and numbers print as soon as they're produced;
  // objects are held briefly so a run of similar objects shares one table, as in PowerShell.
  function makeSink(session) {
    var sink = [], buf = [];
    sink.isSink = true;
    sink.flushObjects = function () {
      if (!buf.length) return;
      var items = buf; buf = [];
      session.sinkWriting = true;
      try { var t = formatItems(items, session); if (t) session.write(t, ""); }
      finally { session.sinkWriting = false; }
    };
    sink.push = function () {
      for (var k = 0; k < arguments.length; k++) {
        var x = arguments[k];
        if (x === null || x === undefined) continue;
        sink.all.push(x);
        if (x instanceof PSObject || x instanceof PSHashtable || x instanceof PSTimeSpan || x instanceof PSType) { buf.push(x); continue; }
        sink.flushObjects();
        var text = formatItems([x], session);
        session.sinkWriting = true;
        try {
          if (session.pendingHost) { text = session.pendingHost + text; session.pendingHost = ""; }
          session.write(text, "");
        } finally { session.sinkWriting = false; }
      }
      return 0;
    };
    sink.all = [];
    sink.flush = function () { sink.flushObjects(); };
    return sink;
  }
  Session.prototype.writeError = function (e, ctx) {
    var rec = errorRecord(e);
    var errs = this.global.lookup("Error").value;
    errs.unshift(rec);
    this.errors.push({ message: e.message, line: e.line || (ctx && ctx.line) || null, category: e.category, command: e.command });
    var where = e.line ? "line " + e.line + ": " : "";
    this.write(where + (e.command ? e.command + ": " : "") + e.message, "err");
  };
  Session.prototype.step = function () { if (++this.steps > this.maxSteps) throw new StepLimit(); };

  function errorRecord(e) {
    var exMsg = e.exceptionMessage || e.message;
    var ex = obj(e.exceptionType || "System.Management.Automation.RuntimeException", { Message: exMsg });
    if (e.exceptionProps) Object.keys(e.exceptionProps).forEach(function (k) { ex.set(k, e.exceptionProps[k]); });
    ex.toStringFn = function () { return exMsg; };
    var rec = obj("System.Management.Automation.ErrorRecord", { Exception: ex, CategoryInfo: e.category, FullyQualifiedErrorId: e.errorId || e.category, TargetObject: e.target === undefined ? null : e.target,
      ErrorDetails: e.details ? obj("System.Management.Automation.ErrorDetails", { Message: e.details }) : null });
    rec.toStringFn = function () { return e.message; };
    rec.psError = e;
    return rec;
  }

  /* ================================================================== Interpreter */
  // ctx: { session, scope, inTry, fn (current function info), line }
  function Ctx(session, scope, extra) {
    this.session = session; this.scope = scope; this.inTry = 0; this.fn = null; this.line = null;
    if (extra) for (var k in extra) this[k] = extra[k];
  }
  Ctx.prototype.child = function (scope, extra) {
    var c = new Ctx(this.session, scope || this.scope);
    c.inTry = this.inTry; c.fn = this.fn; c.line = this.line;
    if (extra) for (var k in extra) c[k] = extra[k];
    return c;
  };
  Ctx.prototype.get = function (name) { var v = this.scope.lookup(name); return v ? v.value : undefined; };
  Ctx.prototype.pref = function (name) { var v = this.get(name); return v === undefined ? null : v; };

  function execBlock(block, ctx, out) {
    var stmts = block.stmts;
    for (var k = 0; k < stmts.length; k++) {
      var st = stmts[k];
      ctx.session.step();
      try {
        execStatement(st, ctx, out);
      } catch (e) {
        if (e instanceof PSError) {
          if (!e.line) e.line = st.line;
          if (ctx.inTry || e.scriptTerminating || e.stopAction) throw e;
          ctx.session.writeError(e, ctx); // statement-terminating: report, then carry on with the next statement
          continue;
        }
        throw e;
      }
    }
  }

  function execStatement(st, ctx, out) {
    ctx.line = st.line || ctx.line;
    switch (st.t) {
      case "pipeline": {
        // A lone assignment-like expression ($i++) outputs nothing.
        if (st.elems.length === 1 && st.elems[0].t === "incdec") { evalExpr(st.elems[0], ctx); return; }
        var items = runPipeline(st, ctx, out && out.isSink ? out : null);
        for (var k = 0; k < items.length; k++) out.push(items[k]);
        return;
      }
      case "assign": assign(st, ctx); return;
      case "if": {
        for (var c = 0; c < st.clauses.length; c++) {
          if (toBool(condValue(st.clauses[c].cond, ctx))) { execBlock(st.clauses[c].body, ctx, out); return; }
        }
        if (st.els) execBlock(st.els, ctx, out);
        return;
      }
      case "while":
        while (toBool(condValue(st.cond, ctx))) {
          ctx.session.step();
          try { execBlock(st.body, ctx, out); }
          catch (e) { if (e instanceof BreakSignal) break; if (e instanceof ContinueSignal) continue; throw e; }
        }
        return;
      case "do":
        do {
          ctx.session.step();
          try { execBlock(st.body, ctx, out); }
          catch (e) { if (e instanceof BreakSignal) break; if (e instanceof ContinueSignal) { /* fall through to condition */ } else throw e; }
        } while (st.until ? !toBool(condValue(st.cond, ctx)) : toBool(condValue(st.cond, ctx)));
        return;
      case "for":
        if (st.init) execStatement(st.init, ctx, []);
        while (st.cond ? toBool(condValue(st.cond.t === "pipeline" ? st.cond : st.cond, ctx)) : true) {
          ctx.session.step();
          try { execBlock(st.body, ctx, out); }
          catch (e) { if (e instanceof BreakSignal) break; if (!(e instanceof ContinueSignal)) throw e; }
          if (st.step) execStatement(st.step, ctx, []);
        }
        return;
      case "foreach": {
        var coll = condValue(st.coll, ctx);
        var list = coll === null || coll === undefined ? [] : Array.isArray(coll) ? coll.slice() : [coll];
        for (var i = 0; i < list.length; i++) {
          ctx.session.step();
          setVar(st.v, list[i], ctx);
          try { execBlock(st.body, ctx, out); }
          catch (e) { if (e instanceof BreakSignal) break; if (e instanceof ContinueSignal) continue; throw e; }
        }
        return;
      }
      case "switch": execSwitch(st, ctx, out); return;
      case "function": defineFunction(st, ctx); return;
      case "return":
        if (st.val) { var rv = runValueOutput(st.val, ctx); for (var r = 0; r < rv.length; r++) out.push(rv[r]); }
        throw new ReturnSignal();
      case "break": throw new BreakSignal();
      case "continue": throw new ContinueSignal();
      case "exit": throw new ExitSignal(st.val ? toNumber(condValue(st.val, ctx)) : 0);
      case "throw": {
        var tv = st.val ? condValue(st.val, ctx) : "ScriptHalted";
        var msg = tv instanceof PSObject && tv.typeName === "System.Management.Automation.ErrorRecord" ? toStr(tv) : toStr(tv);
        throw new PSError(msg, { category: "OperationStopped", scriptTerminating: true, line: st.line, thrown: tv });
      }
      case "try": execTry(st, ctx, out); return;
      case "param": bindScriptParams(st, ctx); return;
      case "stmtexpr": execStatement(st.st, ctx, out); return;
      default: throw new PSError("Unsupported statement: " + st.t);
    }
  }

  function condValue(p, ctx) { // value of a condition / foreach collection / switch subject
    if (p.t === "stmtexpr") { var o = []; execStatement(p.st, ctx, o); return unwrap(o); }
    if (p.t === "pipeline" && p.elems.length === 1 && p.elems[0].t !== "cmd") return evalExpr(p.elems[0], ctx);
    if (p.t === "pipeline") return unwrap(runPipeline(p, ctx));
    if (p.t === "assign") { assign(p, ctx); return evalExpr(p.target, ctx); }
    return evalExpr(p, ctx);
  }
  // Output of a pipeline/statement, as a list (for return values and $(...)).
  function runValueOutput(p, ctx) {
    if (p.t === "stmtexpr") { var o = []; execStatement(p.st, ctx, o); return o; }
    return runPipeline(p, ctx);
  }
  function unwrap(items) { return items.length === 0 ? null : items.length === 1 ? items[0] : items; }
  function enumerate(v) {
    if (v === null || v === undefined) return [];
    if (Array.isArray(v)) return v;
    return [v];
  }

  function execTry(st, ctx, out) {
    var inner = ctx.child(null, {});
    inner.inTry = ctx.inTry + 1;
    try {
      execBlock(st.body, inner, out);
    } catch (e) {
      if (!(e instanceof PSError)) { if (st.fin && !(e && e.isPause)) execBlock(st.fin, ctx, out); throw e; }
      var handled = false;
      for (var k = 0; k < st.catches.length; k++) {
        var c = st.catches[k];
        if (c.types.length && !c.types.some(function (t) { return catchMatches(t, e); })) continue;
        handled = true;
        var rec = errorRecord(e);
        var prev = ctx.scope.vars.get("_");
        ctx.scope.setLocal("_", rec);
        ctx.scope.setLocal("PSItem", rec);
        try { execBlock(c.body, ctx, out); }
        finally { if (prev) ctx.scope.vars.set("_", prev); }
        break;
      }
      if (!handled) { if (st.fin) execBlock(st.fin, ctx, out); throw e; }
    }
    if (st.fin) execBlock(st.fin, ctx, out);
  }
  function catchMatches(t, e) {
    var n = lc(t).replace(/^system\./, "");
    if (n === "exception" || n === "management.automation.runtimeexception") return true;
    var map = { "dividebyzeroexception": "DivideByZero", "io.filenotfoundexception": "ObjectNotFound", "management.automation.itemnotfoundexception": "ObjectNotFound",
      "argumentexception": "InvalidArgument", "invalidoperationexception": "InvalidOperation", "management.automation.commandnotfoundexception": "CommandNotFound",
      "unauthorizedaccessexception": "PermissionDenied", "management.automation.parameterbindingexception": "InvalidArgument", "formatexception": "InvalidArgument",
      "net.webexception": "ConnectionError", "management.automation.validationmetadataexception": "InvalidData" };
    return map[n] ? e.category === map[n] : false;
  }

  function execSwitch(st, ctx, out) {
    var subj = condValue(st.subject, ctx);
    var list = Array.isArray(subj) ? subj : [subj];
    var f = st.flags, cs = !!f.casesensitive;
    var prevUnderscore = ctx.scope.vars.get("_");
    try {
      outer:
      for (var i = 0; i < list.length; i++) {
        var item = list[i];
        ctx.scope.setLocal("_", item);
        ctx.scope.setLocal("PSItem", item);
        var matched = false;
        for (var k = 0; k < st.cases.length; k++) {
          var c = st.cases[k];
          if (c.pat === "default") continue;
          var hit;
          if (c.pat.t === "sblit") {
            hit = toBool(callScriptBlock(new ScriptBlock(c.pat.block, c.pat.text), ctx, [], item, true));
          } else {
            var pv = evalExpr(c.pat, ctx);
            if (f.wildcard) hit = wildcardRe(toStr(pv), cs).test(toStr(item));
            else if (f.regex) {
              var m = netRegex(toStr(pv), cs ? "" : "i").exec(toStr(item));
              hit = !!m;
              if (m) ctx.scope.find("Matches") ? setMatches(m, ctx) : setMatches(m, ctx);
            } else hit = cmpEq(item, pv, cs);
          }
          if (!hit) continue;
          matched = true;
          try { execBlock(c.body, ctx, out); }
          catch (e) {
            if (e instanceof BreakSignal) break outer;
            if (e instanceof ContinueSignal) continue outer;
            throw e;
          }
        }
        if (!matched) {
          var d = st.cases.filter(function (x) { return x.pat === "default"; })[0];
          if (d) {
            try { execBlock(d.body, ctx, out); }
            catch (e2) { if (e2 instanceof BreakSignal) break; if (e2 instanceof ContinueSignal) continue; throw e2; }
          }
        }
      }
    } finally {
      if (prevUnderscore) ctx.scope.vars.set("_", prevUnderscore); else ctx.scope.vars.delete("_");
    }
  }
  function setMatches(m, ctx) {
    var h = new PSHashtable();
    for (var g = 0; g < m.length; g++) if (m[g] !== undefined) h.set(g, m[g]);
    if (m.groups) Object.keys(m.groups).forEach(function (k) { if (m.groups[k] !== undefined) h.set(k, m.groups[k]); });
    var s = ctx.scope.find("Matches") || ctx.scope;
    s.setLocal("Matches", h);
  }

  /* ---------------- Variables */
  function varScopeFor(node, ctx, forWrite) {
    var sc = node.scope;
    if (sc === "global") return ctx.session.global;
    if (sc === "script") return ctx.session.scriptScope;
    if (sc === "local" || sc === "private") return ctx.scope;
    return null;
  }
  function getVar(node, ctx) {
    var name = node.name;
    if (node.scope === "env") { var e = envGet(ctx.session, name); return e; }
    if (node.scope === "variable") { var vv = ctx.scope.lookup(name); return vv ? vv.value : null; }
    var sc = varScopeFor(node, ctx);
    var v = sc ? sc.vars.get(lc(name)) : ctx.scope.lookup(name);
    if (v === undefined) {
      if (lc(name) === "psitem") { var u = ctx.scope.lookup("_"); return u ? u.value : null; }
      return null;
    }
    return v.value;
  }
  function envGet(session, name) {
    var keys = Object.keys(session.env);
    for (var k = 0; k < keys.length; k++) if (lc(keys[k]) === lc(name)) return session.env[keys[k]];
    return null;
  }
  function setVar(node, value, ctx) {
    var name = node.name;
    if (node.scope === "env") {
      var keys = Object.keys(ctx.session.env), hit = null;
      keys.forEach(function (k) { if (lc(k) === lc(name)) hit = k; });
      if (value === null || value === "") delete ctx.session.env[hit || name];
      else ctx.session.env[hit || name] = toStr(value);
      return;
    }
    if (/^(true|false|null)$/i.test(name) && !node.scope) throw new PSError("Cannot overwrite variable " + name + " because it is read-only or constant.", { category: "WriteError" });
    var sc = varScopeFor(node, ctx) || ctx.scope;
    var existing = sc.vars.get(lc(name));
    if (existing && existing.type) value = convertTo(value, existing.type, ctx);
    if (existing) existing.value = value; else sc.setLocal(name, value);
  }

  /* ---------------- Assignment */
  function assign(st, ctx) {
    var target = st.target, op = st.op;
    var value;
    if (st.value.t === "pipeline" && st.value.elems.length === 1 && st.value.elems[0].t !== "cmd") value = evalExpr(st.value.elems[0], ctx);
    else value = condValue(st.value, ctx);
    if (target.t === "array") { // $a, $b = 1, 2, 3  ->  $a = 1; $b = @(2, 3)
      var vals = enumerate(value), tg = target.items;
      for (var ti = 0; ti < tg.length; ti++) {
        var v2 = ti < tg.length - 1 ? (ti < vals.length ? vals[ti] : null) : (vals.length - ti > 1 ? vals.slice(ti) : (ti < vals.length ? vals[ti] : null));
        assignTo(tg[ti], v2, ctx);
      }
      return;
    }
    if (target.t === "cast") {
      value = convertTo(value, target.type, ctx);
      setVar(target.e, value, ctx);
      var sc = varScopeFor(target.e, ctx) || ctx.scope;
      var rec = sc.vars.get(lc(target.e.name));
      if (rec) rec.type = target.type;
      return;
    }
    if (op !== "=") {
      var cur = evalExpr(target, ctx);
      value = binary(op.charAt(0), cur, value, ctx);
    }
    assignTo(target, value, ctx);
  }
  function assignTo(target, value, ctx) {
    if (target.t === "var") { setVar(target, value, ctx); return; }
    if (target.t === "member") {
      var o = evalExpr(target.obj, ctx);
      var name = typeof target.name === "string" ? target.name : toStr(evalExpr(target.name, ctx));
      if (o instanceof PSHashtable) { o.set(name, value); return; }
      if (o instanceof PSObject) {
        // GUI controls have many more properties than the lab models; accept and store unknown ones.
        if (!o.has(name) && !o.guiId) throw new PSError("The property '" + name + "' cannot be found on this object. Verify that the property exists and can be set.", { category: "InvalidOperation" });
        o.set(name, value);
        if (o.onSet) o.onSet(name, value);
        return;
      }
      if (o === null || o === undefined) throw new PSError("The property '" + name + "' cannot be found on this object. Verify that the property exists and can be set.", { category: "InvalidOperation" });
      throw new PSError("'" + name + "' is a ReadOnly property.", { category: "InvalidOperation" });
    }
    if (target.t === "index") {
      var c = evalExpr(target.obj, ctx), idx = evalExpr(target.idx, ctx);
      if (c instanceof PSHashtable) { c.set(idx, value); return; }
      if (Array.isArray(c)) {
        var n = toNumber(idx);
        if (n < 0) n += c.length;
        if (n < 0 || n >= c.length) throw new PSError("Index was outside the bounds of the array.", { category: "InvalidOperation" });
        c[n] = value;
        return;
      }
      if (c === null || c === undefined) throw new PSError("Cannot index into a null array.", { category: "InvalidOperation" });
      throw new PSError("Unable to index into an object of type " + typeOfValue(c) + ".", { category: "InvalidOperation" });
    }
    throw new PSError("The assignment expression is not valid. The input to an assignment operator must be an object that is able to accept assignments, such as a variable or a property.", { category: "ParseError" });
  }

  /* ---------------- Expressions */
  function evalExpr(e, ctx) {
    switch (e.t) {
      case "const": return e.v;
      case "var": return getVar(e, ctx);
      case "xstr": return e.parts.map(function (p) {
        if (typeof p === "string") return p;
        var v = p.t === "subexpr" ? unwrap(blockOutput(p.block, ctx)) : evalExpr(p, ctx);
        return Array.isArray(v) ? v.map(toStr).join(toStr(ctx.pref("OFS") === null ? " " : ctx.pref("OFS"))) : toStr(v);
      }).join("");
      case "array": {
        var arr = [];
        e.items.forEach(function (it) { arr.push(evalExpr(it, ctx)); });
        return arr;
      }
      case "subexpr": return unwrap(blockOutput(e.block, ctx));
      case "arrayexpr": return blockOutput(e.block, ctx).slice();
      case "paren": {
        var p = e.p;
        if (p.t === "assignexpr") { assign(p.a, ctx); return evalExpr(p.a.target, ctx); }
        if (p.t === "stmtexpr") { var o = []; execStatement(p.st, ctx, o); return unwrap(o); }
        if (p.elems.length === 1 && p.elems[0].t !== "cmd") return evalExpr(p.elems[0], ctx);
        return unwrap(runPipeline(p, ctx));
      }
      case "hash": {
        var h = new PSHashtable(false);
        e.entries.forEach(function (en) {
          var k = evalExpr(en[0], ctx);
          if (h.has(k)) throw new PSError("Duplicate keys '" + toStr(k) + "' are not allowed in hash literals.", { category: "ParseError" });
          var vnode = en[1], v;
          if (vnode.t === "pipeline" && vnode.elems.length === 1 && vnode.elems[0].t !== "cmd") v = evalExpr(vnode.elems[0], ctx);
          else v = condValue(vnode, ctx);
          h.set(k, v);
        });
        h.literal = true;
        return h;
      }
      case "sblit": return new ScriptBlock(e.block, e.text, e.params);
      case "type": return new PSType(e.name);
      case "cast": {
        var tn = lc(e.type);
        if ((tn === "pscustomobject" || tn === "ordered") && e.e.t !== "hash" && tn === "ordered") throw new PSError("The ordered attribute can be specified only on a hash literal node.", { category: "ParseError" });
        var val = evalExpr(e.e, ctx);
        if (tn === "void") return undefined;
        return convertTo(val, e.type, ctx);
      }
      case "un": return unary(e.op, evalExpr(e.e, ctx), ctx);
      case "bin": return binaryNode(e, ctx);
      case "range": {
        var a = toNumber(evalExpr(e.l, ctx)), b = toNumber(evalExpr(e.r, ctx));
        a = roundEven(a); b = roundEven(b);
        if (Math.abs(b - a) > 100000) throw new PSError("The range is too large for this lab (more than 100,000 numbers).");
        var r = [];
        if (a <= b) for (var x = a; x <= b; x++) r.push(x); else for (var y = a; y >= b; y--) r.push(y);
        return r;
      }
      case "member": return getMember(e, ctx);
      case "invoke": return invokeMethod(e, ctx);
      case "index": return indexValue(evalExpr(e.obj, ctx), evalExpr(e.idx, ctx));
      case "incdec": {
        var cur = evalExpr(e.target, ctx);
        var nv = toNumber(cur) + (e.op === "++" ? 1 : -1);
        assignTo(e.target, nv, ctx);
        return e.prefix ? nv : cur;
      }
      case "pipeline": return unwrap(runPipeline(e, ctx));
      case "cmd": return unwrap(runPipeline({ t: "pipeline", elems: [e] }, ctx));
      case "stmtexpr": { var o2 = []; execStatement(e.st, ctx, o2); return unwrap(o2); }
      case "assignexpr": assign(e.a, ctx); return evalExpr(e.a.target, ctx);
    }
    throw new PSError("Unsupported expression: " + e.t);
  }
  function blockOutput(block, ctx) { var o = []; execBlock(block, ctx, o); return o; }

  function indexValue(c, idx) {
    if (c === null || c === undefined) throw new PSError("Cannot index into a null array.", { category: "InvalidOperation" });
    if (Array.isArray(idx)) return idx.map(function (i) { return indexValue(c, i); }).filter(function (x) { return x !== null && x !== undefined; });
    if (c instanceof PSHashtable) return c.get(idx);
    if (Array.isArray(c)) {
      var n = roundEven(toNumber(idx));
      if (n < 0) n += c.length;
      return n >= 0 && n < c.length ? c[n] : null;
    }
    if (typeof c === "string") {
      var m = roundEven(toNumber(idx));
      if (m < 0) m += c.length;
      return m >= 0 && m < c.length ? c.charAt(m) : null;
    }
    if (c instanceof PSObject) {
      if (typeof idx === "string") return c.get(idx) === undefined ? null : c.get(idx);
      var k = toNumber(idx);
      return k === 0 || k === -1 ? c : null;
    }
    var k2 = toNumber(idx);
    return k2 === 0 || k2 === -1 ? c : null;
  }

  function unary(op, v, ctx) {
    switch (op) {
      case "not": return !toBool(v);
      case "-":
        if (typeof v === "number") return -v;
        return -toNumber(v);
      case "split": return toStr(v).trim().split(/\s+/).filter(function (x) { return x !== ""; });
      case "join": return enumerate(v).map(toStr).join("");
      case "bnot": return ~toNumber(v);
    }
    throw new PSError("Unsupported operator -" + op);
  }

  function binaryNode(e, ctx) {
    var op = e.op;
    if (op === "and") return toBool(evalExpr(e.l, ctx)) && toBool(evalExpr(e.r, ctx));
    if (op === "or") return toBool(evalExpr(e.l, ctx)) || toBool(evalExpr(e.r, ctx));
    if (op === "xor") return toBool(evalExpr(e.l, ctx)) !== toBool(evalExpr(e.r, ctx));
    var l = evalExpr(e.l, ctx);
    var r = evalExpr(e.r, ctx);
    if (op === "is" || op === "isnot") {
      var tn = r instanceof PSType ? r.name : toStr(r);
      var res = isType(l, tn);
      return op === "is" ? res : !res;
    }
    if (op === "as") {
      try { return convertTo(l, r instanceof PSType ? r.name : toStr(r), ctx); } catch (er) { return null; }
    }
    return binary(op, l, r, ctx);
  }

  function binary(op, l, r, ctx) {
    var cm = CASE_PREFIX.exec(op);
    var cs = false, base = op;
    if (cm) { cs = cm[1] === "c"; base = cm[2]; }
    switch (base) {
      case "+": return add(l, r);
      case "-":
        if (l instanceof PSDate && r instanceof PSDate) return new PSTimeSpan(l.ms - r.ms);
        if (l instanceof PSDate && r instanceof PSTimeSpan) return new PSDate(l.ms - r.ms);
        if (l instanceof PSTimeSpan && r instanceof PSTimeSpan) return new PSTimeSpan(l.ms - r.ms);
        return numOp(l, r, function (a, b) { return a - b; }, "-");
      case "*":
        if (typeof l === "string") { var n = toNumber(r); return n > 0 ? l.repeat(n) : ""; }
        if (Array.isArray(l)) { var res = []; for (var k = 0; k < toNumber(r); k++) res = res.concat(l); return res; }
        return numOp(l, r, function (a, b) { return a * b; }, "*");
      case "/":
        return numOp(l, r, function (a, b) {
          if (b === 0) throw new PSError("Attempted to divide by zero.", { category: "DivideByZero" });
          return a / b;
        }, "/");
      case "%":
        return numOp(l, r, function (a, b) {
          if (b === 0) throw new PSError("Attempted to divide by zero.", { category: "DivideByZero" });
          return a % b;
        }, "%");
      case "f": return formatOperator(toStr(l), Array.isArray(r) ? r : [r]);
      case "eq": case "ne": {
        var neg = base === "ne";
        if (Array.isArray(l)) return l.filter(function (x) { return cmpEq(x, r, cs) !== neg; });
        return cmpEq(l, r, cs) !== neg;
      }
      case "gt": case "ge": case "lt": case "le": {
        var test = function (x) {
          var c = cmpOrder(x, r, cs);
          return base === "gt" ? c > 0 : base === "ge" ? c >= 0 : base === "lt" ? c < 0 : c <= 0;
        };
        if (Array.isArray(l)) return l.filter(test);
        return test(l);
      }
      case "like": case "notlike": {
        var re = wildcardRe(toStr(r), cs), nl = base === "notlike";
        if (Array.isArray(l)) return l.filter(function (x) { return re.test(toStr(x)) !== nl; });
        return re.test(toStr(l)) !== nl;
      }
      case "match": case "notmatch": {
        var rx = netRegex(toStr(r), cs ? "" : "i"), nm = base === "notmatch";
        if (Array.isArray(l)) return l.filter(function (x) { return rx.test(toStr(x)) !== nm; });
        var m = rx.exec(toStr(l));
        if (m && !nm) setMatches(m, ctx);
        return !!m !== nm;
      }
      case "contains": case "notcontains": {
        var has = enumerate(l).some(function (x) { return cmpEq(x, r, cs); });
        return base === "contains" ? has : !has;
      }
      case "in": case "notin": {
        var inn = enumerate(r).some(function (x) { return cmpEq(x, l, cs); });
        return base === "in" ? inn : !inn;
      }
      case "replace": {
        var pr = Array.isArray(r) ? r : [r, ""];
        var rre = netRegex(toStr(pr[0]), "g" + (cs ? "" : "i"));
        var rep = toStr(pr[1] === undefined ? "" : pr[1]).replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, "$<$1>");
        var doRep = function (x) { return toStr(x).replace(rre, rep); };
        return Array.isArray(l) ? l.map(doRep) : doRep(l);
      }
      case "split": {
        var srx = netRegex(toStr(Array.isArray(r) ? r[0] : r), "g" + (cs ? "" : "i"));
        var limit = Array.isArray(r) && r.length > 1 ? toNumber(r[1]) : 0;
        var doSplit = function (x) {
          var str = toStr(x), parts = [], last = 0, m;
          srx.lastIndex = 0;
          while ((m = srx.exec(str)) !== null) {
            if (limit > 0 && parts.length >= limit - 1) break;
            if (m[0] === "" ) { srx.lastIndex++; if (m.index >= str.length) break; continue; }
            parts.push(str.slice(last, m.index));
            for (var g = 1; g < m.length; g++) if (m[g] !== undefined) parts.push(m[g]);
            last = m.index + m[0].length;
          }
          parts.push(str.slice(last));
          return parts;
        };
        if (Array.isArray(l)) return l.reduce(function (acc, x) { return acc.concat(doSplit(x)); }, []);
        return doSplit(l);
      }
      case "join": return enumerate(l).map(toStr).join(toStr(r));
    }
    throw new PSError("Unsupported operator: " + op);
  }
  function add(l, r) {
    if (l === null || l === undefined) {
      if (Array.isArray(r)) return r.slice();
      return r;
    }
    if (typeof l === "string") return l + toStr(r);
    if (Array.isArray(l)) return l.concat(Array.isArray(r) ? r : [r]);
    if (l instanceof PSHashtable) {
      if (!(r instanceof PSHashtable)) throw new PSError("A hash table can only be added to another hash table.", { category: "InvalidOperation" });
      var h = new PSHashtable(l.ordered);
      l.entries().forEach(function (e) { h.set(e.key, e.value); });
      r.entries().forEach(function (e) {
        if (h.has(e.key)) throw new PSError("Item has already been added. Key in dictionary: '" + toStr(e.key) + "'  Key being added: '" + toStr(e.key) + "'", { category: "InvalidOperation" });
        h.set(e.key, e.value);
      });
      return h;
    }
    if (l instanceof PSDate && r instanceof PSTimeSpan) return new PSDate(l.ms + r.ms);
    if (l instanceof PSTimeSpan && r instanceof PSTimeSpan) return new PSTimeSpan(l.ms + r.ms);
    return numOp(l, r, function (a, b) { return a + b; }, "+");
  }
  function numOp(l, r, f, sym) {
    if (l === null || l === undefined) l = 0;
    if (r === null || r === undefined) r = 0;
    if (l instanceof PSObject || l instanceof PSHashtable || Array.isArray(l)) {
      throw new PSError("Method invocation failed because [" + typeOfValue(l) + "] does not contain a method named 'op_" + { "-": "Subtraction", "*": "Multiply", "/": "Division", "%": "Modulus", "+": "Addition" }[sym] + "'.", { category: "InvalidOperation" });
    }
    var a = toNumber(l), b;
    try { b = toNumber(r); }
    catch (e) { throw new PSError("Cannot convert value \"" + toStr(r) + "\" to type \"System.Int32\". Error: \"The input string '" + toStr(r) + "' was not in a correct format.\"", { category: "InvalidArgument" }); }
    return f(a, b);
  }

  /* ---------------- -f and ToString(format) */
  function groupThousands(s) { return s.replace(/\B(?=(\d{3})+(?!\d))/g, ","); }
  function fixedRound(n, d) {
    var f = Math.pow(10, d);
    var x = n * f;
    var r = Math.round(x);
    if (Math.abs(x - Math.trunc(x)) === 0.5) r = Math.trunc(x) + Math.sign(x); // .NET rounds formatting away from zero
    return (r / f).toFixed(d);
  }
  function formatValue(v, spec) {
    if (!spec) return toStr(v);
    if (v instanceof PSDate) return formatDate(v, spec);
    if (v instanceof PSTimeSpan) return spanString(v);
    var m = /^([NnFfDdPpXxCcEeGg])(\d*)$/.exec(spec);
    var num = typeof v === "number" ? v : (function () { try { return toNumber(v); } catch (e) { return null; } })();
    if (m && num !== null) {
      var kind = m[1].toUpperCase(), d = m[2] === "" ? null : parseInt(m[2], 10);
      switch (kind) {
        case "N": { var s = fixedRound(num, d == null ? 2 : d); var parts = s.split("."); return groupThousands(parts[0]) + (parts[1] ? "." + parts[1] : ""); }
        case "F": return fixedRound(num, d == null ? 2 : d);
        case "D": { var neg = num < 0; var t = String(Math.abs(Math.trunc(num))); while (t.length < (d || 0)) t = "0" + t; return (neg ? "-" : "") + t; }
        case "P": { var ps = fixedRound(num * 100, d == null ? 2 : d); var pp = ps.split("."); return groupThousands(pp[0]) + (pp[1] ? "." + pp[1] : "") + "%"; }
        case "X": { var hx = Math.trunc(num).toString(16); while (hx.length < (d || 0)) hx = "0" + hx; return m[1] === "X" ? hx.toUpperCase() : hx; }
        case "C": { var cs2 = fixedRound(Math.abs(num), d == null ? 2 : d).split("."); return (num < 0 ? "-" : "") + "$" + groupThousands(cs2[0]) + (cs2[1] ? "." + cs2[1] : ""); }
        case "E": return num.toExponential(d == null ? 6 : d).toUpperCase().replace(/E([+-])(\d)$/, "E$1" + "00$2").replace(/E([+-])(\d\d)$/, "E$10$2");
        case "G": return toStr(num);
      }
    }
    if (num !== null && /^[0#,.]+$/.test(spec)) {
      var dot = spec.indexOf("."), decs = dot < 0 ? 0 : spec.length - dot - 1;
      var minDec = dot < 0 ? 0 : (spec.slice(dot + 1).match(/0/g) || []).length;
      var str = fixedRound(Math.abs(num), decs);
      if (minDec < decs) str = str.replace(/0+$/, function (z) { return z.slice(0, Math.max(0, minDec - (decs - z.length) < 0 ? 0 : 0)); });
      var pr = str.split(".");
      var intPart = pr[0];
      var minInt = ((dot < 0 ? spec : spec.slice(0, dot)).match(/0/g) || []).length;
      while (intPart.length < minInt) intPart = "0" + intPart;
      if (intPart === "0" && minInt === 0) intPart = "";
      if (spec.indexOf(",") >= 0) intPart = groupThousands(intPart);
      var res = intPart + (pr[1] ? "." + pr[1] : "");
      if (!res) res = "0";
      return (num < 0 ? "-" : "") + res;
    }
    return toStr(v);
  }
  function formatDate(d, spec) {
    var x = d.d();
    if (spec === "d") return (x.getUTCMonth() + 1) + "/" + x.getUTCDate() + "/" + x.getUTCFullYear();
    if (spec === "s") spec = "yyyy-MM-ddTHH:mm:ss";
    if (spec === "o") spec = "yyyy-MM-ddTHH:mm:ss.0000000";
    return spec.replace(/yyyy|yy|MMMM|MMM|MM|M|dddd|ddd|dd|d|HH|H|hh|h|mm|m|ss|s|tt|fff|ff|f/g, function (t) {
      switch (t) {
        case "yyyy": return String(x.getUTCFullYear());
        case "yy": return pad2(x.getUTCFullYear() % 100);
        case "MMMM": return MONTHS[x.getUTCMonth()];
        case "MMM": return MONTHS[x.getUTCMonth()].slice(0, 3);
        case "MM": return pad2(x.getUTCMonth() + 1);
        case "M": return String(x.getUTCMonth() + 1);
        case "dddd": return DAYS[x.getUTCDay()];
        case "ddd": return DAYS[x.getUTCDay()].slice(0, 3);
        case "dd": return pad2(x.getUTCDate());
        case "d": return String(x.getUTCDate());
        case "HH": return pad2(x.getUTCHours());
        case "H": return String(x.getUTCHours());
        case "hh": return pad2(x.getUTCHours() % 12 || 12);
        case "h": return String(x.getUTCHours() % 12 || 12);
        case "mm": return pad2(x.getUTCMinutes());
        case "m": return String(x.getUTCMinutes());
        case "ss": return pad2(x.getUTCSeconds());
        case "s": return String(x.getUTCSeconds());
        case "tt": return x.getUTCHours() < 12 ? "AM" : "PM";
        default: return "0".repeat(t.length);
      }
    });
  }
  function formatOperator(fmt, args) {
    return fmt.replace(/\{\{|\}\}|\{(\d+)(?:,(-?\d+))?(?::([^}]*))?\}/g, function (all, idx, align, spec) {
      if (all === "{{") return "{";
      if (all === "}}") return "}";
      var i = parseInt(idx, 10);
      if (i >= args.length) throw new PSError("Error formatting a string: Index (zero based) must be greater than or equal to zero and less than the size of the argument list.", { category: "InvalidOperation" });
      var s = formatValue(args[i], spec);
      if (align) {
        var w = parseInt(align, 10);
        if (w < 0) while (s.length < -w) s += " ";
        else while (s.length < w) s = " " + s;
      }
      return s;
    });
  }

  /* ---------------- Members and methods */
  function memberName(e, ctx) { return typeof e.name === "string" ? e.name : toStr(evalExpr(e.name, ctx)); }

  function getMember(e, ctx) {
    var name = memberName(e, ctx);
    if (e.isStatic) return staticMember(e.obj, name, ctx);
    var o = evalExpr(e.obj, ctx);
    return propertyOf(o, name, ctx);
  }

  function propertyOf(o, name, ctx) {
    var n = lc(name);
    if (o === null || o === undefined) return n === "count" ? 0 : n === "length" ? 0 : null;
    if (Array.isArray(o)) {
      if (n === "count" || n === "length") return o.length;
      if (n === "longlength") return o.length;
      // member enumeration: the property of every item
      var res = [];
      o.forEach(function (x) {
        var v = propertyOf(x, name, ctx);
        if (v === null || v === undefined) return;
        if (Array.isArray(v)) res = res.concat(v); else res.push(v);
      });
      return res.length === 0 ? null : res.length === 1 ? res[0] : res;
    }
    if (typeof o === "string") { if (n === "length") return o.length; if (n === "count") return 1; return null; }
    if (o instanceof PSHashtable) {
      if (o.has(name)) return o.get(name);
      if (n === "count") return o.size;
      if (n === "keys") return o.keys();
      if (n === "values") return o.values();
      return null;
    }
    if (o instanceof PSObject) {
      var v = o.get(name);
      if (v !== undefined) return typeof v === "function" ? v() : v;
      if (n === "psobject") return psobjectInfo(o);
      if (n === "count") return 1;
      if (o.getters && o.getters[n]) return o.getters[n]();
      return null;
    }
    if (o instanceof PSDate) {
      var x = o.d();
      switch (n) {
        case "year": return x.getUTCFullYear(); case "month": return x.getUTCMonth() + 1; case "day": return x.getUTCDate();
        case "hour": return x.getUTCHours(); case "minute": return x.getUTCMinutes(); case "second": return x.getUTCSeconds();
        case "dayofweek": return DAYS[x.getUTCDay()]; case "dayofyear": return Math.floor((o.ms - Date.UTC(x.getUTCFullYear(), 0, 1)) / 86400000) + 1;
        case "date": return new PSDate(Date.UTC(x.getUTCFullYear(), x.getUTCMonth(), x.getUTCDate()));
        case "ticks": return o.ms * 10000;
      }
      return null;
    }
    if (o instanceof PSTimeSpan) {
      var ms = o.ms, sg = ms < 0 ? -1 : 1, a = Math.abs(ms);
      switch (n) {
        case "days": return sg * Math.floor(a / 86400000); case "hours": return sg * (Math.floor(a / 3600000) % 24);
        case "minutes": return sg * (Math.floor(a / 60000) % 60); case "seconds": return sg * (Math.floor(a / 1000) % 60);
        case "milliseconds": return sg * (a % 1000);
        case "totaldays": return ms / 86400000; case "totalhours": return ms / 3600000; case "totalminutes": return ms / 60000;
        case "totalseconds": return ms / 1000; case "totalmilliseconds": return ms;
      }
      return null;
    }
    if (o instanceof PSVersion) {
      var idx = { major: 0, minor: 1, build: 2, revision: 3 }[n];
      return idx === undefined ? null : (o.parts[idx] == null ? -1 : o.parts[idx]);
    }
    if (o instanceof ScriptBlock) return null;
    if (o instanceof PSType) return null;
    if (n === "count" || n === "length") return 1;
    return null;
  }

  function psobjectInfo(o) {
    var info = new PSObject("System.Management.Automation.PSObject");
    info.set("Properties", o.props.map(function (p) {
      var pi = obj("System.Management.Automation.PSNoteProperty", { Name: p.name, Value: p.value, MemberType: "NoteProperty", TypeNameOfValue: typeOfValue(p.value) || "System.Object" });
      return pi;
    }));
    info.set("TypeNames", [o.typeName, "System.Object"]);
    return info;
  }

  function staticMember(typeNode, name, ctx) {
    var tn = typeNode.t === "type" ? typeNode.name : toStr(evalExpr(typeNode, ctx));
    var lib = ctx.session.lib;
    var r = lib.staticProperty ? lib.staticProperty(tn, name, ctx) : undefined;
    if (r !== undefined) return r;
    throw new PSError("The property '" + name + "' cannot be found on type [" + tn + "].", { category: "InvalidOperation" });
  }

  function invokeMethod(e, ctx) {
    var name = memberName(e, ctx);
    var args = e.args.map(function (a) { return evalExpr(a, ctx); });
    if (e.isStatic) {
      var tn = e.obj.t === "type" ? e.obj.name : toStr(evalExpr(e.obj, ctx));
      var lib = ctx.session.lib;
      var r = lib.staticMethod ? lib.staticMethod(tn, name, args, ctx) : undefined;
      if (r !== undefined) return r;
      throw new PSError("Method invocation failed because [" + tn + "] does not contain a method named '" + name + "'.", { category: "InvalidOperation" });
    }
    var o = evalExpr(e.obj, ctx);
    return callMethod(o, name, args, ctx);
  }

  function callMethod(o, name, args, ctx) {
    var n = lc(name);
    if (o === null || o === undefined) throw new PSError("You cannot call a method on a null-valued expression.", { category: "InvalidOperation" });
    // intrinsic methods available on everything
    if (n === "where" || n === "foreach") {
      var list = enumerate(o);
      var sb = args[0];
      if (n === "where") return list.filter(function (x) { return toBool(callScriptBlock(sb, ctx, [], x, true)); });
      if (typeof sb === "string") return unwrapList(list.map(function (x) { return propertyOf(x, sb, ctx); }));
      var outp = [];
      list.forEach(function (x) { outp = outp.concat(enumerate(callScriptBlockList(sb, ctx, [], x))); });
      return outp;
    }
    if (n === "gettype") return obj("System.RuntimeType", { Name: shortType(typeOfValue(o)), FullName: typeOfValue(o), BaseType: Array.isArray(o) ? "System.Array" : "System.Object" });
    if (n === "tostring" && args.length === 0) return toStr(o);
    if (n === "equals") return cmpEq(o, args[0], true);
    if (n === "gethashcode") return 42;
    if (typeof o === "string") return stringMethod(o, n, name, args, ctx);
    if (typeof o === "number") {
      if (n === "tostring") return formatValue(o, toStr(args[0]));
      if (n === "compareto") return cmpOrder(o, args[0]);
    }
    if (Array.isArray(o) && o.__list) {
      switch (n) {
        case "add": o.push(args[0]); return o.__list === "arraylist" ? o.length - 1 : undefined;
        case "addrange": E_enum(args[0]).forEach(function (x) { o.push(x); }); return undefined;
        case "remove": for (var q = 0; q < o.length; q++) if (cmpEq(o[q], args[0], true)) { o.splice(q, 1); return o.__list === "list"; } return o.__list === "list" ? false : undefined;
        case "removeat": o.splice(toNumber(args[0]), 1); return undefined;
        case "insert": o.splice(toNumber(args[0]), 0, args[1]); return undefined;
        case "clear": o.length = 0; return undefined;
        case "toarray": return o.slice();
      }
    }
    if (Array.isArray(o)) {
      switch (n) {
        case "contains": return o.some(function (x) { return x === args[0] || (typeof x === typeof args[0] && cmpEq(x, args[0], true)); });
        case "indexof": for (var k = 0; k < o.length; k++) if (cmpEq(o[k], args[0], true)) return k; return -1;
        case "clone": return o.slice();
        case "add": throw new PSError("Exception calling \"Add\" with \"1\" argument(s): \"Collection was of a fixed size.\"", { category: "InvalidOperation" });
      }
      // method enumeration: call on each item
      return unwrapList(o.map(function (x) { return callMethod(x, name, args, ctx); }));
    }
    if (o instanceof PSHashtable) {
      switch (n) {
        case "containskey": return o.has(args[0]);
        case "containsvalue": return o.values().some(function (v) { return cmpEq(v, args[0], true); });
        case "add":
          if (o.has(args[0])) throw new PSError("Exception calling \"Add\" with \"2\" argument(s): \"Item has already been added. Key in dictionary: '" + toStr(args[0]) + "'  Key being added: '" + toStr(args[0]) + "'\"", { category: "InvalidOperation" });
          o.set(args[0], args[1]); return undefined;
        case "remove": o.remove(args[0]); return undefined;
        case "clear": o.map.clear(); return undefined;
        case "clone": { var h = new PSHashtable(o.ordered); o.entries().forEach(function (en) { h.set(en.key, en.value); }); return h; }
        case "getenumerator": return o.entries().map(function (en) { return obj("System.Collections.DictionaryEntry", { Name: en.key, Key: en.key, Value: en.value }); });
      }
    }
    if (o instanceof PSDate) {
      var x = o.d();
      switch (n) {
        case "adddays": return new PSDate(o.ms + toNumber(args[0]) * 86400000);
        case "addhours": return new PSDate(o.ms + toNumber(args[0]) * 3600000);
        case "addminutes": return new PSDate(o.ms + toNumber(args[0]) * 60000);
        case "addseconds": return new PSDate(o.ms + toNumber(args[0]) * 1000);
        case "addmonths": return new PSDate(Date.UTC(x.getUTCFullYear(), x.getUTCMonth() + toNumber(args[0]), x.getUTCDate(), x.getUTCHours(), x.getUTCMinutes(), x.getUTCSeconds()));
        case "addyears": return new PSDate(Date.UTC(x.getUTCFullYear() + toNumber(args[0]), x.getUTCMonth(), x.getUTCDate(), x.getUTCHours(), x.getUTCMinutes(), x.getUTCSeconds()));
        case "tostring": return formatDate(o, toStr(args[0]));
        case "toshortdatestring": return formatDate(o, "M/d/yyyy");
        case "tolongdatestring": return formatDate(o, "dddd, MMMM d, yyyy");
        case "subtract": return args[0] instanceof PSDate ? new PSTimeSpan(o.ms - args[0].ms) : new PSDate(o.ms - args[0].ms);
        case "compareto": return cmpOrder(o, args[0]);
        case "touniversaltime": case "tolocaltime": return o;
      }
    }
    if (o instanceof PSTimeSpan && n === "tostring") return spanString(o);
    if (o instanceof ScriptBlock && (n === "invoke" || n === "invokereturnasis")) return unwrap(callScriptBlockList(o, ctx, args, undefined));
    if (o instanceof PSObject) {
      if (o.methods && o.methods[n]) return o.methods[n].apply(o, [args, ctx]);
      var v = o.get(name);
      if (v instanceof ScriptBlock) return unwrap(callScriptBlockList(v, ctx, args, undefined, o));
    }
    if (o instanceof RegExp) {
      if (n === "ismatch") return o.test(toStr(args[0]));
      if (n === "replace") return toStr(args[0]).replace(new RegExp(o.source, "g" + o.flags.replace("g", "")), toStr(args[1]));
      if (n === "match") { var mm = o.exec(toStr(args[0])); return obj("System.Text.RegularExpressions.Match", { Success: !!mm, Value: mm ? mm[0] : "", Groups: mm ? Array.from(mm).map(function (g) { return obj("Group", { Value: g == null ? "" : g }); }) : [] }); }
    }
    throw new PSError("Method invocation failed because [" + typeOfValue(o) + "] does not contain a method named '" + name + "'.", { category: "InvalidOperation" });
  }
  function unwrapList(a) { return a; }
  function E_enum(v) { return enumerate(v); }

  function stringMethod(s, n, name, args, ctx) {
    var a0 = args.length ? args[0] : undefined;
    switch (n) {
      case "toupper": case "toupperinvariant": return s.toUpperCase();
      case "tolower": case "tolowerinvariant": return s.toLowerCase();
      case "trim": return trimChars(s, a0, true, true);
      case "trimstart": return trimChars(s, a0, true, false);
      case "trimend": return trimChars(s, a0, false, true);
      case "split": {
        var seps = Array.isArray(a0) ? a0.map(toStr) : a0 === undefined ? [" "] : [toStr(a0)];
        // .NET: a string separator (not char array) splits on the whole string in PowerShell 7
        var parts = [s];
        seps.forEach(function (sep) {
          var next = [];
          parts.forEach(function (p) { next = next.concat(sep === "" ? [p] : p.split(sep)); });
          parts = next;
        });
        if (args[1] !== undefined && lc(toStr(args[1])).indexOf("removeemptyentries") >= 0) parts = parts.filter(function (p) { return p !== ""; });
        return parts;
      }
      case "replace": return s.split(toStr(a0)).join(toStr(args[1]));
      case "contains": return s.indexOf(toStr(a0)) >= 0;
      case "startswith": return args[1] !== undefined && /ignorecase/i.test(toStr(args[1])) ? lc(s).indexOf(lc(toStr(a0))) === 0 : s.indexOf(toStr(a0)) === 0;
      case "endswith": { var t = toStr(a0); return args[1] !== undefined && /ignorecase/i.test(toStr(args[1])) ? lc(s).slice(-t.length) === lc(t) : t === "" || s.slice(-t.length) === t; }
      case "indexof": return s.indexOf(toStr(a0), args[1] === undefined ? 0 : toNumber(args[1]));
      case "lastindexof": return s.lastIndexOf(toStr(a0));
      case "substring": {
        var st = toNumber(a0), len = args[1] === undefined ? s.length - st : toNumber(args[1]);
        if (st < 0 || st > s.length || len < 0 || st + len > s.length) throw new PSError("Exception calling \"Substring\" with \"" + args.length + "\" argument(s): \"" + (st > s.length ? "startIndex cannot be larger than length of string." : "Index and length must refer to a location within the string.") + "\"", { category: "InvalidArgument" });
        return s.substr(st, len);
      }
      case "padleft": { var w = toNumber(a0), ch = args[1] === undefined ? " " : toStr(args[1]); var r = s; while (r.length < w) r = ch + r; return r; }
      case "padright": { var w2 = toNumber(a0), ch2 = args[1] === undefined ? " " : toStr(args[1]); var r2 = s; while (r2.length < w2) r2 += ch2; return r2; }
      case "insert": return s.slice(0, toNumber(a0)) + toStr(args[1]) + s.slice(toNumber(a0));
      case "remove": return args[1] === undefined ? s.slice(0, toNumber(a0)) : s.slice(0, toNumber(a0)) + s.slice(toNumber(a0) + toNumber(args[1]));
      case "tochararray": return s.split("");
      case "tostring": return s;
      case "compareto": return cmpOrder(s, a0, true);
      case "normalize": return s;
      case "equals": return s === toStr(a0);
    }
    throw new PSError("Method invocation failed because [System.String] does not contain a method named '" + name + "'.", { category: "InvalidOperation" });
  }
  function trimChars(s, chars, start, end) {
    var set = chars === undefined ? null : (Array.isArray(chars) ? chars.map(toStr).join("") : toStr(chars));
    var isTrim = function (c) { return set === null ? /\s/.test(c) : set.indexOf(c) >= 0; };
    var a = 0, b = s.length;
    if (start) while (a < b && isTrim(s[a])) a++;
    if (end) while (b > a && isTrim(s[b - 1])) b--;
    return s.slice(a, b);
  }

  /* ================================================================== Commands and pipelines */
  function runPipeline(p, ctx, sink) {
    var input = null; // null = no pipeline input (first command)
    for (var k = 0; k < p.elems.length; k++) {
      var el = p.elems[k];
      ctx.line = p.line || ctx.line;
      // The last command of a top-level pipeline writes straight to the screen sink (streaming).
      if (el.t === "cmd") input = invokeCommand(el, sink && k === p.elems.length - 1 ? ctx.child(null, { directOut: sink }) : ctx, input, k > 0);
      else {
        var v = evalExpr(el, ctx);
        if (el.t === "incdec" || v === undefined) input = [];
        else if (Array.isArray(v)) input = v.slice();
        else input = [v];
      }
    }
    return input || [];
  }

  // Bind command-line arguments into {named: Map(lcname -> {name, value}), positional: [..]}
  function evalArgs(cmd, ctx) {
    var named = [], positional = [];
    var args = cmd.args;
    for (var k = 0; k < args.length; k++) {
      var a = args[k];
      if (a.t === "param") {
        if (a.value !== undefined) { named.push({ name: a.name, value: evalExpr(a.value, ctx), explicit: true }); continue; }
        // A parameter takes the next argument as its value unless it's a switch; the command decides.
        named.push({ name: a.name, value: undefined, next: k + 1 < args.length && args[k + 1].t !== "param" && args[k + 1].t !== "splat" ? args[k + 1] : null, nextIndex: k + 1 });
        continue;
      }
      if (a.t === "splat") {
        var sv = getVar({ name: a.v }, ctx);
        if (sv instanceof PSHashtable) sv.entries().forEach(function (en) { named.push({ name: toStr(en.key), value: en.value, explicit: true }); });
        else enumerate(sv).forEach(function (x) { positional.push({ value: x }); });
        continue;
      }
      positional.push({ node: a, index: k });
    }
    return { named: named, positional: positional, raw: args };
  }

  function findCommand(name, ctx) {
    var s = ctx.session;
    var n = lc(name);
    // A module's private functions are visible only to the module's own functions.
    function visible(f) { return f && (!f.private || (ctx.fn && ctx.fn.module === f.module)); }
    if (s.mocks && s.mocks[n] && !ctx.inMock) return { kind: "cmdlet", def: s.mocks[n] };   // Pester's Mock
    if (visible(s.functions.get(n))) return { kind: "function", def: s.functions.get(n) };
    var lib = s.lib;
    var alias = (s.aliases && s.aliases[n]) || (lib.aliases && lib.aliases[n]);
    if (alias) n = lc(alias);
    if (visible(s.functions.get(n))) return { kind: "function", def: s.functions.get(n) };
    if (lib.cmdlets && lib.cmdlets[n]) return { kind: "cmdlet", def: lib.cmdlets[n] };
    return null;
  }

  function invokeCommand(cmd, ctx, input, hasInput) {
    ctx.session.step();
    var target;
    if (cmd.nameExpr) {
      var nv = evalExpr(cmd.nameExpr, ctx);
      if (nv instanceof ScriptBlock) {
        var argv = evalArgs(cmd, ctx);
        var vals = argv.positional.map(function (p) { return p.node ? evalExpr(p.node, ctx) : p.value; });
        return callScriptBlockList(nv, ctx, vals, undefined, undefined, hasInput ? input : null);
      }
      target = toStr(nv);
    } else target = cmd.name;
    var found = findCommand(target, ctx);
    // Script files, .cmd/.exe programs and pwsh itself (ps-run.js); dot-sourcing runs a script in the caller's scope.
    if (!found && ctx.session.lib.external) {
      var ext = ctx.session.lib.external(target, ctx, cmd);
      if (ext) return ext(evalArgs(cmd, ctx), hasInput ? input : null, !!cmd.dot);
    }
    if (!found) {
      throw new PSError("The term '" + target + "' is not recognized as a name of a cmdlet, function, script file, or executable program.\nCheck the spelling of the name, or if a path was included, verify that the path is correct and try again.",
        { category: "CommandNotFound", command: target });
    }
    var args = evalArgs(cmd, ctx);
    if (found.kind === "function") return callFunction(found.def, args, ctx, hasInput ? input : null, cmd);
    return callCmdlet(found.def, args, ctx, hasInput ? input : null, cmd);
  }

  // Resolve an abbreviated parameter name against a list of names (PowerShell accepts unique prefixes).
  function matchParam(given, names, cmdName) {
    var g = lc(given);
    for (var k = 0; k < names.length; k++) if (lc(names[k]) === g) return names[k];
    var hits = names.filter(function (n) { return lc(n).indexOf(g) === 0; });
    if (hits.length === 1) return hits[0];
    if (hits.length > 1) throw new PSError("Parameter cannot be processed because the parameter name '" + given + "' is ambiguous. Possible matches include: -" + hits.join(" -") + ".", { category: "InvalidArgument", command: cmdName });
    return null;
  }

  var COMMON = ["Verbose", "Debug", "ErrorAction", "WarningAction", "InformationAction", "ErrorVariable", "OutVariable", "OutBuffer", "PipelineVariable", "WhatIf", "Confirm"];

  // Turn raw args into named values using a parameter spec: [{name, type:'switch'|..., position, aliases}]
  function bindArgs(spec, args, ctx, cmdName, opts) {
    opts = opts || {};
    var bound = {}, used = {};
    var names = spec.map(function (p) { return p.name; });
    var allNames = names.concat(opts.common ? COMMON : []);
    var aliasMap = {};
    spec.forEach(function (p) { (p.aliases || []).forEach(function (a) { aliasMap[lc(a)] = p.name; }); });
    var consumed = {};
    args.named.forEach(function (a) {
      var pn = aliasMap[lc(a.name)] || matchParam(a.name, allNames, cmdName);
      if (!pn) throw new PSError("A parameter cannot be found that matches parameter name '" + a.name + "'.", { category: "InvalidArgument", command: cmdName });
      var p = spec.filter(function (x) { return x.name === pn; })[0];
      var isSwitch = (p && p.type === "switch") || (!p && ["Verbose", "Debug", "WhatIf", "Confirm"].indexOf(pn) >= 0);
      var val;
      if (a.value !== undefined) val = a.value;
      else if (isSwitch) val = true;
      else if (a.next) { val = evalExpr(a.next, ctx); consumed[a.nextIndex] = true; }
      else throw new PSError("Missing an argument for parameter '" + pn + "'. Specify a parameter of type '" + ((p && p.typeLabel) || "System.Object") + "' and try again.", { category: "InvalidArgument", command: cmdName });
      if (used[lc(pn)]) throw new PSError("Cannot bind parameter because parameter '" + pn + "' is specified more than once.", { category: "InvalidArgument", command: cmdName });
      used[lc(pn)] = true;
      bound[lc(pn)] = val;
    });
    var posVals = args.positional.filter(function (p) { return !consumed[p.index]; }).map(function (p) { return p.node ? evalExpr(p.node, ctx) : p.value; });
    var posParams = spec.filter(function (p) { return p.position != null && !used[lc(p.name)] && p.type !== "switch"; }).sort(function (a, b) { return a.position - b.position; });
    var extra = [];
    posVals.forEach(function (v) {
      var p = posParams.shift();
      if (p) { bound[lc(p.name)] = v; used[lc(p.name)] = true; }
      else extra.push(v);
    });
    if (extra.length && !opts.allowExtra) {
      throw new PSError("A positional parameter cannot be found that accepts argument '" + toStr(extra[0]) + "'.", { category: "InvalidArgument", command: cmdName });
    }
    bound.__extra = extra;
    return bound;
  }

  function callCmdlet(def, args, ctx, input, cmd) {
    var bound = bindArgs(def.params || [], args, ctx, def.name, { common: true, allowExtra: !!def.allowExtra });
    var cctx = ctx.child(null, { cmdName: def.name });
    cctx.errorAction = bound.erroraction ? toStr(bound.erroraction) : toStr(ctx.pref("ErrorActionPreference") || "Continue");
    cctx.whatIf = bound.whatif !== undefined ? toBool(bound.whatif) : toBool(ctx.pref("WhatIfPreference"));
    cctx.verbose = bound.verbose !== undefined ? toBool(bound.verbose) : lc(toStr(ctx.pref("VerbosePreference"))) === "continue";
    if (def.streams && ctx.directOut) cctx.directOut = ctx.directOut;
    var out = def.run(bound, input, cctx);
    return out || [];
  }

  // Non-terminating error from a cmdlet: respects -ErrorAction.
  function writeCmdletError(ctx, message, category, target) {
    var ea = lc(ctx.errorAction || "continue");
    var e = new PSError(message, { category: category || "NotSpecified", command: ctx.cmdName, line: ctx.line, target: target });
    if (ea === "stop") { e.scriptTerminating = false; e.stopAction = true; throw e; }
    var errs = ctx.session.global.lookup("Error").value;
    errs.unshift(errorRecord(e));
    if (ea === "silentlycontinue" || ea === "ignore") return;
    ctx.session.writeError(e, ctx);
  }

  function defineFunction(st, ctx) {
    var def = st.def;
    var params = (def.params || []).map(function (p) { return compileParam(p); });
    ctx.session.functions.set(lc(st.name), { name: st.name, def: def, params: params, text: st.text, advanced: !!def.binding || params.some(function (p) { return p.isParameterAttr; }) });
  }
  function compileParam(p) {
    var c = { name: p.name, type: p.type ? lc(p.type) : null, typeName: p.type, dflt: p.dflt, mandatory: false, position: null, pipeline: false, byProp: false, validate: [], aliases: [], isParameterAttr: false };
    p.attrs.forEach(function (a) {
      var an = lc(a.name);
      if (an === "parameter") {
        c.isParameterAttr = true;
        a.args.forEach(function (x) {
          var n = lc(x.name || "");
          var v = x.value;
          var val = v && v.t === "const" ? v.v : v && v.t === "var" ? lc(v.name) !== "false" : true;
          if (n === "mandatory") c.mandatory = val !== false;
          if (n === "position") c.position = v && v.t === "const" ? v.v : 0;
          if (n === "valuefrompipeline") c.pipeline = val !== false;
          if (n === "valuefrompipelinebypropertyname") c.byProp = val !== false;
        });
      } else if (an === "alias") c.aliases = a.args.map(function (x) { return x.value && x.value.t === "const" ? x.value.v : ""; });
      else if (an.indexOf("validate") === 0 || an === "allownull" || an === "allowemptystring") c.validate.push(a);
    });
    return c;
  }

  function validateParam(p, v, ctx, fname) {
    p.validate.forEach(function (a) {
      var an = lc(a.name);
      var vals = a.args.map(function (x) { return evalExpr(x.value, ctx); });
      var items = Array.isArray(v) ? v : [v];
      var shown = function (x) { return toStr(x); };
      if (an === "validateset") {
        var set = vals.map(toStr);
        items.forEach(function (x) {
          if (!set.some(function (s) { return lc(s) === lc(toStr(x)); })) throw new PSError("Cannot validate argument on parameter '" + p.name + "'. The argument \"" + shown(x) + "\" does not belong to the set \"" + set.join(",") + "\" specified by the ValidateSet attribute. Supply an argument that is in the set and then try the command again.", { category: "InvalidData", command: fname });
        });
      } else if (an === "validaterange") {
        items.forEach(function (x) {
          var n = toNumber(x), lo = toNumber(vals[0]), hi = toNumber(vals[1]);
          if (n < lo) throw new PSError("Cannot validate argument on parameter '" + p.name + "'. The " + shown(x) + " argument is less than the minimum allowed range of " + lo + ". Supply an argument that is greater than or equal to " + lo + " and then try the command again.", { category: "InvalidData", command: fname });
          if (n > hi) throw new PSError("Cannot validate argument on parameter '" + p.name + "'. The " + shown(x) + " argument is greater than the maximum allowed range of " + hi + ". Supply an argument that is less than or equal to " + hi + " and then try the command again.", { category: "InvalidData", command: fname });
        });
      } else if (an === "validatenotnullorempty" || an === "validatenotnull") {
        if (v === null || v === undefined || v === "" || (Array.isArray(v) && !v.length)) throw new PSError("Cannot validate argument on parameter '" + p.name + "'. The argument is null or empty. Provide an argument that is not null or empty, and then try the command again.", { category: "InvalidData", command: fname });
      } else if (an === "validatepattern") {
        var re = netRegex(toStr(vals[0]), "i");
        items.forEach(function (x) {
          if (!re.test(toStr(x))) throw new PSError("Cannot validate argument on parameter '" + p.name + "'. The argument \"" + shown(x) + "\" does not match the \"" + toStr(vals[0]) + "\" pattern. Supply an argument that matches \"" + toStr(vals[0]) + "\" and try the command again.", { category: "InvalidData", command: fname });
        });
      } else if (an === "validatescript") {
        items.forEach(function (x) {
          if (!toBool(callScriptBlock(vals[0], ctx, [], x, true))) throw new PSError("Cannot validate argument on parameter '" + p.name + "'. The \"" + toStr(vals[0]) + "\" validation script for the argument with value \"" + shown(x) + "\" did not return a result of True. Determine why the validation script failed, and then try the command again.", { category: "InvalidData", command: fname });
        });
      } else if (an === "validatelength") {
        items.forEach(function (x) {
          var L = toStr(x).length;
          if (L < toNumber(vals[0]) || L > toNumber(vals[1])) throw new PSError("Cannot validate argument on parameter '" + p.name + "'. The character length of the " + L + " argument is " + (L < toNumber(vals[0]) ? "too short. Shorten" : "too long. Shorten") + " the character length of the argument so it is fewer than or equal to \"" + toNumber(vals[1]) + "\" characters, and then try the command again.", { category: "InvalidData", command: fname });
        });
      }
    });
  }

  function convertParam(p, v, ctx, fname) {
    if (!p.type || p.type === "object") return v;
    try { return convertTo(v, p.typeName, ctx); }
    catch (e) {
      throw new PSError("Cannot process argument transformation on parameter '" + p.name + "'. " + e.message, { category: "InvalidArgument", command: fname });
    }
  }

  function callFunction(fn, args, ctx, input, cmd) {
    var session = ctx.session;
    var params = fn.params;
    var spec = params.map(function (p, i) {
      return { name: p.name, type: p.type === "switch" ? "switch" : null, position: p.position != null ? p.position : (fn.advanced ? null : i), aliases: p.aliases, typeLabel: p.typeName };
    });
    // Simple functions without [Parameter()] attributes take positional arguments in order.
    if (fn.advanced) spec.forEach(function (s, i) { if (params[i].position == null && !params.some(function (p) { return p.position != null; })) s.position = params[i].type === "switch" ? null : i; });
    var bound = bindArgs(spec, args, ctx, fn.name, { common: fn.advanced, allowExtra: !fn.advanced });
    var scope = new Scope(ctx.scope);
    var fctx = new Ctx(session, scope);
    fctx.fn = fn;
    fctx.inTry = 0;
    fctx.line = ctx.line;
    if (bound.verbose !== undefined) scope.setLocal("VerbosePreference", toBool(bound.verbose) ? "Continue" : "SilentlyContinue");
    if (bound.whatif !== undefined) scope.setLocal("WhatIfPreference", toBool(bound.whatif));
    if (bound.erroraction !== undefined) scope.setLocal("ErrorActionPreference", toStr(bound.erroraction));
    scope.setLocal("args", bound.__extra || []);
    scope.setLocal("PSBoundParameters", (function () { var h = new PSHashtable(); params.forEach(function (p) { if (bound[lc(p.name)] !== undefined) h.set(p.name, bound[lc(p.name)]); }); return h; })());
    if (fn.advanced || fn.def.binding) {
      var whatIf = toBool(scope.lookup("WhatIfPreference").value);
      scope.setLocal("PSCmdlet", makePSCmdlet(fn, fctx));
    }
    var pipeParam = params.filter(function (p) { return p.pipeline; })[0];
    var byPropParams = params.filter(function (p) { return p.byProp; });

    // bind non-pipeline values, defaults, mandatory checks
    function bindValues(item, hasItem) {
      params.forEach(function (p) {
        var k = lc(p.name);
        var v = bound[k];
        var fromPipe = false;
        if (v === undefined && hasItem) {
          if (pipeParam === p) { v = item; fromPipe = true; }
          else if (byPropParams.indexOf(p) >= 0) { var pv = propertyOf(item, p.name, fctx); if (pv !== null && pv !== undefined) { v = pv; fromPipe = true; } }
        }
        if (v === undefined) {
          if (p.mandatory) {
            var missing = params.filter(function (q) { return q.mandatory && bound[lc(q.name)] === undefined && !(hasItem && (q === pipeParam || byPropParams.indexOf(q) >= 0)); }).map(function (q) { return q.name; });
            if (!missing.length) missing = [p.name];
            throw new PSError("Cannot process command because of one or more missing mandatory parameters: " + missing.join(" ") + ".", { category: "InvalidArgument", command: fn.name });
          }
          if (p.dflt) v = evalExpr(p.dflt, fctx);
          else v = p.type === "switch" ? false : (p.type ? defaultFor(p.type) : null);
          scope.setLocal(p.name, v);
          if (p.type && v !== null) scope.vars.get(lc(p.name)).type = p.typeName;
          return;
        }
        if (p.type === "switch") v = toBool(v);
        else v = convertParam(p, v, fctx, fn.name);
        if (v === null && p.mandatory && !fromPipe) throw new PSError("Cannot bind argument to parameter '" + p.name + "' because it is null.", { category: "InvalidData", command: fn.name });
        validateParam(p, v, fctx, fn.name);
        scope.setLocal(p.name, v);
        if (p.type && p.type !== "switch") scope.vars.get(lc(p.name)).type = p.typeName;
      });
    }

    var direct = ctx.directOut || null;
    var out = direct || [];
    var def = fn.def;
    function runBlock(b) {
      if (!b) return;
      try { execBlock(b, fctx, out); }
      catch (e) { if (e instanceof ReturnSignal) return "returned"; throw e; }
    }
    var items = input === null ? null : input;
    if (def.process) {
      if (items === null) {
        runBlock(def.begin);
        bindValues(null, false);
        scope.setLocal("_", null);
        runBlock(def.process);
        runBlock(def.end);
      } else {
        if (items.length) bindValues(items[0], true); else bindValues(null, false);
        runBlock(def.begin);
        for (var k = 0; k < items.length; k++) {
          session.step();
          bindValues(items[k], true);
          scope.setLocal("_", items[k]);
          scope.setLocal("PSItem", items[k]);
          runBlock(def.process);
        }
        runBlock(def.end);
      }
    } else {
      scope.setLocal("input", items || []);
      bindValues(items && items.length ? items[items.length - 1] : null, !!(items && items.length && pipeParam));
      runBlock(def.begin);
      runBlock(def.end);
    }
    return direct ? [] : out;
  }
  function defaultFor(t) {
    if (/^(int|int32|long|double|decimal|byte)$/.test(t)) return 0;
    if (t === "string") return "";
    if (t === "bool" || t === "boolean") return false;
    return null;
  }
  function makePSCmdlet(fn, fctx) {
    var o = new PSObject("System.Management.Automation.PSScriptCmdlet");
    o.methods = {
      shouldprocess: function (args) {
        var target = toStr(args[0]), action = args.length > 1 ? toStr(args[1]) : fn.name;
        var wi = fctx.scope.lookup("WhatIfPreference");
        if (wi && toBool(wi.value)) {
          fctx.session.write("What if: Performing the operation \"" + action + "\" on target \"" + target + "\".", "whatif");
          return false;
        }
        return true;
      },
      writeverbose: function (args) { writeVerbose(fctx, toStr(args[0])); },
      throwterminatingerror: function (args) { throw new PSError(toStr(args[0]), { scriptTerminating: true }); }
    };
    o.set("MyInvocation", obj("System.Management.Automation.InvocationInfo", { MyCommand: fn.name, InvocationName: fn.name }));
    return o;
  }
  function writeVerbose(ctx, msg) {
    var v = ctx.scope.lookup("VerbosePreference");
    if (ctx.verbose || (v && lc(toStr(v.value)) === "continue")) ctx.session.write("VERBOSE: " + msg, "verbose");
  }

  // Run a script block with $_ set (Where-Object, ForEach-Object, calculated properties...). Returns its output list.
  function callScriptBlockList(sb, ctx, args, dollarUnder, thisObj, input) {
    if (!(sb instanceof ScriptBlock)) {
      if (sb === null || sb === undefined) throw new PSError("Cannot bind argument because it is null: a script block { ... } was expected.", { category: "InvalidArgument" });
      throw new PSError("Cannot convert the \"" + toStr(sb) + "\" value of type \"" + typeOfValue(sb) + "\" to type \"System.Management.Automation.ScriptBlock\". Use { } around the code.", { category: "InvalidArgument" });
    }
    var scope = new Scope(ctx.scope);
    var sctx = new Ctx(ctx.session, scope);
    sctx.fn = ctx.fn; sctx.inTry = ctx.inTry; sctx.line = ctx.line; sctx.verbose = ctx.verbose;
    if (dollarUnder !== undefined) { scope.setLocal("_", dollarUnder); scope.setLocal("PSItem", dollarUnder); }
    if (thisObj !== undefined) scope.setLocal("this", thisObj);
    scope.setLocal("args", args || []);
    if (input) scope.setLocal("input", input);
    if (sb.params) {
      sb.params.forEach(function (p, i) {
        var cp = compileParam(p);
        var v = args && i < args.length ? args[i] : (p.dflt ? evalExpr(p.dflt, sctx) : null);
        if (cp.type && v !== null) v = convertParam(cp, v, sctx, "scriptblock");
        scope.setLocal(p.name, v);
      });
    }
    var out = [];
    try { execBlock(sb.block, sctx, out); }
    catch (e) { if (!(e instanceof ReturnSignal)) throw e; }
    return out;
  }
  function callScriptBlock(sb, ctx, args, dollarUnder, single) {
    var o = callScriptBlockList(sb, ctx, args, dollarUnder);
    return single ? unwrap(o) : o;
  }

  function bindScriptParams(st, ctx) {
    // param() at the top of a script: no arguments in the lab, so defaults only.
    st.params.forEach(function (p) {
      var cp = compileParam(p);
      var v = p.dflt ? evalExpr(p.dflt, ctx) : (cp.type === "switch" ? false : null);
      ctx.scope.setLocal(p.name, v);
    });
  }

  /* ================================================================== Running scripts */
  function runScript(session, src, opts) {
    opts = opts || {};
    var ast;
    try { ast = parse(src); }
    catch (e) {
      if (e instanceof ParseError) {
        var pe = { message: e.message, line: e.line, category: "ParseError", command: null };
        session.errors.push(pe);
        session.write("ParserError: line " + e.line + ": " + e.message, "err");
        return { error: pe, exit: 1, parseError: true };
      }
      throw e;
    }
    var ctx = new Ctx(session, session.scriptScope);
    var exitCode = 0, error = null, paused = null;
    try {
      var stmts = ast.stmts;
      for (var k = 0; k < stmts.length; k++) {
        var st = stmts[k];
        var out = makeSink(session);
        session.activeSink = out;
        try {
          session.step();
          execStatement(st, ctx, out);
        } catch (e) {
          if (e instanceof PSError) {
            if (!e.line) e.line = st.line;
            if (e.scriptTerminating || e.stopAction) {
              out.flush();
              session.activeSink = null;
              throw e;
            }
            session.writeError(e, ctx);
          } else { out.flush(); session.activeSink = null; throw e; }
        }
        out.flush();
        session.activeSink = null;
        session.stmtIndex = k + 1;
      }
    } catch (e) {
      if (e instanceof ExitSignal) exitCode = e.code;
      else if (e instanceof BreakSignal || e instanceof ContinueSignal || e instanceof ReturnSignal) { /* top level: just stop */ }
      else if (e && e.isPause) { paused = e.request; }
      else if (e instanceof StepLimit) {
        error = { message: "Your script ran for over " + session.maxSteps.toLocaleString("en-US") + " steps without finishing, so it was stopped. This is usually an infinite loop: a loop whose condition never becomes $false.", line: ctx.line, category: "StepLimit" };
        session.write(error.message, "err");
        exitCode = 1;
      }
      else if (e instanceof PSError) {
        error = { message: e.message, line: e.line, category: e.category, command: e.command };
        session.errors.push(error);
        var thrownObj = e.thrown;
        session.write((e.line ? "line " + e.line + ": " : "") + (e.command ? e.command + ": " : "") + e.message, "err");
        exitCode = 1;
      } else {
        error = { message: "Internal error in the PowerShell simulator: " + (e && e.message || e), line: ctx.line, category: "Internal" };
        session.write(error.message, "err");
        exitCode = 1;
      }
    }
    if (session.pendingHost) { session.write(session.pendingHost); session.pendingHost = ""; }
    return { error: error, exit: exitCode, pause: paused };
  }
  function flushOutput(session, items, opts) {
    if (!items.length) return;
    if (session.pendingHost) { session.write(session.pendingHost); session.pendingHost = ""; }
    var text = formatItems(items, session);
    if (text !== null && text !== undefined && text !== "") session.write(text, "");
  }

  /* ================================================================== Out-Default formatting */
  function displayProps(o) {
    var lib = root.PSEngine.lib;
    if (o instanceof PSObject && lib.views && lib.views[o.typeName]) return lib.views[o.typeName];
    return null;
  }
  function cellText(v) {
    if (v === null || v === undefined) return "";
    if (Array.isArray(v)) {
      var s = "{" + v.slice(0, 4).map(function (x) { return toStr(x); }).join(", ") + (v.length > 4 ? "…" : "") + "}";
      return s;
    }
    if (v instanceof PSDate) return dateShort(v);
    if (v instanceof PSHashtable) return "{" + v.keys().map(toStr).join(", ") + "}";
    if (v instanceof ScriptBlock) return v.text.trim();
    if (v instanceof PSObject && v.typeName === "System.Management.Automation.PSCustomObject") return toStr(v);
    return toStr(v);
  }
  function columnsFor(o) {
    var view = displayProps(o);
    if (view) return view.filter(function (c) { return typeof c !== "string" || !(o instanceof PSObject) || o.has(c); })
      .map(function (c) { return typeof c === "string" ? { header: c, get: function (x) { return x.get(c); } } : c; });
    if (o instanceof PSObject) return o.props.map(function (p) { return { header: p.name, get: function (x) { var v = x.get(p.name); return v === undefined ? null : v; } }; });
    return null;
  }
  function shapeKey(o) {
    if (o instanceof PSHashtable) return "#hash";
    if (!(o instanceof PSObject)) return null;
    var sl = root.PSEngine.lib.stringTypes;
    if (sl && sl[o.typeName]) return null; // shown as text, like Select-String's file:line:text
    return o.typeName + "|" + (displayProps(o) ? "view" : o.names().join(","));
  }
  function formatItems(items, session, forceKind) {
    var lines = [];
    var k = 0;
    while (k < items.length) {
      var it = items[k];
      if (it === undefined || it === null) { k++; continue; }
      var key = shapeKey(it);
      if (key === null) {
        lines.push(scalarText(it));
        k++;
        continue;
      }
      var group = [it];
      while (k + group.length < items.length && shapeKey(items[k + group.length]) === key) group.push(items[k + group.length]);
      k += group.length;
      if (it instanceof PSHashtable) {
        group.forEach(function (h) { lines.push(""); lines.push(tableText(h.entries().map(function (e) { return obj("Entry", { Name: e.key, Value: e.value }); }), [{ header: "Name", get: function (x) { return x.get("Name"); } }, { header: "Value", get: function (x) { return x.get("Value"); } }])); });
        continue;
      }
      var cols = columnsFor(it);
      var lib = root.PSEngine.lib;
      var kind = forceKind || (lib.listTypes && lib.listTypes[it.typeName] ? "list" : cols.length > 4 && !displayProps(it) ? "list" : "table");
      if (kind === "list") group.forEach(function (o) { lines.push(""); lines.push(listText(o, columnsFor(o))); });
      else {
        lines.push("");
        var hdr = lib.tableHeader && lib.tableHeader(it);
        if (hdr) { lines.push(hdr); lines.push(""); }
        lines.push(tableText(group, cols));
      }
    }
    if (lines.length && lines[0] === "") lines.shift();
    var text = lines.join("\n");
    if (/\S/.test(text) && items.some(function (x) { return x instanceof PSObject || x instanceof PSHashtable; })) text = "\n" + text + "\n";
    return text;
  }
  function scalarText(v) {
    if (v === null) return "";
    if (v instanceof PSDate) return "\n" + dateLong(v) + "\n";
    if (v instanceof PSTimeSpan) {
      var fields = ["Days", "Hours", "Minutes", "Seconds", "Milliseconds", "Ticks", "TotalDays", "TotalHours", "TotalMinutes", "TotalSeconds", "TotalMilliseconds"];
      var vals = fields.map(function (f) { return f === "Ticks" ? v.ms * 10000 : propertyOf(v, f); });
      return "\n" + fields.map(function (f, i) { return (f + "                 ").slice(0, 17) + " : " + toStr(vals[i]); }).join("\n") + "\n";
    }
    if (v instanceof ScriptBlock) return v.text;
    if (v instanceof PSType) return "\nIsPublic IsSerial Name\n-------- -------- ----\nTrue     True     " + shortType("System." + v.name) + "\n";
    return toStr(v);
  }
  function isNumeric(v) { return typeof v === "number"; }
  function tableText(rows, cols) {
    var cells = rows.map(function (r) { return cols.map(function (c) { var v = c.get(r); return { s: cellText(v), num: isNumeric(v) }; }); });
    var widths = cols.map(function (c, i) {
      var w = c.header.length;
      cells.forEach(function (row) { w = Math.max(w, row[i].s.length); });
      return Math.min(w, 60);
    });
    var numCol = cols.map(function (c, i) { return cells.length > 0 && cells.every(function (row) { return row[i].num || row[i].s === ""; }) && cells.some(function (row) { return row[i].num; }); });
    function cut(s, w) { return s.length > w ? s.slice(0, w - 1) + "…" : s; }
    function padCell(s, w, right, last) { s = cut(s, w); if (right) { while (s.length < w) s = " " + s; return s; } if (last) return s; while (s.length < w) s += " "; return s; }
    var out = [];
    out.push(cols.map(function (c, i) { return padCell(c.header, widths[i], numCol[i], i === cols.length - 1); }).join(" ").replace(/\s+$/, ""));
    out.push(cols.map(function (c, i) { var d = "-".repeat(c.header.length); return padCell(d, widths[i], numCol[i], i === cols.length - 1); }).join(" ").replace(/\s+$/, ""));
    cells.forEach(function (row) { out.push(row.map(function (cell, i) { return padCell(cell.s, widths[i], numCol[i], i === cols.length - 1); }).join(" ").replace(/\s+$/, "")); });
    return out.join("\n");
  }
  function listText(o, cols) {
    var w = 0;
    cols.forEach(function (c) { w = Math.max(w, c.header.length); });
    return cols.map(function (c) { var h = c.header; while (h.length < w) h += " "; return h + " : " + cellText(c.get(o)); }).join("\n");
  }

  /* ================================================================== Public API */
  function newSession(opts) { return new Session(opts); }
  // Evaluate code in an existing session (console / checks). Returns {items, text, errors}.
  function evalIn(session, src, opts) {
    var before = session.parts.length, errBefore = session.errors.length;
    var ast;
    try { ast = parse(src); }
    catch (e) {
      if (e instanceof ParseError) {
        session.write("ParserError: " + e.message, "err");
        return { items: [], errors: [e.message], parts: session.parts.slice(before), parseError: true };
      }
      throw e;
    }
    var ctx = new Ctx(session, session.scriptScope);
    var items = [];
    try {
      ast.stmts.forEach(function (st) {
        var quiet = opts && opts.quiet;
        var out = quiet ? [] : makeSink(session);
        if (!quiet) session.activeSink = out;
        try { execStatement(st, ctx, out); }
        catch (e) {
          if (e instanceof PSError && !e.scriptTerminating && !e.stopAction) { if (!e.line) e.line = st.line; session.writeError(e, ctx); }
          else { if (!quiet) { out.flush(); session.activeSink = null; } throw e; }
        }
        if (!quiet) { out.flush(); session.activeSink = null; }
        items = items.concat(quiet ? out : out.all);
      });
    } catch (e) {
      if (e instanceof PSError) { session.errors.push({ message: e.message, line: e.line, category: e.category }); session.write((e.command ? e.command + ": " : "") + e.message, "err"); }
      else if (e instanceof StepLimit) session.write("Stopped: the command ran too long (an infinite loop?).", "err");
      else if (e instanceof ExitSignal || e instanceof ReturnSignal || e instanceof BreakSignal || e instanceof ContinueSignal) { /* ignore */ }
      else throw e;
    }
    return { items: items, parts: session.parts.slice(before), errors: session.errors.slice(errBefore).map(function (x) { return x.message; }) };
  }

  var api = {
    parse: parse, newSession: newSession, runScript: runScript, evalIn: evalIn,
    PSError: PSError, ParseError: ParseError, PSHashtable: PSHashtable, PSObject: PSObject, PSDate: PSDate, PSTimeSpan: PSTimeSpan,
    ScriptBlock: ScriptBlock, PSType: PSType, PSVersion: PSVersion, obj: obj,
    toStr: toStr, toBool: toBool, toNumber: toNumber, convertTo: convertTo, typeOfValue: typeOfValue, shortType: shortType,
    cmpEq: cmpEq, cmpOrder: cmpOrder, wildcardRe: wildcardRe, netRegex: netRegex, propertyOf: propertyOf, callMethod: callMethod,
    callScriptBlockList: callScriptBlockList, callScriptBlock: callScriptBlock, formatItems: formatItems, formatValue: formatValue, formatDate: formatDate,
    formatOperator: formatOperator, writeCmdletError: writeCmdletError, writeVerbose: writeVerbose, bindArgs: bindArgs, enumerate: enumerate, unwrap: unwrap,
    roundEven: roundEven, parseDate: parseDate, dateLong: dateLong, isType: isType, lc: lc, evalExpr: evalExpr, Scope: Scope, Ctx: Ctx, tableText: tableText, listText: listText,
    cellText: cellText, columnsFor: columnsFor, errorRecord: errorRecord, findCommand: findCommand, setMatches: setMatches,
    execBlock: execBlock, ReturnSignal: ReturnSignal, ExitSignal: ExitSignal, callFunction: callFunction, compileParam: compileParam,
    evalArgs: evalArgs, makeSink: makeSink, flushOutput: flushOutput, BreakSignal: BreakSignal, ContinueSignal: ContinueSignal, StepLimit: StepLimit,
    lib: (root.PSEngine && root.PSEngine.lib) || {}
  };
  root.PSEngine = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
