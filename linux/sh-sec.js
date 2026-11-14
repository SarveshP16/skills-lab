/* sudo learn — security tooling for the Linux track's Module 4: user and password management (passwd, usermod,
   useradd, userdel, chage, gpasswd, deluser/adduser), login records (last, lastb, lastlog, who, w), the ufw
   firewall (with iptables/nft views and the classic SSH lock-out), fail2ban jails, GPG signatures, package
   integrity (debsums, dpkg --verify, apt --reinstall), unattended-upgrades, and sudo -l -U. Loaded after sh-script.js. */
(function (root) {
  "use strict";
  var S = root.ShEngine, U = S.util, CMDS = S.CMDS, M2 = S.M2, DAY = S.DAY, NOW = S.NOW;
  var out = U.out, errl = U.errl, note = U.note, rpad = U.rpad, pad = U.pad, MON = U.MON, WDAY = U.WDAY;
  var HOUR = 3600000, MIN = 60000;
  var BOOT = NOW - (12 * DAY + 3 * HOUR + 14 * MIN);
  var M4 = S.M4 = {};
  function p2(n) { return (n < 10 ? "0" : "") + n; }
  function hm(ms) { var d = new Date(ms); return p2(d.getUTCHours()) + ":" + p2(d.getUTCMinutes()); }

  /* ================================================================== /etc/passwd, /etc/shadow, /etc/group */
  function table(sys, path) { var t = M2.rd(sys, path); return t === null ? [] : t.split("\n").filter(Boolean).map(function (l) { return l.split(":"); }); }
  function saveTable(sys, path, rows) {
    var txt = rows.map(function (r) { return r.join(":"); }).join("\n") + "\n", n = M2.nodeAt(sys, path);
    if (n) { n.content = txt; n.mtime = sys.now; } else M2.putRoot(sys, path, txt);
  }
  function row(rows, name) { for (var i = 0; i < rows.length; i++) if (rows[i][0] === name) return rows[i]; return null; }
  function today(sys) { return Math.floor(sys.now / DAY); }
  function dateOfDays(d) { var x = new Date(d * DAY); return MON[x.getUTCMonth()] + " " + p2(x.getUTCDate()) + ", " + x.getUTCFullYear(); }
  function parseDay(s) {
    if (/^-?\d+$/.test(s)) return +s;
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    return m ? Math.floor(Date.UTC(+m[1], +m[2] - 1, +m[3]) / DAY) : null;
  }
  function shadowRow(sys, name) {
    var rows = table(sys, "/etc/shadow"), r = row(rows, name);
    if (!r) { r = [name, "!", String(today(sys)), "0", "99999", "7", "", "", ""]; rows.push(r); }
    while (r.length < 9) r.push("");
    return { rows: rows, r: r };
  }
  function setGroupMembers(sys, gname, fn) {
    var rows = table(sys, "/etc/group"), g = row(rows, gname);
    if (!g) return false;
    var mem = (g[3] || "").split(",").filter(Boolean);
    g[3] = fn(mem).join(",");
    saveTable(sys, "/etc/group", rows);
    return true;
  }
  function procsOf(sys, uid) { return (sys.procs || []).filter(function (p) { return p.uid === uid; }); }
  M4.table = table; M4.saveTable = saveTable; M4.shadowRow = shadowRow;
  // Lab helpers: add a user / tweak shadow without going through the commands.
  M4.addUser = function (sys, name, o) {
    o = o || {};
    var pw = table(sys, "/etc/passwd"), gr = table(sys, "/etc/group");
    var uid = o.uid != null ? o.uid : 1000 + pw.filter(function (r) { return +r[2] >= 1000 && +r[2] < 60000; }).length + 1;
    while (o.uid == null && pw.some(function (r) { return +r[2] === uid; })) uid++;
    var gid = o.gid != null ? o.gid : uid;
    if (!row(gr, name) && o.gid == null) { gr.push([name, "x", String(gid), ""]); saveTable(sys, "/etc/group", gr); }
    pw.push([name, "x", String(uid), String(gid), o.gecos || "", o.home || "/home/" + name, o.shell || "/bin/bash"]);
    saveTable(sys, "/etc/passwd", pw);
    var sh = table(sys, "/etc/shadow");
    sh.push([name, o.hash === undefined ? "$y$j9T$" + M2.hashChars(name + "salt", 22) + "$" + M2.hashChars(name + "pw", 43) : o.hash, String(o.lastchg || today(sys) - 30), "0", "99999", "7", "", o.expire != null ? String(o.expire) : "", ""]);
    saveTable(sys, "/etc/shadow", sh);
    (o.groups || []).forEach(function (g) { setGroupMembers(sys, g, function (m) { return m.indexOf(name) < 0 ? m.concat([name]) : m; }); });
    if (o.home !== false && o.mkhome !== false) { var h = M2.mkdirRoot(sys, o.home || "/home/" + name, 488, uid, gid); }
    return uid;
  };
  M4.setGroupMembers = setGroupMembers;
  function needRoot(io, sess, cmd) { if (sess.uid === 0) return false; errl(io, cmd + ": Permission denied.\n" + cmd + ": cannot lock /etc/passwd; try again later."); return true; }

  /* ---------------- passwd */
  CMDS.passwd = function (args, io, sess) {
    var sys = sess.sys, f = {}, user = null;
    args.slice(1).forEach(function (x) {
      var L = { "--lock": "l", "--unlock": "u", "--delete": "d", "--expire": "e", "--status": "S", "--all": "a" };
      if (L[x]) f[L[x]] = true; else if (/^-[ludeSa]+$/.test(x)) x.slice(1).split("").forEach(function (c) { f[c] = true; }); else user = x;
    });
    if (f.S && f.a) {
      if (sess.uid !== 0) { errl(io, "passwd: Permission denied."); return 1; }
      table(sys, "/etc/passwd").forEach(function (p) { out(io, statusLine(sys, p[0]) + "\n"); }); return 0;
    }
    var target = user || sess.user;
    if (!S.userByName(sys, target)) { errl(io, "passwd: user '" + target + "' does not exist"); return 1; }
    if (sess.uid !== 0 && (target !== sess.user || f.l || f.u || f.d || f.e)) { errl(io, "passwd: You may not view or modify password information for " + target + "."); return 1; }
    if (f.S) { out(io, statusLine(sys, target) + "\n"); return 0; }
    var s = shadowRow(sys, target), r = s.r;
    if (f.l) { if (r[1].charAt(0) !== "!") r[1] = "!" + r[1]; saveTable(sys, "/etc/shadow", s.rows); out(io, "passwd: password changed.\n"); return 0; }
    if (f.u) {
      if (r[1].charAt(0) === "!" && r[1].length === 1) { errl(io, "passwd: unlocking the password would result in a passwordless account.\nYou should set a password with usermod -p to unlock the password of this account."); return 3; }
      r[1] = r[1].replace(/^!+/, ""); saveTable(sys, "/etc/shadow", s.rows); out(io, "passwd: password changed.\n"); return 0;
    }
    if (f.d) { r[1] = ""; saveTable(sys, "/etc/shadow", s.rows); out(io, "passwd: password changed.\n"); return 0; }
    if (f.e) { r[2] = "0"; saveTable(sys, "/etc/shadow", s.rows); out(io, "passwd: password changed.\n"); return 0; }
    note(io, "(passwd asks for the new password twice. This lab's terminal can't type into it, but these work: passwd -l USER (lock), -u (unlock), -S (status), -e (must change at next login).)");
    return 1;
  };
  function statusLine(sys, name) {
    var r = row(table(sys, "/etc/shadow"), name) || [name, "*", "", "", "", "", ""];
    var st = r[1] === "" ? "NP" : /^[!*]/.test(r[1]) ? "L" : "P";
    var d = r[2] ? new Date(+r[2] * DAY) : null;
    return name + " " + st + " " + (d ? d.getUTCFullYear() + "-" + p2(d.getUTCMonth() + 1) + "-" + p2(d.getUTCDate()) : "never") + " " + (r[3] || "-1") + " " + (r[4] || "-1") + " " + (r[5] || "-1") + " " + (r[6] || "-1");
  }

  /* ---------------- usermod / useradd / userdel / chage / gpasswd / deluser / adduser */
  CMDS.usermod = function (args, io, sess) {
    var sys = sess.sys, a = args.slice(1), f = {}, user = null;
    for (var i = 0; i < a.length; i++) {
      var x = a[i];
      if (x === "-L" || x === "--lock") f.L = true; else if (x === "-U" || x === "--unlock") f.U = true;
      else if (x === "-a" || x === "--append") f.a = true;
      else if (x === "-aG") { f.a = true; f.G = a[++i]; }
      else if (x === "-G" || x === "--groups") f.G = a[++i];
      else if (x === "-e" || x === "--expiredate") f.e = a[++i];
      else if (x === "-s" || x === "--shell") f.s = a[++i];
      else if (x === "-c" || x === "--comment") f.c = a[++i];
      else if (x === "-d" || x === "--home") f.d = a[++i];
      else if (x === "-m" || x === "--move-home") f.m = true;
      else if (/^-/.test(x)) { errl(io, "usermod: invalid option -- '" + x.replace(/^-+/, "") + "'"); return 2; }
      else user = x;
    }
    if (needRoot(io, sess, "usermod")) return 1;
    if (!user) { errl(io, "Usage: usermod [options] LOGIN"); return 2; }
    if (!S.userByName(sys, user)) { errl(io, "usermod: user '" + user + "' does not exist"); return 6; }
    if (f.G !== undefined) {
      var want = f.G.split(",").filter(Boolean), gr = table(sys, "/etc/group");
      for (var k = 0; k < want.length; k++) if (!row(gr, want[k])) { errl(io, "usermod: group '" + want[k] + "' does not exist"); return 6; }
      gr.forEach(function (g) {
        var mem = (g[3] || "").split(",").filter(Boolean), has = mem.indexOf(user) >= 0, should = want.indexOf(g[0]) >= 0;
        if (should && !has) mem.push(user); else if (!should && has && !f.a) mem = mem.filter(function (m) { return m !== user; });
        g[3] = mem.join(",");
      });
      saveTable(sys, "/etc/group", gr);
    }
    var pw = table(sys, "/etc/passwd"), pr = row(pw, user);
    if (f.s !== undefined) pr[6] = f.s;
    if (f.c !== undefined) pr[4] = f.c;
    if (f.d !== undefined) pr[5] = f.d;
    if (f.s !== undefined || f.c !== undefined || f.d !== undefined) saveTable(sys, "/etc/passwd", pw);
    if (f.L || f.U || f.e !== undefined) {
      var s = shadowRow(sys, user), r = s.r;
      if (f.L && r[1].charAt(0) !== "!") r[1] = "!" + r[1];
      if (f.U) { if (r[1] === "!") { errl(io, "usermod: unlocking the user's password would result in a passwordless account.\nYou should set a password with usermod -p to unlock this user's password."); } else r[1] = r[1].replace(/^!/, ""); }
      if (f.e !== undefined) { if (f.e === "" || f.e === "-1") r[7] = ""; else { var d = parseDay(f.e); if (d === null) { errl(io, "usermod: invalid date '" + f.e + "'"); return 3; } r[7] = String(d); } }
      saveTable(sys, "/etc/shadow", s.rows);
    }
    return 0;
  };
  CMDS.useradd = function (args, io, sess) {
    var sys = sess.sys, a = args.slice(1), f = {}, user = null;
    for (var i = 0; i < a.length; i++) {
      var x = a[i];
      if (x === "-m" || x === "--create-home") f.m = true; else if (x === "-M") f.M = true; else if (x === "-r" || x === "--system") f.r = true;
      else if (/^-(s|G|u|c|d|e|g)$/.test(x)) f[x.charAt(1)] = a[++i];
      else if (/^--(shell|groups|uid|comment|home-dir|expiredate|gid)$/.test(x)) f[{ shell: "s", groups: "G", uid: "u", comment: "c", "home-dir": "d", expiredate: "e", gid: "g" }[x.slice(2)]] = a[++i];
      else if (/^-/.test(x)) { errl(io, "useradd: invalid option -- '" + x.replace(/^-+/, "") + "'"); return 2; }
      else user = x;
    }
    if (needRoot(io, sess, "useradd")) return 1;
    if (!user) { errl(io, "Usage: useradd [options] LOGIN"); return 2; }
    if (S.userByName(sys, user)) { errl(io, "useradd: user '" + user + "' already exists"); return 9; }
    var gr = table(sys, "/etc/group"), bad = (f.G || "").split(",").filter(Boolean).filter(function (g) { return !row(gr, g); });
    if (bad.length) { errl(io, "useradd: group '" + bad[0] + "' does not exist"); return 6; }
    var pw = table(sys, "/etc/passwd"), uid = f.u ? +f.u : f.r ? 999 : 1000;
    if (!f.u) { if (f.r) { while (pw.some(function (r) { return +r[2] === uid; })) uid--; } else { while (pw.some(function (r) { return +r[2] === uid; })) uid++; } }
    var gid = uid;
    if (f.g) { var gg = row(gr, f.g) || gr.filter(function (g) { return g[2] === f.g; })[0]; gid = gg ? +gg[2] : uid; }
    else if (!row(gr, user)) { while (gr.some(function (g) { return +g[2] === gid; })) gid++; gr.push([user, "x", String(gid), ""]); saveTable(sys, "/etc/group", gr); }
    var home = f.d || "/home/" + user;
    pw.push([user, "x", String(uid), String(gid), f.c || "", home, f.s || "/bin/sh"]);
    saveTable(sys, "/etc/passwd", pw);
    var sh = table(sys, "/etc/shadow");
    sh.push([user, "!", String(today(sys)), "0", "99999", "7", "", f.e ? String(parseDay(f.e)) : "", ""]);
    saveTable(sys, "/etc/shadow", sh);
    (f.G || "").split(",").filter(Boolean).forEach(function (g) { setGroupMembers(sys, g, function (m) { return m.concat([user]); }); });
    if (f.m && !f.M) {
      M2.mkdirRoot(sys, home, 488, uid, gid);
      [".bashrc", ".profile", ".bash_logout"].forEach(function (n) { var c = M2.rd(sys, "/etc/skel/" + n); if (c !== null) M2.putRoot(sys, home + "/" + n, c, 420, uid, gid); });
    }
    return 0;
  };
  function removeUser(sys, io, user, o) {
    var pu = S.userByName(sys, user);
    var busy = procsOf(sys, pu.uid);
    if (busy.length && !o.force) { errl(io, "userdel: user " + user + " is currently used by process " + busy.map(function (p) { return p.pid; }).sort(function (a, b) { return a - b; })[0]); return 8; }
    saveTable(sys, "/etc/passwd", table(sys, "/etc/passwd").filter(function (r) { return r[0] !== user; }));
    saveTable(sys, "/etc/shadow", table(sys, "/etc/shadow").filter(function (r) { return r[0] !== user; }));
    var gr = table(sys, "/etc/group").map(function (g) { g[3] = (g[3] || "").split(",").filter(function (m) { return m && m !== user; }).join(","); return g; });
    var own = row(gr, user);
    if (own) { if (own[3]) errl(io, "userdel: group " + user + " not removed because it has other members."); else gr = gr.filter(function (g) { return g[0] !== user; }); }
    saveTable(sys, "/etc/group", gr);
    M2.rmRoot(sys, "/var/spool/cron/crontabs/" + user);
    if (o.remove) {
      if (M2.rd(sys, "/var/mail/" + user) === null) errl(io, "userdel: " + user + " mail spool (/var/mail/" + user + ") not found"); else M2.rmRoot(sys, "/var/mail/" + user);
      if (pu.home && pu.home !== "/" && pu.home !== "/root" && M2.nodeAt(sys, pu.home)) M2.rmRoot(sys, pu.home);
    }
    return 0;
  }
  CMDS.userdel = function (args, io, sess) {
    var o = {}, user = null;
    args.slice(1).forEach(function (x) { if (x === "-r" || x === "--remove") o.remove = true; else if (x === "-f" || x === "--force") o.force = true; else if (x === "-rf" || x === "-fr") { o.remove = true; o.force = true; } else user = x; });
    if (sess.uid !== 0) { errl(io, "userdel: Permission denied.\nuserdel: cannot lock /etc/passwd; try again later."); return 1; }
    if (!user) { errl(io, "Usage: userdel [options] LOGIN"); return 2; }
    if (!S.userByName(sess.sys, user)) { errl(io, "userdel: user '" + user + "' does not exist"); return 6; }
    return removeUser(sess.sys, io, user, o);
  };
  CMDS.chage = function (args, io, sess) {
    var sys = sess.sys, a = args.slice(1), f = {}, user = null;
    for (var i = 0; i < a.length; i++) { var x = a[i]; if (x === "-l" || x === "--list") f.l = true; else if (/^-(E|M|m|W|d|I)$/.test(x)) f[x.charAt(1)] = a[++i]; else if (/^-/.test(x)) { errl(io, "chage: invalid option -- '" + x.replace(/^-+/, "") + "'"); return 2; } else user = x; }
    if (!user) { errl(io, "Usage: chage [options] LOGIN"); return 2; }
    if (!S.userByName(sys, user)) { errl(io, "chage: user '" + user + "' does not exist in /etc/passwd"); return 1; }
    if (sess.uid !== 0 && (user !== sess.user || !f.l)) { errl(io, "chage: Permission denied."); return 1; }
    var s = shadowRow(sys, user), r = s.r;
    if (f.l) {
      var last = r[2], max = r[4], exp = r[7];
      var L = [["Last password change", last === "0" ? "password must be changed" : last ? dateOfDays(+last) : "never"],
        ["Password expires", !max || +max >= 99999 || !last ? "never" : dateOfDays(+last + +max)],
        ["Password inactive", r[6] ? dateOfDays(+last + +max + +r[6]) : "never"],
        ["Account expires", exp ? dateOfDays(+exp) : "never"],
        ["Minimum number of days between password change", r[3] || "-1"], ["Maximum number of days between password change", max || "-1"], ["Number of days of warning before password expires", r[5] || "-1"]];
      L.forEach(function (x) { out(io, x[0] + "\t".repeat(Math.max(1, 7 - Math.floor(x[0].length / 8))) + ": " + x[1] + "\n"); });
      return 0;
    }
    if (f.E !== undefined) { if (f.E === "-1" || f.E === "") r[7] = ""; else { var d = parseDay(f.E); if (d === null) { errl(io, "chage: invalid date '" + f.E + "'"); return 1; } r[7] = String(d); } }
    if (f.M !== undefined) r[4] = f.M; if (f.m !== undefined) r[3] = f.m; if (f.W !== undefined) r[5] = f.W; if (f.I !== undefined) r[6] = f.I; if (f.d !== undefined) r[2] = String(parseDay(f.d));
    saveTable(sys, "/etc/shadow", s.rows);
    return 0;
  };
  CMDS.gpasswd = function (args, io, sess) {
    var a = args.slice(1);
    if ((a[0] === "-d" || a[0] === "-a") && a.length === 3) {
      if (sess.uid !== 0) { errl(io, "gpasswd: Permission denied."); return 1; }
      var user = a[1], g = a[2];
      if (!S.userByName(sess.sys, user)) { errl(io, "gpasswd: user '" + user + "' does not exist"); return 3; }
      var gr = row(table(sess.sys, "/etc/group"), g);
      if (!gr) { errl(io, "gpasswd: group '" + g + "' does not exist in /etc/group"); return 3; }
      var mem = (gr[3] || "").split(",").filter(Boolean);
      if (a[0] === "-d") {
        if (mem.indexOf(user) < 0) { errl(io, "gpasswd: user '" + user + "' is not a member of '" + g + "'"); return 3; }
        setGroupMembers(sess.sys, g, function (m) { return m.filter(function (x) { return x !== user; }); });
        out(io, "Removing user " + user + " from group " + g + "\n");
      } else { setGroupMembers(sess.sys, g, function (m) { return m.indexOf(user) < 0 ? m.concat([user]) : m; }); out(io, "Adding user " + user + " to group " + g + "\n"); }
      return 0;
    }
    errl(io, "Usage: gpasswd [option] GROUP\n\nOptions:\n  -a, --add USER                add USER to GROUP\n  -d, --delete USER             remove USER from GROUP");
    return 2;
  };
  CMDS.deluser = function (args, io, sess) {
    var a = args.slice(1).filter(function (x) { return x !== "--remove-home" && x !== "--force"; }), rmHome = args.indexOf("--remove-home") > 0;
    if (sess.uid !== 0) { errl(io, "fatal: Only root may remove a user or group from the system."); return 1; }
    if (a.length === 2) {
      var g = row(table(sess.sys, "/etc/group"), a[1]);
      if (!S.userByName(sess.sys, a[0])) { errl(io, "fatal: The user `" + a[0] + "' does not exist."); return 2; }
      if (!g) { errl(io, "fatal: The group `" + a[1] + "' does not exist."); return 6; }
      if ((g[3] || "").split(",").indexOf(a[0]) < 0) { errl(io, "fatal: The user `" + a[0] + "' is not a member of group `" + a[1] + "'."); return 6; }
      out(io, "info: Removing user `" + a[0] + "' from group `" + a[1] + "' ...\n");
      setGroupMembers(sess.sys, a[1], function (m) { return m.filter(function (x) { return x !== a[0]; }); });
      return 0;
    }
    if (a.length === 1) {
      if (!S.userByName(sess.sys, a[0])) { errl(io, "fatal: The user `" + a[0] + "' does not exist."); return 2; }
      out(io, "info: Removing crontab ...\ninfo: Removing user `" + a[0] + "' ...\n");
      return removeUser(sess.sys, io, a[0], { remove: rmHome });
    }
    errl(io, "deluser: Usage: deluser [--remove-home] USER [GROUP]"); return 1;
  };
  CMDS.adduser = function (args, io, sess) {
    var a = args.slice(1).filter(function (x) { return !/^-/.test(x); });
    if (sess.uid !== 0) { errl(io, "fatal: Only root may add a user or group to the system."); return 1; }
    if (a.length === 2) {
      if (!S.userByName(sess.sys, a[0])) { errl(io, "fatal: The user `" + a[0] + "' does not exist."); return 1; }
      if (!setGroupMembers(sess.sys, a[1], function (m) { return m.indexOf(a[0]) < 0 ? m.concat([a[0]]) : m; })) { errl(io, "fatal: The group `" + a[1] + "' does not exist."); return 1; }
      out(io, "info: Adding user `" + a[0] + "' to group `" + a[1] + "' ...\n");
      return 0;
    }
    note(io, "(adduser asks for a password and details interactively. Here, create users with useradd -m -s /bin/bash NAME.)");
    return 1;
  };

  /* ================================================================== login records: last, lastb, lastlog, who, w */
  function wtmpOf(sys) { return sys.wtmp || []; }
  M4.login = function (sys, user, tty, host, start, end) { sys.wtmp = sys.wtmp || []; sys.wtmp.push({ user: user, tty: tty, host: host, start: start, end: end === undefined ? null : end }); };
  M4.failed = function (sys, user, host, t) { sys.btmp = sys.btmp || []; sys.btmp.push({ user: user, tty: "ssh:notty", host: host, start: t, end: t }); };
  function lastDate(ms) { var d = new Date(ms); return WDAY[d.getUTCDay()] + " " + MON[d.getUTCMonth()] + " " + pad(d.getUTCDate(), 2) + " " + hm(ms); }
  function fullDate(ms) { var d = new Date(ms); return WDAY[d.getUTCDay()] + " " + MON[d.getUTCMonth()] + " " + pad(d.getUTCDate(), 2) + " " + hm(ms) + ":" + p2(d.getUTCSeconds()) + " " + d.getUTCFullYear(); }
  function dur(a, b) { var m = Math.round((b - a) / MIN), d = Math.floor(m / 1440); m -= d * 1440; return "(" + (d ? d + "+" : "") + p2(Math.floor(m / 60)) + ":" + p2(m % 60) + ")"; }
  function lastLine(e) {
    var reboot = e.user === "reboot";
    return rpad(e.user, 8) + " " + rpad(e.tty, 12) + " " + rpad(e.host, 16) + " " + lastDate(e.start) + (e.end === null ? (reboot ? "   still running" : "   still logged in") : " - " + hm(e.end) + "  " + dur(e.start, e.end));
  }
  function lastCmd(list, label, args, io) {
    var a = args.slice(1), n = null, filt = [];
    for (var i = 0; i < a.length; i++) { var x = a[i]; if (x === "-n") n = +a[++i]; else if (/^-\d+$/.test(x)) n = +x.slice(1); else if (/^-[iwFxa]+$/.test(x)) continue; else if (x === "-f") i++; else filt.push(x); }
    var rows = list.slice().sort(function (x, y) { return y.start - x.start; });
    if (filt.length) rows = rows.filter(function (e) { return filt.indexOf(e.user) >= 0 || filt.indexOf(e.tty) >= 0 || filt.indexOf(e.host) >= 0; });
    if (n !== null) rows = rows.slice(0, n);
    rows.forEach(function (e) { out(io, lastLine(e) + "\n"); });
    var first = list.reduce(function (m, e) { return Math.min(m, e.start); }, NOW - 30 * DAY);
    out(io, "\n" + label + " begins " + fullDate(Math.min(first, NOW - 39 * DAY + 37 * MIN)) + "\n");
    return 0;
  }
  CMDS.last = function (args, io, sess) {
    if (args.indexOf("-f") > 0 && /btmp/.test(args[args.indexOf("-f") + 1] || "")) return CMDS.lastb(args, io, sess);
    return lastCmd(wtmpOf(sess.sys), "wtmp", args, io);
  };
  CMDS.lastb = function (args, io, sess) {
    if (sess.uid !== 0) { errl(io, "lastb: cannot open /var/log/btmp: Permission denied"); return 1; }
    return lastCmd(sess.sys.btmp || [], "btmp", args, io);
  };
  CMDS.lastlog = function (args, io, sess) {
    var a = args.slice(1), only = a[0] === "-u" ? a[1] : null;
    out(io, "Username         Port     From                                       Latest\n");
    table(sess.sys, "/etc/passwd").forEach(function (p) {
      if (only && p[0] !== only) return;
      var l = wtmpOf(sess.sys).filter(function (e) { return e.user === p[0]; }).sort(function (x, y) { return y.start - x.start; })[0];
      out(io, rpad(p[0], 16) + " " + (l ? rpad(l.tty, 8) + " " + rpad(l.host, 42) + " " + fullDate(l.start).replace(/ (\d{4})$/, " +0000 $1") : "**Never logged in**") + "\n");
    });
    return 0;
  };
  function sessions(sys) { return wtmpOf(sys).filter(function (e) { return e.end === null && e.user !== "reboot"; }).sort(function (x, y) { return x.tty < y.tty ? -1 : 1; }); }
  CMDS.who = function (args, io, sess) {
    var a = args.slice(1);
    if (a.indexOf("-b") >= 0) { out(io, "         system boot  " + M2.ymd(BOOT) + " " + hm(BOOT) + "\n"); return 0; }
    sessions(sess.sys).forEach(function (e) { out(io, rpad(e.user, 8) + " " + rpad(e.tty, 12) + " " + M2.ymd(e.start) + " " + hm(e.start) + " (" + e.host + ")\n"); });
    return 0;
  };
  var wOrig = CMDS.w;
  CMDS.w = function (args, io, sess) {
    var buf = [], list = sessions(sess.sys);
    wOrig(args, { out: function (t) { buf.push(t); }, err: io.err, tty: false }, sess);
    var first = buf.join("").split("\n")[0].replace(/\d+ users?/, list.length + " user" + (list.length === 1 ? "" : "s"));
    out(io, first + "\nUSER     TTY      FROM             LOGIN@   IDLE   JCPU   PCPU  WHAT\n");
    list.forEach(function (e) {
      var me = e.user === sess.user && e.tty === "pts/0";
      var idle = me ? "0.00s" : Math.max(1, Math.round((sess.sys.now - e.start) / MIN)) > 59 ? Math.floor((sess.sys.now - e.start) / HOUR) + ":" + p2(Math.round(((sess.sys.now - e.start) % HOUR) / MIN)) + "m" : Math.round((sess.sys.now - e.start) / MIN) + ":00";
      out(io, rpad(e.user, 8) + " " + rpad(e.tty, 8) + " " + rpad(e.host, 16) + " " + hm(e.start) + "    " + rpad(idle, 6) + " " + (me ? "0.04s  0.00s w" : "0.31s  0.02s -bash") + "\n");
    });
    return 0;
  };

  /* ================================================================== ufw (+ iptables / nft views) */
  var SERVICES = { ssh: ["22", "tcp"], http: ["80", "tcp"], https: ["443", "tcp"], postgresql: ["5432", "tcp"], mysql: ["3306", "tcp"], smtp: ["25", "tcp"], ftp: ["21", "tcp"], telnet: ["23", "tcp"], dns: ["53", null], domain: ["53", null], redis: ["6379", "tcp"] };
  var APPS = { "OpenSSH": ["22", "tcp", "Secure shell server, an rshd replacement"], "Nginx HTTP": ["80", "tcp", "Small, but very powerful and efficient web server"], "Nginx HTTPS": ["443", "tcp", "Small, but very powerful and efficient web server"], "Nginx Full": ["80,443", "tcp", "Small, but very powerful and efficient web server"] };
  function fw(sys) { if (!sys.ufw) sys.ufw = { enabled: false, def: { incoming: "deny", outgoing: "allow", routed: "disabled" }, rules: [], logging: "low" }; return sys.ufw; }
  M4.fw = fw;
  function ipNum(ip) { var p = String(ip).split("."); if (p.length !== 4) return null; return ((+p[0] << 24) >>> 0) + (+p[1] << 16) + (+p[2] << 8) + +p[3]; }
  function inNet(ip, net) {
    if (net === "any") return true;
    var m = /^([\d.]+)(?:\/(\d+))?$/.exec(net); if (!m) return false;
    var a = ipNum(ip), b = ipNum(m[1]), bits = m[2] === undefined ? 32 : +m[2];
    if (a === null || b === null) return false;
    var mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    return ((a & mask) >>> 0) === ((b & mask) >>> 0);
  }
  function portIn(port, spec) {
    if (!spec) return true;
    return spec.split(",").some(function (p) { var r = p.split(":"); return r.length === 2 ? +port >= +r[0] && +port <= +r[1] : +p === +port; });
  }
  // Would a new incoming connection to PORT/PROTO from SRC be accepted? (first matching rule wins)
  M4.allows = function (sys, port, proto, src) {
    var f = fw(sys);
    if (!f.enabled) return true;
    var rules = f.rules.filter(function (r) { return !r.v6 && r.dir === "in"; });
    for (var i = 0; i < rules.length; i++) {
      var r = rules[i];
      if (!portIn(port, r.port) || (r.proto && proto && r.proto !== proto) || !inNet(src, r.from)) continue;
      return r.action === "allow" || r.action === "limit";
    }
    return f.def.incoming === "allow";
  };
  function ruleTo(r) {
    var t = r.app ? r.app : r.port ? r.port + (r.proto ? "/" + r.proto : "") : "Anywhere";
    if (r.to !== "any") t = r.to + (r.app || r.port ? " " + (r.app || r.port + (r.proto ? "/" + r.proto : "")) : "");
    return t + (r.v6 ? " (v6)" : "");
  }
  function ruleFrom(r) { return r.from === "any" ? "Anywhere" + (r.v6 ? " (v6)" : "") : r.from; }
  function ruleSpec(r) { return r.action + " " + (r.from !== "any" ? "from " + r.from + (r.port ? " to any port " + r.port + (r.proto ? " proto " + r.proto : "") : "") : r.app ? r.app : r.port + (r.proto ? "/" + r.proto : "")) + (r.v6 ? " (v6)" : ""); }
  function ordered(f) { return f.rules.filter(function (r) { return !r.v6; }).concat(f.rules.filter(function (r) { return r.v6; })); }
  function sameRule(a, b) { return a.action === b.action && a.dir === b.dir && a.port === b.port && a.proto === b.proto && a.from === b.from && a.to === b.to && a.app === b.app && a.v6 === b.v6; }
  function parseRule(toks) {
    var r = { dir: "in", port: null, proto: null, from: "any", to: "any", app: null };
    var i = 0;
    if (toks[i] === "in" || toks[i] === "out") r.dir = toks[i++];
    if (toks[i] === "on") i += 2;
    if (i >= toks.length) return { err: "ERROR: Wrong number of arguments" };
    if (!/^(from|to|proto)$/.test(toks[i])) {
      if (toks.length - i !== 1) return { err: "ERROR: Wrong number of arguments" };
      var t = toks[i];
      if (APPS[t]) { r.app = t; r.port = APPS[t][0]; r.proto = APPS[t][1]; return r; }
      var m = /^([\w,:-]+?)(?:\/(tcp|udp))?$/.exec(t);
      if (!m) return { err: "ERROR: Bad port" };
      if (SERVICES[m[1]]) { r.port = SERVICES[m[1]][0]; r.proto = m[2] || SERVICES[m[1]][1]; r.svc = m[1]; return r; }
      if (!/^\d+([,:]\d+)*$/.test(m[1])) return { err: "ERROR: Could not find a profile matching '" + t + "'" };
      if (/[,:]/.test(m[1]) && !m[2]) return { err: "ERROR: Must specify 'tcp' or 'udp' with multiple ports" };
      r.port = m[1]; r.proto = m[2] || null; return r;
    }
    var last = null;
    while (i < toks.length) {
      var k = toks[i++], v = toks[i++];
      if (v === undefined) return { err: "ERROR: Wrong number of arguments" };
      if (k === "from") { r.from = v === "any" ? "any" : v; last = "from"; }
      else if (k === "to") { r.to = v === "any" ? "any" : v; last = "to"; }
      else if (k === "port") { if (last === "from") r.sport = v; else r.port = v; }
      else if (k === "proto") { if (!/^(tcp|udp|any)$/.test(v)) return { err: "ERROR: Unsupported protocol '" + v + "'" }; r.proto = v === "any" ? null : v; }
      else if (k === "app") { r.app = v; if (APPS[v]) { r.port = APPS[v][0]; r.proto = APPS[v][1]; } }
      else return { err: "ERROR: Invalid syntax" };
    }
    if (r.from !== "any" && !/^[\d.]+(\/\d+)?$/.test(r.from)) return { err: "ERROR: Bad source address" };
    if (r.port && !/^\d+([,:]\d+)*$/.test(r.port)) { if (SERVICES[r.port]) { r.proto = r.proto || SERVICES[r.port][1]; r.port = SERVICES[r.port][0]; } else return { err: "ERROR: Bad port '" + r.port + "'" }; }
    return r;
  }
  function addRule(f, io, base, insertAt) {
    var v4only = base.from !== "any" || base.to !== "any";
    var made = [Object.assign({}, base, { v6: false })];
    if (!v4only) made.push(Object.assign({}, base, { v6: true }));
    var msgs = [];
    made.forEach(function (r) {
      var dup = f.rules.some(function (x) { return sameRule(x, r); });
      if (dup) { msgs.push("Skipping adding existing rule" + (r.v6 ? " (v6)" : "")); return; }
      if (insertAt && !r.v6) {
        var v4 = f.rules.filter(function (x) { return !x.v6; });
        if (insertAt > v4.length) { msgs.push("ERROR: Invalid position '" + insertAt + "'"); return; }
        f.rules.splice(f.rules.indexOf(v4[insertAt - 1]), 0, r);
        msgs.push("Rule inserted");
      } else { f.rules.push(r); msgs.push(f.enabled ? "Rule added" + (r.v6 ? " (v6)" : "") : "Rules updated" + (r.v6 ? " (v6)" : "")); }
    });
    out(io, msgs.join("\n") + "\n");
  }
  function sshClientIp(sys) { if (sys.sshFrom) return sys.sshFrom; var s = sessions(sys).filter(function (e) { return e.user === "dev"; })[0]; return s ? s.host : "198.51.100.20"; }
  function writeUfwConf(sys) { var f = fw(sys); M2.writeRoot(sys, "/etc/ufw/ufw.conf", "# /etc/ufw/ufw.conf\n#\n\n# Set to yes to start on boot. If setting this remotely, be sure to add a rule\n# to allow your remote connection before starting ufw. Eg: 'ufw allow 22/tcp'\nENABLED=" + (f.enabled ? "yes" : "no") + "\n\n# Please use the 'ufw' command to set the loglevel. Eg: 'ufw logging medium'.\n# See 'man ufw' for details.\nLOGLEVEL=" + f.logging + "\n"); }
  function statusTable(f, verbose, numbered) {
    var L = [], rules = ordered(f);
    if (!rules.length) return L;
    var w = Math.max(26, Math.max.apply(null, rules.map(function (r) { return (numbered ? 5 : 0) + ruleTo(r).length + 1; })));
    L.push(rpad(numbered ? "     To" : "To", w) + " " + rpad("Action", 11) + " From");
    L.push(rpad(numbered ? "     --" : "--", w) + " " + rpad("------", 11) + " ----");
    rules.forEach(function (r, i) {
      var act = r.action.toUpperCase() + (verbose || numbered ? " " + r.dir.toUpperCase() : "");
      L.push(rpad((numbered ? "[" + pad(i + 1, 2) + "] " : "") + ruleTo(r), w) + " " + rpad(act, 11) + " " + ruleFrom(r));
    });
    return L;
  }
  CMDS.ufw = function (args, io, sess) {
    var sys = sess.sys, f = fw(sys), a = args.slice(1), force = false;
    if (a[0] === "--force") { force = true; a.shift(); }
    if (a[0] === "--dry-run") a.shift();
    if (a[0] === "version" || a[0] === "--version") { out(io, "ufw 0.36.2\nCopyright 2008-2023 Canonical Ltd.\n"); return 0; }
    if (a[0] === "--help" || a[0] === "help" || !a.length) { out(io, "Usage: ufw COMMAND\n\nCommands:\n enable                          enables the firewall\n disable                         disables the firewall\n default ARG                     set default policy\n logging LEVEL                   set logging to LEVEL\n allow ARGS                      add allow rule\n deny ARGS                       add deny rule\n reject ARGS                     add reject rule\n limit ARGS                      add limit rule\n delete RULE|NUM                 delete RULE\n insert NUM RULE                 insert RULE at NUM\n route RULE                      add route RULE\n reload                          reload firewall\n reset                           reset firewall\n status                          show firewall status\n status numbered                 show firewall status as numbered list of RULES\n status verbose                  show verbose firewall status\n show ARG                        show firewall report\n version                         display version information\n\nApplication profile commands:\n app list                        list application profiles\n app info PROFILE                show information on PROFILE\n"); return a.length ? 0 : 1; }
    if (sess.uid !== 0) { errl(io, "ERROR: You need to be root to run this script"); return 1; }
    var cmd = a[0];
    if (cmd === "status") {
      if (!f.enabled) { out(io, "Status: inactive\n"); return 0; }
      var L = ["Status: active"];
      if (a[1] === "verbose") L.push("Logging: " + (f.logging === "off" ? "off" : "on (" + f.logging + ")"), "Default: " + f.def.incoming + " (incoming), " + f.def.outgoing + " (outgoing), " + f.def.routed + " (routed)", "New profiles: skip");
      var T = statusTable(f, a[1] === "verbose", a[1] === "numbered");
      if (T.length) L.push(""); L = L.concat(T);
      out(io, L.join("\n") + "\n\n");
      return 0;
    }
    if (cmd === "enable") {
      if (!force) out(io, "Command may disrupt existing ssh connections. Proceed with operation (y|n)? y\n");
      f.enabled = true; writeUfwConf(sys);
      out(io, "Firewall is active and enabled on system startup\n");
      if (!M4.allows(sys, 22, "tcp", sshClientIp(sys))) {
        sys.lockedOut = true;
        errl(io, "client_loop: send disconnect: Broken pipe");
        note(io, "(You were connected over SSH, and the firewall you just enabled blocks port 22: you've locked yourself out. On a real cloud server you'd now need the provider's web console. Click Reset machine, and allow SSH before enabling ufw.)");
      }
      return 0;
    }
    if (cmd === "disable") { f.enabled = false; writeUfwConf(sys); out(io, "Firewall stopped and disabled on system startup\n"); return 0; }
    if (cmd === "reload") { out(io, f.enabled ? "Firewall reloaded\n" : "Firewall not enabled (skipping reload)\n"); return 0; }
    if (cmd === "reset") {
      if (!force) out(io, "Resetting all rules to installed defaults. This may disrupt existing ssh\nconnections. Proceed with operation (y|n)? y\n");
      out(io, "Backing up 'user.rules' to '/etc/ufw/user.rules.20261111_090000'\nBacking up 'before.rules' to '/etc/ufw/before.rules.20261111_090000'\nBacking up 'after.rules' to '/etc/ufw/after.rules.20261111_090000'\nBacking up 'user6.rules' to '/etc/ufw/user6.rules.20261111_090000'\nBacking up 'before6.rules' to '/etc/ufw/before6.rules.20261111_090000'\nBacking up 'after6.rules' to '/etc/ufw/after6.rules.20261111_090000'\n\n");
      sys.ufw = null; f = fw(sys); writeUfwConf(sys); return 0;
    }
    if (cmd === "logging") { if (!/^(on|off|low|medium|high|full)$/.test(a[1] || "")) { errl(io, "ERROR: Invalid log level '" + (a[1] || "") + "'"); return 1; } f.logging = a[1] === "on" ? "low" : a[1]; writeUfwConf(sys); out(io, "Logging " + (a[1] === "off" ? "disabled" : "enabled") + "\n"); return 0; }
    if (cmd === "default") {
      var pol = a[1], dir = a[2] || "incoming";
      if (!/^(allow|deny|reject)$/.test(pol || "") || !/^(incoming|outgoing|routed)$/.test(dir)) { errl(io, "ERROR: Invalid syntax"); return 1; }
      f.def[dir] = pol;
      out(io, "Default " + dir + " policy changed to '" + pol + "'\n(be sure to update your rules accordingly)\n");
      return 0;
    }
    if (cmd === "app") {
      if (a[1] === "list") { out(io, "Available applications:\n" + Object.keys(APPS).sort().map(function (k) { return "  " + k; }).join("\n") + "\n"); return 0; }
      if (a[1] === "info" && APPS[a[2]]) { out(io, "Profile: " + a[2] + "\nTitle: " + a[2] + "\nDescription: " + APPS[a[2]][2] + "\n\nPort" + (/,/.test(APPS[a[2]][0]) ? "s:\n  " + APPS[a[2]][0] + "/" + APPS[a[2]][1] : ":\n  " + APPS[a[2]][0] + "/" + APPS[a[2]][1]) + "\n"); return 0; }
      errl(io, "ERROR: Could not find profile '" + (a[2] || "") + "'"); return 1;
    }
    if (cmd === "delete") {
      if (/^\d+$/.test(a[1] || "")) {
        var list = ordered(f), n = +a[1];
        if (n < 1 || n > list.length) { errl(io, "ERROR: Could not find rule '" + n + "'"); return 1; }
        var r = list[n - 1];
        if (!force) out(io, "Deleting:\n " + ruleSpec(r) + "\nProceed with operation (y|n)? y\n");
        f.rules.splice(f.rules.indexOf(r), 1);
        out(io, "Rule deleted" + (r.v6 ? " (v6)" : "") + "\n");
        return 0;
      }
      var act = a[1];
      if (!/^(allow|deny|reject|limit)$/.test(act || "")) { errl(io, "ERROR: Invalid syntax"); return 1; }
      var spec = parseRule(a.slice(2));
      if (spec.err) { errl(io, spec.err); return 1; }
      var hit = f.rules.filter(function (x) { return x.action === act && x.port === spec.port && x.proto === spec.proto && x.from === spec.from && x.to === spec.to && x.app === spec.app; });
      if (!hit.length) { out(io, "Could not delete non-existent rule\nCould not delete non-existent rule (v6)\n"); return 0; }
      hit.forEach(function (x) { f.rules.splice(f.rules.indexOf(x), 1); });
      out(io, hit.map(function (x) { return "Rule deleted" + (x.v6 ? " (v6)" : ""); }).join("\n") + "\n");
      return 0;
    }
    var insertAt = null;
    if (cmd === "insert") { insertAt = +a[1]; if (!(insertAt >= 1)) { errl(io, "ERROR: Invalid position '" + a[1] + "'"); return 1; } a = a.slice(2); cmd = a[0]; }
    if (/^(allow|deny|reject|limit)$/.test(cmd)) {
      var parsed = parseRule(a.slice(1));
      if (parsed.err) { errl(io, parsed.err); return 1; }
      parsed.action = cmd;
      addRule(f, io, parsed, insertAt);
      return 0;
    }
    errl(io, "ERROR: Invalid syntax\n\nUsage: ufw COMMAND\n(ufw --help shows the commands)");
    return 1;
  };
  function iptRule(r) {
    var target = r.action === "allow" ? "ACCEPT" : r.action === "limit" ? "ACCEPT" : r.action === "reject" ? "REJECT" : "DROP";
    return { target: target, proto: r.proto || "all", src: r.from === "any" ? "0.0.0.0/0" : r.from, extra: r.port ? (r.proto || "tcp") + " " + (/[,:]/.test(r.port) ? "multiport dports " + r.port : "dpt:" + r.port) : "" };
  }
  CMDS.iptables = function (args, io, sess) {
    if (sess.uid !== 0) { errl(io, "iptables v1.8.10 (nf_tables): Could not fetch rule set generation id: Permission denied (you must be root)"); return 4; }
    var f = fw(sess.sys), a = args.slice(1), v4 = f.rules.filter(function (r) { return !r.v6 && r.dir === "in"; });
    var pol = f.enabled ? (f.def.incoming === "allow" ? "ACCEPT" : "DROP") : "ACCEPT";
    if (a.indexOf("-S") >= 0) {
      var S1 = ["-P INPUT " + pol, "-P FORWARD " + (f.enabled ? "DROP" : "ACCEPT"), "-P OUTPUT ACCEPT"];
      if (f.enabled) { S1.push("-N ufw-user-input", "-A INPUT -j ufw-user-input"); v4.forEach(function (r) { var x = iptRule(r); S1.push("-A ufw-user-input" + (r.from !== "any" ? " -s " + r.from : "") + (r.proto ? " -p " + r.proto : "") + (r.port ? (/[,:]/.test(r.port) ? " -m multiport --dports " + r.port : " -m " + (r.proto || "tcp") + " --dport " + r.port) : "") + " -j " + x.target); }); }
      out(io, S1.join("\n") + "\n"); return 0;
    }
    if (a.indexOf("-L") >= 0 || a.indexOf("--list") >= 0 || a.some(function (x) { return /^-[nvL]+$/.test(x) && x.indexOf("L") >= 0; })) {
      var L = ["Chain INPUT (policy " + pol + ")", "target     prot opt source               destination"];
      if (f.enabled) L.push("ufw-user-input  all  --  0.0.0.0/0            0.0.0.0/0");
      L.push("", "Chain FORWARD (policy " + (f.enabled ? "DROP" : "ACCEPT") + ")", "target     prot opt source               destination", "", "Chain OUTPUT (policy ACCEPT)", "target     prot opt source               destination");
      if (f.enabled) {
        L.push("", "Chain ufw-user-input (1 references)", "target     prot opt source               destination");
        v4.forEach(function (r) { var x = iptRule(r); L.push(rpad(x.target, 10) + " " + rpad(x.proto, 4) + " --  " + rpad(x.src, 20) + " 0.0.0.0/0            " + x.extra); });
      }
      out(io, L.join("\n") + "\n"); return 0;
    }
    note(io, "(On Ubuntu, ufw writes the iptables rules for you. Here, iptables shows them: sudo iptables -L -n, or -S. Change them with ufw.)");
    return 0;
  };
  CMDS.nft = function (args, io, sess) {
    if (sess.uid !== 0) { errl(io, "Operation not permitted (you must be root)"); return 1; }
    var f = fw(sess.sys);
    if (args[1] !== "list") { note(io, "(nft list ruleset shows the firewall rules. ufw manages them on this server.)"); return 0; }
    var v4 = f.rules.filter(function (r) { return !r.v6 && r.dir === "in"; });
    var L = ["table ip filter {", "\tchain INPUT {", "\t\ttype filter hook input priority filter; policy " + (f.enabled && f.def.incoming !== "allow" ? "drop" : "accept") + ";"];
    if (f.enabled) L.push("\t\tcounter jump ufw-user-input");
    L.push("\t}");
    if (f.enabled) { L.push("", "\tchain ufw-user-input {"); v4.forEach(function (r) { var x = iptRule(r); L.push("\t\t" + (r.from !== "any" ? "ip saddr " + r.from + " " : "") + (r.port ? (r.proto || "tcp") + " dport " + (/[,:]/.test(r.port) ? "{ " + r.port.replace(/,/g, ", ").replace(/:/g, "-") + " }" : r.port) + " " : "") + "counter " + (x.target === "ACCEPT" ? "accept" : x.target === "REJECT" ? "reject" : "drop")); }); L.push("\t}"); }
    L.push("}");
    out(io, L.join("\n") + "\n"); return 0;
  };

  /* ================================================================== fail2ban-client: real jail config, bans from auth.log */
  function iniRead(sys) {
    var files = ["/etc/fail2ban/jail.conf"], d = M2.nodeAt(sys, "/etc/fail2ban/jail.d");
    if (d && d.type === "d") Object.keys(d.children).sort().forEach(function (n) { if (/\.(conf|local)$/.test(n)) files.push("/etc/fail2ban/jail.d/" + n); });
    files.push("/etc/fail2ban/jail.local");
    var conf = {};
    files.forEach(function (p) {
      var t = M2.rd(sys, p), sec = null; if (t === null) return;
      t.split("\n").forEach(function (l) {
        var s = /^\s*\[([^\]]+)\]/.exec(l); if (s) { sec = s[1]; conf[sec] = conf[sec] || {}; return; }
        var kv = /^\s*([\w.]+)\s*[=:]\s*(.*?)\s*$/.exec(l); if (kv && sec && !/^\s*[#;]/.test(l)) conf[sec][kv[1]] = kv[2];
      });
    });
    return conf;
  }
  function secs(v) { var m = /^(\d+)\s*([smhdw]?)/.exec(String(v || "")); if (!m) return 600; return +m[1] * { "": 1, s: 1, m: 60, h: 3600, d: 86400, w: 604800 }[m[2]]; }
  function jail(sys, name) {
    var c = iniRead(sys), d = c.DEFAULT || {}, j = c[name] || {};
    var get = function (k, def) { return j[k] !== undefined ? j[k] : d[k] !== undefined ? d[k] : def; };
    return { enabled: /^(true|yes|1)$/i.test(get("enabled", "false")), maxretry: +get("maxretry", 5), bantime: get("bantime", "10m"), findtime: get("findtime", "10m") };
  }
  M4.jail = jail;
  function f2bStats(sys) {
    var j = jail(sys, "sshd"), fails = {}, total = 0;
    (M2.rd(sys, "/var/log/auth.log") || "").split("\n").forEach(function (l) { var m = /sshd\[\d+\]: (?:Failed password|Invalid user|Connection closed by authenticating user)\b.*? from ([\d.]+)/.exec(l); if (m && /Failed password/.test(l)) { fails[m[1]] = (fails[m[1]] || 0) + 1; total++; } });
    var unb = sys.f2bUnban || [], extra = sys.f2bBan || [];
    var banned = Object.keys(fails).filter(function (ip) { return fails[ip] >= j.maxretry && unb.indexOf(ip) < 0; }).concat(extra.filter(function (ip) { return !fails[ip] || fails[ip] < j.maxretry; }));
    var failing = Object.keys(fails).filter(function (ip) { return banned.indexOf(ip) < 0; });
    return { jail: j, banned: banned, failing: failing, total: total };
  }
  M4.f2bBanned = function (sys) { var u = sys.units && sys.units["fail2ban.service"]; return u && u.rt.active === "active" && jail(sys, "sshd").enabled ? f2bStats(sys).banned : []; };
  CMDS["fail2ban-client"] = function (args, io, sess) {
    var sys = sess.sys, a = args.slice(1);
    if (sess.uid !== 0) { errl(io, "ERROR  Permission denied to socket: /var/run/fail2ban/fail2ban.sock, (you must be root)"); return 255; }
    var u = sys.units && sys.units["fail2ban.service"];
    if (!u || u.rt.active !== "active") { errl(io, "ERROR  Failed to access socket path: /var/run/fail2ban/fail2ban.sock. Is fail2ban running?"); return 255; }
    var jails = jail(sys, "sshd").enabled ? ["sshd"] : [];
    if (a[0] === "ping") { out(io, "Server replied: pong\n"); return 0; }
    if (a[0] === "status" && !a[1]) { out(io, "Status\n|- Number of jail:\t" + jails.length + "\n`- Jail list:\t" + jails.join(", ") + "\n"); return 0; }
    if (a[1] && jails.indexOf(a[1]) < 0 && /^(status|get|set)$/.test(a[0])) { errl(io, "Sorry but the jail '" + a[1] + "' does not exist"); return 255; }
    var st = f2bStats(sys);
    if (a[0] === "status") { out(io, "Status for the jail: sshd\n|- Filter\n|  |- Currently failed:\t" + st.failing.length + "\n|  |- Total failed:\t" + st.total + "\n|  `- Journal matches:\t_SYSTEMD_UNIT=sshd.service + _COMM=sshd\n`- Actions\n   |- Currently banned:\t" + st.banned.length + "\n   |- Total banned:\t" + st.banned.length + "\n   `- Banned IP list:\t" + st.banned.join(" ") + "\n"); return 0; }
    if (a[0] === "get" && a[2]) { var v = { maxretry: st.jail.maxretry, bantime: secs(st.jail.bantime), findtime: secs(st.jail.findtime) }[a[2]]; if (v === undefined) { errl(io, "Invalid command (no get action or not yet implemented)"); return 255; } out(io, v + "\n"); return 0; }
    if (a[0] === "set" && (a[2] === "unbanip" || a[2] === "banip") && a[3]) {
      sys.f2bUnban = sys.f2bUnban || []; sys.f2bBan = sys.f2bBan || [];
      if (a[2] === "unbanip") { if (st.banned.indexOf(a[3]) < 0) { out(io, "0\n"); return 0; } sys.f2bUnban.push(a[3]); sys.f2bBan = sys.f2bBan.filter(function (x) { return x !== a[3]; }); }
      else { sys.f2bBan.push(a[3]); sys.f2bUnban = sys.f2bUnban.filter(function (x) { return x !== a[3]; }); }
      out(io, "1\n"); return 0;
    }
    if (a[0] === "reload") { out(io, "OK\n"); return 0; }
    errl(io, "Invalid command (no get action or not yet implemented)"); return 255;
  };

  /* ================================================================== gpg: signatures you can actually check */
  function b64(t) { return typeof btoa === "function" ? btoa(t) : Buffer.from(t, "binary").toString("base64"); }
  function unb64(t) { try { return typeof atob === "function" ? atob(t) : Buffer.from(t, "base64").toString("binary"); } catch (e) { return ""; } }
  function wrap64(t) { return t.replace(/(.{64})/g, "$1\n").replace(/\n$/, ""); }
  function armor(kind, payload) { var body = b64(payload); return "-----BEGIN PGP " + kind + "-----\n\n" + wrap64(body) + "\n=" + M2.hashChars(body, 4) + "\n-----END PGP " + kind + "-----\n"; }
  function dearmor(text, kind) {
    var m = new RegExp("-----BEGIN PGP " + kind + "-----\\n(?:[^\\n]*:[^\\n]*\\n)*\\n([\\s\\S]*?)\\n=\\S{4}\\n-----END PGP " + kind + "-----").exec(String(text || ""));
    if (!m) return null;
    var raw = unb64(m[1].replace(/\s+/g, ""));
    var n = raw.indexOf("\n"); if (n < 0) return null;
    try { return { tag: raw.slice(0, n), data: JSON.parse(raw.slice(n + 1)) }; } catch (e) { return null; }
  }
  M4.makeKey = function (uid, created) {
    var fpr = M2.hexOf("kc-gpg-" + uid + created, 40).toUpperCase();
    return { fpr: fpr, keyid: fpr.slice(-16), uid: uid, created: created, armor: armor("PUBLIC KEY BLOCK", "KCPGP1\n" + JSON.stringify({ uid: uid, fpr: fpr, created: created })) };
  };
  M4.sign = function (key, content, when) { return armor("SIGNATURE", "KCSIG1\n" + JSON.stringify({ fpr: key.fpr, sha: M2.sha256(content), t: when })); };
  function spaced(fpr) { return fpr.replace(/(.{4})/g, "$1 ").trim().replace(/^((?:\S{4} ){4}\S{4}) /, "$1  "); }
  function keyring(sess) { var t = M2.rd(sess.sys, sess.home + "/.gnupg/pubring.kbx"); return t ? t.split("\n").filter(Boolean).map(function (l) { try { return JSON.parse(l); } catch (e) { return null; } }).filter(Boolean) : []; }
  function ensureGnupg(sess, io) {
    var dir = sess.home + "/.gnupg";
    if (!M2.nodeAt(sess.sys, dir)) { M2.mkdirRoot(sess.sys, dir, 448, sess.uid, sess.gid); errl(io, "gpg: directory '" + dir + "' created"); }
    if (M2.rd(sess.sys, dir + "/pubring.kbx") === null) { M2.putRoot(sess.sys, dir + "/pubring.kbx", "", 420, sess.uid, sess.gid); errl(io, "gpg: keybox '" + dir + "/pubring.kbx' created"); }
  }
  function listKey(io, k, withFpr) {
    out(io, "pub   ed25519 " + k.created + " [SC]\n      " + (withFpr ? spaced(k.fpr) : k.fpr) + "\nuid           [ unknown] " + k.uid + "\nsub   cv25519 " + k.created + " [E]\n\n");
  }
  CMDS.gpg = function (args, io, sess) {
    var a = args.slice(1).filter(function (x) { return !/^--(batch|quiet|no-tty|yes|with-colons|keyid-format=\S+)$/.test(x); });
    var cmd = a[0];
    if (cmd === "--version") { out(io, "gpg (GnuPG) 2.4.4\nlibgcrypt 1.10.3\nCopyright (C) 2024 g10 Code GmbH\nHome: " + sess.home + "/.gnupg\n"); return 0; }
    if (cmd === "--import") {
      ensureGnupg(sess, io);
      var ring = keyring(sess), n = 0, code = 0;
      a.slice(1).forEach(function (fp) {
        var r = S.readFile(sess, fp);
        if (r.error) { errl(io, "gpg: can't open '" + fp + "': " + S.ERRTEXT[r.error]); code = 2; return; }
        var k = dearmor(r.content, "PUBLIC KEY BLOCK");
        if (!k || k.tag !== "KCPGP1") { errl(io, "gpg: no valid OpenPGP data found."); code = 2; return; }
        n++;
        if (ring.some(function (x) { return x.fpr === k.data.fpr; })) { errl(io, "gpg: key " + k.data.fpr.slice(-16) + ": \"" + k.data.uid + "\" not changed"); return; }
        ring.push(k.data);
        errl(io, "gpg: key " + k.data.fpr.slice(-16) + ": public key \"" + k.data.uid + "\" imported");
      });
      M2.putRoot(sess.sys, sess.home + "/.gnupg/pubring.kbx", ring.map(function (x) { return JSON.stringify(x); }).join("\n") + "\n", 420, sess.uid, sess.gid);
      if (n) errl(io, "gpg: Total number processed: " + n + "\ngpg:               imported: " + n);
      return code;
    }
    if (cmd === "--show-keys" || cmd === "--import-options") {
      var fp2 = a[a.length - 1], r2 = S.readFile(sess, fp2);
      if (r2.error) { errl(io, "gpg: can't open '" + fp2 + "': " + S.ERRTEXT[r2.error]); return 2; }
      var k2 = dearmor(r2.content, "PUBLIC KEY BLOCK");
      if (!k2) { errl(io, "gpg: no valid OpenPGP data found."); return 2; }
      listKey(io, k2.data, a.indexOf("--fingerprint") >= 0); return 0;
    }
    if (cmd === "--list-keys" || cmd === "-k" || cmd === "--fingerprint") {
      var ring2 = keyring(sess), pat = a[1];
      if (pat) ring2 = ring2.filter(function (k) { return k.uid.toLowerCase().indexOf(pat.toLowerCase()) >= 0 || k.fpr.indexOf(pat.toUpperCase().replace(/\s/g, "")) >= 0; });
      if (!ring2.length) { if (pat) { errl(io, "gpg: error reading key: No public key"); return 2; } return 0; }
      out(io, sess.home + "/.gnupg/pubring.kbx\n" + "-".repeat((sess.home + "/.gnupg/pubring.kbx").length) + "\n");
      ring2.forEach(function (k) { listKey(io, k, cmd === "--fingerprint"); });
      return 0;
    }
    if (cmd === "--verify") {
      var sigF = a[1], dataF = a[2];
      if (!sigF) { errl(io, "usage: gpg [options] --verify [signature_file] [data_file]"); return 2; }
      var rs = S.readFile(sess, sigF);
      if (rs.error) { errl(io, "gpg: can't open '" + sigF + "': " + S.ERRTEXT[rs.error]); return 2; }
      var sig = dearmor(rs.content, "SIGNATURE");
      if (!sig || sig.tag !== "KCSIG1") { errl(io, "gpg: no valid OpenPGP data found.\ngpg: the signature could not be verified.\nPlease remember that the signature file (.sig or .asc)\nshould be the first file given on the command line."); return 2; }
      if (!dataF) { dataF = sigF.replace(/\.(asc|sig|gpg)$/, ""); errl(io, "gpg: assuming signed data in '" + dataF + "'"); }
      var rd = S.readFile(sess, dataF);
      if (rd.error) { errl(io, "gpg: can't open signed data '" + dataF + "'\ngpg: can't hash datafile: No data"); return 2; }
      var d = new Date(sig.data.t);
      errl(io, "gpg: Signature made " + WDAY[d.getUTCDay()] + " " + MON[d.getUTCMonth()] + " " + pad(d.getUTCDate(), 2) + " " + hm(sig.data.t) + ":" + p2(d.getUTCSeconds()) + " " + d.getUTCFullYear() + " UTC\ngpg:                using EDDSA key " + sig.data.fpr);
      var key = keyring(sess).filter(function (k) { return k.fpr === sig.data.fpr; })[0];
      if (!key) { errl(io, "gpg: Can't check signature: No public key"); return 2; }
      if (M2.sha256(rd.content) !== sig.data.sha) { errl(io, "gpg: BAD signature from \"" + key.uid + "\" [unknown]"); return 1; }
      errl(io, "gpg: Good signature from \"" + key.uid + "\" [unknown]\ngpg: WARNING: This key is not certified with a trusted signature!\ngpg:          There is no indication that the signature belongs to the owner.\nPrimary key fingerprint: " + spaced(key.fpr));
      return 0;
    }
    if (cmd === "--recv-keys" || cmd === "--search-keys" || cmd === "--keyserver") { errl(io, "gpg: keyserver receive failed: No keyserver available"); return 2; }
    note(io, "(This lab's gpg supports --import, --show-keys, --list-keys, --fingerprint and --verify.)");
    return 2;
  };

  /* ================================================================== package integrity: debsums, dpkg --verify, apt --reinstall */
  var OWNER = { sshd: "openssh-server", bash: "bash", sudo: "sudo", su: "util-linux", mount: "util-linux", umount: "util-linux", passwd: "passwd", chsh: "passwd", chfn: "passwd", gpasswd: "passwd", newgrp: "login", nginx: "nginx-core", ssh: "openssh-client", scp: "openssh-client" };
  function pkgOf(sys, name) {
    if (OWNER[name]) return OWNER[name];
    var hit = Object.keys(sys.pkgs || {}).filter(function (k) { var p = sys.pkgs[k]; return p.bins.indexOf(name) >= 0 || p.sbins.indexOf(name) >= 0; })[0];
    return hit || "coreutils";
  }
  function recordSums(sys) {
    sys.pkgFiles = {};
    ["/usr/bin", "/usr/sbin"].forEach(function (dir) {
      var d = M2.nodeAt(sys, dir); if (!d) return;
      Object.keys(d.children).forEach(function (n) { var f = d.children[n]; if (f.type === "f" && /^\x7fELF:/.test(f.content)) sys.pkgFiles[dir + "/" + n] = { pkg: pkgOf(sys, n), content: f.content, mode: f.mode }; });
    });
  }
  function changed(sys, filt) {
    var res = [];
    Object.keys(sys.pkgFiles || {}).sort().forEach(function (p) {
      var e = sys.pkgFiles[p]; if (filt && filt.indexOf(e.pkg) < 0) return;
      var pk = sys.pkgs[e.pkg]; if (pk && !pk.installed) return;
      var n = M2.nodeAt(sys, p);
      if (!n) res.push({ path: p, pkg: e.pkg, missing: true }); else if (n.content !== e.content) res.push({ path: p, pkg: e.pkg });
    });
    return res;
  }
  M4.changedFiles = changed;
  CMDS.debsums = function (args, io, sess) {
    var a = args.slice(1), silent = a.some(function (x) { return /^-\w*[sc]/.test(x) || x === "--silent" || x === "--changed"; }), pk = a.filter(function (x) { return !/^-/.test(x); });
    var ch = changed(sess.sys, pk.length ? pk : null);
    if (!silent) {
      Object.keys(sess.sys.pkgFiles || {}).sort().forEach(function (p) { var e = sess.sys.pkgFiles[p]; if (pk.length && pk.indexOf(e.pkg) < 0) return; var bad = ch.filter(function (c) { return c.path === p; })[0]; out(io, rpad(p, 62) + " " + (bad ? (bad.missing ? "MISSING" : "FAILED") : "OK") + "\n"); });
    } else ch.forEach(function (c) { errl(io, "debsums: " + (c.missing ? "missing" : "changed") + " file " + c.path + " (from " + c.pkg + " package)"); });
    return ch.length ? 2 : 0;
  };
  var dpkgOrig = CMDS.dpkg;
  CMDS.dpkg = function (args, io, sess) {
    var i = args.findIndex(function (x) { return x === "-V" || x === "--verify"; });
    if (i < 0) return dpkgOrig(args, io, sess);
    var pk = args.slice(1).filter(function (x) { return !/^-/.test(x); });
    changed(sess.sys, pk.length ? pk : null).forEach(function (c) { out(io, (c.missing ? "missing     " : "??5??????   ") + c.path + "\n"); });
    return 0;
  };
  function wrapApt(name) {
    var orig = CMDS[name];
    CMDS[name] = function (args, io, sess) {
      var a = args.slice(1), re = a.indexOf("--reinstall") >= 0 || a[0] === "reinstall";
      if (!re || a.indexOf("install") < 0 && a[0] !== "reinstall") return orig(args, io, sess);
      if (sess.uid !== 0) return orig([name, "install"].concat(a.filter(function (x) { return x !== "--reinstall" && x !== "install" && x !== "reinstall"; })), io, sess);
      var names = a.filter(function (x) { return !/^-/.test(x) && x !== "install" && x !== "reinstall"; });
      var sys = sess.sys, pk = names.map(function (n) { return M2.pkg(sys, n); });
      var miss = names.filter(function (n, k) { return !pk[k]; });
      if (miss.length) return orig(args, io, sess);
      var notInst = pk.filter(function (p) { return !p.installed; });
      if (notInst.length) return orig([name, "install"].concat(names), io, sess);
      var nu = Object.keys(sys.pkgs).filter(function (k) { var p = sys.pkgs[k]; return p.installed && sys.aptUpdated && p.newVer && p.curVer !== p.newVer; }).length;
      out(io, "Reading package lists... Done\nBuilding dependency tree... Done\nReading state information... Done\n0 upgraded, 0 newly installed, " + pk.length + " reinstalled, 0 to remove and " + nu + " not upgraded.\nNeed to get " + pk.length * 512 + " kB of archives.\nAfter this operation, 0 B of additional disk space will be used.\n");
      pk.forEach(function (p, k) { out(io, "Get:" + (k + 1) + " http://archive.ubuntu.com/ubuntu noble-updates/main " + p.arch + " " + p.name + " " + p.arch + " " + p.curVer + " [" + 512 + " kB]\n"); });
      out(io, "Fetched " + pk.length * 512 + " kB in 0s (2,330 kB/s)\n(Reading database ... 74213 files and directories currently installed.)\n");
      pk.forEach(function (p) {
        out(io, "Preparing to unpack .../" + p.name + "_" + p.curVer.replace(":", "%3a") + "_" + p.arch + ".deb ...\nUnpacking " + p.name + " (" + p.curVer + ") over (" + p.curVer + ") ...\n");
        Object.keys(sys.pkgFiles || {}).forEach(function (path) { var e = sys.pkgFiles[path]; if (e.pkg === p.name) M2.putRoot(sys, path, e.content, e.mode, 0, 0, Date.UTC(2024, 3, 8)); });
        p.bins.forEach(function (b) { if (!sys.pkgFiles["/usr/bin/" + b]) M2.putRoot(sys, "/usr/bin/" + b, "\x7fELF:" + b + " (simulated binary)\n", 493, 0, 0, Date.UTC(2024, 3, 8)); });
        p.sbins.forEach(function (b) { if (!sys.pkgFiles["/usr/sbin/" + b]) M2.putRoot(sys, "/usr/sbin/" + b, "\x7fELF:" + b + " (simulated binary)\n", 493, 0, 0, Date.UTC(2024, 3, 8)); });
        out(io, "Setting up " + p.name + " (" + p.curVer + ") ...\n");
      });
      return 0;
    };
  }
  wrapApt("apt"); wrapApt("apt-get");

  /* ================================================================== unattended-upgrades, apt-config, dpkg-reconfigure */
  function aptConf(sys) {
    var vals = {}, d = M2.nodeAt(sys, "/etc/apt/apt.conf.d");
    if (d && d.type === "d") Object.keys(d.children).sort().forEach(function (n) { var t = M2.rd(sys, "/etc/apt/apt.conf.d/" + n) || ""; t.replace(/\/\/.*$/gm, "").replace(/([\w:-]+)\s+"([^"]*)"\s*;/g, function (m0, k, v) { vals[k] = v; return m0; }); });
    return vals;
  }
  M4.aptConf = aptConf;
  CMDS["apt-config"] = function (args, io, sess) {
    if (args[1] !== "dump") { errl(io, "E: Invalid operation " + (args[1] || "")); return 100; }
    var v = aptConf(sess.sys), only = args[2];
    Object.keys(v).sort().forEach(function (k) { if (!only || k === only) out(io, k + " \"" + v[k] + "\";\n"); });
    return 0;
  };
  CMDS["unattended-upgrade"] = function (args, io, sess) {
    if (sess.uid !== 0) { errl(io, "You need to be root to run this application"); return 1; }
    var sys = sess.sys, dry = args.indexOf("--dry-run") > 0, verbose = args.some(function (x) { return /^(-v|-d|--debug|--verbose)$/.test(x); });
    var pkgs = Object.keys(sys.pkgs).map(function (k) { return sys.pkgs[k]; }).filter(function (p) { return p.installed && sys.aptUpdated && p.newVer && p.curVer !== p.newVer && !p.hold; }).map(function (p) { return p.name; }).sort();
    if (verbose) out(io, "Checking if system is running on battery is skipped. Please install \"powermgmt-base\" package to check power status and skip installing updates when the system is running on battery.\nStarting unattended upgrades script\nAllowed origins are: o=Ubuntu,a=noble, o=Ubuntu,a=noble-security, o=UbuntuESMApps,a=noble-apps-security, o=UbuntuESM,a=noble-infra-security\n");
    if (!pkgs.length) { if (verbose) out(io, "No packages found that can be upgraded unattended and no pending auto-removals\n"); return 0; }
    if (verbose || dry) out(io, "Packages that will be upgraded: " + pkgs.join(" ") + "\n");
    if (dry) { if (verbose) out(io, "Writing dpkg log to /var/log/unattended-upgrades/unattended-upgrades-dpkg.log\n/usr/bin/dpkg --status-fd 10 --no-triggers --unpack --auto-deconfigure (dry run)\nAll upgrades installed\n"); return 0; }
    pkgs.forEach(function (n) { sys.pkgs[n].curVer = sys.pkgs[n].newVer; });
    M2.writeRoot(sys, "/var/log/unattended-upgrades/unattended-upgrades.log", M2.ymd(sys.now) + " " + M2.tod(sys.now) + ",000 INFO Packages that will be upgraded: " + pkgs.join(" ") + "\n" + M2.ymd(sys.now) + " " + M2.tod(sys.now) + ",500 INFO All upgrades installed\n", true);
    if (verbose) out(io, "All upgrades installed\n");
    return 0;
  };
  CMDS["dpkg-reconfigure"] = function (args, io, sess) {
    var pk = args.slice(1).filter(function (x) { return !/^-/.test(x); })[0];
    if (sess.uid !== 0) { errl(io, "/usr/sbin/dpkg-reconfigure must be run as root"); return 1; }
    if (pk === "unattended-upgrades") {
      M2.writeRoot(sess.sys, "/etc/apt/apt.conf.d/20auto-upgrades", "APT::Periodic::Update-Package-Lists \"1\";\nAPT::Periodic::Unattended-Upgrade \"1\";\n");
      note(io, "(A dialog asked: \"Automatically download and install stable updates?\" The lab answered Yes, which wrote /etc/apt/apt.conf.d/20auto-upgrades.)");
      return 0;
    }
    note(io, "(dpkg-reconfigure re-asks a package's setup questions in a dialog. This lab supports: sudo dpkg-reconfigure -plow unattended-upgrades)");
    return 0;
  };

  /* ================================================================== sudo -l -U USER */
  var sudoOrig = CMDS.sudo;
  CMDS.sudo = function (args, io, sess) {
    var i = args.indexOf("-U");
    if (i > 0 && args.indexOf("-l") > 0) {
      var who = args[i + 1];
      if (!who || !S.userByName(sess.sys, who)) { errl(io, "sudo: unknown user " + (who || "")); return 1; }
      var probe = { stdin: null, out: function () {}, err: function () {}, tty: false };
      if (sess.uid !== 0 && sudoOrig(["sudo", "-n", "true"], probe, sess) !== 0) return sudoOrig(["sudo", "-l"], io, sess);
      var fake = Object.create(sess); fake.uid = 0; fake.user = who;
      var buf = [];
      sudoOrig(["sudo", "-l"], { stdin: null, out: function (t) { buf.push(t); }, err: io.err, tty: false }, fake);
      var text = buf.join(""), parts = text.split(/\n(?=User \S+ may run)/);
      if (!/\n\s+\(/.test(parts[1] || "")) { out(io, "User " + who + " is not allowed to run sudo on " + sess.sys.host + ".\n"); return 0; }
      out(io, text); return 0;
    }
    return sudoOrig(args, io, sess);
  };

  /* ================================================================== man pages */
  var MAN = S.MAN;
  MAN.passwd = { syn: "passwd [-l | -u | -S | -e | -d] [USER]", desc: "Change a user's password, or lock, unlock and inspect it. Locking only blocks password logins: SSH keys still work unless the account is also expired.", opts: [["-l USER", "lock the password (puts ! in front of the hash in /etc/shadow)"], ["-u USER", "unlock it"], ["-S USER", "status: P (usable password), L (locked), NP (no password)"], ["-e USER", "expire it: the user must choose a new one at next login"]] };
  MAN.usermod = { syn: "usermod [options] USER", desc: "Change a user account.", opts: [["-L / -U", "lock / unlock the password"], ["-e YYYY-MM-DD", "the account expires on that date (-e 1: already expired, blocks every login, keys included)"], ["-aG GROUP", "add to a supplementary group (without -a, -G replaces the list!)"], ["-s /usr/sbin/nologin", "change the login shell"]] };
  MAN.useradd = { syn: "useradd [-m] [-s SHELL] [-G GROUPS] USER", desc: "Create a user (low level; Ubuntu's friendlier adduser asks questions).", opts: [["-m", "create the home folder"], ["-s /bin/bash", "login shell (the default is /bin/sh)"], ["-G sudo,www-data", "supplementary groups"], ["-r", "a system account"]] };
  MAN.userdel = { syn: "userdel [-r] [-f] USER", desc: "Delete a user account. Refuses while the user has running processes.", opts: [["-r", "also delete the home folder and mail spool"], ["-f", "force, even if the user is logged in or still has processes"]] };
  MAN.chage = { syn: "chage [-l | -E DATE | -M DAYS] USER", desc: "Show or change password and account expiry.", opts: [["-l USER", "list the dates"], ["-E 2026-12-31 USER", "the account expires on that date (-E -1: never)"], ["-M 90 USER", "the password must be changed every 90 days"]] };
  MAN.gpasswd = { syn: "gpasswd -a|-d USER GROUP", desc: "Add a user to, or remove a user from, a group.", opts: [["-a USER GROUP", "add"], ["-d USER GROUP", "remove"]] };
  MAN.last = { syn: "last [-n N] [USER|TTY]", desc: "Show past and current logins, newest first, from /var/log/wtmp: who, from where, when, for how long.", opts: [["-n 10", "only the last 10"], ["USER", "only that user's logins"], ["reboot", "when the system booted"]] };
  MAN.lastb = { syn: "sudo lastb [-n N]", desc: "Show failed login attempts (/var/log/btmp). Needs root.", opts: [] };
  MAN.lastlog = { syn: "lastlog [-u USER]", desc: "Each account's most recent login.", opts: [] };
  MAN.ufw = { syn: "sudo ufw COMMAND", desc: "Uncomplicated Firewall: manage the server's packet filter. The first rule that matches a connection decides; if none matches, the default policy applies. Allow SSH before you enable it on a remote server.", opts: [["status [verbose|numbered]", "show the rules"], ["default deny incoming", "block everything not allowed"], ["allow 22/tcp, allow OpenSSH", "open a port, or an application profile"], ["allow from 10.0.1.0/24 to any port 5432", "only from one network"], ["insert 1 deny from IP", "put a rule first"], ["delete N", "remove rule N (from status numbered)"], ["enable / disable", "turn it on / off"]] };
  MAN.iptables = { syn: "sudo iptables -L -n | -S", desc: "Show the kernel's packet filter rules (ufw writes them for you on Ubuntu).", opts: [] };
  MAN.nft = { syn: "sudo nft list ruleset", desc: "Show the firewall rules in nftables form.", opts: [] };
  MAN.gpg = { syn: "gpg --import KEY | --verify SIG [FILE] | --fingerprint", desc: "GnuPG: check that a file was signed by the holder of a key. Compare the key's fingerprint with one published somewhere you trust before believing a Good signature.", opts: [["--import key.asc", "add a public key to your keyring"], ["--show-keys key.asc", "look at a key file without importing it"], ["--fingerprint", "list keys with their fingerprints"], ["--verify FILE.asc FILE", "check a detached signature"]] };
  MAN.debsums = { syn: "debsums [-s] [-c] [PACKAGE...]", desc: "Check installed package files against the checksums the package shipped with. Changed system binaries are a classic sign of compromise.", opts: [["-s", "silent: only report problems"], ["-c", "list changed files"]] };
  MAN["unattended-upgrade"] = { syn: "sudo unattended-upgrade [--dry-run] [-d]", desc: "Install security updates automatically (it normally runs daily from a systemd timer, when /etc/apt/apt.conf.d/20auto-upgrades enables it).", opts: [["--dry-run", "show what would be upgraded"], ["-d", "explain what it's doing"]] };
  MAN["apt-config"] = { syn: "apt-config dump [KEY]", desc: "Show APT's effective configuration (all files in /etc/apt/apt.conf.d merged).", opts: [] };
  MAN["fail2ban-client"] = { syn: "sudo fail2ban-client status [JAIL] | get JAIL KEY | set JAIL unbanip IP", desc: "Talk to fail2ban, which bans IP addresses that fail to log in too often. Jails are configured in /etc/fail2ban/jail.local.", opts: [["status", "list the jails"], ["status sshd", "failures and banned IPs for the SSH jail"], ["get sshd maxretry", "a setting's current value"], ["set sshd unbanip IP", "lift a ban"]] };

  /* ================================================================== the base machine */
  var NEW = { "/usr/bin": ["last", "lastb", "lastlog", "chage", "gpg", "apt-config", "unattended-upgrade"], "/usr/sbin": ["useradd", "usermod", "userdel", "deluser", "adduser", "ufw", "iptables", "nft", "dpkg-reconfigure"] };
  M2.CATALOG.push({ name: "debsums", ver: "3.0.2.1", arch: "all", section: "admin", size: 300, desc: "tool for verification of installed package files against MD5 checksums", deps: [], bins: ["debsums"], sbins: [], installed: false, auto: false, archive: "noble" });
  M2.CATALOG.push({ name: "unattended-upgrades", ver: "2.9.1+nmu4ubuntu1", arch: "all", section: "admin", size: 420, desc: "automatic installation of security upgrades", deps: [], bins: ["unattended-upgrade"], sbins: [], installed: true, auto: false, archive: "noble", service: "unattended-upgrades.service" });
  function binPut(sys, path, impl) { M2.putRoot(sys, path, "\x7fELF:" + impl + " (simulated binary)\n", 493, 0, 0, Date.UTC(2024, 3, 8)); }
  S.SYS_HOOKS.push(function (sys) {
    Object.keys(NEW).forEach(function (d) { NEW[d].forEach(function (b) { binPut(sys, d + "/" + b, b); }); });
    if (sys.pkgs.debsums && sys.pkgs.debsums.installed) binPut(sys, "/usr/bin/debsums", "debsums");
    // logins: the box was rebooted 12 days ago; dev is connected now
    sys.wtmp = [];
    M4.login(sys, "reboot", "system boot", "6.8.0-48-generic", BOOT, null);
    M4.login(sys, "ben", "pts/1", "198.51.100.44", NOW - 5 * DAY + 6 * HOUR + 40 * MIN, NOW - 5 * DAY + 7 * HOUR + 5 * MIN);
    M4.login(sys, "dev", "pts/0", "198.51.100.20", NOW - 2 * DAY + 1 * MIN, NOW - 2 * DAY + 9 * HOUR + 22 * MIN);
    M4.login(sys, "ana", "pts/1", "198.51.100.31", NOW - DAY + 1 * HOUR + 12 * MIN, NOW - DAY + 3 * HOUR + 30 * MIN);
    M4.login(sys, "dev", "pts/0", "198.51.100.20", NOW - DAY + 5 * HOUR + 3 * MIN, NOW - DAY + 8 * HOUR + 41 * MIN);
    M4.login(sys, "dev", "pts/0", "198.51.100.20", NOW - 8 * MIN, null);
    sys.btmp = [];
    // firewall: installed, off
    fw(sys); writeUfwConf(sys);
    M2.putRoot(sys, "/etc/default/ufw", "# /etc/default/ufw\nIPV6=yes\nDEFAULT_INPUT_POLICY=\"DROP\"\nDEFAULT_OUTPUT_POLICY=\"ACCEPT\"\nDEFAULT_FORWARD_POLICY=\"DROP\"\n");
    // unattended-upgrades: installed and on (Ubuntu's default)
    M2.putRoot(sys, "/etc/apt/apt.conf.d/20auto-upgrades", "APT::Periodic::Update-Package-Lists \"1\";\nAPT::Periodic::Unattended-Upgrade \"1\";\n");
    M2.putRoot(sys, "/etc/apt/apt.conf.d/50unattended-upgrades", "// Automatically upgrade packages from these (origin:archive) pairs\nUnattended-Upgrade::Allowed-Origins {\n\t\"${distro_id}:${distro_codename}\";\n\t\"${distro_id}:${distro_codename}-security\";\n\t\"${distro_id}ESMApps:${distro_codename}-apps-security\";\n\t\"${distro_id}ESM:${distro_codename}-infra-security\";\n};\n\n// Automatically reboot *WITHOUT CONFIRMATION* if the file /var/run/reboot-required is found after the upgrade\n//Unattended-Upgrade::Automatic-Reboot \"false\";\n");
    M2.putRoot(sys, "/usr/lib/systemd/system/unattended-upgrades.service", "[Unit]\nDescription=Unattended Upgrades Shutdown\nAfter=network.target local-fs.target systemd-logind.service\nRequiresMountsFor=/run /var/log /var/run /var/lib /boot\n\n[Service]\nExecStart=/usr/share/unattended-upgrades/unattended-upgrade-shutdown --wait-for-signal\nTimeoutStopSec=1800\n\n[Install]\nWantedBy=multi-user.target\n");
    var wants = M2.mkdirRoot(sys, "/etc/systemd/system/multi-user.target.wants");
    wants.children["unattended-upgrades.service"] = S.linkNode("/usr/lib/systemd/system/unattended-upgrades.service");
    try { M2.unitUp(sys, "unattended-upgrades.service", BOOT); } catch (e) { /* not fatal */ }
    M2.mkdirRoot(sys, "/var/log/unattended-upgrades", 488);
    recordSums(sys);
  });
  M4.recordSums = recordSums;
})(typeof window !== "undefined" ? window : globalThis);
