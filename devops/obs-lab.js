/* sudo learn — DevOps Module 5 lab world: kestrel-staging (Module 4's cluster) with kube-prometheus-stack, Loki,
   Tempo, Grafana and optionally Falco, traffic flowing through the shop and notes apps, and the laptop set up to
   reach them (promtool, amtool, logcli, oncall; prometheus/alertmanager/grafana/loki/tempo.staging.kestrel.dev).
   O.world(o) builds on K.world; scenarios change app behaviour over time through `effects`. Check helpers in O.H. */
(function (root) {
  "use strict";
  var S = root.ShEngine, Dk = root.Dk, CI = root.CI, K = root.K8s, O = root.Obs, DL = root.DevLab;
  function keys(o) { return o ? Object.keys(o) : []; }
  var HOME = K.HOME, MB = 1048576;
  function sc() { return Array.prototype.slice.call(arguments).filter(function (x) { return x !== null; }).join("\n") + "\n"; }
  O.sc = sc;

  /* ================================================================== images: orders-api 3.2.0 leaks memory */
  var pubPrev = K.publishImages;
  K.publishImages = function (sys, o) {
    var dg = pubPrev(sys, o);
    if (!(o && o.comps && o.comps.prometheus)) return dg;
    var src = "# Kestrel orders API 3.2.0: adds an in-memory cache of recent orders (never evicted)\n";
    var im = K.pyImage(sys, "orders-3.2.0", src, [["flask", "3.1.1"], ["gunicorn", "23.0.0"], ["psycopg", "3.2.9"], ["redis", "5.2.1"]], { version: "3.2.0", repo: "kestrel/orders-api", daysAgo: 1, labels: { "kestrel.sim/memory-mb": "120", "kestrel.sim/leak-mb-per-min": "17" } });
    dg["orders-api:3.2.0"] = DL.setup.publish(sys, "ghcr.io/kestrel/orders-api:3.2.0", im);
    return dg;
  };

  /* ================================================================== the monitoring stack's own objects */
  var RULES_APPS = sc("apiVersion: monitoring.coreos.com/v1", "kind: PrometheusRule", "metadata:", "  name: kube-prometheus-stack-kubernetes-apps", "  namespace: monitoring", "  labels:", "    release: monitoring", "    app: kube-prometheus-stack", "spec:", "  groups:", "    - name: kubernetes-apps", "      rules:",
    "        - alert: KubePodCrashLooping", "          expr: max_over_time(kube_pod_container_status_waiting_reason{reason=\"CrashLoopBackOff\", job=\"kube-state-metrics\"}[5m]) >= 1", "          for: 15m", "          labels:", "            severity: warning", "          annotations:", "            summary: Pod is crash looping.", "            description: 'Pod {{ $labels.namespace }}/{{ $labels.pod }} ({{ $labels.container }}) is in waiting state (reason: \"CrashLoopBackOff\").'",
    "        - alert: KubeDeploymentReplicasMismatch", "          expr: kube_deployment_spec_replicas{job=\"kube-state-metrics\"} > kube_deployment_status_replicas_available{job=\"kube-state-metrics\"}", "          for: 15m", "          labels:", "            severity: warning", "          annotations:", "            summary: Deployment has not matched the expected number of replicas.", "            description: 'Deployment {{ $labels.namespace }}/{{ $labels.deployment }} has not matched the expected number of replicas for longer than 15 minutes.'",
    "    - name: general.rules", "      rules:", "        - alert: Watchdog", "          expr: vector(1)", "          labels:", "            severity: none", "          annotations:", "            summary: An alert that should always be firing to certify that Alertmanager is working properly.");
  O.RULES_APPS = RULES_APPS;
  var AM_DEFAULT = sc("global:", "  resolve_timeout: 5m", "route:", "  receiver: slack-alerts", "  group_by: [alertname, namespace]", "  group_wait: 30s", "  group_interval: 5m", "  repeat_interval: 4h", "  routes:", "    - receiver: \"null\"", "      matchers:", "        - alertname = Watchdog", "    - receiver: pagerduty-sre", "      matchers:", "        - severity = critical",
    "receivers:", "  - name: \"null\"", "  - name: slack-alerts", "    slack_configs:", "      - channel: \"#alerts\"", "        api_url_file: /etc/alertmanager/secrets/slack-url", "        send_resolved: true", "  - name: pagerduty-sre", "    pagerduty_configs:", "      - routing_key_file: /etc/alertmanager/secrets/pagerduty-key");
  O.AM_DEFAULT = AM_DEFAULT;
  function amSecret(text) { return { apiVersion: "v1", kind: "Secret", metadata: { name: "alertmanager-main", namespace: "monitoring", labels: { "app.kubernetes.io/name": "alertmanager" } }, type: "Opaque", stringData: { "alertmanager.yaml": text } }; }
  O.amSecret = amSecret;
  O.serviceMonitor = function (name, ns, app, o) { o = o || {}; return sc("apiVersion: monitoring.coreos.com/v1", "kind: ServiceMonitor", "metadata:", "  name: " + name, "  namespace: " + ns, "  labels:", "    release: monitoring", "spec:", "  selector:", "    matchLabels:", "      app: " + app, "  endpoints:", "    - port: " + (o.port || "http"), "      interval: 30s"); };
  var GRAFANA_TOKEN = ["glsa", "kc0dev", "N2u8QfRk3TzW5vYp1LmH6dXa9Jc4Bs7E", "1f2a9c3d"].join("_");
  O.GRAFANA_TOKEN = GRAFANA_TOKEN;

  // default traffic: people using the shop and the notes app
  O.TRAFFIC = {
    shop: [{ host: "shop.staging.kestrel.dev", path: "/", rps: 6 }, { host: "shop.staging.kestrel.dev", path: "/api/orders", method: "POST", rps: 2 }],
    notes: [{ host: "notes.staging.kestrel.dev", path: "/notes", rps: 5 }, { host: "notes.staging.kestrel.dev", path: "/export", method: "POST", rps: 0.3 }],
    payments: [{ host: "payments.staging.kestrel.dev", path: "/charge", method: "POST", rps: 1.5 }]
  };

  /* ================================================================== the world */
  O.world = function (o) {
    o = o || {};
    var comps = Object.assign({ prometheus: true }, o.comps || {});
    if (o.falco) comps.falco = true;
    var objects = [RULES_APPS, amSecret(o.am || AM_DEFAULT)].concat(o.objects || []);
    return K.world(Object.assign({}, o, { comps: comps, objects: objects, settle: o.settle != null ? o.settle : 60,
      after: function (sys, cl) {
        ["promtool", "amtool", "logcli", "oncall"].forEach(function (b) { CI.putBin(sys, "/usr/local/bin/" + b, b); });
        if (!Dk.fsNode(sys, "/usr/bin/jq")) CI.putBin(sys, "/usr/bin/jq", "jq");
        var traffic = [];
        (o.traffic || ["shop"]).forEach(function (t) { if (typeof t === "string") traffic = traffic.concat(O.TRAFFIC[t] || []); else traffic.push(t); });
        O.init(cl, { traffic: traffic, effects: o.effects || [] });
        if (o.diskFill) cl.obs.diskFill = o.diskFill;
        var bashrc = (K.read ? null : null) || "";
        K.put(sys, HOME + "/.bashrc", (Dk.fsNode(sys, HOME + "/.bashrc") ? S.readSys(sys, HOME + "/.bashrc") || "" : "") + sc("", "# Kestrel monitoring (staging)", "export PROM=http://prometheus.staging.kestrel.dev", "export LOKI_ADDR=http://loki.staging.kestrel.dev", "export TEMPO=http://tempo.staging.kestrel.dev", "export GRAFANA=http://grafana.staging.kestrel.dev"));
        void bashrc;
        K.put(sys, HOME + "/.config/amtool/config.yml", sc("alertmanager.url: http://alertmanager.staging.kestrel.dev", "author: kc-dev@kestrel.dev", "output: extended"));
        K.put(sys, HOME + "/.config/grafana/token", GRAFANA_TOKEN + "\n", 384);
        O.crashHistory(cl);
        if (o.after) o.after(sys, cl);
      } }));
  };

  /* ---------------- scenario helpers */
  // an effect active between two times: fn(cl, p, path, t, kind) -> overrides or null
  O.window = function (from, to, match, b) { return function (cl, p, path, t, kind) { return t >= from && t < to && match(kind, path, p, cl) ? b : null; }; };
  // a leaking pod's errors grow as it nears its limit (GC thrashing), then it's OOMKilled
  O.leakErrors = function (cl, p, path, t, kind) {
    var c = K.ctrOf(cl, p); if (!c || !c.k8sLeak || !c.mem) return null;
    var m = K.leakMem(cl, c, t) / c.mem; if (m < 0.6) return null;
    var x = (m - 0.6) / 0.4;
    return { err: Math.min(0.95, 0.9 * Math.pow(x, 1.5)), code: "500", p50: 55 + 900 * x * x, p99: 220 + 4200 * x * x, errMsg: "MemoryError: unable to allocate order cache entry (resident memory " + Math.round(K.leakMem(cl, c, t) / MB) + "MiB)" };
  };
  // pretend a leaking deployment has been crashing for a while: earlier runs and OOM restarts before t=0
  O.leakHistory = function (cl, ns, app, runs, nextOomIn) {
    K.list(cl, "Pod", ns).filter(function (p) { return (p.metadata.labels || {}).app === app && !K.terminating(p); }).forEach(function (p, i) {
      var c = K.ctrOf(cl, p); if (!c || !c.k8sLeak || !c.mem) return;
      var period = Math.round((c.mem - c.k8sMemBase) / MB / c.k8sLeak * 60), off = (nextOomIn || 150) + i * 97;
      c.k8sLeakStart = off - period; c.k8sOomAt = off;
      c.k8sLeakPrev = []; for (var k = runs; k >= 1; k--) c.k8sLeakPrev.push(c.k8sLeakStart - k * (period + 12));
      var st = (p.status.containerStatuses || [])[0];
      if (st) { st.restartCount = runs; st.lastState = { terminated: { exitCode: 137, reason: "OOMKilled", startedAt: c.k8sLeakStart - period - 12, finishedAt: c.k8sLeakStart - 12, containerID: st.containerID } }; st.state = { running: { startedAt: c.k8sLeakStart } }; }
      p._rt.rcHist = c.k8sLeakPrev.slice(1).concat([c.k8sLeakStart]);
      p.metadata.creationTimestamp = c.k8sLeakPrev[0] - 20;
      c.k8sLeakPrev.slice(1).concat([c.k8sLeakStart]).forEach(function (rt) { K.event(cl, p, "Warning", "BackOff", "Back-off restarting failed container " + p.spec.containers[0].name + " in pod " + p.metadata.name + "_" + ns + "(" + p.metadata.uid + ")", "kubelet"); void rt; });
    });
  };
  // pods that were crash looping when the world was made have been restarting every ~5 minutes (back-off cap)
  O.crashHistory = function (cl) {
    K.all(cl, "Pod").forEach(function (p) {
      if ((p._rt || {}).rcHist || (p._rt || {}).virtual) return;
      var st = (p.status.containerStatuses || [])[0]; if (!st || (st.restartCount || 0) < 3) return;
      var w = (st.state || {}).waiting, lt = (st.lastState || {}).terminated;
      if (!((w && w.reason === "CrashLoopBackOff") || (lt && /Error|OOMKilled/.test(lt.reason) && (st.state || {}).running && K.t(cl) - (st.state.running.startedAt || 0) < 5))) return;
      var h = []; for (var t = -7200 + 137; t < 0; t += 300) h.push(t);
      p._rt.rcHist = h; st.restartCount += h.length;
    });
  };
  // a scripted happening at time t (cluster seconds), e.g. someone exec'ing into a pod
  O.at = function (cl, t, fn) { (cl.obs.timeline = cl.obs.timeline || []).push({ t: t, run: fn }); };

  /* ================================================================== checks */
  function dec(s) { try { return decodeURIComponent(s); } catch (x) { return s; } }
  function out(e) { return e.out.join("\n"); }
  function all(e) { return e.lines.map(function (l) { return l.text; }).join("\n"); }
  var H = O.H = {
    cl: function (r) { return K.of(r.sys); },
    ob: function (r) { var cl = K.of(r.sys); return cl && cl.obs; },
    // a PromQL query the learner ran (promtool query or curl to the HTTP API) whose text matches qre and output matches ore
    prom: function (r, qre, ore) { return r.history.some(function (e) { var isQ = /^\s*promtool\s+query\b/.test(e.cmd) || /\bcurl\b.*(prometheus\.staging|\$PROM|\$\{PROM\})/.test(e.cmd); if (!isQ) return false; var q = dec(e.cmd.replace(/\+/g, " ")); return qre.test(q) && (!ore || ore.test(all(e))); }); },
    logs: function (r, qre, ore) { return r.history.some(function (e) { var isQ = /^\s*logcli\s+(instant-)?query\b/.test(e.cmd) || /\bcurl\b.*(loki\.staging|LOKI_ADDR)/.test(e.cmd); if (!isQ) return false; return qre.test(dec(e.cmd)) && (!ore || ore.test(out(e))); }); },
    value: function (r, q) { var cl = K.of(r.sys); if (!cl || !cl.obs) return null; var x = O.query(cl, q, K.t(cl)); if (x.error) return null; if (x.type === "scalar") return x.value; return x.data; },
    series: function (r, name, match) { var ob = H.ob(r); if (!ob) return []; return keys(ob.series).map(function (k) { return ob.series[k]; }).filter(function (s) { return s.name === name && (!match || keys(match).every(function (l) { return match[l] instanceof RegExp ? match[l].test(s.labels[l] || "") : s.labels[l] === match[l]; })); }); },
    targets: function (r) { var cl = K.of(r.sys); return cl ? O.targets(cl) : []; },
    rules: function (r) { var cl = K.of(r.sys); return cl ? O.loadRules(cl) : []; },
    rule: function (r, name) { return H.rules(r).filter(function (x) { return x.alert === name || x.record === name; })[0] || null; },
    alerts: function (r, fn) { var ob = H.ob(r); if (!ob) return []; return keys(ob.alerts).map(function (k) { return ob.alerts[k]; }).filter(fn || function () { return true; }); },
    notifs: function (r, fn) { var ob = H.ob(r); return ob ? ob.am.notifs.filter(fn || function () { return true; }) : []; },
    silences: function (r) { var ob = H.ob(r); return ob ? ob.am.silences : []; },
    am: function (r) { var cl = K.of(r.sys); return cl ? O.amConfig(cl) : { error: "no cluster" }; },
    incidents: function (r) { var ob = H.ob(r); return ob ? (ob.incidents || []) : []; },
    falco: function (r, fn) { var ob = H.ob(r); return ob ? ob.falco.filter(fn || function () { return true; }) : []; },
    dash: function (r, title) { var cl = K.of(r.sys); return cl ? O.dashboards(cl).filter(function (d) { return !title || d.title === title; }) : []; },
    out: out, all: all
  };

  /* ================================================================== explanations */
  var SL = root.ShLab;
  if (SL && SL.EXPLAIN) [
    [/parse error: unexpected|could not parse expression/, "PromQL couldn't parse that: check brackets, quotes around label values (job=\"notes\") and that functions like rate() get a range vector (metric[5m])."],
    [/expected type range vector in call to function/, "That function needs a range vector: add a range to the selector, like rate(http_requests_total[5m])."],
    [/many-to-many matching not allowed|multiple matches for labels/, "Both sides of the operation have several series with the same matching labels. Use on(...)/ignoring(...) to say which labels to match, and group_left when one side has many series per match."],
    [/Rules are not valid/, "The Prometheus operator rejected the PrometheusRule: the listed rule has a bad expression or field. promtool check rules on a plain rules file finds the same errors before you apply."],
    [/queries require at least one regexp or equality matcher that does not have an empty-compatible value/, "Loki needs at least one label matcher that can't match empty, e.g. {namespace=\"notes\"} rather than {app=~\".*\"}."],
    [/required flag --alertmanager\.url not provided/, "amtool doesn't know where Alertmanager is: pass --alertmanager.url or put alertmanager.url in ~/.config/amtool/config.yml."],
    [/Query hit the limit of \d+ lines/, "logcli shows the newest lines up to --limit (30 by default). Narrow the query (more labels, |= filters) or raise --limit."]
  ].reverse().forEach(function (e) { SL.EXPLAIN.unshift(e); });
})(typeof window !== "undefined" ? window : globalThis);
