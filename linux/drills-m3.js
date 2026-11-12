/* sudo learn — Linux Module 3 practice drills (3 per lab, +5 XP each). Loaded after labs-m3.js. */
(function () {
  "use strict";
  var T = window.LX_TRACK, H = window.ShLab.H, S = window.ShEngine, M2 = S.M2, M3 = S.M3, X = T.M3;
  var K = M3.lab, sc = K.sc, sol = K.sol, call = K.call, basics = K.basics, rt = K.rt, tmpList = K.tmpList;
  var HOME = "/home/dev";
  function ran(r, re, fn) { return r.history.some(function (e) { return re.test(e.cmd) && (!fn || fn(e)); }); }
  function outIs(e, want) { return H.same(e.out.map(rt), want); }
  function show(v) { return H.show(v); }
  function same(a, b) { return H.same(a, b); }
  // "show X" tasks: some command printed want, right after (or in the same line as) a command matching re.
  function printedAfter(r, re, want) {
    return r.history.some(function (e, i) {
      if (re.test(e.cmd) && outIs(e, want)) return true;
      var p = r.history[i - 1];
      return !!p && re.test(p.cmd) && outIs(e, want);
    });
  }

  var DRILLS = {
    "lx-120": [
      {
        id: "d1", title: "No x needed",
        files: { "scripts/report.sh": { content: sc("#!/bin/bash", "echo \"Report OK\""), mode: 420 } },
        text: "<p><code>~/scripts/report.sh</code> isn't executable. Run it <b>without</b> changing its permissions.</p>",
        starter: "", solution: sol("bash ~/scripts/report.sh"),
        check: function (r) {
          if (r.mode(HOME + "/scripts/report.sh") !== "644") return "Leave its permissions alone (no chmod): there's another way to run it.";
          return ran(r, /^\s*(bash|sh)\s+\S*report\.sh/, function (e) { return outIs(e, ["Report OK"]); }) ? true : "Hand the file to bash itself: bash FILE.";
        }
      },
      {
        id: "d2", title: "The second argument",
        text: "<p>Create <code>~/scripts/second.sh</code> that prints only its <b>second</b> argument: <code>second.sh a b c</code> → <code>b</code>.</p>",
        starter: "", solution: sol("mkdir -p ~/scripts", { nano: "~/scripts/second.sh", text: sc("#!/bin/bash", "echo \"$2\"") }, "chmod +x ~/scripts/second.sh", "~/scripts/second.sh a b c"),
        check: function (r) {
          var b = basics(r, "~/scripts/second.sh"); if (b) return b;
          var x = call(r, HOME + "/scripts/second.sh a b c"), y = call(r, HOME + "/scripts/second.sh web db");
          return same(x.out, ["b"]) && same(y.out, ["db"]) ? true : "second.sh a b c printed " + show(x.out) + "; it should print just b.";
        }
      },
      {
        id: "d3", title: "grep's exit code",
        text: "<p>What exit code does <code>grep</code> give when it finds <b>nothing</b>? Search <code>/etc/hosts</code> for <code>kestrel-nothing</code> quietly (<code>-q</code>), then print the exit code.</p>",
        starter: "", solution: sol("grep -q kestrel-nothing /etc/hosts; echo $?"),
        check: function (r) { return printedAfter(r, /grep\b.*kestrel-nothing/, ["1"]) && ran(r, /echo\s+"?\$\?/) ? true : "Run the grep, then echo $? right after it (same line with ; or the next command)."; }
      }
    ],
    "lx-121": [
      {
        id: "d1", title: "Kernel version",
        text: "<p>Print <code>Kernel: </code> followed by the kernel version, using <code>$(uname -r)</code>.</p>",
        starter: "", solution: sol("echo \"Kernel: $(uname -r)\""),
        check: function (r) { return ran(r, /\$\(\s*uname\s+-r\s*\)/, function (e) { return outIs(e, ["Kernel: 6.8.0-48-generic"]); }) ? true : "echo \"Kernel: $(uname -r)\""; }
      },
      {
        id: "d2", title: "How long is it?",
        text: "<p>Print the number of characters in <code>$HOSTNAME</code> with <code>${#...}</code>.</p>",
        starter: "", solution: sol("echo ${#HOSTNAME}"),
        check: function (r) { return ran(r, /\$\{#HOSTNAME\}/, function (e) { return outIs(e, ["9"]); }) ? true : "${#var} is the length of var's value."; }
      },
      {
        id: "d3", title: "Arithmetic",
        text: "<p>At the prompt, compute <code>(17 + 5) × 3</code> with <code>$(( ))</code>.</p>",
        starter: "", solution: sol("echo $(( (17 + 5) * 3 ))"),
        check: function (r) { return ran(r, /\$\(\(/, function (e) { return outIs(e, ["66"]); }) ? true : "echo $(( ... )) with * for times."; }
      }
    ],
    "lx-122": [
      {
        id: "d1", title: "Root only",
        text: "<p>Create <code>~/scripts/need-root.sh</code>: when not run as root it prints <code>Run me as root</code> to stderr and exits 1; as root it prints <code>OK</code>.</p>",
        starter: "", solution: sol("mkdir -p ~/scripts", { nano: "~/scripts/need-root.sh", text: sc("#!/bin/bash", "if [[ $EUID -ne 0 ]]; then", "  echo \"Run me as root\" >&2", "  exit 1", "fi", "echo \"OK\"") }, "chmod +x ~/scripts/need-root.sh", "~/scripts/need-root.sh", "sudo ~/scripts/need-root.sh"),
        check: function (r) {
          var b = basics(r, "~/scripts/need-root.sh"); if (b) return b;
          var u = call(r, HOME + "/scripts/need-root.sh"), s = call(r, "sudo " + HOME + "/scripts/need-root.sh");
          if (u.exit !== 1 || !u.err.some(function (l) { return l === "Run me as root"; })) return "As dev it should print Run me as root on stderr and exit 1 (exit was " + u.exit + ").";
          return same(s.out, ["OK"]) && s.exit === 0 ? true : "With sudo it should print OK (got " + show(s.out) + "). $EUID or $(id -u) is 0 for root.";
        }
      },
      {
        id: "d2", title: "Empty or not",
        text: "<p>In one line: if the variable <code>KESTREL_ENV</code> is empty, print <code>not set</code>, otherwise print its value. (It isn't set.)</p>",
        starter: "", solution: sol("[[ -z $KESTREL_ENV ]] && echo \"not set\" || echo \"$KESTREL_ENV\""),
        check: function (r) {
          var k = -1; r.history.forEach(function (e, i) { if (/-z|-n/.test(e.cmd) && /KESTREL_ENV/.test(e.cmd) && outIs(e, ["not set"])) k = i; });
          if (k < 0) return "Use [[ -z $KESTREL_ENV ]] with && and ||.";
          var r2 = r.run(null, { prelude: "export KESTREL_ENV=staging" });
          return outIs(r2.history[k], ["staging"]) ? true : "When KESTREL_ENV=staging, your line should print staging.";
        }
      },
      {
        id: "d3", title: "The bigger one",
        text: "<p>Create <code>~/scripts/max.sh A B</code> that prints the larger of two numbers.</p>",
        starter: "", solution: sol("mkdir -p ~/scripts", { nano: "~/scripts/max.sh", text: sc("#!/bin/bash", "if [[ $1 -gt $2 ]]; then", "  echo \"$1\"", "else", "  echo \"$2\"", "fi") }, "chmod +x ~/scripts/max.sh", "~/scripts/max.sh 9 10"),
        check: function (r) {
          var b = basics(r, "~/scripts/max.sh"); if (b) return b;
          var t = [["9 10", "10"], ["42 7", "42"], ["5 5", "5"], ["100 99", "100"]];
          for (var i = 0; i < t.length; i++) { var x = call(r, HOME + "/scripts/max.sh " + t[i][0]); if (!same(x.out, [t[i][1]])) return "max.sh " + t[i][0] + " should print " + t[i][1] + " (got " + show(x.out) + "). Compare numbers with -gt."; }
          return true;
        }
      }
    ],
    "lx-123": [
      {
        id: "d1", title: "Countdown",
        text: "<p>With a loop, print <code>3</code>, <code>2</code>, <code>1</code> on separate lines, then <code>Go!</code>.</p>",
        starter: "", solution: sol("for i in 3 2 1; do echo $i; done; echo \"Go!\""),
        check: function (r) { return ran(r, /\b(for|while|until)\b/, function (e) { return outIs(e, ["3", "2", "1", "Go!"]); }) ? true : "for i in 3 2 1; do ...; done, then echo Go! (same line, after ;)."; }
      },
      {
        id: "d2", title: "Rename them all",
        files: { "drafts/intro.txt": "intro\n", "drafts/setup.txt": "setup\n", "drafts/faq.txt": "faq\n" },
        text: "<p>With a loop, rename every <code>.txt</code> file in <code>~/drafts</code> to <code>.md</code> (same name, same content).</p>",
        starter: "", solution: sol("for f in ~/drafts/*.txt; do mv \"$f\" \"${f%.txt}.md\"; done", "ls ~/drafts"),
        check: function (r) {
          var l = r.list(HOME + "/drafts");
          if (!same(l, ["faq.md", "intro.md", "setup.md"])) return "~/drafts should have faq.md, intro.md and setup.md (it has " + show(l) + "). ${f%.txt} removes the .txt ending.";
          return r.read(HOME + "/drafts/faq.md") === "faq\n" && ran(r, /\bfor\b/) ? true : "Rename them with a for loop.";
        }
      },
      {
        id: "d3", title: "Line by line",
        files: { "hosts.txt": "kc-web-01\nkc-db-01\nkc-backup-01\n" },
        text: "<p>With <code>while read</code>, print each line of <code>~/hosts.txt</code> as <code>checking HOST</code>.</p>",
        starter: "", solution: sol("while read -r h; do echo \"checking $h\"; done < ~/hosts.txt"),
        check: function (r) {
          var k = -1; r.history.forEach(function (e, i) { if (/\bwhile\b.*\bread\b/.test(e.cmd) && outIs(e, ["checking kc-web-01", "checking kc-db-01", "checking kc-backup-01"])) k = i; });
          if (k < 0) return "while read -r h; do ...; done < ~/hosts.txt";
          var r2 = r.run(null, { files: { "hosts.txt": "a\nb\n" } });
          return outIs(r2.history[k], ["checking a", "checking b"]) ? true : "Read the lines from the file itself.";
        }
      }
    ],
    "lx-124": [
      {
        id: "d1", title: "Yes or no",
        text: "<p>Define a function <code>is_even N</code> that <b>returns</b> 0 for even numbers and 1 for odd ones (and prints nothing), then use it: <code>is_even 4 &amp;&amp; echo even</code>.</p>",
        starter: "", solution: sol("is_even() { (( $1 % 2 == 0 )); }", "is_even 4 && echo even"),
        check: function (r) {
          if (!r.shell.functions.is_even) return "Define is_even() { ... } at the prompt.";
          var a = call(r, "is_even 10; echo $?; is_even 7; echo $?");
          if (!same(a.out, ["0", "1"])) return "is_even 10 should return 0 and is_even 7 return 1, printing nothing (got " + show(a.out) + ").";
          return ran(r, /is_even\s+4/, function (e) { return outIs(e, ["even"]); }) ? true : "Now use it: is_even 4 && echo even";
        }
      },
      {
        id: "d2", title: "Capture the output",
        text: "<p>Define <code>upper</code>, which prints its argument in capitals, then store <code>$(upper kestrel)</code> in a variable <code>name</code> and print it.</p>",
        starter: "", solution: sol("upper() { echo \"${1^^}\"; }", "name=$(upper kestrel)", "echo \"$name\""),
        check: function (r) {
          if (!r.shell.functions.upper) return "Define upper() { ... } first (${1^^} is $1 in capitals; tr a-z A-Z works too).";
          if (r.v("name") !== "KESTREL") return "name should hold KESTREL: name=$(upper kestrel)";
          return ran(r, /echo.*\$\{?name/, function (e) { return outIs(e, ["KESTREL"]); }) ? true : "Print $name.";
        }
      },
      {
        id: "d3", title: "Load a library",
        files: { "scripts/greet-lib.sh": sc("# helpers", "greet() {", "  echo \"Hi, $1\"", "}") },
        text: "<p><code>~/scripts/greet-lib.sh</code> defines a <code>greet</code> function. Load it into your shell, then run <code>greet Ana</code>.</p>",
        starter: "", solution: sol("source ~/scripts/greet-lib.sh", "greet Ana"),
        check: function (r) { return ran(r, /^\s*greet\s+Ana\b/, function (e) { return outIs(e, ["Hi, Ana"]); }) && ran(r, /^\s*(source|\.)\s+\S*greet-lib\.sh/) ? true : "source the file (running it with ./ would define greet in another process), then greet Ana."; }
      }
    ],
    "lx-125": [
      {
        id: "d1", title: "Just the warnings", files: X.ROTATE_FILES, system: function (sys) { X.kestrelDir(sys); M3.preinstall(sys, "shellcheck"); },
        text: "<p>ShellCheck is installed. Run it on <code>~/scripts/rotate-logs.sh</code> showing only <b>warnings and errors</b> (no info or style notes), one line per finding.</p>",
        starter: "", solution: sol("shellcheck -S warning -f gcc ~/scripts/rotate-logs.sh"),
        prelude: "",
        check: function (r) {
          return ran(r, /shellcheck\b.*-S\s*warning|shellcheck\b.*--severity=warning/, function (e) { return e.out.length && e.out.every(function (l) { return !/\b(info|style|note)\b/.test(l) || !/^\S+:\d+:\d+:/.test(l); }) && e.out.some(function (l) { return /SC2154/.test(l); }) && /-f\s*gcc|--format=gcc/.test(e.cmd); }) ? true : "Two options: -S warning (minimum severity) and -f gcc (one line per finding).";
        }
      },
      {
        id: "d2", title: "pipefail in action",
        text: "<p>Show the difference: run <code>false | true; echo $?</code>, then turn on <code>pipefail</code> and run the same line again.</p>",
        starter: "", solution: sol("false | true; echo $?", "set -o pipefail", "false | true; echo $?"),
        check: function (r) {
          var a = -1, b = -1;
          r.history.forEach(function (e, i) { if (/false\s*\|\s*true/.test(e.cmd)) { if (outIs(e, ["0"]) && a < 0) a = i; if (outIs(e, ["1"]) && a >= 0) b = i; } });
          return a >= 0 && b > a ? true : "First without pipefail (prints 0), then set -o pipefail and again (prints 1).";
        }
      },
      {
        id: "d3", title: "A temp folder that cleans up",
        text: "<p>Create <code>~/scripts/tmpwork.sh</code>: it makes a temporary <b>folder</b> with <code>mktemp -d</code>, writes <code>scratch.txt</code> inside it, prints the folder's path, and removes the folder with a trap on EXIT.</p>",
        starter: "", solution: sol("mkdir -p ~/scripts", { nano: "~/scripts/tmpwork.sh", text: sc("#!/bin/bash", "set -euo pipefail", "work=$(mktemp -d)", "trap 'rm -rf \"$work\"' EXIT", "echo \"temp\" > \"$work/scratch.txt\"", "echo \"$work\"") }, "chmod +x ~/scripts/tmpwork.sh", "~/scripts/tmpwork.sh", "ls /tmp"),
        check: function (r) {
          var b = basics(r, "~/scripts/tmpwork.sh"); if (b) return b;
          var t = r.read(HOME + "/scripts/tmpwork.sh");
          if (!/mktemp\s+-d/.test(t) || !/trap\b[^\n]*EXIT/.test(t)) return "Use mktemp -d for the folder and trap ... EXIT to remove it.";
          var before = tmpList(r), x = call(r, HOME + "/scripts/tmpwork.sh");
          if (!/^\/tmp\/\S+$/.test(x.out[0] || "")) return "It should print the folder's path (got " + show(x.out) + ").";
          return same(tmpList(x.c), before) ? true : "The temp folder is still in /tmp after the script ends.";
        }
      }
    ],
    "lx-126": [
      {
        id: "d1", title: "Count the words",
        text: "<p>Count the words in the text <code>keep your scripts boring and safe</code> with <code>wc -w</code> and a here-string (<code>&lt;&lt;&lt;</code>).</p>",
        starter: "", solution: sol("wc -w <<< \"keep your scripts boring and safe\""),
        check: function (r) { return ran(r, /wc\s+-w\s*<<</, function (e) { return outIs(e, ["6"]); }) ? true : "wc -w <<< \"TEXT\""; }
      },
      {
        id: "d2", title: "Two values at once",
        text: "<p>With one <code>read</code> and a here-string, put <code>dev</code> in <code>user</code> and <code>kc-web-01</code> in <code>host</code> from the text <code>dev kc-web-01</code>, then print <code>dev at kc-web-01</code> from the variables.</p>",
        starter: "", solution: sol("read -r user host <<< \"dev kc-web-01\"", "echo \"$user at $host\""),
        check: function (r) {
          if (r.v("user") !== "dev" || r.v("host") !== "kc-web-01") return "read -r user host <<< \"dev kc-web-01\" splits the text into the two variables.";
          return ran(r, /\$\{?user\b.*\$\{?host\b/, function (e) { return outIs(e, ["dev at kc-web-01"]); }) ? true : "Print it from the variables: echo \"$user at $host\"";
        }
      },
      {
        id: "d3", title: "A -u flag",
        text: "<p>Create <code>~/scripts/hello-opt.sh</code>: it prints <code>hello</code>, or <code>HELLO</code> when given <code>-u</code>. Use getopts.</p>",
        starter: "", solution: sol("mkdir -p ~/scripts", { nano: "~/scripts/hello-opt.sh", text: sc("#!/bin/bash", "word=hello", "while getopts \"u\" opt; do", "  case $opt in", "    u) word=HELLO ;;", "    *) exit 2 ;;", "  esac", "done", "echo \"$word\"") }, "chmod +x ~/scripts/hello-opt.sh", "~/scripts/hello-opt.sh -u"),
        check: function (r) {
          var b = basics(r, "~/scripts/hello-opt.sh"); if (b) return b;
          var a = call(r, HOME + "/scripts/hello-opt.sh"), u = call(r, HOME + "/scripts/hello-opt.sh -u");
          if (!same(a.out, ["hello"]) || !same(u.out, ["HELLO"])) return "Without -u it should print hello, with -u HELLO (got " + show(a.out) + " and " + show(u.out) + ").";
          return /getopts/.test(r.read(HOME + "/scripts/hello-opt.sh")) ? true : "Parse the option with getopts.";
        }
      }
    ],
    "lx-127": [
      {
        id: "d1", title: "Log it to the system",
        text: "<p>Write <code>FAIL nginx</code> to the system log with the tag <code>healthcheck</code>, then show the last line of <code>/var/log/syslog</code>.</p>",
        starter: "", solution: sol("logger -t healthcheck \"FAIL nginx\"", "tail -1 /var/log/syslog"),
        check: function (r) { return ran(r, /\btail\b.*syslog|grep\b.*syslog/, function (e) { return e.out.some(function (l) { return /healthcheck: FAIL nginx$/.test(l); }); }) && ran(r, /\blogger\b.*-t\s*healthcheck/) ? true : "logger -t TAG \"MESSAGE\", then tail -1 /var/log/syslog"; }
      },
      {
        id: "d2", title: "Don't wait forever",
        text: "<p>Print just the HTTP status code of <code>http://localhost/</code>, but give up after 5 seconds: put <code>timeout 5</code> in front of the curl.</p>",
        starter: "", solution: sol("timeout 5 curl -s -o /dev/null -w '%{http_code}\\n' http://localhost/"),
        check: function (r) { return ran(r, /^\s*timeout\s+5s?\s+curl\b/, function (e) { return outIs(e, ["200"]); }) ? true : "timeout 5 curl -s -o /dev/null -w '%{http_code}\\n' URL"; }
      },
      {
        id: "d3", title: "What fails most?",
        files: { "healthcheck.log": ["OK disk 77% used", "FAIL nginx", "OK kestrel-app", "FAIL http 000", "OK disk 77% used", "OK nginx", "FAIL kestrel-app", "OK http 200", "OK disk 78% used", "FAIL nginx", "OK kestrel-app", "FAIL http 000", "FAIL disk 91% used (limit 90%)", "FAIL nginx", "OK kestrel-app", "FAIL http 000", "FAIL disk 92% used (limit 90%)", "FAIL nginx"].join("\n") + "\n" },
        text: "<p>From <code>~/healthcheck.log</code>, count the FAIL lines per check name, most failures first, like <code>      3 nginx</code>.</p>",
        starter: "", solution: sol("grep '^FAIL' ~/healthcheck.log | awk '{print $2}' | sort | uniq -c | sort -rn"),
        check: function (r) {
          function want(c) { var t = c.read(HOME + "/healthcheck.log") || "", n = {}; t.split("\n").forEach(function (l) { var m = /^FAIL (\S+)/.exec(l); if (m) n[m[1]] = (n[m[1]] || 0) + 1; }); return Object.keys(n).sort(function (a, b) { return n[b] - n[a] || (a < b ? -1 : 1); }).map(function (k) { return n[k] + " " + k; }); }
          var p = H.proves(r, want, { files: { "healthcheck.log": "FAIL disk 95%\nFAIL disk 96%\nOK nginx\nFAIL http 000\nFAIL disk 97%\n" } }, { norm: true });
          return p.ok ? true : p.reason === "alt" ? "On another log your command gave the wrong counts: compute them, don't type them." : "grep '^FAIL' | awk '{print $2}' | sort | uniq -c | sort -rn";
        }
      }
    ]
  };
  T.LABS.forEach(function (l) { if (DRILLS[l.id]) l.drills = DRILLS[l.id]; });
})();
