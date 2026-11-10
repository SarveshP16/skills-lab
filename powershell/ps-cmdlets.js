/* sudo learn — cmdlets, help text, display views and the pretend Windows machine for the PowerShell engine.
   Each cmdlet: { name, module, params: [{name, type, position, aliases}], run(bound, input, ctx), help }.
   bound has lowercase parameter names; input is the pipeline input array, or null for the first command. */
(function (root) {
  "use strict";
  var E = root.PSEngine;
  var PSObject = E.PSObject, PSHashtable = E.PSHashtable, PSDate = E.PSDate, PSTimeSpan = E.PSTimeSpan, ScriptBlock = E.ScriptBlock, PSType = E.PSType;
  var toStr = E.toStr, toBool = E.toBool, toNumber = E.toNumber, lc = E.lc, obj = E.obj, enumerate = E.enumerate;
  function err(msg, cat) { return new E.PSError(msg, { category: cat || "InvalidArgument" }); }

  var lib = E.lib;
  lib.cmdlets = {};
  lib.aliases = {};
  lib.views = {};
  lib.listTypes = {};

  function C(name, module, params, run, help) {
    lib.cmdlets[lc(name)] = { name: name, module: module, params: params, run: run, help: help || {} };
  }
  function alias(a, target) { lib.aliases[lc(a)] = target; }
  function sw(name) { return { name: name, type: "switch" }; }
  function p(name, position, extra) { var o = { name: name, position: position == null ? null : position }; if (extra) for (var k in extra) o[k] = extra[k]; return o; }
  var MGMT = "Microsoft.PowerShell.Management", UTIL = "Microsoft.PowerShell.Utility", CORE = "Microsoft.PowerShell.Core", LOCAL = "Microsoft.PowerShell.LocalAccounts";

  // Input for a cmdlet: pipeline items, or the -InputObject value.
  function inputItems(input, bound) {
    if (input !== null && input !== undefined) return input;
    if (bound.inputobject !== undefined) return enumerate(bound.inputobject);
    return [];
  }
  function list(v) { return v === undefined || v === null ? [] : Array.isArray(v) ? v : [v]; }
  function names(v) { return list(v).map(toStr); }
  function matchAny(name, patterns) { return patterns.some(function (pt) { return E.wildcardRe(pt).test(name); }); }
  function hasWildcard(s) { return /[*?\[]/.test(s); }

  /* ================================================================== Pretend Windows machine */
  var NOW = Date.UTC(2026, 10, 10, 9, 0, 0); // Tuesday 10 November 2026, 09:00
  function svc(Name, DisplayName, Status, StartType) { return { Name: Name, DisplayName: DisplayName, Status: Status, StartType: StartType }; }
  var SERVICES = [
    svc("BITS", "Background Intelligent Transfer Service", "Running", "Manual"),
    svc("Dnscache", "DNS Client", "Running", "Automatic"),
    svc("EventLog", "Windows Event Log", "Running", "Automatic"),
    svc("KestrelAgent", "Kestrel Monitoring Agent", "Running", "Automatic"),
    svc("KestrelUpdater", "Kestrel Update Service", "Stopped", "Automatic"),
    svc("MSSQLSERVER", "SQL Server (MSSQLSERVER)", "Running", "Automatic"),
    svc("RemoteRegistry", "Remote Registry", "Stopped", "Disabled"),
    svc("Spooler", "Print Spooler", "Running", "Automatic"),
    svc("sshd", "OpenSSH SSH Server", "Running", "Automatic"),
    svc("TermService", "Remote Desktop Services", "Running", "Manual"),
    svc("W32Time", "Windows Time", "Running", "Manual"),
    svc("W3SVC", "World Wide Web Publishing Service", "Running", "Automatic"),
    svc("WinRM", "Windows Remote Management (WS-Management)", "Running", "Automatic"),
    svc("wuauserv", "Windows Update", "Stopped", "Manual")
  ];
  function proc(Name, Id, CPU, WSmb, Company, Path, StartedMinutesAgo) { return { Name: Name, Id: Id, CPU: CPU, WS: Math.round(WSmb * 1048576), Company: Company, Path: Path, Ago: StartedMinutesAgo }; }
  var PROCESSES = [
    proc("svchost", 812, 12.5, 24.8, "Microsoft Corporation", "C:\\Windows\\System32\\svchost.exe", 20160),
    proc("svchost", 1024, 3.25, 18.1, "Microsoft Corporation", "C:\\Windows\\System32\\svchost.exe", 20160),
    proc("svchost", 1440, 48.75, 61.3, "Microsoft Corporation", "C:\\Windows\\System32\\svchost.exe", 20160),
    proc("lsass", 680, 7.5, 22.4, "Microsoft Corporation", "C:\\Windows\\System32\\lsass.exe", 20160),
    proc("w3wp", 3304, 286.4, 412.6, "Microsoft Corporation", "C:\\Windows\\System32\\inetsrv\\w3wp.exe", 2880),
    proc("sqlservr", 2216, 1904.2, 2350.5, "Microsoft Corporation", "C:\\Program Files\\Microsoft SQL Server\\MSSQL16\\MSSQL\\Binn\\sqlservr.exe", 20100),
    proc("kestrel-agent", 4410, 95.6, 88.2, "Kestrel Cloud", "C:\\Program Files\\Kestrel\\kestrel-agent.exe", 20150),
    proc("kestrel-sync", 4588, 12.0, 46.7, "Kestrel Cloud", "C:\\Program Files\\Kestrel\\kestrel-sync.exe", 600),
    proc("explorer", 5120, 33.1, 96.4, "Microsoft Corporation", "C:\\Windows\\explorer.exe", 300),
    proc("pwsh", 4242, 4.8, 105.9, "Microsoft Corporation", "C:\\Program Files\\PowerShell\\7\\pwsh.exe", 15),
    proc("updater", 6666, 512.9, 33.5, null, "C:\\Users\\Public\\updater.exe", 95),
    proc("sshd", 1888, 1.2, 9.6, null, "C:\\Windows\\System32\\OpenSSH\\sshd.exe", 20160)
  ];
  function user(Name, Enabled, LastLogonDaysAgo, Description, FullName) {
    return { Name: Name, Enabled: Enabled, LastLogon: LastLogonDaysAgo == null ? null : NOW - LastLogonDaysAgo * 86400000, Description: Description, FullName: FullName || "" };
  }
  var USERS = [
    user("Administrator", false, null, "Built-in account for administering the computer/domain"),
    user("Guest", false, null, "Built-in account for guest access to the computer/domain"),
    user("ana.silva", true, 1, "Support engineer", "Ana Silva"),
    user("ben.okoro", true, 3, "Developer", "Ben Okoro"),
    user("chris.lee", true, 140, "Developer", "Chris Lee"),
    user("dana.park", true, 2, "Windows team", "Dana Park"),
    user("ed.moss", true, 30, "Finance analyst", "Ed Moss"),
    user("fay.wong", false, 200, "Former contractor", "Fay Wong"),
    user("gus.hall", true, 12, "Marketing", "Gus Hall"),
    user("svc-backup", true, 0, "Backup service account"),
    user("temp.admin", true, 95, "Temporary admin for migration", "Temp Admin")
  ];
  var GROUPS = {
    Administrators: ["Administrator", "dana.park", "gus.hall", "temp.admin", "svc-backup"],
    Users: ["ana.silva", "ben.okoro", "chris.lee", "dana.park", "ed.moss", "fay.wong", "gus.hall", "temp.admin"],
    "Remote Desktop Users": ["ana.silva", "dana.park", "chris.lee"]
  };

  lib.makeSystem = function (opts) {
    opts = opts || {};
    var sys = {
      now: NOW,
      seed: 42,
      actions: [],
      services: SERVICES.map(function (s) { return Object.assign({}, s); }),
      processes: PROCESSES.map(function (x) { return Object.assign({}, x); }),
      users: USERS.map(function (u) { return Object.assign({}, u); }),
      groups: JSON.parse(JSON.stringify(GROUPS)),
      files: {},
      cwd: "C:\\lab",
      stdin: (opts.stdin || []).slice()
    };
    Object.keys(opts.files || {}).forEach(function (f) { fsWrite(sys, f, opts.files[f]); });
    if (opts.system) opts.system(sys);
    return sys;
  };

  /* ---------------- objects for the pretend system */
  function serviceObj(s) {
    var o = obj("System.ServiceProcess.ServiceController", { Name: s.Name, DisplayName: s.DisplayName, Status: s.Status, StartType: s.StartType, ServiceName: s.Name, CanStop: s.Status === "Running", MachineName: "." });
    o.ref = s;
    return o;
  }
  function processObj(x) {
    var o = obj("System.Diagnostics.Process", { Name: x.Name, Id: x.Id, CPU: x.CPU, WS: x.WS, Company: x.Company, Path: x.Path, ProcessName: x.Name, StartTime: new PSDate(NOW - x.Ago * 60000) });
    o.ref = x;
    return o;
  }
  function userObj(u) {
    return obj("Microsoft.PowerShell.Commands.LocalUser", { Name: u.Name, Enabled: u.Enabled, Description: u.Description, FullName: u.FullName,
      LastLogon: u.LastLogon == null ? null : new PSDate(u.LastLogon), PasswordRequired: true, SID: "S-1-5-21-1004336348-1177238915-682003330-" + (1000 + u.Name.length * 7) });
  }
  lib.views["System.ServiceProcess.ServiceController"] = ["Status", "Name", "DisplayName"];
  lib.views["System.Diagnostics.Process"] = [
    { header: "Id", get: function (o) { return o.get("Id"); } },
    { header: "Name", get: function (o) { return o.get("Name"); } },
    { header: "CPU(s)", get: function (o) { var c = o.get("CPU"); return c == null ? null : Math.round(c * 100) / 100; } },
    { header: "WS(M)", get: function (o) { return Math.round(o.get("WS") / 1048576 * 10) / 10; } }
  ];
  lib.views["Microsoft.PowerShell.Commands.LocalUser"] = ["Name", "Enabled", "Description"];
  lib.views["Microsoft.PowerShell.Commands.LocalPrincipal"] = ["ObjectClass", "Name", "PrincipalSource"];
  lib.views["Microsoft.PowerShell.Commands.LocalGroup"] = ["Name", "Description"];
  lib.views["System.Management.Automation.CmdletInfo"] = ["CommandType", "Name", "Version", "Source"];
  lib.views["System.Management.Automation.FunctionInfo"] = ["CommandType", "Name", "Version", "Source"];
  lib.views["System.Management.Automation.AliasInfo"] = [{ header: "CommandType", get: function () { return "Alias"; } }, { header: "Name", get: function (o) { return o.get("DisplayName"); } }, "Version", "Source"];
  lib.views["Microsoft.PowerShell.Commands.GroupInfo"] = ["Count", "Name", "Group"];
  lib.views["Microsoft.PowerShell.Commands.MemberDefinition"] = ["Name", "MemberType", "Definition"];
  lib.views["System.Collections.DictionaryEntry"] = ["Name", "Value"];
  lib.views["System.IO.FileInfo"] = ["Mode", "LastWriteTime", { header: "Length", get: function (o) { return o.get("Length"); } }, "Name"];
  lib.views["System.Management.Automation.VerbInfo"] = ["Verb", "AliasPrefix", "Group"];
  lib.listTypes["Microsoft.PowerShell.Commands.GenericMeasureInfo"] = true;
  lib.listTypes["Microsoft.PowerShell.Commands.TextMeasureInfo"] = true;
  lib.listTypes["System.Management.Automation.ErrorRecord"] = true;

  /* ================================================================== Files (a tiny virtual disk) */
  function normPath(sys, path) {
    var s = toStr(path).replace(/\//g, "\\").trim();
    if (/^[A-Za-z]:\\?/.test(s)) {
      if (lc(s).indexOf(lc(sys.cwd)) === 0) s = s.slice(sys.cwd.length);
      else return { abs: true, key: lc(s), display: s };
    }
    s = s.replace(/^\.\\/, "").replace(/^\\+/, "");
    var parts = [];
    s.split("\\").forEach(function (seg) {
      if (seg === "" || seg === ".") return;
      if (seg === "..") { parts.pop(); return; }
      parts.push(seg);
    });
    var rel = parts.join("\\");
    return { abs: false, key: lc(rel), rel: rel, display: sys.cwd + (rel ? "\\" + rel : "") };
  }
  function fsWrite(sys, path, content) {
    var n = normPath(sys, path);
    sys.files[n.key] = { name: n.rel || n.display, content: String(content), mtime: NOW - 3600000 };
  }
  function fsGet(sys, path) { var n = normPath(sys, path); return sys.files[n.key] || null; }
  function fsIsDir(sys, path) {
    var n = normPath(sys, path);
    if (n.key === "") return true;
    var pre = n.key + "\\";
    return Object.keys(sys.files).some(function (k) { return k.indexOf(pre) === 0; });
  }
  function fileObj(sys, key) {
    var f = sys.files[key];
    var rel = f.name, nm = rel.split("\\").pop();
    var dir = rel.indexOf("\\") >= 0 ? sys.cwd + "\\" + rel.slice(0, rel.lastIndexOf("\\")) : sys.cwd;
    var ext = nm.indexOf(".") >= 0 ? nm.slice(nm.lastIndexOf(".")) : "";
    var o = obj("System.IO.FileInfo", { Name: nm, FullName: sys.cwd + "\\" + rel, DirectoryName: dir, Directory: dir, Extension: ext, BaseName: ext ? nm.slice(0, -ext.length) : nm,
      Length: new TextEncoder().encode(f.content).length, LastWriteTime: new PSDate(f.mtime), Mode: "-a---", PSIsContainer: false });
    o.toStringFn = function () { return sys.cwd + "\\" + rel; };
    return o;
  }
  function dirObj(sys, rel) {
    var nm = rel.split("\\").pop();
    var o = obj("System.IO.FileInfo", { Name: nm, FullName: sys.cwd + "\\" + rel, Extension: "", BaseName: nm, Length: null, LastWriteTime: new PSDate(NOW - 86400000), Mode: "d----", PSIsContainer: true });
    o.toStringFn = function () { return sys.cwd + "\\" + rel; };
    return o;
  }
  function readLines(text) { var l = text.replace(/\r\n/g, "\n").split("\n"); if (l.length && l[l.length - 1] === "") l.pop(); return l; }
  function pathNotFound(ctx, path) {
    E.writeCmdletError(ctx, "Cannot find path '" + normPath(ctx.session.system, path).display + "' because it does not exist.", "ObjectNotFound", path);
  }

  /* ================================================================== Output cmdlets */
  C("Write-Output", UTIL, [p("InputObject", 0), sw("NoEnumerate")], function (b, input) {
    var vals = [];
    if (b.inputobject !== undefined) vals.push(b.inputobject);
    vals = vals.concat(b.__extra || []);
    if (input) return input;
    var out = [];
    vals.forEach(function (v) { if (b.noenumerate) out.push(v); else out = out.concat(enumerate(v)); });
    return out;
  }, { synopsis: "Sends objects down the pipeline (to the next command, or to the screen at the end)." });
  lib.cmdlets["write-output"].allowExtra = true;
  lib.execBlockIn = function (sb, c, out) {
    try { E.execBlock(sb.block, c, out); }
    catch (e) { if (!(e instanceof E.ReturnSignal)) throw e; } // return inside ForEach-Object acts like continue
  };
  alias("echo", "Write-Output"); alias("write", "Write-Output");

  C("Write-Host", UTIL, [p("Object", 0), sw("NoNewline"), p("ForegroundColor"), p("BackgroundColor"), p("Separator")], function (b, input, ctx) {
    var vals = [];
    if (b.object !== undefined) vals.push(b.object);
    vals = vals.concat(b.__extra || []);
    if (input) vals = vals.concat(input);
    var sep = b.separator !== undefined ? toStr(b.separator) : " ";
    var text = vals.map(function (v) { return Array.isArray(v) ? v.map(toStr).join(sep) : toStr(v); }).join(sep);
    var s = ctx.session;
    if (b.nonewline) { s.pendingHost += text; return []; }
    var cls = b.foregroundcolor ? "c-" + lc(toStr(b.foregroundcolor)) : "host";
    s.write(s.pendingHost + text, cls);
    s.pendingHost = "";
    return [];
  }, { synopsis: "Writes text straight to the screen. It does NOT go down the pipeline, so it can't be captured in a variable." });
  lib.cmdlets["write-host"].allowExtra = true;

  C("Write-Verbose", UTIL, [p("Message", 0)], function (b, input, ctx) { E.writeVerbose(ctx, toStr(b.message)); return []; },
    { synopsis: "Writes a message that only appears when the command runs with -Verbose." });
  C("Write-Warning", UTIL, [p("Message", 0)], function (b, input, ctx) { ctx.session.write("WARNING: " + toStr(b.message), "warn"); return []; },
    { synopsis: "Writes a yellow WARNING: message to the screen." });
  C("Write-Debug", UTIL, [p("Message", 0)], function () { return []; }, { synopsis: "Writes a debug message (only shown with -Debug)." });
  C("Write-Information", UTIL, [p("MessageData", 0)], function (b, input, ctx) { ctx.session.write(toStr(b.messagedata), "host"); return []; }, { synopsis: "Writes to the information stream." });
  C("Write-Error", UTIL, [p("Message", 0), p("Category"), p("ErrorId"), p("TargetObject"), p("Exception")], function (b, input, ctx) {
    E.writeCmdletError(ctx, toStr(b.message !== undefined ? b.message : b.exception), b.category ? toStr(b.category) : "NotSpecified", b.targetobject);
    return [];
  }, { synopsis: "Writes a non-terminating error: it's reported, and the script carries on (unless -ErrorAction Stop)." });
  lib.cmdlets["write-error"].params[0].position = 0;

  C("Out-Null", CORE, [p("InputObject")], function () { return []; }, { synopsis: "Throws its input away (hides output you don't want)." });
  C("Out-Host", CORE, [p("InputObject")], function (b, input, ctx) {
    var t = E.formatItems(inputItems(input, b), ctx.session);
    if (t) ctx.session.write(t);
    return [];
  }, { synopsis: "Sends output straight to the screen." });
  C("Out-String", UTIL, [p("InputObject"), sw("Stream"), p("Width")], function (b, input, ctx) {
    var items = inputItems(input, b);
    var t = items.every(function (x) { return typeof x === "string"; }) ? items.join("\n") + "\n" : E.formatItems(items, ctx.session) + "\n";
    return b.stream ? t.replace(/\n$/, "").split("\n") : [t];
  }, { synopsis: "Turns objects into the text you'd see on screen." });
  C("Clear-Host", CORE, [], function () { return []; }, { synopsis: "Clears the screen." });
  alias("cls", "Clear-Host"); alias("clear", "Clear-Host");

  function propsToShow(items, b, ctx) {
    var props = b.property !== undefined ? list(b.property) : null;
    if (!props) return null;
    return props.map(function (pr) {
      if (pr instanceof PSHashtable) return calcProp(pr, ctx);
      var name = toStr(pr);
      return { header: name, get: function (o) { return E.propertyOf(o, name, ctx); }, wild: hasWildcard(name), pattern: name };
    });
  }
  function expandWild(cols, sample) {
    var out = [];
    cols.forEach(function (c) {
      if (c.wild && sample instanceof PSObject) {
        sample.names().forEach(function (n) { if (E.wildcardRe(c.pattern).test(n)) out.push({ header: n, get: function (o) { return o.get(n); } }); });
      } else out.push(c);
    });
    return out;
  }
  function toObjects(items) {
    return items.map(function (x) {
      if (x instanceof PSObject) return x;
      if (x instanceof PSHashtable) return x;
      return x;
    });
  }
  C("Format-Table", UTIL, [p("Property", 0), sw("AutoSize"), sw("Wrap"), sw("HideTableHeaders"), p("GroupBy")], function (b, input, ctx) {
    var items = inputItems(input, b).filter(function (x) { return x !== null && x !== undefined; });
    if (!items.length) return [];
    var cols = propsToShow(items, b, ctx);
    var first = items[0];
    if (!(first instanceof PSObject) && !(first instanceof PSHashtable) && !cols) return [items.map(toStr).join("\n")];
    if (first instanceof PSHashtable && !cols) return ["\n" + E.tableText(first.entries().map(function (e) { return obj("Entry", { Name: e.key, Value: e.value }); }), [{ header: "Name", get: function (x) { return x.get("Name"); } }, { header: "Value", get: function (x) { return x.get("Value"); } }]) + "\n"];
    cols = cols ? expandWild(cols, first) : E.columnsFor(first);
    var t = E.tableText(items, cols);
    if (b.hidetableheaders) t = t.split("\n").slice(2).join("\n");
    return ["\n" + t + "\n"];
  }, { synopsis: "Shows objects as a table. Use it last: its output is for the screen, not for more processing." });
  C("Format-List", UTIL, [p("Property", 0)], function (b, input, ctx) {
    var items = inputItems(input, b).filter(function (x) { return x !== null && x !== undefined; });
    if (!items.length) return [];
    var cols = propsToShow(items, b, ctx);
    return ["\n" + items.map(function (o) {
      if (!(o instanceof PSObject)) return toStr(o);
      var c = cols ? expandWild(cols, o) : (o.typeName === "System.Management.Automation.PSCustomObject" ? E.columnsFor(o) : o.props.map(function (pp) { return { header: pp.name, get: function (x) { return x.get(pp.name); } }; }));
      return E.listText(o, c);
    }).join("\n\n") + "\n"];
  }, { synopsis: "Shows each object as a list of Property : Value lines. Format-List * shows every property." });
  alias("ft", "Format-Table"); alias("fl", "Format-List");

  /* ================================================================== Pipeline cmdlets */
  var WHERE_OPS = ["EQ", "NE", "GT", "GE", "LT", "LE", "Like", "NotLike", "Match", "NotMatch", "Contains", "NotContains", "In", "NotIn", "Is", "IsNot",
    "CEQ", "CNE", "CLike", "CMatch", "CContains"];
  C("Where-Object", CORE, [p("FilterScript", 0), p("Property"), p("Value", 1), p("InputObject")].concat(WHERE_OPS.map(sw)), function (b, input, ctx) {
    var items = inputItems(input, b);
    var fs = b.filterscript;
    var op = null;
    WHERE_OPS.forEach(function (o) { if (b[lc(o)]) op = lc(o); });
    var prop = b.property !== undefined ? toStr(b.property) : (fs !== undefined && !(fs instanceof ScriptBlock) ? toStr(fs) : null);
    if (fs instanceof ScriptBlock) {
      return items.filter(function (x) { return toBool(E.callScriptBlock(fs, ctx, [], x, true)); });
    }
    if (prop === null) throw err("Where-Object needs a script block like { $_.Status -eq 'Running' }, or a property and an operator like: Where-Object Status -eq Running.");
    return items.filter(function (x) {
      var v = E.propertyOf(x, prop, ctx);
      if (!op) return toBool(v);
      var map = { eq: "eq", ne: "ne", gt: "gt", ge: "ge", lt: "lt", le: "le", like: "like", notlike: "notlike", match: "match", notmatch: "notmatch", contains: "contains", notcontains: "notcontains", "in": "in", notin: "notin", ceq: "ceq", cne: "cne", clike: "clike", cmatch: "cmatch", ccontains: "ccontains" };
      if (op === "is" || op === "isnot") { var r = E.isType(v, b.value instanceof PSType ? b.value.name : toStr(b.value)); return op === "is" ? r : !r; }
      return toBool(lib.binary(map[op], v, b.value, ctx));
    });
  }, { synopsis: "Keeps only the objects that match a condition.", syntax: ["Where-Object { $_.Status -eq 'Running' }", "Where-Object Status -eq Running"],
    examples: ["Get-Service | Where-Object Status -eq 'Stopped'", "Get-Process | Where-Object { $_.CPU -gt 100 }"] });
  alias("where", "Where-Object"); alias("?", "Where-Object");

  C("ForEach-Object", CORE, [p("Process", 0), p("Begin"), p("End"), p("MemberName"), p("InputObject"), p("ArgumentList")], function (b, input, ctx) {
    var items = inputItems(input, b);
    var out = [];
    var proc = b.process !== undefined ? b.process : b.membername;
    if (proc !== undefined && !(proc instanceof ScriptBlock) && !Array.isArray(proc)) {
      var mn = toStr(proc);
      items.forEach(function (x) { var v = E.propertyOf(x, mn, ctx); if (v !== null && v !== undefined) out = out.concat(enumerate(v)); });
      return out;
    }
    var blocks = Array.isArray(proc) ? proc : [proc];
    var begin = b.begin, end = b.end;
    if (blocks.length === 3 && !begin && !end) { begin = blocks[0]; end = blocks[2]; blocks = [blocks[1]]; }
    var scope = new E.Scope(ctx.scope);
    var lctx = ctx.child(scope);
    var sink = ctx.directOut;
    function emit(list) { if (sink) list.forEach(function (v) { sink.push(v); }); else out = out.concat(list); }
    if (begin instanceof ScriptBlock) emit(runInScope(begin, lctx, undefined));
    items.forEach(function (x) {
      ctx.session.step();
      blocks.forEach(function (sb) { if (sb instanceof ScriptBlock) emit(runInScope(sb, lctx, x)); });
    });
    if (end instanceof ScriptBlock) emit(runInScope(end, lctx, undefined));
    return out;
  }, { synopsis: "Runs a script block once for every object in the pipeline; $_ is the current object.",
    examples: ["1..5 | ForEach-Object { $_ * 2 }", "Get-Service | ForEach-Object { $_.Name.ToUpper() }"] });
  alias("foreach", "ForEach-Object"); alias("%", "ForEach-Object");
  lib.cmdlets["foreach-object"].streams = true;
  // ForEach-Object's begin/process/end share variables, like real PowerShell's dot-sourced blocks.
  function runInScope(sb, ctx, item) {
    var scope = ctx.scope;
    var prev = scope.vars.get("_");
    if (item !== undefined) { scope.setLocal("_", item); scope.setLocal("PSItem", item); }
    var out = [];
    try {
      var c = ctx.child(scope);
      lib.execBlockIn(sb, c, out);
    } finally { if (prev) scope.vars.set("_", prev); }
    return out;
  }

  function calcProp(h, ctx) {
    var name = null, expr = null;
    h.entries().forEach(function (e) {
      var k = lc(toStr(e.key));
      if ("name".indexOf(k) === 0 || "label".indexOf(k) === 0) name = toStr(e.value);
      else if ("expression".indexOf(k) === 0) expr = e.value;
    });
    if (expr === null) throw err("A calculated property needs an Expression key: @{Name = 'Label'; Expression = { ... }}.");
    if (name === null) name = expr instanceof ScriptBlock ? expr.text.trim() : toStr(expr);
    return {
      header: name,
      get: function (o) { return expr instanceof ScriptBlock ? E.callScriptBlock(expr, ctx, [], o, true) : E.propertyOf(o, toStr(expr), ctx); }
    };
  }
  C("Select-Object", UTIL, [p("Property", 0), p("ExcludeProperty"), p("ExpandProperty"), p("First"), p("Last"), p("Skip"), sw("Unique"), p("Index"), p("InputObject")], function (b, input, ctx) {
    var items = inputItems(input, b).slice();
    if (b.skip !== undefined) items = items.slice(toNumber(b.skip));
    if (b.first !== undefined || b.last !== undefined) {
      var f = b.first !== undefined ? items.slice(0, toNumber(b.first)) : [];
      var l = b.last !== undefined ? items.slice(Math.max(0, items.length - toNumber(b.last))) : [];
      items = b.first !== undefined && b.last !== undefined ? f.concat(l) : b.first !== undefined ? f : l;
    }
    if (b.index !== undefined) { var idx = list(b.index).map(toNumber); items = items.filter(function (x, i) { return idx.indexOf(i) >= 0; }); }
    function uniq(list) {
      var seen = [];
      return list.filter(function (x) { var k = toStr(x); if (seen.indexOf(k) >= 0) return false; seen.push(k); return true; });
    }
    if (b.unique && b.expandproperty === undefined && b.property === undefined) items = uniq(items);
    if (b.expandproperty !== undefined) {
      var ep = toStr(b.expandproperty), out = [];
      items.forEach(function (x) {
        var v = E.propertyOf(x, ep, ctx);
        if (v === null && !(x instanceof PSObject && x.has(ep)) && !(x instanceof PSHashtable && x.has(ep))) {
          E.writeCmdletError(ctx, "Property \"" + ep + "\" cannot be found.", "InvalidArgument", x);
          return;
        }
        out = out.concat(enumerate(v));
      });
      return b.unique ? uniq(out) : out;
    }
    if (b.property === undefined) return items;
    var cols = list(b.property).map(function (pr) {
      if (pr instanceof PSHashtable) return calcProp(pr, ctx);
      var name = toStr(pr);
      return { header: name, wild: hasWildcard(name), pattern: name, get: function (o) { var v = E.propertyOf(o, name, ctx); return v === undefined ? null : v; } };
    });
    var exclude = names(b.excludeproperty);
    var made = items.map(function (x) {
      var o = new PSObject();
      expandWild(cols, x).forEach(function (c) {
        if (exclude.some(function (e) { return E.wildcardRe(e).test(c.header); })) return;
        o.set(c.header, c.get(x));
      });
      return o;
    });
    return b.unique ? uniq(made) : made;
  }, { synopsis: "Picks properties (or the first/last few objects). Makes NEW objects with only those properties.",
    examples: ["Get-Process | Select-Object Name, CPU", "Get-Process | Select-Object -First 3", "Get-Service | Select-Object -ExpandProperty Name",
      "Get-Process | Select-Object Name, @{Name = 'MemoryMB'; Expression = { $_.WS / 1MB }}"] });
  alias("select", "Select-Object");

  function sortKeys(b, ctx) {
    var props = b.property !== undefined ? list(b.property) : [null];
    return props.map(function (pr) {
      if (pr instanceof PSHashtable) {
        var c = calcProp(pr, ctx), desc = null;
        pr.entries().forEach(function (e) { if ("descending".indexOf(lc(toStr(e.key))) === 0) desc = toBool(e.value); if ("ascending".indexOf(lc(toStr(e.key))) === 0) desc = !toBool(e.value); });
        return { get: c.get, desc: desc };
      }
      if (pr instanceof ScriptBlock) return { get: function (o) { return E.callScriptBlock(pr, ctx, [], o, true); }, desc: null };
      if (pr === null) return { get: function (o) { return o; }, desc: null };
      var name = toStr(pr);
      return { get: function (o) { return E.propertyOf(o, name, ctx); }, desc: null };
    });
  }
  C("Sort-Object", UTIL, [p("Property", 0), sw("Descending"), sw("Unique"), sw("CaseSensitive"), p("Top"), p("Bottom"), p("InputObject")], function (b, input, ctx) {
    var items = inputItems(input, b).slice();
    var keys = sortKeys(b, ctx);
    var withKeys = items.map(function (x, i) { return { x: x, i: i, k: keys.map(function (k) { return k.get(x); }) }; });
    withKeys.sort(function (a, c) {
      for (var j = 0; j < keys.length; j++) {
        var r = E.cmpOrder(a.k[j], c.k[j], !!b.casesensitive);
        if (r !== 0) { var desc = keys[j].desc !== null ? keys[j].desc : !!b.descending; return desc ? -r : r; }
      }
      return a.i - c.i;
    });
    var out = withKeys.map(function (w) { return w.x; });
    if (b.unique) { var seen = []; out = out.filter(function (x) { var k = lc(toStr(x)); if (seen.indexOf(k) >= 0) return false; seen.push(k); return true; }); }
    if (b.top !== undefined) out = out.slice(0, toNumber(b.top));
    if (b.bottom !== undefined) out = out.slice(Math.max(0, out.length - toNumber(b.bottom)));
    return out;
  }, { synopsis: "Sorts objects by one or more properties.", examples: ["Get-Process | Sort-Object CPU -Descending", "Get-Service | Sort-Object Status, Name"] });
  alias("sort", "Sort-Object");

  C("Group-Object", UTIL, [p("Property", 0), sw("NoElement"), sw("AsHashTable"), sw("AsString"), sw("CaseSensitive"), p("InputObject")], function (b, input, ctx) {
    var items = inputItems(input, b);
    var keys = sortKeys(b, ctx);
    var groups = [], index = {};
    items.forEach(function (x) {
      var kv = keys.map(function (k) { return k.get(x); });
      var name = kv.map(toStr).join(", ");
      var key = b.casesensitive ? name : lc(name);
      if (!(key in index)) { index[key] = groups.length; groups.push({ name: name, values: kv, group: [] }); }
      groups[index[key]].group.push(x);
    });
    // PowerShell 7 returns the groups sorted by their name
    groups.sort(function (a, c) { var x = lc(a.name), y = lc(c.name); return x < y ? -1 : x > y ? 1 : 0; });
    if (b.ashashtable) {
      var h = new PSHashtable();
      groups.forEach(function (g) { h.set(keys.length === 1 && !b.asstring ? g.values[0] : g.name, g.group.length === 1 ? g.group[0] : g.group); });
      return [h];
    }
    return groups.map(function (g) {
      var o = obj("Microsoft.PowerShell.Commands.GroupInfo", { Count: g.group.length, Name: g.name });
      if (!b.noelement) o.set("Group", g.group);
      o.set("Values", g.values);
      return o;
    });
  }, { synopsis: "Groups objects that have the same value for a property. Each group has Count, Name and Group.",
    examples: ["Get-Service | Group-Object Status", "Get-Process | Group-Object Company -NoElement"] });
  alias("group", "Group-Object");

  C("Measure-Object", UTIL, [p("Property", 0), sw("Sum"), sw("Average"), sw("Maximum"), sw("Minimum"), sw("AllStats"), sw("Line"), sw("Word"), sw("Character"), p("InputObject")], function (b, input, ctx) {
    var items = inputItems(input, b);
    if (b.line || b.word || b.character) {
      var text = items.map(toStr);
      var o = obj("Microsoft.PowerShell.Commands.TextMeasureInfo", {});
      if (b.line) o.set("Lines", text.reduce(function (a, t) { return a + t.split("\n").length; }, 0));
      if (b.word) o.set("Words", text.reduce(function (a, t) { return a + t.split(/\s+/).filter(Boolean).length; }, 0));
      if (b.character) o.set("Characters", text.reduce(function (a, t) { return a + t.length; }, 0));
      o.set("Property", null);
      return [o];
    }
    var props = b.property !== undefined ? names(b.property) : [null];
    return props.map(function (pn) {
      var vals = items.map(function (x) { return pn === null ? x : E.propertyOf(x, pn, ctx); }).filter(function (v) { return v !== null && v !== undefined; });
      var all = b.allstats;
      var nums = (b.sum || b.average || all) ? vals.map(function (v) { return toNumber(v); }) : null;
      var o = obj("Microsoft.PowerShell.Commands.GenericMeasureInfo", { Count: vals.length });
      o.set("Average", b.average || all ? (nums.length ? nums.reduce(function (a, c) { return a + c; }, 0) / nums.length : null) : null);
      o.set("Sum", b.sum || all ? nums.reduce(function (a, c) { return a + c; }, 0) : null);
      var sorted = (b.maximum || b.minimum || all) ? vals.slice().sort(function (x, y) { return E.cmpOrder(x, y); }) : null;
      o.set("Maximum", b.maximum || all ? (sorted.length ? sorted[sorted.length - 1] : null) : null);
      o.set("Minimum", b.minimum || all ? (sorted.length ? sorted[0] : null) : null);
      o.set("Property", pn);
      return o;
    });
  }, { synopsis: "Counts objects, and with -Sum/-Average/-Maximum/-Minimum calculates statistics for a property.",
    examples: ["Get-Process | Measure-Object", "Get-Process | Measure-Object CPU -Sum -Average"] });
  alias("measure", "Measure-Object");

  C("Compare-Object", UTIL, [p("ReferenceObject", 0), p("DifferenceObject", 1), p("Property"), sw("IncludeEqual"), sw("ExcludeDifferent"), sw("PassThru"), sw("CaseSensitive")], function (b, input, ctx) {
    var ref = list(b.referenceobject), diff = input && b.differenceobject === undefined ? input : list(b.differenceobject);
    var props = b.property !== undefined ? names(b.property) : null;
    function key(x) { return props ? props.map(function (pn) { return toStr(E.propertyOf(x, pn, ctx)); }).join("\u0001") : toStr(x); }
    var norm = function (s) { return b.casesensitive ? s : lc(s); };
    var refKeys = ref.map(function (x) { return norm(key(x)); }), diffKeys = diff.map(function (x) { return norm(key(x)); });
    var out = [];
    function mk(x, side) {
      if (b.passthru) return x;
      var o = new PSObject();
      if (props) props.forEach(function (pn) { o.set(pn, E.propertyOf(x, pn, ctx)); }); else o.set("InputObject", x);
      o.set("SideIndicator", side);
      return o;
    }
    if (b.includeequal) ref.forEach(function (x, i) { if (diffKeys.indexOf(refKeys[i]) >= 0) out.push(mk(x, "==")); });
    if (!b.excludedifferent) {
      diff.forEach(function (x, i) { if (refKeys.indexOf(diffKeys[i]) < 0) out.push(mk(x, "=>")); });
      ref.forEach(function (x, i) { if (diffKeys.indexOf(refKeys[i]) < 0) out.push(mk(x, "<=")); });
    }
    return out;
  }, { synopsis: "Compares two sets of objects. <= means only in the reference set, => only in the difference set.",
    examples: ["Compare-Object -ReferenceObject $hrNames -DifferenceObject $accountNames"] });
  alias("compare", "Compare-Object"); alias("diff", "Compare-Object");

  C("Tee-Object", UTIL, [p("Variable"), p("FilePath", 0)], function (b, input, ctx) {
    var items = input || [];
    if (b.variable !== undefined) ctx.session.scriptScope.setLocal(toStr(b.variable), E.unwrap(items.slice()));
    return items;
  }, { synopsis: "Saves the pipeline into a variable (or file) AND passes it on." });

  /* ================================================================== Objects */
  C("New-Object", UTIL, [p("TypeName", 0), p("Property"), p("ArgumentList", 1)], function (b, input, ctx) {
    var tn = toStr(b.typename);
    var o = lib.newObject(tn, list(b.argumentlist), ctx);
    if (b.property instanceof PSHashtable) b.property.entries().forEach(function (e) { if (o instanceof PSObject) o.set(toStr(e.key), e.value); });
    return [o];
  }, { synopsis: "Creates an object of a .NET type, e.g. New-Object PSObject -Property @{ Name = 'x' }." });

  C("Add-Member", UTIL, [p("MemberType", 0), p("Name", 1), p("Value", 2), p("NotePropertyName"), p("NotePropertyValue"), p("NotePropertyMembers"), sw("PassThru"), sw("Force"), p("InputObject")], function (b, input, ctx) {
    var targets = inputItems(input, b);
    targets.forEach(function (t) {
      if (!(t instanceof PSObject)) throw err("Add-Member works on objects here; use [PSCustomObject]@{...} to make one.");
      var add = function (n, v) {
        if (t.has(n) && !b.force) throw err("Cannot add a member with the name \"" + n + "\" because a member with that name already exists. To overwrite the member anyway, add the Force parameter to your command.", "InvalidOperation");
        t.set(n, v);
      };
      if (b.notepropertymembers instanceof PSHashtable) b.notepropertymembers.entries().forEach(function (e) { add(toStr(e.key), e.value); });
      else if (b.notepropertyname !== undefined) add(toStr(b.notepropertyname), b.notepropertyvalue === undefined ? null : b.notepropertyvalue);
      else if (b.name !== undefined) {
        var mt = lc(toStr(b.membertype || "NoteProperty"));
        if (mt === "scriptmethod") { t.methods = t.methods || {}; var sb = b.value; t.methods[lc(toStr(b.name))] = function (args, c) { return E.unwrap(E.callScriptBlockList(sb, c, args, undefined, t)); }; }
        else if (mt === "scriptproperty") { t.getters = t.getters || {}; var sp = b.value; t.getters[lc(toStr(b.name))] = function () { return E.callScriptBlock(sp, ctx, [], undefined, true); }; }
        else add(toStr(b.name), b.value === undefined ? null : b.value);
      }
    });
    return b.passthru ? targets : [];
  }, { synopsis: "Adds a property (or method) to an existing object.", examples: ["$obj | Add-Member -NotePropertyName Owner -NotePropertyValue 'web'"] });

  C("Get-Member", UTIL, [p("Name", 0), p("MemberType"), sw("Static"), sw("Force"), p("InputObject")], function (b, input, ctx) {
    var items = inputItems(input, b);
    if (!items.length) throw err("You must specify an object for the Get-Member cmdlet.", "CloseError");
    var seen = {}, out = [];
    items.forEach(function (x) {
      var tn = E.typeOfValue(x) || "System.Object";
      if (seen[tn]) return;
      seen[tn] = true;
      lib.membersOf(x).forEach(function (m) {
        if (b.name !== undefined && !matchAny(m.Name, names(b.name))) return;
        if (b.membertype !== undefined && !names(b.membertype).some(function (t) { return lc(t) === lc(m.MemberType) || (lc(t) === "properties" && /property/i.test(m.MemberType)) || (lc(t) === "property" && /property/i.test(m.MemberType) && false); })) return;
        out.push(obj("Microsoft.PowerShell.Commands.MemberDefinition", { TypeName: tn, Name: m.Name, MemberType: m.MemberType, Definition: m.Definition }));
      });
    });
    return out;
  }, { synopsis: "Shows the type of an object and all its properties and methods. The #1 discovery tool.",
    examples: ["Get-Service | Get-Member", "Get-Process | Get-Member -MemberType Property", "'text' | Get-Member"] });
  alias("gm", "Get-Member");

  /* ================================================================== Discovery */
  function commandObj(def) {
    var verb = def.name.split("-")[0], noun = def.name.split("-").slice(1).join("-");
    return obj("System.Management.Automation.CmdletInfo", { CommandType: "Cmdlet", Name: def.name, Version: "7.0.0.0", Source: def.module, Verb: verb, Noun: noun, ModuleName: def.module, Definition: def.name });
  }
  C("Get-Command", CORE, [p("Name", 0), p("Verb"), p("Noun"), p("Module"), p("CommandType")], function (b, input, ctx) {
    var out = [];
    var nm = b.name !== undefined ? names(b.name) : null;
    var verbs = b.verb !== undefined ? names(b.verb) : null, nouns = b.noun !== undefined ? names(b.noun) : null;
    Object.keys(lib.cmdlets).forEach(function (k) {
      var d = lib.cmdlets[k];
      if (d.hidden) return;
      var c = commandObj(d);
      if (nm && !matchAny(d.name, nm)) return;
      if (verbs && !matchAny(c.get("Verb"), verbs)) return;
      if (nouns && !matchAny(c.get("Noun"), nouns)) return;
      if (b.module !== undefined && !matchAny(d.module, names(b.module))) return;
      out.push(c);
    });
    ctx.session.functions.forEach(function (f) {
      if (nm && !matchAny(f.name, nm)) return;
      var parts = f.name.split("-");
      if (verbs && !matchAny(parts[0], verbs)) return;
      if (nouns && !matchAny(parts.slice(1).join("-"), nouns)) return;
      if (b.module !== undefined) return;
      out.push(obj("System.Management.Automation.FunctionInfo", { CommandType: "Function", Name: f.name, Version: "", Source: "", Verb: parts[0], Noun: parts.slice(1).join("-"), Definition: f.text }));
    });
    if (nm && !verbs && !nouns) {
      nm.forEach(function (n) {
        if (!hasWildcard(n) && lib.aliases[lc(n)]) {
          var target = lib.aliases[lc(n)];
          out.push(obj("System.Management.Automation.AliasInfo", { CommandType: "Alias", Name: n, DisplayName: n + " -> " + target, Definition: target, ResolvedCommandName: target, Version: "", Source: "" }));
        }
      });
      var missing = nm.filter(function (n) { return !hasWildcard(n) && !out.some(function (o) { return lc(o.get("Name")) === lc(n); }); });
      missing.forEach(function (n) { E.writeCmdletError(ctx, "The term '" + n + "' is not recognized as a name of a cmdlet, function, script file, or executable program.", "ObjectNotFound", n); });
    }
    out.sort(function (a, c) { return lc(a.get("Name")) < lc(c.get("Name")) ? -1 : 1; });
    return out;
  }, { synopsis: "Finds commands. Use wildcards or -Verb / -Noun.", examples: ["Get-Command -Noun Service", "Get-Command -Verb Get", "Get-Command *process*"] });
  alias("gcm", "Get-Command");

  C("Get-Alias", UTIL, [p("Name", 0), p("Definition")], function (b) {
    var out = [];
    Object.keys(lib.aliases).forEach(function (a) {
      var target = lib.aliases[a];
      if (b.name !== undefined && !matchAny(a, names(b.name))) return;
      if (b.definition !== undefined && !matchAny(target, names(b.definition))) return;
      out.push(obj("System.Management.Automation.AliasInfo", { CommandType: "Alias", Name: a, DisplayName: a + " -> " + target, Definition: target, ResolvedCommandName: target, Version: "", Source: "" }));
    });
    return out;
  }, { synopsis: "Shows aliases: short names for commands, like ls for Get-ChildItem.", examples: ["Get-Alias ls", "Get-Alias -Definition Get-ChildItem"] });
  alias("gal", "Get-Alias");

  var VERBS = [["Add", "a", "Common"], ["Clear", "cl", "Common"], ["Copy", "cp", "Common"], ["Get", "g", "Common"], ["New", "n", "Common"], ["Remove", "r", "Common"],
    ["Set", "s", "Common"], ["Find", "fd", "Common"], ["Select", "sc", "Common"], ["Format", "f", "Common"], ["Test", "t", "Diagnostic"], ["Start", "sa", "Lifecycle"],
    ["Stop", "sp", "Lifecycle"], ["Restart", "rt", "Lifecycle"], ["Enable", "e", "Lifecycle"], ["Disable", "d", "Lifecycle"], ["Invoke", "i", "Lifecycle"],
    ["Import", "ip", "Data"], ["Export", "ep", "Data"], ["ConvertTo", "ct", "Data"], ["ConvertFrom", "cf", "Data"], ["Measure", "ms", "Diagnostic"], ["Write", "wr", "Communications"],
    ["Read", "rd", "Communications"], ["Out", "o", "Data"], ["Compare", "cr", "Data"], ["Group", "gp", "Data"], ["Sort", "sr", "Data"], ["Update", "ud", "Data"], ["Unlock", "uk", "Common"],
    ["Protect", "pt", "Security"], ["Unprotect", "up", "Security"], ["Grant", "gr", "Security"], ["Revoke", "rk", "Security"], ["Block", "bl", "Security"]];
  C("Get-Verb", UTIL, [p("Verb", 0), p("Group")], function (b) {
    return VERBS.filter(function (v) { return (b.verb === undefined || matchAny(v[0], names(b.verb))) && (b.group === undefined || matchAny(v[2], names(b.group))); })
      .map(function (v) { return obj("System.Management.Automation.VerbInfo", { Verb: v[0], AliasPrefix: v[1], Group: v[2] }); });
  }, { synopsis: "Lists the approved verbs for command names (Get, Set, New, Remove...)." });

  C("Get-Help", CORE, [p("Name", 0), sw("Examples"), sw("Detailed"), sw("Full"), p("Parameter"), sw("Online")], function (b, input, ctx) {
    if (b.name === undefined) return ["\nTOPIC\n    PowerShell help\n\n    Get-Help <command-name>       shows help for a command\n    Get-Help <command-name> -Examples   shows examples\n    Get-Command                   lists commands\n"];
    var n = toStr(b.name);
    var found = E.findCommand(n, ctx);
    if (!found) throw err("Get-Help could not find " + n + " in a help file in this session.", "ResourceUnavailable");
    if (found.kind === "function") return ["\nNAME\n    " + found.def.name + "\n\nSYNTAX\n    " + found.def.name + " " + found.def.params.map(function (pp) { return (pp.mandatory ? "" : "[") + "-" + pp.name + " <" + (pp.typeName || "Object") + ">" + (pp.mandatory ? "" : "]"); }).join(" ") + "\n"];
    var d = found.def, h = d.help || {};
    var syn = (h.syntax || [d.name + " " + d.params.filter(function (pp) { return !pp.hidden; }).map(function (pp) { return pp.type === "switch" ? "[-" + pp.name + "]" : (pp.position != null ? "[[-" + pp.name + "] <Object>]" : "[-" + pp.name + " <Object>]"); }).join(" ")]);
    var lines = ["", "NAME", "    " + d.name, "", "SYNOPSIS", "    " + (h.synopsis || ""), "", "SYNTAX"];
    syn.forEach(function (s) { lines.push("    " + s); });
    if (b.parameter !== undefined || b.detailed || b.full) {
      lines.push("", "PARAMETERS");
      d.params.forEach(function (pp) {
        if (b.parameter !== undefined && !matchAny(pp.name, names(b.parameter))) return;
        lines.push("    -" + pp.name + (pp.type === "switch" ? " [<SwitchParameter>]" : " <Object>"));
        if (h.params && h.params[pp.name]) lines.push("        " + h.params[pp.name]);
        lines.push("        Position? " + (pp.position != null ? pp.position : "named"), "");
      });
    }
    if (h.examples && h.examples.length) {
      lines.push("", "EXAMPLES");
      h.examples.forEach(function (ex, i) { lines.push("    ----- Example " + (i + 1) + " -----", "    PS> " + ex, ""); });
    }
    lines.push("ALIASES");
    var al = Object.keys(lib.aliases).filter(function (a) { return lc(lib.aliases[a]) === lc(d.name); });
    lines.push("    " + (al.length ? al.join(", ") : "None"));
    lines.push("");
    return [lines.join("\n")];
  }, { synopsis: "Shows help for a command: what it does, its syntax and examples.", examples: ["Get-Help Get-Service", "Get-Help Get-Service -Examples", "Get-Help Get-Service -Parameter Name"] });
  alias("help", "Get-Help"); alias("man", "Get-Help");

  /* ================================================================== Services and processes */
  function selectServices(b, ctx) {
    var sys = ctx.session.system, out = [];
    if (b.inputobject !== undefined) return list(b.inputobject).map(function (o) { return o.ref ? o : serviceObj(sys.services.filter(function (s) { return lc(s.Name) === lc(toStr(o)); })[0]); });
    var nm = b.name !== undefined ? names(b.name) : null, dn = b.displayname !== undefined ? names(b.displayname) : null;
    var ex = b.exclude !== undefined ? names(b.exclude) : [];
    if (nm) {
      nm.forEach(function (n) {
        var hits = sys.services.filter(function (s) { return E.wildcardRe(n).test(s.Name) || (!hasWildcard(n) && lc(s.DisplayName) === lc(n)); });
        if (!hits.length && !hasWildcard(n)) E.writeCmdletError(ctx, "Cannot find any service with service name '" + n + "'.", "ObjectNotFound", n);
        hits.forEach(function (s) { if (out.indexOf(s) < 0) out.push(s); });
      });
    } else if (dn) {
      dn.forEach(function (n) { sys.services.forEach(function (s) { if (E.wildcardRe(n).test(s.DisplayName) && out.indexOf(s) < 0) out.push(s); }); });
    } else out = sys.services.slice();
    out = out.filter(function (s) { return !matchAny(s.Name, ex); });
    out.sort(function (a, c) { return lc(a.Name) < lc(c.Name) ? -1 : 1; });
    return out.map(serviceObj);
  }
  C("Get-Service", MGMT, [p("Name", 0, { aliases: ["ServiceName"] }), p("DisplayName"), p("Exclude"), p("InputObject")], function (b, input, ctx) {
    if (input && input.length) return input.reduce(function (acc, x) { return acc.concat(selectServices({ name: toStr(E.propertyOf(x, "Name", ctx) || x) }, ctx)); }, []);
    return selectServices(b, ctx);
  }, { synopsis: "Gets the services on the computer.", syntax: ["Get-Service [[-Name] <string[]>] [-DisplayName <string[]>] [-Exclude <string[]>]"],
    params: { Name: "Service names to get. Wildcards are allowed.", DisplayName: "Gets services by their display name (the long friendly name). Wildcards are allowed.", Exclude: "Service names to leave out." },
    examples: ["Get-Service", "Get-Service -Name W*", "Get-Service -DisplayName '*Kestrel*'", "Get-Service | Where-Object Status -eq Stopped"] });
  alias("gsv", "Get-Service");

  function serviceAction(verb, newStatus) {
    return function (b, input, ctx) {
      var sys = ctx.session.system;
      var targets = input && input.length ? input.map(function (x) { return x instanceof PSObject && x.ref ? x : selectServices({ name: toStr(E.propertyOf(x, "Name", ctx) || x) }, ctx)[0]; }).filter(Boolean) : selectServices(b, ctx);
      var out = [];
      targets.forEach(function (o) {
        var s = o.ref;
        var label = s.DisplayName + " (" + s.Name + ")";
        if (ctx.whatIf) { ctx.session.write("What if: Performing the operation \"" + verb + "-Service\" on target \"" + label + "\".", "whatif"); return; }
        if (s.StartType === "Disabled" && newStatus === "Running") { E.writeCmdletError(ctx, "Service '" + label + "' cannot be started due to the following error: Cannot start service " + s.Name + " on computer '.'.", "OpenError", s.Name); return; }
        s.Status = newStatus;
        sys.actions.push(verb + "-Service " + s.Name);
        if (b.passthru) out.push(serviceObj(s));
      });
      return out;
    };
  }
  [["Start", "Running"], ["Stop", "Stopped"], ["Restart", "Running"]].forEach(function (v) {
    C(v[0] + "-Service", MGMT, [p("Name", 0), p("InputObject"), sw("PassThru"), sw("Force"), p("DisplayName")], serviceAction(v[0], v[1]),
      { synopsis: v[0] + "s one or more services. Supports -WhatIf.", examples: [v[0] + "-Service -Name Spooler -WhatIf"] });
  });
  C("Set-Service", MGMT, [p("Name", 0), p("StartupType"), p("Status"), sw("PassThru")], function (b, input, ctx) {
    var targets = selectServices(b, ctx);
    targets.forEach(function (o) {
      if (ctx.whatIf) { ctx.session.write("What if: Performing the operation \"Set-Service\" on target \"" + o.ref.DisplayName + " (" + o.ref.Name + ")\".", "whatif"); return; }
      if (b.startuptype !== undefined) o.ref.StartType = toStr(b.startuptype);
      if (b.status !== undefined) o.ref.Status = toStr(b.status);
      ctx.session.system.actions.push("Set-Service " + o.ref.Name);
    });
    return b.passthru ? targets : [];
  }, { synopsis: "Changes a service's startup type or status." });

  function selectProcesses(b, ctx) {
    var sys = ctx.session.system, out = [];
    if (b.id !== undefined) {
      list(b.id).forEach(function (id) {
        var hit = sys.processes.filter(function (x) { return x.Id === toNumber(id); })[0];
        if (!hit) E.writeCmdletError(ctx, "Cannot find a process with the process identifier " + toStr(id) + ".", "ObjectNotFound", id); else out.push(hit);
      });
    } else if (b.name !== undefined) {
      names(b.name).forEach(function (n) {
        var hits = sys.processes.filter(function (x) { return E.wildcardRe(n).test(x.Name); });
        if (!hits.length && !hasWildcard(n)) E.writeCmdletError(ctx, "Cannot find a process with the name \"" + n + "\". Verify the process name and call the cmdlet again.", "ObjectNotFound", n);
        hits.forEach(function (x) { if (out.indexOf(x) < 0) out.push(x); });
      });
    } else out = sys.processes.slice();
    out.sort(function (a, c) { return lc(a.Name) < lc(c.Name) ? -1 : lc(a.Name) > lc(c.Name) ? 1 : a.Id - c.Id; });
    return out.map(processObj);
  }
  C("Get-Process", MGMT, [p("Name", 0, { aliases: ["ProcessName"] }), p("Id")], function (b, input, ctx) { return selectProcesses(b, ctx); },
    { synopsis: "Gets the processes (running programs) on the computer.", params: { Name: "Process names. Wildcards are allowed.", Id: "Process IDs." },
      examples: ["Get-Process", "Get-Process -Name svchost", "Get-Process | Sort-Object CPU -Descending | Select-Object -First 5"] });
  alias("gps", "Get-Process"); alias("ps", "Get-Process");
  C("Stop-Process", MGMT, [p("Name"), p("Id", 0), p("InputObject"), sw("Force"), sw("PassThru")], function (b, input, ctx) {
    var sys = ctx.session.system;
    var targets = input && input.length ? input : selectProcesses(b, ctx);
    targets.forEach(function (o) {
      var x = o.ref;
      if (!x) return;
      if (ctx.whatIf) { ctx.session.write("What if: Performing the operation \"Stop-Process\" on target \"" + x.Name + " (" + x.Id + ")\".", "whatif"); return; }
      sys.processes = sys.processes.filter(function (y) { return y !== x; });
      sys.actions.push("Stop-Process " + x.Name + " " + x.Id);
    });
    return [];
  }, { synopsis: "Stops (kills) processes. Supports -WhatIf.", examples: ["Stop-Process -Name updater -WhatIf"] });
  alias("kill", "Stop-Process");

  /* ================================================================== Users and groups */
  C("Get-LocalUser", LOCAL, [p("Name", 0)], function (b, input, ctx) {
    var sys = ctx.session.system;
    var us = sys.users;
    if (b.name !== undefined) {
      var out = [];
      names(b.name).forEach(function (n) {
        var hits = us.filter(function (u) { return E.wildcardRe(n).test(u.Name); });
        if (!hits.length && !hasWildcard(n)) E.writeCmdletError(ctx, "User " + n + " was not found.", "ObjectNotFound", n);
        out = out.concat(hits);
      });
      us = out;
    }
    return us.map(userObj);
  }, { synopsis: "Gets local user accounts: Name, Enabled, LastLogon, Description...", examples: ["Get-LocalUser", "Get-LocalUser | Where-Object Enabled"] });
  C("Get-LocalGroup", LOCAL, [p("Name", 0)], function (b, input, ctx) {
    return Object.keys(ctx.session.system.groups).filter(function (g) { return b.name === undefined || matchAny(g, names(b.name)); })
      .map(function (g) { return obj("Microsoft.PowerShell.Commands.LocalGroup", { Name: g, Description: g === "Administrators" ? "Administrators have complete and unrestricted access to the computer" : "" }); });
  }, { synopsis: "Gets local groups." });
  C("Get-LocalGroupMember", LOCAL, [p("Group", 0, { aliases: ["Name"] }), p("Member", 1)], function (b, input, ctx) {
    var g = toStr(b.group), groups = ctx.session.system.groups;
    var key = Object.keys(groups).filter(function (k) { return lc(k) === lc(g); })[0];
    if (!key) throw err("Group " + g + " was not found.", "ObjectNotFound");
    return groups[key].filter(function (m) { return b.member === undefined || matchAny(m, names(b.member)); }).map(function (m) {
      return obj("Microsoft.PowerShell.Commands.LocalPrincipal", { ObjectClass: "User", Name: "KC-WIN-01\\" + m, PrincipalSource: "Local", SID: "S-1-5-21-" + m.length });
    });
  }, { synopsis: "Gets the members of a local group. Names look like COMPUTER\\user.", examples: ["Get-LocalGroupMember -Group Administrators"] });
  C("Disable-LocalUser", LOCAL, [p("Name", 0), p("InputObject")], function (b, input, ctx) {
    var ns = input && input.length ? input.map(function (x) { return toStr(E.propertyOf(x, "Name", ctx) || x); }) : names(b.name);
    ns.forEach(function (n) {
      var u = ctx.session.system.users.filter(function (x) { return lc(x.Name) === lc(n); })[0];
      if (!u) { E.writeCmdletError(ctx, "User " + n + " was not found.", "ObjectNotFound", n); return; }
      if (ctx.whatIf) { ctx.session.write("What if: Performing the operation \"Disable local user\" on target \"" + u.Name + "\".", "whatif"); return; }
      u.Enabled = false;
      ctx.session.system.actions.push("Disable-LocalUser " + u.Name);
    });
    return [];
  }, { synopsis: "Disables a local user account. Supports -WhatIf." });

  /* ================================================================== Dates, random, misc */
  C("Get-Date", UTIL, [p("Date", 0), p("Format"), p("UFormat"), p("Year"), p("Month"), p("Day"), p("Hour"), p("Minute"), p("Second")], function (b, input, ctx) {
    var d = b.date !== undefined ? E.convertTo(b.date, "datetime") : new PSDate(ctx.session.system.now);
    var x = d.d();
    if (b.year !== undefined || b.month !== undefined || b.day !== undefined || b.hour !== undefined || b.minute !== undefined || b.second !== undefined) {
      d = new PSDate(Date.UTC(b.year !== undefined ? toNumber(b.year) : x.getUTCFullYear(), b.month !== undefined ? toNumber(b.month) - 1 : x.getUTCMonth(), b.day !== undefined ? toNumber(b.day) : x.getUTCDate(),
        b.hour !== undefined ? toNumber(b.hour) : x.getUTCHours(), b.minute !== undefined ? toNumber(b.minute) : x.getUTCMinutes(), b.second !== undefined ? toNumber(b.second) : x.getUTCSeconds()));
    }
    if (b.format !== undefined) return [E.formatDate(d, toStr(b.format))];
    return [d];
  }, { synopsis: "Gets the current date and time (in this lab: Tuesday 10 November 2026, 09:00).", examples: ["Get-Date", "Get-Date -Format 'yyyy-MM-dd'", "(Get-Date).AddDays(-90)"] });
  C("New-TimeSpan", UTIL, [p("Start", 0), p("End", 1), p("Days"), p("Hours"), p("Minutes"), p("Seconds")], function (b, input, ctx) {
    if (b.start !== undefined || b.end !== undefined) {
      var s = b.start !== undefined ? E.convertTo(b.start, "datetime") : new PSDate(ctx.session.system.now);
      var e = b.end !== undefined ? E.convertTo(b.end, "datetime") : new PSDate(ctx.session.system.now);
      return [new PSTimeSpan(e.ms - s.ms)];
    }
    return [new PSTimeSpan(((toNumber(b.days || 0) * 24 + toNumber(b.hours || 0)) * 60 + toNumber(b.minutes || 0)) * 60000 + toNumber(b.seconds || 0) * 1000)];
  }, { synopsis: "Makes a TimeSpan: the time between two dates, or a number of days/hours/minutes." });
  C("Get-Random", UTIL, [p("Maximum", 0), p("Minimum"), p("InputObject"), p("Count"), p("SetSeed")], function (b, input, ctx) {
    var sys = ctx.session.system;
    if (b.setseed !== undefined) sys.seed = toNumber(b.setseed);
    function rnd() { sys.seed = (sys.seed * 1103515245 + 12345) % 2147483648; return sys.seed / 2147483648; }
    var items = input && input.length ? input : b.inputobject !== undefined ? list(b.inputobject) : null;
    if (items) {
      var pool = items.slice(), out = [], n = b.count !== undefined ? toNumber(b.count) : 1;
      while (out.length < n && pool.length) out.push(pool.splice(Math.floor(rnd() * pool.length), 1)[0]);
      return out;
    }
    var min = b.minimum !== undefined ? toNumber(b.minimum) : 0, max = b.maximum !== undefined ? toNumber(b.maximum) : 2147483647;
    return [min + Math.floor(rnd() * (max - min))];
  }, { synopsis: "Gets a random number, or random items from a list. (In this lab it's repeatable: the same every run.)" });
  C("Start-Sleep", UTIL, [p("Seconds", 0), p("Milliseconds")], function (b, input, ctx) {
    ctx.session.system.slept = (ctx.session.system.slept || 0) + toNumber(b.seconds || 0) + toNumber(b.milliseconds || 0) / 1000;
    ctx.session.system.now += toNumber(b.seconds || 0) * 1000 + toNumber(b.milliseconds || 0);
    return [];
  }, { synopsis: "Waits. (In this lab it doesn't really wait: it moves the lab clock forward.)" });
  alias("sleep", "Start-Sleep");
  C("Read-Host", UTIL, [p("Prompt", 0), sw("AsSecureString")], function (b, input, ctx) {
    var sys = ctx.session.system;
    if (!sys.stdin.length) throw err("Read-Host asked for input, but the Input box has no more lines.", "ReadError");
    var v = sys.stdin.shift();
    ctx.session.write((b.prompt !== undefined ? toStr(b.prompt) + ": " : "") + (b.assecurestring ? "********" : v), "host");
    return [v];
  }, { synopsis: "Asks the user to type something." });

  /* ================================================================== Files */
  C("Get-Content", MGMT, [p("Path", 0), p("TotalCount", null, { aliases: ["Head", "First"] }), p("Tail", null, { aliases: ["Last"] }), sw("Raw")], function (b, input, ctx) {
    var out = [];
    names(b.path).forEach(function (pth) {
      var f = fsGet(ctx.session.system, pth);
      if (!f) { pathNotFound(ctx, pth); return; }
      if (b.raw) { out.push(f.content); return; }
      var l = readLines(f.content);
      if (b.totalcount !== undefined) l = l.slice(0, toNumber(b.totalcount));
      if (b.tail !== undefined) l = l.slice(Math.max(0, l.length - toNumber(b.tail)));
      out = out.concat(l);
    });
    return out;
  }, { synopsis: "Reads a text file: one string per line (or one big string with -Raw).", examples: ["Get-Content .\\logs\\app.log", "Get-Content .\\logs\\app.log -Tail 5"] });
  alias("cat", "Get-Content"); alias("gc", "Get-Content"); alias("type", "Get-Content");
  function writeContent(append) {
    return function (b, input, ctx) {
      var sys = ctx.session.system;
      var vals = input && input.length ? input : list(b.value);
      var text = vals.map(toStr).join("\n") + (vals.length ? "\n" : "");
      names(b.path).forEach(function (pth) {
        if (ctx.whatIf) { ctx.session.write("What if: Performing the operation \"" + (append ? "Add Content" : "Set Content") + "\" on target \"Path: " + normPath(sys, pth).display + "\".", "whatif"); return; }
        var f = fsGet(sys, pth);
        fsWrite(sys, pth, append && f ? f.content + text : text);
      });
      return [];
    };
  }
  C("Set-Content", MGMT, [p("Path", 0), p("Value", 1)], writeContent(false), { synopsis: "Writes (replaces) the content of a file." });
  C("Add-Content", MGMT, [p("Path", 0), p("Value", 1)], writeContent(true), { synopsis: "Adds lines to the end of a file." });
  C("Out-File", UTIL, [p("FilePath", 0, { aliases: ["Path"] }), sw("Append"), p("InputObject"), p("Encoding"), sw("NoNewline")], function (b, input, ctx) {
    var items = inputItems(input, b);
    var text = items.every(function (x) { return typeof x === "string"; }) ? items.join("\n") : E.formatItems(items, ctx.session).replace(/^\n/, "");
    if (text && !/\n$/.test(text)) text += "\n";
    var sys = ctx.session.system, f = fsGet(sys, b.filepath);
    fsWrite(sys, b.filepath, b.append && f ? f.content + text : text);
    return [];
  }, { synopsis: "Saves output to a file, exactly as it would look on screen." });
  C("Test-Path", MGMT, [p("Path", 0), p("PathType")], function (b, input, ctx) {
    var sys = ctx.session.system;
    return names(b.path).map(function (pth) {
      var isFile = !!fsGet(sys, pth), isDir = fsIsDir(sys, pth);
      var t = b.pathtype !== undefined ? lc(toStr(b.pathtype)) : "any";
      return t === "leaf" ? isFile : t === "container" ? isDir : isFile || isDir;
    });
  }, { synopsis: "Checks whether a file or folder exists: $true or $false." });
  C("Get-ChildItem", MGMT, [p("Path", 0), p("Filter", 1), sw("Recurse"), sw("File"), sw("Directory"), p("Include"), p("Exclude"), sw("Name"), sw("Force"), p("Depth")], function (b, input, ctx) {
    var sys = ctx.session.system;
    var base = b.path !== undefined ? normPath(sys, toStr(list(b.path)[0])) : normPath(sys, ".");
    var baseKey = base.key;
    var pattern = b.filter !== undefined ? toStr(b.filter) : null;
    if (!fsIsDir(sys, baseKey) && b.path !== undefined) {
      if (fsGet(sys, baseKey)) return [fileObj(sys, baseKey)];
      var bp = toStr(list(b.path)[0]);
      if (hasWildcard(bp)) { var dirPart = bp.replace(/[\\/][^\\/]*$/, ""); pattern = bp.slice(dirPart.length).replace(/^[\\/]/, ""); if (dirPart === bp) dirPart = "."; base = normPath(sys, dirPart); baseKey = base.key; }
      else { pathNotFound(ctx, bp); return []; }
    }
    var prefix = baseKey ? baseKey + "\\" : "";
    var files = [], dirs = {};
    Object.keys(sys.files).sort().forEach(function (k) {
      if (prefix && k.indexOf(prefix) !== 0) return;
      var rest = k.slice(prefix.length);
      var segs = rest.split("\\");
      if (segs.length > 1) {
        var orig = sys.files[k].name.split("\\");
        var depth = orig.length - segs.length;
        dirs[segs[0].toLowerCase()] = orig.slice(0, depth + 1).join("\\");
        if (b.recurse) for (var d = 1; d < segs.length - 1; d++) dirs[segs.slice(0, d + 1).join("\\").toLowerCase()] = orig.slice(0, depth + d + 1).join("\\");
        if (!b.recurse) return;
      }
      files.push(k);
    });
    var out = [];
    var nameOk = function (nm) {
      if (pattern && !E.wildcardRe(pattern).test(nm)) return false;
      if (b.include !== undefined && !matchAny(nm, names(b.include))) return false;
      if (b.exclude !== undefined && matchAny(nm, names(b.exclude))) return false;
      return true;
    };
    if (!b.file) Object.keys(dirs).sort().forEach(function (dk) { var rel = dirs[dk]; var nm = rel.split("\\").pop(); if (nameOk(nm)) out.push(dirObj(sys, rel)); });
    if (!b.directory) files.forEach(function (k) { var fo = fileObj(sys, k); if (nameOk(fo.get("Name"))) out.push(fo); });
    if (b.name) return out.map(function (o) { return toStr(o.get("FullName")).slice(sys.cwd.length + 1 + (prefix ? prefix.length : 0)); });
    return out;
  }, { synopsis: "Lists files and folders. -Recurse goes into sub-folders; -Filter *.log picks by name.", examples: ["Get-ChildItem", "Get-ChildItem .\\logs -Filter *.log", "Get-ChildItem -Recurse -File"] });
  alias("ls", "Get-ChildItem"); alias("dir", "Get-ChildItem"); alias("gci", "Get-ChildItem");
  C("Get-Item", MGMT, [p("Path", 0)], function (b, input, ctx) {
    var sys = ctx.session.system, out = [];
    names(b.path).forEach(function (pth) {
      var n = normPath(sys, pth);
      if (sys.files[n.key]) out.push(fileObj(sys, n.key));
      else if (fsIsDir(sys, pth)) out.push(dirObj(sys, n.rel));
      else pathNotFound(ctx, pth);
    });
    return out;
  }, { synopsis: "Gets one file or folder." });
  alias("gi", "Get-Item");
  C("New-Item", MGMT, [p("Path", 0), p("ItemType"), p("Value"), sw("Force"), p("Name")], function (b, input, ctx) {
    var sys = ctx.session.system;
    var pth = b.name !== undefined ? toStr(b.path || ".") + "\\" + toStr(b.name) : toStr(b.path);
    if (lc(toStr(b.itemtype || "file")) === "directory") { fsWrite(sys, pth + "\\.keep", ""); return [dirObj(sys, normPath(sys, pth).rel)]; }
    if (fsGet(sys, pth) && !b.force) { E.writeCmdletError(ctx, "The file '" + normPath(sys, pth).display + "' already exists.", "WriteError", pth); return []; }
    fsWrite(sys, pth, b.value === undefined ? "" : toStr(b.value));
    return [fileObj(sys, normPath(sys, pth).key)];
  }, { synopsis: "Creates a file or folder." });
  alias("ni", "New-Item");
  C("Remove-Item", MGMT, [p("Path", 0), sw("Recurse"), sw("Force")], function (b, input, ctx) {
    var sys = ctx.session.system;
    names(b.path).forEach(function (pth) {
      var n = normPath(sys, pth);
      if (ctx.whatIf) { ctx.session.write("What if: Performing the operation \"Remove File\" on target \"" + n.display + "\".", "whatif"); return; }
      if (sys.files[n.key]) delete sys.files[n.key];
      else if (fsIsDir(sys, pth)) Object.keys(sys.files).forEach(function (k) { if (k.indexOf(n.key + "\\") === 0) delete sys.files[k]; });
      else pathNotFound(ctx, pth);
    });
    return [];
  }, { synopsis: "Deletes files or folders. Supports -WhatIf." });
  alias("rm", "Remove-Item"); alias("del", "Remove-Item");
  C("Join-Path", MGMT, [p("Path", 0), p("ChildPath", 1)], function (b) {
    return [toStr(b.path).replace(/[\\/]+$/, "") + "\\" + toStr(b.childpath).replace(/^[\\/]+/, "")];
  }, { synopsis: "Joins a folder and a file name with the right separator." });
  C("Split-Path", MGMT, [p("Path", 0), sw("Leaf"), sw("Parent"), sw("Extension"), sw("LeafBase")], function (b) {
    var s = toStr(b.path).replace(/\//g, "\\"), i = s.lastIndexOf("\\");
    var leaf = i >= 0 ? s.slice(i + 1) : s;
    if (b.leaf) return [leaf];
    if (b.extension) return [leaf.indexOf(".") >= 0 ? leaf.slice(leaf.lastIndexOf(".")) : ""];
    if (b.leafbase) return [leaf.indexOf(".") >= 0 ? leaf.slice(0, leaf.lastIndexOf(".")) : leaf];
    return [i >= 0 ? s.slice(0, i) : ""];
  }, { synopsis: "Gets part of a path: the folder (default), or the file name with -Leaf." });
  C("Get-Location", MGMT, [], function (b, input, ctx) { var o = obj("System.Management.Automation.PathInfo", { Path: ctx.session.system.cwd }); o.toStringFn = function () { return ctx.session.system.cwd; }; return [o]; }, { synopsis: "Shows the current folder." });
  alias("pwd", "Get-Location");

  /* ================================================================== CSV and JSON */
  function csvSplit(line, delim) {
    var out = [], cur = "", q = false;
    for (var k = 0; k < line.length; k++) {
      var c = line[k];
      if (q) { if (c === "\"" && line[k + 1] === "\"") { cur += "\""; k++; } else if (c === "\"") q = false; else cur += c; }
      else if (c === "\"") q = true;
      else if (c === delim) { out.push(cur); cur = ""; }
      else cur += c;
    }
    out.push(cur);
    return out;
  }
  function fromCsv(lines, delim, header) {
    lines = lines.filter(function (l) { return l.trim() !== "" && !/^#TYPE/.test(l); });
    if (!lines.length) return [];
    var cols = header ? header : csvSplit(lines.shift(), delim);
    return lines.map(function (l) {
      var vals = csvSplit(l, delim);
      var o = new PSObject();
      cols.forEach(function (c, i) { o.set(c, vals[i] === undefined ? null : vals[i]); });
      return o;
    });
  }
  function csvField(v) { var s = E.cellText(v); return "\"" + s.replace(/"/g, "\"\"") + "\""; }
  function toCsv(items, delim) {
    items = items.filter(function (x) { return x !== null && x !== undefined; });
    if (!items.length) return [];
    var first = items[0];
    var cols = first instanceof PSObject ? first.names() : first instanceof PSHashtable ? ["IsReadOnly", "IsFixedSize", "IsSynchronized", "Keys", "Values", "SyncRoot", "Count"] : ["Length"];
    var out = [cols.map(function (c) { return "\"" + c + "\""; }).join(delim)];
    items.forEach(function (x) { out.push(cols.map(function (c) { return csvField(E.propertyOf(x, c)); }).join(delim)); });
    return out;
  }
  C("Import-Csv", UTIL, [p("Path", 0), p("Delimiter", 1), p("Header")], function (b, input, ctx) {
    var f = fsGet(ctx.session.system, b.path);
    if (!f) { pathNotFound(ctx, b.path); return []; }
    return fromCsv(readLines(f.content), b.delimiter !== undefined ? toStr(b.delimiter) : ",", b.header !== undefined ? names(b.header) : null);
  }, { synopsis: "Reads a CSV file into objects: one object per row, one property per column (every value is a string).", examples: ["Import-Csv .\\data\\hr.csv"] });
  C("Export-Csv", UTIL, [p("Path", 0), p("Delimiter", 1), sw("NoTypeInformation"), sw("Append"), p("InputObject"), sw("Force")], function (b, input, ctx) {
    var items = inputItems(input, b), sys = ctx.session.system;
    var lines = toCsv(items, b.delimiter !== undefined ? toStr(b.delimiter) : ",");
    var f = fsGet(sys, b.path);
    if (b.append && f) lines = lines.slice(1);
    fsWrite(sys, b.path, (b.append && f ? f.content : "") + lines.join("\n") + (lines.length ? "\n" : ""));
    return [];
  }, { synopsis: "Saves objects to a CSV file (PowerShell 7 doesn't add the #TYPE line, so -NoTypeInformation is optional)." });
  C("ConvertTo-Csv", UTIL, [p("InputObject", 0), p("Delimiter"), sw("NoTypeInformation")], function (b, input) { return toCsv(inputItems(input, b), b.delimiter !== undefined ? toStr(b.delimiter) : ","); }, { synopsis: "Converts objects to CSV text lines." });
  C("ConvertFrom-Csv", UTIL, [p("InputObject", 0), p("Delimiter"), p("Header")], function (b, input) {
    var lines = inputItems(input, b).reduce(function (a, x) { return a.concat(toStr(x).split("\n")); }, []);
    return fromCsv(lines, b.delimiter !== undefined ? toStr(b.delimiter) : ",", b.header !== undefined ? names(b.header) : null);
  }, { synopsis: "Converts CSV text into objects." });

  function jsonOf(v, depth, max, ctx, ind, compress) {
    var nl = compress ? "" : "\n", sp = compress ? "" : "  ";
    var pad = compress ? "" : sp.repeat(ind + 1), pad0 = compress ? "" : sp.repeat(ind);
    if (v === null || v === undefined) return "null";
    if (typeof v === "string") return JSON.stringify(v);
    if (typeof v === "number") return isFinite(v) ? String(v) : "null";
    if (typeof v === "boolean") return v ? "true" : "false";
    if (v instanceof PSDate) return JSON.stringify(E.formatDate(v, "yyyy-MM-ddTHH:mm:ss"));
    if (depth > max) return JSON.stringify(toStr(v));
    if (Array.isArray(v)) {
      if (!v.length) return "[]";
      return "[" + nl + v.map(function (x) { return pad + jsonOf(x, depth + 1, max, ctx, ind + 1, compress); }).join("," + nl) + nl + pad0 + "]";
    }
    var entries = v instanceof PSHashtable ? v.entries().map(function (e) { return [toStr(e.key), e.value]; }) : v instanceof PSObject ? v.props.map(function (pp) { return [pp.name, pp.value]; }) : null;
    if (!entries) return JSON.stringify(toStr(v));
    if (!entries.length) return "{}";
    return "{" + nl + entries.map(function (e) { return pad + JSON.stringify(e[0]) + ":" + (compress ? "" : " ") + jsonOf(e[1], depth + 1, max, ctx, ind + 1, compress); }).join("," + nl) + nl + pad0 + "}";
  }
  C("ConvertTo-Json", UTIL, [p("InputObject", 0), p("Depth"), sw("Compress"), sw("AsArray")], function (b, input, ctx) {
    var items = inputItems(input, b);
    var v = b.asarray || items.length > 1 ? items : items[0];
    if (input === null && b.inputobject !== undefined) v = b.inputobject;
    var depth = b.depth !== undefined ? toNumber(b.depth) : 2;
    return [jsonOf(v, 0, depth, ctx, 0, !!b.compress)];
  }, { synopsis: "Converts objects to JSON text. Nested objects deeper than -Depth (default 2) become strings!", examples: ["$obj | ConvertTo-Json -Depth 5"] });
  function fromJson(x, asHash) {
    if (x === null) return null;
    if (Array.isArray(x)) return x.map(function (i) { return fromJson(i, asHash); });
    if (typeof x === "object") {
      var o = asHash ? new PSHashtable(true) : new PSObject();
      Object.keys(x).forEach(function (k) { o.set(k, fromJson(x[k], asHash)); });
      return o;
    }
    return x;
  }
  C("ConvertFrom-Json", UTIL, [p("InputObject", 0), sw("AsHashtable"), p("Depth")], function (b, input) {
    var text = inputItems(input, b).map(toStr).join("\n");
    var data;
    try { data = JSON.parse(text); } catch (e) { throw err("Conversion from JSON failed with error: " + e.message, "InvalidData"); }
    var v = fromJson(data, !!b.ashashtable);
    return Array.isArray(v) ? [v] : [v];
  }, { synopsis: "Converts JSON text into objects you can use with dot notation.", examples: ["Get-Content .\\config.json -Raw | ConvertFrom-Json"] });

  /* ================================================================== .NET types, static members, members */
  lib.newObject = function (tn, args, ctx) {
    var t = lc(tn).replace(/^system\./, "");
    if (t === "psobject" || t === "management.automation.psobject" || t === "pscustomobject") return new PSObject();
    if (t === "collections.arraylist") { var a = []; a.__list = "arraylist"; return a; }
    if (/^collections\.generic\.list\[/.test(t) || /^collections\.generic\.list`1/.test(t)) { var l = []; l.__list = "list"; return l; }
    if (t === "collections.hashtable") return new PSHashtable();
    if (t === "datetime") return new PSDate(Date.UTC(toNumber(args[0]), toNumber(args[1] || 1) - 1, toNumber(args[2] || 1)));
    if (t === "text.stringbuilder") { var sb = new PSObject("System.Text.StringBuilder"); var buf = []; sb.methods = { append: function (a) { buf.push(toStr(a[0])); return undefined; }, appendline: function (a) { buf.push(toStr(a[0] === undefined ? "" : a[0]) + "\n"); return undefined; }, tostring: function () { return buf.join(""); } }; sb.toStringFn = function () { return buf.join(""); }; return sb; }
    if (lib.newObjectExtra) { var r = lib.newObjectExtra(tn, args, ctx); if (r !== undefined) return r; }
    throw err("Cannot find type [" + tn + "]: verify that the assembly containing this type is loaded.", "InvalidType");
  };
  lib.convert = function (v, typeName) {
    var t = lc(typeName).replace(/^system\./, "");
    if (t === "collections.arraylist" || /^collections\.generic\.list\[/.test(t)) {
      var a = v === null || v === undefined ? [] : Array.isArray(v) ? v.slice() : [v];
      a.__list = t === "collections.arraylist" ? "arraylist" : "list";
      return a;
    }
    if (t === "ipaddress" || t === "net.ipaddress") {
      var s = toStr(v);
      if (!/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.test(s) || s.split(".").some(function (x) { return +x > 255; })) throw err("Cannot convert value \"" + s + "\" to type \"System.Net.IPAddress\". Error: \"An invalid IP address was specified.\"");
      var ip = obj("System.Net.IPAddress", { IPAddressToString: s, AddressFamily: "InterNetwork" });
      ip.toStringFn = function () { return s; };
      return ip;
    }
    if (t === "securestring" || t === "security.securestring") { var ss = obj("System.Security.SecureString", { Length: toStr(v).length }); ss.secret = toStr(v); ss.toStringFn = function () { return "System.Security.SecureString"; }; return ss; }
    return undefined;
  };
  lib.staticProperty = function (tn, name, ctx) {
    var t = lc(tn).replace(/^system\./, ""), n = lc(name);
    if (t === "math") { if (n === "pi") return Math.PI; if (n === "e") return Math.E; }
    if (t === "int" || t === "int32") { if (n === "maxvalue") return 2147483647; if (n === "minvalue") return -2147483648; }
    if (t === "string" && n === "empty") return "";
    if (t === "datetime") { if (n === "now") return new PSDate(ctx.session.system.now); if (n === "today") { var d = new PSDate(ctx.session.system.now).d(); return new PSDate(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())); } if (n === "utcnow") return new PSDate(ctx.session.system.now); }
    if (t === "environment") { if (n === "newline") return "\n"; if (n === "machinename") return "KC-WIN-01"; if (n === "username") return "dev"; if (n === "osversion") return "Microsoft Windows NT 10.0.26100.0"; }
    if (t === "io.path" && n === "directoryseparatorchar") return "\\";
    if (lib.staticPropertyExtra) return lib.staticPropertyExtra(tn, name, ctx);
    return undefined;
  };
  lib.staticMethod = function (tn, name, args, ctx) {
    var t = lc(tn).replace(/^system\./, ""), n = lc(name);
    if (n === "new") return lib.newObject(tn, args, ctx);
    if (t === "math") {
      var a = args.map(function (x) { return toNumber(x); });
      switch (n) {
        case "round": {
          var dg = a[1] || 0, f = Math.pow(10, dg);
          var mode = args[2] !== undefined ? lc(toStr(args[2])) : (args[1] !== undefined && typeof args[1] === "string" ? lc(args[1]) : "toeven");
          if (args[1] !== undefined && typeof args[1] === "string") { dg = 0; f = 1; }
          var x = a[0] * f;
          var r = /awayfromzero/.test(mode) ? Math.sign(x) * Math.round(Math.abs(x)) : E.roundEven(Math.round(x * 1e9) / 1e9);
          return r / f;
        }
        case "floor": return Math.floor(a[0]); case "ceiling": return Math.ceil(a[0]); case "abs": return Math.abs(a[0]);
        case "max": return Math.max(a[0], a[1]); case "min": return Math.min(a[0], a[1]); case "pow": return Math.pow(a[0], a[1]);
        case "sqrt": return Math.sqrt(a[0]); case "truncate": return Math.trunc(a[0]);
      }
    }
    if (t === "string") {
      switch (n) {
        case "isnullorempty": return args[0] === null || args[0] === undefined || toStr(args[0]) === "";
        case "isnullorwhitespace": return args[0] === null || args[0] === undefined || toStr(args[0]).trim() === "";
        case "join": return E.enumerate(args.length > 2 ? args.slice(1) : args[1]).map(toStr).join(toStr(args[0]));
        case "format": return E.formatOperator(toStr(args[0]), args.length === 2 && Array.isArray(args[1]) ? args[1] : args.slice(1));
        case "concat": return args.map(toStr).join("");
      }
    }
    if (t === "int" || t === "int32" || t === "double") {
      if (n === "parse") return E.convertTo(args[0], tn);
    }
    if (t === "datetime") {
      if (n === "parse") return E.parseDate(args[0]);
      if (n === "parseexact") return E.parseDate(args[0]);
    }
    if (t === "io.path") {
      var s = toStr(args[0]).replace(/\//g, "\\"), leaf = s.split("\\").pop();
      switch (n) {
        case "getextension": return leaf.indexOf(".") >= 0 ? leaf.slice(leaf.lastIndexOf(".")) : "";
        case "getfilename": return leaf;
        case "getfilenamewithoutextension": return leaf.indexOf(".") >= 0 ? leaf.slice(0, leaf.lastIndexOf(".")) : leaf;
        case "getdirectoryname": return s.indexOf("\\") >= 0 ? s.slice(0, s.lastIndexOf("\\")) : "";
        case "combine": return args.map(toStr).join("\\").replace(/\\\\+/g, "\\");
      }
    }
    if (t === "regex") {
      if (n === "escape") return toStr(args[0]).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      if (n === "ismatch") return E.netRegex(toStr(args[1]), "i").test(toStr(args[0]));
      if (n === "matches") {
        var re = E.netRegex(toStr(args[1]), "gi"), str = toStr(args[0]), out = [], m;
        while ((m = re.exec(str)) !== null) { out.push(obj("System.Text.RegularExpressions.Match", { Value: m[0], Index: m.index, Success: true, Groups: Array.from(m).map(function (g) { return obj("Group", { Value: g == null ? "" : g }); }) })); if (!m[0]) re.lastIndex++; }
        return out;
      }
      if (n === "replace") return toStr(args[0]).replace(E.netRegex(toStr(args[1]), "gi"), toStr(args[2]));
    }
    if (t === "char" && n === "isdigit") return /^[0-9]$/.test(toStr(args[0]));
    if (lib.staticMethodExtra) return lib.staticMethodExtra(tn, name, args, ctx);
    return undefined;
  };

  var STRING_METHODS = ["Contains", "EndsWith", "IndexOf", "Insert", "LastIndexOf", "PadLeft", "PadRight", "Remove", "Replace", "Split", "StartsWith", "Substring", "ToCharArray", "ToLower", "ToString", "ToUpper", "Trim", "TrimEnd", "TrimStart"];
  lib.membersOf = function (x) {
    var out = [];
    var std = ["Equals", "GetHashCode", "GetType", "ToString"];
    function meth(n, def) { out.push({ Name: n, MemberType: "Method", Definition: def || n + "(...)" }); }
    if (typeof x === "string") {
      STRING_METHODS.forEach(function (m) { meth(m, "string " + m + "(...)"); });
      ["Equals", "GetHashCode", "GetType"].forEach(function (m) { meth(m); });
      out.push({ Name: "Length", MemberType: "Property", Definition: "int Length {get;}" });
    } else if (x instanceof PSObject) {
      var isCustom = x.typeName === "System.Management.Automation.PSCustomObject";
      std.forEach(function (m) { meth(m); });
      if (x.methods) Object.keys(x.methods).forEach(function (m) { meth(m.charAt(0).toUpperCase() + m.slice(1), "ScriptMethod"); });
      x.props.forEach(function (pp) {
        var tn = E.shortType(E.typeOfValue(pp.value)) || "Object";
        out.push({ Name: pp.name, MemberType: isCustom ? "NoteProperty" : "Property", Definition: isCustom ? lc(tn) + " " + pp.name + "=" + E.cellText(pp.value) : tn + " " + pp.name + " {get;}" });
      });
    } else if (x instanceof PSHashtable) {
      ["Add", "Clear", "Clone", "ContainsKey", "ContainsValue", "GetEnumerator", "Remove"].concat(std).forEach(function (m) { meth(m); });
      ["Count", "Keys", "Values"].forEach(function (pp) { out.push({ Name: pp, MemberType: "Property", Definition: pp }); });
    } else if (typeof x === "number") {
      ["CompareTo", "Equals", "GetHashCode", "GetType", "ToString"].forEach(function (m) { meth(m); });
    } else if (x instanceof PSDate) {
      ["AddDays", "AddHours", "AddMinutes", "AddMonths", "AddYears", "ToShortDateString", "ToString"].concat(["Equals", "GetHashCode", "GetType"]).forEach(function (m) { meth(m); });
      ["Date", "Day", "DayOfWeek", "DayOfYear", "Hour", "Minute", "Month", "Second", "Year"].forEach(function (pp) { out.push({ Name: pp, MemberType: "Property", Definition: pp + " {get;}" }); });
    } else {
      std.forEach(function (m) { meth(m); });
    }
    out.sort(function (a, b) { return a.MemberType === b.MemberType ? (lc(a.Name) < lc(b.Name) ? -1 : 1) : a.MemberType < b.MemberType ? -1 : 1; });
    return out;
  };
  lib.tableHeader = function (o) {
    if (o.typeName === "Microsoft.PowerShell.Commands.MemberDefinition") return "   TypeName: " + o.get("TypeName");
    if (o.typeName === "System.IO.FileInfo") { var d = o.get("DirectoryName") || o.get("FullName"); return "    Directory: " + (o.get("PSIsContainer") ? toStr(o.get("FullName")).replace(/\\[^\\]*$/, "") : d); }
    return null;
  };

  lib.binary = function (op, l, r, ctx) {
    // expression-level binary operator, reused by Where-Object's simplified syntax
    var node = { t: "bin", op: op, l: { t: "const", v: l }, r: { t: "const", v: r } };
    return E.evalExpr(node, ctx);
  };
})(typeof window !== "undefined" ? window : globalThis);
