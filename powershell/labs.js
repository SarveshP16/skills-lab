/* sudo learn — PowerShell track: modules, labs and roadmap.
   Lab format matches the Python track; checks are JavaScript functions check(r) using the run context
   from ps-lab.js (r.v / r.p / r.ps / r.run / r.lines ...) and the helpers H = PSLab.H.
   Code samples use the ps`` tag: String.raw + dedent. Inside it, write $\{ for PowerShell's ${ and \` for a backtick. */
(function () {
  "use strict";
  var H = window.PSLab.H;

  function ps(strings) {
    var vals = Array.prototype.slice.call(arguments, 1);
    var raw = String.raw.apply(null, [strings].concat(vals)).replace(/^\n/, "").replace(/\s+$/, "");
    raw = raw.replace(/\$\\\{/g, "${").replace(/\\`/g, "`");
    var lines = raw.split("\n"), ind = Infinity;
    lines.forEach(function (l) { if (l.trim()) ind = Math.min(ind, l.match(/^ */)[0].length); });
    if (!isFinite(ind)) ind = 0;
    return lines.map(function (l) { return l.slice(ind); }).join("\n");
  }
  function esc(s) { return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
  function ex(code) { return '<pre class="ex">' + esc(code) + "</pre>"; }
  function lines() { return Array.prototype.slice.call(arguments).join("\n") + "\n"; }
  function srcHas(r, re, msg) { return re.test(r.src.replace(/#.*$/gm, "")) ? true : msg; }

  var MODULES = [
    { n: 1, name: "Foundations" },
    { n: 2, name: "Files, data & the Windows system" },
    { n: 3, name: "Building tools with a GUI" },
    { n: 4, name: "Security & DevSecOps" }
  ];
  var DANA = "Dana Park · Windows team", DEV = "Dev Patel · Security", MAYA = "Maya Chen · SRE lead";

  var LABS = [];

  /* ================================================================== PS-101 */
  LABS.push({
    id: "ps-101", n: 1, module: 1, ticket: "PS-101", xp: 100,
    title: "Find your way around",
    topic: "Cmdlets, Get-Command, Get-Help, Get-Member",
    from: DANA,
    story: "<p>Welcome to the Windows team! Half of Kestrel's servers run Windows, and we run them with PowerShell. Nobody memorises its thousands of commands. What you learn instead is how to <b>find</b> the right one and work out what it gives you.</p>" +
      "<p>Before I hand you anything real, show me you can find your way around with the three discovery commands.</p>",
    learn:
      '<div class="callout"><b>How this lab runs.</b> You\'re typing into a <b>simulated PowerShell 7</b> on a pretend Windows server, <code>KC-WIN-01</code>. It runs the parts of PowerShell these labs use, and its services, processes and users are made up for the story. At the end of each ticket, <b>Try it for real</b> gives a safe command for the real PowerShell on your own PC.</div>' +
      "<h3>Cmdlets: Verb-Noun</h3><p>PowerShell commands are called <b>cmdlets</b>, and their names follow one pattern: an approved <b>verb</b>, a dash, and a <b>noun</b>. Once you know it you can often guess a command: to get services, <code>Get-Service</code>; to stop a process, <code>Stop-Process</code>.</p>" +
      ex("Get-Service") +
      "<p>Names are <b>not case-sensitive</b>: <code>get-service</code> works too. Press Run or ▶ try on any example to see it.</p>" +
      "<h3>1. Get-Command: find commands</h3>" +
      ex("Get-Command -Noun Service\nGet-Command -Verb Stop\nGet-Command *process*") +
      "<p><code>*</code> is a <b>wildcard</b>: any characters. Most PowerShell parameters that take names accept wildcards.</p>" +
      "<h3>2. Get-Help: learn a command</h3>" +
      ex("Get-Help Get-Service\nGet-Help Get-Service -Examples") +
      "<p>The <b>SYNTAX</b> section lists every parameter. <code>[-Name]</code> in square brackets means you can leave out the parameter name and just give the value in that position.</p>" +
      "<h3>3. Get-Member: see what you got back</h3><p>This is the big one. PowerShell commands don't return text, they return <b>objects</b>: structured things with named <b>properties</b> (data) and <b>methods</b> (actions). Pipe anything into <code>Get-Member</code> to see its type and members:</p>" +
      ex("Get-Service | Get-Member") +
      "<p>To get just one part of a result, put the command in parentheses and add <code>.Property</code>. If there are many objects, you get that property from each one:</p>" +
      ex("(Get-Service).Count\n(Get-Command -Noun Service).Name") +
      "<h3>Aliases</h3><p>Some commands have short <b>aliases</b>, often borrowed from Linux or cmd.exe: <code>ls</code>, <code>dir</code>, <code>cat</code>. They're handy at the prompt, but write the full name in scripts so others can read them.</p>" +
      ex("Get-Alias dir\n(Get-Alias gsv).Definition") +
      "<h3>Variables</h3><p>Save any result in a variable that starts with <code>$</code>. The tasks check your variables after you press Run.</p>" +
      ex('$count = (Get-Service).Count\n"There are $count services"'),
    starter: ps`
      # PS-101 · Find your way around
      # Run each discovery command here or in the console below, then store your answers.

      # 1) $serviceCmds: the names of all commands whose noun is Service


      # 2) $param: the name of the Get-Service parameter that finds services by their
      #    long friendly name (look at Get-Help Get-Service)


      # 3) $props: the names of the Property members of a service object (Get-Member)


      # 4) $lsReal: the name of the command that the alias ls runs
    `,
    objectives: [
      {
        id: "command",
        text: "<code>$serviceCmds</code> holds the names of every command whose noun is <code>Service</code>, using <code>Get-Command</code>.",
        hints: ["Get-Command -Noun Service gives the commands. Wrap it in parentheses and add .Name to get just their names.", "$serviceCmds = (Get-Command -Noun Service).Name"],
        check: function (r) {
          var want = ["Get-Service", "Restart-Service", "Set-Service", "Start-Service", "Stop-Service"];
          var res = H.expect(r, "serviceCmds", want, "array");
          if (res !== true) {
            var v = r.p("serviceCmds");
            if (Array.isArray(v) && v.length && typeof v[0] === "object") return "$serviceCmds holds command objects. Add .Name to keep only their names: (Get-Command -Noun Service).Name";
            return res;
          }
          return srcHas(r, /Get-Command/i, "Use Get-Command to find them, so the list stays right when new commands appear.");
        }
      },
      {
        id: "help",
        text: "<code>$param</code> is the name (without the dash) of the <code>Get-Service</code> parameter that finds services by their long friendly name.",
        hints: ["Run Get-Help Get-Service and read the SYNTAX line, or Get-Help Get-Service -Parameter * for the details.", '$param = "DisplayName"'],
        check: function (r) {
          var v = r.v("param");
          if (v === undefined) return "I can't find a variable called $param yet.";
          if (typeof v !== "string") return "$param should be the parameter's name as text, like \"Name\".";
          var t = v.replace(/^-/, "").toLowerCase();
          if (t === "name") return "-Name matches the short service name (like W3SVC). Which parameter matches the long friendly name, like \"World Wide Web Publishing Service\"?";
          if (t !== "displayname") return "$param is \"" + v + "\". Look at Get-Help Get-Service again: which parameter matches the friendly name?";
          return true;
        }
      },
      {
        id: "member",
        text: "<code>$props</code> holds the names of the <b>Property</b> members of a service object, using <code>Get-Member -MemberType Property</code>.",
        hints: ["Get-Service | Get-Member -MemberType Property lists them. Parentheses + .Name gives just the names.", "$props = (Get-Service | Get-Member -MemberType Property).Name"],
        check: function (r) {
          var res = H.expect(r, "props", ["CanStop", "DisplayName", "MachineName", "Name", "ServiceName", "StartType", "Status"], "array");
          if (res !== true) return res;
          return srcHas(r, /Get-Member|\bgm\b/i, "Use Get-Member to find the properties.");
        }
      },
      {
        id: "alias",
        text: "<code>$lsReal</code> is the name of the command that the alias <code>ls</code> runs, found with <code>Get-Alias</code>.",
        hints: ["Get-Alias ls shows it; the Definition property holds the real command's name.", "$lsReal = (Get-Alias ls).Definition"],
        check: function (r) {
          var res = H.expect(r, "lsReal", "Get-ChildItem", "string");
          if (res !== true) return res;
          return srcHas(r, /Get-Alias|\bgal\b/i, "Use Get-Alias to look it up.");
        }
      }
    ],
    debrief: "<p>Ticket closed. Those three commands are how experienced people use PowerShell every day: <b>Get-Command</b> to find a command, <b>Get-Help</b> to learn it, <b>Get-Member</b> to see what it returns.</p>" +
      "<p>The most important idea came from Get-Member: commands return <b>objects</b> with properties, not lines of text. The rest of this module builds on that.</p>",
    realworld: "Open PowerShell on your PC (Start menu, type pwsh or PowerShell) and run Get-Command -Noun Service, then Get-Service | Get-Member. On a real system, run Update-Help once (as administrator) to download the full help files.",
    quiz: [
      { q: "You want to stop a service but don't know the command. Best first step?", options: ["Search the web", "Get-Command -Noun Service", "Get-Help *", "Guess stop-svc"], answer: 1,
        why: "Commands follow Verb-Noun, so listing the Service commands shows Stop-Service right away." },
      { q: "What does <code>Get-Member</code> show?", options: ["The members of a group", "An object's type, properties and methods", "Logged-in users", "Command help"], answer: 1,
        why: "It's how you discover what data a command's objects carry." },
      { q: "Should you use aliases like <code>ls</code> in scripts?", options: ["Yes, they're shorter", "Better to write the full name (Get-ChildItem) so scripts are readable", "Aliases don't work in scripts", "Only on Linux"], answer: 1,
        why: "Aliases are for typing at the prompt. Full names make scripts clear to everyone." }
    ]
  });

  /* ================================================================== PS-102 */
  LABS.push({
    id: "ps-102", n: 2, module: 1, ticket: "PS-102", xp: 100,
    title: "Health-check URLs",
    topic: "Variables, types & strings",
    from: DANA,
    story: "<p>Our monitoring needs a health-check URL and a few labels for every server, built from the server's name and port. Easy, except PowerShell has a few string rules that catch out everyone the first time.</p>" +
      "<p>Build them, and you'll meet each of those traps on purpose.</p>",
    learn:
      "<h3>Variables</h3><p>A variable starts with <code>$</code>. You don't declare it or its type: just assign. <code>.GetType().Name</code> tells you what type a value is.</p>" +
      ex('$server = "web-01"\n$port = 443\n$server.GetType().Name\n$port.GetType().Name') +
      "<h3>Double vs single quotes</h3><p><b>Double quotes</b> expand variables inside them. <b>Single quotes</b> are literal: exactly what you typed.</p>" +
      ex("$name = \"Ana\"\n\"Hello $name\"\n'Hello $name'") +
      "<p>To put an expression (not just a variable) inside double quotes, wrap it in <code>$( )</code>:</p>" +
      ex('$port = 443\n"Next port: $($port + 1)"\n"Services: $((Get-Service).Count)"') +
      "<h3>Trap 1: a colon after a variable</h3><p><code>$env:USERNAME</code> reads an environment variable: <code>name:</code> before a variable name is a special <b>scope or drive</b> prefix. So inside a string, <code>\"$server:$port\"</code> is an error! Use <code>${server}</code> to mark where the name ends:</p>" +
      ex('$server = "web-01"\n$port = 443\n"${server}:$port"') +
      "<h3>Trap 2: the left side decides</h3><p>With <code>+</code>, PowerShell converts the right-hand value to the <b>type of the left-hand one</b>:</p>" +
      ex('"40" + 2\n2 + "40"\n[int]"40" + 2') +
      "<p>Values read from files and config are usually text, so cast them with <code>[int]</code> before doing arithmetic.</p>" +
      "<h3>The -f format operator</h3><p><code>\"template\" -f value0, value1</code> fills <code>{0}</code>, <code>{1}</code>... <code>{0,-10}</code> pads value 0 to 10 characters, aligned left (a positive number aligns right). <code>{1:N2}</code> shows a number with 2 decimals and thousands separators.</p>" +
      ex('"{0,-10}| {1,6:N2} GB" -f "web-01", 1234.5\n"{0:P0} used" -f 0.83') +
      "<h3>Here-strings: several lines</h3><p>A here-string starts with <code>@\"</code> at the end of a line and ends with <code>\"@</code> at the start of a line. Variables expand, as in double quotes. (<code>@'</code>...<code>'@</code> is the literal version.)</p>" +
      ex('$server = "web-01"\n$banner = @"\nServer: $server\nAuthorised users only\n"@\n$banner'),
    starter: ps`
      # PS-102 · Health-check URLs
      $server = "web-01"
      $port = 443

      # 1) $url: https://web-01:443/health  (built from $server and $port)


      # 2) $note: exactly  Cost: $5 per GB  (with the dollar sign)


      # 3) $total: the number 42, from the text "40" in a config file plus 2
      $fromConfig = "40"


      # 4) $line: "web-01     | 443": the server name padded to 10 characters, then " | ", then the port (use -f)


      # 5) $motd: a here-string with two lines:  Welcome to web-01  and  Authorised users only
    `,
    objectives: [
      {
        id: "url",
        text: "<code>$url</code> is <code>https://web-01:443/health</code>, built from <code>$server</code> and <code>$port</code>.",
        hints: ['A colon right after $server confuses PowerShell. Use ${server}: or $($server): inside the string.', '$url = "https://$\{server}:$port/health"'.replace("$\\{", "${")],
        check: function (r) {
          var res = H.expect(r, "url", "https://web-01:443/health", "string");
          if (res !== true) return res;
          return H.alt(r, '\\$server\\s*=\\s*"web-01"', '$server = "db-02"', { url: "https://db-02:443/health" }, "$server = \"db-02\"");
        }
      },
      {
        id: "literal",
        text: "<code>$note</code> is exactly <code>Cost: $5 per GB</code>.",
        hints: ["In double quotes, $5 is read as a variable (an empty one). Which quotes don't expand variables?", "$note = 'Cost: $5 per GB'"],
        check: function (r) {
          var v = r.v("note");
          if (v === "Cost:  per GB") return "$note came out as \"Cost:  per GB\": in double quotes, $5 was read as a variable. Use single quotes (or `$ to escape the dollar).";
          return H.expect(r, "note", "Cost: $5 per GB", "string");
        }
      },
      {
        id: "number",
        text: "<code>$total</code> is the <b>number</b> 42: <code>$fromConfig</code> (the text <code>\"40\"</code>) plus 2.",
        hints: ['"40" + 2 joins text ("402"). Turn the text into a number first with [int].', "$total = [int]$fromConfig + 2"],
        check: function (r) {
          var v = r.v("total");
          if (v === "402") return "$total is \"402\": text + 2 joins them as text. Convert first: [int]$fromConfig + 2.";
          var res = H.expect(r, "total", 42, "number");
          if (res !== true) return res;
          return H.alt(r, '\\$fromConfig\\s*=\\s*"40"', '$fromConfig = "8"', { total: 10 }, "$fromConfig = \"8\"");
        }
      },
      {
        id: "format",
        text: "<code>$line</code> is <code>\"web-01     | 443\"</code>: the server name left-aligned in 10 characters, then <code> | </code>, then the port, built with <code>-f</code>.",
        hints: ["{0,-10} pads value 0 to 10 characters, aligned left.", '$line = "{0,-10}| {1}" -f $server, $port'],
        check: function (r) {
          var res = H.expect(r, "line", "web-01    | 443", "string");
          if (res !== true) {
            var v = r.v("line");
            if (typeof v === "string" && v.replace(/\s+/g, " ") === "web-01 | 443") return "$line is " + H.show(v) + ". The name part must be exactly 10 characters wide (web-01 plus 4 spaces), then \"| \" and the port. Use {0,-10}.";
            return res;
          }
          if (!/-f\b/i.test(r.src)) return "Build it with the -f operator.";
          return H.alt(r, '\\$server\\s*=\\s*"web-01"', '$server = "api-gateway"', { line: "api-gateway| 443" }, "$server = \"api-gateway\"");
        }
      },
      {
        id: "here",
        text: "<code>$motd</code> is a here-string with two lines: <code>Welcome to web-01</code> and <code>Authorised users only</code>, using <code>$server</code>.",
        hints: ['Start with @" at the end of a line and finish with "@ at the very start of a line.', '$motd = @"\nWelcome to $server\nAuthorised users only\n"@'],
        check: function (r) {
          var res = H.expect(r, "motd", "Welcome to web-01\nAuthorised users only", "string");
          if (res !== true) return res;
          if (!/@"/.test(r.src)) return "Use a here-string: @\" ... \"@.";
          return H.alt(r, '\\$server\\s*=\\s*"web-01"', '$server = "db-02"', { motd: "Welcome to db-02\nAuthorised users only" }, "$server = \"db-02\"");
        }
      }
    ],
    debrief: "<p>Ticket closed. You've now met the three string traps that cost everyone an afternoon: <code>$server:</code> read as a scope, <code>$5</code> expanding inside double quotes, and <code>\"40\" + 2</code> giving <code>\"402\"</code>.</p>" +
      "<p>Rule of thumb: <b>single quotes</b> unless you need a variable inside, <b>${ }</b> or <b>$( )</b> when the name runs into other characters, and <b>[int]</b> on anything that came from a file.</p>",
    realworld: "Try \"Logged in as $env:USERNAME on $env:COMPUTERNAME\" in your own PowerShell. Environment variables use the same name: prefix ($env:) that made \"$server:$port\" fail.",
    quiz: [
      { q: "What does <code>'Hello $name'</code> output?", options: ["Hello Ana", "Hello $name", "An error", "Hello"], answer: 1,
        why: "Single quotes are literal: no variable expansion." },
      { q: "What is <code>\"40\" + 2</code>?", options: ["42", "\"402\"", "An error", "40"], answer: 1,
        why: "The left side is text, so 2 is converted to text and joined." },
      { q: "How do you write a server name followed by a colon inside double quotes?", options: ["\"$server:\"", "\"${server}:\"", "'$server:'", "\"$server\\:\""], answer: 1,
        why: "${...} marks exactly where the variable name ends." }
    ]
  });

  /* ================================================================== PS-103 */
  LABS.push({
    id: "ps-103", n: 3, module: 1, ticket: "PS-103", xp: 100,
    title: "What's running on KC-WIN-01?",
    topic: "The object pipeline",
    from: DANA,
    story: "<p>Our monitoring flagged <code>KC-WIN-01</code> as \"degraded\" overnight, without saying why. Before anyone logs in and clicks around, let's interrogate it properly: which services are down, which ought to be running, what's eating CPU, and is anything running that shouldn't be?</p>",
    learn:
      "<h3>Pipelines pass objects</h3><p>The <code>|</code> pipe sends the output of one command into the next. In bash, that's text, and you cut it apart with <code>grep</code> and <code>awk</code>. In PowerShell it's <b>objects</b>, so the next command can use their properties directly, by name.</p>" +
      ex("Get-Service | Where-Object Status -eq Stopped") +
      "<h3>Where-Object: filter</h3><p>Two ways to write it. The short form compares one property:</p>" +
      ex("Get-Service | Where-Object StartType -eq Disabled") +
      "<p>The full form is a <b>script block</b> <code>{ }</code> that runs for each object. Inside it, <code>$_</code> is the current object, and you can combine conditions with <code>-and</code> / <code>-or</code>:</p>" +
      ex('Get-Service | Where-Object { $_.Status -eq "Running" -and $_.Name -like "W*" }') +
      '<table class="t"><tr><th>Operator</th><th>Means</th></tr><tr><td><code>-eq -ne</code></td><td>equal / not equal</td></tr><tr><td><code>-gt -ge -lt -le</code></td><td>greater / less than (or equal)</td></tr><tr><td><code>-like</code></td><td>wildcard match: <code>-like "W*"</code></td></tr><tr><td><code>-not</code></td><td>reverses a condition</td></tr></table>' +
      "<p>Comparisons are <b>case-insensitive</b> by default: <code>\"Running\" -eq \"running\"</code> is <code>$true</code>.</p>" +
      "<h3>Sort-Object and Select-Object</h3>" +
      ex("Get-Process | Sort-Object CPU -Descending | Select-Object -First 3") +
      "<p><code>Select-Object Name, CPU</code> keeps only some properties. <code>-ExpandProperty Name</code> gives you just the values (plain strings) instead of objects with one property:</p>" +
      ex("Get-Service | Select-Object -First 2 Name\nGet-Service | Select-Object -First 2 -ExpandProperty Name") +
      "<h3>Saving results</h3><p>Assign a pipeline to a variable, or wrap it in parentheses and use <code>.Property</code>:</p>" +
      ex("$stoppedNow = Get-Service | Where-Object Status -eq Stopped\n$stoppedNow.Count\n$stoppedNow.Name"),
    starter: ps`
      # PS-103 · What's running on KC-WIN-01?

      # 1) $stopped: the names of the services that are stopped


      # 2) $autoButStopped: names of services set to start Automatically but that are Stopped


      # 3) $top3: names of the 3 processes that have used the most CPU, highest first


      # 4) $noCompany: names of processes that have no Company (no known vendor)
    `,
    objectives: [
      {
        id: "stopped",
        text: "<code>$stopped</code> holds the <b>names</b> of all stopped services.",
        hints: ["Get-Service | Where-Object Status -eq Stopped, then keep just the names with Select-Object -ExpandProperty Name (or wrap it in ( ) and add .Name).",
          "$stopped = Get-Service | Where-Object Status -eq Stopped | Select-Object -ExpandProperty Name"],
        check: function (r) {
          var res = H.expect(r, "stopped", ["KestrelUpdater", "RemoteRegistry", "wuauserv"], "array");
          if (res !== true) {
            var v = r.p("stopped");
            if (Array.isArray(v) && v.length && typeof v[0] === "object") return "$stopped holds service objects. Keep just the names: | Select-Object -ExpandProperty Name";
            return res;
          }
          var r2 = r.run(null, { system: function (sys) { sys.services.forEach(function (s) { if (s.Name === "Spooler") s.Status = "Stopped"; }); } });
          if (!H.same(r2.p("stopped"), ["KestrelUpdater", "RemoteRegistry", "Spooler", "wuauserv"])) return "When I stopped the Spooler service too, $stopped came out as " + H.show(r2.v("stopped")) + ". Get it from Get-Service, don't type the names.";
          return true;
        }
      },
      {
        id: "auto",
        text: "<code>$autoButStopped</code> holds the names of services whose <code>StartType</code> is <code>Automatic</code> but whose <code>Status</code> is <code>Stopped</code>.",
        hints: ["Two conditions on each service: use the script block form with -and.",
          "$autoButStopped = Get-Service | Where-Object { $_.StartType -eq 'Automatic' -and $_.Status -eq 'Stopped' } | Select-Object -ExpandProperty Name"],
        check: function (r) {
          var v = r.p("autoButStopped");
          if (v === "KestrelUpdater") v = ["KestrelUpdater"];
          if (!H.same(v, ["KestrelUpdater"]) && !H.same(r.p("autoButStopped"), "KestrelUpdater")) return H.expect(r, "autoButStopped", "KestrelUpdater");
          var r2 = r.run(null, { system: function (sys) { sys.services.forEach(function (s) { if (s.Name === "wuauserv") s.StartType = "Automatic"; }); } });
          if (!H.same(r2.p("autoButStopped"), ["KestrelUpdater", "wuauserv"])) return "When I set wuauserv to Automatic, $autoButStopped came out as " + H.show(r2.v("autoButStopped")) + ". Filter on both properties.";
          return true;
        }
      },
      {
        id: "cpu",
        text: "<code>$top3</code> holds the names of the 3 processes with the highest <code>CPU</code>, highest first.",
        hints: ["Sort-Object CPU -Descending, then Select-Object -First 3, then the names.",
          "$top3 = Get-Process | Sort-Object CPU -Descending | Select-Object -First 3 -ExpandProperty Name"],
        check: function (r) {
          var v = r.p("top3");
          if (H.same(v, ["sshd", "kestrel-sync", "lsass"]) || H.same(v, ["sshd", "svchost", "pwsh"])) return "That's the 3 LOWEST. Add -Descending to Sort-Object.";
          var res = H.expect(r, "top3", ["sqlservr", "updater", "w3wp"], "array");
          if (res !== true) return res;
          var r2 = r.run(null, { system: function (sys) { sys.processes.forEach(function (x) { if (x.Name === "kestrel-agent") x.CPU = 5000; }); } });
          if (!H.same(r2.p("top3"), ["kestrel-agent", "sqlservr", "updater"])) return "When kestrel-agent's CPU went up to 5000, $top3 came out as " + H.show(r2.v("top3")) + ". Sort the processes by CPU.";
          return true;
        }
      },
      {
        id: "vendor",
        text: "<code>$noCompany</code> holds the names of the processes with no <code>Company</code> value.",
        hints: ["An empty property is $null, which counts as false. Where-Object { -not $_.Company } keeps those.",
          "$noCompany = Get-Process | Where-Object { -not $_.Company } | Select-Object -ExpandProperty Name"],
        check: function (r) {
          return H.expect(r, "noCompany", ["sshd", "updater"], "array");
        }
      }
    ],
    debrief: "<p>Ticket closed, and the server has two real problems. <code>KestrelUpdater</code> is set to start automatically but isn't running, so patches haven't been arriving. And <code>updater</code> is burning CPU with <b>no vendor</b>, running from <code>C:\\Users\\Public</code>, a folder anyone can write to. That's not one of ours: it goes to the security team as a possible cryptominer.</p>" +
      "<p>You found both with four one-liners, no clicking, and no text parsing: just properties and filters.</p>",
    realworld: "On your PC: Get-Service | Where-Object Status -eq Stopped, and Get-Process | Sort-Object CPU -Descending | Select-Object -First 5 Name, CPU, Path. Process paths outside Program Files and Windows deserve a second look.",
    quiz: [
      { q: "What travels down a PowerShell pipeline?", options: ["Lines of text", "Objects with properties", "Files", "Bytes"], answer: 1,
        why: "That's why you can filter on $_.Status instead of cutting up text." },
      { q: "Inside <code>Where-Object { ... }</code>, what is <code>$_</code>?", options: ["The whole list", "The current object", "The last result", "Nothing"], answer: 1,
        why: "The script block runs once per object, and $_ is that object." },
      { q: "<code>Select-Object Name</code> vs <code>Select-Object -ExpandProperty Name</code>?", options: ["Same thing", "The first gives objects with a Name property; the second gives the plain values", "The second is faster", "The first sorts"], answer: 1,
        why: "Use -ExpandProperty when you want a simple list of values." }
    ]
  });

  /* ================================================================== PS-104 */
  LABS.push({
    id: "ps-104", n: 4, module: 1, ticket: "PS-104", xp: 100,
    title: "The capacity report",
    topic: "Select, calculated properties, Group & Measure",
    from: MAYA,
    story: "<p>Finance wants to know whether <code>KC-WIN-01</code> needs more memory before Black Friday. They don't want raw bytes, they want a short report in numbers they can read.</p>" +
      "<p>Shape the data into exactly what they need: memory in MB, who's using what, and totals.</p>",
    learn:
      "<h3>Calculated properties</h3><p><code>Select-Object</code> can make <b>new</b> properties: give it a hashtable with a <code>Name</code> and an <code>Expression</code> script block (<code>$_</code> is the object). Process memory (<code>WS</code>, working set) is in bytes, and PowerShell has the constants <code>1KB</code>, <code>1MB</code> and <code>1GB</code> built in.</p>" +
      ex("Get-Process | Select-Object -First 3 Name, @{ Name = 'MemoryMB'; Expression = { [math]::Round($_.WS / 1MB, 1) } }") +
      "<p><code>[math]::Round(value, 1)</code> rounds to 1 decimal place. (<code>[math]::</code> calls a method of .NET's Math class.)</p>" +
      "<h3>Group-Object</h3><p>Groups objects that share a value. Each group has <code>Count</code>, <code>Name</code> (the shared value) and <code>Group</code> (the objects in it):</p>" +
      ex("Get-Service | Group-Object Status\nGet-Process | Group-Object Company -NoElement") +
      "<h3>Measure-Object</h3><p>Counts, sums and averages:</p>" +
      ex("Get-Process | Measure-Object CPU -Sum -Average -Maximum\n(Get-Process | Measure-Object WS -Sum).Sum / 1GB") +
      "<h3>Building text from objects</h3><p>To turn each object into a line of text, use <code>ForEach-Object</code> and a string. <code>-join</code> glues a list together with a separator:</p>" +
      ex('Get-Service | Group-Object StartType | ForEach-Object { "$($_.Name)=$($_.Count)" }\n("a", "b", "c") -join ", "') +
      '<div class="callout">Format-Table and Format-List are for <b>display</b> only. Never pipe their output into other commands or save it in a variable: it\'s formatting instructions, not your data.</div>',
    starter: ps`
      # PS-104 · The capacity report

      # 1) $memReport: objects with Name and MemoryMB (WS in MB, rounded to 1 decimal)
      #    for processes over 100 MB, biggest first


      # 2) $byCompany: Get-Process grouped by Company


      # 3) $cpuTotal: the total CPU of all processes, with Measure-Object


      # 4) $svcSummary: the text "Running: 11, Stopped: 3", built from Get-Service | Group-Object Status
    `,
    objectives: [
      {
        id: "calc",
        text: "<code>$memReport</code> holds objects with <code>Name</code> and <code>MemoryMB</code> (<code>WS</code> in MB, rounded to 1 decimal) for processes over 100 MB, sorted biggest first.",
        hints: ["Select-Object Name and a calculated MemoryMB property, then Where-Object MemoryMB -gt 100, then Sort-Object MemoryMB -Descending.",
          "$memReport = Get-Process |\n    Select-Object Name, @{ Name = 'MemoryMB'; Expression = { [math]::Round($_.WS / 1MB, 1) } } |\n    Where-Object MemoryMB -gt 100 |\n    Sort-Object MemoryMB -Descending"],
        check: function (r) {
          var want = [{ Name: "sqlservr", MemoryMB: 2350.5 }, { Name: "w3wp", MemoryMB: 412.6 }, { Name: "pwsh", MemoryMB: 105.9 }];
          var v = r.p("memReport");
          if (v === undefined) return "I can't find a variable called $memReport yet.";
          if (!Array.isArray(v)) return "$memReport should be a list of objects, but it's " + H.show(r.v("memReport")) + ".";
          if (v.length && typeof v[0] === "object" && !("MemoryMB" in v[0])) return "The objects need a MemoryMB property: add a calculated property @{ Name = 'MemoryMB'; Expression = { ... } }.";
          if (v.length && v[0].MemoryMB > 100000) return "MemoryMB looks like bytes. Divide WS by 1MB.";
          if (!H.same(v, want)) return "$memReport should be:\n  " + want.map(function (o) { return o.Name + " " + o.MemoryMB; }).join("\n  ") + "\nYours:\n  " + v.slice(0, 6).map(function (o) { return (o && o.Name) + " " + (o && o.MemoryMB); }).join("\n  ");
          var r2 = r.run(null, { system: function (sys) { sys.processes.push({ Name: "bigjob", Id: 7001, CPU: 1, WS: 300 * 1048576, Company: "Kestrel Cloud", Path: "C:\\jobs\\bigjob.exe", Ago: 5 }); } });
          var v2 = r2.p("memReport");
          if (!Array.isArray(v2) || v2.length !== 4 || v2[2].Name !== "bigjob") return "When a 300 MB process appeared, it should be third in $memReport. Build the report from Get-Process.";
          return true;
        }
      },
      {
        id: "group",
        text: "<code>$byCompany</code> is the output of <code>Get-Process | Group-Object Company</code>.",
        hints: ["Exactly that one-liner.", "$byCompany = Get-Process | Group-Object Company"],
        check: function (r) {
          var v = r.v("byCompany");
          if (v === undefined) return "I can't find a variable called $byCompany yet.";
          var list = Array.isArray(v) ? v : [v];
          var counts = {};
          list.forEach(function (g) { if (g && g.get) counts[String(g.get("Name"))] = g.get("Count"); });
          if (!H.same(counts, { "Microsoft Corporation": 8, "Kestrel Cloud": 2, "": 2 })) return "$byCompany should hold 3 groups (Microsoft Corporation 8, Kestrel Cloud 2, and 2 with no company). Yours: " + H.show(counts) + ".";
          return true;
        }
      },
      {
        id: "measure",
        text: "<code>$cpuTotal</code> is the total <code>CPU</code> of all processes, from <code>Measure-Object</code>.",
        hints: ["Measure-Object CPU -Sum returns an object; its Sum property is the number.", "$cpuTotal = (Get-Process | Measure-Object CPU -Sum).Sum"],
        check: function (r) {
          var v = r.v("cpuTotal");
          if (v === undefined) return "I can't find a variable called $cpuTotal yet.";
          if (typeof v !== "number") return "$cpuTotal should be a number. Measure-Object returns an object: take its .Sum.";
          if (Math.abs(v - 2922.2) > 0.01) return "$cpuTotal is " + v + ", expected 2922.2.";
          return srcHas(r, /Measure-Object|\bmeasure\b/i, "Use Measure-Object -Sum.");
        }
      },
      {
        id: "summary",
        text: "<code>$svcSummary</code> is the text <code>Running: 11, Stopped: 3</code>, built from <code>Get-Service | Group-Object Status</code>.",
        hints: ["Turn each group into \"$($_.Name): $($_.Count)\" with ForEach-Object, then -join the lines with \", \".",
          '$svcSummary = (Get-Service | Group-Object Status | ForEach-Object { "$($_.Name): $($_.Count)" }) -join ", "'],
        check: function (r) {
          var res = H.expect(r, "svcSummary", "Running: 11, Stopped: 3", "string");
          if (res !== true) return res;
          var r2 = r.run(null, { system: function (sys) { sys.services.forEach(function (s) { if (s.Name === "BITS") s.Status = "Stopped"; }); } });
          if (r2.v("svcSummary") !== "Running: 10, Stopped: 4") return "When one more service stopped, $svcSummary came out as " + H.show(r2.v("svcSummary")) + ". Build it from Group-Object.";
          return true;
        }
      }
    ],
    debrief: "<p>Ticket closed. SQL Server alone uses 2.3 GB, roughly six times everything else combined, so the memory question is really a SQL Server question. That's the kind of conclusion a shaped report makes obvious and a raw process list hides.</p>" +
      "<p><b>Select</b> shapes each object, <b>Group</b> collects similar ones, <b>Measure</b> adds them up. Together they answer most \"how much / how many\" questions.</p>",
    realworld: "On your PC: Get-Process | Sort-Object WS -Descending | Select-Object -First 5 Name, @{n='MB';e={[math]::Round($_.WS/1MB)}}. Note the short n/e keys: PowerShell accepts abbreviations for Name and Expression.",
    quiz: [
      { q: "What do you get from <code>Get-Service | Group-Object Status</code>?", options: ["Services sorted by status", "One object per status, with Count, Name and Group", "A count", "Text"], answer: 1,
        why: "Group-Object returns group objects. The original objects are inside each one's Group property." },
      { q: "What does <code>1MB</code> mean in PowerShell?", options: ["The text \"1MB\"", "1,048,576 (bytes)", "1,000,000", "An error"], answer: 1,
        why: "KB, MB, GB and TB are built-in number suffixes." },
      { q: "Why not save the output of <code>Format-Table</code> in a variable?", options: ["It's slow", "It's display formatting, not your data, so you can't filter or sort it afterwards", "It's not allowed", "It deletes the objects"], answer: 1,
        why: "Format-* belongs at the very end of a pipeline, for the screen." }
    ]
  });

  /* ================================================================== PS-105 */
  var INV_DATA = ps`
    $servers = @("web-01", "web-02", "db-01")
    $owners = @{ "web-01" = "web"; "web-02" = "web"; "db-01" = "data" }
    $ports = @{ web = 443; data = 5432; platform = 6379 }
  `;
  LABS.push({
    id: "ps-105", n: 5, module: 1, ticket: "PS-105", xp: 100,
    title: "The server inventory",
    topic: "Arrays, hashtables & [PSCustomObject]",
    from: DANA,
    story: "<p>Our server inventory lives in three places: a list of names, a lookup of which team owns each one, and each team's standard port. Every audit starts with someone joining them by hand.</p>" +
      "<p>Today a new cache server, <code>cache-01</code>, joins the platform team. Add it, then join everything into proper objects that the rest of our tooling can use.</p>",
    learn:
      "<h3>Arrays</h3><p>An array is an ordered list: <code>@( )</code> or just commas. Indexes start at 0, and <b>negative</b> indexes count from the end.</p>" +
      ex('$colors = @("red", "green", "blue")\n$colors[0]\n$colors[-1]\n$colors.Count\n$colors += "black"\n$colors') +
      "<p><code>+=</code> builds a <b>new</b> array with the item added. That's fine for small lists; for thousands of items, use a <code>[System.Collections.Generic.List[string]]</code> and its <code>.Add()</code> method.</p>" +
      "<h3>Hashtables</h3><p>A hashtable maps <b>keys</b> to <b>values</b>, like a dictionary. Keys are case-insensitive.</p>" +
      ex('$owner = @{ "web-01" = "web"; "db-01" = "data" }\n$owner["db-01"]\n$owner.Count\n$owner["cache-01"] = "platform"\n$owner.ContainsKey("cache-01")\n$owner') +
      "<p>A missing key gives <code>$null</code>, not an error.</p>" +
      "<h3>[PSCustomObject]: your own objects</h3><p>Put <code>[PSCustomObject]</code> before a hashtable and you get a real object, with properties in the order you wrote them. Everything you learned about pipelines works on your own objects too:</p>" +
      ex('$s = [PSCustomObject]@{ Name = "web-01"; Owner = "web"; Port = 443 }\n$s.Owner\n$s | Get-Member -MemberType NoteProperty') +
      "<h3>Building a list of objects</h3><p>A <code>foreach</code> loop (or <code>ForEach-Object</code>) that <b>outputs</b> an object on each pass, assigned to a variable, collects all of them into an array:</p>" +
      ex('$squares = foreach ($n in 1..3) {\n    [PSCustomObject]@{ Number = $n; Square = $n * $n }\n}\n$squares'),
    starter: ps`
      # PS-105 · The server inventory
    ` + "\n" + INV_DATA + "\n\n" + ps`
      # 1) Add "cache-01" to $servers. Set $lastServer to the last server (use [-1]) and $serverCount to how many there are.


      # 2) Record that cache-01 is owned by "platform" in $owners. Set $dbOwner to the owner of db-01.


      # 3) $inventory: one [PSCustomObject] per server, with Name, Owner (from $owners) and Port (the owner team's port from $ports)


      # 4) $webServers: the names of the inventory items owned by "web"
    `,
    objectives: [
      {
        id: "array",
        text: "<code>cache-01</code> is added to <code>$servers</code>; <code>$lastServer</code> is the last server (via <code>[-1]</code>) and <code>$serverCount</code> how many there are.",
        hints: ['$servers += "cache-01", then $servers[-1] and $servers.Count.', '$servers += "cache-01"\n$lastServer = $servers[-1]\n$serverCount = $servers.Count'],
        check: function (r) {
          var res = H.expect(r, "servers", ["web-01", "web-02", "db-01", "cache-01"], "array");
          if (res !== true) return res;
          res = H.expect(r, "lastServer", "cache-01");
          if (res !== true) return res;
          res = H.expect(r, "serverCount", 4, "number");
          if (res !== true) return res;
          return srcHas(r, /\[\s*-1\s*\]/, "Use $servers[-1] to get the last item.");
        }
      },
      {
        id: "hash",
        text: "<code>$owners</code> says <code>cache-01</code> is owned by <code>platform</code>, and <code>$dbOwner</code> is the owner of <code>db-01</code>.",
        hints: ['$owners["cache-01"] = "platform" adds a key. Read one with $owners["db-01"].', '$owners["cache-01"] = "platform"\n$dbOwner = $owners["db-01"]'],
        check: function (r) {
          var o = r.p("owners");
          if (!o || typeof o !== "object") return "$owners should still be the hashtable.";
          if (!H.same(o, { "web-01": "web", "web-02": "web", "db-01": "data", "cache-01": "platform" })) return "$owners should map web-01, web-02 → web, db-01 → data and cache-01 → platform. It's " + H.show(r.v("owners")) + ".";
          return H.expect(r, "dbOwner", "data");
        }
      },
      {
        id: "objects",
        text: "<code>$inventory</code> holds one <code>[PSCustomObject]</code> per server, in order, with <code>Name</code>, <code>Owner</code> and <code>Port</code>.",
        hints: ["Loop over $servers. For each name, look up $owner = $owners[$name], then output [PSCustomObject]@{ Name = $name; Owner = $owner; Port = $ports[$owner] }. Assign the whole loop to $inventory.",
          "$inventory = foreach ($name in $servers) {\n    $owner = $owners[$name]\n    [PSCustomObject]@{ Name = $name; Owner = $owner; Port = $ports[$owner] }\n}"],
        check: function (r) {
          var want = [{ Name: "web-01", Owner: "web", Port: 443 }, { Name: "web-02", Owner: "web", Port: 443 }, { Name: "db-01", Owner: "data", Port: 5432 }, { Name: "cache-01", Owner: "platform", Port: 6379 }];
          var v = r.p("inventory");
          if (v === undefined) return "I can't find a variable called $inventory yet.";
          if (!Array.isArray(v)) return "$inventory should be a list of objects, but it's " + H.show(r.v("inventory")) + ".";
          var raw = r.v("inventory");
          if (raw.some(function (x) { return !(x instanceof window.PSEngine.PSObject); })) return "Each item should be a [PSCustomObject]@{ ... }, not a plain hashtable or text.";
          if (!H.same(v, want)) return "$inventory should be:\n  " + want.map(H.show).join("\n  ") + "\nYours:\n  " + raw.slice(0, 6).map(function (x) { return H.show(x); }).join("\n  ");
          return H.alt(r, '\\$servers\\s*=\\s*@\\([^)]*\\)', '$servers = @("db-01")', { inventory: [{ Name: "db-01", Owner: "data", Port: 5432 }, { Name: "cache-01", Owner: "platform", Port: 6379 }] }, "a shorter $servers list");
        }
      },
      {
        id: "filter",
        text: "<code>$webServers</code> holds the names of the <code>$inventory</code> items owned by <code>web</code>.",
        hints: ["Your objects work with Where-Object like any others.", "$webServers = $inventory | Where-Object Owner -eq 'web' | Select-Object -ExpandProperty Name"],
        check: function (r) {
          var res = H.expect(r, "webServers", ["web-01", "web-02"], "array");
          if (res !== true) return res;
          return srcHas(r, /\$inventory\s*\|/i, "Filter $inventory with a pipeline (Where-Object).");
        }
      }
    ],
    debrief: "<p>Ticket closed. Three loose lookups became one list of real objects, and from here every tool you've learned (Where, Sort, Group, Export) works on <b>your</b> data exactly as it works on services and processes.</p>" +
      "<p>That's the PowerShell way: turn whatever you have into objects as early as possible.</p>",
    realworld: "Try $me = [PSCustomObject]@{ User = $env:USERNAME; Computer = $env:COMPUTERNAME; PS = $PSVersionTable.PSVersion } then $me | Format-List in your own PowerShell.",
    quiz: [
      { q: "<code>$a = 1, 2, 3</code>. What is <code>$a[-1]</code>?", options: ["1", "3", "An error", "$null"], answer: 1,
        why: "Negative indexes count from the end: -1 is the last item." },
      { q: "What does <code>$h[\"missing\"]</code> give for a key that isn't in the hashtable?", options: ["An error", "$null", "\"\"", "0"], answer: 1,
        why: "Hashtables return $null for missing keys. Use .ContainsKey() to check." },
      { q: "Why turn a hashtable into a <code>[PSCustomObject]</code>?", options: ["It's smaller", "You get a real object: ordered properties that work with Select, Where, Sort, Export-Csv...", "Hashtables can't hold text", "It encrypts it"], answer: 1,
        why: "Pipeline commands are built for objects with properties." }
    ]
  });

  /* ================================================================== PS-106 */
  LABS.push({
    id: "ps-106", n: 6, module: 1, ticket: "PS-106", xp: 100,
    title: "Alert triage",
    topic: "Conditions & operators: if, switch, -like, -match, -in",
    from: DEV,
    story: "<p>Our alerting sends one generic email for everything, so people have stopped reading them. Let's triage alerts automatically: how bad is it, which environment, which ticket, and is the person asking to deploy the fix allowed to?</p>",
    learn:
      "<h3>if / elseif / else</h3><p>Conditions go in parentheses, code in braces. Checks run top to bottom and the first true one wins, so put the strictest first.</p>" +
      ex('$disk = 91\nif ($disk -ge 95) { "page someone" }\nelseif ($disk -ge 85) { "open a ticket" }\nelse { "fine" }') +
      '<div class="callout warn"><b>Not <code>&gt;</code> and <code>==</code>!</b> In PowerShell <code>&gt;</code> means <em>write to a file</em>, so <code>if ($x &gt; 5)</code> creates a file called 5. Comparisons are words: <code>-gt -ge -lt -le -eq -ne</code>.</div>' +
      "<h3>-like and -match</h3><p><code>-like</code> uses wildcards (<code>*</code> any text, <code>?</code> one character). <code>-match</code> uses a <b>regular expression</b>, and fills the automatic hashtable <code>$Matches</code> with what it found. Round brackets <code>( )</code> in the pattern capture a part as <code>$Matches[1]</code>:</p>" +
      ex('"web-prod-01" -like "*-prod-*"\n"Order ORD-7781 shipped" -match "ORD-(\\d+)"\n$Matches[0]\n$Matches[1]') +
      "<p><code>\\d</code> is a digit and <code>+</code> means one or more. Both operators are case-insensitive; <code>-clike</code> and <code>-cmatch</code> are the case-sensitive versions.</p>" +
      "<h3>switch</h3><p>Compares one value against many cases, and runs every case that matches. <code>-Wildcard</code> or <code>-Regex</code> change how cases match, and <code>default</code> runs when nothing does. Given an array, it checks <b>each item</b>, with the item in <code>$_</code>, and assigning the switch to a variable collects its output:</p>" +
      ex('$kinds = switch -Wildcard ("app.log", "photo.jpg", "notes.txt") {\n    "*.log" { "log" }\n    "*.jpg" { "image" }\n    default { "other" }\n}\n$kinds') +
      "<h3>-in and -contains</h3><p>Is a value in a list? <code>$value -in $list</code>, or the other way round, <code>$list -contains $value</code>. Case doesn't matter unless you use <code>-cin</code> / <code>-ccontains</code>.</p>" +
      ex('$admins = "dana.park", "root"\n"Dana.Park" -in $admins\n$admins -contains "mallory"'),
    starter: ps`
      # PS-106 · Alert triage
      $cpu = 87
      # 1) $level: "critical" if $cpu is 90 or more, "warning" if 75 or more, otherwise "ok"


      $hosts = @("web-prod-01", "db-dev-02", "api-prod-03", "build-agent-7")
      # 2) $envs: for each host, "production" if it matches *-prod-*, "development" if it matches *-dev-*, otherwise "unknown" (switch -Wildcard)


      $subject = "ALERT [P1] TICKET-4521: disk full on web-prod-01"
      # 3) $ticket: the ticket number from $subject, as text ("4521"), using -match and $Matches


      $allowed = @("dana.park", "ana.silva")
      $requester = "Ana.Silva"
      # 4) $canDeploy: $true if $requester is in $allowed
    `,
    objectives: [
      {
        id: "if",
        text: "<code>$level</code> is <code>critical</code> when <code>$cpu</code> is 90 or more, <code>warning</code> when it's 75 or more, otherwise <code>ok</code>.",
        hints: ["if ($cpu -ge 90) { ... } elseif ($cpu -ge 75) { ... } else { ... }, setting $level in each branch.",
          'if ($cpu -ge 90) { $level = "critical" }\nelseif ($cpu -ge 75) { $level = "warning" }\nelse { $level = "ok" }'],
        check: function (r) {
          if (/\$cpu\s*>/.test(r.src.replace(/#.*$/gm, ""))) return "> writes to a file in PowerShell! Use -gt or -ge for comparisons.";
          var res = H.expect(r, "level", "warning");
          if (res !== true) return res;
          var cases = [[95, "critical"], [90, "critical"], [75, "warning"], [74, "ok"], [10, "ok"]];
          for (var i = 0; i < cases.length; i++) {
            var r2 = r.run(r.src.replace(/\$cpu\s*=\s*\d+/, "$cpu = " + cases[i][0]));
            if (r2.v("level") !== cases[i][1]) return "With $cpu = " + cases[i][0] + ", $level should be \"" + cases[i][1] + "\" but it's " + H.show(r2.v("level")) + ". Check -ge vs -gt at the boundaries.";
          }
          return true;
        }
      },
      {
        id: "switch",
        text: "<code>$envs</code> holds, for each host in order: <code>production</code> (matches <code>*-prod-*</code>), <code>development</code> (<code>*-dev-*</code>) or <code>unknown</code>, using <code>switch -Wildcard</code>.",
        hints: ["$envs = switch -Wildcard ($hosts) { \"*-prod-*\" { \"production\" } ... default { \"unknown\" } }",
          '$envs = switch -Wildcard ($hosts) {\n    "*-prod-*" { "production" }\n    "*-dev-*"  { "development" }\n    default    { "unknown" }\n}'],
        check: function (r) {
          var res = H.expect(r, "envs", ["production", "development", "production", "unknown"], "array");
          if (res !== true) return res;
          if (!/switch\s+-wildcard/i.test(r.src)) return "Use switch -Wildcard.";
          return H.alt(r, '\\$hosts\\s*=\\s*@\\([^)]*\\)', '$hosts = @("cache-dev-09", "x")', { envs: ["development", "unknown"] }, "a different $hosts list");
        }
      },
      {
        id: "match",
        text: "<code>$ticket</code> is the ticket number from <code>$subject</code> as text (<code>\"4521\"</code>), using <code>-match</code> and <code>$Matches</code>.",
        hints: ['Match "TICKET-(\\d+)" and take the captured part: $Matches[1].', 'if ($subject -match "TICKET-(\\d+)") { $ticket = $Matches[1] }'],
        check: function (r) {
          var v = r.v("ticket");
          if (v === "TICKET-4521") return "$ticket is the whole match. Put ( ) around the digits in the pattern and use $Matches[1].";
          var res = H.expect(r, "ticket", "4521");
          if (res !== true) return res;
          return H.alt(r, '\\$subject\\s*=\\s*"[^"]*"', '$subject = "WARN [P3] TICKET-77: certificate expires soon"', { ticket: "77" }, "a different alert subject");
        }
      },
      {
        id: "in",
        text: "<code>$canDeploy</code> is <code>$true</code> if <code>$requester</code> is in <code>$allowed</code> (it is: case doesn't matter).",
        hints: ["$requester -in $allowed gives $true or $false.", "$canDeploy = $requester -in $allowed"],
        check: function (r) {
          var res = H.expect(r, "canDeploy", true, "boolean");
          if (res !== true) return res;
          return H.alt(r, '\\$requester\\s*=\\s*"[^"]*"', '$requester = "mallory"', { canDeploy: false }, "$requester = \"mallory\"");
        }
      }
    ],
    debrief: "<p>Ticket closed. Every alert now arrives with a severity, an environment and a ticket number, and only approved people can trigger the deploy. That's the same if / switch / match logic behind most alert routing rules.</p>" +
      "<p>Remember the trap: <code>&gt;</code> isn't a comparison in PowerShell, it creates a file.</p>",
    realworld: "Try 'Error 0x80070005: Access denied' -match '0x([0-9A-F]+)' and then $Matches in your PowerShell. Windows error codes look like that, and pulling them out of logs is a daily task.",
    quiz: [
      { q: "What does <code>if ($count &gt; 5)</code> do in PowerShell?", options: ["Compares $count with 5", "Writes $count to a file named 5", "An error", "Nothing"], answer: 1,
        why: "> is redirection. Use -gt." },
      { q: "After <code>\"ID-42\" -match \"ID-(\\d+)\"</code>, what's <code>$Matches[1]</code>?", options: ["\"ID-42\"", "\"42\"", "42 (a number)", "$true"], answer: 1,
        why: "$Matches[0] is the whole match; [1] is the first captured group, as text." },
      { q: "<code>\"ADMIN\" -in \"admin\", \"root\"</code> is…", options: ["$false", "$true", "An error", "\"admin\""], answer: 1,
        why: "PowerShell comparisons are case-insensitive by default." }
    ]
  });

  /* ================================================================== PS-107 */
  LABS.push({
    id: "ps-107", n: 7, module: 1, ticket: "PS-107", xp: 100,
    title: "The nightly job",
    topic: "Loops: foreach, for, while, do/until, ForEach-Object",
    from: MAYA,
    story: "<p>The nightly maintenance job does five boring things: adds up backup sizes, picks the even-numbered ports for blue/green deploys, waits for a service to come back healthy, reads its own step list, and tidies up server names.</p>" +
      "<p>Each needs a loop, and each a different kind. Write them, and you'll know which loop to reach for.</p>",
    learn:
      "<h3>foreach: once per item</h3>" +
      ex('$total = 0\nforeach ($size in 10, 20, 30) {\n    $total += $size\n}\n$total') +
      "<h3>for: counting</h3><p>Start; keep going while; step. Handy when you need the index or a range of numbers:</p>" +
      ex('for ($i = 1; $i -le 10; $i += 3) { "i is $i" }') +
      "<p>For a simple range, <code>1..5</code> gives 1, 2, 3, 4, 5. <code>%</code> is the remainder: <code>$n % 2 -eq 0</code> means even.</p>" +
      "<h3>while and do / until: keep going until something happens</h3><p><code>while</code> checks <b>before</b> each pass (it may run zero times). <code>do { } until ( )</code> checks <b>after</b>, so it always runs at least once: perfect for \"try, then check\".</p>" +
      ex('$tries = 0\ndo {\n    $tries++\n    $ok = $tries -ge 3      # pretend it works on the 3rd try\n} until ($ok)\n"Took $tries tries"') +
      "<p>In this lab, <code>Test-Health -Attempt $n</code> is a ready-made function that pretends to check a service: it returns <code>$true</code> once the service is healthy.</p>" +
      "<h3>break and continue</h3><p><code>continue</code> skips to the next item; <code>break</code> leaves the loop completely.</p>" +
      ex('foreach ($n in 1..10) {\n    if ($n % 2) { continue }   # odd: skip\n    if ($n -gt 6) { break }    # done\n    $n\n}') +
      "<h3>ForEach-Object: the pipeline loop</h3><p>Inside a pipeline, use <code>ForEach-Object { }</code> with <code>$_</code>. Same idea as foreach, but it streams objects as they come.</p>" +
      ex('"alpha", "beta" | ForEach-Object { $_.ToUpper() }'),
    starter: ps`
      # PS-107 · The nightly job
      $sizesMB = @(120, 340, 75, 910, 55)
      # 1) $totalMB: the sum of $sizesMB, using a foreach loop (not Measure-Object)


      # 2) $ports: the even numbers from 8080 to 8085, using a for loop


      # 3) $attempts: call Test-Health -Attempt $n for $n = 1, 2, 3... in a do/until loop
      #    until it returns $true. $attempts = how many tries it took.


      $log = @("# nightly job", "start backup", "copy db-01", "# retry", "copy web-01", "END", "copy web-02")
      # 4) $steps: the lines before "END", skipping lines that start with "#" (use continue and break)


      $names = @("web-01", "db-01", "cache-01")
      # 5) $upper: every name in uppercase, using ForEach-Object
    `,
    prelude: ps`
      $HealthyAfter = 3
      function Test-Health {
          param([int]$Attempt)
          Write-Host "  health check, attempt $Attempt"
          return $Attempt -ge $HealthyAfter
      }
    `,
    objectives: [
      {
        id: "foreach",
        text: "<code>$totalMB</code> is the sum of <code>$sizesMB</code>, using a <code>foreach</code> loop.",
        hints: ["Start $totalMB at 0, then foreach ($size in $sizesMB) { $totalMB += $size }.", "$totalMB = 0\nforeach ($size in $sizesMB) {\n    $totalMB += $size\n}"],
        check: function (r) {
          var res = H.expect(r, "totalMB", 1500, "number");
          if (res !== true) return res;
          if (!/foreach\s*\(/i.test(r.src)) return "Use a foreach ( ... in ... ) loop for this one.";
          if (/Measure-Object/i.test(r.src)) return "Do it with the loop, without Measure-Object.";
          return H.alt(r, '\\$sizesMB\\s*=\\s*@\\([^)]*\\)', '$sizesMB = @(1, 2)', { totalMB: 3 }, "a different $sizesMB");
        }
      },
      {
        id: "for",
        text: "<code>$ports</code> holds the even numbers from 8080 to 8085, built with a <code>for</code> loop.",
        hints: ["for ($p = 8080; $p -le 8085; $p++) { if ($p % 2 -eq 0) { $p } }, assigned to $ports. Or step by 2.", "$ports = for ($p = 8080; $p -le 8085; $p += 2) { $p }"],
        check: function (r) {
          var res = H.expect(r, "ports", [8080, 8082, 8084], "array");
          if (res !== true) return res;
          return /for\s*\(/i.test(r.src.replace(/foreach\s*\(/ig, "")) ? true : "Use a for ( ; ; ) loop.";
        }
      },
      {
        id: "do",
        text: "<code>$attempts</code> is how many calls to <code>Test-Health -Attempt $n</code> it took to get <code>$true</code>, in a <code>do/until</code> loop.",
        hints: ["$attempts = 0; do { $attempts++; $healthy = Test-Health -Attempt $attempts } until ($healthy)",
          "$attempts = 0\ndo {\n    $attempts++\n    $healthy = Test-Health -Attempt $attempts\n} until ($healthy)"],
        check: function (r) {
          var res = H.expect(r, "attempts", 3, "number");
          if (res !== true) return res;
          if (!/do\s*\{/i.test(r.src) || !/until\s*\(/i.test(r.src)) return "Use a do { } until ( ) loop.";
          var r2 = r.run("$HealthyAfter = 5\n" + r.src);
          if (r2.v("attempts") !== 5) return "When the service needed 5 attempts, $attempts came out as " + H.show(r2.v("attempts")) + ". Loop until Test-Health returns $true.";
          return true;
        }
      },
      {
        id: "break",
        text: "<code>$steps</code> holds the lines of <code>$log</code> before <code>END</code>, skipping lines that start with <code>#</code>, using <code>continue</code> and <code>break</code>.",
        hints: ["foreach line: if it -like \"#*\", continue; if it -eq \"END\", break; otherwise output it. Assign the loop to $steps.",
          '$steps = foreach ($line in $log) {\n    if ($line -like "#*") { continue }\n    if ($line -eq "END") { break }\n    $line\n}'],
        check: function (r) {
          var res = H.expect(r, "steps", ["start backup", "copy db-01", "copy web-01"], "array");
          if (res !== true) return res;
          if (!/\bcontinue\b/i.test(r.src) || !/\bbreak\b/i.test(r.src)) return "Use continue to skip the comment lines and break at END.";
          return true;
        }
      },
      {
        id: "pipe",
        text: "<code>$upper</code> holds every name in <code>$names</code> in uppercase, using <code>ForEach-Object</code>.",
        hints: ["$names | ForEach-Object { $_.ToUpper() }", "$upper = $names | ForEach-Object { $_.ToUpper() }"],
        check: function (r) {
          var res = H.expect(r, "upper", ["WEB-01", "DB-01", "CACHE-01"], "array");
          if (res !== true) return res;
          return srcHas(r, /ForEach-Object|\|\s*%\s*\{|\|\s*foreach\s*\{/i, "Use ForEach-Object in a pipeline.");
        }
      }
    ],
    debrief: "<p>Ticket closed. The rule of thumb: <b>foreach</b> for a list you already have, <b>for</b> when you're counting, <b>do/until</b> to retry until something works, <b>while</b> when it might not need to run at all, and <b>ForEach-Object</b> inside a pipeline.</p>" +
      "<p>One warning for real scripts: a retry loop needs a limit (<code>until ($ok -or $tries -ge 10)</code>), or a service that never recovers keeps your job running forever.</p>",
    realworld: "In your PowerShell: 1..5 | ForEach-Object { Start-Sleep -Milliseconds 200; \"tick $_\" } shows ForEach-Object streaming results one at a time.",
    quiz: [
      { q: "Which loop always runs at least once?", options: ["while", "for", "do { } until ( )", "foreach"], answer: 2,
        why: "do loops check their condition after the body." },
      { q: "In a loop, what does <code>continue</code> do?", options: ["Stops the loop", "Skips to the next item", "Restarts the loop from the beginning", "Nothing"], answer: 1,
        why: "break leaves the loop; continue only skips the rest of this pass." },
      { q: "<code>$x = foreach ($n in 1..3) { $n * 2 }</code>. What is <code>$x</code>?", options: ["6", "@(2, 4, 6)", "$null", "2"], answer: 1,
        why: "Everything a loop outputs is collected when you assign the loop to a variable." }
    ]
  });

  /* ================================================================== PS-108 */
  LABS.push({
    id: "ps-108", n: 8, module: 1, ticket: "PS-108", xp: 100,
    title: "Reusable helpers",
    topic: "Functions, parameters & return values",
    from: DANA,
    story: "<p>Everyone on the team keeps copy-pasting the same few snippets: greetings for reports, converting sizes to bytes, checking free space, counting events. Time to turn them into <b>functions</b> we can share.</p>" +
      "<p>One of the existing snippets has a bug that's specific to PowerShell. You'll find out what it is.</p>",
    learn:
      "<h3>A function with parameters</h3><p>Name functions <b>Verb-Noun</b>, like cmdlets. Parameters go in a <code>param( )</code> block, and can have a type and a default value:</p>" +
      ex('function Get-Square {\n    param([int]$Number = 2)\n    $Number * $Number\n}\nGet-Square -Number 5\nGet-Square 7\nGet-Square') +
      "<p>Call functions like cmdlets, with <b>no parentheses or commas</b>: <code>Get-Square -Number 5</code>. Writing <code>Get-Square(5, 6)</code> passes one array: a classic beginner bug.</p>" +
      "<h3>The return-value trap</h3><p>In most languages, a function returns what you <code>return</code>. In PowerShell, <b>everything a function outputs</b> is returned: every value you don't assign or send somewhere else. <code>return $x</code> just adds <code>$x</code> and stops.</p>" +
      ex('function Get-Answer {\n    "Thinking..."\n    return 42\n}\n$a = Get-Answer\n$a.Count\n$a') +
      "<p>Messages meant for the person, not the caller, belong on the host with <code>Write-Host</code> (or <code>Write-Verbose</code>), which never becomes part of the return value. Output you don't want at all can go to <code>$null = ...</code> or <code>| Out-Null</code>.</p>" +
      ex('function Get-Answer {\n    Write-Host "Thinking..."\n    return 42\n}\n$a = Get-Answer\n$a') +
      "<h3>Scope: functions get their own variables</h3><p>A function can <b>read</b> variables from the script, but assigning to one inside a function creates a new local copy that disappears when the function ends. To change a script-level variable, say so with <code>$script:</code>:</p>" +
      ex('$count = 0\nfunction Add-One { $count++ }\nfunction Add-OneForReal { $script:count++ }\nAdd-One; Add-One\n"after Add-One: $count"\nAdd-OneForReal; Add-OneForReal\n"after Add-OneForReal: $count"'),
    starter: ps`
      # PS-108 · Reusable helpers

      # 1) Get-Greeting: parameters $Name and $Greeting (default "Hello"); returns "Hello, Ana!"


      # 2) ConvertTo-Bytes: parameters [double]$Size and [string]$Unit ("KB", "MB" or "GB");
      #    returns the number of bytes (1 KB = 1024 bytes)


      # 3) Fix this function: (Get-FreeSpaceGB -Drive C) should be just 120,
      #    but keep showing the "Checking drive C..." message on screen.
      function Get-FreeSpaceGB {
          param($Drive)
          "Checking drive $Drive..."
          $free = 120
          return $free
      }

      # 4) Add-Event: each call adds 1 to the script-level counter $EventCount.
      $EventCount = 0
    `,
    objectives: [
      {
        id: "greet",
        text: "<code>Get-Greeting -Name Ana</code> returns <code>Hello, Ana!</code>, and <code>Get-Greeting -Name Bo -Greeting Hi</code> returns <code>Hi, Bo!</code>.",
        hints: ['function Get-Greeting { param($Name, $Greeting = "Hello") ... } and output "$Greeting, $Name!".', 'function Get-Greeting {\n    param([string]$Name, [string]$Greeting = "Hello")\n    "$Greeting, $Name!"\n}'],
        check: function (r) {
          if (!r.fn("Get-Greeting")) return "I can't find a function called Get-Greeting.";
          var res = H.call(r, "Get-Greeting -Name Ana", "Hello, Ana!");
          if (res !== true) return res;
          res = H.call(r, "Get-Greeting -Name Bo -Greeting Hi", "Hi, Bo!");
          if (res !== true) return res;
          return H.call(r, "Get-Greeting Cy", "Hello, Cy!");
        }
      },
      {
        id: "bytes",
        text: "<code>ConvertTo-Bytes -Size 2 -Unit KB</code> returns 2048, <code>-Size 1.5 -Unit MB</code> 1572864 and <code>-Size 1 -Unit GB</code> 1073741824.",
        hints: ["Use switch ($Unit) with a case for each unit, multiplying $Size by 1KB, 1MB or 1GB.",
          'function ConvertTo-Bytes {\n    param([double]$Size, [string]$Unit)\n    switch ($Unit) {\n        "KB" { $Size * 1KB }\n        "MB" { $Size * 1MB }\n        "GB" { $Size * 1GB }\n    }\n}'],
        check: function (r) {
          if (!r.fn("ConvertTo-Bytes")) return "I can't find a function called ConvertTo-Bytes.";
          var cases = [["ConvertTo-Bytes -Size 2 -Unit KB", 2048], ["ConvertTo-Bytes -Size 1.5 -Unit MB", 1572864], ["ConvertTo-Bytes -Size 1 -Unit GB", 1073741824], ["ConvertTo-Bytes -Size 3 -Unit mb", 3145728]];
          for (var i = 0; i < cases.length; i++) { var res = H.call(r, cases[i][0], cases[i][1]); if (res !== true) return res; }
          return true;
        }
      },
      {
        id: "return",
        text: "<code>Get-FreeSpaceGB -Drive C</code> returns <b>only</b> 120, and still shows <code>Checking drive C...</code> on screen.",
        hints: ["The \"Checking...\" string is being returned too. Send it to the screen with Write-Host instead.",
          'function Get-FreeSpaceGB {\n    param($Drive)\n    Write-Host "Checking drive $Drive..."\n    $free = 120\n    return $free\n}'],
        check: function (r) {
          var res = r.ps("Get-FreeSpaceGB -Drive C");
          if (Array.isArray(res.value)) return "Get-FreeSpaceGB returned " + H.show(res.raw) + ": the \"Checking...\" text is part of the return value. Show it with Write-Host instead.";
          if (res.value !== 120) return "Get-FreeSpaceGB -Drive C should return 120, but returned " + H.show(res.raw) + ".";
          if (!/Checking drive C\.\.\./.test(res.text)) return "The function should still show \"Checking drive C...\" on screen (Write-Host).";
          return true;
        }
      },
      {
        id: "scope",
        text: "Each call to <code>Add-Event</code> adds 1 to the script-level <code>$EventCount</code>.",
        hints: ["Inside the function, $EventCount++ changes a local copy. Use $script:EventCount++.", "function Add-Event {\n    $script:EventCount++\n}"],
        check: function (r) {
          if (!r.fn("Add-Event")) return "I can't find a function called Add-Event.";
          var before = r.v("EventCount");
          if (typeof before !== "number") return "$EventCount should start as a number (0).";
          var res = r.ps("Add-Event; Add-Event; Add-Event; $EventCount");
          if (res.value === before) return "After 3 calls to Add-Event, $EventCount is still " + before + ": the function changed a local copy. Use $script:EventCount.";
          if (res.value !== before + 3) return "After 3 calls, $EventCount should go up by 3, but it went from " + before + " to " + H.show(res.raw) + ".";
          return true;
        }
      }
    ],
    debrief: "<p>Ticket closed. The bug in <code>Get-FreeSpaceGB</code> is PowerShell's most famous gotcha: a stray string inside a function silently becomes part of its return value, and code that does <code>if ((Get-FreeSpaceGB C) -lt 10)</code> starts comparing an <b>array</b>. Messages for humans go to Write-Host or Write-Verbose; data goes to output.</p>",
    realworld: "Functions you write in the console disappear when you close it. To keep them, put them in your profile (notepad $PROFILE) or, better, in a module, which Module 4 covers.",
    quiz: [
      { q: "<code>function f { \"hi\"; return 1 }</code>. What does <code>f</code> return?", options: ["1", "@(\"hi\", 1)", "\"hi\"", "An error"], answer: 1,
        why: "Everything the function outputs is returned, not just the return value." },
      { q: "How do you call <code>Get-Sum</code> with -A 1 and -B 2?", options: ["Get-Sum(1, 2)", "Get-Sum -A 1 -B 2", "Get-Sum[1, 2]", "Get-Sum 1, 2"], answer: 1,
        why: "Like a cmdlet: named parameters, spaces, no commas or parentheses." },
      { q: "A function does <code>$total = 5</code>. What happens to the script's <code>$total</code>?", options: ["It becomes 5", "Nothing: the function made its own local $total", "An error", "It's deleted"], answer: 1,
        why: "Use $script:total to change the script-level variable." }
    ]
  });

  /* ================================================================== PS-109 */
  LABS.push({
    id: "ps-109", n: 9, module: 1, ticket: "PS-109", xp: 100,
    title: "A safe restart tool",
    topic: "Advanced functions: validation, pipeline input, -WhatIf",
    from: DEV,
    story: "<p>Last month someone restarted the wrong service on a production box with a quick script, and took the website down. Security's new rule: any tool that changes a production server must <b>refuse bad input</b>, support <b>-WhatIf</b> so you can see what it would do first, and explain itself with <b>-Verbose</b>.</p>" +
      "<p>Turn a simple restart helper into a proper, safe tool.</p>",
    learn:
      "<h3>[CmdletBinding()]: an advanced function</h3><p>Add <code>[CmdletBinding()]</code> above <code>param( )</code> and your function gets the common parameters that every cmdlet has, such as <code>-Verbose</code> and <code>-ErrorAction</code>. <code>Write-Verbose</code> messages only show when the caller asks for them:</p>" +
      ex('function Get-Thing {\n    [CmdletBinding()]\n    param()\n    Write-Verbose "Looking things up..."\n    "thing"\n}\nGet-Thing\nGet-Thing -Verbose') +
      "<h3>Validating parameters</h3><p>Attributes before a parameter make PowerShell check the value <b>before</b> your code runs, and give the caller a clear error:</p>" +
      '<table class="t"><tr><th>Attribute</th><th>Rule</th></tr>' +
      "<tr><td><code>[Parameter(Mandatory)]</code></td><td>must be given</td></tr>" +
      "<tr><td><code>[ValidateSet('a','b')]</code></td><td>must be one of these</td></tr>" +
      "<tr><td><code>[ValidateRange(1, 5)]</code></td><td>a number from 1 to 5</td></tr>" +
      "<tr><td><code>[ValidateNotNullOrEmpty()]</code></td><td>no empty values</td></tr></table>" +
      ex('function Set-Mode {\n    [CmdletBinding()]\n    param([Parameter(Mandatory)][ValidateSet("dev", "prod")][string]$Mode)\n    "Mode is $Mode"\n}\nSet-Mode -Mode prod\nSet-Mode -Mode test') +
      "<h3>Pipeline input: process { }</h3><p><code>ValueFromPipeline</code> lets values arrive through <code>|</code>. Put the work in a <code>process { }</code> block: it runs once <b>per item</b>. (<code>begin { }</code> runs once before the items and <code>end { }</code> once after.)</p>" +
      ex('function Get-Shout {\n    [CmdletBinding()]\n    param([Parameter(Mandatory, ValueFromPipeline)][string]$Text)\n    process { $Text.ToUpper() + "!" }\n}\n"hello", "world" | Get-Shout') +
      "<h3>-WhatIf: SupportsShouldProcess</h3><p>With <code>[CmdletBinding(SupportsShouldProcess)]</code>, your function accepts <code>-WhatIf</code>. Wrap the risky action in <code>if ($PSCmdlet.ShouldProcess($target)) { ... }</code>: with -WhatIf it prints what it <em>would</em> do and returns <code>$false</code>, so nothing happens.</p>" +
      ex('function Remove-Report {\n    [CmdletBinding(SupportsShouldProcess)]\n    param([string]$Name)\n    if ($PSCmdlet.ShouldProcess($Name)) { "deleted $Name" }\n}\nRemove-Report -Name q3.csv -WhatIf\nRemove-Report -Name q3.csv'),
    starter: ps`
      # PS-109 · A safe restart tool
      # Build Restart-KestrelService:
      #  - [CmdletBinding(SupportsShouldProcess)]
      #  - -Name: mandatory; only 'KestrelAgent', 'KestrelUpdater' or 'W3SVC'; can come from the pipeline
      #  - -Retries: a number from 1 to 5, default 3
      #  - for each name: Write-Verbose "Restarting <name> (retries: <n>)", then
      #    if $PSCmdlet.ShouldProcess(<name>): Restart-Service -Name <name> and output "<name> restarted"
      function Restart-KestrelService {

      }

      Restart-KestrelService -Name W3SVC -WhatIf
    `,
    objectives: [
      {
        id: "validate",
        text: "<code>-Name</code> is mandatory and accepts only <code>KestrelAgent</code>, <code>KestrelUpdater</code> or <code>W3SVC</code>. <code>Restart-KestrelService -Name W3SVC</code> restarts it and outputs <code>W3SVC restarted</code>.",
        hints: ["param( [Parameter(Mandatory, ValueFromPipeline)] [ValidateSet('KestrelAgent', 'KestrelUpdater', 'W3SVC')] [string]$Name, ... ).",
          "function Restart-KestrelService {\n    [CmdletBinding(SupportsShouldProcess)]\n    param(\n        [Parameter(Mandatory, ValueFromPipeline)]\n        [ValidateSet('KestrelAgent', 'KestrelUpdater', 'W3SVC')]\n        [string]$Name\n    )\n    process {\n        if ($PSCmdlet.ShouldProcess($Name)) {\n            Restart-Service -Name $Name\n            \"$Name restarted\"\n        }\n    }\n}"],
        check: function (r) {
          if (!r.fn("Restart-KestrelService")) return "I can't find a function called Restart-KestrelService.";
          var before = r.system.actions.length;
          var res = r.ps("Restart-KestrelService -Name W3SVC");
          if (!res.ok) return "Restart-KestrelService -Name W3SVC failed: " + res.errors[0];
          if (!H.same(res.value, "W3SVC restarted")) return "Restart-KestrelService -Name W3SVC should output \"W3SVC restarted\", got " + H.show(res.raw) + ".";
          if (r.system.actions.slice(before).indexOf("Restart-Service W3SVC") < 0) return "It should really restart the service: call Restart-Service -Name $Name.";
          var bad = r.ps("Restart-KestrelService -Name Spooler");
          if (bad.ok || !/ValidateSet/.test(bad.errors.join(" "))) return "Restart-KestrelService -Name Spooler should be refused by a [ValidateSet(...)] attribute.";
          var none = r.ps("Restart-KestrelService");
          if (none.ok || !/mandatory/i.test(none.errors.join(" "))) return "Calling it without -Name should fail: make -Name [Parameter(Mandatory)].";
          return true;
        }
      },
      {
        id: "range",
        text: "<code>-Retries</code> accepts 1 to 5 only, defaults to 3, and <code>-Verbose</code> shows <code>VERBOSE: Restarting W3SVC (retries: 3)</code>.",
        hints: ["[ValidateRange(1, 5)][int]$Retries = 3, and Write-Verbose \"Restarting $Name (retries: $Retries)\" in process { }.",
          "[ValidateRange(1, 5)]\n[int]$Retries = 3\n...\nWrite-Verbose \"Restarting $Name (retries: $Retries)\""],
        check: function (r) {
          if (!r.fn("Restart-KestrelService")) return "I can't find a function called Restart-KestrelService.";
          var v = r.ps("Restart-KestrelService -Name W3SVC -Verbose");
          if (!/VERBOSE: Restarting W3SVC \(retries: 3\)/.test(v.text)) return "With -Verbose, it should show VERBOSE: Restarting W3SVC (retries: 3). Got:\n  " + (v.text || "(nothing)").split("\n").join("\n  ");
          var two = r.ps("Restart-KestrelService -Name W3SVC -Retries 2 -Verbose");
          if (!/retries: 2\)/.test(two.text)) return "-Retries 2 should show (retries: 2) in the verbose message.";
          var hi = r.ps("Restart-KestrelService -Name W3SVC -Retries 9");
          if (hi.ok || !/maximum/i.test(hi.errors.join(" "))) return "-Retries 9 should be refused. Add [ValidateRange(1, 5)].";
          var lo = r.ps("Restart-KestrelService -Name W3SVC -Retries 0");
          if (lo.ok) return "-Retries 0 should be refused too.";
          return true;
        }
      },
      {
        id: "pipeline",
        text: "Names can come through the pipeline: <code>\"KestrelAgent\", \"KestrelUpdater\" | Restart-KestrelService</code> restarts both.",
        hints: ["ValueFromPipeline in the Parameter attribute, and the work inside process { }.", "[Parameter(Mandatory, ValueFromPipeline)]\n...\nprocess {\n    ...\n}"],
        check: function (r) {
          if (!r.fn("Restart-KestrelService")) return "I can't find a function called Restart-KestrelService.";
          var before = r.system.actions.length;
          var res = r.ps('"KestrelAgent", "KestrelUpdater" | Restart-KestrelService');
          if (!res.ok) return "Piping two names failed: " + res.errors[0];
          if (!H.same(res.value, ["KestrelAgent restarted", "KestrelUpdater restarted"])) return "Piping two names should output both \"... restarted\" lines, got " + H.show(res.raw) + ". Put the work in a process { } block.";
          var acts = r.system.actions.slice(before);
          if (acts.indexOf("Restart-Service KestrelAgent") < 0 || acts.indexOf("Restart-Service KestrelUpdater") < 0) return "Both services should really be restarted.";
          return true;
        }
      },
      {
        id: "whatif",
        text: "<code>Restart-KestrelService -Name W3SVC -WhatIf</code> prints a <code>What if:</code> line and restarts nothing.",
        hints: ["[CmdletBinding(SupportsShouldProcess)], and only restart inside if ($PSCmdlet.ShouldProcess($Name)) { ... }.", "if ($PSCmdlet.ShouldProcess($Name)) {\n    Restart-Service -Name $Name\n    \"$Name restarted\"\n}"],
        check: function (r) {
          if (!r.fn("Restart-KestrelService")) return "I can't find a function called Restart-KestrelService.";
          var before = r.system.actions.length;
          var res = r.ps("Restart-KestrelService -Name W3SVC -WhatIf");
          if (!res.ok && /parameter name 'WhatIf'/.test(res.errors.join(" "))) return "-WhatIf isn't accepted yet: use [CmdletBinding(SupportsShouldProcess)].";
          if (!/What if:/.test(res.text)) return "With -WhatIf, it should print a \"What if:\" line. Wrap the restart in if ($PSCmdlet.ShouldProcess($Name)) { ... }.";
          if (r.system.actions.length !== before) return "With -WhatIf, nothing should be restarted, but it ran: " + r.system.actions.slice(before).join(", ") + ".";
          if (res.items.length) return "With -WhatIf, it shouldn't output \"restarted\", because it didn't restart anything.";
          return true;
        }
      }
    ],
    debrief: "<p>Ticket closed. Look at what PowerShell did for you: you never wrote a single if to check the name or the range, or code to loop over pipeline input, or the What if message. The attributes and <code>ShouldProcess</code> handled all of it, and your tool now behaves exactly like a built-in cmdlet.</p>" +
      "<p>For anything that changes systems, <code>-WhatIf</code> is the habit that prevents outages: run it once, read what it would do, then run it for real.</p>",
    realworld: "Every built-in command that changes something supports -WhatIf. Try Stop-Service -Name Spooler -WhatIf or Remove-Item C:\\Windows -Recurse -WhatIf in your PowerShell: both are completely safe with -WhatIf.",
    quiz: [
      { q: "What does <code>[ValidateSet('a', 'b')]</code> do when someone passes 'c'?", options: ["Uses 'a' instead", "PowerShell refuses the call with an error before your code runs", "Nothing", "Your code must check it"], answer: 1,
        why: "Validation attributes run before the function body." },
      { q: "Why put the work in <code>process { }</code>?", options: ["It's faster", "It runs once per pipeline item; without it, only the last item would be handled", "It's required by CmdletBinding", "It hides output"], answer: 1,
        why: "begin runs once, process once per item, end once at the end." },
      { q: "With <code>-WhatIf</code>, what does <code>$PSCmdlet.ShouldProcess(...)</code> return?", options: ["$true", "$false, after printing what it would have done", "An error", "The target"], answer: 1,
        why: "So the code inside the if is skipped." }
    ]
  });

  /* ================================================================== PS-110 capstone */
  var HR_CSV = lines(
    "Username,FullName,Department,Status,LeftOn",
    "ana.silva,Ana Silva,Support,Active,",
    "ben.okoro,Ben Okoro,Engineering,Active,",
    "chris.lee,Chris Lee,Engineering,Active,",
    "dana.park,Dana Park,IT,Active,",
    "ed.moss,Ed Moss,Finance,Leaver,2026-10-31",
    "fay.wong,Fay Wong,Engineering,Leaver,2026-05-01",
    "gus.hall,Gus Hall,Marketing,Active,");
  var AUDIT_WANT = [
    { Username: "chris.lee", Finding: "Inactive 90+ days" },
    { Username: "ed.moss", Finding: "Leaver still enabled" },
    { Username: "gus.hall", Finding: "Admin outside IT" },
    { Username: "temp.admin", Finding: "Inactive 90+ days" },
    { Username: "temp.admin", Finding: "No HR record" }];
  function auditCall(r, code) {
    var res = r.ps("@(" + code + ") | ForEach-Object { [PSCustomObject]@{ Username = $_.Username; Finding = $_.Finding } }");
    return res;
  }
  function showFindings(list) { return (list || []).map(function (f) { return f && (f.Username + ": " + f.Finding); }).join("\n  ") || "(none)"; }

  LABS.push({
    id: "ps-110", n: 10, module: 1, ticket: "PS-110", xp: 200, capstone: true,
    title: "Leavers and lingering admins",
    topic: "Module 1 capstone project",
    from: "Dana Park & Dev Patel",
    story: "<p>It's the quarterly access review for <code>KC-WIN-01</code>, and the auditors want evidence that every account on the server belongs to a current employee, is actually used, and has no more rights than it needs.</p>" +
      "<p>HR has sent an export. Compare it with the server's local accounts, write up every problem, and save a report the auditors can open. Everything from Module 1, in one script.</p>",
    learn:
      '<div class="callout warn"><b>Capstone rules.</b> There are no hints. Build one piece at a time and try things in the console (e.g. <code>Import-Csv data\\hr.csv</code> or <code>Get-LocalUser | Format-List *</code>). ' +
      "If you get completely stuck, the Tasks tab has a button to reveal the full solution. The capstone then earns half XP.</div>" +
      "<h3>The data</h3>" +
      '<table class="t"><tr><th>Source</th><th>What\'s in it</th></tr>' +
      "<tr><td><code>Import-Csv data\\hr.csv</code></td><td><code>Username</code>, <code>FullName</code>, <code>Department</code>, <code>Status</code> (<code>Active</code> or <code>Leaver</code>), <code>LeftOn</code></td></tr>" +
      "<tr><td><code>Get-LocalUser</code></td><td><code>Name</code>, <code>Enabled</code>, <code>LastLogon</code> (a date, or <code>$null</code> if never), <code>Description</code></td></tr>" +
      "<tr><td><code>Get-LocalGroupMember Administrators</code></td><td>members; <code>Name</code> looks like <code>KC-WIN-01\\dana.park</code></td></tr>" +
      "<tr><td><code>Get-Date</code></td><td>today in the lab: 10 November 2026</td></tr></table>" +
      "<h3>The rules</h3><p>Only check <b>enabled</b> accounts, and skip service accounts (names starting with <code>svc-</code>). For each remaining account, these are findings:</p>" +
      '<table class="t"><tr><th>Finding text</th><th>When</th></tr>' +
      "<tr><td><code>Leaver still enabled</code></td><td>HR says <code>Leaver</code></td></tr>" +
      "<tr><td><code>No HR record</code></td><td>the username isn't in the HR file</td></tr>" +
      "<tr><td><code>Inactive 90+ days</code></td><td>the last logon is more than <code>$InactiveDays</code> days before today (never logged on counts too). Use the number in the text: <code>Inactive 30+ days</code> when <code>-InactiveDays 30</code></td></tr>" +
      "<tr><td><code>Admin outside IT</code></td><td>a member of Administrators whose HR department isn't <code>IT</code> (only for accounts that have an HR record)</td></tr></table>" +
      "<h3>What to build</h3>" +
      '<table class="t"><tr><th>Piece</th><th>Spec</th></tr>' +
      "<tr><td><code>Get-AccountAudit</code></td><td>parameters <code>-HrPath</code> (default <code>data\\hr.csv</code>) and <code>-InactiveDays</code> (default 90). Returns one <code>[PSCustomObject]</code> per finding with <code>Username</code> and <code>Finding</code>, sorted by Username, then Finding.</td></tr>" +
      "<tr><td>printed report</td><td>one line per finding, <code>ed.moss: Leaver still enabled</code>, then <code>4 accounts need action (5 findings)</code></td></tr>" +
      "<tr><td>CSV for the auditors</td><td>the findings saved to <code>reports\\access-review.csv</code> with <code>Export-Csv</code></td></tr></table>" +
      "<p>A hashtable keyed by username makes the HR lookups easy. To strip the computer name from <code>KC-WIN-01\\dana.park</code>, use <code>-replace '^.*\\\\', ''</code> or <code>.Split('\\')[-1]</code>.</p>" +
      "<h3>Expected output</h3>" +
      '<pre class="code">chris.lee: Inactive 90+ days\ned.moss: Leaver still enabled\ngus.hall: Admin outside IT\ntemp.admin: Inactive 90+ days\ntemp.admin: No HR record\n4 accounts need action (5 findings)</pre>',
    starter: ps`
      # PS-110 · Leavers and lingering admins (Module 1 capstone)

      function Get-AccountAudit {

      }

      # Run the audit, print the report and export the CSV
    `,
    files: { "data/hr.csv": HR_CSV },
    solution: ps`
      function Get-AccountAudit {
          [CmdletBinding()]
          param(
              [string]$HrPath = "data\hr.csv",
              [int]$InactiveDays = 90
          )

          $hr = @{}
          foreach ($row in Import-Csv $HrPath) {
              $hr[$row.Username] = $row
          }
          $admins = (Get-LocalGroupMember -Group Administrators).Name -replace '^.*\\', ''
          $cutoff = (Get-Date).AddDays(-$InactiveDays)

          $findings = foreach ($user in Get-LocalUser) {
              if (-not $user.Enabled -or $user.Name -like "svc-*") { continue }
              $record = $hr[$user.Name]

              if (-not $record) {
                  [PSCustomObject]@{ Username = $user.Name; Finding = "No HR record" }
              }
              elseif ($record.Status -eq "Leaver") {
                  [PSCustomObject]@{ Username = $user.Name; Finding = "Leaver still enabled" }
              }
              if (-not $user.LastLogon -or $user.LastLogon -lt $cutoff) {
                  [PSCustomObject]@{ Username = $user.Name; Finding = "Inactive $InactiveDays+ days" }
              }
              if ($record -and $user.Name -in $admins -and $record.Department -ne "IT") {
                  [PSCustomObject]@{ Username = $user.Name; Finding = "Admin outside IT" }
              }
          }
          $findings | Sort-Object Username, Finding
      }

      $findings = Get-AccountAudit
      foreach ($f in $findings) {
          "$($f.Username): $($f.Finding)"
      }
      $accounts = ($findings | Select-Object -ExpandProperty Username -Unique).Count
      "$accounts accounts need action ($($findings.Count) findings)"

      $findings | Export-Csv -Path reports\access-review.csv
    `,
    objectives: [
      {
        id: "audit", hints: [],
        text: "<code>Get-AccountAudit</code> returns the 5 findings as objects with <code>Username</code> and <code>Finding</code>, sorted by Username then Finding.",
        check: function (r) {
          if (!r.fn("Get-AccountAudit")) return "I can't find a function called Get-AccountAudit.";
          var res = auditCall(r, "Get-AccountAudit");
          if (!res.ok) return "Get-AccountAudit failed: " + res.errors[0];
          var got = Array.isArray(res.value) ? res.value : res.value ? [res.value] : [];
          if (!H.same(got, AUDIT_WANT)) return "Get-AccountAudit should return:\n  " + showFindings(AUDIT_WANT) + "\nIt returned:\n  " + showFindings(got);
          return true;
        }
      },
      {
        id: "days", hints: [],
        text: "<code>-InactiveDays</code> changes the threshold and the finding text: with <code>-InactiveDays 20</code>, <code>ed.moss</code> (30 days) is inactive too.",
        check: function (r) {
          if (!r.fn("Get-AccountAudit")) return "I can't find a function called Get-AccountAudit.";
          var res = auditCall(r, "Get-AccountAudit -InactiveDays 20");
          if (!res.ok) return "Get-AccountAudit -InactiveDays 20 failed: " + res.errors[0];
          var want = [{ Username: "chris.lee", Finding: "Inactive 20+ days" }, { Username: "ed.moss", Finding: "Inactive 20+ days" }, { Username: "ed.moss", Finding: "Leaver still enabled" },
            { Username: "gus.hall", Finding: "Admin outside IT" }, { Username: "temp.admin", Finding: "Inactive 20+ days" }, { Username: "temp.admin", Finding: "No HR record" }];
          var got = Array.isArray(res.value) ? res.value : res.value ? [res.value] : [];
          if (!H.same(got, want)) return "Get-AccountAudit -InactiveDays 20 should return:\n  " + showFindings(want) + "\nIt returned:\n  " + showFindings(got);
          return true;
        }
      },
      {
        id: "hrpath", hints: [],
        text: "<code>-HrPath</code> reads a different HR file: after an update where <code>gus.hall</code> moved to IT, there's no <code>Admin outside IT</code> finding.",
        check: function (r) {
          if (!r.fn("Get-AccountAudit")) return "I can't find a function called Get-AccountAudit.";
          var r2 = r.run(null, { files: { "data/hr-updated.csv": HR_CSV.replace("Gus Hall,Marketing", "Gus Hall,IT") } });
          var res = auditCall(r2, "Get-AccountAudit -HrPath data\\hr-updated.csv");
          if (!res.ok) return "Get-AccountAudit -HrPath data\\hr-updated.csv failed: " + res.errors[0];
          var got = Array.isArray(res.value) ? res.value : res.value ? [res.value] : [];
          var want = AUDIT_WANT.filter(function (f) { return f.Username !== "gus.hall"; });
          if (!H.same(got, want)) return "With an HR file where gus.hall is in IT, Get-AccountAudit -HrPath should return:\n  " + showFindings(want) + "\nIt returned:\n  " + showFindings(got);
          return true;
        }
      },
      {
        id: "report", hints: [],
        text: "The script prints one line per finding and the summary <code>4 accounts need action (5 findings)</code>.",
        check: function (r) {
          var want = AUDIT_WANT.map(function (f) { return f.Username + ": " + f.Finding; }).concat(["4 accounts need action (5 findings)"]);
          return H.printed(r, want);
        }
      },
      {
        id: "export", hints: [],
        text: "The findings are saved to <code>reports\\access-review.csv</code> with columns <code>Username</code> and <code>Finding</code>.",
        check: function (r) {
          var text = r.file("reports\\access-review.csv");
          if (text === null) return "reports\\access-review.csv wasn't created. Use $findings | Export-Csv -Path reports\\access-review.csv.";
          var rows = text.trim().split("\n");
          var want = ['"Username","Finding"'].concat(AUDIT_WANT.map(function (f) { return '"' + f.Username + '","' + f.Finding + '"'; }));
          if (!H.same(rows, want)) return "reports\\access-review.csv should contain:\n  " + want.join("\n  ") + "\nIt contains:\n  " + rows.slice(0, 8).join("\n  ");
          return true;
        }
      }
    ],
    debrief: "<p><b>Module 1 complete.</b> Your audit found a leaver who can still log in, an admin in Marketing, a forgotten account nobody can explain, and an inactive developer. Every one of them is an open door, and the auditors have it in a CSV.</p>" +
      "<p>Look at what it took: CSV in, objects, a hashtable lookup, conditions, a loop, a function with parameters, sorting and export. That's the whole of Module 1. Module 2 goes deeper into the Windows system itself: files, event logs and the registry.</p>",
    realworld: "On your own PC, Get-LocalUser | Select-Object Name, Enabled, LastLogon and Get-LocalGroupMember -Group Administrators show the real thing. (On a work machine, accounts usually live in Active Directory instead: the ActiveDirectory module's Get-ADUser works the same way.)",
    quiz: []
  });

  /* ================================================================== Roadmap */
  var UPCOMING = [
    { module: 2, title: "Files & paths", topic: "Get-ChildItem, Get-Content, Test-Path" },
    { module: 2, title: "CSV & JSON", topic: "Import/Export-Csv, ConvertFrom-Json, -Depth" },
    { module: 2, title: "Text & regex", topic: "Select-String, -replace, -split" },
    { module: 2, title: "Errors", topic: "try/catch, -ErrorAction Stop" },
    { module: 2, title: "Processes & services", topic: "Spot the odd one out" },
    { module: 2, title: "Event logs", topic: "Get-WinEvent, 4625 brute force" },
    { module: 2, title: "Registry & persistence", topic: "Run keys and backdoors" },
    { module: 2, title: "Module 2 capstone", topic: "Incident triage script", capstone: true },
    { module: 3, title: "Quick GUIs", topic: "Out-GridView, message boxes" },
    { module: 3, title: "Windows Forms basics", topic: "Form, Label, TextBox, Button" },
    { module: 3, title: "Events", topic: "add_Click and validation" },
    { module: 3, title: "Lists & grids", topic: "ListBox, ComboBox, DataGridView" },
    { module: 3, title: "Dialogs & tool design", topic: "File dialogs, testable logic" },
    { module: 3, title: "WPF & XAML", topic: "Describe the window in XAML" },
    { module: 3, title: "Module 3 capstone", topic: "Help-desk toolkit", capstone: true },
    { module: 4, title: "Secrets", topic: "SecureString, credentials, $env:" },
    { module: 4, title: "Hashing & integrity", topic: "Get-FileHash" },
    { module: 4, title: "REST APIs", topic: "Invoke-RestMethod" },
    { module: 4, title: "Users & permissions", topic: "Get-Acl, local admins" },
    { module: 4, title: "Attacker PowerShell", topic: "-EncodedCommand, logging, AMSI" },
    { module: 4, title: "Execution policy & signing", topic: "What it does and doesn't do" },
    { module: 4, title: "Pester & PSScriptAnalyzer", topic: "Test and lint your scripts" },
    { module: 4, title: "PowerShell in CI", topic: "Exit codes, pwsh in Actions" },
    { module: 4, title: "Module 4 capstone", topic: "Windows hardening checker", capstone: true }
  ];

  /* ================================================================== Reference solutions */
  var SOLUTIONS = {
    "ps-101": ps`
      $serviceCmds = (Get-Command -Noun Service).Name
      $param = "DisplayName"
      $props = (Get-Service | Get-Member -MemberType Property).Name
      $lsReal = (Get-Alias ls).Definition
    `,
    "ps-102": ps`
      $server = "web-01"
      $port = 443

      $url = "https://$\{server}:$port/health"
      $note = 'Cost: $5 per GB'

      $fromConfig = "40"
      $total = [int]$fromConfig + 2

      $line = "{0,-10}| {1}" -f $server, $port

      $motd = @"
      Welcome to $server
      Authorised users only
      "@
    `,
    "ps-103": ps`
      $stopped = Get-Service | Where-Object Status -eq Stopped | Select-Object -ExpandProperty Name

      $autoButStopped = Get-Service |
          Where-Object { $_.StartType -eq "Automatic" -and $_.Status -eq "Stopped" } |
          Select-Object -ExpandProperty Name

      $top3 = Get-Process | Sort-Object CPU -Descending | Select-Object -First 3 -ExpandProperty Name

      $noCompany = Get-Process | Where-Object { -not $_.Company } | Select-Object -ExpandProperty Name
    `,
    "ps-104": ps`
      $memReport = Get-Process |
          Select-Object Name, @{ Name = "MemoryMB"; Expression = { [math]::Round($_.WS / 1MB, 1) } } |
          Where-Object MemoryMB -gt 100 |
          Sort-Object MemoryMB -Descending

      $byCompany = Get-Process | Group-Object Company

      $cpuTotal = (Get-Process | Measure-Object CPU -Sum).Sum

      $svcSummary = (Get-Service | Group-Object Status | ForEach-Object { "$($_.Name): $($_.Count)" }) -join ", "
    `,
    "ps-105": INV_DATA + "\n\n" + ps`
      $servers += "cache-01"
      $lastServer = $servers[-1]
      $serverCount = $servers.Count

      $owners["cache-01"] = "platform"
      $dbOwner = $owners["db-01"]

      $inventory = foreach ($name in $servers) {
          $owner = $owners[$name]
          [PSCustomObject]@{ Name = $name; Owner = $owner; Port = $ports[$owner] }
      }

      $webServers = $inventory | Where-Object Owner -eq "web" | Select-Object -ExpandProperty Name
    `,
    "ps-106": ps`
      $cpu = 87
      if ($cpu -ge 90) { $level = "critical" }
      elseif ($cpu -ge 75) { $level = "warning" }
      else { $level = "ok" }

      $hosts = @("web-prod-01", "db-dev-02", "api-prod-03", "build-agent-7")
      $envs = switch -Wildcard ($hosts) {
          "*-prod-*" { "production" }
          "*-dev-*"  { "development" }
          default    { "unknown" }
      }

      $subject = "ALERT [P1] TICKET-4521: disk full on web-prod-01"
      if ($subject -match "TICKET-(\d+)") { $ticket = $Matches[1] }

      $allowed = @("dana.park", "ana.silva")
      $requester = "Ana.Silva"
      $canDeploy = $requester -in $allowed
    `,
    "ps-107": ps`
      $sizesMB = @(120, 340, 75, 910, 55)
      $totalMB = 0
      foreach ($size in $sizesMB) {
          $totalMB += $size
      }

      $ports = for ($p = 8080; $p -le 8085; $p += 2) { $p }

      $attempts = 0
      do {
          $attempts++
          $healthy = Test-Health -Attempt $attempts
      } until ($healthy)

      $log = @("# nightly job", "start backup", "copy db-01", "# retry", "copy web-01", "END", "copy web-02")
      $steps = foreach ($line in $log) {
          if ($line -like "#*") { continue }
          if ($line -eq "END") { break }
          $line
      }

      $names = @("web-01", "db-01", "cache-01")
      $upper = $names | ForEach-Object { $_.ToUpper() }
    `,
    "ps-108": ps`
      function Get-Greeting {
          param([string]$Name, [string]$Greeting = "Hello")
          "$Greeting, $Name!"
      }

      function ConvertTo-Bytes {
          param([double]$Size, [string]$Unit)
          switch ($Unit) {
              "KB" { $Size * 1KB }
              "MB" { $Size * 1MB }
              "GB" { $Size * 1GB }
          }
      }

      function Get-FreeSpaceGB {
          param($Drive)
          Write-Host "Checking drive $Drive..."
          $free = 120
          return $free
      }

      $EventCount = 0
      function Add-Event {
          $script:EventCount++
      }
    `,
    "ps-109": ps`
      function Restart-KestrelService {
          [CmdletBinding(SupportsShouldProcess)]
          param(
              [Parameter(Mandatory, ValueFromPipeline)]
              [ValidateSet("KestrelAgent", "KestrelUpdater", "W3SVC")]
              [string]$Name,

              [ValidateRange(1, 5)]
              [int]$Retries = 3
          )
          process {
              Write-Verbose "Restarting $Name (retries: $Retries)"
              if ($PSCmdlet.ShouldProcess($Name)) {
                  Restart-Service -Name $Name
                  "$Name restarted"
              }
          }
      }

      Restart-KestrelService -Name W3SVC -WhatIf
    `
  };

  LABS.forEach(function (l) { if (!l.solution && SOLUTIONS[l.id]) l.solution = SOLUTIONS[l.id]; l.drills = []; });

  window.PS_TRACK = { MODULES: MODULES, LABS: LABS, UPCOMING: UPCOMING, ps: ps, ex: ex, lines: lines };
})();
