/* sudo learn — PowerShell Module 4 practice drills (3 per lab, +5 XP each). Loaded after labs-m4.js. */
(function () {
  "use strict";
  var T = window.PS_TRACK, H = window.PSLab.H, E = window.PSEngine, lib = E.lib, ps = T.ps, lines = T.lines, M = T.M4;
  var asList = M.asList, str = M.str, sha = M.sha;
  function same(a, b) { return H.same(a, b); }
  function has(r, name) { return r.v(name) !== undefined; }
  var RUN_FILES = { "scripts/Get-DiskReport.ps1": M.DISK_REPORT };
  var TOOL_SCRIPT = lines("param([string]$Server = 'fs-01')", "$password = 'Autumn#2026'", "\"Connecting to $Server as svc-tool\"");

  var DRILLS = {
    "ps-126": [
      {
        id: "d1", title: "A setting with a default",
        text: "<p>Set <code>$apiUrl</code> to <code>$env:KESTREL_API_URL</code> if it's set, otherwise to <code>https://api.kestrel.io</code>.</p>",
        starter: ps`
          # $apiUrl = ...
        `,
        solution: ps`
          $apiUrl = if ($env:KESTREL_API_URL) { $env:KESTREL_API_URL } else { 'https://api.kestrel.io' }
        `,
        check: function (r) {
          if (str(r.v("apiUrl")) !== "https://api.kestrel.io") return "With the variable unset, $apiUrl should be https://api.kestrel.io. It's " + H.show(r.v("apiUrl")) + ".";
          var r2 = r.run(r.src, { env: { KESTREL_API_URL: "https://staging.kestrel.io" } });
          return str(r2.v("apiUrl")) === "https://staging.kestrel.io" ? true : "With $env:KESTREL_API_URL set to https://staging.kestrel.io, $apiUrl should use it.";
        }
      },
      {
        id: "d2", title: "Show only the end",
        text: "<p>The line below prints the whole API token into the log. Change it to print <code>Using token ****7f3a</code>: four stars and only the last 4 characters.</p>",
        prelude: "Initialize-LabScenario api",
        starter: ps`
          Write-Output "Using token $env:KESTREL_API_TOKEN"
        `,
        solution: ps`
          $t = $env:KESTREL_API_TOKEN
          Write-Output "Using token ****$($t.Substring($t.Length - 4))"
        `,
        check: function (r) {
          if (r.allLines.some(function (l) { return /kc-lab-token/.test(l); })) return "The full token is still printed.";
          if (r.lines.indexOf("Using token ****7f3a") < 0) return "Print exactly: Using token ****7f3a (the last 4 characters of $env:KESTREL_API_TOKEN). Printed: " + H.show(r.lines);
          var r2 = r.run("$env:KESTREL_API_TOKEN = 'abcdef123456'\n" + r.src);
          return r2.lines.indexOf("Using token ****3456") >= 0 ? true : "Take the last 4 characters of the real token instead of typing 7f3a.";
        }
      },
      {
        id: "d3", title: "Ask for a credential",
        text: "<p>Use <code>Get-Credential</code> for the user <code>KESTREL\\ana.silva</code> (the password comes from the Input box). Store it in <code>$cred</code> and the password's <b>length</b> (not the password!) in <code>$pwLength</code>.</p>",
        stdin: "Summer2026!",
        starter: ps`
          # $cred = ...
        `,
        solution: ps`
          $cred = Get-Credential -UserName 'KESTREL\ana.silva'
          $pwLength = $cred.GetNetworkCredential().Password.Length
        `,
        check: function (r) {
          var c = r.v("cred");
          if (!c || c.typeName !== "System.Management.Automation.PSCredential") return "$cred should come from Get-Credential.";
          if (str(c.get("UserName")) !== "KESTREL\\ana.silva") return "Use -UserName 'KESTREL\\ana.silva'.";
          if (r.allLines.some(function (l) { return /Summer2026!/.test(l); })) return "The password was printed.";
          return r.v("pwLength") === 11 ? true : "$pwLength should be 11 (the typed password's length).";
        }
      }
    ],

    "ps-127": [
      {
        id: "d1", title: "Hash a string",
        text: "<p>Set <code>$hash</code> to the SHA256 of the text <code>kestrel</code> (UTF-8 bytes), as <b>lower-case</b> hex.</p>",
        starter: ps`
          # $hash = ...
        `,
        solution: ps`
          $bytes = [Text.Encoding]::UTF8.GetBytes('kestrel')
          $hash = [Convert]::ToHexString([System.Security.Cryptography.SHA256]::HashData($bytes)).ToLower()
        `,
        check: function (r) { return str(r.v("hash")) === sha("kestrel") ? true : "$hash should be " + sha("kestrel") + ". It's " + H.show(r.v("hash")) + "."; }
      },
      {
        id: "d2", title: "Same file, different name?",
        text: "<p>Set <code>$same</code> to <code>$true</code> if <code>a\\report.pdf</code> and <code>b\\final.pdf</code> have identical content, <code>$false</code> otherwise. Compare hashes.</p>",
        files: { "a/report.pdf": "%PDF quarterly report v3\n", "b/final.pdf": "%PDF quarterly report v3\n" },
        starter: ps`
          # $same = ...
        `,
        solution: ps`
          $same = (Get-FileHash .\a\report.pdf).Hash -eq (Get-FileHash .\b\final.pdf).Hash
        `,
        check: function (r) {
          if (r.v("same") !== true) return "$same should be $true: the contents are identical.";
          var r2 = r.run(r.src, { files: { "b/final.pdf": "%PDF quarterly report v4\n" } });
          return r2.v("same") === false ? true : "When the contents differ, $same should be $false.";
        }
      },
      {
        id: "d3", title: "Find duplicates",
        text: "<p>Set <code>$dupes</code> to the <b>names</b> (sorted) of the files under <code>photos</code> whose content also exists in another file there.</p>",
        files: { "photos/IMG_001.jpg": "jpeg-aaa\n", "photos/IMG_002.jpg": "jpeg-bbb\n", "photos/copy of IMG_001.jpg": "jpeg-aaa\n", "photos/2025/beach.jpg": "jpeg-ccc\n", "photos/2025/IMG_002 (1).jpg": "jpeg-bbb\n" },
        starter: ps`
          # $dupes = ...
        `,
        solution: ps`
          $dupes = Get-ChildItem .\photos -Recurse -File | Get-FileHash | Group-Object Hash |
              Where-Object Count -gt 1 | ForEach-Object { $_.Group.Path } | Split-Path -Leaf | Sort-Object
        `,
        check: function (r) {
          var want = ["copy of IMG_001.jpg", "IMG_001.jpg", "IMG_002 (1).jpg", "IMG_002.jpg"];
          var got = asList(r.v("dupes")).map(str);
          return same(got.map(function (s) { return s.toLowerCase(); }), want.map(function (s) { return s.toLowerCase(); }).sort()) ? true : "$dupes should be " + H.show(want) + " (sorted). Yours: " + H.show(got) + ".";
        }
      }
    ],

    "ps-128": [
      {
        id: "d1", title: "Handle a 404",
        text: "<p>Request <code>https://api.kestrel.io/v1/servers/web-99</code> (with the token). It doesn't exist: catch the error and set <code>$code</code> to the HTTP status code (a number).</p>",
        prelude: "Initialize-LabScenario api",
        starter: ps`
          $headers = @{ Authorization = "Bearer $env:KESTREL_API_TOKEN" }
          # $code = ...
        `,
        solution: ps`
          $headers = @{ Authorization = "Bearer $env:KESTREL_API_TOKEN" }
          try {
              Invoke-RestMethod https://api.kestrel.io/v1/servers/web-99 -Headers $headers
          }
          catch {
              $code = [int]$_.Exception.Response.StatusCode
          }
        `,
        check: function (r) {
          if (r.errors.length) return "The error reached the console: catch it with try/catch (or use -SkipHttpErrorCheck).";
          return r.v("code") === 404 ? true : "$code should be 404. It's " + H.show(r.v("code")) + ".";
        }
      },
      {
        id: "d2", title: "Let the server filter",
        text: "<p>Ask the API for only the <code>dev</code> servers by adding <code>?env=dev</code> to the URL, and set <code>$devNames</code> to their names, sorted.</p>",
        prelude: "Initialize-LabScenario api",
        starter: ps`
          $headers = @{ Authorization = "Bearer $env:KESTREL_API_TOKEN" }
          # $devNames = ...
        `,
        solution: ps`
          $headers = @{ Authorization = "Bearer $env:KESTREL_API_TOKEN" }
          $page = Invoke-RestMethod 'https://api.kestrel.io/v1/servers?env=dev' -Headers $headers
          $devNames = $page.items.name | Sort-Object
        `,
        check: function (r) {
          if (!same(asList(r.v("devNames")).map(str), ["build-01", "dev-db-01", "dev-web-01"])) return "$devNames should be build-01, dev-db-01, dev-web-01. Yours: " + H.show(H.plain(r.v("devNames"))) + ".";
          return r.system.api.requests.some(function (q) { return /env=dev/.test(q.path); }) ? true : "Let the API do the filtering: add ?env=dev to the URL.";
        }
      },
      {
        id: "d3", title: "Bearer, the PowerShell 7 way",
        text: "<p>Without building an Authorization header yourself, use <code>-Authentication Bearer -Token</code> (a SecureString made from <code>$env:KESTREL_API_TOKEN</code>) to get <code>/v1/tickets</code>. Set <code>$count</code> to how many tickets there are.</p>",
        prelude: "Initialize-LabScenario api",
        starter: ps`
          # $count = ...
        `,
        solution: ps`
          $token = ConvertTo-SecureString $env:KESTREL_API_TOKEN -AsPlainText -Force
          $count = @(Invoke-RestMethod https://api.kestrel.io/v1/tickets -Authentication Bearer -Token $token).Count
        `,
        check: function (r) {
          if (!/-Authentication\s+Bearer/i.test(r.src)) return "Use -Authentication Bearer -Token.";
          if (r.v("count") !== 0) return "$count should be 0 (no tickets yet). It's " + H.show(r.v("count")) + ".";
          var r2 = r.run(r.src, { system: function (sys) { sys.api.tickets.push({ id: "TCK-1", title: "x", priority: "low", status: "open" }, { id: "TCK-2", title: "y", priority: "low", status: "open" }); } });
          return r2.v("count") === 2 ? true : "With 2 tickets in the API, $count should be 2. Count the answer: @(...).Count.";
        }
      }
    ],

    "ps-129": [
      {
        id: "d1", title: "Who owns it?",
        text: "<p>Set <code>$owner</code> to the owner of <code>C:\\lab\\shares\\finance</code>.</p>",
        prelude: "Initialize-LabScenario permissions",
        starter: ps`
          # $owner = ...
        `,
        solution: ps`
          $owner = (Get-Acl C:\lab\shares\finance).Owner
        `,
        check: function (r) { return str(r.v("owner")) === "KC-WIN-01\\ed.moss" ? true : "$owner should be KC-WIN-01\\ed.moss. It's " + H.show(r.v("owner")) + "."; }
      },
      {
        id: "d2", title: "Grant read access",
        text: "<p>Give <code>KESTREL\\auditors</code> <code>ReadAndExecute</code> (Allow) on <code>C:\\lab\\shares\\finance</code>, keeping the existing rules.</p>",
        prelude: "Initialize-LabScenario permissions, admin",
        starter: ps`
          $path = 'C:\lab\shares\finance'
        `,
        solution: ps`
          $path = 'C:\lab\shares\finance'
          $acl = Get-Acl $path
          $rule = New-Object System.Security.AccessControl.FileSystemAccessRule('KESTREL\auditors', 'ReadAndExecute', 'Allow')
          $acl.AddAccessRule($rule)
          Set-Acl -Path $path -AclObject $acl
        `,
        check: function (r) {
          var a = lib.effectiveAcl(r.system, "C:\\lab\\shares\\finance").rules.map(function (x) { return x.id + " " + x.type + " " + x.rights; });
          if (a.indexOf("KESTREL\\auditors Allow ReadAndExecute, Synchronize") < 0) return "KESTREL\\auditors should be allowed ReadAndExecute (Set-Acl to save it). Rules now: " + H.show(a);
          return a.indexOf("Everyone Allow FullControl") >= 0 ? true : "Keep the existing rules: add, don't replace.";
        }
      },
      {
        id: "d3", title: "Count the admins",
        text: "<p>Set <code>$adminCount</code> to the number of members of the local Administrators group.</p>",
        starter: ps`
          # $adminCount = ...
        `,
        solution: ps`
          $adminCount = @(Get-LocalGroupMember -Group Administrators).Count
        `,
        check: function (r) {
          if (r.v("adminCount") !== 5) return "$adminCount should be 5. It's " + H.show(r.v("adminCount")) + ".";
          var r2 = r.run(r.src, { system: function (sys) { sys.groups.Administrators.push("ben.okoro"); } });
          return r2.v("adminCount") === 6 ? true : "With one more admin, $adminCount should be 6. Count the group instead of typing the number.";
        }
      }
    ],

    "ps-130": [
      {
        id: "d1", title: "Encode a command",
        text: "<p>Set <code>$enc</code> to the value <code>-EncodedCommand</code> expects for the command <code>Get-Process</code> (Base64 of its UTF-16LE bytes).</p>",
        starter: ps`
          # $enc = ...
        `,
        solution: ps`
          $enc = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes('Get-Process'))
        `,
        check: function (r) { return str(r.v("enc")) === "RwBlAHQALQBQAHIAbwBjAGUAcwBzAA==" ? true : "$enc should be RwBlAHQALQBQAHIAbwBjAGUAcwBzAA== (use [Text.Encoding]::Unicode, not UTF8). It's " + H.show(r.v("enc")) + "."; }
      },
      {
        id: "d2", title: "AMSI says no",
        text: "<p><code>samples\\stage2.ps1</code> is a (fake) malware sample. Try to run it inside <code>try/catch</code>: set <code>$blocked</code> to <code>$true</code> if it was blocked, and <code>$reason</code> to the error message.</p>",
        files: { "samples/stage2.ps1": lines("# lab sample: the simulated antivirus knows this one", "Invoke-KestrelStealer -Target lsass") },
        starter: ps`
          $blocked = $false
        `,
        solution: ps`
          $blocked = $false
          try {
              .\samples\stage2.ps1
          }
          catch {
              $blocked = $true
              $reason = $_.Exception.Message
          }
        `,
        check: function (r) {
          if (r.v("blocked") !== true) return "$blocked should be $true: running the sample throws an error (catch it).";
          return /malicious content/.test(str(r.v("reason"))) ? true : "$reason should be the error message (it mentions malicious content).";
        }
      },
      {
        id: "d3", title: "When did the cradle run?",
        text: "<p>In the PowerShell Operational log, find the 4104 events whose code contains <code>DownloadString</code>. Set <code>$times</code> to their times as <code>HH:mm:ss</code>.</p>",
        prelude: "Initialize-LabScenario incident",
        starter: ps`
          # $times = ...
        `,
        solution: ps`
          $times = Get-WinEvent -FilterHashtable @{ LogName = 'Microsoft-Windows-PowerShell/Operational'; Id = 4104 } |
              Where-Object { $_.Properties[2].Value -match 'DownloadString' } |
              ForEach-Object { $_.TimeCreated.ToString('HH:mm:ss') }
        `,
        check: function (r) { return same(asList(r.v("times")).map(str), ["02:26:30"]) ? true : "$times should be 02:26:30. Yours: " + H.show(H.plain(r.v("times"))) + "."; }
      }
    ],

    "ps-131": [
      {
        id: "d1", title: "Just for this window",
        text: "<p>Allow scripts for <b>this PowerShell session only</b> (scope Process, policy Bypass), without touching any other scope. Set <code>$now</code> to the effective policy afterwards.</p>",
        starter: ps`
          # Set-ExecutionPolicy ...
        `,
        solution: ps`
          Set-ExecutionPolicy -ExecutionPolicy Bypass -Scope Process -Force
          $now = Get-ExecutionPolicy
        `,
        check: function (r) {
          if (r.session.processPolicy !== "Bypass") return "Set the Process scope to Bypass.";
          if (r.system.policy.CurrentUser !== "Undefined" || r.system.policy.LocalMachine !== "RemoteSigned") return "Only the Process scope should change.";
          return str(r.v("now")) === "Bypass" ? true : "$now should be Bypass.";
        }
      },
      {
        id: "d2", title: "From the internet?",
        text: "<p>Set <code>$fromInternet</code> to the names (sorted) of the files in <code>downloads</code> that carry a <code>Zone.Identifier</code> stream.</p>",
        files: { "downloads/setup.ps1": { content: "'setup'\n", zone: 3, from: "https://example.com/setup.ps1" }, "downloads/notes.txt": "mine\n", "downloads/tool.zip": { content: "zip\n", zone: 3 } },
        starter: ps`
          # $fromInternet = ...
        `,
        solution: ps`
          $fromInternet = Get-ChildItem .\downloads -File |
              Where-Object { Get-Item $_.FullName -Stream Zone.Identifier -ErrorAction SilentlyContinue } |
              Select-Object -ExpandProperty Name | Sort-Object
        `,
        check: function (r) { return same(asList(r.v("fromInternet")).map(str), ["setup.ps1", "tool.zip"]) ? true : "$fromInternet should be setup.ps1 and tool.zip. Yours: " + H.show(H.plain(r.v("fromInternet"))) + "."; }
      },
      {
        id: "d3", title: "Catch the tamper",
        text: "<p>Sign <code>scripts\\deploy.ps1</code> with the code-signing certificate, then append the line <code>'one more thing'</code> to it. Set <code>$status</code> to its signature status afterwards.</p>",
        files: { "scripts/deploy.ps1": "'Deploying'\n" },
        starter: ps`
          # sign, edit, check
        `,
        solution: ps`
          $cert = Get-ChildItem Cert:\CurrentUser\My -CodeSigningCert
          Set-AuthenticodeSignature .\scripts\deploy.ps1 -Certificate $cert | Out-Null
          Add-Content .\scripts\deploy.ps1 "'one more thing'"
          $status = (Get-AuthenticodeSignature .\scripts\deploy.ps1).Status
        `,
        check: function (r) {
          if (!/# SIG # Begin signature block/.test(r.file("scripts\\deploy.ps1") || "")) return "Sign the file first (Set-AuthenticodeSignature).";
          return str(r.v("status")) === "HashMismatch" ? true : "$status should be HashMismatch: the file changed after signing. It's " + H.show(r.v("status")) + ".";
        }
      }
    ],

    "ps-132": [
      {
        id: "d1", title: "A desktop shortcut",
        text: "<p>Create <code>$HOME\\Desktop\\Disk report.lnk</code> that starts <code>pwsh.exe</code> with <code>-NoProfile -File \"C:\\lab\\scripts\\Get-DiskReport.ps1\"</code>. Use the <code>WScript.Shell</code> COM object.</p>",
        files: RUN_FILES,
        starter: ps`
          $shell = New-Object -ComObject WScript.Shell
        `,
        solution: ps`
          $shell = New-Object -ComObject WScript.Shell
          $lnk = $shell.CreateShortcut("$HOME\Desktop\Disk report.lnk")
          $lnk.TargetPath = 'pwsh.exe'
          $lnk.Arguments = '-NoProfile -File "C:\lab\scripts\Get-DiskReport.ps1"'
          $lnk.Save()
        `,
        check: function (r) {
          if (r.file("C:\\Users\\dev\\Desktop\\Disk report.lnk") === null) return "The shortcut file doesn't exist. Did you call .Save()?";
          var res = r.ps("Invoke-Item \"$HOME\\Desktop\\Disk report.lnk\"");
          return r.session.parts.some(function (p) { return /^C: 18\.4 GB free/.test(p.text); }) ? true : "Double-clicking the shortcut didn't run the report. Target pwsh.exe, arguments -NoProfile -File \"C:\\lab\\scripts\\Get-DiskReport.ps1\". " + (res.errors[0] || "");
        }
      },
      {
        id: "d2", title: "Exit codes from -Command",
        text: "<p>Run each line as a separate <code>pwsh -NoProfile -Command</code> process and record its exit code: <code>$bad</code> for <code>Get-Service NoSuchService</code> and <code>$good</code> for <code>Get-Service W3SVC | Out-Null</code>.</p>",
        starter: ps`
          # pwsh -NoProfile -Command "..."
        `,
        solution: ps`
          pwsh -NoProfile -Command "Get-Service NoSuchService"
          $bad = $LASTEXITCODE
          pwsh -NoProfile -Command "Get-Service W3SVC | Out-Null"
          $good = $LASTEXITCODE
        `,
        check: function (r) {
          if (r.v("bad") !== 1) return "$bad should be 1 (the command failed). It's " + H.show(r.v("bad")) + ".";
          return r.v("good") === 0 ? true : "$good should be 0. It's " + H.show(r.v("good")) + ".";
        }
      },
      {
        id: "d3", title: "Start, wait, read the result",
        text: "<p>Use <code>Start-Process</code> to run <code>pwsh -NoProfile -File C:\\lab\\scripts\\Get-DiskReport.ps1 -MinFreeGB 50</code> in this window, wait for it, and set <code>$exit</code> to its exit code (use <code>-PassThru</code>).</p>",
        files: RUN_FILES,
        starter: ps`
          # $p = Start-Process ...
        `,
        solution: ps`
          $p = Start-Process pwsh -ArgumentList '-NoProfile', '-File', 'C:\lab\scripts\Get-DiskReport.ps1', '-MinFreeGB', '50' -NoNewWindow -Wait -PassThru
          $exit = $p.ExitCode
        `,
        check: function (r) {
          if (!/Start-Process/i.test(r.src)) return "Use Start-Process.";
          return r.v("exit") === 1 ? true : "$exit should be 1 ($p.ExitCode). It's " + H.show(r.v("exit")) + ".";
        }
      }
    ],

    "ps-133": [
      {
        id: "d1", title: "A module with a manifest",
        text: "<p>The starter writes <code>Greeter.psm1</code>. Add a manifest <code>Greeter.psd1</code> next to it with <code>RootModule</code> Greeter.psm1, <code>ModuleVersion</code> 1.2.0 and only <code>Get-Greeting</code> exported. Then <code>Import-Module Greeter</code> and set <code>$version</code> to its version.</p>",
        starter: ps`
          $dir = "$HOME\Documents\PowerShell\Modules\Greeter"
          New-Item -ItemType Directory -Path $dir -Force | Out-Null
          Set-Content "$dir\Greeter.psm1" 'function Get-Greeting { param($Name) Format-Name $Name }', 'function Format-Name { param($n) "Hello, $n!" }'
        `,
        solution: ps`
          $dir = "$HOME\Documents\PowerShell\Modules\Greeter"
          New-Item -ItemType Directory -Path $dir -Force | Out-Null
          Set-Content "$dir\Greeter.psm1" 'function Get-Greeting { param($Name) Format-Name $Name }', 'function Format-Name { param($n) "Hello, $n!" }'
          New-ModuleManifest -Path "$dir\Greeter.psd1" -RootModule Greeter.psm1 -ModuleVersion 1.2.0 -FunctionsToExport Get-Greeting
          Import-Module Greeter
          $version = (Get-Module Greeter).Version
        `,
        check: function (r) {
          if (str(r.v("version")) !== "1.2.0") return "$version should be 1.2.0 (from the manifest). It's " + H.show(r.v("version")) + ".";
          var a = r.ps("Get-Greeting Ana");
          if (str(a.value) !== "Hello, Ana!") return "Get-Greeting should work after Import-Module.";
          var b = r.ps("Format-Name x");
          return b.errors.length ? true : "Format-Name should stay private (FunctionsToExport Get-Greeting only).";
        }
      },
      {
        id: "d2", title: "Look inside the .exe",
        text: "<p>Someone \"protected\" a script by turning it into <code>dist\\tool.exe</code>. Extract the script to <code>dist\\tool.ps1</code> and set <code>$leaked</code> to the password written in it.</p>",
        files: { "dist/tool.exe": lib.makeExe({ script: TOOL_SCRIPT, noConsole: false, requireAdmin: false, title: "Tool", version: "1.0.0.0", company: "" }) },
        starter: ps`
          # .\dist\tool.exe -extract:...
        `,
        solution: ps`
          .\dist\tool.exe -extract:.\dist\tool.ps1
          $line = Select-String -Path .\dist\tool.ps1 -Pattern '\$password\s*=' | Select-Object -First 1
          if ($line.Line -match "'([^']+)'") { $leaked = $Matches[1] }
        `,
        check: function (r) {
          if (r.file("dist\\tool.ps1") === null) return "Extract it first: .\\dist\\tool.exe -extract:.\\dist\\tool.ps1";
          return str(r.v("leaked")) === "Autumn#2026" ? true : "$leaked should be the password found in the extracted script. It's " + H.show(r.v("leaked")) + ".";
        }
      },
      {
        id: "d3", title: "Fix the broken task",
        text: "<p>The starter registers a task that tries to run a .ps1 directly, so it fails every night (result 2147942593). Re-register it (same name, <code>-Force</code>) to start <code>pwsh.exe -NoProfile -File \"C:\\lab\\scripts\\cleanup.ps1\"</code>, run it, and set <code>$result</code> to its LastTaskResult.</p>",
        files: { "scripts/cleanup.ps1": "Remove-Item C:\\lab\\temp\\*.tmp\n", "temp/a.tmp": "x\n", "temp/b.tmp": "x\n" },
        starter: ps`
          $broken = New-ScheduledTaskAction -Execute 'C:\lab\scripts\cleanup.ps1'
          Register-ScheduledTask -TaskName 'Nightly cleanup' -Action $broken -Trigger (New-ScheduledTaskTrigger -Daily -At 2am) | Out-Null
          Start-ScheduledTask -TaskName 'Nightly cleanup'
          (Get-ScheduledTaskInfo -TaskName 'Nightly cleanup').LastTaskResult

          # fix it:
        `,
        solution: ps`
          $broken = New-ScheduledTaskAction -Execute 'C:\lab\scripts\cleanup.ps1'
          Register-ScheduledTask -TaskName 'Nightly cleanup' -Action $broken -Trigger (New-ScheduledTaskTrigger -Daily -At 2am) | Out-Null
          Start-ScheduledTask -TaskName 'Nightly cleanup'
          (Get-ScheduledTaskInfo -TaskName 'Nightly cleanup').LastTaskResult

          $action = New-ScheduledTaskAction -Execute 'pwsh.exe' -Argument '-NoProfile -File "C:\lab\scripts\cleanup.ps1"'
          Register-ScheduledTask -TaskName 'Nightly cleanup' -Action $action -Trigger (New-ScheduledTaskTrigger -Daily -At 2am) -Force | Out-Null
          Start-ScheduledTask -TaskName 'Nightly cleanup'
          $result = (Get-ScheduledTaskInfo -TaskName 'Nightly cleanup').LastTaskResult
        `,
        check: function (r) {
          if (r.v("result") !== 0) return "$result should be 0 after the fixed task runs. It's " + H.show(r.v("result")) + ".";
          return r.file("temp\\a.tmp") === null ? true : "The task reported success but the .tmp files are still there.";
        }
      }
    ],

    "ps-134": [
      {
        id: "d1", title: "Your first test",
        text: "<p>Write a <code>Describe</code> with at least one <code>It</code> that checks <code>Add-Numbers 2 3</code> returns 5.</p>",
        starter: ps`
          function Add-Numbers { param($a, $b) $a + $b }

          # Describe ...
        `,
        solution: ps`
          function Add-Numbers { param($a, $b) $a + $b }

          Describe "Add-Numbers" {
              It "adds two numbers" {
                  Add-Numbers 2 3 | Should -Be 5
              }
          }
        `,
        check: function (r) {
          var runs = r.system.pesterRuns || [];
          if (!runs.length) return "No tests ran. Write Describe { It { ... | Should -Be 5 } }.";
          if (runs.some(function (x) { return x.failed; })) return "Your test fails on the correct function.";
          var r2 = r.run(r.src.replace("$a + $b", "$a * $b"));
          return (r2.system.pesterRuns || []).some(function (x) { return x.failed; }) ? true : "When I broke Add-Numbers (multiplying), your test still passed.";
        }
      },
      {
        id: "d2", title: "Test that it throws",
        text: "<p>Write a test that checks <code>Get-Config -Path missing.json</code> throws an error whose message starts with <code>Config not found</code>.</p>",
        starter: ps`
          function Get-Config {
              param([string]$Path)
              if (-not (Test-Path $Path)) { throw "Config not found: $Path" }
              Get-Content $Path -Raw | ConvertFrom-Json
          }

          # Describe ...
        `,
        solution: ps`
          function Get-Config {
              param([string]$Path)
              if (-not (Test-Path $Path)) { throw "Config not found: $Path" }
              Get-Content $Path -Raw | ConvertFrom-Json
          }

          Describe "Get-Config" {
              It "throws for a missing file" {
                  { Get-Config -Path missing.json } | Should -Throw "Config not found*"
              }
          }
        `,
        check: function (r) {
          var runs = r.system.pesterRuns || [];
          if (!runs.length || runs.some(function (x) { return x.failed; }) || !runs.some(function (x) { return x.passed; })) return "Write a passing test: { Get-Config -Path missing.json } | Should -Throw \"Config not found*\"";
          var r2 = r.run(r.src.replace('throw "Config not found: $Path"', "return $null"));
          return (r2.system.pesterRuns || []).some(function (x) { return x.failed; }) ? true : "When Get-Config stopped throwing, your test still passed.";
        }
      },
      {
        id: "d3", title: "Make the linter happy",
        text: "<p>Edit the code inside <code>$code</code> so that <code>Invoke-ScriptAnalyzer -ScriptDefinition $code</code> reports nothing, while it still lists the <code>.log</code> files and outputs their names.</p>",
        starter: ps`
          $code = @'
          gci C:\lab\logs -Filter *.log | % { Write-Host $_.Name }
          '@
          $findings = Invoke-ScriptAnalyzer -ScriptDefinition $code
          $findings | Select-Object RuleName, Line
        `,
        solution: ps`
          $code = @'
          Get-ChildItem C:\lab\logs -Filter *.log | ForEach-Object { Write-Output $_.Name }
          '@
          $findings = Invoke-ScriptAnalyzer -ScriptDefinition $code
          $findings | Select-Object RuleName, Line
        `,
        check: function (r) {
          var code = str(r.v("code"));
          if (!/Get-ChildItem/i.test(code) || !/\.log/.test(code)) return "Keep the code listing the .log files (with Get-ChildItem).";
          var f = lib.analyze(new E.Ctx(r.session, r.session.global), code, "");
          return f.length ? "The analyzer still reports: " + f.map(function (d) { return d.get("RuleName"); }).join(", ") : true;
        }
      }
    ],

    "ps-135": [
      {
        id: "d1", title: "Exit with a reason",
        text: "<p>If <code>config\\app.json</code> doesn't exist, write an error and <b>exit with code 3</b>. Otherwise print <code>Config OK</code> (exit code 0).</p>",
        starter: ps`
          # check config\app.json
        `,
        solution: ps`
          if (-not (Test-Path .\config\app.json)) {
              Write-Error 'config\app.json is missing'
              exit 3
          }
          'Config OK'
        `,
        check: function (r) {
          if (r.exit !== 3) return "Without config\\app.json the script should exit 3. It exited " + r.exit + ".";
          var r2 = r.run(r.src, { files: { "config/app.json": "{}\n" } });
          return r2.exit === 0 && r2.lines.indexOf("Config OK") >= 0 ? true : "With the file present, print Config OK and exit 0.";
        }
      },
      {
        id: "d2", title: "A notice annotation",
        text: "<p>Print a GitHub notice for the C: drive: <code>::notice title=Disk C::18.4 GB free</code> (the real free space, rounded to 1 decimal).</p>",
        starter: ps`
          $c = Get-CimInstance Win32_LogicalDisk -Filter "DeviceID = 'C:'"
        `,
        solution: ps`
          $c = Get-CimInstance Win32_LogicalDisk -Filter "DeviceID = 'C:'"
          "::notice title=Disk C::$([math]::Round($c.FreeSpace / 1GB, 1)) GB free"
        `,
        check: function (r) {
          if (r.lines.indexOf("::notice title=Disk C::18.4 GB free") < 0) return "Print exactly ::notice title=Disk C::18.4 GB free. Printed: " + H.show(r.lines);
          var r2 = r.run(r.src, { system: function (sys) { sys.disks[0].FreeSpace = 42.06 * 1073741824; } });
          return r2.lines.indexOf("::notice title=Disk C::42.1 GB free") >= 0 ? true : "Use the real free space, not 18.4 typed in.";
        }
      },
      {
        id: "d3", title: "Write the workflow",
        text: "<p>Create <code>.github\\workflows\\ci.yml</code>: a job on <code>windows-latest</code> with a step <code>uses: actions/checkout@v4</code> and a step with <code>shell: pwsh</code> that runs <code>./build.ps1</code>.</p>",
        starter: ps`
          $yaml = @'
          name: ci
          on: [push]
          '@
          New-Item -ItemType Directory -Path .\.github\workflows -Force | Out-Null
          Set-Content -Path .\.github\workflows\ci.yml -Value $yaml
        `,
        solution: ps`
          $yaml = @'
          name: ci
          on: [push]
          jobs:
            build:
              runs-on: windows-latest
              steps:
                - uses: actions/checkout@v4
                - name: Build
                  shell: pwsh
                  run: ./build.ps1
          '@
          New-Item -ItemType Directory -Path .\.github\workflows -Force | Out-Null
          Set-Content -Path .\.github\workflows\ci.yml -Value $yaml
        `,
        check: function (r) {
          var y = r.file(".github\\workflows\\ci.yml");
          if (y === null) return "Write .github\\workflows\\ci.yml.";
          var need = [[/^\s*runs-on:\s*windows-latest\s*$/m, "runs-on: windows-latest"], [/^\s*-\s*uses:\s*actions\/checkout@v4\s*$/m, "- uses: actions/checkout@v4"], [/^\s*shell:\s*pwsh\s*$/m, "shell: pwsh"], [/^\s*run:\s*\.\/build\.ps1\s*$/m, "run: ./build.ps1"], [/^jobs:\s*$/m, "jobs:"]];
          var miss = need.filter(function (n) { return !n[0].test(y); }).map(function (n) { return n[1]; });
          return miss.length ? "The workflow is missing: " + miss.join(", ") : true;
        }
      }
    ],

    "ps-136": [
      {
        id: "d1", title: "Parse a service path",
        text: "<p>Write <code>Get-ServiceExe -PathName</code> that returns the program path from a service's PathName, quoted or not, without the arguments.</p>",
        starter: ps`
          function Get-ServiceExe {

          }
        `,
        solution: ps`
          function Get-ServiceExe {
              param([string]$PathName)
              if ($PathName -match '^"?([^"]+?\.exe)') { $Matches[1] }
          }
        `,
        check: function (r) {
          if (!r.fn("Get-ServiceExe")) return "I can't find a function called Get-ServiceExe.";
          var cases = [["\"C:\\Program Files\\Kestrel\\kestrel-agent.exe\" --service", "C:\\Program Files\\Kestrel\\kestrel-agent.exe"], ["C:\\Program Files\\Kestrel\\Updater\\kupdate.exe --service", "C:\\Program Files\\Kestrel\\Updater\\kupdate.exe"], ["C:\\Windows\\system32\\svchost.exe -k netsvcs -p", "C:\\Windows\\system32\\svchost.exe"], ["C:\\Windows\\System32\\spoolsv.exe", "C:\\Windows\\System32\\spoolsv.exe"]];
          for (var i = 0; i < cases.length; i++) {
            var res = r.ps("Get-ServiceExe -PathName '" + cases[i][0].replace(/'/g, "''") + "'");
            if (str(res.value) !== cases[i][1]) return "For " + cases[i][0] + " expected " + cases[i][1] + ", got " + H.show(res.raw) + ".";
          }
          return true;
        }
      },
      {
        id: "d2", title: "A result helper",
        text: "<p>Write <code>New-Result -Check -Pass -Detail</code> returning an object with <code>Check</code>, <code>Status</code> (<code>Pass</code> when <code>-Pass</code> is <code>$true</code>, else <code>Fail</code>) and <code>Detail</code>.</p>",
        starter: ps`
          function New-Result {

          }
        `,
        solution: ps`
          function New-Result {
              param([string]$Check, [bool]$Pass, [string]$Detail = '')
              [PSCustomObject]@{ Check = $Check; Status = if ($Pass) { 'Pass' } else { 'Fail' }; Detail = $Detail }
          }
        `,
        check: function (r) {
          if (!r.fn("New-Result")) return "I can't find a function called New-Result.";
          var a = r.ps("New-Result -Check 'Guest disabled' -Pass $true -Detail 'ok'").value;
          var b = r.ps("New-Result -Check 'RDP' -Pass $false -Detail 'UserAuthentication = 0'").value;
          if (!a || a.Status !== "Pass" || a.Check !== "Guest disabled" || a.Detail !== "ok") return "New-Result -Check 'Guest disabled' -Pass $true -Detail 'ok' should give Check 'Guest disabled', Status Pass, Detail ok. Got " + H.show(a) + ".";
          return b && b.Status === "Fail" && b.Detail === "UserAuthentication = 0" ? true : "With -Pass $false, Status should be Fail. Got " + H.show(b) + ".";
        }
      },
      {
        id: "d3", title: "Turn NLA back on",
        text: "<p>After the incident, RDP no longer requires Network Level Authentication. Set <code>UserAuthentication</code> to <code>1</code> under <code>HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Terminal Server\\WinStations\\RDP-Tcp</code> and set <code>$nla</code> to the value read back.</p>",
        prelude: "Initialize-LabScenario incident, admin",
        starter: ps`
          $key = 'HKLM:\SYSTEM\CurrentControlSet\Control\Terminal Server\WinStations\RDP-Tcp'
        `,
        solution: ps`
          $key = 'HKLM:\SYSTEM\CurrentControlSet\Control\Terminal Server\WinStations\RDP-Tcp'
          Set-ItemProperty -Path $key -Name UserAuthentication -Value 1
          $nla = (Get-ItemProperty -Path $key).UserAuthentication
        `,
        check: function (r) {
          var k = lib.reg.find(r.system, "HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Terminal Server\\WinStations\\RDP-Tcp");
          var v = k && k.values.filter(function (x) { return /^userauthentication$/i.test(x.name); })[0];
          if (!v || E.toNumber(v.value) !== 1) return "UserAuthentication is still not 1.";
          return r.v("nla") === 1 ? true : "$nla should be 1 (read it back with Get-ItemProperty).";
        }
      }
    ]
  };
  T.LABS.forEach(function (l) { if (DRILLS[l.id]) l.drills = DRILLS[l.id]; });
})();
