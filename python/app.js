/* sudo learn — Python track UI: editor, console, tasks, XP and completion. */
(function () {
  "use strict";

  var TRACK = "python";
  var T = window.PY_TRACK;
  var LABS = T.LABS;
  var RUN_TIMEOUT = 8000;
  var HINT_COST = 10;
  var QUIZ_XP = 10;

  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
  function labById(id) { for (var i = 0; i < LABS.length; i++) if (LABS[i].id === id) return LABS[i]; return null; }

  /* ---------------------------------------------------------------- Python runner */
  var runner = {
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
          setStatus("ok", "Python " + m.python + " ready");
          $("runBtn").disabled = false;
          self._res(m);
        } else if (m.type === "fatal") {
          setStatus("err", "Python failed to load. Check your connection and reload.");
          self._rej(m.error);
        } else if (m.type === "result") {
          var p = self.pending[m.id];
          if (p) { delete self.pending[m.id]; clearTimeout(p.timer); p.res(m.data); }
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
          var timer = setTimeout(function () {
            delete self.pending[id];
            self.worker.terminate();
            setStatus("busy", "Restarting Python…");
            $("runBtn").disabled = true;
            self.start();
            res({ timeout: true });
          }, timeout || RUN_TIMEOUT);
          self.pending[id] = { res: res, timer: timer };
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

  /* ---------------------------------------------------------------- Editor */
  var editor = CodeMirror.fromTextArea($("code"), {
    mode: { name: "python", version: 3 },
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
  var saveTimer = null;
  var errLine = null;
  editor.on("change", function () {
    clearErrLine();
    if (!state.lab) return;
    clearTimeout(saveTimer);
    var id = state.lab.id;
    saveTimer = setTimeout(function () { SL.setCode(TRACK, id, editor.getValue()); }, 400);
  });
  function clearErrLine() {
    if (errLine != null) { editor.removeLineClass(errLine, "background", "cm-errline"); errLine = null; }
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
    RecursionError: "A function kept calling itself without ever stopping."
  };
  function printError(err) {
    print(err.text, "err");
    var ex = EXPLAIN[err.type];
    if (ex) print("What this means: " + ex, "explain");
  }
  $("clearBtn").addEventListener("click", function () { out.innerHTML = ""; });

  /* ---------------------------------------------------------------- State */
  var state = { lab: null, results: null, running: false };

  function prog(lab) { return SL.lab(TRACK, (lab || state.lab).id); }
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
  function labXP(lab, p) { return Math.max(lab.xp / 2, lab.xp - HINT_COST * hintsUsed(p)); }

  function renderXP() {
    var xp = SL.totalXP();
    var r = SL.rank(xp);
    $("xpBox").innerHTML = "rank <b>" + r.name + "</b> · <b>" + xp + "</b> XP";
  }

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
        var cls = "lab" + (p.done ? " done" : p.started ? " started" : "") + (state.lab && state.lab.id === l.id ? " active" : "");
        html += '<button class="' + cls + '" data-lab="' + l.id + '"><span class="dot">' + (p.done ? "✓" : "") +
          '</span><span class="nm">' + esc(l.title) + "<small>" + esc(l.topic) + "</small></span></button>";
      });
      T.UPCOMING.filter(function (l) { return l.module === m.n; }).forEach(function (l) {
        html += '<div class="lab locked" title="Coming soon"><span class="dot"></span><span class="nm">' + esc(l.title) +
          "<small>" + esc(l.topic) + " · soon</small></span></div>";
      });
    });
    $("side").innerHTML = html;
  }
  $("side").addEventListener("click", function (e) {
    var b = e.target.closest("button[data-lab]");
    if (!b) return;
    location.hash = b.getAttribute("data-lab");
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
    el.innerHTML = lab.learn + '<div class="next-step"><button class="btn primary" id="toTasks">Got it, show my tasks →</button></div>';
    Array.prototype.forEach.call(el.querySelectorAll("pre.ex"), function (pre) {
      var code = pre.textContent;
      pre.classList.add("cm-s-default");
      CodeMirror.runMode(code, "python", pre);
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
  function isCode(h) { return /\n/.test(h) || /^(def |for |if |elif |else|while |print\(|[\w\[\], ]+ ?[+\-]?= )/.test(h); }

  function renderTasks() {
    var lab = state.lab, p = prog(), passed = {};
    if (state.results) state.results.forEach(function (r) { passed[r.id] = r; });
    var html = "";
    if (p.done) {
      html += '<div class="done-banner"><span>✓ Ticket closed · <b>' + (p.xp || 0) + ' XP</b> earned</span>' +
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
    html += '<p class="tasks-foot">' + (state.results ? "Checked on your last run." : "Press <b>Run</b> to check your code against these tasks.") +
      " Hints cost " + HINT_COST + " XP each until the ticket is closed.</p>";
    $("panelTasks").innerHTML = html;
    var badge = $("taskBadge");
    badge.textContent = nPass + "/" + lab.objectives.length;
    badge.className = "badge" + (nPass === lab.objectives.length ? " all" : "");
    var rb = $("reviewBtn");
    if (rb) rb.addEventListener("click", function () { openModal(false); });
  }
  $("panelTasks").addEventListener("click", function (e) {
    var b = e.target.closest("[data-hint]");
    if (!b) return;
    var id = b.getAttribute("data-hint");
    var p = prog();
    var hints = p.hints || {};
    hints[id] = (hints[id] || 0) + 1;
    SL.setLab(TRACK, state.lab.id, { hints: hints, started: true });
    renderTasks();
    renderSide();
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

  /* ---------------------------------------------------------------- Load a lab */
  function loadLab(id) {
    var lab = labById(id) || firstOpenLab();
    state.lab = lab;
    state.results = null;
    var p = prog();
    document.title = lab.ticket + " " + lab.title + " · sudo learn";
    $("tTicket").textContent = lab.ticket;
    $("tTopic").textContent = lab.topic;
    $("tTitle").textContent = lab.title;
    $("tFrom").textContent = lab.from;
    $("tStory").innerHTML = lab.story;
    renderLearn(lab);
    renderTasks();
    renderSide();
    var saved = SL.getCode(TRACK, lab.id);
    editor.setValue(saved != null ? saved : lab.starter + "\n");
    editor.clearHistory();
    clearErrLine();
    $("stdinBox").hidden = lab.stdin == null;
    $("stdin").value = lab.stdin || "";
    out.innerHTML = "";
    print("# " + lab.ticket + " · " + lab.title + ". Write your code above, then press Run.", "sys");
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
    editor.setValue(state.lab.starter + "\n");
    SL.setCode(TRACK, state.lab.id, null);
  });

  /* ---------------------------------------------------------------- Run */
  function stdinLines() {
    var v = $("stdin").value.replace(/\r/g, "");
    if (!v) return [];
    var lines = v.split("\n");
    while (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
    return lines;
  }

  function runCode() {
    if (state.running || !runner.ready) return;
    var lab = state.lab;
    var code = editor.getValue();
    SL.setCode(TRACK, lab.id, code);
    state.running = true;
    $("runBtn").disabled = true;
    clearErrLine();
    print("▶ python main.py", "run-sep");
    var msg = {
      type: "run",
      code: code,
      prelude: lab.prelude || "",
      stdin: lab.stdin != null ? stdinLines() : [],
      files: lab.files || {},
      removeFiles: lab.removeFiles || [],
      checks: lab.objectives.map(function (o) { return { id: o.id, code: o.check }; })
    };
    runner.call(msg, RUN_TIMEOUT).then(function (res) {
      state.running = false;
      if (res.timeout) {
        print("⏱ Your code ran for " + RUN_TIMEOUT / 1000 + " seconds without finishing, so it was stopped. " +
          "This is usually an infinite loop: a while loop whose condition never becomes False.", "err");
        return;
      }
      $("runBtn").disabled = false;
      if (res.internal) { print("Internal error: " + res.internal, "err"); return; }
      if (res.out) print(res.out.replace(/\n$/, ""));
      if (res.error) {
        printError(res.error);
        if (res.error.line) {
          errLine = res.error.line - 1;
          editor.addLineClass(errLine, "background", "cm-errline");
        }
      } else if (!res.out) {
        print("(no output)", "sys");
      }
      afterRun(res.results || []);
    });
  }
  $("runBtn").addEventListener("click", runCode);

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

  /* ---------------------------------------------------------------- REPL */
  var replHist = [], replPos = 0;
  function runRepl(code) {
    var lines = code.replace(/\n+$/, "").split("\n");
    lines.forEach(function (l, i) {
      var d = print(l, i === 0 ? "in" : "in cont");
      if (i > 0) d.textContent = "... " + l, d.className = "sys";
    });
    if (!runner.ready) { print("Python is still loading. Try again in a moment.", "sys"); return; }
    var lab = state.lab;
    runner.call({ type: "repl", code: code, files: lab.files || {}, removeFiles: lab.removeFiles || [] }, RUN_TIMEOUT).then(function (res) {
      if (res.timeout) { print("⏱ Stopped after " + RUN_TIMEOUT / 1000 + " seconds (infinite loop?).", "err"); return; }
      if (res.internal) { print("Internal error: " + res.internal, "err"); return; }
      if (res.out) print(res.out.replace(/\n$/, ""));
      if (res.error) printError(res.error);
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
    var lab = state.lab, p = prog();
    var xp = labXP(lab, p) + quizXP(p);
    SL.setLab(TRACK, lab.id, { done: true, xp: xp, doneAt: Date.now() });
    renderXP();
    renderSide();
    renderTasks();
    setTimeout(function () { openModal(true); }, 350);
  }

  function nextLab() {
    var i = LABS.indexOf(state.lab);
    return LABS[i + 1] || null;
  }

  function openModal(fresh) {
    var lab = state.lab, p = prog();
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
  function xpLine(lab, p) {
    var used = hintsUsed(p);
    return "+" + labXP(lab, p) + " XP <span>" + (used ? "(" + used + " hint" + (used > 1 ? "s" : "") + " used)" : "· no hints used") + "</span>" +
      (quizXP(p) ? " +" + quizXP(p) + " quiz XP" : "");
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
    var p = prog();
    var quiz = p.quiz || {};
    if (!quiz.hasOwnProperty(qi)) {
      quiz[qi] = right;
      var add = right ? QUIZ_XP : 0;
      SL.setLab(TRACK, state.lab.id, { quiz: quiz, xp: (p.xp || 0) + add });
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
    renderXP();
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
  runner.start();
  window.addEventListener("resize", function () { editor.refresh(); });
})();
