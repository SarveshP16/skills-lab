/* sudo learn — PowerShell Module 2 practice drills (3 per lab, +5 XP each). Loaded after labs-m2.js. */
(function () {
  "use strict";
  var T = window.PS_TRACK, H = window.PSLab.H, ps = T.ps, lines = T.lines;
  var INCIDENT = "Initialize-LabScenario incident";
  function asList(v) { return v === undefined || v === null ? [] : Array.isArray(v) ? v : [v]; }

  var DRILLS = {
    "ps-111": [
      {
        id: "d1", title: "Newest file",
        text: "<p>Set <code>$newest</code> to the <b>name</b> of the most recently written file in <code>reports</code>.</p>",
        files: { "reports/q1.csv": { content: "a\n", ageDays: 200 }, "reports/q3.csv": { content: "c\n", ageDays: 20 }, "reports/q2.csv": { content: "b\n", ageDays: 110 } },
        starter: ps`
          # $newest = ...
        `,
        solution: ps`
          $newest = (Get-ChildItem reports -File | Sort-Object LastWriteTime -Descending | Select-Object -First 1).Name
        `,
        check: function (r) { return H.expect(r, "newest", "q3.csv"); }
      },
      {
        id: "d2", title: "Does it exist?",
        text: "<p>Set <code>$hasConfig</code> to whether <code>config\\app.json</code> exists, and <code>$hasBackup</code> to whether <code>config\\app.json.bak</code> exists, using <code>Test-Path</code>.</p>",
        files: { "config/app.json": "{}\n" },
        starter: ps`
          # $hasConfig = ...
        `,
        solution: ps`
          $hasConfig = Test-Path config\app.json
          $hasBackup = Test-Path config\app.json.bak
        `,
        check: function (r) {
          var res = H.expect(r, "hasConfig", true, "boolean");
          if (res !== true) return res;
          return H.expect(r, "hasBackup", false, "boolean");
        }
      },
      {
        id: "d3", title: "Build and take apart paths",
        text: "<p>Set <code>$full</code> to <code>$root</code> joined with <code>$name</code> using <code>Join-Path</code>, and <code>$leaf</code> to the file name part of <code>$other</code> using <code>Split-Path -Leaf</code>.</p>",
        starter: ps`
          $root = "D:\backups"
          $name = "db-01.bak"
          $other = "C:\Windows\Logs\CBS\CBS.log"
        `,
        solution: ps`
          $root = "D:\backups"
          $name = "db-01.bak"
          $other = "C:\Windows\Logs\CBS\CBS.log"
          $full = Join-Path $root $name
          $leaf = Split-Path $other -Leaf
        `,
        check: function (r) {
          var res = H.expect(r, "full", "D:\\backups\\db-01.bak");
          if (res !== true) return res;
          res = H.expect(r, "leaf", "CBS.log");
          if (res !== true) return res;
          return /Join-Path/i.test(r.src) && /Split-Path/i.test(r.src) ? true : "Use Join-Path and Split-Path.";
        }
      }
    ],

    "ps-112": [
      {
        id: "d1", title: "Count CSV rows",
        text: "<p>Set <code>$activeCount</code> to how many people in <code>data\\staff.csv</code> have <code>Status</code> <code>Active</code>.</p>",
        files: { "data/staff.csv": lines("Name,Status", "Ana,Active", "Ben,Leaver", "Cara,Active", "Dev,Active") },
        starter: ps`
          # $activeCount = ...
        `,
        solution: ps`
          $activeCount = @(Import-Csv data\staff.csv | Where-Object Status -eq "Active").Count
        `,
        check: function (r) { return H.expect(r, "activeCount", 3, "number"); }
      },
      {
        id: "d2", title: "Dig into JSON",
        text: "<p>Set <code>$dbHost</code> to the database host in <code>config\\app.json</code>.</p>",
        files: { "config/app.json": JSON.stringify({ app: "orders", database: { host: "db-01.kestrel.internal", port: 5432 } }, null, 2) + "\n" },
        starter: ps`
          # $dbHost = ...
        `,
        solution: ps`
          $cfg = Get-Content config\app.json -Raw | ConvertFrom-Json
          $dbHost = $cfg.database.host
        `,
        check: function (r) { return H.expect(r, "dbHost", "db-01.kestrel.internal"); }
      },
      {
        id: "d3", title: "Compact JSON",
        text: "<p>Set <code>$json</code> to <code>$event</code> as one-line JSON (<code>-Compress</code>), keeping the nested <code>tags</code> list.</p>",
        starter: ps`
          $event = [PSCustomObject]@{ id = 7; level = "warn"; meta = [PSCustomObject]@{ tags = @("disk", "web-01") } }
        `,
        solution: ps`
          $event = [PSCustomObject]@{ id = 7; level = "warn"; meta = [PSCustomObject]@{ tags = @("disk", "web-01") } }
          $json = $event | ConvertTo-Json -Compress -Depth 3
        `,
        check: function (r) {
          var v = r.v("json");
          if (typeof v === "string" && /"meta":"/.test(v)) return "meta became a string: add -Depth 3.";
          return H.expect(r, "json", '{"id":7,"level":"warn","meta":{"tags":["disk","web-01"]}}');
        }
      }
    ],

    "ps-113": [
      {
        id: "d1", title: "How many errors?",
        text: "<p>Set <code>$errorCount</code> to the number of lines in <code>logs\\app.log</code> that contain <code>ERROR</code>, using <code>Select-String</code>.</p>",
        files: { "logs/app.log": lines("INFO start", "ERROR db timeout", "WARN slow", "ERROR db timeout", "INFO done", "ERROR cache down") },
        starter: ps`
          # $errorCount = ...
        `,
        solution: ps`
          $errorCount = (Select-String -Path logs\app.log -Pattern 'ERROR').Count
        `,
        check: function (r) {
          var res = H.expect(r, "errorCount", 3, "number");
          if (res !== true) return res;
          return /Select-String|\bsls\b/i.test(r.src) ? true : "Use Select-String.";
        }
      },
      {
        id: "d2", title: "Mask a card number",
        text: "<p>Set <code>$masked</code> to <code>$card</code> with everything but the last 4 digits replaced: <code>****-****-****-1234</code>. Use <code>-replace</code> with a capture group.</p>",
        starter: ps`
          $card = "4111-1111-1111-1234"
        `,
        solution: ps`
          $card = "4111-1111-1111-1234"
          $masked = $card -replace '^\d{4}-\d{4}-\d{4}-(\d{4})$', '****-****-****-$1'
        `,
        check: function (r) {
          var res = H.expect(r, "masked", "****-****-****-1234");
          if (res !== true) return res;
          return H.alt(r, '\\$card\\s*=\\s*"[^"]*"', '$card = "5500-0000-0000-0004"', { masked: "****-****-****-0004" }, "a different card number");
        }
      },
      {
        id: "d3", title: "Split a record",
        text: "<p><code>$record</code> uses <code>|</code> between fields (with optional spaces). Set <code>$fields</code> to the 4 fields, without spaces around them.</p>",
        starter: ps`
          $record = "web-01 | 10.0.4.11 |prod|  Dana Park"
        `,
        solution: ps`
          $record = "web-01 | 10.0.4.11 |prod|  Dana Park"
          $fields = $record -split '\s*\|\s*'
        `,
        check: function (r) {
          var v = r.p("fields");
          if (Array.isArray(v) && v.length > 10) return "The pipe | is special in a regex (it means OR). Escape it: '\\|'.";
          return H.expect(r, "fields", ["web-01", "10.0.4.11", "prod", "Dana Park"], "array");
        }
      }
    ],

    "ps-114": [
      {
        id: "d1", title: "Convert or default",
        text: "<p>Set <code>$port</code> to <code>$text</code> as an <code>[int]</code>, or 8080 if it isn't a number, using <code>try/catch</code>.</p>",
        starter: ps`
          $text = "eighty"
        `,
        solution: ps`
          $text = "eighty"
          try { $port = [int]$text }
          catch { $port = 8080 }
        `,
        check: function (r) {
          var res = H.expect(r, "port", 8080, "number");
          if (res !== true) return res;
          var r2 = r.run(r.src.replace(/\$text\s*=\s*"[^"]*"/, '$text = "443"'));
          if (r2.v("port") !== 443) return "With $text = \"443\", $port should be 443.";
          return /\btry\b/i.test(r.src) && /\bcatch\b/i.test(r.src) ? true : "Use try/catch.";
        }
      },
      {
        id: "d2", title: "Quietly check",
        text: "<p>Set <code>$exists</code> to whether a service named <code>$name</code> exists, without any red error when it doesn't (<code>-ErrorAction SilentlyContinue</code>).</p>",
        starter: ps`
          $name = "Nope"
        `,
        solution: ps`
          $name = "Nope"
          $exists = [bool](Get-Service -Name $name -ErrorAction SilentlyContinue)
        `,
        check: function (r) {
          if (r.errors.length) return "An error was shown: " + r.errors[0] + ". Add -ErrorAction SilentlyContinue.";
          var res = H.expect(r, "exists", false, "boolean");
          if (res !== true) return res;
          var r2 = r.run(r.src.replace(/\$name\s*=\s*"[^"]*"/, '$name = "W3SVC"'));
          return r2.v("exists") === true ? true : "With $name = \"W3SVC\", $exists should be $true. ([bool] turns a result into $true/$false.)";
        }
      },
      {
        id: "d3", title: "throw and catch",
        text: "<p>Write <code>Get-Half</code> with an <code>[int]$N</code> that throws <code>odd number: 7</code> for odd numbers and returns half otherwise. Then set <code>$msg</code> to the message caught from <code>Get-Half -N 7</code>.</p>",
        starter: ps`
          function Get-Half {

          }
        `,
        solution: ps`
          function Get-Half {
              param([int]$N)
              if ($N % 2) { throw "odd number: $N" }
              $N / 2
          }
          try { Get-Half -N 7 } catch { $msg = $_.Exception.Message }
        `,
        check: function (r) {
          var res = H.call(r, "Get-Half -N 10", 5);
          if (res !== true) return res;
          return H.expect(r, "msg", "odd number: 7");
        }
      }
    ],

    "ps-115": [
      {
        id: "d1", title: "Which Windows?",
        text: "<p>Set <code>$os</code> to the <code>Caption</code> of <code>Win32_OperatingSystem</code>.</p>",
        starter: ps`
          # $os = ...
        `,
        solution: ps`
          $os = (Get-CimInstance Win32_OperatingSystem).Caption
        `,
        check: function (r) { return H.expect(r, "os", "Microsoft Windows Server 2022 Datacenter"); }
      },
      {
        id: "d2", title: "Started in the last hour",
        text: "<p>Set <code>$recent</code> to the names of processes whose <code>StartTime</code> is within the last hour.</p>",
        prelude: INCIDENT,
        starter: ps`
          # $recent = ...
        `,
        solution: ps`
          $recent = Get-Process | Where-Object StartTime -gt (Get-Date).AddHours(-1) | Select-Object -ExpandProperty Name
        `,
        check: function (r) { return H.expect(r, "recent", ["powershell", "pwsh"], "array"); }
      },
      {
        id: "d3", title: "Running as SYSTEM",
        text: "<p>Set <code>$systemCount</code> to how many services run as <code>LocalSystem</code> (the <code>StartName</code> in <code>Win32_Service</code>).</p>",
        starter: ps`
          # $systemCount = ...
        `,
        solution: ps`
          $systemCount = @(Get-CimInstance Win32_Service | Where-Object StartName -eq "LocalSystem").Count
        `,
        check: function (r) {
          var want = r.system.services.filter(function (s) { return s.StartName === "LocalSystem"; }).length;
          return H.expect(r, "systemCount", want, "number");
        }
      }
    ],

    "ps-116": [
      {
        id: "d1", title: "The latest System event",
        text: "<p>Set <code>$lastId</code> to the <code>Id</code> of the most recent event in the <code>System</code> log.</p>",
        starter: ps`
          # $lastId = ...
        `,
        solution: ps`
          $lastId = (Get-WinEvent -LogName System -MaxEvents 1).Id
        `,
        check: function (r) { return H.expect(r, "lastId", 7036, "number"); }
      },
      {
        id: "d2", title: "Count the errors",
        text: "<p>Set <code>$appErrors</code> to how many <b>Error</b>-level events (Level 2) are in the <code>Application</code> log, filtering with <code>-FilterHashtable</code>.</p>",
        starter: ps`
          # $appErrors = ...
        `,
        solution: ps`
          $appErrors = @(Get-WinEvent -FilterHashtable @{ LogName = 'Application'; Level = 2 }).Count
        `,
        check: function (r) {
          var res = H.expect(r, "appErrors", 1, "number");
          if (res !== true) return res;
          return /FilterHashtable/i.test(r.src) ? true : "Use -FilterHashtable with a Level key.";
        }
      },
      {
        id: "d3", title: "A time window",
        text: "<p>Set <code>$nightFailures</code> to the number of failed logons (4625) between 02:00 and 03:00 today, using <code>StartTime</code> and <code>EndTime</code>.</p>",
        prelude: INCIDENT,
        starter: ps`
          $start = (Get-Date).Date.AddHours(2)
          $end = (Get-Date).Date.AddHours(3)
        `,
        solution: ps`
          $start = (Get-Date).Date.AddHours(2)
          $end = (Get-Date).Date.AddHours(3)
          $nightFailures = @(Get-WinEvent -FilterHashtable @{ LogName = 'Security'; Id = 4625; StartTime = $start; EndTime = $end }).Count
        `,
        check: function (r) {
          var res = H.expect(r, "nightFailures", 14, "number");
          if (res !== true) return res;
          return /StartTime/i.test(r.src) && /EndTime/i.test(r.src) ? true : "Filter with StartTime and EndTime in the hashtable.";
        }
      }
    ],

    "ps-117": [
      {
        id: "d1", title: "Read one value",
        text: "<p>Set <code>$agentServer</code> to the <code>Server</code> value of <code>HKLM:\\SOFTWARE\\Kestrel\\Agent</code>.</p>",
        starter: ps`
          # $agentServer = ...
        `,
        solution: ps`
          $agentServer = Get-ItemPropertyValue -Path 'HKLM:\SOFTWARE\Kestrel\Agent' -Name Server
        `,
        check: function (r) { return H.expect(r, "agentServer", "https://telemetry.kestrel.io"); }
      },
      {
        id: "d2", title: "Is the key there?",
        text: "<p>Set <code>$hasRunOnce</code> to whether <code>HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\RunOnce</code> exists, and <code>$hasPolicy</code> to whether <code>HKLM:\\SOFTWARE\\Policies\\Kestrel</code> exists.</p>",
        starter: ps`
          # $hasRunOnce = ...
        `,
        solution: ps`
          $hasRunOnce = Test-Path 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\RunOnce'
          $hasPolicy = Test-Path 'HKLM:\SOFTWARE\Policies\Kestrel'
        `,
        check: function (r) {
          var res = H.expect(r, "hasRunOnce", true, "boolean");
          if (res !== true) return res;
          return H.expect(r, "hasPolicy", false, "boolean");
        }
      },
      {
        id: "d3", title: "Add a setting",
        text: "<p>Create a <code>LogLevel</code> value with the text <code>Debug</code> under <code>HKLM:\\SOFTWARE\\Kestrel\\Agent</code>, using <code>New-ItemProperty</code>.</p>",
        starter: ps`
          # New-ItemProperty ...
        `,
        solution: ps`
          New-ItemProperty -Path 'HKLM:\SOFTWARE\Kestrel\Agent' -Name LogLevel -Value Debug -PropertyType String
        `,
        check: function (r) {
          var k = r.system.registry.filter(function (x) { return x.path === "HKLM:\\SOFTWARE\\Kestrel\\Agent"; })[0];
          var v = k && k.values.filter(function (x) { return x.name === "LogLevel"; })[0];
          if (!v) return "There's no LogLevel value under HKLM:\\SOFTWARE\\Kestrel\\Agent yet.";
          if (v.value !== "Debug") return "LogLevel should be Debug, but it's " + H.show(v.value) + ".";
          return /New-ItemProperty/i.test(r.src) ? true : "Use New-ItemProperty.";
        }
      }
    ],

    "ps-118": [
      {
        id: "d1", title: "Decode -EncodedCommand",
        text: "<p><code>-EncodedCommand</code> is Base64 of UTF-16 (\"Unicode\") text. Set <code>$decoded</code> to the command hidden in <code>$b64</code>: <code>[System.Text.Encoding]::Unicode.GetString([Convert]::FromBase64String($b64))</code>.</p>",
        starter: ps`
          $b64 = "VwByAGkAdABlAC0ASABvAHMAdAAgACcAaABlAGwAbABvACcA"
        `,
        solution: ps`
          $b64 = "VwByAGkAdABlAC0ASABvAHMAdAAgACcAaABlAGwAbABvACcA"
          $decoded = [System.Text.Encoding]::Unicode.GetString([Convert]::FromBase64String($b64))
        `,
        check: function (r) { return H.expect(r, "decoded", "Write-Host 'hello'"); }
      },
      {
        id: "d2", title: "Failures per hour",
        text: "<p>Set <code>$byHour</code> to the failed logons (4625) grouped by the hour they happened (<code>$_.TimeCreated.Hour</code>), as <code>Group-Object</code> output.</p>",
        prelude: INCIDENT,
        starter: ps`
          # $byHour = ...
        `,
        solution: ps`
          $byHour = Get-WinEvent -FilterHashtable @{ LogName = 'Security'; Id = 4625 } | Group-Object { $_.TimeCreated.Hour }
        `,
        check: function (r) {
          var v = asList(r.v("byHour"));
          var m = {};
          v.forEach(function (g) { if (g && g.get) m[String(g.get("Name"))] = g.get("Count"); });
          if (!H.same(m, { "2": 14, "3": 4, "8": 2 })) return "$byHour should group the 20 failures into hours 2 (14), 3 (4) and 8 (2). Yours: " + H.show(m) + ".";
          return true;
        }
      },
      {
        id: "d3", title: "One timeline line",
        text: "<p>Set <code>$line</code> to <code>02:16:05 temp.admin logged on from 203.0.113.50</code>, built from the 4624 event whose source IP is <code>203.0.113.50</code>.</p>",
        prelude: INCIDENT,
        starter: ps`
          # $line = ...
        `,
        solution: ps`
          $e = Get-WinEvent -FilterHashtable @{ LogName = 'Security'; Id = 4624 } | Where-Object { $_.Properties[18].Value -eq '203.0.113.50' }
          $line = "{0} {1} logged on from {2}" -f $e.TimeCreated.ToString('HH:mm:ss'), $e.Properties[5].Value, $e.Properties[18].Value
        `,
        check: function (r) { return H.expect(r, "line", "02:16:05 temp.admin logged on from 203.0.113.50"); }
      }
    ]
  };
  T.LABS.forEach(function (l) { if (DRILLS[l.id]) l.drills = DRILLS[l.id]; });
})();
