/* sudo learn — PowerShell lab runner and check helpers.
   PSLab.runner plugs into assets/js/lab-app.js (same result shape as the Python worker, plus "parts").
   Checks are plain JavaScript functions: check(r) returns true or a message string, where r is a run context:
     r.src, r.out (all text), r.lines (non-empty output lines, without errors/warnings), r.allLines, r.errors (messages)
     r.v(name)       raw PowerShell value of a variable after the run (undefined if never set)
     r.p(name)       the same as plain JS (PSObject -> object, hashtable -> object, dates -> "yyyy-MM-dd HH:mm:ss")
     r.has(name), r.fn(name)  is the variable / function defined?
     r.ps(code)      run more PowerShell in the finished session: {value (plain), raw, items, text, lines, errors, ok}
     r.run(code, o)  run different code (or the same, with other files) in a fresh session -> new r
     r.system        the pretend machine after the run (services, users, actions log...)
     r.file(path)    content of a file in the virtual disk after the run, or null */
(function (root) {
  "use strict";
  var E = root.PSEngine;

  /* ---------------- plain values for comparisons */
  function plain(v) {
    if (v === undefined) return undefined;
    if (v === null) return null;
    if (Array.isArray(v)) return v.map(plain);
    if (v instanceof E.PSHashtable) { var h = {}; v.entries().forEach(function (e) { h[E.toStr(e.key)] = plain(e.value); }); return h; }
    if (v instanceof E.PSObject) {
      if (v.toStringFn && !v.props.length) return v.toStringFn();
      var o = {}; v.props.forEach(function (p) { o[p.name] = plain(typeof p.value === "function" ? p.value() : p.value); }); return o;
    }
    if (v instanceof E.PSDate) return E.formatDate(v, "yyyy-MM-dd HH:mm:ss");
    if (v instanceof E.PSTimeSpan) return { TotalMilliseconds: v.ms };
    if (v instanceof E.ScriptBlock) return "{" + v.text + "}";
    if (v instanceof E.PSType) return "[" + v.name + "]";
    if (v instanceof E.PSVersion) return v.parts.join(".");
    return v;
  }
  // How a value looks in feedback messages: PowerShell-ish literals.
  function show(v, max) {
    max = max || 160;
    var s = showInner(v, 0);
    return s.length > max ? s.slice(0, max - 3) + "..." : s;
  }
  function showInner(v, d) {
    if (v === undefined) return "(not set)";
    if (v === null) return "$null";
    if (typeof v === "boolean") return v ? "$true" : "$false";
    if (typeof v === "number") return E.toStr(v);
    if (typeof v === "string") return "'" + v.replace(/'/g, "''") + "'";
    if (Array.isArray(v)) return "@(" + v.map(function (x) { return showInner(x, d + 1); }).join(", ") + ")";
    if (v instanceof E.PSHashtable) return "@{" + v.entries().map(function (e) { return E.toStr(e.key) + "=" + showInner(e.value, d + 1); }).join("; ") + "}";
    if (v instanceof E.PSObject) {
      if (v.typeName !== "System.Management.Automation.PSCustomObject" && v.toStringFn) return v.toStringFn();
      return "[PSCustomObject]@{" + v.props.map(function (p) { return p.name + "=" + showInner(p.value, d + 1); }).join("; ") + "}";
    }
    if (typeof v === "object" && v.constructor === Object) return "@{" + Object.keys(v).map(function (k) { return k + "=" + showInner(v[k], d + 1); }).join("; ") + "}";
    return E.toStr(v);
  }
  function same(a, b) {
    if (a === b) return true;
    if (typeof a === "number" && typeof b === "number") return Math.abs(a - b) < 1e-9;
    if (a === null || b === null || a === undefined || b === undefined) return false;
    if (Array.isArray(a) || Array.isArray(b)) {
      if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
      for (var i = 0; i < a.length; i++) if (!same(a[i], b[i])) return false;
      return true;
    }
    if (typeof a === "object" && typeof b === "object") {
      var ka = Object.keys(a), kb = Object.keys(b);
      if (ka.length !== kb.length) return false;
      for (var j = 0; j < ka.length; j++) {
        var k = kb.filter(function (x) { return x.toLowerCase() === ka[j].toLowerCase(); })[0];
        if (k === undefined || !same(a[ka[j]], b[k])) return false;
      }
      return true;
    }
    return false;
  }

  /* ---------------- running */
  function freshSession(opts) {
    var s = E.newSession({ files: opts.files || {}, stdin: (opts.stdin || []).slice(), env: opts.env || {}, system: opts.system });
    if (opts.prelude) {
      E.runScript(s, opts.prelude);
      s.parts = []; s.errors = [];
      s.global.lookup("Error").value.length = 0;
    }
    return s;
  }
  function runCode(code, opts) {
    var s = freshSession(opts);
    var res = E.runScript(s, code);
    return { session: s, res: res };
  }
  function textOf(parts, filter) {
    return parts.filter(function (p) { return !filter || filter(p); }).map(function (p) { return p.text; });
  }
  var NOT_OUTPUT = { err: 1, warn: 1, verbose: 1, whatif: 1 };
  function makeCtx(code, opts, run) {
    var s = run.session;
    var all = textOf(s.parts);
    var r = {
      src: code,
      session: s,
      system: s.system,
      out: all.join("\n"),
      allLines: all.map(function (l) { return l.replace(/\s+$/, ""); }).filter(function (l) { return l.trim() !== ""; }),
      lines: textOf(s.parts, function (p) { return !NOT_OUTPUT[p.cls]; }).map(function (l) { return l.replace(/\s+$/, ""); }).filter(function (l) { return l.trim() !== ""; }),
      parts: s.parts.slice(),
      errors: s.errors.map(function (e) { return e.message; }),
      error: run.res.error,
      exit: run.res.exit,
      v: function (name) { var x = s.scriptScope.lookup(name); return x ? x.value : undefined; },
      p: function (name) { return plain(r.v(name)); },
      has: function (name) { return !!s.scriptScope.lookup(name); },
      fn: function (name) { return s.functions.has(name.toLowerCase()); },
      file: function (path) {
        var keys = Object.keys(s.system.files);
        var want = path.replace(/\//g, "\\").replace(/^\.\\/, "").toLowerCase();
        for (var k = 0; k < keys.length; k++) if (keys[k] === want) return s.system.files[keys[k]].content;
        return null;
      },
      ps: function (more) {
        var res = E.evalIn(s, more, { quiet: true });
        var raw = E.unwrap(res.items);
        var lines = textOf(res.parts, function (p) { return !NOT_OUTPUT[p.cls]; }).map(function (l) { return l.replace(/\s+$/, ""); }).filter(function (l) { return l.trim() !== ""; });
        return { raw: raw, value: plain(raw), items: res.items, text: textOf(res.parts).join("\n"), lines: lines, errors: res.errors, ok: !res.errors.length && !res.parseError };
      },
      run: function (newCode, o) {
        var opts2 = Object.assign({}, opts, o || {});
        if (o && o.files) opts2.files = Object.assign({}, opts.files || {}, o.files);
        var c = newCode == null ? code : newCode;
        return makeCtx(c, opts2, runCode(c, opts2));
      }
    };
    return r;
  }

  function runChecks(checks, r) {
    return checks.map(function (c) {
      try {
        var res = c.code(r);
        return res === true ? { id: c.id, pass: true } : { id: c.id, pass: false, msg: typeof res === "string" ? res : "" };
      } catch (e) {
        return { id: c.id, pass: false, msg: "Couldn't check this yet (" + (e && e.message || e) + ")" };
      }
    });
  }

  var last = null, lastOpts = null;
  function handle(msg) {
    var opts = { files: msg.files || {}, prelude: msg.prelude || "", stdin: msg.stdin || [], env: msg.env || {} };
    if (msg.type === "repl") {
      if (!last || lastOpts.prelude !== opts.prelude) { last = freshSession(opts); lastOpts = opts; }
      var before = last.parts.length;
      var res = E.evalIn(last, msg.code);
      var parts = last.parts.slice(before);
      return { parts: parts, error: res.errors.length ? errorInfo({ message: res.errors[0] }, null) : null };
    }
    var run;
    try { run = runCode(msg.code, opts); }
    catch (e) { return { internal: "the PowerShell simulator crashed: " + (e && e.stack || e) }; }
    last = run.session; lastOpts = opts;
    var r = makeCtx(msg.code, opts, run);
    var first = run.res.error || (run.session.errors[0] || null);
    var parts = run.session.parts.slice();
    var results = runChecks(msg.checks || [], r);
    return {
      parts: parts,
      error: first ? errorInfo(first, first.line) : null,
      exit: { code: run.res.exit, exited: false },
      results: results
    };
  }
  function errorInfo(e, line) { return { text: e.message, type: e.category || "RuntimeException", line: line || e.line || null, message: e.message }; }

  // Learner-facing explanations for PowerShell errors (by category, or by the message).
  var EXPLAIN = {
    CommandNotFound: "PowerShell doesn't know that command. Check the spelling (Verb-Noun, e.g. Get-Service), or use Get-Command to find the right name.",
    ParseError: "PowerShell couldn't read this line: usually a missing quote, bracket or brace, or a { that isn't closed.",
    InvalidOperation: "This usually means a variable is $null (empty) where you expected an object. Check it was set, and print it to see what's in it.",
    DivideByZero: "Something was divided by zero.",
    ObjectNotFound: "The thing you asked for (a file, service, process or user) doesn't exist, or the name is spelled differently.",
    InvalidData: "A parameter's validation rejected the value (for example ValidateSet or ValidateRange).",
    StepLimit: "Your script never finished. Look for a while/do loop whose condition never changes, or a for loop that never reaches its end."
  };
  function explainFn(err) {
    var m = err.message || err.text || "";
    if (/Variable reference is not valid/.test(m)) return "Inside a double-quoted string, $name: makes PowerShell read the colon as part of the variable name (like $env:PATH). Write ${name}: or $($name): instead.";
    if (/A parameter cannot be found that matches parameter name/.test(m)) return "That command has no parameter with that name. Check Get-Help <command> for its parameters, and the spelling.";
    if (/positional parameter cannot be found/.test(m)) return "The command got more values than it has parameters for. Often a missing comma between values, or text with spaces that needs quotes.";
    if (/missing mandatory parameters/.test(m)) return "A Mandatory parameter wasn't given. Pass it by name, e.g. -Name 'web'.";
    if (/Cannot convert value/.test(m)) return "PowerShell couldn't turn that value into the type it needed (e.g. text that isn't a number into [int]).";
    if (/Unexpected token .* In an expression, text needs quotes/.test(m)) return "In an expression (after =, inside ( ), in a condition), words need quotes, and commands need parentheses around them.";
    return null;
  }

  var runner = {
    ready: false,
    start: function (hooks) {
      this.ready = true;
      hooks.setStatus("ok", "PowerShell 7.4 (simulated) ready");
      hooks.enableRun();
    },
    call: function (msg) {
      return new Promise(function (res) { setTimeout(function () { res(handle(msg)); }, 0); });
    }
  };

  /* ---------------- check helpers (H) */
  var H = {
    plain: plain, show: show, same: same,
    // Variable must equal want (plain JS value). Optional type: "array", "string", "number", "boolean", "object".
    expect: function (r, name, want, type) {
      var v = r.v(name);
      if (v === undefined) return "I can't find a variable called $" + name + " yet.";
      if (type === "array" && !Array.isArray(v)) return "$" + name + " should be an array (a list), but it's " + show(v) + ". (One item on its own isn't an array: wrap it in @( ).)";
      if (type === "string" && typeof v !== "string") return "$" + name + " should be a string, but it's " + show(v) + ".";
      if (type === "number" && typeof v !== "number") return "$" + name + " should be a number, but it's " + show(v) + (typeof v === "string" ? " (text: in quotes)." : ".");
      if (type === "boolean" && typeof v !== "boolean") return "$" + name + " should be $true or $false, but it's " + show(v) + ".";
      if (!same(plain(v), want)) return "$" + name + " should be " + show(want) + ", but it's " + show(v) + ".";
      return true;
    },
    // Re-run with the first match of pattern replaced, and check variables again (catches typed-in answers).
    alt: function (r, pattern, repl, wants, label) {
      var re = new RegExp(pattern, "i");
      if (!re.test(r.src)) return true;
      var r2 = r.run(r.src.replace(re, function () { return repl; }));
      var keys = Object.keys(wants);
      for (var k = 0; k < keys.length; k++) {
        var got = r2.v(keys[k]);
        if (!same(plain(got), wants[keys[k]])) {
          return "It works for this example, but when I changed it to " + label + ", $" + keys[k] + " came out as " + show(got) + " instead of " + show(wants[keys[k]]) + ". Build the answer from the data instead of typing it in.";
        }
      }
      return true;
    },
    printed: function (r, want) {
      var got = r.lines;
      if (same(got, want)) return true;
      if (!got.length) return "Nothing was printed. Expected:\n  " + want.join("\n  ");
      return "Expected:\n  " + want.join("\n  ") + "\nYou printed:\n  " + got.slice(0, 10).join("\n  ");
    },
    // Run a PowerShell call in the finished session and compare its (plain) result.
    call: function (r, code, want) {
      if (!r.fn(code.split(/\s/)[0]) && /^[A-Za-z]+-[A-Za-z]+/.test(code) && !E.findCommand(code.split(/\s/)[0], { session: r.session })) return "I can't find a function called " + code.split(/\s/)[0] + ".";
      var res = r.ps(code);
      if (res.errors.length) return code + " failed: " + res.errors[0];
      if (!same(res.value, want)) return code + " should return " + show(want) + ", but returned " + show(res.raw) + ".";
      return true;
    },
    fnExists: function (r, name) { return r.fn(name) ? true : "I can't find a function called " + name + ". Define it with: function " + name + " { ... }"; }
  };

  root.PSLab = { runner: runner, handle: handle, runCode: runCode, makeCtx: makeCtx, runChecks: runChecks, H: H, explain: EXPLAIN, explainFn: explainFn, plain: plain, show: show, same: same };
  if (typeof module !== "undefined" && module.exports) module.exports = root.PSLab;
})(typeof window !== "undefined" ? window : globalThis);
