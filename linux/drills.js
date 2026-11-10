/* sudo learn — Linux Module 1 practice drills (3 per lab, +5 XP each). Terminal drills: type commands; checked as you go. */
(function () {
  "use strict";
  var T = window.LX_TRACK, H = window.ShLab.H, S = window.ShEngine, lines = T.lines;
  var HOME = "/home/dev";
  function L(t) { return H.lines(t || ""); }
  function ran(r, re, fn) { return r.history.some(function (e) { return re.test(e.cmd) && (!fn || fn(e)); }); }
  function outIs(r, want, o) { return H.outputIndex(r, want, o) >= 0; }
  var NAMES = lines("ana", "Chris", "ben", "dana", "Ed", "fay");
  var SPEECH = "We choose to go to the moon in this decade and do the other things,\nnot because they are easy, but because they are hard.\n";

  var DRILLS = {
    "lx-101": [
      {
        id: "d1", title: "Absolute path",
        text: "<p>Go to <code>/etc/nginx/sites-available</code> using an <b>absolute</b> path (from <code>/</code>), and list what's there.</p>",
        starter: "", solution: lines("cd /etc/nginx/sites-available", "ls"),
        check: function (r) {
          if (!ran(r, /^\s*cd\s+\/etc\/nginx\/sites-available\/?\s*$/)) return "Use cd with the full path, starting with /.";
          return ran(r, /^\s*(ls|ll)\b/, function (e) { return e.cwdBefore === "/etc/nginx/sites-available" && /kestrel/.test(e.out.join(" ")); }) ? true : "Now list the folder you're in.";
        }
      },
      {
        id: "d2", title: "Back and forth",
        text: "<p>Go to <code>/var/log</code>, then to <code>/tmp</code>, then jump straight back to the previous folder with <code>cd -</code>.</p>",
        starter: "", solution: lines("cd /var/log", "cd /tmp", "cd -"),
        check: function (r) { return ran(r, /^\s*cd\s+-\s*$/, function (e) { return e.cwdBefore === "/tmp" && e.cwd === "/var/log"; }) ? true : "Visit /var/log, then /tmp, then run cd - (it should take you back to /var/log)."; }
      },
      {
        id: "d3", title: "Read the manual",
        text: "<p>Use <code>man ls</code> (or <code>ls --help</code>) to find the option that sorts by modification time, newest first. Then list <code>/var/log</code> in long format sorted that way.</p>",
        starter: "", solution: lines("man ls", "ls -lt /var/log"),
        check: function (r) {
          if (!ran(r, /^\s*(man\s+ls|ls\s+--help)\b/)) return "Look it up first: man ls (or ls --help).";
          return ran(r, /^\s*ls\s+(-\w*t\w*\s+)*.*\/var\/log|^\s*ls\s+-\w*t/, function (e) { return /-\w*l/.test(e.cmd) && /-\w*t/.test(e.cmd) && /nginx/.test(e.out.join(" ")); }) ? true : "List /var/log with both -l and the sort-by-time option.";
        }
      }
    ],

    "lx-102": [
      {
        id: "d1", title: "Two files, one command",
        text: "<p>Create two empty files, <code>~/todo.txt</code> and <code>~/done.txt</code>, with a single command.</p>",
        starter: "", solution: lines("touch ~/todo.txt ~/done.txt"),
        check: function (r) {
          if (!r.isFile("todo.txt") || !r.isFile("done.txt")) return "Both ~/todo.txt and ~/done.txt should exist.";
          return ran(r, /todo\.txt/, function (e) { return /done\.txt/.test(e.cmd); }) ? true : "Do it in one command (touch takes several names).";
        }
      },
      {
        id: "d2", title: "Rename",
        text: "<p>Rename <code>~/draft.txt</code> to <code>~/final.txt</code>.</p>",
        files: { "draft.txt": "Release notes v2.4\n" },
        starter: "", solution: lines("mv ~/draft.txt ~/final.txt"),
        check: function (r) {
          if (r.exists("draft.txt")) return "~/draft.txt is still there: rename (move) it, don't copy.";
          return r.read("final.txt") === "Release notes v2.4\n" ? true : "~/final.txt should have the draft's content.";
        }
      },
      {
        id: "d3", title: "Copy a whole folder",
        text: "<p>Copy the folder <code>~/site</code>, with everything inside it, to <code>~/site-backup</code>.</p>",
        files: { "site/index.html": "<h1>Kestrel</h1>\n", "site/css/app.css": "body{}\n", "site/img/logo.svg": "<svg/>\n" },
        starter: "", solution: lines("cp -r ~/site ~/site-backup"),
        check: function (r) {
          var miss = ["index.html", "css/app.css", "img/logo.svg"].filter(function (f) { return r.read("site-backup/" + f) !== r.read("site/" + f); });
          return miss.length ? "~/site-backup is missing: " + miss.join(", ") + " (cp needs -r for folders)." : true;
        }
      }
    ],

    "lx-103": [
      {
        id: "d1", title: "Number the lines",
        text: "<p>Show <code>~/notes/todo.txt</code> with line numbers.</p>",
        files: { "notes/todo.txt": lines("rotate logs", "patch kc-web-01", "review sudoers", "renew TLS certificate") },
        starter: "", solution: lines("cat -n ~/notes/todo.txt"),
        check: function (r) { return outIs(r, ["1 rotate logs", "2 patch kc-web-01", "3 review sudoers", "4 renew TLS certificate"], { norm: true }) ? true : "Print the 4 lines, each with its number in front (cat has an option for that)."; }
      },
      {
        id: "d2", title: "Just the first line",
        text: "<p>Show only the first line of <code>/etc/os-release</code>.</p>",
        starter: "", solution: lines("head -n 1 /etc/os-release"),
        check: function (r) { return outIs(r, ["PRETTY_NAME=\"Ubuntu 24.04.1 LTS\""]) ? true : "Print exactly one line: the first line of /etc/os-release."; }
      },
      {
        id: "d3", title: "Count the words",
        text: "<p>How many words are in <code>~/notes/speech.txt</code>? Print the count with <code>wc</code>.</p>",
        files: { "notes/speech.txt": SPEECH },
        starter: "", solution: lines("wc -w ~/notes/speech.txt"),
        check: function (r) { return ran(r, /\bwc\b/, function (e) { return T.numIn(e) === 25; }) ? true : "Use wc with the option that counts words."; }
      }
    ],

    "lx-104": [
      {
        id: "d1", title: "Where exactly?",
        text: "<p>Show the lines of <code>~/configs/app.ini</code> that contain <code>timeout</code>, <b>with their line numbers</b>.</p>",
        files: { "configs/app.ini": lines("[server]", "listen 8080", "timeout = 30", "", "[db]", "timeout = 5", "pool = 10") },
        starter: "", solution: lines("grep -n timeout ~/configs/app.ini"),
        check: function (r) { return outIs(r, ["3:timeout = 30", "6:timeout = 5"]) ? true : "Print the 2 matching lines prefixed with their line numbers (3: and 6:)."; }
      },
      {
        id: "d2", title: "Only the real settings",
        text: "<p>Show the lines of <code>/etc/ssh/sshd_config</code> that are <b>not</b> comments (starting with <code>#</code>) and <b>not</b> empty.</p>",
        starter: "", solution: lines("grep -v '^#' /etc/ssh/sshd_config | grep -v '^$'"),
        check: function (r) {
          var want = L(r.read("/etc/ssh/sshd_config")).filter(function (l) { return l !== "" && l.charAt(0) !== "#"; });
          return outIs(r, want) ? true : "Print only the setting lines (" + want.length + " of them): drop comment lines and blank lines (grep -v twice, or grep -Ev '^(#|$)').";
        }
      },
      {
        id: "d3", title: "Big files",
        text: "<p>List the files under <code>~/downloads</code> that are bigger than 100 KB.</p>",
        files: { "downloads/ubuntu-notes.pdf": new Array(150001).join("x"), "downloads/small.txt": "hi\n", "downloads/video/demo.mp4": new Array(400001).join("v"), "downloads/logo.png": new Array(20001).join("p") },
        starter: "", solution: lines("find ~/downloads -type f -size +100k"),
        check: function (r) {
          var want = [HOME + "/downloads/ubuntu-notes.pdf", HOME + "/downloads/video/demo.mp4"].sort();
          return ran(r, /^\s*find\b/, function (e) { return H.same(e.out.map(function (l) { return T.absOut(e, l); }).sort(), want); }) ? true : "Use find with -size +100k (2 files, one in a sub-folder).";
        }
      }
    ],

    "lx-105": [
      {
        id: "d1", title: "Sorted into a file",
        text: "<p>Sort the names in <code>~/names.txt</code> and save the result to <code>~/sorted.txt</code>.</p>",
        files: { "names.txt": NAMES },
        starter: "", solution: lines("sort ~/names.txt > ~/sorted.txt"),
        check: function (r) {
          var want = L(NAMES).sort(S.sortLines);
          return H.same(L(r.read("sorted.txt")), want) ? true : "~/sorted.txt should hold the names, sorted, one per line.";
        }
      },
      {
        id: "d2", title: "Keep the errors",
        text: "<p>Run <code>ls /root /tmp</code> and save only its <b>error</b> message to <code>~/ls-errors.log</code> (the listing still goes to the screen).</p>",
        starter: "", solution: lines("ls /root /tmp 2> ~/ls-errors.log"),
        check: function (r) { return /ls: cannot open directory '\/root': Permission denied/.test(r.read("ls-errors.log") || "") ? true : "Redirect stream 2 (errors) into ~/ls-errors.log."; }
      },
      {
        id: "d3", title: "Just the number",
        text: "<p>Make <code>wc -l</code> print the line count of <code>/etc/passwd</code> <b>without</b> the file name, by feeding the file with input redirection (<code>&lt;</code>).</p>",
        starter: "", solution: lines("wc -l < /etc/passwd"),
        check: function (r) { return ran(r, /</, function (e) { return /\bwc\b/.test(e.cmd) && H.same(e.out, [String(L(r.read("/etc/passwd")).length)]); }) ? true : "wc -l < /etc/passwd prints just the number."; }
      }
    ],

    "lx-106": [
      {
        id: "d1", title: "Stop shouting",
        text: "<p>Print <code>~/shout.txt</code> in lower case.</p>",
        files: { "shout.txt": "SERVER IS DOWN\nRESTART THE APP NOW\n" },
        starter: "", solution: lines("tr 'A-Z' 'a-z' < ~/shout.txt"),
        check: function (r) { return outIs(r, ["server is down", "restart the app now"]) ? true : "Print both lines in lower case (tr 'A-Z' 'a-z')."; }
      },
      {
        id: "d2", title: "Just the dates",
        text: "<p>From <code>~/logs/app.log</code>, print the first <b>10 characters</b> (the date) of its first 3 lines.</p>",
        files: { "logs/app.log": T.APP },
        starter: "", solution: lines("head -n 3 ~/logs/app.log | cut -c1-10"),
        check: function (r) { return outIs(r, ["2026-11-11", "2026-11-11", "2026-11-11"]) ? true : "Print 3 lines of just the date: head, then cut -c1-10."; }
      },
      {
        id: "d3", title: "Total traffic",
        text: "<p>Add up field 10 (the response size in bytes) of every line in <code>~/logs/access.log</code> and print the total.</p>",
        files: { "logs/access.log": T.ACCESS },
        starter: "", solution: lines("awk '{sum += $10} END {print sum}' ~/logs/access.log"),
        check: function (r) {
          var total = L(T.ACCESS).reduce(function (a, l) { return a + (+l.split(" ")[9] || 0); }, 0);
          return ran(r, /\bawk\b/, function (e) { return H.same(e.out, [String(total)]); }) ? true : "Sum field 10 with awk: '{sum += $10} END {print sum}'.";
        }
      }
    ],

    "lx-107": [
      {
        id: "d1", title: "Letters, not numbers",
        text: "<p>Remove write permission for the group and others from <code>~/notes.txt</code>, using the <b>symbolic</b> form (letters).</p>",
        files: { "notes.txt": { content: "shared notes\n", mode: 438 } },
        starter: "", solution: lines("chmod go-w ~/notes.txt"),
        check: function (r) {
          if (r.mode("notes.txt") !== "644") return "notes.txt is " + r.mode("notes.txt") + "; after removing group and others' write it should be 644.";
          return ran(r, /^\s*chmod\s+[ugoa]*[-+=]/) ? true : "Use letters (like go-w), not a number.";
        }
      },
      {
        id: "d2", title: "Read a mode",
        text: "<p>Print the permissions of <code>/etc/shadow</code> as an octal number (like <code>644</code>) using <code>stat</code>.</p>",
        starter: "", solution: lines("stat -c '%a' /etc/shadow"),
        check: function (r) { return ran(r, /\bstat\b/, function (e) { return H.same(e.out, ["640"]); }) ? true : "Use stat -c with the %a format."; }
      },
      {
        id: "d3", title: "A private folder",
        text: "<p>Create <code>~/vault</code> so that only you can list it, add files to it or enter it (700).</p>",
        starter: "", solution: lines("mkdir ~/vault", "chmod 700 ~/vault"),
        check: function (r) { if (!r.isDir("vault")) return "Create the folder ~/vault."; return r.mode("vault") === "700" ? true : "~/vault is " + r.mode("vault") + "; it should be 700."; }
      }
    ],

    "lx-108": [
      {
        id: "d1", title: "What may I do?",
        text: "<p>List the commands you're allowed to run with sudo.</p>",
        starter: "", solution: lines("sudo -l"),
        check: function (r) { return ran(r, /^\s*sudo\s+-l\b/, function (e) { return /may run the following/.test(e.out.join(" ")); }) ? true : "Ask sudo with -l."; }
      },
      {
        id: "d2", title: "As someone else",
        text: "<p>Create the empty file <code>/var/www/kestrel/uploads/test.txt</code> <b>as the user www-data</b>, so the web server owns it.</p>",
        starter: "", solution: lines("sudo -u www-data touch /var/www/kestrel/uploads/test.txt"),
        check: function (r) { var o = r.owner("/var/www/kestrel/uploads/test.txt"); return o === "www-data" ? true : o ? "The file is owned by " + o + ": create it as www-data (sudo -u)." : "Create /var/www/kestrel/uploads/test.txt."; }
      },
      {
        id: "d3", title: "In and out of root",
        text: "<p>Open a root shell with <code>sudo -i</code>, run <code>whoami</code> there, then <code>exit</code> back to dev.</p>",
        starter: "", solution: lines("sudo -i", "whoami", "exit"),
        check: function (r) {
          if (!ran(r, /^\s*whoami\s*$/, function (e) { return e.out[0] === "root"; })) return "Open a root shell (sudo -i) and run whoami in it.";
          return r.user === "dev" ? true : "Now leave the root shell with exit.";
        }
      }
    ],

    "lx-109": [
      {
        id: "d1", title: "Where's home?",
        text: "<p>Print the value of the <code>HOME</code> variable.</p>",
        starter: "", solution: lines("echo $HOME"),
        check: function (r) { return ran(r, /HOME/, function (e) { return H.same(e.out, [HOME]); }) ? true : "echo $HOME"; }
      },
      {
        id: "d2", title: "Which shell?",
        text: "<p>Print only the value of the environment variable <code>SHELL</code> with <code>printenv</code>.</p>",
        starter: "", solution: lines("printenv SHELL"),
        check: function (r) { return ran(r, /^\s*printenv\s+SHELL\s*$/, function (e) { return H.same(e.out, ["/bin/bash"]); }) ? true : "printenv SHELL"; }
      },
      {
        id: "d3", title: "What is ll?",
        text: "<p><code>ll</code> isn't a program. Ask bash what it is.</p>",
        starter: "", solution: lines("type ll"),
        check: function (r) { return ran(r, /^\s*(type|alias)\s+ll\b/, function (e) { return /ls -alF/.test(e.out.join(" ")); }) ? true : "Use type ll (or alias ll)."; }
      }
    ],

    "lx-110": [
      {
        id: "d1", title: "Busiest hour",
        text: "<p>From <code>/var/log/nginx/access.log</code>, show how many requests arrived in each hour (the hour is characters 14-15 of the time field <code>[11/Nov/2026:HH:...</code>). One line per hour, count and hour, in hour order.</p>",
        starter: "", solution: lines("awk '{print substr($4, 14, 2)}' /var/log/nginx/access.log | sort | uniq -c"),
        check: function (r) {
          var c = {};
          L(r.read("/var/log/nginx/access.log")).forEach(function (l) { var h = l.split(" ")[3].substr(13, 2); c[h] = (c[h] || 0) + 1; });
          var want = Object.keys(c).sort().map(function (h) { return c[h] + " " + h; });
          return outIs(r, want, { norm: true }) ? true : "Print \"count hour\" for each hour (" + want.length + " lines): awk with substr, then sort | uniq -c.";
        }
      },
      {
        id: "d2", title: "Bots and scripts",
        text: "<p>Count the requests whose user agent mentions <code>curl</code> (just the number).</p>",
        starter: "", solution: lines("grep -c curl /var/log/nginx/access.log"),
        check: function (r) {
          var n = L(r.read("/var/log/nginx/access.log")).filter(function (l) { return /curl/.test(l); }).length;
          return ran(r, /curl/, function (e) { return H.same(e.out.map(function (x) { return x.trim(); }), [String(n)]); }) ? true : "Count the lines containing curl (grep -c).";
        }
      },
      {
        id: "d3", title: "The biggest response",
        text: "<p>Print the single log line with the largest response size (field 10).</p>",
        starter: "", solution: lines("sort -k10 -n /var/log/nginx/access.log | tail -n 1"),
        check: function (r) {
          var ls = L(r.read("/var/log/nginx/access.log"));
          var best = ls.reduce(function (a, l) { return +l.split(" ")[9] > +a.split(" ")[9] ? l : a; });
          return outIs(r, [best]) ? true : "Sort numerically by field 10 (sort -k10 -n) and keep the last line.";
        }
      }
    ]
  };
  T.LABS.forEach(function (l) { if (DRILLS[l.id]) l.drills = DRILLS[l.id]; });
})();
