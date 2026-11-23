/* sudo learn — DevOps Module 4: kubectl, part 2. Everything that changes the cluster: apply/create/replace/
   delete/diff (-f, -k), create <thing> generators with --dry-run=client -o yaml, run, expose, scale,
   autoscale, set image/env/resources, rollout status/history/undo/restart/pause/resume, label, annotate,
   patch (strategic, merge, json), wait, logs, exec (-it opens a shell inside the pod), port-forward,
   kustomize, and the kubectl command itself. */
(function (root) {
  "use strict";
  var S = root.ShEngine, M2 = S.M2, U = S.util, Dk = root.Dk, K = root.K8s, KC = K.kubectl, G = root.GitCore;
  var out = U.out, errl = U.errl;
  var keys = K.keys, clone = K.clone, isObj = K.isObj;

  function dryTag(o) { return o["dry-run"] === "client" || o["dry-run"] === true || o["dry-run"] === "true" ? " (dry run)" : o["dry-run"] === "server" ? " (server dry run)" : ""; }
  function warn(io, ws) { (ws || []).forEach(function (w) { errl(io, "Warning: " + w); }); }
  function printObj(o, io, cl, obj, info, verb) {
    if (o.output === "yaml") { out(io, KC.yaml(KC.wire(cl, obj))); return; }
    if (o.output === "json") { out(io, JSON.stringify(KC.wire(cl, obj), null, 4) + "\n"); return; }
    if (o.output === "name") { out(io, KC.ref(info, obj.metadata.name) + "\n"); return; }
    out(io, KC.ref(info, obj.metadata.name) + " " + verb + dryTag(o) + "\n");
  }
  // client-side dry run with -o yaml prints the object as you'd write it
  function clientObj(obj) { var x = clone(obj); x.metadata = x.metadata || {}; if (!x.metadata.creationTimestamp) x.metadata.creationTimestamp = null; x.status = x.status || (/^(Pod|Deployment|Service|Job|CronJob|Namespace|HorizontalPodAutoscaler|Ingress)$/.test(x.kind) ? {} : undefined); if (x.status === undefined) delete x.status; return x; }
  function emitNew(o, io, sess, obj, verb) {
    var dry = o["dry-run"] === "client" || o["dry-run"] === true;
    var info = K.KINDS[obj.kind];
    if (dry && /^(yaml|json)$/.test(o.output || "")) { var x = clientObj(obj); out(io, o.output === "yaml" ? KC.yaml(x) : JSON.stringify(x, null, 4) + "\n"); return 0; }
    if (dry) { out(io, KC.ref(info, obj.metadata.name) + " " + verb + " (dry run)\n"); return 0; }
    var C = KC.ctx(sess, o, io); if (!C) return 1;
    var r = K.write(C.cl, obj, { ns: C.ns, mode: "create", sub: C.sub, source: "STDIN", dryRun: o["dry-run"] === "server" });
    if (r.error) { errl(io, r.error.replace(/error when creating "STDIN": /, "")); return 1; }
    warn(io, r.warnings);
    printObj(o, io, C.cl, r.obj, info, verb);
    return 0;
  }
  function nsOf(sess, o) { if (o.namespace) return o.namespace; var kc = K.kubeconfig(sess); return (kc && kc.ctx && kc.ctx.namespace) || "default"; }

  /* ================================================================== apply / create -f / replace / delete -f / diff */
  KC.applyLike = function (mode, o, io, sess) {
    var C = KC.ctx(sess, o, io); if (!C) return 1;
    o.sub = mode === "apply" ? "apply" : mode;
    var docs = KC.load(sess, o, io); if (!docs) return 1;
    var code = 0, dry = o["dry-run"] === "client" || o["dry-run"] === true;
    docs.forEach(function (d) {
      if (dry && /^(yaml|json)$/.test(o.output || "")) { out(io, o.output === "yaml" ? KC.yaml(d.obj) : JSON.stringify(d.obj, null, 4) + "\n"); return; }
      if (mode === "replace") { var info0 = K.byKind(C.cl, (d.obj || {}).kind, (d.obj || {}).apiVersion), nm = ((d.obj || {}).metadata || {}).name; if (info0 && !K.get(C.cl, info0.kind, info0.ns ? (d.obj.metadata.namespace || C.ns) : null, nm)) { errl(io, "Error from server (NotFound): error when replacing \"" + d.src + "\": " + info0.plural + (info0.group ? "." + info0.group : "") + " \"" + nm + "\" not found"); code = 1; return; } }
      var r = K.write(C.cl, d.obj, { ns: C.ns, forceNs: C.nsGiven, mode: mode, sub: C.sub, source: d.src, dryRun: dry || o["dry-run"] === "server" });
      if (r.error) { errl(io, r.error); code = 1; return; }
      warn(io, r.warnings);
      if (/^(yaml|json)$/.test(o.output || "")) { printObj(o, io, C.cl, r.obj, r.info); return; }
      out(io, KC.ref(r.info, r.obj.metadata.name) + " " + r.action + dryTag(o) + "\n");
    });
    if (o.wait === true || o.wait === "true") K.touch(C.cl, 5);
    return code;
  };
  KC.deleteCmd = function (o, io, sess) {
    var C = KC.ctx(sess, o, io); if (!C) return 1;
    var cl = C.cl, targets = [], code = 0;
    if (o.f.length || o.kustomize) {
      o.sub = "delete";
      var docs = KC.load(sess, o, io); if (!docs) return 1;
      docs.forEach(function (d) { var info = K.byKind(cl, d.obj.kind, d.obj.apiVersion); if (!info) { errl(io, "error: resource mapping not found for name: \"" + d.obj.metadata.name + "\" namespace: \"\" from \"" + d.src + "\": no matches for kind \"" + d.obj.kind + "\" in version \"" + d.obj.apiVersion + "\""); code = 1; return; } targets.push({ info: info, ns: info.ns ? (d.obj.metadata.namespace || C.ns) : null, name: d.obj.metadata.name }); });
    } else {
      var tg = KC.targets(cl, o.pos, io, "delete"); if (tg.error) { errl(io, tg.error); return 1; }
      tg.list.forEach(function (t) {
        var ns = t.info.ns ? (o["all-namespaces"] ? null : C.ns) : null;
        if (t.names.length) t.names.forEach(function (n) { targets.push({ info: t.info, ns: ns || C.ns, name: n }); });
        else if (o.selector || o.all) { var sel = o.selector ? K.parseSel(o.selector).test : null; K.list(cl, t.info.kind, ns, sel).forEach(function (x) { targets.push({ info: t.info, ns: x.metadata.namespace, name: x.metadata.name }); }); if (!targets.length) { errl(io, "No resources found"); } }
        else { errl(io, "error: resource(s) were provided, but no name was specified"); code = 1; }
      });
    }
    var gone = [];
    targets.forEach(function (t) {
      var x = K.get(cl, t.info.kind, t.ns, t.name);
      if (!K.can(cl, C.sub, "delete", t.info.plural, t.info.group, t.ns, t.name)) { errl(io, K.forbidden(C.sub, "delete", t.info, t.ns, t.name)); code = 1; return; }
      if (!x) { if (!o["ignore-not-found"]) { errl(io, "Error from server (NotFound): " + (o.f.length ? "error when deleting \"" + o.f[0] + "\": " : "") + t.info.plural + (t.info.group ? "." + t.info.group : "") + " \"" + t.name + "\" not found"); code = 1; } return; }
      if (dryTag(o)) { out(io, t.info.kind.toLowerCase() + " \"" + t.name + "\" deleted" + dryTag(o) + "\n"); return; }
      if (t.info.kind === "Pod" && !(o.force && (o["grace-period"] === "0" || o.now))) { K.audit(cl, C.sub, "delete", x); K.terminatePod(cl, x); gone.push(x); }
      else K.del(cl, x, C.sub);
      out(io, (t.info.group ? t.info.kind.toLowerCase() + "." + t.info.group : t.info.kind.toLowerCase()) + " \"" + t.name + "\" deleted" + (t.info.ns && targets.length > 1 && o.f.length ? "" : "") + "\n");
    });
    if (o.force && o["grace-period"] === "0") errl(io, "Warning: Immediate deletion does not wait for confirmation that the running resource has been terminated. The resource may continue to run on the cluster indefinitely.");
    if (gone.length && o.wait !== "false") K.advance(cl, 30, function () { return gone.every(function (p) { return !K.get(cl, "Pod", p.metadata.namespace, p.metadata.name) || K.get(cl, "Pod", p.metadata.namespace, p.metadata.name).metadata.uid !== p.metadata.uid; }); });
    return code;
  };
  KC.diff = function (o, io, sess) {
    var C = KC.ctx(sess, o, io); if (!C) return 1;
    o.sub = "diff";
    var docs = KC.load(sess, o, io); if (!docs) return 1;
    var any = false;
    docs.forEach(function (d) {
      var r = K.write(C.cl, d.obj, { ns: C.ns, mode: "apply", sub: C.sub, source: d.src, dryRun: true });
      if (r.error) { errl(io, r.error.replace(/error when creating/, "error when diffing")); return; }
      var live = K.get(C.cl, r.obj.kind, r.obj.metadata.namespace, r.obj.metadata.name);
      function clean(x) { if (!x) return ""; var w = KC.wire(C.cl, x); delete w.status; if (w.metadata) { delete w.metadata.resourceVersion; delete w.metadata.generation; delete w.metadata.managedFields; if (w.metadata.annotations) delete w.metadata.annotations["kubectl.kubernetes.io/last-applied-configuration"]; if (w.metadata.annotations && !keys(w.metadata.annotations).length) delete w.metadata.annotations; } return KC.yaml(w); }
      var a = clean(live), b = clean(r.obj);
      if (a === b) return;
      any = true;
      var name = [r.info.group || "", r.info.gv.split("/").pop(), r.obj.kind, r.obj.metadata.namespace || "", r.obj.metadata.name].join(".").replace(/^\./, "").replace(/\.\./g, ".");
      out(io, "diff -u -N /tmp/LIVE-" + K.hex("dl" + name, 10) + "/" + name + " /tmp/MERGED-" + K.hex("dm" + name, 10) + "/" + name + "\n");
      out(io, "--- /tmp/LIVE-" + K.hex("dl" + name, 10) + "/" + name + "\t2026-11-23 10:02:11.000000000 +0000\n+++ /tmp/MERGED-" + K.hex("dm" + name, 10) + "/" + name + "\t2026-11-23 10:02:11.000000000 +0000\n");
      var ub = G.unifiedBody(a, b, 3);
      out(io, (ub.lines || ub).map(function (l) { return typeof l === "string" ? l : l.t; }).join("\n").replace(/\n?$/, "\n"));
    });
    return any ? 1 : 0;
  };

  /* ================================================================== generators: create ..., run, expose */
  function parseKV(list) { var m = {}; (list || []).forEach(function (s) { var i = String(s).indexOf("="); if (i > 0) m[s.slice(0, i)] = s.slice(i + 1); }); return m; }
  function fromFiles(sess, list, io) {
    var m = {};
    for (var i = 0; i < (list || []).length; i++) {
      var spec = list[i], key = null, p = spec;
      if (/^[^=\/]+=/.test(spec)) { key = spec.slice(0, spec.indexOf("=")); p = spec.slice(spec.indexOf("=") + 1); }
      var abs = KC.absPath(sess, p), n = Dk.fsNode(sess.sys, abs);
      if (!n) { errl(io, "error: error reading " + p + ": no such file or directory"); return null; }
      if (n.type === "d") { keys(n.children).forEach(function (k) { if (n.children[k].type === "f") m[k] = String(n.children[k].content); }); continue; }
      var t = KC.readF(sess, abs); if (t == null) { errl(io, "error: error reading " + p + ": permission denied"); return null; }
      m[key || p.split("/").pop()] = t;
    }
    return m;
  }
  function envFile(sess, p, io) { var t = KC.readF(sess, KC.absPath(sess, p)); if (t == null) { errl(io, "error: open " + p + ": no such file or directory"); return null; } var m = {}; t.split("\n").forEach(function (l) { l = l.trim(); if (!l || l.charAt(0) === "#") return; var i = l.indexOf("="); if (i > 0) m[l.slice(0, i)] = l.slice(i + 1); }); return m; }
  function labelSel(name) { return { app: name }; }
  function portsOf(o) { return o.port ? String(o.port).split(",").map(function (p) { return +p; }) : []; }
  KC.create = function (o, io, sess) {
    var what = o.pos.shift(), name = o.pos[0], ns = nsOf(sess, o), obj;
    if (o.f.length || o.kustomize) { o.pos.unshift(what); return KC.applyLike("create", o, io, sess); }
    if (!what) { errl(io, "error: must specify one of -f and -k"); return 1; }
    function need() { if (!name) { errl(io, "error: exactly one NAME is required, got 0\nSee 'kubectl create " + what + " -h' for help and examples"); return false; } return true; }
    switch (what) {
      case "namespace": case "ns": if (!need()) return 1; obj = { apiVersion: "v1", kind: "Namespace", metadata: { name: name }, spec: {} }; return emitNew(o, io, sess, obj, "created");
      case "deployment": case "deploy":
        if (!need()) return 1;
        if (!o.image) { errl(io, "error: required flag(s) \"image\" not set"); return 1; }
        var c = { name: String(o.image).split("/").pop().split(/[:@]/)[0], image: o.image, resources: {} };
        if (o.port) c.ports = [{ containerPort: +o.port }];
        if (o.dash) c.command = o.dash;
        obj = { apiVersion: "apps/v1", kind: "Deployment", metadata: { name: name, namespace: ns, labels: labelSel(name) }, spec: { replicas: +(o.replicas || 1), selector: { matchLabels: labelSel(name) }, strategy: {}, template: { metadata: { labels: labelSel(name) }, spec: { containers: [c] } } } };
        return emitNew(o, io, sess, obj, "created");
      case "configmap": case "cm":
        if (!need()) return 1;
        var data = parseKV(o["from-literals"]), ff = fromFiles(sess, o["from-files"], io); if (!ff) return 1; Object.assign(data, ff);
        if (o["from-env-file"]) { var ef = envFile(sess, o["from-env-file"], io); if (!ef) return 1; Object.assign(data, ef); }
        obj = { apiVersion: "v1", kind: "ConfigMap", metadata: { name: name, namespace: ns }, data: data };
        return emitNew(o, io, sess, obj, "created");
      case "secret":
        var st = o.pos.shift(); name = o.pos[0];
        if (st === "generic") {
          if (!need()) return 1;
          var d2 = parseKV(o["from-literals"]), f2 = fromFiles(sess, o["from-files"], io); if (!f2) return 1; Object.assign(d2, f2);
          if (o["from-env-file"]) { var e2 = envFile(sess, o["from-env-file"], io); if (!e2) return 1; Object.assign(d2, e2); }
          var enc = {}; keys(d2).forEach(function (k) { enc[k] = K.b64(d2[k]); });
          obj = { apiVersion: "v1", kind: "Secret", metadata: { name: name, namespace: ns }, type: o.type || "Opaque", data: enc };
          return emitNew(o, io, sess, obj, "created");
        }
        if (st === "docker-registry") {
          if (!need()) return 1;
          if (!o["docker-username"] || !o["docker-password"]) { errl(io, "error: either --from-file or the combination of --docker-username, --docker-password and --docker-server is required"); return 1; }
          var srv = o["docker-server"] || "https://index.docker.io/v1/", cfg = { auths: {} };
          cfg.auths[srv] = { username: o["docker-username"], password: o["docker-password"], email: o["docker-email"], auth: K.b64(o["docker-username"] + ":" + o["docker-password"]) };
          if (!o["docker-email"]) delete cfg.auths[srv].email;
          obj = { apiVersion: "v1", kind: "Secret", metadata: { name: name, namespace: ns }, type: "kubernetes.io/dockerconfigjson", data: { ".dockerconfigjson": K.b64(JSON.stringify(cfg)) } };
          return emitNew(o, io, sess, obj, "created");
        }
        if (st === "tls") { if (!need()) return 1; var crt = KC.readF(sess, KC.absPath(sess, o.cert || "")), key = KC.readF(sess, KC.absPath(sess, o.key || "")); if (crt == null || key == null) { errl(io, "error: open " + (crt == null ? o.cert : o.key) + ": no such file or directory"); return 1; } obj = { apiVersion: "v1", kind: "Secret", metadata: { name: name, namespace: ns }, type: "kubernetes.io/tls", data: { "tls.crt": K.b64(crt), "tls.key": K.b64(key) } }; return emitNew(o, io, sess, obj, "created"); }
        errl(io, "error: unknown command \"" + (st || "") + "\" for \"kubectl create secret\"\nAvailable Commands:\n  docker-registry   Create a secret for use with a Docker registry\n  generic           Create a secret from a local file, directory, or literal value\n  tls               Create a TLS secret"); return 1;
      case "serviceaccount": case "sa": if (!need()) return 1; obj = { apiVersion: "v1", kind: "ServiceAccount", metadata: { name: name, namespace: ns } }; return emitNew(o, io, sess, obj, "created");
      case "role": case "clusterrole":
        if (!need()) return 1;
        var verbs = [].concat.apply([], (o.verbs || []).map(function (v) { return String(v).split(","); })), res = [].concat.apply([], (o.resources || []).map(function (v) { return String(v).split(","); }));
        if (!verbs.length) { errl(io, "error: at least one verb must be specified"); return 1; }
        if (!res.length) { errl(io, "error: at least one resource must be specified"); return 1; }
        var byGroup = {};
        res.forEach(function (r0) { var sp2 = r0.split("/"), base = sp2[0], dot = base.indexOf("."), plural = dot > 0 ? base.slice(0, dot) : base, grp = dot > 0 ? base.slice(dot + 1) : null; var inf = K.kindOf(null, plural); var g = grp != null ? grp : inf ? inf.group : ""; var full = (inf ? inf.plural : plural) + (sp2[1] ? "/" + sp2[1] : ""); (byGroup[g] = byGroup[g] || []).push(full); });
        var rules = keys(byGroup).map(function (g) { var r1 = { apiGroups: [g], resources: byGroup[g], verbs: verbs }; if (o["resource-name"]) r1.resourceNames = String(o["resource-name"]).split(","); return r1; });
        obj = { apiVersion: "rbac.authorization.k8s.io/v1", kind: what === "role" ? "Role" : "ClusterRole", metadata: what === "role" ? { name: name, namespace: ns } : { name: name }, rules: rules };
        return emitNew(o, io, sess, obj, "created");
      case "rolebinding": case "clusterrolebinding":
        if (!need()) return 1;
        if (!o.role && !o.clusterrole) { errl(io, "error: exactly one of clusterrole or role must be specified"); return 1; }
        var subs = (o.users || []).map(function (u) { return { apiGroup: "rbac.authorization.k8s.io", kind: "User", name: u }; }).concat((o.groups || []).map(function (g) { return { apiGroup: "rbac.authorization.k8s.io", kind: "Group", name: g }; })).concat((o.serviceaccounts || []).map(function (s) { var p = s.split(":"); if (p.length !== 2) return null; return { kind: "ServiceAccount", name: p[1], namespace: p[0] }; }));
        if (subs.some(function (s) { return !s; })) { errl(io, "error: serviceaccount must be <namespace>:<name>"); return 1; }
        obj = { apiVersion: "rbac.authorization.k8s.io/v1", kind: what === "rolebinding" ? "RoleBinding" : "ClusterRoleBinding", metadata: what === "rolebinding" ? { name: name, namespace: ns } : { name: name }, roleRef: { apiGroup: "rbac.authorization.k8s.io", kind: o.role ? "Role" : "ClusterRole", name: o.role || o.clusterrole }, subjects: subs };
        return emitNew(o, io, sess, obj, "created");
      case "job":
        if (!need()) return 1;
        if (o.from) {
          var C = KC.ctx(sess, o, io); if (!C) return 1;
          var fm = /^(cronjob|cronjobs|cj|cronjob\.batch)\/(.+)$/.exec(o.from);
          if (!fm) { errl(io, "error: from must be an existing cronjob"); return 1; }
          var cj = K.get(C.cl, "CronJob", C.ns, fm[2]);
          if (!cj) { errl(io, "error: failed to retrieve object: cronjobs.batch \"" + fm[2] + "\" not found"); return 1; }
          if (!K.can(C.cl, C.sub, "create", "jobs", "batch", C.ns)) { errl(io, K.forbidden(C.sub, "create", K.KINDS.Job, C.ns)); return 1; }
          if (K.get(C.cl, "Job", C.ns, name)) { errl(io, "error: failed to create job: jobs.batch \"" + name + "\" already exists"); return 1; }
          if (dryTag(o)) { out(io, "job.batch/" + name + " created" + dryTag(o) + "\n"); return 0; }
          var j = K.jobFromTemplate(C.cl, cj, name, false);
          K.audit(C.cl, C.sub, "create", j);
          K.reconcile(C.cl);
          out(io, "job.batch/" + name + " created\n");
          return 0;
        }
        if (!o.image) { errl(io, "error: required flag(s) \"image\" not set"); return 1; }
        obj = { apiVersion: "batch/v1", kind: "Job", metadata: { name: name, namespace: ns }, spec: { template: { metadata: {}, spec: { containers: [{ name: name, image: o.image, command: o.dash, resources: {} }], restartPolicy: "Never" } } } };
        if (!o.dash) delete obj.spec.template.spec.containers[0].command;
        return emitNew(o, io, sess, obj, "created");
      case "cronjob": case "cj":
        if (!need()) return 1;
        if (!o.image) { errl(io, "error: required flag(s) \"image\" not set"); return 1; }
        if (!o.schedule) { errl(io, "error: required flag(s) \"schedule\" not set"); return 1; }
        obj = { apiVersion: "batch/v1", kind: "CronJob", metadata: { name: name, namespace: ns }, spec: { schedule: o.schedule, jobTemplate: { metadata: { name: name }, spec: { template: { metadata: {}, spec: { containers: [{ name: name, image: o.image, command: o.dash, resources: {} }], restartPolicy: o.restart || "OnFailure" } } } } } };
        if (!o.dash) delete obj.spec.jobTemplate.spec.template.spec.containers[0].command;
        return emitNew(o, io, sess, obj, "created");
      case "token":
        if (!need()) return 1;
        var C2 = KC.ctx(sess, o, io); if (!C2) return 1;
        var sa = K.get(C2.cl, "ServiceAccount", C2.ns, name);
        if (!sa) { errl(io, "error: failed to create token: serviceaccounts \"" + name + "\" not found"); return 1; }
        if (!K.can(C2.cl, C2.sub, "create", "serviceaccounts/token", "", C2.ns, name)) { errl(io, "error: failed to create token: " + K.forbidden(C2.sub, "create", K.KINDS.ServiceAccount, C2.ns, name, "token").replace(/^Error from server \(Forbidden\): /, "")); return 1; }
        var durS = o.duration ? Dk.parseDuration(o.duration) : 3600;
        out(io, K.issueToken(C2.cl, "system:serviceaccount:" + C2.ns + ":" + name, durS || 3600) + "\n");
        return 0;
      case "service": case "svc":
        var stype = o.pos.shift(); name = o.pos[0];
        if (!need()) return 1;
        var tcp = (o.tcp || "").split(",").filter(Boolean).map(function (x) { var p = x.split(":"); return { name: p[0] + "-" + (p[1] || p[0]), port: +p[0], protocol: "TCP", targetPort: +(p[1] || p[0]) }; });
        if (!tcp.length && stype !== "externalname") { errl(io, "error: at least one tcp port specifier must be provided"); return 1; }
        obj = { apiVersion: "v1", kind: "Service", metadata: { name: name, namespace: ns, labels: { app: name } }, spec: { ports: tcp, selector: { app: name }, type: { clusterip: "ClusterIP", nodeport: "NodePort", loadbalancer: "LoadBalancer" }[stype] || "ClusterIP" } };
        return emitNew(o, io, sess, obj, "created");
      case "ingress": case "ing":
        if (!need()) return 1;
        var rules2 = [], tls = [];
        (o.rules || []).forEach(function (r) { var m = /^([^/]*)(\/[^=]*)=([^:]+):([^,]+)(?:,tls=?(.*))?$/.exec(r); if (!m) return; var path = m[2].replace(/\*$/, ""), pt = /\*$/.test(m[2]) ? "Prefix" : "Exact"; rules2.push({ host: m[1] || undefined, http: { paths: [{ path: path, pathType: pt, backend: { service: { name: m[3], port: /^\d+$/.test(m[4]) ? { number: +m[4] } : { name: m[4] } } } }] } }); if (m[5] !== undefined) tls.push({ hosts: [m[1]], secretName: m[5] || undefined }); });
        obj = { apiVersion: "networking.k8s.io/v1", kind: "Ingress", metadata: { name: name, namespace: ns, annotations: o.annotations ? parseKV([].concat(o.annotations)) : undefined }, spec: { ingressClassName: o["class"] || undefined, rules: rules2, tls: tls.length ? tls : undefined } };
        if (!obj.metadata.annotations) delete obj.metadata.annotations; if (!obj.spec.ingressClassName) delete obj.spec.ingressClassName; if (!obj.spec.tls) delete obj.spec.tls;
        return emitNew(o, io, sess, obj, "created");
      default:
        errl(io, "error: unknown command \"" + what + "\" for \"kubectl create\"\n\nDid you mean this?\n\tdeployment\n\tnamespace\n\tsecret"); return 1;
    }
  };
  KC.run = function (o, io, sess) {
    var name = o.pos[0];
    if (!name) { errl(io, "error: NAME is required for run"); return 1; }
    if (!o.image) { errl(io, "error: required flag(s) \"image\" not set"); return 1; }
    var ns = nsOf(sess, o), cmd = o.dash || null;
    var c = { name: name, image: o.image, resources: {} };
    if (cmd) { if (o.command) c.command = cmd; else c.args = cmd; }
    if (o.port) c.ports = [{ containerPort: +o.port }];
    if (o.envs) c.env = o.envs.map(function (e) { var i = e.indexOf("="); return { name: e.slice(0, i), value: e.slice(i + 1) }; });
    if (o.stdin) c.stdin = true; if (o.stdin && o.tty) c.tty = true;
    var labels = o.labels ? parseKV(String(o.labels).split(",")) : { run: name };
    var pod = { apiVersion: "v1", kind: "Pod", metadata: { labels: labels, name: name, namespace: ns }, spec: { containers: [c], dnsPolicy: "ClusterFirst", restartPolicy: o.restart || (o.rm ? "Never" : "Always") } };
    if (o.overrides) { try { var ov = JSON.parse(o.overrides); pod = K.mergePatch ? K.mergePatch(pod, ov) : pod; } catch (e) { errl(io, "error: Invalid JSON Patch"); return 1; } }
    if (o["dry-run"]) { if (/^(yaml|json)$/.test(o.output || "")) { var x = clientObj(pod); out(io, o.output === "yaml" ? KC.yaml(x) : JSON.stringify(x, null, 4) + "\n"); } else out(io, "pod/" + name + " created" + dryTag(o) + "\n"); return 0; }
    var C = KC.ctx(sess, o, io); if (!C) return 1;
    var r = K.write(C.cl, pod, { ns: C.ns, mode: "create", sub: C.sub, source: "STDIN" });
    if (r.error) { errl(io, r.error.replace(/error when creating "STDIN": /, "")); return 1; }
    warn(io, r.warnings);
    var cl = C.cl, p = r.obj;
    if (!o.stdin && !o.attach) { out(io, "pod/" + name + " created\n"); return 0; }
    // attached: wait for it to run (or finish), show its output
    K.advance(cl, 60, function () { var q = K.get(cl, "Pod", C.ns, name); return !q || /^(Running|Succeeded|Failed)$/.test(q.status.phase) || /BackOff|Err|Error/.test(KC.podStatus(q)); });
    var q = K.get(cl, "Pod", C.ns, name);
    var dc = q && K.ctrOf(cl, q);
    if (!dc) { errl(io, "error: timed out waiting for the condition"); return 1; }
    var shellOnly = !cmd || (cmd.length === 1 && /^(\/bin\/)?(sh|bash|ash)$/.test(cmd[0]));
    if (o.tty && shellOnly && dc.state === "running") {
      errl(io, "If you don't see a command prompt, try pressing enter.");
      var cs = Dk.ctrSession(cl.rt, dc, {}); if (cs.error) { errl(io, "error: " + cs.error); return 1; }
      Dk.enterShell(sess, dc, cs.sess, false);
      if (o.rm) { var top = sess.sys.topSession || sess, ent = top.userStack[top.userStack.length - 1]; ent.exitMsg = "exit\nSession ended, resume using 'kubectl attach " + name + " -c " + name + " -i -t' command when the pod is running\npod \"" + name + "\" deleted\n"; ent.onExit = function () { var q2 = K.get(cl, "Pod", C.ns, name); if (q2) K.del(cl, q2, null); }; }
      return 0;
    }
    K.advance(cl, 30, function () { var z = K.get(cl, "Pod", C.ns, name); return !z || /^(Succeeded|Failed)$/.test(z.status.phase); });
    (dc.logs || []).forEach(function (l) { (l.s === "err" ? io.err : io.out)(l.text + "\n"); });
    var fin = K.get(cl, "Pod", C.ns, name), code = fin && fin.status.phase === "Failed" ? 1 : 0;
    if (o.rm && fin) { K.del(cl, fin, C.sub); out(io, "pod \"" + name + "\" deleted\n"); }
    if (code) errl(io, "pod " + C.ns + "/" + name + " terminated (Error)");
    void p;
    return code;
  };
  KC.expose = function (o, io, sess) {
    var C = KC.ctx(sess, o, io); if (!C) return 1;
    var cl = C.cl, tg = KC.targets(cl, o.pos, io, "expose"); if (tg.error) { errl(io, tg.error); return 1; }
    var t = tg.list[0], x = K.get(cl, t.info.kind, C.ns, t.names[0]);
    if (!x) { errl(io, "Error from server (NotFound): " + t.info.plural + (t.info.group ? "." + t.info.group : "") + " \"" + t.names[0] + "\" not found"); return 1; }
    var sel = x.kind === "Pod" ? x.metadata.labels : x.kind === "Service" ? x.spec.selector : (x.spec.selector || {}).matchLabels;
    if (!sel || !keys(sel).length) { errl(io, "error: couldn't retrieve selectors via --selector flag or introspection: the " + x.kind.toLowerCase() + " has no selector"); return 1; }
    var port = o.port ? +o.port : null;
    if (!port) { var cs = x.kind === "Pod" ? x.spec.containers : (x.spec.template || { spec: { containers: [] } }).spec.containers; (cs || []).forEach(function (c) { (c.ports || []).forEach(function (p) { if (!port) port = p.containerPort; }); }); }
    if (!port) { errl(io, "error: couldn't find port via --port flag or introspection\nSee 'kubectl expose -h' for help and examples"); return 1; }
    var svc = { apiVersion: "v1", kind: "Service", metadata: { name: o.name || x.metadata.name, namespace: C.ns, labels: clone(x.metadata.labels) }, spec: { ports: [{ port: port, protocol: "TCP", targetPort: o["target-port"] ? (/^\d+$/.test(o["target-port"]) ? +o["target-port"] : o["target-port"]) : port }], selector: clone(sel), type: o.type || "ClusterIP" } };
    if (o["dry-run"] && /^(yaml|json)$/.test(o.output || "")) { var cx = clientObj(svc); out(io, o.output === "yaml" ? KC.yaml(cx) : JSON.stringify(cx, null, 4) + "\n"); return 0; }
    var r = K.write(cl, svc, { ns: C.ns, mode: "create", sub: C.sub, source: "STDIN", dryRun: !!o["dry-run"] });
    if (r.error) { errl(io, r.error.replace(/error when creating "STDIN": /, "")); return 1; }
    out(io, "service/" + svc.metadata.name + " exposed" + dryTag(o) + "\n");
    return 0;
  };

  /* ================================================================== changing live objects */
  function one(o, io, C, verbName) {
    var tg = KC.targets(C.cl, o.pos, io, verbName); if (tg.error) { errl(io, tg.error); return null; }
    var out2 = [];
    for (var i = 0; i < tg.list.length; i++) {
      var t = tg.list[i];
      if (!t.names.length && o.selector) { K.list(C.cl, t.info.kind, C.ns, K.parseSel(o.selector).test).forEach(function (x) { out2.push({ info: t.info, obj: x }); }); continue; }
      if (!t.names.length && o.all) { K.list(C.cl, t.info.kind, t.info.ns ? C.ns : null).forEach(function (x) { out2.push({ info: t.info, obj: x }); }); continue; }
      if (!t.names.length) { errl(io, "error: resource(s) were provided, but no name was specified"); return null; }
      for (var j = 0; j < t.names.length; j++) {
        var x = K.get(C.cl, t.info.kind, t.info.ns ? C.ns : null, t.names[j]);
        if (!x) { errl(io, "Error from server (NotFound): " + t.info.plural + (t.info.group ? "." + t.info.group : "") + " \"" + t.names[j] + "\" not found"); return null; }
        out2.push({ info: t.info, obj: x });
      }
    }
    return out2;
  }
  function save(C, io, x, info, msg, o, verb, resOverride) {
    if (!K.can(C.cl, C.sub, verb || "patch", resOverride || info.plural, info.group, x.metadata.namespace, x.metadata.name)) { errl(io, K.forbidden(C.sub, verb || "patch", resOverride ? Object.assign({}, info, { plural: resOverride }) : info, x.metadata.namespace, x.metadata.name)); return 1; }
    if (dryTag(o)) { out(io, KC.ref(info, x.metadata.name) + " " + msg + dryTag(o) + "\n"); return 0; }
    var r = K.update(C.cl, x, C.sub, verb || "patch");
    if (r.error) { errl(io, r.error); return 1; }
    warn(io, r.warnings);
    out(io, KC.ref(info, x.metadata.name) + " " + msg + "\n");
    return 0;
  }
  function podSpecOf(x) { return x.kind === "Pod" ? x.spec : x.kind === "CronJob" ? x.spec.jobTemplate.spec.template.spec : x.spec.template && x.spec.template.spec; }
  KC.scale = function (o, io, sess) {
    var C = KC.ctx(sess, o, io); if (!C) return 1;
    if (o.replicas == null) { errl(io, "error: required flag(s) \"replicas\" not set"); return 1; }
    var list = one(o, io, C, "scale"); if (!list) return 1;
    var code = 0;
    list.forEach(function (it) {
      if (!/^(Deployment|ReplicaSet|StatefulSet)$/.test(it.info.kind)) { errl(io, "error: no scaler has been implemented for {\"\" \"" + it.info.kind + "\"}"); code = 1; return; }
      var x = clone(it.obj);
      if (o["current-replicas"] != null && x.spec.replicas !== +o["current-replicas"]) { errl(io, "error: Expected replicas to be " + o["current-replicas"] + ", was " + x.spec.replicas); code = 1; return; }
      x.spec.replicas = +o.replicas;
      code = save(C, io, x, it.info, "scaled", o, "patch", it.info.plural + "/scale") || code;
    });
    return code;
  };
  KC.autoscale = function (o, io, sess) {
    var C = KC.ctx(sess, o, io); if (!C) return 1;
    var list = one(o, io, C, "autoscale"); if (!list) return 1;
    var it = list[0];
    if (o.max == null) { errl(io, "error: --max=MAXPODS is required and must be at least 1, max: -1"); return 1; }
    var h = { apiVersion: "autoscaling/v2", kind: "HorizontalPodAutoscaler", metadata: { name: o.name || it.obj.metadata.name, namespace: C.ns }, spec: { scaleTargetRef: { apiVersion: it.obj.apiVersion, kind: it.obj.kind, name: it.obj.metadata.name }, minReplicas: o.min != null ? +o.min : 1, maxReplicas: +o.max } };
    if (o["cpu-percent"]) h.spec.metrics = [{ type: "Resource", resource: { name: "cpu", target: { type: "Utilization", averageUtilization: +o["cpu-percent"] } } }];
    else h.spec.metrics = [{ type: "Resource", resource: { name: "cpu", target: { type: "Utilization", averageUtilization: 80 } } }];
    if (o["dry-run"] && /^(yaml|json)$/.test(o.output || "")) { out(io, KC.yaml(clientObj(h))); return 0; }
    var r = K.write(C.cl, h, { ns: C.ns, mode: "create", sub: C.sub, source: "STDIN", dryRun: !!o["dry-run"] });
    if (r.error) { errl(io, r.error.replace(/error when creating "STDIN": /, "")); return 1; }
    out(io, "horizontalpodautoscaler.autoscaling/" + h.metadata.name + " autoscaled" + dryTag(o) + "\n");
    return 0;
  };
  KC.set = function (o, io, sess) {
    var what = o.pos.shift();
    var C = KC.ctx(sess, o, io); if (!C) return 1;
    if (what === "image") {
      var pairs = o.pos.filter(function (p) { return /=/.test(p); }); o.pos = o.pos.filter(function (p) { return !/=/.test(p); });
      if (!pairs.length) { errl(io, "error: at least one image update is required"); return 1; }
      var list = one(o, io, C, "set image"); if (!list) return 1;
      var code = 0;
      list.forEach(function (it) {
        var x = clone(it.obj), sp = podSpecOf(x);
        if (!sp) { errl(io, "error: " + it.info.kind + " does not have a pod template"); code = 1; return; }
        var changed = false;
        for (var i = 0; i < pairs.length; i++) {
          var kv = pairs[i].split("="), name = kv[0], img = kv.slice(1).join("=");
          var cs = (sp.containers || []).concat(sp.initContainers || []).filter(function (c) { return name === "*" || c.name === name; });
          if (!cs.length) { errl(io, "error: unable to find container named \"" + name + "\""); code = 1; return; }
          cs.forEach(function (c) { if (c.image !== img) { c.image = img; changed = true; } delete c.imagePullPolicy; });
        }
        if (!changed) { out(io, KC.ref(it.info, x.metadata.name) + " image updated\n"); return; }
        code = save(C, io, x, it.info, "image updated", o) || code;
      });
      return code;
    }
    if (what === "env") {
      var adds = {}, dels = [];
      o.pos = o.pos.filter(function (p) { if (/^[A-Za-z_][\w]*=/.test(p)) { adds[p.slice(0, p.indexOf("="))] = p.slice(p.indexOf("=") + 1); return false; } if (/^[A-Za-z_][\w]*-$/.test(p)) { dels.push(p.slice(0, -1)); return false; } return true; });
      var list2 = one(o, io, C, "set env"); if (!list2) return 1;
      var code2 = 0;
      list2.forEach(function (it) {
        var x = clone(it.obj), sp = podSpecOf(x);
        if (o.list) { sp.containers.forEach(function (c) { out(io, "# " + it.info.kind.toLowerCase() + "s/" + x.metadata.name + ", container " + c.name + "\n"); (c.env || []).forEach(function (e) { out(io, e.name + "=" + (e.value != null ? e.value : "") + "\n"); }); }); return; }
        sp.containers.forEach(function (c) {
          if (o.container && c.name !== o.container) return;
          c.env = (c.env || []).filter(function (e) { return dels.indexOf(e.name) < 0 && !(e.name in adds); });
          keys(adds).forEach(function (k) { c.env.push({ name: k, value: adds[k] }); });
          if (o.from) { var fm = o.from.split("/"); c.envFrom = (c.envFrom || []).concat([/^(configmap|cm)$/.test(fm[0]) ? { configMapRef: { name: fm[1] } } : { secretRef: { name: fm[1] } }]); }
          if (!c.env.length) delete c.env;
        });
        code2 = save(C, io, x, it.info, "env updated", o) || code2;
      });
      return code2;
    }
    if (what === "resources") {
      var list3 = one(o, io, C, "set resources"); if (!list3) return 1;
      var lim = o.limits ? parseKV(String(o.limits).split(",")) : null, req = o.requests ? parseKV(String(o.requests).split(",")) : null;
      if (!lim && !req) { errl(io, "error: you must specify an update to requests or limits (in the form of --requests/--limits)"); return 1; }
      var code3 = 0;
      list3.forEach(function (it) { var x = clone(it.obj), sp = podSpecOf(x); sp.containers.forEach(function (c) { if (o.containers && c.name !== o.containers) return; c.resources = c.resources || {}; if (lim) c.resources.limits = Object.assign(c.resources.limits || {}, lim); if (req) c.resources.requests = Object.assign(c.resources.requests || {}, req); }); code3 = save(C, io, x, it.info, "resource requirements updated", o) || code3; });
      return code3;
    }
    if (what === "serviceaccount" || what === "sa") { var sa = o.pos.pop(); var list4 = one(o, io, C, "set serviceaccount"); if (!list4) return 1; var x4 = clone(list4[0].obj); podSpecOf(x4).serviceAccountName = sa; return save(C, io, x4, list4[0].info, "serviceaccount updated", o); }
    errl(io, "error: unknown command \"" + (what || "") + "\" for \"kubectl set\""); return 1;
  };
  function stripMeta(m) { var o = {}; keys(m || {}).forEach(function (k) { if (!/^(kubectl\.kubernetes\.io\/last-applied-configuration)$/.test(k)) o[k] = m[k]; }); return o; }
  KC.labelLike = function (kind, o, io, sess) {
    var C = KC.ctx(sess, o, io); if (!C) return 1;
    var field = kind === "label" ? "labels" : "annotations";
    var changes = {}, dels = [];
    o.pos = o.pos.filter(function (p, i) { if (i === 0 && !/[=]/.test(p) && !/-$/.test(p)) return true; if (/=/.test(p)) { changes[p.slice(0, p.indexOf("="))] = p.slice(p.indexOf("=") + 1); return false; } if (/-$/.test(p) && i > 0 && !/\//.test(p.slice(0, -1).split("").reverse().join("").slice(0, 0))) { if (o.pos.length > 1 && (i > 1 || /\//.test(o.pos[0]))) { dels.push(p.slice(0, -1)); return false; } } return true; });
    var list = one(o, io, C, kind); if (!list) return 1;
    var code = 0;
    list.forEach(function (it) {
      var x = clone(it.obj), m = x.metadata[field] = x.metadata[field] || {};
      for (var k in changes) { if (m[k] != null && m[k] !== changes[k] && !o.overwrite) { errl(io, "error: '" + k + "' already has a value (" + m[k] + "), and --overwrite is false"); code = 1; return; } }
      var before = JSON.stringify(stripMeta(m));
      keys(changes).forEach(function (k) { m[k] = changes[k]; });
      dels.forEach(function (k) { delete m[k]; });
      if (!keys(m).length) delete x.metadata[field];
      if (JSON.stringify(stripMeta(x.metadata[field] || {})) === before) { out(io, KC.ref(it.info, x.metadata.name) + " not " + (kind === "label" ? "labeled" : "annotated") + "\n"); return; }
      code = save(C, io, x, it.info, kind === "label" ? "labeled" : "annotated", o) || code;
    });
    return code;
  };
  // strategic merge: lists of objects with a "name" are merged by name; $patch: delete removes
  function smp(a, b) {
    if (b === null) return undefined;
    if (Array.isArray(b) && Array.isArray(a) && b.every(function (x) { return isObj(x) && (x.name || x.containerPort || x.mountPath); }) && a.every(function (x) { return isObj(x); })) {
      var keyF = b[0] && b[0].name ? "name" : b[0] && b[0].containerPort ? "containerPort" : "mountPath";
      var outA = a.map(clone);
      b.forEach(function (x) { var i = outA.map(function (y) { return y[keyF]; }).indexOf(x[keyF]); if (x.$patch === "delete") { if (i >= 0) outA.splice(i, 1); return; } if (i >= 0) outA[i] = smp(outA[i], x); else outA.push(clone(x)); });
      return outA;
    }
    if (!isObj(a) || !isObj(b)) return clone(b);
    var r = clone(a); keys(b).forEach(function (k) { var v = smp(a[k], b[k]); if (v === undefined) delete r[k]; else r[k] = v; }); return r;
  }
  function mergePatch(a, b) { if (!isObj(b)) return clone(b); var r = isObj(a) ? clone(a) : {}; keys(b).forEach(function (k) { if (b[k] === null) delete r[k]; else r[k] = mergePatch(r[k], b[k]); }); return r; }
  K.mergePatch = mergePatch; K.smp = smp;
  function jsonPatch(doc, ops) {
    var d = clone(doc);
    for (var i = 0; i < ops.length; i++) {
      var op = ops[i], parts = String(op.path || "").split("/").slice(1).map(function (p) { return p.replace(/~1/g, "/").replace(/~0/g, "~"); });
      var parent = d; for (var j = 0; j < parts.length - 1; j++) { parent = parent == null ? null : parent[Array.isArray(parent) ? +parts[j] : parts[j]]; }
      var last = parts[parts.length - 1];
      if (parent == null) return { error: "doc is missing path: \"" + op.path + "\": missing value" };
      if (op.op === "replace" || op.op === "add") { if (Array.isArray(parent)) { if (last === "-") parent.push(op.value); else if (op.op === "add") parent.splice(+last, 0, op.value); else parent[+last] = op.value; } else { if (op.op === "replace" && !(last in parent)) return { error: "replace operation does not apply: doc is missing key: " + op.path + ": missing value" }; parent[last] = op.value; } }
      else if (op.op === "remove") { if (Array.isArray(parent)) parent.splice(+last, 1); else { if (!(last in parent)) return { error: "remove operation does not apply: doc is missing path: \"" + op.path + "\": missing value" }; delete parent[last]; } }
      else return { error: "Unexpected kind: " + op.op };
    }
    return { doc: d };
  }
  KC.patch = function (o, io, sess) {
    var C = KC.ctx(sess, o, io); if (!C) return 1;
    if (!o.patch && o.previous === true) { var jpos = o.pos.filter(function (x) { return /^\s*[\[{]/.test(x); })[0]; if (jpos) { o.patch = jpos; o.pos.splice(o.pos.indexOf(jpos), 1); } }
    var text = o.patch || o.p; if (o["patch-file"]) text = KC.readF(sess, KC.absPath(sess, o["patch-file"]));
    if (!text) { errl(io, "error: must specify --patch or --patch-file containing the contents of the patch"); return 1; }
    var p; try { p = JSON.parse(text); } catch (e) { var y = root.DevYaml.tryParse(text); if (y.error) { errl(io, "error: unable to parse \"" + text + "\": yaml: did not find expected node content"); return 1; } p = y.value; }
    var list = one(o, io, C, "patch"); if (!list) return 1;
    var it = list[0], x = it.obj, type = o.type || "strategic", next;
    if (type === "json") { if (!Array.isArray(p)) { errl(io, "error: unable to parse \"" + text + "\": json: cannot unmarshal object into Go value of type jsonpatch.Patch"); return 1; } var jp = jsonPatch(x, p); if (jp.error) { errl(io, "The request is invalid: the server rejected our request due to an error in our request"); errl(io, jp.error); return 1; } next = jp.doc; }
    else if (type === "merge") next = mergePatch(x, p);
    else { if (it.info.crd) { errl(io, "error: application/strategic-merge-patch+json is not supported by " + it.info.group + "/" + it.info.gv.split("/").pop() + ", Kind=" + it.info.kind + ": the body of the request was in an unknown format - accepted media types include: application/json-patch+json, application/merge-patch+json, application/apply-patch+yaml"); return 1; } next = smp(x, p); }
    delete next._rt; next._rt = x._rt;
    var a = clone(x), b = clone(next); delete a._rt; delete b._rt;
    if (JSON.stringify(a) === JSON.stringify(b)) { out(io, KC.ref(it.info, x.metadata.name) + " patched (no change)\n"); return 0; }
    var unk = K.unknownFields(next);
    if (unk.length) { errl(io, "Error from server (BadRequest): " + it.info.kind + " in version \"" + x.apiVersion.split("/").pop() + "\" cannot be handled as a " + it.info.kind + ": strict decoding error: " + unk.map(function (u) { return "unknown field \"" + u + "\""; }).join(", ")); return 1; }
    return save(C, io, next, it.info, "patched", o);
  };

  /* ================================================================== rollout */
  function deployProgress(cl, d) {
    var st = d.status || {}, want = d.spec.replicas;
    if (d.metadata.generation > (st.observedGeneration || 0)) return "Waiting for deployment spec update to be observed...";
    if ((st.updatedReplicas || 0) < want) return "Waiting for deployment \"" + d.metadata.name + "\" rollout to finish: " + (st.updatedReplicas || 0) + " out of " + want + " new replicas have been updated...";
    if ((st.replicas || 0) > (st.updatedReplicas || 0)) return "Waiting for deployment \"" + d.metadata.name + "\" rollout to finish: " + ((st.replicas || 0) - (st.updatedReplicas || 0)) + " old replicas are pending termination...";
    if ((st.availableReplicas || 0) < (st.updatedReplicas || 0)) return "Waiting for deployment \"" + d.metadata.name + "\" rollout to finish: " + (st.availableReplicas || 0) + " of " + (st.updatedReplicas || 0) + " updated replicas are available...";
    return null;
  }
  function revisions(cl, d) { return K.ownedBy(cl, d, "ReplicaSet").sort(function (a, b) { return K.rsRevision(a) - K.rsRevision(b); }); }
  KC.rollout = function (o, io, sess) {
    var sub = o.pos.shift();
    var C = KC.ctx(sess, o, io); if (!C) return 1;
    var cl = C.cl;
    if (!/^(status|history|undo|restart|pause|resume)$/.test(sub || "")) { errl(io, "error: unknown command \"" + (sub || "") + "\" for \"kubectl rollout\""); return 1; }
    var list = one(o, io, C, "rollout " + sub); if (!list) return 1;
    var code = 0;
    list.forEach(function (it) {
      var d = it.obj, info = it.info, kind = info.kind;
      if (!/^(Deployment|StatefulSet|DaemonSet)$/.test(kind)) { errl(io, "error: no " + (sub === "status" ? "status viewer" : sub === "history" ? "history viewer" : "rollbacker") + " has been implemented for \"" + kind + "\""); code = 1; return; }
      if (sub === "status") {
        var timeout = o.timeout ? Dk.parseDuration(o.timeout) : 900, seen = {};
        if (kind === "Deployment") {
          var done = false, failed = false;
          K.advance(cl, timeout, function () {
            var cur = K.get(cl, "Deployment", d.metadata.namespace, d.metadata.name); if (!cur) return true;
            if (K.deployFailed(cur)) { failed = true; return true; }
            var msg = deployProgress(cl, cur);
            if (!msg) { done = true; return true; }
            if (!seen[msg]) { seen[msg] = 1; out(io, msg + "\n"); }
            return false;
          });
          if (done) { out(io, "deployment \"" + d.metadata.name + "\" successfully rolled out\n"); return; }
          if (failed) { errl(io, "error: deployment \"" + d.metadata.name + "\" exceeded its progress deadline"); code = 1; return; }
          errl(io, "error: timed out waiting for the condition"); code = 1; return;
        }
        if (kind === "StatefulSet") {
          var ok = K.advance(cl, timeout, function () { var s = K.get(cl, "StatefulSet", d.metadata.namespace, d.metadata.name); var r = (s.status || {}).readyReplicas || 0; if (r < s.spec.replicas) { var m = "Waiting for " + (s.spec.replicas - r) + " pods to be ready..."; if (!seen[m]) { seen[m] = 1; out(io, m + "\n"); } return false; } return true; });
          if (ok) out(io, "partitioned roll out complete: " + d.spec.replicas + " new pods have been updated...\n"); else { errl(io, "error: timed out waiting for the condition"); code = 1; }
          return;
        }
        K.advance(cl, 60, function () { var s = K.get(cl, "DaemonSet", d.metadata.namespace, d.metadata.name); return s.status.numberReady >= s.status.desiredNumberScheduled; });
        out(io, "daemon set \"" + d.metadata.name + "\" successfully rolled out\n");
        return;
      }
      if (kind !== "Deployment") { errl(io, "error: rollout " + sub + " is only simulated for deployments in this lab"); code = 1; return; }
      var revs = revisions(cl, d);
      if (sub === "history") {
        if (o.revision) {
          var rv = revs.filter(function (r) { return K.rsRevision(r) === +o.revision; })[0];
          if (!rv) { errl(io, "error: unable to find the specified revision"); code = 1; return; }
          var tpl = clone(rv.spec.template); delete tpl.metadata.labels["pod-template-hash"];
          out(io, KC.ref(info, d.metadata.name) + " with revision #" + o.revision + "\nPod Template:\n" + KC.DESC.ReplicaSet(cl, rv).split("Pod Template:\n")[1].split("Events:")[0]);
          return;
        }
        var rows = [["REVISION", "CHANGE-CAUSE"]];
        revs.forEach(function (r) { rows.push([K.rsRevision(r), (r.metadata.annotations || {})["kubernetes.io/change-cause"] || "<none>"]); });
        out(io, KC.ref(info, d.metadata.name) + " \n" + KC.table(rows) + "\n");
        return;
      }
      if (sub === "undo") {
        var target;
        if (o["to-revision"] && +o["to-revision"] !== 0) { target = revs.filter(function (r) { return K.rsRevision(r) === +o["to-revision"]; })[0]; if (!target) { errl(io, "error: unable to find specified revision " + o["to-revision"] + " in history"); code = 1; return; } }
        else { if (revs.length < 2) { errl(io, "error: no rollout history found for deployment \"" + d.metadata.name + "\""); code = 1; return; } target = revs[revs.length - 2]; }
        var curHash = K.tplHash(d.spec.template);
        if (target.metadata.labels["pod-template-hash"] === curHash) { out(io, KC.ref(info, d.metadata.name) + " skipped rollback (current template already matches revision " + K.rsRevision(target) + ")\n"); return; }
        var x = clone(d), t2 = clone(target.spec.template); delete t2.metadata.labels["pod-template-hash"];
        x.spec.template = t2;
        if (x.metadata.annotations) delete x.metadata.annotations["kubernetes.io/change-cause"];
        var cc = (target.metadata.annotations || {})["kubernetes.io/change-cause"]; if (cc) { x.metadata.annotations = x.metadata.annotations || {}; x.metadata.annotations["kubernetes.io/change-cause"] = cc; }
        code = save(C, io, x, info, "rolled back", o, "patch") || code;
        return;
      }
      if (sub === "restart") { var x2 = clone(d); x2.spec.template.metadata.annotations = Object.assign({}, x2.spec.template.metadata.annotations, { "kubectl.kubernetes.io/restartedAt": K.stamp(cl).replace("Z", "+00:00") }); code = save(C, io, x2, info, "restarted", o) || code; return; }
      if (sub === "pause" || sub === "resume") { var x3 = clone(d); if (!!x3.spec.paused === (sub === "pause")) { errl(io, "error: " + KC.ref(info, d.metadata.name) + " is " + (sub === "pause" ? "already paused" : "not paused")); code = 1; return; } x3.spec.paused = sub === "pause" ? true : undefined; if (!x3.spec.paused) delete x3.spec.paused; code = save(C, io, x3, info, sub === "pause" ? "paused" : "resumed", o) || code; }
    });
    return code;
  };

  /* ================================================================== wait */
  KC.wait = function (o, io, sess) {
    var C = KC.ctx(sess, o, io); if (!C) return 1;
    var cl = C.cl, cond = o.for || "";
    if (!cond) { errl(io, "error: --for must be set"); return 1; }
    var tg = KC.targets(cl, o.pos, io, "wait"); if (tg.error) { errl(io, tg.error); return 1; }
    var t = tg.list[0], sel = o.selector ? K.parseSel(o.selector).test : null;
    function items() { return t.names.length ? t.names.map(function (n) { return K.get(cl, t.info.kind, C.ns, n); }) : K.list(cl, t.info.kind, C.ns, sel); }
    var first = items();
    if (!first.length || first.some(function (x) { return !x; })) { if (/^delete$/.test(cond)) { return 0; } errl(io, t.names.length ? "Error from server (NotFound): " + t.info.plural + " \"" + t.names[0] + "\" not found" : "error: no matching resources found"); return 1; }
    function met(x) {
      if (!x) return cond === "delete";
      var m;
      if ((m = /^condition=([\w.-]+)(?:=(\w+))?$/i.exec(cond))) { var want = (m[2] || "True").toLowerCase(); return ((x.status || {}).conditions || []).some(function (c) { return c.type.toLowerCase() === m[1].toLowerCase() && String(c.status).toLowerCase() === want; }); }
      if ((m = /^jsonpath=(\{[^}]*\})=(.*)$/.exec(cond))) { var jp = KC.jsonpath(m[1], KC.wire(cl, x)); return !jp.error && jp.text === m[2].replace(/^'|'$/g, ""); }
      return false;
    }
    var uids = first.map(function (x) { return x.metadata.uid; });
    var timeout = o.timeout ? Dk.parseDuration(o.timeout) : 30;
    var ok = K.advance(cl, timeout, function () { return items().length && items().every(function (x) { return cond === "delete" ? !x || uids.indexOf(x.metadata.uid) < 0 : met(x); }) || (cond === "delete" && !items().filter(Boolean).some(function (x) { return uids.indexOf(x.metadata.uid) >= 0; })); });
    if (!ok) { first.forEach(function (x) { if (cond !== "delete" ? !met(K.get(cl, x.kind, x.metadata.namespace, x.metadata.name)) : true) errl(io, "error: timed out waiting for the condition on " + t.info.plural + "/" + x.metadata.name); }); return 1; }
    first.forEach(function (x) { out(io, KC.ref(t.info, x.metadata.name) + " condition met\n"); });
    return 0;
  };

  /* ================================================================== logs, exec, port-forward */
  function pickPod(C, io, word, o) {
    var cl = C.cl;
    if (/\//.test(word)) {
      var sp = word.split("/"), info = K.kindOf(cl, sp[0]);
      if (!info) { errl(io, "error: the server doesn't have a resource type \"" + sp[0] + "\""); return null; }
      if (info.kind === "Pod") return K.get(cl, "Pod", C.ns, sp[1]) || (errl(io, "Error from server (NotFound): pods \"" + sp[1] + "\" not found"), null);
      var owner = K.get(cl, info.kind, C.ns, sp[1]);
      if (!owner) { errl(io, "error: error from server (NotFound): " + info.plural + (info.group ? "." + info.group : "") + " \"" + sp[1] + "\" not found in namespace \"" + C.ns + "\""); return null; }
      var sel = info.kind === "Service" ? owner.spec.selector : owner.spec.selector;
      var pods = K.list(cl, "Pod", C.ns).filter(function (p) { return K.matches(sel, p.metadata.labels) && !K.terminating(p); }).sort(function (a, b) { return (K.podReady(b) ? 1 : 0) - (K.podReady(a) ? 1 : 0) || a.metadata.creationTimestamp - b.metadata.creationTimestamp; });
      if (!pods.length) { errl(io, "error: timed out waiting for the condition"); return null; }
      if (pods.length > 1 && o && o.tell) errl(io, "Found " + pods.length + " pods, using pod/" + pods[0].metadata.name);
      return pods[0];
    }
    var p = K.get(cl, "Pod", C.ns, word);
    if (!p) { errl(io, "Error from server (NotFound): pods \"" + word + "\" not found"); return null; }
    return p;
  }
  function ctrName(p, o, io, verb) {
    if (o.container) { if (!p.spec.containers.concat(p.spec.initContainers || []).some(function (c) { return c.name === o.container; })) { errl(io, "error: container " + o.container + " is not valid for pod " + p.metadata.name); return null; } return o.container; }
    var def = (p.metadata.annotations || {})["kubectl.kubernetes.io/default-container"] || p.spec.containers[0].name;
    if (p.spec.containers.length > 1) errl(io, "Defaulted container \"" + def + "\" out of: " + p.spec.containers.map(function (c) { return c.name; }).concat((p.spec.initContainers || []).map(function (c) { return c.name + " (init)"; })).join(", "));
    void verb;
    return def;
  }
  var VIRTUAL_LOGS = {
    coredns: ".:53\n[INFO] plugin/reload: Running configuration SHA512 = 3f2b9a3c8b0e5c7c3e8f2a9d4b1c6e7f\nCoreDNS-1.11.3\nlinux/amd64, go1.21.11, a6338e9",
    "ingress-nginx-controller": "-------------------------------------------------------------------------------\nNGINX Ingress controller\n  Release:       v1.11.3\n  Build:         0106de65cfccb74405a6dfa7d9daffc6f0a6ef1a\n  Repository:    https://github.com/kubernetes/ingress-nginx\n  nginx version: nginx/1.25.5\n-------------------------------------------------------------------------------\nI1123 09:58:01.000000       7 main.go:205] \"Creating API client\" host=\"https://10.43.0.1:443\"\nI1123 09:58:02.000000       7 controller.go:213] \"Backend successfully reloaded\"",
    "metrics-server": "I1123 09:58:01.000000       1 serving.go:374] Generated self-signed cert (/tmp/apiserver.crt, /tmp/apiserver.key)\nI1123 09:58:02.000000       1 secure_serving.go:213] Serving securely on [::]:10250"
  };
  KC.logs = function (o, io, sess) {
    var C = KC.ctx(sess, o, io); if (!C) return 1;
    var cl = C.cl;
    if (!o.pos[0] && o.selector) {
      var pods0 = K.list(cl, "Pod", C.ns, K.parseSel(o.selector).test);
      if (!pods0.length) { errl(io, "No resources found in " + C.ns + " namespace."); return 0; }
      var code0 = 0;
      pods0.forEach(function (p) { var c = ctrNameQuiet(p, o); code0 = emitLogs(cl, p, c, o, io, o.prefix ? "[pod/" + p.metadata.name + "/" + c + "] " : "") || code0; });
      return code0;
    }
    if (!o.pos[0]) { errl(io, "error: expected 'logs [-f] [-p] (POD | TYPE/NAME) [-c CONTAINER]'.\nPOD or TYPE/NAME is a required argument for the logs command\nSee 'kubectl logs -h' for help and examples"); return 1; }
    if (!K.can(cl, C.sub, "get", "pods/log", "", C.ns)) { errl(io, K.forbidden(C.sub, "get", K.KINDS.Pod, C.ns, o.pos[0].split("/").pop(), "log")); return 1; }
    var p = pickPod(C, io, o.pos[0], { tell: true }); if (!p) return 1;
    if (o.pos[1] && !o.container) o.container = o.pos[1];
    if (o["all-containers"]) { var cc = 0; p.spec.containers.forEach(function (c) { cc = emitLogs(cl, p, c.name, o, io, "") || cc; }); return cc; }
    var cn = ctrName(p, o, io, "logs"); if (!cn) return 1;
    var r = emitLogs(cl, p, cn, o, io, "");
    if (o.follow && !r && io.note) io.note("(kubectl logs -f keeps streaming new lines until you press Ctrl+C. The lab printed what's there now.)");
    return r;
  };
  function ctrNameQuiet(p, o) { return o.container || p.spec.containers[0].name; }
  function emitLogs(cl, p, cn, o, io, prefix) {
    var r = p._rt || {}, x = (r.ctrs || {})[cn], st = (p.status.containerStatuses || []).concat(p.status.initContainerStatuses || []).filter(function (s) { return s.name === cn; })[0];
    if (r.virtual) { var base = p.metadata.name.replace(/-[a-z0-9]{8,10}-[a-z0-9]{5}$/, ""); out(io, (VIRTUAL_LOGS[base] || "") + (VIRTUAL_LOGS[base] ? "\n" : "")); return 0; }
    var lines;
    if (o.previous) {
      if (!x || !x.prev) { errl(io, "Error from server (BadRequest): previous terminated container \"" + cn + "\" in pod \"" + p.metadata.name + "\" not found"); return 1; }
      lines = x.prev;
    } else {
      if (!x || !x.c) {
        var w = st && st.state.waiting;
        errl(io, "Error from server (BadRequest): container \"" + cn + "\" in pod \"" + p.metadata.name + "\" is waiting to start: " + (w && /ImagePull|ErrImage/.test(w.reason) ? "trying and failing to pull image" : w && w.reason === "CreateContainerConfigError" ? "CreateContainerConfigError" : w && w.reason === "PodInitializing" ? "PodInitializing" : "ContainerCreating"));
        return 1;
      }
      lines = x.c.logs;
    }
    if (o.tail != null && +o.tail >= 0) lines = lines.slice(Math.max(0, lines.length - +o.tail));
    if (o.since) { var s = Dk.parseDuration(o.since); lines = lines.filter(function (l) { return l.t >= Dk.clock(cl.rt) - s; }); }
    lines.forEach(function (l) { out(io, prefix + (o.timestamps ? new Date(Dk.stamp(cl.rt, l.t)).toISOString().replace("Z", "000000Z") + " " : "") + l.text + "\n"); });
    return 0;
  }
  KC.exec = function (o, io, sess) {
    var C = KC.ctx(sess, o, io); if (!C) return 1;
    var cl = C.cl;
    if (!o.dash) { errl(io, o.pos.length > 1 ? "error: exec [POD] [COMMAND] is not supported anymore. Use exec [POD] -- [COMMAND] instead\nSee 'kubectl exec -h' for help and examples" : "error: you must specify at least one command for the container"); return 1; }
    if (!o.pos[0]) { errl(io, "error: pod, type/name or --filename must be specified"); return 1; }
    var p = pickPod(C, io, o.pos[0], {}); if (!p) return 1;
    if (!K.can(cl, C.sub, "create", "pods/exec", "", C.ns, p.metadata.name)) { errl(io, K.forbidden(C.sub, "create", K.KINDS.Pod, C.ns, p.metadata.name, "exec")); return 1; }
    var cn = ctrName(p, o, io, "exec"); if (!cn) return 1;
    if (p.status.phase === "Succeeded" || p.status.phase === "Failed") { errl(io, "error: cannot exec into a container in a completed pod; current phase is " + p.status.phase); return 1; }
    var dc = K.ctrOf(cl, p, cn);
    if ((p._rt || {}).virtual) { errl(io, "error: Internal error occurred: error executing command in container: failed to exec in container: failed to start exec \"" + K.hex("vx", 64) + "\": OCI runtime exec failed: exec failed: unable to start container process: exec: \"" + o.dash[0] + "\": executable file not found in $PATH: unknown"); return 126; }
    if (!dc || dc.state !== "running") { errl(io, "error: unable to upgrade connection: container not found (\"" + cn + "\")"); return 1; }
    var argv = o.dash, shell = argv.length === 1 && /^(\/bin\/|\/usr\/bin\/)?(sh|bash|ash)$/.test(argv[0]);
    Dk.syncIn(cl.rt, dc);
    if (shell) {
      if (!(o.stdin && o.tty)) { if (o.stdin) { var rr = Dk.runIn(cl.rt, dc, argv.concat(["-s"]), { stdin: io.stdin || "" }); rr.lines.forEach(function (l) { (l.s === "err" ? io.err : io.out)(l.text); }); return rr.code; } return 0; }
      var cs = Dk.ctrSession(cl.rt, dc, {});
      if (cs.error) { errl(io, "error: " + cs.error); return 1; }
      if (S.resolveCommand(cs.sess, argv[0]).error) { errl(io, "error: Internal error occurred: error executing command in container: failed to exec in container: failed to start exec \"" + K.hex("x" + cn, 64) + "\": OCI runtime exec failed: exec failed: unable to start container process: exec: \"" + argv[0] + "\": executable file not found in $PATH: unknown"); return 1; }
      Dk.enterShell(sess, dc, cs.sess, false);
      if (io.note) io.note("(You're inside the pod's container now. Type exit to come back to the laptop.)");
      K.audit(cl, C.sub, "exec", p, { cmd: argv.join(" ") });
      return 0;
    }
    var r = Dk.runIn(cl.rt, dc, argv, { stdin: io.stdin });
    K.audit(cl, C.sub, "exec", p, { cmd: argv.join(" ") });
    if (r.error) { errl(io, "error: Internal error occurred: error executing command in container: failed to exec in container: failed to start exec \"" + K.hex("x" + argv[0], 64) + "\": OCI runtime exec failed: exec failed: unable to start container process: " + r.error + ": unknown"); return r.notFound ? 127 : 126; }
    r.lines.forEach(function (l) { (l.s === "err" ? io.err : io.out)(l.text); });
    if (r.code) errl(io, "command terminated with exit code " + r.code);
    return r.code;
  };
  KC.portForward = function (o, io, sess) {
    var C = KC.ctx(sess, o, io); if (!C) return 1;
    var cl = C.cl, word = o.pos[0], ports = o.pos.slice(1);
    if (!word || !ports.length) { errl(io, "error: TYPE/NAME and list of ports are required for port-forward\nSee 'kubectl port-forward -h' for help and examples"); return 1; }
    var svc = /^(svc|service|services)\//.test(word) ? K.get(cl, "Service", C.ns, word.split("/")[1]) : null;
    var p = pickPod(C, io, word, {}); if (!p) return 1;
    if (!K.podReady(p) && p.status.phase !== "Running") { errl(io, "error: unable to forward port because pod is not running. Current status=" + p.status.phase); return 1; }
    var addr = o.address === "0.0.0.0" ? "0.0.0.0" : "127.0.0.1";
    for (var i = 0; i < ports.length; i++) {
      var pp = String(ports[i]).split(":"), lp = +(pp[0] || pp[1]), rp = pp[1] != null ? pp[1] : pp[0];
      var target = +rp;
      if (svc) { var sp = (svc.spec.ports || []).filter(function (x) { return x.port === +rp || x.name === rp; })[0]; if (!sp) { errl(io, "error: Service " + svc.metadata.name + " does not have a service port " + rp); return 1; } target = K.targetPort(sp, p); }
      else if (!/^\d+$/.test(rp)) { var hit = null; p.spec.containers.forEach(function (c) { (c.ports || []).forEach(function (x) { if (x.name === rp) hit = x.containerPort; }); }); if (!hit) { errl(io, "error: Pod '" + p.metadata.name + "' does not have a named port '" + rp + "'"); return 1; } target = hit; }
      if (M2.listeners(sess.sys).some(function (l) { return l.sock.port === lp && l.sock.proto === "tcp"; })) { errl(io, "Unable to listen on port " + lp + ": Listeners failed to create with the following errors: [unable to create listener: Error listen tcp4 127.0.0.1:" + lp + ": bind: address already in use]\nerror: unable to listen on any of the requested ports: [{" + lp + " " + target + "}]"); return 1; }
      M2.spawn(sess.sys, { cmd: "kubectl port-forward " + o.pos.join(" "), comm: "kubectl", uid: sess.uid, k8sFwd: { ns: p.metadata.namespace, pod: p.metadata.name, uid: p.metadata.uid, port: target }, listen: [{ proto: "tcp", addr: addr, port: lp }] });
      out(io, "Forwarding from " + addr + ":" + lp + " -> " + target + "\n" + (addr === "127.0.0.1" ? "Forwarding from [::1]:" + lp + " -> " + target + "\n" : ""));
    }
    if (io.note && !sess.bgJob) io.note("(port-forward keeps running until you stop it with Ctrl+C. The lab left it running in the background so you can use this terminal: curl localhost:" + String(ports[0]).split(":")[0] + ", then kill %1 or pkill -f port-forward when you're done.)");
    return 0;
  };
  M2.appHandlers = M2.appHandlers || [];
  M2.appHandlers.push(function (sys, proc, req) {
    if (!proc.k8sFwd) return null;
    var cl = K.of(sys); if (!cl) return { closed: true };
    var f = proc.k8sFwd, p = K.get(cl, "Pod", f.ns, f.pod);
    if (!p || p.metadata.uid !== f.uid) return { closed: true };
    var c = K.listener(cl, p, f.port);
    if (!c) return { closed: true };
    return Dk.ctrHttp(cl.rt, c, f.port, req, "127.0.0.1");
  });

  /* ================================================================== kubectl */
  var HELP = "kubectl controls the Kubernetes cluster manager.\n\n Find more information at: https://kubernetes.io/docs/reference/kubectl/\n\nBasic Commands (Beginner):\n  create          Create a resource from a file or from stdin\n  expose          Take a replication controller, service, deployment or pod and expose it as a new Kubernetes service\n  run             Run a particular image on the cluster\n  set             Set specific features on objects\n\nBasic Commands (Intermediate):\n  explain         Get documentation for a resource\n  get             Display one or many resources\n  edit            Edit a resource on the server\n  delete          Delete resources by file names, stdin, resources and names, or by resources and label selector\n\nDeploy Commands:\n  rollout         Manage the rollout of a resource\n  scale           Set a new size for a deployment, replica set, or replication controller\n  autoscale       Auto-scale a deployment, replica set, stateful set, or replication controller\n\nCluster Management Commands:\n  cluster-info    Display cluster information\n  top             Display resource (CPU/memory) usage\n\nTroubleshooting and Debugging Commands:\n  describe        Show details of a specific resource or group of resources\n  logs            Print the logs for a container in a pod\n  exec            Execute a command in a container\n  port-forward    Forward one or more local ports to a pod\n  auth            Inspect authorization\n  events          List events\n\nAdvanced Commands:\n  diff            Diff the live version against a would-be applied version\n  apply           Apply a configuration to a resource by file name or stdin\n  patch           Update fields of a resource\n  replace         Replace a resource by file name or stdin\n  wait            Experimental: Wait for a specific condition on one or many resources\n  kustomize       Build a kustomization target from a directory or URL\n\nSettings Commands:\n  label           Update the labels on a resource\n  annotate        Update the annotations on a resource\n\nOther Commands:\n  api-resources   Print the supported API resources on the server\n  config          Modify kubeconfig files\n  version         Print the client and server version information\n\nUsage:\n  kubectl [flags] [options]\n\nUse \"kubectl <command> --help\" for more information about a given command.\nUse \"kubectl options\" for a list of global command-line options (applies to all commands).\n";
  S.CMDS.kubectl = function (args, io, sess) {
    var o = KC.parse(args.slice(1));
    var sub = o.pos.shift();
    if (!sub || o.help && !sub) { out(io, HELP); return 0; }
    if (o.help) { out(io, "(kubectl " + sub + " --help prints the full flag list. The Learn tab covers the flags this lab uses.)\n"); return 0; }
    switch (sub) {
      case "get": return KC.get(o, io, sess);
      case "describe": return KC.describe(o, io, sess);
      case "apply": if (o.pos[0] === "view-last-applied") { var C0 = KC.ctx(sess, o, io); if (!C0) return 1; var tg = KC.targets(C0.cl, o.pos.slice(1), io); if (tg.error) { errl(io, tg.error); return 1; } var x0 = K.get(C0.cl, tg.list[0].info.kind, C0.ns, tg.list[0].names[0]); var la = x0 && (x0.metadata.annotations || {})["kubectl.kubernetes.io/last-applied-configuration"]; if (!la) { errl(io, "error: no last-applied-configuration annotation found on resource: " + (tg.list[0].names[0] || "")); return 1; } out(io, KC.yaml(JSON.parse(la))); return 0; } return KC.applyLike("apply", o, io, sess);
      case "create": return KC.create(o, io, sess);
      case "replace": return KC.applyLike("replace", o, io, sess);
      case "delete": return KC.deleteCmd(o, io, sess);
      case "diff": return KC.diff(o, io, sess);
      case "run": return KC.run(o, io, sess);
      case "expose": return KC.expose(o, io, sess);
      case "scale": return KC.scale(o, io, sess);
      case "autoscale": return KC.autoscale(o, io, sess);
      case "set": return KC.set(o, io, sess);
      case "rollout": return KC.rollout(o, io, sess);
      case "label": return KC.labelLike("label", o, io, sess);
      case "annotate": return KC.labelLike("annotate", o, io, sess);
      case "patch": return KC.patch(o, io, sess);
      case "wait": return KC.wait(o, io, sess);
      case "logs": case "log": return KC.logs(o, io, sess);
      case "exec": return KC.exec(o, io, sess);
      case "port-forward": return KC.portForward(o, io, sess);
      case "events": return KC.events(o, io, sess);
      case "top": return KC.top(o, io, sess);
      case "auth": return KC.auth(o, io, sess);
      case "config": return KC.config(o, io, sess);
      case "version": return KC.version(o, io, sess);
      case "cluster-info": return KC.clusterInfo(o, io, sess);
      case "api-resources": return KC.apiResources(o, io, sess);
      case "explain": return KC.explain(o, io, sess);
      case "kustomize": { if (!K.kustomize) { errl(io, "error: kustomize is not available"); return 1; } var kz = K.kustomize(sess, KC.absPath(sess, o.pos[0] || ".")); if (kz.error) { errl(io, kz.error); return 1; } out(io, kz.docs.map(function (d) { return KC.yaml(d.obj); }).join("---\n")); return 0; }
      case "edit": errl(io, "error: kubectl edit opens the object in a text editor, which this lab's terminal can't host.\nInstead: kubectl get " + (o.pos.join(" ") || "TYPE NAME") + " -o yaml > obj.yaml, edit obj.yaml with nano, then kubectl apply -f obj.yaml (or use kubectl set / scale / patch)."); return 1;
      case "debug": errl(io, "error: kubectl debug (ephemeral debug containers) isn't simulated in this lab. Use kubectl exec into the pod, or kubectl run a throwaway pod: kubectl run tmp --rm -it --image=busybox:1.36 -- sh"); return 1;
      case "cp": errl(io, "error: kubectl cp isn't simulated in this lab. Use kubectl exec POD -- cat FILE > local-file, or kubectl exec -i POD -- sh -c 'cat > FILE' < local-file"); return 1;
      case "attach": errl(io, "error: kubectl attach isn't simulated in this lab. Use kubectl logs or kubectl exec -it POD -- sh."); return 1;
      case "options": out(io, "The following options can be passed to any command:\n\n    --as='':\n\tUsername to impersonate for the operation.\n\n    --context='':\n\tThe name of the kubeconfig context to use\n\n    --kubeconfig='':\n\tPath to the kubeconfig file to use for CLI requests.\n\n    -n, --namespace='':\n\tIf present, the namespace scope for this CLI request\n"); return 0;
      default:
        errl(io, "error: unknown command \"" + sub + "\" for \"kubectl\"" + (/^(pods?|deploy|svc)$/.test(sub) ? "\n\nDid you mean this?\n\tget" : "")); return 1;
    }
  };
})(typeof window !== "undefined" ? window : globalThis);
