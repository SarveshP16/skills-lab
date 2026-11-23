/* sudo learn — DevOps Module 4 lab world: the laptop kc-dev-01 with kubectl, helm, argocd and a kubeconfig for the
   kestrel-staging cluster (k3s v1.31 on four nodes, ingress-nginx, metrics-server, optional cert-manager, Kyverno
   and Argo CD), Kestrel's service images in ghcr.io, and the laptop's view of the cluster from outside: the
   Ingress address and *.staging.kestrel.dev names, LoadBalancer IPs and NodePorts. Check helpers in K.H. */
(function (root) {
  "use strict";
  var S = root.ShEngine, M2 = S.M2, Dk = root.Dk, CI = root.CI, GH = root.GitHub, K = root.K8s, DL = root.DevLab;
  var keys = K.keys, clone = K.clone;
  var HOME = "/home/dev", MB = 1048576;
  K.HOME = HOME;
  function sc() { return Array.prototype.slice.call(arguments).filter(function (x) { return x !== null; }).join("\n") + "\n"; }

  /* ================================================================== Kestrel images in ghcr.io */
  function site(pkgs) {
    var f = {}, sp = "/usr/local/lib/python3.12/site-packages";
    pkgs.forEach(function (p) { var P = Dk.PIP[p[0]]; var mod = P ? P.mod : p[0]; f[sp + "/" + mod] = Dk.Dd(); f[sp + "/" + mod + "/__init__.py"] = Dk.F("# " + p[0] + "\n", 420, 0, 0, 2e5); f[sp + "/" + p[0].replace(/-/g, "_") + "-" + p[1] + ".dist-info"] = Dk.Dd(); f[sp + "/" + p[0].replace(/-/g, "_") + "-" + p[1] + ".dist-info/METADATA"] = Dk.F("Metadata-Version: 2.1\nName: " + p[0] + "\nVersion: " + p[1] + "\n"); });
    f["/usr/local/bin/gunicorn"] = Dk.bin("dkgunicorn");
    return f;
  }
  var FLASK = [["flask", "3.1.1"], ["werkzeug", "3.1.3"], ["jinja2", "3.1.6"], ["markupsafe", "3.0.2"], ["itsdangerous", "2.2.0"], ["click", "8.1.8"], ["blinker", "1.9.0"], ["gunicorn", "23.0.0"], ["packaging", "24.2"]];
  var ORDERS_PY = sc("# Kestrel orders API: takes orders, queues them for the worker", "import os", "", "import psycopg", "import redis", "from flask import Flask, jsonify, request", "", "VERSION = \"3.1.0\"", "", "app = Flask(__name__)", "db = psycopg.connect(os.environ[\"DATABASE_URL\"])", "queue = redis.Redis.from_url(os.environ[\"REDIS_URL\"])", "", "", "@app.get(\"/health\")", "def health():", "    return jsonify(status=\"ok\", version=VERSION)", "", "", "@app.post(\"/orders\")", "def create_order():", "    item = request.get_json()[\"item\"]", "    order_id = db.execute(\"INSERT INTO orders (item, status) VALUES (%s, 'pending') RETURNING id\", (item,)).fetchone()[0]", "    queue.lpush(\"orders\", order_id)", "    return jsonify(id=order_id, status=\"pending\"), 201");
  var PAY_PY = sc("# Kestrel payments API: talks to the payment provider for the shop", "import os", "", "from flask import Flask, jsonify", "", "VERSION = \"2.1.0\"", "if \"PAYMENTS_API_KEY_FILE\" in os.environ:", "    with open(os.environ[\"PAYMENTS_API_KEY_FILE\"]) as f:", "        API_KEY = f.read().strip()", "else:", "    API_KEY = os.environ.get(\"PAYMENTS_API_KEY\")", "if not API_KEY:", "    raise RuntimeError(\"PAYMENTS_API_KEY is not set\")", "", "app = Flask(__name__)", "", "", "@app.get(\"/health\")", "def health():", "    return jsonify(status=\"ok\")");
  var SHOP_CONF = sc("server {", "    listen 8080;", "    root /usr/share/nginx/html;", "    index index.html;", "", "    location /api/ {", "        proxy_pass http://orders-api:8000/;", "    }", "}");
  var SHOP_HTML = "<!doctype html>\n<title>Kestrel shop</title>\n<h1>Kestrel shop</h1>\n<p>Mugs, hoodies and stickers.</p>\n";
  function pyImage(sys, key, src, pkgs, o) {
    o = o || {};
    return DL.setup.image(sys, { from: "python:3.12-slim", key: key, created: o.created != null ? o.created : -86400 * (o.daysAgo || 6), layers: [
      { by: "WORKDIR /app", files: { "/app": Dk.Dd() }, size: 0 },
      { by: "RUN /bin/sh -c pip install --no-cache-dir -r requirements.txt # buildkit", files: site(pkgs) },
      { by: "COPY app.py . # buildkit", files: { "/app/app.py": Dk.F(src) } },
      { by: "RUN /bin/sh -c useradd --uid 10001 --no-create-home --shell /usr/sbin/nologin app # buildkit", files: { "/etc/passwd": Dk.F("root:x:0:0:root:/root:/bin/bash\napp:x:10001:10001::/home/app:/usr/sbin/nologin\n") } }
    ], cfg: { WorkingDir: "/app", User: o.user != null ? o.user : "10001", ExposedPorts: { "8000/tcp": {} }, Cmd: ["gunicorn", "-b", "0.0.0.0:8000", "app:app"], Labels: Object.assign({ "org.opencontainers.image.version": o.version || "1.0.0", "org.opencontainers.image.source": "https://github.com/" + (o.repo || "kestrel/notes-api") }, o.labels || {}) } });
  }
  K.pyImage = pyImage;
  // versions of notes-api with simulated behaviour carried in image labels
  var NOTES = {
    "1.4.0": {}, "1.5.0": {}, "1.6.0": {},
    "1.6.1": { labels: { "kestrel.sim/hang-after-seconds": "75" } },
    "1.7.0": { labels: { "kestrel.sim/warmup-seconds": "45" } },
    "1.7.1": { labels: { "kestrel.sim/warmup-seconds": "45" } }
  };
  K.NOTES_VERSIONS = NOTES;
  K.publishImages = function (sys, o) {
    o = o || {};
    var dg = {};
    keys(NOTES).forEach(function (v, i) {
      var im = CI.notesImage(sys, v, { daysAgo: 40 - i * 6, key: "-k8s" });
      Object.assign(im.cfg.Labels, NOTES[v].labels || {});
      dg["notes-api:" + v] = DL.setup.publish(sys, "ghcr.io/kestrel/notes-api:" + v, im);
    });
    dg["orders-api:3.1.0"] = DL.setup.publish(sys, "ghcr.io/kestrel/orders-api:3.1.0", pyImage(sys, "orders-3.1.0", ORDERS_PY, FLASK.concat([["psycopg", "3.2.9"], ["psycopg-binary", "3.2.9"], ["redis", "5.2.1"]]), { version: "3.1.0", repo: "kestrel/orders-api" }));
    dg["payments-api:2.1.0"] = DL.setup.publish(sys, "ghcr.io/kestrel/payments-api:2.1.0", pyImage(sys, "pay-2.1.0", PAY_PY, FLASK, { version: "2.1.0", repo: "kestrel/payments-api" }));
    var web = DL.setup.image(sys, { from: "nginx:1.27-alpine", key: "shop-web-2.0.0", created: -86400 * 5, layers: [{ by: "COPY default.conf /etc/nginx/conf.d/default.conf # buildkit", files: { "/etc/nginx/conf.d/default.conf": Dk.F(SHOP_CONF) } }, { by: "COPY dist/ /usr/share/nginx/html/ # buildkit", files: { "/usr/share/nginx/html/index.html": Dk.F(SHOP_HTML) } }], cfg: { ExposedPorts: { "8080/tcp": {} }, Labels: { "org.opencontainers.image.version": "2.0.0", "org.opencontainers.image.source": "https://github.com/kestrel/shop-web" } } });
    dg["shop-web:2.0.0"] = DL.setup.publish(sys, "ghcr.io/kestrel/shop-web:2.0.0", web);
    // the root-running build from before the hardening work
    var webRoot = DL.setup.image(sys, { from: "nginx:1.27-alpine", key: "shop-web-1.9.0", created: -86400 * 30, layers: [{ by: "COPY dist/ /usr/share/nginx/html/ # buildkit", files: { "/usr/share/nginx/html/index.html": Dk.F(SHOP_HTML) } }], cfg: { Labels: { "org.opencontainers.image.version": "1.9.0" } } });
    dg["shop-web:1.9.0"] = DL.setup.publish(sys, "ghcr.io/kestrel/shop-web:1.9.0", webRoot);
    K.digests = dg;
    return dg;
  };

  /* ================================================================== the laptop: tools, kubeconfig */
  K.CA = "LS0tLS1CRUdJTiBDRVJUSUZJQ0FURS0tLS0tCk1JSUJkekNDQVIyZ0F3SUJBZ0lCQURBS0JnZ3Foa2pPUFFRREFqQWpNU0V3SHdZRFZRUUREQmhyTTNNdGMyVnkKLS0tLS1FTkQgQ0VSVElGSUNBVEUtLS0tLQo=";
  K.kubeconfigText = function (cl, users, current) {
    users = users || [{ name: "kc-dev", cn: "kc-dev", groups: ["kestrel:sre"] }];
    return sc("apiVersion: v1", "clusters:", "- cluster:", "    certificate-authority-data: " + K.CA, "    server: " + cl.server, "  name: kestrel-staging", "contexts:")
      + users.map(function (u) { return sc("- context:", "    cluster: kestrel-staging", u.ns ? "    namespace: " + u.ns : null, "    user: " + u.name, "  name: " + (u.ctx || (u.name === "kc-dev" ? "kestrel-staging" : u.name + "@kestrel-staging"))); }).join("")
      + sc("current-context: " + (current || "kestrel-staging"), "kind: Config", "preferences: {}", "users:")
      + users.map(function (u) { return u.token ? sc("- name: " + u.name, "  user:", "    token: " + u.token) : sc("- name: " + u.name, "  user:", "    client-certificate-data: " + K.makeCert(u.cn || u.name, u.groups || []), "    client-key-data: " + K.b64("-----BEGIN EC PRIVATE KEY-----\nMHcCAQEEI" + K.rand("key" + u.name, 40) + "\n-----END EC PRIVATE KEY-----\n")); }).join("");
  };
  function put(sys, path, text, mode) { DL.setup.files(sys, path.replace(/\/[^/]*$/, ""), (function () { var m = {}; m[path.split("/").pop()] = text; return m; })(), mode); var n = Dk.fsNode(sys, path); if (n) { n.uid = 1000; n.gid = 1000; if (mode) n.mode = mode; } }
  K.put = put;
  K.files = function (sys, map) { keys(map).forEach(function (k) { if (map[k] != null) put(sys, HOME + "/" + k, map[k]); }); };
  // apply manifests as the cluster's admin during setup
  K.seed = function (cl, docs, o) {
    o = o || {};
    var res = [];
    (Array.isArray(docs) ? docs : [docs]).forEach(function (d) {
      if (typeof d === "string") { var pd = K.kubectl.parseDocs(d, "setup.yaml"); if (pd.error) throw new Error(pd.error); pd.docs.forEach(function (x) { res.push(x.obj); }); }
      else res.push(d);
    });
    res.forEach(function (obj) { var r = K.write(cl, obj, { ns: o.ns || "default", mode: "apply", source: "setup.yaml" }); if (r.error) throw new Error("seed: " + r.error); });
  };
  // a whole lab world. o: {comps, namespaces: {name: labels}, objects: [yaml or obj], files, repo, after(sys, cl), users, ctxNs, settle}
  K.world = function (o) {
    o = o || {};
    return CI.world({ clone: false, tag: true, admin: true, releases: o.releases || ["1.4.0", "1.5.0"], after: function (sys, r) {
      ["kubectl", "helm", "argocd", "kustomize"].forEach(function (b) { CI.putBin(sys, "/usr/local/bin/" + b, b); });
      if (!Dk.fsNode(sys, "/usr/bin/base64")) CI.putBin(sys, "/usr/bin/base64", "base64");
      K.publishImages(sys, o);
      var cloneLater = false;
      var cl = K.make(sys, { comps: o.comps });
      // nodes pull from ghcr.io with a read-only token (k3s registries.yaml)
      var tok = CI.machineUser(sys, "kestrel-cluster", ["read:packages"]);
      cl.nodeCreds = { "ghcr.io": { user: "kestrel-cluster", pass: tok } };
      var users = [{ name: "kc-dev", cn: "kc-dev", groups: ["kestrel:sre"], ns: o.ctxNs }].concat(o.users || []);
      K.sysObj(cl, { kind: "ClusterRoleBinding", metadata: { name: "kestrel-sre-admins" }, roleRef: { apiGroup: "rbac.authorization.k8s.io", kind: "ClusterRole", name: "cluster-admin" }, subjects: [{ apiGroup: "rbac.authorization.k8s.io", kind: "Group", name: "kestrel:sre" }] });
      keys(o.namespaces || {}).forEach(function (n) { K.ensureNs(cl, n, o.namespaces[n]); });
      cl.rt.dk.t = -2 * 86400;
      K.reconcile(cl);
      if (o.before) o.before(sys, cl);
      if (o.repo) {
        GH.seed(sys, o.repo.name || "kestrel/k8s-config", { steps: [{ msg: o.repo.msg || "config: staging", by: "maya", at: "2026-11-16 10:00", files: o.repo.files }].concat(o.repo.steps || []) }, { description: o.repo.description || "Kubernetes configuration for Kestrel's services" });
        var x = GH.find(sys, o.repo.name || "kestrel/k8s-config"); x.collab["kc-dev"] = "admin";
        if (o.repo.clone !== false) cloneLater = true;
      }
      if (o.objects) K.seed(cl, o.objects, { ns: o.ctxNs || "default" });
      K.advance(cl, o.settle != null ? o.settle : 40);
      if (o.mid) { o.mid(sys, cl); K.advance(cl, 20); }
      Dk.state(cl.rt).t = 0;
      cl.lastActive = -1e9;
      cl.events.forEach(function (e) { e.first = Math.min(e.first, -3600); e.last = Math.min(e.last, -3600); });
      put(sys, HOME + "/.kube/config", K.kubeconfigText(cl, users), 384);
      if (o.files) K.files(sys, o.files);
      if (cloneLater) GH.cloneTo(sys, o.repo.name || "kestrel/k8s-config", HOME + "/" + (o.repo.dir || "k8s-config"));
      if (o.after) o.after(sys, cl);
      K.reconcile(cl);
      K.current = cl;
      void r;
    } });
  };

  /* ================================================================== from the laptop: Ingress, LoadBalancers, NodePorts */
  var HOSTS_K8S = ["notes", "shop", "api", "payments", "web", "status", "argocd", "orders", "app"];
  K.INGRESS_HOSTS = HOSTS_K8S.map(function (h) { return h + ".staging.kestrel.dev"; }).concat(["notes.kestrel.dev", "shop.kestrel.dev"]);
  function cur() { return K.current; }
  function nginxPage(code, title) { return { status: code, headers: { "Content-Type": "text/html", Server: "nginx" }, body: "<html>\r\n<head><title>" + code + " " + title + "</title></head>\r\n<body>\r\n<center><h1>" + code + " " + title + "</h1></center>\r\n<hr><center>nginx</center>\r\n</body>\r\n</html>\r\n" }; }
  // send req to a service's endpoint pod (from an outside source) -> response
  function toService(cl, svc, port, req, from) {
    var pe = K.pickEndpoint(cl, svc, port, 0);
    if (pe.noPort) return { err: { code: 7, msg: "Failed to connect to " + req.host + " port " + req.port + " after 0 ms: Couldn't connect to server" } };
    if (pe.none) return null;
    var pol = K.policyAllows(cl, from.pod || null, from.ip, pe.pod, pe.pod.status.podIP, pe.port, "TCP");
    if (!pol.ok) return { timeout: true };
    var c = K.listener(cl, pe.pod, pe.port);
    if (!c) return { refused: true };
    if (c.k8sHangAt != null && K.t(cl) >= c.k8sHangAt) return { timeout: true };
    var r = Dk.ctrHttp(cl.rt, c, pe.port, Object.assign({}, req, { port: pe.port }), from.pod ? from.pod.status.podIP : from.ip);
    if (!r || r.closed) return { refused: true };
    return r;
  }
  K.toService = toService;
  function ingressCtlPod(cl) { return K.list(cl, "Pod", "ingress-nginx").filter(function (p) { return /ingress-nginx-controller/.test(p.metadata.name) && K.podReady(p); })[0]; }
  K.ingressRoute = function (cl, req) {
    var host = String((req.headers || {}).host || req.host).replace(/:\d+$/, ""), path = req.path.split("?")[0];
    var best = null;
    K.all(cl, "Ingress").forEach(function (g) {
      var cls = g.spec.ingressClassName || "nginx"; if (cls !== "nginx") return;
      (g.spec.rules || []).forEach(function (r) {
        if (r.host && r.host !== host && !(r.host.charAt(0) === "*" && host.slice(-r.host.length + 1) === r.host.slice(1))) return;
        ((r.http || {}).paths || []).forEach(function (p) {
          var ok = p.pathType === "Exact" ? path === p.path : path === p.path || path.indexOf(p.path.replace(/\/$/, "") + "/") === 0 || p.path === "/";
          if (ok && (!best || p.path.length > best.p.path.length || (r.host && !best.r.host))) best = { g: g, r: r, p: p };
        });
      });
    });
    return best;
  };
  K.ingressServe = function (cl, req, client) {
    K.touch(cl, 0);
    var b = K.ingressRoute(cl, req), ctl = ingressCtlPod(cl);
    if (!ctl) return { err: { code: 7, msg: "Failed to connect to " + req.host + " port " + req.port + " after 0 ms: Couldn't connect to server" } };
    var host = String((req.headers || {}).host || req.host).replace(/:\d+$/, "");
    if (req.scheme === "https") {
      var tls = null; K.all(cl, "Ingress").forEach(function (g) { (g.spec.tls || []).forEach(function (t) { if ((t.hosts || []).indexOf(host) >= 0) tls = { g: g, t: t }; }); });
      var sec = tls && K.get(cl, "Secret", tls.g.metadata.namespace, tls.t.secretName);
      var good = sec && sec.type === "kubernetes.io/tls" && (!sec._cert || ((sec._cert.dns || []).indexOf(host) >= 0 && sec._cert.trusted));
      if (!good && !req.insecure) return { err: { code: 60, msg: "SSL certificate problem: " + (sec && sec._cert && !sec._cert.trusted ? "unable to get local issuer certificate" : "self-signed certificate") + "\nMore details here: https://curl.se/docs/sslcerts.html\n\ncurl failed to verify the legitimacy of the server and therefore could not\nestablish a secure connection to it. To learn more about this situation and\nhow to fix it, please visit the web page mentioned above." } };
    } else if (b && (b.g.spec.tls || []).some(function (t) { return (t.hosts || []).indexOf(host) >= 0; }) && (b.g.metadata.annotations || {})["nginx.ingress.kubernetes.io/ssl-redirect"] !== "false") {
      return { status: 308, headers: { "Content-Type": "text/html", Server: "nginx", Location: "https://" + host + req.path }, body: "<html>\r\n<head><title>308 Permanent Redirect</title></head>\r\n<body>\r\n<center><h1>308 Permanent Redirect</h1></center>\r\n<hr><center>nginx</center>\r\n</body>\r\n</html>\r\n" };
    }
    if (!b) return nginxPage(404, "Not Found");
    var sb = b.p.backend.service, svc = K.get(cl, "Service", b.g.metadata.namespace, sb.name);
    if (!svc) return nginxPage(503, "Service Temporarily Unavailable");
    var sp = (svc.spec.ports || []).filter(function (p) { return sb.port.number != null ? p.port === sb.port.number : p.name === sb.port.name; })[0];
    if (!sp) return nginxPage(503, "Service Temporarily Unavailable");
    var rewrite = (b.g.metadata.annotations || {})["nginx.ingress.kubernetes.io/rewrite-target"];
    var req2 = Object.assign({}, req, { path: rewrite ? rewrite.replace(/\$\d/g, "") + req.path.slice(b.p.path.length).replace(/^\//, "") : req.path, headers: Object.assign({}, req.headers, { "x-forwarded-for": client || "203.0.113.15", "x-forwarded-proto": req.scheme, "x-real-ip": client || "203.0.113.15" }) });
    var r = toService(cl, svc, sp.port, req2, { pod: ctl });
    if (!r) return nginxPage(503, "Service Temporarily Unavailable");
    if (r.timeout) return nginxPage(504, "Gateway Time-out");
    if (r.refused) return nginxPage(502, "Bad Gateway");
    return r;
  };
  function nodeServe(cl, ip, req) {
    var svc = K.all(cl, "Service").filter(function (s) { return s.spec.type !== "ClusterIP" && (s.spec.ports || []).some(function (p) { return p.nodePort === req.port; }); })[0];
    if (!svc) return { err: { code: 7, msg: "Failed to connect to " + req.host + " port " + req.port + " after 0 ms: Couldn't connect to server" } };
    if (svc.metadata.namespace === "ingress-nginx") return K.ingressServe(cl, Object.assign({}, req, { scheme: req.port === 31443 ? "https" : "http" }));
    var sp = svc.spec.ports.filter(function (p) { return p.nodePort === req.port; })[0];
    var r = toService(cl, svc, sp.port, req, { ip: "10.40.0.1" });
    if (!r) return { err: { code: 7, msg: "Failed to connect to " + req.host + " port " + req.port + " after 0 ms: Couldn't connect to server" } };
    if (r.timeout) return { err: { code: 28, msg: "Failed to connect to " + req.host + " port " + req.port + " after 130000 ms: Couldn't connect to server" } };
    if (r.refused) return { err: { code: 7, msg: "Failed to connect to " + req.host + " port " + req.port + " after 0 ms: Couldn't connect to server" } };
    return r;
  }
  function lbServe(cl, ip, req) {
    var svc = K.all(cl, "Service").filter(function (s) { return ((((s.status || {}).loadBalancer || {}).ingress) || []).some(function (x) { return x.ip === ip; }); })[0];
    if (!svc) return { err: { code: 28, msg: "Failed to connect to " + req.host + " port " + req.port + " after 130000 ms: Couldn't connect to server" } };
    if (svc.metadata.namespace === "ingress-nginx") return K.ingressServe(cl, req);
    var r = toService(cl, svc, req.port, req, { ip: "203.0.113.15" });
    if (!r || r.refused) return { err: { code: 7, msg: "Failed to connect to " + req.host + " port " + req.port + " after 0 ms: Couldn't connect to server" } };
    if (r.timeout) return { err: { code: 28, msg: "Failed to connect to " + req.host + " port " + req.port + " after 130000 ms: Couldn't connect to server" } };
    if (r.err) return r;
    return r;
  }
  if (M2.net && M2.net.SITES) {
    var NET = M2.net;
    K.INGRESS_HOSTS.forEach(function (h) { NET.DNS[h] = { A: [K.INGRESS_IP] }; });
    NET.HOSTS[K.INGRESS_IP] = { ping: 6.1, ports: [80, 443], site: "k8s-ingress" };
    NET.SITES["k8s-ingress"] = function (req, sys) { var cl = K.of(sys) || cur(); if (!cl) return { err: { code: 7, msg: "Failed to connect to " + req.host + " port " + req.port + " after 0 ms: Couldn't connect to server" } }; return K.ingressServe(cl, req); };
    K.NODES.forEach(function (n) {
      Object.defineProperty(NET.HOSTS, n.ip, { enumerable: true, configurable: true, get: function () { var cl = cur(), ports = [22, 6443, 10250]; if (cl) K.all(cl, "Service").forEach(function (s) { (s.spec.ports || []).forEach(function (p) { if (p.nodePort && s.spec.type !== "ClusterIP") ports.push(p.nodePort); }); }); return { ping: 0.9, ports: ports, site: "k8s-node:" + n.ip }; } });
      NET.SITES["k8s-node:" + n.ip] = function (req, sys) { var cl = K.of(sys) || cur(); return nodeServe(cl, n.ip, req); };
    });
    for (var i = 81; i < 100; i++) (function (ip) {
      Object.defineProperty(NET.HOSTS, ip, { enumerable: true, configurable: true, get: function () { var cl = cur(), ports = []; if (cl) K.all(cl, "Service").forEach(function (s) { if (((((s.status || {}).loadBalancer || {}).ingress) || []).some(function (x) { return x.ip === ip; })) (s.spec.ports || []).forEach(function (p) { ports.push(p.port); }); }); return ports.length ? { ping: 5.8, ports: ports, site: "k8s-lb:" + ip } : { ping: null, ports: [] }; } });
      NET.SITES["k8s-lb:" + ip] = function (req, sys) { var cl = K.of(sys) || cur(); return lbServe(cl, ip, req); };
    })("198.51.100." + i);
  }

  /* ================================================================== check helpers */
  var H = K.H = {
    cl: function (r) { return K.of(r.sys); },
    get: function (r, kind, ns, name) { var cl = K.of(r.sys); return cl ? K.get(cl, kind, ns, name) : null; },
    list: function (r, kind, ns, sel) { var cl = K.of(r.sys); if (!cl) return []; return K.list(cl, kind, ns, sel ? function (l) { return K.matches(sel, l); } : null); },
    pods: function (r, ns, sel) { return H.list(r, "Pod", ns, sel).filter(function (p) { return !K.terminating(p); }); },
    ready: function (p) { return K.podReady(p); },
    running: function (r, ns, sel) { return H.pods(r, ns, sel).filter(K.podReady); },
    deploy: function (r, ns, name) { return H.get(r, "Deployment", ns, name); },
    deployOk: function (r, ns, name, n) { var d = H.deploy(r, ns, name); if (!d) return false; var st = d.status || {}; return (n == null || d.spec.replicas === n) && (st.availableReplicas || 0) >= d.spec.replicas && (st.updatedReplicas || 0) >= d.spec.replicas && (st.replicas || 0) === d.spec.replicas; },
    images: function (d) { return ((d.spec.template || d.spec).spec || d.spec).containers.map(function (c) { return c.image; }); },
    ctr: function (spec, name) { return (spec.containers || []).filter(function (c) { return !name || c.name === name; })[0]; },
    tpl: function (d) { return d.kind === "Pod" ? d.spec : d.kind === "CronJob" ? d.spec.jobTemplate.spec.template.spec : d.spec.template.spec; },
    audit: function (r, fn) { var cl = K.of(r.sys); return cl ? cl.audit.filter(fn || function () { return true; }) : []; },
    events: function (r, fn) { var cl = K.of(r.sys); return cl ? cl.events.filter(fn || function () { return true; }) : []; },
    ingress: function (r, host, path, scheme) { var cl = K.of(r.sys); return cl ? K.ingressServe(cl, { scheme: scheme || "http", host: host, port: scheme === "https" ? 443 : 80, path: path || "/", method: "GET", headers: { host: host } }) : null; },
    svcHttp: function (r, ns, name, port, path) { var cl = K.of(r.sys), s = cl && K.get(cl, "Service", ns, name); if (!s) return null; return toService(cl, s, port || s.spec.ports[0].port, { scheme: "http", host: name, port: port || s.spec.ports[0].port, path: path || "/", method: "GET", headers: { host: name } }, { ip: "10.42.9.9" }); },
    // can a pod (by label) reach host:port inside the cluster?
    reach: function (r, ns, sel, host, port) { var cl = K.of(r.sys), p = cl && H.running(r, ns, sel)[0]; if (!p) return null; var c = K.ctrOf(cl, p); return K.connect(cl, c, host, port); },
    exec: function (r, p, argv) { var cl = K.of(r.sys), c = cl && K.ctrOf(cl, p); if (!c) return null; var x = Dk.runIn(cl.rt, c, argv, {}); return { code: x.code, text: (x.lines || []).map(function (l) { return l.text; }).join("") }; },
    can: function (r, user, verb, kind, ns, name) { var cl = K.of(r.sys), info = K.KINDS[kind] || K.kindOf(cl, kind); return K.can(cl, K.subjectOf(cl, null, user), verb, info.plural, info.group, ns, name); },
    file: function (r, path) { return r.read(path.replace(/^~/, HOME)); },
    yaml: function (r, path) { var t = H.file(r, path); if (t == null) return null; var pd = K.kubectl.parseDocs(t, path); return pd.error ? null : pd.docs.map(function (d) { return d.obj; }); },
    out: function (e) { return e.out.join("\n"); },
    all: function (e) { return e.lines.map(function (l) { return l.text; }).join("\n"); },
    ran: function (r, re, fn) { return r.history.some(function (e) { return re.test(e.cmd) && (!fn || fn(e)); }); },
    idx: function (r, re, fn) { var k = -1; r.history.forEach(function (e, i) { if (re.test(e.cmd) && (!fn || fn(e))) k = i; }); return k; }
  };

  /* ================================================================== explanations for Kubernetes errors */
  var SL = root.ShLab;
  if (SL && SL.EXPLAIN) [
    [/strict decoding error: unknown field "([^"]+)"/, "The API server doesn't know that field: usually a typo or wrong indentation. kubectl explain TYPE.FIELD shows the real names (e.g. kubectl explain deployment.spec)."],
    [/`selector` does not match template `labels`/, "A Deployment's spec.selector.matchLabels must match spec.template.metadata.labels, or it would never find its own pods."],
    [/field is immutable/, "That field can't change after creation (a Deployment's selector, a Job's template). Delete and recreate the object, or create a new one alongside it."],
    [/is waiting to start: (trying and failing to pull image|ContainerCreating)/, "The container hasn't started, so it has no logs yet. kubectl describe pod NAME shows why in Events (image pull, missing ConfigMap/Secret, volume)."],
    [/ImagePullBackOff|ErrImagePull/, "The node can't pull the image: check the name and tag exist (a typo, a tag never pushed) and that the registry accepts the node's credentials (imagePullSecrets)."],
    [/CrashLoopBackOff/, "The container starts and exits again and again. kubectl logs POD --previous shows the last run's output; kubectl describe pod shows the exit code."],
    [/CreateContainerConfigError/, "The kubelet can't build the container's configuration: a missing ConfigMap/Secret or key, or runAsNonRoot with an image that runs as root."],
    [/OOMKilled/, "The container used more memory than its limit and the kernel killed it. Raise resources.limits.memory, or fix what's using the memory."],
    [/0\/\d+ nodes are available/, "The scheduler found no node for the pod: read each reason (Insufficient cpu/memory = requests too big, untolerated taint, node selector, volume)."],
    [/is forbidden: User .* cannot/, "RBAC: that identity has no Role/ClusterRole granting this verb on this resource here. kubectl auth can-i VERB RESOURCE --as=USER checks; a RoleBinding grants it."],
    [/violates PodSecurity "restricted/, "The namespace enforces the restricted Pod Security Standard: set the listed securityContext fields (runAsNonRoot, allowPrivilegeEscalation: false, capabilities drop ALL, seccompProfile RuntimeDefault)."],
    [/admission webhook "validate\.kyverno\.svc/, "A Kyverno policy rejected the object: the message names the policy and rule. Fix the manifest (or the image) rather than the policy."],
    [/exceeded its progress deadline/, "The rollout didn't make progress within progressDeadlineSeconds: new pods aren't becoming ready. kubectl rollout undo goes back; kubectl describe/logs on the new pods shows why."],
    [/no matches for kind "\w+" in version/, "That kind isn't installed in this cluster (its CRD is missing), or the apiVersion is wrong. kubectl api-resources lists what exists."],
    [/Unable to connect to the server|connection to the server localhost:8080 was refused/, "kubectl can't reach the cluster: check the kubeconfig (kubectl config current-context, kubectl config get-contexts)."],
    [/Error: INSTALLATION FAILED: cannot re-use a name that is still in use/, "A release with that name already exists in this namespace: use helm upgrade (or helm upgrade --install)."],
    [/ComparisonError|OutOfSync/, "Argo CD's view of Git differs from the cluster. argocd app diff shows what; argocd app sync applies Git (selfHeal does it automatically)."]
  ].reverse().forEach(function (e) { SL.EXPLAIN.unshift(e); });
})(typeof window !== "undefined" ? window : globalThis);
