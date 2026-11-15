/* sudo learn — a small YAML reader and writer for the DevOps track (Compose files now; Kubernetes manifests,
   Ansible and CI files later). It covers what those files use: block mappings and sequences, flow [..] and {..},
   quoted and plain scalars, | and > block scalars, comments, and errors worded like Go's yaml library
   ("yaml: line 4: mapping values are not allowed in this context"). */
(function (root) {
  "use strict";
  function YamlError(line, msg) { this.line = line; this.message = "yaml: line " + line + ": " + msg; }
  YamlError.prototype = Object.create(Error.prototype);

  // Remove a trailing comment (a # at the start or after a space, outside quotes).
  function stripComment(s) {
    var q = null;
    for (var i = 0; i < s.length; i++) {
      var ch = s.charAt(i);
      if (q) { if (ch === q && !(q === '"' && s.charAt(i - 1) === "\\")) q = null; continue; }
      if (ch === '"' || ch === "'") { if (i === 0 || /[\s\[{,:-]/.test(s.charAt(i - 1))) q = ch; continue; }
      if (ch === "#" && (i === 0 || /\s/.test(s.charAt(i - 1)))) return s.slice(0, i).replace(/\s+$/, "");
    }
    return s.replace(/\s+$/, "");
  }
  function toLines(text) {
    var raw = String(text).replace(/\r/g, "").split("\n"), out = [];
    for (var i = 0; i < raw.length; i++) {
      var l = raw[i];
      if (/^\s*$/.test(l) || /^\s*#/.test(l) || /^(---|\.\.\.)\s*$/.test(l)) { out.push({ n: i + 1, blank: true, raw: l }); continue; }
      var m = /^( *)(\t*)/.exec(l);
      if (m[2]) throw new YamlError(i + 1, "found character that cannot start any token");
      out.push({ n: i + 1, indent: m[1].length, text: stripComment(l.slice(m[1].length)), raw: l });
    }
    return out;
  }

  /* ---------------- scalars and flow collections */
  function unquote(s, line) {
    if (s.charAt(0) === "'") { if (!/'$/.test(s) || s.length < 2) throw new YamlError(line, "found unexpected end of stream"); return s.slice(1, -1).replace(/''/g, "'"); }
    if (!/"$/.test(s) || s.length < 2 || /\\"$/.test(s) && !/\\\\"$/.test(s)) throw new YamlError(line, "found unexpected end of stream");
    return s.slice(1, -1).replace(/\\(["\\\/nt0r]|u[0-9a-fA-F]{4})/g, function (m0, c) { return { '"': '"', "\\": "\\", "/": "/", n: "\n", t: "\t", "0": "\0", r: "\r" }[c] || String.fromCharCode(parseInt(c.slice(1), 16)); });
  }
  function plain(s) {
    if (s === "" || s === "~" || s === "null" || s === "Null" || s === "NULL") return null;
    if (/^(true|True|TRUE)$/.test(s)) return true;
    if (/^(false|False|FALSE)$/.test(s)) return false;
    if (/^[-+]?\d+$/.test(s) && !/^[-+]?0\d/.test(s)) return parseInt(s, 10);
    if (/^[-+]?(\d+\.\d*|\.\d+)([eE][-+]?\d+)?$/.test(s)) return parseFloat(s);
    return s;
  }
  function scalar(s, line) {
    s = s.trim();
    if (s.charAt(0) === '"' || s.charAt(0) === "'") return unquote(s, line);
    if (s.charAt(0) === "[" || s.charAt(0) === "{") return flow(s, line);
    if (/^[&*!]/.test(s)) throw new YamlError(line, "anchors, aliases and tags aren't supported in this lab");
    if (/^[@`]/.test(s)) throw new YamlError(line, "found character that cannot start any token");
    return plain(s);
  }
  function flow(s, line) {
    var i = 0;
    function ws() { while (i < s.length && /\s/.test(s.charAt(i))) i++; }
    function item(stop) {
      ws();
      var c = s.charAt(i);
      if (c === "[") return seq();
      if (c === "{") return map();
      if (c === '"' || c === "'") {
        var j = i + 1;
        while (j < s.length && !(s.charAt(j) === c && (c === "'" ? s.charAt(j + 1) !== "'" : s.charAt(j - 1) !== "\\"))) j += c === "'" && s.charAt(j) === "'" ? 2 : 1;
        var v = unquote(s.slice(i, j + 1), line); i = j + 1; return v;
      }
      var st = i;
      while (i < s.length && stop.indexOf(s.charAt(i)) < 0) i++;
      return plain(s.slice(st, i).trim());
    }
    function seq() {
      i++; var arr = []; ws();
      if (s.charAt(i) === "]") { i++; return arr; }
      for (;;) {
        arr.push(item(",]")); ws();
        var c = s.charAt(i);
        if (c === ",") { i++; ws(); if (s.charAt(i) === "]") { i++; return arr; } continue; }
        if (c === "]") { i++; return arr; }
        throw new YamlError(line, "did not find expected ',' or ']'");
      }
    }
    function map() {
      i++; var obj = {}; ws();
      if (s.charAt(i) === "}") { i++; return obj; }
      for (;;) {
        var k = item(":,}"); ws();
        if (s.charAt(i) !== ":") throw new YamlError(line, "did not find expected ',' or '}'");
        i++;
        obj[String(k)] = item(",}"); ws();
        var c = s.charAt(i);
        if (c === ",") { i++; ws(); if (s.charAt(i) === "}") { i++; return obj; } continue; }
        if (c === "}") { i++; return obj; }
        throw new YamlError(line, "did not find expected ',' or '}'");
      }
    }
    var v = s.charAt(0) === "[" ? seq() : map();
    ws();
    if (i < s.length) throw new YamlError(line, "did not find expected <document start>");
    return v;
  }

  /* ---------------- block structure */
  // Split "key: value" (the key may be quoted). Returns null if the line isn't a mapping entry.
  function splitKey(t) {
    var m;
    if (t.charAt(0) === '"' || t.charAt(0) === "'") {
      var q = t.charAt(0), j = 1;
      while (j < t.length && t.charAt(j) !== q) j += t.charAt(j) === "\\" ? 2 : 1;
      var rest = t.slice(j + 1);
      m = /^\s*:(\s+|$)(.*)$/.exec(rest);
      return m ? { key: unquote(t.slice(0, j + 1), 0), val: m[2] } : null;
    }
    if (/^[\[{]/.test(t)) return null;
    m = /^([^:#]*?[^\s:]|[^:#]?):(\s+(.*)|)$/.exec(t);
    if (!m) { m = /^(.+?):\s+(.*)$/.exec(t); if (!m || /^["']/.test(m[1])) return null; return { key: m[1], val: m[2] }; }
    return { key: m[1], val: m[3] || "" };
  }
  function parse(text) {
    var L = toLines(text), pos = 0;
    function next() { while (pos < L.length && L[pos].blank) pos++; return L[pos]; }
    function blockScalar(head, parentIndent, lineNo) {
      var style = head.charAt(0), chomp = /-/.test(head) ? "-" : /\+/.test(head) ? "+" : "";
      var body = [], ind = null;
      while (pos < L.length) {
        var l = L[pos];
        if (l.blank) { body.push(""); pos++; continue; }
        if (l.indent <= parentIndent) break;
        if (ind === null) ind = l.indent;
        if (l.indent < ind) break;
        body.push(l.raw.slice(ind)); pos++;
      }
      while (body.length && body[body.length - 1] === "") { if (chomp === "+") break; body.pop(); }
      var txt = style === "|" ? body.join("\n") : body.reduce(function (acc, b, i) { return i === 0 ? b : acc + (b === "" ? "\n" : (/\n$/.test(acc) ? "" : " ") + b); }, "");
      if (!body.length) return chomp === "+" ? "\n" : "";
      return chomp === "-" ? txt : txt + "\n";
    }
    function node(indent) {
      var l = next();
      if (!l || l.indent < indent) return null;
      if (/^-(\s|$)/.test(l.text)) return seq(l.indent);
      return map(l.indent);
    }
    function seq(indent) {
      var arr = [];
      for (;;) {
        var l = next();
        if (!l || l.indent < indent) break;
        if (l.indent > indent) throw new YamlError(l.n, "did not find expected '-' indicator");
        if (!/^-(\s|$)/.test(l.text)) break;
        var rest = l.text.replace(/^-\s*/, "");
        if (rest === "") { pos++; var nx = next(); arr.push(nx && nx.indent > indent ? node(nx.indent) : null); continue; }
        // "- key: value" starts a mapping whose keys line up after the dash
        var inner = indent + (l.text.length - rest.length);
        if (/^-(\s|$)/.test(rest) || (splitKey(rest) && !/^["'\[{]/.test(rest.trim()) || (splitKey(rest) && /^["']/.test(rest)))) {
          L[pos] = { n: l.n, indent: inner, text: rest, raw: l.raw };
          arr.push(node(inner));
          continue;
        }
        pos++;
        if (/^[|>][-+]?$/.test(rest)) { arr.push(blockScalar(rest, indent, l.n)); continue; }
        arr.push(scalar(rest, l.n));
        var nx2 = next();
        if (nx2 && nx2.indent > indent && !/^-(\s|$)/.test(nx2.text)) throw new YamlError(nx2.n, "mapping values are not allowed in this context");
      }
      return arr;
    }
    function map(indent) {
      var obj = {}, seen = {};
      for (;;) {
        var l = next();
        if (!l || l.indent < indent) break;
        if (l.indent > indent) throw new YamlError(l.n, "mapping values are not allowed in this context");
        if (/^-(\s|$)/.test(l.text)) throw new YamlError(l.n, "did not find expected key");
        var kv = splitKey(l.text);
        if (!kv) throw new YamlError(l.n, l.text.indexOf(":") < 0 ? "could not find expected ':'" : "did not find expected key");
        if (seen[kv.key]) throw new YamlError(l.n, "mapping key \"" + kv.key + "\" already defined at line " + seen[kv.key]);
        seen[kv.key] = l.n;
        pos++;
        var v = kv.val.trim();
        if (v === "") {
          var nx = next();
          if (nx && (nx.indent > indent || (nx.indent === indent && /^-(\s|$)/.test(nx.text)))) obj[kv.key] = nx.indent === indent ? seq(indent) : node(nx.indent);
          else obj[kv.key] = null;
        } else if (/^[|>][-+]?$/.test(v)) obj[kv.key] = blockScalar(v, indent, l.n);
        else {
          if (splitKey(v) && !/^["'\[{]/.test(v) && /:\s/.test(v)) throw new YamlError(l.n, "mapping values are not allowed in this context");
          obj[kv.key] = scalar(v, l.n);
          var nx3 = next();
          if (nx3 && nx3.indent > indent) throw new YamlError(nx3.n, "mapping values are not allowed in this context");
        }
      }
      return obj;
    }
    var first = next();
    if (!first) return null;
    if (first.indent > 0) {
      // a document that starts indented is fine as long as it stays consistent
    }
    var docv;
    if (!/^-(\s|$)/.test(first.text) && !splitKey(first.text)) { pos++; docv = scalar(first.text, first.n); }
    else docv = node(first.indent);
    var rest = next();
    if (rest) throw new YamlError(rest.n, rest.indent < first.indent ? "did not find expected key" : "did not find expected <document start>");
    return docv;
  }
  // Parse, returning {value} or {error, line}.
  function tryParse(text) {
    try { return { value: parse(text) }; }
    catch (e) { if (e instanceof YamlError) return { error: e.message, line: e.line }; throw e; }
  }

  /* ---------------- writer (docker compose config, kubectl get -o yaml) */
  function needsQuote(s) {
    return s === "" || /^[\s]|[\s]$/.test(s) || /^[-?:,\[\]{}#&*!|>'"%@`]/.test(s) || /: |\s#/.test(s) || /^(true|false|null|yes|no|on|off|~)$/i.test(s) || /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(s) || /\n/.test(s);
  }
  function str(s) { return needsQuote(s) ? JSON.stringify(s) : s; }
  function dump(v, indent) {
    indent = indent || 0;
    var pad = new Array(indent + 1).join(" ");
    if (v === null || v === undefined) return "null";
    if (Array.isArray(v)) {
      if (!v.length) return "[]";
      return v.map(function (x) {
        if (x && typeof x === "object" && !Array.isArray(x) && Object.keys(x).length) {
          var inner = dump(x, indent + 2).replace(/^ +/, "");
          return pad + "- " + inner;
        }
        return pad + "- " + (typeof x === "object" && x !== null ? dump(x, indent + 2).trim() : scalarOut(x, indent + 2));
      }).join("\n");
    }
    if (typeof v === "object") {
      var keys = Object.keys(v);
      if (!keys.length) return "{}";
      return keys.map(function (k) {
        var x = v[k], key = pad + str(k) + ":";
        if (x && typeof x === "object" && (Array.isArray(x) ? x.length : Object.keys(x).length)) return key + "\n" + dump(x, Array.isArray(x) ? indent + 2 : indent + 2);
        return key + " " + (x && typeof x === "object" ? (Array.isArray(x) ? "[]" : "{}") : scalarOut(x, indent + 2));
      }).join("\n");
    }
    return scalarOut(v, indent);
  }
  function scalarOut(x, indent) {
    if (x === null || x === undefined) return "null";
    if (typeof x !== "string") return String(x);
    if (/\n/.test(x)) { var pad = new Array(indent + 1).join(" "); return "|" + (/\n$/.test(x) ? "" : "-") + "\n" + x.replace(/\n$/, "").split("\n").map(function (l) { return pad + l; }).join("\n"); }
    return str(x);
  }

  var api = { parse: parse, tryParse: tryParse, dump: function (v) { return dump(v, 0) + "\n"; }, YamlError: YamlError };
  root.DevYaml = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
