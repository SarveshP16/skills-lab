/* sudo learn — DevOps Module 3: a simulated Ansible (core 2.17). Inventories (INI, YAML, and the amazon.aws.aws_ec2
   plugin over the simulated AWS account), group_vars/host_vars, ad-hoc `ansible`, `ansible-playbook` with plays,
   roles, handlers, loops, when, register, blocks, tags, --check/--diff/--limit, `ansible-inventory`,
   `ansible-galaxy init` and `ansible-vault`. Hosts are real simulated machines reached over SSH (keys, known
   hosts, sudo), and modules change them through the Linux engine (apt, systemctl, files, users, ufw), so a second
   run of a good playbook reports changed=0. Templates use a Jinja2 subset. */
(function (root) {
  "use strict";
  var S = root.ShEngine, M2 = S.M2, CMDS = S.CMDS, U = S.util, CI = root.CI, G = root.GitCore, IAC = root.IAC, Y = root.DevYaml;
  var out = U.out, errl = U.errl;
  function keys(o) { return o ? Object.keys(o) : []; }
  function clone(o) { return o === undefined ? undefined : JSON.parse(JSON.stringify(o)); }
  var VERSION = "2.17.6";
  function truthy(v) { if (v === true) return true; if (v === false || v == null) return false; if (typeof v === "number") return v !== 0; return /^(yes|true|on|1|y)$/i.test(String(v).trim()); }
  function falsy(v) { return v === false || /^(no|false|off|0|n)$/i.test(String(v).trim()); }

  /* ================================================================== on-prem servers (static machines) */
  var SERVERS = { "web-1": "10.20.1.11", "web-2": "10.20.1.12", "db-1": "10.20.1.21" };
  IAC.SERVERS = SERVERS;
  if (M2.MACHINES && M2.net) keys(SERVERS).forEach(function (n) {
    M2.net.HOSTS[SERVERS[n]] = { ping: 0.41, ports: [22, 80], machine: n };
    M2.MACHINES[n] = { ip: SERVERS[n], setup: function (m) { IAC.prepTarget(m, "ansible", 1001); } };
  });
  // A managed Ubuntu box: a user with passwordless sudo, Python 3
  IAC.prepTarget = function (m, user, uid) {
    var pw = S.readSys(m, "/etc/passwd"); if (pw.indexOf("\n" + user + ":") < 0) S.put(m, "/etc/passwd", pw.replace(/\n?$/, "\n") + user + ":x:" + uid + ":" + uid + "::/home/" + user + ":/bin/bash\n", 420);
    var gr = S.readSys(m, "/etc/group"); if (gr.indexOf("\n" + user + ":") < 0) S.put(m, "/etc/group", gr.replace(/\n?$/, "\n") + user + ":x:" + uid + ":\n", 420);
    var h = S.mkdirs(m, "/home/" + user); h.uid = uid; h.gid = uid; h.mode = 488;
    S.mkdirs(m, "/etc/sudoers.d", 493, 0, 0); S.put(m, "/etc/sudoers.d/90-" + user, user + " ALL=(ALL) NOPASSWD:ALL\n", 288, 0, 0);
    if (!S.readSys(m, "/usr/bin/python3")) S.put(m, "/usr/bin/python3", "\x7fELF python3", 493, 0, 0);
    // a fresh server: no web server yet
    if (m.pkgs && m.pkgs.nginx && m.pkgs.nginx.installed && CI.runScript) CI.runScript(m, "root", "/", {}, "apt-get purge -y -q nginx nginx-common > /dev/null 2>&1; rm -rf /var/www/html /etc/nginx; true", { errexit: false, xtrace: false });
  };

  /* ================================================================== Jinja2 (the subset Ansible people use) */
  var UNDEF = { __undef: true };
  function JErr(msg) { this.message = msg; }
  function jlex(s) {
    var t = [], i = 0;
    while (i < s.length) {
      var c = s.charAt(i), m;
      if (/\s/.test(c)) { i++; continue; }
      if ((m = /^\d+(\.\d+)?/.exec(s.slice(i)))) { t.push({ t: "num", v: +m[0] }); i += m[0].length; continue; }
      if ((m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(s.slice(i)))) { t.push({ t: "id", v: m[0] }); i += m[0].length; continue; }
      if (c === "'" || c === "\"") { var j = i + 1, v = ""; while (j < s.length && s.charAt(j) !== c) { if (s.charAt(j) === "\\") { v += s.charAt(j + 1) === "n" ? "\n" : s.charAt(j + 1); j += 2; continue; } v += s.charAt(j); j++; } t.push({ t: "str", v: v }); i = j + 1; continue; }
      var two = s.substr(i, 2);
      if (["==", "!=", "<=", ">=", "//", "**"].indexOf(two) >= 0) { t.push({ t: two }); i += 2; continue; }
      t.push({ t: c }); i++;
    }
    t.push({ t: "eof" }); return t;
  }
  function jparse(s) {
    var T = jlex(s), p = 0;
    function pk(o) { return T[p + (o || 0)]; } function nx() { return T[p++]; }
    function isId(v) { return pk().t === "id" && pk().v === v; }
    function exp() { var e = orE(); if (isId("if")) { nx(); var c = orE(); var f = null; if (isId("else")) { nx(); f = exp(); } return { k: "cond", t: e, c: c, f: f }; } return e; }
    function orE() { var l = andE(); while (isId("or")) { nx(); l = { k: "or", l: l, r: andE() }; } return l; }
    function andE() { var l = notE(); while (isId("and")) { nx(); l = { k: "and", l: l, r: notE() }; } return l; }
    function notE() { if (isId("not")) { nx(); return { k: "not", x: notE() }; } return cmp(); }
    function cmp() {
      var l = add();
      for (;;) {
        var t = pk().t;
        if (["==", "!=", "<", ">", "<=", ">="].indexOf(t) >= 0) { nx(); l = { k: "cmp", op: t, l: l, r: add() }; continue; }
        if (isId("in")) { nx(); l = { k: "in", l: l, r: add() }; continue; }
        if (isId("not") && pk(1).t === "id" && pk(1).v === "in") { nx(); nx(); l = { k: "not", x: { k: "in", l: l, r: add() } }; continue; }
        if (isId("is")) { nx(); var neg = false; if (isId("not")) { nx(); neg = true; } var tn = nx().v, targ = null; if (pk().t === "(") { nx(); targ = exp(); nx(); } else if (pk().t === "str" || pk().t === "num") targ = { k: "lit", v: nx().v }; l = { k: "test", x: l, n: tn, a: targ, neg: neg }; continue; }
        return l;
      }
    }
    function add() { var l = mul(); for (;;) { var t = pk().t; if (t === "+" || t === "-" || t === "~") { nx(); l = { k: "bin", op: t, l: l, r: mul() }; } else return l; } }
    function mul() { var l = un(); for (;;) { var t = pk().t; if (t === "*" || t === "/" || t === "%" || t === "//") { nx(); l = { k: "bin", op: t, l: l, r: un() }; } else return l; } }
    function un() { if (pk().t === "-") { nx(); return { k: "neg", x: un() }; } return post(prim()); }
    function args() { var a = [], kw = {}; nx(); while (pk().t !== ")") { if (pk().t === "id" && pk(1).t === "=") { var n = nx().v; nx(); kw[n] = exp(); } else a.push(exp()); if (pk().t === ",") nx(); else break; } nx(); return { a: a, kw: kw }; }
    function post(e) {
      for (;;) {
        var t = pk().t;
        if (t === ".") { nx(); e = { k: "get", o: e, a: { k: "lit", v: nx().v } }; continue; }
        if (t === "[") { nx(); var ix = exp(); nx(); e = { k: "get", o: e, a: ix }; continue; }
        if (t === "(") { var ar = args(); e = { k: "call", f: e, a: ar.a, kw: ar.kw }; continue; }
        if (t === "|") { nx(); var fn = nx().v, fa = { a: [], kw: {} }; if (pk().t === "(") fa = args(); e = { k: "filter", x: e, n: fn, a: fa.a, kw: fa.kw }; continue; }
        return e;
      }
    }
    function prim() {
      var tk = nx();
      if (tk.t === "num" || tk.t === "str") return { k: "lit", v: tk.v };
      if (tk.t === "id") { if (tk.v === "true" || tk.v === "True") return { k: "lit", v: true }; if (tk.v === "false" || tk.v === "False") return { k: "lit", v: false }; if (tk.v === "none" || tk.v === "None") return { k: "lit", v: null }; return { k: "var", n: tk.v }; }
      if (tk.t === "(") { var e = exp(); nx(); return e; }
      if (tk.t === "[") { var l = []; while (pk().t !== "]") { l.push(exp()); if (pk().t === ",") nx(); } nx(); return { k: "list", items: l }; }
      if (tk.t === "{") { var d = []; while (pk().t !== "}") { var kk = exp(); nx(); d.push([kk, exp()]); if (pk().t === ",") nx(); } nx(); return { k: "dict", items: d }; }
      throw new JErr("template error while templating string: unexpected '" + (tk.v || tk.t) + "'. String: " + s);
    }
    var e = exp();
    if (pk().t !== "eof") throw new JErr("template error while templating string: expected token 'end of print statement', got '" + (pk().v || pk().t) + "'. String: {{ " + s + " }}");
    return e;
  }
  var FILTERS = {
    "default": function (v, d, b) { return v === UNDEF || (b && !v) ? (d === undefined ? "" : d) : v; }, d: null,
    upper: function (v) { return String(v).toUpperCase(); }, lower: function (v) { return String(v).toLowerCase(); }, capitalize: function (v) { v = String(v); return v.charAt(0).toUpperCase() + v.slice(1).toLowerCase(); },
    trim: function (v) { return String(v).trim(); }, join: function (v, s) { return (v || []).join(s === undefined ? "" : s); }, length: function (v) { return v.length !== undefined ? v.length : keys(v).length; }, count: null,
    int: function (v) { return parseInt(v, 10) || 0; }, float: function (v) { return parseFloat(v) || 0; }, string: function (v) { return v == null ? "None" : typeof v === "object" ? JSON.stringify(v) : String(v); }, bool: function (v) { return truthy(v); },
    first: function (v) { return v[0]; }, last: function (v) { return v[v.length - 1]; }, list: function (v) { return Array.isArray(v) ? v : typeof v === "string" ? v.split("") : keys(v); }, unique: function (v) { return v.filter(function (x, i) { return v.indexOf(x) === i; }); }, sort: function (v) { return v.slice().sort(); },
    replace: function (v, a, b) { return String(v).split(a).join(b); }, regex_replace: function (v, a, b) { return String(v).replace(new RegExp(a, "g"), String(b || "").replace(/\\(\d)/g, "$$$1")); }, regex_search: function (v, a) { var m = new RegExp(a).exec(String(v)); return m ? m[0] : null; },
    to_json: function (v) { return JSON.stringify(v); }, to_nice_json: function (v) { return JSON.stringify(v, null, 4); }, from_json: function (v) { return JSON.parse(v); }, to_yaml: function (v) { return Y.dump(v); }, to_nice_yaml: function (v) { return Y.dump(v); },
    b64encode: function (v) { return typeof btoa === "function" ? btoa(v) : Buffer.from(String(v)).toString("base64"); }, b64decode: function (v) { return typeof atob === "function" ? atob(v) : Buffer.from(String(v), "base64").toString(); },
    quote: function (v) { return "'" + String(v).replace(/'/g, "'\"'\"'") + "'"; }, ternary: function (v, a, b) { return truthy(v) ? a : b; }, mandatory: function (v) { if (v === UNDEF) throw new JErr("Mandatory variable has not been defined."); return v; },
    dict2items: function (v) { return keys(v).map(function (k) { return { key: k, value: v[k] }; }); }, items2dict: function (v) { var o = {}; v.forEach(function (x) { o[x.key] = x.value; }); return o; }, combine: function (a, b) { return Object.assign({}, a, b); },
    map: function (v, attr, a2) { if (attr === "attribute") return v.map(function (x) { return x[a2]; }); return v.map(function (x) { return FILTERS[attr] ? FILTERS[attr](x) : x; }); }, select: function (v) { return v.filter(truthy); }, selectattr: function (v, a, t, val) { return v.filter(function (x) { return t === "equalto" || t === "==" ? x[a] === val : truthy(x[a]); }); }, min: function (v) { return Math.min.apply(null, v); }, max: function (v) { return Math.max.apply(null, v); }, sum: function (v) { return v.reduce(function (a, b) { return a + b; }, 0); },
    password_hash: function (v) { return "$6$" + M2.hashChars("salt" + v, 16, "./abcdefghijklmnopqrstuvwxyz0123456789") + "$" + M2.hashChars("ph" + v, 86, "./ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"); }, hash: function (v) { return M2.hexOf("sha1" + v, 40); }, basename: function (v) { return String(v).split("/").pop(); }, dirname: function (v) { return String(v).replace(/\/[^/]*$/, ""); }, ipaddr: function (v) { return v; }, split: function (v, s) { return String(v).split(s === undefined ? " " : s); }
  };
  FILTERS.d = FILTERS["default"]; FILTERS.count = FILTERS.length;
  function jeval(e, vars, ctx) {
    function v(x) { return jeval(x, vars, ctx); }
    function need(x) { var r = v(x); if (r === UNDEF) throw new JErr("'" + (x.k === "var" ? x.n : x.k === "get" ? descr(x) : "value") + "' is undefined"); return r; }
    switch (e.k) {
      case "lit": return e.v;
      case "var": { if (e.n === "lookup" || e.n === "query" || e.n === "range") return { __fn: e.n }; var r = vars(e.n); return r === undefined ? UNDEF : r; }
      case "get": { var o = v(e.o); if (o === UNDEF) throw new JErr("'" + descr(e.o) + "' is undefined"); var a = v(e.a); if (o == null) return UNDEF; var r2 = o[a]; if (r2 === undefined && Array.isArray(o) && typeof a === "number") r2 = o[a]; return r2 === undefined ? UNDEF : r2; }
      case "list": return e.items.map(need);
      case "dict": { var d = {}; e.items.forEach(function (kv) { d[need(kv[0])] = need(kv[1]); }); return d; }
      case "cond": return truthy(need(e.c)) ? v(e.t) : (e.f ? v(e.f) : "");
      case "or": { var l = v(e.l); return truthy(l === UNDEF ? false : l) ? l : v(e.r); }
      case "and": { var l2 = v(e.l); return !truthy(l2 === UNDEF ? false : l2) ? l2 : v(e.r); }
      case "not": { var x = v(e.x); return !truthy(x === UNDEF ? false : x); }
      case "neg": return -need(e.x);
      case "in": { var h = need(e.r), n = need(e.l); return typeof h === "string" ? h.indexOf(n) >= 0 : Array.isArray(h) ? h.indexOf(n) >= 0 : n in h; }
      case "cmp": { var a2 = need(e.l), b2 = need(e.r); if (typeof a2 === "number" && typeof b2 === "string" && /^\d+(\.\d+)?$/.test(b2)) b2 = +b2; if (typeof b2 === "number" && typeof a2 === "string" && /^\d+(\.\d+)?$/.test(a2)) a2 = +a2; return { "==": JSON.stringify(a2) === JSON.stringify(b2), "!=": JSON.stringify(a2) !== JSON.stringify(b2), "<": a2 < b2, ">": a2 > b2, "<=": a2 <= b2, ">=": a2 >= b2 }[e.op]; }
      case "bin": { var p = need(e.l), q = need(e.r); if (e.op === "~") return String(p) + String(q); if (e.op === "+") { if (Array.isArray(p)) return p.concat(q); return typeof p === "string" || typeof q === "string" ? String(p) + String(q) : p + q; } return { "-": p - q, "*": p * q, "/": p / q, "%": p % q, "//": Math.floor(p / q) }[e.op]; }
      case "test": { var tv = v(e.x), res; var nm = e.n; if (nm === "defined") res = tv !== UNDEF; else if (nm === "undefined") res = tv === UNDEF; else if (nm === "none") res = tv === null; else if (nm === "string") res = typeof tv === "string"; else if (nm === "number") res = typeof tv === "number"; else if (nm === "failed") res = !!(tv && tv.failed); else if (nm === "changed") res = !!(tv && tv.changed); else if (nm === "succeeded" || nm === "success") res = !!(tv && !tv.failed); else if (nm === "skipped") res = !!(tv && tv.skipped); else if (nm === "match" || nm === "search") res = new RegExp(nm === "match" ? "^" + v(e.a) : v(e.a)).test(String(tv)); else if (nm === "in") res = v(e.a).indexOf(tv) >= 0; else if (nm === "truthy") res = truthy(tv); else res = !!tv; return e.neg ? !res : res; }
      case "filter": { var fx = v(e.x); var fn = FILTERS[e.n]; if (!fn) throw new JErr("template error while templating string: No filter named '" + e.n + "'."); if (fx === UNDEF && e.n !== "default" && e.n !== "d" && e.n !== "mandatory") throw new JErr("'" + descr(e.x) + "' is undefined"); var fargs = e.a.map(need); if (e.n === "default" || e.n === "d") return FILTERS["default"](fx, fargs[0], fargs[1]); return fn.apply(null, [fx].concat(fargs)); }
      case "call": {
        var f = v(e.f), ar = e.a.map(need), kw = {}; keys(e.kw).forEach(function (k) { kw[k] = need(e.kw[k]); });
        if (f && f.__fn === "range") { var out2 = []; var lo = ar.length > 1 ? ar[0] : 0, hi = ar.length > 1 ? ar[1] : ar[0]; for (var i = lo; i < hi; i++) out2.push(i); return out2; }
        if (f && (f.__fn === "lookup" || f.__fn === "query")) return lookup(ar, kw, ctx);
        if (e.f.k === "get" && e.f.a.k === "lit") { var obj = v(e.f.o), mn = e.f.a.v; if (typeof obj === "string") { if (mn === "split") return obj.split(ar[0] === undefined ? /\s+/ : ar[0]); if (mn === "upper") return obj.toUpperCase(); if (mn === "lower") return obj.toLowerCase(); if (mn === "strip") return obj.trim(); if (mn === "replace") return obj.split(ar[0]).join(ar[1]); if (mn === "startswith") return obj.indexOf(ar[0]) === 0; if (mn === "endswith") return obj.slice(-ar[0].length) === ar[0]; } if (obj && typeof obj === "object") { if (mn === "keys") return keys(obj); if (mn === "values") return keys(obj).map(function (k) { return obj[k]; }); if (mn === "items") return keys(obj).map(function (k) { return [k, obj[k]]; }); if (mn === "get") return obj[ar[0]] === undefined ? (ar[1] === undefined ? null : ar[1]) : obj[ar[0]]; } }
        throw new JErr("template error: '" + descr(e.f) + "' is not callable");
      }
    }
    throw new JErr("bad jinja node " + e.k);
  }
  function descr(e) { if (e.k === "var") return e.n; if (e.k === "get") return descr(e.o) + "." + (e.a.k === "lit" ? e.a.v : "[]"); return "value"; }
  function lookup(ar, kw, ctx) {
    var kind = String(ar[0]).replace(/^(ansible\.builtin|amazon\.aws|community\.hashi_vault)\./, "");
    if (kind === "env") return ctx && ctx.env ? (ctx.env(ar[1]) || "") : "";
    if (kind === "file") { var t = ctx && ctx.readLocal ? ctx.readLocal(ar[1]) : null; if (t == null) throw new JErr("An unhandled exception occurred while running the lookup plugin 'file'. Error was a <class 'ansible.errors.AnsibleError'>, original message: could not locate file in lookup: " + ar[1]); return t.replace(/\n$/, ""); }
    if (kind === "aws_ssm" || kind === "ssm_parameter") {
      var A = IAC.aws(ctx.sys), p = IAC.find(A, "aws_ssm_parameter", function (x) { return x.name === ar[1]; });
      var id = ctx.identity ? ctx.identity() : IAC.laptopIdentity;
      if (!id || id.error) throw new JErr("An unhandled exception occurred while running the lookup plugin 'amazon.aws.aws_ssm'. Error was a <class 'ansible.errors.AnsibleLookupError'>, original message: Failed to find SSM parameter " + ar[1] + " (Unable to locate credentials)");
      if (!p) { if (kw.on_missing === "skip") return ""; throw new JErr("An unhandled exception occurred while running the lookup plugin 'amazon.aws.aws_ssm'. Error was a <class 'ansible.errors.AnsibleLookupError'>, original message: Failed to find SSM parameter " + ar[1] + " (ResourceNotFound)"); }
      return p.value;
    }
    if (kind === "vault_kv2_get" || kind === "hashi_vault") {
      var mount = kw.engine_mount_point || "secret", path = ar[1];
      if (!IAC.vaultRead) throw new JErr("vault lookup not available");
      var r = IAC.vaultRead(ctx.vaultSess || ctx.localSess, mount, path, kw.token, kw.url);
      if (r.error) throw new JErr("An unhandled exception occurred while running the lookup plugin 'community.hashi_vault.vault_kv2_get'. Error was a <class 'ansible.errors.AnsibleError'>, original message: " + r.error);
      return { secret: r.data, data: { data: r.data, metadata: { version: r.version } }, metadata: { version: r.version } };
    }
    if (kind === "password") return M2.hashChars("pw" + ar[1], 20, "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789");
    throw new JErr("lookup plugin (" + ar[0] + ") not found");
  }
  // render a string: {{ }} expressions, {% %} statements; a string that is exactly one {{ expr }} keeps its type
  function render(str, vars, ctx, opts) {
    if (typeof str !== "string") return str;
    if (str.indexOf("{{") < 0 && str.indexOf("{%") < 0) return str;
    var single = /^\s*\{\{([\s\S]*?)\}\}\s*$/.exec(str);
    if (single && single[1].indexOf("}}") < 0 && !(opts && opts.asText)) { var r = jeval(jparse(single[1]), vars, ctx); if (r === UNDEF) throw new JErr("'" + single[1].trim().split(/[|. \[]/)[0] + "' is undefined"); return r; }
    return renderTpl(str, vars, ctx, opts || {});
  }
  function tplTokens(src, trimBlocks) {
    var re = /(\{\{-?[\s\S]*?-?\}\}|\{%-?[\s\S]*?-?%\}|\{#[\s\S]*?#\})/g, toks = [], last = 0, m;
    while ((m = re.exec(src))) {
      if (m.index > last) toks.push({ t: "text", v: src.slice(last, m.index) });
      var tag = m[0];
      if (/^\{#/.test(tag)) { last = re.lastIndex; if (trimBlocks && src.charAt(last) === "\n") last++; re.lastIndex = last; continue; }
      if (/^\{\{/.test(tag)) toks.push({ t: "expr", v: tag.replace(/^\{\{-?|-?\}\}$/g, ""), lt: /^\{\{-/.test(tag), rt: /-\}\}$/.test(tag) });
      else { toks.push({ t: "stmt", v: tag.replace(/^\{%-?|-?%\}$/g, "").trim(), lt: /^\{%-/.test(tag), rt: /-%\}$/.test(tag) }); if (trimBlocks && src.charAt(re.lastIndex) === "\n") re.lastIndex++; }
      last = re.lastIndex;
    }
    if (last < src.length) toks.push({ t: "text", v: src.slice(last) });
    toks.forEach(function (x, i) { if (x.lt && toks[i - 1] && toks[i - 1].t === "text") toks[i - 1].v = toks[i - 1].v.replace(/\s+$/, ""); if (x.rt && toks[i + 1] && toks[i + 1].t === "text") toks[i + 1].v = toks[i + 1].v.replace(/^\s+/, ""); });
    return toks;
  }
  function renderTpl(src, vars, ctx, opts) {
    var toks = tplTokens(src, opts.trimBlocks), p = 0;
    function block(stop) {
      var nodes = [];
      while (p < toks.length) {
        var t = toks[p];
        if (t.t === "stmt") { var w = t.v.split(/\s+/)[0]; if (stop.indexOf(w) >= 0) return nodes; p++;
          if (w === "for") { var m = /^for\s+(\w+)(?:\s*,\s*(\w+))?\s+in\s+([\s\S]+)$/.exec(t.v); var body = block(["endfor", "else"]); var els = null; if (toks[p] && toks[p].v === "else") { p++; els = block(["endfor"]); } p++; nodes.push({ k: "for", a: m[1], b: m[2], e: jparse(m[3]), body: body, els: els }); continue; }
          if (w === "if") { var branches = [{ c: jparse(t.v.slice(2)), body: block(["elif", "else", "endif"]) }]; while (toks[p] && /^elif\b/.test(toks[p].v)) { var c2 = jparse(toks[p].v.slice(4)); p++; branches.push({ c: c2, body: block(["elif", "else", "endif"]) }); } if (toks[p] && toks[p].v === "else") { p++; branches.push({ c: null, body: block(["endif"]) }); } p++; nodes.push({ k: "if", br: branches }); continue; }
          if (w === "set") { var sm = /^set\s+(\w+)\s*=\s*([\s\S]+)$/.exec(t.v); nodes.push({ k: "set", n: sm[1], e: jparse(sm[2]) }); continue; }
          throw new JErr("template error while templating string: Encountered unknown tag '" + w + "'.");
        }
        p++;
        nodes.push(t.t === "text" ? { k: "text", v: t.v } : { k: "expr", e: jparse(t.v) });
      }
      if (stop.length) throw new JErr("template error while templating string: Unexpected end of template. Jinja was looking for the following tags: '" + stop.join("' or '") + "'.");
      return nodes;
    }
    var tree = block([]);
    var local = {};
    function lv(n) { return n in local ? local[n] : vars(n); }
    function run(nodes) {
      return nodes.map(function (n) {
        if (n.k === "text") return n.v;
        if (n.k === "expr") { var r = jeval(n.e, lv, ctx); if (r === UNDEF) throw new JErr("'" + descr(n.e.k === "filter" ? n.e.x : n.e) + "' is undefined"); return r === null ? "None" : typeof r === "object" ? pyRepr(r) : r === true ? "True" : r === false ? "False" : String(r); }
        if (n.k === "set") { local[n.n] = jeval(n.e, lv, ctx); return ""; }
        if (n.k === "if") { for (var i = 0; i < n.br.length; i++) if (!n.br[i].c || truthy(jeval(n.br[i].c, lv, ctx))) return run(n.br[i].body); return ""; }
        if (n.k === "for") { var coll = jeval(n.e, lv, ctx); if (coll === UNDEF) throw new JErr("'" + descr(n.e) + "' is undefined"); var items = Array.isArray(coll) ? coll : keys(coll || {}).map(function (k) { return n.b ? [k, coll[k]] : k; }); if (!items.length && n.els) return run(n.els); var save = clone(local); var s = items.map(function (it, i) { if (n.b) { local[n.a] = it[0]; local[n.b] = it[1]; } else local[n.a] = it; local.loop = { index: i + 1, index0: i, first: i === 0, last: i === items.length - 1, length: items.length }; return run(n.body); }).join(""); local = save; return s; }
        return "";
      }).join("");
    }
    return run(tree);
  }
  function pyRepr(v) { if (v === null) return "None"; if (v === true) return "True"; if (v === false) return "False"; if (typeof v === "string") return "'" + v + "'"; if (Array.isArray(v)) return "[" + v.map(pyRepr).join(", ") + "]"; if (typeof v === "object") return "{" + keys(v).map(function (k) { return "'" + k + "': " + pyRepr(v[k]); }).join(", ") + "}"; return String(v); }
  IAC.jinja = { render: render, parse: jparse, eval: jeval, UNDEF: UNDEF, JErr: JErr };
  // render recursively through dicts and lists
  function renderDeep(v, vars, ctx) { if (typeof v === "string") return render(v, vars, ctx); if (Array.isArray(v)) return v.map(function (x) { return renderDeep(x, vars, ctx); }); if (v && typeof v === "object") { var o = {}; keys(v).forEach(function (k) { o[k] = renderDeep(v[k], vars, ctx); }); return o; } return v; }

  /* ================================================================== ansible-vault */
  var VHDR = "$ANSIBLE_VAULT;1.1;AES256";
  function vaultStore(sys) { var h = CI.hubOf(sys); return h.ansibleVault = h.ansibleVault || {}; }
  function vaultEncrypt(sys, plain, password) {
    var hex = M2.hexOf("av" + plain + password + keys(vaultStore(sys)).length, Math.max(160, Math.ceil(plain.length * 2.2 / 80) * 80 + 240));
    var body = hex.match(/.{1,80}/g).join("\n");
    vaultStore(sys)[hex.slice(0, 64)] = { plain: plain, password: password };
    return VHDR + "\n" + body + "\n";
  }
  function isVault(t) { return typeof t === "string" && t.replace(/^\s+/, "").indexOf("$ANSIBLE_VAULT;") === 0; }
  function vaultDecrypt(sys, text, password, where) {
    var hex = text.replace(/^\s*\$ANSIBLE_VAULT;[^\n]*\n/, "").replace(/\s+/g, ""), rec = vaultStore(sys)[hex.slice(0, 64)];
    if (password == null) throw new AErr("Attempting to decrypt but no vault secrets found");
    if (!rec || rec.password !== password) throw new AErr("Decryption failed (no vault secrets were found that could decrypt)" + (where ? " on " + where : ""));
    return rec.plain;
  }
  IAC.vaultEncrypt = vaultEncrypt; IAC.vaultDecrypt = vaultDecrypt;
  function AErr(msg) { this.message = msg; }

  /* ================================================================== files and YAML */
  function fsOf(sess) {
    return {
      read: function (p) { var r = S.readFile(sess, p); return r.error ? null : r.content; },
      list: function (d) { var n = root.Dk.fsNode(sess.sys, d); return n && n.type === "d" ? keys(n.children).sort() : null; },
      isDir: function (d) { var n = root.Dk.fsNode(sess.sys, d); return !!n && n.type === "d"; },
      write: function (p, c, mode) { S.mkdirs(sess.sys, p.replace(/\/[^/]*$/, ""), 493, sess.uid, sess.gid); S.put(sess.sys, p, c, mode || 420, sess.uid, sess.gid); }
    };
  }
  function abs(sess, p) { p = String(p).replace(/^~(?=\/|$)/, sess.home); return S.normAbs(p.charAt(0) === "/" ? p : sess.cwd + "/" + p); }
  function yload(text, file, ctx) {
    if (text == null) return null;
    var pre = String(text).replace(/:\s*!vault\s*\|(-?)\s*\n/g, ": |$1\n").replace(/:\s*!unsafe\s+/g, ": ");
    var y = Y.tryParse(pre);
    if (y.error) throw new AErr("We were unable to read either as JSON nor YAML, these are the errors we got from each:\nJSON: Expecting value: line 1 column 1 (char 0)\n\nSyntax Error while loading YAML.\n  " + y.error.replace(/^yaml: line \d+: /, "") + "\n\nThe error appears to be in '" + file + "': line " + (y.line || 1) + ", column 1, but may\nbe elsewhere in the file depending on the exact syntax problem." + (/\{\{/.test(String(text).split("\n")[(y.line || 1) - 1] || "") ? "\n\nWe could be wrong, but this one looks like it might be an issue with\nmissing quotes. Always quote template expression brackets when they\nstart a value. For instance:\n\n    with_items:\n      - {{ foo }}\n\nShould be written as:\n\n    with_items:\n      - \"{{ foo }}\"" : ""));
    return y.value;
  }
  // a vars file (maybe vault-encrypted as a whole, maybe with !vault values)
  function loadVars(ctx, path) {
    var t = ctx.fs.read(path); if (t == null) return null;
    if (isVault(t)) t = vaultDecrypt(ctx.sys, t, ctx.vaultPass(), path.replace(ctx.base + "/", ""));
    var v = yload(t, path, ctx) || {};
    (function dec(o) { keys(o).forEach(function (k) { if (isVault(o[k])) o[k] = vaultDecrypt(ctx.sys, o[k], ctx.vaultPass(), path.replace(ctx.base + "/", "")); else if (o[k] && typeof o[k] === "object") dec(o[k]); }); })(v);
    return v;
  }
  function varsDir(ctx, dir, name) {
    var v = {}, f = ctx.fs, any = false;
    ["", ".yml", ".yaml"].forEach(function (ext) { var p = dir + "/" + name + ext; if (ext && f.read(p) != null) { Object.assign(v, loadVars(ctx, p)); any = true; } });
    if (f.isDir(dir + "/" + name)) (f.list(dir + "/" + name) || []).filter(function (x) { return /\.ya?ml$/.test(x) || !/\./.test(x); }).forEach(function (x) { Object.assign(v, loadVars(ctx, dir + "/" + name + "/" + x)); any = true; });
    return any ? v : null;
  }

  /* ================================================================== configuration and inventory */
  function cfgOf(sess, fs) {
    var cands = [S.getVar(sess, "ANSIBLE_CONFIG"), sess.cwd + "/ansible.cfg", sess.home + "/.ansible.cfg", "/etc/ansible/ansible.cfg"].filter(Boolean), c = { defaults: {}, privilege_escalation: {}, path: null };
    for (var i = 0; i < cands.length; i++) { var t = fs.read(abs(sess, cands[i])); if (t == null) continue; c.path = abs(sess, cands[i]); var sec = null; t.split("\n").forEach(function (l) { var m; l = l.replace(/[;#].*$/, "").trim(); if ((m = /^\[(.+)\]$/.exec(l))) { sec = m[1]; c[sec] = c[sec] || {}; } else if ((m = /^([\w_]+)\s*=\s*(.*)$/.exec(l)) && sec) c[sec][m[1]] = m[2].trim(); }); break; }
    return c;
  }
  function Inv() { this.hosts = {}; this.groups = { all: { hosts: [], children: [], vars: {} }, ungrouped: { hosts: [], children: [], vars: {} } }; this.files = []; }
  Inv.prototype.group = function (g) { return this.groups[g] = this.groups[g] || { hosts: [], children: [], vars: {} }; };
  Inv.prototype.host = function (h, g, vars) { if (!this.hosts[h]) this.hosts[h] = { name: h, vars: {} }; Object.assign(this.hosts[h].vars, vars || {}); if (g) { var gg = this.group(g); if (gg.hosts.indexOf(h) < 0) gg.hosts.push(h); } };
  Inv.prototype.finish = function () {
    var self = this;
    keys(this.groups).forEach(function (g) { if (g !== "all" && g !== "ungrouped" && self.groups.all.children.indexOf(g) < 0 && !keys(self.groups).some(function (p) { return self.groups[p].children.indexOf(g) >= 0; })) self.groups.all.children.push(g); });
    if (self.groups.all.children.indexOf("ungrouped") < 0) self.groups.all.children.unshift("ungrouped");
    keys(this.hosts).forEach(function (h) { if (!keys(self.groups).some(function (g) { return g !== "all" && g !== "ungrouped" && self.groups[g].hosts.indexOf(h) >= 0; })) { if (self.groups.ungrouped.hosts.indexOf(h) < 0) self.groups.ungrouped.hosts.push(h); } });
  };
  Inv.prototype.hostsOf = function (g, seen) { var self = this, gg = this.groups[g]; if (!gg) return []; seen = seen || {}; if (seen[g]) return []; seen[g] = 1; var l = gg.hosts.slice(); gg.children.forEach(function (c) { self.hostsOf(c, seen).forEach(function (h) { if (l.indexOf(h) < 0) l.push(h); }); }); if (g === "all") keys(self.hosts).forEach(function (h) { if (l.indexOf(h) < 0) l.push(h); }); return l; };
  Inv.prototype.groupsOf = function (h) { var self = this; return keys(this.groups).filter(function (g) { return g !== "all" && self.hostsOf(g).indexOf(h) >= 0; }); };
  // "web:&staging:!db" style patterns
  Inv.prototype.match = function (pat) {
    var self = this, res = [];
    String(pat || "all").split(/[:,]/).forEach(function (p, i) {
      if (!p) return; var op = p.charAt(0) === "&" ? "&" : p.charAt(0) === "!" ? "!" : "+", n = op === "+" ? p : p.slice(1);
      var set = n === "all" || n === "*" ? keys(self.hosts) : self.groups[n] ? self.hostsOf(n) : keys(self.hosts).filter(function (h) { return new RegExp("^" + n.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$").test(h); });
      if (op === "+") set.forEach(function (h) { if (res.indexOf(h) < 0) res.push(h); }); else if (op === "&") res = res.filter(function (h) { return set.indexOf(h) >= 0; }); else res = res.filter(function (h) { return set.indexOf(h) < 0; });
    });
    var order = this.hostsOf("all"); return res.sort(function (a, b) { return order.indexOf(a) - order.indexOf(b); });
  };
  function parseInvVal(v) { v = String(v).trim(); if (/^".*"$|^'.*'$/.test(v)) return v.slice(1, -1); if (/^\d+$/.test(v)) return +v; if (/^(true|True)$/.test(v)) return true; if (/^(false|False)$/.test(v)) return false; return v; }
  function kv(line) { var o = {}, re = /([\w.]+)=("[^"]*"|'[^']*'|\S+)/g, m; while ((m = re.exec(line))) o[m[1]] = parseInvVal(m[2]); return o; }
  function loadInventory(ctx, src) {
    var inv = new Inv(), fs = ctx.fs, sess = ctx.sess;
    (Array.isArray(src) ? src : [src]).forEach(function (s0) {
      if (!s0) return;
      if (/,/.test(s0) && fs.read(abs(sess, s0)) == null) { s0.split(",").filter(Boolean).forEach(function (h) { inv.host(h.trim()); }); return; }
      var p = abs(sess, s0), files = fs.isDir(p) ? (fs.list(p) || []).filter(function (f) { return !/^(group_vars|host_vars)$/.test(f) && !/\.(retry|md)$/.test(f); }).map(function (f) { return p + "/" + f; }) : [p];
      files.forEach(function (f) {
        var t = fs.read(f);
        if (t == null) { ctx.warn("Unable to parse " + f + " as an inventory source"); return; }
        inv.files.push(f);
        if (/^\s*plugin:\s*(amazon\.aws\.)?aws_ec2/m.test(t)) { ec2Inventory(ctx, inv, yload(t, f, ctx)); return; }
        if (/\.(ya?ml)$/.test(f) || /^\s*all:\s*$/m.test(t)) { yamlInventory(inv, yload(t, f, ctx)); return; }
        var sec = null, kind = "hosts";
        t.split("\n").forEach(function (l) {
          l = l.replace(/\s[#;].*$|^[#;].*$/, "").trim(); if (!l) return;
          var m = /^\[([^\]:]+)(?::(vars|children))?\]$/.exec(l);
          if (m) { sec = m[1]; kind = m[2] || "hosts"; inv.group(sec); return; }
          if (kind === "vars") { var mm = /^([\w.]+)\s*=\s*(.*)$/.exec(l); if (mm) inv.group(sec).vars[mm[1]] = parseInvVal(mm[2]); return; }
          if (kind === "children") { inv.group(l); if (inv.group(sec).children.indexOf(l) < 0) inv.group(sec).children.push(l); return; }
          var parts = l.split(/\s+/), name = parts[0], rng = /^(.*)\[(\d+):(\d+)\](.*)$/.exec(name);
          if (rng) { for (var i = +rng[2]; i <= +rng[3]; i++) inv.host(rng[1] + i + rng[4], sec, kv(parts.slice(1).join(" "))); }
          else inv.host(name, sec, kv(parts.slice(1).join(" ")));
        });
      });
    });
    inv.finish();
    return inv;
  }
  function yamlInventory(inv, y) {
    (function walk(g, node) {
      if (!node || typeof node !== "object") return;
      inv.group(g);
      keys(node.hosts || {}).forEach(function (h) { inv.host(h, g === "all" ? null : g, node.hosts[h] || {}); });
      Object.assign(inv.group(g).vars, node.vars || {});
      keys(node.children || {}).forEach(function (c) { inv.group(c); if (inv.group(g).children.indexOf(c) < 0 && g !== "all") inv.group(g).children.push(c); walk(c, node.children[c] || {}); });
    })("all", (y && y.all) || y || {});
  }
  function ec2Inventory(ctx, inv, y) {
    var A = IAC.aws(ctx.sys), id = IAC.identityOf(ctx.sess);
    if (!id || id.error) { ctx.warn("Failed to parse " + "aws_ec2.yml" + " with auto plugin: Failed to describe instances: Unable to locate credentials"); return; }
    var list = IAC.all(A, "aws_instance").filter(function (i) { return i.instance_state === "running"; });
    var f = y.filters || {};
    keys(f).forEach(function (k) { var vals = [].concat(f[k]).map(String); list = list.filter(function (i) { var v = /^tag:/.test(k) ? (i.tags || {})[k.slice(4)] : k === "instance-state-name" ? i.instance_state : null; return vals.some(function (p) { return new RegExp("^" + p.replace(/\*/g, ".*") + "$").test(String(v)); }); }); });
    list.forEach(function (i) {
      var hn = (y.hostnames || ["dns-name"]).map(function (h) { var hh = typeof h === "string" ? h : h.name; return hh === "tag:Name" ? (i.tags || {}).Name : hh === "ip-address" || hh === "public-ip-address" ? i.public_ip : hh === "private-ip-address" ? i.private_ip : hh === "instance-id" ? i.id : i.public_dns; }).filter(Boolean)[0] || i.public_dns || i.public_ip;
      var vars = { ansible_host: i.public_ip || i.private_ip, instance_id: i.id, public_ip_address: i.public_ip, private_ip_address: i.private_ip, tags: i.tags || {} };
      if (y.compose) keys(y.compose).forEach(function (k) { try { var r = render("{{ " + y.compose[k] + " }}", function (n) { return vars[n]; }, ctx); vars[k] = r; } catch (e) { /* ignore */ } });
      inv.host(hn, "aws_ec2", vars);
      (y.keyed_groups || []).forEach(function (kg) { var m = /^tags\.(\w+)$/.exec(kg.key || ""); if (!m) return; var v = (i.tags || {})[m[1]]; if (v) inv.host(hn, (kg.prefix ? kg.prefix + (kg.separator == null ? "_" : kg.separator) : "") + String(v).replace(/[^\w]/g, "_")); });
      keys(y.groups || {}).forEach(function (g) { try { if (truthy(render("{{ " + y.groups[g] + " }}", function (n) { return vars[n]; }, ctx))) inv.host(hn, g); } catch (e) { /* ignore */ } });
    });
  }
  IAC.loadInventory = loadInventory;

  /* ================================================================== connections */
  function connect(ctx, h) {
    var hv = ctx.hostvars(h), user = hv.ansible_user || hv.ansible_ssh_user || ctx.cfg.defaults.remote_user || ctx.sess.user, addr = hv.ansible_host || h;
    if (hv.ansible_connection === "local" || addr === "localhost" || addr === "127.0.0.1") return { ok: true, m: ctx.sess.sys, user: ctx.sess.user, local: true };
    var key = hv.ansible_ssh_private_key_file || ctx.cfg.defaults.private_key_file;
    var cli = { batchmode: "yes", connecttimeout: "10" }, buf = [];
    if (key) cli.identityfile = [String(key)];
    if (falsy(ctx.cfg.defaults.host_key_checking) || falsy(S.getVar(ctx.sess, "ANSIBLE_HOST_KEY_CHECKING") || "true")) cli.stricthostkeychecking = "no";
    var io = { out: function (t) { buf.push(t); }, err: function (t) { buf.push(t); }, note: function () {} };
    var c = M2.sshConnect(ctx.sess, user + "@" + addr, cli, io, "ansible");
    if (!c.ok) return { ok: false, msg: "Failed to connect to the host via ssh: " + buf.join("").replace(/\n+$/, "").split("\n").filter(function (l) { return !/^Warning: Permanently added/.test(l); }).join("\n") };
    return { ok: true, m: c.m, user: c.user };
  }
  function hostSession(ctx, h, become, becomeUser) {
    var c = ctx.conns[h];
    var user = become ? (becomeUser || "root") : c.user;
    if (become && !c.local) {
      var sud = (S.readSys(c.m, "/etc/sudoers") || "") + "\n" + ((root.Dk.fsNode(c.m, "/etc/sudoers.d") || { children: {} }).children ? keys(root.Dk.fsNode(c.m, "/etc/sudoers.d").children).map(function (k) { return S.readSys(c.m, "/etc/sudoers.d/" + k) || ""; }).join("\n") : "");
      if (c.user !== "root" && !new RegExp("^" + c.user + "\\s+ALL=\\(ALL(:ALL)?\\)\\s+NOPASSWD:\\s*ALL", "m").test(sud)) return { error: "Missing sudo password" };
    }
    if (c.local && become) user = ctx.sess.user;
    var s = S.newSession(c.m, { user: user });
    s.cwd = s.home || "/";
    return { sess: s };
  }
  function sh(hs, cmd) {
    var buf = [], ebuf = [], io = { stdin: "", tty: false, out: function (t) { buf.push(t); }, err: function (t) { ebuf.push(t); }, note: function () {}, color: function (t) { buf.push(t); } };
    var code;
    hs.sess.vars = hs.sess.vars || {}; hs.sess.vars.PATH = { v: "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin", x: true };
    try { code = S.runSource(hs.sess, cmd, io); } catch (e) { if (e instanceof S.ExitSignal) code = e.code; else if (e instanceof S.ShError) { ebuf.push(e.message + "\n"); code = e.code || 1; } else throw e; }
    return { rc: code || 0, stdout: buf.join("").replace(/\n$/, ""), stderr: ebuf.join("").replace(/\n$/, "") };
  }

  /* ================================================================== modules */
  function MFail(msg, extra) { this.msg = msg; this.extra = extra || {}; }
  function fsNode(m, p) { return root.Dk.fsNode(m, p); }
  function modeStr(n) { return ("0000" + (n.mode & 4095).toString(8)).slice(-4); }
  function ownerName(m, uid) { var l = (S.readSys(m, "/etc/passwd") || "").split("\n").filter(function (x) { return +x.split(":")[2] === uid; })[0]; return l ? l.split(":")[0] : String(uid); }
  function groupName(m, gid) { var l = (S.readSys(m, "/etc/group") || "").split("\n").filter(function (x) { return +x.split(":")[2] === gid; })[0]; return l ? l.split(":")[0] : String(gid); }
  function uidOf(m, n) { if (/^\d+$/.test(String(n))) return +n; var l = (S.readSys(m, "/etc/passwd") || "").split("\n").filter(function (x) { return x.split(":")[0] === String(n); })[0]; return l ? +l.split(":")[2] : null; }
  function gidOf(m, n) { if (/^\d+$/.test(String(n))) return +n; var l = (S.readSys(m, "/etc/group") || "").split("\n").filter(function (x) { return x.split(":")[0] === String(n); })[0]; return l ? +l.split(":")[2] : null; }
  function parseMode(v) { if (v == null) return null; if (typeof v === "number") return v > 511 || v.toString(8).length < 4 && v > 7 && v === parseInt(String(v), 10) && /^[0-7]+$/.test(String(v)) && v > 99 ? parseInt(String(v), 8) : v; var s = String(v); if (/^0?[0-7]{3,4}$/.test(s)) return parseInt(s, 8); return null; }
  // apply owner/group/mode to a node; returns changed
  function attrs(hs, path, a, check) {
    var m = hs.sess.sys, n = fsNode(m, path), ch = false; if (!n) return false;
    if (a.mode != null) { var md = typeof a.mode === "number" ? (a.mode <= 511 && /^[0-7]{3}$/.test(String(a.mode)) ? parseInt(String(a.mode), 8) : a.mode) : parseMode(a.mode); if (md == null) throw new MFail("mode must be in octal or symbolic form"); if ((n.mode & 4095) !== md) { ch = true; if (!check) n.mode = (n.mode & ~4095) | md; } }
    if (a.owner != null) { var u = uidOf(m, a.owner); if (u == null) throw new MFail("chown failed: failed to look up user " + a.owner); if (n.uid !== u) { ch = true; if (!check) n.uid = u; } }
    if (a.group != null) { var g = gidOf(m, a.group); if (g == null) throw new MFail("chgrp failed: failed to look up group " + a.group); if (n.gid !== g) { ch = true; if (!check) n.gid = g; } }
    return ch;
  }
  function needRoot(hs, path, what) { var m = hs.sess.sys, dir = path.replace(/\/[^/]*$/, "") || "/", dn = fsNode(m, dir); if (hs.sess.uid !== 0 && dn && dn.uid !== hs.sess.uid && !(dn.mode & 2)) throw new MFail("Destination " + dir + " not writable"); }
  function writeContent(hs, ctx, path, content, a, check, diffSrc) {
    var m = hs.sess.sys, n = fsNode(m, path), before = n && n.type === "f" ? String(n.content) : null;
    if (n && n.type === "d") throw new MFail("Destination " + path + " is a directory");
    var dir = path.replace(/\/[^/]*$/, "") || "/";
    if (!fsNode(m, dir)) throw new MFail("Destination directory " + dir + " does not exist");
    var changed = before !== content, diff = null;
    if (changed) { needRoot(hs, path); diff = { before: before || "", after: content, beforeHeader: before == null ? path : path, afterHeader: diffSrc || "dynamically generated" }; if (!check) S.put(m, path, content, n ? n.mode : (hs.sess.uid === 0 ? 420 : 436), n ? n.uid : hs.sess.uid, n ? n.gid : hs.sess.gid); }
    var ach = attrs(hs, path, a, check) && !check;
    if (check && !fsNode(m, path)) ach = !!(a.mode || a.owner || a.group);
    return { changed: changed || ach || (check && attrs(hs, path, a, true)), diff: diff, dest: path };
  }
  function bool(v) { return truthy(v); }
  var MOD = {};
  MOD.ping = function () { return { changed: false, ping: "pong" }; };
  MOD.debug = function (a, ctx, hs, t) { if (a.var !== undefined) { var o = {}; var v; try { v = render("{{ " + a.var + " }}", t.vars, ctx); } catch (e) { v = "VARIABLE IS NOT DEFINED!"; } o[a.var] = v; return Object.assign({ changed: false, __debug: true }, o); } return { changed: false, msg: a.msg === undefined ? "Hello world!" : a.msg, __debug: true }; };
  MOD.set_fact = function (a, ctx, hs, t) { keys(a).forEach(function (k) { if (k !== "cacheable") t.facts[k] = a[k]; }); return { changed: false, ansible_facts: a }; };
  MOD.assert = function (a, ctx, hs, t) { var that = [].concat(a.that || []); for (var i = 0; i < that.length; i++) { var ok = typeof that[i] === "boolean" ? that[i] : truthy(render("{{ " + that[i] + " }}", t.vars, ctx)); if (!ok) throw new MFail(a.fail_msg || a.msg || "Assertion failed", { assertion: that[i], evaluated_to: false }); } return { changed: false, msg: a.success_msg || "All assertions passed" }; };
  MOD.fail = function (a) { throw new MFail(a.msg || "Failed as requested from task"); };
  MOD.command = function (a, ctx, hs, t, check) {
    var cmd = a._raw_params || a.cmd || (a.argv ? a.argv.join(" ") : "");
    if (!cmd) throw new MFail("no command given");
    if (a.creates && fsNode(hs.sess.sys, a.creates)) return { changed: false, cmd: cmd, rc: 0, stdout: "skipped, since " + a.creates + " exists", msg: "Did not run command since '" + a.creates + "' exists" };
    if (a.removes && !fsNode(hs.sess.sys, a.removes)) return { changed: false, cmd: cmd, rc: 0, msg: "Did not run command since '" + a.removes + "' does not exist" };
    if (check) return { changed: true, skipped: false, msg: "Command would have run if not in check mode", __checkskip: true };
    if (a.chdir) hs.sess.cwd = a.chdir;
    if (t.module === "command" && /[|><;&]|\$\(/.test(cmd) && !/^\S+$/.test(cmd)) { var r0 = sh(hs, cmd.split(/\s*[|;&]\s*/)[0]); return { changed: true, cmd: cmd, rc: r0.rc, stdout: r0.stdout, stderr: r0.stderr }; }
    var r = sh(hs, cmd);
    var res = { changed: true, cmd: cmd, rc: r.rc, stdout: r.stdout, stderr: r.stderr, stdout_lines: r.stdout ? r.stdout.split("\n") : [], stderr_lines: r.stderr ? r.stderr.split("\n") : [] };
    if (r.rc !== 0) throw new MFail("non-zero return code", res);
    return res;
  };
  MOD.shell = MOD.command;
  MOD.raw = MOD.command;
  function pkgInstalled(hs, name) { var p = hs.sess.sys.pkgs && hs.sess.sys.pkgs[name]; return !!(p && p.installed); }
  MOD.apt = function (a, ctx, hs, t, check) {
    var names = [].concat(a.name || a.pkg || a.package || []).map(String), state = a.state || "present", changed = false, out2 = [];
    if (hs.sess.uid !== 0 && (names.length || a.update_cache)) throw new MFail("This command has to be run under the root user.");
    if (bool(a.update_cache)) { if (!check) { sh(hs, "apt-get update -q"); } if (!names.length) changed = !a.cache_valid_time; }
    if (state === "present" || state === "latest" || state === "installed") {
      var todo = names.filter(function (n) { return !pkgInstalled(hs, n); });
      var unknown = todo.filter(function (n) { return !(hs.sess.sys.pkgs || {})[n]; });
      if (unknown.length) throw new MFail("No package matching '" + unknown[0] + "' is available");
      if (todo.length) { changed = true; if (!check) { var r = sh(hs, "DEBIAN_FRONTEND=noninteractive apt-get install -y " + todo.join(" ")); out2.push(r.stdout); if (r.rc) throw new MFail("'/usr/bin/apt-get -y -o \"Dpkg::Options::=--force-confdef\" -o \"Dpkg::Options::=--force-confold\"      install " + todo.join(" ") + "' failed: " + r.stderr, { rc: r.rc }); } }
    } else if (state === "absent") {
      var rm = names.filter(function (n) { return pkgInstalled(hs, n); });
      if (rm.length) { changed = true; if (!check) sh(hs, "apt-get remove -y " + rm.join(" ")); }
    }
    return { changed: changed, cache_updated: bool(a.update_cache), stdout: out2.join("\n") };
  };
  MOD.package = MOD.apt;
  function unitName(n) { return /\.\w+$/.test(n) ? n : n + ".service"; }
  MOD.service = function (a, ctx, hs, t, check) {
    var name = a.name, m = hs.sess.sys, stx = name ? sh(hs, "systemctl status " + name) : null, u = !!stx && !/could not be found/.test(stx.stdout + stx.stderr);
    if (!name) throw new MFail("missing required arguments: name");
    if (!u) throw new MFail("Could not find the requested service " + name + ": host");
    if (hs.sess.uid !== 0 && (a.state || a.enabled !== undefined)) throw new MFail("Unable to start service " + name + ": Failed to start " + unitName(name) + ": Interactive authentication required.");
    var changed = false, active = sh(hs, "systemctl is-active " + name).stdout.trim() === "active", enabled = sh(hs, "systemctl is-enabled " + name).stdout.trim() === "enabled";
    if (bool(a.daemon_reload) && !check) sh(hs, "systemctl daemon-reload");
    var st = a.state;
    if (st === "started" && !active) { changed = true; if (!check) { var r = sh(hs, "systemctl start " + name); if (r.rc) throw new MFail("Unable to start service " + name + ": Job for " + unitName(name) + " failed because the control process exited with error code.\nSee \"systemctl status " + unitName(name) + "\" and \"journalctl -xeu " + unitName(name) + "\" for details.\n"); } }
    if (st === "stopped" && active) { changed = true; if (!check) sh(hs, "systemctl stop " + name); }
    if (st === "restarted") { changed = true; if (!check) { var r2 = sh(hs, "systemctl restart " + name); if (r2.rc) throw new MFail("Unable to restart service " + name + ": Job for " + unitName(name) + " failed because the control process exited with error code.\nSee \"systemctl status " + unitName(name) + "\" and \"journalctl -xeu " + unitName(name) + "\" for details.\n"); } }
    if (st === "reloaded") { changed = true; if (!check) { var r3 = sh(hs, "systemctl reload " + name); if (r3.rc) throw new MFail("Unable to reload service " + name + ": Job for " + unitName(name) + " failed.\nSee \"systemctl status " + unitName(name) + "\" and \"journalctl -xeu " + unitName(name) + "\" for details.\n"); } }
    if (a.enabled !== undefined) { var want = bool(a.enabled); if (want !== enabled) { changed = true; if (!check) sh(hs, "systemctl " + (want ? "enable" : "disable") + " " + name); } }
    return { changed: changed, name: name, state: st === "stopped" ? "stopped" : "started", enabled: a.enabled !== undefined ? bool(a.enabled) : enabled };
  };
  MOD.systemd = MOD.service; MOD.systemd_service = MOD.service;
  function srcPath(ctx, t, kind, src) { if (src.charAt(0) === "/") return src; var cands = []; if (t.role) cands.push(t.role.dir + "/" + kind + "/" + src, t.role.dir + "/" + src); cands.push(t.playDir + "/" + kind + "/" + src, t.playDir + "/" + src); for (var i = 0; i < cands.length; i++) if (ctx.fs.read(cands[i]) != null) return cands[i]; return null; }
  MOD.copy = function (a, ctx, hs, t, check) {
    if (!a.dest) throw new MFail("missing required arguments: dest");
    var content;
    if (a.content !== undefined) content = String(a.content);
    else { if (!a.src) throw new MFail("src (or content) is required"); var sp = srcPath(ctx, t, "files", a.src); if (!sp) throw new MFail("Could not find or access '" + a.src + "'\nSearched in:\n\t" + (t.role ? t.role.dir + "/files/" + a.src + "\n\t" : "") + t.playDir + "/files/" + a.src + "\n\t" + t.playDir + "/" + a.src + " on the Ansible Controller.\nIf you are using a module and expect the file to exist on the remote, see the remote_src option"); content = ctx.fs.read(sp); if (isVault(content)) content = vaultDecrypt(ctx.sys, content, ctx.vaultPass(), a.src); }
    var dest = /\/$/.test(a.dest) || (fsNode(hs.sess.sys, a.dest) || {}).type === "d" ? a.dest.replace(/\/?$/, "/") + String(a.src || "file").split("/").pop() : a.dest;
    var r = writeContent(hs, ctx, dest, content, a, check, a.src ? a.src : "dynamically generated");
    return { changed: r.changed, dest: dest, __diff: r.diff };
  };
  MOD.template = function (a, ctx, hs, t, check) {
    if (!a.src || !a.dest) throw new MFail("missing required arguments: " + (!a.src ? "src" : "dest"));
    var sp = srcPath(ctx, t, "templates", a.src);
    if (!sp) throw new MFail("Could not find or access '" + a.src + "'\nSearched in:\n\t" + (t.role ? t.role.dir + "/templates/" + a.src + "\n\t" : "") + t.playDir + "/templates/" + a.src + "\n\t" + t.playDir + "/" + a.src + " on the Ansible Controller.\nIf you are using a module and expect the file to exist on the remote, see the remote_src option");
    var src = ctx.fs.read(sp), content;
    try { content = render(src, t.vars, ctx, { asText: true, trimBlocks: true }); } catch (e) { if (e instanceof JErr) throw new MFail("AnsibleUndefinedVariable: " + e.message + ". " + e.message); throw e; }
    if (a.validate) { var tmp = "/tmp/ansible.tmp." + M2.hexOf("tpl" + a.dest, 8); S.put(hs.sess.sys, tmp, content, 420, 0, 0); var vr = sh(hs, String(a.validate).replace(/%s/g, tmp)); if (vr.rc) throw new MFail("failed to validate", { exit_status: vr.rc, stderr: vr.stderr, stdout: vr.stdout }); }
    var r = writeContent(hs, ctx, a.dest, content, a, check, a.src);
    return { changed: r.changed, dest: a.dest, __diff: r.diff };
  };
  MOD.file = function (a, ctx, hs, t, check) {
    var p = a.path || a.dest || a.name; if (!p) throw new MFail("missing required arguments: path");
    var m = hs.sess.sys, n = fsNode(m, p), st = a.state || (n ? (n.type === "d" ? "directory" : "file") : "file"), changed = false;
    if (st === "directory") { if (!n) { changed = true; if (!check) { var mode = a.mode != null ? (parseMode(a.mode) || 493) : 493; S.mkdirs(m, p, mode, hs.sess.uid, hs.sess.gid); } } else if (n.type !== "d") throw new MFail("There was an issue creating " + p + " as requested: [Errno 17] File exists: b'" + p + "'"); }
    else if (st === "absent") { if (n) { changed = true; if (!check) { var pd = fsNode(m, p.replace(/\/[^/]*$/, "") || "/"); delete pd.children[p.split("/").pop()]; } } return { changed: changed, path: p, state: "absent" }; }
    else if (st === "touch") { changed = true; if (!n && !check) S.put(m, p, "", 420, hs.sess.uid, hs.sess.gid); }
    else if (st === "link") { if (!n || n.type !== "l" || n.target !== a.src) { changed = true; if (!check) sh(hs, "ln -sfn " + a.src + " " + p); } return { changed: changed, dest: p, src: a.src, state: "link" }; }
    else if (st === "file" && !n) throw new MFail("file (" + p + ") is absent, cannot continue", { path: p, state: "absent" });
    if (attrs(hs, p, a, check)) changed = true;
    var nn = fsNode(m, p);
    return { changed: changed, path: p, state: st, mode: nn ? modeStr(nn) : undefined, owner: nn ? ownerName(m, nn.uid) : undefined };
  };
  MOD.lineinfile = function (a, ctx, hs, t, check) {
    var p = a.path || a.dest, m = hs.sess.sys, n = fsNode(m, p);
    if (!n) { if (!bool(a.create)) throw new MFail("Destination " + p + " does not exist !", { rc: 257 }); }
    var text = n ? String(n.content) : "", lines = text === "" ? [] : text.replace(/\n$/, "").split("\n"), state = a.state || "present", re = a.regexp ? new RegExp(a.regexp) : null, changed = false, msg = "";
    if (state === "present") {
      if (a.line === undefined) throw new MFail("line is required with state=present");
      var idx = -1; lines.forEach(function (l, i) { if ((re && re.test(l)) || (!re && l === a.line)) idx = i; });
      if (idx >= 0) { if (lines[idx] !== a.line) { lines[idx] = a.line; changed = true; msg = "line replaced"; } }
      else { if (a.insertbefore === "BOF") lines.unshift(a.line); else lines.push(a.line); changed = true; msg = "line added"; }
    } else { var before = lines.length; lines = lines.filter(function (l) { return !(re ? re.test(l) : l === a.line); }); if (lines.length !== before) { changed = true; msg = (before - lines.length) + " line(s) removed"; } }
    var newText = lines.join("\n") + (lines.length ? "\n" : "");
    var r = changed ? writeContent(hs, ctx, p, newText, a, check, p) : { changed: attrs(hs, p, a, check), diff: null };
    return { changed: changed || r.changed, msg: msg, backup: "", __diff: r.diff };
  };
  MOD.user = function (a, ctx, hs, t, check) {
    var name = a.name, m = hs.sess.sys, exists = uidOf(m, name) != null, changed = false, state = a.state || "present";
    if (hs.sess.uid !== 0) throw new MFail("useradd: Permission denied.\nuseradd: cannot lock /etc/passwd; try again later.\n");
    if (state === "absent") { if (exists) { changed = true; if (!check) sh(hs, "userdel " + (bool(a.remove) ? "-r " : "") + name); } return { changed: changed, name: name, state: "absent" }; }
    if (!exists) { changed = true; if (!check) { var r = sh(hs, "useradd " + (a.create_home === false || bool(a.system) ? "" : "-m ") + (bool(a.system) ? "-r " : "") + "-s " + (a.shell || "/bin/bash") + " " + name); if (r.rc) throw new MFail(r.stderr); } }
    if (a.groups) { var want = [].concat(a.groups).join(",").split(",").map(function (x) { return x.trim(); }).filter(Boolean); var cur = (S.readSys(m, "/etc/group") || "").split("\n").filter(function (l) { var f = l.split(":"); return f[3] && f[3].split(",").indexOf(name) >= 0; }).map(function (l) { return l.split(":")[0]; }); var missing = want.filter(function (g) { return cur.indexOf(g) < 0; }); var unknown = want.filter(function (g) { return gidOf(m, g) == null; }); if (unknown.length) throw new MFail("Group " + unknown[0] + " does not exist"); if (missing.length || (!bool(a.append) && cur.some(function (g) { return want.indexOf(g) < 0; }))) { changed = true; if (!check) sh(hs, "usermod " + (bool(a.append) ? "-aG " : "-G ") + want.join(",") + " " + name); } }
    if (a.shell && exists) { var line = (S.readSys(m, "/etc/passwd") || "").split("\n").filter(function (l) { return l.split(":")[0] === name; })[0]; if (line && line.split(":")[6] !== a.shell) { changed = true; if (!check) sh(hs, "usermod -s " + a.shell + " " + name); } }
    return { changed: changed, name: name, state: "present", uid: uidOf(m, name) };
  };
  MOD.group = function (a, ctx, hs, t, check) { var m = hs.sess.sys, ex = gidOf(m, a.name) != null, ch = false; if ((a.state || "present") === "present" && !ex) { ch = true; if (!check) sh(hs, "groupadd " + (bool(a.system) ? "-r " : "") + a.name); } if (a.state === "absent" && ex) { ch = true; if (!check) sh(hs, "groupdel " + a.name); } return { changed: ch, name: a.name, state: a.state || "present" }; };
  MOD.ufw = function (a, ctx, hs, t, check) {
    if (hs.sess.uid !== 0) throw new MFail("ERROR: You need to be root to run this script");
    var m = hs.sess.sys, f = function () { return m.ufw || { enabled: false, def: { incoming: "deny", outgoing: "allow" }, rules: [] }; }, changed = false;
    if (a.policy) { var dir = a.direction || "incoming"; if (f().def[dir] !== a.policy) { changed = true; if (!check) sh(hs, "ufw default " + a.policy + " " + dir); } }
    if (a.rule) {
      var port = a.port || a.to_port, from = a.from_ip || a.src;
      var spec = from && from !== "any" ? a.rule + " from " + from + " to any port " + port + (a.proto && a.proto !== "any" ? " proto " + a.proto : "") : a.rule + " " + port + (a.proto && a.proto !== "any" ? "/" + a.proto : "");
      if (a.delete) spec = "delete " + spec;
      if (check) { var have = f().rules.some(function (x) { return String(x.port) === String(port) && JSON.stringify(x).indexOf(a.rule) >= 0 && (!from || from === "any" || x.from === from); }); if (!have || a.delete) changed = true; }
      else { var r = sh(hs, "ufw " + spec); if (r.rc) throw new MFail(r.stderr || r.stdout); if (/Rule added|Rules updated|Rule inserted|Rule deleted/.test(r.stdout)) changed = true; }
    }
    if (a.state === "enabled" && !f().enabled) { changed = true; if (!check) sh(hs, "ufw --force enable"); }
    if (a.state === "disabled" && f().enabled) { changed = true; if (!check) sh(hs, "ufw disable"); }
    if (a.state === "reloaded") { changed = true; if (!check) sh(hs, "ufw reload"); }
    return { changed: changed, commands: [] };
  };
  MOD.stat = function (a, ctx, hs) { var n = fsNode(hs.sess.sys, a.path); return { changed: false, stat: n ? { exists: true, isdir: n.type === "d", isreg: n.type === "f", mode: modeStr(n), pw_name: ownerName(hs.sess.sys, n.uid), size: n.type === "f" ? String(n.content).length : 4096 } : { exists: false } }; };
  MOD.uri = function (a, ctx, hs) { var r = sh(hs, "curl -s -o /dev/null -w '%{http_code}' " + a.url), code = +r.stdout || -1, want = [].concat(a.status_code || 200).map(Number); var res = { changed: false, status: code, url: a.url, msg: code > 0 ? "OK (unknown bytes)" : "Status code was -1 and not [" + want.join(", ") + "]: Request failed: <urlopen error [Errno 111] Connection refused>" }; if (want.indexOf(code) < 0) throw new MFail(code > 0 ? "Status code was " + code + " and not [" + want.join(", ") + "]: HTTP Error " + code : res.msg, res); return res; };
  MOD.wait_for = function (a, ctx, hs) { var r = sh(hs, "ss -ltn"); if (a.port && !new RegExp(":" + a.port + "\\s").test(r.stdout)) throw new MFail("Timeout when waiting for 127.0.0.1:" + a.port, { elapsed: +(a.timeout || 300) }); return { changed: false, elapsed: 0, port: a.port, state: "started" }; };
  MOD.meta = function () { return { changed: false, skipped: true }; };
  var ALIAS = {}; keys(MOD).forEach(function (k) { ALIAS["ansible.builtin." + k] = k; ALIAS[k] = k; }); ALIAS["community.general.ufw"] = "ufw"; ALIAS["ansible.posix.ufw"] = "ufw"; ALIAS["ansible.builtin.systemd_service"] = "systemd_service";
  IAC.ANSIBLE_MODULES = ALIAS;
  var TASK_KEYS = ["name", "when", "loop", "with_items", "with_list", "with_dict", "loop_control", "register", "notify", "become", "become_user", "changed_when", "failed_when", "ignore_errors", "tags", "vars", "no_log", "check_mode", "diff", "args", "block", "rescue", "always", "include_tasks", "import_tasks", "include_role", "import_role", "listen", "delegate_to", "run_once", "environment", "until", "retries", "delay", "throttle", "any_errors_fatal"];
  IAC.ANSIBLE_TASK_KEYS = TASK_KEYS;
  function parseFree(s) { var o = {}, rest = [], re = /(\w+)=("[^"]*"|'[^']*'|\S+)|(\S+)/g, m; while ((m = re.exec(s))) { if (m[1]) o[m[1]] = parseInvVal(m[2]); else rest.push(m[3]); } if (rest.length) o._raw_params = rest.join(" "); return o; }

  /* ================================================================== the runner */
  function Ctx(sess, io, o) {
    var self = this;
    this.sess = sess; this.sys = sess.sys; this.io = io; this.fs = fsOf(sess); this.o = o || {};
    this.cfg = cfgOf(sess, this.fs); this.warnings = [];
    this.facts = {}; this.conns = {}; this.stats = {}; this.base = sess.cwd;
    this.extra = o.extra || {};
    this.vaultPass = function () {
      if (self._vp !== undefined) return self._vp;
      var f = o.vaultFile || self.cfg.defaults.vault_password_file || S.getVar(sess, "ANSIBLE_VAULT_PASSWORD_FILE");
      if (f) { var t = self.fs.read(abs(sess, f)); if (t == null) throw new AErr("The vault password file " + abs(sess, f) + " was not found"); self._vp = t.replace(/\n$/, ""); }
      else self._vp = null;
      return self._vp;
    };
    this.warn = function (m) { self.warnings.push(m); };
    this.env = function (k) { return S.getVar(sess, k); };
    this.readLocal = function (p) { return self.fs.read(abs(sess, p)); };
    this.identity = function () { return IAC.identityOf(sess); };
    this.localSess = sess;
  }
  Ctx.prototype.hostvars = function (h) {
    if (this._hv && this._hv[h]) return this._hv[h];
    var inv = this.inv, self = this, v = {};
    var invDir = inv.files[0] ? inv.files[0].replace(/\/[^/]*$/, "") : this.base;
    var dirs = dedupe([invDir, this.playDir || this.base]);
    var chain = ["all"].concat(inv.groupsOf(h).sort(function (a, b) { return depth(inv, a) - depth(inv, b) || (a < b ? -1 : 1); }));
    chain.forEach(function (g) { Object.assign(v, inv.groups[g] ? inv.groups[g].vars : {}); dirs.forEach(function (d) { var gv = varsDir(self, d + "/group_vars", g); if (gv) Object.assign(v, gv); }); });
    Object.assign(v, inv.hosts[h] ? inv.hosts[h].vars : {});
    dirs.forEach(function (d) { var hv = varsDir(self, d + "/host_vars", h); if (hv) Object.assign(v, hv); });
    (this._hv = this._hv || {})[h] = v;
    return v;
  };
  function depth(inv, g) { var d = 0; keys(inv.groups).forEach(function (p) { if (inv.groups[p].children.indexOf(g) >= 0) d = Math.max(d, 1 + depth(inv, p)); }); return d; }
  function dedupe(l) { return l.filter(function (x, i) { return l.indexOf(x) === i; }); }
  function banner(t) { return t + " " + new Array(Math.max(3, 80 - t.length)).join("*"); }
  function facts(ctx, h, m) {
    var ip = m.ip || "10.20.1.10";
    return { ansible_hostname: m.host, ansible_fqdn: m.host, ansible_nodename: m.host, ansible_distribution: "Ubuntu", ansible_distribution_version: "24.04", ansible_distribution_release: "noble", ansible_os_family: "Debian", ansible_default_ipv4: { address: ip, interface: "eth0" }, ansible_processor_vcpus: 2, ansible_memtotal_mb: 3911, ansible_python_version: "3.12.3", ansible_architecture: "x86_64", ansible_kernel: "6.8.0-48-generic" };
  }
  // Run a list of tasks for the hosts still alive. tasks: parsed task objects
  function runTasks(ctx, play, tasks, hosts, role, handlersMode) {
    var io = ctx.io;
    for (var ti = 0; ti < tasks.length; ti++) {
      var task = tasks[ti];
      if (task.block) { runBlock(ctx, play, task, hosts, role); continue; }
      if (task.include_tasks || task.import_tasks) { var inc = task.include_tasks || task.import_tasks; var p = (role ? role.dir + "/tasks/" : ctx.playDir + "/") + String(inc).replace(/^\.\//, ""); var tl = yload(ctx.fs.read(p), p, ctx); if (tl == null) { taskFail(ctx, hosts, "Could not find or access '" + inc + "'"); continue; } runTasks(ctx, play, tl || [], hosts, role); continue; }
      if (task.include_role || task.import_role) { var rn = (task.include_role || task.import_role).name; runRole(ctx, play, { role: rn }, hosts); continue; }
      var mod = keys(task).filter(function (k) { return TASK_KEYS.indexOf(k) < 0; });
      var modName = mod.filter(function (k) { return ALIAS[k]; })[0] || mod[0];
      if (!modName) { taskFail(ctx, hosts, "no module/action detected in task."); continue; }
      if (!ALIAS[modName]) { throw new AErr("couldn't resolve module/action '" + modName + "'. This often indicates a misspelling, missing collection, or incorrect module path.\n\nThe error appears to be in '" + (role ? role.dir + "/tasks/main.yml" : ctx.playFile) + "': line " + (task.__line || 1) + ", column 3, but may\nbe elsewhere in the file depending on the exact syntax problem.\n\nThe offending line appears to be:\n\n\n- name: " + (task.name || "") + "\n  ^ here"); }
      if (mod.filter(function (k) { return ALIAS[k]; }).length > 1) throw new AErr("conflicting action statements: " + mod.filter(function (k) { return ALIAS[k]; }).join(", "));
      var tags = [].concat(task.tags || [], role && role.tags ? role.tags : [], play.tags ? [].concat(play.tags) : []);
      if (ctx.o.tags && ctx.o.tags.length && !tags.some(function (t) { return ctx.o.tags.indexOf(t) >= 0; }) && tags.indexOf("always") < 0) continue;
      if (ctx.o.skipTags && tags.some(function (t) { return ctx.o.skipTags.indexOf(t) >= 0; })) continue;
      runOne(ctx, play, task, ALIAS[modName], modName, hosts, role, handlersMode);
    }
  }
  function runBlock(ctx, play, task, hosts, role) {
    var failedBefore = {}; hosts.forEach(function (h) { failedBefore[h] = ctx.stats[h].failed; });
    var merged = function (list) { return (list || []).map(function (t) { var o = Object.assign({}, t); ["become", "become_user", "when", "tags", "ignore_errors", "vars"].forEach(function (k) { if (task[k] !== undefined && o[k] === undefined) o[k] = task[k]; else if (k === "when" && task.when !== undefined) o.when = [].concat(task.when, o.when); }); return o; }); };
    ctx.inBlock = (ctx.inBlock || 0) + 1;
    runTasks(ctx, play, merged(task.block), hosts, role);
    ctx.inBlock--;
    var failed = hosts.filter(function (h) { return ctx.blockFailed && ctx.blockFailed[h]; });
    if (failed.length && task.rescue) { failed.forEach(function (h) { delete ctx.dead[h]; ctx.stats[h].failed = failedBefore[h]; ctx.stats[h].rescued++; delete ctx.blockFailed[h]; }); runTasks(ctx, play, merged(task.rescue), failed, role); }
    if (task.always) runTasks(ctx, play, merged(task.always), hosts.filter(function (h) { return !ctx.dead[h] || failed.indexOf(h) >= 0; }), role);
    failed.forEach(function (h) { if (!task.rescue) { ctx.dead[h] = true; } });
  }
  function taskFail(ctx, hosts, msg) { hosts.forEach(function (h) { out(ctx.io, "fatal: [" + h + "]: FAILED! => {\"msg\": " + JSON.stringify(msg) + "}\n"); ctx.stats[h].failed++; ctx.dead[h] = true; }); }
  function tvars(ctx, play, h, role, task, item) {
    var hv = ctx.hostvars(h);
    var layers = [role && role.defaults || {}, hv, play.vars || {}, play.varsFiles || {}, role && role.vars || {}, role && role.params || {}, task && task.vars || {}, ctx.facts[h] || {}, ctx.regs[h] || {}, ctx.extra];
    var special = { inventory_hostname: h, inventory_hostname_short: h.split(".")[0], ansible_host: hv.ansible_host || h, groups: (function () { var g = {}; keys(ctx.inv.groups).forEach(function (k) { g[k] = ctx.inv.hostsOf(k); }); return g; })(), group_names: ctx.inv.groupsOf(h).filter(function (g) { return g !== "ungrouped"; }), hostvars: hostvarsProxy(ctx, play), ansible_check_mode: !!ctx.o.check, ansible_play_hosts: ctx.playHosts, playbook_dir: ctx.playDir, role_path: role ? role.dir : undefined, ansible_facts: ctx.facts[h] && ctx.facts[h].__facts || {} };
    if (item !== undefined) special[(task && task.loop_control && task.loop_control.loop_var) || "item"] = item;
    var f = function (n) {
      if (n in special) return special[n];
      for (var i = layers.length - 1; i >= 0; i--) if (layers[i] && Object.prototype.hasOwnProperty.call(layers[i], n)) { var v = layers[i][n]; return typeof v === "string" && /\{\{|\{%/.test(v) ? render(v, f, ctx) : v; }
      return undefined;
    };
    return f;
  }
  function hostvarsProxy(ctx, play) { var o = {}; keys(ctx.inv.hosts).forEach(function (h) { Object.defineProperty(o, h, { enumerable: true, get: function () { var hv = Object.assign({}, ctx.hostvars(h), ctx.facts[h] || {}); hv.inventory_hostname = h; return hv; } }); }); return o; }
  function fmtResult(r) { var o = {}; keys(r).sort().forEach(function (k) { if (k.indexOf("__") === 0) return; o[k] = r[k]; }); return JSON.stringify(o, null, 4); }
  function runOne(ctx, play, task, mod, modName, hosts, role, handlersMode) {
    var io = ctx.io, alive = hosts.filter(function (h) { return !ctx.dead[h]; });
    if (!alive.length) return;
    var title = (role ? role.name + " : " : "") + (task.name ? render(task.name, tvars(ctx, play, alive[0], role, task), ctx, { asText: true }) : modName);
    if (!handlersMode) out(io, "\n" + banner("TASK [" + title + "]") + "\n");
    alive.forEach(function (h) {
      var vars = tvars(ctx, play, h, role, task);
      var become = task.become !== undefined ? truthy(task.become) : role && role.become !== undefined ? truthy(role.become) : play.become !== undefined ? truthy(play.become) : truthy(ctx.cfg.privilege_escalation.become) || !!ctx.o.become;
      var loop = task.loop !== undefined ? task.loop : task.with_items !== undefined ? task.with_items : task.with_list;
      var items;
      try { items = loop === undefined ? [undefined] : (function () { var l = render(loop, vars, ctx); if (typeof l === "string") l = [l]; if (task.with_items && Array.isArray(l)) l = [].concat.apply([], l.map(function (x) { return Array.isArray(x) ? x : [x]; })); return l; })(); }
      catch (e) { if (e instanceof JErr) { out(io, "fatal: [" + h + "]: FAILED! => {\"msg\": " + JSON.stringify("'" + e.message + "'") + "}\n"); ctx.stats[h].failed++; ctx.dead[h] = true; return; } throw e; }
      var results = [], anyChanged = false, anyFailed = false, allSkipped = true;
      for (var ii = 0; ii < items.length; ii++) {
        var item = items[ii], iv = tvars(ctx, play, h, role, task, item);
        var label = item === undefined ? "" : " => (item=" + (task.loop_control && task.loop_control.label ? render(task.loop_control.label, iv, ctx) : typeof item === "object" ? JSON.stringify(item) : item) + ")";
        try {
          if (task.when !== undefined) { var conds = [].concat(task.when); var ok = conds.every(function (c) { return typeof c === "boolean" ? c : truthy(render("{{ " + c + " }}", iv, ctx)); }); if (!ok) { out(io, "skipping: [" + h + "]" + label + "\n"); results.push({ skipped: true, changed: false, false_condition: String(conds[0]) }); continue; } }
          allSkipped = false;
          var hs = hostSession(ctx, h, become, task.become_user || play.become_user);
          if (hs.error) throw new MFail(hs.error);
          var rawArgs = task[modName], a;
          if (typeof rawArgs === "string") a = (mod === "command" || mod === "shell" || mod === "raw") ? Object.assign({ _raw_params: rawArgs }, task.args || {}) : parseFree(rawArgs);
          else a = Object.assign({}, rawArgs || {}, task.args || {});
          a = renderDeep(a, iv, ctx);
          var tinfo = { vars: iv, facts: ctx.facts[h] = ctx.facts[h] || {}, role: role, playDir: ctx.playDir, module: mod };
          var res = MOD[mod](a, ctx, hs, tinfo, !!ctx.o.check && task.check_mode !== false);
          if (task.changed_when !== undefined) { var reg0 = Object.assign({}, res); var cv = tvars(ctx, play, h, role, task, item); var cw = typeof task.changed_when === "boolean" ? task.changed_when : truthy(render("{{ " + task.changed_when + " }}", function (n) { return task.register && n === task.register ? reg0 : cv(n); }, ctx)); res.changed = cw; }
          if (task.failed_when !== undefined) { var reg1 = Object.assign({}, res); var fw = [].concat(task.failed_when).some(function (c) { return typeof c === "boolean" ? c : truthy(render("{{ " + c + " }}", function (n) { return task.register && n === task.register ? reg1 : iv(n); }, ctx)); }); if (fw) throw new MFail("The conditional check '" + task.failed_when + "' failed. The error was: error while evaluating conditional", res); }
          if (res.changed) anyChanged = true;
          results.push(res);
          if (res.__diff && ctx.o.diff) out(io, diffText(res.__diff) );
          if (res.__debug) { var dbg = {}; keys(res).forEach(function (k) { if (k !== "changed" && k !== "__debug") dbg[k] = res[k]; }); out(io, "ok: [" + h + "]" + label + " => " + JSON.stringify(dbg, null, 4) + "\n"); continue; }
          var st = res.changed ? "changed" : "ok";
          out(io, st + ": [" + h + "]" + label + (ctx.o.verbose ? " => " + fmtResult(res) : "") + "\n");
        } catch (e) {
          if (e instanceof MFail) {
            var fr = Object.assign({ changed: false, msg: e.msg }, e.extra);
            anyFailed = true; results.push(Object.assign({ failed: true }, fr));
            out(io, "fatal: [" + h + "]: FAILED! => " + (label ? "(item=" + label.replace(/^ => \(item=|\)$/g, "") + ") => " : "") + JSON.stringify(fr).replace(/,"/g, ", \"").replace(/":/g, "\": ") + "\n");
            if (truthy(task.ignore_errors)) { out(io, "...ignoring\n"); ctx.stats[h].ignored++; anyFailed = false; }
            continue;
          }
          if (e instanceof JErr) { anyFailed = true; var m0 = /is undefined/.test(e.message) ? "The task includes an option with an undefined variable. The error was: " + e.message + ". " + e.message + "\n\nThe error appears to be in '" + (role ? role.dir + "/tasks/main.yml" : ctx.playFile) + "': line " + (task.__line || 1) + ", column 3, but may\nbe elsewhere in the file depending on the exact syntax problem." : e.message; out(io, "fatal: [" + h + "]: FAILED! => {\"msg\": " + JSON.stringify(m0) + "}\n"); results.push({ failed: true }); continue; }
          if (e instanceof AErr) { anyFailed = true; out(io, "fatal: [" + h + "]: FAILED! => {\"msg\": " + JSON.stringify(e.message) + "}\n"); results.push({ failed: true }); continue; }
          throw e;
        }
      }
      var agg = items.length > 1 || loop !== undefined ? { changed: anyChanged, results: results, msg: "All items completed" } : (results[0] || { skipped: true });
      if (task.register) { ctx.regs[h] = ctx.regs[h] || {}; ctx.regs[h][task.register] = Object.assign({ failed: anyFailed, skipped: allSkipped }, agg); }
      if (allSkipped) { ctx.stats[h].skipped++; return; }
      if (anyFailed) { ctx.stats[h].failed++; if (ctx.inBlock) { (ctx.blockFailed = ctx.blockFailed || {})[h] = true; } ctx.dead[h] = true; return; }
      ctx.stats[h].ok++;
      if (anyChanged) { ctx.stats[h].changed++; [].concat(task.notify || []).forEach(function (n) { (ctx.notified[h] = ctx.notified[h] || []).indexOf(n) < 0 && ctx.notified[h].push(n); }); }
    });
  }
  function diffText(d) {
    var a = G.splitLines(d.before || ""), b = G.splitLines(d.after || "");
    return "--- before: " + d.beforeHeader + "\n+++ after: " + d.afterHeader + "\n" + G.unifiedBody(d.before || "", d.after || "", 3).lines.map(function (x) { return x.t; }).join("\n") + "\n";
  }
  function loadRole(ctx, spec, play) {
    var name = typeof spec === "string" ? spec : spec.role || spec.name;
    var paths = [ctx.playDir + "/roles"].concat((ctx.cfg.defaults.roles_path || "").split(":").filter(Boolean).map(function (p) { return abs(ctx.sess, p); }), [ctx.sess.home + "/.ansible/roles", "/etc/ansible/roles"]);
    var dir = null; for (var i = 0; i < paths.length; i++) if (ctx.fs.isDir(paths[i] + "/" + name)) { dir = paths[i] + "/" + name; break; }
    if (!dir) throw new AErr("the role '" + name + "' was not found in " + paths.join(":") + "\n\nThe error appears to be in '" + ctx.playFile + "': line 1, column 1, but may\nbe elsewhere in the file depending on the exact syntax problem.");
    var rd = function (sub) { var p = dir + "/" + sub + "/main.yml"; var t = ctx.fs.read(p); if (t == null) { p = dir + "/" + sub + "/main.yaml"; t = ctx.fs.read(p); } return t == null ? null : (sub === "defaults" || sub === "vars" ? loadVars(ctx, p) : yload(t, p, ctx)); };
    var params = {}; if (typeof spec === "object") keys(spec).forEach(function (k) { if (["role", "name", "tags", "when", "become", "vars"].indexOf(k) < 0) params[k] = spec[k]; }); if (spec.vars) Object.assign(params, spec.vars);
    return { name: name, dir: dir, tasks: rd("tasks") || [], handlers: rd("handlers") || [], defaults: rd("defaults") || {}, vars: rd("vars") || {}, params: params, tags: typeof spec === "object" ? spec.tags : null, become: typeof spec === "object" ? spec.become : undefined };
  }
  function runRole(ctx, play, spec, hosts) { var r = loadRole(ctx, spec, play); ctx.roleHandlers.push(r); runTasks(ctx, play, r.tasks, hosts, r); }
  function runHandlers(ctx, play, hosts) {
    var all = (play.handlers || []).map(function (hd) { return { hd: hd, role: null }; });
    ctx.roleHandlers.forEach(function (r) { (r.handlers || []).forEach(function (hd) { all.push({ hd: hd, role: r }); }); });
    all.forEach(function (x) {
      var names = [x.hd.name].concat(x.hd.listen ? [].concat(x.hd.listen) : []);
      var targets = hosts.filter(function (h) { return !ctx.dead[h] && (ctx.notified[h] || []).some(function (n) { return names.indexOf(n) >= 0; }); });
      if (!targets.length) return;
      out(ctx.io, "\n" + banner("RUNNING HANDLER [" + (x.role ? x.role.name + " : " : "") + x.hd.name + "]") + "\n");
      var mod = keys(x.hd).filter(function (k) { return ALIAS[k]; })[0];
      runOne(ctx, play, x.hd, ALIAS[mod], mod, targets, x.role, true);
    });
    hosts.forEach(function (h) { ctx.notified[h] = []; });
  }
  function runPlay(ctx, play, idx) {
    var io = ctx.io;
    if (!play || typeof play !== "object" || Array.isArray(play)) throw new AErr("A playbook must be a list of plays, got a " + (Array.isArray(play) ? "list" : typeof play) + " instead");
    if (play.import_playbook) { runPlaybookFile(ctx, abs(ctx.sess, ctx.playDir + "/" + play.import_playbook)); return; }
    if (!play.hosts) throw new AErr("the field 'hosts' is required but was not set");
    var pattern = play.hosts, hosts = ctx.inv.match(Array.isArray(pattern) ? pattern.join(":") : pattern);
    if (ctx.o.limit) { var lim = ctx.inv.match(ctx.o.limit); hosts = hosts.filter(function (h) { return lim.indexOf(h) >= 0; }); }
    out(io, "\n" + banner("PLAY [" + (play.name || pattern) + "]") + "\n");
    if (!hosts.length) { out(io, "skipping: no hosts matched\n"); return; }
    ctx.playHosts = hosts; ctx.roleHandlers = []; ctx.notified = {}; ctx.dead = ctx.dead || {}; ctx.regs = ctx.regs || {};
    play.varsFiles = {}; [].concat(play.vars_files || []).forEach(function (vf) { var p = abs(ctx.sess, ctx.playDir + "/" + vf); var v = loadVars(ctx, p); if (v == null) throw new AErr("vars file " + vf + " was not found\nCould not find file on the Ansible Controller.\nIf you are using a module and expect the file to exist on the remote, see the remote_src option"); Object.assign(play.varsFiles, v); });
    hosts.forEach(function (h) { ctx.stats[h] = ctx.stats[h] || { ok: 0, changed: 0, unreachable: 0, failed: 0, skipped: 0, rescued: 0, ignored: 0 }; });
    // connect (and gather facts)
    var gather = play.gather_facts === undefined ? true : truthy(play.gather_facts);
    if (gather) out(io, "\n" + banner("TASK [Gathering Facts]") + "\n");
    hosts.forEach(function (h) {
      if (ctx.dead[h]) return;
      if (!ctx.conns[h]) { var c = connect(ctx, h); if (!c.ok) { ctx.stats[h].unreachable++; ctx.dead[h] = true; if (!gather) out(io, "\n" + banner("TASK [" + "connect" + "]") + "\n"); out(io, "fatal: [" + h + "]: UNREACHABLE! => {\"changed\": false, \"msg\": " + JSON.stringify(c.msg) + ", \"unreachable\": true}\n"); return; } ctx.conns[h] = c; }
      if (gather) { ctx.facts[h] = ctx.facts[h] || {}; var fx = facts(ctx, h, ctx.conns[h].m); Object.assign(ctx.facts[h], fx); ctx.facts[h].__facts = fx; ctx.stats[h].ok++; out(io, "ok: [" + h + "]\n"); }
    });
    var live = function () { return hosts.filter(function (h) { return !ctx.dead[h]; }); };
    runTasks(ctx, play, play.pre_tasks || [], live(), null);
    runHandlers(ctx, play, live());
    [].concat(play.roles || []).forEach(function (r) { runRole(ctx, play, r, live()); });
    runTasks(ctx, play, play.tasks || [], live(), null);
    runHandlers(ctx, play, live());
    runTasks(ctx, play, play.post_tasks || [], live(), null);
    runHandlers(ctx, play, live());
    if (!live().length && hosts.length) out(io, "\n" + banner("NO MORE HOSTS LEFT") + "\n");
  }
  function addLines(list, text) { if (!Array.isArray(list)) return; var lines = String(text).split("\n"); list.forEach(function (t) { if (!t || typeof t !== "object") return; var nm = t.name, i = nm ? lines.findIndex(function (l) { return l.indexOf(nm) >= 0; }) : -1; t.__line = i >= 0 ? i + 1 : 1; ["block", "rescue", "always", "tasks", "pre_tasks", "post_tasks", "handlers"].forEach(function (k) { addLines(t[k], text); }); }); }
  function runPlaybookFile(ctx, path) {
    var t = ctx.fs.read(path);
    if (t == null) throw new AErr("the playbook: " + path.replace(ctx.sess.cwd + "/", "") + " could not be found");
    var y = yload(t, path, ctx);
    addLines(y, t);
    var saveDir = ctx.playDir, saveFile = ctx.playFile; ctx.playDir = path.replace(/\/[^/]*$/, ""); ctx.playFile = path;
    if (!Array.isArray(y)) throw new AErr("A playbook must be a list of plays, got a " + (y && typeof y) + " instead\n\nThe error appears to be in '" + path + "': line 1, column 1, but may\nbe elsewhere in the file depending on the exact syntax problem.");
    y.forEach(function (p, i) { runPlay(ctx, p, i); });
    ctx.playDir = saveDir; ctx.playFile = saveFile;
  }
  function recap(ctx) {
    var hs = keys(ctx.stats);
    out(ctx.io, "\n" + banner("PLAY RECAP") + "\n");
    hs.forEach(function (h) { var s = ctx.stats[h]; out(ctx.io, (h + new Array(27).join(" ")).slice(0, Math.max(27, h.length + 1)) + ": ok=" + (s.ok + "    ").slice(0, 4) + " changed=" + (s.changed + "    ").slice(0, 4) + " unreachable=" + (s.unreachable + "    ").slice(0, 4) + " failed=" + (s.failed + "    ").slice(0, 4) + " skipped=" + (s.skipped + "    ").slice(0, 4) + " rescued=" + (s.rescued + "    ").slice(0, 4) + " ignored=" + (s.ignored + "    ").slice(0, 4) + "\n"); });
    out(ctx.io, "\n");
  }

  /* ================================================================== CLIs */
  function parseCli(a) {
    var o = { extra: {}, tags: null, skipTags: null, pos: [] };
    for (var i = 0; i < a.length; i++) {
      var x = a[i], nx = function () { return a[++i]; };
      if (x === "-i" || x === "--inventory") (o.inv = o.inv || []).push(nx());
      else if (/^-i./.test(x)) (o.inv = o.inv || []).push(x.slice(2));
      else if (x === "-m" || x === "--module-name") o.module = nx();
      else if (x === "-a" || x === "--args") o.args = nx();
      else if (x === "-e" || x === "--extra-vars") { var ev = nx(); if (/^@/.test(ev)) o.extraFile = ev.slice(1); else if (/^\s*\{/.test(ev)) { try { Object.assign(o.extra, JSON.parse(ev)); } catch (e) { /* ignore */ } } else Object.assign(o.extra, kv(ev)); }
      else if (x === "-b" || x === "--become") o.become = true;
      else if (x === "-u" || x === "--user") o.user = nx();
      else if (x === "-l" || x === "--limit") o.limit = nx();
      else if (/^--limit=/.test(x)) o.limit = x.slice(8);
      else if (x === "-t" || x === "--tags") o.tags = nx().split(",");
      else if (/^--tags=/.test(x)) o.tags = x.slice(7).split(",");
      else if (x === "--skip-tags") o.skipTags = nx().split(",");
      else if (x === "-C" || x === "--check") o.check = true;
      else if (x === "-D" || x === "--diff") o.diff = true;
      else if (/^-v+$/.test(x)) o.verbose = x.length - 1;
      else if (x === "--vault-password-file" || x === "--vault-pass-file") o.vaultFile = nx();
      else if (/^--vault-password-file=/.test(x)) o.vaultFile = x.split("=")[1];
      else if (x === "--ask-vault-pass" || x === "-J" || x === "--ask-vault-password") o.askVault = true;
      else if (x === "-K" || x === "--ask-become-pass" || x === "-k") o.askPass = true;
      else if (x === "--syntax-check") o.syntax = true;
      else if (x === "--list-hosts") o.listHosts = true;
      else if (x === "--list-tasks") o.listTasks = true;
      else if (x === "--list-tags") o.listTags = true;
      else if (x === "--graph") o.graph = true;
      else if (x === "--list") o.list = true;
      else if (x === "--host") o.host = nx();
      else if (x === "--version") o.version = true;
      else if (x === "-f" || x === "--forks") nx();
      else o.pos.push(x);
    }
    return o;
  }
  function makeCtx(sess, io, o) {
    var ctx = new Ctx(sess, io, o);
    var invSrc = o.inv || (ctx.cfg.defaults.inventory ? [ctx.cfg.defaults.inventory] : null) || (S.getVar(sess, "ANSIBLE_INVENTORY") ? [S.getVar(sess, "ANSIBLE_INVENTORY")] : null);
    if (!invSrc) { ctx.warn("No inventory was parsed, only implicit localhost is available"); ctx.inv = new Inv(); ctx.inv.finish(); }
    else ctx.inv = loadInventory(ctx, invSrc);
    if (o.user) keys(ctx.inv.hosts).forEach(function (h) { ctx.inv.hosts[h].vars.ansible_user = o.user; });
    if (o.extraFile) Object.assign(ctx.extra, loadVars(ctx, abs(sess, o.extraFile)) || {});
    if (o.askVault) { ctx._vp = null; ctx.askVault = true; }
    return ctx;
  }
  function versionText() { return "ansible-playbook [core " + VERSION + "]\n  config file = /home/dev/ansible.cfg\n  configured module search path = ['/home/dev/.ansible/plugins/modules', '/usr/share/ansible/plugins/modules']\n  ansible python module location = /usr/lib/python3/dist-packages/ansible\n  ansible collection location = /home/dev/.ansible/collections:/usr/share/ansible/collections\n  executable location = /usr/bin/ansible-playbook\n  python version = 3.12.3 (main, Nov  6 2024, 18:32:19) [GCC 13.2.0] (/usr/bin/python3)\n  jinja version = 3.1.2\n  libyaml = True\n"; }
  function warnOut(ctx) { ctx.warnings.forEach(function (w) { errl(ctx.io, "[WARNING]: " + w); }); }
  CMDS.ansibleplaybook = function (args, io, sess) {
    var o = parseCli(args.slice(1));
    if (o.version) { out(io, versionText()); return 0; }
    if (!o.pos.length) { errl(io, "usage: ansible-playbook [-h] [--version] [-v] [--private-key PRIVATE_KEY_FILE]\n                        [-u REMOTE_USER] [-c CONNECTION] [-T TIMEOUT]\n                        [-i INVENTORY] [--list-hosts] [-l SUBSET] [-e EXTRA_VARS]\n                        [--vault-password-file VAULT_PASSWORD_FILES]\n                        [-C] [-D] [--syntax-check] [--list-tasks] [--list-tags]\n                        [-t TAGS] [--skip-tags SKIP_TAGS] [-b]\n                        playbook [playbook ...]\nansible-playbook: error: the following arguments are required: playbook"); return 2; }
    if (o.askVault) { out(io, "Vault password: \n"); if (io.note) io.note("(The lab can't type a password at a prompt: put it in a file only you can read and use --vault-password-file FILE.)"); errl(io, "ERROR! Attempting to decrypt but no vault secrets found"); return 1; }
    if (o.askPass) { out(io, "BECOME password: \n"); if (io.note) io.note("(The lab can't type a password at a prompt. The hosts here allow sudo without a password for the ansible user.)"); }
    var ctx;
    try {
      ctx = makeCtx(sess, io, o); ctx.stats = {}; ctx.dead = {}; ctx.regs = {};
      warnOut(ctx);
      var path = abs(sess, o.pos[0]);
      if (o.syntax) { var t = ctx.fs.read(path); if (t == null) throw new AErr("the playbook: " + o.pos[0] + " could not be found"); var y = yload(t, path, ctx); (y || []).forEach(function (p) { if (!p.hosts && !p.import_playbook) throw new AErr("the field 'hosts' is required but was not set"); (p.tasks || []).forEach(function (tk) { var m = keys(tk).filter(function (k) { return TASK_KEYS.indexOf(k) < 0; }); if (m.length && !ALIAS[m.filter(function (k) { return ALIAS[k]; })[0] || m[0]]) throw new AErr("couldn't resolve module/action '" + m[0] + "'. This often indicates a misspelling, missing collection, or incorrect module path."); }); }); out(io, "\nplaybook: " + o.pos[0] + "\n"); return 0; }
      if (o.listHosts || o.listTasks || o.listTags) { var y2 = yload(ctx.fs.read(path), path, ctx) || []; out(io, "\nplaybook: " + o.pos[0] + "\n"); y2.forEach(function (p, i) { var hs = ctx.inv.match(p.hosts); if (o.limit) { var lim = ctx.inv.match(o.limit); hs = hs.filter(function (h) { return lim.indexOf(h) >= 0; }); } out(io, "\n  play #" + (i + 1) + " (" + p.hosts + "): " + (p.name || p.hosts) + "\tTAGS: []\n"); if (o.listHosts) out(io, "    pattern: ['" + p.hosts + "']\n    hosts (" + hs.length + "):\n" + hs.map(function (h) { return "      " + h + "\n"; }).join("")); if (o.listTasks) { out(io, "    tasks:\n"); (p.tasks || []).forEach(function (tk) { out(io, "      " + (tk.name || "unnamed") + "\tTAGS: [" + [].concat(tk.tags || []).join(", ") + "]\n"); }); } }); out(io, "\n"); return 0; }
      runPlaybookFile(ctx, path);
      recap(ctx);
    } catch (e) {
      if (e instanceof AErr) { errl(io, "ERROR! " + e.message); return /could not be found|was not found|required but was not set|couldn't resolve|unable to read|Syntax Error|A playbook must/.test(e.message) ? (/Syntax|couldn't resolve|required but|playbook must/.test(e.message) ? 4 : 1) : 1; }
      if (e instanceof JErr) { errl(io, "ERROR! " + e.message); return 1; }
      throw e;
    }
    var st = ctx.stats, anyFail = keys(st).some(function (h) { return st[h].failed; }), anyUnr = keys(st).some(function (h) { return st[h].unreachable; });
    IAC.ansibleRuns = IAC.ansibleRuns || {}; (CI.hubOf(sess.sys).ansibleRuns = CI.hubOf(sess.sys).ansibleRuns || []).push({ playbook: o.pos[0], stats: clone(st), check: !!o.check, cmd: CI.homeSys(sess.sys).cmdIndex, limit: o.limit || null });
    return anyFail ? 2 : anyUnr ? 4 : 0;
  };
  CMDS.ansible = function (args, io, sess) {
    var o = parseCli(args.slice(1));
    if (o.version) { out(io, versionText().replace("ansible-playbook", "ansible")); return 0; }
    var pattern = o.pos[0];
    if (!pattern) { errl(io, "usage: ansible [-h] [--version] [-v] [-b] [-i INVENTORY] [-m MODULE_NAME] [-a MODULE_ARGS] pattern\nansible: error: the following arguments are required: pattern"); return 2; }
    var ctx;
    try { ctx = makeCtx(sess, io, o); } catch (e) { if (e instanceof AErr) { errl(io, "ERROR! " + e.message); return 1; } throw e; }
    warnOut(ctx);
    var hosts = ctx.inv.match(pattern);
    if (o.limit) { var lim = ctx.inv.match(o.limit); hosts = hosts.filter(function (h) { return lim.indexOf(h) >= 0; }); }
    if (!hosts.length) { errl(io, "[WARNING]: No hosts matched, nothing to do"); return 0; }
    var modName = o.module || "command", mod = ALIAS[modName];
    if (!mod) { errl(io, "ERROR! couldn't resolve module/action '" + modName + "'. This often indicates a misspelling, missing collection, or incorrect module path."); return 1; }
    ctx.stats = {}; ctx.dead = {}; ctx.regs = {}; ctx.playDir = sess.cwd; ctx.playFile = "(ad-hoc)";
    var code = 0;
    hosts.forEach(function (h) {
      ctx.stats[h] = { ok: 0, changed: 0, unreachable: 0, failed: 0, skipped: 0, rescued: 0, ignored: 0 };
      var c;
      try { c = connect(ctx, h); } catch (e0) { if (e0 instanceof AErr || e0 instanceof JErr) { code = 2; out(io, h + " | FAILED! => {\n    \"msg\": " + JSON.stringify(e0.message) + "\n}\n"); return; } throw e0; }
      if (!c.ok) { out(io, h + " | UNREACHABLE! => {\n    \"changed\": false,\n    \"msg\": " + JSON.stringify(c.msg) + ",\n    \"unreachable\": true\n}\n"); code = 4; return; }
      ctx.conns[h] = c;
      var hs = hostSession(ctx, h, !!o.become, null);
      if (hs.error) { out(io, h + " | FAILED! => {\n    \"msg\": \"" + hs.error + "\"\n}\n"); code = 2; return; }
      var a = (mod === "command" || mod === "shell" || mod === "raw") ? { _raw_params: o.args || "" } : parseFree(o.args || "");
      var vars;
      try {
        vars = tvars(ctx, { vars: {} }, h, null, null);
        a = renderDeep(a, vars, ctx);
        var res = MOD[mod](a, ctx, hs, { vars: vars, facts: {}, role: null, playDir: sess.cwd, module: mod }, !!o.check);
        if (mod === "command" || mod === "shell" || mod === "raw") { out(io, h + " | CHANGED | rc=" + res.rc + " >>\n" + (res.stdout || "") + (res.stderr ? (res.stdout ? "\n" : "") + res.stderr : "") + "\n"); return; }
        var shown = Object.assign(res.__debug ? {} : { ansible_facts: { discovered_interpreter_python: "/usr/bin/python3" } }, res); if (res.__debug) delete shown.changed; delete shown.__diff; delete shown.__debug;
        out(io, h + " | " + (res.changed ? "CHANGED" : "SUCCESS") + " => " + fmtResult(shown) + "\n");
      } catch (e) {
        if (e instanceof MFail) { code = 2; if (mod === "command" || mod === "shell") out(io, h + " | FAILED | rc=" + (e.extra.rc != null ? e.extra.rc : 1) + " >>\n" + (e.extra.stdout || "") + (e.extra.stderr ? e.extra.stderr : "") + "non-zero return code\n"); else out(io, h + " | FAILED! => " + fmtResult(Object.assign({ changed: false, msg: e.msg }, e.extra)) + "\n"); return; }
        if (e instanceof JErr || e instanceof AErr) { code = 2; out(io, h + " | FAILED! => {\n    \"msg\": " + JSON.stringify(e.message) + "\n}\n"); return; }
        throw e;
      }
    });
    return code;
  };
  CMDS.ansibleinventory = function (args, io, sess) {
    var o = parseCli(args.slice(1)), ctx;
    try { ctx = makeCtx(sess, io, o); } catch (e) { if (e instanceof AErr) { errl(io, "ERROR! " + e.message); return 1; } throw e; }
    warnOut(ctx);
    var inv = ctx.inv;
    if (o.graph) {
      var L = [];
      (function g(name, ind) { L.push(new Array(ind + 1).join("  |") + (ind ? "--" : "") + "@" + name + ":"); var gg = inv.groups[name]; if (!gg) return; gg.children.forEach(function (c) { g(c, ind + 1); }); (name === "all" ? [] : gg.hosts).forEach(function (h) { L.push(new Array(ind + 2).join("  |") + "--" + h); }); })(o.pos[0] || "all", 0);
      out(io, L.join("\n").replace(/^  \|/gm, "  |") + "\n"); return 0;
    }
    if (o.host) { out(io, JSON.stringify(ctx.hostvars(o.host), null, 4) + "\n"); return 0; }
    var j = { _meta: { hostvars: {} } };
    keys(inv.groups).forEach(function (g) { var gg = inv.groups[g]; j[g] = {}; if (gg.children.length) j[g].children = gg.children; if (gg.hosts.length) j[g].hosts = gg.hosts; });
    keys(inv.hosts).forEach(function (h) { j._meta.hostvars[h] = ctx.hostvars(h); });
    out(io, JSON.stringify(j, null, 4) + "\n"); return 0;
  };
  CMDS.ansiblegalaxy = function (args, io, sess) {
    var a = args.slice(1), fs = fsOf(sess);
    if (a[0] === "role" && a[1] === "init" || a[0] === "init") {
      var name = a[a[0] === "init" ? 1 : 2], base = abs(sess, name);
      if (!name) { errl(io, "ERROR! - you must specify a role name"); return 1; }
      if (fs.isDir(base)) { errl(io, "ERROR! - the directory " + name + " already exists. You can use --force to re-initialize this directory,\nhowever it will reset any main.yml files that may have\nbeen modified there already."); return 1; }
      var rn = name.split("/").pop();
      var files = { "README.md": "Role Name\n=========\n\nA brief description of the role goes here.\n", "defaults/main.yml": "---\n# defaults file for " + rn + "\n", "files/.gitkeep": "", "handlers/main.yml": "---\n# handlers file for " + rn + "\n", "meta/main.yml": "galaxy_info:\n  author: your name\n  description: your role description\n  company: your company (optional)\n  license: license (GPL-2.0-or-later, MIT, etc)\n  min_ansible_version: 2.1\n  galaxy_tags: []\ndependencies: []\n", "tasks/main.yml": "---\n# tasks file for " + rn + "\n", "templates/.gitkeep": "", "tests/inventory": "localhost\n\n", "tests/test.yml": "---\n- hosts: localhost\n  remote_user: root\n  roles:\n    - " + rn + "\n", "vars/main.yml": "---\n# vars file for " + rn + "\n" };
      keys(files).forEach(function (f) { fs.write(base + "/" + f, files[f]); });
      out(io, "- Role " + name + " was created successfully\n"); return 0;
    }
    if (a[0] === "collection" && a[1] === "list") { out(io, "\n# /usr/lib/python3/dist-packages/ansible_collections\nCollection                               Version\n---------------------------------------- -------\namazon.aws                               8.2.1  \nansible.posix                            1.6.2  \ncommunity.general                        9.5.0  \ncommunity.hashi_vault                    6.2.0  \n"); return 0; }
    errl(io, "usage: ansible-galaxy [-h] [--version] [-v] TYPE ...\n\n(this lab: ansible-galaxy role init NAME, ansible-galaxy collection list)"); return 2;
  };
  CMDS.ansiblevault = function (args, io, sess) {
    var a = args.slice(1), sub = a[0], o = parseCli(a.slice(1)), fs = fsOf(sess), ctx = new Ctx(sess, io, o);
    var pw = null;
    try { pw = ctx.vaultPass(); } catch (e) { if (e instanceof AErr) { errl(io, "ERROR! " + e.message); return 1; } throw e; }
    if (sub === "--version") { out(io, versionText().replace("ansible-playbook", "ansible-vault")); return 0; }
    if (pw == null && sub !== "view" && sub !== "decrypt" && sub !== "edit" && sub !== "rekey") { out(io, "New Vault password: \n"); if (io.note) io.note("(The lab can't type a password at a prompt: put it in a file (chmod 600) and add --vault-password-file FILE, or set vault_password_file in ansible.cfg.)"); errl(io, "ERROR! A vault password is required to use Ansible's Vault"); return 1; }
    if (pw == null) { errl(io, "ERROR! A vault password or secret is required" + (sub === "view" ? " to view" : "")); if (io.note) io.note("(Give it with --vault-password-file FILE.)"); return 1; }
    try {
      if (sub === "encrypt") { o.pos.forEach(function (f) { var p = abs(sess, f), t = fs.read(p); if (t == null) throw new AErr("input is not vault encrypted data. " + f + " is not a vault encrypted file for " + f); if (isVault(t)) throw new AErr("input is already encrypted"); fs.write(p, vaultEncrypt(sess.sys, t, pw), 384); }); out(io, "Encryption successful\n"); return 0; }
      if (sub === "decrypt") { o.pos.forEach(function (f) { var p = abs(sess, f), t = fs.read(p); if (!isVault(t)) throw new AErr("input is not vault encrypted data. " + f + " is not a vault encrypted file for " + f); fs.write(p, vaultDecrypt(sess.sys, t, pw, f), 384); }); out(io, "Decryption successful\n"); return 0; }
      if (sub === "view") { var p2 = abs(sess, o.pos[0]), t2 = fs.read(p2); if (t2 == null) throw new AErr("input is not vault encrypted data. " + o.pos[0] + " is not a vault encrypted file for " + o.pos[0]); out(io, vaultDecrypt(sess.sys, t2, pw, o.pos[0])); return 0; }
      if (sub === "encrypt_string") { var val = o.pos[0], nm = null; var ai = a.indexOf("--name"); if (ai >= 0) nm = a[ai + 1]; if (nm) val = o.pos.filter(function (x) { return x !== nm; })[0]; if (val == null) { val = (io.stdin || "").replace(/\n$/, ""); } var enc = vaultEncrypt(sess.sys, val, pw).replace(/\n$/, "").split("\n").map(function (l) { return "          " + l; }).join("\n"); out(io, (nm ? nm + ": " : "") + "!vault |\n" + enc + "\n"); errl(io, "Encryption successful"); return 0; }
      if (sub === "edit" || sub === "create" || sub === "rekey") { if (io.note) io.note("(ansible-vault " + sub + " opens an editor on the decrypted file. In this lab: decrypt, edit with nano, encrypt again; or create the file with nano, then ansible-vault encrypt it.)"); return 1; }
    } catch (e) { if (e instanceof AErr) { errl(io, "ERROR! " + e.message); return 1; } throw e; }
    errl(io, "usage: ansible-vault [-h] [--version] [-v] {create,decrypt,edit,view,encrypt,encrypt_string,rekey} ..."); return 2;
  };
  IAC.ansibleCtx = makeCtx;
  IAC.ANSIBLE_VERSION = VERSION;
})(typeof window !== "undefined" ? window : globalThis);
