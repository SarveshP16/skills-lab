/* sudo learn — PowerShell Module 2: Files, data & the Windows system (PS-111..118).
   Labs 115-118 start with Initialize-LabScenario incident (in the prelude), which adds last night's attack
   to KC-WIN-01: a brute-forced RDP login, a new admin, a malicious process and persistence. */
(function () {
  "use strict";
  var T = window.PS_TRACK, H = window.PSLab.H, ps = T.ps, ex = T.ex, lines = T.lines;
  function srcHas(r, re, msg) { return re.test(r.src.replace(/#.*$/gm, "")) ? true : msg; }
  function many(prefix, n) { var a = []; for (var i = 1; i <= n; i++) a.push(prefix + " line " + i + ": request handled in " + (10 + i * 7) + " ms"); return a.join("\n") + "\n"; }
  var DANA = "Dana Park · Windows team", DEV = "Dev Patel · Security", MAYA = "Maya Chen · SRE lead";
  var INCIDENT = "Initialize-LabScenario incident";
  var LABS = [];
  function asList(v) { return v === undefined || v === null ? [] : Array.isArray(v) ? v : [v]; }

  /* ================================================================== PS-111 */
  var LOG_FILES = {
    "logs/app/app-2026-11-09.log": { content: many("app 11-09", 5), ageDays: 1 },
    "logs/app/app-2026-10-01.log": { content: many("app 10-01", 20), ageDays: 40 },
    "logs/app/app-2026-09-15.log": { content: many("app 09-15", 30), ageDays: 56 },
    "logs/iis/u_ex261028.log": { content: many("iis 10-28", 8), ageDays: 13 },
    "logs/iis/u_ex261002.log": { content: many("iis 10-02", 12), ageDays: 39 },
    "logs/readme.txt": { content: "Logs are kept for 30 days, then archived.\n", ageDays: 100 }
  };
  var OLD = ["logs/app/app-2026-10-01.log", "logs/app/app-2026-09-15.log", "logs/iis/u_ex261002.log"];
  function sizeKB(keys) { return Math.round(keys.reduce(function (a, k) { return a + new TextEncoder().encode(LOG_FILES[k].content).length; }, 0) / 1024 * 10) / 10; }

  LABS.push({
    id: "ps-111", n: 11, module: 2, ticket: "PS-111", xp: 100,
    title: "Clean up the log folder",
    topic: "Files & paths",
    from: MAYA,
    story: "<p>Our retention policy says logs stay on the server for 30 days, then get archived. Nobody has archived anything for two months, and the disk is filling up.</p>" +
      "<p>Find every log, work out which are older than 30 days and how much space they take, then move them into this month's archive folder.</p>",
    learn:
      '<div class="callout"><b>Files in this lab:</b> a <code>logs</code> folder with <code>app</code> and <code>iis</code> sub-folders, on the pretend server\'s disk at <code>C:\\lab</code>. Look around first: <code>Get-ChildItem logs -Recurse</code>.</div>' +
      "<h3>Get-ChildItem</h3><p>Lists files and folders. <code>-Recurse</code> goes into sub-folders, <code>-Filter *.log</code> keeps matching names, and <code>-File</code> / <code>-Directory</code> keep only one kind. Each result is a <b>FileInfo object</b>: <code>Name</code>, <code>FullName</code>, <code>Length</code> (bytes), <code>LastWriteTime</code>, <code>Extension</code>...</p>" +
      ex("Get-ChildItem logs -Recurse -Filter *.log\nGet-ChildItem logs -Recurse -File | Select-Object Name, Length, LastWriteTime") +
      "<h3>Dates</h3><p>\"Older than 30 days\" means a <code>LastWriteTime</code> before today minus 30 days. <code>(Get-Date).AddDays(-30)</code> gives that cut-off as a date, and dates compare with <code>-lt</code> / <code>-gt</code>:</p>" +
      ex("$cutoff = (Get-Date).AddDays(-30)\n$cutoff\nGet-ChildItem logs -Recurse -File | Where-Object LastWriteTime -lt $cutoff | Select-Object Name, LastWriteTime") +
      "<h3>Paths</h3><p>Build paths with <code>Join-Path</code> instead of gluing strings, and check them with <code>Test-Path</code>. <code>Get-Date -Format yyyy-MM</code> gives <code>2026-11</code>, handy for folder names.</p>" +
      ex('$folder = Join-Path "archive" (Get-Date -Format "yyyy-MM")\n$folder\nTest-Path $folder') +
      "<h3>Creating, moving, reading</h3>" +
      '<table class="t"><tr><th>Cmdlet</th><th>Does</th></tr>' +
      "<tr><td><code>New-Item -ItemType Directory -Path x -Force</code></td><td>makes a folder (and parents); <code>-Force</code> means no error if it exists</td></tr>" +
      "<tr><td><code>Move-Item -Path a -Destination folder</code></td><td>moves a file into a folder (accepts files from the pipeline)</td></tr>" +
      "<tr><td><code>Copy-Item</code>, <code>Remove-Item</code></td><td>copy / delete; all of these support <code>-WhatIf</code></td></tr>" +
      "<tr><td><code>Get-Content x -Tail 5</code></td><td>the last 5 lines of a file</td></tr>" +
      "<tr><td><code>Set-Content</code> / <code>Add-Content</code></td><td>write / append text</td></tr></table>" +
      ex("Get-Content logs\\readme.txt\nGet-ChildItem logs\\iis -File | Move-Item -Destination logs\\app -WhatIf"),
    starter: ps`
      # PS-111 · Clean up the log folder

      # 1) $logs: every .log file under logs (all sub-folders)


      # 2) $old: the .log files last written more than 30 days ago


      # 3) $oldKB: the total size of $old in KB, rounded to 1 decimal


      # 4) Create archive\2026-11 (build the name from today's date) and move the old logs into it
    `,
    files: LOG_FILES,
    objectives: [
      {
        id: "list",
        text: "<code>$logs</code> holds every <code>.log</code> file under <code>logs</code>, including sub-folders, as file objects.",
        hints: ["Get-ChildItem with -Recurse and -Filter *.log.", "$logs = Get-ChildItem -Path logs -Recurse -Filter *.log"],
        check: function (r) {
          var v = asList(r.p("logs"));
          if (r.v("logs") === undefined) return "I can't find a variable called $logs yet.";
          if (v.length && typeof v[0] === "string") return "$logs holds text. Keep the file objects (no -Name or .Name): later steps need their dates and sizes.";
          var got = v.map(function (f) { return f && f.Name; }).sort();
          var want = ["app-2026-09-15.log", "app-2026-10-01.log", "app-2026-11-09.log", "u_ex261002.log", "u_ex261028.log"];
          if (!H.same(got, want)) return "$logs should hold the 5 .log files (readme.txt isn't one). Yours: " + H.show(got) + (got.length < 5 ? ". Did you use -Recurse?" : "");
          return true;
        }
      },
      {
        id: "old",
        text: "<code>$old</code> holds the <code>.log</code> files whose <code>LastWriteTime</code> is more than 30 days before today.",
        hints: ["Filter $logs with Where-Object, comparing LastWriteTime with (Get-Date).AddDays(-30).", "$cutoff = (Get-Date).AddDays(-30)\n$old = $logs | Where-Object LastWriteTime -lt $cutoff"],
        check: function (r) {
          var got = asList(r.p("old")).map(function (f) { return f && f.Name; }).sort();
          var want = ["app-2026-09-15.log", "app-2026-10-01.log", "u_ex261002.log"];
          if (r.v("old") === undefined) return "I can't find a variable called $old yet.";
          if (!H.same(got, want)) return "$old should hold the 3 logs older than 30 days. Yours: " + H.show(got) + ".";
          var files = {}; files["logs/app/app-2026-11-09.log"] = { content: LOG_FILES["logs/app/app-2026-11-09.log"].content, ageDays: 45 };
          var r2 = r.run(null, { files: files });
          if (asList(r2.p("old")).length !== 4) return "When I made app-2026-11-09.log 45 days old, $old didn't pick it up. Compare each file's LastWriteTime with (Get-Date).AddDays(-30).";
          return true;
        }
      },
      {
        id: "size",
        text: "<code>$oldKB</code> is the total <code>Length</code> of <code>$old</code> in KB, rounded to 1 decimal.",
        hints: ["Measure-Object Length -Sum gives bytes in .Sum. Divide by 1KB and round with [math]::Round(x, 1).", "$oldKB = [math]::Round(($old | Measure-Object -Property Length -Sum).Sum / 1KB, 1)"],
        check: function (r) {
          var want = sizeKB(OLD);
          var v = r.v("oldKB");
          if (typeof v === "number" && Math.abs(v - want * 1024) < 2) return "$oldKB looks like bytes. Divide by 1KB.";
          return H.expect(r, "oldKB", want, "number");
        }
      },
      {
        id: "move",
        text: "Folder <code>archive\\2026-11</code> exists (name built with <code>Get-Date</code>), the 3 old logs are moved into it, and the recent ones stay where they are.",
        hints: ["Join-Path archive (Get-Date -Format yyyy-MM) gives the folder; New-Item -ItemType Directory -Force creates it; $old | Move-Item -Destination $folder moves them.",
          '$folder = Join-Path "archive" (Get-Date -Format "yyyy-MM")\nNew-Item -ItemType Directory -Path $folder -Force | Out-Null\n$old | Move-Item -Destination $folder'],
        check: function (r) {
          var names = ["app-2026-09-15.log", "app-2026-10-01.log", "u_ex261002.log"];
          for (var i = 0; i < names.length; i++) if (r.file("archive\\2026-11\\" + names[i]) === null) return "archive\\2026-11\\" + names[i] + " doesn't exist. Move the old logs into archive\\2026-11.";
          for (var j = 0; j < OLD.length; j++) if (r.file(OLD[j].replace(/\//g, "\\")) !== null) return OLD[j] + " is still in logs: move (not copy) the files.";
          if (r.file("logs\\app\\app-2026-11-09.log") === null || r.file("logs\\iis\\u_ex261028.log") === null) return "The recent logs were moved too. Only move $old.";
          if (r.file("archive\\2026-11\\app-2026-09-15.log") !== LOG_FILES["logs/app/app-2026-09-15.log"].content) return "The archived file's content changed. Use Move-Item.";
          return srcHas(r, /Get-Date/i, "Build the folder name from today's date with Get-Date -Format yyyy-MM, so the script works next month too.");
        }
      }
    ],
    debrief: "<p>Ticket closed. 3 logs archived and the policy enforced, and the script runs again next month unchanged, because the cut-off date and folder name come from <code>Get-Date</code>.</p>" +
      "<p>Notice you never parsed a single <code>dir</code> line: sizes and dates were properties, ready to filter and sum.</p>",
    realworld: "On your PC: Get-ChildItem $env:TEMP -Recurse -File | Where-Object LastWriteTime -lt (Get-Date).AddDays(-30) | Measure-Object Length -Sum. Add Remove-Item -WhatIf at the end to see what a cleanup would delete, safely.",
    quiz: [
      { q: "What does <code>-Recurse</code> add to Get-ChildItem?", options: ["Sorting", "Results from every sub-folder", "Hidden files only", "Deleting"], answer: 1, why: "Without it you only get the folder's direct contents." },
      { q: "How do you get \"30 days ago\" as a date?", options: ["Get-Date - 30", "(Get-Date).AddDays(-30)", "Get-Date -Days 30", "[datetime]-30"], answer: 1, why: "AddDays with a negative number goes back in time." },
      { q: "Why use <code>Join-Path</code> instead of <code>\"$a\\$b\"</code>?", options: ["It's faster", "It handles separators correctly (doubled or missing backslashes, other OSes)", "It creates the folder", "It's required"], answer: 1, why: "Join-Path builds valid paths whatever the pieces look like." }
    ]
  });

  /* ================================================================== PS-112 */
  var DISKS = lines("Server,Drive,FreeGB,SizeGB", "web-01,C,9,127", "web-02,C,45,127", "db-01,D,120,500", "db-01,C,18,127", "cache-01,C,4,64", "build-01,C,100,256");
  var FW = JSON.stringify({ server: "KC-WIN-01", firewall: { enabled: true, rules: [{ name: "HTTPS", port: 443, source: "any" }, { name: "SSH", port: 22, source: "10.0.0.0/8" }, { name: "RDP", port: 3389, source: "any" }] } }, null, 2) + "\n";
  LABS.push({
    id: "ps-112", n: 12, module: 2, ticket: "PS-112", xp: 100,
    title: "Disks and firewall rules",
    topic: "CSV & JSON",
    from: DANA,
    story: "<p>Two jobs from this morning's stand-up: a CSV export of disk space from all our servers (\"which ones are nearly full?\"), and the firewall config for <code>KC-WIN-01</code>, which allows Remote Desktop from <b>anywhere</b>. That's how attackers get in.</p>",
    learn:
      '<div class="callout"><b>Files in this lab:</b> <code>data\\disks.csv</code> and <code>config\\firewall.json</code>.</div>' +
      "<h3>CSV: Import-Csv / Export-Csv</h3><p><code>Import-Csv</code> turns each row into an object, one property per column. But CSV has no types: <b>every value is a string</b>.</p>" +
      ex('$disks = Import-Csv data\\disks.csv\n$disks | Format-Table\n$disks[0].FreeGB.GetType().Name') +
      "<p>That bites when you compare or sort numbers: as text, <code>\"100\"</code> sorts before <code>\"18\"</code>, and <code>\"100\" -lt 20</code> is true. Cast with <code>[int]</code>, using a script block:</p>" +
      ex('$disks | Sort-Object FreeGB | Select-Object Server, FreeGB\n$disks | Sort-Object { [int]$_.FreeGB } | Select-Object Server, FreeGB\n$disks | Where-Object { [int]$_.FreeGB -lt 20 }') +
      "<p><code>Export-Csv -Path x</code> saves objects back to a file (PowerShell 7 doesn't add the old <code>#TYPE</code> line).</p>" +
      "<h3>JSON: ConvertFrom-Json / ConvertTo-Json</h3><p>Read the whole file as one string (<code>-Raw</code>), then convert. Nested objects and arrays become properties you can dot into, and change:</p>" +
      ex('$cfg = Get-Content config\\firewall.json -Raw | ConvertFrom-Json\n$cfg.firewall.rules\n$cfg.firewall.rules[0].port') +
      "<p>To add to an array property, use <code>+=</code>. To save, <code>ConvertTo-Json</code>, but watch the <b>depth trap</b>: it only goes 2 levels deep by default, and anything deeper becomes a useless string like <code>@{name=SSH; ...}</code>. Our rules are at level 3, so always pass <code>-Depth</code>:</p>" +
      ex('$cfg = Get-Content config\\firewall.json -Raw | ConvertFrom-Json\n$cfg | ConvertTo-Json\n$cfg | ConvertTo-Json -Depth 5') +
      "<p><code>Set-Content -Path x -Value $json</code> writes the text to the file.</p>",
    starter: ps`
      # PS-112 · Disks and firewall rules

      # 1) $lowDisks: rows of data\disks.csv with less than 20 GB free, sorted by FreeGB (lowest first, as numbers)


      # 2) $cfg: config\firewall.json as objects; $openToAll: the names of rules whose source is "any"


      # 3) Lock RDP down to "10.0.0.0/8", add a rule { name = "WinRM"; port = 5986; source = "10.0.0.0/8" },
      #    and save $cfg back to config\firewall.json (mind the depth!)


      # 4) Export $lowDisks to reports\low-disks.csv
    `,
    files: { "data/disks.csv": DISKS, "config/firewall.json": FW },
    objectives: [
      {
        id: "csv",
        text: "<code>$lowDisks</code> holds the rows with less than 20 GB free, sorted by <code>FreeGB</code> as <b>numbers</b>, lowest first.",
        hints: ["CSV values are text: compare and sort with { [int]$_.FreeGB }.", "$lowDisks = Import-Csv data\\disks.csv | Where-Object { [int]$_.FreeGB -lt 20 } | Sort-Object { [int]$_.FreeGB }"],
        check: function (r) {
          var v = asList(r.p("lowDisks"));
          if (r.v("lowDisks") === undefined) return "I can't find a variable called $lowDisks yet.";
          var got = v.map(function (d) { return d && d.Server + " " + d.Drive + " " + d.FreeGB; });
          if (got.some(function (x) { return /100|120/.test(x); })) return "$lowDisks includes servers with 100+ GB free: as text, \"100\" -lt 20 is true! Compare [int]$_.FreeGB.";
          if (!H.same(got, ["cache-01 C 4", "web-01 C 9", "db-01 C 18"])) return "$lowDisks should be cache-01 C (4), web-01 C (9), db-01 C (18), in that order. Yours: " + H.show(got) + ". Sort with { [int]$_.FreeGB }.";
          return true;
        }
      },
      {
        id: "json",
        text: "<code>$cfg</code> holds the parsed firewall config, and <code>$openToAll</code> the names of the rules whose <code>source</code> is <code>any</code> (as they were in the file).",
        hints: ["Get-Content -Raw | ConvertFrom-Json. The rules are in $cfg.firewall.rules.", "$cfg = Get-Content config\\firewall.json -Raw | ConvertFrom-Json\n$openToAll = $cfg.firewall.rules | Where-Object source -eq 'any' | Select-Object -ExpandProperty name"],
        check: function (r) {
          var c = r.v("cfg");
          if (!(c instanceof window.PSEngine.PSObject)) return "$cfg should be the config as objects: Get-Content config\\firewall.json -Raw | ConvertFrom-Json.";
          return H.expect(r, "openToAll", ["HTTPS", "RDP"], "array");
        }
      },
      {
        id: "save",
        text: "<code>config\\firewall.json</code> now limits RDP to <code>10.0.0.0/8</code>, has a WinRM rule (port 5986, source <code>10.0.0.0/8</code>), and every rule is still a real JSON object.",
        hints: ["Change the RDP rule's source, $cfg.firewall.rules += [PSCustomObject]@{...}, then $cfg | ConvertTo-Json -Depth 5 | Set-Content config\\firewall.json.",
          '($cfg.firewall.rules | Where-Object name -eq "RDP").source = "10.0.0.0/8"\n$cfg.firewall.rules += [PSCustomObject]@{ name = "WinRM"; port = 5986; source = "10.0.0.0/8" }\n$cfg | ConvertTo-Json -Depth 5 | Set-Content -Path config\\firewall.json'],
        check: function (r) {
          var text = r.file("config\\firewall.json");
          var data;
          try { data = JSON.parse(text); } catch (e) { return "config\\firewall.json isn't valid JSON any more."; }
          var rules = data && data.firewall && data.firewall.rules;
          if (!Array.isArray(rules)) return "config\\firewall.json lost its firewall.rules list.";
          if (rules.some(function (x) { return typeof x === "string"; })) return "The rules were saved as strings like \"@{name=...}\": ConvertTo-Json stopped at depth 2. Add -Depth 5.";
          var rdp = rules.filter(function (x) { return x.name === "RDP"; })[0];
          if (!rdp || rdp.source !== "10.0.0.0/8") return "In the saved file, the RDP rule's source should be 10.0.0.0/8.";
          var w = rules.filter(function (x) { return x.name === "WinRM"; })[0];
          if (!w || w.port !== 5986 || w.source !== "10.0.0.0/8") return "The saved file should have a WinRM rule with port 5986 (a number) and source 10.0.0.0/8.";
          if (rules.length !== 4) return "The saved file should have 4 rules.";
          return true;
        }
      },
      {
        id: "export",
        text: "<code>$lowDisks</code> is exported to <code>reports\\low-disks.csv</code>.",
        hints: ["Export-Csv -Path ...", "$lowDisks | Export-Csv -Path reports\\low-disks.csv"],
        check: function (r) {
          var t = r.file("reports\\low-disks.csv");
          if (t === null) return "reports\\low-disks.csv wasn't created.";
          var rows = t.trim().split("\n");
          var want = ['"Server","Drive","FreeGB","SizeGB"', '"cache-01","C","4","64"', '"web-01","C","9","127"', '"db-01","C","18","127"'];
          if (!H.same(rows, want)) return "reports\\low-disks.csv should contain:\n  " + want.join("\n  ") + "\nIt contains:\n  " + rows.slice(0, 6).join("\n  ");
          return true;
        }
      }
    ],
    debrief: "<p>Ticket closed. Three servers need disk space this week, and RDP is no longer open to the whole internet. The two traps you dodged are classics: <b>CSV values are text</b> (cast before comparing) and <b>ConvertTo-Json's default depth of 2</b> (it silently ruined many config files before PowerShell 7 started warning about it).</p>",
    realworld: "Try Get-Process | Select-Object Name, Id, CPU | ConvertTo-Json -Depth 3 | Out-File procs.json, then Get-Content procs.json -Raw | ConvertFrom-Json in your PowerShell. Most cloud tools (az, aws, kubectl) output JSON, so this round trip is everyday work.",
    quiz: [
      { q: "After Import-Csv, what type is a number column?", options: ["Int32", "String", "Double", "It depends on the value"], answer: 1, why: "CSV has no types: everything arrives as text." },
      { q: "Why read JSON with <code>Get-Content -Raw</code>?", options: ["It's faster", "ConvertFrom-Json needs the whole document as one string, not line by line", "To skip comments", "It's required by Windows"], answer: 1, why: "Without -Raw you get an array of lines." },
      { q: "What does ConvertTo-Json do with objects deeper than -Depth?", options: ["Errors", "Turns them into strings", "Drops them", "Goes deeper anyway"], answer: 1, why: "They become their ToString() text. Always set -Depth for nested data." }
    ]
  });

  /* ================================================================== PS-113 */
  var IIS = lines(
    "2026-11-10 08:01:02 10.0.4.31 GET /api/orders 200 34ms user=ana.silva@kestrel.io",
    "2026-11-10 08:01:09 10.0.4.31 GET /api/orders/7531 200 21ms user=ana.silva@kestrel.io",
    "2026-11-10 08:02:40 10.0.4.77 POST /api/payments 500 1204ms user=ben.okoro@kestrel.io",
    "2026-11-10 08:03:12 203.0.113.50 POST /login 401 12ms user=admin@kestrel.io",
    "2026-11-10 08:03:13 203.0.113.50 POST /login 401 11ms user=root@kestrel.io",
    "2026-11-10 08:04:01 10.0.4.20 GET /health 200 2ms user=-",
    "2026-11-10 08:05:33 10.0.4.77 POST /api/payments 502 30001ms user=ben.okoro@kestrel.io",
    "2026-11-10 08:06:10 203.0.113.50 GET /api/../../web.config 500 8ms user=-",
    "2026-11-10 08:07:45 10.0.4.31 GET /api/orders 200 29ms user=ana.silva@kestrel.io");
  var INI = lines("; app settings", "timeout = 30", "", "retries=3", "; database", "connection = Server=db-01;Port=5432;Database=orders", "log_level = warning");
  LABS.push({
    id: "ps-113", n: 13, module: 2, ticket: "PS-113", xp: 100,
    title: "What's in the web logs?",
    topic: "Text & regex: Select-String, -replace, -split",
    from: DEV,
    story: "<p>The payments API threw errors this morning, and I want the web server log: which requests failed, and from where. I also need to send the log to the vendor, but it contains customers' email addresses, and they can't leave the building.</p>" +
      "<p>Oh, and the app's settings file is an old <code>key = value</code> format. We'll need those values as data too.</p>",
    learn:
      '<div class="callout"><b>Files in this lab:</b> <code>logs\\iis.log</code> (one request per line: date, time, client IP, method, path, status, duration, user) and <code>config\\app.ini</code>.</div>' +
      "<h3>Select-String: grep for PowerShell</h3><p>Searches files (or strings) with a <b>regular expression</b> and returns <b>MatchInfo</b> objects: <code>Line</code>, <code>LineNumber</code>, <code>Filename</code> and <code>Matches</code>. Shown on screen, they look like <code>file:line:text</code>.</p>" +
      ex("Select-String -Path logs\\iis.log -Pattern 'POST'\n(Select-String -Path logs\\iis.log -Pattern 'POST').LineNumber") +
      "<p><code>-SimpleMatch</code> searches for plain text instead of a regex, <code>-NotMatch</code> finds lines that <em>don't</em> match, and <code>-CaseSensitive</code> does what it says.</p>" +
      '<table class="t"><tr><th>Regex</th><th>Matches</th></tr>' +
      "<tr><td><code>\\d</code> / <code>\\d{3}</code></td><td>a digit / exactly 3 digits</td></tr><tr><td><code>\\s</code> / <code>\\S+</code></td><td>a space / a run of non-spaces</td></tr>" +
      "<tr><td><code>5\\d\\d</code></td><td>500 to 599</td></tr><tr><td><code>( )</code></td><td>captures a part (<code>$Matches[1]</code>)</td></tr><tr><td><code>^</code> / <code>$</code></td><td>start / end of the line</td></tr></table>" +
      "<h3>Pulling values out</h3><p>Loop over the lines and use <code>-match</code> with a capture group:</p>" +
      ex("foreach ($line in Get-Content logs\\iis.log) {\n    if ($line -match '^\\S+ \\S+ (\\S+) POST') { $Matches[1] }\n}") +
      "<h3>-replace</h3><p>Replaces regex matches. Captured groups can be reused as <code>$1</code>: use <b>single quotes</b>, so PowerShell doesn't treat <code>$1</code> as a variable.</p>" +
      ex("'card 4111-1111-1111-1234' -replace '\\d{4}-\\d{4}-\\d{4}-(\\d{4})', '****-$1'\n(Get-Content logs\\iis.log) -replace ' user=\\S+', '' | Select-Object -First 2") +
      "<h3>-split</h3><p>Splits on a regex. Give a limit to split only at the first match(es): <code>-split '=', 2</code> splits into at most 2 parts, keeping any later <code>=</code> signs in the value.</p>" +
      ex("'a = b = c' -split '\\s*=\\s*'\n'a = b = c' -split '\\s*=\\s*', 2"),
    starter: ps`
      # PS-113 · What's in the web logs?

      # 1) $errors: the lines of logs\iis.log with a 5xx status, using Select-String


      # 2) $errorIps: the client IPs (3rd field) of those lines, unique and sorted


      # 3) Save logs\iis-shared.log: the log with every email address replaced by <email>


      # 4) $settings: a hashtable of config\app.ini (skip blank lines and ; comments)
      $settings = @{}
    `,
    files: { "logs/iis.log": IIS, "config/app.ini": INI },
    objectives: [
      {
        id: "select",
        text: "<code>$errors</code> holds the <code>Select-String</code> results for the lines with a status from 500 to 599.",
        hints: ["The status is surrounded by spaces: ' 5\\d\\d '.", "$errors = Select-String -Path logs\\iis.log -Pattern ' 5\\d\\d '"],
        check: function (r) {
          var v = asList(r.v("errors"));
          if (r.v("errors") === undefined) return "I can't find a variable called $errors yet.";
          if (v.length && !(v[0] instanceof window.PSEngine.PSObject)) return "$errors should hold Select-String's MatchInfo objects.";
          var nums = v.map(function (m) { return m.get("LineNumber"); });
          if (!H.same(nums, [3, 7, 8])) return "$errors should be lines 3, 7 and 8 (statuses 500, 502, 500). Yours: lines " + H.show(nums) + ".";
          return srcHas(r, /Select-String|\bsls\b/i, "Use Select-String.");
        }
      },
      {
        id: "ips",
        text: "<code>$errorIps</code> holds the client IPs of those lines, unique and sorted.",
        hints: ["Each MatchInfo has .Line. Match '^\\S+ \\S+ (\\S+)' and take $Matches[1]; then Sort-Object -Unique.",
          "$errorIps = $errors | ForEach-Object {\n    if ($_.Line -match '^\\S+ \\S+ (\\S+)') { $Matches[1] }\n} | Sort-Object -Unique"],
        check: function (r) {
          var res = H.expect(r, "errorIps", ["10.0.4.77", "203.0.113.50"], "array");
          if (res !== true) return res;
          var extra = "2026-11-10 08:09:00 192.0.2.9 GET /x 503 4ms user=-\n";
          var r2 = r.run(null, { files: { "logs/iis.log": IIS + extra } });
          if (!H.same(r2.p("errorIps"), ["10.0.4.77", "192.0.2.9", "203.0.113.50"])) return "When I added a 503 from 192.0.2.9, $errorIps came out as " + H.show(r2.v("errorIps")) + ". Get the IPs from the matching lines.";
          return true;
        }
      },
      {
        id: "mask",
        text: "<code>logs\\iis-shared.log</code> has the same lines as <code>logs\\iis.log</code>, but every email address is replaced by <code>&lt;email&gt;</code>.",
        hints: ["-replace works on every line of an array at once. An email is something like [\\w.]+@[\\w.]+.", "(Get-Content logs\\iis.log) -replace '[\\w.]+@[\\w.]+', '<email>' | Set-Content logs\\iis-shared.log"],
        check: function (r) {
          var t = r.file("logs\\iis-shared.log");
          if (t === null) return "logs\\iis-shared.log wasn't created.";
          var got = t.trim().split("\n"), want = IIS.trim().split("\n").map(function (l) { return l.replace(/[\w.]+@[\w.]+/g, "<email>"); });
          if (/@/.test(t)) return "logs\\iis-shared.log still contains an @: some emails weren't masked.";
          if (!H.same(got, want)) return "logs\\iis-shared.log should be the original lines with each email replaced by <email>. First line should be:\n  " + want[0] + "\nYours:\n  " + got[0];
          return true;
        }
      },
      {
        id: "ini",
        text: "<code>$settings</code> maps each key in <code>config\\app.ini</code> to its value as text, e.g. <code>$settings[\"connection\"]</code> is <code>Server=db-01;Port=5432;Database=orders</code>.",
        hints: ["Loop over the lines; skip blank ones and ones starting with ; (continue). Split each with -split '\\s*=\\s*', 2 and store $settings[$key] = $value.",
          "foreach ($line in Get-Content config\\app.ini) {\n    if (-not $line.Trim() -or $line -like ';*') { continue }\n    $key, $value = $line -split '\\s*=\\s*', 2\n    $settings[$key] = $value\n}"],
        check: function (r) {
          var v = r.p("settings");
          var want = { timeout: "30", retries: "3", connection: "Server=db-01;Port=5432;Database=orders", log_level: "warning" };
          if (!v || typeof v !== "object") return "$settings should be a hashtable.";
          if (v.connection === "Server") return "$settings[\"connection\"] is just \"Server\": splitting on every = cut the value up. Use -split '\\s*=\\s*', 2.";
          if (!H.same(v, want)) return "$settings should be " + H.show(want) + "\nbut it's " + H.show(r.v("settings"));
          return true;
        }
      }
    ],
    debrief: "<p>Ticket closed. The payment errors came from one internal client (a 30-second timeout to the payment provider), but look at line 8: <code>/api/../../web.config</code> from <code>203.0.113.50</code>. That's a path traversal attempt (Python PY-131!) from the same IP that tried to log in as admin. It goes to the incident ticket.</p>" +
      "<p>And the vendor gets a log without a single customer email in it.</p>",
    realworld: "Select-String is PowerShell's grep: try Select-String -Path C:\\Windows\\Logs\\CBS\\CBS.log -Pattern 'error' -SimpleMatch | Select-Object -First 5 on your PC (the Windows component servicing log).",
    quiz: [
      { q: "What does Select-String return?", options: ["Strings", "MatchInfo objects with Line, LineNumber, Filename and Matches", "Booleans", "File objects"], answer: 1, why: "They print like grep output, but they're objects." },
      { q: "Why single quotes in <code>-replace '(\\d+)', 'ID-$1'</code>?", options: ["Style", "In double quotes, $1 would be read as a PowerShell variable", "Regex needs them", "They're faster"], answer: 1, why: "Single quotes pass $1 through to the regex engine." },
      { q: "<code>'k = v = w' -split '\\s*=\\s*', 2</code> gives…", options: ["k, v, w", "k, 'v = w'", "k = v, w", "An error"], answer: 1, why: "The limit 2 means split only at the first match." }
    ]
  });

  /* ================================================================== PS-114 */
  LABS.push({
    id: "ps-114", n: 14, module: 2, ticket: "PS-114", xp: 100,
    title: "Don't stop at the first failure",
    topic: "Errors: -ErrorAction, try/catch/finally, throw",
    from: MAYA,
    story: "<p>The weekly maintenance script restarts four services. Last Sunday one service name had a typo, and the script printed a red error... then carried on as if nothing had happened, and nobody noticed for a week. The Sunday before, a missing config file killed the whole script.</p>" +
      "<p>Make it handle errors on purpose: keep going when one item fails, but <b>record</b> every failure.</p>",
    learn:
      "<h3>Two kinds of error</h3>" +
      '<table class="t"><tr><th></th><th>Non-terminating</th><th>Terminating</th></tr>' +
      "<tr><td>Example</td><td><code>Get-Service -Name Nope</code></td><td><code>throw \"bad\"</code>, <code>1/0</code></td></tr>" +
      "<tr><td>What happens</td><td>red message, then the script <b>carries on</b></td><td>stops (the statement or the script)</td></tr>" +
      "<tr><td>Caught by try/catch?</td><td><b>No!</b></td><td>yes</td></tr></table>" +
      ex('Get-Service -Name Nope\n"still running"') +
      "<p>Most cmdlet errors are non-terminating, so a <code>try/catch</code> around them catches <b>nothing</b>. The fix is <code>-ErrorAction Stop</code>, which turns that command's errors into terminating ones:</p>" +
      ex('try {\n    Get-Service -Name Nope -ErrorAction Stop\n    "found it"\n}\ncatch {\n    "Caught: $($_.Exception.Message)"\n}') +
      "<p>Inside <code>catch</code>, <code>$_</code> is the error. <code>$_.Exception.Message</code> is its text. A <code>finally { }</code> block runs whether or not there was an error, which is the place for clean-up.</p>" +
      '<table class="t"><tr><th>-ErrorAction</th><th>Does</th></tr>' +
      "<tr><td><code>Stop</code></td><td>make errors terminating (catchable)</td></tr><tr><td><code>Continue</code> (default)</td><td>show the error and carry on</td></tr>" +
      "<tr><td><code>SilentlyContinue</code></td><td>carry on without showing it (it's still added to <code>$Error</code>)</td></tr></table>" +
      "<p>Setting <code>$ErrorActionPreference = 'Stop'</code> at the top of a script makes Stop the default for everything, which many teams do for production scripts.</p>" +
      "<h3>throw: your own errors</h3><p><code>throw \"message\"</code> raises a terminating error. Use it in functions to refuse to continue when something is wrong:</p>" +
      ex('function Assert-Positive {\n    param([int]$N)\n    if ($N -le 0) { throw "N must be positive, got $N" }\n    "ok"\n}\ntry { Assert-Positive -N -5 } catch { "Refused: $($_.Exception.Message)" }'),
    starter: ps`
      # PS-114 · Don't stop at the first failure

      # 1) Get-ConfigValue -Path <file> -Default <value>: the file's content (trimmed), or $Default if the file
      #    can't be read. No red error message either way.


      # 2) Restart each service. $restarted: names that worked. $failed: "<name>: <error message>" for the rest.
      $services = @("W3SVC", "KestrelAgnet", "KestrelAgent", "Spooler2")


      # 3) Print a summary: "2 restarted, 2 failed"


      # 4) Assert-ServiceExists -Name <name>: does nothing if the service exists; otherwise throws "Service <name> not found"
      #    (and doesn't show Get-Service's own red error)
    `,
    files: { "config/timeout.txt": "  30\n" },
    objectives: [
      {
        id: "config",
        text: "<code>Get-ConfigValue -Path config\\timeout.txt -Default 10</code> returns <code>30</code>; for a missing file it returns the default, with no error shown.",
        hints: ["try { (Get-Content -Path $Path -Raw -ErrorAction Stop).Trim() } catch { $Default }",
          "function Get-ConfigValue {\n    param([string]$Path, $Default)\n    try {\n        (Get-Content -Path $Path -Raw -ErrorAction Stop).Trim()\n    }\n    catch {\n        $Default\n    }\n}"],
        check: function (r) {
          if (!r.fn("Get-ConfigValue")) return "I can't find a function called Get-ConfigValue.";
          var a = r.ps("Get-ConfigValue -Path config\\timeout.txt -Default 10");
          if (!H.same(a.value, "30")) return "Get-ConfigValue -Path config\\timeout.txt -Default 10 should return \"30\" (trimmed), got " + H.show(a.raw) + ".";
          var b = r.ps("Get-ConfigValue -Path config\\missing.txt -Default 10");
          if (b.errors.length) return "For a missing file, an error was shown: " + b.errors[0] + "\nWithout -ErrorAction Stop, try/catch doesn't catch Get-Content's error.";
          if (!H.same(b.value, 10)) return "For a missing file it should return the default (10), got " + H.show(b.raw) + ".";
          return true;
        }
      },
      {
        id: "loop",
        text: "<code>$restarted</code> holds the services that restarted and <code>$failed</code> one <code>\"name: message\"</code> line per failure; the loop keeps going after a failure.",
        hints: ["foreach service: try { Restart-Service -Name $s -ErrorAction Stop; $restarted += $s } catch { $failed += \"${s}: $($_.Exception.Message)\" }. Start both as @().",
          '$restarted = @()\n$failed = @()\nforeach ($s in $services) {\n    try {\n        Restart-Service -Name $s -ErrorAction Stop\n        $restarted += $s\n    }\n    catch {\n        $failed += "$\{s}: $($_.Exception.Message)"\n    }\n}'.replace("$\\{", "${")],
        check: function (r) {
          var res = H.expect(r, "restarted", ["W3SVC", "KestrelAgent"], "array");
          if (res !== true) return res;
          var f = r.p("failed");
          if (!Array.isArray(f) || f.length !== 2) return "$failed should have 2 lines, one per failed service. It's " + H.show(r.v("failed")) + ".";
          if (!/^KestrelAgnet: Cannot find any service/.test(f[0]) || !/^Spooler2: /.test(f[1])) return "Each $failed line should be \"<name>: <error message>\", e.g. KestrelAgnet: Cannot find any service with service name 'KestrelAgnet'. Yours: " + H.show(f) + ".";
          if (r.system.actions.indexOf("Restart-Service W3SVC") < 0 || r.system.actions.indexOf("Restart-Service KestrelAgent") < 0) return "The services that exist should really be restarted.";
          return true;
        }
      },
      {
        id: "summary",
        text: "The script prints <code>2 restarted, 2 failed</code>, built from the two lists.",
        hints: ['"$($restarted.Count) restarted, $($failed.Count) failed"'],
        check: function (r) {
          if (r.lines.indexOf("2 restarted, 2 failed") < 0) return "Print exactly: 2 restarted, 2 failed (from $restarted.Count and $failed.Count).";
          var r2 = r.run(r.src.replace(/\$services\s*=\s*@\([^)]*\)/, '$services = @("W3SVC", "Nope")'));
          if (r2.lines.indexOf("1 restarted, 1 failed") < 0) return "With a different service list, the summary should change. Build it from the counts.";
          return true;
        }
      },
      {
        id: "throw",
        text: "<code>Assert-ServiceExists -Name W3SVC</code> does nothing; <code>-Name Nope</code> throws <code>Service Nope not found</code> without showing Get-Service's own error.",
        hints: ["Get-Service -Name $Name -ErrorAction SilentlyContinue returns nothing if it's missing; then throw.",
          'function Assert-ServiceExists {\n    param([string]$Name)\n    if (-not (Get-Service -Name $Name -ErrorAction SilentlyContinue)) {\n        throw "Service $Name not found"\n    }\n}'],
        check: function (r) {
          if (!r.fn("Assert-ServiceExists")) return "I can't find a function called Assert-ServiceExists.";
          var ok = r.ps("Assert-ServiceExists -Name W3SVC");
          if (!ok.ok) return "Assert-ServiceExists -Name W3SVC should do nothing, but: " + ok.errors[0];
          if (ok.items.length) return "Assert-ServiceExists -Name W3SVC should output nothing, got " + H.show(ok.raw) + ".";
          var bad = r.ps("try { Assert-ServiceExists -Name Nope } catch { 'CAUGHT: ' + $_.Exception.Message }");
          if (bad.errors.length) return "Get-Service's own error is still shown (" + bad.errors[0] + "). Add -ErrorAction SilentlyContinue.";
          if (!H.same(bad.value, "CAUGHT: Service Nope not found")) return "Calling it with -Name Nope should throw \"Service Nope not found\" (a catch got " + H.show(bad.raw) + ").";
          return true;
        }
      }
    ],
    debrief: "<p>Ticket closed. The script now finishes its run, reports exactly which services failed and why, and a typo can't hide for a week any more. The key fact to remember: <b>try/catch only catches terminating errors</b>, and most cmdlet errors aren't, until you add <code>-ErrorAction Stop</code>.</p>",
    realworld: "Add $ErrorActionPreference = 'Stop' at the top of scripts that change things, so a failing step can't be skipped silently. Errors from the session are kept in $Error: try $Error[0] | Format-List * -Force in your PowerShell after a failed command.",
    quiz: [
      { q: "<code>try { Get-Item nope.txt } catch { 'x' }</code> — is 'x' output?", options: ["Yes", "No: Get-Item's error is non-terminating, so catch never runs", "Only on Windows", "Only with finally"], answer: 1, why: "Add -ErrorAction Stop to make it catchable." },
      { q: "Inside catch, what's <code>$_.Exception.Message</code>?", options: ["The line number", "The error's text", "The command name", "$null"], answer: 1, why: "$_ is the ErrorRecord; its Exception has the message." },
      { q: "When does finally run?", options: ["Only after errors", "Only when there's no error", "Always, error or not", "Never in scripts"], answer: 2, why: "That's what makes it right for clean-up." }
    ]
  });

  /* ================================================================== PS-115 */
  LABS.push({
    id: "ps-115", n: 15, module: 2, ticket: "PS-115", xp: 100,
    title: "Something is mining on KC-WIN-01",
    topic: "Processes & services with CIM",
    from: DEV,
    story: "<p>Remember <code>updater</code>, the vendor-less process from PS-103? The security team has opened an incident: overnight, someone got into <code>KC-WIN-01</code>. Before anyone wipes the server, we need evidence.</p>" +
      "<p>First, the processes and services. What's running from places it shouldn't, what started what, and what's misconfigured in a way an attacker could abuse?</p>",
    learn:
      '<div class="callout warn"><b>Incident scenario.</b> From here to the end of Module 2, the server includes last night\'s attack. Everything is simulated, and the attacker\'s IPs are reserved documentation addresses.</div>' +
      "<h3>Get-CimInstance: the detailed view</h3><p><code>Get-Process</code> and <code>Get-Service</code> are the quick view. <b>CIM</b> (also called WMI) is Windows' management database, and it has the details investigators need: the full <b>command line</b> a process was started with, its <b>parent process</b>, a service's <b>executable path</b> and the account it runs as.</p>" +
      ex("Get-CimInstance Win32_Process | Select-Object ProcessId, Name, ParentProcessId\nGet-CimInstance Win32_Service -Filter \"Name = 'W3SVC'\" | Format-List Name, State, StartMode, PathName, StartName") +
      "<p><code>-Filter</code> uses WQL, a small SQL-like language: <code>\"Name = 'x'\"</code>, <code>\"Name LIKE '%kestrel%'\"</code> (% is the wildcard). Filtering at the source is faster than Where-Object on big systems.</p>" +
      "<h3>Red flags investigators look for</h3>" +
      '<table class="t"><tr><th>Sign</th><th>Why it matters</th></tr>' +
      "<tr><td>Running from <code>C:\\Users\\</code>, <code>C:\\ProgramData\\</code>, <code>Temp</code></td><td>folders any user can write to: legitimate software lives in Program Files or Windows</td></tr>" +
      "<tr><td>Office (WINWORD, EXCEL) starting a shell</td><td>classic sign of a malicious macro in a document</td></tr>" +
      "<tr><td><code>-EncodedCommand</code> / <code>-enc</code>, <code>-WindowStyle Hidden</code></td><td>attackers hide PowerShell commands this way</td></tr>" +
      "<tr><td>Unquoted service path with spaces</td><td><code>C:\\Program Files\\App\\run.exe</code> without quotes: Windows may run <code>C:\\Program.exe</code> first, a known privilege-escalation trick</td></tr></table>" +
      "<h3>Parents and children</h3><p>To find what a process started, look up its <code>ProcessId</code>, then find processes whose <code>ParentProcessId</code> is that number:</p>" +
      ex("$explorer = Get-CimInstance Win32_Process -Filter \"Name = 'explorer.exe'\"\nGet-CimInstance Win32_Process | Where-Object ParentProcessId -eq $explorer.ProcessId | Select-Object Name, ProcessId"),
    starter: ps`
      # PS-115 · Something is mining on KC-WIN-01

      # 1) $userPathProcs: names of processes whose Path is under C:\Users\ or C:\ProgramData\


      # 2) $officeChild: the full command line of the process that WINWORD started (Win32_Process)


      # 3) $unquoted: names of services (Win32_Service) whose PathName contains a space, doesn't start with a quote,
      #    and isn't under C:\Windows\


      # 4) Stop the miner (the process named updater)
    `,
    prelude: INCIDENT,
    objectives: [
      {
        id: "paths",
        text: "<code>$userPathProcs</code> holds the names of processes whose <code>Path</code> is under <code>C:\\Users\\</code> or <code>C:\\ProgramData\\</code>.",
        hints: ["Where-Object { $_.Path -like 'C:\\Users\\*' -or $_.Path -like 'C:\\ProgramData\\*' }", "$userPathProcs = Get-Process | Where-Object { $_.Path -like 'C:\\Users\\*' -or $_.Path -like 'C:\\ProgramData\\*' } | Select-Object -ExpandProperty Name"],
        check: function (r) { return H.expect(r, "userPathProcs", ["svc", "updater"], "array"); }
      },
      {
        id: "parent",
        text: "<code>$officeChild</code> is the <code>CommandLine</code> of the process whose parent is <code>WINWORD.EXE</code>.",
        hints: ["Find WINWORD's ProcessId with Get-CimInstance Win32_Process -Filter \"Name = 'WINWORD.EXE'\", then the process whose ParentProcessId equals it.",
          "$word = Get-CimInstance Win32_Process -Filter \"Name = 'WINWORD.EXE'\"\n$officeChild = (Get-CimInstance Win32_Process | Where-Object ParentProcessId -eq $word.ProcessId).CommandLine"],
        check: function (r) {
          var v = r.v("officeChild");
          if (v === undefined) return "I can't find a variable called $officeChild yet.";
          if (typeof v !== "string" || !/^powershell\.exe -NoProfile -WindowStyle Hidden -EncodedCommand /.test(v)) return "$officeChild should be the full command line of the process WINWORD started (from Win32_Process's CommandLine). It's " + H.show(v, 120) + ".";
          return true;
        }
      },
      {
        id: "unquoted",
        text: "<code>$unquoted</code> holds the names of services whose <code>PathName</code> contains a space, doesn't start with a quote, and isn't under <code>C:\\Windows\\</code>.",
        hints: ["Three conditions with -and: -like '* *', -notlike '\"*', -notlike 'C:\\Windows\\*'.",
          "$unquoted = Get-CimInstance Win32_Service |\n    Where-Object { $_.PathName -like '* *' -and $_.PathName -notlike '\"*' -and $_.PathName -notlike 'C:\\Windows\\*' } |\n    Select-Object -ExpandProperty Name"],
        check: function (r) {
          var v = asList(r.p("unquoted"));
          if (v.length > 2) return "$unquoted has " + v.length + " services: many Windows services run svchost.exe with arguments (that's fine). Exclude paths under C:\\Windows\\.";
          var res = H.expect(r, "unquoted", "KestrelUpdater");
          if (res !== true && !H.same(r.p("unquoted"), ["KestrelUpdater"])) return res;
          return srcHas(r, /Win32_Service/i, "Use Get-CimInstance Win32_Service: Get-Service doesn't show the PathName.");
        }
      },
      {
        id: "stop",
        text: "The miner (<code>updater</code>) is stopped, and nothing else is.",
        hints: ["Stop-Process -Name updater (try it with -WhatIf first).", "Stop-Process -Name updater"],
        check: function (r) {
          var stops = r.system.actions.filter(function (a) { return /^Stop-Process /.test(a); });
          if (!stops.length) return "updater is still running. Stop it with Stop-Process.";
          if (stops.some(function (a) { return !/^Stop-Process updater /.test(a); })) return "You stopped more than the miner: " + stops.join(", ") + ". Only updater.";
          return true;
        }
      }
    ],
    debrief: "<p>Ticket closed, and the picture is getting clearer. A Word document (<code>Invoice_7731.docm</code>) started a hidden PowerShell with an encoded command, which is the classic malicious-macro pattern. The miner and a second unknown binary (<code>svc.exe</code>) run from <code>C:\\Users\\Public</code>. Separately, <code>KestrelUpdater</code>'s unquoted path is a weakness our own team created; that's a ticket for the agent team.</p>" +
      "<p>Stopping the miner was right, but it will come back unless we find how it starts. That's PS-117.</p>",
    realworld: "On your PC: Get-CimInstance Win32_Process | Select-Object Name, ProcessId, ParentProcessId, CommandLine | Out-GridView (or Format-Table -AutoSize). Seeing what started what is often surprising.",
    quiz: [
      { q: "Where does a process's full command line come from?", options: ["Get-Process (always)", "Get-CimInstance Win32_Process's CommandLine", "Get-Service", "The registry"], answer: 1, why: "CIM has the details Get-Process leaves out (in Windows PowerShell 5.1 especially)." },
      { q: "Why is a process running from C:\\Users\\Public suspicious?", options: ["It's slow", "Any user can write there, and real software installs to Program Files/Windows", "It's not allowed", "It's a network drive"], answer: 1, why: "Malware drops itself in writable folders." },
      { q: "Word starting powershell.exe usually means…", options: ["A normal update", "A malicious macro ran", "Spell check", "Printing"], answer: 1, why: "Office apps have no reason to launch shells." }
    ]
  });

  /* ================================================================== PS-116 */
  LABS.push({
    id: "ps-116", n: 16, module: 2, ticket: "PS-116", xp: 100,
    title: "The 2 a.m. logins",
    topic: "Event logs with Get-WinEvent",
    from: DEV,
    story: "<p>The processes told us <em>what</em> is running. The event logs tell us <em>how they got in</em>. Windows records every logon attempt in the Security log, and attackers are noisy.</p>" +
      "<p>Find the brute force, whether it succeeded, and what the attacker did with their access.</p>",
    learn:
      "<h3>Get-WinEvent</h3><p>Reads the event logs. <b>Newest events come first.</b> <code>-FilterHashtable</code> filters inside the log, which is far faster than reading everything and using <code>Where-Object</code> (Security logs can hold millions of events).</p>" +
      ex("Get-WinEvent -LogName System -MaxEvents 3\nGet-WinEvent -FilterHashtable @{ LogName = 'Security'; Id = 4624 }") +
      '<table class="t"><tr><th>Key</th><th>Example</th></tr><tr><td><code>LogName</code></td><td><code>\'Security\'</code>, <code>\'System\'</code>, <code>\'Application\'</code></td></tr>' +
      "<tr><td><code>Id</code></td><td><code>4625</code> or <code>4624, 4625</code></td></tr><tr><td><code>StartTime</code> / <code>EndTime</code></td><td><code>(Get-Date).AddHours(-12)</code></td></tr><tr><td><code>Level</code></td><td>2 = Error, 3 = Warning, 4 = Information</td></tr></table>" +
      "<h3>Event IDs every analyst knows</h3>" +
      '<table class="t"><tr><th>ID</th><th>Meaning</th><th>Useful <code>Properties[n].Value</code></th></tr>' +
      "<tr><td>4625</td><td>failed logon</td><td>[5] user, [19] source IP</td></tr>" +
      "<tr><td>4624</td><td>successful logon</td><td>[5] user, [8] logon type (10 = Remote Desktop), [18] source IP</td></tr>" +
      "<tr><td>4720</td><td>user account created</td><td>[0] new account, [4] created by</td></tr>" +
      "<tr><td>4732</td><td>member added to a group</td><td>[0] member, [2] group</td></tr>" +
      "<tr><td>7045 (System)</td><td>service installed</td><td>[0] name, [1] executable</td></tr></table>" +
      "<p>Each event has <code>TimeCreated</code>, <code>Id</code>, a readable <code>Message</code>, and <code>Properties</code>, the raw data fields in a fixed order per event ID (above).</p>" +
      ex("$e = Get-WinEvent -FilterHashtable @{ LogName = 'Security'; Id = 4624 } -MaxEvents 1\n$e.Message\n$e.Properties[5].Value") +
      "<h3>Group-Object with a script block</h3><p>To count failures per source IP, group by a calculated value:</p>" +
      ex("Get-WinEvent -FilterHashtable @{ LogName = 'Security'; Id = 4625 } |\n    Group-Object { $_.Properties[19].Value } |\n    Select-Object Count, Name"),
    starter: ps`
      # PS-116 · The 2 a.m. logins

      # 1) $failed: all failed logon events (4625), using -FilterHashtable


      # 2) $bruteIps: source IPs with 10 or more failed logons


      # 3) $breachedUser: the account that then logged on successfully (4624) from one of those IPs


      # 4) $newAccount: the account created afterwards (4720)
    `,
    prelude: INCIDENT,
    objectives: [
      {
        id: "filter",
        text: "<code>$failed</code> holds every failed logon event (ID 4625), read with <code>-FilterHashtable</code>.",
        hints: ["@{ LogName = 'Security'; Id = 4625 }", "$failed = Get-WinEvent -FilterHashtable @{ LogName = 'Security'; Id = 4625 }"],
        check: function (r) {
          var v = asList(r.v("failed"));
          if (r.v("failed") === undefined) return "I can't find a variable called $failed yet.";
          if (v.length !== 20 || v.some(function (e) { return !e.get || e.get("Id") !== 4625; })) return "$failed should hold the 20 events with ID 4625. It has " + v.length + ".";
          return srcHas(r, /FilterHashtable/i, "Use -FilterHashtable to filter inside the log instead of Where-Object.");
        }
      },
      {
        id: "brute",
        text: "<code>$bruteIps</code> holds the source IPs with 10 or more failed logons.",
        hints: ["Group $failed by { $_.Properties[19].Value }, keep groups with Count -ge 10, and take their Name.", "$bruteIps = $failed | Group-Object { $_.Properties[19].Value } | Where-Object Count -ge 10 | Select-Object -ExpandProperty Name"],
        check: function (r) {
          var v = r.p("bruteIps");
          if (Array.isArray(v) && v.length === 1) v = v[0];
          if (H.same(r.p("bruteIps"), ["10.0.4.31", "198.51.100.23", "203.0.113.50"]) || (Array.isArray(r.p("bruteIps")) && r.p("bruteIps").length === 3)) return "That's every IP that failed at least once. Keep only those with 10 or more (Where-Object Count -ge 10).";
          if (v !== "203.0.113.50") return "$bruteIps should be 203.0.113.50 (14 failures in 5 minutes). It's " + H.show(r.v("bruteIps")) + ".";
          return true;
        }
      },
      {
        id: "breach",
        text: "<code>$breachedUser</code> is the account that logged on successfully (4624) from a brute-forcing IP.",
        hints: ["Get the 4624 events and keep those whose Properties[18].Value is -in $bruteIps; the user is Properties[5].Value.",
          "$breach = Get-WinEvent -FilterHashtable @{ LogName = 'Security'; Id = 4624 } | Where-Object { $_.Properties[18].Value -in $bruteIps }\n$breachedUser = $breach.Properties[5].Value"],
        check: function (r) {
          var v = r.v("breachedUser");
          if (Array.isArray(v)) return "$breachedUser should be one name, but it's " + H.show(v) + ". Keep only 4624 events from the brute-forcing IP.";
          return H.expect(r, "breachedUser", "temp.admin");
        }
      },
      {
        id: "created",
        text: "<code>$newAccount</code> is the account that was created afterwards (event 4720).",
        hints: ["The new account's name is Properties[0].Value of the 4720 event.", "$newAccount = (Get-WinEvent -FilterHashtable @{ LogName = 'Security'; Id = 4720 }).Properties[0].Value"],
        check: function (r) { return H.expect(r, "newAccount", "support_tmp"); }
      }
    ],
    debrief: "<p>Ticket closed, and now we have the story. At 02:10, <code>203.0.113.50</code> guessed passwords over Remote Desktop: 14 tries in five minutes. At 02:16 it got in as <code>temp.admin</code>, the forgotten migration account from the PS-110 access review. Five minutes later it created <code>support_tmp</code> and made it an administrator. That's a backdoor account, in case <code>temp.admin</code> gets disabled.</p>" +
      "<p>If last quarter's audit findings had been acted on, none of this would have happened.</p>",
    realworld: "On your PC (as administrator): Get-WinEvent -FilterHashtable @{ LogName = 'Security'; Id = 4624 } -MaxEvents 5 | Format-List TimeCreated, Message. Event IDs 4624/4625 are the same on every Windows machine, and SIEM rules for brute force are built on exactly this.",
    quiz: [
      { q: "Why -FilterHashtable instead of <code>Get-WinEvent -LogName Security | Where-Object Id -eq 4625</code>?", options: ["It's the same", "It filters inside the event log service: much faster on big logs", "Where-Object doesn't work on events", "It includes older events"], answer: 1, why: "Where-Object would read every Security event first." },
      { q: "Event 4625 means…", options: ["Successful logon", "Failed logon", "Account created", "Service installed"], answer: 1, why: "4624 success, 4625 failure: worth memorising." },
      { q: "In what order does Get-WinEvent return events?", options: ["Oldest first", "Newest first", "Random", "By ID"], answer: 1, why: "Use -Oldest or Sort-Object TimeCreated for a timeline." }
    ]
  });

  /* ================================================================== PS-117 */
  var RUN_HKLM = "HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run", RUN_HKCU = "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run";
  var RDP = "HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Terminal Server\\WinStations\\RDP-Tcp";
  function regValues(sys, path) {
    var k = sys.registry.filter(function (x) { return x.path.toLowerCase() === path.toLowerCase(); })[0];
    return k ? k.values : [];
  }
  LABS.push({
    id: "ps-117", n: 17, module: 2, ticket: "PS-117", xp: 100,
    title: "How does it come back?",
    topic: "The registry & persistence",
    from: DEV,
    story: "<p>We stopped the miner in PS-115. Twenty minutes later it was running again. Malware makes sure it survives reboots and kills: that's called <b>persistence</b>, and on Windows the favourite place is the registry's <b>Run keys</b>, which start programs at every logon.</p>" +
      "<p>Find the entries, remove the bad ones, and check whether the attacker weakened anything else.</p>",
    learn:
      "<h3>The registry is a drive</h3><p>The registry is Windows' configuration database: <b>keys</b> (like folders) holding <b>values</b> (name + data). PowerShell mounts two hives as drives: <code>HKLM:</code> (machine-wide) and <code>HKCU:</code> (the current user). So the same cmdlets as files work:</p>" +
      ex("Get-ChildItem 'HKLM:\\SOFTWARE\\Kestrel'\nTest-Path 'HKLM:\\SOFTWARE\\Kestrel\\Agent'") +
      "<h3>Reading values</h3><p>Keys are items; values are <b>item properties</b>. <code>Get-ItemProperty</code> returns one object with a property per value, plus extra <code>PS*</code> properties PowerShell adds (<code>PSPath</code>, <code>PSChildName</code>...):</p>" +
      ex("Get-ItemProperty 'HKLM:\\SOFTWARE\\Kestrel\\Agent'\nGet-ItemPropertyValue 'HKLM:\\SOFTWARE\\Kestrel\\Agent' -Name Version") +
      "<p>To loop over the values, use the object's <code>.PSObject.Properties</code> (each has <code>Name</code> and <code>Value</code>) and skip the <code>PS*</code> ones:</p>" +
      ex("$k = Get-ItemProperty 'HKLM:\\SOFTWARE\\Kestrel\\Agent'\n$k.PSObject.Properties | Where-Object Name -notlike 'PS*' | Select-Object Name, Value") +
      "<h3>Changing values</h3>" +
      '<table class="t"><tr><th>Cmdlet</th><th>Does</th></tr><tr><td><code>Set-ItemProperty -Path k -Name n -Value v</code></td><td>change (or create) a value</td></tr>' +
      "<tr><td><code>New-ItemProperty ... -PropertyType DWord</code></td><td>create a value with a type</td></tr><tr><td><code>Remove-ItemProperty -Path k -Name n</code></td><td>delete a value</td></tr></table>" +
      "<p>All support <code>-WhatIf</code>. On a real machine, changing HKLM needs an administrator PowerShell. Registry mistakes can break Windows, so always <code>-WhatIf</code> first.</p>" +
      '<table class="t"><tr><th>Where</th><th>Path</th></tr><tr><td>Machine Run key</td><td><code>HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run</code></td></tr><tr><td>User Run key</td><td><code>HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run</code></td></tr><tr><td>RDP settings</td><td><code>HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Terminal Server\\WinStations\\RDP-Tcp</code></td></tr></table>',
    starter: ps`
      # PS-117 · How does it come back?
      $hklmRun = 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Run'
      $hkcuRun = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
      $rdp = 'HKLM:\SYSTEM\CurrentControlSet\Control\Terminal Server\WinStations\RDP-Tcp'

      # 1) $runEntries: one [PSCustomObject] per Run value in both keys: Hive ("HKLM" or "HKCU"), Name, Command


      # 2) $suspicious: names of entries whose Command points into C:\Users\Public or uses -Enc


      # 3) Remove those values from the registry


      # 4) $nlaWasOn: is RDP's UserAuthentication (Network Level Authentication) 1? Then switch it back on (1).
    `,
    prelude: INCIDENT,
    objectives: [
      {
        id: "read",
        text: "<code>$runEntries</code> holds one <code>[PSCustomObject]</code> per value in both Run keys, with <code>Hive</code>, <code>Name</code> and <code>Command</code>, and no <code>PS*</code> properties.",
        hints: ["For each of the two keys: (Get-ItemProperty $path).PSObject.Properties | Where-Object Name -notlike 'PS*', then make [PSCustomObject]@{ Hive = ...; Name = $_.Name; Command = $_.Value }.",
          "$runEntries = foreach ($pair in @(@('HKLM', $hklmRun), @('HKCU', $hkcuRun))) {\n    $props = (Get-ItemProperty $pair[1]).PSObject.Properties | Where-Object Name -notlike 'PS*'\n    foreach ($p in $props) {\n        [PSCustomObject]@{ Hive = $pair[0]; Name = $p.Name; Command = $p.Value }\n    }\n}"],
        check: function (r) {
          var v = asList(r.p("runEntries"));
          if (r.v("runEntries") === undefined) return "I can't find a variable called $runEntries yet.";
          if (v.some(function (e) { return e && /^PS/.test(e.Name); })) return "$runEntries includes PSPath/PSChildName...: filter out properties whose Name is like 'PS*'.";
          var got = v.map(function (e) { return e && (e.Hive + " " + e.Name); }).sort();
          var want = ["HKCU OneDrive", "HKCU WindowsUpdateCheck", "HKLM AdobeUpdate", "HKLM KestrelAgent", "HKLM SecurityHealth"];
          if (!H.same(got, want)) return "$runEntries should have 5 entries (3 HKLM, 2 HKCU) with Hive and Name. Yours: " + H.show(got);
          if (!v.every(function (e) { return typeof e.Command === "string" && e.Command.length > 5; })) return "Each entry's Command should be the value's data (the command line).";
          return true;
        }
      },
      {
        id: "spot",
        text: "<code>$suspicious</code> holds the names of the entries whose <code>Command</code> points into <code>C:\\Users\\Public</code> or uses <code>-Enc</code>.",
        hints: ["-match 'Users\\\\Public|-Enc' (in a regex, a backslash is written \\\\).", "$suspicious = $runEntries | Where-Object Command -match 'Users\\\\Public|-Enc' | Select-Object -ExpandProperty Name"],
        check: function (r) {
          var v = asList(r.p("suspicious")).slice().sort();
          if (!H.same(v, ["AdobeUpdate", "WindowsUpdateCheck"])) return "$suspicious should be AdobeUpdate and WindowsUpdateCheck. It's " + H.show(r.v("suspicious")) + ".";
          return true;
        }
      },
      {
        id: "remove",
        text: "Both bad values are removed from the registry, and the legitimate ones are untouched.",
        hints: ["Remove-ItemProperty -Path <key> -Name <name> for each (try -WhatIf first).", "Remove-ItemProperty -Path $hklmRun -Name AdobeUpdate\nRemove-ItemProperty -Path $hkcuRun -Name WindowsUpdateCheck"],
        check: function (r) {
          var m = regValues(r.system, RUN_HKLM).map(function (v) { return v.name; }), u = regValues(r.system, RUN_HKCU).map(function (v) { return v.name; });
          if (m.indexOf("AdobeUpdate") >= 0 || u.indexOf("WindowsUpdateCheck") >= 0) return "A bad Run value is still there. Remove both with Remove-ItemProperty.";
          if (m.indexOf("SecurityHealth") < 0 || m.indexOf("KestrelAgent") < 0 || u.indexOf("OneDrive") < 0) return "A legitimate Run value was removed too. Only remove the suspicious ones.";
          return true;
        }
      },
      {
        id: "nla",
        text: "<code>$nlaWasOn</code> is whether RDP's <code>UserAuthentication</code> was 1 before your change, and it's set back to 1 now.",
        hints: ["$nlaWasOn = (Get-ItemPropertyValue $rdp -Name UserAuthentication) -eq 1, then Set-ItemProperty -Path $rdp -Name UserAuthentication -Value 1.",
          "$nlaWasOn = (Get-ItemPropertyValue -Path $rdp -Name UserAuthentication) -eq 1\nSet-ItemProperty -Path $rdp -Name UserAuthentication -Value 1"],
        check: function (r) {
          var res = H.expect(r, "nlaWasOn", false, "boolean");
          if (res !== true) return res === "$nlaWasOn should be $false, but it's $true." ? "$nlaWasOn is $true: read the value BEFORE switching it back on." : res;
          var v = regValues(r.system, RDP).filter(function (x) { return x.name === "UserAuthentication"; })[0];
          if (!v || Number(v.value) !== 1) return "UserAuthentication is still " + (v ? v.value : "missing") + ". Set it to 1 with Set-ItemProperty.";
          return true;
        }
      }
    ],
    debrief: "<p>Ticket closed. Two Run entries brought the attacker back at every logon: one restarting the miner, one re-running the encoded PowerShell downloader (which disguised itself as \"AdobeUpdate\"). And the attacker had switched off <b>Network Level Authentication</b>, so RDP accepted connections before anyone proved who they were, which makes brute force easier.</p>" +
      "<p>Run keys are only one persistence spot. The capstone also checks the new service the attacker installed.</p>",
    realworld: "On your PC: Get-ItemProperty 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run'. Sysinternals Autoruns shows every persistence location Windows has (there are dozens) and is a standard incident-response tool.",
    quiz: [
      { q: "Registry keys and values are, in PowerShell terms…", options: ["Files and folders", "Items and item properties", "Objects and methods", "Services"], answer: 1, why: "Hence Get-Item / Get-ItemProperty / Set-ItemProperty." },
      { q: "Why skip properties named <code>PS*</code>?", options: ["They're hidden", "PowerShell adds them (PSPath, PSChildName...); they aren't registry values", "They're dangerous", "They're duplicates"], answer: 1, why: "Get-ItemProperty mixes them into the result." },
      { q: "What's the safe first step before changing the registry?", options: ["Reboot", "Run the command with -WhatIf", "Delete the key", "Nothing"], answer: 1, why: "See exactly what would change before it changes." }
    ]
  });

  /* ================================================================== PS-118 capstone */
  var TRIAGE_WANT = {
    brute: ["203.0.113.50"],
    breaches: [{ User: "temp.admin", IP: "203.0.113.50", Time: "2026-11-10 02:16:05" }],
    admins: ["support_tmp"],
    procs: ["powershell", "svc", "updater"],
    persist: ["AdobeUpdate", "WindowsUpdateCheck", "WinUpdateHelper"]
  };
  function triage(r, args) {
    var res = r.ps("$__t = Invoke-Triage " + (args || "") + "; $__t");
    if (!res.ok) return { error: res.errors[0] };
    var t = res.raw;
    if (Array.isArray(t)) return { error: "Invoke-Triage should return ONE object, but it returned " + t.length + " things. (Is something else being output inside the function?)" };
    if (!(t instanceof window.PSEngine.PSObject)) return { error: "Invoke-Triage should return a [PSCustomObject], got " + H.show(t) + "." };
    return { t: t, p: H.plain(t) };
  }
  function namesOf(list, key) { return asList(list).map(function (x) { return x && typeof x === "object" ? x[key] : x; }); }
  LABS.push({
    id: "ps-118", n: 18, module: 2, ticket: "PS-118", xp: 200, capstone: true,
    title: "The incident report",
    topic: "Module 2 capstone project",
    from: "Dev Patel & Dana Park",
    story: "<p>The investigation is done; now it has to be <b>repeatable</b>. Kestrel has 40 other Windows servers, and the security team wants one command that checks any of them for the same attack and produces a JSON report for the incident system.</p>" +
      "<p>Turn everything you found in PS-115 to PS-117 into a single triage function. It's the whole of Module 2 in one script.</p>",
    learn:
      '<div class="callout warn"><b>Capstone rules.</b> There are no hints. Build one section at a time and test it in the console. ' +
      "If you get completely stuck, the Tasks tab has a button to reveal the full solution. The capstone then earns half XP.</div>" +
      "<h3>What to build</h3><p><code>Invoke-Triage</code> with a <code>-Hours</code> parameter (default 12) returns <b>one</b> <code>[PSCustomObject]</code> with these properties:</p>" +
      '<table class="t"><tr><th>Property</th><th>Contents</th></tr>' +
      "<tr><td><code>BruteForceIPs</code></td><td>source IPs with 10+ failed logons (4625) in the last <code>-Hours</code> hours, sorted</td></tr>" +
      "<tr><td><code>Breaches</code></td><td>one object per successful logon (4624) from those IPs: <code>User</code>, <code>IP</code>, <code>Time</code> (<code>yyyy-MM-dd HH:mm:ss</code>)</td></tr>" +
      "<tr><td><code>NewAdmins</code></td><td>accounts added to Administrators (4732, member in <code>Properties[0]</code>) in the same window</td></tr>" +
      "<tr><td><code>SuspiciousProcesses</code></td><td>objects <code>Name</code>, <code>Id</code>, <code>Path</code> for processes running from <code>C:\\Users\\</code> or <code>C:\\ProgramData\\</code>, or whose command line (Win32_Process) contains <code>-enc</code>; sorted by Name</td></tr>" +
      "<tr><td><code>Persistence</code></td><td>objects <code>Location</code>, <code>Name</code>, <code>Command</code>: Run-key values (HKLM and HKCU, Location <code>HKLM Run</code> / <code>HKCU Run</code>) that point into <code>C:\\Users\\Public</code> or use <code>-enc</code>, then services (Win32_Service, Location <code>Service</code>) whose PathName is under <code>C:\\Users\\</code></td></tr></table>" +
      "<p>When no events match, <code>Get-WinEvent</code> writes an error. Use <code>-ErrorAction SilentlyContinue</code> where \"nothing found\" is a normal answer.</p>" +
      "<h3>The script around it</h3><ul><li><code>$report = Invoke-Triage</code></li><li>save it to <code>reports\\triage.json</code> (all nested objects intact)</li><li>print the summary below</li></ul>" +
      "<h3>Expected output</h3>" +
      '<pre class="code">Brute force from: 203.0.113.50\nBreached accounts: temp.admin\nNew admins: support_tmp\nSuspicious processes: 3\nPersistence entries: 3</pre>' +
      "<p>(Lists are joined with <code>\", \"</code>; when a list is empty, print <code>none</code>.)</p>",
    starter: ps`
      # PS-118 · The incident report (Module 2 capstone)

      function Invoke-Triage {

      }

      # Run the triage, save reports\triage.json and print the summary
    `,
    prelude: INCIDENT,
    solution: ps`
      function Invoke-Triage {
          [CmdletBinding()]
          param([int]$Hours = 12)

          $since = (Get-Date).AddHours(-$Hours)

          # Logons
          $failed = Get-WinEvent -FilterHashtable @{ LogName = 'Security'; Id = 4625; StartTime = $since } -ErrorAction SilentlyContinue
          $bruteIps = @($failed | Group-Object { $_.Properties[19].Value } | Where-Object Count -ge 10 | Select-Object -ExpandProperty Name | Sort-Object)

          $breaches = @(Get-WinEvent -FilterHashtable @{ LogName = 'Security'; Id = 4624; StartTime = $since } -ErrorAction SilentlyContinue |
              Where-Object { $_.Properties[18].Value -in $bruteIps } |
              ForEach-Object {
                  [PSCustomObject]@{
                      User = $_.Properties[5].Value
                      IP   = $_.Properties[18].Value
                      Time = $_.TimeCreated.ToString('yyyy-MM-dd HH:mm:ss')
                  }
              })

          $newAdmins = @(Get-WinEvent -FilterHashtable @{ LogName = 'Security'; Id = 4732; StartTime = $since } -ErrorAction SilentlyContinue |
              Where-Object { $_.Properties[2].Value -eq 'Administrators' } |
              ForEach-Object { $_.Properties[0].Value })

          # Processes
          $encoded = (Get-CimInstance Win32_Process | Where-Object CommandLine -match '-enc').ProcessId
          $procs = @(Get-Process |
              Where-Object { $_.Path -like 'C:\Users\*' -or $_.Path -like 'C:\ProgramData\*' -or $_.Id -in $encoded } |
              Sort-Object Name |
              ForEach-Object { [PSCustomObject]@{ Name = $_.Name; Id = $_.Id; Path = $_.Path } })

          # Persistence
          $runKeys = @(
              @('HKLM Run', 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Run'),
              @('HKCU Run', 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run')
          )
          $persistence = @(foreach ($rk in $runKeys) {
              $values = (Get-ItemProperty $rk[1]).PSObject.Properties | Where-Object Name -notlike 'PS*'
              foreach ($v in $values) {
                  if ($v.Value -match 'C:\\Users\\Public|-enc') {
                      [PSCustomObject]@{ Location = $rk[0]; Name = $v.Name; Command = $v.Value }
                  }
              }
          })
          $persistence += @(Get-CimInstance Win32_Service | Where-Object PathName -like 'C:\Users\*' | ForEach-Object {
              [PSCustomObject]@{ Location = 'Service'; Name = $_.Name; Command = $_.PathName }
          })

          [PSCustomObject]@{
              BruteForceIPs       = $bruteIps
              Breaches            = $breaches
              NewAdmins           = $newAdmins
              SuspiciousProcesses = $procs
              Persistence         = $persistence
          }
      }

      function Join-OrNone($items) {
          if (@($items).Count) { @($items) -join ', ' } else { 'none' }
      }

      $report = Invoke-Triage
      New-Item -ItemType Directory -Path reports -Force | Out-Null
      $report | ConvertTo-Json -Depth 5 | Set-Content -Path reports\triage.json

      "Brute force from: $(Join-OrNone $report.BruteForceIPs)"
      "Breached accounts: $(Join-OrNone ($report.Breaches | ForEach-Object User))"
      "New admins: $(Join-OrNone $report.NewAdmins)"
      "Suspicious processes: $(@($report.SuspiciousProcesses).Count)"
      "Persistence entries: $(@($report.Persistence).Count)"
    `,
    objectives: [
      {
        id: "logons", hints: [],
        text: "<code>Invoke-Triage</code> returns one object whose <code>BruteForceIPs</code> and <code>Breaches</code> (User, IP, Time) are right.",
        check: function (r) {
          if (!r.fn("Invoke-Triage")) return "I can't find a function called Invoke-Triage.";
          var t = triage(r);
          if (t.error) return t.error;
          if (!H.same(asList(t.p.BruteForceIPs), TRIAGE_WANT.brute)) return "BruteForceIPs should be " + H.show(TRIAGE_WANT.brute) + ", got " + H.show(t.t.get("BruteForceIPs")) + ".";
          if (!H.same(asList(t.p.Breaches), TRIAGE_WANT.breaches)) return "Breaches should be one object: User temp.admin, IP 203.0.113.50, Time 2026-11-10 02:16:05. Got " + H.show(t.t.get("Breaches"), 300) + ".";
          return true;
        }
      },
      {
        id: "accounts", hints: [],
        text: "<code>NewAdmins</code> and <code>SuspiciousProcesses</code> (Name, Id, Path, sorted by Name) are right.",
        check: function (r) {
          if (!r.fn("Invoke-Triage")) return "I can't find a function called Invoke-Triage.";
          var t = triage(r);
          if (t.error) return t.error;
          if (!H.same(asList(t.p.NewAdmins), TRIAGE_WANT.admins)) return "NewAdmins should be " + H.show(TRIAGE_WANT.admins) + ", got " + H.show(t.t.get("NewAdmins")) + ".";
          var procs = asList(t.p.SuspiciousProcesses);
          if (!H.same(namesOf(procs, "Name"), TRIAGE_WANT.procs)) return "SuspiciousProcesses should be powershell (encoded command), svc and updater (user folders), sorted by Name. Got " + H.show(namesOf(procs, "Name")) + ".";
          if (!H.same(procs.map(function (x) { return x.Id; }), [7012, 7120, 6666]) || !procs.every(function (x) { return typeof x.Path === "string"; })) return "Each suspicious process needs Name, Id and Path.";
          return true;
        }
      },
      {
        id: "persist", hints: [],
        text: "<code>Persistence</code> lists the two malicious Run values and the malicious service, with Location, Name and Command.",
        check: function (r) {
          if (!r.fn("Invoke-Triage")) return "I can't find a function called Invoke-Triage.";
          var t = triage(r);
          if (t.error) return t.error;
          var p = asList(t.p.Persistence);
          var got = p.map(function (x) { return x && x.Location + " " + x.Name; });
          var want = ["HKLM Run AdobeUpdate", "HKCU Run WindowsUpdateCheck", "Service WinUpdateHelper"];
          if (!H.same(got, want)) return "Persistence should be:\n  " + want.join("\n  ") + "\nGot:\n  " + (got.join("\n  ") || "(none)");
          if (p[2].Command !== "C:\\Users\\Public\\svc.exe") return "The service entry's Command should be its PathName (C:\\Users\\Public\\svc.exe).";
          return true;
        }
      },
      {
        id: "hours", hints: [],
        text: "<code>-Hours</code> limits the event checks: <code>Invoke-Triage -Hours 3</code> (since 06:00) finds no brute force, breaches or new admins, without any error messages.",
        check: function (r) {
          if (!r.fn("Invoke-Triage")) return "I can't find a function called Invoke-Triage.";
          var res = r.ps("$__t = Invoke-Triage -Hours 3; $__t");
          if (res.errors.length) return "Invoke-Triage -Hours 3 showed an error: " + res.errors[0] + "\nWhen no events match, that's normal: use -ErrorAction SilentlyContinue.";
          var t = H.plain(res.raw);
          if (!t || typeof t !== "object") return "Invoke-Triage -Hours 3 should still return the report object.";
          if (asList(t.BruteForceIPs).length || asList(t.Breaches).length || asList(t.NewAdmins).length) return "With -Hours 3, the overnight events are outside the window: BruteForceIPs, Breaches and NewAdmins should be empty.";
          if (asList(t.SuspiciousProcesses).length !== 3) return "-Hours only affects the event checks: SuspiciousProcesses should still have 3 entries.";
          return true;
        }
      },
      {
        id: "report", hints: [],
        text: "The script saves <code>reports\\triage.json</code> with every nested object intact, and prints the 5 summary lines.",
        check: function (r) {
          var t = r.file("reports\\triage.json");
          if (t === null) return "reports\\triage.json wasn't created.";
          var d;
          try { d = JSON.parse(t); } catch (e) { return "reports\\triage.json isn't valid JSON."; }
          if (!d.Breaches || typeof (Array.isArray(d.Breaches) ? d.Breaches[0] : d.Breaches) !== "object") return "In reports\\triage.json, Breaches became text: use ConvertTo-Json -Depth 5.";
          if (!Array.isArray(d.Persistence) || typeof d.Persistence[0] !== "object") return "In reports\\triage.json, Persistence should be a list of objects: use ConvertTo-Json -Depth 5.";
          return H.printed(r, ["Brute force from: 203.0.113.50", "Breached accounts: temp.admin", "New admins: support_tmp", "Suspicious processes: 3", "Persistence entries: 3"]);
        }
      }
    ],
    debrief: "<p><b>Module 2 complete.</b> You turned an all-night investigation into one function: event logs, CIM, the registry, files, JSON and error handling, all working together. Run it against the other 40 servers and you'll know in minutes whether the attacker went anywhere else.</p>" +
      "<p>Module 3 is a change of pace: the help desk wants tools with <b>windows and buttons</b>, so you'll build GUIs with Windows Forms and WPF.</p>",
    realworld: "Real responders use tools built on exactly these commands, such as Kansa and PowerShell-based EDR collection scripts. To run your triage on many servers at once, PowerShell remoting (Invoke-Command -ComputerName ... -ScriptBlock { ... }) runs the same function everywhere and brings the objects back.",
    quiz: []
  });

  /* ------------------------------------------------------------------ Solutions */
  var SOLUTIONS = {
    "ps-111": ps`
      $logs = Get-ChildItem -Path logs -Recurse -Filter *.log

      $cutoff = (Get-Date).AddDays(-30)
      $old = $logs | Where-Object LastWriteTime -lt $cutoff

      $oldKB = [math]::Round(($old | Measure-Object -Property Length -Sum).Sum / 1KB, 1)

      $folder = Join-Path "archive" (Get-Date -Format "yyyy-MM")
      New-Item -ItemType Directory -Path $folder -Force | Out-Null
      $old | Move-Item -Destination $folder
    `,
    "ps-112": ps`
      $lowDisks = Import-Csv data\disks.csv |
          Where-Object { [int]$_.FreeGB -lt 20 } |
          Sort-Object { [int]$_.FreeGB }

      $cfg = Get-Content config\firewall.json -Raw | ConvertFrom-Json
      $openToAll = $cfg.firewall.rules | Where-Object source -eq "any" | Select-Object -ExpandProperty name

      ($cfg.firewall.rules | Where-Object name -eq "RDP").source = "10.0.0.0/8"
      $cfg.firewall.rules += [PSCustomObject]@{ name = "WinRM"; port = 5986; source = "10.0.0.0/8" }
      $cfg | ConvertTo-Json -Depth 5 | Set-Content -Path config\firewall.json

      $lowDisks | Export-Csv -Path reports\low-disks.csv
    `,
    "ps-113": ps`
      $errors = Select-String -Path logs\iis.log -Pattern ' 5\d\d '

      $errorIps = $errors | ForEach-Object {
          if ($_.Line -match '^\S+ \S+ (\S+)') { $Matches[1] }
      } | Sort-Object -Unique

      (Get-Content logs\iis.log) -replace '[\w.]+@[\w.]+', '<email>' | Set-Content -Path logs\iis-shared.log

      $settings = @{}
      foreach ($line in Get-Content config\app.ini) {
          if (-not $line.Trim() -or $line -like ';*') { continue }
          $key, $value = $line -split '\s*=\s*', 2
          $settings[$key] = $value
      }
    `,
    "ps-114": ps`
      function Get-ConfigValue {
          param([string]$Path, $Default)
          try {
              (Get-Content -Path $Path -Raw -ErrorAction Stop).Trim()
          }
          catch {
              $Default
          }
      }

      $services = @("W3SVC", "KestrelAgnet", "KestrelAgent", "Spooler2")
      $restarted = @()
      $failed = @()
      foreach ($s in $services) {
          try {
              Restart-Service -Name $s -ErrorAction Stop
              $restarted += $s
          }
          catch {
              $failed += "$\{s}: $($_.Exception.Message)"
          }
      }

      "$($restarted.Count) restarted, $($failed.Count) failed"

      function Assert-ServiceExists {
          param([string]$Name)
          if (-not (Get-Service -Name $Name -ErrorAction SilentlyContinue)) {
              throw "Service $Name not found"
          }
      }
    `,
    "ps-115": ps`
      $userPathProcs = Get-Process |
          Where-Object { $_.Path -like 'C:\Users\*' -or $_.Path -like 'C:\ProgramData\*' } |
          Select-Object -ExpandProperty Name

      $word = Get-CimInstance Win32_Process -Filter "Name = 'WINWORD.EXE'"
      $officeChild = (Get-CimInstance Win32_Process | Where-Object ParentProcessId -eq $word.ProcessId).CommandLine

      $unquoted = Get-CimInstance Win32_Service |
          Where-Object { $_.PathName -like '* *' -and $_.PathName -notlike '"*' -and $_.PathName -notlike 'C:\Windows\*' } |
          Select-Object -ExpandProperty Name

      Stop-Process -Name updater
    `,
    "ps-116": ps`
      $failed = Get-WinEvent -FilterHashtable @{ LogName = 'Security'; Id = 4625 }

      $bruteIps = $failed | Group-Object { $_.Properties[19].Value } | Where-Object Count -ge 10 | Select-Object -ExpandProperty Name

      $breach = Get-WinEvent -FilterHashtable @{ LogName = 'Security'; Id = 4624 } | Where-Object { $_.Properties[18].Value -in $bruteIps }
      $breachedUser = $breach.Properties[5].Value

      $newAccount = (Get-WinEvent -FilterHashtable @{ LogName = 'Security'; Id = 4720 }).Properties[0].Value
    `,
    "ps-117": ps`
      $hklmRun = 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Run'
      $hkcuRun = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
      $rdp = 'HKLM:\SYSTEM\CurrentControlSet\Control\Terminal Server\WinStations\RDP-Tcp'

      $runEntries = foreach ($pair in @(@('HKLM', $hklmRun), @('HKCU', $hkcuRun))) {
          $props = (Get-ItemProperty $pair[1]).PSObject.Properties | Where-Object Name -notlike 'PS*'
          foreach ($p in $props) {
              [PSCustomObject]@{ Hive = $pair[0]; Name = $p.Name; Command = $p.Value }
          }
      }

      $suspicious = $runEntries | Where-Object Command -match 'Users\\Public|-Enc' | Select-Object -ExpandProperty Name

      foreach ($e in $runEntries | Where-Object Name -in $suspicious) {
          $path = if ($e.Hive -eq 'HKLM') { $hklmRun } else { $hkcuRun }
          Remove-ItemProperty -Path $path -Name $e.Name
      }

      $nlaWasOn = (Get-ItemPropertyValue -Path $rdp -Name UserAuthentication) -eq 1
      Set-ItemProperty -Path $rdp -Name UserAuthentication -Value 1
    `
  };
  LABS.forEach(function (l) { if (!l.solution && SOLUTIONS[l.id]) l.solution = SOLUTIONS[l.id]; l.drills = []; T.LABS.push(l); });
  T.UPCOMING = T.UPCOMING.filter(function (row) { return row.module !== 2; });
})();
