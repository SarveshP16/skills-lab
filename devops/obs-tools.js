/* sudo learn — DevOps Module 5: logs, traces, dashboards, runtime security and on-call. The monitoring stack in the
   cluster (namespace monitoring: Prometheus, Alertmanager, Grafana, Loki, Tempo; namespace falco: Falco), what
   the apps log each tick (plain access logs or JSON with LOG_FORMAT=json, errors with their causes, trace IDs),
   promtail shipping container output and the API server's audit log to Loki, LogQL and logcli, traces for pods
   with OTEL_* settings and TraceQL search, Grafana dashboards provisioned from labelled ConfigMaps, Falco rules
   (default + custom, with macros and lists) evaluated against what happens in pods, and Kestrel's `oncall` tool
   (pages, Slack, incidents, status page). */
(function (root) {
  "use strict";
  var S = root.ShEngine, M2 = S.M2, U = S.util, Dk = root.Dk, K = root.K8s, O = root.Obs, Y = root.DevYaml, KC = K.kubectl;
  var out = U.out, errl = U.errl;
  function keys(o) { return o ? Object.keys(o) : []; }
  var MON = { prometheus: 9090, alertmanager: 9093, grafana: 80, loki: 3100, tempo: 3200 };
  O.HOSTS = ["prometheus", "alertmanager", "grafana", "loki", "tempo", "status"].map(function (h) { return h + (h === "status" ? ".kestrel.dev" : ".staging.kestrel.dev"); });

  /* ================================================================== the stack */
  K.onBootstrap = K.onBootstrap || [];
  K.onBootstrap.push(function (cl) {
    if (!cl.comps.prometheus) return;
    K.ensureNs(cl, "monitoring");
    var L = function (n) { return { "app.kubernetes.io/name": n, "app.kubernetes.io/instance": "monitoring" }; };
    K.sysDeploy(cl, "monitoring", "monitoring-kube-prometheus-operator", { labels: L("kube-prometheus-stack-prometheus-operator"), image: "quay.io/prometheus-operator/prometheus-operator:v0.78.2" });
    K.sysDeploy(cl, "monitoring", "monitoring-kube-state-metrics", { labels: L("kube-state-metrics"), image: "registry.k8s.io/kube-state-metrics/kube-state-metrics:v2.14.0" });
    K.sysDeploy(cl, "monitoring", "monitoring-grafana", { labels: L("grafana"), image: "docker.io/grafana/grafana:11.3.1" });
    K.sysObj(cl, { kind: "StatefulSet", metadata: { name: "prometheus-monitoring-kube-prometheus-prometheus", namespace: "monitoring", labels: L("prometheus") }, spec: { replicas: 1, serviceName: "prometheus-operated", selector: { matchLabels: L("prometheus") }, template: { metadata: { labels: L("prometheus"), annotations: { "sim.kestrel.io/virtual": "true" } }, spec: { containers: [{ name: "prometheus", image: "quay.io/prometheus/prometheus:v2.55.1" }] } } } });
    K.sysObj(cl, { kind: "StatefulSet", metadata: { name: "alertmanager-monitoring-kube-prometheus-alertmanager", namespace: "monitoring", labels: L("alertmanager") }, spec: { replicas: 1, serviceName: "alertmanager-operated", selector: { matchLabels: L("alertmanager") }, template: { metadata: { labels: L("alertmanager"), annotations: { "sim.kestrel.io/virtual": "true" } }, spec: { containers: [{ name: "alertmanager", image: "quay.io/prometheus/alertmanager:v0.27.0" }] } } } });
    K.sysObj(cl, { kind: "StatefulSet", metadata: { name: "loki", namespace: "monitoring", labels: L("loki") }, spec: { replicas: 1, serviceName: "loki-headless", selector: { matchLabels: L("loki") }, template: { metadata: { labels: L("loki"), annotations: { "sim.kestrel.io/virtual": "true" } }, spec: { containers: [{ name: "loki", image: "docker.io/grafana/loki:3.3.0" }] } } } });
    K.sysObj(cl, { kind: "StatefulSet", metadata: { name: "tempo", namespace: "monitoring", labels: L("tempo") }, spec: { replicas: 1, serviceName: "tempo", selector: { matchLabels: L("tempo") }, template: { metadata: { labels: L("tempo"), annotations: { "sim.kestrel.io/virtual": "true" } }, spec: { containers: [{ name: "tempo", image: "docker.io/grafana/tempo:2.6.1" }] } } } });
    ["node-exporter", "promtail"].forEach(function (n) { K.sysObj(cl, { kind: "DaemonSet", metadata: { name: n === "promtail" ? "promtail" : "monitoring-prometheus-node-exporter", namespace: "monitoring", labels: L(n) }, spec: { selector: { matchLabels: L(n) }, template: { metadata: { labels: L(n), annotations: { "sim.kestrel.io/virtual": "true" } }, spec: { tolerations: [{ operator: "Exists" }], containers: [{ name: n, image: n === "promtail" ? "docker.io/grafana/promtail:3.3.0" : "quay.io/prometheus/node-exporter:v1.8.2" }] } } } }); });
    keys(MON).forEach(function (n) { K.sysSvc(cl, "monitoring", n, { selector: L(n === "prometheus" || n === "alertmanager" ? n : n), ports: [{ name: "http", port: MON[n] }].concat(n === "tempo" ? [{ name: "otlp-grpc", port: 4317 }] : []) }, { labels: L(n) }); });
    if (cl.comps.falco) { K.ensureNs(cl, "falco"); K.sysObj(cl, { kind: "DaemonSet", metadata: { name: "falco", namespace: "falco", labels: { "app.kubernetes.io/name": "falco" } }, spec: { selector: { matchLabels: { "app.kubernetes.io/name": "falco" } }, template: { metadata: { labels: { "app.kubernetes.io/name": "falco" }, annotations: { "sim.kestrel.io/virtual": "true" } }, spec: { tolerations: [{ operator: "Exists" }], containers: [{ name: "falco", image: "docker.io/falcosecurity/falco:0.39.2" }] } } } }); }
  });

  /* ================================================================== logs */
  function ts(cl, t, frac) { var d = new Date(Dk.stamp(cl.rt, t) + (frac || 0)); return d.toISOString(); }
  function podEnv(cl, p) { var c = K.ctrOf(cl, p); return (c && c.env) || {}; }
  function stream(p) { return { namespace: p.metadata.namespace, pod: p.metadata.name, container: p.spec.containers[0].name, app: (p.metadata.labels || {}).app || (p.metadata.labels || {})["app.kubernetes.io/name"] || p.metadata.name.replace(/-[a-z0-9]{8,10}-[a-z0-9]{5}$/, ""), node_name: p.spec.nodeName || "", job: p.metadata.namespace + "/" + ((p.metadata.labels || {}).app || p.metadata.name), stream: "stdout" }; }
  O.stream = stream;
  function addLog(ob, t, labels, line) { ob.logs.push({ t: t, l: labels, line: line }); if (ob.logs.length > 9000) ob.logs.splice(0, ob.logs.length - 8000); }
  O.addLog = addLog;
  function hex(seed, n) { return K.hex(seed, n); }
  var ERR = {
    notes: { "/export": "export failed: TimeoutError: upload to s3://kestrel-notes-exports timed out after 30s" },
    orders: { db: "psycopg.OperationalError: connection failed: could not translate host name \"db\" to address: Name or service not known", pool: "pool exhausted: waited %ms for a database connection (DB_POOL_SIZE=%n)", "/orders": "IntegrityError: duplicate key value violates unique constraint \"orders_pkey\"" },
    payments: { "/charge": "provider returned HTTP 503: upstream unavailable" },
    web: { "/api/orders": "upstream prematurely closed connection while reading response header from upstream" }
  };
  O.emitLogs = function (cl, t, served, backfill) {
    var ob = cl.obs;
    keys(served).forEach(function (uid) {
      var list = served[uid]; if (!list.length) return;
      var p = list[0].pod, kind = O.appKind(cl, p), lb = stream(p), env = podEnv(cl, p), json = /^json$/i.test(env.LOG_FORMAT || ""), otel = !!(env.OTEL_EXPORTER_OTLP_ENDPOINT && /tempo/.test(env.OTEL_EXPORTER_OTLP_ENDPOINT));
      list.forEach(function (h, k) {
        var r = O.rnd(uid + t + k + h.path), status = h.b.err >= 1 || r < h.b.err * 3 ? h.b.code : "200", dur = Math.round(h.b.p50 * (0.7 + r * 0.8));
        var tid = otel ? hex("tr" + uid + t + k, 32) : null;
        if (kind === "web") { addLog(ob, t, lb, "10.42.0." + (5 + k) + " - - [" + O.nginxTime(cl, t) + "] \"" + h.method + " " + h.path + " HTTP/1.1\" " + status + " " + (status === "200" ? 412 : 157) + " \"-\" \"Mozilla/5.0\" " + (dur / 1000).toFixed(3)); if (status !== "200") addLog(ob, t, Object.assign({}, lb, { stream: "stderr" }), O.ngErrTime(cl, t) + " [error] 29#29: *" + Math.floor(r * 9000) + " " + ERR.web["/api/orders"] + ", client: 10.42.0.5, server: , request: \"" + h.method + " " + h.path + " HTTP/1.1\", upstream: \"http://10.43.0.26:8000" + h.path.replace(/^\/api/, "") + "\""); return; }
        if (!/^(notes|orders|payments)$/.test(kind)) return;
        var errs = Math.min(3, Math.round(h.n * h.b.err)), base = { ts: ts(cl, t, k * 37), level: "info", logger: kind, msg: "request", method: h.method, path: h.path, status: +status, duration_ms: dur };
        if (tid) base.trace_id = tid;
        addLog(ob, t, lb, json ? JSON.stringify(base) : "10.42.1.1 - - [" + O.nginxTime(cl, t) + "] \"" + h.method + " " + h.path + " HTTP/1.1\" " + status + " - \"-\" \"kube-ingress\" " + dur + "ms");
        if (h.b.poolWait && r < 0.6) { var pw = ERR.orders.pool.replace("%ms", (h.b.poolWait / 1000).toFixed(1) + "s").replace("%n", env.DB_POOL_SIZE || "10"); addLog(ob, t, lb, json ? JSON.stringify({ ts: ts(cl, t, 400), level: "warning", logger: "orders.db", msg: pw, trace_id: tid || undefined }) : "WARNING orders.db: " + pw); }
        for (var e = 0; e < errs; e++) {
          var msg = h.b.errMsg || (h.b.dep ? (ERR[kind] || {})[h.b.dep] : (ERR[kind] || {})[h.path]) || "unhandled exception";
          var etid = otel ? hex("tre" + uid + t + k + e, 32) : null;
          addLog(ob, t, Object.assign({}, lb, { stream: "stderr" }), json ? JSON.stringify({ ts: ts(cl, t, 500 + e * 90), level: "error", logger: kind, msg: msg.split(":")[0], error: msg, method: h.method, path: h.path, status: +h.b.code, trace_id: etid || undefined }) : "[" + O.gunicornTime(cl, t) + "] [ERROR] " + h.method + " " + h.path + " failed: " + msg);
          if (etid) O.makeTrace(cl, t, p, h, etid, true);
        }
        if (tid && O.rnd("keep" + tid) < 0.5) O.makeTrace(cl, t, p, h, tid, false);
      });
    });
    // memory leak warnings, falco and audit
    K.all(cl, "Pod").forEach(function (p) { var c = K.ctrOf(cl, p); if (c && c.k8sLeak && c.state === "running" && Math.floor(t) % 60 === 0) addLog(ob, t, Object.assign(stream(p), { stream: "stderr" }), JSON.stringify({ ts: ts(cl, t), level: "warning", logger: "orders.cache", msg: "in-memory order cache has " + Math.round((K.t(cl) - (c.k8sLeakStart || 0)) * 41) + " entries; resident memory " + Math.round(K.podMem(cl, p) / 1048576) + "MiB" })); });
    // promtail: container output (start-up, crashes, tracebacks)
    K.all(cl, "Pod").forEach(function (p) {
      var r = p._rt; if (!r || !r.ctrs) return;
      keys(r.ctrs).forEach(function (cn) { var c = r.ctrs[cn].c; if (!c) return; var off = ob.logOff[c.id] || 0; (c.logs || []).slice(off).forEach(function (l) { if (/ - - \[/.test(l.text)) return; addLog(ob, l.t, Object.assign(stream(p), { container: cn, stream: l.s === "err" ? "stderr" : "stdout" }), l.text); }); ob.logOff[c.id] = (c.logs || []).length; });
    });
    var ai = ob.auditOff || 0;
    cl.audit.slice(ai).forEach(function (a) { addLog(ob, a.t, { job: "kube-apiserver-audit", namespace: "kube-system", app: "kube-apiserver" }, JSON.stringify({ kind: "Event", apiVersion: "audit.k8s.io/v1", level: "Metadata", auditID: hex("aud" + a.t + a.name + a.verb, 8) + "-" + hex("a2" + a.t, 4) + "-" + hex("a3" + a.name, 4) + "-" + hex("a4" + a.verb, 4) + "-" + hex("a5" + a.t, 12), stage: "ResponseComplete", verb: a.verb === "exec" ? "create" : a.verb, user: { username: a.user, groups: ["system:authenticated"] }, objectRef: { resource: K.KINDS[a.kind] ? K.KINDS[a.kind].plural : String(a.kind).toLowerCase() + "s", namespace: a.ns, name: a.name, subresource: a.verb === "exec" ? "exec" : undefined }, requestURI: a.verb === "exec" ? "/api/v1/namespaces/" + a.ns + "/pods/" + a.name + "/exec?command=" + encodeURIComponent(a.cmd || "") + "&container=" + "&stdin=true&stdout=true&tty=true" : undefined, responseStatus: { code: a.verb === "create" ? 201 : 200 }, requestReceivedTimestamp: ts(cl, a.t) })); });
    ob.auditOff = cl.audit.length;
    // scripted happenings (an intruder, a cron job) that should appear at their time
    (ob.timeline || []).forEach(function (ev) { if (!ev.done && ev.t <= t) { ev.done = true; ev.run(cl, ev.t); } });
    void backfill;
  };
  O.nginxTime = function (cl, t) { return Dk.dt ? Dk.dt(cl.rt, t, "nginx") : ts(cl, t); };
  O.ngErrTime = function (cl, t) { return Dk.dt ? Dk.dt(cl.rt, t, "ngerr") : ts(cl, t); };
  O.gunicornTime = function (cl, t) { return Dk.dt ? Dk.dt(cl.rt, t, "gunicorn") : ts(cl, t); };

  /* ---------------- LogQL */
  function lqlParse(src) {
    var s = String(src).trim(), pos = 0;
    function ws() { while (pos < s.length && /\s/.test(s.charAt(pos))) pos++; }
    function peek(re) { ws(); var m = re.exec(s.slice(pos)); return m; }
    function take(re, what) { var m = peek(re); if (!m) throw new Error("parse error at line 1, col " + (pos + 1) + ": syntax error: unexpected " + (s.slice(pos, pos + 12) || "end of input") + (what ? ", expecting " + what : "")); pos += m[0].length; return m; }
    function str() { var m = take(/^("((?:[^"\\]|\\.)*)"|`([^`]*)`)/, "STRING"); return m[2] != null ? m[2].replace(/\\(.)/g, "$1") : m[3]; }
    function selector() {
      take(/^\{/, "{"); var ms = [];
      while (!peek(/^\}/)) { var l = take(/^[a-zA-Z_][\w]*/, "IDENTIFIER")[0], op = take(/^(=~|!~|!=|=)/, "=")[0], v = str(); ms.push({ l: l, op: op, v: v }); if (peek(/^,/)) take(/^,/); }
      take(/^\}/, "}");
      if (!ms.some(function (m) { return (m.op === "=" && m.v) || (m.op === "=~" && !new RegExp("^(?:" + m.v + ")$").test("")); })) throw new Error("parse error : queries require at least one regexp or equality matcher that does not have an empty-compatible value. For instance, app=~\".*\" does not meet this requirement, but app=~\".+\" will");
      return ms;
    }
    function pipeline() {
      var st = [];
      for (;;) {
        var m = peek(/^(\|=|!=|\|~|!~)/);
        if (m) { pos += m[0].length; st.push({ k: "line", op: m[1], v: str() }); continue; }
        if (peek(/^\|/)) {
          take(/^\|/);
          if (peek(/^json\b/)) { take(/^json/); st.push({ k: "json" }); continue; }
          if (peek(/^logfmt\b/)) { take(/^logfmt/); st.push({ k: "logfmt" }); continue; }
          if (peek(/^line_format\b/)) { take(/^line_format/); st.push({ k: "fmt", v: str() }); continue; }
          if (peek(/^drop\b/)) { take(/^drop/); take(/^[\w, ]+/); continue; }
          var lf = take(/^([a-zA-Z_][\w]*)\s*(==|=~|!~|!=|>=|<=|=|>|<)\s*/, "label filter"), val;
          if (peek(/^["`]/)) val = str(); else val = take(/^[\w.:-]+/, "value")[0];
          st.push({ k: "lab", l: lf[1], op: lf[2], v: val });
          while (peek(/^(and|or|,)\s/)) { take(/^(and|,)/); var lf2 = take(/^([a-zA-Z_][\w]*)\s*(==|=~|!~|!=|>=|<=|=|>|<)\s*/, "label filter"), v2 = peek(/^["`]/) ? str() : take(/^[\w.:-]+/)[0]; st.push({ k: "lab", l: lf2[1], op: lf2[2], v: v2 }); }
          continue;
        }
        return st;
      }
    }
    function logq() { var sel = selector(); return { sel: sel, st: pipeline() }; }
    function metric() {
      var m = peek(/^(count_over_time|rate|bytes_over_time|bytes_rate|sum|avg|max|min|count|topk)\b/);
      if (!m) return { log: logq() };
      pos += m[0].length;
      var op = m[1];
      if (/^(sum|avg|max|min|count|topk)$/.test(op)) {
        var by = null; if (peek(/^by\b/)) { take(/^by/); take(/^\(/); by = take(/^[\w,\s]*/)[0].split(",").map(function (x) { return x.trim(); }).filter(Boolean); take(/^\)/); }
        take(/^\(/); var k = null; if (op === "topk") { k = +take(/^\d+/)[0]; take(/^,/); }
        var inner = metric(); take(/^\)/, ")");
        if (!by && peek(/^by\b/)) { take(/^by/); take(/^\(/); by = take(/^[\w,\s]*/)[0].split(",").map(function (x) { return x.trim(); }).filter(Boolean); take(/^\)/); }
        return { agg: op, by: by, k: k, e: inner };
      }
      take(/^\(/, "("); var lq = logq(); var r = take(/^\[(\d+[smhd])\]/, "range")[1]; take(/^\)/, ")");
      return { range: op, dur: O.durSecs(r), log: lq };
    }
    var q = metric(); ws();
    if (pos < s.length) throw new Error("parse error at line 1, col " + (pos + 1) + ": syntax error: unexpected " + s.slice(pos, pos + 12));
    return q;
  }
  O.lqlParse = lqlParse;
  function flatJson(o, pre, outO) { keys(o || {}).forEach(function (k) { var v = o[k], nk = (pre ? pre + "_" : "") + k.replace(/[^\w]/g, "_"); if (v && typeof v === "object" && !Array.isArray(v)) flatJson(v, nk, outO); else outO[nk] = v == null ? "" : String(v); }); return outO; }
  function labCmp(op, have, want) {
    if (have === undefined) return op === "!=" || op === "!~" ? true : false;
    var hn = parseFloat(have), wn = /^\d+(\.\d+)?(ms|s|m|h)$/.test(want) ? O.durSecs(want) * (/ms$/.test(want) ? 1 : 1) : parseFloat(want);
    if (/^(>|>=|<|<=|==)$/.test(op) && !isNaN(hn) && !isNaN(wn)) { if (/ms$/.test(want) || /s$/.test(want)) { var hs = /ms$/.test(have) ? parseFloat(have) / 1000 : /s$/.test(have) ? parseFloat(have) : hn; hn = hs; } return op === ">" ? hn > wn : op === ">=" ? hn >= wn : op === "<" ? hn < wn : op === "<=" ? hn <= wn : hn === wn; }
    return op === "=" || op === "==" ? have === want : op === "!=" ? have !== want : op === "=~" ? new RegExp("^(?:" + want + ")$").test(have) : !new RegExp("^(?:" + want + ")$").test(have);
  }
  function runLog(ob, q, from, to) {
    var res = [];
    ob.logs.forEach(function (e) {
      if (e.t <= from || e.t > to) return;
      if (!O.mMatch(q.sel, e.l)) return;
      var line = e.line, labels = Object.assign({}, e.l), ok = true;
      for (var i = 0; i < q.st.length && ok; i++) {
        var st = q.st[i];
        if (st.k === "line") ok = st.op === "|=" ? line.indexOf(st.v) >= 0 : st.op === "!=" ? line.indexOf(st.v) < 0 : st.op === "|~" ? new RegExp(st.v).test(line) : !new RegExp(st.v).test(line);
        else if (st.k === "json") { try { var j = JSON.parse(line); flatJson(j, "", labels); } catch (x) { labels.__error__ = "JSONParserErr"; } }
        else if (st.k === "logfmt") { line.replace(/(\w+)=("[^"]*"|\S+)/g, function (m0, k, v) { labels[k] = v.replace(/^"|"$/g, ""); }); }
        else if (st.k === "lab") ok = labCmp(st.op, labels[st.l], st.v);
        else if (st.k === "fmt") line = st.v.replace(/\{\{\s*\.(\w+)\s*\}\}/g, function (m0, k) { return labels[k] == null ? "" : labels[k]; });
      }
      if (ok) res.push({ t: e.t, l: labels, line: line, base: e.l });
    });
    return res;
  }
  O.logQuery = function (cl, src, from, to) {
    var q; try { q = lqlParse(src); } catch (e) { return { error: e.message }; }
    var ob = cl.obs;
    if (q.log) return { streams: runLog(ob, q.log, from, to) };
    function evalM(m, t) {
      if (m.range) {
        var lines = runLog(ob, m.log, t - m.dur, t), groups = {};
        lines.forEach(function (x) { var l = {}; keys(x.l).forEach(function (k) { if (k !== "__error__") l[k] = x.l[k]; }); var k = O.skey("", l); (groups[k] = groups[k] || { l: l, n: 0, b: 0 }).n++; groups[k].b += x.line.length; });
        return keys(groups).map(function (k) { var g = groups[k]; return { l: g.l, v: m.range === "count_over_time" ? g.n : m.range === "rate" ? g.n / m.dur : m.range === "bytes_over_time" ? g.b : g.b / m.dur }; });
      }
      var inner = evalM(m.e, t), gr = {};
      inner.forEach(function (s) { var l = {}; (m.by || []).forEach(function (k) { if (s.l[k] != null) l[k] = s.l[k]; }); var k = O.skey("", l); (gr[k] = gr[k] || { l: l, v: [] }).v.push(s); });
      var res = [];
      keys(gr).forEach(function (k) { var g = gr[k], vals = g.v.map(function (x) { return x.v; }); if (m.agg === "topk") { g.v.sort(function (a, b) { return b.v - a.v; }).slice(0, m.k).forEach(function (x) { res.push(x); }); return; } res.push({ l: g.l, v: m.agg === "sum" ? vals.reduce(function (a, b) { return a + b; }, 0) : m.agg === "avg" ? vals.reduce(function (a, b) { return a + b; }, 0) / vals.length : m.agg === "max" ? Math.max.apply(null, vals) : m.agg === "min" ? Math.min.apply(null, vals) : vals.length }); });
      return res;
    }
    return { metric: evalM(q, to) };
  };
  function logT(cl) { return O.fmtT(cl, K.t(cl)).replace(/-/g, "/").replace(" UTC", ""); }
  function logStamp(cl, t) { return ts(cl, t).replace(/\.\d+Z$/, "Z"); }
  function lokiCl(sess, o, io) {
    var addr = o.addr || S.getVar(sess, "LOKI_ADDR");
    var cl = K.of(sess.sys);
    if (!addr) { errl(io, "Error: Query failed: Get \"http://localhost:3100/loki/api/v1/query_range\": dial tcp 127.0.0.1:3100: connect: connection refused"); return null; }
    if (!cl || !cl.obs || !/loki/.test(addr)) { errl(io, "Error: Query failed: dial tcp: lookup " + addr.replace(/^https?:\/\//, "").split(/[:/]/)[0] + ": no such host"); return null; }
    K.touch(cl, 1); return cl;
  }
  S.CMDS.logcli = function (args, io, sess) {
    var o = KC.parse(args.slice(1)), sub = o.pos.shift();
    if (sub === "--version" || o.version) { out(io, "logcli, version 3.3.0 (branch: HEAD, revision: 2c14ed6e)\n"); return 0; }
    var cl = lokiCl(sess, o, io); if (!cl) return 1;
    var ob = cl.obs, now = K.t(cl);
    if (sub === "labels") {
      var name = o.pos[0], vals = {};
      ob.logs.forEach(function (e) { if (now - e.t > 3600 * 6) return; if (name) { if (e.l[name] != null) vals[e.l[name]] = 1; } else keys(e.l).forEach(function (k) { vals[k] = 1; }); });
      errl(io, logT(cl) + " " + (o.addr || S.getVar(sess, "LOKI_ADDR")) + "/loki/api/v1/label" + (name ? "/" + name + "/values" : "s") + "?end=" + Math.floor(O.unix(cl, now)) + "&start=" + Math.floor(O.unix(cl, now - 3600)));
      out(io, keys(vals).sort().join("\n") + "\n"); return 0;
    }
    if (sub === "series") { var q0 = o.pos[0], rq = O.logQuery(cl, q0, now - 3600, now); if (rq.error) { errl(io, "Error: " + rq.error); return 1; } var seen = {}; rq.streams.forEach(function (x) { seen[O.fmtLabels(x.base).replace(/^/, "")] = 1; }); out(io, keys(seen).join("\n") + "\n"); return 0; }
    if (sub === "query" || sub === "instant-query") {
      var q = o.pos.join(" "), since = O.durSecs(o.since || "1h"), from = now - since, limit = o.limit != null ? +o.limit : 30;
      var r = O.logQuery(cl, q, from, now);
      (cl.logQueries = cl.logQueries || []).push({ q: q, cmd: root.CI.homeSys(sess.sys).cmdIndex });
      if (r.error) { errl(io, "Error: Query failed: bad request: " + r.error); return 1; }
      errl(io, logT(cl) + " " + (o.addr || S.getVar(sess, "LOKI_ADDR")) + "/loki/api/v1/query_range?direction=BACKWARD&end=" + Math.floor(O.unix(cl, now)) + "&limit=" + limit + "&query=" + encodeURIComponent(q) + "&start=" + Math.floor(O.unix(cl, from)));
      if (r.metric) { r.metric.sort(function (a, b) { return b.v - a.v; }); r.metric.forEach(function (s) { out(io, O.fmtLabels(s.l).replace(/^\{/, "{") + " " + O.fmtVal(Math.round(s.v * 1000) / 1000) + "\n"); }); if (!r.metric.length) errl(io, logT(cl) + " No results"); return 0; }
      var lines = r.streams.slice().sort(function (a, b) { return b.t - a.t; }).slice(0, limit);
      if (!o.forward) void 0; else lines.reverse();
      if (o.output === "raw" || o.o === "raw") lines.forEach(function (x) { out(io, x.line + "\n"); });
      else if (o.output === "jsonl" || o.o === "jsonl") lines.forEach(function (x) { out(io, JSON.stringify({ labels: x.base, line: x.line, timestamp: ts(cl, x.t) }) + "\n"); });
      else { var common = commonLabels(lines.map(function (x) { return x.base; })); if (keys(common).length && !o.quiet) errl(io, "Common labels: " + O.fmtLabels(common)); lines.forEach(function (x) { var l = {}; keys(x.base).forEach(function (k) { if (common[k] !== x.base[k]) l[k] = x.base[k]; }); out(io, logStamp(cl, x.t) + " " + (keys(l).length ? O.fmtLabels(l) + " " : "") + x.line + "\n"); }); }
      if (lines.length >= limit) errl(io, logT(cl) + " Query hit the limit of " + limit + " lines: use --limit to see more");
      return 0;
    }
    out(io, "usage: logcli [<flags>] <command> [<args> ...]\n\nA command-line for loki.\n\nCommands:\n  query [<flags>] <query>\n  instant-query [<flags>] <query>\n  labels [<flags>] [<label>]\n  series [<flags>] <matcher>\n");
    return sub ? 1 : 0;
  };
  function commonLabels(list) { if (!list.length) return {}; var c = Object.assign({}, list[0]); list.forEach(function (l) { keys(c).forEach(function (k) { if (l[k] !== c[k]) delete c[k]; }); }); return c; }

  /* ================================================================== traces (Tempo) */
  O.makeTrace = function (cl, t, p, h, tid, isErr) {
    var ob = cl.obs, kind = O.appKind(cl, p), svc = (podEnv(cl, p).OTEL_SERVICE_NAME) || (p.metadata.labels || {}).app || kind, spans = [];
    var start = O.unix(cl, t) * 1e6 + Math.floor(O.rnd(tid) * 14e6), dur = Math.round(h.b.p50 * (isErr ? 1.1 : 0.6 + O.rnd(tid + "d") * (O.rnd(tid + "s") < 0.08 ? h.b.p99 / Math.max(1, h.b.p50) : 1)) * 1000);
    var root2 = { id: hex("sp" + tid, 16), parent: "", svc: svc, name: h.method + " " + h.path, start: start, dur: dur, kind: "server", attrs: { "http.method": h.method, "http.route": h.path, "http.status_code": isErr ? +h.b.code : 200, "k8s.pod.name": p.metadata.name, "k8s.namespace.name": p.metadata.namespace }, err: isErr };
    // the shop's web in front of the API, when web is instrumented too
    var webPod = kind === "orders" ? K.list(cl, "Pod", p.metadata.namespace).filter(function (x) { return O.appKind(cl, x) === "web" && /tempo/.test(podEnv(cl, x).OTEL_EXPORTER_OTLP_ENDPOINT || "") && K.podReady(x); })[0] : null;
    if (webPod) { var w = { id: hex("spw" + tid, 16), parent: "", svc: podEnv(cl, webPod).OTEL_SERVICE_NAME || "web", name: h.method + " /api" + h.path, start: start - 900, dur: dur + 2200, kind: "server", attrs: { "http.method": h.method, "http.route": "/api" + h.path, "http.status_code": isErr ? 502 : 200, "k8s.pod.name": webPod.metadata.name, "k8s.namespace.name": webPod.metadata.namespace }, err: isErr }; spans.push(w); root2.parent = w.id; }
    spans.push(root2);
    var at = start + 300;
    if (kind === "orders") {
      if (h.b.poolWait) { var pw = Math.round(h.b.poolWait * 1000 * (0.8 + O.rnd(tid + "p") * 0.4)); spans.push({ id: hex("spp" + tid, 16), parent: root2.id, svc: svc, name: "db.pool.acquire", start: at, dur: pw, kind: "internal", attrs: { "db.pool.size": +(podEnv(cl, p).DB_POOL_SIZE || 10), "db.pool.waiting": 6 } }); at += pw; }
      if (h.b.dep === "db") spans.push({ id: hex("spd" + tid, 16), parent: root2.id, svc: svc, name: "connect", start: at, dur: 4000, kind: "client", attrs: { "db.system": "postgresql", "server.address": "db" }, err: true });
      else { var dq = Math.round((12 + O.rnd(tid + "q") * 9) * 1000); spans.push({ id: hex("spq" + tid, 16), parent: root2.id, svc: svc, name: "INSERT orders", start: at, dur: dq, kind: "client", attrs: { "db.system": "postgresql", "db.name": "orders", "db.statement": "INSERT INTO orders (item, status) VALUES (%s, 'pending') RETURNING id", "server.address": "db" } }); at += dq; spans.push({ id: hex("spr" + tid, 16), parent: root2.id, svc: svc, name: "LPUSH", start: at, dur: 800, kind: "client", attrs: { "db.system": "redis", "db.operation": "LPUSH", "server.address": "redis" } }); }
    } else if (kind === "notes" && h.path === "/export") spans.push({ id: hex("sps" + tid, 16), parent: root2.id, svc: svc, name: "s3.PutObject", start: at, dur: Math.max(1000, dur - 1500), kind: "client", attrs: { "rpc.system": "aws-api", "aws.s3.bucket": "kestrel-notes-exports" }, err: isErr });
    ob.traces.push({ id: tid, t: t, root: spans[0], spans: spans, dur: spans[0].dur });
    if (ob.traces.length > 700) ob.traces.splice(0, 100);
  };
  // TraceQL subset: { cond && cond || cond } with resource./span. attributes, name, status, duration, kind
  O.traceQL = function (src) {
    var s = String(src).trim(); var m = /^\{([\s\S]*)\}$/.exec(s); if (!m) throw new Error("parse error unexpected IDENTIFIER, expecting {");
    var body = m[1].trim(); if (!body) return function () { return true; };
    var ors = body.split(/\|\|/).map(function (part) { return part.split(/&&/).map(function (c) {
      var x = /^\s*([\w.]+)\s*(=~|!=|>=|<=|=|>|<)\s*("([^"]*)"|[\w.]+)\s*$/.exec(c); if (!x) throw new Error("parse error: unexpected " + c.trim());
      var f = x[1], op = x[2], v = x[4] != null ? x[4] : x[3];
      return function (sp) {
        var have = f === "duration" ? sp.dur / 1000 : f === "name" ? sp.name : f === "status" ? (sp.err ? "error" : "unset") : f === "kind" ? sp.kind : /^resource\.service\.name$|^\.service\.name$/.test(f) ? sp.svc : /^(span|resource)?\.?(.+)$/.exec(f) && sp.attrs[f.replace(/^(span|resource)?\./, "")];
        if (have === undefined) return false;
        var want = f === "duration" ? (/ms$/.test(v) ? parseFloat(v) : /s$/.test(v) ? parseFloat(v) * 1000 : +v) : /^\d+(\.\d+)?$/.test(v) ? +v : v;
        return op === "=" ? have == want : op === "!=" ? have != want : op === "=~" ? new RegExp("^(?:" + want + ")$").test(String(have)) : op === ">" ? have > want : op === "<" ? have < want : op === ">=" ? have >= want : have <= want;
      };
    }); });
    return function (sp) { return ors.some(function (and) { return and.every(function (f) { return f(sp); }); }); };
  };
  O.tempoApi = function (cl, req) {
    var p = req.path.split("?")[0], q = O.qs(req.path), ob = cl.obs;
    if (p === "/api/search") {
      var f; try { f = q.q ? O.traceQL(q.q) : function () { return true; }; } catch (e) { return O.json(400, { error: e.message }); }
      var lim = +(q.limit || 20), from = q.start ? +q.start : null, to = q.end ? +q.end : null;
      var hits = ob.traces.slice().reverse().filter(function (tr) { var u = O.unix(cl, tr.t); return (from == null || u >= from) && (to == null || u <= to) && tr.spans.some(f); }).slice(0, lim);
      (cl.traceQueries = cl.traceQueries || []).push({ q: q.q || "", n: hits.length, start: from != null ? from - O.unix(cl, 0) : null, t: K.t(cl) });
      return O.json(200, { traces: hits.map(function (tr) { return { traceID: tr.id, rootServiceName: tr.root.svc, rootTraceName: tr.root.name, startTimeUnixNano: String(Math.round(tr.root.start * 1000)), durationMs: Math.round(tr.dur / 1000) }; }), metrics: { inspectedTraces: ob.traces.length } });
    }
    var m = /^\/api\/traces\/([0-9a-f]+)$/.exec(p);
    if (m) {
      var tr = ob.traces.filter(function (x) { return x.id === m[1]; })[0];
      if (!tr) return { status: 404, headers: { "Content-Type": "text/plain" }, body: "trace not found\n" };
      ob.lastTrace = tr.id;
      var bySvc = {}; tr.spans.forEach(function (sp) { (bySvc[sp.svc] = bySvc[sp.svc] || []).push(sp); });
      return O.json(200, { batches: keys(bySvc).map(function (svc) { return { resource: { attributes: [{ key: "service.name", value: { stringValue: svc } }] }, scopeSpans: [{ scope: { name: "opentelemetry.instrumentation" }, spans: bySvc[svc].map(function (sp) { return { traceId: tr.id, spanId: sp.id, parentSpanId: sp.parent || undefined, name: sp.name, kind: "SPAN_KIND_" + sp.kind.toUpperCase(), startTimeUnixNano: String(Math.round(sp.start * 1000)), endTimeUnixNano: String(Math.round((sp.start + sp.dur) * 1000)), durationMs: Math.round(sp.dur / 100) / 10, attributes: keys(sp.attrs).map(function (k) { return { key: k, value: typeof sp.attrs[k] === "number" ? { intValue: String(sp.attrs[k]) } : { stringValue: String(sp.attrs[k]) } }; }), status: sp.err ? { code: "STATUS_CODE_ERROR" } : {} }; }) }] }; }) });
    }
    if (p === "/ready") return { status: 200, headers: { "Content-Type": "text/plain" }, body: "ready\n" };
    return { status: 404, headers: { "Content-Type": "text/plain" }, body: "404 page not found\n" };
  };
  O.lokiApi = function (cl, req) {
    var p = req.path.split("?")[0], q = O.qs(req.path), now = K.t(cl);
    if (p === "/loki/api/v1/query_range" || p === "/loki/api/v1/query") {
      var r = O.logQuery(cl, q.query || "", now - O.durSecs(q.since || "1h"), now);
      if (r.error) return { status: 400, headers: { "Content-Type": "text/plain" }, body: r.error + "\n" };
      (cl.logQueries = cl.logQueries || []).push({ q: q.query, api: true });
      if (r.metric) return O.json(200, { status: "success", data: { resultType: "vector", result: r.metric.map(function (s) { return { metric: s.l, value: [O.unix(cl, now), O.fmtVal(s.v)] }; }) } });
      var st = {}; r.streams.slice(-(+(q.limit || 100))).forEach(function (x) { var k = O.skey("", x.base); (st[k] = st[k] || { stream: x.base, values: [] }).values.push([String(Math.round(O.unix(cl, x.t) * 1e9)), x.line]); });
      return O.json(200, { status: "success", data: { resultType: "streams", result: keys(st).map(function (k) { return st[k]; }) } });
    }
    if (p === "/ready") return { status: 200, headers: { "Content-Type": "text/plain" }, body: "ready\n" };
    return { status: 404, headers: { "Content-Type": "text/plain" }, body: "404 page not found\n" };
  };

  /* ================================================================== Grafana */
  O.dashboards = function (cl) {
    var list = [];
    K.all(cl, "ConfigMap").forEach(function (cm) {
      if (((cm.metadata.labels || {}).grafana_dashboard) !== "1") return;
      keys(cm.data || {}).forEach(function (k) { if (!/\.json$/.test(k)) return; var d; try { d = JSON.parse(cm.data[k]); } catch (e) { list.push({ cm: cm, key: k, error: "invalid JSON: " + e.message }); return; } list.push({ cm: cm, key: k, d: d, uid: d.uid || K.hex("dash" + k, 9), title: d.title || k.replace(/\.json$/, "") }); });
    });
    return list;
  };
  O.panelQueries = function (d) { var qs2 = []; (function walk(ps) { (ps || []).forEach(function (p) { (p.targets || []).forEach(function (tg) { if (tg.expr) qs2.push({ panel: p.title, type: p.type, expr: tg.expr, legend: tg.legendFormat }); }); if (p.panels) walk(p.panels); }); })(d.panels); return qs2; };
  O.expandVars = function (expr, d, sel) { var vars = {}; (((d.templating || {}).list) || []).forEach(function (v) { vars[v.name] = (sel || {})[v.name] || (v.current && (v.current.value || v.current.text)) || (v.options && v.options[0] && v.options[0].value) || ".*"; }); return String(expr).replace(/\$\{?(\w+)\}?/g, function (m0, n) { return n === "__rate_interval" || n === "__interval" ? "1m" : vars[n] != null ? vars[n] : m0; }); };
  O.grafanaApi = function (cl, req, sys) {
    var p = req.path.split("?")[0], q = O.qs(req.path), auth = (req.headers || {}).authorization || "";
    if (p === "/api/health") return O.json(200, { commit: "3b5d4b8f9a", database: "ok", version: "11.3.1" });
    if (!/^Bearer glsa_/.test(auth) && !/^Basic /.test(auth)) return O.json(401, { message: "Unauthorized", traceID: "" });
    var ds = O.dashboards(cl);
    if (p === "/api/search") return O.json(200, ds.filter(function (x) { return !x.error && (!q.query || x.title.toLowerCase().indexOf(q.query.toLowerCase()) >= 0); }).map(function (x) { return { id: 1, uid: x.uid, title: x.title, uri: "db/" + x.title.toLowerCase().replace(/\W+/g, "-"), url: "/d/" + x.uid, type: "dash-db", tags: x.d.tags || [], isStarred: false, folderTitle: "Kestrel" }; }).concat([{ id: 2, uid: "efa86fd1d0c121a26444b636a3f509a8", title: "Kubernetes / Compute Resources / Namespace (Pods)", url: "/d/efa86fd1d0c121a26444b636a3f509a8", type: "dash-db", tags: ["kubernetes-mixin"] }]));
    var m = /^\/api\/dashboards\/uid\/([\w-]+)$/.exec(p);
    if (m) { var x = ds.filter(function (y) { return y.uid === m[1]; })[0]; if (!x) return O.json(404, { message: "Dashboard not found" }); cl.obs.lastDash = x.uid; return O.json(200, { dashboard: x.d, meta: { slug: x.title.toLowerCase().replace(/\W+/g, "-"), provisioned: true, provisionedExternalId: x.key } }); }
    void sys;
    return O.json(404, { message: "Not found" });
  };

  /* ================================================================== Falco */
  var DEFAULT_FALCO = [
    "- list: shell_binaries\n  items: [ash, bash, csh, ksh, sh, tcsh, zsh, dash]",
    "- list: sensitive_file_names\n  items: [/etc/shadow, /etc/sudoers, /etc/pam.conf, /etc/security/pwquality.conf]",
    "- macro: spawned_process\n  condition: (evt.type in (execve, execveat))",
    "- macro: container\n  condition: (container.id != host)",
    "- macro: open_read\n  condition: (evt.type in (open, openat, openat2))",
    "- macro: outbound\n  condition: (evt.type = connect)",
    "- rule: Terminal shell in container\n  desc: A shell was used as the entrypoint/exec point into a container with an attached terminal.\n  condition: spawned_process and container and proc.name in (shell_binaries) and proc.tty != 0\n  output: A shell was spawned in a container with an attached terminal (evt_type=%evt.type user=%user.name user_uid=%user.uid user_loginuid=-1 process=%proc.name proc_exepath=%proc.exepath parent=%proc.pname command=%proc.cmdline terminal=%proc.tty container_id=%container.id container_image=%container.image.repository k8s_ns=%k8s.ns.name k8s_pod_name=%k8s.pod.name)\n  priority: NOTICE\n  tags: [maturity_stable, container, shell, mitre_execution, T1059]",
    "- rule: Read sensitive file untrusted\n  desc: An attempt to read any sensitive file (e.g. files containing user/password/authentication information).\n  condition: open_read and container and fd.name in (sensitive_file_names)\n  output: Sensitive file opened for reading by non-trusted program (file=%fd.name gparent=%proc.aname[2] ggparent=%proc.aname[3] evt_type=%evt.type user=%user.name user_uid=%user.uid process=%proc.name proc_exepath=%proc.exepath parent=%proc.pname command=%proc.cmdline terminal=%proc.tty container_id=%container.id container_image=%container.image.repository k8s_ns=%k8s.ns.name k8s_pod_name=%k8s.pod.name)\n  priority: WARNING\n  tags: [maturity_stable, host, container, filesystem, mitre_credential_access, T1555]"
  ].join("\n\n") + "\n";
  O.DEFAULT_FALCO = DEFAULT_FALCO;
  function falcoRules(cl) {
    var docs = [DEFAULT_FALCO];
    K.list(cl, "ConfigMap", "falco").forEach(function (cm) { if (cm.metadata.name === "falco-rules-custom") keys(cm.data || {}).forEach(function (k) { docs.push(cm.data[k]); }); });
    var lists = {}, macros = {}, rules = [], errs = [];
    docs.forEach(function (txt) { var y = Y.tryParse(txt); if (y.error) { errs.push(y.error); return; } (y.value || []).forEach(function (it) { if (!it) return; if (it.list) lists[it.list] = it.items || []; else if (it.macro) macros[it.macro] = it.condition; else if (it.rule) { if (it.enabled === false) { rules = rules.filter(function (r) { return r.rule !== it.rule; }); return; } rules = rules.filter(function (r) { return r.rule !== it.rule; }); rules.push(it); } }); });
    return { lists: lists, macros: macros, rules: rules, errs: errs };
  }
  O.falcoRules = falcoRules;
  // condition -> function(event)
  function falcoCompile(cond, R, depth) {
    if ((depth || 0) > 8) throw new Error("macro recursion");
    var toks = String(cond).match(/\(|\)|,|!=|<=|>=|=|<|>|[^\s(),!=<>]+/g) || [], pos = 0;
    function pk() { return toks[pos]; }
    function either(x, y) { return function (e) { return x(e) || y(e); }; }
    function both(x, y) { return function (e) { return x(e) && y(e); }; }
    function or() { var a = and(); while (pk() === "or") { pos++; a = either(a, and()); } return a; }
    function and() { var a = not(); while (pk() === "and") { pos++; a = both(a, not()); } return a; }
    function not() { if (pk() === "not") { pos++; var x = not(); return function (e) { return !x(e); }; } return atom(); }
    function list() { var items = []; pos++; while (pk() && pk() !== ")") { var w = toks[pos++]; if (w === ",") continue; if (R.lists[w]) items = items.concat(R.lists[w]); else items.push(w.replace(/^["']|["']$/g, "")); } pos++; return items.map(String); }
    function atom() {
      var w = toks[pos++];
      if (w === "(") { var e = or(); pos++; return e; }
      if (R.macros[w] != null) return falcoCompile(R.macros[w], R, (depth || 0) + 1);
      var op = pk();
      if (op === "in") { pos++; var items = list(); return function (e) { return items.indexOf(String(e[w])) >= 0; }; }
      if (op === "exists") { pos++; return function (e) { return e[w] != null; }; }
      if (/^(=|!=|<|<=|>|>=|contains|startswith|endswith|pmatch|glob)$/.test(op || "")) {
        pos++; var v = toks[pos++]; if (v === "(") { pos--; var it2 = list(); return function (e) { return it2.some(function (x) { return String(e[w] || "").indexOf(x) === 0; }); }; }
        v = String(v).replace(/^["']|["']$/g, "");
        return function (e) { var h = e[w]; if (h == null) return op === "!="; var hn = +h, vn = +v; return op === "=" ? String(h) === v : op === "!=" ? String(h) !== v : op === "contains" ? String(h).indexOf(v) >= 0 : op === "startswith" ? String(h).indexOf(v) === 0 : op === "endswith" ? String(h).slice(-v.length) === v : op === "<" ? hn < vn : op === "<=" ? hn <= vn : op === ">" ? hn > vn : hn >= vn; };
      }
      throw new Error("Compilation error when compiling \"" + cond + "\": unexpected token " + w);
    }
    var f = or();
    if (pos < toks.length) throw new Error("Compilation error when compiling \"" + cond + "\": unexpected token " + toks[pos]);
    return f;
  }
  O.falcoCompile = falcoCompile;
  var PRI = ["EMERGENCY", "ALERT", "CRITICAL", "ERROR", "WARNING", "NOTICE", "INFORMATIONAL", "DEBUG"];
  O.falcoEvent = function (cl, ev, t) {
    var ob = cl.obs; if (!ob || !cl.comps.falco) return;
    var R = falcoRules(cl);
    R.rules.forEach(function (r) {
      var f; try { f = falcoCompile(r.condition, R); } catch (e) { return; }
      if (!f(ev)) return;
      var pri = String(r.priority || "NOTICE").toUpperCase(), when = ts(cl, t).replace(/\.(\d{3})Z$/, ".$1456789Z");
      var text = String(r.output || "").replace(/%([\w.]+(\[\d\])?)/g, function (m0, k) { var v = ev[k.replace(/\[\d\]$/, "")]; return v == null ? "<NA>" : v; });
      var rec = { hostname: ev.node || "kc-node-1", output: when.slice(11, 29) + ": " + pri.charAt(0) + pri.slice(1).toLowerCase() + " " + text, output_fields: { "container.id": ev["container.id"], "k8s.ns.name": ev["k8s.ns.name"], "k8s.pod.name": ev["k8s.pod.name"], "proc.cmdline": ev["proc.cmdline"], "user.name": ev["user.name"], "fd.name": ev["fd.name"] }, priority: pri.charAt(0) + pri.slice(1).toLowerCase(), rule: r.rule, source: "syscall", tags: r.tags || [], time: when, t: t, ev: ev };
      ob.falco.push(rec);
      O.addLog(ob, t, { namespace: "falco", app: "falco", pod: "falco-" + K.rand("f" + (ev.node || ""), 5), container: "falco", node_name: ev.node || "", job: "falco/falco", stream: "stdout" }, JSON.stringify((function () { var c = Object.assign({}, rec); delete c.t; delete c.ev; return c; })()));
      // falcosidekick forwards Warning and above to Alertmanager
      if (PRI.indexOf(pri) <= PRI.indexOf("WARNING")) { var l = { alertname: "Falco: " + r.rule, severity: PRI.indexOf(pri) <= PRI.indexOf("ERROR") ? "critical" : "warning", source: "falco", rule: r.rule, k8s_ns: ev["k8s.ns.name"] || "", k8s_pod: ev["k8s.pod.name"] || "" }; var k = O.skey("A", l); ob.alerts[k] = { labels: l, activeAt: t, firedAt: t, state: "firing", annotations: { summary: rec.output.replace(/^[\d:.]+: \w+ /, "").slice(0, 160) }, value: 1, rule: { alert: l.alertname, forS: 0 }, falcoUntil: t + 600 }; }
    });
  };
  K.ctlHooks.push(function (cl) { var ob = cl.obs; if (!ob) return; keys(ob.alerts).forEach(function (k) { var a = ob.alerts[k]; if (a.falcoUntil != null && K.t(cl) > a.falcoUntil && a.state === "firing") { a.state = "resolved"; a.resolvedAt = K.t(cl); } }); });
  function ctrEvent(cl, p, c, extra) {
    var img = p.spec.containers.filter(function (x) { return x.name === (c.k8s || {}).ctr; })[0] || p.spec.containers[0];
    return Object.assign({ "container.id": c.id.slice(0, 12), "container.image.repository": String(img.image).replace(/[:@].*$/, ""), "k8s.ns.name": p.metadata.namespace, "k8s.pod.name": p.metadata.name, "user.name": c.user && /^\d+/.test(String(c.user)) ? (String(c.user).split(":")[0] === "0" ? "root" : "<NA>") : (c.user || "root"), "user.uid": c.user ? String(c.user).split(":")[0] : "0", "proc.pname": "runc", "proc.tty": 0, node: p.spec.nodeName }, extra);
  }
  O.ctrEvent = ctrEvent;
  // kubectl exec into a pod, and every line typed in a pod's shell, are seen by Falco
  O.procEvents = function (cl, p, c, line, o) {
    o = o || {};
    String(line).split(/\s*(?:;|&&|\|\||\|)\s*/).forEach(function (part) {
      var words = part.trim().split(/\s+/).filter(Boolean); if (!words.length) return;
      var name = words[0].split("/").pop(), t = o.t != null ? o.t : K.t(cl);
      var base = { "proc.name": name, "proc.exepath": /\//.test(words[0]) ? words[0] : "/bin/" + name, "proc.cmdline": words.join(" "), "proc.pname": o.pname || "sh", "proc.tty": o.tty ? 34816 : 0 };
      O.falcoEvent(cl, ctrEvent(cl, p, c, Object.assign({ "evt.type": "execve" }, base)), t);
      words.slice(1).forEach(function (a) { if (/^\/(etc|root|var|home|proc|run)\//.test(a)) O.falcoEvent(cl, ctrEvent(cl, p, c, Object.assign({ "evt.type": "openat", "fd.name": a }, base)), t); });
      var hp = /^(nc|ncat|wget|curl|telnet)$/.test(name) ? (/https?:\/\/([\w.-]+):?(\d*)/.exec(part) || /\b([a-z][\w.-]*\.[a-z]{2,}|\d+\.\d+\.\d+\.\d+)[: ]+(\d{2,5})\b/.exec(words.slice(1).join(" "))) : null;
      if (hp) O.falcoEvent(cl, ctrEvent(cl, p, c, Object.assign({ "evt.type": "connect", "fd.sip": hp[1], "fd.sport": hp[2] || "80", "fd.rport": hp[2] || "80", "fd.name": hp[1] + ":" + (hp[2] || "80") }, base)), t);
    });
  };
  var auditPrev = K.audit;
  K.audit = function (cl, sub, verb, obj, extra) {
    auditPrev(cl, sub, verb, obj, extra);
    if (verb === "exec" && cl.obs && obj.kind === "Pod") {
      var c = K.ctrOf(cl, obj); if (!c) return;
      var cmd = String((extra || {}).cmd || ""), first = cmd.split(/\s+/)[0].split("/").pop();
      var lone = /^(sh|bash|ash|dash)$/.test(first) && cmd.trim().split(/\s+/).length === 1;
      var m = /^(?:\/bin\/)?(?:sh|bash) -c (.*)$/.exec(cmd);
      O.procEvents(cl, obj, c, lone ? first : cmd, { pname: "runc", tty: lone });
      if (m) O.procEvents(cl, obj, c, m[1].replace(/^["']|["']$/g, ""), { pname: first });
    }
  };
  var afterPrev = S.afterLine;
  S.afterLine = function (sess, io) {
    if (afterPrev) afterPrev(sess, io);
    var cl = K.of(sess.sys); if (!cl || !cl.obs) return;
    // the laptop's clock keeps up with the cluster's, so $(date +%s) in a query means the same moment
    var home = root.CI.homeSys(sess.sys), cn = Dk.stamp(cl.rt, K.t(cl)); if (home && home.now < cn) home.now = cn;
    var top = sess.userStack.length ? sess.userStack[sess.userStack.length - 1] : null; if (!top || !top.dkCtr) return;
    var c = Dk.state(cl.rt).ctrs.filter(function (x) { return x.id === top.dkCtr; })[0]; if (!c || !c.k8s) return;
    var p = K.podOfCtr(cl, c); if (!p) return;
    O.procEvents(cl, p, c, sess.histLines[sess.histLines.length - 1] || "", { tty: true });
  };
  K.virtualLogs = function (cl, p) {
    if (!cl.obs) return null;
    if ((p.metadata.labels || {})["app.kubernetes.io/name"] === "falco") return cl.obs.falco.filter(function (f) { return f.hostname === p.spec.nodeName; }).map(function (f) { var c = Object.assign({}, f); delete c.t; delete c.ev; return JSON.stringify(c); });
    return null;
  };

  /* ================================================================== oncall: pages, Slack, incidents, status page */
  function ocl(sess, io) { var cl = K.of(sess.sys); if (!cl || !cl.obs) { errl(io, "oncall: not configured (run oncall login)"); return null; } K.touch(cl, 1); return cl; }
  function incs(cl) { return cl.obs.incidents || (cl.obs.incidents = []); }
  S.CMDS.oncall = function (args, io, sess) {
    var o = KC.parse(args.slice(1)), sub = o.pos.shift();
    var cl = ocl(sess, io); if (!cl) return 1;
    var ob = cl.obs, t = K.t(cl), who = "kc-dev";
    O.alertmanager(cl, t);
    var tbl = O.table;
    if (!sub || sub === "pages") {
      var pages = ob.am.notifs.filter(function (n) { return n.type === "pagerduty"; }).slice(-20).reverse();
      if (!pages.length) { out(io, "No pages.\n"); return 0; }
      var rows = [["ID", "TIME", "STATUS", "ACK", "SUMMARY"]];
      pages.forEach(function (n) { rows.push([n.id, O.fmtT(cl, n.t).slice(11, 19), n.status.toUpperCase(), n.acked ? "acked by " + n.acked : "-", n.alerts.length + " alert" + (n.alerts.length > 1 ? "s" : "") + ": " + n.alerts.map(function (a) { return a.labels.alertname + (a.labels.namespace ? " (" + a.labels.namespace + ")" : ""); }).join(", ")]); });
      out(io, tbl(rows)); return 0;
    }
    if (sub === "show") { var n0 = ob.am.notifs.filter(function (n) { return n.id === o.pos[0]; })[0]; if (!n0) { errl(io, "oncall: no page " + o.pos[0]); return 1; } out(io, "Page " + n0.id + " (" + n0.status + ") at " + O.fmtT(cl, n0.t) + " via " + n0.receiver + "\n" + n0.alerts.map(function (a) { return "\n[" + a.state.toUpperCase() + "] " + a.labels.alertname + "\n  labels: " + keys(a.labels).sort().map(function (k) { return k + "=" + a.labels[k]; }).join(" ") + "\n" + keys(a.annotations || {}).map(function (k) { return "  " + k + ": " + a.annotations[k]; }).join("\n"); }).join("\n") + "\n"); return 0; }
    if (sub === "ack") { var n1 = ob.am.notifs.filter(function (n) { return n.id === o.pos[0]; })[0]; if (!n1) { errl(io, "oncall: no page " + o.pos[0]); return 1; } n1.acked = who; n1.ackAt = t; out(io, "Acknowledged " + n1.id + ". Escalation stopped; you own it now.\n"); incLog(cl, "Page " + n1.id + " acknowledged by " + who); return 0; }
    if (sub === "slack") {
      var ch = o.pos[0], msgs = ob.am.notifs.filter(function (n) { return n.type === "slack" && (!ch || n.channel === ch); }).slice(-15);
      if (!msgs.length) { out(io, "No messages" + (ch ? " in " + ch : "") + ".\n"); return 0; }
      msgs.forEach(function (n) { out(io, O.fmtT(cl, n.t).slice(11, 19) + " " + (n.channel || "#alerts") + "  Alertmanager: [" + n.status.toUpperCase() + ":" + n.alerts.filter(function (a) { return a.state === "firing"; }).length + "] " + n.alerts[0].labels.alertname + " " + (n.alerts[0].labels.namespace || "") + "\n" + n.alerts.map(function (a) { return "    - " + ((a.annotations || {}).summary || a.labels.alertname); }).join("\n") + "\n"); });
      return 0;
    }
    if (sub === "incident") {
      var is = o.pos.shift(), cur = incs(cl).filter(function (x) { return x.state !== "resolved"; }).slice(-1)[0];
      if (is === "declare") { if (!o.title) { errl(io, "oncall: --title is required"); return 1; } var inc2 = { id: "INC-" + (2041 + incs(cl).length), title: o.title, sev: +(o.sev || 3), state: "investigating", t: t, log: [], updates: [], commander: who }; incs(cl).push(inc2); incLog(cl, "Incident declared (SEV" + inc2.sev + "): " + inc2.title); out(io, "Declared " + inc2.id + " (SEV" + inc2.sev + "): " + inc2.title + "\nIncident commander: " + who + "\nSlack channel: #" + inc2.id.toLowerCase() + "\n"); return 0; }
      if (!cur && is !== "list" && is !== "timeline" && is !== "show") { errl(io, "oncall: no open incident (oncall incident declare --sev N --title ...)"); return 1; }
      if (is === "update") { var text = o.pos.join(" "); if (!text) { errl(io, "oncall: an update needs text"); return 1; } var st = o.status || o.state; if (st) cur.state = st; cur.updates.push({ t: t, text: text, pub: !!o["public"], state: cur.state }); incLog(cl, (o["public"] ? "Status page: " : "Update: ") + text); out(io, cur.id + " updated" + (o["public"] ? " (posted to status.kestrel.dev)" : "") + ".\n"); return 0; }
      if (is === "note") { incLog(cl, o.pos.join(" ")); out(io, "Noted.\n"); return 0; }
      if (is === "resolve") { cur.state = "resolved"; cur.resolvedAt = t; incLog(cl, "Incident resolved" + (o.pos.length ? ": " + o.pos.join(" ") : "")); out(io, cur.id + " resolved after " + Math.round((t - cur.t) / 60) + " minutes.\n"); return 0; }
      if (is === "timeline" || is === "show") { var x = cur || incs(cl).slice(-1)[0]; if (!x) { out(io, "No incidents.\n"); return 0; } out(io, x.id + " SEV" + x.sev + " " + x.title + " [" + x.state + "]\n" + x.log.map(function (l) { return "  " + O.fmtT(cl, l.t).slice(11, 19) + " UTC  " + l.text; }).join("\n") + "\n"); return 0; }
      if (is === "list") { var rows3 = [["ID", "SEV", "STATE", "DECLARED", "TITLE"]]; incs(cl).forEach(function (x) { rows3.push([x.id, x.sev, x.state, O.fmtT(cl, x.t).slice(0, 16), x.title]); }); out(io, tbl(rows3)); return 0; }
      errl(io, "oncall incident: unknown command \"" + (is || "") + "\" (declare, update, note, resolve, timeline, list)"); return 1;
    }
    out(io, "oncall: Kestrel's on-call tool\n\n  oncall pages                       pages sent to the on-call engineer\n  oncall show ID | ack ID            a page's alerts / acknowledge it\n  oncall slack [#channel]            alert messages posted to Slack\n  oncall incident declare --sev N --title TEXT\n  oncall incident update [--public] [--status STATE] TEXT\n  oncall incident note TEXT | resolve | timeline | list\n");
    return sub ? 1 : 0;
  };
  function incLog(cl, text) { var cur = incs(cl).filter(function (x) { return x.state !== "resolved"; }).slice(-1)[0]; if (cur) cur.log.push({ t: K.t(cl), text: text }); }
  O.incLog = incLog;

  /* ================================================================== the laptop reaches the stack through the ingress */
  var ingPrev = K.ingressServe;
  K.ingressServe = function (cl, req, client) {
    var host = String((req.headers || {}).host || req.host).replace(/:\d+$/, "");
    if (cl.obs && /^(prometheus|alertmanager|grafana|loki|tempo)\.staging\.kestrel\.dev$/.test(host)) {
      K.touch(cl, 0);
      if (/^prometheus/.test(host)) return O.promApi(cl, req);
      if (/^loki/.test(host)) return O.lokiApi(cl, req);
      if (/^tempo/.test(host)) return O.tempoApi(cl, req);
      if (/^grafana/.test(host)) return O.grafanaApi(cl, req);
      if (/^alertmanager/.test(host)) { var al = keys(cl.obs.alerts).map(function (k) { return cl.obs.alerts[k]; }).filter(function (a) { return a.state === "firing"; }); return O.json(200, al.map(function (a) { return { labels: a.labels, annotations: a.annotations, startsAt: K.stamp(cl, a.firedAt), status: { state: a.silencedBy ? "suppressed" : "active", silencedBy: a.silencedBy ? [a.silencedBy.id] : [], inhibitedBy: [] } }; })); }
    }
    return ingPrev(cl, req, client);
  };
  if (M2.net && M2.net.SITES) {
    O.HOSTS.forEach(function (h) { if (h !== "status.kestrel.dev") M2.net.DNS[h] = { A: [K.INGRESS_IP] }; });
    M2.net.DNS["status.kestrel.dev"] = { A: ["198.51.100.30"] };
    M2.net.HOSTS["198.51.100.30"] = { ping: 12.4, ports: [80, 443], site: "kestrel-status" };
    M2.net.SITES["kestrel-status"] = function (req, sys) {
      var cl = K.of(sys) || K.current, list = cl && cl.obs ? incs(cl) : [];
      var pubs = []; list.forEach(function (x) { x.updates.filter(function (u) { return u.pub; }).forEach(function (u) { pubs.push({ x: x, u: u }); }); });
      var open = list.filter(function (x) { return x.state !== "resolved" && x.updates.some(function (u) { return u.pub; }); });
      var body = "<!doctype html>\n<title>Kestrel status</title>\n<h1>" + (open.length ? "Partial outage" : "All systems operational") + "</h1>\n" + pubs.slice(-5).reverse().map(function (p) { return "<h2>" + p.x.title.replace(/</g, "&lt;") + "</h2>\n<p><b>" + p.u.state + "</b> - " + p.u.text.replace(/</g, "&lt;") + " <small>" + O.fmtT(cl, p.u.t) + "</small></p>"; }).join("\n") + "\n";
      return { status: 200, headers: { "Content-Type": "text/html" }, body: body };
    };
  }
})(typeof window !== "undefined" ? window : globalThis);
