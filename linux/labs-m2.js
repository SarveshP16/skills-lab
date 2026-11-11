/* sudo learn — Linux track, Module 2: Running a server (LX-111..119). Terminal-first labs on kc-web-01, with the
   machinery from sh-sys.js and sh-net.js: processes, systemd, apt, disks, the network, SSH to kc-backup-01, cron and
   timers, archives. Checks read the machine's state (units, packages, processes, other servers) and what commands
   printed; "find X" answers are re-run on a different machine (r.run with another system), so they must come from
   commands. */
(function () {
  "use strict";
  var T = window.LX_TRACK, H = window.ShLab.H, S = window.ShEngine, M2 = S.M2;
  var ex = T.ex, code = T.code, lines = T.lines, prove = T.prove, absOut = T.absOut;
  var MAYA = "Maya Chen · SRE lead", DEV = "Dev Patel · Security", BEN = "Ben Okoro · Developer";
  var HOME = "/home/dev", NOW = S.NOW, MIN = 60000, HOUR = 3600000, DAY = S.DAY, GB = 1073741824;
  var LABS = [];
  function L(t) { return H.lines(t || ""); }
  function ran(r, re, fn) { return r.history.some(function (e) { return re.test(e.cmd) && (!fn || fn(e)); }); }
  function idx(r, re, fn) { var k = -1; r.history.forEach(function (e, i) { if (re.test(e.cmd) && (!fn || fn(e))) k = i; }); return k; }
  function firstIdx(r, re, fn) { for (var i = 0; i < r.history.length; i++) if (re.test(r.history[i].cmd) && (!fn || fn(r.history[i]))) return i; return -1; }
  function rootish(e) { return /^\s*sudo\b/.test(e.cmd) || e.userBefore === "root"; }
  function outHas(e, re) { return e.out.some(function (l) { return re.test(l); }); }
  function unit(r, n) { return M2.loadUnit(r.sys, n); }
  function active(r, n) { var u = unit(r, n); return !!u && u.rt.active === "active"; }
  function enabled(r, n) { var u = unit(r, n); return !!u && M2.enabledState(r.sys, u) === "enabled"; }
  function proc(r, re) { return r.sys.procs.filter(function (p) { return re.test(p.cmd); })[0] || null; }
  function sigs(r) { return r.sys.sigLog || []; }
  function same(a, b) { return H.same(a, b); }

  /* ================================================================== LX-111 Processes */
  var HOG = "python3 /home/ben/scripts/resize_images.py --all --quality 95";
  function hog(pid) {
    return function (sys) {
      sys.hogPid = pid;
      M2.spawn(sys, { pid: pid, ppid: 1, uid: 1002, cmd: HOG, comm: "python3", stat: "R", cpu: 97.3, cpuSecs: 2472, start: NOW - 41 * MIN, vsz: 412360, rss: 198412, ignore: [1, 2, 15] });
    };
  }
  function firstProc(e) { for (var i = 0; i < e.out.length; i++) if (/(^|\s)PID(\s|$)/.test(e.out[i])) return e.out[i + 1] || ""; return ""; }
  function hasPid(line, pid) { return new RegExp("(^|\\s)" + pid + "(\\s|$)").test(line); }
  LABS.push({
    id: "lx-111", n: 11, module: 2, ticket: "LX-111", xp: 120,
    title: "Something is eating the CPU",
    topic: "ps, top, kill and signals, jobs, nohup",
    from: MAYA,
    story: "<p>The site is slow and <code>uptime</code> shows a load average around 1 on a 2-core server that's normally idle. Find what's burning the CPU and stop it. While you're on the box, the product cache needs a rebuild that takes half an hour: start it so it keeps going after you log out.</p>",
    learn:
      "<h3>Processes</h3><p>Every running program is a <b>process</b> with a number, its <b>PID</b>. Each one belongs to a user and has a parent (the process that started it). <code>ps</code> takes a snapshot of them:</p>" +
      ex("ps") + ex("ps aux") +
      '<table class="t"><tr><th>Command</th><th>Shows</th></tr><tr><td><code>ps</code></td><td>your processes in this terminal</td></tr><tr><td><code>ps aux</code></td><td>every process, with user, %CPU, %MEM and the full command (BSD style, no dash)</td></tr><tr><td><code>ps -ef</code></td><td>every process, with the parent PID (PPID)</td></tr><tr><td><code>ps -u ben</code></td><td>ben\'s processes</td></tr><tr><td><code>ps -o pid,user,%cpu,cmd -p 1123</code></td><td>chosen columns for one PID</td></tr></table>' +
      "<p>Sort to put the busiest first, and keep the header plus a few lines:</p>" + ex("ps aux --sort=-%cpu | head -5") +
      "<p><code>top</code> is the live view: it refreshes every few seconds, sorted by CPU (press <b>M</b> for memory, <b>k</b> to kill, <b>q</b> to quit). For scripts, <code>top -b -n 1</code> prints one snapshot. The load average in <code>uptime</code> is roughly how many processes want a CPU; compare it with the number of cores (<code>nproc</code>).</p>" +
      "<h3>Finding a PID by name</h3>" + ex("pgrep nginx") + ex("pgrep -a -f gunicorn") +
      "<p><code>pgrep</code> matches the program name; <code>-f</code> matches the whole command line (needed for scripts run by <code>python3</code>); <code>-a</code> shows the command too.</p>" +
      "<h3>Signals</h3><p><code>kill</code> doesn't only kill: it sends a <b>signal</b>.</p>" +
      '<table class="t"><tr><th>Signal</th><th>Number</th><th>Means</th></tr><tr><td>TERM</td><td>15</td><td>please exit (the default). The program can clean up, or ignore it.</td></tr><tr><td>KILL</td><td>9</td><td>stop now. The kernel ends it; no clean-up, can\'t be ignored.</td></tr><tr><td>HUP</td><td>1</td><td>hang up; many servers reload their config on it</td></tr><tr><td>INT</td><td>2</td><td>what Ctrl+C sends</td></tr><tr><td>STOP / CONT</td><td>19 / 18</td><td>pause / resume</td></tr></table>' +
      code("kill 12345\nkill -9 12345") +
      "<p>Always try TERM first and KILL only if the process won't go: KILL can leave half-written files behind. You can signal only your own processes; for anyone else's you need <code>sudo</code>. <code>pkill -f PATTERN</code> signals by name instead of PID.</p>" +
      "<h3>Jobs: running things in the background</h3><p>A command that takes a long time blocks your terminal. Put <code>&amp;</code> at the end to run it in the background:</p>" +
      ex("sleep 300 &") + ex("jobs") +
      "<p>Bash prints the job number in brackets and the PID: <code>[1] 4103</code>. <code>jobs</code> lists them; <code>fg %1</code> brings job 1 back to the foreground; Ctrl+Z pauses the foreground job and <code>bg %1</code> resumes it in the background; <code>kill %1</code> signals it by job number.</p>" +
      "<h3>Surviving logout: nohup</h3><p>Background jobs belong to your shell: when you log out, they get a HUP and stop. <code>nohup</code> makes a command ignore HUP and sends its output to <code>nohup.out</code>:</p>" +
      code("nohup ./long-job.sh &") +
      '<div class="callout">For anything that should run permanently (a web app, a worker), don\'t use nohup: make it a systemd service. That\'s the next lab.</div>',
    files: {
      "scripts/rebuild-cache.sh": { content: "#!/bin/bash\n# Rebuilds the product cache. Takes about half an hour.\necho \"rebuilding cache at $(date +%T)\"\nsleep 1800\necho \"cache rebuilt\"\n", mode: 493 },
      "/home/ben/scripts/resize_images.py": { content: "# Resize every product image. Ignores SIGTERM so a half-done batch isn't lost.\nimport signal\nsignal.signal(signal.SIGTERM, signal.SIG_IGN)\n", owner: "ben", mode: 420 }
    },
    system: hog(4021),
    starter: "",
    objectives: [
      {
        id: "top", text: "List the processes <b>sorted by CPU use</b>, busiest first, so you can see what's eating the CPU.",
        hints: ["ps aux shows %CPU; --sort=-%cpu sorts by it, biggest first. Pipe into head to keep the top lines.", "ps aux --sort=-%cpu | head -5"],
        check: function (r) {
          var cand = [];
          r.history.forEach(function (e, i) { if (/\b(ps|top|htop)\b/.test(e.cmd) && !/-p\s*\d|\b4021\b/.test(e.cmd) && hasPid(firstProc(e), 4021)) cand.push(i); });
          if (!cand.length) return "List the processes sorted by CPU, busiest first, so the hungriest one is the first line under the header (ps aux --sort=-%cpu, or top).";
          var r2 = r.run(null, { system: hog(4077) });
          return cand.some(function (i) { return hasPid(firstProc(r2.history[i]), 4077); }) ? true : "Sort by CPU instead of picking the line by hand: on another machine your command didn't put the busiest process first.";
        }
      },
      {
        id: "pgrep", text: "It's ben's <code>resize_images.py</code> job. Print <b>just its PID</b> with <code>pgrep</code>.",
        hints: ["The program is python3; the script name is in the full command line. Which pgrep option matches that?", "pgrep -f resize_images"],
        check: function (r) { return prove(r, function (x) { return [String(x.sys.hogPid)]; }, { system: hog(4077) }, { filter: function (e) { return /\b(pgrep|pidof)\b/.test(e.cmd); } }, "Print just the PID of the resize_images.py job with pgrep (-f matches the whole command line).", "Find it with pgrep: on another machine, your command printed the wrong PID."); }
      },
      {
        id: "term", text: "Ask it to stop politely with <b>SIGTERM</b> (the default signal).",
        hints: ["kill PID sends TERM. It's ben's process, so dev needs sudo.", "sudo kill 4021"],
        check: function (r) {
          if (sigs(r).some(function (s) { return s.pid === 4021 && s.sig === 15; })) return true;
          if (sigs(r).some(function (s) { return s.pid === 4021; })) return "Send SIGTERM first (plain kill PID): it gives the program a chance to clean up. Reset the machine to try again.";
          if (ran(r, /kill/, function (e) { return /Operation not permitted|failed/.test(e.err.join(" ")); })) return "That process belongs to ben, so dev can't signal it. Put sudo in front.";
          return "Send it SIGTERM with kill.";
        }
      },
      {
        id: "kill", text: "Check: it ignored SIGTERM. Force it with <b>SIGKILL</b>, then check it's gone.",
        hints: ["ps -p PID shows whether it's still there. KILL is signal 9.", "ps -p 4021\nsudo kill -9 4021\npgrep -f resize_images"],
        check: function (r) {
          if (proc(r, /resize_images/)) return "It's still running. It ignores SIGTERM, so force it: sudo kill -9 PID.";
          var term = -1, kill = -1;
          sigs(r).forEach(function (s, i) { if (s.pid !== 4021) return; if (s.sig === 15 && term < 0) term = i; if (s.sig === 9 && kill < 0) kill = i; });
          if (term < 0 || kill < term) return "Escalate in order: SIGTERM first, SIGKILL only if it doesn't stop. Reset the machine and try again.";
          var k = idx(r, /kill/, function (e) { return /-9\b|KILL/.test(e.cmd); });
          return r.history.some(function (e, i) { return i > k && /\b(ps|pgrep|top|pidof)\b/.test(e.cmd); }) ? true : "Now check it's really gone (ps -p PID, or pgrep -f resize_images).";
        }
      },
      {
        id: "nohup", text: "Start <code>~/scripts/rebuild-cache.sh</code> in the background with <code>nohup</code>, so it would keep running after you log out.",
        hints: ["nohup in front, & at the end.", "nohup ~/scripts/rebuild-cache.sh &"],
        check: function (r) {
          var p = proc(r, /rebuild-cache\.sh/);
          if (!p && sigs(r).some(function (s) { return /rebuild-cache|^sleep 1800$/.test(s.cmd); })) return "The cache rebuild was stopped. It should still be running: only the sleep job had to go.";
          if (!p) return ran(r, /rebuild-cache/) ? "The script isn't running in the background: put & at the end. (In the foreground it would hold your terminal for half an hour.)" : "Start ~/scripts/rebuild-cache.sh in the background with nohup.";
          if (!p.nohup) return "It's running, but it would stop when you log out. Start it with nohup in front (kill this one first, or reset the machine).";
          return /rebuilding cache/.test((r.read("nohup.out") || "") + (r.read("scripts/nohup.out") || "")) ? true : "Its output should be in nohup.out.";
        }
      },
      {
        id: "jobs", text: "Start <code>sleep 900</code> in the background, list your jobs, then stop the sleep <b>by its job number</b>. Leave the cache rebuild running.",
        hints: ["jobs shows [1] and [2]. kill %N signals job N.", "sleep 900 &\njobs\nkill %2"],
        check: function (r) {
          if (!ran(r, /^\s*jobs\b/, function (e) { return outHas(e, /sleep 900/); })) return "Start sleep 900 in the background and list your jobs with jobs.";
          var killed = sigs(r).some(function (s) { return s.cmd === "sleep 900"; });
          if (!killed || !ran(r, /^\s*kill\s+(-\S+\s+)*%/)) return "Stop the sleep job by its job number: kill %N (N is the number jobs shows in brackets).";
          if (proc(r, /^sleep 900$/)) return "sleep 900 is still running.";
          return proc(r, /rebuild-cache\.sh/) ? true : "Oops: the cache rebuild should still be running. Only the sleep had to go.";
        }
      }
    ],
    solution: lines("ps aux --sort=-%cpu | head -5", "pgrep -f resize_images", "sudo kill 4021", "ps -p 4021", "sudo kill -9 4021", "pgrep -f resize_images", "nohup ~/scripts/rebuild-cache.sh &", "sleep 900 &", "jobs", "kill %2"),
    debrief: "<p>Ticket closed. The load average drops back to normal. You found the culprit by sorting, got its PID by name, and escalated the right way: TERM, a look, then KILL. Ben's script ignored TERM on purpose (to protect a half-done batch), which is exactly when KILL is justified.</p><p>The cache rebuild survives your logout thanks to <code>nohup</code>. Next ticket: things that should run forever don't belong in a terminal at all. They're <b>services</b>.</p>",
    realworld: "On any Linux box: run top and press P, M and q; try sleep 60 &, jobs, fg, then Ctrl+Z and bg. htop (sudo apt install htop) is a friendlier top.",
    quiz: [
      { q: "Which signal should you send first to stop a process?", options: ["KILL (9)", "TERM (15)", "STOP (19)", "HUP (1)"], answer: 1, why: "TERM lets the program clean up. KILL is the last resort." },
      { q: "Why did <code>kill 4021</code> fail as dev?", options: ["The PID was wrong", "The process belongs to another user; you need sudo", "kill needs -9", "Python processes can't be killed"], answer: 1, why: "You can signal only your own processes without root." },
      { q: "What does <code>nohup</code> add to a background job?", options: ["It runs faster", "It keeps running after you log out", "It runs as root", "It restarts if it crashes"], answer: 1, why: "It ignores the hang-up signal sent at logout. Restarting on crashes is what systemd services do." }
    ]
  });

  /* ================================================================== LX-112 Services */
  function workerUnit(name, desc, script) { return "[Unit]\nDescription=" + desc + "\nAfter=network.target kestrel-app.service\n\n[Service]\nUser=www-data\nEnvironmentFile=/etc/kestrel/" + name + ".env\nExecStart=/opt/kestrel/app/venv/bin/python3 /opt/kestrel/app/" + script + "\nRestart=on-failure\n\n[Install]\nWantedBy=multi-user.target\n"; }
  function brokenService(name, desc, script) {
    return function (sys) {
      var un = "kestrel-" + name + ".service";
      M2.putRoot(sys, "/etc/systemd/system/" + un, workerUnit(name, desc, script));
      M2.putRoot(sys, "/opt/kestrel/app/" + script, "import os, time\nqueue = os.environ[\"QUEUE_URL\"]\nprint(\"" + name + ": ready, polling the queue\")\nwhile True:\n    time.sleep(5)\n");
      M2.mkdirRoot(sys, "/etc/kestrel", 493);
      var u = M2.loadUnit(sys, un), t0 = Date.UTC(2026, 10, 9, 10, 21, 0), t = Date.UTC(2026, 10, 11, 3, 12, 9);
      M2.jadd(sys, "systemd", 1, "Started " + un + " - " + desc + ".", un, 6, t0);
      M2.jadd(sys, "python3", 1310, name + ": ready, polling the queue", un, 6, t0 + 900);
      M2.jadd(sys, "systemd", 1, "Stopping " + un + " - " + desc + "...", un, 6, t - 4000);
      M2.jadd(sys, "systemd", 1, un + ": Deactivated successfully.", un, 6, t - 3900);
      M2.jadd(sys, "systemd", 1, "Stopped " + un + " - " + desc + ".", un, 6, t - 3900);
      M2.jadd(sys, "systemd", 1, un + ": Failed to load environment files: No such file or directory", un, 3, t);
      M2.jadd(sys, "systemd", 1, un + ": Failed to spawn 'start' task: No such file or directory", un, 3, t);
      M2.jadd(sys, "systemd", 1, un + ": Failed with result 'resources'.", un, 4, t);
      M2.jadd(sys, "systemd", 1, "Failed to start " + un + " - " + desc + ".", un, 3, t);
      u.rt.active = "failed"; u.rt.sub = "failed"; u.rt.result = "resources"; u.rt.since = t;
    };
  }
  var WORKER_SYS = brokenService("worker", "Kestrel background worker", "worker.py"), MAILER_SYS = brokenService("mailer", "Kestrel mail sender", "mailer.py");
  var WORKER_ENV = "QUEUE_URL=redis://127.0.0.1:6379/0\nWORKER_THREADS=4\n";
  LABS.push({
    id: "lx-112", n: 12, module: 2, ticket: "LX-112", xp: 120,
    title: "The worker died overnight",
    topic: "systemctl and journalctl",
    from: MAYA,
    story: "<p>Orders placed since 3 a.m. haven't been processed: the background worker isn't running. The 03:12 deploy did some \"cleanup\". Find out what broke, fix it, and make sure the worker comes back by itself after a reboot.</p>",
    learn:
      "<h3>systemd and units</h3><p>On modern Linux, <b>systemd</b> (PID 1) starts and supervises everything that runs in the background: web servers, databases, SSH, cron. Each thing it manages is a <b>unit</b>; services end in <code>.service</code>. A unit file says how to run it:</p>" +
      code("[Unit]\nDescription=Kestrel web app\n\n[Service]\nUser=www-data\nExecStart=/opt/kestrel/app/venv/bin/gunicorn -b 127.0.0.1:8080 app:app\nRestart=on-failure\n\n[Install]\nWantedBy=multi-user.target") +
      "<p>Packaged units live in <code>/usr/lib/systemd/system</code>; your own and overrides go in <code>/etc/systemd/system</code>.</p>" +
      "<h3>systemctl</h3>" + ex("systemctl status nginx") +
      "<p>The status shows whether it's <b>Loaded</b> (and <b>enabled</b> at boot), whether it's <b>Active</b> and since when, the main PID, its processes, and the last log lines.</p>" +
      '<table class="t"><tr><th>Command</th><th>Does</th></tr><tr><td><code>sudo systemctl start|stop|restart UNIT</code></td><td>now</td></tr><tr><td><code>sudo systemctl reload UNIT</code></td><td>re-read config without stopping (if the service supports it)</td></tr><tr><td><code>sudo systemctl enable|disable UNIT</code></td><td>start at boot, or not (<code>--now</code> also starts/stops it)</td></tr><tr><td><code>systemctl is-active / is-enabled UNIT</code></td><td>one-word answers for scripts</td></tr><tr><td><code>systemctl --failed</code></td><td>what has failed</td></tr><tr><td><code>sudo systemctl daemon-reload</code></td><td>re-read unit files after you edit them</td></tr></table>' +
      '<div class="callout">Started and enabled are different: <b>start</b> runs it now; <b>enable</b> makes it start at boot. A server you fixed with start but forgot to enable is broken again after the next reboot.</div>' +
      "<h3>journalctl: the logs</h3><p>Everything a service prints, plus systemd's own messages about it, goes to the <b>journal</b>.</p>" +
      ex("journalctl -u nginx -n 20") +
      '<table class="t"><tr><th>Option</th><th>Means</th></tr><tr><td><code>-u UNIT</code></td><td>only this service</td></tr><tr><td><code>-n 20</code> / <code>-e</code></td><td>last 20 lines / jump to the end</td></tr><tr><td><code>-f</code></td><td>follow live (Ctrl+C to stop)</td></tr><tr><td><code>-p err</code></td><td>only errors and worse</td></tr><tr><td><code>--since "1 hour ago"</code>, <code>--since today</code></td><td>time window</td></tr><tr><td><code>-xeu UNIT</code></td><td>what systemd suggests after a failure</td></tr></table>',
    files: { "deploy/worker.env": { content: WORKER_ENV, mode: 416 } },
    system: WORKER_SYS,
    starter: "",
    objectives: [
      {
        id: "status", text: "Warm up: check <code>nginx</code>. Is it running, since when, and is it enabled at boot?",
        hints: ["systemctl has a command for exactly this.", "systemctl status nginx"],
        check: function (r) { return ran(r, /systemctl\s+status\s+nginx/, function (e) { return outHas(e, /Active: active \(running\)/); }) ? true : "Run systemctl status nginx and read the Loaded and Active lines."; }
      },
      {
        id: "failed", text: "Find which service has <b>failed</b>.",
        hints: ["systemctl can list only the failed units.", "systemctl --failed"],
        check: function (r) {
          var i = idx(r, /systemctl/, function (e) { return outHas(e, /kestrel-worker\.service\s+loaded\s+failed/); });
          if (i < 0) return "List the failed units (systemctl --failed).";
          var r2 = r.run(null, { system: MAILER_SYS });
          return outHas(r2.history[i], /kestrel-mailer\.service\s+loaded\s+failed/) ? true : "List the failed units with systemctl: on another server, your command didn't show the failed one.";
        }
      },
      {
        id: "why", text: "Read its log to find out <b>why</b> it failed.",
        hints: ["journalctl -u shows one unit's messages (systemctl status shows the last few too).", "journalctl -u kestrel-worker -n 20"],
        check: function (r) { return ran(r, /journalctl|systemctl\s+status/, function (e) { return /worker/.test(e.cmd) && outHas(e, /Failed to load environment files/); }) ? true : "Read kestrel-worker's log (journalctl -u kestrel-worker): what can't it load?"; }
      },
      {
        id: "fix", text: "Its environment file <code>/etc/kestrel/worker.env</code> was deleted. Put back the copy from <code>~/deploy/worker.env</code> and start the worker again.",
        hints: ["Copying into /etc needs sudo. Then restart the service.", "sudo cp ~/deploy/worker.env /etc/kestrel/worker.env\nsudo systemctl restart kestrel-worker"],
        check: function (r) {
          if ((r.read("/etc/kestrel/worker.env") || "") !== WORKER_ENV) return "/etc/kestrel/worker.env should be a copy of ~/deploy/worker.env.";
          return active(r, "kestrel-worker.service") ? true : "The file is back. Now start the service again (sudo systemctl restart kestrel-worker) and check its status.";
        }
      },
      {
        id: "enable", text: "Make sure the worker starts by itself after a reboot.",
        hints: ["Running now and starting at boot are two different things.", "sudo systemctl enable kestrel-worker"],
        check: function (r) { return enabled(r, "kestrel-worker.service") ? true : "systemctl is-enabled kestrel-worker should say enabled."; }
      },
      {
        id: "errors", text: "Finally, show only <b>error-level</b> messages in the journal from today, to make sure nothing else broke.",
        hints: ["journalctl has an option for priority and one for a time window.", "journalctl -p err --since today"],
        check: function (r) {
          return ran(r, /journalctl/, function (e) { return /(-p\s*|--priority=)(err|3|\w+\.\.(err|3))\b/.test(e.cmd) && outHas(e, /Failed to load environment files/) && !outHas(e, / Started /); }) ? true : "Filter the journal by priority (-p err) and by time (--since today).";
        }
      }
    ],
    solution: lines("systemctl status nginx", "systemctl --failed", "journalctl -u kestrel-worker -n 20", "sudo cp ~/deploy/worker.env /etc/kestrel/worker.env", "sudo systemctl restart kestrel-worker", "systemctl status kestrel-worker", "sudo systemctl enable kestrel-worker", "journalctl -p err --since today"),
    debrief: "<p>Ticket closed. The deploy's cleanup removed a file the worker's unit needed (<code>EnvironmentFile=</code>), so systemd refused to start it, and said so in the journal. <b>status → journal → fix → restart → enable</b> is the loop you'll use on every broken service.</p><p>And it wasn't enabled: before you fixed that, the next reboot would have broken it again, quietly.</p>",
    realworld: "On your own Linux machine: systemctl status ssh (or cron), journalctl -b -p err, and systemctl list-units --type=service. To see a unit's file: systemctl cat UNIT.",
    quiz: [
      { q: "What's the difference between <code>start</code> and <code>enable</code>?", options: ["None", "start runs it now; enable makes it start at boot", "enable runs it now; start at boot", "enable restarts it if it crashes"], answer: 1, why: "Use enable --now to do both." },
      { q: "Where do you read why a service failed?", options: ["/etc/systemd/system", "journalctl -u UNIT (or systemctl status UNIT)", "ps aux", "~/.bashrc"], answer: 1, why: "The journal has both the service's output and systemd's messages about it." },
      { q: "You edited a unit file. What must you run before restarting the service?", options: ["sudo systemctl daemon-reload", "sudo reboot", "source ~/.bashrc", "Nothing"], answer: 0, why: "systemd keeps unit files in memory; daemon-reload re-reads them." }
    ]
  });

  /* ================================================================== LX-113 Packages */
  LABS.push({
    id: "lx-113", n: 13, module: 2, ticket: "LX-113", xp: 120,
    title: "Patch day",
    topic: "apt and dpkg, versions, holding a package",
    from: DEV,
    story: "<p>Security updates are out for OpenSSL and OpenSSH. Patch <code>kc-web-01</code> today. One exception: the web team tested the app only against the nginx version we run now, so nginx must stay where it is until they're done. And while you're at it, install <code>tree</code>: everyone keeps asking for it.</p>",
    learn:
      "<h3>Packages</h3><p>Software on Ubuntu comes in <b>packages</b> (<code>.deb</code> files) from Ubuntu's repositories. <b>apt</b> downloads and installs them, along with what they depend on; <b>dpkg</b> is the lower-level tool that keeps track of what's installed.</p>" +
      '<table class="t"><tr><th>Command</th><th>Does</th></tr><tr><td><code>sudo apt update</code></td><td>refresh the list of available packages and versions (doesn\'t install anything)</td></tr><tr><td><code>apt list --upgradable</code></td><td>what has updates waiting</td></tr><tr><td><code>sudo apt upgrade</code></td><td>install all the updates</td></tr><tr><td><code>sudo apt install PKG</code></td><td>install a package</td></tr><tr><td><code>sudo apt remove PKG</code> / <code>purge</code></td><td>remove it (purge also deletes its config files)</td></tr><tr><td><code>apt search WORD</code>, <code>apt show PKG</code></td><td>find packages, see details</td></tr></table>' +
      '<div class="callout warn"><b>update</b> and <b>upgrade</b> are different: update only refreshes the list. Always update first, or apt doesn\'t know about the new versions.</div>' +
      ex("apt list --installed | head") +
      "<h3>Holding a package back</h3><p>Sometimes you must stay on a version (an app only tested against it). <code>apt-mark hold</code> stops upgrades from touching a package; <code>apt-mark unhold</code> releases it; <code>apt-mark showhold</code> lists holds.</p>" +
      "<h3>dpkg: what's installed, and who owns this file?</h3>" + ex("dpkg -l | grep openssh") +
      '<table class="t"><tr><th>Command</th><th>Shows</th></tr><tr><td><code>dpkg -l [PATTERN]</code></td><td>installed packages (<code>ii</code> = installed, <code>hi</code> = held, <code>rc</code> = removed but config kept)</td></tr><tr><td><code>dpkg -L PKG</code></td><td>files a package installed</td></tr><tr><td><code>dpkg -S /path/to/file</code></td><td>which package a file belongs to</td></tr><tr><td><code>apt policy PKG</code></td><td>installed and available versions</td></tr></table>' +
      "<p>When you type a command that isn't installed, Ubuntu tells you which package has it. Every install and upgrade is logged in <code>/var/log/apt/history.log</code> and <code>/var/log/dpkg.log</code>.</p>",
    files: {},
    starter: "",
    objectives: [
      {
        id: "update", text: "Refresh the package lists.",
        hints: ["Changing the system's package state needs root.", "sudo apt update"],
        check: function (r) { return r.sys.aptUpdated && ran(r, /\bapt(-get)?\s+update/) ? true : "Refresh the lists with sudo apt update."; }
      },
      {
        id: "list", text: "List the packages that have <b>updates waiting</b>.",
        hints: ["apt list has an option for this. It only knows about updates after apt update.", "apt list --upgradable"],
        check: function (r) { return ran(r, /\bapt\s+list\b.*--upgrad/, function (e) { return outHas(e, /^nginx\//) && outHas(e, /^openssl\//); }) ? true : "List the upgradable packages (after apt update): apt list --upgradable."; }
      },
      {
        id: "hold", text: "Hold <code>nginx</code> at its current version.",
        hints: ["apt-mark marks packages.", "sudo apt-mark hold nginx"],
        check: function (r) { return M2.pkg(r.sys, "nginx").hold ? true : "apt-mark showhold should list nginx."; }
      },
      {
        id: "upgrade", text: "Install all the other updates.",
        hints: ["One apt command upgrades everything; -y answers its question.", "sudo apt upgrade -y"],
        check: function (r) {
          var p = function (n) { return M2.pkg(r.sys, n); };
          if (p("nginx").curVer !== p("nginx").ver) return "nginx was upgraded: it should have been held first. Reset the machine and hold it before upgrading.";
          var left = ["openssl", "openssh-server", "openssh-client", "curl"].filter(function (n) { return p(n).curVer !== p(n).newVer; });
          return left.length ? "Not upgraded yet: " + left.join(", ") + ". (Did you hold nginx first, then run sudo apt upgrade?)" : true;
        }
      },
      {
        id: "tree", text: "Install <code>tree</code> and use it to show <code>/var/www/kestrel</code>.",
        hints: ["sudo apt install PKG", "sudo apt install -y tree\ntree /var/www/kestrel"],
        check: function (r) {
          if (!M2.pkg(r.sys, "tree").installed) return "Install the tree package.";
          return ran(r, /^\s*tree\b.*\/var\/www\/kestrel/, function (e) { return outHas(e, /app\.css/); }) ? true : "Now run tree /var/www/kestrel.";
        }
      },
      {
        id: "owner", text: "Ask dpkg which package installed <code>/usr/sbin/sshd</code>.",
        hints: ["dpkg -S searches the installed files.", "dpkg -S /usr/sbin/sshd"],
        check: function (r) { return ran(r, /\bdpkg(-query)?\s+(-S|--search)/, function (e) { return outHas(e, /^openssh-server: \/usr\/sbin\/sshd$/); }) ? true : "Use dpkg -S on the file's path."; }
      }
    ],
    solution: lines("sudo apt update", "apt list --upgradable", "sudo apt-mark hold nginx", "sudo apt upgrade -y", "apt list --upgradable", "sudo apt install -y tree", "tree /var/www/kestrel", "dpkg -S /usr/sbin/sshd"),
    debrief: "<p>Ticket closed. OpenSSL, OpenSSH and curl are patched; nginx is held at the tested version and shows up as \"kept back\" until the web team gives the go-ahead (<code>sudo apt-mark unhold nginx</code>). Notice that upgrading <code>openssh-server</code> restarted the <code>ssh</code> service for you: that's how the fixed code actually starts running.</p>",
    realworld: "On any Ubuntu/Debian machine: sudo apt update && apt list --upgradable. Servers usually get security updates automatically with the unattended-upgrades package; Module 4 sets that up.",
    quiz: [
      { q: "What does <code>sudo apt update</code> do?", options: ["Installs all updates", "Refreshes the list of available packages and versions", "Updates apt itself", "Reboots"], answer: 1, why: "upgrade installs; update only refreshes the list." },
      { q: "<code>dpkg -l</code> shows <code>hi</code> for nginx. What does it mean?", options: ["Half-installed", "Installed and held", "Has an issue", "Hidden"], answer: 1, why: "h = hold (desired state), i = installed." },
      { q: "Which command tells you what package owns <code>/usr/bin/ssh</code>?", options: ["dpkg -L ssh", "dpkg -S /usr/bin/ssh", "apt show /usr/bin/ssh", "which ssh"], answer: 1, why: "-S searches; -L lists one package's files." }
    ]
  });

  /* ================================================================== LX-114 Disk space */
  var BIG_MAIN = [
    { p: "/var/log/kestrel/debug.log", gb: 7.2, u: "www-data", g: "adm", c: "2026-11-11 08:59:59 DEBUG [orders] cache miss for key order:7731\n2026-11-11 08:59:59 DEBUG [orders] cache miss for key order:7732\n" },
    { p: "/home/ben/dumps/kestrel-2026-10.sql", gb: 2.3, u: "ben", c: "-- PostgreSQL database dump\n-- Dumped from database version 16.4\n" },
    { p: "/var/cache/apt/archives/linux-firmware_20240318.git3b128b60-0ubuntu2.3_amd64.deb", gb: 0.42, c: "!<arch>\n" },
    { p: "/var/cache/apt/archives/linux-modules-6.8.0-49-generic_6.8.0-49.49_amd64.deb", gb: 0.11, c: "!<arch>\n" }
  ];
  var BIG_ALT = [
    { p: "/var/log/kestrel/trace.log", gb: 6.1, u: "www-data", g: "adm", c: "2026-11-11 08:59:59 TRACE request start\n" },
    { p: "/home/ana/exports/orders-full.csv", gb: 1.6, u: "ana", c: "id,customer,total\n" },
    { p: "/var/cache/apt/archives/linux-firmware_20240318.git3b128b60-0ubuntu2.3_amd64.deb", gb: 0.42, c: "!<arch>\n" }
  ];
  function fullDisk(big) {
    return function (sys) {
      sys.mounts[1].used = 28300000;
      M2.mkdirRoot(sys, "/var/log/kestrel", 488, 0, 4);
      M2.mkdirRoot(sys, "/home/ben/dumps", 488, 1002, 1002);
      M2.mkdirRoot(sys, "/home/ana/exports", 488, 1001, 1001);
      big.forEach(function (b) { var n = M2.putRoot(sys, b.p, b.c, 416, S.uidOf(sys, b.u || "root"), S.gidOf(sys, b.g || b.u || "root"), NOW - DAY); n.size = Math.round(b.gb * GB); });
      M2.openFor(sys, 1302, big[0].p);
      sys.unitFiles["kestrel-app.service"] = [big[0].p];
    };
  }
  function bigFiles(sys) { var res = []; (function walk(n, p) { if (n.type === "d") Object.keys(n.children).forEach(function (k) { walk(n.children[k], (p === "/" ? "" : p) + "/" + k); }); else if (n.type === "f" && S.util.nodeSize(n) > GB) res.push(p); })(sys.root, "/"); return res.sort(); }
  function duRows(e) { var rows = []; e.out.forEach(function (l) { var m = /^([\d.]+)([KMGT]?)\s+(\S+)$/.exec(l.trim()); if (m) rows.push({ v: +m[1] * Math.pow(1024, " KMGT".indexOf(m[2] || " ")), p: absOut(e, m[3]) }); }); return rows; }
  function monotonic(vals) { var up = true, down = true; for (var i = 1; i < vals.length; i++) { if (vals[i] < vals[i - 1]) up = false; if (vals[i] > vals[i - 1]) down = false; } return up || down; }
  LABS.push({
    id: "lx-114", n: 14, module: 2, ticket: "LX-114", xp: 120,
    title: "The disk is almost full",
    topic: "df, du, lsblk, finding what fills the disk",
    from: MAYA,
    story: "<p>Monitoring says <code>/</code> on kc-web-01 is at 96%. At 100% nginx can't write its logs, the database dumps fail and things get weird. Find what's eating the space and get <code>/</code> back under 80%, without taking the site down.</p>",
    learn:
      "<h3>File systems and disks</h3><p>A disk is split into partitions; each holds a <b>file system</b> that is <b>mounted</b> on a folder of the one big tree. kc-web-01 has its system disk on <code>/</code> and a second, bigger disk mounted on <code>/srv/backups</code>. Files moved there leave <code>/</code> entirely.</p>" +
      ex("df -h") + ex("lsblk") +
      "<p><code>df</code> (disk free) shows each mounted file system: size, used, available, use%. <code>-h</code> makes the sizes human-readable. <code>df -h /var/log</code> shows only the one that holds that path. <code>lsblk</code> lists the disks and partitions and where they're mounted.</p>" +
      "<h3>Where is the space going? du</h3><p><code>du</code> (disk usage) adds up the size of folders.</p>" +
      ex("du -sh /var/log") + ex("sudo du -sh /var/* | sort -h") +
      "<p><code>-s</code> gives one total per argument, <code>-h</code> human sizes, and <code>sort -h</code> sorts human sizes (2K &lt; 3M &lt; 1G), so the biggest ends up last. Drill down level by level. Use <code>sudo</code>, or folders you can't read are skipped (with errors).</p>" +
      "<h3>Finding big files</h3>" + ex("sudo find / -type f -size +500M 2>/dev/null") +
      "<p><code>-size +1G</code> means bigger than 1 GB; <code>2&gt;/dev/null</code> hides the Permission denied noise.</p>" +
      "<h3>Deleting doesn't always free space</h3><p>A file's space is freed only when nothing has it open. If a running program is still writing to a log and you <code>rm</code> it, the name disappears but the program keeps the file, and its space, until it closes it or restarts. <code>sudo lsof +L1</code> lists such deleted-but-open files.</p>" +
      "<p>For a log that's still being written, empty it in place instead:</p>" + code("sudo truncate -s 0 /path/to/file.log") +
      '<div class="callout">Long term, logs shouldn\'t grow forever: <b>logrotate</b> (see <code>/etc/logrotate.d/</code>) rotates and compresses them, and debug logging shouldn\'t be left on in production.</div>',
    files: {},
    system: fullDisk(BIG_MAIN),
    starter: "",
    objectives: [
      {
        id: "df", text: "See how full each file system is, with human-readable sizes.",
        hints: ["df shows file systems; one option makes sizes readable.", "df -h"],
        check: function (r) { return ran(r, /^\s*df\b.*-\w*[hH]/, function (e) { return outHas(e, /\s\/$/); }) ? true : "Run df with the human-readable option."; }
      },
      {
        id: "lsblk", text: "List the disks to see which one is mounted on <code>/srv/backups</code>.",
        hints: ["It lists block devices.", "lsblk"],
        check: function (r) { return ran(r, /^\s*lsblk\b/, function (e) { return outHas(e, /\/srv\/backups/); }) ? true : "List the disks and partitions with lsblk."; }
      },
      {
        id: "du", text: "Find which folder in <code>/var</code> uses the most space: show the size of each folder in <code>/var</code>, <b>sorted by size</b>.",
        hints: ["du -sh on each /var/* folder, then sort -h. Use sudo so no folder is skipped.", "sudo du -sh /var/* | sort -h"],
        check: function (r) {
          var ok = ran(r, /\bdu\b/, function (e) { var rows = duRows(e).filter(function (x) { return /^\/var\/[^/]+$/.test(x.p); }); return rows.length >= 4 && rows.some(function (x) { return x.p === "/var/log"; }) && monotonic(rows.map(function (x) { return x.v; })); });
          return ok ? true : "Show one size per folder of /var (du -sh /var/*), sorted by size (| sort -h).";
        }
      },
      {
        id: "big", text: "Find <b>every file bigger than 1 GB</b> on the whole server. Print just their paths, and hide the permission errors.",
        hints: ["find / with -type f and -size, errors to /dev/null. Some big files are in folders only root can read.", "sudo find / -type f -size +1G 2>/dev/null"],
        check: function (r) {
          var want = bigFiles(r.run("").sys);
          var i = idx(r, /\bfind\b/, function (e) { return same(e.out.map(function (l) { return absOut(e, l); }).sort(), want); });
          if (i < 0) {
            if (ran(r, /\bfind\b/, function (e) { return e.out.length && e.out.every(function (l) { return want.indexOf(absOut(e, l)) >= 0; }); })) return "Close, but some big files are in folders dev can't read (see the Permission denied errors). Run find with sudo.";
            return "Print the paths of all files bigger than 1 GB on the whole server, and nothing else (find / -type f -size +1G 2>/dev/null).";
          }
          var r2 = r.run(null, { system: fullDisk(BIG_ALT) });
          var want2 = bigFiles(r2.run("").sys), e2 = r2.history[i];
          return same(e2.out.map(function (l) { return absOut(e2, l); }).sort(), want2) ? true : "Find them with a command: on another server, yours printed the wrong files.";
        }
      },
      {
        id: "free", text: "Get <code>/</code> below 80% used. The 7 GB debug log is still being written by the app, so empty it rather than deleting it, and keep the app running.",
        hints: ["truncate -s 0 empties a file in place. It's owned by www-data, so use sudo.", "sudo truncate -s 0 /var/log/kestrel/debug.log\ndf -h /"],
        check: function (r) {
          if (!active(r, "kestrel-app.service")) return "The app must keep running: start kestrel-app again.";
          var u = M2.mountUsage(r.sys, r.sys.mounts[1]);
          if (u.pct < 80) return true;
          if (r.sys.openFiles.some(function (f) { return M2.nodeAt(r.sys, f.path) !== f.node && M2.procByPid(r.sys, f.pid); })) return "You deleted the log, but the app still has it open, so the space is still used (sudo lsof +L1 shows it). Restarting the app makes it let go; next time empty such a file with truncate -s 0.";
          return "/ is still " + u.pct + "% used. The biggest file is the debug log: empty it with sudo truncate -s 0.";
        }
      },
      {
        id: "move", text: "Move ben's 2.3 GB database dump to the backup disk, <code>/srv/backups/</code>.",
        hints: ["It's in ben's home, which dev can't read: sudo mv.", "sudo mv /home/ben/dumps/kestrel-2026-10.sql /srv/backups/"],
        check: function (r) {
          var n = r.node("/srv/backups/kestrel-2026-10.sql");
          if (!n || S.util.nodeSize(n) < 2 * GB) return "/srv/backups/kestrel-2026-10.sql should be the 2.3 GB dump.";
          return r.exists("/home/ben/dumps/kestrel-2026-10.sql") ? "Move it (mv), don't copy it: the copy on / still uses the space." : true;
        }
      }
    ],
    solution: lines("df -h", "lsblk", "sudo du -sh /var/* | sort -h", "sudo find / -type f -size +1G 2>/dev/null", "sudo lsof +L1", "sudo truncate -s 0 /var/log/kestrel/debug.log", "sudo mv /home/ben/dumps/kestrel-2026-10.sql /srv/backups/", "df -h"),
    debrief: "<p>Ticket closed: <code>/</code> is back around 70%. The culprit was debug logging left on after an incident: 7 GB of cache misses. Emptying it in place freed the space immediately, while deleting it would have freed nothing until the app restarted. That's one of the most common \"I deleted it, why is the disk still full?\" moments in operations.</p><p>Follow-ups for the team: turn debug logging off, add the app log to logrotate, and keep dumps on the backup disk from the start.</p>",
    realworld: "On your own machine: df -h, then du -sh ~/* | sort -h to find what fills your home. ncdu (sudo apt install ncdu) is an interactive version of du.",
    quiz: [
      { q: "Which command shows how full each mounted file system is?", options: ["du -sh", "df -h", "lsblk", "free -h"], answer: 1, why: "df = disk free per file system; du adds up folder sizes; free is memory." },
      { q: "You deleted a 5 GB log but df shows no change. Why?", options: ["df is cached", "A process still has the file open", "rm moved it to the trash", "The file was a symlink"], answer: 1, why: "The space is freed when the last process closes it. lsof +L1 shows these files." },
      { q: "What does <code>sort -h</code> do?", options: ["Sorts hidden files", "Sorts human-readable sizes like 2K, 3M, 1G", "Sorts by hour", "Prints help"], answer: 1, why: "It understands the K/M/G suffixes du -h prints." }
    ]
  });

  /* ================================================================== LX-115 Networking */
  function rogue(sys) { M2.spawn(sys, { pid: 3877, ppid: 1, uid: 1002, cmd: "python3 -m http.server 8000", comm: "python3", cwd: "/home/ben/exports", start: NOW - 3 * HOUR, listen: [{ proto: "tcp", addr: "0.0.0.0", port: 8000 }], cpuSecs: 1, vsz: 30612, rss: 19840 }); }
  LABS.push({
    id: "lx-115", n: 15, module: 2, ticket: "LX-115", xp: 120,
    title: "Is the site really up?",
    topic: "ip, ss, curl, ping, dig, /etc/hosts",
    from: DEV,
    story: "<p>Two things today. First, a port scan from the office found something answering on <b>port 8000</b> of kc-web-01 that nobody remembers opening. Find it and shut it. Second, <code>kestrel.example.com</code> moves to this server tomorrow: its DNS still points to the old hosting provider. Check the site and the app here, and test the new site under its real name before the switch.</p>",
    learn:
      "<h3>Addresses</h3>" + ex("ip -br a") + ex("ip r") +
      "<p><code>ip a</code> (address) shows each network interface and its IP addresses: <code>lo</code> is the loopback (<code>127.0.0.1</code>, the machine talking to itself), <code>eth0</code> the network card. <code>ip r</code> (route) shows the <b>default gateway</b>: where traffic for other networks goes. <code>hostname -I</code> prints just the IPs.</p>" +
      "<h3>Ports: who's listening?</h3><p>A server program <b>listens</b> on a port: 22 for SSH, 80 for HTTP, 443 for HTTPS. <code>ss</code> lists the sockets:</p>" +
      ex("sudo ss -tlnp") +
      '<table class="t"><tr><th>Option</th><th>Means</th></tr><tr><td><code>-t</code> / <code>-u</code></td><td>TCP / UDP</td></tr><tr><td><code>-l</code></td><td>listening sockets</td></tr><tr><td><code>-n</code></td><td>numbers instead of service names</td></tr><tr><td><code>-p</code></td><td>the process (only yours, unless you use sudo)</td></tr></table>' +
      "<p>The local address matters: <code>127.0.0.1:8080</code> is reachable only from this machine; <code>0.0.0.0:80</code> from everywhere (all interfaces).</p>" +
      "<h3>Talking to servers: curl</h3>" + ex("curl -I http://localhost/") +
      "<p><code>curl URL</code> prints the page; <code>-I</code> only the response headers (the status line <code>HTTP/1.1 200 OK</code> tells you it worked); <code>-v</code> shows the whole conversation; <code>-s</code> hides the progress meter. The status codes: 2xx fine, 3xx redirect, 4xx your request was wrong (404 not found, 403 forbidden), 5xx the server failed (502: nginx couldn't reach the app behind it).</p>" +
      "<h3>Reachability and names</h3>" + ex("ping -c 3 kc-db-01") + ex("dig +short example.com") +
      "<p><code>ping</code> checks a host answers and how long a round trip takes. <b>DNS</b> turns names into IP addresses: <code>dig</code> asks DNS directly. But programs look in <code>/etc/hosts</code> <b>first</b>: a line there overrides DNS for this machine only, which is perfect for testing a site before DNS changes (and a classic cause of confusion when someone forgets to remove it).</p>",
    files: { "/home/ben/exports/customers-2026-11.csv": { content: "id,name,email\n1001,Ada Moss,ada@example.net\n1002,Sam Ito,sam@example.net\n", owner: "ben", mode: 420 } },
    system: rogue,
    starter: "",
    objectives: [
      {
        id: "ip", text: "Show this server's IP addresses.",
        hints: ["ip with the address object; -br makes it brief.", "ip -br a"],
        check: function (r) { return ran(r, /\bip\b|hostname\s+-I|ifconfig/, function (e) { return outHas(e, /10\.20\.0\.15/); }) ? true : "Show the addresses (ip a, ip -br a or hostname -I)."; }
      },
      {
        id: "listen", text: "List the <b>listening TCP ports</b> with the program behind each one. Make sure you can see every program.",
        hints: ["ss with -t -l -n -p. Without sudo, other users' programs are hidden.", "sudo ss -tlnp"],
        check: function (r) {
          if (ran(r, /\b(ss|netstat|lsof)\b/, function (e) { return rootish(e) && outHas(e, /:8000\b.*python3|python3.*:8000\b|python3.*\*:8000/); })) return true;
          if (ran(r, /\b(ss|netstat)\b/, function (e) { return outHas(e, /:8000\b/); })) return "You can see port 8000, but not who's behind it. Add sudo to see other users' processes.";
          return "List listening TCP sockets with their processes: sudo ss -tlnp.";
        }
      },
      {
        id: "stop", text: "It's ben's <code>python3 -m http.server</code>, serving his folder of customer exports to the whole network. Stop it.",
        hints: ["Its PID is in the users:((...)) column. It's ben's, so sudo.", "sudo kill 3877"],
        check: function (r) { return proc(r, /http\.server/) ? "The python3 web server is still running. Kill it by its PID (with sudo)." : true; }
      },
      {
        id: "head", text: "Check the website from the server itself: fetch <b>only the response headers</b> of <code>http://localhost/</code>.",
        hints: ["curl has an option for headers only.", "curl -I http://localhost/"],
        check: function (r) { return ran(r, /\bcurl\b/, function (e) { return /localhost|127\.0\.0\.1/.test(e.cmd) && outHas(e, /^HTTP\/1\.1 200 OK/) && !outHas(e, /<html|<!DOCTYPE/i); }) ? true : "curl -I http://localhost/ should show HTTP/1.1 200 OK and the headers only."; }
      },
      {
        id: "api", text: "Check the app directly, bypassing nginx: <code>http://127.0.0.1:8080/api/health</code>.",
        hints: ["The app listens on 127.0.0.1:8080 (you saw it in ss).", "curl http://127.0.0.1:8080/api/health"],
        check: function (r) { return ran(r, /\bcurl\b.*8080/, function (e) { return outHas(e, /^\{"status":"ok"\}$/); }) ? true : "curl the health URL on port 8080: it should print {\"status\":\"ok\"}."; }
      },
      {
        id: "dns", text: "Look up <code>kestrel.example.com</code> with <code>dig</code> (it's still the old server's address). Then make the name point to <code>127.0.0.1</code> <b>on this server only</b>, and fetch <code>http://kestrel.example.com/</code> to see the new site.",
        hints: ["dig +short NAME. /etc/hosts lines are: IP name. Appending to a root-owned file: echo ... | sudo tee -a FILE.", "dig +short kestrel.example.com\necho \"127.0.0.1 kestrel.example.com\" | sudo tee -a /etc/hosts\ncurl http://kestrel.example.com/"],
        check: function (r) {
          if (!ran(r, /\b(dig|host|nslookup)\b.*kestrel\.example\.com/, function (e) { return outHas(e, /203\.0\.113\.10/); })) return "Look the name up with dig first: it shows the old server's address, 203.0.113.10.";
          if (M2.resolve(r.sys, "kestrel.example.com") !== "127.0.0.1") return "Add a line to /etc/hosts so kestrel.example.com means 127.0.0.1 on this server.";
          return ran(r, /\bcurl\b.*kestrel\.example\.com/, function (e) { return outHas(e, /all systems normal/); }) ? true : "Now fetch http://kestrel.example.com/: you should get the new site (\"all systems normal\"), not the old one.";
        }
      }
    ],
    solution: lines("ip -br a", "sudo ss -tlnp", "sudo kill 3877", "curl -I http://localhost/", "curl http://127.0.0.1:8080/api/health", "dig +short kestrel.example.com", "echo \"127.0.0.1 kestrel.example.com\" | sudo tee -a /etc/hosts", "curl http://kestrel.example.com/"),
    debrief: "<p>Ticket closed. The mystery port was a developer's quick <code>python3 -m http.server</code>: handy for sharing a file for a minute, dangerous left running on <code>0.0.0.0</code> next to customer data. Dev will talk to Ben, and the firewall (Module 4) will stop unexpected ports reaching the outside at all.</p><p>The <code>/etc/hosts</code> override lets you test the new site under its real name while the world still goes to the old one. Remove it after the DNS switch, or this server will keep talking to itself.</p>",
    realworld: "On your own machine: ip a (or ipconfig on Windows), ss -tlnp (netstat -an on Windows), curl -I https://example.com, dig +short example.com. Your /etc/hosts works the same way (C:\\Windows\\System32\\drivers\\etc\\hosts on Windows).",
    quiz: [
      { q: "A service listens on <code>127.0.0.1:8080</code>. Who can connect to it?", options: ["Anyone on the internet", "Only programs on this machine", "Only root", "Only the local network"], answer: 1, why: "127.0.0.1 is the loopback; 0.0.0.0 would mean every interface." },
      { q: "nginx returns <b>502 Bad Gateway</b>. What's the likely cause?", options: ["The page doesn't exist", "nginx couldn't reach the app behind it", "Your password is wrong", "DNS is broken"], answer: 1, why: "502 comes from a proxy whose upstream (the app) didn't answer." },
      { q: "Why might <code>dig</code> and <code>curl</code> disagree about a name's address?", options: ["dig is older", "curl reads /etc/hosts first; dig asks DNS directly", "curl uses IPv6", "They never disagree"], answer: 1, why: "/etc/hosts overrides DNS for normal programs, not for dig." }
    ]
  });

  /* ================================================================== LX-116 SSH */
  var ORDERS = "date,orders,revenue\n2026-11-01,1342,40211.50\n2026-11-02,1290,38730.00\n2026-11-03,1407,42690.25\n";
  function backupHost(r) { return M2.machine(r.sys, "kc-backup-01"); }
  function sshConfigHost(r, alias) {
    var t = r.read(".ssh/config"); if (t === null) return null;
    var blocks = {}, cur = null;
    L(t).forEach(function (l) { l = l.replace(/#.*/, "").trim(); var m = /^(\S+)\s*(?:=\s*|\s+)(.*)$/.exec(l); if (!m) return; var k = m[1].toLowerCase(); if (k === "host") { cur = {}; m[2].split(/\s+/).forEach(function (h) { blocks[h] = cur; }); } else if (cur && cur[k] === undefined) cur[k] = m[2].trim(); });
    return blocks[alias] || null;
  }
  LABS.push({
    id: "lx-116", n: 16, module: 2, ticket: "LX-116", xp: 120,
    title: "Backups need a key",
    topic: "SSH keys, authorized_keys, ~/.ssh/config, scp, rsync",
    from: MAYA,
    story: "<p>Backups of kc-web-01 go to <code>kc-backup-01</code>, into <code>/srv/backups/kc-web-01</code>, as the <code>backup-svc</code> account. The nightly job can't type a password, so it needs <b>key-based</b> login. I gave you <code>backup-svc</code>'s password once (the lab types it when it's needed). Set up the key, make <code>ssh backup</code> a shortcut, and send the first files over.</p>",
    learn:
      "<h3>SSH</h3><p><code>ssh user@host</code> opens an encrypted shell on another machine; <code>ssh user@host COMMAND</code> runs one command there and comes back. <code>exit</code> leaves a remote shell. The first time you connect, ssh shows the server's <b>host key fingerprint</b> and saves it in <code>~/.ssh/known_hosts</code>; if it ever changes, ssh warns you loudly (someone may be impersonating the server).</p>" +
      "<h3>Keys instead of passwords</h3><p>A key pair is two files: the <b>private key</b> (stays on your machine, readable only by you) and the <b>public key</b> (<code>.pub</code>, you hand it out). A server lets you in if your public key is in <code>~/.ssh/authorized_keys</code> of the account you log in to.</p>" +
      ex("ssh-keygen -t ed25519 -C \"dev@kc-web-01\"") +
      "<p>That creates <code>~/.ssh/id_ed25519</code> and <code>~/.ssh/id_ed25519.pub</code>. A passphrase encrypts the private key; keys for unattended jobs often have none, so protect the file instead. <code>ssh-copy-id user@host</code> appends your public key to the server's authorized_keys, using your password one last time.</p>" +
      '<div class="callout warn">SSH refuses a private key that others can read (<code>chmod 600</code> it), and a server ignores authorized_keys that others could write. Never share or copy your private key: give out the .pub.</div>' +
      "<h3>~/.ssh/config: shortcuts</h3>" + code("Host backup\n    HostName kc-backup-01\n    User backup-svc") +
      "<p>Now <code>ssh backup</code> means <code>ssh backup-svc@kc-backup-01</code>, and so does <code>backup:</code> in scp and rsync. Write it with <code>printf '...\\n...' &gt;&gt; ~/.ssh/config</code> in this lab (no full-screen editors).</p>" +
      "<h3>Copying files: scp and rsync</h3>" + code("scp report.csv backup:/srv/backups/kc-web-01/") +
      "<p><code>scp SRC DEST</code> copies over SSH; <code>-r</code> for folders. <code>rsync</code> is smarter: it sends only what changed, so the second run is almost instant.</p>" +
      code("rsync -av ~/site/ backup:/srv/backups/kc-web-01/site/") +
      "<p><code>-a</code> (archive) copies folders and keeps permissions and times; <code>-v</code> lists what's sent. The <b>trailing slash</b> matters: <code>site/</code> means \"the contents of site\", <code>site</code> means \"the folder itself\" (you'd get <code>site/site/</code>). Use <code>-n</code> to see what would happen first.</p>",
    files: { "reports/orders-2026-11.csv": ORDERS },
    starter: "",
    objectives: [
      {
        id: "keygen", text: "Create an <b>ed25519</b> key pair in the default location (<code>~/.ssh/id_ed25519</code>).",
        hints: ["ssh-keygen -t picks the type. The lab presses Enter at its questions.", "ssh-keygen -t ed25519 -C \"dev@kc-web-01\""],
        check: function (r) {
          var priv = r.read(".ssh/id_ed25519"), pub = r.read(".ssh/id_ed25519.pub");
          if (!priv || !pub) return "There's no ~/.ssh/id_ed25519 key pair yet.";
          var p = M2.ssh.pubOfPriv(priv);
          if (!p || pub.split(/\s+/)[1] !== p.blob) return "id_ed25519.pub doesn't match id_ed25519. Create the pair with ssh-keygen.";
          return r.mode(".ssh/id_ed25519") === "600" ? true : "The private key must be readable only by you: chmod 600 ~/.ssh/id_ed25519.";
        }
      },
      {
        id: "copy", text: "Install your public key for <code>backup-svc</code> on <code>kc-backup-01</code>.",
        hints: ["One command appends it to the server's authorized_keys.", "ssh-copy-id backup-svc@kc-backup-01"],
        check: function (r) {
          var pub = r.read(".ssh/id_ed25519.pub"); if (!pub) return "Create your key first.";
          var ak = M2.rd(backupHost(r), "/home/backup-svc/.ssh/authorized_keys") || "";
          return ak.indexOf(pub.split(/\s+/)[1]) >= 0 ? true : "Your public key isn't in backup-svc's ~/.ssh/authorized_keys on kc-backup-01 yet (ssh-copy-id puts it there).";
        }
      },
      {
        id: "login", text: "Prove the key works: run <code>hostname</code> on kc-backup-01 over SSH, with no password.",
        hints: ["ssh user@host COMMAND runs one command there.", "ssh backup-svc@kc-backup-01 hostname"],
        check: function (r) {
          var ok = (r.sys.sshLog || []).some(function (x) { return x.host === "kc-backup-01" && x.user === "backup-svc" && x.method === "publickey" && x.purpose === "ssh"; });
          if (!ok) return "Log in to backup-svc@kc-backup-01 with ssh using your key (no password prompt).";
          return ran(r, /^\s*ssh\b/, function (e) { return outHas(e, /^kc-backup-01$/); }) ? true : "Run hostname on it: ssh backup-svc@kc-backup-01 hostname.";
        }
      },
      {
        id: "config", text: "Add a <code>Host backup</code> entry to <code>~/.ssh/config</code> (HostName kc-backup-01, User backup-svc) and use <code>ssh backup</code>.",
        hints: ["Three lines: Host backup, HostName ..., User .... printf with \\n writes several lines.", "printf 'Host backup\\n    HostName kc-backup-01\\n    User backup-svc\\n' >> ~/.ssh/config\nssh backup hostname"],
        check: function (r) {
          var b = sshConfigHost(r, "backup");
          if (!b) return "~/.ssh/config needs a Host backup block.";
          if ((b.hostname || "").toLowerCase() !== "kc-backup-01" || b.user !== "backup-svc") return "The Host backup block needs HostName kc-backup-01 and User backup-svc.";
          return (r.sys.sshLog || []).some(function (x) { return x.alias === "backup" && x.method === "publickey"; }) ? true : "Now use it: ssh backup hostname.";
        }
      },
      {
        id: "scp", text: "Copy <code>~/reports/orders-2026-11.csv</code> to <code>/srv/backups/kc-web-01/</code> on the backup server.",
        hints: ["scp SRC host:DEST, and you have a shortcut for the host.", "scp ~/reports/orders-2026-11.csv backup:/srv/backups/kc-web-01/"],
        check: function (r) { return M2.rd(backupHost(r), "/srv/backups/kc-web-01/orders-2026-11.csv") === ORDERS ? true : "kc-backup-01:/srv/backups/kc-web-01/orders-2026-11.csv isn't there yet."; }
      },
      {
        id: "rsync", text: "Copy the <b>contents</b> of <code>/var/www/kestrel</code> to <code>/srv/backups/kc-web-01/site/</code> on the backup server with <code>rsync</code>, keeping permissions and times.",
        hints: ["rsync -a keeps permissions and times. Mind the trailing slash on the source.", "rsync -av /var/www/kestrel/ backup:/srv/backups/kc-web-01/site/"],
        check: function (r) {
          var m = backupHost(r), idxN = M2.nodeAt(m, "/srv/backups/kc-web-01/site/index.html"), src = r.node("/var/www/kestrel/index.html");
          if (M2.nodeAt(m, "/srv/backups/kc-web-01/site/kestrel")) return "You copied the folder itself (site/kestrel/...). Put a slash after the source (/var/www/kestrel/) to copy its contents.";
          if (!idxN || idxN.content !== src.content || M2.rd(m, "/srv/backups/kc-web-01/site/assets/app.css") !== r.read("/var/www/kestrel/assets/app.css")) return "site/ on the backup server should hold index.html and assets/app.css from /var/www/kestrel.";
          if (!ran(r, /\brsync\b/)) return "Use rsync for this one.";
          return idxN.mtime === src.mtime ? true : "The times weren't kept: use rsync -a.";
        }
      }
    ],
    solution: lines("ssh-keygen -t ed25519 -C \"dev@kc-web-01\" -N \"\" -f ~/.ssh/id_ed25519", "ssh-copy-id backup-svc@kc-backup-01", "ssh backup-svc@kc-backup-01 hostname", "printf 'Host backup\\n    HostName kc-backup-01\\n    User backup-svc\\n' >> ~/.ssh/config", "ssh backup hostname", "scp ~/reports/orders-2026-11.csv backup:/srv/backups/kc-web-01/", "rsync -av /var/www/kestrel/ backup:/srv/backups/kc-web-01/site/"),
    debrief: "<p>Ticket closed. kc-web-01 can now reach kc-backup-01 with a key and no password, which is exactly what a scheduled backup needs. You typed the password once (through ssh-copy-id) and never again.</p><p>Security notes for later: this key has no passphrase, so the file itself is the secret. In Module 4 you'll restrict what such a key may do on the server, and turn off password logins entirely.</p>",
    realworld: "On your own laptop: ssh-keygen -t ed25519, then add the .pub to GitHub (Settings → SSH keys) and run ssh -T git@github.com. That's exactly what the Git track will need.",
    quiz: [
      { q: "Which file do you give to a server admin?", options: ["~/.ssh/id_ed25519", "~/.ssh/id_ed25519.pub", "~/.ssh/known_hosts", "~/.ssh/config"], answer: 1, why: "The public key. The private key never leaves your machine." },
      { q: "Where does a server look for the keys allowed to log in as backup-svc?", options: ["/etc/ssh/sshd_config", "~backup-svc/.ssh/authorized_keys", "~backup-svc/.ssh/known_hosts", "/etc/passwd"], answer: 1, why: "authorized_keys, one public key per line." },
      { q: "<code>rsync -a src dst/</code> vs <code>rsync -a src/ dst/</code>?", options: ["Same", "The first puts the folder src inside dst; the second copies src's contents into dst", "The first deletes src", "The second is recursive, the first isn't"], answer: 1, why: "A trailing slash on the source means \"the contents of\"." }
    ]
  });

  /* ================================================================== LX-117 Scheduling */
  var BACKUP_SVC = "[Unit]\nDescription=Back up the Kestrel website\n\n[Service]\nType=oneshot\nExecStart=/usr/local/bin/kestrel-backup.sh\n";
  var BACKUP_TIMER = "[Unit]\nDescription=Nightly Kestrel website backup\n\n[Timer]\nOnCalendar=weekly\nPersistent=true\n\n[Install]\nWantedBy=timers.target\n";
  function eqNums(a, b) { return H.same(a, b); }
  function cron(r) { return M2.cron.entries(r.sys, "dev"); }
  function isDaily0230(e) { return eqNums(e.min, [30]) && eqNums(e.hour, [2]) && e.dom.length === 31 && e.mon.length === 12 && e.dow.length === 7 && /rotate-reports\.sh/.test(e.cmd); }
  function isWeekday15(e) { return eqNums(e.min, [0, 15, 30, 45]) && e.hour.length === 24 && e.dom.length === 31 && e.mon.length === 12 && eqNums(e.dow, [1, 2, 3, 4, 5]) && /healthcheck\.sh/.test(e.cmd); }
  function at0300(spec) { var c = M2.parseCalendar(spec); return !!c && !c.dow && !c.Y && !c.M && !c.D && eqNums(c.h, [3]) && eqNums(c.m, [0]) && eqNums(c.s, [0]); }
  LABS.push({
    id: "lx-117", n: 17, module: 2, ticket: "LX-117", xp: 120,
    title: "Run it every night",
    topic: "cron syntax and systemd timers",
    from: MAYA,
    story: "<p>Three things should happen without anyone at the keyboard: rotate the report files every night, run a health check every 15 minutes during the work week, and back up the website every night at 03:00. The first two are small scripts of yours: use <b>cron</b>. The backup runs as root and we want its logs in the journal: make it a <b>systemd timer</b>. The unit files are drafted in <code>~/units</code>.</p>",
    learn:
      "<h3>cron</h3><p>The cron daemon runs commands on a schedule. Each user has a <b>crontab</b>: one line per job, five time fields then the command.</p>" +
      code("# m   h   dom mon dow  command\n  30  2   *   *   *    /home/dev/bin/rotate-reports.sh\n  */15 *  *   *   1-5  /home/dev/bin/healthcheck.sh") +
      '<table class="t"><tr><th>Field</th><th>Values</th></tr><tr><td>minute</td><td>0-59</td></tr><tr><td>hour</td><td>0-23</td></tr><tr><td>day of month</td><td>1-31</td></tr><tr><td>month</td><td>1-12 or jan-dec</td></tr><tr><td>day of week</td><td>0-7 (0 and 7 are Sunday) or sun-sat</td></tr></table>' +
      "<p><code>*</code> means every, <code>*/15</code> every 15th, <code>1-5</code> a range, <code>1,15</code> a list. Shortcuts: <code>@daily</code>, <code>@hourly</code>, <code>@reboot</code>. The times are the server's time zone (here UTC: check with <code>timedatectl</code>).</p>" +
      ex("crontab -l") +
      "<p><code>crontab -l</code> lists your crontab; <code>crontab -e</code> edits it in an editor. Without an editor (scripts, this lab), replace it from standard input. To <b>add</b> a line, print the current one and the new line together:</p>" +
      ex("(crontab -l 2>/dev/null; echo \"0 7 * * 1 /home/dev/bin/weekly.sh\") | crontab -") +
      '<div class="callout warn"><code>echo \"...\" | crontab -</code> alone <b>replaces</b> the whole crontab. And cron runs with a minimal PATH and no aliases: use full paths in jobs.</div>' +
      "<p>System-wide jobs live in <code>/etc/crontab</code> and <code>/etc/cron.d/</code> (with a user field), and scripts in <code>/etc/cron.daily/</code> etc.</p>" +
      "<h3>systemd timers</h3><p>A timer unit starts a service unit on a schedule. The service does the work; the timer says when:</p>" +
      code("[Timer]\nOnCalendar=*-*-* 03:00:00\nPersistent=true\n\n[Install]\nWantedBy=timers.target") +
      "<p><code>OnCalendar</code> is <code>[weekday] year-month-day hour:minute:second</code>: <code>*-*-* 03:00:00</code> is every day at 03:00, <code>Mon..Fri 09:00</code> weekdays at 9, <code>daily</code> midnight. <code>Persistent=true</code> runs a missed job after the server comes back up. Check a spec before trusting it:</p>" +
      ex("systemd-analyze calendar \"Mon..Fri 09:00\"") +
      "<p>Install units by copying them to <code>/etc/systemd/system/</code>, then <code>sudo systemctl daemon-reload</code>, then <code>sudo systemctl enable --now NAME.timer</code>. <code>systemctl list-timers</code> shows when each fires next. To test the job, start the <b>service</b> directly. To change one line of a file without an editor, <code>sed -i</code> works:</p>" +
      ex("sed -n '/OnCalendar/p' ~/units/kestrel-backup.timer") +
      code("sudo sed -i 's/^OnCalendar=.*/OnCalendar=Mon..Fri 09:00/' FILE") +
      "<p>Why timers over cron for system jobs? Output goes to the journal, failures show in <code>systemctl --failed</code>, missed runs can catch up, and you can run the job by hand exactly as the schedule would.</p>",
    files: {
      "bin/rotate-reports.sh": { content: "#!/bin/bash\n# Keep 30 days of reports\nfind /home/dev/reports -name '*.csv' -mtime +30 -delete\n", mode: 493 },
      "bin/healthcheck.sh": { content: "#!/bin/bash\ncurl -fsS http://localhost/api/health > /dev/null || echo \"health check failed at $(date)\" >> /home/dev/health-failures.log\n", mode: 493 },
      "units/kestrel-backup.service": BACKUP_SVC,
      "units/kestrel-backup.timer": BACKUP_TIMER,
      "/usr/local/bin/kestrel-backup.sh": { content: "#!/bin/bash\n# Archive the website into the backup disk\ntar czf /srv/backups/kestrel-site-$(date +%F).tar.gz -C /var/www kestrel && echo \"backup written\"\n", mode: 493 }
    },
    starter: "",
    objectives: [
      {
        id: "cron1", text: "Add a line to <b>your crontab</b>: run <code>~/bin/rotate-reports.sh</code> every day at <b>02:30</b>.",
        hints: ["minute hour * * * command. Add it without an editor: (crontab -l; echo LINE) | crontab -", "(crontab -l 2>/dev/null; echo \"30 2 * * * /home/dev/bin/rotate-reports.sh\") | crontab -"],
        check: function (r) { return cron(r).some(isDaily0230) ? true : "crontab -l should have a line that runs /home/dev/bin/rotate-reports.sh at minute 30 of hour 2, every day."; }
      },
      {
        id: "cron2", text: "Add a second line, keeping the first: run <code>~/bin/healthcheck.sh</code> <b>every 15 minutes, Monday to Friday</b>.",
        hints: ["*/15 for the minutes, 1-5 for the days of the week.", "(crontab -l; echo \"*/15 * * * 1-5 /home/dev/bin/healthcheck.sh\") | crontab -"],
        check: function (r) {
          var es = cron(r);
          if (!es.some(isWeekday15)) return "There's no line running healthcheck.sh every 15 minutes on weekdays.";
          return es.some(isDaily0230) ? true : "The 02:30 rotate-reports line is gone: add both (crontab -l prints the current lines; keep them).";
        }
      },
      {
        id: "calendar", text: "Before writing the timer, check a spec: ask <code>systemd-analyze</code> when <code>*-*-* 03:00:00</code> next fires.",
        hints: ["systemd-analyze calendar SPEC (quote it).", "systemd-analyze calendar \"*-*-* 03:00:00\""],
        check: function (r) { return ran(r, /systemd-analyze\s+calendar/, function (e) { return outHas(e, /Normalized form: \*-\*-\* 03:00:00/); }) ? true : "Run systemd-analyze calendar with a spec for every day at 03:00."; }
      },
      {
        id: "timer", text: "Install the service and timer from <code>~/units</code> into <code>/etc/systemd/system</code>, set the timer to fire <b>every day at 03:00</b> (it says weekly), then enable and start the timer.",
        hints: ["sudo cp, then change the OnCalendar= line (sed -i), daemon-reload, enable --now.", "sudo cp ~/units/kestrel-backup.service ~/units/kestrel-backup.timer /etc/systemd/system/\nsudo sed -i 's/^OnCalendar=.*/OnCalendar=*-*-* 03:00:00/' /etc/systemd/system/kestrel-backup.timer\nsudo systemctl daemon-reload\nsudo systemctl enable --now kestrel-backup.timer"],
        check: function (r) {
          var t = r.read("/etc/systemd/system/kestrel-backup.timer");
          if (t === null || r.read("/etc/systemd/system/kestrel-backup.service") === null) return "Copy both unit files to /etc/systemd/system/.";
          var specs = (t.match(/^OnCalendar=(.*)$/mg) || []).map(function (l) { return l.replace(/^OnCalendar=/, "").trim(); });
          if (specs.length !== 1 || !at0300(specs[0])) return "The timer's OnCalendar= should mean every day at 03:00 (e.g. *-*-* 03:00:00). It says: " + (specs.join(", ") || "nothing");
          var u = unit(r, "kestrel-backup.timer");
          if (u.stale) return "You changed the file after systemd loaded it: run sudo systemctl daemon-reload, then restart the timer.";
          if (u.rt.active !== "active") return "Start the timer (sudo systemctl enable --now kestrel-backup.timer).";
          if (!(u.onCalendar || []).some(at0300)) return "The running timer still has the old schedule: daemon-reload and restart it.";
          return enabled(r, "kestrel-backup.timer") ? true : "Enable the timer so it survives a reboot.";
        }
      },
      {
        id: "list", text: "Confirm with <code>systemctl list-timers</code> that it next fires tomorrow at 03:00.",
        hints: ["systemctl list-timers"],
        check: function (r) { return ran(r, /systemctl\s+list-timers/, function (e) { return outHas(e, /Thu 2026-11-12 03:00:00 UTC.*kestrel-backup\.timer/); }) ? true : "systemctl list-timers should show kestrel-backup.timer next at Thu 2026-11-12 03:00:00."; }
      },
      {
        id: "now", text: "Don't wait until 03:00: run the backup <b>service</b> once now and read its log.",
        hints: ["Start the .service (not the timer), then journalctl -u.", "sudo systemctl start kestrel-backup.service\njournalctl -u kestrel-backup"],
        check: function (r) {
          if (!r.exists("/srv/backups/kestrel-site-2026-11-11.tar.gz")) return "Start kestrel-backup.service: it should write /srv/backups/kestrel-site-2026-11-11.tar.gz.";
          return ran(r, /journalctl|systemctl\s+status/, function (e) { return /kestrel-backup/.test(e.cmd) && outHas(e, /backup written/); }) ? true : "Read its log: journalctl -u kestrel-backup.";
        }
      }
    ],
    solution: lines("(crontab -l 2>/dev/null; echo \"30 2 * * * /home/dev/bin/rotate-reports.sh\") | crontab -", "(crontab -l; echo \"*/15 * * * 1-5 /home/dev/bin/healthcheck.sh\") | crontab -", "crontab -l", "systemd-analyze calendar \"*-*-* 03:00:00\"", "sudo cp ~/units/kestrel-backup.service ~/units/kestrel-backup.timer /etc/systemd/system/", "sudo sed -i 's/^OnCalendar=.*/OnCalendar=*-*-* 03:00:00/' /etc/systemd/system/kestrel-backup.timer", "sudo systemctl daemon-reload", "sudo systemctl enable --now kestrel-backup.timer", "systemctl list-timers", "sudo systemctl start kestrel-backup.service", "journalctl -u kestrel-backup"),
    debrief: "<p>Ticket closed. Your two scripts run from your crontab; the website backup is a proper systemd job: scheduled, logged in the journal, visible in <code>list-timers</code>, and testable by starting the service. Running it once by hand before trusting the schedule is a good habit: a job that's only ever run at 3 a.m. fails silently at 3 a.m.</p><p>From a security angle, cron and timers are also where attackers hide things that come back after a reboot. You'll hunt for those in Module 4.</p>",
    realworld: "crontab.guru explains any cron line in plain English. On your own Linux machine: crontab -l, systemctl list-timers, and ls /etc/cron.d.",
    quiz: [
      { q: "What does <code>0 */6 * * *</code> mean?", options: ["Every 6 minutes", "At minute 0 of every 6th hour (00:00, 06:00, 12:00, 18:00)", "On the 6th of each month", "6 times a day at random"], answer: 1, why: "Fields: minute, hour, day of month, month, day of week." },
      { q: "<code>echo \"* * * * * job\" | crontab -</code> does what to your existing crontab?", options: ["Appends the line", "Replaces the whole crontab with that line", "Nothing, it needs -e", "Checks the syntax only"], answer: 1, why: "crontab - installs stdin as the whole crontab; that's why you prepend crontab -l." },
      { q: "You edited a timer file in /etc/systemd/system. What's needed before the change takes effect?", options: ["sudo systemctl daemon-reload (and restart the timer)", "crontab -e", "A reboot", "Nothing"], answer: 0, why: "systemd re-reads unit files only on daemon-reload." }
    ]
  });

  /* ================================================================== LX-118 Archives & backups */
  var GOOD_INDEX = "<!DOCTYPE html>\n<html><head><title>Kestrel Cloud</title><link rel=\"stylesheet\" href=\"/assets/app.css\"></head>\n<body><h1>Kestrel Cloud</h1><p>Status: all systems normal.</p></body></html>\n";
  var BROKEN_INDEX = "<!DOCTYPE html>\n<html><head><title>{{ site_title }}</title>\n<body><h1>{{ site_title }}</h1>\n";
  var PROJ = { "README.md": "# Kestrel\nThe Kestrel web shop.\n", "app/app.py": "from flask import Flask\napp = Flask(__name__)\n", "app/config.yml": "log_level: info\nqueue: redis://127.0.0.1:6379/0\n", "cache/a1.tmp": "x\n", "cache/b2.tmp": "y\n" };
  var OLD_LOGS = { "logs/old/app-2026-10-29.log": "2026-10-29 10:00:01 INFO started\n", "logs/old/app-2026-10-30.log": "2026-10-30 10:00:01 INFO started\n", "logs/old/app-2026-10-31.log": "2026-10-31 10:00:01 INFO started\n" };
  function projFiles() { var f = { "backups": { dir: true, mode: 509 }, "logs/current.log": "2026-11-11 08:59:59 INFO ok\n" }; Object.keys(PROJ).forEach(function (k) { f["projects/kestrel/" + k] = PROJ[k]; }); Object.keys(OLD_LOGS).forEach(function (k) { f[k] = { content: OLD_LOGS[k], ageDays: 12 }; }); f["/srv/backups/mirror/kestrel"] = { dir: true, owner: "dev", mode: 509 }; f["/srv/backups/mirror/kestrel/README.md"] = { content: "# Kestrel\n(old copy)\n", owner: "dev" }; f["/srv/backups/mirror/kestrel/old-notes.txt"] = { content: "notes from before the cleanup\n", owner: "dev" }; return f; }
  function archiveOf(r, path) { var c = r.read(path); return c === null ? null : M2.readArchive(c); }
  function hasProjFiles(entries, skipCache) { return Object.keys(PROJ).every(function (k) { if (skipCache && /^cache\//.test(k)) return true; var re = new RegExp("(^|/)kestrel/" + k.replace(/\./g, "\\.") + "$"); return entries.some(function (e) { return e.t === "f" && re.test(e.p) && e.c === PROJ[k]; }); }); }
  function treeMap(r, root) { var res = {}; var n = r.node(root); if (!n) return null; (function walk(x, p) { if (x.type === "d") Object.keys(x.children).forEach(function (k) { walk(x.children[k], p + "/" + k); }); else res[p] = x.content; })(n, ""); return res; }
  LABS.push({
    id: "lx-118", n: 18, module: 2, ticket: "LX-118", xp: 120,
    title: "Before we upgrade",
    topic: "tar, gzip, rsync",
    from: BEN,
    story: "<p>Big release tomorrow. Before anything changes: archive the project, check the archive is good, and keep a mirror on the backup disk. Also, last night's bad deploy broke the homepage (it shows <code>{{ site_title }}</code>): there's a backup of the site from 1 November in <code>~/backups</code>. Get just that one file back.</p>",
    learn:
      "<h3>tar: many files in one</h3><p><code>tar</code> packs files and folders into one <b>archive</b> (a \"tarball\"), keeping names, permissions and times. With <code>z</code> it's compressed with gzip: <code>.tar.gz</code> (or <code>.tgz</code>).</p>" +
      '<table class="t"><tr><th>Command</th><th>Does</th></tr><tr><td><code>tar czf out.tar.gz DIR</code></td><td><b>c</b>reate, g<b>z</b>ip, to <b>f</b>ile out.tar.gz</td></tr><tr><td><code>tar tzf out.tar.gz</code></td><td>lis<b>t</b> the contents</td></tr><tr><td><code>tar xzf out.tar.gz</code></td><td>e<b>x</b>tract here</td></tr><tr><td><code>-C DIR</code></td><td>change to DIR first (where to read from, or extract to)</td></tr><tr><td><code>-v</code></td><td>list files as they go</td></tr><tr><td><code>--exclude=PATTERN</code></td><td>leave out matching files</td></tr></table>' +
      ex("tar czf ~/backups/etc-nginx.tar.gz -C /etc nginx") + ex("tar tzvf ~/backups/etc-nginx.tar.gz") +
      "<p><code>-C /etc nginx</code> stores the paths as <code>nginx/...</code> instead of <code>/etc/nginx/...</code>, so you can extract it anywhere. To get one file back, name it after the archive: <code>tar xzf backup.tar.gz -C /tmp/restore nginx/nginx.conf</code>. Always restore to a scratch folder first, compare (<code>diff</code>), then copy into place.</p>" +
      "<p>Put the date in backup names so they don't overwrite each other: <code>backup-$(date +%F).tar.gz</code> becomes <code>backup-2026-11-11.tar.gz</code>.</p>" +
      "<h3>gzip: compress single files</h3>" + ex("gzip -k ~/logs/current.log") +
      "<p><code>gzip FILE</code> replaces FILE with FILE.gz (<code>-k</code> keeps the original); <code>gunzip</code> undoes it; <code>zcat</code> and <code>zgrep</code> read .gz files without unpacking them. Old logs compress to a fraction of their size.</p>" +
      "<h3>rsync for local mirrors</h3><p>rsync works locally too, and it's the right tool for a mirror: only changes are copied. <code>--delete</code> also removes files from the copy that no longer exist in the source, so the mirror is exact. Try it with <code>-n</code> (dry run) first: --delete on the wrong folder is painful.</p>" +
      ex("rsync -av --delete -n ~/projects/kestrel/ /srv/backups/mirror/kestrel/"),
    files: projFiles(),
    system: function (sys) {
      var css = M2.rd(sys, "/var/www/kestrel/assets/app.css");
      M2.makeArchive(sys, "/home/dev/backups/www-2026-11-01.tar.gz", [{ p: "kestrel/", u: "www-data" }, { p: "kestrel/index.html", c: GOOD_INDEX, mode: 420, u: "www-data" }, { p: "kestrel/assets/", u: "www-data" }, { p: "kestrel/assets/app.css", c: css, mode: 420, u: "www-data" }, { p: "kestrel/uploads/", u: "www-data" }], { mt: Date.UTC(2026, 10, 1, 2, 0, 0) });
      M2.nodeAt(sys, "/var/www/kestrel/index.html").content = BROKEN_INDEX;
    },
    starter: "",
    objectives: [
      {
        id: "create", text: "Archive <code>~/projects/kestrel</code> into <code>~/backups/kestrel-2026-11-11.tar.gz</code>, using <code>$(date +%F)</code> for the date in the name.",
        hints: ["tar czf FILE -C PARENT FOLDER. The shell replaces $(date +%F) with today's date.", "tar czf ~/backups/kestrel-$(date +%F).tar.gz -C ~/projects kestrel"],
        check: function (r) {
          var a = archiveOf(r, "backups/kestrel-2026-11-11.tar.gz");
          if (!a) return "There's no ~/backups/kestrel-2026-11-11.tar.gz yet.";
          if (!a.entries || !a.compressed) return "It should be a gzip-compressed tar archive (tar with z).";
          if (!hasProjFiles(a.entries)) return "The archive doesn't contain all of ~/projects/kestrel.";
          return ran(r, /\btar\b.*\$\(date/) ? true : "Build the name with $(date +%F), so tomorrow's backup gets its own file.";
        }
      },
      {
        id: "exclude", text: "Make a second archive, <code>~/backups/kestrel-nocache.tar.gz</code>, that leaves out the <code>cache</code> folder.",
        hints: ["tar has --exclude=PATTERN.", "tar czf ~/backups/kestrel-nocache.tar.gz --exclude=cache -C ~/projects kestrel"],
        check: function (r) {
          var a = archiveOf(r, "backups/kestrel-nocache.tar.gz");
          if (!a || !a.entries) return "There's no ~/backups/kestrel-nocache.tar.gz archive yet.";
          if (a.entries.some(function (e) { return /(^|\/)cache(\/|$)/.test(e.p); })) return "The cache folder is still in it: use --exclude=cache.";
          return hasProjFiles(a.entries, true) ? true : "Everything except cache should be in it.";
        }
      },
      {
        id: "list", text: "List what's inside <code>kestrel-2026-11-11.tar.gz</code> <b>without extracting it</b>.",
        hints: ["t lists.", "tar tzf ~/backups/kestrel-2026-11-11.tar.gz"],
        check: function (r) {
          var a = archiveOf(r, "backups/kestrel-2026-11-11.tar.gz");
          if (!a || !a.entries) return "Create the archive first.";
          var names = a.entries.map(function (e) { return e.p; });
          return ran(r, /\btar\b/, function (e) { return /\btar\s+(-?\w*t\w*|.*--list)/.test(e.cmd) && /kestrel-2026-11-11/.test(e.cmd) && e.out.length === names.length && e.out.every(function (l, i) { return l === names[i] || l.slice(-names[i].length - 1) === " " + names[i]; }); }) ? true : "List it with tar (t), not by extracting.";
        }
      },
      {
        id: "restore", text: "Restore <b>only</b> <code>kestrel/index.html</code> from <code>~/backups/www-2026-11-01.tar.gz</code> into <code>/tmp/restore</code>, check it, then put it back in <code>/var/www/kestrel/</code>.",
        hints: ["mkdir the folder, tar xzf ARCHIVE -C FOLDER MEMBER. The site files are owned by www-data: sudo cp.", "mkdir -p /tmp/restore\ntar xzf ~/backups/www-2026-11-01.tar.gz -C /tmp/restore kestrel/index.html\ndiff /tmp/restore/kestrel/index.html /var/www/kestrel/index.html\nsudo cp /tmp/restore/kestrel/index.html /var/www/kestrel/index.html"],
        check: function (r) {
          if (r.read("/tmp/restore/kestrel/index.html") !== GOOD_INDEX) return "Extract kestrel/index.html from the backup into /tmp/restore first (a safe place to look at it).";
          if (r.exists("/tmp/restore/kestrel/assets")) return "Extract only kestrel/index.html: name it after the archive.";
          return r.read("/var/www/kestrel/index.html") === GOOD_INDEX ? true : "Now copy it over the broken /var/www/kestrel/index.html (sudo cp).";
        }
      },
      {
        id: "gzip", text: "Compress every <code>.log</code> file in <code>~/logs/old</code> (each becomes <code>.log.gz</code>). Leave <code>~/logs/current.log</code> alone.",
        hints: ["gzip takes many files; a wildcard picks them.", "gzip ~/logs/old/*.log"],
        check: function (r) {
          var bad = Object.keys(OLD_LOGS).filter(function (k) { var g = r.read(k + ".gz"); var d = g && M2.archive.gz(g); return !d || d.c !== OLD_LOGS[k] || r.exists(k); });
          if (bad.length) return "Not compressed yet: " + bad.map(function (k) { return "~/" + k; }).join(", ");
          return r.read("logs/current.log") !== null ? true : "~/logs/current.log should stay as it is.";
        }
      },
      {
        id: "mirror", text: "Make <code>/srv/backups/mirror/kestrel</code> an <b>exact</b> mirror of <code>~/projects/kestrel</code> with <code>rsync</code>, deleting files there that the project no longer has.",
        hints: ["rsync -a with --delete. Contents of the folder into the mirror: trailing slashes.", "rsync -av --delete ~/projects/kestrel/ /srv/backups/mirror/kestrel/"],
        check: function (r) {
          var a = treeMap(r, HOME + "/projects/kestrel"), b = treeMap(r, "/srv/backups/mirror/kestrel");
          if (b && b["/kestrel/README.md"] !== undefined) return "The mirror got a kestrel folder inside it: add a slash after the source (~/projects/kestrel/).";
          if (b && b["/old-notes.txt"] !== undefined) return "old-notes.txt isn't in the project any more but is still in the mirror: use --delete.";
          if (!b || JSON.stringify(Object.keys(a).sort().map(function (k) { return [k, a[k]]; })) !== JSON.stringify(Object.keys(b).sort().map(function (k) { return [k, b[k]]; }))) return "/srv/backups/mirror/kestrel should hold exactly what ~/projects/kestrel holds.";
          return ran(r, /\brsync\b.*--delete/) ? true : "Use rsync with --delete.";
        }
      }
    ],
    solution: lines("tar czf ~/backups/kestrel-$(date +%F).tar.gz -C ~/projects kestrel", "tar czf ~/backups/kestrel-nocache.tar.gz --exclude=cache -C ~/projects kestrel", "tar tzf ~/backups/kestrel-2026-11-11.tar.gz", "mkdir -p /tmp/restore", "tar xzf ~/backups/www-2026-11-01.tar.gz -C /tmp/restore kestrel/index.html", "diff /tmp/restore/kestrel/index.html /var/www/kestrel/index.html", "sudo cp /tmp/restore/kestrel/index.html /var/www/kestrel/index.html", "gzip ~/logs/old/*.log", "rsync -av --delete ~/projects/kestrel/ /srv/backups/mirror/kestrel/"),
    debrief: "<p>Ticket closed. The homepage is back, restored from a backup into a scratch folder first, compared, then copied: no surprises on the live site. The project is archived with a dated name and mirrored on the second disk.</p><p>A backup you've never restored from is a hope, not a backup. Listing and test-restoring archives, like you just did, is the habit that matters.</p>",
    realworld: "On your own machine: tar czf docs.tar.gz ~/Documents && tar tzf docs.tar.gz | head. rsync -av --delete -n is a safe way to preview any sync.",
    quiz: [
      { q: "Which command lists a .tar.gz without extracting?", options: ["tar xzf", "tar czf", "tar tzf", "gunzip -l"], answer: 2, why: "t = list, x = extract, c = create." },
      { q: "What does <code>-C /etc</code> do in <code>tar czf a.tgz -C /etc nginx</code>?", options: ["Compresses /etc", "Changes to /etc first, so paths are stored as nginx/...", "Checks /etc", "Copies /etc"], answer: 1, why: "Relative paths in the archive mean it can be extracted anywhere." },
      { q: "What does <code>rsync --delete</code> remove?", options: ["The source files", "Files in the destination that aren't in the source", "Empty folders only", "Nothing without -f"], answer: 1, why: "It keeps the destination an exact mirror. Preview with -n first." }
    ]
  });

  /* ================================================================== LX-119 Capstone: bring up the web server */
  var REL_INDEX = "<!DOCTYPE html>\n<html><head><title>Kestrel Cloud</title><link rel=\"stylesheet\" href=\"/assets/app.css\"></head>\n<body><h1>Kestrel Cloud</h1><p>Version 1.4: faster checkout.</p></body></html>\n";
  var REL = { "index.html": REL_INDEX, "assets/app.css": "body { font-family: system-ui; margin: 2rem; }\nh1 { color: #0b6; }\n.checkout { display: grid; gap: 1rem; }\n", "robots.txt": "User-agent: *\nDisallow: /api/\n" };
  var REL_CONF = "server {\n\tlisten 80;\n\tserver_name kestrel.example.com;\n\troot /var/www/kestrel\n\tindex index.html;\n\n\tlocation /api/ {\n\t\tproxy_pass http://127.0.0.1:8080;\n\t}\n}\n";
  function newServer(sys) {
    var u = sys.units["nginx.service"];
    if (u) { M2.unitProcs(sys, u).forEach(function (p) { M2.removeProc(sys, p); }); delete sys.units["nginx.service"]; }
    var app = sys.units["kestrel-app.service"];
    M2.unitProcs(sys, app).forEach(function (p) { M2.removeProc(sys, p); });
    app.rt = { active: "inactive", sub: "dead", result: "success", since: null, nRestarts: 0 };
    ["/etc/nginx", "/usr/lib/systemd/system/nginx.service", "/usr/sbin/nginx", "/var/log/nginx", "/var/www", "/usr/share/doc/nginx", "/usr/share/doc/nginx-common"].forEach(function (p) { M2.rmRoot(sys, p); });
    var w = M2.nodeAt(sys, "/etc/systemd/system/multi-user.target.wants");
    delete w.children["nginx.service"]; delete w.children["kestrel-app.service"];
    ["nginx", "nginx-common"].forEach(function (n) { var p = sys.pkgs[n]; p.installed = false; p.curVer = null; });
    sys.journal = sys.journal.filter(function (e) { return e.unit !== "nginx.service" && e.unit !== "kestrel-app.service"; });
    M2.putRoot(sys, "/var/log/dpkg.log", "", 420);
    M2.putRoot(sys, "/var/log/apt/history.log", "", 420);
    sys.nginxLive = null;
    var entries = [{ p: "kestrel-site-1.4/" }];
    Object.keys(REL).forEach(function (k) { if (/\//.test(k)) entries.push({ p: "kestrel-site-1.4/" + k.split("/")[0] + "/" }); entries.push({ p: "kestrel-site-1.4/" + k, c: REL[k], mode: 420 }); });
    M2.makeArchive(sys, "/home/dev/release/kestrel-site-1.4.tar.gz", entries, { mt: NOW - 2 * HOUR });
  }
  function wwwCan(r, p) { var s = { sys: r.sys, uid: 33, gid: 33, groups: [33], cwd: "/", umask: 18, vars: {} }; var x = S.lookup(s, p); return !!x.node && S.can(s, x.node, "r"); }
  function get(r, path) { return M2.httpRequest(r.sys, { scheme: "http", host: "localhost", port: 80, path: path, method: "GET", headers: { host: "kestrel.example.com", "user-agent": "kestrel-check/1.0", accept: "*/*" } }); }
  LABS.push({
    id: "lx-119", n: 19, module: 2, ticket: "LX-119", xp: 200, capstone: true,
    title: "Bring up the web server",
    topic: "Module 2 capstone project",
    from: "Maya Chen & Ben Okoro",
    story: "<p>kc-web-01 has been rebuilt from a clean image for the 1.4 release: no nginx, no website, and the Kestrel app is installed but not running. Ben left the release in <code>~/release</code>. Bring the site up, properly: installed, configured, tested, started at boot, and checked in the logs.</p>",
    learn:
      '<div class="callout warn"><b>Capstone rules.</b> No hints. The checks look at the server (packages, services, files, nginx\'s config) and send their own requests to the site. If you get completely stuck, the Tasks tab has a button to reveal the full solution. The capstone then earns half XP.</div>' +
      "<h3>The job</h3><ol>" +
      "<li>Install nginx from Ubuntu's packages (refresh the package lists first). Check that the default page answers.</li>" +
      "<li>Deploy the site: the files inside <code>~/release/kestrel-site-1.4.tar.gz</code> go straight into <code>/var/www/kestrel</code> (so <code>/var/www/kestrel/index.html</code>), readable by nginx's user, www-data.</li>" +
      "<li>Install Ben's site config <code>~/release/kestrel.conf</code> as <code>/etc/nginx/sites-available/kestrel</code>, enable it with a symlink in <code>sites-enabled</code>, and disable the default site. Ben warned it's untested: <code>nginx -t</code> must pass.</li>" +
      "<li>Make nginx use the new config, and check the page with curl, as if from <code>kestrel.example.com</code> (a <code>Host:</code> header).</li>" +
      "<li>The API behind <code>/api/</code> is the Kestrel app (<code>kestrel-app.service</code>). Get it running, at boot too, and check <code>/api/health</code> through nginx.</li>" +
      "<li>Monitoring will poll <code>/health.html</code>, which isn't in this release. Request it, then show the line in nginx's error log that says which file nginx tried to open.</li></ol>" +
      "<h3>Reminders</h3><p>nginx's config lives in <code>/etc/nginx</code>; <code>sites-enabled/</code> holds symlinks to files in <code>sites-available/</code> (<code>ln -s TARGET LINK</code>). <code>sudo nginx -t</code> tests the config, and tells you the file and line of a mistake. A reload applies a new config without dropping connections. <code>tar</code> has <code>--strip-components=1</code> to drop the top folder of an archive.</p>",
    files: {
      "release/kestrel.conf": REL_CONF,
      "release/README.txt": "Kestrel 1.4 release\n-------------------\nsite:   kestrel-site-1.4.tar.gz (contents go in /var/www/kestrel)\nconfig: kestrel.conf (nginx server block for kestrel.example.com)\napp:    kestrel-app.service, already installed, listens on 127.0.0.1:8080\n"
    },
    system: newServer,
    starter: "",
    solution: lines(
      "sudo apt update",
      "sudo apt install -y nginx",
      "curl -I http://localhost/",
      "sudo mkdir -p /var/www/kestrel",
      "sudo tar xzf ~/release/kestrel-site-1.4.tar.gz -C /var/www/kestrel --strip-components=1",
      "sudo cp ~/release/kestrel.conf /etc/nginx/sites-available/kestrel",
      "sudo ln -s /etc/nginx/sites-available/kestrel /etc/nginx/sites-enabled/kestrel",
      "sudo rm /etc/nginx/sites-enabled/default",
      "sudo nginx -t",
      "sudo sed -i 's|root /var/www/kestrel$|root /var/www/kestrel;|' /etc/nginx/sites-available/kestrel",
      "sudo nginx -t",
      "sudo systemctl reload nginx",
      "curl -H \"Host: kestrel.example.com\" http://localhost/",
      "sudo systemctl enable --now kestrel-app",
      "curl -H \"Host: kestrel.example.com\" http://localhost/api/health",
      "curl -I -H \"Host: kestrel.example.com\" http://localhost/health.html",
      "grep health.html /var/log/nginx/error.log"),
    objectives: [
      {
        id: "install", hints: [], text: "nginx is installed (after refreshing the package lists) and running.",
        check: function (r) {
          if (!M2.pkg(r.sys, "nginx").installed) return "nginx isn't installed.";
          var up = firstIdx(r, /\bapt(-get)?\s+update/), inst = firstIdx(r, /\bapt(-get)?\s+install\b.*\bnginx\b/);
          if (up < 0 || up > inst) return "Refresh the package lists (apt update) before installing.";
          return active(r, "nginx.service") ? true : "nginx is installed but not running.";
        }
      },
      {
        id: "deploy", hints: [], text: "The release files are in <code>/var/www/kestrel</code> (index.html, assets/app.css, robots.txt), readable by www-data.",
        check: function (r) {
          var missing = Object.keys(REL).filter(function (k) { return r.read("/var/www/kestrel/" + k) !== REL[k]; });
          if (missing.length) return r.exists("/var/www/kestrel/kestrel-site-1.4") ? "The files landed in /var/www/kestrel/kestrel-site-1.4/: they should be directly in /var/www/kestrel." : "Missing or different in /var/www/kestrel: " + missing.join(", ");
          var unread = Object.keys(REL).filter(function (k) { return !wwwCan(r, "/var/www/kestrel/" + k); });
          return unread.length ? "www-data (nginx) can't read: " + unread.join(", ") : true;
        }
      },
      {
        id: "site", hints: [], text: "The kestrel site is enabled (a symlink in sites-enabled), the default site is disabled, and <code>nginx -t</code> passes.",
        check: function (r) {
          var l = M2.nodeAt(r.sys, "/etc/nginx/sites-enabled/kestrel", true);
          if (!l || l.type !== "l") return "/etc/nginx/sites-enabled/kestrel should be a symlink to ../sites-available/kestrel.";
          if (r.read("/etc/nginx/sites-enabled/kestrel") === null || r.read("/etc/nginx/sites-available/kestrel") === null) return "The kestrel config should be in sites-available, with the symlink in sites-enabled pointing to it.";
          if (M2.nodeAt(r.sys, "/etc/nginx/sites-enabled/default", true)) return "Disable the default site (remove its symlink from sites-enabled).";
          var t = M2.nginxTest(r.sys);
          return t.code === 0 ? true : "nginx -t fails: " + t.lines[0].replace(/^nginx: /, "");
        }
      },
      {
        id: "serve", hints: [], text: "nginx serves the 1.4 site for kestrel.example.com, and you checked it with curl.",
        check: function (r) {
          var res = get(r, "/");
          if (res.err) return "Nothing answers on port 80.";
          if (res.status !== 200 || res.body !== REL_INDEX) return "A request for kestrel.example.com doesn't get the 1.4 homepage yet (did nginx load the new config? test, then reload).";
          return ran(r, /\bcurl\b/, function (e) { return outHas(e, /Version 1\.4/); }) ? true : "Check it yourself with curl and a Host: kestrel.example.com header.";
        }
      },
      {
        id: "app", hints: [], text: "The Kestrel app runs and starts at boot (so does nginx), and <code>/api/health</code> answers through nginx.",
        check: function (r) {
          if (!active(r, "kestrel-app.service")) return "kestrel-app isn't running.";
          if (!enabled(r, "kestrel-app.service") || !enabled(r, "nginx.service")) return "Both kestrel-app and nginx must be enabled at boot.";
          var res = get(r, "/api/health");
          if (res.err || (res.body || "").trim() !== "{\"status\":\"ok\"}") return "/api/health through nginx should return {\"status\":\"ok\"}.";
          return ran(r, /\bcurl\b.*api\/health/, function (e) { return outHas(e, /"status":"ok"/); }) ? true : "Check /api/health yourself with curl.";
        }
      },
      {
        id: "logs", hints: [], text: "You requested <code>/health.html</code> and showed the error log line naming the file nginx tried to open.",
        check: function (r) { return ran(r, /error\.log/, function (e) { return outHas(e, /open\(\) "\/var\/www\/kestrel\/health\.html" failed \(2: No such file or directory\)/); }) ? true : "Request /health.html, then show the matching line from /var/log/nginx/error.log."; }
      }
    ],
    debrief: "<p><b>Module 2 complete.</b> From a bare server to a working site: a package installed and enabled, files deployed with the right owner, a config caught by <code>nginx -t</code> before it could take the site down, a reload instead of a restart, the app behind it supervised by systemd, and the logs telling you exactly what a 404 was about.</p>" +
      "<p>You typed every one of those commands by hand. Module 3 turns them into <b>scripts</b>: variables, conditions, loops and functions, ending with a health-check script that does this checking for you.</p>",
    realworld: "This is the same on any Ubuntu server, a cloud VM or a Raspberry Pi: apt install nginx, a server block in sites-available, ln -s, nginx -t, systemctl reload nginx. Try it on a free-tier VM and point curl at it.",
    quiz: []
  });

  LABS.forEach(function (l) { l.drills = []; T.LABS.push(l); });
  T.UPCOMING = T.UPCOMING.filter(function (row) { return row.module !== 2; });
  T.M2 = { hog: hog, WORKER_SYS: WORKER_SYS, fullDisk: fullDisk, BIG_MAIN: BIG_MAIN, rogue: rogue, newServer: newServer, backupHost: backupHost, REL: REL };
})();
