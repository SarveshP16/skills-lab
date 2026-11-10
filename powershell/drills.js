/* sudo learn — PowerShell practice drills: 3 short optional exercises per lab (+5 XP each).
   Same format as the Python drills, with JavaScript checks: check(r) returns true or a message.
   Expected values are computed from the pretend machine (r.system) where possible, so they can't drift. */
(function () {
  "use strict";
  var T = window.PS_TRACK, H = window.PSLab.H, ps = T.ps, lines = T.lines;
  function names(list) { return list.map(function (x) { return x.Name; }); }
  function byName(a, b) { return a.Name.toLowerCase() < b.Name.toLowerCase() ? -1 : 1; }

  var DRILLS = {
    "ps-101": [
      {
        id: "d1", title: "Count the services",
        text: "<p>Set <code>$serviceCount</code> to how many services there are.</p>",
        starter: ps`
          # $serviceCount = ...
        `,
        solution: ps`
          $serviceCount = (Get-Service).Count
        `,
        check: function (r) {
          var res = H.expect(r, "serviceCount", r.system.services.length, "number");
          if (res !== true) return res;
          return /Get-Service/i.test(r.src) ? true : "Count them with Get-Service.";
        }
      },
      {
        id: "d2", title: "Find by verb",
        text: "<p>Set <code>$stopCmds</code> to the names of all commands whose verb is <code>Stop</code>.</p>",
        starter: ps`
          # $stopCmds = ...
        `,
        solution: ps`
          $stopCmds = (Get-Command -Verb Stop).Name
        `,
        check: function (r) { return H.expect(r, "stopCmds", ["Stop-Process", "Stop-Service"], "array"); }
      },
      {
        id: "d3", title: "What can a string do?",
        text: "<p>Strings are objects too. Set <code>$stringProps</code> to the names of the <b>Property</b> members of the string <code>'kestrel'</code>.</p>",
        starter: ps`
          # $stringProps = ...
        `,
        solution: ps`
          $stringProps = ('kestrel' | Get-Member -MemberType Property).Name
        `,
        check: function (r) {
          var res = H.expect(r, "stringProps", "Length");
          if (res !== true) return res;
          return /Get-Member|\bgm\b/i.test(r.src) ? true : "Use Get-Member to find it.";
        }
      }
    ],

    "ps-102": [
      {
        id: "d1", title: "An expression in a string",
        text: "<p>Set <code>$msg</code> to <code>web-01 has 14 services</code>, putting <code>(Get-Service).Count</code> inside the string with <code>$( )</code>.</p>",
        starter: ps`
          $name = "web-01"
        `,
        solution: ps`
          $name = "web-01"
          $msg = "$name has $((Get-Service).Count) services"
        `,
        check: function (r) {
          var res = H.expect(r, "msg", "web-01 has " + r.system.services.length + " services", "string");
          if (res !== true) {
            if (/System\.ServiceProcess|\.Count/.test(String(r.v("msg")))) return "Inside a string, only the variable expands, not .Count. Wrap the whole expression: $((Get-Service).Count).";
            return res;
          }
          return /\$\(/.test(r.src) ? true : "Use $( ) inside the string.";
        }
      },
      {
        id: "d2", title: "Zero-padded IDs",
        text: "<p>Set <code>$id</code> to <code>$n</code> as a 5-digit text with leading zeros (<code>00042</code>), using <code>-f</code>.</p>",
        starter: ps`
          $n = 42
        `,
        solution: ps`
          $n = 42
          $id = "{0:D5}" -f $n
        `,
        check: function (r) {
          var res = H.expect(r, "id", "00042", "string");
          if (res !== true) return res;
          return H.alt(r, "\\$n\\s*=\\s*\\d+", "$n = 7", { id: "00007" }, "$n = 7");
        }
      },
      {
        id: "d3", title: "Text to number",
        text: "<p><code>$port</code> came from a config file as text. Set <code>$next</code> to the next port number (8081, a number).</p>",
        starter: ps`
          $port = "8080"
        `,
        solution: ps`
          $port = "8080"
          $next = [int]$port + 1
        `,
        check: function (r) {
          if (r.v("next") === "80801") return "$next is \"80801\": that's text joined to text. Convert with [int] first.";
          var res = H.expect(r, "next", 8081, "number");
          if (res !== true) return res;
          return H.alt(r, '\\$port\\s*=\\s*"\\d+"', '$port = "22"', { next: 23 }, "$port = \"22\"");
        }
      }
    ],

    "ps-103": [
      {
        id: "d1", title: "Running automatically",
        text: "<p>Set <code>$autoRunning</code> to <b>how many</b> services are set to start <code>Automatic</code> and are <code>Running</code>.</p>",
        starter: ps`
          # $autoRunning = ...
        `,
        solution: ps`
          $autoRunning = (Get-Service | Where-Object { $_.StartType -eq "Automatic" -and $_.Status -eq "Running" }).Count
        `,
        check: function (r) {
          var want = r.system.services.filter(function (s) { return s.StartType === "Automatic" && s.Status === "Running"; }).length;
          return H.expect(r, "autoRunning", want, "number");
        }
      },
      {
        id: "d2", title: "Wildcard names",
        text: "<p>Set <code>$kServices</code> to the names of the services whose name starts with <code>K</code>.</p>",
        starter: ps`
          # $kServices = ...
        `,
        solution: ps`
          $kServices = Get-Service | Where-Object Name -like "K*" | Select-Object -ExpandProperty Name
        `,
        check: function (r) { return H.expect(r, "kServices", ["KestrelAgent", "KestrelUpdater"], "array"); }
      },
      {
        id: "d3", title: "Where do they run from?",
        text: "<p>Set <code>$kestrelPaths</code> to the <code>Path</code> of every process whose <code>Company</code> is <code>Kestrel Cloud</code>.</p>",
        starter: ps`
          # $kestrelPaths = ...
        `,
        solution: ps`
          $kestrelPaths = Get-Process | Where-Object Company -eq "Kestrel Cloud" | Select-Object -ExpandProperty Path
        `,
        check: function (r) {
          var want = r.system.processes.filter(function (x) { return x.Company === "Kestrel Cloud"; }).sort(byName).map(function (x) { return x.Path; });
          return H.expect(r, "kestrelPaths", want, "array");
        }
      }
    ],

    "ps-104": [
      {
        id: "d1", title: "CPU in minutes",
        text: "<p>Set <code>$heavy</code> to objects with <code>Name</code> and <code>CPUMinutes</code> (<code>CPU</code> / 60, rounded to 1 decimal) for the 2 processes with the most CPU, highest first.</p>",
        starter: ps`
          # $heavy = ...
        `,
        solution: ps`
          $heavy = Get-Process | Sort-Object CPU -Descending | Select-Object -First 2 Name, @{ Name = "CPUMinutes"; Expression = { [math]::Round($_.CPU / 60, 1) } }
        `,
        check: function (r) {
          var top = r.system.processes.slice().sort(function (a, b) { return b.CPU - a.CPU; }).slice(0, 2);
          var want = top.map(function (x) { return { Name: x.Name, CPUMinutes: Math.round(x.CPU / 60 * 10) / 10 }; });
          return H.expect(r, "heavy", want, "array");
        }
      },
      {
        id: "d2", title: "Kinds of start type",
        text: "<p>Set <code>$startTypes</code> to the names of the groups you get from grouping services by <code>StartType</code>.</p>",
        starter: ps`
          # $startTypes = ...
        `,
        solution: ps`
          $startTypes = (Get-Service | Group-Object StartType).Name
        `,
        check: function (r) { return H.expect(r, "startTypes", ["Automatic", "Disabled", "Manual"], "array"); }
      },
      {
        id: "d3", title: "Average CPU",
        text: "<p>Set <code>$avgCpu</code> to the average <code>CPU</code> of all processes, rounded to 2 decimals.</p>",
        starter: ps`
          # $avgCpu = ...
        `,
        solution: ps`
          $avgCpu = [math]::Round((Get-Process | Measure-Object CPU -Average).Average, 2)
        `,
        check: function (r) {
          var cpus = r.system.processes.map(function (x) { return x.CPU; });
          var want = Math.round(cpus.reduce(function (a, b) { return a + b; }, 0) / cpus.length * 100) / 100;
          var res = H.expect(r, "avgCpu", want, "number");
          if (res !== true) return res;
          return /Measure-Object/i.test(r.src) ? true : "Use Measure-Object -Average.";
        }
      }
    ],

    "ps-105": [
      {
        id: "d1", title: "Slices",
        text: "<p>Set <code>$firstTwo</code> to the first two items of <code>$queue</code> (use a range index like <code>[0..1]</code>) and <code>$last</code> to the last one.</p>",
        starter: ps`
          $queue = @("job-17", "job-18", "job-19", "job-20")
        `,
        solution: ps`
          $queue = @("job-17", "job-18", "job-19", "job-20")
          $firstTwo = $queue[0..1]
          $last = $queue[-1]
        `,
        check: function (r) {
          var res = H.expect(r, "firstTwo", ["job-17", "job-18"], "array");
          if (res !== true) return res;
          res = H.expect(r, "last", "job-20");
          if (res !== true) return res;
          return H.alt(r, "\\$queue\\s*=\\s*@\\([^)]*\\)", '$queue = @("a", "b", "c")', { firstTwo: ["a", "b"], last: "c" }, "a different $queue");
        }
      },
      {
        id: "d2", title: "Hashtable keys",
        text: "<p>Set <code>$serviceNames</code> to the keys of <code>$ports</code>, sorted alphabetically.</p>",
        starter: ps`
          $ports = @{ web = 443; ssh = 22; db = 5432 }
        `,
        solution: ps`
          $ports = @{ web = 443; ssh = 22; db = 5432 }
          $serviceNames = $ports.Keys | Sort-Object
        `,
        check: function (r) { return H.expect(r, "serviceNames", ["db", "ssh", "web"], "array"); }
      },
      {
        id: "d3", title: "Your own object",
        text: "<p>Set <code>$svc</code> to a <code>[PSCustomObject]</code> with <code>Name</code> = <code>api</code>, <code>Port</code> = <code>8080</code> (a number) and <code>Healthy</code> = <code>$true</code>.</p>",
        starter: ps`
          # $svc = ...
        `,
        solution: ps`
          $svc = [PSCustomObject]@{ Name = "api"; Port = 8080; Healthy = $true }
        `,
        check: function (r) {
          var v = r.v("svc");
          if (v === undefined) return "I can't find a variable called $svc yet.";
          if (!(v instanceof window.PSEngine.PSObject)) return "$svc should be a [PSCustomObject]@{ ... }, not a plain hashtable.";
          return H.expect(r, "svc", { Name: "api", Port: 8080, Healthy: true });
        }
      }
    ],

    "ps-106": [
      {
        id: "d1", title: "Grades",
        text: "<p>Set <code>$grade</code>: <code>A</code> if <code>$score</code> is 90 or more, <code>B</code> if 75 or more, otherwise <code>C</code>.</p>",
        starter: ps`
          $score = 82
        `,
        solution: ps`
          $score = 82
          if ($score -ge 90) { $grade = "A" }
          elseif ($score -ge 75) { $grade = "B" }
          else { $grade = "C" }
        `,
        check: function (r) {
          var cases = [[82, "B"], [90, "A"], [74, "C"], [75, "B"]];
          for (var i = 0; i < cases.length; i++) {
            var r2 = r.run(r.src.replace(/\$score\s*=\s*\d+/, "$score = " + cases[i][0]));
            if (r2.v("grade") !== cases[i][1]) return "With $score = " + cases[i][0] + ", $grade should be \"" + cases[i][1] + "\" but it's " + H.show(r2.v("grade")) + ".";
          }
          return true;
        }
      },
      {
        id: "d2", title: "switch -Regex",
        text: "<p>Set <code>$kinds</code>: for each file, <code>log</code> if it ends in <code>.log</code>, <code>image</code> if it ends in <code>.jpg</code> or <code>.png</code>, otherwise <code>other</code>. Use <code>switch -Regex</code>.</p>",
        starter: ps`
          $files = @("app.log", "logo.png", "notes.txt", "photo.jpg")
        `,
        solution: ps`
          $files = @("app.log", "logo.png", "notes.txt", "photo.jpg")
          $kinds = switch -Regex ($files) {
              '\.log$'       { "log" }
              '\.(jpg|png)$' { "image" }
              default        { "other" }
          }
        `,
        check: function (r) {
          var res = H.expect(r, "kinds", ["log", "image", "other", "image"], "array");
          if (res !== true) return res;
          return /switch\s+-regex/i.test(r.src) ? true : "Use switch -Regex.";
        }
      },
      {
        id: "d3", title: "Not on the list",
        text: "<p>Set <code>$blocked</code> to <code>$true</code> when <code>$ip</code> is <b>not</b> in <code>$allowList</code>.</p>",
        starter: ps`
          $allowList = @("10.0.4.20", "10.0.4.31")
          $ip = "203.0.113.50"
        `,
        solution: ps`
          $allowList = @("10.0.4.20", "10.0.4.31")
          $ip = "203.0.113.50"
          $blocked = $ip -notin $allowList
        `,
        check: function (r) {
          var res = H.expect(r, "blocked", true, "boolean");
          if (res !== true) return res;
          return H.alt(r, '\\$ip\\s*=\\s*"[^"]*"', '$ip = "10.0.4.31"', { blocked: false }, "$ip = \"10.0.4.31\"");
        }
      }
    ],

    "ps-107": [
      {
        id: "d1", title: "Countdown",
        text: "<p>Set <code>$countdown</code> to 5, 4, 3, 2, 1 using a <code>while</code> loop.</p>",
        starter: ps`
          $n = 5
        `,
        solution: ps`
          $n = 5
          $countdown = while ($n -ge 1) {
              $n
              $n--
          }
        `,
        check: function (r) {
          var res = H.expect(r, "countdown", [5, 4, 3, 2, 1], "array");
          if (res !== true) return res;
          return /while\s*\(/i.test(r.src) ? true : "Use a while loop.";
        }
      },
      {
        id: "d2", title: "Sum of the even numbers",
        text: "<p>Set <code>$evenSum</code> to the sum of the even numbers from 1 to 20, using <code>foreach</code> and <code>continue</code> to skip the odd ones.</p>",
        starter: ps`
          $evenSum = 0
        `,
        solution: ps`
          $evenSum = 0
          foreach ($n in 1..20) {
              if ($n % 2) { continue }
              $evenSum += $n
          }
        `,
        check: function (r) {
          var res = H.expect(r, "evenSum", 110, "number");
          if (res !== true) return res;
          return /\bcontinue\b/i.test(r.src) ? true : "Use continue to skip the odd numbers.";
        }
      },
      {
        id: "d3", title: "Stop at the first failure",
        text: "<p>Set <code>$firstFail</code> to the <code>Name</code> of the first check whose <code>Status</code> is <code>Fail</code>, using a loop with <code>break</code>.</p>",
        starter: ps`
          $checks = @(
              [PSCustomObject]@{ Name = "disk"; Status = "Pass" }
              [PSCustomObject]@{ Name = "dns"; Status = "Fail" }
              [PSCustomObject]@{ Name = "tls"; Status = "Fail" }
          )
        `,
        solution: ps`
          $checks = @(
              [PSCustomObject]@{ Name = "disk"; Status = "Pass" }
              [PSCustomObject]@{ Name = "dns"; Status = "Fail" }
              [PSCustomObject]@{ Name = "tls"; Status = "Fail" }
          )
          foreach ($c in $checks) {
              if ($c.Status -eq "Fail") {
                  $firstFail = $c.Name
                  break
              }
          }
        `,
        check: function (r) {
          var res = H.expect(r, "firstFail", "dns");
          if (res !== true) return res;
          return /\bbreak\b/i.test(r.src) ? true : "Use break to stop at the first one.";
        }
      }
    ],

    "ps-108": [
      {
        id: "d1", title: "Format-Size",
        text: "<p>Write <code>Format-Size</code> with a <code>[double]$Bytes</code> parameter that returns the size in MB with 1 decimal: <code>Format-Size -Bytes 1572864</code> → <code>1.5 MB</code>.</p>",
        starter: ps`
          function Format-Size {

          }
        `,
        solution: ps`
          function Format-Size {
              param([double]$Bytes)
              "{0:N1} MB" -f ($Bytes / 1MB)
          }
        `,
        check: function (r) {
          var res = H.call(r, "Format-Size -Bytes 1572864", "1.5 MB");
          if (res !== true) return res;
          return H.call(r, "Format-Size -Bytes 10485760", "10.0 MB");
        }
      },
      {
        id: "d2", title: "Data, not chatter",
        text: "<p><code>Get-Total</code> should return only the number 60, but returns more. Fix it so the progress message is still shown, but with <code>Write-Host</code>.</p>",
        starter: ps`
          function Get-Total {
              param([int[]]$Values)
              Write-Output "Adding $($Values.Count) values..."
              $sum = 0
              foreach ($v in $Values) { $sum += $v }
              $sum
          }
        `,
        solution: ps`
          function Get-Total {
              param([int[]]$Values)
              Write-Host "Adding $($Values.Count) values..."
              $sum = 0
              foreach ($v in $Values) { $sum += $v }
              $sum
          }
        `,
        check: function (r) {
          var res = r.ps("Get-Total -Values 10, 20, 30");
          if (Array.isArray(res.value)) return "Get-Total returned " + H.show(res.raw) + ": Write-Output sends the message into the return value. Use Write-Host.";
          if (res.value !== 60) return "Get-Total -Values 10, 20, 30 should return 60, got " + H.show(res.raw) + ".";
          return /Adding 3 values/.test(res.text) ? true : "Keep showing the \"Adding ... values\" message, with Write-Host.";
        }
      },
      {
        id: "d3", title: "A switch parameter",
        text: "<p>Write <code>Get-Hello</code> with <code>$Name</code> and a <code>[switch]$Loud</code>: <code>Get-Hello -Name Ana</code> → <code>Hello Ana</code>; with <code>-Loud</code> → <code>HELLO ANA!</code>.</p>",
        starter: ps`
          function Get-Hello {

          }
        `,
        solution: ps`
          function Get-Hello {
              param([string]$Name, [switch]$Loud)
              $text = "Hello $Name"
              if ($Loud) { $text = $text.ToUpper() + "!" }
              $text
          }
        `,
        check: function (r) {
          var res = H.call(r, "Get-Hello -Name Ana", "Hello Ana");
          if (res !== true) return res;
          return H.call(r, "Get-Hello -Name Ana -Loud", "HELLO ANA!");
        }
      }
    ],

    "ps-109": [
      {
        id: "d1", title: "Only valid levels",
        text: "<p>Write <code>Set-LogLevel</code> with a mandatory <code>-Level</code> that only accepts <code>Debug</code>, <code>Info</code> or <code>Error</code>, returning <code>Log level: Info</code>.</p>",
        starter: ps`
          function Set-LogLevel {

          }
        `,
        solution: ps`
          function Set-LogLevel {
              [CmdletBinding()]
              param(
                  [Parameter(Mandatory)]
                  [ValidateSet("Debug", "Info", "Error")]
                  [string]$Level
              )
              "Log level: $Level"
          }
        `,
        check: function (r) {
          var res = H.call(r, "Set-LogLevel -Level Info", "Log level: Info");
          if (res !== true) return res;
          var bad = r.ps("Set-LogLevel -Level Trace");
          if (bad.ok) return "Set-LogLevel -Level Trace should be refused by [ValidateSet(...)].";
          var none = r.ps("Set-LogLevel");
          return none.ok ? "Without -Level it should fail: make it Mandatory." : true;
        }
      },
      {
        id: "d2", title: "Values from the pipeline",
        text: "<p>Write <code>Get-Double</code> so that <code>1, 2, 3 | Get-Double</code> returns 2, 4, 6.</p>",
        starter: ps`
          function Get-Double {

          }
        `,
        solution: ps`
          function Get-Double {
              [CmdletBinding()]
              param([Parameter(ValueFromPipeline)][int]$Number)
              process { $Number * 2 }
          }
        `,
        check: function (r) {
          var res = r.ps("1, 2, 3 | Get-Double");
          if (!res.ok) return "1, 2, 3 | Get-Double failed: " + res.errors[0];
          if (H.same(res.value, 6)) return "Only the last value was doubled: put the work in a process { } block.";
          if (!H.same(res.value, [2, 4, 6])) return "1, 2, 3 | Get-Double should return 2, 4, 6, got " + H.show(res.raw) + ".";
          return true;
        }
      },
      {
        id: "d3", title: "-WhatIf for deleting",
        text: "<p>Write <code>Remove-TempFile -Path</code> that deletes the file with <code>Remove-Item</code> and outputs <code>removed &lt;path&gt;</code>, but supports <code>-WhatIf</code>.</p>",
        files: { "temp.txt": "scratch\n", "keep.txt": "important\n" },
        starter: ps`
          function Remove-TempFile {

          }
        `,
        solution: ps`
          function Remove-TempFile {
              [CmdletBinding(SupportsShouldProcess)]
              param([string]$Path)
              if ($PSCmdlet.ShouldProcess($Path)) {
                  Remove-Item -Path $Path
                  "removed $Path"
              }
          }
        `,
        check: function (r) {
          var w = r.ps("Remove-TempFile -Path keep.txt -WhatIf");
          if (!/What if:/.test(w.text)) return "With -WhatIf it should print a What if: line. Use [CmdletBinding(SupportsShouldProcess)] and $PSCmdlet.ShouldProcess($Path).";
          if (r.file("keep.txt") === null) return "With -WhatIf, the file must not be deleted.";
          var d = r.ps("Remove-TempFile -Path temp.txt");
          if (!H.same(d.value, "removed temp.txt")) return "Remove-TempFile -Path temp.txt should output \"removed temp.txt\", got " + H.show(d.raw) + ".";
          return r.file("temp.txt") === null ? true : "Without -WhatIf, the file should really be deleted (Remove-Item).";
        }
      }
    ],

    "ps-110": [
      {
        id: "d1", title: "Lookup table from a CSV",
        text: "<p>Build <code>$byUser</code>: a hashtable from <code>data\\staff.csv</code> keyed by <code>Username</code> (each value is that row). Then set <code>$benDept</code> to ben's department.</p>",
        files: { "data/staff.csv": lines("Username,Department", "ana,Support", "ben,Engineering", "cara,IT") },
        starter: ps`
          $byUser = @{}
        `,
        solution: ps`
          $byUser = @{}
          foreach ($row in Import-Csv data\staff.csv) {
              $byUser[$row.Username] = $row
          }
          $benDept = $byUser["ben"].Department
        `,
        check: function (r) {
          var h = r.v("byUser");
          if (!(h instanceof window.PSEngine.PSHashtable) || h.size !== 3) return "$byUser should be a hashtable with 3 entries, one per row.";
          return H.expect(r, "benDept", "Engineering");
        }
      },
      {
        id: "d2", title: "Compare-Object",
        text: "<p>Set <code>$notOnServer</code> to the usernames that are in <code>$hrNames</code> but <b>not</b> in <code>$localNames</code>, using <code>Compare-Object</code> (look for <code>SideIndicator</code> <code>&lt;=</code>).</p>",
        starter: ps`
          $hrNames = @("ana", "ben", "cara", "dev")
          $localNames = @("ana", "cara", "mallory")
        `,
        solution: ps`
          $hrNames = @("ana", "ben", "cara", "dev")
          $localNames = @("ana", "cara", "mallory")
          $notOnServer = Compare-Object -ReferenceObject $hrNames -DifferenceObject $localNames |
              Where-Object SideIndicator -eq "<=" |
              Select-Object -ExpandProperty InputObject
        `,
        check: function (r) {
          var res = H.expect(r, "notOnServer", ["ben", "dev"], "array");
          if (res !== true) return res;
          return /Compare-Object/i.test(r.src) ? true : "Use Compare-Object.";
        }
      },
      {
        id: "d3", title: "Days since",
        text: "<p>Set <code>$daysSinceLeft</code> to the number of whole days from <code>$leftOn</code> to today (<code>Get-Date</code>).</p>",
        starter: ps`
          $leftOn = "2026-10-31"
        `,
        solution: ps`
          $leftOn = "2026-10-31"
          $daysSinceLeft = ((Get-Date) - [datetime]$leftOn).Days
        `,
        check: function (r) {
          var res = H.expect(r, "daysSinceLeft", 10, "number");
          if (res !== true) return res;
          return H.alt(r, '\\$leftOn\\s*=\\s*"[^"]*"', '$leftOn = "2026-11-01"', { daysSinceLeft: 9 }, "$leftOn = \"2026-11-01\"");
        }
      }
    ]
  };

  T.LABS.forEach(function (l) { if (DRILLS[l.id]) l.drills = DRILLS[l.id]; });
})();
