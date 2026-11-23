/* sudo learn — DevOps Module 5: rules and alerts. PrometheusRule objects (label release: monitoring, checked by the
   operator's admission webhook) become recording and alerting rules evaluated every 30 s of cluster time; alerts go
   pending -> firing after `for`, with templated annotations and an ALERTS series. Alertmanager reads its config from
   the Secret monitoring/alertmanager-main, routes (matchers, continue), groups (group_wait/interval, repeat),
   inhibits and silences, and delivers to PagerDuty/Slack receivers (seen with the `oncall` tool). promtool and
   amtool, and Prometheus' HTTP API at prometheus.staging.kestrel.dev. */
(function (root) {
  "use strict";
  var S = root.ShEngine, M2 = S.M2, U = S.util, Dk = root.Dk, K = root.K8s, O = root.Obs, Y = root.DevYaml, KC = K.kubectl;
  var out = U.out, errl = U.errl;
  function keys(o) { return o ? Object.keys(o) : []; }
  var EVAL = 30;

  // CRDs of kube-prometheus-stack
  [["ServiceMonitor", "servicemonitors", ["smon"]], ["PodMonitor", "podmonitors", ["pmon"]], ["PrometheusRule", "prometheusrules", ["promrule"]]].forEach(function (x) { K.KINDS[x[0]] = { kind: x[0], plural: x[1], short: x[2], gv: "monitoring.coreos.com/v1", ns: true, group: "monitoring.coreos.com", crd: "prometheus" }; });
  K.printers = K.printers || {};

  /* ================================================================== rules */
  function parseGroups(doc, where) {
    var errs = [], groups = [];
    if (!doc || !Array.isArray(doc.groups)) { errs.push((where || "") + "groups: field groups not found"); return { errs: errs, groups: [] }; }
    doc.groups.forEach(function (g, gi) {
      if (!g || !g.name) { errs.push("group " + gi + ": groupname must not be empty"); return; }
      var rules = [];
      (g.rules || []).forEach(function (r, ri) {
        var at = "group \"" + g.name + "\", rule " + (ri + 1) + ", " + (r.alert ? "\"" + r.alert + "\"" : r.record ? "\"" + r.record + "\"" : "");
        if (!r.alert && !r.record) { errs.push(at + ": one of 'record' or 'alert' must be set"); return; }
        if (r.alert && r.record) { errs.push(at + ": only one of 'record' and 'alert' must be set"); return; }
        if (!r.expr) { errs.push(at + ": field 'expr' must be set in rule"); return; }
        if (r.record && !/^[a-zA-Z_:][a-zA-Z0-9_:]*$/.test(r.record)) { errs.push(at + ": invalid recording rule name: " + r.record); return; }
        if (r.record && (r["for"] || r.annotations)) { errs.push(at + ": invalid field 'for' in recording rule"); return; }
        try { O.parse(String(r.expr)); } catch (e) { errs.push(at + ": could not parse expression: " + (e.pos != null ? "1:" + (e.pos + 1) + ": parse error: " : "") + e.message); return; }
        rules.push({ alert: r.alert, record: r.record, expr: String(r.expr), forS: r["for"] ? O.durSecs(String(r["for"])) : 0, labels: r.labels || {}, annotations: r.annotations || {}, group: g.name });
      });
      groups.push({ name: g.name, rules: rules, interval: g.interval });
    });
    return { errs: errs, groups: groups };
  }
  O.parseGroups = parseGroups;
  function loadRules(cl) {
    var all = [];
    K.all(cl, "PrometheusRule").forEach(function (pr) {
      if (((pr.metadata.labels || {}).release) !== "monitoring") return;
      var r = parseGroups(pr.spec || {}, "");
      r.groups.forEach(function (g) { g.rules.forEach(function (x) { all.push(Object.assign({ src: pr.metadata.namespace + "/" + pr.metadata.name }, x)); }); });
    });
    return all;
  }
  O.loadRules = loadRules;
  function tmpl(s, labels, value) {
    return String(s).replace(/\{\{\s*([^}]*?)\s*\}\}/g, function (m0, ex) {
      var m = /^\$labels\.(\w+)$/.exec(ex); if (m) return labels[m[1]] == null ? "<no value>" : labels[m[1]];
      if (/^\$value$/.test(ex)) return O.fmtVal(value);
      if ((m = /^\$value\s*\|\s*humanizePercentage$/.exec(ex))) return (Math.round(value * 10000) / 100) + "%";
      if ((m = /^\$value\s*\|\s*humanize$/.exec(ex))) return humanize(value);
      if ((m = /^\$value\s*\|\s*humanizeDuration$/.exec(ex))) return value >= 1 ? Math.round(value) + "s" : Math.round(value * 1000) + "ms";
      if ((m = /^printf\s+"([^"]*)"\s+\$value$/.exec(ex))) return m[1].replace(/%(\.(\d+))?f/, function (x, y, d) { return value.toFixed(d ? +d : 6); }).replace(/%d/, String(Math.round(value))).replace(/%v|%s/, O.fmtVal(value));
      return m0;
    });
  }
  function humanize(v) { var a = Math.abs(v); if (a >= 1e9) return (v / 1e9).toFixed(3).replace(/\.?0+$/, "") + "G"; if (a >= 1e6) return (v / 1e6).toFixed(3).replace(/\.?0+$/, "") + "M"; if (a >= 1e3) return (v / 1e3).toFixed(3).replace(/\.?0+$/, "") + "k"; return String(+v.toPrecision(4)); }
  O.tmpl = tmpl;
  O.evalRules = function (cl, t) {
    var ob = cl.obs;
    if (ob.lastEval != null && t - ob.lastEval < EVAL) return;
    ob.lastEval = t;
    var rules = loadRules(cl);
    ob.rules = rules;
    var live = {};
    rules.forEach(function (r) {
      var res = O.query(cl, r.expr, t);
      r.health = res.error ? "err" : "ok"; r.lastError = res.error || "";
      if (res.error) return;
      var data = res.type === "scalar" ? [{ l: {}, v: res.value }] : res.data;
      if (r.record) { data.forEach(function (s) { var l = Object.assign({}, s.l, r.labels); delete l.__name__; O.put(ob, r.record, l, t, s.v); }); return; }
      data.forEach(function (s) {
        if (isNaN(s.v)) return;
        var l = Object.assign({}, s.l); delete l.__name__; Object.assign(l, r.labels); l.alertname = r.alert;
        var k = O.skey("A", l); live[k] = 1;
        var a = ob.alerts[k];
        if (!a || a.state === "resolved") a = ob.alerts[k] = { labels: l, activeAt: t, state: "pending", rule: r, value: s.v };
        a.value = s.v; a.rule = r;
        a.annotations = {}; keys(r.annotations).forEach(function (n) { a.annotations[n] = tmpl(r.annotations[n], l, s.v); });
        if (a.state === "pending" && t - a.activeAt >= r.forS) { a.state = "firing"; a.firedAt = t; }
      });
    });
    keys(ob.alerts).forEach(function (k) { var a = ob.alerts[k]; if (!live[k] && a.state !== "resolved" && a.falcoUntil == null) { a.state = a.state === "firing" ? "resolved" : "gone"; a.resolvedAt = t; } if (a.state === "gone") delete ob.alerts[k]; });
    keys(ob.alerts).forEach(function (k) { var a = ob.alerts[k]; if (a.state === "pending" || a.state === "firing") O.put(ob, "ALERTS", Object.assign({ alertstate: a.state }, a.labels), t, 1); });
    O.alertmanager(cl, t);
  };

  /* ================================================================== Alertmanager */
  function parseMatcher(s) { var m = /^\s*([\w.]+)\s*(=~|!~|!=|=)\s*"?(.*?)"?\s*$/.exec(String(s)); return m ? { l: m[1], op: m[2], v: m[3] } : null; }
  O.parseMatcher = parseMatcher;
  function mMatch(ms, labels) { return ms.every(function (m) { var v = labels[m.l] == null ? "" : String(labels[m.l]); return m.op === "=" ? v === m.v : m.op === "!=" ? v !== m.v : m.op === "=~" ? new RegExp("^(?:" + m.v + ")$").test(v) : !new RegExp("^(?:" + m.v + ")$").test(v); }); }
  O.mMatch = mMatch;
  function routeMatchers(r) { var ms = (r.matchers || []).map(parseMatcher).filter(Boolean); keys(r.match || {}).forEach(function (k) { ms.push({ l: k, op: "=", v: String(r.match[k]) }); }); keys(r.match_re || {}).forEach(function (k) { ms.push({ l: k, op: "=~", v: String(r.match_re[k]) }); }); return ms; }
  O.amConfig = function (cl) {
    var sec = K.get(cl, "Secret", "monitoring", "alertmanager-main");
    var txt = sec && sec.data && sec.data["alertmanager.yaml"] ? K.unb64(sec.data["alertmanager.yaml"]) : null;
    if (txt == null) return { error: "no configuration" };
    return O.checkAm(txt);
  };
  O.checkAm = function (txt) {
    var y = Y.tryParse(txt); if (y.error) return { error: y.error };
    var c = y.value || {};
    if (!c.route) return { error: "no route provided in config" };
    if (!c.route.receiver) return { error: "root route must specify a default receiver" };
    var names = (c.receivers || []).map(function (r) { return r.name; });
    var bad = null;
    (function walk(r) { if (r.receiver && names.indexOf(r.receiver) < 0) bad = bad || "undefined receiver \"" + r.receiver + "\" used in route"; (r.routes || []).forEach(walk); })(c.route);
    if (bad) return { error: bad };
    var badM = null; (function walk(r) { (r.matchers || []).forEach(function (m) { if (!parseMatcher(m)) badM = badM || "bad matcher format: " + m; }); (r.routes || []).forEach(walk); })(c.route);
    if (badM) return { error: badM };
    return { cfg: c, receivers: names };
  };
  // find receivers for labels: [{route, receiver}]
  O.routeFor = function (cfg, labels) {
    var res = [];
    (function walk(r, inherited) {
      var opts = Object.assign({}, inherited, { receiver: r.receiver || inherited.receiver, group_by: r.group_by || inherited.group_by, group_wait: r.group_wait || inherited.group_wait, group_interval: r.group_interval || inherited.group_interval, repeat_interval: r.repeat_interval || inherited.repeat_interval });
      var matched = false;
      for (var i = 0; i < (r.routes || []).length; i++) {
        var c = r.routes[i];
        if (mMatch(routeMatchers(c), labels)) { matched = true; var sub = walk(c, opts); if (!c["continue"]) break; void sub; }
      }
      if (!matched) res.push(opts);
      return matched;
    })(cfg.route, { group_by: ["alertname"], group_wait: "30s", group_interval: "5m", repeat_interval: "4h" });
    return res;
  };
  function silenced(am, labels, t) { return am.silences.filter(function (s) { return s.start <= t && s.end > t && mMatch(s.matchers, labels); })[0] || null; }
  O.silenced = silenced;
  function inhibited(cfg, labels, firing) { return (cfg.inhibit_rules || []).some(function (ir) { var tg = (ir.target_matchers || []).map(parseMatcher).concat(keys(ir.target_match || {}).map(function (k) { return { l: k, op: "=", v: ir.target_match[k] }; })), src = (ir.source_matchers || []).map(parseMatcher).concat(keys(ir.source_match || {}).map(function (k) { return { l: k, op: "=", v: ir.source_match[k] }; })); if (!mMatch(tg, labels)) return false; return firing.some(function (f) { return f.labels !== labels && mMatch(src, f.labels) && (ir.equal || []).every(function (e) { return (f.labels[e] || "") === (labels[e] || ""); }); }); }); }
  O.inhibited = inhibited;
  O.alertmanager = function (cl, t) {
    var ob = cl.obs, am = ob.am, c = O.amConfig(cl);
    am.cfgError = c.error || null;
    if (c.error) return;
    var cfg = c.cfg, active = keys(ob.alerts).map(function (k) { return ob.alerts[k]; }).filter(function (a) { return a.state === "firing" || (a.state === "resolved" && t - a.resolvedAt < 300); });
    var firing = active.filter(function (a) { return a.state === "firing"; });
    active.forEach(function (a) { a.silencedBy = a.state === "firing" ? silenced(am, a.labels, t) : null; a.inhibited = a.state === "firing" && inhibited(cfg, a.labels, firing); });
    var groups = {};
    active.forEach(function (a) {
      if (a.silencedBy || a.inhibited) return;
      O.routeFor(cfg, a.labels).forEach(function (rt) {
        var gb = rt.group_by || [], gk = rt.receiver + ":" + (gb.indexOf("...") >= 0 ? O.skey("", a.labels) : gb.map(function (n) { return n + "=" + (a.labels[n] || ""); }).join(","));
        (groups[gk] = groups[gk] || { key: gk, receiver: rt.receiver, rt: rt, alerts: [] }).alerts.push(a);
      });
    });
    keys(groups).forEach(function (gk) {
      var g = groups[gk], st = am.groups[gk] = am.groups[gk] || { first: t, lastSent: null, sentSig: "" };
      var fir = g.alerts.filter(function (a) { return a.state === "firing"; }), sigNow = g.alerts.map(function (a) { return O.skey(a.state, a.labels); }).sort().join("|");
      var wait = O.durSecs(g.rt.group_wait || "30s"), ivl = O.durSecs(g.rt.group_interval || "5m"), rep = O.durSecs(g.rt.repeat_interval || "4h");
      var due = st.lastSent == null ? (fir.length && t - st.first >= wait) : (sigNow !== st.sentSig && t - st.lastSent >= ivl) || (fir.length && t - st.lastSent >= rep);
      if (!due) return;
      if (!fir.length && st.lastSent == null) return;
      st.lastSent = t; st.sentSig = sigNow;
      var recv = (cfg.receivers || []).filter(function (r) { return r.name === g.receiver; })[0] || {};
      var type = recv.pagerduty_configs ? "pagerduty" : recv.slack_configs ? "slack" : recv.webhook_configs ? "webhook" : "none";
      am.notifs.push({ t: t, receiver: g.receiver, type: type, channel: ((recv.slack_configs || [])[0] || {}).channel || "", status: fir.length ? "firing" : "resolved", group: gk, alerts: g.alerts.map(function (a) { return { labels: a.labels, annotations: a.annotations, state: a.state, value: a.value }; }), id: "P" + K.rand("pg" + gk + t, 6).toUpperCase() });
      if (am.notifs.length > 300) am.notifs.shift();
    });
  };

  /* ================================================================== admission: the operator validates PrometheusRules */
  K.onBootstrap = K.onBootstrap || [];
  K.onBootstrap.push(function (cl) {
    if (!cl.comps.prometheus) return;
    cl.hooks.push(function (cl2, obj) {
      if (obj.kind !== "PrometheusRule") return null;
      var r = parseGroups(obj.spec || {}, "");
      if (r.errs.length) return { deny: "admission webhook \"prometheusrulevalidate.monitoring.coreos.com\" denied the request: Rules are not valid\n" + r.errs.map(function (e) { return "  " + e; }).join("\n") };
      return null;
    });
  });

  /* ================================================================== promtool */
  function promServer(sess, url, io) {
    var cl = K.of(sess.sys);
    if (!cl || !cl.obs || !/prometheus(\.monitoring(\.svc)?)?(\.staging\.kestrel\.dev)?(:\d+)?\/?$|localhost:9090/.test(String(url || "").replace(/^https?:\/\//, ""))) { errl(io, "query error: Get \"" + url + "/api/v1/query\": dial tcp: lookup " + String(url || "").replace(/^https?:\/\//, "").split(/[:/]/)[0] + ": no such host"); return null; }
    K.touch(cl, 1);
    return cl;
  }
  S.CMDS.promtool = function (args, io, sess) {
    var a = args.slice(1), o = KC.parse(a), sub = o.pos.shift(), what = o.pos.shift();
    if (sub === "--version" || o.version === true) { out(io, "promtool, version 2.55.1 (branch: HEAD, revision: 6d7569113f4f6bd4fbb0b14e2d4a53b6b2f6e8e5)\n"); return 0; }
    if (sub === "check" && (what === "rules" || what === "config")) {
      if (what === "config") { errl(io, "(promtool check config validates prometheus.yml; this cluster's Prometheus is configured by the Prometheus Operator from ServiceMonitors and PrometheusRules)"); return 1; }
      var code = 0;
      o.pos.forEach(function (f) {
        out(io, "Checking " + f + "\n");
        var t = KC.readF(sess, KC.absPath(sess, f));
        if (t == null) { errl(io, "  FAILED:\n" + f + ": open " + f + ": no such file or directory"); code = 1; return; }
        var y = Y.tryParse(t);
        if (y.error) { errl(io, "  FAILED:\n" + f + ": " + y.error.replace(/^yaml:/, "yaml:")); code = 1; return; }
        if (y.value && y.value.apiVersion) { errl(io, "  FAILED:\n" + f + ": yaml: unmarshal errors:\n  line 1: field apiVersion not found in type rulefmt.RuleGroups\n  line 2: field kind not found in type rulefmt.RuleGroups\n  line 3: field metadata not found in type rulefmt.RuleGroups\n  line 6: field spec not found in type rulefmt.RuleGroups"); code = 1; return; }
        var r = parseGroups(y.value, "");
        if (r.errs.length) { errl(io, "  FAILED:\n" + r.errs.map(function (e) { return f + ": " + e; }).join("\n")); code = 1; return; }
        var n = r.groups.reduce(function (s, g) { return s + g.rules.length; }, 0);
        out(io, "  SUCCESS: " + n + " rules found\n\n");
      });
      if (!o.pos.length) { errl(io, "promtool: error: required argument 'rule-files' not provided, try --help"); return 1; }
      return code;
    }
    if (sub === "query") {
      var url = o.pos.shift(), cl = promServer(sess, url, io); if (!cl) return 1;
      if (what === "instant") {
        var expr = o.pos.join(" "), t = K.t(cl);
        var r = O.query(cl, expr, t);
        if (r.error) { errl(io, "query error: bad_data: invalid parameter \"query\": " + r.error); return 1; }
        var ts = O.unix(cl, t).toFixed(3);
        if (r.type === "scalar") { out(io, "scalar: " + O.fmtVal(r.value) + " @[" + ts + "]\n"); return 0; }
        if (r.type === "matrix") r.data.forEach(function (s) { out(io, O.fmtLabels(s.l) + " =>\n" + (s.p || []).map(function (p) { return O.fmtVal(p[1]) + " @[" + O.unix(cl, p[0]).toFixed(3) + "]"; }).join("\n") + "\n"); });
        else r.data.forEach(function (s) { out(io, O.fmtLabels(s.l) + " => " + O.fmtVal(s.v) + " @[" + ts + "]\n"); });
        (cl.promQueries = cl.promQueries || []).push({ expr: expr, n: r.data.length, cmd: CI_idx(sess) });
        return 0;
      }
      if (what === "range") {
        var expr2 = o.pos.join(" "), now = K.t(cl), step = o.step ? O.durSecs(o.step) || +o.step : 60, start = o.start ? relTime(cl, o.start, now) : now - 3600, end = o.end ? relTime(cl, o.end, now) : now;
        var rr = O.queryRange(cl, expr2, start, end, step);
        if (rr.error) { errl(io, "query error: bad_data: invalid parameter \"query\": " + rr.error); return 1; }
        rr.data.forEach(function (s) { out(io, O.fmtLabels(s.l) + " =>\n" + s.p.map(function (p) { return O.fmtVal(p[1]) + " @[" + O.unix(cl, p[0]).toFixed(0) + "]"; }).join("\n") + "\n"); });
        (cl.promQueries = cl.promQueries || []).push({ expr: expr2, n: rr.data.length, range: true, cmd: CI_idx(sess) });
        return 0;
      }
      if (what === "labels") { var name = o.pos[0], vals = {}; keys(cl.obs.series).forEach(function (k) { var v = cl.obs.series[k].labels[name]; if (v != null) vals[v] = 1; }); out(io, keys(vals).sort().join("\n") + "\n"); return 0; }
      if (what === "series") { var mt = o.match || o.pos[0]; var rs = O.query(cl, mt, K.t(cl)); if (rs.error) { errl(io, "query error: " + rs.error); return 1; } rs.data.forEach(function (s) { out(io, O.fmtLabels(s.l) + "\n"); }); return 0; }
      errl(io, "promtool: error: expected command but got \"" + (what || "") + "\""); return 1;
    }
    out(io, "usage: promtool [<flags>] <command> [<args> ...]\n\nTooling for the Prometheus monitoring system.\n\nCommands:\n  check rules <rule-files>...\n  query instant <server> <expr>\n  query range [<flags>] <server> <expr>\n  query series --match=MATCH <server>\n  query labels <server> <name>\n");
    return sub ? 1 : 0;
  };
  function CI_idx(sess) { return root.CI.homeSys(sess.sys).cmdIndex; }
  function relTime(cl, s, now) { var m = /^-?(\d+[smhd])$/.exec(s); if (m) return now - O.durSecs(m[1]); if (/^now-/.test(s)) return now - O.durSecs(s.slice(4)); if (/^\d{9,}(\.\d+)?$/.test(s)) return +s - Dk.stamp(cl.rt, 0) / 1000; var d = Date.parse(s); return isNaN(d) ? now : d / 1000 - Dk.stamp(cl.rt, 0) / 1000; }

  /* ================================================================== amtool */
  function amtoolURL(sess, o) { var u = o["alertmanager.url"]; if (u) return u; var t = KC.readF(sess, sess.home + "/.config/amtool/config.yml"); var m = t && /alertmanager\.url:\s*"?([^"\n]+)/.exec(t); return m ? m[1] : null; }
  function amCl(sess, o, io) {
    var url = amtoolURL(sess, o);
    if (!url) { errl(io, "amtool: error: required flag --alertmanager.url not provided"); return null; }
    var cl = K.of(sess.sys);
    if (!cl || !cl.obs || !/alertmanager/.test(url)) { errl(io, "Get \"" + url + "/api/v2/status\": dial tcp: lookup " + url.replace(/^https?:\/\//, "").split(/[:/]/)[0] + ": no such host"); return null; }
    K.touch(cl, 1); return cl;
  }
  function fmtT(cl, t) { var d = new Date(Dk.stamp(cl.rt, t)); return d.toISOString().replace("T", " ").replace(/\.\d+Z$/, " UTC"); }
  O.fmtT = fmtT;
  function table(rows) { var w = []; rows.forEach(function (r) { r.forEach(function (c, i) { w[i] = Math.max(w[i] || 0, String(c).length); }); }); return rows.map(function (r) { return r.map(function (c, i) { return i === r.length - 1 ? String(c) : String(c) + new Array(w[i] - String(c).length + 3).join(" "); }).join("").replace(/\s+$/, ""); }).join("\n") + "\n"; }
  O.table = table;
  S.CMDS.amtool = function (args, io, sess) {
    var o = KC.parse(args.slice(1)), sub = o.pos.shift();
    if (sub === "check-config") {
      var code = 0;
      o.pos.forEach(function (f) { var t = KC.readF(sess, KC.absPath(sess, f)); out(io, "Checking '" + f + "'"); if (t == null) { out(io, "  FAILED: open " + f + ": no such file or directory\n"); code = 1; return; } var c = O.checkAm(t); if (c.error) { out(io, "  FAILED: " + c.error + "\n"); code = 1; return; } out(io, "  SUCCESS\nFound:\n - global config\n - route\n - " + (c.cfg.inhibit_rules || []).length + " inhibit rules\n - " + c.receivers.length + " receivers\n - 0 templates\n\n"); });
      return code;
    }
    var cl = amCl(sess, o, io); if (!cl) return 1;
    var ob = cl.obs, am = ob.am, t = K.t(cl);
    O.alertmanager(cl, t);
    if (!sub || sub === "alert") {
      var w = o.pos[0] === "query" ? o.pos.shift() : null; void w;
      var ms = o.pos.map(function (x) { return /[=~!]/.test(x) ? parseMatcher(x) : { l: "alertname", op: "=", v: x }; }).filter(Boolean);
      var list = keys(ob.alerts).map(function (k) { return ob.alerts[k]; }).filter(function (a) { return a.state === "firing" && mMatch(ms, a.labels); });
      list = list.filter(function (a) { if (o.silenced || o.s) return !!a.silencedBy; if (o.inhibited || o.i) return a.inhibited; if (o.active || o.a) return !a.silencedBy && !a.inhibited; return !a.silencedBy && !a.inhibited; });
      if (o.output === "extended" || o.o === "extended") { var rows0 = [["Labels", "Annotations", "Starts At", "Ends At", "Generator URL"]]; list.forEach(function (a) { rows0.push([keys(a.labels).sort().map(function (k) { return k + "=\"" + a.labels[k] + "\""; }).join(" "), keys(a.annotations || {}).map(function (k) { return k + "=\"" + a.annotations[k] + "\""; }).join(" "), fmtT(cl, a.firedAt), "0001-01-01 00:00:00 UTC", "http://prometheus.monitoring:9090/graph"]); }); out(io, table(rows0)); return 0; }
      var rows = [["Alertname", "Starts At", "Summary", "State"]];
      list.forEach(function (a) { rows.push([a.labels.alertname, fmtT(cl, a.firedAt), (a.annotations || {}).summary || "", a.silencedBy ? "suppressed" : "active"]); });
      out(io, table(rows)); return 0;
    }
    if (sub === "silence") {
      var ss = o.pos.shift() || "query";
      if (ss === "add") {
        var ms2 = o.pos.map(function (x) { return /[=~!]/.test(x) ? parseMatcher(x) : { l: "alertname", op: "=", v: x }; }).filter(Boolean);
        if (!ms2.length) { errl(io, "amtool: error: no matchers specified"); return 1; }
        if (!o.comment && o.c == null) { errl(io, "comment required by config"); return 1; }
        var dur = O.durSecs(o.duration || o.d || "1h"), id = (function () { var h = K.hex("sil" + am.silences.length + t, 32); return h.slice(0, 8) + "-" + h.slice(8, 12) + "-" + h.slice(12, 16) + "-" + h.slice(16, 20) + "-" + h.slice(20, 32); })();
        am.silences.push({ id: id, matchers: ms2, start: t, end: t + dur, author: o.author || o.a || "kc-dev", comment: o.comment || o.c, created: t });
        O.alertmanager(cl, t);
        out(io, id + "\n"); return 0;
      }
      if (ss === "query") {
        var act = am.silences.filter(function (s) { return o.expired ? s.end <= t : s.end > t; });
        if (o.quiet || o.q) { out(io, act.map(function (s) { return s.id; }).join("\n") + (act.length ? "\n" : "")); return 0; }
        var rows2 = [["ID", "Matchers", "Ends At", "Created By", "Comment"]];
        act.forEach(function (s) { rows2.push([s.id, s.matchers.map(function (m) { return m.l + m.op + "\"" + m.v + "\""; }).join(" "), fmtT(cl, s.end), s.author, s.comment]); });
        out(io, table(rows2)); return 0;
      }
      if (ss === "expire") { var n = 0; o.pos.forEach(function (id) { am.silences.forEach(function (s) { if (s.id === id || s.id.indexOf(id) === 0) { s.end = t; n++; } }); }); if (!n) { errl(io, "amtool: error: silence " + o.pos[0] + " not found"); return 1; } return 0; }
      errl(io, "amtool: error: expected command but got \"" + ss + "\""); return 1;
    }
    if (sub === "config") {
      var cc = O.amConfig(cl); if (cc.error) { errl(io, "amtool: error: " + cc.error); return 1; }
      var cs = o.pos.shift();
      if (cs === "routes") {
        if (o.pos[0] === "test") { o.pos.shift(); var lb = {}; o.pos.forEach(function (x) { var m = parseMatcher(x); if (m) lb[m.l] = m.v; }); out(io, O.routeFor(cc.cfg, lb).map(function (r) { return r.receiver; }).join(",") + "\n"); return 0; }
        var lines = ["Routing tree:"]; (function walk(r, ind) { lines.push(new Array(ind + 1).join("    ") + "└── " + (ind ? "{" + routeMatchers(r).map(function (m) { return m.l + m.op + "\"" + m.v + "\""; }).join(",") + "}" : "default-route") + "  receiver: " + (r.receiver || "")); (r.routes || []).forEach(function (c) { walk(c, ind + 1); }); })(cc.cfg, 0);
        lines[1] = lines[1].replace("default-route", "default-route"); out(io, "\n" + lines.join("\n").replace("└── default-route  receiver: ", "└── default-route  receiver: ") + "\n\n"); return 0;
      }
      out(io, KC.yaml(cc.cfg)); return 0;
    }
    errl(io, "amtool: error: expected command but got \"" + sub + "\", try --help"); return 1;
  };

  /* ================================================================== Prometheus' HTTP API (prometheus.staging.kestrel.dev) */
  function qs(path) { var o = {}, q = String(path).split("?")[1] || ""; q.split("&").forEach(function (kv) { if (!kv) return; var i = kv.indexOf("="), k = i < 0 ? kv : kv.slice(0, i), v = i < 0 ? "" : kv.slice(i + 1); try { o[decodeURIComponent(k)] = decodeURIComponent(v.replace(/\+/g, " ")); } catch (e) { o[k] = v; } }); return o; }
  O.qs = qs;
  function j(status, obj) { return { status: status, headers: { "Content-Type": "application/json" }, body: JSON.stringify(obj) + "\n" }; }
  O.json = j;
  O.promApi = function (cl, req) {
    var p = req.path.split("?")[0], q = qs(req.path); if (req.body && req.method === "POST") Object.assign(q, qs("?" + req.body));
    var t = K.t(cl);
    function vecOut(r) { return r.type === "scalar" ? { resultType: "scalar", result: [O.unix(cl, t), O.fmtVal(r.value)] } : { resultType: "vector", result: r.data.map(function (s) { var m = {}; keys(s.l).forEach(function (k) { m[k] = String(s.l[k]); }); return { metric: m, value: [O.unix(cl, t), O.fmtVal(s.v)] }; }) }; }
    if (p === "/api/v1/query") { var r = O.query(cl, q.query || "", t); if (r.error) return j(400, { status: "error", errorType: "bad_data", error: "invalid parameter \"query\": " + r.error }); (cl.promQueries = cl.promQueries || []).push({ expr: q.query, n: r.data ? r.data.length : 1, api: true }); return j(200, { status: "success", data: vecOut(r) }); }
    if (p === "/api/v1/query_range") { var rr = O.queryRange(cl, q.query || "", relTime(cl, q.start || "-1h", t), relTime(cl, q.end || "0s", t), O.durSecs(q.step || "60s") || 60); if (rr.error) return j(400, { status: "error", errorType: "bad_data", error: rr.error }); return j(200, { status: "success", data: { resultType: "matrix", result: rr.data.map(function (s) { return { metric: s.l, values: s.p.map(function (x) { return [O.unix(cl, x[0]), O.fmtVal(x[1])]; }) }; }) } }); }
    if (p === "/api/v1/targets") { var tg = O.targets(cl); return j(200, { status: "success", data: { activeTargets: tg.map(function (x) { var ok = K.podReady(x.pod); return { labels: { job: x.job, namespace: x.pod.metadata.namespace, pod: x.pod.metadata.name, instance: x.pod.status.podIP + ":" + x.port }, scrapePool: "serviceMonitor/" + x.sm.metadata.namespace + "/" + x.sm.metadata.name + "/0", scrapeUrl: "http://" + x.pod.status.podIP + ":" + x.port + x.path, health: ok ? "up" : "down", lastError: ok ? "" : "Get \"http://" + x.pod.status.podIP + ":" + x.port + x.path + "\": dial tcp: connection refused" }; }) } }); }
    if (p === "/api/v1/alerts") { var al = keys(cl.obs.alerts).map(function (k) { return cl.obs.alerts[k]; }).filter(function (a) { return a.state === "pending" || a.state === "firing"; }); return j(200, { status: "success", data: { alerts: al.map(function (a) { return { labels: a.labels, annotations: a.annotations, state: a.state, activeAt: K.stamp(cl, a.activeAt), value: O.fmtVal(a.value) }; }) } }); }
    if (p === "/api/v1/rules") { return j(200, { status: "success", data: { groups: (cl.obs.rules || []).map(function (r) { return { name: r.group, file: r.src, rules: [{ name: r.alert || r.record, query: r.expr, type: r.alert ? "alerting" : "recording", health: r.health || "unknown", lastError: r.lastError || "" }] }; }) } }); }
    if (p === "/-/healthy") return { status: 200, headers: { "Content-Type": "text/plain" }, body: "Prometheus Server is Healthy.\n" };
    return { status: 404, headers: { "Content-Type": "text/plain" }, body: "404 page not found\n" };
  };
})(typeof window !== "undefined" ? window : globalThis);
