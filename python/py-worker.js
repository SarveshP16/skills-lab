/* sudo learn — Python runner.
   Runs Pyodide (real CPython compiled to WebAssembly) inside a Web Worker so the page
   stays responsive and a runaway loop can be stopped by terminating the worker. */
"use strict";

var PYODIDE_URL = "https://cdn.jsdelivr.net/pyodide/v0.27.2/full/";
importScripts(PYODIDE_URL + "pyodide.js");

var HARNESS = String.raw`
import sys, io, json, re, traceback, builtins, contextlib, linecache

_SL = {"ns": {"__name__": "__main__"}}
_REAL_INPUT = builtins.input


def _remember(name, src):
    """Let tracebacks show the learner's source lines for code compiled from a string."""
    linecache.cache[name] = (len(src), None, src.splitlines(True), name)


def _short(v, n=80):
    s = repr(v)
    return s if len(s) <= n else s[: n - 3] + "..."


def _limit(s, n=20000):
    return s if len(s) <= n else s[:n] + "\n... (output cut off after 20,000 characters)"


def _fmt_exc(e):
    """Traceback that only shows the learner's own code, plus the error type and the line number."""
    label = {"<your code>": "your code", "<console>": "console"}
    if isinstance(e, SyntaxError):
        text = (e.text or "").rstrip("\n")
        stripped = text.lstrip()
        indent = len(text) - len(stripped)
        where = label.get(e.filename, "your code")
        out = ["  " + where + ", line " + str(e.lineno)]
        if stripped:
            out.append("    " + stripped)
            if e.offset:
                out.append("    " + " " * max(0, e.offset - 1 - indent) + "^")
        out.append(type(e).__name__ + ": " + str(e.msg))
        return "\n".join(out), type(e).__name__, e.lineno if e.filename == "<your code>" else None
    frames = [f for f in traceback.extract_tb(e.__traceback__) if f.filename in label]
    out = []
    if frames:
        out.append("Traceback (most recent call last):")
        for f in frames:
            where = label[f.filename] + ", line " + str(f.lineno)
            if f.name != "<module>":
                where += ", in " + f.name
            out.append("  " + where)
            if f.line:
                out.append("    " + f.line.strip())
    msg = str(e)
    out.append(type(e).__name__ + (": " + msg if msg else ""))
    line = None
    for f in reversed(frames):
        if f.filename == "<your code>":
            line = f.lineno
            break
    return "\n".join(out), type(e).__name__, line


def _make_input(queue):
    def _input(prompt=""):
        if not queue:
            raise EOFError("input() asked for a value, but the Input box has no more lines")
        value = queue.pop(0)
        print(str(prompt) + value)
        return value
    return _input


def _exec_user(src, prelude, stdin):
    ns = {"__name__": "__main__"}
    buf = io.StringIO()
    err = None
    builtins.input = _make_input(list(stdin or []))
    _remember("<your code>", src)
    with contextlib.redirect_stdout(buf), contextlib.redirect_stderr(buf):
        try:
            if prelude:
                exec(compile(prelude, "<prelude>", "exec"), ns)
            exec(compile(src, "<your code>", "exec"), ns)
        except SystemExit:
            pass
        except BaseException as e:
            err = _fmt_exc(e)
    return ns, buf.getvalue(), err


class H:
    """Helpers available to lab checks."""
    short = staticmethod(_short)

    @staticmethod
    def lines(out):
        return [l.rstrip() for l in out.splitlines() if l.strip()]

    @staticmethod
    def call(fn, *a, **k):
        try:
            with contextlib.redirect_stdout(io.StringIO()):
                return True, fn(*a, **k)
        except Exception as e:
            return False, e

    @staticmethod
    def fn(ns, name):
        f = ns.get(name)
        return f if callable(f) else None

    @staticmethod
    def sub(src, pattern, repl):
        new, n = re.subn(pattern, lambda m: repl, src, count=1, flags=re.S)
        return new if n else None

    @staticmethod
    def expect(ns, name, want, typ=None):
        if name not in ns:
            return "I can't find a variable called " + name + " yet."
        v = ns[name]
        if typ is not None and type(v) is not typ:
            return name + " should be a " + typ.__name__ + ", but it's a " + type(v).__name__ + ": " + _short(v)
        if v != want:
            return name + " should be " + _short(want) + ", but it's " + _short(v) + "."
        return True

    @staticmethod
    def alt(src, run, pattern, replacement, wants, label):
        """Re-run the learner's code with different input data to make sure answers aren't typed in by hand."""
        new = H.sub(src, pattern, replacement)
        if new is None:
            return True
        n, o, e = run(new)
        for name, want in wants.items():
            got = n.get(name, "(missing)")
            if got != want:
                return ("It works for this example, but when I changed it to " + label + ", " + name +
                        " came out as " + _short(got) + " instead of " + _short(want) +
                        ". Build the answer from the data instead of typing it in.")
        return True

    # ---- One-line checks used by practice drills ----

    @staticmethod
    def vars(ns, src, run, wants, alts=()):
        """Variables must have these values; each alt re-runs with changed data: (pattern, repl, wants, label)."""
        for k, v in wants.items():
            r = H.expect(ns, k, v)
            if r is not True:
                return r
        for pattern, repl, want2, label in alts:
            r = H.alt(src, run, pattern, repl, want2, label)
            if r is not True:
                return r
        return True

    @staticmethod
    def func(ns, name, cases):
        """Call function NAME with each (args_tuple, expected) case."""
        f = H.fn(ns, name)
        if not f:
            return "I can't find a function called " + name + "."
        for args, want in cases:
            ok, got = H.call(f, *args)
            call = name + "(" + ", ".join(repr(a) for a in args) + ")"
            if not ok:
                return call + " crashed: " + type(got).__name__ + ": " + str(got)
            if got is None and want is not None:
                return call + " returned None. Use return, not print."
            if got != want or (type(want) is bool) != (type(got) is bool):
                return call + " returned " + _short(got) + ", expected " + _short(want) + "."
        return True

    @staticmethod
    def printed(out, want):
        """The printed lines must be exactly WANT."""
        got = H.lines(out)
        if got != want:
            if not got:
                return "Nothing was printed. Expected:\n  " + "\n  ".join(want)
            return "Expected:\n  " + "\n  ".join(want) + "\nYou printed:\n  " + "\n  ".join(got[:8])
        return True

    @staticmethod
    def values(src, run, pattern, fmt, cases, var=None):
        """Swap each test value into the line matching PATTERN and re-run.
        Compares variable VAR if given, otherwise the printed output (one line)."""
        for value, want in cases:
            line = fmt % (value,)
            new = H.sub(src, pattern, line)
            if new is None:
                return "Keep the line that sets the starting value, so I can test other values."
            n, o, e = run(new)
            if e:
                return "With " + line + " your code crashed: " + e[0].splitlines()[-1]
            if var:
                got = n.get(var, "(missing)")
                if got != want:
                    return "With " + line + ", " + var + " should be " + _short(want) + " but it's " + _short(got) + "."
            else:
                got = H.lines(o)
                if got != [want]:
                    return "With " + line + " expected only " + _short(want) + " to be printed, got " + (_short(got) if got else "nothing") + "."
        return True


def _sl_run(src, prelude, stdin_json, checks_json):
    stdin = json.loads(stdin_json)
    checks = json.loads(checks_json)
    ns, out, err = _exec_user(src, prelude, stdin)
    _SL["ns"] = ns

    def run(code=None, stdin=None):
        return _exec_user(src if code is None else code, prelude, stdin or [])

    results = []
    for c in checks:
        cns = {"re": re, "json": json, "H": H}
        try:
            exec(compile(c["code"], "<check>", "exec"), cns)
            with contextlib.redirect_stdout(io.StringIO()):
                r = cns["check"](ns, out, run, src)
            if r is True:
                results.append({"id": c["id"], "pass": True})
            else:
                results.append({"id": c["id"], "pass": False, "msg": r if isinstance(r, str) else ""})
        except Exception as e:
            results.append({"id": c["id"], "pass": False, "msg": "Couldn't check this yet (" + type(e).__name__ + ": " + str(e) + ")"})
    builtins.input = _make_input([])
    return json.dumps({
        "out": _limit(out),
        "error": None if err is None else {"text": err[0], "type": err[1], "line": err[2]},
        "results": results,
    })


def _sl_repl(src):
    ns = _SL["ns"]
    buf = io.StringIO()
    err = None
    builtins.input = _make_input([])
    _remember("<console>", src)
    with contextlib.redirect_stdout(buf), contextlib.redirect_stderr(buf):
        try:
            try:
                code = compile(src, "<console>", "eval")
            except SyntaxError:
                code = None
            if code is not None:
                v = eval(code, ns)
                if v is not None:
                    print(repr(v))
            else:
                exec(compile(src, "<console>", "exec"), ns)
        except SystemExit:
            pass
        except BaseException as e:
            err = _fmt_exc(e)
    return json.dumps({
        "out": _limit(buf.getvalue()),
        "error": None if err is None else {"text": err[0], "type": err[1], "line": None},
    })
`;

