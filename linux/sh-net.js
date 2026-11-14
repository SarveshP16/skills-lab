/* sudo learn — kc-web-01's network (Linux Module 2): interfaces, sockets, DNS, ping, HTTP (a real nginx config
   is parsed and served, the Kestrel app answers behind it), and SSH to the other servers of the pretend company
   (keys, known_hosts, ssh-copy-id, scp, rsync). Other machines are built on demand with the same engine. */
(function (root) {
  "use strict";
  var S = root.ShEngine, U = S.util, CMDS = S.CMDS, M2 = S.M2, NOW = S.NOW, DAY = S.DAY, ShError = S.ShError, ERR = S.ERRTEXT;
  var out = U.out, errl = U.errl, note = U.note, lines = U.lines, joinLines = U.joinLines, pad = U.pad, rpad = U.rpad, bytes = U.bytes, MON = U.MON, WDAY = U.WDAY;
  var rd = M2.rd, nodeAt = M2.nodeAt, putRoot = M2.putRoot, writeRoot = M2.writeRoot, mkdirRoot = M2.mkdirRoot, basename = M2.basename, hash = M2.hash, hashChars = M2.hashChars, jadd = M2.jadd, tod = M2.tod, ymd = M2.ymd, commaNum = M2.commaNum;
  S.POST_HOOKS = S.POST_HOOKS || [];

  /* ================================================================== hashes: sha256sum, md5sum */
  function utf8(s) { return Array.prototype.slice.call(new TextEncoder().encode(s)); }
  function sha256(str) {
    var K = [0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2];
    var H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    var m = utf8(str), l = m.length * 8;
    m.push(0x80); while (m.length % 64 !== 56) m.push(0);
    for (var i = 7; i >= 0; i--) m.push(i >= 4 ? 0 : (l >>> (i * 8)) & 255);
    var w = new Array(64);
    for (var off = 0; off < m.length; off += 64) {
      for (var t = 0; t < 16; t++) w[t] = (m[off + t * 4] << 24) | (m[off + t * 4 + 1] << 16) | (m[off + t * 4 + 2] << 8) | m[off + t * 4 + 3];
      for (t = 16; t < 64; t++) { var s0 = ((w[t - 15] >>> 7) | (w[t - 15] << 25)) ^ ((w[t - 15] >>> 18) | (w[t - 15] << 14)) ^ (w[t - 15] >>> 3), s1 = ((w[t - 2] >>> 17) | (w[t - 2] << 15)) ^ ((w[t - 2] >>> 19) | (w[t - 2] << 13)) ^ (w[t - 2] >>> 10); w[t] = (w[t - 16] + s0 + w[t - 7] + s1) | 0; }
      var a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
      for (t = 0; t < 64; t++) {
        var S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7)), ch = (e & f) ^ (~e & g), t1 = (h + S1 + ch + K[t] + w[t]) | 0;
        var S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10)), maj = (a & b) ^ (a & c) ^ (b & c), t2 = (S0 + maj) | 0;
        h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
      }
      H = [(H[0] + a) | 0, (H[1] + b) | 0, (H[2] + c) | 0, (H[3] + d) | 0, (H[4] + e) | 0, (H[5] + f) | 0, (H[6] + g) | 0, (H[7] + h) | 0];
    }
    return H.map(function (x) { return ("00000000" + (x >>> 0).toString(16)).slice(-8); }).join("");
  }
  function md5(str) {
    var s = [7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21];
    var K = []; for (var i = 0; i < 64; i++) K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296) | 0;
    var m = utf8(str), l = m.length * 8;
    m.push(0x80); while (m.length % 64 !== 56) m.push(0);
    for (i = 0; i < 8; i++) m.push(i < 4 ? (l >>> (i * 8)) & 255 : 0);
    var a0 = 0x67452301, b0 = 0xefcdab89 | 0, c0 = 0x98badcfe | 0, d0 = 0x10325476;
    for (var off = 0; off < m.length; off += 64) {
      var M = []; for (var j = 0; j < 16; j++) M[j] = m[off + j * 4] | (m[off + j * 4 + 1] << 8) | (m[off + j * 4 + 2] << 16) | (m[off + j * 4 + 3] << 24);
      var A = a0, B = b0, C = c0, D = d0;
      for (i = 0; i < 64; i++) {
        var F, g;
        if (i < 16) { F = (B & C) | (~B & D); g = i; } else if (i < 32) { F = (D & B) | (~D & C); g = (5 * i + 1) % 16; } else if (i < 48) { F = B ^ C ^ D; g = (3 * i + 5) % 16; } else { F = C ^ (B | ~D); g = (7 * i) % 16; }
        F = (F + A + K[i] + M[g]) | 0; A = D; D = C; C = B; B = (B + ((F << s[i]) | (F >>> (32 - s[i])))) | 0;
      }
      a0 = (a0 + A) | 0; b0 = (b0 + B) | 0; c0 = (c0 + C) | 0; d0 = (d0 + D) | 0;
    }
    return [a0, b0, c0, d0].map(function (x) { var h = ""; for (var k = 0; k < 4; k++) h += ("0" + ((x >>> (k * 8)) & 255).toString(16)).slice(-2); return h; }).join("");
  }
  M2.sha256 = sha256; M2.md5 = md5;
  /* ---------------- diff, cmp */
  function lcsDiff(a, b) {
    var n = a.length, m = b.length, dp = [];
    for (var i = 0; i <= n; i++) { dp.push(new Array(m + 1).fill(0)); }
    for (i = n - 1; i >= 0; i--) for (var j = m - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    var ops = []; i = 0; j = 0;
    while (i < n || j < m) {
      if (i < n && j < m && a[i] === b[j]) { ops.push({ t: "=", a: i, b: j }); i++; j++; }
      else if (i < n && (j >= m || dp[i + 1][j] >= dp[i][j + 1])) { ops.push({ t: "-", a: i, b: j }); i++; }
      else { ops.push({ t: "+", a: i, b: j }); j++; }
    }
    return ops;
  }
  function hunks(ops) {
    var res = [], cur = null;
    ops.forEach(function (o) { if (o.t === "=") { if (cur) { res.push(cur); cur = null; } return; } if (!cur) cur = { del: [], add: [], a: o.a, b: o.b }; if (o.t === "-") cur.del.push(o.a); else cur.add.push(o.b); });
    if (cur) res.push(cur);
    return res;
  }
  function rng(s, c) { return c === 1 ? String(s + 1) : c === 0 ? String(s) : (s + 1) + "," + (s + c); }
  CMDS.diff = function (args, io, sess) {
    var a = args.slice(1), uni = false, brief = false, files = [];
    a.forEach(function (x) { if (x === "-u" || x === "--unified") uni = true; else if (x === "-q" || x === "--brief") brief = true; else if (/^-/.test(x)) return; else files.push(x); });
    if (files.length !== 2) { errl(io, "diff: " + (files.length < 2 ? "missing operand after '" + (files[0] || "diff") + "'" : "extra operand '" + files[2] + "'") + "\ndiff: Try 'diff --help' for more information."); return 2; }
    var t = files.map(function (f) { if (f === "-") return { c: io.stdin || "" }; var r = S.readFile(sess, f); if (r.error) { errl(io, "diff: " + f + ": " + ERR[r.error]); return null; } return { c: r.content, n: r.node }; });
    if (!t[0] || !t[1]) return 2;
    if (t[0].c === t[1].c) return 0;
    if (brief) { out(io, "Files " + files[0] + " and " + files[1] + " differ\n"); return 1; }
    var A = lines(t[0].c), Bl = lines(t[1].c), hs = hunks(lcsDiff(A, Bl));
    if (uni) {
      var stamp = function (n) { var d = new Date(n ? n.mtime : sess.sys.now); return ymd(d.getTime()) + " " + tod(d.getTime()) + ".000000000 +0000"; };
      out(io, "--- " + files[0] + "\t" + stamp(t[0].n) + "\n+++ " + files[1] + "\t" + stamp(t[1].n) + "\n");
      var ops = lcsDiff(A, Bl), k = 0;
      while (k < ops.length) {
        while (k < ops.length && ops[k].t === "=") k++;
        if (k >= ops.length) break;
        var st = Math.max(0, k - 3), en = k;
        while (en < ops.length) { if (ops[en].t !== "=") { en++; continue; } var run = 0; while (en + run < ops.length && ops[en + run].t === "=") run++; if (en + run >= ops.length || run > 6) { en = Math.min(ops.length, en + 3); break; } en += run; }
        var seg = ops.slice(st, en), aS = seg.filter(function (o) { return o.t !== "+"; }), bS = seg.filter(function (o) { return o.t !== "-"; });
        var a0 = aS.length ? aS[0].a + 1 : seg[0].a, b0 = bS.length ? bS[0].b + 1 : seg[0].b;
        out(io, "@@ -" + a0 + (aS.length !== 1 ? "," + aS.length : "") + " +" + b0 + (bS.length !== 1 ? "," + bS.length : "") + " @@\n" + seg.map(function (o) { return o.t === "=" ? " " + A[o.a] : o.t === "-" ? "-" + A[o.a] : "+" + Bl[o.b]; }).join("\n") + "\n");
        k = en;
      }
      return 1;
    }
    hs.forEach(function (h) {
      var kind = h.del.length && h.add.length ? "c" : h.del.length ? "d" : "a";
      var left = kind === "a" ? String(h.a) : rng(h.del[0], h.del.length), right = kind === "d" ? String(h.b) : rng(h.add[0], h.add.length);
      out(io, left + kind + right + "\n" + h.del.map(function (i) { return "< " + A[i] + "\n"; }).join("") + (kind === "c" ? "---\n" : "") + h.add.map(function (i) { return "> " + Bl[i] + "\n"; }).join(""));
    });
    return 1;
  };
  CMDS.cmp = function (args, io, sess) {
    var files = args.slice(1).filter(function (x) { return !/^-/.test(x); }), silent = args.indexOf("-s") >= 0;
    var t = files.map(function (f) { var r = S.readFile(sess, f); if (r.error) { errl(io, "cmp: " + f + ": " + ERR[r.error]); return null; } return r.content; });
    if (!t[0] && t[0] !== "" || !t[1] && t[1] !== "") return 2;
    if (t[0] === t[1]) return 0;
    for (var i = 0, line = 1; i < Math.max(t[0].length, t[1].length); i++) { if (t[0].charAt(i) !== t[1].charAt(i)) break; if (t[0].charAt(i) === "\n") line++; }
    if (!silent) { if (i >= t[0].length || i >= t[1].length) errl(io, "cmp: EOF on " + (i >= t[0].length ? files[0] : files[1]) + " after byte " + i + ", line " + line); else out(io, files[0] + " " + files[1] + " differ: byte " + (i + 1) + ", line " + line + "\n"); }
    return 1;
  };
  function contentKey(n) { return n.content + (n.size != null ? "\0size:" + n.size : ""); }
  function sumCmd(name, fn, width) {
    return function (args, io, sess) {
      var check = args.indexOf("-c") >= 0 || args.indexOf("--check") >= 0, files = args.slice(1).filter(function (x) { return !/^-/.test(x) || x === "-"; }), code = 0;
      if (check) {
        var bad = 0;
        U.eachInput(name, files, io, sess, function (text) {
          lines(text).forEach(function (l) {
            var m = new RegExp("^([0-9a-f]{" + width + "})\\s+\\*?(.+)$").exec(l); if (!m) return;
            var r = S.lookup(sess, m[2]);
            if (!r.node || r.node.type !== "f") { errl(io, name + ": " + m[2] + ": No such file or directory"); out(io, m[2] + ": FAILED open or read\n"); code = 1; return; }
            var ok = fn(contentKey(r.node)) === m[1]; if (!ok) bad++;
            out(io, m[2] + ": " + (ok ? "OK" : "FAILED") + "\n");
          });
        });
        if (bad) { errl(io, name + ": WARNING: " + bad + " computed checksum" + (bad > 1 ? "s" : "") + " did NOT match"); code = 1; }
        return code;
      }
      if (!files.length) files = ["-"];
      files.forEach(function (f) {
        if (f === "-") { out(io, fn(io.stdin || "") + "  -\n"); return; }
        var r = S.lookup(sess, f);
        if (!r.node) { errl(io, name + ": " + f + ": No such file or directory"); code = 1; return; }
        if (r.node.type === "d") { errl(io, name + ": " + f + ": Is a directory"); code = 1; return; }
        if (!S.can(sess, r.node, "r")) { errl(io, name + ": " + f + ": Permission denied"); code = 1; return; }
        out(io, fn(contentKey(r.node)) + "  " + f + "\n");
      });
      return code;
    };
  }
  CMDS.sha256sum = sumCmd("sha256sum", sha256, 64);
  CMDS.md5sum = sumCmd("md5sum", md5, 32);
  CMDS.openssl = function (args, io, sess) {
    var v = args[1];
    if (v === "version") { out(io, "OpenSSL 3.0.13 30 Jan 2024 (Library: OpenSSL 3.0.13 30 Jan 2024)\n"); return 0; }
    if (v === "rand") { var hex = args.indexOf("-hex") >= 0, b64 = args.indexOf("-base64") >= 0, n = +(args[args.length - 1]) || 16; sess.sys.randSeq = (sess.sys.randSeq || 0) + 1; out(io, (hex ? M2.hexOf("rand" + sess.sys.randSeq, n * 2) : hashChars("rand" + sess.sys.randSeq, Math.ceil(n * 4 / 3)) + (b64 && n % 3 ? "=".repeat(3 - n % 3) : "")) + "\n"); return 0; }
    if (v === "dgst" || v === "sha256") { var f = args[args.length - 1], r = S.readFile(sess, f); if (r.error) { errl(io, "Could not open file or uri for loading digest input file from " + f); return 1; } out(io, "SHA2-256(" + f + ")= " + sha256(contentKey(r.node)) + "\n"); return 0; }
    note(io, "(openssl is the TLS and crypto toolkit. The lab supports openssl version, openssl rand -hex N and openssl dgst -sha256 FILE; the security module goes further.)");
    return v ? 1 : 0;
  };

  /* ================================================================== the network */
  var SELF_IP = "10.20.0.15", PUBLIC_IP = "203.0.113.10", GW = "10.20.0.1";
  var DNS = {
    "kestrel.example.com": { A: ["203.0.113.10"], MX: ["10 mail.kestrel.example.com."], TXT: ["\"v=spf1 mx -all\""], NS: ["ns1.example-dns.net.", "ns2.example-dns.net."] },
    "www.kestrel.example.com": { CNAME: "kestrel.example.com." },
    "mail.kestrel.example.com": { A: ["203.0.113.25"] },
    "api.kestrel.example.com": { CNAME: "kestrel.example.com." },
    "example.com": { A: ["93.184.215.14"], AAAA: ["2606:2800:21f:cb07:6820:80da:af6b:8b2c"], MX: ["0 ."], NS: ["a.iana-servers.net.", "b.iana-servers.net."] },
    "www.example.com": { CNAME: "example.com." },
    "github.com": { A: ["140.82.121.4"] }, "api.github.com": { A: ["140.82.121.6"] },
    "archive.ubuntu.com": { A: ["185.125.190.36", "185.125.190.39"] }, "security.ubuntu.com": { A: ["185.125.190.39", "185.125.190.36"] },
    "ifconfig.me": { A: ["34.160.111.145"] }, "google.com": { A: ["142.250.185.78"] }, "dns.google": { A: ["8.8.8.8", "8.8.4.4"] }, "one.one.one.one": { A: ["1.1.1.1", "1.0.0.1"] },
    "kc-web-01.kestrel.internal": { A: ["10.20.0.15"], internal: true }, "kc-db-01.kestrel.internal": { A: ["10.20.0.21"], internal: true },
    "kc-backup-01.kestrel.internal": { A: ["10.20.0.31"], internal: true }, "gateway.kestrel.internal": { A: ["10.20.0.1"], internal: true }
  };
  var REVERSE = { "10.20.0.15": "kc-web-01.kestrel.internal", "10.20.0.21": "kc-db-01.kestrel.internal", "10.20.0.31": "kc-backup-01.kestrel.internal", "8.8.8.8": "dns.google", "1.1.1.1": "one.one.one.one", "203.0.113.10": "kestrel.example.com", "93.184.215.14": "example.com" };
  // other hosts on the network: what answers ping and which TCP ports are open
  var HOSTS = {
    "10.20.0.1": { ping: 0.35, ports: [] }, "10.20.0.2": { ping: 0.3, ports: [53] },
    "10.20.0.21": { ping: 0.42, ports: [22, 5432], machine: "kc-db-01" }, "10.20.0.31": { ping: 0.51, ports: [22], machine: "kc-backup-01" },
    "8.8.8.8": { ping: 11.8, ports: [53, 443] }, "8.8.4.4": { ping: 12.1, ports: [53, 443] }, "1.1.1.1": { ping: 9.6, ports: [53, 80, 443] }, "1.0.0.1": { ping: 9.7, ports: [53, 80, 443] },
    "93.184.215.14": { ping: 88.4, ports: [80, 443], site: "example" }, "140.82.121.4": { ping: 21.3, ports: [22, 80, 443], site: "github" }, "140.82.121.6": { ping: 21.5, ports: [443], site: "github-api" },
    "185.125.190.36": { ping: 17.9, ports: [80, 443], site: "ubuntu" }, "185.125.190.39": { ping: 18.2, ports: [80, 443], site: "ubuntu" },
    "34.160.111.145": { ping: 14.2, ports: [80, 443], site: "ifconfig" }, "142.250.185.78": { ping: 10.4, ports: [80, 443], site: "google" },
    "203.0.113.25": { ping: 3.1, ports: [25, 587] }, "203.0.113.10": { ping: 9.8, ports: [80, 443], site: "oldkestrel" }, "203.0.113.50": { ping: null, ports: [] }
  };
  M2.net = { DNS: DNS, HOSTS: HOSTS, SELF_IP: SELF_IP };
  function isIp(s) { return /^\d{1,3}(\.\d{1,3}){3}$/.test(s) || /^[0-9a-f:]+$/i.test(s) && s.indexOf(":") >= 0; }
  function hostsFile(sys) { var res = []; lines(rd(sys, "/etc/hosts") || "").forEach(function (l) { l = l.replace(/#.*/, "").trim(); if (!l) return; var f = l.split(/\s+/); f.slice(1).forEach(function (n) { res.push({ name: n.toLowerCase(), ip: f[0] }); }); }); return res; }
  function dnsLookup(sys, name, type, server) {
    name = String(name).toLowerCase().replace(/\.$/, "");
    var external = server && !/^127\.0\.0\.5[34]$/.test(server) && server !== "10.20.0.2";
    var zone = Object.assign({}, DNS, sys.dnsExtra || {});
    var chain = [], cur = name, guard = 0;
    while (guard++ < 8) {
      var rec = zone[cur];
      if (!rec || (rec.internal && external)) return { status: chain.length ? "NOERROR" : "NXDOMAIN", chain: chain, answers: [] };
      if (rec.CNAME && type !== "CNAME") { chain.push({ name: cur, type: "CNAME", data: rec.CNAME }); cur = rec.CNAME.replace(/\.$/, ""); continue; }
      var ans = (rec[type] || []).map(function (d) { return { name: cur, type: type, data: type === "CNAME" ? rec.CNAME : d }; });
      if (type === "CNAME" && rec.CNAME) ans = [{ name: cur, type: "CNAME", data: rec.CNAME }];
      return { status: "NOERROR", chain: chain, answers: ans };
    }
    return { status: "SERVFAIL", chain: chain, answers: [] };
  }
  // getaddrinfo: /etc/hosts first, then DNS (with the search domain)
  function resolve(sys, name) {
    if (!name) return null;
    var n = String(name).toLowerCase().replace(/\.$/, "");
    if (isIp(n)) return n;
    if (n === "localhost" || n === "ip6-localhost") return "127.0.0.1";
    var hf = hostsFile(sys).filter(function (h) { return h.name === n; })[0];
    if (hf) return hf.ip === "::1" ? "127.0.0.1" : hf.ip;
    var r = dnsLookup(sys, n, "A");
    if (r.answers.length) return r.answers[0].data;
    if (n.indexOf(".") < 0) { var r2 = dnsLookup(sys, n + ".kestrel.internal", "A"); if (r2.answers.length) return r2.answers[0].data; }
    return null;
  }
  M2.resolve = resolve; M2.dnsLookup = dnsLookup;
  function selfIps(sys) { return ["127.0.0.1", "127.0.1.1", "127.0.0.53", "127.0.0.54", sys.ip || SELF_IP]; }
  function isSelf(sys, ip) { return /^127\./.test(ip) || selfIps(sys).indexOf(ip) >= 0; }
  // machines: this one, or another one built on demand
  var MACHINES = {
    "kc-backup-01": { ip: "10.20.0.31", setup: function (m) {
      writeRoot(m, "/etc/passwd", "backup-svc:x:1004:1004:Backup service,,,:/home/backup-svc:/bin/bash\n", true);
      writeRoot(m, "/etc/group", "backup-svc:x:1004:\n", true);
      mkdirRoot(m, "/home/backup-svc", 488, 1004, 1004);
      putRoot(m, "/home/backup-svc/.bashrc", rd(m, "/home/dev/.bashrc"), 420, 1004, 1004);
      var b = mkdirRoot(m, "/srv/backups", 509, 1004, 1004);
      ["kc-web-01", "kc-db-01"].forEach(function (h) { mkdirRoot(m, "/srv/backups/" + h, 509, 1004, 1004); });
      putRoot(m, "/srv/backups/kc-db-01/kestrel-2026-11-10.sql.gz", "\x1f\x8b\x08\x00(dump)", 416, 1004, 1004, NOW - DAY + 3600000 * 2).size = 248113408;
      putRoot(m, "/srv/backups/README.txt", "Backups land here, one folder per server. Use the backup-svc account.\n", 420, 1004, 1004);
      m.knownPasswords = { "backup-svc": true };
    } },
    "kc-db-01": { ip: "10.20.0.21", setup: function (m) {
      var c = rd(m, "/etc/ssh/sshd_config").replace("PasswordAuthentication yes", "PasswordAuthentication no");
      putRoot(m, "/etc/ssh/sshd_config", c);
      writeRoot(m, "/etc/passwd", "postgres:x:114:120:PostgreSQL administrator,,,:/var/lib/postgresql:/bin/bash\n", true);
      writeRoot(m, "/etc/group", "postgres:x:120:\n", true);
      mkdirRoot(m, "/var/lib/postgresql", 493, 114, 120);
    } }
  };
  function machineByIp(sys, ip) {
    if (isSelf(sys, ip)) return sys;
    var net = sys.net;
    if (net.byIp[ip]) return net.byIp[ip];
    var info = HOSTS[ip];
    if (!info || !info.machine) return null;
    var spec = MACHINES[info.machine];
    var m = S.makeSystem({ host: info.machine, system: function (ms) {
      ms.ip = spec.ip; ms.net = net; ms.topSession = sys.topSession; ms.now = sys.now;
      putRoot(ms, "/etc/hostname", info.machine + "\n");
      putRoot(ms, "/etc/hosts", "127.0.0.1 localhost\n127.0.1.1 " + info.machine + "\n" + spec.ip + " " + info.machine + ".kestrel.internal " + info.machine + "\n10.20.0.15 kc-web-01.kestrel.internal kc-web-01\n\n# The following lines are desirable for IPv6 capable hosts\n::1     ip6-localhost ip6-loopback\n");
      spec.setup(ms);
      var hook = (sys.remoteSetup || {})[info.machine]; if (hook) hook(ms);
    } });
    net.byIp[ip] = m;
    return m;
  }
  M2.machine = function (sys, host) { var ip = resolve(sys, host) || host; return machineByIp(sys, ip); };
  function reach(sys, ip) {
    if (isSelf(sys, ip)) return { self: true, rtt: 0.035 };
    var h = HOSTS[ip];
    if (h) return h.ping == null ? { drop: true } : { rtt: h.ping, ports: h.ports, info: h };
    if (/^10\.20\.0\./.test(ip)) return { unreach: true };
    return { drop: true };
  }
  function tcpConnect(sys, ip, port) {
    if (isSelf(sys, ip)) {
      var tip = ip;
      var l = M2.listeners(sys).filter(function (x) {
        if (x.sock.proto !== "tcp" || x.sock.port !== port) return false;
        var a = x.sock.addr;
        if (a === "0.0.0.0" || a === "*" || a === "[::]") return true;
        if (/^127\./.test(tip)) return a === tip || (a === "127.0.0.1" && tip === "127.0.0.1");
        return a === tip;
      });
      if (!l.length) return { refused: true };
      var main = l.filter(function (x) { return x.proc.main; })[0] || l[0];
      return { self: true, proc: main.proc, listener: main };
    }
    var r = reach(sys, ip);
    if (r.unreach || r.drop) return { timeout: true };
    var m = machineByIp(sys, ip);
    if (m) return tcpConnect(m, "127.0.0.1", port).refused ? { refused: true } : { remote: m, port: port };
    return r.ports.indexOf(port) >= 0 ? { open: true, info: r.info } : { refused: true };
  }
  M2.tcpConnect = tcpConnect;

  /* ---------------- ip, hostname, ss, netstat, ifconfig */
  function myIp(sys) { return sys.ip || SELF_IP; }
  function mac(sys) { var h = M2.hexOf("mac" + sys.host, 6); return "52:54:00:" + h.slice(0, 2) + ":" + h.slice(2, 4) + ":" + h.slice(4, 6); }
  CMDS.hostname = function (args, io, sess) {
    var a = args[1];
    if (a === "-I" || a === "--all-ip-addresses") { out(io, myIp(sess.sys) + " \n"); return 0; }
    if (a === "-i" || a === "--ip-address") { out(io, "127.0.1.1\n"); return 0; }
    if (a === "-f" || a === "--fqdn" || a === "--long") { out(io, sess.sys.host + ".kestrel.internal\n"); return 0; }
    if (a === "-d" || a === "--domain") { out(io, "kestrel.internal\n"); return 0; }
    if (a && a.charAt(0) !== "-") { if (sess.uid !== 0) { errl(io, "hostname: you must be root to change the host name"); return 1; } sess.sys.host = a; return 0; }
    out(io, sess.sys.host + "\n"); return 0;
  };
  CMDS.ip = function (args, io, sess) {
    var sys = sess.sys, a = args.slice(1), brief = false, fam = null;
    while (a.length && /^-/.test(a[0])) { var f = a.shift(); if (f === "-br" || f === "-brief" || f === "--brief") brief = true; else if (f === "-4") fam = 4; else if (f === "-6") fam = 6; else if (f === "-c" || f === "-color" || f === "--color" || f === "-s") continue; else if (f === "-j" || f === "-json") continue; else { errl(io, "Option \"" + f + "\" is unknown, try \"ip -help\"."); return 255; } }
    var obj = a.shift() || "", ip4 = myIp(sys), m = mac(sys), ll = "fe80::5054:ff:fe" + m.slice(9, 11) + ":" + m.slice(12, 14) + m.slice(15, 17);
    function is(prefixes) { return prefixes.some(function (p) { return obj === p || (obj.length && p.indexOf(obj) === 0 && obj.length >= 1); }); }
    if (!obj) { out(io, "Usage: ip [ OPTIONS ] OBJECT { COMMAND | help }\nwhere  OBJECT := { address | link | route | neigh | rule | netns | ... }\n       OPTIONS := { -4 | -6 | -s | -br[ief] | -c[olor] | ... }\n"); return 255; }
    if (is(["address", "addr", "a"])) {
      var dev = a[a.indexOf("dev") + 1] || (a[0] === "show" && a[1] && a[1] !== "dev" ? a[1] : null);
      if (brief) { var bl = ["lo               UNKNOWN        127.0.0.1/8 " + (fam === 4 ? "" : "::1/128 "), "eth0             UP             " + ip4 + "/24 " + (fam === 4 ? "" : "metric 100 " + ll + "/64 ")]; out(io, joinLines(bl.filter(function (l, i) { return !dev || (dev === "lo" ? i === 0 : i === 1); }))); return 0; }
      var lo = "1: lo: <LOOPBACK,UP,LOWER_UP> mtu 65536 qdisc noqueue state UNKNOWN group default qlen 1000\n    link/loopback 00:00:00:00:00:00 brd 00:00:00:00:00:00\n    inet 127.0.0.1/8 scope host lo\n       valid_lft forever preferred_lft forever\n" + (fam === 4 ? "" : "    inet6 ::1/128 scope host noprefixroute \n       valid_lft forever preferred_lft forever\n");
      var eth = "2: eth0: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 qdisc fq_codel state UP group default qlen 1000\n    link/ether " + m + " brd ff:ff:ff:ff:ff:ff\n    altname enp0s3\n    inet " + ip4 + "/24 metric 100 brd 10.20.0.255 scope global dynamic eth0\n       valid_lft 85633sec preferred_lft 85633sec\n" + (fam === 4 ? "" : "    inet6 " + ll + "/64 scope link \n       valid_lft forever preferred_lft forever\n");
      if (fam === 4) { lo = lo.replace(/\n    link\/loopback[^\n]*/, ""); eth = eth.replace(/\n    link\/ether[^\n]*\n    altname[^\n]*/, ""); }
      if (dev && dev !== "lo" && dev !== "eth0") { errl(io, "Device \"" + dev + "\" does not exist."); return 1; }
      out(io, (!dev || dev === "lo" ? lo : "") + (!dev || dev === "eth0" ? eth : ""));
      return 0;
    }
    if (is(["route", "r", "ro"])) {
      if (a[0] === "get") { var dst = a[1], dip = resolve(sys, dst) || dst; out(io, (isSelf(sys, dip) ? "local " + dip + " dev lo table local src " + dip : dip + (/^10\.20\.0\./.test(dip) ? " dev eth0 src " + ip4 : " via " + GW + " dev eth0 src " + ip4)) + " uid " + sess.uid + " \n    cache \n"); return 0; }
      out(io, "default via " + GW + " dev eth0 proto dhcp src " + ip4 + " metric 100 \n10.20.0.0/24 dev eth0 proto kernel scope link src " + ip4 + " metric 100 \n" + GW + " dev eth0 proto dhcp scope link src " + ip4 + " metric 100 \n");
      return 0;
    }
    if (is(["link", "l"])) {
      if (brief) { out(io, "lo               UNKNOWN        00:00:00:00:00:00 <LOOPBACK,UP,LOWER_UP> \neth0             UP             " + m + " <BROADCAST,MULTICAST,UP,LOWER_UP> \n"); return 0; }
      out(io, "1: lo: <LOOPBACK,UP,LOWER_UP> mtu 65536 qdisc noqueue state UNKNOWN mode DEFAULT group default qlen 1000\n    link/loopback 00:00:00:00:00:00 brd 00:00:00:00:00:00\n2: eth0: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 qdisc fq_codel state UP mode DEFAULT group default qlen 1000\n    link/ether " + m + " brd ff:ff:ff:ff:ff:ff\n    altname enp0s3\n");
      return 0;
    }
    if (is(["neighbour", "neighbor", "neigh", "n"])) { out(io, GW + " dev eth0 lladdr 52:54:00:12:35:02 REACHABLE \n10.20.0.21 dev eth0 lladdr 52:54:00:9c:41:7e STALE \n"); return 0; }
    errl(io, "Object \"" + obj + "\" is unknown, try \"ip help\".");
    return 255;
  };
  var SVC = { 22: "ssh", 25: "smtp", 53: "domain", 80: "http", 443: "https", 5432: "postgresql", 6379: "redis", 8080: "http-alt", 3306: "mysql", 8000: "irdmi" };
  function socketRows(sys, sess, o) {
    var rows = [], groups = {};
    M2.listeners(sys).forEach(function (x) {
      var s = x.sock, key = s.proto + "|" + s.addr + "|" + s.port;
      if (!groups[key]) { groups[key] = { netid: s.proto, state: s.proto === "udp" ? "UNCONN" : "LISTEN", recvq: 0, sendq: s.proto === "udp" ? 0 : s.port === 80 ? 511 : s.port === 8080 ? 2048 : s.port === 53 ? 4096 : 128, local: s.addr === "*" ? "*" : s.addr, lport: s.port, peer: s.proto === "udp" || s.addr.charAt(0) !== "[" ? (s.addr === "*" ? "*" : "0.0.0.0") : "[::]", pport: "*", procs: [] }; rows.push(groups[key]); }
      groups[key].procs.push(x.proc);
    });
    if (sys.host === "kc-web-01" || true) {
      var sshd = M2.procByPid(sys, 2190);
      if (sshd) rows.push({ netid: "tcp", state: "ESTAB", recvq: 0, sendq: 0, local: myIp(sys), lport: 22, peer: "198.51.100.20", pport: 51544, procs: [sshd, M2.procByPid(sys, 2188)].filter(Boolean) });
    }
    (sys.extraSockets || []).forEach(function (r) { rows.push(r); });
    return rows.filter(function (r) {
      if (o.t || o.u) { if (r.netid === "tcp" && !o.t) return false; if (r.netid === "udp" && !o.u) return false; }
      if (o.l && !o.a && r.state !== "LISTEN" && r.state !== "UNCONN") return false;
      if (!o.l && !o.a && (r.state === "LISTEN" || r.state === "UNCONN")) return false;
      if (o.four && r.local.charAt(0) === "[") return false;
      if (o.six && r.local.charAt(0) !== "[" && r.local !== "*") return false;
      if (o.sport && r.lport !== o.sport) return false;
      if (o.dport && r.pport !== o.dport) return false;
      return true;
    }).sort(function (a, b) { return a.netid < b.netid ? 1 : a.netid > b.netid ? -1 : 0; });
  }
  CMDS.ss = function (args, io, sess) {
    var sys = sess.sys, o = {}, a = args.slice(1), filt = [];
    a.forEach(function (x) {
      if (/^-[a-zA-Z46]+$/.test(x)) x.slice(1).split("").forEach(function (c) { if (c === "4") o.four = true; else if (c === "6") o.six = true; else o[c] = true; });
      else if (x === "--tcp") o.t = true; else if (x === "--udp") o.u = true; else if (x === "--listening") o.l = true; else if (x === "--numeric") o.n = true; else if (x === "--processes") o.p = true; else if (x === "--all") o.a = true;
      else filt.push(x);
    });
    var fs = filt.join(" "), m = /sport\s*(?:=|==|eq)\s*:?(\w+)/.exec(fs), m2 = /dport\s*(?:=|==|eq)\s*:?(\w+)/.exec(fs);
    var num = function (v) { if (/^\d+$/.test(v)) return +v; for (var k in SVC) if (SVC[k] === v) return +k; return -1; };
    if (m) o.sport = num(m[1]); if (m2) o.dport = num(m2[1]);
    if (o.s) { out(io, "Total: 168\nTCP:   9 (estab 1, closed 1, orphaned 0, timewait 1)\n\nTransport Total     IP        IPv6\nRAW\t  1         0         1        \nUDP\t  3         3         0        \nTCP\t  8         7         1        \nINET\t  12        10        2        \nFRAG\t  0         0         0        \n\n"); return 0; }
    if (!o.t && !o.u && !o.x) o.t = o.u = true;
    var rows = socketRows(sys, sess, o);
    var port = function (p) { return p === "*" ? "*" : !o.n && SVC[p] ? SVC[p] : String(p); };
    var cells = rows.map(function (r) {
      var procs = "";
      if (o.p) { var vis = r.procs.filter(function (p) { return sess.uid === 0 || p.uid === sess.uid; }).sort(function (x, y) { return y.pid - x.pid; }); if (vis.length) procs = "users:(" + vis.map(function (p) { return "(\"" + p.comm + "\",pid=" + p.pid + ",fd=" + (p.comm === "sshd" ? 3 : 6) + ")"; }).join(",") + ")"; }
      return { netid: r.netid, state: r.state, rq: String(r.recvq), sq: String(r.sendq), la: r.local, lp: port(r.lport), pa: r.peer, pp: port(r.pport), proc: procs };
    });
    var showNet = o.t && o.u;
    var wla = Math.max.apply(null, [13].concat(cells.map(function (c) { return c.la.length; }))), wlp = Math.max.apply(null, [4].concat(cells.map(function (c) { return c.lp.length; })));
    var wpa = Math.max.apply(null, [12].concat(cells.map(function (c) { return c.pa.length; }))), wpp = Math.max.apply(null, [4].concat(cells.map(function (c) { return c.pp.length; })));
    var L = [(showNet ? "Netid " : "") + "State  Recv-Q Send-Q " + pad("Local Address", wla) + ":" + rpad("Port", wlp) + " " + pad("Peer Address", wpa) + ":" + rpad("Port", wpp) + (o.p ? "Process" : "")];
    cells.forEach(function (c) { L.push(((showNet ? rpad(c.netid, 5) + " " : "") + rpad(c.state, 6) + " " + rpad(c.rq, 6) + " " + rpad(c.sq, 6) + " " + pad(c.la, wla) + ":" + rpad(c.lp, wlp) + " " + pad(c.pa, wpa) + ":" + rpad(c.pp, wpp) + c.proc).replace(/\s+$/, "")); });
    out(io, joinLines(L));
    return 0;
  };
  CMDS.netstat = function (args, io, sess) {
    var o = {}; args.slice(1).forEach(function (x) { if (/^-/.test(x)) x.slice(1).split("").forEach(function (c) { o[c] = true; }); });
    if (o.r) { out(io, "Kernel IP routing table\nDestination     Gateway         Genmask         Flags   MSS Window  irtt Iface\n0.0.0.0         " + rpad(GW, 15) + " 0.0.0.0         UG        0 0          0 eth0\n10.20.0.0       0.0.0.0         255.255.255.0   U         0 0          0 eth0\n"); return 0; }
    if (!o.t && !o.u) o.t = o.u = true;
    var rows = socketRows(sess.sys, sess, o);
    var L = [o.l ? "Active Internet connections (only servers)" : o.a ? "Active Internet connections (servers and established)" : "Active Internet connections (w/o servers)", "Proto Recv-Q Send-Q Local Address           Foreign Address         State       " + (o.p ? "PID/Program name    " : "")];
    if (o.p && sess.uid !== 0) L.unshift("(Not all processes could be identified, non-owned process info\n will not be shown, you would have to be root to see it all.)");
    rows.forEach(function (r) {
      var la = (r.local === "*" ? "0.0.0.0" : r.local.replace(/^\[::\]$/, ":::").replace(/^\[(.*)\]$/, "$1")) + ":" + (o.n ? r.lport : SVC[r.lport] || r.lport);
      var pa = (r.peer.replace(/^\[::\]$/, ":::")) + ":" + r.pport;
      var main = r.procs.filter(function (p) { return p.main; })[0] || r.procs[0];
      var pp = o.p ? (main && (sess.uid === 0 || main.uid === sess.uid) ? main.pid + "/" + main.cmd.split(" ")[0].replace(/:$/, ":").slice(0, 14) : "-") : "";
      L.push(rpad(r.netid + (r.local.charAt(0) === "[" ? "6" : ""), 5) + " " + pad(r.recvq, 6) + " " + pad(0, 6) + " " + rpad(la, 23) + " " + rpad(pa, 23) + " " + rpad(r.state === "UNCONN" ? "" : r.state === "ESTAB" ? "ESTABLISHED" : r.state, 11) + " " + pp);
    });
    out(io, joinLines(L.map(function (l) { return l.replace(/\s+$/, ""); })));
    return 0;
  };
  CMDS.ifconfig = function (args, io, sess) {
    var ip4 = myIp(sess.sys), m = mac(sess.sys);
    out(io, "eth0: flags=4163<UP,BROADCAST,RUNNING,MULTICAST>  mtu 1500\n        inet " + ip4 + "  netmask 255.255.255.0  broadcast 10.20.0.255\n        ether " + m + "  txqueuelen 1000  (Ethernet)\n        RX packets 1824467  bytes 1402187733 (1.4 GB)\n        TX packets 1301122  bytes 912873221 (912.8 MB)\n\nlo: flags=73<UP,LOOPBACK,RUNNING>  mtu 65536\n        inet 127.0.0.1  netmask 255.0.0.0\n        loop  txqueuelen 1000  (Local Loopback)\n\n");
    return 0;
  };

  /* ---------------- ping, dig, host, nslookup, getent hosts, nc */
  CMDS.ping = function (args, io, sess) {
    var sys = sess.sys, a = args.slice(1), count = null, quiet = false, target = null;
    for (var i = 0; i < a.length; i++) { var x = a[i]; if (x === "-c") count = +a[++i]; else if (/^-c\d+$/.test(x)) count = +x.slice(2); else if (x === "-q") quiet = true; else if (x === "-i" || x === "-W" || x === "-w" || x === "-s" || x === "-t") i++; else if (x === "-4" || x === "-n" || x === "-6") continue; else if (/^-/.test(x)) { errl(io, "ping: invalid option -- '" + x.replace(/^-+/, "").charAt(0) + "'"); return 2; } else target = x; }
    if (!target) { errl(io, "ping: usage error: Destination address required"); return 1; }
    var ip = resolve(sys, target);
    if (!ip) { errl(io, "ping: " + target + ": " + (target.indexOf(".") < 0 || /\.internal$/.test(target) ? "Temporary failure in name resolution" : "Name or service not known")); return 2; }
    var n = count || 4, r = reach(sys, ip), shown = isIp(target) ? ip : target;
    var fqdn = isIp(target) ? (REVERSE[ip] || ip) : target;
    out(io, "PING " + target + " (" + ip + ") 56(84) bytes of data.\n");
    var times = [], ok = !r.drop && !r.unreach;
    for (var k = 1; k <= n; k++) {
      if (ok) { var t = r.rtt * (0.92 + (hash(ip + k) % 17) / 100); times.push(t); if (!quiet) out(io, "64 bytes from " + (isIp(target) ? ip : fqdn + " (" + ip + ")") + ": icmp_seq=" + k + " ttl=" + (r.self ? 64 : /^10\./.test(ip) ? 64 : 57) + " time=" + (t < 1 ? t.toFixed(3) : t.toFixed(1)) + " ms\n"); }
      else if (r.unreach && !quiet) out(io, "From " + myIp(sys) + " icmp_seq=" + k + " Destination Host Unreachable\n");
    }
    if (!count) out(io, "^C\n");
    out(io, "\n--- " + target + " ping statistics ---\n" + n + " packets transmitted, " + times.length + " received, " + (r.unreach ? "+" + n + " errors, " : "") + (ok ? "0" : "100") + "% packet loss, time " + (n - 1) * 1001 + "ms\n");
    if (ok) { var mn = Math.min.apply(null, times), mx = Math.max.apply(null, times), avg = times.reduce(function (s, v) { return s + v; }, 0) / times.length; out(io, "rtt min/avg/max/mdev = " + [mn, avg, mx, (mx - mn) / 3].map(function (v) { return v.toFixed(3); }).join("/") + " ms\n"); }
    if (!count) note(io, "(ping keeps going until you press Ctrl+C; the lab stopped it after 4. Use ping -c 4 to send a fixed number.)");
    return ok ? 0 : 1;
  };
  CMDS.dig = function (args, io, sess) {
    var sys = sess.sys, a = args.slice(1), short = false, server = "127.0.0.53", type = "A", name = null, rev = false;
    for (var i = 0; i < a.length; i++) { var x = a[i]; if (x === "+short") short = true; else if (x.charAt(0) === "+") continue; else if (x.charAt(0) === "@") server = x.slice(1); else if (x === "-x") { rev = true; name = a[++i]; } else if (x === "-t") type = a[++i].toUpperCase(); else if (/^(A|AAAA|MX|CNAME|TXT|NS|SOA|PTR|ANY)$/i.test(x) && name !== null) type = x.toUpperCase(); else if (name === null) name = x; else if (/^(A|AAAA|MX|CNAME|TXT|NS|SOA|PTR|ANY)$/i.test(x)) type = x.toUpperCase(); }
    if (name === null) name = ".";
    var ans = [], status = "NOERROR", qname = name;
    if (rev) { type = "PTR"; qname = name.split(".").reverse().join(".") + ".in-addr.arpa"; if (REVERSE[name]) ans = [{ name: qname, type: "PTR", data: REVERSE[name] + "." }]; else status = "NXDOMAIN"; }
    else { var r = dnsLookup(sys, name, type, server); status = r.status; ans = r.chain.concat(r.answers); }
    if (short) { out(io, joinLines(ans.map(function (x) { return x.data; }))); return 0; }
    var ttl = function (x) { return x.type === "CNAME" ? 300 : /internal/.test(x.name) ? 0 : x.type === "A" ? 300 : 3600; };
    var L = ["", "; <<>> DiG 9.18.28-0ubuntu0.24.04.1-Ubuntu <<>> " + a.join(" "), ";; global options: +cmd", ";; Got answer:", ";; ->>HEADER<<- opcode: QUERY, status: " + status + ", id: " + (hash(name + type) % 65536), ";; flags: qr rd ra; QUERY: 1, ANSWER: " + ans.length + ", AUTHORITY: " + (ans.length ? 0 : 1) + ", ADDITIONAL: 1", "", ";; OPT PSEUDOSECTION:", "; EDNS: version: 0, flags:; udp: 65494", ";; QUESTION SECTION:", ";" + qname.replace(/\.?$/, ".") + "\t\tIN\t" + type, ""];
    if (ans.length) { L.push(";; ANSWER SECTION:"); ans.forEach(function (x) { L.push(x.name.replace(/\.?$/, ".") + "\t" + ttl(x) + "\tIN\t" + x.type + "\t" + x.data); }); L.push(""); }
    else { L.push(";; AUTHORITY SECTION:"); L.push((name.split(".").slice(-2).join(".") || ".") + ".\t\t900\tIN\tSOA\tns1.example-dns.net. hostmaster.example-dns.net. 2026111101 7200 3600 1209600 900"); L.push(""); }
    L.push(";; Query time: " + (server === "127.0.0.53" ? 12 : 23) + " msec", ";; SERVER: " + server + "#53(" + server + ") (UDP)", ";; WHEN: " + WDAY[new Date(sys.now).getUTCDay()] + " " + MON[new Date(sys.now).getUTCMonth()] + " " + new Date(sys.now).getUTCDate() + " " + tod(sys.now) + " UTC 2026", ";; MSG SIZE  rcvd: " + (60 + ans.length * 16), "");
    out(io, joinLines(L));
    return 0;
  };
  CMDS.host = function (args, io, sess) {
    var a = args.slice(1).filter(function (x) { return !/^-/.test(x); }), type = (args[args.indexOf("-t") + 1] || "").toUpperCase(), name = a[0];
    if (!name) { errl(io, "Usage: host [-aCdilrTvVw] [-c class] [-N ndots] [-t type] [-W time]\n            [-R number] [-m flag] [-p port] hostname [server]"); return 1; }
    if (isIp(name)) { if (REVERSE[name]) { out(io, name.split(".").reverse().join(".") + ".in-addr.arpa domain name pointer " + REVERSE[name] + ".\n"); return 0; } out(io, "Host " + name.split(".").reverse().join(".") + ".in-addr.arpa. not found: 3(NXDOMAIN)\n"); return 1; }
    var types = type && args.indexOf("-t") >= 0 ? [type] : ["A", "AAAA", "MX"], any = false, L = [];
    types.forEach(function (t) {
      var r = dnsLookup(sess.sys, name, t, a[1]);
      if (r.status === "NXDOMAIN") return;
      r.chain.forEach(function (c) { if (L.indexOf(c.name + " is an alias for " + c.data) < 0) L.push(c.name + " is an alias for " + c.data); });
      r.answers.forEach(function (x) { any = true; L.push(x.name + (t === "A" ? " has address " : t === "AAAA" ? " has IPv6 address " : t === "MX" ? " mail is handled by " : t === "TXT" ? " descriptive text " : t === "NS" ? " name server " : " has " + t + " record ") + x.data); });
      if (r.chain.length) any = true;
    });
    if (!any) { out(io, "Host " + name + " not found: 3(NXDOMAIN)\n"); return 1; }
    out(io, joinLines(L)); return 0;
  };
  CMDS.nslookup = function (args, io, sess) {
    var a = args.slice(1).filter(function (x) { return !/^-/.test(x); }), name = a[0], server = a[1] || "127.0.0.53";
    if (!name) { note(io, "(nslookup without a name opens an interactive prompt. Pass a name: nslookup kestrel.example.com)"); return 0; }
    var r = dnsLookup(sess.sys, name, "A", a[1]);
    out(io, "Server:\t\t" + server + "\nAddress:\t" + server + "#53\n\n");
    if (r.status === "NXDOMAIN") { out(io, "** server can't find " + name + ": NXDOMAIN\n\n"); return 1; }
    out(io, (DNS[name.toLowerCase()] && DNS[name.toLowerCase()].internal ? "" : "Non-authoritative answer:\n") + r.chain.map(function (c) { return c.name + "\tcanonical name = " + c.data + "\n"; }).join("") + r.answers.map(function (x) { return "Name:\t" + x.name + "\nAddress: " + x.data + "\n"; }).join("") + "\n");
    return 0;
  };
  var getentOrig = CMDS.getent;
  CMDS.getent = function (args, io, sess) {
    if (args[1] !== "hosts" && args[1] !== "ahosts" && args[1] !== "ahostsv4") return getentOrig(args, io, sess);
    if (!args[2]) return getentOrig(["getent", "hosts"], io, sess);
    var code = 0;
    args.slice(2).forEach(function (n) {
      var ip = resolve(sess.sys, n);
      if (!ip) { code = 2; return; }
      if (args[1] === "hosts") out(io, rpad(ip, 15) + " " + n + "\n");
      else out(io, rpad(ip, 15) + " STREAM " + n + "\n" + rpad(ip, 15) + " DGRAM  \n" + rpad(ip, 15) + " RAW    \n");
    });
    return code;
  };
  CMDS.nc = function (args, io, sess) {
    var a = args.slice(1), z = false, v = false, rest = [];
    for (var i = 0; i < a.length; i++) { var x = a[i]; if (/^-[zvnu]+$/.test(x)) { if (x.indexOf("z") >= 0) z = true; if (x.indexOf("v") >= 0) v = true; } else if (x === "-w" || x === "-W") i++; else if (x === "-l") { note(io, "(nc -l listens for a connection and waits; the lab can't keep it open.)"); return 0; } else rest.push(x); }
    if (rest.length < 2) { errl(io, "usage: nc [-46CDdFhklNnrStUuvZz] [-I length] [-i interval] [-M ttl]\n\t  [-m minttl] [-O length] [-P proxy_username] [-p source_port]\n\t  [-q seconds] [-s sourceaddr] [-T keyword] [-V rtable] [-W recvlimit]\n\t  [-w timeout] [-X proxy_protocol] [-x proxy_address[:port]]\n\t  [destination] [port]"); return 1; }
    var host = rest[0], port = +rest[1], ip = resolve(sess.sys, host);
    if (!ip) { errl(io, "nc: getaddrinfo for host \"" + host + "\" port " + port + ": Temporary failure in name resolution"); return 1; }
    var c = tcpConnect(sess.sys, ip, port), svc = SVC[port] || "*";
    if (c.timeout) { if (v) errl(io, "nc: connect to " + host + " (" + ip + ") port " + port + " (tcp) timed out: Operation now in progress"); return 1; }
    if (c.refused) { if (v) errl(io, "nc: connect to " + host + " (" + ip + ") port " + port + " (tcp) failed: Connection refused"); return 1; }
    if (v) errl(io, "Connection to " + host + " (" + ip + ") " + port + " port [tcp/" + svc + "] succeeded!");
    if (!z && port === 22) out(io, "SSH-2.0-OpenSSH_9.6p1 Ubuntu-3ubuntu13.5\n");
    return 0;
  };

  /* ================================================================== nginx: config parser, -t, serving */
  var NGX_ARGS = { user: [1, 2], worker_processes: [1, 1], pid: [1, 1], error_log: [1, 2], include: [1, 1], worker_connections: [1, 1], multi_accept: [1, 1], sendfile: [1, 1], tcp_nopush: [1, 1], tcp_nodelay: [1, 1], types_hash_max_size: [1, 1], server_tokens: [1, 1], default_type: [1, 1], ssl_protocols: [1, 9], ssl_prefer_server_ciphers: [1, 1], ssl_ciphers: [1, 1], ssl_certificate: [1, 1], ssl_certificate_key: [1, 1], access_log: [1, 4], gzip: [1, 1], gzip_types: [1, 20], gzip_vary: [1, 1], gzip_proxied: [1, 9], gzip_comp_level: [1, 1], listen: [1, 9], server_name: [1, 20], root: [1, 1], alias: [1, 1], index: [1, 9], try_files: [2, 9], return: [1, 2], proxy_pass: [1, 1], proxy_set_header: [2, 2], proxy_http_version: [1, 1], proxy_read_timeout: [1, 1], add_header: [2, 3], autoindex: [1, 1], deny: [1, 1], allow: [1, 1], client_max_body_size: [1, 1], keepalive_timeout: [1, 2], charset: [1, 1], expires: [1, 2], rewrite: [2, 3], error_page: [2, 9], limit_req_zone: [3, 4], limit_req: [1, 3], types: [0, 0], events: [0, 0], http: [0, 0], server: [0, 0], location: [1, 2], if: [1, 9], fastcgi_pass: [1, 1], fastcgi_param: [2, 3], log_format: [2, 20], resolver: [1, 9], set: [2, 2], http2: [1, 1], ssl_session_cache: [1, 2], ssl_session_timeout: [1, 1], include_snippet: [1, 1], large_client_header_buffers: [2, 2], server_names_hash_bucket_size: [1, 1], open_file_cache: [1, 2], auth_basic: [1, 1], auth_basic_user_file: [1, 1], stub_status: [0, 1] };
  var NGX_BLOCK = { events: true, http: true, server: true, location: true, types: true, if: true, upstream: true, map: true };
  function ngxTokenize(text, file) {
    var toks = [], i = 0, line = 1;
    while (i < text.length) {
      var c = text.charAt(i);
      if (c === "\n") { line++; i++; continue; }
      if (/\s/.test(c)) { i++; continue; }
      if (c === "#") { while (i < text.length && text.charAt(i) !== "\n") i++; continue; }
      if (c === ";" || c === "{" || c === "}") { toks.push({ t: c, line: line, file: file }); i++; continue; }
      if (c === "\"" || c === "'") { var q = c, j = i + 1, s = ""; while (j < text.length && text.charAt(j) !== q) { if (text.charAt(j) === "\\" && j + 1 < text.length) { s += text.charAt(j + 1); j += 2; continue; } if (text.charAt(j) === "\n") line++; s += text.charAt(j); j++; } toks.push({ t: "w", v: s, line: line, file: file }); i = j + 1; continue; }
      var w = ""; while (i < text.length && !/[\s;{}#]/.test(text.charAt(i))) { w += text.charAt(i); i++; }
      toks.push({ t: "w", v: w, line: line, file: file });
    }
    return toks;
  }
  function NgxError(msg) { this.message = msg; }
  // parse file into directives; includes are expanded (relative paths are under /etc/nginx)
  function ngxParse(sys, path, ctx, depth) {
    var text = rd(sys, path);
    if (text === null) throw new NgxError("open() \"" + path + "\" failed (2: No such file or directory)");
    var toks = ngxTokenize(text, path), pos = 0;
    function block(parentName) {
      var items = [];
      while (pos < toks.length) {
        var tk = toks[pos];
        if (tk.t === "}") { if (!parentName) throw new NgxError("unexpected \"}\" in " + tk.file + ":" + tk.line); pos++; return items; }
        if (tk.t !== "w") throw new NgxError("unexpected \"" + tk.t + "\" in " + tk.file + ":" + tk.line);
        var name = tk.v, args = [], start = tk; pos++;
        while (pos < toks.length && toks[pos].t === "w") { args.push(toks[pos].v); pos++; }
        if (pos >= toks.length) throw new NgxError("unexpected end of file, expecting \";\" or \"}\" in " + start.file + ":" + (toks.length ? toks[toks.length - 1].line : start.line));
        var term = toks[pos];
        if ((parentName === "types" || parentName === "map" || parentName === "upstream") && term.t === ";") { pos++; items.push({ name: name, args: args, file: start.file, line: start.line }); continue; }
        var known = NGX_ARGS[name] || NGX_BLOCK[name];
        if (!known) throw new NgxError("unknown directive \"" + name + "\" in " + start.file + ":" + start.line);
        if (term.t === "{") {
          if (!NGX_BLOCK[name]) throw new NgxError("directive \"" + name + "\" has no opening \"{\" in " + start.file + ":" + start.line);
          pos++;
          var inner = block(name);
          items.push({ name: name, args: args, block: inner, file: start.file, line: start.line });
          continue;
        }
        if (term.t === ";") {
          pos++;
          if (NGX_BLOCK[name] && name !== "types") throw new NgxError("directive \"" + name + "\" has no opening \"{\" in " + start.file + ":" + start.line);
          var spec = NGX_ARGS[name];
          if (spec && (args.length < spec[0] || args.length > spec[1])) throw new NgxError("invalid number of arguments in \"" + name + "\" directive in " + start.file + ":" + start.line);
          if (name === "include") {
            var pat = args[0].charAt(0) === "/" ? args[0] : "/etc/nginx/" + args[0];
            if (/[*?[]/.test(pat)) {
              var dir = pat.slice(0, pat.lastIndexOf("/")), base = pat.slice(pat.lastIndexOf("/") + 1), dn = nodeAt(sys, dir);
              if (dn && dn.type === "d") Object.keys(dn.children).sort().forEach(function (k) { if (S.globMatch(base, k)) { var target = nodeAt(sys, dir + "/" + k); if (target && target.type === "f") { if (depth > 8) throw new NgxError("too many includes"); items = items.concat(ngxParse(sys, dir + "/" + k, name, depth + 1)); } else if (dn.children[k].type === "l" && !target) throw new NgxError("open() \"" + dir + "/" + k + "\" failed (2: No such file or directory) in " + start.file + ":" + start.line); } });
            } else {
              if (rd(sys, pat) === null) throw new NgxError("open() \"" + pat + "\" failed (2: No such file or directory) in " + start.file + ":" + start.line);
              items = items.concat(ngxParse(sys, pat, name, depth + 1));
            }
            continue;
          }
          items.push({ name: name, args: args, file: start.file, line: start.line });
          continue;
        }
        throw new NgxError("unexpected \"" + term.t + "\" in " + term.file + ":" + term.line);
      }
      if (parentName) throw new NgxError("unexpected end of file, expecting \"}\" in " + path + ":" + (toks.length ? toks[toks.length - 1].line : 1));
      return items;
    }
    return block(null);
  }
  function first(items, name) { for (var i = 0; i < items.length; i++) if (items[i].name === name) return items[i]; return null; }
  function all(items, name) { return items.filter(function (d) { return d.name === name; }); }
  function ngxLoad(sys) {
    var top = ngxParse(sys, "/etc/nginx/nginx.conf", null, 0);
    var warns = [];
    var http = first(top, "http");
    if (!http) throw new NgxError("no \"events\" section in configuration");
    // context checks
    top.forEach(function (d) { if (d.name === "server" || d.name === "location" || d.name === "listen") throw new NgxError("\"" + d.name + "\" directive is not allowed here in " + d.file + ":" + d.line); });
    var servers = all(http.block, "server").map(function (s) {
      var listens = all(s.block, "listen").map(function (l) {
        var v = l.args[0], addr = "0.0.0.0", port;
        var m = /^(?:(\[[^\]]+\]|[\d.]+|\*|localhost):)?(\w+)$/.exec(v);
        if (!m) throw new NgxError("invalid parameter \"" + v + "\" in " + l.file + ":" + l.line);
        if (m[1]) addr = m[1] === "*" ? "0.0.0.0" : m[1] === "localhost" ? "127.0.0.1" : m[1];
        if (!/^\d+$/.test(m[2])) { if (/^[\d.]+$/.test(m[2])) { addr = m[2]; port = 80; } else throw new NgxError("invalid port in \"" + v + "\" of the \"listen\" directive in " + l.file + ":" + l.line); }
        else port = +m[2];
        if (port < 1 || port > 65535) throw new NgxError("invalid port in \"" + v + "\" of the \"listen\" directive in " + l.file + ":" + l.line);
        l.args.slice(1).forEach(function (p) { if (!/^(default_server|default|ssl|http2|reuseport|ipv6only=(on|off)|proxy_protocol|backlog=\d+)$/.test(p)) throw new NgxError("invalid parameter \"" + p + "\" in " + l.file + ":" + l.line); });
        return { addr: addr, port: port, def: l.args.indexOf("default_server") >= 0 || l.args.indexOf("default") >= 0, ssl: l.args.indexOf("ssl") >= 0 };
      });
      if (!listens.length) listens = [{ addr: "0.0.0.0", port: 80, def: false }];
      var names = [].concat.apply([], all(s.block, "server_name").map(function (d) { return d.args; }));
      all(s.block, "ssl_certificate").concat(all(s.block, "ssl_certificate_key")).forEach(function (d) { if (rd(sys, d.args[0]) === null) throw new NgxError("cannot load certificate \"" + d.args[0] + "\": BIO_new_file() failed (SSL: error:80000002:system library::No such file or directory:calling fopen(" + d.args[0] + ", r) error:10000080:BIO routines::no such file)"); });
      var locs = all(s.block, "location").map(function (l) {
        var mod = l.args.length === 2 ? l.args[0] : "", p = l.args.length === 2 ? l.args[1] : l.args[0];
        if (mod && !/^(=|~|~\*|\^~)$/.test(mod)) throw new NgxError("invalid location modifier \"" + mod + "\" in " + l.file + ":" + l.line);
        if (mod === "~" || mod === "~*") { try { new RegExp(p); } catch (e) { throw new NgxError("pcre2_compile() failed: missing closing parenthesis in \"" + p + "\" in " + l.file + ":" + l.line); } }
        return { mod: mod, path: p, d: l.block };
      });
      return { listens: listens, names: names, d: s.block, locs: locs, file: s.file, line: s.line };
    });
    // duplicate default_server / conflicting names
    var seenDef = {}, seenName = {};
    servers.forEach(function (s) {
      s.listens.forEach(function (l) {
        var k = l.addr + ":" + l.port;
        if (l.def) { if (seenDef[k]) throw new NgxError("a duplicate default server for " + k + " in " + s.file + ":" + s.line); seenDef[k] = true; }
        s.names.forEach(function (n) { if (n === "_" || n === "") return; var nk = n + "@" + k; if (seenName[nk]) warns.push("nginx: [warn] conflicting server name \"" + n + "\" on " + k + ", ignored"); seenName[nk] = true; });
      });
    });
    var tokens = first(http.block, "server_tokens");
    var acc = first(http.block, "access_log"), errLog = first(top, "error_log") || first(http.block, "error_log");
    return { top: top, http: http, servers: servers, warns: warns, tokensOff: !!tokens && tokens.args[0] === "off", accessLog: acc ? acc.args[0] : "/var/log/nginx/access.log", errorLog: errLog ? errLog.args[0] : "/var/log/nginx/error.log", user: (first(top, "user") || { args: ["nobody"] }).args[0], files: ngxFiles(sys) };
  }
  function ngxFiles(sys) {
    var res = [];
    (function walk(p) {
      var t = rd(sys, p); if (t === null || res.indexOf(p) >= 0) return; res.push(p);
      ngxTokenize(t, p).forEach(function (tk, i, arr) {
        if (tk.t === "w" && tk.v === "include" && arr[i + 1] && arr[i + 1].t === "w") {
          var pat = arr[i + 1].v.charAt(0) === "/" ? arr[i + 1].v : "/etc/nginx/" + arr[i + 1].v;
          if (/[*?[]/.test(pat)) { var dir = pat.slice(0, pat.lastIndexOf("/")), base = pat.slice(pat.lastIndexOf("/") + 1), dn = nodeAt(sys, dir); if (dn && dn.type === "d") Object.keys(dn.children).sort().forEach(function (k) { if (S.globMatch(base, k)) walk(dir + "/" + k); }); }
          else walk(pat);
        }
      });
    })("/etc/nginx/nginx.conf");
    return res;
  }
  M2.nginxTest = function (sys) {
    try { var c = ngxLoad(sys); return { code: 0, lines: c.warns.concat(["nginx: the configuration file /etc/nginx/nginx.conf syntax is ok", "nginx: configuration file /etc/nginx/nginx.conf test is successful"]), conf: c }; }
    catch (e) { if (!(e instanceof NgxError)) throw e; return { code: 1, lines: ["nginx: [emerg] " + e.message, "nginx: configuration file /etc/nginx/nginx.conf test failed"] }; }
  };
  M2.nginxListens = function (sys) {
    var c = sys.nginxLive; try { c = ngxLoad(sys); } catch (e) { if (!(e instanceof NgxError)) throw e; }
    if (!c) return [{ proto: "tcp", addr: "0.0.0.0", port: 80 }];
    var seen = {}, res = [];
    c.servers.forEach(function (s) { s.listens.forEach(function (l) { var k = l.addr + ":" + l.port; if (!seen[k]) { seen[k] = true; res.push({ proto: "tcp", addr: l.addr.charAt(0) === "[" ? "[::]" : l.addr, port: l.port }); } }); });
    return res;
  };
  M2.onUnitStart = function (sys, u) {
    if (u.execStart && /nginx/.test(u.execStart)) { try { sys.nginxLive = ngxLoad(sys); } catch (e) { if (!(e instanceof NgxError)) throw e; } }
    if (u.name === "ssh.service") sys.sshdLive = sshdConf(sys);
  };
  M2.onUnitStop = function (sys, u) { if (u.execStart && /nginx/.test(u.execStart)) sys.nginxLive = null; };
  S.POST_HOOKS.push(function (sys) {
    if (!sys.net) sys.net = { byIp: {} };
    var nu = sys.units && sys.units["nginx.service"];
    if (nu && nu.rt.active === "active") { try { sys.nginxLive = ngxLoad(sys); } catch (e) { if (!(e instanceof NgxError)) throw e; sys.nginxLive = null; } }
    sys.sshdLive = sshdConf(sys);
    sys.nginxConn = 0;
  });
  CMDS.nginx = function (args, io, sess) {
    var sys = sess.sys, a = args.slice(1);
    if (a.indexOf("-v") >= 0) { errl(io, "nginx version: nginx/1.24.0 (Ubuntu)"); return 0; }
    if (a.indexOf("-V") >= 0) { errl(io, "nginx version: nginx/1.24.0 (Ubuntu)\nbuilt with OpenSSL 3.0.13 30 Jan 2024\nTLS SNI support enabled\nconfigure arguments: --with-cc-opt='-g -O2' --prefix=/usr/share/nginx --conf-path=/etc/nginx/nginx.conf --http-log-path=/var/log/nginx/access.log --error-log-path=stderr --lock-path=/var/lock/nginx.lock --pid-path=/run/nginx.pid --with-http_ssl_module --with-http_v2_module"); return 0; }
    var test = a.indexOf("-t") >= 0 || a.indexOf("-T") >= 0, dump = a.indexOf("-T") >= 0, quiet = a.indexOf("-q") >= 0, sig = a[a.indexOf("-s") + 1];
    if (test) {
      var r = M2.nginxTest(sys);
      if (sess.uid !== 0) { errl(io, "nginx: [alert] could not open error log file: open() \"/var/log/nginx/error.log\" failed (13: Permission denied)"); r.lines.forEach(function (l, i) { if (!/test (is successful|failed)/.test(l)) errl(io, l.replace("2026/11/11 09:00:00 ", "")); }); if (r.code === 0) errl(io, "2026/11/11 09:00:00 [emerg] " + (sys.nextPid++) + "#" + (sys.nextPid - 1) + ": open() \"/run/nginx.pid\" failed (13: Permission denied)"); errl(io, "nginx: configuration file /etc/nginx/nginx.conf test failed"); return 1; }
      r.lines.forEach(function (l) { if (!quiet || /emerg|warn/.test(l)) errl(io, l); });
      if (dump && r.code === 0) ngxFiles(sys).forEach(function (f) { out(io, "# configuration file " + f + ":\n" + rd(sys, f) + (/\n$/.test(rd(sys, f)) ? "" : "\n") + "\n"); });
      return r.code;
    }
    if (sig) {
      if (sess.uid !== 0) { errl(io, "nginx: [alert] could not open error log file: open() \"/var/log/nginx/error.log\" failed (13: Permission denied)\n2026/11/11 09:00:00 [notice] " + sys.nextPid + "#" + sys.nextPid + ": signal process started\n2026/11/11 09:00:00 [alert] " + sys.nextPid + "#" + sys.nextPid + ": kill(1123, 1) failed (1: Operation not permitted)"); return 1; }
      var u = sys.units["nginx.service"];
      if (!u || u.rt.active !== "active") { errl(io, "nginx: [error] invalid PID number \"\" in \"/run/nginx.pid\""); return 1; }
      errl(io, "2026/11/11 09:00:00 [notice] " + (sys.nextPid++) + "#" + (sys.nextPid - 1) + ": signal process started");
      if (sig === "reload") { var rr = M2.reloadUnit(sys, u, sess); if (!rr.ok) { var t2 = M2.nginxTest(sys); errl(io, t2.lines[0]); return 1; } return 0; }
      if (sig === "stop" || sig === "quit") { M2.stopUnit(sys, u); return 0; }
      return 0;
    }
    if (sess.uid !== 0) { errl(io, "nginx: [alert] could not open error log file: open() \"/var/log/nginx/error.log\" failed (13: Permission denied)\n2026/11/11 09:00:00 [emerg] " + sys.nextPid + "#" + sys.nextPid + ": open() \"/var/log/nginx/access.log\" failed (13: Permission denied)"); return 1; }
    errl(io, "nginx: [emerg] bind() to 0.0.0.0:80 failed (98: Address already in use)\nnginx: [emerg] still could not bind()");
    note(io, "(Start nginx with systemctl start nginx, so systemd manages it.)");
    return 1;
  };
  var SSHD_KEYS = "port listenaddress permitrootlogin pubkeyauthentication passwordauthentication kbdinteractiveauthentication challengeresponseauthentication usepam x11forwarding printmotd printlastlog acceptenv subsystem include authorizedkeysfile permitemptypasswords maxauthtries logingracetime clientaliveinterval clientalivecountmax allowusers allowgroups denyusers denygroups hostkey syslogfacility loglevel strictmodes permittunnel allowtcpforwarding allowagentforwarding banner maxsessions maxstartups usedns ciphers macs kexalgorithms match forcecommand chrootdirectory permituserenvironment gatewayports tcpkeepalive compression authenticationmethods hostbasedauthentication ignorerhosts x11displayoffset addressfamily".split(" ");
  function sshdConf(sys, strict) {
    var c = { port: 22, permitrootlogin: "prohibit-password", pubkeyauthentication: "yes", passwordauthentication: "yes", kbdinteractiveauthentication: "no", usepam: "yes", x11forwarding: "no", maxauthtries: "6", permitemptypasswords: "no", strictmodes: "yes", allowusers: null, allowgroups: null, denyusers: null, errors: [] };
    var seen = {};
    function readF(path) {
      var text = rd(sys, path); if (text === null) return;
      lines(text).forEach(function (l, i) {
        var t = l.replace(/#.*/, "").trim(); if (!t) return;
        var m = /^(\S+)\s+(.*)$/.exec(t); if (!m) { c.errors.push(path + " line " + (i + 1) + ": Bad configuration option: " + t); return; }
        var k = m[1].toLowerCase(), v = m[2].trim();
        if (SSHD_KEYS.indexOf(k) < 0) { c.errors.push(path + " line " + (i + 1) + ": Bad configuration option: " + m[1]); return; }
        if (k === "include") { var pat = v.charAt(0) === "/" ? v : "/etc/ssh/" + v, dir = pat.slice(0, pat.lastIndexOf("/")), base = pat.slice(pat.lastIndexOf("/") + 1), dn = nodeAt(sys, dir); if (dn && dn.type === "d") Object.keys(dn.children).sort().forEach(function (f) { if (S.globMatch(base, f)) readF(dir + "/" + f); }); return; }
        if (/^(passwordauthentication|pubkeyauthentication|permitemptypasswords|usepam|x11forwarding|strictmodes|kbdinteractiveauthentication)$/.test(k) && !/^(yes|no)$/i.test(v)) { c.errors.push(path + " line " + (i + 1) + ": unsupported option \"" + v + "\"."); return; }
        if (k === "permitrootlogin" && !/^(yes|no|prohibit-password|without-password|forced-commands-only)$/.test(v)) { c.errors.push(path + " line " + (i + 1) + ": unsupported option \"" + v + "\"."); return; }
        if (k === "port" && !/^\d+$/.test(v)) { c.errors.push(path + " line " + (i + 1) + ": Badly formatted port number."); return; }
        if (seen[k] && k !== "port" && k !== "allowusers" && k !== "hostkey") return;
        seen[k] = true;
        c[k] = k === "port" ? +v : /^(allowusers|allowgroups|denyusers|denygroups)$/.test(k) ? (c[k] || []).concat(v.split(/\s+/)) : v.toLowerCase();
      });
    }
    readF("/etc/ssh/sshd_config");
    return c;
  }
  M2.sshdConf = sshdConf;
  M2.sshdTest = function (sys) { var c = sshdConf(sys); if (c.errors.length) return { code: 255, lines: c.errors.concat(["/etc/ssh/sshd_config: terminating, " + c.errors.length + " bad configuration options"]) }; return { code: 0, lines: [] }; };
  CMDS.sshd = function (args, io, sess) {
    if (sess.uid !== 0) { errl(io, "Could not load host key: /etc/ssh/ssh_host_rsa_key\nCould not load host key: /etc/ssh/ssh_host_ecdsa_key\nCould not load host key: /etc/ssh/ssh_host_ed25519_key\nsshd: no hostkeys available -- exiting."); return 1; }
    if (args.indexOf("-t") >= 0) { var r = M2.sshdTest(sess.sys); r.lines.forEach(function (l) { errl(io, l); }); return r.code; }
    if (args.indexOf("-T") >= 0) { var c = sshdConf(sess.sys); if (c.errors.length) { c.errors.forEach(function (l) { errl(io, l); }); return 255; } out(io, "port " + c.port + "\naddressfamily any\nlistenaddress [::]:" + c.port + "\nlistenaddress 0.0.0.0:" + c.port + "\nusepam " + c.usepam + "\nlogingracetime 120\nx11forwarding " + c.x11forwarding + "\nstrictmodes " + c.strictmodes + "\npermitrootlogin " + (c.permitrootlogin === "prohibit-password" ? "without-password" : c.permitrootlogin) + "\npubkeyauthentication " + c.pubkeyauthentication + "\npasswordauthentication " + c.passwordauthentication + "\nkbdinteractiveauthentication " + c.kbdinteractiveauthentication + "\npermitemptypasswords " + c.permitemptypasswords + "\nmaxauthtries " + c.maxauthtries + "\n" + (c.allowusers ? "allowusers " + c.allowusers.join(" ") + "\n" : "") + "authorizedkeysfile .ssh/authorized_keys .ssh/authorized_keys2\nsubsystem sftp /usr/lib/openssh/sftp-server\n"); return 0; }
    note(io, "(sshd is the SSH server; systemd runs it as ssh.service. Check its config with sudo sshd -t.)");
    return 0;
  };

  /* ---------------- HTTP: servers answering on kc-web-01 */
  var MIME = { html: "text/html", htm: "text/html", css: "text/css", js: "application/javascript", json: "application/json", png: "image/png", jpg: "image/jpeg", svg: "image/svg+xml", txt: "text/plain", ico: "image/x-icon", xml: "text/xml" };
  function httpDate(ms) { var d = new Date(ms); return WDAY[d.getUTCDay()] + ", " + pad(d.getUTCDate(), 2, "0") + " " + MON[d.getUTCMonth()] + " " + d.getUTCFullYear() + " " + tod(ms) + " GMT"; }
  var REASON = { 200: "OK", 201: "Created", 204: "No Content", 301: "Moved Permanently", 302: "Found", 304: "Not Modified", 400: "Bad Request", 401: "Unauthorized", 403: "Forbidden", 404: "Not Found", 405: "Method Not Allowed", 413: "Request Entity Too Large", 500: "Internal Server Error", 502: "Bad Gateway", 503: "Service Temporarily Unavailable", 504: "Gateway Time-out" };
  function ngxErrPage(code, conf) { var t = code + " " + REASON[code]; return "<html>\n<head><title>" + t + "</title></head>\n<body>\n<center><h1>" + t + "</h1></center>\n<hr><center>" + (conf && conf.tokensOff ? "nginx" : "nginx/1.24.0 (Ubuntu)") + "</center>\n</body>\n</html>\n"; }
  function wwwSess(sys, user) { var u = S.userByName(sys, user || "www-data") || { uid: 33, gid: 33, name: "www-data" }; return { sys: sys, uid: u.uid, gid: u.gid, groups: [u.gid].concat(S.supplementary(sys, u.name)), cwd: "/", user: u.name, umask: 18, vars: {} }; }
  function serveNginx(sys, conf, req, client) {
    var hostHdr = (req.headers.host || "").replace(/:\d+$/, "").toLowerCase();
    var cands = conf.servers.filter(function (s) { return s.listens.some(function (l) { return l.port === req.port && (l.addr === "0.0.0.0" || l.addr === "[::]" || l.addr === req.localIp); }); });
    if (!cands.length) return { status: 444, closed: true };
    var srv = cands.filter(function (s) { return s.names.some(function (n) { n = n.toLowerCase(); return n === hostHdr || (n.charAt(0) === "*" && hostHdr.slice(-(n.length - 1)) === n.slice(1)) || (n.charAt(0) === "." && (hostHdr === n.slice(1) || hostHdr.slice(-n.length) === n)); }); })[0]
      || cands.filter(function (s) { return s.listens.some(function (l) { return l.port === req.port && l.def; }); })[0] || cands[0];
    var path = decodeURIComponent(req.path.split("?")[0]).replace(/\/\.\.(?=\/|$)/g, "");
    // location: exact, longest prefix (^~ stops), regex in order
    var loc = null, exact = srv.locs.filter(function (l) { return l.mod === "=" && l.path === path; })[0];
    if (exact) loc = exact;
    else {
      var pre = srv.locs.filter(function (l) { return (l.mod === "" || l.mod === "^~") && path.indexOf(l.path) === 0; }).sort(function (a, b) { return b.path.length - a.path.length; })[0];
      if (!pre || pre.mod !== "^~") { var rx = srv.locs.filter(function (l) { return (l.mod === "~" || l.mod === "~*") && new RegExp(l.path, l.mod === "~*" ? "i" : "").test(path); })[0]; loc = rx || pre || null; }
      else loc = pre;
    }
    function get(name) { var d = loc && first(loc.d, name); if (d) return d; d = first(srv.d, name); if (d) return d; return first(conf.http.block, name); }
    var headersAdd = (loc && all(loc.d, "add_header").length ? all(loc.d, "add_header") : all(srv.d, "add_header").length ? all(srv.d, "add_header") : all(conf.http.block, "add_header"));
    var serverName = srv.names[0] || "";
    var res = { status: 200, headers: {}, body: "", srvName: serverName };
    function finish() {
      var hdr = { Server: conf.tokensOff ? "nginx" : "nginx/1.24.0 (Ubuntu)", Date: httpDate(sys.now), "Content-Type": res.headers["Content-Type"] || "text/html", "Content-Length": String(bytes(res.body)) };
      ["Last-Modified", "Location"].forEach(function (k) { if (res.headers[k]) hdr[k] = res.headers[k]; });
      hdr.Connection = "keep-alive";
      Object.keys(res.headers).forEach(function (k) { if (!hdr[k] && k !== "Accept-Ranges") hdr[k] = res.headers[k]; });
      if ([200, 201, 204, 206, 301, 302, 303, 304, 307, 308].indexOf(res.status) >= 0 || true) headersAdd.forEach(function (h) { if (h.args[2] === "always" || [200, 201, 204, 206, 301, 302, 303, 304, 307, 308].indexOf(res.status) >= 0) hdr[h.args[0]] = h.args[1]; });
      if (res.headers["Accept-Ranges"]) hdr["Accept-Ranges"] = res.headers["Accept-Ranges"];
      res.headers = hdr;
      var acc = get("access_log"), accPath = acc ? acc.args[0] : conf.accessLog;
      if (accPath !== "off" && nodeAt(sys, accPath.slice(0, accPath.lastIndexOf("/")))) writeRoot(sys, accPath, S.gen.logLine(client, sys.now, req.method, req.path, res.status, req.method === "HEAD" ? 0 : bytes(res.body), req.headers["user-agent"] || "-") + "\n", true);
      return res;
    }
    function errLog(level, msg) {
      sys.nginxConn = (sys.nginxConn || 0) + 1;
      var w = M2.listeners(sys).filter(function (x) { return x.proc.unit === "nginx.service" && !x.proc.main; })[0], wp = w ? w.proc.pid : 1124;
      var p = conf.errorLog; if (p === "stderr" || !nodeAt(sys, p.slice(0, p.lastIndexOf("/")))) return;
      writeRoot(sys, p, "2026/11/11 " + tod(sys.now) + " [" + level + "] " + wp + "#" + wp + ": *" + sys.nginxConn + " " + msg + ", client: " + client + ", server: " + (serverName || "_") + ", request: \"" + req.method + " " + req.path + " HTTP/1.1\", host: \"" + (req.headers.host || "") + "\"\n", true);
    }
    function fail(code, level, msg) { res.status = code; res.body = ngxErrPage(code, conf); if (msg) errLog(level || "error", msg); return finish(); }
    var deny = get("deny"); if (deny && deny.args[0] === "all") return fail(403, "error", "access forbidden by rule");
    var ret = get("return");
    if (ret && (loc ? first(loc.d, "return") || first(srv.d, "return") : first(srv.d, "return"))) {
      var code = +ret.args[0], val = ret.args[1];
      if (code >= 300 && code < 400) { res.status = code; res.headers.Location = (val || "").replace(/\$host/g, hostHdr).replace(/\$request_uri/g, req.path).replace(/\$server_name/g, serverName); res.body = ngxErrPage(code, conf); return finish(); }
      res.status = code; res.body = val !== undefined ? val : ngxErrPage(code, conf); if (val !== undefined) res.headers["Content-Type"] = "application/octet-stream"; return finish();
    }
    var pp = get("proxy_pass");
    if (pp && loc && first(loc.d, "proxy_pass")) {
      var u = /^https?:\/\/([^:/]+)(?::(\d+))?(\/.*)?$/.exec(pp.args[0]);
      var upPath = u && u[3] ? u[3] + path.slice(loc.path.length) : req.path;
      // an upstream { server ...; } group: round robin, and on a refused connection try the next server
      var group = u && conf.http.block.filter(function (d) { return d.name === "upstream" && d.args[0] === u[1] && d.block; })[0];
      var targets = group ? group.block.filter(function (d) { return d.name === "server"; }).map(function (d) { var hp = /^([^:]+)(?::(\d+))?$/.exec(d.args[0]); return { host: hp[1], port: hp[2] ? +hp[2] : 80, backup: d.args.indexOf("backup") >= 0, down: d.args.indexOf("down") >= 0 }; }).filter(function (t) { return !t.down; }) : u ? [{ host: u[1], port: u[2] ? +u[2] : 80 }] : [];
      if (group) {
        sys.nginxRR = sys.nginxRR || {};
        var prim = targets.filter(function (t) { return !t.backup; }), k0 = (sys.nginxRR[u[1]] = ((sys.nginxRR[u[1]] == null ? -1 : sys.nginxRR[u[1]]) + 1)) % Math.max(1, prim.length);
        targets = prim.slice(k0).concat(prim.slice(0, k0)).concat(targets.filter(function (t) { return t.backup; }));
      }
      // proxy_set_header, with the variables people use for client addresses
      var setH = loc && all(loc.d, "proxy_set_header").length ? all(loc.d, "proxy_set_header") : all(srv.d, "proxy_set_header").length ? all(srv.d, "proxy_set_header") : all(conf.http.block, "proxy_set_header");
      var upHeaders = Object.assign({}, req.headers);
      setH.forEach(function (h) {
        var v = h.args[1].replace(/\$proxy_add_x_forwarded_for/g, req.headers["x-forwarded-for"] ? req.headers["x-forwarded-for"] + ", " + client : client).replace(/\$remote_addr/g, client).replace(/\$host/g, hostHdr).replace(/\$scheme/g, req.scheme || "http").replace(/\$http_x_forwarded_for/g, req.headers["x-forwarded-for"] || "").replace(/\$request_uri/g, req.path);
        if (v === "") delete upHeaders[h.args[0].toLowerCase()]; else upHeaders[h.args[0].toLowerCase()] = v;
      });
      for (var ti = 0; ti < targets.length; ti++) {
        var tg = targets[ti], upIp = resolve(sys, tg.host), conn = upIp ? tcpConnect(sys, upIp, tg.port) : { refused: true };
        if (!conn.self || !conn.proc) { errLog("error", "connect() failed (111: Connection refused) while connecting to upstream, upstream: \"http://" + tg.host + ":" + tg.port + upPath + "\""); continue; }
        var up = handleBy(sys, conn.proc, Object.assign({}, req, { path: upPath, port: tg.port, localIp: upIp, headers: upHeaders, client: "127.0.0.1" }), "127.0.0.1");
        res.status = up.status; res.body = up.body; res.headers = { "Content-Type": up.headers["Content-Type"] };
        return finish();
      }
      if (group && targets.length) { res.status = 502; res.body = ngxErrPage(502, conf); errLog("error", "no live upstreams while connecting to upstream, upstream: \"http://" + u[1] + upPath + "\""); return finish(); }
      return fail(502);
    }
    var rootD = get("root"), aliasD = loc && first(loc.d, "alias"), docroot = rootD ? rootD.args[0] : "/usr/share/nginx/html";
    var idx = get("index"), indexes = idx ? idx.args : ["index.html"];
    var auto = get("autoindex"), autoOn = auto && auto.args[0] === "on";
    var www = wwwSess(sys, conf.user);
    function fsPath(uri) { return aliasD ? aliasD.args[0].replace(/\/$/, "") + "/" + uri.slice(loc.path.length).replace(/^\//, "") : docroot.replace(/\/$/, "") + uri; }
    function tryFile(uri, logMissing) {
      var p = fsPath(uri), r = S.lookup(www, p);
      if (r.error === "EACCES") return { st: 403, msg: "open() \"" + p + "\" failed (13: Permission denied)" };
      if (!r.node) return { st: 404, msg: logMissing ? "open() \"" + p + "\" failed (2: No such file or directory)" : null };
      if (r.node.type === "d") return { dir: true, path: p, node: r.node };
      if (!S.can(www, r.node, "r")) return { st: 403, msg: "open() \"" + p + "\" failed (13: Permission denied)" };
      return { file: true, path: p, node: r.node };
    }
    function serveFile(t, uri) {
      var ext = (/\.([a-z0-9]+)$/i.exec(t.path) || [])[1];
      res.status = 200; res.body = req.method === "HEAD" ? "" : t.node.content;
      res.headers["Content-Type"] = MIME[(ext || "").toLowerCase()] || (first(conf.http.block, "default_type") || { args: ["application/octet-stream"] }).args[0];
      res.headers["Last-Modified"] = httpDate(t.node.mtime);
      res.headers.ETag = "\"" + Math.floor(t.node.mtime / 1000).toString(16) + "-" + bytes(t.node.content).toString(16) + "\"";
      res.headers["Accept-Ranges"] = "bytes";
      res.headLen = bytes(t.node.content);
      return finish();
    }
    function serveDir(t, uri) {
      if (!/\/$/.test(uri)) { res.status = 301; res.headers.Location = "http://" + (req.headers.host || hostHdr) + uri + "/"; res.body = ngxErrPage(301, conf); return finish(); }
      for (var i = 0; i < indexes.length; i++) { var f = tryFile(uri + indexes[i], false); if (f.file) return serveFile(f, uri + indexes[i]); if (f.st === 403) return fail(403, "error", f.msg); }
      if (!S.can(www, t.node, "r")) return fail(403, "error", "open() \"" + t.path + "\" failed (13: Permission denied)");
      if (autoOn) { res.status = 200; res.body = "<html>\r\n<head><title>Index of " + uri + "</title></head>\r\n<body>\r\n<h1>Index of " + uri + "</h1><hr><pre><a href=\"../\">../</a>\r\n" + Object.keys(t.node.children).sort().map(function (k) { return "<a href=\"" + k + "\">" + k + "</a>"; }).join("\r\n") + "\r\n</pre><hr></body>\r\n</html>\r\n"; return finish(); }
      return fail(403, "error", "directory index of \"" + t.path.replace(/\/?$/, "/") + "\" is forbidden");
    }
    var tf = get("try_files");
    if (tf) {
      for (var k = 0; k < tf.args.length; k++) {
        var arg = tf.args[k], last = k === tf.args.length - 1;
        if (last && /^=\d+$/.test(arg)) return fail(+arg.slice(1));
        var uri2 = arg.replace(/\$uri/g, path);
        if (last) { var lt = tryFile(uri2, true); if (lt.file) return serveFile(lt, uri2); if (lt.dir) return serveDir(lt, uri2.replace(/\/?$/, "/")); return fail(lt.st || 404, "error", lt.msg); }
        var t = tryFile(uri2.replace(/\/$/, ""), false);
        if (/\/$/.test(uri2)) { if (t.dir) return serveDir(t, uri2); continue; }
        if (t.file) return serveFile(t, uri2);
        if (t.st === 403) return fail(403, "error", t.msg);
      }
      return fail(404);
    }
    var t0 = tryFile(path, true);
    if (t0.file) return serveFile(t0, path);
    if (t0.dir) return serveDir(t0, path);
    return fail(t0.st, "error", t0.msg);
  }
  function kestrelApp(sys, req) {
    var p = req.path.split("?")[0], routes = Object.assign({
      "/api/health": [200, "{\"status\":\"ok\"}\n"],
      "/api/version": [200, "{\"app\":\"kestrel\",\"version\":\"1.4.2\"}\n"],
      "/api/orders": [200, "[{\"id\":7731,\"status\":\"shipped\",\"total\":42.5},{\"id\":7732,\"status\":\"pending\",\"total\":18.0}]\n"]
    }, sys.appRoutes || {});
    var r = routes[p];
    if (!r) return { status: 404, headers: { Server: "gunicorn", Date: httpDate(sys.now), Connection: "close", "Content-Type": "text/html; charset=utf-8" }, body: "<!doctype html>\n<html lang=en>\n<title>404 Not Found</title>\n<h1>Not Found</h1>\n<p>The requested URL was not found on the server. If you entered the URL manually please check your spelling and try again.</p>\n" };
    var body = typeof r[1] === "function" ? r[1](sys, req) : r[1];
    return { status: r[0], headers: { Server: "gunicorn", Date: httpDate(sys.now), Connection: "close", "Content-Type": "application/json" }, body: body, delay: r[2] || 0 };
  }
  function pyHttpServer(sys, proc, req) {
    var dir = proc.cwd || "/", sess = wwwSess(sys, S.uname(sys, proc.uid)), p = decodeURIComponent(req.path.split("?")[0]), r = S.lookup(sess, dir.replace(/\/$/, "") + p);
    var base = { Server: "SimpleHTTP/0.6 Python/3.12.3", Date: httpDate(sys.now) };
    if (!r.node) return { status: 404, headers: Object.assign(base, { "Content-Type": "text/html;charset=utf-8", Connection: "close" }), body: "<!DOCTYPE HTML>\n<html lang=\"en\">\n    <head>\n        <meta charset=\"utf-8\">\n        <title>Error response</title>\n    </head>\n    <body>\n        <h1>Error response</h1>\n        <p>Error code: 404</p>\n        <p>Message: File not found.</p>\n    </body>\n</html>\n" };
    if (r.node.type === "d") return { status: 200, headers: Object.assign(base, { "Content-type": "text/html; charset=utf-8" }), body: "<!DOCTYPE HTML>\n<html lang=\"en\">\n<head>\n<meta charset=\"utf-8\">\n<title>Directory listing for " + p + "</title>\n</head>\n<body>\n<h1>Directory listing for " + p + "</h1>\n<hr>\n<ul>\n" + Object.keys(r.node.children).sort().map(function (k) { return "<li><a href=\"" + k + "\">" + k + "</a></li>"; }).join("\n") + "\n</ul>\n<hr>\n</body>\n</html>\n" };
    return { status: 200, headers: Object.assign(base, { "Content-type": "text/plain" }), body: r.node.content };
  }
  function handleBy(sys, proc, req, client) {
    if (proc.unit === "nginx.service") { var conf = sys.nginxLive; if (!conf) return { status: 502, headers: {}, body: "" }; return serveNginx(sys, conf, req, client); }
    if (proc.comm === "gunicorn" || proc.unit === "kestrel-app.service") return kestrelApp(sys, req);
    if (/http\.server/.test(proc.cmd)) return pyHttpServer(sys, proc, req);
    if (proc.unit === "apache2.service") return { status: 200, headers: { Server: "Apache/2.4.58 (Ubuntu)", Date: httpDate(sys.now), "Content-Type": "text/html" }, body: rd(sys, "/var/www/html/index.html") || "" };
    return { proto: true };
  }
  var SITES = {
    example: function () { return { status: 200, headers: { "Content-Type": "text/html", Server: "ECAcc (nyd/D184)" }, body: "<!doctype html>\n<html>\n<head>\n    <title>Example Domain</title>\n</head>\n<body>\n<div>\n    <h1>Example Domain</h1>\n    <p>This domain is for use in illustrative examples in documents.</p>\n</div>\n</body>\n</html>\n" }; },
    ifconfig: function () { return { status: 200, headers: { "Content-Type": "text/plain; charset=utf-8", Server: "istio-envoy" }, body: "203.0.113.15" }; },
    oldkestrel: function (req) { return req.path.split("?")[0] === "/" || req.path === "/index.html" ? { status: 200, headers: { "Content-Type": "text/html", Server: "Apache" }, body: "<!DOCTYPE html>\n<html><head><title>Kestrel Cloud</title></head>\n<body><h1>Kestrel Cloud</h1><p>Served by the old hosting provider. We're moving soon!</p></body></html>\n" } : { status: 404, headers: { "Content-Type": "text/html", Server: "Apache" }, body: "<!DOCTYPE HTML PUBLIC \"-//IETF//DTD HTML 2.0//EN\">\n<html><head>\n<title>404 Not Found</title>\n</head><body>\n<h1>Not Found</h1>\n</body></html>\n" }; },
    ubuntu: function (req) { return req.path === "/" || req.path === "/ubuntu/" ? { status: 200, headers: { "Content-Type": "text/html;charset=UTF-8", Server: "Apache/2.4.29 (Ubuntu)" }, body: "<!DOCTYPE HTML PUBLIC \"-//W3C//DTD HTML 3.2 Final//EN\">\n<html>\n <head>\n  <title>Index of /ubuntu</title>\n </head>\n</html>\n" } : { status: 404, headers: { "Content-Type": "text/html" }, body: "Not Found\n" }; },
    github: function (req) { return { status: 301, headers: { Location: "https://github.com" + req.path, "Content-Type": "text/html" }, body: "" }; },
    "github-api": function () { return { status: 200, headers: { "Content-Type": "application/json; charset=utf-8", Server: "github.com" }, body: "{\n  \"current_user_url\": \"https://api.github.com/user\",\n  \"repository_url\": \"https://api.github.com/repos/{owner}/{repo}\"\n}\n" }; },
    google: function (req) { return { status: 301, headers: { Location: "http://www.google.com/", "Content-Type": "text/html; charset=UTF-8", Server: "gws" }, body: "<HTML><HEAD><meta http-equiv=\"content-type\" content=\"text/html;charset=utf-8\">\n<TITLE>301 Moved</TITLE></HEAD><BODY>\n<H1>301 Moved</H1>\nThe document has moved\n<A HREF=\"http://www.google.com/\">here</A>.\r\n</BODY></HTML>\r\n" }; }
  };
  M2.net.SITES = SITES;
  // one HTTP request from a session on sys. Returns {err:{code,msg}} or {status, headers, body, ip}
  function httpRequest(sys, req) {
    var ip = req.resolveTo || resolve(sys, req.host);
    if (!ip) return { err: { code: 6, msg: "Could not resolve host: " + req.host } };
    var c = tcpConnect(sys, ip, req.port);
    if (c.timeout) return { err: { code: 28, msg: "Failed to connect to " + req.host + " port " + req.port + " after 130001 ms: Couldn't connect to server" }, ip: ip };
    if (c.refused) return { err: { code: 7, msg: "Failed to connect to " + req.host + " port " + req.port + " after 0 ms: Couldn't connect to server" }, ip: ip };
    var r;
    if (c.self) {
      if (req.scheme === "https" && !(c.proc.unit === "nginx.service" && sys.nginxLive && sys.nginxLive.servers.some(function (s) { return s.listens.some(function (l) { return l.port === req.port && l.ssl; }); }))) return { err: { code: 35, msg: "OpenSSL/3.0.13: error:0A00010B:SSL routines::wrong version number" }, ip: ip };
      var client = /^127\./.test(ip) ? "127.0.0.1" : myIp(sys);
      r = handleBy(sys, c.proc, Object.assign({}, req, { localIp: ip }), client);
      if (r.proto) return { err: { code: 1, msg: "Received HTTP/0.9 when not allowed" }, ip: ip };
      if (r.closed) return { err: { code: 52, msg: "Empty reply from server" }, ip: ip };
    } else if (c.remote) {
      var rr = httpRequest(c.remote, Object.assign({}, req, { resolveTo: "127.0.0.1" }));
      return Object.assign(rr, { ip: ip });
    } else {
      var site = c.info && SITES[c.info.site];
      if (!site) return { err: { code: req.port === 5432 || req.port === 22 ? 1 : 52, msg: req.port === 5432 || req.port === 22 ? "Received HTTP/0.9 when not allowed" : "Empty reply from server" }, ip: ip };
      r = site(req, sys);
      r.headers = Object.assign({ Date: httpDate(sys.now) }, r.headers);
      if (!r.headers["Content-Length"]) r.headers["Content-Length"] = String(bytes(r.body));
    }
    r.ip = ip;
    return r;
  }
  M2.httpRequest = httpRequest;
  function parseUrl(u) {
    var m = /^(?:(https?):\/\/)?(\[[^\]]+\]|[^:/?#]+)(?::(\d+))?([^?#]*)?(\?[^#]*)?/i.exec(u);
    if (!m) return null;
    var scheme = (m[1] || "http").toLowerCase();
    return { scheme: scheme, host: m[2].replace(/^\[|\]$/g, ""), port: m[3] ? +m[3] : scheme === "https" ? 443 : 80, path: (m[4] || "/") + (m[5] || ""), explicitPort: !!m[3] };
  }
  M2.parseUrl = parseUrl;
  CMDS.curl = function (args, io, sess) {
    var sys = sess.sys, a = args.slice(1), o = { headers: {}, method: null }, url = null, wfmt = null;
    for (var i = 0; i < a.length; i++) {
      var x = a[i], m;
      if (/^--/.test(x)) {
        if (x === "--silent") o.s = true; else if (x === "--show-error") o.S = true; else if (x === "--head") o.I = true; else if (x === "--include") o.i = true; else if (x === "--verbose") o.v = true; else if (x === "--fail") o.f = true; else if (x === "--location") o.L = true; else if (x === "--insecure") o.k = true; else if (x === "--remote-name") o.O = true;
        else if (x === "--output") o.o = a[++i]; else if (x === "--header") { m = /^([^:]+):\s*(.*)$/.exec(a[++i] || ""); if (m) o.headers[m[1].toLowerCase()] = m[2]; } else if (x === "--request") o.method = a[++i]; else if (x === "--data" || x === "--data-raw") { o.data = a[++i]; } else if (x === "--write-out") wfmt = a[++i]; else if (x === "--user-agent") o.headers["user-agent"] = a[++i];
        else if (x === "--resolve") { var rv = (a[++i] || "").split(":"); o.resolve = { host: rv[0], port: +rv[1], ip: rv[2] }; } else if (x === "--max-time" || x === "--connect-timeout" || x === "--retry" || x === "--user") i++; else if (x === "--compressed" || x === "--http1.1" || x === "--no-progress-meter") { if (x === "--no-progress-meter") o.noProgress = true; }
        else if (x === "--help") { out(io, "Usage: curl [options...] <url>\n -d, --data <data>          HTTP POST data\n -f, --fail                 Fail fast with no output on HTTP errors\n -H, --header <header/@file> Pass custom header(s) to server\n -i, --include              Include protocol response headers in the output\n -I, --head                 Show document info only\n -L, --location             Follow redirects\n -o, --output <file>        Write to file instead of stdout\n -O, --remote-name          Write output to a file named as the remote file\n -s, --silent               Silent mode\n -v, --verbose              Make the operation more talkative\n -w, --write-out <format>   Use output FORMAT after completion\n"); return 0; }
        else { errl(io, "curl: option " + x + ": is unknown\ncurl: try 'curl --help' or 'curl --manual' for more information"); return 2; }
        continue;
      }
      if (/^-[a-zA-Z]+$/.test(x)) {
        for (var k = 1; k < x.length; k++) {
          var c = x.charAt(k);
          if ("sSIivfLkO".indexOf(c) >= 0) o[c] = true;
          else if ("oHXdwAmu".indexOf(c) >= 0) {
            var val = x.slice(k + 1) || a[++i];
            if (c === "o") o.o = val; else if (c === "H") { m = /^([^:]+):\s*(.*)$/.exec(val || ""); if (m) o.headers[m[1].toLowerCase()] = m[2]; } else if (c === "X") o.method = val; else if (c === "d") o.data = val; else if (c === "w") wfmt = val; else if (c === "A") o.headers["user-agent"] = val;
            break;
          } else { errl(io, "curl: option -" + c + ": is unknown\ncurl: try 'curl --help' or 'curl --manual' for more information"); return 2; }
        }
        continue;
      }
      url = x;
    }
    if (!url) { errl(io, "curl: try 'curl --help' or 'curl --manual' for more information"); return 2; }
    var u = parseUrl(url);
    if (!u) { errl(io, "curl: (3) URL rejected: Malformed input to a URL function"); return 3; }
    var method = o.method || (o.I ? "HEAD" : o.data !== undefined ? "POST" : "GET");
    var hostHdr = o.headers.host || (u.host + (u.explicitPort ? ":" + u.port : ""));
    var showErr = !o.s || o.S, redirects = 0, res, cur = u;
    var stdoutTty = !!io.tty && !o.o && !o.O;
    var verbose = function (t) { if (o.v) errl(io, t); };
    for (;;) {
      var req = { scheme: cur.scheme, host: cur.host, port: cur.port, path: cur.path, method: method, headers: Object.assign({ host: hostHdr, "user-agent": "curl/8.5.0", accept: "*/*" }, o.headers), body: o.data };
      if (o.resolve && o.resolve.host === cur.host && o.resolve.port === cur.port) req.resolveTo = o.resolve.ip;
      verbose("*   Trying " + (req.resolveTo || resolve(sys, cur.host) || cur.host) + ":" + cur.port + "...");
      res = httpRequest(sys, req);
      if (res.err) { verbose("* connect to " + (res.ip || cur.host) + " port " + cur.port + " failed: Connection refused"); if (showErr) errl(io, "curl: (" + res.err.code + ") " + res.err.msg); if (wfmt) out(io, wfmt.replace(/%\{(\w+)\}/g, function (m0, k) { return { http_code: "000", response_code: "0", size_download: "0", time_total: "0.000512", remote_ip: "", content_type: "", url_effective: url, num_redirects: "0" }[k] || ""; }).replace(/\\n/g, "\n")); return res.err.code; }
      verbose("* Connected to " + cur.host + " (" + res.ip + ") port " + cur.port);
      verbose("> " + method + " " + cur.path + " HTTP/1.1\n> Host: " + req.headers.host + "\n> User-Agent: " + req.headers["user-agent"] + "\n> Accept: */*\n> ");
      verbose("< HTTP/1.1 " + res.status + " " + (REASON[res.status] || "") + "\n" + Object.keys(res.headers).map(function (h) { return "< " + h + ": " + res.headers[h]; }).join("\n") + "\n< ");
      if (o.L && res.status >= 300 && res.status < 400 && res.headers.Location && redirects < 50) {
        redirects++;
        var nu = parseUrl(res.headers.Location.charAt(0) === "/" ? cur.scheme + "://" + cur.host + (cur.explicitPort ? ":" + cur.port : "") + res.headers.Location : res.headers.Location);
        if (o.i || o.I) out(io, headBlock(res));
        cur = nu; hostHdr = nu.host + (nu.explicitPort ? ":" + nu.port : ""); if (method !== "HEAD") method = "GET";
        continue;
      }
      break;
    }
    function headBlock(r) { return "HTTP/1.1 " + r.status + " " + (REASON[r.status] || "") + "\r\n" + Object.keys(r.headers).map(function (h) { return h + ": " + r.headers[h] + "\r\n"; }).join("") + "\r\n"; }
    if (o.f && res.status >= 400) { if (showErr) errl(io, "curl: (22) The requested URL returned error: " + res.status); return 22; }
    var body = method === "HEAD" ? "" : res.body;
    if (method === "HEAD" && res.headLen != null) res.headers["Content-Length"] = String(res.headLen);
    var hb = headBlock(res).replace(/\r\n/g, "\n");
    var outText = o.I ? hb : o.i ? hb + body : body;
    var target = o.o || (o.O ? basename(cur.path.split("?")[0]) || "index.html" : null);
    if (target) {
      var we = S.writeFile(sess, target, outText);
      if (we) { if (showErr) errl(io, "curl: (23) Failure writing output to destination"); return 23; }
    } else out(io, outText);
    if (!o.s && !o.noProgress && !stdoutTty && !o.v) { var n = bytes(outText); errl(io, "  % Total    % Received % Xferd  Average Speed   Time    Time     Time  Current\n                                 Dload  Upload   Total   Spent    Left  Speed\n" + "100 " + pad(n, 5) + "  100 " + pad(n, 5) + "    0     0  " + pad(Math.max(1, Math.round(n / 2)) + "k", 5) + "      0 --:--:-- --:--:-- --:--:-- " + pad(Math.max(1, n) + "k", 5)); }
    if (wfmt) out(io, wfmt.replace(/%\{(\w+)\}/g, function (m0, k) { return { http_code: pad(res.status, 3, "0"), response_code: res.status, size_download: bytes(body), time_total: "0.004211", remote_ip: res.ip, content_type: res.headers["Content-Type"] || "", url_effective: cur.scheme + "://" + cur.host + cur.path, num_redirects: redirects }[k]; }).replace(/\\n/g, "\n"));
    sys.actions.push("curl " + url);
    sys.httpLog = (sys.httpLog || []).concat([{ url: url, status: res.status, host: hostHdr }]);
    return 0;
  };
  CMDS.wget = function (args, io, sess) {
    var sys = sess.sys, a = args.slice(1), out1 = null, quiet = false, url = null;
    for (var i = 0; i < a.length; i++) { var x = a[i]; if (x === "-O") out1 = a[++i]; else if (/^-O./.test(x)) out1 = x.slice(2); else if (x === "-q" || x === "--quiet") quiet = true; else if (x === "-qO-" || x === "-qO") { quiet = true; out1 = x === "-qO-" ? "-" : a[++i]; } else if (/^-/.test(x)) continue; else url = x; }
    if (!url) { errl(io, "wget: missing URL\nUsage: wget [OPTION]... [URL]...\n\nTry `wget --help' for more options."); return 1; }
    var u = parseUrl(url), when = "--" + ymd(sys.now) + " " + tod(sys.now) + "--  " + (/^https?:/.test(url) ? url : "http://" + url);
    var say = function (t) { if (!quiet) errl(io, t); };
    say(when);
    var ip = resolve(sys, u.host);
    if (!ip) { say("Resolving " + u.host + " (" + u.host + ")... failed: Name or service not known."); errl(io, "wget: unable to resolve host address ‘" + u.host + "’"); return 4; }
    say("Resolving " + u.host + " (" + u.host + ")... " + ip);
    var res = httpRequest(sys, { scheme: u.scheme, host: u.host, port: u.port, path: u.path, method: "GET", headers: { host: u.host, "user-agent": "Wget/1.21.4", accept: "*/*" } });
    if (res.err) { say("Connecting to " + u.host + " (" + u.host + ")|" + ip + "|:" + u.port + "... failed: Connection refused."); return 4; }
    say("Connecting to " + u.host + " (" + u.host + ")|" + ip + "|:" + u.port + "... connected.\nHTTP request sent, awaiting response... " + res.status + " " + (REASON[res.status] || ""));
    if (res.status >= 400) { say(ymd(sys.now) + " " + tod(sys.now) + " ERROR " + res.status + ": " + (REASON[res.status] || "") + ".\n"); return 8; }
    var name = out1 || basename(u.path.split("?")[0]) || "index.html";
    if (!out1 && S.lookup(sess, name).node) { var n2 = 1; while (S.lookup(sess, name + "." + n2).node) n2++; name = name + "." + n2; }
    var len = bytes(res.body);
    say("Length: " + len + " [" + (res.headers["Content-Type"] || "text/html").split(";")[0] + "]\nSaving to: ‘" + (name === "-" ? "STDOUT" : name) + "’\n\n" + rpad(name === "-" ? "-" : name, 20) + "100%[===================>]  " + pad(len, 6) + "  --.-KB/s    in 0s      \n\n" + ymd(sys.now) + " " + tod(sys.now) + " (" + (len / 1024 / 0.004).toFixed(1) + " MB/s) - ‘" + (name === "-" ? "-" : name) + "’ saved [" + len + "/" + len + "]\n");
    if (name === "-") out(io, res.body);
    else { var we = S.writeFile(sess, name, res.body); if (we) { errl(io, name + ": " + ERR[we]); return 3; } }
    return 0;
  };

  /* ================================================================== SSH */
  var KEY_PREFIX = { ed25519: "b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAABAAAAMwAAAAtzc2gtZW", rsa: "b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAABAAABlwAAAAdzc2gtcn", ecdsa: "b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAABAAAAaAAAABNlY2RzYS" };
  var BLOB_PREFIX = { ed25519: "AAAAC3NzaC1lZDI1NTE5AAAAI", rsa: "AAAAB3NzaC1yc2EAAAADAQABAAABgQ", ecdsa: "AAAAE2VjZHNhLXNoYTItbmlzdHAyNTYAAAAIbmlzdHAyNTYAAABBB" };
  var BLOB_LEN = { ed25519: 43, rsa: 512, ecdsa: 87 };
  var TYPE_NAME = { ed25519: "ssh-ed25519", rsa: "ssh-rsa", ecdsa: "ecdsa-sha2-nistp256" };
  function keyBody(priv) { var m = /-----BEGIN OPENSSH PRIVATE KEY-----\s*([\s\S]*?)\s*-----END OPENSSH PRIVATE KEY-----/.exec(priv || ""); return m ? m[1].replace(/\s+/g, "") : null; }
  function keyType(body) { for (var t in KEY_PREFIX) if (body.indexOf(KEY_PREFIX[t]) === 0) return t; return "ed25519"; }
  function pubOfPriv(priv) { var b = keyBody(priv); if (!b) return null; var t = keyType(b); return { type: t, blob: BLOB_PREFIX[t] + hashChars("pub:" + b, BLOB_LEN[t]) }; }
  function fingerprint(blob) { return "SHA256:" + hashChars("fp:" + blob, 43); }
  function hostKey(host) { var blob = BLOB_PREFIX.ed25519 + hashChars("hostkey:" + host, 43); return { blob: blob, line: "ssh-ed25519 " + blob, fp: fingerprint(blob) }; }
  function randomart(fp, label) {
    var bytesArr = []; for (var i = 0; i < 32; i++) bytesArr.push(hash(fp, i) & 255);
    var W = 17, Hh = 9, field = []; for (var y = 0; y < Hh; y++) { field.push([]); for (var x = 0; x < W; x++) field[y].push(0); }
    var px = 8, py = 4;
    bytesArr.forEach(function (b) { for (var s = 0; s < 4; s++) { var d = (b >> (s * 2)) & 3; px += d & 1 ? 1 : -1; py += d & 2 ? 1 : -1; px = Math.max(0, Math.min(W - 1, px)); py = Math.max(0, Math.min(Hh - 1, py)); field[py][px]++; } });
    var sym = " .o+=*BOX@%&#/^";
    var rows = field.map(function (r, y) { return "|" + r.map(function (v, x) { if (x === 8 && y === 4) return "S"; if (x === px && y === py) return "E"; return sym.charAt(Math.min(v, 14)); }).join("") + "|"; });
    var top = "+" + ("--[" + label + "]--").replace(/^(.{0,17}).*$/, "$1"); while (top.length < 18) top += "-"; top += "+";
    return [top].concat(rows).concat(["+----[SHA256]-----+"]).join("\n");
  }
  M2.ssh = { pubOfPriv: pubOfPriv, fingerprint: fingerprint, hostKey: hostKey, keyBody: keyBody };
  function sshDir(sess) { return sess.home + "/.ssh"; }
  function ensureSshDir(sess, io) {
    var d = sshDir(sess), r = S.lookup(sess, d);
    if (r.node) return true;
    if (r.error !== "ENOENT" || !r.parent || !S.can(sess, r.parent, "w")) return false;
    r.parent.children[".ssh"] = S.dirNode(448, sess.uid, sess.gid, sess.sys.now);
    return "created";
  }
  CMDS["ssh-keygen"] = function (args, io, sess) {
    var sys = sess.sys, a = [], type = "ed25519", comment = null, file = null, pass = null, bits = null, op = null, host = null;
    args.slice(1).forEach(function (x) { if (/^-[a-zA-Z]{2,}$/.test(x)) x.slice(1).split("").forEach(function (c) { a.push("-" + c); }); else a.push(x); });
    for (var i = 0; i < a.length; i++) {
      var x = a[i];
      if (x === "-t") type = (a[++i] || "").toLowerCase(); else if (x === "-C") comment = a[++i]; else if (x === "-f") file = a[++i]; else if (x === "-N") pass = a[++i]; else if (x === "-b") bits = +a[++i];
      else if (x === "-l" || x === "-y" || x === "-R" || x === "-F" || x === "-p") { op = x; if (x === "-R" || x === "-F") host = a[++i]; } else if (x === "-q") continue; else if (x === "-v" || x === "-E") { if (x === "-E") i++; }
      else { errl(io, "unknown option -- " + x.replace(/^-/, "")); return 1; }
    }
    if (type === "dsa") { errl(io, "unknown key type dsa"); return 1; }
    if (!TYPE_NAME[type]) { errl(io, "unknown key type " + type); return 1; }
    function expand(p) { return p.replace(/^~(?=\/|$)/, sess.home); }
    if (op === "-l" || op === "-y") {
      var f = expand(file || sshDir(sess) + "/id_ed25519"), r = S.readFile(sess, f);
      if (r.error) { errl(io, f + ": " + ERR[r.error]); return 1; }
      var pub;
      if (/^(ssh-|ecdsa-)/.test(r.content)) { var pp = r.content.trim().split(/\s+/); pub = { type: pp[0] === "ssh-rsa" ? "rsa" : pp[0] === "ssh-ed25519" ? "ed25519" : "ecdsa", blob: pp[1], comment: pp.slice(2).join(" ") }; }
      else { pub = pubOfPriv(r.content); if (!pub) { errl(io, f + " is not a key file."); return 255; } var sib = S.readFile(sess, f + ".pub"); pub.comment = sib.error ? "no comment" : sib.content.trim().split(/\s+/).slice(2).join(" "); }
      if (op === "-y") { out(io, TYPE_NAME[pub.type] + " " + pub.blob + (pub.comment && pub.comment !== "no comment" ? " " + pub.comment : "") + "\n"); return 0; }
      out(io, (pub.type === "rsa" ? 3072 : 256) + " " + fingerprint(pub.blob) + " " + (pub.comment || "no comment") + " (" + (pub.type === "rsa" ? "RSA" : pub.type === "ed25519" ? "ED25519" : "ECDSA") + ")\n");
      return 0;
    }
    if (op === "-R" || op === "-F") {
      var kh = sshDir(sess) + "/known_hosts", kr = S.readFile(sess, kh);
      if (kr.error) { if (op === "-R") errl(io, "Cannot stat " + kh + ": No such file or directory"); return 1; }
      var ls = lines(kr.content), hits = [], keep = [];
      ls.forEach(function (l, k) { var names = (l.split(/\s+/)[0] || "").split(","); if (names.indexOf(host) >= 0) hits.push({ l: l, n: k + 1 }); else keep.push(l); });
      if (op === "-F") { hits.forEach(function (h) { out(io, "# Host " + host + " found: line " + h.n + " \n" + h.l + "\n"); }); return hits.length ? 0 : 1; }
      hits.forEach(function (h) { out(io, "# Host " + host + " found: line " + h.n + "\n"); });
      if (!hits.length) return 0;
      S.writeFile(sess, kh + ".old", kr.content); S.writeFile(sess, kh, joinLines(keep));
      out(io, kh + " updated.\nOriginal contents retained as " + kh + ".old\n");
      return 0;
    }
    if (op === "-p") { note(io, "(ssh-keygen -p changes a key's passphrase; it asks for the old and new one. The lab can't type passphrases.)"); return 0; }
    var defFile = sshDir(sess) + "/id_" + type;
    out(io, "Generating public/private " + type + " key pair.\n");
    var asked = false;
    if (!file) { out(io, "Enter file in which to save the key (" + defFile + "): \n"); asked = true; }
    var path = expand(file || defFile);
    if (!file || path.indexOf(sshDir(sess) + "/") === 0) { var cr = ensureSshDir(sess, io); if (cr === "created") out(io, "Created directory '" + sshDir(sess) + "'.\n"); }
    if (S.lookup(sess, path).node) { out(io, path + " already exists.\nOverwrite (y/n)? n\n"); note(io, "(ssh-keygen asked before overwriting your existing key; the lab answered n. Delete the old key first, or pick another file with -f, if you really want a new one.)"); return 1; }
    if (pass === null) { out(io, "Enter passphrase (empty for no passphrase): \nEnter same passphrase again: \n"); asked = true; }
    sys.keygenSeq = (sys.keygenSeq || 0) + 1;
    var seed = sys.host + "|" + path + "|" + (comment || "") + "|" + sys.keygenSeq;
    var body = KEY_PREFIX[type] + hashChars("key:" + seed, type === "rsa" ? 2400 : 340);
    var priv = "-----BEGIN OPENSSH PRIVATE KEY-----\n" + body.match(/.{1,70}/g).join("\n") + "\n-----END OPENSSH PRIVATE KEY-----\n";
    var we = S.writeFile(sess, path, priv);
    if (we) { errl(io, "Saving key \"" + path + "\" failed: " + ERR[we]); return 1; }
    S.lookup(sess, path).node.mode = 384;
    var pub2 = pubOfPriv(priv), cmt = comment !== null ? comment : sess.user + "@" + sys.host;
    S.writeFile(sess, path + ".pub", TYPE_NAME[type] + " " + pub2.blob + (cmt ? " " + cmt : "") + "\n");
    S.lookup(sess, path + ".pub").node.mode = 420;
    var fp = fingerprint(pub2.blob);
    out(io, "Your identification has been saved in " + path + "\nYour public key has been saved in " + path + ".pub\nThe key fingerprint is:\n" + fp + (cmt ? " " + cmt : "") + "\nThe key's randomart image is:\n" + randomart(fp, type === "rsa" ? "RSA " + (bits || 3072) : type === "ed25519" ? "ED25519 256" : "ECDSA 256") + "\n");
    if (asked) note(io, "(ssh-keygen asked questions; the lab pressed Enter: " + (file ? "" : "the default file, ") + "no passphrase. A passphrase protects a key if the file is ever copied; use one for keys on your laptop. To answer up front: -f FILE -N ''.)");
    sys.actions.push("ssh-keygen " + path);
    return 0;
  };
  function badPerms(sys, n, user) {
    var u = S.userByName(sys, user); if (!u || !n) return false;
    if (n.uid !== u.uid && n.uid !== 0) return true;
    if (n.mode & 2) return true;
    if (n.mode & 16) { var g = S.groupById(sys, n.gid); var privateGroup = n.gid === u.gid && g && g.name === u.name && (!g.members || !g.members.filter(function (x) { return x && x !== u.name; }).length); if (!privateGroup) return true; }
    return false;
  }
  M2.ssh.badPerms = badPerms;
  function parseSshConfig(sess, io) {
    var p = sshDir(sess) + "/config", r = S.lookup(sess, p);
    if (!r.node) return { blocks: [] };
    if (badPerms(sess.sys, r.node, sess.user)) return { bad: "Bad owner or permissions on " + p };
    var blocks = [{ pats: ["*"], opts: {} }], cur = blocks[0];
    lines(r.node.content).forEach(function (l) {
      l = l.replace(/#.*/, "").trim(); if (!l) return;
      var m = /^(\S+)\s*(?:=\s*|\s+)(.*)$/.exec(l); if (!m) return;
      var k = m[1].toLowerCase(), v = m[2].trim().replace(/^"(.*)"$/, "$1");
      if (k === "host") { cur = { pats: v.split(/\s+/), opts: {} }; blocks.push(cur); return; }
      if (k === "identityfile") (cur.opts.identityfile = cur.opts.identityfile || []).push(v); else if (cur.opts[k] === undefined) cur.opts[k] = v;
    });
    return { blocks: blocks, path: p };
  }
  function sshOptsFor(cfg, alias, cli) {
    var o = Object.assign({}, cli);
    (cfg.blocks || []).forEach(function (b) {
      var hit = b.pats.some(function (p) { var neg = p.charAt(0) === "!"; return !neg && S.globMatch(p, alias); }) && !b.pats.some(function (p) { return p.charAt(0) === "!" && S.globMatch(p.slice(1), alias); });
      if (!hit) return;
      Object.keys(b.opts).forEach(function (k) { if (k === "identityfile") o.identityfile = (o.identityfile || []).concat(b.opts.identityfile); else if (o[k] === undefined) o[k] = b.opts[k]; });
    });
    return o;
  }
  function knownHostsCheck(sess, io, hostName, port, m, o) {
    var kh = sshDir(sess) + "/known_hosts", name = port === 22 ? hostName : "[" + hostName + "]:" + port, hk = hostKey(m.host);
    var r = S.readFile(sess, kh), entries = r.error ? [] : lines(r.content).map(function (l) { var f = l.trim().split(/\s+/); return { names: (f[0] || "").split(","), key: f[2] }; });
    var match = entries.filter(function (e) { return e.names.indexOf(name) >= 0; });
    if (match.length) {
      if (match.some(function (e) { return e.key === hk.blob; })) { if (o.verbose) errl(io, "debug1: Host '" + name + "' is known and matches the ED25519 host key."); return true; }
      errl(io, "@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@\n@    WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED!     @\n@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@\nIT IS POSSIBLE THAT SOMEONE IS DOING SOMETHING NASTY!\nSomeone could be eavesdropping on you right now (man-in-the-middle attack)!\nIt is also possible that a host key has just been changed.\nThe fingerprint for the ED25519 key sent by the remote host is\n" + hk.fp + ".\nPlease contact your system administrator.\nAdd correct host key in " + kh + " to get rid of this message.\nOffending ED25519 key in " + kh + ":1\nHost key for " + name + " has changed and you have requested strict checking.\nHost key verification failed.");
      return false;
    }
    var strict = String(o.stricthostkeychecking || "ask").toLowerCase(), batch = /^yes$/i.test(o.batchmode || "");
    if (strict === "yes" || (batch && strict === "ask")) { errl(io, "No ED25519 host key is known for " + name + " and you have requested strict checking.\nHost key verification failed."); return false; }
    if (strict === "ask") {
      errl(io, "The authenticity of host '" + name + " (" + m.ip + ")' can't be established.\nED25519 key fingerprint is " + hk.fp + ".\nThis key is not known by any other names.\nAre you sure you want to continue connecting (yes/no/[fingerprint])? yes");
      note(io, "(ssh asked whether to trust this server's key; the lab answered yes. On a real first connection, compare the fingerprint with one the server's admin gave you: it's what stops someone impersonating the server.)");
    }
    if (ensureSshDir(sess, io) === false) return true;
    var we = S.writeFile(sess, kh, name + " " + hk.line + "\n", true);
    if (!we) { var kn = S.lookup(sess, kh).node; if (kn && entries.length === 0 && r.error) kn.mode = 420; }
    errl(io, "Warning: Permanently added '" + name + "' (ED25519) to the list of known hosts.");
    return true;
  }
  function authorizedKeys(m, user) {
    var u = S.userByName(m, user); if (!u) return { keys: [], bad: false };
    var rv = M2.rootView(m), d = S.lookup(rv, u.home), sd = S.lookup(rv, u.home + "/.ssh"), f = S.lookup(rv, u.home + "/.ssh/authorized_keys");
    var bad = null;
    [[d, u.home], [sd, u.home + "/.ssh"], [f, u.home + "/.ssh/authorized_keys"]].forEach(function (x) { var n = x[0].node; if (!n || bad) return; if (badPerms(m, n, user)) bad = x[1]; });
    var keys = f.node && f.node.type === "f" ? lines(f.node.content).map(function (l) { var mm = /(ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp256)\s+(\S+)/.exec(l); return mm ? mm[2] : null; }).filter(Boolean) : [];
    return { keys: keys, bad: bad, home: u.home, uid: u.uid, gid: u.gid };
  }
  function identities(sess, io, o) {
    var files = (o.identityfile || []).map(function (p) { return p.replace(/^~(?=\/)/, sess.home).replace(/%d/g, sess.home).replace(/%u/g, sess.user); });
    var explicit = files.length > 0;
    if (!files.length || !/^yes$/i.test(o.identitiesonly || "")) ["id_rsa", "id_ecdsa", "id_ed25519"].forEach(function (n) { var p = sshDir(sess) + "/" + n; if (files.indexOf(p) < 0) files.push(p); });
    var ids = [];
    files.forEach(function (p, idx) {
      var r = S.lookup(sess, p);
      if (!r.node) { if (idx < (o.identityfile || []).length) errl(io, "Warning: Identity file " + p + " not accessible: No such file or directory."); return; }
      if (r.node.mode & 63) { errl(io, "@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@\n@         WARNING: UNPROTECTED PRIVATE KEY FILE!          @\n@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@\nPermissions 0" + (r.node.mode & 511).toString(8) + " for '" + p + "' are too open.\nIt is required that your private key files are NOT accessible by others.\nThis private key will be ignored.\nLoad key \"" + p + "\": bad permissions"); return; }
      if (!S.can(sess, r.node, "r")) return;
      var pub = pubOfPriv(r.node.content); if (pub) ids.push({ path: p, pub: pub });
    });
    return ids;
  }
  // Connect and log in. Returns {ok, m, user, method} or {ok:false, code}
  function sshConnect(sess, target, cli, io, purpose) {
    var sys = sess.sys, cfg = parseSshConfig(sess, io);
    if (cfg.bad) { errl(io, cfg.bad); return { ok: false, code: 255 }; }
    var mm = /^(?:([^@]+)@)?(.+)$/.exec(target), alias = mm[2];
    var o = sshOptsFor(cfg, alias, cli);
    var user = mm[1] || o.user || sess.user, hostName = o.hostname || alias, port = +(o.port || 22);
    if (o.verbose) { errl(io, "OpenSSH_9.6p1 Ubuntu-3ubuntu13.5, OpenSSL 3.0.13 30 Jan 2024"); if (cfg.path) errl(io, "debug1: Reading configuration data " + cfg.path); errl(io, "debug1: Reading configuration data /etc/ssh/ssh_config"); }
    var ip = resolve(sys, hostName);
    if (!ip) { errl(io, "ssh: Could not resolve hostname " + hostName.toLowerCase() + ": " + (hostName.indexOf(".") < 0 ? "Temporary failure in name resolution" : "Name or service not known")); return { ok: false, code: 255 }; }
    if (o.verbose) errl(io, "debug1: Connecting to " + hostName + " [" + ip + "] port " + port + ".");
    var conn = tcpConnect(sys, ip, port);
    if (conn.timeout) { errl(io, "ssh: connect to host " + hostName + " port " + port + ": Connection timed out"); return { ok: false, code: 255 }; }
    if (conn.refused) { errl(io, "ssh: connect to host " + hostName + " port " + port + ": Connection refused"); return { ok: false, code: 255 }; }
    var m = conn.self ? sys : conn.remote;
    if (!m) { errl(io, "kex_exchange_identification: Connection closed by remote host\nConnection closed by " + ip + " port " + port); return { ok: false, code: 255 }; }
    if (o.verbose) { errl(io, "debug1: Connection established.\ndebug1: Remote protocol version 2.0, remote software version OpenSSH_9.6p1 Ubuntu-3ubuntu13.5\ndebug1: Server host key: ssh-ed25519 " + hostKey(m.host).fp); }
    if (!knownHostsCheck(sess, io, hostName, port, m, o)) return { ok: false, code: 255 };
    var sc = m.sshdLive || sshdConf(m), methods = (sc.pubkeyauthentication !== "no" ? ["publickey"] : []).concat(sc.passwordauthentication === "yes" ? ["password"] : []);
    var ak = authorizedKeys(m, user), u = S.userByName(m, user);
    var allowed = u && (!sc.allowusers || sc.allowusers.indexOf(user) >= 0) && !(user === "root" && sc.permitrootlogin === "no");
    var ids = identities(sess, io, o);
    if (o.verbose) errl(io, "debug1: Authentications that can continue: " + methods.join(","));
    var hit = null;
    if (allowed && methods.indexOf("publickey") >= 0 && !ak.bad) ids.some(function (id) { if (o.verbose) errl(io, "debug1: Offering public key: " + id.path + " " + id.pub.type.toUpperCase() + " " + fingerprint(id.pub.blob)); if (ak.keys.indexOf(id.pub.blob) >= 0) { hit = id; return true; } return false; });
    var rlog = function (t) { writeRoot(m, "/var/log/auth.log", "2026-11-11T" + tod(sys.now) + ".000000+00:00 " + m.host + " sshd[" + (m.nextPid++) + "]: " + t + "\n", true); };
    var srcPort = 40000 + (hash(target + (sys.sshSeq = (sys.sshSeq || 0) + 1)) % 20000);
    if (ak.bad && allowed && ids.length) rlog("Authentication refused: bad ownership or modes for " + (/authorized_keys$/.test(ak.bad) ? "file " : "directory ") + ak.bad);
    var method = null;
    if (hit) { method = "publickey"; if (o.verbose) errl(io, "debug1: Server accepts key: " + hit.path + " " + hit.pub.type.toUpperCase() + " " + fingerprint(hit.pub.blob)); rlog("Accepted publickey for " + user + " from " + myIp(sys) + " port " + srcPort + " ssh2: " + hit.pub.type.toUpperCase() + " " + fingerprint(hit.pub.blob)); }
    else if (methods.indexOf("password") >= 0 && !/^yes$/i.test(o.batchmode || "") && !/^no$/i.test(o.passwordauthentication || "") && purpose !== "probe") {
      errl(io, user + "@" + hostName + "'s password: ");
      if (allowed && (m.knownPasswords || {})[user]) { note(io, "(The lab typed the " + user + " password the ticket gave you.)"); method = "password"; rlog("Accepted password for " + user + " from " + myIp(sys) + " port " + srcPort + " ssh2"); }
      else { note(io, "(The lab doesn't know the password for " + user + "@" + hostName + ". Key login avoids passwords: make a key with ssh-keygen, then install it on the server with ssh-copy-id.)"); rlog("Failed password for " + (u ? "" : "invalid user ") + user + " from " + myIp(sys) + " port " + srcPort + " ssh2"); errl(io, user + "@" + hostName + ": Permission denied (" + methods.join(",") + ")."); return { ok: false, code: 255, m: m, user: user, hostName: hostName }; }
    }
    if (!method) { if (purpose !== "probe") errl(io, user + "@" + hostName + ": Permission denied (" + methods.join(",") + ")."); return { ok: false, code: 255, m: m, user: user, hostName: hostName, passwordOk: methods.indexOf("password") >= 0 }; }
    if (o.verbose) errl(io, "Authenticated to " + hostName + " ([" + ip + "]:" + port + ") using \"" + method + "\".");
    sys.sshLog = (sys.sshLog || []).concat([{ host: m.host, user: user, method: method, alias: alias, purpose: purpose || "ssh" }]);
    return { ok: true, m: m, user: user, method: method, hostName: hostName, ip: ip, port: port, opts: o };
  }
  M2.sshConnect = sshConnect;
  function remoteShell(c) { var rs = S.newSession(c.m, { user: c.user }); S.login(rs); return rs; }
  function runRemote(rs, cmd, io) {
    var code;
    try { code = S.runSource(rs, cmd, io); }
    catch (e) { if (e instanceof S.ExitSignalCls) code = e.code; else if (e instanceof ShError) { io.err(e.message + "\n"); code = e.code; } else if (e instanceof S.ParseError) { io.err(e.message + "\n"); code = 2; } else throw e; }
    return code || 0;
  }
  CMDS.ssh = function (args, io, sess) {
    var a = args.slice(1), cli = {}, target = null, cmd = [];
    for (var i = 0; i < a.length; i++) {
      var x = a[i];
      if (target !== null) { cmd = a.slice(i); break; }
      if (x === "-i") (cli.identityfile = cli.identityfile || []).push(a[++i]); else if (x === "-p") cli.port = a[++i]; else if (x === "-l") cli.user = a[++i];
      else if (x === "-o") { var m = /^(\w+)\s*[= ]\s*(.*)$/.exec(a[++i] || ""); if (m) cli[m[1].toLowerCase()] = m[2]; } else if (/^-o./.test(x)) { var m2 = /^-o(\w+)\s*[= ]\s*(.*)$/.exec(x); if (m2) cli[m2[1].toLowerCase()] = m2[2]; }
      else if (x === "-v" || x === "-vv" || x === "-vvv") cli.verbose = true; else if (/^-[TtqNACXx46]+$/.test(x)) continue; else if (x === "-F" || x === "-J" || x === "-L" || x === "-R" || x === "-D") i++;
      else if (x === "-V") { errl(io, "OpenSSH_9.6p1 Ubuntu-3ubuntu13.5, OpenSSL 3.0.13 30 Jan 2024"); return 0; }
      else if (/^-/.test(x)) { errl(io, "unknown option -- " + x.slice(1) + "\nusage: ssh [-46AaCfGgKkMNnqsTtVvXxYy] [-B bind_interface] [-b bind_address]\n           [-c cipher_spec] [-D [bind_address:]port] [-E log_file]\n           [-e escape_char] [-F configfile] [-I pkcs11] [-i identity_file]\n           [-J destination] [-L address] [-l login_name] [-m mac_spec]\n           [-O ctl_cmd] [-o option] [-P tag] [-p port] [-R address]\n           [-S ctl_path] [-W host:port] [-w local_tun[:remote_tun]]\n           destination [command [argument ...]]"); return 255; }
      else target = x;
    }
    if (!target) { errl(io, "usage: ssh [-46AaCfGgKkMNnqsTtVvXxYy] [-B bind_interface] [-b bind_address]\n           [-c cipher_spec] [-D [bind_address:]port] [-E log_file]\n           [-e escape_char] [-F configfile] [-I pkcs11] [-i identity_file]\n           [-J destination] [-L address] [-l login_name] [-m mac_spec]\n           [-O ctl_cmd] [-o option] [-P tag] [-p port] [-R address]\n           [-S ctl_path] [-W host:port] [-w local_tun[:remote_tun]]\n           destination [command [argument ...]]"); return 255; }
    var c = sshConnect(sess, target, cli, io, "ssh");
    if (!c.ok) return c.code;
    var rs = remoteShell(c);
    if (cmd.length) return runRemote(rs, cmd.join(" "), Object.assign({}, io, { note: io.note }));
    out(io, "Welcome to Ubuntu 24.04.1 LTS (GNU/Linux 6.8.0-48-generic x86_64)\n\n * Documentation:  https://help.ubuntu.com\n * Management:     https://landscape.canonical.com\n\nLast login: Tue Nov 10 17:42:10 2026 from 10.20.0.15\n");
    var top = sess.sys.topSession || sess;
    top.userStack.push({ shell: rs, exitMsg: "logout\nConnection to " + c.hostName + " closed.\n" });
    note(io, "(You're now logged in to " + c.m.host + ". Commands run there until you type exit.)");
    return 0;
  };
  CMDS["ssh-copy-id"] = function (args, io, sess) {
    var a = args.slice(1), cli = {}, idFile = null, target = null, force = false;
    for (var i = 0; i < a.length; i++) { var x = a[i]; if (x === "-i") idFile = a[++i]; else if (/^-i./.test(x)) idFile = x.slice(2); else if (x === "-p") cli.port = a[++i]; else if (x === "-o") { var m = /^(\w+)\s*[= ]\s*(.*)$/.exec(a[++i] || ""); if (m) cli[m[1].toLowerCase()] = m[2]; } else if (x === "-f") force = true; else if (x === "-n") continue; else target = x; }
    var P = "/usr/bin/ssh-copy-id: ";
    if (!target) { errl(io, "Usage: /usr/bin/ssh-copy-id [-h|-?|-f|-n|-s|-x] [-i [identity_file]] [-p port] [-F alternative ssh_config file] [-t target_path] [[-o <ssh -o options>] ...] [user@]hostname"); return 1; }
    var pubPath;
    if (idFile) pubPath = idFile.replace(/^~(?=\/)/, sess.home).replace(/(\.pub)?$/, ".pub");
    else { var d = S.lookup(sess, sshDir(sess)); var cands = d.node && d.node.type === "d" ? Object.keys(d.node.children).filter(function (k) { return /^id_.*\.pub$/.test(k); }).sort(function (x, y) { return d.node.children[y].mtime - d.node.children[x].mtime || (x < y ? 1 : -1); }) : []; pubPath = cands.length ? sshDir(sess) + "/" + cands[0] : null; }
    var pr = pubPath ? S.readFile(sess, pubPath) : { error: "ENOENT" };
    if (!pubPath || pr.error) { errl(io, P + "ERROR: " + (pubPath ? "failed to open ID file '" + pubPath.replace(/\.pub$/, "") + "': No such file or directory" : "No identities found")); return 1; }
    var pf = pr.content.trim().split(/\s+/);
    errl(io, P + "INFO: Source of key(s) to be installed: \"" + pubPath + "\"");
    errl(io, P + "INFO: attempting to log in with the new key(s), to filter out any that are already installed");
    var probe = sshConnect(sess, target, Object.assign({}, cli, { passwordauthentication: "no" }), io, "probe");
    if (!probe.m) return probe.code || 1;
    var ak = authorizedKeys(probe.m, probe.user);
    if (ak.keys.indexOf(pf[1]) >= 0 && !force) { errl(io, "\n" + P + "WARNING: All keys were skipped because they already exist on the remote system.\n\t\t(if you think this is a mistake, you may want to use -f option)\n"); return 0; }
    errl(io, P + "INFO: 1 key(s) remain to be installed -- if you are prompted now it is to install the new keys");
    // a real host-key prompt, then the password
    var cfg = parseSshConfig(sess, io), alias = /^(?:[^@]+@)?(.+)$/.exec(target)[1], o = sshOptsFor(cfg, alias, cli), hostName = o.hostname || alias;
    var m = probe.m, user = probe.user, sc = m.sshdLive || sshdConf(m);
    if (!knownHostsCheck(sess, { err: function () {}, out: function () {} }, hostName, +(o.port || 22), m, o)) { errl(io, "Host key verification failed."); return 1; }
    if (sc.passwordauthentication !== "yes") { errl(io, user + "@" + hostName + ": Permission denied (publickey)."); return 1; }
    errl(io, user + "@" + hostName + "'s password: ");
    if (!(m.knownPasswords || {})[user]) { note(io, "(The lab doesn't know the password for " + user + "@" + hostName + ".)"); errl(io, user + "@" + hostName + ": Permission denied (publickey,password)."); return 1; }
    note(io, "(The lab typed the " + user + " password the ticket gave you. You need it only this once: after this, the key logs you in.)");
    var u = S.userByName(m, user), rv = M2.rootView(m);
    var sd = S.lookup(rv, u.home + "/.ssh");
    if (!sd.node) { var hd = S.lookup(rv, u.home).node; hd.children[".ssh"] = S.dirNode(448, u.uid, u.gid, sess.sys.now); }
    var f = S.lookup(rv, u.home + "/.ssh/authorized_keys");
    if (!f.node) { S.lookup(rv, u.home + "/.ssh").node.children.authorized_keys = S.fileNode("", 384, u.uid, u.gid, sess.sys.now); f = S.lookup(rv, u.home + "/.ssh/authorized_keys"); }
    f.node.content += (f.node.content && !/\n$/.test(f.node.content) ? "\n" : "") + pr.content.trim() + "\n";
    writeRoot(m, "/var/log/auth.log", "2026-11-11T" + tod(sess.sys.now) + ".000000+00:00 " + m.host + " sshd[" + (m.nextPid++) + "]: Accepted password for " + user + " from " + myIp(sess.sys) + " port 51830 ssh2\n", true);
    out(io, "\nNumber of key(s) added: 1\n\nNow try logging into the machine, with:   \"ssh '" + target + "'\"\nand check to make sure that only the key(s) you wanted were added.\n\n");
    sess.sys.actions.push("ssh-copy-id " + target);
    return 0;
  };
  CMDS.sftp = function (args, io) { note(io, "(sftp opens an interactive file-transfer prompt (ls, get, put, bye). In this lab use scp or rsync, which do the same in one command.)"); return 0; };
  CMDS["ssh-keyscan"] = function (args, io, sess) {
    var hosts = args.slice(1).filter(function (x) { return !/^-/.test(x) && !/^(rsa|ed25519|ecdsa)$/.test(x); }), code = 0;
    hosts.forEach(function (h) { var ip = resolve(sess.sys, h); var m = ip && machineByIp(sess.sys, ip); if (!m) { code = 1; return; } errl(io, "# " + h + ":22 SSH-2.0-OpenSSH_9.6p1 Ubuntu-3ubuntu13.5"); out(io, h + " " + hostKey(m.host).line + "\n"); });
    return code;
  };

  /* ---------------- copying between machines: scp and rsync */
  function splitRemote(spec) { var m = /^(?:([^@/:]+)@)?([^:/]+):(.*)$/.exec(spec); if (!m || /^\.?\.?\//.test(spec)) return null; return { user: m[1], host: m[2], path: m[3] }; }
  function endpoint(sess, spec, cli, io, purpose) {
    var r = splitRemote(spec);
    if (!r) return { sess: sess, path: spec, local: true, shown: spec };
    var c = sshConnect(sess, (r.user ? r.user + "@" : "") + r.host, Object.assign({ batchmode: "no" }, cli), io, purpose);
    if (!c.ok) return { fail: c };
    var rs = S.newSession(c.m, { user: c.user });
    var p = r.path === "" ? rs.home : r.path.replace(/^~(?=\/|$)/, rs.home);
    return { sess: rs, path: p.charAt(0) === "/" ? p : rs.home + "/" + p, local: false, shown: spec, host: r.host };
  }
  function copyNodeTo(srcSess, srcNode, dstSess, dstPath, o, created) {
    var sys = dstSess.sys;
    if (srcNode.type === "d") {
      var r = S.lookup(dstSess, dstPath);
      if (!r.node) {
        if (r.error !== "ENOENT" || !r.parent || !S.can(dstSess, r.parent, "w")) return "mkdir \"" + dstPath + "\" failed: Permission denied (13)";
        r.parent.children[r.name] = S.dirNode(o.perms ? srcNode.mode & 4095 : srcNode.mode & ~dstSess.umask & 4095, dstSess.uid, dstSess.gid, o.times ? srcNode.mtime : sys.now);
        if (created) created.push(dstPath);
      }
      return null;
    }
    if (srcNode.type === "l") { var lr = S.lookup(dstSess, dstPath, { nofollow: true }); if (lr.parent) lr.parent.children[lr.name] = S.linkNode(srcNode.target, dstSess.uid, dstSess.gid); return null; }
    var we = S.writeFile(dstSess, dstPath, srcNode.content);
    if (we) return "open \"" + dstPath + "\" failed: " + ERR[we] + " (" + (we === "EACCES" ? 13 : 2) + ")";
    var n = S.lookup(dstSess, dstPath).node;
    if (srcNode.size != null) n.size = srcNode.size; else delete n.size;
    n.mode = o.perms ? srcNode.mode & 4095 : (n.mode & 4095);
    n.mtime = o.times ? srcNode.mtime : sys.now;
    if (o.owner && dstSess.uid === 0) { n.uid = srcNode.uid; n.gid = srcNode.gid; }
    return null;
  }
  CMDS.scp = function (args, io, sess) {
    var a = args.slice(1), rec = false, preserve = false, quiet = false, cli = {}, rest = [];
    for (var i = 0; i < a.length; i++) { var x = a[i]; if (x === "-P") cli.port = a[++i]; else if (x === "-i") (cli.identityfile = cli.identityfile || []).push(a[++i]); else if (x === "-o") { var m = /^(\w+)\s*[= ]\s*(.*)$/.exec(a[++i] || ""); if (m) cli[m[1].toLowerCase()] = m[2]; } else if (/^-[rpqvCO346]+$/.test(x)) { if (x.indexOf("r") >= 0) rec = true; if (x.indexOf("p") >= 0) preserve = true; if (x.indexOf("q") >= 0) quiet = true; } else rest.push(x); }
    if (rest.length < 2) { errl(io, "usage: scp [-346ABCOpqRrsTv] [-c cipher] [-D sftp_server_path] [-F ssh_config]\n           [-i identity_file] [-J destination] [-l limit] [-o ssh_option]\n           [-P port] [-S program] [-X sftp_option] source ... target"); return 1; }
    var dstSpec = rest.pop(), dst = endpoint(sess, dstSpec, cli, io, "scp");
    if (dst.fail) return dst.fail.code === 255 ? 255 : 1;
    var code = 0;
    rest.forEach(function (s) {
      var src = endpoint(sess, s, cli, io, "scp");
      if (src.fail) { code = 255; return; }
      var r = S.lookup(src.sess, src.path);
      if (!r.node) { errl(io, "scp: " + (src.local ? "stat local \"" + src.path + "\": No such file or directory" : src.path + ": No such file or directory")); code = 1; return; }
      if (r.node.type === "d" && !rec) { errl(io, "scp: " + (src.local ? "local \"" + src.path + "\" is not a regular file" : src.path + ": not a regular file")); errl(io, "scp: failed to upload directory " + src.path + " to " + dst.path); code = 1; return; }
      var dr = S.lookup(dst.sess, dst.path), target = dr.node && dr.node.type === "d" ? dst.path.replace(/\/$/, "") + "/" + basename(src.path) : dst.path.replace(/\/$/, "");
      if (!dr.node && /\/$/.test(dst.path)) { errl(io, "scp: dest open \"" + dst.path + "\": No such file or directory"); code = 1; return; }
      (function walk(n, from, to, rel) {
        if (n.type !== "d" && !S.can(src.sess, n, "r")) { errl(io, "scp: open local \"" + from + "\": Permission denied"); code = 1; return; }
        var e = copyNodeTo(src.sess, n, dst.sess, to, { perms: preserve, times: preserve });
        if (e) { errl(io, "scp: dest open \"" + to + "\": " + (/Permission/.test(e) ? "Permission denied" : "No such file or directory")); errl(io, "scp: failed to upload " + (n.type === "d" ? "directory " : "file ") + from + " to " + to); code = 1; return; }
        if (n.type === "d") Object.keys(n.children).sort(S.sortNames).forEach(function (k) { walk(n.children[k], from.replace(/\/$/, "") + "/" + k, to + "/" + k, k); });
        else if (!quiet && io.tty) { var sz = U.nodeSize(n); out(io, rpad(basename(from), 48) + " 100% " + pad(sz >= 1048576 ? (sz / 1048576).toFixed(0) + "MB" : sz >= 1024 ? Math.round(sz / 1024) + "KB" : sz, 6) + " " + pad((sz / 1048576 / 0.05 > 1 ? (sz / 1048576 / 0.05).toFixed(1) + "MB/s" : (sz / 1024 / 0.05).toFixed(1) + "KB/s"), 9) + "   00:00    \n"); }
      })(r.node, src.path, target);
    });
    if (!code) sess.sys.actions.push("scp " + rest.join(" ") + " " + dstSpec);
    return code;
  };
  CMDS.rsync = function (args, io, sess) {
    var a = args.slice(1), o = { excludes: [] }, cli = {}, rest = [];
    for (var i = 0; i < a.length; i++) {
      var x = a[i], m;
      if (/^--/.test(x)) {
        if (x === "--archive") o.a = true; else if (x === "--verbose") o.v = true; else if (x === "--recursive") o.r = true; else if (x === "--delete" || x === "--delete-after" || x === "--delete-before") o.del = true; else if (x === "--dry-run") o.n = true; else if (x === "--human-readable") o.h = true; else if (x === "--progress" || x === "-P") o.progress = true; else if (x === "--compress") continue; else if (x === "--times") o.t = true; else if (x === "--perms") o.p = true; else if (x === "--stats") o.stats = true; else if (x === "--itemize-changes") o.i = true;
        else if ((m = /^--exclude=(.*)$/.exec(x))) o.excludes.push(m[1]); else if (x === "--exclude") o.excludes.push(a[++i]); else if ((m = /^--rsh=(.*)$/.exec(x))) continue; else if (x === "--partial" || x === "--checksum" || x === "--info=progress2" || x === "--mkpath") { if (x === "--mkpath") o.mkpath = true; }
        else { errl(io, "rsync: --" + x.slice(2).split("=")[0] + ": unknown option\nrsync error: syntax or usage error (code 1) at main.c(1795) [client=3.2.7]"); return 1; }
        continue;
      }
      if (x === "-e") { i++; continue; }
      if (/^-[a-zA-Z]+$/.test(x)) { x.slice(1).split("").forEach(function (c) { if (c === "a") o.a = true; else if (c === "v") o.v = true; else if (c === "r") o.r = true; else if (c === "n") o.n = true; else if (c === "h") o.h = true; else if (c === "z" || c === "u" || c === "c" || c === "q") { if (c === "q") o.q = true; } else if (c === "t") o.t = true; else if (c === "p") o.p = true; else if (c === "l") o.l = true; else if (c === "P") o.progress = true; else if (c === "i") o.i = true; }); continue; }
      rest.push(x);
    }
    if (rest.length < 2) { errl(io, "rsync  version 3.2.7  protocol version 31\nUsage: rsync [OPTION]... SRC [SRC]... DEST\n  or   rsync [OPTION]... SRC [SRC]... [USER@]HOST:DEST\n  or   rsync [OPTION]... [USER@]HOST:SRC [DEST]"); return 1; }
    var rec = o.a || o.r, perms = o.a || o.p, times = o.a || o.t;
    var dstSpec = rest.pop();
    var dst = endpoint(sess, dstSpec, cli, io, "rsync");
    if (dst.fail) { errl(io, "rsync: connection unexpectedly closed (0 bytes received so far) [sender]\nrsync error: unexplained error (code 255) at io.c(232) [sender=3.2.7]"); return 255; }
    var code = 0, listed = [], deleted = [], totalSize = 0, sent = 0, xfers = 0;
    if (o.v) out(io, "sending incremental file list\n");
    function excluded(rel) { var b = basename(rel); return o.excludes.some(function (p) { p = p.replace(/\/$/, ""); return S.globMatch(p, b) || S.globMatch(p, rel.replace(/\/$/, "")) || S.globMatch(p.replace(/^\//, ""), rel.replace(/\/$/, "")); }); }
    rest.forEach(function (s) {
      var src = endpoint(sess, s, cli, io, "rsync");
      if (src.fail) { code = 255; return; }
      var r = S.lookup(src.sess, src.path);
      if (!r.node) { errl(io, "rsync: [sender] link_stat \"" + S.absPath(src.sess, src.path) + "\" failed: No such file or directory (2)"); code = 23; return; }
      if (r.node.type === "d" && !rec) { out(io, "skipping directory " + basename(src.path) + "\n"); return; }
      var contents = /\/$/.test(s) || /\/\.$/.test(s), dr = S.lookup(dst.sess, dst.path);
      var base;
      if (r.node.type === "d") base = contents ? dst.path.replace(/\/$/, "") : dst.path.replace(/\/$/, "") + "/" + basename(src.path);
      else base = dr.node && dr.node.type === "d" ? dst.path.replace(/\/$/, "") + "/" + basename(src.path) : dst.path;
      // destination parent must exist (rsync creates only the last level)
      var parentOf = function (p) { return p.slice(0, p.lastIndexOf("/")) || "/"; };
      if (r.node.type === "d" && !dr.node) {
        var pr2 = S.lookup(dst.sess, parentOf(dst.path.replace(/\/$/, "")));
        if (!pr2.node && !o.mkpath) { errl(io, "rsync: [Receiver] mkdir \"" + S.absPath(dst.sess, dst.path) + "\" failed: No such file or directory (2)\nrsync error: error in file IO (code 11) at main.c(791) [Receiver=3.2.7]"); code = 11; return; }
        if (!o.n) { var e0 = copyNodeTo(src.sess, { type: "d", mode: 509, mtime: dst.sess.sys.now }, dst.sess, dst.path.replace(/\/$/, ""), { perms: false, times: false }); if (e0) { errl(io, "rsync: [Receiver] " + e0); code = 23; return; } }
        listed.push("created directory " + dst.path.replace(/\/$/, ""));
        if (contents && o.n) listed.push("./");
      }
      var seen = {};
      (function walk(n, from, to, rel) {
        if (rel && excluded(rel)) return;
        if (n.type === "d") {
          seen[to] = true;
          if (!S.can(src.sess, n, "r") || !S.can(src.sess, n, "x")) { errl(io, "rsync: [sender] opendir \"" + from + "\" failed: Permission denied (13)"); code = 23; return; }
          var ex = S.lookup(dst.sess, to);
          var isRootContents = rel === "";
          if (!ex.node) { if (!o.n) { var e = copyNodeTo(src.sess, n, dst.sess, to, { perms: perms, times: times }); if (e) { errl(io, "rsync: [Receiver] " + e); code = 23; return; } } listed.push((isRootContents ? "./" : rel.replace(/\/?$/, "/"))); }
          else if (ex.node.type === "d" && ((perms && (ex.node.mode & 4095) !== (n.mode & 4095)) || (times && ex.node.mtime !== n.mtime))) { if (!o.n) { if (perms) ex.node.mode = n.mode & 4095; if (times) ex.node.mtime = n.mtime; } listed.push(isRootContents ? "./" : rel.replace(/\/?$/, "/")); }
          if (o.del && ex.node && ex.node.type === "d") {
            Object.keys(ex.node.children).sort().forEach(function (k) {
              if (n.children[k]) return;
              var drel = (rel ? rel.replace(/\/$/, "") + "/" : "") + k;
              if (excluded(drel)) return;
              deleted.push("deleting " + drel + (ex.node.children[k].type === "d" ? "/" : ""));
              if (!o.n) { if (!S.can(dst.sess, ex.node, "w")) { errl(io, "rsync: [generator] delete_file: unlink(" + drel + ") failed: Permission denied (13)"); code = 23; return; } delete ex.node.children[k]; }
            });
          }
          Object.keys(n.children).sort(S.sortNames).forEach(function (k) { walk(n.children[k], from.replace(/\/$/, "") + "/" + k, to + "/" + k, (rel ? rel.replace(/\/$/, "") + "/" : "") + k); });
          return;
        }
        if (n.type === "l" && !(o.a || o.l)) { out(io, "skipping non-regular file \"" + rel + "\"\n"); return; }
        var sz = U.nodeSize(n); totalSize += sz;
        if (!S.can(src.sess, n, "r")) { errl(io, "rsync: [sender] send_files failed to open \"" + from + "\": Permission denied (13)"); code = 23; return; }
        var dn = S.lookup(dst.sess, to).node;
        var same = dn && dn.type === n.type && U.nodeSize(dn) === sz && dn.mtime === n.mtime;
        if (same) return;
        if (!o.n) { var e2 = copyNodeTo(src.sess, n, dst.sess, to, { perms: perms, times: times, owner: o.a }); if (e2) { errl(io, "rsync: [receiver] mkstemp \"" + to + "\" failed: Permission denied (13)"); code = 23; return; } }
        listed.push(rel || basename(from)); sent += sz; xfers++;
      })(r.node, src.path, base, r.node.type === "d" ? "" : "");
    });
    if (o.v) {
      out(io, joinLines(deleted.concat(listed)));
      var sentB = sent + 60 * listed.length + 90, recvB = 19 + 12 * listed.length, fmt = function (v) { return o.h ? (v >= 1048576 ? (v / 1048576).toFixed(2) + "M" : v >= 1024 ? (v / 1024).toFixed(2) + "K" : String(v)) : commaNum(v); };
      out(io, "\nsent " + fmt(sentB) + " bytes  received " + fmt(recvB) + " bytes  " + (o.h ? fmt(Math.round((sentB + recvB) * 2)) : commaNum(((sentB + recvB) * 2).toFixed(2))) + " bytes/sec\ntotal size is " + fmt(totalSize) + "  speedup is " + (totalSize / (sentB + recvB)).toFixed(2) + (o.n ? " (DRY RUN)" : "") + "\n");
    }
    if (code === 23) errl(io, "rsync error: some files/attrs were not transferred (see previous errors) (code 23) at main.c(1338) [sender=3.2.7]");
    if (!code && !o.n) sess.sys.actions.push("rsync " + rest.join(" ") + " " + dstSpec);
    return code;
  };

  /* ---------------- man pages */
  var MANX = {
    ip: ["ip [OPTIONS] OBJECT { COMMAND | help }", "Show and change network interfaces, addresses and routes.", [["ip a", "addresses of every interface (ip -br a: brief)"], ["ip r", "routing table: default via = the gateway"], ["ip link", "interfaces and their state"]]],
    ss: ["ss [options] [FILTER]", "Show sockets: which programs listen on which ports, and open connections.", [["-t / -u", "TCP / UDP"], ["-l", "listening sockets only"], ["-n", "numbers, not service names"], ["-p", "the process (needs sudo to see other users' processes)"], ["-a", "listening and connected"], ["'sport = :80'", "filter by local port"]]],
    ping: ["ping [-c COUNT] HOST", "Send ICMP echo requests: is the host up, and how far away (round-trip time)?", [["-c N", "stop after N packets"]]],
    curl: ["curl [options] URL", "Transfer data from or to a server (HTTP and more). The go-to tool for testing web servers and APIs.", [["-I", "headers only (HEAD request)"], ["-i", "include response headers"], ["-v", "verbose: show the request and response"], ["-s", "silent (no progress meter)"], ["-o FILE", "save the body to FILE"], ["-L", "follow redirects"], ["-H 'Host: name'", "send a header"], ["-w '%{http_code}'", "print the status code"], ["-f", "fail (exit 22) on HTTP errors"]]],
    wget: ["wget [OPTION]... URL", "Download files from the web.", [["-O FILE", "save as FILE (-O - prints it)"], ["-q", "quiet"]]],
    dig: ["dig [@SERVER] NAME [TYPE] [+short]", "DNS lookup utility. Asks DNS directly (it ignores /etc/hosts).", [["+short", "just the answer"], ["MX / AAAA / TXT / NS", "other record types"], ["@8.8.8.8", "ask a specific DNS server"], ["-x IP", "reverse lookup"]]],
    host: ["host NAME", "Simple DNS lookup.", []], nslookup: ["nslookup NAME [SERVER]", "Query DNS servers (older tool; dig is more detailed).", []],
    nc: ["nc [-zv] HOST PORT", "Netcat: open TCP connections. nc -zv host port checks whether a port is open.", [["-z", "just scan, send no data"], ["-v", "say what happened"]]],
    ssh: ["ssh [-i KEY] [-p PORT] [USER@]HOST [COMMAND]", "OpenSSH remote login client. Without COMMAND you get a shell on HOST; with one, it runs there and returns.", [["-i FILE", "use this private key"], ["-p PORT", "port (default 22)"], ["-v", "debug output: shows which keys are tried"], ["-o Option=value", "set an ssh_config option"]]],
    "ssh-keygen": ["ssh-keygen [-t ed25519] [-C COMMENT] [-f FILE]", "Generate SSH key pairs: a private key (keep it secret, mode 600) and a public key (.pub) to put on servers.", [["-t ed25519", "key type (the modern default)"], ["-C comment", "label, usually user@host"], ["-f FILE", "where to save it"], ["-N ''", "empty passphrase (for automation keys)"], ["-l -f FILE", "show a key's fingerprint"], ["-R HOST", "remove HOST from known_hosts"]]],
    "ssh-copy-id": ["ssh-copy-id [-i KEY.pub] [USER@]HOST", "Install your public key in a server's ~/.ssh/authorized_keys (using your password once), so you can log in with the key.", []],
    scp: ["scp [-r] [-P PORT] SOURCE... TARGET", "Secure copy over SSH. Remote paths look like user@host:/path.", [["-r", "copy folders"], ["-p", "keep times and modes"], ["-P PORT", "port (capital P!)"]]],
    rsync: ["rsync [OPTION]... SRC... DEST", "Fast, incremental file copying, locally or over SSH. Only changed files are sent. A trailing / on SRC means 'the contents of'.", [["-a", "archive: recursive, keep modes, times, links"], ["-v", "list what's transferred"], ["-z", "compress over the network"], ["-n, --dry-run", "show what would happen, change nothing"], ["--delete", "delete files in DEST that aren't in SRC (mirror)"], ["--exclude=PATTERN", "skip matching files"]]],
    sha256sum: ["sha256sum [-c] [FILE]...", "Print or check SHA-256 checksums. Same file, same sum; one changed byte changes it completely.", [["-c FILE", "check sums listed in FILE"]]],
    md5sum: ["md5sum [-c] [FILE]...", "Print or check MD5 checksums (fine for spotting accidents, not for security).", []],
    nginx: ["nginx [-t] [-T] [-s signal]", "The nginx web server. On Ubuntu, systemd runs it (nginx.service).", [["-t", "test the configuration (run with sudo)"], ["-T", "test and print the whole configuration"], ["-s reload", "reload the config (or: systemctl reload nginx)"], ["-v", "version"]]],
    sshd: ["sshd [-t] [-T]", "The OpenSSH server. systemd runs it as ssh.service.", [["-t", "test the config for errors"], ["-T", "print the effective config"]]]
  };
  Object.keys(MANX).forEach(function (k) { S.MAN[k] = { syn: MANX[k][0], desc: MANX[k][1], opts: MANX[k][2] }; });

  var NETBINS = ["diff", "cmp", "sha256sum", "md5sum", "hostname", "ip", "ss", "ping", "dig", "host", "nslookup", "nc", "curl", "wget", "ssh", "scp", "ssh-keygen", "ssh-copy-id", "sftp", "ssh-keyscan", "rsync", "openssl"];
  S.SYS_HOOKS.push(function (sys) {
    NETBINS.forEach(function (b) { var p = sys.pkgs && Object.keys(sys.pkgs).filter(function (k) { return sys.pkgs[k].bins.indexOf(b) >= 0; })[0]; if (!p || sys.pkgs[p].installed) putRoot(sys, "/usr/bin/" + b, "\x7fELF:" + b + " (simulated binary)\n", 493, 0, 0, Date.UTC(2024, 3, 8)); });
    ["sshd", "nginx"].forEach(function (b) { if (nodeAt(sys, "/usr/sbin/" + b)) putRoot(sys, "/usr/sbin/" + b, "\x7fELF:" + b + " (simulated binary)\n", 493, 0, 0, Date.UTC(2024, 3, 8)); });
    putRoot(sys, "/etc/ssh/ssh_config", "# This is the ssh client system-wide configuration file.\nInclude /etc/ssh/ssh_config.d/*.conf\n\nHost *\n    SendEnv LANG LC_*\n    HashKnownHosts no\n    GSSAPIAuthentication yes\n");
    ["ed25519", "rsa", "ecdsa"].forEach(function (t) { putRoot(sys, "/etc/ssh/ssh_host_" + t + "_key", "-----BEGIN OPENSSH PRIVATE KEY-----\n" + KEY_PREFIX[t] + hashChars("hostkey:" + sys.host + t, 60) + "\n-----END OPENSSH PRIVATE KEY-----\n", 384); putRoot(sys, "/etc/ssh/ssh_host_" + t + "_key.pub", (t === "ed25519" ? hostKey(sys.host).line : TYPE_NAME[t] + " " + BLOB_PREFIX[t] + hashChars("hk" + t + sys.host, BLOB_LEN[t])) + " root@" + sys.host + "\n", 420); });
    sys.ip = sys.ip || SELF_IP;
  });
})(typeof window !== "undefined" ? window : globalThis);
