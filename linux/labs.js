/* sudo learn — Linux track, Module 1: Shell foundations (LX-101..110). Terminal-first labs on kc-web-01.
   Checks look at the machine (files, modes, owners) and at what your commands printed; where a task asks you to
   find something, the check re-runs your exact commands on changed data, so the answer must come from a command. */
(function () {
  "use strict";
  var S = window.ShEngine, H = window.ShLab.H;
  var MAYA = "Maya Chen · SRE lead", DEV = "Dev Patel · Security", BEN = "Ben Okoro · Developer";
  var HOME = "/home/dev";

  function esc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
  function ex(cmd) { return '<pre class="ex">' + esc(cmd) + "</pre>"; }
  function code(text) { return '<pre class="code">' + esc(text) + "</pre>"; }
  function lines() { return Array.prototype.slice.call(arguments).join("\n") + "\n"; }
  function L(text) { return H.lines(text); }
  function rnd(seed) { var s = seed; return function () { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; }; }
  function pad2(n) { return (n < 10 ? "0" : "") + n; }
  var show = H.show;

  /* ---------------- data generators */
  function appLog(seed, n) {
    var r = rnd(seed), out = [], t = 8 * 3600;
    var comps = ["orders", "payments", "auth", "db", "cache", "api"];
    var info = ["request completed in %dms", "user session refreshed", "order %d created", "cache hit ratio %d%%", "health check ok", "worker %d started"];
    var warn = ["slow query took %dms", "retrying connection (attempt %d)", "disk usage at %d%%", "token expires in %d minutes"];
    var errs = ["payment gateway timeout after %dms", "database connection refused", "order %d failed validation", "upstream returned 502"];
    for (var i = 0; i < n; i++) {
      t += 1 + Math.floor(r() * 40);
      var x = r(), lvl, msg;
      if (x < 0.70) { lvl = "INFO "; msg = info[Math.floor(r() * info.length)]; }
      else if (x < 0.84) { lvl = "WARN "; msg = warn[Math.floor(r() * warn.length)]; }
      else if (x < 0.95) { lvl = "ERROR"; msg = errs[Math.floor(r() * errs.length)]; }
      else { lvl = "INFO "; msg = "recovered after error in %d attempts"; }
      msg = msg.replace("%d", String(1 + Math.floor(r() * 900))).replace("%%", "%");
      var hh = Math.floor(t / 3600) % 24, mm = Math.floor(t / 60) % 60, ss = t % 60;
      out.push("2026-11-11 " + pad2(hh) + ":" + pad2(mm) + ":" + pad2(ss) + " " + lvl + " [" + comps[Math.floor(r() * comps.length)] + "] " + msg);
    }
    return out;
  }
  // An access log with exact request counts per IP (so the "top" lists have no ties).
  function accessLog(seed, counts, extra) {
    var r = rnd(seed), rows = [];
    var paths = [["/", 200], ["/index.html", 200], ["/api/orders", 200], ["/api/orders/7731", 200], ["/assets/app.css", 200], ["/assets/app.js", 200], ["/login", 200], ["/api/health", 200], ["/favicon.ico", 404], ["/api/orders/9999", 404], ["/api/payments", 500], ["/old-page", 404]];
    var agents = ["Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36", "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6) AppleWebKit/605.1.15 Safari/605.1.15", "curl/8.5.0"];
    Object.keys(counts).forEach(function (ip) { for (var k = 0; k < counts[ip]; k++) { var p = paths[Math.floor(r() * paths.length)]; rows.push({ ip: ip, path: p[0], status: p[1], agent: ip === "10.20.0.8" ? "kestrel-monitor/2.1" : agents[Math.floor(r() * agents.length)], k: r() }); } });
    (extra || []).forEach(function (e) { rows.push(Object.assign({ k: r(), agent: "Mozilla/5.0 (compatible; Nmap Scripting Engine; https://nmap.org/book/nse.html)" }, e)); });
    rows.sort(function (a, b) { return a.k - b.k; });
    var t = Date.UTC(2026, 10, 11, 0, 0, 0);
    return rows.map(function (row) { t += 20000 + Math.floor(r() * 160000); return S.gen.logLine(row.ip, t, row.method || "GET", row.path, row.status, row.status === 200 ? 400 + Math.floor(r() * 9000) : 162, row.agent); });
  }
  function absOut(e, line) { return line.charAt(0) === "/" ? S.normAbs(line) : S.normAbs(e.cwdBefore + "/" + line); }
  function numIn(e) { var m = /^\s*(\d+)/.exec(e.out.length === 1 ? e.out[0] : ""); return m ? +m[1] : null; }
  function lsOrder(names) { return names.slice().sort(S.sortNames); }
  // The answer must have come from a command: re-run on the alternative data and compare again.
  function prove(r, wantFn, alt, opts, msgNone, msgAlt) {
    var p = H.proves(r, wantFn, alt, opts);
    if (p.ok) return true;
    return p.reason === "alt" ? msgAlt : msgNone;
  }

  var LABS = [];

  /* ================================================================== LX-101 */
  LABS.push({
    id: "lx-101", n: 1, module: 1, ticket: "LX-101", xp: 100,
    title: "Find your way around",
    topic: "pwd, ls, cd, paths, man",
    from: MAYA,
    story: "<p>Welcome to the team! You have an account on <code>kc-web-01</code>, the Ubuntu server that runs our website. Nothing to fix today: just log in, look around, and learn how to get from one place to another.</p>",
    learn:
      "<h3>The prompt</h3><p><code>dev@kc-web-01:~$</code> tells you who you are (<b>dev</b>), which machine (<b>kc-web-01</b>), and where you are (<b>~</b>, your home folder). <code>$</code> means a normal user; <code>#</code> means root, the all-powerful administrator.</p>" +
      "<h3>Where am I? What's here?</h3>" + ex("pwd") + ex("ls") +
      "<p><code>pwd</code> prints the working directory. <code>ls</code> lists it. Options change what a command does: <code>-a</code> also shows hidden files (names starting with a dot, like <code>.bashrc</code>), <code>-l</code> shows the long format with permissions, owner, size and date, and <code>-h</code> makes sizes human-readable. Combine them: <code>ls -lah</code>.</p>" +
      ex("ls -la") +
      "<h3>Moving around</h3><p>Linux has one tree of folders starting at <code>/</code> (\"root\"). There are no drive letters.</p>" +
      '<table class="t"><tr><th>Path</th><th>Means</th></tr><tr><td><code>/var/log</code></td><td><b>absolute</b>: starts at <code>/</code>, works from anywhere</td></tr><tr><td><code>logs/app.log</code></td><td><b>relative</b>: from where you are now</td></tr><tr><td><code>.</code> / <code>..</code></td><td>this folder / the parent folder</td></tr><tr><td><code>~</code></td><td>your home, <code>/home/dev</code></td></tr></table>' +
      ex("cd /var/log\nls") +
      "<p><code>cd</code> on its own takes you home. <code>cd -</code> jumps back to the previous folder. Press <b>Tab</b> to complete names: type <code>cd /va</code> and Tab.</p>" +
      "<h3>Getting help</h3><p><code>man ls</code> shows the manual page; <code>ls --help</code> a shorter summary.</p>" +
      '<table class="t"><tr><th>Folder</th><th>What lives there</th></tr><tr><td><code>/etc</code></td><td>configuration files</td></tr><tr><td><code>/var/log</code></td><td>logs</td></tr><tr><td><code>/home</code></td><td>users\' home folders</td></tr><tr><td><code>/usr/bin</code></td><td>programs (commands)</td></tr><tr><td><code>/tmp</code></td><td>temporary files, cleared at reboot</td></tr><tr><td><code>/root</code></td><td>root\'s home</td></tr></table>',
    files: { "README.txt": "Welcome to kc-web-01, dev!\nThe website lives in /var/www/kestrel.\nIts logs are in /var/log/nginx.\n", "notes/todo.txt": "learn the terminal\n" },
    starter: "",
    objectives: [
      {
        id: "pwd", text: "Show which folder you start in (it's your home, <code>/home/dev</code>).",
        hints: ["There's a three-letter command for \"print working directory\".", "pwd"],
        check: function (r) { return r.ran(/^\s*pwd\s*$/).some(function (e) { return e.out[0] === HOME; }) ? true : "Run pwd while you're in your home folder."; }
      },
      {
        id: "hidden", text: "List everything in your home folder, <b>including hidden files</b> (you should see <code>.bashrc</code> and <code>README.txt</code>).",
        hints: ["ls hides names starting with a dot. Which option shows all?", "ls -a"],
        check: function (r) {
          var hit = r.history.some(function (e) { return /^\s*(ls|ll|la|dir)\b/.test(e.cmd) && e.out.join(" ").indexOf(".bashrc") >= 0 && e.out.join(" ").indexOf("README.txt") >= 0; });
          return hit ? true : "List your home folder with an option that also shows hidden files (the ones starting with a dot).";
        }
      },
      {
        id: "long", text: "Go to <code>/var/log/nginx</code> and list it in <b>long format</b>, so you can see who owns <code>access.log</code> and how big it is.",
        hints: ["cd /var/log/nginx, then ls with the long-format option.", "cd /var/log/nginx\nls -l"],
        check: function (r) {
          var hit = r.history.some(function (e) { return /^\s*(ls|ll)\b/.test(e.cmd) && e.out.some(function (l) { return /^-rw-r----- 1 www-data adm\s+\S+ .* access\.log$/.test(l); }); });
          if (!hit) return "List /var/log/nginx with ls -l: the line for access.log shows its permissions, owner (www-data), group (adm) and size.";
          return r.history.some(function (e) { return e.cwd === "/var/log/nginx"; }) ? true : "Use cd to go into /var/log/nginx (don't just list it from elsewhere).";
        }
      },
      {
        id: "rel", text: "From <code>/var/log/nginx</code>, move to <code>/var/www/kestrel</code> using a <b>relative</b> path (one that starts with <code>..</code>).",
        hints: ["/var/log/nginx is two levels below /var. Go up twice with ../../, then down into www/kestrel.", "cd ../../www/kestrel"],
        check: function (r) {
          var ok = r.history.some(function (e) { return /^\s*cd\s+\.\./.test(e.cmd) && e.cwdBefore === "/var/log/nginx" && e.cwd === "/var/www/kestrel"; });
          return ok ? true : "While in /var/log/nginx, run one cd whose path starts with .. and lands in /var/www/kestrel.";
        }
      }
    ],
    solution: lines("pwd", "ls -a", "cd /var/log/nginx", "ls -l", "cd ../../www/kestrel"),
    debrief: "<p>Ticket closed. You can now answer the three questions you'll ask a hundred times a day: where am I (<code>pwd</code>), what's here (<code>ls</code>), and how do I get there (<code>cd</code>). Absolute paths work from anywhere; relative ones save typing.</p>",
    realworld: "On any Linux or Mac terminal (or WSL on Windows): run pwd, ls -la ~ and cd /etc && ls. Try Tab completion and the ↑ key to recall commands.",
    quiz: [
      { q: "What does the <code>~</code> in <code>dev@kc-web-01:~$</code> mean?", options: ["The root folder", "Your home folder", "The previous folder", "A temporary folder"], answer: 1, why: "~ is /home/dev for the user dev." },
      { q: "Which path is absolute?", options: ["logs/app.log", "../www", "/var/log/nginx", "./notes"], answer: 2, why: "Absolute paths start with /." },
      { q: "Why doesn't <code>ls</code> show <code>.bashrc</code>?", options: ["It's protected", "Names starting with a dot are hidden unless you use -a", "It's in another folder", "It's empty"], answer: 1, why: "Dotfiles are hidden by convention, mostly settings." }
    ]
  });

  /* ================================================================== LX-102 */
  var INBOX = {
    "inbox/report-2026-11-01.csv": "date,orders\n2026-11-01,1342\n", "inbox/report-2026-11-08.csv": "date,orders\n2026-11-08,1519\n",
    "inbox/invoice-7731.pdf": "%PDF-1.7 (invoice)\n", "inbox/notes.txt": "Ask Maya about the backup folder.\n",
    "inbox/tmp/a.tmp": "x\n", "inbox/tmp/b.tmp": "y\n", "inbox/tmp/cache/c.tmp": "z\n"
  };
  var K = HOME + "/projects/kestrel";
  LABS.push({
    id: "lx-102", n: 2, module: 1, ticket: "LX-102", xp: 100,
    title: "Tidy up your home folder",
    topic: "mkdir, cp, mv, rm, wildcards",
    from: MAYA,
    story: "<p>Your <code>~/inbox</code> is a mess of reports and temp files. Set up a proper project folder for the Kestrel work, back up the web server's config there, file the reports and clear the junk.</p>" +
      '<div class="callout warn">Careful with <code>rm</code>: Linux has no recycle bin. Deleted means gone.</div>',
    learn:
      "<h3>Making things</h3>" + ex("mkdir projects\ntouch projects/empty.txt\nls projects") +
      "<p><code>mkdir -p a/b/c</code> creates every missing folder along the way (and doesn't complain if they exist). Braces type several names at once: <code>mkdir -p site/{css,js,img}</code> makes three folders.</p>" +
      "<h3>Copying, moving, renaming</h3>" +
      '<table class="t"><tr><th>Command</th><th>Does</th></tr><tr><td><code>cp src dest</code></td><td>copy a file (to a new name, or into a folder)</td></tr><tr><td><code>cp -r src dest</code></td><td>copy a folder and everything in it</td></tr><tr><td><code>mv src dest</code></td><td>move, or rename (same command)</td></tr><tr><td><code>rm file</code></td><td>delete a file</td></tr><tr><td><code>rm -r folder</code></td><td>delete a folder and everything in it</td></tr><tr><td><code>rmdir folder</code></td><td>delete an <i>empty</i> folder</td></tr></table>' +
      "<h3>Wildcards</h3><p>The shell expands patterns into matching names before the command runs: <code>*</code> means any text, <code>?</code> one character, <code>[0-9]</code> one of a set. So <code>mv *.csv reports/</code> moves every CSV file. Check first with <code>ls *.csv</code>: that shows exactly what the pattern matches.</p>" +
      ex("ls inbox/*.csv"),
    files: INBOX,
    starter: "",
    objectives: [
      {
        id: "dirs", text: "Create <code>~/projects/kestrel/logs</code>, <code>~/projects/kestrel/scripts</code> and <code>~/projects/kestrel/backup</code>.",
        hints: ["mkdir -p creates the missing parent folders too.", "mkdir -p ~/projects/kestrel/{logs,scripts,backup}"],
        check: function (r) {
          var miss = ["logs", "scripts", "backup"].filter(function (d) { return !r.isDir(K + "/" + d); });
          return miss.length ? "Still missing: " + miss.map(function (d) { return "~/projects/kestrel/" + d; }).join(", ") : true;
        }
      },
      {
        id: "copy", text: "Copy <code>/etc/nginx/nginx.conf</code> into the backup folder as <code>nginx.conf.bak</code>.",
        hints: ["cp SOURCE DESTINATION; the destination can include the new name.", "cp /etc/nginx/nginx.conf ~/projects/kestrel/backup/nginx.conf.bak"],
        check: function (r) {
          var c = r.read(K + "/backup/nginx.conf.bak");
          if (c === null) return "There's no ~/projects/kestrel/backup/nginx.conf.bak yet.";
          return c === r.read("/etc/nginx/nginx.conf") ? true : "nginx.conf.bak should be an exact copy of /etc/nginx/nginx.conf.";
        }
      },
      {
        id: "move", text: "Move <b>every</b> <code>.csv</code> file from <code>~/inbox</code> into a new folder <code>~/projects/kestrel/reports</code>.",
        hints: ["Create reports first, then use a wildcard: *.csv", "mkdir ~/projects/kestrel/reports\nmv ~/inbox/*.csv ~/projects/kestrel/reports/"],
        check: function (r) {
          var want = ["report-2026-11-01.csv", "report-2026-11-08.csv"];
          var got = r.list(K + "/reports").filter(function (n) { return /\.csv$/.test(n); });
          if (!H.same(got, want)) return "~/projects/kestrel/reports should hold both report CSVs. It has: " + show(got);
          if (r.list(HOME + "/inbox").some(function (n) { return /\.csv$/.test(n); })) return "There are still .csv files in ~/inbox: move them, don't copy.";
          var r2 = r.run(null, { files: { "inbox/report-2026-11-15.csv": "date,orders\n2026-11-15,1610\n" } });
          return r2.list(K + "/reports").indexOf("report-2026-11-15.csv") >= 0 ? true : "When the inbox had a third CSV, it wasn't moved. Use a wildcard (*.csv) instead of naming each file.";
        }
      },
      {
        id: "clean", text: "Delete <code>~/inbox/tmp</code> and everything inside it, but nothing else.",
        hints: ["rm alone refuses folders. Add the option for recursive.", "rm -r ~/inbox/tmp"],
        check: function (r) {
          if (r.exists(HOME + "/inbox/tmp")) return "~/inbox/tmp still exists.";
          var keep = ["invoice-7731.pdf", "notes.txt"].filter(function (n) { return !r.exists(HOME + "/inbox/" + n); });
          return keep.length ? "Oops: " + keep.join(", ") + " should still be in ~/inbox." : true;
        }
      }
    ],
    solution: lines("mkdir -p ~/projects/kestrel/{logs,scripts,backup}", "cp /etc/nginx/nginx.conf ~/projects/kestrel/backup/nginx.conf.bak", "mkdir ~/projects/kestrel/reports", "mv ~/inbox/*.csv ~/projects/kestrel/reports/", "rm -r ~/inbox/tmp"),
    debrief: "<p>Ticket closed. Folders created in one go, a config backed up before anyone touches it (a habit worth keeping), reports filed with a wildcard and the junk gone. Wildcards plus <code>rm -r</code> are powerful: look before you leap with <code>ls</code> first.</p>",
    realworld: "Before editing any config file on a server, copy it: cp nginx.conf nginx.conf.bak-$(date +%F). If your change breaks something, you have the original.",
    quiz: [
      { q: "What does <code>mkdir -p a/b/c</code> do if <code>a</code> doesn't exist?", options: ["Fails", "Creates a, a/b and a/b/c", "Creates only c", "Asks you"], answer: 1, why: "-p creates parents as needed." },
      { q: "How do you rename <code>old.txt</code> to <code>new.txt</code>?", options: ["rename old.txt new.txt", "mv old.txt new.txt", "cp old.txt new.txt", "rm old.txt new.txt"], answer: 1, why: "Moving to a new name in the same folder is a rename." },
      { q: "Who expands <code>*.csv</code> into file names?", options: ["mv", "The shell, before the command runs", "The file system", "Nobody"], answer: 1, why: "That's why ls *.csv previews exactly what mv *.csv will touch." }
    ]
  });

  /* ================================================================== LX-103 */
  var APP = appLog(11, 500).join("\n") + "\n", APP_ALT = appLog(97, 437).join("\n") + "\n";
  LABS.push({
    id: "lx-103", n: 3, module: 1, ticket: "LX-103", xp: 100,
    title: "Read the logs",
    topic: "cat, less, head, tail, wc",
    from: MAYA,
    story: "<p>The Kestrel app writes to <code>~/logs/app.log</code>. Before you can find problems in it, get comfortable looking at it: the start, the end, how big it is, and a slice from the middle.</p>",
    learn:
      "<h3>Reading files</h3>" +
      '<table class="t"><tr><th>Command</th><th>Shows</th></tr><tr><td><code>cat file</code></td><td>the whole file at once</td></tr><tr><td><code>less file</code></td><td>one screen at a time (Space, b, /search, q)</td></tr><tr><td><code>head file</code></td><td>the first 10 lines; <code>-n 5</code> for 5</td></tr><tr><td><code>tail file</code></td><td>the last 10 lines; <code>-n 20</code> for 20</td></tr><tr><td><code>tail -f file</code></td><td>the end, then keeps printing new lines (Ctrl+C stops)</td></tr><tr><td><code>wc -l file</code></td><td>how many lines (<code>-w</code> words, <code>-c</code> bytes)</td></tr></table>' +
      ex("head -n 3 ~/logs/app.log") + ex("wc -l ~/logs/app.log") +
      "<p>For a slice from the middle, chain two commands with a pipe <code>|</code> (more on pipes in LX-105): <code>head -n 20 file | tail -n 5</code> takes the first 20 lines and keeps the last 5 of those, i.e. lines 16 to 20.</p>" +
      '<div class="callout"><code>tail -f</code> is how you watch a live log while you test something. In this lab\'s terminal it shows the current end and stops.</div>',
    files: { "logs/app.log": APP },
    starter: "",
    objectives: [
      {
        id: "head", text: "Show the <b>first 5 lines</b> of <code>~/logs/app.log</code>.",
        hints: ["head shows the first lines; -n sets how many.", "head -n 5 ~/logs/app.log"],
        check: function (r) { return prove(r, function (x) { return L(x.read("logs/app.log")).slice(0, 5); }, { files: { "logs/app.log": APP_ALT } }, null, "Print exactly the first 5 lines of ~/logs/app.log.", "Use head, don't paste the lines: when the log changed, your command didn't follow."); }
      },
      {
        id: "tail", text: "Show the <b>last 15 lines</b>.",
        hints: ["tail -n 15 ~/logs/app.log"],
        check: function (r) { return prove(r, function (x) { return L(x.read("logs/app.log")).slice(-15); }, { files: { "logs/app.log": APP_ALT } }, null, "Print exactly the last 15 lines of ~/logs/app.log.", "Use tail on the file: when the log changed, your command didn't follow."); }
      },
      {
        id: "count", text: "Count how many lines the log has.",
        hints: ["wc counts; -l counts lines only.", "wc -l ~/logs/app.log"],
        check: function (r) {
          var n = L(r.read("logs/app.log")).length;
          var idx = -1;
          r.history.forEach(function (e, i) { if (/\bwc\b/.test(e.cmd) && numIn(e) === n) idx = i; });
          if (idx < 0) return "Use wc to count the lines of ~/logs/app.log (it has " + (n > 100 ? "a few hundred" : "some") + ").";
          var r2 = r.run(null, { files: { "logs/app.log": APP_ALT } });
          return numIn(r2.history[idx]) === L(APP_ALT).length ? true : "Count with wc -l on the file itself.";
        }
      },
      {
        id: "slice", text: "Show only lines <b>101 to 105</b>.",
        hints: ["Take the first 105 lines, then keep the last 5 of them.", "head -n 105 ~/logs/app.log | tail -n 5"],
        check: function (r) { return prove(r, function (x) { return L(x.read("logs/app.log")).slice(100, 105); }, { files: { "logs/app.log": APP_ALT } }, null, "Print exactly lines 101 to 105 (5 lines).", "Combine head and tail on the file instead of pasting lines."); }
      }
    ],
    solution: lines("head -n 5 ~/logs/app.log", "tail -n 15 ~/logs/app.log", "wc -l ~/logs/app.log", "head -n 105 ~/logs/app.log | tail -n 5"),
    debrief: "<p>Ticket closed. <code>head</code>, <code>tail</code> and <code>wc</code> are the first things to run on any unknown file: how does it start, how does it end, how big is it. On a real server, <code>tail -f</code> on a log while you reproduce a bug is one of the most useful habits you can have.</p>",
    realworld: "On a Linux box: sudo tail -f /var/log/syslog, then open another terminal and run logger hello. Your message appears in the first one.",
    quiz: [
      { q: "How do you see the last 50 lines of <code>app.log</code>?", options: ["head -n 50 app.log", "tail -n 50 app.log", "cat -50 app.log", "wc -l 50 app.log"], answer: 1, why: "tail = end, head = start." },
      { q: "What does <code>tail -f</code> add?", options: ["Faster output", "Keeps printing new lines as they're written", "Shows the first lines", "Filters errors"], answer: 1, why: "f = follow." },
      { q: "In <code>less</code>, how do you quit?", options: ["Ctrl+Q", "q", "exit", "Esc"], answer: 1, why: "q quits less, man and many other full-screen tools." }
    ]
  });

  /* ================================================================== LX-104 */
  var BACKUPS = {
    "backups/db-2026-09-01.sql.gz": { content: "gz", ageDays: 71 }, "backups/db-2026-10-01.sql.gz": { content: "gz", ageDays: 41 },
    "backups/db-2026-10-20.sql.gz": { content: "gz", ageDays: 22 }, "backups/db-2026-11-10.sql.gz": { content: "gz", ageDays: 1 },
    "backups/site-2026-09-15.tar.gz": { content: "tgz", ageDays: 57 }, "backups/README": { content: "Nightly backups\n", ageDays: 120 }
  };
  var CONFIGS = {
    "configs/app.ini": "[server]\nlisten 8080\ntimeout = 30\n", "configs/admin.ini": "[server]\nlisten 9090\n", "configs/legacy/old-app.ini": "[server]\nlisten 8080\nworkers = 2\n",
    "configs/notes.md": "We moved off port 8080 last year.\n", "configs/proxy.ini": "upstream = 127.0.0.1\nlisten  8080\n"
  };
  function findCheck(r, wantAbs, re, msg) {
    var ok = r.history.some(function (e) { if (!re.test(e.cmd) || !e.out.length) return false; var got = e.out.map(function (l) { return absOut(e, l); }).sort(); return H.same(got, wantAbs.slice().sort()); });
    return ok ? true : msg;
  }
  LABS.push({
    id: "lx-104", n: 4, module: 1, ticket: "LX-104", xp: 100,
    title: "Find it fast",
    topic: "grep and find",
    from: MAYA,
    story: "<p>The app had a rough night. Pull the errors out of the log, count the warnings, and while you're at it: find the old backups we can archive and the config files still pointing at port 8080.</p>",
    learn:
      "<h3>grep: search inside files</h3>" + ex("grep ERROR ~/logs/app.log | head -n 3") +
      '<table class="t"><tr><th>Option</th><th>Effect</th></tr><tr><td><code>-i</code></td><td>ignore case (ERROR, error, Error)</td></tr><tr><td><code>-c</code></td><td>count matching lines instead of printing them</td></tr><tr><td><code>-n</code></td><td>show line numbers</td></tr><tr><td><code>-v</code></td><td>lines that do <i>not</i> match</td></tr><tr><td><code>-r</code></td><td>search a whole folder tree</td></tr><tr><td><code>-l</code></td><td>just the names of files that match</td></tr><tr><td><code>-w</code></td><td>whole words only</td></tr></table>' +
      "<p>Put the pattern in quotes when it has spaces or special characters: <code>grep -r \"listen 8080\" configs</code>. Patterns are <b>regular expressions</b>: <code>^#</code> means a line starting with #, <code>\\.log$</code> ending with .log.</p>" +
      "<h3>find: search for files by name, type, age, size</h3>" + ex("find /etc/nginx -name \"*.conf\"") +
      '<table class="t"><tr><th>Test</th><th>Matches</th></tr><tr><td><code>-name \"*.log\"</code></td><td>file names (quote the pattern!)</td></tr><tr><td><code>-type f</code> / <code>-type d</code></td><td>files / folders</td></tr><tr><td><code>-mtime +30</code></td><td>modified more than 30 days ago (<code>-7</code>: less than 7)</td></tr><tr><td><code>-size +100k</code></td><td>bigger than 100 KB (<code>M</code>, <code>G</code>)</td></tr><tr><td><code>-user ana</code></td><td>owned by ana</td></tr></table>' +
      "<p>Tests combine: <code>find ~/backups -type f -name \"*.gz\" -mtime +30</code>.</p>",
    files: Object.assign({ "logs/app.log": APP }, BACKUPS, CONFIGS),
    starter: "",
    objectives: [
      {
        id: "errors", text: "Show every line of <code>~/logs/app.log</code> that contains <b>error</b> in any capitalization (<code>ERROR</code> and <code>error</code>).",
        hints: ["grep with the option that ignores case.", "grep -i error ~/logs/app.log"],
        check: function (r) { return prove(r, function (x) { return L(x.read("logs/app.log")).filter(function (l) { return /error/i.test(l); }); }, { files: { "logs/app.log": APP_ALT } }, null, "Print exactly the lines containing error (any case): ERROR lines and the INFO lines that mention \"error\".", "Run grep on the file: when the log changed, your output didn't."); }
      },
      {
        id: "count", text: "Count the <code>WARN</code> lines (just the number).",
        hints: ["grep has an option that counts instead of printing.", "grep -c WARN ~/logs/app.log"],
        check: function (r) {
          var n = L(r.read("logs/app.log")).filter(function (l) { return /WARN/.test(l); }).length;
          var idx = -1;
          r.history.forEach(function (e, i) { if (/\bgrep\b/.test(e.cmd) && e.out.length === 1 && e.out[0].trim() === String(n)) idx = i; });
          if (idx < 0) return "Print the number of WARN lines with grep (one number).";
          var r2 = r.run(null, { files: { "logs/app.log": APP_ALT } });
          var n2 = L(APP_ALT).filter(function (l) { return /WARN/.test(l); }).length;
          return r2.history[idx].out[0] && r2.history[idx].out[0].trim() === String(n2) ? true : "Count with grep on the file.";
        }
      },
      {
        id: "conf", text: "List every <code>.conf</code> file anywhere under <code>/etc/nginx</code>.",
        hints: ["find START -name PATTERN (quote the pattern)", "find /etc/nginx -name \"*.conf\""],
        check: function (r) { return findCheck(r, ["/etc/nginx/conf.d/security-headers.conf", "/etc/nginx/nginx.conf"], /^\s*find\b/, "Use find on /etc/nginx to list all .conf files (there are 2, one in a sub-folder)."); }
      },
      {
        id: "old", text: "List the files in <code>~/backups</code> that were modified <b>more than 30 days ago</b>.",
        hints: ["find with -mtime +30 (and -type f to skip folders)", "find ~/backups -type f -mtime +30"],
        check: function (r) { return findCheck(r, ["db-2026-09-01.sql.gz", "db-2026-10-01.sql.gz", "site-2026-09-15.tar.gz", "README"].map(function (n) { return HOME + "/backups/" + n; }), /^\s*find\b/, "Use find with -mtime on ~/backups: 4 files are older than 30 days."); }
      },
      {
        id: "port", text: "Show the <b>names</b> of the files under <code>~/configs</code> (all sub-folders) that contain <code>listen 8080</code>.",
        hints: ["grep -r searches folders, -l prints only file names. Quote the pattern (it has a space).", "grep -rl \"listen 8080\" ~/configs"],
        check: function (r) { return findCheck(r, [HOME + "/configs/app.ini", HOME + "/configs/legacy/old-app.ini"], /\bgrep\b/, "Use grep recursively with -l to print just the names of files containing \"listen 8080\" (2 files; proxy.ini has two spaces, so it doesn't match)."); }
      }
    ],
    solution: lines("grep -i error ~/logs/app.log", "grep -c WARN ~/logs/app.log", "find /etc/nginx -name \"*.conf\"", "find ~/backups -type f -mtime +30", "grep -rl \"listen 8080\" ~/configs"),
    debrief: "<p>Ticket closed. <code>grep</code> answers \"which lines?\", <code>find</code> answers \"which files?\". Together they're how you find your way through a server you've never seen: every config, log and leftover is one search away.</p>",
    realworld: "On a real box: grep -rn \"PasswordAuthentication\" /etc/ssh and find /var/log -name \"*.gz\" -mtime +30. Add 2>/dev/null to hide permission errors (next ticket).",
    quiz: [
      { q: "Which finds lines that do NOT contain DEBUG?", options: ["grep DEBUG -n", "grep -v DEBUG", "grep -c DEBUG", "grep !DEBUG"], answer: 1, why: "-v inverts the match." },
      { q: "Why quote <code>-name \"*.log\"</code>?", options: ["It's required syntax", "So the shell doesn't expand *.log in the current folder before find sees it", "To make it case-insensitive", "For speed"], answer: 1, why: "find needs the pattern itself." },
      { q: "<code>find . -mtime -7</code> finds files modified…", options: ["more than 7 days ago", "less than 7 days ago", "exactly 7 days ago", "7 minutes ago"], answer: 1, why: "-7 = less than, +7 = more than." }
    ]
  });

  /* ================================================================== LX-105 */
  function varLogNames(r) { return lsOrder(r.list("/var/log")); }
  LABS.push({
    id: "lx-105", n: 5, module: 1, ticket: "LX-105", xp: 100,
    title: "Plumbing",
    topic: "Pipes and redirection: | > >> 2> /dev/null tee",
    from: MAYA,
    story: "<p>Small commands, connected, do big jobs. Save command output to files, add to them, silence the noise, and chain commands with pipes. These are the skills every later ticket builds on.</p>",
    learn:
      "<h3>Three streams</h3><p>Every command has an input (<b>stdin</b>), an output (<b>stdout</b>) and a separate channel for error messages (<b>stderr</b>). By default both outputs go to your screen.</p>" +
      '<table class="t"><tr><th>Syntax</th><th>Does</th></tr><tr><td><code>cmd &gt; file</code></td><td>write stdout to a file (replaces it!)</td></tr><tr><td><code>cmd &gt;&gt; file</code></td><td>append stdout to the end of a file</td></tr><tr><td><code>cmd 2&gt; file</code></td><td>write errors to a file</td></tr><tr><td><code>cmd 2&gt;/dev/null</code></td><td>throw errors away (<code>/dev/null</code> swallows everything)</td></tr><tr><td><code>cmd &gt; file 2&gt;&amp;1</code></td><td>both into the same file</td></tr><tr><td><code>cmd &lt; file</code></td><td>read stdin from a file</td></tr><tr><td><code>cmd1 | cmd2</code></td><td>pipe: cmd1\'s output becomes cmd2\'s input</td></tr><tr><td><code>cmd | tee file</code></td><td>show it <i>and</i> save it</td></tr></table>' +
      ex("ls /var/log > ~/list.txt\ncat ~/list.txt") +
      ex("grep ERROR ~/logs/app.log | wc -l") +
      '<div class="callout warn"><code>&gt;</code> empties the file before writing. One wrong <code>&gt;</code> instead of <code>&gt;&gt;</code> erases a file.</div>',
    files: { "logs/app.log": APP },
    starter: "",
    objectives: [
      {
        id: "save", text: "Save the list of names in <code>/var/log</code> (one per line) to <code>~/logfiles.txt</code>.",
        hints: ["ls writes one name per line when its output goes to a file. Redirect with >.", "ls /var/log > ~/logfiles.txt"],
        check: function (r) {
          var c = r.read("logfiles.txt");
          if (c === null) return "There's no ~/logfiles.txt yet.";
          var first = L(c).slice(0, varLogNames(r).length);
          return H.same(first, varLogNames(r)) ? true : "~/logfiles.txt should start with the names in /var/log, one per line (ls /var/log > ~/logfiles.txt).";
        }
      },
      {
        id: "append", text: "Add the current date and time (the output of <code>date</code>) as the <b>last line</b> of <code>~/logfiles.txt</code>, keeping the list.",
        hints: [">> appends instead of replacing.", "date >> ~/logfiles.txt"],
        check: function (r) {
          var ls = L(r.read("logfiles.txt") || "");
          var n = varLogNames(r).length;
          if (ls.length < n || !H.same(ls.slice(0, n), varLogNames(r))) return "The list of /var/log names was lost: use >> to append, not >.";
          return ls[ls.length - 1] === "Wed Nov 11 09:00:00 UTC 2026" ? true : "The last line should be the output of date.";
        }
      },
      {
        id: "quiet", text: "Find every file named <code>*.log</code> on the whole system (start at <code>/</code>), <b>without</b> the \"Permission denied\" messages.",
        hints: ["Errors go to stderr (2). Send them to /dev/null.", "find / -name \"*.log\" 2>/dev/null"],
        check: function (r) {
          var ok = r.history.some(function (e) { return /^\s*find\s+\/(\s|$)/.test(e.cmd) && e.out.indexOf("/var/log/nginx/access.log") >= 0 && e.out.indexOf("/var/log/syslog") < 0 && !e.err.length; });
          return ok ? true : "Run find / -name \"*.log\" with the errors (stream 2) redirected to /dev/null, so only file names appear.";
        }
      },
      {
        id: "pipe", text: "Count the <code>ERROR</code> lines of <code>~/logs/app.log</code> with a <b>pipe</b> into <code>wc -l</code>.",
        hints: ["grep finds the lines, wc -l counts them.", "grep ERROR ~/logs/app.log | wc -l"],
        check: function (r) {
          var n = L(r.read("logs/app.log")).filter(function (l) { return /ERROR/.test(l); }).length;
          var idx = -1;
          r.history.forEach(function (e, i) { if (/\|\s*wc\s+-l/.test(e.cmd) && numIn(e) === n) idx = i; });
          if (idx < 0) return "Pipe grep's output into wc -l.";
          var r2 = r.run(null, { files: { "logs/app.log": APP_ALT } });
          return numIn(r2.history[idx]) === L(APP_ALT).filter(function (l) { return /ERROR/.test(l); }).length ? true : "Count the real ERROR lines.";
        }
      },
      {
        id: "tee", text: "Show the <b>last 3</b> <code>ERROR</code> lines on screen <b>and</b> save them to <code>~/errors.txt</code> in the same command.",
        hints: ["grep | tail -n 3 | tee FILE", "grep ERROR ~/logs/app.log | tail -n 3 | tee ~/errors.txt"],
        check: function (r) {
          var want = L(r.read("logs/app.log")).filter(function (l) { return /ERROR/.test(l); }).slice(-3);
          if (!H.same(L(r.read("errors.txt") || ""), want)) return "~/errors.txt should contain exactly the last 3 ERROR lines.";
          return r.history.some(function (e) { return /\btee\b/.test(e.cmd) && H.same(e.out, want); }) ? true : "Use tee so the lines also appear on screen.";
        }
      }
    ],
    solution: lines("ls /var/log > ~/logfiles.txt", "date >> ~/logfiles.txt", "find / -name \"*.log\" 2>/dev/null", "grep ERROR ~/logs/app.log | wc -l", "grep ERROR ~/logs/app.log | tail -n 3 | tee ~/errors.txt"),
    debrief: "<p>Ticket closed. Redirection decides where output goes, pipes connect commands, <code>2&gt;/dev/null</code> keeps the screen readable and <code>tee</code> gives you both. This is the Unix idea in one sentence: small tools that do one thing, joined together.</p>",
    realworld: "Classic one-liner: du -ah /var 2>/dev/null | sort -rh | head -n 10 shows the 10 biggest things under /var.",
    quiz: [
      { q: "What's the difference between <code>&gt;</code> and <code>&gt;&gt;</code>?", options: ["None", "> replaces the file, >> adds to the end", "> is for errors", ">> is faster"], answer: 1, why: "A stray > wipes a file." },
      { q: "What does <code>2&gt;/dev/null</code> do?", options: ["Deletes errors from the disk", "Discards error messages", "Doubles output", "Saves to a file named null"], answer: 1, why: "Stream 2 is stderr; /dev/null discards whatever it receives." },
      { q: "In <code>grep x file | wc -l</code>, what does <code>wc</code> read?", options: ["file", "grep's output", "The keyboard", "Nothing"], answer: 1, why: "The pipe connects grep's stdout to wc's stdin." }
    ]
  });

  /* ================================================================== LX-106 */
  var IPC = { "192.0.2.44": 41, "198.51.100.20": 33, "10.20.0.8": 27, "203.0.113.7": 18, "198.51.100.73": 11, "192.0.2.10": 6 };
  var IPC_ALT = { "203.0.113.7": 37, "10.20.0.8": 29, "192.0.2.10": 24, "198.51.100.20": 19, "192.0.2.44": 8 };
  var ACCESS = accessLog(5, IPC).join("\n") + "\n", ACCESS_ALT = accessLog(77, IPC_ALT).join("\n") + "\n";
  var SITES = lines("http://kestrel.example.com", "http://status.kestrel.example.com/health", "https://docs.kestrel.example.com", "http://api.kestrel.example.com/v1");
  var SITES_ALT = lines("http://a.example.org/x", "ftp://files.example.org", "http://b.example.org http://c.example.org");
  function fields(line) { return line.trim().split(/\s+/); }
  function topIps(text, n) {
    var c = {};
    L(text).forEach(function (l) { var ip = fields(l)[0]; c[ip] = (c[ip] || 0) + 1; });
    return Object.keys(c).sort(function (a, b) { return c[b] - c[a]; }).slice(0, n).map(function (ip) { return c[ip] + " " + ip; });
  }
  function bashUsers(text) { return L(text).filter(function (l) { return /:\/bin\/bash$/.test(l); }).map(function (l) { return l.split(":")[0]; }); }
  LABS.push({
    id: "lx-106", n: 6, module: 1, ticket: "LX-106", xp: 100,
    title: "Slice and dice text",
    topic: "cut, sort, uniq, tr, sed, awk",
    from: DEV,
    story: "<p>Security asks a lot of \"who\" and \"how many\" questions about logs. With a handful of text tools you can answer them in one line each, no spreadsheet needed. The web server log is copied to <code>~/logs/access.log</code>.</p>",
    learn:
      "<h3>One log line</h3>" + code('192.0.2.44 - - [11/Nov/2026:00:03:12 +0000] "GET /api/orders HTTP/1.1" 200 4417 "-" "Mozilla/5.0 ..."\n$1          $4                          $6   $7          $8        $9  $10') +
      "<p>Split on spaces, the client IP is field 1, the path field 7, the status field 9, the size field 10.</p>" +
      '<table class="t"><tr><th>Tool</th><th>Typical use</th></tr>' +
      "<tr><td><code>cut -d' ' -f1</code></td><td>take field 1, splitting on spaces (<code>-d:</code> for files like /etc/passwd)</td></tr>" +
      "<tr><td><code>sort</code> / <code>sort -n</code> / <code>sort -r</code></td><td>sort text / numbers / reverse</td></tr>" +
      "<tr><td><code>uniq</code> / <code>uniq -c</code></td><td>remove adjacent duplicates / count them (sort first!)</td></tr>" +
      "<tr><td><code>tr 'a-z' 'A-Z'</code></td><td>translate characters</td></tr>" +
      "<tr><td><code>sed 's/old/new/g' file</code></td><td>replace text (<code>-i</code> edits the file in place)</td></tr>" +
      "<tr><td><code>awk '{print $7}'</code></td><td>print fields; <code>awk '$9 == 404'</code> filters by a field</td></tr></table>" +
      ex("cut -d' ' -f1 ~/logs/access.log | sort | uniq -c | sort -rn | head -n 3") +
      "<p>That last line is the most famous pipeline in operations: <b>count things and show the most common</b>. Read it left to right: take the IPs, sort them so duplicates sit together, count each run, sort by the count (numerically, biggest first), keep the top 3.</p>" +
      ex("awk '$9 == 500 {print $4, $7}' ~/logs/access.log | head -n 3"),
    files: { "logs/access.log": ACCESS, "sites.txt": SITES },
    starter: "",
    objectives: [
      {
        id: "ips", text: "List the <b>unique</b> client IPs (field 1) of <code>~/logs/access.log</code>, sorted, one per line.",
        hints: ["cut the first field, then sort with the unique option (or sort | uniq).", "cut -d' ' -f1 ~/logs/access.log | sort -u"],
        check: function (r) { return prove(r, function (x) { var s = {}; L(x.read("logs/access.log")).forEach(function (l) { s[fields(l)[0]] = 1; }); return Object.keys(s).sort(S.sortLines); }, { files: { "logs/access.log": ACCESS_ALT } }, null, "Print each distinct IP once, sorted (6 IPs).", "Build the list from the log with cut and sort, don't type it."); }
      },
      {
        id: "top", text: "Show the <b>top 3</b> IPs by number of requests, with their counts, busiest first.",
        hints: ["cut, sort, uniq -c, sort -rn, head", "cut -d' ' -f1 ~/logs/access.log | sort | uniq -c | sort -rn | head -n 3"],
        check: function (r) { return prove(r, function (x) { return topIps(x.read("logs/access.log"), 3); }, { files: { "logs/access.log": ACCESS_ALT } }, { norm: true }, "Print 3 lines like \"41 192.0.2.44\": count then IP, biggest first.", "When the log changed, your top 3 didn't: count from the log."); }
      },
      {
        id: "404", text: "Print the <b>path</b> (field 7) of every request that got a <code>404</code> status (field 9), in log order.",
        hints: ["awk can test a field and print another.", "awk '$9 == 404 {print $7}' ~/logs/access.log"],
        check: function (r) { return prove(r, function (x) { return L(x.read("logs/access.log")).filter(function (l) { return fields(l)[8] === "404"; }).map(function (l) { return fields(l)[6]; }); }, { files: { "logs/access.log": ACCESS_ALT } }, null, "Print one path per 404 response, in the order they appear in the log.", "Filter the real log with awk (or grep + cut)."); }
      },
      {
        id: "https", text: "In <code>~/sites.txt</code>, replace every <code>http://</code> with <code>https://</code>, changing the file itself.",
        hints: ["sed -i edits in place; s/old/new/g replaces all. The / in the pattern clashes with sed's /: use another separator like |.", "sed -i 's|http://|https://|g' ~/sites.txt"],
        check: function (r) {
          var want = SITES.replace(/http:\/\//g, "https://");
          if (r.read("sites.txt") !== want) return "~/sites.txt should have every http:// changed to https:// (and nothing else changed).";
          var r2 = r.run(null, { files: { "sites.txt": SITES_ALT } });
          return r2.read("sites.txt") === SITES_ALT.replace(/http:\/\//g, "https://") ? true : "Use sed on the file: with a different sites.txt, your command didn't produce the right result (did you replace every match on a line? add g).";
        }
      },
      {
        id: "bash", text: "From <code>/etc/passwd</code>, print the user names (field 1) of the accounts whose shell (field 7) is <code>/bin/bash</code>.",
        hints: ["Fields in /etc/passwd are separated by colons: awk -F: or cut -d:", "awk -F: '$7 == \"/bin/bash\" {print $1}' /etc/passwd"],
        check: function (r) {
          return prove(r, function (x) { return bashUsers(x.read("/etc/passwd")); }, { system: function (sys) { var n = S.lookup({ sys: sys, uid: 0, cwd: "/", groups: [] }, "/etc/passwd").node; n.content += "zed:x:1050:1050:Zed,,,:/home/zed:/bin/bash\nsftpuser:x:1051:1051::/home/sftp:/usr/sbin/nologin\n"; } }, null,
            "Print the 5 user names with /bin/bash as their shell, one per line, in file order.", "When another bash user was added, your output didn't change: filter /etc/passwd itself.");
        }
      }
    ],
    solution: lines("cut -d' ' -f1 ~/logs/access.log | sort -u", "cut -d' ' -f1 ~/logs/access.log | sort | uniq -c | sort -rn | head -n 3", "awk '$9 == 404 {print $7}' ~/logs/access.log", "sed -i 's|http://|https://|g' ~/sites.txt", "awk -F: '$7 == \"/bin/bash\" {print $1}' /etc/passwd"),
    debrief: "<p>Ticket closed. <code>sort | uniq -c | sort -rn | head</code> is worth memorising: it turns any list into a ranking. <code>awk</code> is the Swiss army knife: fields, filters and arithmetic in one tool. And <code>sed -i</code> edits files from scripts, no editor needed.</p>",
    realworld: "Try on any Linux machine: awk -F: '{print $1, $7}' /etc/passwd | column -t, and history | awk '{print $2}' | sort | uniq -c | sort -rn | head shows your most used commands.",
    quiz: [
      { q: "Why <code>sort</code> before <code>uniq -c</code>?", options: ["It's faster", "uniq only merges duplicates that are next to each other", "uniq needs numbers", "It isn't needed"], answer: 1, why: "Sorting puts equal lines together." },
      { q: "What does <code>sort -rn</code> do?", options: ["Random order", "Numeric sort, biggest first", "Remove numbers", "Reverse alphabetical only"], answer: 1, why: "-n numeric, -r reverse." },
      { q: "In <code>awk -F: '{print $1}' /etc/passwd</code>, what is <code>-F:</code>?", options: ["A file", "Use : as the field separator", "Format output", "Filter lines"], answer: 1, why: "/etc/passwd fields are colon-separated." }
    ]
  });

  /* ================================================================== LX-107 */
  var BACKUP_SH = lines("#!/bin/bash", "# Copies the Kestrel config to the backup folder", "echo \"Backup done: $(date +%F)\"");
  LABS.push({
    id: "lx-107", n: 7, module: 1, ticket: "LX-107", xp: 100,
    title: "Who can do what",
    topic: "Users, groups and permissions: id, chmod, chgrp, umask",
    from: DEV,
    story: "<p>A security review of your home folder found an API key anyone on the server can read, a backup script nobody can run, and a shared reports folder the team can't write to. Fix the permissions.</p>",
    learn:
      "<h3>Who am I?</h3>" + ex("id") + "<p>Every user has a user ID and belongs to groups. Files belong to one user and one group.</p>" +
      "<h3>Reading permissions</h3>" + code("-rwxr-x---  1 dev developers  420 Nov 11 09:00 backup.sh\n ↑↑↑↑↑↑↑↑↑     owner group\n │└┬┘└┬┘└┬┘\n │ │  │  └─ others: ---  (nothing)\n │ │  └──── group:  r-x  (read, run)\n │ └─────── owner:  rwx  (read, write, run)\n └───────── type: - file, d folder, l link") +
      "<p><b>r</b>ead, <b>w</b>rite, e<b>x</b>ecute. On a <b>folder</b>, r lets you list it, w lets you create and delete files in it, and x lets you go into it.</p>" +
      "<h3>chmod: change permissions</h3>" +
      '<table class="t"><tr><th>Numbers</th><th>Letters</th></tr><tr><td>r=4 w=2 x=1, one digit each for owner, group, others: <code>chmod 640 file</code> = rw-r-----</td><td>who (u g o a) ± what: <code>chmod u+x file</code>, <code>chmod go-w file</code>, <code>chmod o= file</code></td></tr></table>' +
      '<table class="t"><tr><th>Mode</th><th>Means</th><th>Typical for</th></tr><tr><td><code>600</code></td><td>rw-------</td><td>secrets, keys</td></tr><tr><td><code>644</code></td><td>rw-r--r--</td><td>normal files</td></tr><tr><td><code>755</code></td><td>rwxr-xr-x</td><td>programs, folders</td></tr><tr><td><code>750</code></td><td>rwxr-x---</td><td>team-only programs</td></tr></table>' +
      "<p><code>chgrp developers folder</code> changes the group (to a group you're in); <code>chown</code> changes the owner, which needs sudo (next ticket).</p>" +
      "<h3>umask: the default for new files</h3><p>New files start from rw-rw-rw- (666) and folders from 777, minus the <b>umask</b>. Ubuntu's 002 gives rw-rw-r--. <code>umask 027</code> makes new files rw-r----- : nothing for others.</p>",
    files: {
      "scripts/backup.sh": { content: BACKUP_SH, mode: 436 }, "secrets/api.key": { content: "kc_api_7f3a91c2\n", mode: 436 },
      "shared/reports/q3.csv": { content: "quarter,orders\nQ3,40122\n", mode: 436 }, "shared/reports": { dir: true, mode: 493 }
    },
    starter: "",
    objectives: [
      {
        id: "id", text: "Show your user name, user ID and all your groups in one command.",
        hints: ["A two-letter command shows identity."],
        check: function (r) { return r.history.some(function (e) { return /^\s*id\s*$/.test(e.cmd) && /groups=/.test(e.out.join(" ")); }) ? true : "Run id."; }
      },
      {
        id: "exec", text: "Make <code>~/scripts/backup.sh</code> <code>rwxr-x---</code> (750), then run it with <code>./</code>.",
        hints: ["chmod 750, then run it from its folder with ./backup.sh (or ~/scripts/backup.sh).", "chmod 750 ~/scripts/backup.sh\n~/scripts/backup.sh"],
        check: function (r) {
          if (r.mode("scripts/backup.sh") !== "750") return "backup.sh's mode is " + r.mode("scripts/backup.sh") + "; it should be 750 (rwxr-x---).";
          return r.history.some(function (e) { return /backup\.sh\s*$/.test(e.cmd) && !/^\s*(chmod|ls|cat|bash|sh)\b/.test(e.cmd) && e.exit === 0 && /Backup done/.test(e.out.join(" ")); }) ? true : "Now run the script by its path (./backup.sh from ~/scripts, or ~/scripts/backup.sh).";
        }
      },
      {
        id: "key", text: "Make <code>~/secrets/api.key</code> readable and writable by <b>you only</b> (600).",
        hints: ["chmod 600 ~/secrets/api.key"],
        check: function (r) { return r.mode("secrets/api.key") === "600" ? true : "api.key is " + r.mode("secrets/api.key") + "; it should be 600 (rw-------)."; }
      },
      {
        id: "shared", text: "Give <code>~/shared/reports</code> to the group <code>developers</code> and let that group <b>write</b> in it (others mustn't write).",
        hints: ["chgrp changes the group; chmod g+w adds write for the group.", "chgrp developers ~/shared/reports\nchmod g+w ~/shared/reports"],
        check: function (r) {
          if (r.group("shared/reports") !== "developers") return "~/shared/reports belongs to the group " + r.group("shared/reports") + "; change it to developers.";
          var m = parseInt(r.mode("shared/reports"), 8);
          if (!(m & 16)) return "The group can't write to ~/shared/reports yet (g+w).";
          return m & 2 ? "Others can write to ~/shared/reports: remove that (o-w)." : true;
        }
      },
      {
        id: "umask", text: "Set your umask so new files aren't readable by others, then create <code>~/private.txt</code> (it should come out <code>rw-r-----</code>, 640).",
        hints: ["umask 027 removes write for the group and everything for others.", "umask 027\ntouch ~/private.txt"],
        check: function (r) {
          if (!r.exists("private.txt")) return "Create ~/private.txt (after setting the umask).";
          return r.mode("private.txt") === "640" ? true : "~/private.txt came out " + r.mode("private.txt") + ". Set umask 027 first, then create the file (delete it and try again if needed).";
        }
      }
    ],
    solution: lines("id", "chmod 750 ~/scripts/backup.sh", "~/scripts/backup.sh", "chmod 600 ~/secrets/api.key", "chgrp developers ~/shared/reports", "chmod g+w ~/shared/reports", "umask 027", "touch ~/private.txt"),
    debrief: "<p>Ticket closed. The key is private, the script runs for the team, the shared folder works and your new files are private by default. Permissions are the most basic security control on Linux: get them right and many attacks simply don't work.</p>",
    realworld: "On your own Linux/Mac: ls -l ~/.ssh. SSH refuses to use a private key that others can read; chmod 600 ~/.ssh/id_ed25519 fixes it.",
    quiz: [
      { q: "What is <code>chmod 640 file</code>?", options: ["rw-r-----", "rwxr-----", "rw-rw----", "r--r-----"], answer: 0, why: "6=rw-, 4=r--, 0=---." },
      { q: "What does x mean on a <b>folder</b>?", options: ["Run it", "You can go into it (cd) and reach files inside", "Delete it", "Nothing"], answer: 1, why: "r lists names; x lets you in." },
      { q: "With umask 027, a new file gets…", options: ["666", "644", "640", "600"], answer: 2, why: "666 minus 027 = 640." }
    ]
  });

  /* ================================================================== LX-108 */
  LABS.push({
    id: "lx-108", n: 8, module: 1, ticket: "LX-108", xp: 100,
    title: "Borrow the keys",
    topic: "sudo, root and least privilege",
    from: DEV,
    story: "<p>Some jobs need administrator rights. On Ubuntu you don't log in as root: you borrow its power for one command with <code>sudo</code>, and every use is logged. Do today's admin jobs, and check who else holds the keys.</p>",
    learn:
      "<h3>root and sudo</h3><p><b>root</b> (user ID 0) can read and change everything. That's why you don't use it all day: one typo as root can destroy the system. <code>sudo command</code> runs <i>one</i> command as root, if <code>/etc/sudoers</code> allows it, and writes it to <code>/var/log/auth.log</code>.</p>" +
      ex("cat /etc/shadow") + ex("sudo head -n 3 /etc/shadow") +
      '<table class="t"><tr><th>Command</th><th>Does</th></tr><tr><td><code>sudo cmd</code></td><td>run cmd as root</td></tr><tr><td><code>sudo -u ana cmd</code></td><td>run cmd as ana</td></tr><tr><td><code>sudo -l</code></td><td>what am I allowed to run?</td></tr><tr><td><code>sudo -i</code></td><td>a root shell (<code>exit</code> to leave). Use sparingly.</td></tr><tr><td><code>sudo chown ana:www-data f</code></td><td>give a file to another user</td></tr></table>' +
      "<h3>Who may use sudo?</h3><p>Rules live in <code>/etc/sudoers</code> and <code>/etc/sudoers.d/</code>; edit them only with <code>sudo visudo</code>, which refuses to save mistakes. On Ubuntu, members of the <code>sudo</code> group may run anything. <code>NOPASSWD</code> rules skip the password: convenient, and a risk if that account is ever compromised.</p>" +
      "<h3>The redirect trap</h3><p><code>sudo echo hi &gt; /etc/motd</code> fails: <code>sudo</code> runs <code>echo</code> as root, but the <code>&gt;</code> is done by <i>your</i> shell, as you. Use <code>tee</code>, run by sudo: <code>echo hi | sudo tee /etc/motd</code>.</p>",
    starter: "",
    objectives: [
      {
        id: "shadow", text: "Show the first 3 lines of <code>/etc/shadow</code> (where password hashes live). As dev you can't: use sudo.",
        hints: ["sudo head -n 3 /etc/shadow"],
        check: function (r) { return r.history.some(function (e) { return /\bsudo\b/.test(e.cmd) && /shadow/.test(e.cmd) && /^root:/.test(e.out[0] || ""); }) ? true : "Use sudo to show the start of /etc/shadow (the first line starts with root:)."; }
      },
      {
        id: "nopasswd", text: "Show the sudoers rule that lets <code>dev</code> use sudo <b>without a password</b> (it's in a file in <code>/etc/sudoers.d</code>).",
        hints: ["List /etc/sudoers.d, then read the file (they're root-only: sudo).", "sudo cat /etc/sudoers.d/90-cloud-init-users"],
        check: function (r) { return r.history.some(function (e) { return e.out.some(function (l) { return /^dev ALL=\(ALL\) NOPASSWD:ALL$/.test(l); }); }) ? true : "Print the file in /etc/sudoers.d that contains dev's NOPASSWD rule (with sudo)."; }
      },
      {
        id: "chown", text: "Make <code>ana</code> the owner of <code>/var/www/kestrel/uploads</code>, keeping the group <code>www-data</code>.",
        hints: ["chown OWNER:GROUP needs root.", "sudo chown ana:www-data /var/www/kestrel/uploads"],
        check: function (r) {
          if (r.owner("/var/www/kestrel/uploads") !== "ana") return "uploads is owned by " + r.owner("/var/www/kestrel/uploads") + "; make it ana (sudo chown).";
          return r.group("/var/www/kestrel/uploads") === "www-data" ? true : "The group should stay www-data.";
        }
      },
      {
        id: "tee", text: "Create <code>/var/www/kestrel/maintenance.txt</code> containing <code>Back at 10:00</code>. The folder is root's: use <code>sudo tee</code>.",
        hints: ["echo \"Back at 10:00\" | sudo tee /var/www/kestrel/maintenance.txt"],
        check: function (r) {
          var c = r.read("/var/www/kestrel/maintenance.txt");
          if (c === null) return "There's no /var/www/kestrel/maintenance.txt yet. (sudo echo ... > file fails: the > runs as you.)";
          return c.trim() === "Back at 10:00" ? true : "The file should contain Back at 10:00.";
        }
      },
      {
        id: "group", text: "Show the line of <code>/etc/group</code> for the <code>sudo</code> group, to see who's in it.",
        hints: ["getent group sudo, or grep the start of the line: grep '^sudo:' /etc/group"],
        check: function (r) { return r.history.some(function (e) { return H.same(e.out, ["sudo:x:27:dev"]); }) ? true : "Print just the sudo group's line from /etc/group (getent group sudo)."; }
      }
    ],
    solution: lines("sudo head -n 3 /etc/shadow", "ls /etc/sudoers.d", "sudo cat /etc/sudoers.d/90-cloud-init-users", "sudo chown ana:www-data /var/www/kestrel/uploads", "echo \"Back at 10:00\" | sudo tee /var/www/kestrel/maintenance.txt", "getent group sudo"),
    debrief: "<p>Ticket closed. You used root's power four times and never logged in as root, and each use is in <code>/var/log/auth.log</code> (try <code>sudo tail /var/log/auth.log</code>). You also found that <code>dev</code> doesn't need a password for sudo: worth raising with Security, because a stolen session would get root for free.</p>",
    realworld: "On Ubuntu: sudo -l shows your rights; sudo grep sudo /var/log/auth.log | tail shows recent sudo use. Never edit /etc/sudoers without visudo.",
    quiz: [
      { q: "Why does <code>sudo echo x &gt; /etc/file</code> fail?", options: ["echo can't run as root", "The > redirect is done by your own shell, not by sudo", "/etc is read-only", "sudo needs -i"], answer: 1, why: "Use echo x | sudo tee /etc/file." },
      { q: "Where are sudo uses recorded on Ubuntu?", options: ["/etc/sudoers", "/var/log/auth.log", "~/.bash_history only", "Nowhere"], answer: 1, why: "Every sudo command is logged there." },
      { q: "Safest way to edit sudo rules?", options: ["nano /etc/sudoers", "sudo visudo", "echo >> /etc/sudoers", "chmod 777 /etc/sudoers"], answer: 1, why: "visudo checks syntax before saving." }
    ]
  });

  /* ================================================================== LX-109 */
  var KC_STATUS = lines("#!/bin/bash", "echo \"kc-web-01 status: all services running\"");
  LABS.push({
    id: "lx-109", n: 9, module: 1, ticket: "LX-109", xp: 100,
    title: "Make yourself at home",
    topic: "Variables, export, PATH, which, alias, ~/.bashrc (and editors)",
    from: MAYA,
    story: "<p>You'll spend a lot of time on this server: set it up the way you like. Understand where commands come from, make your own tools runnable by name, and save shortcuts so they're there every time you log in.</p>",
    learn:
      "<h3>Variables</h3>" + ex("name=Kestrel\necho \"Hello $name\"") +
      "<p>No spaces around <code>=</code>. <code>$name</code> reads it. <code>export name</code> makes it an <b>environment variable</b>, passed to the programs you start. <code>printenv</code> lists them; <code>echo $HOME</code>, <code>$USER</code>, <code>$PATH</code> are a few.</p>" +
      "<h3>PATH: where commands come from</h3>" + ex("echo $PATH\nwhich ls") +
      "<p>When you type <code>ls</code>, bash looks in each folder of <code>$PATH</code> in order. To run your own scripts by name, put them in a folder on the PATH: <code>export PATH=\"$HOME/bin:$PATH\"</code>. Folders not on the PATH need the path: <code>./myscript</code>.</p>" +
      "<h3>Aliases and ~/.bashrc</h3><p><code>alias ll='ls -alF'</code> makes a shortcut, but only in the current shell. To keep it, add the line to <code>~/.bashrc</code>, which bash reads at every login, then reload it with <code>source ~/.bashrc</code>.</p>" +
      "<h3>Editors: survival kit</h3><p>On a server you'll edit files in the terminal. Here, <code>nano FILE</code> opens a simple editor panel instead of the full-screen editor (Module 3 uses it for scripts), so these are the keys you'll need on a real server:</p>" +
      '<table class="t"><tr><th>nano (friendly)</th><th>vim (everywhere)</th></tr><tr><td><code>nano file</code>, just type<br>Ctrl+O, Enter: save<br>Ctrl+X: exit<br>Ctrl+W: search</td><td><code>vim file</code>, then <b>i</b> to type<br><b>Esc</b> to stop typing<br><b>:wq</b> save and quit<br><b>:q!</b> quit without saving</td></tr></table>' +
      "<p>For one line, <code>echo '...' &gt;&gt; file</code> is often quicker than opening an editor.</p>",
    files: { "bin/kc-status": { content: KC_STATUS, mode: 509 } },
    starter: "",
    objectives: [
      {
        id: "path", text: "Show the value of your <code>PATH</code>.",
        hints: ["echo $PATH"],
        check: function (r) { return r.history.some(function (e) { return /PATH/.test(e.cmd) && e.out.some(function (l) { return /^(PATH=)?([^\s:]*:)*\/usr\/local\/sbin:\/usr\/local\/bin:\/usr\/sbin:\/usr\/bin:\/sbin:\/bin$/.test(l); }); }) ? true : "Print the PATH variable (echo $PATH)."; }
      },
      {
        id: "which", text: "Find out which file runs when you type <code>grep</code>.",
        hints: ["which grep"],
        check: function (r) { return r.history.some(function (e) { return /\bgrep\b/.test(e.cmd) && /^\s*(which|type|command)\b/.test(e.cmd) && /\/usr\/bin\/grep/.test(e.out.join(" ")); }) ? true : "Use which (or type) to find the grep program."; }
      },
      {
        id: "export", text: "Create an <b>environment</b> variable <code>LOGDIR</code> set to <code>/var/log/nginx</code>.",
        hints: ["export NAME=value"],
        check: function (r) {
          if (r.v("LOGDIR") !== "/var/log/nginx") return "LOGDIR isn't set to /var/log/nginx in your shell.";
          return r.exported("LOGDIR") ? true : "LOGDIR is a shell variable but not exported: use export.";
        }
      },
      {
        id: "bin", text: "Run <code>~/bin/kc-status</code> just by typing <code>kc-status</code>, by adding <code>~/bin</code> to the front of your PATH.",
        hints: ["export PATH=\"$HOME/bin:$PATH\", then kc-status", "export PATH=\"$HOME/bin:$PATH\"\nkc-status"],
        check: function (r) {
          if (!r.history.some(function (e) { return /^\s*kc-status\s*$/.test(e.cmd) && e.exit === 0 && /all services running/.test(e.out.join(" ")); })) return "Add ~/bin to PATH, then type kc-status on its own.";
          return /(^|:)\/usr\/bin(:|$)/.test(r.v("PATH") || "") ? true : "kc-status works, but you replaced PATH instead of adding to it: now ls, grep and friends can't be found. Keep the old value: export PATH=\"$HOME/bin:$PATH\".";
        }
      },
      {
        id: "alias", text: "Make an alias <code>logs</code> for <code>cd /var/log</code> that's saved in <code>~/.bashrc</code> <b>and</b> works now.",
        hints: ["Append the alias line to ~/.bashrc, then reload it with source.", "echo \"alias logs='cd /var/log'\" >> ~/.bashrc\nsource ~/.bashrc"],
        check: function (r) {
          if (!/^alias logs=['"]cd \/var\/log\/?['"]\s*$/m.test(r.read(".bashrc") || "")) return "~/.bashrc doesn't contain the line alias logs='cd /var/log' yet.";
          if (!r.alias("logs")) return "The alias is saved but not active: run source ~/.bashrc.";
          var after = r.after("logs");
          return after.cwd === "/var/log" ? true : "Typing logs should take you to /var/log.";
        }
      }
    ],
    solution: lines("echo $PATH", "which grep", "export LOGDIR=/var/log/nginx", "export PATH=\"$HOME/bin:$PATH\"", "kc-status", "echo \"alias logs='cd /var/log'\" >> ~/.bashrc", "source ~/.bashrc"),
    debrief: "<p>Ticket closed. You know where commands come from (PATH), how to add your own, and how to make settings stick (<code>~/.bashrc</code>). Many \"command not found\" mysteries are a PATH problem, and many \"it worked yesterday\" ones are a variable that was never exported or saved.</p>",
    realworld: "Open ~/.bashrc on your own Linux/Mac (nano ~/.bashrc), add alias gs='git status', save, then source ~/.bashrc. On macOS the file is ~/.zshrc.",
    quiz: [
      { q: "What does <code>export</code> add to a variable?", options: ["Saves it to disk", "Passes it to programs you start", "Makes it read-only", "Nothing"], answer: 1, why: "Exported variables become the environment of child processes." },
      { q: "You saved an alias in ~/.bashrc but it doesn't work yet. Why?", options: ["Aliases need sudo", "bash reads ~/.bashrc at login: run source ~/.bashrc", "Wrong folder", "Aliases expire"], answer: 1, why: "Or open a new terminal." },
      { q: "In vim, how do you quit without saving?", options: [":wq", ":q!", "Ctrl+X", "exit"], answer: 1, why: ":wq saves and quits; :q! discards." }
    ]
  });

  /* ================================================================== LX-110 capstone */
  var SCANNER = "203.0.113.50";
  function scanRows(paths) { return paths.map(function (p) { return { ip: SCANNER, path: p[0], status: p[1], method: p[2] || "GET" }; }); }
  var SCAN = [["/wp-login.php", 404], ["/.env", 404], ["/admin", 404], ["/.git/config", 200], ["/phpmyadmin/", 404], ["/backup.zip", 200], ["/wp-login.php", 404], ["/server-status", 403], ["/api/orders?id=1%27%20OR%201=1", 500], ["/.env", 404], ["/config.php.bak", 404], ["/admin", 404]];
  var SCAN_ALT = [["/xmlrpc.php", 404], ["/.aws/credentials", 200], ["/.env", 404], ["/debug", 200], ["/.aws/credentials", 200], ["/console", 404]];
  var CAP_COUNTS = { "192.0.2.44": 58, "198.51.100.20": 47, "10.20.0.8": 39, "203.0.113.7": 26, "198.51.100.73": 17, "192.0.2.10": 9 };
  var CAP_COUNTS_ALT = { "10.20.0.8": 61, "192.0.2.44": 40, "198.51.100.73": 33, "192.0.2.10": 21, "203.0.113.7": 14 };
  var CAP_LOG = accessLog(23, CAP_COUNTS, scanRows(SCAN)).join("\n") + "\n";
  var CAP_LOG_ALT = accessLog(91, CAP_COUNTS_ALT, scanRows(SCAN_ALT)).join("\n") + "\n";
  var NGX = "/var/log/nginx/access.log";
  function capFiles(log) { var f = {}; f[NGX] = { content: log, owner: "www-data", group: "adm", mode: 416 }; return f; }
  function statusCounts(text) { var c = {}; L(text).forEach(function (l) { var s = fields(l)[8]; c[s] = (c[s] || 0) + 1; }); return Object.keys(c).sort(S.sortLines).map(function (s) { return c[s] + " " + s; }); }
  LABS.push({
    id: "lx-110", n: 10, module: 1, ticket: "LX-110", xp: 200, capstone: true,
    title: "Log detective",
    topic: "Module 1 capstone project",
    from: "Dev Patel & Maya Chen",
    story: "<p>Overnight, something probed <code>kc-web-01</code>'s website. The evidence is in <code>/var/log/nginx/access.log</code>. Answer Security's questions with commands, and save the hits that worry us into a report.</p>",
    learn:
      '<div class="callout warn"><b>Capstone rules.</b> No hints. Every answer must come from a command run on the log: the checks re-run your commands on a different log. ' +
      "If you get completely stuck, the Tasks tab has a button to reveal the full solution. The capstone then earns half XP.</div>" +
      "<h3>The questions</h3><ol>" +
      "<li>How many requests are in the log?</li>" +
      "<li>Which 5 IPs made the most requests? Show count and IP, busiest first.</li>" +
      "<li>The suspected scanner is <code>203.0.113.50</code>. Which <b>distinct</b> paths did it request? Sorted, one per line.</li>" +
      "<li>How many responses of each status code are there? Show count and code, one line per code, in code order (200 first).</li>" +
      "<li>Save every line where the scanner got a <b>200</b> (it found something!) to <code>~/reports/scanner-hits.txt</code>, in log order.</li></ol>" +
      "<h3>Reminders</h3><p>The status is field 9 and the path field 7. <code>grep \"^203.0.113.50 \"</code> anchors the IP to the start of the line (the dots are \"any character\" in a pattern, so anchoring and the trailing space keep it exact).</p>",
    files: capFiles(CAP_LOG),
    starter: "",
    solution: lines(
      "wc -l /var/log/nginx/access.log",
      "cut -d' ' -f1 /var/log/nginx/access.log | sort | uniq -c | sort -rn | head -n 5",
      "grep '^203.0.113.50 ' /var/log/nginx/access.log | awk '{print $7}' | sort -u",
      "awk '{print $9}' /var/log/nginx/access.log | sort | uniq -c",
      "mkdir -p ~/reports",
      "grep '^203.0.113.50 ' /var/log/nginx/access.log | awk '$9 == 200' > ~/reports/scanner-hits.txt"),
    objectives: [
      {
        id: "total", hints: [], text: "Print the number of requests in the log.",
        check: function (r) {
          var n = L(r.read(NGX)).length, idx = -1;
          r.history.forEach(function (e, i) { if (numIn(e) === n && !/^\s*(echo|printf)\b/.test(e.cmd)) idx = i; });
          if (idx < 0) return "Print how many lines (requests) the log has.";
          var r2 = r.run(null, { files: capFiles(CAP_LOG_ALT) });
          return numIn(r2.history[idx]) === L(CAP_LOG_ALT).length ? true : "Count with a command on the log (the check re-runs it on another log).";
        }
      },
      {
        id: "top", hints: [], text: "Show the 5 busiest IPs with their counts, busiest first.",
        check: function (r) { return prove(r, function (x) { return topIps(x.read(NGX), 5); }, { files: capFiles(CAP_LOG_ALT) }, { norm: true }, "Print 5 lines of \"count IP\", busiest first.", "Your top 5 didn't follow when the log changed: compute it from the log."); }
      },
      {
        id: "paths", hints: [], text: "List the distinct paths requested by <code>203.0.113.50</code>, sorted.",
        check: function (r) {
          return prove(r, function (x) { var s = {}; L(x.read(NGX)).filter(function (l) { return fields(l)[0] === SCANNER; }).forEach(function (l) { s[fields(l)[6]] = 1; }); return Object.keys(s).sort(S.sortLines); }, { files: capFiles(CAP_LOG_ALT) }, null,
            "Print each path the scanner requested, once, sorted (sort -u).", "Your list didn't follow when the log changed: build it from the log.");
        }
      },
      {
        id: "status", hints: [], text: "Show how many responses there are of each status code, in code order.",
        check: function (r) { return prove(r, function (x) { return statusCounts(x.read(NGX)); }, { files: capFiles(CAP_LOG_ALT) }, { norm: true }, "Print one line per status code, \"count code\", 200 first (awk '{print $9}' | sort | uniq -c).", "Your counts didn't follow when the log changed."); }
      },
      {
        id: "report", hints: [], text: "<code>~/reports/scanner-hits.txt</code> holds every log line where the scanner got a 200, in log order.",
        check: function (r) {
          var want = L(r.read(NGX)).filter(function (l) { return fields(l)[0] === SCANNER && fields(l)[8] === "200"; });
          if (!H.same(L(r.read("reports/scanner-hits.txt") || ""), want)) return "~/reports/scanner-hits.txt should contain exactly the " + want.length + " full log lines where 203.0.113.50 got a 200.";
          var r2 = r.run(null, { files: capFiles(CAP_LOG_ALT) });
          var want2 = L(CAP_LOG_ALT).filter(function (l) { return fields(l)[0] === SCANNER && fields(l)[8] === "200"; });
          return H.same(L(r2.read("reports/scanner-hits.txt") || ""), want2) ? true : "Build the report with commands (the check re-runs them on another log).";
        }
      }
    ],
    debrief: "<p><b>Module 1 complete.</b> In five commands you turned a raw log into an incident summary: the scanner tried WordPress, phpMyAdmin and an SQL injection, and it <b>did</b> download <code>/.git/config</code> and <code>/backup.zip</code>. That's the next ticket for the team: take those files off the web root and rotate anything in them.</p>" +
      "<p>Module 2 runs the server itself: processes, services, packages, disks, networking, SSH and scheduled jobs.</p>",
    realworld: "Real tools do this at scale (GoAccess for web logs, a SIEM for everything), but when they're missing or you're on a box mid-incident, these same pipelines are what you reach for.",
    quiz: []
  });

  var UPCOMING = [
    { module: 2, title: "Processes", topic: "ps, top, kill, signals, jobs" },
    { module: 2, title: "Services", topic: "systemctl and journalctl" },
    { module: 2, title: "Packages", topic: "apt and dpkg" },
    { module: 2, title: "Disk space", topic: "df, du, lsblk" },
    { module: 2, title: "Networking on the box", topic: "ip, ss, curl, dig" },
    { module: 2, title: "SSH", topic: "keys, config, scp, rsync" },
    { module: 2, title: "Scheduling", topic: "cron and systemd timers" },
    { module: 2, title: "Archives & backups", topic: "tar, gzip, rsync" },
    { module: 2, title: "Module 2 capstone", topic: "Bring up the web server", capstone: true },
    { module: 3, title: "Your first script", topic: "shebang, arguments, exit codes" },
    { module: 3, title: "Variables & quoting", topic: "\"$var\", $(cmd), $(( ))" },
    { module: 3, title: "Conditions", topic: "if, [[ ]], && ||" },
    { module: 3, title: "Loops", topic: "for, while read" },
    { module: 3, title: "Functions", topic: "functions and source" },
    { module: 3, title: "Robust scripts", topic: "set -euo pipefail, trap, ShellCheck" },
    { module: 3, title: "Options & input", topic: "getopts, read, here-docs" },
    { module: 3, title: "Module 3 capstone", topic: "Health-check script", capstone: true },
    { module: 4, title: "Investigating a break-in", topic: "auth.log, last, who" },
    { module: 4, title: "Accounts", topic: "/etc/passwd, /etc/shadow, sudo audit" },
    { module: 4, title: "Dangerous permissions", topic: "SUID, sticky bit, world-writable" },
    { module: 4, title: "Firewall", topic: "ufw, iptables/nftables" },
    { module: 4, title: "Hardening SSH & updates", topic: "sshd_config, fail2ban, unattended-upgrades" },
    { module: 4, title: "Hunting persistence", topic: "cron, systemd, authorized_keys" },
    { module: 4, title: "Integrity", topic: "sha256sum, GPG, package checks" },
    { module: 4, title: "Bash in CI", topic: "ShellCheck, exit codes, Actions" },
    { module: 4, title: "Module 4 capstone", topic: "Audit and harden kc-web-01", capstone: true }
  ];
  var MODULES = [{ n: 1, name: "Shell foundations" }, { n: 2, name: "Running a server" }, { n: 3, name: "Bash scripting" }, { n: 4, name: "Linux security & DevSecOps" }];
  window.LX_TRACK = { MODULES: MODULES, LABS: LABS, UPCOMING: UPCOMING, ex: ex, code: code, lines: lines, gen: { appLog: appLog, accessLog: accessLog }, APP: APP, APP_ALT: APP_ALT, ACCESS: ACCESS, ACCESS_ALT: ACCESS_ALT, prove: prove, absOut: absOut, numIn: numIn };
})();
