/* sudo learn — DevOps Module 4: kubectl, part 1. Flag parsing, kubeconfig contexts, reading manifests (-f file,
   directory, -k kustomization, stdin), the `get` tables for every kind (with -o wide/yaml/json/name/jsonpath/
   custom-columns, -l, -A, --show-labels), `describe` with events, `explain`, `api-resources`, `config`,
   `cluster-info`, `version`, `top`, `events` and `auth can-i`. Writing commands are in k8s-kubectl2.js. */
(function (root) {
  "use strict";
  var S = root.ShEngine, M2 = S.M2, U = S.util, Dk = root.Dk, K = root.K8s, Y = root.DevYaml;
  var out = U.out, errl = U.errl;
  var keys = K.keys, clone = K.clone, isObj = K.isObj;
  var KC = K.kubectl = {};

  /* ================================================================== flags */
  var BOOL = ["A", "all-namespaces", "w", "watch", "show-labels", "i", "stdin", "t", "tty", "rm", "previous", "p", "all-containers", "R", "recursive", "overwrite", "all", "force", "now", "list", "no-headers", "ignore-not-found", "wait", "quiet", "q", "current", "local", "help", "h", "minify", "raw", "insecure-skip-tls-verify", "server-side", "follow", "f!", "watch-only", "timestamps", "prefix", "include-uninitialized", "containers", "sort", "record", "keep-pvc", "reuse-values", "reset-values", "atomic", "create-namespace", "install", "untar", "devel", "prune", "self-heal", "auto-prune", "generate-name", "refresh", "hard-refresh", "insecure", "plaintext", "grpc-web", "command", "attach", "dry-run", "versions", "debug", "skip-crds"];
  // kubectl's flag style: -n x, -nx, --namespace=x, --namespace x, -it
  KC.parse = function (args) {
    var o = { pos: [], f: [], l: null }, i = 0;
    function val() { return args[++i]; }
    for (; i < args.length; i++) {
      var a = args[i], m;
      if (a === "--") { o.dash = args.slice(i + 1); break; }
      if ((m = /^--([\w-]+)=([\s\S]*)$/.exec(a))) { set(m[1], m[2]); continue; }
      if ((m = /^--([\w-]+)$/.exec(a))) { if (BOOL.indexOf(m[1]) >= 0 && m[1] !== "filename") set(m[1], true); else set(m[1], val()); continue; }
      if ((m = /^-([A-Za-z])(.+)$/.exec(a)) && !/^-[0-9]/.test(a)) {
        if (/^[itAwRpq]+$/.test(m[1] + m[2]) && m[2].split("").every(function (c) { return /[itAwRpq]/.test(c); })) { (m[1] + m[2]).split("").forEach(function (c) { set(c, true); }); continue; }
        set(m[1], m[2].replace(/^=/, "")); continue;
      }
      if ((m = /^-([A-Za-z])$/.exec(a))) { if (/^[AwitRpq]$/.test(m[1])) set(m[1], true); else set(m[1], val()); continue; }
      o.pos.push(a);
    }
    function set(k, v) {
      var map = { n: "namespace", o: "output", l: "selector", c: "container", f: "filename", k: "kustomize", A: "all-namespaces", w: "watch", i: "stdin", t: "tty", p: "previous", R: "recursive", q: "quiet" };
      k = map[k] || k;
      if (k === "filename") { o.f.push(v); return; }
      if (k === "from-literal" || k === "from-file" || k === "env" || k === "from-env-file" || k === "resource" || k === "verb" || k === "rule" || k === "serviceaccount" || k === "user" || k === "group" || k === "patch-file" || k === "port" || k === "set" || k === "values" || k === "env-from") { (o[k + "s"] = o[k + "s"] || []).push(v); }
      o[k] = v;
    }
    return o;
  };

  /* ================================================================== context: cluster, namespace, user */
  KC.ctx = function (sess, o, io) {
    var cl = K.of(sess.sys);
    var kc = K.kubeconfig(sess);
    if (!kc || !cl) { errl(io, "E1123 10:02:11.512303   " + (1000 + (sess.sys.cmdIndex || 1) % 900) + " memcache.go:265] \"Unhandled Error\" err=\"couldn't get current server API group list: Get \\\"http://localhost:8080/api?timeout=32s\\\": dial tcp 127.0.0.1:8080: connect: connection refused\"\nThe connection to the server localhost:8080 was refused - did you specify the right host or port?"); return null; }
    if (kc.error) { errl(io, "error: " + kc.error); return null; }
    var ctxName = o.context || kc.current;
    if (!ctxName) { errl(io, "error: current-context is not set"); return null; }
    var ctx = kc.contexts[ctxName];
    if (!ctx) { errl(io, "error: context \"" + ctxName + "\" does not exist"); return null; }
    kc.ctx = ctx;
    var clu = kc.clusters[ctx.cluster];
    if (!clu || clu.server !== cl.server) { errl(io, "Unable to connect to the server: dial tcp " + String((clu || {}).server || "").replace(/^https?:\/\//, "") + ": i/o timeout"); return null; }
    var sub;
    if (o.as) sub = K.subjectOf(cl, null, o.as);
    else {
      var u = kc.users[ctx.user];
      if (!u) { errl(io, "error: You must be logged in to the server (the server has asked for the client to provide credentials)"); return null; }
      if (u.token) { var t = cl.tokens[u.token]; if (!t || t.exp <= K.t(cl)) { errl(io, "error: You must be logged in to the server (Unauthorized)"); return null; } sub = K.subjectOf(cl, null, t.sub); }
      else sub = { user: u.cn || ctx.user, groups: (u.groups || []).concat(["system:authenticated"]) };
      if (o.as && !K.can(cl, sub, "impersonate", "users", "", null)) { errl(io, "Error from server (Forbidden): users \"" + o.as + "\" is forbidden: User \"" + sub.user + "\" cannot impersonate resource \"users\" in API group \"\" at the cluster scope"); return null; }
    }
    if (o.as) { var realU = kc.users[ctx.user], real = realU && realU.cn ? { user: realU.cn, groups: realU.groups || [] } : null; if (real && !K.can(cl, real, "impersonate", "users", "", null) && (real.groups || []).indexOf("system:masters") < 0) { errl(io, "Error from server (Forbidden): users \"" + o.as + "\" is forbidden: User \"" + real.user + "\" cannot impersonate resource \"users\" in API group \"\" at the cluster scope"); return null; } }
    if (o["as-groups"]) sub.groups = sub.groups.concat(o["as-groups"]);
    var ns = o.namespace || ctx.namespace || "default";
    K.touch(cl, 1);
    return { cl: cl, kc: kc, ctx: ctx, ctxName: ctxName, sub: sub, ns: ns, nsGiven: !!o.namespace };
  };

  /* ================================================================== manifests */
  function absPath(sess, p) { p = String(p).replace(/^~(?=\/|$)/, sess.home); return S.normAbs(p.charAt(0) === "/" ? p : sess.cwd + "/" + p); }
  KC.absPath = absPath;
  function isDir(sess, p) { var n = Dk.fsNode(sess.sys, p); return !!n && n.type === "d"; }
  function readF(sess, p) { var r = S.readFile(sess, p); return r.error ? null : r.content; }
  KC.readF = readF;
  // parse YAML/JSON text with --- separators -> {docs: [{obj, src}]} or {error}
  KC.parseDocs = function (text, src) {
    var docs = [], parts = String(text).split(/^---[ \t]*$/m), lineOff = 0;
    for (var i = 0; i < parts.length; i++) {
      var t = parts[i];
      if (!/\S/.test(t.replace(/^\s*#.*$/mg, ""))) { lineOff += t.split("\n").length - 1; continue; }
      var v;
      if (/^\s*[{[]/.test(t)) { try { v = JSON.parse(t); } catch (e) { return { error: "error: error parsing " + src + ": " + e.message }; } }
      else {
        var y = Y.tryParse(t);
        if (y.error) return { error: "error: error parsing " + src + ": error converting YAML to JSON: " + y.error.replace(/line (\d+)/, function (m0, n) { return "line " + (+n + lineOff); }) };
        v = y.value;
      }
      lineOff += t.split("\n").length - 1;
      if (v == null) continue;
      if (isObj(v) && v.kind === "List" && Array.isArray(v.items)) v.items.forEach(function (x) { docs.push({ obj: x, src: src }); });
      else docs.push({ obj: v, src: src });
    }
    return { docs: docs };
  };
  // -f paths (files, directories, -R), URLs not supported, "-" = stdin
  KC.load = function (sess, o, io) {
    var all = [];
    if (o.kustomize) { var kz = K.kustomize ? K.kustomize(sess, absPath(sess, o.kustomize)) : { error: "error: kustomize is not available" }; if (kz.error) { errl(io, kz.error); return null; } return kz.docs; }
    if (!o.f.length) { errl(io, "error: must specify one of -f and -k"); return null; }
    for (var i = 0; i < o.f.length; i++) {
      var f = o.f[i];
      if (f === "-") { var pd = KC.parseDocs(io.stdin || "", "STDIN"); if (pd.error) { errl(io, pd.error); return null; } all = all.concat(pd.docs); continue; }
      if (/^https?:\/\//.test(f)) { errl(io, "error: unable to read URL \"" + f + "\", server reported 404 Not Found, status code=404"); return null; }
      var p = absPath(sess, f);
      if (isDir(sess, p)) {
        var files = [];
        (function walk(d, deep) { var n = Dk.fsNode(sess.sys, d); keys(n.children).sort().forEach(function (k) { var c = n.children[k], cp = d + "/" + k; if (c.type === "d") { if (deep) walk(cp, deep); } else if (/\.(ya?ml|json)$/.test(k)) files.push(cp); }); })(p, !!o.recursive);
        if (!files.length) { errl(io, "error: no objects passed to " + (o.sub || "apply")); return null; }
        for (var j = 0; j < files.length; j++) { var t = readF(sess, files[j]), pd2 = KC.parseDocs(t, files[j].replace(sess.cwd + "/", "")); if (pd2.error) { errl(io, pd2.error); return null; } all = all.concat(pd2.docs); }
        continue;
      }
      var txt = readF(sess, p);
      if (txt == null) { errl(io, "error: the path \"" + f + "\" does not exist"); return null; }
      var pd3 = KC.parseDocs(txt, f);
      if (pd3.error) { errl(io, pd3.error); return null; }
      all = all.concat(pd3.docs);
    }
    if (!all.length) { errl(io, "error: no objects passed to " + (o.sub || "apply")); return null; }
    return all;
  };

  /* ================================================================== output helpers */
  KC.table = function (rows) { return Dk.table(rows); };
  function age(cl, t) { return t == null ? "<unknown>" : K.age(cl, t); }
  KC.age = age;
  function ref(info, name) { return info.plural.replace(/s$/, "").replace(/ie$/, "y").replace(/sse$/, "ss").replace(/ingresse$/, "ingress") + (info.group ? "." + info.group : "") + "/" + name; }
  KC.ref = function (info, name) { var single = { pods: "pod", services: "service", endpoints: "endpoints", configmaps: "configmap", secrets: "secret", namespaces: "namespace", nodes: "node", persistentvolumeclaims: "persistentvolumeclaim", persistentvolumes: "persistentvolume", serviceaccounts: "serviceaccount", events: "event", resourcequotas: "resourcequota", limitranges: "limitrange", deployments: "deployment", replicasets: "replicaset", statefulsets: "statefulset", daemonsets: "daemonset", jobs: "job", cronjobs: "cronjob", ingresses: "ingress", ingressclasses: "ingressclass", networkpolicies: "networkpolicy", horizontalpodautoscalers: "horizontalpodautoscaler", poddisruptionbudgets: "poddisruptionbudget", roles: "role", rolebindings: "rolebinding", clusterroles: "clusterrole", clusterrolebindings: "clusterrolebinding", storageclasses: "storageclass", certificates: "certificate", clusterissuers: "clusterissuer", clusterpolicies: "clusterpolicy", policies: "policy", policyreports: "policyreport", applications: "application" }[info.plural] || info.plural; return single + (info.group ? "." + info.group : "") + "/" + name; };
  void ref;
  // kubectl's YAML: sequences not indented under their key
  function ydump(v, ind) {
    ind = ind || 0;
    var pad = new Array(ind + 1).join(" ");
    function scal(x) {
      if (x === null || x === undefined) return "null";
      if (typeof x !== "string") return String(x);
      if (/\n/.test(x)) return "|" + (/\n$/.test(x) ? "" : "-") + "\n" + x.replace(/\n$/, "").split("\n").map(function (l) { return pad + "  " + l; }).join("\n");
      if (/^\d{4}-\d\d-\d\d(T|$)/.test(x)) return JSON.stringify(x);
      return Y.dump(x).replace(/\n$/, "");
    }
    if (Array.isArray(v)) {
      if (!v.length) return " []";
      return "\n" + v.map(function (x) {
        if (isObj(x) && keys(x).length) { var inner = ydump(x, ind + 2).replace(/^\n/, ""); return pad + "- " + inner.replace(/^ +/, ""); }
        if (Array.isArray(x)) return pad + "-" + ydump(x, ind + 2);
        return pad + "- " + scal(x);
      }).join("\n");
    }
    if (isObj(v)) {
      var ks = keys(v).filter(function (k) { return v[k] !== undefined && k.charAt(0) !== "_"; }).sort();
      if (!ks.length) return " {}";
      return "\n" + ks.map(function (k) {
        var x = v[k], key = pad + (/^[\w./-]+$/.test(k) && !/^(true|false|null|yes|no|on|off|\d+)$/i.test(k) ? k : JSON.stringify(k)) + ":";
        if (Array.isArray(x)) return key + (x.length ? ydump(x, ind) : " []");
        if (isObj(x)) return key + (keys(x).filter(function (q) { return x[q] !== undefined && q.charAt(0) !== "_"; }).length ? ydump(x, ind + 2) : " {}");
        return key + " " + scal(x);
      }).join("\n");
    }
    return " " + scal(v);
  }
  KC.yaml = function (o) { return ydump(o, 0).replace(/^\n/, "") + "\n"; };
  // the object as the API returns it (times as RFC3339, no simulator internals)
  KC.wire = function (cl, o) {
    var x = clone(o);
    (function strip(v) { if (isObj(v)) keys(v).forEach(function (k) { if (k.charAt(0) === "_") delete v[k]; else strip(v[k]); }); else if (Array.isArray(v)) v.forEach(strip); })(x);
    if (x.metadata) { if (x.metadata.creationTimestamp != null) x.metadata.creationTimestamp = K.stamp(cl, x.metadata.creationTimestamp); if (x.metadata.deletionTimestamp != null) x.metadata.deletionTimestamp = K.stamp(cl, x.metadata.deletionTimestamp); }
    var TS = /^(startTime|startedAt|finishedAt|lastTransitionTime|lastProbeTime|lastScheduleTime|lastSuccessfulTime|completionTime|lastScaleTime|notBefore|notAfter|renewalTime|reconciledAt|deployedAt)$/;
    (function times(v) { if (isObj(v)) keys(v).forEach(function (k) { if (TS.test(k) && typeof v[k] === "number") v[k] = K.stamp(cl, v[k]); else times(v[k]); }); else if (Array.isArray(v)) v.forEach(times); })(x);
    var order = ["apiVersion", "kind", "metadata", "spec", "data", "stringData", "type", "rules", "roleRef", "subjects", "provisioner", "reclaimPolicy", "volumeBindingMode", "allowVolumeExpansion", "imagePullSecrets", "automountServiceAccountToken", "status"];
    var y = {}; order.forEach(function (k) { if (x[k] !== undefined) y[k] = x[k]; }); keys(x).forEach(function (k) { if (y[k] === undefined) y[k] = x[k]; });
    if (y.metadata) { var m = y.metadata, mo = {}; ["annotations", "creationTimestamp", "deletionGracePeriodSeconds", "deletionTimestamp", "generateName", "generation", "labels", "name", "namespace", "ownerReferences", "resourceVersion", "uid"].forEach(function (k) { if (m[k] !== undefined) mo[k] = m[k]; }); keys(m).forEach(function (k) { if (mo[k] === undefined) mo[k] = m[k]; }); y.metadata = mo; }
    return y;
  };
  // JSONPath subset: {.a.b}, {.items[*].metadata.name}, {.items[0].x}, {range .items[*]}...{end}, {"\n"}, {.data.key}, {.a['b\.c']}
  function jpGet(v, path) {
    var segs = [], re = /\.([\w-]+)|\[(\*|-?\d+|'[^']*'|"[^"]*")\]|\.\.([\w-]+)/g, m, p = path.replace(/^\$/, "");
    if (p === "" || p === ".") return [v];
    p = p.replace(/\['([^']*)'\]/g, function (m0, k) { return "['" + k.replace(/\\\./g, ".") + "']"; });
    while ((m = re.exec(p))) segs.push(m[1] != null ? { k: m[1] } : m[3] != null ? { deep: m[3] } : m[2] === "*" ? { all: true } : /^-?\d+$/.test(m[2]) ? { i: +m[2] } : { k: m[2].slice(1, -1) });
    var cur = [v];
    segs.forEach(function (s) {
      var nx = [];
      cur.forEach(function (c) {
        if (c == null) return;
        if (s.all) { if (Array.isArray(c)) nx = nx.concat(c); else if (isObj(c)) nx = nx.concat(keys(c).map(function (k) { return c[k]; })); }
        else if (s.i != null) { if (Array.isArray(c)) { var x = c[s.i < 0 ? c.length + s.i : s.i]; if (x !== undefined) nx.push(x); } }
        else if (s.deep) { (function walk(o) { if (isObj(o)) keys(o).forEach(function (k) { if (k === s.deep) nx.push(o[k]); walk(o[k]); }); else if (Array.isArray(o)) o.forEach(walk); })(c); }
        else if (isObj(c) && c[s.k] !== undefined) nx.push(c[s.k]);
      });
      cur = nx;
    });
    return cur;
  }
  function jpStr(x) { return x == null ? "" : typeof x === "object" ? JSON.stringify(x) : String(x); }
  KC.jsonpath = function (tpl, data) {
    tpl = String(tpl).replace(/^'|'$/g, "");
    var toks = [], re = /\{([^{}]*)\}/g, last = 0, m;
    while ((m = re.exec(tpl))) { if (m.index > last) toks.push({ text: tpl.slice(last, m.index) }); toks.push({ expr: m[1].trim() }); last = re.lastIndex; }
    if (last < tpl.length) toks.push({ text: tpl.slice(last) });
    if (!toks.some(function (t) { return t.expr != null; })) return { error: "error: error parsing jsonpath " + tpl + ", unrecognized identifier " + tpl };
    function run(list, ctx) {
      var s = "";
      for (var i = 0; i < list.length; i++) {
        var t = list[i];
        if (t.text != null) { s += t.text; continue; }
        var e = t.expr;
        if (/^range\s+/.test(e)) {
          var depth = 1, j = i + 1;
          for (; j < list.length; j++) { if (list[j].expr && /^range\s+/.test(list[j].expr)) depth++; if (list[j].expr === "end") { depth--; if (!depth) break; } }
          var body = list.slice(i + 1, j), items = jpGet(ctx, e.replace(/^range\s+/, ""));
          items.forEach(function (it) { s += run(body, it); });
          i = j; continue;
        }
        if (/^"(.*)"$/.test(e)) { s += JSON.parse(e); continue; }
        if (/^'(.*)'$/.test(e)) { s += e.slice(1, -1); continue; }
        var vals = jpGet(ctx, e.charAt(0) === "@" ? e.slice(1) : e);
        s += vals.map(jpStr).join(" ");
      }
      return s;
    }
    try { return { text: run(toks, data) }; } catch (err) { return { error: "error: error executing jsonpath \"" + tpl + "\": " + err.message }; }
  };

  /* ================================================================== get: columns per kind */
  function podStatus(p) {
    var st = p.status || {}, reason = st.reason || st.phase || "Pending";
    var ics = st.initContainerStatuses || [], inits = (p.spec.initContainers || []).length;
    for (var i = 0; i < ics.length; i++) {
      var s = ics[i];
      if (s.state.terminated && s.state.terminated.exitCode === 0) continue;
      if (s.state.terminated) { reason = "Init:" + (s.state.terminated.reason || "Error"); break; }
      if (s.state.waiting && s.state.waiting.reason && s.state.waiting.reason !== "PodInitializing") { reason = "Init:" + s.state.waiting.reason; break; }
      reason = "Init:" + i + "/" + inits; break;
    }
    if (!/^Init:/.test(reason)) {
      var hasRunning = false;
      (st.containerStatuses || []).slice().reverse().forEach(function (s) {
        if (s.state.waiting && s.state.waiting.reason) reason = s.state.waiting.reason;
        else if (s.state.terminated && s.state.terminated.reason) reason = s.state.terminated.reason;
        else if (s.state.terminated) reason = s.state.terminated.signal ? "Signal:" + s.state.terminated.signal : "ExitCode:" + s.state.terminated.exitCode;
        else if (s.ready && s.state.running) hasRunning = true;
      });
      if (reason === "Completed" && hasRunning) reason = "Running";
      if (st.phase === "Running" && (st.containerStatuses || []).every(function (s) { return s.state.running; })) reason = "Running";
    }
    if (p.metadata.deletionTimestamp != null) reason = "Terminating";
    return reason;
  }
  KC.podStatus = podStatus;
  function restarts(cl, p) {
    var n = 0, last = null;
    (p.status.containerStatuses || []).forEach(function (s) { n += s.restartCount; var lt = s.lastState && s.lastState.terminated; if (lt && (last == null || lt.finishedAt > last)) last = lt.finishedAt; });
    return n && last != null ? n + " (" + age(cl, last) + " ago)" : String(n);
  }
  function svcPorts(s) { return (s.spec.ports || []).map(function (p) { return p.port + (p.nodePort && s.spec.type !== "ClusterIP" ? ":" + p.nodePort : "") + "/" + p.protocol; }).join(",") || "<none>"; }
  function extIp(s) { if (s.spec.type === "LoadBalancer") { var i = ((s.status || {}).loadBalancer || {}).ingress; return i && i.length ? i.map(function (x) { return x.ip || x.hostname; }).join(",") : "<pending>"; } return (s.spec.externalIPs || []).join(",") || "<none>"; }
  function images(spec) { return { c: (spec.containers || []).map(function (c) { return c.name; }).join(","), i: (spec.containers || []).map(function (c) { return c.image; }).join(",") }; }
  function hpaTargets(cl, h) { var m = (h.spec.metrics || [])[0]; if (!m) return "<none>"; var cur = (((h.status || {}).currentMetrics || [])[0] || { resource: { current: {} } }).resource.current.averageUtilization; return m.resource.name + ": " + (cur == null ? "<unknown>" : cur + "%") + "/" + m.resource.target.averageUtilization + "%"; }
  function jobStatus(j) { var c = (j.status || {}).conditions || []; if (c.some(function (x) { return x.type === "Complete" && x.status === "True"; })) return "Complete"; if (c.some(function (x) { return x.type === "Failed" && x.status === "True"; })) return "Failed"; if (j.spec.suspend) return "Suspended"; return "Running"; }
  function dur(cl, a, b) { if (a == null) return ""; var s = Math.round((b == null ? K.t(cl) : b) - a); return s < 120 ? s + "s" : K.age({ rt: cl.rt }, K.t(cl) - s); }
  var COLS = {
    Pod: { h: ["NAME", "READY", "STATUS", "RESTARTS", "AGE"], wide: ["IP", "NODE", "NOMINATED NODE", "READINESS GATES"], row: function (cl, p, w) { var cs = p.status.containerStatuses || []; var r = [p.metadata.name, cs.filter(function (s) { return s.ready; }).length + "/" + p.spec.containers.length, podStatus(p), restarts(cl, p), age(cl, p.metadata.creationTimestamp)]; if (w) r.push(p.status.podIP || "<none>", p.spec.nodeName || "<none>", "<none>", "<none>"); return r; } },
    Deployment: { h: ["NAME", "READY", "UP-TO-DATE", "AVAILABLE", "AGE"], wide: ["CONTAINERS", "IMAGES", "SELECTOR"], row: function (cl, d, w) { var s = d.status || {}; var r = [d.metadata.name, (s.readyReplicas || 0) + "/" + d.spec.replicas, s.updatedReplicas || 0, s.availableReplicas || 0, age(cl, d.metadata.creationTimestamp)]; if (w) { var im = images(d.spec.template.spec); r.push(im.c, im.i, K.selStr(d.spec.selector)); } return r; } },
    ReplicaSet: { h: ["NAME", "DESIRED", "CURRENT", "READY", "AGE"], wide: ["CONTAINERS", "IMAGES", "SELECTOR"], row: function (cl, d, w) { var s = d.status || {}; var r = [d.metadata.name, d.spec.replicas, s.replicas || 0, s.readyReplicas || 0, age(cl, d.metadata.creationTimestamp)]; if (w) { var im = images(d.spec.template.spec); r.push(im.c, im.i, K.selStr(d.spec.selector)); } return r; } },
    StatefulSet: { h: ["NAME", "READY", "AGE"], wide: ["CONTAINERS", "IMAGES"], row: function (cl, d, w) { var r = [d.metadata.name, ((d.status || {}).readyReplicas || 0) + "/" + d.spec.replicas, age(cl, d.metadata.creationTimestamp)]; if (w) { var im = images(d.spec.template.spec); r.push(im.c, im.i); } return r; } },
    DaemonSet: { h: ["NAME", "DESIRED", "CURRENT", "READY", "UP-TO-DATE", "AVAILABLE", "NODE SELECTOR", "AGE"], row: function (cl, d) { var s = d.status || {}; return [d.metadata.name, s.desiredNumberScheduled || 0, s.currentNumberScheduled || 0, s.numberReady || 0, s.updatedNumberScheduled || 0, s.numberAvailable || 0, keys(d.spec.template.spec.nodeSelector || {}).map(function (k) { return k + "=" + d.spec.template.spec.nodeSelector[k]; }).join(",") || "<none>", age(cl, d.metadata.creationTimestamp)]; } },
    Service: { h: ["NAME", "TYPE", "CLUSTER-IP", "EXTERNAL-IP", "PORT(S)", "AGE"], wide: ["SELECTOR"], row: function (cl, s, w) { var r = [s.metadata.name, s.spec.type, s.spec.clusterIP || "<none>", extIp(s), svcPorts(s), age(cl, s.metadata.creationTimestamp)]; if (w) r.push(s.spec.selector ? K.selStr(s.spec.selector) : "<none>"); return r; } },
    Endpoints: { h: ["NAME", "ENDPOINTS", "AGE"], row: function (cl, e) { var list = []; (e.subsets || []).forEach(function (ss) { (ss.addresses || []).forEach(function (a) { (ss.ports || []).forEach(function (p) { list.push(a.ip + ":" + p.port); }); }); }); return [e.metadata.name, list.length ? list.slice(0, 3).join(",") + (list.length > 3 ? " + " + (list.length - 3) + " more..." : "") : "<none>", age(cl, e.metadata.creationTimestamp)]; } },
    ConfigMap: { h: ["NAME", "DATA", "AGE"], row: function (cl, c) { return [c.metadata.name, keys(c.data || {}).length + keys(c.binaryData || {}).length, age(cl, c.metadata.creationTimestamp)]; } },
    Secret: { h: ["NAME", "TYPE", "DATA", "AGE"], row: function (cl, c) { return [c.metadata.name, c.type, keys(c.data || {}).length, age(cl, c.metadata.creationTimestamp)]; } },
    Namespace: { h: ["NAME", "STATUS", "AGE"], row: function (cl, n) { return [n.metadata.name, (n.status || {}).phase || "Active", age(cl, n.metadata.creationTimestamp)]; } },
    Node: { h: ["NAME", "STATUS", "ROLES", "AGE", "VERSION"], wide: ["INTERNAL-IP", "EXTERNAL-IP", "OS-IMAGE", "KERNEL-VERSION", "CONTAINER-RUNTIME"], row: function (cl, n, w) { var r = [n.metadata.name, "Ready" + (n.spec.unschedulable ? ",SchedulingDisabled" : ""), (n.metadata.labels || {})["node-role.kubernetes.io/control-plane"] ? "control-plane" : "<none>", age(cl, n.metadata.creationTimestamp), n.status.nodeInfo.kubeletVersion]; if (w) r.push(n.status.addresses[0].address, "<none>", n.status.nodeInfo.osImage, n.status.nodeInfo.kernelVersion, n.status.nodeInfo.containerRuntimeVersion); return r; } },
    PersistentVolumeClaim: { h: ["NAME", "STATUS", "VOLUME", "CAPACITY", "ACCESS MODES", "STORAGECLASS", "VOLUMEATTRIBUTESCLASS", "AGE"], row: function (cl, c) { var b = (c.status || {}).phase === "Bound"; return [c.metadata.name, (c.status || {}).phase || "Pending", c.spec.volumeName || "", b ? c.status.capacity.storage : "", b ? amodes(c.spec.accessModes) : "", c.spec.storageClassName || "", "<unset>", age(cl, c.metadata.creationTimestamp)]; } },
    PersistentVolume: { h: ["NAME", "CAPACITY", "ACCESS MODES", "RECLAIM POLICY", "STATUS", "CLAIM", "STORAGECLASS", "VOLUMEATTRIBUTESCLASS", "REASON", "AGE"], row: function (cl, v) { return [v.metadata.name, v.spec.capacity.storage, amodes(v.spec.accessModes), v.spec.persistentVolumeReclaimPolicy, (v.status || {}).phase, v.spec.claimRef ? v.spec.claimRef.namespace + "/" + v.spec.claimRef.name : "", v.spec.storageClassName || "", "<unset>", "", age(cl, v.metadata.creationTimestamp)]; } },
    ServiceAccount: { h: ["NAME", "SECRETS", "AGE"], row: function (cl, s) { return [s.metadata.name, (s.secrets || []).length, age(cl, s.metadata.creationTimestamp)]; } },
    Job: { h: ["NAME", "STATUS", "COMPLETIONS", "DURATION", "AGE"], wide: ["CONTAINERS", "IMAGES", "SELECTOR"], row: function (cl, j, w) { var s = j.status || {}; var r = [j.metadata.name, jobStatus(j), (s.succeeded || 0) + "/" + j.spec.completions, dur(cl, s.startTime, s.completionTime), age(cl, j.metadata.creationTimestamp)]; if (w) { var im = images(j.spec.template.spec); r.push(im.c, im.i, K.selStr(j.spec.selector)); } return r; } },
    CronJob: { h: ["NAME", "SCHEDULE", "TIMEZONE", "SUSPEND", "ACTIVE", "LAST SCHEDULE", "AGE"], row: function (cl, c) { var s = c.status || {}; return [c.metadata.name, c.spec.schedule, c.spec.timeZone || "<none>", c.spec.suspend ? "True" : "False", (s.active || []).length, s.lastScheduleTime != null ? age(cl, s.lastScheduleTime) : "<none>", age(cl, c.metadata.creationTimestamp)]; } },
    Ingress: { h: ["NAME", "CLASS", "HOSTS", "ADDRESS", "PORTS", "AGE"], row: function (cl, g) { var hosts = (g.spec.rules || []).map(function (r) { return r.host || "*"; }); var lb = ((g.status || {}).loadBalancer || {}).ingress; return [g.metadata.name, g.spec.ingressClassName || "<none>", hosts.join(",") || "*", lb ? lb.map(function (x) { return x.ip; }).join(",") : "", (g.spec.tls || []).length ? "80, 443" : "80", age(cl, g.metadata.creationTimestamp)]; } },
    IngressClass: { h: ["NAME", "CONTROLLER", "PARAMETERS", "AGE"], row: function (cl, c) { return [c.metadata.name, c.spec.controller, "<none>", age(cl, c.metadata.creationTimestamp)]; } },
    NetworkPolicy: { h: ["NAME", "POD-SELECTOR", "AGE"], row: function (cl, n) { return [n.metadata.name, K.emptySel(n.spec.podSelector) ? "<none>" : K.selStr(n.spec.podSelector), age(cl, n.metadata.creationTimestamp)]; } },
    HorizontalPodAutoscaler: { h: ["NAME", "REFERENCE", "TARGETS", "MINPODS", "MAXPODS", "REPLICAS", "AGE"], row: function (cl, h) { return [h.metadata.name, h.spec.scaleTargetRef.kind + "/" + h.spec.scaleTargetRef.name, hpaTargets(cl, h), h.spec.minReplicas, h.spec.maxReplicas, (h.status || {}).currentReplicas || 0, age(cl, h.metadata.creationTimestamp)]; } },
    PodDisruptionBudget: { h: ["NAME", "MIN AVAILABLE", "MAX UNAVAILABLE", "ALLOWED DISRUPTIONS", "AGE"], row: function (cl, p) { return [p.metadata.name, p.spec.minAvailable != null ? p.spec.minAvailable : "N/A", p.spec.maxUnavailable != null ? p.spec.maxUnavailable : "N/A", (p.status || {}).disruptionsAllowed || 0, age(cl, p.metadata.creationTimestamp)]; } },
    Role: { h: ["NAME", "CREATED AT"], row: function (cl, r) { return [r.metadata.name, K.stamp(cl, r.metadata.creationTimestamp)]; } },
    ClusterRole: { h: ["NAME", "CREATED AT"], row: function (cl, r) { return [r.metadata.name, K.stamp(cl, r.metadata.creationTimestamp)]; } },
    RoleBinding: { h: ["NAME", "ROLE", "AGE"], wide: ["USERS", "GROUPS", "SERVICEACCOUNTS"], row: function (cl, b, w) { var r = [b.metadata.name, b.roleRef.kind + "/" + b.roleRef.name, age(cl, b.metadata.creationTimestamp)]; if (w) { var s = b.subjects || []; r.push(s.filter(function (x) { return x.kind === "User"; }).map(function (x) { return x.name; }).join(", "), s.filter(function (x) { return x.kind === "Group"; }).map(function (x) { return x.name; }).join(", "), s.filter(function (x) { return x.kind === "ServiceAccount"; }).map(function (x) { return x.namespace + "/" + x.name; }).join(", ")); } return r; } },
    ClusterRoleBinding: { h: ["NAME", "ROLE", "AGE"], row: function (cl, b) { return [b.metadata.name, b.roleRef.kind + "/" + b.roleRef.name, age(cl, b.metadata.creationTimestamp)]; } },
    StorageClass: { h: ["NAME", "PROVISIONER", "RECLAIMPOLICY", "VOLUMEBINDINGMODE", "ALLOWVOLUMEEXPANSION", "AGE"], row: function (cl, s) { return [s.metadata.name + ((s.metadata.annotations || {})["storageclass.kubernetes.io/is-default-class"] === "true" ? " (default)" : ""), s.provisioner, s.reclaimPolicy || "Delete", s.volumeBindingMode || "Immediate", s.allowVolumeExpansion ? "true" : "false", age(cl, s.metadata.creationTimestamp)]; } },
    Certificate: { h: ["NAME", "READY", "SECRET", "AGE"], row: function (cl, c) { var rd = ((c.status || {}).conditions || []).filter(function (x) { return x.type === "Ready"; })[0]; return [c.metadata.name, rd ? rd.status : "", c.spec.secretName, age(cl, c.metadata.creationTimestamp)]; } },
    ClusterIssuer: { h: ["NAME", "READY", "AGE"], row: function (cl, c) { return [c.metadata.name, "True", age(cl, c.metadata.creationTimestamp)]; } },
    ResourceQuota: { h: ["NAME", "AGE", "REQUEST", "LIMIT"], row: function (cl, q) { return [q.metadata.name, age(cl, q.metadata.creationTimestamp), "", ""]; } },
    LimitRange: { h: ["NAME", "CREATED AT"], row: function (cl, q) { return [q.metadata.name, K.stamp(cl, q.metadata.creationTimestamp)]; } }
  };
  function amodes(m) { return (m || []).map(function (x) { return { ReadWriteOnce: "RWO", ReadOnlyMany: "ROX", ReadWriteMany: "RWX", ReadWriteOncePod: "RWOP" }[x] || x; }).join(","); }
  KC.COLS = COLS;
  KC.podRestarts = restarts;

  // turn args like "pods", "pod/x", "deploy x y", "po,svc", "all" into [{info, names}]
  KC.targets = function (cl, pos, io, verbName) {
    var res = [], first = pos[0];
    if (!first) return { error: "You must specify the type of resource to " + (verbName || "get") + ". Use \"kubectl api-resources\" for a complete list of supported resources." };
    if (/\//.test(first)) {
      for (var i = 0; i < pos.length; i++) {
        var sp = pos[i].split("/"), inf = K.kindOf(cl, sp[0]);
        if (!inf) return { error: "error: the server doesn't have a resource type \"" + sp[0] + "\"" };
        res.push({ info: inf, names: [sp.slice(1).join("/")] });
      }
      return { list: res };
    }
    var words = first.split(",");
    for (var j = 0; j < words.length; j++) {
      var w = words[j];
      if (w === "all") { ["Pod", "Service", "DaemonSet", "Deployment", "ReplicaSet", "StatefulSet", "Job", "CronJob", "HorizontalPodAutoscaler"].forEach(function (k) { res.push({ info: K.KINDS[k], names: [], all: true }); }); continue; }
      var info = K.kindOf(cl, w);
      if (!info) return { error: "error: the server doesn't have a resource type \"" + w + "\"" };
      res.push({ info: info, names: pos.slice(1) });
    }
    if (words.length > 1 && pos.length > 1) return { error: "error: arguments in resource/name form must have a single resource and name" };
    return { list: res };
  };

  /* ================================================================== kubectl get */
  KC.get = function (o, io, sess) {
    var C = KC.ctx(sess, o, io); if (!C) return 1;
    var cl = C.cl, tg = KC.targets(cl, o.pos, io);
    if (tg.error) { errl(io, tg.error); return 1; }
    var nsAll = !!o["all-namespaces"], outFmt = o.output || "", wide = outFmt === "wide";
    var sel = null; if (o.selector) { var ps = K.parseSel(o.selector); if (ps.error) { errl(io, "error: " + ps.error); return 1; } sel = ps.test; }
    var fsel = null; if (o["field-selector"]) { var fm = /^([\w.]+)(!?=)(.*)$/.exec(o["field-selector"]); if (fm) fsel = function (x) { var v = jpGet(KC.wire(cl, x), "." + fm[1])[0]; return fm[2] === "=" ? String(v) === fm[3] : String(v) !== fm[3]; }; }
    var many = tg.list.length > 1, groups = [], code = 0, errs = [];
    for (var i = 0; i < tg.list.length; i++) {
      var t = tg.list[i], info = t.info, k = info.kind;
      var ns = info.ns ? (nsAll ? null : C.ns) : null;
      if (!K.can(cl, C.sub, t.names.length ? "get" : "list", info.plural, info.group, ns, t.names[0])) { errl(io, K.forbidden(C.sub, t.names.length ? "get" : "list", info, ns || (nsAll ? null : C.ns), t.names.length === 1 ? t.names[0] : null)); return 1; }
      var items;
      if (k === "Event") items = null;
      if (t.names.length) { items = []; t.names.forEach(function (n) { var x = K.get(cl, k, ns || C.ns, n); if (x) items.push(x); else { if (!o["ignore-not-found"]) errs.push("Error from server (NotFound): " + info.plural + (info.group ? "." + info.group : "") + " \"" + n + "\" not found"); code = 1; } }); }
      else if (k === "Event") items = KC.eventObjs(cl, ns);
      else items = K.list(cl, k, ns, sel);
      if (sel && t.names.length) items = items.filter(function (x) { return sel(x.metadata.labels); });
      if (fsel) items = items.filter(fsel);
      groups.push({ info: info, items: items, all: t.all });
    }
    var total = groups.reduce(function (n, g) { return n + g.items.length; }, 0);
    if (/^(yaml|json)$/.test(outFmt) || /^jsonpath/.test(outFmt) || /^custom-columns/.test(outFmt) || outFmt === "name" || /^go-template/.test(outFmt)) {
      var objs = []; groups.forEach(function (g) { g.items.forEach(function (x) { objs.push(KC.wire(cl, x)); }); });
      var single = !many && o.pos.length > 1 && objs.length === 1 && !/,/.test(o.pos[0]) || (/\//.test(o.pos[0] || "") && objs.length === 1);
      var doc = single ? objs[0] : { apiVersion: "v1", items: objs, kind: "List", metadata: { resourceVersion: "" } };
      if (outFmt === "yaml") out(io, KC.yaml(doc));
      else if (outFmt === "json") out(io, JSON.stringify(doc, null, 4) + "\n");
      else if (outFmt === "name") groups.forEach(function (g) { g.items.forEach(function (x) { out(io, KC.ref(g.info, x.metadata.name) + "\n"); }); });
      else if (/^jsonpath/.test(outFmt)) { var jp = KC.jsonpath(outFmt.replace(/^jsonpath(-as-json)?=/, ""), doc); if (jp.error) { errl(io, jp.error); return 1; } out(io, jp.text); }
      else if (/^custom-columns=/.test(outFmt)) {
        var cols = outFmt.replace(/^custom-columns=/, "").split(",").map(function (c) { var p = c.split(":"); return { h: p[0], path: p.slice(1).join(":") }; });
        var rows = o["no-headers"] ? [] : [cols.map(function (c) { return c.h; })];
        objs.forEach(function (x) { rows.push(cols.map(function (c) { var v = jpGet(x, c.path.replace(/^\./, ".").replace(/^([^.[])/, ".$1")); return v.length ? v.map(jpStr).join(",") : "<none>"; })); });
        out(io, KC.table(rows));
      } else { errl(io, "error: unable to match a printer suitable for the output format \"" + outFmt + "\", allowed formats are: custom-columns,custom-columns-file,go-template,go-template-file,json,jsonpath,jsonpath-as-json,jsonpath-file,name,template,templatefile,wide,yaml"); return 1; }
      errs.forEach(function (e) { errl(io, e); });
      return code;
    }
    if (outFmt && outFmt !== "wide") { errl(io, "error: unable to match a printer suitable for the output format \"" + outFmt + "\", allowed formats are: custom-columns,custom-columns-file,go-template,go-template-file,json,jsonpath,jsonpath-as-json,jsonpath-file,name,template,templatefile,wide,yaml"); return 1; }
    errs.forEach(function (e) { errl(io, e); });
    if (!total) {
      if (errs.length) return code;
      var anyNs = groups.some(function (g) { return g.info.ns; });
      errl(io, anyNs && !nsAll ? "No resources found in " + C.ns + " namespace." : "No resources found");
      return code;
    }
    var blocks = [];
    groups.forEach(function (g) {
      if (!g.items.length) return;
      var info = g.info, spec = COLS[info.kind];
      if (info.kind === "Event") { blocks.push(KC.eventTable(cl, g.items, nsAll)); return; }
      if (!spec) spec = { h: ["NAME", "AGE"], row: function (c2, x) { return [x.metadata.name, age(c2, x.metadata.creationTimestamp)]; } };
      if (info.crd && K.printers && K.printers[info.kind]) spec = K.printers[info.kind];
      var head = spec.h.concat(wide && spec.wide ? spec.wide : []);
      var prefix = many || g.all || (o.pos.length === 1 && /\//.test(o.pos[0])) ? KC.ref(info, "") : "";
      if (g.all || many) prefix = KC.ref(info, "");
      var rows = [];
      if (!o["no-headers"]) rows.push((nsAll && info.ns ? ["NAMESPACE"] : []).concat(head).concat(o["show-labels"] ? ["LABELS"] : []));
      g.items.forEach(function (x) {
        var r = spec.row(cl, x, wide);
        r[0] = prefix + r[0];
        if (nsAll && info.ns) r.unshift(x.metadata.namespace);
        if (o["show-labels"]) r.push(keys(x.metadata.labels || {}).sort().map(function (k) { return k + "=" + x.metadata.labels[k]; }).join(",") || "<none>");
        rows.push(r);
      });
      blocks.push(KC.table(rows));
    });
    out(io, blocks.join("\n"));
    if (o.watch) { if (io.note) io.note("(kubectl get -w keeps watching for changes until you press Ctrl+C. The lab printed the current state: run the command again, or use kubectl rollout status / kubectl wait to wait for something.)"); }
    return code;
  };

  /* ---------------- events */
  KC.eventObjs = function (cl, ns) {
    return cl.events.filter(function (e) { return !ns || e.ns === ns; }).map(function (e) {
      var o = { apiVersion: "v1", kind: "Event", metadata: { name: e.name + "." + e.id, namespace: e.ns, creationTimestamp: e.first, uid: e.id }, involvedObject: { kind: e.kind, name: e.name, namespace: e.ns, uid: e.uid }, reason: e.reason, message: e.message, type: e.type, count: e.count, firstTimestamp: K.stamp(cl, e.first), lastTimestamp: K.stamp(cl, e.last), source: { component: e.source } };
      Object.defineProperty(o, "_e", { value: e, enumerable: false }); return o;
    });
  };
  KC.eventTable = function (cl, items, nsAll) {
    var rows = [(nsAll ? ["NAMESPACE"] : []).concat(["LAST SEEN", "TYPE", "REASON", "OBJECT", "MESSAGE"])];
    items.slice().sort(function (a, b) { return a._e.last - b._e.last; }).forEach(function (x) { var e = x._e, kind = e.kind.toLowerCase(); rows.push((nsAll ? [e.ns] : []).concat([age(cl, e.last), e.type, e.reason, kind + "/" + e.name, e.message])); });
    return KC.table(rows);
  };
  KC.events = function (o, io, sess) {
    var C = KC.ctx(sess, o, io); if (!C) return 1;
    var items = KC.eventObjs(C.cl, o["all-namespaces"] ? null : C.ns);
    if (o.for) { var sp = o.for.split("/"), inf = K.kindOf(C.cl, sp[0]); items = items.filter(function (x) { return inf && x._e.kind === inf.kind && x._e.name === sp[1]; }); }
    if (o.types) items = items.filter(function (x) { return o.types.split(",").indexOf(x._e.type) >= 0; });
    if (!items.length) { errl(io, "No events found in " + C.ns + " namespace."); return 0; }
    out(io, KC.eventTable(C.cl, items, !!o["all-namespaces"]));
    return 0;
  };
  function eventsBlock(cl, obj) {
    var ev = K.eventsFor(cl, obj);
    if (!ev.length) return "Events:                      <none>\n";
    var rows = [["Type", "Reason", "Age", "From", "Message"], ["----", "------", "----", "----", "-------"]];
    ev.slice(-20).forEach(function (e) { rows.push([e.type, e.reason, e.count > 1 ? age(cl, e.last) + " (x" + e.count + " over " + age(cl, e.first) + ")" : age(cl, e.first), e.source, e.message]); });
    return "Events:\n" + KC.table(rows).split("\n").map(function (l) { return l ? "  " + l : l; }).join("\n");
  }
  KC.eventsBlock = eventsBlock;

  /* ================================================================== describe */
  function date(cl, t) { var d = new Date(Dk.stamp(cl.rt, t)); var D = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"], Mo = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"], p = function (n) { return ("0" + n).slice(-2); }; return D[d.getUTCDay()] + ", " + p(d.getUTCDate()) + " " + Mo[d.getUTCMonth()] + " " + d.getUTCFullYear() + " " + p(d.getUTCHours()) + ":" + p(d.getUTCMinutes()) + ":" + p(d.getUTCSeconds()) + " +0000"; }
  KC.date = date;
  function kv(m, ind) { var ks = keys(m || {}).sort(); if (!ks.length) return "<none>"; return ks.map(function (k, i) { return (i ? pad(ind) : "") + k + "=" + m[k]; }).join("\n"); }
  function pad(n) { return new Array(n + 1).join(" "); }
  function line(label, val, w) { w = w || 22; var l = label + ":"; return l + pad(Math.max(1, w - l.length)) + val + "\n"; }
  function probeStr(p) { var h = p.httpGet ? "http-get " + p.httpGet.scheme.toLowerCase() + "://:" + p.httpGet.port + p.httpGet.path : p.tcpSocket ? "tcp-socket :" + p.tcpSocket.port : p.exec ? "exec [" + (p.exec.command || []).join(" ") + "]" : "grpc"; return h + " delay=" + (p.initialDelaySeconds || 0) + "s timeout=" + p.timeoutSeconds + "s period=" + p.periodSeconds + "s #success=" + p.successThreshold + " #failure=" + p.failureThreshold; }
  function ctrBlock(cl, c, st, ind, pod) {
    var s = "", P = pad(ind), w = 22;
    function L(label, val) { s += P + line(label, val, w); }
    s += pad(ind - 2) + c.name + ":\n";
    if (st && st.containerID) L("Container ID", st.containerID);
    L("Image", c.image);
    if (st) L("Image ID", st.imageID || "");
    var ports = (c.ports || []).map(function (p) { return p.containerPort + "/" + p.protocol; });
    L("Port", ports.length ? ports.join(", ") : "<none>");
    L("Host Port", ports.length ? ports.map(function (p) { return "0/" + p.split("/")[1]; }).join(", ") : "<none>");
    if (c.command) { s += P + "Command:\n"; c.command.forEach(function (x) { s += P + "  " + x + "\n"; }); }
    if (c.args) { s += P + "Args:\n"; c.args.forEach(function (x) { s += P + "  " + x + "\n"; }); }
    if (st) {
      var stt = st.state, k = keys(stt)[0], v = stt[k] || {};
      L("State", k.charAt(0).toUpperCase() + k.slice(1));
      if (v.reason) L("  Reason", v.reason);
      if (k === "terminated") L("  Exit Code", v.exitCode);
      if (v.startedAt != null) L("  Started", date(cl, v.startedAt));
      if (v.finishedAt != null) L("  Finished", date(cl, v.finishedAt));
      var lt = (st.lastState || {}).terminated;
      if (lt) { L("Last State", "Terminated"); L("  Reason", lt.reason); L("  Exit Code", lt.exitCode); L("  Started", date(cl, lt.startedAt)); L("  Finished", date(cl, lt.finishedAt)); }
      L("Ready", st.ready ? "True" : "False");
      L("Restart Count", st.restartCount);
    }
    var r = c.resources || {};
    if (keys(r.limits || {}).length) { s += P + "Limits:\n"; keys(r.limits).forEach(function (q) { s += P + "  " + q + ":" + pad(Math.max(1, w - 3 - q.length)) + r.limits[q] + "\n"; }); }
    if (keys(r.requests || {}).length) { s += P + "Requests:\n"; keys(r.requests).forEach(function (q) { s += P + "  " + q + ":" + pad(Math.max(1, w - 3 - q.length)) + r.requests[q] + "\n"; }); }
    if (c.livenessProbe) L("Liveness", probeStr(c.livenessProbe));
    if (c.readinessProbe) L("Readiness", probeStr(c.readinessProbe));
    if (c.startupProbe) L("Startup", probeStr(c.startupProbe));
    if ((c.envFrom || []).length) { s += P + "Environment Variables from:\n"; c.envFrom.forEach(function (e) { var x = e.configMapRef ? [e.configMapRef.name, "ConfigMap"] : [e.secretRef.name, "Secret"]; s += P + "  " + x[0] + pad(Math.max(2, 14 - x[0].length)) + x[1] + "  Optional: false\n"; }); }
    if ((c.env || []).length) { s += P + "Environment:\n"; c.env.forEach(function (e) { var vf = e.valueFrom; s += P + "  " + e.name + ":" + pad(Math.max(1, 20 - e.name.length)) + (vf ? (vf.secretKeyRef ? "<set to the key '" + vf.secretKeyRef.key + "' in secret '" + vf.secretKeyRef.name + "'>  Optional: false" : vf.configMapKeyRef ? "<set to the key '" + vf.configMapKeyRef.key + "' of config map '" + vf.configMapKeyRef.name + "'>  Optional: false" : vf.fieldRef ? " (v1:" + vf.fieldRef.fieldPath + ")" : "") : e.value) + "\n"; }); }
    else L("Environment", "<none>");
    var mounts = (c.volumeMounts || []).map(function (m) { return m.mountPath + " from " + m.name + " (" + (m.readOnly ? "ro" : "rw") + (m.subPath ? ",path=\"" + m.subPath + "\"" : "") + ")"; });
    if (pod) { var sa = K.get(cl, "ServiceAccount", pod.metadata.namespace, pod.spec.serviceAccountName || "default"); if (pod.spec.automountServiceAccountToken !== false && !(sa && sa.automountServiceAccountToken === false)) mounts.push("/var/run/secrets/kubernetes.io/serviceaccount from kube-api-access-" + K.rand("kaa" + pod.metadata.uid, 5) + " (ro)"); }
    s += P + "Mounts:" + (mounts.length ? "\n" + mounts.map(function (m) { return P + "  " + m; }).join("\n") + "\n" : pad(w - 7) + "<none>\n");
    var sc = c.securityContext; if (sc) void sc;
    return s;
  }
  function podTemplateBlock(cl, tpl, ind) {
    var s = "", P = pad(ind);
    s += P + line("Labels", kv((tpl.metadata || {}).labels, ind + 18), 18);
    if (keys((tpl.metadata || {}).annotations || {}).length) s += P + line("Annotations", kv(tpl.metadata.annotations, ind + 18), 18);
    if (tpl.spec.serviceAccountName && tpl.spec.serviceAccountName !== "default") s += P + line("Service Account", tpl.spec.serviceAccountName, 18);
    if ((tpl.spec.initContainers || []).length) { s += P + "Init Containers:\n"; tpl.spec.initContainers.forEach(function (c) { s += ctrBlock(cl, c, null, ind + 4); }); }
    s += P + "Containers:\n";
    tpl.spec.containers.forEach(function (c) { s += ctrBlock(cl, c, null, ind + 4); });
    s += volumesBlock(tpl.spec, ind);
    if (tpl.spec.nodeSelector) s += P + line("Node-Selectors", kv(tpl.spec.nodeSelector, ind + 18), 18);
    return s;
  }
  function volumesBlock(spec, ind) {
    var P = pad(ind), vs = spec.volumes || [];
    if (!vs.length) return P + line("Volumes", "<none>", 18);
    var s = P + "Volumes:\n";
    vs.forEach(function (v) {
      s += P + "  " + v.name + ":\n";
      if (v.configMap) s += P + "    Type:      ConfigMap (a volume populated by a ConfigMap)\n" + P + "    Name:      " + v.configMap.name + "\n" + P + "    Optional:  false\n";
      else if (v.secret) s += P + "    Type:        Secret (a volume populated by a Secret)\n" + P + "    SecretName:  " + v.secret.secretName + "\n" + P + "    Optional:    false\n";
      else if (v.emptyDir) s += P + "    Type:       EmptyDir (a temporary directory that shares a pod's lifetime)\n" + P + "    Medium:     " + (v.emptyDir.medium || "") + "\n" + P + "    SizeLimit:  " + (v.emptyDir.sizeLimit || "<unset>") + "\n";
      else if (v.persistentVolumeClaim) s += P + "    Type:       PersistentVolumeClaim (a reference to a PersistentVolumeClaim in the same namespace)\n" + P + "    ClaimName:  " + v.persistentVolumeClaim.claimName + "\n" + P + "    ReadOnly:   " + !!v.persistentVolumeClaim.readOnly + "\n";
      else if (v.hostPath) s += P + "    Type:          HostPath (bare host directory volume)\n" + P + "    Path:          " + v.hostPath.path + "\n";
    });
    return s;
  }
  var DESC = {};
  DESC.Pod = function (cl, p) {
    var s = "", L = function (a, b) { s += line(a, b, 14); };
    L("Name", p.metadata.name); L("Namespace", p.metadata.namespace); L("Priority", 0); L("Service Account", p.spec.serviceAccountName || "default");
    L("Node", p.spec.nodeName ? p.spec.nodeName + "/" + K.nodeIp(cl, p.spec.nodeName) : "<none>");
    L("Start Time", p.status.startTime != null ? date(cl, p.status.startTime) : "<unset>");
    L("Labels", kv(p.metadata.labels, 14)); L("Annotations", kv(p.metadata.annotations, 14));
    L("Status", p.metadata.deletionTimestamp != null ? "Terminating (lasts " + age(cl, p.metadata.deletionTimestamp) + ")" : p.status.phase);
    if (p.metadata.deletionTimestamp != null) L("Termination Grace Period", p.spec.terminationGracePeriodSeconds + "s");
    L("IP", p.status.podIP || ""); s += "IPs:" + (p.status.podIP ? "\n  IP:  " + p.status.podIP + "\n" : "           <none>\n");
    var own = (p.metadata.ownerReferences || [])[0]; L("Controlled By", own ? own.kind + "/" + own.name : "<none>");
    if ((p.spec.initContainers || []).length) { s += "Init Containers:\n"; p.spec.initContainers.forEach(function (c) { s += ctrBlock(cl, c, (p.status.initContainerStatuses || []).filter(function (x) { return x.name === c.name; })[0], 4, p); }); }
    s += "Containers:\n";
    p.spec.containers.forEach(function (c) { s += ctrBlock(cl, c, (p.status.containerStatuses || []).filter(function (x) { return x.name === c.name; })[0], 4, p); });
    s += "Conditions:\n  Type                        Status\n";
    (p.status.conditions || []).forEach(function (c) { s += "  " + c.type + pad(Math.max(1, 28 - c.type.length)) + c.status + " \n"; });
    s += volumesBlock(p.spec, 0).replace(/^Volumes:\n/, "Volumes:\n");
    var sa = K.get(cl, "ServiceAccount", p.metadata.namespace, p.spec.serviceAccountName || "default");
    if (p.spec.automountServiceAccountToken !== false && !(sa && sa.automountServiceAccountToken === false)) { if (!(p.spec.volumes || []).length) s = s.replace(/Volumes:\s+<none>\n$/, "Volumes:\n"); s += "  kube-api-access-" + K.rand("kaa" + p.metadata.uid, 5) + ":\n    Type:                    Projected (a volume that contains injected data from multiple sources)\n    TokenExpirationSeconds:  3607\n    ConfigMapName:           kube-root-ca.crt\n    ConfigMapOptional:       <nil>\n    DownwardAPI:             true\n"; }
    L("QoS Class", p.status.qosClass || "BestEffort");
    L("Node-Selectors", kv(p.spec.nodeSelector, 14));
    s += "Tolerations:                 node.kubernetes.io/not-ready:NoExecute op=Exists for 300s\n                             node.kubernetes.io/unreachable:NoExecute op=Exists for 300s\n";
    return s + eventsBlock(cl, p);
  };
  DESC.Deployment = function (cl, d) {
    var s = "", L = function (a, b) { s += line(a, b, 24); }, st = d.status || {};
    L("Name", d.metadata.name); L("Namespace", d.metadata.namespace); L("CreationTimestamp", date(cl, d.metadata.creationTimestamp)); L("Labels", kv(d.metadata.labels, 24));
    L("Annotations", kv(Object.assign({ "deployment.kubernetes.io/revision": String(Math.max.apply(null, [0].concat(K.ownedBy(cl, d, "ReplicaSet").map(K.rsRevision)))) }, Object.keys(d.metadata.annotations || {}).filter(function (k) { return k !== "kubectl.kubernetes.io/last-applied-configuration"; }).reduce(function (m, k) { m[k] = d.metadata.annotations[k]; return m; }, {})), 24));
    L("Selector", K.selStr(d.spec.selector));
    L("Replicas", d.spec.replicas + " desired | " + (st.updatedReplicas || 0) + " updated | " + (st.replicas || 0) + " total | " + (st.availableReplicas || 0) + " available | " + (st.unavailableReplicas || 0) + " unavailable");
    L("StrategyType", d.spec.strategy.type); L("MinReadySeconds", d.spec.minReadySeconds || 0);
    if (d.spec.strategy.rollingUpdate) L("RollingUpdateStrategy", d.spec.strategy.rollingUpdate.maxUnavailable + " max unavailable, " + d.spec.strategy.rollingUpdate.maxSurge + " max surge");
    s += "Pod Template:\n" + podTemplateBlock(cl, d.spec.template, 2);
    s += "Conditions:\n  Type           Status  Reason\n  ----           ------  ------\n";
    (st.conditions || []).forEach(function (c) { s += "  " + c.type + pad(15 - c.type.length) + c.status + pad(8 - c.status.length) + c.reason + "\n"; });
    var rss = K.ownedBy(cl, d, "ReplicaSet"), cur = rss.filter(function (r) { return r.metadata.labels["pod-template-hash"] === K.tplHash(d.spec.template); })[0];
    var olds = rss.filter(function (r) { return r !== cur && r.spec.replicas > 0; });
    L("OldReplicaSets", olds.length ? olds.map(function (r) { return r.metadata.name + " (" + (r.status.replicas || 0) + "/" + r.spec.replicas + " replicas created)"; }).join(", ") : "<none>");
    L("NewReplicaSet", cur ? cur.metadata.name + " (" + ((cur.status || {}).replicas || 0) + "/" + cur.spec.replicas + " replicas created)" : "<none>");
    return s + eventsBlock(cl, d);
  };
  DESC.ReplicaSet = function (cl, r) {
    var s = "", L = function (a, b) { s += line(a, b, 14); }, st = r.status || {}, pods = K.ownedBy(cl, r, "Pod");
    L("Name", r.metadata.name); L("Namespace", r.metadata.namespace); L("Selector", K.selStr(r.spec.selector)); L("Labels", kv(r.metadata.labels, 14)); L("Annotations", kv(r.metadata.annotations, 14));
    var own = (r.metadata.ownerReferences || [])[0]; L("Controlled By", own ? own.kind + "/" + own.name : "<none>");
    L("Replicas", (st.replicas || 0) + " current / " + r.spec.replicas + " desired");
    L("Pods Status", pods.filter(function (p) { return p.status.phase === "Running"; }).length + " Running / " + pods.filter(function (p) { return p.status.phase === "Pending"; }).length + " Waiting / " + pods.filter(function (p) { return p.status.phase === "Succeeded"; }).length + " Succeeded / " + pods.filter(function (p) { return p.status.phase === "Failed"; }).length + " Failed");
    s += "Pod Template:\n" + podTemplateBlock(cl, r.spec.template, 2);
    return s + eventsBlock(cl, r);
  };
  DESC.Service = function (cl, sv) {
    var s = "", L = function (a, b) { s += line(a, b, 25); }, ep = K.endpointsOf(cl, sv);
    L("Name", sv.metadata.name); L("Namespace", sv.metadata.namespace); L("Labels", kv(sv.metadata.labels, 25)); L("Annotations", kv(sv.metadata.annotations, 25));
    L("Selector", sv.spec.selector ? K.selStr(sv.spec.selector) : "<none>"); L("Type", sv.spec.type); L("IP Family Policy", "SingleStack"); L("IP Families", "IPv4"); L("IP", sv.spec.clusterIP || "None"); L("IPs", sv.spec.clusterIP || "None");
    if (sv.spec.type === "LoadBalancer") L("LoadBalancer Ingress", extIp(sv) === "<pending>" ? "" : extIp(sv) + " (VIP)");
    (sv.spec.ports || []).forEach(function (p) {
      L("Port", (p.name || "<unset>") + "  " + p.port + "/" + p.protocol);
      L("TargetPort", p.targetPort + "/" + p.protocol);
      if (p.nodePort && sv.spec.type !== "ClusterIP") L("NodePort", (p.name || "<unset>") + "  " + p.nodePort + "/" + p.protocol);
      L("Endpoints", ep.length ? ep.map(function (x) { return x.status.podIP + ":" + (K.targetPort(p, x) || p.targetPort); }).join(",") : "");
    });
    L("Session Affinity", "None");
    if (sv.spec.type !== "ClusterIP") L("External Traffic Policy", "Cluster");
    L("Internal Traffic Policy", "Cluster");
    return s + eventsBlock(cl, sv);
  };
  DESC.Node = function (cl, n) {
    var s = "", L = function (a, b) { s += line(a, b, 20); }, u = K.nodeUsage(cl, n.metadata.name);
    L("Name", n.metadata.name); L("Roles", (n.metadata.labels || {})["node-role.kubernetes.io/control-plane"] ? "control-plane" : "<none>"); L("Labels", kv(n.metadata.labels, 20)); L("CreationTimestamp", date(cl, n.metadata.creationTimestamp));
    L("Taints", (n.spec.taints || []).map(function (t) { return t.key + ":" + t.effect; }).join("\n" + pad(20)) || "<none>"); L("Unschedulable", !!n.spec.unschedulable);
    s += "Addresses:\n  InternalIP:  " + n.status.addresses[0].address + "\n  Hostname:    " + n.metadata.name + "\n";
    s += "Capacity:\n  cpu:                " + n.status.capacity.cpu + "\n  memory:             " + n.status.capacity.memory + "\n  pods:               110\n";
    s += "Allocatable:\n  cpu:                " + n.status.allocatable.cpu + "\n  memory:             " + n.status.allocatable.memory + "\n  pods:               110\n";
    var pods = K.all(cl, "Pod").filter(function (p) { return p.spec.nodeName === n.metadata.name && !/^(Succeeded|Failed)$/.test(p.status.phase); });
    s += "Non-terminated Pods:          (" + pods.length + " in total)\n";
    var rows = [["Namespace", "Name", "CPU Requests", "CPU Limits", "Memory Requests", "Memory Limits", "Age"], ["---------", "----", "------------", "----------", "---------------", "-------------", "---"]];
    pods.forEach(function (p) { var rq = K.podRequests(p); rows.push([p.metadata.namespace, p.metadata.name, rq.cpu + "m (" + Math.round(rq.cpu / 20) + "%)", "0 (0%)", K.memStr(rq.mem) + " (" + Math.round(rq.mem / K.mem(n.status.allocatable.memory) * 100) + "%)", "0 (0%)", age(cl, p.metadata.creationTimestamp)]); });
    s += KC.table(rows).split("\n").map(function (l) { return l ? "  " + l : l; }).join("\n");
    s += "Allocated resources:\n  (Total limits may be over 100 percent, i.e., overcommitted.)\n  Resource           Requests     Limits\n  --------           --------     ------\n  cpu                " + u.cpu + "m (" + Math.round(u.cpu / 20) + "%)" + pad(Math.max(1, 13 - (u.cpu + "m (" + Math.round(u.cpu / 20) + "%)").length)) + "0 (0%)\n  memory             " + K.memStr(u.mem) + " (" + Math.round(u.mem / K.mem(n.status.allocatable.memory) * 100) + "%)" + pad(4) + "0 (0%)\n";
    return s + eventsBlock(cl, n);
  };
  DESC.PersistentVolumeClaim = function (cl, c) {
    var s = "", L = function (a, b) { s += line(a, b, 15); }, users = K.list(cl, "Pod", c.metadata.namespace).filter(function (p) { return (p.spec.volumes || []).some(function (v) { return v.persistentVolumeClaim && v.persistentVolumeClaim.claimName === c.metadata.name; }); });
    L("Name", c.metadata.name); L("Namespace", c.metadata.namespace); L("StorageClass", c.spec.storageClassName || ""); L("Status", c.status.phase); L("Volume", c.spec.volumeName || ""); L("Labels", kv(c.metadata.labels, 15)); L("Annotations", kv(c.metadata.annotations, 15)); L("Finalizers", "[kubernetes.io/pvc-protection]");
    L("Capacity", c.status.phase === "Bound" ? c.status.capacity.storage : ""); L("Access Modes", c.status.phase === "Bound" ? amodes(c.spec.accessModes) : ""); L("VolumeMode", "Filesystem");
    L("Used By", users.length ? users.map(function (p) { return p.metadata.name; }).join("\n" + pad(15)) : "<none>");
    return s + eventsBlock(cl, c);
  };
  DESC.HorizontalPodAutoscaler = function (cl, h) {
    var s = "", L = function (a, b) { s += line(a, b, 56); }, st = h.status || {}, cur = (((st.currentMetrics || [])[0] || { resource: { current: {} } }).resource.current);
    L("Name", h.metadata.name); L("Namespace", h.metadata.namespace); L("Labels", kv(h.metadata.labels, 56)); L("Annotations", "<none>"); L("CreationTimestamp", date(cl, h.metadata.creationTimestamp));
    L("Reference", h.spec.scaleTargetRef.kind + "/" + h.spec.scaleTargetRef.name);
    var m = (h.spec.metrics || [])[0];
    s += "Metrics:                                               ( current / target )\n";
    if (m) s += "  resource cpu on pods  (as a percentage of request):  " + (cur.averageUtilization == null ? "<unknown>" : cur.averageUtilization + "% (" + cur.averageValue + ")") + " / " + m.resource.target.averageUtilization + "%\n";
    L("Min replicas", h.spec.minReplicas); L("Max replicas", h.spec.maxReplicas);
    L(h.spec.scaleTargetRef.kind + " pods", (st.currentReplicas || 0) + " current / " + (st.desiredReplicas || 0) + " desired");
    s += "Conditions:\n  Type            Status  Reason              Message\n  ----            ------  ------              -------\n";
    (st.conditions || []).forEach(function (c) { s += "  " + c.type + pad(16 - c.type.length) + c.status + pad(8 - c.status.length) + c.reason + pad(Math.max(1, 20 - c.reason.length)) + c.message + "\n"; });
    return s + eventsBlock(cl, h);
  };
  DESC.Ingress = function (cl, g) {
    var s = "", L = function (a, b) { s += line(a, b, 18); };
    L("Name", g.metadata.name); L("Labels", kv(g.metadata.labels, 18)); L("Namespace", g.metadata.namespace); L("Address", (((g.status || {}).loadBalancer || {}).ingress || []).map(function (x) { return x.ip; }).join(",")); L("Ingress Class", g.spec.ingressClassName || "<none>"); L("Default backend", "<default>");
    if ((g.spec.tls || []).length) { s += "TLS:\n"; g.spec.tls.forEach(function (t) { s += "  " + t.secretName + " terminates " + (t.hosts || []).join(",") + "\n"; }); }
    s += "Rules:\n  Host" + pad(18) + "Path  Backends\n  ----" + pad(18) + "----  --------\n";
    (g.spec.rules || []).forEach(function (r) {
      s += "  " + (r.host || "*") + "\n";
      (r.http.paths || []).forEach(function (p) {
        var sv = K.get(cl, "Service", g.metadata.namespace, p.backend.service.name), port = p.backend.service.port.number || p.backend.service.port.name;
        var eps = sv ? K.endpointsOf(cl, sv).map(function (x) { var sp = (sv.spec.ports || []).filter(function (q) { return q.port === port || q.name === port; })[0]; return x.status.podIP + ":" + (sp ? K.targetPort(sp, x) : port); }) : [];
        s += pad(24) + p.path + pad(Math.max(1, 6 - p.path.length)) + p.backend.service.name + ":" + port + " (" + (eps.length ? eps.join(",") : sv ? "<none>" : "<error: services \"" + p.backend.service.name + "\" not found>") + ")\n";
      });
    });
    L("Annotations", kv(g.metadata.annotations, 18));
    return s + eventsBlock(cl, g);
  };
  DESC.NetworkPolicy = function (cl, n) {
    var s = "", L = function (a, b) { s += line(a, b, 14); };
    L("Name", n.metadata.name); L("Namespace", n.metadata.namespace); L("Created on", date(cl, n.metadata.creationTimestamp)); L("Labels", kv(n.metadata.labels, 14)); L("Annotations", "<none>");
    s += "Spec:\n  PodSelector:     " + (K.emptySel(n.spec.podSelector) ? "<none> (Allowing the specific traffic to all pods in this namespace)" : K.selStr(n.spec.podSelector)) + "\n";
    function peers(list, dir) { if (!list) return "    " + dir + ": <any> (traffic not restricted by " + (dir === "From" ? "source" : "destination") + ")\n"; return list.map(function (p) { return "    " + dir + ":\n" + (p.podSelector ? "      PodSelector: " + (K.emptySel(p.podSelector) ? "<none>" : K.selStr(p.podSelector)) + "\n" : "") + (p.namespaceSelector ? "      NamespaceSelector: " + (K.emptySel(p.namespaceSelector) ? "<none>" : K.selStr(p.namespaceSelector)) + "\n" : "") + (p.ipBlock ? "      IPBlock:\n        CIDR: " + p.ipBlock.cidr + "\n        Except: " + (p.ipBlock.except || []).join(", ") + "\n" : ""); }).join(""); }
    function ports(list) { return "    To Port: " + (list && list.length ? list.map(function (p) { return (p.port || "<any>") + "/" + (p.protocol || "TCP"); }).join(", ") : "<any> (traffic allowed to all ports)") + "\n"; }
    var types = n.spec.policyTypes || [];
    if (types.indexOf("Ingress") >= 0) { s += "  Allowing ingress traffic:\n"; if (!(n.spec.ingress || []).length) s += "    <none> (Selected pods are isolated for ingress connectivity)\n"; else s += n.spec.ingress.map(function (r) { return ports(r.ports) + peers(r.from, "From"); }).join("    ----------\n"); }
    else s += "  Not affecting ingress traffic\n";
    if (types.indexOf("Egress") >= 0) { s += "  Allowing egress traffic:\n"; if (!(n.spec.egress || []).length) s += "    <none> (Selected pods are isolated for egress connectivity)\n"; else s += n.spec.egress.map(function (r) { return ports(r.ports).replace("To Port", "To Port") + peers(r.to, "To"); }).join("    ----------\n"); }
    else s += "  Not affecting egress traffic\n";
    s += "  Policy Types: " + types.join(", ") + "\n";
    return s;
  };
  DESC.ConfigMap = function (cl, c) { var s = line("Name", c.metadata.name, 14) + line("Namespace", c.metadata.namespace, 14) + line("Labels", kv(c.metadata.labels, 14), 14) + line("Annotations", kv(c.metadata.annotations, 14), 14) + "\nData\n====\n"; keys(c.data || {}).forEach(function (k) { s += k + ":\n----\n" + c.data[k] + "\n\n"; }); return s + "\nBinaryData\n====\n\n" + eventsBlock(cl, c); };
  DESC.Secret = function (cl, c) { var s = line("Name", c.metadata.name, 14) + line("Namespace", c.metadata.namespace, 14) + line("Labels", kv(c.metadata.labels, 14), 14) + line("Annotations", kv(c.metadata.annotations, 14), 14) + "\nType:  " + c.type + "\n\nData\n====\n"; var w = Math.max.apply(null, [0].concat(keys(c.data || {}).map(function (k) { return k.length; }))); keys(c.data || {}).forEach(function (k) { s += k + ":" + pad(w - k.length + 2) + (K.unb64(c.data[k]) || "").length + " bytes\n"; }); return s; };
  DESC.ServiceAccount = function (cl, a) { return line("Name", a.metadata.name, 21) + line("Namespace", a.metadata.namespace, 21) + line("Labels", kv(a.metadata.labels, 21), 21) + line("Annotations", kv(a.metadata.annotations, 21), 21) + line("Image pull secrets", (a.imagePullSecrets || []).map(function (x) { return x.name; }).join(", ") || "<none>", 21) + line("Mountable secrets", "<none>", 21) + line("Tokens", "<none>", 21) + eventsBlock(cl, a); };
  DESC.Namespace = function (cl, n) { var q = K.list(cl, "ResourceQuota", n.metadata.name); return line("Name", n.metadata.name, 13) + line("Labels", kv(n.metadata.labels, 13), 13) + line("Annotations", kv(n.metadata.annotations, 13), 13) + line("Status", "Active", 13) + "\n" + (q.length ? "" : "No resource quota.\n\nNo LimitRange resource.\n"); };
  DESC.Job = function (cl, j) {
    var s = "", L = function (a, b) { s += line(a, b, 18); }, st = j.status || {}, pods = K.ownedBy(cl, j, "Pod");
    L("Name", j.metadata.name); L("Namespace", j.metadata.namespace); L("Selector", K.selStr(j.spec.selector)); L("Labels", kv(j.metadata.labels, 18)); L("Annotations", kv(j.metadata.annotations, 18));
    var own = (j.metadata.ownerReferences || [])[0]; if (own) L("Controlled By", own.kind + "/" + own.name);
    L("Parallelism", j.spec.parallelism); L("Completions", j.spec.completions); L("Completion Mode", j.spec.completionMode); L("Suspend", !!j.spec.suspend); L("Backoff Limit", j.spec.backoffLimit);
    if (st.startTime != null) L("Start Time", date(cl, st.startTime)); if (st.completionTime != null) { L("Completed At", date(cl, st.completionTime)); L("Duration", dur(cl, st.startTime, st.completionTime)); }
    L("Pods Statuses", pods.filter(function (p) { return p.status.phase === "Running" || p.status.phase === "Pending"; }).length + " Active (" + pods.filter(K.podReady).length + " Ready) / " + pods.filter(function (p) { return p.status.phase === "Succeeded"; }).length + " Succeeded / " + pods.filter(function (p) { return p.status.phase === "Failed"; }).length + " Failed");
    s += "Pod Template:\n" + podTemplateBlock(cl, j.spec.template, 2);
    return s + eventsBlock(cl, j);
  };
  DESC.CronJob = function (cl, c) {
    var s = "", L = function (a, b) { s += line(a, b, 29); }, st = c.status || {};
    L("Name", c.metadata.name); L("Namespace", c.metadata.namespace); L("Labels", kv(c.metadata.labels, 29)); L("Annotations", "<none>"); L("Schedule", c.spec.schedule); L("Concurrency Policy", c.spec.concurrencyPolicy); L("Suspend", c.spec.suspend ? "True" : "False"); L("Successful Job History Limit", c.spec.successfulJobsHistoryLimit); L("Failed Job History Limit", c.spec.failedJobsHistoryLimit); L("Starting Deadline Seconds", "<unset>"); L("Selector", "<unset>"); L("Parallelism", "<unset>"); L("Completions", "<unset>");
    s += "Pod Template:\n" + podTemplateBlock(cl, c.spec.jobTemplate.spec.template, 2);
    L("Last Schedule Time", st.lastScheduleTime != null ? date(cl, st.lastScheduleTime) : "<unset>"); L("Active Jobs", (st.active || []).map(function (a) { return a.name; }).join(", ") || "<none>");
    return s + eventsBlock(cl, c);
  };
  DESC.StatefulSet = function (cl, d) {
    var s = "", L = function (a, b) { s += line(a, b, 20); }, pods = K.ownedBy(cl, d, "Pod");
    L("Name", d.metadata.name); L("Namespace", d.metadata.namespace); L("CreationTimestamp", date(cl, d.metadata.creationTimestamp)); L("Selector", K.selStr(d.spec.selector)); L("Labels", kv(d.metadata.labels, 20)); L("Annotations", "<none>"); L("Replicas", d.spec.replicas + " desired | " + ((d.status || {}).replicas || 0) + " total"); L("Update Strategy", "RollingUpdate"); L("  Partition", 0);
    L("Pods Status", pods.filter(function (p) { return p.status.phase === "Running"; }).length + " Running / " + pods.filter(function (p) { return p.status.phase === "Pending"; }).length + " Waiting / 0 Succeeded / 0 Failed");
    s += "Pod Template:\n" + podTemplateBlock(cl, d.spec.template, 2);
    s += "Volume Claims:\n" + ((d.spec.volumeClaimTemplates || []).map(function (v) { return "  Name:          " + v.metadata.name + "\n  StorageClass:  " + (v.spec.storageClassName || "") + "\n  Labels:        <none>\n  Annotations:   <none>\n  Capacity:      " + v.spec.resources.requests.storage + "\n  Access Modes:  [" + (v.spec.accessModes || []).join(" ") + "]\n"; }).join("") || "  <none>\n");
    return s + eventsBlock(cl, d);
  };
  DESC.Certificate = function (cl, c) { var st = c.status || {}, rd = (st.conditions || []).filter(function (x) { return x.type === "Ready"; })[0] || {}; return line("Name", c.metadata.name, 14) + line("Namespace", c.metadata.namespace, 14) + "API Version:  cert-manager.io/v1\nKind:         Certificate\nSpec:\n  Dns Names:\n" + (c.spec.dnsNames || []).map(function (d) { return "    " + d + "\n"; }).join("") + "  Issuer Ref:\n    Group:      cert-manager.io\n    Kind:       " + c.spec.issuerRef.kind + "\n    Name:       " + c.spec.issuerRef.name + "\n  Secret Name:  " + c.spec.secretName + "\nStatus:\n  Conditions:\n    Message:               " + (rd.message || "") + "\n    Reason:                " + (rd.reason || "") + "\n    Status:                " + (rd.status || "") + "\n    Type:                  Ready\n" + (st.notAfter != null ? "  Not After:               " + K.stamp(cl, st.notAfter) + "\n  Not Before:              " + K.stamp(cl, st.notBefore) + "\n  Renewal Time:            " + K.stamp(cl, st.renewalTime) + "\n" : "") + eventsBlock(cl, c); };
  DESC.Role = DESC.ClusterRole = function (cl, r) {
    var s = line("Name", r.metadata.name, 13) + line("Labels", kv(r.metadata.labels, 13), 13) + line("Annotations", "<none>", 13) + "PolicyRule:\n";
    var rows = [["Resources", "Non-Resource URLs", "Resource Names", "Verbs"], ["---------", "-----------------", "--------------", "-----"]];
    (r.rules || []).forEach(function (ru) { (ru.resources || ["*"]).forEach(function (res) { (ru.apiGroups || [""]).forEach(function (g) { rows.push([res + (g ? "." + g : ""), "[]", "[" + (ru.resourceNames || []).join(" ") + "]", "[" + (ru.verbs || []).join(" ") + "]"]); }); }); });
    return s + KC.table(rows).split("\n").map(function (l) { return l ? "  " + l : l; }).join("\n");
  };
  DESC.RoleBinding = DESC.ClusterRoleBinding = function (cl, b) {
    var s = line("Name", b.metadata.name, 13) + line("Labels", kv(b.metadata.labels, 13), 13) + line("Annotations", "<none>", 13) + "Role:\n  Kind:  " + b.roleRef.kind + "\n  Name:  " + b.roleRef.name + "\nSubjects:\n";
    var rows = [["Kind", "Name", "Namespace"], ["----", "----", "---------"]];
    (b.subjects || []).forEach(function (x) { rows.push([x.kind, x.name, x.namespace || ""]); });
    return s + KC.table(rows).split("\n").map(function (l) { return l ? "  " + l : l; }).join("\n");
  };
  KC.DESC = DESC;
  KC.describe = function (o, io, sess) {
    var C = KC.ctx(sess, o, io); if (!C) return 1;
    var cl = C.cl, tg = KC.targets(cl, o.pos, io, "describe");
    if (tg.error) { errl(io, tg.error); return 1; }
    var blocks = [], code = 0;
    tg.list.forEach(function (t) {
      var info = t.info, ns = info.ns ? (o["all-namespaces"] ? null : C.ns) : null, items;
      if (!K.can(cl, C.sub, "get", info.plural, info.group, ns || C.ns, t.names[0])) { errl(io, K.forbidden(C.sub, "get", info, ns || C.ns, t.names[0])); code = 1; return; }
      var sel = o.selector ? K.parseSel(o.selector).test : null;
      if (t.names.length) {
        items = [];
        t.names.forEach(function (n) { var x = K.get(cl, info.kind, ns || C.ns, n); if (!x) { var pre = K.list(cl, info.kind, ns || C.ns).filter(function (y) { return y.metadata.name.indexOf(n) === 0; }); if (pre.length) items = items.concat(pre); else { errl(io, "Error from server (NotFound): " + info.plural + (info.group ? "." + info.group : "") + " \"" + n + "\" not found"); code = 1; } } else items.push(x); });
      } else items = K.list(cl, info.kind, ns, sel);
      items.forEach(function (x) {
        var d = DESC[info.kind] || (K.describers || {})[info.kind];
        blocks.push(d ? d(cl, x) : line("Name", x.metadata.name, 13) + (info.ns ? line("Namespace", x.metadata.namespace, 13) : "") + line("Labels", kv(x.metadata.labels, 13), 13) + line("Annotations", "<none>", 13) + "API Version:  " + x.apiVersion + "\nKind:         " + x.kind + "\n" + KC.yaml({ Spec: x.spec, Status: x.status }).replace(/^/mg, "") + eventsBlock(cl, x));
      });
      if (!t.names.length && !items.length) errl(io, "No resources found in " + C.ns + " namespace.");
    });
    out(io, blocks.join("\n\n").replace(/\n*$/, "\n"));
    return code;
  };

  /* ================================================================== small read-only commands */
  KC.version = function (o, io, sess) {
    var cl = K.of(sess.sys), kc = K.kubeconfig(sess);
    if (o.client) { out(io, "Client Version: v1.31.4\nKustomize Version: v5.4.2\n"); return 0; }
    out(io, "Client Version: v1.31.4\nKustomize Version: v5.4.2\n");
    if (cl && kc && kc.ctx) out(io, "Server Version: " + cl.version + "+k3s1\n");
    else { errl(io, "The connection to the server localhost:8080 was refused - did you specify the right host or port?"); return 1; }
    return 0;
  };
  KC.clusterInfo = function (o, io, sess) {
    var C = KC.ctx(sess, o, io); if (!C) return 1;
    if (io.color) { io.color("Kubernetes control plane", "green"); out(io, " is running at "); io.color(C.cl.server, "yellow"); out(io, "\n"); io.color("CoreDNS", "green"); out(io, " is running at "); io.color(C.cl.server + "/api/v1/namespaces/kube-system/services/kube-dns:dns/proxy", "yellow"); out(io, "\n"); io.color("Metrics-server", "green"); out(io, " is running at "); io.color(C.cl.server + "/api/v1/namespaces/kube-system/services/https:metrics-server:https/proxy", "yellow"); out(io, "\n"); }
    else out(io, "Kubernetes control plane is running at " + C.cl.server + "\nCoreDNS is running at " + C.cl.server + "/api/v1/namespaces/kube-system/services/kube-dns:dns/proxy\nMetrics-server is running at " + C.cl.server + "/api/v1/namespaces/kube-system/services/https:metrics-server:https/proxy\n");
    out(io, "\nTo further debug and diagnose cluster problems, use 'kubectl cluster-info dump'.\n");
    return 0;
  };
  KC.apiResources = function (o, io, sess) {
    var C = KC.ctx(sess, o, io); if (!C) return 1;
    var rows = [["NAME", "SHORTNAMES", "APIVERSION", "NAMESPACED", "KIND"]];
    keys(K.KINDS).map(function (k) { return K.KINDS[k]; }).filter(function (x) { return !x.crd || C.cl.comps[x.crd]; }).sort(function (a, b) { return (a.group || "").localeCompare(b.group || "") || a.plural.localeCompare(b.plural); }).forEach(function (x) { if (o.namespaced != null && String(x.ns) !== String(o.namespaced)) return; rows.push([x.plural, x.short.join(","), x.gv, x.ns ? "true" : "false", x.kind]); });
    out(io, KC.table(rows));
    return 0;
  };
  var EXPLAIN = {
    "pod.spec.containers.resources": "FIELD: resources <ResourceRequirements>\n\nDESCRIPTION:\n    Compute Resources required by this container. Cannot be updated. More info:\n    https://kubernetes.io/docs/concepts/configuration/manage-resources-containers/\n\nFIELDS:\n  claims\t<[]ResourceClaim>\n  limits\t<map[string]Quantity>\n    Limits describes the maximum amount of compute resources allowed.\n  requests\t<map[string]Quantity>\n    Requests describes the minimum amount of compute resources required. If\n    Requests is omitted for a container, it defaults to Limits if that is\n    explicitly specified, otherwise to an implementation-defined value.\n",
    "deployment.spec.strategy.rollingupdate": "FIELD: rollingUpdate <RollingUpdateDeployment>\n\nDESCRIPTION:\n    Rolling update config params. Present only if DeploymentStrategyType =\n    RollingUpdate.\n\nFIELDS:\n  maxSurge\t<IntOrString>\n    The maximum number of pods that can be scheduled above the desired number of\n    pods. Value can be an absolute number (ex: 5) or a percentage of desired pods\n    (ex: 10%). Defaults to 25%.\n  maxUnavailable\t<IntOrString>\n    The maximum number of pods that can be unavailable during the update. Value\n    can be an absolute number (ex: 5) or a percentage of desired pods (ex: 10%).\n    Defaults to 25%.\n"
  };
  KC.explain = function (o, io, sess) {
    var C = KC.ctx(sess, o, io); if (!C) return 1;
    var path = String(o.pos[0] || "").toLowerCase(), base = path.split(".")[0], info = K.kindOf(C.cl, base);
    if (!info) { errl(io, "error: the server doesn't have a resource type \"" + base + "\""); return 1; }
    var key = [info.kind.toLowerCase()].concat(path.split(".").slice(1)).join(".");
    if (EXPLAIN[key]) { out(io, "GROUP:      " + (info.group || "") + "\nKIND:       " + info.kind + "\nVERSION:    " + info.gv.split("/").pop() + "\n\n" + EXPLAIN[key]); return 0; }
    out(io, "GROUP:      " + (info.group || "") + "\nKIND:       " + info.kind + "\nVERSION:    " + info.gv.split("/").pop() + "\n\nDESCRIPTION:\n    (The lab has the full field list in the Learn tab. On a real cluster, kubectl explain " + o.pos[0] + " --recursive prints every field.)\n");
    return 0;
  };
  KC.top = function (o, io, sess) {
    var C = KC.ctx(sess, o, io); if (!C) return 1;
    var cl = C.cl, what = o.pos[0] || "";
    if (!cl.comps.metrics) { errl(io, "error: Metrics API not available"); return 1; }
    if (/^(node|nodes|no)$/.test(what)) {
      var rows = [["NAME", "CPU(cores)", "CPU(%)", "MEMORY(bytes)", "MEMORY(%)"]];
      K.all(cl, "Node").forEach(function (n) { var pods = K.all(cl, "Pod").filter(function (p) { return p.spec.nodeName === n.metadata.name && p.status.phase === "Running"; }); var cpu = 90 + pods.reduce(function (s, p) { return s + K.podCpu(cl, p); }, 0), mem = 900 * 1048576 + pods.reduce(function (s, p) { return s + K.podMem(cl, p); }, 0); rows.push([n.metadata.name, cpu + "m", Math.round(cpu / 20) + "%", Math.round(mem / 1048576) + "Mi", Math.round(mem / K.mem(n.status.capacity.memory) * 100) + "%"]); });
      out(io, KC.table(rows)); return 0;
    }
    if (!/^(pod|pods|po)$/.test(what)) { errl(io, "error: unknown command \"" + what + "\" for \"kubectl top\""); return 1; }
    var ns = o["all-namespaces"] ? null : C.ns, sel = o.selector ? K.parseSel(o.selector).test : null;
    var pods2 = K.list(cl, "Pod", ns, sel).filter(function (p) { return p.status.phase === "Running" && (!o.pos[1] || p.metadata.name === o.pos[1]); });
    if (!pods2.length) { errl(io, o.pos[1] ? "Error from server (NotFound): podmetrics.metrics.k8s.io \"" + C.ns + "/" + o.pos[1] + "\" not found" : "No resources found in " + C.ns + " namespace."); return 1; }
    var r2 = [(ns ? [] : ["NAMESPACE"]).concat(["NAME", "CPU(cores)", "MEMORY(bytes)"])];
    pods2.forEach(function (p) { r2.push((ns ? [] : [p.metadata.namespace]).concat([p.metadata.name, K.podCpu(cl, p) + "m", Math.round(K.podMem(cl, p) / 1048576) + "Mi"])); });
    out(io, KC.table(r2));
    return 0;
  };
  KC.auth = function (o, io, sess) {
    var sub = o.pos[0];
    var C = KC.ctx(sess, o, io); if (!C) return 1;
    var cl = C.cl;
    if (sub === "whoami") { var rows = [["ATTRIBUTE", "VALUE"], ["Username", C.sub.user]]; if (C.sub.groups.length) rows.push(["Groups", "[" + C.sub.groups.join(" ") + "]"]); out(io, KC.table(rows)); return 0; }
    if (sub !== "can-i") { errl(io, "error: unknown command \"" + (sub || "") + "\" for \"kubectl auth\""); return 1; }
    var ns = o["all-namespaces"] ? null : C.ns;
    if (o.list) {
      var rules = K.rulesFor(cl, C.sub, ns), rows2 = [["Resources", "Non-Resource URLs", "Resource Names", "Verbs"]];
      if ((C.sub.groups || []).indexOf("system:masters") >= 0) rules = [{ apiGroups: ["*"], resources: ["*"], verbs: ["*"] }];
      rules.forEach(function (r) { (r.resources || []).forEach(function (res) { (r.apiGroups || [""]).forEach(function (g) { rows2.push([res + (g && g !== "" ? "." + g : ""), "[]", "[" + (r.resourceNames || []).join(" ") + "]", "[" + (r.verbs || []).join(" ") + "]"]); }); }); });
      out(io, KC.table(rows2)); return 0;
    }
    var verb = o.pos[1], what = o.pos[2] || "";
    if (!verb) { errl(io, "error: you must specify two arguments: verb resource or a single argument: nonResourceURL\nSee 'kubectl auth can-i -h' for help and examples."); return 1; }
    var sp = what.split("/"), resW = sp[0], name = sp[1], subres = o.subresource;
    var info = K.kindOf(cl, resW.split(".")[0]) || (resW === "*" ? { plural: "*", group: "", ns: true } : null);
    if (!info) { out(io, "no\n"); errl(io, "Warning: the server doesn't have a resource type '" + resW + "'"); return 1; }
    var plural = info.plural + (subres ? "/" + subres : "");
    var ok = K.can(cl, C.sub, verb, plural, info.group, info.ns ? ns : null, name);
    out(io, (ok ? "yes" : "no") + "\n");
    return ok ? 0 : 1;
  };

  /* ================================================================== kubectl config */
  KC.config = function (o, io, sess) {
    var sub = o.pos[0], kc = K.kubeconfig(sess);
    if (!kc) { if (sub === "view") { out(io, "apiVersion: v1\nclusters: null\ncontexts: null\ncurrent-context: \"\"\nkind: Config\npreferences: {}\nusers: null\n"); return 0; } errl(io, "error: current-context is not set"); return 1; }
    if (kc.error) { errl(io, "error: " + kc.error); return 1; }
    var raw = kc.raw;
    function save() { S.put(sess.sys, kc.path.split(":")[0], KC.yaml(raw), 384, sess.uid, sess.gid); }
    if (sub === "current-context") { if (!kc.current) { errl(io, "error: current-context is not set"); return 1; } out(io, kc.current + "\n"); return 0; }
    if (sub === "get-contexts") {
      var rows = [["CURRENT", "NAME", "CLUSTER", "AUTHINFO", "NAMESPACE"]];
      keys(kc.contexts).filter(function (n) { return !o.pos[1] || n === o.pos[1]; }).forEach(function (n) { var c = kc.contexts[n]; rows.push([n === kc.current ? "*" : "", n, c.cluster || "", c.user || "", c.namespace || ""]); });
      if (o.output === "name") { keys(kc.contexts).forEach(function (n) { out(io, n + "\n"); }); return 0; }
      out(io, KC.table(rows)); return 0;
    }
    if (sub === "get-clusters") { out(io, "NAME\n" + keys(kc.clusters).join("\n") + "\n"); return 0; }
    if (sub === "get-users") { out(io, "NAME\n" + keys(kc.users).join("\n") + "\n"); return 0; }
    if (sub === "use-context" || sub === "use") { var n = o.pos[1]; if (!kc.contexts[n]) { errl(io, "error: no context exists with the name: \"" + n + "\""); return 1; } raw["current-context"] = n; save(); out(io, "Switched to context \"" + n + "\".\n"); return 0; }
    if (sub === "set-context") {
      var name = o.current ? kc.current : o.pos[1];
      if (!name) { errl(io, "error: you must specify a non-empty context name or --current"); return 1; }
      var existing = (raw.contexts || []).filter(function (c) { return c.name === name; })[0];
      if (!existing) { existing = { name: name, context: {} }; (raw.contexts = raw.contexts || []).push(existing); }
      ["namespace", "cluster", "user"].forEach(function (k) { if (o[k] != null) existing.context[k] = o[k]; });
      save();
      out(io, "Context \"" + name + "\" " + (kc.contexts[name] ? "modified" : "created") + ".\n"); return 0;
    }
    if (sub === "delete-context") { raw.contexts = (raw.contexts || []).filter(function (c) { return c.name !== o.pos[1]; }); save(); out(io, "deleted context " + o.pos[1] + " from " + kc.path + "\n"); return 0; }
    if (sub === "rename-context") { (raw.contexts || []).forEach(function (c) { if (c.name === o.pos[1]) c.name = o.pos[2]; }); if (raw["current-context"] === o.pos[1]) raw["current-context"] = o.pos[2]; save(); out(io, "Context \"" + o.pos[1] + "\" renamed to \"" + o.pos[2] + "\".\n"); return 0; }
    if (sub === "set-credentials") { var u = (raw.users || []).filter(function (x) { return x.name === o.pos[1]; })[0]; if (!u) { u = { name: o.pos[1], user: {} }; (raw.users = raw.users || []).push(u); } if (o.token) u.user = { token: o.token }; save(); out(io, "User \"" + o.pos[1] + "\" set.\n"); return 0; }
    if (sub === "view") {
      var v = clone(raw);
      if (!o.raw) (v.users || []).forEach(function (x) { keys(x.user || {}).forEach(function (k) { if (/data$|^token$/.test(k)) x.user[k] = k === "token" ? "REDACTED" : "DATA+OMITTED"; }); });
      (v.clusters || []).forEach(function (x) { if (!o.raw && x.cluster && x.cluster["certificate-authority-data"]) x.cluster["certificate-authority-data"] = "DATA+OMITTED"; });
      if (o.minify) { v.contexts = (v.contexts || []).filter(function (c) { return c.name === kc.current; }); }
      if (o.output && /^jsonpath/.test(o.output)) { var jp = KC.jsonpath(o.output.replace(/^jsonpath=/, ""), v); if (jp.error) { errl(io, jp.error); return 1; } out(io, jp.text); return 0; }
      out(io, KC.yaml(v)); return 0;
    }
    errl(io, "error: unknown command \"" + (sub || "") + "\" for \"kubectl config\""); return 1;
  };
})(typeof window !== "undefined" ? window : globalThis);
