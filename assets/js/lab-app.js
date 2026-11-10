/* sudo learn — lab page UI shared by every track: editor, console, tasks, drills, capstones, XP and completion.
   A track page can set window.LAB_CONFIG before loading this file; without it, the Python defaults apply
   (Pyodide runner in py-worker.js). LAB_CONFIG: { track, data, mode, runMode, file, drillFile, cmd, lang,
   runner: {start(hooks), ready, call(msg, timeout) -> Promise(result)}, explain: {type: text}, explainFn(err), isCode: RegExp } */
(function () {
  "use strict";

  var CFG = window.LAB_CONFIG || {};
  var TRACK = CFG.track || "python";
  var T = CFG.data || window.PY_TRACK;
  var LABS = T.LABS;
  var MODE = CFG.mode || { name: "python", version: 3 };
  var RUN_MODE = CFG.runMode || "python";
  var FILE = CFG.file || "main.py";
  var DRILL_FILE = CFG.drillFile || "drill.py";
  var CMD = CFG.cmd || "python";
  var LANG = CFG.lang || "Python";
  var RUN_TIMEOUT = 8000;
  var HINT_COST = 10;
  var QUIZ_XP = 10;
  var DRILL_XP = 5;

  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
  function labById(id) { for (var i = 0; i < LABS.length; i++) if (LABS[i].id === id) return LABS[i]; return null; }

  /* ---------------------------------------------------------------- Python runner (default) */
  var runner = CFG.runner || {
    start: function () {
      var self = this;
      this.ready = false;
      this.pending = {};
      this.seq = this.seq || 0;
      this.readyP = new Promise(function (res, rej) { self._res = res; self._rej = rej; });
      this.readyP.catch(function () {});
      try {
        this.worker = new Worker("py-worker.js");
      } catch (e) {
        setStatus("err", "This browser can't start the Python engine.");
        this._rej(e);
        return;
      }
      this.worker.onmessage = function (e) {
        var m = e.data;
        if (m.type === "ready") {
          self.ready = true;
          self.version = m.python;
          setStatus("ok", "Python " + m.python + " ready");
          $("runBtn").disabled = false;
          self._res(m);
        } else if (m.type === "fatal") {
          setStatus("err", "Python failed to load. Check your connection and reload.");
          self._rej(m.error);
        } else if (m.type === "result") {
          var p = self.pending[m.id];
          if (p) { delete self.pending[m.id]; clearTimeout(p.timer); p.res(m.data); }
        } else if (m.type === "loading") {
          // A package download isn't the learner's code running, so pause the timeout meanwhile.
          var pl = self.pending[m.id];
          if (pl) clearTimeout(pl.timer);
          setStatus("busy", m.text);
          print("⬇ " + m.text, "sys");
        } else if (m.type === "loaded") {
          var pd = self.pending[m.id];
          if (pd) pd.timer = setTimeout(pd.fire, pd.timeout);
          setStatus("ok", "Python " + self.version + " ready");
        }
      };
      this.worker.onerror = function () {
        setStatus("err", "Python failed to load. Check your connection and reload.");
        self._rej(new Error("worker error"));
      };
    },
    call: function (msg, timeout) {
      var self = this;
      return this.readyP.then(function () {
        return new Promise(function (res) {
          var id = ++self.seq;
          msg.id = id;
          var fire = function () {
            delete self.pending[id];
            self.worker.terminate();
            setStatus("busy", "Restarting Python…");
            $("runBtn").disabled = true;
            self.start();
            res({ timeout: true });
          };
          var ms = timeout || RUN_TIMEOUT;
          self.pending[id] = { res: res, fire: fire, timeout: ms, timer: setTimeout(fire, ms) };
          self.worker.postMessage(msg);
        });
      }, function (err) { return { internal: "Python isn't available: " + err }; });
    }
  };

  function setStatus(kind, text) {
    var el = $("pyStatus");
    el.className = "status" + (kind === "ok" ? " ok" : kind === "err" ? " err" : "");
    el.lastChild.textContent = text;
  }

  /* ---------------------------------------------------------------- State */
  var state = { lab: null, results: null, running: false, drill: null, drillResult: null };

  function prog(lab) { return SL.lab(TRACK, (lab || state.lab).id); }
  function codeKey() { return state.drill ? state.lab.id + "~" + state.drill.id : state.lab.id; }
  function hintsUsed(p) {
    var n = 0, h = p.hints || {};
    for (var k in h) n += h[k];
    return n;
  }
  function quizXP(p) {
    var n = 0, q = p.quiz || {};
    for (var k in q) if (q[k]) n += QUIZ_XP;
    return n;
  }
  function drillXP(p) {
    var n = 0, d = p.drills || {};
    for (var k in d) if (d[k].done && !d[k].revealed) n += DRILL_XP;
    return n;
  }
  function labXP(lab, p) {
    if (lab.capstone) return p.revealed ? lab.xp / 2 : lab.xp;
    return Math.max(lab.xp / 2, lab.xp - HINT_COST * hintsUsed(p));
  }
  function saveXP(lab) {
    var p = prog(lab);
    SL.setLab(TRACK, lab.id, { xp: (p.done ? labXP(lab, p) + quizXP(p) : 0) + drillXP(p) });
    renderXP();
  }

  function renderXP() {
    var xp = SL.totalXP();
    var r = SL.rank(xp);
    $("xpBox").innerHTML = "rank <b>" + r.name + "</b> · <b>" + xp + "</b> XP";
  }

  /* ---------------------------------------------------------------- Editor */
  var editor = CodeMirror.fromTextArea($("code"), {
    mode: MODE,
    lineNumbers: true,
    indentUnit: 4,
    tabSize: 4,
    indentWithTabs: false,
    matchBrackets: true,
    autofocus: false,
    extraKeys: {
      "Tab": function (cm) {
        if (cm.somethingSelected()) cm.indentSelection("add");
        else cm.replaceSelection("    ", "end");
      },
      "Shift-Tab": function (cm) { cm.indentSelection("subtract"); },
      "Ctrl-Enter": function () { runCode(); },
      "Cmd-Enter": function () { runCode(); }
    }
  });
  var errLine = null;
  var loading = false;
  editor.on("change", function () {
    clearErrLine();
    if (!state.lab || loading) return;
    SL.setCode(TRACK, codeKey(), editor.getValue());
  });
  function setEditor(code) {
    loading = true;
    editor.setValue(code);
    editor.clearHistory();
    loading = false;
    clearErrLine();
  }
  function clearErrLine() {
    if (errLine != null) { editor.removeLineClass(errLine, "background", "cm-errline"); errLine = null; }
  }
  function highlight(root) {
    Array.prototype.forEach.call(root.querySelectorAll("pre[data-hl]"), function (pre) {
      pre.classList.add("cm-s-default");
      CodeMirror.runMode(pre.textContent, RUN_MODE, pre);
      pre.removeAttribute("data-hl");
    });
  }
  function copyText(text, btn) {
    function done() { var t = btn.textContent; btn.textContent = "Copied ✓"; setTimeout(function () { btn.textContent = t; }, 1400); }
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, function () {});
    else {
      var ta = document.createElement("textarea");
      ta.value = text; document.body.appendChild(ta); ta.select();
      try { document.execCommand("copy"); done(); } catch (e) { /* ignore */ }
      document.body.removeChild(ta);
    }
  }

  /* ---------------------------------------------------------------- Console */
  var out = $("out");
  function print(text, cls) {
    var d = document.createElement("div");
    if (cls) d.className = cls;
    d.textContent = text;
    out.appendChild(d);
    out.scrollTop = out.scrollHeight;
    return d;
  }
  var EXPLAIN = {
    NameError: "Python doesn't know that name. Check the spelling (capitals matter), and make sure the variable is created before the line that uses it.",
    SyntaxError: "Python couldn't read this line. Look for a missing colon, quote or bracket near the ^ mark, or at the end of the line before it.",
    IndentationError: "The indentation is off. Lines inside an if, for, while or def need 4 more spaces than the line with the colon.",
    TabError: "Tabs and spaces are mixed. Use 4 spaces for each level of indentation.",
    TypeError: "A value has the wrong type for this operation, e.g. adding text and a number (\"port \" + 22). Convert with str() or int(), or check how many arguments you passed.",
    ValueError: "The type is right but the value can't be used, e.g. int(\"http\").",
    KeyError: "That key isn't in the dictionary. Use .get(key, default) if it might be missing.",
    IndexError: "That position doesn't exist in the list or string. Indexes start at 0, so the last item of a 3-item list is [2].",
    ZeroDivisionError: "Something was divided by zero.",
    AttributeError: "That value doesn't have that method. Check the spelling, and check what type the value really is with type(x).",
    FileNotFoundError: "That file doesn't exist, or the path is wrong.",
    EOFError: "input() wanted a value, but the Input box ran out of lines. Add a line there.",
    UnboundLocalError: "A variable was used inside a function before it was given a value there.",
    RecursionError: "A function kept calling itself without ever stopping.",
    HTTPError: "The server answered with an error status (4xx or 5xx). raise_for_status() turned it into this exception. Check the URL, and send the Authorization header.",
    ConnectionError: "The request never reached a server. Check the host name in the URL.",
    AssertionError: "An assert statement was False. In a test, that means the code under test didn't do what the test expected.",
    UnicodeDecodeError: "These bytes aren't text. Open the file in binary mode (\"rb\") if you only need its bytes, e.g. to hash it."
  };
  Object.keys(CFG.explain || {}).forEach(function (k) { EXPLAIN[k] = CFG.explain[k]; });
  function explainError(err) {
    var ex = (CFG.explainFn && CFG.explainFn(err)) || EXPLAIN[err.type];
    if (ex) print("What this means: " + ex, "explain");
  }
  function printError(err) {
    print(err.text, "err");
    explainError(err);
  }
  $("clearBtn").addEventListener("click", function () { out.innerHTML = ""; });

  /* ---------------------------------------------------------------- Sidebar */
  function renderSide() {
    var done = SL.trackDone(TRACK);
    var total = LABS.length + T.UPCOMING.length;
    var html = '<div class="tp"><small>' + done + " / " + total + ' labs complete</small><div class="bar"><i style="width:' +
      Math.round((done / total) * 100) + '%"></i></div></div>';
    T.MODULES.forEach(function (m) {
      html += "<h4>Module " + m.n + " · " + m.name + "</h4>";
      LABS.filter(function (l) { return l.module === m.n; }).forEach(function (l) {
        var p = prog(l);
        var cls = "lab" + (l.capstone ? " cap" : "") + (p.done ? " done" : p.started ? " started" : "") + (state.lab && state.lab.id === l.id ? " active" : "");
        html += '<button class="' + cls + '" data-lab="' + l.id + '"><span class="dot">' + (p.done ? "✓" : l.capstone ? "★" : "") +
          '</span><span class="nm">' + esc(l.title) + "<small>" + esc(l.topic) + "</small></span></button>";
      });
      T.UPCOMING.filter(function (l) { return l.module === m.n; }).forEach(function (l) {
        html += '<div class="lab locked' + (l.capstone ? " cap" : "") + '" title="Coming soon"><span class="dot">' + (l.capstone ? "★" : "") +
          '</span><span class="nm">' + esc(l.title) + "<small>" + esc(l.topic) + " · soon</small></span></div>";
      });
    });
    $("side").innerHTML = html;
  }
  $("side").addEventListener("click", function (e) {
    var b = e.target.closest("button[data-lab]");
    if (!b) return;
    if (location.hash.slice(1) === b.getAttribute("data-lab")) loadLab(b.getAttribute("data-lab"));
    else location.hash = b.getAttribute("data-lab");
    document.body.classList.remove("nav-open");
  });
  $("menuBtn").addEventListener("click", function () {
    var open = document.body.classList.toggle("nav-open");
    this.setAttribute("aria-expanded", open ? "true" : "false");
  });
  $("scrim").addEventListener("click", function () { document.body.classList.remove("nav-open"); });

  /* ---------------------------------------------------------------- Learn tab */
  function renderLearn(lab) {
    var el = $("panelLearn");
    el.innerHTML = lab.learn + '<div class="next-step"><button class="btn primary" id="toTasks">' +
      (lab.capstone ? "Start the project →" : "Got it, show my tasks →") + "</button></div>";
    Array.prototype.forEach.call(el.querySelectorAll("pre.ex"), function (pre) {
      var code = pre.textContent;
      pre.classList.add("cm-s-default");
      CodeMirror.runMode(code, RUN_MODE, pre);
      var b = document.createElement("button");
      b.className = "try";
      b.type = "button";
      b.textContent = "▶ try";
      b.title = "Run this in the console";
      b.addEventListener("click", function () { runRepl(code); });
      pre.appendChild(b);
    });
    $("toTasks").addEventListener("click", function () { showTab("tasks"); $("brief").scrollTop = 0; });
  }

  /* ---------------------------------------------------------------- Tasks tab */
  function isCode(h) { return /\n/.test(h) || (CFG.isCode || /^(def |for |if |elif |else|while |print\(|[\w\[\], ]+ ?[+\-]?= )/).test(h); }

  function renderTasks() {
    if (state.drill) return renderDrill();
    var lab = state.lab, p = prog(), passed = {};
    if (state.results) state.results.forEach(function (r) { passed[r.id] = r; });
    var html = "";
    if (p.done) {
      html += '<div class="done-banner"><span>✓ ' + (lab.capstone ? "Capstone complete" : "Ticket closed") + " · <b>" + labXP(lab, p) + " XP</b></span>" +
        '<button class="btn small" id="reviewBtn">Debrief &amp; quiz</button></div>';
    }
    html += '<ol class="objectives">';
    var nPass = 0;
    lab.objectives.forEach(function (o) {
      var r = passed[o.id];
      var ok = r ? r.pass : (!state.results && p.done) || (!state.results && (p.passed || []).indexOf(o.id) >= 0);
      if (ok) nPass++;
      var cls = "objective" + (ok ? " pass" : r ? " fail" : "");
      var used = (p.hints || {})[o.id] || 0;
      html += '<li class="' + cls + '"><span class="tick"></span><div class="txt">' + o.text + "</div>";
      if (r && !r.pass && r.msg) html += '<div class="fb">' + esc(r.msg) + "</div>";
      if (used || (!ok && o.hints.length)) {
        html += '<div class="hints">';
        for (var i = 0; i < used && i < o.hints.length; i++) {
          var h = o.hints[i];
          html += '<div class="hint">' + (isCode(h) ? "<pre>" + esc(h) + "</pre>" : esc(h)) + "</div>";
        }
        if (used < o.hints.length && !ok) {
          var cost = p.done ? "free" : "−" + HINT_COST + " XP";
          html += '<button class="hintbtn" data-hint="' + o.id + '">' + (used ? "Show the answer" : "Need a hint?") + " (" + cost + ")</button>";
        }
        html += "</div>";
      }
      html += "</li>";
    });
    html += "</ol>";

    if (lab.capstone) {
      html += '<div class="solbox"><h3 class="sub">Reference solution</h3>';
      if (p.done || p.revealed) {
        html += "<p>" + (p.done ? "Compare it with yours. There's more than one right way to solve this." : "Revealed. This capstone now earns half XP.") + "</p>" +
          '<pre class="code" data-hl>' + esc(lab.solution) + '</pre><button class="btn small" id="copySol">Copy</button>';
      } else {
        html += "<p>Capstones have no hints. If you're really stuck, you can reveal the full solution, but the capstone then earns half XP (" + lab.xp / 2 + " instead of " + lab.xp + ").</p>" +
          '<button class="btn small" id="revealSol">Reveal solution</button>';
      }
      html += "</div>";
    } else {
      html += '<p class="tasks-foot">' + (state.results ? "Checked on your last run." : "Press <b>Run</b> to check your code against these tasks.") +
        " Hints cost " + HINT_COST + " XP each until the ticket is closed.</p>";
      if (p.done && lab.solution) {
        html += '<details class="ref"><summary>Compare with a reference solution</summary><pre class="code" data-hl>' + esc(lab.solution) + "</pre></details>";
      }
    }

    if (lab.drills && lab.drills.length) {
      var dp = p.drills || {};
      var nd = 0;
      lab.drills.forEach(function (d) { if (dp[d.id] && dp[d.id].done) nd++; });
      html += '<h3 class="sub">Practice drills <span>optional · +' + DRILL_XP + " XP each · " + nd + "/" + lab.drills.length + " done</span></h3>" +
        '<p class="tasks-foot" style="margin-top:0">Short extra exercises on the same idea. Repetition is what makes it stick.</p><div class="drills">';
      lab.drills.forEach(function (d, i) {
        var s = dp[d.id] || {};
        html += '<button class="drill' + (s.done ? " done" : "") + '" data-drill="' + d.id + '"><span class="dot">' + (s.done ? "✓" : i + 1) +
          '</span><span class="dn">' + esc(d.title) + "</span><span class=\"go\">" + (s.done ? "Redo" : "Start") + " →</span></button>";
      });
      html += "</div>";
    }

    $("panelTasks").innerHTML = html;
    highlight($("panelTasks"));
    var badge = $("taskBadge");
    badge.textContent = nPass + "/" + lab.objectives.length;
    badge.className = "badge" + (nPass === lab.objectives.length ? " all" : "");
    var rb = $("reviewBtn");
    if (rb) rb.addEventListener("click", function () { openModal(false); });
    var cs = $("copySol");
    if (cs) cs.addEventListener("click", function () { copyText(lab.solution, cs); });
    var rv = $("revealSol");
    if (rv) rv.addEventListener("click", function () {
      if (!confirm("Reveal the full solution? This capstone will then earn half XP.")) return;
      SL.setLab(TRACK, lab.id, { revealed: true, started: true });
      saveXP(lab);
      renderTasks();
    });
  }

  function renderDrill() {
    var lab = state.lab, d = state.drill, p = prog();
    var s = (p.drills || {})[d.id] || {};
    var idx = lab.drills.indexOf(d);
    var r = state.drillResult;
    var html = '<div class="drill-banner">' +
      '<div class="dh"><span class="pill amber">Drill ' + (idx + 1) + " of " + lab.drills.length + "</span><b>" + esc(d.title) + "</b>" +
      (s.done ? '<span class="pill green">done</span>' : "") + "</div>" +
      '<div class="dt">' + d.text + "</div>";
    if (r) html += r.pass ? '<div class="dok">✓ Correct!' + (s.revealed ? " (solution was revealed, so no XP)" : " +" + DRILL_XP + " XP") + "</div>"
      : '<div class="fb">' + esc(r.msg || "Not yet. Check the task and run again.") + "</div>";
    html += '<div class="dbtns"><button class="btn small ghost" id="backTicket">← Back to the ticket</button>';
    var next = lab.drills[idx + 1];
    if (next && s.done) html += '<button class="btn small primary" data-drill="' + next.id + '">Next drill →</button>';
    if (!s.revealed && !s.done) html += '<button class="btn small ghost" id="showDrillSol">Show solution (no XP)</button>';
    html += "</div>";
    if (s.revealed || s.done) html += '<pre class="code" data-hl>' + esc(d.solution) + "</pre>";
    html += "</div>";
    $("panelTasks").innerHTML = html;
    highlight($("panelTasks"));
    $("backTicket").addEventListener("click", exitDrill);
    var sb = $("showDrillSol");
    if (sb) sb.addEventListener("click", function () {
      var dr = prog().drills || {};
      dr[d.id] = Object.assign(dr[d.id] || {}, { revealed: true });
      SL.setLab(TRACK, lab.id, { drills: dr });
      renderDrill();
    });
  }

  $("panelTasks").addEventListener("click", function (e) {
    var b = e.target.closest("[data-hint]");
    if (b) {
      var id = b.getAttribute("data-hint");
      var p = prog();
      var hints = p.hints || {};
      hints[id] = (hints[id] || 0) + 1;
      SL.setLab(TRACK, state.lab.id, { hints: hints, started: true });
      renderTasks();
      renderSide();
      return;
    }
    var dEl = e.target.closest("[data-drill]");
    if (dEl) loadDrill(dEl.getAttribute("data-drill"));
  });

  function showTab(name) {
    var learn = name === "learn";
    $("tabLearn").setAttribute("aria-selected", learn ? "true" : "false");
    $("tabTasks").setAttribute("aria-selected", learn ? "false" : "true");
    $("panelLearn").hidden = !learn;
    $("panelTasks").hidden = learn;
  }
  $("tabLearn").addEventListener("click", function () { showTab("learn"); });
  $("tabTasks").addEventListener("click", function () { showTab("tasks"); });

  /* ---------------------------------------------------------------- Drills */
  function loadDrill(id) {
    var d = null;
    state.lab.drills.forEach(function (x) { if (x.id === id) d = x; });
    if (!d) return;
    state.drill = d;
    state.drillResult = null;
    var saved = SL.getCode(TRACK, codeKey());
    setEditor(saved != null ? saved : d.starter + "\n");
    $("fname").textContent = DRILL_FILE;
    $("stdinBox").hidden = true;
    setProcessBoxes(d, DRILL_FILE);
    out.innerHTML = "";
    print("# Drill: " + d.title + ". Write your code above, then press Run.", "sys");
    renderTasks();
    showTab("tasks");
    $("brief").scrollTop = 0;
  }
  function exitDrill() {
    state.drill = null;
    state.drillResult = null;
    var lab = state.lab;
    var saved = SL.getCode(TRACK, lab.id);
    setEditor(saved != null ? saved : lab.starter + "\n");
    $("fname").textContent = FILE;
    $("stdinBox").hidden = lab.stdin == null;
    setProcessBoxes(lab, FILE);
    out.innerHTML = "";
    print("# Back to " + lab.ticket + ". Press Run to re-check your tasks.", "sys");
    renderTasks();
  }

  /* ---------------------------------------------------------------- Load a lab */
  function loadLab(id) {
    var lab = labById(id) || firstOpenLab();
    state.lab = lab;
    state.results = null;
    state.drill = null;
    state.drillResult = null;
    var p = prog();
    document.title = lab.ticket + " " + lab.title + " · sudo learn";
    $("tTicket").textContent = lab.capstone ? "★ " + lab.ticket + " · CAPSTONE" : lab.ticket;
    $("tTopic").textContent = lab.topic;
    $("tTitle").textContent = lab.title;
    $("tFrom").textContent = lab.from;
    $("tStory").innerHTML = lab.story;
    $("tabLearn").firstChild.textContent = lab.capstone ? "1 · Brief" : "1 · Learn";
    $("fname").textContent = FILE;
    renderLearn(lab);
    renderTasks();
    renderSide();
    var saved = SL.getCode(TRACK, lab.id);
    setEditor(saved != null ? saved : lab.starter + "\n");
    $("stdinBox").hidden = lab.stdin == null;
    $("stdin").value = lab.stdin || "";
    setProcessBoxes(lab, FILE);
    out.innerHTML = "";
    print("# " + lab.ticket + " · " + lab.title + (/[.?!]$/.test(lab.title) ? "" : ".") + " Write your code above, then press Run.", "sys");
    showTab(p.started || p.done ? "tasks" : "learn");
    $("brief").scrollTop = 0;
    closeModal();
  }
  function firstOpenLab() {
    for (var i = 0; i < LABS.length; i++) if (!prog(LABS[i]).done) return LABS[i];
    return LABS[0];
  }
  function route() { loadLab(location.hash.slice(1)); }
  window.addEventListener("hashchange", route);

  $("resetCode").addEventListener("click", function () {
    if (!confirm("Replace your code with the starter code?")) return;
    var starter = state.drill ? state.drill.starter : state.lab.starter;
    setEditor(starter + "\n");
    SL.setCode(TRACK, codeKey(), null);
  });

  /* ---------------------------------------------------------------- Run */
  // Labs and drills can set argv (a string, shown in the Arguments box) and env (an object, shown in the
  // Environment box). The learner can edit both before pressing Run, like typing in a terminal.
  function setProcessBoxes(src, script) {
    $("argScript").textContent = script;
    $("argsBox").hidden = src.argv == null;
    $("args").value = src.argv || "";
    $("envBox").hidden = src.env == null;
    $("env").value = Object.keys(src.env || {}).map(function (k) { return k + "=" + src.env[k]; }).join("\n");
  }
  function envVars() {
    var env = {};
    $("env").value.replace(/\r/g, "").split("\n").forEach(function (line) {
      var i = line.indexOf("=");
      var name = (i < 0 ? line : line.slice(0, i)).trim();
      if (name) env[name] = i < 0 ? "" : line.slice(i + 1);
    });
    return env;
  }
  function stdinLines() {
    var v = $("stdin").value.replace(/\r/g, "");
    if (!v) return [];
    var lines = v.split("\n");
    while (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
    return lines;
  }

  function runCode() {
    if (state.running || !runner.ready) return;
    var lab = state.lab, d = state.drill;
    var code = editor.getValue();
    SL.setCode(TRACK, codeKey(), code);
    state.running = true;
    $("runBtn").disabled = true;
    clearErrLine();
    var src = d || lab;
    var script = d ? DRILL_FILE : FILE;
    var argv = src.argv != null ? $("args").value.trim() : "";
    print("▶ " + CMD + " " + script + (argv ? " " + argv : ""), "run-sep");
    var msg = {
      type: "run",
      code: code,
      prelude: src.prelude || "",
      packages: src.packages || [],
      script: script,
      argv: argv,
      env: src.env != null ? envVars() : {},
      stdin: !d && lab.stdin != null ? stdinLines() : [],
      files: src.files || {},
      removeFiles: src.removeFiles || [],
      checks: d ? [{ id: d.id, code: d.check }] : lab.objectives.map(function (o) { return { id: o.id, code: o.check }; })
    };
    runner.call(msg, RUN_TIMEOUT).then(function (res) {
      state.running = false;
      if (res.timeout) {
        print("⏱ Your code ran for " + RUN_TIMEOUT / 1000 + " seconds without finishing, so it was stopped. " +
          "This is usually an infinite loop: a loop whose condition never becomes false.", "err");
        return;
      }
      $("runBtn").disabled = false;
      if (res.internal) { print("Internal error: " + res.internal, "err"); return; }
      if (res.parts) res.parts.forEach(function (pt) { print(pt.text, pt.cls); });
      else if (res.out) print(res.out.replace(/\n$/, ""));
      if (res.error) {
        if (res.parts) explainError(res.error); else printError(res.error);
        if (res.error.line && res.error.line <= editor.lineCount()) {
          errLine = res.error.line - 1;
          editor.addLineClass(errLine, "background", "cm-errline");
        }
      } else if (!res.out && !(res.parts && res.parts.length)) {
        print("(no output)", "sys");
      }
      // Command-line labs care about the exit code, as a CI system would. Elsewhere, only show it after sys.exit().
      var ex = res.exit;
      if (ex && (ex.exited || src.argv != null || src.env != null || src.showExit)) {
        print("↳ exit code " + ex.code + (ex.code === 0 ? " (success)" : " (failure)"), ex.code === 0 ? "exit" : "exit bad");
      }
      if (state.drill !== d || state.lab !== lab) return; // switched away while running
      if (d) afterDrill(res.results || []);
      else afterRun(res.results || []);
    });
  }
  $("runBtn").addEventListener("click", runCode);
  $("args").addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); runCode(); } });

  function afterRun(results) {
    var lab = state.lab;
    state.results = results;
    var p = prog();
    var passedNow = results.filter(function (r) { return r.pass; }).map(function (r) { return r.id; });
    var passed = (p.passed || []).slice();
    passedNow.forEach(function (id) { if (passed.indexOf(id) < 0) passed.push(id); });
    SL.setLab(TRACK, lab.id, { started: true, passed: passed });
    var n = passedNow.length, total = lab.objectives.length;
    print(n === total ? "✓ All " + total + " tasks passing" : "• " + n + " of " + total + " tasks passing", n === total ? "ok" : "sys");
    renderTasks();
    showTab("tasks");
    renderSide();
    if (n === total && !p.done) complete();
  }

  function afterDrill(results) {
    var lab = state.lab, d = state.drill;
    var r = results[0] || { pass: false, msg: "" };
    state.drillResult = r;
    if (r.pass) {
      var dr = prog().drills || {};
      dr[d.id] = Object.assign(dr[d.id] || {}, { done: true });
      SL.setLab(TRACK, lab.id, { drills: dr, started: true });
      saveXP(lab);
      print("✓ Drill complete", "ok");
    } else {
      print("• Not yet. See the feedback above the code.", "sys");
    }
    renderTasks();
    showTab("tasks");
    renderSide();
  }

  /* ---------------------------------------------------------------- REPL */
  var replHist = [], replPos = 0;
  function runRepl(code) {
    var lines = code.replace(/\n+$/, "").split("\n");
    lines.forEach(function (l, i) {
      if (i === 0) print(l, "in");
      else print("... " + l, "sys");
    });
    if (!runner.ready) { print(LANG + " is still loading. Try again in a moment.", "sys"); return; }
    var src = state.drill || state.lab;
    runner.call({ type: "repl", code: code, prelude: src.prelude || "", packages: src.packages || [], files: src.files || {}, removeFiles: src.removeFiles || [] }, RUN_TIMEOUT).then(function (res) {
      if (res.timeout) { print("⏱ Stopped after " + RUN_TIMEOUT / 1000 + " seconds (infinite loop?).", "err"); return; }
      if (res.internal) { print("Internal error: " + res.internal, "err"); return; }
      if (res.parts) res.parts.forEach(function (pt) { print(pt.text, pt.cls); });
      else if (res.out) print(res.out.replace(/\n$/, ""));
      if (res.error) { if (res.parts) explainError(res.error); else printError(res.error); }
    });
  }
  $("replForm").addEventListener("submit", function (e) {
    e.preventDefault();
    var input = $("repl");
    var code = input.value;
    if (!code.trim()) return;
    replHist.push(code);
    replPos = replHist.length;
    input.value = "";
    runRepl(code);
  });
  $("repl").addEventListener("keydown", function (e) {
    if (e.key === "ArrowUp" && replPos > 0) { replPos--; this.value = replHist[replPos]; e.preventDefault(); }
    else if (e.key === "ArrowDown") {
      if (replPos < replHist.length - 1) { replPos++; this.value = replHist[replPos]; }
      else { replPos = replHist.length; this.value = ""; }
      e.preventDefault();
    }
  });

  /* ---------------------------------------------------------------- Completion */
  function complete() {
    var lab = state.lab;
    SL.setLab(TRACK, lab.id, { done: true, doneAt: Date.now() });
    saveXP(lab);
    renderSide();
    renderTasks();
    setTimeout(function () { openModal(true); }, 350);
  }

  function nextLab() {
    var i = LABS.indexOf(state.lab);
    return LABS[i + 1] || null;
  }

  function xpLine(lab, p) {
    var extra = "";
    if (lab.capstone) extra = p.revealed ? "(solution revealed)" : "· solved on your own";
    else {
      var used = hintsUsed(p);
      extra = used ? "(" + used + " hint" + (used > 1 ? "s" : "") + " used)" : "· no hints used";
    }
    return "+" + labXP(lab, p) + " XP <span>" + extra + "</span>" + (quizXP(p) ? " +" + quizXP(p) + " quiz XP" : "");
  }

  function openModal(fresh) {
    var lab = state.lab, p = prog();
    $("mStamp").textContent = lab.capstone ? "CAPSTONE COMPLETE" : "TICKET CLOSED";
    $("mTitle").textContent = lab.ticket + " · " + lab.title;
    $("mXP").innerHTML = xpLine(lab, p);
    $("mDebrief").innerHTML = lab.debrief;
    $("mReal").innerHTML = lab.realworld ? "<b>Try it for real:</b> " + lab.realworld : "";
    $("mReal").hidden = !lab.realworld;
    renderQuiz(lab);
    var nx = nextLab();
    $("mNext").textContent = nx ? "Next: " + nx.ticket + " →" : "Back to all tracks →";
    $("modal").hidden = false;
    $("modal").querySelector(".dialog").scrollTop = 0;
    if (fresh) $("mNext").focus();
  }
  function closeModal() { $("modal").hidden = true; }
  $("mStay").addEventListener("click", closeModal);
  $("modal").addEventListener("click", function (e) { if (e.target === this) closeModal(); });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && !$("modal").hidden) closeModal(); });
  $("mNext").addEventListener("click", function () {
    var nx = nextLab();
    closeModal();
    if (nx) location.hash = nx.id;
    else location.href = "../";
  });

  function renderQuiz(lab) {
    var p = prog();
    var answers = p.quiz || {};
    if (!lab.quiz || !lab.quiz.length) { $("mQuiz").innerHTML = ""; return; }
    var html = "<h3>Quick check</h3><p class=\"qhint\">+" + QUIZ_XP + " XP for each one you get right on the first try.</p>";
    lab.quiz.forEach(function (q, qi) {
      var answered = answers.hasOwnProperty(qi);
      html += '<div class="q" data-q="' + qi + '"><div class="qt">' + (qi + 1) + ". " + q.q + '</div><div class="opts">';
      q.options.forEach(function (o, oi) {
        var cls = answered && oi === q.answer ? "right" : "";
        html += '<button data-o="' + oi + '" class="' + cls + '"' + (answered ? " disabled" : "") + ">" + esc(o) + "</button>";
      });
      html += "</div>" + (answered ? '<div class="why">' + esc(q.why) + "</div>" : "") + "</div>";
    });
    $("mQuiz").innerHTML = html;
  }
  $("mQuiz").addEventListener("click", function (e) {
    var b = e.target.closest("button[data-o]");
    if (!b || b.disabled) return;
    var qEl = b.closest(".q");
    var qi = +qEl.getAttribute("data-q");
    var q = state.lab.quiz[qi];
    var oi = +b.getAttribute("data-o");
    var right = oi === q.answer;
    var quiz = prog().quiz || {};
    if (!quiz.hasOwnProperty(qi)) {
      quiz[qi] = right;
      SL.setLab(TRACK, state.lab.id, { quiz: quiz });
      saveXP(state.lab);
    }
    Array.prototype.forEach.call(qEl.querySelectorAll("button"), function (x, i) {
      x.disabled = true;
      if (i === q.answer) x.classList.add("right");
    });
    if (!right) b.classList.add("wrong");
    var why = document.createElement("div");
    why.className = "why";
    why.textContent = (right ? "Correct. " : "Not quite. ") + q.why;
    qEl.appendChild(why);
    $("mXP").innerHTML = xpLine(state.lab, prog());
    renderTasks();
  });

  /* ---------------------------------------------------------------- Phone: jump between ticket and code */
  var codeVisible = false;
  if ("IntersectionObserver" in window) {
    new IntersectionObserver(function (entries) {
      codeVisible = entries[0].isIntersecting;
      $("jumpBtn").textContent = codeVisible ? "Tasks ↑" : "Code ↓";
    }, { threshold: 0.15 }).observe(document.querySelector(".work"));
  }
  $("jumpBtn").addEventListener("click", function () {
    if (codeVisible) $("brief").scrollIntoView({ behavior: "smooth" });
    else document.querySelector(".work").scrollIntoView({ behavior: "smooth" });
  });

  /* ---------------------------------------------------------------- Boot */
  renderXP();
  route();
  runner.start({
    setStatus: setStatus,
    print: print,
    enableRun: function () { $("runBtn").disabled = false; }
  });
  window.addEventListener("resize", function () { editor.refresh(); });
})();
