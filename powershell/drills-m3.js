/* sudo learn — PowerShell Module 3 practice drills (3 per lab, +5 XP each). Loaded after labs-m3.js.
   GUI drills pause like the labs do; checks drive them with r.interact([...]) and G = PSLab.H.gui. */
(function () {
  "use strict";
  var T = window.PS_TRACK, H = window.PSLab.H, G = H.gui, ps = T.ps, lines = T.lines;
  var INCIDENT = "Initialize-LabScenario incident";
  function asList(v) { return v === undefined || v === null ? [] : Array.isArray(v) ? v : [v]; }
  function str(v) { return v === null || v === undefined ? "" : window.PSEngine.toStr(v); }
  function control(r, name, kind) {
    var v = r.v(name);
    if (!v || !v.guiKind) return "I can't find a " + kind + " in $" + name + " yet.";
    if (v.guiKind !== kind) return "$" + name + " should be a " + kind + ", but it's a " + v.guiKind + ".";
    return v;
  }
  function waits(r, kind) {
    if (r.error) return "The script stopped with an error: " + r.error.message;
    if (!r.pause) return "The script finished without showing a window.";
    if (kind && r.pause.kind !== kind) return "Expected the script to wait for a " + kind + ", but it's waiting for a " + r.pause.kind + ".";
    return true;
  }
  var WINFORMS = "Add-Type -AssemblyName System.Windows.Forms\n";

  var DRILLS = {
    "ps-119": [
      {
        id: "d1", title: "Pick exactly one",
        text: "<p>Show the processes' <code>Name</code> and <code>Id</code> in an Out-GridView titled <code>Pick a process</code> that allows <b>one</b> row only (<code>-OutputMode Single</code>), and store the pick in <code>$proc</code>.</p>",
        starter: ps`
          # $proc = ...
        `,
        solution: ps`
          $proc = Get-Process | Select-Object Name, Id | Out-GridView -Title "Pick a process" -OutputMode Single
        `,
        check: function (r) {
          var p = waits(r, "grid");
          if (p !== true) return p;
          var g = r.gui.grids[r.pause.gridIndex];
          if (g.title !== "Pick a process") return "Title the grid \"Pick a process\".";
          if (g.mode !== "single") return "Allow only one row: -OutputMode Single.";
          var r2 = r.interact([G.answer([2])]);
          var got = r2.v("proc");
          if (!got || !got.get || str(got.get("Name")) !== str(g.items[2].get("Name"))) return "After picking the third row, $proc should hold it.";
          return H.same(got.names(), ["Name", "Id"]) ? true : "Show only Name and Id (Select-Object Name, Id).";
        }
      },
      {
        id: "d2", title: "Ask before deleting",
        text: "<p>Ask with a <code>YesNo</code> MessageBox titled <code>Clean up</code>, with the <code>Warning</code> icon: <code>Delete 3 temp file(s)?</code> (count the <code>*.tmp</code> files in <code>temp</code>). Delete them only if the answer is <b>Yes</b>.</p>",
        files: { "temp/a.tmp": "x\n", "temp/b.tmp": "x\n", "temp/c.tmp": "x\n", "temp/keep.txt": "keep\n" },
        starter: ps`
          Add-Type -AssemblyName System.Windows.Forms
          $tmp = Get-ChildItem temp -Filter *.tmp
        `,
        solution: ps`
          Add-Type -AssemblyName System.Windows.Forms
          $tmp = Get-ChildItem temp -Filter *.tmp
          $answer = [System.Windows.Forms.MessageBox]::Show("Delete $(@($tmp).Count) temp file(s)?", "Clean up", "YesNo", "Warning")
          if ($answer -eq "Yes") { $tmp | Remove-Item }
        `,
        check: function (r) {
          var p = waits(r, "messagebox");
          if (p !== true) return p;
          var m = r.pause;
          if (m.text !== "Delete 3 temp file(s)?" || m.caption !== "Clean up" || m.buttons.join(",") !== "Yes,No" || !/warning/i.test(m.icon)) return "Expected a YesNo Warning MessageBox titled Clean up asking \"Delete 3 temp file(s)?\". Got " + H.show(m.text) + " / " + H.show(m.caption) + " / " + m.buttons.join("") + " / " + m.icon + ".";
          var no = r.interact([G.answer("No")]);
          if (no.file("temp/a.tmp") === null) return "After No, the files should still be there.";
          var yes = r.interact([G.answer("Yes")]);
          if (yes.file("temp/a.tmp") !== null || yes.file("temp/c.tmp") !== null) return "After Yes, the .tmp files should be deleted.";
          return yes.file("temp/keep.txt") !== null ? true : "Delete only the .tmp files: keep.txt was removed too.";
        }
      },
      {
        id: "d3", title: "No stray OK",
        text: "<p>Show an <code>Information</code> MessageBox titled <code>Backup</code> saying <code>Backup finished</code>, then print <code>done</code>. The output must be just <code>done</code>.</p>",
        starter: ps`
          Add-Type -AssemblyName System.Windows.Forms
          [System.Windows.Forms.MessageBox]::Show("Backup finished", "Backup", "OK", "Information")
          "done"
        `,
        solution: ps`
          Add-Type -AssemblyName System.Windows.Forms
          [void][System.Windows.Forms.MessageBox]::Show("Backup finished", "Backup", "OK", "Information")
          "done"
        `,
        check: function (r) {
          var p = waits(r, "messagebox");
          if (p !== true) return p;
          if (r.pause.text !== "Backup finished" || r.pause.caption !== "Backup") return "The MessageBox should say \"Backup finished\", titled Backup.";
          var r2 = r.interact([G.answer("OK")]);
          return H.same(r2.lines, ["done"]) ? true : "After clicking OK the output should be just \"done\", but it's " + H.show(r2.lines) + ". Put [void] in front of the call.";
        }
      }
    ],

    "ps-120": [
      {
        id: "d1", title: "Size it by parts",
        text: "<p>Create <code>$form</code> titled <code>Disk check</code>, set its <code>Width</code> to 300 and <code>Height</code> to 150 (one property at a time), and show it.</p>",
        starter: ps`
          Add-Type -AssemblyName System.Windows.Forms
        `,
        solution: ps`
          Add-Type -AssemblyName System.Windows.Forms
          $form = New-Object System.Windows.Forms.Form
          $form.Text = "Disk check"
          $form.Width = 300
          $form.Height = 150
          [void]$form.ShowDialog()
        `,
        check: function (r) {
          var f = control(r, "form", "Form");
          if (typeof f === "string") return f;
          if (str(f.get("Text")) !== "Disk check") return "Title it \"Disk check\".";
          if (f.get("Width") !== 300 || f.get("Height") !== 150) return "The form should be 300 x 150, but it's " + f.get("Width") + " x " + f.get("Height") + ".";
          return waits(r, "form");
        }
      },
      {
        id: "d2", title: "OK or Cancel",
        text: "<p>Add an <code>OK</code> button (<code>$okButton</code>, at (40, 60)) whose <code>DialogResult</code> is <code>OK</code>, and a <code>Cancel</code> button (<code>$cancelButton</code>, at (140, 60)) whose <code>DialogResult</code> is <code>Cancel</code>. After the window closes, print <code>Result: OK</code> or <code>Result: Cancel</code>.</p>",
        starter: ps`
          Add-Type -AssemblyName System.Windows.Forms
          $form = New-Object System.Windows.Forms.Form
          $form.Text = "Continue?"
        `,
        solution: ps`
          Add-Type -AssemblyName System.Windows.Forms
          $form = New-Object System.Windows.Forms.Form
          $form.Text = "Continue?"
          $okButton = New-Object System.Windows.Forms.Button
          $okButton.Text = "OK"
          $okButton.Location = New-Object System.Drawing.Point(40, 60)
          $okButton.DialogResult = "OK"
          $cancelButton = New-Object System.Windows.Forms.Button
          $cancelButton.Text = "Cancel"
          $cancelButton.Location = New-Object System.Drawing.Point(140, 60)
          $cancelButton.DialogResult = "Cancel"
          $form.Controls.AddRange(@($okButton, $cancelButton))
          $result = $form.ShowDialog()
          "Result: $result"
        `,
        check: function (r) {
          var p = waits(r, "form");
          if (p !== true) return p;
          var ok = control(r, "okButton", "Button"), cancel = control(r, "cancelButton", "Button");
          if (typeof ok === "string") return ok;
          if (typeof cancel === "string") return cancel;
          var r1 = r.interact([G.click(ok)]);
          if (r1.pause) return "Clicking OK should close the window: set $okButton.DialogResult = \"OK\" (and add the button to the form).";
          if (r1.lines.indexOf("Result: OK") < 0) return "After clicking OK, print \"Result: OK\". Printed: " + H.show(r1.lines);
          var r2 = r.interact([G.click(cancel)]);
          if (r2.pause) return "Clicking Cancel should close the window: set $cancelButton.DialogResult = \"Cancel\".";
          return r2.lines.indexOf("Result: Cancel") >= 0 ? true : "After clicking Cancel, print \"Result: Cancel\".";
        }
      },
      {
        id: "d3", title: "Read the box afterwards",
        text: "<p>The window below asks for a server name. After it closes, if the result is <code>OK</code>, set <code>$server</code> to what was typed in <code>$nameBox</code> (trimmed); otherwise set <code>$server</code> to <code>$null</code>.</p>",
        starter: ps`
          Add-Type -AssemblyName System.Windows.Forms
          $form = New-Object System.Windows.Forms.Form
          $form.Text = "Server name"
          $nameBox = New-Object System.Windows.Forms.TextBox
          $okButton = New-Object System.Windows.Forms.Button
          $okButton.Text = "OK"
          $okButton.Location = New-Object System.Drawing.Point(0, 40)
          $okButton.DialogResult = "OK"
          $form.Controls.AddRange(@($nameBox, $okButton))
          $result = $form.ShowDialog()
          # $server = ...
        `,
        solution: ps`
          Add-Type -AssemblyName System.Windows.Forms
          $form = New-Object System.Windows.Forms.Form
          $form.Text = "Server name"
          $nameBox = New-Object System.Windows.Forms.TextBox
          $okButton = New-Object System.Windows.Forms.Button
          $okButton.Text = "OK"
          $okButton.Location = New-Object System.Drawing.Point(0, 40)
          $okButton.DialogResult = "OK"
          $form.Controls.AddRange(@($nameBox, $okButton))
          $result = $form.ShowDialog()
          $server = if ($result -eq "OK") { $nameBox.Text.Trim() } else { $null }
        `,
        check: function (r) {
          var p = waits(r, "form");
          if (p !== true) return p;
          var box = r.v("nameBox"), ok = r.v("okButton");
          if (!box || !box.guiId || !ok || !ok.guiId) return "Keep $nameBox and $okButton from the starter.";
          var r1 = r.interact([G.text(box, "  srv-01 "), G.click(ok)]);
          if (r1.v("server") !== "srv-01") return "After typing \"  srv-01 \" and clicking OK, $server should be \"srv-01\", but it's " + H.show(r1.v("server")) + ".";
          var r2 = r.interact([G.text(box, "srv-02"), G.close()]);
          return r2.v("server") === null || r2.v("server") === undefined ? true : "After closing with ✕ (Cancel), $server should be $null, but it's " + H.show(r2.v("server")) + ".";
        }
      }
    ],

    "ps-121": [
      {
        id: "d1", title: "Click counter",
        text: "<p>Each click of <code>$button</code> should add 1 to <code>$clicks</code> and set <code>$label</code> to <code>Clicked 3 time(s)</code> (with the real number).</p>",
        starter: ps`
          Add-Type -AssemblyName System.Windows.Forms
          $form = New-Object System.Windows.Forms.Form
          $button = New-Object System.Windows.Forms.Button
          $button.Text = "Click me"
          $label = New-Object System.Windows.Forms.Label
          $label.Location = New-Object System.Drawing.Point(0, 40)
          $form.Controls.AddRange(@($button, $label))
          $clicks = 0

          [void]$form.ShowDialog()
        `,
        solution: ps`
          Add-Type -AssemblyName System.Windows.Forms
          $form = New-Object System.Windows.Forms.Form
          $button = New-Object System.Windows.Forms.Button
          $button.Text = "Click me"
          $label = New-Object System.Windows.Forms.Label
          $label.Location = New-Object System.Drawing.Point(0, 40)
          $form.Controls.AddRange(@($button, $label))
          $clicks = 0
          $button.Add_Click({
              $script:clicks++
              $label.Text = "Clicked $script:clicks time(s)"
          })
          [void]$form.ShowDialog()
        `,
        check: function (r) {
          var p = waits(r, "form");
          if (p !== true) return p;
          var b = r.v("button");
          if (!b || !b.guiId) return "Keep $button from the starter.";
          var r2 = r.interact([G.click(b), G.click(b), G.click(b)]);
          if (str(r2.v("label").get("Text")) !== "Clicked 3 time(s)") return "After 3 clicks, $label should say \"Clicked 3 time(s)\". It says " + H.show(str(r2.v("label").get("Text"))) + ".";
          return r2.v("clicks") === 3 ? true : "$clicks should be 3 after 3 clicks, but it's " + H.show(r2.v("clicks")) + ". Use $script:clicks++.";
        }
      },
      {
        id: "d2", title: "Live character count",
        text: "<p>As the user types in <code>$msgBox</code>, show <code>12 / 140</code> (the text's length) in <code>$countLabel</code>. Use the <code>TextChanged</code> event.</p>",
        starter: ps`
          Add-Type -AssemblyName System.Windows.Forms
          $form = New-Object System.Windows.Forms.Form
          $msgBox = New-Object System.Windows.Forms.TextBox
          $msgBox.Width = 250
          $countLabel = New-Object System.Windows.Forms.Label
          $countLabel.Location = New-Object System.Drawing.Point(0, 40)
          $countLabel.Text = "0 / 140"
          $form.Controls.AddRange(@($msgBox, $countLabel))

          [void]$form.ShowDialog()
        `,
        solution: ps`
          Add-Type -AssemblyName System.Windows.Forms
          $form = New-Object System.Windows.Forms.Form
          $msgBox = New-Object System.Windows.Forms.TextBox
          $msgBox.Width = 250
          $countLabel = New-Object System.Windows.Forms.Label
          $countLabel.Location = New-Object System.Drawing.Point(0, 40)
          $countLabel.Text = "0 / 140"
          $form.Controls.AddRange(@($msgBox, $countLabel))
          $msgBox.Add_TextChanged({ $countLabel.Text = "$($msgBox.Text.Length) / 140" })
          [void]$form.ShowDialog()
        `,
        check: function (r) {
          var p = waits(r, "form");
          if (p !== true) return p;
          var box = r.v("msgBox");
          if (!box || !box.guiId) return "Keep $msgBox from the starter.";
          var r2 = r.interact([G.text(box, "Server is up")]);
          var t = str(r2.v("countLabel").get("Text"));
          return t === "12 / 140" ? true : "After typing \"Server is up\", $countLabel should say \"12 / 140\". It says " + H.show(t) + ".";
        }
      },
      {
        id: "d3", title: "Enable when ready",
        text: "<p>Start with <code>$goButton</code> disabled (<code>Enabled = $false</code>). Enable it as soon as <code>$nameBox</code> has any non-space text, and disable it again if the box is emptied.</p>",
        starter: ps`
          Add-Type -AssemblyName System.Windows.Forms
          $form = New-Object System.Windows.Forms.Form
          $nameBox = New-Object System.Windows.Forms.TextBox
          $goButton = New-Object System.Windows.Forms.Button
          $goButton.Text = "Go"
          $goButton.Location = New-Object System.Drawing.Point(0, 40)
          $form.Controls.AddRange(@($nameBox, $goButton))

          [void]$form.ShowDialog()
        `,
        solution: ps`
          Add-Type -AssemblyName System.Windows.Forms
          $form = New-Object System.Windows.Forms.Form
          $nameBox = New-Object System.Windows.Forms.TextBox
          $goButton = New-Object System.Windows.Forms.Button
          $goButton.Text = "Go"
          $goButton.Location = New-Object System.Drawing.Point(0, 40)
          $form.Controls.AddRange(@($nameBox, $goButton))
          $goButton.Enabled = $false
          $nameBox.Add_TextChanged({ $goButton.Enabled = $nameBox.Text.Trim().Length -gt 0 })
          [void]$form.ShowDialog()
        `,
        check: function (r) {
          var p = waits(r, "form");
          if (p !== true) return p;
          var box = r.v("nameBox"), go = r.v("goButton");
          if (!box || !box.guiId || !go || !go.guiId) return "Keep $nameBox and $goButton from the starter.";
          var B = window.PSEngine.toBool;
          if (B(go.get("Enabled"))) return "$goButton should start disabled: $goButton.Enabled = $false.";
          var r1 = r.interact([G.text(box, "web01")]);
          if (!B(r1.v("goButton").get("Enabled"))) return "After typing web01, $goButton should be enabled (use the TextChanged event).";
          var r2 = r.interact([G.text(box, "web01"), G.text(box, "   ")]);
          return !B(r2.v("goButton").get("Enabled")) ? true : "After clearing the box (only spaces left), $goButton should be disabled again.";
        }
      }
    ],

    "ps-122": [
      {
        id: "d1", title: "Fill a ListBox",
        text: "<p>Fill <code>$listBox</code> with the names of the <b>stopped</b> services, without printing anything.</p>",
        starter: ps`
          Add-Type -AssemblyName System.Windows.Forms
          $form = New-Object System.Windows.Forms.Form
          $listBox = New-Object System.Windows.Forms.ListBox
          $listBox.Size = New-Object System.Drawing.Size(250, 150)
          $form.Controls.Add($listBox)

          [void]$form.ShowDialog()
        `,
        solution: ps`
          Add-Type -AssemblyName System.Windows.Forms
          $form = New-Object System.Windows.Forms.Form
          $listBox = New-Object System.Windows.Forms.ListBox
          $listBox.Size = New-Object System.Drawing.Size(250, 150)
          $form.Controls.Add($listBox)
          foreach ($s in Get-Service | Where-Object Status -eq "Stopped") { [void]$listBox.Items.Add($s.Name) }
          [void]$form.ShowDialog()
        `,
        check: function (r) {
          var p = waits(r, "form");
          if (p !== true) return p;
          var l = control(r, "listBox", "ListBox");
          if (typeof l === "string") return l;
          var items = H.plain(l.get("Items"));
          if (!H.same(items, ["KestrelUpdater", "RemoteRegistry", "wuauserv"])) return "$listBox should list KestrelUpdater, RemoteRegistry and wuauserv. It has " + H.show(items) + ".";
          return r.lines.length ? "Something was printed (" + H.show(r.lines) + "): .Items.Add() returns an index. Use [void]." : true;
        }
      },
      {
        id: "d2", title: "Choose an environment",
        text: "<p>Fill <code>$envBox</code> with <code>dev</code>, <code>test</code> and <code>prod</code>, preselect <code>dev</code> (<code>SelectedIndex = 0</code>), and when the choice changes set <code>$envLabel</code> to <code>Target: prod</code> (the chosen item).</p>",
        starter: ps`
          Add-Type -AssemblyName System.Windows.Forms
          $form = New-Object System.Windows.Forms.Form
          $envBox = New-Object System.Windows.Forms.ComboBox
          $envBox.DropDownStyle = "DropDownList"
          $envLabel = New-Object System.Windows.Forms.Label
          $envLabel.Location = New-Object System.Drawing.Point(0, 40)
          $form.Controls.AddRange(@($envBox, $envLabel))

          [void]$form.ShowDialog()
        `,
        solution: ps`
          Add-Type -AssemblyName System.Windows.Forms
          $form = New-Object System.Windows.Forms.Form
          $envBox = New-Object System.Windows.Forms.ComboBox
          $envBox.DropDownStyle = "DropDownList"
          $envLabel = New-Object System.Windows.Forms.Label
          $envLabel.Location = New-Object System.Drawing.Point(0, 40)
          $form.Controls.AddRange(@($envBox, $envLabel))
          $envBox.Items.AddRange(@("dev", "test", "prod"))
          $envBox.Add_SelectedIndexChanged({ $envLabel.Text = "Target: $($envBox.SelectedItem)" })
          $envBox.SelectedIndex = 0
          [void]$form.ShowDialog()
        `,
        check: function (r) {
          var p = waits(r, "form");
          if (p !== true) return p;
          var c = r.v("envBox");
          if (!c || !c.guiId) return "Keep $envBox from the starter.";
          if (!H.same(H.plain(c.get("Items")), ["dev", "test", "prod"])) return "$envBox should hold dev, test and prod.";
          if (c.get("SelectedIndex") !== 0) return "Preselect dev: $envBox.SelectedIndex = 0.";
          var r2 = r.interact([G.select(c, 2)]);
          var t = str(r2.v("envLabel").get("Text"));
          return t === "Target: prod" ? true : "After choosing prod, $envLabel should say \"Target: prod\". It says " + H.show(t) + ".";
        }
      },
      {
        id: "d3", title: "A grid of accounts",
        text: "<p>Show every local user's <code>Name</code> and <code>Enabled</code> in <code>$userGrid</code> (a DataGridView).</p>",
        starter: ps`
          Add-Type -AssemblyName System.Windows.Forms
          $form = New-Object System.Windows.Forms.Form
          $form.Size = New-Object System.Drawing.Size(400, 300)

          [void]$form.ShowDialog()
        `,
        solution: ps`
          Add-Type -AssemblyName System.Windows.Forms
          $form = New-Object System.Windows.Forms.Form
          $form.Size = New-Object System.Drawing.Size(400, 300)
          $userGrid = New-Object System.Windows.Forms.DataGridView
          $userGrid.Size = New-Object System.Drawing.Size(360, 240)
          $userGrid.DataSource = [System.Collections.ArrayList]@(Get-LocalUser | Select-Object Name, Enabled)
          $form.Controls.Add($userGrid)
          [void]$form.ShowDialog()
        `,
        check: function (r) {
          var p = waits(r, "form");
          if (p !== true) return p;
          var g = control(r, "userGrid", "DataGridView");
          if (typeof g === "string") return g;
          var rows = asList(g.get("DataSource"));
          if (rows.length !== r.system.users.length) return "$userGrid should have one row per user (" + r.system.users.length + "), but has " + rows.length + ".";
          if (!rows[0].names || !H.same(rows[0].names(), ["Name", "Enabled"])) return "Show just Name and Enabled (Select-Object Name, Enabled).";
          return (r.v("form").get("Controls") || []).indexOf(g) >= 0 ? true : "Add $userGrid to $form.Controls.";
        }
      }
    ],

    "ps-123": [
      {
        id: "d1", title: "Open a log",
        text: "<p>Show an OpenFileDialog with the filter <code>Log files (*.log)|*.log</code>. If the user picks a file, set <code>$lineCount</code> to its number of lines; if they cancel, set it to <code>0</code>.</p>",
        files: { "logs/app.log": lines("start", "warn: slow", "error: timeout", "stop"), "logs/old.log": lines("x") },
        starter: ps`
          Add-Type -AssemblyName System.Windows.Forms
        `,
        solution: ps`
          Add-Type -AssemblyName System.Windows.Forms
          $dialog = New-Object System.Windows.Forms.OpenFileDialog
          $dialog.Filter = "Log files (*.log)|*.log"
          if ($dialog.ShowDialog() -eq "OK") { $lineCount = @(Get-Content $dialog.FileName).Count }
          else { $lineCount = 0 }
        `,
        check: function (r) {
          var p = waits(r, "file");
          if (p !== true) return p;
          if (r.pause.mode !== "open") return "Use an OpenFileDialog (not a SaveFileDialog).";
          if (!/\*\.log/.test(r.pause.filter)) return "Set $dialog.Filter = \"Log files (*.log)|*.log\".";
          var r1 = r.interact([G.answer({ result: "OK", fileName: "logs\\app.log" })]);
          if (r1.v("lineCount") !== 4) return "After picking logs\\app.log (4 lines), $lineCount should be 4, but it's " + H.show(r1.v("lineCount")) + ".";
          var r2 = r.interact([G.answer({ result: "Cancel" })]);
          return r2.v("lineCount") === 0 ? true : "After Cancel, $lineCount should be 0, but it's " + H.show(r2.v("lineCount")) + ".";
        }
      },
      {
        id: "d2", title: "A safe password box",
        text: "<p>Make <code>$pwBox</code> hide what's typed, and limit it to 64 characters (<code>MaxLength</code>). Then fix the line that leaks the password.</p>",
        starter: ps`
          Add-Type -AssemblyName System.Windows.Forms
          $form = New-Object System.Windows.Forms.Form
          $pwBox = New-Object System.Windows.Forms.TextBox
          $status = New-Object System.Windows.Forms.Label
          $status.Location = New-Object System.Drawing.Point(0, 40)
          $form.Controls.AddRange(@($pwBox, $status))
          $pwBox.Add_TextChanged({ $status.Text = "Password: $($pwBox.Text)" })   # leaks it!
          [void]$form.ShowDialog()
        `,
        solution: ps`
          Add-Type -AssemblyName System.Windows.Forms
          $form = New-Object System.Windows.Forms.Form
          $pwBox = New-Object System.Windows.Forms.TextBox
          $pwBox.UseSystemPasswordChar = $true
          $pwBox.MaxLength = 64
          $status = New-Object System.Windows.Forms.Label
          $status.Location = New-Object System.Drawing.Point(0, 40)
          $form.Controls.AddRange(@($pwBox, $status))
          $pwBox.Add_TextChanged({ $status.Text = "Password: $($pwBox.Text.Length) characters" })
          [void]$form.ShowDialog()
        `,
        check: function (r) {
          var p = waits(r, "form");
          if (p !== true) return p;
          var b = r.v("pwBox");
          if (!b || !b.guiId) return "Keep $pwBox from the starter.";
          if (!window.PSEngine.toBool(b.get("UseSystemPasswordChar"))) return "Set $pwBox.UseSystemPasswordChar = $true.";
          if (b.get("MaxLength") !== 64) return "Set $pwBox.MaxLength = 64.";
          var r2 = r.interact([G.text(b, "Hunter2!x")]);
          var all = G.all(r2, "Label").map(function (c) { return str(c.get("Text")); }).join(" ") + " " + r2.allLines.join(" ");
          return /Hunter2!x/.test(all) ? "The typed password still appears on screen. Show its length or nothing, never the text." : true;
        }
      },
      {
        id: "d3", title: "Logic without the window",
        text: "<p>Write <code>Test-ServiceName</code>: given <code>-Name</code>, return <code>$true</code> if a service with that name exists and <code>$false</code> if not, without showing any error. It's the kind of function a GUI's button would call.</p>",
        starter: ps`
          function Test-ServiceName {

          }
        `,
        solution: ps`
          function Test-ServiceName {
              param([string]$Name)
              [bool](Get-Service -Name $Name -ErrorAction SilentlyContinue)
          }
        `,
        check: function (r) {
          if (!r.fn("Test-ServiceName")) return "I can't find a function called Test-ServiceName.";
          var a = r.ps("Test-ServiceName -Name W3SVC");
          if (!a.ok || a.value !== true) return "Test-ServiceName -Name W3SVC should return $true, got " + H.show(a.raw) + (a.errors[0] ? " (" + a.errors[0] + ")" : "") + ".";
          var b = r.ps("Test-ServiceName -Name Nope");
          if (b.errors.length) return "For a missing service, an error was shown: " + b.errors[0] + ". Use -ErrorAction SilentlyContinue.";
          return b.value === false ? true : "Test-ServiceName -Name Nope should return $false, got " + H.show(b.raw) + ".";
        }
      }
    ],

    "ps-124": [
      {
        id: "d1", title: "Hello, XAML",
        text: "<p>Load <code>$window</code> from XAML: a Window titled <code>Hello</code>, 300 × 150, holding a TextBlock with the text <code>Hi from WPF</code>. Show it.</p>",
        starter: ps`
          Add-Type -AssemblyName PresentationFramework
        `,
        solution: ps`
          Add-Type -AssemblyName PresentationFramework
          [xml]$xaml = @"
          <Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
                  Title="Hello" Width="300" Height="150">
            <TextBlock Text="Hi from WPF" />
          </Window>
          "@
          $window = [Windows.Markup.XamlReader]::Load((New-Object System.Xml.XmlNodeReader $xaml))
          [void]$window.ShowDialog()
        `,
        check: function (r) {
          var w = r.v("window");
          if (!w || w.guiKind !== "Window") return "Load a WPF Window into $window with [Windows.Markup.XamlReader]::Load(...).";
          if (str(w.get("Title")) !== "Hello" || w.get("Width") !== 300 || w.get("Height") !== 150) return "The Window should be titled Hello, 300 x 150.";
          var tb = G.find(r, "TextBlock", function (c) { return str(c.get("Text")) === "Hi from WPF"; });
          if (!tb) return "Add <TextBlock Text=\"Hi from WPF\" /> inside the Window.";
          return waits(r, "form");
        }
      },
      {
        id: "d2", title: "Find and set",
        text: "<p>Get the TextBlock named <code>StatusText</code> into <code>$status</code> with <code>FindName</code>, and set its text to <code>Ready</code> before showing the window.</p>",
        starter: ps`
          Add-Type -AssemblyName PresentationFramework
          [xml]$xaml = @"
          <Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
                  xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"
                  Title="Status" Width="260" Height="120">
            <StackPanel Margin="10">
              <TextBlock x:Name="StatusText" Text="Loading..." />
            </StackPanel>
          </Window>
          "@
          $window = [Windows.Markup.XamlReader]::Load((New-Object System.Xml.XmlNodeReader $xaml))

          [void]$window.ShowDialog()
        `,
        solution: ps`
          Add-Type -AssemblyName PresentationFramework
          [xml]$xaml = @"
          <Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
                  xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"
                  Title="Status" Width="260" Height="120">
            <StackPanel Margin="10">
              <TextBlock x:Name="StatusText" Text="Loading..." />
            </StackPanel>
          </Window>
          "@
          $window = [Windows.Markup.XamlReader]::Load((New-Object System.Xml.XmlNodeReader $xaml))
          $status = $window.FindName("StatusText")
          $status.Text = "Ready"
          [void]$window.ShowDialog()
        `,
        check: function (r) {
          var s = r.v("status");
          if (!s || s.guiKind !== "TextBlock") return "$status should be the StatusText TextBlock: $window.FindName(\"StatusText\").";
          if (str(s.get("Text")) !== "Ready") return "Set $status.Text = \"Ready\".";
          return waits(r, "form");
        }
      },
      {
        id: "d3", title: "Tick to continue",
        text: "<p>The <b>Continue</b> button starts disabled. When <code>AgreeBox</code> is ticked, enable it (<code>IsEnabled</code>); when it's unticked, disable it again. Use the CheckBox's <code>Checked</code> and <code>Unchecked</code> events.</p>",
        starter: ps`
          Add-Type -AssemblyName PresentationFramework
          [xml]$xaml = @"
          <Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
                  xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"
                  Title="Terms" Width="280" Height="140">
            <StackPanel Margin="10">
              <CheckBox x:Name="AgreeBox" Content="I have a change ticket" />
              <Button x:Name="GoButton" Content="Continue" IsEnabled="False" />
            </StackPanel>
          </Window>
          "@
          $window = [Windows.Markup.XamlReader]::Load((New-Object System.Xml.XmlNodeReader $xaml))
          $agreeBox = $window.FindName("AgreeBox")
          $goButton = $window.FindName("GoButton")

          [void]$window.ShowDialog()
        `,
        solution: ps`
          Add-Type -AssemblyName PresentationFramework
          [xml]$xaml = @"
          <Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
                  xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"
                  Title="Terms" Width="280" Height="140">
            <StackPanel Margin="10">
              <CheckBox x:Name="AgreeBox" Content="I have a change ticket" />
              <Button x:Name="GoButton" Content="Continue" IsEnabled="False" />
            </StackPanel>
          </Window>
          "@
          $window = [Windows.Markup.XamlReader]::Load((New-Object System.Xml.XmlNodeReader $xaml))
          $agreeBox = $window.FindName("AgreeBox")
          $goButton = $window.FindName("GoButton")
          $agreeBox.Add_Checked({ $goButton.IsEnabled = $true })
          $agreeBox.Add_Unchecked({ $goButton.IsEnabled = $false })
          [void]$window.ShowDialog()
        `,
        check: function (r) {
          var p = waits(r, "form");
          if (p !== true) return p;
          var cb = r.v("agreeBox"), go = r.v("goButton");
          if (!cb || !cb.guiId || !go || !go.guiId) return "Keep $agreeBox and $goButton from the starter.";
          var B = window.PSEngine.toBool;
          var r1 = r.interact([G.check(cb, true)]);
          if (!B(r1.v("goButton").get("IsEnabled"))) return "After ticking the box, Continue should be enabled ($goButton.IsEnabled = $true in Add_Checked).";
          var r2 = r.interact([G.check(cb, true), G.check(cb, false)]);
          return !B(r2.v("goButton").get("IsEnabled")) ? true : "After unticking, Continue should be disabled again (Add_Unchecked).";
        }
      }
    ],

    "ps-125": [
      {
        id: "d1", title: "An audit line",
        text: "<p>Write <code>Write-Audit</code> with <code>-Action</code> and <code>-Target</code>. It appends a line to <code>audit.log</code>: <code>2026-11-10 09:00:00 dev reset ana.silva</code> (current date and time, then <code>$env:USERNAME</code>, the action and the target).</p>",
        starter: ps`
          function Write-Audit {

          }
        `,
        solution: ps`
          function Write-Audit {
              param([string]$Action, [string]$Target)
              Add-Content -Path audit.log -Value "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $env:USERNAME $Action $Target"
          }
        `,
        check: function (r) {
          if (!r.fn("Write-Audit")) return "I can't find a function called Write-Audit.";
          var res = r.run(r.src + "\nWrite-Audit -Action reset -Target ana.silva\nWrite-Audit -Action disabled -Target temp.admin");
          if (res.errors.length) return "Write-Audit failed: " + res.errors[0];
          var log = res.file("audit.log");
          var want = "2026-11-10 09:00:00 dev reset ana.silva\n2026-11-10 09:00:00 dev disabled temp.admin";
          return log !== null && log.trim().replace(/\r/g, "") === want ? true : "After two calls, audit.log should hold:\n" + want + "\nIt holds: " + H.show(log);
        }
      },
      {
        id: "d2", title: "Count the failures",
        text: "<p>Write <code>Get-FailureCount -Name</code>: the number of failed logons (4625) for that account. <code>temp.admin</code> → 2, an account with none → 0 (no error).</p>",
        prelude: INCIDENT,
        starter: ps`
          function Get-FailureCount {

          }
        `,
        solution: ps`
          function Get-FailureCount {
              param([string]$Name)
              @(Get-WinEvent -FilterHashtable @{ LogName = 'Security'; Id = 4625 } -ErrorAction SilentlyContinue |
                  Where-Object { $_.Properties[5].Value -eq $Name }).Count
          }
        `,
        check: function (r) {
          if (!r.fn("Get-FailureCount")) return "I can't find a function called Get-FailureCount.";
          var a = r.ps("Get-FailureCount -Name temp.admin");
          if (!a.ok || a.value !== 2) return "Get-FailureCount -Name temp.admin should return 2, got " + H.show(a.raw) + (a.errors[0] ? " (" + a.errors[0] + ")" : "") + ".";
          var b = r.ps("Get-FailureCount -Name ben.okoro");
          if (b.errors.length) return "For an account without failures, an error was shown: " + b.errors[0];
          return b.value === 0 ? true : "Get-FailureCount -Name ben.okoro should return 0, got " + H.show(b.raw) + ". Wrap the pipeline in @( ).Count.";
        }
      },
      {
        id: "d3", title: "Confirm, then act",
        text: "<p>For the account in <code>$user</code>, ask with a <code>YesNo</code>, <code>Warning</code> MessageBox titled <code>Confirm</code>: <code>Enable fay.wong?</code>. On <b>Yes</b>, enable it; on <b>No</b>, do nothing.</p>",
        starter: ps`
          Add-Type -AssemblyName System.Windows.Forms
          $user = "fay.wong"
        `,
        solution: ps`
          Add-Type -AssemblyName System.Windows.Forms
          $user = "fay.wong"
          $answer = [System.Windows.Forms.MessageBox]::Show("Enable $user?", "Confirm", "YesNo", "Warning")
          if ($answer -eq "Yes") { Enable-LocalUser -Name $user }
        `,
        check: function (r) {
          var p = waits(r, "messagebox");
          if (p !== true) return p;
          var m = r.pause;
          if (m.text !== "Enable fay.wong?" || m.caption !== "Confirm" || m.buttons.join(",") !== "Yes,No" || !/warning/i.test(m.icon)) return "Expected a YesNo Warning MessageBox titled Confirm asking \"Enable fay.wong?\". Got " + H.show(m.text) + " / " + H.show(m.caption) + " / " + m.buttons.join("") + " / " + m.icon + ".";
          var no = r.interact([G.answer("No")]);
          if (no.system.actions.length) return "After No, nothing should change, but: " + no.system.actions.join(", ");
          var yes = r.interact([G.answer("Yes")]);
          return yes.system.actions.indexOf("Enable-LocalUser fay.wong") >= 0 ? true : "After Yes, enable fay.wong with Enable-LocalUser.";
        }
      }
    ]
  };
  T.LABS.forEach(function (l) { if (DRILLS[l.id]) l.drills = DRILLS[l.id]; });
})();
