/* sudo learn — simulated GitHub Actions for the Git track (Module 3 onwards). Workflow files in .github/workflows/
   are parsed (a YAML subset) and validated like GitHub does, triggered by pushes, pull requests, issues, releases
   and `gh workflow run`, and each job runs on a fresh simulated Ubuntu runner that shares the machine's Git object
   store and the simulated GitHub. Steps are real Bash run by the same shell as the rest of the course; `uses:`
   steps are simulated versions of the common actions (checkout, setup-node, cache, upload/download-artifact...).
   Also: the gh commands for runs, workflows, secrets, variables and releases, and pull request checks. */
(function (root) {
  "use strict";
  var S = root.ShEngine, G = root.GitCore, GC = root.GitCmds, X = GC.X, GH = root.GitHub, M2 = S.M2;
  var A = {};
  function keys(o) { return o && typeof o === "object" ? Object.keys(o) : []; }
  function has(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function now(sys) { return G.clock(sys); }
  function hash(s) { var h = 2166136261; s = String(s); for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h; }
  function lines(t) { var a = String(t == null ? "" : t).split("\n"); if (a.length && a[a.length - 1] === "") a.pop(); return a; }
  function isObj(v) { return v && typeof v === "object" && !Array.isArray(v); }

  /* ================================================================== YAML (the subset workflows use) */
  function YamlError(line, msg) { this.line = line; this.message = msg; }
  function stripComment(t) {
    var q = null;
    for (var i = 0; i < t.length; i++) {
      var ch = t.charAt(i);
      if (q) { if (q === '"' && ch === "\\") { i++; continue; } if (ch === q) { if (q === "'" && t.charAt(i + 1) === "'") { i++; continue; } q = null; } continue; }
      if ((ch === '"' || ch === "'") && (i === 0 || /[\s\[{,:]/.test(t.charAt(i - 1)))) { q = ch; continue; }
      if (ch === "#" && (i === 0 || /\s/.test(t.charAt(i - 1)))) return t.slice(0, i).replace(/\s+$/, "");
    }
    return t.replace(/\s+$/, "");
  }
  function typed(s) {
    if (/^(true|True|TRUE)$/.test(s)) return true;
    if (/^(false|False|FALSE)$/.test(s)) return false;
    if (s === "" || /^(null|Null|NULL|~)$/.test(s)) return null;
    if (/^[-+]?\d+$/.test(s)) return +s;
    if (/^[-+]?(\d+\.\d*|\.\d+)([eE][-+]?\d+)?$/.test(s)) return +s;
    return s;
  }
  function unescapeDq(s) {
    return s.replace(/\\(x[0-9a-fA-F]{2}|u[0-9a-fA-F]{4}|.)/g, function (m, e) {
      if (e.length > 1) return String.fromCharCode(parseInt(e.slice(1), 16));
      return { n: "\n", t: "\t", r: "\r", "0": "\0", '"': '"', "\\": "\\", "/": "/", " ": " ", e: "\x1b" }[e] !== undefined ? { n: "\n", t: "\t", r: "\r", "0": "\0", '"': '"', "\\": "\\", "/": "/", " ": " ", e: "\x1b" }[e] : m;
    });
  }
  // "key: rest" -> {key, rest}; null when the text is not a mapping entry
  function splitKey(t) {
    var m;
    if (t.charAt(0) === '"') { m = /^"((?:[^"\\]|\\.)*)"\s*:(?:\s+(.*)|$)/.exec(t); return m ? { key: unescapeDq(m[1]), rest: m[2] || "" } : null; }
    if (t.charAt(0) === "'") { m = /^'((?:[^']|'')*)'\s*:(?:\s+(.*)|$)/.exec(t); return m ? { key: m[1].replace(/''/g, "'"), rest: m[2] || "" } : null; }
    if (/^[\[{|>!&*%@`]/.test(t) || /^-(\s|$)/.test(t)) return null;
    for (var i = 0; i < t.length; i++) {
      if (t.charAt(i) === ":" && (i === t.length - 1 || /\s/.test(t.charAt(i + 1)))) {
        var key = t.slice(0, i).replace(/\s+$/, "");
        if (!key) return null;
        return { key: key, rest: t.slice(i + 1).replace(/^\s+/, "") };
      }
    }
    return null;
  }
  function isSeq(t) { return t === "-" || /^-\s/.test(t); }
  function setLine(obj, k, n) { if (!obj.__ln) Object.defineProperty(obj, "__ln", { value: {}, enumerable: false }); obj.__ln[k] = n; }
  function lineOf(obj, k) { return obj && obj.__ln ? obj.__ln[k] : undefined; }
  function parseFlow(t, n) {
    var i = 0;
    function err() { throw new YamlError(n, "You have an error in your yaml syntax on line " + n); }
    function ws() { while (i < t.length && /\s/.test(t.charAt(i))) i++; }
    function quoted() {
      var q = t.charAt(i), j = i + 1, out = "";
      for (; j < t.length; j++) {
        var ch = t.charAt(j);
        if (q === '"' && ch === "\\") { out += t.slice(j, j + 2); j++; continue; }
        if (ch === q) { if (q === "'" && t.charAt(j + 1) === "'") { out += "''"; j++; continue; } break; }
        out += ch;
      }
      if (j >= t.length) err();
      i = j + 1;
      return q === '"' ? unescapeDq(out) : out.replace(/''/g, "'");
    }
    function scalar(isKey) {
      ws();
      if (t.charAt(i) === '"' || t.charAt(i) === "'") return quoted();
      var j = i;
      while (j < t.length && ",]}".indexOf(t.charAt(j)) < 0 && !(isKey && t.charAt(j) === ":" && /[\s,\]}]|^$/.test(t.charAt(j + 1) || ""))) j++;
      var s = t.slice(i, j).trim(); i = j;
      return isKey ? s : typed(s);
    }
    function val() {
      ws();
      var ch = t.charAt(i);
      if (ch === "[") {
        i++; var a = []; ws();
        if (t.charAt(i) === "]") { i++; return a; }
        for (;;) { a.push(val()); ws(); if (t.charAt(i) === ",") { i++; ws(); if (t.charAt(i) === "]") { i++; return a; } continue; } if (t.charAt(i) === "]") { i++; return a; } err(); }
      }
      if (ch === "{") {
        i++; var o = {}; ws();
        if (t.charAt(i) === "}") { i++; return o; }
        for (;;) {
          var k = scalar(true); ws();
          if (t.charAt(i) === ":") { i++; o[k] = val(); } else o[k] = null;
          ws(); if (t.charAt(i) === ",") { i++; ws(); if (t.charAt(i) === "}") { i++; return o; } continue; } if (t.charAt(i) === "}") { i++; return o; } err();
        }
      }
      return scalar(false);
    }
    var v = val(); ws();
    if (i < t.length) err();
    return v;
  }
  function parseYaml(text) {
    var raw = String(text).replace(/\r/g, "").split("\n"), L = [], k = 0;
    raw.forEach(function (r, i) {
      var n = i + 1, lead = /^[ \t]*/.exec(r)[0];
      if (/^\s*(#.*)?$/.test(r)) return;
      if (/^(---|\.\.\.)(\s|$)/.test(r)) return;
      if (lead.indexOf("\t") >= 0) throw new YamlError(n, "You have an error in your yaml syntax on line " + n);
      var body = stripComment(r.slice(lead.length));
      if (body === "") return;
      L.push({ n: n, ind: lead.length, text: body });
    });
    function syntax(n) { return new YamlError(n, "You have an error in your yaml syntax on line " + n); }
    function blockScalar(ind, ln, hdr) {
      var style = hdr.charAt(0), chomp = /-/.test(hdr) ? "strip" : /\+/.test(hdr) ? "keep" : "clip", start = ln.n, j = start, body = [], bi = null;
      for (; j < raw.length; j++) {
        var r = raw[j];
        if (/^\s*$/.test(r)) { body.push(""); continue; }
        var li = /^ */.exec(r)[0].length;
        if (li <= ind) break;
        if (bi === null) bi = li;
        if (li < bi) break;
        body.push(r.slice(bi));
      }
      var last = j;
      while (k < L.length && L[k].n <= last) k++;
      var trail = 0; while (body.length && body[body.length - 1] === "") { body.pop(); trail++; }
      var txt;
      if (style === "|") txt = body.join("\n");
      else {
        txt = ""; var prevMore = true;
        body.forEach(function (l, i2) {
          var more = /^\s/.test(l);
          if (i2 === 0) txt = l;
          else if (l === "") txt += "\n";
          else if (more || prevMore || /\n$/.test(txt)) txt += (/\n$/.test(txt) ? "" : "\n") + l;
          else txt += " " + l;
          prevMore = more;
        });
      }
      if (chomp === "strip") return txt;
      if (chomp === "keep") return txt + new Array(trail + 2).join("\n");
      return body.length ? txt + "\n" : "";
    }
    function inline(rest, ind, ln) {
      var c0 = rest.charAt(0);
      if (/^[|>][-+]?\d*$/.test(rest)) return blockScalar(ind, ln, rest);
      if (c0 === "[" || c0 === "{") return parseFlow(rest, ln.n);
      if (c0 === '"' || c0 === "'") {
        var v = parseFlow(rest, ln.n);
        return v;
      }
      if (c0 === "&" || c0 === "*") throw new YamlError(ln.n, "YAML anchors and aliases are not supported (line " + ln.n + ")");
      var s = rest;
      while (k < L.length && L[k].ind > ind) {
        if (splitKey(L[k].text) || isSeq(L[k].text)) throw syntax(L[k].n);
        s += " " + L[k].text; k++;
      }
      return typed(s);
    }
    function node(ind) {
      var ln = L[k];
      if (!ln || ln.ind < ind) return null;
      if (isSeq(ln.text)) return seq(ln.ind);
      if (splitKey(ln.text)) return map(ln.ind);
      k++;
      return inline(ln.text, ln.ind - 1, ln);
    }
    function after(rest, ind, ln) {
      if (rest !== "") return inline(rest, ind, ln);
      var nx = L[k];
      if (nx && nx.ind > ind) return node(nx.ind);
      if (nx && nx.ind === ind && isSeq(nx.text)) return seq(ind);
      return null;
    }
    function map(ind) {
      var obj = {};
      while (k < L.length && L[k].ind === ind) {
        var ln = L[k], kv = splitKey(ln.text);
        if (!kv) { if (isSeq(ln.text)) break; throw syntax(ln.n); }
        if (has(obj, kv.key)) throw new YamlError(ln.n, "(Line: " + ln.n + ", Col: " + (ind + 1) + "): '" + kv.key + "' is already defined");
        setLine(obj, kv.key, ln.n);
        k++;
        obj[kv.key] = after(kv.rest, ind, ln);
      }
      if (k < L.length && L[k].ind > ind) throw syntax(L[k].n);
      return obj;
    }
    function seq(ind) {
      var arr = [];
      while (k < L.length && L[k].ind === ind && isSeq(L[k].text)) {
        var ln = L[k], rest = ln.text === "-" ? "" : ln.text.replace(/^-\s+/, ""), off = ln.text.length - rest.length;
        setLine(arr, arr.length, ln.n);
        if (rest === "") { k++; var nx = L[k]; arr.push(nx && nx.ind > ind ? node(nx.ind) : null); continue; }
        if (isSeq(rest) || splitKey(rest)) { L[k] = { n: ln.n, ind: ind + off, text: rest }; arr.push(node(ind + off)); continue; }
        k++;
        arr.push(inline(rest, ind, ln));
      }
      if (k < L.length && L[k].ind > ind) throw syntax(L[k].n);
      return arr;
    }
    if (!L.length) return null;
    var top = node(L[0].ind);
    if (k < L.length) throw syntax(L[k].n);
    return top;
  }
  A.parseYaml = function (text) { try { return { value: parseYaml(text) }; } catch (e) { if (e instanceof YamlError) return { error: e }; throw e; } };

  /* ================================================================== ${{ expressions }} */
  function ExprError(msg) { this.message = msg; }
  var CONTEXTS = ["github", "env", "vars", "secrets", "matrix", "strategy", "needs", "steps", "runner", "job", "jobs", "inputs"];
  var FUNCS = ["contains", "startswith", "endswith", "format", "join", "tojson", "fromjson", "hashfiles", "success", "failure", "always", "cancelled"];
  function tokenize(src) {
    var out = [], i = 0;
    while (i < src.length) {
      var ch = src.charAt(i), m;
      if (/\s/.test(ch)) { i++; continue; }
      if (ch === "'") { var j = i + 1, s = ""; for (; j < src.length; j++) { if (src.charAt(j) === "'") { if (src.charAt(j + 1) === "'") { s += "'"; j++; continue; } break; } s += src.charAt(j); } if (j >= src.length) throw new ExprError("Unexpected end of expression: '" + src.slice(i) + "'. Located at position " + (i + 1) + " within expression: " + src); out.push({ t: "str", v: s, p: i }); i = j + 1; continue; }
      if ((m = /^(0x[0-9a-fA-F]+|-?\d+(\.\d+)?([eE][-+]?\d+)?)/.exec(src.slice(i))) && !/[\w-]/.test(src.charAt(i - 1) || "")) { out.push({ t: "num", v: Number(m[1]), p: i }); i += m[1].length; continue; }
      if ((m = /^(==|!=|<=|>=|&&|\|\|)/.exec(src.slice(i)))) { out.push({ t: "op", v: m[1], p: i }); i += 2; continue; }
      if ("()[].,!<>*".indexOf(ch) >= 0) { out.push({ t: "op", v: ch, p: i }); i++; continue; }
      if ((m = /^[A-Za-z_][\w-]*/.exec(src.slice(i)))) { out.push({ t: "id", v: m[0], p: i }); i += m[0].length; continue; }
      throw new ExprError("Unexpected symbol: '" + ch + "'. Located at position " + (i + 1) + " within expression: " + src);
    }
    return out;
  }
  function parseExpr(src) {
    var tk = tokenize(src), i = 0;
    function peek(v) { return tk[i] && tk[i].t === "op" && tk[i].v === v; }
    function bad() { var t = tk[i]; throw new ExprError(t ? "Unexpected symbol: '" + (t.t === "str" ? "'" + t.v + "'" : t.v) + "'. Located at position " + (t.p + 1) + " within expression: " + src : "Unexpected end of expression: '" + src + "'. Located at position " + (src.length) + " within expression: " + src); }
    function or() { var l = and(); while (peek("||")) { i++; l = { k: "or", l: l, r: and() }; } return l; }
    function and() { var l = eq(); while (peek("&&")) { i++; l = { k: "and", l: l, r: eq() }; } return l; }
    function eq() { var l = rel(); while (peek("==") || peek("!=")) { var o = tk[i++].v; l = { k: "cmp", o: o, l: l, r: rel() }; } return l; }
    function rel() { var l = un(); while (peek("<") || peek(">") || peek("<=") || peek(">=")) { var o = tk[i++].v; l = { k: "cmp", o: o, l: l, r: un() }; } return l; }
    function un() { if (peek("!")) { i++; return { k: "not", e: un() }; } return post(); }
    function post() {
      var e = prim();
      for (;;) {
        if (peek(".")) { i++; if (tk[i] && tk[i].t === "id") e = { k: "prop", e: e, n: tk[i++].v }; else if (peek("*")) { i++; e = { k: "star", e: e }; } else bad(); continue; }
        if (peek("[")) { i++; var ix = peek("*") ? (i++, { k: "lit", v: "*" }) : or(); if (!peek("]")) bad(); i++; e = { k: "idx", e: e, i: ix }; continue; }
        return e;
      }
    }
    function prim() {
      var t = tk[i];
      if (!t) bad();
      if (t.t === "num" || t.t === "str") { i++; return { k: "lit", v: t.v }; }
      if (peek("(")) { i++; var e = or(); if (!peek(")")) bad(); i++; return e; }
      if (t.t === "id") {
        i++;
        var lw = t.v.toLowerCase();
        if (lw === "true" || lw === "false") return { k: "lit", v: lw === "true" };
        if (lw === "null") return { k: "lit", v: null };
        if (peek("(")) {
          if (FUNCS.indexOf(lw) < 0) throw new ExprError("Unrecognized function: '" + t.v + "'. Located at position " + (t.p + 1) + " within expression: " + src);
          i++; var args = [];
          if (!peek(")")) { for (;;) { args.push(or()); if (peek(",")) { i++; continue; } break; } }
          if (!peek(")")) bad(); i++;
          return { k: "call", f: lw, a: args };
        }
        if (CONTEXTS.indexOf(lw) < 0) throw new ExprError("Unrecognized named-value: '" + t.v + "'. Located at position " + (t.p + 1) + " within expression: " + src);
        return { k: "ctx", n: lw };
      }
      bad();
    }
    if (!tk.length) throw new ExprError("An expression was expected");
    var ast = or();
    if (i < tk.length) bad();
    return ast;
  }
  function prop(o, n) {
    if (o == null || typeof o !== "object") return null;
    if (Array.isArray(o)) return null;
    if (has(o, n)) return o[n];
    var lw = String(n).toLowerCase(), kk = keys(o).filter(function (x) { return x.toLowerCase() === lw; })[0];
    return kk !== undefined ? o[kk] : null;
  }
  function truthy(v) { return !(v === false || v === null || v === undefined || v === 0 || v === "" || (typeof v === "number" && isNaN(v))); }
  function num(v) { if (v === null || v === undefined) return 0; if (typeof v === "boolean") return v ? 1 : 0; if (typeof v === "number") return v; if (typeof v === "string") { if (/^\s*$/.test(v)) return 0; var n = Number(v); return isNaN(n) ? NaN : n; } return NaN; }
  function cmp(o, a, b) {
    var r;
    if (typeof a === "string" && typeof b === "string") { var x = a.toLowerCase(), y = b.toLowerCase(); r = x < y ? -1 : x > y ? 1 : 0; }
    else if (typeof a === typeof b && typeof a === "object") r = a === b ? 0 : NaN;
    else { var p = num(a), q = num(b); r = isNaN(p) || isNaN(q) ? NaN : p < q ? -1 : p > q ? 1 : 0; }
    if (isNaN(r)) return o === "!=";
    return { "==": r === 0, "!=": r !== 0, "<": r < 0, ">": r > 0, "<=": r <= 0, ">=": r >= 0 }[o];
  }
  function str(v) {
    if (v === null || v === undefined) return "";
    if (typeof v === "boolean") return v ? "true" : "false";
    if (typeof v === "number") return String(v);
    if (Array.isArray(v)) return "Array";
    if (typeof v === "object") return "Object";
    return String(v);
  }
  function evalAst(e, ctx) {
    switch (e.k) {
      case "lit": return e.v;
      case "ctx": return ctx[e.n] === undefined ? null : ctx[e.n];
      case "prop": { var o = evalAst(e.e, ctx); if (o && o.__star) return o.list.map(function (x) { return prop(x, e.n); }); return prop(o, e.n); }
      case "idx": { var o2 = evalAst(e.e, ctx), ix = evalAst(e.i, ctx); if (ix === "*") return { __star: true, list: Array.isArray(o2) ? o2 : keys(o2).map(function (kk) { return o2[kk]; }) }; if (Array.isArray(o2)) return typeof ix === "number" ? (o2[ix] === undefined ? null : o2[ix]) : null; return prop(o2, str(ix)); }
      case "star": { var o3 = evalAst(e.e, ctx); return { __star: true, list: Array.isArray(o3) ? o3 : keys(o3).map(function (kk) { return o3[kk]; }) }; }
      case "not": return !truthy(evalAst(e.e, ctx));
      case "and": { var l = evalAst(e.l, ctx); return truthy(l) ? evalAst(e.r, ctx) : l; }
      case "or": { var l2 = evalAst(e.l, ctx); return truthy(l2) ? l2 : evalAst(e.r, ctx); }
      case "cmp": return cmp(e.o, evalAst(e.l, ctx), evalAst(e.r, ctx));
      case "call": {
        var a = e.a.map(function (x) { var v = evalAst(x, ctx); return v && v.__star ? v.list : v; });
        switch (e.f) {
          case "contains": return Array.isArray(a[0]) ? a[0].some(function (x) { return cmp("==", x, a[1]); }) : str(a[0]).toLowerCase().indexOf(str(a[1]).toLowerCase()) >= 0;
          case "startswith": return str(a[0]).toLowerCase().indexOf(str(a[1]).toLowerCase()) === 0;
          case "endswith": { var s0 = str(a[0]).toLowerCase(), s1 = str(a[1]).toLowerCase(); return s0.length >= s1.length && s0.slice(s0.length - s1.length) === s1; }
          case "format": return str(a[0]).replace(/\{(\d+)\}/g, function (m, n) { return str(a[1 + +n]); }).replace(/\{\{/g, "{").replace(/\}\}/g, "}");
          case "join": return Array.isArray(a[0]) ? a[0].map(str).join(a.length > 1 ? str(a[1]) : ",") : str(a[0]);
          case "tojson": return JSON.stringify(a[0] === undefined ? null : a[0], null, 2);
          case "fromjson": try { return JSON.parse(str(a[0])); } catch (er) { throw new ExprError("Error parsing fromJson: " + str(a[0])); }
          case "hashfiles": return ctx.__hashFiles ? ctx.__hashFiles(a.map(str)) : "";
          case "success": return ctx.__status ? ctx.__status() === "success" : true;
          case "failure": return ctx.__status ? ctx.__status() === "failure" : false;
          case "cancelled": return ctx.__status ? ctx.__status() === "cancelled" : false;
          case "always": return true;
        }
      }
    }
    return null;
  }
  A.evalExpr = function (src, ctx) { return evalAst(parseExpr(src), ctx); };
  function usesStatus(src) { return /\b(success|failure|always|cancelled)\s*\(/i.test(src); }
  // Find ${{ ... }} pieces (respecting quotes inside)
  function exprPieces(s) {
    var out = [], i = 0;
    s = String(s);
    while ((i = s.indexOf("${{", i)) >= 0) {
      var j = i + 3, q = false;
      for (; j < s.length - 1; j++) { var ch = s.charAt(j); if (ch === "'") q = !q; if (!q && ch === "}" && s.charAt(j + 1) === "}") break; }
      if (j >= s.length - 1) { out.push({ start: i, end: s.length, src: null }); break; }
      out.push({ start: i, end: j + 2, src: s.slice(i + 3, j).trim() });
      i = j + 2;
    }
    return out;
  }
  function interp(s, ctx) {
    if (typeof s !== "string") return s;
    var ps = exprPieces(s);
    if (!ps.length) return s;
    if (ps.length === 1 && ps[0].start === 0 && ps[0].end === s.length && ps[0].src !== null) return evalAst(parseExpr(ps[0].src), ctx);
    var out = "", last = 0;
    ps.forEach(function (p) { out += s.slice(last, p.start) + (p.src === null ? s.slice(p.start) : str(evalAst(parseExpr(p.src), ctx))); last = p.end; });
    return out + s.slice(last);
  }
  function interpStr(s, ctx) { var v = interp(s, ctx); return typeof v === "string" ? v : str(v); }
  A.interp = interp;
  // `if:` may leave out ${{ }}; without a status function it means success() && (...)
  function evalIf(cond, ctx) {
    if (cond === undefined || cond === null || cond === "") return ctx.__status ? ctx.__status() === "success" : true;
    if (typeof cond === "boolean" || typeof cond === "number") return truthy(cond) && (ctx.__status ? ctx.__status() === "success" : true);
    var src = String(cond).trim(), m = /^\$\{\{([\s\S]*)\}\}$/.exec(src);
    if (m && exprPieces(src).length === 1) src = m[1].trim();
    else if (exprPieces(src).length) { var v0 = interpStr(src, ctx); return truthy(v0) && (ctx.__status ? ctx.__status() === "success" : true); }
    var v = evalAst(parseExpr(src), ctx);
    if (!usesStatus(src)) return truthy(v) && (ctx.__status ? ctx.__status() === "success" : true);
    return truthy(v);
  }

  /* ================================================================== workflows: load and validate */
  var TOP_KEYS = ["name", "run-name", "on", "env", "defaults", "jobs", "permissions", "concurrency"];
  var JOB_KEYS = ["name", "runs-on", "needs", "if", "steps", "env", "strategy", "environment", "outputs", "permissions", "timeout-minutes", "continue-on-error", "defaults", "services", "container", "concurrency", "uses", "with", "secrets"];
  var STEP_KEYS = ["id", "if", "name", "uses", "run", "shell", "with", "env", "continue-on-error", "timeout-minutes", "working-directory"];
  var EVENTS = ["push", "pull_request", "pull_request_target", "workflow_dispatch", "schedule", "release", "issues", "issue_comment", "workflow_call", "workflow_run", "merge_group", "create", "delete", "repository_dispatch", "pull_request_review", "registry_package", "deployment", "page_build", "fork", "watch", "label", "milestone", "discussion", "check_run", "check_suite", "status"];
  var PERM_SCOPES = ["actions", "attestations", "checks", "contents", "deployments", "id-token", "issues", "discussions", "packages", "pages", "pull-requests", "repository-projects", "security-events", "statuses", "models"];
  function at(obj, k, msg) { var n = lineOf(obj, k); return (n ? "(Line: " + n + ", Col: 1): " : "") + msg; }
  function cronOk(c) {
    var f = String(c).trim().split(/\s+/);
    if (f.length !== 5) return false;
    var R = [[0, 59], [0, 23], [1, 31], [1, 12], [0, 7]], NAMES = [null, null, null, /^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)$/i, /^(sun|mon|tue|wed|thu|fri|sat)$/i];
    return f.every(function (x, i) {
      return x.split(",").every(function (part) {
        var m = /^(\*|(\w+)(?:-(\w+))?)(?:\/(\d+))?$/.exec(part);
        if (!m) return false;
        if (m[1] === "*") return !m[4] || +m[4] > 0;
        return [m[2], m[3]].every(function (v) { if (v === undefined) return true; if (/^\d+$/.test(v)) return +v >= R[i][0] && +v <= R[i][1]; return !!(NAMES[i] && NAMES[i].test(v)); });
      });
    });
  }
  A.cronOk = cronOk;
  function checkExprs(v, errs, obj, k) {
    if (typeof v === "string") exprPieces(v).forEach(function (p) {
      if (p.src === null) { errs.push(at(obj, k, "An expression was expected")); return; }
      try { parseExpr(p.src); } catch (e) { if (e instanceof ExprError) errs.push(at(obj, k, e.message)); else throw e; }
    });
    else if (Array.isArray(v)) v.forEach(function (x, i) { checkExprs(x, errs, v.__ln ? v : obj, v.__ln ? i : k); });
    else if (isObj(v)) keys(v).forEach(function (kk) { checkExprs(v[kk], errs, v, kk); });
  }
  function normOn(on) {
    var out = {};
    if (typeof on === "string") out[on] = null;
    else if (Array.isArray(on)) on.forEach(function (e) { out[String(e)] = null; });
    else if (isObj(on)) keys(on).forEach(function (e) { out[e] = on[e]; });
    return out;
  }
  function list(v) { return v === null || v === undefined ? [] : Array.isArray(v) ? v.map(String) : [String(v)]; }
  A.list = list;
  // Validate a parsed workflow; returns the problems as GitHub words them.
  function validate(doc) {
    var errs = [];
    if (!isObj(doc)) return ["The workflow is not valid. A workflow file must be a mapping (key: value pairs)."];
    keys(doc).forEach(function (kk) { if (TOP_KEYS.indexOf(kk) < 0) errs.push(at(doc, kk, "Unexpected value '" + kk + "'")); });
    if (!has(doc, "on")) errs.push("No event triggers defined in `on`");
    var on = normOn(doc.on);
    keys(on).forEach(function (ev) {
      var holder = isObj(doc.on) ? doc.on : doc, hk = isObj(doc.on) ? ev : "on";
      if (EVENTS.indexOf(ev) < 0) { errs.push(at(holder, hk, "Unexpected value '" + ev + "'")); return; }
      var cfg = on[ev];
      if (ev === "schedule") {
        if (!Array.isArray(cfg) || !cfg.length) { errs.push(at(holder, hk, "Unexpected value '" + str(cfg) + "'")); return; }
        cfg.forEach(function (s, i) { if (!isObj(s) || !has(s, "cron")) errs.push(at(cfg, i, "Unexpected value: each schedule needs a 'cron' key")); else if (!cronOk(s.cron)) errs.push(at(s, "cron", "Invalid cron expression '" + s.cron + "': it needs 5 fields (minute hour day-of-month month day-of-week)")); });
        return;
      }
      if (cfg !== null && !isObj(cfg)) { errs.push(at(holder, hk, "Unexpected value '" + str(cfg) + "'")); return; }
      if (!cfg) return;
      var allowed = { push: ["branches", "branches-ignore", "tags", "tags-ignore", "paths", "paths-ignore"], pull_request: ["types", "branches", "branches-ignore", "paths", "paths-ignore"], pull_request_target: ["types", "branches", "branches-ignore", "paths", "paths-ignore"], workflow_dispatch: ["inputs"] }[ev] || ["types", "branches", "inputs", "secrets", "outputs", "workflows"];
      keys(cfg).forEach(function (kk) { if (allowed.indexOf(kk) < 0) errs.push(at(cfg, kk, "Unexpected value '" + kk + "'")); });
      ["branches", "paths", "tags"].forEach(function (f) { if (has(cfg, f) && has(cfg, f + "-ignore")) errs.push(at(cfg, f, "you may only define one of `" + f + "` and `" + f + "-ignore` for a single event")); });
      if (ev === "workflow_dispatch" && cfg.inputs) keys(cfg.inputs).forEach(function (n) {
        var inp = cfg.inputs[n] || {};
        if (!isObj(inp)) { errs.push(at(cfg.inputs, n, "Unexpected value '" + str(inp) + "'")); return; }
        keys(inp).forEach(function (kk) { if (["description", "required", "default", "type", "options", "deprecationMessage"].indexOf(kk) < 0) errs.push(at(inp, kk, "Unexpected value '" + kk + "'")); });
        if (inp.type && ["string", "boolean", "choice", "number", "environment"].indexOf(inp.type) < 0) errs.push(at(inp, "type", "Unexpected value '" + inp.type + "'"));
        if (inp.type === "choice" && !Array.isArray(inp.options)) errs.push(at(inp, "type", "Input '" + n + "' of type 'choice' needs 'options'"));
      });
    });
    function perms(p, obj, k) {
      if (p === null || p === undefined) return;
      if (typeof p === "string") { if (["read-all", "write-all"].indexOf(p) < 0) errs.push(at(obj, k, "Unexpected value '" + p + "'")); return; }
      if (!isObj(p)) { errs.push(at(obj, k, "Unexpected value '" + str(p) + "'")); return; }
      keys(p).forEach(function (s) { if (PERM_SCOPES.indexOf(s) < 0) errs.push(at(p, s, "Unexpected value '" + s + "'")); else if (["read", "write", "none"].indexOf(p[s]) < 0 || (s === "id-token" && p[s] === "read")) errs.push(at(p, s, "Unexpected value '" + str(p[s]) + "'")); });
    }
    perms(doc.permissions, doc, "permissions");
    if (!has(doc, "jobs")) { errs.push("Required property is missing: jobs"); return errs; }
    if (!isObj(doc.jobs) || !keys(doc.jobs).length) { errs.push(at(doc, "jobs", "Unexpected value '" + str(doc.jobs) + "'")); return errs; }
    keys(doc.jobs).forEach(function (id) {
      var j = doc.jobs[id];
      if (!/^[A-Za-z_][A-Za-z0-9_-]*$/.test(id)) errs.push(at(doc.jobs, id, "The identifier '" + id + "' is invalid. IDs may only contain alphanumeric characters, '_', and '-'. IDs must start with a letter or '_' and and must be less than 100 characters."));
      if (!isObj(j)) { errs.push(at(doc.jobs, id, "Unexpected value '" + str(j) + "'")); return; }
      keys(j).forEach(function (kk) { if (JOB_KEYS.indexOf(kk) < 0) errs.push(at(j, kk, "Unexpected value '" + kk + "'")); });
      if (j.uses) { errs.push(at(j, "uses", "Reusable workflows (jobs.<id>.uses) aren't simulated in this lab")); return; }
      if (!has(j, "runs-on")) errs.push(at(doc.jobs, id, "Required property is missing: runs-on"));
      if (!has(j, "steps")) errs.push(at(doc.jobs, id, "Required property is missing: steps"));
      perms(j.permissions, j, "permissions");
      list(j.needs).forEach(function (n) { if (!has(doc.jobs, n)) errs.push(at(j, "needs", "Job '" + id + "' depends on unknown job '" + n + "'.")); });
      if (has(j, "steps")) {
        if (!Array.isArray(j.steps)) { errs.push(at(j, "steps", "Unexpected value '" + str(j.steps) + "'")); return; }
        var ids = {};
        j.steps.forEach(function (st, i) {
          if (!isObj(st)) { errs.push(at(j.steps, i, "Unexpected value '" + str(st) + "'")); return; }
          keys(st).forEach(function (kk) { if (STEP_KEYS.indexOf(kk) < 0) errs.push(at(st, kk, "Unexpected value '" + kk + "'")); });
          if (has(st, "uses") && has(st, "run")) errs.push(at(st, "run", "Unexpected value 'run'. A step can't have both `uses` and `run`"));
          if (!has(st, "uses") && !has(st, "run")) errs.push(at(j.steps, i, "Every step must define a `uses` or `run` key"));
          if (st.id) { if (ids[st.id]) errs.push(at(st, "id", "The identifier '" + st.id + "' may not be used more than once within the same scope.")); ids[st.id] = 1; }
        });
      }
      if (j.strategy !== undefined && !isObj(j.strategy)) errs.push(at(j, "strategy", "Unexpected value '" + str(j.strategy) + "'"));
      if (isObj(j.strategy) && j.strategy.matrix !== undefined && !isObj(j.strategy.matrix) && !(typeof j.strategy.matrix === "string" && /\$\{\{/.test(j.strategy.matrix))) errs.push(at(j.strategy, "matrix", "Unexpected value '" + str(j.strategy.matrix) + "'"));
    });
    var state = {};
    function visit(id, from) {
      if (state[id] === 2) return;
      if (state[id] === 1) { errs.push("The workflow is not valid. Job '" + from + "' depends on job '" + id + "' which creates a cycle in the dependency graph."); return; }
      state[id] = 1; list((doc.jobs[id] || {}).needs).forEach(function (n) { if (has(doc.jobs, n)) visit(n, id); }); state[id] = 2;
    }
    keys(doc.jobs).forEach(function (id) { visit(id, id); });
    checkExprs(doc, errs, doc, null);
    return errs.filter(function (e, i, arr) { return arr.indexOf(e) === i; });
  }
  A.validate = validate;
  function loadWorkflow(p, text) {
    var w = { path: p, file: p.split("/").pop(), text: text, doc: null, errors: [], name: p, on: {} };
    var y = A.parseYaml(text);
    if (y.error) { w.errors = [y.error.message]; return w; }
    w.doc = y.value;
    if (isObj(w.doc) && typeof w.doc.name === "string" && w.doc.name) w.name = w.doc.name;
    w.errors = validate(w.doc);
    w.on = isObj(w.doc) ? normOn(w.doc.on) : {};
    return w;
  }
  // The workflow files in a commit
  function workflowsAt(sys, sha) {
    if (!sha) return [];
    var flat = G.commitFlat(sys, sha), out = [];
    keys(flat).sort().forEach(function (p) { if (/^\.github\/workflows\/[^/]+\.ya?ml$/.test(p)) out.push(loadWorkflow(p, G.blobText(sys, flat[p].sha))); });
    return out;
  }
  A.workflowsAt = workflowsAt; A.loadWorkflow = loadWorkflow;
  function wfId(path) { return 110000000 + hash(path) % 9000000; }

  /* ---------------- trigger filters: branches/tags/paths globs */
  function globRe(p) {
    var re = "", i = 0;
    for (; i < p.length; i++) {
      var ch = p.charAt(i);
      if (ch === "*") { if (p.charAt(i + 1) === "*") { re += ".*"; i++; if (p.charAt(i + 1) === "/") i++; } else re += "[^/]*"; }
      else if (ch === "?") re += "[^/]";
      else if (ch === "+") re += "+";
      else if ("\\^$.|()[]{}".indexOf(ch) >= 0) re += "\\" + ch;
      else re += ch;
    }
    return new RegExp("^" + re + "$");
  }
  // GitHub's rule: patterns apply in order, a leading ! excludes; the last match wins.
  function matchList(pats, val) {
    var hit = false;
    list(pats).forEach(function (p) { var neg = p.charAt(0) === "!"; if (globRe(neg ? p.slice(1) : p).test(val)) hit = !neg; });
    return hit;
  }
  A.matchList = matchList;
  function refFilter(cfg, ref) {
    if (!cfg) return true;
    var isTag = /^refs\/tags\//.test(ref), name = ref.replace(/^refs\/(heads|tags)\//, "");
    var hasB = has(cfg, "branches") || has(cfg, "branches-ignore"), hasT = has(cfg, "tags") || has(cfg, "tags-ignore");
    if (isTag) { if (!hasT) return !hasB; return has(cfg, "tags") ? matchList(cfg.tags, name) : !matchList(cfg["tags-ignore"], name); }
    if (!hasB) return !hasT;
    return has(cfg, "branches") ? matchList(cfg.branches, name) : !matchList(cfg["branches-ignore"], name);
  }
  function pathFilter(cfg, files) {
    if (!cfg || !files) return true;
    if (has(cfg, "paths")) return files.some(function (f) { return matchList(cfg.paths, f); });
    if (has(cfg, "paths-ignore")) return files.some(function (f) { return !matchList(cfg["paths-ignore"], f); });
    return true;
  }
  function changedFiles(sys, a, b) {
    var x = a ? G.commitFlat(sys, a) : {}, y = G.commitFlat(sys, b), out = [];
    keys(x).concat(keys(y)).forEach(function (k) { if (out.indexOf(k) < 0 && (!x[k] || !y[k] || x[k].sha !== y[k].sha)) out.push(k); });
    return out.sort();
  }

  /* ================================================================== actions: their repositories on GitHub, and resolving uses: */
  // Public repositories for the actions, with real-looking version tags, so `uses: x@<sha>` pinning can be looked up
  // (git ls-remote --tags https://github.com/actions/checkout). Major tags (v4) move to the newest release.
  var ACTION_REPOS = {
    "actions/checkout": { desc: "Action for checking out a repo", v: ["v3.6.0", "v4.1.7", "v4.2.2", "v5.0.0"] },
    "actions/setup-node": { desc: "Set up your GitHub Actions workflow with a specific version of node.js", v: ["v3.8.2", "v4.0.4", "v4.1.0", "v5.0.0"] },
    "actions/setup-python": { desc: "Set up your GitHub Actions workflow with a specific version of Python", v: ["v4.9.1", "v5.3.0", "v6.0.0"] },
    "actions/cache": { desc: "Cache dependencies and build outputs in GitHub Actions", v: ["v3.4.0", "v4.1.2", "v4.2.0"] },
    "actions/upload-artifact": { desc: "Upload a build artifact that can be used by subsequent workflow steps", v: ["v3.2.1", "v4.4.3", "v4.6.0"] },
    "actions/download-artifact": { desc: "Download a build artifact that was previously uploaded in the workflow by the upload-artifact action", v: ["v3.1.0", "v4.1.8"] }
  };
  // versions GitHub refuses to run any more
  var DEPRECATED = { "actions/upload-artifact": ["v1", "v2", "v3"], "actions/download-artifact": ["v1", "v2", "v3"], "actions/cache": ["v1", "v2"] };
  A.actionRepo = function (sys, full, o) {
    o = o || {};
    if (GH.find(sys, full)) return GH.find(sys, full);
    var r = GH.createRepo(sys, full, { private: false, description: o.desc || "" }), parent = null, t = Date.UTC(2023, 0, 10) / 1000, majors = {};
    (o.v || []).forEach(function (ver, i) {
      var who = { name: "GitHub Actions", email: "actions@github.com", time: t + i * 86400 * 60, tz: "+0000" };
      var flat = {
        "action.yml": { sha: G.putObject(sys, { type: "blob", content: "name: '" + full.split("/")[1] + "'\ndescription: '" + (o.desc || "") + "'\nruns:\n  using: 'node20'\n  main: 'dist/index.js'\n" }), mode: "100644" },
        "README.md": { sha: G.putObject(sys, { type: "blob", content: "# " + full.split("/")[1] + "\n\n" + (o.desc || "") + "\n\nRelease " + ver + "\n" }), mode: "100644" },
        "dist/index.js": { sha: G.putObject(sys, { type: "blob", content: "// " + full + " " + ver + " (bundled)\n" }), mode: "100644" }
      };
      var sha = G.putObject(sys, { type: "commit", tree: G.writeTree(sys, flat), parents: parent ? [parent] : [], author: who, committer: who, message: "Release " + ver + "\n" });
      parent = sha;
      r.refs["refs/tags/" + ver] = sha;
      majors[ver.split(".")[0]] = sha;
    });
    keys(majors).forEach(function (m) { r.refs["refs/tags/" + m] = majors[m]; });
    if (parent) r.refs["refs/heads/main"] = parent;
    r.created = Date.UTC(2019, 7, 1) / 1000;
    return r;
  };
  GH.GLOBAL.push(function (sys) { keys(ACTION_REPOS).forEach(function (full) { A.actionRepo(sys, full, ACTION_REPOS[full]); }); });
  A.HANDLERS = {};
  // uses: "owner/repo[/path]@ref" -> {key, full, ref, sha, tag} or {error}
  function resolveAction(sys, uses) {
    if (/^\.\//.test(uses)) return { error: "Local actions (" + uses + ") aren't simulated in this lab" };
    if (/^docker:\/\//.test(uses)) return { error: "Docker actions (" + uses + ") aren't simulated in this lab" };
    var m = /^([^/@\s]+)\/([^/@\s]+)((?:\/[^@\s]+)?)@(\S+)$/.exec(uses);
    if (!m) return { error: "Expected format {org}/{repo}[/path]@ref. Actual '" + uses + "'" };
    var full = m[1] + "/" + m[2], r = GH.find(sys, full), ref = m[4];
    if (!r) return { error: "Unable to resolve action `" + uses + "`, repository not found" };
    var sha = r.refs["refs/tags/" + ref] || r.refs["refs/heads/" + ref] || null;
    if (!sha && /^[0-9a-f]{40}$/.test(ref) && keys(r.refs).some(function (k) { return G.ancestors(sys, r.refs[k])[ref]; })) sha = ref;
    if (!sha) return { error: "Unable to resolve action `" + uses + "`, unable to find version `" + ref + "`" };
    var tag = keys(r.refs).filter(function (k) { return /^refs\/tags\/v\d+\.\d+/.test(k) && r.refs[k] === sha; }).map(function (k) { return k.slice(10); })[0] || ref;
    var major = /^v\d+/.test(tag) ? /^v\d+/.exec(tag)[0] : /^v\d+/.test(ref) ? /^v\d+/.exec(ref)[0] : null;
    var dep = DEPRECATED[r.full] && major && DEPRECATED[r.full].indexOf(major) >= 0;
    return { key: r.full + m[3], full: r.full, ref: ref, sha: sha, tag: tag, major: major, deprecated: dep, uses: uses };
  }
  A.resolveAction = resolveAction;
  A.action = function (key, h) { A.HANDLERS[key] = h; };

  /* ================================================================== runners */
  var RUNNER_HOME = "/home/runner";
  var NODE_DEFAULT = "20.19.5";
  function makeRunner(sys, seed) {
    var host = "fv-az" + (100 + seed % 800) + "-" + (100 + hash("h" + seed) % 900);
    var rs = S.makeSystem({ host: host });
    rs.gitObjects = sys.gitObjects || (sys.gitObjects = {});
    rs.github = GH.hub(sys);
    rs.now = sys.now; rs.gitTick = sys.gitTick || 0;
    rs.hubSys = sys.hubSys || sys;
    rs.isRunner = true;
    var pw = S.readSys(rs, "/etc/passwd").split("\n").filter(function (l) { var f = l.split(":"); return l && !(+f[2] >= 1000 && +f[2] < 65534); });
    pw.push("runner:x:1001:1001:,,,:/home/runner:/bin/bash");
    S.put(rs, "/etc/passwd", pw.join("\n") + "\n", 420);
    var gr = S.readSys(rs, "/etc/group").split("\n").filter(function (l) { var f = l.split(":"); return l && !(+f[2] >= 1000 && +f[2] < 65534); }).map(function (l) {
      var f = l.split(":"); if (f[0] === "sudo" || f[0] === "adm") { f[3] = (f[3] ? f[3].split(",").filter(function (u) { return /^(syslog)$/.test(u); }) : []).concat(["runner"]).join(","); return f.join(":"); } return l;
    });
    gr.push("docker:x:118:runner", "runner:x:1001:");
    S.put(rs, "/etc/group", gr.join("\n") + "\n", 420);
    S.put(rs, "/etc/sudoers.d/runner", "runner ALL=(ALL) NOPASSWD:ALL\n", 288);
    S.put(rs, "/etc/hostname", host + "\n", 420);
    delete S.mkdirs(rs, "/home").children.dev;
    S.mkdirs(rs, RUNNER_HOME + "/work/_temp/_runner_file_commands", 493, 1001, 1001);
    S.mkdirs(rs, RUNNER_HOME + "/work/_actions", 493, 1001, 1001);
    S.mkdirs(rs, "/opt/hostedtoolcache", 493, 1001, 1001);
    [RUNNER_HOME, RUNNER_HOME + "/work", RUNNER_HOME + "/work/_temp"].forEach(function (d) { var n = S.mkdirs(rs, d); n.uid = 1001; n.gid = 1001; n.mode = 493; });
    S.put(rs, RUNNER_HOME + "/.bashrc", "# ~/.bashrc\n", 420, 1001, 1001);
    S.put(rs, "/usr/bin/git", "\x7fELF:git (simulated binary)\n", 493);
    S.put(rs, "/usr/bin/shellcheck", "\x7fELF:shellcheck (simulated binary)\n", 493);
    S.put(rs, "/usr/bin/jq", "\x7fELF:jq (simulated binary)\n", 493);
    S.put(rs, "/usr/local/bin/node", "\x7fELF:node " + NODE_DEFAULT + "\n", 493);
    S.put(rs, "/usr/local/bin/npm", "\x7fELF:npm (simulated binary)\n", 493);
    S.put(rs, "/usr/local/bin/npx", "\x7fELF:npx (simulated binary)\n", 493);
    var sess = S.newSession(rs, { user: "runner" });
    rs.topSession = sess;
    return { sys: rs, sess: sess, host: host };
  }
  A.makeRunner = makeRunner;

  /* ================================================================== jobs: running steps */
  function isoAt(t) { return new Date(t * 1000).toISOString().replace(/\.(\d{3})Z$/, ".$10000Z"); }
  A.isoAt = isoAt;
  function permsFor(r, wfPerm, jobPerm, fork) {
    var base = r.settings.actionsPermissions === "write" ? "write-all" : "read-default";
    var p = jobPerm !== undefined ? jobPerm : wfPerm !== undefined ? wfPerm : base, out = {};
    if (p === "write-all" || p === "read-all") PERM_SCOPES.forEach(function (s) { if (s !== "id-token" || p === "write-all") out[s] = p === "write-all" ? "write" : "read"; });
    else if (p === "read-default") { out.contents = "read"; out.packages = "read"; out.metadata = "read"; }
    else if (isObj(p)) keys(p).forEach(function (s) { if (p[s] !== "none") out[s] = p[s]; });
    if (!out.metadata) out.metadata = "read";
    if (fork) keys(out).forEach(function (s) { if (out[s] === "write" && s !== "id-token") out[s] = "read"; });
    return out;
  }
  A.permsFor = permsFor;
  function permTitle(s) { return s.split("-").map(function (w, i) { return i ? w : w.charAt(0).toUpperCase() + w.slice(1); }).join("-").replace(/^Id-token$/, "IdToken").replace(/^Pull-requests$/, "PullRequests").replace(/^Security-events$/, "SecurityEvents"); }
  function parseFileCmds(text, kind) {
    var out = [], ls = String(text || "").split("\n"), i = 0;
    for (; i < ls.length; i++) {
      var l = ls[i];
      if (l === "") continue;
      var m = /^([^=<]+)<<(.+)$/.exec(l);
      if (m) {
        var delim = m[2], val = [], j = i + 1;
        for (; j < ls.length && ls[j] !== delim; j++) val.push(ls[j]);
        if (j >= ls.length) return { error: "Unable to process file command '" + kind + "' successfully.\nInvalid value. Matching delimiter not found '" + delim + "'" };
        out.push([m[1], val.join("\n")]); i = j; continue;
      }
      var e = l.indexOf("=");
      if (e <= 0) return { error: "Unable to process file command '" + kind + "' successfully.\nInvalid format '" + l + "'" };
      out.push([l.slice(0, e), l.slice(e + 1)]);
    }
    return { list: out };
  }
  // One job on one runner. J = {sys, r, run, job, def, wf, ctx, ...}
  function Job(sys, r, run, job, def, wf, base) {
    var J = this;
    J.sys = sys; J.r = r; J.run = run; J.job = job; J.def = def; J.wf = wf;
    J.rn = makeRunner(sys, job.id);
    J.rs = J.rn.sys;
    J.rs.runId = run.id;
    J.ws = RUNNER_HOME + "/work/" + r.name + "/" + r.name;
    S.mkdirs(J.rs, J.ws, 493, 1001, 1001);
    var n = S.mkdirs(J.rs, RUNNER_HOME + "/work/" + r.name); n.uid = 1001; n.gid = 1001;
    var nw = S.mkdirs(J.rs, J.ws); nw.uid = 1001; nw.gid = 1001;
    J.masks = [];
    J.envJob = {}; J.pathAdd = []; J.summary = "";
    J.t = base.t; J.secs = 0;
    J.status = "success";
    J.posts = [];
    J.stepsCtx = {};
    J.ctx = base.ctx;
    J.debug = !!run.debug || (base.ctx.secrets && base.ctx.secrets.ACTIONS_STEP_DEBUG === "true");
    J.ctx.runner = { os: "Linux", arch: "X64", name: "GitHub Actions " + (1000000000 + job.id % 1000000), temp: RUNNER_HOME + "/work/_temp", tool_cache: "/opt/hostedtoolcache", environment: "github-hosted", debug: J.debug ? "1" : "" };
    J.ctx.steps = J.stepsCtx;
    J.ctx.job = { status: "success" };
    J.ctx.__status = function () { return J.status; };
    J.ctx.__hashFiles = function (pats) { return J.hashFiles(pats); };
    keys(J.ctx.secrets || {}).forEach(function (k) { J.addMask(J.ctx.secrets[k]); });
  }
  Job.prototype.addMask = function (v) {
    var J = this;
    String(v == null ? "" : v).split("\n").forEach(function (x) { x = x.replace(/\r$/, ""); if (x.length >= 2 && J.masks.indexOf(x) < 0) J.masks.push(x); });
    J.masks.sort(function (a, b) { return b.length - a.length; });
  };
  Job.prototype.mask = function (t) { this.masks.forEach(function (m) { t = String(t).split(m).join("***"); }); return t; };
  Job.prototype.log = function (step, text) {
    var J = this;
    lines(text).forEach(function (l) { step.log.push({ t: J.t + J.secs, text: J.mask(l) }); });
  };
  Job.prototype.annotate = function (level, msg, extra) {
    var a = Object.assign({ level: level, message: this.mask(msg), job: this.job.name, jobId: this.job.id, step: this.cur ? this.cur.name : null, file: ".github", line: this.cur ? this.cur.number : null }, extra || {});
    this.run.annotations.push(a);
  };
  Job.prototype.env = function () {
    var J = this, e = {};
    function add(o, ctx) { keys(o || {}).forEach(function (k) { e[k] = interpStr(o[k] === null ? "" : typeof o[k] === "string" ? o[k] : str(o[k]), ctx || J.ctx); }); }
    add(J.wf.doc.env);
    keys(J.envJobDef || {}).forEach(function (k) { e[k] = J.envJobDef[k]; });
    keys(J.envJob).forEach(function (k) { e[k] = J.envJob[k]; });
    return e;
  };
  Job.prototype.hashFiles = function (pats) {
    var J = this, files = [];
    function walk(dir, rel) { var n = G.nodeAt(J.rs, dir); if (!n || n.type !== "d") return; keys(n.children).sort().forEach(function (k) { var c = n.children[k], p = rel ? rel + "/" + k : k; if (c.type === "d") { if (k !== ".git" && k !== "node_modules") walk(dir + "/" + k, p); } else if (c.type === "f") files.push({ p: p, c: c.content }); }); }
    walk(J.ws, "");
    var hit = files.filter(function (f) { return matchList(pats.map(function (p) { return p.replace(/^\.\//, ""); }), f.p); });
    if (!hit.length) return "";
    return M2.sha256 ? M2.sha256(hit.map(function (f) { return M2.sha256(f.c); }).join("")) : ("0000000000000000" + hash(hit.map(function (f) { return f.c; }).join("\0")).toString(16)).slice(-16) + new Array(49).join("0");
  };
  // A shell for one step: the runner user, the job's environment, in the workspace
  Job.prototype.shell = function (envAll, wd) {
    var J = this, sess = S.newSession(J.rs, { user: "runner" });
    var base = {
      CI: "true", GITHUB_ACTIONS: "true", HOME: RUNNER_HOME, USER: "runner", SHELL: "/bin/bash", ImageOS: "ubuntu24", ImageVersion: "20251102.1.0",
      RUNNER_OS: "Linux", RUNNER_ARCH: "X64", RUNNER_NAME: J.ctx.runner.name, RUNNER_TEMP: RUNNER_HOME + "/work/_temp", RUNNER_TOOL_CACHE: "/opt/hostedtoolcache", RUNNER_WORKSPACE: RUNNER_HOME + "/work/" + J.r.name,
      GITHUB_WORKSPACE: J.ws, GITHUB_REPOSITORY: J.r.full, GITHUB_REPOSITORY_OWNER: J.r.owner, GITHUB_SHA: J.run.sha, GITHUB_REF: J.run.ref, GITHUB_REF_NAME: J.ctx.github.ref_name, GITHUB_REF_TYPE: J.ctx.github.ref_type,
      GITHUB_HEAD_REF: J.ctx.github.head_ref, GITHUB_BASE_REF: J.ctx.github.base_ref, GITHUB_EVENT_NAME: J.run.event, GITHUB_ACTOR: J.run.actor, GITHUB_TRIGGERING_ACTOR: J.run.actor,
      GITHUB_RUN_ID: String(J.run.id), GITHUB_RUN_NUMBER: String(J.run.number), GITHUB_RUN_ATTEMPT: String(J.run.attempt), GITHUB_WORKFLOW: J.run.wfName, GITHUB_WORKFLOW_REF: J.r.full + "/" + J.run.wfPath + "@" + J.run.ref,
      GITHUB_JOB: J.job.key, GITHUB_SERVER_URL: "https://github.com", GITHUB_API_URL: "https://api.github.com", GITHUB_GRAPHQL_URL: "https://api.github.com/graphql", GITHUB_EVENT_PATH: RUNNER_HOME + "/work/_temp/_github_workflow/event.json",
      GITHUB_ACTION_REPOSITORY: "", GITHUB_RETENTION_DAYS: "90"
    };
    if (J.debug) base.RUNNER_DEBUG = "1";
    var e = Object.assign(base, envAll);
    sess.vars = {};
    keys(e).forEach(function (k) { sess.vars[k] = { v: String(e[k]), x: true }; });
    var path = "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/snap/bin";
    if (J.pathAdd.length) path = J.pathAdd.slice().reverse().join(":") + ":" + path;
    sess.vars.PATH = { v: e.PATH && envAll.PATH ? envAll.PATH : path, x: true };
    sess.vars.IFS = { v: " \t\n", x: false };
    sess.vars.UID = { v: "1001", x: false }; sess.vars.EUID = { v: "1001", x: false };
    sess.cwd = wd;
    sess.vars.PWD = { v: wd, x: true };
    J.rs.topSession = sess;
    return sess;
  };
  Job.prototype.fileCmds = function () {
    var J = this, d = RUNNER_HOME + "/work/_temp/_runner_file_commands", id = J.job.id + "_" + (J.cur ? J.cur.number : 0), f = {};
    ["set_output", "set_env", "add_path", "step_summary", "save_state"].forEach(function (k) { f[k] = d + "/" + k + "_" + id; S.put(J.rs, f[k], "", 420, 1001, 1001); });
    return f;
  };
  Job.prototype.readFileCmds = function (f, step) {
    var J = this, rd = function (p) { var n = G.nodeAt(J.rs, p); return n && n.type === "f" ? n.content : ""; }, outputs = {};
    var o = parseFileCmds(rd(f.set_output), "output");
    if (o.error) { J.log(step, "##[error]" + o.error); return { error: true }; }
    o.list.forEach(function (kv) { outputs[kv[0]] = kv[1]; });
    var e = parseFileCmds(rd(f.set_env), "env");
    if (e.error) { J.log(step, "##[error]" + e.error); return { error: true }; }
    e.list.forEach(function (kv) { J.envJob[kv[0]] = kv[1]; });
    lines(rd(f.add_path)).forEach(function (p) { if (p) J.pathAdd.push(p); });
    var sm = rd(f.step_summary); if (sm) J.summary += sm.replace(/\n?$/, "\n");
    return { outputs: outputs };
  };
  // Workflow commands printed by a step (::error::, ::add-mask::, ::group::, ...)
  Job.prototype.emitOutput = function (step, text) {
    var J = this, fail = false, outputs = {};
    lines(text).forEach(function (l) {
      var m = /^::([\w-]+)(?:\s+([^:]*?))?::(.*)$/.exec(l);
      if (!m) { J.log(step, l); return; }
      var cmd = m[1], params = {}, msg = m[3];
      (m[2] || "").split(",").forEach(function (kv) { var e2 = kv.indexOf("="); if (e2 > 0) params[kv.slice(0, e2).trim()] = kv.slice(e2 + 1); });
      if (cmd === "add-mask") { J.addMask(msg); return; }
      if (cmd === "error" || cmd === "warning" || cmd === "notice") { J.log(step, "##[" + cmd + "]" + msg); J.annotate(cmd, msg, params.file ? { file: params.file, line: params.line ? +params.line : null, title: params.title } : {}); return; }
      if (cmd === "debug") { if (J.debug) J.log(step, "##[debug]" + msg); return; }
      if (cmd === "group") { J.log(step, "##[group]" + msg); return; }
      if (cmd === "endgroup") { J.log(step, "##[endgroup]"); return; }
      if (cmd === "notice") return;
      if (cmd === "set-output") { J.log(step, "##[warning]The `set-output` command is deprecated and will be disabled soon. Please upgrade to using Environment Files. For more information see: https://github.blog/changelog/2022-10-11-github-actions-deprecating-save-state-and-set-output-commands/"); J.annotate("warning", "The `set-output` command is deprecated and will be disabled soon. Please upgrade to using Environment Files."); if (params.name) outputs[params.name] = msg; return; }
      if (cmd === "set-env" || cmd === "add-path") { J.log(step, "##[error]Unable to process command '" + l + "' successfully."); J.log(step, "##[error]The `" + cmd + "` command is disabled. Please upgrade to using Environment Files or opt into unsecure command execution by setting the `ACTIONS_ALLOW_UNSECURE_COMMANDS` environment variable to `true`. For more information see: https://github.blog/changelog/2020-10-01-github-actions-deprecating-set-env-and-add-path-commands/"); J.annotate("error", "The `" + cmd + "` command is disabled. Please upgrade to using Environment Files or opt into unsecure command execution by setting the `ACTIONS_ALLOW_UNSECURE_COMMANDS` environment variable to `true`."); fail = true; return; }
      J.log(step, l);
    });
    return { fail: fail, outputs: outputs };
  };
  // Run a script the way a `run:` step does. Returns the exit code.
  Job.prototype.exec = function (step, script, shellSpec, wd, envAll, timeoutMin) {
    var J = this, sh = String(shellSpec || "bash-default"), opts = { errexit: true };
    if (/^(pwsh|powershell|python|cmd)\b/.test(sh)) { J.log(step, "##[error]This lab's runners only simulate bash and sh steps (shell: " + sh + ")."); return 1; }
    if (sh === "bash") opts.pipefail = true;
    else if (/\{0\}/.test(sh)) { opts.errexit = /\s-\w*e/.test(" " + sh); opts.pipefail = /pipefail/.test(sh); }
    var f = J.fileCmds(), path = RUNNER_HOME + "/work/_temp/" + G.abbrev(M2.sha256 ? M2.sha256(J.job.id + ":" + step.number) : String(hash(J.job.id + ":" + step.number)), 8) + "-" + step.number + ".sh";
    S.put(J.rs, path, script, 436, 1001, 1001);
    var e2 = Object.assign({}, envAll, { GITHUB_OUTPUT: f.set_output, GITHUB_ENV: f.set_env, GITHUB_PATH: f.add_path, GITHUB_STEP_SUMMARY: f.step_summary, GITHUB_STATE: f.save_state });
    var sess = J.shell(e2, wd), buf = [];
    var io = { stdin: "", out: function (t) { buf.push(t); }, err: function (t) { buf.push(t); }, note: function (t) { buf.push(t); }, color: function (t) { buf.push(t); }, tty: false };
    sess.scriptOpts = opts;
    sess.maxSteps = 200000 * Math.max(1, Math.min(timeoutMin || 360, 10));
    var code;
    try { code = S.runScriptFile(sess, path, [], io, path); }
    catch (e) {
      if (e instanceof S.StepLimit) { buf.push("\n"); J.cancelled = "timeout"; code = 124; }
      else if (e instanceof S.ShError) { buf.push(e.message + "\n"); code = e.code || 1; }
      else throw e;
    }
    var w = J.emitOutput(step, buf.join(""));
    var fc = J.readFileCmds(f, step);
    step.outputs = Object.assign({}, w.outputs, fc.outputs || {});
    if (J.cancelled === "timeout") { J.log(step, "##[error]The action '" + step.name + "' has timed out after " + (timeoutMin || 360) + " minutes."); J.annotate("error", "The action '" + step.name + "' has timed out after " + (timeoutMin || 360) + " minutes."); J.cancelled = null; return 124; }
    if (code !== 0) { J.log(step, "##[error]Process completed with exit code " + code + "."); J.annotate("error", "Process completed with exit code " + code + "."); return code; }
    if (w.fail || fc.error) return 1;
    return 0;
  };
  function shellLine(sh, def) { if (!sh) return "/usr/bin/bash -e {0}"; if (sh === "bash") return "/usr/bin/bash --noprofile --norc -eo pipefail {0}"; if (sh === "sh") return "/usr/bin/sh -e {0}"; return sh; }
  // Run all steps of the job; fills job.steps, job.outputs, job.conclusion
  Job.prototype.go = function () {
    var J = this, job = J.job, def = J.def, run = J.run, r = J.r;
    var steps = Array.isArray(def.steps) ? def.steps : [];
    function addStep(name) { var s = { number: job.steps.length + 1, name: name, status: "in_progress", conclusion: null, log: [], secs: 0 }; job.steps.push(s); J.cur = s; return s; }
    function endStep(s, conc, secs) { s.secs = secs || 0; J.secs += s.secs; s.status = "completed"; s.conclusion = conc; }
    // Set up job
    var su = addStep("Set up job"), perms = J.perms;
    J.log(su, "Current runner version: '2.329.0'\nRunner name: '" + J.ctx.runner.name + "'\nRunner group name: 'GitHub Actions'\nMachine name: '" + J.rn.host + "'\n##[group]Operating System\nUbuntu\n24.04.3\nLTS\n##[endgroup]\n##[group]Runner Image\nImage: ubuntu-24.04\nVersion: 20251102.1.0\nIncluded Software: https://github.com/actions/runner-images/blob/ubuntu24/20251102.1/images/ubuntu/Ubuntu2404-Readme.md\n##[endgroup]");
    J.log(su, "##[group]GITHUB_TOKEN Permissions\n" + keys(perms).sort().map(function (s) { return permTitle(s) + ": " + perms[s]; }).join("\n") + "\n##[endgroup]\nSecret source: " + (run.fork ? "None" : "Actions") + "\nPrepare workflow directory\nPrepare all required actions\nGetting action download info");
    var resolved = [], bad = null;
    steps.forEach(function (st, i) {
      if (!st || !st.uses || bad) return;
      var ra = resolveAction(J.sys, String(st.uses));
      if (ra.error) { bad = ra.error; return; }
      if (ra.deprecated) { bad = "This request has been automatically failed because it uses a deprecated version of `" + ra.full + ": " + ra.ref + "`. Learn more: https://github.blog/changelog/2024-04-16-deprecation-notice-v3-of-the-artifact-actions/"; return; }
      resolved[i] = ra;
      if (!resolved.some(function (x, k) { return k < i && x && x.uses === ra.uses; })) J.log(su, "Download action repository '" + ra.uses + "' (SHA:" + ra.sha + ")");
    });
    if (bad) { J.log(su, "##[error]" + bad); J.annotate("error", bad, { line: null }); endStep(su, "failure", 1); return J.finish("failure"); }
    J.log(su, "Complete job name: " + job.name);
    endStep(su, "success", 2);
    // the steps
    var mains = [];
    steps.forEach(function (st, i) {
      if (!st) return;
      var ra = resolved[i], name;
      try { name = st.name !== undefined ? interpStr(String(st.name), J.ctx) : st.uses ? "Run " + st.uses : "Run " + String(st.run).split("\n").filter(function (l) { return l.trim(); })[0]; }
      catch (e) { if (!(e instanceof ExprError)) throw e; name = String(st.name || st.uses || st.run); }
      var s = addStep(name);
      var cond;
      try { cond = evalIf(st["if"], J.ctx); }
      catch (e) { if (!(e instanceof ExprError)) throw e; J.log(s, "##[error]The step failed and an error occurred when attempting to determine whether to continue:\n##[error]" + e.message); J.annotate("error", e.message); endStep(s, "failure", 0); J.status = "failure"; return; }
      if (!cond) {
        s.status = "completed"; s.conclusion = "skipped"; s.log = [];
        if (st.id) J.stepsCtx[st.id] = { outputs: {}, outcome: "skipped", conclusion: "skipped" };
        return;
      }
      var envAll = J.env(), stepEnv = {};
      keys(st.env || {}).forEach(function (k) { try { stepEnv[k] = interpStr(st.env[k] === null ? "" : typeof st.env[k] === "string" ? st.env[k] : str(st.env[k]), Object.assign({}, J.ctx, { env: envAll })); } catch (e) { if (!(e instanceof ExprError)) throw e; stepEnv[k] = ""; } });
      Object.assign(envAll, stepEnv);
      var sctx = Object.assign({}, J.ctx, { env: envAll });
      var code = 0, secs = 1;
      try {
        if (st.run !== undefined) {
          var script = interpStr(String(st.run === null ? "" : st.run), sctx), sh = st.shell || (def.defaults && def.defaults.run && def.defaults.run.shell) || (J.wf.doc.defaults && J.wf.doc.defaults.run && J.wf.doc.defaults.run.shell);
          var wdRel = st["working-directory"] || (def.defaults && def.defaults.run && def.defaults.run["working-directory"]) || (J.wf.doc.defaults && J.wf.doc.defaults.run && J.wf.doc.defaults.run["working-directory"]);
          var wd = wdRel ? (String(wdRel).charAt(0) === "/" ? String(wdRel) : S.normAbs(J.ws + "/" + interpStr(String(wdRel), sctx))) : J.ws;
          J.log(s, "##[group]Run " + lines(script).filter(function (l) { return l.trim(); })[0]);
          J.log(s, script.replace(/\n$/, ""));
          J.log(s, "shell: " + shellLine(sh));
          var shown = keys(J.envJobDef || {}).concat(keys(J.wf.doc.env || {}), keys(stepEnv), keys(J.envJob)).filter(function (k, ix, arr) { return arr.indexOf(k) === ix; });
          if (shown.length) J.log(s, "env:\n" + shown.map(function (k) { return "  " + k + ": " + envAll[k]; }).join("\n"));
          J.log(s, "##[endgroup]");
          var wn = G.nodeAt(J.rs, wd);
          if (!wn || wn.type !== "d") { J.log(s, "##[error]An error occurred trying to start process '/usr/bin/bash' with working directory '" + wd + "'. No such file or directory"); J.annotate("error", "An error occurred trying to start process '/usr/bin/bash' with working directory '" + wd + "'. No such file or directory"); code = 1; }
          else { code = J.exec(s, script, sh, wd, envAll, st["timeout-minutes"]); secs = 1 + hash(script) % 4; }
          if (st.id) J.stepsCtx[st.id] = { outputs: s.outputs || {}, outcome: code ? "failure" : "success", conclusion: code ? "failure" : "success" };
        } else {
          var w = {};
          keys(st["with"] || {}).forEach(function (k) { var v = st["with"][k]; w[k] = v === null ? "" : interpStr(typeof v === "string" ? v : str(v), sctx); });
          var h = A.HANDLERS[ra.key];
          J.log(s, "##[group]Run " + ra.uses);
          var shownW = Object.assign({}, h && h.defaults ? h.defaults(J) : {}, w);
          if (keys(shownW).length) J.log(s, "with:\n" + keys(shownW).map(function (k) { return "  " + k + ": " + String(shownW[k]).replace(/\n/g, "\n  "); }).join("\n"));
          if (keys(stepEnv).length || keys(J.envJob).length) J.log(s, "env:\n" + keys(Object.assign({}, J.envJob, stepEnv)).map(function (k) { return "  " + k + ": " + envAll[k]; }).join("\n"));
          J.log(s, "##[endgroup]");
          var res = h ? h.run(J, s, Object.assign({}, h.defaults ? h.defaults(J) : {}, w), envAll, ra) : { code: 0, note: true };
          if (res.note) J.log(s, "(The lab simulates this action as a no-op: " + ra.uses + ")");
          code = res.code || 0; secs = res.secs || 2;
          if (res.post) J.posts.push({ name: "Post " + name, fn: res.post, uses: ra.uses, cond: st["if"] });
          s.outputs = res.outputs || {};
          if (st.id) J.stepsCtx[st.id] = { outputs: s.outputs, outcome: code ? "failure" : "success", conclusion: code ? "failure" : "success" };
        }
      } catch (e) {
        if (!(e instanceof ExprError)) throw e;
        J.log(s, "##[error]" + e.message); J.annotate("error", e.message); code = 1;
      }
      var coe = st["continue-on-error"] === true || st["continue-on-error"] === "true";
      endStep(s, code === 0 || coe ? "success" : "failure", secs);
      s.outcome = code === 0 ? "success" : "failure";
      if (st.id && J.stepsCtx[st.id]) J.stepsCtx[st.id].conclusion = s.conclusion;
      if (code !== 0 && !coe) J.status = "failure";
      mains.push(s);
    });
    // post steps run in reverse order
    J.posts.slice().reverse().forEach(function (p) {
      var s = addStep(p.name);
      var res = p.fn(J, s) || {};
      endStep(s, res.code ? "failure" : "success", res.secs || 1);
      if (res.code) J.status = "failure";
    });
    var cj = addStep("Complete job");
    J.log(cj, "Cleaning up orphan processes");
    endStep(cj, "success", 0);
    return J.finish(J.status);
  };
  Job.prototype.finish = function (concl) {
    var J = this, job = J.job, def = J.def;
    job.status = "completed"; job.conclusion = concl;
    job.secs = J.secs; job.completed = J.t + J.secs;
    job.summary = J.summary;
    job.outputs = {};
    keys(def.outputs || {}).forEach(function (k) { try { job.outputs[k] = interpStr(String(def.outputs[k]), J.ctx); } catch (e) { if (!(e instanceof ExprError)) throw e; job.outputs[k] = ""; } });
    keys(job.outputs).forEach(function (k) { if (J.masks.some(function (m) { return String(job.outputs[k]).indexOf(m) >= 0; })) { job.outputs[k] = ""; job.maskedOutputs = (job.maskedOutputs || []).concat([k]); } });
    return concl;
  };
  A.Job = Job;

  /* ================================================================== the simulated actions */
  function rd(sys, p) { var n = G.nodeAt(sys, p); return n && n.type === "f" ? n.content : null; }
  function isDir(sys, p) { var n = G.nodeAt(sys, p); return !!n && n.type === "d"; }
  function absIn(J, p) { p = String(p).trim().replace(/^~(?=\/|$)/, RUNNER_HOME); return p.charAt(0) === "/" ? S.normAbs(p) : S.normAbs(J.ws + "/" + p); }
  function walkFiles(sys, dir, rel, out) {
    var n = G.nodeAt(sys, dir); if (!n || n.type !== "d") return out;
    keys(n.children).sort().forEach(function (k) { var c = n.children[k], p = rel ? rel + "/" + k : k; if (c.type === "d") walkFiles(sys, dir + "/" + k, p, out); else if (c.type === "f") out.push({ rel: p, abs: dir + "/" + k, content: c.content, mode: c.mode, size: c.size }); });
    return out;
  }
  function putSized(sys, abs, content, mode, uid, gid, size) { G.putFile(sys, abs, content, mode, uid, gid); if (size != null) { var n = G.nodeAt(sys, abs); if (n) n.size = size; } }
  A.putSized = putSized;
  function putRunner(J, abs, content, mode, size) { putSized(J.rs, abs, content, mode == null ? 420 : mode, 1001, 1001, size); }
  function kb(n) { return n < 1024 ? n + " B" : (n / 1024).toFixed(2) + " KiB"; }
  function bytes(files) { return files.reduce(function (s, f) { return s + String(f.content).length; }, 0); }

  // actions/checkout
  A.action("actions/checkout", {
    defaults: function (J) { return { repository: J.r.full, token: J.token }; },
    run: function (J, s, w) {
      var full = w.repository || J.r.full, r2 = GH.find(J.sys, full), dest = w.path ? absIn(J, w.path) : J.ws;
      var depth = w["fetch-depth"] === undefined || w["fetch-depth"] === "" ? 1 : +w["fetch-depth"], persist = String(w["persist-credentials"] === undefined ? "true" : w["persist-credentials"]) !== "false";
      J.log(s, "Syncing repository: " + full + "\n##[group]Getting Git version info\nWorking directory is '" + dest + "'\n[command]/usr/bin/git version\ngit version 2.51.2\n##[endgroup]");
      var ti = GH.tokenInfo(J.sys, w.token), login = ti ? ti.login : null;
      if (!r2 || !GH.can(J.sys, r2, login, "read")) {
        J.log(s, "[command]/usr/bin/git -c protocol.version=2 fetch --no-tags --prune --no-recurse-submodules --depth=" + depth + " origin\nremote: Repository not found.\n##[error]fatal: repository 'https://github.com/" + full + "/' not found\nThe process '/usr/bin/git' failed with exit code 128");
        J.annotate("error", "fatal: repository 'https://github.com/" + full + "/' not found");
        return { code: 1, secs: 2 };
      }
      var sha, branch = null, rref = null, ref = w.ref || "";
      if (ref) {
        sha = r2.refs["refs/heads/" + ref] || r2.refs["refs/tags/" + ref] || r2.refs[ref] || (/^[0-9a-f]{40}$/.test(ref) ? ref : null);
        if (r2.refs["refs/heads/" + ref]) { branch = ref; rref = "refs/remotes/origin/" + ref; }
        else if (r2.refs["refs/tags/" + ref]) rref = "refs/tags/" + ref;
        if (!sha) { J.log(s, "##[error]A branch or tag with the name '" + ref + "' could not be found"); J.annotate("error", "A branch or tag with the name '" + ref + "' could not be found"); return { code: 1, secs: 2 }; }
      } else if (full === J.r.full) {
        sha = J.run.sha;
        var m = /^refs\/heads\/(.+)$/.exec(J.run.ref), pm = /^refs\/pull\/(\d+)\/merge$/.exec(J.run.ref);
        if (m) { branch = m[1]; rref = "refs/remotes/origin/" + branch; }
        else if (pm) rref = "refs/remotes/pull/" + pm[1] + "/merge";
        else if (/^refs\/tags\//.test(J.run.ref)) rref = J.run.ref;
      } else { branch = r2.default; sha = r2.refs["refs/heads/" + branch]; rref = "refs/remotes/origin/" + branch; }
      sha = G.peel(J.sys, sha);
      var kids = G.nodeAt(J.rs, dest);
      if (kids && kids.type === "d") kids.children = {};
      J.log(s, "Deleting the contents of '" + dest + "'\n##[group]Initializing the repository\n[command]/usr/bin/git init " + dest + "\nInitialized empty Git repository in " + dest + "/.git/\n[command]/usr/bin/git remote add origin https://github.com/" + full + "\n##[endgroup]");
      var repo = G.initRepo(J.rs, dest, 1001, 1001, branch || "main");
      GH.addFetchSpec(J.rs, repo, "origin", "https://github.com/" + full);
      if (persist) { GH.writeConfig(J.rs, repo, [["http.https://github.com/.extraheader", "AUTHORIZATION: basic " + GH.b64encode("x-access-token:" + w.token)]]); J.log(s, "##[group]Setting up auth\n[command]/usr/bin/git config --local http.https://github.com/.extraheader AUTHORIZATION: basic ***\n##[endgroup]"); }
      if (depth === 0) {
        keys(r2.refs).forEach(function (k) { if (/^refs\/heads\//.test(k)) G.gwrite(repo, "refs/remotes/origin/" + k.slice(11), r2.refs[k] + "\n"); else if (/^refs\/tags\//.test(k)) G.gwrite(repo, k, r2.refs[k] + "\n"); });
      }
      if (rref) G.gwrite(repo, rref, sha + "\n");
      GH.storeReachable(J.rs, repo, depth === 0 ? keys(r2.refs).map(function (k) { return r2.refs[k]; }).concat([sha]) : [sha]);
      J.log(s, "##[group]Fetching the repository\n[command]/usr/bin/git -c protocol.version=2 fetch " + (depth === 0 ? "--prune --no-recurse-submodules origin +refs/heads/*:refs/remotes/origin/* +refs/tags/*:refs/tags/*" : "--no-tags --prune --no-recurse-submodules --depth=" + depth + " origin +" + sha + ":" + (rref || "refs/remotes/origin/HEAD")) + "\n##[endgroup]");
      var who = { name: "runner", email: "runner@" + J.rn.host, time: now(J.sys), tz: "+0000" };
      if (branch) { G.gwrite(repo, "refs/heads/" + branch, sha + "\n"); G.gwrite(repo, "HEAD", "ref: refs/heads/" + branch + "\n"); G.logRef(repo, "HEAD", null, sha, "checkout: moving to " + branch, who); }
      else G.gwrite(repo, "HEAD", sha + "\n");
      var flat = G.commitFlat(J.sys, sha), idx = { entries: {}, conflicts: {} };
      keys(flat).forEach(function (p) { G.writeWork(repo, p, flat[p].sha, flat[p].mode, 18); idx.entries[p] = flat[p]; });
      G.writeIndex(repo, idx);
      J.log(s, "##[group]Checking out the ref\n" + (branch ? "[command]/usr/bin/git checkout --progress --force -B " + branch + " " + rref + "\nSwitched to a new branch '" + branch + "'\nbranch '" + branch + "' set up to track 'origin/" + branch + "'." : "[command]/usr/bin/git checkout --progress --force " + (rref || sha) + "\nNote: switching to '" + (rref || sha).replace(/^refs\/remotes\//, "") + "'.\nHEAD is now at " + G.abbrev(sha, 7) + " " + G.commitOf(J.sys, sha).message.split("\n")[0]) + "\n##[endgroup]\n[command]/usr/bin/git log -1 --format=%H\n" + sha);
      return {
        code: 0, secs: 2,
        post: function (J2, s2) {
          J2.log(s2, "Post job cleanup.");
          if (persist) {
            var cfgp = repo.gitdir + "/config", t = rd(J2.rs, cfgp);
            if (t !== null) { G.putFile(J2.rs, cfgp, G.setInConfig(t, "http.https://github.com/.extraheader", null, true), 436, 1001, 1001); J2.log(s2, "[command]/usr/bin/git config --local --name-only --get-regexp http\\.https\\:\\/\\/github\\.com\\/\\.extraheader\nhttp.https://github.com/.extraheader\n[command]/usr/bin/git config --local --unset-all http.https://github.com/.extraheader"); }
          }
          return { code: 0 };
        }
      };
    }
  });

  // setup-node / setup-python: tool versions in /opt/hostedtoolcache, put on PATH
  var NODE = { "16": "16.20.2", "18": "18.20.8", "20": "20.19.5", "21": "21.7.3", "22": "22.21.1", "23": "23.11.1", "24": "24.11.1", "25": "25.2.0" };
  var NPM = { "16": "8.19.4", "18": "10.8.2", "20": "10.8.2", "21": "10.5.0", "22": "10.9.4", "23": "10.9.2", "24": "11.6.2", "25": "11.6.2" };
  A.NODE = NODE; A.NPM = NPM;
  function nodeVersion(v) {
    v = String(v).trim().replace(/^v/, "");
    if (v === "lts/*" || v === "lts") return NODE["24"];
    if (v === "latest" || v === "current" || v === "node") return NODE["25"];
    var m = /^(\d+)(?:\.(x|\*|\d+)(?:\.(x|\*|\d+))?)?$/.exec(v);
    if (!m || !NODE[m[1]]) return null;
    if (m[3] && /^\d+$/.test(m[3])) return m[1] + "." + m[2] + "." + m[3];
    return NODE[m[1]];
  }
  A.nodeVersion = nodeVersion;
  function cacheRestore(J, s, key, restoreKeys, paths) {
    var c = J.r.caches, hit = c[key] ? key : null, used = hit;
    if (!hit) (restoreKeys || []).some(function (pre) { var cand = keys(c).filter(function (k) { return k.indexOf(pre) === 0; }).sort(function (a, b) { return c[b].created - c[a].created; })[0]; if (cand) { used = cand; return true; } return false; });
    if (!used) return { hit: false, used: null };
    var e = c[used];
    keys(e.files).forEach(function (p) { putRunner(J, p, e.files[p].content, e.files[p].mode); });
    e.lastUsed = now(J.sys);
    J.log(s, "Cache Size: ~" + Math.max(1, Math.round(e.size / 1024)) + " MB (" + e.size * 1024 + " B)\n[command]/usr/bin/tar -xf /home/runner/work/_temp/" + G.abbrev(M2.sha256(used), 8) + "/cache.tzst -P -C " + J.ws + " --use-compress-program unzstd\nCache restored successfully");
    return { hit: used === key, used: used };
  }
  function cacheSave(J, s, key, paths) {
    var files = {}, n = 0;
    paths.forEach(function (p) { var abs = absIn(J, p); if (isDir(J.rs, abs)) walkFiles(J.rs, abs, "", []).forEach(function (f) { files[f.abs] = { content: f.content, mode: f.mode }; n += f.content.length; }); else { var t = rd(J.rs, abs); if (t !== null) { files[abs] = { content: t, mode: 420 }; n += t.length; } } });
    if (!keys(files).length) { J.log(s, "##[warning]Path Validation Error: Path(s) specified in the action for caching do(es) not exist, hence no cache is being saved."); J.annotate("warning", "Path Validation Error: Path(s) specified in the action for caching do(es) not exist, hence no cache is being saved."); return false; }
    if (J.r.caches[key]) { J.log(s, "Failed to save: Unable to reserve cache with key " + key + ", another job may be creating this cache."); return false; }
    J.r.caches[key] = { files: files, size: Math.max(1, Math.round(n / 4)), created: now(J.sys) + J.secs + J.run.id % 7, ref: J.run.ref };
    J.log(s, "[command]/usr/bin/tar --posix -cf cache.tzst --exclude cache.tzst -P -C " + J.ws + " --files-from manifest.txt --use-compress-program zstdmt\nCache Size: ~" + Math.max(1, Math.round(J.r.caches[key].size / 1024)) + " MB (" + J.r.caches[key].size * 1024 + " B)\nCache saved successfully\nCache saved with key: " + key);
    return true;
  }
  A.action("actions/setup-node", {
    run: function (J, s, w) {
      var spec = w["node-version"], ver = null;
      if (!spec && w["node-version-file"]) { var t = rd(J.rs, absIn(J, w["node-version-file"])); if (t === null) { J.log(s, "##[error]The specified node version file at: " + absIn(J, w["node-version-file"]) + " does not exist"); J.annotate("error", "The specified node version file at: " + absIn(J, w["node-version-file"]) + " does not exist"); return { code: 1 }; } spec = t.trim().split("\n")[0]; }
      if (!spec) { ver = NODE_DEFAULT; J.log(s, "##[warning]node-version input is not specified. The default Node.js version on the runner (" + NODE_DEFAULT + ") will be used.".replace("##[warning]", "")); }
      else {
        ver = nodeVersion(spec);
        if (!ver) { J.log(s, "Attempting to download " + spec + "...\n##[error]Unable to find Node version '" + spec + "' for platform linux and architecture x64."); J.annotate("error", "Unable to find Node version '" + spec + "' for platform linux and architecture x64."); return { code: 1, secs: 2 }; }
        var major = ver.split(".")[0], dir = "/opt/hostedtoolcache/node/" + ver + "/x64/bin";
        if (ver === NODE_DEFAULT) J.log(s, "Found in cache @ /opt/hostedtoolcache/node/" + ver + "/x64");
        else J.log(s, "Attempting to download " + spec + "...\nAcquiring " + ver + " - x64 from https://github.com/actions/node-versions/releases/download/" + ver + "-1/node-" + ver + "-linux-x64.tar.gz\nExtracting ...\n[command]/usr/bin/tar xz --strip 1 --warning=no-unknown-keyword --overwrite -C /home/runner/work/_temp/node -f /home/runner/work/_temp/node-" + ver + ".tar.gz\nAdding to the cache ...");
        putRunner(J, dir + "/node", "\x7fELF:node " + ver + "\n", 493);
        putRunner(J, dir + "/npm", "\x7fELF:npm (simulated binary)\n", 493);
        putRunner(J, dir + "/npx", "\x7fELF:npx (simulated binary)\n", 493);
        J.pathAdd.push(dir);
        void major;
      }
      J.log(s, "##[group]Environment details\nnode: v" + ver + "\nnpm: " + (NPM[ver.split(".")[0]] || "10.8.2") + "\nyarn: 1.22.22\n##[endgroup]");
      var res = { code: 0, secs: ver === NODE_DEFAULT ? 1 : 4, outputs: { "node-version": "v" + ver } };
      if (w.cache) {
        if (w.cache !== "npm") { J.log(s, "##[error]Caching for '" + w.cache + "' is not supported"); J.annotate("error", "Caching for '" + w.cache + "' is not supported"); return { code: 1 }; }
        var lockFiles = walkFiles(J.rs, J.ws, "", []).filter(function (f) { return /(^|\/)(package-lock\.json|npm-shrinkwrap\.json|yarn\.lock)$/.test(f.rel) && !/node_modules/.test(f.rel); });
        if (!lockFiles.length) { J.log(s, "##[error]Dependencies lock file is not found in " + J.ws + ". Supported file patterns: package-lock.json,npm-shrinkwrap.json,yarn.lock"); J.annotate("error", "Dependencies lock file is not found in " + J.ws + ". Supported file patterns: package-lock.json,npm-shrinkwrap.json,yarn.lock"); return { code: 1 }; }
        var key = "node-cache-Linux-x64-npm-" + J.hashFiles(["**/package-lock.json"]);
        J.log(s, "[command]/opt/hostedtoolcache/node/" + ver + "/x64/bin/npm config get cache\n" + RUNNER_HOME + "/.npm");
        var cr = cacheRestore(J, s, key, [], [RUNNER_HOME + "/.npm"]);
        if (cr.hit) J.log(s, "Cache restored from key: " + key); else J.log(s, "npm cache is not found");
        res.outputs["cache-hit"] = cr.hit ? "true" : "false";
        res.post = function (J2, s2) { J2.log(s2, "Post job cleanup."); if (J2.status !== "success") return { code: 0 }; if (cr.hit) { J2.log(s2, "Cache hit occurred on the primary key " + key + ", not saving cache."); return { code: 0 }; } cacheSave(J2, s2, key, [RUNNER_HOME + "/.npm"]); return { code: 0, secs: 3 }; };
      }
      return res;
    }
  });
  var PY = { "3.8": "3.8.18", "3.9": "3.9.24", "3.10": "3.10.19", "3.11": "3.11.14", "3.12": "3.12.12", "3.13": "3.13.9", "3.14": "3.14.0" };
  A.action("actions/setup-python", {
    run: function (J, s, w) {
      var spec = String(w["python-version"] || "3.12").trim(), m = /^(\d+\.\d+)(?:\.(\d+|x))?$/.exec(spec), ver = m && PY[m[1]] ? (m[2] && /^\d+$/.test(m[2]) ? spec : PY[m[1]]) : null;
      if (!ver) { J.log(s, "##[group]Installed versions\nVersion " + spec + " was not found in the local cache\n##[endgroup]\n##[error]The version '" + spec + "' with architecture 'x64' was not found for Ubuntu 24.04.\nThe list of all available versions can be found here: https://raw.githubusercontent.com/actions/python-versions/main/versions-manifest.json"); J.annotate("error", "The version '" + spec + "' with architecture 'x64' was not found for Ubuntu 24.04."); return { code: 1, secs: 2 }; }
      var dir = "/opt/hostedtoolcache/Python/" + ver + "/x64/bin";
      putRunner(J, dir + "/python", "\x7fELF:python3 " + ver + "\n", 493); putRunner(J, dir + "/python3", "\x7fELF:python3 " + ver + "\n", 493); putRunner(J, dir + "/pip", "\x7fELF:pip (simulated binary)\n", 493);
      J.pathAdd.push(dir);
      J.log(s, "##[group]Installed versions\nSuccessfully set up CPython (" + ver + ")\n##[endgroup]");
      return { code: 0, secs: 2, outputs: { "python-version": ver } };
    }
  });
  A.action("actions/cache", {
    run: function (J, s, w) {
      var key = String(w.key || ""), paths = String(w.path || "").split("\n").map(function (x) { return x.trim(); }).filter(Boolean), rk = String(w["restore-keys"] || "").split("\n").map(function (x) { return x.trim(); }).filter(Boolean);
      if (!key) { J.log(s, "##[error]Input required and not supplied: key"); J.annotate("error", "Input required and not supplied: key"); return { code: 1 }; }
      if (!paths.length) { J.log(s, "##[error]Input required and not supplied: path"); J.annotate("error", "Input required and not supplied: path"); return { code: 1 }; }
      var cr = cacheRestore(J, s, key, rk, paths);
      if (cr.used) J.log(s, "Cache restored from key: " + cr.used); else J.log(s, "Cache not found for input keys: " + [key].concat(rk).join(", "));
      return {
        code: 0, secs: cr.used ? 3 : 1, outputs: { "cache-hit": cr.hit ? "true" : "false", "cache-primary-key": key, "cache-matched-key": cr.used || "" },
        post: function (J2, s2) { J2.log(s2, "Post job cleanup."); if (J2.status !== "success") return { code: 0 }; if (cr.hit) { J2.log(s2, "Cache hit occurred on the primary key " + key + ", not saving cache."); return { code: 0 }; } cacheSave(J2, s2, key, paths); return { code: 0, secs: 3 }; }
      };
    }
  });
  // upload-artifact / download-artifact (v4: artifacts are immutable within a run)
  function collect(J, spec) {
    var ls = String(spec || "").split("\n").map(function (x) { return x.trim(); }).filter(Boolean), inc = ls.filter(function (x) { return x.charAt(0) !== "!"; }), exc = ls.filter(function (x) { return x.charAt(0) === "!"; }).map(function (x) { return absIn(J, x.slice(1)); });
    var found = {}, roots = [];
    inc.forEach(function (p) {
      var abs = absIn(J, p), wild = /[*?\[]/.test(abs);
      if (wild) {
        var segs = abs.split("/"), fixed = [];
        for (var i = 0; i < segs.length && !/[*?\[]/.test(segs[i]); i++) fixed.push(segs[i]);
        var base = fixed.join("/") || "/";
        roots.push(base);
        var re = globRe(abs);
        walkFiles(J.rs, base, "", []).forEach(function (f) { if (re.test(f.abs)) found[f.abs] = f; });
      } else if (isDir(J.rs, abs)) { roots.push(abs); walkFiles(J.rs, abs, "", []).forEach(function (f) { found[f.abs] = f; }); }
      else { var t = rd(J.rs, abs); if (t !== null) { roots.push(abs.slice(0, abs.lastIndexOf("/")) || "/"); found[abs] = { abs: abs, content: t, mode: 420, size: G.nodeAt(J.rs, abs).size }; } }
    });
    keys(found).forEach(function (a) { if (exc.some(function (x) { return globRe(x).test(a) || a.indexOf(x + "/") === 0; })) delete found[a]; });
    var lca = roots.length ? roots.reduce(function (a, b) { var x = a.split("/"), y = b.split("/"), o = []; for (var i = 0; i < x.length && x[i] === y[i]; i++) o.push(x[i]); return o.join("/") || "/"; }) : J.ws;
    var files = {}, sizes = {};
    keys(found).sort().forEach(function (a) { var rel = a.slice(lca === "/" ? 1 : lca.length + 1); files[rel] = found[a].content; if (found[a].size != null) sizes[rel] = found[a].size; });
    Object.defineProperty(files, "__sizes", { value: sizes, enumerable: false });
    return files;
  }
  A.action("actions/upload-artifact", {
    run: function (J, s, w) {
      var name = w.name || "artifact", files = collect(J, w.path), n = keys(files).length, nf = w["if-no-files-found"] || "warn";
      if (!w.path) { J.log(s, "##[error]Input required and not supplied: path"); J.annotate("error", "Input required and not supplied: path"); return { code: 1 }; }
      if (!n) {
        var msg = "No files were found with the provided path: " + w.path + ". No artifacts will be uploaded.";
        if (nf === "error") { J.log(s, "##[error]" + msg); J.annotate("error", msg); return { code: 1 }; }
        if (nf === "warn") { J.log(s, "##[warning]" + msg); J.annotate("warning", msg); } else J.log(s, msg);
        return { code: 0 };
      }
      if (J.run.artifacts.some(function (a) { return a.name === name; })) {
        var em = "Failed to CreateArtifact: Received non-retryable error: Failed request: (409) Conflict: an artifact with this name already exists on the workflow run";
        J.log(s, "With the provided path, there will be " + n + " file" + (n > 1 ? "s" : "") + " uploaded\nArtifact name is valid!\nRoot directory input is valid!\n##[error]" + em); J.annotate("error", em); return { code: 1 };
      }
      var size = keys(files).reduce(function (t, k) { return t + files[k].length; }, 0), id = 4000000000 + hash(J.run.id + ":" + name) % 900000000;
      J.run.artifacts.push({ id: id, name: name, files: files, sizes: files.__sizes || {}, size: size, jobId: J.job.id, created: now(J.sys), retention: +(w["retention-days"] || 90) });
      J.log(s, "With the provided path, there will be " + n + " file" + (n > 1 ? "s" : "") + " uploaded\nArtifact name is valid!\nRoot directory input is valid!\nBeginning upload of artifact content to blob storage\nUploaded bytes " + size + "\nFinished uploading artifact content to blob storage!\nSHA256 digest of uploaded artifact zip is " + M2.sha256(name + size) + "\nFinalizing artifact upload\nArtifact " + name + ".zip successfully finalized. Artifact ID " + id + "\nArtifact " + name + " has been successfully uploaded! Final size is " + size + " bytes. Artifact ID is " + id + "\nArtifact download URL: https://github.com/" + J.r.full + "/actions/runs/" + J.run.id + "/artifacts/" + id);
      return { code: 0, secs: 2, outputs: { "artifact-id": String(id), "artifact-url": "https://github.com/" + J.r.full + "/actions/runs/" + J.run.id + "/artifacts/" + id } };
    }
  });
  A.action("actions/download-artifact", {
    run: function (J, s, w) {
      var dest = w.path ? absIn(J, w.path) : J.ws, arts = J.run.artifacts.slice();
      if (w.name) arts = arts.filter(function (a) { return a.name === w.name; });
      else if (w.pattern) arts = arts.filter(function (a) { return matchList([w.pattern], a.name); });
      if (!arts.length) { var em = w.name ? "Unable to download artifact(s): Artifact not found for name: " + w.name + "\n        Please ensure that your artifact is not expired and the artifact was uploaded using a compatible version of toolkit/upload-artifact.\n        For more information, visit the GitHub Artifacts FAQ: https://github.com/actions/toolkit/blob/main/packages/artifact/docs/faq.md" : "No artifacts found"; J.log(s, "##[error]" + em); J.annotate("error", em.split("\n")[0]); return { code: w.name ? 1 : 0 }; }
      J.log(s, "Found " + arts.length + " artifact(s)\nPreparing to download the following artifacts:\n" + arts.map(function (a) { return "- " + a.name + " (ID: " + a.id + ", Size: " + a.size + ")"; }).join("\n"));
      var merge = String(w["merge-multiple"]) === "true";
      arts.forEach(function (a) {
        var into = w.name || merge ? dest : dest + "/" + a.name;
        J.log(s, "Redirecting to blob download url: https://productionresultssa1.blob.core.windows.net/actions-results/...\nStarting download of artifact to: " + into);
        keys(a.files).forEach(function (rel) { putRunner(J, into + "/" + rel, a.files[rel], 420, (a.sizes || {})[rel]); });
        J.log(s, "Artifact download completed successfully.");
      });
      J.log(s, "Total of " + arts.length + " artifact(s) downloaded\nDownload artifact has finished successfully");
      return { code: 0, secs: 2, outputs: { "download-path": dest } };
    }
  });

  /* ================================================================== runs */
  var USERMAP = { maya: "maya-chen", ben: "ben-okoro", ana: "ana-silva", devp: "dev-patel", dev: "kc-dev" };
  function actorOf(sys, who) { var h = GH.hub(sys); if (h.users[who]) return who; return USERMAP[who] || who || "kc-dev"; }
  function subjectOf(sys, sha) { try { return G.commitOf(sys, sha).message.split("\n")[0]; } catch (e) { return ""; } }
  function nextRunId(h) { h.runSeq = (h.runSeq || 0) + 1; return 9120000000 + h.runSeq * 137 + (h.runSeq * h.runSeq) % 97; }
  function nextJobId(h) { h.jobSeq = (h.jobSeq || 0) + 1; return 25100000000 + h.jobSeq * 211 + h.jobSeq % 7; }
  function done(j) { return j.status === "completed"; }
  function topo(jobs) {
    var out = [], seen = {};
    function v(id) { if (seen[id]) return; seen[id] = 1; list((jobs[id] || {}).needs).forEach(function (n) { if (has(jobs, n)) v(n); }); out.push(id); }
    keys(jobs).forEach(v);
    return out;
  }
  function eqv(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
  function expandMatrix(m) {
    if (!isObj(m)) return { combos: [null] };
    var dims = keys(m).filter(function (k) { return k !== "include" && k !== "exclude"; }), combos = [{}];
    for (var i = 0; i < dims.length; i++) {
      var vals = Array.isArray(m[dims[i]]) ? m[dims[i]] : [m[dims[i]]];
      if (!vals.length) return { error: "Matrix vector '" + dims[i] + "' does not contain any values" };
      var nx = [];
      combos.forEach(function (c) { vals.forEach(function (v) { var o = Object.assign({}, c); o[dims[i]] = v; nx.push(o); }); });
      combos = nx;
    }
    if (!dims.length) combos = [];
    (Array.isArray(m.exclude) ? m.exclude : []).forEach(function (ex) { if (isObj(ex)) combos = combos.filter(function (c) { return !keys(ex).every(function (k) { return eqv(c[k], ex[k]); }); }); });
    var orig = combos.length;
    (Array.isArray(m.include) ? m.include : []).forEach(function (inc) {
      if (!isObj(inc)) return;
      var hit = false;
      combos.slice(0, orig).forEach(function (c) { if (keys(inc).every(function (k) { return dims.indexOf(k) < 0 || eqv(c[k], inc[k]); })) { hit = true; keys(inc).forEach(function (k) { c[k] = inc[k]; }); } });
      if (!hit) combos.push(Object.assign({}, inc));
    });
    if (!combos.length) return { combos: [null] };
    return { combos: combos };
  }
  A.expandMatrix = expandMatrix;
  function needsResult(entries) {
    if (entries.some(function (j) { return j.conclusion === "failure" && !j.continueOnError; })) return "failure";
    if (entries.some(function (j) { return j.conclusion === "cancelled"; })) return "cancelled";
    if (entries.length && entries.every(function (j) { return j.conclusion === "skipped"; })) return "skipped";
    return "success";
  }
  function githubCtx(r, run, extra) {
    var ref = run.ref, isTag = /^refs\/tags\//.test(ref), pm = /^refs\/pull\/(\d+)\/merge$/.exec(ref);
    return Object.assign({
      event_name: run.event, sha: run.sha, ref: ref, ref_name: pm ? pm[1] + "/merge" : ref.replace(/^refs\/(heads|tags)\//, ""), ref_type: isTag ? "tag" : "branch", ref_protected: !!r.protect[ref.replace(/^refs\/heads\//, "")],
      head_ref: run.event.indexOf("pull_request") === 0 ? run.branch : "", base_ref: run.event.indexOf("pull_request") === 0 ? run.baseBranch || "" : "",
      repository: r.full, repository_owner: r.owner, actor: run.actor, triggering_actor: run.actor, run_id: String(run.id), run_number: String(run.number), run_attempt: String(run.attempt),
      workflow: run.wfName, workflow_ref: r.full + "/" + run.wfPath + "@" + ref, server_url: "https://github.com", api_url: "https://api.github.com", graphql_url: "https://api.github.com/graphql",
      workspace: RUNNER_HOME + "/work/" + r.name + "/" + r.name, event: run.payload || {}, retention_days: "90", repositoryUrl: "git://github.com/" + r.full + ".git", secret_source: run.fork ? "None" : "Actions"
    }, extra || {});
  }
  function inputsCtx(run) { return run.inputs || {}; }
  function envFor(r, name) {
    if (!name) return null;
    r.envs = r.envs || {};
    if (!r.envs[name]) r.envs[name] = { name: name, secrets: {}, vars: {}, reviewers: [], branches: null, created: 0 };
    return r.envs[name];
  }
  A.envFor = envFor;
  function secretsFor(r, run, env) {
    if (run.fork) return {};
    var out = {};
    keys(r.secrets).forEach(function (k) { out[k] = r.secrets[k].value; });
    if (env) keys(env.secrets).forEach(function (k) { out[k] = env.secrets[k].value; });
    return out;
  }
  function varsFor(r, env) {
    var out = {};
    keys(r.vars).forEach(function (k) { out[k] = r.vars[k].value; });
    if (env) keys(env.vars).forEach(function (k) { out[k] = env.vars[k].value; });
    return out;
  }
  function createRun(sys, r, wf, o) {
    var h = GH.hub(sys);
    r.wfRuns = r.wfRuns || {};
    r.wfRuns[wf.path] = (r.wfRuns[wf.path] || 0) + 1;
    var run = {
      id: nextRunId(h), number: r.wfRuns[wf.path], attempt: 1, wfPath: wf.path, wfName: wf.errors.length ? wf.path : wf.name, wfFile: wf.file, event: o.event, sha: o.sha, headSha: o.headSha || o.sha,
      ref: o.ref, branch: o.branch, baseBranch: o.baseBranch || "", title: o.title, actor: o.actor, status: "queued", conclusion: null, jobs: [], artifacts: [], annotations: [], inputs: o.inputs || {},
      pr: o.pr || null, payload: o.payload || {}, created: now(sys), fork: !!o.fork, error: null, approvals: {}, debug: !!o.debug, attempts: [], wf: wf, repo: r.full
    };
    r.runs.push(run);
    if (wf.errors.length) {
      run.status = "completed"; run.conclusion = "failure"; run.error = wf.errors;
      run.annotations.push({ level: "error", message: "Invalid workflow file: " + wf.path + "\n" + wf.errors.join("\n"), job: null, file: wf.path });
      run.completedAt = run.created;
      GH.emit(sys, "run.completed", { repo: r, run: run });
      return run;
    }
    if (wf.doc["run-name"]) { try { run.title = interpStr(String(wf.doc["run-name"]), { github: githubCtx(r, run), inputs: inputsCtx(run), vars: varsFor(r, null) }); } catch (e) { if (!(e instanceof ExprError)) throw e; } }
    advance(sys, r, run);
    return run;
  }
  A.createRun = createRun;
  function advance(sys, r, run) {
    if (run._busy) { run._again = true; return; }
    run._busy = true;
    try { do { run._again = false; schedule(sys, r, run); } while (run._again); }
    finally { run._busy = false; }
    var js = run.jobs, wasDone = run.status === "completed";
    if (js.some(function (j) { return j.status === "waiting"; })) run.status = "waiting";
    else if (js.some(function (j) { return j.status === "queued"; })) run.status = "queued";
    else {
      run.status = "completed";
      run.conclusion = js.some(function (j) { return j.conclusion === "failure" && !j.continueOnError; }) ? "failure" : js.some(function (j) { return j.conclusion === "cancelled"; }) ? "cancelled" : "success";
      run.completedAt = run.created + js.reduce(function (m, j) { return Math.max(m, (j.completed || run.created) - run.created); }, 0);
      if (!wasDone) GH.emit(sys, "run.completed", { repo: r, run: run });
    }
  }
  A.advance = advance;
  function schedule(sys, r, run) {
    var doc = run.wf.doc;
    topo(doc.jobs).forEach(function (key) {
      var def = doc.jobs[key], entries = run.jobs.filter(function (j) { return j.key === key; });
      if (entries.length && entries.every(done)) return;
      var needs = list(def.needs), dep = needs.map(function (n) { return run.jobs.filter(function (j) { return j.key === n; }); });
      if (needs.some(function (n, i) { return !dep[i].length || !dep[i].every(done); })) return;
      var needsCtx = {};
      needs.forEach(function (n, i) { var outs = {}; dep[i].forEach(function (j) { Object.assign(outs, j.outputs || {}); }); needsCtx[n] = { result: needsResult(dep[i]), outputs: outs }; });
      var depStatus = needs.some(function (n) { return needsCtx[n].result === "failure"; }) ? "failure" : needs.some(function (n) { return needsCtx[n].result === "cancelled"; }) ? "cancelled" : needs.some(function (n) { return needsCtx[n].result === "skipped"; }) ? "skipped" : "success";
      var base = { github: githubCtx(r, run, { job: key }), vars: varsFor(r, null), secrets: {}, inputs: inputsCtx(run), needs: needsCtx, matrix: {}, strategy: {}, env: {}, __status: function () { return depStatus; } };
      try { base.env = {}; keys(doc.env || {}).forEach(function (k) { base.env[k] = interpStr(doc.env[k] === null ? "" : typeof doc.env[k] === "string" ? doc.env[k] : str(doc.env[k]), base); }); } catch (e) { if (!(e instanceof ExprError)) throw e; }
      if (entries.length) {
        entries.forEach(function (e) { if (e.status === "waiting" && run.approvals[e.envName]) startJob(sys, r, run, e, def, e.ctxBase); });
        return;
      }
      var ok;
      try { ok = evalIf(def["if"], base); } catch (e) { if (!(e instanceof ExprError)) throw e; ok = false; run.annotations.push({ level: "error", message: e.message, job: key }); }
      var plainName; try { plainName = def.name !== undefined ? interpStr(String(def.name), base) : key; } catch (e) { if (!(e instanceof ExprError)) throw e; plainName = key; }
      if (!ok) { run.jobs.push({ id: nextJobId(GH.hub(sys)), key: key, name: plainName, status: "completed", conclusion: "skipped", steps: [], outputs: {}, started: run.created, completed: run.created, secs: 0 }); return; }
      var strat = isObj(def.strategy) ? def.strategy : {}, mx = strat.matrix;
      if (typeof mx === "string") { try { mx = interp(mx, base); } catch (e) { if (!(e instanceof ExprError)) throw e; mx = null; } }
      var ex = expandMatrix(mx);
      if (ex.error) { run.jobs.push({ id: nextJobId(GH.hub(sys)), key: key, name: plainName, status: "completed", conclusion: "failure", steps: [], outputs: {}, started: run.created, completed: run.created, secs: 0 }); run.annotations.push({ level: "error", message: ex.error, job: plainName }); return; }
      var combos = ex.combos, failFast = strat["fail-fast"] !== false && strat["fail-fast"] !== "false";
      var made = combos.map(function (combo, idx) {
        var ctx = Object.assign({}, base, { matrix: combo || {}, strategy: { "fail-fast": failFast, "job-index": idx, "job-total": combos.length, "max-parallel": strat["max-parallel"] || combos.length } });
        var nm;
        try { nm = def.name !== undefined ? interpStr(String(def.name), ctx) : key + (combo && keys(combo).length ? " (" + keys(combo).map(function (k) { return isObj(combo[k]) || Array.isArray(combo[k]) ? JSON.stringify(combo[k]) : str(combo[k]); }).join(", ") + ")" : ""); }
        catch (e) { if (!(e instanceof ExprError)) throw e; nm = key; }
        var envSpec = def.environment, envName = null, envUrl = null;
        try { if (isObj(envSpec)) { envName = interpStr(String(envSpec.name), ctx); envUrl = envSpec.url ? String(envSpec.url) : null; } else if (envSpec) envName = interpStr(String(envSpec), ctx); } catch (e) { if (!(e instanceof ExprError)) throw e; }
        var entry = { id: nextJobId(GH.hub(sys)), key: key, name: nm, matrix: combo, status: "queued", conclusion: null, steps: [], outputs: {}, started: null, envName: envName, envUrl: envUrl, ctxBase: ctx, continueOnError: def["continue-on-error"] === true };
        run.jobs.push(entry);
        return entry;
      });
      made.forEach(function (entry) {
        if (failFast && made.some(function (x) { return x !== entry && x.conclusion === "failure"; }) && !entry.started) {
          var bad = made.filter(function (x) { return x.conclusion === "failure"; })[0];
          entry.status = "completed"; entry.conclusion = "cancelled"; entry.started = run.created; entry.completed = run.created; entry.secs = 0;
          run.annotations.push({ level: "error", message: "The strategy configuration was canceled because \"" + key + "." + bad.name.replace(/^[^(]*\(|\)$/g, "").replace(/, /g, "_") + "\" failed", job: entry.name });
          return;
        }
        var env = envFor(r, entry.envName);
        if (env) {
          var refName = run.ref.replace(/^refs\/(heads|tags)\//, ""), isTag = /^refs\/tags\//.test(run.ref);
          if (env.branches && !(matchList(env.branches, refName) && !/^refs\/pull\//.test(run.ref))) {
            entry.status = "completed"; entry.conclusion = "failure"; entry.started = run.created; entry.completed = run.created; entry.secs = 0;
            run.annotations.push({ level: "error", message: (isTag ? "Tag" : "Branch") + " \"" + (/^refs\/pull\//.test(run.ref) ? run.ref.replace(/^refs\//, "") : refName) + "\" is not allowed to deploy to " + env.name + " due to environment protection rules.", job: entry.name });
            return;
          }
          if (env.reviewers && env.reviewers.length && !run.approvals[env.name]) {
            entry.status = "waiting";
            GH.emit(sys, "deployment.waiting", { repo: r, run: run, env: env, job: entry });
            if (!run.approvals[env.name]) return;
          }
        }
        startJob(sys, r, run, entry, def, entry.ctxBase);
      });
    });
  }
  var LINUX = /^(ubuntu-latest|ubuntu-24\.04|ubuntu-22\.04|ubuntu-24\.04-arm|ubuntu-22\.04-arm)$/;
  function startJob(sys, r, run, entry, def, ctx) {
    var labels;
    try { labels = list(interp(def["runs-on"], ctx)); } catch (e) { if (!(e instanceof ExprError)) throw e; labels = []; }
    if (labels.length === 1 && /^(windows|macos)-/.test(labels[0])) {
      entry.status = "completed"; entry.conclusion = "failure"; entry.started = run.created; entry.completed = run.created; entry.secs = 0;
      run.annotations.push({ level: "error", message: "This lab only simulates Ubuntu runners (runs-on: " + labels[0] + ").", job: entry.name });
      return;
    }
    if (labels.length !== 1 || !LINUX.test(labels[0])) { entry.status = "queued"; entry.waitingFor = labels.join(", "); return; }
    var env = envFor(r, entry.envName);
    var c2 = Object.assign({}, ctx, { secrets: secretsFor(r, run, env), vars: varsFor(r, env) });
    var h = GH.hub(sys), perms = permsFor(r, run.wf.doc.permissions, def.permissions, run.fork);
    h.tokSeq = (h.tokSeq || 0) + 1;
    var token = "gh" + "s_" + M2.hashChars("ghs" + run.id + ":" + entry.id + ":" + h.tokSeq, 36, "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789");
    h.tokens[token] = { login: GH.BOT, scopes: [], note: "GITHUB_TOKEN", fine: false, repos: [r.full], created: now(sys), revoked: false, expires: null, bot: { repo: r.full, perms: perms, run: run.id } };
    c2.secrets.GITHUB_TOKEN = token;
    c2.github = Object.assign({}, c2.github, { token: token, job: entry.key });
    entry.status = "in_progress"; entry.started = run.created + (entry.queuedAfter || 0);
    var J = new Job(sys, r, run, entry, def, run.wf, { t: entry.started, ctx: c2 });
    J.perms = perms; J.token = token;
    J.envJobDef = {};
    keys(def.env || {}).forEach(function (k) { try { J.envJobDef[k] = interpStr(def.env[k] === null ? "" : typeof def.env[k] === "string" ? def.env[k] : str(def.env[k]), Object.assign({}, J.ctx, { env: ctx.env })); } catch (e) { if (!(e instanceof ExprError)) throw e; J.envJobDef[k] = ""; } });
    J.ctx.env = Object.assign({}, ctx.env, J.envJobDef);
    var saved = h._bot;
    h._bot = { repo: r.full, perms: perms };
    try { J.go(); }
    finally { h._bot = saved; h.tokens[token].revoked = true; }
    if (env && entry.conclusion === "success") { r.deployments = r.deployments || []; r.deployments.push({ id: 3000000000 + r.deployments.length * 17 + 1, env: env.name, sha: run.sha, ref: run.ref, run: run.id, job: entry.id, at: now(sys), url: entry.envUrl ? interpStr(entry.envUrl, J.ctx) : "" }); }
    J.rs = null; J.rn = null;
  }
  // A reviewer approves (or rejects) a waiting deployment.
  A.review = function (sys, r, run, envName, by, state, comment) {
    run.reviews = (run.reviews || []).concat([{ env: envName, by: by, state: state, comment: comment || "", at: now(sys) }]);
    if (state === "approved") { run.approvals[envName] = by; advance(sys, r, run); return; }
    run.jobs.forEach(function (j) { if (j.status === "waiting" && j.envName === envName) { j.status = "completed"; j.conclusion = "failure"; j.started = j.completed = now(sys); j.secs = 0; run.annotations.push({ level: "error", message: "Deployment to " + envName + " was rejected by " + by + (comment ? ": " + comment : ""), job: j.name }); } });
    advance(sys, r, run);
  };
  A.rerun = function (sys, r, run, o) {
    o = o || {};
    run.attempts.push({ attempt: run.attempt, jobs: run.jobs, conclusion: run.conclusion, annotations: run.annotations, artifacts: run.artifacts, debug: run.debug });
    run.attempt++; run.debug = !!o.debug; run.status = "queued"; run.conclusion = null; run.annotations = []; run.approvals = {}; run.created = now(sys);
    if (o.failed || o.job) {
      var keep = run.jobs.filter(function (j) { return j.conclusion === "success" && (!o.job || j.key !== o.job.key); }), keepKeys = {};
      // a job re-runs if any of its siblings (same key) re-runs; dependents of re-run jobs re-run too
      run.jobs.forEach(function (j) { keepKeys[j.key] = keepKeys[j.key] === false ? false : keep.indexOf(j) >= 0; });
      var doc = run.wf.doc, changed = true;
      while (changed) { changed = false; keys(keepKeys).forEach(function (k) { if (keepKeys[k] && list((doc.jobs[k] || {}).needs).some(function (n) { return keepKeys[n] === false; })) { keepKeys[k] = false; changed = true; } }); }
      run.jobs = run.jobs.filter(function (j) { return keepKeys[j.key]; });
      run.artifacts = run.artifacts.filter(function (a) { return run.jobs.some(function (j) { return j.id === a.jobId; }); });
    } else { run.jobs = []; run.artifacts = []; }
    advance(sys, r, run);
  };

  /* ---------------- events that start runs */
  function defaultTip(r) { return r.refs["refs/heads/" + r.default]; }
  function wfsActive(r, wfs) { return wfs.filter(function (w) { return !(r.wfDisabled && r.wfDisabled[w.path]); }); }
  function onPush(sys, d) {
    var r = d.repo;
    if (!d.after || !r.settings.actions || d.pusher === GH.BOT || r.forkOf && !r.forkActions) return;
    var ref = d.ref, isTag = /^refs\/tags\//.test(ref), sha = G.peel(sys, d.after), files = null;
    if (!/^refs\/(heads|tags)\//.test(ref)) return;
    wfsActive(r, workflowsAt(sys, sha)).forEach(function (wf) {
      if (!wf.errors.length && !has(wf.on, "push")) return;
      if (wf.errors.length && isTag) return;
      if (!wf.errors.length) {
        var cfg = wf.on.push;
        if (!refFilter(cfg, ref)) return;
        if (!isTag && cfg && (has(cfg, "paths") || has(cfg, "paths-ignore"))) {
          if (!files) { var before = d.before || (defaultTip(r) && defaultTip(r) !== sha ? G.mergeBases(sys, defaultTip(r), sha)[0] : null); files = changedFiles(sys, before, sha); }
          if (!pathFilter(cfg, files)) return;
        }
      }
      createRun(sys, r, wf, { event: "push", sha: sha, ref: ref, branch: ref.replace(/^refs\/(heads|tags)\//, ""), title: subjectOf(sys, sha), actor: actorOf(sys, d.pusher), payload: { ref: ref, before: d.before || G.zero(), after: sha, created: !d.before, forced: !!d.forced, head_commit: { id: sha, message: G.commitOf(sys, sha).message.replace(/\n$/, "") }, pusher: { name: actorOf(sys, d.pusher) }, repository: { full_name: r.full } } });
    });
  }
  function prPayload(sys, r, pr, action, head) {
    return { action: action, number: pr.n, pull_request: { number: pr.n, title: pr.title, body: pr.body, draft: !!pr.draft, merged: pr.state === "merged", user: { login: pr.author }, head: { ref: pr.head, sha: head, repo: { full_name: pr.headRepo, fork: pr.headRepo !== r.full } }, base: { ref: pr.base, sha: r.refs["refs/heads/" + pr.base] || pr.baseSha, repo: { full_name: r.full } }, labels: pr.labels.map(function (l) { return { name: l }; }) }, repository: { full_name: r.full } };
  }
  function onPR(sys, d, action) {
    var r = d.repo, pr = d.pr;
    if (!r.settings.actions) return;
    var head = GH.prHeadSha(sys, r, pr), base = r.refs["refs/heads/" + pr.base] || pr.baseSha;
    if (!head || !base) return;
    var fork = pr.headRepo !== r.full, payload = prPayload(sys, r, pr, action, head), actor = actorOf(sys, d.by || d.pusher || pr.author);
    var mb = G.mergeBases(sys, base, head)[0], mr = G.mergeTrees(sys, G.commitFlat(sys, mb), G.commitFlat(sys, base), G.commitFlat(sys, head), ["base", "head"]), merge = null;
    if (!keys(mr.conflicts).length && action !== "closed") {
      var who = { name: "GitHub", email: "noreply@github.com", time: now(sys), tz: "+0000" };
      merge = G.putObject(sys, { type: "commit", tree: G.writeTree(sys, mr.entries), parents: [base, head], author: who, committer: who, message: "Merge " + head + " into " + base + "\n" });
    }
    var src = action === "closed" ? (pr.mergedSha || base) : merge;
    if (src) wfsActive(r, workflowsAt(sys, src)).forEach(function (wf) {
      if (!wf.errors.length && !has(wf.on, "pull_request")) return;
      if (!wf.errors.length) {
        var cfg = wf.on.pull_request || {}, types = cfg.types ? list(cfg.types) : ["opened", "synchronize", "reopened"];
        if (types.indexOf(action) < 0) return;
        if ((has(cfg, "branches") && !matchList(cfg.branches, pr.base)) || (has(cfg, "branches-ignore") && matchList(cfg["branches-ignore"], pr.base))) return;
        if ((has(cfg, "paths") || has(cfg, "paths-ignore")) && !pathFilter(cfg, GH.prFiles(sys, r, pr))) return;
      } else if (action !== "opened" && action !== "synchronize") return;
      createRun(sys, r, wf, { event: "pull_request", sha: src, headSha: head, ref: action === "closed" ? "refs/heads/" + pr.base : "refs/pull/" + pr.n + "/merge", branch: pr.head, baseBranch: pr.base, title: pr.title, actor: actor, pr: pr.n, fork: fork, payload: payload });
    });
    // pull_request_target: the base branch's workflow, with secrets and a write token, even for forks
    var bt = r.refs["refs/heads/" + pr.base];
    if (bt) wfsActive(r, workflowsAt(sys, bt)).forEach(function (wf) {
      if (wf.errors.length || !has(wf.on, "pull_request_target")) return;
      var cfg = wf.on.pull_request_target || {}, types = cfg.types ? list(cfg.types) : ["opened", "synchronize", "reopened"];
      if (types.indexOf(action) < 0) return;
      if (has(cfg, "branches") && !matchList(cfg.branches, pr.base)) return;
      createRun(sys, r, wf, { event: "pull_request_target", sha: bt, headSha: head, ref: "refs/heads/" + pr.base, branch: pr.head, baseBranch: pr.base, title: pr.title, actor: actor, pr: pr.n, fork: false, payload: payload });
    });
  }
  function onDefault(sys, r, event, action, payload, actor, title) {
    var tip = defaultTip(r);
    if (!r.settings.actions || !tip || actor === GH.BOT) return;
    wfsActive(r, workflowsAt(sys, tip)).forEach(function (wf) {
      if (wf.errors.length || !has(wf.on, event)) return;
      var cfg = wf.on[event] || {}, types = cfg.types ? list(cfg.types) : null;
      if (types && types.indexOf(action) < 0) return;
      createRun(sys, r, wf, { event: event, sha: tip, ref: "refs/heads/" + r.default, branch: r.default, title: title, actor: actor, payload: payload });
    });
  }
  A.onDefault = onDefault;
  // auto-merge: a pull request with auto-merge on merges as soon as nothing blocks it
  function tryAutoMerge(sys, r) {
    r.items.forEach(function (pr) {
      if (pr.type !== "pr" || pr.state !== "open" || !pr.autoMerge || pr._merging) return;
      if (GH.blockers(sys, r, pr).length) return;
      pr._merging = true;
      try {
        GH.mergePR(sys, r, pr, pr.autoMerge.method, pr.autoMerge.by, {});
        pr.mergedBy = pr.autoMerge.by; pr.autoMerged = true;
        if (pr.autoMerge.deleteBranch || r.settings.deleteBranchOnMerge) { var hr = GH.find(sys, pr.headRepo); if (hr && pr.head !== hr.default) delete hr.refs["refs/heads/" + pr.head]; }
      } finally { pr._merging = false; }
    });
  }
  A.tryAutoMerge = tryAutoMerge;
  GH.GLOBAL.push(function (sys, h) {
    h.hooks.push({ event: "push", fn: onPush });
    h.hooks.push({ event: "pr.opened", fn: function (s2, d) { onPR(s2, d, "opened"); } });
    h.hooks.push({ event: "pr.synchronize", fn: function (s2, d) { onPR(s2, d, "synchronize"); } });
    h.hooks.push({ event: "pr.ready", fn: function (s2, d) { onPR(s2, d, "ready_for_review"); } });
    h.hooks.push({ event: "pr.merged", fn: function (s2, d) { onPR(s2, Object.assign({}, d, { by: d.pr.mergedBy }), "closed"); } });
    h.hooks.push({ event: "issue.opened", fn: function (s2, d) { var it = d.issue; onDefault(s2, d.repo, "issues", "opened", { action: "opened", issue: { number: it.n, title: it.title, body: it.body, user: { login: it.author }, labels: it.labels.map(function (l) { return { name: l }; }) }, repository: { full_name: d.repo.full } }, it.author, it.title); } });
    h.hooks.push({ event: "pr.comment", fn: function (s2, d) { onDefault(s2, d.repo, "issue_comment", "created", { action: "created", issue: { number: d.pr.n, title: d.pr.title, body: d.pr.body, pull_request: { url: "https://api.github.com/repos/" + d.repo.full + "/pulls/" + d.pr.n }, user: { login: d.pr.author } }, comment: { body: d.body, user: { login: d.by } }, repository: { full_name: d.repo.full } }, d.by, d.pr.title); } });
    h.hooks.push({ event: "run.completed", fn: function (s2, d) { tryAutoMerge(s2, d.repo); } });
    h.hooks.push({ event: "pr.reviewed", fn: function (s2, d) { tryAutoMerge(s2, d.repo); } });
  });

  /* ---------------- checks on pull requests and commits */
  function checksFor(sys, r, sha) {
    var out = [], seen = {};
    r.runs.slice().sort(function (a, b) { return b.id - a.id; }).forEach(function (run) {
      if (run.headSha !== sha) return;
      if (run.error) { var k0 = run.wfPath + "|invalid"; if (!seen[k0]) { seen[k0] = 1; out.push({ name: run.wfPath, workflow: run.wfPath, event: run.event, status: "completed", conclusion: "failure", secs: 0, run: run, job: null }); } return; }
      run.jobs.forEach(function (j) {
        var k = run.wfName + "|" + j.name + "|" + run.event;
        if (seen[k]) return; seen[k] = 1;
        out.push({ name: j.name, workflow: run.wfName, event: run.event, status: j.status, conclusion: j.conclusion, secs: j.secs || 0, run: run, job: j });
      });
    });
    return out;
  }
  A.checksFor = checksFor;
  GH.prChecks = function (sys, r, pr) { var h = GH.prHeadSha(sys, r, pr); return h ? checksFor(sys, r, h) : []; };
  GH.checkState = function (sys, r, sha, ctx) {
    var c = checksFor(sys, r, sha).filter(function (x) { return x.name === ctx; })[0];
    if (!c) return null;
    if (c.status !== "completed") return "pending";
    return c.conclusion === "success" || c.conclusion === "skipped" || c.conclusion === "neutral" ? "success" : "failure";
  };
  function elapsed(s) { s = Math.round(s || 0); return s < 60 ? s + "s" : Math.floor(s / 60) + "m" + (s % 60) + "s"; }
  A.elapsed = elapsed;
  GH.printChecks = function (c, r, pr, f) {
    var cs = GH.prChecks(c.sys, r, pr);
    if (f && f.required) { var prot = GH.protectionFor(r, pr.base), need = prot && prot.checks ? prot.checks.contexts : []; cs = cs.filter(function (x) { return need.indexOf(x.name) >= 0; }); if (!cs.length) { c.o.err("no required checks reported on the '" + pr.head + "' branch"); return 1; } }
    if (!cs.length) { c.o.err("no checks reported on the '" + pr.head + "' branch"); return 1; }
    var st = function (x) { return x.status !== "completed" ? "pending" : x.conclusion === "success" ? "pass" : x.conclusion === "skipped" ? "skipping" : x.conclusion === "cancelled" ? "cancel" : "fail"; };
    var cnt = { pass: 0, fail: 0, pending: 0, skipping: 0, cancel: 0 };
    cs.forEach(function (x) { cnt[st(x)]++; });
    c.o.line(cnt.fail || cnt.cancel ? "Some checks were not successful" : cnt.pending ? "Some checks are still pending" : "All checks were successful");
    c.o.line(cnt.cancel + " cancelled, " + cnt.fail + " failing, " + cnt.pass + " successful, " + cnt.skipping + " skipped, and " + cnt.pending + " pending checks\n");
    var rows = cs.map(function (x) { return [{ pass: "✓", fail: "X", pending: "*", skipping: "-", cancel: "X" }[st(x)], x.workflow + "/" + x.name + " (" + x.event + ")", x.status === "completed" ? elapsed(x.secs) : "", "https://github.com/" + r.full + "/actions/runs/" + x.run.id + (x.job ? "/job/" + x.job.id : "")]; });
    var w1 = Math.max.apply(null, rows.map(function (x) { return x[1].length; }).concat([4]));
    c.o.line("   " + X.pad("NAME", w1) + "  ELAPSED  URL");
    rows.forEach(function (x) { c.o.line(x[0] + "  " + X.pad(x[1], w1) + "  " + X.pad(x[2], 7) + "  " + x[3]); });
    return cnt.fail || cnt.cancel ? 1 : cnt.pending ? 8 : 0;
  };

  /* ================================================================== gh: run, workflow, secret, variable, cache, release */
  var GHC = GH.ghCommands;
  function F(a, vals, short, multi) { return GH.flags(a, { vals: vals, short: short || {}, multi: multi || [] }); }
  function glyph(status, concl) { if (status !== "completed") return "*"; return { success: "✓", failure: "X", cancelled: "X", skipped: "-", neutral: "-" }[concl] || "-"; }
  function findRun(c, r, id) {
    var run = r.runs.filter(function (x) { return String(x.id) === String(id); })[0];
    if (!run) { c.o.err("HTTP 404: Not Found (https://api.github.com/repos/" + r.full + "/actions/runs/" + id + ")"); return null; }
    return run;
  }
  function findJob(r, id) { var hit = null; r.runs.forEach(function (run) { run.jobs.forEach(function (j) { if (String(j.id) === String(id)) hit = { run: run, job: j }; }); }); return hit; }
  function needId(c, what) { c.o.err(what + " required when not running interactively\n(This terminal can't show gh's picker: pass the ID from gh run list.)"); return 1; }
  function runJson(r, run) {
    return { databaseId: run.id, number: run.number, attempt: run.attempt, status: run.status, conclusion: run.conclusion || "", name: run.wfName, workflowName: run.wfName, displayTitle: run.title, headBranch: run.branch, headSha: run.headSha, event: run.event, createdAt: A.isoAt(run.created).replace(/\.\d+Z$/, "Z"), updatedAt: A.isoAt(run.completedAt || run.created).replace(/\.\d+Z$/, "Z"), url: "https://github.com/" + r.full + "/actions/runs/" + run.id, workflowDatabaseId: wfId(run.wfPath),
      jobs: run.jobs.map(function (j) { return { databaseId: j.id, name: j.name, status: j.status, conclusion: j.conclusion || "", startedAt: A.isoAt(j.started || run.created).replace(/\.\d+Z$/, "Z"), completedAt: A.isoAt(j.completed || run.created).replace(/\.\d+Z$/, "Z"), url: "https://github.com/" + r.full + "/actions/runs/" + run.id + "/job/" + j.id, steps: j.steps.map(function (s) { return { name: s.name, number: s.number, status: s.status, conclusion: s.conclusion || "" }; }) }; }) };
  }
  function printJson(c, data, f) {
    var fields = String(f.json === true ? "" : f.json).split(",").map(function (x) { return x.trim(); }).filter(Boolean);
    function pick(o) { if (!fields.length) return o; var p = {}; fields.forEach(function (k) { p[k] = o[k] === undefined ? null : o[k]; }); return p; }
    var out = Array.isArray(data) ? data.map(pick) : pick(data), text = JSON.stringify(out, null, f.jq ? 0 : 2);
    if (f.jq) return S.CMDS.jq(["jq", "-r", f.jq], { stdin: text + "\n", out: c.io.out, err: c.io.err, pipedIn: true }, c.sess);
    c.o.line(text); return 0;
  }
  function table(c, head, rows) {
    var w = head.map(function (h, i) { return Math.max.apply(null, [h.length].concat(rows.map(function (r0) { return String(r0[i]).length; }))); });
    c.o.line(head.map(function (h, i) { return i === head.length - 1 ? h : X.pad(h, w[i]); }).join("  "));
    rows.forEach(function (r0) { c.o.line(r0.map(function (x, i) { return i === r0.length - 1 ? String(x) : X.pad(String(x), w[i]); }).join("  ")); });
  }
  function wfList(sys, r) {
    var seen = {}, out = [];
    workflowsAt(sys, defaultTip(r)).forEach(function (w) { seen[w.path] = 1; out.push({ path: w.path, name: w.errors.length ? w.path : w.name, file: w.file, wf: w }); });
    r.runs.forEach(function (run) { if (!seen[run.wfPath]) { seen[run.wfPath] = 1; out.push({ path: run.wfPath, name: run.wfName, file: run.wfFile, wf: null }); } });
    return out;
  }
  function wfFind(sys, r, sel) {
    sel = String(sel);
    return wfList(sys, r).filter(function (w) { return w.file === sel || w.path === sel || w.name.toLowerCase() === sel.toLowerCase() || String(wfId(w.path)) === sel; })[0] || null;
  }
  function logLines(run, j, onlyFailed) {
    var out = [];
    j.steps.forEach(function (s) {
      if (onlyFailed && s.conclusion !== "failure") return;
      s.log.forEach(function (l) { out.push(j.name + "\t" + s.name + "\t" + A.isoAt(l.t) + " " + l.text); });
    });
    return out;
  }
  GHC.run = function (c, a) {
    var sub = a[0], f = F(a.slice(1), ["workflow", "w", "branch", "b", "event", "e", "status", "s", "limit", "L", "user", "u", "commit", "c", "json", "jq", "q", "job", "j", "attempt", "a", "name", "n", "dir", "D", "pattern", "p", "R", "repo", "interval", "i"], { w: "workflow", b: "branch", e: "event", s: "status", L: "limit", u: "user", c: "commit", q: "jq", j: "job", a: "attempt", n: "name", D: "dir", p: "pattern", R: "repo", i: "interval", v: "verbose" }, ["name", "pattern"]);
    var login = GH.needAuth(c); if (!login) return 4;
    var r = GH.ghRepo(c, f.repo); if (!r) return 1;
    if (!GH.can(c.sys, r, login, "read")) { c.o.err("HTTP 404: Not Found"); return 1; }
    if (sub === "list" || sub === "ls") {
      var runs = r.runs.slice().sort(function (x, y) { return y.id - x.id; }).filter(function (x) {
        if (f.workflow) { var w = wfFind(c.sys, r, f.workflow); if (!w || w.path !== x.wfPath) return false; }
        if (f.branch && x.branch !== f.branch) return false; if (f.event && x.event !== f.event) return false; if (f.user && x.actor !== f.user) return false; if (f.commit && x.headSha.indexOf(f.commit) !== 0) return false;
        if (f.status && !(x.status === f.status || x.conclusion === f.status || (f.status === "in_progress" && x.status !== "completed"))) return false;
        return true;
      }).slice(0, +(f.limit || 20));
      if (f.workflow && !wfFind(c.sys, r, f.workflow)) { c.o.err("could not find any workflows named " + f.workflow); return 1; }
      if (f.json) return printJson(c, runs.map(function (x) { return runJson(r, x); }), f);
      if (!runs.length) { c.o.err("no runs found"); return 0; }
      table(c, ["STATUS", "TITLE", "WORKFLOW", "BRANCH", "EVENT", "ID", "ELAPSED", "AGE"], runs.map(function (x) { return [glyph(x.status, x.conclusion), x.title.length > 32 ? x.title.slice(0, 31) + "…" : x.title, x.wfName, x.branch, x.event, x.id, x.status === "completed" ? elapsed((x.completedAt || x.created) - x.created) : "", GH.ago(c.sys, x.created)]; }));
      return 0;
    }
    if (sub === "view") {
      var jsel = f.job ? findJob(r, f.job) : null;
      if (f.job && !jsel) { c.o.err("HTTP 404: Not Found (https://api.github.com/repos/" + r.full + "/actions/jobs/" + f.job + ")"); return 1; }
      if (!f._[0] && !jsel) return needId(c, "run or job ID");
      var run = jsel ? jsel.run : findRun(c, r, f._[0]); if (!run) return 1;
      if (f.json) return printJson(c, runJson(r, run), f);
      var jobs = jsel ? [jsel.job] : run.jobs;
      if (f.log || f["log-failed"]) {
        if (run.status !== "completed") { c.o.err("run " + run.id + " is still in progress; logs will be available when it is complete"); return 1; }
        var ls = [];
        jobs.forEach(function (j) { if (f["log-failed"] && j.conclusion !== "failure") return; ls = ls.concat(logLines(run, j, f["log-failed"])); });
        ls.forEach(function (l) { c.o.line(l); });
        return 0;
      }
      c.o.line("");
      c.o.line(glyph(run.status, run.conclusion) + " " + run.branch + " " + run.wfName + " · " + run.id + (run.attempt > 1 ? " (Attempt #" + run.attempt + ")" : ""));
      c.o.line("Triggered via " + run.event + " " + GH.ago(c.sys, run.created));
      if (run.error) {
        c.o.line("\nX This run likely failed because of a workflow file issue.\n");
        c.o.line("ANNOTATIONS");
        run.error.forEach(function (e) { c.o.line("X " + e); });
        c.o.line(".github/workflows/" + run.wfFile + "#" + ((/Line: (\d+)/.exec(run.error[0]) || /on line (\d+)/.exec(run.error[0]) || [0, 1])[1]) + "\n");
        c.o.line("For more information, see: https://github.com/" + r.full + "/actions/runs/" + run.id);
        return f["exit-status"] ? 1 : 0;
      }
      if (run.status === "waiting") { var wj = run.jobs.filter(function (j) { return j.status === "waiting"; })[0]; c.o.line("\n! Waiting for review: " + wj.envName + " needs approval to start deploying changes."); }
      c.o.line("\nJOBS");
      jobs.forEach(function (j) {
        c.o.line(glyph(j.status, j.conclusion) + " " + j.name + (j.status === "completed" && j.conclusion !== "skipped" ? " in " + elapsed(j.secs) : "") + " (ID " + j.id + ")");
        if (j.status === "queued" && j.waitingFor !== undefined) c.o.line("  Waiting for a runner to pick up this job... (no runner has the label: " + (j.waitingFor || "(none)") + ")");
        if (jsel || f.verbose || j.conclusion === "failure") j.steps.forEach(function (s) { c.o.line("  " + glyph(s.status, s.conclusion) + " " + s.name); });
      });
      var an = run.annotations.filter(function (x) { return !jsel || x.jobId === jsel.job.id || x.job === jsel.job.name; });
      if (an.length) {
        c.o.line("\nANNOTATIONS");
        an.forEach(function (x) { c.o.line({ error: "X", warning: "!", notice: "-" }[x.level] + " " + x.message.split("\n")[0] + "\n" + (x.job || run.wfName) + ": " + (x.file || ".github") + (x.line ? "#" + x.line : "") + "\n"); });
      }
      if (run.artifacts.length && !jsel) { c.o.line("\nARTIFACTS"); run.artifacts.forEach(function (x) { c.o.line(x.name); }); }
      var sumJobs = jobs.filter(function (j) { return j.summary; });
      if (sumJobs.length) { c.o.line("\nSUMMARY"); sumJobs.forEach(function (j) { c.o.line(j.summary.replace(/\n$/, "")); }); }
      c.o.line("");
      if (run.conclusion === "failure") c.o.line("To see what failed, try: gh run view " + run.id + " --log-failed");
      else if (!jsel) c.o.line("For more information about a job, try: gh run view --job=<job-id>");
      c.o.line("View this run on GitHub: https://github.com/" + r.full + "/actions/runs/" + run.id + (jsel ? "/job/" + jsel.job.id : ""));
      return f["exit-status"] && run.status === "completed" && run.conclusion !== "success" ? 1 : 0;
    }
    if (sub === "watch") {
      if (!f._[0]) return needId(c, "run ID");
      var rw = findRun(c, r, f._[0]); if (!rw) return 1;
      if (rw.status === "completed") { c.o.line("Run " + rw.wfName + " (" + rw.id + ") has already completed with '" + rw.conclusion + "'"); return f["exit-status"] && rw.conclusion !== "success" ? 1 : 0; }
      var stuck = rw.jobs.filter(function (j) { return j.status !== "completed"; })[0];
      c.o.line("Refreshing run status every 3 seconds. Press Ctrl+C to quit.\n\n* " + rw.branch + " " + rw.wfName + " · " + rw.id + "\nTriggered via " + rw.event + " " + GH.ago(c.sys, rw.created) + "\n\nJOBS");
      rw.jobs.forEach(function (j) { c.o.line(glyph(j.status, j.conclusion) + " " + j.name + " (ID " + j.id + ")"); });
      c.o.err("(This run isn't going to move by itself: " + (stuck && stuck.status === "waiting" ? "the " + stuck.envName + " environment is waiting for a reviewer to approve." : "the job " + (stuck ? stuck.name : "") + " is waiting for a runner with the label " + (stuck && stuck.waitingFor ? stuck.waitingFor : "it asked for") + ".") + " ^C)");
      return 130;
    }
    if (sub === "rerun") {
      var jr = f.job ? findJob(r, f.job) : null;
      if (f.job && !jr) { c.o.err("HTTP 404: Not Found (https://api.github.com/repos/" + r.full + "/actions/jobs/" + f.job + ")"); return 1; }
      if (!f._[0] && !jr) return needId(c, "run or job ID");
      var rr = jr ? jr.run : findRun(c, r, f._[0]); if (!rr) return 1;
      if (!GH.can(c.sys, r, login, "write") || GH.botDenied(c, r, "actions")) { if (GH.ghLogin(c) !== GH.BOT) c.o.err("HTTP 403: Must have admin rights to Repository."); return 1; }
      if (rr.status !== "completed") { c.o.err("run " + rr.id + " cannot be rerun; This workflow is already running"); return 1; }
      if (rr.error) { c.o.err("run " + rr.id + " cannot be rerun; This workflow run cannot be retried: its workflow file is invalid. Fix the file and push a new commit."); return 1; }
      if (f.failed && !rr.jobs.some(function (j) { return j.conclusion === "failure" || j.conclusion === "cancelled"; })) { c.o.err("run " + rr.id + " cannot be rerun; This workflow run cannot be retried"); return 1; }
      A.rerun(c.sys, r, rr, { failed: !!f.failed, debug: !!f.debug, job: jr ? jr.job : null });
      c.o.line("✓ Requested rerun " + (jr ? "of job " + jr.job.id + " on run " + rr.id : (f.failed ? "(failed jobs) " : "") + "of run " + rr.id) + (f.debug ? " with debug logging enabled" : ""));
      return 0;
    }
    if (sub === "download") {
      var rd2 = f._[0] ? findRun(c, r, f._[0]) : r.runs.slice().reverse().filter(function (x) { return x.artifacts.length; })[0];
      if (f._[0] && !rd2) return 1;
      if (!rd2) { c.o.err("no valid artifacts found to download"); return 1; }
      var names = [].concat(f.name || []), pats = [].concat(f.pattern || []);
      var arts = rd2.artifacts.filter(function (x) { return (!names.length && !pats.length) || names.indexOf(x.name) >= 0 || pats.some(function (p) { return matchList([p], x.name); }); });
      if (!arts.length) { c.o.err("no artifact matches any of the names or patterns provided"); return 1; }
      var dir = S.normAbs(f.dir ? (f.dir.charAt(0) === "/" ? f.dir : c.sess.cwd + "/" + f.dir.replace(/^~(?=\/|$)/, c.sess.home)) : c.sess.cwd);
      if (f.dir && /^~/.test(f.dir)) dir = S.normAbs(f.dir.replace(/^~/, c.sess.home));
      var single = names.length === 1 && arts.length === 1 && !pats.length;
      arts.forEach(function (x) { keys(x.files).forEach(function (rel) { var p = single ? dir + "/" + rel : dir + "/" + x.name + "/" + rel; putSized(c.sys, p, x.files[rel], 436, c.sess.uid, c.sess.gid, (x.sizes || {})[rel]); }); });
      return 0;
    }
    if (sub === "cancel") {
      if (!f._[0]) return needId(c, "run ID");
      var rc = findRun(c, r, f._[0]); if (!rc) return 1;
      if (rc.status === "completed") { c.o.err("Cannot cancel a workflow run that is completed. (HTTP 409)"); return 1; }
      rc.jobs.forEach(function (j) { if (j.status !== "completed") { j.status = "completed"; j.conclusion = "cancelled"; j.started = j.started || rc.created; j.completed = now(c.sys); j.secs = 0; } });
      A.advance(c.sys, r, rc);
      c.o.line("✓ Request to cancel workflow " + rc.id + " submitted.");
      return 0;
    }
    if (sub === "delete") {
      if (!f._[0]) return needId(c, "run ID");
      var rx = findRun(c, r, f._[0]); if (!rx) return 1;
      r.runs.splice(r.runs.indexOf(rx), 1);
      c.o.line("✓ Request to delete workflow run " + rx.id + " submitted.");
      return 0;
    }
    c.o.err("Usage:  gh run <command> [flags]\n\nAvailable commands:\n  cancel\n  delete\n  download\n  list\n  rerun\n  view\n  watch"); return 1;
  };
  GHC.workflow = function (c, a) {
    var sub = a[0], f = F(a.slice(1), ["ref", "r", "raw-field", "f", "field", "F", "json", "jq", "q", "R", "repo", "limit", "L"], { r: "ref", f: "raw-field", F: "field", q: "jq", R: "repo", L: "limit", y: "yaml", a: "all" }, ["raw-field", "field"]);
    var login = GH.needAuth(c); if (!login) return 4;
    var r = GH.ghRepo(c, f.repo); if (!r) return 1;
    if (sub === "list" || sub === "ls") {
      var ws = wfList(c.sys, r).filter(function (w) { return f.all || !(r.wfDisabled && r.wfDisabled[w.path]); });
      if (!ws.length) { c.o.err("no workflows found"); return 0; }
      table(c, ["NAME", "STATE", "ID"], ws.map(function (w) { return [w.name, r.wfDisabled && r.wfDisabled[w.path] ? "disabled_manually" : "active", wfId(w.path)]; }));
      return 0;
    }
    if (!f._[0]) { c.o.err("workflow ID, name, or filename required when not running interactively"); return 1; }
    var w = wfFind(c.sys, r, f._[0]);
    if (!w) { c.o.err("could not find any workflows named " + f._[0]); return 1; }
    if (sub === "view") {
      var ref = f.ref || r.default, tip = r.refs["refs/heads/" + ref] || r.refs["refs/tags/" + ref];
      c.o.line(w.name + " - " + w.file + "\nID: " + wfId(w.path) + "\n");
      if (f.yaml) { var flat = tip ? G.commitFlat(c.sys, tip) : {}; if (!flat[w.path]) { c.o.err("could not find workflow file " + w.path + " on " + ref); return 1; } c.o.line(G.blobText(c.sys, flat[w.path].sha).replace(/\n$/, "")); return 0; }
      var runs = r.runs.filter(function (x) { return x.wfPath === w.path; }).sort(function (x, y) { return y.id - x.id; });
      c.o.line("Total runs " + runs.length);
      if (runs.length) { c.o.line("Recent runs"); table(c, ["  ", "TITLE", "WORKFLOW", "BRANCH", "EVENT", "ID"], runs.slice(0, 5).map(function (x) { return [glyph(x.status, x.conclusion), x.title, x.wfName, x.branch, x.event, x.id]; })); }
      c.o.line("\nTo see more runs for this workflow, try: gh run list --workflow " + w.file + "\nTo see the YAML for this workflow, try: gh workflow view " + w.file + " --yaml");
      return 0;
    }
    if (sub === "disable" || sub === "enable") {
      if (!GH.can(c.sys, r, login, "write")) { c.o.err("HTTP 403: Must have admin rights to Repository."); return 1; }
      r.wfDisabled = r.wfDisabled || {};
      if (sub === "disable") r.wfDisabled[w.path] = true; else delete r.wfDisabled[w.path];
      c.o.line("✓ " + (sub === "disable" ? "Disabled " : "Enabled ") + w.name);
      return 0;
    }
    if (sub === "run") {
      var api = "(https://api.github.com/repos/" + r.full + "/actions/workflows/" + wfId(w.path) + "/dispatches)";
      if (!GH.can(c.sys, r, login, "write") || GH.botDenied(c, r, "actions")) { if (GH.ghLogin(c) !== GH.BOT) c.o.err("could not create workflow dispatch event: HTTP 403: Must have admin rights to Repository. " + api); return 1; }
      if (r.wfDisabled && r.wfDisabled[w.path]) { c.o.err("could not create workflow dispatch event: HTTP 422: Workflow is disabled " + api); return 1; }
      var ref2 = f.ref || r.default, tip2 = r.refs["refs/heads/" + ref2] || r.refs["refs/tags/" + ref2];
      if (!tip2) { c.o.err("could not create workflow dispatch event: HTTP 422: No ref found for: " + ref2 + " " + api); return 1; }
      var wf = workflowsAt(c.sys, tip2).filter(function (x) { return x.path === w.path; })[0];
      if (!wf) { c.o.err("could not create workflow dispatch event: HTTP 404: Not Found " + api); return 1; }
      if (wf.errors.length) { c.o.err("could not create workflow dispatch event: HTTP 422: Invalid workflow file: " + wf.errors[0] + " " + api); return 1; }
      if (!has(wf.on, "workflow_dispatch")) { c.o.err("could not create workflow dispatch event: HTTP 422: Workflow does not have 'workflow_dispatch' trigger " + api); return 1; }
      var defs = (wf.on.workflow_dispatch && wf.on.workflow_dispatch.inputs) || {}, given = {}, bad = [];
      [].concat(f["raw-field"] || [], f.field || []).forEach(function (kv) { var i = kv.indexOf("="); if (i < 0) { bad.push(kv); return; } given[kv.slice(0, i)] = kv.slice(i + 1); });
      var unexpected = keys(given).filter(function (k) { return !has(defs, k); });
      if (unexpected.length) { c.o.err("could not create workflow dispatch event: HTTP 422: Unexpected inputs provided: " + JSON.stringify(unexpected) + " " + api); return 1; }
      var inputs = {}, ev = {};
      for (var k in defs) {
        if (!has(defs, k)) continue;
        var d = defs[k] || {}, v = has(given, k) ? given[k] : d["default"] !== undefined && d["default"] !== null ? str(d["default"]) : undefined, ty = d.type || "string";
        if (v === undefined) { if (d.required === true) { c.o.err("could not create workflow dispatch event: HTTP 422: Required input '" + k + "' not provided " + api); return 1; } v = ty === "boolean" ? "false" : ""; }
        if (ty === "boolean" && !/^(true|false)$/.test(v)) { c.o.err("could not create workflow dispatch event: HTTP 422: Provided value '" + v + "' for input '" + k + "' is not a valid boolean " + api); return 1; }
        if (ty === "choice" && list(d.options).indexOf(v) < 0) { c.o.err("could not create workflow dispatch event: HTTP 422: Provided value '" + v + "' for input '" + k + "' not in the list of allowed values " + api); return 1; }
        if (ty === "number" && v !== "" && isNaN(Number(v))) { c.o.err("could not create workflow dispatch event: HTTP 422: Provided value '" + v + "' for input '" + k + "' is not a valid number " + api); return 1; }
        ev[k] = v; inputs[k] = ty === "boolean" ? v === "true" : ty === "number" && v !== "" ? Number(v) : v;
      }
      createRun(c.sys, r, wf, { event: "workflow_dispatch", sha: tip2, ref: r.refs["refs/heads/" + ref2] ? "refs/heads/" + ref2 : "refs/tags/" + ref2, branch: ref2, title: wf.name, actor: GH.ghLogin(c), inputs: inputs, payload: { inputs: ev, ref: "refs/heads/" + ref2, repository: { full_name: r.full } } });
      c.o.line("✓ Created workflow_dispatch event for " + w.file + " at " + ref2 + "\n\nTo see runs for this workflow, try: gh run list --workflow=\"" + w.file + "\"");
      return 0;
    }
    c.o.err("Usage:  gh workflow <command> [flags]\n\nAvailable commands:\n  disable\n  enable\n  list\n  run\n  view"); return 1;
  };
  var SECRET_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
  function store(c, r, f, kind) {
    if (f.env) { var e = r.envs && r.envs[f.env]; if (!e) { c.o.err("HTTP 404: Not Found (https://api.github.com/repos/" + r.full + "/environments/" + f.env + ")"); return null; } return { bag: e[kind], where: " for " + r.full + " environment " + f.env }; }
    if (f.org) { c.o.err("(Organization-level " + kind + " aren't simulated in this lab: use the repository or an environment.)"); return null; }
    return { bag: r[kind], where: " for " + r.full };
  }
  function readValue(c, f) {
    if (f.body !== undefined) return String(f.body);
    if (c.io.stdin !== null && c.io.stdin !== undefined && c.io.stdin !== "") return String(c.io.stdin).replace(/\r?\n$/, "");
    return null;
  }
  GHC.secret = function (c, a) {
    var sub = a[0], f = F(a.slice(1), ["body", "b", "env", "e", "org", "o", "R", "repo", "env-file", "f", "app", "a", "visibility", "v", "json", "jq", "q"], { b: "body", e: "env", o: "org", R: "repo", f: "env-file", a: "app", v: "visibility", q: "jq" });
    var login = GH.needAuth(c); if (!login) return 4;
    var r = GH.ghRepo(c, f.repo); if (!r) return 1;
    var path = "https://api.github.com/repos/" + r.full + (f.env ? "/environments/" + f.env : "") + "/actions/secrets";
    if (GH.role(c.sys, r, login) !== "admin") { c.o.err((sub === "set" ? "failed to fetch public key: " : "failed to get secrets: ") + "HTTP 403: Resource not accessible by " + (GH.ghLogin(c) === GH.BOT ? "integration" : "personal access token") + " (" + path + (sub === "set" ? "/public-key" : "") + ")"); return 1; }
    var st = store(c, r, f, "secrets"); if (!st) return 1;
    if (sub === "set") {
      var name = f._[0];
      if (!name) { c.o.err("must pass name argument"); return 1; }
      if (!SECRET_NAME.test(name)) { c.o.err("HTTP 422: Secret names can only contain alphanumeric characters ([a-z], [A-Z], [0-9]) or underscores (_). Spaces are not allowed. Must start with a letter ([a-z], [A-Z]) or underscores (_)."); return 1; }
      if (/^GITHUB_/i.test(name)) { c.o.err("HTTP 422: Secret names must not start with GITHUB_."); return 1; }
      var v = readValue(c, f);
      if (v === null) { c.o.err("(This terminal can't show gh's hidden prompt: give the value with --body VALUE or < FILE.)"); return 1; }
      name = name.toUpperCase();
      st.bag[name] = { value: v, updated: now(c.sys) };
      GH.audit(c.sys, login, "repo.create_actions_secret", { repo: r.full, secret: name, env: f.env || null });
      c.o.line("✓ Set Actions secret " + name + st.where);
      return 0;
    }
    if (sub === "list" || sub === "ls") {
      var ks = keys(st.bag).sort();
      if (f.json) return printJson(c, ks.map(function (k) { return { name: k, updatedAt: A.isoAt(st.bag[k].updated).replace(/\.\d+Z$/, "Z") }; }), f);
      if (!ks.length) { c.o.err("no secrets found"); return 0; }
      table(c, ["NAME", "UPDATED"], ks.map(function (k) { return [k, GH.ago(c.sys, st.bag[k].updated)]; }));
      return 0;
    }
    if (sub === "delete" || sub === "remove") {
      var n2 = String(f._[0] || "").toUpperCase();
      if (!st.bag[n2]) { c.o.err("failed to delete secret " + n2 + ": HTTP 404: Not Found (" + path + "/" + n2 + ")"); return 1; }
      delete st.bag[n2];
      GH.audit(c.sys, login, "repo.remove_actions_secret", { repo: r.full, secret: n2, env: f.env || null });
      c.o.line("✓ Deleted Actions secret " + n2 + " from " + r.full + (f.env ? " environment " + f.env : ""));
      return 0;
    }
    c.o.err("Usage:  gh secret <command> [flags]\n\nAvailable commands:\n  delete\n  list\n  set"); return 1;
  };
  GHC.variable = function (c, a) {
    var sub = a[0], f = F(a.slice(1), ["body", "b", "env", "e", "org", "o", "R", "repo", "json", "jq", "q"], { b: "body", e: "env", o: "org", R: "repo", q: "jq" });
    var login = GH.needAuth(c); if (!login) return 4;
    var r = GH.ghRepo(c, f.repo); if (!r) return 1;
    if (sub !== "get" && sub !== "list" && sub !== "ls" && GH.role(c.sys, r, login) !== "admin") { c.o.err("HTTP 403: Must have admin rights to Repository. (https://api.github.com/repos/" + r.full + "/actions/variables)"); return 1; }
    var st = store(c, r, f, "vars"); if (!st) return 1;
    var name = String(f._[0] || "").toUpperCase();
    if (sub === "set") {
      if (!name) { c.o.err("must pass name argument"); return 1; }
      if (!SECRET_NAME.test(name) || /^GITHUB_/.test(name)) { c.o.err("HTTP 422: Variable names can only contain alphanumeric characters or underscores, must start with a letter or underscore, and must not start with GITHUB_."); return 1; }
      var v = readValue(c, f); if (v === null) { c.o.err("(This terminal can't prompt: give the value with --body VALUE.)"); return 1; }
      var existed = !!st.bag[name];
      st.bag[name] = { value: v, updated: now(c.sys) };
      c.o.line("✓ " + (existed ? "Updated" : "Created") + " variable " + name + st.where);
      return 0;
    }
    if (sub === "get") { if (!st.bag[name]) { c.o.err("variable " + name + " was not found"); return 1; } c.o.line(st.bag[name].value); return 0; }
    if (sub === "list" || sub === "ls") {
      var ks = keys(st.bag).sort();
      if (!ks.length) { c.o.err("no variables found"); return 0; }
      table(c, ["NAME", "VALUE", "UPDATED"], ks.map(function (k) { return [k, st.bag[k].value, GH.ago(c.sys, st.bag[k].updated)]; }));
      return 0;
    }
    if (sub === "delete" || sub === "remove") { if (!st.bag[name]) { c.o.err("HTTP 404: Not Found"); return 1; } delete st.bag[name]; c.o.line("✓ Deleted variable " + name + " from " + r.full); return 0; }
    c.o.err("Usage:  gh variable <command> [flags]\n\nAvailable commands:\n  delete\n  get\n  list\n  set"); return 1;
  };
  GHC.cache = function (c, a) {
    var sub = a[0], f = F(a.slice(1), ["R", "repo", "key", "k", "limit", "L", "json", "jq", "q"], { R: "repo", k: "key", L: "limit", q: "jq" });
    var login = GH.needAuth(c); if (!login) return 4;
    var r = GH.ghRepo(c, f.repo); if (!r) return 1;
    var ks = keys(r.caches).sort(function (x, y) { return r.caches[y].created - r.caches[x].created; });
    if (sub === "list" || sub === "ls") {
      if (f.key) ks = ks.filter(function (k) { return k.indexOf(f.key) === 0; });
      if (!ks.length) { c.o.err("No caches found in " + r.full); return 0; }
      c.o.line("\nShowing " + ks.length + " of " + ks.length + " caches in " + r.full + "\n");
      table(c, ["ID", "KEY", "SIZE", "CREATED", "ACCESSED"], ks.map(function (k, i) { return [1000 + i, k, (r.caches[k].size / 1024).toFixed(2) + " MiB", GH.ago(c.sys, r.caches[k].created), GH.ago(c.sys, r.caches[k].lastUsed || r.caches[k].created)]; }));
      return 0;
    }
    if (sub === "delete") {
      if (!GH.can(c.sys, r, login, "write")) { c.o.err("HTTP 403: Resource not accessible"); return 1; }
      if (f.all || f._[0] === "--all") { var n = ks.length; r.caches = {}; c.o.line("✓ Deleted " + n + " caches from " + r.full); return 0; }
      if (!r.caches[f._[0]]) { c.o.err("X Could not find a cache matching " + f._[0] + " in " + r.full); return 1; }
      delete r.caches[f._[0]]; c.o.line("✓ Deleted 1 cache from " + r.full); return 0;
    }
    c.o.err("Usage:  gh cache <command> [flags]\n\nAvailable commands:\n  delete\n  list"); return 1;
  };
  // releases
  function relFind(r, tag) { return (r.releases || []).filter(function (x) { return x.tag === tag; })[0] || null; }
  function relLatest(r) { return (r.releases || []).filter(function (x) { return !x.draft && !x.prerelease; }).sort(function (x, y) { return y.created - x.created || y.seq - x.seq; })[0] || null; }
  A.relLatest = relLatest;
  function semverKey(t) { var m = /^v?(\d+)\.(\d+)\.(\d+)/.exec(t); return m ? +m[1] * 1e6 + +m[2] * 1e3 + +m[3] : -1; }
  function genNotes(sys, r, tag, sha, prevTag) {
    var prev = prevTag || keys(r.refs).filter(function (k) { return /^refs\/tags\//.test(k) && k.slice(10) !== tag && semverKey(k.slice(10)) >= 0 && semverKey(k.slice(10)) < semverKey(tag); }).map(function (k) { return k.slice(10); }).sort(function (x, y) { return semverKey(y) - semverKey(x); })[0];
    var have = prev ? G.ancestors(sys, G.peel(sys, r.refs["refs/tags/" + prev])) : {}, mine = G.ancestors(sys, sha);
    var prs = r.items.filter(function (x) { return x.type === "pr" && x.state === "merged" && x.mergedSha && mine[x.mergedSha] && !have[x.mergedSha]; }).sort(function (x, y) { return x.n - y.n; });
    var out = prs.length ? "## What's Changed\n" + prs.map(function (p) { return "* " + p.title + " by @" + p.author + " in https://github.com/" + r.full + "/pull/" + p.n; }).join("\n") + "\n\n\n" : "";
    out += "**Full Changelog**: https://github.com/" + r.full + (prev ? "/compare/" + prev + "..." + tag : "/commits/" + tag);
    return out;
  }
  A.genNotes = genNotes;
  function emitRelease(sys, r, rel, actor) {
    if (actor === GH.BOT || !r.settings.actions) return;
    var sha = G.peel(sys, r.refs["refs/tags/" + rel.tag]);
    wfsActive(r, workflowsAt(sys, sha)).forEach(function (wf) {
      if (wf.errors.length || !has(wf.on, "release")) return;
      var cfg = wf.on.release || {}, types = cfg.types ? list(cfg.types) : ["published"];
      if (types.indexOf("published") < 0 && types.indexOf("released") < 0 && types.indexOf("created") < 0) return;
      createRun(sys, r, wf, { event: "release", sha: sha, ref: "refs/tags/" + rel.tag, branch: rel.tag, title: rel.name, actor: actor, payload: { action: "published", release: { tag_name: rel.tag, name: rel.name, body: rel.body, draft: rel.draft, prerelease: rel.prerelease, author: { login: rel.author } }, repository: { full_name: r.full } } });
    });
  }
  function nodeSize(c, p) { var lk = S.lookup(c.sess, p); return lk.node ? lk.node.size : undefined; }
  function readLocal(c, p) { var rf = S.readFile(c.sess, p); return rf.error ? null : rf.content; }
  GHC.release = function (c, a) {
    var sub = a[0], f = F(a.slice(1), ["title", "t", "notes", "n", "notes-file", "F", "target", "R", "repo", "pattern", "p", "dir", "D", "archive", "A", "notes-start-tag", "json", "jq", "q", "limit", "L"], { t: "title", n: "notes", F: "notes-file", R: "repo", p: "pattern", D: "dir", A: "archive", q: "jq", L: "limit", d: "draft", y: "yes" }, ["pattern"]);
    var login = GH.needAuth(c); if (!login) return 4;
    var r = GH.ghRepo(c, f.repo); if (!r) return 1;
    r.releases = r.releases || [];
    var api = "https://api.github.com/repos/" + r.full + "/releases";
    if (sub === "create" || sub === "new") {
      var tag = f._[0];
      if (!tag) { c.o.err("could not create: no tag name provided"); return 1; }
      if (GH.botDenied(c, r, "contents")) return 1;
      if (!GH.can(c.sys, r, login, "write")) { c.o.err("HTTP 403: Resource not accessible by personal access token (" + api + ")"); return 1; }
      if (relFind(r, tag)) { c.o.err("HTTP 422: Validation Failed (" + api + ")\nRelease.tag_name already exists"); return 1; }
      var assets = [];
      for (var i = 1; i < f._.length; i++) { var p = f._[i].split("#")[0], t0 = readLocal(c, p); if (t0 === null) { c.o.err("open " + p + ": no such file or directory"); return 1; } assets.push({ name: p.split("/").pop(), content: t0, nsize: nodeSize(c, p), size: nodeSize(c, p) != null ? nodeSize(c, p) : t0.length, label: f._[i].split("#")[1] || "", downloads: 0 }); }
      var created = false, sha = r.refs["refs/tags/" + tag];
      if (!sha) {
        if (f["verify-tag"]) { c.o.err("tag " + tag + " doesn't exist in the repo " + r.full + ", aborting due to --verify-tag flag"); return 1; }
        var tgt = f.target || r.default; sha = r.refs["refs/heads/" + tgt] || (/^[0-9a-f]{7,40}$/.test(tgt) ? keys(c.sys.gitObjects).filter(function (k) { return k.indexOf(tgt) === 0; })[0] : null);
        if (!sha) { c.o.err("HTTP 422: Validation Failed (" + api + ")\nRelease.target_commitish is invalid"); return 1; }
        r.refs["refs/tags/" + tag] = sha; created = true;
      }
      var notes = f.notes !== undefined ? String(f.notes) : "";
      if (f["notes-file"]) { var nt = f["notes-file"] === "-" ? String(c.io.stdin || "") : readLocal(c, f["notes-file"]); if (nt === null) { c.o.err("open " + f["notes-file"] + ": no such file or directory"); return 1; } notes = nt; }
      if (f["generate-notes"]) notes = (notes ? notes + "\n\n" : "") + genNotes(c.sys, r, tag, G.peel(c.sys, sha), f["notes-start-tag"]);
      r.relSeq = (r.relSeq || 0) + 1;
      var rel = { tag: tag, name: f.title || tag, body: notes, draft: !!f.draft, prerelease: !!f.prerelease, author: GH.ghLogin(c), created: now(c.sys), assets: assets, sha: G.peel(c.sys, sha), seq: r.relSeq, id: 180000000 + r.relSeq * 101 };
      r.releases.push(rel);
      GH.audit(c.sys, GH.ghLogin(c), "release.published", { repo: r.full, tag: tag });
      if (created) GH.emit(c.sys, "push", { repo: r, ref: "refs/tags/" + tag, before: null, after: sha, pusher: GH.ghLogin(c), viaRelease: true });
      if (!rel.draft) emitRelease(c.sys, r, rel, GH.ghLogin(c));
      c.o.line("https://github.com/" + r.full + "/releases/" + (rel.draft ? "tag/untagged-" + G.abbrev(M2.sha256(tag), 20) : "tag/" + tag));
      return 0;
    }
    if (sub === "list" || sub === "ls") {
      var rels = r.releases.slice().sort(function (x, y) { return y.created - x.created || y.seq - x.seq; }).slice(0, +(f.limit || 30)), lat = relLatest(r);
      if (f.json) return printJson(c, rels.map(function (x) { return { name: x.name, tagName: x.tag, isDraft: x.draft, isPrerelease: x.prerelease, isLatest: x === lat, publishedAt: A.isoAt(x.created).replace(/\.\d+Z$/, "Z") }; }), f);
      if (!rels.length) { c.o.err("no releases found"); return 0; }
      table(c, ["TITLE", "TYPE", "TAG NAME", "PUBLISHED"], rels.map(function (x) { return [x.name, x.draft ? "Draft" : x.prerelease ? "Pre-release" : x === lat ? "Latest" : "", x.tag, x.draft ? "about 1 minute ago" : GH.ago(c.sys, x.created)]; }));
      return 0;
    }
    var rel2 = f._[0] ? relFind(r, f._[0]) : relLatest(r);
    if (!rel2) { c.o.err(f._[0] ? "release not found" : "HTTP 404: Not Found (" + api + "/latest)"); return 1; }
    if (sub === "view") {
      if (f.json) return printJson(c, { name: rel2.name, tagName: rel2.tag, body: rel2.body, isDraft: rel2.draft, isPrerelease: rel2.prerelease, author: { login: rel2.author }, assets: rel2.assets.map(function (x) { return { name: x.name, size: x.size, downloadCount: x.downloads }; }), url: "https://github.com/" + r.full + "/releases/tag/" + rel2.tag }, f);
      c.o.line(rel2.name + (rel2.draft ? " (Draft)" : rel2.prerelease ? " (Pre-release)" : "") + "\n" + rel2.author + " released this " + GH.ago(c.sys, rel2.created) + "\n\n  " + (rel2.body || "").replace(/\n/g, "\n  ") + "\n");
      if (rel2.assets.length) { c.o.line("Assets"); rel2.assets.forEach(function (x) { c.o.line(X.pad(x.name, 28) + " " + kb(x.size)); }); c.o.line(""); }
      c.o.line("View on GitHub: https://github.com/" + r.full + "/releases/tag/" + rel2.tag);
      return 0;
    }
    if (sub === "download") {
      var dir = f.dir ? S.normAbs(f.dir.replace(/^~(?=\/|$)/, c.sess.home).charAt(0) === "/" ? f.dir.replace(/^~(?=\/|$)/, c.sess.home) : c.sess.cwd + "/" + f.dir) : c.sess.cwd;
      var pats = [].concat(f.pattern || []), picked = rel2.assets.filter(function (x) { return !pats.length || pats.some(function (p) { return matchList([p], x.name); }); });
      if (f.archive) { var arch = r.name + "-" + rel2.tag.replace(/^v/, "") + "." + (f.archive === "zip" ? "zip" : "tar.gz"); G.putFile(c.sys, dir + "/" + arch, "(source archive of " + r.full + " at " + rel2.tag + ")\n", 436, c.sess.uid, c.sess.gid); return 0; }
      if (!picked.length) { c.o.err("no assets to download"); return 1; }
      for (var j = 0; j < picked.length; j++) { var pth = dir + "/" + picked[j].name; if (G.nodeAt(c.sys, pth) && !f.clobber && !f["skip-existing"]) { c.o.err("open " + pth + ": file exists"); return 1; } }
      picked.forEach(function (x) { x.downloads++; putSized(c.sys, dir + "/" + x.name, x.content, 436, c.sess.uid, c.sess.gid, x.nsize); });
      return 0;
    }
    if (sub === "upload") {
      if (!GH.can(c.sys, r, login, "write") || GH.botDenied(c, r, "contents")) { if (GH.ghLogin(c) !== GH.BOT) c.o.err("HTTP 403: Resource not accessible"); return 1; }
      for (var k = 1; k < f._.length; k++) {
        var pp = f._[k].split("#")[0], tx = readLocal(c, pp), nm = pp.split("/").pop();
        if (tx === null) { c.o.err("open " + pp + ": no such file or directory"); return 1; }
        var ex = rel2.assets.filter(function (x) { return x.name === nm; })[0];
        if (ex && !f.clobber) { c.o.err("asset under the same name already exists: [" + nm + "]"); return 1; }
        if (ex) rel2.assets.splice(rel2.assets.indexOf(ex), 1);
        rel2.assets.push({ name: nm, content: tx, nsize: nodeSize(c, pp), size: nodeSize(c, pp) != null ? nodeSize(c, pp) : tx.length, label: "", downloads: 0 });
      }
      c.o.line("Successfully uploaded " + (f._.length - 1) + " asset" + (f._.length > 2 ? "s" : "") + " to " + rel2.tag);
      return 0;
    }
    if (sub === "delete") {
      if (!GH.can(c.sys, r, login, "write") || GH.botDenied(c, r, "contents")) { if (GH.ghLogin(c) !== GH.BOT) c.o.err("HTTP 403: Resource not accessible"); return 1; }
      r.releases.splice(r.releases.indexOf(rel2), 1);
      if (f["cleanup-tag"]) delete r.refs["refs/tags/" + rel2.tag];
      c.o.line("✓ Deleted release " + rel2.tag + (f["cleanup-tag"] ? "\n✓ Deleted tag " + rel2.tag : ""));
      return 0;
    }
    if (sub === "edit") {
      if (!GH.can(c.sys, r, login, "write") || GH.botDenied(c, r, "contents")) return 1;
      var wasDraft = rel2.draft;
      if (f.title) rel2.name = f.title; if (f.notes !== undefined) rel2.body = f.notes;
      if (f.draft !== undefined) rel2.draft = f.draft === true || f.draft === "true"; if (f.prerelease !== undefined) rel2.prerelease = f.prerelease === true || f.prerelease === "true";
      if (wasDraft && !rel2.draft) { rel2.created = now(c.sys); emitRelease(c.sys, r, rel2, GH.ghLogin(c)); }
      c.o.line("https://github.com/" + r.full + "/releases/tag/" + rel2.tag);
      return 0;
    }
    c.o.err("Usage:  gh release <command> [flags]\n\nAvailable commands:\n  create\n  delete\n  download\n  edit\n  list\n  upload\n  view"); return 1;
  };

  /* ================================================================== node and npm (runners, and laptops that install Node) */
  var CMDS = S.CMDS;
  function toolVersion(sess, tool) {
    var path = (S.getVar(sess, "PATH") || "").split(":");
    for (var i = 0; i < path.length; i++) { var t = rd(sess.sys, path[i] + "/" + tool), m = t && new RegExp("^\\x7fELF:" + tool + " (\\S+)").exec(t); if (m) return m[1]; if (t) return null; }
    return null;
  }
  function outl(io, t) { io.out(t + "\n"); }
  function errl(io, t) { io.err(t + "\n"); }
  CMDS.node = function (args, io, sess) {
    var v = toolVersion(sess, "node") || NODE_DEFAULT, a = args.slice(1);
    if (a[0] === "--version" || a[0] === "-v") { outl(io, "v" + v); return 0; }
    if ((a[0] === "-p" || a[0] === "--print" || a[0] === "-e") && /^process\.versions?(\.node)?$/.test(a[1] || "")) { if (a[0] !== "-e") outl(io, /versions$/.test(a[1]) ? "{ node: '" + v + "' }" : a[1] === "process.version" ? "v" + v : v); return 0; }
    errl(io, "(This lab's Node can report its version, but it can't run JavaScript. Kestrel's tests and builds are Bash scripts that npm starts: npm test, npm run build.)");
    return 1;
  };
  CMDS.npx = function (args, io) { errl(io, "(npx isn't simulated in this lab: use the npm scripts in package.json.)"); return 1; };
  function findPkg(sess) {
    var d = sess.cwd;
    for (;;) { var t = rd(sess.sys, (d === "/" ? "" : d) + "/package.json"); if (t !== null) return { dir: d, text: t }; if (d === "/") return null; d = d.slice(0, d.lastIndexOf("/")) || "/"; }
  }
  function satisfies(ver, range) {
    var v = ver.split(".").map(Number);
    return String(range).split("||").some(function (part) {
      return part.trim().split(/\s+/).every(function (c) {
        var m = /^(>=|<=|>|<|\^|~|=)?v?(\d+)(?:\.(\d+|x))?(?:\.(\d+|x))?$/.exec(c);
        if (!m) return true;
        var w = [+m[2], m[3] && m[3] !== "x" ? +m[3] : 0, m[4] && m[4] !== "x" ? +m[4] : 0], cmpv = v[0] - w[0] || v[1] - w[1] || v[2] - w[2];
        switch (m[1] || (m[3] === undefined || m[3] === "x" ? "^" : "=")) { case ">=": return cmpv >= 0; case ">": return cmpv > 0; case "<=": return cmpv <= 0; case "<": return cmpv < 0; case "^": return v[0] === w[0] && cmpv >= 0; case "~": return v[0] === w[0] && v[1] === w[1] && cmpv >= 0; default: return cmpv === 0; }
      });
    });
  }
  A.satisfies = satisfies;
  // A package-lock.json for a package.json: each dependency pinned, plus a few of its own dependencies.
  var TRANSITIVE = ["ansi-styles", "chalk", "debug", "ms", "supports-color", "has-flag", "escape-string-regexp", "picocolors", "source-map-js", "nanoid", "postcss", "entities", "domutils", "domhandler", "argparse", "js-yaml", "minimist", "semver", "commander", "glob"];
  A.lockFor = function (pkg, pins) {
    pins = pins || {};
    var deps = Object.assign({}, pkg.dependencies || {}, pkg.devDependencies || {}), packages = { "": { name: pkg.name, version: pkg.version } };
    if (pkg.dependencies) packages[""].dependencies = pkg.dependencies;
    if (pkg.devDependencies) packages[""].devDependencies = pkg.devDependencies;
    if (pkg.engines) packages[""].engines = pkg.engines;
    keys(deps).sort().forEach(function (n, i) {
      var v = pins[n] || String(deps[n]).replace(/^[\^~>=<\s]+/, "").replace(/\.x/g, ".0");
      packages["node_modules/" + n] = { version: v, resolved: "https://registry.npmjs.org/" + n + "/-/" + n.split("/").pop() + "-" + v + ".tgz", integrity: "sha512-" + M2.hashChars(n + v, 86, "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/") + "==", dev: pkg.devDependencies && pkg.devDependencies[n] ? true : undefined, license: "MIT" };
      for (var k = 0; k < 3; k++) { var t = TRANSITIVE[(hash(n) + k * 7) % TRANSITIVE.length]; if (!packages["node_modules/" + t]) packages["node_modules/" + t] = { version: (1 + hash(t) % 5) + "." + (hash(t + "m") % 20) + "." + (hash(t + "p") % 9), resolved: "https://registry.npmjs.org/" + t + "/-/" + t + ".tgz", integrity: "sha512-" + M2.hashChars(t, 86, "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/") + "==", license: "MIT" }; }
    });
    keys(packages).forEach(function (k) { if (packages[k].dev === undefined) delete packages[k].dev; });
    return JSON.stringify({ name: pkg.name, version: pkg.version, lockfileVersion: 3, requires: true, packages: packages }, null, 2) + "\n";
  };
  function npmInstall(io, sess, pkgDir, pkg, lock, nodeV, npmV) {
    var sys = sess.sys, uid = sess.uid, gid = sess.gid, pk = keys(lock.packages || {}).filter(function (k) { return k; });
    var nm = G.nodeAt(sys, pkgDir + "/node_modules"); if (nm) delete G.nodeAt(sys, pkgDir).children.node_modules;
    pk.forEach(function (k) { G.putFile(sys, pkgDir + "/" + k + "/package.json", JSON.stringify({ name: k.replace(/^node_modules\//, ""), version: lock.packages[k].version }) + "\n", 436, uid, gid); });
    G.putFile(sys, pkgDir + "/node_modules/.package-lock.json", JSON.stringify({ name: pkg.name, lockfileVersion: 3, packages: lock.packages }) + "\n", 436, uid, gid);
    var home = S.getVar(sess, "HOME") || sess.home, idx = home + "/.npm/_cacache/index-v5/" + G.abbrev(M2.sha256(JSON.stringify(lock.packages)), 12), cached = !!rd(sys, idx);
    if (!cached) { G.putFile(sys, idx, "cached " + pk.length + " packages\n", 420, uid, gid); pk.forEach(function (k) { G.putFile(sys, home + "/.npm/_cacache/content-v2/sha512/" + G.abbrev(M2.sha256(k), 2) + "/" + k.replace(/\W/g, "_"), "(tarball)\n", 420, uid, gid); }); }
    if (pkg.engines && pkg.engines.node && !satisfies(nodeV, pkg.engines.node)) errl(io, "npm warn EBADENGINE Unsupported engine {\nnpm warn EBADENGINE   package: '" + pkg.name + "@" + pkg.version + "',\nnpm warn EBADENGINE   required: { node: '" + pkg.engines.node + "' },\nnpm warn EBADENGINE   current: { node: 'v" + nodeV + "', npm: '" + npmV + "' }\nnpm warn EBADENGINE }");
    outl(io, "\nadded " + pk.length + " packages, and audited " + (pk.length + 1) + " packages in " + (cached ? 2 : 6 + pk.length % 5) + "s\n\n" + (pk.length > 4 ? Math.floor(pk.length / 3) + " packages are looking for funding\n  run `npm fund` for details\n\n" : "") + (A.npmAudit ? A.npmAudit(sess, pkgDir, pkg, lock).summary : "found 0 vulnerabilities"));
  }
  CMDS.npm = function (args, io, sess) {
    var a = args.slice(1), cmd = a[0], nodeV = toolVersion(sess, "node") || NODE_DEFAULT, npmV = NPM[nodeV.split(".")[0]] || "10.8.2";
    if (!cmd || cmd === "help" || cmd === "-h") { outl(io, "npm <command>\n\nUsage:\n\nnpm install        install all the dependencies in your project\nnpm ci             clean install from package-lock.json\nnpm test           run this project's tests\nnpm run <foo>      run the script named <foo>\nnpm pack           create a tarball from a package\nnpm audit          check dependencies for known vulnerabilities\n\nnpm@" + npmV + " /usr/local/lib/node_modules/npm"); return cmd ? 0 : 1; }
    if (cmd === "-v" || cmd === "--version") { outl(io, npmV); return 0; }
    var pj = findPkg(sess);
    if (!pj) { errl(io, "npm error code ENOENT\nnpm error syscall open\nnpm error path " + sess.cwd + "/package.json\nnpm error errno -2\nnpm error enoent Could not read package.json: Error: ENOENT: no such file or directory, open '" + sess.cwd + "/package.json'\nnpm error enoent This is related to npm not being able to find a file."); return 254; }
    var pkg;
    try { pkg = JSON.parse(pj.text); } catch (e) { errl(io, "npm error code EJSONPARSE\nnpm error JSON.parse Invalid package.json: JSONParseError: " + e.message + " while parsing '" + pj.text.slice(0, 20).replace(/\n/g, " ") + "'\nnpm error JSON.parse Failed to parse JSON data.\nnpm error JSON.parse Note: package.json must be actual JSON, not just JavaScript."); return 1; }
    var npmrc = rd(sess.sys, pj.dir + "/.npmrc") || "", strict = /^\s*engine-strict\s*=\s*true/m.test(npmrc);
    if ((cmd === "ci" || cmd === "install" || cmd === "i" || cmd === "clean-install") && strict && pkg.engines && pkg.engines.node && !satisfies(nodeV, pkg.engines.node)) {
      errl(io, "npm error code EBADENGINE\nnpm error engine Unsupported engine\nnpm error engine Not compatible with your version of node/npm: " + pkg.name + "@" + pkg.version + "\nnpm error notsup Not compatible with your version of node/npm: " + pkg.name + "@" + pkg.version + "\nnpm error notsup Required: {\"node\":\"" + pkg.engines.node + "\"}\nnpm error notsup Actual:   {\"npm\":\"" + npmV + "\",\"node\":\"v" + nodeV + "\"}");
      return 1;
    }
    if (cmd === "ci" || cmd === "clean-install") {
      var lt = rd(sess.sys, pj.dir + "/package-lock.json");
      if (lt === null) { errl(io, "npm error code EUSAGE\nnpm error\nnpm error The `npm ci` command can only install with an existing package-lock.json or\nnpm error npm-shrinkwrap.json with lockfileVersion >= 1. Run an install with npm@5 or\nnpm error later to generate a package-lock.json file, then try again."); return 1; }
      var lock; try { lock = JSON.parse(lt); } catch (e) { errl(io, "npm error code EJSONPARSE\nnpm error Invalid package-lock.json"); return 1; }
      var root0 = (lock.packages || {})[""] || {}, want = Object.assign({}, pkg.dependencies || {}, pkg.devDependencies || {}), have = Object.assign({}, root0.dependencies || {}, root0.devDependencies || {});
      var missing = keys(want).filter(function (n) { return have[n] !== want[n] || !(lock.packages || {})["node_modules/" + n]; });
      if (missing.length) { errl(io, "npm error code EUSAGE\nnpm error\nnpm error `npm ci` can only install packages when your package.json and package-lock.json or npm-shrinkwrap.json are in sync. Please update your lock file with `npm install` before continuing.\nnpm error\n" + missing.map(function (n) { var lp = (lock.packages || {})["node_modules/" + n]; return lp ? "npm error Invalid: lock file's " + n + "@" + lp.version + " does not satisfy " + n + "@" + want[n] : "npm error Missing: " + n + "@" + String(want[n]).replace(/^[\^~]/, "") + " from lock file"; }).join("\n") + "\nnpm error\nnpm error Clean install a project\nnpm error\nnpm error Usage:\nnpm error npm ci\nnpm error\nnpm error Run \"npm help ci\" for more info"); return 1; }
      npmInstall(io, sess, pj.dir, pkg, lock, nodeV, npmV);
      return 0;
    }
    if (cmd === "install" || cmd === "i") {
      if (a.length > 1 && !/^-/.test(a[1])) { errl(io, "(Adding packages isn't simulated: add the dependency to package.json, then run npm install to update package-lock.json.)"); return 1; }
      var cur = rd(sess.sys, pj.dir + "/package-lock.json"), pins = {};
      try { var old = cur ? JSON.parse(cur).packages || {} : {}; keys(old).forEach(function (k) { if (/^node_modules\/[^/]+$/.test(k)) pins[k.slice(13)] = old[k].version; }); } catch (e) { pins = {}; }
      var deps = Object.assign({}, pkg.dependencies || {}, pkg.devDependencies || {});
      keys(pins).forEach(function (n) { if (!deps[n] || !satisfies(pins[n], deps[n])) delete pins[n]; });
      var text = A.lockFor(pkg, pins);
      G.putFile(sess.sys, pj.dir + "/package-lock.json", text, 436, sess.uid, sess.gid);
      npmInstall(io, sess, pj.dir, pkg, JSON.parse(text), nodeV, npmV);
      return 0;
    }
    if (cmd === "audit") { var la = rd(sess.sys, pj.dir + "/package-lock.json"); if (!la) { errl(io, "npm error code ENOLOCK\nnpm error audit This command requires an existing lockfile.\nnpm error audit Try creating one first with: npm i --package-lock-only"); return 1; } if (A.npmAudit) { var au = A.npmAudit(sess, pj.dir, pkg, JSON.parse(la), a.slice(1)); outl(io, au.text); return au.code; } outl(io, "found 0 vulnerabilities"); return 0; }
    if (cmd === "pack") {
      var fname = String(pkg.name).replace(/^@/, "").replace(/\//g, "-") + "-" + pkg.version + ".tgz", files = (pkg.files || ["."]);
      var listed = []; files.forEach(function (fp) { var abs = S.normAbs(pj.dir + "/" + fp); if (isDir(sess.sys, abs)) walkFiles(sess.sys, abs, fp === "." ? "" : fp.replace(/\/$/, ""), []).forEach(function (x) { if (!/^(node_modules|\.git)\//.test(x.rel)) listed.push(x); }); else { var t = rd(sess.sys, abs); if (t !== null) listed.push({ rel: fp, content: t }); } });
      if (!listed.some(function (x) { return x.rel === "package.json"; })) listed.push({ rel: "package.json", content: pj.text });
      G.putFile(sess.sys, pj.dir + "/" + fname, "(npm tarball " + fname + ")\n" + listed.map(function (x) { return "package/" + x.rel; }).join("\n") + "\n", 436, sess.uid, sess.gid);
      errl(io, "npm notice\nnpm notice 📦  " + pkg.name + "@" + pkg.version + "\nnpm notice Tarball Contents\n" + listed.map(function (x) { return "npm notice " + kb(x.content.length) + " " + x.rel; }).join("\n") + "\nnpm notice Tarball Details\nnpm notice name: " + pkg.name + "\nnpm notice version: " + pkg.version + "\nnpm notice filename: " + fname + "\nnpm notice total files: " + listed.length + "\nnpm notice");
      outl(io, fname);
      return 0;
    }
    var script = cmd === "test" || cmd === "t" || cmd === "tst" ? "test" : cmd === "start" ? "start" : cmd === "run" || cmd === "run-script" || cmd === "rum" ? a[1] : null;
    if (cmd === "run" && !a[1]) { var sc = pkg.scripts || {}; outl(io, "Scripts available in " + pkg.name + "@" + pkg.version + " via `npm run-script`:\n" + keys(sc).map(function (k) { return "  " + k + "\n    " + sc[k]; }).join("\n")); return 0; }
    if (script === null) { errl(io, "Unknown command: \"" + cmd + "\"\n\nTo see a list of supported npm commands, run:\n  npm help"); return 1; }
    var scripts = pkg.scripts || {};
    if (!scripts[script]) { errl(io, "npm error Missing script: \"" + script + "\"\nnpm error\nnpm error To see a list of scripts, run:\nnpm error   npm run"); return 1; }
    var extra = a.slice(cmd === "run" || cmd === "run-script" || cmd === "rum" ? 2 : 1).filter(function (x) { return x !== "--"; });
    function one(name) {
      var line = scripts[name] + (name === script && extra.length ? " " + extra.join(" ") : "");
      outl(io, "\n> " + pkg.name + "@" + pkg.version + " " + name + "\n> " + line + "\n");
      var ch = S.childSession(sess);
      ch.cwd = pj.dir;
      ch.vars.PATH = { v: pj.dir + "/node_modules/.bin:" + (S.getVar(sess, "PATH") || ""), x: true };
      ch.vars.npm_package_name = { v: pkg.name, x: true }; ch.vars.npm_package_version = { v: String(pkg.version), x: true }; ch.vars.npm_lifecycle_event = { v: name, x: true };
      return S.runCommand(ch, ["bash", "-c", line], { stdin: io.stdin, out: io.out, err: io.err, tty: false });
    }
    var rc = 0;
    if (scripts["pre" + script]) rc = one("pre" + script);
    if (!rc) rc = one(script);
    if (!rc && scripts["post" + script]) rc = one("post" + script);
    return rc;
  };
  if (!CMDS.python3) CMDS.python3 = function (args, io, sess) { var v = toolVersion(sess, "python3") || "3.12.3"; if (args[1] === "--version" || args[1] === "-V") { outl(io, "Python " + v); return 0; } errl(io, "(This lab can't run Python programs.)"); return 1; };
  // Lab setup: Node on the laptop
  A.installNode = function (sys, ver) {
    ver = ver || NODE["22"];
    S.put(sys, "/usr/bin/node", "\x7fELF:node " + ver + "\n", 493);
    S.put(sys, "/usr/bin/npm", "\x7fELF:npm (simulated binary)\n", 493);
    S.put(sys, "/usr/bin/npx", "\x7fELF:npx (simulated binary)\n", 493);
  };

  /* ================================================================== gh api: Actions endpoints */
  function iso(t) { return A.isoAt(t).replace(/\.\d+Z$/, "Z"); }
  function runApi(r, run) { return { id: run.id, name: run.wfName, display_title: run.title, head_branch: run.branch, head_sha: run.headSha, path: run.wfPath, event: run.event, status: run.status, conclusion: run.conclusion, run_number: run.number, run_attempt: run.attempt, workflow_id: wfId(run.wfPath), html_url: "https://github.com/" + r.full + "/actions/runs/" + run.id, created_at: iso(run.created), actor: { login: run.actor } }; }
  GH.api("GET", /^repos\/([^/]+\/[^/]+)\/actions\/runs$/, function (c, m, b, login, q) { var r = GH.find(c.sys, m[1]), runs = r.runs.slice().sort(function (x, y) { return y.id - x.id; }).filter(function (x) { return (!q.branch || x.branch === q.branch) && (!q.event || x.event === q.event) && (!q.status || x.status === q.status || x.conclusion === q.status); }); return { total_count: runs.length, workflow_runs: runs.map(function (x) { return runApi(r, x); }) }; });
  GH.api("GET", /^repos\/([^/]+\/[^/]+)\/actions\/runs\/(\d+)$/, function (c, m) { var r = GH.find(c.sys, m[1]), run = r.runs.filter(function (x) { return String(x.id) === m[2]; })[0]; return run ? runApi(r, run) : { status: 404, body: { message: "Not Found", status: "404" } }; });
  GH.api("GET", /^repos\/([^/]+\/[^/]+)\/actions\/runs\/(\d+)\/jobs$/, function (c, m) { var r = GH.find(c.sys, m[1]), run = r.runs.filter(function (x) { return String(x.id) === m[2]; })[0]; if (!run) return { status: 404, body: { message: "Not Found", status: "404" } }; return { total_count: run.jobs.length, jobs: run.jobs.map(function (j) { return { id: j.id, run_id: run.id, name: j.name, status: j.status, conclusion: j.conclusion, started_at: iso(j.started || run.created), completed_at: j.completed ? iso(j.completed) : null, steps: j.steps.map(function (s) { return { name: s.name, status: s.status, conclusion: s.conclusion, number: s.number }; }), html_url: "https://github.com/" + r.full + "/actions/runs/" + run.id + "/job/" + j.id }; }) }; });
  GH.api("GET", /^repos\/([^/]+\/[^/]+)\/actions\/workflows$/, function (c, m) { var r = GH.find(c.sys, m[1]), ws = wfList(c.sys, r); return { total_count: ws.length, workflows: ws.map(function (w) { return { id: wfId(w.path), name: w.name, path: w.path, state: r.wfDisabled && r.wfDisabled[w.path] ? "disabled_manually" : "active" }; }) }; });
  GH.api("GET", /^repos\/([^/]+\/[^/]+)\/actions\/permissions\/workflow$/, function (c, m) { var r = GH.find(c.sys, m[1]); return { default_workflow_permissions: r.settings.actionsPermissions === "write" ? "write" : "read", can_approve_pull_request_reviews: !!r.settings.actionsApprovePRs }; });
  GH.api("PUT", /^repos\/([^/]+\/[^/]+)\/actions\/permissions\/workflow$/, function (c, m, b, login) {
    var r = GH.find(c.sys, m[1]);
    if (GH.role(c.sys, r, login) !== "admin") return { status: 403, body: { message: "Must have admin rights to Repository.", status: "403" } };
    if (b.default_workflow_permissions && ["read", "write"].indexOf(b.default_workflow_permissions) < 0) return { status: 422, body: { message: "Invalid request.\n\n\"" + b.default_workflow_permissions + "\" is not a member of [\"read\", \"write\"].", status: "422" } };
    if (b.default_workflow_permissions) r.settings.actionsPermissions = b.default_workflow_permissions;
    if (b.can_approve_pull_request_reviews !== undefined) r.settings.actionsApprovePRs = !!b.can_approve_pull_request_reviews;
    GH.audit(c.sys, login, "repo.update_actions_settings", { repo: r.full, default_workflow_permissions: r.settings.actionsPermissions });
    return { status: 204 };
  });
  function envId(name) { return 5000000 + hash(name) % 900000; }
  function envApi(r, e) { return { id: envId(e.name), name: e.name, html_url: "https://github.com/" + r.full + "/deployments/activity_log?environments_filter=" + e.name, protection_rules: (e.reviewers && e.reviewers.length ? [{ type: "required_reviewers", reviewers: e.reviewers.map(function (x) { return { type: "User", reviewer: { login: x } }; }) }] : []).concat(e.branches ? [{ type: "branch_policy" }] : []), deployment_branch_policy: e.branches ? { protected_branches: false, custom_branch_policies: true } : null }; }
  GH.api("GET", /^repos\/([^/]+\/[^/]+)\/environments$/, function (c, m) { var r = GH.find(c.sys, m[1]), es = keys(r.envs || {}).map(function (k) { return envApi(r, r.envs[k]); }); return { total_count: es.length, environments: es }; });
  GH.api("GET", /^repos\/([^/]+\/[^/]+)\/environments\/([^/]+)$/, function (c, m) { var r = GH.find(c.sys, m[1]), e = (r.envs || {})[m[2]]; return e ? envApi(r, e) : { status: 404, body: { message: "Not Found", status: "404" } }; });
  GH.api("GET", /^repos\/([^/]+\/[^/]+)\/environments\/([^/]+)\/deployment-branch-policies$/, function (c, m) { var r = GH.find(c.sys, m[1]), e = (r.envs || {})[m[2]]; if (!e) return { status: 404, body: { message: "Not Found", status: "404" } }; var bs = e.branches || []; return { total_count: bs.length, branch_policies: bs.map(function (x, i) { return { id: 100 + i, name: x, type: "branch" }; }) }; });
  GH.api("GET", /^repos\/([^/]+\/[^/]+)\/actions\/runs\/(\d+)\/pending_deployments$/, function (c, m, b, login) { var r = GH.find(c.sys, m[1]), run = r.runs.filter(function (x) { return String(x.id) === m[2]; })[0]; if (!run) return { status: 404, body: { message: "Not Found", status: "404" } }; var seen = {}; return run.jobs.filter(function (j) { if (j.status !== "waiting" || seen[j.envName]) return false; seen[j.envName] = 1; return true; }).map(function (j) { var e = r.envs[j.envName]; return { environment: { id: envId(e.name), name: e.name }, wait_timer: 0, current_user_can_approve: e.reviewers.indexOf(login) >= 0, reviewers: e.reviewers.map(function (x) { return { type: "User", reviewer: { login: x } }; }) }; }); });
  GH.api("POST", /^repos\/([^/]+\/[^/]+)\/actions\/runs\/(\d+)\/pending_deployments$/, function (c, m, b, login) {
    var r = GH.find(c.sys, m[1]), run = r.runs.filter(function (x) { return String(x.id) === m[2]; })[0];
    if (!run) return { status: 404, body: { message: "Not Found", status: "404" } };
    var ids = [].concat(b.environment_ids || []).map(Number), names = keys(r.envs || {}).filter(function (k) { return ids.indexOf(envId(k)) >= 0; });
    if (!names.length || ["approved", "rejected"].indexOf(b.state) < 0) return { status: 422, body: { message: "Invalid request: environment_ids must name a waiting environment and state must be approved or rejected.", status: "422" } };
    var bad = names.filter(function (n) { return r.envs[n].reviewers.indexOf(login) < 0; });
    if (bad.length) return { status: 422, body: { message: "Unable to approve or reject the deployment: the user is not a required reviewer for environment(s) " + bad.join(", "), status: "422" } };
    names.forEach(function (n) { A.review(c.sys, r, run, n, login, b.state, b.comment); });
    return names.map(function (n) { return { environment: n, state: b.state }; });
  });
  GH.api("GET", /^repos\/([^/]+\/[^/]+)\/actions\/caches$/, function (c, m) { var r = GH.find(c.sys, m[1]), ks = keys(r.caches); return { total_count: ks.length, actions_caches: ks.map(function (k, i) { return { id: 1000 + i, key: k, ref: r.caches[k].ref, size_in_bytes: r.caches[k].size * 1024, created_at: iso(r.caches[k].created) }; }) }; });
  GH.api("GET", /^repos\/([^/]+\/[^/]+)\/releases$/, function (c, m) { var r = GH.find(c.sys, m[1]); return (r.releases || []).slice().reverse().map(function (x) { return { id: x.id, tag_name: x.tag, name: x.name, draft: x.draft, prerelease: x.prerelease, author: { login: x.author }, assets: x.assets.map(function (y) { return { name: y.name, size: y.size, download_count: y.downloads }; }) }; }); });
  GH.api("GET", /^repos\/([^/]+\/[^/]+)\/releases\/latest$/, function (c, m) { var r = GH.find(c.sys, m[1]), x = relLatest(r); return x ? { id: x.id, tag_name: x.tag, name: x.name, body: x.body, author: { login: x.author }, assets: x.assets.map(function (y) { return { name: y.name, size: y.size }; }) } : { status: 404, body: { message: "Not Found", status: "404" } }; });
  GH.api("GET", /^repos\/([^/]+\/[^/]+)\/git\/(?:ref|refs)\/(tags|heads)\/(.+)$/, function (c, m) { var r = GH.find(c.sys, m[1]), sha = r.refs["refs/" + m[2] + "/" + m[3]]; if (!sha) return { status: 404, body: { message: "Not Found", status: "404" } }; return { ref: "refs/" + m[2] + "/" + m[3], object: { sha: sha, type: G.getObject(c.sys, sha).type } }; });
  GH.api("GET", /^repos\/([^/]+\/[^/]+)\/deployments$/, function (c, m, b, login, q) { var r = GH.find(c.sys, m[1]); return (r.deployments || []).slice().reverse().filter(function (d) { return !q.environment || d.env === q.environment; }).map(function (d) { return { id: d.id, sha: d.sha, ref: d.ref.replace(/^refs\/(heads|tags)\//, ""), environment: d.env, created_at: iso(d.at) }; }); });

  /* ================================================================== Kestrel's deploy and chat services (what workflows talk to) */
  // deploy.kestrel.io: POST /api/sites/SITE/releases with "Authorization: Bearer TOKEN" and sha=...; each token
  // belongs to one site and one environment (A.deployToken). chat.kestrel.io: POST /hooks/ID (A.chatHook).
  function svc(sys) { var h = GH.hub(sys); if (!h.svc) h.svc = { tokens: {}, deploys: [], hooks: {}, messages: [] }; return h.svc; }
  A.svc = svc;
  A.deployToken = function (sys, site, env) { var v = "kdt_" + M2.hashChars("deploy" + site + env + keys(svc(sys).tokens).length, 32, "abcdefghijklmnopqrstuvwxyz0123456789"); svc(sys).tokens[v] = { site: site, env: env, revoked: false }; return v; };
  A.chatHook = function (sys, channel) { var id = M2.hashChars("hook" + channel, 20, "abcdefghijklmnopqrstuvwxyz0123456789"); svc(sys).hooks[id] = { channel: channel }; return "https://chat.kestrel.io/hooks/" + id; };
  function jres(status, obj) { return { status: status, headers: { "Content-Type": "application/json", Server: "kestrel-deploy/2.1" }, body: JSON.stringify(obj) + "\n" }; }
  function formBody(b) { var o = {}; String(b || "").split("&").forEach(function (kv) { var i = kv.indexOf("="); if (i > 0) o[decodeURIComponent(kv.slice(0, i))] = decodeURIComponent(kv.slice(i + 1).replace(/\+/g, " ")); }); if (/^\s*\{/.test(b || "")) { try { o = JSON.parse(b); } catch (e) { /* keep form fields */ } } return o; }
  if (M2.net && M2.net.SITES) {
    M2.net.DNS["deploy.kestrel.io"] = { A: ["203.0.113.80"] };
    M2.net.DNS["chat.kestrel.io"] = { A: ["203.0.113.81"] };
    M2.net.HOSTS["203.0.113.80"] = { ping: 6.2, ports: [443], site: "kestrel-deploy" };
    M2.net.HOSTS["203.0.113.81"] = { ping: 6.4, ports: [443], site: "kestrel-chat" };
    M2.net.SITES["kestrel-deploy"] = function (req, sys) {
      var p = req.path.split("?")[0], m = /^\/api\/sites\/([\w.-]+)\/releases$/.exec(p);
      if (p === "/api/health") return jres(200, { status: "ok" });
      if (!m) return jres(404, { error: "not found" });
      if (req.method !== "POST") return jres(405, { error: "use POST" });
      var auth = (req.headers.authorization || "").replace(/^Bearer\s+/i, ""), st = svc(sys), t = st.tokens[auth];
      if (!auth) return jres(401, { error: "missing token: send Authorization: Bearer <token>" });
      if (!t || t.revoked) return jres(401, { error: "invalid or revoked token" });
      if (t.site !== m[1]) return jres(403, { error: "this token can't deploy " + m[1] });
      var f = formBody(req.body);
      if (!/^[0-9a-f]{7,40}$/.test(f.sha || "")) return jres(422, { error: "sha=<commit> is required" });
      var rec = { n: st.deploys.length + 1, site: m[1], env: t.env, sha: f.sha, token: auth, from: sys.isRunner ? "actions" : "laptop", run: sys.runId || null, at: G.clock(sys) };
      st.deploys.push(rec);
      return jres(201, { release: rec.n, site: rec.site, environment: rec.env, sha: rec.sha, url: "https://" + (t.env === "production" ? "" : t.env + ".") + m[1] + ".kestrel.io" });
    };
    M2.net.SITES["kestrel-chat"] = function (req, sys) {
      var m = /^\/hooks\/([\w]+)$/.exec(req.path.split("?")[0]), st = svc(sys);
      if (!m || !st.hooks[m[1]]) return { status: 404, headers: { "Content-Type": "text/plain" }, body: "no_such_hook" };
      if (req.method !== "POST") return { status: 405, headers: { "Content-Type": "text/plain" }, body: "use POST" };
      st.messages.push({ channel: st.hooks[m[1]].channel, text: formBody(req.body).text || req.body || "", from: sys.isRunner ? "actions" : "laptop", run: sys.runId || null, at: G.clock(sys) });
      return { status: 200, headers: { "Content-Type": "text/plain" }, body: "ok" };
    };
  }

  /* ================================================================== explanations, man pages, settings */
  var EX = root.ShLab && root.ShLab.EXPLAIN;
  if (EX) [
    [/You have an error in your yaml syntax on line \d+/, "YAML is picky about indentation: look at that line and the one above it. Spaces only (no tabs), a child indented further than its parent, a space after each colon, and list items (- ...) lined up."],
    [/Unrecognized named-value: '/, "A ${{ }} expression uses a context that doesn't exist. The contexts are github, env, vars, secrets, matrix, strategy, needs, steps, runner, job and inputs: check the spelling (secrets, not secret)."],
    [/Unable to resolve action `/, "The uses: line names an action or a version that doesn't exist. Check the owner/name and the version tag, e.g. actions/checkout@v4."],
    [/deprecated version of `actions\/(upload|download)-artifact/, "GitHub no longer runs v3 of the artifact actions. Change them to @v4 (and give every upload in a run its own name)."],
    [/an artifact with this name already exists/, "In v4 an artifact name can only be uploaded once per run. In a matrix, put the matrix value in the name: name: dist-${{ matrix.node }}."],
    [/Resource not accessible by integration/, "The job's GITHUB_TOKEN doesn't have the permission this needs. Give the job (or workflow) a permissions: block with exactly what it needs, e.g. contents: write to create a release."],
    [/is not allowed to deploy to .* due to environment protection rules/, "This environment only accepts deployments from the branches it allows (usually main). Deploy from an allowed branch, through a pull request."],
    [/Workflow does not have 'workflow_dispatch' trigger/, "gh workflow run only works for workflows that have on: workflow_dispatch, in the version of the file on the branch you run (--ref, default branch otherwise). Commit and push that first."],
    [/This run likely failed because of a workflow file issue/, "GitHub couldn't read the workflow file, so no job ran. The ANNOTATIONS say which line. Fix the YAML locally, commit, and push: a re-run would use the same broken file."],
    [/`npm ci` can only install packages when your package\.json and package-lock\.json/, "package.json and package-lock.json disagree. Run npm install to update the lock file, then commit both files together."],
    [/Required input '.*' not provided/, "This workflow's inputs: has a required input. Pass it with -f NAME=VALUE."],
    [/run \d+ is still in progress; logs will be available/, "The run hasn't finished. gh run view RUN_ID (without --log) shows what it's waiting for."],
    [/Dependencies lock file is not found/, "setup-node's cache: npm needs package-lock.json committed in the repository (and the checkout step must come before setup-node)."]
  ].reverse().forEach(function (x) { EX.unshift(x); });
  if (S.MAN && S.MAN.gh) S.MAN.gh.opts = S.MAN.gh.opts.concat([["run list|view|watch|rerun|download", "GitHub Actions runs"], ["workflow list|view|run|enable|disable", "workflows"], ["secret set|list|delete", "Actions secrets (repository or --env)"], ["variable set|list|get|delete", "Actions variables"], ["release create|list|view|download", "releases"], ["cache list|delete", "Actions caches"]]);
  if (S.MAN) {
    S.MAN.node = { syn: "node [options] [script.js]", desc: "The Node.js JavaScript runtime. (In this course: node --version only.)", opts: [["--version, -v", "print the version"]] };
    S.MAN.npm = { syn: "npm <command>", desc: "Node's package manager: installs dependencies and runs the scripts in package.json.", opts: [["ci", "clean install exactly what package-lock.json lists"], ["install", "install dependencies, updating package-lock.json"], ["test", "run the test script"], ["run NAME", "run a script from package.json"], ["pack", "make the package tarball"]] };
  }

  root.GitActions = A;
  if (typeof module !== "undefined" && module.exports) module.exports = A;
})(typeof window !== "undefined" ? window : globalThis);
