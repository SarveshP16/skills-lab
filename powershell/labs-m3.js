/* sudo learn — PowerShell Module 3: Building tools with a GUI (PS-119..125).
   GUI labs pause at ShowDialog / MessageBox / Out-GridView / file dialogs (see ps-gui.js). Checks drive the windows
   headlessly with r.interact([...]) and the helpers in G = PSLab.H.gui (find, click, text, select, check, answer, close). */
(function () {
  "use strict";
  var T = window.PS_TRACK, H = window.PSLab.H, G = H.gui, ps = T.ps, ex = T.ex;
  var DANA = "Dana Park · Windows team", DEV = "Dev Patel · Security", MAYA = "Maya Chen · SRE lead";
  var LABS = [];
  function asList(v) { return v === undefined || v === null ? [] : Array.isArray(v) ? v : [v]; }
  function str(v) { return v === null || v === undefined ? "" : window.PSEngine.toStr(v); }
  function ctl(r, name, kind) {
    var v = r.v(name);
    if (v === undefined || v === null) return "I can't find $" + name + " yet. Store the control in a variable called $" + name + ".";
    if (!v.guiKind) return "$" + name + " should be a " + kind + " control (New-Object System.Windows.Forms." + kind + "), but it's " + H.show(v) + ".";
    if (kind && v.guiKind !== kind) return "$" + name + " should be a " + kind + ", but it's a " + v.guiKind + ".";
    return v;
  }
  function needPause(r, kind) {
    if (r.error) return "The script stopped with an error before showing a window: " + r.error.message;
    if (!r.pause) return "The script finished without showing a window. Call " + (kind === "form" ? "$form.ShowDialog()" : "it") + " at the end.";
    if (kind && r.pause.kind !== kind) return "Expected the script to wait for a " + kind + ", but it's waiting for a " + r.pause.kind + ".";
    return true;
  }
  var GUI_NOTE = '<div class="callout"><b>Windows in the browser.</b> When your script opens a window, the page draws a <b>simulated</b> Windows window over the editor. Your script really is paused, waiting: every click and typed value goes back into it. Close the window (✕) to let the script finish. On your own Windows PC, the same code opens real windows (see <b>Try it for real</b> at the end of each lab).</div>';

  /* ================================================================== PS-119 */
  LABS.push({
    id: "ps-119", n: 19, module: 3, ticket: "PS-119", xp: 100,
    title: "Pick services to restart",
    topic: "Quick GUIs: Out-GridView & MessageBox",
    from: DANA,
    story: "<p>The help desk restarts services several times a day by typing names into a console, and typos are common. They'd like to <b>pick</b> services from a list, confirm, and get told what happened.</p>" +
      "<p>No need for a full application: PowerShell has two ready-made GUI pieces that cover this.</p>",
    learn: GUI_NOTE +
      "<h3>Out-GridView: a pick list in one line</h3><p>Pipe anything into <code>Out-GridView</code> and it opens a window with a table. With <code>-PassThru</code>, the rows the user selects come back out of the pipeline when they click OK (nothing, if they cancel). <code>-Title</code> sets the window title, and <code>-OutputMode Single</code> allows just one row.</p>" +
      ex("$chosen = Get-Process | Select-Object Name, Id, CPU | Out-GridView -Title 'Pick a process' -PassThru\n\"You picked: $($chosen.Name -join ', ')\"") +
      "<h3>MessageBox: ask or tell</h3><p>Windows Forms has a ready-made message box. Load the library once with <code>Add-Type</code>, then call the static method <code>[System.Windows.Forms.MessageBox]::Show(text, title, buttons, icon)</code>. It waits for a click and returns which button was clicked, as text: <code>OK</code>, <code>Yes</code>, <code>No</code>, <code>Cancel</code>...</p>" +
      ex('Add-Type -AssemblyName System.Windows.Forms\n$answer = [System.Windows.Forms.MessageBox]::Show("Delete the temp files?", "Confirm", "YesNo", "Question")\n"You said: $answer"') +
      '<table class="t"><tr><th>Buttons</th><th>Icon</th></tr><tr><td><code>OK</code>, <code>OKCancel</code>, <code>YesNo</code>, <code>YesNoCancel</code></td><td><code>Information</code>, <code>Question</code>, <code>Warning</code>, <code>Error</code></td></tr></table>' +
      '<div class="callout warn"><b>Gotcha:</b> <code>Show()</code> returns a value, so if you don\'t store it, PowerShell prints it (an unexpected <code>OK</code> in your output). Assign it, or put <code>[void]</code> in front: <code>[void][System.Windows.Forms.MessageBox]::Show("Done")</code>.</div>' +
      "<h3>Stopping early</h3><p>If the user cancels, there's nothing to do: <code>return</code> at the top level of a script ends it.</p>",
    starter: ps`
      # PS-119 · Pick services to restart
      Add-Type -AssemblyName System.Windows.Forms

      # 1) $picked: the running services, shown with Out-GridView titled "Pick services to restart"; the rows the user picks


      # 2) If nothing was picked, end the script. Otherwise ask, in a YesNo MessageBox titled "Confirm":
      #    Restart 2 service(s)?     (with the real number)


      # 3) If the answer is Yes: restart them, then show an OK MessageBox titled "Done" with the Information icon:
      #    Restarted: W3SVC, WinRM   (the names, joined with ", ")
    `,
    objectives: [
      {
        id: "grid",
        text: "The running services appear in an <code>Out-GridView</code> window titled <code>Pick services to restart</code>, and the picked rows go into <code>$picked</code>.",
        hints: ["Get-Service | Where-Object Status -eq Running | Out-GridView -Title '...' -PassThru", "$picked = Get-Service | Where-Object Status -eq Running | Out-GridView -Title 'Pick services to restart' -PassThru"],
        check: function (r) {
          var p = needPause(r, "grid");
          if (p !== true) return p === "Expected the script to wait for a grid, but it's waiting for a messagebox." ? "The MessageBox appeared before Out-GridView. Show the list first." : p;
          var g = r.gui.grids[r.pause.gridIndex];
          if (g.title !== "Pick services to restart") return "The grid's title is " + H.show(g.title) + ". Use -Title 'Pick services to restart'.";
          if (g.mode === "none") return "Add -PassThru so the picked rows come back.";
          var names = g.items.map(function (x) { return str(x.get ? x.get("Name") : x); });
          var want = r.system.services.filter(function (s) { return s.Status === "Running"; }).map(function (s) { return s.Name; }).sort(function (a, b) { return a.toLowerCase() < b.toLowerCase() ? -1 : 1; });
          if (!H.same(names, want)) return "The grid should list only the running services (" + want.length + "), got " + names.length + " rows.";
          var i = names.indexOf("W3SVC");
          var r2 = r.interact([G.answer([i])]);
          var picked = asList(r2.v("picked"));
          if (picked.length !== 1 || str(picked[0].get("Name")) !== "W3SVC") return "After picking W3SVC in the grid, $picked should hold that service.";
          return true;
        }
      },
      {
        id: "confirm",
        text: "After picking, a <code>YesNo</code> MessageBox titled <code>Confirm</code> asks <code>Restart 2 service(s)?</code>; answering <b>No</b> restarts nothing.",
        hints: ['$answer = [System.Windows.Forms.MessageBox]::Show("Restart $(@($picked).Count) service(s)?", "Confirm", "YesNo", "Question")', 'if (-not $picked) { return }\n$answer = [System.Windows.Forms.MessageBox]::Show("Restart $(@($picked).Count) service(s)?", "Confirm", "YesNo", "Question")'],
        check: function (r) {
          if (!r.pause || r.pause.kind !== "grid") return "Do the first task first: the script should open the grid.";
          var names = r.gui.grids[r.pause.gridIndex].items.map(function (x) { return str(x.get("Name")); });
          var pick = [names.indexOf("W3SVC"), names.indexOf("WinRM")];
          var r2 = r.interact([G.answer(pick)]);
          if (!r2.pause || r2.pause.kind !== "messagebox") return "After picking 2 services, the script should ask with a MessageBox.";
          var m = r2.pause;
          if (m.text !== "Restart 2 service(s)?" || m.caption !== "Confirm" || m.buttons.join(",") !== "Yes,No") return "The question should be a YesNo MessageBox titled Confirm saying \"Restart 2 service(s)?\". It was: " + H.show(m.text) + " titled " + H.show(m.caption) + " with buttons " + m.buttons.join("/") + ".";
          var r3 = r2.interact([G.answer(pick), G.answer("No")]);
          if (r3.system.actions.some(function (a) { return /^Restart-Service/.test(a); })) return "After answering No, nothing should be restarted.";
          if (r3.pause) return "After answering No, the script should finish (no more windows).";
          return true;
        }
      },
      {
        id: "done",
        text: "Answering <b>Yes</b> restarts exactly the picked services, then shows an Information MessageBox titled <code>Done</code>: <code>Restarted: W3SVC, WinRM</code>.",
        hints: ["if ($answer -eq 'Yes') { $picked | Restart-Service; [void][System.Windows.Forms.MessageBox]::Show(\"Restarted: $($picked.Name -join ', ')\", 'Done', 'OK', 'Information') }",
          'if ($answer -eq "Yes") {\n    $picked | Restart-Service\n    [void][System.Windows.Forms.MessageBox]::Show("Restarted: $($picked.Name -join \', \')", "Done", "OK", "Information")\n}'],
        check: function (r) {
          if (!r.pause || r.pause.kind !== "grid") return "Do the first task first: the script should open the grid.";
          var names = r.gui.grids[r.pause.gridIndex].items.map(function (x) { return str(x.get("Name")); });
          var pick = [names.indexOf("W3SVC"), names.indexOf("WinRM")];
          var r2 = r.interact([G.answer(pick), G.answer("Yes")]);
          var acts = r2.system.actions.filter(function (a) { return /^Restart-Service/.test(a); });
          if (!H.same(acts, ["Restart-Service W3SVC", "Restart-Service WinRM"])) return "After Yes, W3SVC and WinRM should be restarted (and nothing else). Restarted: " + H.show(acts) + ".";
          if (!r2.pause || r2.pause.kind !== "messagebox") return "After restarting, show a MessageBox saying what was restarted.";
          var m = r2.pause;
          if (m.text !== "Restarted: W3SVC, WinRM" || m.caption !== "Done" || !/information/i.test(m.icon)) return "The last MessageBox should say \"Restarted: W3SVC, WinRM\", titled Done, with the Information icon. It said " + H.show(m.text) + " titled " + H.show(m.caption) + " (icon " + m.icon + ").";
          var r3 = r2.interact([G.answer(pick), G.answer("Yes"), G.answer("OK")]);
          if (r3.lines.some(function (l) { return /^(OK|Yes)$/.test(l); })) return "The script printed the MessageBox's answer (OK/Yes). Store it or put [void] in front of the call.";
          return true;
        }
      },
      {
        id: "cancel",
        text: "If the user cancels the grid (or picks nothing), no MessageBox appears and nothing is restarted.",
        hints: ["if (-not $picked) { return }", "if (-not $picked) { return }"],
        check: function (r) {
          if (!r.pause || r.pause.kind !== "grid") return "Do the first task first: the script should open the grid.";
          var r2 = r.interact([G.answer([])]);
          if (r2.pause) return "After cancelling the grid, the script shows another window (" + r2.pause.kind + "). Stop when $picked is empty.";
          if (r2.system.actions.length) return "After cancelling, nothing should happen, but it did: " + r2.system.actions.join(", ");
          return true;
        }
      }
    ],
    debrief: "<p>Ticket closed. In about ten lines, the help desk got a pick list with filtering, a confirmation step and a report, and they'll never mistype a service name again. Out-GridView and MessageBox are the quickest wins in PowerShell GUI work: no layout, no events.</p>" +
      "<p>When you need more than a list and a question, it's time for a real window. That's next.</p>",
    realworld: "On your Windows PC: Get-Service | Out-GridView -PassThru | Select-Object Name (Out-GridView is built into Windows PowerShell 5.1; in PowerShell 7 install it with Install-Module Microsoft.PowerShell.GraphicalTools). Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.MessageBox]::Show('Hello') works in both.",
    quiz: [
      { q: "What does <code>-PassThru</code> do on Out-GridView?", options: ["Shows the window", "Sends the rows the user picks down the pipeline", "Skips the window", "Sorts the rows"], answer: 1, why: "Without it, Out-GridView just displays the data." },
      { q: "What does <code>[System.Windows.Forms.MessageBox]::Show('Sure?', 'Q', 'YesNo')</code> return?", options: ["$true or $false", "The text of the clicked button: Yes or No", "Nothing", "1 or 0"], answer: 1, why: "It returns a DialogResult, which compares like the text Yes/No." },
      { q: "Why might <code>OK</code> appear in your output unexpectedly?", options: ["A bug in Windows", "Show() returned a value that wasn't stored, so PowerShell printed it", "Out-GridView printed it", "It's the exit code"], answer: 1, why: "Store the result or cast it to [void]." }
    ]
  });

  /* ================================================================== PS-120 */
  var FORM_BASE = ps`
    Add-Type -AssemblyName System.Windows.Forms

    $form = New-Object System.Windows.Forms.Form
    $form.Text = "Server lookup"
    $form.Size = New-Object System.Drawing.Size(400, 220)
    $form.StartPosition = "CenterScreen"

    $nameLabel = New-Object System.Windows.Forms.Label
    $nameLabel.Text = "Service name:"
    $nameLabel.Location = New-Object System.Drawing.Point(20, 20)
    $nameLabel.AutoSize = $true

    $nameBox = New-Object System.Windows.Forms.TextBox
    $nameBox.Location = New-Object System.Drawing.Point(130, 18)
    $nameBox.Width = 200

    $lookupButton = New-Object System.Windows.Forms.Button
    $lookupButton.Text = "Look up"
    $lookupButton.Location = New-Object System.Drawing.Point(130, 60)
    $lookupButton.Width = 100

    $resultLabel = New-Object System.Windows.Forms.Label
    $resultLabel.Location = New-Object System.Drawing.Point(20, 100)
    $resultLabel.Size = New-Object System.Drawing.Size(340, 40)

    $form.Controls.AddRange(@($nameLabel, $nameBox, $lookupButton, $resultLabel))
  `;
  LABS.push({
    id: "ps-120", n: 20, module: 3, ticket: "PS-120", xp: 100,
    title: "Your first window",
    topic: "Windows Forms basics",
    from: DANA,
    story: "<p>Next request from the help desk: a small <b>Server lookup</b> tool where they type a service name and see its status. Today, just build the window. Next ticket, we'll make it work.</p>",
    learn: GUI_NOTE +
      "<h3>Windows Forms in four steps</h3><ol><li>Load the library: <code>Add-Type -AssemblyName System.Windows.Forms</code>.</li><li>Create a <b>Form</b> (the window) and <b>controls</b> with <code>New-Object</code>.</li><li>Set their properties and add them to <code>$form.Controls</code>.</li><li>Show it with <code>$form.ShowDialog()</code>.</li></ol>" +
      ex('Add-Type -AssemblyName System.Windows.Forms\n$form = New-Object System.Windows.Forms.Form\n$form.Text = "Hello"\n$form.Size = New-Object System.Drawing.Size(300, 150)\n$label = New-Object System.Windows.Forms.Label\n$label.Text = "Hi from PowerShell!"\n$label.Location = New-Object System.Drawing.Point(20, 20)\n$label.AutoSize = $true\n$form.Controls.Add($label)\n$form.ShowDialog()') +
      "<h3>Position and size</h3><p>Every control sits at a <code>Location</code> (x, y from the window's top-left corner, in pixels) and has a <code>Size</code> (width, height). Make them with <code>New-Object System.Drawing.Point(x, y)</code> and <code>System.Drawing.Size(w, h)</code>, or set <code>.Left</code>, <code>.Top</code>, <code>.Width</code>, <code>.Height</code> one at a time.</p>" +
      '<table class="t"><tr><th>Control</th><th>Key properties</th></tr>' +
      "<tr><td><code>Form</code></td><td><code>Text</code> (title), <code>Size</code>, <code>StartPosition = \"CenterScreen\"</code></td></tr>" +
      "<tr><td><code>Label</code></td><td><code>Text</code>, <code>AutoSize</code></td></tr>" +
      "<tr><td><code>TextBox</code></td><td><code>Text</code>, <code>Width</code>, <code>ReadOnly</code></td></tr>" +
      "<tr><td><code>Button</code></td><td><code>Text</code></td></tr></table>" +
      "<p>Several controls at once: <code>$form.Controls.AddRange(@($a, $b, $c))</code>.</p>" +
      "<h3>ShowDialog() waits</h3><p><code>ShowDialog()</code> shows the window and <b>pauses your script</b> until the window closes. Then it returns how it was closed: <code>Cancel</code> for the ✕ button, or <code>OK</code> etc. if a button set the form's <code>DialogResult</code>. Code after it runs only when the window has gone.</p>",
    starter: ps`
      # PS-120 · Your first window
      Add-Type -AssemblyName System.Windows.Forms

      # 1) $form: title "Server lookup", size 400 x 220, StartPosition "CenterScreen"

      # 2) $nameLabel: "Service name:" at (20, 20), AutoSize
      #    $nameBox: a TextBox at (130, 18), 200 wide
      #    $lookupButton: "Look up" at (130, 60), 100 wide
      #    $resultLabel: an empty Label at (20, 100), size 340 x 40

      # 3) Add the four controls to the form

      # 4) Show it. When it closes, print "Window closed: <result>"
    `,
    objectives: [
      {
        id: "form",
        text: "<code>$form</code> is a Form titled <code>Server lookup</code>, 400 × 220, with <code>StartPosition</code> <code>CenterScreen</code>.",
        hints: ["New-Object System.Windows.Forms.Form, then set .Text, .Size (a System.Drawing.Size) and .StartPosition.", '$form = New-Object System.Windows.Forms.Form\n$form.Text = "Server lookup"\n$form.Size = New-Object System.Drawing.Size(400, 220)\n$form.StartPosition = "CenterScreen"'],
        check: function (r) {
          var f = ctl(r, "form", "Form");
          if (typeof f === "string") return f;
          if (str(f.get("Text")) !== "Server lookup") return "The form's Text (title) should be \"Server lookup\".";
          if (f.get("Width") !== 400 || f.get("Height") !== 220) return "The form should be 400 x 220, but it's " + f.get("Width") + " x " + f.get("Height") + ".";
          if (str(f.get("StartPosition")) !== "CenterScreen") return "Set $form.StartPosition = \"CenterScreen\".";
          return true;
        }
      },
      {
        id: "controls",
        text: "<code>$nameLabel</code>, <code>$nameBox</code>, <code>$lookupButton</code> and <code>$resultLabel</code> exist with the texts, positions and sizes above.",
        hints: ["Each one: New-Object, then .Text / .Location (System.Drawing.Point) / .Width or .Size.", FORM_BASE.split("$form.Controls")[0].split("\n").slice(7).join("\n").trim()],
        check: function (r) {
          var specs = [["nameLabel", "Label", "Service name:", 20, 20], ["nameBox", "TextBox", null, 130, 18, 200], ["lookupButton", "Button", "Look up", 130, 60, 100], ["resultLabel", "Label", "", 20, 100, 340, 40]];
          for (var i = 0; i < specs.length; i++) {
            var s = specs[i], c = ctl(r, s[0], s[1]);
            if (typeof c === "string") return c;
            if (s[2] !== null && str(c.get("Text")) !== s[2]) return "$" + s[0] + ".Text should be " + H.show(s[2]) + ".";
            if (c.get("Left") !== s[3] || c.get("Top") !== s[4]) return "$" + s[0] + " should be at (" + s[3] + ", " + s[4] + "), but it's at (" + c.get("Left") + ", " + c.get("Top") + "). Use .Location = New-Object System.Drawing.Point(x, y).";
            if (s[5] && c.get("Width") !== s[5]) return "$" + s[0] + " should be " + s[5] + " wide.";
            if (s[6] && c.get("Height") !== s[6]) return "$" + s[0] + " should be " + s[6] + " high.";
          }
          if (!window.PSEngine.toBool(r.v("nameLabel").get("AutoSize"))) return "Set $nameLabel.AutoSize = $true, so the label fits its text.";
          return true;
        }
      },
      {
        id: "added",
        text: "All four controls are added to <code>$form.Controls</code>.",
        hints: ["$form.Controls.AddRange(@(...)) or one .Add() per control.", "$form.Controls.AddRange(@($nameLabel, $nameBox, $lookupButton, $resultLabel))"],
        check: function (r) {
          var f = r.v("form");
          if (!f || !f.guiKind) return "Do the first task first.";
          var cs = f.get("Controls") || [];
          var missing = ["nameLabel", "nameBox", "lookupButton", "resultLabel"].filter(function (n) { return cs.indexOf(r.v(n)) < 0; });
          if (missing.length) return "Not on the form yet: " + missing.map(function (n) { return "$" + n; }).join(", ") + ". Add them to $form.Controls.";
          return true;
        }
      },
      {
        id: "show",
        text: "The script shows the window with <code>ShowDialog()</code>, and after it's closed prints <code>Window closed: Cancel</code>.",
        hints: ["$result = $form.ShowDialog(), then \"Window closed: $result\".", '$result = $form.ShowDialog()\n"Window closed: $result"'],
        check: function (r) {
          var p = needPause(r, "form");
          if (p !== true) return p;
          var r2 = r.interact([G.close()]);
          if (r2.lines.indexOf("Window closed: Cancel") < 0) return "After closing the window with ✕, print \"Window closed: <result>\" (it should be Cancel). Printed: " + H.show(r2.lines);
          return true;
        }
      }
    ],
    debrief: "<p>Ticket closed: a real window with a label, a box, a button and space for the answer. Notice that <code>Window closed: Cancel</code> appeared only after the window closed: <code>ShowDialog()</code> holds the script until then.</p>" +
      "<p>Right now the button does nothing. Buttons need <b>event handlers</b>, which is the next ticket.</p>",
    realworld: "Paste the solution into the PowerShell ISE or VS Code on your Windows PC and run it: you'll get a real Windows window. In Windows PowerShell 5.1, Add-Type -AssemblyName System.Windows.Forms is required; in PowerShell 7 on Windows it's built in but harmless to keep.",
    quiz: [
      { q: "What does <code>ShowDialog()</code> do to your script?", options: ["Nothing: it keeps running", "Pauses it until the window closes", "Ends it", "Runs it twice"], answer: 1, why: "Code after ShowDialog runs once the window is closed." },
      { q: "A control's <code>Location</code> is measured from…", options: ["The screen's top-left", "The window's top-left (inside it)", "The window's centre", "The previous control"], answer: 1, why: "Coordinates are relative to the container." },
      { q: "Closing the window with ✕ makes ShowDialog() return…", options: ["OK", "Cancel", "$null", "Closed"], answer: 1, why: "Unless something set DialogResult, closing counts as Cancel." }
    ]
  });

  /* ================================================================== PS-121 */
  function lookupRun(r, text, extra) {
    var box = r.v("nameBox"), btn = r.v("lookupButton");
    if (!box || !box.guiId || !btn || !btn.guiId) return null;
    var list = [];
    asList(text).forEach(function (t) { list.push(G.text(box, t)); list.push(G.click(btn)); });
    return r.interact(list.concat(extra || []));
  }
  LABS.push({
    id: "ps-121", n: 21, module: 3, ticket: "PS-121", xp: 100,
    title: "Make the button work",
    topic: "Events: Add_Click, validation, scope",
    from: DANA,
    story: "<p>The window from PS-120 is ready (it's in the starter code). Now wire it up: when someone clicks <b>Look up</b>, or presses Enter, show the service's status, in green if it's running and red if it isn't.</p>" +
      "<p>The help desk also want to know how many lookups they do in a session, and they will type nonsense, so handle that too.</p>",
    learn:
      "<h3>Events and handlers</h3><p>A window spends its life <b>waiting</b> for things to happen: clicks, typing, selections. To react, you attach a <b>handler</b>, a script block that runs each time the event fires:</p>" +
      ex('Add-Type -AssemblyName System.Windows.Forms\n$form = New-Object System.Windows.Forms.Form\n$button = New-Object System.Windows.Forms.Button\n$button.Text = "Click me"\n$label = New-Object System.Windows.Forms.Label\n$label.Location = New-Object System.Drawing.Point(0, 40)\n$button.Add_Click({ $label.Text = "Clicked at $(Get-Date -Format HH:mm:ss)" })\n$form.Controls.AddRange(@($button, $label))\n[void]$form.ShowDialog()') +
      "<p>Inside a handler you can read other controls (<code>$nameBox.Text</code>) and change them (<code>$resultLabel.Text = ...</code>, <code>$resultLabel.ForeColor = \"Green\"</code>). The window updates on its own.</p>" +
      "<h3>Validate input</h3><p>Users type anything. Check the input before using it, and turn errors into friendly messages: <code>.Trim()</code> the text, refuse empty input, and wrap risky calls in <code>try/catch</code> with <code>-ErrorAction Stop</code> (PS-114).</p>" +
      "<h3>The scope trap</h3><p>A handler is a script block that runs in its <b>own scope</b>, like a function (PS-108). Reading script variables works, but <code>$count++</code> inside a handler changes a <b>local copy</b> that vanishes when the handler ends. Use <code>$script:count++</code>.</p>" +
      "<h3>The Enter key</h3><p>Set <code>$form.AcceptButton = $lookupButton</code> and pressing Enter in the window clicks that button. (<code>CancelButton</code> does the same for Esc.)</p>",
    starter: FORM_BASE + "\n\n" + ps`
      # PS-121 · Make the button work
      # 1-3) When Look up is clicked: show "<name> is <Status>" in $resultLabel (ForeColor Green if Running, otherwise Red),
      #      "Type a service name first." if the box is empty, or "No service called <name>" if it doesn't exist.
      # 4) Count the lookups in $lookups, and make Enter click the button.
      $lookups = 0


      [void]$form.ShowDialog()
    `,
    objectives: [
      {
        id: "click",
        text: "Clicking <b>Look up</b> with <code>W3SVC</code> shows <code>W3SVC is Running</code> in green; <code>KestrelUpdater</code> shows <code>KestrelUpdater is Stopped</code> in red.",
        hints: ["$lookupButton.Add_Click({ ... }): get the service with Get-Service -Name $nameBox.Text.Trim(), then set $resultLabel.Text and .ForeColor.",
          '$lookupButton.Add_Click({\n    $name = $nameBox.Text.Trim()\n    $svc = Get-Service -Name $name\n    $resultLabel.Text = "$name is $($svc.Status)"\n    $resultLabel.ForeColor = if ($svc.Status -eq "Running") { "Green" } else { "Red" }\n})'],
        check: function (r) {
          var p = needPause(r, "form");
          if (p !== true) return p;
          var r2 = lookupRun(r, "W3SVC");
          if (!r2) return "Keep $nameBox and $lookupButton from the starter.";
          var lbl = r2.v("resultLabel");
          if (str(lbl.get("Text")) !== "W3SVC is Running") return "After typing W3SVC and clicking Look up, $resultLabel should say \"W3SVC is Running\", but it says " + H.show(str(lbl.get("Text"))) + ".";
          if (str(lbl.get("ForeColor")).toLowerCase() !== "green") return "For a running service, set $resultLabel.ForeColor = \"Green\".";
          var r3 = lookupRun(r, "KestrelUpdater");
          var l3 = r3.v("resultLabel");
          if (str(l3.get("Text")) !== "KestrelUpdater is Stopped" || str(l3.get("ForeColor")).toLowerCase() !== "red") return "For KestrelUpdater it should say \"KestrelUpdater is Stopped\" in Red. It says " + H.show(str(l3.get("Text"))) + " (" + str(l3.get("ForeColor")) + ").";
          return true;
        }
      },
      {
        id: "empty",
        text: "With an empty box (or only spaces), the label says <code>Type a service name first.</code>",
        hints: ["if (-not $name) { $resultLabel.Text = \"Type a service name first.\"; return }  (return inside a handler leaves the handler)"],
        check: function (r) {
          if (!r.pause) return "Do the first task first.";
          var r2 = lookupRun(r, "   ");
          if (!r2) return "Keep $nameBox and $lookupButton from the starter.";
          if (r2.errors.length) return "With an empty box, an error was shown: " + r2.errors[0];
          return str(r2.v("resultLabel").get("Text")) === "Type a service name first." ? true : "With an empty box, $resultLabel should say \"Type a service name first.\" It says " + H.show(str(r2.v("resultLabel").get("Text"))) + ".";
        }
      },
      {
        id: "missing",
        text: "For a name that doesn't exist (<code>Nope</code>), the label says <code>No service called Nope</code>, with no red error in the console.",
        hints: ["try { $svc = Get-Service -Name $name -ErrorAction Stop ... } catch { $resultLabel.Text = \"No service called $name\" }"],
        check: function (r) {
          if (!r.pause) return "Do the first task first.";
          var r2 = lookupRun(r, "Nope");
          if (!r2) return "Keep $nameBox and $lookupButton from the starter.";
          if (r2.errors.length) return "An error was shown in the console: " + r2.errors[0] + "\nUse try/catch with -ErrorAction Stop.";
          return str(r2.v("resultLabel").get("Text")) === "No service called Nope" ? true : "For Nope, $resultLabel should say \"No service called Nope\". It says " + H.show(str(r2.v("resultLabel").get("Text"))) + ".";
        }
      },
      {
        id: "count",
        text: "<code>$lookups</code> counts every click (2 clicks → 2), and pressing Enter clicks <b>Look up</b> (<code>$form.AcceptButton</code>).",
        hints: ["$script:lookups++ inside the handler; $form.AcceptButton = $lookupButton.", "$form.AcceptButton = $lookupButton\n# and in the handler:\n$script:lookups++"],
        check: function (r) {
          if (!r.pause) return "Do the first task first.";
          var r2 = lookupRun(r, ["W3SVC", "Nope"], [G.close()]);
          if (!r2) return "Keep $nameBox and $lookupButton from the starter.";
          if (r2.v("lookups") === 0) return "After 2 lookups, $lookups is still 0: the handler changed a local copy. Use $script:lookups++.";
          if (r2.v("lookups") !== 2) return "After 2 lookups, $lookups should be 2, but it's " + H.show(r2.v("lookups")) + ".";
          if (r.v("form").get("AcceptButton") !== r.v("lookupButton")) return "Set $form.AcceptButton = $lookupButton so Enter clicks it.";
          return true;
        }
      }
    ],
    debrief: "<p>Ticket closed: a working tool. The three ideas behind every GUI are now yours: <b>handlers</b> react to events, <b>validation</b> turns bad input into a message instead of a crash, and <b>$script:</b> lets a handler change state that outlives the click.</p>",
    realworld: "Add $nameBox.Add_TextChanged({ $resultLabel.Text = '' }) to clear the old answer as the user types, then run it on your PC. TextChanged, SelectedIndexChanged and CheckedChanged are the other everyday events.",
    quiz: [
      { q: "When does the script block in <code>$button.Add_Click({ ... })</code> run?", options: ["Immediately", "Every time the button is clicked", "Once, when the window opens", "When the window closes"], answer: 1, why: "Add_Click registers a handler for later." },
      { q: "A handler does <code>$count++</code>. What happens to the script's <code>$count</code>?", options: ["It goes up", "Nothing: the handler changed its own local copy", "An error", "It resets to 0"], answer: 1, why: "Use $script:count++." },
      { q: "What does <code>$form.AcceptButton = $okButton</code> do?", options: ["Enables the button", "Pressing Enter clicks that button", "Closes the form", "Colours it blue"], answer: 1, why: "CancelButton does the same for Esc." }
    ]
  });

  /* ================================================================== PS-122 */
  LABS.push({
    id: "ps-122", n: 22, module: 3, ticket: "PS-122", xp: 100,
    title: "Pick, filter, show",
    topic: "Lists & grids: ComboBox, CheckBox, DataGridView",
    from: MAYA,
    story: "<p>The on-call team want a dashboard window: choose any service from a drop-down to see its status, tick a box to show only the stopped ones, and see a table of running processes underneath.</p>" +
      "<p>No typing means no typos.</p>",
    learn:
      "<h3>ComboBox and ListBox</h3><p>Both hold a list of <code>Items</code>. Add with <code>.Items.Add(x)</code> or <code>.Items.AddRange(@(...))</code>, empty with <code>.Items.Clear()</code>. The user's choice is in <code>.SelectedItem</code> (and <code>.SelectedIndex</code>, -1 for none), and choosing fires <code>SelectedIndexChanged</code>. <code>DropDownStyle = \"DropDownList\"</code> stops people typing their own text.</p>" +
      ex('Add-Type -AssemblyName System.Windows.Forms\n$form = New-Object System.Windows.Forms.Form\n$combo = New-Object System.Windows.Forms.ComboBox\n$combo.DropDownStyle = "DropDownList"\n$combo.Items.AddRange(@("red", "green", "blue"))\n$label = New-Object System.Windows.Forms.Label\n$label.Location = New-Object System.Drawing.Point(0, 40)\n$combo.Add_SelectedIndexChanged({ $label.Text = "You chose $($combo.SelectedItem)" })\n$form.Controls.AddRange(@($combo, $label))\n[void]$form.ShowDialog()') +
      '<div class="callout warn"><b>Gotcha:</b> <code>.Items.Add()</code> returns the new item\'s index, which ends up in your output. Use <code>[void]$combo.Items.Add($x)</code> in loops.</div>' +
      "<h3>CheckBox</h3><p><code>.Checked</code> is <code>$true</code> or <code>$false</code>, and changing it fires <code>CheckedChanged</code>.</p>" +
      "<h3>DataGridView: a table of objects</h3><p>Set <code>.DataSource</code> and the grid shows one row per object and one column per property. It needs a proper list, so wrap your objects in an <code>ArrayList</code>:</p>" +
      ex('Add-Type -AssemblyName System.Windows.Forms\n$form = New-Object System.Windows.Forms.Form\n$form.Size = New-Object System.Drawing.Size(500, 300)\n$grid = New-Object System.Windows.Forms.DataGridView\n$grid.Size = New-Object System.Drawing.Size(460, 220)\n$grid.DataSource = [System.Collections.ArrayList]@(Get-Service | Select-Object Name, Status)\n$form.Controls.Add($grid)\n[void]$form.ShowDialog()') +
      "<p>Select the properties you want first with <code>Select-Object</code>: the grid shows every property it's given.</p>",
    starter: ps`
      # PS-122 · Pick, filter, show
      Add-Type -AssemblyName System.Windows.Forms

      $form = New-Object System.Windows.Forms.Form
      $form.Text = "Service dashboard"
      $form.Size = New-Object System.Drawing.Size(520, 420)

      # 1) $serviceBox: a ComboBox (DropDownList) at (20, 20), 220 wide, listing every service name

      # 2) $statusLabel: a Label at (260, 22), 230 wide. When a service is chosen: "<name>: <Status> (<StartType>)"

      # 3) $stoppedOnly: a CheckBox "Only stopped" at (20, 55). When ticked, the ComboBox lists only stopped services;
      #    when unticked, all of them again

      # 4) $grid: a DataGridView at (20, 90), size 470 x 270, showing the processes' Name, Id and CPU


      [void]$form.ShowDialog()
    `,
    objectives: [
      {
        id: "combo",
        text: "<code>$serviceBox</code> is a <code>DropDownList</code> ComboBox listing every service name, in the order Get-Service gives them.",
        hints: ["foreach ($s in Get-Service) { [void]$serviceBox.Items.Add($s.Name) }, or .Items.AddRange(@((Get-Service).Name)).",
          '$serviceBox = New-Object System.Windows.Forms.ComboBox\n$serviceBox.DropDownStyle = "DropDownList"\n$serviceBox.Location = New-Object System.Drawing.Point(20, 20)\n$serviceBox.Width = 220\n$serviceBox.Items.AddRange(@((Get-Service).Name))\n$form.Controls.Add($serviceBox)'],
        check: function (r) {
          var p = needPause(r, "form");
          if (p !== true) return p;
          var c = ctl(r, "serviceBox", "ComboBox");
          if (typeof c === "string") return c;
          if (str(c.get("DropDownStyle")) !== "DropDownList") return "Set $serviceBox.DropDownStyle = \"DropDownList\".";
          var want = r.system.services.map(function (s) { return s.Name; }).sort(function (a, b) { return a.toLowerCase() < b.toLowerCase() ? -1 : 1; });
          if (!H.same(H.plain(c.get("Items")), want)) return "$serviceBox.Items should be the " + want.length + " service names. It has " + asList(c.get("Items")).length + " items.";
          if ((r.v("form").get("Controls") || []).indexOf(c) < 0) return "Add $serviceBox to $form.Controls.";
          if (r.lines.some(function (l) { return /^\d+$/.test(l); })) return "Numbers were printed: .Items.Add() returns an index. Use [void]$serviceBox.Items.Add(...) or AddRange.";
          return true;
        }
      },
      {
        id: "status",
        text: "Choosing a service shows <code>&lt;name&gt;: &lt;Status&gt; (&lt;StartType&gt;)</code> in <code>$statusLabel</code>, e.g. <code>KestrelUpdater: Stopped (Automatic)</code>.",
        hints: ["$serviceBox.Add_SelectedIndexChanged({ $s = Get-Service -Name $serviceBox.SelectedItem; $statusLabel.Text = ... })",
          '$serviceBox.Add_SelectedIndexChanged({\n    $s = Get-Service -Name $serviceBox.SelectedItem\n    $statusLabel.Text = "$($s.Name): $($s.Status) ($($s.StartType))"\n})'],
        check: function (r) {
          var c = r.v("serviceBox"), l = ctl(r, "statusLabel", "Label");
          if (!c || !c.guiId) return "Do the first task first.";
          if (typeof l === "string") return l;
          var i = H.plain(c.get("Items")).indexOf("KestrelUpdater");
          var r2 = r.interact([G.select(c, i)]);
          var t = str(r2.v("statusLabel").get("Text"));
          if (t !== "KestrelUpdater: Stopped (Automatic)") return "After choosing KestrelUpdater, $statusLabel should say \"KestrelUpdater: Stopped (Automatic)\". It says " + H.show(t) + ".";
          return true;
        }
      },
      {
        id: "filter",
        text: "Ticking <code>$stoppedOnly</code> (<code>Only stopped</code>) leaves only the stopped services in the list; unticking brings them all back.",
        hints: ["$stoppedOnly.Add_CheckedChanged({ $serviceBox.Items.Clear(); ... add the names, filtered when $stoppedOnly.Checked })",
          '$stoppedOnly.Add_CheckedChanged({\n    $serviceBox.Items.Clear()\n    $list = Get-Service\n    if ($stoppedOnly.Checked) { $list = $list | Where-Object Status -eq "Stopped" }\n    foreach ($s in $list) { [void]$serviceBox.Items.Add($s.Name) }\n})'],
        check: function (r) {
          var c = r.v("serviceBox"), cb = ctl(r, "stoppedOnly", "CheckBox");
          if (!c || !c.guiId) return "Do the first task first.";
          if (typeof cb === "string") return cb;
          if (str(cb.get("Text")) !== "Only stopped") return "The CheckBox's Text should be \"Only stopped\".";
          var r2 = r.interact([G.check(cb, true)]);
          var items = H.plain(r2.v("serviceBox").get("Items"));
          if (!H.same(items, ["KestrelUpdater", "RemoteRegistry", "wuauserv"])) return "After ticking Only stopped, the list should be KestrelUpdater, RemoteRegistry, wuauserv. It's " + H.show(items) + ".";
          var r3 = r.interact([G.check(cb, true), G.check(cb, false)]);
          if (asList(r3.v("serviceBox").get("Items")).length !== r.system.services.length) return "After unticking, all " + r.system.services.length + " services should be listed again (Items.Clear() first, then add).";
          return true;
        }
      },
      {
        id: "grid",
        text: "<code>$grid</code> is a DataGridView whose <code>DataSource</code> holds every process with just <code>Name</code>, <code>Id</code> and <code>CPU</code>.",
        hints: ["$grid.DataSource = [System.Collections.ArrayList]@(Get-Process | Select-Object Name, Id, CPU)",
          '$grid = New-Object System.Windows.Forms.DataGridView\n$grid.Location = New-Object System.Drawing.Point(20, 90)\n$grid.Size = New-Object System.Drawing.Size(470, 270)\n$grid.DataSource = [System.Collections.ArrayList]@(Get-Process | Select-Object Name, Id, CPU)\n$form.Controls.Add($grid)'],
        check: function (r) {
          var g = ctl(r, "grid", "DataGridView");
          if (typeof g === "string") return g;
          var rows = asList(g.get("DataSource"));
          if (rows.length !== r.system.processes.length) return "$grid.DataSource should hold all " + r.system.processes.length + " processes, but has " + rows.length + ".";
          var cols = rows[0] && rows[0].names ? rows[0].names() : [];
          if (!H.same(cols, ["Name", "Id", "CPU"])) return "Each row should have just Name, Id and CPU (Select-Object Name, Id, CPU). Columns now: " + H.show(cols) + ".";
          if ((r.v("form").get("Controls") || []).indexOf(g) < 0) return "Add $grid to $form.Controls.";
          return true;
        }
      }
    ],
    debrief: "<p>Ticket closed. Choosing instead of typing removes a whole class of mistakes, and the DataGridView showed that everything you know about objects carries straight into GUIs: <code>Select-Object</code> decides the columns.</p>",
    realworld: "Try $grid.AutoSizeColumnsMode = 'Fill' and $grid.ReadOnly = $true on your PC. To act on the row a user clicked, read $grid.SelectedRows[0].DataBoundItem: it's the original object.",
    quiz: [
      { q: "Where's the item the user chose in a ComboBox?", options: [".Text only", ".SelectedItem (and .SelectedIndex)", ".Items[0]", ".Value"], answer: 1, why: "SelectedIndex is -1 when nothing is chosen." },
      { q: "Why might numbers appear in your output after filling a ComboBox?", options: ["A bug", ".Items.Add() returns the new item's index, and it wasn't discarded", "The grid printed them", "Debug mode"], answer: 1, why: "Use [void] or $null = ..." },
      { q: "What decides a DataGridView's columns?", options: ["You add them one by one", "The properties of the objects in DataSource", "The first row's values", "Alphabetical order"], answer: 1, why: "Shape the objects with Select-Object first." }
    ]
  });

  /* ================================================================== PS-123 */
  LABS.push({
    id: "ps-123", n: 23, module: 3, ticket: "PS-123", xp: 100,
    title: "Export with a Save dialog",
    topic: "Dialogs & good tool design",
    from: DEV,
    story: "<p>The help desk keep asking us for a CSV of the server's user accounts. Let's give them a tool with an <b>Export</b> button and a proper Save dialog.</p>" +
      "<p>Two security rules for anything that touches accounts: the API token box must hide what's typed, and the report logic must live in a <b>function we can test without clicking anything</b>.</p>",
    learn:
      "<h3>File dialogs</h3><p><code>SaveFileDialog</code> and <code>OpenFileDialog</code> are ready-made windows for choosing a file. Set a <code>Filter</code> and a default <code>FileName</code>, call <code>ShowDialog()</code>, and if it returns <code>OK</code>, the chosen path is in <code>.FileName</code>:</p>" +
      ex('Add-Type -AssemblyName System.Windows.Forms\n$dialog = New-Object System.Windows.Forms.SaveFileDialog\n$dialog.Filter = "CSV files (*.csv)|*.csv"\n$dialog.FileName = "services.csv"\nif ($dialog.ShowDialog() -eq "OK") {\n    Get-Service | Select-Object Name, Status | Export-Csv -Path $dialog.FileName\n    "Saved to $($dialog.FileName)"\n} else {\n    "Cancelled"\n}') +
      "<p>The <code>Filter</code> format is <code>description|pattern</code> pairs: <code>\"CSV files (*.csv)|*.csv|All files (*.*)|*.*\"</code>. In this lab, the dialog shows the lab's pretend disk.</p>" +
      "<h3>Keep the logic out of the window</h3><p>A button that does all its work inside its click handler can only be tested by clicking it. Put the work in a normal function (<code>Get-UserReport</code>) and have the handler call it. Then you, a test (Pester, Module 4) or another script can call the function directly.</p>" +
      '<pre class="code">function Get-UserReport { ... }        # logic: testable on its own\nfunction Show-ReportTool { ... }       # window: calls Get-UserReport\nShow-ReportTool</pre>' +
      "<h3>Secrets in a GUI</h3><p>A TextBox for a password or token should hide what's typed: <code>.UseSystemPasswordChar = $true</code>. And never echo it anywhere: not in labels, not in <code>Write-Host</code>, not in logs.</p>",
    starter: ps`
      # PS-123 · Export with a Save dialog
      Add-Type -AssemblyName System.Windows.Forms

      # 1) Get-UserReport: every local user as Name, Enabled and LastLogon (as yyyy-MM-dd, or "never")
      function Get-UserReport {

      }

      function Show-ReportTool {
          $form = New-Object System.Windows.Forms.Form
          $form.Text = "User report"
          $form.Size = New-Object System.Drawing.Size(420, 220)

          # 2) $tokenBox: a TextBox at (20, 20), 250 wide, that hides what's typed

          # 3-4) $exportButton "Export..." at (20, 60): a SaveFileDialog (filter CSV files, default name users.csv);
          #      on OK, export Get-UserReport to the chosen file and set $statusLabel to "Saved to <path>",
          #      otherwise "Export cancelled".
          $statusLabel = New-Object System.Windows.Forms.Label
          $statusLabel.Location = New-Object System.Drawing.Point(20, 110)
          $statusLabel.Size = New-Object System.Drawing.Size(360, 40)


          $form.Controls.Add($statusLabel)
          [void]$form.ShowDialog()
      }

      Show-ReportTool
    `,
    objectives: [
      {
        id: "logic",
        text: "<code>Get-UserReport</code> returns every local user with <code>Name</code>, <code>Enabled</code> and <code>LastLogon</code> (text: <code>yyyy-MM-dd</code>, or <code>never</code>), without opening any window.",
        hints: ["Get-LocalUser | Select-Object Name, Enabled, @{ Name = 'LastLogon'; Expression = { if ($_.LastLogon) { $_.LastLogon.ToString('yyyy-MM-dd') } else { 'never' } } }",
          "function Get-UserReport {\n    Get-LocalUser | Select-Object Name, Enabled, @{\n        Name = 'LastLogon'\n        Expression = { if ($_.LastLogon) { $_.LastLogon.ToString('yyyy-MM-dd') } else { 'never' } }\n    }\n}"],
        check: function (r) {
          if (!r.fn("Get-UserReport")) return "I can't find a function called Get-UserReport.";
          var res = r.ps("Get-UserReport");
          if (!res.ok) return "Get-UserReport failed: " + res.errors[0];
          var got = asList(res.value);
          var want = r.system.users.map(function (u) { return { Name: u.Name, Enabled: u.Enabled, LastLogon: u.LastLogon == null ? "never" : window.PSEngine.formatDate(new window.PSEngine.PSDate(u.LastLogon), "yyyy-MM-dd") }; });
          if (!H.same(got, want)) return "Get-UserReport should return one object per user with Name, Enabled and LastLogon (yyyy-MM-dd or never). First expected: " + H.show(want[0]) + "; first returned: " + H.show(asList(res.raw)[0]) + ".";
          return true;
        }
      },
      {
        id: "token",
        text: "The window has a <code>$tokenBox</code> TextBox that hides what's typed (<code>UseSystemPasswordChar</code>).",
        hints: ["$tokenBox = New-Object System.Windows.Forms.TextBox, .Location, .Width = 250, .UseSystemPasswordChar = $true, and add it to the form.",
          '$tokenBox = New-Object System.Windows.Forms.TextBox\n$tokenBox.Location = New-Object System.Drawing.Point(20, 20)\n$tokenBox.Width = 250\n$tokenBox.UseSystemPasswordChar = $true\n$form.Controls.Add($tokenBox)'],
        check: function (r) {
          var p = needPause(r, "form");
          if (p !== true) return p;
          var form = G.form(r);
          var boxes = G.controlsOf(form).filter(function (c) { return c.guiKind === "TextBox"; });
          if (!boxes.length) return "Add a TextBox ($tokenBox) to the form.";
          if (!boxes.some(function (b) { return window.PSEngine.toBool(b.get("UseSystemPasswordChar")) || str(b.get("PasswordChar")); })) return "The token box shows what's typed. Set $tokenBox.UseSystemPasswordChar = $true.";
          return true;
        }
      },
      {
        id: "save",
        text: "<b>Export...</b> opens a SaveFileDialog (CSV filter, default <code>users.csv</code>); choosing <code>reports\\users.csv</code> saves the report there and shows <code>Saved to reports\\users.csv</code>.",
        hints: ["In the button's Add_Click: $dialog = New-Object System.Windows.Forms.SaveFileDialog; set .Filter and .FileName; if ($dialog.ShowDialog() -eq 'OK') { Get-UserReport | Export-Csv -Path $dialog.FileName; $statusLabel.Text = ... }",
          '$exportButton = New-Object System.Windows.Forms.Button\n$exportButton.Text = "Export..."\n$exportButton.Location = New-Object System.Drawing.Point(20, 60)\n$exportButton.Add_Click({\n    $dialog = New-Object System.Windows.Forms.SaveFileDialog\n    $dialog.Filter = "CSV files (*.csv)|*.csv"\n    $dialog.FileName = "users.csv"\n    if ($dialog.ShowDialog() -eq "OK") {\n        Get-UserReport | Export-Csv -Path $dialog.FileName\n        $statusLabel.Text = "Saved to $($dialog.FileName)"\n    } else {\n        $statusLabel.Text = "Export cancelled"\n    }\n})\n$form.Controls.Add($exportButton)'],
        check: function (r) {
          if (!r.pause) return "Do the earlier tasks first.";
          var btn = G.find(r, "Button", "Export...");
          if (!btn) return "Add a Button with the text \"Export...\".";
          var r2 = r.interact([G.click(btn)]);
          if (!r2.pause || r2.pause.kind !== "file" || r2.pause.mode !== "save") return "Clicking Export... should open a SaveFileDialog.";
          if (!/\*\.csv/.test(r2.pause.filter)) return "Give the dialog a CSV filter: $dialog.Filter = \"CSV files (*.csv)|*.csv\".";
          if (r2.pause.fileName !== "users.csv") return "Set the default file name: $dialog.FileName = \"users.csv\".";
          var r3 = r.interact([G.click(btn), G.answer({ result: "OK", fileName: "reports\\users.csv" })]);
          var t = r3.file("reports\\users.csv");
          if (t === null) return "After choosing reports\\users.csv, the file should be written (Export-Csv -Path $dialog.FileName).";
          var rows = t.trim().split("\n");
          if (rows[0] !== '"Name","Enabled","LastLogon"' || rows.length !== r.system.users.length + 1) return "reports\\users.csv should hold the Get-UserReport output (Name, Enabled, LastLogon; one row per user).";
          var sl = G.find(r3, "Label", function (c) { return /Saved to|cancel/i.test(str(c.get("Text"))); });
          if (!sl || str(sl.get("Text")) !== "Saved to reports\\users.csv") return "After saving, the status label should say \"Saved to reports\\users.csv\".";
          return true;
        }
      },
      {
        id: "cancel",
        text: "Cancelling the dialog writes nothing and shows <code>Export cancelled</code>.",
        hints: ["else { $statusLabel.Text = \"Export cancelled\" }"],
        check: function (r) {
          if (!r.pause) return "Do the earlier tasks first.";
          var btn = G.find(r, "Button", "Export...");
          if (!btn) return "Add a Button with the text \"Export...\".";
          var r2 = r.interact([G.click(btn), G.answer({ result: "Cancel" })]);
          if (Object.keys(r2.system.files).some(function (k) { return /\.csv$/.test(k); })) return "After Cancel, no file should be written.";
          var sl = G.find(r2, "Label", function (c) { return /cancel/i.test(str(c.get("Text"))); });
          return sl && str(sl.get("Text")) === "Export cancelled" ? true : "After Cancel, the status label should say \"Export cancelled\".";
        }
      }
    ],
    debrief: "<p>Ticket closed. The help desk gets a friendly Save dialog. You get a <code>Get-UserReport</code> function that a scheduled job, a test or another tool can call without anyone clicking. And the token box doesn't show the token to whoever is looking over the shoulder.</p>" +
      "<p>Separating logic from UI is the habit that keeps GUI tools maintainable.</p>",
    realworld: "OpenFileDialog works the same way for picking an input file. For folders there's System.Windows.Forms.FolderBrowserDialog. Real tools often add $dialog.InitialDirectory = [Environment]::GetFolderPath('MyDocuments').",
    quiz: [
      { q: "What does SaveFileDialog's <code>ShowDialog()</code> return when the user clicks Save?", options: ["The file path", "OK (the path is in .FileName)", "$true", "Nothing"], answer: 1, why: "Always check for OK before using FileName." },
      { q: "Why put the report logic in its own function?", options: ["It's faster", "It can be tested and reused without the window", "Windows Forms requires it", "It hides the code"], answer: 1, why: "GUI code is hard to test; plain functions aren't." },
      { q: "How do you stop a TextBox from showing a typed password?", options: ["ReadOnly = $true", "UseSystemPasswordChar = $true", "Visible = $false", "Multiline = $true"], answer: 1, why: "It shows dots instead of the characters." }
    ]
  });

  /* ================================================================== PS-124 */
  LABS.push({
    id: "ps-124", n: 24, module: 3, ticket: "PS-124", xp: 100,
    title: "The same window in XAML",
    topic: "WPF & XAML",
    from: DANA,
    story: "<p>Our Windows team's newer tools use <b>WPF</b>, where the window's layout is written as <b>XAML</b> (an XML file) instead of positioning every control in code. Designers can edit the layout without touching the logic.</p>" +
      "<p>Rebuild the service lookup from PS-121 the WPF way.</p>",
    learn:
      "<h3>XAML describes the window</h3><p>Instead of pixels, WPF uses <b>layout panels</b>: a <code>StackPanel</code> stacks its children top to bottom (or left to right with <code>Orientation=\"Horizontal\"</code>). Controls are XML elements, their properties are attributes, and <code>x:Name</code> gives a control a name your script can find.</p>" +
      '<pre class="code">&lt;Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"\n        xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"\n        Title="Hello" Width="300" Height="160"&gt;\n  &lt;StackPanel Margin="12"&gt;\n    &lt;TextBox x:Name="NameBox" /&gt;\n    &lt;Button x:Name="GoButton" Content="Go" IsDefault="True" /&gt;\n    &lt;TextBlock x:Name="Result" /&gt;\n  &lt;/StackPanel&gt;\n&lt;/Window&gt;</pre>' +
      '<table class="t"><tr><th>WPF</th><th>Windows Forms equivalent</th></tr><tr><td><code>TextBlock</code> (<code>Text</code>)</td><td>Label</td></tr><tr><td><code>TextBox</code> (<code>Text</code>)</td><td>TextBox</td></tr>' +
      "<tr><td><code>Button</code> (<code>Content</code>, <code>IsDefault</code>)</td><td>Button (<code>Text</code>, form's AcceptButton)</td></tr><tr><td><code>CheckBox</code> (<code>IsChecked</code>), <code>ComboBox</code>, <code>DataGrid</code> (<code>ItemsSource</code>)</td><td>CheckBox, ComboBox, DataGridView</td></tr></table>" +
      "<h3>Loading it in PowerShell</h3>" +
      ex('Add-Type -AssemblyName PresentationFramework\n[xml]$xaml = @"\n<Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"\n        xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"\n        Title="Hello" Width="300" Height="160">\n  <StackPanel Margin="12">\n    <TextBox x:Name="NameBox" />\n    <Button x:Name="GoButton" Content="Go" IsDefault="True" />\n    <TextBlock x:Name="Result" />\n  </StackPanel>\n</Window>\n"@\n$window = [Windows.Markup.XamlReader]::Load((New-Object System.Xml.XmlNodeReader $xaml))\n$nameBox = $window.FindName("NameBox")\n$result = $window.FindName("Result")\n$window.FindName("GoButton").Add_Click({ $result.Text = "Hello, $($nameBox.Text)!" })\n[void]$window.ShowDialog()') +
      "<ol><li><code>[xml]</code> turns the here-string into an XML document.</li><li><code>XamlReader::Load</code> builds the window from it (through an <code>XmlNodeReader</code>).</li><li><code>$window.FindName(\"...\")</code> gets each named control.</li><li>Events work as in Windows Forms: <code>.Add_Click({ ... })</code>.</li></ol>" +
      '<div class="callout">XAML copied from Visual Studio often has <code>x:Class</code> and <code>mc:Ignorable</code> attributes that PowerShell\'s XamlReader rejects: remove them.</div>',
    starter: ps`
      # PS-124 · The same window in XAML
      Add-Type -AssemblyName PresentationFramework

      # 1) $window: a WPF Window titled "Service lookup", 360 x 220, loaded from XAML with: a TextBlock "Service name:",
      #    a TextBox named NameBox, a Button named LookupButton with Content "Look up" (IsDefault), a TextBlock named ResultText


      # 2) $nameBox, $lookupButton, $resultText: the named controls (FindName)


      # 3-4) Clicking Look up shows "<name> is <Status>" in $resultText, or "No service called <name>"

      [void]$window.ShowDialog()
    `,
    objectives: [
      {
        id: "xaml",
        text: "<code>$window</code> is a WPF Window titled <code>Service lookup</code>, 360 × 220, loaded from XAML.",
        hints: ["[xml]$xaml = @\" <Window ...> ... </Window> \"@, then [Windows.Markup.XamlReader]::Load((New-Object System.Xml.XmlNodeReader $xaml))",
          '[xml]$xaml = @"\n<Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"\n        xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"\n        Title="Service lookup" Width="360" Height="220">\n  <StackPanel Margin="12">\n    <TextBlock Text="Service name:" />\n    <TextBox x:Name="NameBox" />\n    <Button x:Name="LookupButton" Content="Look up" IsDefault="True" />\n    <TextBlock x:Name="ResultText" />\n  </StackPanel>\n</Window>\n"@\n$window = [Windows.Markup.XamlReader]::Load((New-Object System.Xml.XmlNodeReader $xaml))'],
        check: function (r) {
          var w = r.v("window");
          if (!w || !w.guiKind) return "I can't find a WPF window in $window yet. Load it with [Windows.Markup.XamlReader]::Load(...).";
          if (w.guiKind !== "Window") return "$window should be the Window loaded from XAML.";
          if (str(w.get("Title")) !== "Service lookup") return "The Window's Title should be \"Service lookup\".";
          if (w.get("Width") !== 360 || w.get("Height") !== 220) return "The Window should be 360 x 220 (Width and Height attributes).";
          return /XamlReader/i.test(r.src) ? true : "Load the window from XAML with [Windows.Markup.XamlReader]::Load.";
        }
      },
      {
        id: "find",
        text: "<code>$nameBox</code>, <code>$lookupButton</code> and <code>$resultText</code> hold the named controls, found with <code>FindName</code>; the button says <code>Look up</code> and is the default button.",
        hints: ['$nameBox = $window.FindName("NameBox"), and the same for LookupButton and ResultText.', '$nameBox = $window.FindName("NameBox")\n$lookupButton = $window.FindName("LookupButton")\n$resultText = $window.FindName("ResultText")'],
        check: function (r) {
          var specs = [["nameBox", "TextBox"], ["lookupButton", "Button"], ["resultText", "TextBlock"]];
          for (var i = 0; i < specs.length; i++) {
            var v = r.v(specs[i][0]);
            if (!v || !v.guiKind) return "$" + specs[i][0] + " is empty: in the XAML, give the " + specs[i][1] + " x:Name=\"" + specs[i][0].charAt(0).toUpperCase() + specs[i][0].slice(1) + "\" and use $window.FindName(...).";
            if (v.guiKind !== specs[i][1]) return "$" + specs[i][0] + " should be the " + specs[i][1] + ", but it's a " + v.guiKind + ".";
          }
          var b = r.v("lookupButton");
          if (str(b.get("Content")) !== "Look up") return "The button's Content should be \"Look up\".";
          if (!window.PSEngine.toBool(b.get("IsDefault"))) return "Give the button IsDefault=\"True\" so Enter clicks it.";
          return /FindName/i.test(r.src) ? true : "Use $window.FindName(\"...\").";
        }
      },
      {
        id: "click",
        text: "Typing <code>W3SVC</code> and clicking <b>Look up</b> shows <code>W3SVC is Running</code> in <code>$resultText</code>.",
        hints: ['$lookupButton.Add_Click({ $s = Get-Service -Name $nameBox.Text.Trim(); $resultText.Text = "$($s.Name) is $($s.Status)" })'],
        check: function (r) {
          var p = needPause(r, "form");
          if (p !== true) return p;
          var box = r.v("nameBox"), btn = r.v("lookupButton");
          if (!box || !box.guiId || !btn || !btn.guiId) return "Do the earlier tasks first.";
          var r2 = r.interact([G.text(box, "W3SVC"), G.click(btn)]);
          var t = str(r2.v("resultText").get("Text"));
          return t === "W3SVC is Running" ? true : "After typing W3SVC and clicking, $resultText should say \"W3SVC is Running\". It says " + H.show(t) + ".";
        }
      },
      {
        id: "missing",
        text: "For a name that doesn't exist, it shows <code>No service called &lt;name&gt;</code>, with no error in the console.",
        hints: ["try { ... -ErrorAction Stop } catch { $resultText.Text = \"No service called $name\" }"],
        check: function (r) {
          var box = r.v("nameBox"), btn = r.v("lookupButton");
          if (!r.pause || !box || !box.guiId || !btn || !btn.guiId) return "Do the earlier tasks first.";
          var r2 = r.interact([G.text(box, "Nope"), G.click(btn)]);
          if (r2.errors.length) return "An error was shown in the console: " + r2.errors[0];
          var t = str(r2.v("resultText").get("Text"));
          return t === "No service called Nope" ? true : "For Nope, $resultText should say \"No service called Nope\". It says " + H.show(t) + ".";
        }
      }
    ],
    debrief: "<p>Ticket closed. Same tool, very different code: the layout lives in XAML, which reads like a description of the window, and the PowerShell is just logic. No pixel coordinates, and the window adapts when the text changes size.</p>" +
      "<p>Windows Forms is quicker for small tools; WPF scales better for anything with a real layout. Now you can read both.</p>",
    realworld: "Run the example on your Windows PC (Windows PowerShell 5.1 or PowerShell 7 on Windows). Visual Studio's free Community edition has a drag-and-drop XAML designer: design the window there, paste the XAML into your script, remove x:Class.",
    quiz: [
      { q: "What does <code>x:Name=\"NameBox\"</code> do?", options: ["Sets the text", "Gives the control a name you can look up with FindName", "Makes it a TextBox", "Styles it"], answer: 1, why: "Your script gets controls by name." },
      { q: "In WPF, a Button's caption is…", options: ["Text", "Content", "Caption", "Label"], answer: 1, why: "WPF's Content can be text or even other controls." },
      { q: "What turns a here-string of XAML into an XML document?", options: ["ConvertFrom-Xml", "The [xml] cast", "Import-Clixml", "Out-String"], answer: 1, why: "[xml]$x = ... parses the text." }
    ]
  });

  /* ================================================================== PS-125 capstone */
  function hd(r) {
    var box = r.v("userBox"), look = r.v("lookupButton");
    return box && box.guiId && look && look.guiId ? { box: box, look: look } : null;
  }
  LABS.push({
    id: "ps-125", n: 25, module: 3, ticket: "PS-125", xp: 200, capstone: true,
    title: "The help-desk toolkit",
    topic: "Module 3 capstone project",
    from: "Dana Park & Dev Patel",
    story: "<p>After last night's incident, the help desk need one tool for account problems on <code>KC-WIN-01</code>: look a user up, see their recent <b>failed logons</b>, and disable or enable the account, with a confirmation step and an <b>audit trail</b> of who did what.</p>" +
      "<p>Everything from Module 3 in one window, built on Modules 1 and 2.</p>",
    learn:
      '<div class="callout warn"><b>Capstone rules.</b> There are no hints. Build the logic functions first and test them in the console, then the window. ' +
      "If you get completely stuck, the Tasks tab has a button to reveal the full solution. The capstone then earns half XP.</div>" +
      "<h3>Logic (testable without the window)</h3>" +
      '<table class="t"><tr><th>Function</th><th>Returns</th></tr>' +
      "<tr><td><code>Get-UserSummary -Name x</code></td><td><code>ana.silva | Enabled: True | Last logon: 2026-11-09</code> (or <code>never</code>), or <code>$null</code> if there's no such user (no error shown)</td></tr>" +
      "<tr><td><code>Get-FailedLogon -Name x</code></td><td>one object per failed logon (4625) for that account, newest first: <code>Time</code> (<code>HH:mm:ss</code>) and <code>Source</code> (the IP). None: an empty result, no error</td></tr></table>" +
      "<h3>The window</h3>" +
      '<table class="t"><tr><th>Variable</th><th>Control</th></tr>' +
      "<tr><td><code>$form</code></td><td>Form titled <code>Kestrel help desk</code></td></tr>" +
      "<tr><td><code>$userBox</code>, <code>$lookupButton</code></td><td>TextBox and a <code>Look up</code> button (Enter clicks it)</td></tr>" +
      "<tr><td><code>$infoLabel</code></td><td>shows the summary, <code>No user called x</code>, or messages below</td></tr>" +
      "<tr><td><code>$logonGrid</code></td><td>DataGridView of the user's failed logons</td></tr>" +
      "<tr><td><code>$disableButton</code>, <code>$enableButton</code></td><td><code>Disable account</code> / <code>Enable account</code></td></tr></table>" +
      "<h3>Behaviour</h3><ul><li><b>Look up</b>: fill <code>$infoLabel</code> and <code>$logonGrid</code> for the typed user, and remember them in <code>$script:currentUser</code> (or clear it if unknown).</li>" +
      "<li><b>Disable/Enable</b> with no user looked up: <code>$infoLabel</code> says <code>Look up a user first.</code></li>" +
      "<li>Otherwise ask with a <code>YesNo</code>, <code>Warning</code> MessageBox titled <code>Confirm</code>: <code>Disable temp.admin?</code> (or <code>Enable ...?</code>). On <b>Yes</b>: do it with <code>Disable-LocalUser</code> / <code>Enable-LocalUser</code>, add a line to <code>audit.log</code>: <code>2026-11-10 09:00:00 dev disabled temp.admin</code> (date from <code>Get-Date</code>, user from <code>$env:USERNAME</code>), and refresh <code>$infoLabel</code>. On <b>No</b>: change nothing.</li></ul>",
    starter: ps`
      # PS-125 · The help-desk toolkit (Module 3 capstone)
      Add-Type -AssemblyName System.Windows.Forms

      function Get-UserSummary {

      }

      function Get-FailedLogon {

      }

      # The window

      [void]$form.ShowDialog()
    `,
    prelude: "Initialize-LabScenario incident",
    solution: ps`
      Add-Type -AssemblyName System.Windows.Forms

      function Get-UserSummary {
          param([string]$Name)
          $user = Get-LocalUser -Name $Name -ErrorAction SilentlyContinue
          if (-not $user) { return $null }
          $last = if ($user.LastLogon) { $user.LastLogon.ToString('yyyy-MM-dd') } else { 'never' }
          "$($user.Name) | Enabled: $($user.Enabled) | Last logon: $last"
      }

      function Get-FailedLogon {
          param([string]$Name)
          Get-WinEvent -FilterHashtable @{ LogName = 'Security'; Id = 4625 } -ErrorAction SilentlyContinue |
              Where-Object { $_.Properties[5].Value -eq $Name } |
              ForEach-Object {
                  [PSCustomObject]@{ Time = $_.TimeCreated.ToString('HH:mm:ss'); Source = $_.Properties[19].Value }
              }
      }

      function Write-Audit {
          param([string]$Action, [string]$Target)
          Add-Content -Path audit.log -Value "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $env:USERNAME $Action $Target"
      }

      $form = New-Object System.Windows.Forms.Form
      $form.Text = "Kestrel help desk"
      $form.Size = New-Object System.Drawing.Size(520, 420)

      $userBox = New-Object System.Windows.Forms.TextBox
      $userBox.Location = New-Object System.Drawing.Point(20, 20)
      $userBox.Width = 220

      $lookupButton = New-Object System.Windows.Forms.Button
      $lookupButton.Text = "Look up"
      $lookupButton.Location = New-Object System.Drawing.Point(250, 18)

      $infoLabel = New-Object System.Windows.Forms.Label
      $infoLabel.Location = New-Object System.Drawing.Point(20, 55)
      $infoLabel.Size = New-Object System.Drawing.Size(470, 30)

      $logonGrid = New-Object System.Windows.Forms.DataGridView
      $logonGrid.Location = New-Object System.Drawing.Point(20, 90)
      $logonGrid.Size = New-Object System.Drawing.Size(470, 220)
      $logonGrid.ReadOnly = $true

      $disableButton = New-Object System.Windows.Forms.Button
      $disableButton.Text = "Disable account"
      $disableButton.Location = New-Object System.Drawing.Point(20, 325)
      $disableButton.Width = 140

      $enableButton = New-Object System.Windows.Forms.Button
      $enableButton.Text = "Enable account"
      $enableButton.Location = New-Object System.Drawing.Point(170, 325)
      $enableButton.Width = 140

      $form.Controls.AddRange(@($userBox, $lookupButton, $infoLabel, $logonGrid, $disableButton, $enableButton))
      $form.AcceptButton = $lookupButton
      $currentUser = $null

      $lookupButton.Add_Click({
          $name = $userBox.Text.Trim()
          $summary = Get-UserSummary -Name $name
          if ($summary) {
              $script:currentUser = $name
              $infoLabel.Text = $summary
              $logonGrid.DataSource = [System.Collections.ArrayList]@(Get-FailedLogon -Name $name)
          }
          else {
              $script:currentUser = $null
              $infoLabel.Text = "No user called $name"
              $logonGrid.DataSource = $null
          }
      })

      function Set-AccountState {
          param([string]$Verb)
          if (-not $script:currentUser) {
              $infoLabel.Text = "Look up a user first."
              return
          }
          $answer = [System.Windows.Forms.MessageBox]::Show("$Verb $($script:currentUser)?", "Confirm", "YesNo", "Warning")
          if ($answer -ne "Yes") { return }
          if ($Verb -eq "Disable") { Disable-LocalUser -Name $script:currentUser }
          else { Enable-LocalUser -Name $script:currentUser }
          Write-Audit -Action "$($Verb.ToLower())d" -Target $script:currentUser
          $infoLabel.Text = Get-UserSummary -Name $script:currentUser
      }
      $disableButton.Add_Click({ Set-AccountState -Verb "Disable" })
      $enableButton.Add_Click({ Set-AccountState -Verb "Enable" })

      [void]$form.ShowDialog()
    `,
    objectives: [
      {
        id: "summary", hints: [],
        text: "<code>Get-UserSummary</code> returns the summary text, <code>never</code> for accounts that never logged on, and <code>$null</code> (no error) for unknown users.",
        check: function (r) {
          if (!r.fn("Get-UserSummary")) return "I can't find a function called Get-UserSummary.";
          var cases = [["ana.silva", "ana.silva | Enabled: True | Last logon: 2026-11-09"], ["Administrator", "Administrator | Enabled: False | Last logon: never"], ["temp.admin", "temp.admin | Enabled: True | Last logon: 2026-08-07"]];
          for (var i = 0; i < cases.length; i++) {
            var res = r.ps("Get-UserSummary -Name " + cases[i][0]);
            if (!res.ok) return "Get-UserSummary -Name " + cases[i][0] + " failed: " + res.errors[0];
            if (!H.same(res.value, cases[i][1])) return "Get-UserSummary -Name " + cases[i][0] + " should return " + H.show(cases[i][1]) + ", got " + H.show(res.raw) + ".";
          }
          var none = r.ps("Get-UserSummary -Name nobody");
          if (none.errors.length) return "For an unknown user, an error was shown: " + none.errors[0] + ". Use -ErrorAction SilentlyContinue.";
          if (none.value !== null && none.value !== undefined) return "For an unknown user, Get-UserSummary should return $null, got " + H.show(none.raw) + ".";
          return true;
        }
      },
      {
        id: "logons", hints: [],
        text: "<code>Get-FailedLogon</code> returns the account's failed logons (Time, Source), newest first, and nothing (no error) for an account without any.",
        check: function (r) {
          if (!r.fn("Get-FailedLogon")) return "I can't find a function called Get-FailedLogon.";
          var res = r.ps("Get-FailedLogon -Name temp.admin");
          if (!res.ok) return "Get-FailedLogon -Name temp.admin failed: " + res.errors[0];
          var want = [{ Time: "02:14:13", Source: "203.0.113.50" }, { Time: "02:11:55", Source: "203.0.113.50" }];
          if (!H.same(asList(res.value), want)) return "Get-FailedLogon -Name temp.admin should return " + H.show(want) + ", got " + H.show(res.raw) + ".";
          var none = r.ps("Get-FailedLogon -Name ben.okoro");
          if (none.errors.length) return "For an account without failures, an error was shown: " + none.errors[0];
          if (none.items.length) return "ben.okoro has no failed logons, but Get-FailedLogon returned " + H.show(none.raw) + ".";
          return true;
        }
      },
      {
        id: "lookup", hints: [],
        text: "Looking up <code>temp.admin</code> fills <code>$infoLabel</code> and <code>$logonGrid</code>; an unknown name shows <code>No user called x</code>; Enter clicks <b>Look up</b>.",
        check: function (r) {
          if (!r.pause || r.pause.kind !== "form") return r.error ? "The script stopped with an error: " + r.error.message : "The script should end by showing $form.";
          var c = hd(r);
          if (!c) return "Keep the controls in $userBox and $lookupButton.";
          if (str(r.v("form").get("Text")) !== "Kestrel help desk") return "The form's title should be \"Kestrel help desk\".";
          if (r.v("form").get("AcceptButton") !== c.look) return "Make Enter click Look up ($form.AcceptButton).";
          var r2 = r.interact([G.text(c.box, "temp.admin"), G.click(c.look)]);
          if (str(r2.v("infoLabel").get("Text")) !== "temp.admin | Enabled: True | Last logon: 2026-08-07") return "After looking up temp.admin, $infoLabel should show its summary. It says " + H.show(str(r2.v("infoLabel").get("Text"))) + ".";
          var ds = asList(r2.v("logonGrid") && r2.v("logonGrid").get("DataSource"));
          if (ds.length !== 2) return "$logonGrid should show temp.admin's 2 failed logons, but has " + ds.length + " rows.";
          var r3 = r.interact([G.text(c.box, "nobody"), G.click(c.look)]);
          if (str(r3.v("infoLabel").get("Text")) !== "No user called nobody") return "For an unknown user, $infoLabel should say \"No user called nobody\".";
          return true;
        }
      },
      {
        id: "disable", hints: [],
        text: "<b>Disable account</b> asks <code>Disable temp.admin?</code> (YesNo, Warning, titled Confirm). <b>Yes</b> disables it, writes the audit line and refreshes the label; <b>No</b> changes nothing.",
        check: function (r) {
          var c = hd(r), dis = G.find(r, "Button", "Disable account");
          if (!c || !dis) return "Keep $userBox/$lookupButton and add a \"Disable account\" button.";
          var base = [G.text(c.box, "temp.admin"), G.click(c.look), G.click(dis)];
          var r2 = r.interact(base);
          if (!r2.pause || r2.pause.kind !== "messagebox") return "Clicking Disable account after a lookup should ask for confirmation with a MessageBox.";
          var m = r2.pause;
          if (m.text !== "Disable temp.admin?" || m.caption !== "Confirm" || m.buttons.join(",") !== "Yes,No" || !/warning/i.test(m.icon)) return "The confirmation should be a YesNo MessageBox titled Confirm with the Warning icon, asking \"Disable temp.admin?\". It was " + H.show(m.text) + " / " + H.show(m.caption) + " / " + m.buttons.join("") + " / " + m.icon + ".";
          var no = r.interact(base.concat([G.answer("No")]));
          if (no.system.actions.length || no.file("audit.log") !== null) return "After answering No, nothing should change (no action, no audit line).";
          var yes = r.interact(base.concat([G.answer("Yes")]));
          if (yes.system.actions.indexOf("Disable-LocalUser temp.admin") < 0) return "After Yes, temp.admin should be disabled with Disable-LocalUser.";
          var log = yes.file("audit.log");
          if (log === null || log.trim() !== "2026-11-10 09:00:00 dev disabled temp.admin") return "audit.log should get the line \"2026-11-10 09:00:00 dev disabled temp.admin\". It contains: " + H.show(log);
          if (str(yes.v("infoLabel").get("Text")) !== "temp.admin | Enabled: False | Last logon: 2026-08-07") return "After disabling, refresh $infoLabel (it should now say Enabled: False).";
          return true;
        }
      },
      {
        id: "guard", hints: [],
        text: "<b>Enable account</b> works the same way (<code>fay.wong</code> → enabled, audit line <code>... dev enabled fay.wong</code>), and either button with no user looked up says <code>Look up a user first.</code> without asking anything.",
        check: function (r) {
          var c = hd(r), en = G.find(r, "Button", "Enable account"), dis = G.find(r, "Button", "Disable account");
          if (!c || !en || !dis) return "You need the Look up, Disable account and Enable account buttons.";
          var r0 = r.interact([G.click(en)]);
          if (r0.pause && r0.pause.kind === "messagebox") return "With no user looked up, Enable account shouldn't ask anything: show \"Look up a user first.\" instead.";
          if (str(r0.v("infoLabel").get("Text")) !== "Look up a user first.") return "With no user looked up, $infoLabel should say \"Look up a user first.\"";
          var r1 = r.interact([G.text(c.box, "nobody"), G.click(c.look), G.click(dis)]);
          if (r1.pause && r1.pause.kind === "messagebox") return "After looking up an unknown user, Disable account shouldn't ask anything (clear $script:currentUser when the lookup fails).";
          var yes = r.interact([G.text(c.box, "fay.wong"), G.click(c.look), G.click(en), G.answer("Yes")]);
          if (yes.system.actions.indexOf("Enable-LocalUser fay.wong") < 0) return "Enable account + Yes should enable fay.wong with Enable-LocalUser.";
          var log = yes.file("audit.log");
          if (log === null || log.trim() !== "2026-11-10 09:00:00 dev enabled fay.wong") return "audit.log should get \"2026-11-10 09:00:00 dev enabled fay.wong\". It contains: " + H.show(log);
          return true;
        }
      }
    ],
    debrief: "<p><b>Module 3 complete.</b> The help desk can now investigate and lock down an account in seconds, every change is confirmed and audited, and the logic underneath is a set of functions you can test and reuse. The audit trail matters as much as the button: in security, \"who did what, when\" is often the first question.</p>" +
      "<p>Module 4 turns to security itself: secrets, hashing, how attackers use PowerShell, and testing and linting your own scripts.</p>",
    realworld: "Real help-desk tools add a log viewer, run with least privilege (a Just Enough Administration endpoint instead of full admin), and write the audit trail to the Windows event log or a SIEM, not a text file, so a user of the tool can't edit it.",
    quiz: []
  });

  /* ------------------------------------------------------------------ Solutions */
  var SOLUTIONS = {
    "ps-119": ps`
      Add-Type -AssemblyName System.Windows.Forms

      $picked = Get-Service | Where-Object Status -eq Running | Out-GridView -Title "Pick services to restart" -PassThru
      if (-not $picked) { return }

      $answer = [System.Windows.Forms.MessageBox]::Show("Restart $(@($picked).Count) service(s)?", "Confirm", "YesNo", "Question")
      if ($answer -eq "Yes") {
          $picked | Restart-Service
          [void][System.Windows.Forms.MessageBox]::Show("Restarted: $($picked.Name -join ', ')", "Done", "OK", "Information")
      }
    `,
    "ps-120": FORM_BASE + "\n\n" + ps`
      $result = $form.ShowDialog()
      "Window closed: $result"
    `,
    "ps-121": FORM_BASE + "\n\n" + ps`
      $lookups = 0
      $form.AcceptButton = $lookupButton

      $lookupButton.Add_Click({
          $script:lookups++
          $name = $nameBox.Text.Trim()
          if (-not $name) {
              $resultLabel.Text = "Type a service name first."
              return
          }
          try {
              $svc = Get-Service -Name $name -ErrorAction Stop
              $resultLabel.Text = "$name is $($svc.Status)"
              $resultLabel.ForeColor = if ($svc.Status -eq "Running") { "Green" } else { "Red" }
          }
          catch {
              $resultLabel.Text = "No service called $name"
              $resultLabel.ForeColor = "Red"
          }
      })

      [void]$form.ShowDialog()
    `,
    "ps-122": ps`
      Add-Type -AssemblyName System.Windows.Forms

      $form = New-Object System.Windows.Forms.Form
      $form.Text = "Service dashboard"
      $form.Size = New-Object System.Drawing.Size(520, 420)

      $serviceBox = New-Object System.Windows.Forms.ComboBox
      $serviceBox.DropDownStyle = "DropDownList"
      $serviceBox.Location = New-Object System.Drawing.Point(20, 20)
      $serviceBox.Width = 220
      foreach ($s in Get-Service) { [void]$serviceBox.Items.Add($s.Name) }

      $statusLabel = New-Object System.Windows.Forms.Label
      $statusLabel.Location = New-Object System.Drawing.Point(260, 22)
      $statusLabel.Width = 230
      $serviceBox.Add_SelectedIndexChanged({
          $s = Get-Service -Name $serviceBox.SelectedItem
          $statusLabel.Text = "$($s.Name): $($s.Status) ($($s.StartType))"
      })

      $stoppedOnly = New-Object System.Windows.Forms.CheckBox
      $stoppedOnly.Text = "Only stopped"
      $stoppedOnly.Location = New-Object System.Drawing.Point(20, 55)
      $stoppedOnly.Add_CheckedChanged({
          $serviceBox.Items.Clear()
          $list = Get-Service
          if ($stoppedOnly.Checked) { $list = $list | Where-Object Status -eq "Stopped" }
          foreach ($s in $list) { [void]$serviceBox.Items.Add($s.Name) }
      })

      $grid = New-Object System.Windows.Forms.DataGridView
      $grid.Location = New-Object System.Drawing.Point(20, 90)
      $grid.Size = New-Object System.Drawing.Size(470, 270)
      $grid.DataSource = [System.Collections.ArrayList]@(Get-Process | Select-Object Name, Id, CPU)

      $form.Controls.AddRange(@($serviceBox, $statusLabel, $stoppedOnly, $grid))
      [void]$form.ShowDialog()
    `,
    "ps-123": ps`
      Add-Type -AssemblyName System.Windows.Forms

      function Get-UserReport {
          Get-LocalUser | Select-Object Name, Enabled, @{
              Name = "LastLogon"
              Expression = { if ($_.LastLogon) { $_.LastLogon.ToString("yyyy-MM-dd") } else { "never" } }
          }
      }

      function Show-ReportTool {
          $form = New-Object System.Windows.Forms.Form
          $form.Text = "User report"
          $form.Size = New-Object System.Drawing.Size(420, 220)

          $tokenBox = New-Object System.Windows.Forms.TextBox
          $tokenBox.Location = New-Object System.Drawing.Point(20, 20)
          $tokenBox.Width = 250
          $tokenBox.UseSystemPasswordChar = $true

          $statusLabel = New-Object System.Windows.Forms.Label
          $statusLabel.Location = New-Object System.Drawing.Point(20, 110)
          $statusLabel.Size = New-Object System.Drawing.Size(360, 40)

          $exportButton = New-Object System.Windows.Forms.Button
          $exportButton.Text = "Export..."
          $exportButton.Location = New-Object System.Drawing.Point(20, 60)
          $exportButton.Add_Click({
              $dialog = New-Object System.Windows.Forms.SaveFileDialog
              $dialog.Filter = "CSV files (*.csv)|*.csv"
              $dialog.FileName = "users.csv"
              if ($dialog.ShowDialog() -eq "OK") {
                  Get-UserReport | Export-Csv -Path $dialog.FileName
                  $statusLabel.Text = "Saved to $($dialog.FileName)"
              }
              else {
                  $statusLabel.Text = "Export cancelled"
              }
          })

          $form.Controls.AddRange(@($tokenBox, $exportButton, $statusLabel))
          [void]$form.ShowDialog()
      }

      Show-ReportTool
    `,
    "ps-124": ps`
      Add-Type -AssemblyName PresentationFramework

      [xml]$xaml = @"
      <Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
              xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"
              Title="Service lookup" Width="360" Height="220">
        <StackPanel Margin="12">
          <TextBlock Text="Service name:" />
          <TextBox x:Name="NameBox" />
          <Button x:Name="LookupButton" Content="Look up" IsDefault="True" />
          <TextBlock x:Name="ResultText" />
        </StackPanel>
      </Window>
      "@
      $window = [Windows.Markup.XamlReader]::Load((New-Object System.Xml.XmlNodeReader $xaml))

      $nameBox = $window.FindName("NameBox")
      $lookupButton = $window.FindName("LookupButton")
      $resultText = $window.FindName("ResultText")

      $lookupButton.Add_Click({
          $name = $nameBox.Text.Trim()
          try {
              $s = Get-Service -Name $name -ErrorAction Stop
              $resultText.Text = "$name is $($s.Status)"
          }
          catch {
              $resultText.Text = "No service called $name"
          }
      })

      [void]$window.ShowDialog()
    `
  };
  LABS.forEach(function (l) { if (!l.solution && SOLUTIONS[l.id]) l.solution = SOLUTIONS[l.id]; l.drills = []; T.LABS.push(l); });
  T.UPCOMING = T.UPCOMING.filter(function (row) { return row.module !== 3; });
})();
