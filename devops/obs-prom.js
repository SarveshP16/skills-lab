/* sudo learn — DevOps Module 5: metrics. A traffic model drives the cluster's apps (requests per second per
   Ingress host/path, split across ready pods; errors and latency come from each pod's image, configuration and
   dependencies), and a Prometheus scrapes them every 15 seconds of cluster time into a small TSDB: app metrics
   (only for targets a ServiceMonitor selects), kube-state-metrics, cAdvisor, node-exporter and ingress-nginx.
   PromQL: selectors, range vectors, offset, rate/irate/increase and *_over_time, aggregations with by/without,
   histogram_quantile, binary operators with on/ignoring/group_left, and/or/unless, label_replace,
   predict_linear, absent... Rules, alerts and Alertmanager are at the end of this file. */
(function (root) {
  "use strict";
  var S = root.ShEngine, M2 = S.M2, Dk = root.Dk, K = root.K8s;
  var O = root.Obs = root.Obs || {};
  function keys(o) { return o ? Object.keys(o) : []; }
  var STEP = 15, KEEP = 3 * 3600;

  /* ================================================================== state */
  O.of = function (cl) { return cl && cl.obs; };
  O.init = function (cl, o) {
    o = o || {};
    cl.obs = { series: {}, ctr: {}, next: null, traffic: o.traffic || [], effects: o.effects || [], rules: [], alerts: {}, am: { groups: {}, silences: [], notifs: [], cfgVer: "" }, logs: [], traces: [], falco: [], logOff: {}, dashboards: {}, lastEval: null };
    return cl.obs;
  };
  function rnd(seed) { var h = 2166136261, s = String(seed); for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = (h * 16777619) >>> 0; } return (h % 100000) / 100000; }
  O.rnd = rnd;
  O.unix = function (cl, t) { return Dk.stamp(cl.rt, t) / 1000; };

  /* ================================================================== the TSDB */
  function skey(name, labels) { return name + "{" + keys(labels).sort().map(function (k) { return k + "=" + JSON.stringify(String(labels[k])); }).join(",") + "}"; }
  O.skey = skey;
  function put(ob, name, labels, t, v) {
    var k = skey(name, labels), s = ob.series[k];
    if (!s) { s = ob.series[k] = { name: name, labels: Object.assign({ __name__: name }, labels), t: [], v: [] }; }
    if (s.t.length && s.t[s.t.length - 1] >= t) { s.v[s.v.length - 1] = v; return; }
    s.t.push(t); s.v.push(v);
    if (s.t.length > 2 && t - s.t[0] > KEEP) { var cut = 0; while (cut < s.t.length && t - s.t[cut] > KEEP) cut++; s.t.splice(0, cut); s.v.splice(0, cut); }
  }
  O.put = put;
  function inc(ob, key, by) { ob.ctr[key] = (ob.ctr[key] || 0) + by; return ob.ctr[key]; }

  /* ================================================================== how a pod behaves */
  function labelsOf(cl, p, cname) { var r = p._rt && p._rt.ctrs && p._rt.ctrs[cname || p.spec.containers[0].name]; var c = r && r.c; if (!c) return {}; var img = Dk.imageById(cl.rt, c.image); return (img && img.cfg.Labels) || {}; }
  function parseMap(s) { var m = {}; String(s || "").split(",").forEach(function (kv) { var i = kv.lastIndexOf("="); if (i > 0) m[kv.slice(0, i).trim()] = kv.slice(i + 1).trim(); }); return m; }
  O.appKind = function (cl, p) {
    var c = K.ctrOf(cl, p); if (!c) return null;
    var img = (c.imageRef || "") + " " + p.spec.containers[0].image;
    if (/notes-api/.test(img)) return "notes"; if (/orders-api/.test(img)) return "orders"; if (/payments-api/.test(img)) return "payments"; if (/shop-web/.test(img)) return "web";
    if (/postgres/.test(img)) return "postgres"; if (/redis/.test(img)) return "redis";
    return "other";
  };
  var BASE = { notes: { "/notes": [35, 140], "/export": [240, 900] }, orders: { "/orders": [55, 220], "/health": [3, 8] }, payments: { "/charge": [120, 480] }, web: { "/": [3, 14] } };
  // -> {err: ratio, code, p50, p99 (ms), timeout}
  O.behave = function (cl, p, path, t) {
    var kind = O.appKind(cl, p), lb = labelsOf(cl, p), env = K.ctrOf(cl, p) ? (K.ctrOf(cl, p).env || {}) : {};
    var base = (BASE[kind] || {})[path] || [20, 90], b = { err: 0.0008, code: "500", p50: base[0], p99: base[1], timeout: false };
    var errs = parseMap(lb["kestrel.sim/errors"]), lat = parseMap(lb["kestrel.sim/latency"]);
    if (errs[path] != null) b.err = +errs[path];
    if (lat[path]) { var pl = lat[path].split(":"); b.p50 = +pl[0]; b.p99 = +pl[1]; }
    var c = K.ctrOf(cl, p);
    if (!c || c.state !== "running") return { down: true };
    if (c.k8sHangAt != null && K.t(cl) >= c.k8sHangAt) return { err: 1, code: "504", p50: 30000, p99: 30000, timeout: true };
    if (kind === "orders") {
      var db = K.connect(cl, c, "db", 5432);
      if (!db.ok) { b.err = 1; b.code = "500"; b.dep = "db"; }
      var pool = +(env.DB_POOL_SIZE || 10);
      if (pool < 4 && path === "/orders") { b.p50 += 900 * (4 - pool); b.p99 += 2600 * (4 - pool); b.poolWait = 900 * (4 - pool); }
    }
    (cl.obs.effects || []).forEach(function (fx) { var r = fx(cl, p, path, t, kind); if (r) Object.assign(b, r); });
    return b;
  };
  // a lognormal-ish latency split into histogram buckets
  var LE = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];
  O.LE = LE;
  function cdf(x, p50, p99) { if (x <= 0) return 0; var mu = Math.log(p50), sig = Math.max(0.05, Math.log(Math.max(p99, p50 * 1.01) / p50) / 2.326), z = (Math.log(x) - mu) / sig; return 0.5 * (1 + erf(z / Math.SQRT2)); }
  function erf(x) { var s = x < 0 ? -1 : 1; x = Math.abs(x); var t = 1 / (1 + 0.3275911 * x); var y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x); return s * y; }
  O.cdf = cdf;

  /* ================================================================== who gets scraped */
  // ServiceMonitors (monitoring.coreos.com/v1) with release: monitoring select Services; their pods become targets
  O.targets = function (cl) {
    var out = [];
    (K.all(cl, "ServiceMonitor") || []).forEach(function (sm) {
      if (((sm.metadata.labels || {}).release) !== "monitoring") return;
      var sp = sm.spec || {}, nsSel = sp.namespaceSelector || {}, nss = nsSel.any ? null : (nsSel.matchNames || [sm.metadata.namespace]);
      K.all(cl, "Service").forEach(function (svc) {
        if (nss && nss.indexOf(svc.metadata.namespace) < 0) return;
        if (!sp.selector || !K.matches(sp.selector, svc.metadata.labels || {})) return;
        (sp.endpoints || []).forEach(function (ep) {
          var port = (svc.spec.ports || []).filter(function (x) { return x.name && x.name === ep.port; })[0];
          if (!port) return;
          K.endpointsOf(cl, svc, true).forEach(function (pod) {
            out.push({ job: svc.metadata.name, svc: svc, pod: pod, port: K.targetPort(port, pod), portName: port.name, path: ep.path || "/metrics", interval: ep.interval || "30s", sm: sm });
          });
        });
      });
    });
    return out;
  };
  function scrapeOk(cl, tg) { var c = K.listener(cl, tg.pod, tg.port); if (!c || !K.podReady(tg.pod)) return false; var kind = O.appKind(cl, tg.pod); return tg.path === "/metrics" && /^(notes|orders|payments)$/.test(kind || ""); }

  /* ================================================================== one scrape tick */
  function tick(cl, t, backfill) {
    var ob = cl.obs, dt = STEP;
    var pods = K.all(cl, "Pod").filter(function (p) { return !K.terminating(p); });
    // traffic: each entry is {host, path, method, rps} through the Ingress, or {ns, svc, path, method, rps}
    var served = {}; // pod uid -> [{path, method, n, err, code, p50, p99}]
    var ingress = []; // {host, ns, svc, ing, status, n, p50, p99}
    function hit(pod, path, method, n, bh) { (served[pod.metadata.uid] = served[pod.metadata.uid] || []).push({ path: path, method: method, n: n, b: bh, pod: pod }); }
    (ob.traffic || []).forEach(function (tr) {
      var mult = tr.mult ? tr.mult(cl, t) : 1, n = tr.rps * mult * dt;
      if (!(n > 0)) return;
      var svc, ing = null, ns;
      if (tr.host) {
        var route = K.ingressRoute(cl, { host: tr.host, path: tr.path, headers: { host: tr.host } });
        if (!route) { ingress.push({ host: tr.host, status: "404", n: n, p50: 2, p99: 5 }); return; }
        ing = route.g; ns = ing.metadata.namespace; svc = K.get(cl, "Service", ns, route.p.backend.service.name);
      } else { ns = tr.ns; svc = K.get(cl, "Service", tr.ns, tr.svc); }
      if (!svc) { if (ing) ingress.push({ host: tr.host, ns: ns, svc: "", ing: ing, status: "503", n: n, p50: 1, p99: 3 }); return; }
      var eps = K.endpointsOf(cl, svc).filter(function (p) { return !K.terminating(p); });
      if (!eps.length) { if (ing) ingress.push({ host: tr.host, ns: ns, svc: svc.metadata.name, ing: ing, status: "503", n: n, p50: 1, p99: 3 }); return; }
      eps.forEach(function (pod, i) {
        var share = n / eps.length, appPath = tr.path;
        // the shop's web proxies /api/* to orders-api
        var kind = O.appKind(cl, pod);
        if (kind === "web" && /^\/api\//.test(tr.path)) {
          var api = K.get(cl, "Service", ns, "orders-api"), aeps = api ? K.endpointsOf(cl, api) : [];
          var allowed = api && aeps.length && K.policyAllows(cl, pod, pod.status.podIP, aeps[0], aeps[0].status.podIP, 8000, "TCP").ok;
          if (!allowed) { var b0 = { err: 1, code: aeps.length ? "504" : "502", p50: aeps.length ? 60000 : 2, p99: aeps.length ? 60000 : 5 }; hit(pod, tr.path, tr.method || "GET", share, b0); if (ing) ingress.push({ host: tr.host, ns: ns, svc: svc.metadata.name, ing: ing, status: b0.code, n: share, p50: b0.p50, p99: b0.p99 }); return; }
          aeps.forEach(function (ap) { var bb = O.behave(cl, ap, tr.path.replace(/^\/api/, ""), t); if (bb.down) return; hit(ap, tr.path.replace(/^\/api/, ""), tr.method || "GET", share / aeps.length, bb); var b2 = { err: bb.err, code: bb.code === "500" ? "502" : bb.code, p50: bb.p50 + 3, p99: bb.p99 + 6 }; hit(pod, tr.path, tr.method || "GET", share / aeps.length, b2); if (ing) { ingress.push({ host: tr.host, ns: ns, svc: svc.metadata.name, ing: ing, status: "200", n: share / aeps.length * (1 - bb.err), p50: b2.p50, p99: b2.p99 }); if (bb.err) ingress.push({ host: tr.host, ns: ns, svc: svc.metadata.name, ing: ing, status: b2.code, n: share / aeps.length * bb.err, p50: b2.p50, p99: b2.p99 }); } });
          return;
        }
        var b = O.behave(cl, pod, appPath, t);
        if (b.down) { if (ing) ingress.push({ host: tr.host, ns: ns, svc: svc.metadata.name, ing: ing, status: "502", n: share, p50: 1, p99: 3 }); return; }
        if (ing && ing.metadata.namespace && K.list(cl, "NetworkPolicy", ns).length) { var ctl = K.list(cl, "Pod", "ingress-nginx")[0]; if (ctl && !K.policyAllows(cl, ctl, ctl.status.podIP, pod, pod.status.podIP, K.targetPort((svc.spec.ports || [])[0] || {}, pod) || 80, "TCP").ok) { ingress.push({ host: tr.host, ns: ns, svc: svc.metadata.name, ing: ing, status: "504", n: share, p50: 60000, p99: 60000 }); return; } }
        hit(pod, appPath, tr.method || "GET", share, b);
        if (ing) { ingress.push({ host: tr.host, ns: ns, svc: svc.metadata.name, ing: ing, status: "200", n: share * (1 - b.err), p50: b.p50 + 1, p99: b.p99 + 3 }); if (b.err) ingress.push({ host: tr.host, ns: ns, svc: svc.metadata.name, ing: ing, status: b.code, n: share * b.err, p50: b.p50 + 1, p99: b.p99 + 3 }); }
        void i;
      });
    });
    // app counters (kept even when nobody scrapes them, like a real process)
    pods.forEach(function (p) {
      var list = served[p.metadata.uid] || [], rc = ((p.status.containerStatuses || [])[0] || {}).restartCount || 0, pk = p.metadata.uid + "#" + rc;
      list.forEach(function (h) {
        var ok = h.n * (1 - h.b.err), bad = h.n - ok;
        inc(ob, pk + "|req|" + h.method + "|" + h.path + "|200", ok);
        if (bad > 0) inc(ob, pk + "|req|" + h.method + "|" + h.path + "|" + h.b.code, bad);
        LE.forEach(function (le) { inc(ob, pk + "|le|" + h.method + "|" + h.path + "|" + le, h.n * cdf(le * 1000, h.b.p50, h.b.p99)); });
        inc(ob, pk + "|le|" + h.method + "|" + h.path + "|+Inf", h.n);
        inc(ob, pk + "|sum|" + h.method + "|" + h.path, h.n * h.b.p50 / 1000 * 1.15);
        ob.lastHits = ob.lastHits || {}; ob.lastHits[p.metadata.uid] = list;
      });
    });
    // logs and traces from this tick's requests
    if (O.emitLogs) O.emitLogs(cl, t, served, backfill);
    // scraped app targets
    var tg = O.targets(cl), seenTg = {};
    tg.forEach(function (x) {
      var p = x.pod, rc = ((p.status.containerStatuses || [])[0] || {}).restartCount || 0, pk = p.metadata.uid + "#" + rc, base = { job: x.job, namespace: p.metadata.namespace, pod: p.metadata.name, service: x.svc.metadata.name, endpoint: x.portName, instance: p.status.podIP + ":" + x.port, container: p.spec.containers[0].name };
      var key = skey("up", base); if (seenTg[key]) return; seenTg[key] = 1;
      var ok = scrapeOk(cl, x);
      put(ob, "up", base, t, ok ? 1 : 0);
      if (!ok) return;
      keys(ob.ctr).forEach(function (k) {
        if (k.indexOf(pk + "|") !== 0) return;
        var parts = k.split("|"), v = ob.ctr[k];
        if (parts[1] === "req") put(ob, "http_requests_total", Object.assign({ method: parts[2], path: parts[3], code: parts[4] }, base), t, v);
        else if (parts[1] === "le") put(ob, "http_request_duration_seconds_bucket", Object.assign({ method: parts[2], path: parts[3], le: parts[4] }, base), t, v);
        else if (parts[1] === "sum") put(ob, "http_request_duration_seconds_sum", Object.assign({ method: parts[2], path: parts[3] }, base), t, v);
      });
      keys(ob.ctr).forEach(function (k) { if (k.indexOf(pk + "|le|") === 0 && /\|\+Inf$/.test(k)) { var parts = k.split("|"); put(ob, "http_request_duration_seconds_count", Object.assign({ method: parts[2], path: parts[3] }, base), t, ob.ctr[k]); } });
      var c = K.ctrOf(cl, p);
      put(ob, "process_resident_memory_bytes", base, t, Math.round(c ? K.podMem(cl, p, t) * 0.9 : 46e6));
    });
    // ingress-nginx
    ingress.forEach(function (x) {
      var lab = { job: "ingress-nginx-controller", namespace: "ingress-nginx", controller_class: "k8s.io/ingress-nginx", host: x.host, status: x.status, method: "GET", exported_namespace: x.ns || "", exported_service: x.svc || "", ingress: x.ing ? x.ing.metadata.name : "" };
      var k = "ing|" + skey("r", lab);
      put(ob, "nginx_ingress_controller_requests", lab, t, inc(ob, k, x.n));
      var lb = { job: "ingress-nginx-controller", namespace: "ingress-nginx", host: x.host, exported_namespace: x.ns || "", exported_service: x.svc || "", ingress: x.ing ? x.ing.metadata.name : "" };
      LE.concat(["+Inf"]).forEach(function (le) { var kk = "ingle|" + skey("b", Object.assign({ le: le }, lb)); put(ob, "nginx_ingress_controller_request_duration_seconds_bucket", Object.assign({ le: String(le) }, lb), t, inc(ob, kk, le === "+Inf" ? x.n : x.n * cdf(le * 1000, x.p50, x.p99))); });
    });
    // kube-state-metrics, cAdvisor, node-exporter
    var ksm = { job: "kube-state-metrics", instance: "10.42.1.4:8080" };
    K.all(cl, "Pod").forEach(function (p) {
      var ns = p.metadata.namespace, pn = p.metadata.name, ph = p.status.phase || "Pending";
      put(ob, "kube_pod_info", Object.assign({ namespace: ns, pod: pn, node: p.spec.nodeName || "", pod_ip: p.status.podIP || "", created_by_kind: ((p.metadata.ownerReferences || [])[0] || {}).kind || "" }, ksm), t, 1);
      ["Pending", "Running", "Succeeded", "Failed", "Unknown"].forEach(function (x) { put(ob, "kube_pod_status_phase", Object.assign({ namespace: ns, pod: pn, phase: x }, ksm), t, ph === x ? 1 : 0); });
      put(ob, "kube_pod_status_ready", Object.assign({ namespace: ns, pod: pn, condition: "true" }, ksm), t, K.podReady(p) ? 1 : 0);
      (p.spec.containers || []).forEach(function (c) {
        var st = (p.status.containerStatuses || []).filter(function (s) { return s.name === c.name; })[0] || { restartCount: 0, state: {} };
        var cl2 = Object.assign({ namespace: ns, pod: pn, container: c.name }, ksm);
        // history before now: restart times recorded for the backfill (O.crashHistory, O.leakHistory)
        var rcH = (p._rt || {}).rcHist;
        put(ob, "kube_pod_container_status_restarts_total", cl2, t, Math.max(0, (st.restartCount || 0) - (rcH ? rcH.filter(function (x) { return x > t; }).length : 0)));
        var lt = (st.lastState || {}).terminated; if (lt) put(ob, "kube_pod_container_status_last_terminated_reason", Object.assign({ reason: lt.reason }, cl2), t, 1);
        var w = (st.state || {}).waiting; ["CrashLoopBackOff", "ImagePullBackOff", "ErrImagePull", "CreateContainerConfigError", "ContainerCreating"].forEach(function (r) { put(ob, "kube_pod_container_status_waiting_reason", Object.assign({ reason: r }, cl2), t, w && w.reason === r ? 1 : 0); });
        var res = c.resources || {};
        ["limits", "requests"].forEach(function (k) { var q = res[k] || {}; if (q.memory) put(ob, "kube_pod_container_resource_" + k, Object.assign({ resource: "memory", unit: "byte", node: p.spec.nodeName || "" }, cl2), t, K.mem(q.memory)); if (q.cpu) put(ob, "kube_pod_container_resource_" + k, Object.assign({ resource: "cpu", unit: "core", node: p.spec.nodeName || "" }, cl2), t, K.cpu(q.cpu) / 1000); });
        if (p.status.phase === "Running" && p.spec.nodeName && !(p._rt || {}).virtual) {
          var cad = { job: "kubelet", metrics_path: "/metrics/cadvisor", namespace: ns, pod: pn, container: c.name, node: p.spec.nodeName, instance: K.nodeIp(cl, p.spec.nodeName) + ":10250" };
          put(ob, "container_cpu_usage_seconds_total", cad, t, inc(ob, "cpu|" + p.metadata.uid + "|" + c.name, K.podCpu(cl, p) / 1000 * dt));
          put(ob, "container_memory_working_set_bytes", cad, t, Math.round(K.podMem(cl, p, t) * (0.92 + rnd(pn + Math.floor(t / 60)) * 0.06)));
        }
      });
    });
    K.all(cl, "Deployment").forEach(function (d) { var lb = Object.assign({ namespace: d.metadata.namespace, deployment: d.metadata.name }, ksm), st = d.status || {}; put(ob, "kube_deployment_spec_replicas", lb, t, d.spec.replicas); put(ob, "kube_deployment_status_replicas_available", lb, t, st.availableReplicas || 0); put(ob, "kube_deployment_status_replicas_unavailable", lb, t, st.unavailableReplicas || 0); });
    K.all(cl, "StatefulSet").forEach(function (d) { put(ob, "kube_statefulset_status_replicas_ready", Object.assign({ namespace: d.metadata.namespace, statefulset: d.metadata.name }, ksm), t, (d.status || {}).readyReplicas || 0); });
    K.all(cl, "Node").forEach(function (n, i) {
      var nip = n.status.addresses[0].address, ne = { job: "node-exporter", instance: nip + ":9100", node: n.metadata.name };
      put(ob, "kube_node_status_condition", Object.assign({ node: n.metadata.name, condition: "Ready", status: "true" }, ksm), t, 1);
      var used = K.all(cl, "Pod").filter(function (p) { return p.spec.nodeName === n.metadata.name && p.status.phase === "Running"; }).reduce(function (s, p) { return s + K.podCpu(cl, p); }, 90) / 1000;
      ["0", "1"].forEach(function (cpu) { put(ob, "node_cpu_seconds_total", Object.assign({ cpu: cpu, mode: "idle" }, ne), t, inc(ob, "ncpu|" + i + cpu + "idle", Math.max(0, 1 - used / 2) * dt)); put(ob, "node_cpu_seconds_total", Object.assign({ cpu: cpu, mode: "user" }, ne), t, inc(ob, "ncpu|" + i + cpu + "user", used / 2 * 0.8 * dt)); put(ob, "node_cpu_seconds_total", Object.assign({ cpu: cpu, mode: "system" }, ne), t, inc(ob, "ncpu|" + i + cpu + "sys", used / 2 * 0.2 * dt)); });
      var memUsed = 900e6 + K.all(cl, "Pod").filter(function (p) { return p.spec.nodeName === n.metadata.name && p.status.phase === "Running"; }).reduce(function (s, p) { return s + K.podMem(cl, p); }, 0);
      put(ob, "node_memory_MemTotal_bytes", ne, t, 4294967296); put(ob, "node_memory_MemAvailable_bytes", ne, t, 4294967296 - memUsed);
      var fsFill = (ob.diskFill || {})[n.metadata.name] || 0;
      put(ob, "node_filesystem_size_bytes", Object.assign({ device: "/dev/nvme0n1p1", fstype: "ext4", mountpoint: "/" }, ne), t, 42e9);
      put(ob, "node_filesystem_avail_bytes", Object.assign({ device: "/dev/nvme0n1p1", fstype: "ext4", mountpoint: "/" }, ne), t, Math.max(1e8, 42e9 * (0.61 - (typeof fsFill === "function" ? fsFill(t) : fsFill))));
    });
    put(ob, "up", { job: "prometheus", instance: "localhost:9090", namespace: "monitoring" }, t, 1);
    put(ob, "up", { job: "kube-state-metrics", instance: "10.42.1.4:8080", namespace: "monitoring" }, t, 1);
    if (O.evalRules) O.evalRules(cl, t, backfill);
  }
  O.tick = tick;
  // run scrapes up to now; on a big jump only the last 2h are filled in
  O.catchUp = function (cl) {
    var ob = cl.obs; if (!ob) return;
    var now = Math.floor(K.t(cl) / STEP) * STEP;
    if (ob.next == null) ob.next = now - 2 * 3600;
    if (now - ob.next > 2 * 3600) ob.next = now - 2 * 3600;
    var guard = 0;
    while (ob.next <= now && guard++ < 1000) { tick(cl, ob.next, now - ob.next > 120); ob.next += STEP; }
  };
  K.ctlHooks.push(function (cl, o) { if (cl.obs && !o.boot && !cl.obsBusy) { cl.obsBusy = true; try { O.catchUp(cl); } finally { cl.obsBusy = false; } } });

  /* ================================================================== PromQL: lexer and parser */
  function PErr(msg, pos) { this.message = msg; this.pos = pos; }
  O.PErr = PErr;
  var DUR = /^(\d+(?:ms|s|m|h|d|w|y))+$/;
  function durSecs(s) { var t = 0; String(s).replace(/(\d+)(ms|s|m|h|d|w|y)/g, function (m0, n, u) { t += +n * { ms: 0.001, s: 1, m: 60, h: 3600, d: 86400, w: 604800, y: 31536000 }[u]; }); return t; }
  O.durSecs = durSecs;
  var AGG = ["sum", "avg", "min", "max", "count", "topk", "bottomk", "quantile", "stddev", "stdvar", "count_values", "group"];
  function lex(src) {
    var toks = [], i = 0;
    while (i < src.length) {
      var ch = src.charAt(i), rest = src.slice(i), m;
      if (/\s/.test(ch)) { i++; continue; }
      if (ch === "#") { while (i < src.length && src.charAt(i) !== "\n") i++; continue; }
      if ((m = /^(==|!=|>=|<=|=~|!~|[-+*\/%^<>=(){}\[\],:@])/.exec(rest))) { toks.push({ t: "op", v: m[1], pos: i }); i += m[1].length; continue; }
      if (ch === '"' || ch === "'" || ch === "`") { var j = i + 1, s = ""; while (j < src.length && src.charAt(j) !== ch) { if (src.charAt(j) === "\\" && ch !== "`") { j++; s += { n: "\n", t: "\t" }[src.charAt(j)] || src.charAt(j); } else s += src.charAt(j); j++; } if (j >= src.length) throw new PErr("unterminated quoted string " + src.slice(i), i); toks.push({ t: "str", v: s, pos: i }); i = j + 1; continue; }
      if ((m = /^(\d+(?:ms|s|m|h|d|w|y))+/.exec(rest)) && !/^\d+(\.\d+)?e/i.test(rest)) { toks.push({ t: "dur", v: m[0], pos: i }); i += m[0].length; continue; }
      if ((m = /^(0x[0-9a-f]+|\d*\.?\d+(?:e[+-]?\d+)?|Inf|NaN)/i.exec(rest)) && /[\d.]/.test(ch)) { toks.push({ t: "num", v: +m[1], pos: i }); i += m[1].length; continue; }
      if ((m = /^[a-zA-Z_:][a-zA-Z0-9_:]*/.exec(rest))) { toks.push({ t: "id", v: m[0], pos: i }); i += m[0].length; continue; }
      throw new PErr("unexpected character: '" + ch + "'", i);
    }
    toks.push({ t: "eof", pos: src.length });
    return toks;
  }
  O.parse = function (src) {
    var toks = lex(src), pos = 0;
    function pk(o) { return toks[pos + (o || 0)]; }
    function at(v) { var t = pk(); return (t.t === "op" || t.t === "id") && t.v === v; }
    function eat(v) { if (!at(v)) throw new PErr("unexpected " + desc(pk()) + ", expected \"" + v + "\"", pk().pos); return toks[pos++]; }
    function desc(t) { return t.t === "eof" ? "end of input" : t.t === "str" ? "string" : t.t === "num" ? "number \"" + t.v + "\"" : (t.t === "id" ? "identifier \"" : "\"") + t.v + "\""; }
    var PREC = [["or"], ["and", "unless"], ["==", "!=", "<=", "<", ">=", ">"], ["+", "-"], ["*", "/", "%", "atan2"], ["^"]];
    function bin(level) {
      if (level >= PREC.length) return unary();
      var left = bin(level + 1);
      while (PREC[level].indexOf(pk().v) >= 0 && (pk().t === "op" || pk().t === "id")) {
        var op = toks[pos++].v, mod = { op: op };
        if (at("bool")) { pos++; mod.bool = true; }
        if (at("on") || at("ignoring")) { mod.match = toks[pos++].v; mod.labels = labelList(); }
        if (at("group_left") || at("group_right")) { mod.group = toks[pos++].v; mod.include = at("(") ? labelList() : []; }
        var right = op === "^" ? bin(level) : bin(level + 1);
        left = { k: "bin", op: op, l: left, r: right, mod: mod };
      }
      return left;
    }
    function labelList() { eat("("); var l = []; while (!at(")")) { var t = toks[pos++]; if (t.t !== "id") throw new PErr("unexpected " + desc(t) + " in grouping opts, expected label", t.pos); l.push(t.v); if (at(",")) pos++; } eat(")"); return l; }
    function unary() { if (at("-") || at("+")) { var op = toks[pos++].v; var e = unary(); return op === "-" ? { k: "neg", e: e } : e; } return postfix(primary()); }
    function postfix(e) {
      for (;;) {
        if (at("[")) {
          pos++; var d = pk(); if (d.t !== "dur") throw new PErr("unexpected " + desc(d) + " in range, expected duration", d.pos); pos++;
          if (at(":")) { pos++; var stp = pk().t === "dur" ? toks[pos++].v : null; eat("]"); e = { k: "sub", e: e, range: durSecs(d.v), step: stp ? durSecs(stp) : 60 }; continue; }
          eat("]");
          if (e.k !== "sel") throw new PErr("ranges only allowed for vector selectors", d.pos);
          e = Object.assign({}, e, { range: durSecs(d.v) }); continue;
        }
        if (at("offset")) { pos++; var neg = at("-") ? (pos++, -1) : 1, od = toks[pos++]; e = Object.assign({}, e, { offset: neg * durSecs(od.v) }); continue; }
        return e;
      }
    }
    function selector(name) {
      var m = [];
      if (name) m.push({ l: "__name__", op: "=", v: name });
      if (at("{")) {
        pos++;
        while (!at("}")) {
          var l = toks[pos++]; if (l.t !== "id") throw new PErr("unexpected " + desc(l) + " in label matching, expected label", l.pos);
          var op = toks[pos++]; if (["=", "!=", "=~", "!~"].indexOf(op.v) < 0) throw new PErr("unexpected " + desc(op) + " in label matching, expected label matching operator", op.pos);
          var v = toks[pos++]; if (v.t !== "str") throw new PErr("unexpected " + desc(v) + " in label matching, expected string", v.pos);
          if (op.v === "=~" || op.v === "!~") { try { new RegExp("^(?:" + v.v + ")$"); } catch (e) { throw new PErr("error parsing regexp: invalid or unsupported Perl syntax: `" + v.v + "`", v.pos); } }
          m.push({ l: l.v, op: op.v, v: v.v });
          if (at(",")) pos++; else if (!at("}")) throw new PErr("unexpected " + desc(pk()) + " in label matching, expected \",\" or \"}\"", pk().pos);
        }
        eat("}");
      }
      if (!m.some(function (x) { return x.op === "=" ? x.v !== "" : x.op === "=~" ? !new RegExp("^(?:" + x.v + ")$").test("") : false; })) throw new PErr("vector selector must contain at least one non-empty matcher", pk().pos);
      return { k: "sel", m: m };
    }
    function primary() {
      var t = pk();
      if (t.t === "num") { pos++; return { k: "num", v: t.v }; }
      if (t.t === "str") { pos++; return { k: "str", v: t.v }; }
      if (at("(")) { pos++; var e = bin(0); eat(")"); return { k: "paren", e: e }; }
      if (at("{")) return selector(null);
      if (t.t === "id") {
        pos++;
        if (AGG.indexOf(t.v) >= 0 && (at("(") || at("by") || at("without"))) {
          var grp = null, without = false;
          if (at("by") || at("without")) { without = toks[pos++].v === "without"; grp = labelList(); }
          eat("(");
          var args = [bin(0)]; while (at(",")) { pos++; args.push(bin(0)); }
          eat(")");
          if (!grp && (at("by") || at("without"))) { without = toks[pos++].v === "without"; grp = labelList(); }
          var param = args.length > 1 ? args[0] : null, expr = args[args.length - 1];
          if (/^(topk|bottomk|quantile|count_values)$/.test(t.v) && !param) throw new PErr("wrong number of arguments for aggregate expression provided, expected 2, got 1", t.pos);
          return { k: "agg", op: t.v, param: param, e: expr, grp: grp, without: without };
        }
        if (at("(") && FN[t.v]) { pos++; var a = []; if (!at(")")) { a.push(bin(0)); while (at(",")) { pos++; a.push(bin(0)); } } eat(")"); return { k: "fn", f: t.v, a: a }; }
        if (at("(")) throw new PErr("unknown function with name \"" + t.v + "\"", t.pos);
        return selector(t.v);
      }
      throw new PErr("unexpected " + desc(t), t.pos);
    }
    var ast = bin(0);
    if (pk().t !== "eof") throw new PErr("unexpected " + desc(pk()), pk().pos);
    return ast;
  };

  /* ================================================================== PromQL: evaluation */
  var LOOKBACK = 300;
  function dropName(l) { var o = Object.assign({}, l); delete o.__name__; return o; }
  function sig(l, names, on) { var ks = on ? names : keys(l).filter(function (k) { return k !== "__name__" && names.indexOf(k) < 0; }); return ks.filter(function (k) { return on ? true : true; }).sort().map(function (k) { return k + "=" + (l[k] == null ? "" : l[k]); }).join(","); }
  function matchSel(ob, m) {
    var out = [];
    keys(ob.series).forEach(function (k) {
      var s = ob.series[k];
      if (m.every(function (x) { var v = s.labels[x.l] == null ? "" : String(s.labels[x.l]); return x.op === "=" ? v === x.v : x.op === "!=" ? v !== x.v : x.op === "=~" ? new RegExp("^(?:" + x.v + ")$").test(v) : !new RegExp("^(?:" + x.v + ")$").test(v); })) out.push(s);
    });
    return out;
  }
  function inst(ob, e, t) {
    var at0 = t - (e.offset || 0), out = [];
    matchSel(ob, e.m).forEach(function (s) {
      for (var i = s.t.length - 1; i >= 0; i--) { if (s.t[i] <= at0) { if (at0 - s.t[i] <= LOOKBACK) out.push({ l: s.labels, v: s.v[i] }); break; } }
    });
    return out;
  }
  function range(ob, e, t) {
    var at0 = t - (e.offset || 0), from = at0 - e.range, out = [];
    matchSel(ob, e.m).forEach(function (s) { var pts = []; for (var i = 0; i < s.t.length; i++) if (s.t[i] > from && s.t[i] <= at0) pts.push([s.t[i], s.v[i]]); if (pts.length) out.push({ l: s.labels, p: pts }); });
    return out;
  }
  function counterIncrease(p) { var inc0 = 0; for (var i = 1; i < p.length; i++) { var d = p[i][1] - p[i - 1][1]; inc0 += d < 0 ? p[i][1] : d; } return inc0; }
  function extrap(p, rangeS, isCounter, isRate) {
    if (p.length < 2) return null;
    var delta = isCounter ? counterIncrease(p) : p[p.length - 1][1] - p[0][1];
    var sampled = p[p.length - 1][0] - p[0][0]; if (sampled <= 0) return null;
    var avgStep = sampled / (p.length - 1), dur = Math.min(rangeS, sampled + avgStep);
    var res = delta * dur / sampled;
    return isRate ? res / rangeS : res;
  }
  function overTime(f) { return function (args, t, ev) { var m = ev(args[0], t); if (m.type !== "matrix") throw new PErr("expected type range vector in call to function, got " + m.type); return vec(m.data.map(function (s) { return { l: dropName(s.l), v: f(s.p.map(function (x) { return x[1]; }), s.p) }; }).filter(function (x) { return x.v != null && !isNaN(x.v); })); }; }
  function vec(d) { return { type: "vector", data: d }; }
  function mapV(f) { return function (args, t, ev) { var v = ev(args[0], t), extra = args.slice(1).map(function (a) { var x = ev(a, t); return x.type === "scalar" ? x.value : x.type === "string" ? x.value : null; }); return vec(v.data.map(function (s) { return { l: dropName(s.l), v: f.apply(null, [s.v].concat(extra)) }; })); }; }
  var FN = {
    rate: function (a, t, ev) { var m = ev(a[0], t); return vec(m.data.map(function (s) { return { l: dropName(s.l), v: extrap(s.p, a[0].range, true, true) }; }).filter(function (x) { return x.v != null; })); },
    increase: function (a, t, ev) { var m = ev(a[0], t); return vec(m.data.map(function (s) { return { l: dropName(s.l), v: extrap(s.p, a[0].range, true, false) }; }).filter(function (x) { return x.v != null; })); },
    delta: function (a, t, ev) { var m = ev(a[0], t); return vec(m.data.map(function (s) { return { l: dropName(s.l), v: extrap(s.p, a[0].range, false, false) }; }).filter(function (x) { return x.v != null; })); },
    irate: function (a, t, ev) { var m = ev(a[0], t); return vec(m.data.filter(function (s) { return s.p.length >= 2; }).map(function (s) { var x = s.p[s.p.length - 2], y = s.p[s.p.length - 1], d = y[1] - x[1]; return { l: dropName(s.l), v: (d < 0 ? y[1] : d) / (y[0] - x[0]) }; })); },
    deriv: function (a, t, ev) { var m = ev(a[0], t); return vec(m.data.filter(function (s) { return s.p.length >= 2; }).map(function (s) { var lr = linreg(s.p); return { l: dropName(s.l), v: lr.slope }; })); },
    predict_linear: function (a, t, ev) { var m = ev(a[0], t), secs = ev(a[1], t).value; return vec(m.data.filter(function (s) { return s.p.length >= 2; }).map(function (s) { var lr = linreg(s.p); return { l: dropName(s.l), v: lr.slope * (t + secs) + lr.icpt }; })); },
    avg_over_time: overTime(function (v) { return v.reduce(function (a, b) { return a + b; }, 0) / v.length; }), sum_over_time: overTime(function (v) { return v.reduce(function (a, b) { return a + b; }, 0); }),
    min_over_time: overTime(function (v) { return Math.min.apply(null, v); }), max_over_time: overTime(function (v) { return Math.max.apply(null, v); }), count_over_time: overTime(function (v) { return v.length; }),
    last_over_time: overTime(function (v) { return v[v.length - 1]; }), changes: overTime(function (v) { var c = 0; for (var i = 1; i < v.length; i++) if (v[i] !== v[i - 1]) c++; return c; }), resets: overTime(function (v) { var c = 0; for (var i = 1; i < v.length; i++) if (v[i] < v[i - 1]) c++; return c; }),
    quantile_over_time: function (a, t, ev) { var q = ev(a[0], t).value, m = ev(a[1], t); return vec(m.data.map(function (s) { return { l: dropName(s.l), v: quant(q, s.p.map(function (x) { return x[1]; })) }; })); },
    abs: mapV(Math.abs), ceil: mapV(Math.ceil), floor: mapV(Math.floor), sqrt: mapV(Math.sqrt), exp: mapV(Math.exp), ln: mapV(Math.log), log2: mapV(Math.log2), log10: mapV(Math.log10),
    round: mapV(function (v, to) { to = to || 1; return Math.round(v / to) * to; }), clamp_min: mapV(function (v, m) { return Math.max(v, m); }), clamp_max: mapV(function (v, m) { return Math.min(v, m); }), clamp: mapV(function (v, lo, hi) { return Math.min(Math.max(v, lo), hi); }),
    histogram_quantile: function (a, t, ev) {
      var q = ev(a[0], t).value, v = ev(a[1], t), groups = {};
      v.data.forEach(function (s) { if (s.l.le == null) return; var l = dropName(s.l); var le = l.le; delete l.le; var k = sig(l, [], false); (groups[k] = groups[k] || { l: l, b: [] }).b.push([le === "+Inf" ? Infinity : +le, s.v]); });
      return vec(keys(groups).map(function (k) {
        var g = groups[k], b = g.b.sort(function (x, y) { return x[0] - y[0]; });
        if (!b.length || b[b.length - 1][0] !== Infinity) return { l: g.l, v: NaN };
        var total = b[b.length - 1][1]; if (!(total > 0)) return { l: g.l, v: NaN };
        var rank = q * total, i = 0; while (i < b.length && b[i][1] < rank) i++;
        if (i >= b.length - 1) return { l: g.l, v: b[b.length - 2] ? b[b.length - 2][0] : NaN };
        var lo = i === 0 ? 0 : b[i - 1][0], cLo = i === 0 ? 0 : b[i - 1][1], hi = b[i][0], cHi = b[i][1];
        return { l: g.l, v: lo + (hi - lo) * ((rank - cLo) / Math.max(1e-12, cHi - cLo)) };
      }));
    },
    absent: function (a, t, ev) { var v = ev(a[0], t); if (v.data.length) return vec([]); var l = {}; (a[0].m || []).forEach(function (m) { if (m.op === "=" && m.l !== "__name__") l[m.l] = m.v; }); return vec([{ l: l, v: 1 }]); },
    absent_over_time: function (a, t, ev) { var v = ev(a[0], t); if (v.data.length) return vec([]); var l = {}; (a[0].m || []).forEach(function (m) { if (m.op === "=" && m.l !== "__name__") l[m.l] = m.v; }); return vec([{ l: l, v: 1 }]); },
    time: function (a, t, ev, cl) { return { type: "scalar", value: O.unix(cl, t) }; },
    timestamp: function (a, t, ev, cl) { var v = ev(a[0], t); return vec(v.data.map(function (s) { return { l: dropName(s.l), v: O.unix(cl, t) }; })); },
    vector: function (a, t, ev) { return vec([{ l: {}, v: ev(a[0], t).value }]); },
    scalar: function (a, t, ev) { var v = ev(a[0], t); return { type: "scalar", value: v.data.length === 1 ? v.data[0].v : NaN }; },
    sort: function (a, t, ev) { var v = ev(a[0], t); v.data.sort(function (x, y) { return x.v - y.v; }); return v; },
    sort_desc: function (a, t, ev) { var v = ev(a[0], t); v.data.sort(function (x, y) { return y.v - x.v; }); return v; },
    label_replace: function (a, t, ev) { var v = ev(a[0], t), dst = ev(a[1], t).value, rep = ev(a[2], t).value, src = ev(a[3], t).value, re = new RegExp("^(?:" + ev(a[4], t).value + ")$"); return vec(v.data.map(function (s) { var l = Object.assign({}, s.l), m = re.exec(l[src] == null ? "" : String(l[src])); if (m) l[dst] = rep.replace(/\$(\d+)|\$\{(\d+)\}/g, function (m0, x, y) { return m[+(x || y)] || ""; }); return { l: l, v: s.v }; })); }
  };
  function linreg(p) { var n = p.length, sx = 0, sy = 0, sxy = 0, sxx = 0; p.forEach(function (q) { sx += q[0]; sy += q[1]; sxy += q[0] * q[1]; sxx += q[0] * q[0]; }); var slope = (n * sxy - sx * sy) / Math.max(1e-12, n * sxx - sx * sx); return { slope: slope, icpt: (sy - slope * sx) / n }; }
  function quant(q, vals) { var v = vals.slice().sort(function (a, b) { return a - b; }); if (!v.length) return NaN; var r = q * (v.length - 1), lo = Math.floor(r), hi = Math.ceil(r); return v[lo] + (v[hi] - v[lo]) * (r - lo); }
  O.FN = FN;
  function cmp(op, a, b) { return op === "==" ? a === b : op === "!=" ? a !== b : op === ">" ? a > b : op === "<" ? a < b : op === ">=" ? a >= b : a <= b; }
  function arith(op, a, b) { return op === "+" ? a + b : op === "-" ? a - b : op === "*" ? a * b : op === "/" ? a / b : op === "%" ? a % b : op === "^" ? Math.pow(a, b) : op === "atan2" ? Math.atan2(a, b) : NaN; }
  var CMP = ["==", "!=", ">", "<", ">=", "<="];
  O.evalAt = function (cl, ast, t) {
    var ob = cl.obs;
    function ev(e, t2) {
      switch (e.k) {
        case "num": return { type: "scalar", value: e.v };
        case "str": return { type: "string", value: e.v };
        case "paren": return ev(e.e, t2);
        case "neg": { var x = ev(e.e, t2); return x.type === "scalar" ? { type: "scalar", value: -x.value } : vec(x.data.map(function (s) { return { l: dropName(s.l), v: -s.v }; })); }
        case "sel": return e.range ? { type: "matrix", data: range(ob, e, t2) } : vec(inst(ob, e, t2));
        case "sub": { var pts = {}, from = t2 - e.range; for (var tt = Math.ceil(from / e.step) * e.step; tt <= t2; tt += e.step) { ev(e.e, tt).data.forEach(function (s) { var k = sig(s.l, [], false); (pts[k] = pts[k] || { l: s.l, p: [] }).p.push([tt, s.v]); }); } return { type: "matrix", data: keys(pts).map(function (k) { return pts[k]; }) }; }
        case "fn": { if (e.f === "rate" || e.f === "increase" || e.f === "irate" || e.f === "delta" || /_over_time$|^(changes|resets|deriv|predict_linear)$/.test(e.f)) { var ra = e.f === "quantile_over_time" ? e.a[1] : e.a[0]; if (!ra || (ra.k !== "sel" && ra.k !== "sub") || (ra.k === "sel" && !ra.range)) throw new PErr("expected type range vector in call to function \"" + e.f + "\", got instant vector"); } return FN[e.f](e.a, t2, ev, cl); }
        case "agg": return agg(e, t2);
        case "bin": return binop(e, t2);
      }
      throw new PErr("unknown expression");
    }
    function agg(e, t2) {
      var v = ev(e.e, t2); if (v.type !== "vector") throw new PErr("expected type instant vector in aggregation expression, got " + v.type);
      var param = e.param ? ev(e.param, t2).value : null, groups = {};
      v.data.forEach(function (s) {
        var l = {}; if (e.grp && !e.without) e.grp.forEach(function (k) { if (s.l[k] != null) l[k] = s.l[k]; }); else { l = dropName(s.l); (e.grp || []).forEach(function (k) { delete l[k]; }); if (!e.grp) l = {}; }
        var k = sig(l, [], false); (groups[k] = groups[k] || { l: l, s: [] }).s.push(s);
      });
      var out = [];
      keys(groups).forEach(function (k) {
        var g = groups[k], vals = g.s.map(function (s) { return s.v; });
        if (e.op === "topk" || e.op === "bottomk") { g.s.slice().sort(function (a, b) { return e.op === "topk" ? b.v - a.v : a.v - b.v; }).slice(0, param).forEach(function (s) { out.push({ l: s.l, v: s.v }); }); return; }
        var r = e.op === "sum" ? vals.reduce(function (a, b) { return a + b; }, 0) : e.op === "avg" ? vals.reduce(function (a, b) { return a + b; }, 0) / vals.length : e.op === "min" ? Math.min.apply(null, vals) : e.op === "max" ? Math.max.apply(null, vals) : e.op === "count" ? vals.length : e.op === "group" ? 1 : e.op === "quantile" ? quant(param, vals) : e.op === "stddev" || e.op === "stdvar" ? (function () { var m = vals.reduce(function (a, b) { return a + b; }, 0) / vals.length, va = vals.reduce(function (a, b) { return a + (b - m) * (b - m); }, 0) / vals.length; return e.op === "stddev" ? Math.sqrt(va) : va; })() : NaN;
        out.push({ l: g.l, v: r });
      });
      return vec(out);
    }
    function binop(e, t2) {
      var op = e.op, L = ev(e.l, t2), R = ev(e.r, t2), isCmp = CMP.indexOf(op) >= 0;
      if (L.type === "string" || R.type === "string") throw new PErr("binary expression must contain only scalar and instant vector types");
      if (L.type === "matrix" || R.type === "matrix") throw new PErr("binary expression must contain only scalar and instant vector types");
      if (op === "and" || op === "or" || op === "unless") {
        if (L.type !== "vector" || R.type !== "vector") throw new PErr("set operator \"" + op + "\" not allowed in binary scalar expression");
        var sg = function (l) { return e.mod.match === "on" ? sig(l, e.mod.labels, true) : sig(l, e.mod.labels || [], false); };
        var rs = {}; R.data.forEach(function (s) { rs[sg(s.l)] = 1; });
        if (op === "and") return vec(L.data.filter(function (s) { return rs[sg(s.l)]; }));
        if (op === "unless") return vec(L.data.filter(function (s) { return !rs[sg(s.l)]; }));
        var ls = {}; L.data.forEach(function (s) { ls[sg(s.l)] = 1; });
        return vec(L.data.concat(R.data.filter(function (s) { return !ls[sg(s.l)]; })));
      }
      if (L.type === "scalar" && R.type === "scalar") { if (isCmp && !e.mod.bool) throw new PErr("comparisons between scalars must use BOOL modifier"); return { type: "scalar", value: isCmp ? (cmp(op, L.value, R.value) ? 1 : 0) : arith(op, L.value, R.value) }; }
      if (L.type === "scalar" || R.type === "scalar") {
        var vv = L.type === "vector" ? L : R, sv = L.type === "scalar" ? L.value : R.value, left = L.type === "vector";
        var outS = [];
        vv.data.forEach(function (s) { var a = left ? s.v : sv, b = left ? sv : s.v; if (isCmp) { var ok = cmp(op, a, b); if (e.mod.bool) outS.push({ l: dropName(s.l), v: ok ? 1 : 0 }); else if (ok) outS.push({ l: s.l, v: s.v }); } else outS.push({ l: dropName(s.l), v: arith(op, a, b) }); });
        return vec(outS);
      }
      var on = e.mod.match === "on", names = e.mod.labels || [], group = e.mod.group;
      var key = function (l) { return on ? sig(l, names, true) : sig(l, names, false); };
      var one = group === "group_left" ? R : L, many = group === "group_left" ? L : R;
      if (!group) { one = R; many = L; }
      var idx = {};
      one.data.forEach(function (s) { var k = key(s.l); if (idx[k] && !group) throw new PErr("found duplicate series for the match group " + k + " on the right hand-side of the operation: [" + skey("", idx[k].l) + ", " + skey("", s.l) + "];many-to-many matching not allowed: matching labels must be unique on one side"); if (idx[k] && group) throw new PErr("found duplicate series for the match group " + k + " on the " + (group === "group_left" ? "right" : "left") + " hand-side of the operation; many-to-many matching not allowed"); idx[k] = s; });
      var res = [], seen = {};
      many.data.forEach(function (s) {
        var k = key(s.l), o = idx[k]; if (!o) return;
        if (!group) { if (seen[k]) throw new PErr("found duplicate series for the match group " + k + " on the left hand-side of the operation; many-to-many matching not allowed: matching labels must be unique on one side"); seen[k] = 1; }
        var a = group === "group_right" ? o.v : s.v, b = group === "group_right" ? s.v : o.v;
        if (group === "group_right") { var tmp = a; a = tmp; }
        var lv = group ? s : s, outL;
        if (group) { outL = dropName(s.l); (e.mod.include || []).forEach(function (n) { if (o.l[n] != null) outL[n] = o.l[n]; }); }
        else outL = on ? (function () { var x = {}; names.forEach(function (n) { if (s.l[n] != null) x[n] = s.l[n]; }); return isCmp ? s.l : x; })() : (function () { var x = dropName(s.l); names.forEach(function (n) { delete x[n]; }); return isCmp ? s.l : x; })();
        var va = group === "group_right" ? o.v : s.v, vb = group === "group_right" ? s.v : o.v;
        if (group === "group_left") { va = s.v; vb = o.v; }
        if (isCmp) { var ok = cmp(op, va, vb); if (e.mod.bool) res.push({ l: dropName(outL), v: ok ? 1 : 0 }); else if (ok) res.push({ l: lv.l, v: va }); }
        else res.push({ l: dropName(outL), v: arith(op, va, vb) });
        void a; void b;
      });
      return vec(res);
    }
    return ev(ast, t);
  };
  O.query = function (cl, src, t) {
    try { var ast = O.parse(src); var r = O.evalAt(cl, ast, t == null ? K.t(cl) : t); return r; }
    catch (e) { if (e instanceof PErr) return { error: (e.pos != null ? "1:" + (e.pos + 1) + ": parse error: " : "") + e.message }; throw e; }
  };
  O.queryRange = function (cl, src, start, end, step) {
    var ast; try { ast = O.parse(src); } catch (e) { if (e instanceof PErr) return { error: e.message }; throw e; }
    var series = {};
    try {
      for (var t = start; t <= end; t += step) {
        var r = O.evalAt(cl, ast, t);
        if (r.type === "scalar") { (series.s = series.s || { l: {}, p: [] }).p.push([t, r.value]); continue; }
        r.data.forEach(function (s) { var k = sig(s.l, [], false) + "|" + (s.l.__name__ || ""); (series[k] = series[k] || { l: s.l, p: [] }).p.push([t, s.v]); });
      }
    } catch (e) { if (e instanceof PErr) return { error: e.message }; throw e; }
    return { data: keys(series).map(function (k) { return series[k]; }) };
  };
  O.fmtLabels = function (l) { var ks = keys(l).filter(function (k) { return k !== "__name__"; }).sort(); return (l.__name__ || "") + "{" + ks.map(function (k) { return k + "=\"" + l[k] + "\""; }).join(", ") + "}"; };
  O.fmtVal = function (v) { if (isNaN(v)) return "NaN"; if (!isFinite(v)) return v > 0 ? "+Inf" : "-Inf"; var s = String(+v.toPrecision(15)); return s; };
})(typeof window !== "undefined" ? window : globalThis);
