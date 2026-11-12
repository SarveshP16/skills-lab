/* sudo learn — Linux Module 4 practice drills (3 per lab, +5 XP each). Loaded after labs-m4.js. */
(function () {
  "use strict";
  var T = window.LX_TRACK, H = window.ShLab.H, S = window.ShEngine, M2 = S.M2, M3 = S.M3, M4 = S.M4, X = T.M4;
  var sol = M3.lab.sol, rt = M3.lab.rt;
  var HOME = "/home/dev";
  function ran(r, re, fn) { return r.history.some(function (e) { return re.test(e.cmd) && (!fn || fn(e)); }); }
  function all(e) { return e.out.concat(e.err).map(rt); }
  function outHas(e, re) { return all(e).some(function (l) { return re.test(l); }); }
  function outIs(e, want) { return H.same(e.out.map(rt), want); }
  function atStart(fn) { return function (c) { return fn(c.run("")); }; }
  function proveMsg(r, fn, alt, o, none, altMsg) { var p = H.proves(r, atStart(fn), alt, o); return p.ok ? true : p.reason === "alt" ? altMsg : none; }
  function authLines(c, re) { return (c.read("/var/log/auth.log") || "").split("\n").filter(function (l) { return re.test(l); }); }
  function rules(c) { return M4.fw(c.sys).rules; }
  var F2B = "sudo apt install -y fail2ban\nprintf '[sshd]\\nenabled = true\\nmaxretry = 3\\n' | sudo tee /etc/fail2ban/jail.local\nsudo systemctl restart fail2ban";

  var DRILLS = {
    "lx-128": [
      {
        id: "d1", title: "How many?", system: X.breakin(),
        text: "<p>Print the <b>total</b> number of failed SSH password attempts in <code>/var/log/auth.log</code> (just the number).</p>",
        starter: "", solution: sol("grep -c 'Failed password' /var/log/auth.log"),
        check: function (r) { return proveMsg(r, function (c) { return [String(authLines(c, /Failed password/).length)]; }, { system: X.breakin({ fails: { "203.0.113.50": 30, "198.51.100.77": 4 }, seed: 3 }) }, null, "grep -c counts matching lines.", "On another server your command printed the wrong count."); }
      },
      {
        id: "d2", title: "The failure log", system: X.breakin(),
        text: "<p>Show the <b>last 5 failed</b> login attempts from the system's failed-login record (not auth.log).</p>",
        starter: "", solution: sol("sudo lastb -n 5"),
        check: function (r) { return ran(r, /\blastb\b/, function (e) { return e.out.filter(function (l) { return /ssh:notty/.test(l); }).length === 5; }) ? true : "lastb reads /var/log/btmp; it needs sudo, and -n 5 limits it."; }
      },
      {
        id: "d3", title: "When did it start?", system: X.breakin(),
        text: "<p>Show the <b>first</b> failed password line from <code>203.0.113.50</code> in auth.log.</p>",
        starter: "", solution: sol("grep 'Failed password' /var/log/auth.log | grep 203.0.113.50 | head -1"),
        check: function (r) { return proveMsg(r, function (c) { return authLines(c, /Failed password.* from 203\.0\.113\.50 /).slice(0, 1); }, { system: X.breakin({ seed: 41 }) }, null, "grep the failures from that IP, then keep the first line (head -1).", "On another server your command didn't print its first failure: filter, don't copy the line."); }
      }
    ],
    "lx-129": [
      {
        id: "d1", title: "Real people", system: X.accountsScenario(),
        text: "<p>List the accounts with a UID from 1000 up to (not including) 65534: the human users.</p>",
        starter: "", solution: sol("awk -F: '$3 >= 1000 && $3 < 65534 {print $1}' /etc/passwd"),
        check: function (r) { return proveMsg(r, function (c) { return M4.table(c.sys, "/etc/passwd").filter(function (x) { return +x[2] >= 1000 && +x[2] < 65534; }).map(function (x) { return x[0]; }); }, { system: X.accountsScenario({ backdoor: "svc-x", empty: "olduser", contractor: "contractor-mo" }) }, null, "awk -F: with a test on $3 (two conditions joined by &&).", "On another server your command didn't list its users: compare the UID field, don't list names."); }
      },
      {
        id: "d2", title: "Who has a shell?", system: X.accountsScenario(),
        text: "<p>List the accounts whose login shell is <code>/bin/bash</code>.</p>",
        starter: "", solution: sol("awk -F: '$7 == \"/bin/bash\" {print $1}' /etc/passwd"),
        check: function (r) { return proveMsg(r, function (c) { return M4.table(c.sys, "/etc/passwd").filter(function (x) { return x[6] === "/bin/bash"; }).map(function (x) { return x[0]; }); }, { system: X.accountsScenario({ backdoor: "svc-x", empty: "olduser", contractor: "contractor-mo" }) }, null, "The shell is field 7 of /etc/passwd.", "On another server your command didn't list the bash users."); }
      },
      {
        id: "d3", title: "A service account",
        text: "<p>Create a <b>system</b> account <code>kestrel-worker</code> that can't log in: no home folder, shell <code>/usr/sbin/nologin</code>.</p>",
        starter: "", solution: sol("sudo useradd -r -s /usr/sbin/nologin kestrel-worker", "getent passwd kestrel-worker"),
        check: function (r) {
          var p = M4.table(r.sys, "/etc/passwd").filter(function (x) { return x[0] === "kestrel-worker"; })[0];
          if (!p) return "sudo useradd -r ... kestrel-worker";
          if (+p[2] >= 1000) return "Make it a system account (-r): its UID should be below 1000.";
          if (p[6] !== "/usr/sbin/nologin") return "Its shell should be /usr/sbin/nologin (-s).";
          return r.exists("/home/kestrel-worker") ? "No home folder for this one (leave out -m)." : true;
        }
      }
    ],
    "lx-130": [
      {
        id: "d1", title: "The s in numbers",
        text: "<p>Print the permissions of <code>/usr/bin/sudo</code> in <b>octal</b> (4 digits).</p>",
        starter: "", solution: sol("stat -c %a /usr/bin/sudo"),
        check: function (r) { return ran(r, /\bstat\b/, function (e) { return outIs(e, ["4755"]); }) ? true : "stat -c %a FILE prints the mode in octal; the leading 4 is the SUID bit."; }
      },
      {
        id: "d2", title: "Shared but unsafe", system: X.permsScenario(),
        text: "<p>Find the directories under <code>/srv</code> that everyone can write to but that have <b>no</b> sticky bit.</p>",
        starter: "", solution: sol("find /srv -type d -perm -0002 ! -perm -1000"),
        check: function (r) { return ran(r, /\bfind\b.*\/srv/, function (e) { return outIs(e, ["/srv/shared"]); }) ? true : "find /srv -type d -perm -0002 ! -perm -1000 (! negates the next test)."; }
      },
      {
        id: "d3", title: "A group-only secret", system: X.permsScenario(),
        text: "<p>Make <code>/etc/kestrel/app.env</code> owned by <code>root:www-data</code>, readable and writable by root, readable by the group, nothing for others.</p>",
        starter: "", solution: sol("sudo chown root:www-data /etc/kestrel/app.env", "sudo chmod 640 /etc/kestrel/app.env", "ls -l /etc/kestrel/app.env"),
        check: function (r) { return r.owner("/etc/kestrel/app.env") === "root" && r.group("/etc/kestrel/app.env") === "www-data" && r.mode("/etc/kestrel/app.env") === "640" ? true : "chown root:www-data, then chmod 640."; }
      }
    ],
    "lx-131": [
      {
        id: "d1", title: "Slow down guessers",
        text: "<p>Instead of a plain allow, add a ufw rule that <b>rate-limits</b> SSH (it blocks addresses that connect too often).</p>",
        starter: "", solution: sol("sudo ufw limit OpenSSH", "sudo ufw status"),
        check: function (r) { return rules(r).some(function (x) { return !x.v6 && x.action === "limit" && x.port === "22"; }) ? true : "ufw has a limit action: sudo ufw limit 22/tcp (or OpenSSH)."; }
      },
      {
        id: "d2", title: "Delete by number",
        prelude: "sudo ufw allow 22/tcp\nsudo ufw allow 8080/tcp\nsudo ufw allow 80/tcp",
        text: "<p>Three rules are set up (22, 8080, 80). Remove <b>only</b> the 8080 rules, IPv4 and IPv6, using their numbers.</p>",
        starter: "", solution: sol("sudo ufw status numbered", "sudo ufw delete 5", "sudo ufw delete 2", "sudo ufw status numbered"),
        check: function (r) {
          var rs = rules(r);
          if (rs.some(function (x) { return x.port === "8080"; })) return "A rule for 8080 is still there (check both the v4 and the (v6) one; numbers shift after each delete).";
          if (!rs.some(function (x) { return x.port === "22"; }) || !rs.some(function (x) { return x.port === "80"; })) return "Keep the 22 and 80 rules.";
          return ran(r, /ufw\s+delete\s+\d+/) ? true : "Use ufw delete NUMBER (from ufw status numbered).";
        }
      },
      {
        id: "d3", title: "Underneath",
        prelude: "sudo ufw allow 22/tcp\nsudo ufw --force enable",
        text: "<p>The firewall is on. Show the <b>iptables</b> rules ufw generated, in the one-rule-per-line form.</p>",
        starter: "", solution: sol("sudo iptables -S"),
        check: function (r) { return ran(r, /iptables\s+-S/, function (e) { return outHas(e, /^-A ufw-user-input -p tcp -m tcp --dport 22 -j ACCEPT$/); }) ? true : "sudo iptables -S prints the rules as the commands that would create them."; }
      }
    ],
    "lx-132": [
      {
        id: "d1", title: "The real values", system: X.sshScenario,
        text: "<p>Show the SSH server's <b>effective</b> PermitRootLogin and PasswordAuthentication settings, and nothing else.</p>",
        starter: "", solution: sol("sudo sshd -T | grep -iE 'permitrootlogin|passwordauthentication'"),
        check: function (r) { return ran(r, /sshd\s+-T/, function (e) { return e.out.length === 2 && outHas(e, /^permitrootlogin /) && outHas(e, /^passwordauthentication /); }) ? true : "sudo sshd -T | grep -iE 'permitrootlogin|passwordauthentication'"; }
      },
      {
        id: "d2", title: "Unban one", system: X.sshScenario, prelude: F2B,
        text: "<p>fail2ban is running and has banned some addresses. <code>198.51.100.77</code> turns out to be a partner's office: lift its ban (and only its).</p>",
        starter: "", solution: sol("sudo fail2ban-client status sshd", "sudo fail2ban-client set sshd unbanip 198.51.100.77", "sudo fail2ban-client status sshd"),
        check: function (r) { var b = M4.f2bBanned(r.sys); return b.indexOf("198.51.100.77") < 0 && b.indexOf("203.0.113.50") >= 0 ? true : b.indexOf("203.0.113.50") < 0 ? "Keep 203.0.113.50 banned." : "sudo fail2ban-client set sshd unbanip IP"; }
      },
      {
        id: "d3", title: "What's waiting?", system: X.sshScenario,
        text: "<p>Refresh the package lists and list the packages that have an upgrade available.</p>",
        starter: "", solution: sol("sudo apt update", "apt list --upgradable"),
        check: function (r) { return ran(r, /apt\s+list\s+--upgradable/, function (e) { return outHas(e, /^openssh-server\//); }) ? true : "sudo apt update first, then apt list --upgradable."; }
      }
    ],
    "lx-133": [
      {
        id: "d1", title: "Read the unit", system: X.persistScenario(),
        text: "<p>Show the full unit file of the <code>dbus-update</code> service through systemctl.</p>",
        starter: "", solution: sol("systemctl cat dbus-update"),
        check: function (r) { return ran(r, /systemctl\s+cat\s+dbus-update/, function (e) { return outHas(e, /^ExecStart=\/usr\/local\/lib\/\.dbus\/dbus-update$/); }) ? true : "systemctl cat UNIT"; }
      },
      {
        id: "d2", title: "Who has a crontab?", system: X.persistScenario(),
        text: "<p>List the users that have a personal crontab (the files cron keeps for them).</p>",
        starter: "", solution: sol("sudo ls /var/spool/cron/crontabs"),
        check: function (r) { return ran(r, /\/var\/spool\/cron\/crontabs/, function (e) { return outIs(e, ["deploy"]); }) ? true : "They're files in /var/spool/cron/crontabs (root only)."; }
      },
      {
        id: "d3", title: "Downloaders", system: X.persistScenario(),
        text: "<p>Search every file under <code>/etc/cron.d</code> for lines that use <code>curl</code> or <code>wget</code>, showing the file names.</p>",
        starter: "", solution: sol("grep -rE 'curl|wget' /etc/cron.d"),
        check: function (r) { return ran(r, /\bgrep\b.*cron/, function (e) { return outHas(e, /^\/etc\/cron\.d\/apt-update-check:.*curl/); }) ? true : "grep -rE 'curl|wget' /etc/cron.d (-r searches a folder and names the files)."; }
      }
    ],
    "lx-134": [
      {
        id: "d1", title: "One checksum", system: X.integrityScenario,
        text: "<p>Print the SHA-256 checksum of <code>~/downloads/kestrel-agent-2.4.1.tar.gz</code>.</p>",
        starter: "", solution: sol("sha256sum ~/downloads/kestrel-agent-2.4.1.tar.gz"),
        check: function (r) { var h = M2.sha256(X.AGENT); return ran(r, /sha256sum/, function (e) { return e.out.some(function (l) { return l.indexOf(h) === 0 && /kestrel-agent-2\.4\.1\.tar\.gz$/.test(l); }); }) ? true : "sha256sum FILE"; }
      },
      {
        id: "d2", title: "Whose file?",
        text: "<p>Find out which package installed <code>/usr/sbin/sshd</code>.</p>",
        starter: "", solution: sol("dpkg -S /usr/sbin/sshd"),
        check: function (r) { return ran(r, /dpkg\s+(-S|--search)/, function (e) { return outIs(e, ["openssh-server: /usr/sbin/sshd"]); }) ? true : "dpkg -S PATH searches the installed packages' file lists."; }
      },
      {
        id: "d3", title: "No key, no verdict", system: X.integrityScenario,
        text: "<p>Before importing anything, try to verify <code>~/downloads/SHA256SUMS.asc</code>, and show gpg's exit code.</p>",
        starter: "", solution: sol("gpg --verify ~/downloads/SHA256SUMS.asc ~/downloads/SHA256SUMS; echo $?"),
        check: function (r) { return ran(r, /gpg\s+--verify/, function (e) { return outHas(e, /No public key/) && /echo\s+"?\$\?/.test(e.cmd) && e.out[e.out.length - 1] === "2"; }) ? true : "gpg --verify SIG FILE; echo $? (without the key it can't check: exit code 2)."; }
      }
    ],
    "lx-135": [
      {
        id: "d1", title: "Syntax only", files: X.CI_FILES, system: X.ciScenario,
        text: "<p>Check <code>~/kestrel-ops/scripts/deploy.sh</code> for <b>syntax</b> errors without running it, and print the exit code.</p>",
        starter: "", solution: sol("bash -n ~/kestrel-ops/scripts/deploy.sh; echo $?"),
        check: function (r) { return ran(r, /bash\s+-n\b.*deploy\.sh/, function (e) { return e.out[e.out.length - 1] === "0"; }) ? true : "bash -n FILE; echo $?"; }
      },
      {
        id: "d2", title: "One line per finding", files: X.CI_FILES, system: X.ciScenario,
        text: "<p>Run ShellCheck on <code>~/kestrel-ops/scripts/deploy.sh</code> in the compact format CI tools parse: <code>file:line:col: level: message [code]</code>.</p>",
        starter: "", solution: sol("shellcheck -f gcc ~/kestrel-ops/scripts/deploy.sh"),
        check: function (r) { return ran(r, /shellcheck\b.*(-f\s*gcc|--format=gcc)/, function (e) { return e.out.length > 2 && e.out.every(function (l) { return /^\S+deploy\.sh:\d+:\d+: (error|warning|note): .* \[SC\d+\]$/.test(l); }); }) ? true : "shellcheck -f gcc FILE"; }
      },
      {
        id: "d3", title: "Ignore one rule", files: X.CI_FILES, system: X.ciScenario,
        text: "<p>Run ShellCheck on deploy.sh but <b>exclude</b> SC2086 (the quoting notes), to see what else is wrong.</p>",
        starter: "", solution: sol("shellcheck -e SC2086 ~/kestrel-ops/scripts/deploy.sh"),
        check: function (r) { return ran(r, /shellcheck\b.*-e\s*(SC)?2086|--exclude=(SC)?2086/, function (e) { return outHas(e, /SC2164/) && !outHas(e, /SC2086/); }) ? true : "shellcheck -e SC2086 FILE"; }
      }
    ],
    "lx-136": [
      {
        id: "d1", title: "Count the SUID files",
        text: "<p>Print how many SUID files there are on the whole system (just the number).</p>",
        starter: "", solution: sol("sudo find / -perm -4000 -type f 2>/dev/null | wc -l"),
        check: function (r) { var n = X.suidList(r.run("")).length; return ran(r, /\bfind\b.*-perm/, function (e) { return outIs(e, [String(n)]); }) ? true : "sudo find / -perm -4000 -type f 2>/dev/null | wc -l"; }
      },
      {
        id: "d2", title: "Where from?", system: X.breakin(),
        text: "<p>From <code>last</code>, list each <b>distinct</b> IP address that has logged in, sorted.</p>",
        starter: "", solution: sol("last -i | awk '{print $3}' | grep -E '^[0-9]+\\.' | sort -u"),
        check: function (r) {
          var want = (r.sys.wtmp || []).filter(function (e) { return e.user !== "reboot" && /^\d+\.\d+\.\d+\.\d+$/.test(e.host); }).map(function (e) { return e.host; }).filter(function (v, i, a) { return a.indexOf(v) === i; }).sort();
          return ran(r, /\blast\b/, function (e) { return outIs(e, want); }) ? true : "last | awk '{print $3}', keep the lines that look like IPs, sort -u.";
        }
      },
      {
        id: "d3", title: "Evidence in the report",
        prelude: "sudo ufw allow OpenSSH\nsudo ufw --force enable",
        text: "<p>Append the output of <code>sudo ufw status verbose</code> to <code>~/audit-report.txt</code>, so the report shows the final firewall.</p>",
        starter: "", solution: sol("sudo ufw status verbose >> ~/audit-report.txt", "cat ~/audit-report.txt"),
        check: function (r) { var t = r.read(HOME + "/audit-report.txt") || ""; return /Status: active/.test(t) && /Default: deny \(incoming\)/.test(t) ? true : "sudo ufw status verbose >> ~/audit-report.txt (the redirect is done by your shell, as dev, into your own file)."; }
      }
    ]
  };
  T.LABS.forEach(function (l) { if (DRILLS[l.id]) l.drills = DRILLS[l.id]; });
})();