var py = null;
var ready = (async function () {
  py = await loadPyodide({ indexURL: PYODIDE_URL });
  py.runPython(HARNESS);
  var v = py.runPython("import sys; '%d.%d' % sys.version_info[:2]");
  postMessage({ type: "ready", python: v });
})().catch(function (e) {
  postMessage({ type: "fatal", error: String(e && e.message || e) });
});

function writeFiles(files, remove) {
  Object.keys(files || {}).forEach(function (p) { py.FS.writeFile(p, files[p]); });
  (remove || []).forEach(function (p) { try { py.FS.unlink(p); } catch (_) { /* not there */ } });
}

onmessage = async function (e) {
  var msg = e.data;
  try {
    await ready;
    if (!py) throw new Error("Python failed to load");
    if (msg.type === "run") {
      writeFiles(msg.files, msg.removeFiles);
      var fn = py.globals.get("_sl_run");
      var res = fn(msg.code, msg.prelude || "", JSON.stringify(msg.stdin || []), JSON.stringify(msg.checks || []));
      fn.destroy();
      postMessage({ type: "result", id: msg.id, data: JSON.parse(res) });
    } else if (msg.type === "repl") {
      writeFiles(msg.files, msg.removeFiles);
      var r = py.globals.get("_sl_repl");
      var out = r(msg.code);
      r.destroy();
      postMessage({ type: "result", id: msg.id, data: JSON.parse(out) });
    }
  } catch (err) {
    postMessage({ type: "result", id: msg.id, data: { internal: String(err && err.message || err) } });
  }
};
