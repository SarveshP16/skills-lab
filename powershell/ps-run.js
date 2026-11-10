/* sudo learn — Module 4 runtime, part 1: everything about *running* PowerShell code.
   Script files (.\x.ps1, & 'path', dot-sourcing, #Requires), the pwsh/powershell executable (-File, -Command,
   -EncodedCommand, -ExecutionPolicy, -NoProfile), cmd.exe and .cmd/.bat launchers, shortcuts (.lnk via WScript.Shell),
   Start-Process / Invoke-Item (Run as administrator), execution policy + Mark of the Web + Authenticode signing,
   modules (Import-Module, Export-ModuleMember, PSModulePath auto-loading, Install-Module), $PROFILE, scheduled tasks,
   ps2exe executables, Invoke-Expression and a tiny AMSI. Child processes share the pretend machine (files, services,
   registry) but get their own variables, functions and execution-policy process scope, like real processes. */
(function (root) {
  "use strict";
  var E = root.PSEngine, lib = E.lib;
  var PSObject = E.PSObject, PSHashtable = E.PSHashtable, PSDate = E.PSDate, ScriptBlock = E.ScriptBlock;
  var toStr = E.toStr, toNumber = E.toNumber, toBool = E.toBool, lc = E.lc, obj = E.obj, enumerate = E.enumerate;
  function err(msg, cat, extra) { var o = { category: cat || "InvalidArgument" }; if (extra) for (var k in extra) o[k] = extra[k]; return new E.PSError(msg, o); }
  function list(v) { return v === undefined || v === null ? [] : Array.isArray(v) ? v : [v]; }
  function names(v) { return list(v).map(toStr); }
  function p(name, position, extra) { var o = { name: name, position: position == null ? null : position }; if (extra) for (var k in extra) o[k] = extra[k]; return o; }
  function sw(name) { return { name: name, type: "switch" }; }
  function C(name, module, params, run, help) { lib.cmdlets[lc(name)] = { name: name, module: module, params: params, run: run, help: help || {} }; }
  function alias(a, n) { lib.aliases[lc(a)] = n; }
  var fs = lib.fs;
  var CORE = "Microsoft.PowerShell.Core", SEC = "Microsoft.PowerShell.Security", MGMT = "Microsoft.PowerShell.Management", UTIL = "Microsoft.PowerShell.Utility";
  var TASKS = "ScheduledTasks", PSGET = "PowerShellGet";
  var HOME = "C:\\Users\\dev", DOCS = HOME + "\\Documents\\PowerShell";
  var PROFILE = DOCS + "\\Microsoft.PowerShell_profile.ps1";
  var USER_MODULES = DOCS + "\\Modules", ALL_MODULES = "C:\\Program Files\\PowerShell\\Modules", SYS_MODULES = "C:\\Program Files\\PowerShell\\7\\Modules";
  var ABOUT_POLICY = "For more information, see about_Execution_Policies at https://go.microsoft.com/fwlink/?LinkID=135170.";

  /* ================================================================== Machine + session state */
  var GALLERY = {
    "ps2exe": { version: "1.0.15", author: "Markus Scholtes", desc: "Turns a PowerShell script into an .exe file", commands: ["Invoke-ps2exe", "ps2exe", "Win-PS2EXE"] },
    "pester": { version: "5.6.1", author: "Pester Team", desc: "Testing and mocking framework for PowerShell", commands: ["Invoke-Pester", "Describe", "Context", "It", "Should", "BeforeAll", "BeforeEach", "AfterAll", "AfterEach", "Mock"], name: "Pester" },
    "psscriptanalyzer": { version: "1.23.0", author: "Microsoft Corporation", desc: "Static code checker for PowerShell", commands: ["Invoke-ScriptAnalyzer", "Get-ScriptAnalyzerRule"], name: "PSScriptAnalyzer" },
    "microsoft.powershell.secretmanagement": { version: "1.1.2", author: "Microsoft Corporation", desc: "Stores and retrieves secrets from vaults", commands: ["Get-Secret", "Set-Secret", "Get-SecretInfo", "Register-SecretVault"], name: "Microsoft.PowerShell.SecretManagement" },
    "microsoft.powershell.secretstore": { version: "1.0.6", author: "Microsoft Corporation", desc: "Local secret vault for SecretManagement", commands: [], name: "Microsoft.PowerShell.SecretStore" }
  };
  GALLERY["ps2exe"].name = "ps2exe";
  lib.gallery = GALLERY;

  lib.systemHooks.push(function (sys) {
    // Execution policy per scope. Process scope lives on each session (it belongs to one process).
    sys.policy = { MachinePolicy: "Undefined", UserPolicy: "Undefined", CurrentUser: "Undefined", LocalMachine: "RemoteSigned" };
    sys.certs = [
      { Thumbprint: "8F3C2B9A1D4E5F60718293A4B5C6D7E8F9012A3B", Subject: "CN=Kestrel Cloud Code Signing, O=Kestrel Cloud, C=GB", Issuer: "CN=Kestrel Cloud Issuing CA, O=Kestrel Cloud",
        NotAfter: Date.UTC(2027, 5, 30), codeSigning: true, trusted: true, store: "currentuser\\my", HasPrivateKey: true, FriendlyName: "Kestrel code signing" },
      { Thumbprint: "1A2B3C4D5E6F708192A3B4C5D6E7F8091A2B3C4D", Subject: "CN=dev@kestrel.io", Issuer: "CN=Kestrel Cloud Issuing CA, O=Kestrel Cloud",
        NotAfter: Date.UTC(2027, 1, 1), codeSigning: false, trusted: true, store: "currentuser\\my", HasPrivateKey: true, FriendlyName: "Kestrel email" }
    ];
    sys.tasks = [
      task("\\Microsoft\\Windows\\Defrag\\", "ScheduledDefrag", "%windir%\\system32\\defrag.exe", "-c -h -o -$", "SYSTEM", "Microsoft Corporation"),
      task("\\Microsoft\\Windows\\WindowsUpdate\\", "Scheduled Start", "C:\\Windows\\system32\\sc.exe", "start wuauserv", "SYSTEM", "Microsoft Corporation"),
      task("\\Kestrel\\", "Kestrel agent update", "C:\\Program Files\\Kestrel\\Updater\\kupdate.exe", "--check", "SYSTEM", "Kestrel Cloud")
    ];
    sys.installed = { "pester": true, "psscriptanalyzer": true };   // gallery modules already on KC-WIN-01
    sys.uac = [];
    sys.features = { MicrosoftWindowsPowerShellV2Root: "Enabled", MicrosoftWindowsPowerShellV2: "Enabled", "SMB1Protocol": "Disabled" };
  });
  function task(path, name, exe, args, user, author) {
    return { TaskPath: path, TaskName: name, State: "Ready", Actions: [{ Execute: exe, Arguments: args || null, WorkingDirectory: null }], Triggers: [{ kind: "Daily", at: "03:00" }],
      Principal: { UserId: user, RunLevel: user === "SYSTEM" ? "Highest" : "Limited", LogonType: user === "SYSTEM" ? "ServiceAccount" : "Interactive" }, Author: author || "KESTREL\\dev", Description: "", LastRunTime: null, LastTaskResult: 267011 };
  }
  lib.sessionHooks = lib.sessionHooks || [];
  lib.sessionHooks.push(function (s) {
    s.processPolicy = "Undefined";
    s.elevated = false;
    s.env.PSModulePath = USER_MODULES + ";" + ALL_MODULES + ";" + SYS_MODULES;
    s.env.USERPROFILE = HOME; s.env.APPDATA = HOME + "\\AppData\\Roaming"; s.env.LOCALAPPDATA = HOME + "\\AppData\\Local";
    s.env.ProgramFiles = "C:\\Program Files"; s.env.windir = "C:\\Windows"; s.env.SystemRoot = "C:\\Windows";
    s.global.setLocal("PROFILE", PROFILE);
    s.global.setLocal("PSHOME", "C:\\Program Files\\PowerShell\\7");
    s.global.setLocal("LASTEXITCODE", null);
  });

  /* ================================================================== Hashing for signatures (SHA-256 of the text) */
  function sha256hex(str) { return lib.hash ? lib.hash.sha256(str) : String(str.length); }

  /* ================================================================== Execution policy */
  var POLICIES = ["Unrestricted", "RemoteSigned", "AllSigned", "Restricted", "Default", "Bypass", "Undefined"];
  function normPolicy(v) {
    var s = lc(toStr(v));
    var hit = POLICIES.filter(function (x) { return lc(x) === s; })[0];
    if (!hit) throw err("Cannot bind parameter 'ExecutionPolicy'. Cannot convert value \"" + toStr(v) + "\" to type \"Microsoft.PowerShell.ExecutionPolicy\". Error: \"Unable to match the identifier name " + toStr(v) + " to a valid enumerator name. Specify one of the following enumerator names and try again:\nUnrestricted, RemoteSigned, AllSigned, Restricted, Default, Bypass, Undefined\"");
    return hit === "Default" ? "RemoteSigned" : hit;
  }
  function policyList(session) {
    var sys = session.system;
    return [["MachinePolicy", sys.policy.MachinePolicy], ["UserPolicy", sys.policy.UserPolicy], ["Process", session.processPolicy || "Undefined"], ["CurrentUser", sys.policy.CurrentUser], ["LocalMachine", sys.policy.LocalMachine]];
  }
  function effectivePolicy(session) {
    var l = policyList(session);
    for (var i = 0; i < l.length; i++) if (l[i][1] !== "Undefined") return l[i][1];
    return "Restricted";
  }
  lib.effectivePolicy = effectivePolicy;

  // Signature block appended by Set-AuthenticodeSignature: "# SIG # Begin signature block" ... "# SIG # End signature block".
  var SIG_START = "# SIG # Begin signature block";
  function splitSig(content) {
    var i = content.indexOf(SIG_START);
    if (i < 0) return { body: content, sig: null };
    var block = content.slice(i);
    var m = /# KSIG ([0-9A-F]{40}) ([0-9a-f]+)/.exec(block.replace(/\r/g, ""));
    var body = content.slice(0, i).replace(/\s+$/, "");
    // Anything added after the signature block is part of the file too (and breaks the signature).
    var endAt = block.indexOf("# SIG # End signature block");
    var after = endAt >= 0 ? block.slice(endAt + "# SIG # End signature block".length).replace(/^\s+|\s+$/g, "") : "";
    if (after) body += "\r\n" + after;
    return { body: body, sig: m ? { thumb: m[1], hash: m[2] } : { thumb: null, hash: null } };
  }
  lib.splitSig = splitSig;
  function sigStatus(sys, content) {
    var s = splitSig(content);
    if (!s.sig) return { status: "NotSigned", body: s.body };
    var cert = sys.certs.filter(function (c) { return c.Thumbprint === s.sig.thumb; })[0];
    if (!s.sig.hash || sha256hex(s.body) !== s.sig.hash) return { status: "HashMismatch", body: s.body, cert: cert };
    if (!cert || !cert.trusted) return { status: "UnknownError", body: s.body, cert: cert };
    return { status: "Valid", body: s.body, cert: cert };
  }
  function checkPolicy(session, file, display, kind) {
    var pol = effectivePolicy(session);
    if (pol === "Bypass") return;
    if (pol === "Restricted") throw err("File " + display + " cannot be loaded because running scripts is disabled on this system. " + ABOUT_POLICY, "SecurityError", { errorId: "UnauthorizedAccess" });
    var st = sigStatus(session.system, file.content);
    var remote = (file.zone || 0) >= 3;
    if (pol === "Unrestricted") {
      if (remote) session.write("Security warning\nRun only scripts that you trust. While scripts from the internet can be useful, this script can potentially harm your computer. If you trust this script, use the Unblock-File cmdlet to allow the script to run without this warning message. Do you want to run " + display + "?\n[D] Do not run  [R] Run once  [S] Suspend  [?] Help (default is \"D\"): R  (simulated answer)", "warn");
      return;
    }
    var needSig = pol === "AllSigned" || (pol === "RemoteSigned" && remote);
    if (!needSig) return;
    if (st.status === "Valid") return;
    if (st.status === "HashMismatch") throw err("File " + display + " cannot be loaded. The contents of file " + display + " might have been changed by an unauthorized user or process, because the hash of the file does not match the hash stored in the digital signature. The script cannot run on the specified system. " + ABOUT_POLICY, "SecurityError", { errorId: "UnauthorizedAccess" });
    if (st.status === "UnknownError") throw err("File " + display + " cannot be loaded. A certificate chain processed, but terminated in a root certificate which is not trusted by the trust provider. " + ABOUT_POLICY, "SecurityError", { errorId: "UnauthorizedAccess" });
    throw err("File " + display + " cannot be loaded. The file " + display + " is not digitally signed. You cannot run this script on the current system. " + ABOUT_POLICY, "SecurityError", { errorId: "UnauthorizedAccess" });
  }
  lib.checkPolicy = checkPolicy;

  /* ================================================================== AMSI (Antimalware Scan Interface), much simplified */
  // Fictional malware names only: real attack-tool strings in site files could trip a visitor's real antivirus.
  var AMSI_SIGS = [/invoke-kestrelstealer/i, /invoke-fakeransom/i, /kc-lab-malware-sample/i];
  function amsiScan(session, text, source) {
    for (var i = 0; i < AMSI_SIGS.length; i++) {
      if (AMSI_SIGS[i].test(text)) {
        session.system.amsiBlocks = (session.system.amsiBlocks || []).concat([{ source: source || "script", match: AMSI_SIGS[i].source }]);
        throw err("This script contains malicious content and has been blocked by your antivirus software.", "ParserError", { errorId: "ScriptContainedMaliciousContent" });
      }
    }
  }
  lib.amsiScan = amsiScan;

  // Script block logging (event 4104). Windows always logs script blocks that look suspicious (at Warning level);
  // when the ScriptBlockLogging policy is on, it logs every block.
  var SUSPICIOUS = /downloadstring|downloadfile|invoke-expression|\biex\b|frombase64string|net\.webclient|-enc|reflection\.assembly|virtualalloc|invoke-webrequest.*\|\s*iex/i;
  function logScriptBlock(session, text) {
    var sys = session.system;
    if (!sys.events || !lib.reg) return;
    var key = lib.reg.find(sys, "HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows\\PowerShell\\ScriptBlockLogging");
    var on = key && key.values.some(function (v) { return lc(v.name) === "enablescriptblocklogging" && toNumber(v.value) === 1; });
    var sus = SUSPICIOUS.test(text);
    if (!on && !sus) return;
    sys.events.push({ LogName: "Microsoft-Windows-PowerShell/Operational", Id: 4104, time: sys.now + (sys.events.length % 50) * 1000, Level: sus ? 3 : 5, ProviderName: "Microsoft-Windows-PowerShell",
      Message: "Creating Scriptblock text (1 of 1):\n" + text + "\n\nScriptBlock ID: " + (1000 + sys.events.length).toString(16) + "-sim", Props: ["1", "1", text] });
  }
  lib.logScriptBlock = logScriptBlock;

  /* ================================================================== Running a .ps1 file */
  function requiresCheck(session, text, display, leaf) {
    var re = /^\s*#requires\s+(.+)$/gim, m;
    while ((m = re.exec(text))) {
      var rest = m[1];
      if (/-RunAsAdministrator/i.test(rest) && !session.elevated)
        throw err("The script '" + leaf + "' cannot be run because it contains a \"#requires\" statement for running as Administrator. The current PowerShell session is not running as Administrator. Start PowerShell by using the Run as Administrator option, and then try running the script again.", "PermissionDenied", { errorId: "ScriptRequiresElevation" });
      var mv = /-Version\s+([\d.]+)/i.exec(rest);
      if (mv && parseFloat(mv[1]) > 7.4) throw err("The script '" + leaf + "' cannot be run because it contained a \"#requires\" statement for PowerShell " + mv[1] + ". The version of PowerShell that is required by the script does not match the currently running version of PowerShell 7.4.6.", "ResourceUnavailable");
      var mm = /-Modules?\s+(.+)$/i.exec(rest);
      if (mm) {
        var missing = mm[1].split(",").map(function (x) { return x.trim().replace(/^['"]|['"]$/g, ""); }).filter(function (x) { return x && !moduleAvailable(session, x); });
        if (missing.length) throw err("The script '" + leaf + "' cannot be run because the following modules that are specified by the \"#requires\" statements of the script are missing: " + missing.join(", ") + ".", "ResourceUnavailable");
      }
    }
  }
  function parseOrThrow(text, display) {
    try { return E.parse(text); }
    catch (e) {
      if (e instanceof E.ParseError) throw err("ParserError: " + display + ":" + e.line + ": " + e.message, "ParserError");
      throw e;
    }
  }
  // Freeze argument values in the caller's scope before switching to the script's scope.
  function freezeArgs(args, ctx) {
    args.named.forEach(function (a) { if (a.next) a.next = { t: "const", v: E.evalExpr(a.next, ctx) }; });
    args.positional.forEach(function (q) { if (q.node) { q.value = E.evalExpr(q.node, ctx); delete q.node; } });
    return args;
  }
  function invocationInfo(display, leaf) {
    var mc = obj("System.Management.Automation.ExternalScriptInfo", { Name: leaf, Path: display, Source: display, CommandType: "ExternalScript", Definition: display });
    mc.toStringFn = function () { return leaf; };
    return obj("System.Management.Automation.InvocationInfo", { MyCommand: mc, ScriptName: display, InvocationName: display, PSScriptRoot: dirOf(display), PSCommandPath: display });
  }
  function dirOf(path) { var i = path.lastIndexOf("\\"); return i > 2 ? path.slice(0, i) : path.slice(0, 3); }
  function leafOf(path) { return path.split("\\").pop(); }

  function runPs1(ctx, path, args, input, dot, opts) {
    opts = opts || {};
    var session = ctx.session, sys = session.system;
    var n = fs.normPath(sys, path), f = fs.get(sys, path);
    if (!f) throw err("The term '" + toStr(path) + "' is not recognized as a name of a cmdlet, function, script file, or executable program.\nCheck the spelling of the name, or if a path was included, verify that the path is correct and try again.", "CommandNotFound");
    var display = n.display, leaf = leafOf(display);
    if (!opts.noPolicy) checkPolicy(session, f, display);
    var body = splitSig(f.content).body;
    amsiScan(session, body, display);
    requiresCheck(session, body, display, leaf);
    var ast = parseOrThrow(body, display);
    var stmts = ast.stmts, paramSt = stmts[0] && stmts[0].t === "param" ? stmts[0] : null;
    var rest = paramSt ? stmts.slice(1) : stmts;
    if (args) freezeArgs(args, ctx);
    var out = [];
    var prevRoot = ctx.scope.lookup("PSScriptRoot"), prevPath = ctx.scope.lookup("PSCommandPath");
    if (dot) {
      // Dot-sourcing: the script's variables and functions land in the caller's scope.
      ctx.scope.setLocal("PSScriptRoot", dirOf(display));
      ctx.scope.setLocal("PSCommandPath", display);
      var dctx = ctx.child(ctx.scope, { directOut: out });
      try { E.execBlock({ t: "block", stmts: rest }, dctx, out); }
      catch (e) { if (!(e instanceof E.ReturnSignal)) throw e; }
      finally {
        if (prevRoot) ctx.scope.setLocal("PSScriptRoot", prevRoot.value); else ctx.scope.vars.delete("psscriptroot");
        if (prevPath) ctx.scope.setLocal("PSCommandPath", prevPath.value); else ctx.scope.vars.delete("pscommandpath");
      }
      return out;
    }
    var params = paramSt ? paramSt.params.map(function (q) { return E.compileParam(q); }) : [];
    var fn = { name: leaf, params: params, text: body, script: true,
      def: { params: paramSt ? paramSt.params : [], binding: paramSt && paramSt.binding ? [] : null, begin: null, process: null, end: { t: "block", stmts: rest } },
      advanced: !!(paramSt && (paramSt.binding || params.some(function (q) { return q.isParameterAttr; }))) };
    var holder = new E.Scope(session.global);
    holder.setLocal("PSScriptRoot", dirOf(display));
    holder.setLocal("PSCommandPath", display);
    holder.setLocal("MyInvocation", invocationInfo(display, leaf));
    var before = new Map(session.functions);
    var prevScript = session.scriptScope;
    session.scriptScope = holder;
    var hctx = new E.Ctx(session, holder);
    hctx.line = ctx.line; hctx.directOut = out;
    var topFile = session.fileMode && !session.fileModeUsed;
    if (topFile) session.fileModeUsed = true;
    try {
      E.callFunction(fn, args || { named: [], positional: [], raw: [] }, hctx, input, null);
    } catch (e) {
      if (e instanceof E.ExitSignal) {
        session.global.setLocal("LASTEXITCODE", e.code);
        // pwsh -File: exit ends the process, but what the script already output still reaches the console.
        if (topFile) { E.flushOutput(session, out); throw e; }
      } else throw e;
    } finally {
      session.scriptScope = prevScript;
      // Functions a script defines disappear when it ends (unless it was dot-sourced).
      var restore = new Map();
      before.forEach(function (v, k) { restore.set(k, v); });
      session.functions.forEach(function (v, k) { if (!before.has(k) && v.module) restore.set(k, v); });
      session.functions = restore;
    }
    return out;
  }
  lib.runPs1 = runPs1;

  /* ================================================================== Native-style command lines */
  // Split a command line the way Windows programs do: spaces separate, double quotes group.
  function tokenize(line) {
    var out = [], cur = "", inQ = false, had = false;
    for (var i = 0; i < line.length; i++) {
      var c = line.charAt(i);
      if (c === "\"") { inQ = !inQ; had = true; continue; }
      if (!inQ && /\s/.test(c)) { if (cur || had) out.push(cur); cur = ""; had = false; continue; }
      cur += c;
    }
    if (cur || had) out.push(cur);
    return out;
  }
  lib.tokenize = tokenize;
  // PowerShell arguments passed to a native program become strings.
  function nativeArgv(cmd, ctx) {
    var out = [];
    (cmd.args || []).forEach(function (a) {
      if (a.t === "param") { out.push("-" + a.name + (a.value !== undefined ? ":" + toStr(E.evalExpr(a.value, ctx)) : "")); return; }
      if (a.t === "splat") return;
      var v = E.evalExpr(a, ctx);
      if (v instanceof ScriptBlock) { out.push(v.text); return; }
      if (Array.isArray(v)) v.forEach(function (x) { out.push(toStr(x)); });
      else out.push(toStr(v));
    });
    return out;
  }
  // "-Name value -Flag x" (strings) -> the shape bindArgs wants, so a script's param() block can bind them.
  function argsFromStrings(tokens) {
    var named = [], positional = [];
    for (var i = 0; i < tokens.length; i++) {
      var t = tokens[i];
      var m = /^-([A-Za-z_][\w]*)(?::(.*))?$/.exec(t);
      if (m) {
        if (m[2] !== undefined) { named.push({ name: m[1], value: literal(m[2]), explicit: true }); continue; }
        var nxt = i + 1 < tokens.length && !/^-[A-Za-z_]/.test(tokens[i + 1]) ? { t: "const", v: literal(tokens[i + 1]) } : null;
        named.push({ name: m[1], value: undefined, next: nxt, nextIndex: i + 1 });
        continue;
      }
      positional.push({ value: literal(t), index: i });
    }
    return { named: named, positional: positional, raw: [] };
  }
  function literal(s) { if (/^\$true$/i.test(s)) return true; if (/^\$false$/i.test(s)) return false; return s; }

  function childSession(ctx, opts) {
    var parent = ctx.session;
    var s = E.newSession({ env: Object.assign({}, parent.env), files: {}, stdin: [] });
    s.system = parent.system;
    s.processPolicy = opts.policy || "Undefined";
    s.elevated = !!opts.elevated;
    s.isChild = true;
    s.depth = (parent.depth || 0) + 1;
    s.maxSteps = Math.max(1000, parent.maxSteps - parent.steps);
    if (s.depth > 6) throw err("The program started too many nested PowerShell processes.", "InvalidOperation");
    s.interactionList = [];
    return s;
  }
  function finishChild(ctx, child, res, show) {
    ctx.session.steps += child.steps;
    var lines = [];
    child.parts.forEach(function (pt) {
      if (pt.cls === "err") { ctx.session.write(pt.text, "err"); return; }
      lines.push(pt.text);
    });
    while (lines.length && lines[lines.length - 1] === "") lines.pop();
    var code = res.exit == null ? 0 : res.exit;
    ctx.session.global.setLocal("LASTEXITCODE", code);
    return { lines: lines, code: code };
  }
  function runProfile(child) {
    var f = fs.get(child.system, PROFILE);
    if (!f) return;
    E.runScript(child, ". '" + PROFILE.replace(/'/g, "''") + "'");
  }
  var PWSH_OPTS = ["NoProfile", "NonInteractive", "NoLogo", "NoExit", "ExecutionPolicy", "WindowStyle", "File", "Command", "EncodedCommand", "Version", "WorkingDirectory", "InputFormat", "OutputFormat", "Sta", "Mta", "Help", "Login"];
  var PWSH_SHORT = { nop: "NoProfile", noni: "NonInteractive", ep: "ExecutionPolicy", ex: "ExecutionPolicy", w: "WindowStyle", f: "File", c: "Command", e: "EncodedCommand", ec: "EncodedCommand", enc: "EncodedCommand", v: "Version", wd: "WorkingDirectory", "?": "Help", h: "Help" };
  function pwshOpt(tok) {
    var m = /^[-\/]([A-Za-z?]+)$/.exec(tok);
    if (!m) return null;
    var k = lc(m[1]);
    if (PWSH_SHORT[k]) return PWSH_SHORT[k];
    var hits = PWSH_OPTS.filter(function (o) { return lc(o).indexOf(k) === 0; });
    return hits.length === 1 ? hits[0] : hits.length ? "ambiguous" : null;
  }
  function decodeUtf16(b64) {
    var bytes;
    try { bytes = E.lib.staticMethod("Convert", "FromBase64String", [b64], null); }
    catch (e) { throw err("Cannot process the command because the value specified with -EncodedCommand is not properly encoded. The value must be Base64 encoded.", "InvalidArgument"); }
    var s = "";
    for (var i = 0; i + 1 < bytes.length; i += 2) s += String.fromCharCode(bytes[i] | (bytes[i + 1] << 8));
    return s;
  }
  lib.decodeUtf16 = decodeUtf16;

  // Start a PowerShell process: pwsh.exe (PowerShell 7) or powershell.exe (Windows PowerShell 5.1).
  function launchPwsh(ctx, exe, argv, extra) {
    extra = extra || {};
    var isWinPS = /^powershell/i.test(exe);
    var o = { profile: true, policy: null, mode: null, target: null, rest: [] };
    for (var i = 0; i < argv.length; i++) {
      var opt = pwshOpt(argv[i]);
      if (!opt) {
        // The first plain argument: pwsh treats it as a script file, Windows PowerShell as a command.
        o.mode = isWinPS ? "command" : "file";
        if (o.mode === "file") { o.target = argv[i]; o.rest = argv.slice(i + 1); }
        else o.target = argv.slice(i).join(" ");
        break;
      }
      if (opt === "ambiguous") return { lines: [], code: 64, error: "Cannot process command line argument '" + argv[i] + "': it matches more than one option." };
      if (opt === "NoProfile") o.profile = false;
      else if (opt === "ExecutionPolicy") { o.policy = normPolicy(argv[++i]); }
      else if (opt === "WindowStyle") { o.window = argv[++i]; }
      else if (opt === "WorkingDirectory") { o.wd = argv[++i]; }
      else if (opt === "Version") {
        var ver = argv[++i];
        if (!isWinPS) return { lines: ["PowerShell 7.4.6"], code: 0 };
        if (/^2/.test(ver || "")) {
          if (ctx.session.system.features.MicrosoftWindowsPowerShellV2Root !== "Enabled") return { lines: [], code: 1, error: "Version v2.0 of Windows PowerShell cannot be started because the Windows PowerShell 2.0 Engine is not installed on this computer." };
          o.v2 = true;
        }
      }
      else if (opt === "File") { o.mode = "file"; o.target = argv[i + 1]; o.rest = argv.slice(i + 2); break; }
      else if (opt === "Command") { o.mode = "command"; o.target = argv.slice(i + 1).join(" "); break; }
      else if (opt === "EncodedCommand") { o.mode = "command"; o.encoded = true; o.target = decodeUtf16(argv[i + 1] || ""); break; }
      else if (opt === "Help") return { lines: ["Usage: " + exe + " [-File <filePath> [args]] [-Command { - | <script-block> [-args <arg-array>] | <string> [<CommandParameters>] }] [-ExecutionPolicy <ExecutionPolicy>] [-NoProfile] [-NoExit] [-WindowStyle <style>] [-EncodedCommand <Base64EncodedCommand>]"], code: 0 };
    }
    var child = childSession(ctx, { policy: o.policy, elevated: extra.elevated !== undefined ? extra.elevated : ctx.session.elevated });
    var sys = ctx.session.system, prevLoc = sys.loc;
    if (o.wd) sys.loc = fs.normPath(sys, o.wd).display;
    if (extra.cwd) sys.loc = extra.cwd;
    var res;
    try {
      if (o.profile) {
        try { runProfile(child); }
        catch (e) { if (!(e instanceof E.PSError)) throw e; child.write(e.message, "err"); }
      }
      if (o.v2) child.write("(Windows PowerShell 2.0 engine: no AMSI, no script block logging, no Constrained Language Mode. This is why attackers ask for -Version 2.)", "warn");
      if (o.mode === "file") {
        if (!o.target) return { lines: [], code: 64, error: "The argument for the -File parameter is missing." };
        var fpath = o.target;
        var f = fs.get(sys, fpath);
        if (!f) { sys.loc = prevLoc; return { lines: [], code: 64, error: "The argument '" + fpath + "' is not recognized as the name of a script file. Check the spelling of the name, or if a path was included, verify that the path is correct and try again." }; }
        if (!/\.ps1$/i.test(fpath)) { sys.loc = prevLoc; return { lines: [], code: 64, error: "Processing -File '" + fpath + "' failed because the file does not have a '.ps1' extension. Specify a valid PowerShell script file name, and then try again." }; }
        child.fileMode = true;
        child.__fileArgParsed = argsFromStrings(o.rest);
        child.global.setLocal("__sl_args", []);
        child.global.setLocal("__sl_file", fs.normPath(sys, fpath).display);
        res = E.runScript(child, "& $__sl_file @__sl_args");
      } else if (o.mode === "command") {
        if (!o.v2) amsiScanSafe(child, o.target);
        logScriptBlock(child, o.target);
        res = E.runScript(child, o.target);
        // -Command: the exit code is 1 when the last command failed (unless the code called exit itself).
        if (!res.exit && child.errors.length && !/exit/i.test(o.target)) res.exit = 1;
      } else {
        res = { exit: 0 };
        child.write("PowerShell 7.4.6 (an interactive window would open here; this lab can't type into it)", "host");
      }
    } finally { sys.loc = prevLoc; }
    return finishChild(ctx, child, res);
  }
  function amsiScanSafe(child, text) {
    try { amsiScan(child, text, "command line"); }
    catch (e) { child.write(e.message, "err"); throw e; }
  }
  lib.launchPwsh = launchPwsh;
  // @__sl_args splatting for -File: arguments come in as strings and bind to the script's param() block.
  var prevExternal = null;

  /* ================================================================== cmd.exe and .cmd / .bat files */
  function runCmdLines(ctx, lines, info) {
    var sys = ctx.session.system, out = [], code = 0, prevLoc = sys.loc;
    var env = ctx.session.env;
    function expand(s) {
      s = s.replace(/%~dp0/gi, info.dir + "\\").replace(/%~f0/gi, info.path).replace(/%~nx0/gi, leafOf(info.path)).replace(/%0/g, info.path);
      s = s.replace(/%\*/g, info.rawArgs.join(" "));
      s = s.replace(/%~(\d)/g, function (m0, d) { return (info.args[+d - 1] || "").replace(/^"|"$/g, ""); });
      s = s.replace(/%(\d)/g, function (m0, d) { return info.args[+d - 1] || ""; });
      s = s.replace(/%errorlevel%/gi, String(code)).replace(/%cd%/gi, sys.loc);
      s = s.replace(/%([A-Za-z_][\w]*)%/g, function (m0, k) { var key = Object.keys(env).filter(function (x) { return lc(x) === lc(k); })[0]; return key ? env[key] : m0; });
      return s;
    }
    try {
      for (var i = 0; i < lines.length; i++) {
        var raw = lines[i].trim();
        if (!raw || /^@?echo\s+(off|on)$/i.test(raw) || /^(rem\b|::)/i.test(raw) || /^@?(setlocal|endlocal)\b/i.test(raw) || /^title\b/i.test(raw)) continue;
        var line = expand(raw.replace(/^@/, ""));
        var m;
        if ((m = /^echo(?:\.|\s+)(.*)$/i.exec(line))) { out.push(m[1]); continue; }
        if (/^pause$/i.test(line)) { out.push("Press any key to continue . . ."); continue; }
        if ((m = /^cd\s+(?:\/d\s+)?(.+)$/i.exec(line))) { var tgt = m[1].replace(/^"|"$/g, ""); if (fs.isDir(sys, tgt) || /^[A-Za-z]:\\?$/.test(tgt)) sys.loc = fs.normPath(sys, tgt).display.replace(/\\$/, ""); else { ctx.session.write("The system cannot find the path specified.", "err"); code = 1; } continue; }
        if ((m = /^exit(?:\s+\/b)?(?:\s+(-?\d+))?\s*$/i.exec(line))) { code = m[1] ? +m[1] : code; break; }
        if ((m = /^set\s+([^=]+)=(.*)$/i.exec(line))) { env[m[1].trim()] = m[2]; continue; }
        var toks = tokenize(line);
        var r = runNative(ctx, toks[0], toks.slice(1), { fromCmd: true });
        out = out.concat(r.lines);
        code = r.code;
      }
    } finally { sys.loc = prevLoc; }
    return { lines: out, code: code };
  }
  function runCmdFile(ctx, path, argStrings) {
    var sys = ctx.session.system, n = fs.normPath(sys, path), f = fs.get(sys, path);
    var quoted = argStrings.map(function (a) { return /\s/.test(a) ? "\"" + a + "\"" : a; });
    return runCmdLines(ctx, fs.readLines(f.content), { path: n.display, dir: dirOf(n.display), args: quoted, rawArgs: quoted });
  }
  // Run something the way cmd.exe, Task Scheduler or a shortcut would: a program name and string arguments.
  function runNative(ctx, exe, argv, opts) {
    opts = opts || {};
    var sys = ctx.session.system, e = lc(leafOf(toStr(exe).replace(/\//g, "\\")));
    if (/^(pwsh|powershell)(\.exe)?$/.test(e)) {
      var r = launchPwsh(ctx, e, argv, opts);
      if (r.error) { ctx.session.write(r.error, "err"); ctx.session.global.setLocal("LASTEXITCODE", r.code); }
      return r;
    }
    if (/^cmd(\.exe)?$/.test(e)) {
      var k = argv.findIndex(function (a) { return /^\/[ck]$/i.test(a); });
      if (k < 0) return { lines: ["Microsoft Windows [Version 10.0.26100] (an interactive cmd window would open here)"], code: 0 };
      var rest = argv.slice(k + 1);
      if (rest.length && /\.(cmd|bat)$/i.test(rest[0]) && fs.get(sys, rest[0])) return runCmdFile(ctx, rest[0], rest.slice(1));
      return runCmdLines(ctx, [rest.map(function (a) { return /\s/.test(a) ? "\"" + a + "\"" : a; }).join(" ")], { path: "cmd.exe", dir: sys.loc, args: [], rawArgs: [] });
    }
    var f = fs.get(sys, exe);
    if (f && /\.(cmd|bat)$/i.test(exe)) return runCmdFile(ctx, exe, argv);
    if (f && /\.exe$/i.test(exe)) return runExe(ctx, exe, argv, opts);
    if (f && /\.ps1$/i.test(exe)) {
      // Windows doesn't run .ps1 files directly: from cmd.exe or a task, the file just opens in Notepad (or fails).
      if (opts.fromTask) return { lines: [], code: 2147942593 };
      return openInNotepad(ctx, fs.normPath(sys, exe).display);
    }
    if (/^(notepad|notepad\.exe)$/.test(e)) return openInNotepad(ctx, argv[0] || "");
    if (/^(sc|sc\.exe|defrag|defrag\.exe|kupdate\.exe)$/.test(e) || /^%windir%|^c:\\windows\\/i.test(exe)) return { lines: [], code: 0 };
    var msg = opts.fromCmd ? "'" + exe + "' is not recognized as an internal or external command,\noperable program or batch file." : "The system cannot find the file specified: " + exe;
    ctx.session.write(msg, "err");
    return { lines: [], code: opts.fromCmd ? 9009 : 2 };
  }
  lib.runNative = runNative;
  function openInNotepad(ctx, path) {
    ctx.session.write("(Notepad opens " + path + ". Double-clicking a .ps1 file edits it; it doesn't run it.)", "host");
    ctx.session.system.actions.push("Notepad " + path);
    return { lines: [], code: 0 };
  }

  /* ================================================================== ps2exe executables */
  var EXE_MARK = "MZ\u0090\u0000\u0003 This program cannot be run in DOS mode. [ps2exe]\n";
  function exePayload(content) {
    if (content.indexOf(EXE_MARK) !== 0) return null;
    var b64 = content.slice(EXE_MARK.length).trim();
    try {
      var bytes = lib.staticMethod("Convert", "FromBase64String", [b64], null);
      var json = new TextDecoder().decode(new Uint8Array(bytes));
      return JSON.parse(json);
    } catch (e) { return null; }
  }
  lib.exePayload = exePayload;
  lib.makeExe = function (meta) { return makeExe(meta); };
  function makeExe(meta) {
    var bytes = Array.prototype.slice.call(new TextEncoder().encode(JSON.stringify(meta)));
    return EXE_MARK + lib.staticMethod("Convert", "ToBase64String", [bytes], null) + "\n";
  }
  function runExe(ctx, path, argv, opts) {
    var sys = ctx.session.system, n = fs.normPath(sys, path), f = fs.get(sys, path);
    var meta = exePayload(f.content);
    if (!meta) { ctx.session.write("Program '" + leafOf(n.display) + "' failed to run: The specified executable is not a valid application for this OS platform.", "err"); return { lines: [], code: 1 }; }
    var ex = argv.filter(function (a) { return /^-extract:/i.test(a); })[0];
    if (ex) { fs.write(sys, ex.replace(/^-extract:/i, "").replace(/^"|"$/g, ""), meta.script); return { lines: [], code: 0 }; }
    if (argv.some(function (a) { return /^-(\?|help)$/i.test(a); })) return { lines: [leafOf(n.display) + " [-extract:<filename>] [-debug] [-wait] [-end] [<script parameters>]"], code: 0 };
    var elevated = ctx.session.elevated;
    if (meta.requireAdmin && !elevated) { uac(ctx, leafOf(n.display), meta.company || "Unknown publisher"); elevated = true; }
    var child = childSession(ctx, { policy: "Bypass", elevated: elevated });
    var tmp = "__ps2exe_" + leafOf(n.display) + ".ps1";
    // The embedded script runs from memory: execution policy doesn't apply to an .exe.
    child.fileMode = true;
    child.__fileArgParsed = argsFromStrings(argv);
    child.global.setLocal("__sl_args", []);
    var holderKey = "c:\\users\\dev\\appdata\\local\\temp\\" + lc(tmp);
    sys.files[holderKey] = { name: "C:\\Users\\dev\\AppData\\Local\\Temp\\" + tmp, content: meta.script, mtime: sys.now };
    child.global.setLocal("__sl_file", "C:\\Users\\dev\\AppData\\Local\\Temp\\" + tmp);
    var res;
    try { res = E.runScript(child, "& $__sl_file @__sl_args"); }
    finally { delete sys.files[holderKey]; }
    var r = finishChild(ctx, child, res);
    if (meta.noConsole) {
      // A -noConsole exe has no console: output appears in message boxes.
      r.lines.forEach(function (l) { if (l !== "") ctx.session.write("[message box] " + l, "host"); });
      r.lines = [];
    }
    return r;
  }

  /* ================================================================== Shortcuts (.lnk) */
  function readLnk(content) {
    if (!/^\[sudo-learn shortcut\]/.test(content)) return null;
    var o = {};
    content.split(/\r?\n/).forEach(function (l) { var m = /^(\w+)=(.*)$/.exec(l); if (m) o[m[1]] = m[2]; });
    return o;
  }
  function shortcutObj(sys, path) {
    var full = fs.normPath(sys, path).display;
    var existing = fs.get(sys, path), d = existing ? readLnk(existing.content) || {} : {};
    var o = obj("System.__ComObject#{f935dc23-1cf0-11d0-adb9-00c04fd58a0b}", { FullName: full, TargetPath: d.TargetPath || "", Arguments: d.Arguments || "", WorkingDirectory: d.WorkingDirectory || "",
      Description: d.Description || "", IconLocation: d.IconLocation || ",0", WindowStyle: +(d.WindowStyle || 1), Hotkey: d.Hotkey || "" });
    o.methods = {
      save: function () {
        var lines = ["[sudo-learn shortcut]"];
        ["TargetPath", "Arguments", "WorkingDirectory", "Description", "IconLocation", "WindowStyle", "Hotkey"].forEach(function (k) { lines.push(k + "=" + toStr(o.get(k))); });
        fs.write(sys, full, lines.join("\n") + "\n");
        return undefined;
      }
    };
    return o;
  }
  function wscriptShell(ctx) {
    var sys = ctx.session.system;
    var o = obj("System.__ComObject#{41904400-be18-11d3-a28b-00104bd35090}", {});
    o.methods = {
      createshortcut: function (args) {
        var pth = toStr(args[0]);
        if (!/\.(lnk|url)$/i.test(pth)) throw err("Exception calling \"CreateShortcut\" with \"1\" argument(s): \"The shortcut pathname must end with .lnk or .url.\"", "InvalidOperation");
        return shortcutObj(sys, pth);
      },
      specialfolders: function (args) { var k = lc(toStr(args[0])); return k === "desktop" ? HOME + "\\Desktop" : k === "startup" ? HOME + "\\AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs\\Startup" : k === "programs" ? HOME + "\\AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs" : HOME; },
      run: function (args) { var t = tokenize(toStr(args[0])); return runNative(ctx, t[0], t.slice(1), {}).code; }
    };
    return o;
  }
  // Double-click / Invoke-Item / Start-Process on a file: what Windows does for each kind.
  function openFile(ctx, path, argv, opts) {
    var sys = ctx.session.system, n = fs.normPath(sys, path), f = fs.get(sys, path);
    if (!f) throw err("This command cannot be run because \"" + toStr(path) + "\" could not be found.", "ObjectNotFound");
    if (/\.lnk$/i.test(n.display)) {
      var d = readLnk(f.content) || {};
      var cwd = d.WorkingDirectory ? fs.normPath(sys, d.WorkingDirectory).display : null;
      return runNative(ctx, d.TargetPath, tokenize(d.Arguments || ""), Object.assign({}, opts, { cwd: cwd }));
    }
    if (/\.ps1$/i.test(n.display) || /\.(txt|log|csv|json|psm1|psd1)$/i.test(n.display)) return openInNotepad(ctx, n.display);
    return runNative(ctx, n.display, argv || [], opts);
  }
  function uac(ctx, what, publisher) {
    ctx.session.system.uac.push(what);
    ctx.session.write("[User Account Control] Do you want to allow this app to make changes to your device?  " + what + " · " + publisher + "  →  Yes (simulated)", "warn");
  }

  /* ================================================================== Resolving commands that aren't cmdlets/functions */
  function pathEnvDirs(session) { return toStr(session.env.Path || session.env.PATH || "").split(";").filter(Boolean); }
  lib.external = function (target, ctx, cmd) {
    var session = ctx.session, sys = session.system;
    // An alias (Set-Alias dr Get-DiskReport) may point at a command that a module still has to load.
    var al = (session.aliases && session.aliases[lc(toStr(target))]) || lib.aliases[lc(toStr(target))];
    if (al) target = al;
    var t = toStr(target), low = lc(t), leaf = lc(leafOf(t.replace(/\//g, "\\")));
    var hasPath = /[\\\/]/.test(t) || /^[A-Za-z]:/.test(t);
    if (!hasPath && /^(pwsh|powershell|cmd)(\.exe)?$/.test(leaf)) {
      return function () { var r = runNative(ctx, t, nativeArgv(cmd, ctx), {}); return r.lines; };
    }
    if (hasPath) {
      var f = fs.get(sys, t);
      if (!f) return null;
      if (/\.ps1$/i.test(t)) return function (args, input, dot) { return runPs1(ctx, t, args, input, dot); };
      return function () { var r = runNative(ctx, t, nativeArgv(cmd, ctx), {}); return r.lines; };
    }
    // A bare name: look in the folders on $env:Path (never the current folder), then in modules on $env:PSModulePath.
    var dirs = pathEnvDirs(session);
    var exts = /\.\w+$/.test(t) ? [""] : [".ps1", ".exe", ".cmd", ".bat"];
    for (var i = 0; i < dirs.length; i++) for (var j = 0; j < exts.length; j++) {
      var cand = dirs[i].replace(/\\$/, "") + "\\" + t + exts[j];
      if (fs.get(sys, cand)) {
        var c2 = cand;
        if (/\.ps1$/i.test(c2)) return function (args, input, dot) { return runPs1(ctx, c2, args, input, dot); };
        return function () { var r = runNative(ctx, c2, nativeArgv(cmd, ctx), {}); return r.lines; };
      }
    }
    var mod = autoloadFor(session, t);
    if (mod) {
      importModule(ctx, mod, {});
      var found = E.findCommand(t, ctx);
      if (found && found.kind === "function") return function (args, input) { return E.callFunction(found.def, args, ctx, input, cmd); };
      if (found) return null;
    }
    // In the current folder? PowerShell won't run it without .\ but says so.
    var here = [""].concat(exts).map(function (x) { return t + x; }).filter(function (x) { return fs.get(sys, x) && /\.(ps1|exe|cmd|bat)$/i.test(x); })[0];
    if (here) {
      throw err("The term '" + t + "' is not recognized as a name of a cmdlet, function, script file, or executable program.\nCheck the spelling of the name, or if a path was included, verify that the path is correct and try again.\n\nSuggestion [3,General]: The command \"" + t + "\" was not found, but does exist in the current location. PowerShell does not load commands from the current location by default (see 'Get-Help about_Command_Precedence').\nIf you trust this command, run the following command instead:\n.\\" + here, "CommandNotFound", { command: t });
    }
    return null;
  };

  /* ================================================================== Modules */
  function moduleDirs(session) { return toStr(session.env.PSModulePath || "").split(";").filter(Boolean); }
  function moduleAvailable(session, name) {
    var k = lc(name);
    if (session.system.installed[k]) return true;
    return !!findModuleOnPath(session, name);
  }
  function findModuleOnPath(session, name) {
    var sys = session.system, dirs = moduleDirs(session);
    for (var i = 0; i < dirs.length; i++) {
      var base = dirs[i].replace(/\\$/, "") + "\\" + name;
      var hit = moduleFileIn(sys, base, name);
      if (hit) return hit;
    }
    return null;
  }
  function moduleFileIn(sys, base, name) {
    var c = [base + "\\" + name + ".psd1", base + "\\" + name + ".psm1"];
    for (var i = 0; i < c.length; i++) if (fs.get(sys, c[i])) return fs.normPath(sys, c[i]).display;
    // versioned folder: Modules\Name\1.0.0\Name.psd1
    var pre = fs.normPath(sys, base).key + "\\";
    var keys = Object.keys(sys.files).filter(function (k) { return k.indexOf(pre) === 0 && new RegExp("\\\\" + lc(name).replace(/[.\\]/g, "\\$&") + "\\.ps[dm]1$").test(k); }).sort();
    return keys.length ? fs.normPath(sys, sys.files[keys[keys.length - 1]].name).display : null;
  }
  function autoloadFor(session, cmdName) {
    var sys = session.system, dirs = moduleDirs(session), k = lc(cmdName);
    var files = Object.keys(sys.files).filter(function (key) { return /\.psm1$/.test(key) && dirs.some(function (d) { return key.indexOf(fs.normPath(sys, d).key + "\\") === 0; }); });
    for (var i = 0; i < files.length; i++) {
      var f = sys.files[files[i]];
      var exported = declaredExports(sys, f);
      if (exported.some(function (x) { return lc(x) === k || (x.indexOf("*") >= 0 && E.wildcardRe(x).test(cmdName)); })) return fs.normPath(sys, f.name).display;
    }
    return null;
  }
  // What a module says it exports, without running it: the manifest's FunctionsToExport or Export-ModuleMember, else all functions.
  function declaredExports(sys, f) {
    var text = f.content;
    var full = fs.normPath(sys, f.name).display;
    var psd1 = fs.get(sys, full.replace(/\.psm1$/i, ".psd1"));
    if (psd1) { var m1 = /FunctionsToExport\s*=\s*@?\(?([^)\n]*)/i.exec(psd1.content); if (m1) return m1[1].split(",").map(function (x) { return x.trim().replace(/^['"]|['"]$/g, ""); }).filter(Boolean); }
    var m = /Export-ModuleMember\s+(?:-Function\s+)?([^\n#]+)/i.exec(text);
    if (m) return m[1].replace(/\s-\w+.*$/, "").split(",").map(function (x) { return x.trim().replace(/^['"]|['"]$/g, ""); }).filter(Boolean);
    var out = [], re = /^\s*function\s+([\w-]+)/gim, mm;
    while ((mm = re.exec(text))) out.push(mm[1]);
    return out;
  }
  function readManifest(ctx, path) {
    var f = fs.get(ctx.session.system, path);
    var ast = parseOrThrow(f.content, path);
    var st = ast.stmts[0];
    var v = st ? E.unwrap(E.evalExpr(st.t === "pipeline" ? st.elems[0] : st, ctx)) : null;
    if (!(v instanceof PSHashtable)) throw err("The module manifest '" + path + "' could not be processed because it is not a valid PowerShell module manifest file.", "InvalidData");
    return v;
  }
  function importModule(ctx, path, opts) {
    var session = ctx.session, sys = session.system;
    var display = fs.normPath(sys, path).display;
    var name = leafOf(display).replace(/\.ps[dm]1$/i, "");
    session.modules = session.modules || {};
    if (session.modules[lc(name)] && !opts.force) return session.modules[lc(name)];
    var version = "0.0", manifestExports = null, root = display, type = "Script";
    if (/\.psd1$/i.test(display)) {
      var h = readManifest(ctx, display);
      version = toStr(h.get("ModuleVersion") || "1.0");
      var rm = h.get("RootModule") || h.get("ModuleToProcess");
      var fte = h.get("FunctionsToExport");
      if (fte !== undefined && fte !== null) manifestExports = enumerate(fte).map(toStr);
      if (!rm) throw err("The module manifest '" + display + "' has no RootModule.", "InvalidData");
      root = dirOf(display) + "\\" + toStr(rm);
      type = "Script";
    }
    var f = fs.get(sys, root);
    if (!f) throw err("The specified module '" + root + "' was not loaded because no valid module file was found in any module directory.", "ResourceUnavailable");
    checkPolicy(session, f, root);
    var body = splitSig(f.content).body;
    amsiScan(session, body, root);
    var ast = parseOrThrow(body, root);
    var before = new Map(session.functions);
    var holder = new E.Scope(session.global);
    holder.setLocal("PSScriptRoot", dirOf(root));
    var prevScript = session.scriptScope, prevLoading = session.loadingModule;
    var info = { name: name, path: display, version: version, type: /\.psd1$/i.test(display) ? "Manifest" : "Script", exports: null, functions: [] };
    session.loadingModule = info;
    session.scriptScope = holder;
    var mctx = new E.Ctx(session, holder);
    var out = [];
    try { E.execBlock({ t: "block", stmts: ast.stmts }, mctx, out); }
    finally { session.scriptScope = prevScript; session.loadingModule = prevLoading; }
    var defined = [];
    session.functions.forEach(function (v, k) { if (!before.has(k) || before.get(k) !== v) defined.push(v); });
    var allow = manifestExports || info.exports;
    defined.forEach(function (fn) {
      fn.module = name;
      fn.private = !!(allow && !allow.some(function (x) { return lc(x) === lc(fn.name) || (x.indexOf("*") >= 0 && E.wildcardRe(x).test(fn.name)); }));
    });
    info.functions = defined.filter(function (fn) { return !fn.private; }).map(function (fn) { return fn.name; });
    session.modules[lc(name)] = info;
    if (opts.verbose) info.functions.forEach(function (fn) { session.write("VERBOSE: Importing function '" + fn + "'.", "verbose"); });
    return info;
  }
  lib.importModule = importModule;
  function moduleObj(info) {
    var ec = info.functions.slice();
    var o = obj("System.Management.Automation.PSModuleInfo", { ModuleType: info.type, Version: info.version, PreRelease: "", Name: info.name, ExportedCommands: ec, Path: info.path, ExportedFunctions: ec });
    o.toStringFn = function () { return info.name; };
    return o;
  }
  lib.views["System.Management.Automation.PSModuleInfo"] = ["ModuleType", "Version", "PreRelease", "Name", { header: "ExportedCommands", get: function (o) { var l = o.get("ExportedCommands") || []; return "{" + l.join(", ") + "}"; } }];
  function galleryModuleInfo(k) { var g = GALLERY[k]; return { name: g.name, path: USER_MODULES + "\\" + g.name + "\\" + g.version + "\\" + g.name + ".psd1", version: g.version, type: "Script", functions: g.commands.slice() }; }

  C("Import-Module", CORE, [p("Name", 0), sw("Force"), sw("PassThru"), sw("Global"), sw("DisableNameChecking"), p("MinimumVersion"), p("RequiredVersion")], function (b, input, ctx) {
    var session = ctx.session, sys = session.system, out = [];
    names(b.name).forEach(function (nm) {
      var path = null;
      var hasPath = /[\\\/]/.test(nm) || /^[A-Za-z]:/.test(nm) || /\.ps[dm]1$/i.test(nm);
      if (hasPath) {
        if (fs.get(sys, nm)) path = nm;
        else if (fs.isDir(sys, nm)) path = moduleFileIn(sys, fs.normPath(sys, nm).display, leafOf(fs.normPath(sys, nm).display));
      } else {
        path = findModuleOnPath(session, nm);
        if (!path && sys.installed[lc(nm)]) { session.modules = session.modules || {}; var gi = galleryModuleInfo(lc(nm)); session.modules[lc(nm)] = gi; if (b.passthru) out.push(moduleObj(gi)); return; }
      }
      if (!path) throw err("The specified module '" + nm + "' was not loaded because no valid module file was found in any module directory.", "ResourceUnavailable", { errorId: "Modules_ModuleNotFound" });
      var info = importModule(ctx, path, { force: !!b.force, verbose: ctx.verbose });
      if (b.passthru) out.push(moduleObj(info));
    });
    return out;
  }, { synopsis: "Loads a module (a .psm1/.psd1 file, or a module folder on $env:PSModulePath) so its commands can be used.", examples: ["Import-Module .\\KestrelTools", "Import-Module KestrelTools -Force -Verbose"] });
  alias("ipmo", "Import-Module");
  C("Export-ModuleMember", CORE, [p("Function", 0), p("Alias"), p("Variable"), p("Cmdlet")], function (b, input, ctx) {
    var m = ctx.session.loadingModule;
    if (!m) throw err("The Export-ModuleMember cmdlet can only be called from inside a module.", "PermissionDenied");
    m.exports = (m.exports || []).concat(names(b.function));
    return [];
  }, { synopsis: "Inside a .psm1 file: lists the functions the module makes public. The rest stay private to the module." });
  C("Get-Module", CORE, [p("Name", 0), sw("ListAvailable"), sw("All")], function (b, input, ctx) {
    var session = ctx.session, sys = session.system, out = [];
    var want = b.name !== undefined ? names(b.name) : null;
    function ok(nm) { return !want || want.some(function (w) { return E.wildcardRe(w).test(nm); }); }
    if (b.listavailable) {
      Object.keys(sys.installed).forEach(function (k) { if (GALLERY[k] && ok(GALLERY[k].name)) out.push(moduleObj(galleryModuleInfo(k))); });
      var seen = {};
      moduleDirs(session).forEach(function (d) {
        var pre = fs.normPath(sys, d).key + "\\";
        Object.keys(sys.files).forEach(function (k) {
          if (k.indexOf(pre) !== 0 || !/\.ps[dm]1$/.test(k)) return;
          var nm = sys.files[k].name.slice(fs.normPath(sys, d).display.length + 1).split("\\")[0];
          if (seen[lc(nm)] || !ok(nm) || GALLERY[lc(nm)]) return;
          seen[lc(nm)] = true;
          var f = sys.files[k];
          out.push(moduleObj({ name: nm, path: f.name, version: "0.0", type: "Script", functions: declaredExports(sys, f) }));
        });
      });
      return out;
    }
    Object.keys(session.modules || {}).forEach(function (k) { var m = session.modules[k]; if (ok(m.name)) out.push(moduleObj(m)); });
    return out;
  }, { synopsis: "Lists loaded modules; -ListAvailable lists the ones on $env:PSModulePath." });
  C("Remove-Module", CORE, [p("Name", 0), sw("Force")], function (b, input, ctx) {
    var session = ctx.session;
    names(b.name).forEach(function (nm) {
      var k = lc(nm), m = (session.modules || {})[k];
      if (!m) { E.writeCmdletError(ctx, "No modules were removed. Verify that the specification of modules to remove is correct and those modules exist in the runspace.", "ResourceUnavailable", nm); return; }
      var keep = new Map();
      session.functions.forEach(function (v, key) { if (lc(v.module || "") !== k) keep.set(key, v); });
      session.functions = keep;
      delete session.modules[k];
    });
    return [];
  }, { synopsis: "Unloads a module." });
  alias("rmo", "Remove-Module");
  C("New-ModuleManifest", CORE, [p("Path", 0), p("RootModule"), p("ModuleVersion"), p("Author"), p("Description"), p("FunctionsToExport"), p("CompanyName"), p("PowerShellVersion")], function (b, input, ctx) {
    var guid = "6f1c2a3b-4d5e-4f60-8a1b-" + String(ctx.session.system.seed++).padStart(12, "0");
    function q(v) { return "'" + toStr(v).replace(/'/g, "''") + "'"; }
    var fte = b.functionstoexport !== undefined ? "@(" + names(b.functionstoexport).map(q).join(", ") + ")" : "'*'";
    var text = ["#", "# Module manifest for module '" + leafOf(toStr(b.path)).replace(/\.psd1$/i, "") + "'", "#", "", "@{", "",
      "RootModule = " + q(b.rootmodule || ""), "ModuleVersion = " + q(b.moduleversion || "0.0.1"), "GUID = " + q(guid), "Author = " + q(b.author || "dev"),
      "CompanyName = " + q(b.companyname || "Unknown"), "Description = " + q(b.description || ""), "PowerShellVersion = " + q(b.powershellversion || "7.0"),
      "FunctionsToExport = " + fte, "CmdletsToExport = @()", "VariablesToExport = @()", "AliasesToExport = @()", "", "}"].join("\n") + "\n";
    fs.write(ctx.session.system, toStr(b.path), text);
    return [];
  }, { synopsis: "Writes a module manifest (.psd1): the module's version, author and exported functions." });
  C("Install-Module", PSGET, [p("Name", 0), p("Scope"), sw("Force"), p("RequiredVersion"), p("Repository"), sw("AllowClobber"), sw("AcceptLicense")], function (b, input, ctx) {
    var session = ctx.session, sys = session.system;
    names(b.name).forEach(function (nm) {
      var k = lc(nm), g = GALLERY[k];
      if (!g) throw err("No match was found for the specified search criteria and module name '" + nm + "'. Try Get-PSRepository to see all available registered module repositories.", "ObjectNotFound", { errorId: "NoMatchFoundForCriteria" });
      var scope = b.scope !== undefined ? toStr(b.scope) : "CurrentUser";
      if (lc(scope) === "allusers" && !session.elevated) throw err("Administrator rights are required to install modules in '" + ALL_MODULES + "'. Log on to the computer with an account that has Administrator rights, and then try again, or install '" + USER_MODULES + "' by adding \"-Scope CurrentUser\" to your command. You can also try running the PowerShell session with elevated rights (Run as Administrator).", "InvalidArgument");
      if (!b.force) session.write("Untrusted repository\nYou are installing the modules from an untrusted repository. If you trust this repository, change its InstallationPolicy value by running the Set-PSRepository cmdlet. Are you sure you want to install the modules from 'PSGallery'?\n[Y] Yes  [A] Yes to All  [N] No  [L] No to All  [S] Suspend  [?] Help (default is \"N\"): Y  (simulated answer)", "host");
      sys.installed[k] = true;
      var dir = (lc(scope) === "allusers" ? ALL_MODULES : USER_MODULES) + "\\" + g.name + "\\" + g.version;
      fs.write(sys, dir + "\\" + g.name + ".psd1", "@{ ModuleVersion = '" + g.version + "'; Author = '" + g.author + "'; Description = '" + g.desc + "' }\n");
      sys.actions.push("Install-Module " + g.name);
    });
    return [];
  }, { synopsis: "Downloads a module from the PowerShell Gallery. Use -Scope CurrentUser if you're not an administrator.", examples: ["Install-Module -Name ps2exe -Scope CurrentUser"] });
  C("Find-Module", PSGET, [p("Name", 0)], function (b) {
    var want = b.name !== undefined ? names(b.name) : ["*"];
    return Object.keys(GALLERY).filter(function (k) { return want.some(function (w) { return E.wildcardRe(w).test(GALLERY[k].name); }); })
      .map(function (k) { return obj("Microsoft.PowerShell.Commands.PSRepositoryItemInfo", { Version: GALLERY[k].version, Name: GALLERY[k].name, Repository: "PSGallery", Description: GALLERY[k].desc }); });
  }, { synopsis: "Searches the PowerShell Gallery (simulated: a few well-known modules)." });
  lib.views["Microsoft.PowerShell.Commands.PSRepositoryItemInfo"] = ["Version", "Name", "Repository", "Description"];
  lib.requireModule = function (ctx, key, cmdName) {
    if (ctx.session.system.installed[key]) return;
    throw err("The term '" + cmdName + "' is not recognized as a name of a cmdlet, function, script file, or executable program.\nCheck the spelling of the name, or if a path was included, verify that the path is correct and try again.\n(It comes from the " + GALLERY[key].name + " module: Install-Module " + GALLERY[key].name + " -Scope CurrentUser)", "CommandNotFound", { command: cmdName });
  };

  /* ================================================================== Execution policy cmdlets */
  C("Get-ExecutionPolicy", SEC, [p("Scope", 0), sw("List")], function (b, input, ctx) {
    var l = policyList(ctx.session);
    if (b.list) return l.map(function (x) { return obj("System.Management.Automation.PSCustomObject", { Scope: x[0], ExecutionPolicy: x[1] }); });
    if (b.scope !== undefined) { var hit = l.filter(function (x) { return lc(x[0]) === lc(toStr(b.scope)); })[0]; if (!hit) throw err("Cannot bind parameter 'Scope'. Use MachinePolicy, UserPolicy, Process, CurrentUser or LocalMachine."); return [hit[1]]; }
    return [effectivePolicy(ctx.session)];
  }, { synopsis: "Shows the execution policy in effect (or every scope with -List)." });
  C("Set-ExecutionPolicy", SEC, [p("ExecutionPolicy", 0), p("Scope", 1), sw("Force")], function (b, input, ctx) {
    var session = ctx.session, sys = session.system;
    if (b.executionpolicy === undefined) throw err("Cannot process command because of one or more missing mandatory parameters: ExecutionPolicy.");
    var pol = normPolicy(b.executionpolicy);
    var scope = b.scope !== undefined ? toStr(b.scope) : "LocalMachine";
    var sk = ["MachinePolicy", "UserPolicy", "Process", "CurrentUser", "LocalMachine"].filter(function (x) { return lc(x) === lc(scope); })[0];
    if (!sk) throw err("Cannot bind parameter 'Scope'. Use Process, CurrentUser or LocalMachine.");
    if (sk === "MachinePolicy" || sk === "UserPolicy") throw err("Cannot set execution policy. Execution policies at the MachinePolicy or UserPolicy scopes must be set through Group Policy.", "InvalidOperation");
    if (sk === "LocalMachine" && !session.elevated) throw err("Access to the path 'C:\\Program Files\\PowerShell\\7\\powershell.config.json' is denied. To change the execution policy for the default (LocalMachine) scope, start PowerShell with the \"Run as administrator\" option. To change the execution policy for the current user, run \"Set-ExecutionPolicy -Scope CurrentUser\".", "PermissionDenied", { errorId: "UnauthorizedAccessException" });
    if (ctx.whatIf) { session.write("What if: Performing the operation \"Set-ExecutionPolicy\" on target \"" + pol + "\".", "whatif"); return []; }
    if (sk === "Process") session.processPolicy = pol; else sys.policy[sk] = pol;
    sys.actions.push("Set-ExecutionPolicy " + pol + " " + sk);
    var eff = effectivePolicy(session);
    if (eff !== pol && pol !== "Undefined") {
      E.writeCmdletError(ctx, "PowerShell updated your execution policy successfully, but the setting is overridden by a policy defined at a more specific scope. Due to the override, your shell will retain its current effective execution policy of " + eff + ". Type \"Get-ExecutionPolicy -List\" to view your execution policy settings. For more information please see \"Get-Help Set-ExecutionPolicy\".", "PermissionDenied");
    }
    return [];
  }, { synopsis: "Sets the execution policy for a scope: Process (this window), CurrentUser, or LocalMachine (needs admin).", examples: ["Set-ExecutionPolicy RemoteSigned -Scope CurrentUser", "Set-ExecutionPolicy Bypass -Scope Process"] });
  C("Unblock-File", UTIL, [p("Path", 0), p("LiteralPath")], function (b, input, ctx) {
    var sys = ctx.session.system;
    var paths = input && input.length ? input.map(function (x) { return toStr(x instanceof PSObject && x.has("FullName") ? x.get("FullName") : x); }) : names(b.path !== undefined ? b.path : b.literalpath);
    paths.forEach(function (pth) {
      var f = fs.get(sys, pth);
      if (!f) { fs.notFound(ctx, pth); return; }
      if (ctx.whatIf) { ctx.session.write("What if: Performing the operation \"Unblock-File\" on target \"" + fs.normPath(sys, pth).display + "\".", "whatif"); return; }
      delete f.zone; delete f.referrer;
      sys.actions.push("Unblock-File " + fs.normPath(sys, pth).display);
    });
    return [];
  }, { synopsis: "Removes the 'downloaded from the internet' mark (the Zone.Identifier stream) from a file." });
  // Alternate data streams: Get-Content -Stream Zone.Identifier, Get-Item -Stream *
  function zoneText(f) { return "[ZoneTransfer]\r\nZoneId=" + f.zone + (f.referrer ? "\r\nReferrerUrl=" + f.referrer + "\r\nHostUrl=" + f.referrer : ""); }
  (function () {
    var gc = lib.cmdlets["get-content"], gcRun = gc.run;
    gc.params = gc.params.concat([p("Stream")]);
    gc.run = function (b, input, ctx) {
      if (b.stream === undefined) return gcRun(b, input, ctx);
      var sys = ctx.session.system, out = [];
      names(b.path).forEach(function (pth) {
        var f = fs.get(sys, pth), st = toStr(b.stream);
        if (!f) { fs.notFound(ctx, pth); return; }
        if (lc(st) === ":$data" || st === "") { out = out.concat(gcRun({ path: pth, raw: b.raw }, null, ctx)); return; }
        if (lc(st) !== "zone.identifier" || !f.zone) { E.writeCmdletError(ctx, "Could not open the alternate data stream '" + st + "' of the file '" + fs.normPath(sys, pth).display + "'.", "ObjectNotFound", pth); return; }
        var lines = zoneText(f).split("\r\n");
        out = out.concat(b.raw ? [lines.join("\r\n")] : lines);
      });
      return out;
    };
    var gi = lib.cmdlets["get-item"], giRun = gi.run;
    gi.params = gi.params.concat([p("Stream")]);
    gi.run = function (b, input, ctx) {
      if (b.stream === undefined) return giRun(b, input, ctx);
      var sys = ctx.session.system, out = [];
      names(b.path).forEach(function (pth) {
        var f = fs.get(sys, pth);
        if (!f) { fs.notFound(ctx, pth); return; }
        var full = fs.normPath(sys, pth).display, st = toStr(b.stream);
        var streams = [[":$DATA", new TextEncoder().encode(f.content).length]];
        if (f.zone) streams.push(["Zone.Identifier", zoneText(f).length]);
        streams.forEach(function (s) { if (E.wildcardRe(st).test(s[0])) out.push(obj("System.Management.Automation.Internal.AlternateStreamData", { FileName: full, Stream: s[0], Length: s[1] })); });
      });
      return out;
    };
  })();
  lib.views["System.Management.Automation.Internal.AlternateStreamData"] = ["FileName", "Stream", "Length"];

  /* ================================================================== Certificates and Authenticode signing */
  function certObj(c) {
    var o = obj("System.Security.Cryptography.X509Certificates.X509Certificate2", { Thumbprint: c.Thumbprint, Subject: c.Subject, Issuer: c.Issuer, NotAfter: new PSDate(c.NotAfter), NotBefore: new PSDate(c.NotAfter - 2 * 365 * 86400000),
      HasPrivateKey: c.HasPrivateKey, FriendlyName: c.FriendlyName || "", EnhancedKeyUsageList: c.codeSigning ? ["Code Signing (1.3.6.1.5.5.7.3.3)"] : ["Secure Email (1.3.6.1.5.5.7.3.4)"], PSParentPath: "Microsoft.PowerShell.Security\\Certificate::" + c.store });
    o.cert = c;
    o.toStringFn = function () { return "[Subject]\n  " + c.Subject + "\n\n[Issuer]\n  " + c.Issuer + "\n\n[Thumbprint]\n  " + c.Thumbprint; };
    return o;
  }
  lib.views["System.Security.Cryptography.X509Certificates.X509Certificate2"] = ["Thumbprint", "Subject", { header: "EnhancedKeyUsageList", get: function (o) { return "{" + (o.get("EnhancedKeyUsageList") || []).join(", ") + "}"; } }];
  (function () {
    var gci = lib.cmdlets["get-childitem"], run = gci.run;
    gci.params = gci.params.concat([sw("CodeSigningCert")]);
    gci.run = function (b, input, ctx) {
      var pth = b.path !== undefined ? toStr(list(b.path)[0]) : null;
      if (!pth || !/^cert:/i.test(pth)) return run(b, input, ctx);
      var store = lc(pth.replace(/^cert:\\?/i, "").replace(/\\$/, ""));
      var sys = ctx.session.system;
      if (store === "") return ["CurrentUser", "LocalMachine"].map(function (x) { return obj("Microsoft.PowerShell.Commands.X509StoreLocation", { Location: x }); });
      return sys.certs.filter(function (c) { return (c.store === store || (store.split("\\").length === 1 && c.store.indexOf(store + "\\") === 0) || b.recurse) && (!b.codesigningcert || c.codeSigning); }).map(certObj);
    };
  })();
  C("New-SelfSignedCertificate", "PKI", [p("Subject"), p("Type"), p("CertStoreLocation"), p("DnsName"), p("NotAfter")], function (b, input, ctx) {
    var sys = ctx.session.system;
    var subj = toStr(b.subject || ("CN=" + toStr(b.dnsname || "localhost")));
    var thumb = (lib.hash ? lib.hash.sha1(subj + sys.seed++) : "0").toUpperCase().slice(0, 40);
    var c = { Thumbprint: thumb, Subject: subj, Issuer: subj, NotAfter: sys.now + 365 * 86400000, codeSigning: /codesigning/i.test(toStr(b.type || "")), trusted: false, store: lc(toStr(b.certstorelocation || "Cert:\\CurrentUser\\My").replace(/^cert:\\/i, "")), HasPrivateKey: true, FriendlyName: "" };
    sys.certs.push(c);
    return [certObj(c)];
  }, { synopsis: "Creates a self-signed certificate (not trusted by anyone until you add it to the trusted stores)." });
  function signatureObj(sys, display, st, f) {
    var c = st.cert;
    var msg = st.status === "Valid" ? "Signature verified." : st.status === "NotSigned" ? "The file " + display + " is not digitally signed. You cannot run this script on the current system. For more information about running scripts and setting execution policy, see about_Execution_Policies at https://go.microsoft.com/fwlink/?LinkID=135170"
      : st.status === "HashMismatch" ? "The contents of file " + display + " might have been changed by an unauthorized user or process, because the hash of the file does not match the hash stored in the digital signature. The script cannot run on the specified system. For more information, run Get-Help about_Signing."
      : "A certificate chain processed, but terminated in a root certificate which is not trusted by the trust provider.";
    var o = obj("System.Management.Automation.Signature", { SignerCertificate: c ? certObj(c) : null, TimeStamperCertificate: null, Status: st.status, StatusMessage: msg, Path: display, SignatureType: st.status === "NotSigned" ? "None" : "Authenticode", IsOSBinary: false });
    return o;
  }
  lib.views["System.Management.Automation.Signature"] = [{ header: "SignerCertificate", get: function (o) { var c = o.get("SignerCertificate"); return c ? c.get("Thumbprint") : ""; } }, "Status", "StatusMessage", { header: "Path", get: function (o) { return leafOf(toStr(o.get("Path"))); } }];
  function pathsFrom(b, input, key) {
    if (input && input.length) return input.map(function (x) { return toStr(x instanceof PSObject && x.has("FullName") ? x.get("FullName") : x); });
    return names(b[key] !== undefined ? b[key] : b.path);
  }
  C("Set-AuthenticodeSignature", SEC, [p("FilePath", 0, { aliases: ["Path"] }), p("Certificate", 1), p("TimestampServer"), p("HashAlgorithm"), sw("Force")], function (b, input, ctx) {
    var sys = ctx.session.system, out = [];
    var c = b.certificate instanceof PSObject ? b.certificate.cert : null;
    if (!c) throw err("Cannot bind parameter 'Certificate'. Pass a certificate object, e.g. (Get-ChildItem Cert:\\CurrentUser\\My -CodeSigningCert)[0].");
    if (!c.codeSigning) throw err("Cannot sign code. The specified certificate is not suitable for code signing.", "InvalidArgument");
    pathsFrom(b, input, "filepath").forEach(function (pth) {
      var f = fs.get(sys, pth), display = fs.normPath(sys, pth).display;
      if (!f) { fs.notFound(ctx, pth); return; }
      if (ctx.whatIf) { ctx.session.write("What if: Performing the operation \"Set-AuthenticodeSignature\" on target \"" + display + "\".", "whatif"); return; }
      var body = splitSig(f.content).body.replace(/\s+$/, "");
      var h = sha256hex(body);
      var pad = "MIIbtwYJKoZIhvcNAQcCoIIbqDCCG6QCAQExDzANBglghkgBZQMEAgEFADB5Bgor";
      f.content = body + "\r\n\r\n" + SIG_START + "\r\n# " + pad + "\r\n# KSIG " + c.Thumbprint + " " + h + "\r\n# " + pad.split("").reverse().join("") + "\r\n# SIG # End signature block\r\n";
      f.mtime = sys.now;
      sys.actions.push("Sign " + display);
      out.push(signatureObj(sys, display, { status: "Valid", cert: c }, f));
    });
    return out;
  }, { synopsis: "Signs a script with a code-signing certificate (adds a signature block at the end of the file)." });
  C("Get-AuthenticodeSignature", SEC, [p("FilePath", 0, { aliases: ["Path"] })], function (b, input, ctx) {
    var sys = ctx.session.system, out = [];
    pathsFrom(b, input, "filepath").forEach(function (pth) {
      var f = fs.get(sys, pth), display = fs.normPath(sys, pth).display;
      if (!f) { fs.notFound(ctx, pth); return; }
      var ex = exePayload(f.content);
      if (ex) { out.push(signatureObj(sys, display, ex.signed ? { status: "Valid", cert: sys.certs[0] } : { status: "NotSigned" }, f)); return; }
      out.push(signatureObj(sys, display, sigStatus(sys, f.content), f));
    });
    return out;
  }, { synopsis: "Checks a file's digital signature: Valid, NotSigned, HashMismatch (changed after signing)..." });

  /* ================================================================== Invoke-Expression */
  C("Invoke-Expression", UTIL, [p("Command", 0)], function (b, input, ctx) {
    var text = b.command !== undefined ? toStr(b.command) : (input || []).map(toStr).join("\n");
    amsiScan(ctx.session, text, "Invoke-Expression");
    logScriptBlock(ctx.session, text);
    var ast = parseOrThrow(text, "Invoke-Expression");
    var out = [];
    E.execBlock({ t: "block", stmts: ast.stmts }, ctx.child(ctx.scope), out);
    return out;
  }, { synopsis: "Runs a string as PowerShell code. Dangerous with any text you didn't write yourself: attackers love it." });
  alias("iex", "Invoke-Expression");

  /* ================================================================== Start-Process, Invoke-Item, COM shortcuts */
  C("Start-Process", MGMT, [p("FilePath", 0), p("ArgumentList", 1, { aliases: ["Args"] }), p("Verb"), sw("Wait"), sw("PassThru"), p("WindowStyle"), sw("NoNewWindow"), p("WorkingDirectory"), p("RedirectStandardOutput"), p("Credential")], function (b, input, ctx) {
    var session = ctx.session, sys = session.system;
    var exe = toStr(b.filepath);
    var argv = b.argumentlist === undefined ? [] : Array.isArray(b.argumentlist) ? b.argumentlist.map(toStr) : tokenize(toStr(b.argumentlist));
    var elevated = session.elevated;
    if (b.verb !== undefined && lc(toStr(b.verb)) === "runas") {
      uac(ctx, leafOf(exe) + (argv.length ? " " + argv.join(" ") : ""), /pwsh|powershell/i.test(exe) ? "Verified publisher: Microsoft Corporation" : "Publisher: Unknown");
      elevated = true;
    }
    var cwd = b.workingdirectory !== undefined ? fs.normPath(sys, toStr(b.workingdirectory)).display : null;
    var opts = { elevated: elevated, cwd: cwd };
    var r;
    var isFileTarget = /[\\\/]/.test(exe) || /\.\w{2,4}$/.test(exe) && !/^(pwsh|powershell|cmd|notepad)\.exe$/i.test(exe);
    var before = session.parts.length;
    r = isFileTarget && fs.get(sys, exe) ? openFile(ctx, exe, argv, opts) : runNative(ctx, exe, argv, opts);
    var lines = r.lines;
    if (b.redirectstandardoutput !== undefined) fs.write(sys, toStr(b.redirectstandardoutput), lines.join("\n") + (lines.length ? "\n" : ""));
    else if (b.nonewwindow) lines.forEach(function (l) { session.write(l, ""); });
    else if (lines.length) {
      // The new process has its own console window.
      session.write("┌─ new window: " + leafOf(exe) + (elevated ? " (Administrator)" : "") + " " + "─".repeat(12), "host");
      lines.forEach(function (l) { session.write("│ " + l, "host"); });
      session.write("└" + "─".repeat(30), "host");
    }
    sys.actions.push("Start-Process " + leafOf(exe) + (elevated ? " (elevated)" : ""));
    if (b.passthru) {
      var pr = obj("System.Diagnostics.Process", { Id: 8000 + (sys.seed++ % 900), ProcessName: leafOf(exe).replace(/\.exe$/i, ""), HasExited: true, ExitCode: r.code, Handles: 0, NPM: 0, PM: 0, WS: 0, CPU: 0 });
      return [pr];
    }
    return [];
  }, { synopsis: "Starts a program or opens a file. -Verb RunAs runs it as administrator (UAC prompt); -Wait waits for it to finish.",
    examples: ["Start-Process pwsh -Verb RunAs -ArgumentList '-NoProfile', '-File', 'C:\\lab\\scripts\\Repair-Spooler.ps1'", "Start-Process notepad.exe"] });
  alias("start", "Start-Process"); alias("saps", "Start-Process");
  C("Invoke-Item", MGMT, [p("Path", 0)], function (b, input, ctx) {
    names(b.path).forEach(function (pth) { var r = openFile(ctx, pth, [], {}); r.lines.forEach(function (l) { ctx.session.write(l, ""); }); });
    return [];
  }, { synopsis: "Opens a file the way double-clicking it would." });
  alias("ii", "Invoke-Item");
  (function () {
    var no = lib.cmdlets["new-object"], run = no.run;
    no.params = no.params.concat([p("ComObject")]);
    no.run = function (b, input, ctx) {
      if (b.comobject === undefined) return run(b, input, ctx);
      var k = lc(toStr(b.comobject));
      if (k === "wscript.shell") return [wscriptShell(ctx)];
      throw err("Retrieving the COM class factory for component with CLSID {00000000-0000-0000-0000-000000000000} failed due to the following error: 80040154 Class not registered (" + toStr(b.comobject) + " isn't available in this lab).", "ResourceUnavailable");
    };
  })();

  /* ================================================================== Scheduled tasks */
  var TASK_T = "Microsoft.Management.Infrastructure.CimInstance#Root/Microsoft/Windows/TaskScheduler/MSFT_ScheduledTask";
  function parseAt(v, sys) {
    if (v instanceof PSDate) return v;
    var s = toStr(v).trim(), m = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i.exec(s);
    if (m) {
      var h = +m[1] % 24; if (m[3] && lc(m[3]) === "pm" && h < 12) h += 12; if (m[3] && lc(m[3]) === "am" && h === 12) h = 0;
      var d = new Date(sys.now); return new PSDate(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), h, +(m[2] || 0)));
    }
    return E.convertTo(v, "datetime");
  }
  function hhmm(pd) { var d = pd.d ? pd.d() : new Date(pd.ms); return ("0" + d.getUTCHours()).slice(-2) + ":" + ("0" + d.getUTCMinutes()).slice(-2); }
  function actionObj(a) { var o = obj("Microsoft.Management.Infrastructure.CimInstance#Root/Microsoft/Windows/TaskScheduler/MSFT_TaskExecAction", { Id: null, Arguments: a.Arguments, Execute: a.Execute, WorkingDirectory: a.WorkingDirectory }); o.raw = a; return o; }
  function triggerObj(t) {
    var o = obj("Microsoft.Management.Infrastructure.CimInstance#Root/Microsoft/Windows/TaskScheduler/MSFT_TaskTrigger", { Enabled: true, Kind: t.kind, At: t.at || null, StartBoundary: t.at ? "2026-11-10T" + t.at + ":00" : null, DaysInterval: t.kind === "Daily" ? 1 : null, DaysOfWeek: t.days || null, RepetitionInterval: t.repeat || null, UserId: t.user || null });
    o.raw = t; return o;
  }
  function principalObj(pr) { var o = obj("Microsoft.Management.Infrastructure.CimInstance#Root/Microsoft/Windows/TaskScheduler/MSFT_TaskPrincipal2", { UserId: pr.UserId, LogonType: pr.LogonType, RunLevel: pr.RunLevel }); o.raw = pr; return o; }
  function taskObj(t) {
    var o = obj(TASK_T, { TaskPath: t.TaskPath, TaskName: t.TaskName, State: t.State, Actions: t.Actions.map(actionObj), Triggers: t.Triggers.map(triggerObj), Principal: principalObj(t.Principal), Author: t.Author, Description: t.Description, URI: t.TaskPath + t.TaskName });
    o.task = t;
    return o;
  }
  lib.views[TASK_T] = ["TaskPath", "TaskName", "State"];
  lib.listTypes["Microsoft.Management.Infrastructure.CimInstance#Root/Microsoft/Windows/TaskScheduler/MSFT_TaskExecAction"] = true;
  lib.taskObj = taskObj;
  C("New-ScheduledTaskAction", TASKS, [p("Execute", 0), p("Argument", 1), p("WorkingDirectory", 2), p("Id")], function (b) {
    if (b.execute === undefined) throw err("Cannot process command because of one or more missing mandatory parameters: Execute.");
    return [actionObj({ Execute: toStr(b.execute), Arguments: b.argument !== undefined ? toStr(b.argument) : null, WorkingDirectory: b.workingdirectory !== undefined ? toStr(b.workingdirectory) : null })];
  }, { synopsis: "Describes what a scheduled task runs: a program (-Execute) and its arguments (-Argument)." });
  C("New-ScheduledTaskTrigger", TASKS, [sw("Daily"), sw("Weekly"), sw("Once"), sw("AtStartup"), sw("AtLogOn"), p("At"), p("DaysOfWeek"), p("DaysInterval"), p("RepetitionInterval"), p("User")], function (b, input, ctx) {
    var sys = ctx.session.system, t;
    if (b.atstartup) t = { kind: "AtStartup" };
    else if (b.atlogon) t = { kind: "AtLogOn", user: b.user !== undefined ? toStr(b.user) : null };
    else {
      if (b.at === undefined) throw err("The -At parameter is required for -Daily, -Weekly and -Once triggers.");
      t = { kind: b.daily ? "Daily" : b.weekly ? "Weekly" : b.once ? "Once" : "Once", at: hhmm(parseAt(b.at, sys)) };
      if (b.weekly) t.days = names(b.daysofweek);
      if (b.repetitioninterval !== undefined) t.repeat = toStr(b.repetitioninterval);
    }
    return [triggerObj(t)];
  }, { synopsis: "Describes when a scheduled task runs: -Daily -At 7am, -AtStartup, -AtLogOn..." });
  C("New-ScheduledTaskPrincipal", TASKS, [p("UserId", 0), p("LogonType"), p("RunLevel"), p("GroupId")], function (b) {
    var u = toStr(b.userid || b.groupid || "dev");
    return [principalObj({ UserId: u, LogonType: b.logontype !== undefined ? toStr(b.logontype) : (/^(system|nt authority\\system|localsystem)$/i.test(u) ? "ServiceAccount" : "Interactive"), RunLevel: b.runlevel !== undefined ? toStr(b.runlevel) : "Limited" })];
  }, { synopsis: "Describes which account a task runs as, and whether elevated (-RunLevel Highest)." });
  C("New-ScheduledTaskSettingsSet", TASKS, [p("ExecutionTimeLimit"), sw("StartWhenAvailable"), sw("Hidden"), sw("AllowStartIfOnBatteries"), sw("DontStopIfGoingOnBatteries"), p("RestartCount"), p("RestartInterval")], function (b) {
    return [obj("Microsoft.Management.Infrastructure.CimInstance#Root/Microsoft/Windows/TaskScheduler/MSFT_TaskSettings3", { StartWhenAvailable: !!b.startwhenavailable, Hidden: !!b.hidden, ExecutionTimeLimit: b.executiontimelimit !== undefined ? toStr(b.executiontimelimit) : "PT72H" })];
  }, { synopsis: "Extra task settings (time limit, run when missed...)." });
  function findTasks(sys, name, path) {
    return sys.tasks.filter(function (t) { return (name === undefined || names(name).some(function (n) { return E.wildcardRe(n).test(t.TaskName); })) && (path === undefined || E.wildcardRe(toStr(path)).test(t.TaskPath)); });
  }
  C("Register-ScheduledTask", TASKS, [p("TaskName", 0), p("TaskPath"), p("Action"), p("Trigger"), p("Principal"), p("Settings"), p("User"), p("Password"), p("RunLevel"), p("Description"), sw("Force"), p("InputObject")], function (b, input, ctx) {
    var session = ctx.session, sys = session.system;
    if (b.taskname === undefined) throw err("Cannot process command because of one or more missing mandatory parameters: TaskName.");
    if (b.action === undefined) throw err("Cannot process command because of one or more missing mandatory parameters: Action.");
    var tp = b.taskpath !== undefined ? toStr(b.taskpath) : "\\";
    if (!/^\\/.test(tp)) tp = "\\" + tp; if (!/\\$/.test(tp)) tp += "\\";
    var pr = b.principal instanceof PSObject && b.principal.raw ? Object.assign({}, b.principal.raw) : { UserId: b.user !== undefined ? toStr(b.user) : "dev", LogonType: b.password !== undefined ? "Password" : "Interactive", RunLevel: b.runlevel !== undefined ? toStr(b.runlevel) : "Limited" };
    var sysAcct = /^(system|nt authority\\system|localsystem|nt authority\\localservice|nt authority\\networkservice)$/i.test(pr.UserId);
    var otherUser = !sysAcct && !/^(kestrel\\)?dev$/i.test(pr.UserId);
    if ((sysAcct || lc(pr.RunLevel) === "highest" || otherUser) && !session.elevated) throw err("Access is denied.", "PermissionDenied", { errorId: "HRESULT 0x80070005" });
    var existing = findTasks(sys, toStr(b.taskname)).filter(function (t) { return lc(t.TaskPath) === lc(tp); })[0];
    if (existing && !b.force) throw err("Cannot create a file when that file already exists.", "ResourceExists", { errorId: "HRESULT 0x800700b7" });
    if (existing) sys.tasks.splice(sys.tasks.indexOf(existing), 1);
    var t = { TaskPath: tp, TaskName: toStr(b.taskname), State: "Ready", Actions: list(b.action).map(function (a) { return a.raw; }), Triggers: list(b.trigger).map(function (x) { return x.raw; }),
      Principal: pr, Author: "KESTREL\\dev", Description: b.description !== undefined ? toStr(b.description) : "", LastRunTime: null, LastTaskResult: 267011 };
    if (b.password !== undefined) t.storedPassword = true;
    sys.tasks.push(t);
    sys.actions.push("Register-ScheduledTask " + tp + t.TaskName);
    return [taskObj(t)];
  }, { synopsis: "Creates a scheduled task from an action, a trigger and (optionally) a principal." });
  C("Get-ScheduledTask", TASKS, [p("TaskName", 0), p("TaskPath")], function (b, input, ctx) {
    var hits = findTasks(ctx.session.system, b.taskname, b.taskpath);
    if (!hits.length && b.taskname !== undefined) {
      if (!/[*?]/.test(toStr(b.taskname))) E.writeCmdletError(ctx, "No MSFT_ScheduledTask objects found with property 'TaskName' equal to '" + toStr(b.taskname) + "'.  Verify the value of the property and retry.", "ObjectNotFound", toStr(b.taskname));
    }
    return hits.map(taskObj);
  }, { synopsis: "Lists scheduled tasks." });
  function taskArg(b, input) { if (input && input.length && input[0].task) return input.map(function (x) { return x.task; }); return null; }
  function runTask(ctx, t) {
    var sys = ctx.session.system, code = 0;
    t.Actions.forEach(function (a) {
      var exe = toStr(a.Execute).replace(/^"|"$/g, "");
      var cwd = a.WorkingDirectory ? fs.normPath(sys, a.WorkingDirectory).display : "C:\\Windows\\System32";
      var r;
      // A task runs with no console (output goes nowhere) and, unless told otherwise, in C:\Windows\System32.
      var before = ctx.session.parts.length;
      var asAdmin = /^(system|nt authority\\system)$/i.test(t.Principal.UserId) || lc(t.Principal.RunLevel) === "highest";
      if (/\.ps1$/i.test(exe)) r = { lines: [], code: 2147942593 };
      else {
        var prevLoc = sys.loc; sys.loc = cwd;
        try { r = runNative(ctx, exe, tokenize(a.Arguments || ""), { fromTask: true, elevated: asAdmin, cwd: cwd }); }
        finally { sys.loc = prevLoc; }
      }
      // errors from a task don't reach your console either
      ctx.session.parts.length = before;
      code = r.code;
    });
    t.LastRunTime = sys.now; t.LastTaskResult = code;
    return code;
  }
  lib.runTask = runTask;
  C("Start-ScheduledTask", TASKS, [p("TaskName", 0), p("TaskPath"), p("InputObject")], function (b, input, ctx) {
    var sys = ctx.session.system;
    var ts = taskArg(b, input) || findTasks(sys, b.taskname, b.taskpath);
    if (!ts.length) throw err("The system cannot find the file specified.", "ObjectNotFound");
    ts.forEach(function (t) { if (t.State === "Disabled") throw err("The task is disabled.", "InvalidOperation"); runTask(ctx, t); sys.actions.push("Start-ScheduledTask " + t.TaskName); });
    return [];
  }, { synopsis: "Runs a scheduled task now (to test it)." });
  C("Get-ScheduledTaskInfo", TASKS, [p("TaskName", 0), p("TaskPath"), p("InputObject")], function (b, input, ctx) {
    var sys = ctx.session.system;
    var ts = taskArg(b, input) || findTasks(sys, b.taskname, b.taskpath);
    if (!ts.length) throw err("The system cannot find the file specified.", "ObjectNotFound");
    return ts.map(function (t) {
      return obj("Microsoft.Management.Infrastructure.CimInstance#Root/Microsoft/Windows/TaskScheduler/MSFT_TaskDynamicInfo", { LastRunTime: t.LastRunTime ? new PSDate(t.LastRunTime) : null, LastTaskResult: t.LastTaskResult,
        NextRunTime: t.Triggers.length && t.Triggers[0].at ? new PSDate(Date.UTC(2026, 10, 11, +t.Triggers[0].at.slice(0, 2), +t.Triggers[0].at.slice(3))) : null, NumberOfMissedRuns: 0, TaskName: t.TaskName, TaskPath: t.TaskPath });
    });
  }, { synopsis: "Shows when a task last ran and its result (LastTaskResult 0 = success)." });
  lib.listTypes["Microsoft.Management.Infrastructure.CimInstance#Root/Microsoft/Windows/TaskScheduler/MSFT_TaskDynamicInfo"] = true;
  C("Unregister-ScheduledTask", TASKS, [p("TaskName", 0), p("TaskPath"), p("InputObject")], function (b, input, ctx) {
    var sys = ctx.session.system;
    var ts = taskArg(b, input) || findTasks(sys, b.taskname, b.taskpath);
    if (!ts.length) throw err("No MSFT_ScheduledTask objects found with property 'TaskName' equal to '" + toStr(b.taskname) + "'.", "ObjectNotFound");
    ts.forEach(function (t) {
      if (/^\\Microsoft\\/.test(t.TaskPath) && !ctx.session.elevated) throw err("Access is denied.", "PermissionDenied");
      if (ctx.whatIf) { ctx.session.write("What if: Performing the operation \"Unregister-ScheduledTask\" on target \"" + t.TaskPath + t.TaskName + "\".", "whatif"); return; }
      sys.tasks.splice(sys.tasks.indexOf(t), 1); sys.actions.push("Unregister-ScheduledTask " + t.TaskName);
    });
    return [];
  }, { synopsis: "Deletes a scheduled task." });
  ["Disable", "Enable"].forEach(function (verb) {
    C(verb + "-ScheduledTask", TASKS, [p("TaskName", 0), p("TaskPath"), p("InputObject")], function (b, input, ctx) {
      var sys = ctx.session.system;
      var ts = taskArg(b, input) || findTasks(sys, b.taskname, b.taskpath);
      ts.forEach(function (t) { t.State = verb === "Disable" ? "Disabled" : "Ready"; sys.actions.push(verb + "-ScheduledTask " + t.TaskName); });
      return ts.map(taskObj);
    }, { synopsis: verb + "s a scheduled task." });
  });

  /* ================================================================== ps2exe */
  C("Invoke-ps2exe", "ps2exe", [p("inputFile", 0), p("outputFile", 1), sw("noConsole"), sw("requireAdmin"), p("title"), p("description"), p("company"), p("version"), p("iconFile"), sw("noOutput"), sw("noError"), sw("x64"), sw("STA")], function (b, input, ctx) {
    lib.requireModule(ctx, "ps2exe", "Invoke-ps2exe");
    var sys = ctx.session.system, session = ctx.session;
    var inp = toStr(b.inputfile), f = fs.get(sys, inp);
    session.write("PS2EXE-GUI v0.5.0.30 by Ingo Karstein, reworked and GUI support by Markus Scholtes (simulated)", "host");
    if (!f) throw err("Input file " + inp + " not found!", "ObjectNotFound");
    var inFull = fs.normPath(sys, inp).display;
    var outp = b.outputfile !== undefined ? toStr(b.outputfile) : inFull.replace(/\.ps1$/i, ".exe");
    session.write("Reading input file " + inFull, "host");
    session.write("Compiling file...", "host");
    var meta = { script: splitSig(f.content).body, noConsole: !!b.noconsole, requireAdmin: !!b.requireadmin, title: b.title !== undefined ? toStr(b.title) : "", version: b.version !== undefined ? toStr(b.version) : "0.0.0.0", company: b.company !== undefined ? toStr(b.company) : "" };
    fs.write(sys, outp, makeExe(meta));
    session.write("Output file " + fs.normPath(sys, outp).display + " written", "host");
    sys.actions.push("ps2exe " + leafOf(outp));
    return [];
  }, { synopsis: "Wraps a script in an .exe (module ps2exe). The script is stored inside, not compiled: anyone can extract it.", examples: ["Invoke-ps2exe .\\tool.ps1 .\\tool.exe", "Invoke-ps2exe .\\gui.ps1 .\\gui.exe -noConsole -title 'Kestrel tool'"] });
  alias("ps2exe", "Invoke-ps2exe");

  /* ================================================================== -File runs */
  // A child started with -File runs "& $__sl_file @__sl_args": the splat is replaced by the command line's
  // string arguments, parsed the way pwsh binds them to the script's param() block.
  var prevExt = lib.external;
  lib.external = function (target, ctx, cmd) {
    if (ctx.session.__fileArgParsed && cmd && cmd.args && cmd.args.length === 1 && cmd.args[0].t === "splat" && lc(cmd.args[0].v) === "__sl_args") {
      var parsed = ctx.session.__fileArgParsed;
      ctx.session.__fileArgParsed = null;
      return function (args, input) { return runPs1(ctx, target, parsed, input, false); };
    }
    return prevExt(target, ctx, cmd);
  };
})(typeof window !== "undefined" ? window : globalThis);
