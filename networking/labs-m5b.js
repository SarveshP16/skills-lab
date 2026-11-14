/* sudo learn — Networking track, Module 5 (continued): NET-506 zero trust and mTLS, NET-507 egress control, WAF and
   CDN, NET-508 network rules as code, NET-509 capstone: contain a compromised instance. */
(function () {
  "use strict";
  var T = window.NET_TRACK, S = window.ShEngine, M2 = S.M2, M3 = S.M3, M4 = S.M4, N = window.NetCore, NH = window.NetLab.H, X = T.M5;
  var MAYA = "Maya Chen · SRE lead", DEV = "Dev Patel · Security";
  var NOW = S.NOW, DAY = S.DAY, ME = "10.20.0.15", MON = "10.20.5.10", EXT = "198.51.100.200";
  var ex = T.ex, code = T.code, lines = T.lines, ran = NH.ran, outHas = NH.outHas, idx = NH.idx;
  var C5 = N.cloud, ID = X.ID, HOST = X.HOST, LABS = [], word = X.word, after = X.after, cl = X.cl, sgOf = X.sgOf, flowOk = X.flowOk, worldIn = X.worldIn, awsRan = X.awsRan;
  function nano(path, text) { return ["nano " + path].concat(text.replace(/\n$/, "").split("\n").map(function (l) { return "    " + l; })); }
  function sudoNano(path, text) { return ["sudo nano " + path].concat(text.replace(/\n$/, "").split("\n").map(function (l) { return "    " + l; })); }

  /* ================================================================== NET-506 Zero trust & mTLS */
  var PAY_SITE = "server {\n    listen 8443 ssl;\n    server_name payments.kestrel.internal;\n\n    ssl_certificate     /etc/ssl/kestrel/payments.crt;\n    ssl_certificate_key /etc/ssl/kestrel/payments.key;\n\n    location / {\n        proxy_pass http://127.0.0.1:9000;\n        # who's calling: the client certificate's subject, e.g. CN=orders-svc\n        proxy_set_header X-Client-DN $ssl_client_s_dn;\n    }\n}\n";
  var PAY_SITE_MTLS = PAY_SITE.replace("    ssl_certificate_key /etc/ssl/kestrel/payments.key;\n", "    ssl_certificate_key /etc/ssl/kestrel/payments.key;\n\n    # only callers with a certificate from the Kestrel service CA\n    ssl_client_certificate /etc/nginx/mtls/ca.crt;\n    ssl_verify_client on;\n");
  function mtlsSys(sys) {
    var C = N.certs, now = sys.now;
    var leaf = C.leaf("payments.kestrel.internal", ["payments.kestrel.internal"], now - 20 * DAY, now + 300 * DAY, C.KCA);
    S.mkdirs(sys, "/etc/ssl/kestrel", 493, 0, 0);
    M2.putRoot(sys, "/etc/ssl/kestrel/payments.crt", N.pki.certText(leaf), 420, 0, 0, now - 20 * DAY);
    M2.putRoot(sys, "/etc/ssl/kestrel/payments.key", N.pki.keyText(M2.hexOf("paykey", 16), "ec256"), 384, 0, 0, now - 20 * DAY);
    M2.putRoot(sys, "/etc/nginx/sites-available/payments", PAY_SITE, 420, 0, 0, now - 20 * DAY);
    S.mkdirs(sys, "/etc/nginx/sites-enabled").children.payments = S.linkNode("/etc/nginx/sites-available/payments");
    M2.spawn(sys, { cmd: "/opt/payments/bin/payments-api --listen 127.0.0.1:9000", comm: "payments-api", uid: 1003, start: now - 20 * DAY, listen: [{ proto: "tcp", addr: "127.0.0.1", port: 9000 }] });
    M2.writeRoot(sys, "/etc/hosts", "10.20.0.15 payments.kestrel.internal\n", true);
    S.mkdirs(sys, "/home/dev/pki", 493, 1000, 1000);
  }
  function certAt(r, p) { return N.pki.parseCerts(r.read(p) || "")[0] || null; }
  function keyOf(r, p) { return N.pki.keyId(r.read(p) || ""); }
  function payReq(r, certText) { return N.httpTo(r.sys, ME, 8443, { scheme: "https", host: "payments.kestrel.internal", port: 8443, path: "/v1/charges", method: "GET", headers: { host: "payments.kestrel.internal", "user-agent": "check", accept: "*/*" }, clientCert: certText }); }
  function curled(r, re) { return ran(r, /\bcurl\b.*payments\.kestrel\.internal:8443/, function (e) { return outHas(e, re); }); }
  LABS.push({
    id: "net-506", n: 45, module: 5, ticket: "NET-506", xp: 210, layer: "L5–7",
    title: "Prove who you are",
    topic: "Zero trust, mutual TLS: a private CA with OpenSSL, short-lived client certificates, nginx ssl_verify_client, identity passed to the app, authentication vs authorization",
    from: DEV,
    story: "<p>The internal payments API on kc-web-01 (<code>https://payments.kestrel.internal:8443</code>) trusts anyone who can reach it. \"It's on the internal network\" is exactly the assumption attackers love: once they're on one machine, they're \"internal\" too.</p><p><b>Zero trust</b> says every caller proves who it is, on every request. Build a small certificate authority for services, give the orders service a short-lived certificate, and make nginx demand one. The API already reads the caller's name from the certificate and decides what each service may do.</p>",
    learn:
      "<h3>Mutual TLS</h3><p>In normal TLS only the server shows a certificate. In <b>mTLS</b> the client shows one too, signed by a CA the server trusts. No certificate, or one from another CA: the connection is refused before any HTTP happens.</p>" +
      "<h3>A tiny CA with OpenSSL</h3>" + code("# the CA: a key and a self-signed certificate\nopenssl req -x509 -new -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes \\\n    -keyout ca.key -out ca.crt -days 3650 -subj \"/CN=Kestrel Service CA\"\n# a service: its own key and a request (CSR), signed by the CA\nopenssl req -new -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes \\\n    -keyout orders.key -out orders.csr -subj \"/CN=orders-svc\"\nopenssl x509 -req -in orders.csr -CA ca.crt -CAkey ca.key -CAcreateserial -out orders.crt -days 7\nopenssl verify -CAfile ca.crt orders.crt") +
      "<p>Keep certificates <b>short-lived</b> (days, not years) and issue them automatically: a stolen one expires soon, and nobody has to remember to revoke it.</p>" +
      "<h3>nginx asks for client certificates</h3>" + code("ssl_client_certificate /etc/nginx/mtls/ca.crt;   # trust only this CA for clients\nssl_verify_client on;\n# pass the verified identity to the app\nproxy_set_header X-Client-DN $ssl_client_s_dn;") +
      code("curl --cert orders.crt --key orders.key https://payments.kestrel.internal:8443/v1/charges") +
      "<p><b>Authentication</b> (who are you? the certificate) is not <b>authorization</b> (what may you do? the app's rules). Both are needed.</p>",
    system: mtlsSys,
    diagram: [],
    starter: "",
    objectives: [
      {
        id: "ca", text: "In <code>~/pki</code>, create a CA: key <code>ca.key</code>, self-signed certificate <code>ca.crt</code> with the name <code>Kestrel Service CA</code>.",
        hints: ["openssl req -x509 -new with -newkey, -nodes, -keyout, -out, -days and -subj.", "cd ~/pki\nopenssl req -x509 -new -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes -keyout ca.key -out ca.crt -days 3650 -subj '/CN=Kestrel Service CA'"],
        check: function (r) { var c = certAt(r, "/home/dev/pki/ca.crt"), k = keyOf(r, "/home/dev/pki/ca.key"); if (!c) return "No certificate in ~/pki/ca.crt yet."; if (!/CN = Kestrel Service CA/.test(c.s)) return "Name it Kestrel Service CA (-subj '/CN=Kestrel Service CA')."; if (c.i !== c.s || !c.ca) return "The CA certificate should be self-signed (req -x509)."; return k && k.kid === c.pk ? true : "~/pki/ca.key isn't the key of ca.crt."; }
      },
      {
        id: "orders", text: "Issue a certificate for <code>orders-svc</code> (<code>~/pki/orders.key</code>, <code>orders.crt</code>), signed by your CA and valid for <b>7 days at most</b>. Check it with <code>openssl verify</code>.",
        hints: ["A CSR with req -new, then x509 -req -CA -CAkey -CAcreateserial -days 7.", "openssl req -new -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes -keyout orders.key -out orders.csr -subj '/CN=orders-svc'\nopenssl x509 -req -in orders.csr -CA ca.crt -CAkey ca.key -CAcreateserial -out orders.crt -days 7\nopenssl verify -CAfile ca.crt orders.crt"],
        check: function (r) { var ca = certAt(r, "/home/dev/pki/ca.crt"), c = certAt(r, "/home/dev/pki/orders.crt"), k = keyOf(r, "/home/dev/pki/orders.key"); if (!c) return "No ~/pki/orders.crt yet."; if (!/CN = orders-svc/.test(c.s)) return "Its name must be CN=orders-svc."; if (!ca || c.i !== ca.s || c.ik !== ca.pk) return "orders.crt isn't signed by your CA."; if (!k || k.kid !== c.pk) return "orders.key doesn't belong to orders.crt."; if (c.na - c.nb > 7 * DAY + 1000) return "Short-lived: 7 days at most (-days 7)."; return ran(r, /\bopenssl\s+verify\b.*orders\.crt/, function (e) { return outHas(e, /orders\.crt: OK/); }) ? true : "Check it: openssl verify -CAfile ca.crt orders.crt."; }
      },
      {
        id: "require", text: "Make nginx demand a client certificate from <b>your</b> CA on the payments site (copy the CA certificate to <code>/etc/nginx/mtls/ca.crt</code>). Test, reload, and show that curl <b>without</b> a certificate is refused.",
        hints: ["ssl_client_certificate and ssl_verify_client on in /etc/nginx/sites-available/payments.", "sudo mkdir -p /etc/nginx/mtls\nsudo cp ~/pki/ca.crt /etc/nginx/mtls/ca.crt\nsudo nano /etc/nginx/sites-available/payments\nsudo nginx -t && sudo systemctl reload nginx\ncurl -s https://payments.kestrel.internal:8443/v1/charges"],
        check: function (r) { var res = payReq(r, null); if (res.status !== 400) return "nginx still serves callers without a certificate (reloaded?)."; var ca = certAt(r, "/home/dev/pki/ca.crt"), ok = ca && payReq(r, N.pki.certText({ s: "CN = probe", i: ca.s, nb: r.sys.now - 1000, na: r.sys.now + DAY, sn: "01", key: "ec256", sig: "ecdsa-with-SHA256", pk: "probe", ik: ca.pk })); if (!ok || ok.status === 400) return "nginx must trust your CA (ssl_client_certificate /etc/nginx/mtls/ca.crt)."; return curled(r, /No required SSL certificate was sent/) ? true : "Show it: curl the API without a certificate."; }
      },
      {
        id: "call", text: "Call <code>/v1/charges</code> as <b>orders-svc</b>, with its certificate and key.",
        hints: ["curl --cert … --key …", "curl -s --cert ~/pki/orders.crt --key ~/pki/orders.key https://payments.kestrel.internal:8443/v1/charges"],
        check: function (r) { return curled(r, /"caller":"orders-svc"/) ? true : "curl it with --cert ~/pki/orders.crt --key ~/pki/orders.key."; }
      },
      {
        id: "fake", text: "An attacker makes their <b>own</b> certificate that says <code>CN=orders-svc</code> (self-signed). Make one (<code>~/pki/fake.crt</code>) and show nginx rejects it.",
        hints: ["req -x509 like the CA, with -subj '/CN=orders-svc'.", "openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes -keyout fake.key -out fake.crt -days 1 -subj '/CN=orders-svc'\ncurl -s --cert fake.crt --key fake.key https://payments.kestrel.internal:8443/v1/charges"],
        check: function (r) { var f = certAt(r, "/home/dev/pki/fake.crt"); if (!f || !/orders-svc/.test(f.s)) return "Make ~/pki/fake.crt with CN=orders-svc."; return curled(r, /The SSL certificate error/) ? true : "Use it with curl: nginx should answer 400 The SSL certificate error."; }
      },
      {
        id: "authz", text: "Issue a certificate for <code>reporting-svc</code> from your CA and call <code>/v1/charges</code> with it: it's <b>authenticated</b> but not <b>allowed</b>.",
        hints: ["Same as orders-svc, with CN=reporting-svc (-CAserial ca.srl this time).", "openssl req -new -newkey ec -nodes -keyout reporting.key -out reporting.csr -subj '/CN=reporting-svc'\nopenssl x509 -req -in reporting.csr -CA ca.crt -CAkey ca.key -CAserial ca.srl -out reporting.crt -days 7\ncurl -s --cert reporting.crt --key reporting.key https://payments.kestrel.internal:8443/v1/charges"],
        check: function (r) { return curled(r, /reporting-svc may not use/) ? true : "Call the API with a reporting-svc certificate from your CA: the app should answer 403."; }
      }
    ],
    solution: lines.apply(null, ["curl -s https://payments.kestrel.internal:8443/v1/charges", "cd ~/pki",
      "openssl req -x509 -new -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes -keyout ca.key -out ca.crt -days 3650 -subj '/CN=Kestrel Service CA'",
      "openssl req -new -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes -keyout orders.key -out orders.csr -subj '/CN=orders-svc'",
      "openssl x509 -req -in orders.csr -CA ca.crt -CAkey ca.key -CAcreateserial -out orders.crt -days 7", "openssl verify -CAfile ca.crt orders.crt",
      "sudo mkdir -p /etc/nginx/mtls", "sudo cp ~/pki/ca.crt /etc/nginx/mtls/ca.crt"].concat(sudoNano("/etc/nginx/sites-available/payments", PAY_SITE_MTLS)).concat([
      "sudo nginx -t", "sudo systemctl reload nginx", "curl -s https://payments.kestrel.internal:8443/v1/charges",
      "curl -s --cert orders.crt --key orders.key https://payments.kestrel.internal:8443/v1/charges",
      "openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes -keyout fake.key -out fake.crt -days 1 -subj '/CN=orders-svc'",
      "curl -s --cert fake.crt --key fake.key https://payments.kestrel.internal:8443/v1/charges",
      "openssl req -new -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes -keyout reporting.key -out reporting.csr -subj '/CN=reporting-svc'",
      "openssl x509 -req -in reporting.csr -CA ca.crt -CAkey ca.key -CAserial ca.srl -out reporting.crt -days 7",
      "curl -s --cert reporting.crt --key reporting.key https://payments.kestrel.internal:8443/v1/charges"])),
    debrief: "<p>Being on the network no longer means anything to the payments API. Every caller needs a certificate from the service CA, which only you can issue; a home-made certificate with the right name fails, because the name is only as good as the CA that signed it. And identity isn't permission: reporting-svc proved who it is and was still refused.</p><p>Service meshes (Istio, Linkerd) and SPIFFE do exactly this automatically, issuing certificates that live for hours. Keep <code>ca.key</code> safe: it's the key to the whole system. Next: what goes out, and what a WAF can do.</p>",
    realworld: "openssl s_client -connect host:443 shows 'Acceptable client certificate CA names' when a server asks for a client certificate. Look for that on internal APIs.",
    quiz: [
      { q: "What does mTLS add to normal TLS?", options: ["Faster handshakes", "The client also proves who it is with a certificate the server trusts", "Encryption", "Compression"], answer: 1, why: "Both sides authenticate." },
      { q: "An attacker self-signs a certificate with CN=orders-svc. Why does it fail?", options: ["The name is wrong", "It isn't signed by the CA nginx trusts", "It's expired", "EC keys aren't allowed"], answer: 1, why: "Trust comes from the signer, not the name." },
      { q: "reporting-svc has a valid certificate and gets 403. That's…", options: ["A bug", "Authorization: authenticated, but not allowed", "A TLS error", "An expired certificate"], answer: 1, why: "Who you are vs what you may do." }
    ]
  });

  /* ================================================================== NET-507 Egress control, WAF & CDN */
  var SQLI = "https://kestrel.example.com/api/orders?id=1%20UNION%20SELECT%20password%20FROM%20users";
  function egressSys(sys) {
    N.cloudLab(sys);
    N.modsecLab(sys, "DetectionOnly");
    M2.putRoot(sys, "/etc/nginx/conf.d/modsecurity.conf", "# ModSecurity with the OWASP Core Rule Set, for every site\nmodsecurity on;\nmodsecurity_rules_file /etc/nginx/modsec/main.conf;\n", 420, 0, 0, NOW - 10 * DAY);
    sys.dnsExtra = sys.dnsExtra || {};
    sys.dnsExtra["kestrel.example.com"] = { A: [N.CDN.EDGE] }; sys.dnsExtra["www.kestrel.example.com"] = { CNAME: "kestrel.example.com" };
    var f = M4.fw(sys); f.enabled = true; f.def.incoming = "deny";
    [["22", "any"], ["80", "any"], ["443", "any"]].forEach(function (x) { f.rules.push({ dir: "in", port: x[0], proto: "tcp", from: x[1], to: "any", app: null, action: "allow", v6: false }); f.rules.push({ dir: "in", port: x[0], proto: "tcp", from: "any", to: "any", app: null, action: "allow", v6: true }); });
    M2.putRoot(sys, "/home/dev/cdn-ranges.txt", "# Addresses the CDN connects to our origin from (from the CDN's published list)\n" + N.CDN.RANGE + "\n", 420, 1000, 1000, NOW - 3 * DAY);
  }
  function proxyM(r) { return M2.machine(r.sys, "10.0.2.50"); }
  LABS.push({
    id: "net-507", n: 46, module: 5, ticket: "NET-507", xp: 220, layer: "L3–7",
    title: "What goes out, what comes in",
    topic: "Egress control with security groups and a proxy allowlist, ModSecurity and the OWASP CRS (detection vs blocking, rule IDs), CDNs and locking the origin",
    from: DEV,
    story: "<p>Last week's flow logs showed web-2 sending gigabytes to a paste site. Our web servers can connect <b>anywhere</b>, so stolen data walks straight out. They only need the database and two outside services (the payment provider and Ubuntu's mirrors), and there's an egress proxy, <b>proxy-1</b>, that allows a list of domains.</p><p>On the way in: the site sits behind a CDN, with a WAF (ModSecurity) on our nginx that someone left in <b>DetectionOnly</b>. And anyone who knows our origin's address can skip the CDN entirely.</p>",
    learn:
      "<h3>Egress: deny by default, outbound too</h3><p>Security groups allow all outbound traffic by default. Remove that rule and allow only what's needed. Security groups can't filter by <b>domain name</b> (the payment provider's addresses change), so outbound web traffic goes through a <b>proxy</b> that checks the name against an allowlist.</p>" +
      code("aws ec2 revoke-security-group-egress --group-id sg-… --protocol all --cidr 0.0.0.0/0\naws ec2 authorize-security-group-egress --group-id sg-… --protocol tcp --port 3128 --source-group sg-…\ncurl -x http://10.0.2.50:3128 https://pay.example.net/v1/ping       # or: export https_proxy=http://10.0.2.50:3128") +
      "<p>On the proxy, Squid reads the allowed domains from <code>/etc/squid/allowed-domains.txt</code> (<code>.example.com</code> also allows subdomains). Reload Squid after editing. Denied: <code>CONNECT tunnel failed, response 403</code>.</p>" +
      "<h3>What a WAF can and can't do</h3><p>A web application firewall inspects HTTP requests for attack patterns. ModSecurity with the OWASP Core Rule Set (CRS) gives each match a score; a request whose score passes the threshold is blocked by rule <b>949110</b>. The rules that found the attack (942100 for SQL injection, 941100 for XSS…) are in the audit log.</p>" +
      '<table class="t"><tr><th>SecRuleEngine</th><th>Does</th></tr><tr><td><code>DetectionOnly</code></td><td>logs, blocks nothing (start here to find false positives)</td></tr><tr><td><code>On</code></td><td>blocks</td></tr></table>' +
      "<p>A WAF can't fix broken logic (showing one user another's order), and attacks that look like normal requests pass. It's a layer, not the fix.</p>" +
      "<h3>The CDN and the origin</h3><p>A CDN's edge servers sit in front of your server (the <b>origin</b>), cache pages and absorb floods. If the origin accepts connections from everyone, attackers skip the CDN. Allow the origin's web ports only from the CDN's published address ranges.</p>",
    system: egressSys,
    diagram: ["vpc", "scan", "site"],
    starter: "",
    objectives: [
      {
        id: "egress", text: "The web servers' security group (<code>kestrel-web</code>): no more \"all traffic anywhere\" outbound. Allow out only PostgreSQL to <code>kestrel-db</code> and port 3128 to the proxy's group (<code>kestrel-egress-proxy</code>).",
        hints: ["revoke-security-group-egress for -1/0.0.0.0/0, then two authorize-security-group-egress with --source-group.", "aws ec2 revoke-security-group-egress --group-id " + ID.sg("web") + " --protocol all --cidr 0.0.0.0/0\naws ec2 authorize-security-group-egress --group-id " + ID.sg("web") + " --protocol tcp --port 5432 --source-group " + ID.sg("db") + "\naws ec2 authorize-security-group-egress --group-id " + ID.sg("web") + " --protocol tcp --port 3128 --source-group " + ID.sg("proxy")],
        check: function (r) { var c = cl(r); if (C5.sgCheck(c, [ID.sg("web")], true, "tcp", 443, "198.51.100.50", [])) return "kestrel-web can still connect straight to the internet."; if (!flowOk(r, "10.0.11.20", "10.0.21.30", 5432).ok) return "web-1 can't reach PostgreSQL any more."; return flowOk(r, "10.0.11.20", "10.0.2.50", 3128).ok ? true : "web-1 must still reach the proxy on 3128."; }
      },
      {
        id: "proxy", text: "web-1 must reach the payment provider <code>https://pay.example.net/v1/ping</code> <b>through the proxy</b>. Allow exactly that domain on proxy-1, reload Squid, and show it works from web-1, while <code>https://paste.example.org/</code> is still refused.",
        hints: ["On proxy-1: add pay.example.net to /etc/squid/allowed-domains.txt and reload squid. On web-1: curl -x http://10.0.2.50:3128 …", "aws ssm start-session --target " + ID.proxy + "\necho pay.example.net | sudo tee -a /etc/squid/allowed-domains.txt\nsudo systemctl reload squid\nexit\naws ssm start-session --target " + ID.web1 + "\ncurl -s -x http://10.0.2.50:3128 https://pay.example.net/v1/ping\ncurl -s -x http://10.0.2.50:3128 https://paste.example.org/\nexit"],
        check: function (r) {
          var m = proxyM(r), live = (m.squidLive || {}).allow || [];
          if (live.some(function (d) { return /^(\.?example\.net|\.net|all|\*.*)$/.test(d); })) return "Too broad: allow pay.example.net, not a whole domain.";
          if (!live.some(function (d) { return d === "pay.example.net" || d === ".pay.example.net"; })) return (M2.rd(m, "/etc/squid/allowed-domains.txt") || "").indexOf("pay.example.net") >= 0 ? "It's in the file: reload Squid so it reads it." : "Squid doesn't allow pay.example.net yet.";
          if (!ran(r, /\bcurl\b.*pay\.example\.net/, function (e) { return e.host === HOST.web1 && outHas(e, /"ok":true/); })) return "Show it from web-1: curl -x http://10.0.2.50:3128 https://pay.example.net/v1/ping.";
          return ran(r, /\bcurl\b.*paste\.example\.org/, function (e) { return e.host === HOST.web1 && e.exit !== 0; }) ? true : "And show the paste site is still refused (from web-1, through the proxy).";
        }
      },
      {
        id: "waf", text: "Switch ModSecurity from detecting to <b>blocking</b>, and show that the SQL injection request below now gets <b>403</b>.<br><code>" + SQLI + "</code>",
        hints: ["SecRuleEngine in /etc/nginx/modsec/modsecurity.conf, then reload nginx.", "sudo sed -i 's/^SecRuleEngine DetectionOnly/SecRuleEngine On/' /etc/nginx/modsec/modsecurity.conf\nsudo nginx -t && sudo systemctl reload nginx\ncurl -s -o /dev/null -w '%{http_code}' '" + SQLI + "'"],
        check: function (r) { var live = r.sys.nginxLive, ms = live && (live._modsec || {}); if (!ms || !/^on$/i.test(ms.engine || "")) return /SecRuleEngine\s+On/.test(r.read("/etc/nginx/modsec/modsecurity.conf") || "") ? "It's in the file: reload nginx." : "SecRuleEngine is still DetectionOnly."; return ran(r, /\bcurl\b.*UNION/i, function (e) { return outHas(e, /\b403\b/); }) ? true : "Send the SQL injection request again and look for 403."; }
      },
      {
        id: "rule", text: "Which CRS rule <b>detected</b> the SQL injection (not the one that blocked it)? Find it in the audit log and write its ID to <code>~/waf-rule.txt</code>.",
        hints: ["/var/log/nginx/modsec_audit.log, [id \"…\"]. 949110 is the blocking rule.", "sudo grep -o 'id \"[0-9]*\"' /var/log/nginx/modsec_audit.log | sort | uniq -c\necho 942100 > ~/waf-rule.txt"],
        check: function (r) { if (!ran(r, /modsec_audit\.log/, function (e) { return outHas(e, /942100/); })) return "Look in /var/log/nginx/modsec_audit.log."; var w = word(r, "waf-rule.txt"); return w === "942100" ? true : w === "949110" ? "949110 is the rule that blocked (score over the threshold). Which one matched the attack?" : "Write the rule ID from the audit log."; }
      },
      {
        id: "origin", text: "Attackers skip the CDN by connecting to the origin, <code>203.0.113.80</code>, directly. With ufw, allow 80 and 443 <b>only from the CDN's ranges</b> (<code>~/cdn-ranges.txt</code>), keep SSH, and show from ext-scan-01 that the origin no longer answers while the site still works through the CDN.",
        hints: ["Delete the 80 and 443 rules for everyone, add them from the CDN range. Then: ssh ext-scan-01.example.net curl -sk -m 5 https://203.0.113.80/ and curl -sI https://kestrel.example.com/.", "sudo ufw delete allow 80/tcp\nsudo ufw delete allow 443/tcp\nsudo ufw allow from 192.0.2.128/25 to any port 80 proto tcp\nsudo ufw allow from 192.0.2.128/25 to any port 443 proto tcp\nssh ext-scan-01.example.net curl -sk -m 5 -o /dev/null -w '%{http_code}' https://203.0.113.80/\nssh ext-scan-01.example.net curl -sI https://kestrel.example.com/"],
        check: function (r) {
          var s = r.sys; if (s.lockedOut) return "You locked yourself out: keep the SSH rule.";
          if (N.fwVerdict(s, EXT, 443, "tcp", false, ME) === "accept" || N.fwVerdict(s, EXT, 80, "tcp", false, ME) === "accept") return "The internet can still reach the origin's 80/443 directly.";
          if (N.fwVerdict(s, N.CDN.EDGE_SRC, 443, "tcp", false, ME) !== "accept" || N.fwVerdict(s, N.CDN.EDGE_SRC, 80, "tcp", false, ME) !== "accept") return "The CDN (" + N.CDN.RANGE + ") must still reach 80 and 443.";
          if (N.fwVerdict(s, "198.51.100.20", 22, "tcp", false, ME) !== "accept") return "Keep SSH.";
          var k = idx(r, /\bufw\b/);
          if (!after(r, k, /ssh\s+ext-scan-01.*203\.0\.113\.80/, function (e) { return /\b000\b/.test(e.out.join(" ")) || outHas(e, /timed out|\(28\)/); })) return "Show it from ext-scan-01: curl -sk -m 5 https://203.0.113.80/ should fail.";
          return after(r, k, /ssh\s+ext-scan-01.*kestrel\.example\.com/, function (e) { return outHas(e, /HTTP\/\S+ 200|^200$/) || /\b200\b/.test(e.out.join(" ")); }) ? true : "And show the site still works from ext-scan-01 through the CDN (curl -sI https://kestrel.example.com/).";
        }
      }
    ],
    solution: lines("aws ec2 describe-security-groups --group-names kestrel-web --query 'SecurityGroups[0].IpPermissionsEgress'",
      "aws ec2 revoke-security-group-egress --group-id " + ID.sg("web") + " --protocol all --cidr 0.0.0.0/0",
      "aws ec2 authorize-security-group-egress --group-id " + ID.sg("web") + " --protocol tcp --port 5432 --source-group " + ID.sg("db"),
      "aws ec2 authorize-security-group-egress --group-id " + ID.sg("web") + " --protocol tcp --port 3128 --source-group " + ID.sg("proxy"),
      "aws ssm start-session --target " + ID.web1, "curl -s -m 5 https://pay.example.net/v1/ping", "curl -s -x http://10.0.2.50:3128 https://pay.example.net/v1/ping", "exit",
      "aws ssm start-session --target " + ID.proxy, "cat /etc/squid/allowed-domains.txt", "echo pay.example.net | sudo tee -a /etc/squid/allowed-domains.txt", "sudo systemctl reload squid", "exit",
      "aws ssm start-session --target " + ID.web1, "curl -s -x http://10.0.2.50:3128 https://pay.example.net/v1/ping", "curl -s -x http://10.0.2.50:3128 https://paste.example.org/", "exit",
      "curl -s -o /dev/null -w '%{http_code}' '" + SQLI + "'",
      "sudo sed -i 's/^SecRuleEngine DetectionOnly/SecRuleEngine On/' /etc/nginx/modsec/modsecurity.conf", "sudo nginx -t", "sudo systemctl reload nginx",
      "curl -s -o /dev/null -w '%{http_code}' '" + SQLI + "'",
      "sudo grep -o 'id \"[0-9]*\"' /var/log/nginx/modsec_audit.log | sort | uniq -c", "echo 942100 > ~/waf-rule.txt",
      "ssh ext-scan-01.example.net curl -sk -m 5 -o /dev/null -w '%{http_code}' https://203.0.113.80/",
      "sudo ufw delete allow 80/tcp", "sudo ufw delete allow 443/tcp", "sudo ufw allow from 192.0.2.128/25 to any port 80 proto tcp", "sudo ufw allow from 192.0.2.128/25 to any port 443 proto tcp",
      "ssh ext-scan-01.example.net curl -sk -m 5 -o /dev/null -w '%{http_code}' https://203.0.113.80/", "ssh ext-scan-01.example.net curl -sI https://kestrel.example.com/"),
    debrief: "<p>Outbound is now as deliberate as inbound: the web servers reach the database and the proxy, and the proxy reaches only named destinations. Last week's exfiltration to a paste site would have ended in a <code>403</code> in Squid's log. The WAF blocks the textbook SQL injection now, and its audit log says exactly which rule matched; the origin answers only the CDN, so its protections can't be skipped.</p><p>None of these fixes the application's bugs. They buy time and visibility. The AppSec track deals with the code. Next: all of this, written as code.</p>",
    realworld: "In AWS the managed versions are Network Firewall or a proxy for egress, AWS WAF with managed rule groups, and CloudFront with origin access restricted (a managed prefix list in the origin's security group). The ideas are the ones you just used.",
    quiz: [
      { q: "Why a proxy for outbound web traffic instead of security group rules?", options: ["It's faster", "Security groups can't filter by domain name; the proxy can", "Security groups can't do outbound", "Encryption"], answer: 1, why: "Destinations change addresses; names are what you trust." },
      { q: "ModSecurity is in DetectionOnly. An attack request gets…", options: ["403", "through, and logged", "dropped", "a CAPTCHA"], answer: 1, why: "DetectionOnly never blocks." },
      { q: "Why lock the origin to the CDN's ranges?", options: ["Speed", "Otherwise attackers connect to the origin directly and skip the CDN's caching and filtering", "TLS needs it", "DNS"], answer: 1, why: "A shield with a side door isn't a shield." }
    ]
  });

  /* ================================================================== NET-508 Network rules as code */
  var TF_DIR = "/home/dev/infra/kestrel-network";
  var TF_MAIN = "terraform {\n  required_providers {\n    aws = {\n      source  = \"hashicorp/aws\"\n      version = \"~> 5.74\"\n    }\n  }\n}\n\nprovider \"aws\" {\n  region = \"eu-west-1\"\n}\n\ndata \"aws_vpc\" \"prod\" {\n  tags = {\n    Name = \"kestrel-prod\"\n  }\n}\n";
  var TF_VARS = "variable \"office_cidr\" {\n  description = \"The address Kestrel's office and VPN reach the internet from\"\n  type        = string\n  default     = \"203.0.113.15/32\"\n}\n";
  function sgTf(name, gname, desc, blocks) { return "resource \"aws_security_group\" \"" + name + "\" {\n  name        = \"" + gname + "\"\n  description = \"" + desc + "\"\n  vpc_id      = data.aws_vpc.prod.id\n\n" + blocks.join("\n") + "\n  egress {\n    description = \"Anywhere\"\n    from_port   = 0\n    to_port     = 0\n    protocol    = \"-1\"\n    cidr_blocks = [\"0.0.0.0/0\"]\n  }\n\n  tags = {\n    Name = \"" + gname + "\"\n  }\n}\n"; }
  function ing(desc, port, peer, sgRef) { var o = "  ingress {\n"; if (desc) o += (sgRef ? "    description     = \"" : "    description = \"") + desc + "\"\n"; var pad = sgRef ? "    from_port       = " : "    from_port   = "; o += pad + port + "\n" + (sgRef ? "    to_port         = " : "    to_port     = ") + port + "\n" + (sgRef ? "    protocol        = \"tcp\"\n    security_groups = [" + peer + "]\n" : "    protocol    = \"tcp\"\n    cidr_blocks = [" + peer + "]\n") + "  }\n"; return o; }
  var TF_SG_BAD = [sgTf("alb", "kestrel-alb", "Public load balancer", [ing("HTTP from anywhere (redirects to HTTPS)", 80, "\"0.0.0.0/0\""), ing("HTTPS from anywhere", 443, "\"0.0.0.0/0\"")]),
    sgTf("bastion", "kestrel-bastion", "SSH jump host", [ing("SSH for the contractor (temporary)", 22, "\"0.0.0.0/0\"")]),
    sgTf("web", "kestrel-web", "Web servers", [ing("HTTP from the load balancer", 80, "aws_security_group.alb.id", true), ing("SSH from the bastion", 22, "aws_security_group.bastion.id", true), ing(null, 8080, "\"0.0.0.0/0\"")]),
    sgTf("db", "kestrel-db", "PostgreSQL", [ing("PostgreSQL for the data migration (temporary)", 5432, "\"0.0.0.0/0\""), ing("SSH from the bastion", 22, "aws_security_group.bastion.id", true)])].join("\n");
  var TF_SG_GOOD = [sgTf("alb", "kestrel-alb", "Public load balancer", ["  #checkov:skip=CKV_AWS_260:Port 80 only answers with a redirect to HTTPS\n" + ing("HTTP from anywhere (redirects to HTTPS)", 80, "\"0.0.0.0/0\""), ing("HTTPS from anywhere", 443, "\"0.0.0.0/0\"")]),
    sgTf("bastion", "kestrel-bastion", "SSH jump host", [ing("SSH from the office", 22, "var.office_cidr")]),
    sgTf("web", "kestrel-web", "Web servers", [ing("HTTP from the load balancer", 80, "aws_security_group.alb.id", true), ing("SSH from the bastion", 22, "aws_security_group.bastion.id", true)]),
    sgTf("db", "kestrel-db", "PostgreSQL", [ing("PostgreSQL from the web servers", 5432, "aws_security_group.web.id", true), ing("SSH from the bastion", 22, "aws_security_group.bastion.id", true)])].join("\n");
  var WF = "name: terraform\non:\n  pull_request:\n    paths: [\"**.tf\"]\n\njobs:\n  plan:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n      - uses: hashicorp/setup-terraform@v3\n      - run: terraform init -input=false\n      - run: terraform validate\n      - run: terraform plan -input=false\n";
  var WF_GOOD = WF.replace("      - run: terraform validate\n", "      - run: terraform validate\n      - name: Scan with Checkov\n        run: pipx run checkov -d . --framework terraform\n");
  function tfSys(sys) {
    N.cloudLab(sys); N.tfLab(sys);
    S.mkdirs(sys, TF_DIR + "/.terraform/providers", 493, 1000, 1000); S.mkdirs(sys, TF_DIR + "/.github/workflows", 493, 1000, 1000);
    [["main.tf", TF_MAIN], ["variables.tf", TF_VARS], ["security-groups.tf", TF_SG_BAD], [".github/workflows/terraform.yml", WF], [".terraform.lock.hcl", "# This file is maintained automatically by \"terraform init\".\nprovider \"registry.terraform.io/hashicorp/aws\" {\n  version     = \"5.74.0\"\n  constraints = \"~> 5.74\"\n}\n"]].forEach(function (f) { M2.putRoot(sys, TF_DIR + "/" + f[0], f[1], 420, 1000, 1000, NOW - 2 * DAY); });
    N.tf.seed(sys, TF_DIR);
  }
  function failedIds(r) { var res = N.checkovEval(r.sys, TF_DIR); return res.err ? null : res.failed.map(function (x) { return x.ck.id; }).filter(function (v, i, a) { return a.indexOf(v) === i; }).sort(); }
  LABS.push({
    id: "net-508", n: 47, module: 5, ticket: "NET-508", xp: 210, layer: "L3–4",
    title: "Network rules as code",
    topic: "Terraform security groups (validate, plan, apply), Checkov findings and suppressions with a reason, what scanners miss, a scan in the pipeline",
    from: MAYA,
    story: "<p>Our security groups live in Terraform (<code>~/infra/kestrel-network</code>). Last night's pull request \"for the contractor and the data migration\" was merged and applied without anyone looking closely, and the pipeline has no security scan.</p><p>Scan the code with <b>Checkov</b>, find what it misses, fix the code (not the console!), apply it, and put the scan in the pipeline so the next one gets caught in review.</p>",
    learn:
      "<h3>Terraform in four commands</h3>" + code("terraform init        # once: download providers\nterraform validate    # syntax and references\nterraform plan        # what would change, compared with the state\nterraform apply       # do it (asks for 'yes'; -auto-approve in pipelines)") +
      "<p>The code is the source of truth. A change made in the console is undone (or fought over) at the next apply, so fix the code.</p>" +
      code("resource \"aws_security_group\" \"db\" {\n  ingress {\n    description     = \"PostgreSQL from the web servers\"\n    from_port       = 5432\n    to_port         = 5432\n    protocol        = \"tcp\"\n    security_groups = [aws_security_group.web.id]   # a reference, not an address\n  }\n}") +
      "<h3>Checkov</h3>" + code("checkov -d .                 # every check, passed and failed\ncheckov -d . --compact --quiet   # only failures, without the code") +
      '<table class="t"><tr><th>Check</th><th>Flags</th></tr><tr><td>CKV_AWS_24</td><td>0.0.0.0/0 to port 22</td></tr><tr><td>CKV_AWS_25</td><td>0.0.0.0/0 to port 3389</td></tr><tr><td>CKV_AWS_260</td><td>0.0.0.0/0 to port 80</td></tr><tr><td>CKV_AWS_277</td><td>0.0.0.0/0 to all ports</td></tr><tr><td>CKV_AWS_23</td><td>a group or rule without a description</td></tr></table>' +
      "<p>When a finding is intended, suppress it <b>in the code, with a reason</b> that a reviewer can read: <code>#checkov:skip=CKV_AWS_260:why it's fine</code> inside the resource.</p>" +
      '<div class="callout warn">Scanners only know their rules. Nothing above flags PostgreSQL open to the world. Read the plan.</div>',
    system: tfSys,
    diagram: ["vpc"],
    starter: "",
    objectives: [
      {
        id: "scan", text: "Run Checkov on the directory. Write the IDs of the <b>failed</b> checks to <code>~/failed-checks.txt</code>.",
        hints: ["cd into the directory; checkov -d . (--compact --quiet shows only failures).", "cd ~/infra/kestrel-network\ncheckov -d . --compact --quiet\nprintf 'CKV_AWS_23\\nCKV_AWS_24\\nCKV_AWS_260\\n' > ~/failed-checks.txt"],
        check: function (r) { if (!ran(r, /\bcheckov\b/, function (e) { return outHas(e, /Failed checks: [1-9]/); })) return "Run checkov on ~/infra/kestrel-network."; var got = (r.read("failed-checks.txt") || "").split(/[\s,]+/).filter(Boolean).sort().join(","); return got === "CKV_AWS_23,CKV_AWS_24,CKV_AWS_260" ? true : "Copy the IDs of the checks that FAILED (each once)."; }
      },
      {
        id: "missed", text: "One rule exposes a <b>database</b> to the internet and Checkov said nothing. Which port? Write it to <code>~/missed.txt</code>.",
        hints: ["Read security-groups.tf: which other ingress has 0.0.0.0/0?", "grep -n -B4 '0.0.0.0/0' security-groups.tf\necho 5432 > ~/missed.txt"],
        check: function (r) { return word(r, "missed.txt") === "5432" ? true : "Look for a database port open to 0.0.0.0/0 in security-groups.tf."; }
      },
      {
        id: "fix", text: "Fix <code>security-groups.tf</code>: SSH to the bastion only from <code>var.office_cidr</code>; PostgreSQL only from the web servers' group; remove the undocumented 8080 rule; keep port 80 on the load balancer with a <b>skip comment and a reason</b>. <code>checkov</code> must report 0 failed and <code>terraform validate</code> must pass.",
        hints: ["Edit the file with nano; the skip comment goes inside the alb resource.", "nano security-groups.tf\ncheckov -d . --compact --quiet\nterraform validate"],
        check: function (r) {
          var cfg = N.tf.load({ sys: r.sys, uid: 0, gid: 0, groups: [0], cwd: TF_DIR, user: "root" }, TF_DIR); if (cfg.err) return "security-groups.tf doesn't parse: " + cfg.err.title + " (line " + cfg.err.line + ").";
          var res = N.checkovEval(r.sys, TF_DIR); if (res.failed.length) return "Checkov still fails " + res.failed.map(function (x) { return x.ck.id + " on " + x.r.name; }).join(", ") + ".";
          var skip = res.skipped.filter(function (x) { return x.ck.id === "CKV_AWS_260"; })[0]; if (!skip || skip.r.name !== "alb" || /^No comment provided$/.test(skip.why) || skip.why.length < 10) return "Keep port 80 on the alb and suppress CKV_AWS_260 there, with a reason after the second colon.";
          if (res.skipped.length > 1) return "Only CKV_AWS_260 on the load balancer should be skipped: fix the others.";
          var st = N.tf.stateOf({ sys: r.sys, uid: 0, gid: 0, groups: [0], cwd: TF_DIR }, TF_DIR), want = {}; cfg.resources.forEach(function (x) { want[x.name] = N.tf.desiredSg(x, cfg, st); });
          var b = want.bastion, d = want.db, w = want.web;
          if (!b || b.ingress.some(function (x) { return x.cidr_blocks.indexOf("0.0.0.0/0") >= 0; }) || !b.ingress.some(function (x) { return x.cidr_blocks.indexOf("203.0.113.15/32") >= 0 && /var\.office_cidr/.test(r.read(TF_DIR + "/security-groups.tf") || ""); })) return "Bastion SSH: only from var.office_cidr.";
          if (!d || d.ingress.some(function (x) { return x.from_port <= 5432 && 5432 <= x.to_port && x.cidr_blocks.length; }) || !d.ingress.some(function (x) { return x.from_port === 5432 && x.security_groups.length; })) return "PostgreSQL: only from aws_security_group.web.id (security_groups = [...]).";
          if (!w || w.ingress.some(function (x) { return x.from_port === 8080; })) return "Remove the 8080 rule from web.";
          return ran(r, /terraform\s+validate/, function (e) { return outHas(e, /Success!/); }) ? true : "Run terraform validate.";
        }
      },
      {
        id: "apply", text: "Review the plan and apply it. Then show with the <code>aws</code> CLI that <code>kestrel-db</code> no longer allows 5432 from 0.0.0.0/0.",
        hints: ["terraform plan, then terraform apply -auto-approve.", "terraform plan\nterraform apply -auto-approve\naws ec2 describe-security-groups --group-names kestrel-db --query 'SecurityGroups[0].IpPermissions'"],
        check: function (r) { var c = cl(r), d = sgOf(r, "db"), b = sgOf(r, "bastion"), w = sgOf(r, "web"); if (worldIn(d, 5432)) return "kestrel-db still allows 5432 from anywhere in AWS (apply the change)."; if (worldIn(b, 22)) return "The bastion still allows SSH from anywhere in AWS."; if (worldIn(w, 8080)) return "kestrel-web still has the 8080 rule in AWS."; if (!ran(r, /terraform\s+plan/, function (e) { return outHas(e, /to change/); })) return "Read the plan first (terraform plan)."; var k = idx(r, /terraform\s+apply/); return after(r, k, /describe-security-groups/, function (e) { return /kestrel-db|sg-/.test(e.cmd) && e.exit === 0; }) ? true : "Check kestrel-db with aws ec2 describe-security-groups after the apply."; }
      },
      {
        id: "ci", text: "Add a Checkov step to <code>.github/workflows/terraform.yml</code> that runs <b>before</b> the plan, so the next pull request like this one fails review.",
        hints: ["A step with run: checkov -d . (or pipx run checkov …) between validate and plan.", "nano .github/workflows/terraform.yml\n      - name: Scan with Checkov\n        run: pipx run checkov -d . --framework terraform"],
        check: function (r) { var t = r.read(TF_DIR + "/.github/workflows/terraform.yml") || "", L = t.split("\n"), ck = L.findIndex(function (l) { return /^\s*(-\s*)?(run:.*\bcheckov\b|uses:\s*bridgecrewio\/checkov-action)/.test(l); }), pl = L.findIndex(function (l) { return /terraform\s+plan/.test(l); }); if (ck < 0) return "No step runs checkov in the workflow yet."; if (pl >= 0 && ck > pl) return "Run Checkov before terraform plan."; return /^\s+(- name:|- run:|- uses:|run:|uses:)/.test(L[ck]) ? true : "The step's indentation should match the others."; }
      }
    ],
    solution: lines.apply(null, ["cd ~/infra/kestrel-network", "ls -a", "terraform validate", "terraform plan", "checkov -d . --compact --quiet", "printf 'CKV_AWS_23\\nCKV_AWS_24\\nCKV_AWS_260\\n' > ~/failed-checks.txt",
      "grep -n -B4 '0.0.0.0/0' security-groups.tf", "echo 5432 > ~/missed.txt"].concat(nano("security-groups.tf", TF_SG_GOOD)).concat([
      "checkov -d . --compact --quiet", "terraform validate", "terraform plan", "terraform apply -auto-approve", "aws ec2 describe-security-groups --group-names kestrel-db --query 'SecurityGroups[0].IpPermissions'"]).concat(nano(".github/workflows/terraform.yml", WF_GOOD))),
    debrief: "<p>The fix went where it belongs: in the code, reviewed as a plan, applied by Terraform, with the security group references (<code>aws_security_group.web.id</code>) that keep rules about roles rather than addresses. Checkov caught the world-open SSH, the missing description and port 80 (intended, so it's suppressed with a reason a reviewer can read); it didn't catch PostgreSQL open to the internet, because no rule says \"5432\". That's why people still read plans.</p><p>With the scan in the pipeline, the next \"temporary\" rule fails before it's merged. Last lab: an incident, using everything from this module.</p>",
    realworld: "pipx install checkov (or the bridgecrewio/checkov-action) on any Terraform repository. terraform plan -out tfplan && terraform show -json tfplan | checkov -f - scans the plan, which resolves variables and modules.",
    quiz: [
      { q: "Checkov passes. Is the code safe?", options: ["Yes", "Not necessarily: scanners only know their rules (5432 open to the world wasn't flagged)", "Only if validate passes", "Only in CI"], answer: 1, why: "Scanners help reviewers; they don't replace them." },
      { q: "A finding is intended (port 80 for the redirect). What do you do?", options: ["Ignore it", "Suppress it in the code with a reason", "Turn Checkov off", "Disable the check everywhere"], answer: 1, why: "The reason is part of the review." },
      { q: "Someone fixes a rule in the AWS console instead of Terraform. What happens at the next apply?", options: ["Nothing", "Terraform puts the code's version back", "Terraform adopts the console change", "Apply fails"], answer: 1, why: "The code is the source of truth." }
    ]
  });

  /* ================================================================== NET-509 Capstone: contain a compromised instance */
  var POOL = "198.51.100.23", C2 = "203.0.113.140", ATTACK = "198.51.100.61", EIP = "192.0.2.30";
  var FINDING = { SchemaVersion: "2.0", AccountId: "111122223333", Region: "eu-west-1", Type: "CryptoCurrency:EC2/BitcoinTool.B", Severity: 8, Title: "EC2 instance " + ID.web2 + " is communicating with a Bitcoin mining pool.", Resource: { ResourceType: "Instance", InstanceDetails: { InstanceId: ID.web2, NetworkInterfaces: [{ PrivateIpAddress: "10.0.12.20", PublicIp: EIP, SubnetId: ID.sub("app-b"), VpcId: ID.vpc }] } }, Service: { Action: { ActionType: "NETWORK_CONNECTION", NetworkConnectionAction: { ConnectionDirection: "OUTBOUND", Protocol: "TCP", RemoteIpDetails: { IpAddressV4: POOL }, RemotePortDetails: { Port: 3333 } } }, EventFirstSeen: "2026-11-10T02:21:40Z", EventLastSeen: "2026-11-11T08:58:02Z", Count: 412 } };
  function capFlows(c) {
    var R = X.night(c, { scanner: "198.51.100.140", exfilFrom: "db-1", exfilTo: "185.125.190.36" }).filter(function (x) { return !(x[1] === "10.0.21.30" && x[2] === "185.125.190.36" && x[6] > 200000); });
    var T0 = Date.UTC(2026, 10, 10) / 1000, w = C5.instNamed(c, "web-2");
    R.push([w.eni, ATTACK, w.ip, 50112, 8080, 6, 9, 1820, T0 + 7980, T0 + 8040, "ACCEPT"], [w.eni, ATTACK, w.ip, 50114, 8080, 6, 31, 22100, T0 + 8040, T0 + 8100, "ACCEPT"]);
    for (var k = 0; k < 14; k++) R.push([w.eni, w.ip, POOL, 41000 + k, 3333, 6, 300 + k, 61000 + k * 13, T0 + 8460 + k * 600, T0 + 8520 + k * 600, "ACCEPT"]);
    for (var j = 0; j < 9; j++) R.push([w.eni, w.ip, C2, 43000 + j, 443, 6, 12, 2800 + j * 7, T0 + 8200 + j * 900, T0 + 8260 + j * 900, "ACCEPT"]);
    ["203.0.113.7", "198.51.100.33"].forEach(function (ip, q) { R.push([w.eni, ip, w.ip, 44000 + q, 22, 6, 1, 44, T0 + 9000 + q * 77, T0 + 9060 + q * 77, "REJECT"]); });
    return R;
  }
  function capSys(sys) {
    var c = N.cloudLab(sys), w = C5.instNamed(c, "web-2");
    w.pub = EIP; c.enis.forEach(function (e) { if (e.inst === w.InstanceId) e.pub = EIP; });
    var pb = C5.rtNamed(c, "private-b"); pb.Routes.forEach(function (x) { if (x.DestinationCidrBlock === "0.0.0.0/0") { delete x.NatGatewayId; x.GatewayId = ID.igw; } });
    C5.addRule(c.G.web, C5.rule(false, "tcp", 8080, 8080, "0.0.0.0/0", "debug console (temporary)"));
    S.mkdirs(sys, "/home/dev/flows", 493, 1000, 1000); S.mkdirs(sys, "/home/dev/incident", 493, 1000, 1000);
    C5.putFlowLogs(sys, capFlows(c), "/home/dev/flows/flows-2026-11-10.log");
    M2.putRoot(sys, "/home/dev/incident/finding.json", JSON.stringify(FINDING, null, 2) + "\n", 420, 1000, 1000, NOW - 3600000);
    M2.putRoot(sys, "/home/dev/incident/runbook.md", "# Compromised instance: runbook\n\n1. Contain: replace its security groups with an empty isolation group. Don't stop or terminate it: memory and disk are evidence.\n2. Take it out of service (load balancer target groups), and check the site still works.\n3. Preserve: snapshot its volume.\n4. Scope: from the flow logs, every outside address involved (how they got in, what it talked to). Write them to ~/incident/iocs.txt, one per line.\n   Known good: 185.125.190.36 is archive.ubuntu.com (nightly updates).\n5. Close the way in, everywhere it's open.\n6. Block the addresses for the whole VPC (network ACL), both directions.\n", 420, 1000, 1000, NOW - 30 * DAY);
    sys.remoteSetup = sys.remoteSetup || {};
    sys.remoteSetup[HOST.web2] = function (m) {
      S.mkdirs(m, "/tmp/.x", 493, 33, 33);
      M2.putRoot(m, "/tmp/.x/config.json", "{\n  \"pools\": [{ \"url\": \"" + POOL + ":3333\", \"user\": \"48xQ…\", \"pass\": \"x\" }],\n  \"cpu\": { \"max-threads-hint\": 90 }\n}\n", 420, 33, 33, NOW - DAY + 8460000);
      M2.spawn(m, { cmd: "/tmp/.x/kworkerds -c /tmp/.x/config.json", comm: "kworkerds", uid: 33, start: Date.UTC(2026, 10, 10, 2, 21), cpu: 88.5, cpuSecs: 98000 });
      M2.spawn(m, { cmd: "/usr/bin/node /srv/shop/debug-console.js --port 8080", comm: "node", uid: 33, start: NOW - 6 * DAY, listen: [{ proto: "tcp", addr: "0.0.0.0", port: 8080 }] });
    };
  }
  var CAP_PORTS = [22, 80, 443, 3333, 8080];
  LABS.push({
    id: "net-509", n: 48, module: 5, ticket: "NET-509", xp: 300, layer: "L1–7",
    title: "Contain a compromised instance", capstone: true,
    topic: "Capstone: isolate without destroying evidence, keep the service up, snapshot, scope with flow logs, close the hole, block the addresses",
    from: DEV,
    story: "<p>A security alert at 09:00: <b>web-2 is talking to a cryptocurrency mining pool</b> (<code>~/incident/finding.json</code>). Someone \"temporarily\" opened a debug console on it last week. You're on call.</p><p>Follow the runbook in <code>~/incident/runbook.md</code>. The shop must keep working throughout, and nothing that could be evidence may be destroyed.</p>",
    learn:
      "<h3>Contain, then investigate</h3><ul><li><b>Don't stop or terminate</b> the instance: its memory (running processes, connections) and disk are evidence. Isolate it instead.</li><li>An <b>isolation security group</b> with no inbound and no outbound rules cuts it off; Session Manager can still reach it in real accounts through VPC endpoints.</li><li>Remove it from load balancer target groups so users aren't served by a compromised machine.</li><li>Snapshot the volume before anyone changes anything.</li><li>Then scope (flow logs), close the way in, and block the addresses involved.</li></ul>" +
      '<div class="callout">Everything you need was in this module. The solution is hidden: revealing it halves the XP.</div>',
    system: capSys,
    diagram: ["vpc", "site"],
    starter: "",
    objectives: [
      { id: "isolate", hints: [], text: "web-2 is <b>isolated</b>: its only security group has no inbound and no outbound rules. It is still <b>running</b>.", check: function (r) { var w = C5.instNamed(cl(r), "web-2"); if (w.state !== "running") return "web-2 is " + w.state + ": its memory is gone. Isolate, don't stop (reset and try again)."; if (w.sgs.length !== 1) return "web-2 should have exactly one security group: the isolation group."; var g = C5.sgNamed(cl(r), w.sgs[0]); if (g.rules.length) return "The isolation group (" + g.GroupName + ") still has " + g.rules.length + " rule(s); remove the default outbound rule too."; return true; } },
      { id: "lb", hints: [], text: "web-2 no longer receives traffic from the load balancer, and the shop still answers <b>200</b> through it.", check: function (r) { var c = cl(r), t = c.tgs[0]; if (t.targets.some(function (x) { return x.id === ID.web2; })) return "web-2 is still registered in kestrel-web-tg."; var res = N.httpTo(r.sys, "192.0.2.20", 80, { scheme: "http", host: C5.ALB_DNS, port: 80, path: "/", method: "GET", headers: { host: C5.ALB_DNS } }); return res.status === 200 ? true : "The shop doesn't answer 200 through the load balancer (" + res.status + ")."; } },
      { id: "evidence", hints: [], text: "There's a <b>snapshot</b> of web-2's volume.", check: function (r) { var c = cl(r), w = C5.instNamed(c, "web-2"); return c.snapshots.some(function (s) { return s.VolumeId === w.vol; }) ? true : "Snapshot web-2's volume (aws ec2 create-snapshot)."; } },
      { id: "iocs", hints: [], text: "<code>~/incident/iocs.txt</code> lists every <b>outside</b> address involved: where the attacker connected from, and what web-2 talked to afterwards. Nothing else.", check: function (r) { var got = ((r.read("/home/dev/incident/iocs.txt") || "").match(/\b\d{1,3}(\.\d{1,3}){3}\b/g) || []).filter(function (v, i, a) { return a.indexOf(v) === i; }).sort(), want = [ATTACK, POOL, C2].sort(); if (!got.length) return "Write the addresses to ~/incident/iocs.txt."; var extra = got.filter(function (x) { return want.indexOf(x) < 0; }), miss = want.filter(function (x) { return got.indexOf(x) < 0; }); if (extra.length) return extra[0] + " isn't part of the incident" + (/^10\./.test(extra[0]) ? " (and it's internal)" : "") + "."; return miss.length ? miss.length + " address(es) missing: look at everything on web-2's interface around the alert, in and out." : true; } },
      { id: "hole", hints: [], text: "The way in is <b>closed</b>: no security group in the VPC allows anything from 0.0.0.0/0 except the load balancer's 80/443 and the office's SSH; web-2's subnet routes through the NAT gateway again; web-2 has no public address.", check: function (r) { var c = cl(r); var bad = c.sgs.filter(function (g) { return g.key !== "alb" && g.rules.some(function (x) { return !x.egress && x.cidr === "0.0.0.0/0"; }); })[0]; if (bad) return bad.GroupName + " still allows traffic from 0.0.0.0/0."; var rt = C5.routeTo(c, ID.sub("app-b"), "8.8.8.8"); if (!rt || !rt.NatGatewayId) return "app-b's default route should go to the NAT gateway."; return C5.instNamed(c, "web-2").pub ? "web-2 still has a public address (disassociate it)." : true; } },
      { id: "block", hints: [], text: "The three addresses are blocked for <b>every subnet</b> by network ACL: the attacker inbound, the other two outbound. Normal traffic still works.", check: function (r) { var c = cl(r); for (var i = 0; i < c.subnets.length; i++) { var s = c.subnets[i], a = C5.aclFor(c, s.SubnetId); if (C5.aclCheck(a, false, "tcp", 8080, ATTACK).ok) return s.Tags[0].Value + " still lets " + ATTACK + " in."; if (C5.aclCheck(a, true, "tcp", 3333, POOL).ok || C5.aclCheck(a, true, "tcp", 443, C2).ok) return s.Tags[0].Value + " can still send to " + POOL + " or " + C2 + "."; } if (!flowOk(r, EXT, "192.0.2.20", 80).ok) return "Other internet clients can't reach the load balancer any more."; return flowOk(r, "10.0.11.20", "185.125.190.36", 80).ok ? true : "web-1 can't reach Ubuntu's mirrors any more: block only the three addresses."; } }
    ],
    solution: lines("cat ~/incident/runbook.md", "cat ~/incident/finding.json",
      "aws ec2 create-security-group --group-name kestrel-quarantine --description 'Isolation: no traffic' --vpc-id " + ID.vpc,
      "aws ec2 revoke-security-group-egress --group-id " + C5.hid("sg", "kestrel-quarantine" + 6) + " --protocol all --cidr 0.0.0.0/0",
      "aws ec2 modify-instance-attribute --instance-id " + ID.web2 + " --groups " + C5.hid("sg", "kestrel-quarantine" + 6),
      "aws elbv2 deregister-targets --target-group-arn " + ID.tg + " --targets Id=" + ID.web2,
      "curl -s -o /dev/null -w '%{http_code}' http://" + C5.ALB_DNS + "/",
      "aws ec2 describe-volumes --filters Name=attachment.instance-id,Values=" + ID.web2 + " --query 'Volumes[0].VolumeId' --output text",
      "aws ec2 create-snapshot --volume-id vol-0" + M2.hexOf("vol:web-2", 16) + " --description 'IR: web-2 mining alert'",
      "grep 10.0.12.20 ~/flows/flows-2026-11-10.log | awk '$13 == \"ACCEPT\" {print $4, $5, $7}' | grep -v ' 10\\.0\\.' | sort | uniq -c | sort -rn",
      "printf '" + ATTACK + "\\n" + POOL + "\\n" + C2 + "\\n' > ~/incident/iocs.txt",
      "aws ec2 revoke-security-group-ingress --group-id " + ID.sg("web") + " --protocol tcp --port 8080 --cidr 0.0.0.0/0",
      "aws ec2 replace-route --route-table-id " + ID.rtb("private-b") + " --destination-cidr-block 0.0.0.0/0 --nat-gateway-id " + ID.nat,
      "aws ec2 disassociate-address --public-ip " + EIP,
      "aws ec2 create-network-acl-entry --network-acl-id " + ID.acl + " --ingress --rule-number 80 --protocol -1 --cidr-block " + ATTACK + "/32 --rule-action deny",
      "aws ec2 create-network-acl-entry --network-acl-id " + ID.acl + " --egress --rule-number 80 --protocol -1 --cidr-block " + POOL + "/32 --rule-action deny",
      "aws ec2 create-network-acl-entry --network-acl-id " + ID.acl + " --egress --rule-number 81 --protocol -1 --cidr-block " + C2 + "/32 --rule-action deny"),
    debrief: "<p><b>Module 5 complete, and with it the Networking track.</b> You contained an incident the way responders do: web-2 is cut off but still running for the forensics team, the shop never stopped answering, the disk is preserved, and you know exactly who was involved, from the flow logs. The hole had three parts (a world-open debug port, a private subnet made public, a public address) and all three are closed; the addresses are blocked for the whole VPC.</p>" +
      "<p>Five modules: from a cable and an ARP request on kc-web-01 to an incident in an AWS account. The layers never changed: addresses and routes, ports and firewalls, names, TLS and identities. The DevOps track is next.</p>",
    realworld: "AWS publishes an incident response playbook for EC2 that follows these same steps; GuardDuty findings like CryptoCurrency:EC2/BitcoinTool.B are among the most common in real accounts.",
    quiz: []
  });

  LABS.forEach(function (l) { l.drills = l.drills || []; T.LABS.push(l); });
  T.UPCOMING = T.UPCOMING.filter(function (x) { return x.module !== 5; });
  Object.assign(X, { mtlsSys: mtlsSys, egressSys: egressSys, tfSys: tfSys, capSys: capSys, PAY_SITE: PAY_SITE, PAY_SITE_MTLS: PAY_SITE_MTLS, TF_DIR: TF_DIR, TF_SG_BAD: TF_SG_BAD, TF_SG_GOOD: TF_SG_GOOD, WF: WF, WF_GOOD: WF_GOOD, certAt: certAt, keyOf: keyOf, payReq: payReq, SQLI: SQLI, failedIds: failedIds });
})();
