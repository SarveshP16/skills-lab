/* sudo learn — DevOps Module 3: HCL for the simulated Terraform. A lexer and parser for the Terraform language
   (blocks, attributes, template strings with ${...}, heredocs, lists, objects, for expressions, splats,
   conditionals and operators), an evaluator with unknown values ("known after apply") and sensitivity
   tracking, the common built-in functions, and `terraform fmt`. Errors use Terraform's boxed format. */
(function (root) {
  "use strict";
  var IAC = root.IAC = root.IAC || {};
  function keys(o) { return o ? Object.keys(o) : []; }

  /* ================================================================== diagnostics */
  function TfErr(summary, detail, at, extra) { this.summary = summary; this.detail = detail || ""; this.at = at || null; this.extra = extra || null; this.message = summary; }
  IAC.TfErr = TfErr;
  // at: {file, line, ctx (e.g. 'in resource "aws_s3_bucket" "x"'), src}
  function box(errs, warn) {
    return errs.map(function (e) {
      var L = ["╷", "│ " + (warn ? "Warning: " : "Error: ") + e.summary, "│ "];
      if (e.at && e.at.file) {
        L.push("│   on " + e.at.file + " line " + e.at.line + (e.at.ctx ? ", " + e.at.ctx : "") + ":");
        var src = e.at.src ? String(e.at.src).split("\n")[e.at.line - 1] : null;
        if (src != null) L.push("│   " + String(e.at.line).padStart(2) + ": " + src.replace(/\s+$/, ""));
        L.push("│ ");
      }
      String(e.detail || "").split("\n").forEach(function (l) { L.push("│ " + l); });
      L.push("╵");
      return L.join("\n").replace(/│ \n╵$/, "╵");
    }).join("\n") + "\n";
  }
  IAC.box = box;

  /* ================================================================== lexer */
  function lex(text, file) {
    var t = [], i = 0, line = 1, n = text.length;
    function push(type, v, extra) { var o = { t: type, v: v, line: line }; if (extra) for (var k in extra) o[k] = extra[k]; t.push(o); }
    while (i < n) {
      var ch = text.charAt(i);
      if (ch === "\n") { push("nl"); line++; i++; continue; }
      if (ch === " " || ch === "\t" || ch === "\r") { i++; continue; }
      if (ch === "#" || text.substr(i, 2) === "//") { while (i < n && text.charAt(i) !== "\n") i++; continue; }
      if (text.substr(i, 2) === "/*") { var e = text.indexOf("*/", i + 2); var blk = text.slice(i, e < 0 ? n : e + 2); line += (blk.match(/\n/g) || []).length; i = e < 0 ? n : e + 2; continue; }
      if (ch === "\"") {
        var j = i + 1, depth = 0, startLine = line;
        while (j < n) {
          var c = text.charAt(j);
          if (c === "\\") { j += 2; continue; }
          if (c === "\n" && depth === 0) throw new TfErr("Invalid multi-line string", "Quoted strings may not be split over multiple lines. To produce a multi-line string, either use the \\n escape to represent a newline character or use the \"heredoc\" multi-line template syntax.", { file: file, line: line, src: text });
          if (c === "\n") line++;
          if (text.substr(j, 2) === "${" || text.substr(j, 2) === "%{") { if (text.charAt(j - 1) !== "$" && text.charAt(j - 1) !== "%") { depth++; j += 2; continue; } }
          if (c === "}" && depth > 0) { depth--; j++; continue; }
          if (c === "\"" && depth === 0) break;
          j++;
        }
        if (j >= n) throw new TfErr("Unterminated template string", "No closing marker was found for the string.", { file: file, line: startLine, src: text });
        t.push({ t: "str", raw: text.slice(i + 1, j), line: startLine });
        i = j + 1; continue;
      }
      if (text.substr(i, 2) === "<<") {
        var hm = /^<<(-?)([A-Za-z_][A-Za-z0-9_]*)[ \t]*\r?\n/.exec(text.slice(i));
        if (hm) {
          var startL = line, bodyStart = i + hm[0].length, lines = [], p = bodyStart, found = false;
          line++;
          while (p < n) {
            var e2 = text.indexOf("\n", p); var ln = text.slice(p, e2 < 0 ? n : e2);
            if (ln.trim() === hm[2]) { found = true; p = e2 < 0 ? n : e2; break; }
            lines.push(ln); line++; p = e2 < 0 ? n : e2 + 1;
          }
          if (!found) throw new TfErr("Unterminated template string", "No closing marker was found for the string.", { file: file, line: startL, src: text });
          if (hm[1]) { var ind = Math.min.apply(null, lines.filter(function (l) { return l.trim(); }).map(function (l) { return /^\s*/.exec(l)[0].length; }).concat([1e9])); if (ind < 1e9) lines = lines.map(function (l) { return l.slice(Math.min(ind, /^\s*/.exec(l)[0].length)); }); }
          t.push({ t: "str", raw: lines.join("\n") + "\n", line: startL, heredoc: true });
          i = p; continue;
        }
      }
      var m;
      if ((m = /^[0-9]+(\.[0-9]+)?([eE][+-]?[0-9]+)?/.exec(text.slice(i, i + 40)))) { push("num", +m[0]); i += m[0].length; continue; }
      if ((m = /^[A-Za-z_][A-Za-z0-9_-]*/.exec(text.slice(i, i + 200)))) { push("id", m[0]); i += m[0].length; continue; }
      var three = text.substr(i, 3), two = text.substr(i, 2);
      if (three === "...") { push("..."); i += 3; continue; }
      if (["==", "!=", "<=", ">=", "&&", "||", "=>"].indexOf(two) >= 0) { push(two); i += 2; continue; }
      if ("{}[]()=,.:?!+-*/%<>".indexOf(ch) >= 0) { push(ch); i++; continue; }
      throw new TfErr("Invalid character", "This character is not used within the language.", { file: file, line: line, src: text });
    }
    push("eof");
    return t;
  }

  /* ================================================================== templates */
  function unescape(s) { return s.replace(/\\(["\\nrt]|u[0-9a-fA-F]{4})/g, function (m0, c) { return c === "n" ? "\n" : c === "r" ? "\r" : c === "t" ? "\t" : c.charAt(0) === "u" ? String.fromCharCode(parseInt(c.slice(1), 16)) : c; }); }
  function template(raw, file, line, heredoc) {
    var parts = [], i = 0, lit = "";
    while (i < raw.length) {
      if (raw.substr(i, 3) === "$${" || raw.substr(i, 3) === "%%{") { lit += raw.substr(i + 1, 2); i += 3; continue; }
      if (raw.substr(i, 2) === "${") {
        var d = 1, j = i + 2, q = false;
        while (j < raw.length && d > 0) { var c = raw.charAt(j); if (c === "\"" && raw.charAt(j - 1) !== "\\") q = !q; else if (!q && c === "{") d++; else if (!q && c === "}") d--; j++; }
        if (lit) { parts.push({ lit: heredoc ? lit : unescape(lit) }); lit = ""; }
        var inner = raw.slice(i + 2, j - 1).replace(/^~|~$/g, "");
        parts.push({ expr: parseExprText(inner, file, line) });
        i = j; continue;
      }
      lit += raw.charAt(i); i++;
    }
    if (lit || !parts.length) parts.push({ lit: heredoc ? lit : unescape(lit) });
    if (parts.length === 1 && parts[0].lit != null) return { k: "lit", v: parts[0].lit, line: line };
    return { k: "tpl", parts: parts, line: line };
  }

  /* ================================================================== parser */
  function Parser(toks, file, src) { this.toks = toks; this.p = 0; this.file = file; this.src = src; }
  Parser.prototype = {
    peek: function (o) { return this.toks[this.p + (o || 0)]; },
    next: function () { return this.toks[this.p++]; },
    at: function (line) { return { file: this.file, line: line, src: this.src }; },
    err: function (sum, det, line) { return new TfErr(sum, det, this.at(line == null ? this.peek().line : line)); },
    skipNl: function () { while (this.peek().t === "nl") this.p++; },
    expect: function (t, sum, det) { var tk = this.next(); if (tk.t !== t) throw this.err(sum || "Invalid expression", det || "Expected \"" + t + "\".", tk.line); return tk; },
    body: function (end) {
      var attrs = {}, blocks = [], order = [], self = this;
      this.skipNl();
      while (this.peek().t !== end) {
        var tk = this.next();
        if (tk.t === "eof") throw this.err("Unclosed configuration block", "There is no closing brace for this block before the end of the file. This may be caused by incorrect brace nesting elsewhere in this file.", tk.line);
        if (tk.t !== "id") throw this.err("Argument or block definition required", "An argument or block definition is required here.", tk.line);
        if (this.peek().t === "=") {
          this.next();
          if (attrs[tk.v]) throw this.err("Attribute redefined", "The argument \"" + tk.v + "\" was already set at " + this.file + ":" + attrs[tk.v].line + ",3-" + (tk.v.length + 3) + ". Each argument may be set only once.", tk.line);
          var v = this.expr(); v.line = tk.line; v.attrLine = tk.line; attrs[tk.v] = v; order.push(tk.v);
          var nt = this.peek().t;
          if (nt !== "nl" && nt !== end && nt !== "eof") throw this.err("Missing newline after argument", "An argument definition must end with a newline.", this.peek().line);
        } else {
          var labels = [];
          while (this.peek().t === "str" || this.peek().t === "id") { var l = this.next(); labels.push(l.t === "str" ? unescape(l.raw) : l.v); }
          var ob = this.next();
          if (ob.t !== "{") throw this.err("Invalid block definition", ob.t === "=" ? "A block definition must have block content delimited by \"{\" and \"}\", starting on the same line as the block header." : "Either a quoted string block label or an opening brace (\"{\") is expected here.", ob.line);
          var b = this.body("}"); var close = this.next(); b.type = tk.v; b.labels = labels; b.line = tk.line; b.end = close.line; blocks.push(b); order.push(b);
        }
        this.skipNl();
      }
      return { attrs: attrs, blocks: blocks, order: order };
    },
    expr: function () { return this.cond(); },
    cond: function () {
      var c = this.binary(0);
      if (this.peek().t === "?") { this.next(); this.skipNl(); var t = this.expr(); this.skipNl(); this.expect(":", "Missing false expression in conditional", "The conditional operator (...?...:...) requires a false expression, delimited by a colon."); this.skipNl(); var f = this.expr(); return { k: "cond", c: c, t: t, f: f, line: c.line }; }
      return c;
    },
    binary: function (lvl) {
      var OPS = [["||"], ["&&"], ["==", "!="], ["<", ">", "<=", ">="], ["+", "-"], ["*", "/", "%"]];
      if (lvl >= OPS.length) return this.unary();
      var l = this.binary(lvl + 1);
      while (OPS[lvl].indexOf(this.peek().t) >= 0) { var op = this.next().t; this.skipNl(); var r = this.binary(lvl + 1); l = { k: "bin", op: op, l: l, r: r, line: l.line }; }
      return l;
    },
    unary: function () { var t = this.peek().t; if (t === "!" || t === "-") { this.next(); return { k: "un", op: t, x: this.unary(), line: this.peek().line }; } return this.postfix(this.primary()); },
    postfix: function (e) {
      for (;;) {
        var t = this.peek().t;
        if (t === ".") {
          this.next(); var nt = this.next();
          if (nt.t === "id") e = { k: "get", o: e, a: nt.v, line: e.line };
          else if (nt.t === "num") e = { k: "idx", o: e, i: { k: "lit", v: nt.v }, line: e.line };
          else if (nt.t === "*") { var ops = []; while (this.peek().t === "." && this.peek(1).t === "id") { this.next(); ops.push({ a: this.next().v }); } e = { k: "splat", o: e, ops: ops, line: e.line }; }
          else throw this.err("Invalid attribute name", "An attribute name is required after a dot.", nt.line);
        } else if (t === "[") {
          if (this.peek(1).t === "*" && this.peek(2).t === "]") { this.p += 3; var ops2 = []; for (;;) { if (this.peek().t === "." && this.peek(1).t === "id") { this.next(); ops2.push({ a: this.next().v }); } else if (this.peek().t === "[" && this.peek(1).t !== "*") { this.next(); ops2.push({ i: this.expr() }); this.expect("]"); } else break; } e = { k: "splat", o: e, ops: ops2, line: e.line }; }
          else { this.next(); this.skipNl(); var ix = this.expr(); this.skipNl(); this.expect("]", "Missing close bracket on index", "The index operator must end with a closing bracket (\"]\")."); e = { k: "idx", o: e, i: ix, line: e.line }; }
        } else return e;
      }
    },
    primary: function () {
      var tk = this.next(), self = this;
      if (tk.t === "num") return { k: "lit", v: tk.v, line: tk.line };
      if (tk.t === "str") return template(tk.raw, this.file, tk.line, tk.heredoc);
      if (tk.t === "(") { this.skipNl(); var x = this.expr(); this.skipNl(); this.expect(")"); return { k: "paren", x: x, line: tk.line }; }
      if (tk.t === "id") {
        if (tk.v === "true" || tk.v === "false") return { k: "lit", v: tk.v === "true", line: tk.line };
        if (tk.v === "null") return { k: "lit", v: null, line: tk.line };
        if (this.peek().t === "(") {
          this.next(); var args = [], expand = false; this.skipNl();
          while (this.peek().t !== ")") { args.push(this.expr()); this.skipNl(); if (this.peek().t === "...") { this.next(); expand = true; this.skipNl(); } if (this.peek().t === ",") { this.next(); this.skipNl(); } else if (this.peek().t !== ")") throw this.err("Missing argument separator", "A comma is required to separate each function argument from the next.", this.peek().line); }
          this.next();
          return { k: "call", n: tk.v, args: args, expand: expand, line: tk.line };
        }
        return { k: "ref", n: tk.v, line: tk.line };
      }
      if (tk.t === "[") {
        this.skipNl();
        if (this.peek().t === "id" && this.peek().v === "for") return this.forExpr(tk.line, false);
        var items = [];
        while (this.peek().t !== "]") { items.push(this.expr()); this.skipNl(); if (this.peek().t === ",") { this.next(); this.skipNl(); } else if (this.peek().t !== "]") throw this.err("Missing item separator", "Expected a comma to mark the beginning of the next item.", this.peek().line); }
        this.next();
        return { k: "tuple", items: items, line: tk.line };
      }
      if (tk.t === "{") {
        this.skipNl();
        if (this.peek().t === "id" && this.peek().v === "for") return this.forExpr(tk.line, true);
        var props = [];
        while (this.peek().t !== "}") {
          var kt = this.peek(), key;
          if (kt.t === "id" && (this.peek(1).t === "=" || this.peek(1).t === ":")) { this.next(); key = { k: "lit", v: kt.v }; }
          else key = this.expr();
          var sep = this.next(); if (sep.t !== "=" && sep.t !== ":") throw this.err("Missing key/value separator", "Expected an equals sign (\"=\") to mark the beginning of the attribute value.", sep.line);
          this.skipNl(); var val = this.expr(); props.push({ key: key, val: val });
          if (this.peek().t === ",") this.next();
          this.skipNl();
        }
        this.next();
        return { k: "obj", props: props, line: tk.line };
      }
      if (tk.t === "eof" || tk.t === "nl") throw this.err("Invalid expression", "Expected the start of an expression, but found the end of the line.", tk.line);
      throw this.err("Invalid expression", "Expected the start of an expression, but found an invalid expression token.", tk.line);
    },
    forExpr: function (line, isObj) {
      this.next(); var a = this.expect("id").v, b = null;
      if (this.peek().t === ",") { this.next(); b = this.expect("id").v; }
      var inTok = this.next(); if (inTok.t !== "id" || inTok.v !== "in") throw this.err("Invalid 'for' expression", "The 'in' keyword is required after the iterator variable name(s).", inTok.line);
      var coll = this.expr(); this.expect(":"); this.skipNl();
      var k1 = this.expr(), v1 = null, group = false, cnd = null;
      if (isObj) { this.expect("=>", "Invalid 'for' expression", "Key expression is required when building an object."); this.skipNl(); v1 = this.expr(); if (this.peek().t === "...") { this.next(); group = true; } }
      this.skipNl();
      if (this.peek().t === "id" && this.peek().v === "if") { this.next(); cnd = this.expr(); }
      this.skipNl(); this.next();
      return { k: "for", kv: b ? a : null, vv: b || a, coll: coll, keyE: isObj ? k1 : null, valE: isObj ? v1 : k1, cond: cnd, obj: isObj, group: group, line: line };
    }
  };
  function parseExprText(text, file, line) { var toks = lex(text, file).filter(function (x) { return x.t !== "nl"; }); toks.forEach(function (x) { x.line = line; }); var p = new Parser(toks, file, null); var e = p.expr(); if (p.peek().t !== "eof") throw p.err("Extra characters after interpolation expression", "Expected a closing brace to end the interpolation expression, but found extra characters.", line); return e; }
  function parseFile(text, file) { var p = new Parser(lex(text, file), file, text); var b = p.body("eof"); b.file = file; b.src = text; return b; }
  IAC.parseHcl = parseFile;
  IAC.parseExpr = parseExprText;

  /* ================================================================== values */
  var UNK = { __unknown: true };
  IAC.UNK = UNK;
  function isUnk(v) { if (v === UNK) return true; return false; }
  function deepUnk(v) { if (v === UNK) return true; if (Array.isArray(v)) return v.some(deepUnk); if (v && typeof v === "object") return keys(v).some(function (k) { return deepUnk(v[k]); }); return false; }
  IAC.isUnk = isUnk; IAC.deepUnk = deepUnk;
  function typeName(v) { if (v === null || v === undefined) return "null"; if (typeof v === "string") return "string"; if (typeof v === "number") return "number"; if (typeof v === "boolean") return "bool"; if (Array.isArray(v)) return "tuple"; return "object"; }
  IAC.typeName = typeName;
  function toStr(v, ctx, e) {
    if (typeof v === "string") return v;
    if (typeof v === "number") return String(v);
    if (typeof v === "boolean") return v ? "true" : "false";
    if (v === null || v === undefined) throw evalErr(ctx, "Invalid template interpolation value", "The expression result is null. Cannot include a null value in a string template.", e);
    throw evalErr(ctx, "Invalid template interpolation value", "Cannot include the given value in a string template: string required, but have " + typeName(v) + ".", e);
  }
  function evalErr(ctx, sum, det, e) { return new TfErr(sum, det, ctx && ctx.at ? Object.assign({}, ctx.at, { line: e && e.line || ctx.at.line }) : null); }
  IAC.evalErr = evalErr;
  function eq(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

  /* ================================================================== evaluation
     ctx: {resolve(name, e) -> value for a root name (var, local, aws_x, data, module, path, count, each, ...),
           at: {file, line, ctx, src}, sens: false (set to true when a sensitive value is read), refs: [] }   */
  function ev(e, ctx, locals) {
    switch (e.k) {
      case "lit": return e.v;
      case "paren": return ev(e.x, ctx, locals);
      case "tpl": {
        var s = "", unk = false;
        e.parts.forEach(function (p) { if (p.lit != null) { s += p.lit; return; } var v = ev(p.expr, ctx, locals); if (isUnk(v)) { unk = true; return; } s += toStr(v, ctx, p.expr); });
        return unk ? UNK : s;
      }
      case "ref": {
        if (locals && Object.prototype.hasOwnProperty.call(locals, e.n)) return locals[e.n];
        return ctx.resolve(e.n, e, ctx);
      }
      case "get": {
        var o = ev(e.o, ctx, locals);
        if (isUnk(o)) return UNK;
        if (o && o.__sensAttrs && o.__sensAttrs[e.a]) ctx.sens = true;
        if (o && typeof o === "object" && !Array.isArray(o)) {
          if (!(e.a in o)) {
            if (o.__kind) throw evalErr(ctx, "Unsupported attribute", "This object has no argument, nested block, or exported attribute named \"" + e.a + "\".", e);
            throw evalErr(ctx, "Unsupported attribute", "This object does not have an attribute named \"" + e.a + "\".", e);
          }
          return o[e.a];
        }
        if (Array.isArray(o)) throw evalErr(ctx, "Unsupported attribute", "Can't access attributes on a list of objects. Did you mean to access attribute \"" + e.a + "\" for a specific element of the list, or across all elements of the list?", e);
        throw evalErr(ctx, "Unsupported attribute", "Can't access attributes on a primitive-typed value (" + typeName(o) + ").", e);
      }
      case "idx": {
        var c = ev(e.o, ctx, locals), i = ev(e.i, ctx, locals);
        if (isUnk(c) || isUnk(i)) return UNK;
        if (Array.isArray(c)) { if (typeof i !== "number" && !/^\d+$/.test(String(i))) throw evalErr(ctx, "Invalid index", "The given key does not identify an element in this collection value: a number is required.", e); if (+i >= c.length || +i < 0) throw evalErr(ctx, "Invalid index", "The given key does not identify an element in this collection value: the given index is greater than or equal to the length of the collection.", e); return c[+i]; }
        if (c && typeof c === "object") { if (!(String(i) in c)) throw evalErr(ctx, "Invalid index", "The given key does not identify an element in this collection value.", e); if (c.__sensAttrs && c.__sensAttrs[i]) ctx.sens = true; return c[String(i)]; }
        throw evalErr(ctx, "Invalid index", "This value does not have any indices.", e);
      }
      case "splat": {
        var base = ev(e.o, ctx, locals);
        if (isUnk(base)) return UNK;
        if (base === null) return [];
        var list = Array.isArray(base) ? base : [base];
        return list.map(function (x) { e.ops.forEach(function (op) { if (isUnk(x)) return; if (op.a != null) { if (x && x.__sensAttrs && x.__sensAttrs[op.a]) ctx.sens = true; x = x == null ? null : x[op.a]; } else x = x == null ? null : x[ev(op.i, ctx, locals)]; }); return x; });
      }
      case "tuple": return e.items.map(function (x) { return ev(x, ctx, locals); });
      case "obj": { var r = {}; e.props.forEach(function (p) { var k = ev(p.key, ctx, locals); if (isUnk(k)) return; r[String(k)] = ev(p.val, ctx, locals); }); return r; }
      case "cond": { var cv = ev(e.c, ctx, locals); if (isUnk(cv)) return UNK; if (typeof cv !== "boolean") throw evalErr(ctx, "Incorrect condition type", "The condition expression must be of type bool.", e); return cv ? ev(e.t, ctx, locals) : ev(e.f, ctx, locals); }
      case "un": { var x = ev(e.x, ctx, locals); if (isUnk(x)) return UNK; if (e.op === "!") { if (typeof x !== "boolean") throw evalErr(ctx, "Invalid operand", "Unsuitable value for unary operand: bool required.", e); return !x; } return -num(x, ctx, e); }
      case "bin": {
        var op = e.op;
        if (op === "&&" || op === "||") { var lb = ev(e.l, ctx, locals); if (lb === false && op === "&&") return false; if (lb === true && op === "||") return true; var rb = ev(e.r, ctx, locals); if (isUnk(lb) || isUnk(rb)) return UNK; return op === "&&" ? !!(lb && rb) : !!(lb || rb); }
        var l = ev(e.l, ctx, locals), rr = ev(e.r, ctx, locals);
        if (isUnk(l) || isUnk(rr)) return UNK;
        if (op === "==") return eq(l, rr); if (op === "!=") return !eq(l, rr);
        var a = num(l, ctx, e), b = num(rr, ctx, e);
        return { "+": a + b, "-": a - b, "*": a * b, "/": a / b, "%": a % b, "<": a < b, ">": a > b, "<=": a <= b, ">=": a >= b }[op];
      }
      case "call": return callFn(e, ctx, locals);
      case "for": {
        var coll = ev(e.coll, ctx, locals);
        if (isUnk(coll)) return UNK;
        var res = e.obj ? {} : [], entries = Array.isArray(coll) ? coll.map(function (v, i) { return [i, v]; }) : keys(coll || {}).filter(function (k) { return k.indexOf("__") !== 0; }).map(function (k) { return [k, coll[k]]; });
        entries.forEach(function (kv) {
          var loc = Object.assign({}, locals || {}); if (e.kv) loc[e.kv] = kv[0]; loc[e.vv] = kv[1];
          if (e.cond) { var ok = ev(e.cond, ctx, loc); if (isUnk(ok)) return; if (!ok) return; }
          if (e.obj) { var k = ev(e.keyE, ctx, loc), v = ev(e.valE, ctx, loc); if (isUnk(k)) return; if (e.group) (res[k] = res[k] || []).push(v); else { if (k in res) throw evalErr(ctx, "Duplicate object key", "Two different items produced the key \"" + k + "\" in this 'for' expression. If duplicates are expected, use the ellipsis (...) after the value expression to enable grouping by key.", e); res[k] = v; } }
          else res.push(ev(e.valE, ctx, loc));
        });
        return res;
      }
    }
    throw new Error("hcl: unknown node " + e.k);
  }
  function num(v, ctx, e) { if (typeof v === "number") return v; if (typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v)) return +v; throw evalErr(ctx, "Invalid operand", "Unsuitable value for left operand: a number is required.", e); }
  IAC.evalExpr = ev;

  /* ================================================================== functions */
  var FN = {
    abs: function (x) { return Math.abs(x); }, ceil: Math.ceil, floor: Math.floor, max: function () { return Math.max.apply(null, arguments); }, min: function () { return Math.min.apply(null, arguments); },
    upper: function (s) { return String(s).toUpperCase(); }, lower: function (s) { return String(s).toLowerCase(); }, title: function (s) { return String(s).replace(/\b\w/g, function (c) { return c.toUpperCase(); }); },
    trimspace: function (s) { return String(s).trim(); }, trim: function (s, c) { var re = new RegExp("^[" + c.replace(/[\]\\^-]/g, "\\$&") + "]+|[" + c.replace(/[\]\\^-]/g, "\\$&") + "]+$", "g"); return String(s).replace(re, ""); },
    trimprefix: function (s, p) { return s.indexOf(p) === 0 ? s.slice(p.length) : s; }, trimsuffix: function (s, p) { return p && s.slice(-p.length) === p ? s.slice(0, -p.length) : s; },
    format: function (f) { var a = Array.prototype.slice.call(arguments, 1), i = 0; return String(f).replace(/%(-?\d*)(\.\d+)?([sdvqf%])/g, function (m0, w, pr, c) { if (c === "%") return "%"; var v = a[i++]; if (c === "d") v = String(Math.trunc(v)); else if (c === "f") v = (+v).toFixed(pr ? +pr.slice(1) : 6); else if (c === "q") v = JSON.stringify(v); else v = typeof v === "string" ? v : JSON.stringify(v); if (w) { var n = Math.abs(+w); v = +w < 0 ? v.padEnd(n) : v.padStart(n); } return v; }); },
    join: function (sep, l) { return l.join(sep); }, split: function (sep, s) { return String(s).split(sep); },
    replace: function (s, a, b) { var m = /^\/(.*)\/$/.exec(a); return m ? String(s).replace(new RegExp(m[1], "g"), b.replace(/\$\{?(\d)\}?/g, "$$$1")) : String(s).split(a).join(b); },
    substr: function (s, o, l) { return String(s).substr(o, l < 0 ? undefined : l); }, startswith: function (s, p) { return String(s).indexOf(p) === 0; }, endswith: function (s, p) { return String(s).slice(-p.length) === p; }, strcontains: function (s, p) { return String(s).indexOf(p) >= 0; },
    regex: function (p, s) { var m = new RegExp(p).exec(s); if (!m) throw new Error("pattern did not match any part of the given string"); return m.length > 1 ? m.slice(1) : m[0]; }, can: null, try: null,
    length: function (v) { if (typeof v === "string") return v.length; if (Array.isArray(v)) return v.length; return keys(v || {}).length; },
    concat: function () { return Array.prototype.concat.apply([], Array.prototype.slice.call(arguments)); }, flatten: function (l) { var o = []; (function f(x) { x.forEach(function (y) { if (Array.isArray(y)) f(y); else o.push(y); }); })(l); return o; },
    distinct: function (l) { var o = []; l.forEach(function (x) { if (!o.some(function (y) { return eq(x, y); })) o.push(x); }); return o; }, compact: function (l) { return l.filter(function (x) { return x !== null && x !== ""; }); },
    contains: function (l, v) { return l.some(function (x) { return eq(x, v); }); }, element: function (l, i) { return l[i % l.length]; }, index: function (l, v) { return l.indexOf(v); },
    slice: function (l, a, b) { return l.slice(a, b); }, reverse: function (l) { return l.slice().reverse(); }, sort: function (l) { return l.slice().sort(); },
    range: function (a, b, s) { if (b === undefined) { b = a; a = 0; } s = s || 1; var o = []; for (var i = a; s > 0 ? i < b : i > b; i += s) o.push(i); return o; },
    keys: function (m) { return keys(m).filter(function (k) { return k.indexOf("__") !== 0; }).sort(); }, values: function (m) { return keys(m).filter(function (k) { return k.indexOf("__") !== 0; }).sort().map(function (k) { return m[k]; }); },
    lookup: function (m, k, d) { if (k in m) return m[k]; if (arguments.length > 2) return d; throw new Error("the given key \"" + k + "\" does not exist in the map"); },
    merge: function () { var o = {}; Array.prototype.slice.call(arguments).forEach(function (m) { if (m) keys(m).forEach(function (k) { o[k] = m[k]; }); }); return o; },
    zipmap: function (k, v) { var o = {}; k.forEach(function (x, i) { o[x] = v[i]; }); return o; }, one: function (l) { if (l.length > 1) throw new Error("must be a list, set, or tuple value with either zero or one elements"); return l.length ? l[0] : null; },
    tolist: function (l) { return Array.isArray(l) ? l.slice() : keys(l).map(function (k) { return l[k]; }); }, toset: function (l) { return FN.distinct(l).slice().sort(); }, tomap: function (m) { return m; },
    tostring: function (v) { return v === null ? null : String(v); }, tonumber: function (v) { if (v === null) return null; if (isNaN(+v)) throw new Error("cannot convert \"" + v + "\" to number"); return +v; }, tobool: function (v) { return v === "true" || v === true; },
    coalesce: function () { for (var i = 0; i < arguments.length; i++) if (arguments[i] !== null && arguments[i] !== "") return arguments[i]; throw new Error("no non-null, non-empty-string arguments"); },
    coalescelist: function () { for (var i = 0; i < arguments.length; i++) if (arguments[i] && arguments[i].length) return arguments[i]; throw new Error("no non-null arguments"); },
    jsonencode: function (v) { return JSON.stringify(v); }, jsondecode: function (s) { return JSON.parse(s); },
    yamlencode: function (v) { return root.DevYaml.dump(v); },
    base64encode: function (s) { return typeof btoa === "function" ? btoa(unescape(encodeURIComponent(s))) : Buffer.from(s, "utf8").toString("base64"); },
    base64decode: function (s) { return typeof atob === "function" ? decodeURIComponent(escape(atob(s))) : Buffer.from(s, "base64").toString("utf8"); },
    md5: function (s) { return root.ShEngine.M2.hexOf("md5" + s, 32); }, sha256: function (s) { return root.ShEngine.M2.hexOf("sha256" + s, 64); }, sha1: function (s) { return root.ShEngine.M2.hexOf("sha1" + s, 40); },
    uuid: null, timestamp: null,
    cidrsubnet: function (base, nb, n) { return IAC.cidrSub(base, nb, n); }, cidrhost: function (base, n) { return IAC.nip(IAC.ipn(base.split("/")[0]) + n); },
    cidrnetmask: function (c) { var p = +c.split("/")[1]; return IAC.nip(p === 0 ? 0 : (0xffffffff << (32 - p)) >>> 0); },
    sensitive: null, nonsensitive: null, file: null, templatefile: null, fileexists: null, abspath: function (p) { return p; }, basename: function (p) { return String(p).split("/").pop(); }, dirname: function (p) { return String(p).replace(/\/[^/]*$/, "") || "."; },
    pathexpand: function (p) { return String(p).replace(/^~/, "/home/dev"); }, alltrue: function (l) { return l.every(function (x) { return x === true; }); }, anytrue: function (l) { return l.some(function (x) { return x === true; }); },
    sum: function (l) { return l.reduce(function (a, b) { return a + b; }, 0); }, setunion: function () { return FN.toset(FN.concat.apply(null, arguments)); }, setintersection: function (a, b) { return FN.toset(a.filter(function (x) { return b.indexOf(x) >= 0; })); }, setsubtract: function (a, b) { return FN.toset(a.filter(function (x) { return b.indexOf(x) < 0; })); },
    chunklist: function (l, n) { var o = []; for (var i = 0; i < l.length; i += n) o.push(l.slice(i, i + n)); return o; }, transpose: null, formatlist: function (f, l) { return l.map(function (x) { return FN.format(f, x); }); }
  };
  IAC.FN = FN;
  function callFn(e, ctx, locals) {
    var n = e.n;
    if (n === "try") { for (var i = 0; i < e.args.length; i++) { try { var v = ev(e.args[i], ctx, locals); return v; } catch (x) { if (!(x instanceof TfErr)) throw x; } } throw evalErr(ctx, "Error in function call", "Call to function \"try\" failed: no expression succeeded.", e); }
    if (n === "can") { try { var cv = ev(e.args[0], ctx, locals); return !isUnk(cv) || cv; } catch (x2) { if (x2 instanceof TfErr) return false; throw x2; } }
    if (!(n in FN)) throw evalErr(ctx, "Call to unknown function", "There is no function named \"" + n + "\".", e);
    var args = e.args.map(function (a) { return ev(a, ctx, locals); });
    if (e.expand && args.length) { var last = args.pop(); args = args.concat(isUnk(last) ? [UNK] : last); }
    if (n === "sensitive") { ctx.sens = true; return args[0]; }
    if (n === "nonsensitive") { ctx.sens = false; ctx.nonsens = true; return args[0]; }
    if (n === "timestamp") return UNK;
    if (n === "uuid") return UNK;
    if (args.some(deepUnk)) { if (n === "length" && Array.isArray(args[0])) return args[0].length; return UNK; }
    if (n === "file" || n === "templatefile" || n === "fileexists") {
      var p = String(args[0]), full = p.charAt(0) === "/" ? p : (ctx.moduleDir || ".") + "/" + p.replace(/^\.\//, "");
      var txt = ctx.readFile ? ctx.readFile(full) : null;
      if (n === "fileexists") return txt != null;
      if (txt == null) throw evalErr(ctx, "Invalid function argument", "Invalid value for \"path\" parameter: no file exists at \"" + p + "\"; this function works only with files that are distributed as part of the configuration source code, so if this file will be created by a resource in this configuration you must instead obtain this result from an attribute of that resource.", e);
      if (n === "file") return txt;
      var vars = args[1] || {};
      return renderTemplateFile(txt, vars, ctx, p, e);
    }
    try { return FN[n].apply(null, args); }
    catch (x3) { throw evalErr(ctx, "Error in function call", "Call to function \"" + n + "\" failed: " + (x3.message || x3) + ".", e); }
  }
  function renderTemplateFile(txt, vars, ctx, path, e) {
    // ${...} interpolation and %{ for x in list }...%{ endfor } / %{ if cond }...%{ endif }
    var out = txt.replace(/%\{\s*for\s+(\w+)\s+in\s+([^}]+?)\s*~?\}\n?([\s\S]*?)%\{\s*endfor\s*~?\}\n?/g, function (m0, v, listE, body) {
      var list = ev(parseExprText(listE, path, 1), ctx, vars); return (list || []).map(function (item) { var loc = Object.assign({}, vars); loc[v] = item; return renderTemplateFile(body, loc, ctx, path, e); }).join("");
    }).replace(/%\{\s*if\s+([^}]+?)\s*~?\}\n?([\s\S]*?)(?:%\{\s*else\s*~?\}\n?([\s\S]*?))?%\{\s*endif\s*~?\}\n?/g, function (m0, c, a, b) { return ev(parseExprText(c, path, 1), ctx, vars) ? a : (b || ""); });
    var t = template(out, path, 1, true);
    var c2 = Object.assign({}, ctx, { resolve: function (n2, e2) { if (n2 in vars) return vars[n2]; throw evalErr(ctx, "Invalid function argument", "Invalid value for \"vars\" parameter: vars map does not contain key \"" + n2 + "\", referenced at " + path + ".", e2); } });
    return ev(t, c2, vars);
  }

  /* ================================================================== references in an expression (for dependencies) */
  function refs(e, list) {
    list = list || [];
    if (!e || typeof e !== "object") return list;
    if (e.k === "ref") list.push([e.n]);
    else if (e.k === "get") { var chain = [], x = e; while (x.k === "get") { chain.unshift(x.a); x = x.o; } if (x.k === "ref") { list.push([x.n].concat(chain)); } else refs(x, list); }
    else if (e.k === "idx") { refs(e.o, list); refs(e.i, list); }
    else if (e.k === "splat") refs(e.o, list);
    else if (e.k === "tpl") e.parts.forEach(function (p) { if (p.expr) refs(p.expr, list); });
    else if (e.k === "tuple") e.items.forEach(function (x2) { refs(x2, list); });
    else if (e.k === "obj") e.props.forEach(function (p) { refs(p.key, list); refs(p.val, list); });
    else if (e.k === "cond") { refs(e.c, list); refs(e.t, list); refs(e.f, list); }
    else if (e.k === "un") refs(e.x, list);
    else if (e.k === "bin") { refs(e.l, list); refs(e.r, list); }
    else if (e.k === "call") e.args.forEach(function (a) { refs(a, list); });
    else if (e.k === "paren") refs(e.x, list);
    else if (e.k === "for") { var inner = []; refs(e.coll, list); [e.keyE, e.valE, e.cond].forEach(function (x3) { if (x3) refs(x3, inner); }); inner.forEach(function (r) { if (r[0] !== e.vv && r[0] !== e.kv) list.push(r); }); }
    return list;
  }
  IAC.refs = refs;
  function bodyRefs(b, list) { list = list || []; keys(b.attrs).forEach(function (k) { refs(b.attrs[k], list); }); b.blocks.forEach(function (x) { bodyRefs(x, list); }); return list; }
  IAC.bodyRefs = bodyRefs;

  /* ================================================================== terraform fmt */
  function fmt(text) {
    var lines = String(text).replace(/\t/g, "  ").split("\n"), outL = [], depth = 0, inHeredoc = null;
    lines.forEach(function (raw) {
      if (inHeredoc) { outL.push(raw); if (raw.trim() === inHeredoc) inHeredoc = null; return; }
      var l = raw.trim();
      var hm = /<<-?([A-Za-z_]\w*)\s*$/.exec(l);
      var opens = (l.replace(/"(?:[^"\\]|\\.)*"/g, "").match(/[{[(]/g) || []).length, closes = (l.replace(/"(?:[^"\\]|\\.)*"/g, "").match(/[}\])]/g) || []).length;
      var lead = /^[}\])]/.test(l) ? 1 : 0;
      var d = Math.max(0, depth - lead);
      outL.push(l ? new Array(d + 1).join("  ") + l.replace(/\s*=\s*/, function (m) { return /^[\w"-]+\s*=/.test(l) ? " = " : m; }) : "");
      depth = Math.max(0, depth + opens - closes);
      if (hm) inHeredoc = hm[1];
    });
    // align "=" in runs of attribute lines at the same indentation
    var res = outL.slice(), i = 0;
    while (i < res.length) {
      var m = /^(\s*)([\w"-]+) = /.exec(res[i]);
      if (!m) { i++; continue; }
      var j = i, ind = m[1], width = 0;
      while (j < res.length) { var mm = /^(\s*)([\w"-]+) = /.exec(res[j]); if (!mm || mm[1] !== ind) break; width = Math.max(width, mm[2].length); var opn = (res[j].match(/[{[(]\s*$/)); j++; if (opn) break; }
      for (var k = i; k < j; k++) res[k] = res[k].replace(/^(\s*)([\w"-]+) = /, function (m0, a, b) { return a + b + new Array(width - b.length + 2).join(" ") + "= "; });
      i = j;
    }
    var s = res.join("\n").replace(/\n{3,}/g, "\n\n").replace(/\s+$/, "") + "\n";
    return s;
  }
  IAC.fmt = fmt;
})(typeof window !== "undefined" ? window : globalThis);
