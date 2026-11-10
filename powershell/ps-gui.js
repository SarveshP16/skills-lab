/* sudo learn — GUI model for the PowerShell engine: Windows Forms, MessageBox, Out-GridView, file dialogs, WPF/XAML.
   How it works: a script runs until it needs the user (form.ShowDialog(), MessageBox::Show, Out-GridView -PassThru,
   a file dialog). Then it pauses (throws a Pause with a description of the window). The page shows the window
   (ps-gui-view.js), records what the user does as "interactions", and re-runs the script from the start with them.
   Replay keeps runs deterministic, and lets checks drive GUIs headlessly: r.interact([...]).
   Interactions: { t: "event", id, action: "click"|"text"|"check"|"select", value } (id = control's creation number),
                 { t: "close", result }  and  { t: "answer", value } for message boxes, grids and file dialogs. */
(function (root) {
  "use strict";
  var E = root.PSEngine, lib = E.lib;
  var PSObject = E.PSObject, toStr = E.toStr, toBool = E.toBool, toNumber = E.toNumber, lc = E.lc, obj = E.obj, enumerate = E.enumerate;
  function err(msg, cat) { return new E.PSError(msg, { category: cat || "InvalidOperation" }); }
  function Pause(request) { this.isPause = true; this.request = request; }
  E.Pause = Pause;

  function gui(session) {
    if (!session.gui) session.gui = { seq: 0, controls: {}, forms: [], messages: [], grids: [], interactions: session.interactionList || [], pos: 0 };
    return session.gui;
  }
  function nextInteraction(session) { var g = gui(session); return g.pos < g.interactions.length ? g.interactions[g.pos] : null; }
  function takeInteraction(session) { var g = gui(session); return g.interactions[g.pos++]; }
  function mismatch() { return err("The window doesn't match the script any more (did the code change?). Press Run again.", "InvalidOperation"); }

  /* ================================================================== Controls */
  var EVENTS = ["Click", "DoubleClick", "TextChanged", "CheckedChanged", "SelectedIndexChanged", "SelectionChanged", "Load", "Shown", "FormClosing", "FormClosed",
    "KeyDown", "Leave", "ValueChanged", "Checked", "Unchecked", "Loaded", "Closing", "CellClick"];
  var DEFAULTS = {
    Form: { Text: "", Width: 300, Height: 300 }, Label: { Width: 100, Height: 23, AutoSize: false }, TextBox: { Width: 100, Height: 23, Multiline: false, ReadOnly: false, PasswordChar: "", UseSystemPasswordChar: false, PlaceholderText: "" },
    Button: { Width: 75, Height: 23, DialogResult: "None" }, CheckBox: { Width: 104, Height: 24, Checked: false }, RadioButton: { Width: 104, Height: 24, Checked: false },
    ComboBox: { Width: 121, Height: 23, DropDownStyle: "DropDown" }, ListBox: { Width: 120, Height: 95, SelectionMode: "One" }, DataGridView: { Width: 240, Height: 150, ReadOnly: false, AutoSizeColumnsMode: "None", SelectionMode: "RowHeaderSelect", AllowUserToAddRows: true },
    GroupBox: { Width: 200, Height: 100 }, Panel: { Width: 200, Height: 100 }, ProgressBar: { Width: 100, Height: 23, Value: 0, Minimum: 0, Maximum: 100 }, NumericUpDown: { Width: 120, Height: 23, Value: 0, Minimum: 0, Maximum: 100 },
    PictureBox: { Width: 100, Height: 50 }
  };
  function point(x, y) { var o = obj("System.Drawing.Point", { X: x, Y: y }); o.toStringFn = function () { return "{X=" + o.get("X") + ",Y=" + o.get("Y") + "}"; }; return o; }
  function size(w, h) { var o = obj("System.Drawing.Size", { Width: w, Height: h }); o.toStringFn = function () { return "{Width=" + o.get("Width") + ", Height=" + o.get("Height") + "}"; }; return o; }

  function makeControl(session, kind, fw) {
    var g = gui(session);
    var o = new PSObject((fw === "wpf" ? "System.Windows.Controls." : "System.Windows.Forms.") + kind);
    o.guiId = ++g.seq;
    o.guiKind = kind;
    o.framework = fw || "forms";
    o.handlers = {};
    g.controls[o.guiId] = o;
    var d = DEFAULTS[kind] || { Width: 100, Height: 23 };
    o.set("Name", "");
    o.set("Text", d.Text !== undefined ? d.Text : "");
    if (fw !== "wpf") {
      o.set("Location", point(0, 0)); o.set("Left", 0); o.set("Top", 0);
      o.set("Size", size(d.Width, d.Height)); o.set("Width", d.Width); o.set("Height", d.Height);
    }
    o.set("Enabled", true); o.set("Visible", true); o.set("ForeColor", "ControlText"); o.set("BackColor", "Control"); o.set("Font", null); o.set("TabIndex", 0); o.set("Tag", null);
    o.set("Anchor", "Top, Left"); o.set("Dock", "None");
    Object.keys(d).forEach(function (k) { if (["Width", "Height", "Text"].indexOf(k) < 0) o.set(k, d[k]); });
    if (kind === "Form" || kind === "GroupBox" || kind === "Panel") { var cs = []; cs.__list = "list"; o.set("Controls", cs); }
    if (kind === "ComboBox" || kind === "ListBox") {
      var items = []; items.__list = "arraylist"; o.set("Items", items);
      o.set("SelectedIndex", -1); o.set("SelectedItem", null);
      if (kind === "ListBox") o.set("SelectedItems", []);
    }
    if (kind === "DataGridView") { o.set("DataSource", null); o.set("SelectedRows", []); o.set("CurrentRow", null); o.set("Rows", []); }
    if (kind === "Form") {
      o.set("StartPosition", "WindowsDefaultLocation"); o.set("AcceptButton", null); o.set("CancelButton", null); o.set("DialogResult", "None");
      o.set("Topmost", false); o.set("FormBorderStyle", "Sizable"); o.set("MaximizeBox", true); o.set("MinimizeBox", true); o.set("ClientSize", size(d.Width - 16, d.Height - 39));
      g.forms.push(o);
    }
    o.methods = {};
    EVENTS.forEach(function (ev) {
      o.methods["add_" + lc(ev)] = function (args) {
        if (!(args[0] instanceof E.ScriptBlock)) throw err("add_" + ev + " needs a script block: $control.add_" + ev + "({ ... })", "InvalidArgument");
        (o.handlers[lc(ev)] = o.handlers[lc(ev)] || []).push(args[0]);
        return undefined;
      };
      o.methods["remove_" + lc(ev)] = function () { o.handlers[lc(ev)] = []; return undefined; };
    });
    o.methods.focus = function () { return true; };
    o.methods.select = function () { return undefined; };
    o.methods.clear = function () { o.set("Text", ""); return undefined; };
    o.methods.refresh = function () { return undefined; };
    o.methods.bringtofront = function () { return undefined; };
    o.methods.performclick = function (args, ctx) { clickControl(o, ctx); return undefined; };
    if (kind === "Form") {
      o.methods.showdialog = function (args, ctx) { return showDialog(o, ctx); };
      o.methods.show = function (args, ctx) { return showDialog(o, ctx); };
      o.methods.close = function () { o.closed = true; return undefined; };
      o.methods.dispose = function () { return undefined; };
      o.methods.activate = function () { return undefined; };
    }
    if (kind === "DataGridView") o.methods.clearselection = function () { o.set("SelectedRows", []); return undefined; };
    o.onSet = function (name, v) {
      var n = lc(name);
      if (n === "size" && v instanceof PSObject) { o.props[o.index.get("width")].value = toNumber(v.get("Width")); o.props[o.index.get("height")].value = toNumber(v.get("Height")); }
      else if ((n === "width" || n === "height") && o.has("Size")) o.set("Size", size(toNumber(o.get("Width")), toNumber(o.get("Height"))));
      else if (n === "location" && v instanceof PSObject) { o.props[o.index.get("left")].value = toNumber(v.get("X")); o.props[o.index.get("top")].value = toNumber(v.get("Y")); }
      else if ((n === "left" || n === "top") && o.has("Location")) o.set("Location", point(toNumber(o.get("Left")), toNumber(o.get("Top"))));
      else if (n === "clientsize" && v instanceof PSObject && kind === "Form") { o.props[o.index.get("width")].value = toNumber(v.get("Width")) + 16; o.props[o.index.get("height")].value = toNumber(v.get("Height")) + 39; }
      else if (n === "selectedindex" && (kind === "ComboBox" || kind === "ListBox")) { var i = toNumber(v), it = o.get("Items"); o.props[o.index.get("selecteditem")].value = i >= 0 && i < it.length ? it[i] : null; }
      else if (n === "datasource" && kind === "DataGridView") o.set("Rows", enumerate(v).map(function (x, i) { return rowObj(x, i); }));
    };
    return o;
  }
  function rowObj(item, i) { return obj("System.Windows.Forms.DataGridViewRow", { Index: i, DataBoundItem: item, Selected: false }); }

  function fire(o, ev, ctx, eventArgs) {
    var hs = o.handlers[lc(ev)] || [];
    hs.forEach(function (sb) {
      var out = E.callScriptBlockList(sb, ctx, [o, eventArgs || obj("System.EventArgs", {})], eventArgs || obj("System.EventArgs", {}), o);
      var t = out.length ? E.formatItems(out, ctx.session) : "";
      if (t) ctx.session.write(t, "");
    });
  }
  function formOf(o) {
    var g = null;
    (function find(ctls, f) { ctls.forEach(function (c) { if (c === o) g = f; if (c.has && c.has("Controls")) find(c.get("Controls"), f); }); })([], null);
    return o.ownerForm || null;
  }
  function clickControl(o, ctx) {
    fire(o, "Click", ctx);
    var dr = o.get("DialogResult");
    var form = o.ownerForm;
    if (form && o.framework !== "wpf" && dr && toStr(dr) !== "None") { form.set("DialogResult", toStr(dr)); form.closed = true; }
    if (o.framework === "wpf" && form) {
      if (toBool(o.get("IsCancel"))) { form.wpfResult = false; form.closed = true; }
    }
  }
  // Link every control to its form, so a button's DialogResult can close the right window.
  function linkTree(form) {
    (function walk(list) {
      enumerate(list).forEach(function (c) {
        if (!(c instanceof PSObject)) return;
        c.ownerForm = form;
        if (c.has("Controls")) walk(c.get("Controls"));
        if (c.wpfChildren) walk(c.wpfChildren);
      });
    })(form.has("Controls") ? form.get("Controls") : form.wpfChildren || []);
  }

  function applyEvent(it, ctx) {
    var o = gui(ctx.session).controls[it.id];
    if (!o) throw mismatch();
    var a = it.action, kind = o.guiKind;
    if (a === "click") { clickControl(o, ctx); return; }
    if (a === "text") {
      if (o.framework === "wpf" && kind === "PasswordBox") o.set("Password", toStr(it.value));
      else o.set("Text", toStr(it.value));
      fire(o, o.framework === "wpf" && kind === "PasswordBox" ? "PasswordChanged" : "TextChanged", ctx);
      return;
    }
    if (a === "check") {
      var on = !!it.value;
      if (o.framework === "wpf") { o.set("IsChecked", on); fire(o, on ? "Checked" : "Unchecked", ctx); fire(o, "Click", ctx); }
      else { o.set("Checked", on); fire(o, "CheckedChanged", ctx); fire(o, "Click", ctx); }
      return;
    }
    if (a === "select") {
      if (kind === "DataGridView" || kind === "DataGrid") {
        var rows = (o.get("Rows") || []);
        var idx = enumerate(it.value).map(toNumber);
        var sel = idx.map(function (i) { return rows[i]; }).filter(Boolean);
        if (kind === "DataGrid") { var src = enumerate(o.get("ItemsSource")); o.set("SelectedItem", src[idx[0]] === undefined ? null : src[idx[0]]); o.set("SelectedIndex", idx.length ? idx[0] : -1); fire(o, "SelectionChanged", ctx); return; }
        o.set("SelectedRows", sel);
        o.set("CurrentRow", sel[0] || null);
        fire(o, "SelectionChanged", ctx);
        fire(o, "CellClick", ctx);
        return;
      }
      var items = o.get("ItemsSource") ? enumerate(o.get("ItemsSource")) : (o.get("Items") || []);
      var ix = enumerate(it.value).map(toNumber);
      if (kind === "ListBox" && /multi/i.test(toStr(o.get("SelectionMode")))) o.set("SelectedItems", ix.map(function (i) { return items[i]; }));
      o.set("SelectedIndex", ix.length ? ix[0] : -1);
      o.set("SelectedItem", ix.length && items[ix[0]] !== undefined ? items[ix[0]] : null);
      if (o.framework !== "wpf") o.set("Text", ix.length ? toStr(items[ix[0]]) : o.get("Text"));
      fire(o, o.framework === "wpf" ? "SelectionChanged" : "SelectedIndexChanged", ctx);
      return;
    }
    throw mismatch();
  }

  function showDialog(form, ctx) {
    var session = ctx.session;
    linkTree(form);
    form.closed = false;
    if (!form.shownOnce) {
      form.shownOnce = true;
      fire(form, form.framework === "wpf" ? "Loaded" : "Load", ctx);
      if (form.framework !== "wpf") fire(form, "Shown", ctx);
    }
    for (;;) {
      if (form.closed) {
        if (form.framework === "wpf") return form.wpfResult === undefined ? false : form.wpfResult;
        var r = toStr(form.get("DialogResult"));
        return r === "None" ? "Cancel" : r;
      }
      var it = nextInteraction(session);
      if (!it) throw new Pause({ kind: "form", formId: form.guiId });
      if (it.t === "event") { takeInteraction(session); applyEvent(it, ctx); continue; }
      if (it.t === "close") {
        takeInteraction(session);
        fire(form, form.framework === "wpf" ? "Closing" : "FormClosing", ctx);
        if (form.framework === "wpf") { if (form.wpfResult === undefined) form.wpfResult = it.result === undefined ? false : it.result; }
        else if (it.result) form.set("DialogResult", it.result);
        form.closed = true;
        continue;
      }
      throw mismatch();
    }
  }

  /* ================================================================== Message boxes, grids, file dialogs */
  function askAnswer(session, request) {
    var it = nextInteraction(session);
    if (!it) throw new Pause(request);
    if (it.t !== "answer") throw mismatch();
    takeInteraction(session);
    return it.value;
  }
  function messageBox(args, ctx) {
    var text = toStr(args[0]), caption = args.length > 1 ? toStr(args[1]) : "", buttons = args.length > 2 ? toStr(args[2]) : "OK", icon = args.length > 3 ? toStr(args[3]) : "None";
    var valid = { ok: ["OK"], okcancel: ["OK", "Cancel"], yesno: ["Yes", "No"], yesnocancel: ["Yes", "No", "Cancel"], retrycancel: ["Retry", "Cancel"], abortretryignore: ["Abort", "Retry", "Ignore"] };
    var choices = valid[lc(buttons)];
    if (!choices) throw err("MessageBox buttons must be one of OK, OKCancel, YesNo, YesNoCancel, RetryCancel, AbortRetryIgnore.", "InvalidArgument");
    var g = gui(ctx.session);
    var entry = { text: text, caption: caption, buttons: buttons, icon: icon, answer: null };
    g.messages.push(entry);
    var ans = askAnswer(ctx.session, { kind: "messagebox", text: text, caption: caption, buttons: choices, icon: icon });
    if (choices.indexOf(ans) < 0) throw mismatch();
    entry.answer = ans;
    return ans;
  }

  E.lib.cmdlets["out-gridview"] = {
    name: "Out-GridView", module: "Microsoft.PowerShell.Utility",
    params: [{ name: "InputObject", position: null }, { name: "Title", position: null }, { name: "PassThru", type: "switch" }, { name: "OutputMode", position: null }, { name: "Wait", type: "switch" }],
    run: function (b, input, ctx) {
      var items = input || enumerate(b.inputobject);
      var mode = b.outputmode !== undefined ? lc(toStr(b.outputmode)) : b.passthru ? "multiple" : "none";
      var title = b.title !== undefined ? toStr(b.title) : "Out-GridView";
      var g = gui(ctx.session);
      var entry = { title: title, items: items, mode: mode };
      g.grids.push(entry);
      if (mode === "none") { g.shown = g.shown || []; g.shown.push(entry); return []; }
      var ans = askAnswer(ctx.session, { kind: "grid", title: title, mode: mode, gridIndex: g.grids.length - 1 });
      var idx = enumerate(ans).map(toNumber);
      if (mode === "single" && idx.length > 1) idx = idx.slice(0, 1);
      entry.selected = idx;
      return idx.map(function (i) { return items[i]; }).filter(function (x) { return x !== undefined; });
    },
    help: { synopsis: "Shows objects in an interactive window with a table. With -PassThru (or -OutputMode Single), the rows the user picks are passed on down the pipeline.",
      examples: ["Get-Service | Out-GridView -Title 'Services' -PassThru"] }
  };
  E.lib.aliases["ogv"] = "Out-GridView";

  function fileDialog(kind, session) {
    var o = new PSObject("System.Windows.Forms." + (kind === "open" ? "OpenFileDialog" : "SaveFileDialog"));
    ["Title", "Filter", "InitialDirectory", "FileName", "DefaultExt"].forEach(function (k) { o.set(k, ""); });
    o.set("Multiselect", false); o.set("FileNames", []); o.set("OverwritePrompt", true);
    o.methods = {
      showdialog: function (args, ctx) {
        var ans = askAnswer(ctx.session, { kind: "file", mode: kind, title: toStr(o.get("Title")), filter: toStr(o.get("Filter")), initialDirectory: toStr(o.get("InitialDirectory")), fileName: toStr(o.get("FileName")) });
        if (!ans || ans.result === "Cancel") return "Cancel";
        o.set("FileName", toStr(ans.fileName));
        o.set("FileNames", [toStr(ans.fileName)]);
        return "OK";
      },
      dispose: function () { return undefined; }
    };
    return o;
  }

  /* ================================================================== XML and WPF */
  function parseXml(text) {
    var i = 0, s = String(text);
    function errX(m) { throw err("XML error: " + m + " (near character " + i + ")", "InvalidData"); }
    function skipMisc() {
      for (;;) {
        while (/\s/.test(s[i] || "")) i++;
        if (s.startsWith("<?", i)) { i = s.indexOf("?>", i) + 2; continue; }
        if (s.startsWith("<!--", i)) { i = s.indexOf("-->", i) + 3; continue; }
        break;
      }
    }
    function el() {
      if (s[i] !== "<") errX("expected <");
      i++;
      var m = /^[\w:.-]+/.exec(s.slice(i));
      if (!m) errX("bad tag name");
      var node = { name: m[0], attrs: {}, children: [], text: "" };
      i += m[0].length;
      for (;;) {
        while (/\s/.test(s[i])) i++;
        if (s.startsWith("/>", i)) { i += 2; return node; }
        if (s[i] === ">") { i++; break; }
        var am = /^([\w:.-]+)\s*=\s*("([^"]*)"|'([^']*)')/.exec(s.slice(i));
        if (!am) errX("bad attribute in <" + node.name + ">");
        node.attrs[am[1]] = (am[3] !== undefined ? am[3] : am[4]).replace(/&quot;/g, "\"").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
        i += am[0].length;
      }
      for (;;) {
        if (i >= s.length) errX("<" + node.name + "> is never closed");
        if (s.startsWith("<!--", i)) { i = s.indexOf("-->", i) + 3; continue; }
        if (s.startsWith("</", i)) {
          var close = /^<\/([\w:.-]+)\s*>/.exec(s.slice(i));
          if (!close || close[1] !== node.name) errX("expected </" + node.name + ">");
          i += close[0].length;
          return node;
        }
        if (s[i] === "<") { node.children.push(el()); continue; }
        var t = s.indexOf("<", i);
        node.text += s.slice(i, t < 0 ? s.length : t).replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
        i = t < 0 ? s.length : t;
      }
    }
    skipMisc();
    var rootEl = el();
    skipMisc();
    return rootEl;
  }
  function xmlDoc(text) {
    var r = parseXml(text);
    var o = obj("System.Xml.XmlDocument", { DocumentElement: obj("System.Xml.XmlElement", { Name: r.name, LocalName: r.name.split(":").pop() }) });
    o.xmlRoot = r;
    o.toStringFn = function () { return "#document"; };
    return o;
  }
  var WPF_KINDS = { window: "Window", stackpanel: "StackPanel", grid: "Grid", dockpanel: "DockPanel", wrappanel: "WrapPanel", border: "Border", groupbox: "GroupBox",
    label: "Label", textblock: "TextBlock", textbox: "TextBox", passwordbox: "PasswordBox", button: "Button", checkbox: "CheckBox", radiobutton: "RadioButton",
    combobox: "ComboBox", comboboxitem: "ComboBoxItem", listbox: "ListBox", listboxitem: "ListBoxItem", datagrid: "DataGrid", progressbar: "ProgressBar" };
  function buildWpf(session, node, win) {
    var local = node.name.split(":").pop();
    var kind = WPF_KINDS[lc(local)];
    if (!kind) throw err("This lab's XAML supports Window, StackPanel, Grid, DockPanel, WrapPanel, Border, GroupBox, Label, TextBlock, TextBox, PasswordBox, Button, CheckBox, RadioButton, ComboBox, ListBox and DataGrid. Unknown element: <" + node.name + ">.", "InvalidData");
    var g = gui(session);
    var o = new PSObject("System.Windows." + (kind === "Window" ? "" : "Controls.") + kind);
    o.guiId = ++g.seq; o.guiKind = kind; o.framework = "wpf"; o.handlers = {}; o.wpfChildren = [];
    g.controls[o.guiId] = o;
    o.set("Name", node.attrs["x:Name"] || node.attrs["Name"] || "");
    var attr = function (k, d) { return node.attrs[k] !== undefined ? node.attrs[k] : d; };
    if (kind === "Window") { o.set("Title", attr("Title", "")); o.set("Width", toNumber(attr("Width", 400))); o.set("Height", toNumber(attr("Height", 300))); o.set("DialogResult", null); o.set("WindowStartupLocation", attr("WindowStartupLocation", "Manual")); g.forms.push(o); win = o; }
    if (kind === "TextBlock" || kind === "TextBox") o.set("Text", attr("Text", node.text.trim()));
    if (kind === "Label" || kind === "Button" || kind === "CheckBox" || kind === "RadioButton" || kind === "GroupBox" || kind === "ComboBoxItem" || kind === "ListBoxItem") o.set("Content", attr("Content", node.text.trim()));
    if (kind === "Button") { o.set("IsDefault", /true/i.test(attr("IsDefault", "False"))); o.set("IsCancel", /true/i.test(attr("IsCancel", "False"))); }
    if (kind === "CheckBox" || kind === "RadioButton") o.set("IsChecked", /true/i.test(attr("IsChecked", "False")));
    if (kind === "PasswordBox") o.set("Password", "");
    if (kind === "StackPanel" || kind === "WrapPanel") o.set("Orientation", attr("Orientation", kind === "WrapPanel" ? "Horizontal" : "Vertical"));
    if (kind === "TextBox") o.set("IsReadOnly", /true/i.test(attr("IsReadOnly", "False")));
    if (kind === "ProgressBar") { o.set("Value", toNumber(attr("Value", 0))); o.set("Maximum", toNumber(attr("Maximum", 100))); }
    if (kind === "ComboBox" || kind === "ListBox" || kind === "DataGrid") {
      var items = []; items.__list = "arraylist";
      o.set("Items", items); o.set("ItemsSource", null); o.set("SelectedIndex", -1); o.set("SelectedItem", null);
      if (kind === "DataGrid") { o.set("AutoGenerateColumns", true); o.set("IsReadOnly", /true/i.test(attr("IsReadOnly", "False"))); }
    }
    o.set("IsEnabled", !/false/i.test(attr("IsEnabled", "True")));
    o.set("Visibility", attr("Visibility", "Visible"));
    o.set("Foreground", attr("Foreground", null));
    o.set("Margin", attr("Margin", null));
    if (kind !== "Window") { o.set("Width", attr("Width", null) === null ? null : toNumber(attr("Width"))); o.set("Height", attr("Height", null) === null ? null : toNumber(attr("Height"))); }
    o.set("ToolTip", attr("ToolTip", null));
    o.methods = {};
    EVENTS.concat(["PasswordChanged"]).forEach(function (ev) {
      o.methods["add_" + lc(ev)] = function (args) {
        if (!(args[0] instanceof E.ScriptBlock)) throw err("Add_" + ev + " needs a script block: $control.Add_" + ev + "({ ... })", "InvalidArgument");
        (o.handlers[lc(ev)] = o.handlers[lc(ev)] || []).push(args[0]); return undefined;
      };
    });
    o.methods.focus = function () { return true; };
    node.children.forEach(function (c) {
      var child = buildWpf(session, c, win);
      if ((kind === "ComboBox" || kind === "ListBox") && (child.guiKind === "ComboBoxItem" || child.guiKind === "ListBoxItem")) { o.get("Items").push(child.get("Content")); return; }
      o.wpfChildren.push(child);
    });
    if (kind === "Window") {
      o.methods.findname = function (args) {
        var want = toStr(args[0]), hit = null;
        (function walk(c) { if (hit) return; if (lc(toStr(c.get("Name"))) === lc(want) && c.get("Name")) hit = c; (c.wpfChildren || []).forEach(walk); })(o);
        return hit;
      };
      o.methods.showdialog = function (args, ctx) { return showDialog(o, ctx); };
      o.methods.close = function () { o.closed = true; return undefined; };
      o.methods.activate = function () { return true; };
    }
    o.onSet = function (name, v) {
      var n = lc(name);
      if (n === "dialogresult" && kind === "Window" && v !== null) { o.wpfResult = toBool(v); o.closed = true; }
      if (n === "selectedindex" && (kind === "ComboBox" || kind === "ListBox")) { var src = o.get("ItemsSource") ? enumerate(o.get("ItemsSource")) : o.get("Items"); var i = toNumber(v); o.props[o.index.get("selecteditem")].value = i >= 0 && i < src.length ? src[i] : null; }
      if (n === "itemssource" && kind === "DataGrid") o.set("Rows", enumerate(v).map(function (x, i) { return rowObj(x, i); }));
    };
    o.toStringFn = function () { return o.typeName; };
    return o;
  }

  /* ================================================================== Hooking into the engine */
  var KINDS = ["Form", "Label", "TextBox", "Button", "CheckBox", "RadioButton", "ComboBox", "ListBox", "DataGridView", "GroupBox", "Panel", "ProgressBar", "NumericUpDown", "PictureBox"];
  var prevNew = lib.newObjectExtra;
  lib.newObjectExtra = function (tn, args, ctx) {
    var t = lc(tn).replace(/^system\./, "");
    var m = /^windows\.forms\.(\w+)$/.exec(t);
    if (m) {
      if (m[1] === "openfiledialog") return fileDialog("open", ctx.session);
      if (m[1] === "savefiledialog") return fileDialog("save", ctx.session);
      var kind = KINDS.filter(function (k) { return lc(k) === m[1]; })[0];
      if (kind) return makeControl(ctx.session, kind, "forms");
      throw err("Windows Forms control [System.Windows.Forms." + tn.split(".").pop() + "] isn't available in this lab. Available: " + KINDS.join(", ") + ", OpenFileDialog, SaveFileDialog.", "InvalidType");
    }
    if (t === "drawing.point") return point(toNumber(args[0] || 0), toNumber(args[1] || 0));
    if (t === "drawing.size") return size(toNumber(args[0] || 0), toNumber(args[1] || 0));
    if (t === "drawing.font") { var f = obj("System.Drawing.Font", { Name: toStr(args[0] || "Segoe UI"), Size: toNumber(args[1] || 9), Style: toStr(args[2] || "Regular") }); f.toStringFn = function () { return "[Font: Name=" + f.get("Name") + ", Size=" + f.get("Size") + "]"; }; return f; }
    if (t === "xml.xmlnodereader") { var rd = obj("System.Xml.XmlNodeReader", {}); rd.xmlDoc = args[0]; return rd; }
    return prevNew ? prevNew(tn, args, ctx) : undefined;
  };
  var prevConvert = lib.convert;
  lib.convert = function (v, typeName) {
    if (lc(typeName).replace(/^system\./, "") === "xml" || lc(typeName) === "xml.xmldocument") return xmlDoc(toStr(v));
    return prevConvert ? prevConvert(v, typeName) : undefined;
  };
  var prevSP = lib.staticPropertyExtra;
  lib.staticPropertyExtra = function (tn, name, ctx) {
    var t = lc(tn).replace(/^system\./, "");
    // Enums such as [System.Windows.Forms.DialogResult]::OK or [System.Drawing.Color]::Red are plain text in this lab.
    if (/^windows\.forms\.|^drawing\.color$|^windows\.|^drawing\.(fontstyle|contentalignment)$/.test(t)) return toStr(name);
    return prevSP ? prevSP(tn, name, ctx) : undefined;
  };
  var prevSM = lib.staticMethodExtra;
  lib.staticMethodExtra = function (tn, name, args, ctx) {
    var t = lc(tn).replace(/^system\./, ""), n = lc(name);
    if (t === "windows.forms.messagebox" && n === "show") return messageBox(args, ctx);
    if (t === "windows.forms.application") {
      if (n === "enablevisualstyles" || n === "setcompatibletextrenderingdefault" || n === "doevents") return undefined;
      if (n === "run") return showDialog(args[0], ctx);
    }
    if ((t === "windows.markup.xamlreader") && n === "load") {
      var src = args[0];
      var doc = src && src.xmlDoc ? src.xmlDoc : src;
      if (!(doc instanceof PSObject) || !doc.xmlRoot) throw err("XamlReader::Load needs an XmlNodeReader over an [xml] document: (New-Object System.Xml.XmlNodeReader $xaml).", "InvalidArgument");
      return buildWpf(ctx.session, doc.xmlRoot, null);
    }
    if (t === "windows.markup.xamlreader" && n === "parse") return buildWpf(ctx.session, parseXml(toStr(args[0])), null);
    return prevSM ? prevSM(tn, name, args, ctx) : undefined;
  };
  var ASSEMBLIES = ["system.windows.forms", "system.drawing", "presentationframework", "presentationcore", "windowsbase", "microsoft.visualbasic", "system.xml"];
  lib.cmdlets["add-type"] = {
    name: "Add-Type", module: "Microsoft.PowerShell.Utility",
    params: [{ name: "AssemblyName", position: null }, { name: "TypeDefinition", position: 0 }, { name: "Language", position: null }],
    run: function (b) {
      if (b.typedefinition !== undefined) throw err("Compiling C# with Add-Type -TypeDefinition isn't available in this lab.", "NotImplemented");
      enumerate(b.assemblyname).forEach(function (a) {
        if (ASSEMBLIES.indexOf(lc(toStr(a))) < 0) throw err("Cannot add type. The assembly '" + toStr(a) + "' could not be found.", "ObjectNotFound");
      });
      return [];
    },
    help: { synopsis: "Loads .NET assemblies: Add-Type -AssemblyName System.Windows.Forms (needed before using Windows Forms in Windows PowerShell 5.1).", examples: ["Add-Type -AssemblyName System.Windows.Forms"] }
  };

  // Lab-facing helpers for checks
  E.gui = { session: gui, Pause: Pause, parseXml: parseXml };
})(typeof window !== "undefined" ? window : globalThis);
