/* sudo learn — DevOps Module 5 practice drills (3 per lab, +5 XP each). Each drill is a small scenario on
   kestrel-staging with its monitoring stack: a question to answer with PromQL/LogQL/TraceQL, a piece of alerting
   or dashboard configuration to fix, or a small incident chore. */
(function () {
  "use strict";
  var T = window.DEV_TRACK, B = T.B, M4 = B.M4, M = B.M5, Mb = B.M5b, K = window.K8s, O = window.Obs, Dk = window.Dk;
  var H = K.H, OH = O.H, sc = B.sc, sol = B.sol, HOME = B.HOME;
  var nsDoc = M4.nsDoc, ran = M4.ran, kc = M4.kc, out = M4.out, all = M4.all, ctrOf = M4.ctrOf, envOf = M4.envOf;
  var prom = M.prom, logq = M.logq, file = M.file, world = M.world;
  function keys(o) { return o ? Object.keys(o) : []; }
  function cl(r) { return OH.cl(r); }

  /* shared worlds */
  function shopNotes(o) { o = o || {}; return world(Object.assign({ objects: M.shop(o.shop).concat([nsDoc(M.notesApp(o.notes), "notes"), M.SM_ORDERS, M.SM_NOTES]).concat(o.extra || []), traffic: ["shop", "notes"] }, o.world || {})); }
  var SM_TYPO = M.SM_NOTES.replace("      app: notes", "      app: note");
  var DASH_STAT = (function () { var d = JSON.parse(M.DASH_FIXED); d.panels.push({ id: 4, type: "stat", title: "Restarts (1h)", gridPos: { h: 4, w: 6, x: 0, y: 8 }, targets: [{ expr: "sum(increase(kube_pod_container_status_restarts_total{namespace=\"notes\"}[1h]))" }] }); return JSON.stringify(d, null, 2) + "\n"; })();
  var DASH_BADLABEL ={ apiVersion: "v1", kind: "ConfigMap", metadata: { name: "notes-red-dashboard", namespace: "monitoring", labels: { grafana_dashboard: "true" } }, data: { "notes-red.json": M.DASH_FIXED } };
  var ORD_ERR = function (cl2, p, path, t, kind) { return kind === "orders" && path === "/orders" ? { err: 0.2, code: "500", errMsg: "IntegrityError: duplicate key value violates unique constraint \"orders_pkey\"" } : null; };
  var OTEL_ENV = { OTEL_EXPORTER_OTLP_ENDPOINT: M.OTEL, OTEL_SERVICE_NAME: "orders-api", LOG_FORMAT: "json" };
  var AM_TEAM = Mb.AM_GOOD;
  var LAT_RULE = sc("apiVersion: monitoring.coreos.com/v1", "kind: PrometheusRule", "metadata:", "  name: notes-latency", "  namespace: notes", "  labels:", "    release: monitoring", "spec:", "  groups:", "    - name: notes-latency", "      rules:", "        - alert: NotesExportSlow", "          expr: histogram_quantile(0.95, sum by (le) (rate(http_request_duration_seconds_bucket{job=\"notes\", path=\"/export\"}[5m]))) > 0.5", "          for: 10m", "          labels:", "            severity: warning", "          annotations:", "            summary: 'notes /export p95 is {{ $value | humanizeDuration }}'");
  var AM_PAY = AM_TEAM.replace("    - receiver: slack-shop\n", "    - receiver: slack-payments\n      matchers:\n        - namespace = payments\n    - receiver: slack-shop\n").replace("receivers:\n", "receivers:\n  - name: slack-payments\n    slack_configs:\n      - channel: \"#payments-alerts\"\n        api_url_file: /etc/alertmanager/secrets/slack-url\n        send_resolved: true\n");
  var FALCO_QUIET = sc("- rule: Terminal shell in container", "  enabled: false");
  var FALCO_PKG = sc("- list: package_managers", "  items: [apt, apt-get, apk, dnf, yum, pip, pip3, npm]", "", "- rule: Package management process launched in container", "  desc: Installing packages at runtime means the image is being changed by hand (or by an attacker)", "  condition: spawned_process and container and proc.name in (package_managers)", "  output: Package manager run in a container (command=%proc.cmdline k8s_ns=%k8s.ns.name k8s_pod_name=%k8s.pod.name image=%container.image.repository)", "  priority: ERROR", "  tags: [process, mitre_persistence]");
  function seedIncident(sys, c) {
    var x = { id: "INC-2038", title: "Notes exports failing", sev: 3, state: "resolved", t: -5400, resolvedAt: -3000, commander: "maya", updates: [{ t: -5100, text: "Exports are failing for some users. Investigating.", pub: true, state: "investigating" }, { t: -3100, text: "Exports work again.", pub: true, state: "resolved" }],
      log: [{ t: -5400, text: "Incident declared (SEV3): Notes exports failing" }, { t: -5340, text: "Page P7Q2LM acknowledged by maya" }, { t: -4980, text: "Logs: TimeoutError uploading to s3://kestrel-notes-exports" }, { t: -4500, text: "S3 VPC endpoint route missing after a Terraform change; route restored" }, { t: -3600, text: "Export error rate back to normal" }, { t: -3000, text: "Incident resolved" }] };
    (c.obs.incidents = c.obs.incidents || []).push(x);
  }
  function deleteAudit(sys, c) { c.audit.push({ t: -1820, cmd: "", user: "ben", verb: "delete", kind: "Deployment", ns: "shop", name: "reports" }); c.audit.push({ t: -1815, cmd: "", user: "ben", verb: "delete", kind: "Service", ns: "shop", name: "reports" }); }
  function broadSilence(sys, c) { c.obs.am.silences.push({ id: "5c1f0e2a-9b7d-4c1e-8a3f-2d6b9e0c4f11", matchers: [{ l: "alertname", op: "=~", v: ".+" }], start: -3600 * 20, end: 3600 * 24 * 6, author: "ben", comment: "too noisy, will fix later", created: -3600 * 20 }, { id: "8e2d4b6a-1c3f-4e5a-9b7c-0d2f4a6c8e1b", matchers: [{ l: "alertname", op: "=", v: "KubePodCrashLooping" }, { l: "namespace", op: "=", v: "media" }], start: -600, end: 3000, author: "maya", comment: "INC-2040: thumbnails queue migration", created: -600 }); }
  var CAP_FIXED = O.world({ comps: { argocd: true }, namespaces: { shop: {} }, ctxNs: "shop", am: AM_TEAM, traffic: ["shop"], effects: [O.leakErrors], objects: [nsDoc(M4.DB_SECRET.replace("Gr8-kestrel-orders", "Kestrel-shop-db-2026"), "shop"), M4.CAP_APP, Mb.CAP_RULES],
    repo: { name: "kestrel/k8s-config", files: Mb.capFiles("3.1.0"), dir: "k8s-config" }, files: { ".config/argocd/config": M4.ARGO_CFG }, settle: 90, after: function (sys, c) { c.argoRepos = ["https://github.com/kestrel/k8s-config.git"]; } });
  var CANARY_W = M.world502();

  var DRILLS = {
    /* ---------------------------------------------------------------- DEV-501 */
    "dev-501": [
      { id: "d1", title: "The busiest pod", text: "<p>Which single notes pod serves the most requests per second right now? Answer with one PromQL query that returns just that pod (<code>topk</code>).</p>",
        system: shopNotes(), starter: "",
        solution: sol("promtool query instant $PROM 'topk(1, sum by (pod) (rate(http_requests_total{job=\"notes\"}[5m])))'"),
        check: function (r) { return prom(r, /topk\(\s*1\s*,[\s\S]*by\s*\(\s*pod\s*\)[\s\S]*http_requests_total/, /pod="notes-/) ? true : "topk(1, sum by (pod) (rate(http_requests_total{job=\"notes\"}[5m])))"; } },
      { id: "d2", title: "5xx by status code", text: "<p>How many requests per second does orders-api answer with each 5xx status code? One series per <code>code</code>.</p>",
        system: shopNotes(), starter: "",
        solution: sol("promtool query instant $PROM 'sum by (code) (rate(http_requests_total{job=\"orders-api\", code=~\"5..\"}[5m]))'"),
        check: function (r) { return prom(r, /by\s*\(\s*code\s*\)[\s\S]*job="orders-api"[\s\S]*5\.\.|job="orders-api"[\s\S]*5\.\.[\s\S]*by\s*\(\s*code\s*\)/, /code="5\d\d"/) ? true : "sum by (code) (rate(http_requests_total{job=\"orders-api\", code=~\"5..\"}[5m]))"; } },
      { id: "d3", title: "The target that isn't", text: "<p>The notes ServiceMonitor in <code>notes</code> exists and has the right label, yet <code>up{job=\"notes\"}</code> returns nothing. Fix it.</p>",
        system: shopNotes({ notes: {}, extra: [], world: { objects: M.shop().concat([nsDoc(M.notesApp(), "notes"), M.SM_ORDERS, SM_TYPO]) } }), starter: "",
        solution: sol("kubectl -n notes get servicemonitor notes -o yaml | grep -A3 selector", "kubectl -n notes get svc notes --show-labels", "kubectl -n notes patch servicemonitor notes --type=merge -p '{\"spec\":{\"selector\":{\"matchLabels\":{\"app\":\"notes\"}}}}'", "sleep 60", "promtool query instant $PROM 'up{job=\"notes\"}'"),
        check: function (r) { if (!OH.targets(r).some(function (x) { return x.job === "notes"; })) return "The ServiceMonitor's selector doesn't match the notes Service's labels."; return prom(r, /up\{[^}]*job="notes"/, /=> 1/) ? true : "Wait a scrape (sleep 60) and query up{job=\"notes\"}."; } }
    ],
    /* ---------------------------------------------------------------- DEV-502 */
    "dev-502": [
      { id: "d1", title: "Deployments short of replicas", text: "<p>Which Deployments have fewer available replicas than they want? Use kube-state-metrics.</p>",
        system: CANARY_W, starter: "",
        solution: sol("promtool query instant $PROM 'kube_deployment_status_replicas_unavailable > 0'"),
        check: function (r) { return prom(r, /kube_deployment_(status_replicas_unavailable|spec_replicas|status_replicas_available)/, /deployment="thumbnails"/) ? true : "kube_deployment_status_replicas_unavailable > 0"; } },
      { id: "d2", title: "CPU by namespace", text: "<p>How many CPU cores does each namespace use (averaged over 5 minutes), according to cAdvisor?</p>",
        system: shopNotes(), starter: "",
        solution: sol("promtool query instant $PROM 'sum by (namespace) (rate(container_cpu_usage_seconds_total[5m]))'"),
        check: function (r) { return prom(r, /by\s*\(\s*namespace\s*\)[\s\S]*rate\(\s*container_cpu_usage_seconds_total/, /namespace="shop"/) ? true : "sum by (namespace) (rate(container_cpu_usage_seconds_total[5m]))"; } },
      { id: "d3", title: "Memory left on each node", text: "<p>What fraction of memory is still available on each node? (node-exporter)</p>",
        system: shopNotes(), starter: "",
        solution: sol("promtool query instant $PROM 'node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes'"),
        check: function (r) { return prom(r, /node_memory_MemAvailable_bytes\s*\/\s*node_memory_MemTotal_bytes/, /node="kc-node-1"/) ? true : "node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes"; } }
    ],
    /* ---------------------------------------------------------------- DEV-503 */
    "dev-503": [
      { id: "d1", title: "What's on that dashboard?", text: "<p>Through Grafana's API, print the title of every panel on the <b>Shop overview</b> dashboard.</p>",
        system: shopNotes({ extra: [M.SHOP_DASH] }), starter: "",
        solution: sol(M.GRAF + "/api/dashboards/uid/shop-overview | jq -r '.dashboard.panels[].title'"),
        check: function (r) { return ran(r, /\bcurl\b.*\/api\/dashboards\/uid\/shop-overview/, function (e) { return /Orders per second/.test(out(e)) && /Shop 5xx/.test(out(e)) && !/"panels"/.test(out(e)); }) ? true : "Fetch /api/dashboards/uid/shop-overview and print only the panel titles (jq -r '.dashboard.panels[].title')."; } },
      { id: "d2", title: "Provisioned but invisible", text: "<p>The ConfigMap <code>monitoring/notes-red-dashboard</code> has the Notes RED dashboard, but Grafana doesn't show it. Make Grafana load it.</p>",
        system: shopNotes({ extra: [DASH_BADLABEL] }), starter: "",
        solution: sol("kubectl -n monitoring get configmap notes-red-dashboard --show-labels", "kubectl -n monitoring get configmap shop-overview-dashboard --show-labels", "kubectl -n monitoring label configmap notes-red-dashboard grafana_dashboard=1 --overwrite", M.GRAF + "/api/search | jq -r '.[].title'"),
        check: function (r) { return OH.dash(r, "Notes RED").length ? true : "Grafana's sidecar loads ConfigMaps labelled grafana_dashboard: \"1\"."; } },
      { id: "d3", title: "A stat panel", text: "<p>Add a <code>stat</code> panel titled <b>Restarts (1h)</b> to <code>~/notes-red.json</code> showing the total container restarts in namespace <code>notes</code> over the last hour. The file must stay valid JSON.</p>",
        system: shopNotes({ world: { files: { "notes-red.json": M.DASH_FIXED } } }), starter: "",
        solution: sol("jq -r '.panels[] | .type + \" \" + .title' notes-red.json", { nano: "notes-red.json", text: DASH_STAT }, "jq -r '.panels[] | .type + \" \" + .title' notes-red.json"),
        check: function (r) { var t = file(r, "~/notes-red.json"), d; try { d = JSON.parse(t || ""); } catch (e) { return "notes-red.json must be valid JSON."; } var p = (d.panels || []).filter(function (x) { return x.type === "stat" && x.title === "Restarts (1h)"; })[0]; if (!p) return "Add a panel with type stat and title Restarts (1h)."; var e = ((p.targets || [])[0] || {}).expr || ""; if (!/kube_pod_container_status_restarts_total/.test(e) || !/increase\(|delta\(/.test(e) || !/namespace="notes"/.test(e)) return "The expression: sum(increase(kube_pod_container_status_restarts_total{namespace=\"notes\"}[1h]))"; var x = O.query(cl(r), e, K.t(cl(r))); return x.error ? "The expression fails: " + x.error : true; } }
    ],
    /* ---------------------------------------------------------------- DEV-504 */
    "dev-504": [
      { id: "d1", title: "Just the errors, readable", text: "<p>orders-api logs JSON. Show only its <code>error</code>-level lines, formatted as <code>PATH ERROR</code> with <code>line_format</code>.</p>",
        system: shopNotes({ shop: { api: { env: { LOG_FORMAT: "json" } } }, world: { effects: [ORD_ERR] } }), starter: "",
        solution: sol("logcli query --since 10m --limit 5 '{namespace=\"shop\", app=\"orders-api\"} | json | level=\"error\" | line_format \"{{.path}} {{.error}}\"'"),
        check: function (r) { return logq(r, /\|\s*json[\s\S]*level\s*=\s*"error"[\s\S]*line_format/, /\/orders IntegrityError/) ? true : "{namespace=\"shop\", app=\"orders-api\"} | json | level=\"error\" | line_format \"{{.path}} {{.error}}\""; } },
      { id: "d2", title: "Chattiest pods", text: "<p>Which three pods in <code>shop</code> write the most log lines per second? One LogQL metric query.</p>",
        system: shopNotes(), starter: "",
        solution: sol("logcli query 'topk(3, sum by (pod) (rate({namespace=\"shop\"}[5m])))'"),
        check: function (r) { return logq(r, /topk\(\s*3[\s\S]*by\s*\(\s*pod\s*\)[\s\S]*rate\(\s*\{[^}]*namespace="shop"/, /pod="/) ? true : "topk(3, sum by (pod) (rate({namespace=\"shop\"}[5m])))"; } },
      { id: "d3", title: "Why does it crash?", text: "<p>Something in the cluster is crash looping. Find its error message in Loki (not with kubectl).</p>",
        system: CANARY_W, starter: "",
        solution: sol("logcli query --since 1h 'sum by (namespace, app) (count_over_time({stream=\"stderr\", namespace=~\".+\"}[1h]))'", "logcli query --since 1h --limit 3 '{namespace=\"media\"}'"),
        check: function (r) { return logq(r, /namespace=~?"(media|\.\+)"/, /cannot open \/data\/queue/) ? true : "Find the crashing app (media namespace) and read its logs in Loki: logcli query '{namespace=\"media\"}'"; } }
    ],
    /* ---------------------------------------------------------------- DEV-505 */
    "dev-505": [
      { id: "d1", title: "Only the failures", text: "<p>orders-api sends traces to Tempo. Find traces with an error status using TraceQL.</p>",
        system: shopNotes({ shop: { api: { env: OTEL_ENV } }, world: { effects: [ORD_ERR] } }), starter: "",
        solution: sol("curl -s -G $TEMPO/api/search --data-urlencode 'q={ status = error }' | jq -r '.traces[].rootTraceName' | head -3"),
        check: function (r) { var q = (cl(r).traceQueries || []); return q.some(function (x) { return /status\s*=\s*error/.test(x.q) && x.n > 0; }) ? true : "Search with { status = error }."; } },
      { id: "d2", title: "Slow exports", text: "<p>notes now sends traces too (service <code>notes</code>). Find a trace of <code>/export</code> slower than 500ms and name the span that takes most of it.</p>",
        system: shopNotes({ notes: { env: { OTEL_EXPORTER_OTLP_ENDPOINT: M.OTEL, OTEL_SERVICE_NAME: "notes" } } }), starter: "",
        solution: sol("curl -s -G $TEMPO/api/search --data-urlencode 'q={ resource.service.name = \"notes\" && name = \"POST /export\" && duration > 500ms }' | jq -r '.traces[0].traceID'", "curl -s $TEMPO/api/traces/$(curl -s -G $TEMPO/api/search --data-urlencode 'q={ resource.service.name = \"notes\" && name = \"POST /export\" && duration > 500ms }' | jq -r '.traces[0].traceID') | jq -c '.batches[].scopeSpans[].spans[] | {name, durationMs}'"),
        check: function (r) { return ran(r, /\bcurl\b.*\/api\/traces\//, function (e) { return /s3\.PutObject/.test(out(e)); }) ? true : "Search for slow /export traces, then fetch one by ID and read its spans."; } },
      { id: "d3", title: "From a log line to its trace", text: "<p>orders-api logs JSON with a <code>trace_id</code>. Take the trace ID from one of its error lines in Loki and open that trace in Tempo.</p>",
        system: shopNotes({ shop: { api: { env: OTEL_ENV } }, world: { effects: [ORD_ERR] } }), starter: "",
        solution: sol("logcli query --since 5m --limit 1 -o raw '{namespace=\"shop\", app=\"orders-api\"} | json | level=\"error\"'", "curl -s $TEMPO/api/traces/$(logcli query --since 5m --limit 1 -o raw '{namespace=\"shop\", app=\"orders-api\"} | json | level=\"error\"' | jq -r .trace_id) | jq -c '.batches[].scopeSpans[].spans[] | {name, durationMs, status}'"),
        check: function (r) { var ob = OH.ob(r); var ids = {}; ob.logs.forEach(function (e) { var m = /"trace_id":"([0-9a-f]{32})"/.exec(e.line); if (m && /"level":"error"/.test(e.line)) ids[m[1]] = 1; }); return ob.lastTrace && ids[ob.lastTrace] && ran(r, /\bcurl\b.*\/api\/traces\//, function (e) { return /STATUS_CODE_ERROR/.test(out(e)); }) ? true : "Fetch from Tempo the trace whose ID is in an orders-api error log line."; } }
    ],
    /* ---------------------------------------------------------------- DEV-506 */
    "dev-506": [
      { id: "d1", title: "A maintenance silence", text: "<p>The notes team is migrating its database for the next 2 hours. Silence every alert from namespace <code>notes</code> for exactly that long, with a comment saying why.</p>",
        system: shopNotes({ world: { am: AM_TEAM } }), starter: "",
        solution: sol("amtool silence add namespace=notes --duration=2h --comment=\"notes database migration (planned maintenance)\"", "amtool silence query"),
        check: function (r) { var s = OH.silences(r).filter(function (x) { return x.end > K.t(cl(r)) && x.matchers.some(function (m) { return m.l === "namespace" && m.op === "=" && m.v === "notes"; }); })[0]; if (!s) return "Add a silence with namespace=notes."; if (Math.abs(s.end - s.start - 7200) > 60) return "Make it 2 hours (--duration=2h)."; return s.comment && s.comment.length > 8 ? true : "Say why in --comment."; } },
      { id: "d2", title: "Route a new team", text: "<p>Warnings from namespace <code>payments</code> should go to a new Slack receiver <code>slack-payments</code> (channel <code>#payments-alerts</code>); critical ones still page. Change <code>~/alertmanager.yaml</code>, check it and load it.</p>",
        system: shopNotes({ world: { am: AM_TEAM, files: { "alertmanager.yaml": AM_TEAM } } }), starter: "",
        solution: sol({ nano: "alertmanager.yaml", text: AM_PAY }, "amtool check-config alertmanager.yaml", "amtool config routes test --config.file=alertmanager.yaml namespace=payments severity=warning", Mb.AM_APPLY),
        check: function (r) { var c = OH.am(r); if (c.error) return "Alertmanager's config doesn't load: " + c.error; var w = O.routeFor(c.cfg, { namespace: "payments", severity: "warning" }).map(function (x) { return x.receiver; }), k = O.routeFor(c.cfg, { namespace: "payments", severity: "critical" }).map(function (x) { return x.receiver; }); if (w.indexOf("slack-payments") < 0) return "Warnings in payments should reach slack-payments."; if (k.indexOf("pagerduty-sre") < 0) return "Critical alerts in payments must still page (put the critical route first)."; var rc = (c.cfg.receivers || []).filter(function (x) { return x.name === "slack-payments"; })[0]; return rc && /payments-alerts/.test(JSON.stringify(rc)) ? true : "Define the receiver slack-payments with channel #payments-alerts."; } },
      { id: "d3", title: "Alert on latency", text: "<p>Alert <code>NotesExportSlow</code> (warning) when the p95 latency of notes <code>/export</code> stays above 500 ms for 10 minutes.</p>",
        system: shopNotes(), starter: "",
        solution: sol({ nano: "notes-latency.yaml", text: LAT_RULE }, "kubectl apply -f notes-latency.yaml", "sleep 30", "promtool query instant $PROM 'ALERTS{alertname=\"NotesExportSlow\"}'"),
        check: function (r) { var x = OH.rule(r, "NotesExportSlow"); if (!x) return "No alert NotesExportSlow in Prometheus (a PrometheusRule labelled release: monitoring)."; if (!/histogram_quantile\(\s*0?\.95/.test(x.expr) || !/path="\/export"/.test(x.expr) || !/0?\.5\b|500/.test(x.expr)) return "p95 of http_request_duration_seconds_bucket for path /export above 0.5 (seconds)."; if (x.forS !== 600) return "for: 10m"; return x.labels.severity === "warning" ? true : "severity: warning"; } }
    ],
    /* ---------------------------------------------------------------- DEV-507 */
    "dev-507": [
      { id: "d1", title: "Someone's waiting", text: "<p>A page has been firing for a while. Acknowledge it, and say in the incident log that you're looking (declare a SEV3 first).</p>",
        system: world({ namespaces: { shop: {}, payments: {} }, objects: M.shop().concat([M.SM_ORDERS, Mb.PAY_CM.replace("metadata:\n", "metadata:\n  namespace: payments\n"), Mb.PAY_SECRET, nsDoc(Mb.PAY, "payments"), O.serviceMonitor("payments", "payments", "payments"), Mb.PAY_RULE]), traffic: ["shop", "payments"], effects: [Mb.PROVIDER_DOWN], am: AM_TEAM, before: function (sys, c) { Dk.state(c.rt).validKeys = [M4.PAY_KEY]; } }), starter: "",
        solution: sol("oncall pages", "oncall ack $(oncall pages | awk 'NR==2 {print $1}')", "oncall incident declare --sev 3 --title \"Payment errors\"", "oncall incident note \"kc-dev looking into PaymentsHighErrorRate\""),
        check: function (r) { if (!Mb.pages(r, "PaymentsHighErrorRate", function (n) { return n.acked; }).length) return "Acknowledge the page (oncall ack ID)."; var x = Mb.inc(r); return x && x.log.some(function (l) { return !/^(Incident declared|Page )/.test(l.text); }) ? true : "Declare an incident and add a note: oncall incident note \"...\""; } },
      { id: "d2", title: "Tell the customers", text: "<p>Declare a SEV3 incident \"Slow shop pages\", post a public update with status <code>investigating</code>, and check what <code>http://status.kestrel.dev</code> now says.</p>",
        system: shopNotes(), starter: "",
        solution: sol("oncall incident declare --sev 3 --title \"Slow shop pages\"", "oncall incident update --public --status investigating \"Shop pages are loading slowly. We're investigating.\"", "curl -s http://status.kestrel.dev"),
        check: function (r) { return ran(r, /\bcurl\b.*status\.kestrel\.dev/, function (e) { return /Partial outage/.test(out(e)) && /Slow shop pages/.test(out(e)); }) ? true : "Declare, post a public update, then curl http://status.kestrel.dev"; } },
      { id: "d3", title: "Timeline from the log", text: "<p>Last night's incident INC-2038 is resolved. Write <code>~/INC-2038-timeline.md</code>: its timeline with the times (UTC) from the incident log, one event per line.</p>",
        system: shopNotes({ world: { after: seedIncident } }), starter: "",
        solution: sol("oncall incident list", "oncall incident timeline", { nano: "INC-2038-timeline.md", text: "# INC-2038 timeline (UTC)\n\n- 07:30 incident declared (SEV3): notes exports failing\n- 07:31 page acknowledged by maya\n- 07:37 logs show TimeoutError uploading to S3\n- 07:45 missing S3 VPC endpoint route found and restored\n- 08:00 export error rate back to normal\n- 08:10 incident resolved\n" }),
        check: function (r) { var t = file(r, "~/INC-2038-timeline.md"); if (!t) return "Write ~/INC-2038-timeline.md."; var need = ["07:30", "07:31", "07:37", "07:45", "08:00", "08:10"].filter(function (h) { return t.indexOf(h) >= 0; }); return need.length >= 5 ? true : "Use the times from oncall incident timeline (at least five events)."; } }
    ],
    /* ---------------------------------------------------------------- DEV-508 */
    "dev-508": [
      { id: "d1", title: "Too noisy", text: "<p>Developers exec into staging pods all day, and the <b>Terminal shell in container</b> rule floods the channel. Disable that one rule (without editing Falco's defaults) through <code>falco-rules-custom</code>.</p>",
        system: world({ falco: true, objects: M.shop().concat([M.SM_ORDERS]), traffic: ["shop"] }), starter: "",
        solution: sol({ nano: "quiet.yaml", text: FALCO_QUIET }, "kubectl -n falco create configmap falco-rules-custom --from-file=quiet.yaml", "kubectl -n shop exec deploy/web -- sh -c 'id'"),
        check: function (r) { var R = O.falcoRules(cl(r)); return R.rules.some(function (x) { return x.rule === "Terminal shell in container"; }) ? "The rule is still enabled: a custom rule with the same name and enabled: false." : (R.rules.some(function (x) { return x.rule === "Read sensitive file untrusted"; }) ? true : "Only disable the shell rule; keep the others."); } },
      { id: "d2", title: "Who deleted reports?", text: "<p>The <code>reports</code> Deployment in <code>shop</code> vanished half an hour ago. Find who deleted it, from the audit log in Loki.</p>",
        system: world({ objects: M.shop().concat([M.SM_ORDERS]), traffic: ["shop"], after: deleteAudit }), starter: "",
        solution: sol("logcli query --since 1h '{job=\"kube-apiserver-audit\"} |= \"delete\" | json | objectRef_name=\"reports\" | line_format \"{{.requestReceivedTimestamp}} {{.user_username}} {{.verb}} {{.objectRef_resource}}/{{.objectRef_name}}\"'"),
        check: function (r) { return logq(r, /kube-apiserver-audit/, /\bben\b[\s\S]*reports|reports[\s\S]*\bben\b/) ? true : "Search the audit log for the delete of reports: {job=\"kube-apiserver-audit\"} |= \"delete\""; } },
      { id: "d3", title: "Package managers at runtime", text: "<p>Nobody should install packages inside running containers. Add a Falco rule (priority <code>ERROR</code>) for package managers (apt, apt-get, apk, pip, npm…) run in a container, and trigger it once in a web pod.</p>",
        system: world({ falco: true, objects: M.shop().concat([M.SM_ORDERS]), traffic: ["shop"] }), starter: "",
        solution: sol({ nano: "pkg.yaml", text: FALCO_PKG }, "kubectl -n falco create configmap falco-rules-custom --from-file=pkg.yaml", "kubectl -n shop exec deploy/web -- apk add curl", "kubectl logs -n falco -l app.kubernetes.io/name=falco --tail=2 | jq -r .output"),
        check: function (r) { var R = O.falcoRules(cl(r)), x = R.rules.filter(function (y) { return !/^(Terminal shell in container|Read sensitive file untrusted)$/.test(y.rule); })[0]; if (!x) return "Add the rule in the ConfigMap falco-rules-custom."; if (String(x.priority).toUpperCase() !== "ERROR") return "priority: ERROR"; return OH.falco(r, function (f) { return f.rule === x.rule; }).length ? true : "Trigger it: kubectl -n shop exec deploy/web -- apk add curl"; } }
    ],
    /* ---------------------------------------------------------------- DEV-509 */
    "dev-509": [
      { id: "d1", title: "Silence hygiene", text: "<p>Someone silenced <i>everything</i> for a week. Find that silence and expire it; leave the specific, documented one alone.</p>",
        system: shopNotes({ world: { am: AM_TEAM, after: broadSilence } }), starter: "",
        solution: sol("amtool silence query", "amtool silence expire 5c1f0e2a-9b7d-4c1e-8a3f-2d6b9e0c4f11", "amtool silence query"),
        check: function (r) { var now = K.t(cl(r)), act = OH.silences(r).filter(function (s) { return s.end > now; }); if (act.some(function (s) { return s.matchers.some(function (m) { return m.op === "=~" && m.v === ".+"; }); })) return "The match-everything silence (alertname=~\".+\") is still active: amtool silence expire ID"; return act.some(function (s) { return /INC-2040/.test(s.comment || ""); }) ? true : "Keep the specific INC-2040 silence."; } },
      { id: "d2", title: "Prove the fix", text: "<p>orders-api was rolled back to 3.1.0. Show with one query that no orders-api container in <code>shop</code> has restarted in the last 10 minutes (the query returns nothing).</p>",
        system: CAP_FIXED, starter: "",
        solution: sol("sleep 120", "promtool query instant $PROM 'increase(kube_pod_container_status_restarts_total{namespace=\"shop\", container=\"api\"}[10m]) > 0'"),
        check: function (r) { return ran(r, /^\s*promtool\s+query\s+instant\b.*increase\(\s*kube_pod_container_status_restarts_total\{[^}]*namespace="shop"[\s\S]*\[10m\]\)\s*>\s*0/, function (e) { return !/=>/.test(out(e)); }) ? true : "increase(kube_pod_container_status_restarts_total{namespace=\"shop\", container=\"api\"}[10m]) > 0 should return nothing."; } },
      { id: "d3", title: "How long until OOM?", text: "<p>The orders-api canary in <code>shop-canary</code> leaks memory. Estimate, in seconds, how long until it reaches its limit: (limit − usage) divided by how fast usage grows (<code>deriv</code> over 2 minutes).</p>",
        system: CANARY_W, starter: "",
        solution: sol("promtool query instant $PROM '(sum by (pod) (kube_pod_container_resource_limits{namespace=\"shop-canary\", resource=\"memory\"}) - sum by (pod) (container_memory_working_set_bytes{namespace=\"shop-canary\"})) / sum by (pod) (deriv(container_memory_working_set_bytes{namespace=\"shop-canary\"}[2m]))'"),
        check: function (r) { return prom(r, /kube_pod_container_resource_limits[\s\S]*container_memory_working_set_bytes[\s\S]*deriv\(\s*container_memory_working_set_bytes/, /pod="orders-api-[^"]*"\} => \d/) ? true : "(limit - usage) / deriv(usage[2m]) for the shop-canary pod, matched by pod."; } }
    ]
  };

  T.LABS.forEach(function (l) { if (DRILLS[l.id]) l.drills = DRILLS[l.id]; });
})();
