/* sudo learn — Python track content.
   Each lab: story (the ticket), learn (concept HTML; <pre class="ex"> blocks get a ▶ button that
   runs them in the console), starter code, objectives with Python checks, hints, debrief and quiz.

   A check is Python source defining check(ns, out, run, src) that returns True, or a string
   explaining what's wrong. ns = learner's variables, out = printed output, run(code, stdin) re-runs
   code, src = the learner's code. Helpers live in class H (see py-worker.js). */
(function () {
  "use strict";

  // Tagged template: keeps backslashes as typed and strips common indentation.
  function py(strings) {
    var vals = Array.prototype.slice.call(arguments, 1);
    var raw = String.raw.apply(null, [strings].concat(vals)).replace(/^\n/, "").replace(/\s+$/, "");
    var lines = raw.split("\n");
    var ind = Infinity;
    lines.forEach(function (l) { if (l.trim()) ind = Math.min(ind, l.match(/^ */)[0].length); });
    if (!isFinite(ind)) ind = 0;
    return lines.map(function (l) { return l.slice(ind); }).join("\n");
  }
  function ex(code) { return '<pre class="ex">' + esc(code) + "</pre>"; }
  function esc(s) { return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }

  var MODULES = [
    { n: 1, name: "Foundations" },
    { n: 2, name: "Working with data" },
    { n: 3, name: "Automation for DevSecOps" },
    { n: 4, name: "AppSec with Python" }
  ];

  var LABS = [];

  /* ------------------------------------------------------------------ PY-101 */
  LABS.push({
    id: "py-101", n: 1, module: 1, ticket: "PY-101", xp: 100,
    title: "Morning status report",
    topic: "Variables, types & f-strings",
    from: "Maya Chen · SRE lead",
    story: "<p>Morning, and welcome to the team! Before stand-up I need a one-line health report for <code>web-01</code>.</p>" +
      "<p>Store each fact in its own variable, then print the report. Tomorrow only the numbers will change, so the report line itself shouldn't need editing.</p>",
    learn:
      '<div class="callout"><b>How labs work.</b> Write code in the editor and press <kbd>Run</kbd> (or <kbd>Ctrl</kbd>+<kbd>Enter</kbd>). ' +
      "Output shows up in the console underneath. The console also has a <code>&gt;&gt;&gt;</code> prompt where you can try one line at a time. " +
      "Press ▶ on any example below to run it in the console. This is real Python running in your browser.</div>" +
      "<h3>print()</h3><p><code>print()</code> shows a value in the output. Text goes in quotes; numbers don't.</p>" +
      ex('print("Hello, Kestrel")\nprint(2 + 3)') +
      "<h3>Variables</h3><p>A variable is a name that points to a value. The <code>=</code> sign means <em>store this</em>, not <em>is equal to</em>. Names use lowercase words joined by underscores (<code>server_name</code>).</p>" +
      ex('host = "web-01"\nport = 443\nprint(host, port)') +
      "<h3>Four basic types</h3>" +
      '<table class="t"><tr><th>Type</th><th>What it holds</th><th>Example</th></tr>' +
      "<tr><td><code>str</code></td><td>text, in quotes</td><td><code>\"web-01\"</code></td></tr>" +
      "<tr><td><code>int</code></td><td>whole number</td><td><code>443</code></td></tr>" +
      "<tr><td><code>float</code></td><td>number with a decimal point</td><td><code>37.5</code></td></tr>" +
      "<tr><td><code>bool</code></td><td><code>True</code> or <code>False</code></td><td><code>True</code></td></tr></table>" +
      "<p><code>type()</code> tells you what you have. Watch out: <code>\"443\"</code> in quotes is text, not a number. And <code>True</code> needs a capital T.</p>" +
      ex('print(type("web-01"))\nprint(type(443))\nprint(type("443"))\nprint(type(37.5))\nprint(type(True))') +
      "<h3>Math</h3><p><code>+ - * /</code> work as you'd expect. <code>/</code> always gives a float; <code>//</code> divides and drops the remainder; <code>%</code> gives the remainder.</p>" +
      ex("days = 3\nhours = days * 24\nprint(hours)\nprint(7 / 2, 7 // 2, 7 % 2)") +
      "<h3>f-strings</h3><p>Put <code>f</code> right before the opening quote, then write any variable or expression inside <code>{ }</code>. Python swaps in the value.</p>" +
      ex('host = "web-01"\nload = 0.42\nprint(f"{host} load is {load}")\nprint(f"{2 * 12} hours")') +
      "<p>Forget the <code>f</code> and the braces print literally. Try <code>print(\"{host}\")</code> in the console.</p>",
    starter: py`
      # PY-101 · Morning status report
      # Store each fact in a variable, then print one report line.

      server_name = "web-01"

      # 1) Create cpu_percent, uptime_days and is_healthy


      # 2) Calculate uptime_hours from uptime_days


      # 3) Print the report with an f-string

    `,
    objectives: [
      {
        id: "vars",
        text: "Create <code>cpu_percent</code> = <code>37.5</code>, <code>uptime_days</code> = <code>12</code> and <code>is_healthy</code> = <code>True</code>, each with the right type.",
        hints: [
          "A float has a decimal point, an int doesn't, and a bool is True or False with a capital letter and no quotes.",
          "cpu_percent = 37.5\nuptime_days = 12\nis_healthy = True"
        ],
        check: py`
          def check(ns, out, run, src):
              for name, want, typ in [("server_name", "web-01", str), ("cpu_percent", 37.5, float),
                                      ("uptime_days", 12, int), ("is_healthy", True, bool)]:
                  r = H.expect(ns, name, want, typ)
                  if r is not True:
                      return r
              return True
        `
      },
      {
        id: "hours",
        text: "Create <code>uptime_hours</code> by <em>calculating</em> it from <code>uptime_days</code>. Don't type 288 yourself.",
        hints: [
          "There are 24 hours in a day. Use the variable's name in the calculation, not its value.",
          "uptime_hours = uptime_days * 24"
        ],
        check: py`
          def check(ns, out, run, src):
              r = H.expect(ns, "uptime_hours", 288)
              if r is not True:
                  return r
              return H.alt(src, run, r"uptime_days\s*=\s*12\b", "uptime_days = 2",
                           {"uptime_hours": 48}, "uptime_days = 2")
        `
      },
      {
        id: "report",
        text: "Print exactly <code>web-01 | CPU 37.5% | up 288h | healthy: True</code> using one f-string.",
        hints: [
          "Start with print(f\"...\") and put each variable inside curly braces where its value belongs. The | and % are plain text.",
          "print(f\"{server_name} | CPU {cpu_percent}% | up {uptime_hours}h | healthy: {is_healthy}\")"
        ],
        check: py`
          def check(ns, out, run, src):
              want = "web-01 | CPU 37.5% | up 288h | healthy: True"
              lines = H.lines(out)
              if want not in lines:
                  close = [l for l in lines if "CPU" in l or "web-01" in l]
                  if close:
                      return "Close! Expected:  " + want + "\nYou printed:     " + close[-1]
                  return "I don't see the report line in the output yet."
              if not re.search(r"\bf[\"']", src):
                  return "The line is right, but build it with an f-string: print(f\"...{variable}...\")."
              return _alt_line(src, run)

          def _alt_line(src, run):
              new = H.sub(src, r"server_name\s*=\s*\"web-01\"", 'server_name = "db-07"')
              if new is None:
                  return True
              n, o, e = run(new)
              if not any(l.startswith("db-07 | ") for l in H.lines(o)):
                  return "When I changed server_name to \"db-07\", the report still said web-01. Use {server_name} in the f-string."
              return True
        `
      }
    ],
    debrief: "<p>Ticket closed. You used all four basic types, calculated a value from another variable, and built a line with an f-string.</p>" +
      "<p><b>Where this shows up in DevSecOps:</b> nearly every automation script begins by storing hostnames, thresholds and flags in variables, and builds log lines and alert messages with f-strings.</p>",
    realworld: "Install Python from <a href=\"https://www.python.org/downloads/\" target=\"_blank\" rel=\"noopener\">python.org</a> (or run <code>winget install Python.Python.3.12</code>). Open a terminal, type <code>python</code>, and try the same lines at the <code>&gt;&gt;&gt;</code> prompt. Type <code>exit()</code> to leave.",
    quiz: [
      { q: "What type is <code>\"443\"</code> (with quotes)?", options: ["int", "str", "float", "bool"], answer: 1,
        why: "Anything inside quotes is a string, even if it looks like a number. int(\"443\") turns it into a number." },
      { q: "What does <code>print(f\"{3 * 8}h\")</code> show?", options: ["{3 * 8}h", "24h", "3 * 8h", "An error"], answer: 1,
        why: "Inside an f-string, the braces are evaluated as Python. 3 * 8 is 24." },
      { q: "Which line stores a boolean?", options: ["ok = \"True\"", "ok = true", "ok = True", "ok == True"], answer: 2,
        why: "True with a capital T and no quotes. \"True\" is a string, lowercase true is an unknown name, and == compares instead of storing." }
    ]
  });

  /* ------------------------------------------------------------------ PY-102 */
  LABS.push({
    id: "py-102", n: 2, module: 1, ticket: "PY-102", xp: 100,
    title: "Clean up the new-hire list",
    topic: "Strings",
    from: "Maya Chen · SRE lead",
    story: "<p>HR exported the new accounts from a spreadsheet, and the data is messy: extra spaces and random capitals.</p>" +
      "<p>Before we create Linux logins, clean the email address, then build the username, login and initials from it. Start with Alice's, but make it work for <em>any</em> address.</p>",
    learn:
      "<h3>Strings are text</h3><p>A string is text inside quotes. <code>len()</code> counts its characters, spaces included.</p>" +
      ex('name = "  Kestrel Cloud  "\nprint(len(name))') +
      "<h3>Methods</h3><p>Strings come with built-in tools called <em>methods</em>. You call them with a dot: <code>text.method()</code>.</p>" +
      '<table class="t"><tr><th>Method</th><th>Does</th></tr>' +
      "<tr><td><code>.strip()</code></td><td>removes spaces at both ends</td></tr>" +
      "<tr><td><code>.lower()</code> / <code>.upper()</code></td><td>changes the case</td></tr>" +
      "<tr><td><code>.replace(a, b)</code></td><td>swaps every <code>a</code> for <code>b</code></td></tr>" +
      "<tr><td><code>.split(sep)</code></td><td>cuts the text into a list at <code>sep</code></td></tr>" +
      "<tr><td><code>.startswith(x)</code></td><td><code>True</code> if the text begins with <code>x</code></td></tr></table>" +
      "<p>You can chain them, and they run left to right:</p>" +
      ex('name = "  Kestrel Cloud  "\nprint(name.strip())\nprint(name.strip().upper())') +
      "<h3>Strings don't change in place</h3><p>A method gives you a <em>new</em> string. The original stays the same unless you store the result.</p>" +
      ex('s = "web 01"\ns.replace(" ", "-")\nprint(s)\ns = s.replace(" ", "-")\nprint(s)') +
      "<h3>Indexing and slicing</h3><p>Each character has a position starting at <code>0</code>. <code>[-1]</code> is the last one. <code>[start:end]</code> takes a slice, and the end position isn't included.</p>" +
      ex('host = "web-01.kestrel.io"\nprint(host[0])\nprint(host[-1])\nprint(host[0:6])\nprint("kestrel" in host)') +
      "<h3>split() and unpacking</h3><p><code>split()</code> returns a <em>list</em> of pieces. If you know how many pieces you'll get, you can store them in separate variables in one go.</p>" +
      ex('parts = "db-01:5432".split(":")\nprint(parts)\nhost, port = "db-01:5432".split(":")\nprint(host)\nprint(port)'),
    starter: py`
      # PY-102 · Clean up the new-hire list
      raw = "  Alice.Smith@Kestrel.IO  "

      # 1) clean: no spaces at the ends, all lowercase


      # 2) username and domain: split clean at the @


      # 3) login: username with the dot replaced by an underscore


      # 4) initials: first letter of first and last name, uppercase

    `,
    objectives: [
      {
        id: "clean",
        text: "<code>clean</code> = <code>raw</code> with no spaces at the ends, all lowercase (<code>alice.smith@kestrel.io</code>).",
        hints: ["Chain two methods: one removes the spaces at the ends, the other lowercases.", "clean = raw.strip().lower()"],
        check: py`
          def check(ns, out, run, src):
              r = H.expect(ns, "clean", "alice.smith@kestrel.io")
              if r is not True:
                  return r
              return H.alt(src, run, r"raw\s*=\s*\"[^\"\n]*\"", 'raw = "  Bob.JONES@Example.COM "',
                           {"clean": "bob.jones@example.com"}, "Bob's address")
        `
      },
      {
        id: "split",
        text: "Split <code>clean</code> at the <code>@</code> into <code>username</code> and <code>domain</code>.",
        hints: ['.split("@") gives a list with two parts. You can unpack it into two variables in one line.', 'username, domain = clean.split("@")'],
        check: py`
          def check(ns, out, run, src):
              for name, want in [("username", "alice.smith"), ("domain", "kestrel.io")]:
                  r = H.expect(ns, name, want)
                  if r is not True:
                      return r
              return H.alt(src, run, r"raw\s*=\s*\"[^\"\n]*\"", 'raw = "  Bob.JONES@Example.COM "',
                           {"username": "bob.jones", "domain": "example.com"}, "Bob's address")
        `
      },
      {
        id: "login",
        text: "<code>login</code> = <code>username</code> with the dot replaced by an underscore (<code>alice_smith</code>).",
        hints: [".replace(old, new) swaps every occurrence of old for new.", 'login = username.replace(".", "_")'],
        check: py`
          def check(ns, out, run, src):
              r = H.expect(ns, "login", "alice_smith")
              if r is not True:
                  return r
              return H.alt(src, run, r"raw\s*=\s*\"[^\"\n]*\"", 'raw = "  Bob.JONES@Example.COM "',
                           {"login": "bob_jones"}, "Bob's address")
        `
      },
      {
        id: "initials",
        text: "<code>initials</code> = the first letter of the first name and of the last name, uppercase (<code>AS</code>).",
        hints: [
          'Split username at the dot to get ["alice", "smith"]. word[0] is a word\'s first character.',
          'first, last = username.split(".")\ninitials = (first[0] + last[0]).upper()'
        ],
        check: py`
          def check(ns, out, run, src):
              r = H.expect(ns, "initials", "AS")
              if r is not True:
                  return r
              return H.alt(src, run, r"raw\s*=\s*\"[^\"\n]*\"", 'raw = "  Bob.JONES@Example.COM "',
                           {"initials": "BJ"}, "Bob's address")
        `
      }
    ],
    debrief: "<p>Ticket closed. Bob, Priya and everyone else on the list will get clean logins too, because your code builds each one from <code>raw</code>.</p>" +
      "<p><b>Why it matters for security:</b> cleaning input (<em>normalization</em>) comes before validating it. If <code>Admin</code> and <code>admin </code> count as different users, an attacker can register a look-alike account.</p>",
    realworld: "In a real script you'd read the names from a file and clean each one in a loop. That's coming in PY-104 and PY-108.",
    quiz: [
      { q: "What does <code>\"  Hi \".strip()</code> return?", options: ["\"  Hi \"", "\"Hi\"", "\"Hi \"", "2"], answer: 1,
        why: "strip() removes spaces from both ends. lstrip()/rstrip() do just one side." },
      { q: "<code>s = \"web\"</code>, then <code>s.upper()</code>, then <code>print(s)</code>. What prints?", options: ["WEB", "web", "Web", "None"], answer: 1,
        why: "Strings never change in place. upper() returned a new string that wasn't stored." },
      { q: "What is <code>\"kestrel\"[-1]</code>?", options: ["k", "l", "e", "An error"], answer: 1,
        why: "Negative indexes count from the end; -1 is the last character." }
    ]
  });

  /* ------------------------------------------------------------------ PY-103 */
  LABS.push({
    id: "py-103", n: 3, module: 1, ticket: "PY-103", xp: 100,
    title: "Password policy",
    topic: "Conditionals & input()",
    from: "Dev Patel · Security team",
    story: "<p>Last quarter's audit flagged weak passwords on our internal tools. Please write the checker the signup form will call.</p>" +
      "<p>It reads one password and prints <b>exactly one</b> verdict. Rules are checked in order, and the first rule that fails is the verdict.</p>" +
      '<ol class="rules"><li>Shorter than 12 characters → <code>REJECT: too short</code></li>' +
      "<li>In the <code>common</code> list → <code>REJECT: too common</code></li>" +
      "<li>Only letters, with no digits or symbols → <code>REJECT: needs a number or symbol</code></li>" +
      "<li>No uppercase letter → <code>REJECT: needs an uppercase letter</code></li>" +
      "<li>Otherwise → <code>ACCEPT</code></li></ol>",
    learn:
      "<h3>Comparisons give True or False</h3>" +
      '<table class="t"><tr><th>Operator</th><th>Means</th></tr>' +
      "<tr><td><code>==</code> / <code>!=</code></td><td>equal / not equal</td></tr>" +
      "<tr><td><code>&lt;  &gt;  &lt;=  &gt;=</code></td><td>less / greater (or equal)</td></tr>" +
      "<tr><td><code>in</code> / <code>not in</code></td><td>is it inside a list or string?</td></tr>" +
      "<tr><td><code>and  or  not</code></td><td>combine conditions</td></tr></table>" +
      ex('port = 22\nprint(port == 22)\nprint(port != 22)\nprint(port > 1024 or port == 22)\nprint("ftp" in ["telnet", "ftp"])') +
      "<h3>if / elif / else</h3><p>Python checks each condition from top to bottom and runs <b>only the first</b> block whose condition is True. The colon and the 4-space indent are required: indentation is how Python knows which lines belong to which block.</p>" +
      ex('cpu = 91\nif cpu > 90:\n    print("ALERT: CPU high")\nelif cpu > 70:\n    print("WARN: CPU rising")\nelse:\n    print("OK")') +
      "<p>Change <code>cpu</code> to 75, then 20, and run it again. If you'd used three separate <code>if</code>s, a CPU of 91 would trigger both the ALERT and the WARN.</p>" +
      "<h3>Useful string checks</h3>" +
      ex('print("hunter".isalpha())\nprint("hunter2".isalpha())\npw = "hunter2"\nprint(pw.lower() == pw)') +
      "<p><code>isalpha()</code> is True when <em>every</em> character is a letter. If <code>pw.lower() == pw</code>, lowercasing changed nothing, so the password has no uppercase letters.</p>" +
      "<h3>input()</h3><p><code>input()</code> waits for the user to type something and always returns a <b>str</b>. In these labs, each line of the <b>Input</b> box under the editor is given to one <code>input()</code> call. Change it to test different passwords.</p>",
    starter: py`
      # PY-103 · Password policy
      # Reads one password and prints exactly one verdict.

      password = input("New password: ")
      common = ["password1234", "qwertyuiop12", "letmeinletmein"]

      if len(password) < 12:
          print("REJECT: too short")
      # add the other rules here with elif, and finish with else

    `,
    stdin: "hunter2",
    objectives: [
      {
        id: "short",
        text: "Short passwords are rejected. Try <code>hunter2</code>.",
        hints: ["The starter code already does this one. Just press Run and look at the console.", "Run the code. The Input box already contains hunter2."],
        check: py`
          def check(ns, out, run, src):
              return _verdict(run, "hunter2", "REJECT: too short")
        ` + "\n\n" + VERDICT_SRC()
      },
      {
        id: "common",
        text: "Common passwords are rejected. Try <code>qwertyuiop12</code>.",
        hints: ["Add an elif that checks whether password is in the common list.", 'elif password in common:\n    print("REJECT: too common")'],
        check: py`
          def check(ns, out, run, src):
              return _verdict(run, "qwertyuiop12", "REJECT: too common")
        ` + "\n\n" + VERDICT_SRC()
      },
      {
        id: "alpha",
        text: "Letters-only passwords are rejected. Try <code>CorrectHorseBattery</code>.",
        hints: ["Which string method is True when every character is a letter?", 'elif password.isalpha():\n    print("REJECT: needs a number or symbol")'],
        check: py`
          def check(ns, out, run, src):
              return _verdict(run, "CorrectHorseBattery", "REJECT: needs a number or symbol")
        ` + "\n\n" + VERDICT_SRC()
      },
      {
        id: "upper",
        text: "Passwords with no uppercase letter are rejected. Try <code>correct-horse-42</code>.",
        hints: ["If lowercasing the password changes nothing, it has no uppercase letters.", 'elif password.lower() == password:\n    print("REJECT: needs an uppercase letter")'],
        check: py`
          def check(ns, out, run, src):
              return _verdict(run, "correct-horse-42", "REJECT: needs an uppercase letter")
        ` + "\n\n" + VERDICT_SRC()
      },
      {
        id: "accept",
        text: "Strong passwords are accepted. Try <code>Correct-Horse-42</code>. Each password gets exactly one verdict.",
        hints: ["Finish the chain with else: for everything that passed every rule.", 'else:\n    print("ACCEPT")'],
        check: py`
          def check(ns, out, run, src):
              for pw, want in [("Correct-Horse-42", "ACCEPT"), ("hunter2", "REJECT: too short"),
                               ("letmeinletmein", "REJECT: too common")]:
                  r = _verdict(run, pw, want)
                  if r is not True:
                      return r
              return True
        ` + "\n\n" + VERDICT_SRC()
      }
    ],
    debrief: "<p>Ticket closed. Your checker gives exactly one verdict for every password.</p>" +
      "<p><b>A real-world note:</b> modern guidance (NIST SP 800-63B) prefers <em>long</em> passwords checked against lists of breached passwords over rules like \"must contain a symbol\". Our rules are a simplified version for practice. The <code>common</code> list is the idea that matters most.</p>",
    realworld: "Save the code as <code>policy.py</code> and run <code>python policy.py</code> in a terminal. This time <code>input()</code> waits for you to type.",
    quiz: [
      { q: "What type does <code>input()</code> always return?", options: ["int", "str", "Whatever the user typed", "bool"], answer: 1,
        why: "Always a string. Convert with int() when you need a number." },
      { q: "Why use <code>elif</code> instead of several <code>if</code>s here?", options: ["It runs faster", "So only the first matching rule prints", "if can't use strings", "No reason"], answer: 1,
        why: "An if/elif/else chain stops at the first True condition, so you get exactly one verdict." },
      { q: "What does <code>\"abc123\".isalpha()</code> return?", options: ["True", "False", "\"abc\"", "An error"], answer: 1,
        why: "isalpha() is True only if every character is a letter. The digits make it False." }
    ]
  });

  /* ------------------------------------------------------------------ PY-104 */
  LABS.push({
    id: "py-104", n: 4, module: 1, ticket: "PY-104", xp: 100,
    title: "Port sweep",
    topic: "Loops: for & while",
    from: "Maya Chen · SRE lead",
    story: "<p>A scan of <code>web-01</code> found these open ports. Some of them should never face the internet.</p>" +
      "<p>Go through the list and report every port, count the risky ones, and build the list we'll send to the firewall team.</p>" +
      "<p>Then one more thing: <code>db-01</code> is rebooting. Keep pinging it until it answers, and tell me how many tries it took.</p>",
    learn:
      "<h3>for: once per item</h3><p>A <code>for</code> loop runs its indented block once for each item, and the loop variable holds the current item.</p>" +
      ex('for host in ["web-01", "web-02", "db-01"]:\n    print("checking", host)') +
      "<p><code>range(n)</code> gives the numbers 0 to n−1, which is handy when you need to repeat something n times.</p>" +
      ex('for i in range(3):\n    print("attempt", i)') +
      "<h3>The accumulator pattern</h3><p>Start with an empty value <em>before</em> the loop, then update it inside the loop.</p>" +
      ex("sizes = [120, 45, 300]\ntotal = 0\nfor s in sizes:\n    total += s\nprint(total)") +
      ex("big = []\nfor s in [120, 45, 300]:\n    if s > 100:\n        big.append(s)\nprint(big)") +
      "<p><code>total += s</code> is short for <code>total = total + s</code>. <code>append()</code> adds an item to the end of a list.</p>" +
      "<h3>while: until something changes</h3><p>A <code>while</code> loop repeats <em>as long as</em> its condition is True. Use it when you don't know in advance how many rounds you'll need.</p>" +
      ex('n = 3\nwhile n > 0:\n    print(n)\n    n -= 1\nprint("liftoff")') +
      '<div class="callout warn"><b>Infinite loops.</b> If the condition never becomes False, the loop runs forever. Here the runner stops your code after a few seconds and tells you. In a real terminal, press <kbd>Ctrl</kbd>+<kbd>C</kbd>.</div>' +
      "<h3>break and continue</h3><p><code>break</code> leaves the loop right away. <code>continue</code> skips to the next round.</p>" +
      ex('for port in [22, 80, 23, 443]:\n    if port == 80:\n        continue\n    if port == 23:\n        print("telnet found!")\n        break\n    print("ok", port)') +
      "<h3>ping() in this lab</h3><p>A function <code>ping(host)</code> is already loaded. It prints a line and returns <code>False</code> until db-01 finishes rebooting, and <code>True</code> once it answers.</p>",
    starter: py`
      # PY-104 · Port sweep
      open_ports = [22, 80, 443, 3306, 8080, 23, 6379]
      risky_ports = [23, 3306, 6379]   # telnet, mysql, redis

      # 1) Print "port <n> open" for each port


      # 2) Count the risky open ports into risky_count


      # 3) Build to_close: the risky open ports, in order


      # 4) Ping db-01 with a while loop until it answers; count the tries in attempts

    `,
    prelude: py`
      _ping_calls = 0
      def ping(host):
          """Simulated ping: db-01 answers on the 4th try."""
          global _ping_calls
          _ping_calls += 1
          up = _ping_calls >= 4
          print("ping " + str(host) + ": " + ("reply" if up else "timeout"))
          return up
    `,
    objectives: [
      {
        id: "print",
        text: "Print <code>port &lt;n&gt; open</code> for every port in <code>open_ports</code>, in order.",
        hints: ["for port in open_ports: then an indented print using an f-string.", 'for port in open_ports:\n    print(f"port {port} open")'],
        check: py`
          def check(ns, out, run, src):
              got = [l for l in H.lines(out) if re.match(r"^port \d+ open$", l)]
              want = ["port %d open" % p for p in [22, 80, 443, 3306, 8080, 23, 6379]]
              if got != want:
                  if not got:
                      return "I don't see any lines like 'port 22 open' yet."
                  return "Expected " + str(len(want)) + " lines starting with 'port 22 open', got " + str(len(got)) + ". First line you printed: " + got[0]
              new = H.sub(src, r"open_ports\s*=\s*\[[^\]]*\]", "open_ports = [23, 80, 6379, 9000]")
              if new:
                  n, o, e = run(new)
                  got2 = [l for l in H.lines(o) if re.match(r"^port \d+ open$", l)]
                  if got2 != ["port 23 open", "port 80 open", "port 6379 open", "port 9000 open"]:
                      return "When I changed open_ports, your output didn't follow. Loop over open_ports instead of printing each line by hand."
              return True
        `
      },
      {
        id: "count",
        text: "Count how many open ports are also in <code>risky_ports</code> and store it in <code>risky_count</code>.",
        hints: ["Set risky_count = 0 before the loop. Inside the loop, use if port in risky_ports: and add 1.", "risky_count = 0\nfor port in open_ports:\n    if port in risky_ports:\n        risky_count += 1"],
        check: py`
          def check(ns, out, run, src):
              r = H.expect(ns, "risky_count", 3, int)
              if r is not True:
                  return r
              return H.alt(src, run, r"open_ports\s*=\s*\[[^\]]*\]", "open_ports = [23, 80, 6379, 9000]",
                           {"risky_count": 2}, "a different open_ports list")
        `
      },
      {
        id: "list",
        text: "Build <code>to_close</code>: a list of the risky open ports, in the order they appear in <code>open_ports</code>.",
        hints: ["Same loop shape as the count, but start with an empty list and use .append(port).", "to_close = []\nfor port in open_ports:\n    if port in risky_ports:\n        to_close.append(port)"],
        check: py`
          def check(ns, out, run, src):
              r = H.expect(ns, "to_close", [3306, 23, 6379], list)
              if r is not True:
                  return r
              return H.alt(src, run, r"open_ports\s*=\s*\[[^\]]*\]", "open_ports = [23, 80, 6379, 9000]",
                           {"to_close": [23, 6379]}, "a different open_ports list")
        `
      },
      {
        id: "while",
        text: "With a <code>while</code> loop, call <code>ping(\"db-01\")</code> until it returns <code>True</code>. Store the number of calls in <code>attempts</code>.",
        hints: [
          "Keep a counter. Each time around the loop: call ping, add 1 to the counter, and stop once ping returned True.",
          'attempts = 1\nwhile not ping("db-01"):\n    attempts += 1'
        ],
        check: py`
          def check(ns, out, run, src):
              if not re.search(r"^\s*while\b", src, re.M):
                  return "Use a while loop for this one. You don't know in advance how many tries it will take."
              calls = ns.get("_ping_calls", 0)
              if calls == 0:
                  return "ping() was never called."
              if calls != 4:
                  return "ping() was called " + str(calls) + " times. db-01 answers on the 4th call, so stop as soon as it returns True."
              return H.expect(ns, "attempts", 4)
        `
      }
    ],
    debrief: "<p>Ticket closed. The firewall team got <code>[3306, 23, 6379]</code>, and db-01 was back after 4 pings.</p>" +
      "<p><b>Why these ports?</b> Telnet (23) sends passwords in plain text. MySQL (3306) and Redis (6379) are databases, and an exposed one is among the most common causes of cloud breaches. They belong on a private network.</p>",
    realworld: "Real retry loops wait between tries (<code>time.sleep(2)</code>) and give up after a maximum number of attempts, so they can't loop forever.",
    quiz: [
      { q: "What numbers does <code>range(3)</code> produce?", options: ["1, 2, 3", "0, 1, 2", "0, 1, 2, 3", "3"], answer: 1,
        why: "range(n) starts at 0 and stops before n." },
      { q: "When is <code>while</code> a better choice than <code>for</code>?", options: ["Always", "When you don't know how many rounds you need", "When looping over a list", "Never"], answer: 1,
        why: "for walks through a known collection. while repeats until something changes, like a server answering." },
      { q: "Where must <code>count = 0</code> go in an accumulator loop?", options: ["Inside the loop", "Before the loop", "After the loop", "Anywhere"], answer: 1,
        why: "Inside the loop, it would reset to 0 every round." }
    ]
  });

  /* ------------------------------------------------------------------ PY-105 */
  LABS.push({
    id: "py-105", n: 5, module: 1, ticket: "PY-105", xp: 100,
    title: "Who's knocking?",
    topic: "Lists & dictionaries",
    from: "Dev Patel · Security team",
    story: "<p><code>auth.log</code> shows a burst of failed SSH logins overnight. I've pulled the source IPs into a list.</p>" +
      "<p>Count the failures per IP, find the worst offender, and build a blocklist of every IP with 3 or more failures. Then print a short report, labelling the IPs we know with <code>owners</code>.</p>",
    learn:
      "<h3>Lists recap</h3><p>A list keeps items in order. Positions start at 0.</p>" +
      ex('ips = ["10.0.0.5", "8.8.8.8"]\nips.append("1.1.1.1")\nprint(len(ips), ips[0], ips[-1])\nprint(sorted(["db", "ci", "web"]))') +
      "<h3>Dictionaries: look things up by key</h3><p>A dict maps <b>keys</b> to <b>values</b>, like a phone book. Keys are unique.</p>" +
      ex('owners = {"10.0.0.5": "vpn-gateway", "10.0.0.9": "build-server"}\nprint(owners["10.0.0.5"])\nowners["10.0.0.7"] = "printer"\nprint(len(owners))') +
      "<p>Asking for a missing key with <code>[ ]</code> raises a <code>KeyError</code>. <code>.get(key, default)</code> returns the default instead:</p>" +
      ex('owners = {"10.0.0.5": "vpn-gateway"}\nprint(owners.get("8.8.8.8", "unknown"))\nprint(owners["8.8.8.8"])') +
      "<h3>Looping over a dict</h3><p><code>.items()</code> gives you key and value together.</p>" +
      ex('for ip, name in {"10.0.0.5": "vpn", "10.0.0.9": "ci"}.items():\n    print(ip, "->", name)') +
      "<h3>The counting pattern</h3><p>This is one of the most useful patterns in scripting: get the current count (or 0 if the key isn't there yet), add 1, and store it back.</p>" +
      ex('counts = {}\nfor word in ["a", "b", "a"]:\n    counts[word] = counts.get(word, 0) + 1\nprint(counts)') +
      "<h3>Finding the biggest</h3><p><code>max(d, key=d.get)</code> returns the key with the largest value.</p>" +
      ex('scores = {"web": 3, "db": 9, "ci": 5}\nprint(max(scores, key=scores.get))'),
    starter: py`
      # PY-105 · Who's knocking?
      failed_ips = [
          "185.220.101.47", "10.0.0.5", "185.220.101.47", "45.155.205.233",
          "185.220.101.47", "192.168.1.20", "45.155.205.233", "185.220.101.47",
          "10.0.0.5", "45.155.205.233", "185.220.101.47", "10.0.0.5",
      ]
      owners = {"10.0.0.5": "vpn-gateway", "192.168.1.20": "printer"}

      # 1) counts: IP -> number of failures


      # 2) top_ip: the IP with the most failures


      # 3) blocklist: sorted list of IPs with 3 or more failures


      # 4) Report: "<ip> (<owner>): <n> failures" for each IP in blocklist

    `,
    objectives: [
      {
        id: "counts",
        text: "<code>counts</code>: a dict mapping each IP to its number of failures.",
        hints: ["Start with counts = {} and use the counting pattern inside a for loop.", "counts = {}\nfor ip in failed_ips:\n    counts[ip] = counts.get(ip, 0) + 1"],
        check: py`
          def check(ns, out, run, src):
              want = {"185.220.101.47": 5, "10.0.0.5": 3, "45.155.205.233": 3, "192.168.1.20": 1}
              r = H.expect(ns, "counts", want, dict)
              if r is not True:
                  return r
              return H.alt(src, run, r"failed_ips\s*=\s*\[[^\]]*\]",
                           'failed_ips = ["1.1.1.1", "2.2.2.2", "1.1.1.1", "1.1.1.1", "2.2.2.2", "10.0.0.5"]',
                           {"counts": {"1.1.1.1": 3, "2.2.2.2": 2, "10.0.0.5": 1}}, "a different list of IPs")
        `
      },
      {
        id: "top",
        text: "<code>top_ip</code>: the IP with the most failures.",
        hints: ["max() can take a key= function that decides what 'biggest' means.", "top_ip = max(counts, key=counts.get)"],
        check: py`
          def check(ns, out, run, src):
              r = H.expect(ns, "top_ip", "185.220.101.47")
              if r is not True:
                  return r
              return H.alt(src, run, r"failed_ips\s*=\s*\[[^\]]*\]",
                           'failed_ips = ["1.1.1.1", "2.2.2.2", "1.1.1.1", "1.1.1.1", "2.2.2.2", "10.0.0.5"]',
                           {"top_ip": "1.1.1.1"}, "a different list of IPs")
        `
      },
      {
        id: "block",
        text: "<code>blocklist</code>: a <em>sorted</em> list of every IP with 3 or more failures.",
        hints: ["Loop over counts.items(), append the IPs that pass the check, then sort the list.", "blocklist = []\nfor ip, n in counts.items():\n    if n >= 3:\n        blocklist.append(ip)\nblocklist = sorted(blocklist)"],
        check: py`
          def check(ns, out, run, src):
              r = H.expect(ns, "blocklist", ["10.0.0.5", "185.220.101.47", "45.155.205.233"], list)
              if r is not True:
                  return r
              return H.alt(src, run, r"failed_ips\s*=\s*\[[^\]]*\]",
                           'failed_ips = ["1.1.1.1", "2.2.2.2", "1.1.1.1", "1.1.1.1", "2.2.2.2", "10.0.0.5"]',
                           {"blocklist": ["1.1.1.1"]}, "a different list of IPs")
        `
      },
      {
        id: "report",
        text: "For each IP in <code>blocklist</code>, print <code>&lt;ip&gt; (&lt;owner&gt;): &lt;n&gt; failures</code>. The owner comes from <code>owners</code>, or is <code>unknown</code>.",
        hints: ['Loop over blocklist. owners.get(ip, "unknown") gives the label, and counts[ip] gives the number.', 'for ip in blocklist:\n    print(f"{ip} ({owners.get(ip, \'unknown\')}): {counts[ip]} failures")'],
        check: py`
          def check(ns, out, run, src):
              want = ["10.0.0.5 (vpn-gateway): 3 failures", "185.220.101.47 (unknown): 5 failures",
                      "45.155.205.233 (unknown): 3 failures"]
              got = [l for l in H.lines(out) if l.endswith("failures")]
              if got != want:
                  if not got:
                      return "I don't see any report lines ending in 'failures' yet. Expected the first one to be:\n" + want[0]
                  return "Expected:\n  " + "\n  ".join(want) + "\nYou printed:\n  " + "\n  ".join(got)
              return True
        `
      }
    ],
    debrief: "<p>Ticket closed. Look at your report again: <b>10.0.0.5 is our own VPN gateway.</b> If we'd blocked it automatically, everyone working from home would have been locked out.</p>" +
      "<p><b>Lesson:</b> automation finds the suspects, but check who owns an IP before you block it. The two external IPs are the real attackers.</p>",
    realworld: "Tools like <code>fail2ban</code> do exactly this on Linux servers: count failures per IP in auth logs and block repeat offenders.",
    quiz: [
      { q: "<code>d = {\"a\": 1}</code>. What does <code>d.get(\"b\", 0)</code> return?", options: ["KeyError", "None", "0", "1"], answer: 2,
        why: ".get returns the default when the key is missing. d[\"b\"] would raise a KeyError instead." },
      { q: "Can a dict have the same key twice?", options: ["Yes", "No, keys are unique", "Only for strings", "Only for numbers"], answer: 1,
        why: "Assigning to an existing key replaces its value." },
      { q: "What does <code>.items()</code> give you in a loop?", options: ["Only keys", "Only values", "(key, value) pairs", "The length"], answer: 2,
        why: "for k, v in d.items(): gives you both at once." }
    ]
  });

  /* ------------------------------------------------------------------ PY-106 */
  LABS.push({
    id: "py-106", n: 6, module: 1, ticket: "PY-106", xp: 100,
    title: "Build your toolkit",
    topic: "Functions",
    from: "Maya Chen · SRE lead",
    story: "<p>You've written the same checks in three scripts now. Let's turn them into functions in the team toolkit so the CI pipeline can reuse them.</p>" +
      "<p>Important: each function must <b>return</b> its answer, not print it, because other code will use the result.</p>",
    learn:
      "<h3>def, parameters, return</h3><p>A function is a named, reusable block. Values go in through <b>parameters</b>, and the answer comes out with <code>return</code>.</p>" +
      ex("def to_hours(days):\n    return days * 24\n\nprint(to_hours(2))\nx = to_hours(5)\nprint(x + 1)") +
      "<h3>return vs print</h3><p><code>print</code> only shows a value on screen. <code>return</code> hands it back to the code that called the function. A function without <code>return</code> gives back <code>None</code>.</p>" +
      ex('def shout(text):\n    print(text.upper())\n\nresult = shout("hi")\nprint(result)') +
      "<p><code>return</code> also ends the function right away, which is handy for early exits:</p>" +
      ex('def grade(score):\n    if score >= 90:\n        return "A"\n    if score >= 70:\n        return "B"\n    return "C"\n\nprint(grade(95), grade(75), grade(10))') +
      "<h3>Default values</h3><p>A parameter can have a default, which is used when the caller leaves it out.</p>" +
      ex('def greet(name, greeting="Hello"):\n    return f"{greeting}, {name}"\n\nprint(greet("Maya"))\nprint(greet("Maya", "Welcome"))') +
      "<h3>Functions that use functions</h3><p>Small functions that each do one thing can be combined into bigger ones.</p>" +
      ex('def is_even(n):\n    return n % 2 == 0\n\ndef count_even(nums):\n    total = 0\n    for n in nums:\n        if is_even(n):\n            total += 1\n    return total\n\nprint(count_even([1, 2, 3, 4]))') +
      "<h3>Repeating a string</h3><p><code>\"*\" * 3</code> gives <code>\"***\"</code>, and <code>s[-4:]</code> gives the last four characters. You'll need both for <code>mask()</code>.</p>",
    starter: py`
      # PY-106 · Build your toolkit
      # Each function must RETURN its answer (don't print it).

      def is_strong(password):
          pass


      def mask(secret, show=4):
          pass


      def risk_level(port):
          pass


      def summarize(ports):
          pass


      # Try your functions here:
      print(is_strong("Correct-Horse-42"))
      print(mask("sk_live_abcd1234"))
    `,
    objectives: [
      {
        id: "strong",
        text: "<code>is_strong(password)</code> returns <code>True</code> if it's 12+ characters, not letters-only, and has an uppercase letter. Otherwise <code>False</code>.",
        hints: ["Reuse the rules from PY-103. Return False as soon as a rule fails, and return True at the end.", "def is_strong(password):\n    if len(password) < 12:\n        return False\n    if password.isalpha():\n        return False\n    if password.lower() == password:\n        return False\n    return True"],
        check: py`
          def check(ns, out, run, src):
              f = H.fn(ns, "is_strong")
              if not f:
                  return "I can't find a function called is_strong."
              for arg, want in [("Correct-Horse-42", True), ("short1A", False), ("CorrectHorseBattery", False),
                                ("no-upper-case-42", False), ("ABCDEFGHIJK1", True)]:
                  ok, got = H.call(f, arg)
                  if not ok:
                      return "is_strong(" + repr(arg) + ") crashed: " + type(got).__name__ + ": " + str(got)
                  if got is None:
                      return "is_strong(" + repr(arg) + ") returned None. Did you print instead of return, or leave pass in place?"
                  if got != want:
                      return "is_strong(" + repr(arg) + ") returned " + repr(got) + ", expected " + repr(want) + "."
              return True
        `
      },
      {
        id: "mask",
        text: "<code>mask(secret, show=4)</code> replaces every character except the last <code>show</code> with <code>*</code>. If the secret is <code>show</code> characters or shorter, return all stars.",
        hints: ['Stars: "*" * (len(secret) - show). Then add the last part: secret[-show:]. Handle the short case first.', 'def mask(secret, show=4):\n    if len(secret) <= show:\n        return "*" * len(secret)\n    return "*" * (len(secret) - show) + secret[-show:]'],
        check: py`
          def check(ns, out, run, src):
              f = H.fn(ns, "mask")
              if not f:
                  return "I can't find a function called mask."
              cases = [(("sk_live_abcd1234",), {}, "************1234"), (("abc",), {"show": 1}, "**c"),
                       (("abc",), {}, "***"), (("",), {}, ""), (("token-XYZ",), {"show": 3}, "******XYZ")]
              for a, k, want in cases:
                  ok, got = H.call(f, *a, **k)
                  call = "mask(" + ", ".join([repr(x) for x in a] + [kk + "=" + repr(v) for kk, v in k.items()]) + ")"
                  if not ok:
                      return call + " crashed: " + type(got).__name__ + ": " + str(got)
                  if got is None:
                      return call + " returned None. Use return, not print."
                  if got != want:
                      return call + " returned " + repr(got) + ", expected " + repr(want) + "."
              return True
        `
      },
      {
        id: "risk",
        text: "<code>risk_level(port)</code> returns <code>\"high\"</code> for 23, 3389 and 6379, <code>\"medium\"</code> for 21 and 3306, and <code>\"low\"</code> for anything else.",
        hints: ["Use in with a list for each group, and return early.", 'def risk_level(port):\n    if port in [23, 3389, 6379]:\n        return "high"\n    if port in [21, 3306]:\n        return "medium"\n    return "low"'],
        check: py`
          def check(ns, out, run, src):
              f = H.fn(ns, "risk_level")
              if not f:
                  return "I can't find a function called risk_level."
              for port, want in [(23, "high"), (3389, "high"), (6379, "high"), (21, "medium"),
                                 (3306, "medium"), (80, "low"), (443, "low"), (8080, "low")]:
                  ok, got = H.call(f, port)
                  if not ok:
                      return "risk_level(" + str(port) + ") crashed: " + type(got).__name__ + ": " + str(got)
                  if got != want:
                      return "risk_level(" + str(port) + ") returned " + repr(got) + ", expected " + repr(want) + "."
              return True
        `
      },
      {
        id: "summary",
        text: "<code>summarize(ports)</code> returns a dict counting each level, e.g. <code>{\"high\": 1, \"medium\": 1, \"low\": 1}</code> for <code>[23, 80, 3306]</code>. Always include all three keys, and use <code>risk_level</code> to decide.",
        hints: ['Start from {"high": 0, "medium": 0, "low": 0}, then add 1 to the right key for each port.', 'def summarize(ports):\n    totals = {"high": 0, "medium": 0, "low": 0}\n    for port in ports:\n        totals[risk_level(port)] += 1\n    return totals'],
        check: py`
          def check(ns, out, run, src):
              f = H.fn(ns, "summarize")
              rl = H.fn(ns, "risk_level")
              if not f:
                  return "I can't find a function called summarize."
              for ports, want in [([23, 80, 3306], {"high": 1, "medium": 1, "low": 1}),
                                  ([22, 23, 3306, 6379, 80], {"high": 2, "medium": 1, "low": 2}),
                                  ([], {"high": 0, "medium": 0, "low": 0})]:
                  ok, got = H.call(f, ports)
                  if not ok:
                      return "summarize(" + str(ports) + ") crashed: " + type(got).__name__ + ": " + str(got)
                  if got != want:
                      return "summarize(" + str(ports) + ") returned " + repr(got) + ", expected " + repr(want) + "."
              if rl:
                  calls = []
                  def spy(p):
                      calls.append(p)
                      return rl(p)
                  ns["risk_level"] = spy
                  try:
                      H.call(f, [23, 80])
                  finally:
                      ns["risk_level"] = rl
                  if not calls:
                      return "The answers are right, but summarize should call risk_level() instead of repeating its rules."
              return True
        `
      }
    ],
    debrief: "<p>Ticket closed. The toolkit has four tested functions, and <code>summarize</code> reuses <code>risk_level</code>, so a rule only ever changes in one place.</p>" +
      "<p><b>Security note:</b> <code>mask()</code> is something real teams use. Secrets like API keys should never appear in full in logs or CI output. Show only the last few characters.</p>",
    realworld: "Save the functions in <code>toolkit.py</code>. Any other script in the same folder can then do <code>from toolkit import mask</code>.",
    quiz: [
      { q: "A function has no <code>return</code> line. What does calling it give back?", options: ["0", "\"\"", "None", "An error"], answer: 2,
        why: "Python returns None automatically." },
      { q: "<code>def f(x, y=2): return x * y</code>. What is <code>f(5)</code>?", options: ["5", "7", "10", "Error"], answer: 2,
        why: "y falls back to its default of 2, so 5 * 2 = 10." },
      { q: "Why should toolkit functions return values instead of printing them?", options: ["Printing is slow", "So other code can use the result", "print is deprecated", "No difference"], answer: 1,
        why: "A printed value can only be read by a person. A returned value can be stored, compared and passed on by other code." }
    ]
  });

  /* ------------------------------------------------------------------ PY-107 */
  LABS.push({
    id: "py-107", n: 7, module: 1, ticket: "PY-107", xp: 100,
    title: "Don't crash on bad input",
    topic: "Errors & exceptions",
    from: "Maya Chen · SRE lead",
    story: "<p>Last night the deploy script crashed because one line in a config file said <code>port=http</code>. A crash at 2 AM wakes whoever is on call.</p>" +
      "<p>Make the port parser <b>strict</b> about bad values, but make the script <b>survive</b> them. And make reading a missing config file safe.</p>",
    learn:
      "<h3>Reading a traceback</h3><p>When Python hits an error, it stops and prints a <em>traceback</em>. <b>Read it from the bottom up:</b> the last line gives the error type and message, and the lines above show where it happened.</p>" +
      ex('print(int("443"))\nprint(int(" 443 "))\nprint(int("http"))') +
      '<table class="t"><tr><th>Error</th><th>Usually means</th></tr>' +
      "<tr><td><code>NameError</code></td><td>a typo, or a variable used before it was created</td></tr>" +
      "<tr><td><code>TypeError</code></td><td>wrong type, e.g. <code>\"port \" + 22</code></td></tr>" +
      "<tr><td><code>ValueError</code></td><td>right type, bad value, e.g. <code>int(\"http\")</code></td></tr>" +
      "<tr><td><code>KeyError</code> / <code>IndexError</code></td><td>missing dict key / list position</td></tr>" +
      "<tr><td><code>FileNotFoundError</code></td><td>the file isn't there</td></tr></table>" +
      "<h3>try / except</h3><p>Put risky code in <code>try</code>. If that specific error happens, Python jumps to <code>except</code> instead of crashing.</p>" +
      ex('try:\n    port = int("http")\nexcept ValueError:\n    port = None\nprint(port)') +
      '<div class="callout warn"><b>Catch only what you expect.</b> A bare <code>except:</code> catches <em>everything</em>, including your own typos, and hides real bugs. Name the error you\'re handling.</div>' +
      "<h3>raise: report a problem yourself</h3><p>When a value is invalid, <code>raise</code> an error with a clear message. The caller can then decide how to handle it.</p>" +
      ex('def check_age(age):\n    if age < 0:\n        raise ValueError("age can\'t be negative")\n    return age\n\nprint(check_age(30))\nprint(check_age(-1))') +
      "<h3>Reading a file</h3><p><code>with open(path) as f:</code> opens a file and closes it automatically when the block ends. <code>f.read()</code> returns the whole file as one string.</p>" +
      ex('try:\n    with open("nope.txt") as f:\n        print(f.read())\nexcept FileNotFoundError as e:\n    print("Missing:", e)') +
      "<p>This lab includes a real file called <code>app.conf</code>. Try <code>print(open(\"app.conf\").read())</code> in the console.</p>",
    starter: py`
      # PY-107 · Don't crash on bad input
      ports_raw = ["22", "80", "http", "70000", " 443 ", ""]

      def parse_port(text):
          pass


      def safe_parse(text):
          pass


      def read_config(path):
          pass


      # 3) Build valid (list of good ports) and errors (count of bad ones) using safe_parse

    `,
    files: { "app.conf": "# deploy settings\nport=8080\nmode=prod\n" },
    removeFiles: ["missing.conf"],
    objectives: [
      {
        id: "parse",
        text: "<code>parse_port(text)</code> returns the port as an <code>int</code>. It raises <code>ValueError</code> if the text isn't a number, or if the number isn't between 1 and 65535.",
        hints: ["int(text) already raises ValueError for text that isn't a number. Add an if that raises your own ValueError when the number is out of range.", 'def parse_port(text):\n    port = int(text)\n    if port < 1 or port > 65535:\n        raise ValueError(f"port out of range: {port}")\n    return port'],
        check: py`
          def check(ns, out, run, src):
              f = H.fn(ns, "parse_port")
              if not f:
                  return "I can't find a function called parse_port."
              for arg, want in [("22", 22), (" 443 ", 443), ("65535", 65535), ("1", 1)]:
                  ok, got = H.call(f, arg)
                  if not ok:
                      return "parse_port(" + repr(arg) + ") raised " + type(got).__name__ + ", but it's a valid port."
                  if got != want or type(got) is not int:
                      return "parse_port(" + repr(arg) + ") returned " + repr(got) + ", expected the int " + str(want) + "."
              for arg in ["70000", "0", "-5", "http"]:
                  ok, got = H.call(f, arg)
                  if ok:
                      return "parse_port(" + repr(arg) + ") returned " + repr(got) + ". It should raise ValueError."
                  if not isinstance(got, ValueError):
                      return "parse_port(" + repr(arg) + ") raised " + type(got).__name__ + ". It should raise ValueError."
              return True
        `
      },
      {
        id: "safe",
        text: "<code>safe_parse(text)</code> calls <code>parse_port</code> and returns <code>None</code> instead of crashing on a <code>ValueError</code>. Catch <em>only</em> <code>ValueError</code>.",
        hints: ["try: return parse_port(text). In except ValueError:, return None.", "def safe_parse(text):\n    try:\n        return parse_port(text)\n    except ValueError:\n        return None"],
        check: py`
          def check(ns, out, run, src):
              f = H.fn(ns, "safe_parse")
              if not f:
                  return "I can't find a function called safe_parse."
              for arg, want in [("8080", 8080), ("http", None), ("70000", None), ("", None)]:
                  ok, got = H.call(f, arg)
                  if not ok:
                      return "safe_parse(" + repr(arg) + ") crashed with " + type(got).__name__ + ". It should return " + repr(want) + "."
                  if got != want:
                      return "safe_parse(" + repr(arg) + ") returned " + repr(got) + ", expected " + repr(want) + "."
              ok, got = H.call(f, None)
              if ok:
                  return ("safe_parse(None) quietly returned " + repr(got) + ". None isn't text, so that's a bug in the caller and it should crash. "
                          "Your except catches too much: catch ValueError only.")
              return True
        `
      },
      {
        id: "loop",
        text: "Loop over <code>ports_raw</code> with <code>safe_parse</code>. Build <code>valid</code> (a list of the good ports) and <code>errors</code> (how many were bad).",
        hints: ["For each item, call safe_parse. If the result is None, add 1 to errors. Otherwise append it to valid.", "valid = []\nerrors = 0\nfor text in ports_raw:\n    port = safe_parse(text)\n    if port is None:\n        errors += 1\n    else:\n        valid.append(port)"],
        check: py`
          def check(ns, out, run, src):
              r = H.expect(ns, "valid", [22, 80, 443], list)
              if r is not True:
                  return r
              r = H.expect(ns, "errors", 3)
              if r is not True:
                  return r
              return H.alt(src, run, r"ports_raw\s*=\s*\[[^\]]*\]", 'ports_raw = ["8080", "x", "1"]',
                           {"valid": [8080, 1], "errors": 1}, "a different ports_raw list")
        `
      },
      {
        id: "file",
        text: "<code>read_config(path)</code> returns the file's text, or <code>\"\"</code> (an empty string) if the file doesn't exist. <code>app.conf</code> exists. <code>missing.conf</code> doesn't.",
        hints: ["Wrap the with open(...) block in try, and catch FileNotFoundError.", 'def read_config(path):\n    try:\n        with open(path) as f:\n            return f.read()\n    except FileNotFoundError:\n        return ""'],
        check: py`
          def check(ns, out, run, src):
              f = H.fn(ns, "read_config")
              if not f:
                  return "I can't find a function called read_config."
              ok, got = H.call(f, "app.conf")
              if not ok:
                  return "read_config(\"app.conf\") crashed: " + type(got).__name__ + ": " + str(got)
              if got != "# deploy settings\nport=8080\nmode=prod\n":
                  return "read_config(\"app.conf\") should return the file's full text. Got " + H.short(got)
              ok, got = H.call(f, "missing.conf")
              if not ok:
                  return "read_config(\"missing.conf\") crashed with " + type(got).__name__ + ". Catch it and return \"\"."
              if got != "":
                  return "read_config(\"missing.conf\") returned " + H.short(got) + ", expected \"\"."
              return True
        `
      }
    ],
    debrief: "<p>Ticket closed. Bad ports are rejected loudly where they come in, the script counts them and carries on, and a missing config file no longer crashes anything.</p>" +
      "<p><b>Security principle, \"fail safely\":</b> validate input at the edge, raise clear errors, and handle only the errors you expect. A bare <code>except:</code> that swallows everything can hide attacks and bugs alike.</p>",
    realworld: "Real scripts also <em>log</em> what they skipped (e.g. <code>print(f\"skipping bad port: {text!r}\")</code>), so you can find the broken config line afterwards.",
    quiz: [
      { q: "Which part of a traceback do you read first?", options: ["The top line", "The last line", "The middle", "None of it"], answer: 1,
        why: "The last line gives the error type and message. The lines above it show where it happened." },
      { q: "What's wrong with <code>except:</code> on its own?", options: ["Nothing", "It's slower", "It catches every error, including bugs you'd want to see", "It's a syntax error"], answer: 2,
        why: "Catch the specific error you expect, so unexpected problems still surface." },
      { q: "<code>int(\"http\")</code> raises…", options: ["TypeError", "ValueError", "NameError", "Nothing, it returns 0"], answer: 1,
        why: "The type (str) is fine but the value can't be turned into a number, so it's a ValueError." }
    ]
  });

  /* ------------------------------------------------------------------ PY-108 */
  LABS.push({
    id: "py-108", n: 8, module: 1, ticket: "PY-108", xp: 100,
    title: "Server inventory",
    topic: "Nested data: lists of dicts",
    from: "Dev Patel · Security team",
    story: "<p>A new OpenSSL advisory just dropped. Our inventory export is a <b>list of servers</b>, and each server is a <b>dictionary</b> with another dictionary of installed packages inside it.</p>" +
      "<p>I need to know which servers face the internet, which run a vulnerable OpenSSL, who owns what, and which ones to patch <em>tonight</em>.</p>",
    learn:
      "<h3>Data inside data</h3><p>Real data is rarely one flat list. Scan results, API responses and JSON files are usually a <b>list of dictionaries</b>, and those dictionaries can contain more lists and dictionaries. You reach inside by chaining <code>[ ]</code> lookups, one level at a time.</p>" +
      ex('server = {"host": "web-01", "packages": {"openssl": "3.0.2", "nginx": "1.18.0"}}\nprint(server["host"])\nprint(server["packages"])\nprint(server["packages"]["openssl"])') +
      "<p>Read <code>server[\"packages\"][\"openssl\"]</code> left to right: take the server, then its packages, then the openssl entry.</p>" +
      "<h3>Looping over a list of dicts</h3><p>Each time round the loop, the variable holds one whole dictionary.</p>" +
      ex('servers = [{"host": "web-01", "env": "prod"}, {"host": "ci-01", "env": "dev"}]\nfor s in servers:\n    print(s["host"], "is in", s["env"])') +
      "<h3>Filtering</h3><p>Same accumulator pattern as before: an empty list, a loop, and an <code>if</code>.</p>" +
      ex('servers = [{"host": "web-01", "env": "prod"}, {"host": "ci-01", "env": "dev"}]\nprod = []\nfor s in servers:\n    if s["env"] == "prod":\n        prod.append(s["host"])\nprint(prod)') +
      "<h3>Grouping into a dict of lists</h3><p>To group items, make each key's value a list. Create the empty list the first time you see a key, then append to it.</p>" +
      ex('servers = [{"host": "web-01", "env": "prod"}, {"host": "db-01", "env": "prod"}, {"host": "ci-01", "env": "dev"}]\nby_env = {}\nfor s in servers:\n    env = s["env"]\n    if env not in by_env:\n        by_env[env] = []\n    by_env[env].append(s["host"])\nprint(by_env)') +
      "<h3>Missing keys deep down</h3><p>Chain <code>.get()</code> with an empty dict as the default, so a missing level doesn't crash:</p>" +
      ex('s = {"host": "printer-01"}\nprint(s.get("packages", {}).get("openssl", "not installed"))') +
      '<div class="callout"><b>Explore first.</b> When data is unfamiliar, print one item before writing the loop: <code>print(servers[0])</code> in the console shows you exactly what keys you have.</div>',
    starter: py`
      # PY-108 · Server inventory
      servers = [
          {"host": "web-01", "team": "web", "env": "prod", "public": True,
           "packages": {"openssl": "3.0.2", "nginx": "1.18.0"}},
          {"host": "web-02", "team": "web", "env": "prod", "public": True,
           "packages": {"openssl": "3.0.13", "nginx": "1.24.0"}},
          {"host": "db-01", "team": "data", "env": "prod", "public": False,
           "packages": {"openssl": "3.0.2", "postgresql": "15.4"}},
          {"host": "ci-01", "team": "platform", "env": "dev", "public": True,
           "packages": {"openssl": "1.1.1f", "docker": "24.0.5"}},
          {"host": "vpn-01", "team": "platform", "env": "prod", "public": True,
           "packages": {"openssl": "3.0.2", "openvpn": "2.6.3"}},
      ]
      vulnerable_openssl = ["3.0.2", "1.1.1f"]

      # 1) public_hosts: names of servers that face the internet


      # 2) vulnerable: names of servers whose openssl version is in vulnerable_openssl


      # 3) by_team: team -> list of its server names


      # 4) Print "URGENT: <host> (<team>) openssl <version>" for servers that are
      #    public AND vulnerable AND in prod

    `,
    objectives: [
      {
        id: "public",
        text: "<code>public_hosts</code>: a list of the <code>host</code> names of every server where <code>public</code> is <code>True</code>, in order.",
        hints: ["Loop over servers. Each s is a dict, so s[\"public\"] is True or False and s[\"host\"] is its name.", "public_hosts = []\nfor s in servers:\n    if s[\"public\"]:\n        public_hosts.append(s[\"host\"])"],
        check: py`
          def check(ns, out, run, src):
              r = H.expect(ns, "public_hosts", ["web-01", "web-02", "ci-01", "vpn-01"], list)
              if r is not True:
                  return r
              return H.alt(src, run, r"\"public\":\s*True", '"public": False',
                           {"public_hosts": ["web-02", "ci-01", "vpn-01"]}, "web-01 being private")
        `
      },
      {
        id: "vuln",
        text: "<code>vulnerable</code>: the host names whose OpenSSL version (inside <code>packages</code>) is in <code>vulnerable_openssl</code>.",
        hints: ["Go two levels deep: s[\"packages\"][\"openssl\"] gives the version string. Then check it with in.", "vulnerable = []\nfor s in servers:\n    if s[\"packages\"][\"openssl\"] in vulnerable_openssl:\n        vulnerable.append(s[\"host\"])"],
        check: py`
          def check(ns, out, run, src):
              r = H.expect(ns, "vulnerable", ["web-01", "db-01", "ci-01", "vpn-01"], list)
              if r is not True:
                  return r
              return H.alt(src, run, r"vulnerable_openssl\s*=\s*\[[^\]]*\]", 'vulnerable_openssl = ["3.0.13"]',
                           {"vulnerable": ["web-02"]}, "a different list of vulnerable versions")
        `
      },
      {
        id: "team",
        text: "<code>by_team</code>: a dict mapping each team to a list of its host names, e.g. <code>{\"web\": [\"web-01\", \"web-02\"], ...}</code>.",
        hints: ["Start with by_team = {}. For each server, create an empty list the first time you see its team, then append the host.", "by_team = {}\nfor s in servers:\n    team = s[\"team\"]\n    if team not in by_team:\n        by_team[team] = []\n    by_team[team].append(s[\"host\"])"],
        check: py`
          def check(ns, out, run, src):
              r = H.expect(ns, "by_team", {"web": ["web-01", "web-02"], "data": ["db-01"], "platform": ["ci-01", "vpn-01"]}, dict)
              if r is not True:
                  return r
              return H.alt(src, run, r"\"team\":\s*\"data\"", '"team": "web"',
                           {"by_team": {"web": ["web-01", "web-02", "db-01"], "platform": ["ci-01", "vpn-01"]}},
                           "db-01 moving to the web team")
        `
      },
      {
        id: "urgent",
        text: "Print <code>URGENT: &lt;host&gt; (&lt;team&gt;) openssl &lt;version&gt;</code> for every server that is public <b>and</b> vulnerable <b>and</b> in <code>prod</code>.",
        hints: ["Combine three conditions with and inside one loop. ci-01 is public and vulnerable but it's dev, so it shouldn't appear.", "for s in servers:\n    version = s[\"packages\"][\"openssl\"]\n    if s[\"public\"] and version in vulnerable_openssl and s[\"env\"] == \"prod\":\n        print(f\"URGENT: {s['host']} ({s['team']}) openssl {version}\")"],
        check: py`
          def check(ns, out, run, src):
              want = ["URGENT: web-01 (web) openssl 3.0.2", "URGENT: vpn-01 (platform) openssl 3.0.2"]
              got = [l for l in H.lines(out) if l.startswith("URGENT")]
              if got != want:
                  if not got:
                      return "No URGENT lines yet. Expected:\n  " + "\n  ".join(want)
                  return "Expected:\n  " + "\n  ".join(want) + "\nYou printed:\n  " + "\n  ".join(got)
              new = H.sub(src, r"vulnerable_openssl\s*=\s*\[[^\]]*\]", 'vulnerable_openssl = ["3.0.13"]')
              if new:
                  n, o, e = run(new)
                  got2 = [l for l in H.lines(o) if l.startswith("URGENT")]
                  if got2 != ["URGENT: web-02 (web) openssl 3.0.13"]:
                      return "When I changed vulnerable_openssl, the URGENT lines didn't follow. Build them from the data."
              return True
        `
      }
    ],
    debrief: "<p>Ticket closed. web-01 and vpn-01 get patched tonight. db-01 and ci-01 are vulnerable too, but they aren't exposed to the internet in production, so they can wait for the normal patch window.</p>" +
      "<p><b>That's real triage:</b> severity alone doesn't decide priority. <em>Exposure</em> (is it public?) and <em>environment</em> (is it prod?) matter just as much. Security teams make this call every day.</p>",
    realworld: "In Module 2 you'll load data like this from a real JSON file with <code>json.load()</code>. It comes back as exactly this kind of list of dicts.",
    quiz: [
      { q: "<code>s = {\"pkg\": {\"ssl\": \"3.0\"}}</code>. How do you get <code>\"3.0\"</code>?", options: ["s[\"ssl\"]", "s[\"pkg\"][\"ssl\"]", "s.pkg.ssl", "s[\"pkg\", \"ssl\"]"], answer: 1,
        why: "Chain the lookups: first the outer key, then the inner key." },
      { q: "When grouping into a dict of lists, why check <code>if key not in d</code> first?", options: ["It's faster", "To create the empty list before appending to it", "Dicts require it", "To sort the keys"], answer: 1,
        why: "Appending to a key that doesn't exist yet raises a KeyError, so create its list first." },
      { q: "A server is vulnerable but not public and not in prod. Its patch priority is…", options: ["Highest", "Lower than an exposed prod server", "Zero, ignore it", "Same as everything else"], answer: 1,
        why: "It still needs patching, but exposure and environment push exposed production servers to the front." }
    ]
  });

  /* ------------------------------------------------------------------ PY-109 */
  LABS.push({
    id: "py-109", n: 9, module: 1, ticket: "PY-109", xp: 100,
    title: "Vulnerability report",
    topic: "zip, enumerate, sorting & formatting",
    from: "Dev Patel · Security team",
    story: "<p>The scanner gave us two lists: the findings, and their CVSS scores in the same order. Management wants a <b>ranked, numbered report</b>, worst first.</p>" +
      "<p>Also, schedule every scan type on every host, and add the average score at the bottom.</p>",
    learn:
      "<h3>Tuples</h3><p>A tuple is like a list that can't be changed, written with round brackets. It's handy for a fixed group of values, like a finding and its score.</p>" +
      ex('pair = ("Redis exposed", 9.8)\nprint(pair[0], pair[1])\nname, score = pair\nprint(name, "scores", score)') +
      "<h3>zip(): walk two lists side by side</h3><p><code>zip()</code> pairs up items at the same position.</p>" +
      ex('names = ["web-01", "db-01"]\nips = ["10.0.0.10", "10.0.0.20"]\nfor name, ip in zip(names, ips):\n    print(name, "->", ip)\nprint(list(zip(names, ips)))') +
      "<h3>enumerate(): number things as you loop</h3><p><code>enumerate()</code> gives you a counter and the item together. <code>start=1</code> makes it count from 1, the way people number lists.</p>" +
      ex('steps = ["build", "test", "deploy"]\nfor i, step in enumerate(steps, start=1):\n    print(f"{i}. {step}")') +
      "<h3>Sorting with a key</h3><p><code>sorted()</code> returns a new sorted list. To sort by something specific, like the score inside each pair, give it a <code>key</code> function. <code>reverse=True</code> puts the biggest first.</p>" +
      ex('pairs = [("web", 3.1), ("db", 9.0), ("ci", 5.5)]\n\ndef by_score(pair):\n    return pair[1]\n\nprint(sorted(pairs, key=by_score, reverse=True))') +
      "<p>For a small key function, people often write a <code>lambda</code>, a one-line function with no name. These two do the same thing:</p>" +
      ex('pairs = [("web", 3.1), ("db", 9.0), ("ci", 5.5)]\nprint(sorted(pairs, key=lambda p: p[1]))') +
      "<h3>Nested loops</h3><p>A loop inside a loop runs the inner loop completely for every round of the outer one.</p>" +
      ex('for host in ["web-01", "db-01"]:\n    for port in [22, 443]:\n        print(host, port)') +
      "<h3>Formatting numbers</h3><p>Inside an f-string, <code>:.1f</code> shows a number with 1 decimal place, and <code>:.2f</code> with 2.</p>" +
      ex('avg = 35.7 / 5\nprint(avg)\nprint(f"{avg:.2f}")\nprint(f"{9.8:.1f}")\nprint(sum([1, 2, 3]), len([1, 2, 3]))'),
    starter: py`
      # PY-109 · Vulnerability report
      findings = ["Outdated OpenSSL", "Redis exposed", "Weak TLS ciphers", "Telnet enabled", "Missing HSTS"]
      scores = [7.5, 9.8, 5.3, 8.8, 4.3]
      hosts = ["web-01", "db-01"]
      scan_types = ["tls", "ssh"]

      # 1) pairs: list of (finding, score) tuples


      # 2) ranked: pairs sorted by score, highest first


      # 3) Print the numbered report: "1. [9.8] Redis exposed"


      # 4) schedule: "host:scan" for every host and every scan type


      # 5) Print "Average CVSS: 7.14"

    `,
    objectives: [
      {
        id: "pairs",
        text: "<code>pairs</code>: a list of <code>(finding, score)</code> tuples, in the original order.",
        hints: ["zip() pairs the two lists. Wrap it in list() to get an actual list.", "pairs = list(zip(findings, scores))"],
        check: py`
          def check(ns, out, run, src):
              want = [("Outdated OpenSSL", 7.5), ("Redis exposed", 9.8), ("Weak TLS ciphers", 5.3), ("Telnet enabled", 8.8), ("Missing HSTS", 4.3)]
              return H.expect(ns, "pairs", want, list)
        `
      },
      {
        id: "ranked",
        text: "<code>ranked</code>: <code>pairs</code> sorted by score, highest first.",
        hints: ["sorted(pairs, key=..., reverse=True). The key function receives one pair and should return its score, pair[1].", "ranked = sorted(pairs, key=lambda p: p[1], reverse=True)"],
        check: py`
          def check(ns, out, run, src):
              want = [("Redis exposed", 9.8), ("Telnet enabled", 8.8), ("Outdated OpenSSL", 7.5), ("Weak TLS ciphers", 5.3), ("Missing HSTS", 4.3)]
              r = H.expect(ns, "ranked", want, list)
              if r is not True:
                  return r
              return H.alt(src, run, r"scores\s*=\s*\[[^\]]*\]", "scores = [1.0, 2.0, 3.0, 4.0, 5.0]",
                           {"ranked": [("Missing HSTS", 5.0), ("Telnet enabled", 4.0), ("Weak TLS ciphers", 3.0), ("Redis exposed", 2.0), ("Outdated OpenSSL", 1.0)]},
                           "different scores")
        `
      },
      {
        id: "report",
        text: "Print one numbered line per finding in <code>ranked</code>, like <code>1. [9.8] Redis exposed</code>. Use <code>enumerate</code> and <code>:.1f</code>.",
        hints: ["for i, pair in enumerate(ranked, start=1): then unpack the pair into name and score.", "for i, pair in enumerate(ranked, start=1):\n    name, score = pair\n    print(f\"{i}. [{score:.1f}] {name}\")"],
        check: py`
          def check(ns, out, run, src):
              want = ["1. [9.8] Redis exposed", "2. [8.8] Telnet enabled", "3. [7.5] Outdated OpenSSL", "4. [5.3] Weak TLS ciphers", "5. [4.3] Missing HSTS"]
              got = [l for l in H.lines(out) if re.match(r"^\d+\.\s", l)]
              if got != want:
                  if not got:
                      return "No numbered lines yet. The first one should be:\n  " + want[0]
                  return "Expected:\n  " + "\n  ".join(want) + "\nYou printed:\n  " + "\n  ".join(got)
              if "enumerate" not in src:
                  return "The lines are right. Now number them with enumerate() instead of a counter you manage yourself."
              return True
        `
      },
      {
        id: "schedule",
        text: "<code>schedule</code>: a list with <code>\"host:scan\"</code> for every host and every scan type: <code>[\"web-01:tls\", \"web-01:ssh\", \"db-01:tls\", \"db-01:ssh\"]</code>.",
        hints: ["Two loops, one inside the other: hosts outside, scan_types inside.", "schedule = []\nfor host in hosts:\n    for scan in scan_types:\n        schedule.append(f\"{host}:{scan}\")"],
        check: py`
          def check(ns, out, run, src):
              r = H.expect(ns, "schedule", ["web-01:tls", "web-01:ssh", "db-01:tls", "db-01:ssh"], list)
              if r is not True:
                  return r
              return H.alt(src, run, r"hosts\s*=\s*\[[^\]]*\]", 'hosts = ["api-01"]',
                           {"schedule": ["api-01:tls", "api-01:ssh"]}, "a different list of hosts")
        `
      },
      {
        id: "avg",
        text: "Print <code>Average CVSS: 7.14</code>: the average of <code>scores</code> with 2 decimal places.",
        hints: ["Average = sum(scores) / len(scores). Format it with :.2f inside the f-string.", "avg = sum(scores) / len(scores)\nprint(f\"Average CVSS: {avg:.2f}\")"],
        check: py`
          def check(ns, out, run, src):
              if "Average CVSS: 7.14" not in H.lines(out):
                  got = [l for l in H.lines(out) if l.startswith("Average")]
                  return "Expected the line 'Average CVSS: 7.14'" + (", got '" + got[-1] + "'." if got else ".")
              new = H.sub(src, r"scores\s*=\s*\[[^\]]*\]", "scores = [1.0, 2.0, 3.0, 4.0, 5.0]")
              if new:
                  n, o, e = run(new)
                  if "Average CVSS: 3.00" not in H.lines(o):
                      return "When I changed the scores, the average didn't change. Calculate it with sum() and len()."
              return True
        `
      }
    ],
    debrief: "<p>Ticket closed. Management gets a ranked list, so the exposed Redis server is the first thing they see.</p>" +
      "<p><b>About CVSS:</b> it scores a vulnerability from 0 to 10 (9.0+ is <em>critical</em>, 7.0–8.9 <em>high</em>). Ranking by CVSS is a good start, but as you saw in PY-108, exposure and environment should adjust the order.</p>",
    realworld: "<code>sorted(..., key=...)</code> is everywhere in real scripts: biggest log files, oldest accounts, most failed logins. It's one of the most-used patterns in Python.",
    quiz: [
      { q: "What does <code>list(zip([1, 2], [\"a\", \"b\"]))</code> give?", options: ["[1, 2, \"a\", \"b\"]", "[(1, \"a\"), (2, \"b\")]", "{1: \"a\", 2: \"b\"}", "An error"], answer: 1,
        why: "zip pairs items by position into tuples." },
      { q: "<code>for i, x in enumerate([\"a\", \"b\"])</code>: what is <code>i</code> on the first round?", options: ["1", "0", "\"a\"", "None"], answer: 1,
        why: "enumerate counts from 0 unless you pass start=1." },
      { q: "What does <code>f\"{2/3:.2f}\"</code> show?", options: ["0.6666", "0.67", "0.66", "2/3"], answer: 1,
        why: ":.2f rounds to 2 decimal places." }
    ]
  });

  /* ------------------------------------------------------------------ PY-110 capstone */
  LABS.push({
    id: "py-110", n: 10, module: 1, ticket: "PY-110", xp: 200, capstone: true,
    title: "Quarterly access review",
    topic: "Module 1 capstone project",
    from: "Maya Chen & Dev Patel",
    story: "<p>It's the end of the quarter, and the auditors want an <b>access review</b>: which accounts have weak passwords, no MFA, admin rights without MFA, or haven't been used in months.</p>" +
      "<p>HR's export is messy, as usual. Build the whole audit script yourself. This is everything from Module 1 in one project.</p>",
    learn:
      '<div class="callout warn"><b>Capstone rules.</b> There are no hints. Build it one function at a time and test each one in the console as you go (e.g. <code>normalize("  A@B.io ")</code> after pressing Run). ' +
      "If you get completely stuck, the Tasks tab has a button to reveal the full solution. The capstone then earns half XP.</div>" +
      "<h3>The data</h3><p><code>accounts</code> is a list of dicts. Each one has an <code>email</code> (messy), a <code>password</code>, <code>mfa</code> (True/False), <code>last_login_days</code> (a number, but one record has bad data) and <code>groups</code> (a list).</p>" +
      "<h3>What to build</h3>" +
      '<table class="t"><tr><th>Piece</th><th>Spec</th></tr>' +
      "<tr><td><code>normalize(email)</code></td><td>returns the email with no spaces at the ends, all lowercase</td></tr>" +
      "<tr><td><code>is_strong(password)</code></td><td>True if 12+ characters, not in <code>COMMON</code>, not letters-only, and has an uppercase letter</td></tr>" +
      "<tr><td><code>audit(account)</code></td><td>returns a <b>list</b> of issue strings for one account (empty list if it's clean). Check them in this order:<br>" +
      "1. <code>\"weak password\"</code> if the password isn't strong<br>" +
      "2. <code>\"no MFA\"</code> if mfa is False<br>" +
      "3. <code>\"admin without MFA\"</code> if \"admin\" is in its groups and mfa is False<br>" +
      "4. <code>\"login data missing\"</code> if last_login_days isn't a whole number (<code>type(x) is int</code>)<br>" +
      "5. otherwise <code>\"inactive\"</code> if last_login_days is more than 90</td></tr>" +
      "<tr><td><code>report</code></td><td>a dict: normalized email → its issues list, only for accounts that have at least one issue</td></tr>" +
      "<tr><td>printed report</td><td>one line per account in <code>report</code>, most issues first (ties keep their original order), then a summary line</td></tr></table>" +
      "<h3>Expected output</h3>" +
      '<pre class="code">bob.jones@kestrel.io: weak password, no MFA, admin without MFA\nsvc.backup@kestrel.io: weak password, no MFA, admin without MFA\nchen.wei@kestrel.io: weak password, login data missing\npriya.rao@kestrel.io: inactive\n4 of 6 accounts need action</pre>' +
      "<h3>Two new tools you'll want</h3>" +
      ex('issues = ["weak password", "no MFA"]\nprint(", ".join(issues))') +
      "<p><code>\", \".join(list)</code> glues a list of strings together with <code>\", \"</code> between them.</p>" +
      ex('report = {"a@x.io": ["x"], "b@x.io": ["x", "y", "z"], "c@x.io": ["x", "y"]}\nfor email, issues in sorted(report.items(), key=lambda item: len(item[1]), reverse=True):\n    print(email, len(issues))') +
      "<p><code>report.items()</code> gives (email, issues) pairs, and the key sorts them by how many issues each has.</p>",
    starter: py`
      # PY-110 · Quarterly access review (Module 1 capstone)
      COMMON = ["password1234", "qwertyuiop12", "letmeinletmein"]

      accounts = [
          {"email": "  Alice.Smith@Kestrel.IO ", "password": "Correct-Horse-42",
           "mfa": True, "last_login_days": 3, "groups": ["dev"]},
          {"email": "bob.jones@kestrel.io", "password": "hunter2",
           "mfa": False, "last_login_days": 12, "groups": ["dev", "admin"]},
          {"email": "Priya.Rao@Kestrel.io", "password": "Summer-Breeze-2024",
           "mfa": True, "last_login_days": 140, "groups": ["finance"]},
          {"email": "svc.backup@kestrel.io", "password": "qwertyuiop12",
           "mfa": False, "last_login_days": 1, "groups": ["admin"]},
          {"email": "Chen.Wei@kestrel.io", "password": "LongButNoDigits",
           "mfa": True, "last_login_days": "unknown", "groups": ["dev"]},
          {"email": "dana.lee@kestrel.io", "password": "Tr1cky-Pass-Phrase",
           "mfa": True, "last_login_days": 30, "groups": ["admin"]},
      ]


      def normalize(email):
          pass


      def is_strong(password):
          pass


      def audit(account):
          pass


      # Build report, then print it (most issues first) and the summary line

    `,
    solution: py`
      COMMON = ["password1234", "qwertyuiop12", "letmeinletmein"]

      accounts = [
          {"email": "  Alice.Smith@Kestrel.IO ", "password": "Correct-Horse-42",
           "mfa": True, "last_login_days": 3, "groups": ["dev"]},
          {"email": "bob.jones@kestrel.io", "password": "hunter2",
           "mfa": False, "last_login_days": 12, "groups": ["dev", "admin"]},
          {"email": "Priya.Rao@Kestrel.io", "password": "Summer-Breeze-2024",
           "mfa": True, "last_login_days": 140, "groups": ["finance"]},
          {"email": "svc.backup@kestrel.io", "password": "qwertyuiop12",
           "mfa": False, "last_login_days": 1, "groups": ["admin"]},
          {"email": "Chen.Wei@kestrel.io", "password": "LongButNoDigits",
           "mfa": True, "last_login_days": "unknown", "groups": ["dev"]},
          {"email": "dana.lee@kestrel.io", "password": "Tr1cky-Pass-Phrase",
           "mfa": True, "last_login_days": 30, "groups": ["admin"]},
      ]


      def normalize(email):
          return email.strip().lower()


      def is_strong(password):
          if len(password) < 12:
              return False
          if password in COMMON:
              return False
          if password.isalpha():
              return False
          if password.lower() == password:
              return False
          return True


      def audit(account):
          issues = []
          if not is_strong(account["password"]):
              issues.append("weak password")
          if not account["mfa"]:
              issues.append("no MFA")
              if "admin" in account["groups"]:
                  issues.append("admin without MFA")
          days = account["last_login_days"]
          if type(days) is not int:
              issues.append("login data missing")
          elif days > 90:
              issues.append("inactive")
          return issues


      report = {}
      for account in accounts:
          issues = audit(account)
          if issues:
              report[normalize(account["email"])] = issues

      for email, issues in sorted(report.items(), key=lambda item: len(item[1]), reverse=True):
          print(f"{email}: {', '.join(issues)}")
      print(f"{len(report)} of {len(accounts)} accounts need action")
    `,
    objectives: [
      {
        id: "normalize", hints: [],
        text: "<code>normalize(email)</code> returns the email trimmed and lowercased.",
        check: py`
          def check(ns, out, run, src):
              return H.func(ns, "normalize", [(("  Alice.Smith@Kestrel.IO ",), "alice.smith@kestrel.io"),
                                              (("BOB@X.IO",), "bob@x.io"), (("ok@x.io",), "ok@x.io")])
        `
      },
      {
        id: "strong", hints: [],
        text: "<code>is_strong(password)</code> applies all four rules, including the <code>COMMON</code> list.",
        check: py`
          def check(ns, out, run, src):
              return H.func(ns, "is_strong", [(("Correct-Horse-42",), True), (("hunter2",), False),
                                              (("qwertyuiop12",), False), (("LongButNoDigits",), False),
                                              (("lowercase-only-42",), False), (("Tr1cky-Pass-Phrase",), True)])
        `
      },
      {
        id: "audit", hints: [],
        text: "<code>audit(account)</code> returns the right issues, in the right order, and copes with bad <code>last_login_days</code> data.",
        check: py`
          def check(ns, out, run, src):
              def acct(pw="Strong-Pass-99", mfa=True, days=10, groups=()):
                  return {"email": "t@x.io", "password": pw, "mfa": mfa, "last_login_days": days, "groups": list(groups)}
              cases = [
                  ((acct(),), []),
                  ((acct(pw="hunter2", mfa=False, days=12, groups=["dev", "admin"]),), ["weak password", "no MFA", "admin without MFA"]),
                  ((acct(days=140),), ["inactive"]),
                  ((acct(days=90),), []),
                  ((acct(days=91),), ["inactive"]),
                  ((acct(pw="LongButNoDigits", days="unknown"),), ["weak password", "login data missing"]),
                  ((acct(days=None),), ["login data missing"]),
                  ((acct(mfa=False, groups=["dev"]),), ["no MFA"]),
                  ((acct(groups=["admin"]),), []),
              ]
              f = H.fn(ns, "audit")
              if not f:
                  return "I can't find a function called audit."
              for args, want in cases:
                  ok, got = H.call(f, *args)
                  a = args[0]
                  desc = "audit() for an account with password=" + repr(a["password"]) + ", mfa=" + repr(a["mfa"]) + ", last_login_days=" + repr(a["last_login_days"]) + ", groups=" + repr(a["groups"])
                  if not ok:
                      return desc + " crashed: " + type(got).__name__ + ": " + str(got)
                  if got != want:
                      return desc + " returned " + repr(got) + ", expected " + repr(want) + "."
              return True
        `
      },
      {
        id: "report", hints: [],
        text: "<code>report</code> maps each normalized email to its issues, for flagged accounts only.",
        check: py`
          def check(ns, out, run, src):
              want = {"bob.jones@kestrel.io": ["weak password", "no MFA", "admin without MFA"],
                      "priya.rao@kestrel.io": ["inactive"],
                      "svc.backup@kestrel.io": ["weak password", "no MFA", "admin without MFA"],
                      "chen.wei@kestrel.io": ["weak password", "login data missing"]}
              return H.expect(ns, "report", want, dict)
        `
      },
      {
        id: "print", hints: [],
        text: "The printed report matches the expected output exactly: most issues first, then <code>4 of 6 accounts need action</code>.",
        check: py`
          def check(ns, out, run, src):
              want = ["bob.jones@kestrel.io: weak password, no MFA, admin without MFA",
                      "svc.backup@kestrel.io: weak password, no MFA, admin without MFA",
                      "chen.wei@kestrel.io: weak password, login data missing",
                      "priya.rao@kestrel.io: inactive",
                      "4 of 6 accounts need action"]
              r = H.printed(out, want)
              if r is not True:
                  return r
              new = H.sub(src, r"\"mfa\":\s*False", '"mfa": True')
              if new:
                  n, o, e = run(new)
                  want2 = ["svc.backup@kestrel.io: weak password, no MFA, admin without MFA",
                           "chen.wei@kestrel.io: weak password, login data missing",
                           "bob.jones@kestrel.io: weak password",
                           "priya.rao@kestrel.io: inactive",
                           "4 of 6 accounts need action"]
                  if H.lines(o) != want2:
                      return "Works for this data, but when I turned on MFA for bob, the report didn't update correctly. Build every line from audit() results."
              return True
        `
      }
    ],
    debrief: "<p><b>Module 1 complete!</b> You built a real audit tool from scratch: data cleaning, validation rules, nested data, error-tolerant checks, sorting and a formatted report.</p>" +
      "<p>Access reviews like this are a standard control in security audits such as SOC 2 and ISO 27001. Teams often automate them with scripts very close to the one you just wrote.</p>" +
      "<p>Next up, <b>Module 2: Working with data</b>: files, regex, JSON, CSV and YAML.</p>",
    realworld: "Copy your solution into a file called <code>access_review.py</code> and run it with <code>python access_review.py</code>. It's your first portfolio script. In a later side quest you'll push it to your GitHub.",
    quiz: []
  });

  /* Reference solutions, shown after a lab is closed ("Compare with a reference solution"). */
  var SOLUTIONS = {
    "py-101": py`
      server_name = "web-01"
      cpu_percent = 37.5
      uptime_days = 12
      is_healthy = True
      uptime_hours = uptime_days * 24
      print(f"{server_name} | CPU {cpu_percent}% | up {uptime_hours}h | healthy: {is_healthy}")
    `,
    "py-102": py`
      raw = "  Alice.Smith@Kestrel.IO  "
      clean = raw.strip().lower()
      username, domain = clean.split("@")
      login = username.replace(".", "_")
      first, last = username.split(".")
      initials = (first[0] + last[0]).upper()
    `,
    "py-103": py`
      password = input("New password: ")
      common = ["password1234", "qwertyuiop12", "letmeinletmein"]

      if len(password) < 12:
          print("REJECT: too short")
      elif password in common:
          print("REJECT: too common")
      elif password.isalpha():
          print("REJECT: needs a number or symbol")
      elif password.lower() == password:
          print("REJECT: needs an uppercase letter")
      else:
          print("ACCEPT")
    `,
    "py-104": py`
      open_ports = [22, 80, 443, 3306, 8080, 23, 6379]
      risky_ports = [23, 3306, 6379]

      for port in open_ports:
          print(f"port {port} open")

      risky_count = 0
      to_close = []
      for port in open_ports:
          if port in risky_ports:
              risky_count += 1
              to_close.append(port)

      attempts = 1
      while not ping("db-01"):
          attempts += 1
    `,
    "py-105": py`
      failed_ips = [
          "185.220.101.47", "10.0.0.5", "185.220.101.47", "45.155.205.233",
          "185.220.101.47", "192.168.1.20", "45.155.205.233", "185.220.101.47",
          "10.0.0.5", "45.155.205.233", "185.220.101.47", "10.0.0.5",
      ]
      owners = {"10.0.0.5": "vpn-gateway", "192.168.1.20": "printer"}

      counts = {}
      for ip in failed_ips:
          counts[ip] = counts.get(ip, 0) + 1

      top_ip = max(counts, key=counts.get)

      blocklist = []
      for ip, n in counts.items():
          if n >= 3:
              blocklist.append(ip)
      blocklist = sorted(blocklist)

      for ip in blocklist:
          owner = owners.get(ip, "unknown")
          print(f"{ip} ({owner}): {counts[ip]} failures")
    `,
    "py-106": py`
      def is_strong(password):
          if len(password) < 12:
              return False
          if password.isalpha():
              return False
          if password.lower() == password:
              return False
          return True


      def mask(secret, show=4):
          if len(secret) <= show:
              return "*" * len(secret)
          return "*" * (len(secret) - show) + secret[-show:]


      def risk_level(port):
          if port in [23, 3389, 6379]:
              return "high"
          if port in [21, 3306]:
              return "medium"
          return "low"


      def summarize(ports):
          totals = {"high": 0, "medium": 0, "low": 0}
          for port in ports:
              totals[risk_level(port)] += 1
          return totals


      print(is_strong("Correct-Horse-42"))
      print(mask("sk_live_abcd1234"))
    `,
    "py-107": py`
      ports_raw = ["22", "80", "http", "70000", " 443 ", ""]


      def parse_port(text):
          port = int(text)
          if port < 1 or port > 65535:
              raise ValueError(f"port out of range: {port}")
          return port


      def safe_parse(text):
          try:
              return parse_port(text)
          except ValueError:
              return None


      def read_config(path):
          try:
              with open(path) as f:
                  return f.read()
          except FileNotFoundError:
              return ""


      valid = []
      errors = 0
      for text in ports_raw:
          port = safe_parse(text)
          if port is None:
              errors += 1
          else:
              valid.append(port)
    `,
    "py-108": py`
      # (data from the starter code goes here)

      public_hosts = []
      for s in servers:
          if s["public"]:
              public_hosts.append(s["host"])

      vulnerable = []
      for s in servers:
          if s["packages"]["openssl"] in vulnerable_openssl:
              vulnerable.append(s["host"])

      by_team = {}
      for s in servers:
          team = s["team"]
          if team not in by_team:
              by_team[team] = []
          by_team[team].append(s["host"])

      for s in servers:
          version = s["packages"]["openssl"]
          if s["public"] and version in vulnerable_openssl and s["env"] == "prod":
              print(f"URGENT: {s['host']} ({s['team']}) openssl {version}")
    `,
    "py-109": py`
      findings = ["Outdated OpenSSL", "Redis exposed", "Weak TLS ciphers", "Telnet enabled", "Missing HSTS"]
      scores = [7.5, 9.8, 5.3, 8.8, 4.3]
      hosts = ["web-01", "db-01"]
      scan_types = ["tls", "ssh"]

      pairs = list(zip(findings, scores))
      ranked = sorted(pairs, key=lambda p: p[1], reverse=True)

      for i, pair in enumerate(ranked, start=1):
          name, score = pair
          print(f"{i}. [{score:.1f}] {name}")

      schedule = []
      for host in hosts:
          for scan in scan_types:
              schedule.append(f"{host}:{scan}")

      avg = sum(scores) / len(scores)
      print(f"Average CVSS: {avg:.2f}")
    `
  };
  LABS.forEach(function (l) { if (!l.solution && SOLUTIONS[l.id]) l.solution = SOLUTIONS[l.id]; });

  /* Shared helper appended to PY-103 checks (defined below; hoisted into the strings above by reference). */
  function VERDICT_SRC() {
    return py`
      def _verdict(run, pw, want):
          n, o, e = run(None, [pw])
          verdicts = [l.strip() for l in o.splitlines() if l.strip().startswith(("REJECT", "ACCEPT"))]
          if e:
              return "For " + repr(pw) + " your code crashed: " + e[0].splitlines()[-1]
          if not verdicts:
              return "For " + repr(pw) + " your program printed no verdict. Expected: " + want
          if len(verdicts) > 1:
              return ("For " + repr(pw) + " your program printed " + str(len(verdicts)) + " verdicts: " +
                      " / ".join(verdicts) + ". Use elif so only the first matching rule runs.")
          if verdicts[0] != want:
              return "For " + repr(pw) + " expected '" + want + "' but got '" + verdicts[0] + "'."
          return True
    `;
  }

  /* Upcoming labs — shown in the sidebar as the roadmap. */
  var UPCOMING = [
    { module: 2, title: "Files", topic: "Read & write files" },
    { module: 2, title: "Sets, tuples & comprehensions", topic: "Compare and transform data" },
    { module: 2, title: "Regex", topic: "Find IPs, emails, timestamps" },
    { module: 2, title: "JSON & CSV", topic: "Reports and exports" },
    { module: 2, title: "YAML configs", topic: "Spot pipeline misconfigurations" },
    { module: 2, title: "Standard library", topic: "datetime, Counter, defaultdict" },
    { module: 2, title: "Module 2 capstone", topic: "Project", capstone: true },
    { module: 3, title: "Log analysis", topic: "Detect a brute-force attack" },
    { module: 3, title: "HTTP & APIs", topic: "Talk to a (simulated) REST API" },
    { module: 3, title: "Hashing", topic: "File integrity with hashlib" },
    { module: 3, title: "Secrets scanner", topic: "Find hard-coded keys" },
    { module: 3, title: "Dependency check", topic: "Match packages to CVEs" },
    { module: 3, title: "Command-line tools", topic: "argparse: flags, options, --help" },
    { module: 3, title: "Env vars & CI gates", topic: "Secrets from env, exit codes" },
    { module: 3, title: "Classes", topic: "Model a security finding" },
    { module: 3, title: "Testing", topic: "assert and pytest" },
    { module: 3, title: "Module 3 capstone", topic: "Project", capstone: true },
    { module: 4, title: "Code review", topic: "Spot the vulnerable line" },
    { module: 4, title: "SQL injection", topic: "Exploit it, then fix it" },
    { module: 4, title: "Command injection", topic: "Unsafe eval and shell calls" },
    { module: 4, title: "XSS", topic: "Output encoding" },
    { module: 4, title: "Path traversal", topic: "Keep users inside the folder" },
    { module: 4, title: "Insecure deserialization", topic: "pickle and yaml.load" },
    { module: 4, title: "Password storage", topic: "Salted hashes & secure tokens" },
    { module: 4, title: "Module 4 capstone", topic: "Build a mini security scanner", capstone: true }
  ];

  window.PY_TRACK = { MODULES: MODULES, LABS: LABS, UPCOMING: UPCOMING, py: py };
})();
