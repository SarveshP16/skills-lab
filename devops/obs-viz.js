/* sudo learn — DevOps Module 5 panel views (used by dk-viz.js): Metrics (per-service rate, errors and p95 with
   sparklines over the last 30 minutes, pod memory against limits, scrape targets), Logs (the newest lines from the
   apps, errors highlighted), Traces (recent traces as waterfalls) and Alerts (firing/pending alerts, silences,
   pages and Slack messages, incidents). */
(function (root) {
  "use strict";
  var K = root.K8s, O = root.Obs;
  function keys(o) { return o ? Object.keys(o) : []; }
  function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
  function chip(cls, t, title) { return '<span class="chip ' + cls + '"' + (title ? ' title="' + esc(title) + '"' : "") + ">" + t + "</span>"; }
  function cl(sys) { var c = K && K.of ? K.of(sys) : null; return c && c.obs ? c : null; }
  var SPAN = 1800, STEP = 60;
  function range(c, q) { var now = K.t(c), r = O.queryRange(c, q, now - SPAN, now, STEP); return r.error ? [] : r.data; }
  function spark(pts, cls, fmt) {
    var w = 120, h = 26, vals = pts.map(function (p) { return isFinite(p[1]) ? p[1] : 0; });
    if (!vals.length) return '<span class="ob-nodata">no data</span>';
    var max = Math.max.apply(null, vals) || 1, min = 0, n = vals.length;
    var d = vals.map(function (v, i) { return (i ? "L" : "M") + (n > 1 ? (i / (n - 1) * w).toFixed(1) : 0) + " " + (h - 2 - (v - min) / (max - min || 1) * (h - 4)).toFixed(1); }).join(" ");
    return '<svg class="ob-spark ' + cls + '" viewBox="0 0 ' + w + " " + h + '" preserveAspectRatio="none" aria-hidden="true"><path d="' + d + '"/></svg><span class="ob-val">' + fmt(vals[vals.length - 1]) + "</span>";
  }
  function pct(v) { return (v * 100 < 0.1 && v > 0 ? "<0.1" : (Math.round(v * 1000) / 10)) + "%"; }
  function rps(v) { return (v >= 10 ? Math.round(v) : Math.round(v * 10) / 10) + "/s"; }
  function ms(v) { return v >= 1 ? (Math.round(v * 10) / 10) + "s" : Math.round(v * 1000) + "ms"; }
  function mib(v) { return Math.round(v / 1048576) + "Mi"; }
  function pick(list, l, k) { return (list.filter(function (s) { return s.l[k] === l; })[0] || { p: [] }).p; }

  /* ---------------- Metrics */
  function metrics(sys) {
    var c = cl(sys); if (!c) return '<div class="dv-empty">No monitoring stack.</div>';
    var h = "";
    var reqs = range(c, "sum by (host) (rate(nginx_ingress_controller_requests[5m]))"), errs = range(c, 'sum by (host) (rate(nginx_ingress_controller_requests{status=~"5.."}[5m])) / sum by (host) (rate(nginx_ingress_controller_requests[5m]))'), p95 = range(c, "histogram_quantile(0.95, sum by (host, le) (rate(nginx_ingress_controller_request_duration_seconds_bucket[5m])))");
    if (reqs.length) {
      h += '<div class="k8-nsh"><b>Traffic through the Ingress</b><span class="dim">last 30 min</span></div><div class="ob-grid">';
      reqs.forEach(function (s) {
        var host = s.l.host, e = pick(errs, host, "host"), lat = pick(p95, host, "host"), last = e.length ? e[e.length - 1][1] : 0;
        h += '<div class="ob-card' + (last > 0.02 ? " bad" : "") + '"><div class="ob-ch">' + esc(host) + '</div><div class="ob-row"><span class="ob-k">req</span>' + spark(s.p, "rate", rps) + '</div><div class="ob-row"><span class="ob-k">5xx</span>' + spark(e, "err", pct) + '</div><div class="ob-row"><span class="ob-k">p95</span>' + spark(lat, "lat", ms) + "</div></div>";
      });
      h += "</div>";
    }
    // pod memory against limits, for app namespaces
    var mem = range(c, 'sum by (namespace, pod) (container_memory_working_set_bytes{namespace!~"kube-system|monitoring|ingress-nginx|falco|argocd"})'), lim = O.query(c, 'sum by (namespace, pod) (kube_pod_container_resource_limits{resource="memory"})', K.t(c));
    var limits = {}; ((lim && lim.data) || []).forEach(function (s) { limits[s.l.namespace + "/" + s.l.pod] = s.v; });
    if (mem.length) {
      mem.sort(function (a, b) { var la = limits[a.l.namespace + "/" + a.l.pod], lb = limits[b.l.namespace + "/" + b.l.pod]; var fa = la ? a.p[a.p.length - 1][1] / la : 0, fb = lb ? b.p[b.p.length - 1][1] / lb : 0; return fb - fa; });
      h += '<div class="k8-nsh"><b>Pod memory</b><span class="dim">working set (vs limit)</span></div><div class="ob-grid">';
      mem.slice(0, 8).forEach(function (s) { var l = limits[s.l.namespace + "/" + s.l.pod], last = s.p.length ? s.p[s.p.length - 1][1] : 0, f = l ? last / l : 0; h += '<div class="ob-card' + (f > 0.85 ? " bad" : f > 0.7 ? " warn" : "") + '"><div class="ob-ch" title="' + esc(s.l.namespace + "/" + s.l.pod) + '">' + esc(s.l.pod.replace(/-[a-z0-9]{8,10}-([a-z0-9]{5})$/, "-…$1")) + ' <span class="dim">' + esc(s.l.namespace) + '</span></div><div class="ob-row">' + spark(s.p, f > 0.85 ? "err" : "mem", function (v) { return mib(v) + (l ? " / " + mib(l) : ""); }) + "</div></div>"; });
      h += "</div>";
    }
    var tg = O.targets(c);
    h += '<div class="k8-nsh"><b>Scrape targets</b><span class="dim">ServiceMonitors with release: monitoring</span></div><div class="ob-tg">' + (tg.length ? tg.map(function (x) { var up = O.query(c, 'up{job="' + x.job + '", pod="' + x.pod.metadata.name + '"}', K.t(c)), ok = up.data && up.data[0] && up.data[0].v === 1; return chip(ok ? "user" : "sec", esc(x.job) + " <small>" + esc(x.pod.metadata.name.replace(/-[a-z0-9]{8,10}-([a-z0-9]{5})$/, "-…$1")) + "</small> " + (ok ? "up" : "down")); }).join(" ") : '<span class="dim">none of the apps are scraped yet (kube-state-metrics, node-exporter, kubelet and ingress-nginx are)</span>') + "</div>";
    return h;
  }

  /* ---------------- Logs */
  function logs(sys) {
    var c = cl(sys); if (!c) return '<div class="dv-empty">No logs.</div>';
    var list = c.obs.logs.filter(function (e) { return e.l.namespace !== "kube-system" && e.l.job !== "kube-apiserver-audit"; }).slice(-60).reverse();
    if (!list.length) return '<div class="dv-empty">No log lines yet.</div>';
    return '<div class="k8-nsh"><b>Newest log lines</b><span class="dim">as Loki stores them: labels, then the line</span></div><div class="ob-logs">' + list.map(function (e) {
      var bad = e.l.stream === "stderr" || /"level":\s*"error"|\[ERROR\]|" 5\d\d /.test(e.line), warn = /"level":\s*"warning"|WARNING|Warning/.test(e.line);
      return '<div class="ob-ll' + (bad ? " bad" : warn ? " warn" : "") + '"><span class="ob-lt">' + esc(O.fmtT(c, e.t).slice(11, 19)) + '</span><span class="ob-lb">' + esc((e.l.namespace || "") + "/" + (e.l.app || e.l.pod || "")) + '</span><span class="ob-lx">' + esc(e.line.length > 260 ? e.line.slice(0, 260) + "…" : e.line) + "</span></div>";
    }).join("") + "</div>";
  }

  /* ---------------- Traces */
  function traces(sys) {
    var c = cl(sys); if (!c) return '<div class="dv-empty">No traces.</div>';
    var tr = c.obs.traces.slice(-10).reverse();
    if (!tr.length) return '<div class="dv-empty">No traces yet. Services send spans to Tempo when they have OTEL_EXPORTER_OTLP_ENDPOINT (and OTEL_SERVICE_NAME) set.</div>';
    var sel = c.obs.lastTrace ? c.obs.traces.filter(function (x) { return x.id === c.obs.lastTrace; })[0] : null;
    if (sel) tr = [sel].concat(tr.filter(function (x) { return x !== sel; }).slice(0, 7));
    return '<div class="k8-nsh"><b>Recent traces</b><span class="dim">each bar is a span; the slowest part of a request stands out</span></div>' + tr.map(function (x, i) {
      var t0 = Math.min.apply(null, x.spans.map(function (s) { return s.start; })), t1 = Math.max.apply(null, x.spans.map(function (s) { return s.start + s.dur; })), tot = Math.max(1, t1 - t0);
      var depth = {}; x.spans.forEach(function (s) { depth[s.id] = s.parent && depth[s.parent] != null ? depth[s.parent] + 1 : 0; });
      return '<details class="ob-tr"' + (i === 0 ? " open" : "") + '><summary><span class="' + (x.spans.some(function (s) { return s.err; }) ? "bad" : "") + '">' + esc(x.root.svc) + ": " + esc(x.root.name) + '</span> <span class="dim">' + ms(tot / 1e6) + " · " + x.spans.length + " spans · " + esc(x.id.slice(0, 12)) + "…</span></summary>" + x.spans.map(function (s) {
        var l = (s.start - t0) / tot * 100, w = Math.max(0.6, s.dur / tot * 100);
        return '<div class="ob-sp"><span class="ob-sn" style="padding-left:' + (depth[s.id] * 10) + 'px" title="' + esc(s.svc + " · " + s.name) + '">' + esc(s.name) + '</span><span class="ob-sb"><span class="' + (s.err ? "bad" : s.name === "db.pool.acquire" ? "warn" : "") + '" style="left:' + l.toFixed(1) + "%;width:" + w.toFixed(1) + '%"></span></span><span class="ob-sd">' + ms(s.dur / 1e6) + "</span></div>";
      }).join("") + "</details>";
    }).join("");
  }

  /* ---------------- Alerts */
  function alerts(sys) {
    var c = cl(sys); if (!c) return '<div class="dv-empty">No Alertmanager.</div>';
    var ob = c.obs, now = K.t(c), h = "";
    var act = keys(ob.alerts).map(function (k) { return ob.alerts[k]; }).filter(function (a) { return (a.state === "firing" || a.state === "pending") && a.labels.alertname !== "Watchdog"; });
    h += '<div class="k8-nsh"><b>Alerts</b>' + (ob.am.cfgError ? chip("sec", "Alertmanager config: " + esc(ob.am.cfgError)) : "") + "</div>";
    h += act.length ? '<div class="ob-al">' + act.map(function (a) {
      var st = a.silencedBy ? "silenced" : a.inhibited ? "inhibited" : a.state;
      return '<div class="ob-a ' + (st === "firing" ? (a.labels.severity === "critical" ? "bad" : "warn") : "idle") + '"><b>' + esc(a.labels.alertname) + "</b> " + chip(st === "firing" ? "sec" : "tmp", st) + (a.labels.severity ? " " + chip("bind", esc(a.labels.severity)) : "") + (a.labels.namespace ? ' <span class="dim">' + esc(a.labels.namespace) + (a.labels.pod ? "/" + esc(a.labels.pod) : "") + "</span>" : "") + '<div class="dim">' + esc((a.annotations || {}).summary || (a.annotations || {}).description || "") + " · since " + esc(O.fmtT(c, a.firedAt != null ? a.firedAt : a.activeAt).slice(11, 16)) + "</div></div>";
    }).join("") + "</div>" : '<div class="dim ob-none">Nothing firing (Watchdog aside).</div>';
    var sil = ob.am.silences.filter(function (s) { return s.end > now; });
    if (sil.length) h += '<div class="k8-nsh"><b>Silences</b></div><div class="ob-tg">' + sil.map(function (s) { return chip("tmp", esc(s.matchers.map(function (m) { return m.l + m.op + m.v; }).join(",")) + " <small>until " + esc(O.fmtT(c, s.end).slice(11, 16)) + " · " + esc(s.author || "") + "</small>", s.comment); }).join(" ") + "</div>";
    var nt = ob.am.notifs.filter(function (n) { return n.type !== "none"; }).slice(-8).reverse();
    if (nt.length) h += '<div class="k8-nsh"><b>Notifications</b><span class="dim">pages and Slack messages</span></div><div class="ob-al">' + nt.map(function (n) { return '<div class="ob-n"><span class="ob-lt">' + esc(O.fmtT(c, n.t).slice(11, 16)) + "</span> " + chip(n.type === "pagerduty" ? "sec" : "bind", n.type === "pagerduty" ? "page" : esc(n.channel || "slack")) + " " + chip(n.status === "firing" ? "sec" : "user", n.status) + " " + esc(n.alerts.map(function (a) { return a.labels.alertname; }).filter(function (x, i, arr) { return arr.indexOf(x) === i; }).join(", ")) + (n.acked ? ' <span class="dim">acked by ' + esc(n.acked) + "</span>" : "") + "</div>"; }).join("") + "</div>";
    var inc = (ob.incidents || []).slice(-2).reverse();
    if (inc.length) h += '<div class="k8-nsh"><b>Incidents</b></div>' + inc.map(function (x) { return '<div class="ob-inc"><b>' + esc(x.id) + "</b> " + chip(x.state === "resolved" ? "user" : "sec", "SEV" + x.sev + " · " + esc(x.state)) + " " + esc(x.title) + '<div class="dim">' + x.log.slice(-4).map(function (l) { return esc(O.fmtT(c, l.t).slice(11, 16) + " " + l.text); }).join("<br>") + "</div></div>"; }).join("");
    if (ob.falco.length) h += '<div class="k8-nsh"><b>Falco</b><span class="dim">runtime security events</span></div><div class="ob-al">' + ob.falco.slice(-5).reverse().map(function (f) { return '<div class="ob-n"><span class="ob-lt">' + esc(f.time.slice(11, 19)) + "</span> " + chip(/Critical|Error|Warning/.test(f.priority) ? "sec" : "tmp", esc(f.priority)) + " " + esc(f.rule) + ' <span class="dim">' + esc((f.output_fields["k8s.ns.name"] || "") + "/" + (f.output_fields["k8s.pod.name"] || "")) + "</span></div>"; }).join("") + "</div>";
    return h;
  }

  function caption(sys) {
    var c = cl(sys); if (!c) return "kestrel-staging";
    var ob = c.obs, fir = keys(ob.alerts).map(function (k) { return ob.alerts[k]; }).filter(function (a) { return a.state === "firing" && a.labels.alertname !== "Watchdog" && !a.silencedBy; });
    var pages = ob.am.notifs.filter(function (n) { return n.type === "pagerduty" && n.status === "firing" && !n.acked; }).length;
    return "kestrel-staging monitoring · " + O.fmtT(c, K.t(c)).slice(11, 16) + " UTC · " + (fir.length ? '<span class="bad">' + fir.length + " alert" + (fir.length > 1 ? "s" : "") + " firing</span>" : "no alerts firing") + (pages ? ' · <span class="bad">' + pages + " unacked page" + (pages > 1 ? "s" : "") + "</span>" : "");
  }
  function sig(sys) {
    var c = cl(sys); if (!c) return { m: "", l: "", t: "", a: "" };
    var ob = c.obs;
    return { m: O.targets(c).length + ":" + keys(ob.series).length, l: String(ob.logs.length ? ob.logs[ob.logs.length - 1].line : ""), t: String(ob.traces.length) + (ob.lastTrace || ""), a: keys(ob.alerts).map(function (k) { return k + ob.alerts[k].state; }).join(",") + ob.am.notifs.length + ob.am.silences.length + (ob.incidents || []).length };
  }
  root.ObsViz = { metrics: metrics, logs: logs, traces: traces, alerts: alerts, caption: caption, sig: sig };
})(typeof window !== "undefined" ? window : globalThis);
