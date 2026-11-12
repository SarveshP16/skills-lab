/* sudo learn — Linux track, Module 3: Bash scripting (LX-120..127). Scripts are written in the editor panel
   (nano FILE opens it) and run in the terminal. Checks run the learner's scripts themselves, with other
   arguments and on changed machines (r.after / r.run), so a script only passes if it really does the job. */
(function () {
  "use strict";
  var T = window.LX_TRACK, H = window.ShLab.H, S = window.ShEngine, M2 = S.M2, M3 = S.M3;
  var ex = T.ex, code = T.code;
  var MAYA = "Maya Chen · SRE lead", DEV = "Dev Patel · Security", BEN = "Ben Okoro · Developer";
  var HOME = "/home/dev", DAY = S.DAY;
  var LABS = [];

  /* ---------------- helpers */
  function sc() { return Array.prototype.slice.call(arguments).join("\n") + "\n"; }
  // A reference solution: strings are commands; {nano: PATH, text} is a file written in the editor.
  function sol() {
    var outL = [];
    Array.prototype.slice.call(arguments).forEach(function (x) {
      if (typeof x === "string") outL.push(x);
      else { outL.push("nano " + x.nano); x.text.replace(/\n$/, "").split("\n").forEach(function (l) { outL.push("    " + l); }); }
    });
    return outL.join("\n");
  }
  function rt(x) { return String(x).replace(/\s+$/, ""); }
  function last(c) { return c.history[c.history.length - 1]; }
  // Run a command after the learner's history (optionally on a changed machine) and return what it did.
  function call(r, cmd, alt) {
    var base = alt ? r.run(null, alt) : r;
    var c = base.after(cmd), e = last(c);
    return { out: e.out.map(rt), err: e.err.map(rt), exit: e.exit, c: c };
  }
  function same(a, b) { return H.same(a, b); }
  function show(v) { return H.show(v); }
  function abs(p) { return p.replace(/^~/, HOME); }
  // The usual first problems with a script: missing, no shebang, not executable.
  function basics(r, p) {
    var t = r.read(abs(p));
    if (t === null) return "Create " + p + " (nano " + p + " opens the editor; Save writes the file).";
    if (!/^#!\s*(\/usr)?\/bin\/(env\s+)?bash\b/.test(t)) return p + " should start with the shebang line #!/bin/bash.";
    if (!(r.node(abs(p)).mode & 64)) return "Make " + p + " executable: chmod +x " + p;
    return null;
  }
  function ran(r, re, fn) { return r.history.some(function (e) { return re.test(e.cmd) && (!fn || fn(e)); }); }
  function idxOf(r, re, fn) { var k = -1; r.history.forEach(function (e, i) { if (re.test(e.cmd) && (!fn || fn(e))) k = i; }); return k; }
  function outHas(e, re) { return e.out.some(function (l) { return re.test(l); }); }
  function q(s) { return "'" + String(s).replace(/'/g, "'\\''") + "'"; }
  function lastEdit(r, p) { var k = -1; r.history.forEach(function (e, i) { if (e.edit && abs(e.edit.path) === abs(p)) k = i; else if (new RegExp("(>|tee|sed -i|cp|mv)[^|;]*" + p.replace(/^~\//, "").replace(/[.]/g, "\\.") + "\\b").test(e.cmd)) k = i; }); return k; }
  function tmpList(c) { var n = c.node("/tmp"); return n ? Object.keys(n.children).sort() : []; }
  M3.lab = { sc: sc, sol: sol, call: call, basics: basics, abs: abs, q: q, rt: rt, tmpList: tmpList };

  /* ================================================================== LX-120 Your first script */
  LABS.push({
    id: "lx-120", n: 20, module: 3, ticket: "LX-120", xp: 120,
    title: "Your first script",
    topic: "shebang, chmod +x, arguments, exit codes",
    from: MAYA,
    story: "<p>Every morning someone on the team types the same handful of commands on kc-web-01. Time to start putting them in <b>scripts</b>. Start small: a script that greets you, one that takes arguments, and one that reports failure properly, so other scripts and cron can tell when it went wrong.</p>",
    learn:
      "<h3>A script is a file of commands</h3><p>Anything you can type at the prompt can go in a file, one command per line. Bash runs the lines top to bottom.</p>" +
      code(sc("#!/bin/bash", "# Print who and where we are", "echo \"Hello from $(hostname)\"", "date")) +
      "<p>The first line, the <b>shebang</b> <code>#!/bin/bash</code>, tells Linux which program runs the file. Lines starting with <code>#</code> are comments.</p>" +
      "<h3>Writing it: the editor panel</h3><p>On a real server you'd use <code>nano</code> or <code>vim</code>. Here, <code>nano FILE</code> opens an editor panel over the terminal: type, click <b>Save</b> (or Ctrl+S), and the file is written. Your scripts go in <code>~/scripts</code>; create the folder first.</p>" +
      ex("mkdir -p ~/scripts") +
      "<h3>Running it</h3><p>A new file isn't executable. Give it the x permission once, then run it by its path:</p>" +
      code("chmod +x ~/scripts/hello.sh\n~/scripts/hello.sh\ncd ~/scripts && ./hello.sh") +
      "<p>The <code>./</code> matters: bash only looks up bare names (<code>hello.sh</code>) in the folders on <code>$PATH</code>, and the current folder isn't one of them. <code>bash hello.sh</code> also works without the x bit: it starts bash and hands it the file.</p>" +
      "<h3>Arguments</h3><p>Words after the script's name arrive as numbered variables:</p>" +
      '<table class="t"><tr><th>Variable</th><th>Holds</th></tr><tr><td><code>$1</code>, <code>$2</code> ...</td><td>the first, second... argument</td></tr><tr><td><code>$#</code></td><td>how many arguments there are</td></tr><tr><td><code>"$@"</code></td><td>all of them, each kept separate</td></tr><tr><td><code>$0</code></td><td>the script\'s own name, as it was called</td></tr></table>' +
      code(sc("#!/bin/bash", "echo \"Deploying $1 to $2\"", "echo \"($# arguments)\"")) +
      "<h3>Exit codes</h3><p>Every command ends with a number: <b>0 means success</b>, anything else is a failure (and often says which one). <code>$?</code> holds the last command's code:</p>" +
      ex("ls /etc/hostname; echo $?") + ex("ls /nope; echo $?") +
      "<p>A script's code is that of its last command, or whatever you give <code>exit</code>. Error messages belong on <b>stderr</b>: <code>&gt;&amp;2</code> sends <code>echo</code>'s output there.</p>" +
      code(sc("#!/bin/bash", "echo \"Config not found\" >&2", "exit 1")) +
      '<div class="callout">cron, systemd, CI pipelines and other scripts all read exit codes. A script that prints "error" but exits 0 looks successful to every one of them.</div>',
    files: {},
    starter: "",
    objectives: [
      {
        id: "hello", text: "Create <code>~/scripts/hello.sh</code>: a bash script that prints <code>Hello, Kestrel!</code>. Make it executable and run it by its path (<code>./hello.sh</code> or <code>~/scripts/hello.sh</code>).",
        hints: ["mkdir -p ~/scripts, then nano ~/scripts/hello.sh. Two lines: the shebang, then an echo.", "#!/bin/bash on line 1, echo \"Hello, Kestrel!\" on line 2. Save, then chmod +x ~/scripts/hello.sh and ~/scripts/hello.sh"],
        check: function (r) {
          var b = basics(r, "~/scripts/hello.sh"); if (b) return b;
          var res = call(r, HOME + "/scripts/hello.sh");
          if (!same(res.out, ["Hello, Kestrel!"])) return "When run, it should print exactly Hello, Kestrel! (it printed " + show(res.out) + ").";
          return ran(r, /^\s*(\.\/|~\/|\/home\/dev\/)(scripts\/)?hello\.sh\b/, function (e) { return outHas(e, /^Hello, Kestrel!$/); }) ? true : "Now run it by its path, e.g. ~/scripts/hello.sh (or cd ~/scripts, then ./hello.sh).";
        }
      },
      {
        id: "greet", text: "Create <code>~/scripts/greet.sh</code>: it greets its first argument, so <code>greet.sh Ana</code> prints <code>Hello, Ana!</code>",
        hints: ["$1 is the first argument. Put it inside the double quotes.", "#!/bin/bash\necho \"Hello, $1!\""],
        check: function (r) {
          var b = basics(r, "~/scripts/greet.sh"); if (b) return b;
          var a = call(r, HOME + "/scripts/greet.sh Ana"), z = call(r, HOME + "/scripts/greet.sh Zoe");
          if (!same(a.out, ["Hello, Ana!"])) return "greet.sh Ana should print Hello, Ana! (it printed " + show(a.out) + ").";
          return same(z.out, ["Hello, Zoe!"]) ? true : "It should greet whatever name it's given: greet.sh Zoe printed " + show(z.out) + ". Use $1.";
        }
      },
      {
        id: "args", text: "Create <code>~/scripts/args.sh</code>: it says how many arguments it got and lists them, e.g. <code>args.sh web db cache</code> prints <code>3 arguments: web db cache</code>",
        hints: ["$# is the count; $@ is all the arguments.", "echo \"$# arguments: $*\" (or $@)"],
        check: function (r) {
          var b = basics(r, "~/scripts/args.sh"); if (b) return b;
          var tests = [["web db cache", "3 arguments: web db cache"], ["kc-web-01", "1 arguments: kc-web-01"], ["a b c d e", "5 arguments: a b c d e"]];
          for (var i = 0; i < tests.length; i++) { var res = call(r, HOME + "/scripts/args.sh " + tests[i][0]); if (!same(res.out, [tests[i][1]])) return "args.sh " + tests[i][0] + " should print \"" + tests[i][1] + "\" (it printed " + show(res.out) + ")."; }
          return true;
        }
      },
      {
        id: "fail", text: "Create <code>~/scripts/fail.sh</code>: it prints <code>Something went wrong</code> to <b>stderr</b> and exits with code <b>3</b>. Run it, then show its exit code with <code>echo $?</code>.",
        hints: ["echo ... >&2 writes to stderr; exit 3 ends the script with code 3.", "#!/bin/bash\necho \"Something went wrong\" >&2\nexit 3\n... then: ~/scripts/fail.sh; echo $?"],
        check: function (r) {
          var b = basics(r, "~/scripts/fail.sh"); if (b) return b;
          var res = call(r, HOME + "/scripts/fail.sh");
          if (res.out.length) return "fail.sh shouldn't print anything on stdout: the message goes to stderr (>&2).";
          if (!res.err.some(function (l) { return /Something went wrong/.test(l); })) return "fail.sh should print Something went wrong on stderr (echo ... >&2).";
          if (res.exit !== 3) return "fail.sh should exit with code 3 (it exited with " + res.exit + "). Add exit 3.";
          var ok = r.history.some(function (e, i) {
            if (!/fail\.sh/.test(e.cmd)) return false;
            if (/fail\.sh.*;\s*echo\s+"?\$\?"?\s*$/.test(e.cmd)) return e.out[e.out.length - 1] === "3";
            var n = r.history[i + 1];
            return !!n && /^\s*echo\s+"?\$\?"?\s*$/.test(n.cmd) && same(n.out, ["3"]);
          });
          return ok ? true : "Run it, and right after it, echo $? (or ~/scripts/fail.sh; echo $? on one line) to see the 3.";
        }
      }
    ],
    solution: sol("mkdir -p ~/scripts",
      { nano: "~/scripts/hello.sh", text: sc("#!/bin/bash", "echo \"Hello, Kestrel!\"") },
      "chmod +x ~/scripts/hello.sh", "~/scripts/hello.sh",
      { nano: "~/scripts/greet.sh", text: sc("#!/bin/bash", "echo \"Hello, $1!\"") },
      "chmod +x ~/scripts/greet.sh", "~/scripts/greet.sh Ana",
      { nano: "~/scripts/args.sh", text: sc("#!/bin/bash", "echo \"$# arguments: $*\"") },
      "chmod +x ~/scripts/args.sh", "~/scripts/args.sh web db cache",
      { nano: "~/scripts/fail.sh", text: sc("#!/bin/bash", "echo \"Something went wrong\" >&2", "exit 3") },
      "chmod +x ~/scripts/fail.sh", "~/scripts/fail.sh; echo $?"),
    debrief: "<p>Four scripts, and the three habits that matter most: a shebang, the execute bit, and an honest exit code with errors on stderr. Your <code>fail.sh</code> can now be used by anything: <code>~/scripts/fail.sh || echo \"handle it\"</code> works because the 3 means failure.</p><p>Next: variables, and the quoting rule that saves you from the most common bash bug.</p>",
    realworld: "Try it on your own machine: macOS and Linux both run #!/bin/bash scripts. Keep personal scripts in ~/bin; many distributions put ~/bin on your PATH automatically once it exists, so you can type the name without ./.",
    quiz: [
      { q: "What does the first line <code>#!/bin/bash</code> do?", options: ["Nothing: it's a comment", "Tells Linux which program should run the file", "Makes the file executable", "Loads bash's functions"], answer: 1, why: "It's read by the kernel when you run ./script: it says 'run this with /bin/bash'. Bash itself then ignores it as a comment." },
      { q: "<code>./deploy.sh</code> says <i>Permission denied</i>. The most likely fix?", options: ["sudo ./deploy.sh", "chmod +x deploy.sh", "Rename it to deploy", "Add exit 0 at the end"], answer: 1, why: "New files aren't executable. chmod +x adds the x permission once." },
      { q: "A script run as <code>./x.sh a b c</code>: what's <code>$#</code>?", options: ["3", "4", "a b c", "./x.sh"], answer: 0, why: "$# counts the arguments, not the script name ($0)." }
    ]
  });

  /* ================================================================== LX-121 Variables & quoting */
  var ARCHIVE_BUG = sc("#!/bin/bash", "# Move a file into ~/archive", "mv $1 ~/archive/", "echo \"Archived $1\"");
  LABS.push({
    id: "lx-121", n: 21, module: 3, ticket: "LX-121", xp: 120,
    title: "Variables & quoting",
    topic: "\"$var\", ${var:-default}, $(cmd), $(( ))",
    from: BEN,
    story: "<p>Ben's archive script worked for months, until someone archived <code>Q3 report.pdf</code>. It didn't archive that file. It archived two <b>other</b> files instead. Fix it, and on the way pick up the variable tricks you'll use in every script: command output in a variable, arithmetic, and default values.</p>" +
      '<div class="callout warn">Don\'t run <code>~/scripts/archive-old.sh "Q3 report.pdf"</code> before fixing it: it moves the wrong files. (If you did, move <code>~/archive/Q3</code> and <code>~/archive/report.pdf</code> back to your home folder.)</div>',
    learn:
      "<h3>Variables</h3>" + ex("name=kestrel\necho \"Hello $name\"\necho \"${name}-backup\"") +
      "<p>No spaces around <code>=</code> (<code>name = x</code> runs a command called <code>name</code>). <code>${name}</code> is the same as <code>$name</code>, with the end of the name made clear.</p>" +
      "<h3>Command substitution and arithmetic</h3>" + ex("today=$(date +%F)\necho \"backup-$today.tar.gz\"") + ex("echo $(( 1536 / 1024 ))\necho $(( (17 + 5) * 3 ))") +
      "<p><code>$(command)</code> is replaced by the command's output. <code>$(( ))</code> does whole-number arithmetic: <code>+ - * / %</code>, no decimals (<code>7 / 2</code> is 3).</p>" +
      "<h3>Defaults</h3>" + ex("echo \"${ENVIRONMENT:-staging}\"") +
      "<p><code>${var:-default}</code> uses the default when the variable is unset or empty: <code>env=${1:-staging}</code> makes the first argument optional.</p>" +
      "<h3>Quoting: the rule</h3><p>After expanding an <b>unquoted</b> <code>$var</code>, bash splits the result on spaces and expands wildcards in it. Quote it, and it stays one word:</p>" +
      ex("f=\"Q3 report.pdf\"\nls -l $f\nls -l \"$f\"") +
      '<table class="t"><tr><th>Quotes</th><th>Effect</th></tr><tr><td><code>"double"</code></td><td>variables and <code>$( )</code> expand, but the result stays one word. Use them around every <code>$var</code>.</td></tr><tr><td><code>\'single\'</code></td><td>nothing expands: what you see is what you get (<code>\'$5\'</code> is a dollar and a 5).</td></tr><tr><td>none</td><td>split on spaces, wildcards expanded: almost never what you want for a variable</td></tr></table>' +
      '<div class="callout">Rule of thumb: <b>always write <code>"$var"</code></b> unless you know why not. It\'s the single most common bug in shell scripts.</div>',
    files: {
      "scripts/archive-old.sh": { content: ARCHIVE_BUG, mode: 493 },
      "archive": { dir: true, mode: 493 },
      "Q3 report.pdf": "%PDF-1.7 Q3 numbers\n",
      "Q3": "Q3 planning notes (keep in the home folder)\n",
      "report.pdf": "%PDF-1.7 the weekly report (keep in the home folder)\n"
    },
    starter: "",
    objectives: [
      {
        id: "quotes", text: "At the prompt, print exactly: <code>Price: $5 for \"pro\" users</code>",
        hints: ["Inside double quotes, $5 would expand (to nothing). Single quotes keep everything as typed, including the double quotes.", "echo 'Price: $5 for \"pro\" users'"],
        check: function (r) { return ran(r, /\becho|printf/, function (e) { return same(e.out.map(rt), ["Price: $5 for \"pro\" users"]); }) ? true : "Print exactly Price: $5 for \"pro\" users. Which quotes stop $5 from expanding?"; }
      },
      {
        id: "name", text: "Create <code>~/scripts/backup-name.sh</code>: it prints <code>kestrel-backup-</code> + today's date as YYYY-MM-DD + <code>.tar.gz</code> (today that's <code>kestrel-backup-2026-11-11.tar.gz</code>). Put the date in a variable with <code>$(date +%F)</code>.",
        hints: ["today=$(date +%F) stores the date; then echo it inside the name.", "#!/bin/bash\ntoday=$(date +%F)\necho \"kestrel-backup-$today.tar.gz\""],
        check: function (r) {
          var b = basics(r, "~/scripts/backup-name.sh"); if (b) return b;
          var t = r.read(HOME + "/scripts/backup-name.sh");
          if (!/^\s*[A-Za-z_]\w*=.*\$\(\s*date\b/m.test(t)) return "Store the date in a variable first, e.g. today=$(date +%F).";
          var res = call(r, HOME + "/scripts/backup-name.sh");
          if (!same(res.out, ["kestrel-backup-2026-11-11.tar.gz"])) return "It should print kestrel-backup-2026-11-11.tar.gz (it printed " + show(res.out) + ").";
          var later = call(r, HOME + "/scripts/backup-name.sh", { system: function (sys) { sys.now += 3 * DAY; } });
          return same(later.out, ["kestrel-backup-2026-11-14.tar.gz"]) ? true : "Use the real date: three days later it should say 2026-11-14 (it printed " + show(later.out) + ").";
        }
      },
      {
        id: "archive", text: "Fix <code>~/scripts/archive-old.sh</code> so it works for names with spaces, then archive <code>Q3 report.pdf</code> with it. <code>Q3</code> and <code>report.pdf</code> must stay in your home folder.",
        hints: ["Run cat ~/scripts/archive-old.sh. mv $1 splits Q3 report.pdf into two names. Which quotes keep it in one piece?", "In the script: mv \"$1\" ~/archive/ and echo \"Archived $1\". Then: cd ~ && ~/scripts/archive-old.sh \"Q3 report.pdf\""],
        check: function (r) {
          if (!r.exists(HOME + "/Q3") || !r.exists(HOME + "/report.pdf")) return "Q3 and report.pdf have left your home folder: that's the bug at work (mv got 3 words). Move them back from ~/archive (or reset the machine), fix the quoting, then run it again.";
          if (!r.exists(HOME + "/archive/Q3 report.pdf")) return r.exists(HOME + "/Q3 report.pdf") ? "Fix the script, then archive Q3 report.pdf with it (put the name in quotes when you call it, too)." : "Q3 report.pdf should end up in ~/archive.";
          var alt = { files: { "Old notes.txt": "old\n", "Old": "decoy\n", "notes.txt": "decoy\n" } };
          var res = call(r, "cd /home/dev && /home/dev/scripts/archive-old.sh \"Old notes.txt\"", alt);
          if (!res.c.exists(HOME + "/archive/Old notes.txt") || !res.c.exists(HOME + "/Old") || !res.c.exists(HOME + "/notes.txt")) return "Tested with \"Old notes.txt\": the script still splits the name. Quote every $1 in it.";
          return true;
        }
      },
      {
        id: "mb", text: "Create <code>~/scripts/to-mb.sh</code>: it turns a number of bytes into whole megabytes, e.g. <code>to-mb.sh 5242880</code> prints <code>5242880 bytes = 5 MB</code>",
        hints: ["One megabyte is 1024 × 1024 bytes. $(( )) does the division (whole numbers only).", "echo \"$1 bytes = $(( $1 / 1024 / 1024 )) MB\""],
        check: function (r) {
          var b = basics(r, "~/scripts/to-mb.sh"); if (b) return b;
          var tests = [["5242880", "5242880 bytes = 5 MB"], ["10485760", "10485760 bytes = 10 MB"], ["1572864", "1572864 bytes = 1 MB"], ["1047527424", "1047527424 bytes = 999 MB"]];
          for (var i = 0; i < tests.length; i++) { var res = call(r, HOME + "/scripts/to-mb.sh " + tests[i][0]); if (!same(res.out, [tests[i][1]])) return "to-mb.sh " + tests[i][0] + " should print \"" + tests[i][1] + "\" (it printed " + show(res.out) + ")."; }
          return true;
        }
      },
      {
        id: "env", text: "Create <code>~/scripts/deploy-env.sh</code>: it prints <code>Deploying to ENV</code>, where ENV is its first argument, or <code>staging</code> when there's none.",
        hints: ["${1:-staging} is $1, or staging if $1 is empty.", "env=${1:-staging}\necho \"Deploying to $env\""],
        check: function (r) {
          var b = basics(r, "~/scripts/deploy-env.sh"); if (b) return b;
          var a = call(r, HOME + "/scripts/deploy-env.sh"), p = call(r, HOME + "/scripts/deploy-env.sh prod");
          if (!same(a.out, ["Deploying to staging"])) return "With no argument it should print Deploying to staging (it printed " + show(a.out) + ").";
          return same(p.out, ["Deploying to prod"]) ? true : "deploy-env.sh prod should print Deploying to prod (it printed " + show(p.out) + ").";
        }
      }
    ],
    solution: sol("echo 'Price: $5 for \"pro\" users'",
      { nano: "~/scripts/backup-name.sh", text: sc("#!/bin/bash", "today=$(date +%F)", "echo \"kestrel-backup-$today.tar.gz\"") },
      "chmod +x ~/scripts/backup-name.sh", "~/scripts/backup-name.sh",
      "cat ~/scripts/archive-old.sh",
      { nano: "~/scripts/archive-old.sh", text: sc("#!/bin/bash", "# Move a file into ~/archive", "mv \"$1\" ~/archive/", "echo \"Archived $1\"") },
      "cd ~ && ~/scripts/archive-old.sh \"Q3 report.pdf\"", "ls ~/archive",
      { nano: "~/scripts/to-mb.sh", text: sc("#!/bin/bash", "echo \"$1 bytes = $(( $1 / 1024 / 1024 )) MB\"") },
      "chmod +x ~/scripts/to-mb.sh", "~/scripts/to-mb.sh 5242880",
      { nano: "~/scripts/deploy-env.sh", text: sc("#!/bin/bash", "env=${1:-staging}", "echo \"Deploying to $env\"") },
      "chmod +x ~/scripts/deploy-env.sh", "~/scripts/deploy-env.sh"),
    debrief: "<p>The archive bug in one line: <code>mv $1</code> became <code>mv Q3 report.pdf ~/archive/</code>, three arguments, so mv moved two innocent files and never touched the real one. Two quote marks fixed it.</p><p>You also used <code>$(date)</code> for names that change every day, <code>$(( ))</code> for sums, and <code>${1:-staging}</code> for optional arguments. Next: making decisions with <code>if</code>.</p>",
    realworld: "Real file names have spaces, quotes and even newlines in them (look at a Downloads folder). Test your scripts with a file called \"a b.txt\" before trusting them.",
    quiz: [
      { q: "<code>f=\"a b.txt\"; rm $f</code> tries to delete...", options: ["a b.txt", "a and b.txt", "nothing: it's a syntax error", "every file"], answer: 1, why: "Unquoted, $f is split on the space into two words. rm \"$f\" deletes the one file." },
      { q: "What does <code>echo '$HOME'</code> print?", options: ["/home/dev", "$HOME", "nothing", "an error"], answer: 1, why: "Single quotes stop all expansion." },
      { q: "<code>echo $(( 7 / 2 ))</code> prints...", options: ["3.5", "3", "4", "7/2"], answer: 1, why: "Bash arithmetic is whole numbers only: the fraction is dropped." }
    ]
  });

  /* ================================================================== LX-122 Conditions */
  function brokenNginx() { return { files: { "/etc/nginx/sites-available/kestrel": "server {\n\tlisten 80\n\tserver_name kestrel.example.com;\n}\n" } }; }
  LABS.push({
    id: "lx-122", n: 22, module: 3, ticket: "LX-122", xp: 130,
    title: "Conditions",
    topic: "if, [[ ]], && ||, case",
    from: MAYA,
    story: "<p>Scripts need to make decisions: is the file there? Is the disk too full? Which environment are we deploying to? Build four small checks the on-call team keeps asking for, and learn the one-line <code>&amp;&amp; ||</code> trick for quick ones at the prompt.</p>",
    learn:
      "<h3>if runs a command and looks at its exit code</h3>" + code(sc("if grep -q nginx /etc/passwd; then", "  echo \"nginx user exists\"", "else", "  echo \"no nginx user\"", "fi")) +
      "<p>Exit code 0 means true. Most of the time the command is <code>[[ ... ]]</code>, bash's test:</p>" +
      '<table class="t"><tr><th>Test</th><th>True when</th></tr><tr><td><code>[[ -f FILE ]]</code></td><td>FILE is a regular file</td></tr><tr><td><code>[[ -d DIR ]]</code></td><td>DIR is a folder</td></tr><tr><td><code>[[ -e PATH ]]</code></td><td>it exists (anything)</td></tr><tr><td><code>[[ -z "$s" ]]</code> / <code>-n</code></td><td>the string is empty / not empty</td></tr><tr><td><code>[[ $a == "$b" ]]</code> / <code>!=</code></td><td>strings equal / different (<code>==</code> also matches patterns: <code>[[ $f == *.log ]]</code>)</td></tr><tr><td><code>[[ $n -lt 80 ]]</code></td><td>numbers: <code>-eq -ne -lt -le -gt -ge</code></td></tr><tr><td><code>!</code>, <code>&amp;&amp;</code>, <code>||</code> inside</td><td>not, and, or</td></tr></table>' +
      code(sc("if [[ $1 -ge 90 ]]; then", "  echo \"CRITICAL\"", "elif [[ $1 -ge 80 ]]; then", "  echo \"WARNING\"", "fi")) +
      "<p>Spaces matter: <code>[[ $x -gt 5 ]]</code>, never <code>[[$x -gt 5]]</code>. <code>&lt;</code> and <code>&gt;</code> inside <code>[[ ]]</code> compare <b>text</b> (\"9\" &gt; \"10\"!), so use <code>-lt</code>/<code>-gt</code> for numbers. You'll also see the older <code>[ ... ]</code>: same idea, but stricter about quoting.</p>" +
      "<h3>&& and ||</h3>" + ex("mkdir -p /tmp/demo && cd /tmp/demo && pwd") + ex("ls /nope || echo \"not there\"") +
      "<p><code>a &amp;&amp; b</code> runs b only if a succeeded; <code>a || b</code> only if it failed. <code>a &amp;&amp; b || c</code> is a handy one-liner, as long as <code>b</code> can't fail.</p>" +
      "<h3>case: one value, many choices</h3>" + code(sc("case $1 in", "  start|up)   echo \"starting\" ;;", "  stop)       echo \"stopping\" ;;", "  *)          echo \"Unknown: $1\" >&2; exit 1 ;;", "esac")) +
      "<p>Patterns can use <code>|</code> (or) and wildcards; <code>*)</code> catches everything else. Each branch ends with <code>;;</code>.</p>",
    files: {},
    starter: "",
    objectives: [
      {
        id: "file", text: "Create <code>~/scripts/check-file.sh PATH</code>: if PATH is a regular file it prints <code>PATH exists</code> and exits 0; otherwise it prints <code>PATH is missing</code> to stderr and exits 1.",
        hints: ["if [[ -f \"$1\" ]]; then ... else ... fi. Remember exit 1 and >&2 in the else branch.", "if [[ -f \"$1\" ]]; then\n  echo \"$1 exists\"\nelse\n  echo \"$1 is missing\" >&2\n  exit 1\nfi"],
        check: function (r) {
          var b = basics(r, "~/scripts/check-file.sh"); if (b) return b;
          var y = call(r, HOME + "/scripts/check-file.sh /etc/hosts"), n = call(r, HOME + "/scripts/check-file.sh /etc/kestrel.conf"), d = call(r, HOME + "/scripts/check-file.sh /etc");
          if (!same(y.out, ["/etc/hosts exists"]) || y.exit !== 0) return "check-file.sh /etc/hosts should print /etc/hosts exists and exit 0 (got " + show(y.out) + ", exit " + y.exit + ").";
          if (n.exit !== 1 || n.out.length || !n.err.some(function (l) { return l === "/etc/kestrel.conf is missing"; })) return "check-file.sh /etc/kestrel.conf should print /etc/kestrel.conf is missing on stderr and exit 1.";
          return d.exit === 1 ? true : "/etc is a folder, not a regular file: use -f, so check-file.sh /etc says missing.";
        }
      },
      {
        id: "disk", text: "Create <code>~/scripts/disk-alert.sh PERCENT</code>: prints <code>OK</code> and exits 0 below 80, <code>WARNING</code> and exits 1 from 80 to 89, <code>CRITICAL</code> and exits 2 at 90 or more.",
        hints: ["Test the biggest threshold first: if -ge 90 ... elif -ge 80 ... else.", "if [[ $1 -ge 90 ]]; then echo CRITICAL; exit 2\nelif [[ $1 -ge 80 ]]; then echo WARNING; exit 1\nelse echo OK; fi"],
        check: function (r) {
          var b = basics(r, "~/scripts/disk-alert.sh"); if (b) return b;
          var tests = [[42, "OK", 0], [79, "OK", 0], [80, "WARNING", 1], [89, "WARNING", 1], [90, "CRITICAL", 2], [100, "CRITICAL", 2], [9, "OK", 0]];
          for (var i = 0; i < tests.length; i++) { var res = call(r, HOME + "/scripts/disk-alert.sh " + tests[i][0]); if (!same(res.out, [tests[i][1]]) || res.exit !== tests[i][2]) return "disk-alert.sh " + tests[i][0] + " should print " + tests[i][1] + " and exit " + tests[i][2] + " (got " + show(res.out) + ", exit " + res.exit + ")." + (tests[i][0] === 9 ? " Compare numbers with -ge/-lt, not < >: those compare text." : ""); }
          return true;
        }
      },
      {
        id: "andor", text: "At the prompt, in <b>one line</b> with <code>&amp;&amp;</code> and <code>||</code>: test nginx's config quietly and print <code>config OK</code> if it passes, <code>config BROKEN</code> if not.",
        hints: ["sudo nginx -t tests the config; >/dev/null 2>&1 hides its messages. Then && echo ... || echo ...", "sudo nginx -t >/dev/null 2>&1 && echo \"config OK\" || echo \"config BROKEN\""],
        check: function (r) {
          var i = idxOf(r, /nginx\s+-t/, function (e) { return /&&/.test(e.cmd) && /\|\|/.test(e.cmd) && same(e.out.map(rt), ["config OK"]); });
          if (i < 0) return "One line: sudo nginx -t, then && echo \"config OK\" || echo \"config BROKEN\". Hide nginx's own messages so only your words show.";
          var r2 = r.run(null, brokenNginx());
          return same((r2.history[i] || { out: [] }).out.map(rt), ["config BROKEN"]) ? true : "On a server with a broken config, your line didn't print exactly config BROKEN.";
        }
      },
      {
        id: "case", text: "Create <code>~/scripts/env-url.sh ENV</code> with <code>case</code>: <code>dev</code> → <code>http://localhost:8080</code>, <code>staging</code> → <code>https://staging.kestrel.io</code>, <code>prod</code> or <code>production</code> → <code>https://kestrel.io</code>; anything else prints <code>Unknown environment: ENV</code> to stderr and exits 1.",
        hints: ["case $1 in dev) ... ;; staging) ... ;; prod|production) ... ;; *) ... ;; esac", "case $1 in\n  dev) echo \"http://localhost:8080\" ;;\n  staging) echo \"https://staging.kestrel.io\" ;;\n  prod|production) echo \"https://kestrel.io\" ;;\n  *) echo \"Unknown environment: $1\" >&2; exit 1 ;;\nesac"],
        check: function (r) {
          var b = basics(r, "~/scripts/env-url.sh"); if (b) return b;
          var tests = [["dev", "http://localhost:8080"], ["staging", "https://staging.kestrel.io"], ["prod", "https://kestrel.io"], ["production", "https://kestrel.io"]];
          for (var i = 0; i < tests.length; i++) { var res = call(r, HOME + "/scripts/env-url.sh " + tests[i][0]); if (!same(res.out, [tests[i][1]]) || res.exit !== 0) return "env-url.sh " + tests[i][0] + " should print " + tests[i][1] + " (got " + show(res.out) + ")."; }
          var u = call(r, HOME + "/scripts/env-url.sh qa");
          if (u.exit !== 1 || u.out.length || !u.err.some(function (l) { return l === "Unknown environment: qa"; })) return "env-url.sh qa should print Unknown environment: qa on stderr and exit 1.";
          return /\bcase\b/.test(r.read(HOME + "/scripts/env-url.sh")) ? true : "Use a case statement for this one.";
        }
      }
    ],
    solution: sol(
      "mkdir -p ~/scripts",
      { nano: "~/scripts/check-file.sh", text: sc("#!/bin/bash", "if [[ -f \"$1\" ]]; then", "  echo \"$1 exists\"", "else", "  echo \"$1 is missing\" >&2", "  exit 1", "fi") },
      "chmod +x ~/scripts/check-file.sh", "~/scripts/check-file.sh /etc/hosts",
      { nano: "~/scripts/disk-alert.sh", text: sc("#!/bin/bash", "if [[ $1 -ge 90 ]]; then", "  echo \"CRITICAL\"", "  exit 2", "elif [[ $1 -ge 80 ]]; then", "  echo \"WARNING\"", "  exit 1", "else", "  echo \"OK\"", "fi") },
      "chmod +x ~/scripts/disk-alert.sh", "~/scripts/disk-alert.sh 85",
      "sudo nginx -t >/dev/null 2>&1 && echo \"config OK\" || echo \"config BROKEN\"",
      { nano: "~/scripts/env-url.sh", text: sc("#!/bin/bash", "case $1 in", "  dev)             echo \"http://localhost:8080\" ;;", "  staging)         echo \"https://staging.kestrel.io\" ;;", "  prod|production) echo \"https://kestrel.io\" ;;", "  *)               echo \"Unknown environment: $1\" >&2; exit 1 ;;", "esac") },
      "chmod +x ~/scripts/env-url.sh", "~/scripts/env-url.sh prod"),
    debrief: "<p>Your scripts can now decide. Notice the pattern in all four: a clear message for people, and an exit code for machines (<code>disk-alert.sh</code> even uses three, like real monitoring checks: 0 OK, 1 warning, 2 critical).</p><p>Next: doing things many times with loops.</p>",
    realworld: "Monitoring tools such as Nagios, Icinga and many Prometheus exporters use exactly the 0/1/2 exit codes of disk-alert.sh to mean OK/WARNING/CRITICAL.",
    quiz: [
      { q: "What does <code>if</code> actually test?", options: ["Whether the text after it is true", "The exit code of the command after it (0 = true)", "Whether a variable is set", "Only [[ ]] expressions"], answer: 1, why: "if runs a command; [[ ]] is just a command that exits 0 or 1." },
      { q: "Which compares the <b>numbers</b> 9 and 10 correctly?", options: ["[[ 9 < 10 ]]", "[[ 9 -lt 10 ]]", "[[ 9 lt 10 ]]", "[[ 9 << 10 ]]"], answer: 1, why: "< compares as text (\"9\" sorts after \"10\"). -lt compares numbers." },
      { q: "<code>cmd || echo failed</code> prints failed when...", options: ["cmd succeeds", "cmd exits non-zero", "always", "never"], answer: 1, why: "|| runs the right side only when the left side fails." }
    ]
  });

  /* ================================================================== LX-123 Loops */
  function logLines(prefix, n, errEvery) { var out = []; for (var i = 1; i <= n; i++) out.push("2026-11-11 08:" + (i < 10 ? "0" : "") + (i % 60) + ":00 " + (errEvery && i % errEvery === 0 ? "ERROR" : "INFO ") + " " + prefix + " event " + i); return out.join("\n") + "\n"; }
  var SERVERS = "name,ip,role\nkc-web-01,10.0.1.10,web\nkc-db-01,10.0.1.30,db\nkc-web-02,10.0.1.11,web\nkc-cache-01,10.0.1.40,cache\nkc-web-03,10.0.1.12,web\n";
  LABS.push({
    id: "lx-123", n: 23, module: 3, ticket: "LX-123", xp: 130,
    title: "Loops",
    topic: "for, while read, counters",
    from: MAYA,
    story: "<p>Ops work is mostly \"the same thing, for each of these\": each log file, each server in a list, each number from 1 to 5. Write the loops the team needs: shard folders, a log size report, the web servers from the inventory, and an error count with a total.</p>",
    learn:
      "<h3>for: each item of a list</h3>" + ex("for env in dev staging prod; do echo \"deploying to $env\"; done") +
      code(sc("for f in /var/log/nginx/*.log; do", "  echo \"$f: $(wc -l < \"$f\") lines\"", "done")) +
      "<p>The list can be words, a wildcard (expanded to file names, safely, even with spaces), <code>\"$@\"</code> (the script's arguments), or a range: <code>{1..5}</code>. On one line, separate the parts with <code>;</code>: <code>for x in a b; do ...; done</code>.</p>" +
      "<h3>while read: each line of a file</h3>" + code(sc("while read -r line; do", "  echo \"got: $line\"", "done < servers.txt")) +
      "<p><code>read -r</code> reads one line (the <code>-r</code> keeps backslashes as they are). Feed the whole loop with <code>&lt; file</code> at the end. To split fields, set <code>IFS</code> just for read:</p>" +
      code(sc("while IFS=, read -r name ip role; do", "  echo \"$name has $ip\"", "done < servers.csv")) +
      "<p>Skip a header line with <code>tail -n +2 file | while ...</code>, or test the first field: <code>[[ $name == name ]] &amp;&amp; continue</code>. <code>continue</code> jumps to the next round; <code>break</code> leaves the loop.</p>" +
      "<h3>Counting as you go</h3>" + code(sc("total=0", "for f in \"$@\"; do", "  n=$(grep -c ERROR \"$f\")", "  total=$(( total + n ))", "done", "echo \"total: $total\"")) +
      '<div class="callout">Don\'t loop over <code>$(ls)</code> or <code>$(cat file)</code>: names and lines with spaces get split into pieces. Use wildcards for files and <code>while read</code> for lines.</div>',
    files: {
      "logs/app.log": logLines("app", 120, 7), "logs/worker.log": logLines("worker", 30, 10), "logs/cron.log": logLines("cron", 12, 0),
      "logs/README.txt": "Kestrel logs. Only the .log files matter.\n",
      "servers.csv": SERVERS
    },
    starter: "",
    objectives: [
      {
        id: "shards", text: "With a <b>for loop</b> on one line, create the folders <code>~/shards/shard-1</code> to <code>~/shards/shard-5</code>.",
        hints: ["{1..5} gives the numbers; mkdir -p creates the parent too.", "for i in {1..5}; do mkdir -p ~/shards/shard-$i; done"],
        check: function (r) {
          for (var i = 1; i <= 5; i++) if (!r.isDir(HOME + "/shards/shard-" + i)) return "Missing ~/shards/shard-" + i + ".";
          if (r.list(HOME + "/shards").length !== 5) return "~/shards should contain just shard-1 to shard-5.";
          return ran(r, /\bfor\b.*\bdo\b.*mkdir|\bwhile\b.*\bdo\b.*mkdir/) ? true : "Make them with a loop (for i in ...; do mkdir ...; done), not one mkdir per folder.";
        }
      },
      {
        id: "sizes", text: "Create <code>~/scripts/log-sizes.sh DIR</code>: for each <code>.log</code> file in DIR, in name order, it prints <code>NAME: N lines</code> (just the file name, e.g. <code>app.log: 120 lines</code>). Other files are ignored.",
        hints: ["for f in \"$1\"/*.log; do ... done. wc -l < \"$f\" gives just the number; basename \"$f\" (or ${f##*/}) gives the name.", "for f in \"$1\"/*.log; do\n  echo \"$(basename \"$f\"): $(wc -l < \"$f\") lines\"\ndone"],
        check: function (r) {
          var b = basics(r, "~/scripts/log-sizes.sh"); if (b) return b;
          var a = call(r, HOME + "/scripts/log-sizes.sh " + HOME + "/logs");
          if (!same(a.out, ["app.log: 120 lines", "cron.log: 12 lines", "worker.log: 30 lines"])) return "log-sizes.sh ~/logs should print app.log: 120 lines, cron.log: 12 lines, worker.log: 30 lines (got " + show(a.out) + ").";
          var alt = { files: { "/tmp/other/b.log": "1\n2\n", "/tmp/other/a b.log": "x\n", "/tmp/other/c.txt": "no\n" } };
          var z = call(r, HOME + "/scripts/log-sizes.sh /tmp/other", alt);
          return same(z.out, ["a b.log: 1 lines", "b.log: 2 lines"]) ? true : "Tested on another folder (with a file called \"a b.log\"), it printed " + show(z.out) + ". Loop over \"$1\"/*.log and quote \"$f\".";
        }
      },
      {
        id: "web", text: "Create <code>~/scripts/web-servers.sh CSV</code>: it reads a <code>name,ip,role</code> file like <code>~/servers.csv</code> (with its header line) and prints <code>NAME (IP)</code> for each server whose role is <code>web</code>, in file order.",
        hints: ["while IFS=, read -r name ip role; do ... done < \"$1\". Inside: [[ $role == web ]] && echo ...", "while IFS=, read -r name ip role; do\n  [[ $role == web ]] && echo \"$name ($ip)\"\ndone < \"$1\""],
        check: function (r) {
          var b = basics(r, "~/scripts/web-servers.sh"); if (b) return b;
          var a = call(r, HOME + "/scripts/web-servers.sh " + HOME + "/servers.csv");
          if (!same(a.out, ["kc-web-01 (10.0.1.10)", "kc-web-02 (10.0.1.11)", "kc-web-03 (10.0.1.12)"])) return "With ~/servers.csv it should print the three web servers as NAME (IP) (got " + show(a.out) + ").";
          var alt = { files: { "/tmp/inv.csv": "name,ip,role\nlb-1,10.9.0.2,lb\nfront-a,10.9.0.5,web\nweb-old,10.9.0.6,retired\n" } };
          var z = call(r, HOME + "/scripts/web-servers.sh /tmp/inv.csv", alt);
          return same(z.out, ["front-a (10.9.0.5)"]) ? true : "With another inventory it printed " + show(z.out) + ": read the file given as $1, and match the role field exactly.";
        }
      },
      {
        id: "errors", text: "Create <code>~/scripts/count-errors.sh FILE...</code>: for each file given, it prints <code>FILE: N errors</code> (lines containing <code>ERROR</code>), then a last line <code>total: N</code>.",
        hints: ["Loop over \"$@\"; grep -c ERROR \"$f\" counts; keep a running total with $(( )).", "total=0\nfor f in \"$@\"; do\n  n=$(grep -c ERROR \"$f\")\n  echo \"$f: $n errors\"\n  total=$(( total + n ))\ndone\necho \"total: $total\""],
        check: function (r) {
          var b = basics(r, "~/scripts/count-errors.sh"); if (b) return b;
          var a = call(r, "cd /home/dev && /home/dev/scripts/count-errors.sh logs/app.log logs/worker.log logs/cron.log");
          var want = ["logs/app.log: 17 errors", "logs/worker.log: 3 errors", "logs/cron.log: 0 errors", "total: 20"];
          if (!same(a.out, want)) return "count-errors.sh logs/app.log logs/worker.log logs/cron.log should print " + show(want) + " (got " + show(a.out) + ").";
          var z = call(r, "cd /home/dev && /home/dev/scripts/count-errors.sh logs/worker.log", { files: { "logs/worker.log": logLines("worker", 40, 4) } });
          return same(z.out, ["logs/worker.log: 10 errors", "total: 10"]) ? true : "With one file of 10 errors it printed " + show(z.out) + ".";
        }
      }
    ],
    solution: sol("for i in {1..5}; do mkdir -p ~/shards/shard-$i; done", "ls ~/shards", "mkdir -p ~/scripts",
      { nano: "~/scripts/log-sizes.sh", text: sc("#!/bin/bash", "for f in \"$1\"/*.log; do", "  echo \"$(basename \"$f\"): $(wc -l < \"$f\") lines\"", "done") },
      "chmod +x ~/scripts/log-sizes.sh", "~/scripts/log-sizes.sh ~/logs",
      { nano: "~/scripts/web-servers.sh", text: sc("#!/bin/bash", "while IFS=, read -r name ip role; do", "  if [[ $role == web ]]; then", "    echo \"$name ($ip)\"", "  fi", "done < \"$1\"") },
      "chmod +x ~/scripts/web-servers.sh", "~/scripts/web-servers.sh ~/servers.csv",
      { nano: "~/scripts/count-errors.sh", text: sc("#!/bin/bash", "total=0", "for f in \"$@\"; do", "  n=$(grep -c ERROR \"$f\")", "  echo \"$f: $n errors\"", "  total=$(( total + n ))", "done", "echo \"total: $total\"") },
      "chmod +x ~/scripts/count-errors.sh", "cd ~ && ~/scripts/count-errors.sh logs/*.log"),
    debrief: "<p>Three kinds of loop, three kinds of list: numbers (<code>{1..5}</code>), files (a wildcard, which copes with spaces in names), and lines (<code>while read</code>). Plus the counter pattern you'll reuse constantly: start at 0, add each round, print at the end.</p><p>Next: functions, so you stop copying the same lines from script to script.</p>",
    realworld: "Loops plus ssh are how people ran fleets before tools like Ansible: for h in $(cat hosts); do ssh \"$h\" uptime; done. It's still handy for a quick look across a few servers.",
    quiz: [
      { q: "Why is <code>for f in *.log</code> better than <code>for f in $(ls *.log)</code>?", options: ["It's faster to type", "Names with spaces stay whole", "ls can't list .log files", "There's no difference"], answer: 1, why: "The wildcard gives each name as one item; $(ls) output gets split on spaces." },
      { q: "In <code>while IFS=, read -r a b c</code>, what does <code>IFS=,</code> do?", options: ["Sets the separator for every command after it", "Splits the line on commas, just for this read", "Skips lines with commas", "Joins a, b and c with commas"], answer: 1, why: "Putting VAR=value before a command sets it only for that command." },
      { q: "Which line adds n to total?", options: ["total = total + n", "total=$total+$n", "total=$(( total + n ))", "let total=total n"], answer: 2, why: "$(( )) does the arithmetic. $total+$n would just glue the text, e.g. 3+4." }
    ]
  });

  /* ================================================================== LX-124 Functions */
  var REPORT_BUG = sc("#!/bin/bash", "# For each folder given: a numbered line with how many files it holds", "count_files() {", "  i=0", "  for f in \"$1\"/*; do", "    [[ -f $f ]] && i=$(( i + 1 ))", "  done", "  files=$i", "}", "", "i=1", "for dir in \"$@\"; do", "  count_files \"$dir\"", "  echo \"$i. $dir: $files files\"", "  i=$(( i + 1 ))", "done");
  function noNginx(sys) { M2.stopUnit(sys, M2.loadUnit(sys, "nginx.service")); }
  LABS.push({
    id: "lx-124", n: 24, module: 3, ticket: "LX-124", xp: 130,
    title: "Functions",
    topic: "functions, local, return, source",
    from: MAYA,
    story: "<p>The team's scripts each carry their own copy of the same logging lines, and they've started to drift apart. Build a small shared library, <code>~/scripts/lib.sh</code>, with a <code>log</code> function and a <code>port_open</code> check that other scripts load. Then fix a report script whose numbering goes haywire because of a function.</p>",
    learn:
      "<h3>Defining and calling</h3>" + code(sc("greet() {", "  echo \"Hello, $1\"", "}", "greet Ana", "greet Ben")) +
      "<p>Inside a function, <code>$1</code>, <code>$2</code>, <code>\"$@\"</code> are the <b>function's</b> arguments, not the script's. Define a function before the line that calls it.</p>" +
      "<h3>Two ways to give something back</h3>" + code(sc("is_root() {", "  [[ $(id -u) -eq 0 ]]      # the exit code of the last command is the function's", "}", "upper() {", "  echo \"${1^^}\"            # output: capture it with $( )", "}", "if is_root; then echo \"root\"; fi", "name=$(upper kestrel)")) +
      "<p><code>return N</code> ends a function with exit code N (0 = success): use it for yes/no answers, so <code>if func</code> works. To return data, <b>print</b> it and capture with <code>$(func)</code>.</p>" +
      "<h3>local</h3><p>Variables in a function are global by default: a function that uses <code>i</code> overwrites the caller's <code>i</code>. Declare them <code>local</code>:</p>" +
      code(sc("count() {", "  local n=0", "  ...", "}")) +
      "<h3>Libraries: source</h3><p><code>source FILE</code> (or <code>. FILE</code>) runs a file in the <b>current</b> shell, so its functions and variables stay defined. Load a library that sits next to your script with its folder, <code>$(dirname \"$0\")</code>, so it works from any current directory:</p>" +
      code(sc("#!/bin/bash", "source \"$(dirname \"$0\")/lib.sh\"", "log \"starting\"")) +
      '<div class="callout">A library file has only definitions, no commands that do anything when it\'s sourced, and no <code>exit</code> (it would end the script that sourced it).</div>',
    files: {
      "scripts/report.sh": { content: REPORT_BUG, mode: 493 },
      "/srv/data/a/1.csv": "x\n", "/srv/data/a/2.csv": "x\n", "/srv/data/a/3.csv": "x\n", "/srv/data/b/1.csv": "x\n", "/srv/data/c/1.csv": "x\n", "/srv/data/c/2.csv": "x\n"
    },
    starter: "",
    objectives: [
      {
        id: "log", text: "Create <code>~/scripts/lib.sh</code> with a function <code>log</code> that prints the date and time in brackets, then all its arguments: <code>log Deploy started</code> → <code>[2026-11-11 09:00:00] Deploy started</code>. Sourcing the file must print nothing.",
        hints: ["date '+%F %T' gives 2026-11-11 09:00:00. \"$*\" is all the arguments as one string.", "log() {\n  echo \"[$(date '+%F %T')] $*\"\n}"],
        check: function (r) {
          var t = r.read(HOME + "/scripts/lib.sh");
          if (t === null) return "Create ~/scripts/lib.sh (nano ~/scripts/lib.sh).";
          var s0 = call(r, "source /home/dev/scripts/lib.sh");
          if (s0.out.length || s0.err.length) return "Sourcing lib.sh should print nothing: it should only define functions.";
          var res = call(r, "source /home/dev/scripts/lib.sh; log Deploy started");
          if (!same(res.out, ["[2026-11-11 09:00:00] Deploy started"])) return "log Deploy started should print [2026-11-11 09:00:00] Deploy started (got " + show(res.out) + ").";
          var later = call(r, "source /home/dev/scripts/lib.sh; log Two  words", { system: function (sys) { sys.now += 2 * DAY + 3600000; } });
          return same(later.out, ["[2026-11-13 10:00:00] Two words"]) ? true : "Use the current date and time from date: two days and an hour later it printed " + show(later.out) + ".";
        }
      },
      {
        id: "deploy", text: "Create <code>~/scripts/deploy.sh</code>: it loads <code>lib.sh</code> from its own folder and logs <code>Deploy started</code> then <code>Deploy finished</code>. It must work when run from any directory.",
        hints: ["source \"$(dirname \"$0\")/lib.sh\" finds lib.sh next to the script, whatever the current folder.", "#!/bin/bash\nsource \"$(dirname \"$0\")/lib.sh\"\nlog \"Deploy started\"\nlog \"Deploy finished\""],
        check: function (r) {
          var b = basics(r, "~/scripts/deploy.sh"); if (b) return b;
          var res = call(r, "cd /tmp && /home/dev/scripts/deploy.sh");
          if (!same(res.out, ["[2026-11-11 09:00:00] Deploy started", "[2026-11-11 09:00:00] Deploy finished"])) return "Run from /tmp, deploy.sh printed " + show(res.out) + (res.err.length ? " and the error " + show(res.err[0]) : "") + ". Load lib.sh with its full folder: source \"$(dirname \"$0\")/lib.sh\".";
          return /\b(source|\.)\s/.test(r.read(HOME + "/scripts/deploy.sh")) ? true : "Load the log function from lib.sh with source, don't copy it.";
        }
      },
      {
        id: "port", text: "Add <code>port_open PORT</code> to lib.sh: it prints nothing and returns 0 if something listens on that TCP port (<code>ss -tln</code>), 1 if not. Then create <code>~/scripts/ports.sh PORT...</code> that uses it to print <code>PORT open</code> or <code>PORT closed</code> for each.",
        hints: ["ss -tln lists listening ports like 0.0.0.0:80. grep -q \":$1 \" finds one quietly, and its exit code becomes the function's.", "port_open() {\n  ss -tln | grep -q \":$1 \"\n}\n... and in ports.sh:\nfor p in \"$@\"; do\n  if port_open \"$p\"; then echo \"$p open\"; else echo \"$p closed\"; fi\ndone"],
        check: function (r) {
          var a = call(r, "source /home/dev/scripts/lib.sh; port_open 22; echo \"rc=$?\"; port_open 5432; echo \"rc=$?\"");
          if (!same(a.out, ["rc=0", "rc=1"])) return "port_open 22 should print nothing and return 0; port_open 5432 return 1 (got " + show(a.out) + ").";
          var b = basics(r, "~/scripts/ports.sh"); if (b) return b;
          var p = call(r, "cd /tmp && /home/dev/scripts/ports.sh 22 80 5432");
          if (!same(p.out, ["22 open", "80 open", "5432 closed"])) return "ports.sh 22 80 5432 should print 22 open, 80 open, 5432 closed (got " + show(p.out) + ").";
          var z = call(r, "cd /tmp && /home/dev/scripts/ports.sh 80 22", { system: noNginx });
          if (!same(z.out, ["80 closed", "22 open"])) return "With nginx stopped, ports.sh 80 22 printed " + show(z.out) + ": check for real, with ss.";
          return /port_open/.test(r.read(HOME + "/scripts/ports.sh")) ? true : "ports.sh should use the port_open function from lib.sh.";
        }
      },
      {
        id: "local", text: "<code>~/scripts/report.sh /srv/data/a /srv/data/b /srv/data/c</code> numbers its lines wrong. Fix the function with <code>local</code> so the numbering is 1, 2, 3.",
        hints: ["Run it and look at the numbers. The function's i is the same variable as the loop's i.", "In count_files: local i=0 instead of i=0."],
        check: function (r) {
          var t = r.read(HOME + "/scripts/report.sh");
          var res = call(r, "/home/dev/scripts/report.sh /srv/data/a /srv/data/b /srv/data/c");
          if (!same(res.out, ["1. /srv/data/a: 3 files", "2. /srv/data/b: 1 files", "3. /srv/data/c: 2 files"])) return "report.sh /srv/data/a /srv/data/b /srv/data/c printed " + show(res.out) + ".";
          if (!/\blocal\s+i\b/.test(t)) return "Fix it inside the function with local i, so it stops touching the caller's i.";
          var z = call(r, "/home/dev/scripts/report.sh /srv/x /srv/y", { files: { "/srv/x/1": "1\n", "/srv/x/2": "1\n", "/srv/x/3": "1\n", "/srv/x/4": "1\n", "/srv/y/1": "1\n" } });
          return same(z.out, ["1. /srv/x: 4 files", "2. /srv/y: 1 files"]) ? true : "With other folders it printed " + show(z.out) + ".";
        }
      }
    ],
    solution: sol("mkdir -p ~/scripts",
      { nano: "~/scripts/lib.sh", text: sc("# Shared functions: source this file, don't run it.", "", "# log MESSAGE...: print the message with the date and time", "log() {", "  echo \"[$(date '+%F %T')] $*\"", "}", "", "# port_open PORT: succeed if something listens on this TCP port", "port_open() {", "  ss -tln | grep -q \":$1 \"", "}") },
      "source ~/scripts/lib.sh", "log Deploy started",
      { nano: "~/scripts/deploy.sh", text: sc("#!/bin/bash", "source \"$(dirname \"$0\")/lib.sh\"", "log \"Deploy started\"", "log \"Deploy finished\"") },
      "chmod +x ~/scripts/deploy.sh", "cd /tmp && ~/scripts/deploy.sh",
      { nano: "~/scripts/ports.sh", text: sc("#!/bin/bash", "source \"$(dirname \"$0\")/lib.sh\"", "for p in \"$@\"; do", "  if port_open \"$p\"; then", "    echo \"$p open\"", "  else", "    echo \"$p closed\"", "  fi", "done") },
      "chmod +x ~/scripts/ports.sh", "~/scripts/ports.sh 22 80 5432",
      "~/scripts/report.sh /srv/data/a /srv/data/b /srv/data/c",
      "sed -i 's/^  i=0$/  local i=0/' ~/scripts/report.sh",
      "~/scripts/report.sh /srv/data/a /srv/data/b /srv/data/c"),
    debrief: "<p>A library, a script that loads it from anywhere, a yes/no function that's just an exit code, and the classic global-variable bug: the function's <code>i</code> and the loop's <code>i</code> were the same variable until <code>local</code> separated them.</p><p>Next: making scripts <b>safe</b>, so one mistake stops the script instead of letting it carry on and do damage.</p>",
    realworld: "Big projects do exactly this: a lib/common.sh with logging, error and retry helpers, sourced by every other script. Look at /usr/share/bash-completion or /lib/lsb/init-functions on Ubuntu for real ones.",
    quiz: [
      { q: "How does a bash function hand back a <b>string</b>?", options: ["return \"text\"", "It prints it; the caller captures it with $(func)", "It sets $?", "It can't"], answer: 1, why: "return only takes a number 0-255 (an exit code). Data is printed and captured." },
      { q: "Why use <code>local</code> inside functions?", options: ["It's faster", "So the function doesn't overwrite the caller's variables", "It's required by bash", "To export the variable"], answer: 1, why: "Without local, every variable a function sets is global." },
      { q: "What's the difference between <code>./lib.sh</code> and <code>source lib.sh</code>?", options: ["None", "./ runs it in a new process, so its functions vanish; source runs it in your shell, so they stay", "source needs root", "./ is for libraries"], answer: 1, why: "That's why libraries are sourced." }
    ]
  });

  /* ================================================================== LX-125 Robust scripts */
  var ROTATE_BUG = sc("#!/bin/bash", "# Archive the Kestrel logs into ~/backups, then delete them.", "logdir=/var/log/kestrel", "cd $log_dir", "tar czf ~/backups/logs-$(date +%F).tar.gz *.log", "rm -f *.log", "echo \"Logs rotated\"");
  var ROTATE_FILES = {
    "scripts/rotate-logs.sh": { content: ROTATE_BUG, mode: 493 },
    "backups": { dir: true, mode: 493 },
    "/var/log/kestrel/app.log": { content: logLines("app", 40, 9), owner: "dev", group: "dev", mode: 420 },
    "/var/log/kestrel/worker.log": { content: logLines("worker", 25, 0), owner: "dev", group: "dev", mode: 420 },
    "deploy-notes.log": "2026-11-02 rolled out 1.3.2\n2026-11-09 rolled out 1.4.0 (needs the new env var)\n",
    "debug-session.log": "notes from the payments debugging session\n"
  };
  function homeLogsOk(c) { return c.exists(HOME + "/deploy-notes.log") && c.exists(HOME + "/debug-session.log"); }
  function kestrelDir(sys) { var d = M2.nodeAt(sys, "/var/log/kestrel"); if (d) { d.uid = 1000; d.gid = 1000; d.mode = 493; } }
  LABS.push({
    id: "lx-125", n: 25, module: 3, ticket: "LX-125", xp: 150,
    title: "Robust scripts",
    topic: "set -euo pipefail, trap, ShellCheck",
    from: DEV,
    story: "<p>A colleague's log rotation script deleted their notes last week. It has a typo: <code>$log_dir</code> instead of <code>$logdir</code>. The empty variable made <code>cd</code> go to the <b>home</b> folder, and the script happily archived and deleted the <code>.log</code> files there. Find the problems with ShellCheck, make the script stop at the first sign of trouble, fix it properly, and add clean-up that always runs.</p>" +
      '<div class="callout warn">Don\'t run <code>~/scripts/rotate-logs.sh</code> as it is: it deletes <code>~/deploy-notes.log</code> and <code>~/debug-session.log</code>. If you do, reset the machine.</div>',
    learn:
      "<h3>Bash carries on after errors</h3><p>By default a failing command just sets <code>$?</code> and the script goes on to the next line, and an unset variable is silently empty. Three options change that:</p>" +
      code(sc("#!/bin/bash", "set -euo pipefail")) +
      '<table class="t"><tr><th>Option</th><th>Effect</th></tr><tr><td><code>-e</code></td><td>exit as soon as a command fails (except in <code>if</code> tests and <code>&amp;&amp;</code>/<code>||</code> lists)</td></tr><tr><td><code>-u</code></td><td>using an unset variable is an error: typos stop the script instead of becoming empty strings</td></tr><tr><td><code>-o pipefail</code></td><td>a pipeline fails if any part fails, not only the last</td></tr></table>' +
      "<p>With <code>-e</code>, a command that's allowed to fail needs an explicit <code>|| true</code>. A <code>cd</code> should still be checked: <code>cd \"$dir\" || exit 1</code>.</p>" +
      "<h3>trap: clean up whatever happens</h3>" + code(sc("tmp=$(mktemp)", "trap 'rm -f \"$tmp\"' EXIT", "...", "")) +
      "<p><code>mktemp</code> makes a temporary file with a unique name (never pick a fixed name in /tmp). <code>trap 'COMMANDS' EXIT</code> runs the commands when the script ends, whether it finished, failed under <code>set -e</code>, or called <code>exit</code>. Use single quotes so <code>$tmp</code> is read when the trap runs. <code>trap '...' ERR</code> runs on a failing command; <code>$LINENO</code> says where:</p>" +
      code("trap 'echo \"failed at line $LINENO\" >&2' ERR") +
      "<h3>ShellCheck</h3><p>A linter that knows bash's traps: unquoted variables, unchecked <code>cd</code>, variables that are used but never set (your typo!). Install it with apt, run it on a script, fix what it says. Each finding has a code you can look up (SC2086...):</p>" +
      ex("sudo apt install -y shellcheck") +
      code("shellcheck ~/scripts/rotate-logs.sh") +
      "<p>It exits 0 when it finds nothing, so it's easy to put in CI (Module 4). <code>bash -n script.sh</code> only checks syntax without running anything; <code>bash -x script.sh</code> runs it and prints each command as it goes.</p>" +
      '<div class="callout">Start every script with <code>set -euo pipefail</code>, and run ShellCheck before trusting it. Together they catch most of the bugs that hurt people.</div>',
    files: ROTATE_FILES,
    system: kestrelDir,
    starter: "",
    objectives: [
      {
        id: "lint", text: "Install ShellCheck and run it on <code>~/scripts/rotate-logs.sh</code>. Look for the finding about <code>log_dir</code>.",
        hints: ["It's an apt package called shellcheck.", "sudo apt install -y shellcheck\nshellcheck ~/scripts/rotate-logs.sh"],
        check: function (r) {
          if (!r.sys.pkgs.shellcheck.installed) return "Install it first: sudo apt install shellcheck";
          return ran(r, /\bshellcheck\b.*rotate-logs/, function (e) { return outHas(e, /SC2154|log_dir is referenced but not assigned/); }) ? true : "Run shellcheck on ~/scripts/rotate-logs.sh (while it still has the typo) and read what it says about log_dir.";
        }
      },
      {
        id: "strict", text: "Before fixing anything else, add <code>set -euo pipefail</code> (just after the shebang) and run the script: it must now <b>stop</b> at the unset variable, without touching your home folder.",
        hints: ["Add the line, save, run ~/scripts/rotate-logs.sh. You should see 'log_dir: unbound variable'.", "nano ~/scripts/rotate-logs.sh, add set -euo pipefail as line 2, then ~/scripts/rotate-logs.sh"],
        check: function (r) {
          if (!homeLogsOk(r)) return "Your home .log files are gone: the script ran with the bug. Reset the machine and add set -euo pipefail before running it.";
          return ran(r, /rotate-logs\.sh/, function (e) { return e.err.some(function (l) { return /log_dir: unbound variable/.test(l); }); }) ? true : "Add set -euo pipefail and run the script while the typo is still there: it should stop with \"log_dir: unbound variable\".";
        }
      },
      {
        id: "fix", text: "Now fix it: the right variable name, every variable quoted, and <code>cd ... || exit 1</code>. Run it: the logs from /var/log/kestrel end up in <code>~/backups/logs-2026-11-11.tar.gz</code> and are deleted from /var/log/kestrel.",
        hints: ["cd \"$logdir\" || exit 1, and quote the tar file name: \"$HOME/backups/logs-$(date +%F).tar.gz\".", "logdir=/var/log/kestrel\ncd \"$logdir\" || exit 1\ntar czf \"$HOME/backups/logs-$(date +%F).tar.gz\" ./*.log\nrm -f -- ./*.log"],
        check: function (r) {
          if (!homeLogsOk(r)) return "Your home .log files are gone. Reset the machine and run the script only once it's safe.";
          var t = r.read(HOME + "/scripts/rotate-logs.sh") || "";
          if (/\$log_dir\b|\$\{log_dir/.test(t)) return "The script still uses $log_dir: the variable is called logdir.";
          if (!/set\s+-[a-z]*e[a-z]*u[a-z]*o\s+pipefail|set\s+-euo\s+pipefail/.test(t)) return "Keep set -euo pipefail in the script.";
          var arc = r.read(HOME + "/backups/logs-2026-11-11.tar.gz");
          var ra = arc ? M2.readArchive(arc) : null;
          var names = ra && ra.entries ? ra.entries.map(function (x) { return String(x.p || "").replace(/^\.\//, ""); }) : [];
          if (!arc) return "Run the fixed script: ~/backups/logs-2026-11-11.tar.gz should appear.";
          if (names.indexOf("app.log") < 0 || names.indexOf("worker.log") < 0) return "The archive should contain app.log and worker.log (it has " + show(names) + ").";
          if (r.list("/var/log/kestrel").some(function (n) { return /\.log$/.test(n); })) return "The .log files should be deleted from /var/log/kestrel after archiving.";
          var z = call(r, "echo x > /var/log/kestrel/extra.log; cd / && /home/dev/scripts/rotate-logs.sh");
          return homeLogsOk(z.c) && z.exit === 0 ? true : "Run from another folder (cd / first), the script failed or touched the home folder.";
        }
      },
      {
        id: "trap", text: "Make it list what it archives in a temporary file from <code>mktemp</code>, end by printing <code>Rotated N logs</code> (N from that list), and remove the temp file with <code>trap ... EXIT</code>: nothing may be left behind in /tmp, even when the script fails.",
        hints: ["list=$(mktemp) then trap 'rm -f \"$list\"' EXIT. printf '%s\\n' *.log > \"$list\" writes one name per line; wc -l < \"$list\" counts them.", "list=$(mktemp)\ntrap 'rm -f \"$list\"' EXIT\n...\nprintf '%s\\n' *.log > \"$list\"\n...\necho \"Rotated $(wc -l < \"$list\") logs\""],
        check: function (r) {
          var t = r.read(HOME + "/scripts/rotate-logs.sh") || "";
          if (!/\bmktemp\b/.test(t)) return "Create the temporary file with mktemp.";
          if (!/\btrap\b[^\n]*\bEXIT\b/.test(t)) return "Remove it with a trap on EXIT.";
          var before = tmpList(r);
          var c = r.after("for n in a b c; do echo \"$n\" > /var/log/kestrel/$n.log; done; /home/dev/scripts/rotate-logs.sh"), e = last(c);
          if (rt(e.out[e.out.length - 1] || "") !== "Rotated 3 logs") return "With 3 logs to rotate, the last line should be Rotated 3 logs (got " + show(e.out.map(rt)) + ").";
          if (!same(tmpList(c), before)) return "After a successful run, something was left in /tmp: " + show(tmpList(c).filter(function (x) { return before.indexOf(x) < 0; })) + ".";
          var bad = r.run(null, { system: function (sys) { kestrelDir(sys); M2.rmRoot(sys, "/var/log/kestrel"); } });
          var b2 = tmpList(bad), c2 = bad.after("/home/dev/scripts/rotate-logs.sh"), e2 = last(c2);
          if (e2.exit === 0) return "When /var/log/kestrel doesn't exist, the script should fail (non-zero exit), not report success.";
          return same(tmpList(c2), b2) ? true : "When the script fails (no /var/log/kestrel), its temp file is left in /tmp. The trap must be set before anything can fail.";
        }
      },
      {
        id: "clean", text: "Run ShellCheck on the final script: no findings at all.",
        hints: ["Quote every \"$var\", use ./*.log or -- *.log with rm.", "shellcheck ~/scripts/rotate-logs.sh (no output, exit 0)"],
        check: function (r) {
          var t = r.read(HOME + "/scripts/rotate-logs.sh") || "";
          var f = M3.lint(t);
          if (f.length) return "ShellCheck still finds: " + f[0].code + " on line " + f[0].line + " (" + f[0].message + ")" + (f.length > 1 ? " and " + (f.length - 1) + " more" : "") + ".";
          var k = lastEdit(r, "~/scripts/rotate-logs.sh");
          return r.history.some(function (e, i) { return i > k && /\bshellcheck\b.*rotate-logs/.test(e.cmd) && e.exit === 0; }) ? true : "Run shellcheck on the final version yourself and see it pass (no output).";
        }
      }
    ],
    solution: sol("sudo apt install -y shellcheck", "shellcheck ~/scripts/rotate-logs.sh",
      { nano: "~/scripts/rotate-logs.sh", text: sc("#!/bin/bash", "set -euo pipefail", "# Archive the Kestrel logs into ~/backups, then delete them.", "logdir=/var/log/kestrel", "cd $log_dir", "tar czf ~/backups/logs-$(date +%F).tar.gz *.log", "rm -f *.log", "echo \"Logs rotated\"") },
      "~/scripts/rotate-logs.sh",
      { nano: "~/scripts/rotate-logs.sh", text: sc("#!/bin/bash", "set -euo pipefail", "# Archive the Kestrel logs into ~/backups, then delete them.", "logdir=/var/log/kestrel", "list=$(mktemp)", "trap 'rm -f \"$list\"' EXIT", "cd \"$logdir\" || exit 1", "printf '%s\\n' ./*.log > \"$list\"", "tar czf \"$HOME/backups/logs-$(date +%F).tar.gz\" ./*.log", "rm -f -- ./*.log", "echo \"Rotated $(wc -l < \"$list\") logs\"") },
      "~/scripts/rotate-logs.sh", "ls ~/backups /var/log/kestrel",
      "shellcheck ~/scripts/rotate-logs.sh"),
    debrief: "<p>The original script had no bad intent, just one typo, and bash's defaults turned it into data loss: an empty variable, a <code>cd</code> nobody checked, and a script that kept going. <code>set -u</code> stopped it at the typo; <code>cd ... || exit</code> would have stopped it at the wrong folder; ShellCheck flagged both before you ran anything.</p><p>The trap makes clean-up reliable: it runs on success, on failure and on <code>exit</code>. Next: scripts that take options and read input like real command-line tools.</p>",
    realworld: "Steam for Linux once shipped an update script with rm -rf \"$STEAMROOT/\"* where STEAMROOT could end up empty, and it wiped users' home folders. ShellCheck's SC2115 exists for exactly that line.",
    quiz: [
      { q: "With <code>set -u</code>, using <code>$log_dir</code> when only <code>logdir</code> exists...", options: ["expands to nothing", "stops the script with 'unbound variable'", "asks you for a value", "uses logdir"], answer: 1, why: "-u turns unset variables into errors, so typos stop the script." },
      { q: "When does <code>trap 'rm -f \"$tmp\"' EXIT</code> run?", options: ["Only if the script succeeds", "Only on Ctrl+C", "Whenever the script exits, success or failure", "Right away"], answer: 2, why: "EXIT fires however the script ends: last line, exit, or set -e stopping it." },
      { q: "Why create temp files with <code>mktemp</code> instead of <code>/tmp/myscript.tmp</code>?", options: ["It's shorter", "A unique, private name: no clashes between runs, and no other user can plant a file there first", "mktemp files are deleted automatically", "/tmp is read-only"], answer: 1, why: "Fixed names in /tmp are a classic security hole (symlink attacks) and break when two copies run at once. mktemp files are NOT deleted for you: that's what the trap is for." }
    ]
  });

  /* ================================================================== LX-126 Options & input */
  var SITE_TMPL = function (d) { return "server {\n    listen 80;\n    server_name " + d + ";\n    root /var/www/" + d + ";\n}\n"; };
  LABS.push({
    id: "lx-126", n: 26, module: 3, ticket: "LX-126", xp: 140,
    title: "Options & input",
    topic: "getopts, read, here-docs",
    from: MAYA,
    story: "<p>Scripts that other people use should behave like real tools: <code>-h</code> for help, options in any order, clear errors for bad input, a confirmation before anything destructive. Build a backup tool with options, a confirmation prompt, and a generator that writes nginx site configs from a template.</p>",
    learn:
      "<h3>getopts</h3>" + code(sc("dry=0; dest=/srv/backups", "while getopts \"nd:h\" opt; do", "  case $opt in", "    n) dry=1 ;;", "    d) dest=$OPTARG ;;", "    h) echo \"Usage: backup.sh [-n] [-d DEST] SRC\"; exit 0 ;;", "    *) echo \"Usage: backup.sh [-n] [-d DEST] SRC\" >&2; exit 2 ;;", "  esac", "done", "shift $(( OPTIND - 1 ))", "src=${1:-}")) +
      "<p>Each letter in <code>\"nd:h\"</code> is an option; a <b>colon</b> after it means it takes a value, which arrives in <code>$OPTARG</code>. getopts prints its own message for unknown options and sets <code>opt</code> to <code>?</code>, caught by <code>*)</code>. After the loop, <code>shift $(( OPTIND - 1 ))</code> drops the options so <code>$1</code> is the first real argument. Options can be combined: <code>-nd /tmp</code>.</p>" +
      "<p>Exit code 2 is the convention for \"you called me wrong\".</p>" +
      "<h3>read: asking a question</h3>" + code(sc("read -r -p \"Continue? [y/N] \" answer", "if [[ $answer == [yY] ]]; then", "  echo \"Proceeding\"", "fi")) +
      "<p><code>-p</code> shows a prompt, <code>-r</code> keeps backslashes. In this lab's terminal you can't type into a running script, so feed it the answer instead, exactly like you would in automation:</p>" +
      ex("echo y | read -r a; echo \"(a pipe gives read its line)\"") + code("echo y | ~/scripts/confirm.sh\n~/scripts/confirm.sh <<< n") +
      "<h3>Here-documents: writing many lines</h3>" + code(sc("cat > \"$file\" <<EOF", "server {", "    server_name $domain;", "}", "EOF")) +
      "<p>Everything up to the line <code>EOF</code> is fed to the command's input, with variables expanded. Quote the marker (<code>&lt;&lt;'EOF'</code>) to keep <code>$</code> as it is. Use <code>&lt;&lt;-EOF</code> to allow tab-indented lines. For a single line there's the here-string: <code>wc -w &lt;&lt;&lt; \"$text\"</code>.</p>",
    files: { "notes": { dir: true, mode: 493 }, "notes/todo.txt": "renew the TLS cert\n" },
    starter: "",
    objectives: [
      {
        id: "opts", text: "Create <code>~/scripts/backup.sh [-n] [-d DEST] [-h] SRC</code>. <code>-d</code> sets the destination (default <code>/srv/backups</code>). With <code>-n</code> it only prints <code>Would back up SRC to DEST</code>. <code>-h</code> prints <code>Usage: backup.sh [-n] [-d DEST] SRC</code> and exits 0.",
        hints: ["getopts \"nd:h\": d takes a value. After the loop, shift $(( OPTIND - 1 )) and SRC is $1.", "while getopts \"nd:h\" opt; do case $opt in n) dry=1 ;; d) dest=$OPTARG ;; h) usage; exit 0 ;; ... esac; done"],
        check: function (r) {
          var b = basics(r, "~/scripts/backup.sh"); if (b) return b;
          var tests = [["-n -d /tmp/b /etc/nginx", "Would back up /etc/nginx to /tmp/b"], ["-n /var/www", "Would back up /var/www to /srv/backups"], ["-d /mnt/x -n /home/dev/notes", "Would back up /home/dev/notes to /mnt/x"], ["-nd /opt/y /etc", "Would back up /etc to /opt/y"]];
          for (var i = 0; i < tests.length; i++) { var res = call(r, HOME + "/scripts/backup.sh " + tests[i][0]); if (!same(res.out, [tests[i][1]]) || res.exit !== 0) return "backup.sh " + tests[i][0] + " should print \"" + tests[i][1] + "\" (got " + show(res.out) + ", exit " + res.exit + ")."; }
          var h = call(r, HOME + "/scripts/backup.sh -h");
          return same(h.out, ["Usage: backup.sh [-n] [-d DEST] SRC"]) && h.exit === 0 ? true : "backup.sh -h should print Usage: backup.sh [-n] [-d DEST] SRC and exit 0 (got " + show(h.out) + ", exit " + h.exit + ").";
        }
      },
      {
        id: "bad", text: "Bad input: an unknown option or a missing SRC prints the usage line to <b>stderr</b> and exits <b>2</b>. Without <code>-n</code>, it really copies: <code>backup.sh -d DEST SRC</code> creates DEST if needed, copies SRC into it and prints <code>Backed up SRC to DEST</code>.",
        hints: ["In the *) branch and after the loop when [[ -z ${1:-} ]]: echo the usage >&2; exit 2. For the copy: mkdir -p \"$dest\" && cp -r \"$src\" \"$dest\"/", "if [[ -z $src ]]; then echo \"Usage: ...\" >&2; exit 2; fi\nmkdir -p \"$dest\"\ncp -r \"$src\" \"$dest\"/\necho \"Backed up $src to $dest\""],
        check: function (r) {
          var b = basics(r, "~/scripts/backup.sh"); if (b) return b;
          var x = call(r, HOME + "/scripts/backup.sh -x /etc");
          if (x.exit !== 2 || x.out.length || !x.err.some(function (l) { return /^Usage: backup\.sh/.test(l); })) return "backup.sh -x /etc should print the usage line on stderr and exit 2 (got stdout " + show(x.out) + ", exit " + x.exit + ").";
          var m = call(r, HOME + "/scripts/backup.sh -n");
          if (m.exit !== 2 || !m.err.some(function (l) { return /^Usage: backup\.sh/.test(l); })) return "backup.sh -n (no SRC) should print the usage line on stderr and exit 2 (exit was " + m.exit + ").";
          var c = call(r, "cd /tmp && " + HOME + "/scripts/backup.sh -d /tmp/bk/new /home/dev/notes");
          if (!same(c.out, ["Backed up /home/dev/notes to /tmp/bk/new"])) return "backup.sh -d /tmp/bk/new /home/dev/notes should print Backed up /home/dev/notes to /tmp/bk/new (got " + show(c.out) + (c.err.length ? ", error " + show(c.err[0]) : "") + ").";
          return c.c.read("/tmp/bk/new/notes/todo.txt") === "renew the TLS cert\n" ? true : "It printed the message, but /tmp/bk/new/notes/todo.txt isn't there: copy the folder with cp -r into DEST (mkdir -p it first).";
        }
      },
      {
        id: "confirm", text: "Create <code>~/scripts/confirm.sh</code>: it asks <code>Delete old backups? [y/N] </code> with <code>read</code>. On <code>y</code> or <code>Y</code> it prints <code>Deleting</code> and exits 0; on anything else (even an empty answer) <code>Aborted</code> and exits 1. Test it with <code>echo y | ~/scripts/confirm.sh</code>.",
        hints: ["read -r -p \"Delete old backups? [y/N] \" answer, then [[ $answer == [yY] ]].", "read -r -p \"Delete old backups? [y/N] \" answer\nif [[ $answer == [yY] ]]; then echo \"Deleting\"; else echo \"Aborted\"; exit 1; fi"],
        check: function (r) {
          var b = basics(r, "~/scripts/confirm.sh"); if (b) return b;
          var tests = [["y", "Deleting", 0], ["Y", "Deleting", 0], ["n", "Aborted", 1], ["yes please", "Aborted", 1], ["", "Aborted", 1]];
          for (var i = 0; i < tests.length; i++) {
            var res = call(r, "printf '%s\\n' " + q(tests[i][0]) + " | " + HOME + "/scripts/confirm.sh");
            if (res.out[res.out.length - 1] !== tests[i][1] || res.exit !== tests[i][2]) return "Answering " + show(tests[i][0]) + " should give " + tests[i][1] + " and exit " + tests[i][2] + " (got " + show(res.out) + ", exit " + res.exit + ").";
          }
          return /\bread\b/.test(r.read(HOME + "/scripts/confirm.sh")) ? true : "Ask with read.";
        }
      },
      {
        id: "heredoc", text: "Create <code>~/scripts/make-site.sh DOMAIN</code>: it writes <code>~/sites/DOMAIN.conf</code> with a here-doc (create ~/sites if needed). For <code>shop.kestrel.io</code> the file is exactly:<pre class=\"code\">" + SITE_TMPL("shop.kestrel.io").replace(/</g, "&lt;") + "</pre>",
        hints: ["mkdir -p ~/sites, then cat > \"$HOME/sites/$1.conf\" <<EOF ... EOF, with $1 where the domain goes.", "domain=$1\nmkdir -p \"$HOME/sites\"\ncat > \"$HOME/sites/$domain.conf\" <<EOF\nserver {\n    listen 80;\n    server_name $domain;\n    root /var/www/$domain;\n}\nEOF"],
        check: function (r) {
          var b = basics(r, "~/scripts/make-site.sh"); if (b) return b;
          var res = call(r, "cd /tmp && " + HOME + "/scripts/make-site.sh shop.kestrel.io");
          var got = res.c.read(HOME + "/sites/shop.kestrel.io.conf");
          if (got === null) return "make-site.sh shop.kestrel.io should create ~/sites/shop.kestrel.io.conf" + (res.err.length ? " (it said " + show(res.err[0]) + ")" : "") + ".";
          if (got.replace(/\s+$/, "") !== SITE_TMPL("shop.kestrel.io").replace(/\s+$/, "")) return "~/sites/shop.kestrel.io.conf doesn't match the template exactly. It has:\n" + got;
          var z = call(r, HOME + "/scripts/make-site.sh blog.example.org");
          return (z.c.read(HOME + "/sites/blog.example.org.conf") || "").replace(/\s+$/, "") === SITE_TMPL("blog.example.org").replace(/\s+$/, "") ? true : "For blog.example.org the file isn't right: use the argument everywhere the domain appears.";
        }
      }
    ],
    solution: sol("mkdir -p ~/scripts",
      { nano: "~/scripts/backup.sh", text: sc("#!/bin/bash", "set -euo pipefail", "usage() { echo \"Usage: backup.sh [-n] [-d DEST] SRC\"; }", "dry=0", "dest=/srv/backups", "while getopts \"nd:h\" opt; do", "  case $opt in", "    n) dry=1 ;;", "    d) dest=$OPTARG ;;", "    h) usage; exit 0 ;;", "    *) usage >&2; exit 2 ;;", "  esac", "done", "shift $(( OPTIND - 1 ))", "src=${1:-}", "if [[ -z $src ]]; then", "  usage >&2", "  exit 2", "fi", "if [[ $dry -eq 1 ]]; then", "  echo \"Would back up $src to $dest\"", "  exit 0", "fi", "mkdir -p \"$dest\"", "cp -r \"$src\" \"$dest\"/", "echo \"Backed up $src to $dest\"") },
      "chmod +x ~/scripts/backup.sh", "~/scripts/backup.sh -n -d /tmp/b /etc/nginx", "~/scripts/backup.sh -h", "~/scripts/backup.sh -d /tmp/bk ~/notes",
      { nano: "~/scripts/confirm.sh", text: sc("#!/bin/bash", "read -r -p \"Delete old backups? [y/N] \" answer", "if [[ $answer == [yY] ]]; then", "  echo \"Deleting\"", "else", "  echo \"Aborted\"", "  exit 1", "fi") },
      "chmod +x ~/scripts/confirm.sh", "echo y | ~/scripts/confirm.sh", "~/scripts/confirm.sh <<< n",
      { nano: "~/scripts/make-site.sh", text: sc("#!/bin/bash", "set -euo pipefail", "domain=$1", "mkdir -p \"$HOME/sites\"", "cat > \"$HOME/sites/$domain.conf\" <<EOF", "server {", "    listen 80;", "    server_name $domain;", "    root /var/www/$domain;", "}", "EOF") },
      "chmod +x ~/scripts/make-site.sh", "~/scripts/make-site.sh shop.kestrel.io", "cat ~/sites/shop.kestrel.io.conf"),
    debrief: "<p>Your backup script now behaves like a proper Unix tool: options in any order, <code>-h</code>, usage errors on stderr with exit code 2, and a dry-run mode (always offer one for anything destructive). The confirmation defaults to <b>No</b>, so a stray Enter can't delete anything. And the here-doc turned a template into real config files.</p><p>One ticket left in this module: put it all together in a health-check script.</p>",
    realworld: "Every getopts tool you write can be tested like you just did: printf 'y\\n' | ./confirm.sh, ./backup.sh -n .... That's how CI tests scripts that would normally ask questions.",
    quiz: [
      { q: "In <code>getopts \"nd:h\" opt</code>, what does the colon after d mean?", options: ["-d is required", "-d takes a value, in $OPTARG", "-d can be repeated", "-d is the last option"], answer: 1, why: "A colon after a letter means the option takes an argument." },
      { q: "What does <code>shift $(( OPTIND - 1 ))</code> do after the getopts loop?", options: ["Resets getopts", "Removes the options, so $1 is the first non-option argument", "Shifts all arguments by one", "Counts the options"], answer: 1, why: "OPTIND is the index of the next argument getopts would read." },
      { q: "How do you stop variables expanding inside a here-doc?", options: ["Put the text in single quotes", "Quote the marker: <<'EOF'", "Use <<-", "You can't"], answer: 1, why: "A quoted delimiter keeps the body exactly as written." }
    ]
  });

  /* ================================================================== LX-127 Capstone: health check */
  function fullRoot(sys) { sys.mounts[1].used = Math.round(sys.mounts[1].size * 0.95); }
  function hcLines(res) { return res.out.filter(function (l) { return /^(OK|FAIL)\b/.test(l); }); }
  function hcState(res) {
    var st = {};
    hcLines(res).forEach(function (l) { var m = /^(OK|FAIL)\s+(\S+)/.exec(l); if (m) st[m[2].replace(/:$/, "")] = m[1]; });
    return st;
  }
  var HC = "/home/dev/scripts/healthcheck.sh";
  function rootPct(c) { var m = M2.mountOf(c.sys, "/"); return M2.mountUsage(c.sys, m).pct; }
  LABS.push({
    id: "lx-127", n: 27, module: 3, ticket: "LX-127", xp: 250, capstone: true,
    title: "The health-check script",
    topic: "Module 3 capstone",
    from: MAYA,
    story: "<p>On-call keeps running the same checks by hand when an alert fires. Write <code>~/scripts/healthcheck.sh</code> so a single command answers \"is kc-web-01 healthy?\", and schedule it so there's a history to look at.</p>" +
      "<p><b>What it checks</b>, one line each, starting with <code>OK</code> or <code>FAIL</code>, then the check's name, then anything you like:</p>" +
      '<table class="t"><tr><th>Name</th><th>OK when</th></tr><tr><td><code>disk</code></td><td>the root filesystem <code>/</code> is used <b>below</b> the limit (default 90%)</td></tr><tr><td><code>nginx</code></td><td>the nginx service is active</td></tr><tr><td><code>kestrel-app</code></td><td>the kestrel-app service is active</td></tr><tr><td><code>http</code></td><td><code>http://localhost/</code> answers with status 200</td></tr></table>' +
      "<p>For example: <code>OK disk 77% used</code>, <code>FAIL nginx</code>. It exits <b>0</b> if every check is OK and <b>1</b> if any failed. Options: <code>-t PERCENT</code> sets the disk limit; <code>-q</code> prints only the FAIL lines.</p>" +
      "<p>It must start with <code>set -euo pipefail</code>, pass ShellCheck with no findings, and run every 5 minutes from your crontab, appending its output to <code>~/healthcheck.log</code>.</p>",
    learn: "<p>No new commands here: this is everything from Module 3 together, plus a few pieces from Module 2 (<code>systemctl is-active</code>, <code>df</code>, <code>curl</code>, <code>crontab</code>). Build it a check at a time, run it after each one, and run ShellCheck often.</p>" +
      "<p>Useful bits: <code>systemctl is-active --quiet UNIT</code> answers with its exit code only; <code>df --output=pcent / | tail -1</code> prints the use percentage of /; <code>curl -s -o /dev/null -w '%{http_code}' URL</code> prints just the status code (000 if nothing answers).</p>" +
      '<div class="callout">With <code>set -e</code>, a check that fails must not end the script: test it in an <code>if</code>, or add <code>|| true</code> where a command is allowed to fail.</div>',
    files: {},
    starter: "",
    objectives: [
      {
        id: "checks", hints: [], text: "On a healthy server every check prints OK and the script exits 0; when nginx is stopped, <code>nginx</code> and <code>http</code> FAIL and it exits 1; when the disk is 95% full, <code>disk</code> FAILs.",
        check: function (r) {
          var b = basics(r, "~/scripts/healthcheck.sh"); if (b) return b;
          var good = call(r, "cd /tmp && " + HC), g = hcState(good);
          var names = ["disk", "nginx", "kestrel-app", "http"];
          var miss = names.filter(function (n) { return !g[n]; });
          if (miss.length) return "On a healthy server, these checks printed no OK/FAIL line: " + miss.join(", ") + ". It printed " + show(good.out) + (good.err.length ? " and the error " + show(good.err[0]) : "") + ".";
          var bad = names.filter(function (n) { return g[n] !== "OK"; });
          if (bad.length) return "On a healthy server these should be OK: " + bad.join(", ") + " (got " + show(hcLines(good)) + ").";
          if (good.exit !== 0) return "All checks pass, so it should exit 0 (it exited " + good.exit + ").";
          var down = call(r, "cd /tmp && " + HC, { system: noNginx }), d = hcState(down);
          if (d.nginx !== "FAIL" || d.http !== "FAIL" || d.disk !== "OK" || d["kestrel-app"] !== "OK") return "With nginx stopped, nginx and http should FAIL and the rest be OK. It printed " + show(hcLines(down)) + (down.err.length ? " and the error " + show(down.err[0]) : "") + ".";
          if (down.exit !== 1) return "With a failed check it should exit 1 (it exited " + down.exit + ").";
          var full = call(r, "cd /tmp && " + HC, { system: fullRoot }), f = hcState(full);
          if (f.disk !== "FAIL" || f.nginx !== "OK") return "With / 95% full, disk should FAIL (got " + show(hcLines(full)) + ").";
          return full.exit === 1 ? true : "With a full disk it should exit 1 (it exited " + full.exit + ").";
        }
      },
      {
        id: "options", hints: [], text: "<code>-t PERCENT</code> changes the disk limit, and <code>-q</code> prints only the FAIL lines (nothing at all when everything is OK).",
        check: function (r) {
          var pct = rootPct(r);
          var low = call(r, HC + " -t " + (pct - 5)), hi = call(r, HC + " -t " + (pct + 5));
          if (hcState(low).disk !== "FAIL" || low.exit !== 1) return "With -t " + (pct - 5) + " (below the current " + pct + "%), disk should FAIL and the exit code be 1.";
          if (hcState(hi).disk !== "OK" || hi.exit !== 0) return "With -t " + (pct + 5) + ", disk should be OK and the exit code 0.";
          var q1 = call(r, HC + " -q");
          if (q1.out.length || q1.exit !== 0) return "On a healthy server, -q should print nothing and exit 0 (got " + show(q1.out) + ").";
          var q2 = call(r, HC + " -q", { system: noNginx });
          return same(hcLines(q2).map(function (l) { return l.split(/\s+/).slice(0, 2).join(" "); }), ["FAIL nginx", "FAIL http"]) && hcLines(q2).length === q2.out.length && q2.exit === 1 ? true : "With nginx stopped, -q should print just the two FAIL lines (nginx, http) and exit 1 (got " + show(q2.out) + ").";
        }
      },
      {
        id: "robust", hints: [], text: "The script starts with <code>set -euo pipefail</code> and ShellCheck has nothing to say about it.",
        check: function (r) {
          var t = r.read(HC) || "";
          var first = t.split("\n").filter(function (l) { return l.trim() && !/^\s*#/.test(l); })[0] || "";
          if (!/^set\s+-euo\s+pipefail\b/.test(first.trim())) return "The first command in the script should be set -euo pipefail.";
          var f = M3.lint(t);
          return f.length ? "ShellCheck finds " + f[0].code + " on line " + f[0].line + ": " + f[0].message : true;
        }
      },
      {
        id: "cron", hints: [], text: "Your crontab runs it every 5 minutes, appending everything it prints (output and errors) to <code>~/healthcheck.log</code>.",
        check: function (r) {
          var tab = r.read("/var/spool/cron/crontabs/dev");
          if (!tab) return "dev has no crontab yet (crontab -e, or (crontab -l; echo ...) | crontab -).";
          var line = tab.split("\n").filter(function (l) { return /healthcheck\.sh/.test(l) && !/^\s*#/.test(l); })[0];
          if (!line) return "No crontab line runs healthcheck.sh.";
          if (!/^\*\/5\s+\*\s+\*\s+\*\s+\*\s/.test(line)) return "The schedule should be every 5 minutes: */5 * * * *";
          if (!/(\/home\/dev|~|\$HOME)\/scripts\/healthcheck\.sh/.test(line)) return "Use the script's full path in cron (cron doesn't start in your scripts folder).";
          if (!/>>\s*(\/home\/dev|~|\$HOME)\/healthcheck\.log/.test(line)) return "Append the output with >> ~/healthcheck.log (one > would overwrite it every time).";
          return /2>&1/.test(line) ? true : "Send errors to the log too: add 2>&1 after the >> part.";
        }
      }
    ],
    solution: sol("mkdir -p ~/scripts", "sudo apt install -y shellcheck",
      { nano: "~/scripts/healthcheck.sh", text: sc("#!/bin/bash", "# Is kc-web-01 healthy? One OK/FAIL line per check; exit 1 if anything failed.", "set -euo pipefail", "", "limit=90", "quiet=0", "while getopts \"t:q\" opt; do", "  case $opt in", "    t) limit=$OPTARG ;;", "    q) quiet=1 ;;", "    *) echo \"Usage: healthcheck.sh [-t PERCENT] [-q]\" >&2; exit 2 ;;", "  esac", "done", "", "failed=0", "report() {", "  local status=$1", "  shift", "  if [[ $status == FAIL ]]; then", "    failed=1", "  elif [[ $quiet -eq 1 ]]; then", "    return 0", "  fi", "  echo \"$status $*\"", "}", "", "used=$(df --output=pcent / | tail -1 | tr -dc '0-9')", "if [[ $used -lt $limit ]]; then", "  report OK disk \"$used% used\"", "else", "  report FAIL disk \"$used% used (limit $limit%)\"", "fi", "", "for unit in nginx kestrel-app; do", "  if systemctl is-active --quiet \"$unit\"; then", "    report OK \"$unit\"", "  else", "    report FAIL \"$unit\"", "  fi", "done", "", "code=$(curl -s -o /dev/null -w '%{http_code}' http://localhost/ || true)", "if [[ $code == 200 ]]; then", "  report OK http \"$code\"", "else", "  report FAIL http \"$code\"", "fi", "", "exit \"$failed\"") },
      "chmod +x ~/scripts/healthcheck.sh", "~/scripts/healthcheck.sh", "~/scripts/healthcheck.sh -q; echo $?", "~/scripts/healthcheck.sh -t 50; echo $?",
      "shellcheck ~/scripts/healthcheck.sh",
      "(crontab -l 2>/dev/null; echo '*/5 * * * * /home/dev/scripts/healthcheck.sh >> /home/dev/healthcheck.log 2>&1') | crontab -",
      "crontab -l"),
    debrief: "<p><b>Module 3 complete.</b> Your health check uses nearly everything from this module: <code>getopts</code> options, a function with <code>local</code> variables, conditions on numbers and exit codes, a loop over services, command substitution, <code>set -euo pipefail</code> with the one command that may fail marked <code>|| true</code>, and an exit code that cron, a monitoring system or another script can act on.</p>" +
      "<p>Module 4 turns to <b>security</b>: what happened when someone broke into a server, how to find their way in and what they left behind, and how to lock the box down, with scripts like this one checking it in CI.</p>",
    realworld: "Monitoring agents (Nagios/Icinga plugins, Zabbix user parameters, Datadog custom checks) run scripts exactly like this one and read their output and exit code. Yours would plug in with almost no changes.",
    quiz: []
  });

  LABS.forEach(function (l) { l.drills = []; T.LABS.push(l); });
  T.UPCOMING = T.UPCOMING.filter(function (row) { return row.module !== 3; });
  T.M3 = { logLines: logLines, SERVERS: SERVERS, noNginx: noNginx, fullRoot: fullRoot, brokenNginx: brokenNginx, ROTATE_FILES: ROTATE_FILES, kestrelDir: kestrelDir };
})();
