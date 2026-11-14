/* sudo learn — the Linux lab runner. Terminal-first: everything you type is kept as a history of commands.
   Each time you press Enter the whole history is replayed on a fresh copy of kc-web-01 (it's fast), so the
   machine's state always matches what you typed, and checks can re-run your exact commands on changed data. */
(function (root) {
  "use strict";
  var S = root.ShEngine;

  function freshMachine(opts) {
    var sys = S.makeSystem({ files: opts.files || {}, system: opts.system });
    var sess = S.newSession(sys);
    sys.topSession = sess;
    S.login(sess);
    (opts.prelude || "").split("\n").filter(function (l) { return l.trim(); }).forEach(function (l) { S.runLine(sess, l); });
    sess.histLines = [];
    return sess;
  }
  function commandsOf(code) { return String(code || "").replace(/\r/g, "").split("\n").filter(function (l) { return l.trim() !== ""; }); }
  function replay(code, opts) {
    var sess = freshMachine(opts);
    var entries = [];
    commandsOf(code).forEach(function (line) {
      var shell = S.activeShell(sess);
      var e = { cmd: line, prompt: S.prompt(shell), cwdBefore: shell.cwd, userBefore: shell.user };
      var res;
      sess.sys.cmdIndex = entries.length;   // lets simulators tag what each command did (the Networking diagram)
      if (sess.sys.lockedOut) { e.locked = true; res = { code: 255, lines: [{ text: "ssh: connect to host kc-web-01 port 22: Connection timed out", cls: "err" }, { text: "(You're locked out: the firewall now blocks SSH. Click Reset machine to start the lab's server again.)", cls: "sys" }] }; }
      else if (/^@edit!? /.test(line)) { res = editLine(sess, shell, line, e); }
      else try { res = S.runLine(sess, line); }
      catch (err) { res = { code: 1, lines: [{ text: "Internal error in the Linux simulator: " + (err && err.message || err), cls: "err" }] }; }
      var after = S.activeShell(sess);
      e.exit = res.code;
      e.lines = res.lines;
      e.clear = res.clear;
      e.out = res.lines.filter(function (l) { return l.cls !== "err" && l.cls !== "sys"; }).map(function (l) { return l.text; });
      e.err = res.lines.filter(function (l) { return l.cls === "err"; }).map(function (l) { return l.text; });
      e.cwd = after.cwd;
      e.user = after.user;
      entries.push(e);
    });
    return { sess: sess, entries: entries };
  }

  /* ---------------- the editor: "@edit PATH BASE64" lines are saves from the editor panel */
  function b64decode(t) {
    if (typeof Buffer !== "undefined" && typeof window === "undefined") return Buffer.from(t, "base64").toString("utf8");
    var bin = atob(t), bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }
  function parseEdit(line) {
    var m = /^@edit(!?) (\S+) ?(\S*)$/.exec(line);
    if (!m) return null;
    return { root: m[1] === "!", path: decodeURIComponent(m[2]), content: m[3] ? b64decode(m[3]) : "" };
  }
  function editLine(sess, shell, line, e) {
    var ed = parseEdit(line);
    var shown = (ed && ed.root ? "sudo nano " : "nano ") + (ed ? ed.path : "");
    sess.histLines.push(shown);
    e.shown = shown;
    e.edit = ed;
    if (!ed) return { code: 1, lines: [{ text: "nano: couldn't read the saved file", cls: "err" }] };
    var who = shell;
    if (ed.root) who = { sys: sess.sys, uid: 0, gid: 0, groups: [], cwd: shell.cwd, umask: 18, vars: {}, home: "/root", user: "root" };
    var err = S.writeFile(who, ed.path.replace(/^~(?=\/|$)/, shell.home), ed.content, false);
    if (err) return { code: 1, lines: [{ text: "[ Error writing " + ed.path + ": " + S.ERRTEXT[err] + " ]", cls: "err" }] };
    var n = ed.content === "" ? 0 : ed.content.replace(/\n$/, "").split("\n").length;
    return { code: 0, lines: [{ text: "[ Wrote " + n + " line" + (n === 1 ? "" : "s") + " to " + ed.path + " ]", cls: "sys" }] };
  }
  // What the editor panel opens: the file as it is after the commands so far.
  function readForEdit(code, opts, path, asRoot) {
    var run = replay(code, opts);
    var shell = S.activeShell(run.sess);
    if (asRoot) shell = { sys: run.sess.sys, uid: 0, gid: 0, groups: [], cwd: shell.cwd, umask: 18, vars: {}, home: shell.home, user: "root" };
    var p2 = path.replace(/^~(?=\/|$)/, shell.home);
    var abs = S.normAbs(p2.charAt(0) === "/" ? p2 : shell.cwd + "/" + p2);
    var r = S.lookup(shell, abs);
    if (r.node) {
      if (r.node.type === "d") return { error: path + " is a directory" };
      if (!S.can(shell, r.node, "r")) return { error: path + ": Permission denied (try sudo)" };
      return { ok: true, path: path, abs: abs, content: r.node.content, exists: true, writable: S.can(shell, r.node, "w") };
    }
    if (r.error === "ENOENT" && r.last && r.parent) return { ok: true, path: path, abs: abs, content: "", exists: false, writable: S.can(shell, r.parent, "w") };
    return { error: path + ": " + (S.ERRTEXT[r.error] || "can't open") };
  }

  // Reference solutions write files as "nano PATH" followed by the file's lines indented by 4 spaces. This turns
  // that readable form into the history the editor panel would produce ("@edit PATH BASE64").
  function b64encode(t) {
    if (typeof Buffer !== "undefined" && typeof window === "undefined") return Buffer.from(t, "utf8").toString("base64");
    var bytes = new TextEncoder().encode(t), bin = "";
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  }
  function solutionHistory(text) {
    var src = String(text || "").replace(/\r/g, "").split("\n"), outL = [];
    for (var i = 0; i < src.length; i++) {
      var m = /^\s*(sudo\s+)?nano\s+(\S+)\s*$/.exec(src[i]);
      if (!m || !(i + 1 < src.length && /^ {4}/.test(src[i + 1]))) { outL.push(src[i]); continue; }
      var body = [];
      while (i + 1 < src.length && (/^ {4}/.test(src[i + 1]) || (src[i + 1].trim() === "" && i + 2 < src.length && /^ {4}/.test(src[i + 2])))) { i++; body.push(src[i].slice(4)); }
      outL.push("@edit" + (m[1] ? "!" : "") + " " + encodeURIComponent(m[2]) + " " + b64encode(body.join("\n") + "\n"));
    }
    return outL.join("\n");
  }

  /* ---------------- check context */
  function makeCtx(code, opts, run) {
    var sess = run.sess, sys = sess.sys;
    var rootSess = { sys: sys, uid: 0, gid: 0, groups: [], cwd: "/", umask: 18, vars: {} };
    var shell = S.activeShell(sess);
    function abs(p) { return p.charAt(0) === "/" ? p : "/home/dev/" + p.replace(/^~\//, ""); }
    var r = {
      src: code, history: run.entries, sess: sess, sys: sys, shell: shell,
      cwd: shell.cwd, user: shell.user,
      cmds: run.entries.map(function (e) { return e.cmd; }),
      // file system, seen as root
      node: function (p) { var x = S.lookup(rootSess, abs(p.replace(/^~/, "/home/dev")), { nofollow: false }); return x.node || null; },
      exists: function (p) { return !!r.node(p); },
      isDir: function (p) { var n = r.node(p); return !!n && n.type === "d"; },
      isFile: function (p) { var n = r.node(p); return !!n && n.type === "f"; },
      read: function (p) { var n = r.node(p); return n && n.type === "f" ? n.content : null; },
      mode: function (p) { var n = r.node(p); return n ? (n.mode & 4095).toString(8) : null; },
      owner: function (p) { var n = r.node(p); return n ? S.uname(sys, n.uid) : null; },
      group: function (p) { var n = r.node(p); return n ? S.gname(sys, n.gid) : null; },
      list: function (p) { var n = r.node(p); return n && n.type === "d" ? Object.keys(n.children).sort() : []; },
      v: function (name) { return S.getVar(shell, name); },
      exported: function (name) { var x = shell.vars[name]; return !!x && x.x; },
      alias: function (name) { return shell.aliases[name]; },
      ran: function (re) { return run.entries.filter(function (e) { return re.test(e.cmd); }); },
      // replay the same commands on a changed machine (opts: files, system, prelude)
      run: function (newCode, o) {
        var opts2 = Object.assign({}, opts, o || {});
        if (o && o.files) opts2.files = Object.assign({}, opts.files || {}, o.files);
        var c = newCode === null || newCode === undefined ? code : newCode;
        return makeCtx(c, opts2, replay(c, opts2));
      },
      // run extra commands after the learner's, on the same machine state
      after: function (more) {
        var all = code + "\n" + more;
        var res = replay(all, opts);
        return makeCtx(all, opts, res);
      }
    };
    return r;
  }
  function runChecks(checks, r) {
    return checks.map(function (c) {
      var res;
      try { res = c.code(r); }
      catch (e) { return { id: c.id, pass: false, msg: "Couldn't check this task: " + (e && e.message || e) }; }
      return res === true ? { id: c.id, pass: true } : { id: c.id, pass: false, msg: typeof res === "string" ? res : "Not yet." };
    });
  }

  /* ---------------- check helpers */
  function norm(l) { return String(l).replace(/\s+/g, " ").trim(); }
  var H = {
    same: function (a, b) { return JSON.stringify(a) === JSON.stringify(b); },
    show: function (v) { return JSON.stringify(v); },
    norm: norm,
    // The index of the last command whose output equals want (array of lines). opts.norm: compare with collapsed spaces;
    // opts.anyOrder: compare as sets; opts.filter(entry): only consider some commands.
    outputIndex: function (r, want, o) {
      o = o || {};
      var w = want.map(o.norm ? norm : String);
      if (o.anyOrder) w = w.slice().sort();
      for (var i = r.history.length - 1; i >= 0; i--) {
        var e = r.history[i];
        if (o.filter && !o.filter(e)) continue;
        var got = e.out.map(o.norm ? norm : function (x) { return x.replace(/\s+$/, ""); });
        if (o.anyOrder) got = got.slice().sort();
        if (H.same(got, w)) return i;
      }
      return -1;
    },
    // Did a command print exactly want? And does the same command still print the right answer on changed data?
    // altOpts: {files|system} for r.run; wantFn(ctx) computes the expected lines for a context.
    proves: function (r, wantFn, altOpts, o) {
      var want = wantFn(r);
      var i = H.outputIndex(r, want, o);
      if (i < 0) return { ok: false, reason: "none" };
      if (!altOpts) return { ok: true, index: i };
      var r2 = r.run(null, altOpts);
      var want2 = wantFn(r2);
      var e2 = r2.history[i];
      if (!e2) return { ok: false, reason: "alt" };
      var got2 = e2.out.map(o && o.norm ? norm : function (x) { return x.replace(/\s+$/, ""); });
      var w2 = want2.map(o && o.norm ? norm : String);
      if (o && o.anyOrder) { got2 = got2.slice().sort(); w2 = w2.slice().sort(); }
      return H.same(got2, w2) ? { ok: true, index: i } : { ok: false, reason: "alt", index: i };
    },
    // Run a command (as dev, on the learner's final machine) and return its output lines: for computing expectations.
    eval: function (r, cmd, o) {
      var res = r.after(cmd);
      var e = res.history[res.history.length - 1];
      return e.out;
    },
    lines: function (text) { var l = String(text).split("\n"); if (l[l.length - 1] === "") l.pop(); return l; }
  };
  // Explanations printed under common errors, in plain words.
  var EXPLAIN = [
    [/Permission denied \(publickey/, "The server didn't accept any of your keys. Is your public key in the server's ~/.ssh/authorized_keys (ssh-copy-id puts it there)? ssh -v shows which keys were tried."],
    [/UNPROTECTED PRIVATE KEY FILE|bad permissions$/, "SSH refuses private keys that others can read. Fix it with chmod 600 on the key file."],
    [/Bad owner or permissions on/, "SSH refuses a config file that other people could change. chmod 600 ~/.ssh/config fixes it."],
    [/Host key verification failed/, "The server's key doesn't match the one saved in ~/.ssh/known_hosts. If the server was legitimately rebuilt, remove the old entry with ssh-keygen -R HOST; otherwise stop and ask why it changed."],
    [/kill.*Operation not permitted|killing pid .* failed/, "You can only signal (kill) your own processes. For another user's, use sudo."],
    [/Interactive authentication required/, "Starting, stopping and enabling services changes the whole server, so it needs root: put sudo in front, e.g. sudo systemctl restart nginx."],
    [/can be installed with:$/, "That program isn't installed. Ubuntu tells you which package has it: install it with the sudo apt install line it shows."],
    [/Could not open lock file|are you root\?/, "Installing and updating packages changes the whole server: run apt with sudo."],
    [/Couldn't connect to server|Connection refused$/, "Nothing is listening on that address and port. Is the service running (systemctl status)? Is it listening where you think (sudo ss -tlnp)?"],
    [/Could not resolve host|Name or service not known|Temporary failure in name resolution/, "That name doesn't resolve to an IP address. Check the spelling, /etc/hosts and DNS (dig NAME)."],
    [/test failed$/, "nginx found a mistake in its config: the line above says which file and line. Fix it, then run sudo nginx -t again before reloading."],
    [/errors in crontab file|missing newline before EOF/, "cron rejected the crontab. Each line needs five time fields (minute hour day-of-month month day-of-week), then the command, and the file must end with a newline."],
    [/^Job for .* failed/, "The service didn't start. Look at why: systemctl status UNIT shows the last log lines, journalctl -xeu UNIT shows more."],
    [/: command not found$/, "Bash doesn't know that command. Check the spelling (commands are lower-case), or run it with its path if it's a script in this folder: ./name"],
    [/Permission denied/, "You don't have permission for that. Check the owner and mode with ls -l. If it's a system file, you may need sudo (Module 1 lab 8)."],
    [/No such file or directory/, "That path doesn't exist from where you are. Check pwd, use ls to look around, and remember Linux names are case-sensitive."],
    [/Is a directory/, "That's a folder, not a file. Use ls to look inside it, or add -r for commands that copy or remove folders."],
    [/syntax error near unexpected token/, "Bash couldn't read the line: often a stray symbol, or quotes that don't match. Characters like | & ; < > ( ) mean something to the shell: put text with them in quotes."],
    [/invalid option|unrecognized option/, "That option doesn't exist for this command. Run the command with --help, or man <command>, to see its options."],
    [/missing operand|missing file operand/, "The command needs more arguments, e.g. a file name or a destination."],
    [/Operation not permitted/, "Only the owner (or root) can do that to this file."],
    [/is not in the sudoers file/, "This user isn't allowed to use sudo."]
  ];
  function explainFor(lines) {
    for (var i = 0; i < lines.length; i++) {
      if (lines[i].cls !== "err") continue;
      for (var k = 0; k < EXPLAIN.length; k++) if (EXPLAIN[k][0].test(lines[i].text)) return EXPLAIN[k][1];
    }
    return null;
  }

  /* ---------------- tab completion */
  function complete(code, opts, line) {
    var run = replay(code, opts);
    var shell = S.activeShell(run.sess);
    var m = /(\S*)$/.exec(line), word = m[1], before = line.slice(0, line.length - word.length);
    var first = !/\S/.test(before) || /[|;&]\s*$/.test(before);
    var cands = [];
    if (first && word.indexOf("/") < 0) {
      cands = S.cmdNames().concat(Object.keys(shell.aliases)).filter(function (n) { return n.indexOf(word) === 0 && /^[\w.-]+$/.test(n); });
      cands = cands.filter(function (c, i) { return cands.indexOf(c) === i; }).sort().map(function (c) { return c + " "; });
    } else {
      var w = word.replace(/^~(?=\/|$)/, shell.home);
      var dir = w.lastIndexOf("/") >= 0 ? w.slice(0, w.lastIndexOf("/") + 1) : "";
      var base = w.slice(dir.length);
      var r = S.lookup(shell, dir || ".");
      if (r.node && r.node.type === "d" && S.can(shell, r.node, "r")) {
        cands = Object.keys(r.node.children).filter(function (n) { return n.indexOf(base) === 0 && (base.charAt(0) === "." || n.charAt(0) !== "."); }).sort(S.sortNames).map(function (n) {
          var ch = r.node.children[n];
          var isDir = ch.type === "d" || (ch.type === "l" && (S.lookup(shell, (dir || "./") + n).node || {}).type === "d");
          return (word.slice(0, word.length - base.length)) + n.replace(/([\s'"\\$`&|;<>()])/g, "\\$1") + (isDir ? "/" : " ");
        });
      }
    }
    var common = cands.length ? cands.reduce(function (a, b) { var k = 0; while (k < a.length && a.charAt(k) === b.charAt(k)) k++; return a.slice(0, k); }) : word;
    return { line: before + (cands.length === 1 ? cands[0] : common.length > word.length ? common : word), options: cands.length > 1 ? cands.map(function (c) { return c.replace(/[ ]$/, "").split("/").filter(Boolean).pop() + (/\/$/.test(c) ? "/" : ""); }) : [] };
  }

  function handle(msg) {
    var opts = { files: msg.files || {}, prelude: msg.prelude || "", system: msg.system };
    if (msg.type === "complete") return complete(msg.code, opts, msg.line || "");
    if (msg.type === "read") return readForEdit(msg.code, opts, msg.path || "", msg.root);
    var run;
    try { run = replay(msg.code, opts); }
    catch (e) { return { internal: "the Linux simulator crashed: " + (e && e.stack || e) }; }
    var from = msg.printFrom || 0;
    var parts = [], cleared = false;
    run.entries.forEach(function (e, i) {
      if (i < from) return;
      if (e.clear) { parts = []; cleared = true; }
      else parts.push({ text: e.prompt + "\u0001" + (e.shown || e.cmd), cls: "cmd" });
      e.lines.forEach(function (l) { parts.push({ text: l.text, cls: l.cls }); });
      if (i === run.entries.length - 1) { var ex = explainFor(e.lines); if (ex) parts.push({ text: ex, cls: "explain" }); }
    });
    var r = makeCtx(msg.code, opts, run);
    var results = runChecks(msg.checks || [], r);
    var last = run.entries[run.entries.length - 1];
    return { parts: parts, results: results, prompt: S.prompt(S.activeShell(run.sess)), clear: cleared, exit: { code: last ? last.exit : 0, exited: false }, count: run.entries.length, sys: run.sess.sys };
  }

  var runner = {
    ready: false,
    start: function (hooks) { this.ready = true; hooks.setStatus("ok", "kc-web-01 · Ubuntu 24.04 (simulated)"); hooks.enableRun(); },
    call: function (msg) { return new Promise(function (res) { setTimeout(function () { res(handle(msg)); }, 0); }); }
  };
  var api = { EXPLAIN: EXPLAIN, handle: handle, runner: runner, H: H, replay: replay, makeCtx: makeCtx, commandsOf: commandsOf, complete: complete, readForEdit: readForEdit, parseEdit: parseEdit, solutionHistory: solutionHistory, b64encode: b64encode, prompt: function () { return "dev@kc-web-01:~$"; } };
  root.ShLab = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
