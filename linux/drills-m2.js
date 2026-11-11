/* sudo learn — Linux Module 2 practice drills (3 per lab, +5 XP each). Loaded after labs-m2.js. */
(function () {
  "use strict";
  var T = window.LX_TRACK, H = window.ShLab.H, S = window.ShEngine, M2 = S.M2, lines = T.lines, X = T.M2;
  function L(t) { return H.lines(t || ""); }
  function ran(r, re, fn) { return r.history.some(function (e) { return re.test(e.cmd) && (!fn || fn(e)); }); }
  function outHas(e, re) { return e.out.some(function (l) { return re.test(l); }); }
  function rootish(e) { return /^\s*sudo\b/.test(e.cmd) || e.userBefore === "root"; }
  var ORDER = { id: 7731, items: [{ sku: "K-100", qty: 2 }, { sku: "K-220", qty: 1 }], status: "shipped" };
  var APP_TGZ = "\x1f\x8b\x08\x00release-1.4\n";
  function zipOf(entries) { return "PK\x03\x04" + btoa(JSON.stringify(entries)); }
  var SITE_INDEX = "<!DOCTYPE html>\n<html><body><h1>Landing page</h1></body></html>\n";

  var DRILLS = {
    "lx-111": [
      {
        id: "d1", title: "Whose processes?", system: X.hog(4021),
        text: "<p>List only <b>ben</b>'s processes.</p>",
        starter: "", solution: lines("ps -u ben"),
        check: function (r) { return ran(r, /\b(ps|pgrep)\b.*\bben\b/, function (e) { return outHas(e, /\b4021\b/) && !outHas(e, /\b1123\b/); }) ? true : "ps has an option to select one user's processes."; }
      },
      {
        id: "d2", title: "nginx's master",
        text: "<p>Print the PID of nginx's <b>master</b> process, and only that one (the workers have their own PIDs).</p>",
        starter: "", solution: lines("pgrep -f \"nginx: master\""),
        check: function (r) { return ran(r, /\b(pgrep|pidof|ps)\b/, function (e) { return H.same(e.out, ["1123"]); }) ? true : "Its command line starts with \"nginx: master\": pgrep -f matches the full command line."; }
      },
      {
        id: "d3", title: "Back to the front",
        text: "<p>Start <code>sleep 300</code> in the background, then bring it back to the foreground.</p>",
        starter: "", solution: lines("sleep 300 &", "fg"),
        check: function (r) { return ran(r, /^\s*fg\b/, function (e) { return outHas(e, /^sleep 300$/); }) ? true : "Start it with & first, then use fg (or fg %1)."; }
      }
    ],
    "lx-112": [
      {
        id: "d1", title: "Starts at boot?",
        text: "<p>Ask systemctl, in one word, whether <code>ssh</code> starts at boot.</p>",
        starter: "", solution: lines("systemctl is-enabled ssh"),
        check: function (r) { return ran(r, /systemctl\s+is-enabled\s+ssh/, function (e) { return H.same(e.out, ["enabled"]); }) ? true : "systemctl has an is-... command that answers with one word."; }
      },
      {
        id: "d2", title: "Restart cron",
        text: "<p>Restart the <code>cron</code> service, then show that it's active.</p>",
        starter: "", solution: lines("sudo systemctl restart cron", "systemctl is-active cron"),
        check: function (r) {
          var u = M2.loadUnit(r.sys, "cron.service");
          if (!u || u.rt.since !== r.sys.now || u.rt.active !== "active") return "Restart cron (sudo systemctl restart cron).";
          return ran(r, /systemctl\s+(is-active|status)\s+cron/, function (e) { return outHas(e, /^active$|Active: active/); }) ? true : "Now show it's active (systemctl is-active cron).";
        }
      },
      {
        id: "d3", title: "The app's last words",
        text: "<p>Show the last <b>5</b> journal lines of <code>kestrel-app</code>.</p>",
        starter: "", solution: lines("journalctl -u kestrel-app -n 5"),
        check: function (r) { return ran(r, /journalctl.*kestrel-app/, function (e) { return e.out.length === 5 && /Booting worker with pid: 1303/.test(e.out[4]); }) ? true : "journalctl -u picks the unit, -n the number of lines."; }
      }
    ],
    "lx-113": [
      {
        id: "d1", title: "Which openssh?",
        text: "<p>With <code>dpkg</code>, list the installed packages whose names start with <code>openssh</code>.</p>",
        starter: "", solution: lines("dpkg -l 'openssh*'"),
        check: function (r) { return ran(r, /\bdpkg\b/, function (e) { return outHas(e, /^ii\s+openssh-client\s/) && outHas(e, /^ii\s+openssh-server\s/); }) ? true : "dpkg -l takes a pattern (quote it so the shell doesn't expand it)."; }
      },
      {
        id: "d2", title: "What did it install?",
        text: "<p>List the files the <code>cron</code> package installed.</p>",
        starter: "", solution: lines("dpkg -L cron"),
        check: function (r) { return ran(r, /\bdpkg(-query)?\s+(-L|--listfiles)\s+cron/, function (e) { return outHas(e, /^\/usr\/bin\/crontab$/); }) ? true : "dpkg has an option to list a package's files."; }
      },
      {
        id: "d3", title: "Pretty JSON", files: { "data/order.json": JSON.stringify(ORDER) + "\n" },
        text: "<p>Install <code>jq</code>, then use it to pretty-print <code>~/data/order.json</code>.</p>",
        starter: "", solution: lines("sudo apt install -y jq", "jq . ~/data/order.json"),
        check: function (r) {
          if (!M2.pkg(r.sys, "jq").installed) return "Install the jq package first.";
          return ran(r, /^\s*(cat .*\|\s*)?jq\b/, function (e) { return H.same(e.out, JSON.stringify(ORDER, null, 2).split("\n")); }) ? true : "jq . FILE prints the JSON indented.";
        }
      }
    ],
    "lx-114": [
      {
        id: "d1", title: "One total",
        text: "<p>Show the total size of <code>/var/log/nginx</code>, human-readable, on one line.</p>",
        starter: "", solution: lines("du -sh /var/log/nginx"),
        check: function (r) { return ran(r, /\bdu\b/, function (e) { return e.out.length === 1 && /^[\d.]+[KMG]?\s+\/var\/log\/nginx\/?$/.test(e.out[0]); }) ? true : "du with -s (one total) and -h (human sizes)."; }
      },
      {
        id: "d2", title: "Just that disk",
        text: "<p>Show how full the file system that holds <code>/srv/backups</code> is, and only that one.</p>",
        starter: "", solution: lines("df -h /srv/backups"),
        check: function (r) { return ran(r, /^\s*df\b/, function (e) { return e.out.length === 2 && /\s\/srv\/backups$/.test(e.out[1]); }) ? true : "df takes a path and shows only its file system."; }
      },
      {
        id: "d3", title: "Empty it in place", files: { "logs/huge.log": { content: "2026-11-11 08:59:59 DEBUG tick\n", size: "3G" } },
        text: "<p><code>~/logs/huge.log</code> is 3 GB and a program is still writing to it. Empty it <b>without deleting it</b>.</p>",
        starter: "", solution: lines("truncate -s 0 ~/logs/huge.log"),
        check: function (r) {
          var n = r.node("logs/huge.log");
          if (!n) return "The file must still exist: empty it, don't delete it.";
          if (S.util.nodeSize(n) !== 0) return "It's still " + S.util.nodeSize(n) + " bytes.";
          return ran(r, /^\s*rm\b/) ? "Don't delete it (the program would keep the old file open): truncate it." : true;
        }
      }
    ],
    "lx-115": [
      {
        id: "d1", title: "Who's on port 22?",
        text: "<p>Use <code>ss</code> to show which program listens on TCP port 22.</p>",
        starter: "", solution: lines("sudo ss -tlnp 'sport = :22'"),
        check: function (r) { return ran(r, /\bss\b/, function (e) { return rootish(e) && outHas(e, /:22\b.*sshd/); }) ? true : "sudo ss -tlnp shows the programs; you can filter with 'sport = :22' or grep."; }
      },
      {
        id: "d2", title: "Three pings",
        text: "<p>Ping <code>kc-db-01</code> exactly 3 times.</p>",
        starter: "", solution: lines("ping -c 3 kc-db-01"),
        check: function (r) { return ran(r, /^\s*ping\b/, function (e) { return outHas(e, /^3 packets transmitted, 3 received/); }) ? true : "ping has an option for the count."; }
      },
      {
        id: "d3", title: "Just the code",
        text: "<p>Print <b>only</b> the HTTP status code of <code>http://localhost/missing</code>.</p>",
        starter: "", solution: lines("curl -s -o /dev/null -w '%{http_code}\\n' http://localhost/missing"),
        check: function (r) { return ran(r, /\bcurl\b/, function (e) { return H.same(e.out, ["404"]); }) ? true : "Throw the body away (-o /dev/null), hide the progress (-s) and print the code with -w '%{http_code}\\n'."; }
      }
    ],
    "lx-116": [
      {
        id: "d1", title: "Fingerprint", files: { ".ssh/laptop.pub": "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIL7kQ2c1H9mY3vXr5tPq8sWn0aZ4jF6bD2eG1hK9uM3x dev@laptop\n" },
        text: "<p>Show the fingerprint of the public key <code>~/.ssh/laptop.pub</code>.</p>",
        starter: "", solution: lines("ssh-keygen -lf ~/.ssh/laptop.pub"),
        check: function (r) { return ran(r, /ssh-keygen/, function (e) { return outHas(e, /^256 SHA256:\S+ dev@laptop \(ED25519\)$/); }) ? true : "ssh-keygen -l shows a fingerprint; -f names the file."; }
      },
      {
        id: "d2", title: "Too open", files: { ".ssh/deploy_key": { content: "-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAABAAAAMwAAAAtzc2gtZWQ3xY\n-----END OPENSSH PRIVATE KEY-----\n", mode: 420 } },
        text: "<p>ssh refuses <code>~/.ssh/deploy_key</code> because other users can read it. Fix its permissions.</p>",
        starter: "", solution: lines("chmod 600 ~/.ssh/deploy_key"),
        check: function (r) { var m = r.mode(".ssh/deploy_key"); return m === "600" || m === "400" ? true : "Only you may read it: chmod 600. It's " + m + " now."; }
      },
      {
        id: "d3", title: "Stale host key", files: { ".ssh/known_hosts": "kc-db-01 ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOldKeyFromBeforeTheRebuildxxxxxxxxxxxxxxxx\ngithub.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl\n" },
        text: "<p>kc-db-01 was rebuilt, so its host key changed and ssh refuses to connect. Remove its old entry from <code>known_hosts</code> (keep the others).</p>",
        starter: "", solution: lines("ssh-keygen -R kc-db-01"),
        check: function (r) {
          var t = r.read(".ssh/known_hosts") || "";
          if (/^kc-db-01[\s,]/m.test(t)) return "kc-db-01's line is still there. ssh-keygen -R HOST removes it.";
          return /^github\.com /m.test(t) ? true : "Remove only kc-db-01's entry: github.com's must stay.";
        }
      }
    ],
    "lx-117": [
      {
        id: "d1", title: "Crontab from a file", files: { "mycron": "0 6 * * * /home/dev/bin/morning.sh\n" },
        text: "<p>Install <code>~/mycron</code> as your crontab.</p>",
        starter: "", solution: lines("crontab ~/mycron"),
        check: function (r) { return M2.cron.crontab(r.sys, "dev") === "0 6 * * * /home/dev/bin/morning.sh\n" ? true : "crontab FILE installs FILE as your crontab."; }
      },
      {
        id: "d2", title: "When next?",
        text: "<p>When does the timer schedule <code>Mon *-*-* 08:00</code> next fire? Ask systemd-analyze.</p>",
        starter: "", solution: lines("systemd-analyze calendar \"Mon *-*-* 08:00\""),
        check: function (r) { return ran(r, /systemd-analyze\s+calendar/, function (e) { return outHas(e, /Next elapse: Mon 2026-11-16 08:00:00 UTC/); }) ? true : "systemd-analyze calendar \"SPEC\" (quote it)."; }
      },
      {
        id: "d3", title: "Remove it", prelude: "echo \"0 * * * * /usr/bin/true\" | crontab -",
        text: "<p>You have a crontab with a test job in it. Remove your crontab entirely.</p>",
        starter: "", solution: lines("crontab -r"),
        check: function (r) { return M2.cron.crontab(r.sys, "dev") === null && ran(r, /crontab\s+-r/) ? true : "crontab has an option to remove it (careful: no confirmation)."; }
      }
    ],
    "lx-118": [
      {
        id: "d1", title: "Archive a folder", files: { "notes/a.txt": "first\n", "notes/b.txt": "second\n" },
        text: "<p>Create <code>~/notes.tar.gz</code>, a gzipped tar archive of the <code>~/notes</code> folder.</p>",
        starter: "", solution: lines("tar czf ~/notes.tar.gz notes"),
        check: function (r) {
          var c = r.read("notes.tar.gz"), a = c && M2.readArchive(c);
          if (!a || !a.entries || !a.compressed) return "~/notes.tar.gz should be a gzipped tar (tar czf).";
          return ["a.txt", "b.txt"].every(function (f) { return a.entries.some(function (e) { return /(^|\/)notes\//.test(e.p) && e.p.slice(-f.length - 1) === "/" + f; }); }) ? true : "It should contain notes/a.txt and notes/b.txt.";
        }
      },
      {
        id: "d2", title: "Unzip it",
        files: { "incoming/site.zip": zipOf([{ p: "index.html", t: "f", c: SITE_INDEX, mode: 420, mt: S.NOW - S.DAY }, { p: "css/", t: "d", mode: 493, mt: S.NOW - S.DAY }, { p: "css/site.css", t: "f", c: "h1 { color: teal; }\n", mode: 420, mt: S.NOW - S.DAY }]) },
        system: function (sys) { M2.pkg(sys, "unzip").installed = true; M2.pkg(sys, "unzip").curVer = M2.pkg(sys, "unzip").ver; M2.putRoot(sys, "/usr/bin/unzip", "\x7fELF:unzip (simulated binary)\n", 493); },
        text: "<p>Extract <code>~/incoming/site.zip</code> into a new folder <code>~/site</code>.</p>",
        starter: "", solution: lines("unzip ~/incoming/site.zip -d ~/site"),
        check: function (r) { return r.read("site/index.html") === SITE_INDEX && r.exists("site/css/site.css") ? true : "unzip has an option to choose the destination folder (-d)."; }
      },
      {
        id: "d3", title: "Verify a download", files: { "downloads/app.tar.gz": APP_TGZ, "downloads/SHA256SUMS": M2.sha256(APP_TGZ) + "  app.tar.gz\n" },
        text: "<p>Check <code>~/downloads/app.tar.gz</code> against the checksum in <code>~/downloads/SHA256SUMS</code>.</p>",
        starter: "", solution: lines("cd ~/downloads", "sha256sum -c SHA256SUMS"),
        check: function (r) { return ran(r, /sha256sum\s+(-c|--check)/, function (e) { return outHas(e, /^app\.tar\.gz: OK$/); }) ? true : "sha256sum -c FILE checks the sums listed in FILE (run it in the folder they're relative to)."; }
      }
    ],
    "lx-119": [
      {
        id: "d1", title: "Test before reloading",
        text: "<p>Test nginx's configuration.</p>",
        starter: "", solution: lines("sudo nginx -t"),
        check: function (r) { return ran(r, /\bnginx\s+-t/, function (e) { return rootish(e) && e.err.some(function (l) { return /test is successful/.test(l); }); }) ? true : "nginx -t tests the config. It needs root to open its files."; }
      },
      {
        id: "d2", title: "Enabled and active",
        text: "<p>In one command line, print whether nginx is enabled at boot and whether it's running (one word each).</p>",
        starter: "", solution: lines("systemctl is-enabled nginx && systemctl is-active nginx"),
        check: function (r) { return ran(r, /is-enabled.*is-active|is-active.*is-enabled/, function (e) { return H.same(e.out.slice().sort(), ["active", "enabled"]); }) ? true : "Chain systemctl is-enabled and is-active with &&."; }
      },
      {
        id: "d3", title: "Reload, don't restart",
        text: "<p>Make nginx re-read its config <b>without</b> restarting it (the master process must keep its PID), then check its status.</p>",
        starter: "", solution: lines("sudo systemctl reload nginx", "systemctl status nginx"),
        check: function (r) {
          var u = M2.loadUnit(r.sys, "nginx.service");
          if (!r.sys.journal.some(function (e) { return e.unit === "nginx.service" && /^Reloaded nginx/.test(e.msg); })) return "Reload nginx (sudo systemctl reload nginx).";
          if (u.rt.mainPid !== 1123) return "That restarted nginx (its master PID changed). Use reload.";
          return ran(r, /systemctl\s+status\s+nginx/) ? true : "Now look at its status.";
        }
      }
    ]
  };
  T.LABS.forEach(function (l) { if (DRILLS[l.id]) l.drills = DRILLS[l.id]; });
})();
