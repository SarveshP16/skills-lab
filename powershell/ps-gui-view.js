/* sudo learn — draws the windows a paused PowerShell script is waiting on (Windows Forms, WPF, MessageBox,
   Out-GridView, file dialogs) as an overlay on the page, and turns what the learner does into interactions.
   Each action re-runs the script from the start with the interactions so far (see ps-gui.js), prints the new
   console output, then redraws whatever window the script is waiting on next. */
(function (root) {
  "use strict";
  var E = root.PSEngine;
  var L = { runCode: function (c, o) { return root.PSLab.runCode(c, o); } }; // PSLab loads after this file
  var state = null; // { code, opts, interactions, printed, layer }

  function el(tag, cls, text) { var d = document.createElement(tag); if (cls) d.className = cls; if (text !== undefined && text !== null) d.textContent = text; return d; }
  function str(v) { return v === null || v === undefined ? "" : E.toStr(v); }
  function num(v, d) { var n = Number(v); return isFinite(n) ? n : d; }
  function out(text, cls) {
    var o = document.getElementById("out");
    if (!o) return;
    var d = el("div", cls || "", text);
    o.appendChild(d);
    o.scrollTop = o.scrollHeight;
  }
  var COLORS = { controltext: "", control: "", window: "", windowtext: "" };
  function cssColor(v) { var s = str(v).trim(); if (!s || COLORS[s.toLowerCase()] !== undefined) return ""; return s.replace(/^#?([0-9a-f]{6})$/i, "#$1"); }

  function open(result) {
    if (!result || !result.pause || !result.replay) return;
    state = { code: result.replay.code, opts: result.replay.opts, interactions: (result.replay.opts.interactions || []).slice(), printed: (result.parts || []).length, session: result.session || null };
    if (!state.session) { var rr = L.runCode(state.code, Object.assign({}, state.opts, { interactions: state.interactions })); state.session = rr.session; }
    render(result.pause);
  }
  function close() { if (state && state.layer) state.layer.remove(); state = null; waiters = []; }
  // Callers (the lab page) can wait for the script to finish before showing anything else.
  var waiters = [];
  function whenClosed(fn) { if (!state) fn(); else waiters.push(fn); }
  function finished() { var w = waiters; waiters = []; w.forEach(function (fn) { try { fn(); } catch (e) { /* ignore */ } }); }

  function act(list) {
    if (!state) return;
    state.interactions = state.interactions.concat(list);
    var opts = Object.assign({}, state.opts, { interactions: state.interactions });
    var run;
    try { run = L.runCode(state.code, opts); }
    catch (e) { out("Internal error in the window simulator: " + (e && e.message || e), "err"); close(); return; }
    var parts = run.session.parts;
    parts.slice(state.printed).forEach(function (p) { out(p.text, p.cls); });
    state.printed = parts.length;
    state.session = run.session;
    if (run.res.pause) render(run.res.pause);
    else { if (state.layer) state.layer.remove(); state = null; out("■ window closed, script finished", "sys"); finished(); }
  }

  /* ---------------- rendering */
  function layerFor() {
    if (state.layer) state.layer.remove();
    var layer = el("div", "psgui-layer");
    document.body.appendChild(layer);
    state.layer = layer;
    return layer;
  }
  function chrome(title, onClose, width) {
    var win = el("div", "psgui-win");
    if (width) win.style.width = width + "px";
    var bar = el("div", "psgui-title");
    var ic = el("span", "psgui-icon", "▣");
    bar.appendChild(ic);
    bar.appendChild(el("span", "psgui-ttext", title || ""));
    var sim = el("span", "psgui-sim", "simulated window");
    bar.appendChild(sim);
    var x = el("button", "psgui-x", "✕");
    x.type = "button";
    x.title = "Close";
    x.addEventListener("click", onClose);
    bar.appendChild(x);
    win.appendChild(bar);
    var body = el("div", "psgui-body");
    win.appendChild(body);
    return { win: win, body: body };
  }
  function openForm(session) {
    var g = session.gui;
    if (!g) return null;
    for (var i = g.forms.length - 1; i >= 0; i--) if (g.forms[i].shownOnce && !g.forms[i].closed) return g.forms[i];
    return null;
  }

  function render(pause) {
    var session = state.session, layer = layerFor();
    var formUnder = openForm(session);
    if (pause.kind === "form" || formUnder) drawForm(layer, pause.kind === "form" ? session.gui.controls[pause.formId] : formUnder, pause.kind !== "form");
    if (pause.kind === "messagebox") drawMessage(layer, pause);
    if (pause.kind === "grid") drawGrid(layer, pause, session.gui.grids[pause.gridIndex]);
    if (pause.kind === "file") drawFile(layer, pause, session);
    var focus = layer.querySelector(".psgui-modal input, .psgui-modal button.primary, .psgui-modal button, .psgui-win input");
    if (focus) setTimeout(function () { try { focus.focus(); } catch (e) { /* ignore */ } }, 30);
  }

  // Text typed into boxes is only sent when something happens (a click, a selection, closing), as one event per box.
  function pendingEdits(container) {
    var list = [];
    Array.prototype.forEach.call(container.querySelectorAll("[data-gui-text]"), function (inp) {
      if (inp.value !== inp.getAttribute("data-orig")) list.push({ t: "event", id: +inp.getAttribute("data-gui-text"), action: "text", value: inp.value });
    });
    return list;
  }

  function drawForm(layer, form, inactive) {
    if (!form) return;
    var wpf = form.framework === "wpf";
    var title = str(wpf ? form.get("Title") : form.get("Text"));
    var w = num(form.get("Width"), 300), h = num(form.get("Height"), 300);
    var c = chrome(title, function () { act(pendingEdits(c.body).concat([{ t: "close" }])); }, w);
    if (!wpf) c.body.style.height = Math.max(60, h - 39) + "px";
    else c.body.style.minHeight = Math.max(60, h - 39) + "px";
    c.body.classList.add(wpf ? "wpf" : "forms");
    var accept = !wpf && form.get("AcceptButton");
    function onEnter(e) {
      if (e.key !== "Enter" || e.target.tagName === "TEXTAREA") return;
      var btn = wpf ? findWpf(form, function (x) { return x.guiKind === "Button" && E.toBool(x.get("IsDefault")); }) : accept;
      if (btn) { e.preventDefault(); act(pendingEdits(c.body).concat([{ t: "event", id: btn.guiId, action: "click" }])); }
    }
    c.body.addEventListener("keydown", onEnter);
    if (wpf) drawWpf(c.body, form, c.body);
    else (form.get("Controls") || []).forEach(function (ctl) { drawControl(c.body, ctl, c.body); });
    var wrap = el("div", "psgui-center" + (inactive ? " under" : ""));
    wrap.appendChild(c.win);
    layer.appendChild(wrap);
    fit(c.win);
  }
  function findWpf(node, test) { var hit = null; (function walk(n) { if (hit) return; if (test(n)) hit = n; (n.wpfChildren || []).forEach(walk); })(node); return hit; }
  function fit(win) {
    var maxW = window.innerWidth - 24, maxH = window.innerHeight - 24;
    var r = win.getBoundingClientRect();
    var sc = Math.min(1, maxW / r.width, maxH / r.height);
    if (sc < 1) { win.style.transform = "scale(" + sc.toFixed(3) + ")"; win.style.transformOrigin = "top center"; }
  }

  function applyCommon(node, ctl) {
    if (!E.toBool(ctl.get("Visible") === undefined ? true : ctl.get("Visible")) || /collapsed|hidden/i.test(str(ctl.get("Visibility")))) node.style.display = "none";
    var fc = cssColor(ctl.get("ForeColor") || ctl.get("Foreground"));
    if (fc) node.style.color = fc;
    var bc = cssColor(ctl.get("BackColor"));
    if (bc) node.style.background = bc;
    var font = ctl.get("Font");
    if (font && font.get) { node.style.fontSize = Math.round(num(font.get("Size"), 9) * 1.33) + "px"; if (/bold/i.test(str(font.get("Style")))) node.style.fontWeight = "700"; }
    var en = ctl.get("Enabled") !== undefined ? ctl.get("Enabled") : ctl.get("IsEnabled");
    if (en !== undefined && en !== null && !E.toBool(en)) { node.classList.add("disabled"); Array.prototype.forEach.call(node.querySelectorAll("input,button,select,textarea"), function (x) { x.disabled = true; }); if (/^(INPUT|BUTTON|SELECT|TEXTAREA)$/.test(node.tagName)) node.disabled = true; }
  }

  function drawControl(parent, ctl, body) {
    var k = ctl.guiKind;
    var node;
    var x = num(ctl.get("Left"), 0), y = num(ctl.get("Top"), 0), w = num(ctl.get("Width"), 100), h = num(ctl.get("Height"), 23);
    if (k === "Label") node = el("div", "psgui-label", str(ctl.get("Text")));
    else if (k === "TextBox") {
      var multi = E.toBool(ctl.get("Multiline"));
      node = el(multi ? "textarea" : "input", "psgui-input");
      if (!multi) node.type = E.toBool(ctl.get("UseSystemPasswordChar")) || str(ctl.get("PasswordChar")) ? "password" : "text";
      node.value = str(ctl.get("Text"));
      node.setAttribute("data-gui-text", ctl.guiId);
      node.setAttribute("data-orig", node.value);
      if (str(ctl.get("PlaceholderText"))) node.placeholder = str(ctl.get("PlaceholderText"));
      if (E.toBool(ctl.get("ReadOnly"))) node.readOnly = true;
    }
    else if (k === "Button") {
      node = el("button", "psgui-btn", str(ctl.get("Text")));
      node.type = "button";
      node.addEventListener("click", function () { act(pendingEdits(body).concat([{ t: "event", id: ctl.guiId, action: "click" }])); });
    }
    else if (k === "CheckBox" || k === "RadioButton") {
      node = el("label", "psgui-check");
      var cb = el("input");
      cb.type = k === "CheckBox" ? "checkbox" : "radio";
      cb.checked = E.toBool(ctl.get("Checked"));
      cb.addEventListener("change", function () { act(pendingEdits(body).concat([{ t: "event", id: ctl.guiId, action: "check", value: cb.checked }])); });
      node.appendChild(cb);
      node.appendChild(document.createTextNode(" " + str(ctl.get("Text"))));
    }
    else if (k === "ComboBox" || k === "ListBox") node = drawList(ctl, body, k === "ListBox", str(ctl.get("SelectionMode")));
    else if (k === "DataGridView") node = drawTable(enumerate(ctl.get("DataSource")), ctl, body, (ctl.get("SelectedRows") || []).map(function (r) { return num(r.get("Index"), -1); }));
    else if (k === "GroupBox" || k === "Panel") {
      node = el("div", k === "GroupBox" ? "psgui-group" : "psgui-panel");
      if (k === "GroupBox") node.appendChild(el("span", "psgui-legend", str(ctl.get("Text"))));
      (ctl.get("Controls") || []).forEach(function (child) { drawControl(node, child, body); });
    }
    else if (k === "ProgressBar") { node = el("progress", "psgui-progress"); node.max = num(ctl.get("Maximum"), 100); node.value = num(ctl.get("Value"), 0); }
    else if (k === "NumericUpDown") { node = el("input", "psgui-input"); node.type = "number"; node.value = str(ctl.get("Value")); }
    else node = el("div", "psgui-label", str(ctl.get("Text")));
    node.style.left = x + "px"; node.style.top = y + "px"; node.style.width = w + "px";
    if (k !== "Label" || !E.toBool(ctl.get("AutoSize"))) node.style.height = h + "px";
    if (k === "Label" && E.toBool(ctl.get("AutoSize"))) { node.style.width = "auto"; node.style.whiteSpace = "nowrap"; }
    node.classList.add("abs");
    applyCommon(node, ctl);
    parent.appendChild(node);
  }
  function enumerate(v) { return v === null || v === undefined ? [] : Array.isArray(v) ? v : [v]; }
  function drawList(ctl, body, isList, mode) {
    var items = ctl.get("ItemsSource") ? enumerate(ctl.get("ItemsSource")) : (ctl.get("Items") || []);
    var sel = el("select", "psgui-select");
    var multi = isList && /multi/i.test(mode);
    if (isList) sel.size = Math.max(2, Math.min(12, items.length || 2));
    if (multi) sel.multiple = true;
    if (!isList) { var ph = el("option", "", ""); ph.value = "-1"; sel.appendChild(ph); }
    items.forEach(function (it, i) { var o = el("option", "", str(it instanceof E.PSObject && it.get("Content") !== undefined ? it.get("Content") : it)); o.value = String(i); sel.appendChild(o); });
    var si = num(ctl.get("SelectedIndex"), -1);
    if (multi) { var chosen = (ctl.get("SelectedItems") || []).map(function (x) { return items.indexOf(x); }); Array.prototype.forEach.call(sel.options, function (o) { o.selected = chosen.indexOf(+o.value) >= 0; }); }
    else sel.value = String(si);
    sel.addEventListener("change", function () {
      var vals = Array.prototype.filter.call(sel.options, function (o) { return o.selected && o.value !== "-1"; }).map(function (o) { return +o.value; });
      act(pendingEdits(body).concat([{ t: "event", id: ctl.guiId, action: "select", value: multi ? vals : (vals.length ? vals[0] : -1) }]));
    });
    return sel;
  }
  function columns(rows) {
    var first = rows[0];
    if (first instanceof E.PSObject) return first.names();
    if (first instanceof E.PSHashtable) return first.keys().map(str);
    return ["Value"];
  }
  function cell(row, c) {
    if (row instanceof E.PSObject) return E.cellText(row.get(c));
    if (row instanceof E.PSHashtable) return E.cellText(row.get(c));
    return E.cellText(row);
  }
  function drawTable(rows, ctl, body, selected, onPick) {
    var wrap = el("div", "psgui-gridwrap");
    var t = el("table", "psgui-grid");
    var cols = rows.length ? columns(rows) : [];
    var tr = el("tr");
    cols.forEach(function (c) { tr.appendChild(el("th", "", c)); });
    t.appendChild(tr);
    rows.forEach(function (row, i) {
      var r = el("tr", selected.indexOf(i) >= 0 ? "sel" : "");
      cols.forEach(function (c) { r.appendChild(el("td", "", cell(row, c))); });
      r.addEventListener("click", function () {
        if (onPick) { onPick(i, r); return; }
        act(pendingEdits(body).concat([{ t: "event", id: ctl.guiId, action: "select", value: [i] }]));
      });
      t.appendChild(r);
    });
    wrap.appendChild(t);
    return wrap;
  }

  function drawWpf(parent, node, body) {
    (node.wpfChildren || []).forEach(function (ctl) {
      var k = ctl.guiKind, d;
      if (k === "StackPanel" || k === "Grid" || k === "DockPanel" || k === "WrapPanel" || k === "Border" || k === "GroupBox") {
        d = el("div", "wpf-panel " + (/horizontal/i.test(str(ctl.get("Orientation"))) ? "row" : "col"));
        if (k === "GroupBox") d.appendChild(el("div", "psgui-legend", str(ctl.get("Content"))));
        drawWpf(d, ctl, body);
      }
      else if (k === "TextBlock" || k === "Label") d = el("div", "wpf-text", str(k === "Label" ? ctl.get("Content") : ctl.get("Text")));
      else if (k === "TextBox" || k === "PasswordBox") {
        d = el("input", "psgui-input");
        d.type = k === "PasswordBox" ? "password" : "text";
        d.value = str(k === "PasswordBox" ? ctl.get("Password") : ctl.get("Text"));
        d.setAttribute("data-gui-text", ctl.guiId);
        d.setAttribute("data-orig", d.value);
        if (E.toBool(ctl.get("IsReadOnly"))) d.readOnly = true;
      }
      else if (k === "Button") {
        d = el("button", "psgui-btn" + (E.toBool(ctl.get("IsDefault")) ? " primary" : ""), str(ctl.get("Content")));
        d.type = "button";
        d.addEventListener("click", function () { act(pendingEdits(body).concat([{ t: "event", id: ctl.guiId, action: "click" }])); });
      }
      else if (k === "CheckBox" || k === "RadioButton") {
        d = el("label", "psgui-check");
        var cb = el("input");
        cb.type = k === "CheckBox" ? "checkbox" : "radio";
        cb.checked = E.toBool(ctl.get("IsChecked"));
        cb.addEventListener("change", function () { act(pendingEdits(body).concat([{ t: "event", id: ctl.guiId, action: "check", value: cb.checked }])); });
        d.appendChild(cb);
        d.appendChild(document.createTextNode(" " + str(ctl.get("Content"))));
      }
      else if (k === "ComboBox" || k === "ListBox") d = drawList(ctl, body, k === "ListBox", "");
      else if (k === "DataGrid") d = drawTable(enumerate(ctl.get("ItemsSource")), ctl, body, [num(ctl.get("SelectedIndex"), -1)]);
      else if (k === "ProgressBar") { d = el("progress", "psgui-progress"); d.max = num(ctl.get("Maximum"), 100); d.value = num(ctl.get("Value"), 0); }
      else d = el("div", "wpf-text", str(ctl.get("Content") || ctl.get("Text")));
      var wv = ctl.get("Width");
      if (wv !== null && wv !== undefined && isFinite(Number(wv)) && k !== "StackPanel") d.style.width = Number(wv) + "px";
      applyCommon(d, ctl);
      parent.appendChild(d);
    });
  }

  function modal(layer, title, width) {
    var back = el("div", "psgui-center modal");
    var c = chrome(title, function () { }, width);
    c.win.classList.add("psgui-modal");
    back.appendChild(c.win);
    layer.appendChild(back);
    return c;
  }
  var ICONS = { question: "?", information: "i", info: "i", asterisk: "i", warning: "!", exclamation: "!", error: "✕", hand: "✕", stop: "✕" };
  function drawMessage(layer, p) {
    var c = modal(layer, p.caption || "", 380);
    var x = c.win.querySelector(".psgui-x");
    var cancelLike = p.buttons.indexOf("Cancel") >= 0 ? "Cancel" : p.buttons.length === 1 ? p.buttons[0] : null;
    if (cancelLike) x.addEventListener("click", function () { act([{ t: "answer", value: cancelLike }]); }); else x.disabled = true;
    var row = el("div", "psgui-msg");
    var icon = ICONS[String(p.icon || "").toLowerCase()];
    if (icon) row.appendChild(el("span", "psgui-msgicon " + String(p.icon).toLowerCase(), icon));
    row.appendChild(el("div", "psgui-msgtext", p.text));
    c.body.appendChild(row);
    var btns = el("div", "psgui-btnrow");
    p.buttons.forEach(function (b, i) {
      var bt = el("button", "psgui-btn" + (i === 0 ? " primary" : ""), b);
      bt.type = "button";
      bt.addEventListener("click", function () { act([{ t: "answer", value: b }]); });
      btns.appendChild(bt);
    });
    c.body.appendChild(btns);
  }
  function drawGrid(layer, p, entry) {
    var rows = entry ? entry.items : [];
    var c = modal(layer, p.title, 640);
    var chosen = [];
    c.win.querySelector(".psgui-x").addEventListener("click", function () { act([{ t: "answer", value: [] }]); });
    var filt = el("input", "psgui-input psgui-filter");
    filt.placeholder = "Filter";
    c.body.appendChild(filt);
    var table = drawTable(rows, null, c.body, [], function (i, tr) {
      if (p.mode === "single") { chosen = [i]; Array.prototype.forEach.call(table.querySelectorAll("tr.sel"), function (x) { x.classList.remove("sel"); }); tr.classList.add("sel"); }
      else { var at = chosen.indexOf(i); if (at >= 0) { chosen.splice(at, 1); tr.classList.remove("sel"); } else { chosen.push(i); tr.classList.add("sel"); } }
    });
    filt.addEventListener("input", function () {
      var q = filt.value.toLowerCase();
      Array.prototype.forEach.call(table.querySelectorAll("tr"), function (tr, i) { if (i > 0) tr.style.display = tr.textContent.toLowerCase().indexOf(q) >= 0 ? "" : "none"; });
    });
    c.body.appendChild(table);
    c.body.appendChild(el("div", "psgui-hint", p.mode === "single" ? "Click a row, then OK." : "Click rows to select them (click again to unselect), then OK."));
    var btns = el("div", "psgui-btnrow");
    var ok = el("button", "psgui-btn primary", "OK"), cancel = el("button", "psgui-btn", "Cancel");
    ok.type = cancel.type = "button";
    ok.addEventListener("click", function () { act([{ t: "answer", value: chosen.slice().sort(function (a, b) { return a - b; }) }]); });
    cancel.addEventListener("click", function () { act([{ t: "answer", value: [] }]); });
    btns.appendChild(ok); btns.appendChild(cancel);
    c.body.appendChild(btns);
  }
  function drawFile(layer, p, session) {
    var c = modal(layer, p.title || (p.mode === "open" ? "Open" : "Save As"), 460);
    var cancel = function () { act([{ t: "answer", value: { result: "Cancel" } }]); };
    c.win.querySelector(".psgui-x").addEventListener("click", cancel);
    var exts = (String(p.filter || "").split("|").filter(function (x, i) { return i % 2 === 1; }).join(";") || "*.*").split(";").map(function (x) { return x.trim(); });
    var sys = session.system;
    var files = Object.keys(sys.files).map(function (k) { return sys.files[k].name; }).filter(function (n) { return !/\.keep$/.test(n) && exts.some(function (x) { return E.wildcardRe(x).test(n.split("\\").pop()); }); }).sort();
    c.body.appendChild(el("div", "psgui-hint", "C:\\lab  (the lab's pretend disk)"));
    var name = el("input", "psgui-input psgui-filter");
    name.value = p.fileName || (p.mode === "save" ? "report.csv" : "");
    if (p.mode === "open") {
      var list = el("div", "psgui-files");
      if (!files.length) list.appendChild(el("div", "psgui-hint", "(no matching files)"));
      files.forEach(function (f) {
        var item = el("div", "psgui-file", f);
        item.addEventListener("click", function () { name.value = f; Array.prototype.forEach.call(list.children, function (x) { x.classList.remove("sel"); }); item.classList.add("sel"); });
        item.addEventListener("dblclick", function () { act([{ t: "answer", value: { result: "OK", fileName: f } }]); });
        list.appendChild(item);
      });
      c.body.appendChild(list);
    }
    var lab = el("label", "psgui-hint", "File name:");
    c.body.appendChild(lab);
    c.body.appendChild(name);
    var btns = el("div", "psgui-btnrow");
    var ok = el("button", "psgui-btn primary", p.mode === "open" ? "Open" : "Save"), cb = el("button", "psgui-btn", "Cancel");
    ok.type = cb.type = "button";
    ok.addEventListener("click", function () { if (name.value.trim()) act([{ t: "answer", value: { result: "OK", fileName: name.value.trim() } }]); });
    cb.addEventListener("click", cancel);
    btns.appendChild(ok); btns.appendChild(cb);
    c.body.appendChild(btns);
  }

  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && state && state.layer && state.layer.querySelector(".psgui-modal")) { /* modal dialogs need a button choice */ } });
  root.PSGuiView = { open: open, close: close, isOpen: function () { return !!state; }, whenClosed: whenClosed };
})(typeof window !== "undefined" ? window : globalThis);
