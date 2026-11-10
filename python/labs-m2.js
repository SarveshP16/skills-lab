/* sudo learn — Python Module 2: Working with data (PY-111..117).
   Same lab/drill format as labs.js and drills.js. Loaded after both: pushes its labs into
   PY_TRACK.LABS, attaches their drills and reference solutions, and drops the Module 2 roadmap rows. */
(function () {
  "use strict";
  var T = window.PY_TRACK;
  var py = T.py;
  function ex(code) { return '<pre class="ex">' + esc(code) + "</pre>"; }
  function esc(s) { return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
  function lines() { return Array.prototype.slice.call(arguments).join("\n") + "\n"; }

  var LABS = [];

  /* ================================================================== PY-111 */
  var BACKUP_LOGS = {
    "logs/backup-mon.log": lines("02:00 START nightly backup", "02:05 OK db-01", "02:09 ERROR web-02 disk full", "02:15 OK web-01", "02:20 END"),
    "logs/backup-tue.log": lines("02:00 START nightly backup", "02:04 OK db-01", "02:07 OK web-01", "02:11 OK web-02", "02:20 END"),
    "logs/backup-wed.log": lines("02:00 START nightly backup", "02:03 ERROR db-01 connection refused", "02:08 ERROR web-02 disk full", "02:12 OK web-01", "02:20 END"),
    "logs/notes.txt": lines("web-02 disk is nearly full, ticket raised")
  };

  LABS.push({
    id: "py-111", n: 11, module: 2, ticket: "PY-111", xp: 100,
    title: "Backup job logs",
    topic: "Reading & writing files, pathlib",
    from: "Maya Chen · SRE lead",
    story: "<p>The nightly backup job writes one log file per night into a <code>logs</code> folder. Somebody has to read them every morning, and this week that somebody was me. Three times.</p>" +
      "<p>Let's automate it: count the <code>ERROR</code> lines in every log and write a <code>summary.txt</code> I can glance at with my coffee.</p>",
    learn:
      '<div class="callout"><b>Files in this lab.</b> The lab puts real files in a small virtual disk inside your browser: <code>logs/backup-mon.log</code>, <code>logs/backup-tue.log</code>, <code>logs/backup-wed.log</code> and <code>logs/notes.txt</code>. Your code can read them and create new files next to them.</div>' +
      "<h3>Opening a file with <code>with</code></h3><p><code>open(path)</code> gives you a file object. Wrap it in <code>with</code> so Python closes the file for you when the block ends, even if an error happens inside.</p>" +
      ex('with open("logs/backup-mon.log") as f:\n    text = f.read()\nprint(text)') +
      "<h3>Reading line by line</h3><p>Looping over the file gives you one line at a time. Each line still ends with a newline <code>\\n</code>, so <code>.strip()</code> it before printing or comparing.</p>" +
      ex('with open("logs/backup-wed.log") as f:\n    for line in f:\n        if "ERROR" in line:\n            print(line.strip())') +
      "<p>Looping is also how you'd read a 2 GB log: Python only holds one line in memory at a time, whereas <code>f.read()</code> loads the whole file.</p>" +
      "<h3>Modes: read, write, append</h3>" +
      '<table class="t"><tr><th>Mode</th><th>What it does</th></tr>' +
      '<tr><td><code>"r"</code> (default)</td><td>read; error if the file doesn\'t exist</td></tr>' +
      '<tr><td><code>"w"</code></td><td>write; creates the file, or <b>erases</b> it if it already exists</td></tr>' +
      '<tr><td><code>"a"</code></td><td>append; adds to the end and keeps what was there</td></tr></table>' +
      "<p><code>f.write()</code> doesn't add a newline for you. Put <code>\\n</code> at the end of every line you write.</p>" +
      ex('with open("hello.txt", "w") as f:\n    f.write("first line\\n")\n    f.write("second line\\n")\nwith open("hello.txt", "a") as f:\n    f.write("added later\\n")\nprint(open("hello.txt").read())') +
      "<h3>pathlib: paths as objects</h3><p><code>Path</code> from the <code>pathlib</code> module makes working with folders easier. <code>/</code> joins path parts, and <code>.glob(\"*.log\")</code> finds the files matching a pattern.</p>" +
      ex('from pathlib import Path\n\nfolder = Path("logs")\nprint(folder.exists())\nfor p in sorted(folder.glob("*.log")):\n    print(p, "->", p.name, p.stem, p.suffix)\n\nprint((folder / "notes.txt").read_text())') +
      '<table class="t"><tr><th>For <code>Path("logs/backup-mon.log")</code></th><th>Gives</th></tr>' +
      "<tr><td><code>.name</code></td><td><code>\"backup-mon.log\"</code></td></tr>" +
      "<tr><td><code>.stem</code></td><td><code>\"backup-mon\"</code></td></tr>" +
      "<tr><td><code>.suffix</code></td><td><code>\".log\"</code></td></tr>" +
      "<tr><td><code>.exists()</code></td><td><code>True</code></td></tr>" +
      "<tr><td><code>.read_text()</code></td><td>the whole file as a string</td></tr></table>" +
      "<p><code>open()</code> accepts a <code>Path</code> as well as a plain string.</p>",
    starter: py`
      # PY-111 · Backup job logs
      from pathlib import Path


      def count_errors(path):
          pass


      # 2) log_files: sorted list of the NAMES of the .log files in the logs folder


      # 3) errors_by_file: {file name: number of ERROR lines in it}


      # 4) Write summary.txt

    `,
    files: BACKUP_LOGS,
    removeFiles: ["summary.txt", "logs/backup-thu.log", "_check.log"],
    objectives: [
      {
        id: "count",
        text: "<code>count_errors(path)</code> opens the file and returns how many <b>lines</b> contain <code>ERROR</code>.",
        hints: ["Open the file with with open(path) as f:, loop over f, and add 1 to a counter when \"ERROR\" in line.",
          'def count_errors(path):\n    count = 0\n    with open(path) as f:\n        for line in f:\n            if "ERROR" in line:\n                count += 1\n    return count'],
        check: py`
          def check(ns, out, run, src):
              import os
              f = H.fn(ns, "count_errors")
              if not f:
                  return "I can't find a function called count_errors."
              for path, want in [("logs/backup-mon.log", 1), ("logs/backup-tue.log", 0), ("logs/backup-wed.log", 2)]:
                  ok, got = H.call(f, path)
                  if not ok:
                      return "count_errors(" + repr(path) + ") crashed: " + type(got).__name__ + ": " + str(got)
                  if got != want:
                      return "count_errors(" + repr(path) + ") returned " + H.short(got) + ", expected " + str(want) + "."
              with open("_check.log", "w") as fh:
                  fh.write("ERROR ERROR retrying\nall OK\nERROR again\n")
              ok, got = H.call(f, "_check.log")
              os.remove("_check.log")
              if ok and got == 3:
                  return "For a file where one line says ERROR twice, you counted 3. Count lines that contain ERROR, not every ERROR word."
              if not ok or got != 2:
                  return "For a file with 2 ERROR lines, count_errors returned " + H.short(got) + "."
              return True
        `
      },
      {
        id: "glob",
        text: "<code>log_files</code> is a sorted list of the <b>names</b> (strings) of the <code>.log</code> files in <code>logs</code>. Use <code>Path(\"logs\").glob(\"*.log\")</code>. <code>notes.txt</code> isn't a log.",
        hints: ["sorted(Path(\"logs\").glob(\"*.log\")) gives Path objects in order. Each one's .name is the file name as a string.",
          'log_files = []\nfor p in sorted(Path("logs").glob("*.log")):\n    log_files.append(p.name)'],
        check: py`
          def check(ns, out, run, src):
              import os
              want = ["backup-mon.log", "backup-tue.log", "backup-wed.log"]
              got = ns.get("log_files", "(missing)")
              if got == "(missing)":
                  return "I can't find a variable called log_files yet."
              if isinstance(got, list) and got and not all(isinstance(x, str) for x in got):
                  return "log_files contains " + type(got[0]).__name__ + " objects. Use each path's .name to get the file name as a string."
              r = H.expect(ns, "log_files", want, list)
              if r is not True:
                  return r
              with open("logs/backup-thu.log", "w") as fh:
                  fh.write("02:00 START nightly backup\n02:01 ERROR db-01 timeout\n")
              n, o, e = run()
              os.remove("logs/backup-thu.log")
              if n.get("log_files") != ["backup-mon.log", "backup-thu.log", "backup-tue.log", "backup-wed.log"]:
                  return "When I added logs/backup-thu.log, log_files came out as " + H.short(n.get("log_files")) + ". Build it from the folder, not by typing the names."
              return True
        `
      },
      {
        id: "dict",
        text: "<code>errors_by_file</code> maps each log file's name to its number of ERROR lines, using <code>count_errors</code>.",
        hints: ["Loop over the paths from glob again (or over log_files, joining with Path(\"logs\") / name). Store count_errors(path) under the file's name.",
          'errors_by_file = {}\nfor name in log_files:\n    errors_by_file[name] = count_errors(Path("logs") / name)'],
        check: py`
          def check(ns, out, run, src):
              import os
              r = H.expect(ns, "errors_by_file", {"backup-mon.log": 1, "backup-tue.log": 0, "backup-wed.log": 2}, dict)
              if r is not True:
                  return r
              with open("logs/backup-thu.log", "w") as fh:
                  fh.write("02:00 START nightly backup\n02:01 ERROR db-01 timeout\n")
              n, o, e = run()
              os.remove("logs/backup-thu.log")
              got = n.get("errors_by_file")
              if not isinstance(got, dict) or got.get("backup-thu.log") != 1:
                  return "When I added logs/backup-thu.log (1 ERROR line), errors_by_file came out as " + H.short(got) + ". Build it from the files."
              return True
        `
      },
      {
        id: "summary",
        text: "Write <code>summary.txt</code>: one line per log as <code>backup-mon.log: 1</code>, in sorted order, then a last line <code>TOTAL: 3</code>.",
        hints: ['Open "summary.txt" with mode "w". Loop over errors_by_file.items() and write f"{name}: {count}\\n". Then write the TOTAL line using sum(errors_by_file.values()).',
          'with open("summary.txt", "w") as f:\n    for name, count in errors_by_file.items():\n        f.write(f"{name}: {count}\\n")\n    f.write(f"TOTAL: {sum(errors_by_file.values())}\\n")'],
        check: py`
          def check(ns, out, run, src):
              import os
              if os.path.exists("summary.txt"):
                  os.remove("summary.txt")
              n, o, e = run()
              if not os.path.exists("summary.txt"):
                  return "summary.txt wasn't created. Open it with mode \"w\" and write to it."
              got = [l.rstrip("\r\n") for l in open("summary.txt").read().splitlines() if l.strip()]
              want = ["backup-mon.log: 1", "backup-tue.log: 0", "backup-wed.log: 2", "TOTAL: 3"]
              if got != want:
                  return "summary.txt should contain:\n  " + "\n  ".join(want) + "\nIt contains:\n  " + ("\n  ".join(got) if got else "(nothing)")
              return True
        `
      }
    ],
    debrief: "<p>Ticket closed. One run of your script now replaces reading every log by hand, and it keeps working when a new log file shows up.</p>" +
      "<p><b>Why this matters for security:</b> log files are the main evidence in incident response, and much of a security engineer's day is scripts that read logs and write short summaries for humans.</p>",
    realworld: "On a real server, logs live in folders like <code>/var/log</code>. You'd run <code>Path(\"/var/log/backup\").glob(\"*.log\")</code> the same way, and schedule the script with cron (Linux track) or a CI job (DevOps track).",
    quiz: [
      { q: "You open an existing file with mode <code>\"w\"</code>. What happens to what was in it?", options: ["It's kept, and new text goes at the end", "It's erased", "Python raises an error", "It's renamed to .bak"], answer: 1,
        why: "\"w\" starts the file from empty. Use \"a\" to add to the end." },
      { q: "Why use <code>with open(...) as f:</code>?", options: ["It's faster", "It closes the file automatically, even if an error happens", "It's the only way to read files", "It makes the file read-only"], answer: 1,
        why: "with guarantees the file is closed when the block ends, however it ends." },
      { q: "What does <code>Path(\"logs/backup-mon.log\").name</code> give?", options: ["\"logs\"", "\"backup-mon\"", "\"backup-mon.log\"", "\".log\""], answer: 2,
        why: ".name is the last part of the path. .stem drops the extension and .suffix is just the extension." }
    ]
  });

  /* ================================================================== PY-112 */
  LABS.push({
    id: "py-112", n: 12, module: 2, ticket: "PY-112", xp: 100,
    title: "SSH access drift",
    topic: "Sets, tuples & comprehensions",
    from: "Dev Patel · Security team",
    story: "<p>The approved list says who <em>should</em> be able to SSH into the bastion host. The server's <code>authorized_keys</code> says who <em>actually</em> can. Over time the two drift apart: people leave, contractors get added \"just for a week\".</p>" +
      "<p>Compare the two lists, find the keys that are too weak, and tell me exactly whom to remove and whom to add.</p>",
    learn:
      "<h3>Sets: unique items, fast comparisons</h3><p>A <code>set</code> holds each value once and has no order. Turning a list into a set removes duplicates.</p>" +
      ex('users = ["alice", "bob", "alice", "chen"]\nprint(set(users))\nprint(len(set(users)))\nprint("bob" in set(users))') +
      "<p>Sets come with the comparisons you'd draw as a Venn diagram:</p>" +
      ex('approved = {"alice", "bob", "chen"}\nactual = {"bob", "chen", "mallory"}\nprint(actual - approved)   # in actual, not approved\nprint(approved - actual)   # approved, but missing\nprint(approved & actual)   # in both\nprint(approved | actual)   # in either') +
      '<div class="callout warn"><b>Empty set gotcha.</b> <code>{}</code> is an empty <em>dict</em>. An empty set is <code>set()</code>. Sets print in any order, so use <code>sorted()</code> when the order matters.</div>' +
      "<h3>Tuples: fixed records</h3><p>A tuple is like a list that can't be changed. Use it for a small record whose parts belong together, like (user, key type, bits). Unpack it into separate names in one line.</p>" +
      ex('key = ("bob", "rsa", 1024)\nuser, kind, bits = key\nprint(user, kind, bits)\nprint(key[2])') +
      "<p>Unpacking works in <code>for</code> loops too: <code>for user, kind, bits in keys:</code>.</p>" +
      "<h3>Comprehensions: build a collection in one line</h3><p>A list comprehension is a short way to write \"loop, maybe filter, collect\":</p>" +
      ex('ports = [22, 80, 443, 8080, 3306]\nhigh = [p for p in ports if p > 1024]\nlabels = [f"port-{p}" for p in ports]\nprint(high)\nprint(labels)') +
      "<p>The same idea makes sets <code>{x for ...}</code> and dicts <code>{key: value for ...}</code>:</p>" +
      ex('hosts = ["web-01", "db-01", "web-02"]\nroles = {h.split("-")[0] for h in hosts}\nlengths = {h: len(h) for h in hosts}\nprint(roles)\nprint(lengths)') +
      "<h3>One-line if: the conditional expression</h3><p><code>a if condition else b</code> picks one of two values. It's handy inside comprehensions.</p>" +
      ex('for p in [22, 8080]:\n    print(p, "privileged" if p < 1024 else "user")'),
    starter: py`
      # PY-112 · SSH access drift
      approved = ["alice", "bob", "chen", "dana", "erin"]
      on_server = ["alice", "bob", "mallory", "dana", "svc-deploy", "bob"]

      # (user, key type, key size in bits)
      keys = [
          ("alice", "ed25519", 256),
          ("bob", "rsa", 1024),
          ("dana", "rsa", 4096),
          ("mallory", "rsa", 2048),
          ("bob", "ed25519", 256),
      ]

      # 1) unauthorized and missing (sets)


      # 2) weak_keys: users with rsa keys under 2048 bits (list comprehension)


      # 3) access_status: {user: "ok" or "REMOVE"} for every user on the server (dict comprehension)


      # 4) Print the two action lines

    `,
    objectives: [
      {
        id: "sets",
        text: "<code>unauthorized</code> is the <b>set</b> of users on the server who aren't approved. <code>missing</code> is the set of approved users who aren't on the server.",
        hints: ["Turn both lists into sets with set(...), then subtract one from the other.",
          "unauthorized = set(on_server) - set(approved)\nmissing = set(approved) - set(on_server)"],
        check: py`
          def check(ns, out, run, src):
              r = H.expect(ns, "unauthorized", {"mallory", "svc-deploy"}, set)
              if r is not True:
                  return r
              r = H.expect(ns, "missing", {"chen", "erin"}, set)
              if r is not True:
                  return r
              return H.alt(src, run, r"on_server\s*=\s*\[[^\]]*\]", 'on_server = ["alice", "eve", "eve"]',
                           {"unauthorized": {"eve"}, "missing": {"bob", "chen", "dana", "erin"}}, "a different on_server list")
        `
      },
      {
        id: "weak",
        text: "<code>weak_keys</code> is a list of the users that have an <code>rsa</code> key smaller than 2048 bits. Build it with a list comprehension that unpacks each tuple.",
        hints: ["[user for user, kind, bits in keys if ...]: the if needs two conditions joined with and.",
          'weak_keys = [user for user, kind, bits in keys if kind == "rsa" and bits < 2048]'],
        check: py`
          def check(ns, out, run, src):
              r = H.expect(ns, "weak_keys", ["bob"], list)
              if r is not True:
                  return r
              return H.alt(src, run, r"keys\s*=\s*\[.*?\n\]", 'keys = [("x", "rsa", 1024), ("y", "ed25519", 256), ("z", "rsa", 512), ("w", "rsa", 2048)]',
                           {"weak_keys": ["x", "z"]}, "a different keys list")
        `
      },
      {
        id: "status",
        text: "<code>access_status</code> is a dict built with a dict comprehension: every user on the server (each once) → <code>\"ok\"</code> if approved, otherwise <code>\"REMOVE\"</code>.",
        hints: ["Loop over set(on_server) so each user appears once. Use \"ok\" if user in approved else \"REMOVE\" as the value.",
          'access_status = {user: ("ok" if user in approved else "REMOVE") for user in set(on_server)}'],
        check: py`
          def check(ns, out, run, src):
              r = H.expect(ns, "access_status", {"alice": "ok", "bob": "ok", "dana": "ok", "mallory": "REMOVE", "svc-deploy": "REMOVE"}, dict)
              if r is not True:
                  return r
              return H.alt(src, run, r"on_server\s*=\s*\[[^\]]*\]", 'on_server = ["alice", "eve", "eve"]',
                           {"access_status": {"alice": "ok", "eve": "REMOVE"}}, "a different on_server list")
        `
      },
      {
        id: "print",
        text: "Print exactly two lines, names sorted alphabetically: <code>Remove: mallory, svc-deploy</code> and <code>Add: chen, erin</code>.",
        hints: ['", ".join(sorted(unauthorized)) turns the set into a sorted, comma-separated string.',
          'print(f"Remove: {\', \'.join(sorted(unauthorized))}")\nprint(f"Add: {\', \'.join(sorted(missing))}")'],
        check: py`
          def check(ns, out, run, src):
              r = H.printed(out, ["Remove: mallory, svc-deploy", "Add: chen, erin"])
              if r is not True:
                  return r
              new = H.sub(src, r"on_server\s*=\s*\[[^\]]*\]", 'on_server = ["alice", "eve", "eve"]')
              if new:
                  n, o, e = run(new)
                  if H.lines(o) != ["Remove: eve", "Add: bob, chen, dana, erin"]:
                      return "Works for this data, but with a different on_server list your output was " + H.short(H.lines(o)) + ". Build the lines from the sets."
              return True
        `
      }
    ],
    debrief: "<p>Ticket closed. Two accounts lose access, two get onboarded, and bob needs a new key: a 1024-bit RSA key is considered breakable today.</p>" +
      "<p><b>Security principle, \"least privilege\":</b> access should match what's approved, and nothing more. Comparing <em>should</em> against <em>is</em> with set differences is how drift detection works in most compliance tools.</p>",
    realworld: "The same pattern compares cloud IAM users against HR's staff list, or firewall rules against the approved rule set. On Linux you'd read the real list from <code>~/.ssh/authorized_keys</code> (Linux track).",
    quiz: [
      { q: "What does <code>{}</code> create?", options: ["An empty set", "An empty dict", "An empty tuple", "An error"], answer: 1,
        why: "{} is an empty dict. Use set() for an empty set." },
      { q: "<code>a - b</code> for two sets gives…", options: ["Items in both", "Items in a but not in b", "Items in either", "The number of different items"], answer: 1,
        why: "Set difference keeps what's in the left set and not in the right one." },
      { q: "Why use a tuple for <code>(\"bob\", \"rsa\", 1024)</code>?", options: ["Tuples are faster to print", "It's a fixed record whose parts belong together and shouldn't change", "Lists can't hold numbers", "Tuples sort automatically"], answer: 1,
        why: "Tuples can't be modified, which suits records like this." }
    ]
  });

  /* ================================================================== PY-113 */
  LABS.push({
    id: "py-113", n: 13, module: 2, ticket: "PY-113", xp: 100,
    title: "Read the auth log",
    topic: "Regular expressions",
    from: "Dev Patel · Security team",
    story: "<p>Overnight the bastion host logged a burst of failed SSH logins. The lines look alike but not identical: some say <code>invalid user</code>, some don't. Splitting on spaces breaks the moment a line changes shape.</p>" +
      "<p>Use regular expressions to pull out the IPs, users and ports. While you're at it, our hostname validator lets through names it shouldn't. Write a proper one.</p>",
    learn:
      "<h3>What a regex is</h3><p>A regular expression is a small pattern language for text. <code>re.search(pattern, text)</code> looks for the pattern anywhere in the text and returns a <em>match</em>, or <code>None</code>.</p>" +
      ex('import re\nline = "Failed password for root from 203.0.113.45 port 52144"\nm = re.search(r"port \\d+", line)\nprint(m)\nprint(m.group())') +
      "<p>Always write patterns as raw strings, <code>r\"...\"</code>, so Python doesn't treat the backslashes as escape codes.</p>" +
      "<h3>The building blocks</h3>" +
      '<table class="t"><tr><th>Pattern</th><th>Matches</th></tr>' +
      "<tr><td><code>\\d</code> / <code>\\w</code> / <code>\\s</code></td><td>a digit / a letter, digit or _ / a space or tab</td></tr>" +
      "<tr><td><code>\\S</code></td><td>anything that isn't whitespace</td></tr>" +
      "<tr><td><code>.</code></td><td>any single character</td></tr>" +
      "<tr><td><code>\\.</code></td><td>a real dot</td></tr>" +
      "<tr><td><code>+</code> / <code>*</code> / <code>?</code></td><td>one or more / zero or more / optional</td></tr>" +
      "<tr><td><code>{2}</code>, <code>{1,3}</code></td><td>exactly 2 / between 1 and 3</td></tr>" +
      "<tr><td><code>[a-z]</code>, <code>(prod|dev)</code></td><td>one character from a set / one of the alternatives</td></tr>" +
      "<tr><td><code>^</code> / <code>$</code></td><td>start / end of the text</td></tr></table>" +
      "<h3>findall: every match</h3>" +
      ex('import re\ntext = "from 10.0.0.5 and 192.168.1.20, port 22"\nprint(re.findall(r"\\d+\\.\\d+\\.\\d+\\.\\d+", text))') +
      "<h3>Groups: pull out the parts</h3><p>Parentheses capture part of the match. <code>m.group(1)</code> is the first group. Name groups with <code>(?P&lt;name&gt;...)</code> to make them readable.</p>" +
      ex('import re\nline = "Accepted publickey for alice from 10.0.4.12 port 50022"\nm = re.search(r"for (\\w+) from (\\S+) port (\\d+)", line)\nprint(m.group(1), m.group(2), m.group(3))\n\nm = re.search(r"for (?P<user>\\w+) from (?P<ip>\\S+)", line)\nprint(m.group("user"), m.group("ip"))') +
      "<p>An optional group, like <code>(invalid user )?</code>, lets one pattern handle lines that sometimes have extra words. Groups always return text, so use <code>int()</code> on numbers.</p>" +
      "<h3>Greedy vs. non-greedy</h3><p><code>.*</code> grabs as much as it can. <code>.*?</code> grabs as little as it can.</p>" +
      ex('import re\ns = "<b>alert</b> and <b>more</b>"\nprint(re.findall(r"<b>.*</b>", s))\nprint(re.findall(r"<b>.*?</b>", s))') +
      "<h3>Validating input: use fullmatch</h3><p><code>re.search</code> is happy if the pattern appears <em>anywhere</em>. For validation, <code>re.fullmatch</code> requires the <b>whole</b> string to match.</p>" +
      ex('import re\npattern = r"web-\\d{2}\\.kestrel\\.io"\nfor name in ["web-01.kestrel.io", "web-01.kestrel.io.evil.com"]:\n    print(name, bool(re.search(pattern, name)), bool(re.fullmatch(pattern, name)))') +
      '<div class="callout warn"><b>Two classic validation bugs.</b> A pattern that isn\'t anchored (<code>search</code> instead of <code>fullmatch</code>) accepts <code>web-01.kestrel.io.evil.com</code>. An unescaped <code>.</code> matches any character, so <code>kestrel.io</code> also accepts <code>kestrelXio</code>. Attackers look for exactly these.</div>' +
      "<p>If you use a pattern many times, <code>re.compile(pattern)</code> builds it once, and you call <code>.search()</code> on the result.</p>",
    starter: py`
      # PY-113 · Read the auth log
      import re

      log = [
          "Mar 12 03:14:07 bastion sshd[2231]: Failed password for root from 203.0.113.45 port 52144 ssh2",
          "Mar 12 03:14:09 bastion sshd[2231]: Failed password for invalid user admin from 203.0.113.45 port 52146 ssh2",
          "Mar 12 03:15:22 bastion sshd[2240]: Accepted publickey for alice from 10.0.4.12 port 50022 ssh2",
          "Mar 12 03:16:40 bastion sshd[2251]: Failed password for bob from 198.51.100.7 port 40112 ssh2",
          "Mar 12 03:17:02 bastion CRON[2260]: pam_unix(cron:session): session opened for user root",
      ]

      # 1) ips: every IP address in the log, in order (duplicates included)


      def parse_failed(line):
          pass


      # 3) failed: the parse_failed result for each failed-login line (skip the others)


      def valid_hostname(name):
          pass

    `,
    objectives: [
      {
        id: "ips",
        text: "<code>ips</code> is a list of every IPv4 address in <code>log</code>, in the order they appear. Use <code>re.findall</code>.",
        hints: ["An IPv4 address is four groups of digits separated by real dots: \\d+\\.\\d+\\.\\d+\\.\\d+. Run findall on each line and add the results to one list.",
          'ips = []\nfor line in log:\n    ips += re.findall(r"\\d+\\.\\d+\\.\\d+\\.\\d+", line)'],
        check: py`
          def check(ns, out, run, src):
              r = H.expect(ns, "ips", ["203.0.113.45", "203.0.113.45", "10.0.4.12", "198.51.100.7"], list)
              if r is not True:
                  return r
              return H.alt(src, run, r"log\s*=\s*\[.*?\n\]",
                           'log = ["x from 192.0.2.1 port 1 and 192.0.2.250", "no address here", "seen 10.1.2.3"]',
                           {"ips": ["192.0.2.1", "192.0.2.250", "10.1.2.3"]}, "a different log")
        `
      },
      {
        id: "parse",
        text: "<code>parse_failed(line)</code> returns a tuple <code>(user, ip, port)</code> with the port as an <code>int</code> for a <code>Failed password</code> line, including the <code>invalid user</code> kind. It returns <code>None</code> for any other line.",
        hints: ["Use re.search with three groups. (invalid user )? makes those words optional. If there's no match, return None.",
          'def parse_failed(line):\n    m = re.search(r"Failed password for (invalid user )?(\\w+) from (\\S+) port (\\d+)", line)\n    if not m:\n        return None\n    return (m.group(2), m.group(3), int(m.group(4)))'],
        check: py`
          def check(ns, out, run, src):
              L = ns.get("log") or []
              cases = [
                  (("Mar 12 03:14:07 bastion sshd[2231]: Failed password for root from 203.0.113.45 port 52144 ssh2",), ("root", "203.0.113.45", 52144)),
                  (("Mar 12 03:14:09 bastion sshd[2231]: Failed password for invalid user admin from 203.0.113.45 port 52146 ssh2",), ("admin", "203.0.113.45", 52146)),
                  (("Jan 01 00:00:01 web-02 sshd[9]: Failed password for deploy from 192.0.2.9 port 2222 ssh2",), ("deploy", "192.0.2.9", 2222)),
                  (("Mar 12 03:15:22 bastion sshd[2240]: Accepted publickey for alice from 10.0.4.12 port 50022 ssh2",), None),
                  (("Mar 12 03:17:02 bastion CRON[2260]: pam_unix(cron:session): session opened for user root",), None),
              ]
              return H.func(ns, "parse_failed", cases)
        `
      },
      {
        id: "failed",
        text: "<code>failed</code> is a list of the tuples from <code>parse_failed</code>, one for each failed-login line in <code>log</code>.",
        hints: ["Loop over log, call parse_failed(line), and append the result only when it isn't None.",
          "failed = []\nfor line in log:\n    result = parse_failed(line)\n    if result is not None:\n        failed.append(result)"],
        check: py`
          def check(ns, out, run, src):
              want = [("root", "203.0.113.45", 52144), ("admin", "203.0.113.45", 52146), ("bob", "198.51.100.7", 40112)]
              r = H.expect(ns, "failed", want, list)
              if r is not True:
                  return r
              return H.alt(src, run, r"log\s*=\s*\[.*?\n\]",
                           'log = ["sshd[1]: Failed password for eve from 192.0.2.7 port 4000 ssh2", "sshd[2]: Accepted password for eve from 192.0.2.7 port 4001 ssh2"]',
                           {"failed": [("eve", "192.0.2.7", 4000)]}, "a different log")
        `
      },
      {
        id: "host",
        text: "<code>valid_hostname(name)</code> returns <code>True</code> only for names like <code>web-01.prod.kestrel.io</code>: a lowercase role, a dash, exactly two digits, then <code>.prod</code> or <code>.dev</code>, then <code>.kestrel.io</code>. Nothing before or after.",
        hints: ["Use re.fullmatch so the whole name must match. Escape every real dot as \\. and use (prod|dev) for the environment. Wrap the result in bool().",
          'def valid_hostname(name):\n    return bool(re.fullmatch(r"[a-z]+-\\d{2}\\.(prod|dev)\\.kestrel\\.io", name))'],
        check: py`
          def check(ns, out, run, src):
              f = H.fn(ns, "valid_hostname")
              if not f:
                  return "I can't find a function called valid_hostname."
              cases = [("web-01.prod.kestrel.io", True, ""), ("db-12.dev.kestrel.io", True, ""),
                       ("cache-07.prod.kestrel.io", True, ""),
                       ("web-01.prod.kestrel.io.evil.com", False, "Extra text after the name got through. Use re.fullmatch (or anchor with ^ and $)."),
                       ("evil.com.web-01.prod.kestrel.io", False, "Extra text before the name got through. Use re.fullmatch."),
                       ("web-01.prodXkestrel.io", False, "An unescaped . matches any character. Write real dots as \\."),
                       ("web-01.prod.kestrelXio", False, "An unescaped . matches any character. Write real dots as \\."),
                       ("WEB-01.prod.kestrel.io", False, "The role must be lowercase letters."),
                       ("web-1.prod.kestrel.io", False, "There must be exactly two digits."),
                       ("web-001.prod.kestrel.io", False, "There must be exactly two digits, not three."),
                       ("web-01.qa.kestrel.io", False, "Only prod and dev are valid environments.")]
              for name, want, why in cases:
                  ok, got = H.call(f, name)
                  if not ok:
                      return "valid_hostname(" + repr(name) + ") crashed: " + type(got).__name__ + ": " + str(got)
                  if type(got) is not bool:
                      return "valid_hostname(" + repr(name) + ") returned " + H.short(got) + ". Return True or False: wrap the match in bool()."
                  if got != want:
                      return "valid_hostname(" + repr(name) + ") returned " + str(got) + ", expected " + str(want) + ". " + why
              return True
        `
      }
    ],
    debrief: "<p>Ticket closed. Two IPs are hammering the bastion, one of them guessing <code>root</code> and <code>admin</code>. That's a classic password-spraying pattern. Module 3 builds a detector for it.</p>" +
      "<p><b>Security principle, \"validate with an allowlist, completely\":</b> describe exactly what good input looks like and reject everything else. Unanchored patterns and unescaped dots are real bugs that have let attackers bypass URL and hostname checks.</p>",
    realworld: "Tools such as fail2ban, Splunk field extractions and Semgrep rules are built on regular expressions like these. <a href=\"https://regex101.com\" target=\"_blank\" rel=\"noopener\">regex101.com</a> is a great place to test a pattern step by step (choose the Python flavor).",
    quiz: [
      { q: "Why write patterns as <code>r\"...\"</code>?", options: ["It makes them faster", "So Python doesn't treat the backslashes as escape codes", "It's required by re.search", "It makes the match case-insensitive"], answer: 1,
        why: "In a raw string, \\d stays a backslash and a d, which is what the regex engine needs." },
      { q: "In a regex, an unescaped <code>.</code> matches…", options: ["Only a dot", "Any single character", "The end of the line", "Nothing"], answer: 1,
        why: "Use \\. when you mean a literal dot." },
      { q: "<code>re.search(r\"kestrel\\.io\", \"kestrel.io.evil.com\")</code> returns…", options: ["None", "A match", "An error", "False"], answer: 1,
        why: "search finds the pattern anywhere. For validation, use fullmatch." }
    ]
  });

  /* ================================================================== PY-114 */
  var SCAN = {
    scanner: "kestrel-scan 2.3",
    target: "payments-api:1.4.2",
    findings: [
      { id: "KSV-0932", package: "openssl", severity: "MEDIUM", cvss: 5.3, fixed_in: null },
      { id: "KSV-2041", package: "xz-utils", severity: "CRITICAL", cvss: 9.8, fixed_in: "5.6.2" },
      { id: "KSV-0518", package: "glibc", severity: "LOW", cvss: 3.1, fixed_in: null },
      { id: "KSV-1187", package: "nghttp2", severity: "HIGH", cvss: 7.5, fixed_in: "1.57.0" },
      { id: "KSV-1410", package: "openssl", severity: "MEDIUM", cvss: 5.5, fixed_in: "3.0.13" }
    ]
  };

  LABS.push({
    id: "py-114", n: 14, module: 2, ticket: "PY-114", xp: 100,
    title: "Scanner export",
    topic: "JSON & CSV",
    from: "Dev Patel · Security team",
    story: "<p>Our container scanner checked the <code>payments-api</code> image and saved its results as <code>scan.json</code>. The compliance team wants a spreadsheet, and the security dashboard wants a small JSON summary.</p>" +
      "<p>Read the JSON, pick out what's urgent, and write both files. This is the bread and butter of security automation: one tool's output becomes another tool's input.</p>",
    learn:
      "<h3>JSON: data as text</h3><p>JSON is how most tools and APIs exchange data. It looks almost like Python dicts and lists, with a few differences:</p>" +
      '<table class="t"><tr><th>JSON</th><th>Python</th></tr>' +
      "<tr><td><code>{\"a\": 1}</code> object</td><td><code>dict</code></td></tr>" +
      "<tr><td><code>[1, 2]</code> array</td><td><code>list</code></td></tr>" +
      "<tr><td><code>true</code> / <code>false</code></td><td><code>True</code> / <code>False</code></td></tr>" +
      "<tr><td><code>null</code></td><td><code>None</code></td></tr></table>" +
      "<p>The <code>json</code> module converts both ways. Functions ending in <b>s</b> work with <b>s</b>trings; the others work with files.</p>" +
      '<table class="t"><tr><th>Function</th><th>Does</th></tr>' +
      "<tr><td><code>json.load(f)</code> / <code>json.loads(text)</code></td><td>file / string → Python data</td></tr>" +
      "<tr><td><code>json.dump(data, f)</code> / <code>json.dumps(data)</code></td><td>Python data → file / string</td></tr></table>" +
      ex('import json\n\nwith open("scan.json") as f:\n    data = json.load(f)\nprint(data["target"])\nprint(data["findings"][0])\nprint(data["findings"][0]["fixed_in"])') +
      ex('import json\nreport = {"host": "web-01", "ok": True, "issues": None}\nprint(json.dumps(report))\nprint(json.dumps(report, indent=2))') +
      "<p><code>indent=2</code> makes the output readable for humans. Without it you get a single compact line, which is what machines prefer.</p>" +
      "<h3>CSV: tables as text</h3><p>CSV files are spreadsheets as plain text: one row per line, commas between values. Don't split on commas yourself, because values can contain commas inside quotes. Use the <code>csv</code> module.</p>" +
      "<p><code>csv.DictWriter</code> writes dicts as rows. You give it the column names (<code>fieldnames</code>), call <code>writeheader()</code> once, then <code>writerow(dict)</code> for each row.</p>" +
      ex('import csv\nrows = [{"host": "web-01", "port": 443}, {"host": "db-01", "port": 5432}]\nwith open("hosts.csv", "w", newline="") as f:\n    writer = csv.DictWriter(f, fieldnames=["host", "port"])\n    writer.writeheader()\n    for row in rows:\n        writer.writerow(row)\nprint(open("hosts.csv").read())') +
      "<p><code>csv.DictReader</code> reads it back: each row becomes a dict keyed by the header.</p>" +
      ex('import csv\nwith open("hosts.csv", newline="") as f:\n    for row in csv.DictReader(f):\n        print(row["host"], row["port"], type(row["port"]))') +
      '<div class="callout warn"><b>Two CSV gotchas.</b> Everything you read back is a <b>string</b>, even numbers, so convert with <code>int()</code> or <code>float()</code>. And always open CSV files with <code>newline=""</code>, otherwise Windows ends up with blank lines between rows.</div>',
    starter: py`
      # PY-114 · Scanner export
      import csv
      import json

      # 1) Load scan.json into data, then set target and findings


      # 2) urgent: ids with cvss 7.0 or higher
      #    no_fix: ids where fixed_in is None (null in the JSON)


      # 3) Write findings.csv: columns id, package, severity, cvss, fixed_in
      #    highest cvss first, and "none" when there's no fix


      # 4) Write summary.json: {"target": ..., "total": ..., "by_severity": {...}}

    `,
    files: { "scan.json": JSON.stringify(SCAN, null, 2) + "\n" },
    removeFiles: ["findings.csv", "summary.json"],
    objectives: [
      {
        id: "load",
        text: "Load <code>scan.json</code> with <code>json.load</code> into <code>data</code>. Set <code>target</code> to the scanned image name and <code>findings</code> to the list of findings.",
        hints: ['with open("scan.json") as f: data = json.load(f). Then target is data["target"].',
          'with open("scan.json") as f:\n    data = json.load(f)\ntarget = data["target"]\nfindings = data["findings"]'],
        check: py`
          def check(ns, out, run, src):
              r = H.expect(ns, "target", "payments-api:1.4.2", str)
              if r is not True:
                  return r
              f = ns.get("findings")
              if not isinstance(f, list) or len(f) != 5:
                  return "findings should be the list of 5 findings from the file. It's " + H.short(f)
              if '"payments-api' in src or "'payments-api" in src:
                  return "Read target from the file instead of typing it in."
              return True
        `
      },
      {
        id: "filter",
        text: "<code>urgent</code> lists the ids with a <code>cvss</code> of 7.0 or more. <code>no_fix</code> lists the ids whose <code>fixed_in</code> is <code>None</code>. Keep the file's order.",
        hints: ['Loop over findings (or use list comprehensions). JSON null arrives as None, so test with f["fixed_in"] is None.',
          'urgent = [f["id"] for f in findings if f["cvss"] >= 7.0]\nno_fix = [f["id"] for f in findings if f["fixed_in"] is None]'],
        check: py`
          def check(ns, out, run, src):
              r = H.expect(ns, "urgent", ["KSV-2041", "KSV-1187"], list)
              if r is not True:
                  return r
              r = H.expect(ns, "no_fix", ["KSV-0932", "KSV-0518"], list)
              if r is not True:
                  return r
              orig = open("scan.json").read()
              alt = {"scanner": "x", "target": "other:1.0", "findings": [
                  {"id": "A-1", "package": "p", "severity": "HIGH", "cvss": 7.0, "fixed_in": None},
                  {"id": "A-2", "package": "q", "severity": "LOW", "cvss": 2.0, "fixed_in": "1.1"}]}
              open("scan.json", "w").write(json.dumps(alt))
              try:
                  n, o, e = run()
              finally:
                  open("scan.json", "w").write(orig)
              if n.get("urgent") != ["A-1"] or n.get("no_fix") != ["A-1"]:
                  return "With a different scan.json, urgent was " + H.short(n.get("urgent")) + " and no_fix was " + H.short(n.get("no_fix")) + " (expected ['A-1'] for both). Build them from the data."
              return True
        `
      },
      {
        id: "csv",
        text: "Write <code>findings.csv</code> with <code>csv.DictWriter</code>: a header row <code>id,package,severity,cvss,fixed_in</code>, then one row per finding, highest <code>cvss</code> first. Write <code>none</code> where there's no fix.",
        hints: ['Sort with sorted(findings, key=lambda f: f["cvss"], reverse=True). For each finding, copy it with dict(f) and replace a None fixed_in with "none" before writerow.',
          'with open("findings.csv", "w", newline="") as f:\n    writer = csv.DictWriter(f, fieldnames=["id", "package", "severity", "cvss", "fixed_in"])\n    writer.writeheader()\n    for finding in sorted(findings, key=lambda x: x["cvss"], reverse=True):\n        row = dict(finding)\n        if row["fixed_in"] is None:\n            row["fixed_in"] = "none"\n        writer.writerow(row)'],
        check: py`
          def check(ns, out, run, src):
              import os
              if os.path.exists("findings.csv"):
                  os.remove("findings.csv")
              n, o, e = run()
              if not os.path.exists("findings.csv"):
                  return "findings.csv wasn't created."
              got = [l for l in open("findings.csv", newline="").read().splitlines() if l.strip()]
              want = ["id,package,severity,cvss,fixed_in",
                      "KSV-2041,xz-utils,CRITICAL,9.8,5.6.2",
                      "KSV-1187,nghttp2,HIGH,7.5,1.57.0",
                      "KSV-1410,openssl,MEDIUM,5.5,3.0.13",
                      "KSV-0932,openssl,MEDIUM,5.3,none",
                      "KSV-0518,glibc,LOW,3.1,none"]
              if got != want:
                  return "findings.csv should be:\n  " + "\n  ".join(want) + "\nIt is:\n  " + ("\n  ".join(got[:8]) if got else "(empty)")
              return True
        `
      },
      {
        id: "summary",
        text: "Write <code>summary.json</code> with <code>json.dump(..., indent=2)</code>: <code>target</code>, <code>total</code> (number of findings) and <code>by_severity</code> (severity → how many).",
        hints: ["Count severities with a dict: counts[s] = counts.get(s, 0) + 1. Build the summary dict, then json.dump(summary, f, indent=2) into a file opened with \"w\".",
          'by_severity = {}\nfor finding in findings:\n    s = finding["severity"]\n    by_severity[s] = by_severity.get(s, 0) + 1\nsummary = {"target": target, "total": len(findings), "by_severity": by_severity}\nwith open("summary.json", "w") as f:\n    json.dump(summary, f, indent=2)'],
        check: py`
          def check(ns, out, run, src):
              import os
              if os.path.exists("summary.json"):
                  os.remove("summary.json")
              n, o, e = run()
              if not os.path.exists("summary.json"):
                  return "summary.json wasn't created."
              text = open("summary.json").read()
              try:
                  got = json.loads(text)
              except ValueError as ex:
                  return "summary.json isn't valid JSON (" + str(ex) + "). Write it with json.dump."
              want = {"target": "payments-api:1.4.2", "total": 5, "by_severity": {"CRITICAL": 1, "HIGH": 1, "MEDIUM": 2, "LOW": 1}}
              if got != want:
                  return "summary.json should hold " + json.dumps(want) + ", but it holds " + H.short(got, 200)
              if "\n" not in text.strip():
                  return "The data is right, but the file is one long line. Pass indent=2 to json.dump so people can read it."
              return True
        `
      }
    ],
    debrief: "<p>Ticket closed. Compliance has its spreadsheet, the dashboard has its summary, and the xz-utils finding is at the top of both.</p>" +
      "<p><b>Why this matters:</b> security tools like Trivy, Semgrep, Bandit and ZAP can all output JSON. A DevSecOps engineer spends a lot of time turning that JSON into tickets, reports and pass/fail decisions in CI.</p>",
    realworld: "Run a real scanner with JSON output, e.g. <code>trivy image --format json -o scan.json python:3.12</code>. Its structure is bigger, but you read it exactly the same way.",
    quiz: [
      { q: "JSON <code>null</code> becomes what in Python?", options: ["0", "\"\"", "None", "False"], answer: 2,
        why: "null ↔ None, true ↔ True, false ↔ False." },
      { q: "What's the difference between <code>json.load</code> and <code>json.loads</code>?", options: ["None", "load reads a file; loads reads a string", "loads is faster", "load is for lists, loads for dicts"], answer: 1,
        why: "The s stands for string." },
      { q: "You read a CSV with DictReader. The value in the <code>port</code> column is…", options: ["an int", "a str", "a float", "whatever it was when written"], answer: 1,
        why: "CSV is plain text, so every value comes back as a string. Convert it yourself." }
    ]
  });

  /* ================================================================== PY-115 */
  var DEPLOY_YAML = lines(
    "# payments-api deployment config",
    "service: payments-api",
    "environment: production",
    "debug: true",
    "server:",
    "  host: 0.0.0.0",
    "  port: 8443",
    "  tls:",
    "    enabled: false",
    "    min_version: \"1.0\"",
    "database:",
    "  url: postgres://payments:S3cr3tPass@db-01.prod.kestrel.io:5432/payments",
    "  pool_size: 10",
    "logging:",
    "  level: DEBUG"
  );

  LABS.push({
    id: "py-115", n: 15, module: 2, ticket: "PY-115", xp: 100,
    title: "Pre-release config review",
    topic: "YAML configs",
    from: "Dev Patel · Security team",
    story: "<p><code>payments-api</code> ships tomorrow. Before any release, Security reviews its deployment config, <code>deploy.yaml</code>. Reading YAML by eye is how mistakes slip through, so let's write a reviewer we can reuse for every service.</p>" +
      "<p>Load the config <em>safely</em>, check that the required keys are there, and flag the settings that must never reach production.</p>",
    learn:
      '<div class="callout"><b>A package download.</b> YAML isn\'t in Python\'s standard library, so this lab uses <b>PyYAML</b>. The first time your code runs <code>import yaml</code>, the lab downloads it (about 200 KB, once per visit).</div>' +
      "<h3>YAML in one minute</h3><p>YAML is the config format of DevOps: GitHub Actions, Kubernetes, docker-compose and Ansible all use it. It's <code>key: value</code> pairs, nested by <b>indentation</b>, with <code>-</code> for list items.</p>" +
      '<pre class="code">service: payments-api      # a string\nreplicas: 3                # an int\ndebug: false               # a bool\nserver:                    # a nested dict\n  port: 8443\nallowed_ips:               # a list\n  - 10.0.0.0/8\n  - 192.168.1.0/24</pre>' +
      "<h3>Loading YAML</h3>" +
      ex('import yaml\n\nwith open("deploy.yaml") as f:\n    config = yaml.safe_load(f)\n\nprint(type(config))\nprint(config["service"])\nprint(config["server"]["port"], type(config["server"]["port"]))\nprint(config["debug"], type(config["debug"]))') +
      "<p>YAML guesses the types for you: <code>8443</code> becomes an int and <code>true</code> becomes a bool. Usually that's handy, but not always:</p>" +
      ex('import yaml\nprint(yaml.safe_load("version: 1.10"))\nprint(yaml.safe_load(\'version: "1.10"\'))\nprint(yaml.safe_load("country: NO"))') +
      "<p><code>1.10</code> becomes the float <code>1.1</code>, and <code>NO</code> (Norway) becomes <code>False</code>! Put quotes around values that must stay strings.</p>" +
      '<div class="callout warn"><b>Always use <code>yaml.safe_load</code>.</b> Plain <code>yaml.load</code> with its full loader can build <em>any</em> Python object a file describes, so a malicious YAML file could make your program run commands. <code>safe_load</code> only builds plain data: dicts, lists, strings, numbers. Watch it refuse a dangerous file:</div>' +
      ex('import yaml\nevil = "!!python/object/apply:os.system [\\"echo hacked\\"]"\ntry:\n    yaml.safe_load(evil)\nexcept yaml.YAMLError as e:\n    print("Refused:", type(e).__name__)') +
      "<h3>Missing keys: <code>.get()</code> with a default</h3><p>Configs often leave sections out. <code>cfg[\"logging\"]</code> crashes with a <code>KeyError</code> if there's no logging section. <code>.get(key, default)</code> returns the default instead, and chaining <code>.get(..., {})</code> walks nested sections safely.</p>" +
      ex('cfg = {"server": {"port": 80}}\nprint(cfg.get("logging", {}).get("level", "INFO"))\nprint(cfg.get("server", {}).get("tls", {}).get("enabled"))') +
      "<h3>Writing YAML</h3>" +
      ex('import yaml\nprint(yaml.safe_dump({"service": "api", "replicas": 2, "debug": False}, sort_keys=False))'),
    starter: py`
      # PY-115 · Pre-release config review
      import re
      import yaml

      REQUIRED = ["service", "environment", "replicas", "server", "database"]

      # 1) Load deploy.yaml into config (safely!), then set port and tls_on


      def missing_keys(cfg, required):
          pass


      def find_issues(cfg):
          pass


      # 4) Print the review

    `,
    files: { "deploy.yaml": DEPLOY_YAML },
    objectives: [
      {
        id: "load",
        text: "Load <code>deploy.yaml</code> with <code>yaml.safe_load</code> into <code>config</code>. Set <code>port</code> to the server port and <code>tls_on</code> to whether TLS is enabled.",
        hints: ['with open("deploy.yaml") as f: config = yaml.safe_load(f). The port is two levels down: config["server"]["port"].',
          'with open("deploy.yaml") as f:\n    config = yaml.safe_load(f)\nport = config["server"]["port"]\ntls_on = config["server"]["tls"]["enabled"]'],
        check: py`
          def check(ns, out, run, src):
              if re.search(r"yaml\.(load|unsafe_load|full_load)\s*\(", src):
                  return "Use yaml.safe_load. The other loaders can build arbitrary Python objects from a malicious file."
              if not isinstance(ns.get("config"), dict):
                  return "config should be the dict loaded from deploy.yaml. It's " + H.short(ns.get("config"))
              r = H.expect(ns, "port", 8443, int)
              if r is not True:
                  return r
              r = H.expect(ns, "tls_on", False, bool)
              if r is not True:
                  return r
              orig = open("deploy.yaml").read()
              open("deploy.yaml", "w").write(orig.replace("port: 8443", "port: 9443").replace("enabled: false", "enabled: true"))
              try:
                  n, o, e = run()
              finally:
                  open("deploy.yaml", "w").write(orig)
              if n.get("port") != 9443 or n.get("tls_on") is not True:
                  return "When I changed deploy.yaml, port and tls_on didn't follow. Read them from config."
              return True
        `
      },
      {
        id: "missing",
        text: "<code>missing_keys(cfg, required)</code> returns a list of the keys from <code>required</code> that aren't in <code>cfg</code>, in the order of <code>required</code>.",
        hints: ["A list comprehension: keep each key from required that is not in cfg.",
          "def missing_keys(cfg, required):\n    return [key for key in required if key not in cfg]"],
        check: py`
          def check(ns, out, run, src):
              return H.func(ns, "missing_keys", [
                  (({"service": "x", "server": {}}, ["service", "replicas", "server", "database"]), ["replicas", "database"]),
                  (({"a": 1, "b": 2}, ["a", "b"]), []),
                  (({}, ["z", "a"]), ["z", "a"]),
              ])
        `
      },
      {
        id: "issues",
        text: "<code>find_issues(cfg)</code> returns a list of issue strings, in this order:<br>" +
          "1. <code>\"debug enabled\"</code> if <code>debug</code> is <code>True</code><br>" +
          "2. <code>\"TLS disabled\"</code> if <code>server.tls.enabled</code> isn't <code>True</code> (a missing section counts as disabled)<br>" +
          "3. <code>\"password in database URL\"</code> if the database url has a password: a <code>:</code> between the <code>//</code> and the <code>@</code><br>" +
          "4. <code>\"verbose logging in production\"</code> if <code>environment</code> is <code>\"production\"</code> and <code>logging.level</code> is <code>\"DEBUG\"</code><br>" +
          "It must not crash when a section is missing.",
        hints: ['Use chained .get calls so missing sections don\'t crash: cfg.get("server", {}).get("tls", {}).get("enabled"). For the URL, re.search(r"//[^/@:]+:[^/@]+@", url) finds user:password@.',
          'def find_issues(cfg):\n    issues = []\n    if cfg.get("debug") is True:\n        issues.append("debug enabled")\n    if cfg.get("server", {}).get("tls", {}).get("enabled") is not True:\n        issues.append("TLS disabled")\n    url = cfg.get("database", {}).get("url", "")\n    if re.search(r"//[^/@:]+:[^/@]+@", url):\n        issues.append("password in database URL")\n    if cfg.get("environment") == "production" and cfg.get("logging", {}).get("level") == "DEBUG":\n        issues.append("verbose logging in production")\n    return issues'],
        check: py`
          def check(ns, out, run, src):
              f = H.fn(ns, "find_issues")
              if not f:
                  return "I can't find a function called find_issues."
              full = {"service": "payments-api", "environment": "production", "debug": True,
                      "server": {"host": "0.0.0.0", "port": 8443, "tls": {"enabled": False, "min_version": "1.0"}},
                      "database": {"url": "postgres://payments:S3cr3tPass@db-01.prod.kestrel.io:5432/payments"},
                      "logging": {"level": "DEBUG"}}
              clean = {"environment": "production", "debug": False, "server": {"tls": {"enabled": True}},
                       "database": {"url": "postgres://app@db-01:5432/app"}, "logging": {"level": "INFO"}}
              cases = [
                  ("the deploy.yaml config", full, ["debug enabled", "TLS disabled", "password in database URL", "verbose logging in production"]),
                  ("a clean config (its URL has a user but no password)", clean, []),
                  ("a config with only environment: dev (no server, database or logging sections)", {"environment": "dev"}, ["TLS disabled"]),
                  ("a dev config with DEBUG logging", {"environment": "dev", "server": {"tls": {"enabled": True}}, "logging": {"level": "DEBUG"}}, []),
                  ("a production config with no logging or database section", {"environment": "production", "server": {"tls": {"enabled": True}}}, []),
                  ("a config with a password in the URL and no port", {"server": {"tls": {"enabled": True}}, "database": {"url": "mysql://root:toor@db/app"}}, ["password in database URL"]),
              ]
              for label, cfg, want in cases:
                  ok, got = H.call(f, cfg)
                  if not ok:
                      return "find_issues() crashed for " + label + ": " + type(got).__name__ + ": " + str(got) + ". Use .get() for sections that may be missing."
                  if got != want:
                      return "For " + label + ", find_issues returned " + H.short(got, 160) + ", expected " + H.short(want, 160) + "."
              return True
        `
      },
      {
        id: "print",
        text: "Print the review: <code>Review of payments-api</code>, then <code>Missing keys: replicas</code> (or <code>Missing keys: none</code>), then one <code>- issue</code> line per issue.",
        hints: ['", ".join(missing) or "none" gives "none" when the list is empty, because an empty string counts as False.',
          'missing = missing_keys(config, REQUIRED)\nprint(f"Review of {config[\'service\']}")\nprint(f"Missing keys: {\', \'.join(missing) or \'none\'}")\nfor issue in find_issues(config):\n    print(f"- {issue}")'],
        check: py`
          def check(ns, out, run, src):
              r = H.printed(out, ["Review of payments-api", "Missing keys: replicas", "- debug enabled", "- TLS disabled",
                                  "- password in database URL", "- verbose logging in production"])
              if r is not True:
                  return r
              orig = open("deploy.yaml").read()
              alt = orig.replace("service: payments-api", "service: ledger\nreplicas: 2").replace("debug: true", "debug: false").replace("level: DEBUG", "level: INFO")
              open("deploy.yaml", "w").write(alt)
              try:
                  n, o, e = run()
              finally:
                  open("deploy.yaml", "w").write(orig)
              want = ["Review of ledger", "Missing keys: none", "- TLS disabled", "- password in database URL"]
              if H.lines(o) != want:
                  return "With a different deploy.yaml the review should be:\n  " + "\n  ".join(want) + "\nYours was:\n  " + "\n  ".join(H.lines(o)[:8])
              return True
        `
      }
    ],
    debrief: "<p>Ticket closed, and the release is blocked until those four issues are fixed. The database password especially: it should come from a secrets manager, never from a file in Git.</p>" +
      "<p><b>Security principle, \"secure defaults and safe parsing\":</b> never let config turn into code (that's why <code>safe_load</code> exists), and treat debug mode, plain-text passwords and disabled TLS as release blockers. Module 4 shows what <code>yaml.load</code> can do in an attacker's hands.</p>",
    realworld: "Policy-as-code tools such as Checkov, kube-linter and Conftest do exactly this at scale: load YAML, apply rules, fail the pipeline on violations. You just wrote a tiny one.",
    quiz: [
      { q: "Why <code>yaml.safe_load</code> instead of <code>yaml.load</code>?", options: ["It's faster", "It only builds plain data, so a malicious file can't make Python run code", "It keeps comments", "It validates the schema"], answer: 1,
        why: "Loaders that can build arbitrary objects turn untrusted YAML into code execution." },
      { q: "<code>yaml.safe_load(\"enabled: no\")</code> gives…", options: ["{'enabled': 'no'}", "{'enabled': False}", "{'enabled': None}", "an error"], answer: 1,
        why: "YAML 1.1 reads yes/no/on/off as booleans. Quote the value to keep it a string." },
      { q: "<code>cfg.get(\"logging\", {}).get(\"level\")</code> on a config with no logging section returns…", options: ["KeyError", "None", "{}", "\"INFO\""], answer: 1,
        why: "The first .get returns {}, and .get on an empty dict without a default returns None." }
    ]
  });

  /* ================================================================== PY-116 */
  LABS.push({
    id: "py-116", n: 16, module: 2, ticket: "PY-116", xp: 100,
    title: "Key rotation audit",
    topic: "datetime, Counter & defaultdict",
    from: "Maya Chen · SRE lead",
    story: "<p>Policy says cloud access keys must be rotated every 90 days. Nobody has checked in a while, and the auditors will.</p>" +
      "<p>Work out each key's age, list the overdue ones with the date they should have been rotated, group them by owning team, and tell me which team holds the most keys.</p>",
    learn:
      "<h3>Dates with <code>datetime</code></h3><p>The <code>datetime</code> module has a <code>date</code> type that understands calendars: month lengths, leap years, all of it. Never do date maths on strings.</p>" +
      ex('from datetime import date\n\nd = date.fromisoformat("2026-03-02")\nprint(d, d.year, d.month, d.day)\nprint(type(d))') +
      "<p>Subtracting two dates gives a <code>timedelta</code>, a length of time. Its <code>.days</code> is a plain int.</p>" +
      ex('from datetime import date\ntoday = date(2026, 11, 10)\ncreated = date.fromisoformat("2026-08-12")\nage = today - created\nprint(age, age.days)') +
      "<p>Adding a <code>timedelta</code> to a date moves it forward:</p>" +
      ex('from datetime import date, timedelta\nprint(date(2026, 3, 2) + timedelta(days=90))') +
      "<p>For timestamps with a time of day, use <code>datetime</code>. <code>strptime</code> parses any format you describe.</p>" +
      ex('from datetime import datetime\nt = datetime.strptime("12/Mar/2026 03:14:07", "%d/%b/%Y %H:%M:%S")\nprint(t, t.hour)') +
      '<div class="callout"><b>Why the lab fixes TODAY.</b> Real code uses <code>date.today()</code>. This lab sets <code>TODAY = date(2026, 11, 10)</code> so the answers stay the same whenever you do it.</div>' +
      "<h3>Counter: counting made easy</h3><p><code>Counter</code> counts things in one line. <code>.most_common(n)</code> gives the top n as (item, count) tuples.</p>" +
      ex('from collections import Counter\nips = ["10.0.0.5", "10.0.0.9", "10.0.0.5", "10.0.0.5", "10.0.0.9", "10.0.0.7"]\ncounts = Counter(ips)\nprint(counts)\nprint(counts["10.0.0.5"])\nprint(counts.most_common(1))') +
      "<h3>defaultdict: grouping made easy</h3><p>Grouping into a dict of lists normally needs an <em>is this key there yet?</em> check. <code>defaultdict(list)</code> creates the empty list for you the first time a key is used.</p>" +
      ex('from collections import defaultdict\nservers = [("web-01", "web"), ("db-01", "data"), ("web-02", "web")]\nby_team = defaultdict(list)\nfor name, team in servers:\n    by_team[team].append(name)\nprint(dict(by_team))'),
    starter: py`
      # PY-116 · Key rotation audit
      from collections import Counter, defaultdict
      from datetime import date, timedelta

      TODAY = date(2026, 11, 10)   # fixed so the answers don't change; real code uses date.today()
      MAX_AGE = 90                 # days

      keys = [
          {"id": "AKIA-7F3K", "owner": "payments", "created": "2026-08-20"},
          {"id": "AKIA-2M9Q", "owner": "platform", "created": "2026-03-02"},
          {"id": "AKIA-9X1B", "owner": "payments", "created": "2025-12-15"},
          {"id": "AKIA-4H8D", "owner": "data",     "created": "2026-10-30"},
          {"id": "AKIA-1C5T", "owner": "platform", "created": "2026-07-01"},
          {"id": "AKIA-8P2W", "owner": "payments", "created": "2026-08-12"},
      ]


      def age_days(created):
          pass


      # 2) expired: ids of the keys older than MAX_AGE days, in list order


      # 3) by_owner: owner -> list of their expired key ids (use defaultdict)


      # 4) Print one line per expired key, then the owner with the most keys (use Counter)

    `,
    objectives: [
      {
        id: "age",
        text: "<code>age_days(created)</code> takes a date string like <code>\"2026-08-12\"</code> and returns how many days old it is on <code>TODAY</code>, as an int.",
        hints: ["date.fromisoformat(created) turns the string into a date. Subtract it from TODAY and take .days.",
          "def age_days(created):\n    return (TODAY - date.fromisoformat(created)).days"],
        check: py`
          def check(ns, out, run, src):
              return H.func(ns, "age_days", [(("2026-11-10",), 0), (("2026-08-12",), 90), (("2025-11-10",), 365), (("2026-11-01",), 9), (("2024-02-29",), 985)])
        `
      },
      {
        id: "expired",
        text: "<code>expired</code> is a list of the ids of keys older than <code>MAX_AGE</code> days (exactly 90 days old is still OK).",
        hints: ["Use age_days(k[\"created\"]) > MAX_AGE inside a list comprehension.",
          'expired = [k["id"] for k in keys if age_days(k["created"]) > MAX_AGE]'],
        check: py`
          def check(ns, out, run, src):
              return H.vars(ns, src, run, {"expired": ["AKIA-2M9Q", "AKIA-9X1B", "AKIA-1C5T"]},
                            [(r"MAX_AGE\s*=\s*90", "MAX_AGE = 30", {"expired": ["AKIA-7F3K", "AKIA-2M9Q", "AKIA-9X1B", "AKIA-1C5T", "AKIA-8P2W"]}, "MAX_AGE = 30")])
        `
      },
      {
        id: "group",
        text: "<code>by_owner</code> is a <code>defaultdict(list)</code> mapping each owner to the list of their <b>expired</b> key ids.",
        hints: ["Create by_owner = defaultdict(list), loop over keys, and for each expired one do by_owner[k[\"owner\"]].append(k[\"id\"]).",
          'by_owner = defaultdict(list)\nfor k in keys:\n    if k["id"] in expired:\n        by_owner[k["owner"]].append(k["id"])'],
        check: py`
          def check(ns, out, run, src):
              got = ns.get("by_owner")
              if got is None:
                  return "I can't find a variable called by_owner yet."
              if not isinstance(got, dict):
                  return "by_owner should be a defaultdict(list). It's a " + type(got).__name__ + "."
              want = {"platform": ["AKIA-2M9Q", "AKIA-1C5T"], "payments": ["AKIA-9X1B"]}
              if dict(got) != want:
                  return "by_owner should be " + H.short(want, 120) + ", but it's " + H.short(dict(got), 120) + "."
              new = H.sub(src, r"MAX_AGE\s*=\s*90", "MAX_AGE = 30")
              if new:
                  n, o, e = run(new)
                  want2 = {"payments": ["AKIA-7F3K", "AKIA-9X1B", "AKIA-8P2W"], "platform": ["AKIA-2M9Q", "AKIA-1C5T"]}
                  if dict(n.get("by_owner") or {}) != want2:
                      return "With MAX_AGE = 30, by_owner came out as " + H.short(dict(n.get("by_owner") or {}), 120) + ". Build it from expired."
              return True
        `
      },
      {
        id: "print",
        text: "For each expired key print <code>AKIA-2M9Q (platform): 253 days old, rotation was due 2026-05-31</code> (due = created + MAX_AGE days). Then print <code>Most keys: payments (3)</code>, counting <b>all</b> keys per owner with <code>Counter</code>.",
        hints: ["due = date.fromisoformat(k[\"created\"]) + timedelta(days=MAX_AGE). Printing a date gives YYYY-MM-DD. For the last line, Counter(k[\"owner\"] for k in keys).most_common(1)[0] is an (owner, count) tuple.",
          'for k in keys:\n    if k["id"] in expired:\n        due = date.fromisoformat(k["created"]) + timedelta(days=MAX_AGE)\n        print(f"{k[\'id\']} ({k[\'owner\']}): {age_days(k[\'created\'])} days old, rotation was due {due}")\n\nowner, count = Counter(k["owner"] for k in keys).most_common(1)[0]\nprint(f"Most keys: {owner} ({count})")'],
        check: py`
          def check(ns, out, run, src):
              r = H.printed(out, ["AKIA-2M9Q (platform): 253 days old, rotation was due 2026-05-31",
                                  "AKIA-9X1B (payments): 330 days old, rotation was due 2026-03-15",
                                  "AKIA-1C5T (platform): 132 days old, rotation was due 2026-09-29",
                                  "Most keys: payments (3)"])
              if r is not True:
                  return r
              new = H.sub(src, r"MAX_AGE\s*=\s*90", "MAX_AGE = 200")
              if new:
                  n, o, e = run(new)
                  want = ["AKIA-2M9Q (platform): 253 days old, rotation was due 2026-09-18",
                          "AKIA-9X1B (payments): 330 days old, rotation was due 2026-07-03",
                          "Most keys: payments (3)"]
                  if H.lines(o) != want:
                      return "With MAX_AGE = 200 the output should be:\n  " + "\n  ".join(want) + "\nYours was:\n  " + "\n  ".join(H.lines(o)[:5])
              return True
        `
      }
    ],
    debrief: "<p>Ticket closed. Three keys are overdue, one of them by almost a year, and the platform team owns two of them. That's the conversation to have first.</p>" +
      "<p><b>Why rotation matters:</b> a leaked key stays useful to an attacker until it's rotated. Short key lifetimes shrink that window, which is why auditors check rotation.</p>",
    realworld: "On AWS, <code>aws iam list-access-keys</code> returns each key's <code>CreateDate</code>. You'd parse it with <code>datetime.fromisoformat</code> and run exactly this logic. Module 3 covers calling APIs like that.",
    quiz: [
      { q: "<code>date(2026, 11, 10) - date(2026, 11, 1)</code> gives…", options: ["9", "a timedelta of 9 days", "\"9 days\"", "an error"], answer: 1,
        why: "Subtracting dates gives a timedelta. Use .days for the number." },
      { q: "<code>Counter([\"a\", \"b\", \"a\"]).most_common(1)</code> returns…", options: ["\"a\"", "[(\"a\", 2)]", "{\"a\": 2}", "2"], answer: 1,
        why: "most_common returns a list of (item, count) tuples, biggest first." },
      { q: "Why use <code>defaultdict(list)</code> for grouping?", options: ["It sorts the keys", "It creates an empty list the first time a key is used", "It's the only dict that can hold lists", "It removes duplicates"], answer: 1,
        why: "You can append straight away without checking whether the key exists." }
    ]
  });

  /* ================================================================== PY-117 capstone */
  var BUCKETS = [
    { name: "kc-public-assets", "public": true, encrypted: true, key_created: "2026-09-01" },
    { name: "kc-payroll-exports", "public": true, encrypted: false, key_created: "2026-02-14" },
    { name: "kc-app-logs", "public": false, encrypted: false, key_created: "2026-10-01" },
    { name: "kc-db-backups", "public": false, encrypted: true, key_created: "2026-05-20" },
    { name: "kc-marketing-site", "public": true, encrypted: true, key_created: "2026-10-15" },
    { name: "kc-ml-datasets", "public": true, encrypted: true, key_created: "2026-08-30" }
  ];
  var CAP_FILES = {
    "buckets.json": JSON.stringify(BUCKETS, null, 2) + "\n",
    "owners.csv": lines("bucket,team,contact", "kc-public-assets,web,web-team@kestrel.io", "kc-payroll-exports,finance,finance-ops@kestrel.io",
      "kc-app-logs,platform,platform@kestrel.io", "kc-db-backups,platform,platform@kestrel.io", "kc-marketing-site,web,web-team@kestrel.io",
      "kc-ml-datasets,data,data-eng@kestrel.io"),
    "policy.yaml": lines("# Kestrel Cloud storage policy v3", "max_key_age_days: 90", "require_encryption: true", "public_allowlist:",
      "  - kc-public-assets", "  - kc-marketing-site", "today: 2026-11-10"),
    "access.log": lines(
      "2026-11-09T22:14:03Z GET kc-public-assets/logo.png 200 anonymous 198.51.100.23",
      "2026-11-09T22:15:41Z GET kc-payroll-exports/2026-10.csv 200 anonymous 203.0.113.77",
      "2026-11-09T22:15:44Z GET kc-payroll-exports/2026-09.csv 200 anonymous 203.0.113.77",
      "2026-11-09T22:16:02Z PUT kc-app-logs/web-01.log 200 svc-logger 10.0.4.20",
      "2026-11-09T22:17:30Z GET kc-ml-datasets/train.parquet 200 anonymous 192.0.2.140",
      "2026-11-09T22:18:12Z GET kc-payroll-exports/2026-08.csv 403 anonymous 203.0.113.77",
      "2026-11-09T22:19:55Z GET kc-db-backups/nightly.sql.gz 403 anonymous 192.0.2.140",
      "2026-11-09T22:21:07Z GET kc-app-logs/web-01.log 200 alice 10.0.4.31")
  };

  LABS.push({
    id: "py-117", n: 17, module: 2, ticket: "PY-117", xp: 200, capstone: true,
    title: "Exposure audit",
    topic: "Module 2 capstone project",
    from: "Maya Chen & Dev Patel",
    story: "<p>Last night someone downloaded payroll exports from one of our storage buckets <b>without logging in</b>. Before we find out how, we need to know where else we're exposed.</p>" +
      "<p>You have four files from four different systems: the bucket inventory, the ownership sheet, the storage policy and last night's access log. Combine them into one audit, a findings spreadsheet and a summary for the incident channel. It's everything from Module 2 in one project.</p>",
    learn:
      '<div class="callout warn"><b>Capstone rules.</b> There are no hints. Build one function at a time and try each in the console after pressing Run (e.g. <code>load_owners("owners.csv")</code>). ' +
      "If you get completely stuck, the Tasks tab has a button to reveal the full solution. The capstone then earns half XP.</div>" +
      "<h3>The files</h3>" +
      '<table class="t"><tr><th>File</th><th>What\'s in it</th></tr>' +
      "<tr><td><code>buckets.json</code></td><td>a list of buckets: <code>name</code>, <code>public</code>, <code>encrypted</code>, <code>key_created</code> (date string)</td></tr>" +
      "<tr><td><code>owners.csv</code></td><td>columns <code>bucket,team,contact</code></td></tr>" +
      "<tr><td><code>policy.yaml</code></td><td><code>max_key_age_days</code>, <code>require_encryption</code>, <code>public_allowlist</code> (buckets that are <em>meant</em> to be public) and <code>today</code>. YAML already turns <code>today</code> into a <code>date</code> for you.</td></tr>" +
      "<tr><td><code>access.log</code></td><td>one request per line: <code>time METHOD bucket/object status user ip</code></td></tr></table>" +
      "<p>Look at each one first, e.g. <code>print(open(\"access.log\").read())</code> in the console.</p>" +
      "<h3>What to build</h3>" +
      '<table class="t"><tr><th>Piece</th><th>Spec</th></tr>' +
      "<tr><td><code>load_policy(path)</code></td><td>the policy dict from the YAML file, with <code>public_allowlist</code> turned into a <b>set</b></td></tr>" +
      "<tr><td><code>load_owners(path)</code></td><td>a dict: bucket name → team, from the CSV</td></tr>" +
      "<tr><td><code>anonymous_reads(path)</code></td><td>a dict (or Counter): bucket name → number of <b>successful anonymous downloads</b>, meaning lines with method <code>GET</code>, status <code>200</code> and user <code>anonymous</code>. Buckets with none don't appear.</td></tr>" +
      "<tr><td><code>audit_bucket(bucket, policy, reads)</code></td><td>returns the list of findings for one bucket from <code>buckets.json</code>, in this order:<br>" +
      "1. <code>\"public (not allowlisted)\"</code> if it's public and not on the allowlist<br>" +
      "2. <code>\"unencrypted\"</code> if the policy requires encryption and it isn't encrypted<br>" +
      "3. <code>\"key older than 90 days\"</code> if its key is older than <code>max_key_age_days</code> on <code>today</code> (use the policy's number in the text)<br>" +
      "4. <code>\"anonymous downloads: 2\"</code> if it's <b>not</b> on the allowlist and <code>reads</code> has downloads for it</td></tr>" +
      "<tr><td><code>findings.csv</code></td><td>columns <code>bucket,team,finding</code>, one row per finding, buckets in <code>buckets.json</code> order</td></tr>" +
      "<tr><td><code>summary.json</code></td><td><code>buckets_checked</code>, <code>buckets_flagged</code>, <code>findings</code> (total count) and <code>by_team</code> (team → number of findings)</td></tr>" +
      "<tr><td>printed report</td><td>one line per flagged bucket, <code>bucket (team): finding, finding</code>, then a summary line</td></tr></table>" +
      "<h3>Expected output</h3>" +
      '<pre class="code">kc-payroll-exports (finance): public (not allowlisted), unencrypted, key older than 90 days, anonymous downloads: 2\nkc-app-logs (platform): unencrypted\nkc-db-backups (platform): key older than 90 days\nkc-ml-datasets (data): public (not allowlisted), anonymous downloads: 1\n4 of 6 buckets need action</pre>' +
      "<p>Allowlisted buckets like <code>kc-public-assets</code> are public on purpose, so anonymous downloads from them are expected and aren't findings.</p>",
    starter: py`
      # PY-117 · Exposure audit (Module 2 capstone)
      import csv
      import json
      import re
      from collections import Counter
      from datetime import date

      import yaml


      def load_policy(path):
          pass


      def load_owners(path):
          pass


      def anonymous_reads(path):
          pass


      def audit_bucket(bucket, policy, reads):
          pass


      # Load everything, audit each bucket in buckets.json, write findings.csv and
      # summary.json, then print the report.

    `,
    solution: py`
      import csv
      import json
      import re
      from collections import Counter
      from datetime import date

      import yaml


      def load_policy(path):
          with open(path) as f:
              policy = yaml.safe_load(f)
          policy["public_allowlist"] = set(policy["public_allowlist"])
          return policy


      def load_owners(path):
          owners = {}
          with open(path, newline="") as f:
              for row in csv.DictReader(f):
                  owners[row["bucket"]] = row["team"]
          return owners


      def anonymous_reads(path):
          reads = Counter()
          with open(path) as f:
              for line in f:
                  m = re.match(r"\S+ GET ([\w-]+)/\S* 200 anonymous ", line)
                  if m:
                      reads[m.group(1)] += 1
          return reads


      def audit_bucket(bucket, policy, reads):
          findings = []
          name = bucket["name"]
          allowed = name in policy["public_allowlist"]
          if bucket["public"] and not allowed:
              findings.append("public (not allowlisted)")
          if policy["require_encryption"] and not bucket["encrypted"]:
              findings.append("unencrypted")
          max_age = policy["max_key_age_days"]
          age = (policy["today"] - date.fromisoformat(bucket["key_created"])).days
          if age > max_age:
              findings.append(f"key older than {max_age} days")
          if not allowed and reads.get(name, 0) > 0:
              findings.append(f"anonymous downloads: {reads[name]}")
          return findings


      policy = load_policy("policy.yaml")
      owners = load_owners("owners.csv")
      reads = anonymous_reads("access.log")
      with open("buckets.json") as f:
          buckets = json.load(f)

      results = {}
      for bucket in buckets:
          found = audit_bucket(bucket, policy, reads)
          if found:
              results[bucket["name"]] = found

      by_team = Counter()
      with open("findings.csv", "w", newline="") as f:
          writer = csv.DictWriter(f, fieldnames=["bucket", "team", "finding"])
          writer.writeheader()
          for name, found in results.items():
              for finding in found:
                  writer.writerow({"bucket": name, "team": owners[name], "finding": finding})
                  by_team[owners[name]] += 1

      summary = {
          "buckets_checked": len(buckets),
          "buckets_flagged": len(results),
          "findings": sum(by_team.values()),
          "by_team": dict(by_team),
      }
      with open("summary.json", "w") as f:
          json.dump(summary, f, indent=2)

      for name, found in results.items():
          print(f"{name} ({owners[name]}): {', '.join(found)}")
      print(f"{len(results)} of {len(buckets)} buckets need action")
    `,
    files: CAP_FILES,
    removeFiles: ["findings.csv", "summary.json"],
    objectives: [
      {
        id: "loaders", hints: [],
        text: "<code>load_policy(path)</code> returns the policy with <code>public_allowlist</code> as a set, and <code>load_owners(path)</code> returns bucket → team.",
        check: py`
          def check(ns, out, run, src):
              import datetime
              if re.search(r"yaml\.(load|unsafe_load|full_load)\s*\(", src):
                  return "Use yaml.safe_load to read the policy."
              f = H.fn(ns, "load_policy")
              if not f:
                  return "I can't find a function called load_policy."
              ok, got = H.call(f, "policy.yaml")
              if not ok:
                  return "load_policy(\"policy.yaml\") crashed: " + type(got).__name__ + ": " + str(got)
              want = {"max_key_age_days": 90, "require_encryption": True,
                      "public_allowlist": {"kc-public-assets", "kc-marketing-site"}, "today": datetime.date(2026, 11, 10)}
              if not isinstance(got, dict):
                  return "load_policy should return a dict. It returned " + H.short(got)
              if not isinstance(got.get("public_allowlist"), set):
                  return "public_allowlist should be a set. It's a " + type(got.get("public_allowlist")).__name__ + "."
              if got != want:
                  return "load_policy(\"policy.yaml\") returned " + H.short(got, 200) + ", expected " + H.short(want, 200)
              f = H.fn(ns, "load_owners")
              if not f:
                  return "I can't find a function called load_owners."
              ok, got = H.call(f, "owners.csv")
              if not ok:
                  return "load_owners(\"owners.csv\") crashed: " + type(got).__name__ + ": " + str(got)
              want = {"kc-public-assets": "web", "kc-payroll-exports": "finance", "kc-app-logs": "platform",
                      "kc-db-backups": "platform", "kc-marketing-site": "web", "kc-ml-datasets": "data"}
              if got != want:
                  return "load_owners(\"owners.csv\") returned " + H.short(got, 200) + ", expected " + H.short(want, 200)
              return True
        `
      },
      {
        id: "reads", hints: [],
        text: "<code>anonymous_reads(path)</code> counts successful anonymous downloads (<code>GET</code>, <code>200</code>, <code>anonymous</code>) per bucket.",
        check: py`
          def check(ns, out, run, src):
              import os
              f = H.fn(ns, "anonymous_reads")
              if not f:
                  return "I can't find a function called anonymous_reads."
              ok, got = H.call(f, "access.log")
              if not ok:
                  return "anonymous_reads(\"access.log\") crashed: " + type(got).__name__ + ": " + str(got)
              want = {"kc-public-assets": 1, "kc-payroll-exports": 2, "kc-ml-datasets": 1}
              if not isinstance(got, dict) or dict(got) != want:
                  return "anonymous_reads(\"access.log\") returned " + H.short(got, 200) + ", expected " + H.short(want, 200)
              open("_check.log", "w").write(
                  "t GET kc-x/a.txt 200 anonymous 1.2.3.4\n"
                  "t GET kc-x/b.txt 404 anonymous 1.2.3.4\n"
                  "t HEAD kc-y/c.txt 200 anonymous 1.2.3.4\n"
                  "t GET kc-y/d.txt 200 alice 1.2.3.4\n"
                  "t GET kc-z/deep/path/e.txt 200 anonymous 1.2.3.4\n"
                  "t PUT kc-x/f.txt 200 anonymous 1.2.3.4\n")
              ok, got = H.call(f, "_check.log")
              os.remove("_check.log")
              want = {"kc-x": 1, "kc-z": 1}
              if not ok or not isinstance(got, dict) or dict(got) != want:
                  return ("For a log with a 404, a HEAD, a PUT, a logged-in user and a nested object path, anonymous_reads returned " +
                          H.short(got, 200) + ", expected " + H.short(want) + ". Only GET + 200 + anonymous counts.")
              return True
        `
      },
      {
        id: "audit", hints: [],
        text: "<code>audit_bucket(bucket, policy, reads)</code> returns the right findings in the right order.",
        check: py`
          def check(ns, out, run, src):
              import datetime
              f = H.fn(ns, "audit_bucket")
              if not f:
                  return "I can't find a function called audit_bucket."
              pol = {"max_key_age_days": 90, "require_encryption": True, "public_allowlist": {"ok-public"}, "today": datetime.date(2026, 11, 10)}
              pol60 = dict(pol, max_key_age_days=60, require_encryption=False)
              def b(name="b1", public=False, enc=True, key="2026-10-01"):
                  return {"name": name, "public": public, "encrypted": enc, "key_created": key}
              cases = [
                  ("a private, encrypted bucket with a new key", b(), pol, {}, []),
                  ("a public bucket that's not allowlisted, unencrypted, old key, 3 anonymous reads",
                   b(public=True, enc=False, key="2026-01-01"), pol, {"b1": 3},
                   ["public (not allowlisted)", "unencrypted", "key older than 90 days", "anonymous downloads: 3"]),
                  ("an allowlisted public bucket with anonymous reads", b("ok-public", public=True), pol, {"ok-public": 9}, []),
                  ("a key exactly 90 days old", b(key="2026-08-12"), pol, {}, []),
                  ("a key 91 days old", b(key="2026-08-11"), pol, {}, ["key older than 90 days"]),
                  ("an unencrypted bucket when encryption isn't required, with max_key_age_days 60 and a 70-day-old key",
                   b(enc=False, key="2026-09-01"), pol60, {}, ["key older than 60 days"]),
                  ("a private bucket with anonymous reads (not allowlisted)", b(), pol, {"b1": 1, "other": 5}, ["anonymous downloads: 1"]),
              ]
              for label, bucket, policy, reads, want in cases:
                  ok, got = H.call(f, bucket, policy, reads)
                  if not ok:
                      return "audit_bucket() crashed for " + label + ": " + type(got).__name__ + ": " + str(got)
                  if got != want:
                      return "For " + label + ", audit_bucket returned " + H.short(got, 200) + ", expected " + H.short(want, 200) + "."
              return True
        `
      },
      {
        id: "files", hints: [],
        text: "<code>findings.csv</code> and <code>summary.json</code> are written with the right contents.",
        check: py`
          def check(ns, out, run, src):
              import os
              for p in ("findings.csv", "summary.json"):
                  if os.path.exists(p):
                      os.remove(p)
              n, o, e = run()
              if not os.path.exists("findings.csv"):
                  return "findings.csv wasn't created."
              got = [l for l in open("findings.csv", newline="").read().splitlines() if l.strip()]
              want = ["bucket,team,finding",
                      "kc-payroll-exports,finance,public (not allowlisted)",
                      "kc-payroll-exports,finance,unencrypted",
                      "kc-payroll-exports,finance,key older than 90 days",
                      "kc-payroll-exports,finance,anonymous downloads: 2",
                      "kc-app-logs,platform,unencrypted",
                      "kc-db-backups,platform,key older than 90 days",
                      "kc-ml-datasets,data,public (not allowlisted)",
                      "kc-ml-datasets,data,anonymous downloads: 1"]
              if got != want:
                  return "findings.csv should be:\n  " + "\n  ".join(want) + "\nIt is:\n  " + ("\n  ".join(got[:10]) if got else "(empty)")
              if not os.path.exists("summary.json"):
                  return "summary.json wasn't created."
              try:
                  s = json.loads(open("summary.json").read())
              except ValueError as ex:
                  return "summary.json isn't valid JSON: " + str(ex)
              want = {"buckets_checked": 6, "buckets_flagged": 4, "findings": 8, "by_team": {"finance": 4, "platform": 2, "data": 2}}
              if s != want:
                  return "summary.json should hold " + json.dumps(want) + ", but it holds " + H.short(s, 200)
              return True
        `
      },
      {
        id: "print", hints: [],
        text: "The printed report matches the expected output, and it follows <code>policy.yaml</code> when the policy changes.",
        check: py`
          def check(ns, out, run, src):
              want = ["kc-payroll-exports (finance): public (not allowlisted), unencrypted, key older than 90 days, anonymous downloads: 2",
                      "kc-app-logs (platform): unencrypted",
                      "kc-db-backups (platform): key older than 90 days",
                      "kc-ml-datasets (data): public (not allowlisted), anonymous downloads: 1",
                      "4 of 6 buckets need action"]
              r = H.printed(out, want)
              if r is not True:
                  return r
              orig = open("policy.yaml").read()
              open("policy.yaml", "w").write(orig.replace("max_key_age_days: 90", "max_key_age_days: 180").replace("  - kc-marketing-site", "  - kc-marketing-site\n  - kc-ml-datasets"))
              try:
                  n, o, e = run()
              finally:
                  open("policy.yaml", "w").write(orig)
                  run()
              want2 = ["kc-payroll-exports (finance): public (not allowlisted), unencrypted, key older than 180 days, anonymous downloads: 2",
                       "kc-app-logs (platform): unencrypted",
                       "2 of 6 buckets need action"]
              if H.lines(o) != want2:
                  return ("When I changed policy.yaml (max_key_age_days: 180, and kc-ml-datasets allowlisted), the report should be:\n  " +
                          "\n  ".join(want2) + "\nYours was:\n  " + "\n  ".join(H.lines(o)[:6]))
              return True
        `
      }
    ],
    debrief: "<p><b>Module 2 complete!</b> You joined four data sources in four formats (JSON, CSV, YAML and a raw log) into one audit with machine-readable output. That's what a real cloud security posture check does.</p>" +
      "<p>And the incident? <code>kc-payroll-exports</code> was public by mistake, unencrypted, and its key hadn't been rotated in 269 days. Two payroll files went to <code>203.0.113.77</code>. The third download was blocked (403).</p>" +
      "<p>Next up, <b>Module 3: Automation for DevSecOps</b>: log analysis, APIs, hashing, secrets scanning and command-line tools that fail your CI pipeline when something's wrong.</p>",
    realworld: "Cloud posture tools like Prowler and ScoutSuite run hundreds of checks like these against real AWS, Azure and GCP accounts. Save your solution as <code>exposure_audit.py</code> next to the four files and run it locally. It's your second portfolio script.",
    quiz: []
  });

  /* ------------------------------------------------------------------ Reference solutions */
  var SOLUTIONS = {
    "py-111": py`
      from pathlib import Path


      def count_errors(path):
          count = 0
          with open(path) as f:
              for line in f:
                  if "ERROR" in line:
                      count += 1
          return count


      log_files = [p.name for p in sorted(Path("logs").glob("*.log"))]

      errors_by_file = {}
      for name in log_files:
          errors_by_file[name] = count_errors(Path("logs") / name)

      with open("summary.txt", "w") as f:
          for name, count in errors_by_file.items():
              f.write(f"{name}: {count}\n")
          f.write(f"TOTAL: {sum(errors_by_file.values())}\n")
    `,
    "py-112": py`
      approved = ["alice", "bob", "chen", "dana", "erin"]
      on_server = ["alice", "bob", "mallory", "dana", "svc-deploy", "bob"]

      keys = [
          ("alice", "ed25519", 256),
          ("bob", "rsa", 1024),
          ("dana", "rsa", 4096),
          ("mallory", "rsa", 2048),
          ("bob", "ed25519", 256),
      ]

      unauthorized = set(on_server) - set(approved)
      missing = set(approved) - set(on_server)

      weak_keys = [user for user, kind, bits in keys if kind == "rsa" and bits < 2048]

      access_status = {user: ("ok" if user in approved else "REMOVE") for user in set(on_server)}

      print(f"Remove: {', '.join(sorted(unauthorized))}")
      print(f"Add: {', '.join(sorted(missing))}")
    `,
    "py-113": py`
      import re

      log = [
          "Mar 12 03:14:07 bastion sshd[2231]: Failed password for root from 203.0.113.45 port 52144 ssh2",
          "Mar 12 03:14:09 bastion sshd[2231]: Failed password for invalid user admin from 203.0.113.45 port 52146 ssh2",
          "Mar 12 03:15:22 bastion sshd[2240]: Accepted publickey for alice from 10.0.4.12 port 50022 ssh2",
          "Mar 12 03:16:40 bastion sshd[2251]: Failed password for bob from 198.51.100.7 port 40112 ssh2",
          "Mar 12 03:17:02 bastion CRON[2260]: pam_unix(cron:session): session opened for user root",
      ]

      ips = []
      for line in log:
          ips += re.findall(r"\d+\.\d+\.\d+\.\d+", line)

      FAILED = re.compile(r"Failed password for (?:invalid user )?(?P<user>\w+) from (?P<ip>\S+) port (?P<port>\d+)")


      def parse_failed(line):
          m = FAILED.search(line)
          if not m:
              return None
          return (m.group("user"), m.group("ip"), int(m.group("port")))


      failed = [parse_failed(line) for line in log if parse_failed(line) is not None]


      def valid_hostname(name):
          return bool(re.fullmatch(r"[a-z]+-\d{2}\.(prod|dev)\.kestrel\.io", name))
    `,
    "py-114": py`
      import csv
      import json

      with open("scan.json") as f:
          data = json.load(f)
      target = data["target"]
      findings = data["findings"]

      urgent = [f["id"] for f in findings if f["cvss"] >= 7.0]
      no_fix = [f["id"] for f in findings if f["fixed_in"] is None]

      with open("findings.csv", "w", newline="") as f:
          writer = csv.DictWriter(f, fieldnames=["id", "package", "severity", "cvss", "fixed_in"])
          writer.writeheader()
          for finding in sorted(findings, key=lambda x: x["cvss"], reverse=True):
              row = dict(finding)
              if row["fixed_in"] is None:
                  row["fixed_in"] = "none"
              writer.writerow(row)

      by_severity = {}
      for finding in findings:
          s = finding["severity"]
          by_severity[s] = by_severity.get(s, 0) + 1

      summary = {"target": target, "total": len(findings), "by_severity": by_severity}
      with open("summary.json", "w") as f:
          json.dump(summary, f, indent=2)
    `,
    "py-115": py`
      import re
      import yaml

      REQUIRED = ["service", "environment", "replicas", "server", "database"]

      with open("deploy.yaml") as f:
          config = yaml.safe_load(f)
      port = config["server"]["port"]
      tls_on = config["server"]["tls"]["enabled"]


      def missing_keys(cfg, required):
          return [key for key in required if key not in cfg]


      def find_issues(cfg):
          issues = []
          if cfg.get("debug") is True:
              issues.append("debug enabled")
          if cfg.get("server", {}).get("tls", {}).get("enabled") is not True:
              issues.append("TLS disabled")
          url = cfg.get("database", {}).get("url", "")
          if re.search(r"//[^/@:]+:[^/@]+@", url):
              issues.append("password in database URL")
          if cfg.get("environment") == "production" and cfg.get("logging", {}).get("level") == "DEBUG":
              issues.append("verbose logging in production")
          return issues


      missing = missing_keys(config, REQUIRED)
      print(f"Review of {config['service']}")
      print(f"Missing keys: {', '.join(missing) or 'none'}")
      for issue in find_issues(config):
          print(f"- {issue}")
    `,
    "py-116": py`
      from collections import Counter, defaultdict
      from datetime import date, timedelta

      TODAY = date(2026, 11, 10)
      MAX_AGE = 90

      keys = [
          {"id": "AKIA-7F3K", "owner": "payments", "created": "2026-08-20"},
          {"id": "AKIA-2M9Q", "owner": "platform", "created": "2026-03-02"},
          {"id": "AKIA-9X1B", "owner": "payments", "created": "2025-12-15"},
          {"id": "AKIA-4H8D", "owner": "data",     "created": "2026-10-30"},
          {"id": "AKIA-1C5T", "owner": "platform", "created": "2026-07-01"},
          {"id": "AKIA-8P2W", "owner": "payments", "created": "2026-08-12"},
      ]


      def age_days(created):
          return (TODAY - date.fromisoformat(created)).days


      expired = [k["id"] for k in keys if age_days(k["created"]) > MAX_AGE]

      by_owner = defaultdict(list)
      for k in keys:
          if k["id"] in expired:
              by_owner[k["owner"]].append(k["id"])

      for k in keys:
          if k["id"] in expired:
              due = date.fromisoformat(k["created"]) + timedelta(days=MAX_AGE)
              print(f"{k['id']} ({k['owner']}): {age_days(k['created'])} days old, rotation was due {due}")

      owner, count = Counter(k["owner"] for k in keys).most_common(1)[0]
      print(f"Most keys: {owner} ({count})")
    `
  };

  /* ------------------------------------------------------------------ Practice drills */
  // Re-runs the learner's code after temporarily replacing a lab file, then restores it.
  // (Pasted into checks that need it, since each check runs on its own.)
  var WITH_FILE = py`
    def _with_file(run, path, text):
        orig = open(path).read()
        open(path, "w").write(text)
        try:
            return run()
        finally:
            open(path, "w").write(orig)
  `;

  var DRILLS = {
    "py-111": [
      {
        id: "d1", title: "Count the hosts",
        text: "<p><code>hosts.txt</code> has one hostname per line, plus some blank lines. Set <code>count</code> to the number of <b>non-blank</b> lines.</p>",
        files: { "hosts.txt": lines("web-01", "web-02", "", "db-01", "   ", "cache-01") },
        starter: py`
          count = 0

        `,
        solution: py`
          count = 0
          with open("hosts.txt") as f:
              for line in f:
                  if line.strip():
                      count += 1
        `,
        check: py`
          def check(ns, out, run, src):
              r = H.expect(ns, "count", 4)
              if r is not True:
                  return r
              n, o, e = _with_file(run, "hosts.txt", "a\n\nb\n")
              if n.get("count") != 2:
                  return "With a different hosts.txt (2 hosts), count was " + H.short(n.get("count")) + ". Count from the file."
              return True
        ` + "\n\n" + WITH_FILE
      },
      {
        id: "d2", title: "Append to the audit log",
        text: "<p>Add the line <code>2026-11-10 rotated key AKIA-2M9Q</code> to the <b>end</b> of <code>audit.log</code>, keeping the two lines already in it.</p>",
        files: { "audit.log": lines("2026-11-08 created user dana", "2026-11-09 removed user mallory") },
        starter: py`
          entry = "2026-11-10 rotated key AKIA-2M9Q"

        `,
        solution: py`
          entry = "2026-11-10 rotated key AKIA-2M9Q"
          with open("audit.log", "a") as f:
              f.write(entry + "\n")
        `,
        check: py`
          def check(ns, out, run, src):
              got = [l for l in open("audit.log").read().splitlines() if l.strip()]
              want = ["2026-11-08 created user dana", "2026-11-09 removed user mallory", "2026-11-10 rotated key AKIA-2M9Q"]
              if got == want[2:]:
                  return "The first two lines are gone. Mode \"w\" erases the file: use \"a\" to append."
              if got != want:
                  return "audit.log should end up as:\n  " + "\n  ".join(want) + "\nIt is:\n  " + "\n  ".join(got)
              return True
        `
      },
      {
        id: "d3", title: "Find the config files",
        text: "<p>The <code>etc</code> folder holds a few files. Set <code>configs</code> to a sorted list of the <b>names</b> of the <code>.yaml</code> files in it.</p>",
        files: { "etc/app.yaml": "name: app\n", "etc/db.yaml": "name: db\n", "etc/README.md": "# configs\n", "etc/old.yaml.bak": "name: old\n" },
        starter: py`
          from pathlib import Path

        `,
        solution: py`
          from pathlib import Path

          configs = sorted(p.name for p in Path("etc").glob("*.yaml"))
        `,
        check: py`
          def check(ns, out, run, src):
              import os
              got = ns.get("configs")
              if isinstance(got, list) and got and not isinstance(got[0], str):
                  return "configs holds Path objects. Use .name to get each file name as a string."
              r = H.expect(ns, "configs", ["app.yaml", "db.yaml"], list)
              if r is not True:
                  return r
              open("etc/cache.yaml", "w").write("name: cache\n")
              try:
                  n, o, e = run()
              finally:
                  os.remove("etc/cache.yaml")
              if n.get("configs") != ["app.yaml", "cache.yaml", "db.yaml"]:
                  return "When I added etc/cache.yaml, configs was " + H.short(n.get("configs")) + ". Use glob on the folder."
              return True
        `
      }
    ],

    "py-112": [
      {
        id: "d1", title: "Unique IPs",
        text: "<p>Set <code>unique_ips</code> to a sorted <b>list</b> of the IPs in <code>seen</code>, each once.</p>",
        starter: py`
          seen = ["10.0.0.9", "10.0.0.5", "10.0.0.9", "10.0.0.12", "10.0.0.5"]

        `,
        solution: py`
          seen = ["10.0.0.9", "10.0.0.5", "10.0.0.9", "10.0.0.12", "10.0.0.5"]
          unique_ips = sorted(set(seen))
        `,
        check: py`
          def check(ns, out, run, src):
              return H.vars(ns, src, run, {"unique_ips": ["10.0.0.12", "10.0.0.5", "10.0.0.9"]},
                            [(r"seen\s*=\s*\[[^\]]*\]", 'seen = ["b", "a", "b"]', {"unique_ips": ["a", "b"]}, "a different seen list")])
        `
      },
      {
        id: "d2", title: "Compare two port scans",
        text: "<p>Set <code>common</code> to the <b>set</b> of ports both scans found, and <code>new_ports</code> to the set of ports that only appeared in <code>today</code>.</p>",
        starter: py`
          yesterday = [22, 80, 443]
          today = [22, 443, 3306, 8080]

        `,
        solution: py`
          yesterday = [22, 80, 443]
          today = [22, 443, 3306, 8080]
          common = set(yesterday) & set(today)
          new_ports = set(today) - set(yesterday)
        `,
        check: py`
          def check(ns, out, run, src):
              return H.vars(ns, src, run, {"common": {22, 443}, "new_ports": {3306, 8080}},
                            [(r"today\s*=\s*\[[^\]]*\]", "today = [80, 9000]", {"common": {80}, "new_ports": {9000}}, "a different today list")])
        `
      },
      {
        id: "d3", title: "Build the URLs",
        text: "<p>With one list comprehension, set <code>web_urls</code> to <code>https://NAME.kestrel.io</code> for every host that starts with <code>web</code>.</p>",
        starter: py`
          hosts = ["web-01", "db-01", "web-02", "cache-01"]

        `,
        solution: py`
          hosts = ["web-01", "db-01", "web-02", "cache-01"]
          web_urls = [f"https://{h}.kestrel.io" for h in hosts if h.startswith("web")]
        `,
        check: py`
          def check(ns, out, run, src):
              return H.vars(ns, src, run, {"web_urls": ["https://web-01.kestrel.io", "https://web-02.kestrel.io"]},
                            [(r"hosts\s*=\s*\[[^\]]*\]", 'hosts = ["db-02", "web-09"]', {"web_urls": ["https://web-09.kestrel.io"]}, "a different hosts list")])
        `
      }
    ],

    "py-113": [
      {
        id: "d1", title: "Find the emails",
        text: "<p>Set <code>emails</code> to every email address in <code>text</code>, in order, using <code>re.findall</code>.</p>",
        starter: py`
          import re

          text = "Alert sent to oncall@kestrel.io and maya.chen@kestrel.io; cc sec-team@kestrel.io"

        `,
        solution: py`
          import re

          text = "Alert sent to oncall@kestrel.io and maya.chen@kestrel.io; cc sec-team@kestrel.io"
          emails = re.findall(r"[\w.-]+@[\w-]+\.[a-z]+", text)
        `,
        check: py`
          def check(ns, out, run, src):
              return H.vars(ns, src, run, {"emails": ["oncall@kestrel.io", "maya.chen@kestrel.io", "sec-team@kestrel.io"]},
                            [(r"text\s*=\s*\"[^\"]*\"", 'text = "ping dev.patel@kestrel.io now"', {"emails": ["dev.patel@kestrel.io"]}, "a different text")])
        `
      },
      {
        id: "d2", title: "Status codes",
        text: "<p>Write <code>status_code(line)</code>: for a web server log line it returns the 3-digit status code that comes right after the quoted request, as an int. It returns <code>None</code> if there isn't one.</p>",
        starter: py`
          import re

          line = '203.0.113.9 - - [10/Nov/2026:09:12:01] "POST /login HTTP/1.1" 401 512'


          def status_code(line):
              pass

        `,
        solution: py`
          import re

          line = '203.0.113.9 - - [10/Nov/2026:09:12:01] "POST /login HTTP/1.1" 401 512'


          def status_code(line):
              m = re.search(r'" (\d{3}) ', line)
              if not m:
                  return None
              return int(m.group(1))
        `,
        check: py`
          def check(ns, out, run, src):
              return H.func(ns, "status_code", [
                  (('203.0.113.9 - - [10/Nov/2026:09:12:01] "POST /login HTTP/1.1" 401 512',), 401),
                  (('10.0.0.1 - - [10/Nov/2026:09:13:00] "GET /health HTTP/1.1" 200 2',), 200),
                  (('10.0.0.1 - - [10/Nov/2026:09:14:00] "GET /a/500/b HTTP/1.1" 404 0',), 404),
                  (("not a log line",), None),
              ])
        `
      },
      {
        id: "d3", title: "Mask card numbers",
        text: "<p>Write <code>mask_cards(text)</code>: it replaces every 16-digit number with twelve <code>*</code> followed by its last 4 digits, using <code>re.sub</code>. Other numbers stay as they are.</p>",
        starter: py`
          import re


          def mask_cards(text):
              pass


          print(mask_cards("order 1042 paid with 4111111111111111"))
        `,
        solution: py`
          import re


          def mask_cards(text):
              return re.sub(r"\b\d{12}(\d{4})\b", r"************\1", text)


          print(mask_cards("order 1042 paid with 4111111111111111"))
        `,
        check: py`
          def check(ns, out, run, src):
              return H.func(ns, "mask_cards", [
                  (("order 1042 paid with 4111111111111111",), "order 1042 paid with ************1111"),
                  (("cards 5500000000000004 and 4000056655665556",), "cards ************0004 and ************5556"),
                  (("phone 5551234567",), "phone 5551234567"),
              ])
        `
      }
    ],

    "py-114": [
      {
        id: "d1", title: "Parse an API response",
        text: "<p><code>raw</code> is JSON text from an API. Parse it with <code>json.loads</code>, then set <code>is_admin</code> (is <code>\"admin\"</code> in the roles?) and <code>mfa</code> (the mfa value).</p>",
        starter: py`
          import json

          raw = '{"user": "bob", "roles": ["dev", "admin"], "mfa": false}'

        `,
        solution: py`
          import json

          raw = '{"user": "bob", "roles": ["dev", "admin"], "mfa": false}'
          data = json.loads(raw)
          is_admin = "admin" in data["roles"]
          mfa = data["mfa"]
        `,
        check: py`
          def check(ns, out, run, src):
              r = H.expect(ns, "mfa", False, bool)
              if r is not True:
                  return r
              return H.vars(ns, src, run, {"is_admin": True},
                            [(r"raw\s*=\s*'[^']*'", "raw = '{\"user\": \"x\", \"roles\": [\"dev\"], \"mfa\": true}'", {"is_admin": False, "mfa": True}, "a different raw")])
        `
      },
      {
        id: "d2", title: "Read the admins from a CSV",
        text: "<p><code>users.csv</code> has the columns <code>name,role,last_login</code>. Use <code>csv.DictReader</code> to set <code>admins</code> to the names whose role is <code>admin</code>, in file order.</p>",
        files: { "users.csv": lines("name,role,last_login", "alice,dev,2026-11-09", "bob,admin,2026-11-01", "chen,viewer,2026-10-12", "dana,admin,2026-11-10") },
        starter: py`
          import csv

        `,
        solution: py`
          import csv

          admins = []
          with open("users.csv", newline="") as f:
              for row in csv.DictReader(f):
                  if row["role"] == "admin":
                      admins.append(row["name"])
        `,
        check: py`
          def check(ns, out, run, src):
              r = H.expect(ns, "admins", ["bob", "dana"], list)
              if r is not True:
                  return r
              n, o, e = _with_file(run, "users.csv", "name,role,last_login\nzed,admin,2026-01-01\nyan,dev,2026-01-02\n")
              if n.get("admins") != ["zed"]:
                  return "With a different users.csv, admins was " + H.short(n.get("admins")) + ". Read it from the file."
              return True
        ` + "\n\n" + WITH_FILE
      },
      {
        id: "d3", title: "Pretty-print a report",
        text: "<p>Set <code>text</code> to <code>report</code> as JSON with <code>indent=2</code> and <code>sort_keys=True</code>, then print it.</p>",
        starter: py`
          import json

          report = {"host": "web-01", "open_ports": [22, 443], "patched": False}

        `,
        solution: py`
          import json

          report = {"host": "web-01", "open_ports": [22, 443], "patched": False}
          text = json.dumps(report, indent=2, sort_keys=True)
          print(text)
        `,
        check: py`
          def check(ns, out, run, src):
              want = json.dumps(ns.get("report"), indent=2, sort_keys=True)
              r = H.expect(ns, "text", want, str)
              if r is not True:
                  return r
              if want.strip() not in out:
                  return "text is right. Now print it."
              return True
        `
      }
    ],

    "py-115": [
      {
        id: "d1", title: "Is SSH open?",
        text: "<p>Load <code>doc</code> with <code>yaml.safe_load</code>. Set <code>allowed</code> to the firewall's list of allowed ports, and <code>ssh_open</code> to whether port 22 is in it.</p>",
        starter: py`
          import yaml

          doc = """
          firewall:
            default: deny
            allow:
              - 22
              - 443
          """

        `,
        solution: py`
          import yaml

          doc = """
          firewall:
            default: deny
            allow:
              - 22
              - 443
          """
          allowed = yaml.safe_load(doc)["firewall"]["allow"]
          ssh_open = 22 in allowed
        `,
        check: py`
          def check(ns, out, run, src):
              if re.search(r"yaml\.(load|unsafe_load|full_load)\s*\(", src):
                  return "Use yaml.safe_load."
              return H.vars(ns, src, run, {"allowed": [22, 443], "ssh_open": True},
                            [(r"- 22\n", "- 8443\n", {"allowed": [8443, 443], "ssh_open": False}, "port 22 replaced by 8443")])
        `
      },
      {
        id: "d2", title: "The Norway problem",
        text: "<p>Run this and look at <code>countries</code>: Norway became <code>False</code>! Fix the <b>YAML text</b> (not the Python) so <code>countries</code> is <code>[\"GB\", \"NO\", \"SE\"]</code>.</p>",
        starter: py`
          import yaml

          doc = "countries: [GB, NO, SE]"
          countries = yaml.safe_load(doc)["countries"]
          print(countries)
        `,
        solution: py`
          import yaml

          doc = 'countries: [GB, "NO", SE]'
          countries = yaml.safe_load(doc)["countries"]
          print(countries)
        `,
        check: py`
          def check(ns, out, run, src):
              if "safe_load" not in src:
                  return "Keep loading the YAML with yaml.safe_load."
              if not re.search(r"countries\s*=\s*yaml\.safe_load\(doc\)\[.countries.\]", src):
                  return "Keep the line countries = yaml.safe_load(doc)[\"countries\"]. Fix the YAML text in doc instead."
              return H.expect(ns, "countries", ["GB", "NO", "SE"], list)
        `
      },
      {
        id: "d3", title: "Who binds to 0.0.0.0?",
        text: "<p>Binding to <code>0.0.0.0</code> means listening on every network interface. Load <code>doc</code> and set <code>exposed</code> to the names of the services whose <code>host</code> is <code>0.0.0.0</code>. Some services have no host at all.</p>",
        starter: py`
          import yaml

          doc = """
          services:
            - name: api
              host: 0.0.0.0
              port: 8080
            - name: admin
              host: 127.0.0.1
              port: 9000
            - name: metrics
              port: 9100
            - name: debugger
              host: 0.0.0.0
              port: 5678
          """

        `,
        solution: py`
          import yaml

          doc = """
          services:
            - name: api
              host: 0.0.0.0
              port: 8080
            - name: admin
              host: 127.0.0.1
              port: 9000
            - name: metrics
              port: 9100
            - name: debugger
              host: 0.0.0.0
              port: 5678
          """
          cfg = yaml.safe_load(doc)
          exposed = [s["name"] for s in cfg["services"] if s.get("host") == "0.0.0.0"]
        `,
        check: py`
          def check(ns, out, run, src):
              return H.vars(ns, src, run, {"exposed": ["api", "debugger"]},
                            [(r"host: 127\.0\.0\.1", "host: 0.0.0.0", {"exposed": ["api", "admin", "debugger"]}, "admin bound to 0.0.0.0")])
        `
      }
    ],

    "py-116": [
      {
        id: "d1", title: "Certificate expiry",
        text: "<p>Set <code>days_left</code> to the number of days from <code>TODAY</code> until <code>expires</code>, then print <code>Certificate expires in 21 days</code>.</p>",
        starter: py`
          from datetime import date

          TODAY = date(2026, 11, 10)
          expires = "2026-12-01"

        `,
        solution: py`
          from datetime import date

          TODAY = date(2026, 11, 10)
          expires = "2026-12-01"
          days_left = (date.fromisoformat(expires) - TODAY).days
          print(f"Certificate expires in {days_left} days")
        `,
        check: py`
          def check(ns, out, run, src):
              r = H.expect(ns, "days_left", 21, int)
              if r is not True:
                  return r
              return H.values(src, run, r"expires\s*=\s*\"[^\"]*\"", 'expires = "%s"', [("2027-01-10", "Certificate expires in 61 days")])
        `
      },
      {
        id: "d2", title: "Top talkers",
        text: "<p>Use <code>Counter</code> to set <code>top</code> to the two IPs that appear most often in <code>requests</code>, as (ip, count) tuples.</p>",
        starter: py`
          from collections import Counter

          requests = ["10.0.0.5", "10.0.0.9", "10.0.0.5", "10.0.0.7", "10.0.0.5", "10.0.0.9"]

        `,
        solution: py`
          from collections import Counter

          requests = ["10.0.0.5", "10.0.0.9", "10.0.0.5", "10.0.0.7", "10.0.0.5", "10.0.0.9"]
          top = Counter(requests).most_common(2)
        `,
        check: py`
          def check(ns, out, run, src):
              return H.vars(ns, src, run, {"top": [("10.0.0.5", 3), ("10.0.0.9", 2)]},
                            [(r"requests\s*=\s*\[[^\]]*\]", 'requests = ["a", "b", "b", "c", "c", "c"]', {"top": [("c", 3), ("b", 2)]}, "a different requests list")])
        `
      },
      {
        id: "d3", title: "Group services by team",
        text: "<p>Use <code>defaultdict(list)</code> to set <code>by_team</code>: each team → the list of its services, in list order.</p>",
        starter: py`
          from collections import defaultdict

          services = [("payments-api", "payments"), ("ledger", "payments"), ("grafana", "platform"), ("vault", "platform"), ("etl", "data")]

        `,
        solution: py`
          from collections import defaultdict

          services = [("payments-api", "payments"), ("ledger", "payments"), ("grafana", "platform"), ("vault", "platform"), ("etl", "data")]
          by_team = defaultdict(list)
          for name, team in services:
              by_team[team].append(name)
        `,
        check: py`
          def check(ns, out, run, src):
              got = ns.get("by_team")
              want = {"payments": ["payments-api", "ledger"], "platform": ["grafana", "vault"], "data": ["etl"]}
              if not isinstance(got, dict):
                  return "I can't find a by_team dict yet."
              if dict(got) != want:
                  return "by_team should be " + H.short(want, 160) + ", but it's " + H.short(dict(got), 160) + "."
              new = H.sub(src, r"services\s*=\s*\[[^\n]*\]", 'services = [("a", "x"), ("b", "y"), ("c", "x")]')
              if new:
                  n, o, e = run(new)
                  if dict(n.get("by_team") or {}) != {"x": ["a", "c"], "y": ["b"]}:
                      return "With a different services list, by_team came out wrong. Build it in a loop."
              return True
        `
      }
    ]
  };

  /* ------------------------------------------------------------------ Register */
  LABS.forEach(function (l) {
    if (!l.solution && SOLUTIONS[l.id]) l.solution = SOLUTIONS[l.id];
    l.drills = DRILLS[l.id] || [];
    T.LABS.push(l);
  });
  T.UPCOMING = T.UPCOMING.filter(function (row) { return row.module !== 2; });
})();
