/* sudo learn — DevOps Module 3: a simulated HashiCorp Vault 1.18 at https://vault.kestrel.io:8200 with the KV v2
   secrets engine at secret/, ACL policies (HCL), tokens, and the AppRole auth method. The `vault` CLI talks to it
   with VAULT_ADDR and VAULT_TOKEN (or ~/.vault-token); permission checks follow the policies' path globs and
   capabilities. Terraform's vault_kv_secret_v2 data source and Ansible's vault_kv2_get lookup use the same store. */
(function (root) {
  "use strict";
  var S = root.ShEngine, M2 = S.M2, CMDS = S.CMDS, U = S.util, CI = root.CI, G = root.GitCore, IAC = root.IAC;
  var out = U.out, errl = U.errl;
  function keys(o) { return o ? Object.keys(o) : []; }
  var ADDR = "https://vault.kestrel.io:8200";
  IAC.VAULT_ADDR = ADDR;
  function now(sys) { return G.clock(CI.homeSys(sys)); }
  function iso(t) { return new Date(t * 1000).toISOString().replace(/\.\d+Z$/, ".000000Z"); }
  function vault(sys) {
    var h = CI.hubOf(sys);
    if (!h.vault) h.vault = { kv: {}, policies: { "default": "path \"auth/token/lookup-self\" {\n  capabilities = [\"read\"]\n}\n", root: null }, tokens: {}, approles: {}, secretIds: {}, auth: { "token/": true }, seq: 0, audit: [] };
    return h.vault;
  }
  IAC.vault = vault;
  function newToken(V, policies, meta) { V.seq++; var t = "hvs." + M2.hashChars("vt" + V.seq + policies.join(","), 24, "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"); V.tokens[t] = { policies: ["default"].concat(policies.filter(function (p) { return p !== "default"; })), accessor: M2.hashChars("acc" + t, 24, "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"), meta: meta || {}, ttl: (meta && meta.ttl) || 2764800, created: 0 }; return t; }
  IAC.vaultToken = function (sys, policies, meta) { return newToken(vault(sys), policies, meta); };
  // Lab setup: a policy and secrets
  IAC.vaultSetup = function (sys, o) {
    var V = vault(sys); o = o || {};
    keys(o.policies || {}).forEach(function (p) { V.policies[p] = o.policies[p]; });
    keys(o.secrets || {}).forEach(function (p) { putKv(V, "secret", p, o.secrets[p], 0); });
    return V;
  };
  function putKv(V, mount, path, data, t) { var k = mount + "/" + path; var cur = V.kv[k] || (V.kv[k] = { versions: [], mount: mount, path: path }); cur.versions.push({ data: data, created: t, deleted: false }); return cur.versions.length; }

  /* ---------------- policies */
  function parsePolicy(text) {
    var rules = [], re = /path\s+"([^"]+)"\s*\{([^}]*)\}/g, m;
    while ((m = re.exec(text))) { var caps = /capabilities\s*=\s*\[([^\]]*)\]/.exec(m[2]); rules.push({ path: m[1], caps: caps ? caps[1].split(",").map(function (c) { return c.trim().replace(/"/g, ""); }).filter(Boolean) : [] }); }
    return rules;
  }
  function validPolicy(text) { if (!/path\s+"[^"]+"\s*\{/.test(text)) return "failed to parse policy: At 1:1: expected: IDENT | STRING got: " + (String(text).trim().split(/\s/)[0] || "EOF"); var bad = /capabilities\s*=\s*\[([^\]]*)\]/g, m, ok = ["create", "read", "update", "patch", "delete", "list", "sudo", "deny"]; while ((m = bad.exec(text))) { var cs = m[1].split(",").map(function (c) { return c.trim().replace(/"/g, ""); }).filter(Boolean); var x = cs.filter(function (c) { return ok.indexOf(c) < 0; })[0]; if (x) return "failed to parse policy: invalid capability \"" + x + "\""; } return null; }
  function allowed(V, tok, path, cap) {
    var t = V.tokens[tok]; if (!t) return false;
    if (t.policies.indexOf("root") >= 0) return true;
    var best = null;
    t.policies.forEach(function (p) { parsePolicy(V.policies[p] || "").forEach(function (r) { var glob = /\*$/.test(r.path), pre = r.path.replace(/\*$/, ""); var plus = r.path.indexOf("+") >= 0; var ok = glob ? path.indexOf(pre) === 0 : plus ? new RegExp("^" + r.path.replace(/\+/g, "[^/]+") + "$").test(path) : path === r.path; if (ok && (!best || pre.length >= best.len)) best = { len: pre.length + (glob ? 0 : 1), caps: r.caps }; }); });
    return !!best && best.caps.indexOf("deny") < 0 && best.caps.indexOf(cap) >= 0;
  }
  IAC.vaultAllowed = function (sys, tok, path, cap) { return allowed(vault(sys), tok, path, cap); };
  function tokenOf(sess) { var t = S.getVar(sess, "VAULT_TOKEN"); if (t) return t; var n = root.Dk.fsNode(sess.sys, sess.home + "/.vault-token"); return n && n.type === "f" ? String(n.content).trim() : null; }
  function apiErr(io, method, path, code, errs) { errl(io, "Error " + (method === "GET" ? "reading" : method === "LIST" ? "listing" : method === "DELETE" ? "deleting" : "writing") + " " + path.replace(/^v1\//, "") + ": Error making API request.\n\nURL: " + method + " " + ADDR + "/" + path + "\nCode: " + code + ". Errors:\n\n" + errs.map(function (e) { return "* " + e; }).join("\n")); }
  // KV v2 read used by Terraform's data source and Ansible's lookup
  IAC.vaultRead = function (sess, mount, path, tokOverride, url) {
    var V = vault(sess.sys), tok = tokOverride || (sess ? tokenOf(sess) : null);
    var addr = url || (sess && S.getVar(sess, "VAULT_ADDR"));
    if (!addr) return { error: "Error making API request.\n\nURL: GET http://127.0.0.1:8200/v1/" + mount + "/data/" + path + "\nCode: 0. Errors:\n\n* dial tcp 127.0.0.1:8200: connect: connection refused (set VAULT_ADDR)" };
    if (!tok || !V.tokens[tok]) return { error: "Error making API request.\n\nURL: GET " + ADDR + "/v1/" + mount + "/data/" + path + "\nCode: 403. Errors:\n\n* permission denied" };
    if (!allowed(V, tok, mount + "/data/" + path, "read")) return { error: "Error making API request.\n\nURL: GET " + ADDR + "/v1/" + mount + "/data/" + path + "\nCode: 403. Errors:\n\n* 1 error occurred:\n\t* permission denied\n\n" };
    var s = V.kv[mount + "/" + path]; if (!s || !s.versions.length) return { error: "secret not found at " + mount + "/data/" + path };
    var v = s.versions[s.versions.length - 1];
    V.audit.push({ path: mount + "/data/" + path, token: V.tokens[tok].accessor, by: (V.tokens[tok].meta || {}).role_name || "token", t: now(sess.sys), cmd: CI.homeSys(sess.sys).cmdIndex });
    return { data: v.data, version: s.versions.length, created: iso(v.created) };
  };

  /* ---------------- output */
  function table(rows) { var w = [0, 0]; rows.forEach(function (r) { w[0] = Math.max(w[0], String(r[0]).length); }); return rows.map(function (r) { return String(r[0]) + new Array(w[0] - String(r[0]).length + 5).join(" ") + r[1]; }).join("\n"); }
  function kvTable(o) { var ks = keys(o).sort(); return table([["Key", "Value"], ["---", "-----"]].concat(ks.map(function (k) { return [k, typeof o[k] === "object" ? JSON.stringify(o[k]) : o[k]]; }))); }
  function hdr(t) { var w = t.length + 2; var eq = new Array(Math.max(1, Math.floor((w - 2) / 2))).join("="); return "== " + t + " =="; }
  function section(t, width) { var pad = Math.max(1, Math.floor((width - t.length - 2) / 2)); return new Array(pad + 1).join("=") + " " + t + " " + new Array(pad + 1).join("="); }

  CMDS.vault = function (args, io, sess) {
    var a = args.slice(1), sys = sess.sys, V = vault(sys);
    var flags = {}, pos = [];
    a.forEach(function (x) { var m = /^-{1,2}([\w-]+)=([\s\S]*)$/.exec(x), m2 = /^-{1,2}([\w-]+)$/.exec(x); if (m) flags[m[1]] = m[2]; else if (m2) flags[m2[1]] = true; else pos.push(x); });
    var cmd = pos[0];
    if (!cmd || cmd === "help" || flags.help) { out(io, "Usage: vault <command> [args]\n\nCommon commands:\n    read        Read data and retrieves secrets\n    write       Write data, configuration, and secrets\n    delete      Delete secrets and configuration\n    list        List data or secrets\n    login       Authenticate locally\n    status      Print seal and HA status\n\nOther commands:\n    auth        Interact with auth methods\n    kv          Interact with Vault's Key-Value storage\n    policy      Interact with policies\n    token       Interact with tokens\n"); return cmd ? 0 : 127; }
    if (cmd === "version" || (flags.version === true && !pos.length)) { out(io, "Vault v1.18.1 (f479e5c85462477c9334564bc8f69531cdb03b65), built 2024-10-29T14:21:31Z\n"); return 0; }
    var addr = S.getVar(sess, "VAULT_ADDR");
    if (!addr) { errl(io, "Error checking seal status: Get \"https://127.0.0.1:8200/v1/sys/seal-status\": dial tcp 127.0.0.1:8200: connect: connection refused"); if (io.note) io.note("(Set VAULT_ADDR to the server first: export VAULT_ADDR=" + ADDR + ")"); return 2; }
    if (addr.replace(/\/$/, "") !== ADDR) { errl(io, "Error: Get \"" + addr + "/v1/sys/seal-status\": dial tcp: lookup " + addr.replace(/^https?:\/\//, "").replace(/[:/].*$/, "") + ": no such host"); return 2; }
    if (cmd === "status") { out(io, table([["Key", "Value"], ["---", "-----"], ["Seal Type", "shamir"], ["Initialized", "true"], ["Sealed", "false"], ["Total Shares", "5"], ["Threshold", "3"], ["Version", "1.18.1"], ["Build Date", "2024-10-29T14:21:31Z"], ["Storage Type", "raft"], ["Cluster Name", "vault-cluster-kestrel"], ["HA Enabled", "true"], ["HA Mode", "active"]]) + "\n"); return 0; }
    var tok = tokenOf(sess);
    if (cmd === "login") {
      var given = pos[1] || flags.token;
      if (flags.method && flags.method !== "token") { errl(io, "Error authenticating: the " + flags.method + " auth method isn't set up for interactive login in this lab: use vault write auth/approle/login or a token"); return 2; }
      if (!given || !V.tokens[given]) { errl(io, "Error authenticating: error looking up token: Error making API request.\n\nURL: GET " + ADDR + "/v1/auth/token/lookup-self\nCode: 403. Errors:\n\n* permission denied"); return 2; }
      S.put(sys, sess.home + "/.vault-token", given, 384, sess.uid, sess.gid);
      out(io, "Success! You are now authenticated. The token information displayed below\nis already stored in the token helper. You do NOT need to run \"vault login\"\nagain. Future Vault requests will automatically use this token.\n\n" + table([["Key", "Value"], ["---", "-----"], ["token", given], ["token_accessor", V.tokens[given].accessor], ["token_duration", "∞"], ["token_renewable", "false"], ["token_policies", JSON.stringify(V.tokens[given].policies)], ["identity_policies", "[]"], ["policies", JSON.stringify(V.tokens[given].policies)]]) + "\n"); return 0;
    }
    if (!tok) { errl(io, "Error " + (cmd === "kv" ? "reading" : "making request") + ": Error making API request.\n\nURL: GET " + ADDR + "/v1/sys/internal/ui/mounts/secret\nCode: 403. Errors:\n\n* permission denied"); if (io.note) io.note("(No token: vault login TOKEN, or set VAULT_TOKEN.)"); return 2; }
    if (!V.tokens[tok]) { errl(io, "Error making API request.\n\nURL: GET " + ADDR + "/v1/sys/internal/ui/mounts/secret\nCode: 403. Errors:\n\n* permission denied"); return 2; }
    var T = V.tokens[tok];
    function json(o) { out(io, JSON.stringify(o, null, 2) + "\n"); }
    if (cmd === "token") {
      var sc = pos[1];
      if (sc === "lookup") { var lt = pos[2] || tok, L = V.tokens[lt]; if (!L) { errl(io, "Error looking up token: Error making API request.\n\nCode: 403. Errors:\n\n* bad token"); return 2; } out(io, table([["Key", "Value"], ["---", "-----"], ["accessor", L.accessor], ["display_name", L.meta.display_name || "token"], ["meta", L.meta.role_name ? "map[role_name:" + L.meta.role_name + "]" : "<nil>"], ["policies", "[" + L.policies.join(" ") + "]"], ["ttl", L.ttl === 0 ? "0s" : Math.floor(L.ttl / 3600) + "h"]]) + "\n"); return 0; }
      if (sc === "create") {
        if (!allowed(V, tok, "auth/token/create", "update") && T.policies.indexOf("root") < 0) { apiErr(io, "POST", "v1/auth/token/create", 403, ["permission denied"]); return 2; }
        var pols = a.filter(function (x) { return /^-policy=/.test(x); }).map(function (x) { return x.slice(8); });
        var bad = pols.filter(function (p) { return !(p in V.policies); }); void bad;
        var ttl = flags.ttl || "768h";
        var nt = newToken(V, pols, { ttl: /h$/.test(ttl) ? parseInt(ttl, 10) * 3600 : /m$/.test(ttl) ? parseInt(ttl, 10) * 60 : 2764800 });
        if (flags.format === "json") { json({ auth: { client_token: nt, accessor: V.tokens[nt].accessor, policies: V.tokens[nt].policies, lease_duration: V.tokens[nt].ttl, renewable: true } }); return 0; }
        if (flags.field === "token") { out(io, nt); return 0; }
        out(io, table([["Key", "Value"], ["---", "-----"], ["token", nt], ["token_accessor", V.tokens[nt].accessor], ["token_duration", ttl], ["token_renewable", "true"], ["token_policies", JSON.stringify(V.tokens[nt].policies)], ["identity_policies", "[]"], ["policies", JSON.stringify(V.tokens[nt].policies)]]) + "\n"); IAC.ev(sys, { kind: "vault-token", policies: V.tokens[nt].policies }); return 0;
      }
      if (sc === "revoke") { var rt = pos[2]; if (!V.tokens[rt]) { errl(io, "Error revoking token: Error making API request.\n\nCode: 400. Errors:\n\n* token to revoke not found"); return 2; } delete V.tokens[rt]; out(io, "Success! Revoked token (if it existed)\n"); return 0; }
    }
    if (cmd === "policy") {
      var pc = pos[1];
      if (pc === "list") { if (!allowed(V, tok, "sys/policies/acl", "list")) { apiErr(io, "LIST", "v1/sys/policies/acl", 403, ["permission denied"]); return 2; } out(io, keys(V.policies).sort().map(function (k) { return k + "\n"; }).join("")); return 0; }
      if (pc === "read") { var pr = V.policies[pos[2]]; if (pr === undefined) { errl(io, "No policy named: " + pos[2]); return 2; } out(io, (pr || "") ); return 0; }
      if (pc === "write") {
        var nm = pos[2], file = pos[3];
        if (!nm || !file) { errl(io, "Not enough arguments (expected 2, got " + [nm, file].filter(Boolean).length + ")"); return 1; }
        if (!allowed(V, tok, "sys/policies/acl/" + nm, "update")) { apiErr(io, "PUT", "v1/sys/policies/acl/" + nm, 403, ["permission denied"]); return 2; }
        var txt = file === "-" ? io.stdin || "" : (S.readFile(sess, file.charAt(0) === "/" ? file : sess.cwd + "/" + file).content);
        if (txt == null) { errl(io, "Error opening policy file: open " + file + ": no such file or directory"); return 2; }
        var pe = validPolicy(txt); if (pe) { apiErr(io, "PUT", "v1/sys/policies/acl/" + nm, 400, [pe]); return 2; }
        V.policies[nm] = txt; out(io, "Success! Uploaded policy: " + nm + "\n"); IAC.ev(sys, { kind: "vault-policy", name: nm }); return 0;
      }
    }
    if (cmd === "kv") {
      var kc = pos[1], mount = flags.mount || "secret", p = pos[2] || "";
      if (!flags.mount) { var mm = /^([^/]+)\/(.*)$/.exec(p); if (mm) { mount = mm[1]; p = mm[2]; } }
      var dataPath = mount + "/data/" + p;
      if (kc === "put" || kc === "patch") {
        if (!allowed(V, tok, dataPath, kc === "patch" ? "patch" : "create") && !allowed(V, tok, dataPath, "update")) { apiErr(io, "PUT", "v1/" + dataPath, 403, ["1 error occurred:\n\t* permission denied\n"]); return 2; }
        var data = kc === "patch" && V.kv[mount + "/" + p] ? JSON.parse(JSON.stringify(V.kv[mount + "/" + p].versions.slice(-1)[0].data)) : {};
        pos.slice(3).forEach(function (kvs) { var i = kvs.indexOf("="); if (i > 0) { var v = kvs.slice(i + 1); if (/^@/.test(v)) { var r = S.readFile(sess, v.slice(1).charAt(0) === "/" ? v.slice(1) : sess.cwd + "/" + v.slice(1)); v = r.error ? "" : r.content.replace(/\n$/, ""); } if (v === "-") v = (io.stdin || "").replace(/\n$/, ""); data[kvs.slice(0, i)] = v; } });
        if (!keys(data).length) { errl(io, "Must supply data"); return 1; }
        var ver = putKv(V, mount, p, data, now(sys));
        out(io, section("Secret Path", 22) + "\n" + dataPath + "\n\n" + section("Metadata", 22) + "\n" + table([["Key", "Value"], ["---", "-----"], ["created_time", iso(now(sys))], ["custom_metadata", "<nil>"], ["deletion_time", "n/a"], ["destroyed", "false"], ["version", ver]]) + "\n");
        IAC.ev(sys, { kind: "vault-put", path: mount + "/" + p }); return 0;
      }
      if (kc === "get") {
        if (!allowed(V, tok, dataPath, "read")) { apiErr(io, "GET", "v1/" + dataPath, 403, ["1 error occurred:\n\t* permission denied\n"]); return 2; }
        var s = V.kv[mount + "/" + p]; if (!s) { errl(io, "No value found at " + dataPath); return 2; }
        var vn = flags.version ? parseInt(flags.version, 10) : s.versions.length, v0 = s.versions[vn - 1]; if (!v0) { errl(io, "No value found at " + dataPath); return 2; }
        V.audit.push({ path: dataPath, token: T.accessor, by: T.meta.role_name || "token", t: now(sys), cmd: CI.homeSys(sys).cmdIndex });
        if (flags.field) { if (!(flags.field in v0.data)) { errl(io, "Field \"" + flags.field + "\" not present in secret"); return 1; } out(io, v0.data[flags.field]); return 0; }
        if (flags.format === "json") { json({ request_id: M2.hexOf("req" + p, 8) + "-" + M2.hexOf("r2" + p, 4) + "-" + M2.hexOf("r3", 4) + "-" + M2.hexOf("r4", 4) + "-" + M2.hexOf("r5" + p, 12), lease_id: "", lease_duration: 0, renewable: false, data: { data: v0.data, metadata: { created_time: iso(v0.created), custom_metadata: null, deletion_time: "", destroyed: false, version: s.versions.length } }, warnings: null }); return 0; }
        out(io, section("Secret Path", 22) + "\n" + dataPath + "\n\n" + section("Metadata", 22) + "\n" + table([["Key", "Value"], ["---", "-----"], ["created_time", iso(v0.created)], ["custom_metadata", "<nil>"], ["deletion_time", "n/a"], ["destroyed", "false"], ["version", vn]]) + "\n\n" + section("Data", 22) + "\n" + kvTable(v0.data) + "\n");
        return 0;
      }
      if (kc === "list") { var lp = mount + "/metadata/" + p; if (!allowed(V, tok, lp, "list")) { apiErr(io, "LIST", "v1/" + lp, 403, ["1 error occurred:\n\t* permission denied\n"]); return 2; } var pre = p ? p.replace(/\/?$/, "/") : ""; var items = []; keys(V.kv).forEach(function (k) { if (k.indexOf(mount + "/" + pre) !== 0) return; var rest = k.slice((mount + "/" + pre).length); var first = rest.split("/")[0] + (rest.indexOf("/") >= 0 ? "/" : ""); if (items.indexOf(first) < 0) items.push(first); }); if (!items.length) { errl(io, "No value found at " + lp); return 2; } out(io, "Keys\n----\n" + items.sort().join("\n") + "\n"); return 0; }
      if (kc === "delete") { if (!allowed(V, tok, dataPath, "delete")) { apiErr(io, "DELETE", "v1/" + dataPath, 403, ["permission denied"]); return 2; } var sd = V.kv[mount + "/" + p]; if (sd) sd.versions[sd.versions.length - 1].deleted = true; out(io, "Success! Data deleted (if it existed) at: " + dataPath + "\n"); return 0; }
      if (kc === "metadata") { var ms = V.kv[mount + "/" + pos[3]]; out(io, ms ? section("Metadata Path", 22) + "\n" + mount + "/metadata/" + pos[3] + "\n\n" + table([["Key", "Value"], ["---", "-----"], ["current_version", ms.versions.length], ["max_versions", "0"]]) + "\n" : ""); return ms ? 0 : 2; }
    }
    if (cmd === "auth" && pos[1] === "enable") { var meth = pos[2]; if (T.policies.indexOf("root") < 0 && !allowed(V, tok, "sys/auth/" + meth, "sudo")) { apiErr(io, "POST", "v1/sys/auth/" + meth, 403, ["permission denied"]); return 2; } if (V.auth[meth + "/"]) { apiErr(io, "POST", "v1/sys/auth/" + meth, 400, ["path is already in use at " + meth + "/"]); return 2; } V.auth[meth + "/"] = true; out(io, "Success! Enabled " + meth + " auth method at: " + meth + "/\n"); return 0; }
    if (cmd === "auth" && pos[1] === "list") { out(io, table([["Path", "Type"], ["----", "----"]].concat(keys(V.auth).map(function (k) { return [k, k.replace(/\/$/, "")]; }))) + "\n"); return 0; }
    if (cmd === "write" || cmd === "read") {
      var path = pos[1] || "", m2;
      var kv2 = {}; pos.slice(2).forEach(function (x) { var i = x.indexOf("="); if (i > 0) kv2[x.slice(0, i)] = x.slice(i + 1); });
      if ((m2 = /^auth\/approle\/role\/([\w-]+)$/.exec(path)) && cmd === "write") {
        if (!V.auth["approle/"]) { apiErr(io, "PUT", "v1/" + path, 404, ["no handler for route \"" + path + "\". route entry not found."]); return 2; }
        if (!allowed(V, tok, path, "create") && !allowed(V, tok, path, "update")) { apiErr(io, "PUT", "v1/" + path, 403, ["permission denied"]); return 2; }
        V.approles[m2[1]] = { policies: String(kv2.token_policies || kv2.policies || "").split(",").map(function (x) { return x.trim(); }).filter(Boolean), ttl: kv2.token_ttl || "1h", roleId: M2.hexOf("roleid" + m2[1], 8) + "-" + M2.hexOf("r2" + m2[1], 4) + "-" + M2.hexOf("r3" + m2[1], 4) + "-" + M2.hexOf("r4" + m2[1], 4) + "-" + M2.hexOf("r5" + m2[1], 12) };
        out(io, "Success! Data written to: " + path + "\n"); IAC.ev(sys, { kind: "vault-approle", role: m2[1] }); return 0;
      }
      if ((m2 = /^auth\/approle\/role\/([\w-]+)\/role-id$/.exec(path)) && cmd === "read") { var ar = V.approles[m2[1]]; if (!ar) { errl(io, "No value found at " + path); return 2; } if (flags.field === "role_id") { out(io, ar.roleId); return 0; } out(io, table([["Key", "Value"], ["---", "-----"], ["role_id", ar.roleId]]) + "\n"); return 0; }
      if ((m2 = /^auth\/approle\/role\/([\w-]+)\/secret-id$/.exec(path)) && cmd === "write") { var ar2 = V.approles[m2[1]]; if (!ar2) { apiErr(io, "PUT", "v1/" + path, 400, ["invalid role name \"" + m2[1] + "\""]); return 2; } var sid = M2.hexOf("sid" + m2[1] + V.seq++, 8) + "-" + M2.hexOf("s2" + V.seq, 4) + "-" + M2.hexOf("s3" + V.seq, 4) + "-" + M2.hexOf("s4" + V.seq, 4) + "-" + M2.hexOf("s5" + V.seq, 12); V.secretIds[sid] = m2[1]; if (flags.field === "secret_id") { out(io, sid); return 0; } out(io, table([["Key", "Value"], ["---", "-----"], ["secret_id", sid], ["secret_id_accessor", M2.hexOf("sacc" + sid, 8) + "-" + M2.hexOf("sacc2" + sid, 4) + "-" + M2.hexOf("sacc3", 4) + "-" + M2.hexOf("sacc4", 4) + "-" + M2.hexOf("sacc5" + sid, 12)], ["secret_id_num_uses", "0"], ["secret_id_ttl", "0s"]]) + "\n"); return 0; }
      if (path === "auth/approle/login" && cmd === "write") { var rn = keys(V.approles).filter(function (k) { return V.approles[k].roleId === kv2.role_id; })[0]; if (!rn || V.secretIds[kv2.secret_id] !== rn) { apiErr(io, "PUT", "v1/auth/approle/login", 400, ["invalid role or secret ID"]); return 2; } var at = newToken(V, V.approles[rn].policies, { role_name: rn, ttl: 3600 }); if (flags.field === "token") { out(io, at); return 0; } out(io, table([["Key", "Value"], ["---", "-----"], ["token", at], ["token_accessor", V.tokens[at].accessor], ["token_duration", V.approles[rn].ttl], ["token_renewable", "true"], ["token_policies", JSON.stringify(V.tokens[at].policies)], ["identity_policies", "[]"], ["policies", JSON.stringify(V.tokens[at].policies)], ["token_meta_role_name", rn]]) + "\n"); IAC.ev(sys, { kind: "vault-login", role: rn }); return 0; }
      if (/^secret\/data\//.test(path) && cmd === "read") { return CMDS.vault(["vault", "kv", "get", "secret/" + path.slice(12)].concat(flags.field ? ["-field=" + flags.field] : []), io, sess); }
      errl(io, "Error " + (cmd === "read" ? "reading" : "writing") + " " + path + ": Error making API request.\n\nURL: " + (cmd === "read" ? "GET" : "PUT") + " " + ADDR + "/v1/" + path + "\nCode: 404. Errors:\n\n* no handler for route \"" + path + "\". route entry not found.");
      return 2;
    }
    errl(io, "Unknown command: " + cmd + "\n(This lab's vault knows: status, login, kv put|get|list|patch|delete, policy write|read|list, token create|lookup|revoke, auth enable|list, read, write.)"); return 127;
  };
  if (M2.net && M2.net.DNS) { M2.net.DNS["vault.kestrel.io"] = { A: ["10.20.0.40"] }; M2.net.HOSTS["10.20.0.40"] = { ping: 0.6, ports: [8200], site: "kestrel-vault" }; if (M2.net.SITES) M2.net.SITES["kestrel-vault"] = function (req) { if (/^\/v1\/sys\/health/.test(req.path)) return { status: 200, headers: { "Content-Type": "application/json" }, body: "{\"initialized\":true,\"sealed\":false,\"standby\":false,\"version\":\"1.18.1\",\"cluster_name\":\"vault-cluster-kestrel\"}\n" }; return { status: 403, headers: { "Content-Type": "application/json" }, body: "{\"errors\":[\"permission denied\"]}\n" }; }; }
})(typeof window !== "undefined" ? window : globalThis);
