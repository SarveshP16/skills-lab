/* sudo learn — Python Module 4 practice drills: 3 short optional exercises per lab (+5 XP each).
   Same format as drills.js. Loaded after labs-m4.js and reuses its simulators (T.M4). */
(function () {
  "use strict";
  var T = window.PY_TRACK;
  var py = T.py;
  var M4 = T.M4;
  var NL = "\n\n";
  var QUIET = py`
    import sys as _s, io as _io, contextlib as _cl

    def shell_log(fn, *args):
        log = _s.__dict__.setdefault("_sl_shell_log", [])
        del log[:]
        try:
            with _cl.redirect_stdout(_io.StringIO()):
                return True, fn(*args), list(log)
        except Exception as e:
            return False, e, list(log)
  ` + NL;

  var DRILLS = {
    "py-128": [
      {
        id: "d1", title: "Parameterize a count",
        text: "<p>Rewrite <code>count_orders</code> with a <code>?</code> parameter so names with quotes work and injection doesn't.</p>",
        prelude: M4.MAKE_DB,
        starter: py`
          db = make_db()


          def count_orders(customer):
              return db.execute(f"SELECT COUNT(*) FROM orders WHERE customer = '{customer}'").fetchone()[0]
        `,
        solution: py`
          db = make_db()


          def count_orders(customer):
              return db.execute("SELECT COUNT(*) FROM orders WHERE customer = ?", (customer,)).fetchone()[0]
        `,
        check: py`
          def check(ns, out, run, src):
              return H.func(ns, "count_orders", [(("ana",), 2), (("o'brien",), 1), (("' OR '1'='1",), 0), (("x' OR 1=1 --",), 0)])
        `
      },
      {
        id: "d2", title: "Two parameters",
        text: "<p>Write <code>users_with_role(role, prefix)</code>: the sorted usernames with that role whose name starts with <code>prefix</code>. Use two <code>?</code> parameters (and <code>LIKE ?</code> with <code>prefix + \"%\"</code>).</p>",
        prelude: M4.MAKE_DB,
        starter: py`
          db = make_db()


          def users_with_role(role, prefix):
              pass
        `,
        solution: py`
          db = make_db()


          def users_with_role(role, prefix):
              rows = db.execute("SELECT username FROM users WHERE role = ? AND username LIKE ? ORDER BY username",
                                (role, prefix + "%")).fetchall()
              return [r[0] for r in rows]
        `,
        check: py`
          def check(ns, out, run, src):
              r = H.func(ns, "users_with_role", [(("customer", ""), ["ana", "o'brien"]), (("customer", "o'"), ["o'brien"]), (("sre", "m"), ["maya"]),
                                                  (("admin", "z"), []), (("customer", "' OR '1'='1"), [])])
              if r is not True:
                  return r
              if "f\"SELECT" in src or "f'SELECT" in src:
                  return "Use ? parameters instead of an f-string."
              return True
        `
      },
      {
        id: "d3", title: "Spot the injectable ones",
        text: "<p>Read the four functions and set <code>injectable</code> to the sorted list of the names of those that are open to SQL injection.</p>",
        starter: py`
          def by_id(db, order_id):
              return db.execute("SELECT * FROM orders WHERE id = ?", (order_id,)).fetchall()


          def by_name(db, name):
              return db.execute("SELECT * FROM users WHERE username = '%s'" % name).fetchall()


          def total(db):
              return db.execute("SELECT COUNT(*) FROM orders").fetchone()[0]


          def by_day(db, day):
              return db.execute("SELECT * FROM events WHERE day = '" + day + "'").fetchall()


          injectable = []
        `,
        solution: py`
          def by_id(db, order_id):
              return db.execute("SELECT * FROM orders WHERE id = ?", (order_id,)).fetchall()


          def by_name(db, name):
              return db.execute("SELECT * FROM users WHERE username = '%s'" % name).fetchall()


          def total(db):
              return db.execute("SELECT COUNT(*) FROM orders").fetchone()[0]


          def by_day(db, day):
              return db.execute("SELECT * FROM events WHERE day = '" + day + "'").fetchall()


          injectable = ["by_day", "by_name"]
        `,
        check: py`
          def check(ns, out, run, src):
              got = ns.get("injectable")
              if isinstance(got, list) and "total" in got:
                  return "total uses a fixed query with no input at all, so nothing can be injected."
              if isinstance(got, list) and "by_id" in got:
                  return "by_id passes the value as a ? parameter: that one's safe."
              return H.expect(ns, "injectable", ["by_day", "by_name"], list)
        `
      }
    ],

    "py-129": [
      {
        id: "d1", title: "No shell",
        text: "<p>Rewrite <code>lookup</code> to run <code>nslookup</code> with <code>subprocess.run</code> and a list (with a <code>timeout</code>), so nothing in <code>domain</code> can start another command.</p>",
        prelude: M4.FAKE_SHELL,
        starter: py`
          import os
          import subprocess


          def lookup(domain):
              os.system(f"nslookup {domain}")
        `,
        solution: py`
          import os
          import subprocess


          def lookup(domain):
              subprocess.run(["nslookup", domain], timeout=10)
        `,
        check: QUIET + py`
          def check(ns, out, run, src):
              f = H.fn(ns, "lookup")
              ok, got, log = shell_log(f, "kestrel.io")
              if log != ["nslookup kestrel.io"]:
                  return "lookup(\"kestrel.io\") should run nslookup kestrel.io, but ran " + H.short(log) + (" (" + type(got).__name__ + ": " + str(got) + ")" if not ok else "") + "."
              for a in ["kestrel.io; id", "kestrel.io && cat /etc/passwd", "$(whoami)"]:
                  ok, got, log = shell_log(f, a)
                  bad = [c for c in log if not c.startswith("nslookup")]
                  if bad:
                      return "lookup(" + repr(a) + ") also ran " + ", ".join(bad) + ". Pass a list and don't use shell=True."
              if "timeout" not in src:
                  return "Add a timeout= to subprocess.run."
              return True
        `
      },
      {
        id: "d2", title: "An allowlist",
        text: "<p>Write <code>restart(service)</code>: raise <code>ValueError</code> unless <code>service</code> is in <code>SERVICES</code>, then run <code>systemctl restart &lt;service&gt;</code> with a list.</p>",
        prelude: M4.FAKE_SHELL,
        starter: py`
          import subprocess

          SERVICES = {"nginx", "api", "worker"}


          def restart(service):
              pass
        `,
        solution: py`
          import subprocess

          SERVICES = {"nginx", "api", "worker"}


          def restart(service):
              if service not in SERVICES:
                  raise ValueError(f"unknown service: {service!r}")
              subprocess.run(["systemctl", "restart", service], timeout=30)
        `,
        check: QUIET + py`
          def check(ns, out, run, src):
              f = H.fn(ns, "restart")
              if not f:
                  return "I can't find restart."
              ok, got, log = shell_log(f, "api")
              if log != ["systemctl restart api"]:
                  return "restart(\"api\") should run systemctl restart api, but ran " + H.short(log) + "."
              for a in ["api; whoami", "sshd", "nginx --force", ""]:
                  ok, got, log = shell_log(f, a)
                  if ok or not isinstance(got, ValueError) or log:
                      return "restart(" + repr(a) + ") should raise ValueError before running anything."
              return True
        `
      },
      {
        id: "d3", title: "literal_eval, not eval",
        text: "<p>Make <code>parse_ports(text)</code> safe with <code>ast.literal_eval</code>: <code>\"[22, 80, 443]\"</code> still works, code doesn't run.</p>",
        prelude: M4.FAKE_SHELL,
        starter: py`
          import ast


          def parse_ports(text):
              return eval(text)
        `,
        solution: py`
          import ast


          def parse_ports(text):
              return ast.literal_eval(text)
        `,
        check: QUIET + py`
          def check(ns, out, run, src):
              f = H.fn(ns, "parse_ports")
              ok, got, log = shell_log(f, "[22, 80, 443]")
              if not ok or got != [22, 80, 443]:
                  return "parse_ports(\"[22, 80, 443]\") should give [22, 80, 443]."
              for a in ['__import__("os").system("id")', "[x for x in range(3)]", "len('abc')"]:
                  ok, got, log = shell_log(f, a)
                  if ok or log:
                      return "parse_ports(" + repr(a) + ") still ran code. Use ast.literal_eval."
              return True
        `
      }
    ],

    "py-130": [
      {
        id: "d1", title: "Escape a table row",
        text: "<p>Make <code>row(name, note)</code> escape both values. <code>row(\"ana\", \"a < b\")</code> should be <code>&lt;tr&gt;&lt;td&gt;ana&lt;/td&gt;&lt;td&gt;a &amp;lt; b&lt;/td&gt;&lt;/tr&gt;</code>.</p>",
        prelude: M4.FAKE_BROWSER,
        starter: py`
          import html


          def row(name, note):
              return f"<tr><td>{name}</td><td>{note}</td></tr>"
        `,
        solution: py`
          import html


          def row(name, note):
              return f"<tr><td>{html.escape(name)}</td><td>{html.escape(note)}</td></tr>"
        `,
        check: py`
          def check(ns, out, run, src):
              r = H.func(ns, "row", [(("ana", "a < b"), "<tr><td>ana</td><td>a &lt; b</td></tr>"),
                                     (("<script>x()</script>", "&"), "<tr><td>&lt;script&gt;x()&lt;/script&gt;</td><td>&amp;</td></tr>")])
              return r
        `
      },
      {
        id: "d2", title: "Escape an attribute",
        text: "<p>Make <code>avatar(url, alt)</code> safe: use <code>url</code> only if it starts with <code>https://</code> (otherwise <code>/default.png</code>), and escape both values, including quotes.</p>",
        prelude: M4.FAKE_BROWSER,
        starter: py`
          import html


          def avatar(url, alt):
              return f'<img src="{url}" alt="{alt}">'
        `,
        solution: py`
          import html


          def avatar(url, alt):
              if not url.startswith("https://"):
                  url = "/default.png"
              return f'<img src="{html.escape(url)}" alt="{html.escape(alt)}">'
        `,
        check: py`
          def check(ns, out, run, src):
              f = H.fn(ns, "avatar")
              r = H.func(ns, "avatar", [(("https://cdn.kestrel.io/a.png", "Ana"), '<img src="https://cdn.kestrel.io/a.png" alt="Ana">'),
                                        (("javascript:alert(1)", "x"), '<img src="/default.png" alt="x">')])
              if r is not True:
                  return r
              ok, page = H.call(f, "https://x.io/a.png", '" onerror="alert(1)')
              if not ok or "onerror=" in page.replace("&quot; onerror=&quot;", ""):
                  return "An alt of \" onerror=\"alert(1) breaks out of the attribute. html.escape escapes quotes too: use it on alt."
              return True
        `
      },
      {
        id: "d3", title: "Is this URL safe?",
        text: "<p>Write <code>is_safe_url(url)</code>: <code>True</code> only when the scheme (from <code>urlparse</code>, after <code>strip()</code>, lowercased) is <code>http</code> or <code>https</code>.</p>",
        starter: py`
          from urllib.parse import urlparse


          def is_safe_url(url):
              pass
        `,
        solution: py`
          from urllib.parse import urlparse


          def is_safe_url(url):
              return urlparse(url.strip()).scheme.lower() in ("http", "https")
        `,
        check: py`
          def check(ns, out, run, src):
              return H.func(ns, "is_safe_url", [(("https://kestrel.io",), True), (("HTTP://kestrel.io",), True), (("javascript:alert(1)",), False),
                                                (("  JavaScript:alert(1)",), False), (("data:text/html,x",), False), (("/relative/path",), False), (("ftp://x",), False)])
        `
      }
    ],

    "py-131": [
      {
        id: "d1", title: "Inside or not?",
        text: "<p>Write <code>inside(base, name)</code>: <code>True</code> if <code>base / name</code>, resolved, is inside <code>base</code> (resolved). The files don't have to exist.</p>",
        starter: py`
          from pathlib import Path


          def inside(base, name):
              pass
        `,
        solution: py`
          from pathlib import Path


          def inside(base, name):
              root = Path(base).resolve()
              return (root / name).resolve().is_relative_to(root)
        `,
        check: py`
          def check(ns, out, run, src):
              return H.func(ns, "inside", [(("public", "a.txt"), True), (("public", "docs/../a.txt"), True), (("public", "../a.txt"), False),
                                           (("public", "../public-old/a.txt"), False), (("public", "/etc/passwd"), False)])
        `
      },
      {
        id: "d2", title: "Just the file name",
        text: "<p>Write <code>clean(name)</code>: return only the last part of the path (<code>Path(name).name</code>), and raise <code>ValueError</code> if that's empty, <code>.</code> or <code>..</code>.</p>",
        starter: py`
          from pathlib import Path


          def clean(name):
              pass
        `,
        solution: py`
          from pathlib import Path


          def clean(name):
              base = Path(name).name
              if base in ("", ".", ".."):
                  raise ValueError(f"bad file name: {name!r}")
              return base
        `,
        check: py`
          def check(ns, out, run, src):
              r = H.func(ns, "clean", [(("report.pdf",), "report.pdf"), (("../../etc/passwd",), "passwd"), (("a/b/c.txt",), "c.txt")])
              if r is not True:
                  return r
              f = ns["clean"]
              for bad in ["", "..", "a/..", "."]:
                  ok, got = H.call(f, bad)
                  if ok or not isinstance(got, ValueError):
                      return "clean(" + repr(bad) + ") should raise ValueError."
              return True
        `
      },
      {
        id: "d3", title: "Safe open",
        text: "<p>Write <code>read_public(name)</code>: return the text of a file inside <code>public</code>, and raise <code>PermissionError</code> for anything outside it.</p>",
        files: { "public/faq.txt": "Q: Is it safe?\n", "secret.txt": "the key\n" },
        starter: py`
          from pathlib import Path

          BASE = Path("public")


          def read_public(name):
              pass
        `,
        solution: py`
          from pathlib import Path

          BASE = Path("public")


          def read_public(name):
              base = BASE.resolve()
              path = (base / name).resolve()
              if not path.is_relative_to(base):
                  raise PermissionError(name)
              return path.read_text()
        `,
        check: py`
          def check(ns, out, run, src):
              f = H.fn(ns, "read_public")
              ok, got = H.call(f, "faq.txt")
              if not ok or not isinstance(got, str) or "Is it safe" not in got:
                  return "read_public(\"faq.txt\") should return the FAQ text."
              for bad in ["../secret.txt", "/etc/passwd", "../public/../secret.txt"]:
                  ok, got = H.call(f, bad)
                  if ok or not isinstance(got, PermissionError):
                      return "read_public(" + repr(bad) + ") should raise PermissionError."
              return True
        `
      }
    ],

    "py-132": [
      {
        id: "d1", title: "Owner or admin",
        text: "<p>Write <code>can_edit(user, doc)</code>: <code>True</code> if the user owns the doc or their role in <code>ROLES</code> is <code>admin</code>. Unknown users: <code>False</code>.</p>",
        starter: py`
          ROLES = {"ana": "member", "ben": "member", "root": "admin"}


          def can_edit(user, doc):
              pass
        `,
        solution: py`
          ROLES = {"ana": "member", "ben": "member", "root": "admin"}


          def can_edit(user, doc):
              if user not in ROLES:
                  return False
              return doc["owner"] == user or ROLES[user] == "admin"
        `,
        check: py`
          def check(ns, out, run, src):
              d = {"owner": "ana"}
              return H.func(ns, "can_edit", [(("ana", d), True), (("ben", d), False), (("root", d), True), (("mallory", d), False), (("mallory", {"owner": "mallory"}), False)])
        `
      },
      {
        id: "d2", title: "Deny by default",
        text: "<p>Write <code>allowed(role, action)</code> using <code>PERMISSIONS</code>. Unknown roles and actions are <code>False</code>.</p>",
        starter: py`
          PERMISSIONS = {
              "viewer": {"read"},
              "editor": {"read", "write"},
              "admin": {"read", "write", "delete"},
          }


          def allowed(role, action):
              pass
        `,
        solution: py`
          PERMISSIONS = {
              "viewer": {"read"},
              "editor": {"read", "write"},
              "admin": {"read", "write", "delete"},
          }


          def allowed(role, action):
              return action in PERMISSIONS.get(role, set())
        `,
        check: py`
          def check(ns, out, run, src):
              return H.func(ns, "allowed", [(("viewer", "read"), True), (("viewer", "write"), False), (("admin", "delete"), True),
                                            (("editor", "delete"), False), (("guest", "read"), False), (("admin", "export"), False)])
        `
      },
      {
        id: "d3", title: "The same error for both",
        text: "<p>Write <code>get_doc(user, doc_id)</code>: return the doc if <code>user</code> owns it; raise <code>PermissionError</code> if they don't <b>and</b> if the id doesn't exist.</p>",
        starter: py`
          DOCS = {"d1": {"owner": "ana", "title": "Q3 plan"}, "d2": {"owner": "ben", "title": "Salaries"}}


          def get_doc(user, doc_id):
              pass
        `,
        solution: py`
          DOCS = {"d1": {"owner": "ana", "title": "Q3 plan"}, "d2": {"owner": "ben", "title": "Salaries"}}


          def get_doc(user, doc_id):
              doc = DOCS.get(doc_id)
              if doc is None or doc["owner"] != user:
                  raise PermissionError("not found")
              return doc
        `,
        check: py`
          def check(ns, out, run, src):
              f = H.fn(ns, "get_doc")
              ok, got = H.call(f, "ana", "d1")
              if not ok or not isinstance(got, dict) or got.get("title") != "Q3 plan":
                  return "get_doc(\"ana\", \"d1\") should return ana's doc."
              for args in [("ana", "d2"), ("ana", "d9"), ("eve", "d1")]:
                  ok, got = H.call(f, *args)
                  if ok or not isinstance(got, PermissionError):
                      return "get_doc" + repr(args) + " should raise PermissionError" + (", not " + type(got).__name__ if not ok else "") + "."
              return True
        `
      }
    ],

    "py-133": [
      {
        id: "d1", title: "JSON, not pickle",
        text: "<p>Rewrite <code>save</code> and <code>load</code> to use <code>json</code> instead of <code>pickle</code> (strings in, strings out).</p>",
        starter: py`
          import json
          import pickle


          def save(data):
              return pickle.dumps(data).hex()


          def load(text):
              return pickle.loads(bytes.fromhex(text))
        `,
        solution: py`
          import json
          import pickle


          def save(data):
              return json.dumps(data)


          def load(text):
              return json.loads(text)
        `,
        check: py`
          def check(ns, out, run, src):
              import pickle
              s, l = H.fn(ns, "save"), H.fn(ns, "load")
              d = {"user": "ana", "tags": ["a", "b"], "n": 3}
              ok, t = H.call(s, d)
              if not ok or not isinstance(t, str) or H.call(l, t)[1] != d:
                  return "load(save(data)) should give the data back, and save should return a string."
              ok, got = H.call(l, pickle.dumps({"x": 1}).hex())
              if ok:
                  return "load still accepts pickled data. Use json.loads."
              if "pickle.loads" in src or "pickle.dumps" in src:
                  return "Remove pickle from save and load."
              return True
        `
      },
      {
        id: "d2", title: "Sign a message",
        text: "<p>Write <code>sign(message)</code>: the HMAC-SHA256 hex digest of the message (a string) with <code>KEY</code>.</p>",
        starter: py`
          import hashlib
          import hmac

          KEY = b"drill-key"


          def sign(message):
              pass
        `,
        solution: py`
          import hashlib
          import hmac

          KEY = b"drill-key"


          def sign(message):
              return hmac.new(KEY, message.encode(), hashlib.sha256).hexdigest()
        `,
        check: py`
          def check(ns, out, run, src):
              import hmac, hashlib
              cases = [((m,), hmac.new(b"drill-key", m.encode(), hashlib.sha256).hexdigest()) for m in ["hello", "role=admin", ""]]
              r = H.func(ns, "sign", cases)
              if r is not True and "returned '" in r:
                  ok, got = H.call(ns["sign"], "hello")
                  if ok and got == hashlib.sha256(b"drill-key" + b"hello").hexdigest():
                      return "That's sha256(key + message), which is not an HMAC. Use hmac.new(KEY, message.encode(), hashlib.sha256)."
              return r
        `
      },
      {
        id: "d3", title: "Verify a signature",
        text: "<p>Write <code>verify(message, signature)</code>: <code>True</code> if the signature is right, using <code>hmac.compare_digest</code>.</p>",
        starter: py`
          import hashlib
          import hmac

          KEY = b"drill-key"


          def verify(message, signature):
              pass
        `,
        solution: py`
          import hashlib
          import hmac

          KEY = b"drill-key"


          def verify(message, signature):
              expected = hmac.new(KEY, message.encode(), hashlib.sha256).hexdigest()
              return hmac.compare_digest(expected, signature)
        `,
        check: py`
          def check(ns, out, run, src):
              import hmac, hashlib
              good = hmac.new(b"drill-key", b"role=customer", hashlib.sha256).hexdigest()
              r = H.func(ns, "verify", [(("role=customer", good), True), (("role=admin", good), False), (("role=customer", "0" * 64), False)])
              if r is not True:
                  return r
              if "compare_digest" not in src:
                  return "Use hmac.compare_digest instead of ==."
              return True
        `
      }
    ],

    "py-134": [
      {
        id: "d1", title: "Salt doesn't save weak passwords",
        text: "<p>Each user's hash is <code>sha256(salt + password)</code>. Salts stop precomputed tables, but not guessing. Set <code>cracked</code> to user → password using <code>WORDS</code>.</p>",
        starter: py`
          import hashlib

          WORDS = ["123456", "password", "dragon", "letmein", "monkey", "Summer2026!"]
          leaked = {
              "zoe": ("a1b2c3d4", "aea6e7ec6df698233a1b3a7cfef20f2d82c14de2adba8dae333a62f696d40237"),
          }

        `,
        solution: py`
          import hashlib

          WORDS = ["123456", "password", "dragon", "letmein", "monkey", "Summer2026!"]
          leaked = {
              "zoe": ("a1b2c3d4", "aea6e7ec6df698233a1b3a7cfef20f2d82c14de2adba8dae333a62f696d40237"),
          }
          cracked = {}
          for user, (salt, digest) in leaked.items():
              for word in WORDS:
                  if hashlib.sha256((salt + word).encode()).hexdigest() == digest:
                      cracked[user] = word
        `,
        check: py`
          def check(ns, out, run, src):
              import hashlib
              r = H.expect(ns, "cracked", {"zoe": "letmein"}, dict)
              if r is not True:
                  return r
              h = hashlib.sha256(b"99ffmonkey").hexdigest()
              return H.alt(src, run, r"\"zoe\":\s*\([^)]*\)", '"zoe": ("99ff", "' + h + '")', {"cracked": {"zoe": "monkey"}}, "a different salt and password")
        `
      },
      {
        id: "d2", title: "PBKDF2",
        text: "<p>Write <code>pbkdf2(password, salt)</code>: the hex of <code>hashlib.pbkdf2_hmac(\"sha256\", password.encode(), salt, 100_000)</code>. Another slow, salted KDF, built into Python.</p>",
        packages: ["hashlib"],
        starter: py`
          import hashlib


          def pbkdf2(password, salt):
              pass
        `,
        solution: py`
          import hashlib


          def pbkdf2(password, salt):
              return hashlib.pbkdf2_hmac("sha256", password.encode(), salt, 100_000).hex()
        `,
        check: py`
          def check(ns, out, run, src):
              import hashlib
              cases = [((pw, salt), hashlib.pbkdf2_hmac("sha256", pw.encode(), salt, 100000).hex()) for pw, salt in [("hunter2", b"0123456789abcdef"), ("", b"salt")]]
              return H.func(ns, "pbkdf2", cases)
        `
      },
      {
        id: "d3", title: "An API key generator",
        text: "<p>Write <code>api_key()</code>: <code>kc_live_</code> followed by 24 random lowercase hex characters from <code>secrets.token_hex</code>. (Recognise the format? It's what your PY-121 drill scanned for.)</p>",
        starter: py`
          import secrets


          def api_key():
              pass
        `,
        solution: py`
          import secrets


          def api_key():
              return "kc_live_" + secrets.token_hex(12)
        `,
        check: py`
          def check(ns, out, run, src):
              import re, random
              f = H.fn(ns, "api_key")
              keys = []
              for _ in range(20):
                  random.seed(7)
                  ok, k = H.call(f)
                  if not ok or not isinstance(k, str):
                      return "api_key() should return a string."
                  keys.append(k)
              if not all(re.fullmatch(r"kc_live_[0-9a-f]{24}", k) for k in keys):
                  return "Keys should look like kc_live_ + 24 lowercase hex characters, got " + repr(keys[0]) + ". secrets.token_hex(12) gives 24 hex characters."
              if len(set(keys)) < 20:
                  return "api_key() repeated itself when random was re-seeded: use secrets, not random."
              return True
        `
      }
    ],

    "py-135": [
      {
        id: "d1", title: "Find the sinks",
        text: "<p>Read <code>CODE</code> and set <code>dangerous</code> to the sorted line numbers (1 = the first line) that call a dangerous sink: shell, <code>eval</code> or <code>pickle</code>.</p>",
        starter: py`
          CODE = """import os, pickle, json
          os.system("backup " + name)
          data = json.loads(body)
          total = eval(request_text)
          print(f"Hello {name}")
          prefs = pickle.loads(cookie)
          """
          print(CODE)

          dangerous = []
        `,
        solution: py`
          CODE = """import os, pickle, json
          os.system("backup " + name)
          data = json.loads(body)
          total = eval(request_text)
          print(f"Hello {name}")
          prefs = pickle.loads(cookie)
          """
          print(CODE)

          dangerous = [2, 4, 6]
        `,
        check: py`
          def check(ns, out, run, src):
              got = ns.get("dangerous")
              if isinstance(got, list) and 3 in got:
                  return "json.loads only builds plain data, so line 3 is safe."
              if isinstance(got, list) and 5 in got:
                  return "Printing an f-string to the console isn't a sink (it would be if it went into HTML)."
              return H.expect(ns, "dangerous", [2, 4, 6], list)
        `
      },
      {
        id: "d2", title: "Name the bug",
        text: "<p>Set <code>bugs</code> to the category of each snippet, using the names from the lab: <code>\"sql injection\"</code>, <code>\"command injection\"</code>, <code>\"xss\"</code>, <code>\"path traversal\"</code>, <code>\"access control\"</code>, <code>\"insecure deserialization\"</code>.</p>",
        starter: py`
          snippets = {
              "a": 'open("/srv/files/" + request.args["f"]).read()',
              "b": 'return f"<li>{comment}</li>"',
              "c": 'yaml.load(upload, Loader=yaml.Loader)',
              "d": 'def close_account(user, account_id): ACCOUNTS.pop(account_id)',
          }

          bugs = {"a": "", "b": "", "c": "", "d": ""}
        `,
        solution: py`
          snippets = {
              "a": 'open("/srv/files/" + request.args["f"]).read()',
              "b": 'return f"<li>{comment}</li>"',
              "c": 'yaml.load(upload, Loader=yaml.Loader)',
              "d": 'def close_account(user, account_id): ACCOUNTS.pop(account_id)',
          }

          bugs = {"a": "path traversal", "b": "xss", "c": "insecure deserialization", "d": "access control"}
        `,
        check: py`
          def check(ns, out, run, src):
              want = {"a": "path traversal", "b": "xss", "c": "insecure deserialization", "d": "access control"}
              got = {k: str(v).strip().lower() for k, v in (ns.get("bugs") or {}).items()}
              right = sum(1 for k in want if got.get(k) == want[k])
              return True if right == 4 else str(right) + " of 4 right so far."
        `
      },
      {
        id: "d3", title: "One-line fix",
        text: "<p>Fix <code>load_job</code> so job files can't run code, while normal YAML still loads.</p>",
        prelude: M4.FAKE_SHELL,
        starter: py`
          import yaml


          def load_job(text):
              return yaml.load(text, Loader=yaml.Loader)
        `,
        solution: py`
          import yaml


          def load_job(text):
              return yaml.safe_load(text)
        `,
        check: QUIET + py`
          def check(ns, out, run, src):
              f = H.fn(ns, "load_job")
              ok, got, log = shell_log(f, "name: nightly\nretries: 2\n")
              if not ok or got != {"name": "nightly", "retries": 2}:
                  return "load_job should still load normal YAML."
              ok, got, log = shell_log(f, '!!python/object/apply:os.system ["id"]')
              if ok or log:
                  return "load_job still runs code from YAML. Use yaml.safe_load."
              return True
        `
      }
    ],

    "py-136": [
      {
        id: "d1", title: "Count the calls",
        text: "<p>Parse <code>code</code> with <code>ast</code> and set <code>calls</code> to how many <code>ast.Call</code> nodes it contains (<code>5</code>).</p>",
        starter: py`
          import ast

          code = """import os
          name = input("name? ")
          os.system("echo " + name.strip())
          print(len(name))
          """

        `,
        solution: py`
          import ast

          code = """import os
          name = input("name? ")
          os.system("echo " + name.strip())
          print(len(name))
          """
          calls = sum(1 for node in ast.walk(ast.parse(code)) if isinstance(node, ast.Call))
        `,
        check: py`
          def check(ns, out, run, src):
              r = H.expect(ns, "calls", 5, int)
              if r is not True:
                  return r
              new = src.replace("print(len(name))", "print(len(name), max(1, 2))")
              n, o, e = run(new)
              if n.get("calls") != 6:
                  return "With one more call in the code, calls should be 6. Count the nodes."
              return True
        `
      },
      {
        id: "d2", title: "Which functions are called?",
        text: "<p>Set <code>names</code> to the dotted names of the calls in <code>code</code>, sorted by line number then name, using <code>call_name</code>.</p>",
        starter: py`
          import ast


          def call_name(node):
              func = node.func
              if isinstance(func, ast.Name):
                  return func.id
              if isinstance(func, ast.Attribute):
                  prefix = func.value.id if isinstance(func.value, ast.Name) else "?"
                  return prefix + "." + func.attr
              return "?"


          code = """import pickle, hashlib
          h = hashlib.md5(data)
          obj = pickle.loads(blob)
          """

        `,
        solution: py`
          import ast


          def call_name(node):
              func = node.func
              if isinstance(func, ast.Name):
                  return func.id
              if isinstance(func, ast.Attribute):
                  prefix = func.value.id if isinstance(func.value, ast.Name) else "?"
                  return prefix + "." + func.attr
              return "?"


          code = """import pickle, hashlib
          h = hashlib.md5(data)
          obj = pickle.loads(blob)
          """
          found = [(node.lineno, call_name(node)) for node in ast.walk(ast.parse(code)) if isinstance(node, ast.Call)]
          names = [name for line, name in sorted(found)]
        `,
        check: py`
          def check(ns, out, run, src):
              return H.expect(ns, "names", ["hashlib.md5", "pickle.loads"], list)
        `
      },
      {
        id: "d3", title: "Find verify=False",
        text: "<p>Write <code>no_verify(source)</code>: the sorted line numbers of calls with a keyword argument <code>verify=False</code>.</p>",
        starter: py`
          import ast


          def no_verify(source):
              pass
        `,
        solution: py`
          import ast


          def no_verify(source):
              lines = []
              for node in ast.walk(ast.parse(source)):
                  if isinstance(node, ast.Call):
                      for k in node.keywords:
                          if k.arg == "verify" and isinstance(k.value, ast.Constant) and k.value.value is False:
                              lines.append(node.lineno)
              return sorted(lines)
        `,
        check: py`
          def check(ns, out, run, src):
              code = "import requests\nrequests.get(u, verify=False)\nrequests.get(u, verify=True)\nrequests.post(u,\n    json=d, verify=False)\n# requests.get(u, verify=False)\n"
              return H.func(ns, "no_verify", [((code,), [2, 4]), (("x = 1\n",), [])])
        `
      }
    ]
  };

  T.LABS.forEach(function (l) { if (DRILLS[l.id]) l.drills = DRILLS[l.id]; });
})();
